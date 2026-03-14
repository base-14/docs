---
title: >
  Caddy OpenTelemetry Monitoring - Request Rates, TLS Handshakes,
  and Collector Setup
sidebar_label: Caddy
id: collecting-caddy-telemetry
sidebar_position: 41
description: >
  Collect Caddy metrics with the OpenTelemetry Collector. Monitor HTTP
  request rates, response codes, and TLS handshakes using the Prometheus
  receiver and export to base14 Scout.
keywords:
  - caddy opentelemetry
  - caddy otel collector
  - caddy metrics monitoring
  - caddy performance monitoring
  - opentelemetry prometheus receiver caddy
  - caddy observability
  - caddy web server monitoring
  - caddy telemetry collection
---

# Caddy

Caddy exposes Prometheus-format metrics at `/metrics` on its admin API
port (`:2019`) by default. The OpenTelemetry Collector scrapes this
endpoint using the Prometheus receiver, collecting HTTP, TLS, and
runtime metrics including request rates, response codes, TLS handshake
counts, reverse proxy upstream health, and Go runtime statistics. This
guide configures the receiver, enables per-handler metrics, and ships
metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Caddy                  | 2.0     | 2.9+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Before starting:

- Caddy admin API port (2019) must be accessible from the host running
  the Collector
- The admin API is enabled by default - do not disable it if you need
  metrics
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **HTTP**: request count by handler/method/code, request duration
  histogram, request body size, response body size
- **TLS**: handshake count, handshake duration
- **Reverse Proxy**: upstream request duration, upstream health
- **Admin**: request count, response size
- **Process**: Go runtime (goroutines, memory, GC), process CPU and
  memory usage, open file descriptors

Full metric list: run
`curl -s http://localhost:2019/metrics` against your Caddy instance.

## Access Setup

Caddy's admin API exposes `/metrics` by default on port 2019. To enable
per-handler HTTP metrics (request counts by handler, method, and status
code), add `metrics` in the Caddyfile global options:

```text showLineNumbers title="Caddyfile"
{
    admin :2019
    metrics
}

:80 {
    respond "OK" 200
}
```

Without the `metrics` global option, only admin API and Go runtime
metrics are available. Per-handler HTTP metrics require this setting.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check admin API is running
curl -s http://localhost:2019/config/ | head -5

# Verify Prometheus metrics endpoint
curl -s http://localhost:2019/metrics | head -20
```

No authentication is required for the admin API by default. In
production, restrict admin API access with `admin` directive options
or firewall rules.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: caddy
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CADDY_HOST}:2019

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
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

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
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "caddy"

# Verify Caddy is healthy
curl -s http://localhost:2019/config/ | head -5

# Check metrics endpoint directly
curl -s http://localhost:2019/metrics | grep caddy_http
```

## Troubleshooting

### No metrics at /metrics

**Cause**: Admin API is disabled or listening on a different port.

**Fix**:

1. Verify Caddy is running: `docker ps | grep caddy` or
   `caddy version`
2. Check admin API is enabled - do not set `admin off` in Caddyfile
3. Confirm the admin port: default is 2019, check `admin` directive
   in your Caddyfile

### Only Go runtime metrics, no HTTP metrics

**Cause**: The `metrics` global option is not set in the Caddyfile.

**Fix**:

1. Add `metrics` inside the global options block:

   ```text
   {
       metrics
   }
   ```

2. Reload Caddy: `caddy reload` or restart the container
3. Send a few requests to generate HTTP metrics, then check `/metrics`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**How do I get per-route metrics?**

Enable the `metrics` global option in your Caddyfile. This exposes
metrics broken down by handler, method, and response code. Without this
setting, only admin API and Go runtime metrics are available.

**Does this work with Caddy running in Kubernetes?**

Yes. Set `targets` to the Caddy pod or service DNS on port 2019
(e.g., `caddy.default.svc.cluster.local:2019`). The admin API must
be accessible from the Collector pod. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor multiple Caddy instances?**

Add all instances to the scrape targets:

```yaml
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

**Should I expose the admin API in production?**

The admin API should not be publicly accessible. Restrict it using
Caddy's `admin` directive (e.g., bind to localhost or a private
interface) and use firewall rules. The Collector only needs access
to port 2019 - it does not need to reach the HTTP/HTTPS ports.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [Traefik](./traefik.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to filter
  metrics to just HTTP and TLS signals for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [NGINX Monitoring](./nginx.md) - Alternative web server monitoring
- [Traefik Monitoring](./traefik.md) - Alternative reverse proxy monitoring
