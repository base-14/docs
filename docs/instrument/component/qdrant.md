---
title: >
  Qdrant OpenTelemetry Monitoring - Search Latency, Collection Points,
  and Collector Setup
sidebar_label: Qdrant
id: collecting-qdrant-telemetry
sidebar_position: 61
description: >
  Collect Qdrant metrics with the OpenTelemetry Collector. Monitor search
  latency, REST error rate, collection points, and mmap limits, and ship
  to base14 Scout.
keywords:
  - qdrant opentelemetry
  - qdrant otel collector
  - qdrant metrics monitoring
  - qdrant performance monitoring
  - opentelemetry prometheus receiver qdrant
  - qdrant observability
  - vector database monitoring
  - qdrant telemetry collection
---

# Qdrant

Qdrant serves Prometheus text at `/metrics` on its REST port (`6333`) with
no flag to enable it. The OpenTelemetry Collector scrapes it with the
Prometheus receiver, collecting request rate, error rate and latency for
the points data plane, per-collection point and vector counts, the write
and optimization queue, and the memory, mmap and file-descriptor ceilings
a Qdrant node actually hits. A node with collections and traffic exposes
49 metric names. This guide configures the receiver, sets the metric
prefix, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Qdrant                 | 1.16    | 1.19        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Qdrant 1.16 introduced `QDRANT__SERVICE__METRICS_PREFIX`. Below it there
is no way to namespace the metric names, and the generic defaults
(`app_info`, `collections_total`, `memory_resident_bytes`) are the only
option. Before starting:

- The REST port (`6333`) must be reachable from the host running the
  Collector. `/metrics` is served there, always on, with no flag to
  enable it.
- `/metrics` has no authentication and sits on the same port as the REST
  API, so it must not be exposed publicly. Scrape Qdrant on the internal
  network, or exempt the `/metrics` path at a fronting proxy.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Adopting the metric prefix?
