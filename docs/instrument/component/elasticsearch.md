---
title: Elasticsearch Monitoring with OpenTelemetry
sidebar_label: Elasticsearch
id: collecting-elasticsearch-telemetry
sidebar_position: 8
description:
  Monitor Elasticsearch with OpenTelemetry Collector. Collect cluster health,
  node performance, index stats, JVM metrics, and more using Scout.
keywords:
  [
    elasticsearch monitoring,
    elasticsearch metrics,
    search engine monitoring,
    opentelemetry elasticsearch,
    elasticsearch observability,
  ]
---

# Elasticsearch

## Overview

This guide explains how to set up Elasticsearch metrics collection using Scout
Collector and forward them to Scout backend.

> **Note**: Elasticsearch 9.x introduced breaking changes to the stats API
> (renamed `merges` to `merge`, removed `suggest` filter). Use OpenTelemetry
> Collector Contrib **v0.131.0 or later** for ES 9.x compatibility.

## Prerequisites

1. Elasticsearch 8.x or 9.x instance
2. Network access to the Elasticsearch HTTP API (port 9200)
3. Scout Collector installed (v0.131.0+ for ES 9.x)

## Elasticsearch Configuration

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

## Scout Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  elasticsearch:
    endpoint: http://<elasticsearch-host>:9200
    collection_interval: 15s
    username: ${ES_USERNAME}
    password: ${ES_PASSWORD}
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
        value: ${ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to Base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [elasticsearch]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Verify Elasticsearch connectivity:

   ```bash showLineNumbers
   # Check cluster health
   curl -u ${ES_USERNAME}:${ES_PASSWORD} \
        http://<elasticsearch-host>:9200/_cluster/health?pretty

   # Check node stats
   curl -u ${ES_USERNAME}:${ES_PASSWORD} \
        http://<elasticsearch-host>:9200/_nodes/stats?pretty
   ```

4. Check Elasticsearch cluster status:

   ```bash showLineNumbers
   # Check index stats
   curl -u ${ES_USERNAME}:${ES_PASSWORD} \
        http://<elasticsearch-host>:9200/_stats?pretty

   # Check cluster allocation
   curl -u ${ES_USERNAME}:${ES_PASSWORD} \
        http://<elasticsearch-host>:9200/_cat/allocation?v
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [Elasticsearch Cluster Health API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cluster-health)
- [Elasticsearch Node Stats API](https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-nodes-stats)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [ElastiCache Monitoring](../infra/aws/elasticache.md) - AWS ElastiCache
  monitoring guide
- [Redis Monitoring](./redis.md) - Self-hosted Redis monitoring guide
