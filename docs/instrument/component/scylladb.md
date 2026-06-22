---
title: >
  ScyllaDB OpenTelemetry Monitoring - CQL Throughput, Coordinator
  Latency, and Collector Setup
sidebar_label: ScyllaDB
id: collecting-scylladb-telemetry
sidebar_position: 55
description: >
  Collect ScyllaDB metrics with the OpenTelemetry Collector. Monitor CQL
  throughput, coordinator read/write latency, gossip membership, and
  hinted-handoff backlog, and ship to base14 Scout.
keywords:
  - scylladb opentelemetry
  - scylladb otel collector
  - scylladb metrics monitoring
  - scylladb performance monitoring
  - opentelemetry prometheus receiver scylladb
  - scylladb observability
  - cassandra compatible database monitoring
  - scylladb telemetry collection
---

# ScyllaDB

ScyllaDB is a C++/seastar rewrite of Cassandra: same CQL wire protocol and
data model, different engine. If you already run Cassandra, the query side
is familiar - what changes is the telemetry. ScyllaDB has **no JVM, no JMX,
and no Prometheus JMX-exporter sidecar**. The database process serves a
**native, built-in Prometheus endpoint** on port `:9180` at `/metrics`
(prefix `scylla_*`). The OpenTelemetry Collector scrapes that endpoint
directly with the `prometheus` receiver - one scrape job fanning across the
cluster - and collects 460+ `scylla_*` metrics covering CQL throughput,
coordinator latency, gossip membership, compaction, and the seastar
shard-per-core runtime. This guide configures the scrape, exposes the native
endpoint, and ships metrics to base14 Scout.

This is the Cassandra-compatible delta on [Cassandra](./cassandra.md). Read
that guide for the CQL model; read this one for what is different - the
telemetry mechanism and the seastar architecture.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| ScyllaDB               | 5.0     | 2026.1+     |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- ScyllaDB must be running with its native Prometheus endpoint reachable on
  `:9180` from the host running the Collector.
