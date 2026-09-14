---
title: >
  Ray OpenTelemetry Monitoring - Task State, Cluster Resources,
  and Collector Setup
sidebar_label: Ray
id: collecting-ray-telemetry
sidebar_position: 60
description: >
  Collect Ray cluster metrics with the OpenTelemetry Collector. Monitor task
  and actor state, cluster resources, object store spilling, and ship to
  base14 Scout.
keywords:
  - ray opentelemetry
  - ray otel collector
  - ray metrics monitoring
  - ray cluster monitoring
  - opentelemetry prometheus receiver ray
  - ray observability
  - ray object store monitoring
  - distributed compute monitoring
  - ray telemetry collection
---

# Ray

Ray's head node serves Prometheus text on the port passed to
`--metrics-export-port`; the OpenTelemetry Collector's Prometheus receiver
scrapes it, collecting 116 metric names covering task and actor state,
cluster resources, per-node CPU, memory and disk, the object store and its
spilling path, scheduler placement, and Ray's internal control plane. The
metrics port is **opt-in and has no default** - without
`--metrics-export-port` there is no endpoint at all, and you choose the
port. This guide starts the head node with the port open, configures the
receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Ray                    | 2.53    | 2.58        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Ray states no minimum version for the metrics themselves. 2.53 is the
meaningful floor: it is the release that introduced
`RAY_metric_cardinality_level` and changed its default, so below it every
series carries a real `WorkerId` with no way to limit the fan-out.

Before starting:

- The head node must be started with `--metrics-export-port <port>`. The
  endpoint is opt-in and has no default port - without the flag nothing is
  served, and the Collector must scrape the same port you chose.
- That port must be reachable from the host running the Collector.
- The endpoint has no authentication. Scrape it on the internal network and
  do not expose it publicly.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Upgrading?
