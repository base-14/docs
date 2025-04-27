---
date: 2025-04-26
id: collecting-aws-rds-postgres-telemetry
title: Telemetry Collection from RDS Postgres via CloudWatch and Prometheus
description: Use Scout to monitor your AWS RDS postgres instance with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your RDS
postgres instance using cloudwatch. We'll implement the prometheus cloudwatch exporter
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

## Collecting RDS Postgres Metrics

### Step 1. Configure the Prometheus exporter

Save the following config for collecting AWS RDS
metrics in a file named `aws-rds-postgres-metrics.yaml`
and update the region key with relevant value.

```yaml
---
region: us-east-1
metrics:
  - aws_namespace: AWS/RDS
    aws_metric_name: BinLogDiskUsage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: BurstBalance
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: CheckpointLag
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ConnectionAttempts
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: CPUUtilization
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: DatabaseConnections
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: DiskQueueDepth
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: DiskQueueDepthLogVolume
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: EBSByteBalance
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: EBSIOBalance
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: FreeableMemory
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: FreeLocalStorage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: FreeStorageSpace
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: FreeStorageSpaceLogVolume
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: MaximumUsedTransactionIDs
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: NetworkReceiveThroughput
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: NetworkTransmitThroughput
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: OldestReplicationSlotLag
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadIOPS
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadIOPSLocalStorage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadIOPSLogVolume
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadLatency
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadLatencyLocalStorage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadLatencyLogVolume
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadThroughput
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReadThroughputLogVolume
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReplicaLag
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReplicationChannelLag
    aws_dimensions: [DBInstanceIdentifier]

  - aws_namespace: AWS/RDS
    aws_metric_name: ReplicationSlotDiskUsage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: TransactionLogsDiskUsage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: TransactionLogsGeneration
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]

  - aws_namespace: AWS/RDS
    aws_metric_name: WriteIOPS
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: WriteLatency
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: WriteThroughput
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: SwapUsage
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: DBLoad
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: DBLoadCPU
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/RDS
    aws_metric_name: DBLoadNonCPU
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average, Maximum]
```

### 2. Run the below command to Start the Exporter

```bash
 docker run -p 9106:9106 \
  -v $(pwd)/aws-rds-postgres-metrics.yaml:/config/config.yml \
  -e AWS_ACCESS_KEY_ID=<your-aws-access-key-id> \
  -e AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key> \
  quay.io/prometheus/cloudwatch-exporter
```

### 3. Verify the CloudWatch metrics

Visit [http://localhost:9106/metrics](http://localhost:9106/metrics)
and confirm the `aws_rds_*` metrics are avialable.

### 4. Create a OTEL Collector config file

create `postgres-metrics-collection-config.yaml`

```yaml
receivers:
  postgresql:
    endpoint: ${env:POSTGRESQL_ENDPOINT}
    collection_interval: 10s
    username: ${env:POSTGRESQL_USERNAME}
    password: ${env:POSTGRESQL_PASSWORD}
    databases: ["pgtestdb"]
    tls:
      insecure_skip_verify: true
    metrics:
      postgresql.database.locks:
        enabled: true
      postgresql.deadlocks:
        enabled: true
      postgresql.sequential_scans:
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
              regex: aws_applicationelb_.*
              target_label: service
              replacement: alb

            - source_labels: [__name__]
              regex: aws_rds_.*
              target_label: service
              replacement: rds

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOIINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/postgresql:
      receivers: [postgresql, prometheus]
      exporters: [otlp]
```

> Make Sure the environment variables are set.

## Collecting RDS Logs

The log collection of RDS instance requires specifying the list of log group names.
From the AWS CloudWatch console, please find the log group(s) relevant to the integration.

### Create the Collector config file

```yaml
receivers:
  awscloudwatch/rds_postgres_logs:
    region: us-east-1
    logs:
      poll_interval: 1m
      groups:
        named:
          # replace with your RDS log group name
          /aws/rds/:

processors:
  attributes/add_source_postgres:
    actions:
      - key: source
        value: "rds_postgres"
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
    logs/postgres:
      receivers: [awscloudwatch/rds_postgres_logs]
      processors: [attributes/add_source_postgres, batch]
      exporters: [otlp]
```

After deploying these changes, generate some traffic to your database and
check the Postgres section in Scout to see your databases's metrics and logs.

---

With this setup, your RDS instance becomes fully observable through Scout.
You’ll gain real-time visibility into performance metrics and logs without
any changes to your application code.
