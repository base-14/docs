---
title: >
  InfluxDB OpenTelemetry Monitoring - Write Throughput, Query Latency,
  and Series Cardinality
sidebar_label: InfluxDB
id: collecting-influxdb-telemetry
sidebar_position: 40
description: >
  Scrape InfluxDB 2.x metrics with the OpenTelemetry Collector's Prometheus
  receiver. Monitor write throughput, query latency, TSM storage, and series
  cardinality, and ship to base14 Scout.
keywords:
  - influxdb opentelemetry
  - influxdb otel collector
  - influxdb metrics monitoring
  - influxdb performance monitoring
  - opentelemetry prometheus receiver influxdb
  - influxdb observability
  - influxdb series cardinality monitoring
  - influxdb telemetry collection
---

# InfluxDB

InfluxDB serves Prometheus text at `/metrics` on the API port `8086`. In
InfluxDB 2.x this endpoint is public - no token, unlike the token-gated
`/api/v2/*` data API. The OpenTelemetry Collector's `prometheus` receiver
scrapes it directly, collecting 100+ metrics across HTTP API throughput and
latency, the TSM storage engine (write path, cache, WAL, compaction), per-bucket
series cardinality, and the Flux query controller. This guide configures the
receiver and ships metrics to base14 Scout.

:::note
The Collector's `influxdbreceiver` is for **receiving** InfluxDB line-protocol
writes (push model) - it acts as an InfluxDB-compatible write endpoint, not a
health scraper. To monitor InfluxDB itself, use the `prometheus` receiver as
shown here.
:::

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| InfluxDB               | 2.0     | 2.7+        |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- InfluxDB's HTTP API port (`8086`) must be reachable from the host running
  the Collector.
- InfluxDB initial setup must be complete (org, bucket, admin user).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. Every row traces to InfluxDB's native Prometheus exposition.

A few surface notes set the context for everything below:

- **`up` is the liveness signal here.** The `prometheus` receiver emits `up`
  = 1 when `/metrics` responds, so that is what tells you InfluxDB is reachable.
  `influxdb_uptime_seconds` is the in-band process uptime - a reset means a
  restart.
- **`/metrics` is public in InfluxDB 2.x.** No token is needed for the metrics
  endpoint; only the data API is token-gated. This metric surface is
  2.x-specific - InfluxDB 1.x and 3.x (Core / Enterprise) expose different
  metric sets.
- **The TSM storage engine is the durability core.** Writes land in the
  write-ahead log (`storage_wal_*`) and an in-memory cache (`storage_cache_*`),
  snapshot to TSM files (`storage_tsm_files_*`), then compact
  (`storage_compactions_queued`). Watch cache bytes (memory), WAL (disk), and
  the compaction backlog - a growing backlog means compaction cannot keep up.
- **Series cardinality is the classic failure mode.**
  `storage_bucket_series_num` is the per-bucket series count; runaway growth
  blows up memory and is the most common InfluxDB incident.
- **`qc_*` is the Flux query controller.** A query flows through queueing →
  compiling → executing, each with an `_active` gauge and a `_duration_seconds`
  histogram, so a slow read localizes to queue saturation vs compile vs
  execution.
- **The storage-engine and query-controller families warm up under traffic.**
  `storage_cache_*`, `storage_wal_*`, `storage_compactions_*`,
  `storage_shard_*`, `storage_tsm_files_*`, and the `qc_*` family populate only
  after writes / queries / compactions occur - a fresh idle server shows mostly
  `http_*` / `influxdb_*` / `go_*`. Left enabled, they populate as traffic
  arrives.