- No monitoring user or credentials - the metrics endpoint needs no
  authentication (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

ScyllaDB speaks the Cassandra CQL protocol, so the query model is familiar.
What is new is the telemetry: every series is `scylla_*` (there are no
`jvm_*`, `go_*`, or `process_*` runtime families, because the engine is
C++/seastar, not a JVM), and every series carries a `shard` label.
seastar is shard-per-core, so each CPU core is one shard: a single-core node
has one `shard="0"`, and a multi-core node fans the same metric out to one
series per core. That `shard` label has no Cassandra analogue and shapes how
you read saturation.

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `scylla_node_operation_mode` | The node's lifecycle state (`NORMAL` when fully serving; any other value while starting, joining, leaving, draining, or in maintenance). The per-node "is this node in the cluster and serving" headline, surfaced natively - no JMX/JVM analogue. |
| `scylla_cql_reads`, `scylla_cql_inserts`, `scylla_cql_updates`, `scylla_cql_deletes` | CQL operations served on this node, split by statement type - the headline throughput KPI. The native-Prometheus delta on Cassandra's JMX `clientrequest` Read/Write counts (also broken out per keyspace by `scylla_cql_*_per_ks`). |
| `scylla_gossip_live`, `scylla_gossip_unreachable` | Cluster membership as this node sees it over gossip: peers live vs unreachable. `unreachable > 0` means a peer is down or partitioned - the signature distributed-cluster health signal. |
| `scylla_storage_proxy_coordinator_write_latency`, `scylla_storage_proxy_coordinator_read_latency` | Client-request latency at the coordinator - the path a CQL client actually waits on, across replicas. The user-facing latency headline (the `_latency_summary` variants carry quantiles). |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `scylla_database_total_writes_failed`, `scylla_database_total_reads_failed` | Writes/reads that failed at the replica - the reliability SLI. Should track ~0 against the `total_writes` / `total_reads` rate. |
| `scylla_database_total_writes_timedout` | Writes that did not get enough replica acks within the timeout - replica slowness or a partial outage at the chosen consistency level. |
| `scylla_database_total_writes_rate_limited`, `scylla_database_total_reads_rate_limited` | Operations rejected by per-partition rate limiting - a hot partition being shed. |
| `scylla_transport_cql_errors_total` | CQL native-protocol errors returned to clients - the transport layer underneath the per-statement counters. |
| `scylla_hints_manager_pending_sends`, `scylla_hints_manager_size_of_hints_in_progress` | Hinted-handoff backlog: a replica was unreachable, so writes are stored for replay. Rising means a node is down and the cluster is buffering for it - a distributed signal with no single-node analogue. |
| `scylla_compaction_manager_pending_compactions`, `scylla_compaction_manager_backlog` | Compaction falling behind - read amplification and disk growth follow. |
| `scylla_reactor_utilization` | Per-shard seastar reactor busy fraction - the shard-per-core saturation signal. A single hot shard caps throughput even when the node looks idle in aggregate. No Cassandra analogue. |
| `scylla_storage_proxy_coordinator_current_throttled_writes` | Writes the coordinator is throttling - backpressure from overloaded replicas or materialized-view flow control. |
| `scylla_cache_partition_hits`, `scylla_cache_partition_misses` | Row-cache hit ratio. A falling ratio pushes reads to SSTables and drives read latency and disk IO. |
| `scylla_commitlog_pending_flushes`, `scylla_commitlog_requests_blocked_memory` | Commitlog flush backlog and writers blocked on commitlog memory - write-path stalls. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity review.
In production you can drop this tier with `metric_relabel_configs` and keep
Core plus Operational. These are grouped families, not individual rows - the
counts are the distinct `scylla_*` names in each family of the 464 total.

| Family | Count | What it covers |
|---|---|---|
| `scylla_database_*` | 48 | Top-level read/write totals, reliability (failed/timedout/rate-limited), querier, multishard query, view-update push/fail. |
| `scylla_sstables_*` | 45 | On-disk read/write, index and promoted-index page cache, bloom filters, partition/row/range scans. |
| `scylla_cache_*` | 35 | Unified row cache: hits/misses/evictions/insertions/removals, tombstone reads, bytes. |
| `scylla_reactor_*` | 30 | Per-shard seastar reactor: utilization, stalls, CPU, AIO. |
| `scylla_storage_proxy_*` | 25 | Coordinator and replica request paths, speculative reads, LWT/CAS, view-update backlog. |
| `scylla_raft_*` | 24 | Raft consensus for cluster metadata / group0 / tablets. |
| `scylla_cql_*` | 24 | CQL statement counters (reads/inserts/updates/deletes, batches), including per-keyspace. |
| `scylla_hints_*` | 22 | Hinted handoff: pending sends/drains, written/sent, errors, in-progress size. |
| `scylla_schema_commitlog_*` | 20 | Dedicated commitlog for schema changes. |
| `scylla_commitlog_*` | 20 | Data write-ahead log: segments, pending flushes, disk/memory bytes. |
| `scylla_io_queue_*` | 19 | Per-shard IO scheduler: delay, disk queue length, operations. |
| `scylla_memory_*` | 16 | Seastar allocator: allocated/free memory, malloc failures, reclaim. |
| `scylla_transport_*` | 15 | CQL native protocol: connections, in-flight requests, memory, errors. |
| `scylla_lsa_*` | 13 | Log-structured allocator occupancy/compaction. |
| `scylla_column_family_*` | 13 | Per-table SSTable/memtable/read/write (carries `cf`/`ks`; high cardinality in wide schemas). |
| `scylla_load_balancer_*` | 10 | Tablet load-balancing decisions. |
| `scylla_tracing_*` | 10 | Request tracing sink to `system_traces`. |
| `scylla_view_*` | 8 | Materialized-view update generator pipeline (`view_update` / `view_builder`). |
| `scylla_compaction_manager_*` | 8 | Compaction: pending/completed/failed, backlog. |
| `scylla_scheduler_*` | 7 | Per-shard task scheduler: runtime, wait, starvation, quota violations. |
| `scylla_rpc_*` | 7 | Inter-node messaging-service RPC client. |
| remaining (`scylla_gossip_*`, `scylla_streaming_*`, `scylla_memtables_*`, `scylla_node_*`, `scylla_tablet*`, `scylla_per_partition_rate_limiter_*`, `scylla_httpd_*`, `scylla_execution_stages_*`, `scylla_mapreduce_service_*`, `scylla_alien_*`, ...) | ~57 | Gossip membership, data streaming, memtable flush, node ops, tablets, per-partition rate limiter, REST httpd, execution stages, map-reduce aggregation, cross-shard alien queues. |

Full metric surface: run `curl -s http://localhost:9180/metrics` against any
ScyllaDB node.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `scylla_node_operation_mode` (per node) | != `NORMAL` briefly | != `NORMAL` sustained | The node is joining, draining, or stuck rather than serving. Check the node and its gossip view. |
| `scylla_gossip_unreachable` (per node) | > 0 briefly | > 0 sustained | A peer is unreachable (down or partitioned); confirm with `nodetool status`. |
| `rate(scylla_cql_reads) + rate(scylla_cql_inserts)` | Falling under expected load | ≈ 0 sustained | The node has stopped serving CQL; check `scylla_node_operation_mode` and gossip. |
| `rate(scylla_database_total_writes_failed) / rate(scylla_database_total_writes)` | Rising vs baseline | Sustained climb | Write failures climbing relative to the workload's normal failure ratio. |
| `scylla_database_total_writes_timedout` | Increasing | Rising across scrapes | Writes not acked within timeout; a replica is slow or down at the chosen consistency level. |
| `scylla_storage_proxy_coordinator_write_latency` / `_read_latency` p99 | Above baseline | Well above baseline | Coordinator latency regression, relative to the workload's normal p99. |
| `scylla_hints_manager_pending_sends` | > 0 sustained | Not draining | A replica is down and hints are accumulating; the cluster is healing, not healed. |
| `scylla_compaction_manager_pending_compactions` / `_backlog` | Rising | Not draining | Compaction cannot keep up; read amplification and disk growth follow. |
| `scylla_reactor_utilization` (per shard) | Near 1.0 briefly | Near 1.0 sustained | That shard is saturated; throughput is shard-bound even if the node looks idle in aggregate. |
| `scylla_cache_partition_misses / (_hits + _misses)` | Rising | Sustained climb | Row-cache hit ratio dropping; reads are spilling to SSTables. |
| `scylla_commitlog_requests_blocked_memory` | > 0 | Sustained > 0 | Writers blocked on commitlog memory; the write path is stalling. |

## Access Setup

ScyllaDB's metrics endpoint needs **no exporter and no authentication**. The
native Prometheus endpoint is served by the database process itself - this is
the structural delta over Cassandra, where you download a JMX exporter JAR,
add a `-javaagent` flag, and scrape it on `:9404`. None of that applies here:
there is no JAR, no agent flag, and no CQL auth for metrics. Expose the
native endpoint instead.

ScyllaDB serves `/metrics` on port `:9180` by default. Two `scylla.yaml`
settings control it:

```yaml showLineNumbers title="scylla.yaml (excerpt)"
# Port for the native Prometheus metrics endpoint (default 9180).
prometheus_port: 9180

# Address the metrics endpoint binds to. Bind to the node's listen
# address (or 0.0.0.0) so the Collector can reach it; leaving it on
# loopback hides it from a Collector on another host.
prometheus_address: 0.0.0.0
```

In Docker, publish or network-attach `:9180` from each node so the Collector
can reach it. Verify the endpoint before wiring the Collector:

```bash showLineNumbers title="Verify access"
# Confirm the node is serving and NORMAL
nodetool status

# Verify the native Prometheus endpoint
curl -s http://localhost:9180/metrics | grep scylla_node_operation_mode
```

## Configuration

The Collector uses the `prometheus` receiver to scrape the native endpoint.
One scrape job (`job_name: scylla`) fans across every node at
`metrics_path: /metrics` on `:9180` - no JMX exporter, no `:9404` target, no
`jmx-config.yaml`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: scylla
          scrape_interval: 15s
          metrics_path: /metrics
          static_configs:
            - targets:
                # One target per node's native :9180 endpoint
                - scylla1:9180
                - scylla2:9180
                - scylla3:9180

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

Each node is identified by its `instance` label (`host:9180`). To control
metric volume in production, drop the Diagnostic-tier families with a
`metric_relabel_configs` block on the scrape config while keeping the Core and
Operational series.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute. The legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped ScyllaDB metrics
docker logs otel-collector 2>&1 | grep -i "scylla"

# Verify the native endpoint is serving metrics
curl -s http://localhost:9180/metrics | grep scylla_cql_reads

# Confirm the node is in the cluster and serving
nodetool status
```

`scylla_node_operation_mode` should read `NORMAL` on every serving node, and
`scylla_gossip_unreachable` should be `0` in a healthy cluster.

## Troubleshooting

### Metrics endpoint not responding on port 9180

**Cause**: The native Prometheus endpoint is bound to loopback or the port is
blocked between the node and the Collector.

**Fix**:

1. Confirm `prometheus_address` in `scylla.yaml` binds the node's reachable
   address (or `0.0.0.0`), not loopback.
2. Confirm `prometheus_port` matches the Collector scrape target (`:9180`).
3. Check firewall and Docker network rules if the Collector runs on a
   separate host.

### A node is not serving CQL

**Cause**: The node is joining, draining, or stuck rather than `NORMAL`, or it
cannot see its peers.

**Look at**: `scylla_node_operation_mode` (any value other than `NORMAL` means
it is not fully serving) and `scylla_gossip_unreachable` (a non-zero count
means a peer is down or partitioned). Confirm with `nodetool status`.

**Fix**:

1. If `scylla_node_operation_mode` is not `NORMAL`, wait for the join/drain
   to finish or investigate the node's startup logs.
2. If `scylla_gossip_unreachable > 0`, find the unreachable peer and restore
   it; hints (`scylla_hints_manager_pending_sends`) will replay buffered
   writes once it returns.

### Writes are timing out or failing

**Cause**: A replica is slow or down at the chosen consistency level, or the
coordinator is throttling under backpressure.

**Look at**: `scylla_database_total_writes_timedout` and
`scylla_database_total_writes_failed` (the reliability SLI), and the
Diagnostic `scylla_storage_proxy_*` coordinator/replica paths plus
`scylla_storage_proxy_coordinator_current_throttled_writes` for backpressure.

**Fix**:

1. Restore or speed up the slow replica; check its gossip and operation mode.
2. If the coordinator is throttling, investigate overloaded replicas or
   materialized-view flow control.

### A shard is saturated but the node looks idle

**Cause**: seastar is shard-per-core - one hot shard caps throughput even when
the node's aggregate CPU looks free.

**Look at**: `scylla_reactor_utilization` per `shard` (near 1.0 on one shard
is the signal), and the Diagnostic `scylla_scheduler_*` and `scylla_io_queue_*`
families for where that shard's time is going.

**Fix**:

1. Identify the hot partition or skewed key driving the shard; rebalance the
   workload or schema.
2. Confirm core count and `--smp` settings match the node's CPU allocation.

### Reads are slow and disk IO is climbing

**Cause**: The row cache is missing more often, pushing reads to SSTables, or
compaction is falling behind.

**Look at**: `scylla_cache_partition_hits` / `_misses` (the hit ratio), and
the Diagnostic `scylla_compaction_manager_*` and `scylla_sstables_*` families
for compaction backlog and on-disk read amplification.

**Fix**:

1. If the cache hit ratio is dropping, review working-set size and query
   patterns.
2. If `scylla_compaction_manager_pending_compactions` / `_backlog` is rising
   and not draining, add IO capacity or tune the compaction strategy.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why is there no exporter or JMX agent like Cassandra?**

ScyllaDB is a C++/seastar rewrite of Cassandra, so there is no JVM and no JMX.
The database process serves a native Prometheus endpoint on `:9180` at
`/metrics`. You scrape it directly with the `prometheus` receiver - there is no
JAR to download, no `-javaagent` flag, and no `:9404` exporter. The entire
metric surface is `scylla_*`, with no `jvm_*`, `go_*`, or `process_*` runtime
families.

**What is the `shard` label on every metric?**

seastar is shard-per-core: each CPU core is one shard, with its own thread,
memory, and IO queue. A single-core node has one `shard="0"`; a multi-core
node emits the same metric once per core. Read saturation per shard
(`scylla_reactor_utilization`), not just per node - a single hot shard caps
throughput while the node's aggregate CPU looks idle.

**Does this work with ScyllaDB running in Kubernetes?**

Yes. Point the scrape `targets` at each node's service DNS on `:9180`
(e.g., `scylla-0.scylla.default.svc.cluster.local:9180`). The Collector can
run as a sidecar or a Deployment. No credentials are needed for the metrics
endpoint.

**How do I monitor a multi-node ScyllaDB cluster?**

Add every node's `:9180` endpoint to the single `scylla` scrape job's
`targets` list. Each node is scraped independently and identified by its
`instance` label, and seastar's `shard` label separates per-core series within
each node.

**Why are some metric families reading zero?**

Families like `scylla_streaming_*`, `scylla_view_*`, and
`scylla_load_balancer_*` only move on topology change or when materialized
views or LWT are in use. They are available surface, not missing - they will
populate when the corresponding operation runs.

## Related Guides

- [Cassandra Monitoring](./cassandra.md) - The Cassandra-compatible
  counterpart; the JMX-exporter guide this is the native-telemetry delta on.
- [CockroachDB Monitoring](./cockroachdb.md) - Distributed SQL database with a
  native Prometheus endpoint.
- [YugabyteDB Monitoring](./yugabytedb.md) - Distributed SQL database that also
  speaks the CQL protocol.
- [TiDB Monitoring](./tidb.md) - Distributed SQL database with per-component
  Prometheus metrics.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  ScyllaDB metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Cassandra](./cassandra.md), [CockroachDB](./cockroachdb.md), and other
  distributed databases.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for incident
  investigation.
