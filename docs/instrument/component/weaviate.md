---
title: >
  Weaviate OpenTelemetry Monitoring - Request Latency, Vector Index
  Queue, and Collector Setup
sidebar_label: Weaviate
id: collecting-weaviate-telemetry
sidebar_position: 63
description: >
  Collect Weaviate metrics and traces with the OpenTelemetry Collector.
  Monitor REST, GraphQL and gRPC latency, index queue depth, and object
  counts in Scout.
keywords:
  - weaviate opentelemetry
  - weaviate otel collector
  - weaviate metrics monitoring
  - weaviate performance monitoring
  - opentelemetry prometheus receiver weaviate
  - weaviate observability
  - weaviate vector database monitoring
  - weaviate telemetry collection
---

# Weaviate

Weaviate serves Prometheus text on port `2112` once
`PROMETHEUS_MONITORING_ENABLED` is set. The endpoint is off by default, and
without that variable the port is not served at all. The OpenTelemetry
Collector's Prometheus receiver scrapes it, collecting 258 metric names
covering request accounting across REST, GraphQL and gRPC, query and write
latency, the vector index and its ingestion queue, and the LSM storage
engine. Only 131 appear on an idle node; the rest arrive once traffic
runs. This guide enables the endpoint, configures the receiver, wires the
trace path, and ships both signals to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Weaviate               | 1.39    | 1.39.2      |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

