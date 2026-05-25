---
date: 2026-05-18
id: collecting-azure-container-registry-telemetry
title: Azure Container Registry Monitoring with OpenTelemetry - Pull/Push Metrics and Audit Logs
sidebar_label: Azure Container Registry
sidebar_position: 21
description:
  Wire Azure Container Registry pull, push, and ACR Tasks telemetry into
  your existing OpenTelemetry Collector and ship it to base14 Scout.
  Covers the traffic-gated pull/push counters, why import and ACR Tasks
  builds produce metrics but no audit logs, and the resource-scope
  Activity Log path for repository and login audit.
keywords:
  - azure container registry opentelemetry
  - acr pull push metrics
  - acr storage used metric
  - acr tasks run duration
  - container registry audit logs
  - containerregistryrepositoryevents
  - containerregistryloginevents
  - azure monitor receiver acr
  - azure event hub receiver
  - base14 scout azure container registry
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure Container Registry with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and a single azure_monitor receiver scoped to Microsoft.ContainerRegistry/registries, route it into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing the registry. The receiver polls Azure Monitor every 60 seconds. The pull and push counters are traffic-gated: a registry with no pull or push activity in a given minute publishes zero counts, which is expected and not a misconfiguration."}},{"@type":"Question","name":"Why does my registry produce metrics but no audit logs?","acceptedAnswer":{"@type":"Answer","text":"Pull and push metrics and the ContainerRegistryRepositoryEvents and ContainerRegistryLoginEvents audit logs are driven by different operations. az acr import and ACR Tasks builds are server-side control-plane operations: they move the pull and push metric counters but do not generate audit records. The audit categories fire only on genuine data-plane repository operations - docker push, docker pull, delete, untag - and the token-exchange logins that authenticate them. A CI pipeline that only uses az acr import or ACR Tasks will correctly show healthy pull and push metrics with no audit logs; that is expected, not a fault."}},{"@type":"Question","name":"Why is the StorageUsed metric empty on my new registry?","acceptedAnswer":{"@type":"Answer","text":"StorageUsed is computed on Azure Container Registry's own internal storage-accounting cadence, which lags the first push by tens of minutes to hours. A freshly populated registry shows an empty or flat StorageUsed series for a while even though images are present. Treat it as the slow-moving capacity-trend gauge, not a real-time signal, and do not alert on its absence on a new registry."}},{"@type":"Question","name":"Why is AgentPoolCPUTime always zero?","acceptedAnswer":{"@type":"Answer","text":"AgentPoolCPUTime emits only for dedicated ACR Tasks agent pools. Quick-Task builds (az acr build) run on the shared managed build pool, which does not drive this metric. If you do not run dedicated agent pools, AgentPoolCPUTime stays at zero by design - it is task-conditional, not a gap. Keep it whitelisted; a metric that never emits produces no series, so it adds no cardinality or query cost."}},{"@type":"Question","name":"How do I alert on push or pull failures?","acceptedAnswer":{"@type":"Answer","text":"Each operation has a Total counter and a Successful counter (TotalPushCount vs SuccessfulPushCount, TotalPullCount vs SuccessfulPullCount). The gap between them is the failure count. Alert on a sustained non-zero Total-minus-Successful delta rather than a fixed threshold, since a healthy registry has Total equal to Successful. A rising delta on pulls usually means client authentication or quota problems; on pushes it usually means image-size or quota limits."}},{"@type":"Question","name":"How do I audit who pushed or pulled an image?","acceptedAnswer":{"@type":"Answer","text":"Configure a resource-scope Diagnostic Setting on the registry forwarding ContainerRegistryRepositoryEvents and ContainerRegistryLoginEvents to an Event Hubs hub, point the azure_event_hub receiver at the hub, and ship the decoded records to Scout. RepositoryEvents records per-repository push, pull, delete, and untag with the requesting identity, repository, tag, and digest. LoginEvents records registry authentication attempts with identity and source IP. Because the Diagnostic Setting is scoped to the registry, every record already belongs to it - no provider filter is needed, unlike a subscription-scope Activity Log path."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for Azure Container Registry,
the managed OCI (Open Container Initiative) registry behind your image
pulls and pushes. For the
cross-surface architecture (auth, push vs pull, latency, the trace
gap), read [Azure Monitoring with OpenTelemetry - Architecture for
base14 Scout](./overview.md) first.

