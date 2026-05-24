---
date: 2026-05-12
id: collecting-azure-app-service-telemetry
title: Azure App Service Monitoring with OpenTelemetry - Requests, Health Checks & HTTP Logs
sidebar_label: App Service
description:
  Azure App Service observability with OpenTelemetry — control-plane
  metrics via azure_monitor and HTTP / Platform logs via
  azure_event_hub receivers.
keywords:
  - azure app service monitoring
  - azure web app opentelemetry
  - app service plan metrics
  - application insights resource monitoring
  - azure app service logs
  - azure_event_hub receiver
  - azuremonitorreceiver multi-namespace
  - app service health check status
  - app service http logs diagnostic settings
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure App Service with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Three instrumentation paths complement each other. Platform metrics use azure_monitor against Microsoft.Web/sites, Microsoft.Web/serverFarms, and microsoft.insights/components. App-side telemetry is your app emitting OTel directly via the SDK, or Application Insights auto-instrumentation. Resource logs are azure_event_hub consuming Diagnostic Settings categories AppServiceHTTPLogs and AppServicePlatformLogs. Pick the paths based on what your app is wired to and what your debug-depth appetite is."}},{"@type":"Question","name":"What's the smallest App Service Plan that supports OpenTelemetry observability through Diagnostic Settings?","acceptedAnswer":{"@type":"Answer","text":"Basic B1 is the smallest tier that supports forwarding Diagnostic Settings to Event Hubs. Free F1 and Shared D1 reject Event Hubs as a Diagnostic Settings destination. B1 still supports HTTP file-system logging and all per-site metrics."}},{"@type":"Question","name":"Why are my Application Insights metrics empty in Scout even though the AI resource exists?","acceptedAnswer":{"@type":"Answer","text":"The microsoft.insights/components metric namespace exposes APM signals derived from log records your app pushes to Application Insights via the SDK. If your app emits OTel directly to Scout instead, these metrics will be empty. That is expected. Configure the AI connection string only if you want both AI-derived metrics and your direct OTel pipeline to coexist."}},{"@type":"Question","name":"What's the first-batch ship lag for App Service Diagnostic Settings?","acceptedAnswer":{"@type":"Answer","text":"Resource-scope Diagnostic Settings on App Service ship the first batch 5 to 15 minutes after the setting is attached and the site emits its first matching event. Steady-state batches arrive every 1 to 3 minutes after that. Budget at least 15 minutes before treating an empty Event Hubs partition as a failure."}},{"@type":"Question","name":"Does HealthCheckStatus emit without a configured health path?","acceptedAnswer":{"@type":"Answer","text":"No. App Service evaluates the health-check path you configure on the site every minute. If the path returns a non-200 response or is not configured, HealthCheckStatus reads zero or no data. Set siteConfig.healthCheckPath to a route your app actually serves, and verify with a curl probe before treating the metric as broken."}},{"@type":"Question","name":"Why does FileSystemUsage show no data at a 60-second collection interval?","acceptedAnswer":{"@type":"Answer","text":"FileSystemUsage emits at a 6-hour grain on the Azure Monitor catalog. A receiver polling at 60 seconds will not see it populate. Either run a second azuremonitorreceiver instance at PT6H interval scoped to FileSystemUsage, or drop the metric from the whitelist and rely on quota alerts in the Azure portal instead."}}]}
sidebar_position: 16
---

# Azure App Service Monitoring with OpenTelemetry

> **Why Scout for Azure App Service observability?**
>
> Microsoft now emits OTel-shaped telemetry by default through the
> Application Insights SDK 3.x and the Azure Monitor OpenTelemetry
> Distro. Scout consumes those exact signals via OTLP and stores them
> alongside your AWS, GCP, on-prem, and application telemetry in one
> OTel-native query surface.
>
> Azure Monitor remains the data source for the control-plane metrics
> in this guide - the receiver reads from it. What changes is the
> destination: Scout instead of Application Insights / Log Analytics
> for visualization, alerting, and long-term query.

## Overview

App Service is three Azure resource types working together: the **site**
(`Microsoft.Web/sites`), the **plan** that hosts it
(`Microsoft.Web/serverFarms`), and an **Application Insights component**
(`microsoft.insights/components`) attached for APM. End-to-end
observability means signals from all three, plus the request-level
detail that surface metrics cannot reach.

This guide configures **two collector receivers** that together cover the
control-plane and the diagnostic logs:

- `azuremonitorreceiver` against the three resource-type namespaces.
- `azure_event_hub` against a Diagnostic Settings → Event Hubs pipeline.

The third path - application-level telemetry from inside your running
app - is covered briefly here and in depth in the apps-side
instrumentation guides. App Service does not have a single canonical
in-system endpoint to scrape; the apps-side path is OTel SDK or AI SDK
inside your code.

## Instrumentation paths for App Service

