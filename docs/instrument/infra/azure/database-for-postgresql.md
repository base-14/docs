---
date: 2026-05-14
id: collecting-azure-database-for-postgresql-telemetry
title: Azure Database for PostgreSQL Monitoring with OpenTelemetry - Platform Metrics, In-Database, and Resource Logs
sidebar_label: Database for PostgreSQL
description:
  Azure Database for PostgreSQL Flexible Server observability with
  OpenTelemetry — platform metrics via azure_monitor, in-database
  scrape via postgresqlreceiver, and resource logs via azure_event_hub.
keywords:
  - azure database for postgresql monitoring
  - azure postgres flexible server opentelemetry
  - postgresqlreceiver azure flex
  - pg_stat_statements azure
  - azure pg_admin role
  - postgresql diagnostic settings event hub
  - postgresqllogs postgresqlflexsessions
  - azure_monitor postgresql whitelist
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure Database for PostgreSQL Flexible Server with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Three instrumentation paths complement each other. Platform metrics use azure_monitor against Microsoft.DBforPostgreSQL/flexibleServers for resource saturation, connection counts, and network throughput. The in-database scrape uses the OpenTelemetry postgresqlreceiver against the server's public FQDN over TLS for per-database stats, WAL activity, replication, and table-level counters. Resource logs use azure_event_hub consuming Diagnostic Settings categories PostgreSQLLogs and PostgreSQLFlexSessions for per-connection and per-query audit detail. Pick paths based on how deep the debug-attribution needs to go."}},{"@type":"Question","name":"Why does my monitoring user fail to read pg_stat_replication on Azure Flex Server?","acceptedAnswer":{"@type":"Answer","text":"On Azure Database for PostgreSQL Flexible Server, the pg_monitor role alone is not sufficient. You also need to GRANT azure_pg_admin to the monitoring user. The azure_pg_admin role unlocks SELECT on pg_stat_replication and a handful of azure_* views that the OTel postgresqlreceiver queries. Without it, the receiver logs a permission-denied warning and emits a partial metric set."}},{"@type":"Question","name":"How do I enable pg_stat_statements on Azure Database for PostgreSQL Flexible Server?","acceptedAnswer":{"@type":"Answer","text":"pg_stat_statements requires two Server Parameter changes plus a CREATE EXTENSION. First, set shared_preload_libraries to include pg_stat_statements via az postgres flexible-server parameter set or Bicep, which triggers a server restart. Second, add pg_stat_statements to the azure.extensions allowlist. Third, run CREATE EXTENSION pg_stat_statements against the target database. The first two steps are non-negotiable on Azure even though self-hosted Postgres only requires the CREATE EXTENSION step."}},{"@type":"Question","name":"Is backup_storage_used safe to alert on at a 60-second collection interval?","acceptedAnswer":{"@type":"Answer","text":"No. backup_storage_used emits at a PT1H native grain on Azure Monitor. A receiver polling at 60 seconds will see the metric populate once per hour and report no recent data for the other 59 cycles. Either run a second azuremonitorreceiver instance scoped to backup_storage_used with collection_interval set to 1h, or drop the metric from the whitelist and rely on the Azure portal backup-quota view instead."}},{"@type":"Question","name":"What's the first-batch ship lag for PostgreSQL Flex Server Diagnostic Settings?","acceptedAnswer":{"@type":"Answer","text":"Resource-scope Diagnostic Settings on Flex Server typically ship the first batch within Azure's documented 5-15 minute window on first attach. Steady-state batches arrive every 10 to 30 seconds after that. Budget at least 15 minutes before treating an empty Event Hubs partition as a failure."}},{"@type":"Question","name":"Why are PostgreSQLLogs slow-query records empty under my workload?","acceptedAnswer":{"@type":"Answer","text":"PostgreSQLLogs records slow queries only when they exceed log_min_duration_statement. Workloads with sub-second mean latency will see only DDL events, connection events, errors, autovacuum, and lock waits in the stream if the threshold is left at the 1000 ms reference value used in this guide. Lower it to 100 ms to capture sub-second slow queries, or set it to -1 to capture every statement (high volume; combine with sampling)."}}]}
sidebar_position: 17
---

# Azure Database for PostgreSQL Monitoring with OpenTelemetry

> **Why Scout for Azure Database for PostgreSQL observability?**
>
> Azure Monitor's metric catalog gives you resource saturation and
> connection lifecycle at minute grain - enough for capacity alerts but
> not enough to attribute a 5xx burst to a specific query or table. The
> OTel `postgresqlreceiver` reads the same `pg_stat_*` views directly
> over a TLS-required connection, giving you per-database, per-table,
> and per-WAL signals at 10-second grain. Scout consumes both pipelines
> via OTLP and stores them alongside your AWS, GCP, on-prem, and
> application telemetry in one OTel-native query surface.
>
> Single-server (`Microsoft.DBforPostgreSQL/servers`) was retired by
> Microsoft and is **not** covered by this guide. Flexible Server
> (`Microsoft.DBforPostgreSQL/flexibleServers`) is the only supported
> shape.

## Overview

Azure Database for PostgreSQL Flexible Server is a managed PaaS
PostgreSQL with public or VNet-integrated access, a fixed admin role,
and a curated allowlist of extensions. Observability splits cleanly
across three paths:

