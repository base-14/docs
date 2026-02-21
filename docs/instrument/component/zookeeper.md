---
title: >
  ZooKeeper OpenTelemetry Monitoring — Connections, Latency,
  and Collector Setup
sidebar_label: ZooKeeper
id: collecting-zookeeper-telemetry
sidebar_position: 13
description: >
  Collect ZooKeeper metrics with the OpenTelemetry Collector. Monitor
  active connections, request latency, and znode counts using the
  ZooKeeper receiver and export to base14 Scout.
keywords:
  - zookeeper opentelemetry
  - zookeeper otel collector
  - zookeeper metrics monitoring
  - zookeeper performance monitoring
  - opentelemetry zookeeper receiver
  - zookeeper observability
  - zookeeper cluster monitoring
  - zookeeper telemetry collection
---

# ZooKeeper

The OpenTelemetry Collector's ZooKeeper receiver collects 16 metrics
from ZooKeeper 3.5+, including active connections, request latency,
znode counts, watch counts, and file descriptor usage. This guide
configures the receiver, enables the required four-letter-word commands,
and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| ZooKeeper              | 3.5     | 3.9+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- ZooKeeper client port (2181) must be accessible from the host running
  the Collector
- The `mntr` and `ruok` four-letter-word commands must be whitelisted
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Connections**: active client connections
- **Latency**: average, minimum, and maximum request processing time
- **Data tree**: znode count, ephemeral node count, data size
- **Packets**: received and sent packet counts
- **Resources**: open file descriptors, file descriptor limit
- **Health**: ruok health check, fsync threshold violations

Full metric reference:
[OTel ZooKeeper Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/zookeeperreceiver)

## Access Setup

ZooKeeper 3.5.3+ disables most four-letter-word (4LW) commands by
default. The receiver uses `mntr` (metrics) and `ruok` (health check).
Enable them in `zoo.cfg`:

```text showLineNumbers title="zoo.cfg"
4lw.commands.whitelist=mntr,ruok,srvr
```

For Docker deployments, set the environment variable:

```bash showLineNumbers
ZOO_4LW_COMMANDS_WHITELIST=mntr,ruok,srvr
```

Verify the commands are working:

```bash showLineNumbers
# Test mntr (metrics)
echo "mntr" | nc localhost 2181

# Test ruok (health check) — should return "imok"
echo "ruok" | nc localhost 2181
```

No authentication is required. The receiver connects via plain TCP.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  zookeeper:
    endpoint: localhost:2181   # Change to your ZooKeeper address
    collection_interval: 30s

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
      receivers: [zookeeper]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "zookeeper"

# Verify mntr is responding
echo "mntr" | nc localhost 2181

# Verify ruok returns "imok"
echo "ruok" | nc localhost 2181
```

## Troubleshooting

### Connection refused on port 2181

**Cause**: Collector cannot reach ZooKeeper at the configured endpoint.

**Fix**:

1. Verify ZooKeeper is running: `echo "ruok" | nc localhost 2181`
   should return `imok`
2. Confirm the client port in `zoo.cfg` matches the receiver endpoint
3. Check firewall rules if the Collector runs on a separate host

### mntr command not whitelisted

**Cause**: ZooKeeper 3.5.3+ disables `mntr` by default.

**Fix**:

1. Add `4lw.commands.whitelist=mntr,ruok,srvr` to `zoo.cfg`
2. For Docker: set `ZOO_4LW_COMMANDS_WHITELIST=mntr,ruok,srvr`
3. Restart ZooKeeper after changing the whitelist

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Follower and sync metrics missing

**Cause**: `zookeeper.follower.count` and `zookeeper.sync.pending` are
only emitted when the ZooKeeper server is a **leader** in a cluster.

**Fix**:

1. These metrics do not appear on standalone or follower nodes
2. Verify the server role: `echo "mntr" | nc localhost 2181 | grep
   zk_server_state`
3. In a cluster, point the Collector at the leader node to collect
   these metrics

## FAQ

**Does this work with ZooKeeper running in Kubernetes?**

Yes. Set `endpoint` to the ZooKeeper service DNS
(e.g., `zookeeper.default.svc.cluster.local:2181`). The Collector can
run as a sidecar or DaemonSet. Ensure the 4LW whitelist is configured
in the StatefulSet pod spec.

**How do I monitor a ZooKeeper ensemble?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  zookeeper/node1:
    endpoint: zookeeper-1:2181
  zookeeper/node2:
    endpoint: zookeeper-2:2181
  zookeeper/node3:
    endpoint: zookeeper-3:2181
```

Then include all in the pipeline:
`receivers: [zookeeper/node1, zookeeper/node2, zookeeper/node3]`

**Does this receiver work with the ZooKeeper Prometheus metrics
provider?**

No. If `metricsProvider.className` is set to
`PrometheusMetricsProvider`, the `mntr` output format changes and the
receiver cannot parse it. Use the default metrics provider with this
receiver.

**What resource attributes are added to metrics?**

The receiver adds `server.state` (leader, follower, or standalone)
and `zk.version` as resource attributes on all emitted metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your
  own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md),
  [RabbitMQ](./rabbitmq.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on
  your ensemble size and workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kafka Monitoring](./kafka.md)
  — Message broker monitoring
