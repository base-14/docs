---
title: >
  Memcached OpenTelemetry Monitoring — Cache Usage, Hit Ratios,
  and Collector Setup
sidebar_label: Memcached
id: collecting-memcached-telemetry
sidebar_position: 9
description: >
  Collect Memcached metrics with the OpenTelemetry Collector. Monitor cache
  usage, hit ratios, connections, and CPU usage using the Memcached receiver
  and export to base14 Scout.
keywords:
  - memcached opentelemetry
  - memcached otel collector
  - memcached metrics monitoring
  - memcached performance monitoring
  - opentelemetry memcached receiver
  - memcached observability
  - memcached cache monitoring
  - memcached telemetry collection
---

# Memcached

The OpenTelemetry Collector's Memcached receiver collects 11 metrics from
Memcached 1.6+, including cache byte usage, hit ratios, connection counts,
CPU usage, and network throughput. This guide configures the receiver,
verifies connectivity, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Memcached              | 1.6     | 1.6.x       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Memcached must be accessible over TCP from the host running the Collector
- No authentication is required — Memcached uses network-level access control
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cache usage**: bytes stored, current item count, evictions
- **Operations**: command counts, operation hit ratios, operations per second
- **Connections**: current connections, total connections
- **Resources**: CPU usage (user/system), network bytes in/out, thread count

Full metric reference:
[OTel Memcached Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/memcachedreceiver)

## Access Setup

Memcached has no built-in authentication. Access control is handled at the
network level — ensure only the Collector host can reach port 11211.

Verify connectivity:

```bash showLineNumbers
echo "stats" | nc localhost 11211
```

If using a firewall or container network, confirm the Collector can reach
the Memcached host and port.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  memcached:
    endpoint: localhost:11211           # Change to your Memcached address
    transport: tcp                      # Required — must be explicitly set
    collection_interval: 30s

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

      # Resources
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
      receivers: [memcached]
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
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "memcached"

# Verify Memcached is responding
echo "stats" | nc localhost 11211

# Check slab allocation
echo "stats slabs" | nc localhost 11211
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach Memcached at the configured endpoint.

**Fix**:

1. Verify Memcached is running: `systemctl status memcached` or
   `docker ps | grep memcached`
2. Confirm the endpoint address and port in your config
3. Check firewall rules if the Collector runs on a separate host

### Invalid transport type error

**Cause**: The `transport` field is missing from the receiver config.

**Fix**:

Add `transport: tcp` to the receiver configuration. Unlike most receivers,
the Memcached receiver requires this field to be set explicitly:

```yaml
receivers:
  memcached:
    endpoint: localhost:11211
    transport: tcp
```

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Hit ratio always zero

**Cause**: No `get` commands have been issued against the cache.

**Fix**:

1. The `memcached.operation_hit_ratio` metric requires both `get` hits and
   misses to calculate — it stays zero until the cache is actively used
2. Verify cache traffic with `echo "stats" | nc localhost 11211` and check
   `get_hits` and `get_misses` counters

## FAQ

**Does this work with Memcached running in Kubernetes?**

Yes. Set `endpoint` to the Memcached service DNS
(e.g., `memcached.default.svc.cluster.local:11211`) and ensure the
Collector pod can reach port 11211. The Collector can run as a sidecar
or DaemonSet.

**How do I monitor multiple Memcached instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  memcached/primary:
    endpoint: memcached-1:11211
    transport: tcp
  memcached/replica:
    endpoint: memcached-2:11211
    transport: tcp
```

Then include both in the pipeline:
`receivers: [memcached/primary, memcached/replica]`

**Why is `transport: tcp` required?**

The Memcached receiver defaults to an empty transport value, which causes
a startup error. This is a known quirk — always set `transport: tcp`
explicitly in the config.

**Can I monitor Memcached with SASL authentication?**

The OTel Memcached receiver does not support SASL authentication. If your
Memcached instance requires SASL, you need to run the Collector on a host
that has direct network access without authentication, or use a sidecar
deployment pattern.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [MongoDB](./mongodb.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your cache
  usage patterns

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Redis Monitoring](./redis.md) — Alternative caching service monitoring
- [ElastiCache Monitoring](../infra/aws/elasticache.md) — AWS ElastiCache
  monitoring