Histograms (`http_api_request_duration_seconds`, the `qc_*_duration_seconds`
family) expand into `_bucket` / `_sum` / `_count`; the tables reference the base
name.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 means the InfluxDB metrics endpoint responded. The liveness signal on this surface. |
| `http_api_requests_total` | HTTP API requests handled, labeled by path / method / status - headline throughput; writes and queries both arrive here. |
| `storage_writer_ok_points` | Points written successfully - ingest throughput, the headline write signal for a TSDB. |
| `storage_writer_err_points` | Points that failed to write - ingest errors. |
| `qc_executing_duration_seconds` | Query execution latency - the read-path SLO. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| API latency and volume | `http_api_request_duration_seconds`, `http_write_request_count`, `http_query_request_count`, `http_write_request_bytes`, `http_query_response_bytes` | Per-path latency distribution and write / query request volume and bytes. |
| Write path | `storage_writer_req_points`, `storage_writer_dropped_points`, `storage_writer_timeouts` | Points requested (the ok/err/dropped denominator), points dropped on schema / field-type conflicts, and write timeouts. |
| Cache (memory) | `storage_cache_inuse_bytes`, `storage_cache_disk_bytes`, `storage_cache_writes_total`, `storage_cache_writes_err`, `storage_cache_writes_dropped` | In-memory write-cache pressure that must snapshot to TSM, plus cache write errors and drops. |
| WAL (disk) | `storage_wal_size`, `storage_wal_writes`, `storage_wal_writes_err` | Write-ahead-log size on disk (the durability buffer) and WAL write errors - a disk durability problem. |
| Compaction and TSM | `storage_compactions_queued`, `storage_tsm_files_disk_bytes`, `storage_tsm_files_total` | Queued TSM compactions (a growing backlog means compaction cannot keep up), on-disk TSM bytes, and TSM file count. |
| Per-shard writes | `storage_shard_write_count`, `storage_shard_write_err_count`, `storage_shard_write_dropped_sum` | Per-shard write operations, errors, and drops. |
| Cardinality | `storage_bucket_series_num` | Per-bucket series count - the cardinality signal; runaway growth blows up memory. |
| Retention | `storage_retention_check_duration` | Retention-enforcement run duration. |
| Query controller | `qc_requests_total`, `qc_queueing_duration_seconds`, `qc_queueing_active`, `qc_compiling_duration_seconds`, `qc_all_duration_seconds`, `qc_all_active`, `qc_executing_active`, `qc_memory_unused_bytes` | Flux queries received, time queued (controller saturation), compile time, total per-query time, in-flight / executing counts, and query-controller memory headroom (low values throttle queries). |
| Uptime and tasks | `influxdb_uptime_seconds`, `task_scheduler_total_schedule_fails`, `task_scheduler_total_execute_failure`, `task_executor_workers_busy`, `task_executor_total_runs_active` | Process uptime (a reset is a restart) and task scheduling / execution failures plus task-executor load (downsampling / alerting tasks). |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Per-shard detail | `storage_shard_write_sum`, `storage_shard_write_err_sum`, `storage_shard_disk_size`, `storage_shard_series`, `storage_shard_fields_created`, `storage_cache_latest_snapshot` | Per-shard write volume, errors, on-disk size, series, fields, and the last cache-snapshot timestamp. |
| Storage-read latency | `query_influxdb_source_read_request_duration_seconds` | The storage-read latency behind a Flux query. |
| Compile internals | `qc_compiling_active` | Queries currently compiling. |
| Metadata store | `boltdb_reads_total`, `boltdb_writes_total` | BoltDB metadata key-value store reads and writes. |
| Resource inventory | `influxdb_buckets_total`, `influxdb_organizations_total`, `influxdb_users_total`, `influxdb_tokens_total`, `influxdb_dashboards_total`, `storage_bucket_measurement_num`, `influxdb_info` | Bucket / org / user / token / dashboard counts, per-bucket measurement count, and build / version labels. |
| Control-plane calls | `service_bucket_new_call_total`, `service_org_new_duration`, `service_user_new_call_total` | Bucket / org / user create-call count and latency. |
| Task-engine internals | `task_scheduler_current_execution`, `task_scheduler_schedule_delay`, `task_scheduler_total_execution_calls`, `task_executor_promise_queue_usage` | Task-scheduler timing and task-executor promise-queue fill. |
| Runtime and scrape meta | `go_*`, `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | InfluxDB's own Go runtime and the receiver-side Prometheus scrape meta. |

Filter `go_*` and the scrape meta in production with the keep rule shown in
[Configuration](#configuration). Full metric list: run
`curl -s http://localhost:8086/metrics` against your InfluxDB instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series. The
error and WAL-error counters and `up` read as states; the rest are relative to
your own baseline. These are starting points - tune them to your workload.

| Alert | Threshold | Why it matters |
|---|---|---|
| InfluxDB unreachable | `up` == 0 for > 1m | The metrics endpoint stopped responding - check the process and the API port. |
| Write errors rising | `rate(storage_writer_err_points)` > 0 or `rate(storage_writer_dropped_points)` > 0 | Points are failing to write - check field-type / schema conflicts and disk health. |
| Compaction backlog growing | `storage_compactions_queued` rising vs baseline | Compaction cannot keep up with ingest - disk or CPU bound; write and query latency will degrade. |
| Cardinality explosion | `storage_bucket_series_num` rising sharply vs baseline | Runaway series cardinality - find the offending tag and stop writing it; memory is at risk. |
| WAL write errors | `rate(storage_wal_writes_err)` > 0 | The durability path is failing - check the disk. |
| Query latency high | `qc_executing_duration_seconds` p99 rising, or `qc_queueing_duration_seconds` rising | Queries are slow or queued - the controller is saturated or a query is expensive. |
| API latency high | `http_api_request_duration_seconds` p99 rising vs baseline | API requests are slow - correlate with the write / query path and disk. |
| Task failures | `rate(task_scheduler_total_execute_failure)` > 0 | Downsampling / alerting tasks are failing - check task logs and the Flux scripts. |

## Access Setup

InfluxDB 2.x exposes Prometheus metrics natively at `/metrics` on the API port
`8086` - no exporter, no configuration change, and no token. This endpoint is
public, distinct from the token-gated `/api/v2/*` data API, so the Collector
scrapes it without credentials.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check InfluxDB is running
curl -s http://localhost:8086/health

