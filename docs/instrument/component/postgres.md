---
title: >
  PostgreSQL OpenTelemetry Monitoring - Connections, Transactions,
  and Collector Setup
sidebar_label: PostgreSQL Basic
id: collecting-postgres-telemetry
sidebar_position: 1
description: >
  Collect PostgreSQL metrics with the OpenTelemetry Collector. Monitor
  backend connections, transaction throughput, and deadlocks, then export
  to base14 Scout.
keywords:
  - postgresql opentelemetry
  - postgresql otel collector
  - postgresql metrics monitoring
  - postgresql performance monitoring
  - opentelemetry postgresql receiver
  - postgres observability
  - monitor postgresql kubernetes
  - postgresql telemetry collection
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does PostgreSQL OpenTelemetry monitoring work in Kubernetes?","acceptedAnswer":{"@type":"Answer","text":"Yes. Set the endpoint to the PostgreSQL service DNS (e.g., postgresql.default.svc.cluster.local:5432) and inject credentials via a Kubernetes secret. The OpenTelemetry Collector can run as a sidecar or DaemonSet."}},{"@type":"Question","name":"What permissions does the PostgreSQL monitoring user need?","acceptedAnswer":{"@type":"Answer","text":"The pg_monitor role is sufficient. It grants read access to the statistics views the receiver queries, and no write permissions are needed."}},{"@type":"Question","name":"How do I monitor multiple PostgreSQL instances with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add multiple PostgreSQL receiver blocks with distinct names (e.g., postgresql/primary and postgresql/replica) in the OpenTelemetry Collector config, then include both in the metrics pipeline."}},{"@type":"Question","name":"What is the difference between Basic and Advanced PostgreSQL monitoring?","acceptedAnswer":{"@type":"Answer","text":"This guide uses the OpenTelemetry PostgreSQL receiver for core database metrics. The Advanced guide adds deeper query-level statistics, per-table I/O, and detailed replication monitoring."}},{"@type":"Question","name":"Why are the WAL metrics not showing up?","acceptedAnswer":{"@type":"Answer","text":"postgresql.wal.age and postgresql.wal.lag only emit once replication is configured. On a single-node server with no standby or replication slot they stay silent even when enabled. Keep them enabled and they surface once a replica connects."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# PostgreSQL Basic

The OpenTelemetry Collector's PostgreSQL receiver collects 23 metrics from
PostgreSQL, including backend connections, transaction commit and
rollback throughput, lock and deadlock activity, cache-miss pressure, and
per-table and per-index statistics. This guide configures the receiver,
sets up a read-only monitoring user, and ships metrics to base14 Scout.

