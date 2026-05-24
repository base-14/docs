---
date: 2026-05-15
id: collecting-azure-logic-apps-telemetry
title: Azure Logic Apps Monitoring with OpenTelemetry - Run Health, Billable Executions & Workflow Logs
sidebar_label: Logic Apps
description:
  Azure Logic Apps (Consumption) observability with OpenTelemetry -
  run / action / trigger lifecycle and billable-execution metrics via
  azure_monitor, plus per-action WorkflowRuntime logs via azure_event_hub.
keywords:
  - azure logic apps monitoring
  - logic apps opentelemetry
  - logic apps workflow metrics
  - logic apps billable executions
  - azure logic apps logs
  - azure_event_hub receiver
  - azuremonitorreceiver logic apps
  - workflowruntime diagnostic settings
  - logic apps observability
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure Logic Apps with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Logic Apps Consumption has two telemetry paths. Platform metrics use the azure_monitor receiver against Microsoft.Logic/workflows for run, action, and trigger lifecycle counts, latency, and billable executions. Resource logs use the azure_event_hub receiver consuming the WorkflowRuntime Diagnostic Settings category for per-action drill-down. There is no in-system scrape path: the Consumption runtime is fully Microsoft-managed with no data-plane endpoint."}},{"@type":"Question","name":"Why are RunLatency and billable-execution metrics empty on my Logic App?","acceptedAnswer":{"@type":"Answer","text":"Logic Apps latency and billable-execution metrics are traffic-driven: Azure publishes data points only for minutes that contain completed runs. The run, action, and trigger count metrics publish an explicit zero every minute even at idle, but latency and billing series are sparse by design on a low-traffic workflow. An empty minute means no runs that minute, not a broken pipeline."}},{"@type":"Question","name":"Which Logic Apps cost metric should I alert on?","acceptedAnswer":{"@type":"Answer","text":"TotalBillableExecutions is the canonical Consumption cost SLI - Consumption bills per billable execution. BillableActionExecutions and BillableTriggerExecutions split that total between action and trigger executions so you can attribute cost growth to a specific workflow change."}},{"@type":"Question","name":"Why does the WorkflowRuntime logs pipeline take ~20 minutes?","acceptedAnswer":{"@type":"Answer","text":"On a freshly started collector the azure_event_hub receiver spends roughly 15 to 20 minutes establishing its Event Hubs consumer before it delivers the first record downstream, even when records are already in the hub. The Diagnostic Settings to Event Hubs leg itself is fast for Logic Apps Consumption - records reach the hub within minutes of a run. Budget 20 minutes before treating an empty logs pipeline as broken, and do not restart the collector during that window because a restart resets the warm-up."}},{"@type":"Question","name":"Can surface metrics tell me which action in my workflow failed?","acceptedAnswer":{"@type":"Answer","text":"No. Microsoft.Logic/workflows metrics carry no metadata dimensions - they aggregate per workflow only. ActionsFailed tells you an action failed, not which one. The WorkflowRuntime logs path gives per-action name, status, and error code, so debugging a failed run needs the logs path."}},{"@type":"Question","name":"Does this guide cover Logic Apps Standard?","acceptedAnswer":{"@type":"Answer","text":"No. Standard hosting runs on Microsoft.Web/sites with kind=workflowapp and emits App Service-shaped metrics plus App Service Plan signals. Follow the Azure App Service guide for Standard. This guide is Consumption only (Microsoft.Logic/workflows)."}}]}
sidebar_position: 18
---

# Azure Logic Apps Monitoring with OpenTelemetry

> **Why Scout for Azure Logic Apps observability?**
>
> Microsoft now emits OTel-shaped telemetry by default through the Azure
> Monitor OpenTelemetry Distro and SDK 3.x. Scout consumes those exact
> signals via OTLP and stores them alongside your AWS, GCP, on-prem, and
> application telemetry in one OTel-native query surface.
>
> Azure Monitor remains the data source for the metrics in this guide -
> the receiver reads from it. What changes is the destination: Scout
> instead of Application Insights / Log Analytics for visualization,
> alerting, and long-term query.

## Overview

Logic Apps Consumption is a single Microsoft-managed workflow resource
(`Microsoft.Logic/workflows`) billed per execution. End-to-end
observability means the run / action / trigger lifecycle and the
billable-execution count from the control plane, plus the per-action
detail that aggregate metrics cannot reach.

