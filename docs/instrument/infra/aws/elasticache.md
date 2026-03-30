---
date: 2025-04-28
id: collecting-aws-elasticache-telemetry
title: AWS ElastiCache Monitoring with OpenTelemetry - Redis & Memcached Metrics
sidebar_label: AWS ElastiCache
description:
  Monitor AWS ElastiCache Redis and Memcached with OpenTelemetry and
  CloudWatch Metrics Stream. Track cache hit rates, evictions, memory,
  latency, and connected clients in base14 Scout.
keywords:
  - aws elasticache monitoring
  - elasticache redis monitoring
  - elasticache metrics
  - elasticache redis metrics
  - elasticache observability
  - cloudwatch metrics stream
  - aws cache monitoring
  - elasticache redis observability
  - monitor elasticache
  - elasticache cloudwatch metrics
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor AWS ElastiCache with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Use CloudWatch Metrics Stream to collect ElastiCache infrastructure metrics (CPU, memory, network) with 2-3 minute latency, and add the OpenTelemetry Redis receiver for cache-specific metrics like command latency, keyspace hits, and connected clients. Both feed into base14 Scout."}},{"@type":"Question","name":"What ElastiCache metrics does CloudWatch collect?","acceptedAnswer":{"@type":"Answer","text":"CloudWatch collects CPUUtilization, EngineCPUUtilization, FreeableMemory, NetworkBytesIn/Out, CurrConnections, NewConnections, CacheHits, CacheMisses, Evictions, ReplicationLag, and BytesUsedForCache for ElastiCache Redis and Memcached."}},{"@type":"Question","name":"Should I use CloudWatch Metrics Stream or the Redis receiver for ElastiCache?","acceptedAnswer":{"@type":"Answer","text":"Use both. CloudWatch provides host-level metrics (CPU, memory, network). The OTel Redis receiver adds cache internals like per-command latency, keyspace statistics, and memory fragmentation ratio. Together they give complete visibility."}},{"@type":"Question","name":"How do I monitor ElastiCache Redis slow commands?","acceptedAnswer":{"@type":"Answer","text":"Enable Redis slow log in your ElastiCache parameter group by setting slowlog-log-slower-than to a threshold in microseconds (e.g., 10000 for 10ms). Forward slow logs via CloudWatch Logs to your OTel Collector for analysis."}},{"@type":"Question","name":"What is a good cache hit rate for ElastiCache Redis?","acceptedAnswer":{"@type":"Answer","text":"A healthy Redis cache hit rate is above 95%. Below 90% indicates that a significant portion of requests are missing the cache and hitting the backend database, which defeats the purpose of caching. Monitor CacheHits / (CacheHits + CacheMisses) to track this ratio."}},{"@type":"Question","name":"How do I set up alerts for ElastiCache?","acceptedAnswer":{"@type":"Answer","text":"Route ElastiCache metrics through CloudWatch Metrics Stream to base14 Scout, then alert on: cache hit rate below 90%, evictions above zero (sustained), memory usage above 80%, CPU above 70%, replication lag above 5 seconds, and current connections approaching the max."}},{"@type":"Question","name":"Can I monitor both ElastiCache Redis and Memcached with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Yes. CloudWatch Metrics Stream supports both engines. For Redis, add the OTel Redis receiver for deeper cache-level metrics. For Memcached, the OTel Memcached receiver collects hit rates, evictions, and connection counts."}}]}
---

## Overview

This guide covers monitoring AWS ElastiCache (Redis and Memcached)
using OpenTelemetry and CloudWatch Metrics Stream. You'll collect
infrastructure metrics from CloudWatch, cache-specific metrics from
the Redis receiver, and slow logs — all flowing into base14 Scout.

## What You'll Monitor

ElastiCache monitoring combines CloudWatch metrics with optional
Redis receiver metrics for complete visibility:

**CloudWatch Metrics Stream (infrastructure + cache basics):**

