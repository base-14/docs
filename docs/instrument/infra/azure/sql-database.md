---
date: 2026-05-02
id: collecting-azure-sql-database-telemetry
title: Azure SQL Database Monitoring with OpenTelemetry - Database Transaction Unit (DTU), Connections & Deadlocks
sidebar_label: Azure SQL Database
sidebar_position: 3
description:
  Monitor Azure SQL Database (managed Platform-as-a-Service) with the
  OpenTelemetry Collector's azure_monitor receiver. Database Transaction
  Unit (DTU), connections, deadlocks, geo-replication lag to base14 Scout.
keywords:
  - azure sql database monitoring
  - azure sql opentelemetry
  - azure monitor receiver
  - dtu monitoring
  - sql connection metrics
  - azure sql deadlock
  - azure sql performance
  - sql database storage percent
  - basic vs premium tier metrics
  - base14 scout azure sql
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure SQL Database with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Run the OpenTelemetry Collector with the azure_monitor receiver targeting Microsoft.Sql/servers/databases (and optionally Microsoft.Sql/servers/elasticPools for pool-level metrics). The receiver polls Azure Monitor's REST API every 60 seconds, transforms metrics from Azure's lowercase names (like dtu_consumption_percent) to OTel-style names (azure_dtu_consumption_percent_average), and ships them via OTLP/HTTP to base14 Scout. Authentication uses the azure_auth extension in service-principal or managed-identity mode."}},{"@type":"Question","name":"Should I use this guide or the self-hosted SQL Server guide?","acceptedAnswer":{"@type":"Answer","text":"Use this guide for Azure SQL Database (the managed PaaS). Use the self-hosted SQL Server guide if you run SQL Server yourself on a VM, on-premises, or in a container - that path uses sqlserverreceiver to scrape DMVs directly instead of polling Azure Monitor. The two are complementary, not redundant: azure_monitor reports Azure's external view (DTU billing, blocked-by-firewall, geo-replication lag, storage-vs-cap), while sqlserverreceiver reports SQL Server internals (wait stats, buffer pool, query store). Production deployments commonly run both with distinct service.name values to keep the two views separate in dashboards."}},{"@type":"Question","name":"Why does connection_failed return no data points?","acceptedAnswer":{"@type":"Answer","text":"connection_failed is silent-when-quiet: Azure Monitor publishes a data point only when at least one connection failure (auth error, firewall block, TLS handshake failure) occurs in the time grain. Empty buckets return no point rather than a zero. Same shape applies to connection_failed_user_error, blocked_by_firewall, and deadlock. Wire alerts on these to fire on series presence in window, not on numeric thresholds."}},{"@type":"Question","name":"Why does the receiver emit both _count and _total suffixes for connection_successful?","acceptedAnswer":{"@type":"Answer","text":"Azure Monitor publishes connection_successful with two supported aggregations: Total (sum) and Count. The receiver emits one OTel metric per published aggregation, producing azure_connection_successful_total and azure_connection_successful_count for the same source metric. Same applies to connection_failed, blocked_by_firewall, and deadlock. Pick whichever aggregation you prefer for dashboards; they carry the same information at the per-minute grain."}},{"@type":"Question","name":"Which metrics need higher tiers to emit non-zero values?","acceptedAnswer":{"@type":"Answer","text":"replication_lag_seconds requires active geo-replication on the primary database (available on Standard tier and above; Basic excluded; only emitted on the primary). xtp_storage_percent requires Premium or Business Critical (in-memory Online Transaction Processing is not available below Premium). app_cpu_billed and app_cpu_percent only emit on Serverless databases. The receiver always polls these names; they simply return no series on tiers that don't support the underlying feature."}},{"@type":"Question","name":"Can I monitor elastic pools alongside individual databases?","acceptedAnswer":{"@type":"Answer","text":"Yes - the shipped config covers both Microsoft.Sql/servers/databases and Microsoft.Sql/servers/elasticPools. The receiver silently skips the elastic-pool namespace if the target server has no pools, so the same config is safe to run against servers that don't use pools."}},{"@type":"Question","name":"How does this differ from Application Insights for Azure SQL Database?","acceptedAnswer":{"@type":"Answer","text":"Application Insights for Azure SQL is Azure-tenant-bound, billed per-GB ingested, and visualised in Azure dashboards or workbooks. The OpenTelemetry Collector is vendor-neutral - the same image ships to base14 Scout or any OTLP-compatible backend without redeployment. Multi-cloud customers and customers migrating off Application Insights prefer this. The metric coverage is identical - both surfaces draw from the same Azure Monitor REST API."}}]}
---