Ray 2.53 introduced `RAY_metric_cardinality_level` and defaults it to
`recommended`, which stops exporting the real worker ID on `ray_tasks` and
`ray_actors`. Dashboards and alerts that group either family by `WorkerId`
stop resolving. Full notes: [Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

### Core - is the cluster there and is work moving

| Metric | What it tells you |
|---|---|
| `up` | Prometheus scrape liveness - 1 means the Ray metrics port responded. |
| `ray_cluster_active_nodes` | Alive nodes by `node_type`. Node loss shows here first. |
| `ray_tasks` | Current task count per `State`, including `FAILED`. The headline workload signal. |
| `ray_resources` | Logical cluster resources per `Name` (`CPU`, `memory`, `object_store_memory`) split by `State` (`AVAILABLE`, `USED`). Whether the cluster has room to run work. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Actors and jobs | `ray_actors`, `ray_running_jobs`, `ray_finished_jobs_total`, `ray_job_duration_s` | Current actor count per `State`, jobs running and finished, and job duration in seconds. |
| Scheduling | `ray_scheduler_tasks`, `ray_scheduler_unscheduleable_tasks`, `ray_internal_num_infeasible_scheduling_classes`, `ray_scheduler_failed_worker_startup_total` | Tasks known to the scheduler per state; work it cannot place; scheduling classes the current cluster shape can never satisfy; worker processes that failed to start. |
| Node CPU and memory | `ray_node_cpu_utilization`, `ray_node_cpu_count`, `ray_node_mem_used`, `ray_node_mem_total`, `ray_node_mem_available` | Per-node CPU percentage and count, and per-node memory. Memory pressure precedes worker kills. |
| Node disk | `ray_node_disk_usage`, `ray_node_disk_free` | Per-node disk. Object spilling consumes it. |
| Object store | `ray_object_store_used_memory`, `ray_object_store_available_memory`, `ray_object_store_fallback_memory`, `ray_object_store_num_local_objects` | Bytes in use and free (the fill ratio), bytes served from fallback allocation, and objects held locally. Non-zero fallback means the store is over its shared-memory budget. |
| Spilling | `ray_spill_manager_objects_bytes`, `ray_spill_manager_objects`, `ray_spill_manager_request_total`, `ray_internal_num_spilled_tasks` | Bytes and objects spilled to disk, spill and restore requests, and tasks spilled to another node. Spilling is the object store's back-pressure. |
| Task events | `ray_gcs_task_manager_task_events_dropped` | Task events the GCS dropped. Non-zero means the dashboard and state API are showing an incomplete picture. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review.

| Group | Metrics | When you reach for it |
|---|---|---|
| Internal gRPC | `ray_grpc_server_req_process_time_ms` and the `ray_grpc_server_req_*_total` counters | Internal gRPC handling latency and request counts by `Method`. The single largest series producer. |
| GCS storage and state | `ray_gcs_storage_operation_latency_ms`, `ray_gcs_storage_operation_count_total`, `ray_gcs_actors_count`, `ray_gcs_placement_group_count` | GCS storage operations by `Operation`, and the GCS view of actors and placement groups by state. |
| Task event pipeline | `ray_gcs_task_manager_task_events_reported`, `_stored` | Throughput of the task event pipeline; the denominators for the drop rate. |
| Operation queues | `ray_operation_queue_time_ms`, `ray_operation_run_time_ms`, `ray_operation_active_count`, `ray_operation_count_total` | Internal operation queue and run time by `Name`. |
| Control-plane responsiveness | `ray_io_context_event_loop_lag_ms`, `ray_io_context_monitor_latency_ms`, `ray_health_check_rpc_latency_ms` | Event-loop lag inside Ray components and node health-check RPC latency. Rising lag precedes control-plane slowness. |
| Placement latency | `ray_scheduler_placement_time_ms` plus its pre-computed `_max`, `_mean`, `_p50`, `_p95`, `_p99` gauges | Task placement latency. Ray exports the percentiles alongside the histogram. |
| Object accounting | `ray_object_store_memory`, `ray_object_store_dist`, `ray_owned_objects`, `ray_owned_objects_size`, `ray_total_lineage_bytes` | Object store bytes by `Location` and `ObjectState`, object size distribution, and per-owner object counts, bytes and lineage bytes. |
| Object directory | the `ray_object_directory_*` family (`_lookups`, `_updates`, `_subscriptions`, and the location counters) | Object directory traffic. |
| Object transfer | the `ray_object_manager_*`, `ray_pull_manager_*` and `ray_push_manager_*` families | Object movement between nodes and the pull and push queue detail. Flat on a single-node cluster, which has nowhere to transfer to. |
| Worker processes | `ray_internal_num_processes_started`, `_from_cache`, `ray_worker_register_time_ms`, `ray_local_resource_view_node_count` | Worker starts and cache reuse, registration latency, and the nodes in the raylet's local resource view. |
| Per-component process use | the `ray_component_*` family (`_cpu_percentage`, `_rss_bytes`, `_uss_bytes`, `_num_fds`, and the MB variants) | Process resource use per `Component` - raylet, GCS, dashboard, agents. |
| Host and cgroup memory | `ray_node_cgroup_mem_total`, `_used`, `ray_node_mem_total_host`, `_used_host`, `ray_node_mem_shared_bytes` | Cgroup and host memory views alongside the Ray view. |
| Node I/O detail | the `ray_node_disk_io_*` and `ray_node_disk_*_iops` families, `ray_node_disk_utilization_percentage`, and `ray_node_network_*` | Per-node disk and network I/O detail. |
| Exporter internals | `process_*`, `python_*`, and the `scrape_*` meta | The exporting process itself, Python GC, and the receiver's own scrape statistics. |

GPU nodes additionally export `ray_node_gpus_utilization`,
`ray_node_gpus_available`, `ray_node_gpu_power_milliwatts`,
`ray_node_gpu_temperature_celsius`, `ray_node_gram_used` and
`ray_node_gram_available`. They are absent on CPU-only hardware.

### How the Ray metric surface behaves

Six things about this surface change how you build dashboards and alerts on
it.

**Every Ray series carries `SessionName`, and it changes on every cluster
restart.** The exceptions are the `process_*`, `python_*` and scrape meta.
The value is `session_<timestamp>_<pid>`, so a `ray stop; ray start`
replaces the entire series set rather than continuing it. Never pin a
`SessionName` in a dashboard or an alert, and expect storage cost to grow
with restart frequency.

**Labels, not names, drive the volume.** 116 metric names produce 556 data
points per scrape on a single-node cluster with two CPUs. One family,
`ray_grpc_server_req_process_time_ms_bucket`, accounts for 273 of the 1093
raw series, and `ray_operation_run_time_ms_bucket`,
`ray_operation_queue_time_ms_bucket` and
`ray_gcs_storage_operation_latency_ms_bucket` add 169 more. These are
internal RPC histograms; a keep or drop rule on the scrape job is the lever
that decides which of them ship - see
[Scoping the internal histogram families](#scoping-the-internal-histogram-families).

**The cardinality level does not do what Ray's documentation says.** Ray's
system-metrics reference states that "Starting with Ray 2.53+, the
`WorkerId` label is no longer exported by default due to its high
cardinality". On Ray 2.58+, with the default
`RAY_metric_cardinality_level=recommended`, the behaviour is narrower:

- The `WorkerId` label **key** is still present on most series, almost
  always empty.
- The real worker ID is stripped from `ray_tasks` and `ray_actors` only.
- Nine families still carry a real worker ID: `ray_object_store_memory`,
  `ray_owned_objects`, `ray_owned_objects_size`, the five
  `ray_scheduler_placement_time_ms_max`, `_mean`, `_p50`, `_p95`, `_p99`
  series, and `ray_total_lineage_bytes`.

Setting the level to `legacy` additionally restores the real worker ID on
`ray_tasks` and `ray_actors`. The `low` level is documented to also drop
the `Name` label from tasks and actors; that behaviour is unverified.

**`ray_tasks` and `ray_actors` are state gauges, not counters.** They
report the current count per `State`. Task states are
`SUBMITTED_TO_WORKER`, `RUNNING`, `RUNNING_IN_RAY_GET`,
`RUNNING_IN_RAY_WAIT`, `PENDING_NODE_ASSIGNMENT`, `PENDING_ARGS_AVAIL`,
`GETTING_AND_PINNING_ARGS`, `FINISHED` and `FAILED`. Actor states are
`ALIVE`, `ALIVE_IDLE` and `ALIVE_RUNNING_TASKS`.

**`ray_resources` uses `Name` for two different things.** `Name="CPU"`,
`Name="memory"` and `Name="object_store_memory"` are the real resources,
split by `State="AVAILABLE"` and `State="USED"`. `Name="session_<...>"` is
Ray's implicit per-node resource. Filter on the three real names rather
than taking every `ray_resources` series.

**`RAY_enable_open_telemetry` does not give you OTLP.** It defaults to true
on Ray 2.58+ and only swaps Ray's internal metric recorder from OpenCensus
to OpenTelemetry. It does not change the Prometheus exposition and does not
add an OTLP exporter, so the scrape path is the same either way.

## Key Alerts to Configure

Thresholds are relative to a trailing baseline or to your own cluster
shape - Ray's absolute rates depend entirely on node count, CPU count and
workload. Tune these to what your cluster normally does.

| Alert | Expression | Why it matters |
|---|---|---|
| Metrics endpoint down | `up == 0` for 2m | The head node's metrics port stopped answering. Also fires when a restart omits `--metrics-export-port`. |
| Node lost | `ray_cluster_active_nodes` below the expected node count for 5m | Node loss shows here first. The expected count is a deployment constant, not a metric - carry it in the alert expression. |
| Tasks failing | `ray_tasks{State="FAILED"}` rising against its own baseline | The workload is erroring, not just slow. |
| Work cannot be placed | `ray_scheduler_unscheduleable_tasks > 0` for 10m, or `ray_internal_num_infeasible_scheduling_classes > 0` | The first is transient pressure and usually clears with capacity; the second means no node in the cluster can ever satisfy the request, so the resource spec or the cluster shape has to change. |
| Object store filling | `ray_object_store_used_memory / (ray_object_store_used_memory + ray_object_store_available_memory)` high against baseline | Spilling and then task back-pressure follow. Add object store memory or reduce object retention. |
| Object spilling | `rate(ray_spill_manager_request_total[10m])` rising from a zero baseline, or `ray_object_store_fallback_memory > 0` | Spilling to disk means the object store is out of room; fallback allocation means it has exceeded shared memory. |
| Worker startup failures | `rate(ray_scheduler_failed_worker_startup_total[10m]) > 0` | Workers are not coming up - usually resource limits or a bad runtime environment. |
| Task events dropped | `ray_gcs_task_manager_task_events_dropped` rising | The dashboard and state API are showing an incomplete picture, so debugging views cannot be trusted. |
| Node memory pressure | `ray_node_mem_used / ray_node_mem_total` high against baseline | Ray kills workers under memory pressure before the node OOMs, so this fires ahead of unexplained task failures. |

## Access Setup

`--metrics-export-port` is the only thing that creates the metrics
endpoint. There is no default port and no default-on endpoint: pick a port,
pass it to the head node, and scrape that same port. The examples here use
`8080`.

```bash showLineNumbers title="Start the head node"
ray start --head \
  --dashboard-host 0.0.0.0 \
  --metrics-export-port 8080 \
  --num-cpus 2
```

The endpoint has no authentication. Bind it to the internal network the
Collector runs on and do not expose it publicly.

The dashboard and the metrics agent need the `ray[default]` extra. The
official images already include it, so no extra install is needed there.

**Docker setup** - the official image publishes `linux/amd64` and
`linux/arm64` manifests, so no wheel build is needed on Apple Silicon or
Graviton:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  ray-head:
    image: rayproject/ray:2.58.0-py312-cpu
    command: >
      ray start --head --dashboard-host 0.0.0.0
      --metrics-export-port 8080 --num-cpus 2 --block
    shm_size: 2gb
    ports:
      - "8080:8080"
      - "8265:8265"
    healthcheck:
      test:
        - CMD
        - python
        - -c
        - "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/metrics', timeout=2).status == 200 else 1)"
      interval: 10s
      timeout: 5s
      retries: 10

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml
    depends_on:
      ray-head:
        condition: service_healthy
```

Two details in that snippet matter:

- `shm_size: 2gb` sizes `/dev/shm` for the object store. On the Docker
  default of 64 MB, Ray falls back to `/tmp` for the object store and warns
  about it, which puts object traffic on disk.
- The healthcheck uses Python, not `curl`. The Ray image ships no `curl`,
  so a `curl`-based healthcheck never passes and anything waiting on
  `service_healthy` never starts.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: ray
          scrape_interval: 15s
          static_configs:
            - targets:
                # host:port passed to --metrics-export-port
                - ${env:RAY_HEAD_HOST}:8080

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

The Prometheus receiver keeps everything the metrics port exposes. There is
no per-metric enable list, so new series appear after a Ray upgrade with no
Collector change. The `up` series and the four `scrape_*` series are
synthesized by the receiver, not by Ray. Scout authentication for the
`otlphttp/b14` exporter is covered in
[Scout Exporter](../collector-setup/scout-exporter.md).

### Environment Variables

```bash showLineNumbers title=".env"
RAY_HEAD_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Scoping the internal histogram families

Four histogram families - internal gRPC handling time, operation run and
queue time, and GCS storage operation latency - account for the bulk of the
raw series a head node exposes. A `metric_relabel_configs` rule on the
scrape job decides whether they ship:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "ray_(grpc_server_req_process_time_ms|operation_run_time_ms|operation_queue_time_ms|gcs_storage_operation_latency_ms)_(bucket|sum|count)"
              action: drop
```

Invert it with `action: keep` and a regex over the families you want if you
prefer an allowlist. These are Diagnostic-tier series: dropping them
removes control-plane latency detail from incident investigation, so decide
per environment rather than by default.

## Verify the Setup

Start the head node and the Collector, then check for metrics within 60
seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the metrics port is serving (run from a host that has curl -
# the Ray image does not)
curl -s http://localhost:8080/metrics | grep ray_cluster_active_nodes

# Check Collector logs for scraped Ray metrics
docker logs otel-collector 2>&1 | grep -i "ray_"
```

`ray status`, run inside the head node container, shows the same cluster
view from Ray's side - node count and resource usage - and is a quick
cross-check when a metric looks wrong:

```bash showLineNumbers title="Cross-check with ray status"
docker exec ray-head ray status
```

## Troubleshooting

### Nothing is served on the metrics port

**Cause**: The head node was started without `--metrics-export-port`. There
is no default port and no endpoint until the flag is passed.

**Fix**:

1. Restart the head node with `--metrics-export-port <port>`.
2. Confirm the Collector's scrape target uses the same port.
3. Check the port is reachable from the Collector host, and published if
   Ray runs in a container.

### The healthcheck never passes and dependent containers never start

**Cause**: The Ray image ships no `curl`, so a `curl`-based container
healthcheck fails immediately and anything with
`condition: service_healthy` waits forever.

**Fix**: Use the Python already in the image:

```bash showLineNumbers title="Healthcheck without curl"
python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/metrics', timeout=2).status == 200 else 1)"
```

### Every dashboard broke after a cluster restart

**Cause**: The `SessionName` label changed. Its value is
`session_<timestamp>_<pid>` and it is regenerated on every `ray start`, so
the old series stopped and a new set began.

**Look at**: any Ray series' `SessionName` label before and after the
restart - they will differ.

**Fix**:

1. Remove `SessionName` from dashboard queries and alert expressions.
2. Group on `node_type`, `Name`, `State` or `Component` instead.
3. Account for the series churn in retention planning; each restart adds a
   full new series set.

### Far more series arrive than expected

**Cause**: The internal gRPC and operation histograms dominate the surface.
The `ray_grpc_server_req_process_time_ms_bucket` family alone is roughly a
quarter of the raw series a head node exposes, with the operation and GCS
storage latency histograms adding around a sixth more.

**Look at**: the Diagnostic-tier `ray_grpc_server_req_process_time_ms`,
`ray_operation_run_time_ms`, `ray_operation_queue_time_ms` and
`ray_gcs_storage_operation_latency_ms` families.

**Fix**: Scope them with `metric_relabel_configs` - see
[Scoping the internal histogram families](#scoping-the-internal-histogram-families).

### `WorkerId` still appears on Ray 2.53+

**Cause**: The default `recommended` cardinality level is a partial
control, not a switch that removes the label. It strips the real worker ID
from `ray_tasks` and `ray_actors` only, and leaves the empty label key on
most of the rest.

**Look at**: `ray_object_store_memory`, `ray_owned_objects`,
`ray_owned_objects_size`, the `ray_scheduler_placement_time_ms_*`
percentile gauges and `ray_total_lineage_bytes` - these nine families keep
a real worker ID at the default level.

**Fix**: Drop or aggregate away the `WorkerId` label on those families in
the Collector if the fan-out matters, rather than expecting the cardinality
level to do it.

### Object store errors, or Ray falls back to `/tmp`

**Cause**: `/dev/shm` is too small for the object store. Docker's default
is 64 MB; Ray warns and uses `/tmp` instead, which puts object traffic on
disk.

**Look at**: `ray_object_store_fallback_memory` (non-zero means the store
exceeded its shared-memory budget) and `ray_node_disk_usage`.

**Fix**: Raise `shm_size` on the container (`shm_size: 2gb` is a
reasonable start) and restart the head node.

### The cluster feels slow but no resource is saturated

**Cause**: the control plane is the bottleneck, not the workers. CPU,
memory and object store all read normally while task submission,
placement and actor creation take longer than they should.

**Look at**: the Diagnostic tier's control-plane group.
`ray_io_context_event_loop_lag_ms` rises before anything else does;
`ray_gcs_storage_operation_latency_ms` by `Operation` says whether the
GCS store is the cause; `ray_scheduler_placement_time_ms` and its
pre-computed `_p95` and `_p99` gauges show the cost landing on task
placement. `ray_component_cpu_percentage` and `ray_component_rss_bytes`
by `Component` say which process - raylet, GCS, dashboard - is the one
under pressure.

**Fix**: give the head node more CPU, or move the dashboard and agents
off it. If `ray_gcs_storage_operation_latency_ms` is the outlier, the GCS
store is the constraint rather than the scheduler.

### Tasks are stuck pending

**Cause**: Either the cluster is temporarily short of resources, or the
task asks for a resource shape no node can provide.

**Look at**: `ray_scheduler_unscheduleable_tasks` - non-zero but falling is
transient pressure. `ray_internal_num_infeasible_scheduling_classes` above
zero means no node in the cluster can ever satisfy the request. Cross-check
`ray_resources` split by `State` for what is actually available.

**Fix**:

1. Add capacity or wait out the queue if only
   `ray_scheduler_unscheduleable_tasks` is set.
2. Correct the task's resource spec, or add a node type that matches it, if
   `ray_internal_num_infeasible_scheduling_classes` is set.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## Updates & Upgrades

### Ray version changes

- **2.53**: introduced `RAY_metric_cardinality_level`, defaulting it to
  `recommended`. The real worker ID is no longer exported on `ray_tasks`
  and `ray_actors`, so dashboards and alerts that group either family by
  `WorkerId` stop resolving after the upgrade. Rebuild those queries on
  `Name` and `State`, or set `RAY_metric_cardinality_level=legacy` on the
  head node to restore the previous labelling. Nine other families keep a
  real worker ID at the default level, so the label does not disappear from
  the surface. _(breaking for `WorkerId`-keyed queries on tasks and
  actors)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no receiver-key
  rename across the supported Collector range, so the Collector config is
  stable on an image bump. New Ray metric names appear after a Ray upgrade
  with no Collector change, because the scrape job has no enable list.
  _(no breaking change on the Prometheus path)_

## FAQ

### How do I monitor a multi-node cluster?

Every node exposes its own metrics port, so give each one
`--metrics-export-port` and add a scrape target per node - or point the
Prometheus receiver at service discovery and let it find them. The head
head node is the one that carries the GCS and cluster-wide series
(`ray_cluster_active_nodes`, `ray_resources`, `ray_gcs_*`), so expect to
lose the cluster view if you scrape only the workers. Confirm the split
against your own cluster before you build dashboards on it.

### How does this relate to KubeRay?

The mechanism is the same: each Ray pod serves Prometheus text on its
metrics port, and something scrapes it. Scrape it with a Kubernetes
`ServiceMonitor`/`PodMonitor` if you already run the Prometheus Operator,
or run the Collector as a DaemonSet with Kubernetes service discovery in
the scrape config. Expect the metric names, labels and `SessionName`
behaviour to carry over unchanged, since they come from Ray rather than
from how it is deployed.

### Why do `ray_tasks` and `ray_actors` look like gauges?

Because they are. Both report the current count per `State` rather than a
monotonic total, so read them directly - `ray_tasks{State="FAILED"}` is the
number of failed tasks Ray currently knows about. Do not wrap them in
`rate()`; that produces a meaningless number for a gauge that goes up and
down.

### What can I do about metric volume?

Volume comes from labels, not from the 116 metric names. Four internal
histogram families - gRPC request handling time, operation run and queue
time, and GCS storage operation latency - produce most of the raw series. A
`metric_relabel_configs` keep or drop rule on the scrape job scopes which
of them ship; see
[Scoping the internal histogram families](#scoping-the-internal-histogram-families).
They are Diagnostic-tier series, so dropping them costs incident detail.

### Can Ray export OTLP directly?

No. `RAY_enable_open_telemetry` only swaps Ray's internal metric recorder
from OpenCensus to OpenTelemetry; it does not change the Prometheus
exposition and does not add an OTLP exporter. Scraping the metrics port is
how the data gets out. Ray also has an in-process tracing hook configured
through its Python API rather than the CLI, which is a separate mechanism
and does not affect the metrics path described here.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Ray cluster metrics.
- [vLLM Monitoring](./vllm.md) - Self-hosted model server commonly run on
  the same cluster as the Ray tasks.
- [llama.cpp Monitoring](./llama-cpp.md) - Self-hosted model server for CPU
  and small-GPU nodes alongside a Ray cluster.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [vLLM](./vllm.md), [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your cluster
  size, and split dashboards by `node_type` and by `ray_resources` `Name`
  once you are running more than one node type.
