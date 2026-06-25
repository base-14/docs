---
title: >
  Memcached OpenTelemetry Monitoring - Hit Ratio, Evictions,
  and Collector Setup
sidebar_label: Memcached
id: collecting-memcached-telemetry
sidebar_position: 9
description: >
  Collect Memcached metrics with the OpenTelemetry Collector. Monitor
  cache hit ratio, evictions, connection load, and CPU usage, and ship
  to base14 Scout.
keywords:
  - memcached opentelemetry
  - memcached otel collector
  - memcached metrics monitoring
  - memcached cache monitoring
  - opentelemetry memcached receiver
  - memcached observability
  - memcached performance monitoring
  - memcached telemetry collection
---

# Memcached

The OpenTelemetry Collector's `memcachedreceiver` collects 11 metrics
from Memcached 1.6+ - cache byte usage and item counts, the operation
hit ratio, connection load, CPU, and network throughput. The receiver
connects over TCP to the Memcached stats protocol on port 11211; no
exporter or sidecar is needed. This guide configures the receiver,
verifies connectivity, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Memcached              | 1.6     | 1.6.x       |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Memcached must be reachable over TCP from the host running the
  Collector.
- No authentication is required - Memcached has no authentication enabled
  by default and uses network-level access control (see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

This surface has **no `up`, no uptime, and no health metric** - those
come from the Prometheus receiver, not the native `memcachedreceiver`.
Liveness here is the receiver scraping the stats endpoint successfully:
when it stops returning data, treat Memcached as unreachable.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `memcached.commands` | Commands executed by `command` (get/set/touch/flush) - the serving throughput KPI. |
| `memcached.operation_hit_ratio` | Hit ratio per `operation` (get/increment/decrement) - the cache-efficiency KPI. |
| `memcached.current_items` | Items currently stored - working-set size. |
| `memcached.connections.current` | Open connections - client load, and the only liveness proxy on this surface. |

`memcached.operation_hit_ratio` needs real `get` traffic - both hits and
misses - or it reads 0. It is also per-`operation`: it carries `get`,
`increment`, and `decrement` series, so the increment/decrement ratios
stay 0 until you issue that kind of traffic. That is expected, not a
silent metric.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `memcached.bytes` | Bytes currently stored - approaching the memory limit drives evictions. |
| `memcached.evictions` | Items evicted under memory pressure - rising means the cache is too small for the working set. |
| `memcached.network` | Bytes transferred by `direction` (sent/received) - bandwidth. |
| `memcached.connections.total` | Cumulative connections opened - connection churn and connection storms. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity
review.

| Metric | What it tells you |
|---|---|
| `memcached.operations` | get/increment/decrement by `type` (hit/miss) - the detailed breakdown behind the hit ratio. |
| `memcached.cpu.usage` | Accumulated CPU seconds by `state` (user/system). |
| `memcached.threads` | Worker thread count. |

Full metric reference:
[OTel Memcached Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/memcachedreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
These are starting points; tune them to your workload. Memcached exposes
no absolute service-level ceilings here, so the alerts are relative to
your own baseline.

| Metric | Threshold | Why it matters |
|---|---|---|
| Receiver no data | The `memcached` receiver produces no data for > 1m | No `up`/uptime on this surface - scrape success is liveness. Check the process and the receiver connection. |
| `memcached.operation_hit_ratio{operation=get}` | Falling vs baseline | More requests are missing the cache and hitting the origin. Check key TTLs, working-set size, and eviction pressure. |
| `rate(memcached.evictions)` | Rising vs baseline | Memory pressure is forcing items out - the cache is too small. Raise the memory limit or review TTLs and value sizes. |
| `memcached.bytes` | Approaching the configured memory limit | The cache is filling; evictions follow. Add memory or tune TTLs. |
| `memcached.connections.current` | Rising toward `max_connections` | Approaching the connection ceiling - clients will be refused. Raise the limit or pool connections. |

## Access Setup

Memcached has no built-in authentication. Access control is handled at
the network level - ensure only the Collector host can reach port 11211
(a firewall rule, security group, or container network policy).

Verify connectivity from the host that will run the Collector:

```bash showLineNumbers title="Verify Memcached connectivity"
echo "stats" | nc localhost 11211
```

If you use a firewall or container network, confirm the Collector can
reach the Memcached host and port before wiring up the receiver.

## Configuration

The native `memcachedreceiver` connects over TCP to the Memcached stats
protocol. `transport: tcp` must be set explicitly - the receiver
defaults to an empty transport and fails to start without it.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  memcached:
    endpoint: ${env:MEMCACHED_HOST}:11211   # Change to your Memcached address
    transport: tcp                          # Required - must be set explicitly
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
      receivers: [memcached]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.41.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
MEMCACHED_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for the Memcached receiver
docker logs otel-collector 2>&1 | grep -i "memcached"

# Verify Memcached is responding
echo "stats" | nc localhost 11211

# Check slab allocation
echo "stats slabs" | nc localhost 11211
```

If the hit ratio reads 0, drive some `get` traffic with both hits and
misses, then check `get_hits` and `get_misses` in the `stats` output.

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach Memcached at the configured
endpoint.

**Fix**:

1. Verify Memcached is running: `systemctl status memcached` or
   `docker ps | grep memcached`.
2. Confirm the endpoint address and port in your config.
3. Check firewall rules if the Collector runs on a separate host.

### Invalid transport type error

**Cause**: The `transport` field is missing from the receiver config.

**Fix**:

Add `transport: tcp` to the receiver configuration. Unlike most
receivers, the Memcached receiver requires this field to be set
explicitly:

```yaml showLineNumbers title="config/otel-collector.yaml (transport fix)"
receivers:
  memcached:
    endpoint: localhost:11211
    transport: tcp
```

### Hit ratio always zero

**Cause**: No `get` traffic with both hits and misses has reached the
cache.

**Look at**: `memcached.operations` - the per-`type` (hit/miss)
breakdown behind the hit ratio. If the miss series is flat, no traffic
is reaching the cache.

**Fix**:

1. `memcached.operation_hit_ratio` only populates once the cache serves
   real `get` traffic - both hits and misses. It stays 0 on an idle
   cache.
2. Confirm with `echo "stats" | nc localhost 11211` and check the
   `get_hits` and `get_misses` counters.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Memcached running in Kubernetes?**

Yes. Set `endpoint` to the Memcached service DNS
(e.g., `memcached.default.svc.cluster.local:11211`) and ensure the
Collector pod can reach port 11211. The Collector can run as a sidecar
or a DaemonSet.

**How do I monitor multiple Memcached instances?**

Add multiple receiver blocks with distinct names:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  memcached/primary:
    endpoint: memcached-1:11211
    transport: tcp
  memcached/replica:
    endpoint: memcached-2:11211
    transport: tcp
```

Then include both in the pipeline:
`receivers: [memcached/primary, memcached/replica]`.

**Why is `transport: tcp` required?**

The Memcached receiver defaults to an empty transport value, which
causes a startup error. This is a known quirk - always set
`transport: tcp` explicitly in the config.

**Can I monitor Memcached with SASL authentication?**

The OTel Memcached receiver does not support SASL authentication. If
your Memcached instance requires SASL, run the Collector on a host with
direct network access that does not require authentication, or use a
sidecar deployment pattern.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Memcached metrics.
- [Redis Monitoring](./redis.md) - The other in-memory cache you may run
  alongside Memcached.
- [MongoDB Monitoring](./mongodb.md) - The backing store Memcached often
  fronts.
- [ElastiCache Monitoring](../infra/aws/elasticache.md) - Managed
  Redis/Memcached cache monitoring on AWS.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [MongoDB](./mongodb.md), and other components.
