---
title: >
  cAdvisor OpenTelemetry Monitoring - Per-Container CPU, Memory,
  OOM Events, and Collector Setup
sidebar_label: cAdvisor
id: collecting-cadvisor-telemetry
sidebar_position: 48
description: >
  Scrape cAdvisor with the OpenTelemetry Collector's prometheus receiver.
  Monitor per-container CPU, memory, OOM events, filesystem, and network,
  and ship to base14 Scout.
keywords:
  - cadvisor opentelemetry
  - cadvisor otel collector
  - container metrics monitoring
  - cadvisor prometheus receiver
  - container resource monitoring
  - cadvisor observability
  - per-container cpu memory oom metrics
  - cadvisor telemetry collection
---

# cAdvisor

cAdvisor (Container Advisor) exposes Prometheus text at `/metrics` on
`:8080`. The OpenTelemetry Collector's `prometheus` receiver scrapes it
directly, collecting 90+ metrics across per-container CPU, memory
(including OOM events), filesystem, and network, plus host-capacity
(`machine_*`) figures, then ships them to base14 Scout. This guide
configures the receiver, deploys cAdvisor with the access it needs, and
exports the metrics.

## Prerequisites

| Requirement            | Minimum | Recommended      |
| ---------------------- | ------- | ---------------- |
| cAdvisor               | 0.45    | 0.49+ (v0.49.1)  |
| OTel Collector Contrib | 0.90.0  | 0.153.0          |
| base14 Scout           | Any     | -                |

Before starting:

- cAdvisor's metrics port (`8080`) must be reachable from the host
  running the Collector.