> For advanced monitoring with query statistics, per-table I/O, and
> replication details, see
> [PostgreSQL Advanced Monitoring](./postgres-advanced.md).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| PostgreSQL             | 9.6     | 18+         |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- PostgreSQL must be accessible from the host running the Collector.
- Superuser access once, to create the monitoring user.
- A read-only monitoring account with the `pg_monitor` role (see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `postgresql.backends` | Active backend connections - reachability plus connection load. |
| `postgresql.commits` | Committed transactions; the headline throughput KPI. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `postgresql.rollbacks` | Rolled-back transactions - an abort / error signal. |
| `postgresql.deadlocks` | Deadlocks detected; lock-ordering contention. |
| `postgresql.database.locks` | Locks held, by mode - contention pressure. |
| `postgresql.connection.max` | Configured max connections; the saturation ceiling for `backends`. |
| `postgresql.db_size` | On-disk database size - capacity trend. |
| `postgresql.blocks_read` | Disk blocks read; cache-miss / IO pressure. |
| `postgresql.temp_files` | Temp files written - query spill to disk. |
| `postgresql.sequential_scans` | Sequential scans; a missing-index signal. |

### Diagnostic - for investigation and tuning

Higher cardinality - per-table, per-index, and background-writer
internals. Enable on demand; in production you can drop this tier to
control metric volume and keep Core + Operational.

| Metric | What it tells you |
|---|---|
| `postgresql.rows` | Rows read / returned, by operation. |
| `postgresql.operations` | Row operations (insert / update / delete / hot). |
| `postgresql.database.count` | Number of databases on the server. |
| `postgresql.table.count` | Live and dead tables. |
| `postgresql.table.size` | Per-table on-disk size. |
| `postgresql.table.vacuum.count` | Vacuum operations per table. |
| `postgresql.index.scans` | Index scans per index. |
| `postgresql.index.size` | Per-index on-disk size. |
| `postgresql.bgwriter.buffers.allocated` | Buffers allocated. |
| `postgresql.bgwriter.buffers.writes` | Buffers written, by source. |
| `postgresql.bgwriter.checkpoint.count` | Checkpoints, by type. |
| `postgresql.bgwriter.duration` | Checkpoint write / sync time. |
| `postgresql.bgwriter.maxwritten` | Background-writer stop-on-maxwritten count. |

`postgresql.wal.age` and `postgresql.wal.lag` are worth enabling but stay
silent on a single-node server with no replication slot or standby - they
need replication context to emit. Keep them enabled; both surface once
replication is configured.

Full metric reference:
[OTel PostgreSQL Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/postgresqlreceiver)

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. Tune to
your workload; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `postgresql.backends` vs `postgresql.connection.max` | > 80% of max | Approaching max | The app starts failing to connect. Raise `max_connections` or add a connection pooler. |
| `rate(postgresql.rollbacks) / rate(postgresql.commits)` | Rising vs baseline | Sustained climb | App errors or contention; inspect the failing transactions. |
| `rate(postgresql.deadlocks)` | > 0 | Sustained > 0 | Lock-ordering contention; review transaction access patterns. |
| `rate(postgresql.temp_files)` | > 0 rising | Sustained rise | `work_mem` is too small for the workload; tune it or optimise the queries. |
| `rate(postgresql.blocks_read)` | Rising vs baseline | Sustained rise | `shared_buffers` undersized or the working set grew; review IO. |
| `postgresql.db_size` | Growth trend | Approaching volume capacity | Plan storage before the volume fills. |

## Access Setup

Create a dedicated read-only monitoring user. The `pg_monitor` role
grants access to all the statistics views and functions
the receiver queries, without superuser privileges.

```sql showLineNumbers title="postgres monitoring user setup"
-- Connect as a superuser (e.g. postgres)
CREATE USER otel_monitor WITH PASSWORD '<your_password>';
GRANT pg_monitor TO otel_monitor;
```

**Minimum required permissions:**

- `pg_monitor`: read access to `pg_stat_*` views for connection,
  transaction, lock, table, and index statistics. The role exists on
  PostgreSQL 10+; on 9.6 grant `pg_stat_scan_tables` and access to
  `pg_stat_activity` individually.

No write permissions are needed.

Test connectivity with the monitoring user:

```bash showLineNumbers title="Verify access"
psql -h localhost -p 5432 -U otel_monitor -d <database-name> \
  -c "SELECT version();"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  postgresql:
    endpoint: localhost:5432            # Change to your PostgreSQL address
    username: ${env:POSTGRES_USER}
    password: ${env:POSTGRES_PASSWORD}
    databases:
      - <db-name>                       # One or more databases to monitor
    collection_interval: 10s
    tls:
      insecure_skip_verify: true        # Set to false with TLS in production

    metrics:
      postgresql.connection.max:
        enabled: true
      postgresql.database.locks:
        enabled: true
      postgresql.deadlocks:
        enabled: true
      postgresql.sequential_scans:
        enabled: true
      postgresql.temp_files:
        enabled: true
      postgresql.wal.age:
        enabled: true                   # Emits once replication is configured
      postgresql.wal.lag:
        enabled: true                   # Emits once a standby is connected

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
      insecure_skip_verify: true        # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [postgresql]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

The metrics not listed in the `metrics:` block are enabled by the receiver
by default; the entries above turn on the ones that are off by default and
that this guide relies on. To control metric volume in production, drop the
Diagnostic tier with a `filter` processor while keeping the Core and
Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute. The legacy `deployment.environment` is still accepted by
> Scout for backward compatibility, but new configs should emit the dotted
> form.

### Environment Variables

```bash showLineNumbers title=".env"
POSTGRES_USER=otel_monitor
POSTGRES_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the PostgreSQL receiver starting
docker logs otel-collector 2>&1 | grep -i "postgresql"

# Confirm the monitoring user can reach the server
psql -h localhost -p 5432 -U otel_monitor -d <db-name> \
  -c "SELECT version();"
```

A few of the headline series only populate after the server does work, so
run some traffic and confirm `postgresql.commits` and `postgresql.backends`
move:

```sql showLineNumbers
-- Connection load and transaction counts
SELECT numbackends, xact_commit, xact_rollback
FROM pg_stat_database WHERE datname = '<db-name>';
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach PostgreSQL at the configured
endpoint.

**Fix**:

1. Verify PostgreSQL is running: `docker ps | grep postgres` or
   `systemctl status postgresql`.
2. Confirm `pg_hba.conf` allows connections from the Collector host.
3. Check PostgreSQL is listening on the expected port:
   `ss -tlnp | grep 5432`.

### Authentication failed

**Cause**: The monitoring credentials are wrong, or the user lacks the
`pg_monitor` role.

**Fix**:

1. Test credentials directly:
   `psql -h localhost -U otel_monitor -d postgres`.
2. Verify the role is granted:
   `SELECT rolname FROM pg_roles WHERE pg_has_role('otel_monitor', oid, 'member');`.

### Queries are spilling to disk or the cache is thrashing

**Cause**: `work_mem` is too small for the workload, or `shared_buffers`
is undersized and the working set no longer fits in cache.

**Look at**: `postgresql.temp_files` - a rising rate means sorts and hashes
are spilling to disk. `postgresql.blocks_read` climbing against a flat
buffer-hit trend means reads are missing the buffer cache. The Diagnostic
`postgresql.sequential_scans` and `postgresql.index.scans` series tell you
whether a query is scanning a table instead of using an index.

**Fix**:

1. Raise `work_mem` for sort / hash-heavy workloads if `temp_files` climbs.
2. Increase `shared_buffers` or add an index where `sequential_scans`
   dominates for a large table.

### WAL metrics show null or zero

**Cause**: `postgresql.wal.age` and `postgresql.wal.lag` need replication
context. On a single-node server with no standby or replication slot they
do not emit.

**Fix**:

1. Keep both metrics enabled - they surface automatically once a replica
   connects or a replication slot exists.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with PostgreSQL running in Kubernetes?**

Yes. Set `endpoint` to the PostgreSQL service DNS
(e.g., `postgresql.default.svc.cluster.local:5432`) and inject the
credentials via a Kubernetes secret. The Collector can run as a sidecar or
DaemonSet.

**What permissions does the monitoring account need?**

The `pg_monitor` role. It grants read access to the
`pg_stat_*` views the receiver queries. No write access is required.

**How do I monitor multiple PostgreSQL instances?**

Add multiple receiver blocks with distinct names, then include both in the
pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  postgresql/primary:
    endpoint: primary:5432
    username: ${env:POSTGRES_USER}
    password: ${env:POSTGRES_PASSWORD}
    databases: [<db-name>]
  postgresql/replica:
    endpoint: replica:5432
    username: ${env:POSTGRES_USER}
    password: ${env:POSTGRES_PASSWORD}
    databases: [<db-name>]

service:
  pipelines:
    metrics:
      receivers: [postgresql/primary, postgresql/replica]
```

**What is the difference between Basic and Advanced monitoring?**

This guide uses the OTel PostgreSQL receiver for core database metrics. The
[Advanced guide](./postgres-advanced.md) adds deeper query-level
statistics, per-table I/O, and detailed replication monitoring.

**Why are the WAL metrics not showing up?**

`postgresql.wal.age` and `postgresql.wal.lag` only emit once replication is
configured. On a single-node server with no standby or replication slot
they stay silent even when enabled. Keep them on and they surface once a
replica connects.

## Related Guides

- [PostgreSQL Advanced](./postgres-advanced.md) -
  Deeper query and table-level monitoring.
- [Azure Database for PostgreSQL](../infra/azure/database-for-postgresql.md) -
  Managed Flexible Server delta on this guide: Azure Monitor surface
  metrics, `azure_pg_admin` grants, `pg_stat_statements` via Server
  Parameters, and the Diagnostic Settings → Event Hubs logs path.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [MySQL Monitoring](./mysql.md) - A common companion relational database.
- [MongoDB Monitoring](./mongodb.md) - Alternative database monitoring.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MySQL](./mysql.md), [MongoDB](./mongodb.md), and other components.
- **Go Deeper**: Start with the
  [Advanced monitoring guide](./postgres-advanced.md) for query-level
  statistics and per-table metrics.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
