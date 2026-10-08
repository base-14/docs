---
title: >
  CRI-O OpenTelemetry Monitoring - CRI Errors, Image Pulls, OOM Kills,
  Traces, and Collector Setup
sidebar_label: CRI-O
id: collecting-crio-telemetry
sidebar_position: 78
description: >
  Scrape CRI-O metrics and collect CRI traces with the OpenTelemetry
  Collector. Monitor CRI call errors, image pull failures, OOM kills and
  pod start latency in base14 Scout.
keywords:
  - cri-o opentelemetry
  - cri-o otel collector
  - cri-o metrics monitoring
  - crio metrics
  - container_runtime_crio
  - cri-o image pull failures
  - cri-o tracing
  - openshift container runtime monitoring
  - cri-o observability
---

# CRI-O

CRI-O serves Prometheus metrics from its own HTTP listener, with no
exporter to install. The listener is off by default. Turn it on in a
`crio.conf.d` drop-in, point the Collector's `prometheus` receiver at it,
and you get CRI-O's view of CRI calls, image pulls and OOM kills under the
`container_runtime_crio_` prefix, plus the daemon's Go runtime and process
metrics. CRI-O can also push traces of every CRI call over OTLP gRPC, with
its log lines attached as span events. This guide covers the CRI-O the
kubelet talks to on a Kubernetes node: turning the listener on, the
Collector configuration, and shipping to base14 Scout.

