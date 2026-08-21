---
date: 2025-04-27
id: collecting-aws-amazon-mq-telemetry
title: AWS Amazon MQ Monitoring - ActiveMQ & RabbitMQ Metrics via CloudWatch
sidebar_label: AWS Amazon MQ
sidebar_position: 5
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

This guide covers collecting Amazon MQ broker and queue metrics (connection
counts, message counts, CPU, and memory) via CloudWatch Metrics Stream, plus
broker logs. We recommend CloudWatch Metrics Stream over Prometheus exporters:
it needs no per-broker exporter and delivers metrics to Scout in 3-5 minutes
end-to-end.

## What You'll Monitor

Amazon MQ monitoring combines CloudWatch broker metrics with optional
RabbitMQ receiver metrics for node-level internals:

**CloudWatch Metrics Stream (AWS/AmazonMQ):**

| Metric | Engine | What it tells you |
| ------ | ------ | ----------------- |
| `CpuUtilization` | Both | Broker instance CPU usage (%) |
| `HeapUsage` | ActiveMQ | JVM heap used (%) |
| `RabbitMQMemUsed` / `RabbitMQMemLimit` | RabbitMQ | Memory used vs the high-watermark limit |
| `RabbitMQDiskFree` / `RabbitMQDiskFreeLimit` | RabbitMQ | Free disk vs the low-watermark limit |
| `RabbitMQFdUsed` | RabbitMQ | File descriptors in use |
| `StorePercentUsage` | ActiveMQ | Percent of the message store consumed |
| `MemoryPercentUsage` / `TempPercentUsage` | ActiveMQ | Percent of memory / temp store used |
| `ConsumerCount` / `ProducerCount` | Both | Consumers / producers attached to a queue |
| `MessageCount` / `QueueSize` | Both | Messages currently held in a queue |
| `MessageReadyCount` | RabbitMQ | Messages ready for delivery (backlog) |
| `MessageUnacknowledgedCount` | RabbitMQ | Delivered but not yet acknowledged |
| `EnqueueCount` / `DequeueCount` | ActiveMQ | Messages published / consumed per period |
| `CurrentConnectionsCount` | Both | Open client connections to the broker |
| `NetworkIn` / `NetworkOut` | Both | Network throughput (bytes) |

**OTel RabbitMQ receiver (node internals, RabbitMQ only):**

| Metric | What it tells you |
| ------ | ----------------- |
| `rabbitmq.node.mem_used` / `rabbitmq.node.mem_limit` | Node memory used vs its limit |
| `rabbitmq.node.mem_alarm` | Whether the memory alarm has tripped |
| `rabbitmq.node.disk_free` / `rabbitmq.node.disk_free_limit` | Node free disk vs its limit |
| `rabbitmq.node.disk_free_alarm` | Whether the disk alarm has tripped |
| `rabbitmq.node.fd_used` / `rabbitmq.node.fd_total` | File descriptors used vs available |
| `rabbitmq.node.sockets_used` / `rabbitmq.node.sockets_total` | Sockets used vs available |
| `rabbitmq.node.proc_used` / `rabbitmq.node.proc_total` | Erlang processes used vs the limit |

## Prerequisites

| Requirement | Minimum | Recommended |
| ----------- | ------- | ----------- |
| Amazon MQ | ActiveMQ 5.x or RabbitMQ 3.x | RabbitMQ 3.13 |
| OTel Collector Contrib | 0.90.0 | latest |
| base14 Scout | Any | - |
| AWS permissions | CloudWatch, Amazon Data Firehose, S3, CloudWatch Logs | - |

Before starting:

- An Amazon MQ broker (ActiveMQ or RabbitMQ) running and serving traffic.
- CloudWatch Metrics Stream infrastructure set up (see Step 1).
- For the RabbitMQ receiver: the broker's HTTPS management endpoint reachable
  from the Collector, plus management-API credentials.

## Collecting Amazon MQ Metrics

For collecting Amazon MQ metrics, we recommend using **CloudWatch Metrics
Stream** instead of Prometheus exporters. CloudWatch Metrics Stream provides:

- **Faster delivery**: 3-5 minutes end-to-end vs 5+ minutes with polling.
- **Lower cost**: No need to run dedicated exporters.
- **Better scalability**: Native AWS service integration.
- **Automatic metric discovery**: No need to manually configure metric lists.

### Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive
[CloudWatch Metrics Stream guide](cloudwatch-metrics/cloudwatch-metrics-stream.md)
to set up the infrastructure.

### Step 2: Configure Amazon MQ metrics filtering

When configuring your CloudWatch Metrics Stream in **Step 3** of the setup
guide, make sure to:

1. **Select specific namespaces** instead of "All namespaces"
2. **Choose only AWS/AmazonMQ** from the namespace list
3. This ensures you only collect Amazon MQ metrics, reducing costs and data
   volume

### Step 3: Create OTel Collector config for RabbitMQ metrics (Optional)

If you're using RabbitMQ as your broker engine and need detailed broker-specific
metrics, create `amazon-mq-metrics-collection-config.yaml`. Set
`RABBITMQ_ENDPOINT` to the broker's HTTPS management URL, for example
`https://b-xxxxx.mq.<region>.amazonaws.com` (port 443):

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
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics/amazon_mq:
      receivers: [rabbitmq]
      exporters: [otlphttp/b14]
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
    region: ${env:AWS_REGION}
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
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    logs/amazonmq:
      receivers: [awscloudwatch/amazon_mq_logs]
      processors: [attributes/add_source_amazon_mq, batch]
      exporters: [otlphttp/b14]
