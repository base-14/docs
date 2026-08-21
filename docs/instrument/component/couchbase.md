---
title: >
  Couchbase OpenTelemetry Monitoring - Data Service, Cluster Health,
  and Collector Setup
sidebar_label: Couchbase
id: collecting-couchbase-telemetry
sidebar_position: 30
description: >
  Collect Couchbase metrics with the OpenTelemetry Collector. Monitor
  data-service operations, memory and OOM, cluster balance, and disk
  queues, and ship to base14 Scout.
keywords:
  - couchbase opentelemetry
  - couchbase otel collector
  - couchbase metrics monitoring
  - couchbase performance monitoring
  - opentelemetry prometheus receiver couchbase
  - couchbase observability
  - monitor couchbase kubernetes
  - couchbase telemetry collection
---

# Couchbase

Couchbase Server 7.0+ serves Prometheus text at `/metrics` on the
management port `:8091` (basic auth - any user with the
`external_stats_reader` role). The OpenTelemetry Collector's `prometheus`
receiver scrapes it, collecting 500+ metrics across cluster-manager state
(rebalance, auto-failover, REST), the data service (operations, items,
memory, disk queues, vbuckets), and host / process resources. This guide
configures the receiver, sets up the required authentication, and ships
metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended    |
| ---------------------- | ------- | -------------- |
| Couchbase Server       | 7.0     | 7.6+ (7.6.2)   |
| OTel Collector Contrib | 0.90.0  | 0.153.0        |
| base14 Scout           | Any     | -              |

Before starting:

- Couchbase must be initialized; the management port (8091) must be
  reachable from the host running the Collector.
