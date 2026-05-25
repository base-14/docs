---
date: 2026-05-07
id: collecting-azure-api-management-telemetry
title: Azure API Management Monitoring with OpenTelemetry - Gateway Latency, Request Counts, and Backend Health
sidebar_label: Azure API Management
sidebar_position: 12
description:
  Wire Azure API Management metrics into your existing OpenTelemetry Collector
  and ship to base14 Scout. Covers tier choice (Consumption to Premium v2),
  request and latency breakdowns, gateway-vs-backend rate-limit attribution,
  the receiver case-mismatch workaround, and the Diagnostic Settings handoff
  for logs.
keywords:
  - azure api management monitoring
  - apim opentelemetry
  - azure monitor receiver
  - apim gateway latency
  - apim consumption vs developer tier
  - backend duration metric
  - api management rate limit policy
  - subscription key authentication
  - application insights alternative
  - base14 scout azure apim
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure API Management metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.ApiManagement/service, route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing your APIM service. The receiver polls Azure Monitor's REST API every 60 seconds. Consumption tier emits a smaller metric subset than Developer, Standard, Premium, and Premium v2; the receiver returns whatever the resource publishes without erroring on tier-gated metrics."}},{"@type":"Question","name":"Why are CpuPercent_Gateway and MemoryPercent_Gateway silent on Developer tier?","acceptedAnswer":{"@type":"Answer","text":"Both metrics are published by Azure Monitor at PT5M (5-minute) granularity and only emit data points when gateway load is measurable. A freshly-provisioned Developer instance with low traffic can keep these metrics silent for the first 10 to 30 minutes after deploy. Production fleets with steady traffic see them populate immediately. Wire alerts to fire on threshold crossings only when at least one data point has been observed in the prior hour; otherwise alert on series presence so a missing series does not trigger as a low-CPU positive."}},{"@type":"Question","name":"What is the difference between APIM gateway 429 and backend 429?","acceptedAnswer":{"@type":"Answer","text":"APIM gateway 429 means the rate-limit-by-key or rate-limit-by-subscription policy on the API tripped before the request reached the backend. Visible as metadata_BackendResponseCode 0 plus metadata_LastErrorReason RateLimitExceeded on the OtherRequests metric. Backend 429 means the upstream service returned 429 to APIM, which forwarded it as-is to the client. Visible as metadata_BackendResponseCode 429 plus metadata_LastErrorReason None. Distinguishing them is essential because the remediation is different - gateway 429 is APIM policy tuning, backend 429 is upstream capacity."}},{"@type":"Question","name":"Why do my APIM dimensions appear with both PascalCase and lowercase keys?","acceptedAnswer":{"@type":"Answer","text":"This is opentelemetry-collector-contrib bug #45942. The azure_monitor receiver currently emits metadata_ApiId alongside metadata_apiid, metadata_Hostname alongside metadata_hostname, and metadata_Location alongside metadata_location for the same metric series, doubling cardinality silently. Workaround: apply a transform processor in the collector pipeline to canonicalise the keys to lowercase. The bug is namespace-specific and has been observed on Azure Firewall, Azure Storage, and Azure API Management as of receiver v0.151.0. The transform processor pattern in this guide preserves both label families until the upstream fix lands."}},{"@type":"Question","name":"Should I run APIM Diagnostic Logs through this metrics collector?","acceptedAnswer":{"@type":"Answer","text":"No. APIM diagnostic logs (GatewayLogs, WebSocketConnectionLogs, DeveloperPortalAuditLogs) are handled by Diagnostic Settings forwarding to Event Hubs, then ingested by the azureeventhubreceiver as OTel logs. That is a separate fragment under the long-lived shared scraper and is documented separately from this metrics-only guide. The two pipelines coexist in one collector but use different receivers and different metric or log signals."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for Azure API Management. For
the cross-surface architecture (auth, push vs pull, latency, the trace
gap), read [Azure Monitoring with OpenTelemetry - Architecture for
base14 Scout](./overview.md) first.

This guide is for engineers running APIM in production who want to add
gateway telemetry to an existing OpenTelemetry Collector and ship it
to base14 Scout. The collector polls Azure Monitor's REST API for
`Microsoft.ApiManagement/service` metrics every 60 seconds, emits OTel
metric series, and exports via OTLP/HTTP. The receiver does not
proxy or terminate traffic - it queries Azure Monitor for whatever
your APIM service auto-publishes.

The receiver does not connect to APIM directly. It queries Azure
Monitor for any APIM service your subscription auto-publishes to, so
the same configuration covers Consumption, Developer, Basic, Standard,
Premium, and Premium v2 tiers across any number of APIs, operations,
products, and subscriptions per service.