This guide is for engineers who run a container registry in production
and want pull/push, ACR Tasks, and storage telemetry plus a
control-plane audit trail in an existing OpenTelemetry Collector,
shipped to base14 Scout. The collector polls Azure Monitor's REST API
for `Microsoft.ContainerRegistry/registries` every 60 seconds, and a
sibling pipeline ingests registry audit operations from a
resource-scope Diagnostic Setting via Event Hubs as OTel logs.

A managed registry has two real telemetry paths, and the third - the
one that does not exist - is part of the decision:

- **Platform metrics - Azure Monitor.** Pull/push counts, ACR Tasks
  run duration, accumulated storage. The default operational view of
  registry health and throughput.
- **Repository and login audit - resource-scope Diagnostic Settings.**
  `ContainerRegistryRepositoryEvents` and
  `ContainerRegistryLoginEvents` through Event Hubs. The forensic and
  access-audit trail - who pushed or pulled what, and who logged in.
- **There is no in-system scrape path.** A managed registry exposes no
  internal endpoint to scrape the way a self-hosted database does. The
  complementary signal is client-side: the CI pipeline that pushes and
  pulls can emit its own OpenTelemetry spans. That is an
  application-instrumentation concern, not a registry scrape - see the
  per-language guides under `instrument/{language}/`.

> **Pull and push counts are traffic-gated.** In any minute with no
> pull or push, `TotalPullCount` and `TotalPushCount` are zero. An
> idle registry publishes zero counts and a flat storage gauge. This
> is the single most important interpretation caveat: an empty count
> in a minute with no pull or push is expected behaviour, not a receiver,
> whitelist, or RBAC failure.
>
> **Metrics and audit logs need different traffic.** This is the
> defining operational fact of this surface. `az acr import` and ACR
> Tasks builds (`az acr build`) are server-side control-plane
> operations: they move the pull/push **metric** counters but produce
> **no audit log records**. The `ContainerRegistryRepositoryEvents`
> and `ContainerRegistryLoginEvents` categories fire only on genuine
> data-plane repository operations (`docker push`, `docker pull`,
> delete, untag) and the token-exchange logins that authenticate them.
> A CI pipeline built entirely on `az acr import` or ACR Tasks will
> correctly show healthy pull/push metrics and no audit logs - that is
> expected, and the §Logs section below tells you how to read it.

## What you'll monitor

