---
date: 2026-05-16
id: collecting-azure-database-for-mysql-telemetry
title: Azure Database for MySQL Monitoring with OpenTelemetry - Platform Metrics, In-Database, and Resource Logs
sidebar_label: Database for MySQL
description:
  Azure Database for MySQL Flexible Server observability with
  OpenTelemetry - platform metrics via azure_monitor, in-database
  scrape via mysqlreceiver, and resource logs via azure_event_hub.
keywords:
  - azure database for mysql monitoring
  - azure mysql flexible server opentelemetry
  - mysqlreceiver azure flex
  - performance_schema azure mysql
  - azure mysql monitoring user grants
  - mysql diagnostic settings event hub
  - mysqlslowlogs diagnostic category
  - azure_monitor mysql whitelist
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure MySQL Flexible Server with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Three instrumentation paths complement each other. Platform metrics use azure_monitor against Microsoft.DBforMySQL/flexibleServers for resource saturation, connection counts, and network throughput. The in-database scrape uses the OpenTelemetry mysqlreceiver against the server's public FQDN over TLS for performance_schema depth: statement events, table I/O, lock waits, and per-query counters. Resource logs use azure_event_hub consuming the Diagnostic Settings category MySqlSlowLogs for per-slow-statement detail. Pick paths based on how deep the debug-attribution needs to go."}},{"@type":"Question","name":"Why can't my monitoring user read performance_schema on Azure MySQL?","acceptedAnswer":{"@type":"Answer","text":"The Azure Database for MySQL Flexible Server admin is not a SUPER user, so GRANT ALL and WITH GRANT OPTION fail. The monitoring user needs exactly three global grants the admin can issue: GRANT PROCESS, REPLICATION CLIENT ON *.* and GRANT SELECT ON performance_schema.*. With those three grants the mysqlreceiver reads global status, replica status, and the performance_schema tables it scrapes. Anything broader than these three will fail with ERROR 1045 or ERROR 1227."}},{"@type":"Question","name":"How do I enable performance_schema on Azure MySQL Flexible Server?","acceptedAnswer":{"@type":"Answer","text":"performance_schema is enabled through a Server Parameter, not my.cnf. Set it with az mysql flexible-server parameter set --name performance_schema --value ON. This parameter requires a server restart, so apply it pre-flight (via Bicep configurations or before the server carries production traffic) and let the server boot with it loaded. performance_schema ON alone does not guarantee the events_statements_* consumers are enabled, especially on memory-constrained Burstable tiers; if statement-event metrics read zero, follow the self-hosted MySQL statement-event troubleshooting to enable the setup_consumers rows."}},{"@type":"Question","name":"Is backup_storage_used safe to alert on at a 60-second collection interval?","acceptedAnswer":{"@type":"Answer","text":"No. backup_storage_used emits at a PT15M native grain on Azure Monitor and does not populate until the first automated backup completes, which is hours after a server is first created. A receiver polling at 60 seconds will report no recent data for most cycles, and a freshly created server reports nothing at all until its first backup. Treat a sparse or absent series as expected behaviour rather than a pipeline failure, and rely on the Azure portal backup-quota view for backup-storage alerting."}},{"@type":"Question","name":"Why is replication_lag empty on my Azure MySQL Flexible Server?","acceptedAnswer":{"@type":"Answer","text":"replication_lag is a replica-only metric. On a single-primary server with no read replicas attached there are zero series to emit, so the metric stays empty. This is expected behaviour, not a broken whitelist. The series populates once a read replica is attached to the server."}},{"@type":"Question","name":"Why are MySqlSlowLogs records empty under my workload?","acceptedAnswer":{"@type":"Answer","text":"MySqlSlowLogs records a statement only when its execution time exceeds long_query_time. A workload whose statements all run faster than the threshold produces an empty slow log even though the Diagnostic Setting is attached and the pipeline is healthy. Lower long_query_time to a value below the slowest queries you want to capture, or confirm the path end-to-end with a deliberate slow probe such as SELECT SLEEP(2) when long_query_time is 1 second."}}]}
sidebar_position: 19
---

# Azure Database for MySQL Monitoring with OpenTelemetry

> **Why Scout for Azure Database for MySQL observability?**
>
> Azure Monitor's metric catalog gives you resource saturation and
> connection lifecycle at minute grain - enough for capacity alerts but
> not enough to attribute a slow-query spike to a specific statement or
> table. The OTel `mysqlreceiver` reads `performance_schema` directly
> over a TLS-required connection, giving you statement-event, table-I/O,
> and lock-wait signals at 10-second grain. Scout consumes both
> pipelines via OTLP and stores them alongside your AWS, GCP, on-prem,
> and application telemetry in one OTel-native query surface.
>
> Single-server (`Microsoft.DBforMySQL/servers`) was retired by
> Microsoft and is **not** covered by this guide. Flexible Server
> (`Microsoft.DBforMySQL/flexibleServers`) is the only supported shape.

## Overview

Azure Database for MySQL Flexible Server is a managed PaaS MySQL with
public or VNet-integrated access, a fixed admin role that is not a
`SUPER` user, and Server Parameters in place of `my.cnf`.
Observability splits cleanly across three paths:

- **Platform metrics** via the `azure_monitor` receiver against the
  `Microsoft.DBforMySQL/flexibleServers` namespace.
- **In-database metrics** via the OpenTelemetry `mysqlreceiver`
  connecting to the server's public FQDN over TLS. Identical receiver
  config to self-hosted MySQL; only the auth, firewall, and TLS bits
  differ. See [self-hosted MySQL](../../component/mysql.md) for the
  full receiver reference and metric definitions; this guide documents
  only the Azure-specific deltas.
