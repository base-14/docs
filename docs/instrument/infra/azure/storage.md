---
date: 2026-05-06
id: collecting-azure-storage-telemetry
title: Azure Storage Monitoring with OpenTelemetry - Multi-Service Wiring for SREs
sidebar_label: Azure Storage
sidebar_position: 8
description:
  Wire Azure Storage metrics (Blob, Queue, Table, File) into your existing
  OpenTelemetry Collector and ship to base14 Scout. Production-shaped guidance
  on the multi-namespace receiver shape, sub-service granularity, the PT1H
  capacity-metric gap, dimension cardinality, alert tuning, and the migration
  path from Application Insights.
keywords:
  - azure storage monitoring
  - azure blob queue table file opentelemetry
  - azure monitor receiver
  - storage account managed identity
  - workload identity federation
  - storage transactions metrics
  - storage capacity metrics pt1h
  - storage cardinality apiname authentication
  - application insights alternative
  - base14 scout azure storage
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Storage metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to all five Storage namespaces (Microsoft.Storage/storageAccounts plus the four sub-services blobServices, queueServices, tableServices, fileServices), then route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every 60 seconds and emits one OTel metric per Azure aggregation; the azuremonitor.resource_id data-point attribute splits each series by sub-service. No data-plane connection to Storage; the account is never on the collector's path."}},{"@type":"Question","name":"Why do my UsedCapacity and BlobCount metrics not appear after I provision a new storage account?","acceptedAnswer":{"@type":"Answer","text":"Capacity-class metrics on Microsoft.Storage namespaces have a PT1H time grain - Azure Monitor publishes them once per hour, not per minute. The v0.151.0 azuremonitorreceiver passes each metric's natural time grain as both interval and timespan when querying Azure Monitor; for fresh accounts this query window can fall outside the publishing schedule and capacity points get skipped. PT1M Transaction-class metrics (Transactions, Ingress, Egress, Availability, latency) flow within 2-3 minutes; for capacity observability run a second receiver instance with collection_interval at 3600 seconds, or fall back to Diagnostic Settings to Log Analytics. Issue #46047 in opentelemetry-collector-contrib tracks the underlying class of problem."}},{"@type":"Question","name":"How do I attribute Transactions to a specific sub-service (Blob vs Queue vs Table vs File)?","acceptedAnswer":{"@type":"Answer","text":"Whitelist Transactions on each of the five namespaces in the metrics map. The receiver emits one azure_transactions_total series per resource scope, distinguishable by the azuremonitor.resource_id data-point attribute - account-level rollup uses .../storageAccounts/<sa>, sub-services append /<service>Services/default. The account-level series is the rollup; sub-service series are per-service. If you only care about totals, drop the sub-services from services and metrics; if you need per-sub-service granularity, keep all five."}},{"@type":"Question","name":"How do I keep cardinality under control with the five metadata_* dimensions on Transactions?","acceptedAnswer":{"@type":"Answer","text":"By default each Transactions data point carries metadata_apiname, metadata_authentication, metadata_geotype, metadata_responsetype, and metadata_transactiontype. metadata_apiname has the highest cardinality - one value per distinct Storage API operation (PutBlob, PutMessage, InsertEntity, etc.). For a 50-account fleet doing 30 distinct API operations across all six PT1M metrics with dual-mode auth (AccountKey plus OAuth), the active series count grows to roughly 50 accounts × 5 resource scopes × ~6 metrics × 30 apiname values × 2 authentication ≈ 90,000 series, with metadata_responsetype adding another 1.5-3x during error spikes. Use dimensions.overrides on the receiver to drop metadata_apiname on noisy accounts, drop metadata_authentication where authentication mode does not change incident routing, and drop metadata_responsetype where ResponseType-split alerting is not needed."}},{"@type":"Question","name":"Should I use a service principal or managed identity for the collector?","acceptedAnswer":{"@type":"Answer","text":"Managed identity if the collector runs in Azure, service principal if it does not. AKS pods use Workload Identity Federation with a federated credential bound to a Kubernetes ServiceAccount; Container Apps and Virtual Machine Scale Sets use system-assigned or user-assigned managed identity; out-of-Azure collectors fall back to service principal. The azure_auth extension's mode block is the only thing that changes; the rest of the receiver config is identical. Storage's RBAC is the same Monitoring Reader role at resource-group scope as every other azure_monitor surface."}},{"@type":"Question","name":"Do I need this guide AND Diagnostic Settings to Log Analytics?","acceptedAnswer":{"@type":"Answer","text":"Yes if you want logs alongside metrics, and yes if you want to fill the PT1H capacity-metric gap noted above. This guide ships PT1M Transaction-class metrics. For activity logs, audit logs, and per-blob/queue/table/file operation logs from the storage account, configure Diagnostic Settings on each sub-service to forward to Log Analytics or to Event Hubs and pipe Event Hubs into the collector via the azure_event_hub receiver. The two paths are complementary: metrics for SLI and SLO dashboards and alerts, logs for incident investigation and capacity-trend analysis."}}]}
---

## Overview

This guide is the **execution playbook** for Azure Storage. For the
cross-surface architecture (auth, push vs pull, latency, the trace
gap), read [Azure Monitoring with OpenTelemetry - Architecture for
base14 Scout](./overview.md) first.

This guide is for engineers running Azure Storage in production who
want to add Storage telemetry to an existing OpenTelemetry Collector
and ship it to base14 Scout. The collector polls Azure Monitor's REST
API for `Microsoft.Storage/storageAccounts` (account-level rollup)
**and the four sub-service namespaces** (`blobServices`,
`queueServices`, `tableServices`, `fileServices`) every 60 seconds,
emits OTel metric series, and exports via OTLP/HTTP. Nothing on the
data plane.

A storage account aggregates four otherwise-separate services. The
`azure_monitor` receiver lets one config block scrape all of them in a
single call, with the `azuremonitor.resource_id` data-point attribute
splitting same-named metrics (`Transactions`, `Ingress`, `Egress`)
across the account rollup and each sub-service. Drop sub-services you
do not use by removing them from both `services:` and the `metrics:`
map.