The table is keyed by the Azure metric name (the authoritative name
from Microsoft's supported-metrics reference). The receiver emits each
as a lowercase snake-cased `azure_*` series with the aggregation
suffixed.

| Azure metric | Aggregation | Use case |
| --- | --- | --- |
| `TotalPullCount` | Total | All image pull attempts. Traffic-gated - zero in any minute with no pulls. |
| `SuccessfulPullCount` | Total | Pulls that returned success. `Total` minus `Successful` is the pull failure count. |
| `TotalPushCount` | Total | All image push attempts. Traffic-gated. |
| `SuccessfulPushCount` | Total | Pushes that returned success. The push failure count is the gap to `Total`. |
| `RunDuration` | Total | ACR Tasks run wall-clock (milliseconds). Emits only when ACR Tasks run; one value per task run. |
| `AgentPoolCPUTime` | Total | Dedicated ACR Tasks agent-pool CPU seconds. **Emits only with dedicated agent pools** - Quick-Task builds use the shared pool and do not drive it. Task-conditional, keep in the whitelist. |
| `StorageUsed` | Average | Accumulated registry storage (bytes). The capacity-trend gauge. **Computed on a slow internal cadence** - a freshly populated registry shows an empty or flat series for tens of minutes to hours. Not a real-time signal. |

`RunDuration`, `AgentPoolCPUTime`, and `StorageUsed` are
**conditional by design**, not gaps:

- `RunDuration` is zero on a registry used purely as an image store
  (no ACR Tasks). It is the task-execution signal, not a
  registry-health one.
- `AgentPoolCPUTime` needs dedicated agent pools. Shared-pool
  Quick-Task builds never drive it. Keep it whitelisted - a metric
  that never emits produces no series, so it adds no cardinality or
  query cost - but do not alert on it unless you run dedicated pools.
- `StorageUsed` populates on Azure Container Registry's own
  storage-accounting cadence. Treat an absent or flat series on a new
  or low-churn registry as expected; it is a slow trend line, not a
  live counter.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, and pipeline are all keyed `/acr` so they coexist with
other Azure receivers under one collector and one Scout exporter.
`Microsoft.ContainerRegistry/registries` emits **no `metadata_*`
dimensions** (six of the seven metrics carry no dimensions at all;
`StorageUsed` carries a single `Geolocation` dimension). The
duplicate-case-dimension defect that `azuremonitorreceiver` exhibits
on some Azure namespaces (a metric emitting both `metadata_Foo` and
`metadata_foo`) therefore cannot occur here, so no `transform`
processor is required. Re-verify after a receiver upgrade if you add
metrics.

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/acr:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:ACR_RESOURCE_GROUP}
    services:
      - Microsoft.ContainerRegistry/registries
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.ContainerRegistry/registries":
        TotalPullCount:       [Total]
        SuccessfulPullCount:  [Total]
        TotalPushCount:       [Total]
        SuccessfulPushCount:  [Total]
        RunDuration:          [Total]
        AgentPoolCPUTime:     [Total]
        StorageUsed:          [Average]

processors:
  resource/acr:
    attributes:
      - {key: cloud.provider,   value: azure,                          action: insert}
      - {key: cloud.platform,   value: azure_container_registry,       action: insert}
      - {key: cloud.account.id, value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: cloud.region,     value: "${env:ACR_REGION}",            action: insert}
      - {key: cloud.resource_id, value: "${env:ACR_RESOURCE_ID}",      action: insert}
      - {key: service.name,     value: "${env:ACR_SERVICE_NAME}",      action: insert}

service:
  pipelines:
    metrics/acr:
      receivers: [azure_monitor/acr]
      processors: [resource/acr, batch]
      exporters: [otlp_http/b14]
```

`StorageUsed` supports only the `Average` aggregation; the six
counters support `Total`. The whitelist above uses each metric's
correct aggregation - Azure Monitor rejects an unsupported
aggregation request, so this matters.

## Authentication and RBAC

The collector authenticates to Azure Monitor as a service principal
holding **`Monitoring Reader`** at the **resource group** containing
the registry. Resource-group scope is the minimum necessary;
subscription scope works but is broader than needed.

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Monitoring Reader" \
  --scope "$(az group show --name <rg> --query id -o tsv)"
```

`Monitoring Reader` is sufficient for the metrics path. The collector
never touches the registry data plane - it does not pull or push
images. None of the `AcrPull` / `AcrPush` data-plane roles are
required for telemetry.