The right shape depends on what your app already emits and what
visibility gaps remain. Three paths exist; pick one, two, or all three
based on the table below.

| Path | What it covers | What it costs | Setup |
| --- | --- | --- | --- |
| **Platform metrics - Azure Monitor** (this guide) | Request rates and HTTP status distribution at the site; CPU / memory saturation at the plan; AI resource health. Per-site and per-plan resolution; minute-level grain. Does **not** see inside the app process. | Azure Monitor query cost: one query per metric per scrape (or one per resource with `use_batch_api: true`). At a 60s interval the daily cost runs in cents per site. | One Service Principal with `Monitoring Reader` on the resource group; one receiver block; one resource processor. |
| **App-side telemetry - OTel SDK / App Insights** (cross-link) | Per-request traces, custom spans, dependency calls, exception stack traces, custom business metrics. Code-line resolution; sub-second grain. Sees inside the app process. | Telemetry ingest cost into Scout (per-record). Latency added per span: low single-digit microseconds with the SDK; ~milliseconds with an auto-instrumentation agent. | OTel SDK in the app (vendor-neutral) **or** Application Insights SDK auto-instrumentation. Both ultimately need a wire-protocol export to Scout. See the apps-side guides linked from Related Guides. |
| **Resource logs - Diagnostic Settings → Event Hubs** (this guide, §Logs below) | Per-request access log (URL, status, response time, client IP, request size, response size); deploy / restart / config-change / scale audit. Per-request resolution; sub-second grain. | One Event Hubs Basic namespace (~$11/mo at 1 TU; 1 MB/s ingress absorbs ~150 requests/second of typical HTTP log records). Plus the Diagnostic Setting itself is free. | One Diagnostic Setting on the site with the categories you care about; one Event Hubs namespace + hub + Send/Listen SAS rules; one `azure_event_hub` receiver fragment. |

### Which path to pick

Four decision criteria, in order of usual weight:

1. **Is your app already wired to Application Insights?** If yes, AI is
   the apps-side telemetry source already. Platform metrics are the
   **complement** that adds site- and plan-level signals, not a
   replacement for the apps-side data.
2. **Are you running one site per plan, or many?** Multi-site plans need
   both plan-level metrics (plan saturation tells you when the host runs
   out of CPU or memory) and per-site metrics (which app is the noisy
   neighbor). Single-site plans can lean on site-level alone for most
   alerts, with the plan as a tie-break for capacity questions.
3. **Linux or Windows runtime?** Some metrics emit differently across
   runtimes; `HealthCheckStatus` is Linux-only on the current API.
   Verify availability against your specific runtime version before
   pinning alerts on a runtime-conditional metric.
4. **What's your Diagnostic Settings volume budget?**
   `AppServiceHTTPLogs` is one record per HTTP request. At 100 req/s a
   site produces 360k records/hour. Event Hubs Basic 1 TU (1 MB/s) is
   fine up to ~4k records/sec at ~250-byte average payload; above that,
   move to Standard 2-20 TU or enable only a subset of categories.

If you're starting from zero, platform metrics are the lowest-effort
win and catch the broadest range of saturation incidents. Add
resource logs when you need per-request distribution that aggregate
metrics cannot give you. Add app-side telemetry when you need
code-line attribution for errors and slow requests.

## What you'll monitor

The receiver scrapes three Azure Monitor namespaces under one
`services:` block and emits per-resource metrics under
`cloud.platform: azure_app_service`. The per-record
`azuremonitor.resource_id` dimension distinguishes same-named metrics
across the three resource types.

### Site metrics (`Microsoft.Web/sites`)

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `CpuTime` | Total | CPU seconds consumed in the period. Compare against your plan's vCPU budget. |
| `Requests` | Total | HTTP request count. Populates only in periods that received traffic. |
| `BytesReceived` | Total | Inbound request body bytes. |
| `BytesSent` | Total | Outbound response body bytes. |
| `Http2xx` | Total | 2xx response count. Populates with traffic. |
| `Http3xx` | Total | 3xx (redirect) response count. |
| `Http4xx` | Total | 4xx (client error) response count. SLI candidate. |
| `Http5xx` | Total | 5xx (server error) response count. Primary SLI. |
| `HealthCheckStatus` | Average | 1 when `siteConfig.healthCheckPath` returns 200, otherwise 0. App Service probes this every minute independently of your traffic; the metric is continuous, not traffic-driven. |
| `AverageResponseTime` | Average | Mean response time in seconds across requests in the period. Populates only during traffic. |
| `MemoryWorkingSet` | Average | Process resident memory. Compare against the plan's RAM budget. |
| `AverageMemoryWorkingSet` | Average | Time-averaged variant of the above. |

