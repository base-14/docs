---
title: >
  MySQL OpenTelemetry Monitoring — Query Performance, Connections,
  and Collector Setup
sidebar_label: MySQL
id: collecting-mysql-telemetry
sidebar_position: 3
description: >
  Collect MySQL metrics with the OpenTelemetry Collector. Monitor query
  performance, connections, table locks, and replication status using the
  MySQL receiver and export to base14 Scout.
keywords:
  - mysql opentelemetry
  - mysql otel collector
  - mysql metrics monitoring
  - mysql performance monitoring
  - opentelemetry mysql receiver
  - mysql observability
  - mysql database monitoring
  - mysql telemetry collection
---

# MySQL

The OpenTelemetry Collector's MySQL receiver collects 21+ metrics from
MySQL 8.0+, including query performance, connection counts, table lock
waits, replication lag, and statement event statistics. This guide
configures the receiver, sets up a monitoring user, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| MySQL                  | 8.0     | 8.0+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- MySQL must be accessible from the host running the Collector
- Superuser access for initial monitoring user creation
- `performance_schema` enabled for full metric coverage
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Connections**: connection count, connection errors, X Protocol worker
  threads
- **Queries**: command counts, query rates, slow query count, join
  operations
- **Tables**: row counts, table sizes, average row length, open cache status
- **Locks**: read/write lock wait counts and times, statement event waits
- **Replication**: SQL delay, time behind source
- **Network**: client network I/O

Full metric reference:
[OTel MySQL Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/mysqlreceiver)

## Access Setup

Create a dedicated MySQL user with minimal monitoring privileges:

```sql showLineNumbers
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<your_password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

**Minimum required permissions:**

| Permission                       | Purpose                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `PROCESS`                        | Access to `SHOW GLOBAL STATUS` and `SHOW GLOBAL VARIABLES`       |
| `REPLICATION CLIENT`             | Access to `SHOW REPLICA STATUS` for replication metrics           |
| `SELECT ON performance_schema.*` | Statement events, table I/O, and lock metrics                     |

No write permissions are needed.

Ensure `performance_schema` and slow query log are enabled:

```ini showLineNumbers title="my.cnf"
[mysqld]
performance_schema = ON
slow_query_log = ON
long_query_time = 1
```

Test connectivity with the monitoring user:

```bash showLineNumbers
mysql -h <mysql-host> -P <port> -u otel_monitor -p -e "SELECT version();"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mysql:
    endpoint: <mysql-host>:3306
    username: ${env:MYSQL_USER}
    password: ${env:MYSQL_PASSWORD}
    collection_interval: 10s
    allow_native_passwords: true

    tls:
      insecure: true
      insecure_skip_verify: true

    metrics:
      # Disabled by default — enable for full observability
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
      receivers: [mysql]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

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
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "mysql"

# Verify MySQL connectivity
mysql -h ${MYSQL_HOST} -P 3306 -u otel_monitor -p \
  -e "SHOW GLOBAL STATUS LIKE 'Uptime';"
```

```sql showLineNumbers
-- Check global status
SHOW GLOBAL STATUS LIKE 'Threads_%';

-- Check InnoDB buffer pool
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';

-- Check slow queries
SHOW GLOBAL STATUS LIKE 'Slow_queries';
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach MySQL at the configured endpoint.

**Fix**:

1. Verify MySQL is running: `systemctl status mysql` or
   `docker ps | grep mysql`
2. Confirm the endpoint address and port (default 3306) in your config
3. Check `bind-address` in `my.cnf` — change to `0.0.0.0` if the
   Collector runs on a separate host

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `mysql -h localhost -u otel_monitor -p -e "SELECT 1;"`
2. Verify the user has the required grants:
   `SHOW GRANTS FOR 'otel_monitor'@'%';`
3. Check `MYSQL_USER` and `MYSQL_PASSWORD` environment variables

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Statement event metrics always zero

**Cause**: `performance_schema` is disabled or statement instrumentation
is not active.

**Fix**:

1. Verify `performance_schema` is enabled:
   `SHOW VARIABLES LIKE 'performance_schema';`
2. Check statement instrumentation:
   `SELECT * FROM performance_schema.setup_consumers WHERE name LIKE 'events_statements%';`
3. Enable consumers if needed:
   `UPDATE performance_schema.setup_consumers SET ENABLED = 'YES'`
   `WHERE name LIKE 'events_statements%';`

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
`receivers: [mysql/primary, mysql/replica]`

**What permissions does the monitoring account need?**

`PROCESS`, `REPLICATION CLIENT`, and `SELECT` on `performance_schema`.
No write access is required. The Collector only reads metrics — it does
not modify MySQL data.

**Why are replication metrics showing zero?**

`mysql.replica.sql_delay` and `mysql.replica.time_behind_source` require
MySQL to be configured as a replica. On a standalone instance or primary
server, these metrics report zero — this is expected behavior.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MongoDB](./mongodb.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` and
  `statement_events` limits based on your query workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [PostgreSQL Monitoring](./postgres.md) — Alternative database monitoring
- [MongoDB Monitoring](./mongodb.md) — Alternative database monitoring
