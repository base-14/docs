---
title: >
  Redis OpenTelemetry Monitoring - Memory, Keyspace,
  and Latency Metrics
sidebar_label: Redis
id: collecting-redis-telemetry
sidebar_position: 5
description: >
  Collect Redis metrics with the OpenTelemetry redis receiver. Monitor
  memory saturation, keyspace hit ratio, and command latency, then ship
  to base14 Scout.
keywords:
  - redis opentelemetry
  - redis otel collector
  - redis metrics monitoring
  - redis performance monitoring
  - opentelemetry redis receiver
  - redis observability
  - redis cache monitoring
  - redis telemetry collection
---

# Redis

The OpenTelemetry Collector's Redis receiver collects 33 metrics from
Redis 6.0+ over a single TCP connection, including command throughput,
keyspace hit/miss ratio, memory saturation, fragmentation, connection
load, persistence state, and replication offset. The receiver reads
Redis `INFO` and `COMMAND` introspection - no exporter sidecar is
needed. This guide configures the receiver, verifies connectivity, and
ships metrics to base14 Scout.

> **Running Azure Cache for Redis (PaaS)?** Use the
> [Azure Cache for Redis monitoring guide](../infra/azure/cache-for-redis.md)
> instead. The PaaS surface publishes through Azure Monitor with
> resource-level dimensions; this guide's `redis` receiver path scrapes
> raw INFO output and produces a different (richer per-key, per-command)
> metric set. The two paths can run in the same collector for hybrid
> deployments.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Redis                  | 6.0     | 8.0+        |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- Redis must be accessible over TCP from the host running the Collector
  (default port 6379).
- Redis password (if authentication is enabled).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

The `redis` receiver has no `up` metric. The presence of fresh samples is
the real liveness signal - a failed scrape emits nothing. `redis.commands`
then shows whether a live server is doing work, though an idle but healthy
server legitimately reads zero.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `redis.commands` | Commands processed per second - throughput KPI and liveness proxy. |
| `redis.keyspace.hits`, `redis.keyspace.misses` | The hit ratio `hits / (hits + misses)` - the defining health signal for a cache. |
| `redis.memory.used` | Memory in use by the dataset - the saturation anchor; memory pressure is the most common Redis incident. |
| `redis.memory.fragmentation_ratio` | RSS / used; fragmentation overhead read alongside used memory, so waste is visible without leaving Core. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Memory ceiling and pressure | `redis.maxmemory`, `redis.keys.evicted`, `redis.memory.rss` | The configured ceiling, keys dropped under pressure, and resident memory the OS sees. |
| Connections | `redis.clients.connected`, `redis.clients.blocked`, `redis.connections.rejected` | Connection load, clients stuck on blocking calls (BLPOP etc.), and connections refused at `maxclients`. |
| CPU | `redis.cpu.time` | CPU consumed, by mode (sys/user, main/children). |
| Persistence | `redis.rdb.changes_since_last_save`, `redis.latest_fork` | Unsaved writes since the last RDB save, and the duration of the last fork (blocks during bgsave). |
| Replication | `redis.slaves.connected`, `redis.replication.offset` | Connected replicas and the master replication offset. |
| Expiry | `redis.keys.expired` | Keys removed on TTL expiry. |

### Diagnostic - for investigation and tuning

Higher cardinality; enable on demand. In production you can drop this
tier with a `filter` processor and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Per-command breakdown | `redis.cmd.calls`, `redis.cmd.usec`, `redis.cmd.latency` (by `cmd` label) | Find the command driving latency or CPU; high cardinality. |
| Per-database breakdown | `redis.db.keys`, `redis.db.expires`, `redis.db.avg_ttl` (by `db` label) | Key counts, TTL coverage, and average TTL (ms) per logical DB. |
| Memory internals | `redis.memory.peak`, `redis.memory.lua` | Peak consumption and Lua-engine memory. |
| Network throughput | `redis.net.input`, `redis.net.output` | Bytes received and sent over the network. |
| Cumulative counters | `redis.commands.processed`, `redis.connections.received` | Lifetime totals for commands and accepted connections. |
| Buffer and backlog internals | `redis.clients.max_input_buffer`, `redis.clients.max_output_buffer`, `redis.replication.backlog_first_byte_offset` | Largest client buffers and the replication backlog start offset. |
| Uptime | `redis.uptime` | Server uptime in seconds; a reset flags a restart. |