**Operations footnote - `FileSystemUsage`:** The catalog exposes
`FileSystemUsage` at a PT6H native grain. A receiver polling at 60s
will not see it populate. If you need filesystem-usage visibility, run
a second `azuremonitorreceiver` instance scoped to `FileSystemUsage`
with `collection_interval: 6h` and merge its output into the same
pipeline. Otherwise the App Service Plan storage quota alert in the
Azure portal is the simpler path.

**Catalog-available extras** (not whitelisted by default; add if you
need finer breakdown): per-status-code counts (`Http101`, `Http401`,
`Http403`, `Http404`, `Http406`), `HttpResponseTime` (alternative form
of response time), `InstanceCount`, and per-I/O-operation counters
(`IoReadBytesPerSecond`, `IoWriteBytesPerSecond`,
`IoReadOperationsPerSecond`, `IoWriteOperationsPerSecond`).

### Plan metrics (`Microsoft.Web/serverFarms`)

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `CpuPercentage` | Average, Maximum | Plan vCPU saturation. Headline plan SLI. |
| `MemoryPercentage` | Average, Maximum | Plan RAM saturation. Pairs with the above for capacity decisions. |
| `DiskQueueLength` | Average | Disk request queue depth. Non-zero values indicate I/O contention. |
| `HttpQueueLength` | Average | HTTP request queue depth. Non-zero values indicate the worker is saturated. |
| `BytesReceived` | Total | Aggregate inbound bytes across all sites on the plan. |
| `BytesSent` | Total | Aggregate outbound bytes across all sites on the plan. |
| `TcpSynSent` | Average | Outbound TCP SYNs - new connection attempts. |
| `TcpEstablished` | Average | Established outbound TCP connections. Persistent connection count. |

All plan metrics populate continuously, even at idle, because the host
worker reports them on a 60s heartbeat independent of HTTP traffic.

**Catalog-available extras**: detailed TCP state breakdown
(`TcpSynReceived`, `TcpFinWait1`, `TcpFinWait2`, `TcpClosing`,
`TcpCloseWait`, `TcpLastAck`, `TcpTimeWait`) and socket-level counts
(`SocketInboundAll`, `SocketOutboundAll`, `SocketOutboundEstablished`,
`SocketOutboundTimeWait`, `SocketLoopback`).

### Application Insights *resource* metrics (`microsoft.insights/components`)

> **These are APM-derived, not resource-health.** The metrics in this
> namespace are aggregated from log records your app pushes to the
> linked Log Analytics workspace via the Application Insights SDK. They
> populate when your app is instrumented with the AI SDK using the
> connection string you wired into `APPLICATIONINSIGHTS_CONNECTION_STRING`.
> If your app emits OTel telemetry directly to Scout instead (the
> app-side telemetry path above), **these metrics will be empty - that
> is expected and not a misconfiguration.** Treat this sub-table as the
> AI-SDK escape hatch for teams not yet ready to cut over to direct
> OTel.

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `availabilityResults/availabilityPercentage` | Average | Percentage of AI Availability Tests passing. Requires availability tests configured on the AI resource. |
| `requests/duration` | Average | Mean request duration as observed by the AI SDK in your app. |
| `performanceCounters/processCpuPercentage` | Average | CPU consumed by the app process as reported by the AI SDK. |
| `dependencies/duration` | Average | Outbound dependency call duration (HTTP / SQL / queue) as the AI SDK sees them. |
| `exceptions/count` | Count | Application exception count as the AI SDK observes them. |

**Catalog-available extras** (named here for completeness; the AI
metrics namespace is rich): per-request counts and rates
(`requests/count`, `requests/failed`, `requests/rate`), dependency
detail (`dependencies/count`, `dependencies/failed`), performance
counters (`performanceCounters/requestExecutionTime`, `requestsInQueue`,
`requestsPerSecond`, `exceptionsPerSecond`, `processIOBytesPerSecond`,
`processorCpuPercentage`, `memoryAvailableBytes`, `processPrivateBytes`),
exceptions split (`exceptions/browser`, `exceptions/server`),
availability detail (`availabilityResults/count`,
`availabilityResults/duration`), `traces/count`, page-view metrics
(`pageViews/count`, `pageViews/duration`), and browser timings
(`browserTimings/networkDuration`, `processingDuration`,
`receiveDuration`, `sendDuration`, `totalDuration`).

## Prerequisites

| Requirement | Detail |
| --- | --- |
| App Service Plan SKU | Basic B1 or higher. Free F1 and Shared D1 do not support Diagnostic Settings to Event Hubs. |
| Application Insights | Workspace-based (modern). Classic AI was retired Feb 2024. |
| OTel Collector Contrib | v0.151+   (the `azure_monitor` and `azure_event_hub` receiver names are snake_case from v0.148.0; v0.151.0 is the current fleet). |
| OpenTelemetry semconv | v1.41.0 (latest cloud and HTTP attributes). |
| Azure CLI | 2.85+ for the `az monitor diagnostic-settings` flags used here. |
| Azure providers registered | `Microsoft.Web`, `Microsoft.OperationalInsights`, `Microsoft.Insights`, `Microsoft.EventHub`. |
| Collector runtime | See [Docker Compose Setup](../../collector-setup/docker-compose-example.md) or [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) for the runtime; this guide adds the App Service-specific receiver + processor blocks on top. |
| Scout exporter | See [Scout exporter wiring](../../collector-setup/scout-exporter.md) for the `oauth2client` extension + `otlp_http/b14` exporter. This guide does not re-derive that block. |

