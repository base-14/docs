---
title: MongoDB Database Monitoring with OpenTelemetry
sidebar_label: MongoDB
id: collecting-mongodb-telemetry
sidebar_position: 4
description:
  Monitor MongoDB with OpenTelemetry Collector. Collect database metrics,
  replica set stats, and performance data using Scout.
keywords:
  [
    mongodb monitoring,
    mongodb metrics,
    database monitoring,
    opentelemetry mongodb,
    mongodb observability,
  ]
---

# MongoDB

## Overview

This guide explains how to set up MongoDB metrics collection using OTel
Collector and forward them to Scout backend.

## Prerequisites

1. MongoDB instance (standalone or replica set)
2. MongoDB user with `clusterMonitor` role
3. Scout Collector installed
4. Scout access credentials

## MongoDB User Setup

Create a dedicated MongoDB user with the `clusterMonitor` role:

```javascript showLineNumbers
use admin
db.createUser({
  user: "${MONGO_USER}",
  pwd: "${MONGO_PASSWORD}",
  roles: [
    { role: "clusterMonitor", db: "admin" },
  ]
})
```

## Otel Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mongodb:
    hosts:
      - endpoint: localhost:27017 # Update with your MongoDB host
    username: ${MONGO_USER}
    password: ${MONGO_PASSWORD}
    collection_interval: 60s
    timeout: 10s

    # TLS Configuration
    tls:
      insecure: true
      insecure_skip_verify: true

    direct_connection: true # false for replica sets

    metrics:
      # Disabled by default — enable for full observability
      mongodb.uptime:
        enabled: true
      mongodb.active.reads:
        enabled: true
      mongodb.active.writes:
        enabled: true
      mongodb.commands.rate:
        enabled: true
      mongodb.deletes.rate:
        enabled: true
      mongodb.flushes.rate:
        enabled: true
      mongodb.getmores.rate:
        enabled: true
      mongodb.health:
        enabled: true
      mongodb.inserts.rate:
        enabled: true
      mongodb.lock.acquire.count:
        enabled: true
      mongodb.lock.acquire.time:
        enabled: true
      mongodb.lock.acquire.wait_count:
        enabled: true
      mongodb.lock.deadlock.count:
        enabled: true
      mongodb.operation.latency.time:
        enabled: true
      mongodb.operation.repl.count:
        enabled: true
      mongodb.page_faults:
        enabled: true
      mongodb.queries.rate:
        enabled: true
      mongodb.repl_commands_per_sec:
        enabled: true
      mongodb.repl_deletes_per_sec:
        enabled: true
      mongodb.repl_getmores_per_sec:
        enabled: true
      mongodb.repl_inserts_per_sec:
        enabled: true
      mongodb.repl_queries_per_sec:
        enabled: true
      mongodb.repl_updates_per_sec:
        enabled: true
      mongodb.updates.rate:
        enabled: true
      mongodb.wtcache.bytes.read:
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

# Export to Scout Collector
exporters:
  otlphttp/b14:
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [mongodb]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test MongoDB connectivity:

   ```bash showLineNumbers
   mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
     "admin?authSource=admin" --eval "db.serverStatus().ok"
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [PostgreSQL Monitoring](./postgres.md) - Alternative database monitoring guide
