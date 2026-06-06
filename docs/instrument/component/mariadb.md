---
title: >
  MariaDB OpenTelemetry Monitoring - Query Throughput, Connections,
  and Collector Setup
sidebar_label: MariaDB
id: collecting-mariadb-telemetry
sidebar_position: 38
description: >
  Collect MariaDB metrics with the OpenTelemetry Collector. Monitor
  query throughput, connections, and buffer-pool pressure, then ship
  metrics to base14 Scout.
keywords:
  - mariadb opentelemetry
  - mariadb otel collector
  - mariadb metrics monitoring
  - mariadb performance monitoring
  - opentelemetry mysql receiver mariadb
  - mariadb observability
  - mariadb database monitoring
  - mariadb telemetry collection
---

# MariaDB

MariaDB speaks the MySQL wire protocol, so the OpenTelemetry Collector's
`mysql` receiver monitors it without a separate exporter. It connects over
TCP on port 3306, runs `SHOW GLOBAL STATUS` / `SHOW GLOBAL VARIABLES` and
`performance_schema` queries, and emits 31 metrics per scrape - query
throughput, connection health, lock contention, buffer-pool pressure, and
InnoDB internals. This guide sets up a monitoring user,
configures the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| MariaDB                | 10.5    | 12.3+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- MariaDB must be reachable from the host running the Collector.
- A superuser account to create the monitoring user once.
- `performance_schema` enabled for statement-event and table-lock-wait
  coverage.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).
- A Scout account and OTLP endpoint.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `mysql.uptime` | Seconds since server start - reachability and restart detection. |
| `mysql.query.count` | Statements executed; the headline throughput KPI. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Connection health | `mysql.connection.count`, `mysql.connection.errors` | Connections opened and connection failures by cause. |
| Latency | `mysql.query.slow.count` | Queries over `long_query_time` - regressions and missing indexes. |
| Contention | `mysql.locks`, `mysql.row_locks` | Table locks (immediate vs waited) and InnoDB row-lock waits / time. |
| Saturation | `mysql.threads` | Threads connected / running / cached against the server max. |
| Cache pressure | `mysql.buffer_pool.usage` | Buffer-pool bytes by state; working set vs pool size. |
| Query spill | `mysql.tmp_resources` | Temp tables and files, memory vs disk - sort and join spill. |

### Diagnostic - for investigation and tuning

Higher cardinality (these series drive most of the per-scrape data-point
count). Keep them available for incident work; drop them in production
with a `filter` processor if you need to control volume.

| Group | Metrics | When you reach for it |
|---|---|---|
| Command / handler breakdown | `mysql.commands`, `mysql.handlers`, `mysql.query.client.count` | Which statement and storage-engine handler calls dominate. |
| InnoDB internals | `mysql.operations`, `mysql.page_operations`, `mysql.log_operations`, `mysql.double_writes` | Row, page, redo-log, and doublewrite-buffer activity. |
| Buffer-pool detail | `mysql.buffer_pool.data_pages`, `mysql.buffer_pool.limit`, `mysql.buffer_pool.operations`, `mysql.buffer_pool.page_flushes`, `mysql.buffer_pool.pages` | Clean/dirty pages, capacity, read/write requests, flush rate. |
| Query workload | `mysql.sorts`, `mysql.joins`, `mysql.prepared_statements` | Sort and join types, prepared-statement load. |
| Resource accounting | `mysql.opened_resources`, `mysql.table_open_cache`, `mysql.client.network.io` | Files / tables / definitions opened, cache hits/misses, client bytes. |
| Per-table stats | `mysql.table.rows`, `mysql.table.size`, `mysql.table.average_row_length` | Row count, data/index size, and average row length per table. |

The following are enabled in the config but only emit in specific
contexts - keep them on so they surface when those conditions arise:

- `mysql.replica.sql_delay`, `mysql.replica.time_behind_source` - emit
  only when a replica is configured.
- `mysql.statement_event.count`, `mysql.statement_event.wait.time` -
  require populated `performance_schema` digest tables.
- `mysql.table.lock_wait.read.count` / `.read.time` /
  `.write.count` / `.write.time` - emit only when contended table-lock
  waits occur.

