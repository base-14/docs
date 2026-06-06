---
title: >
  etcd OpenTelemetry Monitoring - Leader Health, Raft Proposals,
  and Collector Setup
sidebar_label: etcd
id: collecting-etcd-telemetry
sidebar_position: 16
description: >
  Collect etcd metrics with the OpenTelemetry Collector. Monitor leader
  health, Raft proposals, WAL fsync, and backend commit latency, and ship
  to base14 Scout.
keywords:
  - etcd opentelemetry
  - etcd otel collector
  - etcd metrics monitoring
  - etcd performance monitoring
  - opentelemetry prometheus receiver etcd
  - etcd observability
  - etcd cluster monitoring
  - etcd telemetry collection
  - monitor etcd kubernetes
---

# etcd

etcd exposes Prometheus-format metrics at `/metrics` on its client port
(`2379`). The OpenTelemetry Collector scrapes this endpoint with the
Prometheus receiver, collecting 130+ metrics - of which 82 are `etcd_*` -
across leader and liveness state, Raft consensus, disk fsync and backend
commit latency, MVCC storage, and gRPC requests, on etcd 3.6+. This guide
configures the receiver, connects to an etcd node, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| etcd                   | 3.6     | 3.6.12      |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- etcd's client port (`2379`) must be reachable from the host running the
  Collector. The `/metrics` endpoint is served there.
