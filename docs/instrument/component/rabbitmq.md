---
title: >
  RabbitMQ OpenTelemetry Monitoring — Queue Depth, Message Rates,
  and Consumer Metrics
sidebar_label: RabbitMQ
id: collecting-rabbitmq-telemetry
sidebar_position: 6
description: >
  Collect RabbitMQ metrics with the OpenTelemetry Collector. Monitor
  queue depth, message rates, node memory, and I/O performance using
  the RabbitMQ receiver and export to base14 Scout.
keywords:
  - rabbitmq opentelemetry
  - rabbitmq otel collector
  - rabbitmq metrics monitoring
  - rabbitmq performance monitoring
  - opentelemetry rabbitmq receiver
  - rabbitmq observability
  - rabbitmq queue monitoring
  - rabbitmq telemetry collection
---

# RabbitMQ

The OpenTelemetry Collector's RabbitMQ receiver collects 76+ metrics from
RabbitMQ 3.x and 4.x, including queue depth, message rates, consumer
counts, node memory, disk usage, I/O performance, and garbage collection
statistics. This guide configures the receiver, sets up monitoring
credentials, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| RabbitMQ               | 3.x     | 4.x         |
| Management plugin      | enabled | enabled     |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- RabbitMQ management plugin enabled (HTTP API on port 15672)
- A user with monitoring privileges
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Messages**: published, delivered, acknowledged, dropped, current
  depth
- **Node memory**: used memory, memory limit, memory alarm status
- **Node disk**: free disk, disk limit, disk alarm status
- **Resources**: file descriptors, sockets, Erlang processes
- **I/O**: read/write counts, bytes, average times, sync and seek stats
- **Runtime**: uptime, GC counts, context switches, Mnesia transactions
- **Connections**: connection/channel created and closed rates, queue
  lifecycle events

Full metric reference:
[OTel RabbitMQ Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/rabbitmqreceiver)

## Access Setup

Ensure the RabbitMQ management plugin is enabled:

```bash showLineNumbers
# Enable management plugin
rabbitmq-plugins enable rabbitmq_management

# Verify management plugin is running
rabbitmq-plugins list | grep management
```

Create a dedicated monitoring user (optional but recommended):

```bash showLineNumbers
# Create monitoring user
rabbitmqctl add_user rabbitmq_monitor <password>

# Set permissions for monitoring
rabbitmqctl set_permissions -p / rabbitmq_monitor "" "" ".*"
rabbitmqctl set_user_tags rabbitmq_monitor monitoring

# Test connectivity
curl -u rabbitmq_monitor:<password> http://localhost:15672/api/overview
```

**Minimum required permissions:**

- `monitoring` tag — required for management API access
- No write permissions to queues or exchanges are needed

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  rabbitmq:
    endpoint: http://<rabbitmq-host>:15672
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
    collection_interval: 10s

    metrics:
      # Queue metrics
      rabbitmq.consumer.count:
        enabled: true
      rabbitmq.message.acknowledged:
        enabled: true
      rabbitmq.message.current:
        enabled: true
      rabbitmq.message.delivered:
        enabled: true
      rabbitmq.message.dropped:
        enabled: true
      rabbitmq.message.published:
        enabled: true

      # Node metrics — memory
      rabbitmq.node.mem_used:
        enabled: true
      rabbitmq.node.mem_limit:
        enabled: true
      rabbitmq.node.mem_alarm:
        enabled: true
      rabbitmq.node.mem_used_details.rate:
        enabled: true

      # Node metrics — disk
      rabbitmq.node.disk_free:
        enabled: true
      rabbitmq.node.disk_free_limit:
        enabled: true
      rabbitmq.node.disk_free_alarm:
        enabled: true
      rabbitmq.node.disk_free_details.rate:
        enabled: true

      # Node metrics — file descriptors
      rabbitmq.node.fd_used:
        enabled: true
      rabbitmq.node.fd_total:
        enabled: true
      rabbitmq.node.fd_used_details.rate:
        enabled: true

      # Node metrics — sockets
      rabbitmq.node.sockets_used:
        enabled: true
      rabbitmq.node.sockets_total:
        enabled: true
      rabbitmq.node.sockets_used_details.rate:
        enabled: true

      # Node metrics — processes
      rabbitmq.node.proc_used:
        enabled: true
      rabbitmq.node.proc_total:
        enabled: true
      rabbitmq.node.proc_used_details.rate:
        enabled: true

      # Node metrics — runtime
      rabbitmq.node.uptime:
        enabled: true
      rabbitmq.node.run_queue:
        enabled: true
      rabbitmq.node.processors:
        enabled: true
      rabbitmq.node.context_switches:
        enabled: true
      rabbitmq.node.context_switches_details.rate:
        enabled: true

      # Node metrics — garbage collection
      rabbitmq.node.gc_num:
        enabled: true
      rabbitmq.node.gc_num_details.rate:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed_details.rate:
        enabled: true

      # Node metrics — I/O read
      rabbitmq.node.io_read_count:
        enabled: true
      rabbitmq.node.io_read_bytes:
        enabled: true
      rabbitmq.node.io_read_avg_time:
        enabled: true
      rabbitmq.node.io_read_count_details.rate:
        enabled: true
      rabbitmq.node.io_read_bytes_details.rate:
        enabled: true
      rabbitmq.node.io_read_avg_time_details.rate:
        enabled: true

      # Node metrics — I/O write
      rabbitmq.node.io_write_count:
        enabled: true
      rabbitmq.node.io_write_bytes:
        enabled: true
      rabbitmq.node.io_write_avg_time:
        enabled: true
      rabbitmq.node.io_write_count_details.rate:
        enabled: true
      rabbitmq.node.io_write_bytes_details.rate:
        enabled: true
      rabbitmq.node.io_write_avg_time_details.rate:
        enabled: true

      # Node metrics — I/O sync and seek
      rabbitmq.node.io_sync_count:
        enabled: true
      rabbitmq.node.io_sync_avg_time:
        enabled: true
      rabbitmq.node.io_sync_count_details.rate:
        enabled: true
      rabbitmq.node.io_sync_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_seek_count:
        enabled: true
      rabbitmq.node.io_seek_avg_time:
        enabled: true
      rabbitmq.node.io_seek_count_details.rate:
        enabled: true
      rabbitmq.node.io_seek_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_reopen_count:
        enabled: true
      rabbitmq.node.io_reopen_count_details.rate:
        enabled: true

      # Node metrics — Mnesia transactions
      rabbitmq.node.mnesia_ram_tx_count:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count:
        enabled: true
      rabbitmq.node.mnesia_ram_tx_count_details.rate:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count_details.rate:
        enabled: true

      # Node metrics — message store
      rabbitmq.node.msg_store_read_count:
        enabled: true
      rabbitmq.node.msg_store_write_count:
        enabled: true
      rabbitmq.node.msg_store_read_count_details.rate:
        enabled: true
      rabbitmq.node.msg_store_write_count_details.rate:
        enabled: true

      # Node metrics — queue index
      rabbitmq.node.queue_index_write_count:
        enabled: true
      rabbitmq.node.queue_index_read_count:
        enabled: true
      rabbitmq.node.queue_index_write_count_details.rate:
        enabled: true
      rabbitmq.node.queue_index_read_count_details.rate:
        enabled: true

      # Node metrics — connections and channels
      rabbitmq.node.connection_created:
        enabled: true
      rabbitmq.node.connection_closed:
        enabled: true
      rabbitmq.node.connection_created_details.rate:
        enabled: true
      rabbitmq.node.connection_closed_details.rate:
        enabled: true
      rabbitmq.node.channel_created:
        enabled: true
      rabbitmq.node.channel_closed:
        enabled: true
      rabbitmq.node.channel_created_details.rate:
        enabled: true
      rabbitmq.node.channel_closed_details.rate:
        enabled: true

      # Node metrics — queue lifecycle
      rabbitmq.node.queue_declared:
        enabled: true
      rabbitmq.node.queue_created:
        enabled: true
      rabbitmq.node.queue_deleted:
        enabled: true
      rabbitmq.node.queue_declared_details.rate:
        enabled: true
      rabbitmq.node.queue_created_details.rate:
        enabled: true
      rabbitmq.node.queue_deleted_details.rate:
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
      receivers: [rabbitmq]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
