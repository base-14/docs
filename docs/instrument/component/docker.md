---
title: >
  Docker OpenTelemetry Monitoring - Container CPU, Memory, Network,
  and Collector Setup
sidebar_label: Docker Engine
id: collecting-docker-telemetry
sidebar_position: 32
description: >
  Collect per-container Docker metrics with the OpenTelemetry Collector.
  Monitor CPU, memory, block I/O, network, and container liveness with
  the docker_stats receiver and ship to base14 Scout.
keywords:
  - docker opentelemetry
  - docker otel collector
  - docker container metrics monitoring
  - docker performance monitoring
  - opentelemetry docker_stats receiver
  - docker observability
  - docker container resource usage
  - docker telemetry collection
---

# Docker Engine

The OpenTelemetry Collector's `docker_stats` receiver reads the Docker
Engine API over the mounted socket and emits 24 metrics per running
container - CPU, memory, block I/O, network, and per-container liveness
(uptime and restarts) - on Docker Engine 20.10+. It is not a Prometheus
scrape: the receiver talks to the Engine API at
`unix:///var/run/docker.sock`, not a metrics endpoint, so there is no
`up` series and no `scrape_*` meta. This guide configures the receiver,
sets up socket access, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended           |
| ---------------------- | ------- | --------------------- |
| Docker Engine          | 20.10   | 29.x (current)        |
| OTel Collector Contrib | 0.90.0  | 0.153.0               |
| base14 Scout           | Any     | -                     |

Before starting:

- Docker Engine must be running on the host where the Collector runs.
- The Collector needs read access to the Docker socket at
  `/var/run/docker.sock` (socket access is root-equivalent - see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review. All rows are native OpenTelemetry
semantic-convention `container.*` names (dotted), emitted once per
running container.

A few surface facts shape how you read these:

- **No `up`, no scrape meta.** Unlike the Prometheus-scrape components,
  there is no `up` series here - the receiver reads the Engine API, not
  a scrape endpoint. A stopped container simply disappears from the
  output. Per-container liveness is `container.uptime` (a drop toward 0
  is an unplanned restart) and `container.restarts` (a rising count is a
  crash loop).
- **Reports on every container the daemon sees.** The receiver
  enumerates all running containers. Scope it in production with the
  receiver's `excluded_images` or a `filter` processor on
  `container.name` / image to control cardinality.
- **Socket access is root-equivalent.** The Collector mounts
  `/var/run/docker.sock` read-only and must be able to read it (run as a
  user that can, for example `user: "0:0"`). Granting socket access is
  equivalent to root on the host - prefer a read-only socket proxy in
  production.
- **Limit-relative metrics need a limit.** `container.memory.percent` is
  memory used as a fraction of the container's limit; with no limit set
  it is computed against host memory and is not a true OOM-risk signal.
  `container.cpu.limit` is emitted only when a CPU quota (`--cpus` /
  `cpus:`) is set.
- **The memory breakdown is cgroup-version-dependent.** On cgroup v2 it
  is `container.memory.anon` (anonymous) + `container.memory.file` (page
  cache). cgroup-v1-only fields (`container.memory.rss`,
  `container.memory.cache`, `container.memory.swap`,
  `container.blockio.io_serviced_recursive`) are not emitted on a v2
  host.

### Core - is each container alive, stable, and not pinned

| Metric | What it tells you |
|---|---|
| `container.uptime` | Seconds since the container started. A drop toward 0 flags an unplanned restart - the closest liveness signal this receiver emits (it reads the API, so there is no scrape `up`). |
| `container.restarts` | Number of times the container has restarted. A rising count is a crash loop - the primary container-health signal. |
| `container.cpu.utilization` | Container CPU usage as a percentage of host capacity - headline compute load. |
| `container.memory.percent` | Memory used as a percentage of the container's limit - headline OOM-risk signal (meaningful only when a memory limit is set; otherwise relative to host memory). |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `container.memory.usage.total` | Current memory used by the container, in bytes. |
| `container.memory.usage.limit` | The container's memory limit in bytes; equals host memory when no limit is set. |
| `container.cpu.usage.total` | Cumulative CPU time in ns; the rate approximates cores in use. |
| `container.network.io.usage.rx_bytes` | Bytes received on container interfaces - inbound network throughput. |
| `container.network.io.usage.tx_bytes` | Bytes transmitted on container interfaces - outbound network throughput. |
| `container.network.io.usage.rx_dropped` | Inbound packets dropped - buffer saturation or backpressure. |
| `container.network.io.usage.tx_dropped` | Outbound packets dropped. |
| `container.network.io.usage.rx_errors` | Receive interface errors. |
| `container.network.io.usage.tx_errors` | Transmit interface errors. |
| `container.blockio.io_service_bytes_recursive` | Block-device I/O bytes (read + write, labeled by operation) - disk throughput. |
| `container.pids.count` | Current process / thread count in the container. |
| `container.pids.limit` | The configured pids limit; `count` approaching `limit` means fork-bomb / thread-leak risk. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. They are the drill-down behind the Core and Operational signals.

| Metric | What it tells you |
|---|---|
| `container.cpu.usage.kernelmode` | CPU time spent in kernel mode - syscall / I/O-heavy workloads. |
| `container.cpu.usage.usermode` | CPU time spent in user mode - application compute. |
| `container.cpu.usage.system` | Host system CPU time - the denominator behind utilization. |
| `container.cpu.shares` | Configured CPU weight (static config, not a live load signal). |
| `container.memory.anon` | Anonymous (heap / stack) memory, cgroup v2. |
| `container.memory.file` | Page-cache (file-backed) memory, cgroup v2. |
| `container.network.io.usage.rx_packets` | Packets received - drill-down behind the rx bytes / errors / dropped counters. |
| `container.network.io.usage.tx_packets` | Packets transmitted - drill-down behind the tx bytes / errors / dropped counters. |

Full metric reference:
[OTel Docker Stats Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/dockerstatsreceiver).
The receiver emits a default set automatically; the optional metrics
(disabled by default) are enabled in the [Configuration](#configuration)
`metrics:` block.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload. The percent-vs-limit,
count-vs-limit, and uptime-drop checks read states or ratios against the
container's own limit, not invented absolutes; the rest are relative to
your baseline.

| Metric | Threshold | Why it matters |
|---|---|---|
| `rate(container.restarts)` | > 0 | The container is crash-looping - check its logs, exit code, OOM-kills, and healthcheck. |
| `container.memory.percent` | > 90 (when a memory limit is set) | OOM-kill is imminent - raise the limit or fix the leak. Pair with `container.memory.usage.total` vs `container.memory.usage.limit`. |
| `container.cpu.utilization` | Sustained high vs baseline | The container is CPU-bound (and throttled if a CPU limit is set) - scale out or raise the quota. |
| `rate(container.network.io.usage.rx_dropped + container.network.io.usage.tx_dropped)` | > 0 | Packets are being dropped - check NIC buffers, throughput ceilings, and backpressure. |
| `rate(container.network.io.usage.rx_errors + container.network.io.usage.tx_errors)` | > 0 | Interface errors - investigate the host network and the container's veth. |
| `container.pids.count` | Approaching `container.pids.limit` | Fork bomb or thread leak - raise the pids limit or fix the process spawning. |
| `container.uptime` | Drops to near 0 unexpectedly | The container restarted outside a deploy - correlate with `container.restarts` and host events. |

## Access Setup

The `docker_stats` receiver connects to the Docker daemon through its
Unix socket. No credentials are needed, but the Collector process must
have permission to read the socket.

When running the Collector in Docker, mount the socket as a read-only
volume and run as a user that can read it:

```yaml showLineNumbers title="compose.yaml"
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.153.0
    user: "0:0"              # Run as a user that can read the socket
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./config:/etc/otelcol-contrib
    command: ["--config", "/etc/otelcol-contrib/otel-collector.yaml"]
```

On Linux, the host user must be in the `docker` group (or the Collector
runs as root). On macOS, Docker Desktop manages socket access at the same
path.

:::caution Docker socket access is root-equivalent
Read access to `/var/run/docker.sock` is equivalent to root on the host.
Always mount the socket read-only (`:ro`), exclude the Collector's own
image to avoid recursive collection, and prefer a read-only socket proxy
(for example `tecnativa/docker-socket-proxy`) in production so the
Collector only sees the container-stats endpoints, not the full daemon
API.
:::

Confirm the socket is reachable from inside the Collector container:

```bash showLineNumbers title="Verify socket access"
docker exec otel-collector ls -la /var/run/docker.sock
```

## Configuration

The `docker_stats` receiver emits a default metric set automatically. The
optional metrics the tiers above rely on - per-container liveness, the CPU
usage split, the cgroup-v2 anonymous-memory breakdown, pids, and interface
errors - are disabled by default, so enable them with a `metrics:` sub-block.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 10s
    excluded_images:
      - otel/opentelemetry-collector-contrib   # Exclude self
    metrics:
      container.uptime:
        enabled: true
      container.restarts:
        enabled: true
      container.cpu.usage.system:
        enabled: true
      container.cpu.usage.kernelmode:
        enabled: true
      container.cpu.usage.usermode:
        enabled: true
      container.cpu.shares:
        enabled: true
      container.memory.anon:
        enabled: true
      container.pids.count:
        enabled: true
      container.pids.limit:
        enabled: true
      container.network.io.usage.rx_errors:
        enabled: true
      container.network.io.usage.tx_errors:
        enabled: true

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
      receivers: [docker_stats]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Scoping which containers emit series

The receiver reports on every container the daemon sees, so on a busy
host the series count scales with container density (and short-lived
containers add churn). Scope it to the containers you care about:

- `excluded_images` on the receiver drops containers by image name. Each
  entry matches as a literal string, a glob (entries with `*`, `?`, `[]`,
  or `{}`), or a regex (wrapped in `/`), and a leading `!` negates the
  match.
- A `filter` processor in the pipeline keeps or drops by
  `container.name` or image with full match expressions.
- `container_labels_to_metric_labels` promotes Docker labels into
  resource attributes, which a `filter` processor can then match on:

```yaml showLineNumbers title="config/otel-collector.yaml (receiver section)"
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 10s
    excluded_images:
      - otel/opentelemetry-collector-contrib
    container_labels_to_metric_labels:
      com.docker.compose.service: compose_service
```

Each metric also carries `container.id`, `container.name`,
`container.image.name`, `container.runtime`, and `container.hostname`
resource attributes that identify the source container.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify collector and Docker metrics"
# Check Collector logs for a successful start / connection
docker logs otel-collector 2>&1 | grep -i "docker"

# Verify the socket is mounted and readable
docker exec otel-collector ls -la /var/run/docker.sock

# Confirm per-container metrics are flowing
docker logs otel-collector 2>&1 | grep "container."
```

## Troubleshooting

### Permission denied on the Docker socket

**Cause**: The Collector process cannot read `/var/run/docker.sock`.

**Fix**:

1. Verify the socket is mounted:
   `docker exec otel-collector ls -la /var/run/docker.sock`.
2. Run the Collector as a user that can read the socket - add
   `user: "0:0"` to the service definition, or use a read-only socket
   proxy that the Collector reads over TCP.
3. On Linux, confirm the host user is in the `docker` group:
   `groups $(whoami)`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `docker_stats` receiver and
   the `otlphttp/b14` exporter.

### Too many containers reported

**Cause**: The receiver enumerates every running container the daemon
sees, including system and sidecar containers you do not need to monitor,
which inflates the series count.

**Fix**:

1. Add image prefixes to `excluded_images` on the receiver.
2. Add a `filter` processor on `container.name` or image to keep only the
   containers you care about.
3. Promote a Docker label with `container_labels_to_metric_labels` and
   filter on it (for example keep one Compose project).

### `container.cpu.limit` or `container.memory.percent` looks meaningless

**Cause**: These metrics are limit-relative. `container.cpu.limit` is
emitted only when the container has a CPU quota (`--cpus` / `cpus:`), and
`container.memory.percent` is computed against host memory when no memory
limit is set - so it is not a true OOM-risk signal there.

**Look at**: `container.memory.usage.total` vs
`container.memory.usage.limit` to see whether a per-container memory limit
is actually configured.

**Fix**:

1. Set a memory limit (`--memory` / `mem_limit:`) so
   `container.memory.percent` reads against the container's own ceiling.
2. Set a CPU quota (`--cpus` / `cpus:`) if you want `container.cpu.limit`
   and meaningful throttling context.

### cgroup-v1 memory or block I/O fields are missing

**Cause**: The memory and block-I/O breakdown is cgroup-version-dependent.
On a cgroup v2 host, the v1-only fields (`container.memory.rss`,
`container.memory.cache`, `container.memory.swap`,
`container.blockio.io_serviced_recursive`) are not emitted.

**Look at**: the cgroup-v2 equivalents - `container.memory.anon`
(anonymous) and `container.memory.file` (page cache) for the memory
breakdown.

**Fix**: Use the v2 fields in your dashboards and alerts on a v2 host; do
not expect the v1-only series to appear.

## FAQ

**Does this work in Kubernetes?**

Prefer the `kubeletstats` receiver or cAdvisor for per-container metrics
in Kubernetes. The `docker_stats` receiver targets the Docker daemon
socket on a host, and on a containerd-based cluster there is no Docker
socket to read.

**How do I monitor multiple Docker hosts?**

Run one Collector per Docker host, each with a `docker_stats` receiver
pointed at that host's local socket. The `container.hostname` resource
attribute distinguishes the source host in Scout.

**Why is there no `up` metric?**

The receiver reads the Docker Engine API, not a scrape endpoint, so there
is no scrape `up` series. A stopped container disappears from the output.
Read liveness from `container.uptime` (a drop toward 0 is an unplanned
restart) and `container.restarts` (a rising count is a crash loop).

**Is mounting the Docker socket a security risk?**

Yes - read access to `/var/run/docker.sock` is equivalent to root on the
host. Mount it read-only (`:ro`), exclude the Collector's own image to
avoid recursive collection, and prefer a read-only socket proxy in
production so the Collector reaches only the container-stats endpoints.

## Related Guides

- [cAdvisor Monitoring](./cadvisor.md) - Per-container metrics from
  cAdvisor's Prometheus surface, the usual choice on Kubernetes nodes.
- [Nginx Monitoring](./nginx.md) - A common containerized companion to
  monitor alongside.
- [Redis Monitoring](./redis.md) - Monitor Redis running in your Docker
  environment.
- [PostgreSQL Monitoring](./postgres.md) - Monitor PostgreSQL running in
  your Docker environment.
- [OTel Collector Docker Compose Setup](../collector-setup/docker-compose-example.md)
  - Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  Docker container metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [PostgreSQL](./postgres.md), and other components
  running in your Docker environment.
- **Fine-tune Collection**: Scope the receiver with `excluded_images` or a
  `filter` processor to match your container density, and reach for the
  Diagnostic tier during incident investigation.