- etcd serves `/metrics` over `http` with no authentication by default;
  production deployments front it with `https` and mTLS - see
  [Access Setup](#access-setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident or
capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - monitoring itself is alive. |
| `etcd_server_has_leader` | 1 if this member sees a leader; **0 means the cluster cannot serve writes**. The single load-bearing liveness signal. |
| `etcd_server_proposals_committed_total` | Committed Raft proposals - the cluster is making progress (write throughput). |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `etcd_server_leader_changes_seen_total` | Leader-election churn; sustained increases are pathological (Raft instability). |
| `etcd_server_proposals_failed_total` | Failed proposals - leader loss or quorum problems. |
| `etcd_server_proposals_pending` | Proposal backlog; a non-zero sustained value is saturation. |
| `etcd_server_health_failures` | Server health-check failures. |
| `etcd_server_heartbeat_send_failures_total` | Leader could not send heartbeats - peer-link or disk stall. |
| `etcd_server_slow_apply_total` | Applies that exceeded the slow threshold - disk or CPU saturation. |
| `etcd_server_slow_read_indexes_total` | Slow linearizable reads. |
| `etcd_server_read_indexes_failed_total` | Failed read-index requests. |
| `etcd_disk_wal_fsync_duration_seconds` | WAL fsync latency - etcd's primary disk-health signal. |
| `etcd_disk_backend_commit_duration_seconds` | Backend (bbolt) commit latency. |
| `etcd_mvcc_db_total_size_in_bytes` | On-disk DB size - tracked against the backend quota. |
| `etcd_server_quota_backend_bytes` | Configured backend quota; the denominator for the space-used alert. |
| `etcd_network_known_peers` | Known cluster peers - membership/dependency health. |

### Diagnostic - for investigation and tuning

Higher cardinality / debugging namespace; droppable in production with
`metric_relabel_configs` while keeping Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Debugging namespace | all `etcd_debugging_*` (lease_*, mvcc_*, snap_save_*, store_*, auth_revision) | Deep Raft/MVCC/lease/store internals during an incident. |
| MVCC operations | `etcd_mvcc_put_total`, `_range_total`, `_delete_total`, `_txn_total`, `_db_total_size_in_use_in_bytes`, `_db_open_read_transactions`, `_hash_duration_seconds`, `_hash_rev_duration_seconds` | Keyspace op mix, fragmentation (size vs size_in_use), compaction cost. |
| Disk (deep) | `etcd_disk_wal_write_bytes_total`, `_wal_write_duration_seconds`, `_backend_defrag_duration_seconds`, `_backend_snapshot_duration_seconds`, `_defrag_inflight` | WAL write volume; defrag/snapshot timing. |
| Snapshot | `etcd_snap_db_fsync_duration_seconds`, `_db_save_total_duration_seconds`, `etcd_snap_fsync_duration_seconds` | Snapshot persistence latency. |
| Apply / range timing | `etcd_server_apply_duration_seconds`, `etcd_server_range_duration_seconds`, `etcd_server_client_requests_total` | Per-op latency distribution. |
| gRPC proxy | `etcd_grpc_proxy_*` (cache_hits/misses/keys, events/watchers_coalescing) | Only when running the gRPC proxy. |
| Client network | `etcd_network_client_grpc_received_bytes_total`, `_sent_bytes_total` | Client traffic volume. |
| Inventory / state | `etcd_server_id`, `_version`, `_go_version`, `etcd_server_is_leader`, `_is_learner`, `_learner_promote_successes`, `_feature_enabled`, `_snapshot_apply_in_progress_total`, `etcd_cluster_version` | Identity, version, leader/learner state. |
| Runtime | `go_*`, `process_*`, `grpc_server_*`, `os_fd_*`, `promhttp_*`, `scrape_*`, `up` | Go/process/gRPC/scrape health. |

Full metric list: see the
[etcd metrics reference](https://etcd.io/docs/latest/op-guide/monitoring/),
or run `curl -s http://localhost:2379/metrics` against your etcd instance.

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. The
disk-latency numbers are etcd's documented operational guidance (etcd
hardware/ops docs); tune to your storage.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `etcd_server_has_leader` | - | `== 0` | No leader: cluster cannot serve writes. Investigate quorum / peer links immediately. |
| `rate(etcd_server_leader_changes_seen_total)` | `> 0` sustained | Rising across windows | Raft instability; check disk latency and network between peers. |
| `rate(etcd_server_proposals_failed_total)` | `> 0` sustained | Rising | Quorum or leader problems; correlate with leader changes. |
| `etcd_server_proposals_pending` | `> 0` sustained | Growing | Apply pipeline backed up; check disk saturation. |
| `etcd_disk_wal_fsync_duration_seconds` (p99) | `> 10ms` | `> 25ms` | Slow WAL fsync stalls consensus. Move etcd to faster disk / dedicate IO. |
| `etcd_disk_backend_commit_duration_seconds` (p99) | `> 25ms` | `> 50ms` | Slow backend commits; same disk-IO remedy. |
| `etcd_mvcc_db_total_size_in_bytes / etcd_server_quota_backend_bytes` | `> 0.80` | `> 0.95` | Approaching the backend quota; a NOSPACE alarm halts writes. Defrag / raise quota / compact. |
| `etcd_server_heartbeat_send_failures_total` | `> 0` | Sustained | Leader can't heartbeat peers; disk stall or partition. |

The two `*_duration_seconds` rows are Prometheus histograms - there is no
ready-made `p99` series to threshold. Compute the percentile from the
histogram buckets in your alert rule, for example
`histogram_quantile(0.99, rate(<metric>_bucket[5m]))`, rather than alerting
on a `p99` series directly.

## Access Setup

Verify your etcd instance is accessible and serving metrics:

```bash showLineNumbers title="Verify access"
# Check cluster health
etcdctl endpoint health

# List all keys (empty cluster returns nothing)
etcdctl get "" --prefix --keys-only

# Verify metrics endpoint
curl -s http://localhost:2379/metrics | head -20
```

No authentication is required for the `/metrics` endpoint on an `http`
client port. Production etcd runs `https` with mTLS - the scrape job needs
client certificates, configured in [Configuration](#configuration) below.

:::note Port conflict in Kubernetes
etcd uses port 2379, which conflicts with the Kubernetes control-plane etcd.
If running both, remap the host port in Docker Compose (for example
`12379:2379`) or target the non-Kubernetes etcd address directly.
:::

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: etcd
          scrape_interval: 10s
          static_configs:
            - targets:
                # host:port etcd's /metrics is reachable on
                - ${env:ETCD_HOST}:${env:ETCD_PORT}

processors:
  resource:
    attributes:
      - key: deployment.environment.name
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

### Environment Variables

```bash showLineNumbers title=".env"
ETCD_HOST=localhost
# Port etcd's /metrics is reachable on: 2379 in-cluster or in-network. If etcd
# runs in a container that remaps the port on the host - for example to avoid
# the Kubernetes control-plane etcd, also on 2379 - set this to that port.
ETCD_PORT=2379
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### TLS for production etcd

Production etcd serves metrics over `https` with mTLS. Add the scheme and
client certificates to the scrape job, and mount the certificate files into
the Collector container:

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
                - ${env:ETCD_HOST}:${env:ETCD_PORT}
```

### Controlling metric volume

etcd exposes 130+ metrics including the `etcd_debugging_*` namespace, Go
runtime, and Prometheus internals. The Prometheus receiver scrapes the full
`/metrics` surface with no whitelist - every series etcd exposes flows
through, and new series appear automatically after an etcd upgrade with no
config change. To drop the Diagnostic tier in production while keeping
Core + Operational, add a `metric_relabel_configs` block to the scrape job:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "etcd_debugging_.*"
              action: drop
```

> **Semconv version note**: `deployment.environment.name` is the current
> dotted OTel attribute. The legacy `deployment.environment` is still
> accepted by Scout for backward compatibility, but new configs should emit
> the dotted form.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped etcd metrics
docker logs otel-collector 2>&1 | grep -i "etcd"

# Verify etcd is healthy
etcdctl endpoint health

# Check the leader signal directly on the metrics endpoint
curl -s http://localhost:2379/metrics | grep etcd_server_has_leader

# Generate write traffic so proposal counters advance
etcdctl put app/example value
```

## Troubleshooting

### Connection refused on port 2379

**Cause**: Collector cannot reach etcd at the configured address.

**Fix**:

1. Verify etcd is running: `docker ps | grep etcd` or
   `systemctl status etcd`.
2. Confirm `--listen-client-urls` includes the address the Collector
   connects to.
3. Check firewall rules if the Collector runs on a separate host.

### Metrics endpoint returns empty or 404

**Cause**: etcd is configured with `--listen-metrics-urls`, which moves the
metrics endpoint to a different address.

**Fix**:

1. Check whether `--listen-metrics-urls` is set:
   `ps aux | grep etcd | grep listen-metrics`.
2. If set, update the scrape target to match that address and port.
3. If not set, metrics are served on the client port (2379).

### Consensus is unstable or writes stall

**Cause**: Slow disk fsync or peer-link problems are destabilising Raft.

**Look at**: `etcd_disk_wal_fsync_duration_seconds` and
`etcd_disk_backend_commit_duration_seconds` (Operational disk latency);
`etcd_server_leader_changes_seen_total` and
`etcd_server_heartbeat_send_failures_total` for the election churn and
heartbeat failures that follow. For deeper timing, the Diagnostic
`etcd_disk_wal_write_duration_seconds` and `etcd_server_apply_duration_seconds`
break down where the latency lands.

**Fix**:

1. Move etcd to faster, dedicated storage if WAL fsync p99 exceeds 10ms.
2. Investigate the network between peers if heartbeat failures climb.

### Database approaching the backend quota

**Cause**: The keyspace has grown toward `etcd_server_quota_backend_bytes`;
a NOSPACE alarm halts writes once it is hit.

**Look at**: `etcd_mvcc_db_total_size_in_bytes` against the quota
(Operational). A large gap between `etcd_mvcc_db_total_size_in_bytes` and the
Diagnostic `etcd_mvcc_db_total_size_in_use_in_bytes` indicates fragmentation.

**Fix**:

1. Run `etcdctl defrag` to reclaim fragmented space.
2. Compact old revisions, or raise the backend quota.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with etcd running in Kubernetes?**

Yes. Set `targets` to the etcd pod or service DNS (for example
`etcd-0.etcd.kube-system.svc.cluster.local:2379`). For managed Kubernetes
(EKS, GKE, AKS), the control-plane etcd may not be directly accessible -
check your provider's documentation.

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

Each member is scraped on its in-network client port - `2379`, the
`ETCD_PORT` default - and identified by its `instance` label. Watch
`etcd_network_known_peers` and `etcd_server_has_leader` per member to
confirm the cluster sees quorum.

**Why does `etcd_server_proposals_pending` stay above zero?**

A small number of pending proposals is normal under write load. Sustained
high values mean the cluster cannot commit proposals fast enough - check disk
latency (`etcd_disk_wal_fsync_duration_seconds`) and the
`etcd_server_slow_apply_total` counter.

**What is the difference between `db_total_size` and `db_total_size_in_use`?**

`etcd_mvcc_db_total_size_in_bytes` includes space freed by compaction but not
yet reclaimed (fragmentation). `etcd_mvcc_db_total_size_in_use_in_bytes`
reflects actual data. A large gap between the two indicates fragmentation -
run `etcdctl defrag` to reclaim space.

**Which metrics can I drop to reduce volume?**

The `etcd_debugging_*` namespace (30 series) plus the Go runtime, process,
and gRPC-proxy families are Diagnostic - drop them with
`metric_relabel_configs` and keep the Core and Operational tiers. They are
worth re-enabling during an incident or capacity review.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on etcd metrics.
- [ZooKeeper Monitoring](./zookeeper.md) -
  Coordination service for systems that pre-date etcd.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [ZooKeeper](./zookeeper.md), [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic `etcd_debugging_*` tier in
  production with `metric_relabel_configs` to control volume; keep it
  available for incident investigation.