- **Platform metrics** via the `azure_monitor` receiver against the
  `Microsoft.DBforPostgreSQL/flexibleServers` namespace.
- **In-database metrics** via the OpenTelemetry `postgresqlreceiver`
  connecting to the server's public FQDN over TLS. Identical receiver
  config to self-hosted Postgres; only the auth and TLS bits differ.
  See [self-hosted PostgreSQL](../../component/postgres.md) for the full
  receiver reference and metric definitions; this guide documents only
  the Azure-specific deltas.
- **Resource logs** via the `azure_event_hub` receiver against a
  Diagnostic Settings → Event Hubs pipeline.

This guide configures the platform-metrics and resource-logs receivers
in full and the in-database-scrape deltas. The in-database receiver
block itself, the full 33-metric list, and the collector pipeline
structure live in the self-hosted Postgres guide.

## Instrumentation paths for Flexible Server

Three paths exist; pick one, two, or all three based on the table
below.

| Path | What it covers | What it costs | Setup |
| --- | --- | --- | --- |
| **Platform metrics - Azure Monitor** (this guide, §What you'll monitor) | Resource saturation (CPU, memory, IOPS, storage), connection lifecycle (active / failed / succeeded), network throughput, transaction-log volume, hourly backup floor. Per-server resolution; minute grain. Does **not** see inside the database. | Azure Monitor query cost: one query per metric per scrape. At a 60s interval the daily cost runs in cents per server. | One Service Principal with `Monitoring Reader` on the resource group; one receiver block; one resource processor. |
| **In-database metrics - direct scrape** (this guide, §In-database metrics; details cross-linked to self-hosted Postgres) | Per-database commits / rollbacks, tuple ops, WAL activity, replication lag, bgwriter health, index scans, table size, dead-tuple counts, lock contention. Per-database and per-table resolution; 10-second grain. Sees inside the database. | One `postgresqlreceiver` block in your collector; a dedicated monitoring user with `pg_monitor` + `azure_pg_admin` grants; an open TCP/5432 path from collector → server FQDN with TLS. | Bicep sets `shared_preload_libraries = pg_stat_statements` via Server Parameters; the monitoring user holds the two-role grant; the receiver hits the public FQDN over TLS. |
| **Resource logs - Diagnostic Settings → Event Hubs** (this guide, §Logs below) | Per-connection and per-disconnection events (from `log_connections=on`, `log_disconnections=on`); slow queries above `log_min_duration_statement`; DDL audit (from `log_statement=ddl`); errors, lock waits, autovacuum runs. Per-record resolution; sub-second grain. | One Event Hubs Basic namespace (~$11/mo at 1 TU; 1 MB/s ingress absorbs roughly 4,000 records/sec at typical record size). The Diagnostic Setting itself is free. | One Diagnostic Setting on the server with the categories you care about; one Event Hubs namespace + hub + Send/Listen SAS rules; one `azure_event_hub` receiver fragment. |

### Which path to pick

Four decision criteria, in order of usual weight:

1. **Tier choice (Burstable / GeneralPurpose / MemoryOptimized).**
   Burstable B1ms / B2s is the cheapest shape but has a 2 GiB RAM
   ceiling that limits `pg_stat_statements`'s working set. The
   in-database scrape adds tangible value only above Burstable - on
   Burstable the platform metrics cover the relevant signals. Move to
   the in-database scrape + `pg_stat_statements` analysis on
   GeneralPurpose D2s_v3 and larger.
2. **Existing collector posture.** If you already run a Kubernetes
   collector or a shared scraper container that consumes `azure_monitor`
   for other surfaces, fold platform-metrics scraping into that. The
   in-database scrape is a separate per-database concern - typically a
   small dedicated collector beside the application that owns the
   database.
3. **Diagnostic Settings volume budget.** `PostgreSQLLogs` plus
   `PostgreSQLFlexSessions` is moderate-volume: a couple of records
   per session lifecycle plus slow-query records above the threshold.
   The four Query Store-derived categories
   (`PostgreSQLFlexQueryStoreRuntime`,
   `PostgreSQLFlexQueryStoreWaitStats`, `PostgreSQLFlexTableStats`,
   `PostgreSQLFlexDatabaseXacts`) add per-query and per-table records
   at much higher volume - enable them only when tuning specific
   workloads.
4. **Depth-of-debug appetite.** Resource saturation alerts only?
   Platform metrics alone. Per-query attribution? The in-database
   scrape plus resource logs with Query Store-derived categories.

If you are starting from zero, platform metrics plus resource logs
(default categories) is the lowest-effort win and catches the
broadest range of saturation and per-connection incidents. Add the
in-database scrape when investigations need per-database depth, and
turn on the Query Store categories when you are actively tuning
queries.

## What you'll monitor

The platform-metrics receiver scrapes one Azure Monitor namespace and emits
metrics under `cloud.platform: azure_postgresql_flexible_server`.

### Flexible Server metrics (`Microsoft.DBforPostgreSQL/flexibleServers`)

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `cpu_percent` | Average, Maximum | Server-wide CPU utilisation. On Burstable tiers, sustained CPU above the SKU's base rate (5% on B1ms, 20% on B2s, 40% on B2ms) drains the CPU credit pool. |
| `memory_percent` | Average, Maximum | Server-wide RAM utilisation. Burstable B1ms (2 GiB) is the most memory-constrained SKU; idle baseline depends on PG version and Query Store configuration. Treat the idle line as workload-relative rather than absolute. |
| `iops` | Average, Maximum | Disk operations per second across read + write. Compare against the SKU's IOPS ceiling. |
| `disk_bandwidth_consumed_percentage` | Average, Maximum | Disk throughput utilisation as a percentage of the SKU's bandwidth ceiling. |
| `storage_percent` | Average, Maximum | Provisioned storage utilisation. Pre-emptive: scale storage before this hits 90%. |
| `storage_used` | Average | Provisioned storage used in bytes. Pairs with `storage_percent` for absolute-byte alerting. |
| `storage_free` | Average | Bytes of free storage. The complementary signal to `storage_used`. |
| `active_connections` | Average, Maximum | Concurrent backends. Compare against the SKU's `max_connections` ceiling (50 on B1ms, scales with vCPU on larger SKUs). |
| `connections_failed` | Total | Failed connection attempts in the period. Sustained non-zero values indicate auth misconfiguration, firewall rejection, or upstream client churn. |
| `connections_succeeded` | Total | Successful connection attempts. Pairs with `connections_failed` for an auth-success rate. |
| `network_bytes_egress` | Total | Bytes sent from the server to clients. |
| `network_bytes_ingress` | Total | Bytes received from clients. |
| `txlogs_storage_used` | Average | Bytes occupied by WAL on the server's transaction-log volume. Climbs under write-heavy workloads and during archive-recovery delays. Note the metric name has no underscore between `tx` and `logs`. |
| `backup_storage_used` | Average | Bytes used in automated backup storage. See Operations footnote below. |

**Operations footnote - `backup_storage_used`:** The catalog exposes
`backup_storage_used` at a PT1H native grain. A receiver polling at
60s will see it populate once per hour and report `no recent data` for
the intervening 59 cycles. Either run a second `azuremonitorreceiver`
instance scoped to `backup_storage_used` with `collection_interval: 1h`,
or drop the metric from the whitelist and use the Azure portal's
backup-quota view instead.

**Catalog-available extras** (the full catalog has 73 metrics; named
here for completeness, add to your whitelist when the workload
warrants):

- Burstable credit health: `cpu_credits_consumed`, `cpu_credits_remaining`.
- IO direction split: `read_iops`, `write_iops`, `read_throughput`,
  `write_throughput`.
- IO saturation detail: `disk_iops_consumed_percentage`, `disk_queue_depth`.
- Per-database PG stats: `tps`, `xact_total`, `xact_commit`,
  `xact_rollback`, `numbackends`, `deadlocks`, `tup_inserted`,
  `tup_updated`, `tup_deleted`, `tup_returned`, `tup_fetched`,
  `temp_files`, `temp_bytes`, `blks_read`, `blks_hit`. (The
  in-database scrape covers these at higher resolution; whitelist them
  in Azure Monitor only if you do not run it.)
- Session detail: `sessions_by_state`, `sessions_by_wait_event_type`.
- Replication: `oldest_backend_time_sec`, `oldest_backend_xmin`,
  `oldest_backend_xmin_age`.
- Maintenance signal: `bloat_percent` (per-DB), `database_size_bytes`.
- Pooled-connection details (when pgbouncer enabled):
  `client_connections_active`, `client_connections_waiting`,
  `server_connections_active`, `server_connections_idle`,
  `total_pooled_connections`, `tcp_connection_backlog`.
- Health pulse: `is_db_alive`. Equivalent to `active_connections > 0`.

## Prerequisites

| Requirement | Detail |
| --- | --- |
| Server tier | Flexible Server, any SKU. Burstable B1ms is the smallest tier covered here; GeneralPurpose D2s_v3 and larger unlock the full in-database-scrape value (Burstable tiers have a 2 GiB RAM ceiling that limits `pg_stat_statements`'s working set). |
| PostgreSQL version | 13, 14, 15, 16, or 17 (when GA in your region). The receiver works on all supported versions. |
| OTel Collector Contrib | v0.151.0+ (the `azure_monitor` and `azure_event_hub` receiver names are snake_case from v0.148.0; v0.151.0 is the current fleet). |
| OpenTelemetry semconv | v1.41.0. |
| Azure CLI | 2.85+ for the `az monitor diagnostic-settings` flags used here. |
| Azure providers registered | `Microsoft.DBforPostgreSQL`, `Microsoft.EventHub`. The PostgreSQL provider in particular is often `NotRegistered` on fresh subscriptions and takes ~70 seconds to register. |
| Collector runtime | See [Docker Compose Setup](../../collector-setup/docker-compose-example.md) or [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) for the runtime; this guide adds the PostgreSQL-specific receiver + processor blocks on top. |
| Scout exporter | See [Scout exporter wiring](../../collector-setup/scout-exporter.md) for the `oauth2client` extension + `otlp_http/b14` exporter. This guide does not re-derive that block. |

## Access setup

Two role assignments cover the metrics path; the logs path uses SAS
auth on the Event Hubs SAS rule and does not require an additional
role.

| Role | Scope | Reason |
| --- | --- | --- |
| `Monitoring Reader` | Resource group containing the Flex Server | Lets the `azure_monitor` receiver list metric definitions and read metric values. |
| `Reader` (optional) | Subscription or resource group | Convenient for the same SP to enumerate other Azure surfaces in the same RG; not strictly required for the receiver. |

Both metric-path assignments are idempotent - re-running them on a
previously granted SP is a no-op.

The in-database receiver uses a **PostgreSQL** role, not an Azure
role. Connect as the server admin (or any user with `CREATEROLE`),
create a dedicated monitoring user, and grant it both `pg_monitor`
(standard) and `azure_pg_admin` (Azure-specific):

```sql title="setup monitoring user"
CREATE USER postgres_exporter WITH PASSWORD '<strong-password>';
GRANT pg_monitor TO postgres_exporter;
GRANT azure_pg_admin TO postgres_exporter;
```

The `azure_pg_admin` grant is the Azure-specific delta. Without it,
the receiver fails to read `pg_stat_replication` and the
`azure_*` system views, and emits a partial metric set with
permission-denied warnings in its log.

## Receiver configuration (platform metrics)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_monitor/postgresql:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:PGFLEX_RESOURCE_GROUP}
    services:
      - Microsoft.DBforPostgreSQL/flexibleServers
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.DBforPostgreSQL/flexibleServers":
        cpu_percent:                          [Average, Maximum]
        memory_percent:                       [Average, Maximum]
        iops:                                 [Average, Maximum]
        disk_bandwidth_consumed_percentage:   [Average, Maximum]
        storage_percent:                      [Average, Maximum]
        storage_used:                         [Average]
        storage_free:                         [Average]
        active_connections:                   [Average, Maximum]
        connections_failed:                   [Total]
        connections_succeeded:                [Total]
        network_bytes_egress:                 [Total]
        network_bytes_ingress:                [Total]
        txlogs_storage_used:                  [Average]
        backup_storage_used:                  [Average]

processors:
  resource/postgresql:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_postgresql_flexible_server,            action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:PGFLEX_REGION}",                      action: insert}
      - {key: cloud.resource_id,           value: "${env:PGFLEX_SERVER_RESOURCE_ID}",          action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}",                        action: insert}
      - {key: service.name,                value: "${env:PGFLEX_SERVICE_NAME}",                action: insert}

service:
  pipelines:
    metrics/postgresql:
      receivers: [azure_monitor/postgresql]
      processors: [memory_limiter, resource/postgresql, batch]
      exporters: [otlp_http/b14]
```

The metric name `txlogs_storage_used` carries no underscore between
`tx` and `logs`. Azure's catalog uses the concatenated form.

## Environment variables (platform metrics)

```bash title=".env"
AZURE_SUBSCRIPTION_ID=...
PGFLEX_RESOURCE_GROUP=...                    # RG containing the Flex Server
PGFLEX_REGION=...                            # for cloud.region; defaults to the RG region
PGFLEX_SERVER_RESOURCE_ID=...                # /subscriptions/.../flexibleServers/<server-name>
PGFLEX_SERVICE_NAME=pgflex-monitor
ENVIRONMENT=production
```

Service Principal credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`) and Scout exporter credentials
(`SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, `SCOUT_TOKEN_URL`,
`SCOUT_OTLP_ENDPOINT`) come from the shared base config and are not
listed here. See [Scout exporter wiring](../../collector-setup/scout-exporter.md).

## In-database metrics - direct scrape

The Azure-specific deltas vs. the self-hosted
[`postgresqlreceiver` reference](../../component/postgres.md) are limited
to four points. The receiver block, the 33-metric list, the resource
processor, and the pipeline all live in the self-hosted guide -
follow that for the YAML and the metric definitions, and layer the
deltas below on top.

### 1. Firewall rule for collector egress

Public-access Flex Server rejects all client IPs except those named
in explicit firewall rules. Two rules are typical:

```bash title="firewall rules"
# Allow Azure-internal traffic (Azure VMs, Container Apps, AKS pods)
az postgres flexible-server firewall-rule create \
  --resource-group <rg> --name <server> \
  --rule-name AllowAllAzureServicesAndResourcesWithinAzureIps \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# Allow your operator / collector IP
az postgres flexible-server firewall-rule create \
  --resource-group <rg> --name <server> \
  --rule-name AllowCollectorIp \
  --start-ip-address <collector-egress-ip> \
  --end-ip-address <collector-egress-ip>
```

The `0.0.0.0` start + end pair is the special-cased Flex Server form
that interprets the rule as "any Azure service in any subscription";
laptop / on-prem collectors hit it via the per-IP rule.

### 2. Monitoring user grants

Repeated here from §Access setup because this is the single most
common in-database-scrape-on-Azure pitfall:

```sql title="monitoring user"
CREATE USER postgres_exporter WITH PASSWORD '<strong-password>';
GRANT pg_monitor TO postgres_exporter;
GRANT azure_pg_admin TO postgres_exporter;
```

The receiver scrapes `pg_stat_replication` (and several `azure_*`
views) which require `azure_pg_admin`. Skip this grant and the
receiver returns partial data with `permission denied` log entries.

### 3. `pg_stat_statements` via Server Parameters

Azure Flex Server restricts `shared_preload_libraries` to an
allowlist. Loading `pg_stat_statements` is a two-step Server
Parameter change followed by a `CREATE EXTENSION`:

```bash title="enable pg_stat_statements"
# Add to shared_preload_libraries (triggers a server restart)
az postgres flexible-server parameter set \
  --resource-group <rg> --server-name <server> \
  --name shared_preload_libraries --value pg_stat_statements

# Add to Azure's extension allowlist
az postgres flexible-server parameter set \
  --resource-group <rg> --server-name <server> \
  --name azure.extensions --value PG_STAT_STATEMENTS
```

```sql title="load extension after restart"
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

The first command triggers a server restart. Sequence the work
accordingly: schedule the parameter change during a maintenance
window, wait for the server to come back up, then run the
`CREATE EXTENSION` from a psql session. Without the
`shared_preload_libraries` change the `pg_stat_statements` view is
empty even after `CREATE EXTENSION` succeeds.

### 4. Receiver config: TLS required

The receiver block from the self-hosted guide works unchanged with
two tweaks:

```yaml showLineNumbers title="postgresqlreceiver delta for Azure Flex"
receivers:
  postgresql:
    endpoint: "<server-name>.postgres.database.azure.com:5432"
    transport: tcp
    collection_interval: 10s
    username: ${env:PGFLEX_MONITORING_USER}
    password: ${env:PGFLEX_MONITORING_PASSWORD}
    databases:
      - <your-database>
    tls:
      insecure: false                    # Flex Server enforces TLS
      insecure_skip_verify: false        # default CA bundle trusts Microsoft Root CA
    metrics:
      # see self-hosted Postgres guide for the 33-metric block
      ...
```

Azure Flex Server's server certificate chains to the Microsoft Root
CA included in standard `ca-certificates` bundles. The
`otel/opentelemetry-collector-contrib:0.151.0` image's default trust
store accepts it without any custom `ca_file` configuration. Do not
set `insecure_skip_verify: true` - that would bypass the cert
verification you want on a public-internet connection.

The receiver shares the rest of its pipeline (processors, exporters)
with whatever Scout-export pattern your collector already uses. See
the self-hosted guide for the rest of the YAML.

## Operations

### `azure_pg_admin` grant ordering

When you create the monitoring user, the two grants (`pg_monitor`,
`azure_pg_admin`) must come from a role that holds them. The server
admin (the user named in `administratorLogin` on Bicep) has both by
default. If you delegate user-management to a non-admin DBA role,
verify the DBA role holds `azure_pg_admin` via `\du+ <dba-role>` -
the grant is not transferable to non-admin roles by default.

### `pg_stat_statements` requires server restart

`shared_preload_libraries` is not hot-reloadable. Setting it via
`az postgres flexible-server parameter set` queues a server restart;
the change applies on the next boot. Application reconnect logic
typically tolerates the 30-60 second restart window, but verify in
staging before applying in production.

### Burstable credit burn

On Burstable tiers, sustained CPU above the SKU's base rate (5% on
B1ms, 20% on B2s, 40% on B2ms) drains a CPU credit pool. When
credits exhaust, the server throttles to base rate. Alert on
`cpu_credits_remaining` falling below a SKU-specific safety floor (50
credits for B1ms is a reasonable starting point) so you can scale up
before throttling hits.

