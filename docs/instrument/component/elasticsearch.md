---
title: >
  Elasticsearch OpenTelemetry Monitoring - Cluster Health, Heap Pressure,
  and Collector Setup
sidebar_label: Elasticsearch
id: collecting-elasticsearch-telemetry
sidebar_position: 8
description: >
  Collect Elasticsearch metrics with the OpenTelemetry Collector. Monitor
  cluster health, shard allocation, node operations, and JVM heap pressure
  with the Elasticsearch receiver and ship to base14 Scout.
keywords:
  - elasticsearch opentelemetry
  - elasticsearch otel collector
  - elasticsearch metrics monitoring
  - elasticsearch performance monitoring
  - opentelemetry elasticsearch receiver
  - elasticsearch observability
  - elasticsearch cluster monitoring
  - elasticsearch telemetry collection
---

# Elasticsearch

The OpenTelemetry Collector's `elasticsearchreceiver` connects to the
Elasticsearch HTTP API and collects 90+ metrics across cluster health,
node performance, index operations, segments and merges, thread pools,
circuit breakers, indexing pressure, and JVM heap. It reads the
cluster-health, node-stats, and index-stats APIs over a single endpoint
on Elasticsearch 8.x and 9.x. This guide configures the receiver,
verifies connectivity, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended    |
| ---------------------- | ------- | -------------- |
| Elasticsearch          | 8.x     | 9.x (9.1.3)    |
| OTel Collector Contrib | 0.90.0  | 0.153.0        |
| base14 Scout           | Any     | -              |

Before starting:

- The Elasticsearch HTTP API (port 9200) must be reachable from the host
  running the Collector.