## Overview

This guide covers monitoring an **Azure SQL Database** (the managed
Platform-as-a-Service, PaaS) with the OpenTelemetry Collector's
`azure_monitor` receiver. The collector polls Azure Monitor's REST API
every 60 seconds for the metrics published by
`Microsoft.Sql/servers/databases`, transforms them to OTel-style names, and
ships them via OTLP/HTTP to base14 Scout.

The `azure_monitor` receiver does not connect to SQL directly. It queries
Azure Monitor's metrics surface for any database Azure auto-publishes to - so
the same pattern applies across all SKUs (DTU model, vCore, Serverless,
Hyperscale), single databases and elastic pools, and to other Azure
services like Cosmos DB, Storage, and Service Bus. The configuration shape
below generalises to those.

## Self-hosted SQL Server vs Azure SQL Database

If you run SQL Server yourself - on a VM, on-premises, or in a container -
use the [self-hosted SQL Server guide](../../component/sqlserver.md) instead.
That path uses the OTel `sqlserverreceiver` to scrape Dynamic Management
Views (DMVs) directly, which works without an Azure subscription and surfaces
internals (query plans, wait stats, buffer cache hit ratio) that Azure
Monitor doesn't expose.

| Surface | Mechanism | Subscription | Internals |
| --- | --- | --- | --- |
| Azure SQL Database (PaaS) | `azure_monitor` receiver, this guide | Required | DTU, connections, storage |
| SQL Server (VM / on-prem / container) | `sqlserverreceiver`, [other guide](../../component/sqlserver.md) | Not required | DMV scrapes - wait stats, query plans, buffer pool |

**Pick exactly one per database.** Running both against the same workload
produces double-counted dashboards because the metric names overlap with
different dimensions.

## What you'll monitor

Two Azure namespaces, scraped together on each poll:

1. **`Microsoft.Sql/servers/databases`** - per-database metrics: Database
   Transaction Unit (DTU), connections, storage, deadlocks, replication
   lag, in-memory Online Transaction Processing (OLTP) usage.
2. **`Microsoft.Sql/servers/elasticPools`** - pool-level capacity and
   saturation. Omitted if no elastic pools exist on the target server.

The receiver emits one OTel metric per Azure aggregation. Two shapes:

- **Gauge-style** (`dtu_consumption_percent`, `cpu_percent`, `storage_percent`,
  `sessions_percent`, `workers_percent`, `xtp_storage_percent`,
  `replication_lag_seconds`) - Azure publishes Average / Maximum / Minimum,
  the receiver emits `_average`, `_maximum`, `_minimum`.
- **Counter-style** (`connection_successful`, `connection_failed`,
  `connection_failed_user_error`, `blocked_by_firewall`, `deadlock`) - Azure
  publishes Total (Sum) and Count, the receiver emits `_total` and `_count`.
  The two carry the same information at the per-minute grain; pick one for
  dashboards.

`availability` is the exception: Azure publishes all five aggregations
(Average, Maximum, Minimum, Count, Total), so the receiver emits five OTel
series. Use `_average` for SLO dashboards.

