---
title: >
  RabbitMQ OpenTelemetry Monitoring - Queue Depth, Message Rates,
  and Consumer Metrics
sidebar_label: RabbitMQ
id: collecting-rabbitmq-telemetry
sidebar_position: 6
description: >
  Collect RabbitMQ metrics with the OpenTelemetry Collector. Monitor
  queue depth, message throughput, node memory, and resource alarms using
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

The OpenTelemetry Collector's `rabbitmqreceiver` collects 70+ metrics
(74 node-level plus 5 queue-level) from RabbitMQ 3.x and 4.x via the
RabbitMQ Management HTTP API - queue depth, message throughput, node
memory and disk usage, resource alarms, file descriptors, I/O, and
garbage collection. The receiver reads `/api/nodes` for node metrics and
`/api/queues` for per-queue metrics. This guide configures the receiver,
sets up monitoring credentials, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended       |
| ---------------------- | ------- | ----------------- |
| RabbitMQ               | 3.x     | 4.x (4.3.2)       |
| Management plugin      | enabled | enabled           |
| OTel Collector Contrib | 0.90.0  | 0.153.0           |
| base14 Scout           | Any     | -                 |

Before starting:

- RabbitMQ must be running with the management plugin enabled (HTTP API
  on port 15672).
- A user with the `monitoring` tag (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

A few things about this surface before the tables:

- **Two scrape sources.** Queue-level metrics
  (`rabbitmq.message.*`, `rabbitmq.consumer.count`) come from
  `/api/queues` and only emit when at least one queue exists with
  activity. Node metrics (`rabbitmq.node.*`) come from `/api/nodes` and
  emit as soon as the node is up. With no queues, you will see only the
  `rabbitmq.node.*` set.
- **No `up` or health metric.** Liveness is the receiver scraping the
  management API successfully plus `rabbitmq.node.uptime` advancing - a
  reset means the node restarted. `rabbitmq.node.mem_alarm` and
  `rabbitmq.node.disk_free_alarm` are the binary resource-alarm flags.
- **Almost every node counter has a `_details.rate` companion** (for
  example `rabbitmq.node.io_read_count` and
  `rabbitmq.node.io_read_count_details.rate`). These are RabbitMQ's own
  server-side rate calculations; prefer computing rates in your backend
  from the base counter and treat the `_details.rate` variants as
  Diagnostic. They roughly double the node surface.

### Core - is it up and doing its job

| Metric | What it tells you |
|---|---|
| `rabbitmq.message.current` | Messages currently in the queue (per `state`: ready / unacknowledged) - queue depth, the headline KPI. |
| `rabbitmq.message.published` | Messages published into the queue - inbound throughput. |
| `rabbitmq.message.delivered` | Messages delivered to consumers - outbound throughput; compared with published it shows whether the backlog is growing. |
| `rabbitmq.node.uptime` | Seconds since node start - liveness and restart detection. There is no `up` or health gauge on this surface, so scrape success plus an advancing uptime is your liveness signal. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `rabbitmq.consumer.count` | Consumers attached per queue - zero on a non-empty queue means a stuck pipeline. |
| `rabbitmq.message.acknowledged` | Messages acked by consumers - compared with delivered it shows unacked buildup. |
| `rabbitmq.message.dropped` | Messages dropped (unroutable or dead-lettered without a DLX) - silent in a healthy flow; any value is a problem. |
| `rabbitmq.node.mem_used` / `mem_limit` / `mem_alarm` | Node memory used, the high-watermark limit, and the binary memory alarm (`1` = publishers blocked). |
| `rabbitmq.node.disk_free` / `disk_free_limit` / `disk_free_alarm` | Free disk, the limit, and the binary disk alarm (`1` = below limit). |
| `rabbitmq.node.fd_used` / `fd_total` | File descriptors used vs total - saturation. |
| `rabbitmq.node.sockets_used` / `sockets_total` | Sockets used vs total - saturation. |
| `rabbitmq.node.proc_used` / `proc_total` | Erlang processes used vs total - saturation. |

### Diagnostic - for investigation and tuning

Higher cardinality and volume; reach for these during an incident or a
capacity review. The `_details.rate` companions alone roughly double the
node surface.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Connection / channel churn | `rabbitmq.node.connection_created` / `connection_closed`, `rabbitmq.node.channel_created` / `channel_closed` (+ `_details.rate`) | Reconnect storms and client churn. |
| Queue lifecycle | `rabbitmq.node.queue_declared` / `queue_created` / `queue_deleted` (+ `_details.rate`) | Churn from short-lived or auto-delete queues. |
| Scheduler / runtime | `rabbitmq.node.run_queue`, `processors`, `context_switches`, `gc_num`, `gc_bytes_reclaimed` (+ `_details.rate`) | Scheduler pressure and GC behavior. |
| Disk I/O | `rabbitmq.node.io_read_*`, `io_write_*`, `io_sync_*`, `io_seek_*`, `io_reopen_*` - count / bytes / avg_time (+ `_details.rate`) | Disk-bound persistence latency. |
| Message store / queue index | `rabbitmq.node.msg_store_read_count` / `msg_store_write_count`, `rabbitmq.node.queue_index_read_count` / `queue_index_write_count` (+ `_details.rate`) | Persistence-layer throughput. |
| Mnesia transactions | `rabbitmq.node.mnesia_ram_tx_count` / `mnesia_disk_tx_count` (+ `_details.rate`) | Metadata store activity. |
| `_details.rate` variants | Every node counter's server-side rate companion | Only when you prefer RabbitMQ's own rate calc over a backend-computed rate. |

Full metric reference:
[OTel RabbitMQ Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/rabbitmqreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. Most
are relative to your own baseline; the two resource alarms and a
consumer count of zero read a state RabbitMQ reports directly, so the
comparison is exact. Tune the rest to your workload - these are starting
points.

| Alert | Threshold | Why it matters |
|---|---|---|
| RabbitMQ unreachable | the `rabbitmq` receiver producing no data for > 1m, or `rabbitmq.node.uptime` resetting | No `up` or health on this surface - scrape success plus uptime are your liveness signal. Check the node and the management API. |
| Memory alarm active | `rabbitmq.node.mem_alarm` = 1 | RabbitMQ has hit the memory high watermark and is blocking publishers. Free memory or raise the watermark. |
| Disk alarm active | `rabbitmq.node.disk_free_alarm` = 1 | Free disk is below the limit; publishers are blocked. Free disk or lower the limit. |
| Queue backlog growing | `rabbitmq.message.current` rising vs baseline | Consumers are not keeping up with publishers. Scale consumers or investigate slow processing. |
| No consumers on an active queue | `rabbitmq.consumer.count` = 0 while `rabbitmq.message.current` > 0 | Messages are arriving with nothing to drain them - a stuck or crashed consumer. |
| Unacked buildup | `rabbitmq.message.delivered` outpacing `rabbitmq.message.acknowledged` | Consumers receive but fail to ack - slow processing or a redelivery loop. |
| Resource saturation | `rabbitmq.node.fd_used` / `sockets_used` / `proc_used` approaching their `*_total` | The node is running out of file descriptors, sockets, or Erlang processes. Raise limits or reduce load. |

## Access Setup

Ensure the RabbitMQ management plugin is enabled - it exposes the HTTP
API the receiver reads:

```bash showLineNumbers title="Enable RabbitMQ management plugin"
# Enable management plugin
rabbitmq-plugins enable rabbitmq_management

# Verify management plugin is running
rabbitmq-plugins list | grep management
```

Create a dedicated monitoring user:

```bash showLineNumbers title="Create monitoring user"
# Create monitoring user
rabbitmqctl add_user rabbitmq_monitor <password>

# Grant read-only access and the monitoring tag
rabbitmqctl set_permissions -p / rabbitmq_monitor "" "" ".*"
rabbitmqctl set_user_tags rabbitmq_monitor monitoring

# Test connectivity
curl -u rabbitmq_monitor:<password> http://localhost:15672/api/overview
```

**Minimum required permissions:**

- `monitoring` tag - required for management API access.
- No write permissions to queues or exchanges are needed.

## Configuration

Many `rabbitmqreceiver` metrics are disabled by default, so the
`metrics:` enable block below is required to collect the full set
described above.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  rabbitmq:
    endpoint: http://<rabbitmq-host>:15672   # Change to your RabbitMQ address
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

      # Node metrics - memory
      rabbitmq.node.mem_used:
        enabled: true
      rabbitmq.node.mem_limit:
        enabled: true
      rabbitmq.node.mem_alarm:
        enabled: true
      rabbitmq.node.mem_used_details.rate:
        enabled: true

      # Node metrics - disk
      rabbitmq.node.disk_free:
        enabled: true
      rabbitmq.node.disk_free_limit:
        enabled: true
      rabbitmq.node.disk_free_alarm:
        enabled: true
      rabbitmq.node.disk_free_details.rate:
        enabled: true

      # Node metrics - file descriptors
      rabbitmq.node.fd_used:
        enabled: true
      rabbitmq.node.fd_total:
        enabled: true
      rabbitmq.node.fd_used_details.rate:
        enabled: true

      # Node metrics - sockets
      rabbitmq.node.sockets_used:
        enabled: true
      rabbitmq.node.sockets_total:
        enabled: true
      rabbitmq.node.sockets_used_details.rate:
        enabled: true

      # Node metrics - processes
      rabbitmq.node.proc_used:
        enabled: true
      rabbitmq.node.proc_total:
        enabled: true
      rabbitmq.node.proc_used_details.rate:
        enabled: true

      # Node metrics - runtime
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

      # Node metrics - garbage collection
      rabbitmq.node.gc_num:
        enabled: true
      rabbitmq.node.gc_num_details.rate:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed_details.rate:
        enabled: true

      # Node metrics - I/O read
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

      # Node metrics - I/O write
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

      # Node metrics - I/O sync and seek
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

      # Node metrics - Mnesia transactions
      rabbitmq.node.mnesia_ram_tx_count:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count:
        enabled: true
      rabbitmq.node.mnesia_ram_tx_count_details.rate:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count_details.rate:
        enabled: true

      # Node metrics - message store
      rabbitmq.node.msg_store_read_count:
        enabled: true
      rabbitmq.node.msg_store_write_count:
        enabled: true
      rabbitmq.node.msg_store_read_count_details.rate:
        enabled: true
      rabbitmq.node.msg_store_write_count_details.rate:
        enabled: true

      # Node metrics - queue index
      rabbitmq.node.queue_index_write_count:
        enabled: true
      rabbitmq.node.queue_index_read_count:
        enabled: true
      rabbitmq.node.queue_index_write_count_details.rate:
        enabled: true
      rabbitmq.node.queue_index_read_count_details.rate:
        enabled: true

      # Node metrics - connections and channels
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

      # Node metrics - queue lifecycle
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
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (introduced in semantic conventions v1.27.0, stable as of v1.41.0).
> Scout's UI filters on the lowercase `environment` key, so emit it alongside
> the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

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

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for the RabbitMQ receiver
docker logs otel-collector 2>&1 | grep -i "rabbitmq"

# Test the RabbitMQ management API directly
curl -u ${RABBITMQ_USERNAME}:${RABBITMQ_PASSWORD} \
     http://<rabbitmq-host>:15672/api/overview
```

```bash showLineNumbers title="Check RabbitMQ node status"
# Check node status
rabbitmq-diagnostics -q ping

# List queues
rabbitmqctl list_queues

# Check cluster status (if clustered)
rabbitmqctl cluster_status
```

## Troubleshooting

### Connection refused on port 15672

**Cause**: The management plugin is not enabled or not listening on the
expected port.

**Fix**:

1. Enable the plugin: `rabbitmq-plugins enable rabbitmq_management`.
2. Verify the management port: `ss -tlnp | grep 15672`.
3. Check that RabbitMQ is running: `systemctl status rabbitmq-server` or
   `docker ps | grep rabbitmq`.

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks the
`monitoring` tag.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:15672/api/overview`.
2. Verify user tags: `rabbitmqctl list_users`.
3. Add the monitoring tag if missing:
   `rabbitmqctl set_user_tags rabbitmq_monitor monitoring`.

### Only node metrics appear, no message metrics

**Cause**: There are no queues yet. Queue-level metrics
(`rabbitmq.message.*`, `rabbitmq.consumer.count`) come from `/api/queues`
and need at least one active queue, while node metrics
(`rabbitmq.node.*`) emit as soon as the node is up.

**Fix**:

1. Confirm a queue exists with traffic: `rabbitmqctl list_queues`.
2. Once a queue is declared and messages flow, the `rabbitmq.message.*`
   series start emitting on the next scrape.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

### Memory or disk alarm metrics showing 1

**Cause**: RabbitMQ has triggered a resource alarm - this is a real
operational issue, not a collection problem.

**Look at**: `rabbitmq.node.mem_alarm` and `rabbitmq.node.disk_free_alarm`
against `rabbitmq.node.mem_used` / `mem_limit` and
`rabbitmq.node.disk_free` / `disk_free_limit`; if I/O is involved, the
Diagnostic `rabbitmq.node.io_write_*` and `msg_store_write_count`
families show persistence pressure.

**Fix**:

1. `rabbitmq.node.mem_alarm = 1` means memory usage exceeds the high
   watermark - publishers are blocked. Free memory or raise the
   watermark.
2. `rabbitmq.node.disk_free_alarm = 1` means free disk is below the limit
   - publishers are blocked. Free disk or lower the limit.
3. The alarm metrics are working correctly; resolve the underlying
   resource issue.

## FAQ

### Does this work with RabbitMQ running in Kubernetes?

Yes. Set `endpoint` to the RabbitMQ management service DNS (for example
`http://rabbitmq.default.svc.cluster.local:15672`) and inject credentials
via a Kubernetes secret. The Collector can run as a sidecar or DaemonSet.

### How do I monitor a RabbitMQ cluster?

The management API returns cluster-wide data from any node. Point the
receiver at one node and you get metrics for all nodes. For redundancy,
add per-node receiver blocks pointing to different nodes:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-node)"
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

### What permissions does the monitoring account need?

The `monitoring` user tag is required for management API access. No queue
read/write permissions are needed - the Collector only reads metrics and
does not modify RabbitMQ data.

### Does this work with both RabbitMQ 3.x and 4.x?

The receiver reads the management HTTP API, which works on both 3.x and
4.x, but the node-metric set is not identical. RabbitMQ 4.x deprecates
management-plugin metric collection in favor of the Prometheus plugin,
and some node I/O metrics (for example `rabbitmq.node.io_read_avg_time`
and `rabbitmq.node.io_write_avg_time`) are deprecated or no longer
meaningful from 4.2 onward. The Core and Operational signals in this
guide still collect on 4.x; for the fullest metric set on 4.x, RabbitMQ
recommends scraping its Prometheus plugin.

### Why do I only see node metrics and no message metrics?

You have no queues yet. The queue-level metrics (`rabbitmq.message.*`,
`rabbitmq.consumer.count`) come from `/api/queues` and need at least one
active queue; the node metrics (`rabbitmq.node.*`) emit as soon as the
node is up.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on RabbitMQ metrics.
- [Redis Monitoring](./redis.md) - In-memory data store and cache.
- [PostgreSQL Monitoring](./postgres.md) - Relational database monitoring.
- [MongoDB Monitoring](./mongodb.md) - Document database monitoring.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [PostgreSQL](./postgres.md),
  [MongoDB](./mongodb.md), and other components.
- **Fine-tune Collection**: Adjust `collection_interval` to balance
  metric freshness against load on RabbitMQ and the Collector.