| Metric | What it tells you |
| ------ | ----------------- |
| `CPUUtilization` | Instance CPU usage (%) |
| `EngineCPUUtilization` | Redis/Memcached engine CPU (%) — more relevant than host CPU |
| `FreeableMemory` | Available RAM (bytes) |
| `BytesUsedForCache` | Memory used by the cache engine |
| `CacheHits` / `CacheMisses` | Cache effectiveness |
| `Evictions` | Keys removed due to memory pressure |
| `CurrConnections` / `NewConnections` | Client connection counts |
| `NetworkBytesIn` / `NetworkBytesOut` | Network throughput |
| `ReplicationLag` | Replica delay (seconds, Redis only) |
| `SaveInProgress` | Whether a background save is running (Redis) |
| `CurrItems` | Number of items in the cache |

**OTel Redis receiver (cache internals, Redis only):**

| Metric | What it tells you |
| ------ | ----------------- |
| `redis.memory.used` | Actual memory consumed by Redis |
| `redis.maxmemory` | Configured memory limit |
| `redis.connected_clients` | Currently connected client count |
| `redis.keyspace.hits` / `redis.keyspace.misses` | Per-keyspace hit/miss rates |
| `redis.keys.expired` | Keys expired by TTL |
| `redis.keys.evicted` | Keys evicted under memory pressure |
| `redis.uptime` | Time since last restart (seconds) |
| `redis.memory.fragmentation_ratio` | Memory fragmentation (> 1.5 is a concern) |
| `redis.commands.processed` | Total commands processed |
| `redis.connections.received` | Total connections received since start |

## Prerequisites

| Requirement | Minimum | Recommended |
| ----------- | ------- | ----------- |
| ElastiCache | Redis 6.x or Memcached 1.6 | Redis 7.x |
| OTel Collector Contrib | 0.90.0 | latest |
| base14 Scout | Any | - |
| AWS permissions | CloudWatch, Kinesis Firehose, S3 | - |

Before starting:

- ElastiCache cluster must be accessible from the host running the
  OTel Collector (same VPC)
- For the Redis receiver: AUTH token if encryption in transit is
  enabled
- CloudWatch Metrics Stream infrastructure set up (see Step 1)

## Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive
[CloudWatch Metrics Stream guide](cloudwatch-metrics-stream.md) to
set up the streaming infrastructure (S3 bucket, Kinesis Firehose,
Metrics Stream).

When configuring the Metrics Stream:

1. Select **specific namespaces** instead of "All namespaces"
2. Choose **AWS/ElastiCache** from the namespace list
3. This ensures you only collect ElastiCache metrics, reducing costs
   and data volume

## Step 2: Configure the OTel Collector for Redis metrics

For Redis clusters, add the Redis receiver for cache-internal metrics
that CloudWatch doesn't expose:

```yaml showLineNumbers title="elasticache-redis-config.yaml"
receivers:
  redis:
    endpoint: ${env:REDIS_ENDPOINT}
    collection_interval: 60s
    password: ${env:REDIS_AUTH_TOKEN}
    tls:
      insecure: false
      ca_file: /etc/ssl/certs/ca-certificates.crt
    metrics:
      redis.maxmemory:
        enabled: true
      redis.connected_clients:
        enabled: true
      redis.uptime:
        enabled: true
      redis.memory.used:
        enabled: true
      redis.memory.fragmentation_ratio:
        enabled: true
      redis.keys.expired:
        enabled: true
      redis.keys.evicted:
        enabled: true
      redis.keyspace.hits:
        enabled: true
      redis.keyspace.misses:
        enabled: true
      redis.commands.processed:
        enabled: true
      redis.connections.received:
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
      - key: cloud.provider
        value: aws
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
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment variables

```bash showLineNumbers title=".env"
REDIS_ENDPOINT=your-cluster.xxxxx.ng.0001.use1.cache.amazonaws.com:6379
REDIS_AUTH_TOKEN=your_auth_token
ENVIRONMENT=production
SERVICE_NAME=elasticache-redis
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Note**: CloudWatch Metrics Stream delivers the infrastructure
> metrics (CPU, memory, connections, evictions) automatically. The
> Redis receiver above adds cache internals like keyspace hit rates,
> memory fragmentation, and connection details. For Memcached
> clusters, use the
> [Memcached receiver](../../component/memcached.md) instead.

