---
title: >
  Solr OpenTelemetry Monitoring - Request Latency, Cache Hit Ratio,
  and Collector Setup
sidebar_label: Solr
id: collecting-solr-telemetry
sidebar_position: 17
description: >
  Collect Solr metrics with the OpenTelemetry Collector. Monitor request
  latency, cache hit ratio, JVM heap, and indexing backlog, then ship to
  base14 Scout.
keywords:
  - solr opentelemetry
  - solr otel collector
  - solr metrics monitoring
  - solr performance monitoring
  - opentelemetry prometheus receiver solr
  - solr observability
  - solr search monitoring
  - solr telemetry collection
---

# Solr

Solr exposes Prometheus-format metrics natively at
`/solr/admin/metrics?wt=prometheus`, so no exporter sidecar is needed.
The OpenTelemetry Collector scrapes that endpoint with the `prometheus`
receiver to collect 70+ metrics spanning request throughput and latency,
searcher cache hit ratios, JVM heap and GC, indexing backlog, and index
and disk capacity from Solr 7.x+. This guide configures the receiver, points it
at a Solr node, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Solr                   | 7.x     | 10.0        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Before starting:

- Solr's HTTP port (8983) must be reachable from the host running the
  Collector.
- The `/solr/admin/metrics` endpoint is enabled by default.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the metrics endpoint is reachable and monitoring itself is alive. |
| `solr_core_requests_total` | Request throughput per handler and core - the headline KPI for "is Solr answering queries". |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Request latency | `solr_core_requests_times_milliseconds`, `solr_node_requests_times_milliseconds` | Per-handler and node-level request latency (count / sum / quantiles). |
| Node throughput | `solr_node_requests_total` | Node-level request count alongside the per-core total. |
| Searcher cache | `solr_core_indexsearcher_cache_lookups_total`, `solr_core_indexsearcher_cache_ops_total` | Cache lookups and hits / inserts / evictions by op - the inputs to hit ratio. |
| JVM memory | `jvm_memory_used_bytes`, `jvm_memory_limit_bytes` | Heap / non-heap in use against the ceiling; the saturation signal for OOM and GC risk. |
| GC | `jvm_gc_duration_seconds` | Stop-the-world pause time; rising pauses hurt query latency. |
| Indexing backlog | `solr_core_update_docs_pending_commit` | Docs added but not yet committed - a climbing value means commits are stalled. |
| Capacity | `solr_core_index_size_megabytes`, `solr_disk_space_megabytes`, `solr_cores_loaded` | On-disk index size per core, free disk for Solr data, and the count of loaded cores. |

Hit ratio is not a single metric - derive it as
`solr_core_indexsearcher_cache_ops_total{...hits}` over
`solr_core_indexsearcher_cache_lookups_total`.

### Diagnostic - for investigation and tuning

Higher cardinality; enable on demand. In production you can drop this
tier with `metric_relabel_configs` and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Searcher caches | `solr_core_indexsearcher_cache_size`, `_cache_ram_used_bytes`, `_cache_warmup_time_milliseconds`, `_live_docs_cache_total`, `_termstats_cache`, `solr_core_field_cache_entries`, `_field_cache_size_bytes` | Per-cache sizing, RAM, and warmup cost when tuning cache configuration. |
| Index / searcher detail | `solr_core_indexsearcher_index_docs`, `_index_num_docs`, `_index_version`, `_index_commit_size_megabytes`, `_open_time_milliseconds`, `_open_warmup_time_milliseconds`, `solr_core_segments`, `solr_core_searcher_new_total`, `solr_core_indexwriter_flushes_total`, `solr_core_disk_space_megabytes`, `solr_core_ref_count` | Segment counts, searcher reopens, and index internals during merge or commit investigation. |
| Update / transaction log | `solr_core_update_auto_commits_total`, `_commit_ops_total`, `_commit_stats`, `_committed_ops_total`, `_cumulative_ops`, `_log_buffered_ops`, `_log_replay_logs_remaining`, `_log_size_remaining_bytes`, `_log_state`, `_submitted_ops_total` | Commit cadence and tlog replay state when indexing or recovery misbehaves. |
| Replication | `solr_core_replication_index_generation`, `_index_size_megabytes`, `_index_version`, `_is_enabled`, `_is_follower`, `_is_leader` | Leader / follower role and replication progress (read their not-configured defaults on a standalone node). |
| Executors / thread pools | `solr_core_executor_thread_pool_size`, `_executor_thread_pool_tasks`, `solr_node_executor_task_times_milliseconds`, `_executor_tasks_running`, `_executor_tasks_total`, `_executor_thread_pool_size`, `_executor_thread_pool_tasks` | Thread-pool depth and task timing under concurrency. |
| JVM detail | `jvm_buffer_*`, `jvm_class_*`, `jvm_cpu_*`, `jvm_memory_allocation_bytes`, `_memory_committed_bytes`, `_memory_init_bytes`, `_memory_used_after_last_gc_bytes`, `jvm_network_*`, `jvm_system_cpu_utilization_ratio`, `jvm_thread_count` | The full JVM breakdown - buffers, class loading, CPU, allocation, and threads - for deep JVM tuning. |