- **Resource logs** via the `azure_event_hub` receiver against a
  Diagnostic Settings to Event Hubs pipeline.

This guide configures the platform-metrics and resource-logs receivers
in full and the in-database-scrape deltas. The in-database receiver
block itself, the full metric list, and the collector pipeline
structure live in the self-hosted MySQL guide.

## Instrumentation paths for Flexible Server

Three paths exist; pick one, two, or all three based on the table
below.

| Path | What it covers | What it costs | Setup |
| --- | --- | --- | --- |
| **Platform metrics - Azure Monitor** (this guide, §What you'll monitor) | Resource saturation (CPU, memory, IO consumption, storage), connection lifecycle (active / total / aborted), network throughput, query and slow-query rates, replica lag. Per-server resolution; minute grain. Does **not** see inside the database. | Azure Monitor query cost: one query per metric per scrape. At a 60s interval the daily cost runs in cents per server. | One Service Principal with `Monitoring Reader` on the resource group; one receiver block; one resource processor. |
| **In-database metrics - direct scrape** (this guide, §In-database metrics; details cross-linked to self-hosted MySQL) | Statement-event counts and wait times, table I/O, table size and row counts, read / write lock-wait counts and times, command counts, join operations, replica delay. Per-statement and per-table resolution; 10-second grain. Sees inside the database. | One `mysqlreceiver` block in your collector; a dedicated monitoring user with three global grants; an open TCP/3306 path from collector to server FQDN with TLS. | A Server Parameter sets `performance_schema = ON` (restart-bound, applied pre-flight); the monitoring user holds `PROCESS, REPLICATION CLIENT` and `SELECT ON performance_schema.*`; the receiver hits the public FQDN over TLS. |
| **Resource logs - Diagnostic Settings to Event Hubs** (this guide, §Logs below) | Per-slow-statement detail: statements exceeding `long_query_time`, with lock time, rows examined, rows sent. Optional connection / DDL / DML audit via the audit-log category. Per-record resolution; sub-second grain. | One Event Hubs Basic namespace (~$11/mo at 1 TU; 1 MB/s ingress absorbs roughly 4,000 records/sec at typical record size). The Diagnostic Setting itself is free. | One Diagnostic Setting on the server with the categories you care about; one Event Hubs namespace + hub + Send/Listen SAS rules; one `azure_event_hub` receiver fragment. |

### Which path to pick

Four decision criteria, in order of usual weight:

1. **Tier choice (Burstable / GeneralPurpose / MemoryOptimized).**
   Burstable B1ms / B2s is the cheapest shape but has a 2 GiB RAM
   ceiling. `performance_schema` carries a memory cost, and on
   Burstable some `events_statements_*` consumers default off to save
   memory. The in-database scrape adds tangible value only above
   Burstable - on Burstable the platform metrics cover the relevant
   saturation signals. Move to the in-database scrape plus full
   `performance_schema` instrumentation on GeneralPurpose and larger,
   where the working set fits comfortably.
2. **Existing collector posture.** If you already run a Kubernetes
   collector or a shared scraper container that consumes
   `azure_monitor` for other surfaces, fold platform-metrics scraping
   into that. The in-database scrape is a separate per-database
   concern - typically a small dedicated collector beside the
   application that owns the database, because it needs the egress
   path and per-database credentials the shared scraper does not
   carry.
3. **Diagnostic Settings volume budget.** `MySqlSlowLogs` is
   moderate-volume: one record per statement above `long_query_time`.
   The audit-log category (`MySqlAuditLogs`) adds connection, DDL, and
   DML records at much higher volume and requires extra Server
   Parameters. Run slow-log only by default; add the audit log only
   when you have a forensic or compliance need and the volume budget
   for it.
4. **Depth-of-debug appetite.** Resource saturation alerts only?
   Platform metrics alone. Per-statement attribution? The in-database
   scrape plus resource logs with the audit-log category when DDL /
   DML provenance matters.

If you are starting from zero, platform metrics plus the slow-query
log is the lowest-effort win and catches the broadest range of
saturation and slow-statement incidents. Add the in-database scrape
when investigations need `performance_schema` depth, and turn on the
audit log only while you are actively chasing a provenance question.

## What you'll monitor

The platform-metrics receiver scrapes one Azure Monitor namespace and
emits metrics under `cloud.platform: azure_mysql_flexible_server`.

### Flexible Server metrics (`Microsoft.DBforMySQL/flexibleServers`)

| Metric | Aggregation | What it tells you |
| --- | --- | --- |
| `cpu_percent` | Average, Maximum | Server-wide CPU utilisation. On Burstable tiers, sustained CPU above the SKU's base rate drains the CPU credit pool and the server then throttles to base rate. |
| `memory_percent` | Average, Maximum | Server-wide RAM utilisation. Burstable B1ms (2 GiB) is the most memory-constrained SKU; treat the idle baseline as workload-relative rather than absolute. |
| `io_consumption_percent` | Average, Maximum | Disk IOPS utilisation as a percentage of the SKU's IOPS ceiling. Sustained high values drive query latency tails. |
| `storage_percent` | Average, Maximum | Provisioned storage utilisation. Pre-emptive: scale storage before this hits 90% (storage scaling is non-disruptive). |
| `storage_used` | Average | Provisioned storage used in bytes. Pairs with `storage_percent` for absolute-byte alerting. |
| `storage_limit` | Average | Provisioned storage ceiling in bytes. The denominator for `storage_used`. |
| `active_connections` | Average, Maximum | Concurrent backends. Compare against the SKU's `max_connections` ceiling (around 85 on B1ms; scales with vCPU on larger SKUs). |
| `total_connections` | Total | Connection attempts in the period. Pairs with `aborted_connections` for a connection-success view. |
| `aborted_connections` | Total | Connection attempts that failed or were aborted. Sustained non-zero values indicate auth misconfiguration, firewall rejection, or upstream client churn. |
| `network_bytes_egress` | Total | Bytes sent from the server to clients. |
| `network_bytes_ingress` | Total | Bytes received from clients. |
| `Queries` | Total | Statements executed in the period. The headline throughput signal. |
| `Slow_queries` | Total | Statements that exceeded `long_query_time` in the period. The aggregate count; per-statement detail comes from the slow-query log (see §Logs). |
| `replication_lag` | Maximum | Replica lag in seconds. See Operations footnote below. |
| `backup_storage_used` | Average | Bytes used in automated backup storage. See Operations footnote below. |

**Operations footnote - `replication_lag`:** This is a replica-only
metric. A single-primary server with no read replicas attached has
zero series to emit, so the metric stays empty. Treat an empty
`replication_lag` on a primary as expected behaviour; the series
populates once a read replica is attached.

**Operations footnote - `backup_storage_used`:** The catalog exposes
`backup_storage_used` at a PT15M native grain, and the series does not
populate until the server's first automated backup completes, which is
hours after a server is first created. A receiver polling at 60s will
report `no recent data` for most cycles, and a freshly created server
reports nothing at all until its first backup runs. Treat a sparse or
absent series as expected; use the Azure portal's backup-quota view
for backup-storage alerting instead of this metric.

**Catalog-available extras** (the full catalog has 55 metrics; named
here for completeness, add to your whitelist when the workload
warrants):

- Burstable credit health: `cpu_credits_consumed`,
  `cpu_credits_remaining` (PT15M grain).
- Per-statement counters: `Com_*` (high cardinality; the in-database
  scrape covers statement depth at higher resolution).
- InnoDB internals: `Innodb_buffer_pool_*`, `ibdata1_storage_used`,
  `trx_rseg_history_len` (the in-database scrape covers this).
- Server-log storage: `serverlog_storage_percent`,
  `serverlog_storage_usage`, `serverlog_storage_limit` (only
  meaningful once server logs accumulate).
- HA-only signals: `HA_*` (emitted only when zone-redundant HA is
  configured; not available on Burstable).
- Concurrency detail: `active_transactions`, `Threads_running`,
  `lock_deadlocks`, `lock_timeouts`, `Sort_merge_passes`,
  `storage_io_count`, `binlog_storage_used`, `Uptime`. (The
  in-database scrape covers the concurrency and lock signals at higher
  resolution; whitelist them in Azure Monitor only if you do not run
  it.)

## Prerequisites

| Requirement | Detail |
| --- | --- |
| Server tier | Flexible Server, any SKU. Burstable B1ms is the smallest tier covered here; GeneralPurpose and larger unlock the full in-database-scrape value (Burstable tiers have a 2 GiB RAM ceiling that constrains `performance_schema` and may leave some statement-event consumers off by default). |
| MySQL version | 5.7, 8.0, or 8.4 (when GA in your region). The receiver works on all supported versions; 8.0+ is recommended. |
| OTel Collector Contrib | v0.151+   (the `azure_monitor` and `azure_event_hub` receiver names are snake_case from v0.148.0; v0.151.0 is the current fleet). |
| OpenTelemetry semconv | v1.41.0. |
| Azure CLI | 2.85+ for the `az monitor diagnostic-settings` flags used here. |
| Azure providers registered | `Microsoft.DBforMySQL` (metrics source), plus `Microsoft.EventHub` and `Microsoft.Insights` for the Diagnostic Settings logs path. All three must be `Registered` in the subscription, or the receiver returns no metrics and `az monitor diagnostic-settings create` fails. |
| Collector runtime | See [Docker Compose Setup](../../collector-setup/docker-compose-example.md) or [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) for the runtime; this guide adds the MySQL-specific receiver + processor blocks on top. |
| Scout exporter | See [Scout exporter wiring](../../collector-setup/scout-exporter.md) for the `oauth2client` extension + `otlp_http/b14` exporter. This guide does not re-derive that block. |

## Access setup

One role assignment covers the metrics path; the logs path uses SAS
auth on the Event Hubs Listen SAS rule and does not require an
additional role.

| Role | Scope | Reason |
| --- | --- | --- |
| `Monitoring Reader` | Resource group containing the Flexible Server | Lets the `azure_monitor` receiver list metric definitions and read metric values. This is the only role assignment the metrics path needs. |

The role assignment is idempotent - re-running it on a previously
granted Service Principal is a no-op. The logs path consumes the
Diagnostic Settings hub through a Listen-permission SAS connection
string on the Event Hubs namespace, not a second role assignment.

The in-database receiver uses a **MySQL** user, not an Azure role.
Connect as the server admin, create a dedicated monitoring user, and
grant it exactly the three global privileges the receiver needs:

```sql title="setup monitoring user"
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<strong-password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

The Azure Flexible Server admin is **not** a `SUPER` user. `GRANT ALL`,
`WITH GRANT OPTION`, and any attempt to grant `SUPER` fail with
`ERROR 1045` or `ERROR 1227`. The three grants above are exactly the
self-hosted monitoring set and are all within what the Flexible Server
admin can issue; do not widen them.

## Receiver configuration (platform metrics)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_monitor/mysql:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:MYSQLFLEX_RESOURCE_GROUP}
    services:
      - Microsoft.DBforMySQL/flexibleServers
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.DBforMySQL/flexibleServers":
        cpu_percent:             [Average, Maximum]
        memory_percent:          [Average, Maximum]
        io_consumption_percent:  [Average, Maximum]
        storage_percent:         [Average, Maximum]
        storage_used:            [Average]
        storage_limit:           [Average]
        active_connections:      [Average, Maximum]
        total_connections:       [Total]
        aborted_connections:     [Total]
        network_bytes_egress:    [Total]
        network_bytes_ingress:   [Total]
        replication_lag:         [Maximum]
        backup_storage_used:     [Average]
        Queries:                 [Total]
        Slow_queries:            [Total]

processors:
  resource/mysql:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_mysql_flexible_server,                 action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:MYSQLFLEX_REGION}",                   action: insert}
      - {key: cloud.resource_id,           value: "${env:MYSQLFLEX_SERVER_RESOURCE_ID}",       action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}",                        action: insert}
      - {key: service.name,                value: "${env:MYSQLFLEX_SERVICE_NAME}",             action: insert}

service:
  pipelines:
    metrics/mysql:
      receivers: [azure_monitor/mysql]
      processors: [memory_limiter, resource/mysql, batch]
      exporters: [otlp_http/b14]
```

The whitelist names match Azure's catalog exactly for this namespace.
Still confirm them against
`az monitor metrics list-definitions --resource <id>` for your MySQL
version before treating an absent series as a config error.

## Environment variables (platform metrics)

```bash title=".env"
AZURE_SUBSCRIPTION_ID=...
MYSQLFLEX_RESOURCE_GROUP=...                 # RG containing the Flexible Server
MYSQLFLEX_REGION=...                         # for cloud.region; defaults to the RG region
MYSQLFLEX_SERVER_RESOURCE_ID=...             # /subscriptions/.../flexibleServers/<server-name>
MYSQLFLEX_SERVICE_NAME=mysqlflex-monitor
ENVIRONMENT=production
```

Service Principal credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`) and Scout exporter credentials
(`SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, `SCOUT_TOKEN_URL`,
`SCOUT_OTLP_ENDPOINT`) come from the shared base config and are not
listed here. See
[Scout exporter wiring](../../collector-setup/scout-exporter.md).

