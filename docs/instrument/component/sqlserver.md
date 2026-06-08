---
title: >
  SQL Server OpenTelemetry Monitoring - Batch Throughput, Locks,
  and Buffer Cache Metrics
sidebar_label: SQL Server
id: collecting-sqlserver-telemetry
description: >
  Monitor Microsoft SQL Server with OpenTelemetry: batch request rate, lock
  waits, page life expectancy, and buffer cache hit ratio, shipped to base14
  Scout.
keywords:
  - sql server opentelemetry
  - sql server otel collector
  - sql server metrics monitoring
  - sql server performance monitoring
  - opentelemetry sqlserver receiver
  - sql server observability
  - monitor sql server kubernetes
  - sql server telemetry collection
sidebar_position: 44
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does SQL Server OpenTelemetry monitoring work in Kubernetes?","acceptedAnswer":{"@type":"Answer","text":"Yes. Set the receiver server to the SQL Server service DNS (e.g., sqlserver.default.svc.cluster.local) on port 1433 and inject the monitoring credentials via a Kubernetes secret. The OpenTelemetry Collector can run as a sidecar or a Deployment."}},{"@type":"Question","name":"What permissions does the SQL Server monitoring login need?","acceptedAnswer":{"@type":"Answer","text":"On SQL Server 2022 and later: VIEW SERVER PERFORMANCE STATE plus VIEW ANY DATABASE. On SQL Server 2017-2019: VIEW SERVER STATE plus VIEW ANY DATABASE. No write permissions are needed."}},{"@type":"Question","name":"How do I monitor multiple SQL Server instances with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add multiple sqlserver receiver blocks with distinct names (e.g., sqlserver/primary and sqlserver/replica) in the OpenTelemetry Collector config, then include both in the metrics pipeline."}},{"@type":"Question","name":"Why are some default SQL Server metrics missing on a Linux container?","acceptedAnswer":{"@type":"Answer","text":"13 of the sqlserverreceiver default metrics read Windows performance counters and emit nothing on a Linux container by design. On Linux you get the DMV-backed set; running the collector against a Windows SQL Server host adds the Windows-only perfcounter metrics."}},{"@type":"Question","name":"Does this work with Azure SQL Database or Azure SQL Managed Instance?","acceptedAnswer":{"@type":"Answer","text":"This guide targets self-hosted SQL Server. Azure SQL Database and Azure SQL Managed Instance expose metrics through Azure Monitor, which the azuremonitorreceiver collects instead. See the Azure SQL Database guide for the managed path."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# SQL Server

The OpenTelemetry Collector's `sqlserverreceiver` connects to Microsoft
SQL Server 2017+ over TDS and collects 34 metrics on Linux, including
batch request rate, buffer cache hit ratio, page life expectancy, deadlock
rate, lock waits, blocked processes, and tempdb space. It reads the server's
dynamic management views (DMVs) through a least-privilege monitoring login,
so no agent or exporter sits on the database host. This guide creates that
login, configures the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| SQL Server             | 2017    | 2022+       |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- SQL Server must be reachable on TCP 1433 from the host running the
  Collector.
- A login with permission to create logins (typically `sa` or another
  sysadmin) is needed once, to bootstrap the read-only monitoring login.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

The `sqlserverreceiver` has two collection paths: the DMV path runs on any
platform, and a Windows performance-counter path adds extra metrics only on
Windows hosts. 13 of the receiver's default metrics come from Windows
perfcounters and emit nothing on a Linux container by design. The tiers
below reflect the DMV-backed set available everywhere; a Windows host adds
page-checkpoint and transaction-log perfcounter rates on top.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `sqlserver.user.connection.count` | Users connected to the server - reachability and connection load. |
| `sqlserver.batch.request.rate` | Batch requests per second - the headline workload throughput. |
| `sqlserver.page.life_expectancy` | Seconds a page stays in the buffer pool; a first-order memory-health signal. |
| `sqlserver.page.buffer_cache.hit_ratio` | Pages served from the buffer pool without a disk read - working-set health. |

