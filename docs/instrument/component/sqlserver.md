---
title: >
  SQL Server OpenTelemetry Monitoring - Connections, Locks, and
  Buffer Cache Metrics
sidebar_label: SQL Server
id: collecting-sqlserver-telemetry
description: >
  Collect Microsoft SQL Server metrics with the OpenTelemetry
  Collector. Monitor batch request rate, lock waits, page life
  expectancy, deadlocks, and per-database I/O using the
  sqlserverreceiver and export to base14 Scout.
keywords:
  - sql server opentelemetry
  - sql server otel collector
  - sql server metrics monitoring
  - sql server performance monitoring
  - opentelemetry sqlserver receiver
  - mssql observability
  - sql server kubernetes monitoring
  - sql server telemetry collection
sidebar_position: 44
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does SQL Server OpenTelemetry monitoring work in Kubernetes?","acceptedAnswer":{"@type":"Answer","text":"Yes. Set the endpoint to the SQL Server service DNS (e.g., sqlserver.default.svc.cluster.local:1433) and inject credentials via a Kubernetes secret. The OpenTelemetry Collector can run as a sidecar or DaemonSet."}},{"@type":"Question","name":"How do I monitor multiple SQL Server instances with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add multiple sqlserver receiver blocks with distinct names (e.g., sqlserver/primary and sqlserver/replica) in the OpenTelemetry Collector config, then include both in the metrics pipeline."}},{"@type":"Question","name":"What permissions does the SQL Server monitoring user need?","acceptedAnswer":{"@type":"Answer","text":"For SQL Server 2022 and later: VIEW SERVER PERFORMANCE STATE plus VIEW ANY DATABASE. For SQL Server 2017-2019: VIEW SERVER STATE plus VIEW ANY DATABASE. No write permissions are needed."}},{"@type":"Question","name":"What SQL Server metrics does the OpenTelemetry Collector capture on Linux containers?","acceptedAnswer":{"@type":"Answer","text":"The sqlserverreceiver collects 37 metrics on Linux containers, including batch request rate, buffer cache hit ratio, page life expectancy, deadlock rate, lock waits, per-database I/O and latency, and connection counts. Windows hosts add 13 more metrics that come from Windows performance counters."}},{"@type":"Question","name":"Does this work with Azure SQL Database or Azure SQL Managed Instance?","acceptedAnswer":{"@type":"Answer","text":"This guide targets self-hosted SQL Server. Azure SQL Database and Azure SQL Managed Instance expose metrics via Azure Monitor, which is collected with the azuremonitorreceiver instead. See the Azure SQL Database guide for those platforms."}}]}
---

# SQL Server

The OpenTelemetry Collector's `sqlserverreceiver` collects 50 metrics
from Microsoft SQL Server 2017+, including batch request rate, lock
waits, page life expectancy, buffer cache hit ratio, deadlock rate,
and per-database I/O and latency. This guide configures the receiver,
sets up a read-only monitoring login, and ships metrics to base14
Scout.

> **Platform note**: 13 of the receiver's 20 default-enabled metrics
> use Windows performance counters and are silently skipped on Linux
> containers. On Linux, you get 37 metrics (7 default + 30 optional);
> on Windows hosts, all 50. The "What You'll Monitor" table below
> reflects the Linux set; Windows adds page-checkpoint and
> transaction-log perfcounter rates.

## Prerequisites

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| SQL Server | 2017 | 2022+ |
| OTel Collector Contrib | 0.90.0 | 0.151.0+ |
| base14 Scout | Any | - |

Before starting:

- SQL Server must be reachable from the host running the Collector
- A SQL login with permission to create logins (typically `sa` or a
  sysadmin) is needed to bootstrap the read-only monitoring user
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Throughput**: batch request rate, SQL compilations and
  recompilations per second
- **Locks & deadlocks**: lock wait rate, lock wait count, lock
  timeouts, deadlock rate, blocked process count
- **Buffer cache & memory**: buffer cache hit ratio, free-list stalls,
  page life expectancy, page lookup rate, memory usage, pending
  memory grants
- **Per-database I/O**: read/write I/O bytes, latency, operations
  count, full table scans, execution errors, tempdb space and version
  store size
- **Connections & sessions**: active user connections, login rate,
  logout rate
- **Host & resource**: computer uptime, CPU count, OS wait duration
  by wait type, table count, database count, resource pool throttling

Full receiver reference:
[OTel SQL Server Receiver][sqlserver-receiver-readme].

The runnable example with a SQL Server 2022 container, monitoring
user bootstrap, and the collector configured to forward to Scout
lives at [base14/examples -
components/sqlserver-telemetry][sqlserver-example]. The config below
works unchanged against that example.

[sqlserver-receiver-readme]: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/sqlserverreceiver
[sqlserver-example]: https://github.com/base-14/examples/tree/main/components/sqlserver-telemetry

## Access Setup

