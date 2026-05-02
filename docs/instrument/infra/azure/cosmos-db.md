---
date: 2026-05-02
id: collecting-azure-cosmosdb-telemetry
title: Azure Cosmos DB Monitoring with OpenTelemetry - RU Consumption & Latency
sidebar_label: Azure Cosmos DB
sidebar_position: 2
description:
  Monitor Azure Cosmos DB (SQL / NoSQL API) with the OpenTelemetry
  Collector's azure_monitor receiver. Stream Total Requests,
  Request Units, server-side latency, document count, and storage
  metrics to base14 Scout. Vendor-neutral alternative to Application
  Insights and Azure Monitor dashboards.
keywords:
  - azure cosmos db monitoring
  - cosmosdb opentelemetry
  - azure monitor receiver
  - cosmos ru consumption
  - cosmos request units
  - azure cosmos performance
  - cosmos document count
  - normalized ru consumption
  - cosmos throttling
  - base14 scout cosmosdb
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure Cosmos DB with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Run the OpenTelemetry Collector with the azure_monitor receiver targeting Microsoft.DocumentDB/databaseAccounts. The receiver polls Azure Monitor's REST API every 60 seconds, transforms metrics from Azure's PascalCase names (like TotalRequests) to OTel-style names (azure_totalrequests_count), and ships them via OTLP/HTTP to base14 Scout. Authentication uses the azure_auth extension in service-principal or managed-identity mode."}},{"@type":"Question","name":"What RBAC role does the receiver need on the Cosmos account?","acceptedAnswer":{"@type":"Answer","text":"Monitoring Reader scoped to the resource group is sufficient. It grants read access to metric definitions and metric data without any control-plane write permissions. Reader is not needed unless a specific call returns AuthorizationFailed; Monitoring Reader alone covers the entire azure_monitor receiver surface."}},{"@type":"Question","name":"Why do some metrics show no data on a fresh Cosmos account?","acceptedAnswer":{"@type":"Answer","text":"Azure Monitor only emits metrics when there is activity to measure. ServerSideLatencyDirect and ServerSideLatencyGateway emit zero series until a real workload exercises latency. TotalRequests and TotalRequestUnits start emitting after the first data-plane call. DataUsage, DocumentCount, ProvisionedThroughput, and ServiceAvailability emit immediately on every account, regardless of traffic."}},{"@type":"Question","name":"What is NormalizedRUConsumption?","acceptedAnswer":{"@type":"Answer","text":"NormalizedRUConsumption is the per-minute maximum RU/s utilization expressed as a percentage of provisioned throughput, sliced by partition key range. It rises before throttling actually starts (visible in 429 status codes), making it a leading indicator for capacity decisions. Alert at 80 percent sustained to give yourself room to scale before requests fail."}},{"@type":"Question","name":"Should I use the data-plane batch API for higher throughput?","acceptedAnswer":{"@type":"Answer","text":"Switch to use_batch_api: true once your service principal RBAC has propagated through Azure Monitor's data plane (5-30 minutes after grant). The batch API raises Azure Monitor's query rate ceiling from 12,000 to 360,000 calls per hour. For a single account validation pass, leave it false; the legacy ARM /metrics endpoint propagates Monitoring Reader immediately."}},{"@type":"Question","name":"How does this differ from Application Insights for Cosmos DB?","acceptedAnswer":{"@type":"Answer","text":"Application Insights for Cosmos DB is Azure-tenant-bound, billed per-GB ingested, and visualised in Azure dashboards or workbooks. The OpenTelemetry Collector is vendor-neutral - the same image ships to base14 Scout or any OTLP-compatible backend without redeployment. Multi-cloud customers and customers migrating off Application Insights prefer this. The metric coverage is identical - both surfaces draw from the same Azure Monitor REST API."}}]}
---

## Overview

This guide covers monitoring an **Azure Cosmos DB** account (SQL / NoSQL API)
with the OpenTelemetry Collector's `azure_monitor` receiver. The collector
polls Azure Monitor's REST API every 60 seconds for the metrics published by
`Microsoft.DocumentDB/databaseAccounts`, transforms them to OTel-style names,
and ships them via OTLP/HTTP to base14 Scout.

