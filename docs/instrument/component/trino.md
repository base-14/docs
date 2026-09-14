---
title: >
  Trino OpenTelemetry Monitoring - Query Lifecycle, Cluster Memory,
  and Collector Setup
sidebar_label: Trino
id: collecting-trino-telemetry
sidebar_position: 70
description: >
  Collect Trino metrics and traces with the OpenTelemetry Collector. Monitor
  query lifecycle, cluster memory pools, and execution-slot saturation in
  base14 Scout.
keywords:
  - trino opentelemetry
  - trino otel collector
  - trino metrics monitoring
  - trino query performance monitoring
  - opentelemetry prometheus receiver trino
  - trino observability
  - trino distributed tracing
  - trino telemetry collection
---

# Trino

Trino serves OpenMetrics at `/metrics` on its HTTP port with no exporter and
no sidecar. The OpenTelemetry Collector's `prometheus` receiver scrapes it,
collecting 2371 metric families covering query lifecycle, cluster memory
pools, node membership, execution slots, and planner internals. The scrape
must carry an `X-Trino-User` header or it is rejected. This guide sets up
the scrape, controls its volume, turns on Trino's native OTLP tracing, and
ships both signals to base14 Scout.

## Prerequisites

| Requirement                 | Minimum | Recommended |
| --------------------------- | ------- | ----------- |
| Trino (metrics)             | 407     | 483         |
| Trino (native OTLP tracing) | 414     | 483         |
| OTel Collector Contrib      | 0.90.0  | 0.160.0     |
| base14 Scout                | Any     | -           |

The Trino minimums come from the release notes: `/metrics` is served from
release 407, native OTLP tracing from 414, and the `http/protobuf` exporter
protocol from 475.

Before starting:

- Trino running, with its HTTP port (`8080` by default) reachable from the
  host running the Collector.
- A user name to send as `X-Trino-User`. An unauthenticated scrape is
  rejected, even on a server with no authentication configured.
- At least 4096 file descriptors for the Trino process. Trino refuses to
  start below that, so a container needs a `nofile` ulimit set explicitly.
- About 4 GB of memory for the Trino process. Heap tracks the container
  limit at 80 percent.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

The execution-slot metrics below come from the
`ThreadPerDriverTaskExecutor` MBean, which is the name on 483. Older
releases expose the task executor under a different object name, so read
the names off your own build before wiring the slot-saturation alert.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident or
a capacity review. Every series carries the `trino_` or `io_airlift_`
prefix, plus the `up` gauge and the four `scrape_*` series the `prometheus`
receiver synthesises for every target.

Names follow a fixed rule, so you can work one out instead of searching for
it. Take the MBean object name, collapse every run of non-alphanumeric
characters to a single underscore, then append the attribute.
`trino.execution:name=QueryManager` with attribute `RunningQueries` becomes
`trino_execution_name_QueryManager_RunningQueries`. Key/value pairs in the
object name survive as segments, which is why
`trino_memory_type_MemoryPool_name_general_FreeBytes` reads the way it does:
`type=MemoryPool`, `name=general`, attribute `FreeBytes`.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded. On this endpoint a `0` most often means the identity header is missing, not that Trino is down. |
| `trino_node_name_CoordinatorNodeManager_ActiveNodeCount` | Nodes the coordinator currently considers active. The cluster-membership signal. |
| `trino_node_name_CoordinatorNodeManager_InactiveNodeCount` | Nodes the coordinator has stopped hearing from. Non-zero means a node has dropped out and its capacity is gone. |
| `trino_execution_name_QueryManager_RunningQueries` | Queries executing right now. The main throughput gauge. |
| `trino_execution_name_QueryManager_QueuedQueries` | Queries admitted but not yet executing. Sustained non-zero is the admission-control backlog. |

