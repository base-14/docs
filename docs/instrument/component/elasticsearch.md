---
title: >
  Elasticsearch OpenTelemetry Monitoring — Cluster Health, Node Stats,
  and Collector Setup
sidebar_label: Elasticsearch
id: collecting-elasticsearch-telemetry
sidebar_position: 8
description: >
  Collect Elasticsearch metrics with the OpenTelemetry Collector. Monitor
  cluster health, node performance, index stats, and JVM metrics using
  the Elasticsearch receiver and export to base14 Scout.
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

The OpenTelemetry Collector's Elasticsearch receiver collects 70+ metrics
from Elasticsearch 8.x and 9.x, including cluster health, node
performance, index operations, JVM heap usage, and circuit breaker
statistics. This guide configures the receiver, verifies connectivity,
and ships metrics to base14 Scout.

> **Note**: Elasticsearch 9.x introduced breaking changes to the stats
> API (renamed `merges` to `merge`, removed `suggest` filter). Use
> OpenTelemetry Collector Contrib **v0.131.0 or later** for ES 9.x
> compatibility.

## Prerequisites

| Requirement            | Minimum  | Recommended |
| ---------------------- | -------- | ----------- |
| Elasticsearch          | 8.x     | 9.x         |
| OTel Collector Contrib | 0.90.0  | 0.131.0+    |
| base14 Scout           | Any     | —           |

Before starting:

- Elasticsearch HTTP API (port 9200) must be accessible from the host
  running the Collector
- Credentials with access to cluster stats APIs (if security is enabled)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cluster**: health status, node count, shard allocation, pending
  tasks, state updates
- **Nodes**: disk usage, cache stats, operations, HTTP connections,
  thread pools
- **Indexes**: document counts, operation times, merge activity, segment
  memory, cache usage
- **JVM**: heap usage, GC counts, thread count, class loading
- **OS**: CPU usage, load averages, memory usage
- **Circuit breakers**: estimated memory, limits, tripped counts

Full metric reference:
[OTel Elasticsearch Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/elasticsearchreceiver)

## Access Setup

Verify your Elasticsearch instance is accessible:

```bash showLineNumbers
# Check cluster health
curl -u ${ES_USERNAME}:${ES_PASSWORD} http://<elasticsearch-host>:9200/_cluster/health?pretty

# Check node info
curl -u ${ES_USERNAME}:${ES_PASSWORD} http://<elasticsearch-host>:9200/_nodes?pretty
```

If Elasticsearch security is disabled (development only):

```bash showLineNumbers
curl http://<elasticsearch-host>:9200/_cluster/health?pretty
```

No special user creation is required — any user with access to the
cluster stats APIs can be used for monitoring.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  elasticsearch:
    endpoint: http://<elasticsearch-host>:9200
    collection_interval: 15s
    username: ${env:ES_USERNAME}
    password: ${env:ES_PASSWORD}
    nodes: ["_all"]
    skip_cluster_metrics: false
    indices: ["_all"]

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

      # Node metrics — disk and filesystem
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

      # Node metrics — cache
      elasticsearch.node.cache.count:
        enabled: true
      elasticsearch.node.cache.evictions:
        enabled: true
      elasticsearch.node.cache.memory.usage:
        enabled: true
      elasticsearch.node.cache.size:
        enabled: true

      # Node metrics — operations
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

      # Node metrics — networking and connections
      elasticsearch.node.http.connections:
        enabled: true
      elasticsearch.node.cluster.connections:
        enabled: true
      elasticsearch.node.cluster.io:
        enabled: true
      elasticsearch.node.open_files:
        enabled: true

      # Node metrics — ingest pipeline
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

      # Node metrics — documents and shards
      elasticsearch.node.documents:
        enabled: true
      elasticsearch.node.shards.size:
        enabled: true
      elasticsearch.node.shards.data_set.size:
        enabled: true
      elasticsearch.node.shards.reserved.size:
        enabled: true

      # Node metrics — thread pools
      elasticsearch.node.thread_pool.tasks.finished:
        enabled: true
      elasticsearch.node.thread_pool.tasks.queued:
        enabled: true
      elasticsearch.node.thread_pool.threads:
        enabled: true

      # Node metrics — translog
      elasticsearch.node.translog.operations:
        enabled: true
      elasticsearch.node.translog.size:
        enabled: true
      elasticsearch.node.translog.uncommitted.size:
        enabled: true

      # Node metrics — scripts
      elasticsearch.node.script.compilations:
        enabled: true
      elasticsearch.node.script.cache_evictions:
        enabled: true
      elasticsearch.node.script.compilation_limit_triggered:
        enabled: true

      # Node metrics — segments
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
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [elasticsearch]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

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

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "elasticsearch"

# Check cluster health
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_cluster/health?pretty

# Check node stats
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_nodes/stats?pretty
```

```bash showLineNumbers
# Check index stats
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_stats?pretty

# Check cluster allocation
curl -u ${ES_USERNAME}:${ES_PASSWORD} \
     http://<elasticsearch-host>:9200/_cat/allocation?v
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach Elasticsearch at the configured
endpoint.

**Fix**:

1. Verify Elasticsearch is running: `systemctl status elasticsearch` or
   `docker ps | grep elasticsearch`
2. Confirm the HTTP API port (default 9200) is accessible
3. Check `network.host` in `elasticsearch.yml` if the Collector runs on
   a separate host

### Authentication failed (401)

**Cause**: Credentials are incorrect or Elasticsearch security is
enabled but credentials are not configured.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:9200/_cluster/health`
2. Verify the user exists and has access to stats APIs
3. Check `ES_USERNAME` and `ES_PASSWORD` environment variables

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Stats API errors with Elasticsearch 9.x

**Cause**: Elasticsearch 9.x renamed `merges` to `merge` and removed
the `suggest` filter in the stats API.

**Fix**:

1. Upgrade OTel Collector Contrib to **v0.131.0 or later**
2. Earlier versions will log errors when parsing 9.x stats responses
3. The receiver config does not need changes — only the Collector binary

## FAQ

**Does this work with Elasticsearch running in Kubernetes?**

Yes. Set `endpoint` to the Elasticsearch service DNS
(e.g., `http://elasticsearch.default.svc.cluster.local:9200`) and
inject credentials via a Kubernetes secret. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor a multi-node Elasticsearch cluster?**

Set `nodes: ["_all"]` to collect metrics from all nodes through a
single endpoint. The receiver queries the cluster stats API, which
returns data for the entire cluster. You only need one receiver
instance pointing to any node.

**What about OpenSearch — does the same receiver work?**

No. OpenSearch diverged from Elasticsearch and uses different stats API
responses. Use the `opensearchreceiver` in OTel Collector Contrib for
OpenSearch clusters.

**Can I limit which indices are monitored?**

Yes. Change `indices: ["_all"]` to a specific list:
`indices: ["my-index-*", "logs-*"]`. This reduces the volume of
index-level metrics for clusters with many indices.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [PostgreSQL](./postgres.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` and limit
  `indices` to reduce metric volume on large clusters

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [ElastiCache Monitoring](../infra/aws/elasticache.md) — AWS ElastiCache
  monitoring
- [Redis Monitoring](./redis.md) — Self-hosted Redis monitoring