### `backup_storage_used` PT1H grain

See the Operations footnote in the metrics table above. The metric
populates once per hour; a 60s receiver sees `no recent data` for
59/60 cycles. Drop the metric or run a slow-poll receiver instance.

### Diagnostic Settings ship cadence

Resource-scope Diagnostic Settings first-batch ship lag on Flex
Server typically lands within Azure's documented 5-15 minute window
on first attach. Steady-state batches arrive every 10 to 30 seconds
after that. Budget at least 15 minutes before treating an empty
Event Hubs partition as a failure.

### RBAC propagation lag

`Monitoring Reader` on the resource group typically propagates in
under 30 seconds, occasionally up to 120 seconds. The first scrape
after a fresh role assignment may return `403 AuthorizationFailed`.
The receiver retries on the next 60s cycle; the noise clears within
two polls.

### Provider registration on first deploy

A fresh Azure subscription often has `Microsoft.DBforPostgreSQL` in
`NotRegistered` state. Registering takes ~70 seconds:

```bash
az provider register --namespace Microsoft.DBforPostgreSQL
```

Confirm with `az provider show --namespace Microsoft.DBforPostgreSQL
--query registrationState -o tsv` before triggering the Bicep deploy.

## Key alerts to configure

Once metrics are flowing, set up alerts on these thresholds. The
"Why" column gives the reasoning so you can adjust thresholds for
your workload.