This guide configures the `azure_monitor` receiver for control-plane
metrics and the `azure_event_hub` receiver for the `WorkflowRuntime`
Diagnostic Settings log category.

## Instrumentation paths for Logic Apps

Consumption exposes exactly two telemetry paths. Pick one or both based
on the table below.

| Path | What it covers | What it costs | Setup |
| --- | --- | --- | --- |
| **Platform metrics - Azure Monitor** (this guide) | Run / action / trigger lifecycle counts, run / action / trigger latency, and billable executions, aggregated per workflow at minute grain. Answers most "is my workflow healthy and what is it costing me?" questions on its own. Does **not** see which action inside a run failed. | Azure Monitor query cost: one query per metric per scrape (or one per resource with `use_batch_api: true`). At a 60s interval the daily cost runs in cents per workflow. | One Service Principal with `Monitoring Reader` on the resource group; one receiver block; one resource processor. |
| **Resource logs - Diagnostic Settings → Event Hubs** (this guide, §Logs) | Per-action drill-down: which action ran, its status and error code, per-trigger payload attribution, per-run forensic ordering. Optionally the full trigger / action inputs and outputs. The detail surface metrics structurally cannot provide. | One Event Hubs Basic namespace (~$11/mo at 1 TU; 1 MB/s ingress absorbs far more than a typical workflow's record rate). The Diagnostic Setting itself is free. | One Diagnostic Setting on the workflow with the `WorkflowRuntime` category; one Event Hubs namespace + hub + Send/Listen SAS rules; one `azure_event_hub` receiver fragment. |

There is **no third (in-system scrape) path**. Logic Apps Consumption's
runtime is fully Microsoft-managed with no data-plane endpoint to
scrape. The in-database or in-broker pull pattern used for PostgreSQL or
Redis does not apply here. If you arrived expecting a "scrape the engine"
option, that is why it is absent. Standard hosting
(`Microsoft.Web/sites` with `kind=workflowapp`) exposes App Service Plan
signals instead; see [Azure App Service](./app-service.md).

### Which path to pick

Four decision criteria, in order of usual weight:

1. **Consumption or Standard hosting?** This guide is Consumption
   (`Microsoft.Logic/workflows`). Standard emits `Microsoft.Web/sites`-shaped
   metrics plus App Service Plan saturation signals - a different
   namespace and a different receiver scope. Confirm which hosting model
   your workflow uses before configuring the receiver; mixing them
   silently yields an empty metric set.
2. **Is cost attribution your priority?** `TotalBillableExecutions` is
   the single most actionable Consumption metric - Consumption bills per
   billable execution. If cost control is the whole reason you are here,
   the platform-metrics path alone is sufficient; you do not need logs.
3. **Do you need to know which action failed?** Surface metrics
   aggregate. `ActionsFailed` tells you an action in some run failed, not
   which action, in which run, with what error. Debugging failed runs
   needs the `WorkflowRuntime` logs path.
4. **Are your trigger or action payloads sensitive?** `IncludeContent`
   on the Diagnostic Setting captures trigger and action inputs and
   outputs verbatim. Leave it off for PII-bearing workflows; enable it
   only when you need payload-level forensics and have reviewed the
   privacy trade-off.

If you are starting from zero, platform metrics are the lowest-effort
win and cover run health plus cost. Add the logs path when you need
per-action attribution for failed or slow runs.

## What you'll monitor

The receiver scrapes the `Microsoft.Logic/workflows` namespace and emits
per-workflow metrics under `cloud.platform: azure_logic_apps`. These
metrics carry **no Azure Monitor metadata dimensions** - each is a
single series per workflow, so cardinality stays minimal and there is no
dimensional fan-out to budget for.

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `RunsStarted` | Total | Runs initiated. Pairs with `RunsCompleted` to expose in-flight backlog. |
| `RunsCompleted` | Total | Runs that reached a terminal state. |
| `RunsSucceeded` | Total | Runs that completed successfully. |
| `RunsFailed` | Total | Failed runs. Primary run-health SLI. |
| `RunsCancelled` | Total | Cancelled runs. |
| `RunLatency` | Average, Maximum | End-to-end run duration. Average for trend, Maximum for tail. Traffic-driven. |
| `ActionsStarted` | Total | Actions begun across all runs. |
| `ActionsCompleted` | Total | Actions that reached a terminal state. |
| `ActionsSucceeded` | Total | Actions that succeeded. |
| `ActionsFailed` | Total | Failed actions. Tells you an action failed, not which - see §Logs. |
| `ActionsSkipped` | Total | Actions skipped by `runAfter` conditions. |
| `ActionLatency` | Average, Maximum | Per-action duration, aggregated. Traffic-driven. |
| `TriggersStarted` | Total | Trigger evaluations begun. |
| `TriggersCompleted` | Total | Trigger evaluations completed. |
| `TriggersSucceeded` | Total | Successful trigger evaluations. |
| `TriggersFailed` | Total | Failed / rejected trigger evaluations. |
| `TriggersFired` | Total | Triggers that fired a run. The inbound-request counter for an HTTP Request trigger. |
| `TriggersSkipped` | Total | Trigger evaluations that did not fire. |
| `TriggerLatency` | Average, Maximum | Trigger evaluation duration. Traffic-driven. |
| `TotalBillableExecutions` | Total | Billable executions. The canonical Consumption cost SLI. Traffic-driven. |
| `BillableActionExecutions` | Total | Action-side billing split. Traffic-driven. |
| `BillableTriggerExecutions` | Total | Trigger-side billing split. Traffic-driven. |

**Traffic-driven vs continuous.** The count metrics (`Runs*`,
`Actions*`, `Triggers*`) publish an explicit `0` every minute even at
idle. The latency series (`RunLatency`, `ActionLatency`,
`TriggerLatency`) and the three billing metrics publish data points
**only for minutes that contain completed runs**. On a low-traffic
workflow these are sparse by design - an empty `RunLatency` minute means
no runs that minute, not a broken pipeline. When verifying the pipeline,
drive traffic and read the metrics within the same active window.

## Prerequisites

| Requirement | Detail |
| --- | --- |
| Hosting model | Consumption (`Microsoft.Logic/workflows`). Standard is out of scope - see [Azure App Service](./app-service.md). |
| OTel Collector Contrib | v0.151+   (the `azure_monitor` and `azure_event_hub` receiver names are snake_case from v0.148.0). |
| OpenTelemetry semconv | v1.41.0 (latest cloud attributes). |
| Azure CLI | 2.85+ for the `az monitor diagnostic-settings` flags used here. |
| Azure providers registered | `Microsoft.Logic`, plus `Microsoft.EventHub` and `Microsoft.Insights` for the logs path. |
| Collector runtime | See [Docker Compose Setup](../../collector-setup/docker-compose-example.md) or [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md); this guide adds the Logic Apps receiver + processor blocks on top. |
| Scout exporter | See [Scout exporter wiring](../../collector-setup/scout-exporter.md) for the `oauth2client` extension + `otlp_http/b14` exporter. This guide does not re-derive that block. |

## Access setup

The metrics receiver authenticates via a Service Principal scoped to the
resource group:

| Role | Scope | Reason |
| --- | --- | --- |
| `Monitoring Reader` | Resource group containing the workflow | Lets the receiver list metric definitions and read metric values for `Microsoft.Logic/workflows`. |

The logs path does **not** need a second role assignment. The
`azure_event_hub` receiver consumes the diagnostic hub through the
namespace-scoped SAS rule's `Listen` permission carried in its
connection string; no `Azure Event Hubs Data Receiver` role on the
namespace is required unless you switch the receiver to Azure AD auth.

If you reuse one Service Principal across many surfaces, the assignment
is idempotent - re-running it on an already-granted SP is a no-op. It
typically propagates in under 30 seconds; the first scrape after a fresh
assignment may return `403 AuthorizationFailed` and self-clears on the
next 60s cycle.

## Receiver configuration

Add the following alongside whatever already wires `azure_auth` and the
Scout exporter. **You do not need to duplicate** the `oauth2client`
extension or the `otlp_http/b14` exporter; those live in the shared base
config per [Scout exporter wiring](../../collector-setup/scout-exporter.md).

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_monitor/logicapps:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:LOGICAPPS_RESOURCE_GROUP}
    services:
      - Microsoft.Logic/workflows
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Logic/workflows":
        RunsStarted:               [Total]
        RunsCompleted:             [Total]
        RunsSucceeded:             [Total]
        RunsFailed:                [Total]
        RunsCancelled:             [Total]
        RunLatency:                [Average, Maximum]
        ActionsStarted:            [Total]
        ActionsCompleted:          [Total]
        ActionsSucceeded:          [Total]
        ActionsFailed:             [Total]
        ActionsSkipped:            [Total]
        ActionLatency:             [Average, Maximum]
        TriggersStarted:           [Total]
        TriggersCompleted:         [Total]
        TriggersSucceeded:         [Total]
        TriggersFailed:            [Total]
        TriggersFired:             [Total]
        TriggersSkipped:           [Total]
        TriggerLatency:            [Average, Maximum]
        TotalBillableExecutions:   [Total]
        BillableActionExecutions:  [Total]
        BillableTriggerExecutions: [Total]

