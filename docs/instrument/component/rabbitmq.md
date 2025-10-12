---
date: 2025-10-08
id: collecting-rabbitmq-telemetry
title: RabbitMQ Message Queue Monitoring with OpenTelemetry
description:
  Monitor RabbitMQ with OpenTelemetry Collector. Collect queue metrics, message
  stats, connections, and performance data using Scout.
keywords:
  [
    rabbitmq monitoring,
    rabbitmq metrics,
    message queue monitoring,
    opentelemetry rabbitmq,
    rabbitmq observability,
  ]
---

## Overview

This guide explains how to set up RabbitMQ metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. RabbitMQ instance (standalone or cluster)
2. RabbitMQ management plugin enabled
3. RabbitMQ user with monitoring privileges
4. Scout Collector installed

## RabbitMQ Configuration

Ensure the RabbitMQ management plugin is enabled:

```bash
# Enable management plugin
rabbitmq-plugins enable rabbitmq_management

# Verify management plugin is running
rabbitmq-plugins list | grep management
```

Create a dedicated monitoring user (optional but recommended):

```bash
# Create monitoring user
rabbitmqctl add_user rabbitmq_monitor <password>

# Set permissions for monitoring
rabbitmqctl set_permissions -p / rabbitmq_monitor "" "" ".*"
rabbitmqctl set_user_tags rabbitmq_monitor monitoring

# Test connectivity
curl -u rabbitmq_monitor:<password> http://localhost:15672/api/overview
```

## Scout Collector Configuration

```yaml
receivers:
  rabbitmq:
    endpoint: ${RABBITMQ_HOST}
    username: ${RABBITMQ_USERNAME}
    password: ${RABBITMQ_PASSWORD}
    collection_interval: 10s

    metrics:
      rabbitmq.node.disk_free:
        enabled: true
      rabbitmq.node.disk_free_limit:
        enabled: true
      rabbitmq.node.disk_free_alarm:
        enabled: true
      rabbitmq.node.disk_free_details.rate:
        enabled: true
      rabbitmq.node.mem_used:
        enabled: true
      rabbitmq.node.mem_limit:
        enabled: true
      rabbitmq.node.mem_alarm:
        enabled: true
      rabbitmq.node.mem_used_details.rate:
        enabled: true
      rabbitmq.node.fd_used:
        enabled: true
      rabbitmq.node.fd_total:
        enabled: true
      rabbitmq.node.fd_used_details.rate:
        enabled: true
      rabbitmq.node.sockets_used:
        enabled: true
      rabbitmq.node.sockets_total:
        enabled: true
      rabbitmq.node.sockets_used_details.rate:
        enabled: true
      rabbitmq.node.proc_used:
        enabled: true
      rabbitmq.node.proc_total:
        enabled: true
      rabbitmq.node.proc_used_details.rate:
        enabled: true
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
      rabbitmq.node.gc_num:
        enabled: true
      rabbitmq.node.gc_num_details.rate:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed:
        enabled: true
      rabbitmq.node.gc_bytes_reclaimed_details.rate:
        enabled: true
      rabbitmq.node.io_read_count:
        enabled: true
      rabbitmq.node.io_read_bytes:
        enabled: true
      rabbitmq.node.io_read_avg_time:
        enabled: true
      rabbitmq.node.io_write_count:
        enabled: true
      rabbitmq.node.io_write_bytes:
        enabled: true
      rabbitmq.node.io_write_avg_time:
        enabled: true
      rabbitmq.node.io_sync_count:
        enabled: true
      rabbitmq.node.io_sync_avg_time:
        enabled: true
      rabbitmq.node.io_seek_count:
        enabled: true
      rabbitmq.node.io_seek_avg_time:
        enabled: true
      rabbitmq.node.io_reopen_count:
        enabled: true
      rabbitmq.node.mnesia_ram_tx_count:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count:
        enabled: true
      rabbitmq.node.msg_store_read_count:
        enabled: true
      rabbitmq.node.msg_store_write_count:
        enabled: true
      rabbitmq.node.queue_index_write_count:
        enabled: true
      rabbitmq.node.queue_index_read_count:
        enabled: true
      rabbitmq.node.connection_created:
        enabled: true
      rabbitmq.node.connection_closed:
        enabled: true
      rabbitmq.node.channel_created:
        enabled: true
      rabbitmq.node.channel_closed:
        enabled: true
      rabbitmq.node.queue_declared:
        enabled: true
      rabbitmq.node.queue_created:
        enabled: true
      rabbitmq.node.queue_deleted:
        enabled: true
      rabbitmq.node.io_read_count_details.rate:
        enabled: true
      rabbitmq.node.io_read_bytes_details.rate:
        enabled: true
      rabbitmq.node.io_read_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_write_count_details.rate:
        enabled: true
      rabbitmq.node.io_write_bytes_details.rate:
        enabled: true
      rabbitmq.node.io_write_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_sync_count_details.rate:
        enabled: true
      rabbitmq.node.io_sync_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_seek_count_details.rate:
        enabled: true
      rabbitmq.node.io_seek_avg_time_details.rate:
        enabled: true
      rabbitmq.node.io_reopen_count_details.rate:
        enabled: true
      rabbitmq.node.mnesia_ram_tx_count_details.rate:
        enabled: true
      rabbitmq.node.mnesia_disk_tx_count_details.rate:
        enabled: true
      rabbitmq.node.msg_store_read_count_details.rate:
        enabled: true
      rabbitmq.node.msg_store_write_count_details.rate:
        enabled: true
      rabbitmq.node.queue_index_write_count_details.rate:
        enabled: true
      rabbitmq.node.queue_index_read_count_details.rate:
        enabled: true
      rabbitmq.node.connection_created_details.rate:
        enabled: true
      rabbitmq.node.connection_closed_details.rate:
        enabled: true
      rabbitmq.node.channel_created_details.rate:
        enabled: true
      rabbitmq.node.channel_closed_details.rate:
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
        value: ${ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to Base14 Scout
exporters:
  otlphttp:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [rabbitmq]
      processors: [batch, resource]
      exporters: [otlphttp]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test RabbitMQ connectivity:

   ```bash
   # Test RabbitMQ management API
   curl -u ${RABBITMQ_USERNAME}:${RABBITMQ_PASSWORD} \
        ${RABBITMQ_HOST}:15672/api/overview
   ```

4. Check RabbitMQ node status:

   ```bash
   # Check node status
   rabbitmqctl node_health_check

   # List queues
   rabbitmqctl list_queues

   # Check cluster status (if clustered)
   rabbitmqctl cluster_status
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [RabbitMQ Management Plugin](https://www.rabbitmq.com/management.html)
- [RabbitMQ Monitoring Guide](https://www.rabbitmq.com/monitoring.html)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [Redis Monitoring](./redis.md) - Alternative caching service monitoring guide