| Signal | Warning | Critical | Why |
| --- | --- | --- | --- |
| `cpu_percent` (5 min) | > 75% Average | > 90% Average | Saturation; on Burstable, sustained > base-rate burns credits. |
| `memory_percent` (5 min) | > 80% Average | > 90% Average | Buffer-cache pressure; risk of swap on Burstable. |
| `storage_percent` (10 min) | > 75% | > 90% | Pre-emptive scale-up; storage scaling is non-disruptive. |
| `iops` vs SKU ceiling (5 min) | > 75% of SKU IOPS | > 90% of SKU IOPS | I/O saturation drives query latency tail. |
| `active_connections` vs `max_connections` (1 min) | > 75% | > 90% | Connection exhaustion is a hard failure mode. |
| `connections_failed` rate (5 min) | > 1/min sustained | > 10/min sustained | Auth or firewall misconfiguration; or upstream client churn. |
| `txlogs_storage_used` (1 hour) | > 2× rolling 24h mean | > 5× rolling 24h mean | WAL accumulation indicates write spike or archive-recovery delay. |

Configure the Scout-side alert rules through your dashboarding /
alerting stack once thresholds are decided; the receiver pipeline
above emits the underlying signals continuously.

## Logs

Flex Server publishes a rich set of Diagnostic Settings categories
that fill gaps the metric whitelist cannot.