processors:
  resource/logicapps:
    attributes:
      - {key: cloud.provider,              value: azure,                          action: insert}
      - {key: cloud.platform,              value: azure_logic_apps,               action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",  action: insert}
      - {key: cloud.region,                value: "${env:LOGICAPPS_REGION}",       action: insert}
      - {key: cloud.resource_id,           value: "${env:LOGICAPPS_RESOURCE_ID}",  action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}",            action: insert}
      - {key: service.name,                value: "${env:LOGICAPPS_SERVICE_NAME}", action: insert}

service:
  pipelines:
    metrics/logicapps:
      receivers: [azure_monitor/logicapps]
      processors: [memory_limiter, resource/logicapps, batch]
      exporters: [otlp_http/b14]
```

`use_batch_api: false` issues one query per metric per scrape. A single
Consumption workflow is a small query budget; switch to `true` only if
you scale this receiver across many workflows in one subscription.

## Environment variables

```bash title=".env"
AZURE_SUBSCRIPTION_ID=...
LOGICAPPS_RESOURCE_GROUP=...     # RG containing the workflow
LOGICAPPS_REGION=...             # for cloud.region; defaults to the RG region
LOGICAPPS_RESOURCE_ID=...        # full ARM ID of the workflow
LOGICAPPS_SERVICE_NAME=logic-apps-monitor
ENVIRONMENT=production
```

Service Principal credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`) and Scout exporter credentials come from the
shared base config and are not listed here. See
[Scout exporter wiring](../../collector-setup/scout-exporter.md).

