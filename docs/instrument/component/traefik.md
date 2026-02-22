---
title: >
  Traefik OpenTelemetry Monitoring — Request Rates, Latency,
  and Collector Setup
sidebar_label: Traefik
id: collecting-traefik-telemetry
sidebar_position: 24
description: >
  Collect Traefik metrics with the OpenTelemetry Collector. Monitor
  request rates, response latency, and open connections. Export to
  base14 Scout.
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

Traefik exposes Prometheus-format metrics at a configurable
entrypoint when `--metrics.prometheus` is enabled. The OpenTelemetry
Collector scrapes this endpoint using the Prometheus receiver,
collecting 15+ metrics across entrypoint request rates, router and
service latency, response bytes, open connections, and configuration
reloads. This guide configures the receiver, enables the metrics
entrypoint, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Traefik                | 2.0     | 3.0+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Traefik must be configured with a dedicated metrics entrypoint
- The metrics port must be accessible from the host running the
  Collector
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Entrypoint Traffic**: total requests, request duration
  histograms, request and response bytes by entrypoint
- **Router Traffic**: total requests, request duration, request and
  response bytes per router
- **Service Traffic**: total requests, request duration, request and
  response bytes per backend service
- **Connections**: open connections by entrypoint, method, and
  protocol
- **Configuration**: reload count, last successful reload timestamp

Full metric list: run
`curl -s http://localhost:8082/metrics` against your Traefik
instance with the Prometheus metrics entrypoint enabled.

## Access Setup

Enable Prometheus metrics by configuring a dedicated metrics
entrypoint. Add these flags to the Traefik static configuration:

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

- `addEntryPointsLabels` — adds `entrypoint` label to metrics
- `addRoutersLabels` — adds `router` label to metrics
- `addServicesLabels` — adds `service` label to metrics

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Traefik metrics endpoint
curl -s http://localhost:8082/metrics | head -20

# Verify Traefik-specific metrics
curl -s http://localhost:8082/metrics \
  | grep traefik_entrypoint_requests_total
```

No authentication is required on the metrics entrypoint by default.
Use a separate port from your main entrypoints and restrict access
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
                - ${env:TRAEFIK_HOST}:8082

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
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
TRAEFIK_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

To collect only Traefik-specific metrics and exclude Go runtime
metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
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

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "traefik"

# Verify Traefik is running
curl -s http://localhost:8082/ping

# Check metrics endpoint directly
curl -s http://localhost:8082/metrics \
  | grep traefik_entrypoint_requests_total
```

## Troubleshooting

### Metrics endpoint returns 404

**Cause**: The Prometheus metrics entrypoint is not configured.

**Fix**:

1. Verify `--metrics.prometheus=true` and
   `--metrics.prometheus.entryPoint=metrics` are set in the Traefik
   static configuration
2. Confirm the metrics entrypoint is defined:
   `--entryPoints.metrics.address=:8082`
3. Restart Traefik — metrics configuration is static and requires a
   restart

### Only Go runtime metrics appear, no traefik_ metrics

**Cause**: No traffic has passed through Traefik yet. Request
metrics only appear after at least one request is processed.

**Fix**:

1. Send a test request through Traefik:
   `curl http://localhost/`
2. Verify at least one router and service are configured:
   check the Traefik dashboard or API
3. After traffic flows, `traefik_entrypoint_requests_total` and
   related metrics will appear

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### High metric cardinality

**Cause**: Enabling `addRoutersLabels` and `addServicesLabels` with
many dynamic routes creates many time series.

**Fix**:

1. Disable router labels if not needed:
   `--metrics.prometheus.addRoutersLabels=false`
2. Use `metric_relabel_configs` to drop per-router metrics and keep
   only entrypoint-level aggregates
3. In Kubernetes with many dynamic services, consider disabling
   service labels and relying on entrypoint metrics

## FAQ

**Does this work with Traefik running in Kubernetes?**

Yes. Set `targets` to the Traefik pod or service DNS
(e.g., `traefik.traefik.svc.cluster.local:8082`). When using the
Traefik Helm chart, set `metrics.prometheus.entryPoint` in the
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

Each instance is scraped independently and identified by its
`instance` label.

**What is the difference between entrypoint, router, and service
metrics?**

Entrypoint metrics count all traffic arriving at a port (e.g., port
80). Router metrics break down traffic by routing rule (e.g.,
`Host(example.com)`). Service metrics track traffic reaching each
backend service. For most monitoring needs, entrypoint and service
metrics provide the best signal-to-noise ratio.

**Why use a separate metrics entrypoint?**

Serving metrics on the same port as production traffic exposes them
to the public internet. A dedicated metrics entrypoint on a separate
port (e.g., 8082) allows you to restrict access with firewall rules
while keeping production entrypoints clean.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md),
  [HAProxy](./haproxy.md),
  and other components
- **Fine-tune Collection**: Adjust label options and
  `metric_relabel_configs` to control cardinality

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Traefik metrics
- [NGINX Monitoring](./nginx.md)
  — Web server monitoring