Disable the registry admin user (`adminUserEnabled: false`): it is a
shared static credential and a supply-chain risk. Microsoft Entra ID
token auth replaces it without changing the metric set. The logs path
adds one separate requirement - see [Logs](#logs).

A control-plane RBAC propagation delay applies after first assignment:
typically 60-300 seconds before the receiver's `metricDefinitions` and
`metrics` REST calls succeed. The receiver retries on its 60-second
poll cycle. `metricDefinitions` populating and the counters reading
non-zero are two independent conditions, and conflating them is the
usual first-poll mistake:

- **Definitions empty after RBAC propagates.** If a freshly created
  registry still shows `metrics_definitions_count: 0` after the
  60-300 second propagation window, restart the collector once.
- **Counters zero but definitions present.** This is not an error -
  the pull/push counters stay zero until the registry actually carries
  a pull or push (the traffic-gating caveat in the Overview).
  Restarting the collector will not change this; only traffic will.

## Cardinality control

This namespace is one of the lowest-cardinality Azure surfaces. Six of
the seven metrics carry no dimensions; `StorageUsed` carries a single
`Geolocation` dimension (one value on Basic and Standard - geo-replica
locations on Premium add one series per replica region).

| Attribute | Source | Cardinality |
| --- | --- | --- |
| `azuremonitor.resource_id` | Receiver | One per registry (low). |
| `name` | Receiver | One per registry. |
| `resource_group` | Receiver | One per RG. |
| `Geolocation` (`StorageUsed` only) | Azure Monitor | One on Basic/Standard; one per geo-replica region on Premium. Bounded. |

A single registry lands at roughly seven series per scrape (one per
metric, plus one extra `StorageUsed` series per geo-replica region on
Premium). Series count scales linearly with registry count and is
independent of registry traffic, so a fleet stays low-cardinality.

## Alert tuning

Container-registry alerting centres on **operation failures** and
**ACR Tasks health**. The pull/push counts themselves are workload
volume, not an alerting signal.

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **Push failures** | `TotalPushCount` minus `SuccessfulPushCount` | > 0 sustained / 5m | rising / 5m | A healthy registry has `Total` equal to `Successful`. A sustained gap usually means image-size limits, quota, or auth. |
| **Pull failures** | `TotalPullCount` minus `SuccessfulPullCount` | > 0 sustained / 5m | rising / 5m | A rising pull-failure delta usually means client auth or throttling - often a misconfigured deployment pulling with the wrong identity. |
| **ACR Tasks duration** | `RunDuration` | no fixed threshold - see Notes | no fixed threshold - see Notes | Only meaningful if you run ACR Tasks. There is no absolute threshold: alert on a regression against the build's own rolling baseline (for example, a sustained increase over the task's trailing-7-day median across 3 consecutive runs). |
| **Storage growth** | `StorageUsed` | trend | trend | Slow gauge. Use it for capacity-trend alerting (untagged-manifest bloat, missing retention policy), never for real-time signals. |

`AgentPoolCPUTime` has no recommended alert unless you run dedicated
agent pools; on shared-pool Quick Tasks it stays zero by design.

## Logs

Resource-level metrics count pulls and pushes but cannot answer
**who** did what to **which image**, **when**, **from where**, or
**whether a login failed**. The registry audit categories fill
exactly those gaps:

- **Per-operation repository audit.**
  `ContainerRegistryRepositoryEvents` records each push, pull, delete,
  and untag per repository with the requesting identity, repository,
  tag, and digest. The metrics path sees the pull count rise but
  cannot attribute the pull to a principal or an image.
- **Authentication audit.** `ContainerRegistryLoginEvents` records
  registry authentication attempts - success and failure, identity,
  source IP. This is the supply-chain access signal: an unexpected
  principal or source IP authenticating to the registry, or a burst of
  failed logins, shows up here and nowhere in the metrics.
- **Change forensics.** The push/pull/delete history per repository is
  the audit trail for "when did this tag get overwritten" and "who
  removed this image", which the aggregate counters cannot reconstruct.

A defining caveat applies before any wiring: **the audit categories
capture only genuine data-plane operations and the logins that
authenticate them.** `az acr import` and ACR Tasks builds move the
pull/push metric counters but generate no audit records (see the
Overview caveat). The operations that do produce an audit trail are
`docker push` / `docker pull`, `az acr repository delete` / `untag`,
and the `az acr login` / token-exchange that authenticates a client. A
pipeline that only imports or runs Tasks builds produces metrics and
no audit logs - expected, not a broken pipeline.

Azure Container Registry exposes per-resource Diagnostic Settings
categories, so this is the **resource-scope** Diagnostic Settings
shape (the same as [Storage](./storage.md) and
[Key Vault](./key-vault.md)), not the subscription-scope Activity Log
path that [Compute](./compute.md) uses. The practical consequence:
because the Diagnostic Setting is scoped to the registry, every record
already belongs to it. There is no subscription-wide stream to filter
down and no provider-scoping processor to maintain - a single guard
that drops records with no resource ID is all the collector needs.

