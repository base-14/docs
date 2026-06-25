---
title: >
  ZooKeeper OpenTelemetry Monitoring - Health, Request Latency,
  and Collector Setup
sidebar_label: ZooKeeper
id: collecting-zookeeper-telemetry
sidebar_position: 13
description: >
  Collect ZooKeeper metrics with the OpenTelemetry Collector. Monitor the
  ruok health check, request latency, active connections, and znode counts,
  and ship to base14 Scout.
keywords:
  - zookeeper opentelemetry
  - zookeeper otel collector
  - zookeeper metrics monitoring
  - zookeeper performance monitoring
  - opentelemetry zookeeper receiver
  - zookeeper observability
  - monitor zookeeper kubernetes
  - zookeeper telemetry collection
---

# ZooKeeper

The OpenTelemetry Collector's `zookeeperreceiver` collects 16 metrics from
ZooKeeper 3.5+, spanning active connections, request latency, znode counts,
watches, file descriptors, and the `ruok` health check. The receiver connects
over plain TCP to the client port and parses the `mntr` and `ruok`
four-letter-word (4LW) commands - no exporter sidecar needed. This guide
configures the receiver, whitelists the required 4LW commands, and ships
metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended  |
| ---------------------- | ------- | ------------ |
| ZooKeeper              | 3.5     | 3.9+ (3.9.5) |
| OTel Collector Contrib | 0.90.0  | 0.153.0      |
| base14 Scout           | Any     | -            |

Before starting:

- The ZooKeeper client port (2181) must be reachable from the host running
  the Collector.