### Database-level (`Microsoft.Sql/servers/databases`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `cpu_percent` | `azure_cpu_percent_{average,maximum,minimum}` | Percent | Database CPU usage. Page at sustained 80%+. |
| `dtu_consumption_percent` | `azure_dtu_consumption_percent_*` | Percent | Composite DTU saturation (DTU model only). |
| `dtu_used` / `dtu_limit` | `azure_dtu_used_*` / `azure_dtu_limit_*` | Count (DTU) | Absolute DTU consumption + tier ceiling. |
| `cpu_used` / `cpu_limit` | `azure_cpu_used_*` / `azure_cpu_limit_*` | Count (vCore) | Absolute vCore consumption + tier ceiling (vCore SKUs only). |
| `log_write_percent` | `azure_log_write_percent_*` | Percent | Write-log throughput saturation. |
| `physical_data_read_percent` | `azure_physical_data_read_percent_*` | Percent | Read-IO saturation (page reads from storage). |
| `storage` | `azure_storage_{average,maximum,minimum}` | Bytes | Allocated storage in bytes. |
| `storage_percent` | `azure_storage_percent_*` | Percent | % of `maxSizeBytes` used. Alert at 80%. |
| `sessions_percent` | `azure_sessions_percent_*` | Percent | Sessions vs. tier ceiling. |
| `workers_percent` | `azure_workers_percent_*` | Percent | Workers vs. tier ceiling. |
| `connection_successful` | `azure_connection_successful_{count,total}` | Count | Successful connections per minute. |
| `connection_failed` | `azure_connection_failed_{count,total}` | Count | Failed connections - system errors (auth, firewall, TLS). Silent-when-quiet: data points only when at least one failure occurs in the grain. |
| `connection_failed_user_error` | `azure_connection_failed_user_error_{count,total}` | Count | Failed connections - user errors (login_failed, invalid_db). Different alert posture from `connection_failed`. |
| `blocked_by_firewall` | `azure_blocked_by_firewall_{count,total}` | Count | Connections rejected by server firewall rules. Silent-when-quiet. |
| `deadlock` | `azure_deadlock_{count,total}` | Count | Deadlock count - page on any non-zero. Silent-when-quiet. |
| `availability` | `azure_availability_{average,maximum,minimum,count,total}` | Percent | Database availability % (PT1H grain). All 5 aggregations published. |
| `replication_lag_seconds` | `azure_replication_lag_seconds_*` | Seconds | Geo-replication / active geo-replication lag. Emitted on the primary database when active geo-replication is configured (Standard tier and above; Basic excluded). |
| `xtp_storage_percent` | `azure_xtp_storage_percent_*` | Percent | In-memory Online Transaction Processing (OLTP) storage. Premium / Business Critical only (in-memory OLTP is not available below Premium). |

### Pool-level (`Microsoft.Sql/servers/elasticPools`)

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `eDTU_limit`, `eDTU_used` | `azure_edtu_limit_*`, `azure_edtu_used_*` | Count (eDTU) | Pool capacity vs. used (DTU pools). |
| `dtu_consumption_percent` | `azure_dtu_consumption_percent_*` | Percent | Pool DTU saturation. |
| `cpu_percent`, `log_write_percent`, `physical_data_read_percent` | `azure_cpu_percent_*`, `azure_log_write_percent_*`, `azure_physical_data_read_percent_*` | Percent | Pool CPU + I/O saturation. |
| `storage_used`, `storage_limit`, `storage_percent` | `azure_storage_used_*`, `azure_storage_limit_*`, `azure_storage_percent_*` | Bytes / Percent | Pool storage capacity vs. used. |
| `allocated_data_storage`, `allocated_data_storage_percent` | `azure_allocated_data_storage_*` | Bytes / Percent | Allocated-data view of pool storage. |
| `sessions_percent`, `sessions_count`, `workers_percent` | `azure_sessions_percent_*`, `azure_sessions_count_*`, `azure_workers_percent_*` | Percent / Count | Pool connection pressure. |
| `xtp_storage_percent` | `azure_xtp_storage_percent_*` | Percent | Pool-level in-memory OLTP storage. |