## In-database metrics - direct scrape

The Azure-specific deltas vs. the self-hosted
[`mysqlreceiver` reference](../../component/mysql.md) are limited to
five points. The receiver block, the full metric list, the resource
processor, the pipeline, and the existing Troubleshooting (connection
refused, authentication failed, statement-event metrics zero) all live
in the self-hosted guide - follow that for the YAML and the metric
definitions, and layer the deltas below on top.

### 1. Firewall rule for collector egress

Public-access Flexible Server rejects all client IPs except those
named in explicit firewall rules. Two rules are typical:

```bash title="firewall rules"
# Allow Azure-internal traffic (Azure VMs, Container Apps, AKS pods)
az mysql flexible-server firewall-rule create \
  --resource-group <rg> --name <server> \
  --rule-name AllowAllAzureServicesAndResourcesWithinAzureIps \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# Allow your operator / collector IP
az mysql flexible-server firewall-rule create \
  --resource-group <rg> --name <server> \
  --rule-name otel-collector \
  --start-ip-address <collector-egress-ip> \
  --end-ip-address <collector-egress-ip>
```

The `0.0.0.0` start + end pair is the special-cased Flexible Server
form that interprets the rule as "any Azure service in any
subscription"; laptop / on-prem collectors hit it via the per-IP rule.