### What logs uniquely fill

Platform metrics aggregate. Logs disaggregate. The gaps logs uniquely
cover for Flex Server:

- **Per-connection attribution.** `active_connections` tells you 50
  backends are live; `PostgreSQLLogs` and `PostgreSQLFlexSessions`
  tell you **which** users, **from which IPs**, with **which
  application_name**, established each one. Required for tenant-
  attribution, credential-rotation forensics, and noisy-client
  detection.
- **Per-query slow-query attribution.** `cpu_percent` tells you the
  server worked hard; `PostgreSQLLogs` (above `log_min_duration_statement`)
  tells you **which** statements crossed the slow threshold, in which
  database, by which user. No metric exposes this.
- **DDL audit.** `log_statement = ddl` records every `CREATE`,
  `ALTER`, `DROP` against any schema. Required for change-management
  forensics and unauthorised-schema-change detection.
- **Lock-wait detail.** PG records lock-wait events above
  `deadlock_timeout` (1 s default). Aggregated `deadlocks` metric
  tells you it happened; the log entry tells you which queries
  collided and on which row / table.
- **Autovacuum / autoanalyze runs.** Per-table autovacuum events
  with start time, duration, and tuple-removal counts. The aggregated
  `bloat_percent` metric tells you a table is bloated; the log entry
  tells you which autovacuum runs completed (or were skipped) and
  why.