Full metric reference:
[OTel MySQL Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/mysqlreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. These are
starting points; tune them to your workload.

| Metric | Threshold | Why it matters |
|---|---|---|
| `rate(mysql.connection.errors)` | Rising above 0 | Clients can't connect; check `max_connections`, auth, and network. |
| `mysql.threads{kind=connected}` | Near the server max | Approaching `max_connections`; add pooling or raise the cap. |
| `rate(mysql.query.slow.count)` | Rising vs baseline | Query regressions or missing indexes; inspect the slow log. |
| `mysql.row_locks` (wait time) | Rising | Transactions blocking; review lock ordering and hot rows. |
| `mysql.tmp_resources{kind=disk_tables}` | Rising | `tmp_table_size` too small or unindexed sorts; tune queries. |
| `mysql.buffer_pool.usage` (dirty/free ratio) | Shifting toward full | Working set exceeds the pool; consider `innodb_buffer_pool_size`. |

## Access Setup

Create a dedicated MariaDB user with minimal monitoring privileges:

```sql showLineNumbers title="MariaDB monitoring user setup"
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<your_password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

**Minimum required permissions:**

| Permission                       | Purpose                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `PROCESS`                        | Access to `SHOW GLOBAL STATUS` and `SHOW GLOBAL VARIABLES`  |
| `REPLICATION CLIENT`             | Access to `SHOW REPLICA STATUS` for replication metrics     |
| `SELECT ON performance_schema.*` | Statement events, table I/O, and lock-wait metrics          |

No write permissions are needed. The Collector only reads metrics.

Ensure `performance_schema` and the slow query log are enabled:

```ini showLineNumbers title="my.cnf"
[mysqld]
performance_schema = ON
slow_query_log = ON
long_query_time = 1
```

Test connectivity with the monitoring user:

```bash showLineNumbers title="Verify access"
mariadb -h <mariadb-host> -P 3306 -u otel_monitor -p \
  -e "SELECT version();"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mysql:
    endpoint: ${env:MARIADB_HOST}:3306
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

    statement_events: {}

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

`allow_native_passwords: true` lets the receiver authenticate against
MariaDB's native password plugin. Leave the TLS block as shown only for an
in-cluster or local stack with TLS disabled; against a TLS-enabled server,
configure the CA and drop `insecure`.

To control metric volume in production, drop the Diagnostic tier with a
`filter` processor while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute. The legacy `deployment.environment` is still accepted by
> Scout for backward compatibility, but new configs should emit the dotted
> form.

### Environment Variables

```bash showLineNumbers title=".env"
MARIADB_HOST=localhost
MYSQL_USER=otel_monitor
MYSQL_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped MariaDB metrics
docker logs otel-collector 2>&1 | grep -i "mysql"

# Verify MariaDB connectivity and uptime
mariadb -h ${MARIADB_HOST} -P 3306 -u otel_monitor -p \
  -e "SHOW GLOBAL STATUS LIKE 'Uptime';"
```

```sql showLineNumbers
-- Thread states (mysql.threads)
SHOW GLOBAL STATUS LIKE 'Threads_%';

-- InnoDB buffer pool (mysql.buffer_pool.*)
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';

-- Slow queries (mysql.query.slow.count)
SHOW GLOBAL STATUS LIKE 'Slow_queries';
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach MariaDB at the configured endpoint.

**Fix**:

1. Verify MariaDB is running: `systemctl status mariadb` or
   `docker ps | grep mariadb`.
2. Confirm the endpoint address and port (default 3306) in your config.
3. Check `bind-address` in `my.cnf` - set it to `0.0.0.0` if the Collector
   runs on a separate host.

### Authentication failed

**Cause**: Monitoring credentials are wrong, or the user lacks grants.

**Fix**:

1. Test credentials directly:
   `mariadb -h localhost -u otel_monitor -p -e "SELECT 1;"`.
2. Verify the grants: `SHOW GRANTS FOR 'otel_monitor'@'%';`.
3. Confirm `MYSQL_USER` and `MYSQL_PASSWORD` are set, and that
   `allow_native_passwords: true` is present if the server uses native
   passwords.

### Statement-event metrics always zero

**Cause**: `performance_schema` is disabled, its statement consumers are
off, or the digest tables haven't populated yet.

**Look at**: the Diagnostic `mysql.statement_event.count` and
`mysql.statement_event.wait.time` series - both stay flat at zero until
`performance_schema` digests exist.

**Fix**:

1. Verify it's enabled: `SHOW VARIABLES LIKE 'performance_schema';`.
2. Check the statement consumers, and enable them if they are off:

```sql showLineNumbers
SELECT * FROM performance_schema.setup_consumers
WHERE name LIKE 'events_statements%';

UPDATE performance_schema.setup_consumers SET ENABLED = 'YES'
WHERE name LIKE 'events_statements%';
```

### Table-lock-wait metrics stay flat

**Cause**: No contended table-lock waits have occurred.

**Look at**: the Diagnostic `mysql.table.lock_wait.read.*` /
`.write.*` series - they emit only when sessions actually wait on a table
lock, so a quiet server reports nothing here. This is expected, not a
misconfiguration.

### Replica metrics missing

**Cause**: The server has no replica configured.

**Look at**: `mysql.replica.sql_delay` and
`mysql.replica.time_behind_source` - these emit only on a server with an
active replication channel.

**Fix**: No action needed on a standalone server. They surface
automatically once replication is configured.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why does this use the MySQL receiver?**

MariaDB is wire-compatible with MySQL - both use the MySQL protocol for
client connections. The Collector's `mysql` receiver works against MariaDB
without modification. There is no separate MariaDB receiver.

**Does this work with MariaDB Galera Cluster?**

Yes. Add a receiver block per node with distinct names:

```yaml
receivers:
  mysql/node1:
    endpoint: node1:3306
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
  mysql/node2:
    endpoint: node2:3306
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
```

Then include both in the pipeline: `receivers: [mysql/node1, mysql/node2]`.

**Does this work with MariaDB running in Kubernetes?**

Yes. Set `endpoint` to the MariaDB service DNS
(e.g., `mariadb.default.svc.cluster.local:3306`) and inject credentials via
a Kubernetes secret. The Collector can run as a sidecar or DaemonSet.

**What permissions does the monitoring account need?**

`PROCESS`, `REPLICATION CLIENT`, and `SELECT` on `performance_schema`. No
write access is required - the Collector only reads metrics.

**Where is per-query latency?**

The receiver exposes counters and gauges, not per-request timing.
`mysql.query.slow.count` flags queries over `long_query_time`; for digest
breakdowns enable the `mysql.statement_event.*` metrics, which read
`performance_schema` digests.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on MariaDB metrics.
- [MySQL Monitoring](./mysql.md) - The same receiver against MySQL.
- [PostgreSQL Monitoring](./postgres.md) - Alternative relational database.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MySQL](./mysql.md), [PostgreSQL](./postgres.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; adjust `collection_interval` and
  `statement_events` limits to your query workload.