### 2. Monitoring user grants

Repeated here from §Access setup because this is the single most
common in-database-scrape-on-Azure pitfall:

```sql title="monitoring user"
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<strong-password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

These three grants are exactly the self-hosted monitoring set. The
Azure delta is that the Flexible Server admin is **not** `SUPER`, so
do not attempt `GRANT ALL`, `WITH GRANT OPTION`, or `SUPER` - they
fail with `ERROR 1045` or `ERROR 1227`. Verify the result with
`SHOW GRANTS FOR 'otel_monitor'@'%';`.

### 3. `performance_schema` via Server Parameters

Azure Flexible Server has no `my.cnf`; `performance_schema` is a
Server Parameter:

```bash title="enable performance_schema"
az mysql flexible-server parameter set \
  --resource-group <rg> --server-name <server> \
  --name performance_schema --value ON
```

`performance_schema` is not hot-reloadable; setting this parameter
queues a server restart and the change applies on the next boot.
Sequence the work accordingly: apply it pre-flight (via Bicep
`configurations` or before the server carries production traffic) so
the server starts with `performance_schema` loaded rather than taking
a restart mid-run. This is the MySQL analogue of the PostgreSQL
`shared_preload_libraries` Server-Parameter load.

### 4. Statement-event consumers

`performance_schema = ON` alone does not guarantee the
`events_statements_*` consumers are enabled. On memory-constrained
Burstable tiers some consumers default off to save memory, and the
`mysqlreceiver` statement-event metrics then read zero. This is the
exact "Statement event metrics always zero" case documented in the
self-hosted guide - follow
[self-hosted MySQL troubleshooting](../../component/mysql.md) to
inspect `performance_schema.setup_consumers` and enable the
`events_statements_*` rows. Do not duplicate that procedure here; the
self-hosted guide is the single source for it.

### 5. Receiver config: TLS required

The receiver block from the self-hosted guide works unchanged with
the TLS bits flipped from the self-hosted defaults:

```yaml showLineNumbers title="mysqlreceiver delta for Azure Flex"
receivers:
  mysql:
    endpoint: "<server-name>.mysql.database.azure.com:3306"
    username: ${env:MYSQLFLEX_MONITORING_USER}
    password: ${env:MYSQLFLEX_MONITORING_PASSWORD}
    collection_interval: 10s
    allow_native_passwords: true
    tls:
      insecure: false                    # Flexible Server enforces TLS
      insecure_skip_verify: false        # default CA bundle trusts Microsoft Root CA
    metrics:
      # see self-hosted MySQL guide for the full metrics block
      ...
