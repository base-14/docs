---
date: 2025-04-28
id: collecting-aws-elasticache-telemetry
title: using CloudWatch and Prometheus Cloudwatch exporter
description: Use Scout to monitor your AWS RDS postgres instance with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your
Elasticache caches using cloudwatch. We'll implement the prometheus cloudwatch exporter
to collect telemetry data from cloudwatch.

## Prerequisites

Before we begin, ensure you have:

### 1. AWS Credentials and Permissions

Required IAM permissions:

- `cloudwatch:ListMetrics`
- `cloudwatch:GetMetricStatistics`
- `cloudwatch:GetMetricData`
- `logs:DescribeLogGroups`
- `logs:FilterLogEvents`

## Collecting Elasticache Metrics

### Step 1. Configure the Prometheus exporter

Save the following config for collecting AWS Elasticache
metrics in a file named `aws-elasticache-metrics.yaml`
and update the region key with relevant value.

```yaml
---
region: us-east-1
metrics:
 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CPUUtilization
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: FreeableMemory
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: NetworkBytesIn
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: NetworkBytesOut
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: NetworkPacketsIn
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: NetworkPacketsOut
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: SwapUsage
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: BytesUsedForCache
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CacheHits
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CacheMisses
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CacheHitRate
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CurrConnections
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CurrItems
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: CurrVolatileItems
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: ReplicationLag
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: ReplicationLag
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: SaveInProgress
   aws_dimensions: [CacheClusterId, CacheNodeId]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: TrafficManagementActive
   aws_dimensions: [CacheClusterId, CacheNodeId]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: DatabaseCapacityUsagePercentage
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: DatabaseMemoryUsagePercentage
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: EngineCPUUtilization
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: Evictions
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: GlobalDatastoreReplicationLag
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: MemoryFragmentationRatio
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Average, Maximum]

 - aws_namespace: AWS/ElastiCache
   aws_metric_name: MemoryFragmentationRatio
   aws_dimensions: [CacheClusterId, CacheNodeId]
   aws_statistics: [Sum, Average]
---
``

### 2. Run the below command to Start the Exporter

```bash
 docker run -p 9106:9106 \
  -v $(pwd)/aws-elasticache-metrics.yaml:/config/config.yml \
  -e AWS_ACCESS_KEY_ID=<your-aws-access-key-id> \
  -e AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key> \
  quay.io/prometheus/cloudwatch-exporter
```

### 3. Verify the CloudWatch metrics

Visit [http://localhost:9106/metrics](http://localhost:9106/metrics)
and confirm the `aws_elasticache_*` metrics are avialable.

### 4. Create a OTEL Collector config file

create `elasticache-metrics-collection-config.yaml`

```yaml
receivers:
  # Optinally if you are using redis oss cache
  # use the below reciever as well
  redis:
    # The hostname and port of the Redis instance, separated by a colon.
    endpoint: ${env:REDIS_ENDPOINT}
    # The frequency at which to collect metrics from the Redis instance.
    collection_interval: 60s
    # The password used to access the Redis instance.
    password: ${env:REDIS_PASSWORD}
    # The network to use for connecting to the server. 
    # Valid Values are `tcp` or `Unix`
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

  prometheus:
    config:
      scrape_configs:
        - job_name: "aws-cloudwatch-metrics"
          scrape_timeout: 120s
          scrape_interval: 300s
          static_configs:
            - targets: ["0.0.0.0:9106"]
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: aws_elasticache_.*
              target_label: service
              replacement: elasticache

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOIINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/elasticache:
      receivers: [redis, prometheus]
      exporters: [otlp]
```

> Make Sure the environment variables are set.

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