## Operations

### RBAC propagation lag

`Monitoring Reader` on the resource group typically propagates in under
30 seconds, occasionally up to 120 seconds. The first scrape after a
fresh assignment may return `403 AuthorizationFailed`; the receiver
retries on the next 60s cycle and the noise clears within two polls.

### Latency and billing metrics are traffic-driven

`RunLatency`, `ActionLatency`, `TriggerLatency`, and the three billing
metrics publish data points only for minutes that contain completed
runs. The count metrics publish a continuous `0`. Do not alert on the
*absence* of latency data points - alert on the values when present.
When smoke-testing, drive a run and read the metric inside the same
minute window; a read several minutes after the last run shows only the
continuous count series.

### Metrics aggregate per workflow only

`Microsoft.Logic/workflows` metrics carry no metadata dimensions. There
is no per-action or per-trigger breakdown in the metric stream -
`ActionsFailed` is a workflow-wide counter. Per-action attribution is
the job of the `WorkflowRuntime` logs path (§Logs). This also means the
metric cardinality is one series per metric per workflow, so the
receiver's query and storage footprint scales linearly with workflow
count and nothing else.

### Consumption concurrency throttling

An HTTP Request trigger enforces a per-workflow concurrency limit.
Aggressive callers receive `HTTP 429` with a `Retry-After` header rather
than queuing unbounded. This surfaces as `TriggersFailed` /
`TriggersSkipped` in the metric stream; if you see them climb under
load, the caller is exceeding the workflow's concurrency budget, not the
pipeline failing.

### `WorkflowRuntime` logs warm-up

On a freshly started collector the `azure_event_hub` receiver spends
roughly 15-20 minutes establishing its Event Hubs consumer before the
first record is delivered downstream, even when records are already in
the hub. The Diagnostic Settings → Event Hubs leg is fast for Logic Apps
Consumption (records reach the hub within minutes of a run). Budget 20
minutes before treating an empty logs pipeline as broken, and **do not
restart the collector during that window** - a restart resets the
warm-up.

## Key alerts to configure

Once metrics are flowing, set up alerts on these thresholds. The "Why"
column gives the reasoning so you can adjust for your traffic shape.