`connection_failed`, `connection_failed_user_error`, `blocked_by_firewall`,
and `deadlock` are silent-when-quiet: Azure Monitor publishes a data point
only when at least one event occurs in the time grain. Empty buckets return
no point rather than a zero. Wire alerts on these to fire on series
presence in window, not on numeric thresholds. (Note: this is not a
universal "Azure Monitor doesn't emit zeros" rule. `availability` and
several gauge metrics emit a point every grain regardless.)

The receiver also discovers the system `master` database alongside your
application database and emits the same database-scope series for both.
Filter by `cloud.resource_id` (which encodes the full Azure resource ID
for each emitted series) if you want to drop `master` in Scout.

### What Azure Monitor does NOT see

Wait stats, buffer pool hit ratio, query store, individual replica health
on Business Critical / Hyperscale, and the deadlock graph XML are SQL
Server *internals* - Azure Monitor doesn't expose them. Point the OTel
`sqlserverreceiver` at the SQL endpoint to add that depth; see the
[self-hosted SQL Server guide](../../component/sqlserver.md). The two paths
are complementary, not redundant - run both with distinct `service.name`
values when you need both views.

## Prerequisites

| Requirement                       | Minimum                          |
| --------------------------------- | -------------------------------- |
| An Azure SQL Database (any tier)  | DTU, vCore, Serverless, Hyperscale |
| OTel Collector contrib            | v0.148.0+ (snake_case YAML keys) |
| `Microsoft.Sql` provider          | registered on the subscription   |
| Service principal                 | `Monitoring Reader` on the SQL resource group |
| base14 Scout                      | any tenant                       |

This guide is the SQL-DB-specific addition to a working OpenTelemetry
Collector. For collector deployment + the Scout exporter pieces (which are
the same for every Azure surface), see:

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md), or
  [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) /
  [Linux Setup](../../collector-setup/linux-setup.md) for other runtimes.
- [Scout Exporter](../../collector-setup/scout-exporter.md) for the OAuth2 +
  OTLP/HTTP exporter config.

## Access setup

The `azure_monitor` receiver needs `Monitoring Reader` on the resource
group containing your SQL servers. The role grants read on metric
definitions and metric data only, no control-plane write.