The recommended pattern is **registry Diagnostic Settings to Event
Hubs to `azure_event_hub`** in the same collector. The receiver
ingests events as OTel logs and the resource processor tags them with
`cloud.platform: azure_container_registry`. Everything routes to Scout
via the same `oauth2client` / `otlp_http/b14` pipeline used for
metrics.

```yaml showLineNumbers title="otel-collector.yaml (logs excerpt)"
receivers:
  azure_event_hub/acrlogs:
    connection: ${env:ACRLOGS_CONNECTION_STRING}
    partition: ""
    offset: ""
    format: azure
    apply_semantic_conventions: true

processors:
  filter/acronly:
    error_mode: ignore
    logs:
      log_record:
        - 'resource.attributes["cloud.resource_id"] == nil'

  resource/acrlogs:
    attributes:
      - {key: cloud.provider,   value: azure,                          action: insert}
      - {key: cloud.platform,   value: azure_container_registry,       action: insert}
      - {key: cloud.account.id, value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: cloud.region,     value: "${env:ACRLOGS_REGION}",        action: insert}
      - {key: service.name,     value: "${env:ACRLOGS_SERVICE_NAME}",  action: insert}

service:
  pipelines:
    logs/acrlogs:
      receivers: [azure_event_hub/acrlogs]
      processors: [filter/acronly, resource/acrlogs, batch]
      exporters: [otlp_http/b14]
```

The `connection` string must include the `EntityPath=<hub-name>`
suffix so the receiver knows which hub to consume. The receiver
defaults to all partitions from the oldest offset (`partition: ""`,
`offset: ""`); on collector restart it re-reads from the saved offset,
giving at-least-once delivery.

> **Why the filter is one line, not a provider regex.** The
> `azure_event_hub` receiver with `format: azure` plus
> `apply_semantic_conventions: true` places the per-record Azure
> resource ID at `resource.attributes["cloud.resource_id"]` (OTel
> semantic-conventions form, **not** `azure.resource.id`) and
> uppercases it. Because the Diagnostic Setting is registry-scoped,
> every record already belongs to this registry - there is nothing to
> filter out by provider. The single rule drops only records that
> arrive without a resource ID at all. This is the structural
> simplification of resource-scope over subscription-scope: no
> provider scoping to maintain.

### Wiring the registry Diagnostic Setting

Resource-scope Diagnostic Settings use `az monitor
diagnostic-settings create` with `--resource <registry-id>`:

```bash
az monitor diagnostic-settings create \
  --name acr-audit \
  --resource "$ACR_RESOURCE_ID" \
  --event-hub "$EVENT_HUB_NAME" \
  --event-hub-rule "$DIAG_SEND_RULE_ARM_ID" \
  --logs '[{"category":"ContainerRegistryRepositoryEvents","enabled":true},
           {"category":"ContainerRegistryLoginEvents","enabled":true}]'
```

`--event-hub-rule` is the full Azure Resource Manager (ARM) resource
ID of a namespace-level Shared Access Signature (SAS) authorization
rule with `Send` rights. Creating a resource-scope
Diagnostic Setting requires write access on the registry and on the
Event Hubs authorization rule; it does **not** need the
subscription-scope `Monitoring Contributor` role or the operator
identity split that a subscription-scope Activity Log path requires.
This is the single-service-principal, Listen-SAS shape.

### Diagnostic Settings ship cadence

Azure batches registry audit records and ships them to Event Hubs on a
non-real-time cadence:

- **First batch from a freshly-wired Diagnostic Setting: 5-20
  minutes**, measured from the first genuine data-plane operation -
  not from when the Diagnostic Setting was created. With no eligible
  operations (import / Tasks-build only), no batch ever ships, which
  is correct behaviour and not a delay.
