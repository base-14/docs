---
title: >
  Vault OpenTelemetry Monitoring - Seal State, Token Lifecycle,
  and Collector Setup
sidebar_label: Vault
id: collecting-vault-telemetry
sidebar_position: 19
description: >
  Collect Vault metrics with the OpenTelemetry Collector. Monitor seal
  state, request latency, and storage barrier performance using the
  Prometheus receiver and export to base14 Scout.
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

Vault serves Prometheus-format metrics at
`/v1/sys/metrics?format=prometheus` on the API port `8200`. Vault retains
Prometheus metrics by default, and the endpoint is token-gated, so the
OpenTelemetry Collector's `prometheus` receiver scrapes it with a Bearer
token, collecting 65+ metrics across
core leadership and seal state, token and auth operations, storage
barrier performance, lease management, and Go runtime. This guide
enables the endpoint, configures the receiver, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Vault                  | 1.1     | 1.18        |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Vault's HTTP API port (`8200`) must be reachable from the host running
  the Collector.
- Vault retains Prometheus metrics by default
  (`prometheus_retention_time` defaults to `24h`); setting it to `0`
  disables them.
- A Vault token with `read` capability on `sys/metrics` (see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

A few things shape how you read this surface:

- **`up` is the liveness signal, and it catches the sealed state.** A
  *sealed* Vault cannot read storage to build metrics, so
  `/v1/sys/metrics` returns HTTP `503` - the scrape fails and `up` drops
  to `0` (and `vault_core_unsealed` stops being scraped at the same
  time). So `up == 0` means Vault is down, sealed, or unreachable; for an
  authoritative sealed-vs-down split, check the unauthenticated
  `/v1/sys/seal-status` endpoint, which is outside the metrics pipeline.
  `vault_core_unsealed` reads `1` in normal operation as the in-band
  confirmation the node is unsealed.
- **The scrape needs a Vault token with `read` on `sys/metrics`**, and
  the endpoint is only reachable from the root namespace.
- **Only the active (leader) node serves metrics.** `vault_core_active`
  (`1` = leader) identifies it - point the Collector at the active node.
- **Three leadership metrics use a bare `core_*` prefix before Vault
  1.20.** `core_leadership_lost`, `core_leadership_setup_failed`, and
  `core_step_down` are emitted without the `vault_` prefix on Vault
  releases earlier than 1.20; Vault 1.20+ renamed them to the
  `vault_core_*` form. A keep filter matching `vault_.*|core_.*` retains
  them on either version.

### Core - is it up, unsealed, and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - `1` = the metrics endpoint responded (Vault up and unsealed). A sealed Vault returns `503`, so `up` drops to `0` when sealed, down, or unreachable. |
| `vault_core_unsealed` | `1` = this node is unsealed and serving. A sealed node returns `503` on the metrics endpoint, so this series stops being scraped while sealed - read it as the in-band unsealed confirmation, and use `up == 0` to catch the sealed/down state. |
| `vault_core_active` | `1` = this node is the active (leader) node in an HA cluster. |
| `vault_core_handle_request` | Latency and count of all requests Vault handled - headline throughput and latency. |
| `vault_expire_num_leases` | Number of active leases - a runaway count is a classic Vault incident (memory / storage pressure). |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Auth path | `vault_core_handle_login_request` | Login-request latency and count - auth load distinct from general requests. |
| Leadership | `core_leadership_lost`, `core_step_down`, `core_leadership_setup_failed` | HA leadership transitions; repeated events mean leader instability. (Bare `core_*` before Vault 1.20; `vault_core_*` from 1.20.) |
| Seal lifecycle | `vault_core_pre_seal`, `vault_core_post_unseal` | Seal / unseal step timing. |
| Leases | `vault_expire_num_irrevocable_leases`, `vault_expire_revoke`, `vault_expire_register_auth` | Leases Vault failed to revoke (non-zero needs investigation) and expiration-manager churn. |
| Tokens | `vault_token_create`, `vault_token_lookup`, `vault_token_revoke_tree`, `vault_token_store` | Token lifecycle volume and latency. |
| Seal crypto | `vault_seal_encrypt`, `vault_seal_encrypt_time`, `vault_seal_decrypt`, `vault_seal_decrypt_time` | Seal-wrap crypto count and latency - auto-unseal / HSM / KMS round-trip cost. |
| Storage barrier | `vault_barrier_get`, `vault_barrier_put`, `vault_barrier_delete`, `vault_barrier_list`, `vault_barrier_estimated_encryptions` | Encrypted storage-barrier operation latency and encryption count - Vault's throughput is bounded by the backend. |
| Cache | `vault_cache_hit`, `vault_cache_miss`, `vault_cache_write` | Physical-cache effectiveness in front of the storage backend. |
| Policy | `vault_policy_get_policy` | Policy fetch / evaluation latency. |
| Runtime | `vault_runtime_alloc_bytes`, `vault_runtime_num_goroutines`, `vault_runtime_gc_pause_ns`, `vault_runtime_heap_objects` | Vault process Go-runtime memory, goroutines, and GC pressure. |

Enterprise replication and performance-standby flags
(`vault_core_replication_performance_primary` / `_secondary`,
`vault_core_performance_standby`) read `0` on OSS and populate on Vault
Enterprise.

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Per-mount routing | `vault_route_read_secret_`, `vault_route_update_transit_`, `vault_route_read_auth_token_` | Per-mount request routing latency. The family carries the mount path, so it grows per engine. |
| Lease accounting | `vault_expire_fetch_lease_times`, `vault_expire_fetch_lease_times_by_token` | Lease-time accounting internals. |
| Core internals | `vault_core_mount`, `vault_core_unseal`, `vault_core_fetch` | Internal core-operation timings. |
| Runtime / process meta | `go_*`, `process_*` | Go-runtime and process series the endpoint also exposes. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | Prometheus scrape meta - receiver-side, not from Vault. |

Full metric list: run
`curl -s -H "X-Vault-Token: $VAULT_TOKEN" 'http://localhost:8200/v1/sys/metrics?format=prometheus'`
against your Vault instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier
series. The state checks (`== 0`) are exact; the rest are relative to
your own baseline. These are starting points - tune them to your
workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The metrics endpoint stopped responding - Vault is **down or sealed** (a sealed Vault returns `503`). Check the process, the API port, and `vault status` / the `/v1/sys/seal-status` endpoint. The most urgent Vault alert. |
| `vault_core_active` | `== 0` across all nodes | The HA cluster has no leader; clients cannot write. Check the cluster and storage backend. |
| `core_leadership_lost` / `core_step_down` | Rising (rate > 0) | Leadership is changing repeatedly - unstable HA. Check storage latency and networking. |
| `vault_core_handle_request` | Rising vs baseline | Request handling is slowing - correlate with storage barrier latency and load. |
| `vault_expire_num_leases` | Rising sharply vs baseline | Runaway lease creation exhausts memory / storage - find the source and shorten TTLs. |
| `vault_expire_num_irrevocable_leases` | `> 0` | Vault could not revoke leases - investigate the backend and force-revoke. |
| `vault_barrier_put` / `vault_barrier_get` | Rising vs baseline | The storage backend is slow - Vault throughput is bounded by it. |
| `vault_seal_encrypt_time` / `vault_seal_decrypt_time` | Rising vs baseline | Auto-unseal KMS / HSM round-trips are slow - check the seal provider. |
| `vault_runtime_alloc_bytes` / `vault_runtime_num_goroutines` | Rising vs baseline | Sustained pressure or a leak - correlate with lease count and request volume. |

## Access Setup

Vault retains Prometheus metrics by default, so the endpoint works out of
the box. The optional `telemetry` block below tunes retention and cleans
up metric labels:

```hcl showLineNumbers title="vault-config.hcl"
telemetry {
  prometheus_retention_time = "60s"
  disable_hostname          = true
}
```

- `prometheus_retention_time` defaults to `24h`; lower it (e.g. `60s`) to
  reduce in-memory retention, or set `0` to disable Prometheus metrics.
  Keep it at least 2x the scrape interval.
- `disable_hostname` strips hostname prefixes from metric names for
  cleaner Prometheus labels.

The endpoint is ACL-protected. Create a policy that grants `read` on
`sys/metrics` and mint a token for the Collector:

```bash showLineNumbers title="Create the monitoring token"
# Create a read-only monitoring policy
vault policy write otel-monitor - <<EOF
path "sys/metrics" {
  capabilities = ["read"]
}
EOF

# Create a token bound to that policy
vault token create -policy=otel-monitor -period=768h
```

Use the resulting token as the Collector's Bearer credential. A long
`-period` keeps it from expiring under a renewing client; rotate it on
your own schedule. Alternatively, set
`unauthenticated_metrics_access = true` in the listener's `telemetry`
block to drop the token requirement - not recommended in production.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Vault seal status
vault status

# Verify the Prometheus metrics endpoint
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
                - ${env:VAULT_HOST}:8200   # Point at the active (leader) node

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
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy `deployment.environment`
> is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
VAULT_HOST=localhost
VAULT_TOKEN=your_vault_monitoring_token
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### TLS

For Vault clusters with TLS on the API listener, scrape over `https`
and supply the CA:

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

### Scope to the Vault namespace

The metrics endpoint also exposes the endpoint's own `go_*` /
`process_*` runtime series and the prometheus `scrape_*` meta. To keep
only Vault's metrics, add a keep filter. Match `core_.*` as well as
`vault_.*` so the bare-`core_*` leadership metrics on Vault < 1.20 are
retained (Vault 1.20+ emits them as `vault_core_*`, which `vault_.*`
already covers):

```yaml showLineNumbers title="config/otel-collector.yaml (keep filter)"
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
# Check Collector logs for a successful Vault scrape
docker logs otel-collector 2>&1 | grep -i "vault"

# Confirm Vault is unsealed and active
vault status

# Check the metrics endpoint directly for the leader flag
curl -s -H "X-Vault-Token: $VAULT_TOKEN" \
  'http://localhost:8200/v1/sys/metrics?format=prometheus' \
  | grep vault_core_active
```

## Troubleshooting

### Metrics endpoint returns 403 or permission denied

**Cause**: The Vault token lacks `read` on `sys/metrics`, or the request
is not against the root namespace.

**Fix**:

1. Confirm the token policy includes
   `path "sys/metrics" { capabilities = ["read"] }`.
2. Check the token is valid: `vault token lookup $VAULT_TOKEN`.
3. Make the request against the root namespace - the metrics endpoint is
   only accessible there.

### Metrics endpoint returns JSON, empty, or 503

**Cause**: the request omitted `?format=prometheus` (Vault returns JSON
telemetry), `prometheus_retention_time` was set to `0` (Prometheus
metrics disabled), or Vault is sealed (a sealed Vault returns `503`).

**Fix**:

1. Include `?format=prometheus` in the scrape path.
2. Confirm `prometheus_retention_time` is non-zero - it defaults to `24h`;
   only an explicit `0` disables it.
3. Check Vault is unsealed: `vault status`. A sealed Vault returns `503`
   until unsealed.

### Standby node returns no metrics

**Cause**: The `/v1/sys/metrics` endpoint is only active on the leader.

**Look at**: `vault_core_active` - `1` identifies the leader.

**Fix**:

1. Point the Collector at the active node, or at a load balancer that
   routes to it.
2. Use `vault_core_active` to find which node is leading.
3. On Vault Enterprise, standby nodes can serve their own metrics when
   unauthenticated metrics access is enabled.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Does this work with Vault running in Kubernetes?

Yes. Set `targets` to the active-service DNS
(e.g., `vault-active.vault.svc.cluster.local:8200`) so the scrape always
hits the leader, and inject `VAULT_TOKEN` from a Kubernetes secret. The
Collector can run as a sidecar or a Deployment.

### How do I monitor a Vault HA cluster?

Only the active node serves metrics at `/v1/sys/metrics`, so point the
Collector at the active service endpoint and use `vault_core_active`
(`1` = leader) to confirm which node it is. For Vault Enterprise with
performance standbys, each standby can optionally expose its own metrics.

### Why do additional metrics appear after enabling secrets engines?

Vault generates metrics dynamically per active secrets engine, auth
method, and audit device. A production instance with multiple backends
emits more series - notably the per-mount `vault_route_*` family, which
carries the mount path - than a fresh dev server.

### What does `vault_barrier_estimated_encryptions` indicate?

It tracks the estimated number of barrier encryption operations since
the last rekey. Watch it for compliance requirements that mandate
periodic rekeying after a threshold of encryption operations.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Vault metrics.
- [Consul Monitoring](./consul.md) - The storage backend and service
  mesh that often sits behind Vault.
- [Nomad Monitoring](./nomad.md) - The workload scheduler that fetches
  secrets from Vault.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Consul](./consul.md), [Nomad](./nomad.md), and other components.
- **Fine-tune Collection**: Apply the `vault_.*|core_.*` keep filter to
  scope the scrape to Vault, and tune `scrape_interval` to your retention
  and alerting needs.