- A user with access to the cluster stats APIs, if security is enabled
  (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

A few things about this surface are worth knowing up front:

- **Elasticsearch exposes a real health metric.** Unlike receivers that
  only carry an uptime counter, `elasticsearch.cluster.health` reports
  green / yellow / red through a `status` attribute - so you do not need
  an `up` series. Liveness is the receiver scraping the HTTP API
  successfully, and `elasticsearch.cluster.health` is the headline
  cluster-state signal. This receiver set exposes **no `up` series and no
  uptime counter**.
- **One endpoint covers the whole cluster.** With `nodes: ["_all"]` the
  receiver queries the cluster stats APIs through a single endpoint and
  returns per-node series. You point one receiver at any node, not one
  per node.
- **Some attributes are high-cardinality.**
  `elasticsearch.node.thread_pool.*` fan out across ~30 thread-pool names
  (`thread_pool_name`); `elasticsearch.breaker.*` across breaker `name`
  (`parent`, `fielddata`, `request`, `inflight_requests`, ...);
  `elasticsearch.node.operations.*` across `operation` (index / query /
  get / fetch / scroll / delete).
- **Many metrics are disabled by default.** The receiver ships most of
  its catalogue off, so the `metrics:` enable list in the
  [Configuration](#configuration) is required.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `elasticsearch.cluster.health` | Cluster health by `status` (green / yellow / red) - the headline cluster-state signal. No `up` on this surface; this is the health signal. |
| `elasticsearch.cluster.shards` | Shards by state (active / relocating / initializing / unassigned). Unassigned or initializing = degraded allocation. |
| `elasticsearch.node.operations.completed`, `elasticsearch.node.operations.time` | Per-node operations and time by `operation` - the serving throughput and latency KPI. |
| `jvm.memory.heap.utilization` | Heap used as a fraction of max - the dominant Elasticsearch saturation signal. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `elasticsearch.cluster.pending_tasks` | Cluster-level tasks awaiting the master; rising = master / cluster-state overload. |
| `elasticsearch.node.thread_pool.tasks.queued`, `.tasks.finished`, `.threads` | Thread-pool queue depth, completions, and threads by `thread_pool_name` - search / write queue backup and rejections. |
| `elasticsearch.breaker.tripped` | Circuit breakers tripped by `name` - memory-protection events rejecting requests. |
| `elasticsearch.node.fs.disk.available`, `.free` | Free disk on the data path - drives the disk watermarks; writes block at flood stage. |
| `elasticsearch.indexing_pressure.memory.total.primary_rejections`, `.replica_rejections` | Write requests rejected by indexing back-pressure - ingest overload. |
| `elasticsearch.index.operations.completed`, `.time` | Per-index operation counts and time by `operation` - index-level throughput and latency. |
| `elasticsearch.node.cache.evictions` | Query / fielddata / request cache evictions by cache `name` - cache pressure. |
| `jvm.gc.collections.count`, `.elapsed` | GC collections and elapsed time by collector; rising old-gen GC time = heap thrash. |
| `elasticsearch.node.translog.operations`, `.uncommitted.size` | Translog operations and uncommitted bytes - fsync / recovery cost. |
| `elasticsearch.os.cpu.usage`, `elasticsearch.os.cpu.load_avg.1m` / `.5m` / `.15m` | Node CPU usage and load averages - host saturation. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. The groups below are representative, not exhaustive - see the
[upstream receiver reference](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/elasticsearchreceiver)
for the full list.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Cluster-state internals | `elasticsearch.cluster.nodes`, `.data_nodes`, `.in_flight_fetch`, `.state_queue`, `.state_update.count` / `.time` | Master and cluster-state churn during membership or allocation events. |
| Node I/O and networking | `elasticsearch.node.disk.io.read` / `.io.write`, `elasticsearch.node.http.connections`, `elasticsearch.node.open_files`, `elasticsearch.node.fs.disk.total` | Disk, transport, and file-descriptor saturation on a node. |
| Segments and merges | `elasticsearch.index.segments.count` / `.size` / `.memory`, `elasticsearch.index.operations.merge.current` | Lucene segment and merge load behind slow indexing or large heap use. |
| Index and node sizing | `elasticsearch.index.documents`, `.shards.size`, `elasticsearch.node.documents`, `elasticsearch.node.shards.size` | Per-index and per-node growth during a capacity review. |
| Cache internals | `elasticsearch.index.cache.evictions` / `.memory.usage` / `.size`, `elasticsearch.node.cache.count` / `.size` | Query / fielddata / request cache behaviour at index and node scope. |
| Ingest pipelines | `elasticsearch.node.ingest.documents`, `.ingest.operations.failed`, `.pipeline.ingest.documents.preprocessed` | Ingest-node and per-pipeline throughput and failures. |
| Scripting | `elasticsearch.node.script.compilations`, `.script.cache_evictions`, `.script.compilation_limit_triggered` | Script compile churn and compile-limit pressure. |
| GET operations | `elasticsearch.node.operations.get.completed` / `.get.time`, `elasticsearch.node.operations.current` | GET latency and in-flight operations. |
| JVM internals | `jvm.memory.heap.used` / `.heap.committed` / `.heap.max`, `jvm.memory.pool.used`, `jvm.classes.loaded`, `jvm.threads.count` | Heap composition and JVM thread / class growth. |
| OS and process | `elasticsearch.os.memory`, `elasticsearch.process.cpu.usage`, `.process.memory.virtual` | Host memory and the ES process footprint. |
| Breaker memory | `elasticsearch.breaker.memory.estimated`, `.memory.limit` | How close each breaker is to its limit before it trips. |
| Indexing-pressure memory | `elasticsearch.indexing_pressure.memory.limit`, `elasticsearch.memory.indexing_pressure` | Current indexing-pressure bytes against the limit. |
| Translog sizing | `elasticsearch.index.translog.operations` / `.translog.size`, `elasticsearch.node.translog.size` | Translog growth at index and node scope. |

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
Several of these read an Elasticsearch state flag (cluster health,
unassigned shards, a tripped breaker) rather than an absolute number;
the rest are relative to your own baseline. These are starting points -
tune them to your workload.

| Alert | Condition | Why it matters |
|---|---|---|
| Elasticsearch unreachable | The `elasticsearch` receiver produces no data for > 1m | No `up` on this surface - scrape success plus cluster health are liveness. Check the node and the receiver connection. |
| Cluster not green | `elasticsearch.cluster.health{status=red}` present, or `{status=yellow}` sustained | Red = primaries unassigned (data unavailable); yellow = replicas unassigned. Check allocation and node membership. |
| Unassigned shards | `elasticsearch.cluster.shards{state=unassigned}` > 0 | Shards cannot be allocated - disk watermarks, node loss, or allocation rules. |
| Heap pressure | `jvm.memory.heap.utilization` sustained high vs baseline, with `rate(jvm.gc.collections.elapsed)` rising | Old-gen GC thrash precedes OOM and node drop. Reduce load, add heap / nodes, or review queries. |
| Disk watermark | `elasticsearch.node.fs.disk.available` falling toward the flood-stage watermark | At flood stage ES blocks writes and sets indices read-only. Free disk or add capacity. |
| Thread-pool backup | `elasticsearch.node.thread_pool.tasks.queued` rising vs baseline | Search / write queues filling - rejections follow. Correlate with CPU and slow queries. |
| Circuit breaker tripped | `rate(elasticsearch.breaker.tripped)` > 0 | A breaker is rejecting requests to prevent OOM - usually fielddata or request memory. |
| Indexing rejections | `rate(elasticsearch.indexing_pressure.memory.total.primary_rejections)` > 0 | Write back-pressure is rejecting indexing. Slow the producers or scale write capacity. |

## Access Setup

The receiver reads the cluster-health, node-stats, and index-stats APIs
over the Elasticsearch HTTP API on port 9200. No special user creation
is required - any user with access to the cluster stats APIs works.

Verify the endpoint is reachable. If security is enabled, supply
credentials:

```bash showLineNumbers title="Verify Elasticsearch access"
# Check cluster health
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_cluster/health?pretty

# Check node info
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_nodes?pretty
```

If security is disabled (development clusters), no auth is needed:

```bash showLineNumbers title="Verify access (no auth)"
curl http://<elasticsearch-host>:9200/_cluster/health?pretty
```

In production, pass credentials through the `ES_USERNAME` / `ES_PASSWORD`
environment variables shown in the [Configuration](#configuration).

## Configuration

Most `elasticsearchreceiver` metrics are disabled by default, so the
`metrics:` enable list below is required - it is the curated set this
guide collects.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  elasticsearch:
    endpoint: http://<elasticsearch-host>:9200   # Your Elasticsearch HTTP API
    collection_interval: 15s
    username: ${env:ES_USERNAME}
    password: ${env:ES_PASSWORD}
    nodes: ["_all"]              # Whole cluster through one endpoint
    skip_cluster_metrics: false
    indices: ["_all"]           # Scope index-level series (see FAQ)

    tls:
      insecure_skip_verify: true

    metrics:
      # Cluster metrics
      elasticsearch.cluster.health:
        enabled: true
      elasticsearch.cluster.nodes:
        enabled: true
      elasticsearch.cluster.data_nodes:
        enabled: true
      elasticsearch.cluster.shards:
        enabled: true
      elasticsearch.cluster.pending_tasks:
        enabled: true
      elasticsearch.cluster.in_flight_fetch:
        enabled: true
      elasticsearch.cluster.state_queue:
        enabled: true
      elasticsearch.cluster.published_states.full:
        enabled: true
      elasticsearch.cluster.published_states.differences:
        enabled: true
      elasticsearch.cluster.state_update.count:
        enabled: true
      elasticsearch.cluster.state_update.time:
        enabled: true

      # Node metrics - disk and filesystem
      elasticsearch.node.fs.disk.available:
        enabled: true
      elasticsearch.node.fs.disk.free:
        enabled: true
      elasticsearch.node.fs.disk.total:
        enabled: true
      elasticsearch.node.disk.io.read:
        enabled: true
      elasticsearch.node.disk.io.write:
        enabled: true

      # Node metrics - cache
      elasticsearch.node.cache.count:
        enabled: true
      elasticsearch.node.cache.evictions:
        enabled: true
      elasticsearch.node.cache.memory.usage:
        enabled: true
      elasticsearch.node.cache.size:
        enabled: true

      # Node metrics - operations
      elasticsearch.node.operations.completed:
        enabled: true
      elasticsearch.node.operations.time:
        enabled: true
      elasticsearch.node.operations.current:
        enabled: true
      elasticsearch.node.operations.get.completed:
        enabled: true
      elasticsearch.node.operations.get.time:
        enabled: true

      # Node metrics - networking and connections
      elasticsearch.node.http.connections:
        enabled: true
      elasticsearch.node.cluster.connections:
        enabled: true
      elasticsearch.node.cluster.io:
        enabled: true
      elasticsearch.node.open_files:
        enabled: true

      # Node metrics - ingest pipeline
      elasticsearch.node.ingest.documents:
        enabled: true
      elasticsearch.node.ingest.documents.current:
        enabled: true
      elasticsearch.node.ingest.operations.failed:
        enabled: true
      elasticsearch.node.pipeline.ingest.documents.current:
        enabled: true
      elasticsearch.node.pipeline.ingest.documents.preprocessed:
        enabled: true
      elasticsearch.node.pipeline.ingest.operations.failed:
        enabled: true

      # Node metrics - documents and shards
      elasticsearch.node.documents:
        enabled: true
      elasticsearch.node.shards.size:
        enabled: true
      elasticsearch.node.shards.data_set.size:
        enabled: true
      elasticsearch.node.shards.reserved.size:
        enabled: true

      # Node metrics - thread pools
      elasticsearch.node.thread_pool.tasks.finished:
        enabled: true
      elasticsearch.node.thread_pool.tasks.queued:
        enabled: true
      elasticsearch.node.thread_pool.threads:
        enabled: true

      # Node metrics - translog
      elasticsearch.node.translog.operations:
        enabled: true
      elasticsearch.node.translog.size:
        enabled: true
      elasticsearch.node.translog.uncommitted.size:
        enabled: true

      # Node metrics - scripts
      elasticsearch.node.script.compilations:
        enabled: true
      elasticsearch.node.script.cache_evictions:
        enabled: true
      elasticsearch.node.script.compilation_limit_triggered:
        enabled: true

      # Node metrics - segments
      elasticsearch.node.segments.memory:
        enabled: true

      # Circuit breaker metrics
      elasticsearch.breaker.memory.estimated:
        enabled: true
      elasticsearch.breaker.memory.limit:
        enabled: true
      elasticsearch.breaker.tripped:
        enabled: true

      # Indexing pressure metrics
      elasticsearch.indexing_pressure.memory.limit:
        enabled: true
      elasticsearch.indexing_pressure.memory.total.primary_rejections:
        enabled: true
      elasticsearch.indexing_pressure.memory.total.replica_rejections:
        enabled: true
      elasticsearch.memory.indexing_pressure:
        enabled: true

      # Index metrics
      elasticsearch.index.documents:
        enabled: true
      elasticsearch.index.operations.completed:
        enabled: true
      elasticsearch.index.operations.time:
        enabled: true
      elasticsearch.index.operations.merge.current:
        enabled: true
      elasticsearch.index.operations.merge.docs_count:
        enabled: true
      elasticsearch.index.operations.merge.size:
        enabled: true
      elasticsearch.index.segments.count:
        enabled: true
      elasticsearch.index.segments.size:
        enabled: true
      elasticsearch.index.segments.memory:
        enabled: true
      elasticsearch.index.shards.size:
        enabled: true
      elasticsearch.index.cache.evictions:
        enabled: true
      elasticsearch.index.cache.memory.usage:
        enabled: true
      elasticsearch.index.cache.size:
        enabled: true
      elasticsearch.index.translog.operations:
        enabled: true
      elasticsearch.index.translog.size:
        enabled: true

      # OS metrics
      elasticsearch.os.cpu.usage:
        enabled: true
      elasticsearch.os.cpu.load_avg.1m:
        enabled: true
      elasticsearch.os.cpu.load_avg.5m:
        enabled: true
      elasticsearch.os.cpu.load_avg.15m:
        enabled: true
      elasticsearch.os.memory:
        enabled: true

      # Process metrics
      elasticsearch.process.cpu.usage:
        enabled: true
      elasticsearch.process.cpu.time:
        enabled: true
      elasticsearch.process.memory.virtual:
        enabled: true

      # JVM metrics
      jvm.classes.loaded:
        enabled: true
      jvm.gc.collections.count:
        enabled: true
      jvm.gc.collections.elapsed:
        enabled: true
      jvm.memory.heap.committed:
        enabled: true
      jvm.memory.heap.max:
        enabled: true
      jvm.memory.heap.used:
        enabled: true
      jvm.memory.heap.utilization:
        enabled: true
      jvm.memory.nonheap.committed:
        enabled: true
      jvm.memory.nonheap.used:
        enabled: true
      jvm.memory.pool.max:
        enabled: true
      jvm.memory.pool.used:
        enabled: true
      jvm.threads.count:
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

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [elasticsearch]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (introduced in semantic conventions v1.27.0, stable as
> of v1.41.0). Scout's UI filters on the lowercase `environment` key, so
> emit it alongside the OTel-native `deployment.environment.name`. The
> legacy `deployment.environment` is still accepted for backward
> compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
ES_USERNAME=elastic
ES_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for the Elasticsearch receiver
docker logs otel-collector 2>&1 | grep -i "elasticsearch"

# Check cluster health directly
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_cluster/health?pretty

# Check node stats
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_nodes/stats?pretty
```

```bash showLineNumbers title="Check index and cluster stats"
# Check index stats
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_stats?pretty

# Check shard allocation
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_cat/allocation?v
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach Elasticsearch at the configured
endpoint.

**Fix**:

1. Verify Elasticsearch is running: `systemctl status elasticsearch` or
   `docker ps | grep elasticsearch`.
2. Confirm the HTTP API port (default 9200) is accessible.
3. Check `network.host` in `elasticsearch.yml` if the Collector runs on
   a separate host.

### Authentication failed (401)

**Cause**: Credentials are incorrect, or security is enabled but
credentials are not configured.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:9200/_cluster/health`.
2. Verify the user exists and has access to the stats APIs.
3. Check the `ES_USERNAME` and `ES_PASSWORD` environment variables.

### Cluster reads yellow or red

**Cause**: Shards cannot be allocated - a lost node, a disk watermark, or
an allocation rule.

**Look at**: `elasticsearch.cluster.health{status}` for the colour,
`elasticsearch.cluster.shards{state=unassigned}` for how many shards are
stranded, and `elasticsearch.node.fs.disk.available` to rule out a disk
watermark.

**Fix**:

1. Check `_cluster/allocation/explain` for the per-shard reason.
2. Free disk or add capacity if a watermark is the cause.
3. Restore node membership if a node dropped.

### Indexing is slow or rejected

**Cause**: Write back-pressure, a saturated write thread pool, or merge
load.

**Look at**:
`elasticsearch.indexing_pressure.memory.total.primary_rejections`
(rejected writes), `elasticsearch.node.thread_pool.tasks.queued` (write
queue depth), and `elasticsearch.index.operations.merge.current` (merge
load behind slow indexing).

**Fix**:

1. Slow the producers or scale write capacity if rejections appear.
2. Correlate queue depth with CPU and heap before raising pool sizes.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Does this work with Elasticsearch running in Kubernetes?

Yes. Set `endpoint` to the Elasticsearch service DNS
(e.g. `http://elasticsearch.default.svc.cluster.local:9200`) and inject
credentials through a Kubernetes secret. The Collector can run as a
sidecar or a Deployment.

### How do I monitor a multi-node Elasticsearch cluster?

Set `nodes: ["_all"]`. The receiver queries the cluster stats APIs
through a single endpoint and returns per-node series for the whole
cluster, so one receiver pointing at any node covers every node. You do
not run one receiver per node.

### Does this work with Elasticsearch 9.x?

Yes. The `elasticsearchreceiver` supports Elasticsearch 7.9 and later,
including 8.x and 9.x. No collector version is specific to 9.x - run a
current OTel Collector Contrib build.

### What about OpenSearch - does the same receiver work?

No. OpenSearch diverged from Elasticsearch and returns different stats
API responses, so the `elasticsearchreceiver` does not support it. OTel
Collector Contrib does not ship an OpenSearch metrics receiver - collect
OpenSearch metrics through its own Prometheus plugin or monitoring APIs
instead.

### Can I limit which indices are monitored?

Yes. Change `indices: ["_all"]` to a specific list, for example
`indices: ["my-index-*", "logs-*"]`. This scopes which indices emit
index-level series; cluster and node metrics are unaffected.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Elasticsearch metrics.
- [PostgreSQL Monitoring](./postgres.md) - Relational store behind the
  same services you search.
- [Redis Monitoring](./redis.md) - In-memory cache fronting the search
  path.
- [ElastiCache Monitoring](../infra/aws/elasticache.md) - Managed Redis /
  Memcached cache monitoring on AWS.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [Redis](./redis.md), and other components.
- **Tune Collection**: Scope `indices` to the index patterns you care
  about, and keep the Diagnostic tier available for incident
  investigation.
