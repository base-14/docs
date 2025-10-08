---
date: 2025-04-26
id: collecting-aws-rds-postgres-telemetry
title: RDS PostgreSQL
description: Use Scout to monitor your AWS RDS postgres instance with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your RDS
postgres instance using CloudWatch Metrics Stream. We recommend using CloudWatch
Metrics Stream over Prometheus exporters as it provides faster metric delivery
(2-3 minute latency) and is more efficient for AWS services.

## Collecting RDS Postgres Metrics

For collecting RDS metrics, we recommend using **CloudWatch Metrics Stream** instead of Prometheus exporters. CloudWatch Metrics Stream provides:

- **Faster delivery**: 2-3 minute latency vs 5+ minutes with polling
- **Lower cost**: No need to run dedicated exporters
- **Better scalability**: Native AWS service integration
- **Automatic metric discovery**: No need to manually configure metric lists

### Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive [CloudWatch Metrics Stream guide](cloudwatch-metrics-stream.md) to set up the infrastructure.

### Step 2: Configure RDS metrics filtering

When configuring your CloudWatch Metrics Stream in **Step 3** of the setup guide, make sure to:

1. **Select specific namespaces** instead of "All namespaces"
2. **Choose only AWS/RDS** from the namespace list
3. This ensures you only collect RDS metrics, reducing costs and data volume

### Step 3: Create OTEL Collector config for PostgreSQL metrics

For database-specific metrics (like connection counts, query performance), create `postgres-metrics-collection-config.yaml`:

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

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/postgresql:
      receivers: [postgresql]
      exporters: [otlp]
```

> **Note**: CloudWatch Metrics Stream will automatically deliver AWS/RDS metrics (CPU, memory, disk I/O, etc.), while the PostgreSQL receiver collects database-specific metrics.

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