This guide is metrics-only. For ingesting APIM diagnostic logs
(`GatewayLogs`, `WebSocketConnectionLogs`, `DeveloperPortalAuditLogs`),
see [Logs](#logs) for the Diagnostic Settings → Event Hubs handoff.

## API Management at a glance

API Management is Azure's full-lifecycle gateway product: a request
hits a published API, APIM applies a per-API or per-operation policy
chain (auth, transformation, rate limiting, caching, validation),
forwards to the configured backend, and applies a response policy
chain on the way out. Every step contributes to observable signals.

| Layer | What it produces |
| --- | --- |
| Listener | Total incoming request count, including pre-auth rejects. |
| Authentication and policy | Subscription-key validation, JWT validation, IP filtering, policy-based rate limiting. |
| Backend forwarding | One request per inbound request to the configured `serviceUrl` (or a backend pool). |
| Response handling | Status code, latency, transformation, response cache lookup. |

The receiver does not see the per-step breakdown - Azure Monitor
publishes coarse counters (request counts split by gateway response
category, plus end-to-end and backend latency aggregations). For the
per-step breakdown, ship logs via Diagnostic Settings.

## Tier choice

Azure API Management has six pricing tiers as of 2026. Each gates
feature availability, which in turn gates which metrics emit data.

| Tier | Pricing model | Provisioning | Metric coverage |
| --- | --- | --- | --- |
| **Consumption** | Serverless: $3.50 per million calls, near-zero idle | ~5-10 min | Request counts, end-to-end latency, backend latency. **No** `Capacity`, `CpuPercent_Gateway`, `MemoryPercent_Gateway`, `EventHubTotal*`, `NetworkConnectivity`, `WebSocketMessages`, `ConnectionAttempts`. |
| **Developer** | Single dedicated unit, ~$0.07/hour | 30-45 min | All Consumption metrics + `Capacity` + `CpuPercent_Gateway` + `MemoryPercent_Gateway` + `EventHubTotal*` + `NetworkConnectivity` + `WebSocketMessages` + `ConnectionAttempts`. |
| **Basic** | 1-2 dedicated units, ~$0.20/hour per unit | 30-45 min | Same as Developer + multi-unit autoscale. |
| **Standard** | 1-4 dedicated units, ~$0.95/hour per unit | 30-45 min | Same as Basic + custom domains + zone redundancy. |
| **Premium** | 1-N dedicated units, ~$3.78/hour per unit, multi-region | 45-60 min | Same as Standard + multi-region deploy + VNet integration + private endpoints. |
| **Premium v2** | Same as Premium plus Stv2 platform | 45-60 min | Same metrics; runtime improvements only. |

The receiver configuration is identical across tiers. Tier-gated
metrics that the resource does not publish simply emit no data points

- there is no error and no zero-valued series. The whitelist below
intersects what every tier publishes; expand it for Developer and
above by adding `Capacity` + `CpuPercent_Gateway` + `MemoryPercent_Gateway`.

Pick Consumption for spiky workloads where idle cost matters more than
metric depth. Pick Developer for non-production environments that
need the full metric surface for dashboarding. Production lives on
Standard, Premium, or Premium v2.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, transform processor (for receiver bug #45942), and
pipeline are all keyed `/apimanagement` so they coexist with other
Azure receivers under one collector and one Scout exporter.

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/apimanagement:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:APIMANAGEMENT_RESOURCE_GROUP}
    services:
      - Microsoft.ApiManagement/service
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.ApiManagement/service":
        # Universal counters (Consumption + Developer + Basic + Standard + Premium + Premium v2)
        Requests:              [Total]
        SuccessfulRequests:    [Total]
        FailedRequests:        [Total]
        OtherRequests:         [Total]
        UnauthorizedRequests:  [Total]
        # Universal latency, dual-aggregation
        Duration:              [Average, Maximum]
        BackendDuration:       [Average, Maximum]
        # Developer / Basic / Standard / Premium / Premium v2 only
        Capacity:              [Average]
        CpuPercent_Gateway:    [Average]
        MemoryPercent_Gateway: [Average]
        # Diagnostic-Settings-to-Event-Hubs egress (whitelisted but silent unless configured)
        EventHubTotalEvents:    [Total]
        EventHubTotalBytesSent: [Total]

processors:
  resource/apimanagement:
    attributes:
      - {key: cloud.provider,    value: azure,                                action: insert}
      - {key: cloud.platform,    value: azure_api_management,                 action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",       action: insert}
      - {key: cloud.region,      value: "${env:APIMANAGEMENT_REGION}",        action: insert}
      # cloud.resource_id is recommended but optional - the receiver injects
      # azuremonitor.resource_id per data point automatically.
      - {key: cloud.resource_id, value: "${env:APIMANAGEMENT_RESOURCE_ID}",   action: insert}
      - {key: service.name,      value: "${env:APIMANAGEMENT_SERVICE_NAME}",  action: insert}

  # Workaround for receiver bug #45942 (case-mismatch on metadata_*
  # dimensions, observed on v0.151.0). Lowercases the PascalCase
  # variants to deduplicate. The `set(...) where ... == nil` guard
  # prevents overwriting any legitimate lowercase value that the
  # receiver already emitted on the same data point. See
  # [Bug #45942](#bug-45942-case-mismatched-dimension-keys).
  transform/apim_dim_lowercase:
    metric_statements:
      - context: datapoint
        statements:
          - set(attributes["metadata_apiid"], attributes["metadata_ApiId"]) where attributes["metadata_ApiId"] != nil and attributes["metadata_apiid"] == nil
          - delete_key(attributes, "metadata_ApiId") where attributes["metadata_ApiId"] != nil
          - set(attributes["metadata_hostname"], attributes["metadata_Hostname"]) where attributes["metadata_Hostname"] != nil and attributes["metadata_hostname"] == nil
          - delete_key(attributes, "metadata_Hostname") where attributes["metadata_Hostname"] != nil
          - set(attributes["metadata_location"], attributes["metadata_Location"]) where attributes["metadata_Location"] != nil and attributes["metadata_location"] == nil
          - delete_key(attributes, "metadata_Location") where attributes["metadata_Location"] != nil

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/apimanagement:
      receivers: [azure_monitor/apimanagement]
      processors: [memory_limiter, resource/apimanagement, transform/apim_dim_lowercase, batch]
      exporters: [otlphttp/b14]
```

The Scout exporter (`oauth2client` + `otlphttp/b14`) stays unchanged;
one Scout pipeline serves every Azure surface.

## Authentication and RBAC

Pick the `azure_auth` mode for where the collector runs:

- **AKS pod** - `workload_identity` (federated credential, no secret).
- **Container Apps / VMSS / Azure VM** - `managed_identity` (user-assigned
  survives instance replacement).
- **External or on-prem** - `service_principal`.
- **Local dev only** - `use_default: true` (Azure SDK credential chain).

Grant `Monitoring Reader` at the resource group containing your APIM
service. For mode-by-mode YAML, federation-credential setup, and the
`az role assignment create` snippet, see
[Azure Service Bus § Authentication](./service-bus.md#authentication) -
the configuration is identical except for the receiver's `services:`
line and the resource processor's `cloud.platform` value.

This guide defaults `use_batch_api: false` to match the validated
runnable example. Flip to `true` once the data-plane RBAC has settled
(5-30 minutes after a fresh `Monitoring Reader` grant) for the
360,000-calls/hour ceiling.

## What you'll monitor

Twelve metrics from `Microsoft.ApiManagement/service`. The receiver
renames them from Azure's PascalCase (e.g. `Duration`) to OTel-style
`azure_<lowercased>_<aggregation>` (e.g. `azure_duration_average`).

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Requests` | `azure_requests_total` | Count | Total inbound request count to the gateway. The `metadata_GatewayResponseCode` dimension splits by HTTP status; `metadata_GatewayResponseCodeCategory` rolls them into 2xx / 4xx / 5xx buckets. |
| `SuccessfulRequests` | `azure_successfulrequests_total` | Count | HTTP 2xx subset. Pair with `Requests` to derive a success rate. |
| `FailedRequests` | `azure_failedrequests_total` | Count | HTTP 5xx subset. *Silent-when-quiet.* |
| `OtherRequests` | `azure_otherrequests_total` | Count | HTTP 4xx subset. Includes both client errors (400, 401, 404, 422) and APIM-policy rate-limit rejects (429 with `metadata_LastErrorReason: RateLimitExceeded`). See [Gateway 429s vs backend 429s](#gateway-429s-vs-backend-429s). |
| `UnauthorizedRequests` | `azure_unauthorizedrequests_total` | Count | HTTP 401 + 403 subset. Subscription-key invalid, JWT expired, IP-filter rejection. Useful as a security signal independent of `OtherRequests`. |
| `Duration` | `azure_duration_average` + `azure_duration_maximum` | ms | End-to-end gateway latency: client request received to client response sent. Includes policy execution + backend forwarding + response handling. |
| `BackendDuration` | `azure_backendduration_average` + `azure_backendduration_maximum` | ms | Backend leg only: APIM-to-backend send to backend response received. `Duration - BackendDuration` is APIM's own overhead (policy + transformation + caching). |
| `Capacity` | `azure_capacity_average` | Percent | Gateway capacity utilisation as a single percent. Single dedicated unit on Developer; sums across units on Basic / Standard / Premium. |
| `CpuPercent_Gateway` | `azure_cpupercent_gateway_average` | Percent | Per-unit CPU. Published at PT5M (5-minute) granularity. Silent on a freshly-deployed gateway with low traffic; populates within 10-30 min of sustained load. |
| `MemoryPercent_Gateway` | `azure_memorypercent_gateway_average` | Percent | Per-unit memory. Same PT5M granularity and load floor as CpuPercent. |
| `EventHubTotalEvents` | `azure_eventhubtotalevents_total` | Count | Diagnostic Settings → Event Hubs egress count. *Silent unless configured.* |
| `EventHubTotalBytesSent` | `azure_eventhubtotalbytessent_total` | Bytes | Diagnostic Settings → Event Hubs egress bytes. *Silent unless configured.* |

`metadata_apiid` rides alongside every per-API metric, splitting the
service-scope series into per-API series automatically. Operations
within an API are not split at the metric level - operation-level
attribution requires Diagnostic Settings logs.

**Silent-when-quiet.** Azure Monitor returns data points only for time
windows where the underlying condition occurred. A healthy gateway
emits zero series for `FailedRequests`. Wire alerts on this metric
to fire on series presence in window, not on threshold crossings.

**Tier-gated metrics.** `Capacity`, `CpuPercent_Gateway`, and
`MemoryPercent_Gateway` are not published on Consumption tier. The
receiver still queries them; Azure Monitor returns an empty set and
the receiver passes that through unchanged.

**Diagnostic-Settings-gated metrics.** `EventHubTotalEvents` and
`EventHubTotalBytesSent` only emit when Diagnostic Settings →
Event Hubs is configured at the APIM service. They quantify the
**egress to Event Hubs**, not the API request volume. Drop them
from the whitelist on fleets that do not use Diagnostic Settings
egress to keep the metric cardinality clean.

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST
API. Azure Monitor enforces two ceilings:

| Endpoint | Rate limit | When it applies |
| --- | --- | --- |
| Legacy Azure Resource Manager `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Default in this guide. Immediate RBAC propagation. |
| Data-plane batch (`use_batch_api: true`) | 360,000 calls / hour / subscription | Switch once data-plane RBAC has propagated (5-30 min after grant). |

At a 60-second collection interval, a single APIM service costs
roughly 60 calls per hour (one per metric per poll, deduplicated
within the receiver). A 50-service fleet running on legacy `/metrics`
consumes ~3,000 calls per hour - well within the 12k ceiling.
Above ~150 services per subscription, switch to `use_batch_api: true`
to lift the per-subscription ceiling and benefit from batched fan-out.

The receiver shares one rate-limit budget across all subscriptions in
the list; it does not bypass per-subscription quotas. Splitting heavy
subscriptions across separate collector instances lifts the aggregate
ceiling linearly.

`cache_resources` is the resource-list cache TTL in seconds. The
receiver default is `86400` (24 hours), which is correct for a stable
fleet. Lower to `3600` or `600` only if APIM services are created and
destroyed frequently enough that 24-hour-stale resource lists become
a problem.

## Cardinality control

By default, the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. APIM
publishes more dimensions than most Azure surfaces: `ApiId`,
`Location`, `Hostname`, `GatewayResponseCode`,
`GatewayResponseCodeCategory`, `BackendResponseCode`,
`BackendResponseCodeCategory`, and `LastErrorReason`. The product
across these dimensions can blow up cardinality on busy gateways.

A worked example: 1 service × 12 metrics × 1 aggregation each (with
the dual-aggregation Duration / BackendDuration counted separately) ×
average 4-dimension-value combinations per metric ≈ 56 series for one
quiet API. Add a second API and the per-API metrics double; add the
`GatewayResponseCode` split (typically 5-8 active values during error
windows) and request-count metrics multiply 5-8×.

Two control levers, in order of preference:

1. **`dimensions.overrides`** drops or whitelists dimensions per
   metric. Drop `BackendResponseCode` on metrics where it is always
   identical to `GatewayResponseCode` (most happy-path traffic);
   drop `Hostname` on single-region single-domain services; drop
   `LastErrorReason` on metrics that are not the error counters.

   The override config uses the **bare Azure dimension name** (e.g.
   `ApiId`, not `metadata_apiid`); the receiver adds the `metadata_`
   prefix when it emits.

   ```yaml
   azure_monitor/apimanagement:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.ApiManagement/service":
           Requests:
             - ApiId
             - GatewayResponseCodeCategory
           SuccessfulRequests:
             - ApiId
           FailedRequests:
             - ApiId
             - LastErrorReason
           OtherRequests:
             - ApiId
             - LastErrorReason
             - GatewayResponseCode
           Duration:
             - ApiId
           BackendDuration:
             - ApiId
   ```

2. **Per-service receiver instances.** Split high-cardinality APIs
   into separate `azure_monitor/apimanagement-public` and
   `azure_monitor/apimanagement-internal` receivers with different
   override profiles. Both contribute to the same `metrics/apimanagement`
   pipeline.

Receiver bug #45942 emits these dimensions in both PascalCase and
lowercase forms on the same metric; the `transform` processor in the
[Receiver configuration](#receiver-configuration) snippet canonicalises
them to lowercase. See
[Bug #45942](#bug-45942-case-mismatched-dimension-keys).

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric on
the collector's Prometheus self-telemetry endpoint (port 8888 by
default) to see actual cardinality after `overrides` apply.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting
points; derive your own from observed 99th percentile over a
representative week.

`azure_failedrequests_total` only emits data points when 5xx responses
occur. Wire alerts on this metric to fire on series presence in
window, not on numeric thresholds; a healthy gateway emits no points
at all.

| Metric (OTel name) | Warning | Critical | Why it matters |
| --- | --- | --- | --- |
| `azure_failedrequests_total` (per `metadata_apiid`) | `> 0` over 5m | `> 0` over 15m | Backend or APIM gateway 5xx. Investigate backend health and APIM Diagnostic Logs together. |
| `azure_otherrequests_total / azure_requests_total` (4xx ratio) | > 5% / 5m | > 15% / 5m | High client-error rate. Slice by `metadata_LastErrorReason` to distinguish `RateLimitExceeded` (gateway throttling) from `OperationNotFound` (consumer routing bugs) from `KeyNotFound` (auth misconfiguration). |
| `azure_unauthorizedrequests_total` | > 1% / 5m | > 5% / 5m | Brute-force or expired-key window. Cross-check IP-filter logs in Diagnostic Settings. |
| `azure_duration_average` (per `metadata_apiid`) | > 1s | > 3s | End-to-end gateway latency. If `BackendDuration` is the dominant component, the upstream is slow; if `Duration - BackendDuration` is dominant, APIM policy execution is slow. |
| `azure_backendduration_maximum` (per `metadata_apiid`) | > p99 baseline × 2 | > p99 baseline × 5 | Tail latency at the upstream. Driven by retry storms or upstream saturation. |
| `azure_capacity_average` (single-unit) / `100` | > 70% | > 90% | Gateway saturation. On Developer this is the single unit; on Basic / Standard / Premium it summarises the autoscale pool. |
| `azure_cpupercent_gateway_average` (per unit) | > 70% | > 90% | Per-unit CPU. Add capacity (autoscale) or upgrade tier. |
| `azure_memorypercent_gateway_average` (per unit) | > 70% | > 90% | Per-unit memory. Memory pressure surfaces as 502s before CPU saturation does. |

### RED method on the gateway

If you run APIM as part of a service backed by service-level
objectives (SLOs), frame APIM metrics as RED (rate, errors,
duration) on the gateway:

- **Rate.** `azure_requests_total` per service, sliced by API
  (`metadata_apiid`).
- **Errors.** Split into two service-level indicators (SLIs):
  - **Availability error rate** = `(azure_failedrequests_total +
    azure_otherrequests_total{metadata_LastErrorReason="RateLimitExceeded"}) /
    azure_requests_total`. Routes to platform on-call.
  - **Request-quality error rate** =
    `azure_otherrequests_total{metadata_LastErrorReason!="RateLimitExceeded"}
    / azure_requests_total`. Routes to the owning API team.
- **Duration.** `azure_duration_maximum` for tail; `azure_duration_average`
  for steady state. APIM's overhead = `Duration - BackendDuration`;
  upstream contribution = `BackendDuration`.

For saturation (the U in USE), pair `azure_capacity_average`,
`azure_cpupercent_gateway_average`, and
`azure_memorypercent_gateway_average`. On Consumption tier, capacity
metrics are absent; saturation is governed by Azure's per-call
quotas which surface as 429s in `OtherRequests`.

## Production-tier additions

Standard, Premium, and Premium v2 publish a handful of metrics not
exposed on Consumption or Developer. Extend the whitelist when the
service is at one of those tiers:

```yaml
metrics:
  "Microsoft.ApiManagement/service":
    # ...all 12 from the universal + Capacity + EventHub set above...
    NetworkConnectivity: [Average]    # 0 / 1 health to dependencies (DNS, AAD, Storage)
    WebSocketMessages:   [Total]      # WebSocket frame count, when WS APIs are configured
    ConnectionAttempts:  [Total]      # TCP connection attempts to the gateway
```

Aggregations match the rest of the whitelist: one per metric.
`NetworkConnectivity` is a binary health score; alert on `< 1` for
any data point. `WebSocketMessages` is silent unless the service
hosts WebSocket APIs. `ConnectionAttempts` is useful as a denominator
for `azure_unauthorizedrequests_total / azure_connectionattempts_total`
to derive an attack-attempt ratio.

The Diagnostic-Settings-to-Event-Hubs egress family is broader on
production tiers - `EventHubSuccessfulEvents`, `EventHubTotalFailedEvents`,
`EventHubRejectedEvents`, `EventHubThrottledEvents`,
`EventHubTimedoutEvents`, `EventHubDroppedEvents`. Add the variants
you care about to the whitelist; otherwise stick with the two on the
default whitelist.

## Gateway 429s vs backend 429s

APIM is a frequent source of 429 responses, and distinguishing the
source is essential because the remediation differs.

| Source | Signature | Remediation |
| --- | --- | --- |
| **APIM gateway 429** (rate-limit policy tripped before backend forwarding) | `metadata_GatewayResponseCode: 429` + `metadata_BackendResponseCode: 0` + `metadata_LastErrorReason: RateLimitExceeded` | Tune the `rate-limit-by-key` or `rate-limit` policy - raise the threshold, change the scoping (per-key vs per-IP), or move rate-limit out of APIM into the backend. |
| **Backend 429** (upstream returned 429, APIM forwarded as-is) | `metadata_GatewayResponseCode: 429` + `metadata_BackendResponseCode: 429` + `metadata_LastErrorReason: None` | Investigate upstream capacity. APIM has done its job; the backend is the bottleneck. |
| **Quota policy 429** (Quota or QuotaByKey policy hit, distinct from rate-limit) | `metadata_GatewayResponseCode: 429` + `metadata_BackendResponseCode: 0` + `metadata_LastErrorReason: QuotaExceeded` | Reset the quota window or raise the per-window allowance. Quota is daily / monthly; rate-limit is per-N-seconds. |

All three appear in `azure_otherrequests_total` (the 4xx bucket).
Slicing by `metadata_LastErrorReason` separates them. APIM's default
Developer-tier setup includes a permissive built-in rate-limit on the
`starter` product that trips around 5 sustained requests / second per
subscription key - surprising operators who expect throttling only
when an explicit policy is configured.

## Apps-side instrumentation

This guide is metrics-only. APIM does not produce W3C trace context
spans for the request path through the gateway - there is no current
first-party way to link an inbound client span through the gateway
to the backend span via the OTel receiver.

For end-to-end traces, instrument the client and backend code:

- **Backend service spans.** Auto-instrumented via the OTel agent for
  the language. APIM forwards the inbound request including trace
  headers if the client sent them; the backend span will be a child of
  the client span automatically when `traceparent` propagates.
- **APIM as a "missing middle".** APIM's `Duration` and `BackendDuration`
  metric series fill the gap that traces would otherwise reveal. A
  long `Duration - BackendDuration` interval flags policy-execution
  overhead even though there is no APIM span to drill into.

For per-request audit (which API, which operation, which subscription
key, which client IP, which response code), use Diagnostic Settings
to Log Analytics or Event Hubs - see [Logs](#logs).

## Logs

`GatewayLogs` is one row per inbound request: API, operation, response
code, latency, subscription-key prefix, and client IP. That row-level
detail is what you reach for when you need:

- **Per-operation latency** - operation-level attribution lives in
  logs; metric series carry `ApiId` but not `OperationId`.
- **Percentile aggregations** - Azure Monitor pre-aggregates `Duration`
  as Average / Maximum / Minimum only. p99 and p95 are computed from
  raw per-request samples.
- **Per-key or per-IP audit** - subscription-key prefix, client IP, and
  per-request status code are log-only fields.

APIM publishes three diagnostic log categories:

| Category | What it contains | Volume guidance |
| --- | --- | --- |
| `GatewayLogs` | One row per request, with API + operation + response code + latency + subscription key prefix + client IP. | High - equivalent to one record per inbound request. Sample at the source if cost matters. |
| `WebSocketConnectionLogs` | WebSocket connection lifecycle events. | Low - only emits when WS APIs are configured. |
| `DeveloperPortalAuditLogs` | Developer portal admin operations. | Low - emits per portal admin action. |

The recommended pattern is **Diagnostic Settings → Event Hubs →
`azureeventhubreceiver`** in the same collector. The receiver ingests
events as OTel logs and routes them to Scout via the same
`oauth2client` / `otlphttp/b14` pipeline used for metrics. That
configuration is documented separately and lives in a sibling
fragment under `_shared/azure/scraper/conf.d/`.

Diagnostic Settings → Log Analytics is a viable alternative when
your organisation already centralises in Log Analytics. Scout
ingestion from Log Analytics is supported via the LA query API but
is not covered here.

## Troubleshooting

### `AuthorizationFailed` from the receiver in the first 60 seconds

Symptom: scraper logs `AuthorizationFailed` or `403` shortly after
provisioning. Cause: `Monitoring Reader` was granted but Azure RBAC
is still propagating to the data-plane endpoint. Fix: wait 60-300
seconds. The receiver retries on its next poll cycle. If the error
persists after 5 minutes, verify the role assignment with
`az role assignment list --assignee <sp-app-id> --scope <rg-id>`.

### `metrics_definitions_count: 0` on first poll after provisioning

Symptom: the receiver logs `metrics_definitions_count: 0` and emits
no metrics. Cause: Azure Monitor's metricDefinitions catalog has not
yet populated for the freshly-deployed APIM service (typically true
within 60-180 seconds of `provisioningState: Succeeded`). Fix:
restart the scraper after the APIM service has been up for at least
3 minutes, OR wait 5-10 minutes and the next 60-second poll will
pick up the now-populated catalog.

### `CpuPercent_Gateway` and `MemoryPercent_Gateway` stay silent on Developer

Symptom: the two gateway-resource metrics emit no data points despite
running on Developer (or Basic / Standard / Premium). Cause: Azure
Monitor publishes both at PT5M (5-minute) granularity and only emits
data points when measurable load is present. A freshly-deployed
gateway with sub-second traffic spikes can keep these silent for the
first 10-30 minutes. Fix: drive sustained traffic for at least 10
minutes, then re-check. For the alerting strategy, see
[Alert tuning](#alert-tuning).

### Subscription key 401 after a tier change

Symptom: existing subscription keys return 401 after the APIM service
is moved between tiers. Cause: a tier change on APIM rotates internal
keys for some product or subscription configurations. Fix: re-fetch
the primary key with
`az rest --method post --url
"https://management.azure.com<resource-id>/subscriptions/<sid>/listSecrets?api-version=2023-09-01-preview"`
and update the client application or scraper-env file.

### APIM 429s without a configured rate-limit policy

Symptom: `OtherRequests` shows a high 429 rate even though no explicit
`rate-limit-by-key` policy is defined on the API. Cause: the
auto-created `starter` product on Consumption + Developer tiers
includes a built-in throttle (~5 sustained requests / second per
subscription key) that trips before any user-defined policy runs.
Fix: edit the `starter` product policy to remove or adjust the
built-in `<rate-limit>` element, or move clients to the `unlimited`
product (also auto-created), which does not include the built-in
throttle.

### Bug 45942 case-mismatched dimension keys

Symptom: every series carries both `metadata_apiid` and
`metadata_ApiId`, both `metadata_hostname` and `metadata_Hostname`,
both `metadata_location` and `metadata_Location`, doubling cardinality.
Cause: opentelemetry-collector-contrib bug
[#45942](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45942)
emits the same dimension under two casings on Microsoft.ApiManagement,
Microsoft.Network/azureFirewalls, and a subset of Microsoft.Storage
metrics. Fix: apply the `transform/apim_dim_lowercase` processor in
the [Receiver configuration](#receiver-configuration) snippet. Revisit
when the receiver releases a fix; remove the transform processor at
that time.

### Cardinality blowup on Scout volume

Symptom: Scout query latency degrades after onboarding APIM. Cause:
the `metadata_GatewayResponseCode` × `metadata_BackendResponseCode` ×
`metadata_LastErrorReason` × `metadata_apiid` product can produce
hundreds of series per metric on busy gateways. Fix: apply
`dimensions.overrides` on the noisy metrics - see
[Cardinality control](#cardinality-control).

### Scout OAuth2 returns 401

Symptom: `oauth2client` extension logs 401 from the token endpoint.
Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` / `SCOUT_TOKEN_URL`.
Fix: re-source `~/.config/base14/scout-otel-config.env` (or the
equivalent secret store) and restart the collector. The `oauth2client`
extension caches tokens for the configured TTL; restart is the
fastest invalidation.

## Frequently Asked Questions

### When should I use APIM versus a self-hosted NGINX or Traefik gateway?

Pick APIM when you need policy management at the gateway (per-API
auth, transformation, caching, rate-limiting) without writing code,
or when you need a developer portal for partner / customer API
discovery. Pick a self-hosted gateway when policy is best-expressed
as code, when latency overhead matters more than ergonomics (APIM
adds 5-30 ms per request), or when you already operate Kubernetes
ingress controllers and want telemetry to flow through the same
Prometheus / OpenTelemetry pipeline. Both surface request counts and
latency to Scout via OpenTelemetry; the metric vocabulary differs.

### What changes between Consumption, Developer, and the production tiers for monitoring?

Metric coverage is largely the same across Developer / Basic /
Standard / Premium / Premium v2 - they all publish the universal
counters, latency, capacity, and Diagnostic-Settings-to-Event-Hubs
egress metrics. Consumption is the outlier: it does not publish
`Capacity`, `CpuPercent_Gateway`, `MemoryPercent_Gateway`, or any of
the EventHub-egress family. The whitelist in this guide covers
Consumption + Developer; expand it for production fleets per
[Production-tier additions](#production-tier-additions).

### What metrics are unavailable on Consumption tier?

Five whitelist entries return no data points on Consumption: `Capacity`,
`CpuPercent_Gateway`, `MemoryPercent_Gateway`, `EventHubTotalEvents`,
`EventHubTotalBytesSent`. The first three are gateway-resource metrics
that don't apply to Consumption's serverless model. The last two
require Diagnostic Settings → Event Hubs configuration which works
on Consumption but is rarely set up for the lighter-weight tier.

### How do I detect a slow backend versus a slow APIM policy?

`azure_duration_average` is end-to-end (client request received to
client response sent). `azure_backendduration_average` is just the
backend leg (APIM-to-backend send to backend response received).
The difference, `Duration - BackendDuration`, is APIM's own
overhead - policy execution, transformation, response caching,
inbound / outbound formatting. On a healthy gateway with simple
policies, the difference is sub-10 ms; if it climbs above 50 ms,
investigate policy chain complexity (especially heavy XML / JSON
transformations or external `send-request` policy lookups).

### How does APIM compare to AWS API Gateway for monitoring?

Both are managed gateway products with similar request-counter and
latency surfaces. Monitoring shape differs in collection pattern:
APIM is pulled from Azure Monitor's metricDefinitions API via the
azure_monitor receiver every 60 seconds; AWS API Gateway is pushed
via CloudWatch Metrics Stream into the
awscloudwatchmetricstreamreceiver. Metric coverage is broadly
equivalent (request counts, latency, error rates) with vendor-specific
names. APIM exposes a richer dimension set (especially `LastErrorReason`
which has no AWS equivalent); AWS API Gateway exposes per-method
breakdown directly at the metric level whereas APIM requires logs
for per-operation attribution. Both surfaces flow through the same
OTLP/HTTP exporter to Scout, so multi-cloud gateway dashboards are
unified at query time.

## Reference

- [Microsoft.ApiManagement supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-apimanagement-service-metrics)
- [APIM diagnostic logs
  reference](https://learn.microsoft.com/azure/api-management/api-management-howto-use-azure-monitor)
- [APIM rate-limit and quota
  policies](https://learn.microsoft.com/azure/api-management/api-management-policies#rate-limiting-and-quotas)
- [opentelemetry-collector-contrib
  azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- [Receiver bug #45942 - case-mismatch dimension
  keys](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45942)

## Related Guides

- [Azure Monitoring with OpenTelemetry - Architecture](./overview.md) -
  start here for the cross-surface story.
- [Azure Service Bus](./service-bus.md) - managed message broker for
  queues and topics.
- [Azure Front Door](./front-door.md) - global edge in front of APIM;
  pair both for a full edge-to-origin view.
- [Azure Application Gateway](./application-gateway.md) - regional load
  balancer behind APIM in some VNet topologies.
- [Azure Firewall](./azure-firewall.md) - exhibits the same Bug #45942
  case-mismatch as APIM.
