---
title: >
  Caddy OpenTelemetry Monitoring - Request Rate, Latency, and
  Collector Setup
sidebar_label: Caddy
id: collecting-caddy-telemetry
description: >
  Collect Caddy metrics with the OpenTelemetry Collector. Monitor HTTP
  request rate, request latency, and config-reload health by scraping
  Caddy's native Prometheus endpoint and ship to base14 Scout.
keywords:
  - caddy opentelemetry
  - caddy otel collector
  - caddy metrics monitoring
  - caddy performance monitoring
  - opentelemetry prometheus receiver caddy
  - caddy observability
  - caddy web server monitoring
  - caddy telemetry collection
sidebar_position: 41
---

# Caddy

Caddy exposes Prometheus-format metrics natively at `/metrics` on its
admin API (`:2019`) once the `metrics` global option is set, so no
exporter sidecar is needed. The OpenTelemetry Collector's `prometheus`
receiver scrapes that endpoint and passes the metrics through - request
throughput, request and response latency, in-flight concurrency,
config-reload health, and the Go runtime internals Caddy ships alongside
its own counters - from Caddy 2.9.0+. This guide configures the Caddyfile,
wires the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Caddy                  | 2.9.0   | 2.11.4      |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Caddy must be running with the `metrics` global option set (see
  [Access Setup](#access-setup)). Without it, only admin API and Go
  runtime metrics are exposed.
- The admin API port (`:2019`) must be reachable from the host running
  the Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

Caddy defines its own metric surface; the `prometheus` receiver passes
through whatever the endpoint exposes - there is no per-metric enable or
disable list in the Collector.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - Caddy's metrics endpoint is reachable. This is the liveness signal the `prometheus` receiver supplies; `1` = the target is up. |
| `caddy_http_requests_total` | Requests handled per `server` / `handler`; the rate is the throughput KPI. |
| `caddy_http_request_duration_seconds` | Request handling latency histogram. The `code` label lives here, so error rate derives from `_count` where `code=~"5.."`. |
| `caddy_http_requests_in_flight` | Requests currently being handled per `server` / `handler` - concurrency and saturation. |

The status `code` label is on the duration histogram, not on
`caddy_http_requests_total` (which carries only `server` and `handler`).
Derive 5xx error rate from
`rate(caddy_http_request_duration_seconds_count{code=~"5.."})`, not from
the requests counter.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `caddy_config_last_reload_successful` | Whether the last config reload succeeded; `0` means Caddy is serving the previous good config, not what is on disk. |
| `caddy_http_response_duration_seconds` | Time to write the response to the client - slow clients, large bodies, or downstream backpressure (distinct from request handling time). |
| `caddy_http_response_size_bytes` | Response body size distribution - bytes served and payload bloat. |
| `caddy_admin_http_requests_total` | Admin API (`:2019`) request volume by `code` / `handler` / `method` - config churn and scrape traffic. |

### Diagnostic - for investigation and tuning

Higher cardinality; read these alongside an incident rather than paging
on them. In production you can drop this tier with
`metric_relabel_configs` and keep Core + Operational.

| Metric | What it tells you |
|---|---|
| `caddy_http_request_size_bytes` | Request body size distribution - upload and ingest patterns. |
| `caddy_config_last_reload_success_timestamp_seconds` | Wall-clock of the last successful reload; reload age = `now - this`. |
| `go_*` (Go runtime, ~30 series) | GC pauses, goroutine count, heap and allocation - the Go runtime Caddy is built on. |
| `process_*` (process, ~9 series) | CPU seconds, resident memory, open file descriptors, start time. |

Caddy emits 9 `caddy_*` series under the `metrics` global option,
alongside the `go_*` and `process_*` internals and the `up`
target-health signal the receiver adds.

Caddy additionally emits TLS-handshake metrics when serving HTTPS and
`reverse_proxy` upstream-health metrics when proxying. Those are not part
of this metric set (a plain-HTTP `static_response` site exposes neither);
they appear once you serve TLS or proxy to an upstream.

Full metric list: run `curl -s http://localhost:2019/metrics` against
your Caddy instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `up` | - | `== 0` for > 1m | Metrics endpoint not scrapable - Caddy down, admin API off, or a network issue. Check the process and `:2019`. |
| `caddy_config_last_reload_successful` | - | `== 0` | Last reload errored; Caddy is serving the previous good config, not what is on disk. Inspect the reload error and fix the Caddyfile. |
| `rate(caddy_http_request_duration_seconds_count{code=~"5.."}) / rate(caddy_http_request_duration_seconds_count)` | Rising vs baseline | Sustained rise | Server-side errors. Check upstreams, handlers, and recent config changes. |
| `histogram_quantile(0.99, rate(caddy_http_request_duration_seconds_bucket[5m]))` | Rising vs baseline | Sustained rise | p99 request handling slowing. Check upstream latency, CPU, and in-flight saturation. |
| `rate(caddy_http_requests_total)` | - | `-> 0` while traffic expected | Caddy not handling requests. Check the process, listener, and upstreams. |
| `caddy_http_requests_in_flight` | Climbing toward known capacity | At/over capacity | Requests piling up in-flight. Check upstream latency or scale out. |

## Access Setup

Caddy's admin API listens on `:2019` by default and serves `/metrics`,
but until you set the `metrics` global option that endpoint returns only
admin API and Go runtime metrics. Add `metrics` to the global options
block to get the per-handler HTTP series:

```text showLineNumbers title="Caddyfile"
{
    admin :2019
    metrics
}

:80 {
    respond "OK" 200
}
```

Reload after editing: `caddy reload`, or restart the container. Send a
few requests so the HTTP histograms and counters advance, then confirm
the endpoint:

```bash showLineNumbers title="Verify access"
# Admin API is up
curl -s http://localhost:2019/config/ | head -5

# Caddy metric surface is exposed (expect caddy_http_* lines)
curl -s http://localhost:2019/metrics | grep caddy_http
```

The admin API has no authentication by default. Do not expose `:2019`
publicly - bind it to a private interface or localhost via the `admin`
directive and restrict it with firewall or network policy so only the
Collector's network can reach it. The Collector needs only `:2019`; it
does not need the HTTP or HTTPS serving ports.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: caddy
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:CADDY_HOST}:2019   # Caddy admin API host

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

To control metric volume in production, drop the Diagnostic tier
(`go_*`, `process_*`, request-size histogram) with a
`metric_relabel_configs` block on the scrape config while keeping the
Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
CADDY_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Collector is scraping Caddy
docker logs otel-collector 2>&1 | grep -i "caddy"

# Caddy is healthy and serving metrics
curl -s http://localhost:2019/metrics | grep caddy_http

# Generate traffic so the request and latency series advance
curl -s http://localhost:8080/ > /dev/null
```

## Troubleshooting

### No metrics at `/metrics`

**Cause**: The admin API is disabled or listening on a different port.

**Fix**:

1. Verify Caddy is running: `docker ps | grep caddy` or
   `caddy version`.
2. Confirm the admin API is enabled - do not set `admin off` in the
   Caddyfile.
3. Confirm the port: the default is `:2019`; check the `admin`
   directive.

### Only Go runtime metrics, no HTTP metrics

**Cause**: The `metrics` global option is not set, so Caddy exposes only
admin and `go_*` / `process_*` series.

**Fix**:

1. Add `metrics` inside the global options block (see
   [Access Setup](#access-setup)).
2. Reload Caddy: `caddy reload`, or restart the container.
3. Send a few requests, then re-check `/metrics` for `caddy_http_*`.

### 5xx error rate looks wrong or always zero

**Cause**: The status `code` label is on the histograms, not on
`caddy_http_requests_total`, so an error-rate query against the requests
counter has no `code` to filter on.

**Look at**: `caddy_http_request_duration_seconds_count` - the `code`
label is here. Derive error rate from
`rate(caddy_http_request_duration_seconds_count{code=~"5.."})`.

**Fix**: Point the error-rate query at the duration histogram's `_count`
series, not at `caddy_http_requests_total`.

### Config changes not taking effect

**Cause**: The last reload failed, so Caddy kept the previous good
config.

**Look at**: `caddy_config_last_reload_successful` (`0` = the running
config is stale) and
`caddy_config_last_reload_success_timestamp_seconds` for how long ago the
last good reload was (`now - this` = reload age).

**Fix**:

1. Inspect the reload error in the Caddy logs.
2. Fix the Caddyfile and reload; confirm
   `caddy_config_last_reload_successful` returns to `1`.

### Requests slow or piling up

**Cause**: Caddy or an upstream is saturated.

**Look at**: `caddy_http_requests_in_flight` (concurrency climbing toward
capacity) and the p99 of `caddy_http_request_duration_seconds`; on the
runtime side, the Diagnostic `go_*` (goroutine count, GC pauses) and
`process_*` (CPU, open FDs) series.

**Fix**:

1. Investigate upstream latency if in-flight and p99 climb together.
2. Scale out or raise capacity if Caddy itself is CPU- or FD-bound.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**How do I get per-route HTTP metrics?**

Set the `metrics` global option in the Caddyfile global-options block.
That exposes the `caddy_http_*` series. The labels differ by series:
`caddy_http_requests_total` carries `server` and `handler`, while the
latency and size histograms (for example
`caddy_http_request_duration_seconds`) add `method` and `code`. Without
it, Caddy exposes only admin API and Go runtime metrics.

**Does this work with Caddy running in Kubernetes?**

Yes. Set the scrape target to the Caddy pod or service DNS on port 2019
(e.g., `caddy.default.svc.cluster.local:2019`). The admin API must be
reachable from the Collector pod; keep it on a private interface and
restrict it with a network policy.

**How do I monitor multiple Caddy instances?**

Add each instance to the scrape targets:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: caddy
          static_configs:
            - targets:
                - caddy-1:2019
                - caddy-2:2019
```

Each instance is identified by its `instance` label.

**Why is the status code missing from `caddy_http_requests_total`?**

`caddy_http_requests_total` carries only the `server` and `handler`
labels. The HTTP status `code` lives on the latency histograms
(`caddy_http_request_duration_seconds`,
`caddy_http_response_duration_seconds`), so error-rate and per-code
queries use those `_count` series instead.

**Should I expose the admin API in production?**

No. The admin API has no authentication by default. Bind it to localhost
or a private interface with the `admin` directive and restrict it with
firewall or network-policy rules so only the Collector can reach
`:2019`. The Collector does not need the HTTP or HTTPS serving ports.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Caddy metrics.
- [NGINX Monitoring](./nginx.md) - Request rate and connections on a
  companion web server.
- [Apache HTTP Server Monitoring](./apache-httpd.md) - Worker and request
  metrics for the classic web server.
- [HAProxy Monitoring](./haproxy.md) - Frontend, backend, and session health
  for the load balancer in front.
- [Traefik Monitoring](./traefik.md) - Entrypoint and router metrics for the
  cloud-native reverse proxy.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [Traefik](./traefik.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for
  incident investigation.