Metric names are unprefixed unless you set
`QDRANT__SERVICE__METRICS_PREFIX`. Turning it on renames every series, so
dashboards and alert rules have to change in lockstep. Full notes:
[Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

**Names are unprefixed by default.** Without
`QDRANT__SERVICE__METRICS_PREFIX`, Qdrant exposes `app_info`,
`collections_total`, `cpu_cores_used` and `memory_resident_bytes`, names
generic enough to collide with any other job in a shared backend. Setting
`QDRANT__SERVICE__METRICS_PREFIX=qdrant_` prefixes all of them and changes
nothing else. The setting is available from Qdrant 1.16, and
upstream left it off by default for backward compatibility. Every metric
name and query below uses the prefixed form, so set the variable to get
these names.

**There are no gRPC metrics at all.** Qdrant serves gRPC on `:6334` and
nothing about it reaches `/metrics` - a grep for `grpc` over the
exposition returns nothing. gRPC is the faster path and what most Qdrant
SDKs default to, so a deployment whose clients use it gets zero request
rate, zero error rate and zero latency from this surface. This is the
single most important limitation of Qdrant's metrics. If your traffic is
gRPC, instrument the client side to get request signals at all.

**Only the points data plane is counted.**
`qdrant_rest_responses_total` and its duration siblings cover
`PUT /collections/{collection_name}/points`,
`POST /collections/{collection_name}/points` and
`POST /collections/{collection_name}/points/search`. GET requests are not
counted, collection management (creating, listing, describing or deleting
a collection) is not counted, and a 404 from a missing collection is
never recorded. That is a scope limit on the error rate: an alert built
on this metric will not see a client hammering a bad URL.

**The idle surface is less than half the real one.** A fresh instance
with no collections and no traffic exposes 21 metric names; with
collections and traffic it exposes 49. The collection-scoped and REST
families do not exist until there is a collection to describe and a
request to count, so do not build an alert list from a scrape of an empty
instance.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the Qdrant metrics endpoint responded. |
| `qdrant_app_status_recovery_mode` | 1 means the node started in recovery mode and is not serving normally. A state read, not a threshold. |
| `qdrant_rest_responses_total` | REST responses by `method`, `endpoint` and `status`. Request rate and error rate for the points data plane. |
| `qdrant_rest_responses_duration_seconds` | REST response duration by `method`, `endpoint` and `status`. The latency SLO. |

The `endpoint` label is templated - the value is the literal
`/collections/{collection_name}/points`, not the resolved path. Collection
names never enter labels, so cardinality stays flat no matter how many
collections exist, and a request to a nonexistent collection creates no
new label value.

Latency is exposed twice, in two different shapes. There is a real
histogram (`qdrant_rest_responses_duration_seconds`, with `_bucket`,
`_sum` and `_count`) and three pre-computed gauges
(`_avg_duration_seconds`, `_min_duration_seconds`,
`_max_duration_seconds`). The min and max are extremes since process
start, so `max` never comes back down and is not an incident signal. Use
the histogram for percentiles.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `qdrant_collection_points` | Points per collection, keyed by `id`. Data inventory and growth. |
| `qdrant_collection_vectors` | Vectors per collection, keyed by `collection` and `vector`. |
| `qdrant_collections_total` | Collections on the node. |
| `qdrant_collections_vector_total` | Vectors across all collections. |
| `qdrant_collection_update_queue_length` | Pending updates per collection. A rising queue means writes are outrunning the optimizer. |
| `qdrant_collection_update_queue_deferred_points` | Points deferred from the update queue. |
| `qdrant_collection_running_optimizations` | Optimizations in progress. Sustained non-zero under write load is normal; sustained non-zero at idle is not. |
| `qdrant_collection_indexed_only_excluded_points` | Points excluded from `indexed_only` searches because they are not yet indexed. Non-zero means those searches return incomplete results. |
| `qdrant_collection_dead_replicas` | Replicas the node considers dead. Any non-zero value on a cluster is a fault. |
| `qdrant_collection_active_replicas_min`, `_max` | Active replica count range across shards. |
| `qdrant_memory_resident_bytes` | Process RSS. The number to compare against the container limit. |
| `qdrant_memory_allocated_bytes`, `_active_bytes`, `_retained_bytes` | Allocator views: bytes in live allocations, in active pages, and retained by the allocator rather than returned to the OS. |
| `qdrant_process_open_mmaps` | Memory maps open. Qdrant maps segment files, so this grows with data. |
| `qdrant_system_max_mmaps` | The host `vm.max_map_count` ceiling. Denominator for the mmap ratio. |
| `qdrant_process_open_fds`, `qdrant_process_max_fds` | File descriptors in use and the limit. |
| `qdrant_cpu_cores_used` | CPU cores consumed. |
| `qdrant_process_major_page_faults_total` | Major page faults. A rising rate means the working set no longer fits in RAM and Qdrant is reading mapped segments from disk. |
| `qdrant_snapshot_creation_running`, `qdrant_snapshot_recovery_running` | A snapshot is being written or restored. Both are heavy operations that compete with serving. |
| `qdrant_snapshot_created_total` | Snapshots created, keyed by `id`. |

The collection name lives under two different label keys.
`qdrant_collection_points` and the whole
`qdrant_collection_hardware_metric_*` family use `id="docs"`, while
`qdrant_collection_vectors` uses `collection="docs"` plus a `vector=""`
key for the named-vector slot. A dashboard that joins on one key silently
drops the other family.

`qdrant_process_open_mmaps` against `qdrant_system_max_mmaps` is a real
ceiling. Qdrant maps segment files, and hosts with a low `vm.max_map_count`
hit the limit; both sides of the ratio are on this surface, so it is
directly alertable.

The replica and snapshot series exist on a single node but read 0 there:
`qdrant_collection_dead_replicas` is 0, the active-replica gauges report
1, and the snapshot gauges stay at 0 until a snapshot runs. They become
meaningful on a cluster and during snapshot operations.

### Diagnostic - for investigation and tuning

Per-collection attribution, allocator internals, and since-start
aggregates. Reach for these during an incident or a capacity review.

| Group | Metrics | When you reach for it |
|---|---|---|
| Per-collection I/O | `qdrant_collection_hardware_metric_vector_io_read`, `_vector_io_write`, `_payload_io_read`, `_payload_io_write`, `_payload_index_io_read`, `_payload_index_io_write` | Finding which collection is driving disk load, split by vector data, payload and payload index. |
| Per-collection CPU | `qdrant_collection_hardware_metric_cpu` | CPU accounting per collection, keyed by `id`. |
| Shard transfers | `qdrant_collection_shard_transfer_incoming`, `_outgoing` | Shard transfers in flight. Zero on a single node. |
| Duration aggregates | `qdrant_rest_responses_avg_duration_seconds`, `_min_duration_seconds`, `_max_duration_seconds` | Context only - these are since process start, so min and max never recover. |
| Allocator detail | `qdrant_memory_metadata_bytes` | Allocator metadata overhead. |
| Page faults | `qdrant_process_minor_page_faults_total` | Minor faults are served from memory. Context for the major-fault count in the Operational tier. |
| Threads | `qdrant_process_threads` | Thread count. |
| Build and mode | `qdrant_app_info` (labels `name`, `version`), `qdrant_cluster_enabled` | Which build is running and whether distributed mode is on. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Prometheus receiver scrape health. |

Full metric list: run `curl -s http://localhost:6333/metrics` against
your Qdrant node.

## Key Alerts to Configure

Threshold guidance for the Core and Operational series. Qdrant's absolute
latency, point counts and memory figures depend entirely on index size,
vector dimensionality and hardware, so every row below is relative to
your own trailing baseline or read against a limit exposed on the same
surface. Tune to your workload.

| Alert | Expression | Why it matters |
|---|---|---|
| Qdrant down | `up == 0` for 2m | The metrics endpoint stopped answering; check the container and port 6333. |
| Recovery mode | `qdrant_app_status_recovery_mode == 1` | The node came up degraded and is not serving normally. A state read, not a tuned threshold. |
| Request errors | `rate(qdrant_rest_responses_total{status=~"4..\|5.."}[10m])` rising against baseline | Clients are failing on the points endpoints. Covers the points data plane only; GETs and collection management are not counted. |
| Search latency | a high quantile of `qdrant_rest_responses_duration_seconds` for the search endpoint, against its own baseline | Search is slowing. Use the histogram, not the min and max gauges. |
| Write queue backing up | `qdrant_collection_update_queue_length` rising against baseline | Writes are outrunning the optimizer; slow the ingest rate or add capacity. |
| Stale search results | `qdrant_collection_indexed_only_excluded_points > 0` sustained | `indexed_only` searches are silently returning incomplete results. |
| mmap exhaustion | `qdrant_process_open_mmaps / qdrant_system_max_mmaps` above a fraction of the ceiling | Running out of maps takes the node down; raise `vm.max_map_count` on the host. |
| File descriptor exhaustion | `qdrant_process_open_fds / qdrant_process_max_fds` high | Same shape, same consequence; raise the process fd limit. |
| Memory against the container limit | `qdrant_memory_resident_bytes` approaching the configured limit | The limit is a deployment constant, not a metric, so compare against the value you set. |
| Working set no longer resident | `rate(qdrant_process_major_page_faults_total[15m])` rising from a near-zero baseline | Segments are being read from disk; latency follows. Add RAM or shrink the working set. |
| Dead replicas | `qdrant_collection_dead_replicas > 0` | A replica is unreachable. Cluster deployments only. |

The latency row is a Prometheus histogram - there is no ready-made
percentile series to threshold. Compute it in the alert rule, for example
`histogram_quantile(0.99,
rate(qdrant_rest_responses_duration_seconds_bucket[5m]))`.

No alert here covers gRPC traffic, because no metric does.

## Access Setup

There is nothing to turn on. Qdrant serves `/metrics` on the REST port by
default, with no flag and no credentials. What you do have to set is the
metric prefix, so the names do not collide with other jobs in a shared
backend.

The official image is multi-arch, so it runs native on arm64 as well as
amd64.

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  qdrant:
    image: qdrant/qdrant:v1.19.1
    environment:
      QDRANT__SERVICE__METRICS_PREFIX: qdrant_   # prefixes every metric name
    ports:
      - "6333:6333"   # REST API and /metrics
      - "6334:6334"   # gRPC - not covered by /metrics
    volumes:
      - qdrant-storage:/qdrant/storage
    healthcheck:
      test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/6333 && printf 'GET /readyz HTTP/1.0\r\n\r\n' >&3 && head -1 <&3 | grep -q '200 OK'"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  qdrant-storage:
```

The Qdrant image ships no `curl`, `wget`, `nc` or `python`, only `bash`,
so a container healthcheck has to open the socket with bash's `/dev/tcp`,
as above. The health endpoints are `/healthz`, `/livez` and `/readyz`.

Confirm the endpoint answers from a host that has `curl`:

```bash showLineNumbers title="Verify access"
# Readiness
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:6333/readyz

# Metrics endpoint, prefixed names
curl -s http://localhost:6333/metrics | grep '^qdrant_' | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: qdrant
          scrape_interval: 15s
          static_configs:
            - targets:
                # host:port Qdrant's REST API is reachable on
                - ${env:QDRANT_HOST}:6333

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

The Prometheus receiver keeps everything `/metrics` exposes. There is no
per-metric enable list; new series appear after a Qdrant upgrade with no
Collector change. Scout authentication for the `otlphttp/b14` exporter is
covered in [Scout Exporter](../collector-setup/scout-exporter.md).

### Setting the metric prefix

The metric names in this guide are prefixed. Without
`QDRANT__SERVICE__METRICS_PREFIX` the names have no prefix at all -
`collections_total`, not `qdrant_collections_total` - and will collide
with other jobs in a shared backend. Set it on the Qdrant process:

```bash showLineNumbers title="Qdrant environment"
QDRANT__SERVICE__METRICS_PREFIX=qdrant_
```

The equivalent config-file form sets the same key:

```yaml showLineNumbers title="config/config.yaml (Qdrant)"
service:
  metrics_prefix: qdrant_
```

### Environment Variables

```bash showLineNumbers title=".env"
QDRANT_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Qdrant metrics
docker logs otel-collector 2>&1 | grep "qdrant_"

# Confirm the request counter exists on the endpoint
curl -s http://localhost:6333/metrics | grep '^qdrant_rest_responses_total'

# Generate a counted request against an existing collection - the vector
# must match that collection's configured dimensionality
curl -s -X PUT 'http://localhost:6333/collections/<your-collection>/points?wait=true' \
  -H 'Content-Type: application/json' \
  -d '{"points": [{"id": 1, "vector": [0.1, 0.2, 0.3, 0.4]}]}'
```

A freshly started node with no collections shows only the 21 node-level
names. `qdrant_rest_responses_total`, the duration histogram and every
`qdrant_collection_*` series appear once a collection exists and traffic
has hit the points endpoints.

In Scout, query `qdrant_collection_points` by `id` to confirm the
per-collection series arrived.

## Troubleshooting

### Metric names have no prefix

**Cause**: `QDRANT__SERVICE__METRICS_PREFIX` is not set. Qdrant exposes
unprefixed names by default.

**Look at**: the exposition - `collections_total` and
`memory_resident_bytes` instead of `qdrant_collections_total` and
`qdrant_memory_resident_bytes`.

**Fix**:

1. Set `QDRANT__SERVICE__METRICS_PREFIX=qdrant_` on the Qdrant process,
   or `service.metrics_prefix` in its config file, and restart.
2. Update dashboards and alert rules to the new names at the same time -
   every series name changes.

### Far fewer metrics than expected

**Cause**: The node has no collections, or no traffic has reached the
points endpoints. The collection-scoped and REST families only exist once
there is something to describe and something to count.

**Look at**: `qdrant_collections_total` - if it reads 0, only the 21
node-level names are being exposed.

**Fix**:

1. Create a collection and send an upsert or a search.
2. Re-scrape; the collection and REST families appear.

### Request metrics stay empty despite heavy traffic

**Cause**: The clients are using the gRPC interface on port 6334, which
is not instrumented at all. Nothing about gRPC reaches `/metrics`.

**Look at**: `qdrant_rest_responses_total` flat while the node is clearly
busy - `qdrant_cpu_cores_used` and `qdrant_collection_points` move.

**Fix**:

1. Instrument the client side to get request rate, error rate and
   latency for gRPC traffic.
2. Keep using this surface for node health, collection inventory and the
   resource ceilings, which are interface-independent.

### The error rate looks clean but users report failures

**Cause**: Only the points endpoints are counted. GET requests and
collection management are not, and a 404 from a missing collection is
never recorded.

**Look at**: `qdrant_rest_responses_total` label values - the `endpoint`
set covers `/collections/{collection_name}/points` and
`/collections/{collection_name}/points/search` only.

**Fix**:

1. Check the Qdrant logs or a fronting proxy's access logs for the
   uncounted paths.
2. Treat the metric error rate as a data-plane signal, not a
   whole-service one.

### The healthcheck never passes and dependent containers never start

**Cause**: The healthcheck uses `curl` or `wget`. The Qdrant image ships
neither, nor `nc` or `python` - only `bash`.

**Fix**:

1. Use the bash `/dev/tcp` healthcheck in [Access
   Setup](#access-setup).
2. Check readiness from outside the container against `/readyz` if you
   need a richer probe.

### A dashboard shows points but not vectors, or the reverse

**Cause**: The collection name is under two different label keys.
`qdrant_collection_points` and the
`qdrant_collection_hardware_metric_*` family use `id`, while
`qdrant_collection_vectors` uses `collection` plus a `vector` key.

**Fix**:

1. Join on `id` for points and the hardware-metric family, on
   `collection` for vectors.
2. Relabel one of them in the scrape job if you want a single key across
   both.

### Latency is up and you cannot tell which collection is responsible

**Cause**: `qdrant_rest_responses_avg_duration_seconds` and the request
counters carry no collection dimension, so a node-level latency rise says
nothing about which collection caused it.

**Look at**: the Diagnostic tier's per-collection attribution, keyed by
`id` - `qdrant_collection_hardware_metric_cpu` for compute and
`qdrant_collection_hardware_metric_vector_io_read`, `_vector_io_write`,
`_payload_io_read` and `_payload_io_write` for disk. These are the only
per-collection performance series on this surface; the other
per-collection families count points and vectors, not work done.

**Fix**: size or index the collection that dominates the split. Note the
label key: this family uses `id`, while `qdrant_collection_vectors` uses
`collection`, so a dashboard joining on one key drops the other.

### The node dies under load with mmap or file errors

**Cause**: The process hit the host's `vm.max_map_count` ceiling or its
file-descriptor limit. Qdrant maps segment files, so open maps grow with
data.

**Look at**: `qdrant_process_open_mmaps` against `qdrant_system_max_mmaps`,
and `qdrant_process_open_fds` against `qdrant_process_max_fds`.
`qdrant_process_major_page_faults_total` shows whether the working set is
also being read from disk, and the Diagnostic-tier
`qdrant_process_minor_page_faults_total` is the contrast: minor faults are
served from memory, so a high minor count with a flat major count means
the working set still fits.

**Fix**:

1. Raise `vm.max_map_count` on the host.
2. Raise the process file-descriptor limit.
3. If major page faults are climbing too, add RAM or reduce the resident
   working set.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.
4. Query the prefixed name if the prefix is set, the unprefixed name if
   it is not.

## Updates & Upgrades

### Qdrant version changes

- **1.16**: added `QDRANT__SERVICE__METRICS_PREFIX` (config key
  `service.metrics_prefix`), off by default for backward compatibility.
  Turning it on renames every stored series - `collections_total` becomes
  `qdrant_collections_total` and so on for all of them - so dashboards
  and alert rules must be updated in lockstep, and historical series keep
  the old names. Nothing else about the exposition changes. _(additive
  in Qdrant; breaking for your queries at the moment you adopt it)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no receiver-key
  rename across the supported Collector range, so the Collector config is
  stable on an image bump. New Qdrant series are picked up with no
  Collector change, because there is no per-metric enable list.
  _(no breaking change on the Prometheus path)_

## FAQ

### Does this cover gRPC traffic?

No. Qdrant serves gRPC on port 6334 and exposes nothing about it on
`/metrics` - no request count, no error count, no latency. Since most
Qdrant SDKs default to gRPC, a deployment can be fully loaded while
`qdrant_rest_responses_total` stays flat. Instrument the client side for
request signals on gRPC traffic; the node health, collection inventory
and resource metrics in this guide are interface-independent and still
apply.

### Why does a new Qdrant instance expose so few metrics?

A node with no collections and no traffic exposes 21 metric names; with
collections and traffic it exposes 49. The collection-scoped and REST
families only come into existence once there is a collection to describe
and a request to count. Build your alert list against a node that is
actually serving, not a fresh one.

### Should I set the metrics prefix?

Yes if the metrics backend is shared with other services - the default
names (`app_info`, `collections_total`, `cpu_cores_used`,
`memory_resident_bytes`) are generic enough to collide with any other
job. Set `QDRANT__SERVICE__METRICS_PREFIX=qdrant_`. Every series name
changes when you do, so update dashboards and alert rules at the same
time.

### How do I monitor a distributed Qdrant cluster?

Each node serves its own `/metrics` on its REST port, so add a scrape
target per node and let the `instance` label separate them. The replica
and shard-transfer gauges (`qdrant_collection_dead_replicas`,
`qdrant_collection_active_replicas_min` / `_max`,
`qdrant_collection_shard_transfer_incoming` / `_outgoing`) only become
meaningful there; on a single node they read 0 or 1. Distributed
behaviour is not covered here - confirm those series against your own
cluster before alerting on them.

### Which latency series should I chart?

The histogram, `qdrant_rest_responses_duration_seconds`, and compute
percentiles from its buckets. The pre-computed
`_min_duration_seconds` and `_max_duration_seconds` gauges are extremes
since process start, so one slow request pins `max` for the life of the
process and it never recovers. They are context, not incident signals.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Qdrant metrics.
- [Milvus Monitoring](./milvus.md) - Vector store with a much larger metric
  surface, and traces as well as metrics.
- [Weaviate Monitoring](./weaviate.md) - Vector store whose request
  accounting splits across REST, GraphQL and gRPC.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [OpenSearch](./opensearch.md), [vLLM](./vllm.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic
  and retention needs, and split dashboards per collection using the `id`
  and `collection` labels.