The `azure_monitor` receiver does not connect to Cosmos directly. It queries
Azure Monitor's metrics surface for any resource Cosmos auto-publishes to —
so the same pattern applies to all five Cosmos APIs (SQL, Mongo, Cassandra,
Gremlin, Table) and to other Azure services like Storage, Service Bus, and
SQL Database. This guide focuses on the SQL API; the configuration shape
generalises.

## What you'll monitor

Twelve metrics from `Microsoft.DocumentDB/databaseAccounts`, sufficient for
RU consumption, request rate, storage, and availability dashboards. The
receiver renames them from Azure's PascalCase (e.g., `TotalRequests`) to
OTel-style `azure_<lowercased>_<aggregation>` (e.g.,
`azure_totalrequests_count`). A single Azure metric with multiple
aggregations becomes one OTel metric per aggregation.

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `TotalRequests` | `azure_totalrequests_count` | Count | Request rate, with `metadata_statuscode` / `metadata_connectionmode` / `metadata_operationtype` dimensions for slicing 2xx vs 4xx vs 5xx, gateway vs direct |
| `TotalRequestUnits` | `azure_totalrequestunits_{total,average,maximum}` | RUs | RU consumption — primary cost driver and capacity-planning input |
| `MetadataRequests` | `azure_metadatarequests_count` | Count | Free-of-charge metadata calls (account/database/container introspection) |
| `ServerSideLatencyDirect` | `azure_serversidelatencydirect_*` | ms | Server-side latency for direct-mode connections |
| `ServerSideLatencyGateway` | `azure_serversidelatencygateway_*` | ms | Server-side latency for gateway-mode connections |
| `DataUsage` | `azure_datausage_{total,average,maximum,minimum}` | Bytes | Storage consumed by user data |
| `DocumentCount` | `azure_documentcount_{total,average}` | Count | Total document count |
| `DocumentQuota` | `azure_documentquota_{total,average}` | Bytes | Storage quota — supersedes the deprecated `AvailableStorage` |
| `IndexUsage` | `azure_indexusage_{total,average,maximum,minimum}` | Bytes | Index storage |
| `ProvisionedThroughput` | `azure_provisionedthroughput_maximum` | RUs | Throughput ceiling per database/container |
| `NormalizedRUConsumption` | `azure_normalizedruconsumption_{average,maximum}` | Percent | Sliding-window utilisation; rises before throttling actually starts |
| `ServiceAvailability` | `azure_serviceavailability_{average,maximum,minimum}` | Percent | Account-level availability (PT1H grain; emitted hourly) |

The latency pair (`ServerSideLatencyDirect` / `*Gateway`) emits zero series
until a real workload exercises latency. `ServerSideLatency` (the parent
metric) and `AvailableStorage` are deprecated by Microsoft (Aug 2025 / Sep
2023 respectively); use the `*LatencyDirect` / `*LatencyGateway` and
`DocumentQuota` replacements above.

## Prerequisites

| Requirement                       | Minimum                          |
| --------------------------------- | -------------------------------- |
| A Cosmos DB account (any API)     | SQL / Mongo / Cassandra / Gremlin / Table |
| OTel Collector contrib            | v0.148.0+ (snake_case YAML keys) |
| `Microsoft.DocumentDB` provider   | registered on the subscription   |
| Service principal                 | `Monitoring Reader` on the Cosmos RG |
| base14 Scout                      | any tenant                       |

This guide is the Cosmos-specific addition to a working OpenTelemetry
Collector. For collector deployment + the Scout exporter pieces (which are
the same for every Azure surface), see:

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md), or
  [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) /
  [Linux Setup](../../collector-setup/linux-setup.md) for other runtimes.
- [Scout Exporter](../../collector-setup/scout-exporter.md) for the OAuth2 +
  OTLP/HTTP exporter config.

## Access setup

The `azure_monitor` receiver needs read-only access to Azure Monitor
metrics on the resource groups containing your Cosmos accounts. Grant
`Monitoring Reader` to a service principal:

```bash
# Create the SP (once per tenant — reuse it for every Azure surface).
az ad sp create-for-rbac --name sp-otel-azure-monitor --skip-assignment

# Scope Monitoring Reader to each Cosmos resource group.
RG_ID=$(az group show --name <your-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId from the create-for-rbac output> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

Capture `appId`, `password`, and `tenant` from the create output — they
become `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` in
the collector's environment. RBAC propagation on the legacy ARM `/metrics`
endpoint is immediate; the data-plane batch API can lag 5-30 minutes (see
Operations).

> **Inside Azure?** If your collector runs in Azure (VM, Container Apps,
> AKS pod), prefer a User-assigned Managed Identity over a service
> principal. The `azure_auth` extension supports `managed_identity:` and
> `workload_identity:` modes; only the auth block changes.

## Receiver configuration

This is the Cosmos-specific addition to your collector. Add the
`azure_auth` extension and `azure_monitor` receiver to your existing
config, then wire the receiver into a metrics pipeline that exports to
Scout (see [Scout Exporter](../../collector-setup/scout-exporter.md) for the
exporter half — it's the same OAuth2 + OTLP/HTTP setup used by every Azure
surface).

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    resource_groups: ["${env:AZURE_RESOURCE_GROUP}"]
    services: ["Microsoft.DocumentDB/databaseAccounts"]
    auth: { authenticator: azure_auth }
    collection_interval: 60s
    use_batch_api: false
    cache_resources: 60
    dimensions: { enabled: true }
    metrics:
      "Microsoft.DocumentDB/databaseAccounts":
        TotalRequests: []
        TotalRequestUnits: []
        MetadataRequests: []
        ServerSideLatencyDirect: []
        ServerSideLatencyGateway: []
        DataUsage: []
        DocumentCount: []
        DocumentQuota: []
        IndexUsage: []
        ProvisionedThroughput: []
        NormalizedRUConsumption: []
        ServiceAvailability: []

processors:
  resource:
    attributes:
      - { key: cloud.provider,    value: azure,                          action: insert }
      - { key: cloud.platform,    value: azure_cosmosdb,                 action: insert }
      - { key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert }
      - { key: cloud.region,      value: "${env:AZURE_REGION}",          action: insert }
      - { key: cloud.resource_id, value: "${env:COSMOS_RESOURCE_ID}",    action: insert }
      - { key: service.name,      value: "${env:SERVICE_NAME}",          action: insert }

service:
  extensions: [azure_auth]   # plus your existing extensions (oauth2client, etc.)
  pipelines:
    metrics:
      receivers: [azure_monitor]
      processors: [resource, batch]   # plus your existing processors
      exporters: [otlphttp/b14]       # the Scout exporter from the shared setup
```

Once `metrics:` is set for a namespace, the receiver only emits the
metrics you list — there is no implicit "default + my picks" merge. The
empty aggregation list `[]` per metric collects all aggregations Azure
publishes for that metric. The same receiver works against Mongo,
Cassandra, Gremlin, and Table-API Cosmos accounts — they all publish to
`Microsoft.DocumentDB/databaseAccounts`. Replace the SQL-API metric set
with the API-specific equivalents (e.g., `MongoRequests`,
`MongoRequestCharge` for Mongo) when targeting other APIs.

### Environment variables

```bash showLineNumbers title=".env"
# From `az ad sp create-for-rbac` output.
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=

# From your Azure subscription / resource group.
AZURE_SUBSCRIPTION_ID=
AZURE_RESOURCE_GROUP=
AZURE_REGION=
COSMOS_RESOURCE_ID=   # az cosmosdb show -g <rg> -n <account> --query id -o tsv

# Resource attribute defaults.
SERVICE_NAME=azure-cosmosdb
```

## Key alerts to configure

Threshold guidance for the most operationally useful series. Tune to your
workload and the throughput SKU; these are starting points for a
provisioned-throughput SQL-API account with real traffic.

