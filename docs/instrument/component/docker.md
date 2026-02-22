---
title: >
  Docker OpenTelemetry Monitoring — Container CPU, Memory,
  and Collector Setup
sidebar_label: Docker Engine
id: collecting-docker-telemetry
sidebar_position: 32
description: >
  Collect Docker container metrics with the OpenTelemetry
  Collector. Monitor CPU, memory, block I/O, and network
  per container using the docker_stats receiver.
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

The OpenTelemetry Collector's `docker_stats` receiver collects
13+ metrics per container from Docker Engine 20.10+, including
CPU usage, memory utilization, block I/O throughput, and network
bytes. Linux hosts with full cgroups support expose up to 80+
metrics. This guide configures the receiver, sets up Docker
socket access, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended  |
| ---------------------- | ------- | ------------ |
| Docker Engine          | 20.10   | 24.0+        |
| OTel Collector Contrib | 0.90.0  | latest       |
| base14 Scout           | Any     | —            |

Before starting:

- Docker Engine must be running on the host where the
  Collector runs
- The Collector needs access to the Docker socket at
  `/var/run/docker.sock`
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **CPU**: usage total, kernel mode, user mode, utilization
- **Memory**: usage total, usage limit, percent used,
  file-backed memory
- **Block I/O**: service bytes read/write per device
- **Network**: received bytes, transmitted bytes,
  dropped packets (rx/tx)
- **Container lifecycle** (Linux): restart count, uptime,
  PID count

Linux hosts with full cgroups support expose additional
metrics including per-CPU usage, CPU throttling, memory
cache/RSS/page faults, and detailed block I/O queuing.

Full metric reference:
[OTel Docker Stats Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/dockerstatsreceiver)

## Access Setup

The `docker_stats` receiver connects to the Docker daemon
through its Unix socket. No credentials are needed, but the
Collector process must have permission to read the socket.

**On Linux**: the Collector must run as root or as a user in
the `docker` group.

**On macOS**: Docker Desktop manages socket access — no
extra configuration needed.

When running the Collector in Docker, mount the socket as a
read-only volume:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    user: "0:0"              # Run as root for socket access
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./config:/etc/otelcol-contrib
    command: ["--config", "/etc/otelcol-contrib/otel-collector.yaml"]
```

:::caution Docker socket security
Docker socket access grants full control over the Docker
daemon. Always mount the socket as read-only (`:ro`) and
exclude the Collector's own image from monitoring to avoid
recursive metric collection.
:::

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 10s
    excluded_images:
      - otel/opentelemetry-collector-contrib  # Exclude self

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

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [docker_stats]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering and Labels

Use `excluded_images` to skip containers you don't want to
monitor. Use `container_labels_to_metric_labels` to promote
Docker labels into metric resource attributes:

```yaml showLineNumbers title="config/otel-collector.yaml (receiver section)"
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 10s
    excluded_images:
      - otel/opentelemetry-collector-contrib
      - grafana/grafana
    container_labels_to_metric_labels:
      com.docker.compose.service: compose_service
```

### Resource Attributes

Each metric includes resource attributes that identify the
source container:

- `container.id` — full container ID
- `container.name` — container name
- `container.image.name` — image name
- `container.hostname` — container hostname
- `container.runtime` — always `docker`

### Metrics Reference

**Core metrics** (available on all platforms):

| Category | Metrics |
| -------- | ------- |
| CPU | `container.cpu.usage.total`, `container.cpu.usage.kernelmode`, `container.cpu.usage.usermode`, `container.cpu.utilization` |
| Memory | `container.memory.usage.total`, `container.memory.usage.limit`, `container.memory.percent`, `container.memory.file` |
| Block I/O | `container.blockio.io_service_bytes_recursive` |
| Network | `container.network.io.usage.rx_bytes`, `container.network.io.usage.rx_dropped`, `container.network.io.usage.tx_bytes`, `container.network.io.usage.tx_dropped` |

**Additional metrics on Linux with full cgroups support:**

- **CPU**: per-CPU usage, throttling periods/time, CPU shares,
  CPU limit
- **Memory**: cache, RSS, page faults, active/inactive
  anonymous and file pages (37 memory metrics total)
- **Block I/O**: queued operations, I/O time, wait time,
  merged operations (8 block I/O metrics)
- **Network**: rx/tx errors, rx/tx packets
- **Container**: PID count, PID limit, restart count, uptime

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify collector and Docker metrics"
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "docker"

# Verify the socket is accessible
docker exec otel-collector \
  ls -la /var/run/docker.sock

# Confirm containers are being monitored
docker logs otel-collector 2>&1 | grep "container."
```

## Troubleshooting

### Permission denied on Docker socket

**Cause**: The Collector process cannot read
`/var/run/docker.sock`.

**Fix**:

1. Verify the socket is mounted:
   `docker exec otel-collector ls -la /var/run/docker.sock`
2. Add `user: "0:0"` to your Docker Compose service
   definition
3. On Linux, confirm the host user is in the `docker` group:
   `groups $(whoami)`

### No metrics from specific containers

**Cause**: Containers are excluded by image name or are not
running.

**Fix**:

1. Check `excluded_images` in your config — patterns match
   against the image name
2. Verify the container is running: `docker ps`
3. Short-lived containers may stop before the next collection
   interval

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and
   exporter

### Fewer metrics than expected

**Cause**: macOS Docker Desktop or older Docker versions
expose fewer cgroup-level metrics.

**Fix**:

1. On macOS, 13+ core metrics are expected — this is normal
2. On Linux, verify cgroups v2 is enabled:
   `stat -fc %T /sys/fs/cgroup/`
3. Upgrade Docker Engine to 24.0+ for the widest metric
   coverage

## FAQ

**Does this work on macOS with Docker Desktop?**

Yes. Docker Desktop exposes the Docker socket at the same
path (`/var/run/docker.sock`). You get 13+ core metrics per
container covering CPU, memory, block I/O, and network.
Linux hosts expose additional cgroup-level detail (up to
80+ metrics).

**How do I filter which containers are monitored?**

Use `excluded_images` in the receiver config to skip
containers by image name. The pattern matches against
the full image name without the tag. You cannot use glob
patterns — each entry is an exact prefix match.

**Is mounting the Docker socket a security risk?**

The Docker socket grants broad access to the Docker daemon.
Mitigate this by mounting it as read-only (`:ro`), running
the Collector with minimal additional privileges, and
excluding the Collector's own image from monitoring to
avoid recursive data collection.

**How do I add Docker container labels as metric attributes?**

Use the `container_labels_to_metric_labels` option to map
Docker labels to metric resource attributes:

```yaml showLineNumbers title="config/otel-collector.yaml (receiver section)"
receivers:
  docker_stats:
    container_labels_to_metric_labels:
      com.docker.compose.service: compose_service
      app.team: team
```

**Does this work with Podman instead of Docker?**

The `docker_stats` receiver is Docker-specific. For Podman,
point the endpoint to the Podman socket path
(`unix:///run/podman/podman.sock`) — compatibility varies
by Podman version and API parity with Docker.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or
  build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [PostgreSQL](./postgres.md),
  and other components running in your Docker environment
- **Fine-tune Collection**: Adjust `collection_interval`
  and `excluded_images` based on your container density

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) —
  Production deployment with Helm
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) —
  Alert on Docker container metrics
