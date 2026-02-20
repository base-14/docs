---
title: Memcached Monitoring with OpenTelemetry
sidebar_label: Memcached
id: collecting-memcached-telemetry
sidebar_position: 9
description:
  Monitor Memcached with OpenTelemetry Collector. Collect cache usage, hit
  ratios, connections, CPU, and memory metrics using Scout.
keywords:
  [
    memcached monitoring,
    memcached metrics,
    cache monitoring,
    opentelemetry memcached,
    memcached observability,
  ]
---

# Memcached

## Overview

This guide explains how to set up Memcached metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. Memcached 1.6.x instance
2. Network access to the Memcached TCP port (default 11211)
3. Scout Collector installed

## Memcached Configuration

Verify your Memcached instance is accessible:

```bash showLineNumbers
# Check Memcached stats
echo "stats" | nc <memcached-host> 11211

# Check version
echo "version" | nc <memcached-host> 11211
```

## Scout Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  memcached:
    endpoint: <memcached-host>:11211
    transport: tcp
    collection_interval: 10s

    metrics:
      # Cache usage
      memcached.bytes:
        enabled: true
      memcached.current_items:
        enabled: true
      memcached.evictions:
        enabled: true

      # Commands and operations
      memcached.commands:
        enabled: true
      memcached.operations:
        enabled: true
      memcached.operation_hit_ratio:
        enabled: true

      # Connections
      memcached.connections.current:
        enabled: true
      memcached.connections.total:
        enabled: true

      # Resource usage
      memcached.cpu.usage:
        enabled: true
      memcached.network:
        enabled: true
      memcached.threads:
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
  otlphttp/b14:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [memcached]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test Memcached connectivity:

   ```bash showLineNumbers
   # Check stats
   echo "stats" | nc <memcached-host> 11211

   # Check slab allocation
   echo "stats slabs" | nc <memcached-host> 11211
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [Memcached Protocol](https://github.com/memcached/memcached/blob/master/doc/protocol.txt)
- [Memcached Wiki](https://github.com/memcached/memcached/wiki)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [Redis Monitoring](./redis.md) - Alternative caching service monitoring guide
- [ElastiCache Monitoring](../infra/aws/elasticache.md) - AWS ElastiCache
  monitoring guide
