---
title: >
  Restate OpenTelemetry Monitoring - Invocation Outcomes, Partition Lag,
  and Collector Setup
sidebar_label: Restate
id: collecting-restate-telemetry
sidebar_position: 65
description: >
  Collect Restate metrics and traces with the OpenTelemetry Collector.
  Monitor invocation outcomes, invoker health, partition lag, and retries
  in base14 Scout.
keywords:
  - restate opentelemetry
  - restate otel collector
  - restate metrics monitoring
  - durable execution monitoring
  - opentelemetry prometheus receiver restate
  - restate observability
  - restate tracing
  - restate invocation monitoring
  - restate telemetry collection
---

# Restate

Restate serves Prometheus text on the node-control port `5122` with no
switch to turn on, and the OpenTelemetry Collector's `prometheus`
receiver scrapes it for 211 metric families covering invocation inflow
and outcome, invoker and connection-pool saturation, partition health,
log and metadata latency, and the RocksDB storage engine underneath.
Restate also pushes OTLP traces that follow an invocation from the
ingress through every retry attempt to its terminal result, which makes
it one of the few durable-execution engines where the trace surface
describes your workflows rather than the engine's internals. This guide
covers both surfaces, the Collector configuration and shipping to
base14 Scout.

## Prerequisites

| Requirement            | Minimum   | Recommended |
| ---------------------- | --------- | ----------- |
| Restate                | 1.7       | 1.7.9       |
| OTel Collector Contrib | 0.90.0    | latest      |
| base14 Scout           | Any       | -           |

