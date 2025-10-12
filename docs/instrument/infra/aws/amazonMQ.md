---
date: 2025-04-27
id: collecting-aws-amazon-mq-telemetry
title: AWS Amazon MQ Monitoring via CloudWatch Metrics Stream
description:
  Monitor AWS Amazon MQ RabbitMQ and ActiveMQ with CloudWatch Metrics Stream and
  OpenTelemetry. Collect message queue metrics, broker stats, and logs using
  Scout.
keywords:
  [
    aws amazon mq monitoring,
    amazon mq rabbitmq monitoring,
    cloudwatch metrics stream,
    aws message queue monitoring,
    amazon mq observability,
  ]
---

## Overview

This guide will walk you through collecting rich telemetry data from your Amazon
MQ using CloudWatch Metrics Stream. We recommend using CloudWatch Metrics Stream
over Prometheus exporters as it provides faster metric delivery (2-3 minute
latency) and is more efficient for AWS services.

## Collecting Amazon MQ Metrics

For collecting Amazon MQ metrics, we recommend using **CloudWatch Metrics
Stream** instead of Prometheus exporters. CloudWatch Metrics Stream provides:

- **Faster delivery**: 2-3 minute latency vs 5+ minutes with polling
- **Lower cost**: No need to run dedicated exporters
- **Better scalability**: Native AWS service integration
- **Automatic metric discovery**: No need to manually configure metric lists

### Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive
[CloudWatch Metrics Stream guide](cloudwatch-metrics-stream.md) to set up the
infrastructure.

### Step 2: Configure Amazon MQ metrics filtering

When configuring your CloudWatch Metrics Stream in **Step 3** of the setup
guide, make sure to:

1. **Select specific namespaces** instead of "All namespaces"
2. **Choose only AWS/AmazonMQ** from the namespace list
3. This ensures you only collect Amazon MQ metrics, reducing costs and data
   volume

### Step 3: Create OTEL Collector config for RabbitMQ metrics (Optional)

If you're using RabbitMQ as your broker engine and need detailed broker-specific
metrics, create `amazon-mq-metrics-collection-config.yaml`:

```yaml
receivers:
  rabbitmq:
    endpoint: ${env:RABBITMQ_ENDPOINT}
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
    collection_interval: 10s
    metrics:
      rabbitmq.node.disk_free:
        enabled: true
      rabbitmq.node.disk_free_limit:
        enabled: true
      rabbitmq.node.disk_free_alarm:
        enabled: true
      rabbitmq.node.mem_used:
        enabled: true
      rabbitmq.node.mem_limit:
        enabled: true
      rabbitmq.node.mem_alarm:
        enabled: true
      rabbitmq.node.fd_used:
        enabled: true
      rabbitmq.node.fd_total:
        enabled: true
      rabbitmq.node.sockets_used:
        enabled: true
      rabbitmq.node.sockets_total:
        enabled: true
      rabbitmq.node.proc_used:
        enabled: true
      rabbitmq.node.proc_total:
        enabled: true
      rabbitmq.node.disk_free_details.rate:
        enabled: true
      rabbitmq.node.fd_used_details.rate:
        enabled: true
      rabbitmq.node.mem_used_details.rate:
        enabled: true
      rabbitmq.node.proc_used_details.rate:
        enabled: true
      rabbitmq.node.sockets_used_details.rate:
        enabled: true

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/amazon_mq:
      receivers: [rabbitmq]
      exporters: [otlp]
```

> **Note**: CloudWatch Metrics Stream will automatically deliver AWS/AmazonMQ
> metrics (CPU utilization, connection counts, message counts, etc.), while the
> RabbitMQ receiver collects detailed broker-specific metrics if needed.

## Collecting Amazon MQ Logs

The log collection of Amazon MQ requires specifying the list of log group names.
From the AWS CloudWatch console, please find the log group(s) relevant to the
integration.

### Create the Collector config file

```yaml
receivers:
  awscloudwatch/amazon_mq_logs:
    region: us-east-1
    logs:
      poll_interval: 1m
      groups:
        named:
          # replace with your Amazon MQ log group name
          /aws/amazonmq/:

processors:
  attributes/add_source_amazon_mq:
    actions:
      - key: source
        value: "amazonMQ"
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
    logs/amazonmq:
      receivers: [awscloudwatch/amazon_mq_logs]
      processors: [attributes/add_source_amazon_mq, batch]
      exporters: [otlp]
```

After deploying these changes, generate some traffic to your Amazon MQ and check
in Scout to see your Amazon MQ's metrics and logs.

---

With this setup, your Amazon MQ broker becomes fully observable through Scout.
You'll gain real-time visibility into performance metrics and logs without any
changes to your application code.

## Related Guides

- [CloudWatch Metrics Stream Setup](./cloudwatch-metrics-stream.md) - Set up AWS
  metrics streaming
- [RabbitMQ Monitoring](../../component/rabbitmq.md) - Self-hosted RabbitMQ
  monitoring guide
- [OTel Collector Configuration](../../collector-setup/otel-collector-config.md)
  \- Advanced collector configuration
