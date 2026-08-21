---
title: >
  Temporal OpenTelemetry Monitoring - Persistence Latency, Task Queues,
  and Collector Setup
sidebar_label: Temporal
id: collecting-temporal-telemetry
sidebar_position: 20
description: >
  Collect Temporal metrics with the OpenTelemetry Collector. Monitor frontend
  service latency, persistence (database) latency, and task-queue backlog via
  the Prometheus receiver, and ship to base14 Scout.
keywords:
  - temporal opentelemetry
  - temporal otel collector
  - temporal metrics monitoring
  - temporal performance monitoring
  - opentelemetry prometheus receiver temporal
  - temporal observability
  - temporal workflow monitoring
  - temporal telemetry collection
---

# Temporal

Temporal exposes Prometheus text on `:8000` when the `PROMETHEUS_ENDPOINT`
environment variable is set. The OpenTelemetry Collector's `prometheus`
receiver scrapes that endpoint, collecting 150+ metrics from Temporal 1.20+
across frontend service requests and latency, persistence (database) latency,
task-queue backlog, task processing, history shards, the mutable-state cache,
and the Go runtime. This guide configures the receiver and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended    |
| ---------------------- | ------- | -------------- |
| Temporal Server        | 1.20    | 1.24+ (1.27.0) |
| OTel Collector Contrib | 0.90.0  | 0.153.0        |
| base14 Scout           | Any     | -              |

Before starting:

- Temporal Server requires PostgreSQL as its persistence backend - the
  `auto-setup` Docker image does not support SQLite.
- Temporal must be started with `PROMETHEUS_ENDPOINT=0.0.0.0:8000` to expose
  metrics; the endpoint is not enabled by default.
- The metrics port (`8000`) must be reachable from the host running the
  Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

A few things shape this surface, and they matter for every tier below:

- **`up` is the liveness signal here.** Temporal has a real `up` series: the
  `prometheus` receiver emits `up` = 1 when `/metrics` responds. `restarts`
  counts process restarts and `build_information` carries the version labels.
