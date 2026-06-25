---
title: >
  Cassandra OpenTelemetry Monitoring - Client Request Latency,
  Compaction, and Collector Setup
sidebar_label: Cassandra
id: collecting-cassandra-telemetry
description: >
  Collect Cassandra metrics with the OpenTelemetry Collector. Monitor
  client request latency, compaction backlog, and thread-pool saturation
  via the Prometheus JMX exporter and ship to base14 Scout.
keywords:
  - cassandra opentelemetry
  - cassandra otel collector
  - cassandra metrics monitoring
  - cassandra performance monitoring
  - opentelemetry prometheus receiver cassandra
  - cassandra observability
  - monitor cassandra kubernetes
  - cassandra telemetry collection
sidebar_position: 21
---

# Cassandra

The OpenTelemetry Collector scrapes a Prometheus JMX exporter to collect
320+ Cassandra metrics - coordinator read/write latency, request errors,
compaction backlog, thread-pool saturation, storage load, and JVM
health - from Cassandra 3.11+. Cassandra exposes its internals as JMX
MBeans with no HTTP endpoint, so the `jmx_prometheus_javaagent` runs
inside the Cassandra JVM and publishes them in Prometheus format on port
9404. The native `prometheus` receiver scrapes that endpoint. This guide
configures the exporter agent and receiver and ships metrics to base14
Scout.

## Prerequisites

| Requirement              | Minimum | Recommended |
| ------------------------ | ------- | ----------- |
| Cassandra                | 3.11    | 5.0         |
| jmx_prometheus_javaagent | 0.20.0  | 1.5.0       |
| OTel Collector Contrib   | 0.90.0  | 0.153.0     |
| base14 Scout             | Any     | -           |

Before starting:

- Cassandra must be running with at least one keyspace and table
  receiving traffic.