For SQL Server, buffer-pool health is a first-order indicator of server
health, so the two memory-health signals sit alongside throughput in Core.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `sqlserver.database.execution.errors` | Execution errors - failing queries or app errors. |
| `sqlserver.deadlock.rate` | Deadlocks detected; lock-ordering contention. |
| `sqlserver.processes.blocked` | Processes currently blocked - head-of-line blocking. |
| `sqlserver.lock.wait.rate` | Lock requests that resulted in a wait; growing contention. |
| `sqlserver.lock.timeout.rate` | Lock timeouts - sessions abandoning lock requests. |
| `sqlserver.memory.grants.pending.count` | Queries waiting for a memory grant; memory-grant pressure. |
| `sqlserver.transaction.delay` | Time consumed in transaction delays - commit / HADR latency. |
| `sqlserver.batch.sql_recompilation.rate` | SQL recompilations - plan-cache churn. |
| `sqlserver.database.tempdb.space` | Free space in tempdb; fill risks a server-wide outage. |
| `sqlserver.database.full_scan.rate` | Unrestricted full table/index scans - a missing-index signal. |

### Diagnostic - for investigation and tuning

Higher cardinality or static inventory; enable on demand. In production you
can drop this tier with a `filter` processor and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Lock and wait detail | `sqlserver.lock.wait.count`, `sqlserver.os.wait.duration` (per wait type) | Attribute contention to a wait type during an incident. |
| Compilation / index internals | `sqlserver.batch.sql_compilation.rate`, `sqlserver.index.search.rate`, `sqlserver.page.lookup.rate` | Context for recompilation storms and scan-heavy plans. |
| Buffer-pool detail | `sqlserver.page.buffer_cache.free_list.stalls.rate` | Confirm buffer-pool pressure behind a falling hit ratio. |
| TempDB internals | `sqlserver.database.tempdb.version_store.size` | Long-running transactions bloating the version store. |
| Activity rates | `sqlserver.database.backup_or_restore.rate`, `sqlserver.login.rate`, `sqlserver.logout.rate` | Backup windows and connection churn. |
| Inventory and host | `sqlserver.memory.usage`, `sqlserver.computer.uptime`, `sqlserver.cpu.count`, `sqlserver.database.count`, `sqlserver.table.count` | Restart detection and static capacity context. |
| HADR / mirroring / Resource Governor | `sqlserver.replica.data.rate`, `sqlserver.transaction.mirror_write.rate`, `sqlserver.resource_pool.disk.operations`, `sqlserver.resource_pool.disk.throttled.read.rate`, `sqlserver.resource_pool.disk.throttled.write.rate` | Only carry signal when availability groups, mirroring, or Resource Governor are configured. |

The per-database file-IO metrics - `sqlserver.database.io`,
`sqlserver.database.latency`, and `sqlserver.database.operations` - are
worth enabling but stay silent until the underlying per-database file stats
are populated by activity. Leave them enabled so file-level read/write
bytes, latency, and operations surface once a database sees load.

Full receiver reference:
[OTel SQL Server Receiver][sqlserver-receiver-readme].

[sqlserver-receiver-readme]: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/sqlserverreceiver

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload.