- **One endpoint, four roles.** In the single-binary (`auto-setup`)
  distribution the frontend, history, matching, and worker roles share one
  `/metrics`, and metrics carry an `operation` label that names the RPC or task
  type. A production deployment runs each role as a separate process with its
  own `:8000` endpoint - the metric names are identical, so the same scrape
  config applies per role (see the four-job example in
  [Configuration](#configuration)).
- **Persistence is a primary signal to watch.** Temporal depends heavily on its
  persistence store, so `persistence_latency`, `persistence_requests` (keyed by
  `operation`), and `persistence_error_with_type` are a leading indicator of
  store and connection health - a slow store backs up task processing.
- **Task-queue backlog is the worker-health signal.**
  `approximate_backlog_count` and `approximate_backlog_age_seconds` (per task
  queue) say whether workers are keeping up; a rising backlog means tasks are
  produced faster than they are polled.
- **Latency metrics are histograms.** `service_latency`, `persistence_latency`,
  the `task_latency*` family, `cache_latency`, and the `*_lock_latency` family
  expand into `_bucket` / `_sum` / `_count` in Prometheus form; the receiver
  represents each as one OTel histogram.
- **Two naming domains.** Unprefixed names (`service_*`, `persistence_*`,
  `task_*`, `cache_*`, `history_*`, and the shard / queue families) are the
  **server** metrics. The `temporal_*` names (`temporal_request*`,
  `temporal_long_request*`, `temporal_worker_*`, `temporal_num_pollers`) are the
  **SDK client** metrics from Temporal's internal system worker - the same names
  a user-written worker emits.
- **`tally_internal_*` is the Tally metrics library's own bookkeeping** (scope
  and cardinality counts), and `memory_*` / `num_goroutines` / `gomaxprocs` are
  the Go runtime - filter these with a keep rule if the runtime is covered
  elsewhere.

### Core - is it up, serving RPCs, and is the database healthy

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 = the Temporal metrics endpoint responded. The liveness signal on this surface. |
| `service_requests` | Frontend RPCs handled, keyed by `operation` - headline request throughput. |
| `service_latency` | Frontend RPC latency by `operation` - the API SLO (histogram). |
| `service_error_with_type` | Frontend RPC errors by `operation` and error type. |
| `persistence_requests` | Persistence (database) operations by `operation` - backend throughput. |
| `persistence_latency` | Persistence operation latency - a leading indicator of store and connection health; a slow store backs up task processing (histogram). |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Frontend saturation | `service_pending_requests`, `service_latency_nouserlatency`, `service_authorization_latency` | RPCs queued but not yet handled; server-side latency with user-blocked time excluded; authorization-check latency. |
| Persistence health | `persistence_error_with_type`, `persistence_shard_rps`, `persistence_session_refresh_attempts` | Database errors by type; per-shard request rate (hot-spotting); session-refresh attempts (connection churn). |
| Visibility store | `visibility_persistence_requests`, `visibility_persistence_latency` | Visibility-store request rate and latency - drives the list / search API. |
| Inter-service calls | `client_requests`, `client_latency`, `client_errors`, `client_redirection_errors` | History / matching client call rate, latency, errors, and cross-node redirection failures. |
| Task processing | `task_requests`, `task_latency`, `task_latency_processing`, `task_latency_queue`, `task_attempt`, `task_lag_per_tl`, `pending_tasks`, `queue_actions` | Task operations and end-to-end latency, broken into processing / queue-wait phases; retries; per-task-list lag; pending tasks. |
| Task-queue backlog | `approximate_backlog_count`, `approximate_backlog_age_seconds`, `poll_latency`, `poll_timeouts` | Headline "are workers keeping up" backlog and oldest-task age; poll latency; long-poll timeouts. |
| Shards | `acquire_shards_latency`, `acquire_shards_count`, `get_engine_for_shard_latency`, `sharditem_acquisition_latency`, `numshards_gauge` | Time and count to acquire history shards; engine / item acquisition latency; shards owned by this host. |
| Cluster health | `membership_changed_count`, `lock_latency`, `semaphore_latency` | Cluster membership churn (node flapping); internal lock / semaphore wait time (contention). |
| Mutable-state cache | `cache_requests`, `cache_latency`, `cache_miss` | History mutable-state cache request rate, latency, and misses - a miss forces a persistence read. |
| Workflow history | `history_size`, `history_count`, `state_transition_count` | Workflow history size in bytes and event count (large histories slow replay); workflow state transitions. |
| Replication | `replication_tasks_lag` | Multi-cluster replication lag - how far a replica is behind. |
| SDK worker | `temporal_worker_task_slots_available`, `temporal_worker_task_slots_used`, `temporal_num_pollers` | SDK worker task-slot capacity / usage and pollers running - a worker pinned at full slots is the bottleneck. |
| Runtime | `host_rps_limit`, `memory_heapinuse`, `memory_allocated`, `memory_gc_pause_ms`, `num_goroutines` | Per-host RPS limit; Go heap in use / allocated; GC pause time; goroutine count (a runaway count signals a leak). |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Mutable-state component sizes | `mutable_state_size`, `execution_info_size`, `execution_state_size`, `memo_size`, `event_blob_size` | Drill into large / slow workflows by component size. |
| Per-workflow counts and sizes | `activity_info_count` / `_size`, `timer_info_*`, `child_info_*`, `signal_info_*`, `buffered_events_*` | Pending activity, timer, child-workflow, signal, and buffered-event counts and sizes. Advance only as workflows accumulate those components. |
| Cumulative workflow counts | `total_activity_count`, `total_child_execution_count`, `total_signal_count`, `total_user_timer_count` | Cumulative per-workflow activity, child, signal, and timer counts. |
| Deadlock-detector locks | `dd_shard_lock_latency`, `dd_namespace_registry_lock_latency`, `dd_shard_io_semaphore_latency` (and the rest of the `dd_*` family) | Lock / IO-semaphore wait times on internal structures. |
| Task-queue internals | `loaded_task_queue_count`, `loaded_task_queue_partition_count`, `forwarded`, `forwarded_per_tl` | Loaded / force-loaded queue and partition counts; tasks forwarded between matching partitions. |
| History task-processor | `task_count`, `task_batch_complete_counter`, `ack_level_update`, `queue_reader_count`, `queue_slice_count` | Batch, ack-level, and queue-reader internals behind a processing stall. |
| Cache sizing | `cache_size`, `cache_usage`, `cache_pinned_usage`, `cache_ttl`, `history_workflow_execution_cache_lock_hold_duration` | Mutable-state cache size, usage, pinned usage, TTL, and lock-hold time. |
| Shard-info internals | `sharditem_created_count`, `time_between_shardinfo_update`, `new_timer_notifications`, `workflow_context_cleared` | Shard-info update cadence, timer notifications, and history-engine internals. |
| Replication cleanup | `replication_task_cleanup_count`, `lease_requests` | Replication-task cleanup and shard-lease request counts (multi-cluster only). |
| SDK client detail | `temporal_request`, `temporal_request_latency`, `temporal_long_request`, `temporal_poller_start`, `temporal_activity_poll_no_task` | SDK client request / long-poll count, attempts, and latency; poller and empty-poll counters. |
| Library and runtime | `tally_internal_counter_cardinality`, `memory_heap`, `memory_num_gc`, `gomaxprocs` | Tally's own cardinality / scope bookkeeping and additional Go-runtime heap / GC / scheduler detail. |
| Version and scrape meta | `build_information`, `build_age`, `version_check_latency`, `action`, `restarts`, `scrape_duration_seconds`, `scrape_samples_scraped` | Build labels and age, version-check result and timing, billable action count, process restarts, and receiver-side scrape meta. |

Full metric list: run `curl -s http://localhost:8000/metrics` against your
Temporal instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. `up == 0`
and the error counters read as states; the rest compare against your own
baseline, since latencies and backlog are workload-dependent. These are
starting points - tune them to your workload.

| Alert | Condition | Why it matters |
|---|---|---|
| Temporal unreachable | `up == 0` for > 1m | The metrics endpoint stopped responding - check the server process and port 8000. |
| Persistence latency high | `persistence_latency` p99 rising vs baseline | The store is slow - check the database, connections, and shard RPS. |
| Persistence errors | `rate(persistence_error_with_type)` > 0 | Database operations are failing - check connectivity and the backing store. |
| Frontend errors rising | `rate(service_error_with_type)` > 0 vs baseline | RPCs are failing - inspect the error-type label and correlate with persistence. |
| Frontend latency high | `service_latency` p99 rising vs baseline | RPCs are slow - compare with `service_latency_nouserlatency` to separate server from downstream. |
| Task-queue backlog growing | `approximate_backlog_count` rising, or `approximate_backlog_age_seconds` climbing | Workers are not keeping up - scale workers or investigate slow task execution. |
| Task processing slow | `task_latency` p99 rising, or `task_latency_queue` rising | Tasks are slow or queued - localize via the task-latency phase breakdown. |
| Shard acquisition slow | `acquire_shards_latency` p99 rising | History shards are slow to load - parts of the cluster may be unavailable; check the history service and store. |
| Membership churn | `rate(membership_changed_count)` > 0 sustained | Nodes are joining / leaving repeatedly - investigate node health and the membership backend. |
| Cache miss rate high | `cache_miss / cache_requests` rising vs baseline | The mutable-state cache is thrashing - more reads hit persistence; check cache sizing and load. |
| Replication lag | `replication_tasks_lag` rising vs baseline | A replica cluster is falling behind - check cross-cluster connectivity and the replication queue. |

## Access Setup

Temporal does not expose Prometheus metrics by default. Enable the endpoint by
setting `PROMETHEUS_ENDPOINT` on the server, and provide a PostgreSQL
persistence backend (the `auto-setup` image does not support SQLite).

```bash showLineNumbers title="Enable the metrics endpoint"
# Set on the Temporal server (Docker / Docker Compose env)
PROMETHEUS_ENDPOINT=0.0.0.0:8000
```

Bind to `0.0.0.0`, not `127.0.0.1`, so the Collector can reach the endpoint
from another container or host. Make sure port `8000` is reachable from the
host running the Collector (in Docker, map or expose it on the Temporal
service).

Verify the endpoint is serving metrics:

```bash showLineNumbers title="Verify access"
curl -s http://localhost:8000/metrics | head -20
```

For Kubernetes, set `PROMETHEUS_ENDPOINT` on each Temporal pod's container env
and expose port `8000` on the service.

## Configuration

The `prometheus` receiver scrapes Temporal's `/metrics` on `:8000`. A
single-binary (`auto-setup`) deployment serves all four roles on one endpoint,
so one scrape job covers it:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:TEMPORAL_HOST}:8000

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