```

Azure Flexible Server's server certificate chains to the Microsoft
Root CA included in standard `ca-certificates` bundles. The
`otel/opentelemetry-collector-contrib:0.151.0` image's default trust
store accepts it without any custom `ca_file` configuration. Do not
set `insecure_skip_verify: true` - that would bypass the cert
verification you want on a public-internet connection. On Burstable
B1ms the server's `max_connections` ceiling is around 85; the
collector's single connection is well within that, but size
application connection pools with the monitoring connection in mind so
client traffic does not starve under load.

The receiver shares the rest of its pipeline (processors, exporters)
with whatever Scout-export pattern your collector already uses. See
the self-hosted guide for the rest of the YAML.

## Operations

### `performance_schema` requires a server restart

`performance_schema` is not hot-reloadable. Setting it via
`az mysql flexible-server parameter set` queues a server restart; the
change applies on the next boot. Application reconnect logic typically
tolerates the restart window, but apply this parameter pre-flight and
verify in staging before applying in production so you do not take an
unplanned restart during a live workload.

### Statement-event metrics read zero on Burstable

On Burstable tiers some `events_statements_*` consumers default off to
save memory. The `mysqlreceiver` statement-event metrics stay zero
until the consumers are enabled. Follow
[self-hosted MySQL troubleshooting](../../component/mysql.md) to
enable the `setup_consumers` rows. Above Burstable the consumers are
typically on by default.

### Burstable credit burn

On Burstable tiers, sustained CPU above the SKU's base rate drains a
CPU credit pool. When credits exhaust, the server throttles to base
rate. Whitelist `cpu_credits_remaining` and alert on it falling below
a SKU-specific safety floor so you can scale up before throttling
hits.

### `replication_lag` empty on a primary

`replication_lag` is a replica-only metric. A single-primary server
with no read replicas attached has zero series to emit. Treat an empty
series on a primary as expected; it populates once a read replica is
attached.

### `backup_storage_used` PT15M grain and first-backup lag

See the Operations footnote in the metrics table above. The metric
emits at a PT15M grain and does not populate until the first automated
backup completes, hours after a server is first created. Treat a
sparse or absent series as expected; use the Azure portal backup-quota
view for backup-storage alerting.

### Diagnostic Settings ship cadence

Resource-scope Diagnostic Settings first-batch ship lag on Flexible
Server may take longer than Azure's documented 5-15 minute window on
first attach. Steady-state batches arrive every few tens of seconds
after that. Budget at least 15 minutes before treating an empty Event
Hubs partition as a failure.

### RBAC propagation lag

`Monitoring Reader` on the resource group typically propagates in
under 30 seconds, occasionally up to 120 seconds. The first scrape
after a fresh role assignment may return `403 AuthorizationFailed`.
The receiver retries on the next 60s cycle; the noise clears within
two polls.

### Resource provider registration

The metrics path reads through the `Microsoft.DBforMySQL` resource
provider; the logs path creates a Diagnostic Setting routed to Event
Hubs. `Microsoft.DBforMySQL`, `Microsoft.EventHub`, and
`Microsoft.Insights` must all be `Registered` in the subscription. If a
provider is `NotRegistered`, metric scrapes return nothing or the
Diagnostic Setting creation fails. Registration is a one-time,
subscription-scoped action requiring a role with `*/register/action`
(Contributor or Owner):

```bash
az provider register --namespace Microsoft.DBforMySQL
az provider register --namespace Microsoft.EventHub
az provider register --namespace Microsoft.Insights
```

Confirm each with `az provider show --namespace <namespace> --query
registrationState -o tsv` (expect `Registered`).

## Key alerts to configure

Once metrics are flowing, set up alerts on these thresholds. The
"Why" column gives the reasoning so you can adjust thresholds for
your workload.

| Signal | Warning | Critical | Why |
| --- | --- | --- | --- |
| `cpu_percent` (5 min) | > 75% Average | > 90% Average | Saturation; on Burstable, sustained > base-rate burns credits. |
| `memory_percent` (5 min) | > 80% Average | > 90% Average | Buffer-pool pressure; risk of swap on Burstable. |
| `storage_percent` (10 min) | > 75% | > 90% | Pre-emptive scale-up; storage scaling is non-disruptive. |
| `io_consumption_percent` (5 min) | > 75% | > 90% | I/O saturation drives query latency tail. |
| `active_connections` vs `max_connections` (1 min) | > 75% | > 90% | Connection exhaustion is a hard failure mode. |
| `aborted_connections` rate (5 min) | > 1/min sustained | > 10/min sustained | Auth or firewall misconfiguration; or upstream client churn. |
| `Slow_queries` rate (5 min) | > 2x rolling 24h mean | > 5x rolling 24h mean | Slow-statement spike; pair with the slow-query log for per-statement attribution. |

Configure the Scout-side alert rules through your dashboarding /
alerting stack once thresholds are decided; the receiver pipeline
above emits the underlying signals continuously.

## Logs

Flexible Server publishes Diagnostic Settings categories that fill
gaps the metric whitelist cannot.

### What logs uniquely fill

Platform metrics aggregate. Logs disaggregate. The gaps logs uniquely
cover for Flexible Server:

- **Per-slow-statement attribution.** `Slow_queries` tells you the
  count of statements that crossed `long_query_time`; `MySqlSlowLogs`
  tells you **which** statements crossed it, in which database, with
  lock time, rows examined, and rows sent. No metric exposes the
  statement text or the per-statement cost.
- **Lock-wait detail on slow statements.** A slow statement blocked
  on a lock shows its lock time in the slow-log record, so you can
  separate "slow because the plan is bad" from "slow because it waited
  on a lock". The aggregate `Slow_queries` metric cannot make that
  distinction.
- **Rows-examined vs rows-sent skew.** The slow-log record carries
  both counts, which surfaces missing-index and full-scan patterns
  (high rows-examined, low rows-sent) that no aggregate metric
  exposes.
- **Connection, DDL, and DML provenance (optional).** The audit-log
  category records who connected, from where, and which `CREATE` /
  `ALTER` / `DROP` / `INSERT` / `UPDATE` / `DELETE` ran. Required for
  change-management forensics and unauthorised-change detection; off
  by default because of its volume.

### Architecture

```text
Flexible Server (Microsoft.DBforMySQL/flexibleServers)
     |
     | Diagnostic Setting (resource scope)
     | category: MySqlSlowLogs (default)
     v
