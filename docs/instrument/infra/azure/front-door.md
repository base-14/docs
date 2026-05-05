---
date: 2026-05-04
id: collecting-azure-front-door-telemetry
title: Azure Front Door Monitoring with OpenTelemetry - Production Wiring for SREs
sidebar_label: Azure Front Door
sidebar_position: 6
description: >-
  Add Azure Front Door Standard metrics to your existing OpenTelemetry
  Collector and ship them to base14 Scout. Production-shaped guidance on
  receiver config, the explicit-aggregation workaround for receiver issue
  #43648, cache configuration for byte-hit-ratio visibility, alert
  recipes, and cardinality control.
keywords:
  - azure front door monitoring
  - front door opentelemetry
  - azure monitor receiver
  - cdn opentelemetry
  - byte hit ratio
  - edge latency
  - origin health percentage
  - front door rules engine
  - application insights alternative
  - base14 scout azure front door
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Front Door metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.Cdn/profiles, then route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every 60 seconds. Each metric in the whitelist must declare a single MS-documented default aggregation; the receiver's all-aggregations default triggers 501 Sampling type is not found errors on Microsoft.Cdn/profiles per upstream issue #43648."}},{"@type":"Question","name":"Why is the metrics whitelist mandatory for Front Door, when Cosmos and Service Bus accept empty aggregation lists?","acceptedAnswer":{"@type":"Answer","text":"Open issue azuremonitorreceiver #43648. The receiver's default aggregation set (Average,Count,Maximum,Minimum,Total) requests aggregations Azure Monitor does not publish for some Front Door metrics. Azure responds with 501 Not Implemented and the receiver burns rate-limit budget retrying. The maintainer-validated workaround is an explicit per-metric aggregation list matching each metric's MS-documented default. This guide ships the workaround in the receiver fragment."}},{"@type":"Question","name":"Why does ByteHitRatio not show up on a fresh profile?","acceptedAnswer":{"@type":"Answer","text":"Front Door honors the origin's Cache-Control header by default. Origins that return Cache-Control: no-store (Azure Storage static-website is one example) make Front Door treat every request as cache-uncacheable, and ByteHitRatio emits no data points. To surface it either configure the origin to return a meaningful Cache-Control value (max-age=...), or attach a Front Door Rules Engine RouteConfigurationOverride action that sets cacheBehavior: OverrideAlways with an explicit cacheDuration. The route also needs --enable-caching true."}},{"@type":"Question","name":"Why does the Azure Monitor metrics-list-definitions REST endpoint return only a subset of the documented Front Door metrics for a fresh profile?","acceptedAnswer":{"@type":"Answer","text":"Azure Monitor lazy-publishes metric definitions per resource based on emit history. Brand-new Front Door profiles surface only the always-on subset (RequestCount, ResponseSize, TotalLatency, ByteHitRatio); the rest (OriginHealthPercentage, OriginLatency, OriginRequestCount, RequestSize, Percentage4XX, Percentage5XX) appear once they have at least one data point. Whitelist the broader set anyway so they emit automatically as the profile ages."}},{"@type":"Question","name":"Why does Front Door require a Pay-As-You-Go subscription?","acceptedAnswer":{"@type":"Answer","text":"Microsoft.Cdn/profiles is on Microsoft's Free-Trial-excluded resource type list. Provisioning fails with BadRequest: Free Trial and Student account is forbidden for Azure Frontdoor resources during the Bicep deploy. Cosmos DB, Azure SQL Database, and Service Bus are eligible on Free Trial; only Front Door (and likely Application Gateway) require PAYG. Production customers running existing Front Door profiles are already on PAYG."}},{"@type":"Question","name":"Why does deploymentStatus stay NotStarted after the endpoint starts serving traffic?","acceptedAnswer":{"@type":"Answer","text":"The deploymentStatus field on Microsoft.Cdn/afdEndpoints, /routes, and /origins is unreliable as a propagation indicator on Azure Front Door Standard. Validation runs have observed it remaining NotStarted indefinitely while the FD edge correctly serves traffic. Use the actual endpoint behavior (a successful HTTPS GET to <endpoint>.azurefd.net returning the origin response) as the propagation gate, not the API field."}}]}
---

