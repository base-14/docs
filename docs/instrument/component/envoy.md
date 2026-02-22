---
title: >
  Envoy OpenTelemetry Monitoring — Downstream Connections, Upstream
  Health, and Collector Setup
sidebar_label: Envoy
id: collecting-envoy-telemetry
sidebar_position: 25
description: >
  Collect Envoy metrics with the OpenTelemetry Collector. Monitor
  downstream connections, upstream health, and server memory using
  the Prometheus receiver. Export to base14 Scout.
keywords:
  - envoy opentelemetry
  - envoy otel collector
  - envoy metrics monitoring
  - envoy performance monitoring
  - opentelemetry prometheus receiver envoy
  - envoy observability
  - envoy proxy monitoring
  - envoy telemetry collection
---

# Envoy

Envoy exposes Prometheus-format metrics at its admin interface
(default `:9901/stats/prometheus`) when the admin address is
configured in the bootstrap config. The OpenTelemetry Collector
scrapes this endpoint using the Prometheus receiver, collecting 180+
metrics across downstream connections, HTTP request rates, listener
activity, server memory, cluster management, and runtime statistics.
This guide configures the receiver, enables the admin interface, and
ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Envoy                  | 1.20    | 1.32+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Envoy admin interface port (9901) must be accessible from the host
  running the Collector
- The `admin` block must be configured in the Envoy bootstrap config
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Downstream (Client-facing)**: active connections, total requests,
  request duration, bytes received/sent, protocol breakdown
  (HTTP/1.1, HTTP/2, HTTP/3)
- **Listeners**: active connections, accepted connections, rejected
  connections, listener manager state
- **Server**: memory allocated, uptime, live state, concurrency,
  hot restart statistics, worker threads
- **Cluster Manager**: active clusters, cluster adds/removes/updates,
  warming clusters
- **Runtime**: load success/failure, override counts, admin overrides,
  deprecated features used

Full metric list: run
`curl -s http://localhost:9901/stats/prometheus` against your Envoy
instance with the admin interface enabled.

## Access Setup

Enable the admin interface by adding an `admin` block to the Envoy
bootstrap configuration:

```yaml showLineNumbers title="envoy.yaml"
admin:
  address:
    socket_address:
      address: 0.0.0.0   # Bind to localhost in production
      port_value: 9901
```

For Docker deployments, mount the bootstrap config into the
container at `/etc/envoy/envoy.yaml`.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Envoy admin interface
curl -s http://localhost:9901/server_info | head -5

# Verify Prometheus metrics endpoint
curl -s http://localhost:9901/stats/prometheus | head -20
```

No authentication is required on the admin interface by default.
Bind to `127.0.0.1` or use network policies to restrict access in
production — the admin interface can modify Envoy settings and
trigger shutdown.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: envoy
          scrape_interval: 30s
          metrics_path: /stats/prometheus
          static_configs:
            - targets:
                - ${env:ENVOY_HOST}:9901

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
ENVOY_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

Envoy's metric count grows with the number of listeners, clusters,
and routes. To focus on the most important metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: envoy
          scrape_interval: 30s
          metrics_path: /stats/prometheus
          static_configs:
            - targets:
                - ${env:ENVOY_HOST}:9901
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "envoy_http_downstream_.*|envoy_server_.*|envoy_listener_manager_.*|envoy_cluster_manager_.*"
              action: keep
```

You can also use the `usedonly` query parameter to exclude metrics
that have never been updated:

```yaml showLineNumbers title="config/otel-collector.yaml (usedonly)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: envoy
          scrape_interval: 30s
          metrics_path: /stats/prometheus
          params:
            usedonly: [""]
          static_configs:
            - targets:
                - ${env:ENVOY_HOST}:9901
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "envoy"

# Verify Envoy is running
curl -s http://localhost:9901/server_info

# Check metrics endpoint directly
curl -s http://localhost:9901/stats/prometheus \
  | grep envoy_server_live
```

## Troubleshooting

### Admin interface not responding on port 9901

**Cause**: The `admin` block is missing from the Envoy bootstrap
config.

**Fix**:

1. Add the `admin` section with `address` and `port_value` to the
   bootstrap config
2. Restart Envoy — the admin address is static configuration
3. Verify: `curl http://localhost:9901/`

### Metrics endpoint returns empty or partial data

**Cause**: Envoy only reports metrics for configured resources.

**Fix**:

1. Metrics appear as listeners, clusters, and routes are configured
2. Use `curl http://localhost:9901/stats/prometheus` without
   `usedonly` to see all available metrics including zeros
3. Check Envoy is processing traffic — downstream metrics require
   active connections

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### High metric cardinality in service mesh deployments

**Cause**: In Istio or similar service meshes, each sidecar Envoy
generates its own metric set, multiplied by the number of clusters
and routes.

**Fix**:

1. Use `metric_relabel_configs` to keep only essential metrics
2. Use the `usedonly` parameter to skip unused metrics
3. Increase the scrape interval for sidecars with many clusters

## FAQ

**Does this work with Envoy running as an Istio sidecar?**

Yes. Each Envoy sidecar exposes its admin interface. Set `targets`
to the sidecar's admin port (typically 15000 in Istio). The
Collector can run as a DaemonSet to scrape all sidecars on a node,
or use Prometheus service discovery for dynamic pod targeting.

**How do I monitor multiple Envoy instances?**

Add all admin endpoints to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: envoy
          metrics_path: /stats/prometheus
          static_configs:
            - targets:
                - envoy-1:9901
                - envoy-2:9901
                - envoy-3:9901
```

Each instance is scraped independently and identified by its
`instance` label.

**Why are upstream cluster metrics missing?**

Upstream metrics only appear when Envoy has configured clusters with
active endpoints. If Envoy is running with only a direct response
or passthrough configuration, cluster-level metrics will not be
emitted. Add at least one cluster with endpoints to see upstream
metrics.

**What does `envoy_server_live` indicate?**

A value of `1` means Envoy is accepting connections and processing
requests. A value of `0` indicates the server is draining or
shutting down. Use this metric for basic liveness alerting.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Traefik](./traefik.md),
  [NGINX](./nginx.md),
  and other components
- **Fine-tune Collection**: Use the `usedonly` parameter and
  `metric_relabel_configs` to control metric volume

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Envoy metrics
- [Traefik Monitoring](./traefik.md)
  — Reverse proxy monitoring