- **Steady-state batches: 5-15 minutes.**
- **End-to-end latency from operation to Scout: 5-20 minutes.** Audit
  visibility is **not** real-time. For real-time supply-chain
  monitoring use Microsoft Defender for Containers; the OTel path is
  for audit retention, compliance reporting, and forensic analysis
  where minutes of lag is acceptable.

### Why not other categories

`Microsoft.ContainerRegistry/registries` exposes exactly the two audit
categories above plus the `AllMetrics` metric category (covered by the
Azure Monitor path, not the Diagnostic Setting). There is no
equivalent of Storage's per-service split or Key Vault's policy
categories - the two enabled categories are the complete audit
surface. Enable both; there is nothing else to route elsewhere.

## Troubleshooting

### Pull or push counts are zero

Symptom: the receiver discovers the registry but `TotalPullCount` /
`TotalPushCount` stay at zero. Cause: the counts are traffic-gated -
no pull or push happened in that minute. Fix: confirm activity with
`az acr repository list --name <registry>`; this is expected
behaviour on a quiet registry, not a receiver or RBAC fault.

### Metrics flow but no audit logs appear

Symptom: pull/push metrics are healthy in Scout but no
`ContainerRegistryRepositoryEvents` / `ContainerRegistryLoginEvents`
records arrive, even after 30+ minutes. Cause: the traffic is
`az acr import` or ACR Tasks builds only - server-side operations that
drive metrics but generate no audit records. Fix: this is expected.
Audit records require data-plane operations (`docker push`,
`docker pull`, `az acr repository delete` / `untag`) and the
token-exchange logins that authenticate them. Verify with the Event
Hubs `IncomingMessages` metric: if it is zero, no eligible operations
have occurred yet - the issue is upstream of the collector.

### `StorageUsed` is empty on a new registry

Symptom: `StorageUsed` returns an empty series even though images are
present. Cause: Azure Container Registry computes registry storage on
a slow internal accounting cadence that lags the first push by tens of
minutes to hours. Fix: wait; treat it as a slow capacity-trend gauge,
not a real-time signal. Do not alert on its absence on a new registry.

### `AgentPoolCPUTime` stays at zero

Symptom: `AgentPoolCPUTime` never emits a non-zero value. Cause: it
emits only for dedicated ACR Tasks agent pools; `az acr build`
Quick-Task runs use the shared managed pool. Fix: expected unless you
run dedicated agent pools. Keep the metric whitelisted; it costs
nothing when absent.

### Event Hubs empty for up to ~20 minutes after the first data-plane operation

Symptom: `azure_event_hub/acrlogs` reports zero records for up to
~20 minutes after the first eligible operation. Cause: two waits run
concurrently on a fresh collector - the receiver's initial consumer
warm-up (~15-20 minutes) and the Diagnostic Setting first-batch
cadence (5-20 minutes, measured from the first data-plane operation).
The combined worst case is ~20 minutes; an already-warm receiver sees
only the 5-20 minute first-batch wait. Fix: wait. Do not force-recreate
the collector during the window - that resets the consumer warm-up
clock and looks like the pipeline is dead. If it stays empty well past
20 minutes, check Event Hubs `IncomingMessages`: if it is zero, no
eligible data-plane operations have occurred (the issue is upstream of
the collector, not the receiver).

### Scout OAuth2 returns 401

