---
title: >
  MinIO OpenTelemetry Monitoring - S3 Request Rate, Cluster Capacity,
  and Drive Health
sidebar_label: MinIO
id: collecting-minio-telemetry
sidebar_position: 26
description: >
  Collect MinIO metrics with the OpenTelemetry Collector. Monitor S3
  request rate and errors, cluster capacity, and drive and erasure-set
  health, and ship to base14 Scout.
keywords:
  - minio opentelemetry
  - minio otel collector
  - minio metrics monitoring
  - minio performance monitoring
  - opentelemetry prometheus receiver minio
  - minio observability
  - minio object storage monitoring
  - minio telemetry collection
---

# MinIO

MinIO serves Prometheus-format metrics at `/minio/metrics/v3` (the current
v3 metrics API) on the S3 API port `:9000`. The OpenTelemetry Collector's
`prometheus` receiver scrapes that endpoint directly, collecting 100+
metrics across S3 request rate and errors, cluster capacity and
drive/erasure-set health, per-drive performance, and host and process
resources. This guide configures the receiver, sets up metrics
authentication, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended                            |
| ---------------------- | ------- | -------------------------------------- |
| MinIO                  | release exposing the metrics endpoint | current release (v3 metrics API) |
| OTel Collector Contrib | 0.90.0  | 0.153.0                                |
| base14 Scout           | Any     | -                                      |

Before starting:

- The MinIO S3 API port (`9000`) must be reachable from the host running
  the Collector.