Create a read-only login the collector will connect as. The grants
differ between SQL Server 2022+ (which introduced the more granular
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

`VIEW SERVER PERFORMANCE STATE` (or `VIEW SERVER STATE` on older
versions) gives the receiver access to the dynamic management views
(DMVs) it queries. `VIEW ANY DATABASE` is required for the optional
per-database I/O and latency metrics. No write permissions are
needed.

Test the credentials before configuring the collector:

```bash showLineNumbers
sqlcmd -S <sqlserver-host>,1433 -U otel_monitor -P '<strong-password>' \
  -C -Q "SELECT @@VERSION;"
```

The `-C` flag trusts the server certificate (SQL Server enables
encryption by default; production deployments should ship a real
certificate the collector can validate against).

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  sqlserver:
    collection_interval: 10s
    username: ${env:SQLSERVER_USER}
    password: ${env:SQLSERVER_PASSWORD}
    server: <sqlserver-host>
    port: 1433

    # The 30 optional metrics below are all Linux-supported. Default-
    # enabled metrics need no explicit toggle - 13 of those are
    # Windows-only and silently skip on Linux.
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
      - key: deployment.environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [sqlserver]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
SQLSERVER_USER=otel_monitor
SQLSERVER_PASSWORD=<strong-password>
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Test the monitoring login from inside the collector container's
network:

```bash showLineNumbers
sqlcmd -S <sqlserver-host>,1433 -U otel_monitor -P "$SQLSERVER_PASSWORD" \
  -C -Q "SELECT name FROM sys.server_principals WHERE name = N'otel_monitor';"
```

Then start the collector and confirm metrics appear within 30
seconds:

```bash showLineNumbers
docker logs otel-collector 2>&1 | grep -oE "Name: sqlserver\.[a-z_.]+" \
  | sort -u | wc -l
```

Expected: 30+ unique metric names on Linux (a few per-database
metrics like `sqlserver.database.io` only appear once the database
sees activity).

## Troubleshooting

### Connection refused / timeout

**Cause**: Collector cannot reach SQL Server at the configured
endpoint, or SQL Server is still warming up.

**Fix**:

1. Verify SQL Server is running and listening on TCP:
   `ss -tlnp | grep 1433` on the host
2. SQL Server containers on Apple Silicon run under x86 emulation -
   first cold start is 30-60 seconds. Use a healthcheck that
   tolerates this and `depends_on.condition: service_healthy` for
   the collector
3. Confirm SQL Server's TCP/IP protocol is enabled (it is by default
   in containers, but disabled on a fresh Windows install)

### Login failed for user 'otel\_monitor'

**Cause**: Password mismatch, missing grants, or `CHECK_POLICY = ON`
rejected the password.

**Fix**:

1. Test credentials directly from a shell that can reach the
   instance: `sqlcmd -S <host>,1433 -U otel_monitor -P '<password>' -C`
2. Check the SA error log for the precise reason:
   `SELECT TOP 50 [Text] FROM sys.fn_get_audit_file('...', NULL, NULL);`
   or via container logs
3. Re-run the bootstrap SQL - it is idempotent if you wrap the
   `CREATE LOGIN` in an `IF NOT EXISTS` check

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported, or exported with bad
auth.

**Fix**:

1. Add a `debug` exporter to the metrics pipeline temporarily and
   confirm metrics print to the collector's stdout - this isolates
   receiver from exporter
2. Check the collector logs for `Exporting failed` errors with HTTP
   401 or 403, which point at OAuth credentials for `otlphttp/b14`
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly

### Many default metrics are not appearing

**Cause**: The `sqlserverreceiver` has two collection paths.
Performance counters are Windows-only; the DMV path runs everywhere.

**Fix**:

1. On Linux containers and managed Linux SQL Server, only DMV-backed
   metrics emit. The receiver's `documentation.md` flags Windows-only
   metrics as "only available when running on Windows". The
   "What You'll Monitor" table above lists what's actually available
2. To get the full set, run the collector on a Windows host alongside
   a Windows SQL Server instance, with `computer_name` and
   `instance_name` set per the receiver README

## FAQ

**Does this work with SQL Server running in Kubernetes?**

Yes. Set `endpoint` to the SQL Server service DNS
(e.g., `sqlserver.default.svc.cluster.local:1433`) and inject
credentials via a Kubernetes secret. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor multiple SQL Server instances?**

Add multiple receiver blocks with distinct names:

```yaml
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
```

Then include both in the pipeline:
`receivers: [sqlserver/primary, sqlserver/replica]`

**What permissions does the monitoring account need?**

For SQL Server 2022+: `VIEW SERVER PERFORMANCE STATE` plus
`VIEW ANY DATABASE`. For SQL Server 2017-2019:
`VIEW SERVER STATE` plus `VIEW ANY DATABASE`. No write permissions
are required.

**Does this work with Azure SQL Database or Azure SQL Managed Instance?**

This guide targets self-hosted SQL Server. Azure SQL Database and
Azure SQL Managed Instance expose metrics via Azure Monitor; collect
them with the `azuremonitorreceiver` instead. See the
[Azure SQL Database guide](../infra/azure/sql-database.md) for the
managed PaaS path.

**Why is `sqlserver.transaction_log.usage` not showing up?**

It is one of the 13 Windows-perfcounter metrics that the receiver
silently skips on Linux. The DMV-equivalent for transaction log size
is captured indirectly by `sqlserver.database.tempdb.space` for
tempdb and per-database log usage queries you can wire up via the
`sqlquery` receiver if you need them on Linux.

## Related Guides

- [Azure SQL Database](../infra/azure/sql-database.md) - Paired guide for
  the managed PaaS (Azure SQL Database / Managed Instance). Uses the OTel
  `azure_monitor` receiver instead of `sqlserverreceiver`.
- [PostgreSQL Monitoring](./postgres.md) - Adjacent relational
  database guide
- [MySQL Monitoring](./mysql.md) - Adjacent relational database
  guide
- [.NET Aspire](../apps/auto-instrumentation/dotnet-aspire.md) -
  Apps-side .NET observability with Aspire orchestration
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on SQL Server metrics

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your
  own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MySQL](./mysql.md), or
  [Redis](./redis.md)
- **Instrument the App**: Pair the database telemetry with
  application traces from
  [.NET Aspire](../apps/auto-instrumentation/dotnet-aspire.md) for
  end-to-end visibility
- **Fine-tune Collection**: Disable Windows-only default metrics in
  the receiver config to keep your config noise-free if you target
  Linux only