RABBITMQ_USERNAME=rabbitmq_monitor
RABBITMQ_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "rabbitmq"

# Test RabbitMQ management API
curl -u ${RABBITMQ_USERNAME}:${RABBITMQ_PASSWORD} \
     http://<rabbitmq-host>:15672/api/overview
```

```bash showLineNumbers
# Check node status
rabbitmq-diagnostics -q ping

# List queues
rabbitmqctl list_queues

# Check cluster status (if clustered)
rabbitmqctl cluster_status
```

## Troubleshooting

### Connection refused on port 15672

**Cause**: Management plugin is not enabled or not listening on the
expected port.

**Fix**:

1. Enable the plugin: `rabbitmq-plugins enable rabbitmq_management`
2. Verify the management port: `ss -tlnp | grep 15672`
3. Check if RabbitMQ is running: `systemctl status rabbitmq-server` or
   `docker ps | grep rabbitmq`

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks the
`monitoring` tag.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:15672/api/overview`
2. Verify user tags: `rabbitmqctl list_users`
3. Add the monitoring tag if missing:
   `rabbitmqctl set_user_tags rabbitmq_monitor monitoring`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Memory or disk alarm metrics showing 1

**Cause**: RabbitMQ has triggered a resource alarm — this is a real
operational issue.

**Fix**:

1. `rabbitmq.node.mem_alarm = 1` means memory usage exceeds the
   threshold — publishers are blocked
2. `rabbitmq.node.disk_free_alarm = 1` means free disk is below the
   limit
3. These metrics are working correctly — resolve the underlying
   resource issue

## FAQ

**Does this work with RabbitMQ running in Kubernetes?**

Yes. Set `endpoint` to the RabbitMQ management service DNS
(e.g., `http://rabbitmq.default.svc.cluster.local:15672`) and inject
credentials via a Kubernetes secret. The Collector can run as a sidecar
or DaemonSet.

**How do I monitor a RabbitMQ cluster?**

The management API returns cluster-wide data from any node. Point the
receiver at one node and you'll get metrics for all nodes. For
redundancy, add multiple receiver blocks pointing to different nodes:

```yaml
receivers:
  rabbitmq/node1:
    endpoint: http://rabbitmq-1:15672
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
  rabbitmq/node2:
    endpoint: http://rabbitmq-2:15672
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
```

**What permissions does the monitoring account need?**

The `monitoring` user tag is required for management API access. No
queue read/write permissions are needed. The Collector only reads
metrics — it does not modify RabbitMQ data.

**Does this work with both RabbitMQ 3.x and 4.x?**

Yes. The configuration has been validated against both RabbitMQ 3.x and
4.x with identical metric output. The management API is stable across
these versions.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [PostgreSQL](./postgres.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your
  messaging workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Redis Monitoring](./redis.md) — Alternative caching service monitoring