| Metric (OTel name)                                     | Warning    | Critical    | Why it matters |
| ------------------------------------------------------ | ---------- | ----------- | -------------- |
| `azure_normalizedruconsumption_maximum`                | > 70%      | > 90%       | Sliding-window RU utilisation; rises before 429s actually start. Leading indicator for capacity. |
| `azure_totalrequests_count` filtered to status 429     | > 0 / 5m   | sustained > 0 / 15m | Throttling has started. Scale RU/s, partition the workload, or add retry budget. |
| `azure_totalrequestunits_total` (per partition key)    | > 80% of provisioned | > 95% | Hot-partition signal when one partition dominates total RU/s. |
| `azure_serversidelatencydirect_average`                | > 10ms     | > 25ms      | Server-side latency for direct-mode connections; user-facing latency depends on this + network. |
| `azure_serversidelatencygateway_average`               | > 25ms     | > 50ms      | Server-side latency for gateway-mode connections. |
| `azure_datausage_maximum`                              | > 80% of `azure_documentquota_maximum` | > 95% | Approaching storage quota; container or account split may be needed. |
| `azure_serviceavailability_minimum`                    | < 100% / 1h | < 99.9% / 1h | Account-level availability (PT1H grain). |

The latency thresholds above are tuned for a healthy single-region
account; adjust upward if you operate cross-region with consistency
levels stronger than `Session`. For multi-region accounts, alert on the
write-region's latency series specifically — read-region latency
naturally tracks the consistency level.

## Operations

- **Collection interval.** 60 seconds matches Azure Monitor's 1-3 minute
  ingestion lag — faster polls just re-read stale data and burn rate-limit
  budget.
- **`cache_resources`.** This is the receiver's resource-list cache TTL in
  seconds (default 24h). The shipped config sets it to `60` so newly-
  created accounts are visible to the receiver on the next poll —
  appropriate for a validation pass or for environments where accounts
  come and go frequently. In a stable production fleet, raise it back
  toward the default (e.g., `3600` or higher) to skip the per-minute ARM
  resource-list call.
- **RBAC propagation.** The legacy ARM `/metrics` endpoint propagates
  `Monitoring Reader` immediately. The newer data-plane batch API at
  `*.metrics.monitor.azure.com` requires separate RBAC propagation that can
  lag 5-30 minutes after grant.
- **Switching to `use_batch_api: true`** raises Azure Monitor's per-tenant
  query rate ceiling from 12,000 to 360,000 calls/hour. Worth it once you're
  scraping more than a handful of accounts or polling at higher cadence.
  Wait for data-plane RBAC to settle before enabling.
- **Filtering metrics.** Use `metrics:` (a namespace-keyed nested map) to
  whitelist; use `dimensions.overrides` to drop high-cardinality dimensions
  like `metadata_statuscode` if your Scout volume is dominated by per-status-
  code splits.
- **Multi-region accounts.** The receiver scopes by subscription and
  optional resource-group filters; Azure Monitor publishes metrics
  globally regardless of the account's write regions. No extra config.
- **Multi-API.** The same receiver works against Mongo, Cassandra, Gremlin,
  and Table-API Cosmos accounts — they all publish to
  `Microsoft.DocumentDB/databaseAccounts`. Replace the SQL-API metric set
  with the API-specific equivalents (e.g., `MongoRequests`,
  `MongoRequestCharge` for Mongo).

## Troubleshooting

### `AuthorizationFailed` from the receiver

The role assignment hasn't propagated. Wait 60 seconds after creating it; on
the legacy ARM endpoint propagation is usually immediate. If you've enabled
`use_batch_api: true`, allow up to 30 minutes for data-plane propagation —
or temporarily flip back to `false` to confirm the role itself is correct.

### `403 Forbidden` from the receiver

The service principal client_secret has expired. Rotate with
`az ad sp credential reset --id $AZURE_CLIENT_ID --years 1` and update your
collector's `AZURE_CLIENT_SECRET` env var.

### No metrics in the first 3 minutes

Azure Monitor's 1-3 minute ingestion lag for newly-provisioned resources.
If after 5 minutes you still see nothing in Scout, generate data-plane
traffic — the request-counter metrics only emit after the first read or
write. Control-plane calls like `az cosmosdb show` do not drive
`TotalRequests`; you need actual document operations against the account
endpoint.

### `RequestThrottled` warnings from the receiver

