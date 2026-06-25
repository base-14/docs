---
title: >
  MongoDB OpenTelemetry Monitoring - Operation Latency, Cache Pressure,
  and Collector Setup
sidebar_label: MongoDB
id: collecting-mongodb-telemetry
sidebar_position: 4
description: >
  Collect MongoDB metrics with the OpenTelemetry Collector. Monitor
  operation latency, WiredTiger cache pressure, connection saturation,
  and lock contention with the MongoDB receiver and ship to base14 Scout.
keywords:
  - mongodb opentelemetry
  - mongodb otel collector
  - mongodb metrics monitoring
  - mongodb performance monitoring
  - opentelemetry mongodb receiver
  - mongodb observability
  - monitor mongodb kubernetes
  - mongodb telemetry collection
---

# MongoDB

The OpenTelemetry Collector's `mongodbreceiver` connects directly to
MongoDB 4.0+ and reads `serverStatus`, `dbStats`, and `$indexStats` to
collect 40+ metrics - operation throughput and latency, WiredTiger cache
hit/miss, connection-pool use, lock and page-fault pressure, and
per-database sizing. This guide sets up a monitoring user, configures the
receiver, and ships metrics to base14 Scout.

The receiver talks to MongoDB itself, so there is no `up` target-health
metric (that one is Prometheus-receiver-only). On this path the liveness
signal is `mongodb.health` (1 = healthy) together with the receiver
scraping successfully.

## Prerequisites

| Requirement            | Minimum | Recommended          |
| ---------------------- | ------- | -------------------- |
| MongoDB                | 4.0     | 6.0+ (8.0.26)        |
| OTel Collector Contrib | 0.90.0  | 0.153.0              |
| base14 Scout           | Any     | -                    |

Before starting:

- MongoDB must be accessible from the host running the Collector.
- A monitoring user with the `clusterMonitor` role (see Access Setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

Many `mongodbreceiver` metrics are disabled by default; the
[Configuration](#configuration) block enables the curated set below.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `mongodb.health` | Server health status (1 = healthy). On this path it is the liveness signal - there is no `up`; "healthy" plus a successful scrape means the server is reachable. |
| `mongodb.operation.count` | Operations by type (insert/query/update/delete/getmore/command) - the throughput KPI. |
| `mongodb.operation.latency.time` | Operation latency by type (read/write/command), in microseconds - the latency KPI. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `mongodb.active.reads`, `mongodb.active.writes` | Concurrent active read / write operations - load and concurrency. |
| `mongodb.connection.count` | Connections by `type` (active/available/current) - connection-pool saturation. |
| `mongodb.cache.operations` | WiredTiger cache hits vs misses - rising misses mean the working set exceeds cache. |
| `mongodb.global_lock.time` | Time held in the global lock - write contention. |
| `mongodb.page_faults` | Page faults - memory pressure, the working set spilling to disk. |
| `mongodb.memory.usage` | Memory in use by `type` (resident/virtual). |
| `mongodb.cursor.count`, `mongodb.cursor.timeout.count` | Open cursors and timed-out cursors - cursor leaks or slow clients. |
| `mongodb.uptime` | Time since server start - restart detection. |
| `mongodb.operation.repl.count` | Replicated operations by type (replica sets; zero on a standalone). |

This is operation throughput and latency, not RED's full triad. The
receiver exposes **no error-rate metric** - there is no query-error
counter in `serverStatus`. Errors live in the MongoDB log / profiler,
not in these metrics. Likewise `mongodb.operation.repl.count` is a
replicated-op *count*, **not replication lag**: a replica-lag gauge needs
a separate source.

### Diagnostic - for investigation and tuning

Higher cardinality and several per-`database` families; reach for these
during an incident or capacity review.

| Group | Metrics | When you reach for it |
|---|---|---|
| Document ops | `mongodb.document.operation.count` | Documents inserted/updated/deleted/returned. |
| Network | `mongodb.network.io.receive`, `mongodb.network.io.transmit`, `mongodb.network.request.count` | Bytes in/out and request count. |
| Index stats | `mongodb.index.access.count`, `mongodb.index.count`, `mongodb.index.size` | Index usage (per collection), index count and size. |
| Per-database inventory and sizing | `mongodb.collection.count`, `mongodb.database.count`, `mongodb.object.count`, `mongodb.data.size`, `mongodb.storage.size` | Inventory and sizing per `database`. |
| Locks | `mongodb.lock.acquire.count` | Lock acquisitions by type/mode. |
| WiredTiger internals | `mongodb.wtcache.bytes.read`, `mongodb.flushes.rate`, `mongodb.operation.time` | Bytes read into cache, checkpoint flush rate, total operation time. |
| Per-second op rates | `mongodb.{commands,queries,inserts,updates,deletes,getmores}.rate` | Pre-computed per-second rates (convenience; overlap `mongodb.operation.count`). |
| Per-second replicated-op rates | `mongodb.repl_{commands,queries,inserts,updates,deletes,getmores}_per_sec` | Per-second replicated-op rates (replica sets). |
| Sessions | `mongodb.session.count` | Active server sessions. |

Full metric reference:
[OTel MongoDB Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/mongodbreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier
series. These are relative to your own baseline, not fixed absolutes -
tune them to your workload.

| Alert | Threshold | Why it matters |
|---|---|---|
| MongoDB unhealthy | `mongodb.health == 0`, or the `mongodb` receiver producing no data for > 1m | Server unhealthy or unreachable. There is no `up`, so health plus scrape success is the liveness check. Inspect the process and the receiver connection. |
| Operation latency regression | `mongodb.operation.latency.time` (read/write) rising vs baseline | Operations are slowing. Check cache misses, locks, page faults, and slow queries. |
| Connection saturation | `mongodb.connection.count{type=current}` approaching `{type=available}` | Connection pool near exhaustion; new clients get refused. Raise limits or pool better. |
| Cache pressure | `mongodb.cache.operations` miss rate rising vs baseline | The working set exceeds the WiredTiger cache; reads spill to disk. Add RAM or reduce the working set. |
| Lock contention | `rate(mongodb.global_lock.time)` rising vs baseline | Global-lock time climbing - write contention. Investigate hot collections and long-running operations. |
| Memory pressure | `rate(mongodb.page_faults)` rising vs baseline | Faulting to disk - memory-bound. Add RAM or reduce the working set. |
| Cursor timeouts | `rate(mongodb.cursor.timeout.count)` rising | Cursors timing out - leaked or slow-draining cursors. Check application cursor handling. |

## Access Setup

Create a dedicated MongoDB user with the `clusterMonitor` role:

```javascript showLineNumbers title="mongodb monitoring user setup"
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

- `clusterMonitor` on `admin` - required for `serverStatus`,
  `replSetGetStatus`, and database statistics.
- No write permissions are needed. The Collector only reads metrics; it
  does not modify MongoDB data.

Test connectivity with the monitoring user:

```bash showLineNumbers title="Verify access"
mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
  "admin?authSource=admin" --eval "db.serverStatus().ok"
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  mongodb:
    hosts:
      - endpoint: localhost:27017 # Change to your MongoDB host
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
      # Disabled by default - enable for full observability
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
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
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
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy `deployment.environment`
> is still accepted for backward compatibility.

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
# Check Collector logs for a successful MongoDB connection
docker logs otel-collector 2>&1 | grep -i "mongodb"

# Verify MongoDB server status with the monitoring user
mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
  "admin?authSource=admin" --eval "db.serverStatus().ok"
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach MongoDB at the configured endpoint.

**Fix**:

1. Verify MongoDB is running: `systemctl status mongod` or
   `docker ps | grep mongo`.
2. Confirm the endpoint address and port (default 27017) in your config.
3. Check `bindIp` in `mongod.conf` - change to `0.0.0.0` if the
   Collector runs on a separate host.

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `mongosh "mongodb://user:pass@localhost:27017/admin" --eval "db.runCommand({ping:1})"`.
2. Verify the user has the `clusterMonitor` role:
   `db.getUser("otel_monitor")`.
3. Check the `MONGO_USER` and `MONGO_PASSWORD` environment variables.

### `(Unauthorized) ... $indexStats` error in the Collector logs

**Cause**: The receiver runs `$indexStats` per collection. On the
`admin` database's internal `system.*` collections this returns
`(Unauthorized)` and the Collector logs a per-scrape error.

**Fix**: This warning is expected and safe to ignore.
`mongodb.index.access.count` is still collected for your user
collections - the message only concerns the admin internal namespaces.

### Replication metrics showing zero

**Cause**: MongoDB is running as a standalone instance without a replica
set.

**Look at**: `mongodb.operation.repl.count` and the
`mongodb.repl_*_per_sec` family - on a standalone they emit zero.

**Fix**:

1. Replication metrics require a replica-set configuration; on a
   standalone, zero is expected.
2. Set `direct_connection: false` when monitoring a replica set.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with MongoDB running in Kubernetes?**

Yes. Set `endpoint` to the MongoDB service DNS
(e.g., `mongodb.default.svc.cluster.local:27017`) and inject credentials
via a Kubernetes secret. The Collector can run as a sidecar or DaemonSet.

**How do I monitor a MongoDB replica set?**

Set `direct_connection: false` and point at the primary. For per-node
metrics, add a receiver block per member:

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
`receivers: [mongodb/primary, mongodb/secondary]`.

**What permissions does the monitoring account need?**

The `clusterMonitor` role on the `admin` database, read-only. No write
access is required - the Collector only reads metrics.

**Why is there no error-rate metric?**

`serverStatus` does not expose a query-error counter, so the receiver
has no error-rate metric. Operation throughput
(`mongodb.operation.count`) and latency
(`mongodb.operation.latency.time`) are available, but error detail comes
from the MongoDB log or the database profiler.

**Why are lock deadlock counts always zero?**

MongoDB uses optimistic concurrency control with WiredTiger, so
deadlocks are rare under normal workloads. On a standalone the lock
timing and deadlock fields (`mongodb.lock.acquire.time`,
`mongodb.lock.acquire.wait_count`, `mongodb.lock.deadlock.count`) emit
no series at all even when enabled; non-zero values indicate contention
worth investigating.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on MongoDB metrics.
- [PostgreSQL Monitoring](./postgres.md) - Relational database
  alternative.
- [MySQL Monitoring](./mysql.md) - Relational database alternative.
- [Redis Monitoring](./redis.md) - In-memory data store companion.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MySQL](./mysql.md),
  [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Adjust `collection_interval` to balance
  metric freshness against load on MongoDB and the Collector.
