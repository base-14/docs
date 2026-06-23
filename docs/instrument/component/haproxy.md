---
title: >
  HAProxy OpenTelemetry Monitoring - Request Rates, Backend Health,
  and Collector Setup
sidebar_label: HAProxy
id: collecting-haproxy-telemetry
sidebar_position: 12
description: >
  Collect HAProxy metrics with the OpenTelemetry Collector. Monitor request
  rates, sessions, connection errors, backend health, and response times, and
  ship to base14 Scout.
keywords:
  - haproxy opentelemetry
  - haproxy otel collector
  - haproxy metrics monitoring
  - haproxy performance monitoring
  - opentelemetry haproxy receiver
  - haproxy observability
  - haproxy load balancer monitoring
  - haproxy telemetry collection
---

# HAProxy

The OpenTelemetry Collector's `haproxyreceiver` collects 33 metrics from
HAProxy - request rates, sessions, connection errors, backend health,
response times, and compression. The receiver reads HAProxy's CSV stats output
(over the HTTP stats page or the stats socket) and parses it internally, so no
exporter sidecar is needed. This guide enables a stats endpoint, configures the
receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| HAProxy                | 2.0     | 2.8+ (LTS)  |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- HAProxy must be reachable from the host running the Collector.
- A `stats` endpoint enabled - either an HTTP `stats` frontend
  (`stats enable` / `stats uri`) or the `stats socket` - see
  [Access Setup](#access-setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

A few things about this surface before the tables:

- **No `up` and no health metric.** Liveness is the receiver scraping the stats
  page successfully; backend availability is `haproxy.active` (count of servers
  reporting UP).
- **Point the `endpoint` at the stats path, not `/stats;csv`.** For an HTTP
  stats frontend, use the stats path (e.g. `/stats`) - the receiver appends the
  CSV view itself. The receiver can also read the HAProxy stats socket via a
  `file://` endpoint (e.g. `file:///var/run/haproxy.ipc`).
- **One row per frontend, per backend, and per server.** HAProxy emits a CSV
  row for each, so the same metric appears tagged by `haproxy.proxy_name` /
  `haproxy.service_name` for the frontend, the backend aggregate, and each
  server.
- **`haproxy.requests.total` carries a `status_code` attribute**
  (`1xx`/`2xx`/`3xx`/`4xx`/`5xx`/`other`). It is both the throughput signal and
  the HTTP error-rate signal.
- **The compression family reads 0** unless compression is configured
  (`compression algo`).

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `haproxy.requests.total` | HTTP requests by `status_code` (1xx/2xx/3xx/4xx/5xx/other) - throughput and the HTTP error-rate signal. |
| `haproxy.responses.average_time` | Average backend response time over the last 1024 requests - the serving-latency KPI. |
| `haproxy.active` | Active (UP) servers in the backend - backend availability, the LB's core job. There is no `up` metric; liveness is scrape success. |
| `haproxy.sessions.count` | Current sessions - concurrency and load. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `haproxy.responses.errors` | Backend response errors - the error signal that pages. |
| `haproxy.connections.errors` | Errors connecting to backend servers - backend reachability. |
| `haproxy.requests.errors` | Client request errors. |
| `haproxy.failed_checks` | Failed health checks while a server was up - a server is flapping. |
| `haproxy.downtime` | Accumulated backend downtime, in seconds. |
| `haproxy.requests.queued` | Requests queued without an assigned server - backend saturation. |
| `haproxy.sessions.limit` | Configured session limit - saturate `haproxy.sessions.count` against this. |
| `haproxy.bytes.input`, `haproxy.bytes.output` | Bytes in / out - bandwidth. |
| `haproxy.backup` | Backup servers active - the primary pool has failed over. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity review.

| Group | Metrics | When you reach for it |
|---|---|---|
| Latency breakdown | `haproxy.requests.average_time` (queue time), `haproxy.connections.average_time` (connect time), `haproxy.sessions.average` (total session time) | Splitting the headline `haproxy.responses.average_time` into queue / connect / end-to-end stages. |
| Rate gauges | `haproxy.requests.rate`, `haproxy.connections.rate`, `haproxy.sessions.rate` | Instantaneous per-second rates, derivable from the counters. |
| Cumulative counters | `haproxy.connections.total`, `haproxy.sessions.total` | Lifetime connection / session volume. |
| Resilience | `haproxy.connections.retries`, `haproxy.requests.redispatched`, `haproxy.clients.canceled` | Connection retries, redispatch to another server, and client-aborted transfers - backend trouble. |
| Security denials | `haproxy.requests.denied`, `haproxy.responses.denied` | ACL-denied requests / responses - security-policy hits. |
| LB internals | `haproxy.server_selected.total`, `haproxy.weight` | Server-selection counts and load-balancing weight. |
| Compression | `haproxy.compression.bypass`, `haproxy.compression.count`, `haproxy.compression.input`, `haproxy.compression.output` | Compression effectiveness. Reads 0 unless compression is enabled. |

Full metric reference:
[OTel HAProxy Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/haproxyreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series. Tune
to your workload; these are starting points.

| Alert | Condition | Why it matters |
|---|---|---|
| HAProxy unreachable | The `haproxy` receiver produces no data for > 1m | No `up`/health on this surface - scrape success against the stats page is liveness. Check the process and the stats endpoint. |
| Backend has no healthy servers | `haproxy.active` == 0 for a backend | The LB has nowhere healthy to route - every request to that backend fails. Check the servers and their health checks. |
| HTTP 5xx rising | `rate(haproxy.requests.total{status_code="5xx"})` rising vs baseline, or `haproxy.responses.errors` rising | Server-side errors through the proxy - inspect the backend and recent deploys. |
| Backend latency rising | `haproxy.responses.average_time` rising vs baseline | Slow backend responses - check the backend servers, not HAProxy. |
| Session saturation | `haproxy.sessions.count` approaching `haproxy.sessions.limit` | Approaching the configured session ceiling - new sessions will be refused; raise `maxconn` or scale out. |
| Request queue building | `haproxy.requests.queued` rising vs baseline | Backends cannot keep up and requests are queuing - add capacity or check backend health. |
| Health checks failing | `rate(haproxy.failed_checks)` > 0 | A server is failing checks while up - it is flapping in and out of the pool. Investigate that server. |

## Access Setup

The receiver scrapes HAProxy's HTTP stats page. Enable an HTTP `stats` frontend
in your HAProxy configuration:

```text showLineNumbers title="haproxy.cfg"
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
```

Verify the stats page returns CSV data:

```bash showLineNumbers title="Verify access"
curl -s 'http://localhost:8404/stats;csv' | head -5
```

No authentication is required by default. If you add `stats auth`, pass the
credentials through the Collector endpoint URL
(`http://user:pass@<haproxy-host>:8404/stats`).

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  haproxy:
    endpoint: http://localhost:8404/stats   # Change to your HAProxy stats URL
    collection_interval: 10s

    metrics:
      # Traffic
      haproxy.bytes.input:
        enabled: true
      haproxy.bytes.output:
        enabled: true

      # Connections
      haproxy.connections.errors:
        enabled: true
      haproxy.connections.rate:
        enabled: true
      haproxy.connections.retries:
        enabled: true
      haproxy.connections.total:
        enabled: true
      haproxy.connections.average_time:
        enabled: true

      # Requests
      haproxy.requests.denied:
        enabled: true
      haproxy.requests.errors:
        enabled: true
      haproxy.requests.queued:
        enabled: true
      haproxy.requests.rate:
        enabled: true
      haproxy.requests.redispatched:
        enabled: true
      haproxy.requests.total:
        enabled: true
      haproxy.requests.average_time:
        enabled: true

      # Responses
      haproxy.responses.denied:
        enabled: true
      haproxy.responses.errors:
        enabled: true
      haproxy.responses.average_time:
        enabled: true

      # Sessions
      haproxy.sessions.average:
        enabled: true
      haproxy.sessions.count:
        enabled: true
      haproxy.sessions.rate:
        enabled: true
      haproxy.sessions.limit:
        enabled: true
      haproxy.sessions.total:
        enabled: true

      # Server health
      haproxy.server_selected.total:
        enabled: true
      haproxy.active:
        enabled: true
      haproxy.backup:
        enabled: true
      haproxy.weight:
        enabled: true
      haproxy.downtime:
        enabled: true
      haproxy.failed_checks:
        enabled: true

      # Clients
      haproxy.clients.canceled:
        enabled: true

      # Compression
      haproxy.compression.bypass:
        enabled: true
      haproxy.compression.count:
        enabled: true
      haproxy.compression.input:
        enabled: true
      haproxy.compression.output:
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

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [haproxy]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.41.0, stable since v1.27.0). The legacy
> `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped HAProxy metrics
docker logs otel-collector 2>&1 | grep -i "haproxy"

# Verify the stats endpoint is responding
curl -s 'http://localhost:8404/stats;csv' | head -5

# Check backend health
curl -s 'http://localhost:8404/stats;csv' | grep -i "backend"
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach HAProxy at the configured stats endpoint.

**Fix**:

1. Verify HAProxy is running: `systemctl status haproxy` or
   `docker ps | grep haproxy`.
2. Confirm the stats endpoint and port in your config match the `bind`
   directive in `haproxy.cfg`.
3. Check firewall rules if the Collector runs on a separate host.

### Stats endpoint returns HTML instead of metrics

**Cause**: The endpoint URL points to the wrong path or includes the CSV
suffix.

**Fix**:

1. The receiver appends the CSV view itself - set the endpoint to `/stats`,
   not `/stats;csv`.
2. Verify `stats uri` in `haproxy.cfg` matches the path in the receiver config.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

### Metrics missing for some backends

**Cause**: HAProxy backend servers are in maintenance mode or have never
received traffic.

**Look at**: `haproxy.active` and `haproxy.backup` - zero indicates no healthy
servers in that backend. The Diagnostic `haproxy.server_selected.total` stays
flat for a server that has never been routed to.

**Fix**:

1. Send test traffic to the backend to trigger metric collection.
2. Verify every backend appears in
   `curl -s 'http://localhost:8404/stats;csv'`.

## FAQ

**Does this work with HAProxy running in Kubernetes?**

Yes. Set `endpoint` to the HAProxy service DNS
(e.g., `http://haproxy.default.svc.cluster.local:8404/stats`) and expose the
stats port in the Service definition. The Collector can run as a sidecar or
DaemonSet.

**How do I monitor multiple HAProxy instances?**

Add multiple receiver blocks with distinct names:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  haproxy/primary:
    endpoint: http://haproxy-1:8404/stats
  haproxy/secondary:
    endpoint: http://haproxy-2:8404/stats
```

Then include both in the pipeline:
`receivers: [haproxy/primary, haproxy/secondary]`.

**Can I use a Unix socket instead of HTTP?**

Yes. Point the receiver `endpoint` at the stats socket with a `file://` scheme
(e.g. `file:///var/run/haproxy.ipc`) and expose the socket in HAProxy's
`global` section:

```text showLineNumbers title="haproxy.cfg"
global
    stats socket /var/run/haproxy.ipc level admin
```

The HTTP `stats` frontend shown in [Access Setup](#access-setup) is the
alternative, not a requirement - the receiver reads the same CSV over either
transport.

**Why are compression metrics showing zero?**

The `haproxy.compression.*` family requires compression to be enabled in
HAProxy (`compression algo gzip` in the frontend or backend config). It reports
zero when compression is not configured.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on HAProxy metrics.
- [NGINX Monitoring](./nginx.md) - The web server most often sitting behind
  HAProxy.
- [AWS ELB Monitoring](../infra/aws/elb.md) - Managed load balancer monitoring.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [AWS ELB](../infra/aws/elb.md), and other components.
- **Fine-tune Collection**: Reach for the Diagnostic tier during incident
  investigation; adjust `collection_interval` to match your traffic patterns.
