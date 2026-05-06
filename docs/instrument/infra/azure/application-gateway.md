---
date: 2026-05-06
id: collecting-azure-application-gateway-telemetry
title: Azure Application Gateway Monitoring with OpenTelemetry - Production Wiring for SREs
sidebar_label: Azure Application Gateway
sidebar_position: 7
description: >-
  Add Azure Application Gateway Standard_v2 metrics to your existing
  OpenTelemetry Collector and ship them to base14 Scout. Production-shaped
  guidance on receiver config, TLS termination at the gateway, backend health
  probes, capacity-unit sizing, alert recipes, and the Front Door vs.
  Application Gateway decision.
keywords:
  - azure application gateway monitoring
  - application gateway opentelemetry
  - azure monitor receiver
  - l7 load balancer monitoring
  - backend pool health
  - capacity units
  - application insights alternative
  - base14 scout azure application gateway
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Application Gateway metrics to my OTel Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.Network/applicationGateways, then route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every 60 seconds and emits one OTel metric per Azure aggregation. The collector is read-only against Azure Monitor; it never touches Application Gateway's data plane."}},{"@type":"Question","name":"Should I use Application Gateway Standard_v2 or WAF_v2?","acceptedAnswer":{"@type":"Answer","text":"Standard_v2 if you do not need a Web Application Firewall; WAF_v2 if you need OWASP rule sets, custom WAF rules, bot protection, or rate limiting at the gateway. WAF_v2 emits the same metrics as Standard_v2 plus a family of Azwaf* metrics (AzwafSecRule, AzwafCustomRule, AzwafTotalRequests, BlockedCount, AzwafBotProtection, AzwafPenaltyBoxHits) covering matched-rule counts, mode (Detection vs Prevention), and bot scoring. Add those metrics to the whitelist when targeting WAF_v2; the rest of the receiver config is identical. Standard_v1 is deprecated and not covered by this guide."}},{"@type":"Question","name":"Front Door or Application Gateway - which is right for the metrics use case?","acceptedAnswer":{"@type":"Answer","text":"Different scopes. Front Door (Microsoft.Cdn/profiles) is a global CDN-and-edge service with metrics framed around edge POPs (RequestCount per ClientCountry, OriginHealthPercentage, ByteHitRatio). Application Gateway (Microsoft.Network/applicationGateways) is a regional L7 load balancer with metrics framed around backend pools and listeners (HealthyHostCount per BackendSettingsPool, ApplicationGatewayTotalTime per Listener, BackendResponseStatus per BackendServer). Customers running both - global edge plus regional backend selection - should monitor both surfaces; the receiver fragments coexist in one collector."}},{"@type":"Question","name":"Why does the backend HTTP setting use HTTPS:443 instead of HTTP:80?","acceptedAnswer":{"@type":"Answer","text":"Many production backends - Azure Storage static-website endpoints, App Service, Azure Functions HTTPS-only, External APIs - serve only HTTPS. Application Gateway's default health probe is bound to the backend HTTP setting's protocol and port, so a plain-HTTP probe to an HTTPS-only backend gets a 400 and the backend is marked Unhealthy indefinitely. The standard pattern is to terminate client TLS at the gateway (or accept HTTP from clients in non-public scenarios) and speak HTTPS upstream to the backend. With pickHostNameFromBackendAddress: true, Application Gateway forwards the backend's hostname so SNI cert validation succeeds."}},{"@type":"Question","name":"How does lazy-publishing of metric definitions affect monitoring?","acceptedAnswer":{"@type":"Answer","text":"Azure Monitor publishes metric definitions for Application Gateway lazily. A freshly-provisioned gateway typically surfaces 8-9 of the documented 24 definitions; the rest appear as the underlying behavior begins producing data points (a failed origin probe surfaces UnhealthyHostCount, a non-2XX response surfaces BackendResponseStatus per HttpStatusGroup, etc). Whitelist the broader set anyway so they emit automatically as the gateway ages. The receiver caches the definitions list per container lifetime; if a metric Azure begins publishing mid-run still does not appear in Scout after several scrape cycles, restart the collector to pick up the fresh definition list."}},{"@type":"Question","name":"How does Scout compare to Application Insights for Application Gateway?","acceptedAnswer":{"@type":"Answer","text":"Both surfaces draw from the same Azure Monitor REST API for metrics, so coverage is identical. The differences are commercial and operational: Scout is vendor-neutral OTLP, queryable via SQL, with ingest-volume pricing rather than per-GB ingestion fees; Application Insights uses Kusto Query Language only, is Azure-tenant-bound, and bills for log ingestion alongside metric storage. The collector also unifies multi-cloud surfaces under one pipeline: Application Gateway, Front Door, AWS Application Load Balancer, GCP Cloud Load Balancer all flow through the same exporter."}}]}
---

## Overview