# Verify the Prometheus metrics endpoint (no token required in 2.x)
curl -s http://localhost:8086/metrics | head -20
```

InfluxDB 1.x and 3.x (Core / Enterprise) expose the metrics endpoint
differently and emit different metric sets; this guide targets the 2.x surface.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: influxdb
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:INFLUXDB_HOST}:8086   # default /metrics path, public in 2.x
          metric_relabel_configs:
            # Scope to the InfluxDB families; drop the go_* runtime and scrape noise
            - source_labels: [__name__]
              regex: 'influxdb_.*|storage_.*|http_.*|qc_.*|query_.*|boltdb_.*|task_.*|service_.*|up'
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

The `/metrics` endpoint is public in 2.x, so the scrape job needs no auth block.
The `metric_relabel_configs` keep filter scopes collection to the InfluxDB
product families and drops the `go_*` runtime series and Prometheus scrape meta.
Keep it during normal operation; widen the regex if you want the `go_*` runtime
during a deep investigation.

### Environment Variables

```bash showLineNumbers title=".env"
INFLUXDB_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (introduced in semantic conventions v1.27.0, stable as of v1.41.0).
> The legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped InfluxDB metrics
docker logs otel-collector 2>&1 | grep -i "influxdb"

# Verify InfluxDB is healthy
curl -s http://localhost:8086/health

# Confirm the metrics endpoint is serving the product families
curl -s http://localhost:8086/metrics | grep -E 'storage_writer_ok_points|http_api_requests_total'
```

The storage-engine (`storage_cache_*`, `storage_wal_*`, `storage_tsm_files_*`)
and `qc_*` query-controller families appear only after writes and queries flow.
Send a point and run a query, then re-check, if they are missing on a fresh
server.

## Troubleshooting

### Connection refused on port 8086

**Cause**: The Collector cannot reach InfluxDB at the configured address.

**Fix**:

1. Verify InfluxDB is running: `docker ps | grep influxdb` or
   `systemctl status influxd`.
2. Confirm the HTTP bind address in the InfluxDB config and that `8086` is the
   API port.
3. Check firewall rules if the Collector runs on a separate host.

### Storage-engine or query-controller metrics are missing

**Cause**: The `storage_cache_*`, `storage_wal_*`, `storage_compactions_*`,
`storage_shard_*`, `storage_tsm_files_*`, and `qc_*` families populate only
after writes, queries, and compactions occur. On an idle server this is
expected - the endpoint shows mostly `http_*` / `influxdb_*` / `go_*`.

**Look at**: `storage_writer_ok_points` and `qc_requests_total` - if these are
flat, no write or query traffic has reached InfluxDB yet.

**Fix**:

1. Write a line-protocol point to a bucket and run a Flux query.
2. Re-scrape; the storage and query-controller families populate under traffic.

### Series cardinality is growing

**Cause**: A high-cardinality tag (for example a unique ID or timestamp written
as a tag) is multiplying series.

**Look at**: `storage_bucket_series_num` per bucket - a sharp rise points to the
offending bucket; `storage_bucket_measurement_num` narrows it to a measurement.

**Fix**:

1. Identify the tag with unbounded values in the high-cardinality bucket.
2. Stop writing that value as a tag (move it to a field, or drop it).
3. Series cardinality drives InfluxDB memory; runaway growth is the most common
   incident.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with InfluxDB running in Kubernetes?**

Yes. Set `targets` to the InfluxDB service DNS endpoint (for example
`influxdb.default.svc.cluster.local:8086`). The `/metrics` endpoint is public in
2.x, so no token is needed. The Collector can run as a sidecar or DaemonSet.

**Does this work with InfluxDB 1.x or 3.x?**

This guide targets InfluxDB 2.x. The `prometheus` receiver will scrape a 1.x or
3.x (Core / Enterprise) endpoint, but those versions expose different metric
sets - the names here (`storage_*`, `qc_*`, `http_api_*`) are 2.x-specific.
Expect different families on 1.x and 3.x.

**Why are the storage metrics reading zero?**

The TSM storage-engine families (`storage_cache_*`, `storage_wal_*`,
`storage_tsm_files_*`, `storage_compactions_*`) and the `qc_*` query-controller
families warm up under traffic - they populate only after writes, queries, and
compactions occur. A fresh idle server shows mostly `http_*` / `influxdb_*` /
`go_*`. Send a write and a query and re-scrape.

**How do I track and stop runaway series cardinality?**

Watch `storage_bucket_series_num`, the per-bucket series count. A sharp rise
signals a high-cardinality tag; find the tag with unbounded values and stop
writing it as a tag. Cardinality drives InfluxDB memory, so this is the metric
to alert on early.

**What about the OTel InfluxDB receiver?**

The `influxdbreceiver` in the Collector Contrib receives InfluxDB line-protocol
writes - it acts as an InfluxDB-compatible write endpoint, not a metrics
scraper. To monitor InfluxDB itself, use the `prometheus` receiver as shown
here.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on InfluxDB metrics.
- [PostgreSQL Monitoring](./postgres.md) - Relational database monitoring.
- [MySQL Monitoring](./mysql.md) - Relational database monitoring.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md) and other data infrastructure.
- **Fine-tune Collection**: Keep the `metric_relabel_configs` keep filter in
  production to drop the `go_*` runtime and scrape noise; widen the regex when you
  want the Go runtime series during a deep investigation.
