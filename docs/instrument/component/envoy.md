---
title: >
  Envoy OpenTelemetry Monitoring - Downstream Requests, Upstream Health,
  and Collector Setup
sidebar_label: Envoy
id: collecting-envoy-telemetry
sidebar_position: 25
description: >
  Collect Envoy metrics with the OpenTelemetry Collector. Monitor
  downstream requests, upstream cluster health, and server state via the
  Prometheus receiver, and ship to base14 Scout.
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
`/stats/prometheus` (default `:9901`) when the `admin` block is configured in
the bootstrap config. The OpenTelemetry Collector's `prometheus` receiver
scrapes that endpoint, collecting 300+ metrics across downstream connections
and HTTP requests, listeners, server state, cluster membership and management,
and upstream traffic. The exact count grows with the number of listeners,
clusters, and routes. This guide configures the receiver, enables the admin
interface, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Envoy                  | 1.20    | 1.32        |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- The Envoy admin interface port (9901) must be reachable from the host
  running the Collector.
- The `admin` block must be configured in the Envoy bootstrap config.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. All rows trace to the metrics Envoy emits on this surface.

A few things to keep in mind across all three tiers:

- `up` is the liveness signal here - the `prometheus` receiver emits `up == 1`
  when the admin endpoint responds. `envoy_server_state` is the in-process
  health signal: `0` = LIVE, `1` = DRAINING, `2` = PRE_INITIALIZING,
  `3` = INITIALIZING. Use `up` for "is it reachable" and
  `envoy_server_state == 0` for "is it actually serving" - not
  `envoy_server_live`, which sits in the Operational tier as a restart flag.
- Envoy is C++, not Go, so the endpoint exposes no `go_*` or `process_*`
  series. The only non-`envoy_` names are `up` and the `scrape_*` meta, so the
  noise floor is much smaller than on the Go-based proxies and control planes.
- Upstream cluster metrics (`envoy_cluster_*`) only appear when Envoy has
  configured clusters with active endpoints. A direct-response or passthrough
  config emits no cluster-level metrics.
- The admin endpoint accepts a `usedonly` query parameter that omits stats
  that have never been updated since startup.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - `1` means the Envoy admin endpoint responded. The liveness signal on this surface. |
| `envoy_server_state` | Server health state (`0` = LIVE, `1` = DRAINING, `2` = PRE_INITIALIZING, `3` = INITIALIZING) - the "is Envoy serving" signal. |
| `envoy_http_downstream_rq_total` | Total client requests at the listener - edge throughput. |
| `envoy_http_downstream_rq_xx` | Client requests by status class (split by `envoy_response_code_class`) - the edge error rate. |
| `envoy_cluster_membership_healthy` | Healthy upstream endpoints per cluster - `0` means all backends for that cluster are down. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Server liveness | `envoy_server_live`, `envoy_server_uptime` | Liveness flag and seconds since start; a reset flags a restart. |
| Server memory | `envoy_server_memory_allocated`, `envoy_server_memory_heap_size` | Allocated memory versus heap size - memory saturation. |
| Server load | `envoy_server_total_connections`, `envoy_server_concurrency`, `envoy_server_days_until_first_cert_expiring` | Active connections, worker concurrency, and days until the soonest TLS cert expires. |
| Downstream latency | `envoy_http_downstream_rq_time` | Client-request latency at the listener (histogram) - headline latency. |
| Downstream requests | `envoy_http_downstream_rq_active`, `envoy_http_downstream_rq_completed` | In-flight and completed client requests. |
| Downstream connections | `envoy_http_downstream_cx_total`, `envoy_http_downstream_cx_active`, `..._rx_bytes_total`, `..._tx_bytes_total` | Downstream connection count and bandwidth. |
| Upstream requests | `envoy_cluster_upstream_rq_total`, `..._xx`, `..._active`, `..._completed` | Proxied requests to backends, by status class and in-flight - backend volume and errors. |
| Upstream latency | `envoy_cluster_upstream_rq_time` | Backend response latency (histogram) - isolates a slow backend from a slow proxy. |
| Backend flakiness | `envoy_cluster_upstream_rq_timeout`, `envoy_cluster_upstream_rq_retry` | Backend request timeouts and retries. |
| Upstream connections | `envoy_cluster_upstream_cx_active`, `..._total`, `..._connect_fail`, `..._rx_bytes_total`, `..._tx_bytes_total` | Upstream connection count, connect failures, and bandwidth. |
| Pool backpressure | `envoy_cluster_upstream_cx_overflow`, `envoy_cluster_upstream_rq_pending_overflow` | Connection-pool / pending-request overflow - circuit-breaker backpressure. |
| Circuit breakers | `envoy_cluster_circuit_breakers_default_cx_open`, `..._rq_open`, `..._rq_pending_open`, `..._rq_retry_open`, `..._cx_pool_open` (and `high_*`) | Circuit-breaker state - `1` means open (Envoy is shedding load on that pool). |
| Membership | `envoy_cluster_membership_total`, `..._degraded`, `..._change`, `..._excluded` | Upstream endpoint pool size, degraded count, and membership churn. |
| Listener and cluster counts | `envoy_listener_downstream_cx_active`, `envoy_listener_manager_total_listeners_active`, `envoy_cluster_manager_active_clusters` | Active listener connections, active listeners, and active clusters. |