## Step 3: Collect ElastiCache logs

ElastiCache Redis supports two log types through CloudWatch:

- **Slow log** — commands exceeding a latency threshold
- **Engine log** — connection events, failovers, configuration changes

Configure the CloudWatch Logs receiver:

```yaml showLineNumbers title="elasticache-logs-config.yaml"
receivers:
  awscloudwatchlogs/elasticache:
    region: ${env:AWS_REGION}
    logs:
      poll_interval: 1m
      groups:
        named:
          # Replace <cluster-id> with your ElastiCache cluster ID
          /aws/elasticache/cluster/${env:CLUSTER_ID}/slow-log:
          /aws/elasticache/cluster/${env:CLUSTER_ID}/engine-log:

processors:
  attributes/add_source:
    actions:
      - key: source
        value: "elasticache"
        action: insert
      - key: cloud.provider
        value: "aws"
        action: insert

  batch:
    send_batch_size: 10000
    send_batch_max_size: 11000
    timeout: 10s

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    logs/elasticache:
      receivers: [awscloudwatchlogs/elasticache]
      processors: [attributes/add_source, batch]
      exporters: [otlphttp/b14]
```

### Enable slow log in ElastiCache

In your ElastiCache parameter group, set:

```text
slowlog-log-slower-than = 10000    # Log commands over 10ms (microseconds)
slowlog-max-len = 128              # Keep last 128 slow commands
```

Then in the ElastiCache console, enable **Log delivery** for both
slow log and engine log, targeting CloudWatch Logs.

## Step 4: Verify the setup

Start the Collector and check for metrics:

```bash showLineNumbers
# Test Redis connectivity from the Collector host
redis-cli -h ${REDIS_ENDPOINT%:*} -p 6379 \
  --tls --cacert /etc/ssl/certs/ca-certificates.crt \
  -a ${REDIS_AUTH_TOKEN} ping
```

Check Scout for both CloudWatch metrics (prefixed `aws.elasticache.*`)
and Redis metrics (prefixed `redis.*`).

## Key alerts to configure

| Metric | Warning | Critical | Why |
| ------ | ------- | -------- | --- |
| Cache hit rate | < 90% | < 80% | Low hit rate means cache isn't effective — requests hit the database instead |
| `Evictions` | > 0 (sustained) | > 100/min | Evictions mean memory pressure is forcing useful data out |
| `EngineCPUUtilization` | > 65% | > 80% | Redis is single-threaded — high CPU means commands are queuing |
| `BytesUsedForCache` | > 80% of max | > 90% of max | Approaching memory limit triggers aggressive eviction |
| `CurrConnections` | > 80% of max | > 90% of max | Connection exhaustion causes application errors |
| `ReplicationLag` | > 5s | > 30s | High lag means replicas serve stale data |
| `redis.memory.fragmentation_ratio` | > 1.5 | > 2.0 | High fragmentation wastes memory — consider a restart |
| Slow log entries | > 10/min | > 50/min | Frequent slow commands indicate saturation — check slow log |

**Cache hit rate formula:**
`CacheHits / (CacheHits + CacheMisses) * 100`

> **Why EngineCPUUtilization, not CPUUtilization?** ElastiCache Redis
> is single-threaded. `CPUUtilization` shows total host CPU across
> all cores, which can look low even when the Redis engine core is
> saturated. `EngineCPUUtilization` shows the single-core usage that
> actually matters.

## Troubleshooting

### Redis receiver shows no metrics

**Cause**: Collector can't reach the ElastiCache cluster.

**Fix**:

1. ElastiCache is VPC-only — the Collector must run in the same VPC
   or a peered VPC
2. Check the security group allows inbound on port 6379 from the
   Collector's security group
3. If encryption in transit is enabled, the Redis receiver must use
   TLS (`tls.insecure: false` with a CA cert)
4. Test connectivity:
   `redis-cli -h <endpoint> -p 6379 --tls -a <token> ping`

### CloudWatch metrics not appearing

**Cause**: Metrics Stream not configured for the AWS/ElastiCache
namespace.

**Fix**:

1. In CloudWatch > Metrics > Streams, verify the stream is active
2. Check that the namespace filter includes `AWS/ElastiCache`
3. Verify Kinesis Firehose delivery is succeeding
4. Allow 5-10 minutes for initial metrics to flow

### High evictions but low memory usage

**Cause**: The `maxmemory-policy` is set to a volatile policy
(like `volatile-lru`) and keys without TTLs are filling memory,
while keys with TTLs get evicted.

**Fix**:

1. Check the eviction policy:
   `redis-cli CONFIG GET maxmemory-policy`
2. If using `volatile-lru`, consider switching to `allkeys-lru`
3. Review key TTL distribution — sample keys and check their TTLs
   to identify keys without expiration

### Cache hit rate dropping

**Cause**: Application pattern change, insufficient memory, or key
expiration settings.

**Fix**:

1. Check if evictions are increasing (memory pressure pushing out
   useful keys)
2. Review whether application code is requesting keys that were
   never cached
3. Compare `CurrItems` trend — a sudden drop suggests mass
   expiration
4. Consider increasing node size or adding shards

## FAQ

**How do I monitor ElastiCache Redis slow commands?**

Enable the slow log in your ElastiCache parameter group by setting
`slowlog-log-slower-than` to a threshold in microseconds (10000 =
10ms). Enable log delivery to CloudWatch Logs, then forward to
Scout via the CloudWatch Logs receiver.

**What is a good cache hit rate?**

Above 95% is healthy. Below 90% means a significant portion of
requests miss the cache and hit the backend database. Track the
ratio over time — a gradual decline often indicates growing data
volume without proportional cache capacity.

**Can I monitor Memcached clusters with this setup?**

Yes. CloudWatch Metrics Stream covers Memcached infrastructure
metrics. For cache-specific metrics, the OTel Collector has a
[Memcached receiver](../../component/memcached.md) that collects
hit rates, evictions, connection counts, and memory usage — the
Memcached equivalent of the Redis receiver above.

**Should I monitor ElastiCache Serverless differently?**

ElastiCache Serverless uses the same CloudWatch metrics namespace
(`AWS/ElastiCache`) but adds metrics like
`ElastiCacheProcessingUnits` for capacity tracking. The CloudWatch
Metrics Stream setup is identical — just include the
`AWS/ElastiCache` namespace.

**How do I monitor multiple ElastiCache clusters?**

Add multiple Redis receiver blocks with distinct names:

```yaml
receivers:
  redis/sessions:
    endpoint: sessions-cluster.xxxxx.cache.amazonaws.com:6379
  redis/cache:
    endpoint: cache-cluster.xxxxx.cache.amazonaws.com:6379
```

Then include both in the pipeline:
`receivers: [redis/sessions, redis/cache]`.

## Related Guides

- [CloudWatch Metrics Stream Setup](./cloudwatch-metrics-stream.md) —
  Configure AWS metrics streaming
- [Redis Monitoring](../../component/redis.md) — Self-hosted Redis
  monitoring with OpenTelemetry
- [Memcached Monitoring](../../component/memcached.md) — Self-hosted
  Memcached monitoring
- [RDS Monitoring](./rds.md) — Monitor AWS RDS databases
- [ELB Monitoring](./elb.md) — Monitor AWS Application Load Balancers
- [OTel Collector Configuration](../../collector-setup/otel-collector-config.md)
  — Collector setup basics