Full metric reference: run
`curl -s 'http://localhost:8983/solr/admin/metrics?wt=prometheus'`
against your Solr instance, or see the
[Solr metrics reporting](https://solr.apache.org/guide/solr/latest/deployment-guide/metrics-reporting.html)
documentation.

SolrCloud-only series (overseer, ZooKeeper, shard / replica state) do
not appear on a standalone node, and the replication series read their
not-configured defaults until replication is set up.

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. Tune to
your workload; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `solr_core_requests_times_milliseconds` (p95) | Rising vs baseline | Sustained regression | Query slowdown; check cache hit ratio, GC, and slow queries. |
| `cache_ops_total{...hits}` / `cache_lookups_total` | Hit ratio falling | Sharply low | Cache too small or churning; tune cache sizes / autowarm. |
| `jvm_memory_used_bytes` / `jvm_memory_limit_bytes` | > 80% of limit | Near limit | OOM and long-GC risk; raise heap or reduce cache / field load. |
| `rate(jvm_gc_duration_seconds)` | Rising | Sustained high | Stop-the-world pauses hurting latency; tune heap / GC. |
| `solr_core_update_docs_pending_commit` | Climbing without commit | Not draining | Commits stalled; check commit settings and indexing throughput. |
| `solr_disk_space_megabytes` (free) | Trending down | < 10% of volume | Plan storage before the volume fills as `index_size_megabytes` grows. |

## Access Setup

Solr serves Prometheus-format metrics natively - there is no exporter to
run. The metrics live at `/solr/admin/metrics` and the `wt=prometheus`
query parameter selects the Prometheus rendering.

Verify the endpoint is reachable:

```bash showLineNumbers title="Verify access"
# Check Solr status
curl -s http://localhost:8983/solr/admin/info/system | head -20

# List cores
curl -s http://localhost:8983/solr/admin/cores

# Verify Prometheus metrics endpoint
curl -s 'http://localhost:8983/solr/admin/metrics?wt=prometheus' | head -20
```

No authentication is required by default. Clusters with Basic
Authentication enabled need credentials on the scrape - see
[Authentication](#authentication) below.

The Collector's `prometheus` receiver must override the default
`/metrics` path with `metrics_path: /solr/admin/metrics` and pass
`params: { wt: [prometheus] }`. Both are set in the
[Configuration](#configuration) section.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          scrape_interval: 30s
          metrics_path: /solr/admin/metrics   # Solr's endpoint, not the default /metrics
          params:
            wt: [prometheus]                   # Select Prometheus rendering
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983

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
      insecure_skip_verify: true        # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic tier with a
`metric_relabel_configs` block on the scrape config while keeping the
Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
SOLR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For Solr clusters with Basic Authentication enabled, add `basic_auth` to
the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (auth)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
          basic_auth:
            username: ${env:SOLR_USERNAME}
            password: ${env:SOLR_PASSWORD}
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983
```

### Filtering Metrics

To collect only specific metric groups, use Solr's `group` parameter:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
            group: [jvm, node, core]   # Limit to selected metric groups
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983
```

Available groups: `jvm`, `jetty`, `node`, `core`, `overseer`.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Solr metrics (grep the metric prefix)
docker logs otel-collector 2>&1 | grep -i "solr_core"

# Confirm the endpoint is serving Prometheus-format metrics
curl -s 'http://localhost:8983/solr/admin/metrics?wt=prometheus' \
  | grep solr_core_requests_total

# Generate request and index traffic so the series move
curl -s 'http://localhost:8983/solr/demo/select?q=*:*' > /dev/null
```

## Troubleshooting

### Connection refused on port 8983

**Cause**: The Collector cannot reach Solr at the configured address.

**Fix**:

1. Verify Solr is running: `docker ps | grep solr` or
   `systemctl status solr`.
2. Confirm Solr is listening: `curl http://localhost:8983/solr/`.
3. Check firewall rules if the Collector runs on a separate host.

### Metrics endpoint returns JSON instead of Prometheus format

**Cause**: The `wt=prometheus` parameter is missing from the scrape
config, so Solr falls back to JSON, which the `prometheus` receiver
cannot parse.

**Fix**:

1. Ensure `params: { wt: [prometheus] }` is set on the scrape job.
2. Confirm `metrics_path` is `/solr/admin/metrics`, not the default
   `/metrics`.
3. Verify with `curl 'http://localhost:8983/solr/admin/metrics?wt=prometheus'`.

### Queries are slow or latency is climbing

**Cause**: A low cache hit ratio, JVM heap pressure, or GC pauses.

**Look at**: the searcher-cache Diagnostic series -
`solr_core_indexsearcher_cache_size`, `_cache_ram_used_bytes`, and
`_cache_warmup_time_milliseconds` - alongside `jvm_memory_used_bytes`
against `jvm_memory_limit_bytes` and the `jvm_gc_duration_seconds` rate.
A hit ratio falling while warmup time climbs points at undersized or
churning caches; heap near the limit with rising GC points at memory
pressure.

**Fix**:

1. Tune cache sizes and autowarm counts if the hit ratio is low.
2. Raise heap or reduce cache / field load if `jvm_memory_used_bytes`
   sits near `jvm_memory_limit_bytes`.

### Indexing backlog grows and commits stall

**Cause**: Commits are not keeping up with indexing, or the transaction
log is replaying.

**Look at**: the update / tlog Diagnostic series -
`solr_core_update_commit_ops_total`,
`solr_core_update_auto_commits_total`, and
`solr_core_update_log_replay_logs_remaining` - against the Operational
`solr_core_update_docs_pending_commit`. A pending count that climbs
while commit ops stay flat means commits are stalled; non-zero replay
logs means the node is still recovering its tlog.

**Fix**:

1. Review autoCommit / autoSoftCommit settings and commit cadence.
2. Throttle indexing throughput or add capacity if commits cannot keep
   up.

### Core-level metrics missing

**Cause**: Core metrics (`solr_core_*`) only appear when at least one
core is loaded.

**Fix**:

1. Create a core:
   `curl 'http://localhost:8983/solr/admin/cores?action=CREATE&name=demo&configSet=_default'`.
2. Verify cores exist: `curl http://localhost:8983/solr/admin/cores`.
3. Check `solr_cores_loaded` reflects the expected count.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Solr running in Kubernetes?**

Yes. Set `targets` to the Solr pod or service DNS
(e.g., `solr-0.solr.default.svc.cluster.local:8983`) and keep the
`metrics_path` and `params` overrides. The Collector can run as a
sidecar or a DaemonSet.

**How do I monitor a SolrCloud cluster?**

Add every node endpoint to the scrape config. Each node is scraped
independently and identified by its `instance` label:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-node)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
          static_configs:
            - targets:
                - solr-1:8983
                - solr-2:8983
                - solr-3:8983
```

**What is the difference between `node` and `core` metrics?**

Node metrics (`solr_node_*`) cover the whole instance - aggregate
request counts, latency, and executor pools. Core metrics
(`solr_core_*`) are per-core and include request throughput, searcher
caches, index size, and update-handler stats. Core metrics only appear
once a core is loaded.

**Why are `overseer` and replication metrics empty?**

Overseer metrics only appear in SolrCloud mode on the elected overseer
node, so a standalone instance does not emit them. The
`solr_core_replication_*` series read their not-configured defaults
(for example `solr_core_replication_is_enabled`) until replication is
actually set up.

**Why is the cache hit ratio not a single metric?**

Solr exposes the inputs, not the ratio. Derive it as
`solr_core_indexsearcher_cache_ops_total{...hits}` over
`solr_core_indexsearcher_cache_lookups_total` and chart or alert on the
quotient.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Solr metrics.
- [Elasticsearch Monitoring](./elasticsearch.md) - Another search engine
  you may run alongside Solr.
- [Redis Monitoring](./redis.md) - A common caching layer in front of
  search.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Elasticsearch](./elasticsearch.md), [Redis](./redis.md), and other
  components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for
  incident investigation.
