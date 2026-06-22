---
title: >
  ClickHouse OpenTelemetry Monitoring - Query Throughput, Merges,
  and Collector Setup
sidebar_label: ClickHouse
id: collecting-clickhouse-telemetry
sidebar_position: 22
description: >
  Scrape ClickHouse's native Prometheus endpoint with the OpenTelemetry
  Collector. Monitor query throughput, merge and parts health, and memory
  pressure, and ship to base14 Scout.
keywords:
  - clickhouse opentelemetry
  - clickhouse otel collector
  - clickhouse metrics monitoring
  - clickhouse performance monitoring
  - opentelemetry prometheus receiver clickhouse
  - clickhouse observability
  - monitor clickhouse kubernetes
  - clickhouse telemetry collection
---

# ClickHouse

ClickHouse serves its own metrics in Prometheus format at `:9363/metrics`
when the `<prometheus>` section is enabled in the server config - no
exporter and no JMX agent. The OpenTelemetry Collector's `prometheus`
receiver scrapes that endpoint and ships the metrics to base14 Scout. The
endpoint exposes roughly 3300 metrics across query throughput, merge and
parts health, connections, memory allocation, disk and host capacity, and
replication, on ClickHouse 22.x+. This guide enables the endpoint,
configures the receiver, bounds the volume, and verifies the flow.

ClickHouse defines the metric names; the receiver passes them through
verbatim. The counters keep their `ClickHouse...` names with **no `_total`
suffix added**, even though the `ProfileEvents` family is typed as
`counter`. Reproduce the names exactly as the endpoint emits them.

## Prerequisites

| Requirement            | Minimum | Recommended      |
| ---------------------- | ------- | ---------------- |
| ClickHouse             | 22.x    | 24.x+ (26.5.1)   |
| OTel Collector Contrib | 0.90.0  | 0.153.0          |
| base14 Scout           | Any     | -                |

Before starting:

- ClickHouse running, with the `<prometheus>` config section enabled (it is
  not on by default). See [Access Setup](#access-setup).
- The metrics port (`9363`) reachable from the host running the Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident or
capacity review. The endpoint emits four metric families -
`ClickHouseProfileEvents_*` (cumulative counters), `ClickHouseMetrics_*`
(point-in-time gauges), `ClickHouseAsyncMetrics_*` (periodically computed
gauges), and `ClickHouseHistogramMetrics_*` - plus the receiver's own `up`
target-health gauge.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - ClickHouse's metrics endpoint is reachable. This is the liveness signal the `prometheus` receiver supplies (`1` = scrape succeeded). |
| `ClickHouseProfileEvents_Query` | Total queries executed; the rate is the query-throughput KPI. |
| `ClickHouseProfileEvents_FailedQuery` | Queries that failed; `rate(FailedQuery) / rate(Query)` is the error rate. |
| `ClickHouseProfileEvents_QueryTimeMicroseconds` | Cumulative query time in microseconds; divide its rate by the query rate for mean query latency. |
| `ClickHouseMetrics_Query` | Queries currently executing - concurrency and query-path saturation. |

Query latency here is a **mean only**: `rate(QueryTimeMicroseconds) /
rate(Query)` in microseconds. ClickHouse's `/metrics` endpoint exposes no
query-latency percentile or histogram, so do not expect one - for per-query
timing reach for `system.query_log` or your trace path.

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Query mix | `ClickHouseProfileEvents_SelectQuery`, `_InsertQuery` | Read vs write query mix. |
| Data volume | `ClickHouseProfileEvents_SelectedRows`, `_InsertedRows` | Rows read and written - data-plane volume. |
| Merge / parts health | `ClickHouseMetrics_Merge`, `ClickHouseMetrics_PartMutation`, `ClickHouseMetrics_PartsActive`, `ClickHouseMetrics_BackgroundMergesAndMutationsPoolTask` | Active merges and mutations, active parts ("too many parts" when rising), and background pool backlog. |
| Memory pressure | `ClickHouseMetrics_MemoryTracking`, `ClickHouseProfileEvents_QueryMemoryLimitExceeded` | Server-tracked memory in use, and queries killed for exceeding the memory limit. |
| Connections | `ClickHouseMetrics_TCPConnection`, `_HTTPConnection` | Active client connections. |
| Replication | `ClickHouseMetrics_ReadonlyReplica`, `ClickHouseAsyncMetrics_ReplicasMaxAbsoluteDelay` | Replicas stuck read-only, and the worst replica replication delay. |
| Disk / host capacity | `ClickHouseAsyncMetrics_FilesystemMainPathAvailableBytes`, `ClickHouseAsyncMetrics_OSMemoryAvailable`, `ClickHouseAsyncMetrics_LoadAverage1` | Free space on the main data path, host memory available, and 1-minute load. |

### Diagnostic - for investigation and tuning

The four metric families in full - higher cardinality, pulled during an
incident or for a specific subsystem, not paged on. The per-disk `Block*`
and per-CPU `AsyncMetrics` series are the main cardinality source; in
production you can drop this tier with `metric_relabel_configs`, keeping Core
and Operational (see [Filtering Metrics](#filtering-metrics)).

| Family | Count | When you reach for it |
|---|---|---|
| `ClickHouseProfileEvents_*` | 1250, cumulative counters | All event counters: I/O, cache, network, ZooKeeper, S3, throttling. |
| `ClickHouseMetrics_*` | 480, point-in-time gauges | Locks, threads, per-pool sizes, in-flight operations. |
| `ClickHouseAsyncMetrics_*` | 876, periodically-computed gauges | Per-disk `Block*`, per-CPU, jemalloc, filesystem, uptime. |
| `ClickHouseHistogramMetrics_*` | 45, histograms | Latency histograms (Keeper response time, HTTP pool buffers). |

Full metric reference: run `curl -s http://localhost:9363/metrics` against
your instance with the endpoint enabled.

## Key Alerts to Configure

Threshold guidance for the Core and Operational series. All thresholds here
are relative to your own baseline - ClickHouse signal levels are
workload-dependent, so alert on a rise against the steady state, not an
invented absolute. Tune to your workload; these are starting points.

| Alert | Threshold | Why it matters |
|---|---|---|
| ClickHouse down | `up == 0` for > 1m | Metrics endpoint unreachable - server down, `<prometheus>` off, or network. Check the process and `:9363`. |
| Query failure rate | `rate(ClickHouseProfileEvents_FailedQuery) / rate(ClickHouseProfileEvents_Query)` rising vs baseline | Queries erroring; check logs, schema, and resource limits. |
| Query latency regression | `rate(ClickHouseProfileEvents_QueryTimeMicroseconds) / rate(ClickHouseProfileEvents_Query)` rising vs baseline | Mean query time climbing; check merges, memory, disk, and query patterns. |
| Too many parts | `ClickHouseMetrics_PartsActive` rising vs baseline | Merges falling behind inserts; INSERTs will eventually be throttled or rejected. Slow the insert rate or raise merge throughput. |
| Merge / mutation backlog | `ClickHouseMetrics_Merge` or `ClickHouseMetrics_BackgroundMergesAndMutationsPoolTask` sustained high | Background work queueing; check IO and pool sizing. |
| Memory pressure | `ClickHouseMetrics_MemoryTracking` near the server limit, or `rate(ClickHouseProfileEvents_QueryMemoryLimitExceeded) > 0` | Memory-bound; tune `max_memory_usage` / per-query limits or add capacity. |
| Replication unhealthy | `ClickHouseMetrics_ReadonlyReplica > 0` or `ClickHouseAsyncMetrics_ReplicasMaxAbsoluteDelay` rising | Replica read-only or lagging; check ZooKeeper / Keeper and replica health. |
| Disk low | `ClickHouseAsyncMetrics_FilesystemMainPathAvailableBytes` approaching 0 | Data path filling; free space or add storage before writes fail. |

## Access Setup

ClickHouse exposes the metrics endpoint natively - there is no exporter to
run. Enable it by adding a `<prometheus>` section to the server config. Drop
a config override file into `/etc/clickhouse-server/config.d/`:

```xml showLineNumbers title="config.d/clickhouse-prometheus.xml"
<clickhouse>
    <prometheus>
        <endpoint>/metrics</endpoint>
        <port>9363</port>
        <metrics>true</metrics>
        <events>true</events>
        <asynchronous_metrics>true</asynchronous_metrics>
        <status_info>true</status_info>
    </prometheus>
</clickhouse>
```

The four flags control which families are served:

- `metrics` - current server gauges (`ClickHouseMetrics_*`: active queries,
  connections, merge pool tasks).
- `events` - cumulative event counters (`ClickHouseProfileEvents_*`: queries
  executed, bytes read and written, merge operations).
- `asynchronous_metrics` - periodically computed system metrics
  (`ClickHouseAsyncMetrics_*`: memory, CPU, disk, uptime).
- `status_info` - dictionary status. This emits no series until dictionaries
  are loaded, so on a server with none configured it adds nothing - leave it
  on; it costs nothing when idle.

For Docker, mount the file into `/etc/clickhouse-server/config.d/`. Restart
ClickHouse after adding it.

The metrics endpoint requires no authentication by default. Restrict access
to port `9363` at the network layer (firewall, security group, or
NetworkPolicy) in production.

Verify the endpoint is up:

```bash showLineNumbers title="Verify access"
# Check ClickHouse is serving
curl -s http://localhost:8123/ping

# Confirm the metrics endpoint
curl -s http://localhost:9363/metrics | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:CLICKHOUSE_HOST}:9363   # Your ClickHouse host

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

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
CLICKHOUSE_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

ClickHouse emits roughly 3300 metrics per scrape. The
`ClickHouseAsyncMetrics_*` per-disk `Block*` and per-CPU series are the main
cardinality source. To bound what reaches Scout, add a
`metric_relabel_configs` `keep` block that whitelists the Core and
Operational names this doc tiers and drops the rest:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:CLICKHOUSE_HOST}:9363
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "up|ClickHouseProfileEvents_(Query|FailedQuery|QueryTimeMicroseconds|SelectQuery|InsertQuery|SelectedRows|InsertedRows|QueryMemoryLimitExceeded)|ClickHouseMetrics_(Query|Merge|PartMutation|PartsActive|BackgroundMergesAndMutationsPoolTask|MemoryTracking|TCPConnection|HTTPConnection|ReadonlyReplica)|ClickHouseAsyncMetrics_(ReplicasMaxAbsoluteDelay|FilesystemMainPathAvailableBytes|OSMemoryAvailable|LoadAverage1)"
              action: keep
```

This keeps liveness, the RED query signals, merge and parts health, memory,
connections, replication, and disk/host capacity, while excluding the
high-cardinality per-disk and per-CPU Diagnostic families. Widen the regex
to add any Diagnostic series you want to keep on hand.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for a successful clickhouse scrape
docker logs otel-collector 2>&1 | grep -i "clickhouse"

# Confirm ClickHouse is serving
curl -s http://localhost:8123/ping

# Check a Core metric directly on the endpoint
curl -s http://localhost:9363/metrics | grep ClickHouseProfileEvents_Query
```

To advance the query, merge, and parts signals, run some traffic: create a
MergeTree table, insert rows, run a few aggregate `SELECT`s, and
`OPTIMIZE ... FINAL`.

## Troubleshooting

### Metrics endpoint not responding on port 9363

**Cause**: The `<prometheus>` section is not enabled in the ClickHouse
server config.

**Fix**:

1. Add the config override file to `config.d/` with the `<prometheus>` block
   (see [Access Setup](#access-setup)).
2. Restart ClickHouse: `systemctl restart clickhouse-server` or
   `docker restart clickhouse`.
3. Verify: `curl http://localhost:9363/metrics`.

### Only some metric families appear

**Cause**: One or more of the four flags is `false`, so that family is not
served.

**Fix**:

1. Set all four to `true`: `metrics`, `events`, `asynchronous_metrics`,
   `status_info`.
2. Restart ClickHouse after the change.
3. Count what is served:
   `curl -s http://localhost:9363/metrics | grep -c "^# TYPE"`.

Note that `status_info` legitimately emits nothing until dictionaries are
loaded - an empty `status_info` is expected on a server with no dictionaries.

### Inserts are throttled or rejected ("too many parts")

**Cause**: Background merges are falling behind the insert rate, so active
parts pile up.

**Look at**: `ClickHouseMetrics_PartsActive` (rising = parts accumulating),
`ClickHouseMetrics_Merge`, and
`ClickHouseMetrics_BackgroundMergesAndMutationsPoolTask`; the Diagnostic
`ClickHouseProfileEvents_*` I/O counters show whether merges are IO-bound.

**Fix**:

1. Slow the insert rate or batch inserts into fewer, larger blocks.
2. Raise merge throughput / background pool sizing if IO headroom allows.

### Mean query latency is climbing

**Cause**: Memory pressure, merge backlog, slow disk, or a query-pattern
change.

**Look at**: `ClickHouseMetrics_MemoryTracking` and the Diagnostic
`ClickHouseProfileEvents_*` I/O and cache counters, alongside
`ClickHouseAsyncMetrics_FilesystemMainPathAvailableBytes`. Remember latency
here is a rate-derived mean, not a percentile.

**Fix**:

1. Check for memory pressure and merge backlog first (Operational tier).
2. Inspect `system.query_log` for the slow query shapes - the percentile
   detail lives there, not on `/metrics`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why do the counters have no `_total` suffix?**

ClickHouse defines the metric names and the `prometheus` receiver passes them
through verbatim. The `ClickHouseProfileEvents_*` family is typed as
`counter`, but the receiver does not append a `_total` suffix - the names
stay exactly as ClickHouse emits them (`ClickHouseProfileEvents_Query`, not
`..._Query_total`). Rate them as counters; just use the literal names.

**How do I bound the ~3300-metric volume?**

Add a `metric_relabel_configs` `keep` block to the scrape config that
whitelists the Core and Operational names (see
[Filtering Metrics](#filtering-metrics)). The `ClickHouseAsyncMetrics_*`
per-disk `Block*` and per-CPU series are the main cardinality source, so
dropping the Diagnostic families is where most of the volume reduction comes
from.

**How do I monitor a multi-node ClickHouse cluster?**

Each node serves its own `:9363/metrics` endpoint. Add one scrape target per
server:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          static_configs:
            - targets:
                - clickhouse-shard1-replica1:9363
                - clickhouse-shard1-replica2:9363
                - clickhouse-shard2-replica1:9363
```

Each node is scraped independently and identified by its `instance` label.

**Does this work with ClickHouse running in Kubernetes?**

Yes. Set `targets` to the pod or service DNS on `:9363`
(e.g., `clickhouse-0.clickhouse.default.svc.cluster.local:9363`). Mount the
`<prometheus>` config override via a ConfigMap into
`/etc/clickhouse-server/config.d/`. The Collector can run as a sidecar or a
deployment.

**Why is there no query-latency percentile?**

The `/metrics` endpoint exposes query time only as a cumulative counter
(`ClickHouseProfileEvents_QueryTimeMicroseconds`), so the latency you get is
a mean: `rate(QueryTimeMicroseconds) / rate(Query)`. For percentiles and
per-query detail, query `system.query_log`.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on ClickHouse metrics.
- [Cassandra Monitoring](./cassandra.md) - Another wide-column store to watch
  for compaction and read/write latency.
- [PostgreSQL Monitoring](./postgres.md) - A common transactional source
  feeding ClickHouse.
- [Redis Monitoring](./redis.md) - A common cache in front of analytics
  queries.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [Cassandra](./cassandra.md), and other
  components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for incident
  investigation.