- **Connection lifecycle events.** Per-session connect / disconnect
  with duration. `PostgreSQLFlexSessions` records these at higher
  resolution than `PostgreSQLLogs`'s connection-event log lines and
  carries `session_id`, `application_name`, `client_addr`, and
  `backend_type` for correlation.

### Architecture

```text
Flex Server (Microsoft.DBforPostgreSQL/flexibleServers)
     │
     │ Diagnostic Setting (resource scope)
     │ categories: PostgreSQLLogs + PostgreSQLFlexSessions (default)
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

The Diagnostic Setting targets the **server** resource directly.

### Categories enabled by default

| Category | What it covers |
| --- | --- |
| `PostgreSQLLogs` | Server log: connection / disconnection events (`log_connections = on`, `log_disconnections = on`), slow queries above `log_min_duration_statement`, DDL statements (`log_statement = 'ddl'`), errors, lock waits, autovacuum / autoanalyze runs. The single highest-signal category for routine debugging. |
| `PostgreSQLFlexSessions` | Per-session connect / disconnect events with session_id, user, application_name, client_addr, backend_type, duration. Higher resolution than PostgreSQLLogs's connection events; required for per-tenant connection attribution. |

**Slow-query records depend on the threshold.** PostgreSQLLogs records
a query only when it exceeds `log_min_duration_statement`. Workloads
with sub-second mean latency will see no slow-query records if you
leave the threshold at the 1000 ms reference value used in
§Server Parameter prerequisites below - drop it to `100` ms to
capture sub-second slow queries, or set it to `-1` to log every
statement (high volume; combine with sampling).

### Optional categories

Named here so you know they exist; enable per workload:

- **`PostgreSQLFlexQueryStoreRuntime`** - per-query execution stats
  (count, mean duration, p95). Query Store on PG 16 ships on by
  default, so the data exists; only the Diagnostic Settings
  forwarding is gated.
- **`PostgreSQLFlexQueryStoreWaitStats`** - per-query wait events
  (Lock, IO, IPC, etc.). Pairs with the Runtime category for
  query-tuning analyses.
- **`PostgreSQLFlexTableStats`** - per-table size + bloat snapshot.
  Useful for capacity planning across schemas.
- **`PostgreSQLFlexDatabaseXacts`** - per-DB transaction counts.
  Cross-validation against the `xact_*` metrics in the platform-metrics
  catalog.

The four Query Store-derived categories together produce
significantly higher record volume than the defaults. Enable when you
are tuning specific workloads and disable when you finish.

### Receiver configuration (logs)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_event_hub/postgresqllogs:
    connection: ${env:PGFLEXLOGS_CONNECTION_STRING}
    partition: ""           # resume across all partitions
    offset: ""              # resume from last checkpoint
    format: azure           # decode Azure resource-log envelope
    apply_semantic_conventions: true

processors:
  resource/postgresqllogs:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_postgresql_flexible_server,            action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:PGFLEXLOGS_SOURCE_REGION}",           action: insert}
      # cloud.resource_id is NOT pinned - the receiver lifts the per-record
      # Azure resource ID to this attribute automatically (UPPERCASED).
      - {key: deployment.environment.name, value: "${env:PGFLEXLOGS_ENVIRONMENT}",             action: insert}
      - {key: service.name,                value: "${env:PGFLEXLOGS_SERVICE_NAME}",            action: insert}

service:
  pipelines:
    logs/postgresqllogs:
      receivers: [azure_event_hub/postgresqllogs]
      processors: [memory_limiter, resource/postgresqllogs, batch]
      exporters: [otlp_http/b14]
```

On first run with no stored checkpoint, the receiver starts from the
earliest available record in the hub's retention window (1 day on
Basic). On collector restart the receiver resumes from its last
checkpoint, so an idle window during deployment does not lose records
that arrived in the meantime.