Event Hubs namespace (Basic 1 TU)
     |   . diagsend SAS rule (Send) writes records
     |   . collectorlisten SAS rule (Listen) reads records
     v
azure_event_hub receiver
     |   . format: azure
     |   . apply_semantic_conventions: true
     |   . cloud.resource_id lifted from the per-record envelope
     v
otlp_http/b14 -> Scout
```

The Diagnostic Setting targets the **server** resource directly. The
receiver authenticates with the Listen SAS connection string, not a
namespace role assignment.

### Categories enabled by default

| Category | What it covers |
| --- | --- |
| `MySqlSlowLogs` | Slow-query log: statements exceeding `long_query_time`, with lock time, rows examined, and rows sent. The single highest-signal category for routine query debugging on Flexible Server. |

**Slow-query records depend on the threshold.** `MySqlSlowLogs`
records a statement only when it exceeds `long_query_time`. A workload
whose statements all run faster than the threshold produces an empty
slow log even though the Diagnostic Setting is attached and the
pipeline is healthy. Lower `long_query_time` to a value below the
slowest queries you want to capture, or confirm the path end-to-end
with a deliberate slow probe such as `SELECT SLEEP(2)` when
`long_query_time` is `1` second.

### Optional category

Named here so you know it exists; enable per workload:

- **`MySqlAuditLogs`** - connection / DDL / DML audit. It requires the
  `audit_log_enabled` and `audit_log_events` Server Parameters and
  adds substantial Diagnostic Settings volume. Enable it only when you
  have a forensic or compliance need and the volume budget for it;
  disable it when the investigation closes.

### Receiver configuration (logs)

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
receivers:
  azure_event_hub/mysqllogs:
    connection: ${env:MYSQLFLEXLOGS_CONNECTION_STRING}
    partition: ""           # resume across all partitions
    offset: ""              # resume from last checkpoint
    format: azure           # decode Azure resource-log envelope
    apply_semantic_conventions: true

processors:
  resource/mysqllogs:
    attributes:
      - {key: cloud.provider,              value: azure,                                       action: insert}
      - {key: cloud.platform,              value: azure_mysql_flexible_server,                 action: insert}
      - {key: cloud.account.id,            value: "${env:AZURE_SUBSCRIPTION_ID}",              action: insert}
      - {key: cloud.region,                value: "${env:MYSQLFLEXLOGS_SOURCE_REGION}",        action: insert}
      # cloud.resource_id is NOT pinned - the receiver lifts the per-record
      # Azure resource ID to this attribute automatically (UPPERCASED).
      - {key: deployment.environment.name, value: "${env:MYSQLFLEXLOGS_ENVIRONMENT}",          action: insert}
      - {key: service.name,                value: "${env:MYSQLFLEXLOGS_SERVICE_NAME}",         action: insert}

service:
  pipelines:
    logs/mysqllogs:
      receivers: [azure_event_hub/mysqllogs]
      processors: [memory_limiter, resource/mysqllogs, batch]
      exporters: [otlp_http/b14]
```

On a freshly started collector the `azure_event_hub` receiver spends
roughly 15 to 20 minutes establishing its Event Hubs consumer before
it delivers the first record downstream, even when records are already
in the hub. The Diagnostic Settings to Event Hubs leg itself is fast.
Budget 20 minutes before treating an empty logs pipeline as broken,
and do not restart the collector during that window - a restart
resets the warm-up clock and you start the 20 minutes again.

On collector restart after warm-up the receiver resumes from its last
checkpoint, so an idle window during deployment does not lose records
that arrived in the meantime (the hub retains 1 day on Basic).

The `MYSQLFLEXLOGS_CONNECTION_STRING` value is the Listen-permission
SAS connection string for the namespace, **with
`;EntityPath=<hub-name>` appended** so the receiver knows which hub to
consume from. Fetch it once via:

```bash title="fetch the Listen connection string"
az rest --method post \
  --url "https://management.azure.com${COLLECTOR_LISTEN_RULE_ID}/listKeys?api-version=2024-01-01" \
  --query primaryConnectionString -o tsv
```

Then append `;EntityPath=<hub-name>` and store the result in your
collector's env file. The connection string carries `;` separators, so
single-quote it in the env file (`VAR='...'`) - an unquoted value is
truncated at the first `;` when the env file is sourced.

### Environment variables (logs)

```bash title=".env (logs path)"
MYSQLFLEXLOGS_CONNECTION_STRING='...'      # Listen SAS with ;EntityPath=<hub>, single-quoted
MYSQLFLEXLOGS_SOURCE_REGION=...            # for cloud.region on log records
MYSQLFLEXLOGS_SERVICE_NAME=mysqlflex-logs
MYSQLFLEXLOGS_ENVIRONMENT=production
```

### Wiring the Diagnostic Setting

```bash title="attach the Diagnostic Setting"
az monitor diagnostic-settings create \
  --resource "<server-resource-id>" \
  --name mysqlflex-logs \
  --event-hub <hub-name> \
  --event-hub-rule "<diagsend-rule-id>" \
  --logs '[{"category":"MySqlSlowLogs","enabled":true}]'
```

The `--event-hub-rule` value is the resource ID of the
namespace-scoped SAS rule with `Send` permission. The receiver uses a
separate Listen rule; one Send rule and one Listen rule on the
namespace is the canonical two-rule topology, and the Listen rule
replaces a namespace role assignment for the receiver.

### Server Parameter prerequisites for log content

The Diagnostic Settings path routes whatever the server writes to its
slow log. To populate `MySqlSlowLogs` with useful content, set these
Server Parameters:

```bash
az mysql flexible-server parameter set --resource-group <rg> --server-name <server> --name slow_query_log       --value ON
az mysql flexible-server parameter set --resource-group <rg> --server-name <server> --name long_query_time      --value 1
az mysql flexible-server parameter set --resource-group <rg> --server-name <server> --name log_output           --value FILE
```

Tune `long_query_time` to your slow-query threshold. A low-latency
workload may stay under the default and produce an empty slow log;
either lower the threshold or drive a deliberate `SELECT SLEEP(2)`
probe to confirm the path before relying on it.

### Verifying the logs path

After the Diagnostic Setting is attached and the server has executed
at least one statement slower than `long_query_time`:

1. Wait for the receiver warm-up window (up to ~20 minutes on a fresh
   collector) plus the resource-scope Diagnostic Settings first-batch
   lag. Do not restart the collector during the warm-up.
2. Tail the collector debug exporter: `docker compose logs -f
   otel-collector | grep "otelcol.signal.*logs"`.
3. Expect slow-log records to arrive in small batches once the
   workload produces statements over the threshold.
4. In Scout, filter `service.name = 'mysqlflex-logs'` and
   `cloud.platform = 'azure_mysql_flexible_server'`; group by
   `azure.category` to confirm `MySqlSlowLogs` populates.

## Troubleshooting

### In-database receiver: authentication failed or grant error

**Cause:** The monitoring user is missing one of the three required
grants, or someone attempted `GRANT ALL` / `SUPER` (which the
non-`SUPER` Flexible Server admin cannot issue). **Fix:** Re-run the
three-grant block from §Access setup and verify with
`SHOW GRANTS FOR 'otel_monitor'@'%';`. Do not widen beyond `PROCESS`,
`REPLICATION CLIENT`, and `SELECT ON performance_schema.*`.

### In-database receiver: statement-event metrics always zero

**Cause:** `performance_schema` is off, or the
`events_statements_*` consumers are off (common on Burstable tiers).
**Fix:** Confirm `performance_schema = ON` via the Server Parameter,
then follow the
[self-hosted MySQL "Statement event metrics always zero"
troubleshooting](../../component/mysql.md) to enable the
`setup_consumers` rows. Note the `performance_schema` Server Parameter
change triggers a server restart, so apply it pre-flight.

### Platform-metrics `AuthorizationFailed` on the first scrape

**Cause:** The `Monitoring Reader` role assignment on the resource
group has not yet propagated. **Fix:** Wait two polling cycles (~2
minutes). The receiver retries automatically; the error self-clears.

### `connection refused` from the in-database receiver

**Cause:** The collector's egress IP is not in the Flexible Server's
firewall allowlist. **Fix:** Add the IP via
`az mysql flexible-server firewall-rule create`. If the collector runs
in Azure (VM, AKS), add the `0.0.0.0` Azure-services rule instead.

### Metric `replication_lag` shows no data

**Cause:** Expected behaviour - `replication_lag` is replica-only and
the server has no read replica attached. **Fix:** None needed on a
primary. The series populates when a read replica is attached.

### Metric `backup_storage_used` shows `no recent data` in Scout

**Cause:** Expected behaviour - PT15M grain at a 60s receiver
interval, and the series does not populate until the first automated
backup completes (hours after a server is first created). **Fix:** See
Operations -> `backup_storage_used` PT15M grain and first-backup lag.

### First Event Hubs batch is empty after 20 minutes

**Cause:** Either the `azure_event_hub` receiver is still in its
consumer warm-up window, or the server has not yet produced a slow
statement in the enabled category. **Fix:** Confirm the warm-up window
has fully elapsed without a collector restart, then drive a slow
statement (`mysql -h <server> -u <admin> -p -e 'SELECT SLEEP(2)'`) so
`MySqlSlowLogs` has a record to ship.

