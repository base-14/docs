---
title: >
  DragonflyDB OpenTelemetry Monitoring - Command Throughput, Cache Hit
  Ratio, and Collector Setup
sidebar_label: DragonflyDB
id: collecting-dragonflydb-telemetry
sidebar_position: 56
description: >
  Collect DragonflyDB metrics with the OpenTelemetry Collector. Monitor
  command throughput, cache hit ratio, memory saturation, and
  replication link health, and ship to base14 Scout.
keywords:
  - dragonflydb opentelemetry
  - dragonflydb otel collector
  - dragonflydb metrics monitoring
  - dragonflydb performance monitoring
  - opentelemetry prometheus receiver dragonflydb
  - dragonflydb observability
  - redis compatible cache monitoring
  - dragonflydb telemetry collection
---

# DragonflyDB

DragonflyDB is a Redis-compatible in-memory data store: same Redis wire
protocol and cache model, different engine. If you already run Redis, the
cache side is familiar - what changes is the telemetry. DragonflyDB has a
**native, built-in Prometheus endpoint** served by the database process
itself on the **main port `:6379`** at `/metrics` (prefix `dragonfly_*`).
HTTP and the Redis protocol are **multiplexed on the same port**
(`--primary_port_http_enabled` is on by default), so a plain
`GET :6379/metrics` returns Prometheus text while RESP clients use the same
port - no admin port, no flag to enable, no exporter to install. The
OpenTelemetry Collector scrapes that endpoint directly with the `prometheus`
receiver and collects 105 `dragonfly_*` metrics covering command throughput,
cache hit/miss ratio, memory saturation, the request pipeline, the
shared-nothing fiber runtime, and replication link health. This guide
configures the scrape, points it at the native endpoint, and ships metrics
to base14 Scout.

This is the Redis-compatible delta on [Redis](./redis.md). Read that guide
for the cache model; read this one for what is different - the telemetry
mechanism and the single vertical-scale, shared-nothing architecture (plus
an optional primary/replica replication family).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| DragonflyDB            | 1.x     | 1.39.0+     |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- DragonflyDB must be running with its native Prometheus endpoint reachable
  on `:6379` from the host running the Collector. The endpoint is on by
  default (`--primary_port_http_enabled`); no admin port or extra flag is
  needed.