```bash
RG_ID=$(az group show --name <your-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId or principalId> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

`azure_auth` supports four modes for the calling identity: `service_principal`
(out-of-Azure collectors), `managed_identity` (Container Apps / Virtual
Machine Scale Sets / Azure VM), `workload_identity` (Azure Kubernetes
Service pods, federated to a ServiceAccount), and `use_default` (local
dev). Full YAML for each mode and Workload Identity Federation setup is
in the [Service Bus
guide](./service-bus.md#authentication); the auth block is the only thing
that differs between Azure surfaces, the rest of the config below is
SQL-Database-specific.

Role-Based Access Control (RBAC) propagation on the legacy Azure Resource
Manager (ARM) `/metrics` endpoint is immediate. The data-plane batch API
at `*.metrics.monitor.azure.com` requires separate propagation that lags
5-30 minutes after grant; flip `use_batch_api: true` only after the role
has settled.

## Receiver configuration

This is the SQL-DB-specific addition to your collector. Add the
`azure_auth` extension and `azure_monitor` receiver to your existing
config, then wire the receiver into a metrics pipeline that exports to
Scout (see [Scout Exporter](../../collector-setup/scout-exporter.md) for the
exporter half - it's the same OAuth2 + OTLP/HTTP setup used by every Azure
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
    services:
      - Microsoft.Sql/servers/databases
      - Microsoft.Sql/servers/elasticPools
    auth: { authenticator: azure_auth }
    collection_interval: 60s
    use_batch_api: false
    cache_resources: 60
    dimensions: { enabled: true }
    metrics:
      "Microsoft.Sql/servers/databases":
        cpu_percent: []
        dtu_consumption_percent: []
        dtu_used: []
        dtu_limit: []
        physical_data_read_percent: []
        log_write_percent: []
        storage: []
        storage_percent: []
        connection_successful: []
        connection_failed: []
        blocked_by_firewall: []
        deadlock: []
        sessions_percent: []
        workers_percent: []
        availability: []
        replication_lag_seconds: []
        xtp_storage_percent: []
      "Microsoft.Sql/servers/elasticPools":
        cpu_percent: []
        dtu_consumption_percent: []
        eDTU_limit: []
        eDTU_used: []
        physical_data_read_percent: []
        log_write_percent: []
        storage_used: []
        storage_limit: []
        storage_percent: []
        allocated_data_storage: []
        allocated_data_storage_percent: []
        sessions_percent: []
        sessions_count: []
        workers_percent: []
        xtp_storage_percent: []

processors:
  resource:
    attributes:
      - { key: cloud.provider,    value: azure,                                   action: insert }
      - { key: cloud.platform,    value: azure_sql_database,                      action: insert }
      - { key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",          action: insert }
      - { key: cloud.region,      value: "${env:AZURE_REGION}",                   action: insert }
      - { key: cloud.resource_id, value: "${env:AZURE_SQL_DATABASE_RESOURCE_ID}", action: insert }
      - { key: service.name,      value: "${env:SERVICE_NAME}",                   action: insert }

service:
  extensions: [azure_auth]   # plus your existing extensions (oauth2client, etc.)
  pipelines:
    metrics:
      receivers: [azure_monitor]
      processors: [resource, batch]   # plus your existing processors
      exporters: [otlphttp/b14]       # the Scout exporter from the shared setup
```

Once `metrics:` is set for a namespace, the receiver only emits the metrics
you list - there is no implicit "default + my picks" merge. Extend the list
to add more (e.g., `tempdb_data_size: []` on Premium tier). The empty
aggregation list `[]` per metric collects all aggregations Azure publishes
for that metric.

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
AZURE_SQL_DATABASE_RESOURCE_ID=   # az sql db show -g <rg> -s <server> -n <db> --query id -o tsv