CRI-O reports what the runtime does. It does not report CPU, memory or
I/O per container; for those, see
[Kubelet Stats Monitoring](./kubelet-stats.md) or
[cAdvisor Monitoring](./cadvisor.md). For nodes on containerd, see
[containerd Monitoring](./containerd.md).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| CRI-O                  | 1.34    | 1.37        |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The minimum is the oldest stream CRI-O still publishes packages for, not
a floor the metrics were checked against. The metric names in this guide
are the 1.37 names; see
[The prefix is `container_runtime_crio_`](#the-prefix-is-container_runtime_crio_).

The Collector floor is about component names: the `otlp_http` exporter was
`otlphttp` before contrib 0.149.0.

Before starting:

- Access to each node's CRI-O configuration, `/etc/crio/crio.conf` and
  the `/etc/crio/crio.conf.d/` directory, and permission to restart CRI-O.
- A Collector that can reach the metrics address on every node, typically
  a DaemonSet on the host network.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

Expect around 60 metric families and about a hundred series per node. The
CRI-O families are a dozen; the rest are Go runtime, process and
log-writer metrics.

### Core - is the runtime answering the kubelet

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 when the Collector scraped CRI-O. 0 when CRI-O is down or the listener is off. |
| `container_runtime_crio_operations_errors_total` | counter | CRI calls that failed, by `operation`. The kubelet's error rate against the runtime. |
| `container_runtime_crio_image_pulls_failure_total` | counter | Image pulls that failed, by the registry's `error` code. |
| `container_runtime_crio_containers_oom_total` | counter | Containers killed for memory, including kills of the main process. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `container_runtime_crio_operations_total` | counter | CRI calls by `operation`, such as `RunPodSandbox`, `PullImage` or `ListContainers`. The denominator for the error ratio. |
| `container_runtime_crio_operations_latency_seconds_total` | summary | CRI call latency per `operation`, as `_sum`, `_count` and quantiles. `RunPodSandbox` and `PullImage` are the ones to watch. |
| `container_runtime_crio_image_pulls_success_total` | counter | Pulls that completed. |
| `container_runtime_crio_containers_oom_count_total` | counter | OOM kills by container `name`, the join key to the pod. |
| `container_runtime_crio_processes_defunct` | gauge | Zombie processes on the node. |
| `container_runtime_crio_containers_events_dropped_total` | counter | Container events CRI-O discarded, which the kubelet then missed. |
| `container_runtime_crio_default_runtime` | gauge | The configured OCI runtime, in the `runtime` label. Always 1. |
| `process_resident_memory_bytes`, `process_cpu_seconds_total`, `process_open_fds` | gauge, counter, gauge | The `crio` daemon itself. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `container_runtime_crio_operations_latency_seconds` | Latency of the last call per `operation`, a gauge with no history. |
| `container_runtime_crio_image_pulls_layer_size` | Histogram of bytes pulled per layer. Reads 0 on 1.37; see below. |
| `containerd_cri_input_bytes_total`, `containerd_cri_output_bytes_total` and the `_entries_total` counters | Container log I/O counters from the log writer CRI-O shares with containerd. Read 0 on 1.37. |
| `go_*`, other `process_*` | Runtime stats for the `crio` process. |

### The prefix is `container_runtime_crio_`

Every CRI-O family is `container_runtime_crio_<name>`. CRI-O's own metrics
tutorial lists them as bare `crio_*` names, which the daemon does not
serve. The
`metrics_collectors` setting, which picks the collectors to enable, takes
the bare names without either prefix: `operations_total`,
`image_pulls_failure_total` and so on. By default all eighteen are on.

### Six collectors register on first use

`container_runtime_crio_image_pulls_bytes_total`,
`container_runtime_crio_image_pulls_skipped_bytes_total`,
`container_runtime_crio_image_layer_reuse_total`,
`container_runtime_crio_containers_seccomp_notifier_count_total`,
`container_runtime_crio_resources_stalled_at_stage` and
`container_runtime_crio_containers_stopped_monitor_count` have no series
until their first event. A dashboard panel on them is empty on a fresh
node, not broken. On 1.37 the first three do not appear even after pulls,
and `container_runtime_crio_image_pulls_layer_size` records a count of 0,
so the per-pull byte accounting is not usable on that release.

### Log counters with the containerd prefix

CRI-O writes container logs with the same library as containerd's CRI
plugin, and the library registers its counters under `containerd_cri_`.
On CRI-O 1.37 they read 0. A Collector that scrapes both containerd and
CRI-O nodes sees these names from both; keep them apart by job or service
name.

### OOM kills of the main process are counted

`container_runtime_crio_containers_oom_total` goes up when the kernel
kills a container's main process, the usual Kubernetes OOMKill. This is
the opposite of containerd, whose counter misses the main-process kill.
`container_runtime_crio_containers_oom_count_total` names the container;
it does not record every kill the total counts.

### The `operation` label is the CRI method

`operation` holds the method without the service name: `Version`,
`RunPodSandbox`, `CreateContainer`, `StartContainer`, `PullImage`,
`ImageFsInfo`, `ListContainerStats`. `Version` is the most frequent
operation, so group the other operations separately in dashboards and
alerts.

## Key Alerts to Configure

Thresholds are a state read or relative to your own trailing baseline.
Pod start and pull times depend on your images and registries, so this
guide proposes no absolute latency numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0` | CRI-O is down, or the metrics listener is off or bound where the Collector cannot reach it. |
| `container_runtime_crio_operations_errors_total` | `increase(...[10m]) > 0`, by `operation` | A CRI call is failing. `PullImage` points at the registry, `RunPodSandbox` at CNI or the runtime. |
| `container_runtime_crio_image_pulls_failure_total` | `increase(...[10m]) > 0`, by `error` | Pods will sit in `ImagePullBackOff`. `MANIFEST_UNKNOWN` is a bad tag; check the image name, the registry and pull credentials. |
| `container_runtime_crio_containers_oom_total` | `increase(...[10m]) > 0` | A container was killed for memory. Join on the by-name counter to find it. |
| `container_runtime_crio_processes_defunct` | above your node's normal, sustained | Zombie processes are accumulating under the container monitor. |
| `container_runtime_crio_operations_latency_seconds_total`, `operation="RunPodSandbox"` | rate of `_sum` over `_count` above your trailing baseline | Pod starts are slowing down. Compare with the CNI setup in traces. |
| `container_runtime_crio_containers_events_dropped_total` | `increase(...[10m]) > 0` | The kubelet may miss container state changes. |

## Access Setup

### Turn on the metrics listener

CRI-O reads `/etc/crio/crio.conf` and then every file in
`/etc/crio/crio.conf.d/` in name order. Add a drop-in:

```toml showLineNumbers title="/etc/crio/crio.conf.d/10-metrics.conf"
[crio.metrics]
enable_metrics = true
metrics_host = "127.0.0.1"
metrics_port = 9090
```

Restart CRI-O to load the change. Without `enable_metrics`, nothing
listens on the port.

The listener has no authentication. `127.0.0.1`, the default, works when
the Collector runs on the node's host network. Set `metrics_host` to the
node address only when the Collector is a pod on the cluster network, or
use `metrics_socket` for a Unix socket. `metrics_cert` and `metrics_key`
switch the listener to HTTPS. The same settings exist as the
`--enable-metrics`, `--metrics-host` and `--metrics-port` flags.

## Configuration

CRI-O serves metrics at `/metrics`, the receiver's default path:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: crio
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:CRIO_METRICS_ADDRESS}

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
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

Run the Collector on `otel/opentelemetry-collector-contrib:latest`, one
per node on the host network, with the listener address in
`CRIO_METRICS_ADDRESS`.

### Environment Variables

```bash showLineNumbers title=".env"
CRIO_METRICS_ADDRESS=127.0.0.1:9090
SERVICE_NAME=crio
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Collecting traces

CRI-O exports traces over OTLP gRPC when tracing is enabled in its
configuration. Add a second drop-in, or extend the first:

```toml showLineNumbers title="/etc/crio/crio.conf.d/20-tracing.conf"
[crio.tracing]
enable_tracing = true
tracing_endpoint = "127.0.0.1:4317"
tracing_sampling_rate_per_million = 1000000
```

`127.0.0.1:4317` is the default endpoint. The sampling rate is the only
control: `1000000` records every span, lower values keep that fraction of
all spans, and there is no way to pick operations. CRI-O keeps no
on-disk buffer; spans it cannot deliver while the Collector is
unreachable are lost.

Add an `otlp` receiver bound to the node and a traces pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml (traces)"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

### What the traces show

Each CRI call is a server span named after the gRPC method, such as
`runtime.v1.RuntimeService/RunPodSandbox` or
`runtime.v1.ImageService/PullImage`, with `rpc.system.name`,
`rpc.method`, `rpc.response.status_code` and `server.address`. CRI-O
opens a second span for the same call named with a leading slash, so each
call appears twice.

Under them are internal spans named after CRI-O's Go functions:
`github.com/cri-o/cri-o/server.(*Server).runPodSandbox`,
`github.com/cri-o/cri-o/server.(*Server).networkStart`,
`github.com/cri-o/cri-o/internal/oci.(*runtimeOCI).CreateContainer`,
`github.com/cri-o/cri-o/internal/config/seccomp.(*Config).Setup` and so
on. They carry `sandboxID`, `containerID`, `name` and `description`.

Three things to know:

- **CRI-O's log lines ride on the spans.** Each span carries `log` events
  with `log.severity` and `log.message`, such as `Pulling image:
  docker.io/library/busybox:1.37`. There is no separate logs signal; this
  is how CRI-O correlates logs to traces.
- **A failed pull is an error span.** `runtime.v1.ImageService/PullImage`
  for a missing image has span status `Error` and an `error` attribute
  with the registry's code, `MANIFEST_UNKNOWN`. Unlike containerd, you can
  search on span status.
- **`Version` is the most frequent server span.** Lower the sampling rate
  on busy nodes, or drop those spans in the Collector.

## Verify the Setup

Check the listener from the node, then the Collector:

```bash showLineNumbers
# The listener is on
curl -s 127.0.0.1:9090/metrics | grep -c '^# TYPE container_runtime_crio'

# The Collector is scraping without errors
kubectl logs -n <collector-namespace> <collector-pod-on-this-node> \
  | grep "Failed to scrape"
```

The first command prints the number of CRI-O families, about a dozen.
`curl` exiting with code 7 means the listener is off. The second command
prints nothing when the scrape works.

In Scout, filter on the service name you set. `up` should be 1,
`container_runtime_crio_operations_total` should be rising, and
`container_runtime_crio_default_runtime` should carry your runtime's name,
`crun` or `runc`.

## Troubleshooting

### `up` is 0 and the connection is refused

**Cause**: `enable_metrics` is off, or the listener binds `127.0.0.1` and
the Collector is not on the host network.

**Fix**: Add the drop-in from
[Turn on the metrics listener](#turn-on-the-metrics-listener), set
`metrics_host` if the Collector is a cluster pod, and restart CRI-O.

### The dashboard uses `crio_*` names and shows nothing

**Cause**: The names are `container_runtime_crio_*`. The upstream tutorial
lists the bare names.

**Fix**: Prefix every name with `container_runtime_`.

### Image pull byte metrics are missing

**Cause**: `container_runtime_crio_image_pulls_bytes_total` and its
companions register on first use, and on 1.37 they do not.

**Fix**: Use `container_runtime_crio_image_pulls_success_total` and
`container_runtime_crio_image_pulls_failure_total` for pull outcomes, and
the `PullImage` latency summary for duration.

### A collector named in `metrics_collectors` has no effect

**Cause**: The setting takes the bare collector names.

**Fix**: Write `operations_total`, not
`container_runtime_crio_operations_total`.

### No spans arrive

**Cause**: `enable_tracing` is off, the sampling rate is unset, or the
Collector was unreachable, in which case the spans were lost.

**Fix**: Set both keys in the drop-in, restart CRI-O, and check the
Collector was listening on 4317 first.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the metrics pipeline includes both the receiver and the
   exporter.

## FAQ

### Do I need an exporter?

No. CRI-O serves Prometheus metrics itself. Turn on the listener and
scrape it.

### Where are the per-container CPU and memory metrics?

Not in CRI-O. It reports runtime operations, pulls and OOM kills. Use
[Kubelet Stats Monitoring](./kubelet-stats.md) for per-pod resources with
pod names, or [cAdvisor Monitoring](./cadvisor.md).

### How is this different from containerd?

containerd reports per-container cgroup stats and gRPC counters and
serves them at `/v1/metrics`; CRI-O reports CRI operations and pulls
under one prefix at `/metrics`, and counts main-process OOM kills, which
containerd does not. Both push CRI traces over OTLP, containerd over HTTP
through environment variables and CRI-O over gRPC through its
configuration.

### Does CRI-O send metrics over OTLP?

No. Metrics are Prometheus only. OTLP carries traces, and logs only as
events on those traces.

## Related Guides

- [containerd Monitoring](./containerd.md) - The other CRI runtime.
- [Kubelet Stats Monitoring](./kubelet-stats.md) - Per-pod and
  per-container resources from the kubelet, with pod names attached.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - Kubernetes
  object state, including container restarts.
- [cAdvisor Monitoring](./cadvisor.md) - Per-container resource metrics.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector as a DaemonSet.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  CRI-O metrics.

## What's Next?

- **Create Dashboards**: Start with CRI error rate by operation, image
  pull failures by error code and OOM kills by container. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of `RunPodSandbox` and
  `PullImage` latency, then fill in the relative alerts above.
- **Add container resources**: Pair this guide with kubelet stats for CPU
  and memory per pod.
