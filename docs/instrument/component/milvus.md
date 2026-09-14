---
title: >
  Milvus OpenTelemetry Monitoring - Search Latency, Ingestion Lag,
  and Collector Setup
sidebar_label: Milvus
id: collecting-milvus-telemetry
sidebar_position: 62
description: >
  Collect Milvus metrics and traces with the OpenTelemetry Collector.
  Monitor search latency, request errors, ingestion lag and segment
  growth in base14 Scout.
keywords:
  - milvus opentelemetry
  - milvus otel collector
  - milvus metrics monitoring
  - milvus performance monitoring
  - opentelemetry prometheus receiver milvus
  - milvus observability
  - vector database monitoring
  - milvus telemetry collection
---

# Milvus

Milvus serves Prometheus text at `/metrics` on port `9091` with no flag to
enable it, and can push OTLP traces to the Collector once tracing is turned
on. This guide collects request rate and error rate, search and insert
latency, per-collection entity counts, ingestion lag, and the segment and
memory pressure a Milvus node actually hits. An instance with collections
and traffic declares 347 metric names; the Collector scrapes them with the
Prometheus receiver and receives spans on its OTLP receiver, and both
pipelines ship to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Milvus                 | 2.6     | 2.6.23      |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Milvus 2.6 is the line where standalone runs as one container, with etcd
embedded in the process and data on a local volume. Earlier lines need the
full external dependency stack - etcd, MinIO and Pulsar as separate
services - which changes both the deployment and the metric surface, since
each dependency then exposes its own endpoint to scrape. Milvus 3.0 is not
covered by this guide.

Before starting:

- Port `9091` must be reachable from the host running the Collector.
  `/metrics` and `/healthz` are served there, always on, with no flag to
  enable them.
- `/metrics` has no authentication. Scrape Milvus on the internal network,
  or exempt the path at a fronting proxy; it must not be exposed publicly.
- Port `9091` is separate from `19530`, which carries both the gRPC API and
  the REST v2 API.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Coming from a pre-2.6 deployment?