The `PGFLEXLOGS_CONNECTION_STRING` value is the Listen-permission SAS
connection string for the namespace, **with `;EntityPath=<hub-name>`
appended** so the receiver knows which hub to consume from. Fetch it
once via:

```bash title="fetch the Listen connection string"
az rest --method post \
  --url "https://management.azure.com${COLLECTOR_LISTEN_RULE_ID}/listKeys?api-version=2024-01-01" \
  --query primaryConnectionString -o tsv
```

Then append `;EntityPath=<hub-name>` and store the result in your
collector's env file.

### Environment variables (logs)

```bash title=".env (logs path)"
PGFLEXLOGS_CONNECTION_STRING=...           # Listen SAS with ;EntityPath=<hub>
PGFLEXLOGS_SOURCE_REGION=...               # for cloud.region on log records
PGFLEXLOGS_SERVICE_NAME=pgflex-logs
PGFLEXLOGS_ENVIRONMENT=production
```

### Wiring the Diagnostic Setting

```bash title="attach the Diagnostic Setting"
az monitor diagnostic-settings create \
  --resource "<server-resource-id>" \
  --name pgflex-logs \
  --event-hub <hub-name> \
  --event-hub-rule "<diagsend-rule-id>" \
  --logs '[{"category":"PostgreSQLLogs","enabled":true},
           {"category":"PostgreSQLFlexSessions","enabled":true}]'
```

The `--event-hub-rule` value is the resource ID of the
namespace-scoped SAS rule with `Send` permission. The receiver uses
a separate Listen rule; one Send rule and one Listen rule on the
namespace is the canonical two-rule topology.

### Server Parameter prerequisites for log content

The Diagnostic Settings path routes whatever the server writes to its
log. To populate the categories above with useful content, set these
Server Parameters:

```bash
az postgres flexible-server parameter set --resource-group <rg> --server-name <server> --name log_statement                --value ddl
az postgres flexible-server parameter set --resource-group <rg> --server-name <server> --name log_min_duration_statement   --value 1000
az postgres flexible-server parameter set --resource-group <rg> --server-name <server> --name log_connections              --value on
az postgres flexible-server parameter set --resource-group <rg> --server-name <server> --name log_disconnections           --value on
```

Tune `log_min_duration_statement` to your slow-query threshold.
`log_statement = 'ddl'` is the security-relevant default; raise to
`all` only with care and only with sampling.

### Verifying the logs path

After the Diagnostic Setting is attached and the server has served
at least one client connection:

1. Wait 5 minutes for the first batch (resource-scope Diagnostic
   Settings first-batch lag).
2. Tail the collector debug exporter: `docker compose logs -f
   otel-collector | grep "otelcol.signal.*logs"`.
3. Expect batches of 5-30 log records every 10-30 seconds at typical
   transaction rates.
4. In Scout, filter `service.name = 'pgflex-logs'` and
   `cloud.platform = 'azure_postgresql_flexible_server'`; group by
   `azure.category` to confirm both enabled categories populate.

## Troubleshooting

### In-database receiver logs `permission denied for view pg_stat_replication`

**Cause:** The monitoring user holds `pg_monitor` but not
`azure_pg_admin`. **Fix:**

```sql
GRANT azure_pg_admin TO postgres_exporter;
```

Reconnect the receiver; the warning clears on the next scrape.

### In-database receiver: pg_stat_statements permission or missing-relation error

**Cause:** `pg_stat_statements` is not loaded. Either
`shared_preload_libraries` does not include it, `azure.extensions`
does not allowlist it, or `CREATE EXTENSION` has not run. **Fix:**
Run the three steps from §In-database metrics - direct scrape → 3.
Note the
`shared_preload_libraries` change triggers a server restart.

### Platform-metrics `AuthorizationFailed` on the first scrape

**Cause:** The `Monitoring Reader` role assignment on the resource
group has not yet propagated. **Fix:** Wait two polling cycles (~2
minutes). The receiver retries automatically; the error self-clears.

### `connection refused` from the in-database receiver

**Cause:** The collector's egress IP is not in the Flex Server's
firewall allowlist. **Fix:** Add the IP via `az postgres
flexible-server firewall-rule create`. If the collector runs in
Azure (VM, AKS), add the `0.0.0.0` Azure-services rule instead.

### Metric `backup_storage_used` shows `no recent data` in Scout

**Cause:** Expected behaviour - PT1H grain at a 60s receiver
interval. **Fix:** See Operations → `backup_storage_used` PT1H
grain.

### Metric `txlogs_storage_used` is missing from emissions

**Cause:** The whitelist used the incorrect name `tx_logs_storage_used`
(with an underscore between `tx` and `logs`). **Fix:** The catalog
name is `txlogs_storage_used` - no underscore. Patch the whitelist
and reload the receiver.

### First Event Hubs batch is empty after 20 minutes

**Cause:** The Diagnostic Setting attached but the server has not
yet served a matching event in the enabled categories. **Fix:** For
`PostgreSQLLogs`, drive at least one client connection
(`psql -h <server> -U <admin> -c 'SELECT 1'`). For
`PostgreSQLFlexSessions`, the same connection triggers a session
record on connect and a second on disconnect.

### `azure_event_hub` receiver logs `MessagingGatewayBadRequest`