:::warning Upgrading?
Restate renames metrics inside a minor line as well as across one, and five
Operational families are absent on 1.7.0. Pin 1.7.9 or later. Full notes:
[Updates & Upgrades](#updates--upgrades).
:::

Before starting:

- The Collector must reach port `5122` over plain HTTP. Restate serves
  the exposition with no authentication, so restrict the port at the
  network layer rather than at the application.
- Set `RESTATE_NODE_NAME`. Left unset it defaults to the container ID,
  which changes on every recreate and strands every series that carried
  the old value.
- Decide the partition count before provisioning. It is fixed at
  provisioning time and it drives cardinality - see
  [Partition count sets cardinality](#partition-count-sets-cardinality).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or a capacity review.

Every series carries `cluster_name` and `node_name`. The labels listed
below are the ones beyond those two.

### Core - are invocations arriving, completing and keeping up

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the node is reachable. |
| `restate_ingress_requests_total` | Invocation inflow and outcome at the ingress, by `status`, `rpc_service` and `rpc_type`. The headline signal. |
| `restate_ingress_request_duration_seconds` | End-to-end ingress latency. Use `_sum` and `_count`, not the quantile series. |
| `restate_invoker_invocation_tasks_total` | Invocation attempts started, completed and failed against the service deployment, by `status`, `transient` and `partition_id`. |
| `restate_invoker_client_requests_total` | HTTP status of the invoker's calls to the service deployment, by `status_code` and `type`. Non-200 means the deployment is unreachable or broken. |
| `restate_partition_applied_lsn_lag` | Records between the last applied LSN and the log tail. The backlog signal. Gauge with a `quantile` label. |
| `restate_num_partitions` | Partitions in the partition table. |
| `restate_num_active_partitions` | Partitions this node has started. Below `restate_num_partitions` means a partition failed to start. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `restate_num_active_partition_leaders` | Partitions this node leads. |
| `restate_invoker_enqueue_total` | Invocations added to the invoker queue, by `partition_id`. |
| `restate_invoker_concurrency_limit` | Concurrency slots per `invoker_id`. Defaults to 1000. |
| `restate_invoker_concurrency_slots_acquired` | Slots taken. |
| `restate_invoker_concurrency_slots_released` | Slots given back. Acquired minus released is in-flight work. |
| `restate_invoker_task_duration_seconds` | Time to complete one invocation attempt. |
| `restate_invoker_sent_bytes_total`, `restate_invoker_received_bytes_total` | Bytes exchanged with service deployments, by `type`. |
| `restate_invocation_client_requests_total` | Partition-processor RPC attempts, by `partition_id` and `status`. |
| `restate_ingress_http_connection_created_total`, `restate_ingress_http_connection_dropped_total` | Ingress connection churn. The dropped counter carries `status`. |
| `restate_failure_detector_nodes_total` | Nodes per `state`: `alive`, `dead`, `suspect`, `failing_over`. |
| `restate_failure_detector_lonely` | This node has not heard gossip for too long. |
| `restate_partition_start_total` | Partition-processor starts per `partition`. Repeated increases mean crash-restart churn. |
| `restate_partition_num_unknown_applied_lsn_lag` | Partitions whose lag cannot be computed. |
| `restate_partition_snapshot_age_seconds` | Age of the newest partition snapshot. `NaN` until a snapshot destination is configured. |
| `restate_partition_time_since_last_status_update_seconds` | Staleness of partition status reporting. |
| `restate_partition_apply_command_duration_seconds` | Time to apply one partition-processor command, by `command` and `leader`. |
| `restate_partition_record_committed_to_read_latency_seconds` | Commit-to-read delay on the log. |
| `restate_bifrost_sequencer_append_duration_seconds` | Log append latency as the sequencer sees it. |
| `restate_bifrost_sequencer_store_duration_seconds` | Log-server store latency, by `node_id`. |
| `restate_log_server_store_records_total`, `restate_log_server_store_bytes_total` | Records and bytes accepted into the log store, by `status`. |
| `restate_metadata_client_get_total`, `restate_metadata_client_put_total` | Metadata reads and writes, by `status`. |
| `restate_metadata_client_get_duration_seconds`, `restate_metadata_client_put_duration_seconds` | Metadata operation latency. |
| `restate_connection_pool_connection_open_failed_total`, `restate_connection_pool_stream_open_failed_total` | Failed HTTP/2 connection attempts and stream reservations against service deployments. |
| `restate_connection_pool_acquire_stream_duration_seconds` | Time blocked waiting for a free HTTP/2 stream. |
| `restate_jemalloc_resident_bytes` | Resident memory. Restate is Rust, so there are no `go_` or `process_` families here. |
| `restate_memory_pool_usage_bytes`, `restate_memory_pool_capacity_bytes` | Memory pool usage and capacity, by `name`. |

`restate_bifrost_*` is Restate's internal log abstraction. It has
nothing to do with the LLM gateway of the same name covered in
[Bifrost Monitoring](./bifrost.md).

The two `connection_pool` failure counters register only after an open
actually fails, so a healthy node exposes neither. Write those alerts so
an absent series reads as zero.

### Diagnostic - for investigation and tuning

This tier holds most of the family count and none of the alerts. On a
node with the default 24 partitions it is about 170 of the 211
families.

| Metric group | Count | When you reach for it |
|---|---|---|
| `restate_rocksdb_*` | 125 | Storage-engine internals: compaction, write stalls, block cache, memtables, SST reads, per-column-family sizes. |
| `restate_metadata_server_*` | 14 | Raft internals of the embedded metadata server: LSNs, indexes, leader id, snapshot size, per-operation counts and durations. |
| `restate_connection_pool_*` (remaining) | 6 | HTTP/2 connection and stream lifecycle counts. |
| `restate_bifrost_replicatedloglet_*` | 5 | Record-cache hits and enqueued bytes inside the log abstraction. |
| `restate_jemalloc_*` (remaining) | 5 | Allocator detail: active, allocated, mapped, metadata, retained. |
| `restate_metadata_client_get_version_*`, `restate_metadata_server_get_version_*` | 4 | Metadata version-check traffic. |
| `restate_usage_leader_action_count_total`, `restate_usage_leader_journal_entry_count_total` | 2 | Invocation actions and journal entries processed by partition leaders. |
| `restate_partition_shuffle_inflight`, `restate_partition_shuffle_message_total` | 2 | Cross-partition message shuffling. |
| `restate_tokio_worker_mean_poll_time`, `restate_tokio_worker_poll_count` | 2 | Async-runtime scheduling detail, by `runtime` and `worker`. |
| `restate_log_server_loglet_started_total`, `restate_log_server_write_batch_size_bytes` | 2 | Log-server lifecycle and batch sizes. |
| `restate_failure_detector_instance`, `restate_failure_detector_gossip_sent_total` | 2 | Gossip identity and volume. |
| `restate_partition_handle_leader_action_total` | 1 | Leader actions by `action` type. |
| `restate_network_service_accepted_request_bytes_total` | 1 | Bytes accepted per internal service `target`. |

### Reading the ingress counter

`restate_ingress_requests_total` carries four `status` values and they
do not form one partition. `admitted` counts every request the ingress
accepted and carries no `rpc_service` or `rpc_type` label. `completed`,
`invocation_error` and `request_error` split those same requests and do
carry both labels. Summing across `status` therefore double-counts
every request, and a per-service error ratio cannot use `admitted` as
its denominator - the label it would need is not there.

Use `completed + invocation_error + request_error` as the denominator
for an error ratio, and `admitted` minus that sum as an in-flight
estimate.

The three terminal statuses mean different things:

- `invocation_error` - the handler ran and failed permanently. A
  business failure.
- `request_error` - the ingress rejected the request before any handler
  ran: unknown handler, malformed body, wrong content type. A caller
  problem.
- `completed` - the handler returned successfully.

### A handler failure is not an invoker failure

A handler that fails permanently returns its failure in-band. The
invocation attempt completes, `restate_invoker_client_requests_total`
records HTTP 200, and
`restate_invoker_invocation_tasks_total{status="failed"}` does not move.
Terminal failures surface only as
`restate_ingress_requests_total{status="invocation_error"}`.

`restate_invoker_invocation_tasks_total{status="failed"}` carries a
`transient` label, and only `transient="true"` is emitted in practice -
those are the retryable failures the invoker itself saw. Infrastructure
failures and business failures live in different families, so alert on
both.

### Summaries, quantiles and NaN

42 of the families are Prometheus summaries, and three more are declared
`gauge` but carry a `quantile` label. Three things follow.

**Quantile series are rolling and read zero when idle.** The quantile a
summary reports is computed over a rolling window, not since process
start. When traffic stops, the quantile decays to `0` within about a
minute while `_count` stays frozen at its last value. A latency panel
built on `quantile="0.99"` reads 0 on an idle service, which looks
identical to "very fast". Build latency panels on
`rate(_sum) / rate(_count)`, which is cumulative and aggregatable.

**The quantile set is not uniform, and the maximum has two spellings.**
Most summaries carry `0.5`, `0.9`, `0.99` and `1`. Twenty RocksDB
summaries carry `0.5`, `0.95`, `0.99` and `1.0` instead. A query pinned
to `quantile="0.9"` returns nothing for those twenty, and one pinned to
`quantile="1"` misses every series that spells the maximum `1.0`.

**Three gauges need a quantile pin too.**
`restate_partition_applied_lsn_lag`,
`restate_partition_snapshot_age_seconds` and
`restate_partition_time_since_last_status_update_seconds` are gauges
with `quantile` values `0.5`, `0.9`, `0.99` and `1.0`, and no `_sum` or
`_count` companions. Every query against them must pin a quantile or it
returns four series per node.

`restate_partition_snapshot_age_seconds` reports `NaN` on all four
quantiles until a snapshot destination is configured, and the Collector
passes `NaN` straight through. A `> threshold` alert on it never fires
until snapshots are turned on.

### Partition count sets cardinality

`default-num-partitions` defaults to 24. Each partition gets its own
RocksDB column family, and RocksDB families are emitted once per column
family, so the series count scales with it: roughly 61 series per
partition on top of a fixed base. A node provisioned with 4 partitions
serves about 1800 idle series where the default serves about 3000.
`partition_id` is also a label on the invoker and invocation-client
families.

The value is baked in at cluster provisioning and cannot be changed
afterwards, so choose it before the first start.

### Duplicate `# TYPE` lines

The exposition carries about 1193 `# TYPE` lines for 211 distinct
names, because each RocksDB family is emitted once per column family
with its own header. The Prometheus exposition format forbids that. The
OpenTelemetry Prometheus receiver accepts it without warning and every
family arrives intact, so this needs no workaround - but a stricter
Prometheus-compatible scraper may reject the payload.

### What the traces show

Restate pushes OTLP traces that describe invocations, not engine
internals. Each invocation produces four spans, all `Kind: Internal`:

| Span name | Meaning |
|---|---|
| `ingress <target>` | The HTTP request that admitted the invocation. Root span when the caller sends no `traceparent`. |
| `invocation-start <target>` | The invocation's durable life. Carries the journal as span events. |
| `invocation-attempt <target>` | One attempt against the service deployment. A retried invocation has several. |
| `invocation-end <target>` | The terminal result. |

`<target>` is the invocation target with the key templated, so
`counter/{key}/add` rather than `counter/user-42/add`. Virtual-object
and workflow keys never reach span names, which keeps span-name
cardinality at four per handler rather than four per invocation.

Four properties make this surface useful:

- **An incoming `traceparent` is honoured.** A caller's trace continues
  through the durable invocation: all four spans join the caller's
  trace and the `ingress` span is parented to the caller's span.
- **Service-to-service calls stay in one trace.** A handler that fans
  out to four others produces a single trace carrying a start / attempt
  / end triple for each callee, each parented to the caller's attempt
  span.
- **Retries are visible as repeated attempts.** A handler that fails
  twice before succeeding produces three `invocation-attempt` spans
  against one `invocation-start` and one `invocation-end`.
- **The journal is on the span.**
  `restate.invocation.lifecycle.new_command` events on
  `invocation-start` carry `restate.journal.command.type`, with values
  such as `Command/Call`, `Command/Sleep`, `Command/Run`,
  `Command/SetState` and `Command/GetEagerState`. A
  `restate.invocation.lifecycle.run_ended` event names the completed
  `ctx.run` side-effect block.

Span attributes are `rpc.*` plus Restate's own `restate.*` namespace.
`invocation-attempt` carries `restate.deployment.address`,
`restate.deployment.id` and
`restate.deployment.service_protocol_version`. `invocation-end` carries
`restate.invocation.result` (`success` or `failure`) and, on failure,
`restate.invocation.error.code` and `error.message`.

Two things to know before you build searches on this:

- **Only `invocation-attempt` and `invocation-end` set an error
  status.** `ingress` and `invocation-start` stay `Unset` even for
  invocations that failed. Search for failures on `invocation-end`.
- **The ingress spans use deprecated attribute names.**
  `client.socket.address` and `client.socket.port` were replaced by
  `network.peer.address` and `network.peer.port` in semantic
  conventions 1.21. Restate still emits the old pair.

Restate sets `service.name=restate`, `service.namespace=Restate`,
`service.version` and
`service.instance.id=<cluster-name>/<node-name>` on its own spans. A
`resource` processor that upserts `service.name` overwrites Restate's
value; the other three survive. Leave `service.name` out of the
processor if you want Restate's own naming.

## Key Alerts to Configure

Invocation rate, partition lag and run duration are workload-specific,
so most rows below are written as ratios or as comparisons against your
own history rather than as absolute numbers.

| Metric | Threshold | Why it matters |
|---|---|---|
| `up` | `== 0` for 2 scrapes | The node is gone or unreachable. |
| `restate_ingress_requests_total` | `invocation_error` ratio against the sum of the three terminal statuses above the 7-day ratio by `> 2x` over 15m | Handlers are failing permanently. Never use `admitted` as the denominator. |
| `restate_ingress_requests_total` | `request_error` rate above the 24h p95 for 10m | Callers are sending requests the ingress rejects before any handler runs. |
| `restate_ingress_request_duration_seconds` | `rate(_sum) / rate(_count)` above the 7-day mean for that `rpc_service` by `> 2x` over 15m | End-to-end latency regression. Quantile series are unusable for this. |
| `restate_invoker_client_requests_total` | any `status_code` other than 200 increasing over 10m | The service deployment is unreachable or returning HTTP errors, as distinct from handlers failing. |
| `restate_invoker_invocation_tasks_total` | `status="failed"` rate above the 24h p95 for 10m | Transient failures are driving retries. |
| `restate_partition_applied_lsn_lag` | `quantile="1.0"` above the 24h p95 for 10m | A partition processor is falling behind the log. |
| `restate_num_active_partitions` | `< restate_num_partitions` for 5m | A partition failed to start on this node. |
| `restate_partition_start_total` | any increase over 10m after steady state | Partition processors are crash-restarting. |
| `restate_failure_detector_nodes_total` | `state="dead"` or `state="suspect"` `> 0` for 5m | Cluster membership is degraded. |
| `restate_invoker_concurrency_slots_acquired` | acquired minus released within `10%` of `restate_invoker_concurrency_limit` for 10m | The invoker is saturated and new invocations queue. |
| `restate_connection_pool_connection_open_failed_total` | any increase over 10m | The node cannot open connections to service deployments. |
| `restate_metadata_client_put_total` | `status` other than success increasing over 10m | Metadata writes are failing, which blocks cluster changes. |
| `restate_jemalloc_resident_bytes` | above the 24h p95 by `> 1.5x` | Memory growth ahead of an OOM. |
| `restate_partition_snapshot_age_seconds` | `quantile="1.0"` above your snapshot interval by `> 3x` | Snapshots have stopped. Only meaningful once a snapshot destination is configured. |

## Access Setup

### Reach the metrics endpoint

The endpoint is on by default and needs no flag. It lives on the
node-control port, which is separate from both the ingress and the admin
API:

| Port | Serves | `/metrics` |
|---|---|---|
| 8080 | Ingress (invocations) | Returns 400 - the ingress reads the path as an invocation target |
| 9070 | Admin API | Returns 404 |
| 5122 | Node control | The exposition, plus `/health` |

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  restate:
    image: restatedev/restate:1.7.9
    environment:
      # without this, node_name defaults to the container ID
      RESTATE_NODE_NAME: restate-1
    ports:
      - "8080:8080"   # ingress
      - "9070:9070"   # admin
      - "5122:5122"   # node control, serves /metrics
    volumes:
      - restate-data:/restate-data
```

Confirm the exposition before touching the Collector:

```bash showLineNumbers title="Verify access"
curl -s http://localhost:5122/metrics | grep -c '^restate_'
curl -s http://localhost:5122/metrics | grep '^restate_ingress_requests_total'
```

`RESTATE_DISABLE_PROMETHEUS=true` does not turn the endpoint off. It
turns off Restate's own recorder while the RocksDB statistics path keeps
serving, so the endpoint still returns 200 with about 115 RocksDB
families and no `cluster_name` or `node_name` labels on any of them. If
you want no metrics surface, block the port; the switch will not do it.

The exposition is plain HTTP with no authentication. Bind port 5122 to
an internal interface or restrict it to the Collector's address.

### Turn on trace export

Traces are off by default and push to the Collector rather than being
scraped:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  restate:
    environment:
      # OTLP gRPC; also settable as --tracing-endpoint
      RESTATE_TRACING_ENDPOINT: "http://otel-collector:4317"
      # default
      RESTATE_TRACING_FILTER: "info"
```

Restate can split trace export in two:
`--tracing-services-endpoint` takes the invocation spans described
above and `--tracing-runtime-endpoint` takes the engine's internal
spans. `--tracing-endpoint` sets both. On the default `info` filter only
the invocation spans are produced, so the single endpoint is the right
starting point.

## Configuration

The `prometheus` receiver handles metrics and the `otlp` receiver
handles the pushed traces. The scrape is unfiltered, so no metric enable
list is needed; the Prometheus receiver synthesises the `up` series
alongside `scrape_duration_seconds`, `scrape_samples_scraped`,
`scrape_samples_post_metric_relabeling` and `scrape_series_added`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: restate
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:RESTATE_HOST}:5122

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
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
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest` or a
pinned tag of it. Drop the traces pipeline if you are only collecting
metrics.

The `resource` processor deliberately does not set `service.name`.
Restate sets its own on the trace path, and on the metrics path the
`job_name` above supplies it. Adding a `service.name` upsert overwrites
Restate's value on spans.

The RocksDB families are most of the payload. If you do not want them,
drop them at the receiver rather than downstream:

```yaml showLineNumbers title="config/otel-collector.yaml (Diagnostic drop)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'restate_(rocksdb|metadata_server|tokio)_.*'
              action: drop
```

That takes the family count from 211 to about 70, and since the RocksDB
families are emitted once per column family it removes most of the
series too. Keep `restate_rocksdb_*` if you are tuning storage or
chasing write stalls.

### Environment Variables

```bash showLineNumbers title=".env"
RESTATE_HOST=localhost
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers
# The exposition is reachable
curl -s http://localhost:5122/metrics | grep -c '^restate_'

# The Collector is scraping Restate
docker logs otel-collector 2>&1 | grep -i "restate_ingress_requests_total"

# Traces are arriving, if the traces pipeline is enabled
docker logs otel-collector 2>&1 | grep -i "invocation-start"
```

In Scout, `up{job="restate"}` should read 1 and
`restate_ingress_requests_total` should climb as invocations run. On a
node that has served no traffic, expect about 192 families rather than
211: the ingress, invoker and connection-pool families register on
first use.

## Troubleshooting

### `/metrics` returns 400 or 404

**Cause**: the scrape is pointed at the ingress port or the admin port.

**Look at**: the `up` series for the `restate` job, and the status code
from a manual `curl`. The ingress on 8080 returns 400 because it reads
`/metrics` as an invocation target; the admin API on 9070 returns 404.

**Fix**: point the scrape at port `5122`.

### The endpoint returns 200 but no `restate_ingress_*` series arrive

**Cause**: either the node has served no invocations yet, or
`RESTATE_DISABLE_PROMETHEUS` is set.

**Look at**: whether the response carries `cluster_name` and
`node_name` labels. With the recorder disabled, only RocksDB families
remain and none of them carry those labels.

**Fix**:

1. Unset `RESTATE_DISABLE_PROMETHEUS` and restart the node.
2. Send an invocation and re-scrape. The ingress and invoker families
   register on first use.

### Latency panels read zero on a quiet service

**Cause**: the panel is built on a summary's `quantile` series, which
is computed over a rolling window and decays to `0` when traffic stops.

**Look at**: the matching `_count` series. If it is frozen and the
quantile is 0, the service is idle rather than fast.

**Fix**: rebuild the panel on `rate(_sum) / rate(_count)`.

### A quantile query returns no data

**Cause**: the quantile label set is not uniform. Most summaries carry
`0.9`; twenty RocksDB summaries carry `0.95` instead, and the maximum
is spelled `1` on some families and `1.0` on others.

**Fix**: check the label values on that specific family before pinning
one, or match with `quantile=~"0.9|0.95"` and `quantile=~"1|1.0"`.

### Invocations slow down but the invoker looks healthy

**Cause**: the storage engine is throttling writes. Invoker concurrency
and handler latency both read normally while every journal append waits
on RocksDB.

**Look at**: the Diagnostic-tier `restate_rocksdb_*` group, starting
with `restate_rocksdb_actual_delayed_write_rate_bytes`. A non-zero value
means RocksDB has entered write throttling; the compaction and memtable
families in the same group say which column family is behind.

**Fix**: give the data volume faster storage or more of it, then
re-check the rate. If you dropped `restate_rocksdb_*` at the receiver to
save series, re-enable it for the investigation and drop it again after.

### Memory climbs steadily under constant load

**Cause**: allocator retention rather than a leak. Restate is Rust and
reports through jemalloc, so resident memory can hold well above live
allocations.

**Look at**: `restate_jemalloc_resident_bytes` against the Diagnostic
tier's `restate_jemalloc_*` detail - `active`, `allocated`, `mapped`,
`metadata` and `retained`. Resident far above allocated is retention;
allocated rising with it is real growth.

**Fix**: alert on `restate_jemalloc_resident_bytes` against its own 24h
p95 rather than a fixed ceiling, and treat a rising `allocated` as the
signal that needs a service-side answer.

### Series disappear after a restart

**Cause**: `RESTATE_NODE_NAME` is unset, so `node_name` carries the
container ID and changes on every recreate.

**Fix**: set `RESTATE_NODE_NAME` to a stable value and keep it stable
across recreates.

### Metrics arrive but traces do not

**Cause**: `RESTATE_TRACING_ENDPOINT` is unset, or the Collector has no
`otlp` receiver on the traces pipeline.

**Look at**: Collector logs for OTLP receiver startup, and the node's
logs for export errors.

**Fix**:

1. Set `RESTATE_TRACING_ENDPOINT` to the Collector's gRPC address with
   an `http://` scheme.
2. Confirm the traces pipeline lists both the `otlp` receiver and the
   exporter.

## Updates & Upgrades

Restate's metric surface is not additive across releases, and renames land
inside a minor line as well as across one.

### Restate version changes

- **1.5 → 1.6**: a `_count` suffix is dropped from 25 RocksDB families.
  Rewrite any query that carries it. _(breaking)_
- **1.6 → 1.7**: `restate_invoker_available_slots` is replaced by
  `restate_invoker_concurrency_slots_acquired` and `_released`, read against
  `restate_invoker_concurrency_limit`;
  `restate_rocksdb_actual_delayed_write_rate` gains a `_bytes` suffix;
  `restate_network_message_processing_duration_seconds` and
  `restate_network_message_received_bytes_total` are replaced by
  `restate_network_service_accepted_request_bytes_total`; and
  `restate_rocksdb_min_log_number_to_keep` is removed. _(breaking)_
- **1.6 → 1.7**: the whole `restate_connection_pool_*` group,
  `restate_ingress_http_connection_*`,
  `restate_invoker_client_requests_total`,
  `restate_invoker_sent_bytes_total` and `_received_bytes_total`,
  `restate_log_server_store_*`, `restate_memory_pool_*` and 40 RocksDB
  families arrive. `restate_invoker_client_requests_total` is what separates
  a broken service deployment from a failing handler, which is why 1.7 is
  the floor for the Core tier. _(additive)_
- **1.7.0 → 1.7.9**: four renames land inside the minor line.
  `restate_partition_time_since_last_status_update` gains a `_seconds`
  suffix, `restate_partition_shuffle_message_count` becomes
  `restate_partition_shuffle_message_total`,
  `restate_partition_shuffle_inflight_count` becomes
  `restate_partition_shuffle_inflight`, and
  `restate_partition_is_effective_leader` is replaced by
  `restate_num_active_partition_leaders`. A dashboard built against 1.7.0
  needs review at 1.7.9. _(breaking)_
- **1.7.0 → 1.7.9**: `restate_invocation_client_requests_total`,
  `restate_partition_num_unknown_applied_lsn_lag` and
  `restate_partition_snapshot_age_seconds` arrive. With
  `restate_num_active_partition_leaders` and
  `restate_partition_time_since_last_status_update_seconds` from the renames
  above, that is five Operational families absent on 1.7.0 and present on
  1.7.9, so run 1.7.9 or later for the full set. _(additive)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no receiver-key
  rename across the supported Collector range, so the Collector config is
  stable on an image bump. Every rename above is component-side: it changes
  the series names in Scout and the queries built on them, not the scrape
  config. _(no breaking change on the Prometheus path)_

## FAQ

### Do I need to turn the metrics endpoint on?

No. It is on by default on port 5122 and there is no enable flag.
`RESTATE_DISABLE_PROMETHEUS` does not turn it off either - it strips
Restate's own families and leaves the RocksDB ones serving.

### Why is my node name a random hex string?

`RESTATE_NODE_NAME` is unset, so it defaults to the container ID. Set it
to a stable value; otherwise every recreate starts a new set of series
and abandons the old ones.

### Can I reduce the number of series?

Yes, two ways. Drop `restate_rocksdb_*`, `restate_metadata_server_*` and
`restate_tokio_*` at the receiver, which takes the family count from 211
to about 70 and most of the series with it. And provision fewer
partitions - each one adds a RocksDB column family and roughly 61 series

- but that choice is fixed at provisioning and cannot be changed
later.

### Do the traces show my workflow runs?

Yes. Unlike engines whose trace surface covers scheduler internals,
Restate emits a span per invocation lifecycle stage, honours an incoming
`traceparent`, keeps service-to-service calls in one trace, and shows
each retry as its own `invocation-attempt` span. The journal appears as
span events on `invocation-start`.

### Is `restate_bifrost_*` related to the Bifrost LLM gateway?

No. Bifrost is the name of Restate's internal log abstraction, the layer
that sequences and stores the replicated log. See
[Bifrost Monitoring](./bifrost.md) for the unrelated LLM gateway.

### Why does a handler failure not show up in the invoker metrics?

Because a permanent handler failure is returned in-band. The invocation
attempt completes, the invoker records HTTP 200 against the service
deployment, and the failure appears only as
`restate_ingress_requests_total{status="invocation_error"}`. The invoker
counters cover infrastructure failures, not business ones.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Restate metrics.
- [Temporal Monitoring](./temporal.md) - Durable-execution engine with a
  workflow-and-activity model rather than Restate's journal-and-handler one.
- [Hatchet Monitoring](./hatchet.md) - Task queue and durable-execution
  engine; compare backlog signals across the two.

## What's Next?

- **Create Dashboards**: Start with `restate_ingress_requests_total`
  split by `status`, `rate(_sum) / rate(_count)` on
  `restate_ingress_request_duration_seconds`, and
  `restate_partition_applied_lsn_lag` at `quantile="1.0"`. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add
  [Temporal](./temporal.md) or [Hatchet](./hatchet.md) if you run more
  than one execution engine.
- **Fine-tune Collection**: Decide whether you keep the RocksDB tier,
  and set the partition count deliberately before you provision - it
  drives both cardinality and throughput and cannot be changed
  afterwards.