## Access setup

The receiver authenticates via a Service Principal scoped per resource
group. Two role assignments are needed:

| Role | Scope | Reason |
| --- | --- | --- |
| `Monitoring Reader` | Resource group containing the site + plan + AI | Lets the receiver list metric definitions and read metric values for all three namespaces. |
| `Azure Event Hubs Data Receiver` | Event Hubs namespace (logs path only) | Lets the receiver consume the diagnostic event hub. Granted by the SAS rule's Listen permission via the connection string; if you use Azure AD auth instead, grant the role on the namespace. |

If you are reusing an operator-permanent SP across many surfaces, both
assignments are idempotent - re-running them on a previously granted SP
is a no-op.

Both roles propagate independently. The metrics path may flow before
the logs path receives its first record, or vice versa. Smoke-test both
on first run (a one-shot `az monitor metrics list` call against the
site and an `az eventhubs eventhub consumer-group show` for the hub
will fail-fast if RBAC has not propagated yet).

## Receiver configuration

Add the following to your collector config alongside whatever is already
wiring `azure_auth` and the Scout exporter. **You do not need to
duplicate** the `oauth2client` extension or the `otlp_http/b14`
exporter; those live in the shared base config per
[Scout exporter wiring](../../collector-setup/scout-exporter.md).

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_monitor/appservice:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:APPSERVICE_RESOURCE_GROUP}
    services:
      - Microsoft.Web/sites
      - Microsoft.Web/serverFarms
      - microsoft.insights/components
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Web/sites":
        CpuTime:                  [Total]
        Requests:                 [Total]
        BytesReceived:            [Total]
        BytesSent:                [Total]
        Http2xx:                  [Total]
        Http3xx:                  [Total]
        Http4xx:                  [Total]
        Http5xx:                  [Total]
        HealthCheckStatus:        [Average]
        AverageResponseTime:      [Average]
        MemoryWorkingSet:         [Average]
        AverageMemoryWorkingSet:  [Average]
      "Microsoft.Web/serverFarms":
        CpuPercentage:            [Average, Maximum]
        MemoryPercentage:         [Average, Maximum]
        DiskQueueLength:          [Average]
        HttpQueueLength:          [Average]
        BytesReceived:            [Total]
        BytesSent:                [Total]
        TcpSynSent:               [Average]
        TcpEstablished:           [Average]
      "microsoft.insights/components":
        availabilityResults/availabilityPercentage: [Average]
        requests/duration:                          [Average]
        performanceCounters/processCpuPercentage:   [Average]
        dependencies/duration:                      [Average]
        exceptions/count:                           [Count]

processors:
  resource/appservice:
    attributes:
      - {key: cloud.provider,              value: azure,                            action: insert}
      - {key: cloud.platform,              value: azure_app_service,                action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",   action: insert}
      - {key: cloud.region,                value: "${env:APPSERVICE_REGION}",       action: insert}
      # cloud.resource_id deliberately omitted - the bundle holds 3 distinct
      # resources (site + plan + AI). Per-record `azuremonitor.resource_id`
      # metric dimension splits same-named metrics across resources.
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}",             action: insert}
      - {key: service.name,                value: "${env:APPSERVICE_SERVICE_NAME}", action: insert}

service:
  pipelines:
    metrics/appservice:
      receivers: [azure_monitor/appservice]
      processors: [memory_limiter, resource/appservice, batch]
      exporters: [otlp_http/b14]