### Diagnostic - for investigation and tuning

Higher cardinality; the deep internals you reach for during an incident or a
capacity review. These families are large - each carries an
`envoy_cluster_name`, `envoy_listener_address`, or stat-prefix label, so
series multiply per cluster, per listener, and per virtual host. The
representative members below stand in for the family, not the full list.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Per-cluster upstream internals | `envoy_cluster_upstream_cx_connect_timeout`, `envoy_cluster_upstream_rq_rx_reset`, `envoy_cluster_upstream_rq_cancelled` | Drilling into a specific cluster's connection/request behaviour. |
| Per-listener HTTP downstream internals | `envoy_http_downstream_cx_http1_total`, `envoy_http_downstream_rq_rx_reset`, `envoy_http_downstream_rq_too_large` | Listener-level codec/protocol behaviour. |
| Load-balancer decisions | `envoy_cluster_lb_healthy_panic`, `envoy_cluster_lb_zone_routing_all_directly`, `envoy_cluster_lb_subsets_active` | Load-balancer routing and panic-mode internals. |
| Cluster config machinery (CDS/EDS) | `envoy_cluster_manager_*`, `envoy_cluster_update_*`, `envoy_cluster_assignment_*` | xDS cluster discovery/update behaviour. |
| Listener config machinery (LDS) | `envoy_listener_manager_*`, `envoy_listener_admin_*`, `envoy_listener_worker_*` | Listener-manager lifecycle and admin-listener stats. |
| HTTP filter internals | `envoy_http_rq_*`, `envoy_http_tracing_*`, `envoy_http_no_route`, `envoy_http_no_cluster` | Connection-manager filter behaviour (tracing, no-route, no-cluster). |
| Runtime and subsystem internals | `envoy_dns_cares_*`, `envoy_filesystem_write_*`, `envoy_runtime_*` | DNS resolver, filesystem flush, and runtime-layer internals. |
| Server thread/allocator internals | `envoy_workers_watchdog_*`, `envoy_main_thread_*`, `envoy_server_hot_restart_*`, `envoy_tcmalloc_released` | Worker watchdog, hot-restart, and allocator behaviour. |
| Build info | `envoy_server_version` | Build version carried in the value/labels - context, not a signal. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | Prometheus scrape internals - receiver-side, not from Envoy. |

Some families stay silent until their feature is configured -
`envoy_cluster_health_check_*` need active health checks,
`envoy_listener_ssl_*` and TLS handshake stats need a TLS transport socket,
and the CDS/EDS/LDS update stats stay near zero with a static config (no xDS
control plane). They appear once the feature is enabled.

Full metric list: run `curl -s http://localhost:9901/stats/prometheus`
against your Envoy instance with the admin interface enabled.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. The
liveness and health alerts read states, not invented numbers; the error-rate
and latency alerts are relative to your own baseline. These are starting
points - tune them to your workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The admin endpoint stopped responding. Check the Envoy process and the admin port. |
| `envoy_server_state` | `!= 0` | Envoy is draining or stuck initializing, not serving normally. Check config load and the init sequence. |
| `envoy_cluster_membership_healthy` | `< envoy_cluster_membership_total` for a cluster | One or more backends in the cluster are down; at `0`, clients get 503s. Restore the backend or check health checks. |
| `rate(envoy_http_downstream_rq_xx{envoy_response_code_class="5"})` | Rising versus baseline | Server-side errors at the edge - correlate with upstream errors to localize. |
| `rate(envoy_cluster_upstream_rq_timeout)` | Rising versus baseline | Backends are timing out or slow - investigate the upstream service. |
| `envoy_cluster_circuit_breakers_default_rq_open` or `..._cx_open` | `== 1` | Envoy hit a connection/request limit and is shedding load - raise limits or add backend capacity. |
| `envoy_server_days_until_first_cert_expiring` | Low (for example, < 30) | A served certificate is approaching expiry - rotate it. |

## Access Setup

Enable the admin interface by adding an `admin` block to the Envoy bootstrap
configuration:

```yaml showLineNumbers title="envoy.yaml"
admin:
  address:
    socket_address:
      address: 0.0.0.0   # Bind to localhost and restrict access in production
      port_value: 9901
```

Bind the admin interface to `127.0.0.1` or restrict it with network policies
in production - it can modify Envoy settings and trigger shutdown. The admin
interface requires no authentication by default.

For Docker deployments, mount the bootstrap config into the container at
`/etc/envoy/envoy.yaml`.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check the Envoy admin interface
curl -s http://localhost:9901/server_info | head -5

# Verify the Prometheus metrics endpoint
curl -s http://localhost:9901/stats/prometheus | head -20
```

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

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's
> UI filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
ENVOY_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Scoping what is scraped

Envoy emits a large, label-rich stat set, and each `envoy_cluster_*`,
`envoy_listener_*`, and `envoy_http_*` name carries a per-cluster,
per-listener, or per-virtual-host label, so series multiply quickly. Two
receiver/endpoint capabilities scope what you scrape, without changing which
tiers exist.

A `metric_relabel_configs` keep filter restricts the scrape to the Envoy
families you watch:

```yaml showLineNumbers title="config/otel-collector.yaml (keep filter)"
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
              regex: "envoy_http_downstream_.*|envoy_server_.*|envoy_listener_.*|envoy_cluster_.*"
              action: keep
```

The admin endpoint's `usedonly` query parameter omits stats that have never
been updated since startup:

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
# Check Collector logs for a successful Envoy scrape
docker logs otel-collector 2>&1 | grep -i "envoy"

# Verify Envoy is running
curl -s http://localhost:9901/server_info

# Check the metrics endpoint directly
curl -s http://localhost:9901/stats/prometheus | grep envoy_server_state
```

## Troubleshooting

### Admin interface not responding on port 9901

**Cause**: The `admin` block is missing from the Envoy bootstrap config.

**Fix**:

1. Add the `admin` section with `address` and `port_value` to the bootstrap
   config.
2. Restart Envoy - the admin address is static configuration.
3. Verify: `curl http://localhost:9901/server_info`.

### Metrics endpoint returns empty or partial data

**Cause**: Envoy only reports metrics for resources it has configured.

**Fix**:

1. Metrics appear as listeners, clusters, and routes are configured.
2. Run `curl http://localhost:9901/stats/prometheus` without `usedonly` to see
   all available metrics, including zeros.
3. Confirm Envoy is processing traffic - downstream request and connection
   metrics only advance with active connections.

### Series count is very large in a sidecar mesh

**Cause**: In a sidecar mesh (Istio or similar), each Envoy emits its own
stat set, multiplied by the clusters and routes it knows about, so the total
series count scales with the size of the mesh.

**Look at**: the Diagnostic per-cluster (`envoy_cluster_*`) and per-listener
(`envoy_listener_*`) families - these carry the per-resource labels that drive
the count.

**Fix**:

1. Apply the `metric_relabel_configs` keep filter to scrape only the families
   you watch.
2. Add the `usedonly` parameter so never-updated stats are not scraped.
3. Use a longer `scrape_interval` for sidecars that know many clusters.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Envoy running as an Istio sidecar?**

Yes. Each Envoy sidecar exposes its admin interface - set `targets` to the
sidecar's admin port (typically 15000 in Istio). The Collector can run as a
DaemonSet to scrape all sidecars on a node, or use Prometheus service
discovery for dynamic pod targeting.

**How do I monitor multiple Envoy instances?**

Add all admin endpoints to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
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

Each instance is scraped independently and identified by its `instance` label.

**Why are upstream cluster metrics missing?**

Upstream metrics (`envoy_cluster_*`) only appear when Envoy has configured
clusters with active endpoints. With only a direct-response or passthrough
configuration, cluster-level metrics are not emitted. Add at least one cluster
with endpoints to see upstream metrics.

**What does `envoy_server_live` indicate?**

A value of `1` means Envoy is accepting connections and serving requests; `0`
indicates it is draining or shutting down. It sits in the Operational tier as
a liveness/restart flag - for Core health use `envoy_server_state == 0`, which
distinguishes LIVE from the initializing and draining states.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Envoy metrics.
- [Traefik Monitoring](./traefik.md) - Edge router and ingress proxy.
- [NGINX Monitoring](./nginx.md) - Reverse proxy and web server.
- [HAProxy Monitoring](./haproxy.md) - Load balancer fronting backends.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Traefik](./traefik.md), [NGINX](./nginx.md), and other components.
- **Scope the scrape**: Apply the keep filter or the `usedonly` parameter to
  match the series volume to the families you watch.
