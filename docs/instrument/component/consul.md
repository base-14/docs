---
title: >
  Consul OpenTelemetry Monitoring — Raft Consensus, Service Catalog,
  and Collector Setup
sidebar_label: Consul
id: collecting-consul-telemetry
sidebar_position: 18
description: >
  Collect Consul metrics with the OpenTelemetry Collector. Monitor
  Raft consensus, service catalog state, and RPC request rates using
  the Prometheus receiver and export to base14 Scout.
keywords:
  - consul opentelemetry
  - consul otel collector
  - consul metrics monitoring
  - consul performance monitoring
  - opentelemetry prometheus receiver consul
  - consul observability
  - consul service discovery monitoring
  - consul telemetry collection
---

# Consul

Consul exposes Prometheus-format metrics at
`/v1/agent/metrics?format=prometheus` when
`prometheus_retention_time` is set in the agent configuration. The
OpenTelemetry Collector scrapes this endpoint using the Prometheus
receiver, collecting 230+ metrics across Raft consensus, service
catalog state, RPC requests, gossip protocol health, and runtime
statistics. This guide configures the receiver, enables the metrics
endpoint, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Consul                 | 1.7.2   | 1.21+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Consul HTTP API port (8500) must be accessible from the host
  running the Collector
- `prometheus_retention_time` must be set in the agent telemetry
  config (not enabled by default)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Raft Consensus**: leader status, commit time, peer count, log
  dispatch latency, FSM saturation, WAL operations
- **Service Catalog**: registrations, deregistrations, service
  queries, connect queries, node and service instance counts
- **RPC & gRPC**: request counts, errors, rate limiting,
  cross-datacenter calls, blocking queries, connections
- **Gossip & Membership**: serf events, gossip rounds, member joins,
  queue depths, client and server member counts
- **Service Mesh**: CA certificate expiry, xDS streams, leaf
  certificates, peering health, exported services
- **Runtime**: allocated memory, GC pause duration, goroutines, heap
  objects

Full metric list: run
`curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus'`
against your Consul instance.

## Access Setup

Enable the Prometheus metrics endpoint by adding `telemetry` config
to the Consul agent:

```json showLineNumbers title="consul-config.json"
{
  "telemetry": {
    "prometheus_retention_time": "60s",
    "disable_hostname": true
  }
}
```

- `prometheus_retention_time` must be greater than `0s` to enable
  Prometheus metrics (default is `0s` — disabled)
- `disable_hostname` removes hostname prefixes from gauge metrics for
  cleaner Prometheus labels
- Set retention time to at least 2x the scrape interval

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Consul is running
curl -s http://localhost:8500/v1/status/leader

# Verify Prometheus metrics endpoint
curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus' \
  | head -20
```

No authentication is required by default. For ACL-enabled clusters,
see [Authentication](#authentication) below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          scrape_interval: 30s
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:CONSUL_HOST}:8500

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
CONSUL_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For Consul clusters with ACLs enabled, the scrape request needs a
token with `agent:read` permission:

```yaml showLineNumbers title="config/otel-collector.yaml (ACL)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:CONSUL_TOKEN}
          static_configs:
            - targets:
                - ${env:CONSUL_HOST}:8500
```

### Filtering Metrics

Consul exposes 230+ metrics including Go runtime and process
statistics. To collect only Consul-specific metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          scrape_interval: 30s
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:CONSUL_HOST}:8500
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "consul_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "consul"

# Verify Consul is healthy
curl -s http://localhost:8500/v1/status/leader

# Check metrics endpoint directly
curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus' \
  | grep consul_raft_peers
```

## Troubleshooting

### Metrics endpoint returns empty or 404

**Cause**: `prometheus_retention_time` is not configured or set to
`0s`.

**Fix**:

1. Add `"prometheus_retention_time": "60s"` to the `telemetry` block
   in the agent config
2. Restart the Consul agent
3. Verify: `curl 'http://localhost:8500/v1/agent/metrics?format=prometheus'`

### Connection refused on port 8500

**Cause**: Collector cannot reach Consul at the configured address.

**Fix**:

1. Verify Consul is running: `docker ps | grep consul` or
   `consul members`
2. Confirm the HTTP API address:
   `consul info | grep client_addr`
3. Check firewall rules if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### ACL permission denied

**Cause**: The token lacks `agent:read` permission.

**Fix**:

1. Create a policy with `agent_prefix "" { policy = "read" }`
2. Attach the policy to a token and set it in `CONSUL_TOKEN`
3. Test: `curl -H "Authorization: Bearer $CONSUL_TOKEN" 'http://localhost:8500/v1/agent/metrics?format=prometheus'`

## FAQ

**Does this work with Consul running in Kubernetes?**

Yes. Set `targets` to the Consul service DNS
(e.g., `consul-server.consul.svc.cluster.local:8500`). Ensure the
Consul Helm chart has `global.metrics.enabled: true` and
`prometheus_retention_time` set in the server config. The Collector
can run as a sidecar or DaemonSet.

**How do I monitor a multi-node Consul cluster?**

Each Consul agent exposes its own metrics endpoint. Add all server
endpoints to the scrape config:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - consul-1:8500
                - consul-2:8500
                - consul-3:8500
```

Each agent is scraped independently and identified by its `instance`
label.

**Why are Raft metrics only appearing on one node?**

Raft leadership metrics like `consul_raft_leader_lastContact` and
`consul_raft_leader_dispatchLog` are only emitted by the current
leader. Other servers emit follower-side metrics like
`consul_raft_state_follower`. This is expected behavior.

**What does `consul_autopilot_healthy` mean?**

A value of `1` means Autopilot considers the cluster healthy — enough
voters are alive and reachable. A value of `0` indicates the cluster
is degraded. Monitor this alongside `consul_raft_peers` and
`consul_members_servers`.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [etcd](./etcd.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  Raft, catalog, and RPC metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [etcd Monitoring](./etcd.md)
  — Distributed key-value store monitoring
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Consul metrics