This guide is metrics-only. For per-blob and per-queue audit trails
(SAS-token usage, bucket-level access, individual operation logs),
instrument with Diagnostic Settings (see [Logs](#logs)).

## Receiver configuration

Add this fragment to your existing collector config. It contributes
the `azure_auth` extension, an `azure_monitor` receiver scoped to all
five Storage namespaces, a resource processor, and a metrics pipeline.
Component keys are suffixed `/storage` so the fragment composes
cleanly with other Azure-surface receivers in the same collector.

```yaml showLineNumbers title="otel-collector.yaml (Storage addition)"
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
  azure_monitor/storage:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
      # Add more entries to scrape accounts across multiple subscriptions
      # in one collector. Each subscription needs its own Monitoring Reader
      # role assignment on the configured identity; the receiver fans out
      # queries across all subscription x resource-group combinations.
    resource_groups:
      - ${env:STORAGE_RESOURCE_GROUP}
      # Multi-resource-group scoping. Omit resource_groups entirely to
      # scrape every resource group in the listed subscriptions.
    services:
      - Microsoft.Storage/storageAccounts
      - Microsoft.Storage/storageAccounts/blobServices
      - Microsoft.Storage/storageAccounts/queueServices
      - Microsoft.Storage/storageAccounts/tableServices
      - Microsoft.Storage/storageAccounts/fileServices
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    # Data-plane batch API (*.metrics.monitor.azure.com). Lifts the
    # per-subscription rate ceiling from 12k to 360k calls/hour and is
    # the recommended default for fleets. Flip to false only as a
    # temporary fallback while data-plane RBAC propagates after a fresh
    # Monitoring Reader grant (5-30 min lag); the legacy ARM /metrics
    # endpoint propagates immediately. See Scale and rate limits.
    use_batch_api: true
    # Resource-list cache TTL in seconds. 86400 (24h) is the receiver
    # default and the right setting for a stable fleet.
    cache_resources: 86400
    dimensions:
      enabled: true
    # The receiver only emits the metrics you list; there is no
    # implicit default + my picks merge. Empty aggregation list `[]`
    # requests all aggregations Azure Monitor publishes for the metric;
    # explicit lists narrow further (see Cardinality control).
    metrics:
      "Microsoft.Storage/storageAccounts":
        UsedCapacity: [Average]
        Transactions: [Total]
        Ingress: [Total]
        Egress: [Total]
        SuccessE2ELatency: [Average]
        SuccessServerLatency: [Average]
        Availability: [Average]
      "Microsoft.Storage/storageAccounts/blobServices":
        BlobCapacity: [Average]
        BlobCount: [Average]
        ContainerCount: [Average]
        IndexCapacity: [Average]
        Transactions: [Total]
        Ingress: [Total]
        Egress: [Total]
      "Microsoft.Storage/storageAccounts/queueServices":
        QueueCapacity: [Average]
        QueueCount: [Average]
        QueueMessageCount: [Average]
        Transactions: [Total]
      "Microsoft.Storage/storageAccounts/tableServices":
        TableCapacity: [Average]
        TableCount: [Average]
        TableEntityCount: [Average]
        Transactions: [Total]
      "Microsoft.Storage/storageAccounts/fileServices":
        FileCapacity: [Average]
        FileCount: [Average]
        FileShareCount: [Average]
        Transactions: [Total]

processors:
  resource/storage:
    attributes:
      - {key: cloud.provider,    value: azure,                              action: insert}
      - {key: cloud.platform,    value: azure_storage,                      action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",     action: insert}
      - {key: cloud.region,      value: "${env:STORAGE_REGION}",            action: insert}
      # cloud.resource_id pins all metrics to one account. Drop this line
      # for multi-account fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically (with the sub-service path appended on
      # blob/queue/table/file series).
      - {key: cloud.resource_id, value: "${env:STORAGE_RESOURCE_ID}",       action: insert}
      - {key: service.name,      value: "${env:STORAGE_SERVICE_NAME}",      action: insert}

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/storage:
      receivers: [azure_monitor/storage]
      processors: [memory_limiter, resource/storage, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                                # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed
`/storage` so they coexist with other Azure receivers (Service Bus,
Cosmos DB, SQL Database, Front Door, Application Gateway) in a single
collector. Your Scout exporter (`oauth2client` + `otlphttp/b14`) stays
unchanged; one Scout pipeline serves every Azure surface.

For multi-subscription scoping, the `subscription_ids:` list takes
any number of entries; alternatively set `discover_subscriptions:
true` to scrape every subscription the configured identity has
`Monitoring Reader` on:

```yaml
receivers:
  azure_monitor/storage:
    discover_subscriptions: true   # replaces subscription_ids
```

See [Scale and rate limits](#scale-and-rate-limits) for the trade-off
between explicit lists and discovery.

### Removing Storage from the collector

To stop scraping Storage without affecting other surfaces in the same
collector: delete the `azure_monitor/storage` receiver block, the
`resource/storage` processor, and the `metrics/storage` pipeline; drop
the storage-specific environment variables; and restart the
collector. The `azure_auth` extension and Scout exporter stay,
serving every other Azure surface in the same config. Revoke the
`Monitoring Reader` role assignment on the resource group only if no
other surface uses the same identity scope.

## Authentication

`azure_auth` supports five modes. Pick the one matching where the
collector runs.

| Collector deployment | Recommended mode | Why |
| --- | --- | --- |
| Azure Kubernetes Service (AKS) pod | `workload_identity` | Federated credential, no secret to rotate, scoped to the ServiceAccount. |
| Container Apps | `managed_identity` (system or user-assigned) | First-class integration, no secret to rotate. |
| Virtual Machine Scale Sets / Azure VM | `managed_identity` (user-assigned) | User-assigned identity survives instance replacement; system-assigned dies with the instance. |
| External or on-prem | `service_principal` | Only option without an Azure-resident identity. |
| Local dev / ad-hoc | `use_default: true` | Falls back to the Azure SDK default credential chain (CLI, env, managed identity). |

### Workload Identity Federation (Azure Kubernetes Service)

Bind a federated credential on a Microsoft Entra app registration to
your collector's Kubernetes ServiceAccount; the collector mounts a
token file and exchanges it for an Azure access token on every
request. No client secret, no rotation, scoped to the ServiceAccount.

```yaml
extensions:
  azure_auth:
    workload_identity:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}      # the user-assigned managed identity's clientId
      federated_token_file: /var/run/secrets/azure/tokens/azure-identity-token
```

Setup:

1. Enable the workload-identity addon on the AKS cluster
   (`az aks update --enable-workload-identity --enable-oidc-issuer`).
2. Create a user-assigned managed identity, capture its `clientId` and
   `principalId`.
3. Add a federated credential to the managed identity scoped to your
   ServiceAccount:

   ```bash
   az identity federated-credential create \
     --name otel-collector-fed \
     --identity-name otel-collector-mi \
     --resource-group <mi-rg> \
     --issuer "$(az aks show -g <aks-rg> -n <aks> --query oidcIssuerProfile.issuerUrl -o tsv)" \
     --subject "system:serviceaccount:<namespace>:<serviceaccount>"
   ```

4. Annotate the ServiceAccount: `azure.workload.identity/client-id: <mi-clientId>`.
5. Label the collector pod: `azure.workload.identity/use: "true"`.
6. Grant `Monitoring Reader` to the managed identity's `principalId`
   on every Storage resource group it should scrape.

### Managed Identity (Container Apps, Virtual Machine Scale Sets, Azure VM)

```yaml
extensions:
  azure_auth:
    managed_identity:
      # System-assigned: omit client_id; the resource's identity is used.
      # User-assigned: provide the client_id of the assigned managed identity.
      client_id: ${env:AZURE_CLIENT_ID}   # optional for system-assigned
```

Container Apps: assign system-assigned managed identity on the app
(`az containerapp identity assign --system-assigned`); grant the
resulting `principalId` `Monitoring Reader` on each target resource
group.

### Service Principal (out-of-Azure collectors)

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}
```

`AZURE_CLIENT_SECRET` is the only credential that needs rotation; see
[Service principal credential lifecycle](#service-principal-credential-lifecycle).

### RBAC scope

`Monitoring Reader` at the resource group containing your storage
accounts is sufficient and minimal. The role grants read on metric
definitions and metric data only; no control-plane write, no
data-plane access. `Reader` is not required.

```bash
RG_ID=$(az group show --name <your-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId or principalId> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

The collector's identity needs only `Monitoring Reader`. The four
data-plane roles (`Storage Blob Data Contributor`, `Storage Queue
Data Contributor`, `Storage Table Data Contributor`, `Storage File
Data SMB Share Contributor`) are for **operators uploading test
content or applications doing data-plane I/O**, not for the
collector. Granting them to the collector identity is unnecessary
and expands blast radius.

For multi-subscription fleets, repeat the assignment on each
subscription's resource group. Subscription-scoped assignments work
too if the managed identity or service principal should see every
storage account in a subscription.

This guide defaults `use_batch_api: true` (data-plane batch API at
`*.metrics.monitor.azure.com`) for the higher rate ceiling. RBAC on
that endpoint lags 5-30 minutes after a fresh `Monitoring Reader`
grant. If the receiver returns 401s in that window, temporarily flip
to `use_batch_api: false` (legacy ARM `/metrics`, immediate
propagation) and revert once the data-plane RBAC settles.

## What you'll monitor

Storage publishes metrics across **five namespaces**: the
account-level rollup plus four sub-services. The receiver renames Azure's
PascalCase metric names (e.g. `BlobCapacity`) to OTel-style
`azure_<lowercased>_<aggregation>` (e.g. `azure_blobcapacity_average`).
The metric tables below cover Standard-tier accounts; Premium block-blob
and Premium file-share accounts publish additional series — see
[Premium-tier additions](#premium-tier-additions).

The metrics split into two grain bands with very different operational
characteristics:

- **PT1M Transaction-class** (request throughput, byte-throughput,
  latency, availability) — flow through the receiver within 2-3
  minutes of the first traffic. Drives request-flow dashboards,
  latency SLOs, and availability alerts.
- **PT1H Capacity-class** (capacity, count, message-count) — known
  receiver gap under v0.151.0 with sub-hour `collection_interval`.
  See [The PT1H capacity-metric gap](#the-pt1h-capacity-metric-gap).

### Account rollup (`Microsoft.Storage/storageAccounts`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Transactions` | `azure_transactions_total` | Count | Per-minute API call count to the account, summed across all sub-services. The headline rate metric. |
| `Ingress` | `azure_ingress_total` | Bytes | Total ingress bytes per minute, all sub-services. |
| `Egress` | `azure_egress_total` | Bytes | Total egress bytes per minute, all sub-services. |
| `SuccessE2ELatency` | `azure_successe2elatency_average` | ms | End-to-end latency including network. |
| `SuccessServerLatency` | `azure_successserverlatency_average` | ms | Server-side latency excluding network. Subtract from `SuccessE2ELatency` to get network round-trip. |
| `Availability` | `azure_availability_average` | Percent | Fraction of successful billable requests, across the account. Drop below 99.9% is page-worthy. |
| `UsedCapacity` | `azure_usedcapacity_average` | Bytes | Account-level total bytes stored. **PT1H grain — see capacity gap.** |

### Blob service (`.../blobServices`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Transactions` | `azure_transactions_total` | Count | Blob-only API calls. Pairs with account-level `Transactions` to see Blob's share of total traffic. |
| `Ingress` | `azure_ingress_total` | Bytes | Blob-service ingress bytes. |
| `Egress` | `azure_egress_total` | Bytes | Blob-service egress bytes. |
| `BlobCapacity` | `azure_blobcapacity_average` | Bytes | Bytes stored in blobs. Splits by `BlobType` (BlockBlob, PageBlob, AppendBlob) and `Tier` (Hot, Cool, Cold, Archive). **PT1H grain.** |
| `BlobCount` | `azure_blobcount_average` | Count | Number of blobs. **PT1H grain.** |
| `ContainerCount` | `azure_containercount_average` | Count | Number of containers in the account. **PT1H grain.** |
| `IndexCapacity` | `azure_indexcapacity_average` | Bytes | ADLS Gen2 hierarchical-namespace index size. **PT1H grain.** Always 0 for non-HNS accounts. |

### Queue service (`.../queueServices`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Transactions` | `azure_transactions_total` | Count | Queue-only API calls (PutMessage, GetMessages, DeleteMessage, etc.). |
| `QueueCapacity` | `azure_queuecapacity_average` | Bytes | Bytes stored across all queues. **PT1H grain.** |
| `QueueCount` | `azure_queuecount_average` | Count | Number of queues in the account. **PT1H grain.** |
| `QueueMessageCount` | `azure_queuemessagecount_average` | Count | Total unexpired queue messages. **PT1H grain.** Use the rate of change as a proxy for backlog growth, since the gauge itself is hourly. |

### Table service (`.../tableServices`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Transactions` | `azure_transactions_total` | Count | Table-only API calls (InsertEntity, QueryEntities, DeleteEntity, etc.). |
| `TableCapacity` | `azure_tablecapacity_average` | Bytes | Bytes stored across all tables. **PT1H grain.** |
| `TableCount` | `azure_tablecount_average` | Count | Number of tables in the account. **PT1H grain.** |
| `TableEntityCount` | `azure_tableentitycount_average` | Count | Total entities across all tables. **PT1H grain.** |

### File service (`.../fileServices`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `Transactions` | `azure_transactions_total` | Count | File-only API calls (CreateFile, PutRange, ReadFile, etc.). |
| `FileCapacity` | `azure_filecapacity_average` | Bytes | Bytes stored across all file shares. Splits by `FileShare` and `Tier`. **PT1H grain.** |
| `FileCount` | `azure_filecount_average` | Count | Number of files across all shares. **PT1H grain.** |
| `FileShareCount` | `azure_filesharecount_average` | Count | Number of file shares in the account. **PT1H grain.** |

The same five `metadata_*` dimensions ride alongside Transactions /
Ingress / Egress / latency / availability metrics: `metadata_apiname`,
`metadata_authentication`, `metadata_geotype`, `metadata_responsetype`,
and `metadata_transactiontype`. They split the namespace-scope series
into per-operation, per-auth-mode, and per-error-class series
automatically. See [Cardinality control](#cardinality-control) for
shaping advice.

**Silent-when-quiet caveat.** Azure Monitor returns data points for
the latency and availability metrics only when the underlying activity
occurs. A blob-only account with no traffic emits zero series for
`Transactions`, `Ingress`, `Egress`, `SuccessE2ELatency`,
`SuccessServerLatency`, and `Availability` until the first request.
Wire alerts on these to fire on series presence in window (any
non-zero point), not on threshold crossings, since the absence of
points is the steady state.

**`Availability` per sub-service.** Microsoft Learn exposes
`Availability` (and the latency / Ingress / Egress metrics) at each
sub-service namespace too. The whitelist above scopes them at
account-level only because the account rollup is the SLI most
operators alert on; if you need per-sub-service availability, add the
metric to the relevant namespace in `metrics:` and validate end-to-end
on a representative account before committing dashboards.

## The PT1H capacity-metric gap

Capacity-class metrics (`UsedCapacity`, `BlobCapacity`, `BlobCount`,
`ContainerCount`, `IndexCapacity`, `QueueCapacity`, `QueueCount`,
`QueueMessageCount`, `TableCapacity`, `TableCount`,
`TableEntityCount`, `FileCapacity`, `FileCount`, `FileShareCount`) are
published by Azure Monitor at PT1H grain only. Direct probes via
`az monitor metrics list --interval PT1H` confirm Azure Monitor has
the data within the first hour after account creation; `azure
monitor metrics list-definitions --resource <id>` lists each
capacity metric with its time-grain shown as PT1H.

Under the v0.151.0 `azuremonitorreceiver`, capacity-class metrics do
**not reliably surface** with a `collection_interval` shorter than
the metric's own time grain. The receiver's `loadMetricsValues`
passes each metric's `metricAvailabilities[0].TimeGrain` directly as
both `Interval` and `Timespan` to Azure Monitor's metrics REST API;
the resulting query window is too narrow for hourly-aggregated metrics
to come back populated, particularly for accounts younger than a
couple of hours. Issue
[#46047](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/46047)
in opentelemetry-collector-contrib tracks the underlying class of
problem.

Three workarounds, ordered by operational fit:

### 1. Run a separate slow-poll receiver instance for capacity

The cleanest fix. Keep the fast receiver at `collection_interval:
60s` for Transaction-class metrics, add a second receiver at
`collection_interval: 3600s` scoped to capacity-class metrics only.

```yaml
receivers:
  azure_monitor/storage:
    # ...existing 60s config keeps Transaction-class metrics flowing...
    metrics:
      "Microsoft.Storage/storageAccounts":
        Transactions: [Total]
        Ingress: [Total]
        Egress: [Total]
        SuccessE2ELatency: [Average]
        SuccessServerLatency: [Average]
        Availability: [Average]
      "Microsoft.Storage/storageAccounts/blobServices":
        Transactions: [Total]
        Ingress: [Total]
        Egress: [Total]
      # ...trim capacity entries from this fast receiver...

  azure_monitor/storage-capacity:
    subscription_ids: [${env:AZURE_SUBSCRIPTION_ID}]
    resource_groups: [${env:STORAGE_RESOURCE_GROUP}]
    services:
      - Microsoft.Storage/storageAccounts
      - Microsoft.Storage/storageAccounts/blobServices
      - Microsoft.Storage/storageAccounts/queueServices
      - Microsoft.Storage/storageAccounts/tableServices
      - Microsoft.Storage/storageAccounts/fileServices
    auth: { authenticator: azure_auth }
    collection_interval: 3600s     # match the PT1H grain
    metrics:
      "Microsoft.Storage/storageAccounts":
        UsedCapacity: [Average]
      "Microsoft.Storage/storageAccounts/blobServices":
        BlobCapacity: [Average]
        BlobCount: [Average]
        ContainerCount: [Average]
        IndexCapacity: [Average]
      "Microsoft.Storage/storageAccounts/queueServices":
        QueueCapacity: [Average]
        QueueCount: [Average]
        QueueMessageCount: [Average]
      "Microsoft.Storage/storageAccounts/tableServices":
        TableCapacity: [Average]
        TableCount: [Average]
        TableEntityCount: [Average]
      "Microsoft.Storage/storageAccounts/fileServices":
        FileCapacity: [Average]
        FileCount: [Average]
        FileShareCount: [Average]

service:
  pipelines:
    metrics/storage:
      receivers: [azure_monitor/storage, azure_monitor/storage-capacity]
      processors: [memory_limiter, resource/storage, batch]
      exporters: [otlphttp/b14]
```

Both receivers share the same pipeline and resource processor; only
the receiver-list contains both. Capacity metrics flow once per hour
per resource, which is the rate Azure Monitor publishes them anyway.
The slow receiver consumes ~24 ARM API calls per resource per day,
negligible against the 12,000/hour per-subscription ceiling.

### 2. Diagnostic Settings forwarding (Log Analytics or Event Hubs)

Two distinct paths under one option, depending on whether you want
the capacity data inside Scout or queryable separately:

- **Log Analytics (KQL only).** Configure Diagnostic Settings on each
  account to forward `AllMetrics` to a Log Analytics workspace.
  Capacity is queryable via KQL against the `AzureMetrics` table.
  This path keeps capacity outside Scout — useful if Log Analytics is
  already the source of truth for capacity reports, but dashboards
  alongside Scout metrics need a separate query surface.
- **Event Hubs → `azure_event_hub` receiver.** Configure Diagnostic
  Settings to forward `AllMetrics` to an Event Hub, then ingest into
  the same collector via the `azure_event_hub` receiver. Capacity
  lands as OTel metrics in Scout under a different namespace from the
  `azure_*` receiver-emitted series; alert and dashboard queries
  must select on the new metric names.

Pick Log Analytics if you only want trend visibility outside Scout;
pick Event Hubs if you need capacity in the same Scout dashboards as
the rest of the Storage telemetry.

### 3. Compute capacity from `az` CLI on a cron

Lightweight scripted approach for low-account-count environments:
poll `az monitor metrics list --interval PT1H` from a cron and emit
to a `pushgateway`-style receiver. Acceptable for fewer than 20
accounts; does not scale to fleets. Note that this lands as a
separate metric series, not under the `azure_*` namespace; query and
dashboard names will not match the receiver-emitted series.

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST
API. Multi-namespace scoping multiplies the per-account query rate by
the number of sub-services scraped: a single account with all five
namespaces scoped is **5x the query rate** of a single-namespace
surface like Cosmos DB.

Azure Monitor enforces two ceilings:

| Endpoint | Rate limit | When it applies |
| --- | --- | --- |
| Data-plane batch (`use_batch_api: true`) | 360,000 calls / hour / subscription | Default in this guide. RBAC lags 5-30 min after the Monitoring Reader grant. |
| Legacy Azure Resource Manager `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Temporary fallback if the data plane is still 401-ing after RBAC propagation should have completed. Immediate RBAC propagation. |

At a 60-second collection interval with all five namespaces and ~25
metrics whitelisted across them, a single storage account costs
roughly 300 calls per hour to Azure Monitor (one call per resource
per metric per poll, deduplicated within the receiver). Even small
fleets benefit from `use_batch_api: true` because batched fan-out is
more rate-limit-friendly than per-metric ARM calls; flip to `false`
only as a temporary fallback while data-plane RBAC settles.

Storage's multi-namespace shape makes the budget calculation more
sensitive to namespace coverage than to account count: dropping the
File or Table sub-service from `services:` and `metrics:` reduces
query rate proportionally. If your fleet uses only Blob and Queue,
shed the other two namespaces.

```yaml
receivers:
  azure_monitor/storage:
    # Pick one of two scoping patterns:
    #   1. Explicit list: subscription_ids: [...] (predictable, audit-friendly).
    #   2. Discovery: discover_subscriptions: true (any sub the configured
    #      identity has Monitoring Reader on; no list to maintain as orgs
    #      add subs).
    subscription_ids:
      - ${env:HUB_SUB_ID}
      - ${env:WORKLOAD_SUB_1}
      - ${env:WORKLOAD_SUB_2}
    services:
      - Microsoft.Storage/storageAccounts
      - Microsoft.Storage/storageAccounts/blobServices
      - Microsoft.Storage/storageAccounts/queueServices
      # File and Table dropped — the workload uses only Blob and Queue.
    auth: { authenticator: azure_auth }
    use_batch_api: true        # 360k/h ceiling per sub
    cache_resources: 86400     # receiver default (24h)
```

The receiver shares one rate-limit budget across all subscriptions in
the list; it does not bypass per-subscription quotas. Splitting heavy
subscriptions across separate collector instances lifts the aggregate
ceiling linearly.

`cache_resources` is the resource-list cache TTL in seconds. The
receiver default is `86400` (24 hours). Lower to `3600` or `600`
only if storage accounts are created and destroyed frequently enough
that 24-hour-stale resource lists become a problem; per-minute
resource-list calls otherwise burn ARM rate-limit budget for no
benefit.

## Cardinality control

By default, the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. Storage's
`metadata_*` dimension shape produces high cardinality on
`Transactions` and the latency / availability metrics:

- `metadata_apiname` — one value per distinct Storage API operation
  (PutBlob, GetBlob, PutMessage, GetMessages, InsertEntity,
  QueryEntities, CreateFile, PutRange, etc.). Typical fleets
  exercise 20-50 distinct API operations per account; this is the
  dominant cardinality multiplier.
- `metadata_authentication` — `OAuth`, `AccountKey`, or `SAS`.
  Two-to-three values in mixed-mode environments; one-or-two in
  single-mode.
- `metadata_geotype` — `Primary` for LRS / ZRS; both `Primary` and
  `Secondary` for GRS / RA-GRS / GZRS.
- `metadata_responsetype` — `Success` plus error classes
  (`ClientThrottlingError`, `ClientOtherError`, `ServerOtherError`,
  `ServerTimeoutError`, etc.) emitted only when the condition occurs.
  Silent-when-quiet on healthy accounts.
- `metadata_transactiontype` — `user` plus optionally `system` for
  internal operations.

A representative single-account baseline emits roughly **220 active
series** during steady traffic across all five namespaces with all
six PT1M metrics enabled and ~10 distinct API operations exercised.
Extrapolating to a 50-account fleet averaging 30 distinct API
operations and dual-mode auth:

```text
~50 accounts × 5 namespaces × ~6 metrics × 30 apiname × 2 auth ≈ 90,000 active series
```

`metadata_responsetype` adds another 1.5-3x growth on the
`Transactions` series during error spikes. Three control levers, in
order of preference:

1. **`dimensions.overrides`** drops or whitelists dimensions per
   metric. Drop `metadata_apiname` on namespaces where per-operation
   granularity is not actionable for alerting; drop
   `metadata_authentication` where authentication mode does not
   change incident routing.

   ```yaml
   azure_monitor/storage:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.Storage/storageAccounts":
           Transactions:
             - metadata_apiname           # keep
             - metadata_responsetype      # keep
           Ingress:
             - metadata_apiname           # keep
             # drop authentication, geotype, transactiontype
           SuccessE2ELatency:
             - metadata_apiname           # keep for per-op latency
             # drop the rest; reduces five-dim fan-out to one
   ```

2. **Aggregation-list narrowing.** Replace `[]` with explicit lists
   to drop the high-cost aggregations. For latency metrics, `[Average,
   Minimum, Maximum]` saves two series per resource per dimension
   combination. The `_count` and `_total` aggregations on a duration
   metric are sums of the latency values themselves, not call counts;
   they are usually noise.

3. **Per-account receiver instances.** Split high-cardinality
   accounts (the hub account that everyone writes to) into a separate
   `azure_monitor/storage-bigfleet` receiver with a narrower
   `metadata_*` override profile, while letting `azure_monitor/storage`
   stay broad on lower-traffic accounts. Both contribute to the same
   `metrics/storage` pipeline.

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric
on the collector's Prometheus self-telemetry endpoint (port 8888 by
default) to see actual cardinality after `overrides` apply.

### Storage-specific cardinality bug to watch

Issue
[#45942](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45942)
(open as of 2026-05): for Microsoft.Storage namespaces, `metadata_*`
attributes occasionally arrive case-mismatched (for example,
`Standard_LRS` versus `standard_lrs` on certain SKU-related
dimensions). Aggregating across the case-mismatched values
double-counts. The bug is intermittent and namespace-specific to
Storage; it does not always manifest. Workaround: normalise the
dimension fields downstream with the collector's `transform`
processor, or apply lower-casing in Scout queries. Track the issue
for resolution; v0.151.0 has the bug, future releases may not.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting
points for a Standard_LRS account with steady traffic; derive your
own from observed 99th-percentile baselines over a representative
week.

For `azure_responsetype`-split error series and the `Availability`
metric, fire alerts on series presence in window rather than numeric
thresholds — see the [silent-when-quiet caveat](#what-youll-monitor)
above.

| Metric (OTel name) | Warning | Critical | Why it matters |
| --- | --- | --- | --- |
| `azure_availability_average` (account-level) | < 99.9% over 5m | < 99.0% over 15m | Below 99.9% indicates Azure Storage degradation in the region or capacity-quota issues on the account. |
| `azure_transactions_total` filtered to `metadata_responsetype="ClientThrottlingError"` | `> 0` over 5m | `> 0` over 15m | Account-level throttling. Either traffic exceeded the per-account request-rate ceiling (varies by account kind and SKU; see [scalability targets](https://learn.microsoft.com/azure/storage/common/scalability-targets-standard-account)) or per-partition limits hit. |
| `azure_transactions_total` filtered to `metadata_responsetype="ServerTimeoutError"` | `> 0` over 5m | `> 0` over 15m | Server-side errors. Cross-check Azure Service Health for incidents. |
| `azure_successe2elatency_average` (per `metadata_apiname`) | > 1000 ms | > 5000 ms | End-to-end latency including network. Compare with `azure_successserverlatency_average` to localise to network vs server. |
| `azure_blobcapacity_average` / quota (PT1H, capacity gap caveat) | > 80% of account quota | > 95% | Standard accounts have a 5 PiB per-account capacity ceiling. Approach with at least 30 days of buffer at the current growth rate. |
| `azure_queuemessagecount_average` per queue (PT1H, capacity gap caveat) | > 99th-pct baseline | sustained > 5x baseline | Queue backlog growing faster than consumers drain. Pair with `Transactions` filtered to `metadata_apiname="GetMessages"` to confirm consumer side. |

### RED method on the storage account

For SLO-backed services, map Storage metrics as follows:

| RED letter | Metric | Slicing |
| --- | --- | --- |
| Rate | `azure_transactions_total` | per account; slice by `metadata_apiname` for per-operation rate. |
| Errors (availability) | `azure_transactions_total` filtered to `metadata_responsetype` in `ClientThrottlingError`, `ServerTimeoutError`, `ServerOtherError` | platform-on-call signal: Azure or capacity envelope broken. |
| Errors (request-quality) | `azure_transactions_total` filtered to `metadata_responsetype="ClientOtherError"` | service-team signal: application is misusing Storage. |
| Duration | `azure_successe2elatency_average` (and `_minimum` / `_maximum`) | per `metadata_apiname`. Subtract `azure_successserverlatency_average` for network round-trip. |

For saturation (the U in USE), pair `azure_usedcapacity_average /
account_quota` (PT1H), `azure_transactions_total` against the
[per-account scalability
ceiling](https://learn.microsoft.com/azure/storage/common/scalability-targets-standard-account),
and the throttling-response signal above. Per-operation client-side
latency belongs in the application code — see [Apps-side
instrumentation](#apps-side-instrumentation).

## Premium-tier additions

Premium block-blob accounts (`kind: BlockBlobStorage`) and Premium
file shares (`kind: FileStorage` or premium share within a StorageV2
account) carry a different metric subset. Premium block blob adds:

- `BlobProvisionedSize` (account capacity ceiling, separate from
  `BlobCapacity` actual usage).

Premium file shares add:

- `FileShareProvisionedIOPS` (provisioned IOPS per share).
- `FileShareProvisionedBandwidthMiBps` (provisioned bandwidth per
  share).
- `FileShareMaxUsedIOPS` (peak IOPS used in the latest minute).
- `FileShareMaxUsedBandwidthMiBps` (peak bandwidth used).
- `FileShareAvailableBurstCredits` (burst credits remaining).
- `FileShareSnapshotCount`, `FileShareSnapshotSize` (snapshot metrics).
- `PercentFileShareUtilization` (utilisation gauge, SLI category).

When the account is Premium, extend the whitelist on the relevant
sub-namespace:

```yaml
metrics:
  "Microsoft.Storage/storageAccounts/fileServices":
    # ...the four Standard-tier metrics above...
    FileShareProvisionedIOPS: [Average]
    FileShareProvisionedBandwidthMiBps: [Average]
    FileShareMaxUsedIOPS: [Maximum]
    FileShareMaxUsedBandwidthMiBps: [Maximum]
    FileShareAvailableBurstCredits: [Average]
    PercentFileShareUtilization: [Average]
```

The `FileShare` dimension splits these per share; alert on
`PercentFileShareUtilization > 80%` to stay ahead of provisioned-IOPS
exhaustion.

## Service principal credential lifecycle

If you run a service principal (collector outside Azure), rotate the
client secret before its expiry, not after.

### Proactive rotation (zero-downtime)

```bash
# 0. Capture the current credential's keyId BEFORE rotating, so step 4
#    knows which one to revoke.
OLD_KEY_ID=$(az ad app credential list --id "$AZURE_CLIENT_ID" \
  --query "sort_by([], &endDateTime)[0].keyId" -o tsv)

# 1. Append a new credential alongside the existing one. --append is
#    what makes this zero-downtime: without it, the previous
#    credential is revoked immediately and the collector errors until
#    the new value reaches its secret store.
NEW_RESULT=$(az ad app credential reset \
  --id "$AZURE_CLIENT_ID" \
  --append \
  --years 1 \
  -o json)

NEW_SECRET=$(echo "$NEW_RESULT" | jq -r .password)
NEW_KEY_ID=$(echo "$NEW_RESULT" | jq -r .keyId)

# 2. Update the collector's secret store with $NEW_SECRET.
# 3. Restart or hot-reload the collector. Wait for /metrics on the
#    collector's self-telemetry to confirm it auth'd successfully.
# 4. Revoke the old credential.
az ad app credential delete --id "$AZURE_CLIENT_ID" --key-id "$OLD_KEY_ID"
```

Set a calendar alert 30 days before secret expiry. The
federated-credential alternative (Workload Identity Federation for
AKS, system-assigned managed identity for Container Apps) eliminates
the rotation entirely; if the collector runs in Azure, prefer that
path.

## Apps-side instrumentation

This guide is metrics-only. To produce per-operation distributed
traces (client span linked through the storage call to server-side
processing), instrument your application code with one of these OTel
Storage SDK integrations:

- **.NET / C#:** `Azure.Storage.Blobs`, `Azure.Storage.Queues`,
  `Azure.Data.Tables`, `Azure.Storage.Files.Shares` ship built-in
  ActivitySource emission. Add `OpenTelemetry.Extensions.Hosting` and
  register `AddSource("Azure.*")` (or specific
  `Azure.Storage.Blobs`, etc.) to forward client spans.
- **Java:** the OTel Java agent (`opentelemetry-javaagent.jar`)
  auto-instruments the Azure SDK
  (`com.azure:azure-storage-blob`, `com.azure:azure-storage-queue`,
  etc.) via the `azure-core-tracing-opentelemetry` adapter. No code
  changes.
- **Python:** the OTel community
  `opentelemetry-instrumentation-azure-storage` package wraps
  `azure-storage-blob`, `azure-storage-queue`,
  `azure-data-tables`, and `azure-storage-file-share`. Verify span
  shape per language version before promoting.
- **Node.js / Go:** no first-party OTel auto-instrumentation as of
  2026-05. Manual span creation around `BlobClient.upload`,
  `QueueClient.sendMessage`, etc., is the workaround.

Run apps-side spans alongside this metrics collector with distinct
`service.name` values to keep the platform view (this guide) and the
request-flow view separately filterable in Scout.

## Logs

Architecture for the Diagnostic Settings → Event Hubs →
`azure_event_hub` path is in the
[overview](./overview.md#choosing-pull-push-or-both). Storage's
diagnostic log categories are per-sub-service and worth enabling for
incident investigation:

| Sub-service | Log category | What it captures |
| --- | --- | --- |
| `blobServices` | `StorageRead`, `StorageWrite`, `StorageDelete` | Per-blob operations including the SAS-token / OAuth identity that performed them. |
| `queueServices` | `StorageRead`, `StorageWrite`, `StorageDelete` | Per-message operations. |
| `tableServices` | `StorageRead`, `StorageWrite`, `StorageDelete` | Per-entity operations. |
| `fileServices` | `StorageRead`, `StorageWrite`, `StorageDelete` | Per-file SMB and REST operations. |

```bash
SA_RES_ID=$(az storage account show -n <sa> -g <rg> --query id -o tsv)
for SUB in blobServices queueServices tableServices fileServices; do
  az monitor diagnostic-settings create \
    --resource "$SA_RES_ID/$SUB/default" \
    --name "$SUB-to-eventhubs" \
    --logs '[{"category":"StorageRead","enabled":true},{"category":"StorageWrite","enabled":true},{"category":"StorageDelete","enabled":true}]' \
    --event-hub-rule <eh-namespace-rule-id>
done
```

Activity logs (control-plane operations on the account) are
**subscription-scoped**, not resource-scoped; configure them once
per subscription via `az monitor diagnostic-settings subscription create`.

## Troubleshooting

### `AuthorizationFailed` from the receiver

Data-plane batch API (`use_batch_api: true`, the default) propagates
`Monitoring Reader` 5-30 minutes after grant; legacy ARM `/metrics`
(`use_batch_api: false`) propagates immediately. If you've just
granted the role and the receiver is 401-ing, temporarily flip to
`false` to confirm the role itself is correct, then revert once the
data-plane RBAC has settled.

### `403 Forbidden` from the receiver

If using a service principal: the `client_secret` has expired. See
[Service principal credential
lifecycle](#service-principal-credential-lifecycle). If using managed
identity: check that the storage account is in a subscription /
resource group where the managed identity has `Monitoring Reader`.

### Capacity metrics never appear

This is the [PT1H capacity-metric gap](#the-pt1h-capacity-metric-gap)
covered above. PT1M Transaction-class metrics flow within minutes;
PT1H Capacity-class metrics need either a separate slow-poll receiver
instance, Diagnostic Settings to Log Analytics, or a scripted
`az monitor metrics list` cron. Do not confuse this with
authentication failure; check `otelcol_receiver_accepted_metric_points_total`
on the collector's self-telemetry: if Transactions are flowing but
capacity is not, the gap is the receiver, not RBAC.

### Sub-service metrics missing for a specific service

Verify both the `services:` list and the `metrics:` map include the
sub-namespace key. Both must be present; listing one without the
other silently drops the sub-service. Check the receiver log for
`Loaded the list of Azure Metrics Definitions` per resource — there
should be one log line per `(account + sub-service)` pair on each
poll cycle.

### `RequestThrottled` warnings from the receiver

You have hit Azure Monitor's per-subscription rate ceiling
(12,000 / hour on legacy, 360,000 / hour on batch). Multi-namespace
Storage scoping makes this easier to hit than single-namespace
surfaces. Either:

- Lower polling rate: `collection_interval: 120s` for the fast receiver.
- Narrow scope: drop unused sub-services from `services:` and `metrics:`.
- Confirm `use_batch_api: true` is set (the guide default) — the
  legacy ARM endpoint caps at 12k/h versus 360k/h on data-plane batch.
- Split heavy subscriptions across multiple collector instances.

### Cardinality blowup on Scout volume

A single high-fanout account can dominate volume — `metadata_apiname`
is the prime offender. Apply `dimensions.overrides` (see
[Cardinality control](#cardinality-control)) or split the noisy
account into a separate receiver instance with a narrower whitelist.

### `metadata_*` values look case-mismatched

Issue
[#45942](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45942)
in opentelemetry-collector-contrib. Storage-specific. Workaround in
[Cardinality control](#cardinality-control) (transform processor or
Scout-side normalisation).

### Scout OAuth2 returns 401

Verify `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, and
`SCOUT_TOKEN_URL` match the values in your Scout console. The
`endpoint_params.audience` must be `b14collector`.

### Docker Desktop DNS glitch on a sibling-fragment restart

If you run multiple Azure surfaces in one collector and restart the
collector to pick up a sibling fragment change, the first poll
sometimes fails with `dial tcp: lookup login.microsoftonline.com:
network is unreachable`. This is a Docker Desktop networking quirk on
container restart, not a receiver bug. A second restart resolves it.

## Frequently Asked Questions

### How do I add Azure Storage metrics to my existing OpenTelemetry Collector?

Add the `azure_auth` extension and an `azure_monitor` receiver scoped
to all five Storage namespaces (`Microsoft.Storage/storageAccounts`
plus the four sub-services `blobServices`, `queueServices`,
`tableServices`, `fileServices`), then route the receiver into a
metrics pipeline that exports to Scout via the
`oauth2client`-authenticated OTLP/HTTP exporter. The receiver polls
Azure Monitor's REST API every 60 seconds and emits one OTel metric
per Azure aggregation; the `azuremonitor.resource_id` data-point
attribute splits each series by sub-service. No data-plane connection
to Storage; the account is never on the collector's path.

### Why don't my UsedCapacity and BlobCount metrics appear?

Capacity-class metrics on Microsoft.Storage namespaces have a PT1H
time grain — Azure Monitor publishes them once per hour, not per
minute. The v0.151.0 `azuremonitorreceiver` passes each metric's
natural time grain as both `Interval` and `Timespan` when querying
Azure Monitor; for fresh accounts this query window can fall outside
the publishing schedule and capacity points get skipped. PT1M
Transaction-class metrics (`Transactions`, `Ingress`, `Egress`,
`Availability`, latency) flow within 2-3 minutes; for capacity
observability run a second receiver instance with `collection_interval:
3600s`, or fall back to Diagnostic Settings to Log Analytics. Issue
[#46047](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/46047)
tracks the underlying class of problem.

### How do I attribute Transactions to a specific sub-service?

Whitelist `Transactions` on each of the five namespaces in the
`metrics:` map. The receiver emits one `azure_transactions_total`
series per resource scope, distinguishable by the
`azuremonitor.resource_id` data-point attribute — account-level
rollup uses `.../storageAccounts/<sa>`, sub-services append
`/<service>Services/default`. The account-level series is the
rollup; sub-service series are per-service. If you only care about
totals, drop the sub-services from `services:` and `metrics:`; if
you need per-sub-service granularity, keep all five.

### How do I keep cardinality under control on Transactions?

By default each `Transactions` data point carries `metadata_apiname`,
`metadata_authentication`, `metadata_geotype`,
`metadata_responsetype`, and `metadata_transactiontype`.
`metadata_apiname` has the highest cardinality — one value per
distinct Storage API operation. For a 50-account fleet doing 30
distinct API operations across all six PT1M metrics with dual-mode
auth (`AccountKey` plus `OAuth`), the active series count grows to
roughly 50 × 5 × ~6 × 30 × 2 ≈ 90,000 series, with
`metadata_responsetype` adding another 1.5-3x during error spikes.
Use `dimensions.overrides` on the receiver to drop
`metadata_apiname` on noisy accounts, drop `metadata_authentication`
where authentication mode does not change incident routing, and drop
`metadata_responsetype` where ResponseType-split alerting is not
needed.

### Should I use a service principal or managed identity for the collector?

Managed identity if the collector runs in Azure, service principal
if it does not. AKS pods use Workload Identity Federation with a
federated credential bound to a Kubernetes ServiceAccount; Container
Apps and Virtual Machine Scale Sets use system-assigned or
user-assigned managed identity; out-of-Azure collectors fall back to
service principal. The `azure_auth` extension's mode block is the
only thing that changes; the rest of the receiver config is
identical. Storage's RBAC is the same `Monitoring Reader` role at
resource-group scope as every other `azure_monitor` surface.

### Do I need this guide AND Diagnostic Settings to Log Analytics?

Yes if you want logs alongside metrics, and yes if you want to fill
the PT1H capacity-metric gap noted above. This guide ships PT1M
Transaction-class metrics. For activity logs, audit logs, and
per-blob/queue/table/file operation logs from the storage account,
configure Diagnostic Settings on each sub-service to forward to Log
Analytics or to Event Hubs and pipe Event Hubs into the collector
via the `azure_event_hub` receiver. The two paths are complementary:
metrics for SLI and SLO dashboards and alerts, logs for incident
investigation and capacity-trend analysis.

## Reference

- **Receiver source.**
  [opentelemetry-collector-contrib / receiver /
azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver).
- **Auth extension source.**
  [opentelemetry-collector-contrib / extension /
azureauthextension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/azureauthextension).
- **Azure Monitor metric reference (account-level).**
  [Microsoft.Storage/storageAccounts
metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-storage-storageaccounts-metrics).
- **Azure Monitor metric reference (sub-services).**
  [blobServices](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-storage-storageaccounts-blobservices-metrics)
·
  [queueServices](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-storage-storageaccounts-queueservices-metrics)
·
  [tableServices](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-storage-storageaccounts-tableservices-metrics)
·
  [fileServices](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-storage-storageaccounts-fileservices-metrics).

## Related Guides

- [Azure Service Bus](./service-bus.md) — sister guide; same
  `azure_monitor` pattern, single-namespace messaging surface.
- [Azure Cosmos DB](./cosmos-db.md) — sister guide; same pattern,
  NoSQL surface.
- [Azure SQL Database](./sql-database.md) — sister guide; same
  pattern, relational PaaS surface.
- [Azure Front Door](./front-door.md) — sister guide; CDN / edge
  surface.
- [Azure Application Gateway](./application-gateway.md) — sister
  guide; L7 load balancer surface.
- [Azure Kubernetes Service](./aks.md) — sister guide; in-cluster
  collector pattern, complementary to this account-scope pattern.