`RunningQueries` and `QueuedQueries` often read `0` on a healthy cluster.
Short queries finish inside the scrape interval, so the gauges are usually
sampled between queries. Use the counters, not the gauges, for throughput,
and do not treat a `0` gauge as an outage.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `trino_execution_name_QueryManager_FailedQueries` | Cumulative failures. Rate of change is the error-rate signal. |
| `trino_execution_name_QueryManager_InternalFailures` | Failures that are Trino's fault, not the user's. Should sit at 0. |
| `trino_execution_name_QueryManager_UserErrorFailures` | Failures caused by bad SQL or missing objects. Expected to be non-zero; alert on a step change, not on presence. |
| `trino_execution_name_QueryManager_InsufficientResourcesFailures` | Queries rejected for want of memory or slots. The capacity signal. |
| `trino_execution_name_QueryManager_AbandonedQueries` | Clients that stopped collecting results. Usually a client timeout, not a server fault. |
| `trino_execution_name_QueryManager_CanceledQueries` | Explicit cancellations. |
| `trino_execution_name_QueryManager_StartedQueries` | Queries that reached execution. See the arithmetic note in the [FAQ](#why-do-startedqueries-and-completedqueries-not-match). |
| `trino_execution_name_QueryManager_CompletedQueries` | Queries that reached a terminal state, including those that never started. |
| `trino_memory_name_ClusterMemoryManager_ClusterMemoryBytes` | Total query memory the cluster can hand out. The denominator for every memory ratio. |
| `trino_memory_type_ClusterMemoryPool_name_general_ReservedDistributedBytes` | Query memory currently reserved cluster-wide. |
| `trino_memory_type_ClusterMemoryPool_name_general_FreeDistributedBytes` | Query memory still available. |
| `trino_memory_type_ClusterMemoryPool_name_general_BlockedNodes` | Nodes blocked waiting for memory. Non-zero means queries are stalling on the pool. |
| `trino_memory_type_ClusterMemoryPool_name_general_AssignedQueries` | Queries holding a reservation in the general pool. |
| `trino_memory_name_ClusterMemoryManager_QueriesKilledDueToOutOfMemory` | The memory killer fired at query level. |
| `trino_memory_name_ClusterMemoryManager_TasksKilledDueToOutOfMemory` | The memory killer fired at task level. |
| `trino_memory_name_ClusterMemoryManager_NumberOfLeakedQueries` | Queries whose memory was never released. A Trino defect signal; should stay 0. |
| `trino_execution_executor_dedicated_name_ThreadPerDriverTaskExecutor_ConcurrencyControlAvailableSlots` | Free driver slots. Against `TotalSlots` this is the execution-saturation ratio. |
| `trino_execution_executor_dedicated_name_ThreadPerDriverTaskExecutor_ConcurrencyControlTotalSlots` | Configured driver slots. The denominator for that ratio. |
| `trino_execution_name_QueryManager_ConsumedCpuTimeSecs` | Cumulative query CPU. The cost signal. |
| `trino_execution_name_QueryManager_ConsumedInputRows` | Cumulative rows read. Pairs with CPU to spot inefficient plans. |
| `trino_execution_name_QueryManager_WallInputBytesRate_OneMinute` | Input throughput, one-minute rate. |
| `trino_execution_name_QueryManager_ExecutionTime_OneMinute{quantile="0.95"}` | Query latency, one-minute window. A summary that carries the quantile as a label; see the note below on its shape. |

### Diagnostic - for investigation and tuning

Everything per-rule, per-pool, and per-phase. The tail runs past 2300
families, so the groups below are representative rather than exhaustive.

| Family | Count | What it covers |
|---|---|---|
| `io_airlift_http_client_*` | 936 | Per-pool internal RPC client stats. |
| `trino_sql_planner_iterative_*` | 884 | Per-optimizer-rule time, hits, failures, applications. |
| `trino_execution_scheduler_*` | 202 | Stage and split scheduling. |
| `trino_execution_name_*` | 115 | QueryManager and SqlQueryManager, including every Core query gauge. |
| `trino_server_name_*` | 68 | Coordinator thread pools and async HTTP execution. |
| `trino_execution_executor_*` | 40 | Driver and task execution, concurrency-control slots. |
| `io_airlift_http_server_*` | 27 | Inbound HTTP server stats. |
| `trino_memory_*` | 18 | Cluster and local memory pools, the OOM killer counters. |
| `io_airlift_stats_*` | 16 | Airlift's own GC and executor instrumentation. |
| `trino_sql_gen_*` | 12 | Expression and page-processor compilation caches. |
| `trino_eventlistener_name_*` | 9 | Event-listener dispatch. |
| `trino_node_name_*` | 7 | Cluster membership: active, inactive, draining, shutting down. |

These counts are raw scrape families, not tier assignments, so a family here
can contain Core or Operational series.

The per-rule (`trino_sql_planner_iterative_*`) and per-pool
(`io_airlift_http_client_*`) groups are engine internals with no documented
thresholds. They belong in dashboards you open during an incident, not in
alerts. See [Controlling metric volume](#controlling-metric-volume).

Per-phase latency breaks the Operational
`trino_execution_name_QueryManager_ExecutionTime_*` summaries out further,
into `_QueuedTime_*`, `_AnalysisTime_*`, and `_PlanningTime_*`. It is the
first place to look when queries slow down. All these families share one
shape. Each comes in `OneMinute`, `FiveMinutes`, `FifteenMinutes`, and
`AllTime` windows, and
each window is a summary carrying `_count`, `_sum`, and the quantiles `0.5`,
`0.75`, `0.9`, `0.95`, `0.99` **as labels**. There is no `_P95`-style name.
Write the query as:

```text showLineNumbers
trino_execution_name_QueryManager_ExecutionTime_OneMinute{quantile="0.95"}
```

Full metric reference: run
`curl -s -H "X-Trino-User: otel" http://localhost:8080/metrics` against your
own coordinator.

## Key Alerts to Configure

Threshold guidance for the Core and Operational series. Thresholds here are
relative or derived from Trino's own semantics, because a federating
engine's absolute levels are a property of the query mix, not of Trino. Tune
to your workload.

Alert on the cause of a failure rather than the total count.
`UserErrorFailures` is expected to be non-zero on any cluster in real use, so
alert on a step change against the trailing 24h rather than on presence. `InternalFailures`
should sit at 0 and every one is worth reading the logs for.
`InsufficientResourcesFailures` is the capacity signal, not an error signal.

| Metric | Threshold | Why it matters / action |
|---|---|---|
| `up` | `== 0` for 1m | The scrape is failing. Check the identity header before assuming Trino is down; a missing `X-Trino-User` returns 401 and looks identical to an outage. |
| `trino_node_name_CoordinatorNodeManager_InactiveNodeCount` | `> 0` for 5m | A node stopped heartbeating. Capacity has left the cluster and queries will queue or fail on resources. |
| `trino_node_name_CoordinatorNodeManager_ActiveNodeCount` | `<` expected count | A worker did not rejoin after a restart or deploy. |
| `rate(trino_execution_name_QueryManager_InternalFailures[5m])` | `> 0` | Failures that are not the user's fault. Every one is a Trino-side bug or resource problem worth reading the logs for. |
| `rate(trino_execution_name_QueryManager_InsufficientResourcesFailures[5m])` | `> 0` | Queries rejected for want of memory or slots. Raise the memory limits, add workers, or tune resource groups. |
| `trino_memory_name_ClusterMemoryManager_QueriesKilledDueToOutOfMemory` | `increase > 0` over 10m | The memory killer fired. Users are seeing hard query failures under load. |
| `trino_memory_name_ClusterMemoryManager_TasksKilledDueToOutOfMemory` | `increase > 0` over 10m | Task-level kills, which often precede query kills. Earlier warning than the query counter. |
| `trino_memory_type_ClusterMemoryPool_name_general_BlockedNodes` | `> 0` sustained 5m | Nodes are stalled waiting for query memory. Throughput is already degraded even though nothing has failed. |
| `trino_memory_type_ClusterMemoryPool_name_general_ReservedDistributedBytes / trino_memory_name_ClusterMemoryManager_ClusterMemoryBytes` | `> 0.9` for 10m | Query memory nearly exhausted. Further large queries will be killed. Alert on the ratio, never on an absolute byte count. |
| `trino_memory_name_ClusterMemoryManager_NumberOfLeakedQueries` | `> 0` | Memory never released after a query ended. A Trino defect; it should never be non-zero. |
| `1 - (ConcurrencyControlAvailableSlots / ConcurrencyControlTotalSlots)` on `trino_execution_executor_dedicated_name_ThreadPerDriverTaskExecutor_*` | `> 0.9` for 10m | Driver slots saturated. Queries are waiting on execution capacity rather than on data. |
| `trino_execution_name_QueryManager_QueuedQueries` | Set from your cluster's normal range; alert on monotonic growth over 15m | Admission backlog. An absolute number is meaningless without knowing the cluster's concurrency settings. |
| `trino_execution_name_QueryManager_ExecutionTime_OneMinute{quantile="0.95"}` | Set from your own steady-state reading | Query latency. What counts as normal depends on your query mix. |
| `rate(trino_execution_name_QueryManager_UserErrorFailures[15m])` | Step change vs the trailing 24h, not an absolute | Expected to be non-zero on any cluster in real use. A sudden jump usually means a broken dashboard or a dropped upstream table, not a Trino fault. |

## Access Setup

There is nothing to install and nothing to enable. Trino has served
OpenMetrics on `/metrics` on its normal HTTP port by default since release
407, with `Content-Type:
application/openmetrics-text;charset=utf-8;version=1.0.0`. There is no
metrics enable list, so the full surface is served on every scrape.

`/metrics` is a management-read resource, which means an unauthenticated
request is rejected with 401 **even on a server with no authentication
configured**. A bare `curl` returns:

```text showLineNumbers
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="Trino"

Basic authentication or X-Trino-Original-User or X-Trino-User must be sent
```

The body names the three accepted mechanisms. This guide uses
`X-Trino-User`, which needs no credential store on either side. Verify the
endpoint with the header before configuring the Collector:

```bash showLineNumbers title="Verify access"
# Trino is up and finished starting
curl -fsS http://localhost:8080/v1/info | grep -q '"starting":false' && echo ok

# The endpoint serves with an identity, and rejects without one
curl -s -H "X-Trino-User: otel" http://localhost:8080/metrics | grep -c '^# TYPE'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/metrics
```

The first count returns a number in the low thousands. The second prints
`401`.

Port `8080` also serves the query API and the web UI, so restrict it at the
network layer (firewall, security group, or NetworkPolicy) rather than
treating it as a metrics-only port.

## Configuration

Two things about this config are worth reading before you copy it.

`metrics_path` is not set, on purpose. Trino serves the receiver's default
`/metrics`, so setting it here adds nothing and can be set wrong.

The scrape header goes in the `prometheus` receiver's `http_headers` key,
which maps a header name to an object carrying a `values` **list**, not a
flat `name: value` pair:

```yaml showLineNumbers title="config/otel-collector.yaml (scrape header)"
          http_headers:
            X-Trino-User:
              values: [otel]
```

The full config scrapes metrics and receives Trino's pushed spans. Run the
Collector on `otel/opentelemetry-collector-contrib:latest`. Drop the
`traces` pipeline and the `otlp` receiver if you are only collecting
metrics.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: trino
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:TRINO_HOST}:8080   # Trino's HTTP port
          http_headers:
            X-Trino-User:
              values: [${env:TRINO_METRICS_USER}]

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Trino sets `service.name` and `service.version` on the spans it pushes. The
`resource` processor uses `upsert`, so its `service.name` value wins on both
signals and the two line up in Scout.

### Environment Variables

```bash showLineNumbers title=".env"
TRINO_HOST=localhost
TRINO_METRICS_USER=otel
SERVICE_NAME=trino
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Controlling metric volume

The scrape is 2371 families and 5883 series, and two families are two
thirds of it:

| Family | Families | Series | Share of series |
|---|---|---|---|
| `trino_sql_planner_iterative_*` | 884 | 2210 | 37.5% |
| `io_airlift_http_client_*` | 936 | 1704 | 28.9% |
| **Combined** | **1820** | **3914** | **66.5%** |

`trino_sql_planner_iterative_*` is one set of summaries per optimizer rule:
`_Time` (a summary with five quantiles), `_Hits`, `_Failures`, and
`_Invocations` for each of 221 rules. 1092 of those series report
`NaN` quantiles with a `_count` of 0, because those rules never fired for
the query mix, and they are emitted regardless.
`io_airlift_http_client_*` is per-pool stats for Trino's internal RPC.

Dropping both takes the surface from 2371 families to 551, and keeps
every Core and Operational series:

```yaml showLineNumbers title="config/otel-collector.yaml (volume control)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: '(trino_sql_planner_iterative_|io_airlift_http_client_).*'
              action: drop
```

The block goes under the `trino` scrape config, alongside `static_configs`.
With the rule in place, planning latency and internal RPC detail are no
longer collected.

## Collecting traces

Trino has a native OTLP trace exporter. Turn it on with four properties in
`config.properties` and restart:

```properties showLineNumbers title="etc/trino/config.properties"
tracing.enabled=true
otel.exporter.endpoint=http://otel-collector:4317
otel.exporter.protocol=grpc
otel.tracing.sampling-ratio=0.1
```

`tracing.enabled` defaults to `false`. `otel.exporter.endpoint` defaults to
`http://localhost:4317`. `otel.exporter.protocol` defaults to `grpc`;
`http/protobuf` was added in release 475. The Collector side needs nothing
beyond the `otlp` receiver and `traces` pipeline already in the config
above.

Enabling tracing installs the tracing module only. Trino's JMX metrics never
reach the OTLP stream, so the two pipelines are independent: the scrape
collects metrics and the OTLP receiver collects traces.

`otel.tracing.sampling-ratio` controls the volume. At `1.0`, four queries
every ten seconds on a single node produce about 5700 spans a minute; at
`0.1`, about 355. Span volume scales with splits and drivers rather than
with query count, so a cluster running wide scans produces far more per
query than that. Sampling is head-based on the root,
so a ratio drops whole query traces rather than individual spans, and the
traces you keep stay complete.

The spans follow the query lifecycle, in order: `query`, `dispatch`,
`analyzer`, `query-start`, `planner`, `local-planner`, `scheduler`, `stage`,
`task`, `remote-task`, `pipeline`, and `split`. `optimize` (one span per
optimizer rule application) and `process` (the driver processing loop) are
the two highest-volume names. Connector and security calls
appear per call as `Metadata.*`, `ConnectorMetadata.*`, and
`AccessControl.*`. Inbound HTTP spans are named by route template with path
parameters left as placeholders, for example
`GET /v1/task/{taskId}/status`, so server-span cardinality stays bounded.

Trino's own attribute keys are `trino.query_id`, `trino.query_type`,
`trino.stage_id`, `trino.task_id`, `trino.pipeline_id`, `trino.split_id`,
`trino.catalog`, `trino.schema`, `trino.table`, `trino.optimizer`,
`trino.error_code`, `trino.error_name`, `trino.error_type`, and the
`trino.split.*` timing set. HTTP spans carry current-generation semantic
conventions: `http.request.method`, `http.route`, `url.path`,
`server.address`, `client.address`, and `network.protocol.*`.

Failures are visible on the trace. A failing `query` span gets
`Status code: Error` and three attributes naming the cause:

```text showLineNumbers
Name           : query
Kind           : Internal
Status code    : Error
     -> trino.query_type: Str(SELECT)
     -> trino.query_id: Str(20260913_072149_00003_27fh3)
     -> trino.error_code: Int(46)
     -> trino.error_name: Str(TABLE_NOT_FOUND)
     -> trino.error_type: Str(USER_ERROR)
```

`trino.error_type` separates `USER_ERROR` from the internal categories,
which is the same distinction the `UserErrorFailures` and `InternalFailures`
metrics draw. The trace also names the query.

Trino honours an incoming `traceparent`. A `POST /v1/statement` carrying a
W3C `traceparent` produces a `Kind: Server` span whose parent is the
client's span, and every descendant inherits the trace ID, so a client
already in a trace gets Trino's work attached to it. The CLI cannot do
this, because `trino` has no `--http-header` option, so propagation has to
go through the HTTP API.

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers
# The endpoint serves, with the identity header
curl -s -H "X-Trino-User: otel" http://localhost:8080/metrics | grep -c '^# TYPE'

# A Core metric is present
curl -s -H "X-Trino-User: otel" http://localhost:8080/metrics \
  | grep trino_execution_name_QueryManager_RunningQueries

# The Collector is scraping Trino
docker logs otel-collector 2>&1 | grep -i "trino_execution_name_QueryManager"
```

Move the query counters with a little traffic against the bundled `tpch`
catalog, then re-read `CompletedQueries`:

```bash showLineNumbers
trino --server http://localhost:8080 --user otel \
  --execute "SELECT count(*) FROM tpch.sf1.lineitem"

curl -s -H "X-Trino-User: otel" http://localhost:8080/metrics \
  | grep trino_execution_name_QueryManager_CompletedQueries
```

With tracing on, the same query produces spans. Check the Collector is
receiving them:

```bash showLineNumbers
docker logs otel-collector 2>&1 | grep -i "trino.query_id"
```

## Troubleshooting

### `up` is 0 but Trino is running

**Cause**: The scrape has no identity header, so `/metrics` returns 401. A
401 makes `up` read `0`, which looks exactly like the server being down.

**Look at**: the endpoint by hand. `curl -s -o /dev/null -w '%{http_code}'
http://localhost:8080/metrics` prints `401` without a header and `200` with
one. The 401 body is `Basic authentication or X-Trino-Original-User or
X-Trino-User must be sent`.

**Fix**:

1. Add the `http_headers` block to the scrape config:

   ```yaml showLineNumbers title="config/otel-collector.yaml (scrape header)"
             http_headers:
               X-Trino-User:
                 values: [otel]
   ```

2. Note that `values` takes a list. A flat `X-Trino-User: otel` is rejected
   by config validation.
3. Restart the Collector and confirm `up` returns to `1`.

### No `jvm_*`, `java_*`, or `process_*` metrics on the scrape

**Cause**: Nothing is broken. Only airlift-managed MBeans reach `/metrics`,
and `java.lang:*` is not among them, so Trino exports no JVM families at
all. Heap occupancy, GC pause time, and thread counts are not there by
default.

**Fix**: add the MBeans you want with `metrics.jmx-object-names` in
`config.properties` (renamed upstream from `openmetrics.jmx-object-names`,
which is kept as a legacy alias; the default is empty), then restart:

```properties showLineNumbers title="etc/trino/config.properties"
metrics.jmx-object-names=java.lang:type=Memory
```

That produces series such as:

```text showLineNumbers
JMX_java_lang_TYPE_Memory_ATTRIBUTE_HeapMemoryUsage_committed 4.69762048E8
JMX_java_lang_TYPE_Memory_ATTRIBUTE_ObjectPendingFinalizationCount 0.0
```

MBeans added this way use a third prefix and a different scheme,
`JMX_<domain>_TYPE_<type>_ATTRIBUTE_<attribute>`, not the `trino_` mangling
described above. Account for it in any scrape filter, keep-regex, or
dashboard you write.

### Trino refuses to start

**Cause**: Fewer than 4096 file descriptors are available to the process.

**Fix**:

1. In Docker or Compose, set a `nofile` ulimit on the Trino service
   (`soft` and `hard` at 65536 is a safe value).
2. On a host, raise the limit for the Trino user in
   `/etc/security/limits.conf` or the systemd unit's `LimitNOFILE`.
3. Give the process about 4 GB; heap tracks the container limit at 80
   percent.

### `RunningQueries` reads 0 while queries are clearly running

**Cause**: The gauges are sampled between queries. Anything that finishes
inside the scrape interval is usually invisible to them.

**Look at**: the counters instead -
`trino_execution_name_QueryManager_CompletedQueries` and `_StartedQueries`
for throughput, and the
`trino_execution_name_QueryManager_ExecutionTime_*` summaries for how long
work is taking.

**Fix**: build throughput panels and alerts on counter rates. Reserve the
gauges for concurrency and backlog, where a point-in-time read is what you
want.

### A query for `ExecutionTime_P95` returns nothing

**Cause**: The quantile is a label, not part of the metric name. There is no
`_P95`-style series.

**Fix**: query the summary and select the quantile:
`trino_execution_name_QueryManager_ExecutionTime_OneMinute{quantile="0.95"}`.
The same shape applies to `_QueuedTime_*`, `_AnalysisTime_*`, and
`_PlanningTime_*`, each in `OneMinute`, `FiveMinutes`, `FifteenMinutes`, and
`AllTime` windows.

### Queries are slow and nothing has failed

**Cause**: Queries are waiting on memory or on execution capacity rather
than erroring.

**Look at**: `trino_memory_type_ClusterMemoryPool_name_general_BlockedNodes`
and the reserved-over-total memory ratio first, then the slot ratio on
`trino_execution_executor_dedicated_name_ThreadPerDriverTaskExecutor_*`. If
both look healthy, split the latency by phase across the `_ExecutionTime_*`
summaries and the Diagnostic `_QueuedTime_*`, `_AnalysisTime_*`, and
`_PlanningTime_*` summaries, and use `trino_execution_scheduler_*` for stage
and split scheduling detail.

**Fix**:

1. Raise memory limits or add workers if the pool is the constraint.
2. Tune resource groups if the backlog is admission-side.
3. Look at the `planner` and `optimize` spans if planning is the phase that
   grew.

### Series volume is higher than expected

**Cause**: `trino_sql_planner_iterative_*` and `io_airlift_http_client_*`
are 66.5% of the series between them.

**Fix**: add the `metric_relabel_configs` drop from
[Controlling metric volume](#controlling-metric-volume). That takes the
surface from 2371 families to 551 without touching Core or
Operational.

### No spans arrive

**Cause**: Tracing is off, pointed at the wrong endpoint, or sampled out.

**Fix**:

1. Confirm `tracing.enabled=true` in `config.properties` and that Trino was
   restarted after the change.
2. Confirm `otel.exporter.endpoint` names the Collector's OTLP host and port
   and that `otel.exporter.protocol` matches the receiver protocol (`grpc`
   on `4317`).
3. Raise `otel.tracing.sampling-ratio` temporarily if the rate is low enough
   that whole traces are being dropped.

### No metrics appearing in Scout

**Cause**: Telemetry is collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Do I need a JMX exporter or a javaagent?

No. Trino publishes its MBeans as OpenMetrics on `/metrics` over its normal
HTTP port, so the Collector scrapes Trino directly. There is no exporter
sidecar and no `-javaagent` flag. Cassandra and most other JVM components
are wired differently.

### Why does the scrape need a header when my server has no authentication?

`/metrics` is a management-read resource, and Trino requires a caller
identity on those regardless of whether authentication is configured. An
unauthenticated request gets 401 with `WWW-Authenticate: Basic
realm="Trino"`. Three mechanisms satisfy it: Basic authentication,
`X-Trino-Original-User`, or `X-Trino-User`. The Collector sends the last of
these through the `prometheus` receiver's `http_headers` key.

### Why do `StartedQueries` and `CompletedQueries` not match?

Because `StartedQueries` counts only queries that reached execution. A query
rejected during analysis never starts, yet it does complete. The identity
that holds is:

```text showLineNumbers
StartedQueries + FailedQueries = CompletedQueries
```

For example, 42 started, 14 failed, 56 completed, where one query in four
was a reference to a missing table. That makes
`CompletedQueries - StartedQueries` a free pre-execution failure signal with
no metric of its own: it counts queries that died before execution began.

This has two consequences. A dashboard computing success rate as
`StartedQueries / CompletedQueries` reads low, because the denominator
includes queries that never started. The trace data shows the same split:
there is one `analyzer` span per query, but a `planner` span only for the
queries that survive analysis.

### Why does `ActiveWorkerCount` read 0 on my single-node install?

Because with `node-scheduler.include-coordinator=true` the coordinator does
the work and there is no separate worker process.
`trino_node_name_CoordinatorNodeManager_ActiveWorkerCount` reads `0` while
`ActiveNodeCount` reads `1`. That is the expected reading on a single node,
not an outage. On a multi-node cluster the two differ meaningfully, and
`ActiveNodeCount` below the expected count is the alert to write.

### Does enabling tracing give me metrics over OTLP?

No. `tracing.enabled` installs the tracing module and nothing else. Trino's
JMX metrics never travel over OTLP and its spans carry no metrics, so you
need both the scrape and the OTLP receiver to get both signals.

### How do I get heap and GC metrics?

Add the MBeans explicitly with `metrics.jmx-object-names` and re-read the
endpoint. The series that appear use the `JMX_` prefix and a different
naming scheme from the rest of the surface. See
[No `jvm_*`, `java_*`, or `process_*` metrics on the
scrape](#no-jvm_-java_-or-process_-metrics-on-the-scrape).

### Can a client trace continue into Trino?

Yes. Trino honours an incoming W3C `traceparent` on `POST /v1/statement`:
its server span becomes a child of the client's span and the whole
query trace inherits the client's trace ID. The CLI has no `--http-header`
option, so this only works for clients that go through the HTTP API.

### Does this work with Trino running in Kubernetes?

Yes. Point `targets` at the coordinator service DNS on port `8080`
(for example `trino.default.svc.cluster.local:8080`), keep the
`http_headers` block, and set `otel.exporter.endpoint` to the Collector
service for traces. Set the `nofile` ulimit and the memory request on the
Trino pod as you would on any host.

## Related Guides

- [ClickHouse Monitoring](./clickhouse.md) - Column-oriented OLAP database
  that stores the data it queries, where Trino stores nothing and queries
  other systems.
- [Cassandra Monitoring](./cassandra.md) - Wide-column store monitored
  through a JMX exporter, the pattern Trino does not use.
- [Apache Airflow Monitoring](./airflow.md) - Workflow orchestrator that
  commonly schedules the queries Trino runs.
- [Materialize Monitoring](./materialize.md) - Streaming SQL engine that
  maintains results incrementally rather than planning each query fresh.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  Trino metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [ClickHouse](./clickhouse.md), [Airflow](./airflow.md), and the catalogs
  Trino federates over.
- **Fine-tune Collection**: The per-rule and per-pool families can be
  filtered with `metric_relabel_configs` if you want a smaller surface, and
  `otel.tracing.sampling-ratio` sets the trace volume you keep.
