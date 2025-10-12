---
date: 2025-10-08
id: collecting-postgres-telemetry
title: PostgreSQL Database Monitoring with OpenTelemetry
description:
  Monitor PostgreSQL with OpenTelemetry Collector. Collect database metrics,
  query performance, connections, and stats using Scout.
keywords:
  [
    postgresql monitoring,
    postgres metrics,
    database monitoring,
    opentelemetry postgresql,
    postgres observability,
  ]
---

## Overview

This guide explains how to set up PostgreSQL metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. PostgreSQL instance (standalone or cluster)
2. PostgreSQL superuser access for initial setup
3. Scout Collector installed

## PostgreSQL User Setup

Create a dedicated PostgreSQL user with monitoring privileges:

```sql
-- Connect as superuser (postgres)
CREATE USER postgres_exporter WITH PASSWORD '<your_password>';
GRANT pg_monitor TO postgres_exporter;
```

The `pg_monitor` role provides access to all the statistics views and functions
needed for monitoring without requiring superuser privileges.

## PostgreSQL Configuration

Ensure your PostgreSQL instance allows connections and has the required
statistics enabled:

```sql
-- Verify pg_stat_statements extension (optional but recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Check current connections
SELECT count(*) FROM pg_stat_activity;
```

Test connectivity with the monitoring user:

```bash
# Test PostgreSQL connectivity
psql -h <postgres-host> -p <port> -U postgres_exporter -d <database-name> -c "SELECT version();"
```

## Scout Collector Configuration

```yaml
receivers:
  postgresql:
    endpoint: "<postgres-endpoint>:<port>"
    collection_interval: 10s
    username: "postgres_exporter"
    password: "<your_password>"
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
      receivers: [postgresql]
      processors: [batch, resource]
      exporters: [otlphttp]
```

## Verification

1. Check collector logs for errors:
2. Verify metrics in Scout dashboard
3. Verify PostgreSQL connectivity:

   ```bash
   # Test PostgreSQL connection
   psql -h ${POSTGRES_HOST} -p <port> -U postgres_exporter -d ${DATABASE_NAME} -c "SELECT version();"
   ```

4. Check PostgreSQL statistics:

   ```sql
   -- Check database statistics
   SELECT * FROM pg_stat_database WHERE datname = '<your-database>';

   -- Check table statistics
   SELECT * FROM pg_stat_user_tables LIMIT 5;

   -- Check index usage
   SELECT * FROM pg_stat_user_indexes LIMIT 5;
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [PostgreSQL Monitoring Views](https://www.postgresql.org/docs/current/monitoring-stats.html)
- [pg_monitor Role Documentation](https://www.postgresql.org/docs/current/default-roles.html)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [MongoDB Monitoring](./mongodb.md) - Alternative database monitoring guide