- No monitoring user or credentials - the metrics endpoint needs no Redis
  `AUTH` and is not behind `requirepass` (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

DragonflyDB speaks the Redis wire protocol, so the cache model is familiar.
What is new is the telemetry: the entire metric surface is `dragonfly_*`
served natively from `:6379/metrics`, not the `redis.*` semantic-convention
names the `redis` receiver builds from `INFO` and `COMMAND`. Because
DragonflyDB is a single vertical-scale, shared-nothing multi-threaded C++
process, there are **no `jvm_*`, `go_*`, or `process_*` runtime families** -
that whole runtime surface is absent, and in its place sit the fiber-runtime
and request-pipeline families that have no Redis analogue. A basic run is one
process with no cluster bootstrap and no replication factor; replication is
optional (`--replicaof`), and when a replica is attached the replication
family emits.

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `dragonfly_commands_processed_total` | Total commands the instance has served - the throughput liveness KPI. The native-Prometheus delta on Redis's `redis.commands`. |
| `dragonfly_connected_clients` | Current client connections - connection load and a liveness signal; it falls to near zero when nothing can reach the instance. |
| `dragonfly_keyspace_hits_total`, `dragonfly_keyspace_misses_total` | Lookups that found vs missed a key - the cache hit-ratio headline. A falling ratio means more work is reaching the slow path. |
| `dragonfly_memory_used_bytes` (vs `dragonfly_memory_max_bytes`) | Bytes the dataset occupies against the configured ceiling - the memory-saturation anchor. |
| `dragonfly_master_link_status` | Replica → primary replication link health (gauge: `1` = up). The HA headline - `0` means the replica is detached and serving stale data. Replica-only; no single-node analogue in Redis. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `dragonfly_connected_replica_lag_records` | Primary-side: how many records the replica is behind - the replication-lag / RPO signal. Rising means the replica cannot keep up. |
| `dragonfly_master_last_io_seconds_ago`, `dragonfly_master_sync_in_progress` | Replica-side: seconds since the last master I/O, and whether a full resync is running. Rising `last_io` (or a stuck `sync_in_progress`) means the stream is stalling even if the link still reports up. |
| `dragonfly_replica_reconnect_count` | Replica reconnects to the primary - churn here flags an unstable link or a flapping primary. |
| `dragonfly_expired_keys_total`, `dragonfly_db_keys_expiring` | TTL expiry rate and the count of keys carrying a TTL - sudden swings change the live working set. |
| `dragonfly_db_keys`, `dragonfly_db_capacity` | Live key count and hash-table capacity per database - dataset growth and headroom. |
| `dragonfly_blocked_clients`, `dragonfly_max_clients` | Clients parked on blocking commands, and the connection ceiling - connection-pool saturation. |
| `dragonfly_pipeline_queue_length`, `dragonfly_pipeline_queue_bytes`, `dragonfly_pipeline_throttle_total` | Request-pipeline depth and throttling - backpressure on the dispatch path; latency follows when these rise. |
| `dragonfly_memory_used_peak_bytes`, `dragonfly_used_memory_rss_bytes`, `dragonfly_swap_memory_bytes` | Peak dataset bytes, resident set, and any swap - process-level memory pressure. Sustained swap is a latency cliff. |
| `dragonfly_net_input_bytes_total`, `dragonfly_net_output_bytes_total` | Network bytes in/out - traffic volume and a saturation signal against the link. |
| `dragonfly_script_error_total`, `dragonfly_listener_accept_error_total` | Lua script failures and connection-accept errors - application-side and listener-side error signals. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity review.
In production you can drop this tier with `metric_relabel_configs` and keep
Core plus Operational. These are grouped families, not individual rows - the
counts are the distinct `dragonfly_*` names in each family of the 105 total.

| Family | Count | What it covers |
|---|---|---|
| `dragonfly_memory_*` / `used_memory` / `interned_string` / `type_used` / `swap` | 14 | Allocator occupancy, RSS, peak, per-class, interned-string dedup cache, swap. |
| `dragonfly_pipeline_*` | 13 | Request pipeline: dispatch, queue depth/wait, latency, throttle, cmd cache. DragonflyDB's request-multiplexing machinery (no Redis analogue). |
| `dragonfly_commands_*` / `cmd_squash_*` / `reply_*` / `transaction_*` | 12 | Command + reply counters/durations, the command-squashing optimizer, multi-key transaction widths. |
| replication (`master*` / `replication_*` / `slave_repl_offset` / `replica_reconnect_count` / `connected_replica_lag_records`) | 10 | Primary/replica roles, link health, sync, offset, lag, and the primary-side stream. |
| fiber / scheduler (`fiber_*` / `fibers_count` / `blocked_tasks` / `tx_queue_len` / `dispatch_queue_bytes` / `send_delay`) | 9 | The shared-nothing fiber runtime: long-running fibers, context switches, blocked tasks, transaction-queue length, send delay (no Redis analogue). |
| keyspace + db (`keyspace_*` / `db_*` / `expired_keys`) | 7 | Hits/misses/mutations, per-db keys/capacity/expiring, total expired. |
| clients / connections (`connected_clients` / `blocked_clients` / `max_clients` / `connections_*` / `client_read_buffer` / `listener_accept_error`) | 7 | Connection counts, blocking, ceiling, per-client-library split, read-buffer bytes, accept errors. |
| `dragonfly_tiered_*` | 6 | SSD offload tier: bytes/entries/events/hits/list-events/overload (reads ~0 unless tiering is configured). |
| lua (`lua_*` / `script_error`) | 6 | Lua interpreter: blocked scripts, forced GC, interpreter count, script errors. |
| backup / restore (`backups_*` / `restores_*` / `snapshot_serialization`) | 5 | Save/load operations and snapshot serialization (reads ~0 unless a save/load is triggered). |
| `dragonfly_net_*` | 4 | Network in/out bytes, receive count, reactor read-yields. |
| `dragonfly_defrag_*` | 4 | Active-defragmentation attempts/invocations/objects-moved/skipped. |
| list compression (`list_*` / `huffman_tables_built`) | 4 | List-object compression: compressed bytes, attempts, reads, Huffman tables. |
| `dragonfly_tls_*` | 2 | TLS bytes and handshakes (reads ~0 without TLS). |
| build / uptime (`version` / `uptime_in_seconds`) | 2 | Reported build version label and process uptime. |

Full metric surface: run `curl -s http://localhost:6379/metrics` against any
DragonflyDB instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `dragonfly_master_link_status` (on the replica) | `== 0` briefly | `== 0` sustained | The replication link is down; the replica is serving stale data and cannot fail over cleanly. |
| `dragonfly_connected_replica_lag_records` | Rising | Not draining | The replica is falling behind the primary; the recovery point is widening. |
| `dragonfly_master_last_io_seconds_ago` (on the replica) | Rising | Sustained climb | Master I/O is stalling even if the link still reports up; the stream is not flowing. |
| `rate(dragonfly_commands_processed_total)` | Falling under expected load | `≈ 0` sustained | The instance has stopped serving; check `dragonfly_connected_clients` and the healthcheck. |
| `dragonfly_keyspace_misses_total / (hits + misses)` | Rising vs baseline | Sustained climb | Cache hit ratio dropping, relative to the workload's normal hit ratio; review key TTLs and access patterns. |
| `dragonfly_memory_used_bytes / dragonfly_memory_max_bytes` | Rising vs baseline | Approaching 1.0 | Memory saturation; eviction or OOM risk follows. Raise the ceiling or scale out. |
| `dragonfly_blocked_clients`, or `dragonfly_connected_clients` near `dragonfly_max_clients` | Rising vs baseline | Near the ceiling | Connection-pool saturation; raise `max_clients` or fix a client connection leak. |
| `dragonfly_pipeline_queue_length`, `dragonfly_pipeline_throttle_total` | Rising | Not draining | Request-pipeline backpressure; command latency follows. |
| `rate(dragonfly_script_error_total)` | > 0 | Sustained > 0 | Lua scripts are failing; check the script and its inputs. |
| `dragonfly_swap_memory_bytes` | > 0 | Sustained > 0 | The process is swapping; expect a latency cliff. Add memory or shed dataset. |

## Access Setup

DragonflyDB's metrics endpoint needs **no exporter and no authentication**.
The native Prometheus endpoint is served by the database process itself on
the main port `:6379` at `/metrics`, multiplexed with the Redis protocol and
on by default (`--primary_port_http_enabled`). There is no admin port to
open, no flag to enable, and no sidecar to install - access setup is simply
pointing the scrape at `:6379/metrics`.

This is the structural delta over Redis. The `redis` receiver opens a TCP
connection, issues the `AUTH` command, and parses `INFO`/`COMMAND` output;
the DragonflyDB scrape is a plain HTTP `GET` on `:6379/metrics` and needs no
Redis `AUTH` - the metrics endpoint is not behind `requirepass`. There is no
JMX exporter, no Java agent, and no `INFO`/`COMMAND` parsing.

In Docker, publish or network-attach `:6379` from each instance so the
Collector can reach it. Verify the endpoint before wiring the Collector:

```bash showLineNumbers title="Verify access"
# Confirm DragonflyDB is responding on the Redis protocol
redis-cli -h localhost -p 6379 ping

# Verify the native Prometheus endpoint on the same port
curl -s http://localhost:6379/metrics | grep dragonfly_commands_processed_total
```

If you run a replica (`--replicaof=<primary-host>:6379`), expose its `:6379`
the same way - the replica serves its own `/metrics`, including the
replica-only replication family.

## Configuration

The Collector uses the `prometheus` receiver to scrape the native endpoint.
One scrape job (`job_name: dragonfly`) fans across both instances at
`metrics_path: /metrics` on `:6379` - no `redis` receiver, no
`endpoint: host:6379` block, no `AUTH` field, and no `redis.*` metrics.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: dragonfly
          scrape_interval: 15s
          metrics_path: /metrics
          static_configs:
            - targets:
                # One target per instance's native :6379 endpoint
                - dragonfly-primary:6379
                - dragonfly-replica:6379

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

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

Each instance is identified by its `instance` label (`host:6379`). The
primary carries `dragonfly_master=1` and the primary-side replication
metrics; the replica carries `dragonfly_master=0` and the replica-only
family (`dragonfly_master_link_status` and friends). For a single instance,
drop the replica target. To control metric volume in production, drop the
Diagnostic-tier families with a `metric_relabel_configs` block on the scrape
config while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable in v1.40.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped DragonflyDB metrics
docker logs otel-collector 2>&1 | grep -i "dragonfly"

# Verify the native endpoint is serving metrics
curl -s http://localhost:6379/metrics | grep dragonfly_keyspace_hits_total

# Generate traffic so keyspace and hit/miss metrics populate
redis-cli -h localhost -p 6379 set probe 1
redis-cli -h localhost -p 6379 get probe
redis-cli -h localhost -p 6379 get missing-key
```

On the replica, `dragonfly_master_link_status` should read `1` and
`dragonfly_master_sync_in_progress` should read `0` once it has caught up;
`dragonfly_master=1` on the primary and `0` on the replica confirms the role
split.

## Troubleshooting

### Metrics endpoint not responding on port 6379

**Cause**: The HTTP multiplexing on the main port is disabled, or `:6379` is
not reachable between the instance and the Collector.

**Fix**:

1. Confirm `--primary_port_http_enabled` is on (it is the default); a plain
   `curl -s http://localhost:6379/metrics` should return Prometheus text.
2. Confirm the Collector scrape target points at `:6379` with
   `metrics_path: /metrics`.
3. Check firewall and Docker network rules if the Collector runs on a
   separate host.

### The replica is serving stale data

**Cause**: The replication link is down or the stream has stalled, so the
replica is no longer tracking the primary.

**Look at**: `dragonfly_master_link_status` on the replica (`0` means the
link is down), `dragonfly_master_last_io_seconds_ago` (rising means the
stream is stalling even if the link reports up), and
`dragonfly_replica_reconnect_count` (churn flags an unstable link). On the
primary, `dragonfly_connected_replica_lag_records` shows how far behind the
replica is.

**Fix**:

1. If `dragonfly_master_link_status` is `0`, check network reachability
   between the replica and the primary and the primary's health.
2. If `dragonfly_master_sync_in_progress` is stuck at `1`, a full resync is
   running; wait for it to finish or investigate why it restarts.

### Commands are slow or piling up

**Cause**: The request pipeline is saturated, or memory pressure is forcing
the process to swap.

**Look at**: the Diagnostic `dragonfly_pipeline_*` family -
`dragonfly_pipeline_queue_length` / `_queue_bytes` (dispatch backlog) and
`dragonfly_pipeline_throttle_total` (the pipeline is shedding) - plus
`dragonfly_fiber_*` and `dragonfly_send_delay_seconds` for fiber-runtime
delay. For memory, `dragonfly_used_memory_rss_bytes` and
`dragonfly_swap_memory_bytes` (sustained swap is a latency cliff).

**Fix**:

1. If pipeline queues are sustained, shed load or scale out; profile the
   commands driving the backlog.
2. If swap is non-zero, add memory or reduce the dataset before latency
   degrades further.

### Hit ratio looks low or memory keeps climbing

**Cause**: The access pattern is missing the cache, or the working set is
approaching the configured ceiling.

**Look at**: `dragonfly_keyspace_hits_total` / `dragonfly_keyspace_misses_total`
for the ratio trend, `dragonfly_memory_used_bytes` against
`dragonfly_memory_max_bytes` for the saturation fraction, and the Diagnostic
`dragonfly_memory_*` family (`dragonfly_memory_used_peak_bytes`,
`dragonfly_memory_by_class_bytes`) for where the memory is going.
`dragonfly_expired_keys_total` and `dragonfly_db_keys_expiring` show whether
TTL churn is reshaping the working set.

**Fix**:

1. Review key TTLs and sizing for the workload driving misses.
2. Raise the memory ceiling or scale out if `used` is approaching `max`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Why is there no exporter or `redis` receiver like Redis?

DragonflyDB serves a native Prometheus endpoint on the main port `:6379` at
`/metrics`, multiplexed with the Redis protocol and on by default. You scrape
it directly with the `prometheus` receiver - there is no exporter to install,
no `redis` receiver, no TCP `AUTH`, and no `INFO`/`COMMAND` parsing. The
entire metric surface is `dragonfly_*`, with no `jvm_*`, `go_*`, or
`process_*` runtime families, because DragonflyDB is a single C++ process.

### Does the metrics endpoint need a password?

No. The `/metrics` endpoint is not behind `requirepass` - the scrape is a
plain HTTP `GET` on `:6379/metrics` and needs no Redis `AUTH`. Your RESP
clients can still authenticate normally on the same port.

### Does this work with DragonflyDB running in Kubernetes?

Yes. Point the scrape `targets` at each instance's service DNS on `:6379`
(e.g., `dragonfly-primary.default.svc.cluster.local:6379`). The Collector can
run as a sidecar or a Deployment. No credentials are needed for the metrics
endpoint.

### Why are the replication metrics showing only on one instance?

The replication family is instance-scoped. The replica-only metrics
(`dragonfly_master_link_status`, `dragonfly_master_last_io_seconds_ago`,
`dragonfly_master_sync_in_progress`, `dragonfly_slave_repl_offset`,
`dragonfly_replica_reconnect_count`) emit on the replica; the primary-side
metrics (`dragonfly_connected_replica_lag_records`,
`dragonfly_replication_streaming_bytes`) emit on the primary.
`dragonfly_master` is `1` on the primary and `0` on the replica. On a single
instance with no `--replicaof`, the replication family stays quiet - this is
expected.

**Why are `dragonfly_tiered_*`, `dragonfly_tls_*`, or the backup counters
reading zero?**

They are available surface that only moves when the feature is in use:
`dragonfly_tiered_*` when SSD tiering is configured, `dragonfly_tls_*` when
TLS is enabled, and the backup/restore counters when a save/load is
triggered. They are not missing - they populate when the corresponding
feature is exercised.

## Related Guides

- [Redis Monitoring](./redis.md) - The Redis-compatible counterpart; the
  `INFO`-based `redis`-receiver guide this is the native-telemetry delta on.
- [CockroachDB Monitoring](./cockroachdb.md) - Distributed SQL database with a
  native Prometheus endpoint.
- [YugabyteDB Monitoring](./yugabytedb.md) - Distributed SQL database with a
  native Prometheus endpoint.
- [TiDB Monitoring](./tidb.md) - Distributed SQL database with per-component
  Prometheus metrics.
- [ScyllaDB Monitoring](./scylladb.md) - Cassandra-compatible store with a
  native Prometheus endpoint.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  DragonflyDB metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [ScyllaDB](./scylladb.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for incident
  investigation.
