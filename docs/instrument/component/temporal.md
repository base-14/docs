---
title: >
  Temporal OpenTelemetry Monitoring — Workflow Latency, Task Queues,
  and Collector Setup
sidebar_label: Temporal
id: collecting-temporal-telemetry
sidebar_position: 20
description: >
  Collect Temporal metrics with the OpenTelemetry Collector. Monitor
  workflow execution, task queue depth, persistence latency, and
  service health using the Prometheus receiver and export to base14
  Scout.
keywords:
  - temporal opentelemetry
  - temporal otel collector
  - temporal metrics monitoring
  - temporal performance monitoring
  - opentelemetry prometheus receiver temporal
  - temporal observability
  - temporal workflow monitoring
  - temporal telemetry collection
---

# Temporal

Temporal exposes Prometheus-format metrics when the
`PROMETHEUS_ENDPOINT` environment variable is set. The OpenTelemetry
Collector scrapes this endpoint using the Prometheus receiver,
collecting 140+ metrics across service requests, persistence
latency, task queues, workflow state, and cluster health. This
guide configures the receiver, connects to a Temporal server, and
ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Temporal Server        | 1.20    | 1.24+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Temporal must be configured with `PROMETHEUS_ENDPOINT` to expose
  metrics (not enabled by default)
- The metrics port (commonly 8000) must be accessible from the host
  running the Collector
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Service Requests**: total gRPC requests, request latency,
  errors by type, pending requests, active connections
- **Persistence**: database requests and latency, visibility store
  requests and latency, errors by type
- **Task Queues**: task dispatch requests, end-to-end task latency,
  queue time, schedule-to-start latency, loaded queues, active
  pollers
- **Workflow State**: history size and event count, state
  transitions, mutable state size, activity and signal counts
- **Shards & Cluster**: shard acquisition attempts and latency,
  owned shards, membership changes
- **Memory**: heap, stack, allocated memory, goroutines, GC pause
  duration

Full metric list: run
`curl -s http://<temporal-host>:8000/metrics` against your
Temporal instance.

## Access Setup

Enable the Prometheus metrics endpoint by setting the
`PROMETHEUS_ENDPOINT` environment variable:

```bash showLineNumbers
# Docker / Docker Compose
PROMETHEUS_ENDPOINT=0.0.0.0:8000

# Verify metrics are exposed
curl -s http://localhost:8000/metrics | head -20
```

For Kubernetes deployments, add the environment variable to the
Temporal server container spec and expose port 8000.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:TEMPORAL_HOST}:8000

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
TEMPORAL_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Multi-Service Deployment

In production, Temporal services (frontend, history, matching,
worker) often run as separate processes. Each service exposes its
own metrics endpoint:

```yaml showLineNumbers title="config/otel-collector.yaml (multi)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal-frontend
          scrape_interval: 30s
          static_configs:
            - targets:
                - temporal-frontend:8000
        - job_name: temporal-history
          scrape_interval: 30s
          static_configs:
            - targets:
                - temporal-history:8000
        - job_name: temporal-matching
          scrape_interval: 30s
          static_configs:
            - targets:
                - temporal-matching:8000
        - job_name: temporal-worker
          scrape_interval: 30s
          static_configs:
            - targets:
                - temporal-worker:8000
```

### Filtering Metrics

Temporal exposes 140+ metrics. To reduce volume, keep only the
most important ones:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: temporal
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:TEMPORAL_HOST}:8000
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "service_.*|persistence_.*|task_.*|history_.*|memory_.*|num_goroutines"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "temporal"

# Verify Temporal is healthy
curl -s http://localhost:8000/metrics \
  | grep service_requests

# Check persistence latency
curl -s http://localhost:8000/metrics \
  | grep persistence_latency_count
```

## Troubleshooting

### Metrics endpoint returns empty or connection refused

**Cause**: `PROMETHEUS_ENDPOINT` is not set on the Temporal server.

**Fix**:

1. Set `PROMETHEUS_ENDPOINT=0.0.0.0:8000` in the Temporal server
   environment
2. Restart the Temporal server
3. Verify: `curl http://localhost:8000/metrics`

### Only scrape-related metrics appear

**Cause**: The Collector connects but Temporal returns no
application metrics.

**Fix**:

1. Check that `PROMETHEUS_ENDPOINT` is set to `0.0.0.0:<port>`,
   not `127.0.0.1:<port>` (must be accessible from the Collector)
2. Verify port mapping if running in Docker:
   `ports: ["8000:8000"]`
3. Test from the Collector's network:
   `docker exec otel-collector wget -qO- http://temporal:8000/metrics`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Persistence latency is high

**Cause**: Database performance issue, not a monitoring
configuration problem.

**Fix**:

1. Check `persistence_latency` histogram for p99 values
2. Monitor `persistence_error_with_type` for database errors
3. Verify database connectivity and resource utilization

## FAQ

**Does this work with Temporal running in Kubernetes?**

Yes. Set `targets` to the Temporal service DNS
(e.g., `temporal-frontend.temporal.svc.cluster.local:8000`). Add
`PROMETHEUS_ENDPOINT` to each Temporal service's container env.
The Collector can run as a sidecar or DaemonSet.

**How do I monitor Temporal Cloud?**

Temporal Cloud exposes metrics through a dedicated endpoint with
mTLS authentication. The scrape config requires `tls_config` with
client certificates provided by Temporal. Refer to Temporal Cloud
documentation for the exact endpoint and certificate setup.

**What is the difference between `service_latency` and
`service_latency_userlatency`?**

`service_latency` measures total server-side request duration.
`service_latency_userlatency` isolates time spent in user
workflow/activity code. `service_latency_nouserlatency` is the
server overhead (total minus user latency).

**Why do some metrics have a `service_name` label?**

Temporal runs multiple internal services (frontend, history,
matching, worker). The `service_name` label identifies which
service emitted the metric. In a single-process deployment (like
`auto-setup`), all services share one metrics endpoint.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus
  on service and persistence metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [PostgreSQL Monitoring](./postgres.md)
  — Database monitoring (commonly used with Temporal)