Full metric reference:
[OTel Redis Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/redisreceiver).

The receiver's `redis.cmd.calls`, `redis.cmd.usec`, `redis.cmd.latency`,
and `redis.maxmemory` metrics are default-off; the config below enables
them. `redis.cmd.latency` is sourced from `INFO latencystats`, which exists
only on Redis 7.0+; on older servers it stays empty even when enabled.
`redis.cluster.*`, `redis.memory.used_memory_overhead`,
`redis.memory.used_memory_startup`, and `redis.mode` are also default-off
and not applicable to a standalone instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
These are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `redis.memory.used / redis.maxmemory` | > 0.80 | Approaching 1.0 | Next writes trigger eviction or OOM; raise `maxmemory` or scale out. |
| `rate(redis.keys.evicted)` | > 0 sustained | Rising across scrapes | Working set exceeds `maxmemory`; keys are being dropped. Resize or review TTLs. |
| `hits / (hits + misses)` | Falling vs baseline | Sharp drop | Cache effectiveness dropping; review key TTLs, sizing, or access patterns. |
| `rate(redis.connections.rejected)` | > 0 | Sustained > 0 | `maxclients` reached; raise it or fix a client connection leak. |
| `redis.clients.blocked` | Rising vs baseline | Climbing and not draining | Consumers stuck on blocking commands; check workers draining lists/streams. |
| `redis.memory.fragmentation_ratio` | Elevated vs ~1.0 | Far above 1.0 | RSS far above used memory; consider active defrag or a planned restart. |
| `redis.rdb.changes_since_last_save` | Growing with no recent `redis.latest_fork` | Sustained growth | Unsaved writes accumulating; check disk and `save` policy for data-loss risk. |

## Access Setup

Redis uses password-based authentication when `requirepass` (or an ACL
user) is configured. No special monitoring user is required - the
receiver connects with the standard `AUTH` command and reads `INFO`
output (it issues `INFO all`), which is available to any authenticated
client. The keyspace, command-stats, and latency-stats metrics are all
parsed from `INFO` sections, not separate commands.

For least privilege, you can scope a dedicated ACL user to just that
command:

```bash showLineNumbers title="redis monitoring user setup (optional)"
# Read-only monitoring user limited to INFO (the only command the receiver issues)
redis-cli ACL SETUSER otel_monitor on >your_password +info
# Add +cluster|info as well if you enable the redis.cluster.* metrics
```

Verify connectivity from the host running the Collector:

```bash showLineNumbers title="Verify access"
# With authentication
redis-cli -h <redis-host> -p <redis-port> -a <password> ping

# Without authentication
redis-cli -h <redis-host> -p <redis-port> ping
```

## Configuration

The four default-off metrics worth enabling are `redis.maxmemory` (so
the saturation alert has a denominator) and the per-command series
`redis.cmd.calls` / `redis.cmd.usec` / `redis.cmd.latency`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  redis:
    endpoint: ${env:REDIS_ENDPOINT}   # Change to your Redis host:port
    collection_interval: 10s
    # password: ${env:REDIS_PASSWORD}  # Uncomment if authentication is enabled

    metrics:
      redis.maxmemory:
        enabled: true
      redis.cmd.calls:
        enabled: true
      redis.cmd.usec:
        enabled: true
      redis.cmd.latency:
        enabled: true

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
      receivers: [redis]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic tier with a