```

**Why no `cloud.resource_id` resource attribute:** the bundle covers
three distinct Azure resources (site + plan + AI). Pinning a single
`cloud.resource_id` would clobber the per-record split that the
receiver emits as the `azuremonitor.resource_id` metric dimension.
Same-named metrics across the three resource types (`BytesReceived` on
sites AND serverFarms, for example) stay distinct via that dimension;
filter and group in Scout by `azuremonitor.resource_id` to split by
resource.

## Environment variables

```bash title=".env"
AZURE_SUBSCRIPTION_ID=...
APPSERVICE_RESOURCE_GROUP=...        # RG containing site + plan + AI
APPSERVICE_REGION=...                # for cloud.region; defaults to the RG region
APPSERVICE_SERVICE_NAME=app-service-monitor
ENVIRONMENT=production
```

Service Principal credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`) and Scout exporter credentials
(`SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, `SCOUT_TOKEN_URL`,
`SCOUT_OTLP_ENDPOINT`) come from the shared base config and are not
listed here. See
[Scout exporter wiring](../../collector-setup/scout-exporter.md).

## Operations

### RBAC propagation lag

`Monitoring Reader` on the resource group typically propagates in
under 30 seconds, occasionally up to 120 seconds. The first scrape after
a fresh role assignment may return `403 AuthorizationFailed`. The
receiver retries on the next 60s cycle; the noise clears within two
polls.

### Diagnostic Settings ship cadence

Resource-scope Diagnostic Settings first-batch ship lag commonly runs longer than
Azure's documented 5-15 minute window on first attach. Budget at least
**15 minutes** before treating an empty Event Hubs partition as a
failure. Steady-state batches arrive every 1-3 minutes once the
pipeline is warm.

### `HealthCheckStatus` depends on path config

`HealthCheckStatus` emits only when `siteConfig.healthCheckPath` is set
and the path returns HTTP 200. If the path returns 404 (default for an
app that does not implement a health endpoint), the metric reads zero
or no data. Configure the path explicitly:

```bash title="configure healthCheckPath"
az webapp update \
  --resource-group <rg> \
  --name <site> \
  --set siteConfig.healthCheckPath=/healthz
```

Verify with `curl https://<site>.azurewebsites.net/healthz` returning
200 before relying on the metric.

### Application Insights metrics are empty until your app pushes to AI

This is the single biggest source of "why is half my dashboard empty"
tickets. The microsoft.insights/components metric namespace is **not**
populated by Azure - it is populated by your app emitting AI SDK
telemetry that lands in the linked Log Analytics workspace. If your
app emits OTel directly to Scout, the AI-namespace metrics show no
data. That is correct. Either:

- Treat the AI sub-table as documentation of what's available **if**
  you wire your app to the AI SDK.
- Disable AI metrics in the receiver by removing the
  `microsoft.insights/components` entry from `services:` and `metrics:`.
- Wire both: keep direct OTel as the primary path, enable the AI SDK
  for the AI-resource-derived metrics, accept the duplication cost.

### `FileSystemUsage` is hourly-grain only

See the Operations footnote in the Site metrics table above.
`FileSystemUsage` is the canonical PT6H-grain metric that fails to
emit under a 60-second receiver. Use a separate slow-poll receiver
instance or skip it.

### `AppServiceHTTPLogs` volume scaling

`AppServiceHTTPLogs` emits one record per HTTP request. At 100 req/s a
site produces 360,000 records/hour. Event Hubs Basic 1 TU absorbs
roughly 4,000 records/second at ~250-byte average payload; busier
sites need Event Hubs Standard (2-20 TU) or a subset of categories.

### Bicep `httpLoggingEnabled` reliability on Linux

`AppServiceHTTPLogs` requires HTTP file-system logging enabled on the
site. The Bicep `siteConfig.httpLoggingEnabled: true` property declares
the intent, but on some Linux runtime versions the property does not
get applied at deploy time. Re-assert post-deploy via `az`:

```bash title="enable HTTP file-system logging"
az webapp log config \
  --resource-group <rg> \
  --name <site> \
  --web-server-logging filesystem
```

The CLI command is idempotent, so making it part of every deploy
script is safe. If your records arrive in Event Hubs but
`AppServiceHTTPLogs` records are missing while `AppServicePlatformLogs`
flow normally, this is the most likely cause.

### Why two role assignments

The metrics path needs `Monitoring Reader` on the resource group
because the receiver enumerates resources within the RG and reads
their metrics. The logs path needs `Azure Event Hubs Data Receiver`
on the Event Hubs namespace because the `azure_event_hub` receiver
consumes from the hub. The two roles are scoped to different
resources and propagate independently; smoke-test both on first
attach.

## Key alerts to configure

Once metrics are flowing, set up alerts on these thresholds. The
"Why" column gives the reasoning so you can adjust the thresholds
for your traffic shape.

| Signal | Warning | Critical | Why |
| --- | --- | --- | --- |
| `Http5xx` rate (1 min) | > 1% of `Requests` | > 5% of `Requests` | Server-side error rate; the primary SLI for App Service. 1% sustained suggests a broken release or upstream outage. |
| `Http4xx` rate (1 min) | > 5% of `Requests` | > 20% of `Requests` | Client-error spikes indicate broken integrations, auth misconfiguration, or scanning traffic. |
| `AverageResponseTime` (5 min) | > 1.5× rolling 24h mean | > 3× rolling 24h mean | Latency regression detector. Use a relative threshold rather than an absolute number so the alert tracks normal site behaviour. |
| `HealthCheckStatus` (3 consecutive minutes) | < 1 on any instance | < 1 across all instances | Health probe failing on one instance is degraded; failing across all instances is an outage. App Service evaluates this every 60 s. |
| `CpuPercentage` on the plan (5 min) | > 75% Average | > 90% Average | Plan saturation; sites on this plan will start to queue. |
| `MemoryPercentage` on the plan (5 min) | > 80% Average | > 90% Average | Plan RAM pressure; risk of OOMKill on Linux containers above 95%. |
| `HttpQueueLength` on the plan (3 min) | > 5 Average | > 20 Average | The plan worker is saturated; requests are queuing. Co-fires with CpuPercentage in most cases. |
| `Requests` drop on the site (10 min) | < 50% of rolling 1h mean | < 10% of rolling 1h mean | Sudden traffic drop on a site that normally serves traffic indicates upstream (Front Door / Application Gateway) or DNS failure. |

Configure the Scout-side alert rules through your dashboarding /
alerting stack once thresholds are decided; the receiver pipeline
above emits the underlying signals continuously.

## Logs

App Service publishes a rich set of Diagnostic Settings categories
that fill gaps the metric whitelist cannot. The §Logs path uses
the `azure_event_hub` receiver against a Diagnostic Settings →
Event Hubs sink.

### What logs uniquely fill

Platform metrics aggregate. Logs disaggregate. The gaps logs uniquely
cover for App Service:

- **Per-request distribution**: URL × method × status code × client
  IP × response time × user agent. The metric whitelist gives you
  `Http5xx` count per minute; the access log gives you *which*
  requests failed and *from where*.
- **Per-IP audit and rate**: ranking client IPs by request volume,
  correlating IP with 4xx burst signatures, detecting credential
  scans. No metric exposes this.
- **Per-deployment-slot attribution**: deployment slot swaps emit
  their own metric series. Logs show **which** slot received which
  request, which deployment caused which restart, and the ordering of
  config changes across deploys.
- **Per-instance source identification**: when a site scales to
  multiple instances (B1 supports manual scale to 3 workers), logs
  surface the originating instance ID so you can correlate a 5xx
  burst with one bad worker.

### Architecture

```text
App Service site
     │
     │ Diagnostic Setting (resource scope)
     │ categories: AppServiceHTTPLogs + AppServicePlatformLogs (default)
     ↓
Event Hubs namespace (Basic 1 TU)
     │   • diagsend SAS rule (Send) writes records
     │   • collectorlisten SAS rule (Listen) reads records
     ↓
azure_event_hub receiver
     │   • format: azure
     │   • apply_semantic_conventions: true
     │   • cloud.resource_id lifted from the per-record envelope
     ↓
otlp_http/b14 → Scout
```

The Diagnostic Setting targets the **site** resource directly. The
plan and the AI component each have their own Diagnostic Settings categories; this
guide enables only the site's. Adapt the pattern for the plan or AI
if you need their event categories.

### Categories enabled by default

| Category | What it covers |
| --- | --- |
| `AppServiceHTTPLogs` | Per-request access log: URL, method, status, response time, client IP, request size, response size, user agent. Volume scales with traffic. Requires HTTP file-system logging enabled on the site — see Operations → "Bicep `httpLoggingEnabled` reliability on Linux". |
| `AppServicePlatformLogs` | Deploy / restart / config-change / scale audit. Per-operation control-plane events at site scope. Low volume. |

**Health-probe records dominate low-traffic sites.** App Service's
own health-check probe emits one `AppServiceHTTPLogs` record every
60 seconds at the configured `healthCheckPath`. On a site receiving
fewer than 1 req/sec from real users, most records in the stream are
the health probe. When you investigate the log stream and see only
one URL pattern, filter by `userAgent != 'HealthCheck/1.0'` (or the
actual probe UA observed in your records) to see real-traffic
requests; otherwise the probe noise drowns out the signal.

### Optional categories

Named here so you know they exist; enable per workload:

- **`AppServiceConsoleLogs`** - stdout/stderr from the app process.
  Usually redundant with apps-side OTel logs; enable if your app does
  not yet emit OTel.
- **`AppServiceAppLogs`** - app-emitted log records via App Service's
  logging API. Redundant with apps-side OTel; enable as a transition
  aid.
- **`AppServiceAuditLogs`** - SCM / Kudu deployment authentication.
  Security-team scope; enable when you need audit trails for deploys.
- **`AppServiceIPSecAuditLogs`** - hits against the site's IP
  restriction rules. Enable if you have IP allowlists and want
  forensics on blocked traffic.
- **`AppServiceFileAuditLogs`** - file-system change audit. Premium
  V2/V3 and Isolated tier only; ignore on Basic / Standard.

### Receiver configuration (logs)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_event_hub/appservicelogs:
    connection: ${env:APPSERVICELOGS_CONNECTION_STRING}
    partition: ""           # resume across all partitions
    offset: ""              # resume from last checkpoint
    format: azure           # decode Azure resource-log envelope
    apply_semantic_conventions: true

processors:
  resource/appservicelogs:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_app_service,                           action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:APPSERVICELOGS_SOURCE_REGION}",       action: insert}
      # cloud.resource_id is NOT pinned - the receiver lifts the per-record
      # Azure resource ID to this attribute automatically (UPPERCASED).
      - {key: deployment.environment.name, value: "${env:APPSERVICELOGS_ENVIRONMENT}",         action: insert}
      - {key: service.name,                value: "${env:APPSERVICELOGS_SERVICE_NAME}",        action: insert}