| Metric | Threshold | Why it matters |
|---|---|---|
| `rate(sqlserver.database.execution.errors)` | > 0 sustained | Failing queries or app errors; inspect the SQL error log. |
| `rate(sqlserver.deadlock.rate)` | > 0 sustained | Lock-ordering contention; review transaction patterns. |
| `sqlserver.processes.blocked` | > 0 sustained | A head blocker is stalling sessions; find and resolve the blocking chain. |
| `rate(sqlserver.lock.wait.rate)` | Climbing vs baseline | Growing contention; review hot tables and transaction scope. |
| `rate(sqlserver.lock.timeout.rate)` | > 0 rising | Sessions abandoning lock requests; investigate blocking. |
| `sqlserver.page.life_expectancy` | Dropping vs baseline (RAM-dependent) | Buffer-pool memory pressure; check memory grants and workload. |
| `sqlserver.page.buffer_cache.hit_ratio` | Falling vs baseline | Working set exceeds the buffer pool; add memory or tune queries. |
| `sqlserver.memory.grants.pending.count` | > 0 sustained | Queries starved for memory grants; reduce concurrency or query memory. |
| `rate(sqlserver.transaction.delay)` | Rising vs baseline | Commit latency or HADR sync pressure; check IO and replica health. |
| `rate(sqlserver.batch.sql_recompilation.rate)` | High relative to `batch.request.rate` | Plan-cache churn; review parameterization and schema changes. |
| `sqlserver.database.tempdb.space` (free) | Trending toward 0 | TempDB exhaustion risks a server-wide outage; add tempdb files or space. |
| `rate(sqlserver.database.full_scan.rate)` | Climbing vs baseline | Missing index or plan regression; review query plans. |

Page life expectancy has no universal absolute - it scales with the RAM
allocated to the buffer pool - so alert on a drop relative to the instance's
own baseline rather than a fixed number.

## Access Setup

Create a read-only login the collector connects as. The grants differ
between SQL Server 2022+ (which introduced the more granular
`VIEW SERVER PERFORMANCE STATE`) and earlier versions.

### SQL Server 2022 and later

```sql showLineNumbers title="bootstrap.sql"
USE [master];
GO

CREATE LOGIN [otel_monitor] WITH PASSWORD = N'<strong-password>',
    CHECK_POLICY = ON;
GO

GRANT VIEW SERVER PERFORMANCE STATE TO [otel_monitor];
GRANT VIEW ANY DATABASE TO [otel_monitor];
GO
```

### SQL Server 2017 - 2019

```sql showLineNumbers title="bootstrap-legacy.sql"
USE [master];
GO

CREATE LOGIN [otel_monitor] WITH PASSWORD = N'<strong-password>',
    CHECK_POLICY = ON;
GO

GRANT VIEW SERVER STATE TO [otel_monitor];
GRANT VIEW ANY DATABASE TO [otel_monitor];
GO
```

`VIEW SERVER PERFORMANCE STATE` (or `VIEW SERVER STATE` on older versions)
gives the receiver access to the dynamic management views it queries,
including the per-database file IO and latency stats. `VIEW ANY DATABASE`
lets it enumerate the databases to scrape; the receiver also accepts
`CREATE DATABASE` or `ALTER ANY DATABASE` in its place. No write permissions
are needed.

Test the credentials before configuring the collector:

```bash showLineNumbers title="Verify access"
sqlcmd -S <sqlserver-host>,1433 -U otel_monitor -P '<strong-password>' \
  -C -Q "SELECT @@VERSION;"
```

The `-C` flag trusts the server certificate. SQL Server enables encryption
by default; production deployments should ship a real certificate the
collector can validate against.

## Configuration