- A monitoring user with the `external_stats_reader` role (see
  [Access Setup](#access-setup) below).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

Couchbase has a real `up` series here - the `prometheus` receiver emits
`up = 1` when `/metrics` responds, so that is the liveness signal.
`cm_is_balanced` (1 = the cluster's data is evenly distributed) and
`kv_uptime_seconds` (a reset means a restart) are the in-band cluster-state
and uptime signals.

A few things shape this surface:

- **`/metrics` needs basic auth.** Grant a monitoring user the
  `external_stats_reader` role (read-only, no data access; admin
  credentials also work for testing). Couchbase 7.0+ is the floor for this
  endpoint - older versions do not expose it.
- **Four naming domains share the endpoint.** `cm_*` is the cluster manager
  (Erlang / ns_server: REST, auth caches, rebalance, auto-failover,
  chronicle consensus), `kv_*` is the data service (memcached / EP-engine:
  connections, ops, items, memory, disk queues, vbuckets), `sys_*` is host /
  cgroup CPU-memory-disk, and `sysproc_*` is per-process CPU and memory.
  `couch_*`, `audit_*`, and `exposer_*` round it out.
- **The `kv_ep_*` family is mostly EP-engine configuration**, not live
  signals - watermarks, thresholds, `max_*` sizes, `enabled` flags, and
  `alog_*` / `bfilter_*` tunables read as static gauges. The operational
  subset is the memory, disk-queue, flusher, background-fetch, OOM, and
  IO-failure counters.
- **Cardinality is concentrated in `kv_*`.** Most `kv_*` series carry a
  `bucket` label, so the per-bucket count multiplies with bucket count; the
  `sys_*` / `sysproc_*` / `cm_*` families are per-node.
- **A few series are exposed twice per scrape** (same name and labels, two
  values). The `prometheus` receiver keeps the first and drops the duplicate
  (a benign `different value but same timestamp` warning), so the
  unique-name count is unaffected.
- **`exposer_*` is Couchbase's own Prometheus-client scrape meta** (scrape
  latency / count from the exporter side), distinct from the receiver-side
  `scrape_*`.
- **Warm-up.** The `kv_*` data-service families populate only once a bucket
  exists and takes operations. A fresh node with no bucket shows mostly
  `cm_*` and `sys_*`.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Prometheus scrape liveness - 1 = the Couchbase metrics endpoint responded. The liveness signal on this surface. |
| `cm_is_balanced` | 1 = the cluster's data is balanced across nodes; 0 = a rebalance is needed. |
| `kv_ops` | Data-service operations - headline throughput. |
| `kv_curr_connections` | Current data-service client connections. |
| `kv_mem_used_bytes` | Data-service memory in use - the headline memory signal, watched against the bucket quota watermarks. |
| `kv_ep_oom_errors` | Hard out-of-memory errors - the data service rejected operations because it hit the quota. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Rebalance & failover | `cm_rebalance_in_progress`, `cm_rebalance_stuck`, `cm_auto_failover_count`, `cm_auto_failover_enabled` | Whether a rebalance is running or stuck, and whether a node was auto-failed-over. |
| Cluster-manager activity | `cm_http_requests_total` (+ `_seconds_*` latency), `cm_authentications_total`, `cm_memcached_call_time_seconds_*`, `cm_logs_total` | REST request rate and latency, auth attempts, memcached-call latency, and log volume by level. |
| Data-service failures | `kv_ops_failed`, `kv_auth_errors`, `kv_cmd_duration_seconds_*` | Failed operations, auth failures, and the read/write latency SLO. |
| Items & connections | `kv_curr_items`, `kv_curr_items_tot`, `kv_total_connections` | Active items (this node), total items including replicas, and cumulative connections opened. |
| Memory pressure | `kv_ep_tmp_oom_errors`, `kv_ep_mem_high_wat`, `kv_ep_mem_low_wat` | Temporary OOM (clients should back off), and the high / low watermarks that bound `kv_mem_used_bytes`. |
| Persistence | `kv_ep_diskqueue_items`, `kv_ep_diskqueue_fill`, `kv_ep_diskqueue_drain`, `kv_ep_flusher_todo`, `kv_ep_item_commit_failed`, `kv_ep_item_flush_failed` | Disk write-queue depth, fill vs drain rate, flusher backlog, and commit/flush failures - fill outpacing drain is a persistence backlog. |
| Disk IO & cache | `kv_ep_data_read_failed`, `kv_ep_data_write_failed`, `kv_ep_bg_fetched`, `kv_ep_num_eject_failures` | Disk read/write failures, background fetches (cache misses to disk), and failed evictions. |
| Resident set & vbuckets | `kv_vb_perc_mem_resident_ratio`, `kv_vb_num_non_resident`, `kv_vb_queue_size`, `kv_vb_queue_age_seconds`, `kv_vb_ops_create`, `kv_vb_ops_delete`, `kv_vb_ops_update`, `kv_vb_ops_get`, `kv_vb_ops_reject`, `kv_vb_sync_write_aborted_count` | Resident ratio (falling means reads hit disk), per-vbucket queue depth/age, operation rates (rejects = backpressure), and aborted durable writes. |
| Replication | `kv_dcp_num_running_backfills` | Running DCP backfills - replication / index / XDCR catching up from disk. |
| Host & process | `sys_cpu_utilization_rate`, `sys_cpu_host_utilization_rate`, `sys_cpu_cgroup_seconds_total`, `sys_cpu_throttled_rate`, `sys_mem_actual_used`, `sys_mem_actual_free`, `sys_mem_limit`, `sys_mem_cgroup_used`, `sys_mem_cgroup_limit`, `sys_disk_read_bytes`, `sys_disk_write_bytes`, `sys_disk_queue`, `sys_disk_usage_ratio`, `sys_disk_time_seconds`, `sys_swap_used`, `sysproc_cpu_utilization`, `sysproc_mem_resident`, `sysproc_major_faults_raw` | Node and cgroup CPU (throttling = CPU-capped), memory used/free/limit, disk bytes/queue/busy time, swap in use, and per-process CPU/memory/page-faults. |
| Storage & audit | `couch_docs_actual_disk_size`, `audit_queue_length` | On-disk document size (data-at-rest growth) and pending audit-log entries. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity review.
The large `kv_ep_*` configuration surface and the per-vbucket detail are
grouped, not enumerated - representative member names are shown.

| Group | Metrics | When you reach for it |
|---|---|---|
| Uptime & memory detail | `kv_uptime_seconds`, `kv_curr_temp_items`, `kv_mem_used_estimate_bytes`, `kv_memory_used_bytes`, `kv_memory_overhead_bytes`, `kv_logical_data_size_bytes` | Restart detection, in-flight metadata, allocator overhead, and logical (pre-compression) size. |
| Connection & command detail | `kv_read_bytes`, `kv_written_bytes`, `kv_num_vbuckets`, `kv_num_high_pri_requests`, `kv_items_in_transit`, `kv_auth_cmds`, `kv_cmd_lookup`, `kv_cmd_mutation`, `kv_conn_yields`, `kv_conn_timeslice_yields`, `kv_disk_seconds_*` | Bytes on connections, vbucket count, command-class counts, scheduling yields, and disk-op latency. |
| EP-engine IO & checkpoints | `kv_ep_io_*`, `kv_ep_commit_num`, `kv_ep_commit_time_seconds`, `kv_ep_diskqueue_pending`, `kv_ep_diskqueue_memory_bytes`, `kv_ep_arena_memory_*`, `kv_ep_blob_num`, `kv_ep_item_*`, `kv_ep_num_checkpoints*`, `kv_ep_checkpoint_*`, `kv_ep_items_expelled_from_checkpoints` | EP-engine IO bytes, commit timing, disk-queue memory, allocator arenas, item internals, and checkpoint accounting. |
| EP-engine configuration | `kv_ep_max_*`, `kv_ep_mem_*_ratio`, `kv_ep_*_enabled`, `kv_ep_alog_*`, `kv_ep_bfilter_*`, `kv_ep_chk_*`, `kv_ep_bucket_quota_*` | Static gauges: max sizes, watermark ratios, feature flags, access-log, bloom-filter, and checkpoint tunables. |
| Per-vbucket detail | `kv_vb_ht_*`, `kv_vb_checkpoint_memory_*`, `kv_vb_mem_freed_by_checkpoint_*`, `kv_vb_bloom_filter_memory_bytes`, `kv_vb_dm_*`, `kv_vb_meta_data_*`, `kv_vb_queue_memory_bytes`, `kv_vb_curr_items`, `kv_vb_eject`, `kv_vb_expired`, `kv_vb_rollback_item_count`, `kv_vb_sync_write_*` | Hash-table, checkpoint-memory, durability-monitor, metadata, eject/expiry, rollback, and sync-write detail. |
| Sub-document & collections | `kv_subdoc_*`, `kv_collection_*`, `kv_dcp_max_running_backfills` | Sub-document operation counts, collection-manifest detail, and DCP backfill capacity. |
| Data-service internals | `kv_audit_*`, `kv_daemon_*`, `kv_threads`, `kv_stat_reset`, `kv_clients`, `kv_user_connections`, `kv_system_connections` | Audit, daemon, thread, and connection-class detail. |
| Cluster-manager caches | `cm_auth_cache_*`, `cm_client_cert_cache_*`, `cm_up_cache_*`, `cm_user_bkts_cache_*`, `cm_uuid_cache_*`, `cm_web_cache_*`, `cm_mru_cache_*` | Cache hit / miss / size families on the cluster manager. |
| Cluster-manager internals | `cm_chronicle_*`, `cm_lease_acquirer_*`, `cm_timer_lag_seconds_*`, `cm_status_latency_seconds_*`, `cm_gc_duration_seconds_*`, `cm_erlang_process_count`, `cm_erlang_process_limit`, `cm_erlang_port_count`, `cm_erlang_port_limit`, `cm_memcached_cmd_total`, `cm_outgoing_http_requests_*`, `cm_rest_request_enters_total` | Chronicle consensus, leases, timer lag, GC, Erlang-VM process/port usage, and request lifecycle. |
| Host & process detail | `sys_cpu_host_*`, `sys_cpu_cores_available`, `sys_cpu_burst_rate`, `sys_allocstall`, `sys_pressure_*`, `sys_mem_free`, `sys_mem_total`, `sys_mem_cgroup_actual_used`, `sys_swap_total`, `sys_disk_reads`, `sys_disk_writes`, `sys_disk_read_time_seconds`, `sysproc_cpu_seconds_total`, `sysproc_mem_size`, `sysproc_mem_share`, `sysproc_minor_faults_raw`, `sysproc_start_time` | Per-mode CPU rates, core counts, PSI pressure, additional memory/swap, disk op counts, and per-process detail. |
| View storage & audit | `couch_views_actual_disk_size`, `audit_unsuccessful_retries` | On-disk view-index size and failed audit-write retries. |
| Scrape meta | `exposer_request_latencies`, `exposer_scrapes_total`, `exposer_transferred_bytes_total`, `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Couchbase's own Prometheus-exposer meta and the receiver-side scrape meta. |

Full metric list: run
`curl -su <user>:<pass> http://localhost:8091/metrics` against your
Couchbase instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series.
The state and event alerts (`up == 0`, `cm_is_balanced == 0`,
`cm_rebalance_stuck == 1`, the OOM / IO-failure counters, and
`sys_swap_used > 0`) read conditions, not invented absolutes. The rest are
relative to your baseline. Tune to your workload; these are starting points.

| Alert | Threshold | Why it matters |
|---|---|---|
| Couchbase unreachable | `up == 0` for > 1m | The metrics endpoint stopped responding - check the node process and port 8091. |
| Cluster not balanced | `cm_is_balanced == 0` | Data is not evenly distributed - run a rebalance. |
| Rebalance stuck | `cm_rebalance_stuck == 1` | A rebalance cannot progress - investigate node health and retry. |
| Node auto-failed-over | `increase(cm_auto_failover_count) > 0` | A node went down and was failed over - check the failed node and capacity. |
| Hard OOM | `rate(kv_ep_oom_errors) > 0` | The data service is rejecting operations on memory - raise the bucket quota or add nodes. |
| Temp OOM rising | `rate(kv_ep_tmp_oom_errors) > 0` | Clients are being told to back off - memory pressure precedes hard OOM. |
| Resident ratio falling | `kv_vb_perc_mem_resident_ratio` dropping vs baseline | Working set no longer fits in memory - reads hit disk and latency rises. |
| Persistence backlog | `kv_ep_diskqueue_fill` outpacing `kv_ep_diskqueue_drain`, or `kv_ep_flusher_todo` rising | Disk cannot keep up with writes - check disk throughput. |
| Disk IO failures | `rate(kv_ep_data_write_failed) > 0` or `rate(kv_ep_data_read_failed) > 0` | Storage is failing - check the disk and filesystem. |
| Command latency high | `kv_cmd_duration_seconds` p99 rising vs baseline | Data-service ops are slow - correlate with memory, disk queue, and CPU. |
| Swap in use | `sys_swap_used > 0` | The node is swapping - this severely degrades a database; reduce memory pressure. |

## Access Setup

### Initialize the cluster

A fresh Couchbase deployment must be initialized before metrics are
available. Skip this step if connecting to an existing cluster.

```bash showLineNumbers title="Initialize cluster via REST API"
# Initialize the cluster (run once on a fresh install)
curl -s -X POST http://localhost:8091/clusterInit \
  -d "hostname=127.0.0.1" \
  -d "username=Administrator" \
  -d "password=your_admin_password" \
  -d "services=kv" \
  -d "memoryQuota=512"

# Create a bucket (required for kv_* metrics to appear)
curl -s -X POST http://localhost:8091/pools/default/buckets \
  -u Administrator:your_admin_password \
  -d "name=demo&ramQuota=256&bucketType=couchbase&replicaNumber=0"
```

### Create a monitoring user

Create a dedicated monitoring user with the `external_stats_reader` role.
This grants read-only access to the `/metrics` endpoint without exposing
cluster administration or data.

```bash showLineNumbers title="Create monitoring user"
couchbase-cli user-manage \
  --cluster http://localhost:8091 \
  --username Administrator \
  --password your_admin_password \
  --set \
  --rbac-username otel_monitor \
  --rbac-password monitoring_password \
  --rbac-name "OTel Monitor" \
  --roles external_stats_reader \
  --auth-domain local
```

**Minimum required permissions:**

- `external_stats_reader`: required to read `/metrics`.

No write or data-access permissions are needed. For quick testing, admin
credentials also work.

Verify the endpoint:

```bash showLineNumbers title="Verify metrics access"
# Check Couchbase is initialized
curl -s http://localhost:8091/pools/default | head -5

# Verify the Prometheus metrics endpoint
curl -su otel_monitor:monitoring_password \
  http://localhost:8091/metrics | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: couchbase
          scrape_interval: 10s
          metrics_path: /metrics
          basic_auth:
            username: ${env:COUCHBASE_USER}
            password: ${env:COUCHBASE_PASSWORD}
          static_configs:
            - targets:
                - ${env:COUCHBASE_HOST}:8091
          metric_relabel_configs:
            # Scope to the Couchbase families; drops Go-runtime noise.
            - source_labels: [__name__]
              regex: "cm_.*|kv_.*|sys_.*|sysproc_.*|up"
              action: keep

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

The `metric_relabel_configs` keep filter scopes collection to the Couchbase
families (`cm_*`, `kv_*`, `sys_*`, `sysproc_*`, `up`). Narrow the regex to
adjust which families are collected and tune metric volume to your needs.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (introduced in semantic conventions v1.27.0, stable as of
> v1.41.0). Scout's UI filters on the lowercase `environment` key, so emit
> it alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
COUCHBASE_HOST=localhost
COUCHBASE_USER=otel_monitor
COUCHBASE_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Couchbase metrics
docker logs otel-collector 2>&1 | grep -i "couchbase"

# Verify Couchbase is healthy
curl -su ${COUCHBASE_USER}:${COUCHBASE_PASSWORD} \
  http://localhost:8091/pools/default | head -10

# Check the metrics endpoint directly
curl -su ${COUCHBASE_USER}:${COUCHBASE_PASSWORD} \
  http://localhost:8091/metrics | grep kv_curr_connections
```

## Troubleshooting

### Authentication failed (401 / 403)

**Cause**: The monitoring credentials are wrong, or the user lacks the
`external_stats_reader` role.

**Fix**:

1. Test credentials directly against the endpoint:
   `curl -su otel_monitor:password http://localhost:8091/metrics | head -5`.
2. If that fails, list users and confirm the role:

   ```bash showLineNumbers title="List users and roles"
   couchbase-cli user-manage \
     --cluster http://localhost:8091 \
     --username Administrator --password admin_pass --list
   ```

3. Confirm `COUCHBASE_USER` and `COUCHBASE_PASSWORD` are set in the
   Collector environment.

### Connection refused on port 8091

**Cause**: The Collector cannot reach Couchbase at the configured address.

**Fix**:

1. Verify Couchbase is running: `docker ps | grep couchbase` or
   `systemctl status couchbase-server`.
2. Confirm the management port is listening:
   `curl -s http://localhost:8091/ui/index.html`.
3. Check firewall rules if the Collector runs on a separate host.

### Cluster not initialized

**Cause**: The `/metrics` endpoint is unavailable until the cluster is
initialized.

**Fix**:

1. Run the `/clusterInit` step in [Access Setup](#access-setup).
2. Confirm initialization with `curl -s http://localhost:8091/pools/default`
   - an initialized cluster returns a JSON pool description.

### Only `cm_*` and `sys_*` metrics appear, no `kv_*`

**Cause**: There is no bucket with traffic yet. The data-service (`kv_*`)
families populate only once a bucket exists and takes operations.

**Look at**: `kv_curr_items` - it stays absent until a bucket holds data.

**Fix**:

1. Create a bucket:

   ```bash showLineNumbers title="Create a bucket"
   couchbase-cli bucket-create \
     --cluster http://localhost:8091 \
     --username Administrator --password admin_pass \
     --bucket demo --bucket-type couchbase --bucket-ramsize 256
   ```

2. Drive some operations, then wait one scrape interval and verify:
   `curl -su otel_monitor:password http://localhost:8091/metrics | grep kv_`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Does this work with Couchbase running in Kubernetes?

Yes. Set `targets` to the Couchbase service DNS endpoint (for example
`couchbase.default.svc.cluster.local:8091`) and inject the monitoring
credentials via a Kubernetes secret. With the Couchbase Autonomous Operator,
each pod exposes `/metrics` on 8091 - add all pod addresses to the scrape
config or use Prometheus service discovery.

### What permissions does the monitoring account need?

The `external_stats_reader` role only - it is read-only and grants no write
or data access. Admin credentials also work for quick testing.

### Does this work with Couchbase Community Edition?

Yes. Community Edition 7.0+ exposes the same `/metrics` endpoint with the
same `cm_*` / `kv_*` / `sys_*` / `sysproc_*` surface. The query (`n1ql_*`),
index (`index_*`), and search service families appear on either edition when
those services run; the analytics (`cbas_*`) and eventing (`eventing_*`)
families are Enterprise Edition only.

### Why do I only see `cm_*` and `sys_*` metrics?

There is no bucket with traffic yet. The data-service (`kv_*`) families
populate only once a bucket exists and takes operations. The cluster-manager
(`cm_*`) and host (`sys_*`) families are available immediately after the
cluster is initialized.

### Is the `different value but same timestamp` warning a problem?

No. Couchbase exposes a small number of duplicate samples (same name and
labels, two values) per scrape. The `prometheus` receiver keeps the first
and drops the duplicate, so the unique-name count is unaffected.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Couchbase metrics.
- [MongoDB Monitoring](./mongodb.md) -
  Monitor another document database.
- [CouchDB Monitoring](./couchdb.md) -
  Monitor a document database with an HTTP stats API.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MongoDB](./mongodb.md), [CouchDB](./couchdb.md), and other components.
- **Fine-tune Collection**: Use `metric_relabel_configs` to adjust which
  metric families are collected, balancing volume against the visibility you
  want for day-to-day monitoring and incident investigation.