service:
  pipelines:
    logs/appservicelogs:
      receivers: [azure_event_hub/appservicelogs]
      processors: [memory_limiter, resource/appservicelogs, batch]
      exporters: [otlp_http/b14]
```

On first run with no stored checkpoint, the receiver starts from the
earliest available record in the hub's retention window (1 day on
Basic). On collector restart the receiver resumes from its last
checkpoint, so an idle window during deployment does not lose records
that arrived in the meantime.

The `APPSERVICELOGS_CONNECTION_STRING` value is the Listen-permission
SAS connection string for the namespace, **with `;EntityPath=<hub-name>`
appended** so the receiver knows which hub to consume from. Fetch it
once via:

```bash title="fetch the Listen connection string"
az rest --method post \
  --url "https://management.azure.com${COLLECTOR_LISTEN_RULE_ID}/listKeys?api-version=2024-01-01" \
  --query primaryConnectionString -o tsv
```

Then append `;EntityPath=<hub>` and store the result in your collector's
env file.

### Environment variables (logs)

```bash title=".env (logs path)"
APPSERVICELOGS_CONNECTION_STRING=...      # Listen SAS with ;EntityPath=<hub>
APPSERVICELOGS_SOURCE_REGION=...          # for cloud.region on log records
APPSERVICELOGS_SERVICE_NAME=app-service-logs
APPSERVICELOGS_ENVIRONMENT=production
```

Service Principal credentials and Scout exporter credentials are
inherited from the shared base config as for the metrics path.

### Wiring the Diagnostic Setting

```bash title="attach the Diagnostic Setting"
az monitor diagnostic-settings create \
  --resource "<site-resource-id>" \
  --name appservice-logs \
  --event-hub <hub-name> \
  --event-hub-rule "<diagsend-rule-id>" \
  --logs '[{"category":"AppServiceHTTPLogs","enabled":true},
           {"category":"AppServicePlatformLogs","enabled":true}]'
