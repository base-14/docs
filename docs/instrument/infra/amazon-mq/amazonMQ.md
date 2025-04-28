---
date: 2025-04-27
id: collecting-aws-amazon-mq-telemetry
title: Telemetry Collection from Amazon MQ via CloudWatch and Prometheus
description: Use Scout to monitor your AWS Amazon MQ with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your
Amazon MQ using cloudwatch. We'll implement the prometheus cloudwatch exporter
to collect telemetry data from cloudwatch.

## Prerequisites

Before we begin, ensure you have:

### 1. AWS Credentials and Permissions

Required IAM Permissions:

- `cloudwatch:ListMetrics`
- `cloudwatch:GetMetricStatistics`
- `cloudwatch:GetMetricData`
- `logs:DescribeLogGroups`
- `logs:FilterLogEvents`

## Collecting Amazon MQ Metrics

### Step 1. Configure the Prometheus exporter

Save the fallowing config for collecting AWS Amazon MQ
metrics in a file named `aws-amazon-mq-metrics.yaml`
and update the region key with relevant value.

```yaml
---
region: us-east-1
metrics:
  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: SystemCpuUtilization
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQFdUsed
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQMemLimit
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQIOReadAverageTime
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQDiskFreeLimit
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: MessageUnacknowledgedCount
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: ChannelCount
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: MessageReadyCount
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: AckRate
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: ConfirmRate
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: ConnectionCount
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: ExchangeCount
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: QueueCount 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: MessageCount 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: PublishRate 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: ConsumerCount 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQMemUsed 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQDiskFree 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/AmazonMQ
    aws_metric_name: RabbitMQIOWriteAverageTime 
    aws_dimensions: [Broker]
    aws_statistics: [Average, Maximum]
```

### 2. Run the below command to Start the Exporter

```bash
 docker run -p 9106:9106 \
  -v $(pwd)/aws-amazon-mq-metrics.yaml:/config/config.yml \
  -e AWS_ACCESS_KEY_ID=<your-aws-access-key-id> \
  -e AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key> \
  quay.io/prometheus/cloudwatch-exporter
```

### 3. Verify the CloudWatch metrics

Visit [http://localhost:9106/metrics](http://localhost:9106/metrics)
and confirm the `aws_amazonmq_*` metrics are avialable.

### 4. Create a OTEL Collector config file

create `amazon-mq-metrics-collection-config.yaml`

```yaml
receivers:
  # Optionally if you are using rabbit mq as your broker engine,
  # use the below reciever as well.
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
              regex: aws_amazonmq_.*
              target_label: service
              replacement: amazon-mq

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOIINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/amazon_mq:
      receivers: [rabbitmq, prometheus]
      exporters: [otlp]
```

> Make Sure the environment variables are set.

## Collecting Amazon MQ Logs

The log collection of Amazon MQ requires specifying the list of log group names.
From the AWS CloudWatch console, please find the log group(s) relevant to the integration.

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

After deploying these changes, generate some traffic to your Amazon MQ and
check in Scout to see your Amazon MQ's metrics and logs.

---

With this setup, your Amazon MQ broker becomes fully observable through Scout.
You’ll gain real-time visibility into performance metrics and logs without
any changes to your application code.
