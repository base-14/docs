---
title: >
  Redis OpenTelemetry Monitoring — Memory, Latency,
  and Keyspace Metrics
sidebar_label: Redis
id: collecting-redis-telemetry
sidebar_position: 5
description: >
  Collect Redis metrics with the OpenTelemetry Collector. Monitor memory
  usage, keyspace hits, connections, and replication status using the
  Redis receiver and export to base14 Scout.
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

The OpenTelemetry Collector's Redis receiver collects 31+ metrics from
Redis 6.0+, including memory usage, keyspace hit ratios, connection
counts, command latency, and replication status. This guide configures
the receiver, verifies connectivity, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Redis                  | 6.0     | 7.0+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Redis must be accessible from the host running the Collector
- Redis password (if authentication is enabled)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Memory**: used memory, peak memory, RSS, Lua memory, fragmentation
  ratio
- **Connections**: connected clients, blocked clients, received/rejected
  connections
- **Keyspace**: hits, misses, expired keys, evicted keys
- **Throughput**: commands processed, network I/O, command latency
- **Persistence**: RDB changes since last save, latest fork duration
- **Replication**: connected replicas, replication offset, backlog offset

Full metric reference:
[OTel Redis Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/redisreceiver)

## Access Setup

Redis uses password-based authentication (if enabled). No special user
creation is required — the Collector connects using the standard
`AUTH` command.

Verify connectivity:

```bash showLineNumbers
# With authentication
redis-cli -h <redis-host> -p <redis-port> -a <password> ping

# Without authentication
redis-cli -h <redis-host> -p <redis-port> ping
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  redis:
    endpoint: ${env:REDIS_ENDPOINT}
    collection_interval: 20s
    # password: ${env:REDIS_PASSWORD}  # Uncomment if authentication is enabled

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
      receivers: [redis]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

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
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "redis"

# Verify Redis is responding
redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} info
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach Redis at the configured endpoint.

**Fix**:

1. Verify Redis is running: `systemctl status redis` or
   `docker ps | grep redis`
2. Confirm the endpoint address and port (default 6379) in your config
3. Check `bind` directive in `redis.conf` — change to `0.0.0.0` if the
   Collector runs on a separate host

### Authentication failed (NOAUTH)

**Cause**: Redis requires a password but none is configured in the
receiver.

**Fix**:

1. Uncomment the `password` field in the receiver config
2. Set `REDIS_PASSWORD` in your environment variables
3. Test credentials: `redis-cli -a $REDIS_PASSWORD ping`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Memory fragmentation ratio above 1.5

**Cause**: This is not a collection issue — fragmentation ratio above
1.5 indicates Redis memory fragmentation.

**Fix**:

1. The `redis.memory.fragmentation_ratio` metric is reporting correctly
2. Values above 1.5 suggest memory management issues — consider
   restarting Redis or tuning `activedefrag` settings
3. Monitor alongside `redis.memory.used` and `redis.memory.rss`

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
`receivers: [redis/primary, redis/replica]`

**What about Redis Cluster mode?**

Each Redis Cluster node must be monitored individually. Add a separate
receiver block for each node endpoint. The Collector connects to each
node's standard Redis port, not the cluster bus port.

**Why are replication metrics showing zero?**

`redis.slaves.connected`, `redis.replication.offset`, and
`redis.replication.replica_offset` require replication to be configured.
On standalone instances without replicas, these metrics report zero —
this is expected.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Memcached](./memcached.md), [RabbitMQ](./rabbitmq.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your
  cache usage patterns

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Memcached Monitoring](./memcached.md) — Alternative caching service
  monitoring
- [ElastiCache Monitoring](../infra/aws/elasticache.md) — AWS ElastiCache
  monitoring