- cAdvisor needs `--privileged`, the `/dev/kmsg` device, and read-only
  mounts of `/`, `/sys`, `/var/lib/docker`, `/var/run`, and `/dev/disk`
  to read host cgroup and filesystem statistics (see
  [Access Setup](#access-setup)).
- No authentication is required on the metrics endpoint by default.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

A few things to know about this surface before you read the tiers:

- **`up` is the liveness signal here.** The `prometheus` receiver emits
  `up` = 1 when cAdvisor's `/metrics` endpoint responds. That is the
  liveness signal for the cAdvisor scrape itself; cAdvisor in turn
  reports per-container health - CPU, memory working set, and OOM
  events.
- **cAdvisor is one of the highest-cardinality exporters.** Every
  `container_*` series carries `name`, `id`, and `image` labels (plus
  `pod` / `namespace` / `container` under Kubernetes), and the
  filesystem / network families add a series per device and per
  interface. Scope it with a `container_.*|machine_.*|up` keep filter
  (see [Configuration](#configuration)).
- **It reports on every container the host runs.** Under Kubernetes this
  also surfaces system pods. The empty-`name` (root cgroup) series is
  the machine-wide aggregate.
- **`working_set` is the OOM-risk figure.**
  `container_memory_working_set_bytes` is non-reclaimable - what the
  OOM-killer counts - while `container_memory_usage_bytes` includes
  reclaimable page cache and reads higher.
- **`go_*` / `process_*` are cAdvisor's own runtime**, not container
  metrics. The keep filter drops them.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Prometheus scrape liveness - 1 means cAdvisor's `/metrics` responded. The liveness signal on this surface. |
| `container_cpu_usage_seconds_total` | Cumulative CPU time per container; the rate approximates cores in use. Headline compute load. |
| `container_memory_working_set_bytes` | Non-reclaimable memory - what the OOM-killer counts. Headline memory-pressure / OOM-risk signal. |
| `container_oom_events_total` | OOM-kill events for the container; a rising count means it is being killed for memory. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Memory | `container_memory_usage_bytes`, `container_spec_memory_limit_bytes` | Total memory including reclaimable cache, and the configured limit - the denominator for OOM-risk %. |
| CPU detail | `container_cpu_system_seconds_total`, `container_cpu_user_seconds_total`, `container_cpu_load_average_10s` | Kernel/user-mode CPU split and the 10-second load average (runnable tasks). |
| Network | `container_network_receive_bytes_total`, `container_network_transmit_bytes_total`, `container_network_receive_errors_total`, `container_network_transmit_errors_total`, `container_network_receive_packets_dropped_total`, `container_network_transmit_packets_dropped_total` | Per-interface throughput, interface errors, and dropped packets (buffer saturation). |
| Filesystem | `container_fs_usage_bytes`, `container_fs_limit_bytes`, `container_fs_reads_bytes_total`, `container_fs_writes_bytes_total` | Bytes used vs device size (disk-full %) and read/write throughput per device. |
| Lifecycle | `container_tasks_state`, `container_start_time_seconds`, `container_last_seen` | Task count by state, start time (a change means a restart), and last-seen freshness. |
| Host capacity | `machine_memory_bytes`, `machine_cpu_cores` | Host total memory and logical CPU count - the denominators for machine-wide utilization. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Memory breakdown | `container_memory_rss`, `container_memory_cache`, `container_memory_swap`, ... | Anonymous vs page-cache vs swap split behind the working-set figure. |
| Container spec / limits | `container_spec_cpu_period`, `container_spec_cpu_shares`, `container_spec_memory_swap_limit_bytes`, ... | The static cgroup limits the container was configured with. |
| Filesystem I/O detail | `container_fs_reads_total`, `container_fs_writes_total`, `container_fs_io_time_seconds_total`, ... | Operation counts and I/O time behind the byte throughput. |
| Per-device block I/O | `container_blkio_device_usage_total` | Block I/O bytes by device and operation. |
| Packet counts | `container_network_receive_packets_total`, `container_network_transmit_packets_total` | Drill-down behind the rx/tx byte, error, and drop counters. |
| Machine hardware | `machine_cpu_physical_cores`, `machine_cpu_sockets`, `machine_swap_bytes`, ... | Host physical-core, socket, and swap capacity detail. |
| Build / scrape flags | `cadvisor_version_info`, `container_scrape_error`, `machine_scrape_error` | cAdvisor build labels and its own collection-error flags (1 = it failed to read stats). |
| cAdvisor runtime + scrape meta | `go_*`, `process_*`, `scrape_duration_seconds`, ... | cAdvisor's own Go-runtime/process series and the receiver-side scrape meta - the keep filter drops these. |

Full metric list: run `curl -s http://localhost:8080/metrics` against
your cAdvisor instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. The
ratios are against each container's own configured limit, not invented
absolutes; tune them to your workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | No per-container metrics are arriving - check the cAdvisor container and the scrape target. |
| `rate(container_oom_events_total)` | `> 0` | A container was OOM-killed - raise its limit or fix the leak. |
| `container_memory_working_set_bytes / container_spec_memory_limit_bytes` | `> 0.9` (when a limit is set) | OOM-kill is imminent for that container. |
| `rate(container_cpu_usage_seconds_total)` | approaching the container's CPU quota | The container is CPU-bound and likely throttled - scale out or raise the quota. |
| `container_fs_usage_bytes / container_fs_limit_bytes` | `> 0.9` | Disk pressure on that device - free space or expand. |
| `rate(container_network_receive_errors_total + container_network_transmit_errors_total)` | `> 0` | Interface errors or drops - check host networking and throughput ceilings. |
| `time() - container_last_seen` | `>` several scrape intervals | cAdvisor stopped seeing the container - it may have exited unexpectedly. |

## Access Setup

cAdvisor reads host cgroup and filesystem statistics directly, so it
runs as a privileged container with the `/dev/kmsg` device and several
read-only host mounts. Deploy it alongside the Collector:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    privileged: true
    devices:
      - /dev/kmsg
    volumes:
      - /:/rootfs:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
      - /var/run:/var/run:ro
      - /dev/disk:/dev/disk:ro
    ports:
      - "8080:8080"
```

Verify the endpoint is serving metrics:

```bash showLineNumbers title="Verify access"
# Confirm cAdvisor is serving metrics
curl -s http://localhost:8080/metrics | head -20

# Check a representative container metric is present
curl -s http://localhost:8080/metrics | grep container_cpu_usage_seconds_total
```

The metrics endpoint has no authentication by default. Restrict the port
to the Collector's network and front it appropriately in production.

## Configuration

The `prometheus` receiver scrapes cAdvisor's `/metrics` endpoint
(the default path, so no `metrics_path` override is needed). The
`metric_relabel_configs` keep filter scopes collection to the
`container_*` and `machine_*` families plus `up`, dropping cAdvisor's
own `go_*` / `process_*` runtime noise - the high-cardinality control
for this surface.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cadvisor
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:CADVISOR_HOST}:8080
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "container_.*|machine_.*|up"
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

# Export to base14 Scout
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

### Environment Variables

```bash showLineNumbers title=".env"
CADVISOR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (introduced in semantic conventions v1.27.0, stable as
> of v1.41.0). Scout's UI filters on the lowercase `environment` key, so
> emit it alongside the OTel-native `deployment.environment.name`. The
> legacy `deployment.environment` is still accepted for backward
> compatibility.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for a successful cadvisor scrape
docker logs otel-collector 2>&1 | grep -i "cadvisor"

# Check the metrics endpoint directly
curl -s http://localhost:8080/metrics | grep container_memory_working_set_bytes
```

## Troubleshooting

### Connection refused on port 8080

**Cause**: The Collector cannot reach cAdvisor at the configured
address.

**Fix**:

1. Verify cAdvisor is running: `docker ps | grep cadvisor`.
2. Confirm cAdvisor's metrics port (`8080`) is published or reachable
   from the Collector host.
3. Check firewall rules if the Collector runs on a separate host.

### cAdvisor returns errors or empty per-container metrics

**Cause**: cAdvisor cannot read host cgroup or filesystem statistics, so
it reports collection errors or metric names with empty per-container
labels.

**Look at**: `container_scrape_error` / `machine_scrape_error` - `1`
means cAdvisor failed to read stats.

**Fix**:

1. Confirm cAdvisor runs with `--privileged` and the `/dev/kmsg` device.
2. Verify the read-only host mounts (`/`, `/sys`, `/var/lib/docker`,
   `/var/run`, `/dev/disk`) are all present.
3. Check the cAdvisor container logs for cgroup access errors.

### Metric volume or cardinality is too high

**Cause**: cAdvisor emits a series per container plus a series per device
and per interface, and exposes its own `go_*` / `process_*` runtime
internals.

**Look at**: `scrape_samples_scraped` for the per-scrape series count.

**Fix**:

1. Keep the `container_.*|machine_.*|up` keep filter so collection is
   scoped to the container and machine families and cAdvisor's own
   runtime series are dropped.
2. Drop the high-cardinality per-device / per-interface Diagnostic detail
   with an additional `metric_relabel_configs` rule if it is not needed.
3. A longer `scrape_interval` also reduces sample volume.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Does this work with cAdvisor running in Kubernetes?

Yes. cAdvisor is embedded in the kubelet, so you can scrape the kubelet's
`/metrics/cadvisor` endpoint, or run cAdvisor as a DaemonSet so each
node's containers are measured by a local instance. The container and
machine metric names match either way.

### How do I monitor cAdvisor on multiple hosts?

Add one scrape target per cAdvisor instance to the `prometheus`
receiver's `static_configs`. The receiver attaches an `instance` label to
each series, which distinguishes the hosts in Scout.

### `container_memory_usage_bytes` vs `container_memory_working_set_bytes`?

`container_memory_usage_bytes` includes reclaimable page cache and reads
higher. `container_memory_working_set_bytes` is the non-reclaimable
memory the OOM-killer counts, so it is the OOM-risk signal and the better
basis for memory alerts.

### Why does cAdvisor need to run privileged?

cAdvisor reads host cgroup and filesystem statistics directly. It needs
`--privileged`, the `/dev/kmsg` device, and read-only mounts of `/`,
`/sys`, `/var/lib/docker`, `/var/run`, and `/dev/disk` to collect
per-container resource metrics.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on container metrics.
- [Docker Engine Monitoring](./docker.md) -
  Per-container metrics from the Docker Engine API via the `docker_stats`
  receiver.
- [Kubelet Stats Monitoring](./kubelet-stats.md) -
  Node, pod, and container metrics from the kubelet Summary API.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Docker Engine](./docker.md),
  [Kubelet Stats](./kubelet-stats.md),
  and other components.
- **Fine-tune Collection**: The `container_.*|machine_.*|up` keep filter
  scopes collection to the container and machine families. The per-device
  / per-interface Diagnostic detail is there when you need to drill in
  during an incident or a capacity review.
