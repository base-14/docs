---
title: >
  containerd OpenTelemetry Monitoring - CRI Errors, Image Pulls,
  Container Resources, and Collector Setup
sidebar_label: containerd
id: collecting-containerd-telemetry
sidebar_position: 72
description: >
  Scrape containerd metrics and collect CRI traces with the OpenTelemetry
  Collector. Monitor CRI errors, image pull failures, pod start latency and
  container memory in base14 Scout.
keywords:
  - containerd opentelemetry
  - containerd otel collector
  - containerd metrics monitoring
  - containerd cri metrics
  - kubernetes container runtime monitoring
  - containerd image pull failures
  - containerd observability
  - containerd telemetry collection
  - containerd tracing
---

# containerd

containerd serves Prometheus metrics from its own HTTP listener, with no
exporter to install. The listener is off by default. Turn it on in
`config.toml`, point the Collector's `prometheus` receiver at
`/v1/metrics`, and you get three groups of metrics: the CRI plugin's view of
pod and container lifecycles and image pulls (`containerd_cri_*`), CPU,
memory, pids and I/O for every running container (`container_*`), and
per-method gRPC counters (`grpc_server_*`). containerd can also push traces
of CRI calls over OTLP. This guide covers the containerd the kubelet talks
to on a Kubernetes node: turning the listener on, the Collector
configuration, and shipping to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| containerd             | 2.0     | 2.4         |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The metric names in this guide are the 2.x names. containerd 1.7 serves
the same endpoint with three image pull metrics named differently; see
[containerd 1.7 names](#containerd-17-names).

The Collector floor is about component names: the `otlp_http` exporter was
`otlphttp` before contrib 0.149.0.

Before starting:

- Access to each node's containerd configuration, usually
  `/etc/containerd/config.toml`, and permission to restart containerd.
- A Collector that can reach the metrics address on every node, typically a
  DaemonSet.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

Expect around 120 metric families and a few thousand series per node.
Most of those series are gRPC counters that stay at zero; see
[gRPC series are mostly zeros](#grpc-series-are-mostly-zeros).

### Core - is the runtime healthy and are containers within limits

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 when the Collector scraped containerd. 0 when containerd is down, the listener is off, or the scrape path is wrong. |
| `grpc_server_handled_total` for `runtime.v1.RuntimeService` and `runtime.v1.ImageService` | counter | CRI calls completed, by `grpc_method` and `grpc_code`. The kubelet's error rate against the runtime. |
| `containerd_cri_sandboxed_image_pulls_total` | counter | Image pulls by `status`, `success` or `failure`. |
| `container_memory_usage_bytes` and `container_memory_usage_limit_bytes` | gauge | Memory in use and the memory limit, per container. Together they give headroom. |

The CRI services are `runtime.v1.RuntimeService` and
`runtime.v1.ImageService` in the `grpc_service` label. The other services
on the same metric are containerd's internal APIs.

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `container_cpu_usage_usec_microseconds` | gauge | CPU time used, cumulative. |
| `container_cpu_nr_throttled_total` | gauge | CFS periods in which the container was throttled, cumulative. |
| `container_cpu_nr_periods_total` | gauge | CFS periods elapsed, cumulative. Throttled over elapsed is the throttling ratio. |
| `container_cpu_throttled_usec_microseconds` | gauge | Time spent throttled, cumulative. |
| `container_memory_oom_total` | gauge | OOM kills inside a running container. Misses kills of the main process; see [OOM kills of a container's main process are not counted](#oom-kills-of-a-containers-main-process-are-not-counted). |
| `container_pids_current` | gauge | Processes in the container. |
| `container_pids_limit` | gauge | The pids limit. |
| `containerd_cri_sandbox_runtime_create_seconds` | histogram | Time to create a pod sandbox. |
| `containerd_cri_sandbox_create_network_seconds` | histogram | Time to set up a pod's network through CNI. |
| `containerd_cri_container_create_seconds` | histogram | Time to create a container. |
| `containerd_cri_container_start_seconds` | histogram | Time to start a container. |
| `containerd_cri_container_stop_seconds` | histogram | Time to stop a container. |
| `containerd_cri_network_plugin_operations_total_total` | counter | CNI operations by `operation_type`, `set_up_pod` or `tear_down_pod`. |
| `containerd_cri_sandboxed_in_progress_image_pulls_total` | gauge | Image pulls in flight. |
| `containerd_cri_container_events_dropped_total` | counter | Container events containerd discarded since it started. |

The `containerd_cri_*_seconds` histograms record successful operations
only. A failed container start does not appear in
`containerd_cri_container_start_seconds`; it appears in
`grpc_server_handled_total` with a non-`OK` `grpc_code`.

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `container_memory_*_bytes` (33 families) | Memory breakdown from the cgroup: `anon`, `file`, `slab`, `shmem`, `sock`, `swap_usage`, the `active_*` and `inactive_*` lists, `workingset_*` and page event counts. |
| `container_cpu_system_usec_microseconds`, `container_cpu_user_usec_microseconds` | CPU time split into kernel and user. |
| `container_io_rbytes_bytes`, `container_io_wbytes_bytes`, `container_io_rios_total`, `container_io_wios_total` | Block I/O per device, labelled `major` and `minor`. |
| `grpc_server_started_total`, `grpc_server_msg_received_total`, `grpc_server_msg_sent_total` | gRPC calls started and messages exchanged, per method. |
| `grpc_server_handling_seconds` | gRPC latency per method. Only with `grpc_histogram` on. |
| `containerd_cri_container_remove_seconds`, `containerd_cri_sandbox_remove_seconds`, `containerd_cri_sandbox_runtime_stop_seconds`, `containerd_cri_sandbox_delete_network_seconds` | Teardown latency. |
| `containerd_cri_container_list_seconds`, `containerd_cri_sandbox_list_seconds`, `containerd_cri_stream_container_list_seconds`, `containerd_cri_stream_sandbox_list_seconds` | List call latency. |
| `containerd_cri_network_plugin_operations_duration_seconds_seconds` | CNI operation latency by `operation_type`. |
| `containerd_cri_sandboxed_image_pulling_throughput_mibps` | Image pull throughput in MiB/s, one sample per pull. |
| `containerd_cri_input_bytes_total`, `containerd_cri_output_bytes_total` and the `_entries_total` counters | Container log I/O. |
| `containerd_gc_collections_total`, `containerd_gc_gc_seconds` | Garbage collection runs and time. |
| `containerd_build_info_total` | The running version, in the `version` label. |

`containerd_cri_sandboxed_image_pulling_throughput` also appears. containerd
marks it deprecated in favour of the `_mibps` form, and its buckets top out
at 10 MiB/s. On containerd 2.0 to 2.3 the deprecated form is the only one,
and the two `containerd_cri_stream_*_list_seconds` families are absent.

### Two prefixes and an unprefixed family

- `containerd_` covers the daemon and its CRI plugin.
- `container_` covers per-container cgroup stats, labelled `container_id`,
  `namespace` and `runtime`. `namespace` is the containerd namespace, which
  is `k8s.io` for everything the kubelet creates. It is not the Kubernetes
  namespace.
- `grpc_server_` has no `containerd` prefix at all.

`container_*` metrics carry the container ID and nothing else that
identifies the pod. For per-pod resources with pod names attached, see
[Kubelet Stats Monitoring](./kubelet-stats.md).

### Every `container_*` metric is a gauge

All `container_*` families are exposed as gauges, including the cumulative
ones: CPU time, throttled periods, OOM kills and I/O bytes all rise
steadily and reset when the container restarts. Take a rate over them as
you would a counter. The type in Scout says gauge.

### Names that do not mean what they say

- The `pg*` families, such as `container_memory_pgfault_bytes` and
  `container_memory_pgmajfault_bytes`, count page events. They are not
  bytes.
- `container_cpu_usage_usec_microseconds` and the other CPU families carry
  the unit twice. The values are microseconds.
- `containerd_cri_network_plugin_operations_total_total` and
  `containerd_cri_network_plugin_operations_duration_seconds_seconds` have
  the suffix twice. These are the real names.
- `containerd_build_info_total` is a counter that always reads 1.

### Containers without a limit report 2^64

`container_memory_usage_limit_bytes`, `container_memory_swap_limit_bytes`
and `container_pids_limit` read `1.8446744073709552e+19` for a container
with no limit. Every pod's pause container reads that, as does any
container without a limit. A usage-over-limit ratio for those containers is
close to 0 rather than missing.

### Series come and go with containers

`container_*` series exist while a container's task is running. When a
container exits, its series disappear, before the container is removed.
Each running container has 44 `container_*` series, 48 once it has done
block I/O. Each pod adds a pause container with its own set.

### OOM kills of a container's main process are not counted

`container_memory_oom_total` counts OOM kills in the cgroup of a running
container. When the kernel kills a child process and the container keeps
running, the count goes up. When it kills the container's main process,
which is the usual Kubernetes OOMKill with exit code 137 and reason
`OOMKilled`, the container exits and its series disappear before the
increase is scraped. The metric never shows it.

For pod-level OOM kills, watch container restarts in
[kube-state-metrics](./kube-state-metrics.md).

### gRPC series are mostly zeros

`grpc_server_handled_total` has one series for every gRPC method and every
status code, created at start-up with value 0: 134 methods and 17 codes
make 2,278 series. With a few pods running, fewer than 20 are non-zero.
The gRPC families are most of the endpoint's series.

Only the two CRI services matter for alerting. To keep the rest out of
Scout, see [Keep gRPC metrics for CRI only](#keep-grpc-metrics-for-cri-only).

`grpc_histogram` is off by default. Turning it on adds
`grpc_server_handling_seconds` with 14 series per method, 1,876 in total.

### containerd 1.7 names

containerd 1.7 serves the same endpoint and the same `container_*` and
`grpc_server_*` names. Three image pull metrics are named without
`sandboxed`:

| containerd 1.7 | containerd 2.x |
| --- | --- |
| `containerd_cri_image_pulls_total` | `containerd_cri_sandboxed_image_pulls_total` |
| `containerd_cri_in_progress_image_pulls_total` | `containerd_cri_sandboxed_in_progress_image_pulls_total` |
| `containerd_cri_image_pulling_throughput` | `containerd_cri_sandboxed_image_pulling_throughput` |

1.7 also has no `containerd_cri_container_events_dropped_total`. It serves
four extra `containerd_cri_sandboxed_*_seconds` timers from an alternative
CRI server that is off by default; they stay empty. Queries
and alerts on the pull metrics need changing when a node moves from 1.7 to
2.x.

## Key Alerts to Configure

Thresholds are a state read, a fraction of a configured limit, or relative
to your own trailing baseline. Container start times depend on your images
and nodes, so this guide proposes no absolute latency numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0` | containerd is down, or the metrics listener or scrape path is misconfigured. |
| `grpc_server_handled_total`, CRI services, `grpc_code` not `OK` | rate above your trailing baseline | The kubelet is getting errors from the runtime. Group by `grpc_method` to see which call. |
| `containerd_cri_sandboxed_image_pulls_total{status="failure"}` | `increase(...[10m]) > 0` | Pods will sit in `ImagePullBackOff`. Check the image name, the registry and pull credentials. |
| `container_memory_usage_bytes` / `container_memory_usage_limit_bytes` | above 90% of the limit, sustained | The container is close to an OOM kill. |
| `container_cpu_nr_throttled_total` / `container_cpu_nr_periods_total` | rate ratio above your trailing baseline | The CPU limit is too low for the load. |
| `container_memory_oom_total` | `increase(...) > 0` | A process inside a running container was OOM-killed. Does not fire for main-process kills. |
| `container_pids_current` / `container_pids_limit` | above 90% of the limit | New processes will fail to start. |
| `containerd_cri_container_start_seconds` | p95 above your trailing baseline | Container starts are slowing down. |
| `containerd_cri_sandbox_create_network_seconds` | p95 above your trailing baseline | CNI is slow, and every pod start waits on it. |
| `containerd_cri_container_events_dropped_total` | `increase(...) > 0` | The kubelet may miss container state changes. |

## Access Setup

### Turn on the metrics listener

On containerd 2.3 and later, with a version 4 config:

```toml showLineNumbers title="/etc/containerd/config.toml"
version = 4

[plugins."io.containerd.server.v1.metrics"]
  address = "127.0.0.1:1338"
```

On earlier versions, or with a version 2 or 3 config:

```toml showLineNumbers title="/etc/containerd/config.toml"
[metrics]
  address = "127.0.0.1:1338"
```

The `[metrics]` table still works on 2.4 with a version 3 config.
containerd moves it to the plugin section when it loads the file.

Restart containerd to load the change. Without an address, nothing
listens on the port and containerd logs nothing about it.

The listener has no authentication. Bind it to an address only the
Collector can reach. `127.0.0.1` works when the Collector runs on the
node's host network.

### Optional: gRPC latency histograms

```toml showLineNumbers title="/etc/containerd/config.toml"
# version 4
[plugins."io.containerd.metrics.v1.grpc-prometheus"]
  grpc_histogram = true

# version 2 or 3: in the [metrics] table
#   grpc_histogram = true
```

This adds `grpc_server_handling_seconds` for every gRPC method.

## Configuration

containerd serves metrics at `/v1/metrics`. The `prometheus` receiver
scrapes `/metrics` unless told otherwise, and gets a 404, so
`metrics_path` is required.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: containerd
          scrape_interval: 15s
          metrics_path: /v1/metrics
          static_configs:
            - targets:
                - ${env:CONTAINERD_METRICS_ADDRESS}

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest`, one per
node, with the node's address in `CONTAINERD_METRICS_ADDRESS`.

### Keep gRPC metrics for CRI only

This `filter` processor drops `grpc_server_*` data points for every
service except the two CRI services, and leaves every other metric alone:

```yaml showLineNumbers title="config/otel-collector.yaml (gRPC filter)"
processors:
  filter/grpc_cri_only:
    error_mode: ignore
    metrics:
      datapoint:
        - >-
          IsMatch(metric.name, "^grpc_server_")
          and not IsMatch(attributes["grpc_service"], "^runtime\\.v1\\.")

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [filter/grpc_cri_only, resource, batch]
      exporters: [otlp_http/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
CONTAINERD_METRICS_ADDRESS=127.0.0.1:1338
SERVICE_NAME=containerd
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Collecting traces

containerd exports traces over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is
set in its environment. There is no tracing section to add to
`config.toml`. With systemd, set the variables in a drop-in:

```ini showLineNumbers title="/etc/systemd/system/containerd.service.d/otel.conf"
[Service]
Environment=OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
Environment=OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
Environment=OTEL_SERVICE_NAME=containerd
```

This assumes the Collector runs on the node's host network. Add an `otlp`
receiver and a traces pipeline to the Collector:

```yaml showLineNumbers title="config/otel-collector.yaml (traces)"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

containerd 2.4 removed the tracing keys `endpoint`, `protocol`, `insecure`,
`service_name` and `sampling_ratio` from `config.toml`. Use the `OTEL_*`
variables.

### What the traces show

Each CRI call is a server span named after the gRPC method, such as
`runtime.v1.RuntimeService/RunPodSandbox`,
`runtime.v1.RuntimeService/CreateContainer` or
`runtime.v1.ImageService/PullImage`. Under it are internal spans for the
work: `cri.sandbox.run`, `cni.setup_pod_network`, `client.NewContainer`,
`client.task.Start`, `metadata.containers.Create`, and client spans for
calls to the runtime shim, named `containerd.task.v3.Task/<Method>`.
Registry requests during a pull appear as
`remotes.docker.resolver.HTTPRequest` and
`remotes.docker.resolver.FetchToken`.

CRI spans carry `container.id`, `container.name`, `container.image.ref` and
`sandbox.id` where they apply. `PullImage` carries `image.ref`.

Four things to know:

- **Volume is dominated by shim calls.** `containerd.task.v3.Task/Stats`
  makes up about a third of all spans with a handful of pods running.
- **A failed CRI call is not an error span.** A pull of a missing image has
  `rpc.response.status_code` `NOT_FOUND` and span status `Unset`. Search on
  `rpc.response.status_code`, not on span status. The registry request
  under it does have status `Error`, with `error.type` set to the HTTP
  status.
- **Two attribute generations on one trace.** CRI spans use
  `rpc.system.name` and a named `rpc.response.status_code`. Shim spans use
  `rpc.system` and a numeric `rpc.ttrpc.status_code`.
- **OOM kills and non-zero exits produce no error spans.**
  `client.task.Delete` carries `task.exit_status`.

containerd sets up the W3C TraceContext propagator when tracing is on. A
CRI call that arrives without `traceparent` starts its own root span.

## Verify the Setup

Check the listener from the node, then the Collector:

```bash showLineNumbers
# The listener is on and serving the right path
curl -s 127.0.0.1:1338/v1/metrics | grep -c '^# TYPE'

# The Collector is scraping without errors
kubectl logs -n <collector-namespace> <collector-pod-on-this-node> \
  | grep "Failed to scrape"
```

The first command prints a family count, around 120 with a few pods
running. `curl` exiting with code 7 means the listener is off. The second
command prints nothing when the scrape works.

In Scout, filter on the service name you set. `up` should be 1,
`container_memory_usage_bytes` should have one series per running
container, and `grpc_server_handled_total` should show `runtime.v1`
services with `grpc_code` `OK`.

## Troubleshooting

### `up` is 0 and the Collector logs a 404

**Cause**: The receiver is scraping `/metrics`. containerd serves
`/v1/metrics`.

**Look at**: the Collector log for `Failed to scrape Prometheus endpoint`
with `server returned HTTP status 404 Not Found`.

**Fix**: Set `metrics_path: /v1/metrics` in the scrape config.

### `up` is 0 and the connection is refused

**Cause**: The metrics listener is off. It has no default address.

**Fix**: Set the address in `config.toml` as in
[Turn on the metrics listener](#turn-on-the-metrics-listener) and restart
containerd.

### An OOMKilled pod shows nothing in `container_memory_oom_total`

**Cause**: The main process was killed, the container exited, and its
series disappeared before the count went up.

**Fix**: Use container restarts from
[kube-state-metrics](./kube-state-metrics.md) for pod OOM kills. Keep
`container_memory_oom_total` for kills inside containers that keep
running.

### A container's series disappeared

**Cause**: The container exited. `container_*` series exist only while the
container's task runs.

**Fix**: Nothing to fix. Do not alert on a `container_id` going missing.

### The image pull alert never fires on containerd 1.7

**Cause**: containerd 1.7 names the metric `containerd_cri_image_pulls_total`.

**Fix**: Use the 1.7 names from
[containerd 1.7 names](#containerd-17-names), or upgrade.

### Series volume is higher than expected

**Cause**: `grpc_server_handled_total` has a series for every method and
status code, almost all of them zero, and `grpc_histogram` adds more.

**Fix**: Add the [gRPC filter](#keep-grpc-metrics-for-cri-only).
`grpc_histogram` adds 1,876 series on its own; turn it on when you need
per-method latency.

### Memory usage over limit reads near 0 for some containers

**Cause**: Those containers have no memory limit, and the limit reads
2^64.

**Fix**: Filter the alert to containers where
`container_memory_usage_limit_bytes` is below `1.8446744073709552e+19`.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the metrics pipeline includes both the receiver and the
   exporter.

## FAQ

### Do I need an exporter?

No. containerd serves Prometheus metrics itself. Turn on the listener and
scrape it.

### How is this different from cAdvisor or kubeletstats?

All three report per-container resources. containerd adds what only the
runtime knows: CRI errors, image pull outcomes and lifecycle latency. The
names overlap with cAdvisor: both expose `container_memory_usage_bytes`.
If you scrape both, keep them apart by job or service name.

### Why is the `namespace` label always `k8s.io`?

It is the containerd namespace, not the Kubernetes one. The kubelet
creates everything in `k8s.io`.

### Does containerd send metrics over OTLP?

No. Metrics are Prometheus only. OTLP carries traces.

## Related Guides

- [Kubelet Stats Monitoring](./kubelet-stats.md) - Per-pod and per-container
  resources from the kubelet, with pod names attached.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - Kubernetes
  object state, including container restarts, which catch the OOM kills
  containerd's counter misses.
- [cAdvisor Monitoring](./cadvisor.md) - Per-container resource metrics,
  with names that overlap containerd's `container_*` set.
- [Docker Engine Monitoring](./docker.md) - The same container resources on
  hosts that run Docker instead of a Kubernetes node.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector as a DaemonSet.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  containerd metrics.

## What's Next?

- **Create Dashboards**: Start with CRI error rate by method, image pull
  failures and memory headroom per container. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of container start time and CNI
  setup time, then fill in the relative alerts above.
- **Decide on gRPC volume**: Choose whether to keep all gRPC services
  before building dashboards on them.
