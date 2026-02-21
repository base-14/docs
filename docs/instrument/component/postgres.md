---
title: >
  PostgreSQL OpenTelemetry Monitoring — Connections, Query Performance,
  and Collector Setup
sidebar_label: PostgreSQL Basic
id: collecting-postgres-telemetry
sidebar_position: 1
description: >
  Collect PostgreSQL metrics with the OpenTelemetry Collector. Monitor
  connections, query performance, locks, WAL replication, and table stats
  using the PostgreSQL receiver and export to base14 Scout.
keywords:
  - postgresql opentelemetry
  - postgresql otel collector
  - postgresql metrics monitoring
  - postgresql performance monitoring
  - opentelemetry postgresql receiver
  - postgres observability
  - postgresql database monitoring
  - postgres telemetry collection
---

# PostgreSQL Basic

The OpenTelemetry Collector's PostgreSQL receiver collects 34 metrics from
PostgreSQL 9.6+, including connection counts, query performance, lock
activity, WAL replication lag, and table/index statistics. This guide
configures the receiver, sets up a monitoring user, and ships metrics to
base14 Scout.

> For advanced monitoring with query statistics, per-table metrics, and
> replication details, see
> [PostgreSQL Advanced Monitoring](./postgres-advanced.md).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| PostgreSQL             | 9.6     | 14+         |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- PostgreSQL must be accessible from the host running the Collector
- Superuser access for initial monitoring user creation
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Connections**: active backends, max connections
- **Database**: size, commit/rollback rates, temp files, operations
- **Tables & Indexes**: table/index count and size, vacuum count, sequential
  vs index scans
- **Locks**: active locks by type, deadlock count
- **WAL & Replication**: WAL age, lag, delay, replication data delay
- **I/O**: blocks read, buffer hits, tuple operations
  (insert/update/delete/fetch)

Full metric reference:
[OTel PostgreSQL Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/postgresqlreceiver)

## Access Setup

Create a dedicated PostgreSQL user with monitoring privileges:

```sql showLineNumbers
-- Connect as superuser (postgres)
CREATE USER postgres_exporter WITH PASSWORD '<your_password>';
GRANT pg_monitor TO postgres_exporter;
```

The `pg_monitor` role provides access to all the statistics views and functions
needed for monitoring without requiring superuser privileges.

Ensure your PostgreSQL instance allows connections and has the required
statistics enabled:

```sql showLineNumbers
-- Verify pg_stat_statements extension (optional but recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Check current connections
SELECT count(*) FROM pg_stat_activity;
```

Test connectivity with the monitoring user:

```bash showLineNumbers
# Test PostgreSQL connectivity
psql -h <postgres-host> -p <port> -U postgres_exporter -d <database-name> -c "SELECT version();"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  postgresql:
    endpoint: "<postgres-endpoint>:<port>"
    collection_interval: 10s
    username: ${env:POSTGRES_USER}
    password: ${env:POSTGRES_PASSWORD}
    databases: ["<db-name>"]
    tls:
      insecure_skip_verify: true

    metrics:
      postgresql.database.locks:
        enabled: true
      postgresql.deadlocks:
        enabled: true
      postgresql.sequential_scans:
        enabled: true
      postgresql.bgwriter.buffers.allocated:
        enabled: true
      postgresql.bgwriter.buffers.writes:
        enabled: true
      postgresql.bgwriter.checkpoint.count:
        enabled: true
      postgresql.bgwriter.duration:
        enabled: true
      postgresql.bgwriter.maxwritten:
        enabled: true
      postgresql.blocks_read:
        enabled: true
      postgresql.commits:
        enabled: true
      postgresql.database.count:
        enabled: true
      postgresql.db_size:
        enabled: true
      postgresql.backends:
        enabled: true
      postgresql.connection.max:
        enabled: true
      postgresql.rows:
        enabled: true
      postgresql.index.scans:
        enabled: true
      postgresql.index.size:
        enabled: true
      postgresql.operations:
        enabled: true
      postgresql.replication.data_delay:
        enabled: true
      postgresql.rollbacks:
        enabled: true
      postgresql.table.count:
        enabled: true
      postgresql.table.size:
        enabled: true
      postgresql.table.vacuum.count:
        enabled: true
      postgresql.temp_files:
        enabled: true
      postgresql.wal.age:
        enabled: true
      postgresql.wal.lag:
        enabled: true
      postgresql.wal.delay:
        enabled: true
      postgresql.tup_updated:
        enabled: true
      postgresql.tup_returned:
        enabled: true
      postgresql.tup_fetched:
        enabled: true
      postgresql.tup_inserted:
        enabled: true
      postgresql.tup_deleted:
        enabled: true
      postgresql.blks_hit:
        enabled: true
      postgresql.blks_read:
        enabled: true

processors:
  resource:
    attributes:
      - key: environment
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
      receivers: [postgresql]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
POSTGRES_USER=postgres_exporter
POSTGRES_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Test PostgreSQL connection
psql -h ${POSTGRES_HOST} -p <port> -U postgres_exporter -d ${DATABASE_NAME} -c "SELECT version();"
```