The receiver enables 30 optional metrics on top of its DMV-backed defaults.
None of the 30 are Windows-only, though three per-database file-IO metrics
among them stay silent until a database sees activity. The 13 Windows-only
default metrics need no toggle and silently skip on Linux.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  sqlserver:
    collection_interval: 10s
    username: ${env:SQLSERVER_USER}
    password: ${env:SQLSERVER_PASSWORD}
    server: <sqlserver-host>   # Change to your SQL Server address
    port: 1433

    metrics:
      sqlserver.computer.uptime:
        enabled: true
      sqlserver.cpu.count:
        enabled: true
      sqlserver.database.backup_or_restore.rate:
        enabled: true
      sqlserver.database.count:
        enabled: true
      sqlserver.database.execution.errors:
        enabled: true
      sqlserver.database.full_scan.rate:
        enabled: true
      sqlserver.database.io:
        enabled: true
      sqlserver.database.latency:
        enabled: true
      sqlserver.database.operations:
        enabled: true
      sqlserver.database.tempdb.space:
        enabled: true
      sqlserver.database.tempdb.version_store.size:
        enabled: true
      sqlserver.deadlock.rate:
        enabled: true
      sqlserver.index.search.rate:
        enabled: true
      sqlserver.lock.timeout.rate:
        enabled: true
      sqlserver.lock.wait.count:
        enabled: true
      sqlserver.login.rate:
        enabled: true
      sqlserver.logout.rate:
        enabled: true
      sqlserver.memory.grants.pending.count:
        enabled: true
      sqlserver.memory.usage:
        enabled: true
      sqlserver.os.wait.duration:
        enabled: true
      sqlserver.page.buffer_cache.free_list.stalls.rate:
        enabled: true
      sqlserver.page.lookup.rate:
        enabled: true
      sqlserver.processes.blocked:
        enabled: true
      sqlserver.replica.data.rate:
        enabled: true
      sqlserver.resource_pool.disk.operations:
        enabled: true
      sqlserver.resource_pool.disk.throttled.read.rate:
        enabled: true
      sqlserver.resource_pool.disk.throttled.write.rate:
        enabled: true
      sqlserver.table.count:
        enabled: true
      sqlserver.transaction.delay:
        enabled: true
      sqlserver.transaction.mirror_write.rate:
        enabled: true

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [sqlserver]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic-tier metrics
with a `filter` processor while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
SQLSERVER_USER=otel_monitor
SQLSERVER_PASSWORD=<strong-password>
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Confirm the monitoring login resolves from where the collector runs:

```bash showLineNumbers
sqlcmd -S <sqlserver-host>,1433 -U otel_monitor -P "$SQLSERVER_PASSWORD" \
  -C -Q "SELECT name FROM sys.server_principals WHERE name = N'otel_monitor';"
```

Then start the collector and confirm metrics appear within 30 seconds:

```bash showLineNumbers
docker logs otel-collector 2>&1 | grep -oE "Name: sqlserver\.[a-z_.]+" \
  | sort -u | wc -l
```

Expect 30+ unique metric names on Linux. A few per-database metrics like
`sqlserver.database.io` only appear once a database sees activity, so drive
some queries against the server if those rows are missing.

## Troubleshooting

### Connection refused or timeout

**Cause**: The collector cannot reach SQL Server at the configured endpoint,
or SQL Server is still warming up.

**Fix**:

1. Verify SQL Server is listening on TCP: `ss -tlnp | grep 1433` on the host.
2. SQL Server containers on Apple Silicon run under x86 emulation, so the
   first cold start takes 30-60 seconds. Use a healthcheck that tolerates
   this and gate the collector on `depends_on.condition: service_healthy`.
3. Confirm SQL Server's TCP/IP protocol is enabled - it is by default in
   containers, but disabled on a fresh Windows install.

### Login failed for user 'otel_monitor'

**Cause**: Password mismatch, missing grants, or `CHECK_POLICY = ON`
rejected the password.

**Fix**:

1. Test credentials directly from a shell that can reach the instance:
   `sqlcmd -S <host>,1433 -U otel_monitor -P '<password>' -C`.
2. Re-run the bootstrap SQL; wrap `CREATE LOGIN` in an `IF NOT EXISTS` check
   to make it idempotent.
3. Confirm the grants landed:
   `SELECT * FROM sys.server_permissions` filtered on the login's principal.

### Contention is rising but the cause is unclear

**Cause**: Lock waits, blocking, or deadlocks are climbing and you need to
attribute them to a wait type or a blocking chain.

**Look at**: the Diagnostic `sqlserver.os.wait.duration` series (per wait
type) to see where time is going, and `sqlserver.lock.wait.count` for
cumulative lock-wait volume. Pair these with the Operational
`sqlserver.processes.blocked` and `sqlserver.deadlock.rate`.

**Fix**:

1. If a single wait type dominates, target it - `PAGEIOLATCH_*` points at
   storage, `LCK_*` at lock contention, `RESOURCE_SEMAPHORE` at memory grants.
2. If `processes.blocked` is non-zero, find the head blocker and resolve the
   blocking chain.

### Falling page life expectancy or buffer cache hit ratio