Azure Monitor's per-tenant query rate limit (12,000/hour on the legacy
endpoint, 360,000/hour on the batch API). Either lower polling rate
(`collection_interval: 120s`), narrow the scope (`resource_groups:` filter),
or enable `use_batch_api: true` once data-plane RBAC has settled.

### Collector container can't resolve `login.microsoftonline.com`

Docker Desktop networking glitch — the container's DNS resolver becomes
unreachable. `docker compose down && docker compose up -d` typically fixes
it. If persistent, restart Docker Desktop.

### Scout OAuth2 returns 401

Verify the `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL`
your collector is using match the values in your Scout console. The
`endpoint_params.audience` MUST be `b14collector` — that's what the Scout
token endpoint expects.

## Frequently Asked Questions

### How do I monitor Azure Cosmos DB with OpenTelemetry?

Run the OpenTelemetry Collector with the `azure_monitor` receiver targeting
`Microsoft.DocumentDB/databaseAccounts`. The receiver polls Azure Monitor's
REST API every 60 seconds, transforms metrics from Azure's PascalCase names
(like `TotalRequests`) to OTel-style names (`azure_totalrequests_count`),
and ships them via OTLP/HTTP to base14 Scout. Authentication uses the
`azure_auth` extension in service-principal or managed-identity mode.

### What RBAC role does the receiver need on the Cosmos account?

`Monitoring Reader` scoped to the resource group is sufficient. It grants
read access to metric definitions and metric data without any control-plane
write permissions. `Reader` is not needed unless a specific call returns
`AuthorizationFailed`; `Monitoring Reader` alone covers the entire
`azure_monitor` receiver surface.

### Why do some metrics show no data on a fresh Cosmos account?

Azure Monitor only emits metrics when there is activity to measure.
`ServerSideLatencyDirect` and `ServerSideLatencyGateway` emit zero series
until a real workload exercises latency. `TotalRequests` and
`TotalRequestUnits` start emitting after the first data-plane call.
`DataUsage`, `DocumentCount`, `ProvisionedThroughput`, and
`ServiceAvailability` emit immediately on every account, regardless of
traffic.

### What is `NormalizedRUConsumption`?

`NormalizedRUConsumption` is the per-minute maximum RU/s utilisation
expressed as a percentage of provisioned throughput, sliced by partition
key range. It rises before throttling actually starts (visible in 429
status codes), making it a leading indicator for capacity decisions. Alert
at 80% sustained to give yourself room to scale before requests fail.

### Should I use the data-plane batch API for higher throughput?

Switch to `use_batch_api: true` once your service principal RBAC has
propagated through Azure Monitor's data plane (5-30 minutes after grant).
The batch API raises Azure Monitor's query rate ceiling from 12,000 to
360,000 calls per hour. For a single-account validation pass, leave it
`false`; the legacy ARM `/metrics` endpoint propagates `Monitoring Reader`
immediately.

### How does this differ from Application Insights for Cosmos DB?

Application Insights for Cosmos DB is Azure-tenant-bound, billed per-GB
ingested, and visualised in Azure dashboards or workbooks. The
OpenTelemetry Collector is vendor-neutral — the same image ships to base14
Scout or any OTLP-compatible backend without redeployment. The metric
coverage is identical — both surfaces draw from the same Azure Monitor
REST API.

## Related Guides

- [Azure SQL Database](./sql-database.md) — sister guide; same
  `azure_monitor` pattern, relational-PaaS surface. Pairs with the
  self-hosted [SQL Server guide](../../component/sqlserver.md).
- [Azure Kubernetes Service](./aks.md) — sister guide; uses the same
  `azure_monitor` receiver pattern but scopes to
  `Microsoft.ContainerService/managedClusters` and adds an in-cluster
  collector pair (kubeletstats DaemonSet + k8s_cluster Deployment).
- [AWS RDS PostgreSQL](../aws/rds.md) — equivalent guide for AWS managed
  PostgreSQL. Uses CloudWatch Metrics Stream (push) for infrastructure
  metrics plus the OTel PostgreSQL receiver for database internals; a
  hybrid pattern.