### `azure_event_hub` receiver logs `MessagingGatewayBadRequest`

**Cause:** The receiver is requesting a user-defined consumer group
that does not exist on Event Hubs Basic. **Fix:** Basic tier rejects
user-defined consumer groups - the receiver must consume from
`$Default`, the implicit group. Remove any `consumer_group:` key from
the receiver config or upgrade the namespace to Standard if you need
multiple consumer groups.

### `MySqlSlowLogs` records never arrive

**Cause:** `long_query_time` is higher than your typical query
latency, so no statement crosses the slow threshold. **Fix:** Drop
`long_query_time` to a value below the slowest queries you want to
capture, or run a deliberate `SELECT SLEEP(2)` probe to confirm the
path end-to-end.

## Frequently Asked Questions

### How do I monitor Azure MySQL Flexible Server with OpenTelemetry?

Three instrumentation paths complement each other. Platform metrics
use `azure_monitor` against `Microsoft.DBforMySQL/flexibleServers` for
resource saturation, connection counts, and network throughput. The
in-database scrape uses the OpenTelemetry `mysqlreceiver` against the
server's public FQDN over TLS for `performance_schema` depth:
statement events, table I/O, lock waits, and per-query counters.
Resource logs use `azure_event_hub` consuming the Diagnostic Settings
category `MySqlSlowLogs` for per-slow-statement detail. Pick paths
based on how deep the debug-attribution needs to go.

### Why can't my monitoring user read performance_schema on Azure MySQL?

The Azure Database for MySQL Flexible Server admin is not a `SUPER`
user, so `GRANT ALL` and `WITH GRANT OPTION` fail. The monitoring user
needs exactly three global grants the admin can issue:
`GRANT PROCESS, REPLICATION CLIENT ON *.*` and
`GRANT SELECT ON performance_schema.*`. With those three grants the
`mysqlreceiver` reads global status, replica status, and the
`performance_schema` tables it scrapes. Anything broader than these
three will fail with `ERROR 1045` or `ERROR 1227`.

### How do I enable performance_schema on Azure MySQL Flexible Server?

`performance_schema` is enabled through a Server Parameter, not
`my.cnf`. Set it with `az mysql flexible-server parameter set --name
performance_schema --value ON`. This parameter requires a server
restart, so apply it pre-flight (via Bicep `configurations` or before
the server carries production traffic) and let the server boot with it
loaded. `performance_schema` ON alone does not guarantee the
`events_statements_*` consumers are enabled, especially on
memory-constrained Burstable tiers; if statement-event metrics read
zero, follow the self-hosted MySQL statement-event troubleshooting to
enable the `setup_consumers` rows.

### Is backup_storage_used safe to alert on at a 60-second collection interval?

No. `backup_storage_used` emits at a PT15M native grain on Azure
Monitor and does not populate until the first automated backup
completes, which is hours after a server is first created. A receiver
polling at 60 seconds will report `no recent data` for most cycles,
and a freshly created server reports nothing at all until its first
backup. Treat a sparse or absent series as expected behaviour rather
than a pipeline failure, and rely on the Azure portal backup-quota
view for backup-storage alerting.

### Why is replication_lag empty on my Azure MySQL Flexible Server?

`replication_lag` is a replica-only metric. On a single-primary server
with no read replicas attached there are zero series to emit, so the
metric stays empty. This is expected behaviour, not a broken
whitelist. The series populates once a read replica is attached to the
server.

### Why are MySqlSlowLogs records empty under my workload?

`MySqlSlowLogs` records a statement only when its execution time
exceeds `long_query_time`. A workload whose statements all run faster
than the threshold produces an empty slow log even though the
Diagnostic Setting is attached and the pipeline is healthy. Lower
`long_query_time` to a value below the slowest queries you want to
capture, or confirm the path end-to-end with a deliberate slow probe
such as `SELECT SLEEP(2)` when `long_query_time` is `1` second.

## Related Guides

### Same surface, different paths

- [Self-hosted MySQL](../../component/mysql.md) - the `mysqlreceiver`
  reference for the in-database scrape. This guide layers
  Azure-specific deltas (firewall, three-grant monitoring user,
  `performance_schema` via Server Parameters, TLS-required) on it, and
  cross-links its statement-event troubleshooting rather than
  duplicating it.

### Shared collector + Scout wiring

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  the runtime that hosts both receivers in this guide.
- [Kubernetes / Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  alternative runtime for AKS-hosted collectors.
- [Scout exporter wiring](../../collector-setup/scout-exporter.md) - the
  `oauth2client` extension + `otlp_http/b14` exporter block shared by
  all Azure guides.

### Apps-side instrumentation

- [Spring Boot](../../apps/auto-instrumentation/spring-boot.md) - JVM
  apps connecting to Flexible Server over JDBC.
- [Symfony](../../apps/auto-instrumentation/symfony.md) - PHP apps
  connecting to Flexible Server over PDO / Doctrine.

### Adjacent Azure surfaces

- [Azure Database for PostgreSQL](./database-for-postgresql.md) -
  managed Postgres on Azure; the typical alternative when the workload
  needs Postgres rather than MySQL.
- [Azure App Service](./app-service.md) - common host for web apps
  that connect to Flexible Server.
- [Azure Cache for Redis](./cache-for-redis.md) - caching layer
  typically sat in front of MySQL.
- [Azure Key Vault](./key-vault.md) - secrets store for the monitoring
  user's password.
- [Azure SQL Database](./sql-database.md) - managed SQL Server on
  Azure; the alternative when the workload needs T-SQL.
