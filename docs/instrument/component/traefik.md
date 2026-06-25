---
title: >
  Traefik OpenTelemetry Monitoring - Request Rates, Edge Latency,
  and Collector Setup
sidebar_label: Traefik
id: collecting-traefik-telemetry
sidebar_position: 24
description: >
  Collect Traefik metrics with the OpenTelemetry Collector. Monitor
  edge request rates, request-duration latency, and config-reload health,
  and ship to base14 Scout.
keywords:
  - traefik opentelemetry
  - traefik otel collector
  - traefik metrics monitoring
  - traefik performance monitoring
  - opentelemetry prometheus receiver traefik
  - traefik observability
  - traefik reverse proxy monitoring
  - traefik telemetry collection
---

# Traefik

Traefik exposes Prometheus-format metrics on a dedicated metrics
entrypoint (default `:8082/metrics`) when `--metrics.prometheus` is
enabled. The OpenTelemetry Collector's `prometheus` receiver scrapes that
entrypoint, collecting 15+ metrics across entrypoint, router, and service
request rates, request-duration histograms, request and response bytes,
open connections, and config reloads - from Traefik 2.0+. This guide
enables the metrics entrypoint, configures the receiver, and ships metrics
to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Traefik                | 2.0     | 3.3         |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Traefik must be running with a dedicated metrics entrypoint and
  `--metrics.prometheus` enabled.
- The metrics port must be reachable from the host running the Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

A few things shape what you see on this surface:

- `up` is the liveness signal here. The `prometheus` receiver emits
  `up = 1` when the metrics entrypoint responds, so it is the
  is-the-proxy-reachable check.
- Before any traffic flows, only Go-runtime metrics appear.
  `traefik_entrypoint_requests_total` and the per-entrypoint families need
  at least one request to materialize.
- On Traefik v3 the per-entrypoint and per-service label breakdowns are
  emitted by default (`addEntryPointsLabels` / `addServicesLabels` default
  to `true`); the per-router breakdown is off by default and needs
  `addRoutersLabels: true`. These are Traefik's own emit knobs - they
  change what Traefik exposes, not what the Collector keeps.
- `traefik_entrypoint_requests_total` carries `code` / `method` /
  `protocol` labels, so it is both the throughput signal and the HTTP
  error-rate signal (filter on `code=~"5.."`).

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 = the Traefik metrics entrypoint responded. The liveness signal on this surface. |
| `traefik_config_last_reload_success` | 1 = the last dynamic-config reload succeeded, 0 = it failed and Traefik is running stale/last-good config. The config-health signal. |
| `traefik_entrypoint_requests_total` | Requests handled per entrypoint, labeled by `code` / `method` / `protocol` - edge throughput and status-code mix (error rate). |
| `traefik_entrypoint_request_duration_seconds` | Request latency at the edge per entrypoint - the headline latency SLO (a histogram: `_bucket` / `_sum` / `_count`). |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `traefik_service_requests_total` | Requests proxied to each backend service, by `code` - per-backend volume and error rate. |
| `traefik_service_request_duration_seconds` | Per-backend response latency - isolates a slow backend from a slow proxy. |
| `traefik_router_requests_total` | Requests per router (after rule matching), by `code` - which route carries the traffic and errors. |
| `traefik_router_request_duration_seconds` | Per-router request latency. |
| `traefik_open_connections` | Current open connections by entrypoint / protocol - concurrency and saturation. |
| `traefik_entrypoint_requests_bytes_total`, `traefik_entrypoint_responses_bytes_total` | Edge request/response bytes - ingress/egress bandwidth per entrypoint. |
| `traefik_service_requests_bytes_total`, `traefik_service_responses_bytes_total` | Per-backend request/response bytes. |
| `traefik_config_reloads_total` | Count of dynamic-config reloads - high churn means a flapping provider. |

### Diagnostic - for investigation and tuning

Drill-down detail; reach for these during an incident or capacity review.