`filter` processor while keeping the Core and Operational series. The
per-command (`redis.cmd.*`) and per-database (`redis.db.*`) series carry
the most cardinality, so they are the first to drop.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
REDIS_ENDPOINT=localhost:6379
REDIS_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the receiver starting and scraping
docker logs otel-collector 2>&1 | grep -i "redis"

# Verify Redis is responding
redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} info server

# Generate traffic so keyspace and hit/miss metrics populate
redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} set probe 1
redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} get probe
redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} get missing-key
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach Redis at the configured endpoint.

**Fix**:

1. Verify Redis is running: `systemctl status redis` or
   `docker ps | grep redis`.
2. Confirm the endpoint address and port (default 6379) in your config.
3. Check the `bind` directive in `redis.conf` - change to `0.0.0.0` if
   the Collector runs on a separate host.

### Authentication failed (NOAUTH)

**Cause**: Redis requires a password but none is configured in the
receiver.

**Fix**:

1. Uncomment the `password` field in the receiver config.
2. Set `REDIS_PASSWORD` in your environment variables.
3. Test credentials: `redis-cli -a $REDIS_PASSWORD ping`.

### Hit ratio looks low or commands are slow

**Cause**: A few commands dominate latency or the access pattern is
missing the cache.

**Look at**: the Diagnostic `redis.cmd.latency` and `redis.cmd.usec`
series (by `cmd` label) to find the offending command, and
`redis.keyspace.hits` / `redis.keyspace.misses` for the ratio trend.
Cross-check `redis.db.keys` and `redis.db.avg_ttl` to see whether a
logical DB is under-populated or its keys are expiring too fast.

**Fix**:

1. Review TTLs and key sizing for the workload driving misses.
2. If one command dominates `redis.cmd.usec`, profile or rate-limit it.

### Memory keeps climbing or eviction starts

**Cause**: The working set is approaching `maxmemory`, or memory is
fragmented.

**Look at**: `redis.memory.used` against `redis.maxmemory`,
`redis.keys.evicted` (rising means keys are being dropped), and
`redis.memory.fragmentation_ratio` (well above 1.0 means RSS far exceeds
used memory). `redis.memory.peak` shows the high-water mark.

**Fix**:

1. Raise `maxmemory` or scale out if `used` is approaching the ceiling.
2. Enable `activedefrag` or schedule a restart if fragmentation is high.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Redis running in Kubernetes?**

Yes. Set `endpoint` to the Redis service DNS
(e.g., `redis.default.svc.cluster.local:6379`) and inject the password
via a Kubernetes secret. The Collector can run as a sidecar or
DaemonSet.

**How do I monitor multiple Redis instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  redis/primary:
    endpoint: redis-1:6379
  redis/replica:
    endpoint: redis-2:6379
```

Then include both in the pipeline:
`receivers: [redis/primary, redis/replica]`.

**What about Redis Cluster mode?**

Each Redis Cluster node must be monitored individually. Add a separate
receiver block for each node endpoint. The Collector connects to each
node's standard Redis port, not the cluster bus port.

**Why are replication metrics showing zero?**

`redis.slaves.connected` and `redis.replication.offset` require
replication to be configured. On a standalone instance with no replicas,
these report zero - this is expected.

**Why is `redis.maxmemory` not showing up?**

It is default-off in the receiver. Enable it under `metrics:` (as in the
config above) so the memory-saturation alert has a denominator.

## Related Guides

- [Azure Cache for Redis Monitoring](../infra/azure/cache-for-redis.md) -
  the PaaS path for Azure-managed deployments.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Redis metrics.
- [Memcached Monitoring](./memcached.md) - Alternative caching service.
- [ElastiCache Monitoring](../infra/aws/elasticache.md) - AWS-managed
  Redis and Memcached.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Memcached](./memcached.md), [RabbitMQ](./rabbitmq.md), and other
  components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