On 2.6 the standalone container runs etcd in-process and stores data
locally, so the separate etcd, MinIO and Pulsar services go away - along
with the scrape jobs and alerts pointed at them. Full notes:
[Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

**gRPC and REST are instrumented differently, and only gRPC gets an error
rate.** This is the single most important fact about the surface. Over
gRPC, `milvus_proxy_req_count` carries `function_name` (`Search`,
`Insert`, and so on), a `status` label with `success`, `fail` and `total`,
and a `cause` label on failures. The same requests over the REST v2 API
move only `milvus_proxy_restful_api_req_count`, whose only labels are
`path`, `node_id` and `le` - no status, no HTTP code. **A REST-only
deployment has no error-rate metric at all.** Every official Milvus SDK
defaults to gRPC, so most deployments are on the instrumented path; check
which one yours is on by looking for `function_name="Search"` rows on
`milvus_proxy_req_count` while search traffic is running. If your clients
are on REST v2, instrument the client side to get error signals.

**`status` is not a partition: `total` = `success` + `fail`.**
`milvus_proxy_req_count` emits `success`, `fail` and `total` as three
separate series, and `total` is already the sum of the other two. Summing
across the `status` label therefore double-counts every request. The error
ratio is `status="fail"` over `status="total"`:

```text title="Error ratio"
rate(milvus_proxy_req_count{status="fail"}[10m])
  / rate(milvus_proxy_req_count{status="total"}[10m])
```

never `fail` over the sum of the label values.

**Failed requests never reach the per-collection latency histograms.**
`milvus_proxy_collection_sq_latency` and
`milvus_proxy_collection_mutation_latency` count successful work only. That
is what you want for a latency SLO and wrong for a request count: a panel
built on their `_count` series silently undercounts by every failure. Use
them for percentiles, and `milvus_proxy_req_count` for rate.

**`collection_name` is an unbounded label driven by client input.** It is a
real label on 19 metric families, and it takes whatever the client sent,
including names of collections that do not exist. Those label values never
expire, so a client looping over generated names inflates the metrics
backend without limit. Treat `metric_relabel_configs` on `collection_name`
as the default posture for any Milvus scrape exposed to untrusted or
generated collection names - see [Configuration](#configuration) for the
block.

**The surface is very large before any data exists.** An idle instance with
zero collections declares 219 metric names and 6370 series; two small
collections take it to 347 names and 9231 series. About 75% of the raw
series are histogram buckets, which the Prometheus receiver collapses into
one data point each - 1827 OTel data points under load. Expect the volume,
watch `scrape_samples_scraped` as the cardinality alarm, and note that the
Diagnostic families are the bulk of it (the write-ahead log alone is 54
names).

**There is no single metric prefix, and 31 names have no prefix at all.**
Loaded, the exposition is `milvus_` (238 names), `internal_` (40), `go_`
(29), `process_` (9), and 31 bare index-engine names - `build_latency`,
`exec_latency`, `search_latency`, `load_latency`, `queue_latency`,
`cache_hit_cnt`, `io_cnt`, `diskann_*`, `hnsw_*`, `ivf_*`. Those are
generic enough to collide with anything else in a shared metrics backend,
and no prefix filter can gate them. Namespace them at the Collector with a
`metricstransform` processor if your backend is shared.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the Milvus metrics endpoint responded. |
| `milvus_num_node` | Live nodes by `role_name`. In standalone all four roles read 1; a role dropping to 0 is a fault. |
| `milvus_proxy_req_count` | Requests by `function_name`, `status` and `collection_name`. Request rate and error rate. gRPC traffic only. |
| `milvus_proxy_sq_latency` | Search and query latency by `query_type`. The read SLO. |
| `milvus_proxy_mutation_latency` | Insert and delete latency by `msg_type`. The write SLO. |

`role_name` is not a general dimension. It appears on `milvus_num_node`
only, with the four standalone roles (`proxy`, `mixcoord`, `querynode`,
`datanode`); the rest of the surface is not sliceable by role. "Which role
is slow" has to be answered from the subsystem in the metric name instead -
`milvus_querynode_*`, `milvus_datacoord_*`, and so on.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `milvus_proxy_collection_sq_latency`, `_collection_mutation_latency` | Read and write latency split by `collection_name`. Successful work only. |
| `milvus_proxy_insert_vectors_count` | Vectors inserted per collection. Ingest volume. |
| `milvus_proxy_restful_api_req_count`, `_req_latency`, `_receive_bytes`, `_send_bytes` | REST v2 requests by `path`. No status label, so no error rate. |
| `milvus_proxy_cache_hit_count` | Metadata cache hits and misses by `cache_name` and `cache_state`. A rising miss ratio adds a round trip to every request. |
| `milvus_proxy_limiter_rate` | Rate limit currently applied, by `collection_id` and `msg_type`. A drop means Milvus is throttling clients. |
| `milvus_datanode_consume_tt_lag_ms` | Ingestion time-tick lag per collection. Rising lag means writes are accepted but not yet queryable. |
| `milvus_querynode_entity_num`, `_entity_size` | Entities and bytes loaded per collection by `segment_state` (`Growing`, `Sealed`). Data inventory. |
| `milvus_datacoord_stored_rows_num`, `_stored_binlog_size`, `_segment_num`, `_segment_binlog_file_count` | Persisted rows, bytes and segment counts. Growth and compaction health. |
| `milvus_querycoord_collection_num`, `_partition_num`, `_load_latency`, `_load_req` | Loaded collections and partitions, and how long loading takes. |
| `milvus_querycoord_current_target_checkpoint_unix_seconds` | Query-side checkpoint. Distance from now is read staleness. |
| `milvus_rootcoord_ddl_req_count`, `_ddl_req_latency`, `_ddl_req_latency_in_queue` | DDL rate and latency. Carries a `status="fail"` value. |
| `milvus_rootcoord_disk_quota` | Configured disk quota by `scope`. A config echo, not usage - see below. |
| `milvus_jemalloc_allocated_bytes`, `_active_bytes`, `_mapped_bytes`, `_fragmentation_bytes`, `_metadata_bytes`, `_overhead_bytes` | C++ allocator views. `_fragmentation_bytes` growing while allocated is flat is the memory-pressure signal. |
| `process_resident_memory_bytes`, `process_open_fds`, `process_max_fds`, `process_cpu_seconds_total` | Process ceilings. `open_fds` against `max_fds` is directly alertable. |
| `milvus_msg_queue_consumer_num` | Consumers on the internal message queue. |
| `scrape_samples_scraped` | Series count for this scrape job. On Milvus this is the cardinality alarm - `collection_name` takes client-supplied values. |

The collection appears under two different label keys. `collection_name` is
used on the proxy and querynode families; `collection_id`, a numeric
snowflake ID, is used on `milvus_datanode_consume_*`,
`milvus_proxy_limiter_rate` and the datacoord families. No series maps one
to the other, so a dashboard cannot join the two groups without an external
lookup - resolve the ID through the SDK's `describe_collection` and carry
it in your own dashboard variables.

`milvus_rootcoord_disk_quota` reports what is configured, not what is used.
On a default install it reads `1.7976931348623157e+308` - max float64,
meaning unlimited - for all three of `scope="cluster"`, `"db"` and
`"collection"`. Alerting on it is meaningless until you set a quota.

Shard, replica and balance families under `milvus_querycoord_*` exist on a
standalone node but stay at their single-node values. They become
meaningful on a cluster.

### Diagnostic - for investigation and tuning

Subsystem internals and runtime detail. Reach for these during an incident
or a capacity review; they are also where most of the series count lives.

| Group | Metrics | When you reach for it |
|---|---|---|
| Query node internals | `milvus_querynode_segment_access_*`, `_disk_cache_*` (59 names) | Segment access waits, disk-cache evictions and load durations. Where a slow query node is diagnosed. |
| Write-ahead log | `milvus_wal_*` (54 names), by `channel_name` and `interceptor_name` | Write-path internals. The largest single contributor to series count. |
| Streaming service | `milvus_streaming_*`, `milvus_streamingcoord_*` (18 names) | Streaming service internals. |
| Flowgraph consumption | `milvus_datanode_consume_bytes`, `_consume_msg`, `_msg_rows_count`, `_fg_buffer_size` | Detail behind the ingestion-lag gauge. |
| Runtime and bridge | `milvus_meta_*`, `milvus_cgo_*`, `milvus_thread_*`, `milvus_logging_*`, `milvus_runtime_*` | Metadata store, cgo bridge, thread pools, log volume. |
| Chunk cache | `internal_cache_*` (17 names) | Cell lifetimes, evictions and watermarks. |
| Storage and mmap | `internal_storage_*` (10 names), `internal_mmap_*`, `internal_cgo_*`, `internal_json_*`, `internal_core_search_latency` | Object-storage requests, memory maps, JSON indexing, core search latency. Carries `status="fail"`. |
| Index engine (unprefixed) | `build_latency`, `exec_latency`, `search_latency`, `load_latency`, `queue_latency`, `cache_hit_cnt`, `io_cnt`, `bitset_ratio`, `graph_search_cnt`, `bf_search_cnt`, `ivf_search_cnt`, `re_search_cnt`, `quant_compute_cnt`, `raw_compute_cnt`, `search_topk`, `search_level`, `range_search_latency`, `ann_iterator_init_latency`, `diskann_*`, `hnsw_*`, `filter_*`, `search_emb_list_*` (31 names) | Which index type ran, how far it searched, how much it filtered. Index tuning rather than operations - and the names are bare. |
| Build info | `milvus_build_info` | Info gauge; labels `version`, `git_commit`, `built`. |
| Go runtime | `go_*` (29 names) | `go_memstats_heap_inuse_bytes` and `go_goroutines` are the useful two. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Prometheus receiver scrape health. `scrape_samples_scraped` sits in the Operational tier above. |

`channel_name` is bounded: `rootCoord.dmlChannelNum` fixes it at 16 values
from startup and it does not grow with collections. It is the
second-largest label by series count but it is not a cardinality risk.

The embedded etcd does not leak its own metrics - there are no `etcd_`
series anywhere, even though etcd runs in-process. Standalone exposes only
Milvus's own metrics.

Full metric list: run `curl -s http://localhost:9091/metrics` against your
Milvus node.

### What the traces show

Milvus emits OTLP spans covering both user requests and internal work,
and the split matters: at `sampleFraction: 1` a single user search
produces roughly 100 spans across 95 distinct span names, most of them
internal. The largest span name is
`milvus.proto.rootcoord.RootCoord/AllocTimestamp`; several
(`SetRates`, `GetProxyMetrics`, `GetDataDistribution`) fire on timers
and appear with no user traffic at all. Treat `sampleFraction: 1` as a
debugging window, not a steady-state setting.

The instrumentation scopes are `segcore` and `knowhere` from the C++
core, `proxy`, `datanode`, `querynode`, `rootcoord` and `querycoord`
from the Go services, and `otelgrpc` for the gRPC layer. Search spans
carry bare, non-namespaced attribute keys - `nq`, `topk`, `k`, `dim`,
`rows`, `metric_type`, `search_type`, `result_count`. Span kinds are set
correctly (`Server`, `Client`, `Internal`).

Three things to know before you build searches on this:

- **Span status is never set.** Every span reports `Unset`, including
  failed operations, so errors cannot be found by span status. On gRPC
  spans, `rpc.grpc.status_code` is the only error signal in traces.
- **No span carries a collection name.** Traces cannot be grouped or
  filtered by collection.
- **gRPC spans use pre-1.21 semantic conventions for the peer
  address.** `net.sock.peer.addr` and `net.sock.peer.port`, where
  current semconv is `network.peer.address` and `network.peer.port`.
  Span processors and dashboards keyed on the current names will not
  match these spans.

## Key Alerts to Configure

Milvus's absolute latency, lag and segment figures depend on index type,
vector dimensionality, collection size and hardware, so every row below is
relative to your own trailing baseline or read against a limit exposed on
the same surface. Tune to your workload.

| Alert | Expression | Why it matters |
|---|---|---|
| Milvus down | `up == 0` for 2m | The metrics endpoint stopped answering; check the container and port 9091. |
| A role is gone | `milvus_num_node < 1` by `role_name` | In standalone all four roles must be present; on a cluster this counts nodes. |
| Request errors | `rate(milvus_proxy_req_count{status="fail"}[10m])` over `rate(milvus_proxy_req_count{status="total"}[10m])`, rising against baseline | Clients are failing. gRPC traffic only. Never sum across `status` - `total` already includes `fail`. |
| Search latency | a high quantile of `milvus_proxy_sq_latency{query_type="search"}` against its own baseline | Search is slowing. Successful searches only. |
| Insert latency | a high quantile of `milvus_proxy_mutation_latency{msg_type="insert"}` against its own baseline | The write SLO. |
| Ingestion lag | `milvus_datanode_consume_tt_lag_ms` rising against baseline | Writes are accepted but not yet queryable. |
| Read staleness | now minus `milvus_querycoord_current_target_checkpoint_unix_seconds` rising | Queries are serving from an old checkpoint. |
| Client throttling | `milvus_proxy_limiter_rate` dropping below its steady value | Milvus is rate-limiting clients; usually a quota or memory backstop. |
| Metadata cache misses | `milvus_proxy_cache_hit_count{cache_state="miss"}` share rising against baseline | Every miss adds a metadata round trip to a request. |
| Memory fragmentation | `milvus_jemalloc_fragmentation_bytes` rising while `milvus_jemalloc_allocated_bytes` is flat | The allocator is holding memory it cannot reuse. |
| File descriptor exhaustion | `process_open_fds / process_max_fds` high | Both sides of the ratio are on this surface; raise the process fd limit. |
| Segment count growth | `milvus_datacoord_segment_num` rising with no compaction | Small-segment proliferation degrades search. |
| Series count growth | `scrape_samples_scraped` rising against baseline | The cardinality alarm; usually `collection_name` taking new client-supplied values. |

The two latency rows are Prometheus histograms - there is no ready-made
percentile series to threshold. Compute it in the alert rule, for example
`histogram_quantile(0.99,
rate(milvus_proxy_sq_latency_bucket{query_type="search"}[5m]))`.

No alert here covers REST v2 error rate, because no metric does.

## Access Setup

There is nothing to turn on for metrics. Milvus serves `/metrics` on port
`9091` by default, with no flag and no credentials. What you do have to
decide is the cardinality posture for `collection_name`, and, if you want
traces, to edit the Milvus config - both are covered below.

The official image is multi-arch, so it runs native on arm64 as well as
amd64, and it ships `curl` (upstream's own healthcheck uses it). The health
endpoint is `/healthz` on `9091`.

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  milvus:
    image: milvusdb/milvus:v2.6.23
    command: ["milvus", "run", "standalone"]
    security_opt:
      - seccomp:unconfined     # required by the C++ core's memory setup
    environment:
      ETCD_USE_EMBED: "true"
      ETCD_DATA_DIR: /var/lib/milvus/etcd
      ETCD_CONFIG_PATH: /milvus/configs/embedEtcd.yaml
      COMMON_STORAGETYPE: local
      DEPLOY_MODE: STANDALONE
    volumes:
      - ./config/embedEtcd.yaml:/milvus/configs/embedEtcd.yaml:ro
      - ./config/user.yaml:/milvus/configs/user.yaml:ro   # trace settings
      - milvus-data:/var/lib/milvus
    ports:
      - "19530:19530"   # gRPC and REST v2
      - "9091:9091"     # /metrics and /healthz
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"]
      interval: 10s
      timeout: 10s
      retries: 20
      start_period: 60s

volumes:
  milvus-data:
```

Confirm the endpoint answers:

```bash showLineNumbers title="Verify access"
# Health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9091/healthz

# Metrics endpoint
curl -s http://localhost:9091/metrics | grep '^milvus_num_node'
```

### Turn on trace export

Tracing is off by default and turning it on takes three changes to the
shipped `milvus.yaml`, not one: `trace.exporter` is `noop`,
`trace.sampleFraction` is `0`, and `trace.otlp.secure` is `true`.
Override all three in `user.yaml`:

```yaml showLineNumbers title="config/user.yaml (Milvus)"
# overrides milvus.yaml; tracing is noop with zero sampling by default
trace:
  exporter: otlp          # default noop - no spans leave the process
  sampleFraction: 0.01    # default 0 - start low, raise to debug
  otlp:
    endpoint: otel-collector:4317
    method: grpc
    secure: false         # default true; keep true for a TLS Collector
```

Spans arrive on the Collector's `otlp` receiver, already in the
[Configuration](#configuration) block below:

```yaml showLineNumbers title="config/otel-collector.yaml (excerpt)"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: milvus
          scrape_interval: 15s
          static_configs:
            - targets:
                # host:port Milvus serves /metrics on
                - ${env:MILVUS_HOST}:9091
          metric_relabel_configs:
            # collection_name takes whatever clients send, including
            # names that do not exist; drop it from every family
            - regex: collection_name
              action: labeldrop

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317   # Milvus pushes spans here

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

The Prometheus receiver keeps everything `/metrics` exposes. There is no
per-metric enable list, so new series appear after a Milvus upgrade with no
Collector change. Scout authentication for the `otlphttp/b14` exporter is
covered in [Scout Exporter](../collector-setup/scout-exporter.md).

### Controlling `collection_name` cardinality

The `labeldrop` rule above removes `collection_name` everywhere, which is
the safe default when clients can name collections freely. If you dashboard
a small, known set of collections, keep the label on those families and
drop it from the rest:

```yaml showLineNumbers title="config/otel-collector.yaml (keep-list variant)"
          metric_relabel_configs:
            # mark the families that keep collection_name
            - source_labels: [__name__]
              regex: milvus_(proxy_collection_sq_latency|proxy_collection_mutation_latency|proxy_insert_vectors_count|querynode_entity_num|querynode_entity_size).*
              target_label: __tmp_keep_collection
              replacement: "yes"
            # everywhere else, blank the label (an empty value removes it)
            - source_labels: [__tmp_keep_collection]
              regex: ""
              target_label: collection_name
              replacement: ""
            - regex: __tmp_keep_collection
              action: labeldrop
```

Either way, watch `scrape_samples_scraped` after the change: it is the
series count for this job, and it is what tells you whether the posture is
holding.

### Namespacing the unprefixed index-engine names

31 metric names arrive with no prefix at all (`build_latency`,
`search_latency`, `cache_hit_cnt`, `io_cnt` and so on). In a shared metrics
backend they collide with any other job that uses the same generic words.

Rename them with a `metricstransform` processor, not with
`metric_relabel_configs`. Relabelling renames the raw scrape series, which
still carry their `_bucket`, `_sum` and `_count` suffixes, so a pattern
written against the metric name misses every histogram among these 31 -
and renaming at the receiver drops the type, unit and description, which
the Collector warns about on startup. The processor runs after the receiver
has reassembled the histograms, so it matches the metric name and keeps the
type:

```yaml showLineNumbers title="config/otel-collector.yaml (namespacing)"
processors:
  metricstransform:
    transforms:
      # $${1} escapes the capture group so the Collector does not
      # treat it as an environment variable
      - include: ^(build_latency|exec_latency|search_latency|load_latency|queue_latency|cache_hit_cnt|io_cnt|bitset_ratio|graph_search_cnt|bf_search_cnt|ivf_search_cnt|re_search_cnt|quant_compute_cnt|raw_compute_cnt|search_topk|search_level|range_search_latency|ann_iterator_init_latency|diskann_.*|hnsw_.*|filter_.*|search_emb_list_.*)$
        match_type: regexp
        action: update
        new_name: milvus_knowhere_$${1}
```

Add it to the metrics pipeline ahead of `batch`:

```yaml showLineNumbers title="config/otel-collector.yaml (pipeline)"
service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, metricstransform, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
MILVUS_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the request counter exists on the endpoint
curl -s http://localhost:9091/metrics | grep '^milvus_proxy_req_count'

# Check Collector logs for scraped Milvus metrics
docker logs otel-collector 2>&1 | grep "milvus_"
```

An idle instance with no collections still exposes 219 metric names, so a
large scrape is not evidence that anything is being used. Confirm real
traffic instead: `milvus_proxy_req_count` with `function_name="Search"` and
`status="total"` moving, and `milvus_querynode_entity_num` non-zero for a
loaded collection.

In Scout, query `milvus_proxy_sq_latency` by `query_type` to confirm the
read-path histograms arrived.

Spans only appear after `sampleFraction` is non-zero **and** traffic has
run. If both are true and nothing arrives, check the Collector logs for
OTLP receive errors and see
[Troubleshooting](#no-spans-are-arriving).

## Troubleshooting

### No error-rate data despite failing requests

**Cause**: The clients are on the REST v2 API, which has no `status` label.
`milvus_proxy_restful_api_req_count` counts requests by `path` only.

**Look at**: `milvus_proxy_req_count` - if there are no
`function_name="Search"` or `"Insert"` rows while search traffic is
running, the traffic is REST.

**Fix**:

1. Move clients to a gRPC SDK if you want a server-side error rate. Every
   official Milvus SDK defaults to gRPC.
2. Otherwise instrument the client side for error signals, and keep this
   surface for node health, inventory and resource ceilings, which are
   interface-independent.

### The error rate reads about twice what it should

**Cause**: The query summed across the `status` label. `total` is already
`success` + `fail`, so summing counts every request twice.

**Fix**:

1. Compute the ratio as `status="fail"` over `status="total"`.
2. Never use `sum by (...) (milvus_proxy_req_count)` without pinning
   `status` to a single value.

### A request-rate panel undercounts

**Cause**: The panel is built on `milvus_proxy_collection_sq_latency` or
`milvus_proxy_collection_mutation_latency`. Those histograms record
successful work only, so failures never reach them.

**Fix**:

1. Use `milvus_proxy_req_count` for rate.
2. Keep the per-collection histograms for percentiles and per-collection
   latency comparisons.

### Search latency is up and the proxy metrics do not explain it

**Cause**: the proxy histogram measures the whole request. When it rises
with a flat request rate, the time is being spent on the query node -
usually waiting on segment access or reloading from the disk cache.

**Look at**: the Diagnostic tier's query-node internals,
`milvus_querynode_segment_access_*` and `_disk_cache_*`, for access waits,
cache evictions and load durations. `internal_cache_*` covers the chunk
cache behind them, and `internal_storage_op_count` says whether the node
is going back to object storage.

**Fix**: give the query node enough memory to hold the working set, or
reduce it - `milvus_querynode_entity_num` by `segment_state` shows how
much is loaded. These families are the largest group in the Diagnostic
tier, so re-enable them for the investigation rather than scraping them
continuously.

### Metric names collide with another service in the backend

**Cause**: 31 index-engine names arrive with no prefix - `build_latency`,
`search_latency`, `cache_hit_cnt`, `io_cnt` and the rest. No prefix filter
can gate them.

**Look at**: the Diagnostic index-engine group; grep the exposition for
`^search_latency` to see the bare names.

**Fix**: Namespace them at the Collector with the `metricstransform`
rename in [Configuration](#namespacing-the-unprefixed-index-engine-names).
Do not try this with `metric_relabel_configs`: it operates on the raw
scrape series, so it misses every histogram among these names and strips
the type off the ones it does match.

### The series count climbs with no new deployments

**Cause**: `collection_name` is taking client-supplied values. It is a
label on 19 families and accepts names of collections that do not exist;
those values never expire.

**Look at**: `scrape_samples_scraped` - a steady rise against its own
baseline with unchanged traffic is the signal.

**Fix**:

1. Apply the `collection_name` `metric_relabel_configs` block from
   [Configuration](#controlling-collection_name-cardinality).
2. If the count is still climbing, check the Diagnostic families - the
   write-ahead log group alone is 54 names.

### A dashboard cannot join two metric families

**Cause**: The collection is keyed differently in different places -
`collection_name` on the proxy and querynode families, `collection_id` (a
numeric snowflake ID) on `milvus_datanode_consume_*`,
`milvus_proxy_limiter_rate` and the datacoord families.

**Fix**:

1. Resolve the ID with the SDK's `describe_collection` and carry the
   mapping in your dashboard variables. No series on this surface maps one
   key to the other.
2. Do not join the two groups directly; the join silently returns nothing.

### No spans are arriving

**Cause**: One of the three trace settings is still at its default - most
often `trace.otlp.secure: true` against a plaintext Collector endpoint.

**Look at**: the Milvus logs for OTLP exporter connection errors, and the
Collector logs for OTLP receive activity.

**Fix**:

1. Confirm all three are set: `exporter: otlp`, a non-zero
   `sampleFraction`, and `secure: false` for a plaintext Collector.
2. Confirm `user.yaml` is actually mounted at
   `/milvus/configs/user.yaml` and Milvus was restarted after the edit.
3. Send real traffic - spans exist only for work that runs.

### Trace volume is overwhelming the backend

**Cause**: `sampleFraction` is at or near 1. Roughly 100 spans are produced
per user search, and timer-driven internal spans arrive even with no user
traffic.

**Fix**:

1. Lower `sampleFraction` to a small value for steady state and raise it
   only for a debugging window.
2. Restart Milvus for the change to take effect.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter, and
   that the traces pipeline exists if you enabled tracing.

## Updates & Upgrades

### Milvus version changes

- **Pre-2.6 → 2.6**: standalone runs as a single container - etcd embedded
  in the process, data on a local volume, no MinIO and no Pulsar. Remove
  those services from your deployment, and remove the scrape jobs and
  alerts pointed at them; their metrics disappear with them, and the
  embedded etcd exposes no `etcd_` series of its own. Everything in this
  guide is served from Milvus's own `:9091/metrics`. _(breaking for the
  deployment and for any dependency-scoped dashboards)_
- **3.0**: Milvus 3.0 exists as a separate line and is not covered by this
  guide. Its metric surface has not been confirmed against these tables;
  verify names against your own instance before reusing dashboards or
  alerts there.

### Collector / receiver changes

- This guide uses the **prometheus receiver** for metrics and the **otlp
  receiver** for traces. Neither has a receiver-key rename across the
  supported Collector range, so the Collector config is stable on an image
  bump. New Milvus series are picked up with no Collector change, because
  there is no per-metric enable list. _(no breaking change)_

## FAQ

### Does this cover REST v2 traffic?

Partially. `milvus_proxy_restful_api_req_count` and its latency and byte
siblings count REST requests by `path`, so you get request rate and
latency. You do not get an error rate: the only labels are `path`,
`node_id` and `le` - no status and no HTTP code - and REST requests do not
increment `milvus_proxy_req_count` for `Search` or `Insert`. For a
server-side error rate, use a gRPC SDK; otherwise instrument the client.

### Why is `total` not the sum of my `status` values?

It is the sum, and that is the point. `milvus_proxy_req_count` emits
`success`, `fail` and `total` as three separate series, with `total`
already equal to `success` + `fail`. Adding the three together
double-counts every request. Take the error ratio as `status="fail"` over
`status="total"`.

### Should I turn on tracing?

Yes for a debugging window, at a low sample fraction; no at
`sampleFraction: 1` in steady state. At full sampling Milvus produces
roughly 100 spans per user search across 95 span names, dominated by
internal work such as `RootCoord/AllocTimestamp`, plus timer-driven spans
that arrive with no user traffic. Also know what traces will not answer:
span status is always `Unset`, so errors have to be read from
`rpc.grpc.status_code`, and no span carries a collection name.

### How do I monitor a distributed Milvus cluster?

Each node serves its own `/metrics` on port 9091, so add a scrape target
per node and let `node_id` separate them. The shard, replica and balance
families under `milvus_querycoord_*` only become meaningful there; on a
standalone node they sit at their single-node values. Distributed behaviour
is not covered here - confirm those series against your own cluster before
alerting on them.

### How do I keep the series count under control?

Two levers. Apply `metric_relabel_configs` to `collection_name`, which is
the only unbounded label on the surface. Then watch
`scrape_samples_scraped` to confirm the result and to catch future growth.
For where the series sit: the write-ahead log group, `milvus_wal_*`, is 54
metric names and the largest single contributor to the series count.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Milvus metrics.
- [Qdrant Monitoring](./qdrant.md) - Vector store with a far smaller metric
  surface; useful contrast when sizing scrape cost.
- [Weaviate Monitoring](./weaviate.md) - Vector store with a comparable
  two-signal surface and the same split between REST and gRPC accounting.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Qdrant](./qdrant.md), [vLLM](./vllm.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic
  and retention needs, and settle the `collection_name` relabel posture
  before opening the endpoint to client-named collections.
