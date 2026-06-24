---
title: >
  OpenSearch OpenTelemetry Monitoring - Cluster Health, Search Latency,
  and JVM Heap
sidebar_label: OpenSearch
id: collecting-opensearch-telemetry
sidebar_position: 27
description: >
  Collect OpenSearch metrics with the OpenTelemetry Collector. Monitor
  cluster status, search and indexing latency, and JVM heap pressure via
  the prometheus-exporter plugin and ship to base14 Scout.
keywords:
  - opensearch opentelemetry
  - opensearch otel collector
  - opensearch metrics monitoring
  - opensearch cluster monitoring
  - opentelemetry prometheus receiver opensearch
  - opensearch observability
  - opensearch jvm heap monitoring
  - opensearch telemetry collection
---

# OpenSearch

OpenSearch serves Prometheus-format metrics at `/_prometheus/metrics` on
the HTTP port (`:9200`) once the
[prometheus-exporter plugin](https://github.com/opensearch-project/opensearch-prometheus-exporter)
is installed - the plugin version must equal the OpenSearch version
exactly. The OpenTelemetry Collector's `prometheus` receiver scrapes that
endpoint, collecting 230+ metrics across cluster health, indexing and
search throughput and latency, JVM heap and GC, OS and process resources,
filesystem and storage I/O, caches, circuit breakers, and thread pools.
This guide installs the plugin, configures the receiver, and ships metrics
to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended            |
| ---------------------- | ------- | ---------------------- |
| OpenSearch             | 2.0     | 3.x (3.7.0)            |
| prometheus-exporter    | match   | match (e.g. 3.7.0.0)   |
| OTel Collector Contrib | 0.90.0  | 0.153.0                |
| base14 Scout           | Any     | -                      |

Before starting:

- The OpenSearch HTTP port (`9200`) must be reachable from the host
  running the Collector.
- The prometheus-exporter plugin version must equal the OpenSearch version
  exactly (OpenSearch `3.7.0` needs plugin `3.7.0.0`); a mismatch fails
  plugin install or node start.
- On clusters with the security plugin enabled, a monitoring user whose role
  grants the cluster monitor actions the exporter calls -
  `cluster:monitor/prometheus/metrics`, `cluster:monitor/health`,
  `cluster:monitor/state`, `cluster:monitor/nodes/info`,
  `cluster:monitor/nodes/stats` - plus the index permission
  `indices:monitor/stats` (see [Access Setup](#access-setup)).
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

A few facts about this surface shape the tiers:

- **Liveness is the `up` series.** The `prometheus` receiver emits `up = 1`
  when the scrape succeeds; `up` and the four `scrape_*` series are
  receiver-synthesized, not plugin metrics. `opensearch_cluster_status`
  (green=0, yellow=1, red=2) is the headline cluster-state gauge.
- **This plugin reports its counter-like accumulators (`*_count`,
  `*_total_*`, the `*_seconds` totals) as Prometheus gauges**, so the
  `prometheus` receiver ingests them as Gauge rather than Sum. Derive rates
  with `rate()` / delta in the backend, and expect a reset to 0 on node
  restart. The receiver honors the exporter's own `# TYPE` line (`gauge` to
  Gauge, `counter` to Sum), so confirm a series with
  `curl .../_prometheus/metrics | grep '^# TYPE'` if a dashboard treats it
  unexpectedly.
- **Two families cover the same counters.** `opensearch_indices_*` is the
  node-level aggregate across all shards on the node; `opensearch_index_*`
  is the per-index breakdown carrying an `index` label. The per-index family
  also covers system indices (for example `.plugins-ml-config`) and adds the
  per-index `_status`, `_shards_number`, `_replicas_number`, `_translog_*`,
  and `_warmer_*` members. On a busy cluster the per-index family dominates
  cardinality.
- **The plugin version must equal the OpenSearch version exactly.** There is
  no `opensearchreceiver` - OpenSearch telemetry goes through this plugin
  plus the `prometheus` receiver, not a native Collector receiver.
- **No thread-pool `rejected` counter is exported** - use
  `opensearch_threadpool_tasks_number` (queue depth) as the saturation proxy.
- **The `_disk_watermark_*_pct` gauges and `_disk_threshold_enabled` reflect
  configuration, not live disk usage** - free space is
  `opensearch_fs_path_available_bytes`.

### Core - is the cluster alive and the read/write path healthy

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - node reachable (receiver-synthesized). |
| `opensearch_cluster_status` | 0=green, 1=yellow, 2=red - the headline cluster signal. |
| `opensearch_cluster_shards_active_percent` | Percent of shards active - allocation health. |
| `opensearch_jvm_mem_heap_used_percent` | Heap pressure - the primary OpenSearch saturation signal. |
| `opensearch_os_cpu_percent` | Host CPU. |
| `opensearch_process_cpu_percent` | OpenSearch process CPU. |
| `opensearch_indices_search_query_count` | Search (query phase) throughput. |
| `opensearch_indices_search_query_time_seconds` | Cumulative query time - pair with the count for average latency. |
| `opensearch_indices_indexing_index_count` | Indexing throughput. |
| `opensearch_indices_indexing_index_time_seconds` | Cumulative indexing time - pair with the count for average write latency. |
| `opensearch_fs_total_available_bytes` | Free disk - drives disk-based shard allocation and write blocking. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `opensearch_indices_search_fetch_count` / `_time_seconds` | Fetch-phase throughput and latency. |
| `opensearch_indices_search_open_contexts_number` | Open search contexts - rising means leaked scrolls. |
| `opensearch_indices_search_scroll_current_number` / `_time_seconds` | Scroll usage and contexts not draining. |
| `opensearch_indices_indexing_index_failed_count` | Failed index ops - should stay flat. |
| `opensearch_indices_indexing_is_throttled_bool` | Indexing back-pressure (1 = throttled). |
| `opensearch_indices_merges_current_number` / `_total_throttled_time_seconds` | Merge load and throttling. |
| `opensearch_indices_refresh_total_count` / `_time_seconds` | Refresh cost (visibility latency). |
| `opensearch_indices_flush_total_count` / `_time_seconds` | Flush cost. |
| `opensearch_jvm_gc_collection_count` / `_time_seconds` | GC frequency and pause time - heap-pressure consequence. |
| `opensearch_circuitbreaker_tripped_count` / `_estimated_bytes` / `_limit_bytes` | Breaker trips and headroom. |
| `opensearch_threadpool_tasks_number` | Queue depth - saturation proxy (no rejected counter is exported). |
| `opensearch_indices_querycache_hit_count` / `_evictions_count` | Query-cache effectiveness. |
| `opensearch_indices_requestcache_evictions_count` | Shard request-cache churn. |
| `opensearch_indices_fielddata_memory_size_bytes` | Fielddata footprint. |
| `opensearch_index_translog_uncommitted_size_bytes` | Unflushed translog backlog (per-index). |
| `opensearch_os_mem_used_percent` | Host memory. |
| `opensearch_process_file_descriptors_open_number` / `_max_number` | FD headroom. |
| `opensearch_transport_rx_bytes_count` / `_tx_bytes_count` | Inter-node transport volume. |
| `opensearch_cluster_pending_tasks_number` / `_task_max_waiting_time_seconds` | Cluster-manager task backlog. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review.

| Group | Representative members | When you reach for it |
|---|---|---|
| Per-index breakdown | `opensearch_index_*` (the full per-index family, including system indices), `opensearch_index_status` / `_shards_number` / `_replicas_number` / `_translog_*` / `_warmer_*` | Per-index detail of every `indices_*` counter, plus the per-index health and shard config. |
| Inventory | `opensearch_indices_doc_number`, `_doc_deleted_number`, `_store_size_bytes`, `opensearch_indices_segments_number` / `_memory_bytes` | Document, store, and segment census. |
| Get / suggest paths | `opensearch_indices_get_*`, `opensearch_indices_suggest_*` | Get-by-id and suggester/completion activity. |
| Recovery / ingest / script | `opensearch_indices_recovery_current_number`, `opensearch_ingest_total_count` / `_failed_count`, `opensearch_script_compilations_count` | Shard recovery, ingest pipelines, script compile and cache. |
| JVM internals | `opensearch_jvm_bufferpool_*`, `_classes_*`, `_mem_pool_*`, `_mem_nonheap_*` | Buffer pools, class loading, memory pools, non-heap. |
| Filesystem / I/O | `opensearch_fs_io_total_*`, `opensearch_fs_path_available_bytes` | Per-device I/O and per-path capacity detail. |
| Transport / HTTP detail | `opensearch_transport_rx_packets_count` / `_tx_packets_count`, `opensearch_http_open_server_number` | Packet-level transport and HTTP connection detail. |
| Topology | `opensearch_cluster_nodes_number` / `_datanodes_number` / `_shards_number`, `opensearch_node_role_bool` | Node and shard counts, node role flags. |
| Disk-watermark config | `opensearch_cluster_routing_allocation_disk_watermark_low_pct` / `_high_pct` / `_flood_stage_pct` / `_disk_threshold_enabled` | The configured watermark thresholds (configuration, not live usage). |

Full metric list: install the plugin and run
`curl -s http://localhost:9200/_prometheus/metrics | grep "^# TYPE"`
against your OpenSearch instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series.
`up`, `opensearch_cluster_status`, `opensearch_cluster_shards_active_percent`,
and `opensearch_indices_indexing_is_throttled_bool` read **states** - the
`cluster_status` enum is OpenSearch's own health value, not an invented
absolute. The rest are relative to your own baseline; tune them to your
workload and invent no absolute thresholds.

| Alert | Condition |
|---|---|
| OpenSearch unreachable | `up == 0` for > 1m |
| Cluster red | `opensearch_cluster_status == 2` |
| Cluster yellow (sustained) | `opensearch_cluster_status == 1` held beyond a recovery window |
| Shards not fully active | `opensearch_cluster_shards_active_percent < 100` sustained |
| JVM heap pressure | `opensearch_jvm_mem_heap_used_percent` sustained high / rising toward the heap max, with `rate(opensearch_jvm_gc_collection_time_seconds)` climbing |
| Disk watermark crossed | `opensearch_fs_path_available_bytes` falling toward the `_disk_watermark_*_pct` thresholds (write blocking at flood stage) |
| Search latency rising | `rate(opensearch_indices_search_query_time_seconds) / rate(opensearch_indices_search_query_count)` increasing |
| Indexing failures | `rate(opensearch_indices_indexing_index_failed_count) > 0` |
| Indexing throttled | `opensearch_indices_indexing_is_throttled_bool == 1` |
| Circuit breaker tripped | `rate(opensearch_circuitbreaker_tripped_count) > 0` |
| Leaked search contexts | `opensearch_indices_search_open_contexts_number` rising / `search_scroll_current_number` not draining |
| Cache thrash | rising `querycache` / `requestcache` evictions with a falling hit ratio |
| Merge back-pressure | `opensearch_indices_merges_current_number` high + `rate(opensearch_indices_merges_total_throttled_time_seconds)` rising |
| Cluster task backlog | `opensearch_cluster_pending_tasks_number` rising / `_task_max_waiting_time_seconds` high |

## Access Setup

The prometheus-exporter plugin is not bundled with OpenSearch. Install the
release whose version equals your OpenSearch version exactly on every node:

```bash showLineNumbers title="Install prometheus-exporter plugin"
# Plugin version must equal your OpenSearch version exactly
bin/opensearch-plugin install \
  https://github.com/opensearch-project/opensearch-prometheus-exporter/releases/download/3.7.0.0/prometheus-exporter-3.7.0.0.zip
```

Restart the node after installation. Verify the plugin is loaded:

```bash showLineNumbers title="Verify plugin"
curl -s http://localhost:9200/_cat/plugins | grep prometheus
```

For Docker deployments, build a custom image with the matching plugin
pre-installed:

```dockerfile showLineNumbers title="Dockerfile"
FROM opensearchproject/opensearch:3.7.0
RUN /usr/share/opensearch/bin/opensearch-plugin install -b \
  https://github.com/opensearch-project/opensearch-prometheus-exporter/releases/download/3.7.0.0/prometheus-exporter-3.7.0.0.zip
```

The plugin and OpenSearch version literals must stay in lockstep - bump the
`FROM` tag and the plugin release together.

No authentication is required when the security plugin is disabled. On
secured clusters the scrape needs `basic_auth` (or client certs) and a
monitoring role granting the cluster monitor actions the exporter calls -
`cluster:monitor/prometheus/metrics` plus `cluster:monitor/health`,
`cluster:monitor/state`, `cluster:monitor/nodes/info`,
`cluster:monitor/nodes/stats` - and the index permission
`indices:monitor/stats`. Create a read-only monitoring role with those
actions via the OpenSearch security API, map a monitoring user to it, and
supply the credentials in the scrape config (see the secured variant in
[Configuration](#configuration)).

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 15s
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200

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
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
OPENSEARCH_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Secured clusters

When the security plugin is enabled, scrape over `https` with basic auth.
The monitoring user's role must grant the cluster monitor actions the
exporter calls (`cluster:monitor/prometheus/metrics`, `cluster:monitor/health`,
`cluster:monitor/state`, `cluster:monitor/nodes/info`,
`cluster:monitor/nodes/stats`) and `indices:monitor/stats`:

```yaml showLineNumbers title="config/otel-collector.yaml (secured)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 15s
          metrics_path: /_prometheus/metrics
          scheme: https
          tls_config:
            insecure_skip_verify: true  # Set false in production with valid certs
          basic_auth:
            username: ${env:OPENSEARCH_USER}
            password: ${env:OPENSEARCH_PASSWORD}
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200
```

### Scoping which families ship

The endpoint exposes 230+ series, including the per-index
`opensearch_index_*` family. A `metric_relabel_configs` keep rule scopes
which families the Collector forwards - for example, keeping the
node-level cluster, index-aggregate, JVM, OS, process, transport, and HTTP
families:

```yaml showLineNumbers title="config/otel-collector.yaml (scoped families)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 15s
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "opensearch_(cluster|indices|jvm|os|process|transport|http)_.*"
              action: keep
```

This selects which series the pipeline carries; it does not change the
metric tier of anything kept. When the per-index family is what you want,
drop the keep rule or replace it with an `index`-label allow-list instead.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped OpenSearch metrics
docker logs otel-collector 2>&1 | grep -i "opensearch"

# Verify the metrics endpoint directly
curl -s http://localhost:9200/_prometheus/metrics \
  | grep opensearch_cluster_status

# Check cluster health
curl -s http://localhost:9200/_cluster/health?pretty
```

## Troubleshooting

### Metrics endpoint returns 400 or not found

**Cause**: The prometheus-exporter plugin is not installed or failed to
load.

**Fix**:

1. List installed plugins: `curl -s http://localhost:9200/_cat/plugins`.
2. Look for `prometheus-exporter` in the output.
3. If missing, install the matching-version plugin and restart the node.
4. Confirm the plugin version equals your OpenSearch version exactly.

### Connection refused on port 9200

**Cause**: The Collector cannot reach OpenSearch at the configured address.

**Fix**:

1. Verify OpenSearch is running: `curl -s http://localhost:9200`.
2. For Docker, ensure both containers are on the same network.
3. Check firewall rules if the Collector runs on a separate host.

### Plugin version mismatch

**Cause**: The prometheus-exporter plugin version does not equal the
OpenSearch version, so the plugin fails to install or the node will not
start.

**Fix**:

1. Check the OpenSearch version:
   `curl -s http://localhost:9200 | jq .version.number`.
2. Download the matching release from
   [GitHub releases](https://github.com/opensearch-project/opensearch-prometheus-exporter/releases).
3. Remove the old plugin and install the version-matched one, then restart.

### Counters look flat or jump backwards in dashboards

**Cause**: This plugin reports its monotonic counters (`*_count`,
`*_total_*`, the `*_seconds` accumulators) as Prometheus gauges, so the
receiver ingests them as Gauge rather than Sum.

**Look at**: any `*_count` / `*_time_seconds` series - it carries the raw
cumulative value and resets to 0 on a node restart.

**Fix**:

1. Apply `rate()` / delta in the backend to turn these gauges into rates.
2. Treat a drop to 0 as a node restart, not data loss.

### Metric volume or cardinality is high

**Cause**: The per-index `opensearch_index_*` family carries an `index`
label and also covers system indices (for example `.plugins-ml-config`);
on a busy cluster it dominates cardinality.

**Look at**: the count of distinct `index` label values on the
`opensearch_index_*` series.

**Fix**:

1. Scope the families with the `metric_relabel_configs` keep rule (see
   [Configuration](#configuration)).
2. Or add an `index`-label allow-list to keep only the indices you care
   about; the node-level `opensearch_indices_*` aggregate stays available
   for cluster-wide views.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with OpenSearch running in Kubernetes?**

Yes. Set `targets` to the OpenSearch service DNS
(e.g., `opensearch-cluster.opensearch.svc.cluster.local:9200`). The
prometheus-exporter plugin must be present in the container image - bake it
into a custom image or install it via an init container. The Collector can
run as a sidecar or a DaemonSet.

**How do I monitor an OpenSearch cluster with multiple nodes?**

Add each node endpoint to the scrape config:

```yaml showLineNumbers title="Multi-node scrape"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - opensearch-1:9200
                - opensearch-2:9200
                - opensearch-3:9200
```

Each node exposes its own node-level and per-index series; the
cluster-health series are consistent across all nodes.

**What is the difference between `opensearch_index_*` and
`opensearch_indices_*` metrics?**

`opensearch_index_*` is the per-index breakdown, carrying an `index` label.
`opensearch_indices_*` is the node-level aggregate across all indices on
the node. For cluster-wide monitoring the `opensearch_indices_*` aggregate
is usually enough; reach for the per-index family during an incident or a
capacity review.

**Why do counters show up as gauges?**

This plugin reports its counter-like series as Prometheus gauges, so the
receiver ingests them as Gauge. Apply `rate()` / delta in the backend to read
them as rates, and expect a reset to 0 on a node restart. The receiver honors
the exporter's `# TYPE` line, so any series the exporter does label `counter`
arrives as a Sum.

**Can I use this instead of the OpenSearch Dashboards monitoring?**

Yes. The plugin exposes the same underlying cluster and node statistics.
The OTel Collector approach centralizes those metrics alongside the rest of
your infrastructure telemetry in base14 Scout.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on OpenSearch metrics.
- [Elasticsearch Monitoring](./elasticsearch.md) -
  The other Lucene-based search engine, on the same Scout pipeline.
- [Redis Monitoring](./redis.md) -
  A common companion datastore in search and caching tiers.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Elasticsearch](./elasticsearch.md), [Redis](./redis.md), and other
  components.
- **Fine-tune Collection**: Scope the per-index family with
  `metric_relabel_configs` and tune `scrape_interval` to your cluster size
  and retention needs.