```

The `--event-hub-rule` value is the resource ID of the namespace-scoped
SAS rule with `Send` permission. The receiver uses a separate Listen
rule; one Send rule and one Listen rule on the namespace is the
canonical two-rule topology.

### Verifying the logs path

After the Diagnostic Setting is attached and the site has served at
least one request:

1. Wait 15 minutes for the first batch (resource-scope Diagnostic
   Settings first-batch lag).
2. Tail the collector debug exporter: `docker compose logs -f
   otel-collector | grep "otelcol.signal.*logs"`.
3. Expect batches of 10-30 log records every 60-90 seconds at low
   traffic; busier sites batch larger.
4. In Scout, filter `service.name = 'app-service-logs'` and group by
   `azure.category` to confirm both enabled categories populate.

## Troubleshooting

### `AuthorizationFailed` on the first scrape

**Cause:** The `Monitoring Reader` role assignment on the resource
group has not yet propagated. **Fix:** Wait two polling cycles (~2
minutes). The receiver retries automatically; the error self-clears.

### Scraper exits early with `service principal credentials missing`

**Cause:** The collector container did not receive
`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`. **Fix:**
Check your env file is sourced into the collector's environment and
that the `azure_auth` extension references the variables exactly. The
shared base config wires this; if you forked it, re-verify the
extension block.

### Metric data points emit but values are all zero

**Cause for the AI namespace:** This is the expected behaviour when
the app does not push to Application Insights. See **Operations →
Application Insights metrics are empty until your app pushes to AI**
above.

**Cause for site / plan metrics:** Check that the receiver and the
Scout pipeline are filtering or processing values correctly. The
`batch` processor truncates points only at the size cap (1024 by
default); the `memory_limiter` drops points only under memory
pressure. Neither should turn populated points into zero values.

### `HealthCheckStatus` reads no data despite a configured site

**Cause:** The configured `healthCheckPath` returns a non-200 status.
**Fix:** `curl https://<site>.azurewebsites.net/<your-path>`. If the
response is 404, your app does not implement the path - either add a
matching route to your app or change the configured path.

### First Event Hubs batch is empty after 20 minutes

**Cause:** The Diagnostic Setting attached but the site has not yet
served a matching event in the enabled categories. **Fix:** For
`AppServiceHTTPLogs`, drive a single HTTP request against any route on
the site. For `AppServicePlatformLogs`, trigger a config change (`az
webapp config set --generic-configurations '{}'` is a no-op that emits
a platform event). Then re-tail the collector debug logs.

