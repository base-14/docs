---
title: >
  Nomad OpenTelemetry Monitoring — Raft Consensus, Scheduler,
  and Collector Setup
sidebar_label: Nomad
id: collecting-nomad-telemetry
sidebar_position: 29
description: >
  Collect Nomad metrics with the OpenTelemetry Collector. Monitor
  Raft consensus, scheduler evals, and RPC rates via Prometheus
  receiver. Export to base14 Scout.
keywords:
  - nomad opentelemetry
  - nomad otel collector
  - nomad metrics monitoring
  - nomad performance monitoring
  - opentelemetry prometheus receiver nomad
  - nomad observability
  - nomad scheduler monitoring
  - nomad telemetry collection
---

# Nomad

Nomad exposes Prometheus-format metrics at
`/v1/metrics?format=prometheus` when `prometheus_metrics = true`
is set in the telemetry configuration block. The OpenTelemetry
Collector scrapes this endpoint using the Prometheus receiver,
collecting 90+ metrics across Raft consensus, broker and scheduler
evaluations, RPC requests, cluster membership, and runtime
statistics. This guide configures the receiver, enables the
metrics endpoint, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Nomad                  | 1.3.0   | 1.9+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Nomad HTTP API port (4646) must be accessible from the host
  running the Collector
- `prometheus_metrics` must be enabled in the agent telemetry
  config (not enabled by default)
- Nomad retains Prometheus metrics in memory — only enable if
  actively scraping
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Raft Consensus**: applied index, commit time, peer count,
  leader dispatch latency, FSM apply/enqueue, BoltDB storage
  stats, state transitions
- **Broker & Scheduler**: pending/ready/unacked/waiting evals,
  plan queue depth, worker dequeue operations, cancelable evals
- **RPC**: request count, accepted connections, eval writes,
  status reads
- **Leadership & Cluster**: barrier operations, heartbeat
  active, serf member joins, memberlist gossip, snapshot
  operations
- **Job Status**: dead/pending/running jobs, blocked evals,
  escaped evaluations
- **Runtime**: alloc bytes, GC pause duration, heap objects,
  goroutines, malloc/free count

Full metric list: run
`curl -s 'http://localhost:4646/v1/metrics?format=prometheus'`
against your Nomad instance.

## Access Setup

Enable the Prometheus metrics endpoint by adding the `telemetry`
block to the Nomad agent configuration:

```hcl showLineNumbers title="nomad-config.hcl"
telemetry {
  prometheus_metrics         = true
  publish_allocation_metrics = true
  publish_node_metrics       = true
}
```

- `prometheus_metrics` must be `true` to expose the Prometheus
  endpoint (default is `false`)
- `publish_allocation_metrics` enables per-allocation resource
  metrics
- `publish_node_metrics` enables node-level resource metrics
- Nomad holds Prometheus metrics in memory — disable if no
  scraper is active

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Nomad is running
nomad server members

# Verify Prometheus metrics endpoint
curl -s 'http://localhost:4646/v1/metrics?format=prometheus' \
  | head -20
```

No authentication is required by default. For ACL-enabled
clusters, see [Authentication](#authentication) below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          scrape_interval: 30s
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646

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
NOMAD_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For Nomad clusters with ACLs enabled, the scrape request needs
a token with at least `node:read` and `agent:read` capability:

```yaml showLineNumbers title="config/otel-collector.yaml (ACL)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:NOMAD_TOKEN}
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646
```

### Filtering Metrics

Nomad exposes 90+ metrics including Go runtime and process
statistics. To collect only Nomad-specific metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          scrape_interval: 30s
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "nomad_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "nomad"

# Verify Nomad is healthy
nomad server members

# Check metrics endpoint directly
curl -s 'http://localhost:4646/v1/metrics?format=prometheus' \
  | grep nomad_raft_peers
```

## Troubleshooting

### Metrics endpoint returns empty or 404

**Cause**: `prometheus_metrics` is not enabled in the telemetry
block.

**Fix**:

1. Add `prometheus_metrics = true` to the `telemetry` block in
   the agent config
2. Restart the Nomad agent
3. Verify:
   `curl 'http://localhost:4646/v1/metrics?format=prometheus'`

### Connection refused on port 4646

**Cause**: Collector cannot reach Nomad at the configured
address.

**Fix**:

1. Verify Nomad is running: `docker ps | grep nomad` or
   `nomad server members`
2. Confirm the HTTP API address:
   `nomad agent-info | grep Address`
3. Check firewall rules if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Client metrics missing

**Cause**: The Collector is scraping a Nomad server that does
not emit client-side metrics.

**Fix**:

1. Nomad servers only expose server metrics (Raft, broker,
   scheduler). Client metrics like allocation resource usage
   require scraping Nomad client agents directly
2. Add client agent endpoints to the scrape config targets
3. Ensure `publish_allocation_metrics = true` and
   `publish_node_metrics = true` are set on client agents

## FAQ

**Does this work with Nomad running in Kubernetes?**

Yes. Set `targets` to the Nomad service DNS
(e.g., `nomad-server.nomad.svc.cluster.local:4646`). Ensure
`prometheus_metrics = true` is set in the Nomad Helm chart
values under `server.extraConfig`. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor a multi-node Nomad cluster?**

Each Nomad server exposes its own metrics endpoint. Add all
server endpoints to the scrape config:

```yaml showLineNumbers title="Multi-node scrape config"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - nomad-1:4646
                - nomad-2:4646
                - nomad-3:4646
```

Each server is scraped independently and identified by its
`instance` label.

**Why are client metrics missing?**

Server-only mode does not emit client metrics. Allocation
resource usage, task driver stats, and node-level metrics are
only available from Nomad client agents. Add client agent
endpoints (also on port 4646) to your scrape targets alongside
the server endpoints.

**How does this relate to Consul and Vault monitoring?**

Nomad, Consul, and Vault form the HashiCorp stack and are often
deployed together. Each exposes Prometheus metrics via a similar
`/v1/metrics` pattern. Monitor all three by adding separate
scrape jobs in the same Collector config. See
[Consul Monitoring](./consul.md) and
[Vault Monitoring](./vault.md) for their respective guides.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Consul](./consul.md),
  [Vault](./vault.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to
  focus on Raft, scheduler, and RPC metrics for production
  alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Consul Monitoring](./consul.md)
  — HashiCorp Consul service mesh monitoring
- [Vault Monitoring](./vault.md)
  — HashiCorp Vault secrets engine monitoring
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Nomad metrics