| Signal | Warning | Critical | Why |
| --- | --- | --- | --- |
| `RunsFailed` / `RunsCompleted` ratio (5 min) | > 1% | > 5% | Run failure rate; the primary Logic Apps SLI. Sustained failure usually means a downstream dependency or a bad workflow revision. |
| `ActionsFailed` rate (5 min) | > 1% of `ActionsCompleted` | > 5% of `ActionsCompleted` | A single action failing repeatedly. Pair with the logs path to identify which action. |
| `RunLatency` Average (5 min) | > 1.5× rolling 24h mean | > 3× rolling 24h mean | Run-duration regression. Relative thresholds track normal workflow behaviour better than absolute seconds. |
| `TriggersFailed` (5 min) | > 0 sustained | > 1% of `TriggersFired` | Rejected or throttled trigger calls; co-fires with caller `HTTP 429`. |
| `TotalBillableExecutions` (1 h) | > 1.5× rolling 7d hourly mean | > 3× rolling 7d hourly mean | Cost-runaway detector. A workflow change that adds actions or loops shows here first. |
| `RunsStarted` − `RunsCompleted` backlog (10 min) | > 10 sustained | > 50 sustained | In-flight runs not completing; indicates a stuck action or a downstream timeout. |

Configure the Scout-side alert rules through your dashboarding /
alerting stack once thresholds are decided; the receiver pipeline above
emits the underlying signals continuously.

## Logs

The `WorkflowRuntime` Diagnostic Settings category fills the gaps the
metric whitelist structurally cannot. The §Logs path uses the
`azure_event_hub` receiver against a Diagnostic Settings → Event Hubs
sink.

### What logs uniquely fill

Platform metrics aggregate per workflow. Logs disaggregate. The gaps
logs uniquely cover for Logic Apps:

- **Which action failed.** `ActionsFailed` is a workflow-wide counter.
  The log stream names the action, its status, its error code, and the
  run it belonged to.
- **Per-trigger attribution.** Which caller / source fired which run,
  with the client tracking id, in what order across a burst.
- **Per-run forensic ordering.** The sequence of trigger fired → actions
  started → actions ended → run completed for a specific run, which
  metrics flatten into per-minute counts.
- **Trigger and action payloads (opt-in).** With `IncludeContent`
  enabled, the verbatim inputs and outputs of the trigger and each
  action - the only way to see what data a specific run actually
  processed.

### Architecture

```text
Logic Apps workflow (Consumption)
     │
     │ Diagnostic Setting (resource scope)
     │ category: WorkflowRuntime
     ↓
Event Hubs namespace (Basic 1 TU)
     │   • diagsend SAS rule (Send) writes records
     │   • collectorlisten SAS rule (Listen) reads records
     ↓
azure_event_hub receiver
     │   • format: azure
     │   • apply_semantic_conventions: true
     │   • multi-record envelopes decoded into individual log records
     ↓
otlp_http/b14 → Scout
```

The Diagnostic Setting targets the workflow resource directly.

### Category enabled by default

| Category | What it covers |
| --- | --- |
| `WorkflowRuntime` | Workflow run events: trigger fired (source, client tracking id), action started / succeeded / failed (per-action name, status, error code), run completed (final status, duration). With `IncludeContent: true`, also the verbatim trigger and action inputs / outputs. The only Logic Apps log category; `AllMetrics` is the metrics surface, covered by the metrics path above. |

**`IncludeContent` is an opt-in knob, not a default.** Leave it off
unless you need per-run inputs and outputs. When enabled, trigger and
action payloads are captured verbatim - review against your PII policy
before turning it on, and budget for Event Hubs Standard rather than
Basic if your workflows move large JSON payloads (records approach the
256 KB per-event Basic limit and can throttle 1 TU on bursty traffic).

### Receiver configuration (logs)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_event_hub/logicappslogs:
    connection: ${env:LOGICAPPSLOGS_CONNECTION_STRING}
    partition: ""           # consume all partitions
    offset: ""              # resume from last checkpoint
    format: azure           # decode the Azure resource-log envelope
    apply_semantic_conventions: true

processors:
  resource/logicappslogs:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_logic_apps,                            action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:LOGICAPPSLOGS_SOURCE_REGION}",        action: insert}
      - {key: cloud.resource_id,           value: "${env:LOGICAPPSLOGS_SOURCE_RESOURCE_ID}",   action: insert}
      - {key: deployment.environment.name, value: "${env:LOGICAPPSLOGS_ENVIRONMENT}",          action: insert}
      - {key: service.name,                value: "${env:LOGICAPPSLOGS_SERVICE_NAME}",         action: insert}

