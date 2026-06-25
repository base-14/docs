---
title: >
  Apache HTTP Server OpenTelemetry Monitoring - Request Rate, Worker
  Saturation, and Collector Setup
sidebar_label: Apache HTTP Server
id: collecting-apache-httpd-telemetry
sidebar_position: 11
description: >
  Collect Apache HTTP Server metrics with the OpenTelemetry Collector.
  Monitor request rate, worker saturation, CPU load, and traffic
  throughput from mod_status and ship to base14 Scout.
keywords:
  - apache opentelemetry
  - apache httpd otel collector
  - apache metrics monitoring
  - apache performance monitoring
  - opentelemetry apache receiver
  - apache httpd observability
  - monitor apache kubernetes
  - apache telemetry collection
---

# Apache HTTP Server

The OpenTelemetry Collector's `apache` receiver scrapes Apache's
`mod_status` page to collect 13 metrics from Apache HTTP Server 2.4+ -
request throughput, worker busy/idle saturation, scoreboard slot states,
CPU load, traffic volume, and host load averages. The receiver reads
`http://<host>:80/server-status?auto` over plain HTTP, so there is no
exporter sidecar and no JMX to run. This guide enables `mod_status`,
configures the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Apache HTTP Server     | 2.4     | 2.4.68      |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Apache HTTP Server 2.4+ running with `mod_status` loaded and reachable
  from the host running the Collector.
- `ExtendedStatus On` and a `/server-status` handler (see Access Setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review. All 13 metrics here come from the `apache` receiver and
are enabled by default - no per-metric configuration is needed to collect
them.

The receiver emits no `up` metric. A live `rate(apache.requests)` is the
liveness proxy: if it goes to zero while traffic is expected, the server
is not serving.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `apache.requests` | Requests serviced. The rate is the throughput KPI and the liveness proxy - the receiver has no `up`. |
| `apache.workers` (`state` busy/idle) | Workers busy vs idle - the primary Apache capacity and saturation signal. Worker exhaustion is the defining scaling limit. |
| `apache.traffic` | Total bytes served - data-plane throughput volume. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `apache.scoreboard` (`state`) | Workers per state (open / waiting / reading / sending / keepalive / ...). `open` approaching 0 means out of worker slots. |
| `apache.current_connections` | Active connections attached to the server - connection load. |
| `apache.connections.async` (`state`) | Async connections by state on the event MPM (writing / keepalive / closing) - connection backpressure. |
| `apache.cpu.load` | Current CPU load of the server process. |
| `apache.request.time` | Total time handling requests. Read as `rate(apache.request.time) / rate(apache.requests)` for mean per-request handling time. |
| `apache.load.1` | Host load average over the last 1 minute - responsive saturation signal. |

### Diagnostic - for investigation and tuning

Higher cardinality or slower-moving context; reach for these during an
incident rather than paging on them. You can drop this tier in production
to control metric volume and keep Core + Operational.

| Metric | When you reach for it |
|---|---|
| `apache.cpu.time` (`level` self/children × `mode` system/user) | Fine-grained CPU attribution by mode and level when CPU load is high. |
| `apache.load.5` | Host load average over 5 minutes - trend context. |
| `apache.load.15` | Host load average over 15 minutes - trend context. |
| `apache.uptime` | Server uptime in seconds. A reset flags a restart; read alongside an incident. |

Full metric reference:
[OTel Apache Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/apachereceiver).

Apache reports host load averages (`apache.load.1` / `.5` / `.15`) only
where the OS exposes them - they populate on Linux and may read zero on
macOS or Windows. Use OS-level monitoring for load averages there.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload.

| Alert | Threshold | Why it matters |
|---|---|---|
| Worker pool exhausted | `apache.scoreboard{state="open"}` approaching 0, or busy / total workers approaching 1.0 | All worker slots in use; new requests queue or are refused. Raise `MaxRequestWorkers` or scale out. |
| Serving stalled | `rate(apache.requests)` → 0 while traffic is expected | Server not handling requests; check the process, `mod_status`, and upstream. |
| Request handling slowing | `rate(apache.request.time) / rate(apache.requests)` rising vs baseline | Mean per-request handling time climbing; check backends, CPU, and worker contention. |
| CPU saturation | `apache.cpu.load` (or `apache.load.1`) sustained high vs baseline | Server is CPU-bound; profile handlers, enable caching, or add capacity. |
| Connection backpressure | `apache.connections.async{state="closing"}` / `{state="writing"}` climbing vs baseline | Event-MPM connections backing up; check slow clients, keepalive tuning, and downstream latency. |

## Access Setup

The `apache` receiver scrapes Apache's own `mod_status` page, so the
"monitoring account" here is the status endpoint itself: it must be
enabled, report extended counters, and be reachable by the Collector.

Enable `mod_status` with `ExtendedStatus On` and expose the
`/server-status` handler:

```apacheconf showLineNumbers title="httpd-status.conf"
# mod_status is loaded by default in most builds (including the official
# Docker image). If not, load it first:
# LoadModule status_module modules/mod_status.so

# Report the full counter set, not just basic status
ExtendedStatus On

<Location "/server-status">
    SetHandler server-status
    # Restrict to the Collector's network - do not expose publicly
    Require ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
</Location>
```

`ExtendedStatus On` is required: without it the page omits the per-request
and CPU counters, and several metrics read zero. Restrict the
`<Location>` to the Collector's source network with `Require ip` (use the
container network CIDR for Docker) rather than serving `/server-status`
publicly - it exposes per-worker request detail.