## Overview

This guide is for engineers running **Azure Front Door Standard** in
production who want to add Front Door telemetry to an existing
OpenTelemetry Collector and ship it to base14 Scout. The collector polls
Azure Monitor's REST API every 60 seconds for `Microsoft.Cdn/profiles`
metrics, transforms them to OTel-style names, and exports via OTLP/HTTP.
The collector never touches Front Door's data plane.

The receiver does not connect to Front Door directly. It queries Azure
Monitor for metrics any Front Door profile auto-publishes, so the same
configuration covers Standard and Premium tiers and any number of
endpoints, origins, and routes per profile. Premium-only WAF metrics
(`WebApplicationFirewallRequestCount` and friends) are excluded from the
default whitelist; add them when targeting Premium.

Front Door **Classic** (`Microsoft.Network/frontDoors`) is deprecated
for new customers and is NOT covered by this guide. See [Microsoft's
Classic-to-Standard migration
guide](https://learn.microsoft.com/azure/frontdoor/tier-migration) if
you are still on Classic; the `azure_monitor` receiver supports it via
a different `services:` value, but the metric namespace and aggregations
differ.

This guide is metrics-only. For per-request access logs, Web Application
Firewall logs, and health-probe logs, see [Pairing with Diagnostic
Settings](#pairing-with-diagnostic-settings).

## What you'll monitor

Ten metrics from `Microsoft.Cdn/profiles`. The receiver renames them
from Azure's PascalCase (e.g., `RequestCount`) to OTel-style
`azure_<lowercased>_<aggregation>` (e.g., `azure_requestcount_total`).

**Each metric uses a single MS-documented default aggregation** to work
around upstream receiver issue
[#43648](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/43648):
the receiver's default of all five aggregations triggers
`501 Sampling type is not found` from Azure Monitor for metrics that
publish only a subset. Per-metric aggregations are mandatory.

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `RequestCount` | `azure_requestcount_total` | Count | Per-minute request rate at the edge. Splits by `metadata_HttpStatusGroup` (`2XX` / `3XX` / `4XX` / `5XX`), `metadata_ClientCountry`, `metadata_ClientRegion`. |
| `ResponseSize` | `azure_responsesize_total` | Bytes | Bytes returned to clients. Pair with `RequestCount` for average response size by status group. |
| `TotalLatency` | `azure_totallatency_average` | MilliSeconds | Edge-to-client latency. The user-perceived number; primary SLO metric. |
| `ByteHitRatio`† | `azure_bytehitratio_average` | Percent | Fraction of bytes served from edge cache. Emits no data points when origin headers prevent caching; see [Cache configuration](#cache-configuration). |
| `RequestSize`‡ | `azure_requestsize_total` | Bytes | Bytes received from clients (typically request headers + body). |
| `OriginRequestCount`‡ | `azure_originrequestcount_total` | Count | Requests Front Door forwarded to origin (cache misses + fills). `RequestCount` minus `OriginRequestCount` is your cache-shielded request count. |
| `OriginLatency`‡ | `azure_originlatency_average` | MilliSeconds | Origin-side latency for cache misses. Subtract from `TotalLatency` to estimate edge processing time. |
| `OriginHealthPercentage`‡ | `azure_originhealthpercentage_average` | Percent | Probe-driven origin health. Drops below 100% when health-probe requests fail; useful for origin-fleet alerting. |
| `Percentage4XX`‡ | `azure_percentage4xx_average` | Percent | 4XX rate at the edge. Pair with `metadata_HttpStatus` to find the dominant 4XX code. |
| `Percentage5XX`‡ | `azure_percentage5xx_average` | Percent | 5XX rate at the edge. Sustained `> 0` is a page. |

**`†` cache-conditional.** `ByteHitRatio` emits no data points when
the origin returns `Cache-Control: no-store` (or any directive that
prevents caching). Production origins serving cacheable static assets
surface this metric without intervention; see [Cache
configuration](#cache-configuration) for the override path when origin
headers cannot be changed.

**`‡` lazy-published.** Azure Monitor publishes definitions for these
metrics only after the underlying condition first occurs (a failed
origin probe, a 4XX response, a cache miss with origin pull, etc.). On
brand-new profiles with no history, the receiver typically reports
`metrics_definitions_count: 3-4` instead of 10. The remaining metrics
appear once Azure has data points to back them; the lag depends on
traffic shape (an origin-error metric does not surface without origin
errors, a 4XX-rate metric does not surface without 4XX responses,
etc.). Profiles with weeks of mixed production traffic surface the
full set. See [Receiver behavior on a brand-new
profile](#receiver-behavior-on-a-brand-new-profile) for the
operational follow-up.

`metadata_*` dimensions ride alongside every metric:
`metadata_ClientCountry`, `metadata_ClientRegion`, `metadata_Endpoint`,
`metadata_HttpStatus`, `metadata_HttpStatusGroup`. These are the most
useful axes for Scout dashboards (per-country latency, per-status-code
error rate, per-endpoint traffic split). See [Cardinality
control](#cardinality-control) before enabling all of them on a
high-traffic fleet.

## Prerequisites

| Requirement | Minimum |
| --- | --- |
| Existing Front Door profile | Standard SKU (`Standard_AzureFrontDoor`) or Premium. |
| Azure subscription | Pay-As-You-Go (Free Trial excludes `Microsoft.Cdn/profiles` entirely). |
| OTel Collector | contrib v0.148.0+ (snake_case YAML keys). |
| `Microsoft.Cdn` provider | registered on the subscription. |
| Service principal or managed identity | with `Monitoring Reader` on the FD profile's resource group. |
| base14 Scout | any tenant. |

This guide is the Front-Door-specific addition to a working
OpenTelemetry Collector. For collector deployment + the Scout exporter
pieces (which are the same for every Azure surface), see:

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md), or
  [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) /
  [Linux Setup](../../collector-setup/linux-setup.md) for other runtimes.
- [Scout Exporter](../../collector-setup/scout-exporter.md) for the OAuth2 +
  OTLP/HTTP exporter config.

## Access setup

The `azure_monitor` receiver needs `Monitoring Reader` on the resource
group containing your Front Door profile. The role grants read on
metric definitions and metric data only, no control-plane write.
`Reader` is not required.

```bash
RG_ID=$(az group show --name <fd-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId or principalId> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

For multi-subscription fleets, repeat per subscription. RBAC
propagation on the legacy ARM `/metrics` endpoint is immediate; the
data-plane batch API at `*.metrics.monitor.azure.com` lags 5-30 minutes
after grant. Flip `use_batch_api: true` only after the role has settled.

The role assignment lifecycle for production: bind it to the resource
group containing your Front Door profile (or to the subscription if
you intend to scrape every profile in scope), grant once, and rotate
the SP secret per [Service principal credential
lifecycle](./service-bus.md#service-principal-credential-lifecycle).
Workload Identity Federation eliminates the rotation entirely if the
collector runs on AKS.

## Receiver configuration

Add this fragment to your existing collector config. Component keys
are suffixed `/frontdoor` so the fragment composes cleanly with other
Azure-surface receivers in the same collector.

```yaml showLineNumbers title="otel-collector.yaml (Front Door addition)"
extensions:
  azure_auth:
    # Pick one of: service_principal, managed_identity, workload_identity.
    # See the Service Bus guide's Authentication section for the right
    # choice per collector deployment surface.
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/frontdoor:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:FRONTDOOR_RESOURCE_GROUP}
    services:
      - Microsoft.Cdn/profiles            # NOT Microsoft.Network/frontDoors (Classic, deprecated)
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    # Issue #43648 workaround: explicit per-metric aggregations matching
    # MS-documented defaults. Empty `[]` (= all 5 aggregations) triggers
    # `501 Sampling type is not found` from Azure Monitor on this namespace.
    metrics:
      "Microsoft.Cdn/profiles":
        RequestCount:           [total]
        TotalLatency:           [average]
        ResponseSize:           [total]
        RequestSize:            [total]
        ByteHitRatio:           [average]
        OriginRequestCount:     [total]
        OriginLatency:          [average]
        OriginHealthPercentage: [average]
        Percentage4XX:          [average]
        Percentage5XX:          [average]

processors:
  resource/frontdoor:
    attributes:
      - {key: cloud.provider,    value: azure,                              action: insert}
      - {key: cloud.platform,    value: azure_front_door,                   action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",     action: insert}
      - {key: cloud.region,      value: "${env:FRONTDOOR_REGION}",          action: insert}
      # cloud.resource_id pins all metrics to one profile. Drop this line
      # for multi-profile fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically.
      - {key: cloud.resource_id, value: "${env:FRONTDOOR_RESOURCE_ID}",     action: insert}
      - {key: deployment.environment.name,
                                 value: "${env:DEPLOYMENT_ENVIRONMENT}",    action: insert}
      - {key: service.name,      value: "${env:FRONTDOOR_SERVICE_NAME}",    action: insert}

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/frontdoor:
      receivers: [azure_monitor/frontdoor]
      processors: [resource/frontdoor, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                  # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed
`/frontdoor` so they coexist with other Azure receivers (Service Bus,
Cosmos DB, SQL Database, Storage) in a single collector. Your Scout
exporter (`oauth2client` + `otlphttp/b14`) stays unchanged; one Scout
pipeline serves every Azure surface.

For multi-subscription scoping, the `subscription_ids:` list takes any
number of entries; alternatively set `discover_subscriptions: true` to
scrape every subscription the configured identity has `Monitoring
Reader` on. See [Multi-endpoint scaling](#multi-endpoint-scaling).

## Verification

After applying the fragment and restarting the collector, three signals
confirm the pipeline is healthy.

**1. Receiver discovers your profile.** Within 30 seconds of collector
startup (or reload), one line per discovery phase appears in the logs:

```text
azuremonitorreceiver ... "Loaded the list of Azure Subscriptions" subscriptions_count=1
azuremonitorreceiver ... "Loaded the list of Azure Resources" resources_count=1
azuremonitorreceiver ... "Loaded the list of Azure Metrics Definitions" metrics_definitions_count=10
azuremonitorreceiver ... "Loaded the Azure Metrics" resource_id=/subscriptions/.../profiles/<your-fd>
```

`subscriptions_count` and `resources_count` should match your scope.
`metrics_definitions_count` should approach 10 on a production profile;
fresh profiles surface only 3-4 (see [Receiver behavior on a brand-new
profile](#receiver-behavior-on-a-brand-new-profile)). A wrong resource
count, or a `metrics_definitions_count` of 0, indicates a configuration
or RBAC issue; see [Troubleshooting](#troubleshooting).

**2. Data points reach Scout.** Confirm via the collector's
self-metrics on `:8888/metrics`:

```bash
curl -s http://<collector-host>:8888/metrics \
  | grep -E "(azure_monitor.frontdoor|otlp.*b14)"
```

Sample pattern after a few minutes of polling on a fresh profile (your
counters will be much higher on a steady production fleet):

```text
otelcol_receiver_accepted_metric_points_total{receiver="azure_monitor/frontdoor"} 11
otelcol_exporter_sent_metric_points_total{exporter="otlphttp/b14"} 11
otelcol_exporter_send_failed_metric_points_total{exporter="otlphttp/b14"} 0
otelcol_receiver_failed_metric_points_total{receiver="azure_monitor/frontdoor"} 0
```

The two `*_total` counters should grow together (data flows
end-to-end); the `*_failed_*` counters should stay at 0.

**3. Series visible in Scout.** Filter on either of:

- `service.name = front-door-monitor` (or whatever you set
  `${FRONTDOOR_SERVICE_NAME}` to).
- `cloud.platform = azure_front_door`.

Initial series on a fresh profile with traffic:
`azure_requestcount_total`, `azure_responsesize_total`,
`azure_totallatency_average`. Group by `metadata_HttpStatusGroup` to
split 2XX vs 4XX vs 5XX traffic. Group by `metadata_ClientCountry` for
geo distribution.

If the receiver discovers the profile but the debug exporter logs
`metrics: 0, data points: 0` after a few cycles, the lazy-published
metrics simply have no Azure-side data yet. Wait for traffic, or
generate synthetic traffic with `curl https://<endpoint>.azurefd.net/`
in a loop; the first non-zero data point typically lands in Azure
Monitor 2-5 minutes after traffic and reaches Scout one collector
cycle later.

## Cache configuration

`ByteHitRatio` only emits data points when Front Door actually caches
responses. Front Door honors the origin's `Cache-Control` header by
default. Origins that return `Cache-Control: no-store` (Azure Storage
static-website endpoints are one example, plus most application
backends serving dynamic content) make Front Door treat every request
as cache-uncacheable and `ByteHitRatio` stays absent from the time
series.

Two ways to surface non-zero `ByteHitRatio`:

**Option A. Origin sets meaningful `Cache-Control`.** Configure your
origin to return `Cache-Control: max-age=<seconds>`, or
`s-maxage=<seconds>` to apply only to proxies. This is the cleanest
path; Front Door honors the directive and `ByteHitRatio` populates per
minute. Most production CDN deployments already do this for static
assets.

**Option B. Front Door Rules Engine override.** When you cannot change
the origin (third-party API, legacy backend, Storage static-website
that you control but want to keep simple), attach a
`RouteConfigurationOverride` action to the route:

```bash
RG=<your-fd-rg>
PROFILE=<your-fd-profile>

az afd rule-set create -g $RG --profile-name $PROFILE \
  --rule-set-name CacheRules

az afd rule create -g $RG --profile-name $PROFILE \
  --rule-set-name CacheRules --rule-name OverrideCache \
  --order 1 \
  --action-name RouteConfigurationOverride \
  --enable-caching true \
  --cache-behavior OverrideAlways \
  --cache-duration "0.00:05:00" \
  --query-string-caching-behavior IgnoreQueryString

# Enable caching on the route and attach the rule set.
az afd route update -g $RG --profile-name $PROFILE \
  --endpoint-name <endpoint-name> -n <route-name> \
  --enable-caching true \
  --rule-sets CacheRules
```

The `cacheBehavior: OverrideAlways` ignores the origin's
`Cache-Control` and applies the configured `cacheDuration`. Both the
rule and the route update need to propagate to FD edge POPs before
caching takes effect; expect 10-30 minutes on cold profiles before
repeated requests to the same URL begin returning `x-cache: TCP_HIT`
and `ByteHitRatio` populates.

The legacy `CacheExpiration` action is rejected on API versions newer
than `2020-09-01`. Use `RouteConfigurationOverride` only.

## Operations

### Cardinality control

Front Door's `metadata_*` dimensions multiply quickly:

- `metadata_ClientCountry` × ~250 values.
- `metadata_ClientRegion` × ~10 values.
- `metadata_HttpStatus` × ~30 values commonly seen.
- `metadata_HttpStatusGroup` × 5 values.
- `metadata_Endpoint` × N (one per AFD endpoint).

A 10-metric × 5-status × 250-country fleet can produce 12,500 active
series per endpoint. Drop `metadata_ClientCountry` (or other
high-cardinality dimensions) via `dimensions.overrides` on the receiver
when per-country slicing is not actionable for your team:

```yaml
receivers:
  azure_monitor/frontdoor:
    dimensions:
      enabled: true
      overrides:
        "Microsoft.Cdn/profiles":
          # List only the dimensions you want to keep; omitted dimensions
          # are dropped before emit.
          RequestCount:  [HttpStatusGroup, Endpoint]
          ResponseSize:  [HttpStatusGroup, Endpoint]
          TotalLatency:  [HttpStatusGroup, Endpoint]
          # ...repeat for other metrics; use [] to drop ALL dimensions for a metric.
```

### Multi-endpoint scaling

`subscription_ids` and `resource_groups` are both lists; one collector
can poll dozens of profiles across many subscriptions. With
`Monitoring Reader` granted on each scope, switch to
`use_batch_api: true` once you exceed roughly 50 profiles to lift the
per-subscription rate ceiling from 12,000 to 360,000 calls per hour.

### Edge propagation timing

For new profiles or after configuration updates (cache rules, origin
changes, route changes), treat actual endpoint behavior (a successful
HTTPS GET returning the origin response) as the propagation gate, not
the management-plane `deploymentStatus` field. The field has been
observed to remain `NotStarted` indefinitely while the edge correctly
serves traffic.

Microsoft documents 5-15 minute propagation. Real-world propagation can
run noticeably longer (sometimes an hour or more) on cold profiles or
in less-trafficked regions. Plan the gap into your change windows.

### Receiver behavior on a brand-new profile

(Skip this if your profile already serves production traffic.) Azure
Monitor only publishes metric definitions for metrics that have data
behind them. A freshly-provisioned Front Door profile typically
surfaces only 3-4 of the 10 whitelisted metrics; the receiver logs
`metrics_definitions_count: 3` (or similar). The remaining metrics
(`OriginHealthPercentage`, `OriginLatency`, `OriginRequestCount`,
`RequestSize`, `Percentage4XX`, `Percentage5XX`) appear once Azure
has data points behind them, which depends on traffic shape (origin
pulls, error responses, etc.).

The whitelist intentionally keeps all 10 so they start emitting
automatically once Azure publishes their definitions. Trimming to the
visible 4 would silently lose them later.

**Receiver caches the definitions list.** The `azuremonitorreceiver`
fetches `metrics:list-definitions` per resource and caches the result.
When Azure publishes a new metric definition (e.g., `ByteHitRatio`
after cache traffic begins), a long-running collector continues
emitting only what it cached at startup until either the cache TTL
expires or the collector restarts. If you wire a cache rule for
`ByteHitRatio` and the metric still does not appear in Scout after
30 minutes of cached traffic, restart the collector — the next
discovery cycle will pick up the new definition and start emitting
the metric on the following scrape.

## Key alerts

Three alerts cover the bulk of actionable Front Door incidents. Tune
thresholds to your traffic volume and SLO; the suggestions below are
starting points.

| Alert | Condition | Why |
| --- | --- | --- |
| Edge 5XX rate elevated | `avg(azure_percentage5xx_average) > 1` for 5 min | Sustained server-side error rate at the edge. The page-worthy alert. Pair with `metadata_HttpStatus` to identify the dominant 5XX. |
| Origin unhealthy | `avg(azure_originhealthpercentage_average) < 100` for 2 min | Health probe failing. Below 100% means at least one origin in the pool is failing the probe; below ~50% means user requests are likely failing too. |
| Edge latency spike | `avg(azure_totallatency_average) > <p99 baseline × 2>` for 5 min | User-perceived latency anomaly. Set the threshold from your last 30 days of data; a doubling typically indicates an origin slowdown or an edge POP issue. |

Two metrics are useful for capacity / cost dashboards but not direct
alerts: `azure_bytehitratio_average` (cache effectiveness; low values
indicate origin egress costs are climbing) and
`azure_originrequestcount_total` vs `azure_requestcount_total` (the
ratio is your cache-shielding efficiency).

`azure_percentage4xx_average` is noisier (clients sending malformed
requests, scrapers, etc.) and is best left as a dashboard metric, not
an alert.

## Pairing with Diagnostic Settings

This guide ships metrics. For Front Door access logs, WAF logs, and
health-probe logs, configure
`Microsoft.Insights/diagnosticSettings` on the FD profile:

- Forward `FrontDoorAccessLog` and `FrontDoorHealthProbeLog` (and
  `FrontDoorWebApplicationFirewallLog` on Premium) to Log Analytics or
  Event Hubs.
- Pipe Event Hubs into the collector via the `azure_event_hub`
  receiver for log-side ingestion to Scout.

The two paths are complementary: metrics for SLI / SLO dashboards and
alerts, logs for per-request investigation.

## Troubleshooting

**`BadRequest: Free Trial and Student account is forbidden for Azure Frontdoor resources`**
during Bicep / portal provisioning. Upgrade subscription to PAYG;
Front Door is on Microsoft's Free-Trial-excluded list. Production
customers running existing Front Door profiles never see this.

**`501 Sampling type is not found`** in collector logs against
`Microsoft.Cdn/profiles`. Receiver's default aggregations triggered
issue #43648; verify the `metrics:` whitelist sets exactly one
aggregation per metric matching MS docs (the fragment above ships the
correct list).

**Endpoint returns 404 with `x-cache: CONFIG_NOCACHE` and a large
default-error body.** Edge propagation incomplete. Microsoft documents
5-15 minute propagation, but on cold profiles or quieter regions it
can run materially longer; wait and retry. The `deploymentStatus`
field is unreliable as a propagation indicator; use actual endpoint
behavior as the gate.

**Endpoint returns 502 / 504 from origin.** Origin pull failing.
Verify the origin hostname is reachable directly:
`curl https://<origin-hostname>/`. Common causes: the origin rejects
the `Host:` header Front Door forwards (set
`originHostHeader` on the origin to whatever the backend expects), the
origin requires client-cert auth (which Front Door doesn't present),
or backing storage / app-service is down.

**`metrics_definitions_count` is 3 or 4, not 10.** Expected on a
brand-new profile; Azure lazy-publishes definitions per metric. See
[Receiver behavior on a brand-new
profile](#receiver-behavior-on-a-brand-new-profile). Production
profiles with weeks of history surface all 10 immediately.

**`ByteHitRatio` emits no data points even with traffic.** Origin
returns `Cache-Control: no-store`. Apply the [Cache
configuration](#cache-configuration) override. If the cache rule is
already in place and `x-cache: TCP_HIT` shows on the responses but
the metric still does not appear in Scout, restart the collector —
the receiver caches the definitions list per container lifetime, so a
metric that Azure begins publishing mid-run is only picked up after a
fresh discovery cycle.

**`AuthorizationFailed` / `403 Forbidden` on receiver poll.** Service
principal's `Monitoring Reader` role hasn't propagated yet. Wait 60
seconds and retry; the legacy `/metrics` endpoint propagates
immediately, but verify the role assignment landed via
`az role assignment list`.

**`dial tcp: lookup login.microsoftonline.com: network is unreachable`**
on first scrape after a sibling collector restart. Docker Desktop DNS
glitch. Recreate the collector container
(`docker compose down && docker compose up`) to refresh the DNS
resolver.

## Frequently Asked Questions

**Should I use Front Door Standard, Premium, or Classic?** Standard for
new deployments. Premium adds WAF metrics and Private Link origin
support; Classic is deprecated and not on Microsoft's roadmap. The
metric coverage in this guide applies to both Standard and Premium;
Premium-only WAF metrics are documented but not in the default
whitelist.

**Do I need to grant the SP `Reader` as well as `Monitoring Reader`?**
No. `Monitoring Reader` alone covers the entire `azure_monitor`
receiver surface for Front Door. `Reader` is only needed if the
receiver throws `AuthorizationFailed` on a specific call (rare).

**Can I monitor multiple FD profiles with one collector?** Yes. Add
their resource groups to the `resource_groups:` list, or omit the list
entirely to scrape every profile in the listed subscriptions. The
`cloud.resource_id` resource attribute should be dropped from the
processor in that case (the receiver injects per-resource resource IDs
automatically via `azuremonitor.resource_id`).

**How does Scout compare to Application Insights for Front Door?** Both
draw from the same Azure Monitor REST API for metrics; coverage is
identical. Scout is vendor-neutral OTLP, queryable via SQL, with
ingest-volume pricing. Application Insights is Azure-tenant-bound and
KQL-only. The collector also unifies multi-cloud surfaces (Front
Door, AWS CloudFront, GCP Cloud CDN) under one pipeline.

**What does this cost beyond the FD profile itself?** The
`azure_monitor` receiver makes one Azure Resource Manager call per
metric per resource per collection interval. For one FD profile and
the 10-metric whitelist polled every 60 seconds, that is roughly
14,400 ARM calls per day, well under the 12,000-per-hour
per-subscription ceiling. Azure does not bill metric reads from the
ARM `/metrics` endpoint separately. Scout-side, ingest is billed per
data point; with one profile the volume is small (single-digit MB per
day before cardinality multiplication).

## Related Guides

- [Azure Service Bus](./service-bus.md) - same `azure_monitor` receiver
  pattern, no #43648 caveat.
- [Azure SQL Database](./sql-database.md) - same auth + RBAC shape.
- [Azure Cosmos DB](./cosmos-db.md) - same fragment composition, RU-based
  metrics.
- [Azure Kubernetes Service](../azure/aks.md) - operator-managed
  collectors for in-cluster `kubeletstats`, `k8s_cluster`, and optional
  `azure_monitor` control-plane metrics.