service:
  pipelines:
    logs/logicappslogs:
      receivers: [azure_event_hub/logicappslogs]
      processors: [memory_limiter, resource/logicappslogs, batch]
      exporters: [otlp_http/b14]
```

The receiver decodes multi-record Azure envelopes into individual OTel
log records, so the downstream record count is higher than the raw
envelope count the receiver reports - that fan-out is expected, not
duplication.

### Environment variables (logs)

```bash title=".env (logs path)"
LOGICAPPSLOGS_CONNECTION_STRING=...   # Listen SAS with ;EntityPath=<hub>
LOGICAPPSLOGS_SOURCE_REGION=...       # for cloud.region on log records
LOGICAPPSLOGS_SOURCE_RESOURCE_ID=...  # workflow ARM ID for cloud.resource_id
LOGICAPPSLOGS_SERVICE_NAME=logic-apps-logs
LOGICAPPSLOGS_ENVIRONMENT=production
```

Quote the connection string in your env file. It carries `;`-separated
segments - `Endpoint=...`, `SharedAccessKeyName=...`,
`SharedAccessKey=...`, `EntityPath=...`. Sourced unquoted into a shell,
the `;` truncates the value at the first segment. Most env-file loaders
handle this, but a shell-sourced `.env` needs single quotes.

### Wiring the Diagnostic Setting

```bash title="attach the Diagnostic Setting"
az monitor diagnostic-settings create \
  --resource "<workflow-resource-id>" \
  --name logicapps-runtime \
  --event-hub <hub-name> \
  --event-hub-rule "<diagsend-rule-id>" \
  --logs '[{"category":"WorkflowRuntime","enabled":true}]'