Confirm the endpoint returns machine-readable output:

```bash showLineNumbers title="Verify access"
# mod_status loaded?
apachectl -M 2>&1 | grep status

# Auto (machine-readable) format - expect Total Accesses, CPULoad, ReqPerSec
curl -s http://localhost:80/server-status?auto
```

## Configuration

The `apache` receiver collects all 13 metrics by default, so the receiver
block needs only the endpoint and collection interval - there are no
per-metric `metrics:` overrides to set.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  apache:
    endpoint: http://localhost:80/server-status?auto   # Change to your Apache URL
    collection_interval: 10s

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
      receivers: [apache]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic-tier metrics
(`apache.cpu.time`, `apache.load.5`, `apache.load.15`, `apache.uptime`)
with a `filter` processor while keeping Core and Operational.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Collector picked up the receiver
docker logs otel-collector 2>&1 | grep -i "apache"

# server-status responds in machine-readable form
curl -s http://localhost:80/server-status?auto

# Generate traffic so request, worker, and scoreboard signals advance
curl -s http://localhost:80/ > /dev/null
```

## Troubleshooting

### 403 Forbidden on server-status

**Cause**: The `Require` directive restricts access and the Collector's IP
is not allowed.

**Fix**:

1. Add the Collector's IP to the `Require ip` list in the `<Location>`
   block.
2. For Docker setups, use the container network CIDR
   (e.g., `Require ip 172.16.0.0/12`).
3. Reload Apache after changing the config: `apachectl graceful`.

### No metrics or partial metrics

**Cause**: `ExtendedStatus` is off, so the page omits the per-request and
CPU counters and several metrics read zero.

**Fix**:

1. Add `ExtendedStatus On` before the `<Location>` block.
2. Confirm `curl -s http://localhost:80/server-status?auto` includes
   `Total Accesses`, `CPULoad`, and `ReqPerSec`.
3. Reload Apache: `apachectl graceful`.

### Requests are slow or piling up

**Cause**: The worker pool is saturated, or the CPU is the bottleneck.

**Look at**: `apache.scoreboard{state="open"}` (free slots) and the
busy / total ratio from `apache.workers` for worker exhaustion;
`apache.cpu.time` (by `mode` / `level`) to see whether system or user CPU
dominates; and `apache.connections.async{state="closing"}` /
`{state="writing"}` for event-MPM backpressure.

**Fix**:

1. Raise `MaxRequestWorkers` or scale out if `open` slots approach 0.
2. Profile handlers or enable caching if `apache.cpu.time` shows the
   server is CPU-bound.
3. Investigate slow clients, keepalive tuning, and downstream latency if
   async connections back up.

### Load average metrics read zero

**Cause**: `apache.load.1` / `.5` / `.15` depend on system load averages
that Apache surfaces only where the OS exposes them.

**Look at**: `apache.load.1` for the responsive signal, `apache.load.5` /
`apache.load.15` for trend - all three read zero where the OS does not
report load.

**Fix**:

1. These populate on Linux. On macOS or Windows they may read zero - this
   is expected.
2. Use OS-level monitoring for load averages on non-Linux platforms.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why is there no `up` metric for Apache?**

The `apache` receiver does not emit one. Use `rate(apache.requests)` as
the liveness proxy - a live request rate means the server is handling
traffic; a drop to zero while traffic is expected means it is not.

**Do I need to enable any metrics explicitly?**

No. All 13 `apache` receiver metrics are on by default, so the receiver
block needs only the `endpoint` and `collection_interval`. To reduce metric
volume, drop tiers you do not need with a `filter` processor (see
Configuration).

**Does this work with Apache running in Kubernetes?**

Yes. Set `endpoint` to the Apache service DNS
(e.g., `http://apache.default.svc.cluster.local:80/server-status?auto`)
and make sure the `<Location>` `Require` allows the Collector pod's
network. The Collector can run as a sidecar or DaemonSet.

**How do I monitor multiple Apache instances?**

Add multiple receiver blocks with distinct names, then include both in the
pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  apache/web1:
    endpoint: http://web-1:80/server-status?auto
  apache/web2:
    endpoint: http://web-2:80/server-status?auto

service:
  pipelines:
    metrics:
      receivers: [apache/web1, apache/web2]
```

**What is the scoreboard metric?**

`apache.scoreboard` reports how many worker slots are in each state -
open, starting, waiting, reading, sending, keepalive, DNS lookup, closing,
logging, graceful finish, and idle cleanup. `open` slots approaching zero means
Apache is running out of capacity to take new work.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Apache HTTP metrics.
- [NGINX Monitoring](./nginx.md) - Another worker-pool web server to watch
  the same way.
- [Caddy Monitoring](./caddy.md) - A web server you may run alongside or in
  front of Apache.
- [HAProxy Monitoring](./haproxy.md) - The load balancer in front of an
  Apache pool.
- [Traefik Monitoring](./traefik.md) - The reverse proxy routing to Apache
  backends.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [HAProxy](./haproxy.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