The metric surface described below is the 1.39 line, and earlier lines
differ enough that this guide does not carry over to them - see
[Updates & Upgrades](#updates--upgrades). The trace path is gated behind
variables named `EXPERIMENTAL_*` on 1.39, so treat those variable names as
version-specific and re-check them on a minor upgrade.

Before starting:

- Weaviate must run with `PROMETHEUS_MONITORING_ENABLED=true`. The metrics
  endpoint is off by default. Without the variable, a scrape of port 2112
  gets a connection refused, not an empty page.
- The port is fixed at 2112 and cannot be changed. The config struct
  carries a port default of `8081`, but `PROMETHEUS_MONITORING_ENABLED`
  forces 2112 and the struct tag has no effect.
- Port 2112 must be reachable from the host running the Collector, and is
  separate from `8080` (REST and GraphQL) and `50051` (the gRPC data API).
- The metrics endpoint has no authentication. Scrape it on the internal
  network, or exempt the path at a fronting proxy; it must not be exposed
  publicly.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Upgrading from a pre-1.39 line?
The metric surface changed substantially. On 1.27 the endpoint serves 88
names rather than 258, three of the Core metrics below do not exist, and
the async index queue is named `index_queue_*` rather than `queue_*`.
Full notes: [Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or a capacity review.

Two properties of this surface shape everything you build on it. There is
no single metric prefix - 149 names carry `weaviate_` and 68 carry nothing
at all - so names have to be namespaced at the Collector before they reach
a shared backend. And the two client interfaces are counted by two
different metrics that do not overlap, so a dashboard built on one of them
under-reports a normal client. Both are handled in
[Configuration](#configuration) and explained under Core below.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Whether the last scrape of port 2112 succeeded. Liveness. Added by the receiver, not by Weaviate. |
| `requests_total` | REST and GraphQL requests by `api`, `class_name`, `query_type` and `status`. The only error rate for those two interfaces. |
| `weaviate_grpc_server_request_duration_seconds` | Latency and errors for the gRPC data API by `grpc_service`, `method` and `status`. The only view of gRPC search. |
| `weaviate_http_request_duration_seconds` | HTTP latency and status by `method`, `route` and `status_code`. No `class_name`, so it is the route-level view that survives a cardinality cap. |
| `queries_durations_ms` | Query latency as the client experiences it, by `class_name` and `query_type`. |
| `objects_durations_ms` | Write latency by `class_name`, `operation`, `shard_name` and `step`. |
| `object_count` | Objects per `class_name` and `shard_name`. Dataset size, and the signal that an unexpected collection appeared. |
| `vector_index_size` | Index growth per collection and shard, against the memory you have. |
| `queue_size` | Async indexing backlog per collection and shard. |

**Both request counters are in Core because neither alone covers a normal
client.** `requests_total` counts REST and GraphQL only; there is no
`api="grpc"` series at any point. gRPC traffic is counted solely by
`weaviate_grpc_server_request_duration_seconds`. The official clients are
hybrid: `weaviate-client` connected with `grpc_port=50051` sends searches
over gRPC and inserts over REST, so a dashboard built on `requests_total`
alone under-reports a Python or TypeScript client by the whole of its
search volume. This is also why the alerts below carry two separate
error-ratio rows.

The two counters differ in what they can tell you about a failure:

- gRPC error status is coarse. Searches against a collection that does not
  exist record `status="Unknown"`, not `NotFound`. The observed status
  values are `OK`, `Unknown` and `ResourceExhausted`.
- The gRPC path carries no `class_name`, so gRPC failures cannot be
  attributed to a collection from metrics, and the auto-schema hazard
  described in [Configuration](#auto-schema-and-metric-cardinality) is a
  REST and GraphQL problem only.
- `status` on `requests_total` has three values - `ok`, `user_error` and
  `server_error` - and the split is not a clean client/server split. A
  write with a vector of the wrong width, unambiguously a client mistake,
  returns HTTP 500 and records `server_error`. Do not read `user_error` as
  "client error".

**`requests_total` is declared a gauge.** The exposition carries
`# TYPE requests_total gauge` despite the `_total` suffix and monotonic
values, so the Collector forwards it as a gauge and it arrives in Scout as
a gauge. Check the panel type before writing a `rate()` query against it.
Six other names share the mismatch: `concurrent_queries_count`,
`lsm_segment_count`, `object_count`, `queue_count`,
`weaviate_index_shards_total` and `weaviate_lsm_bucket_segment_total`. The
last two are genuinely gauges; `requests_total` is not.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `concurrent_queries_count` | Queries in flight by `class_name` and `query_type`. |
| `queries_filtered_vector_durations_ms` | Filtered vector search latency by `class_name`, `operation` and `shard_name`. |
| `vector_index_durations_ms` | Time spent inside the index, broken out by `step`. |
| `vector_index_operations` | Index operations by `class_name`, `operation` and `shard_name`. |
| `vector_index_queue_insert_count`, `vector_index_queue_delete_count` | Work entering and leaving the async index queue, by `target_vector`. |
| `vector_index_tombstones`, `vector_index_tombstone_cleaned` | Deleted vectors awaiting cleanup, and cleanup progress. Read them together. |
| `queue_partition_processing_duration_ms` | How long a queue partition takes to drain. |
| `queue_disk_usage` | Bytes the async queue is holding on disk. |
| `queue_paused` | Whether the indexing queue is paused. |
| `lsm_memtable_size`, `lsm_active_segments` | Live memtable size and active segments per bucket, by `path` and `strategy`. |
| `lsm_segment_count`, `lsm_segment_size` | Segments and bytes per `level`. Growth here is compaction falling behind. |
| `weaviate_lsm_memtable_flush_failures_total` | Memtable flushes that failed, by `strategy`. Alert on any increase. |
| `weaviate_lsm_bucket_compaction_failure_count` | Compactions that failed, by `strategy`. Alert on any increase. |
| `weaviate_lsm_bucket_write_operation_failure_count`, `weaviate_lsm_bucket_read_operation_failure_count` | Storage-engine write and read failures. The write counter carries `operation`; the read counter carries `component` and `operation`. |
| `weaviate_http_requests_inflight` | Concurrent HTTP requests by `method` and `route`. |
| `weaviate_grpc_server_requests_inflight` | Concurrent gRPC calls by `grpc_service` and `method`. |
| `weaviate_index_shards_total` | Shards by `status` (`READY`, `LOADING`). A shard stuck in `LOADING` is not serving. |
| `weaviate_schema_shards`, `weaviate_schema_collections` | Schema-side shard and collection counts. Shards by `nodeID` and `status`; collections by `nodeID` and `collection_namespace`. |
| `shards_loaded`, `shards_loading`, `shards_unloaded`, `shards_unloading` | Node-level shard state totals. |
| `startup_progress`, `startup_durations_ms` | Shard load progress and elapsed time at boot, by collection, operation and shard. |
| `query_dimensions_total` | Vector dimensions touched by queries, by `class_name`, `operation` and `query_type`. |
| `token_count_total` | Tokens processed, by `tokenizer`. |
| `weaviate_vector_index_memory_allocation_rejected_total` | The index refused an allocation. Any increase means writes are hitting a memory ceiling. |
| `weaviate_build_info` | Version, revision, `goversion` and build tags as labels. Use it to confirm what is actually running. |

### Diagnostic - for investigation and tuning

The bulk of the surface. Higher cardinality and mostly internal; reach for
these during an incident or a capacity review.

| Group | Metrics | When you reach for it |
|---|---|---|
| LSM internals | `weaviate_lsm_bucket_*`, `weaviate_lsm_memtable_*` (about 30 names), `lsm_memtable_durations_ms` (192 series) | Write stalls, compaction behaviour, and where storage time goes. |
| Replication | `weaviate_async_replication_*`, `weaviate_replication_*` (about 35 names) | Cluster replication health. Structurally near-empty on a single node. |
| Raft and cluster membership | `weaviate_internal_*` raft and memberlist samplers and timers (about 20 summaries) | Leadership, apply latency and membership churn on a cluster. |
| Object TTL | `weaviate_objects_ttl_deletion_*` (12 names) | Whether a TTL policy is deleting on schedule. |
| Export and tenancy | `weaviate_export_*`, `weaviate_auto_tenant_*` | Export jobs and multi-tenancy activity. |
| Storage and IO internals | `checksum_*`, `mmap_*`, `file_io_*`, `batch_size_*`, `tombstone_find_*` | Disk-level behaviour behind a slow write path. |
| Tokenizer | `tokenizer_duration_seconds`, `token_count_per_request` | Text-tokenisation cost per request. |
| MCP | `weaviate_mcp_write_access_enabled` | Whether the MCP server has write access. |
| Runtime | `go_*` (30), `process_*` (9), `promhttp_*` (2) | Go heap, GC, file descriptors and CPU. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Receiver-side scrape health, not from Weaviate. `scrape_samples_scraped` is the cardinality alarm. |

Several families are present in the exposition but read zero unless the
matching feature is in use, and they are worth keeping for that reason:

- `weaviate_async_replication_*`, `weaviate_replication_*` and
  `weaviate_cluster_store_fsm_apply_failures_total` are zero on a single
  node, because there is nothing to replicate and single-node raft does not
  fail an apply.
- `weaviate_export_*` and `weaviate_objects_ttl_deletion_*` are zero until
  an export or a TTL policy is configured.
- `weaviate_auto_tenant_*` is zero until multi-tenancy is enabled.
- `weaviate_module_request_resends_total` is zero when no vectorizer module
  is loaded, because no module requests exist to resend.
- `graphql_namespaces_blocked_requests_total` is zero without namespace
  blocking.
- `weaviate_mcp_write_access_enabled` is zero when the MCP server is not in
  use.

The full list is on the endpoint itself:
`curl -s http://localhost:2112/metrics | grep '^# TYPE'`.

### What the traces show

Weaviate produces eight span names, all `Kind: Server`:

| Span name | Scope |
|---|---|
| `POST /v1/graphql` | `weaviate-http` |
| `POST /v1/objects` | `weaviate-http` |
| `GET /v1/.well-known/ready` | `weaviate-http` |
| `GET /v1/schema` | `weaviate-http` |
| `POST /v1/schema` | `weaviate-http` |
| `/weaviate.internal.cluster.ClusterService/JoinPeer` | `weaviate-grpc` |
| `/weaviate.internal.cluster.ClusterService/Query` | `weaviate-grpc` |
| `/weaviate.internal.cluster.ClusterService/NotifyPeer` | `weaviate-grpc` |

Two limits decide what traces can answer here:

- **There are no internal spans.** No span for a vector search, a GraphQL
  resolver, or an LSM read. Tracing gives you the request envelope and its
  duration, and nothing about where the time went inside Weaviate. For
  that, use `queries_durations_ms` and `vector_index_durations_ms`, which
  are broken out by `step`.
- **The gRPC spans are internal cluster RPCs**, on
  `weaviate.internal.cluster.ClusterService`. The client data API on 50051
  produces metrics but no spans, so gRPC client traffic is invisible to
  traces.

Span attributes use pre-1.21 HTTP semantic conventions. These are the
deprecated keys, so processors and dashboards keyed on current semconv
will not match:

| Key on the span | Observed values | Current semconv equivalent |
|---|---|---|
| `http.method` | `GET`, `POST` | `http.request.method` |
| `http.url` | `/v1/objects`, `/v1/graphql` | `url.path` |
| `http.status_code` | `200`, `422`, `500` | `http.response.status_code` |
| `http.user_agent` | `curl/8.22.0`, `Wget` | `user_agent.original` |

Some keys have no semconv equivalent at all: `duration_ms`,
`http.duration_ms`, `rpc.duration_ms`, `http.response_size`,
`http.request_id`, and a bare `status_code` duplicating
`http.status_code`. The keys that are correct are `rpc.system`,
`rpc.method`, `rpc.grpc.status_code`, `service.name` and
`service.version`.

## Key Alerts to Configure

Weaviate's absolute latency, queue depth and object counts depend on
vector dimensionality, index type, dataset size and hardware, so every row
below is relative to your own trailing baseline. Tune to your workload.

| Alert | Expression | Why it matters |
|---|---|---|
| REST/GraphQL error ratio | `requests_total{status!="ok"}` over all `requests_total`, rising against baseline | Clients on REST or GraphQL are failing. Covers no gRPC traffic. |
| gRPC error ratio | `weaviate_grpc_server_request_duration_seconds_count{status!="OK"}` over all, rising against baseline | Clients on the gRPC data API are failing. Needed separately because `requests_total` never sees them. |
| Query latency regression | a high quantile of `queries_durations_ms` against its own trailing baseline | Reads are slowing as the client experiences them. |
| Write latency regression | a high quantile of `objects_durations_ms{step="total"}` against baseline | The write SLO. Break it down by `step` to find where the time went. |
| Async index backlog growing | `queue_size` rising for 15 minutes without draining | Writes are accepted but not yet searchable, and the gap is widening. |
| Unexpected collection appeared | count of distinct `class_name` on `object_count` increases | A client created a collection you did not deploy. See below. |
| Vector index memory rejection | `weaviate_vector_index_memory_allocation_rejected_total` increases | The index hit a memory ceiling and refused an allocation. |
| Shard stuck loading | `weaviate_index_shards_total{status="LOADING"}` above zero for 10 minutes | A shard is not serving. Check `startup_progress` for where it stopped. |
| Memtable flush failing | `weaviate_lsm_memtable_flush_failures_total` increases | Writes are not reaching disk; data loss risk on restart. |
| Compaction failing | `weaviate_lsm_bucket_compaction_failure_count` increases | Segment count and read amplification will climb. |
| Tombstones accumulating | `vector_index_tombstones` rising while `vector_index_tombstone_cleaned` is flat | Deleted vectors are not being cleaned up; the index keeps paying for them. |
| Endpoint stopped serving | `up == 0` for 2 scrape intervals | The metrics endpoint stopped answering. Check the container and port 2112. |

The "unexpected collection appeared" row is the auto-schema alert, and it is
the only cheap detection for a client typo silently creating a collection.
The offending write returns HTTP 200 and records `status="ok"`, so nothing
in the error metrics moves. See
[Auto-schema and metric cardinality](#auto-schema-and-metric-cardinality).

Types differ across the latency rows. The two `_duration_seconds` metrics
are histograms, so a percentile comes from `histogram_quantile` over the
`_bucket` series. `queries_durations_ms` and `objects_durations_ms` are
summaries, so check the exposition for which quantile series they publish
before writing the rule, and fall back to `_sum / _count` for a mean.

## Access Setup

Weaviate serves metrics itself; no exporter is needed. The endpoint is off
by default, so turn it on with an environment variable:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  weaviate:
    image: cr.weaviate.io/semitechnologies/weaviate:1.39.2
    environment:
      # Off by default. Without this, port 2112 is not served at all.
      PROMETHEUS_MONITORING_ENABLED: "true"
      # Collapses class_name and shard_name to "n/a" - see below.
      PROMETHEUS_MONITORING_GROUP: "false"
      # Rejects writes to collections that do not exist - see below.
      AUTOSCHEMA_ENABLED: "false"
    ports:
      - "8080:8080"    # REST and GraphQL
      - "50051:50051"  # gRPC data API
      - "2112:2112"    # Prometheus metrics, fixed port
    volumes:
      - weaviate-data:/var/lib/weaviate

volumes:
  weaviate-data:
```

Confirm the endpoint before pointing the Collector at it:

```bash showLineNumbers title="Verify access"
# Expect metric text. A connection refused here means
# PROMETHEUS_MONITORING_ENABLED is not set on the running container.
curl -s http://localhost:2112/metrics | head -20

# Count declared names
curl -s http://localhost:2112/metrics | grep -c '^# TYPE'
```

### Turn on trace export

Traces are off by default and sit behind variables named `EXPERIMENTAL_*`
on 1.39. Four variables are needed, not two:

```yaml showLineNumbers title="compose.yaml (Weaviate trace variables)"
environment:
  EXPERIMENTAL_OTEL_ENABLED: "true"
  EXPERIMENTAL_OTEL_EXPORTER_OTLP_ENDPOINT: otel-collector:4317
  EXPERIMENTAL_OTEL_EXPORTER_OTLP_PROTOCOL: grpc
  # Default is 0.01. Without this you get one span in a hundred.
  EXPERIMENTAL_OTEL_TRACES_SAMPLER_ARG: "1.0"
```

The sampler argument is the one people miss. The default is `0.01`, so
setting only the endpoint and the enable flag gives one span in a hundred
and looks like broken tracing. Set it explicitly - to `1.0` while you are
wiring things up, then to whatever volume you can carry.

Spans arrive on the Collector's `otlp` receiver, already present in the
[Configuration](#configuration) block below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: weaviate
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:WEAVIATE_HOST}:2112   # Fixed metrics port

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  metricstransform:
    transforms:
      # $${1} escapes the capture group so the Collector does not
      # treat it as an environment variable
      - include: ^(requests_total|object_count|concurrent_queries_count|query_dimensions_total|graphql_namespaces_blocked_requests_total|tokenizer_duration_seconds|token_count_.*|queries_.*|objects_.*|vector_index_.*|queue_.*|shards_.*|startup_.*|lsm_.*|checksum_.*|mmap_.*|file_io_.*|batch_size_.*|tombstone_find_.*)$
        match_type: regexp
        action: update
        new_name: weaviate_$${1}

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
      processors: [resource, metricstransform, batch]
      exporters: [otlphttp/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Auto-schema and metric cardinality

`AUTOSCHEMA_ENABLED` defaults to true, and it turns a client typo into
permanent metric cardinality. A write naming a collection that does not
exist returns **HTTP 200**, silently creates it, and adds about **160
series** that persist for the life of the volume. With
`AUTOSCHEMA_ENABLED=false` the same write returns **HTTP 422** with
`class "X" not found in schema` and adds exactly **2 series**. Deleting the
collection through `DELETE /v1/schema/<Class>` removes its series, but the
next misspelled write recreates both the collection and the series.

Pick one of two postures:

- Set `AUTOSCHEMA_ENABLED=false` and create collections through a
  deployment step. Typos then fail loudly at the client instead of
  landing in the schema.
- Leave auto-schema on and alert on the collection count, using the
  "unexpected collection appeared" row in
  [Key Alerts](#key-alerts-to-configure). This is the fallback when
  clients legitimately create collections at runtime.

The hazard is confined to REST and GraphQL. The gRPC path carries no
`class_name`, so failing gRPC calls against a non-existent collection add
no `class_name`-labelled series.

### Controlling `class_name` and `shard_name` cardinality

`class_name` and `shard_name` are the two dominant cardinality drivers on
this surface. `PROMETHEUS_MONITORING_GROUP=true` collapses both to the
single value `n/a`. It works, it is the documented control, and it costs
you every per-collection and per-shard breakdown - no latency by
collection, no object counts by shard, no way to tell which collection is
growing. Take the trade only when the collection count is unbounded and
you have accepted route-level monitoring through
`weaviate_http_request_duration_seconds` instead.

`class_name="n/a"` also appears without the setting, on metrics that are
not collection-scoped. Seeing it is not proof that grouping is on.

### Namespacing the unprefixed metric names

68 of the 258 names arrive with no prefix at all, including
`object_count`, `requests_total`, `queue_size`, `queue_count`,
`startup_progress`, `shards_loaded`, `lsm_memtable_size`,
`token_count_total`, `concurrent_queries_count` and
`file_io_writes_total_bytes`. Those are generic enough to collide with any
other job in a shared metrics backend.

Weaviate cannot fix this for you.
`PROMETHEUS_MONITORING_METRIC_NAMESPACE` prefixes nothing on 1.39.2: the
value is parsed and never applied, so setting it to `weaviate` or to any
other string produces a byte-identical metric set with no renamed names.
Do not use it.

Prefix at the Collector instead. The `metricstransform` processor in the
config above is the fix, and its anchored patterns leave the `weaviate_`,
`go_`, `process_` and `promhttp_` families alone.

Do not do this with `metric_relabel_configs`. Relabelling runs on the raw
scrape series, which still carry their `_bucket`, `_sum` and `_count`
suffixes, so an anchored pattern written against the metric name misses
every histogram and summary among these names - and renaming at the
receiver drops the type, unit and description. The processor runs after
the receiver has reassembled the histograms, so it matches the metric name
and keeps the type.

### Environment Variables

```bash showLineNumbers title=".env"
WEAVIATE_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the request counter exists on the endpoint
curl -s http://localhost:2112/metrics | grep '^requests_total'

# Check Collector logs for the scrape job
docker logs otel-collector 2>&1 | grep -i weaviate
```

An idle node already exposes 131 metric names, so a non-empty scrape is
not evidence that anything is being used. Confirm real traffic instead:
`requests_total` moving for your `api` and `query_type`, and `object_count`
non-zero for a collection you loaded.

In Scout, query `queries_durations_ms` by `class_name` to confirm the read
path arrived, and `weaviate_grpc_server_request_duration_seconds` by
`method` to confirm the gRPC path arrived. If you applied the
`metricstransform` processor, query the renamed series
(`weaviate_requests_total`, `weaviate_object_count`) rather than the
originals.

Spans appear only after `EXPERIMENTAL_OTEL_TRACES_SAMPLER_ARG` is raised
**and** traffic has run. If both are true and nothing arrives, check the
Collector logs for OTLP receive errors.

## Troubleshooting

### Connection refused on port 2112

**Cause**: `PROMETHEUS_MONITORING_ENABLED` is not set on the running
container. The endpoint is off by default and the port is not bound at
all, so this is a refused connection rather than an empty response.

**Fix**:

1. Set `PROMETHEUS_MONITORING_ENABLED=true` and restart Weaviate.
2. Confirm with `curl -s http://localhost:2112/metrics | head`.
3. Do not try to move the port. It is fixed at 2112; the port default in
   the config struct has no effect once monitoring is enabled.

### A dashboard undercounts search traffic

**Cause**: The panel is built on `requests_total`, which covers REST and
GraphQL only. The official clients send searches over gRPC.

**Look at**: `weaviate_grpc_server_request_duration_seconds_count` by
`method`. If it is moving while `requests_total` is flat for searches, the
client is on gRPC.

**Fix**:

1. Add `weaviate_grpc_server_request_duration_seconds` to the panel and
   to the error-ratio alert.
2. Expect no `class_name` on the gRPC series - break gRPC down by `method`
   instead.

### `rate()` on `requests_total` returns nothing useful

**Cause**: `requests_total` is declared a gauge in the exposition, so it
reaches the backend as a gauge despite the `_total` suffix.

**Look at**: the metric type in Scout before writing the query. The same
mismatch affects `concurrent_queries_count`, `lsm_segment_count`,
`object_count` and `queue_count`.

**Fix**:

1. Use a gauge-appropriate expression - a delta over the window rather
   than `rate()`.
2. Where you need a true rate of failures, derive it from the gauge
   difference, or use the gRPC histogram's `_count`, which is a real
   counter.

### Series count keeps climbing with no deployments

**Cause**: Auto-schema. A client wrote to a misspelled collection, Weaviate
created it, and about 160 series came with it.

**Look at**: distinct `class_name` values on `object_count`, and
`scrape_samples_scraped` for the total series count per scrape.

**Fix**:

1. Delete the unwanted collection: `DELETE /v1/schema/<Class>`. The series go
   with it.
2. Set `AUTOSCHEMA_ENABLED=false` so the next typo returns HTTP 422
   instead of creating the collection again.
3. If clients must create collections at runtime, keep the collection-count
   alert and consider `PROMETHEUS_MONITORING_GROUP=true`.

### Metric names collide with another service in the backend

**Cause**: 68 names carry no prefix, and
`PROMETHEUS_MONITORING_METRIC_NAMESPACE` does not apply the one you set.

**Fix**:

1. Add the `metricstransform` processor from
   [Configuration](#namespacing-the-unprefixed-metric-names).
2. Update dashboards and alerts to the renamed series in the same change;
   the rename is not backward compatible.

### Only about half the metric names are there

**Cause**: The node is idle. 131 names are present at rest; the remaining
127 appear only once queries and writes run.

**Fix**:

1. Run representative traffic, then re-check
   `curl -s http://localhost:2112/metrics | grep -c '^# TYPE'`.
2. Do not whitelist against an idle scrape - it will drop the metrics you
   actually alert on.

### Writes are slow or stalling

**Cause**: The storage engine or the async index queue is behind.

**Look at**: `objects_durations_ms` by `step` first to find the slow
stage, then the Diagnostic LSM group - `lsm_memtable_durations_ms`,
`weaviate_lsm_bucket_*` and `weaviate_lsm_memtable_*` - for flush and
compaction behaviour. `queue_size` and `queue_disk_usage` show whether
indexing is the backlog.

**Fix**:

1. If flush or compaction failure counters are increasing, check disk
   space and IO before anything else.
2. If `queue_size` is growing while writes are steady, the index cannot
   keep up with ingestion; reduce concurrency or add capacity.

### Writes are rejected with the node still running

**Cause**: the vector index hit a memory ceiling.
`weaviate_vector_index_memory_allocation_rejected_total` increments and
the write fails, but the process stays up, so nothing restarts and
nothing else looks wrong.

**Look at**: `vector_index_size` by collection and shard for which index
grew into the ceiling, then the Diagnostic tier's Runtime group - the
`go_*` heap and GC families and `process_*` for resident size - to
separate index growth from general heap pressure. Weaviate holds the
index in memory, so resident size tracks index size closely.

**Fix**: raise the container memory limit, shard the collection, or
switch the affected collection to a disk-backed index. The rejection
counter is the only signal that writes are failing for this reason;
request-level errors report it as a generic failure.

### gRPC errors all report `status="Unknown"`

**Cause**: The gRPC status mapping is coarse. Searches against a
collection that does not exist record `Unknown`, not `NotFound`.

**Look at**: the `status` values on
`weaviate_grpc_server_request_duration_seconds`. `OK`, `Unknown` and
`ResourceExhausted` are the ones you will see.

**Fix**:

1. Alert on the non-`OK` ratio rather than on specific status values.
2. Go to the application logs or the client for the actual cause; the
   metric will not distinguish it.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## Updates & Upgrades

### Weaviate version changes

- **1.27 → 1.39**: the metric surface roughly tripled, from 88 names under
  load to 258, and `weaviate_build_info` stopped being the only
  `weaviate_`-prefixed name. Three metrics this guide puts in Core do not
  exist on 1.27 at all: `weaviate_http_request_duration_seconds`,
  `weaviate_grpc_server_request_duration_seconds` and `queue_size`. A
  dashboard built from this guide will render empty panels against an
  older server. _(additive in Weaviate; the Core tier here assumes 1.39)_
- **The async index queue family was renamed**: `index_queue_*` on 1.27
  became `queue_*` by 1.39, so `index_queue_size` is now `queue_size` and
  `index_queue_paused` is now `queue_paused`. Queries and alert rules
  written against the old names stop resolving on upgrade, and historical
  series keep the old names. _(breaking for your queries)_
- **`weaviate_mcp_write_access_enabled` and the
  `weaviate_objects_ttl_deletion_*` family are recent additions** and are
  absent from 1.27. Nothing needs to change for them; they appear on
  upgrade. _(additive)_
- **The trace path is behind `EXPERIMENTAL_*` variable names on 1.39.**
  Treat the variable names themselves as version-specific and re-check
  them on a minor upgrade, not just the values. _(may break on upgrade)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no receiver-key
  rename across the supported Collector range, so the Collector config is
  stable on an image bump. New Weaviate series are picked up with no
  Collector change, because there is no per-metric enable list. The
  `metricstransform` rename in the config below is anchored to the
  unprefixed names, so a new unprefixed name upstream needs adding to that
  pattern. _(no breaking change on the Prometheus path)_

## FAQ

### Why do half the metric names have no `weaviate_` prefix?

Weaviate registers 149 names under `weaviate_` and 68 with no prefix at
all, including generic ones like `object_count`, `requests_total` and
`queue_size`. There is no setting that fixes this on the component side -
`PROMETHEUS_MONITORING_METRIC_NAMESPACE` is parsed and never applied.
Prefix them at the Collector with the `metricstransform` processor shown
in [Configuration](#namespacing-the-unprefixed-metric-names).

### Why does my Python client's search traffic not show in `requests_total`?

`requests_total` covers REST and GraphQL only; there is no `api="grpc"`
value. The official clients are hybrid - connected with
`grpc_port=50051`, `weaviate-client` sends searches over gRPC and inserts
over REST. Searches are counted by
`weaviate_grpc_server_request_duration_seconds` instead. Chart and alert
on both.

### How do I stop a client typo from creating a collection?

Set `AUTOSCHEMA_ENABLED=false`. The write then returns HTTP 422 with
`class "X" not found in schema` and adds 2 series instead of creating the
collection and about 160 series. If clients legitimately create collections at
runtime, keep auto-schema on and alert on the count of distinct
`class_name` values on `object_count` - the write itself returns HTTP 200
and `status="ok"`, so no error metric will flag it.

### Does tracing show what happens inside a vector search?

No. Weaviate emits eight span names, all `Kind: Server`, covering the HTTP
request envelope and internal cluster RPCs. There is no span for a vector
search, a GraphQL resolver or an LSM read. Use `queries_durations_ms` and
`vector_index_durations_ms`, which break the work out by `step`.

### Does this work with Weaviate running in Kubernetes?

Yes. Set `PROMETHEUS_MONITORING_ENABLED=true` in the pod spec, expose
container port 2112, and point the scrape target at the Weaviate service
DNS (for example `weaviate.default.svc.cluster.local:2112`). Everything
else in this guide is unchanged.

### How do I keep the series count under control?

`class_name` and `shard_name` are the two dominant drivers.
`PROMETHEUS_MONITORING_GROUP=true` collapses both to `n/a` and works, at
the cost of all per-collection and per-shard visibility. Before reaching
for it, turn off auto-schema so client typos stop adding collections. Watch
`scrape_samples_scraped` to confirm the effect.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Weaviate metrics.
- [Qdrant Monitoring](./qdrant.md) - Vector store with a much smaller
  metric surface and no collection-level labels.
- [Milvus Monitoring](./milvus.md) - Vector store with the same unprefixed
  name problem, fixed the same way at the Collector.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Qdrant](./qdrant.md), [Milvus](./milvus.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic
  and retention needs, and settle the auto-schema and
  `PROMETHEUS_MONITORING_GROUP` posture before opening the API to
  client-named collections.