```

The `--event-hub-rule` value is the resource ID of the namespace-scoped
SAS rule with `Send` permission. The receiver uses a separate `Listen`
rule; one Send rule and one Listen rule on the namespace is the
canonical two-rule topology. To capture payloads, add
`"includeContent":true` to the log setting (review the PII trade-off
first).

### Verifying the logs path

After the Diagnostic Setting is attached and the workflow has completed
at least one run:

1. Wait up to 20 minutes. The Diagnostic Settings → Event Hubs leg is
   fast (records reach the hub within minutes), but the
   `azure_event_hub` receiver takes 15-20 minutes to establish its
   consumer on a freshly started collector. Do not restart the collector
   during this window - a restart resets the warm-up.
2. Tail the collector debug exporter:
   `docker compose logs -f otel-collector | grep "otelcol.signal.*logs"`.
3. Expect batches of log records every 60-90 seconds while runs are
   flowing; the receiver-reported envelope count is lower than the
   downstream record count because envelopes carry multiple records.
4. In Scout, filter `service.name = 'logic-apps-logs'` and
   `cloud.platform = 'azure_logic_apps'` to confirm records land.

## Troubleshooting

### `AuthorizationFailed` on the first scrape

**Cause:** The `Monitoring Reader` assignment on the resource group has
not propagated yet. **Fix:** Wait two polling cycles (~2 minutes). The
receiver retries automatically; the error self-clears.

### Latency or billing metrics show no data

**Cause:** These metrics are traffic-driven - Azure publishes data
points only for minutes containing completed runs. **Fix:** Drive a run
and read the metric inside the same minute. An idle workflow shows only
the continuous count series; that is correct behaviour, not a gap.

### Logs pipeline empty for ~20 minutes after wiring

**Cause:** The `azure_event_hub` receiver's initial consumer
establishment takes 15-20 minutes on a freshly started collector. **Fix:**
Wait it out. Confirm records are arriving in the hub
(`az monitor metrics list --metric IncomingMessages` on the Event Hubs
namespace shows non-zero) to prove the Diagnostic Setting is delivering;
the gap is downstream warm-up, not the Diagnostic Setting. Do not restart
the collector to "kick" it - that resets the warm-up clock.

### Caller receives `HTTP 429` from the trigger

**Cause:** The workflow's per-instance concurrency limit. **Fix:** Space
the calls out or raise the workflow's concurrency control. This is Logic
Apps protecting the workflow, not a telemetry fault; it shows as
`TriggersFailed` / `TriggersSkipped` in the metric stream.

### `azure_event_hub` receiver logs `MessagingGatewayBadRequest`

**Cause:** The receiver is requesting a user-defined consumer group that
does not exist on Event Hubs Basic. **Fix:** Basic rejects user-defined
consumer groups - the receiver must consume from `$Default`, the
implicit group. Remove any `consumer_group:` key, or move the namespace
to Standard if you need multiple consumers.

### Metric set is empty although the workflow exists

**Cause:** The workflow is Standard hosting (`Microsoft.Web/sites`
`kind=workflowapp`), not Consumption. **Fix:** This guide's receiver
scopes `Microsoft.Logic/workflows`. For Standard, follow
[Azure App Service](./app-service.md).

## Frequently Asked Questions

### How do I monitor Azure Logic Apps with OpenTelemetry?

Logic Apps Consumption has two telemetry paths. Platform metrics use the
`azure_monitor` receiver against `Microsoft.Logic/workflows` for run,
action, and trigger lifecycle counts, latency, and billable executions.
Resource logs use the `azure_event_hub` receiver consuming the
`WorkflowRuntime` Diagnostic Settings category for per-action
drill-down. There is no in-system scrape path: the Consumption runtime
is fully Microsoft-managed with no data-plane endpoint.

### Why are RunLatency and billable-execution metrics empty on my Logic App?

Logic Apps latency and billable-execution metrics are traffic-driven:
Azure publishes data points only for minutes that contain completed
runs. The run, action, and trigger count metrics publish an explicit
zero every minute even at idle, but latency and billing series are
sparse by design on a low-traffic workflow. An empty minute means no
runs that minute, not a broken pipeline.

### Which Logic Apps cost metric should I alert on?

`TotalBillableExecutions` is the canonical Consumption cost SLI -
Consumption bills per billable execution. `BillableActionExecutions` and
`BillableTriggerExecutions` split that total between action and trigger
executions so you can attribute cost growth to a specific workflow
change.

### Why does the WorkflowRuntime logs pipeline take ~20 minutes?

On a freshly started collector the `azure_event_hub` receiver spends
roughly 15 to 20 minutes establishing its Event Hubs consumer before it
delivers the first record downstream, even when records are already in
the hub. The Diagnostic Settings to Event Hubs leg itself is fast for
Logic Apps Consumption - records reach the hub within minutes of a run.
Budget 20 minutes before treating an empty logs pipeline as broken, and
do not restart the collector during that window because a restart resets
the warm-up.

### Can surface metrics tell me which action in my workflow failed?

No. `Microsoft.Logic/workflows` metrics carry no metadata dimensions -
they aggregate per workflow only. `ActionsFailed` tells you an action
failed, not which one. The `WorkflowRuntime` logs path gives per-action
name, status, and error code, so debugging a failed run needs the logs
path.

### Does this guide cover Logic Apps Standard?

No. Standard hosting runs on `Microsoft.Web/sites` with
`kind=workflowapp` and emits App Service-shaped metrics plus App Service
Plan signals. Follow [Azure App Service](./app-service.md) for Standard.
This guide is Consumption only (`Microsoft.Logic/workflows`).

## Related Guides

### Shared collector + Scout wiring

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  the runtime that hosts both receivers in this guide.
- [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  alternative runtime for AKS-hosted collectors.
- [Scout exporter wiring](../../collector-setup/scout-exporter.md) - the
  `oauth2client` extension + `otlp_http/b14` exporter shared by all
  Azure guides.

### Adjacent Azure surfaces

- [Azure App Service](./app-service.md) - where Logic Apps Standard runs;
  the path for workflow apps not on Consumption.
- [Azure Event Hubs](./event-hubs.md) - the streaming layer this guide's
  logs path runs through; monitor the hub itself when log volume grows.
- [Azure Service Bus](./service-bus.md) - the messaging backbone many
  workflows trigger from or publish to.
- [Azure API Management](./api-management.md) - the gateway that commonly
  fronts HTTP-triggered workflows.
- [Azure Key Vault](./key-vault.md) - the secrets store workflows
  reference for connection credentials.

### Migrating from Application Insights

- [Application Insights migration](../../apps/auto-instrumentation/dotnet.md) -
  moving app-side telemetry off Application Insights while keeping Azure
  Monitor as the metric source for this guide.
