---
title: >
  MongoDB OpenTelemetry Monitoring — Operation Rates, Replication,
  and Collector Setup
sidebar_label: MongoDB
id: collecting-mongodb-telemetry
sidebar_position: 4
description: >
  Collect MongoDB metrics with the OpenTelemetry Collector. Monitor
  operation rates, lock activity, replication stats, and WiredTiger
  cache using the MongoDB receiver and export to base14 Scout.
keywords:
  - mongodb opentelemetry
  - mongodb otel collector
  - mongodb metrics monitoring
  - mongodb performance monitoring
  - opentelemetry mongodb receiver
  - mongodb observability
  - mongodb database monitoring
  - mongodb telemetry collection
---

# MongoDB

The OpenTelemetry Collector's MongoDB receiver collects 25+ metrics from
MongoDB 4.0+, including operation rates, lock activity, replication
throughput, WiredTiger cache reads, and operation latency. This guide
configures the receiver, sets up a monitoring user, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| MongoDB                | 4.0     | 6.0+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- MongoDB must be accessible from the host running the Collector
- A user with `clusterMonitor` role for monitoring access
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Operations**: command, query, insert, update, delete, and getmore
  rates
- **Active workload**: concurrent reads, concurrent writes
- **Locks**: acquire counts, wait times, deadlock counts
- **Replication**: replication operation rates across all operation types
- **Performance**: operation latency, page faults, WiredTiger cache reads
- **Health**: server health status, uptime

Full metric reference:
[OTel MongoDB Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/mongodbreceiver)

## Access Setup

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

**Minimum required permissions:**

- `clusterMonitor` on `admin` — required for `serverStatus`,
  `replSetGetStatus`, and database statistics
- No write permissions are needed

Test connectivity with the monitoring user:

```bash showLineNumbers
mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
  "admin?authSource=admin" --eval "db.serverStatus().ok"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mongodb:
    hosts:
      - endpoint: localhost:27017 # Update with your MongoDB host
    username: ${env:MONGO_USER}
    password: ${env:MONGO_PASSWORD}
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
      receivers: [mongodb]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
MONGO_USER=otel_monitor
MONGO_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "mongodb"

# Verify MongoDB server status
mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
  "admin?authSource=admin" --eval "db.serverStatus().ok"
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach MongoDB at the configured endpoint.

**Fix**:

1. Verify MongoDB is running: `systemctl status mongod` or
   `docker ps | grep mongo`
2. Confirm the endpoint address and port (default 27017) in your config
3. Check `bindIp` in `mongod.conf` — change to `0.0.0.0` if the
   Collector runs on a separate host

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `mongosh "mongodb://user:pass@localhost:27017/admin" --eval "db.runCommand({ping:1})"`
2. Verify the user has the `clusterMonitor` role:
   `db.getUser("otel_monitor")`
3. Check `MONGO_USER` and `MONGO_PASSWORD` environment variables

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Replication metrics showing zero

**Cause**: MongoDB is running as a standalone instance without a replica
set.

**Fix**:

1. Replication metrics (`mongodb.operation.repl.count`,
   `mongodb.repl_*_per_sec`) require a replica set configuration
2. On standalone instances, these metrics report zero — this is expected
3. Set `direct_connection: false` when monitoring a replica set

## FAQ

**Does this work with MongoDB running in Kubernetes?**

Yes. Set `endpoint` to the MongoDB service DNS
(e.g., `mongodb.default.svc.cluster.local:27017`) and inject
credentials via a Kubernetes secret. The Collector can run as a sidecar
or DaemonSet.

**How do I monitor a MongoDB replica set?**

Set `direct_connection: false` and point to the primary. Add multiple
receiver blocks for each member if you want per-node metrics:

```yaml
receivers:
  mongodb/primary:
    hosts:
      - endpoint: mongo-1:27017
    direct_connection: true
  mongodb/secondary:
    hosts:
      - endpoint: mongo-2:27017
    direct_connection: true
```

Then include both in the pipeline:
`receivers: [mongodb/primary, mongodb/secondary]`

**What permissions does the monitoring account need?**

The `clusterMonitor` role on the `admin` database. No write access is
required. The Collector only reads metrics — it does not modify MongoDB
data.

**Why are lock deadlock counts always zero?**

MongoDB uses optimistic concurrency control with WiredTiger, so
deadlocks are rare under normal workloads. Non-zero values indicate
contention issues worth investigating.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MySQL](./mysql.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your
  database workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [PostgreSQL Monitoring](./postgres.md) — Alternative database monitoring
- [CouchDB Monitoring](./couchdb.md) — Alternative document database
  monitoring