| Group | Representative members | When you reach for it |
|---|---|---|
| Per-router bandwidth | `traefik_router_requests_bytes_total`, `traefik_router_responses_bytes_total` | Bandwidth attribution by route. |
| Go-runtime / process | `go_*`, `process_*` | Endpoint runtime and process health; scope these out with a `traefik_.*` keep rule in production. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | Receiver-side scrape health (not emitted by Traefik). |

A few documented Traefik metrics stay silent until their feature is
configured, then appear automatically:

- `traefik_service_server_up` - requires a `healthCheck` on the service;
  reports per-backend-server health.
- `traefik_service_retries_total` - requires a retry middleware.
- `traefik_tls_certs_not_after` - requires a TLS-terminating entrypoint;
  reports certificate expiry.
- 404 status-code series on the entrypoint - appear when traffic matches
  no router.

Full metric list: run `curl -s http://localhost:8082/metrics` against your
Traefik instance with the Prometheus metrics entrypoint enabled.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series.
These are starting points; tune them to your workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The metrics entrypoint stopped responding. Check the Traefik process and the metrics port. |
| `traefik_config_last_reload_success` | `== 0` | Traefik is running stale config after a bad reload - fix the dynamic config; new routes and services are not applied. |
| `rate(traefik_entrypoint_requests_total{code=~"5.."})` | Rising vs baseline | Server-side errors at the edge - check backends and recent config or deploys. |
| `traefik_entrypoint_request_duration_seconds` (p99) | Rising vs baseline | Requests are slow at the edge - correlate with service latency to localize. |
| `traefik_service_request_duration_seconds` (p99) | Rising vs baseline | A backend is slow; the proxy is fine - investigate that service. |
| `traefik_open_connections` | Rising toward limits | Concurrency is climbing - check backend capacity and keep-alive behavior. |

## Access Setup

Enable Prometheus metrics on a dedicated metrics entrypoint. Add these
flags to the Traefik static configuration:

```bash showLineNumbers title="Traefik CLI flags"
--entryPoints.metrics.address=:8082
--metrics.prometheus=true
--metrics.prometheus.entryPoint=metrics
--metrics.prometheus.addEntryPointsLabels=true
--metrics.prometheus.addRoutersLabels=true
--metrics.prometheus.addServicesLabels=true
```

Or in a static configuration file:

```yaml showLineNumbers title="traefik.yaml"
entryPoints:
  web:
    address: ":80"
  metrics:
    address: ":8082"

metrics:
  prometheus:
    entryPoint: metrics
    addEntryPointsLabels: true
    addRoutersLabels: true
    addServicesLabels: true
```

- `addEntryPointsLabels` - emit the per-entrypoint request families with an
  `entrypoint` label (default `true` on v3).
- `addRoutersLabels` - emit the per-router families with a `router` label
  (default `false` on v3 - enable it for per-router metrics).
- `addServicesLabels` - emit the per-service families with a `service`
  label (default `true` on v3).

On Traefik v3 the per-router family is off by default; the snippet above
enables all three explicitly so every breakdown is emitted.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check the Traefik metrics endpoint
curl -s http://localhost:8082/metrics | head -20

# Verify Traefik-specific metrics
curl -s http://localhost:8082/metrics \
  | grep traefik_entrypoint_requests_total
```

No authentication is enabled on the metrics entrypoint by default. Keep it
on a separate port from your production entrypoints and restrict access
with firewall rules in production.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: traefik
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:TRAEFIK_HOST}:8082   # default metrics_path /metrics

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

The Traefik metrics entrypoint serves at the default `/metrics` path, so
no `metrics_path` override is needed.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy `deployment.environment`
> is still accepted for backward compatibility.

### Scoping to the Traefik namespace

The metrics entrypoint also serves the endpoint's own `go_*` / `process_*`
runtime series. To ship only the Traefik metrics, add a keep filter that
scopes to the `traefik_` namespace:

```yaml showLineNumbers title="config/otel-collector.yaml (namespace scope)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: traefik
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:TRAEFIK_HOST}:8082
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "traefik_.*"
              action: keep