- Metrics are token-gated by default - either set
  `MINIO_PROMETHEUS_AUTH_TYPE=public` or scrape with a bearer token (see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review. The metric names are MinIO's native v3 exposition
(`minio_<category>_*`), reproduced as the endpoint serves them.

A few surface notes shape how you read this set:

- **`up` is the liveness signal here.** The `prometheus` receiver emits
  `up = 1` when the `/minio/metrics/v3` endpoint responds. That is the
  monitoring-is-alive signal; `minio_cluster_health_drives_online_count`
  (against `minio_cluster_health_drives_count`) is the erasure-coding
  durability signal.
- **Use the v3 endpoint.** `/minio/metrics/v3` is the current metrics API
  and replaces the deprecated `/minio/v2/metrics/{cluster,node,bucket}`
  endpoints (still present in the release, but not for new deployments).
  The default v3 endpoint returns the `minio_api_*`, `minio_system_*`,
  `minio_cluster_*`, and `minio_scanner_*` families. Per-bucket,
  replication, notification, ILM, and resource detail live at dedicated v3
  sub-paths (for example `/minio/metrics/v3/bucket/api` and
  `/minio/metrics/v3/replication`) - add a scrape job per sub-path when you
  need that detail.
- **Metrics are token-gated by default.** Either set
  `MINIO_PROMETHEUS_AUTH_TYPE=public` or scrape with a bearer token from
  `mc admin prometheus generate`. A 403 with no token is expected
  otherwise.
- **Erasure-coding health is the storage-specific signal.**
  `minio_cluster_erasure_set_read_health` / `_write_health` report whether
  each set can still serve reads and writes. Below write quorum the set
  goes read-only; below read quorum it goes offline.
- **Counts scale with topology.** Node, drive, and erasure-set counts are
  `1` on a single-node single-drive deployment. The
  `minio_system_drive_*` and `minio_cluster_erasure_set_*` families expand
  (one series per drive, one per set) in a distributed deployment.
- **`go_*` is MinIO's own Go runtime**, not a storage signal. Prefer
  MinIO's own `minio_system_process_*` and filter `go_*` with a
  `minio_.*|up` keep rule.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - `1` when the MinIO metrics endpoint responded. The monitoring-is-alive signal on this surface. |
| `minio_api_requests_total` | S3 API requests handled, labeled by API name - headline request throughput. |
| `minio_api_requests_errors_total` | S3 API requests that returned an error - headline error signal. |
| `minio_cluster_health_capacity_usable_free_bytes` | Usable free capacity after erasure-coding overhead - running out is a top object-store incident. |
| `minio_cluster_health_drives_online_count` | Drives currently online (against `minio_cluster_health_drives_count`) - the erasure-coding durability signal. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| S3 errors and latency | `minio_api_requests_4xx_errors_total`, `minio_api_requests_incoming_total`, `minio_api_requests_ttfb_seconds_distribution` | Client-error volume, arriving load, and the time-to-first-byte latency SLO per API. |
| S3 traffic | `minio_api_requests_traffic_received_bytes`, `minio_api_requests_traffic_sent_bytes` | Inbound (uploads) and outbound (downloads) S3 bytes. |
| Cluster health | `minio_cluster_health_drives_count`, `minio_cluster_health_nodes_online_count`, `minio_cluster_health_capacity_usable_total_bytes`, `minio_cluster_health_capacity_raw_free_bytes` / `_raw_total_bytes` | Total drives, online nodes, and usable/raw capacity - the denominators for the durability and capacity ratios. |
| Erasure-set health | `minio_cluster_erasure_set_health`, `minio_cluster_erasure_set_read_health`, `minio_cluster_erasure_set_write_health`, `minio_cluster_erasure_set_online_drives_count`, `minio_cluster_erasure_set_read_quorum` / `_write_quorum` | Whether each set can serve reads/writes and how close it is to losing quorum. |
| Per-drive health | `minio_system_drive_health`, `minio_system_drive_used_bytes` / `_free_bytes` / `_total_bytes`, `minio_system_drive_free_inodes`, `minio_system_drive_api_latency_micros`, `minio_system_drive_perc_util`, `minio_system_drive_writes_await` / `_writes_per_sec` / `_writes_kb_per_sec` | Per-drive health, capacity, inodes, latency, and IO - a slow or full drive localizes a degraded cluster. |
| Host pressure | `minio_system_cpu_load_perc`, `minio_system_cpu_avg_iowait`, `minio_system_memory_used_perc`, `minio_system_memory_available` | Host CPU load, storage-bound iowait, and memory pressure. |
| MinIO process | `minio_system_process_resident_memory_bytes`, `minio_system_process_cpu_total_seconds`, `minio_system_process_file_descriptor_open_total`, `minio_system_process_file_descriptor_limit_total` | MinIO's own RSS, CPU time, and open file descriptors against the FD limit. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. They are grouped, not enumerated - representative members are
named.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| CPU and memory breakdown | `minio_system_cpu_load`, `minio_system_cpu_avg_idle` / `_system` / `_user`, `minio_system_memory_total` / `_free` / `_cache` / `_buffers` | Decomposing host CPU and memory beyond the headline percentages. |
| Per-drive counts and inodes | `minio_system_drive_count`, `minio_system_drive_online_count`, `minio_system_drive_total_inodes` / `_used_inodes` | Per-node drive visibility and inode accounting. |
| MinIO process internals | `minio_system_process_io_rchar_bytes` / `_wchar_bytes` / `_write_bytes`, `minio_system_process_syscall_read_total` / `_write_total`, `minio_system_process_go_routine_total`, `minio_system_process_virtual_memory_bytes`, `minio_system_process_uptime_seconds` | Process IO, syscalls, goroutines, and virtual memory during a CPU or memory investigation. |
| Bucket-usage staleness | `minio_cluster_usage_objects_buckets_count`, `minio_cluster_usage_objects_since_last_update_seconds`, `minio_cluster_usage_buckets_since_last_update_seconds` | Whether the object/bucket usage figures are fresh. |
| IAM sync | `minio_cluster_iam_sync_successes`, `minio_cluster_iam_last_sync_duration_millis`, `minio_cluster_iam_since_last_sync_millis` | IAM replication health on a configured cluster. |
| Object scanner | `minio_scanner_bucket_scans_started` / `_finished`, `minio_scanner_last_activity_seconds` | Whether the background object scanner is running. |
| Runtime and scrape meta | `go_*`, `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | MinIO's Go runtime and the receiver-side scrape meta; filter `go_*` with a `minio_.*\|up` keep rule. |

Some families are not on the default v3 endpoint or read `0` until the
feature is exercised: per-bucket (`minio_bucket_*`), replication,
notification, ILM, KMS, and audit families live at dedicated v3 sub-paths
and require those endpoints to be scraped; multi-node internode-network and
healing metrics populate only in a distributed deployment.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. The
state and ratio alerts read MinIO's own counts, totals, and limits - they
are not invented absolutes. The rate and latency alerts are relative to
your own baseline. Tune all of them to your workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The metrics endpoint stopped responding - check the MinIO process and the API port. |
| `minio_cluster_health_drives_online_count` | `< minio_cluster_health_drives_count` | One or more drives dropped - durability is reduced; replace the drive and let MinIO heal. |
| `minio_cluster_erasure_set_write_health` | `== 0` | The set can no longer accept writes - restore drives before it goes read-only or offline. |
| `minio_cluster_health_capacity_usable_free_bytes / minio_cluster_health_capacity_usable_total_bytes` | `< 0.1` | The cluster is running out of usable space - expand or reclaim. |
| `rate(minio_api_requests_errors_total)` | Rising vs baseline | Server-side S3 failures - check drive health, quorum, and recent changes. |
| `minio_api_requests_ttfb_seconds_distribution` | p99 rising vs baseline | Requests are slow - correlate with `minio_system_drive_api_latency_micros` and iowait. |
| `minio_system_drive_free_inodes` | Approaching `0` | A drive is out of inodes - new objects will fail even with free bytes. |
| `minio_system_process_file_descriptor_open_total / minio_system_process_file_descriptor_limit_total` | `> 0.9` | MinIO is near its FD limit - raise the ulimit. |

## Access Setup

MinIO exposes Prometheus metrics on the S3 API port, but they are
token-gated by default. Pick one of the two options below.

### Option 1: Public metrics (no token)

Set the environment variable before starting MinIO so the metrics endpoint
serves without auth:

```bash showLineNumbers title="Public metrics"
export MINIO_PROMETHEUS_AUTH_TYPE=public
```

### Option 2: Bearer token (recommended for shared networks)

Generate a scrape token with the MinIO client:

```bash showLineNumbers title="Generate bearer token"
# Set up the mc alias
mc alias set myminio http://localhost:9000 minioadmin minioadmin

# Generate a Prometheus scrape config with a bearer token
mc admin prometheus generate myminio
```

This outputs a scrape snippet containing the bearer token; use that token
in the Collector config below.

Verify the endpoint responds:

```bash showLineNumbers title="Verify access"
# Check MinIO is live
curl -s http://localhost:9000/minio/health/live

# Verify the v3 metrics endpoint (use a token here if not public)
curl -s http://localhost:9000/minio/metrics/v3 | head -20
```

The default v3 endpoint returns the `minio_api_*`, `minio_system_*`,
`minio_cluster_*`, and `minio_scanner_*` families. Per-bucket, replication,
and resource detail live at sub-paths such as `/minio/metrics/v3/bucket/api`
and `/minio/metrics/v3/replication`.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio
          scrape_interval: 10s
          metrics_path: /minio/metrics/v3
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000   # Change to your MinIO address
          metric_relabel_configs:
            # Scope to the MinIO namespace; drop go_* and scrape_* noise
            - source_labels: [__name__]
              regex: 'minio_.*|up'
              action: keep

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

If metrics are token-gated (Option 2 above), add a bearer token to the
scrape job instead of running the endpoint public:

```yaml showLineNumbers title="config/otel-collector.yaml (bearer token)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio
          scrape_interval: 10s
          metrics_path: /minio/metrics/v3
          authorization:
            type: Bearer
            credentials: ${env:MINIO_METRICS_TOKEN}
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000
```

The `metric_relabel_configs` keep filter scopes the pipeline to the MinIO
namespace - it keeps `minio_*` and the `up` liveness series and drops the
`go_*` runtime and `scrape_*` meta.

### Environment Variables

```bash showLineNumbers title=".env"
MINIO_HOST=localhost
MINIO_METRICS_TOKEN=your_bearer_token   # Only if using Option 2
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for the MinIO scrape
docker logs otel-collector 2>&1 | grep -i "minio"

# Verify MinIO is live
curl -s http://localhost:9000/minio/health/live

# Check the v3 metrics endpoint directly
curl -s http://localhost:9000/minio/metrics/v3 \
  | grep minio_cluster_health_capacity_usable_free_bytes
```

## Troubleshooting

### 403 Forbidden on the metrics endpoint

**Cause**: Metrics are token-gated and no bearer token was supplied.

**Fix**:

1. Generate a token: `mc admin prometheus generate <alias>`, then add it as
   `authorization: { type: Bearer, credentials: ${env:MINIO_METRICS_TOKEN} }`
   on the scrape job.
2. Or set `MINIO_PROMETHEUS_AUTH_TYPE=public` on the MinIO server for
   tokenless metrics.

### Wrong or empty metrics endpoint

**Cause**: Scraping a deprecated v2 path, or expecting per-bucket /
replication detail on the default v3 endpoint.

**Fix**:

1. Use `/minio/metrics/v3`, not the deprecated
   `/minio/v2/metrics/{cluster,node,bucket}` paths.
2. The default v3 endpoint returns the `minio_api_*`, `minio_system_*`,
   `minio_cluster_*`, and `minio_scanner_*` families only. Per-bucket,
   replication, notification, ILM, and resource detail live at dedicated v3
   sub-paths - add a scrape job per sub-path (for example
   `/minio/metrics/v3/bucket/api`) when you need that detail.

### Connection refused on port 9000

**Cause**: The Collector cannot reach MinIO at the configured address.

**Fix**:

1. Verify MinIO is running: `docker ps | grep minio` or
   `mc admin info <alias>`.
2. Confirm the S3 API port responds:
   `curl http://localhost:9000/minio/health/live`.
3. Check firewall rules if the Collector runs on a separate host.

### Slow requests with no obvious cause

**Cause**: A slow drive or storage-bound saturation is dragging the
cluster.

**Look at**: the Diagnostic and per-drive series -
`minio_system_drive_api_latency_micros` (a slow drive localizes a slow
cluster), `minio_system_drive_perc_util` / `minio_system_drive_writes_await`,
and `minio_system_cpu_avg_iowait` for storage-bound CPU.

**Fix**:

1. Correlate the slow drive's latency with
   `minio_api_requests_ttfb_seconds_distribution`.
2. Replace or rebalance the drive if its utilization stays pinned.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with MinIO running in Kubernetes?**

Yes. Set `targets` to the MinIO service DNS (for example
`minio.minio.svc.cluster.local:9000`). For token-gated metrics, store the
bearer token in a Kubernetes secret and reference it as the scrape
`credentials`; or set `MINIO_PROMETHEUS_AUTH_TYPE=public` on the
StatefulSet for tokenless metrics. The Collector can run as a sidecar or a
Deployment.

**How do I monitor a distributed MinIO cluster?**

Scrape each MinIO node - add every node's `:9000` to the scrape targets.
The capacity, erasure-set, and per-drive series expand in a distributed
deployment: `minio_system_drive_*` produces one series per drive and
`minio_cluster_erasure_set_*` one series per set, so you see per-drive and
per-set health rather than a single `1`.

**Should I use the v2 or v3 metrics endpoint?**

Use v3 (`/minio/metrics/v3`). The `/minio/v2/metrics/{cluster,node,bucket}`
endpoints are deprecated - still present in the release, but not for new
deployments.

**Do I need a bearer token, or can I scrape without auth?**

Metrics are token-gated by default. Set `MINIO_PROMETHEUS_AUTH_TYPE=public`
for tokenless scraping (handy on internal networks), or generate a token
with `mc admin prometheus generate` and supply it as the scrape
`authorization` credentials.

**Where are per-bucket and replication metrics?**

They are not on the default v3 endpoint. Per-bucket, replication,
notification, ILM, and resource detail live at dedicated v3 sub-paths (for
example `/minio/metrics/v3/bucket/api` and `/minio/metrics/v3/replication`).
Add a scrape job per sub-path - and configure the corresponding feature -
when you need that detail.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on MinIO metrics.
- [PostgreSQL Monitoring](./postgres.md) - A common backing store alongside
  object storage.
- [Redis Monitoring](./redis.md) - A common cache in the same data tier.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Scope the scrape with `metric_relabel_configs`
  keep filters, and add a scrape job per `/minio/metrics/v3` sub-path
  (bucket, replication, internode) when you need that detail.
