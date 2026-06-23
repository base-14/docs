---
title: >
  MySQL OpenTelemetry Monitoring - Query Performance, Buffer Pool,
  and Collector Setup
sidebar_label: MySQL
id: collecting-mysql-telemetry
sidebar_position: 3
description: >
  Collect MySQL metrics with the OpenTelemetry Collector. Monitor query
  throughput, slow queries, the InnoDB buffer pool, locks, and replication
  lag using the MySQL receiver and export to base14 Scout.
keywords:
  - mysql opentelemetry
  - mysql otel collector
  - mysql metrics monitoring
  - mysql performance monitoring
  - opentelemetry mysql receiver
  - mysql observability
  - monitor mysql kubernetes
  - mysql telemetry collection
---

# MySQL

The OpenTelemetry Collector's `mysqlreceiver` connects directly to MySQL
and reads `SHOW GLOBAL STATUS`, global variables, and
`performance_schema`, collecting 40+ metrics across queries, connections,
the InnoDB buffer pool, locks, and replication when the optional metric
set is enabled. This guide sets up a read-only monitoring user, configures
the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended        |
| ---------------------- | ------- | ------------------ |
| MySQL                  | 8.0     | 8.0+ (8.4.10)      |
| OTel Collector Contrib | 0.90.0  | 0.153.0            |
| base14 Scout           | Any     | -                  |

Before starting:

- MySQL must be accessible from the host running the Collector.
- A read-only monitoring account with the required permissions (see
  [Access Setup](#access-setup)).
- `performance_schema` enabled for statement-level and lock metrics.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The `mysqlreceiver` connects directly to MySQL, so a few things differ
from exporter-fronted components:

- **No `up` and no health metric.** Liveness is the receiver scraping
  successfully plus `mysql.uptime` advancing - a reset of `mysql.uptime`
  means a restart. There is no `up` series (that is Prometheus-receiver
  only) and no health gauge.
- **No single aggregate query-latency metric.** Latency detail is
  per-statement-digest via `mysql.statement_event.wait.time`, which
  requires `performance_schema`. There is no one "query latency" gauge.
- **Replication lag is available but enabled-but-silent off a replica.**
  `mysql.replica.time_behind_source` and `mysql.replica.sql_delay` emit
  no series on a standalone server or a primary; they populate only when
  MySQL runs as a replica.

Many `mysqlreceiver` metrics are disabled by default - the
[Configuration](#configuration) `metrics:` block enables the optional set
(query counts, slow queries, connections, statement events, table lock
waits, per-table sizing, replica lag, X Protocol, and more). The tiers
below reflect the enabled set.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `mysql.uptime` | Seconds since server start - liveness and restart detection (no `up`/health on this path; a reset means a restart). |
| `mysql.query.count` | Total queries (Questions) - the throughput KPI. |
| `mysql.query.slow.count` | Queries over `long_query_time` - the query-quality KPI. |
| `mysql.threads` | Threads by `kind` (running/connected/cached/created); `running` is the saturation signal. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `mysql.connection.count` / `mysql.connection.errors` | Connections made and connection errors by type - connection saturation and failures. |
| `mysql.buffer_pool.usage` / `mysql.buffer_pool.operations` | InnoDB buffer-pool bytes by state and pool operations; disk reads vs read-requests is cache efficiency. |
| `mysql.row_locks` | InnoDB row-lock waits and time - write contention. |
| `mysql.table.lock_wait.read.time` / `mysql.table.lock_wait.write.time` | Table lock-wait time (read/write) - table-level contention. |
| `mysql.handlers` | Handler operations by `kind` (e.g. `read_rnd_next` = full scans). |
| `mysql.joins` | Join types performed; full joins point at missing indexes. |
| `mysql.tmp_resources` | Temp tables and files created - queries spilling to disk. |
| `mysql.sorts` | Sort operations; merge passes mean sort-buffer pressure. |
| `mysql.statement_event.count` / `mysql.statement_event.wait.time` | Per-digest statement counts and wait time - the closest signal to query latency (needs `performance_schema`). |
| `mysql.replica.time_behind_source` / `mysql.replica.sql_delay` | Replication lag and configured SQL delay (replicas only; silent on a standalone or primary). |

### Diagnostic - for investigation and tuning

Higher cardinality; many of these are per-`table` series. Reach for them
during an incident or a capacity review.

| Group | Metrics | When you reach for it |
|---|---|---|
| Command / operation rates | `mysql.commands`, `mysql.operations`, `mysql.row_operations`, `mysql.page_operations` | Command mix and InnoDB operation/row/page breakdowns. |
| Per-table / per-index I/O | `mysql.table.io.wait.count` / `.time`, `mysql.index.io.wait.count` / `.time` | Localising I/O wait to a table or index. |
| Per-table sizing | `mysql.table.rows`, `mysql.table.size`, `mysql.table.average_row_length` | Per-`table` row count, size, and average row length. |
| Buffer-pool internals | `mysql.buffer_pool.data_pages`, `.limit`, `.page_flushes`, `.pages` | InnoDB buffer-pool internals beyond the headline usage. |
| Cache / open resources | `mysql.table_open_cache`, `mysql.opened_resources` | Table-open cache hits/misses and opened tables/files. |
| Lock / redo-log / doublewrite internals | `mysql.locks`, `mysql.log_operations`, `mysql.double_writes` | Table locks (immediate/waited), redo-log ops, InnoDB doublewrites. |
| Statements / client | `mysql.prepared_statements`, `mysql.query.client.count` | Prepared-statement ops and client query count. |
| X Protocol / network | `mysql.mysqlx_connections`, `mysql.mysqlx_worker_threads`, `mysql.client.network.io` | X Protocol connections/threads and client network I/O. |

Full metric reference:
[OTel MySQL Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/mysqlreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
MySQL workloads vary widely, so these are relative-to-baseline starting
points - tune them to your traffic.

| Metric | Threshold | Why it matters |
|---|---|---|
| MySQL unreachable | The `mysql` receiver producing no data for > 1m, or `mysql.uptime` resetting | No `up`/health on this path - scrape success plus uptime are liveness. Check the process and the receiver connection. |
| `rate(mysql.query.slow.count)` | Rising vs baseline | More queries exceeding `long_query_time` - check the slow log, indexes, and query plans. |
| `mysql.threads{kind=running}` | Rising vs baseline | Running threads spiking - contention or overload. Correlate with locks and slow queries. |
| `rate(mysql.connection.errors)` | Rising vs baseline | Connections failing - check `max_connections`, auth, and network limits. |
| `mysql.buffer_pool.operations` (disk reads) | Rising vs read-requests | The working set exceeds the InnoDB buffer pool and reads spill to disk. Add RAM or size the pool. |
| `rate(mysql.row_locks)` | Rising vs baseline | InnoDB row-lock waits climbing - write contention on hot rows. Investigate transactions. |
| `mysql.replica.time_behind_source` | Rising (replicas) | The replica is falling behind the source. Check the replica I/O and SQL threads and load. |

## Access Setup

Create a dedicated MySQL user with minimal monitoring privileges:

```sql showLineNumbers title="mysql monitoring user setup"
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<your_password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

Use a plain `IDENTIFIED BY`, which takes the default
`caching_sha2_password` auth. Do not use
`IDENTIFIED WITH mysql_native_password` - that plugin is not loaded by
default on MySQL 8.4.

**Minimum required permissions:**

| Permission                       | Purpose                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| `PROCESS`                        | Access to `SHOW GLOBAL STATUS` and `SHOW GLOBAL VARIABLES`. |
| `REPLICATION CLIENT`             | Access to `SHOW REPLICA STATUS` for replication metrics.   |
| `SELECT ON performance_schema.*` | Statement events, table I/O, and lock metrics.             |

No write permissions are needed.

Ensure `performance_schema` and the slow query log are enabled:

```ini showLineNumbers title="my.cnf"
[mysqld]
performance_schema = ON
slow_query_log = ON
long_query_time = 1
```

Test connectivity with the monitoring user:

```bash showLineNumbers title="Verify access"
mysql -h <mysql-host> -P 3306 -u otel_monitor -p -e "SELECT version();"
```

## Configuration

Many `mysqlreceiver` metrics are disabled by default, so the `metrics:`
block below is required to get the full surface. The `statement_events`
block bounds the per-digest statement query that backs
`mysql.statement_event.*`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mysql:
    endpoint: <mysql-host>:3306   # Change to your MySQL address
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
    collection_interval: 10s
    allow_native_passwords: true

    tls:
      insecure: true
      insecure_skip_verify: true

    metrics:
      # Disabled by default - enable for full observability
      mysql.client.network.io:
        enabled: true
      mysql.commands:
        enabled: true
      mysql.connection.count:
        enabled: true
      mysql.connection.errors:
        enabled: true
      mysql.joins:
        enabled: true
      mysql.mysqlx_worker_threads:
        enabled: true
      mysql.query.client.count:
        enabled: true
      mysql.query.count:
        enabled: true
      mysql.query.slow.count:
        enabled: true
      mysql.replica.sql_delay:
        enabled: true
      mysql.replica.time_behind_source:
        enabled: true
      mysql.statement_event.count:
        enabled: true
      mysql.statement_event.wait.time:
        enabled: true
      mysql.table.average_row_length:
        enabled: true
      mysql.table.lock_wait.read.count:
        enabled: true
      mysql.table.lock_wait.read.time:
        enabled: true
      mysql.table.lock_wait.write.count:
        enabled: true
      mysql.table.lock_wait.write.time:
        enabled: true
      mysql.table.rows:
        enabled: true
      mysql.table.size:
        enabled: true
      mysql.table_open_cache:
        enabled: true

    statement_events:
      digest_text_limit: 120
      time_limit: 24h
      limit: 250

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

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [mysql]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (introduced in semantic conventions v1.27.0, stable as
> of v1.41.0). The legacy `deployment.environment` is still accepted by
> Scout for backward compatibility, but new configs should emit the
> dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
MYSQL_USER=otel_monitor
MYSQL_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for a successful MySQL connection
docker logs otel-collector 2>&1 | grep -i "mysql"

# Verify MySQL connectivity and that uptime is advancing
mysql -h <mysql-host> -P 3306 -u otel_monitor -p \
  -e "SHOW GLOBAL STATUS LIKE 'Uptime';"
```

```sql showLineNumbers
-- Check thread state
SHOW GLOBAL STATUS LIKE 'Threads_%';

-- Check the InnoDB buffer pool
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';

-- Check slow queries
SHOW GLOBAL STATUS LIKE 'Slow_queries';
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach MySQL at the configured endpoint.

**Fix**:

1. Verify MySQL is running: `systemctl status mysql` or
   `docker ps | grep mysql`.
2. Confirm the endpoint address and port (default 3306) in your config.
3. Check `bind-address` in `my.cnf` - change to `0.0.0.0` if the
   Collector runs on a separate host.

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `mysql -h localhost -u otel_monitor -p -e "SELECT 1;"`.
2. Verify the user has the required grants:
   `SHOW GRANTS FOR 'otel_monitor'@'%';`.
3. Check the `MYSQL_USER` and `MYSQL_PASSWORD` environment variables.

### Statement event metrics always zero

**Cause**: `performance_schema` is disabled or statement instrumentation
is not active, so the per-digest signals stay empty.

**Look at**: `mysql.statement_event.count` and
`mysql.statement_event.wait.time` - both stay at zero when
`performance_schema` is off.

**Fix**:

1. Verify `performance_schema` is enabled:
   `SHOW VARIABLES LIKE 'performance_schema';`.
2. Check statement instrumentation:
   `SELECT * FROM performance_schema.setup_consumers WHERE name LIKE 'events_statements%';`.
3. Enable consumers if needed:
   `UPDATE performance_schema.setup_consumers SET ENABLED = 'YES'`
   `WHERE name LIKE 'events_statements%';`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with MySQL running in Kubernetes?**

Yes. Set `endpoint` to the MySQL service DNS
(e.g., `mysql.default.svc.cluster.local:3306`) and inject credentials
via a Kubernetes secret. The Collector can run as a sidecar or DaemonSet.

**How do I monitor multiple MySQL instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  mysql/primary:
    endpoint: primary:3306
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
  mysql/replica:
    endpoint: replica:3306
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
```

Then include both in the pipeline:
`receivers: [mysql/primary, mysql/replica]`.

**What permissions does the monitoring account need?**

`PROCESS`, `REPLICATION CLIENT`, and `SELECT` on `performance_schema`.
No write access is required - the Collector only reads metrics, it does
not modify MySQL data.

**Why are replication metrics showing zero?**

`mysql.replica.time_behind_source` and `mysql.replica.sql_delay` require
MySQL to be configured as a replica. On a standalone instance or a
primary, they report nothing - this is expected behavior.

**Why is there no single query-latency metric?**

The `mysqlreceiver` does not expose one aggregate latency gauge. Latency
detail is per statement digest via `mysql.statement_event.wait.time`,
which requires `performance_schema`. Aggregate by digest to find the
slowest statement shapes.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on MySQL metrics.
- [PostgreSQL Monitoring](./postgres.md) - Another relational database
  on the same receiver pattern.
- [MongoDB Monitoring](./mongodb.md) - Document-database monitoring.
- [Redis Monitoring](./redis.md) - In-memory cache and data store.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MongoDB](./mongodb.md), and
  [Redis](./redis.md).
- **Fine-tune Collection**: Adjust `collection_interval` and the
  `statement_events` limits to your query workload.