**Cause**: The working set exceeds the buffer pool, so pages are evicted and
re-read from disk.

**Look at**: the Diagnostic
`sqlserver.page.buffer_cache.free_list.stalls.rate` - a non-zero free-list
stall rate confirms buffer-pool pressure behind the falling Core ratios.
Cross-check `sqlserver.memory.grants.pending.count`.

**Fix**:

1. Add memory to the instance or raise `max server memory` if it is capped
   below available RAM.
2. Tune the heaviest queries to read fewer pages, and review
   `sqlserver.database.full_scan.rate` for missing indexes.

### Many default metrics are not appearing

**Cause**: The `sqlserverreceiver` has two collection paths. The DMV path
runs everywhere; the performance-counter path is Windows-only.

**Fix**:

1. On Linux containers and managed Linux SQL Server, only DMV-backed metrics
   emit. The 13 Windows-perfcounter defaults skip silently by design.
2. To get the full set, run the collector on a Windows host alongside a
   Windows SQL Server instance, with `computer_name` and `instance_name`
   set per the receiver README.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported, or exported with bad auth.

**Fix**:

1. Add a `debug` exporter to the metrics pipeline temporarily and confirm
   metrics print to the collector's stdout - this isolates the receiver from
   the exporter.
2. Check the collector logs for `Exporting failed` errors with HTTP 401 or
   403, which point at the credentials for `otlphttp/b14`.
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.

## FAQ

**Does this work with SQL Server running in Kubernetes?**

Yes. Set the receiver `server` to the SQL Server service DNS
(e.g., `sqlserver.default.svc.cluster.local`) on port 1433 and inject the
monitoring credentials via a Kubernetes secret. The Collector can run as a
sidecar or a Deployment.

**What permissions does the monitoring login need?**

On SQL Server 2022+: `VIEW SERVER PERFORMANCE STATE` plus
`VIEW ANY DATABASE`. On SQL Server 2017-2019: `VIEW SERVER STATE` plus
`VIEW ANY DATABASE`. No write permissions are required.

**How do I monitor multiple SQL Server instances?**

Add multiple receiver blocks with distinct names, then include both in the
pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  sqlserver/primary:
    server: primary
    port: 1433
    username: ${env:SQLSERVER_USER}
    password: ${env:SQLSERVER_PASSWORD}
  sqlserver/replica:
    server: replica
    port: 1433
    username: ${env:SQLSERVER_USER}
    password: ${env:SQLSERVER_PASSWORD}

service:
  pipelines:
    metrics:
      receivers: [sqlserver/primary, sqlserver/replica]
```

**Why is a default metric like `sqlserver.transaction_log.usage` missing?**

It is one of the 13 Windows-perfcounter metrics the receiver silently skips
on Linux. On a Linux instance you can capture log usage indirectly with the
`sqlquery` receiver, or run the collector on a Windows host for the full set.

**Does this work with Azure SQL Database or Azure SQL Managed Instance?**

This guide targets self-hosted SQL Server. Azure SQL Database and Azure SQL
Managed Instance expose metrics through Azure Monitor; collect them with the
`azuremonitorreceiver` instead. See the
[Azure SQL Database guide](../infra/azure/sql-database.md) for the managed
path.

## Related Guides

- [Azure SQL Database](../infra/azure/sql-database.md) - The managed PaaS
  (Azure SQL Database / Managed Instance), collected via the `azure_monitor`
  receiver instead of `sqlserverreceiver`.
- [PostgreSQL Monitoring](./postgres.md) - Adjacent relational database.
- [MySQL Monitoring](./mysql.md) - Adjacent relational database.
- [.NET Aspire](../apps/auto-instrumentation/dotnet-aspire.md) - App-side
  .NET telemetry to pair with the database metrics.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on SQL Server metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MySQL](./mysql.md), and
  [Redis](./redis.md).
- **Instrument the App**: Pair the database telemetry with application
  traces from
  [.NET Aspire](../apps/auto-instrumentation/dotnet-aspire.md) for
  end-to-end visibility.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