### `azure_event_hub` receiver logs `MessagingGatewayBadRequest`

**Cause:** The receiver is requesting a user-defined consumer group
that does not exist on Event Hubs Basic. **Fix:** Basic tier rejects
user-defined consumer groups - the receiver must consume from
`$Default`, the implicit group. Remove any `consumer_group:` key from
the receiver config or upgrade the namespace to Standard if you need
multiple consumer groups.

### Logs path stops mid-run with no errors

**Cause:** A Listen-SAS-key rotation or namespace deletion invalidated
the connection string. **Fix:** Re-fetch the Listen connection string
via `az rest --method post ... /listKeys` and reload the receiver.

## Frequently Asked Questions

### How do I monitor Azure App Service with OpenTelemetry?

Three instrumentation paths complement each other. Platform metrics
use `azure_monitor` against `Microsoft.Web/sites`,
`Microsoft.Web/serverFarms`, and `microsoft.insights/components`.
App-side telemetry is your app emitting OTel directly via the SDK, or
Application Insights auto-instrumentation. Resource logs are
`azure_event_hub` consuming Diagnostic Settings categories
`AppServiceHTTPLogs` and `AppServicePlatformLogs`. Pick the paths
based on what your app is wired to and what your debug-depth appetite
is.

### What's the smallest App Service Plan that supports Diagnostic Settings?

Basic B1 is the smallest tier that supports forwarding Diagnostic
Settings to Event Hubs. Free F1 and Shared D1 reject Event Hubs as a
Diagnostic Settings destination. B1 still supports HTTP file-system
logging and all per-site metrics.

### Why are my Application Insights metrics empty in Scout?

The `microsoft.insights/components` metric namespace exposes APM
signals derived from log records your app pushes to Application
Insights via the SDK. If your app emits OTel directly to Scout
instead, these metrics will be empty. That is expected. Configure the
AI connection string only if you want both AI-derived metrics and
your direct OTel pipeline to coexist.

### What's the first-batch ship lag for App Service Diagnostic Settings?

Resource-scope Diagnostic Settings on App Service ship the first
batch 5 to 15 minutes after the setting is attached and the site
emits its first matching event. Steady-state batches arrive every 1
to 3 minutes after that. Budget at least 15 minutes before treating
an empty Event Hubs partition as a failure.

### Does HealthCheckStatus emit without a configured health path?

No. App Service evaluates the health-check path you configure on the
site every minute. If the path returns a non-200 response or is not
configured, `HealthCheckStatus` reads zero or no data. Set
`siteConfig.healthCheckPath` to a route your app actually serves, and
verify with a `curl` probe before treating the metric as broken.

### Why does FileSystemUsage show no data at a 60-second collection interval?

`FileSystemUsage` emits at a 6-hour grain on the Azure Monitor
catalog. A receiver polling at 60 seconds will not see it populate.
Either run a second `azuremonitorreceiver` instance at PT6H interval
scoped to `FileSystemUsage`, or drop the metric from the whitelist
and rely on quota alerts in the Azure portal instead.

## Related Guides

### Shared collector + Scout wiring

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  the runtime that hosts both receivers in this guide.
- [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  alternative runtime for AKS-hosted collectors.
- [Scout exporter wiring](../../collector-setup/scout-exporter.md) - the
  `oauth2client` extension + `otlp_http/b14` exporter block shared by
  all Azure guides.

### Apps-side instrumentation

- [.NET Aspire](../../apps/auto-instrumentation/dotnet-aspire.md) - the
  canonical Microsoft path for new .NET 9 apps. Emits OTel by default.
- [OpenTelemetry .NET SDK](../../apps/auto-instrumentation/dotnet.md) -
  direct OTel for existing .NET apps not on Aspire.
- For Python / Node / Java apps, use the OTel SDK for your language
  ([FastAPI](../../apps/auto-instrumentation/fast-api.md),
  [Express](../../apps/auto-instrumentation/express.md),
  [Spring Boot](../../apps/auto-instrumentation/spring-boot.md)) and
  point the OTLP exporter at Scout's collector.

### Adjacent Azure surfaces

- [Azure Compute](./compute.md) - VMs, VM Scale Sets, and Managed
  Disks for the host layer beneath unmanaged or AKS workloads.
- [Azure Front Door](./front-door.md) and
  [Azure Application Gateway](./application-gateway.md) - the edge
  layers in front of App Service.
- [Azure SQL Database](./sql-database.md) and
  [Azure Cache for Redis](./cache-for-redis.md) - common data-tier
  dependencies.
- [Azure Key Vault](./key-vault.md) - secrets store typically
  referenced from `APPLICATIONINSIGHTS_CONNECTION_STRING` and other
  app settings.