# Resource attribute defaults.
SERVICE_NAME=azure-sql-database
```

`AZURE_SQL_DATABASE_RESOURCE_ID` is the full ARM resource ID of the
database whose metrics you want to label most explicitly with
`cloud.resource_id`. The `azure_monitor` receiver discovers every database
in the configured resource group; this attribute is for the dashboard /
filter convention, not for scoping the scrape.

## Key alerts to configure

Threshold guidance for the most operationally useful series. Tune to your
workload; these are starting points for a Basic/Standard tier with
real traffic.

| Metric (OTel name)                          | Warning   | Critical  | Why it matters |
| ------------------------------------------- | --------- | --------- | -------------- |
| `azure_dtu_consumption_percent_average`     | > 75% / 5m | > 90% / 5m | Sustained DTU saturation throttles queries; precedes connection failures. |
| `azure_cpu_percent_average`                 | > 80% / 5m | > 95% / 5m | CPU-bound workload; correlate with query plans before scaling tier. |
| `azure_storage_percent_average`             | > 75%     | > 90%     | Approaching `maxSizeBytes`; out-of-space halts writes on Basic / Standard. |
| `azure_sessions_percent_average`            | > 70%     | > 90%     | Connection-pool exhaustion; tier ceiling differs per SKU. |
| `azure_workers_percent_average`             | > 70%     | > 90%     | Concurrent-request ceiling; tier-specific. |
| `azure_log_write_percent_average`           | > 80% / 5m | > 95% / 5m | Write-throughput saturation; impacts replication lag. |
| `azure_connection_failed_total`             | > 0 / 5m  | sustained > 0 / 15m | Auth, firewall, or TLS issues; investigate immediately when sustained. |
| `azure_blocked_by_firewall_total`           | > 0 / 5m  | > 10 / 5m | Firewall blocking traffic; usually a misconfiguration. |
| `azure_deadlock_total`                      | > 0       | > 5 / 5m  | Application-side concurrency bug; any non-zero deserves investigation. |
| `azure_replication_lag_seconds_average`     | > 5s      | > 30s     | Geo-replication / read-scale-out drift; only relevant on Premium / BC / Hyperscale. |
| `azure_availability_average`                | < 100% / 1h | < 99.9% / 1h | SLA-compliant availability; PT1H grain. |

For elastic pools, mirror `azure_dtu_consumption_percent_*`,
`azure_storage_percent_*`, `azure_sessions_percent_*`, and
`azure_workers_percent_*` against the pool resource using the same
thresholds.

## Operations

- **Collection interval.** 60 seconds is the sweet spot - Azure Monitor's
  ingestion lag is 1-3 minutes, so faster polls just re-read stale data.
- **`cache_resources`.** This is the receiver's resource-list cache TTL in
  seconds (default 24h). The shipped config sets it to `60` so newly-
  created databases are visible to the receiver on the next poll -
  appropriate for a validation pass or for environments where databases
  come and go frequently. In a stable production fleet, raise it back
  toward the default (e.g., `3600` or higher) to skip the per-minute ARM
  resource-list call.
- **RBAC propagation.** The legacy ARM `/metrics` endpoint propagates
  `Monitoring Reader` immediately. The newer data-plane batch API at
  `*.metrics.monitor.azure.com` requires separate RBAC propagation that can
  lag 5-30 minutes after grant.
- **Switching to `use_batch_api: true`** raises Azure Monitor's per-tenant
  query rate ceiling from 12,000 to 360,000 calls/hour. Worth it once you're
  scraping more than a handful of databases. Wait for data-plane RBAC to
  settle before enabling.
- **System `master` database.** The receiver auto-discovers the system
  `master` database alongside your application databases and emits the
  same database-scope series for both. `master` is mostly noise - filter
  by `cloud.resource_id` in Scout if you want to ignore it.
- **Tier-gated metrics.** A few names in the whitelist only emit when the
  underlying feature is configured:
  - `replication_lag_seconds` requires active geo-replication on the
    primary database. Available on Standard tier and above; Basic excluded.
    Only emitted on the primary, never on the secondary.
  - `xtp_storage_percent` requires Premium or Business Critical (in-memory
    Online Transaction Processing is not available below Premium).
  - `app_cpu_billed` and `app_cpu_percent` only emit on Serverless
    databases.

  The receiver polls these names regardless and silently returns no series
  on tiers that don't support the underlying feature, so the same config
  works across Database Transaction Unit (DTU), vCore, Serverless, and
  Hyperscale fleets.
- **`InstanceAndAppAdvanced` category.** Add `tempdb_data_size`,
  `tempdb_log_size`, `tempdb_log_used_percent`, `sql_instance_cpu_percent`,
  and `sql_instance_memory_percent` to the whitelist if you want the
  detailed `tempdb` and instance-level series. They are not tier-gated -
  Microsoft's reference lists them without a tier minimum - but they emit
  only on databases not configured as data warehouses.

## Apps-side instrumentation

This guide is metrics-only. For per-query distributed traces (the SQL
client span linked through the application's request span), instrument
your application code with the OTel SQL client integrations:

- **.NET / C#:** `Microsoft.Data.SqlClient` 5.1+ emits OpenTelemetry spans
  via its built-in ActivitySource. Register
  `AddSource("OpenTelemetry.Instrumentation.SqlClient")` or use the
  `OpenTelemetry.Instrumentation.SqlClient` package.
- **Java:** the OTel Java agent auto-instruments JDBC drivers including
  `mssql-jdbc`. No code changes.
- **Python:** `opentelemetry-instrumentation-pymssql` and
  `opentelemetry-instrumentation-pyodbc` wrap the respective drivers.

Run the apps-side spans alongside this metrics collector with distinct
`service.name` values to keep the database-server view and the
request-flow view separately filterable in Scout.

## Pairing with Diagnostic Settings

Azure SQL Database Diagnostic Settings forward audit logs, query store
runtime statistics, automatic tuning recommendations, errors, blocks,
deadlocks, and timeouts to Log Analytics, Event Hubs, or a Storage
account. The collector covers metrics; logs require a separate forwarder.

Two integration paths:

1. **Diagnostic Settings to Event Hubs to `azure_event_hub` receiver.** The
   collector reads Event Hubs and ships logs alongside metrics. One
   pipeline, OTLP-native. Recommended when migrating off Application
   Insights.
2. **Diagnostic Settings to Log Analytics workspace.** Keep Kusto Query
   Language-based log investigation in Azure; Scout handles metrics +
   alerts. Pragmatic when incident response runbooks already use the Log
   Analytics surface.

```bash
az monitor diagnostic-settings create \
  --resource <database-resource-id> \
  --name sql-to-eventhubs \
  --logs '[{"category":"SQLInsights","enabled":true},{"category":"AutomaticTuning","enabled":true},{"category":"QueryStoreRuntimeStatistics","enabled":true},{"category":"Errors","enabled":true},{"category":"Deadlocks","enabled":true},{"category":"Blocks","enabled":true},{"category":"Timeouts","enabled":true}]' \
  --event-hub-rule <eh-namespace-rule-id>