```

This keeps every `traefik_*` series and drops the Go-runtime and process
families.

### Environment Variables

```bash showLineNumbers title=".env"
TRAEFIK_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Traefik metrics
docker logs otel-collector 2>&1 | grep -i "traefik"

# Verify the metrics endpoint directly
curl -s http://localhost:8082/metrics \
  | grep traefik_entrypoint_requests_total

# Generate edge traffic so the request families materialize
curl -s http://localhost/ > /dev/null
```

## Troubleshooting

### Metrics endpoint returns 404

**Cause**: The Prometheus metrics entrypoint is not configured.

**Fix**:

1. Verify `--metrics.prometheus=true` and
   `--metrics.prometheus.entryPoint=metrics` are set in the Traefik static
   configuration.
2. Confirm the metrics entrypoint is defined:
   `--entryPoints.metrics.address=:8082`.
3. Restart Traefik - the metrics entrypoint is static configuration and a
   change requires a restart.

### Only Go-runtime metrics appear, no traefik_ metrics

**Cause**: No traffic has passed through Traefik yet. The request families
only appear after at least one request is processed.

**Fix**:

1. Send a test request through Traefik: `curl http://localhost/`.
2. Verify at least one router and service are configured - check the
   Traefik dashboard or API.
3. After traffic flows, `traefik_entrypoint_requests_total` and the
   per-entrypoint families appear.

### Per-router metrics are missing

**Cause**: On Traefik v3 the per-router breakdown is off by default -
`addRoutersLabels` defaults to `false`. (Per-entrypoint and per-service
metrics are on by default.)

**Look at**: whether `traefik_router_requests_total` appears in
`curl -s http://localhost:8082/metrics`.

**Fix**:

1. Enable `--metrics.prometheus.addRoutersLabels=true` (or the
   `addRoutersLabels` key in the static file), then restart Traefik.
2. On the Collector side, the `traefik_.*` keep filter scopes shipping to
   the `traefik_` namespace; it does not change which families Traefik
   emits.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Traefik running in Kubernetes?**

Yes. Set `targets` to the Traefik pod or service DNS
(e.g., `traefik.traefik.svc.cluster.local:8082`). With the Traefik Helm
chart, set `metrics.prometheus.entryPoint` (and the label options) in
`values.yaml`. The Collector can run as a sidecar or DaemonSet.

**How do I monitor multiple Traefik instances?**

Add all Traefik metrics endpoints to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: traefik
          static_configs:
            - targets:
                - traefik-1:8082
                - traefik-2:8082
```

Each instance is scraped independently and identified by its `instance`
label.

**What is the difference between entrypoint, router, and service metrics?**

The same request is counted at three scopes. Entrypoint metrics count all
traffic arriving at a port (including traffic that matched no router).
Router metrics break it down by routing rule after rule matching (e.g.
`Host(example.com)`). Service metrics track traffic reaching each backend.
Entrypoint counts are therefore greater than or equal to router and service
counts; the gap is unrouted traffic such as edge 404s.

**Why use a separate metrics entrypoint?**

Serving metrics on the same port as production traffic exposes them on your
public entrypoints. A dedicated metrics entrypoint on a separate port (e.g.
8082) lets you restrict access with firewall rules while keeping production
entrypoints clean.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Traefik metrics.
- [NGINX Monitoring](./nginx.md) - Reverse proxy and web-server request metrics.
- [HAProxy Monitoring](./haproxy.md) - Load-balancer frontend and backend health.
- [Envoy Monitoring](./envoy.md) - Service-proxy listener and upstream metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [HAProxy](./haproxy.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic
  and retention needs, and use the `traefik_.*` keep filter to scope
  shipping to the Traefik namespace.
