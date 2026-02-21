---
title: >
  etcd OpenTelemetry Monitoring — Raft Proposals, Disk Latency,
  and Collector Setup
sidebar_label: etcd
id: collecting-etcd-telemetry
sidebar_position: 16
description: >
  Collect etcd metrics with the OpenTelemetry Collector. Monitor Raft
  proposals, disk latency, and cluster health using the Prometheus
  receiver and export to base14 Scout.
keywords:
  - etcd opentelemetry
  - etcd otel collector
  - etcd metrics monitoring
  - etcd performance monitoring
  - opentelemetry prometheus receiver etcd
  - etcd observability
  - etcd cluster monitoring
  - etcd telemetry collection
---

# etcd

etcd exposes Prometheus-format metrics on its client port at
`/metrics`. The OpenTelemetry Collector scrapes this endpoint using
the Prometheus receiver, collecting 25+ metrics across server health,
Raft consensus, disk I/O, MVCC storage, and gRPC requests. This
guide configures the receiver, connects to an etcd node, and ships
metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| etcd                   | 3.4     | 3.5+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- etcd client port (2379) must be accessible from the host running
  the Collector
- No authentication required for the metrics endpoint by default
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Server**: leader status, leader changes, committed/pending/failed
  Raft proposals, slow applies, backend quota
- **Disk**: WAL fsync latency, backend commit latency, WAL bytes
  written
- **Network**: gRPC client bytes sent/received, peer bytes
  sent/received (peer metrics only in multi-node clusters)
- **MVCC Storage**: database size, active size, put/delete/range
  counts, transaction counts
- **gRPC**: completed RPCs, started RPCs, messages sent/received

Full metric list: run `curl -s http://localhost:2379/metrics`
against your etcd instance.

## Access Setup

Verify your etcd instance is accessible:

```bash showLineNumbers title="Verify access"
# Check cluster health
etcdctl endpoint health

# List all keys (empty cluster returns nothing)
etcdctl get "" --prefix --keys-only

# Verify metrics endpoint
curl -s http://localhost:2379/metrics | head -20
```

No authentication is required for the `/metrics` endpoint by default.
For TLS-enabled clusters, see [Authentication](#authentication)
below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: etcd
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:ETCD_HOST}:2379

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
ETCD_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For TLS-enabled etcd clusters, add TLS config to the scrape job:

```yaml showLineNumbers title="config/otel-collector.yaml (TLS)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: etcd
          scheme: https
          tls_config:
            ca_file: /certs/ca.pem
            cert_file: /certs/client.pem
            key_file: /certs/client-key.pem
          static_configs:
            - targets:
                - ${env:ETCD_HOST}:2379
```

Mount the certificate files into the Collector container.

### Filtering Metrics

etcd exposes 100+ metrics including Go runtime and Prometheus
internals. To collect only etcd-specific metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: etcd
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:ETCD_HOST}:2379
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "etcd_.*|grpc_server_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "etcd"

# Verify etcd is healthy
etcdctl endpoint health

# Check metrics endpoint directly
curl -s http://localhost:2379/metrics | grep etcd_server_has_leader
```

## Troubleshooting

### Connection refused on port 2379

**Cause**: Collector cannot reach etcd at the configured address.

**Fix**:

1. Verify etcd is running: `docker ps | grep etcd` or
   `systemctl status etcd`
2. Confirm `--listen-client-urls` includes the address the
   Collector connects to
3. Check firewall rules if the Collector runs on a separate host

### Metrics endpoint returns empty or 404

**Cause**: etcd is configured with `--listen-metrics-urls` which
moves the metrics endpoint to a different address.

**Fix**:

1. Check if `--listen-metrics-urls` is set:
   `ps aux | grep etcd | grep listen-metrics`
2. If set, update the scrape target to match that address and port
3. If not set, metrics are served on the client port (2379)

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Peer network metrics missing

**Cause**: `etcd_network_peer_*` metrics only appear in multi-node
clusters.

**Fix**:

1. Standalone etcd nodes do not emit peer metrics — this is
   expected
2. In a cluster, verify all members are communicating:
   `etcdctl member list`
3. Check `etcd_server_has_leader` — if 0, the cluster may be
   unhealthy

## FAQ

**Does this work with etcd running in Kubernetes?**

Yes. Set `targets` to the etcd pod or service DNS
(e.g., `etcd-0.etcd.kube-system.svc.cluster.local:2379`). For
managed Kubernetes (EKS, GKE, AKS), the control-plane etcd may not
be directly accessible — check your provider's documentation.

**How do I monitor an etcd cluster?**

Add all member endpoints to the scrape config:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: etcd
          static_configs:
            - targets:
                - etcd-1:2379
                - etcd-2:2379
                - etcd-3:2379
```

Each member is scraped independently and identified by its
`instance` label.

**Why does `etcd_server_proposals_pending` stay above zero?**

A small number of pending proposals is normal under write load.
Sustained high values indicate the cluster cannot commit proposals
fast enough — check disk latency (`etcd_disk_wal_fsync_duration`)
and network health (`etcd_network_peer_*`).

**What is the difference between `db_total_size` and
`db_total_size_in_use`?**

`etcd_mvcc_db_total_size_in_bytes` includes space freed by
compaction but not yet reclaimed (fragmentation).
`etcd_mvcc_db_total_size_in_use_in_bytes` reflects actual data.
A large gap between the two indicates fragmentation — run
`etcdctl defrag` to reclaim space.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [ZooKeeper](./zookeeper.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to filter
  specific metric families and reduce storage volume

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on etcd metrics
- [ZooKeeper Monitoring](./zookeeper.md)
  — Coordination service monitoring