Symptom: the `oauth2client` extension logs 401 from the token
endpoint. Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` /
`SCOUT_TOKEN_URL`. Fix: re-source the Scout credential env file (or
the equivalent secret store) and restart the collector.

## Frequently Asked Questions

### How do I monitor Azure Container Registry with OpenTelemetry?

Add the `azure_auth` extension and a single `azure_monitor` receiver
scoped to `Microsoft.ContainerRegistry/registries`, route it into a
metrics pipeline that exports to Scout via the
`oauth2client`-authenticated OTLP/HTTP exporter, and grant the
collector's service principal `Monitoring Reader` at the resource
group containing the registry. The receiver polls Azure Monitor every
60 seconds. The pull and push counters are traffic-gated: a registry
with no pull or push activity in a given minute publishes zero counts,
which is expected and not a misconfiguration.

### Why does my registry produce metrics but no audit logs?

Pull and push metrics and the `ContainerRegistryRepositoryEvents` and
`ContainerRegistryLoginEvents` audit logs are driven by different
operations. `az acr import` and ACR Tasks builds are server-side
control-plane operations: they move the pull and push metric counters
but do not generate audit records. The audit categories fire only on
genuine data-plane repository operations - `docker push`,
`docker pull`, delete, untag - and the token-exchange logins that
authenticate them. A CI pipeline that only uses `az acr import` or ACR
Tasks will correctly show healthy pull and push metrics with no audit
logs; that is expected, not a fault.

### Why is the StorageUsed metric empty on my new registry?

`StorageUsed` is computed on Azure Container Registry's own internal
storage-accounting cadence, which lags the first push by tens of
minutes to hours. A freshly populated registry shows an empty or flat
`StorageUsed` series for a while even though images are present. Treat
it as the slow-moving capacity-trend gauge, not a real-time signal,
and do not alert on its absence on a new registry.

### Why is AgentPoolCPUTime always zero?

`AgentPoolCPUTime` emits only for dedicated ACR Tasks agent pools.
Quick-Task builds (`az acr build`) run on the shared managed build
pool, which does not drive this metric. If you do not run dedicated
agent pools, `AgentPoolCPUTime` stays at zero by design - it is
task-conditional, not a gap. Keep it whitelisted; a metric that never
emits produces no series, so it adds no cardinality or query cost.

### How do I alert on push or pull failures?

Each operation has a `Total` counter and a `Successful` counter
(`TotalPushCount` vs `SuccessfulPushCount`, `TotalPullCount` vs
`SuccessfulPullCount`). The gap between them is the failure count.
Alert on a sustained non-zero `Total` minus `Successful` delta rather
than a fixed threshold, since a healthy registry has `Total` equal to
`Successful`. A rising delta on pulls usually means client
authentication or quota problems; on pushes it usually means
image-size or quota limits.

### How do I audit who pushed or pulled an image?

Configure a resource-scope Diagnostic Setting on the registry
forwarding `ContainerRegistryRepositoryEvents` and
`ContainerRegistryLoginEvents` to an Event Hubs hub, point the
`azure_event_hub` receiver at the hub, and ship the decoded records to
Scout. RepositoryEvents records per-repository push, pull, delete, and
untag with the requesting identity, repository, tag, and digest.
LoginEvents records registry authentication attempts with identity and
source IP. Because the Diagnostic Setting is scoped to the registry,
every record already belongs to it - no provider filter is needed,
unlike a subscription-scope Activity Log path.

## Reference

- [Microsoft.ContainerRegistry/registries supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-containerregistry-registries-metrics)
- [Azure Container Registry monitor reference (log
  categories)](https://learn.microsoft.com/azure/container-registry/monitor-container-registry-reference)
- [Azure Monitor Activity Log
  schema](https://learn.microsoft.com/azure/azure-monitor/essentials/activity-log-schema)
- [opentelemetry-collector-contrib
  azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- [opentelemetry-collector-contrib
  azureeventhubreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azureeventhubreceiver)

## Related Guides

- [Azure Monitoring with OpenTelemetry - Architecture](./overview.md) -
  start here for the cross-surface story.
- [Azure Key Vault](./key-vault.md) - the closest companion: another
  pure-PaaS surface with a resource-scope Diagnostic Settings audit
  path through Event Hubs.
- [Azure Storage](./storage.md) - resource-scope Diagnostic Settings
  logs counterpart; a common target for images and artifacts.
- [Azure Compute](./compute.md) - the VMs and scale sets that pull
  images from this registry; the subscription-scope Activity Log
  contrast to this guide's resource-scope path.
- [Azure Kubernetes Service](./aks.md) - the most common image-pull
  consumer of a registry; pair registry pull metrics with cluster
  workload telemetry.