```sql showLineNumbers
-- Check database statistics
SELECT * FROM pg_stat_database WHERE datname = '<your-database>';

-- Check table statistics
SELECT * FROM pg_stat_user_tables LIMIT 5;

-- Check index usage
SELECT * FROM pg_stat_user_indexes LIMIT 5;
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach PostgreSQL at the configured endpoint.

**Fix**:

1. Verify PostgreSQL is running: `systemctl status postgresql` or
   `docker ps | grep postgres`
2. Check `pg_hba.conf` allows connections from the Collector host
3. Confirm PostgreSQL is listening on the expected port:
   `ss -tlnp | grep 5432`

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `psql -h localhost -U postgres_exporter -d postgres`
2. Verify the `pg_monitor` role is granted:
   `SELECT rolname FROM pg_roles WHERE pg_has_role('postgres_exporter', oid, 'member');`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### WAL metrics showing null or zero

**Cause**: WAL metrics require replication to be configured, or the
PostgreSQL version does not support the queried stats view.

**Fix**:

1. `postgresql.wal.age` requires PostgreSQL 13+ with `pg_stat_wal`
2. `postgresql.replication.data_delay` requires at least one replica
   connected — it reports zero with no replicas

## FAQ

**Does this work with PostgreSQL running in Kubernetes?**

Yes. Set `endpoint` to the PostgreSQL service DNS
(e.g., `postgresql.default.svc.cluster.local:5432`) and inject
credentials via a Kubernetes secret. The Collector can run as a sidecar
or DaemonSet.

**How do I monitor multiple PostgreSQL instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  postgresql/primary:
    endpoint: primary:5432
    username: postgres_exporter
    password: "<your_password>"
  postgresql/replica:
    endpoint: replica:5432
    username: postgres_exporter
    password: "<your_password>"
```

Then include both in the pipeline:
`receivers: [postgresql/primary, postgresql/replica]`

**What is the difference between Basic and Advanced monitoring?**

This guide uses the OTel PostgreSQL receiver for core database metrics.
The [Advanced guide](./postgres-advanced.md) adds deeper query-level
statistics, per-table I/O, and detailed replication monitoring.

**What permissions does the monitoring account need?**

The `pg_monitor` role (available in PostgreSQL 10+). For PostgreSQL 9.6,
grant `pg_stat_scan_tables` and access to `pg_stat_activity` individually.
No write permissions are needed.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [MySQL](./mysql.md), [MongoDB](./mongodb.md),
  and other components
- **Go Deeper**: Start with the
  [Advanced monitoring guide](./postgres-advanced.md) for query-level
  statistics and per-table metrics

## Related Guides

- [PostgreSQL Advanced](./postgres-advanced.md)
  — Deeper query and table-level monitoring
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [MongoDB Monitoring](./mongodb.md) — Alternative database monitoring
