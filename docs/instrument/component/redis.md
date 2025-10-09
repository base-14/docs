---
date: 2025-10-08
id: collecting-redis-telemetry
title: Redis
description: Use Scout to monitor your Redis instance with ease
---

## Overview

This guide explains how to set up Redis metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. Redis instance (standalone or cluster)
2. Redis connection credentials (if authentication is enabled)
3. Scout Collector installed

## Redis Configuration

Ensure your Redis instance is accessible and if authentication is enabled,
you have the appropriate credentials.

For Redis with authentication:
```bash
# Test Redis connectivity
redis-cli -h <redis-host> -p <redis-port> -a <password> ping
```

For Redis without authentication:
```bash
# Test Redis connectivity
redis-cli -h <redis-host> -p <redis-port> ping
```

## Scout Collector Configuration

```yaml
receivers:
  redis:
    endpoint: ${REDIS_ENDPOINT}
    collection_interval: 20s
    # password: ${REDIS_PASSWORD}  # Uncomment if authentication is enabled

    metrics:
      redis.maxmemory:
        enabled: true
      redis.role:
        enabled: true
      redis.cmd.calls:
        enabled: true
      redis.cmd.usec:
        enabled: true
      redis.cmd.latency:
        enabled: true
      redis.uptime:
        enabled: true
      redis.cpu.time:
        enabled: true
      redis.clients.connected:
        enabled: true
      redis.clients.max_input_buffer:
        enabled: true
      redis.clients.max_output_buffer:
        enabled: true
      redis.clients.blocked:
        enabled: true
      redis.keys.expired:
        enabled: true
      redis.keys.evicted:
        enabled: true
      redis.connections.received:
        enabled: true
      redis.connections.rejected:
        enabled: true
      redis.memory.used:
        enabled: true
      redis.memory.peak:
        enabled: true
      redis.memory.rss:
        enabled: true
      redis.memory.lua:
        enabled: true
      redis.memory.fragmentation_ratio:
        enabled: true
      redis.rdb.changes_since_last_save:
        enabled: true
      redis.commands:
        enabled: true
      redis.commands.processed:
        enabled: true
      redis.net.input:
        enabled: true
      redis.net.output:
        enabled: true
      redis.keyspace.hits:
        enabled: true
      redis.keyspace.misses:
        enabled: true
      redis.latest_fork:
        enabled: true
      redis.slaves.connected:
        enabled: true
      redis.replication.backlog_first_byte_offset:
        enabled: true
      redis.replication.offset:
        enabled: true
      redis.db.keys:
        enabled: true
      redis.db.expires:
        enabled: true
      redis.db.avg_ttl:
        enabled: true
      redis.replication.replica_offset:
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
      receivers: [redis]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in the Scout dashboard
3. Monitor Redis INFO command output:
   ```bash
   redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} info
   ```


## References

- [Scout Collector Setup](
   https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [Redis INFO Command Documentation](https://redis.io/commands/info/)