This guide is for engineers running **Azure Application Gateway
Standard_v2** in production who want to add gateway telemetry to an
existing OpenTelemetry Collector and ship it to base14 Scout. The
collector polls Azure Monitor's REST API every 60 seconds for
`Microsoft.Network/applicationGateways` metrics, transforms them to
OTel-style names, and exports via OTLP/HTTP. The collector never touches
Application Gateway's data plane.

The receiver does not connect to Application Gateway directly. It queries
Azure Monitor for any gateway your subscription auto-publishes to, so the
same configuration covers Standard_v2 and WAF_v2 across any number of
listeners, backend pools, and rules per gateway. Standard_v1 is deprecated
and not covered.

This guide is metrics-only. For Application Gateway access logs,
performance logs, firewall logs (WAF_v2), and health-probe logs, see
[Pairing with Diagnostic Settings](#pairing-with-diagnostic-settings).

## Front Door vs Application Gateway

The two surfaces are sometimes confused because both are HTTP-aware
fronts. Different scopes, different metrics:

| Surface | Scope | Metric framing |
| --- | --- | --- |
| [**Azure Front Door**](./front-door.md) (`Microsoft.Cdn/profiles`) | Global CDN + edge | Per-edge: `RequestCount` × `ClientCountry`, `TotalLatency` (edge-to-client), `ByteHitRatio`, `OriginHealthPercentage`. |
| **Azure Application Gateway** (this guide) | Regional L7 load balancer | Per-backend / per-listener: `HealthyHostCount` × `BackendSettingsPool`, `ApplicationGatewayTotalTime` × `Listener`, `BackendResponseStatus` × `BackendServer` × `HttpStatusGroup`. |

Customers running both - global edge in front of regional backend
selection - should monitor both surfaces. The receiver fragments coexist
in a single collector; one Scout exporter serves every Azure surface.

## SKU choice

| SKU | Covered by this guide | Notes |
| --- | --- | --- |
| Standard_v2 | yes | Default for new deployments. 17 metrics in the whitelist below. |
| WAF_v2 | yes (extend the whitelist) | Adds Azwaf* metric family for matched-rule counts, mode, bot protection, and rate limiting. Listed in [WAF_v2 additions](#waf_v2-additions). |
| Standard_v1 | no | Deprecated. Microsoft retired the v1 SKU for new deployments; use v2. |

The remainder of this guide assumes Standard_v2 unless otherwise stated.

## Receiver configuration

Add this fragment to your existing collector config. It contributes the
`azure_auth` extension, an `azure_monitor` receiver, a resource processor,
and a metrics pipeline. Component keys are suffixed `/applicationgateway`
so the fragment composes cleanly with other Azure-surface receivers in the
same collector.

```yaml showLineNumbers title="otel-collector.yaml (Application Gateway addition)"
extensions:
  azure_auth:
    # Pick one of: service_principal, managed_identity, workload_identity.
    # See the Authentication section below for the right choice per
    # collector deployment surface.
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/applicationgateway:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
      # Add more entries to scrape gateways across multiple subscriptions
      # in one collector. Each subscription needs its own Monitoring Reader
      # role assignment on the configured identity; the receiver fans out
      # queries across all subscription x resource-group combinations.
    resource_groups:
      - ${env:APPGATEWAY_RESOURCE_GROUP}
      # Multi-resource-group scoping. Omit resource_groups entirely to
      # scrape every resource group in the listed subscriptions.
    services:
      - Microsoft.Network/applicationGateways
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    # Metrics Data Plane (metrics:getBatch). Raises the per-subscription
    # ceiling from 12k to 360k calls/hour and batches up to 50 resources
    # per call - the only setting that survives a real fleet. RBAC
    # propagates 5-30 min after the Monitoring Reader grant; flip to false
    # as a temporary fallback to the legacy ARM /metrics endpoint if you
    # see persistent 401s after that window. See Scale and rate limits.
    use_batch_api: true
    # Resource-list cache TTL in seconds. Receiver default is 86400 (24h);
    # the right setting for a stable fleet. Lower (e.g. 3600 or 600) only
    # if gateways are added or removed frequently.
    cache_resources: 86400
    dimensions:
      enabled: true
    # Per-metric aggregations matching MS-documented defaults. Empty `[]`
    # requests all five aggregations Azure Monitor publishes for the
    # metric, which can cause rate-limit pressure on high-fanout fleets;
    # explicit single aggregations keep cardinality predictable.
    metrics:
      "Microsoft.Network/applicationGateways":
        # Traffic + latency
        Throughput:                       [average]
        TotalRequests:                    [total]
        FailedRequests:                   [total]
        ResponseStatus:                   [total]
        BytesReceived:                    [total]
        BytesSent:                        [total]
        ApplicationGatewayTotalTime:      [average]
        # Backend health + per-backend response shape
        HealthyHostCount:                 [average]
        UnhealthyHostCount:               [average]
        BackendResponseStatus:            [total]
        BackendConnectTime:               [average]
        BackendFirstByteResponseTime:     [average]
        BackendLastByteResponseTime:      [average]
        AvgRequestCountPerHealthyHost:    [average]
        # Capacity + saturation (Standard_v2 autoscale signals)
        CapacityUnits:                    [average]
        ComputeUnits:                     [average]
        CurrentConnections:               [total]

processors:
  resource/applicationgateway:
    attributes:
      - {key: cloud.provider,    value: azure,                              action: insert}
      - {key: cloud.platform,    value: azure_application_gateway,          action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",     action: insert}
      - {key: cloud.region,      value: "${env:APPGATEWAY_REGION}",         action: insert}
      # cloud.resource_id pins all metrics to one gateway. Drop this line
      # for multi-gateway fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically.
      - {key: cloud.resource_id, value: "${env:APPGATEWAY_RESOURCE_ID}",    action: insert}
      - {key: deployment.environment.name,
                                 value: "${env:DEPLOYMENT_ENVIRONMENT}",    action: insert}
      - {key: service.name,      value: "${env:APPGATEWAY_SERVICE_NAME}",   action: insert}

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/applicationgateway:
      receivers: [azure_monitor/applicationgateway]
      processors: [resource/applicationgateway, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                           # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed
`/applicationgateway` so they coexist with other Azure receivers
(Front Door, Service Bus, Cosmos DB, SQL Database, Storage) in a single
collector. Your Scout exporter (`oauth2client` + `otlphttp/b14`) stays
unchanged; one Scout pipeline serves every Azure surface.

For multi-subscription scoping, the `subscription_ids:` list takes any
number of entries; alternatively set `discover_subscriptions: true` to
scrape every subscription the configured identity has `Monitoring Reader`
on. See [Scale and rate limits](#scale-and-rate-limits).

## Authentication

`azure_auth` supports four modes. Pick the one matching where the
collector runs.

| Collector deployment | Recommended mode | Why |
| --- | --- | --- |
| Azure Kubernetes Service (AKS) pod | `workload_identity` | Federated credential, no secret to rotate, scoped to the ServiceAccount. |
| Container Apps | `managed_identity` (system or user-assigned) | First-class integration, no secret to rotate. |
| Virtual Machine Scale Sets / Azure VM | `managed_identity` (user-assigned) | User-assigned identity survives instance replacement; the system-assigned identity dies with the VM or scale-set instance. |
| External or on-prem | `service_principal` | Only option without an Azure-resident identity. |
| Local dev / ad-hoc | `use_default: true` | Falls back to the Azure SDK default credential chain (CLI, env, managed identity). |

The auth setup, RBAC scope, and credential-rotation guidance is identical
across the Azure surfaces. See the Service Bus guide's
[Authentication](./service-bus.md#authentication) section for the
mode-by-mode YAML and the
[Service principal credential lifecycle](./service-bus.md#service-principal-credential-lifecycle)
section for rotation procedures.

`Monitoring Reader` at the resource group containing your gateways is
sufficient and minimal. The role grants read on metric definitions and
metric data only, no control-plane write. `Reader` is not required.

```bash
RG_ID=$(az group show --name <appgw-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId or principalId> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

For multi-subscription fleets, repeat per subscription. RBAC propagation
on the legacy ARM `/metrics` endpoint is immediate; the data-plane batch
API at `*.metrics.monitor.azure.com` lags 5-30 minutes after grant.
This guide defaults `use_batch_api: true`; if the data plane is still
401-ing past that window, flip to `false` as a temporary fallback to the
legacy ARM `/metrics` endpoint (RBAC there is immediate).

## What you'll monitor

Seventeen metrics from `Microsoft.Network/applicationGateways`. The
receiver renames them from Azure's PascalCase (e.g.
`ApplicationGatewayTotalTime`) to OTel-style
`azure_<lowercased>_<aggregation>` (e.g.
`azure_applicationgatewaytotaltime_average`).

Every metric is whitelisted with its single MS-documented default
aggregation. Empty `[]` (= all five aggregations) doubles or triples
cardinality without adding signal: `_count` and `_total` on a duration
metric are sums of latency values themselves and have no physical meaning;
`_total` on a gauge-style metric (`HealthyHostCount`, `CapacityUnits`) is
a sum of point-in-time samples and is similarly meaningless.

| Azure REST name | OTel emitted | Unit | Splits by | What it tells you |
| --- | --- | --- | --- | --- |
| `Throughput` | `azure_throughput_average` | BytesPerSecond | (none) | Bytes-per-second the gateway is moving end-to-end. Capacity-utilization signal. |
| `TotalRequests` | `azure_totalrequests_total` | Count | `BackendSettingsPool` | Successful requests served per minute, split by the backend-pool + HTTP-setting combination. |
| `FailedRequests` | `azure_failedrequests_total` | Count | `BackendSettingsPool` | Requests the gateway could not satisfy (no healthy backend, timeout, etc.). Sustained > 0 is a page. |
| `ResponseStatus` | `azure_responsestatus_total` | Count | `HttpStatusGroup` | Per-status-class response counts (`2XX` / `3XX` / `4XX` / `5XX`). Pair with `BackendResponseStatus` to attribute 5XX to gateway vs origin. |
| `BytesReceived` | `azure_bytesreceived_total` | Bytes | `Listener` | Client → gateway bytes, per listener. Useful for ingress-traffic dashboards. |
| `BytesSent` | `azure_bytessent_total` | Bytes | `Listener` | Gateway → client bytes, per listener. Pair with `BytesReceived` for response-size sanity. |
| `ApplicationGatewayTotalTime` | `azure_applicationgatewaytotaltime_average` | MilliSeconds | `Listener` | End-to-end latency from gateway-receives-first-byte to gateway-finishes-sending-response. The user-perceived number; primary SLO metric. |
| `HealthyHostCount` | `azure_healthyhostcount_average` | Count | `BackendSettingsPool` | Number of backend hosts passing the health probe. Below your steady-state count means a backend is failing the probe. |
| `UnhealthyHostCount` | `azure_unhealthyhostcount_average` | Count | `BackendSettingsPool` | Inverse of `HealthyHostCount`. > 0 = at least one backend failing the probe. |
| `BackendResponseStatus` | `azure_backendresponsestatus_total` | Count | `BackendServer` × `BackendPool` × `BackendHttpSetting` × `HttpStatusGroup` | Per-backend status code distribution. The most useful 5XX-triage metric: which backend is returning errors? |
| `BackendConnectTime` | `azure_backendconnecttime_average` | MilliSeconds | `BackendServer` × `BackendPool` × `BackendHttpSetting` × `Listener` | Time to establish a connection with a backend. Slow values point at network or TLS-handshake issues. |
| `BackendFirstByteResponseTime` | `azure_backendfirstbyteresponsetime_average` | MilliSeconds | (same as `BackendConnectTime`) | Time-to-first-byte from the backend, approximates backend processing time. |
| `BackendLastByteResponseTime` | `azure_backendlastbyteresponsetime_average` | MilliSeconds | (same as `BackendConnectTime`) | Time-to-last-byte from the backend. Subtract `BackendFirstByteResponseTime` for response-streaming time. |
| `AvgRequestCountPerHealthyHost` | `azure_avgrequestcountperhealthyhost_average` | Count | `BackendSettingsPool` | Per-minute load each healthy backend host is carrying. Useful when one backend in a pool starts showing latency spikes - confirms the load was even. |
| `CapacityUnits` | `azure_capacityunits_average` | Count | (none) | Gateway-side compute units consumed. Standard_v2 charges per CU/hour; this is the line-item driver. |
| `ComputeUnits` | `azure_computeunits_average` | Count | (none) | Internal CPU+memory metric used by the autoscaler. Stays close to `CapacityUnits` under steady load. |
| `CurrentConnections` | `azure_currentconnections_total` | Count | (none) | Active TCP connections to the gateway. Sudden spikes can indicate a misbehaving client opening connections in a loop. |

`metadata_*` dimensions ride alongside every metric: `metadata_Listener`,
`metadata_BackendSettingsPool`, `metadata_BackendServer`,
`metadata_BackendPool`, `metadata_BackendHttpSetting`,
`metadata_HttpStatusGroup`. Receiver-injected attributes also appear:
`azuremonitor.resource_id`, `azuremonitor.subscription_id`, `name`,
`type`, `resource_group`, `location`. These are the most useful axes for
Scout dashboards (per-listener latency, per-backend error rate,
per-status-group response counts).

### Lazy-published metrics

Azure Monitor publishes definitions for some metrics only after the
underlying condition first occurs. On a brand-new gateway with no
history, the receiver typically reports `metrics_definitions_count: 8-9`
of the 17 whitelisted entries. The remainder appear once Azure has data
points to back them: `BackendResponseStatus` per `HttpStatusGroup` after
the first non-2XX response, `UnhealthyHostCount` after the first probe
failure, the `Backend*Time` family after the first backend hit, etc.
Production gateways with weeks of mixed traffic surface the full set
immediately.

The whitelist intentionally keeps all 17 so they start emitting
automatically once Azure publishes their definitions. **Receiver caches
the definitions list per container lifetime**: when Azure begins
publishing a definition mid-run (e.g., the first 502 generates
`BackendResponseStatus` per `5XX`), a long-running collector continues
emitting only what it cached at startup until the cache TTL expires or
the collector restarts. If you expect a metric to appear after a known
condition and it does not within 30 minutes, restart the collector - the
next discovery cycle picks up the fresh definition list.

`CpuUtilization` from the MS metric reference is *not* in the whitelist.
Azure Monitor does not publish a metric definition for it on Standard_v2
deployments; it appears in the documentation but the resource-level
`metrics:list-definitions` response does not include it. Add it to the
whitelist if your fleet starts surfacing the definition (a receiver
restart picks up newly-published definitions).

## Backend protocol and health probes

Application Gateway's default health probe binds to the backend HTTP
setting's protocol and port. **A plain-HTTP probe to an HTTPS-only
backend gets a 400 response**, marks the backend `Unhealthy`
indefinitely, and your `HealthyHostCount` sticks at 0. Common
HTTPS-only backends are Azure Storage static-website endpoints, App
Service with HTTPS-only enabled, Azure Functions, and most third-party
APIs.

The standard topology terminates client TLS at Application Gateway and
speaks HTTPS upstream:

```bicep
backendHttpSettingsCollection: [
  {
    name: 'appGwBackendHttpSettings'
    properties: {
      port: 443
      protocol: 'Https'
      cookieBasedAffinity: 'Disabled'
      requestTimeout: 30
      // Forward backend's hostname so SNI cert validation succeeds and
      // the backend's host-routing matches the request.
      pickHostNameFromBackendAddress: true
    }
  }
]
```

For backends that genuinely speak only HTTP (legacy services, internal
admin tools), use a custom health probe with an explicit
`match.statusCodes` range that accepts the actual probe response, rather
than relying on the default probe's `200-399` band.

When the backend is `Unhealthy`, the gateway returns 502 to clients -
visible as `azure_responsestatus_total{metadata_httpstatusgroup="5XX"}`
even though no request reached the backend. Pair `HealthyHostCount` and
`ResponseStatus 5XX` on the same dashboard to distinguish gateway-side
failures from backend-side failures.

## Verification

After applying the fragment and restarting the collector, three signals
confirm the pipeline is healthy.

**1. Receiver discovers your gateway.** Within 30 seconds of collector
startup (or reload), one line per discovery phase appears in the logs:

```text
azuremonitorreceiver ... "Loaded the list of Azure Subscriptions" subscriptions_count=1
azuremonitorreceiver ... "Loaded the list of Azure Resources" resources_count=1
azuremonitorreceiver ... "Loaded the list of Azure Metrics Definitions" metrics_definitions_count=8
azuremonitorreceiver ... "Loaded the Azure Metrics" resource_id=/subscriptions/.../applicationGateways/<your-appgw>
```

`subscriptions_count` and `resources_count` should match your scope.
`metrics_definitions_count` should approach 17 on a production gateway;
fresh gateways surface only 8-9 (see [Lazy-published
metrics](#lazy-published-metrics)). A wrong resource count, or a
`metrics_definitions_count` of 0, indicates a configuration or RBAC
issue; see [Troubleshooting](#troubleshooting).

**2. Data points reach Scout.** Confirm via the collector's self-metrics
on `:8888/metrics`:

```bash
curl -s http://<collector-host>:8888/metrics \
  | grep -E "(azure_monitor.applicationgateway|otlp.*b14)"
```

The receiver-accepted and exporter-sent counters should grow together
(data flows end-to-end); `otelcol_exporter_send_failed_metric_points_total`
should stay at zero.

**3. Series visible in Scout.** Filter on either of:

- `service.name = application-gateway-monitor` (or whatever you set
  `${APPGATEWAY_SERVICE_NAME}` to).
- `cloud.platform = azure_application_gateway`.

Initial series on a gateway with traffic: `azure_throughput_average`,
`azure_totalrequests_total`, `azure_responsestatus_total`,
`azure_healthyhostcount_average`. Group by `metadata_HttpStatusGroup` to
split 2XX vs 4XX vs 5XX. Group by `metadata_BackendSettingsPool` for
per-pool error rates and host counts.

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST API.
Azure Monitor enforces two ceilings:

| Endpoint | Rate limit | When it applies |
| --- | --- | --- |
| Data-plane batch (`use_batch_api: true`) | 360,000 calls / hour / subscription | Default in this guide. RBAC lags 5-30 min after the Monitoring Reader grant. |
| Legacy ARM `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Temporary fallback if the data plane is still 401-ing after RBAC propagation should have completed. Immediate RBAC propagation. |

At a 60-second collection interval, a single gateway costs roughly 60
calls per hour (one per metric per poll, deduplicated within the
receiver). Even small fleets (5-10 gateways) benefit from
`use_batch_api: true` because batched fan-out is more rate-limit-friendly
across collectors that share a subscription.

For multi-subscription discovery without an explicit list:

```yaml
receivers:
  azure_monitor/applicationgateway:
    discover_subscriptions: true   # any sub the identity has Monitoring Reader on
    services: [Microsoft.Network/applicationGateways]
    auth: { authenticator: azure_auth }
    use_batch_api: true            # 360k/h ceiling per sub
    cache_resources: 86400         # receiver default (24h)
```

The receiver shares one rate-limit budget across all subscriptions in the
list. Splitting heavy subscriptions across separate collector instances
lifts the aggregate ceiling linearly.

## Cardinality control

By default the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. The
17-metric whitelist with single aggregations produces ~17 base series per
gateway, multiplied by the dimension fan-out:

- `BackendSettingsPool` × N backend pools × M HTTP settings.
- `BackendServer` × N backend pools × M HTTP settings × K backends per pool.
- `Listener` × number of listeners.
- `HttpStatusGroup` × 4 (`2XX`, `3XX`, `4XX`, `5XX`).

A 50-gateway fleet averaging 5 backend pools of 4 hosts each, with one
listener each, produces roughly:

```text
17 base × 4 status × 4 backends × 5 pools × 50 gateways ≈ 68,000 active series
```

The dominant fan-out factor is `BackendServer` × `HttpStatusGroup` on
`BackendResponseStatus`. Three control levers, in order of preference:

1. **`dimensions.overrides`** drops or whitelists dimensions per metric.
   Keep `BackendServer` only on `BackendResponseStatus` and the
   `Backend*Time` family; drop it on `HealthyHostCount` and
   `UnhealthyHostCount` where pool-level aggregation is enough.

   ```yaml
   azure_monitor/applicationgateway:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.Network/applicationGateways":
           HealthyHostCount:
             - BackendSettingsPool
           UnhealthyHostCount:
             - BackendSettingsPool
           BackendResponseStatus:
             - BackendServer
             - HttpStatusGroup
           BackendConnectTime:
             - BackendServer
   ```

2. **Drop low-signal metrics on noisy gateways.** `BytesReceived` /
   `BytesSent` per listener and `ComputeUnits` are the lowest-signal
   members of the whitelist for incident response; remove them on
   gateways where dashboard density matters more than capacity reporting.

3. **Per-fleet receiver instances.** Split high-cardinality gateways
   into separate `azure_monitor/applicationgateway-prod` and
   `azure_monitor/applicationgateway-quiet` receivers with different
   override profiles. Both contribute to the same
   `metrics/applicationgateway` pipeline.

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric on
the collector's Prometheus endpoint (port 8888 by default) to see actual
cardinality after `overrides` apply.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting
points; derive your own from observed 99th percentile over a
representative week.

`azure_failedrequests_total` and `azure_responsestatus_total` (5XX
bucket) only emit data points when their condition occurs
(silent-when-quiet). Wire those alerts on series presence in window, not
on numeric thresholds.

| Metric (OTel name) | Warning | Critical | Why it matters |
| --- | --- | --- | --- |
| `azure_unhealthyhostcount_average` (per `BackendSettingsPool`) | > 0 for 2 min | sustained > 0 for 10 min | Below 100% pool health. Above ~50% means user requests are likely failing too. |
| `azure_responsestatus_total{metadata_httpstatusgroup="5XX"}` | > 0 over 5 min | > 0 over 15 min | Sustained 5XX at the gateway. Cross-check with `BackendResponseStatus 5XX` to attribute to gateway vs origin. |
| `azure_failedrequests_total` | > 0 over 5 min | > 0 over 15 min | Gateway could not satisfy a request (no healthy backend, timeout). Often paired with `UnhealthyHostCount > 0`. |
| `azure_applicationgatewaytotaltime_average` (per `Listener`) | > P99 baseline | sustained > 2x P99 baseline | User-perceived latency anomaly. Pair with `BackendFirstByteResponseTime` to identify origin-side vs gateway-side latency. |
| `azure_capacityunits_average` | > 80% of `maxCapacity` | > 95% of `maxCapacity` | Gateway approaching its autoscale ceiling. Raise `maxCapacity` or split traffic. |
| `azure_currentconnections_total` (per gateway) | > 5x baseline / 15 min | sustained > 10x | Misbehaving client opening connections in a loop. Set baseline from a steady-state week. |

### RED method on the gateway

If you run Application Gateway as part of a service backed by SLOs, frame
its metrics as RED (rate, errors, duration) at the gateway:

- **Rate.** `azure_totalrequests_total` per gateway, sliced by
  `BackendSettingsPool`.
- **Errors.** Two SLIs:
  - **Gateway-availability error rate** =
    `(azure_failedrequests_total + azure_responsestatus_total{5XX}) /
    azure_totalrequests_total`. A spike here is "gateway or capacity
    envelope is broken"; route to platform on-call.
  - **Backend-availability error rate** =
    `azure_backendresponsestatus_total{5XX} /
    azure_backendresponsestatus_total`. A spike here is "the origin
    services are broken"; route to the owning service team.
- **Duration.** `azure_applicationgatewaytotaltime_average` per
  `Listener` for total user-perceived latency;
  `azure_backendfirstbyteresponsetime_average` per `BackendServer` for
  origin-side latency.

For saturation (the U in USE), pair `azure_capacityunits_average` /
`maxCapacity` and `azure_currentconnections_total` per gateway.

## WAF_v2 additions

WAF_v2 emits the same metrics as Standard_v2 plus a family of WAF
metrics. When the gateway is WAF_v2, extend the whitelist:

```yaml
metrics:
  "Microsoft.Network/applicationGateways":
    # ...all 17 from the Standard_v2 set above...
    AzwafTotalRequests:                  [total]   # Total requests evaluated by WAF
    AzwafSecRule:                        [total]   # Matched managed rules
    AzwafCustomRule:                     [total]   # Matched custom rules
    AzwafBotProtection:                  [total]   # Bot-protection matches
    BlockedCount:                        [total]   # WAF-blocked requests by RuleGroup x RuleId
    MatchedCount:                        [total]   # All matched rule distributions
    AzwafPenaltyBoxHits:                 [total]
    AzwafPenaltyBoxSize:                 [average]
    AzWAFCaptchaChallengeRequestCount:   [total]
    AzWAFJSChallengeRequestCount:        [total]
```

Most WAF metrics carry `Action` (`Block` / `Allow` / `Log`), `Mode`
(`Detection` / `Prevention`), `PolicyName`, `PolicyScope`, and
`RuleGroup` / `RuleID` dimensions. These multiply cardinality fast on a
high-traffic gateway; apply `dimensions.overrides` to pin to the axes
your security team uses.

`MatchedCount` and `BlockedCount` are the headline operational metrics
for a WAF-in-detection-mode rollout. Track the ratio
`BlockedCount / MatchedCount` to see how many matched-rule events are
actually being blocked vs logged.

## Pairing with Diagnostic Settings

This guide ships metrics. For Application Gateway access logs,
performance logs, firewall logs (WAF_v2), and health-probe logs,
configure `Microsoft.Insights/diagnosticSettings` on the gateway:

- Forward `ApplicationGatewayAccessLog`,
  `ApplicationGatewayPerformanceLog`, and
  `ApplicationGatewayHealthProbeLog` (and
  `ApplicationGatewayFirewallLog` on WAF_v2) to Log Analytics or Event
  Hubs.
- Pipe Event Hubs into the collector via the `azure_event_hub` receiver
  for log-side ingestion to Scout.

The two paths are complementary: metrics for SLI / SLO dashboards and
alerts, logs for per-request investigation.

## Troubleshooting

**`HealthyHostCount` stuck at 0 but the backend is reachable directly.**
Backend HTTP setting protocol/port mismatch with the backend. The
default health probe inherits `protocol` and `port` from the HTTP
setting; an HTTP probe to an HTTPS-only backend gets a 400 and is
treated as unhealthy. Switch the HTTP setting to `protocol: Https` /
`port: 443` (or define a custom probe with a permissive
`match.statusCodes` band). See [Backend protocol and health
probes](#backend-protocol-and-health-probes).

**`AuthorizationFailed` from the receiver.** Legacy ARM `/metrics`
endpoint propagates `Monitoring Reader` immediately; data-plane batch
API can lag 5-30 minutes. If `use_batch_api: true` is set and you've
just granted the role, temporarily flip to `false` to confirm the role
itself is correct. If using a service principal, check that the client
secret has not expired (`az ad app credential list --id $AZURE_CLIENT_ID`).

**`metrics_definitions_count` is 8 or 9, not 17.** Expected on a
brand-new gateway; Azure Monitor lazy-publishes definitions per metric
based on emit history. See [Lazy-published
metrics](#lazy-published-metrics). Production gateways with weeks of
history surface the full set immediately.

**`BackendResponseStatus` for the 5XX bucket does not appear after the
first 502.** Receiver caches the definitions list per container
lifetime. Restart the collector; the next discovery cycle picks up the
fresh definition.

**`RequestThrottled` warnings from the receiver.** You have hit Azure
Monitor's per-subscription rate ceiling (12,000 / hour on legacy or
360,000 / hour on batch). Lower polling rate
(`collection_interval: 120s`), narrow scope (list specific
`resource_groups:`), or split heavy subscriptions across multiple
collector instances. `use_batch_api: true` is already the default in
this guide.

**Scout OAuth2 returns 401.** Verify `SCOUT_CLIENT_ID`,
`SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL` match the values in your
Scout console. The `endpoint_params.audience` must be `b14collector`.

**`dial tcp: lookup login.microsoftonline.com: network is unreachable`**
on first scrape after a sibling collector restart. Docker Desktop DNS
glitch. Recreate the collector container
(`docker compose down && docker compose up`) to refresh the resolver.

## Frequently Asked Questions

### How do I add Azure Application Gateway metrics to my OTel Collector?

Add the `azure_auth` extension and an `azure_monitor` receiver scoped to
`Microsoft.Network/applicationGateways`, then route the receiver into a
metrics pipeline that exports to Scout via the
`oauth2client`-authenticated OTLP/HTTP exporter. The receiver polls
Azure Monitor's REST API every 60 seconds and emits one OTel metric per
Azure aggregation. The collector is read-only against Azure Monitor; it
never touches Application Gateway's data plane.

### Should I use Application Gateway Standard_v2 or WAF_v2?

Standard_v2 if you do not need a Web Application Firewall; WAF_v2 if
you need OWASP rule sets, custom WAF rules, bot protection, or rate
limiting at the gateway. WAF_v2 emits the same metrics as Standard_v2
plus a family of `Azwaf*` metrics covering matched-rule counts, mode
(Detection vs Prevention), and bot scoring. Add those metrics to the
whitelist when targeting WAF_v2; the rest of the receiver config is
identical. Standard_v1 is deprecated and not covered by this guide.

### Front Door or Application Gateway - which is right for the metrics use case?

Different scopes. [Front Door](./front-door.md)
(`Microsoft.Cdn/profiles`) is a global CDN-and-edge service with metrics
framed around edge POPs (`RequestCount` per `ClientCountry`,
`OriginHealthPercentage`, `ByteHitRatio`). Application Gateway
(`Microsoft.Network/applicationGateways`) is a regional L7 load balancer
with metrics framed around backend pools and listeners
(`HealthyHostCount` per `BackendSettingsPool`,
`ApplicationGatewayTotalTime` per `Listener`,
`BackendResponseStatus` per `BackendServer`). Customers running both -
global edge plus regional backend selection - should monitor both
surfaces; the receiver fragments coexist in one collector.

### Why does the backend HTTP setting use HTTPS:443 instead of HTTP:80?

Many production backends - Azure Storage static-website endpoints, App
Service, Azure Functions HTTPS-only, external APIs - serve only HTTPS.
Application Gateway's default health probe is bound to the backend HTTP
setting's protocol and port, so a plain-HTTP probe to an HTTPS-only
backend gets a 400 and the backend is marked `Unhealthy` indefinitely.
The standard pattern is to terminate client TLS at the gateway (or
accept HTTP from clients in non-public scenarios) and speak HTTPS
upstream to the backend. With `pickHostNameFromBackendAddress: true`,
Application Gateway forwards the backend's hostname so SNI cert
validation succeeds.

### How does lazy-publishing of metric definitions affect monitoring?

Azure Monitor publishes metric definitions for Application Gateway
lazily. A freshly-provisioned gateway typically surfaces 8-9 of the
documented 24 definitions; the rest appear as the underlying behavior
begins producing data points (a failed origin probe surfaces
`UnhealthyHostCount`, a non-2XX response surfaces
`BackendResponseStatus` per `HttpStatusGroup`, etc.). Whitelist the
broader set anyway so they emit automatically as the gateway ages. The
receiver caches the definitions list per container lifetime; if a
metric Azure begins publishing mid-run still does not appear in Scout
after several scrape cycles, restart the collector to pick up the fresh
definition list.

### How does Scout compare to Application Insights for Application Gateway?

Both surfaces draw from the same Azure Monitor REST API for metrics, so
coverage is identical. The differences are commercial and operational:
Scout is vendor-neutral OTLP, queryable via SQL, with
ingest-volume pricing rather than per-GB ingestion fees; Application
Insights uses Kusto Query Language only, is Azure-tenant-bound, and
bills for log ingestion alongside metric storage. The collector also
unifies multi-cloud surfaces under one pipeline: Application Gateway,
Front Door, AWS Application Load Balancer, GCP Cloud Load Balancer all
flow through the same exporter.

## Reference

- **Receiver source.**
  [opentelemetry-collector-contrib / receiver /
azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver).
- **Auth extension source.**
  [opentelemetry-collector-contrib / extension /
azureauthextension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/azureauthextension).
- **Azure Monitor metric reference.**
  [Microsoft.Network/applicationGateways
metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-applicationgateways-metrics).

## Related Guides

- [Azure Front Door](./front-door.md) - sister edge service; same
  `azure_monitor` pattern, global-CDN metric framing.
- [Azure Service Bus](./service-bus.md) - same `azure_monitor` receiver
  pattern, messaging surface.
- [Azure SQL Database](./sql-database.md) - same auth + RBAC shape,
  relational PaaS surface.
- [Azure Cosmos DB](./cosmos-db.md) - same fragment composition,
  RU-based metrics.
- [Azure Kubernetes Service](./aks.md) - operator-managed collectors for
  in-cluster `kubeletstats`, `k8s_cluster`, and optional `azure_monitor`
  control-plane metrics.