```

The collector configs above export to Scout through the `otlphttp/b14`
exporter. Set `OTEL_EXPORTER_OTLP_ENDPOINT` and the OAuth2 credentials as shown
in the [Scout exporter guide](../../collector-setup/scout-exporter.md).

## Verify the setup

After deploying, generate traffic on the broker, then confirm telemetry is
flowing:

1. In Scout, check for the CloudWatch metrics, named
   `amazonaws.com/AWS/AmazonMQ/<MetricName>` (CPU, connection counts, message
   counts).
2. If you enabled the RabbitMQ receiver, check for the `rabbitmq.*` metrics.
3. For logs, confirm records appear with `source = amazonMQ`.

Allow 5-10 minutes for the first metrics to arrive through the stream.

## Key alerts to configure

Once telemetry is flowing, set up alerts on the signals that predict broker
trouble:

| Metric | Warning | Critical | Why |
| ------ | ------- | -------- | --- |
| `MessageReadyCount` (RabbitMQ) | rising trend | sustained growth | Consumers are falling behind producers |
| `MessageUnacknowledgedCount` (RabbitMQ) | > 0 and growing | sustained | Consumers receive but fail to acknowledge messages |
| `ConsumerCount` on an active queue | dropping | 0 | Nothing is draining the queue |
| `CpuUtilization` | > 70% | > 85% | CPU pressure slows message throughput |
| `RabbitMQMemUsed` / `HeapUsage` | > 70% | > 85% | Memory pressure triggers broker flow control |
| `StorePercentUsage` (ActiveMQ) | > 70% | > 85% | A full message store blocks producers |
| `RabbitMQDiskFree` (RabbitMQ) | near the limit | at the limit | The disk alarm blocks all publishing |

CloudWatch Metrics Stream adds 3-5 minutes of latency, so treat these as trend
and capacity alerts, not sub-minute failure detection.

## Troubleshooting

### AWS/AmazonMQ metrics not appearing in Scout

**Cause**: Metrics Stream isn't active or isn't filtered to the Amazon MQ
namespace.

**Fix**:

1. In CloudWatch > Metrics > Streams, verify the stream is active
2. Confirm the namespace filter includes `AWS/AmazonMQ`
3. Check that Firehose delivery is succeeding (look at the S3 error prefix)
4. Allow 5-10 minutes for initial metrics to flow

### RabbitMQ receiver shows no metrics

**Cause**: The Collector can't reach the broker's management endpoint.

**Fix**:

1. Confirm `RABBITMQ_ENDPOINT` is the HTTPS management URL
   (`https://b-xxxxx.mq.<region>.amazonaws.com`, port 443)
2. Verify the management-API username and password
3. Check the broker's security group allows the Collector's IP
4. Ensure the RabbitMQ management plugin is enabled on the broker

### Broker logs not reaching Scout

**Cause**: Wrong log group name or region.

**Fix**:

1. Set the real Amazon MQ log group name under `groups.named`
2. Confirm `AWS_REGION` matches the broker's region
3. Verify the Collector's IAM role can read CloudWatch Logs
4. Enable general or audit logging on the broker if the log group is empty

## FAQ

### How do I monitor AWS Amazon MQ with OpenTelemetry?

Use CloudWatch Metrics Stream for broker metrics (CPU, memory, connections,
message counts) and, for RabbitMQ, add the OTel RabbitMQ receiver for
node-level internals. Both feed into base14 Scout.

### What Amazon MQ metrics does CloudWatch collect?

AWS/AmazonMQ metrics including `CpuUtilization`, `HeapUsage` (ActiveMQ),
`RabbitMQMemUsed` and `RabbitMQDiskFree` (RabbitMQ), `ConsumerCount`,
`ProducerCount`, `MessageCount`, `MessageReadyCount`, and
`MessageUnacknowledgedCount`, plus connection and network metrics.

### Should I use CloudWatch Metrics Stream or Prometheus for Amazon MQ?

CloudWatch Metrics Stream is recommended: no per-broker exporter, native AWS
integration, and 3-5 minute end-to-end delivery. Add the RabbitMQ receiver
only when you need node-level internals.

### How do I collect Amazon MQ broker logs with OpenTelemetry?

Use the AWS CloudWatch Logs receiver in the Collector with your Amazon MQ log
group name. Enable general or audit logging on the broker first so the group
has data.

### How do I set up alerts for Amazon MQ?

Route metrics through CloudWatch Metrics Stream to Scout, then alert on rising
`MessageReadyCount`, `ConsumerCount` dropping to zero, `CpuUtilization` above
85%, memory or heap above 85%, and `StorePercentUsage` above 85%.

### Can I monitor both RabbitMQ and ActiveMQ with OpenTelemetry?

Yes. CloudWatch Metrics Stream covers both engines. RabbitMQ additionally
supports the OTel RabbitMQ receiver for node-level metrics; ActiveMQ internals
come from CloudWatch or JMX.

## Related Guides

- Set up AWS metrics streaming with
  [CloudWatch Metrics Stream Setup](./cloudwatch-metrics/cloudwatch-metrics-stream.md).
- [RabbitMQ Monitoring](../../component/rabbitmq.md) - Self-hosted RabbitMQ
  monitoring guide
- [OTel Collector Configuration](../../collector-setup/otel-collector-config.md)
  for advanced collector configuration