**Cause:** The receiver is requesting a user-defined consumer group
that does not exist on Event Hubs Basic. **Fix:** Basic tier rejects
user-defined consumer groups - the receiver must consume from
`$Default`, the implicit group. Remove any `consumer_group:` key
from the receiver config or upgrade the namespace to Standard if you
need multiple consumer groups.

### PostgreSQLLogs records arrive but slow-query records are missing

**Cause:** `log_min_duration_statement` is higher than your typical
query latency. **Fix:** Drop the threshold to a value below the
slowest queries you want to capture. `100` ms is a reasonable
starting point for OLTP workloads; `-1` logs every statement (high
volume).

## Frequently Asked Questions

### How do I monitor Azure Database for PostgreSQL Flexible Server with OpenTelemetry?

Three instrumentation paths complement each other. Platform metrics
use `azure_monitor` against
`Microsoft.DBforPostgreSQL/flexibleServers` for resource saturation,
connection counts, and network throughput. The in-database scrape
uses the OpenTelemetry `postgresqlreceiver` against the server's
public FQDN over TLS for per-database stats, WAL activity,
replication, and table-level counters. Resource logs use
`azure_event_hub` consuming Diagnostic Settings categories
`PostgreSQLLogs` and `PostgreSQLFlexSessions` for per-connection and
per-query audit detail. Pick paths based on how deep the
debug-attribution needs to go.

### Why does my monitoring user fail to read pg_stat_replication?

On Azure Database for PostgreSQL Flexible Server, the `pg_monitor`
role alone is not sufficient. You also need to
`GRANT azure_pg_admin TO` the monitoring user. The `azure_pg_admin`
role unlocks `SELECT` on `pg_stat_replication` and a handful of
`azure_*` views that the OTel `postgresqlreceiver` queries. Without
it, the receiver logs a permission-denied warning and emits a
partial metric set.

### How do I enable pg_stat_statements on Flexible Server?

`pg_stat_statements` requires two Server Parameter changes plus a
`CREATE EXTENSION`. First, set `shared_preload_libraries` to include
`pg_stat_statements` via `az postgres flexible-server parameter set`
or Bicep, which triggers a server restart. Second, add
`pg_stat_statements` to the `azure.extensions` allowlist. Third, run
`CREATE EXTENSION pg_stat_statements` against the target database.
The first two steps are non-negotiable on Azure even though
self-hosted Postgres only requires the `CREATE EXTENSION` step.

### Is `backup_storage_used` safe to alert on at a 60-second collection interval?

No. `backup_storage_used` emits at a PT1H native grain on Azure
Monitor. A receiver polling at 60 seconds will see the metric
populate once per hour and report `no recent data` for the other 59
cycles. Either run a second `azuremonitorreceiver` instance scoped
to `backup_storage_used` with `collection_interval` set to `1h`, or
drop the metric from the whitelist and rely on the Azure portal
backup-quota view instead.

### What's the first-batch ship lag for PostgreSQL Flex Server Diagnostic Settings?

Resource-scope Diagnostic Settings on Flex Server typically ship the
first batch within Azure's documented 5-15 minute window on first
attach. Steady-state batches arrive every 10 to 30 seconds after
that. Budget at least 15 minutes before treating an empty Event Hubs
partition as a failure.

### Why are PostgreSQLLogs slow-query records empty under my workload?

PostgreSQLLogs records slow queries only when they exceed
`log_min_duration_statement`. Workloads with sub-second mean latency
will see only DDL events, connection events, errors, autovacuum, and
lock waits in the stream if the threshold is left at the 1000 ms
reference value used in §Server Parameter prerequisites. Lower it to
100 ms to capture sub-second slow queries, or set it to `-1` to
capture every statement (high volume; combine with sampling).

## Related Guides

### Same surface, different paths

- [Self-hosted PostgreSQL](../../component/postgres.md) - the
  `postgresqlreceiver` reference for the in-database scrape. This
  guide layers Azure-specific deltas (firewall, `azure_pg_admin`,
  `pg_stat_statements` via Server Parameters, TLS-required) on it.

### Shared collector + Scout wiring

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  the runtime that hosts both receivers in this guide.
- [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  alternative runtime for AKS-hosted collectors.
- [Scout exporter wiring](../../collector-setup/scout-exporter.md) - the
  `oauth2client` extension + `otlp_http/b14` exporter block shared by
  all Azure guides.

### Apps-side instrumentation

- [FastAPI + Postgres](../../apps/auto-instrumentation/fast-api.md) -
  Python web app connecting to Flex Server over `psycopg`.
- [Express + Postgres](../../apps/auto-instrumentation/express.md) -
  Node.js web app connecting to Flex Server.
- [Spring Boot](../../apps/auto-instrumentation/spring-boot.md) - JVM
  apps connecting to Flex Server over JDBC.

### Adjacent Azure surfaces

- [Azure App Service](./app-service.md) - common host for web apps
  that connect to Flex Server.
- [Azure Cache for Redis](./cache-for-redis.md) - caching layer
  typically sat in front of PostgreSQL.
- [Azure Service Bus](./service-bus.md) - eventing fabric that often
  integrates with database-change events.
- [Azure Key Vault](./key-vault.md) - secrets store for the
  monitoring user's password.
- [Azure SQL Database](./sql-database.md) - managed SQL Server on
  Azure; the typical alternative when the workload needs T-SQL rather
  than PostgreSQL.