- The `mntr` and `ruok` four-letter-word commands must be whitelisted -
  ZooKeeper 3.5.3+ disables them by default (see [Access Setup](#access-setup)).
- ZooKeeper must use the default metrics provider, not
  `PrometheusMetricsProvider`; with the Prometheus provider the `mntr` format
  changes and the receiver cannot parse it.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. The `zookeeperreceiver` connects over plain TCP and reads the `mntr`
and `ruok` 4LW output, so a few surface facts shape what you see:

- **ZooKeeper has its own health signal.** There is no `up` series on this
  surface (that belongs to the Prometheus receiver), but `ruok` returns
  `imok`, surfaced as `zookeeper.ruok` (1 = imok). Liveness is the receiver
  scraping successfully *plus* `zookeeper.ruok` = 1. There is no uptime
  counter here.
- **The 4LW commands must be whitelisted.** ZooKeeper 3.5.3+ disables `mntr`
  and `ruok` by default; without whitelisting them the receiver gets nothing.
- **Three metrics are role- or condition-gated.**
  `zookeeper.follower.count` and `zookeeper.sync.pending` are leader-only and
  emit no series on a standalone or follower node;
  `zookeeper.fsync.exceeded_threshold.count` is absent until a fsync first
  exceeds the warn threshold. Leave them enabled - they populate under the
  right role or condition.
- **Resource attributes.** The receiver stamps `server.state`
  (leader / follower / standalone) and `zk.version` on every metric.
- **The default metrics provider is required.** If ZooKeeper's
  `metricsProvider.className` is `PrometheusMetricsProvider`, the `mntr`
  format changes and the receiver cannot parse it.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `zookeeper.ruok` | Health response (1 = imok) - the headline liveness signal. There is no `up` on this surface; liveness is scrape success plus `ruok` = 1. |
| `zookeeper.connection.active` | Active client connections - client load. |
| `zookeeper.latency.avg` | Average request-processing latency (ms) - the serving KPI. |
| `zookeeper.znode.count` | Total znodes - data-tree size / state. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `zookeeper.latency.max` | Worst-case request latency (ms) - tail latency. |
| `zookeeper.request.active` | In-flight (outstanding) requests - backlog / saturation. |
| `zookeeper.watch.count` | Watches set - watch storms and per-watch memory. |
| `zookeeper.packet.count` | Packets received/sent by `direction` - protocol throughput. |
| `zookeeper.file_descriptor.open` / `zookeeper.file_descriptor.limit` | Open file descriptors against the limit - fd saturation. |
| `zookeeper.fsync.exceeded_threshold.count` | Fsyncs exceeding the warn threshold - txn-log disk too slow. Silent until the first breach. |
| `zookeeper.follower.count` / `zookeeper.sync.pending` | Followers connected to the leader and pending leader→follower syncs. Leader-only. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
|---|---|
| `zookeeper.latency.min` | Best-case request latency (ms). |
| `zookeeper.data_tree.ephemeral_node.count` | Ephemeral znodes (session-tied) - drops when sessions close. |
| `zookeeper.data_tree.size` | Approximate data-tree size in bytes. |

Full metric reference:
[OTel ZooKeeper Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/zookeeperreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. Most are
relative to your own baseline; `zookeeper.ruok`, the fsync counter, and the
follower count read ZooKeeper's own state and events rather than an invented
absolute. Tune to your workload; these are starting points.

| Alert | Condition | Why it matters |
|---|---|---|
| ZooKeeper unhealthy | `zookeeper.ruok` != 1, or the receiver produces no data for > 1m | `ruok` is ZooKeeper's own health flag; not `imok` (or no data) means the node is unhealthy. Check the process, disk, and 4LW whitelist. |
| Request latency rising | `zookeeper.latency.avg` / `zookeeper.latency.max` rising vs baseline | Slow request processing - check disk, GC, and load. |
| Outstanding requests | `zookeeper.request.active` rising vs baseline | Request backlog building - correlate with latency and connections. |
| FD saturation | `zookeeper.file_descriptor.open` approaching `zookeeper.file_descriptor.limit` | Approaching the descriptor ceiling - raise the ulimit before connections are refused. |
| Fsync too slow | `rate(zookeeper.fsync.exceeded_threshold.count)` > 0 | The txn-log disk cannot keep up with fsync; move the `dataLogDir` to faster storage. |
| Followers missing | `zookeeper.follower.count` below the expected ensemble size (on the leader) | A member is disconnected - quorum is at risk. Check the down node and network. |

## Access Setup

The receiver connects to ZooKeeper over plain TCP on the client port - no
authentication or monitoring user is required. It does need the `mntr` and
`ruok` four-letter-word commands, which ZooKeeper 3.5.3+ disables by default.

Whitelist them in `zoo.cfg`:

```text showLineNumbers title="zoo.cfg"
4lw.commands.whitelist=mntr,ruok,srvr
```

For Docker deployments, set the environment variable instead:

```bash showLineNumbers
ZOO_4LW_COMMANDS_WHITELIST=mntr,ruok,srvr
```

Restart ZooKeeper after changing the whitelist, then verify the commands
respond:

```bash showLineNumbers title="Verify 4LW access"
# Test mntr (metrics)
echo "mntr" | nc localhost 2181

# Test ruok (health check) - should return "imok"
echo "ruok" | nc localhost 2181
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  zookeeper:
    endpoint: localhost:2181   # Change to your <zookeeper-host>:2181
    collection_interval: 10s

    metrics:
      # Connections
      zookeeper.connection.active:
        enabled: true

      # Latency
      zookeeper.latency.avg:
        enabled: true
      zookeeper.latency.max:
        enabled: true
      zookeeper.latency.min:
        enabled: true

      # Data tree
      zookeeper.znode.count:
        enabled: true
      zookeeper.data_tree.ephemeral_node.count:
        enabled: true
      zookeeper.data_tree.size:
        enabled: true
      zookeeper.watch.count:
        enabled: true

      # Packets
      zookeeper.packet.count:
        enabled: true

      # Requests
      zookeeper.request.active:
        enabled: true

      # Resources
      zookeeper.file_descriptor.open:
        enabled: true
      zookeeper.file_descriptor.limit:
        enabled: true

      # Health
      zookeeper.ruok:
        enabled: true
      zookeeper.fsync.exceeded_threshold.count:
        enabled: true

      # Leader-only (only emitted when server is a leader)
      zookeeper.follower.count:
        enabled: true
      zookeeper.sync.pending:
        enabled: true

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
      receivers: [zookeeper]
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
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the ZooKeeper receiver
docker logs otel-collector 2>&1 | grep -i "zookeeper"

# Verify mntr is responding
echo "mntr" | nc localhost 2181

# Verify ruok returns "imok"
echo "ruok" | nc localhost 2181
```

## Troubleshooting

### Connection refused on port 2181

**Cause**: The Collector cannot reach ZooKeeper at the configured endpoint.

**Fix**:

1. Verify ZooKeeper is running: `echo "ruok" | nc localhost 2181` should
   return `imok`.
2. Confirm the client port in `zoo.cfg` matches the receiver endpoint.
3. Check firewall rules if the Collector runs on a separate host.

### `mntr` command not whitelisted

**Cause**: ZooKeeper 3.5.3+ disables `mntr` by default, so the receiver reads
nothing.

**Fix**:

1. Add `4lw.commands.whitelist=mntr,ruok,srvr` to `zoo.cfg`.
2. For Docker: set `ZOO_4LW_COMMANDS_WHITELIST=mntr,ruok,srvr`.
3. Restart ZooKeeper after changing the whitelist.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

### Follower and sync metrics missing

**Cause**: `zookeeper.follower.count` and `zookeeper.sync.pending` are
leader-only - they emit no series on a standalone or follower node.

**Look at**: `server.state` (a resource attribute) to confirm the node's role,
and `zookeeper.data_tree.ephemeral_node.count` to check session-tied state
during the same investigation.

**Fix**:

1. These metrics do not appear on standalone or follower nodes.
2. Verify the server role:
   `echo "mntr" | nc localhost 2181 | grep zk_server_state`.
3. In a cluster, point the Collector at the leader node to collect these
   metrics.

## FAQ

**Does this work with ZooKeeper running in Kubernetes?**

Yes. Set `endpoint` to the ZooKeeper service DNS
(e.g., `zookeeper.default.svc.cluster.local:2181`). The Collector can run as a
sidecar or DaemonSet. Make sure the 4LW whitelist is configured in the
StatefulSet pod spec (`ZOO_4LW_COMMANDS_WHITELIST=mntr,ruok,srvr`), or the
receiver reads nothing.

**How do I monitor a ZooKeeper ensemble?**

Add a receiver block per node with distinct names:

```yaml showLineNumbers title="config/otel-collector.yaml (ensemble)"
receivers:
  zookeeper/node1:
    endpoint: zookeeper-1:2181
  zookeeper/node2:
    endpoint: zookeeper-2:2181
  zookeeper/node3:
    endpoint: zookeeper-3:2181
```

Then include all of them in the pipeline:
`receivers: [zookeeper/node1, zookeeper/node2, zookeeper/node3]`. The
leader-only metrics emit from whichever node is currently the leader.

**Does this receiver work with the ZooKeeper Prometheus metrics provider?**

No. If `metricsProvider.className` is set to `PrometheusMetricsProvider`, the
`mntr` output format changes and the receiver cannot parse it. Use the default
metrics provider with this receiver.

**What resource attributes are added to metrics?**

The receiver stamps `server.state` (leader, follower, or standalone) and
`zk.version` as resource attributes on every emitted metric.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on ZooKeeper metrics.
- [Kafka Monitoring](./kafka.md) - The broker ZooKeeper most often coordinates.
- [Redis Monitoring](./redis.md) - Another stateful service to put on Scout.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for [Kafka](./kafka.md),
  [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Adjust `collection_interval` based on your
  ensemble size and workload.