- Download the
  [`jmx_prometheus_javaagent`](https://github.com/prometheus/jmx_exporter/releases)
  JAR; it loads into the Cassandra JVM (see [Access Setup](#access-setup)).
- The exporter port (9404) must be reachable from the host running the
  Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

The metric *names* below are produced by the exporter's `jmx-config.yaml`
rules (shown in [Access Setup](#access-setup)), not by a fixed receiver
schema. Counters carry the `_total` suffix added by the exporter for the
COUNTER type, so a request count appears as `..._count_total`.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - Cassandra's JMX endpoint is reachable. This is the liveness signal; the `prometheus` receiver sets it to `1` when the scrape lands. |
| `cassandra_clientrequest_latency_seconds` | Coordinator read/write latency percentiles (Summary; `scope=Read`/`Write`/`CAS…`, `quantile` label) - the headline latency KPI. |
| `cassandra_clientrequest_latency_count_total` | Coordinator request count per `scope`; its rate is read/write throughput. |
| `cassandra_clientrequest_timeouts_count_total` | Requests that timed out - client-facing errors per `scope`. |
| `cassandra_clientrequest_unavailables_count_total` | Requests that failed for insufficient replicas - client-facing errors per `scope`. |
| `cassandra_clientrequest_failures_count_total` | Requests that errored - client-facing errors per `scope`. |

The error rate is the rate of the `timeouts` / `unavailables` /
`failures` `_count_total` counters per `scope`.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `cassandra_compaction_pendingtasks` | Queued compactions; rising means compaction is falling behind and read amplification grows. |
| `cassandra_threadpool_pendingtasks` | Queued tasks per internal pool (`path`, `pool`) - backpressure on a stage. |
| `cassandra_threadpool_currentlyblockedtasks_count_total` | Tasks blocked because a pool queue was full (saturation). |
| `cassandra_droppedmessage_dropped_count_total` | Messages dropped under overload, per `verb` (mutation/read/…). |
| `cassandra_commitlog_pendingtasks` | Pending commit-log tasks - write-path backpressure. |
| `cassandra_storage_load_count_total` | Live data size on this node (capacity and balance). |
| `cassandra_storage_exceptions_count_total` | Unhandled storage exceptions. |
| `cassandra_cache_hitrate` | Key / row / counter cache hit rate per `cache` - read efficiency. |
| `cassandra_table_livediskspaceused` | Live disk used per table (`keyspace`, `table`). |
| `cassandra_table_pendingflushes` | Memtable flushes queued per table - write-path backlog. |
| `jvm_memory_used_bytes` | JVM heap / non-heap used per `area`; heap pressure drives GC, which drives latency. |
| `jvm_gc_collection_seconds` | GC collection time per collector (`gc`) - pause pressure. |

### Diagnostic - for investigation and tuning

Higher cardinality; enable on demand. The two large per-table and
per-keyspace families dominate this tier - in production you can drop it
with `metric_relabel_configs` and keep Core + Operational (see
[Filtering Metrics](#filtering-metrics)).

| Group | Metrics | When you reach for it |
|---|---|---|
| Per-table internals | `cassandra_table_*` (119; `keyspace`, `table`) | Read/write latency, bloom filter, SSTable counts, tombstones, partition sizes, and repair, per table. |
| Per-keyspace rollups | `cassandra_keyspace_*` (84; `keyspace`) | Keyspace-level rollups of the table metrics. |
| Client-request detail | `cassandra_clientrequest_*` (rest; `scope`) | CAS/paxos, view-write, speculative-retry, contention, and request-size histograms. |
| CQL statements | `cassandra_cql_*` (10) | Prepared vs regular statement counts and prepared-statement cache. |
| Cache / commit-log / compaction detail | `cassandra_cache_*` (rest), `cassandra_commitlog_*`, `cassandra_compaction_*` (rest) | Cache size/entries, commit-log size, compaction bytes and throughput. |
| JVM internals | `jvm_*` (rest, ~28) | Memory pools, buffer pools, classes, and threads. |

Full metric list: run `curl -s http://localhost:9404/metrics` against a
Cassandra node with the exporter agent loaded.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `up` | - | `== 0` for > 1m | JMX endpoint unreachable - node down, agent off, or network. Check the process and `:9404`. |
| `cassandra_clientrequest_latency_seconds{scope="Read"/"Write"}` (p99) | Rising vs baseline | Sustained regression | Coordinator latency climbing; check GC, compaction backlog, disk, and replica health. |
| `rate(cassandra_clientrequest_timeouts_count_total)` / `unavailables` / `failures` | > 0 | Rising | Requests failing client-side; check replica availability, consistency level, and node health. |
| `cassandra_compaction_pendingtasks` | Rising vs baseline | Sustained growth | Compactions queueing; read amplification and disk grow. Check compaction throughput and IO. |
| `rate(cassandra_droppedmessage_dropped_count_total)` | > 0 | Sustained > 0 | Node overloaded and shedding work. Reduce load or scale out. |
| `cassandra_threadpool_pendingtasks` / `currentlyblockedtasks_count_total` | Rising | Sustained growth | An internal stage is backed up; identify the pool and its bottleneck. |
| `rate(jvm_gc_collection_seconds_sum)` / `jvm_memory_used_bytes` | Elevated | Near `jvm_memory_max_bytes` | Heap pressure causing GC pauses → latency. Tune heap / GC or add capacity. |

## Access Setup

The Prometheus JMX exporter runs as a Java agent inside the Cassandra
process. No authentication is required - the agent reads JMX MBeans
directly from within the JVM, so there is no remote JMX connection to
secure.

### 1. Download the JMX exporter agent

```bash showLineNumbers title="Download the agent JAR"
curl -L -o jmx_prometheus_javaagent.jar \
  https://github.com/prometheus/jmx_exporter/releases/download/1.5.0/jmx_prometheus_javaagent-1.5.0.jar
```

### 2. Create the exporter configuration

The exporter uses pattern rules to select JMX MBeans and shape them into
Prometheus metrics - these rules are what produce the metric names in
[What You'll Monitor](#what-youll-monitor). This config maps the
ClientRequest and Table latency timers to percentiles via a `quantile`
label in `_seconds`, types the counts as counters (so they get the
`_total` suffix), and relies on the agent's built-in JVM collector for
the standard `jvm_*` names.

```yaml showLineNumbers title="jmx-config.yaml"
lowercaseOutputName: true
lowercaseOutputLabelNames: true
rules:
  # --- ClientRequest timers: latency percentiles -> quantile label ---
  - pattern: org.apache.cassandra.metrics<type=ClientRequest, scope=(.+), name=(.+)><>(\d+)thPercentile
    name: cassandra_clientrequest_$2_seconds
    labels:
      scope: "$1"
      quantile: "0.$3"
    type: GAUGE
    valueFactor: 0.000001
  # --- ClientRequest timers/counters: total count (monotonic) ---
  - pattern: org.apache.cassandra.metrics<type=ClientRequest, scope=(.+), name=(.+)><>Count
    name: cassandra_clientrequest_$2_count
    labels:
      scope: "$1"
    type: COUNTER
  # --- ClientRequest timers: one-minute rate ---
  - pattern: org.apache.cassandra.metrics<type=ClientRequest, scope=(.+), name=(.+)><>OneMinuteRate
    name: cassandra_clientrequest_$2_oneminuterate
    labels:
      scope: "$1"
    type: GAUGE

  # --- Table read/write latency timers: percentiles -> quantile label ---
  - pattern: org.apache.cassandra.metrics<type=Table, keyspace=(.+), scope=(.+), name=(.+Latency)><>(\d+)thPercentile
    name: cassandra_table_$3_seconds
    labels:
      keyspace: "$1"
      table: "$2"
      quantile: "0.$4"
    type: GAUGE
    valueFactor: 0.000001
  # --- Table counters/gauges (disk, partitions, tombstones, ...) ---
  - pattern: org.apache.cassandra.metrics<type=Table, keyspace=(.+), scope=(.+), name=(.+)><>(Count|Value)
    name: cassandra_table_$3
    labels:
      keyspace: "$1"
      table: "$2"
    type: GAUGE

  # --- Keyspace counters/gauges ---
  - pattern: org.apache.cassandra.metrics<type=Keyspace, keyspace=(.+), name=(.+)><>(Count|Value)
    name: cassandra_keyspace_$2
    labels:
      keyspace: "$1"
    type: GAUGE

  # --- ThreadPool: pending/active/blocked gauges + total blocked counter ---
  - pattern: org.apache.cassandra.metrics<type=ThreadPools, path=(.+), scope=(.+), name=(.+)><>Value
    name: cassandra_threadpool_$3
    labels:
      path: "$1"
      pool: "$2"
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=ThreadPools, path=(.+), scope=(.+), name=(.+)><>Count
    name: cassandra_threadpool_$3_count
    labels:
      path: "$1"
      pool: "$2"
    type: COUNTER

  # --- Storage counters/gauges (load, hints, exceptions) ---
  - pattern: org.apache.cassandra.metrics<type=Storage, name=(.+)><>Value
    name: cassandra_storage_$1
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=Storage, name=(.+)><>Count
    name: cassandra_storage_$1_count
    type: COUNTER

  # --- Compaction (pending gauge, completed counter) ---
  - pattern: org.apache.cassandra.metrics<type=Compaction, name=(.+)><>Value
    name: cassandra_compaction_$1
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=Compaction, name=(.+)><>Count
    name: cassandra_compaction_$1_count
    type: COUNTER

  # --- CommitLog (pending tasks gauge, completed counter) ---
  - pattern: org.apache.cassandra.metrics<type=CommitLog, name=(.+)><>Value
    name: cassandra_commitlog_$1
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=CommitLog, name=(.+)><>Count
    name: cassandra_commitlog_$1_count
    type: COUNTER

  # --- Cache (hit rate gauge, hits/requests counters) ---
  - pattern: org.apache.cassandra.metrics<type=Cache, scope=(.+), name=(.+)><>Value
    name: cassandra_cache_$2
    labels:
      cache: "$1"
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=Cache, scope=(.+), name=(.+)><>Count
    name: cassandra_cache_$2_count
    labels:
      cache: "$1"
    type: COUNTER

  # --- CQL (prepared/regular statement counters + ratio gauge) ---
  - pattern: org.apache.cassandra.metrics<type=CQL, name=(.+)><>Value
    name: cassandra_cql_$1
    type: GAUGE
  - pattern: org.apache.cassandra.metrics<type=CQL, name=(.+)><>Count
    name: cassandra_cql_$1_count
    type: COUNTER

  # --- DroppedMessage (per-verb dropped counter) ---
  - pattern: org.apache.cassandra.metrics<type=DroppedMessage, scope=(.+), name=(.+)><>Count
    name: cassandra_droppedmessage_$2_count
    labels:
      verb: "$1"
    type: COUNTER

  # JVM metrics (jvm_memory_*, jvm_gc_collection_seconds_*, jvm_threads_*,
  # jvm_buffer_pool_*, jvm_classes_*) are emitted by the javaagent's built-in
  # JVM collector using standard names - no custom java.lang rules needed.
```

### 3. Load the agent into Cassandra

Attach the exporter as a Java agent on the Cassandra JVM, pointing it at
the port and config from the previous steps. On a host install, add it to
`JVM_OPTS` in `cassandra-env.sh`:

```bash showLineNumbers title="cassandra-env.sh"
JVM_OPTS="$JVM_OPTS -javaagent:/path/to/jmx_prometheus_javaagent.jar=9404:/path/to/jmx-config.yaml"
```

For Docker, mount the JAR and config into the container and set
`JVM_EXTRA_OPTS`:

```bash showLineNumbers title="container environment"
JVM_EXTRA_OPTS="-javaagent:/opt/jmx_prometheus_javaagent.jar=9404:/opt/jmx-config.yaml"
```

Verify the endpoint serves metrics:

```bash showLineNumbers title="Verify exporter endpoint"
# The exporter is publishing Prometheus metrics
curl -s http://localhost:9404/metrics | head -20

# Cassandra-specific series are present
curl -s http://localhost:9404/metrics | grep cassandra_clientrequest_latency
```

## Configuration

The native `prometheus` receiver scrapes the exporter endpoint. It also
supplies the `up` target-health metric (`1` when the scrape succeeds),
which is the Core liveness signal for this path.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CASSANDRA_HOST}:9404   # Cassandra host running the exporter

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

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
CASSANDRA_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

The `cassandra_table_*` (119) and `cassandra_keyspace_*` (84) families
are per-table and per-keyspace, so they grow with your schema and are the
main cardinality cost. In production, drop the Diagnostic tier at the
scrape with `metric_relabel_configs` and keep Core + Operational:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CASSANDRA_HOST}:9404
          metric_relabel_configs:
            # Drop the high-cardinality per-table / per-keyspace families
            - source_labels: [__name__]
              regex: "cassandra_(table|keyspace)_.*"
              action: drop
```

To go the other way and keep only the Core + Operational series, swap the
`drop` for a `keep` on an allow-list of the prefixes you alert on
(`cassandra_clientrequest_.*`, `cassandra_compaction_.*`,
`cassandra_threadpool_.*`, `cassandra_storage_.*`, `cassandra_cache_.*`,
`cassandra_commitlog_.*`, `cassandra_droppedmessage_.*`, `jvm_.*`, `up`).

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Collector is scraping the Cassandra exporter
docker logs otel-collector 2>&1 | grep -i "cassandra"

# The exporter is serving Cassandra series
curl -s http://localhost:9404/metrics | grep cassandra_clientrequest_latency

# Generate read/write traffic so the latency and throughput series advance
cqlsh -e "SELECT * FROM system.local;"
```

## Troubleshooting

### Metrics endpoint not responding on port 9404

**Cause**: The JMX exporter agent did not load, or the port is wrong.

**Fix**:

1. Confirm the `-javaagent` flag is on the Cassandra JVM:
   `ps aux | grep javaagent`.
2. Check that the port in the agent argument matches the Collector scrape
   target.
3. Check the Cassandra logs for agent startup errors.

### Only JVM metrics appear, no Cassandra metrics

**Cause**: The exporter rules in `jmx-config.yaml` are not matching the
Cassandra MBeans, so only the agent's built-in `jvm_*` collector is
emitting.

**Fix**:

1. Verify `jmx-config.yaml` has the `org.apache.cassandra.metrics`
   patterns and that the file path in the `-javaagent` argument is
   correct.
2. Check for typos in the pattern regexes.
3. Confirm Cassandra has finished starting - MBeans register late in
   boot.

### Read or write latency is climbing

**Cause**: Coordinator latency is dominated by GC pauses, compaction
backlog, or slow replicas.

**Look at**: the Diagnostic `jvm_*` internals alongside Operational
`jvm_gc_collection_seconds` and `jvm_memory_used_bytes` for heap and GC
pressure; `cassandra_compaction_pendingtasks` for compaction backlog; and
the per-table `cassandra_table_*` latency series to find the hot table.

**Fix**:

1. If GC time is high, tune the heap / collector or add capacity.
2. If compaction is behind, raise compaction throughput or IO headroom.
3. Inspect replica health and consistency level if a single replica is
   slow.

### High metric cardinality

**Cause**: The per-table `cassandra_table_*` and per-keyspace
`cassandra_keyspace_*` families create many time series in clusters with
many tables.

**Look at**: the count of `cassandra_table_*` and `cassandra_keyspace_*`
series in `curl -s http://localhost:9404/metrics`.

**Fix**:

1. Drop the Diagnostic tier with `metric_relabel_configs` (see
   [Filtering Metrics](#filtering-metrics)).
2. Exclude system keyspaces by adding a relabel rule on the `keyspace`
   label.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why use the JMX exporter instead of the OTel JMX receiver?**

The OTel JMX receiver was deprecated in January 2026. It required a JRE
inside the Collector container and collected only a limited set of
Cassandra metrics over a remote JMX connection. The Prometheus JMX
exporter runs inside Cassandra's JVM, needs no external JRE, and exposes
the full MBean set as Prometheus metrics on a local HTTP endpoint.

**How do I monitor a multi-node Cassandra cluster?**

Each Cassandra node runs its own exporter agent. Add all node endpoints
to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-node)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          static_configs:
            - targets:
                - cassandra-1:9404
                - cassandra-2:9404
                - cassandra-3:9404
```

Each node is scraped independently and identified by its `instance`
label.

**Does this work with Cassandra running in Kubernetes?**

Yes. Mount the exporter JAR and `jmx-config.yaml` into the Cassandra pod
via a ConfigMap or init container, and add the `-javaagent` argument to
the JVM options. Set `targets` to the pod or service DNS (for example
`cassandra-0.cassandra.default.svc.cluster.local:9404`). The Collector
can run as a sidecar or DaemonSet.

**Why is request latency a Summary with a `quantile` label?**

The exporter rules map each ClientRequest latency percentile MBean
attribute to a `quantile` label on
`cassandra_clientrequest_latency_seconds` (in seconds, via
`valueFactor`). Read the p99 with
`cassandra_clientrequest_latency_seconds{scope="Read",quantile="0.99"}`.

**Why do counter metrics have a `_count_total` suffix?**

The exporter types request and error counts as Prometheus counters, and
the COUNTER type adds the `_total` suffix - so a coordinator request
count appears as `cassandra_clientrequest_latency_count_total`. Compute
throughput and error rate as `rate()` over these counters.

## Related Guides

- [JMX Metrics Collection Guide](../collector-setup/jmx-metrics-collection-guide.md)
  - Choose between the JMX scraper and the JMX exporter.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Cassandra metrics.
- [MongoDB Monitoring](./mongodb.md) - Another distributed database to put
  on Scout.
- [Redis Monitoring](./redis.md) - A common companion data store.
- [PostgreSQL Monitoring](./postgres.md) - Relational database monitoring.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MongoDB](./mongodb.md), [Redis](./redis.md),
  [PostgreSQL](./postgres.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for
  incident investigation.
