---
date: 2026-02-17
id: collecting-mysql-telemetry
title: MySQL Database Monitoring with OpenTelemetry
sidebar_label: MySQL
description:
  Monitor MySQL with OpenTelemetry Collector. Collect database metrics,
  query performance, connections, and InnoDB stats using Scout.
keywords:
  [
    mysql monitoring,
    mysql metrics,
    database monitoring,
    opentelemetry mysql,
    mysql observability,
  ]
---

## Overview

This guide explains how to set up MySQL metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. MySQL 8.0+ instance
2. MySQL superuser access for initial setup
3. Scout Collector installed
4. Scout access credentials

## MySQL User Setup

Create a dedicated MySQL user with minimal monitoring privileges:

```sql
CREATE USER 'otel_monitor'@'%' IDENTIFIED BY '<your_password>';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'otel_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'otel_monitor'@'%';
FLUSH PRIVILEGES;
```

### Permissions Explained

| Permission | Purpose |
|---|---|
| `PROCESS` | Access to `SHOW GLOBAL STATUS` and `SHOW GLOBAL VARIABLES` |
| `REPLICATION CLIENT` | Access to `SHOW REPLICA STATUS` for replication metrics |
| `SELECT ON performance_schema.*` | Statement events, table I/O, and lock metrics |

## MySQL Configuration

Ensure your MySQL instance has `performance_schema` and slow query log
enabled for full observability:

```ini
[mysqld]
performance_schema = ON
slow_query_log = ON
long_query_time = 1
```

Test connectivity with the monitoring user:

```bash
mysql -h <mysql-host> -P <port> -u otel_monitor -p -e "SELECT version();"
```

## Scout Collector Configuration

```yaml
receivers:
  mysql:
    endpoint: <mysql-host>:3306
    username: ${MYSQL_USER}
    password: ${MYSQL_PASSWORD}
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
        value: ${ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to Base14 Scout
exporters:
  otlphttp:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [mysql]
      processors: [batch, resource]
      exporters: [otlphttp]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Verify MySQL connectivity:

   ```bash
   mysql -h ${MYSQL_HOST} -P 3306 -u otel_monitor -p \
     -e "SHOW GLOBAL STATUS LIKE 'Uptime';"
   ```

4. Check MySQL statistics:

   ```sql
   -- Check global status
   SHOW GLOBAL STATUS LIKE 'Threads_%';

   -- Check InnoDB buffer pool
   SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool%';

   -- Check slow queries
   SHOW GLOBAL STATUS LIKE 'Slow_queries';
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [MySQL Performance Schema](https://dev.mysql.com/doc/refman/8.0/en/performance-schema.html)
- [MySQL Server Status Variables](https://dev.mysql.com/doc/refman/8.0/en/server-status-variables.html)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [PostgreSQL Monitoring](./postgres.md) - Alternative database monitoring guide
- [MongoDB Monitoring](./mongodb.md) - Alternative database monitoring guide
