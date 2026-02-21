---
title: >
  Vault OpenTelemetry Monitoring — Seal Operations, Token Lifecycle,
  and Collector Setup
sidebar_label: Vault
id: collecting-vault-telemetry
sidebar_position: 19
description: >
  Collect Vault metrics with the OpenTelemetry Collector. Monitor
  seal operations, token lifecycle, and storage barrier latency
  using the Prometheus receiver and export to base14 Scout.
keywords:
  - vault opentelemetry
  - vault otel collector
  - vault metrics monitoring
  - vault performance monitoring
  - opentelemetry prometheus receiver vault
  - vault observability
  - vault secrets monitoring
  - vault telemetry collection
---

# Vault

Vault exposes Prometheus-format metrics at
`/v1/sys/metrics?format=prometheus` when `prometheus_retention_time`
is set in the server configuration. The OpenTelemetry Collector
scrapes this endpoint using the Prometheus receiver, collecting 65+
metrics across core leadership, token operations, storage barrier
performance, seal encrypt/decrypt, and lease management. This guide
configures the receiver, enables the metrics endpoint, and ships
metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Vault                  | 1.1     | 1.19+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Vault HTTP API port (8200) must be accessible from the host
  running the Collector
- `prometheus_retention_time` must be set in the server telemetry
  config (not enabled by default)
- A Vault token with `read` capability on `sys/metrics` is required
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Core & Leadership**: active status, unseal state, leadership
  changes, in-flight requests, mount table size, standby mode
- **Token & Auth**: token creation, lookup, revocation, ACL checks,
  policy lookups, accessor operations
- **Storage Barrier**: get, put, delete, list operations, estimated
  encryptions
- **Seal Operations**: encrypt and decrypt counts, encrypt and
  decrypt timing
- **Leases & Expiration**: active leases, irrevocable leases, auth
  registrations, revocations by token
- **Runtime**: allocated memory, GC pause duration, goroutines, heap
  objects

Full metric list: run
`curl -s -H "X-Vault-Token: $VAULT_TOKEN" 'http://localhost:8200/v1/sys/metrics?format=prometheus'`
against your Vault instance.

## Access Setup

Enable the Prometheus metrics endpoint by adding `telemetry` config
to the Vault server configuration:

```hcl showLineNumbers title="vault-config.hcl"
telemetry {
  prometheus_retention_time = "60s"
  disable_hostname         = true
}
```

- `prometheus_retention_time` must be greater than `0s` to enable
  Prometheus metrics (default is `0s` — disabled)
- `disable_hostname` removes hostname prefixes from metric names for
  cleaner Prometheus labels
- Set retention time to at least 2x the scrape interval

Create a policy for the monitoring token:

```bash showLineNumbers title="Verify access"
# Create a monitoring policy
vault policy write otel-monitor - <<EOF
path "sys/metrics" {
  capabilities = ["read"]
}
EOF

# Create a token with the monitoring policy
vault token create -policy=otel-monitor -period=768h
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Vault seal status
vault status

# Verify Prometheus metrics endpoint
curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
  'http://localhost:8200/v1/sys/metrics?format=prometheus' \
  | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: vault
          scrape_interval: 30s
          metrics_path: /v1/sys/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:VAULT_TOKEN}
          static_configs:
            - targets:
                - ${env:VAULT_HOST}:8200

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
VAULT_HOST=localhost
VAULT_TOKEN=your_vault_monitoring_token
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### TLS Configuration

For production Vault clusters with TLS enabled:

```yaml showLineNumbers title="config/otel-collector.yaml (TLS)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: vault
          scheme: https
          metrics_path: /v1/sys/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:VAULT_TOKEN}
          tls_config:
            ca_file: /certs/vault-ca.pem
          static_configs:
            - targets:
                - ${env:VAULT_HOST}:8200
```

### Filtering Metrics

To collect only Vault-specific metrics and exclude Go runtime and
process statistics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: vault
          scrape_interval: 30s
          metrics_path: /v1/sys/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:VAULT_TOKEN}
          static_configs:
            - targets:
                - ${env:VAULT_HOST}:8200
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "vault_.*|core_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "vault"

# Verify Vault is unsealed and active
vault status

# Check metrics endpoint directly
curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
  'http://localhost:8200/v1/sys/metrics?format=prometheus' \
  | grep vault_core_active
```

## Troubleshooting

### Metrics endpoint returns 403 or permission denied

**Cause**: The Vault token lacks `read` capability on `sys/metrics`.

**Fix**:

1. Verify the token policy includes
   `path "sys/metrics" { capabilities = ["read"] }`
2. Check the token is valid: `vault token lookup $VAULT_TOKEN`
3. Ensure the request is made against the root namespace — the
   metrics endpoint is only accessible from the root namespace

### Metrics endpoint returns empty or 500

**Cause**: `prometheus_retention_time` is not configured or set to
`0s`.

**Fix**:

1. Add `prometheus_retention_time = "60s"` to the `telemetry` block
   in the Vault server config
2. Restart or reload the Vault server
3. Verify: `curl -H "X-Vault-Token: $VAULT_TOKEN" 'http://localhost:8200/v1/sys/metrics?format=prometheus'`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Standby node returns no metrics

**Cause**: The `/v1/sys/metrics` endpoint is only active on the
leader node.

**Fix**:

1. Point the Collector at the active node or a load balancer that
   routes to it
2. In Vault Enterprise, standby nodes can serve their own metrics
   when unauthenticated metrics access is enabled
3. Use `vault_core_active` (1 = leader) to identify the active node

## FAQ

**Does this work with Vault running in Kubernetes?**

Yes. Set `targets` to the Vault service DNS
(e.g., `vault-active.vault.svc.cluster.local:8200`). Use a
Kubernetes secret to inject `VAULT_TOKEN`. The Collector can run as
a sidecar or DaemonSet. Target the `-active` service to ensure
scraping the leader.

**How do I monitor a Vault HA cluster?**

Only the active node serves metrics at `/v1/sys/metrics`. Point the
Collector at the active service endpoint. For Vault Enterprise with
performance standbys, each standby can optionally expose its own
metrics:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: vault
          metrics_path: /v1/sys/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:VAULT_TOKEN}
          static_configs:
            - targets:
                - vault-active:8200
```

**Why do additional metrics appear after enabling secrets engines?**

Vault dynamically generates metrics for active secrets engines,
auth methods, and audit devices. A production instance with multiple
backends emits significantly more metrics than a fresh dev server.
Use `metric_relabel_configs` to control volume.

**What does `vault_barrier_estimated_encryptions` indicate?**

This counter tracks the estimated number of barrier encryption
operations since the last rekey. Monitor this for compliance
requirements that mandate periodic rekeying after a threshold of
encryption operations.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Consul](./consul.md),
  [etcd](./etcd.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  core, token, and barrier metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Consul Monitoring](./consul.md)
  — Service discovery monitoring (commonly used with Vault)
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Vault metrics