```

Activity logs (control-plane operations on the SQL server) are
subscription-scoped, not resource-scoped; configure them once per
subscription via `az monitor diagnostic-settings subscription create`.

## Troubleshooting

For common `azure_auth` and Azure Monitor issues
(`AuthorizationFailed`, `403 Forbidden`, token-acquire 401,
`RequestThrottled`, Docker DNS resolution, Scout OAuth2 401), see the
[Service Bus troubleshooting
section](./service-bus.md#troubleshooting); the same diagnoses apply to
every Azure surface scraped via `azure_monitor`. Below are the issues
specific to Azure SQL Database.

### No metrics in the first 3 minutes

Azure Monitor has a 1-3 minute ingestion lag. `azure_storage` and
`azure_dtu_limit` emit on every database from the first poll. Database
Transaction Unit (DTU), connection, and lock metrics only show non-zero
values after real workload on the database - control-plane calls
(`az sql db show`) don't drive them. If the database is idle, that's
expected.

### `connection_failed` / `blocked_by_firewall` / `deadlock` are absent

Expected. These metrics are silent-when-quiet: Azure Monitor publishes a
data point only when at least one event occurs in the time grain. Empty
buckets return no point rather than a zero. Wire alerts on these to fire
on series presence in window, not on numeric thresholds.

### `master` system database appears alongside application databases

Expected. The `azure_monitor` receiver auto-discovers the system `master`
database alongside your application database and emits the same
database-scope series for both. `master` is mostly noise; filter by
`cloud.resource_id` in Scout if you want to drop it.

### `replication_lag_seconds` series missing on the secondary

Expected. The metric is only emitted on the primary database in an active
geo-replication pair. The secondary's replication lag is observable from
the primary's series, not from the secondary's.

### `xtp_storage_percent` series missing on Standard tier

Expected. In-memory Online Transaction Processing (OLTP) is only available
on Premium and Business Critical tiers; the metric is never published on
lower tiers. Same for `app_cpu_billed` and `app_cpu_percent`, which only
emit on Serverless databases.

## Frequently Asked Questions

### How do I monitor Azure SQL Database with OpenTelemetry?

Run the OpenTelemetry Collector with the `azure_monitor` receiver targeting
`Microsoft.Sql/servers/databases` (and optionally
`Microsoft.Sql/servers/elasticPools` for pool-level metrics). The receiver
polls Azure Monitor's REST API every 60 seconds, transforms metrics from
Azure's lowercase names (like `dtu_consumption_percent`) to OTel-style
names (`azure_dtu_consumption_percent_average`), and ships them via
OTLP/HTTP to base14 Scout. Authentication uses the `azure_auth` extension
in service-principal or managed-identity mode.

### Should I use this guide or the self-hosted SQL Server guide?

Use this guide for Azure SQL Database (the managed PaaS). Use the
[self-hosted SQL Server guide](../../component/sqlserver.md) if you run SQL
Server yourself on a VM, on-premises, or in a container - that path uses
`sqlserverreceiver` to scrape DMVs directly instead of polling Azure
Monitor. The two are complementary, not redundant: `azure_monitor` reports
Azure's external view (DTU billing, blocked-by-firewall, geo-replication
lag, storage-vs-cap), while `sqlserverreceiver` reports SQL Server
internals (wait stats, buffer pool, query store). Production deployments
commonly run both with distinct `service.name` values to keep the two
views separate in dashboards.

### Why does `connection_failed` return no data points?

`connection_failed` is silent-when-quiet: Azure Monitor publishes a data
point only when at least one connection failure (auth error, firewall
block, TLS handshake failure) occurs in the time grain. Empty buckets
return no point rather than a zero. Same shape applies to
`connection_failed_user_error`, `blocked_by_firewall`, and `deadlock`.
Wire alerts on these to fire on series presence in window, not on numeric
thresholds.

### Why does the receiver emit both `_count` and `_total` suffixes for `connection_successful`?

Azure Monitor publishes `connection_successful` with two supported
aggregations: `Total` (sum) and `Count`. The receiver emits one OTel
metric per published aggregation, producing
`azure_connection_successful_total` and `azure_connection_successful_count`
for the same source metric. Same applies to `connection_failed`,
`blocked_by_firewall`, and `deadlock`. Pick whichever aggregation you
prefer for dashboards; they carry the same information at the per-minute
grain.

### Which metrics need higher tiers to emit non-zero values?

`replication_lag_seconds` requires active geo-replication on the primary
database (available on Standard tier and above; Basic excluded; only
emitted on the primary). `xtp_storage_percent` requires Premium or
Business Critical (in-memory Online Transaction Processing is not
available below Premium). `app_cpu_billed` and `app_cpu_percent` only
emit on Serverless databases. The receiver always polls these names; they
simply return no series on tiers that don't support the underlying
feature.

### Can I monitor elastic pools alongside individual databases?

Yes - the shipped config covers both `Microsoft.Sql/servers/databases` and
`Microsoft.Sql/servers/elasticPools`. The receiver returns no series for
the elastic-pool namespace if the target server has no pools, so the same
config is safe to run against servers that don't use pools.

### How does this differ from Application Insights for Azure SQL Database?

Application Insights for Azure SQL is Azure-tenant-bound, billed per-GB
ingested, and visualised in Azure dashboards or workbooks. The
OpenTelemetry Collector is vendor-neutral - the same image ships to base14
Scout or any OTLP-compatible backend without redeployment. The metric
coverage is identical - both surfaces draw from the same Azure Monitor
REST API.

## Related Guides

- [Self-hosted SQL Server](../../component/sqlserver.md) - paired guide for SQL
  Server you run yourself (VM, on-prem, container). Uses `sqlserverreceiver`
  to scrape DMVs directly.
- [Azure Cosmos DB](./cosmos-db.md) - sister guide; same `azure_monitor`
  pattern, NoSQL surface.
- [Azure Kubernetes Service](./aks.md) - sister guide; same receiver
  pattern but adds in-cluster collectors for kubeletstats + cluster-state.
