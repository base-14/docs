---
date: 2025-04-28
id: collecting-aws-elasticache-telemetry
title: ElastiCache
description: Use Scout to monitor your AWS ElastiCache instance with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your
ElastiCache caches using CloudWatch Metrics Stream. We recommend using CloudWatch
Metrics Stream over Prometheus exporters as it provides faster metric delivery
(2-3 minute latency) and is more efficient for AWS services.

## Collecting ElastiCache Metrics

For collecting ElastiCache metrics, we recommend using **CloudWatch Metrics Stream** instead of Prometheus exporters. CloudWatch Metrics Stream provides:

- **Faster delivery**: 2-3 minute latency vs 5+ minutes with polling
- **Lower cost**: No need to run dedicated exporters
- **Better scalability**: Native AWS service integration
- **Automatic metric discovery**: No need to manually configure metric lists

### Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive [CloudWatch Metrics Stream guide](cloudwatch-metrics-stream.md) to set up the infrastructure.

### Step 2: Configure ElastiCache metrics filtering

When configuring your CloudWatch Metrics Stream in **Step 3** of the setup guide, make sure to:

1. **Select specific namespaces** instead of "All namespaces"
2. **Choose only AWS/ElastiCache** from the namespace list
3. This ensures you only collect ElastiCache metrics, reducing costs and data volume

### Step 3: Create OTEL Collector config for Redis metrics (Optional)

If you're using Redis and need detailed cache-specific metrics, create `elasticache-metrics-collection-config.yaml`:

```yaml
receivers:
  redis:
    endpoint: ${env:REDIS_ENDPOINT}
    collection_interval: 60s
    password: ${env:REDIS_PASSWORD}
    # transport: tcp
    # tls:
    #   insecure: false
    #   ca_file: /etc/ssl/certs/ca-certificates.crt
    #   cert_file: /etc/ssl/certs/redis.crt
    #   key_file: /etc/ssl/certs/redis.key
    metrics:
      redis.maxmemory:
        enabled: true
      redis.cmd.latency:
        enabled: true
      redis.connected_clients:
        enabled: true
      redis.uptime:
        enabled: true
      redis.memory.used:
        enabled: true
      redis.keys.expired:
        enabled: true
      redis.keyspace.hits:
        enabled: true
      redis.keyspace.misses:
        enabled: true

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/elasticache:
      receivers: [redis]
      exporters: [otlp]
```

> **Note**: CloudWatch Metrics Stream will automatically deliver AWS/ElastiCache metrics (CPU utilization, memory usage, cache hits/misses, network I/O, etc.), while the Redis receiver collects detailed cache-specific metrics if needed.

## Collecting Elasticache Logs

The log collection of Elasticache Cluster requires specifying
the list of log group names.From the AWS CloudWatch console
, please find the log group(s) relevant to the integration.

### Create the Collector config file

```yaml
receivers:
  awscloudwatch/elasticache_logs:
    region: us-east-1
    logs:
      poll_interval: 1m
      groups:
        named:
          # replace with your Elasticache's log group name
          /aws/elasticache/:

processors:
  attributes/add_source_elasticache:
    actions:
      - key: source
        value: "elasticache"
        action: insert
  batch:
    send_batch_size: 10000
    send_batch_max_size: 11000
    timeout: 10s

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOINT>:4317"
    tls:
      insecure: false

service:
  pipelines:
    logs/elasticache:
      receivers: [awscloudwatch/elasticache_logs]
      processors: [attributes/add_source_elasticache, batch]
      exporters: [otlp]
```

After deploying these changes, generate some traffic to your elasticache cluster
and check in Scout to see your elasticache's metrics and logs.

---

With this setup, your AWS Elasticache cluster becomes fully observable through Scout.
You’ll gain real-time visibility into performance metrics and logs without
any changes to your application code.