The server must be started with `PROMETHEUS_ENDPOINT=0.0.0.0:8000` for this
scrape to return anything (see [Access Setup](#access-setup)).

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy `deployment.environment`
> is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
TEMPORAL_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Production: one scrape job per role

A production deployment runs the frontend, history, matching, and worker roles
as separate processes, each exposing the same metric names on its own `:8000`.
Add one scrape job per role:

```yaml showLineNumbers title="config/otel-collector.yaml (per-role)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal-frontend
          scrape_interval: 10s
          static_configs:
            - targets: [temporal-frontend:8000]
        - job_name: temporal-history
          scrape_interval: 10s
          static_configs:
            - targets: [temporal-history:8000]
        - job_name: temporal-matching
          scrape_interval: 10s
          static_configs:
            - targets: [temporal-matching:8000]
        - job_name: temporal-worker
          scrape_interval: 10s
          static_configs:
            - targets: [temporal-worker:8000]
```

### Scoping collection to the product metrics

Temporal exposes 150+ metrics, including the Go-runtime `memory_*` /
`num_goroutines` and the `tally_internal_*` library-bookkeeping families. To
keep collection focused on the Temporal product metrics, scope it with a keep
rule:

```yaml showLineNumbers title="config/otel-collector.yaml (keep filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:TEMPORAL_HOST}:8000
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "service_.*|persistence_.*|task_.*|approximate_backlog_.*|cache_.*|history_.*|.*shard.*|membership_.*|replication_.*|up"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Temporal metrics
docker logs otel-collector 2>&1 | grep -i "temporal"

# Verify Temporal is serving the frontend request series
curl -s http://localhost:8000/metrics | grep service_requests

# Check persistence latency is present
curl -s http://localhost:8000/metrics | grep persistence_latency
```

## Troubleshooting

### Metrics endpoint returns empty or connection refused

**Cause**: `PROMETHEUS_ENDPOINT` is not set on the Temporal server.

**Fix**:

1. Set `PROMETHEUS_ENDPOINT=0.0.0.0:8000` in the Temporal server environment.
2. Restart the Temporal server.
3. Verify: `curl http://localhost:8000/metrics`.

### Connection refused on port 8000

**Cause**: The Collector cannot reach Temporal at the configured endpoint.

**Fix**:

1. Confirm `PROMETHEUS_ENDPOINT` binds `0.0.0.0:8000`, not `127.0.0.1:8000`,
   so it is reachable from the Collector's network.
2. Verify the port is exposed if running in Docker: `ports: ["8000:8000"]`.
3. Test from the Collector's network:
   `docker exec otel-collector wget -qO- http://temporal:8000/metrics`.

### Workflow and task-outcome metrics read idle values

**Cause**: The task-execution and workflow families need real workflows
running - an SDK worker polling a task queue.

**Look at**: `approximate_backlog_count`, `temporal_worker_task_slots_used`,
and the `task_latency_*` phases - they populate fully only once a worker polls
a task queue and executes workflows. Until then they read idle values, which is
expected and not a fault.

**Fix**:

1. Run an SDK worker against the cluster and execute a workflow.
2. Re-check the task and backlog series; they advance as work flows.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Does this work with Temporal running in Kubernetes?

Yes. Set `targets` to the Temporal service DNS endpoint per role (e.g.,
`temporal-frontend.temporal.svc.cluster.local:8000`), and set
`PROMETHEUS_ENDPOINT` on each Temporal pod's container env. The Collector can
run as a sidecar or DaemonSet.

### Single-binary or microservices deployment: what is the difference?

The `auto-setup` image runs all four roles - frontend, history, matching, and
worker - in one process behind a single `/metrics`, with an `operation` label
on the metrics. A production deployment splits the roles across processes, each
with its own `:8000`. The metric names are identical, so you add one scrape job
per role (see [Configuration](#configuration)).

### Why does persistence matter so much?

Temporal depends heavily on its persistence store. Every workflow state change,
task, and history event is a persistence operation, so a slow store backs up
task processing and RPC latency. That makes `persistence_latency`,
`persistence_requests`, and `persistence_error_with_type` among the first
signals to check during a Temporal incident.

### What is the difference between the `temporal_*` and the unprefixed metrics?

Unprefixed names (`service_*`, `persistence_*`, `task_*`, `cache_*`,
`history_*`, and the shard / queue families) are the **server** metrics. The
`temporal_*` names are the **SDK client** metrics from Temporal's internal
system worker - the same names a user-written worker emits.

### Why are some metrics idle or zero?

The workflow-completion, activity-execution, and task-outcome families need real
workflows running - an SDK worker polling a task queue. Without one, they read
idle values, which is expected. The `replication_*` families are meaningful only
in a multi-cluster (replication) deployment.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Temporal metrics.
- [PostgreSQL Monitoring](./postgres.md) -
  Watch the database that bounds Temporal's throughput.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), Temporal's persistence backend, and other
  components.
- **Fine-tune Collection**: The keep rule scopes collection to the Temporal
  product metrics and drops the Go-runtime and `tally_internal_*` noise
  families; remove it when you need that runtime detail during an incident.
