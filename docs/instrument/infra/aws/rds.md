---
date: 2025-04-26
id: collecting-aws-rds-postgres-telemetry
title: AWS RDS PostgreSQL Monitoring with OpenTelemetry - Metrics, Logs & Alerts
sidebar_label: AWS RDS
description:
  Monitor AWS RDS PostgreSQL with OpenTelemetry and CloudWatch Metrics
  Stream. Collect connections, replication lag, IOPS, and query
  performance data in base14 Scout.
keywords:
  - aws rds monitoring
  - rds postgresql monitoring
  - postgresql rds metrics
  - aws rds postgres monitoring
  - rds postgres observability
  - cloudwatch metrics stream
  - aws database monitoring
  - aws rds postgresql observability
  - rds postgres dashboard
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor AWS RDS PostgreSQL with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Use CloudWatch Metrics Stream for infrastructure metrics (CPU, memory, disk I/O, connections) and the OpenTelemetry PostgreSQL receiver for database-specific metrics like locks, deadlocks, and sequential scans. Both feed into a single observability platform like base14 Scout."}},{"@type":"Question","name":"What RDS metrics does CloudWatch Metrics Stream collect?","acceptedAnswer":{"@type":"Answer","text":"CloudWatch Metrics Stream delivers AWS/RDS metrics including CPUUtilization, FreeableMemory, ReadIOPS, WriteIOPS, ReadLatency, WriteLatency, DatabaseConnections, ReplicaLag, FreeStorageSpace, and DiskQueueDepth with 2-3 minute latency."}},{"@type":"Question","name":"Do I need both CloudWatch Metrics Stream and the PostgreSQL receiver?","acceptedAnswer":{"@type":"Answer","text":"Yes. CloudWatch provides infrastructure-level RDS metrics (CPU, memory, IOPS) while the PostgreSQL receiver collects database-specific metrics like locks, deadlocks, sequential scans, and tuple operations. Using both gives complete visibility."}},{"@type":"Question","name":"How do I collect RDS PostgreSQL logs with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Use the AWS CloudWatch Logs receiver in the OpenTelemetry Collector, specifying your RDS log group names. The collector polls CloudWatch Logs and forwards them to your observability backend."}},{"@type":"Question","name":"How do I monitor RDS PostgreSQL query performance?","acceptedAnswer":{"@type":"Answer","text":"Enable the PostgreSQL pg_stat_statements extension and use the OTel PostgreSQL receiver to collect per-query statistics including execution counts, total time, and rows returned."}},{"@type":"Question","name":"What is the difference between CloudWatch metrics and Enhanced Monitoring for RDS?","acceptedAnswer":{"@type":"Answer","text":"CloudWatch metrics are collected at 1-minute intervals and cover instance-level stats like CPU, memory, and IOPS. Enhanced Monitoring provides OS-level metrics at up to 1-second granularity, including per-process CPU, memory usage, and file system details. Enhanced Monitoring is useful for diagnosing issues that 1-minute CloudWatch intervals miss."}},{"@type":"Question","name":"How do I set up alerts for RDS PostgreSQL?","acceptedAnswer":{"@type":"Answer","text":"Route RDS metrics through CloudWatch Metrics Stream to base14 Scout, then configure alerts in Scout on key thresholds: CPU above 80%, connections above 80% of max, replication lag exceeding your SLA, storage below 20% free, and read/write latency spikes."}}]}
---

## Overview

This guide covers monitoring AWS RDS PostgreSQL instances using
OpenTelemetry and CloudWatch Metrics Stream. You'll collect
infrastructure metrics from CloudWatch, database-specific metrics from
the PostgreSQL receiver, and logs from CloudWatch Logs — all flowing
into base14 Scout for unified visibility.

## What You'll Monitor

RDS PostgreSQL monitoring combines two metric sources that together
provide complete visibility:

**CloudWatch Metrics Stream (infrastructure):**

| Metric | What it tells you |
| ------ | ----------------- |
| `CPUUtilization` | Instance CPU usage (%) |
| `FreeableMemory` | Available RAM (bytes) |
| `FreeStorageSpace` | Remaining disk space (bytes) |
| `ReadIOPS` / `WriteIOPS` | Disk read/write operations per second |
| `ReadLatency` / `WriteLatency` | Average time per disk I/O operation |
| `DatabaseConnections` | Active database connections |
| `ReplicaLag` | Replication delay for read replicas (seconds) |
| `DiskQueueDepth` | Number of I/O requests waiting |
| `NetworkReceiveThroughput` / `NetworkTransmitThroughput` | Network bytes in/out |
| `SwapUsage` | Swap space used (bytes) |
| `BurstBalance` | Remaining I/O burst credits (gp2/gp3) |

**OTel PostgreSQL receiver (database internals):**

| Metric | What it tells you |
| ------ | ----------------- |
| `postgresql.backends` | Active connections per database |
| `postgresql.commits` / `postgresql.rollbacks` | Transaction rates |
| `postgresql.database.locks` | Active locks by type |
| `postgresql.deadlocks` | Deadlock count |
| `postgresql.sequential_scans` / `postgresql.index.scans` | Scan type distribution |
| `postgresql.rows` | Rows affected by operations |
| `postgresql.table.size` / `postgresql.index.size` | Storage per table/index |
| `postgresql.table.vacuum.count` | Vacuum frequency |
| `postgresql.blks_hit` / `postgresql.blks_read` | Buffer cache hit ratio |
| `postgresql.replication.data_delay` | Replication byte lag |
| `postgresql.tup_inserted` / `postgresql.tup_updated` / `postgresql.tup_deleted` | Tuple operations |

## Prerequisites

| Requirement | Minimum | Recommended |
| ----------- | ------- | ----------- |
| RDS PostgreSQL | 11 | 14+ |
| OTel Collector Contrib | 0.90.0 | latest |
| base14 Scout | Any | - |
| AWS permissions | CloudWatch, Kinesis Firehose, S3 | - |

Before starting:

- RDS instance must be accessible from the host running the OTel
  Collector (same VPC or VPC peering)
- A monitoring user with `pg_monitor` role for the PostgreSQL receiver
- CloudWatch Metrics Stream infrastructure set up (see Step 1)

## Step 1: Set up CloudWatch Metrics Stream

Follow our comprehensive
[CloudWatch Metrics Stream guide](cloudwatch-metrics-stream.md) to set
up the streaming infrastructure (S3 bucket, Kinesis Firehose, Metrics
Stream).

When configuring the Metrics Stream, select the **AWS/RDS** namespace
instead of "All namespaces" to only collect RDS metrics and reduce
costs.

## Step 2: Create a monitoring user on RDS

Connect to your RDS PostgreSQL instance and create a dedicated
monitoring user:

```sql
CREATE USER otel_monitor WITH PASSWORD '<your_password>';
GRANT pg_monitor TO otel_monitor;
```

The `pg_monitor` role provides read-only access to all statistics
views needed for monitoring. No write permissions required.

For RDS instances, ensure the security group allows connections from
the Collector host on port 5432.

## Step 3: Configure the OTel Collector for PostgreSQL metrics

Create `rds-postgres-config.yaml` with both the PostgreSQL receiver
and the CloudWatch metrics pipeline:

```yaml showLineNumbers title="rds-postgres-config.yaml"
receivers:
  postgresql:
    endpoint: ${env:RDS_ENDPOINT}
    collection_interval: 10s
    username: ${env:RDS_MONITOR_USER}
    password: ${env:RDS_MONITOR_PASSWORD}
    databases: ["${env:RDS_DATABASE}"]
    tls:
      insecure_skip_verify: true

    metrics:
      postgresql.database.locks:
        enabled: true
      postgresql.deadlocks:
        enabled: true
      postgresql.sequential_scans:
        enabled: true
      postgresql.index.scans:
        enabled: true
      postgresql.backends:
        enabled: true
      postgresql.commits:
        enabled: true
      postgresql.rollbacks:
        enabled: true
      postgresql.db_size:
        enabled: true
      postgresql.table.count:
        enabled: true
      postgresql.table.size:
        enabled: true
      postgresql.index.size:
        enabled: true
      postgresql.table.vacuum.count:
        enabled: true
      postgresql.rows:
        enabled: true
      postgresql.blks_hit:
        enabled: true
      postgresql.blks_read:
        enabled: true
      postgresql.tup_inserted:
        enabled: true
      postgresql.tup_updated:
        enabled: true
      postgresql.tup_deleted:
        enabled: true
      postgresql.tup_fetched:
        enabled: true
      postgresql.replication.data_delay:
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
      receivers: [postgresql]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment variables

```bash showLineNumbers title=".env"
RDS_ENDPOINT=your-rds-instance.xxxxx.us-east-1.rds.amazonaws.com:5432
RDS_MONITOR_USER=otel_monitor
RDS_MONITOR_PASSWORD=your_password
RDS_DATABASE=your_database
ENVIRONMENT=production
SERVICE_NAME=rds-postgres
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Note**: CloudWatch Metrics Stream delivers the infrastructure
> metrics (CPU, memory, IOPS) automatically. The PostgreSQL receiver
> above collects the database-internal metrics. Together they give
> you the full picture.

## Step 4: Collect RDS PostgreSQL logs

RDS PostgreSQL publishes logs to CloudWatch Log Groups. Use the
CloudWatch Logs receiver to forward them:

```yaml showLineNumbers title="rds-postgres-logs-config.yaml"
receivers:
  awscloudwatchlogs/rds_postgres:
    region: ${env:AWS_REGION}
    logs:
      poll_interval: 1m
      groups:
        named:
          # Replace with your RDS log group name
          /aws/rds/instance/${env:RDS_INSTANCE_ID}/postgresql:

processors:
  attributes/add_source:
    actions:
      - key: source
        value: "rds_postgres"
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
    logs/rds:
      receivers: [awscloudwatchlogs/rds_postgres]
      processors: [attributes/add_source, batch]
      exporters: [otlphttp/b14]
```

### Enable recommended RDS log types

In the RDS console under **Configuration > Log exports**, enable:

- **PostgreSQL log** — query errors, connection events, autovacuum
- **Upgrade log** — major version upgrade details

For query-level logging, set these RDS parameter group values:

```text
log_statement = 'ddl'
log_min_duration_statement = 1000   # Log queries over 1 second
log_connections = on
log_disconnections = on
```

## Verify the setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Test PostgreSQL connectivity from the Collector host
psql -h ${RDS_ENDPOINT%:*} -p 5432 -U otel_monitor \
  -d ${RDS_DATABASE} -c "SELECT version();"
```

```sql showLineNumbers
-- Verify monitoring permissions
SELECT * FROM pg_stat_database WHERE datname = 'your_database';
SELECT * FROM pg_stat_user_tables LIMIT 5;
```

Check Scout for both CloudWatch metrics (prefixed `aws.rds.*`) and
PostgreSQL metrics (prefixed `postgresql.*`).

## Key alerts to configure

Once metrics are flowing, set up alerts on these thresholds:

| Metric | Warning | Critical | Why |
| ------ | ------- | -------- | --- |
| `CPUUtilization` | > 70% | > 85% | Sustained high CPU degrades query performance |
| `DatabaseConnections` | > 80% of max | > 90% of max | Connection exhaustion causes application errors |
| `FreeStorageSpace` | < 20% | < 10% | Running out of storage crashes the instance |
| `ReplicaLag` | > 10s | > 60s | High lag means read replicas serve stale data |
| `ReadLatency` / `WriteLatency` | > 10ms | > 20ms | I/O latency spikes indicate storage bottlenecks |
| `DiskQueueDepth` | > 10 | > 20 | Deep queue means I/O is saturated |
| `postgresql.deadlocks` | > 0 | > 5/min | Deadlocks indicate application-level locking issues |
| Buffer hit ratio | < 95% | < 90% | Low hit ratio means too many disk reads |

Buffer hit ratio: calculate as
`blks_hit / (blks_hit + blks_read) * 100`.

## Troubleshooting

### PostgreSQL receiver shows no metrics

**Cause**: Collector can't reach the RDS instance.

**Fix**:

1. Verify the RDS instance security group allows inbound on port 5432
   from the Collector's IP or security group
2. Confirm the RDS instance is not in a private subnet without a route
   to the Collector
3. Test connectivity: `psql -h <rds-endpoint> -U otel_monitor -d <db>`
4. Check the monitoring user has `pg_monitor` role:
   `SELECT rolname FROM pg_roles WHERE pg_has_role('otel_monitor', oid, 'member');`

### CloudWatch metrics not appearing

**Cause**: Metrics Stream not configured for the AWS/RDS namespace.

**Fix**:

1. In CloudWatch > Metrics > Streams, verify the stream is active
2. Check that the namespace filter includes `AWS/RDS`
3. Verify Kinesis Firehose delivery is succeeding (check the S3
   error bucket)
4. Allow 5-10 minutes for initial metrics to flow

### Replication lag metrics showing zero

**Cause**: No read replicas configured, or the instance is a replica
(not the primary).

**Fix**:

1. `ReplicaLag` is only populated on read replica instances
2. `postgresql.replication.data_delay` requires at least one replica
   connected to the primary
3. On the primary, check: `SELECT * FROM pg_stat_replication;`

### High connection count but low CPU

**Cause**: Idle connections consuming connection slots.

**Fix**:

1. Check for idle connections:
   `SELECT count(*) FROM pg_stat_activity WHERE state = 'idle';`
2. Consider connection pooling (PgBouncer or RDS Proxy)
3. Set `idle_in_transaction_session_timeout` in the parameter group

## FAQ

**How do I monitor RDS PostgreSQL query performance?**

Enable `pg_stat_statements` for per-query statistics and use the
[PostgreSQL Advanced guide](../../component/postgres-advanced.md)
for detailed query-level monitoring.

**What's the difference between CloudWatch and Enhanced Monitoring?**

CloudWatch metrics are collected at 1-minute intervals and cover
instance-level stats. Enhanced Monitoring provides OS-level metrics at
up to 1-second granularity (per-process CPU, memory, file system).
Enable Enhanced Monitoring when you need to diagnose issues that
1-minute intervals miss.

**Can I monitor multiple RDS instances with one Collector?**

Yes. Add multiple PostgreSQL receiver blocks with distinct names:

```yaml
receivers:
  postgresql/primary:
    endpoint: primary.xxxxx.rds.amazonaws.com:5432
  postgresql/replica:
    endpoint: replica.xxxxx.rds.amazonaws.com:5432
```

Then include both in the pipeline:
`receivers: [postgresql/primary, postgresql/replica]`.

**How do I filter which CloudWatch metrics are streamed?**

When configuring the Metrics Stream, select specific namespaces and
choose only `AWS/RDS` instead of all namespaces. This reduces costs
and data volume.

## Related Guides

- [CloudWatch Metrics Stream Setup](./cloudwatch-metrics-stream.md) —
  Configure AWS metrics streaming
- [PostgreSQL Basic Monitoring](../../component/postgres.md) — Direct
  PostgreSQL monitoring with the OTel receiver
- [PostgreSQL Advanced Monitoring](../../component/postgres-advanced.md)
  — Query statistics, per-table I/O, replication details
- [pgX Deep PostgreSQL Analysis](https://base14.io/scout/pgx) —
  Correlate query performance with application traces
- [ELB Monitoring](./elb.md) — Monitor AWS Application Load Balancers
- [ElastiCache Monitoring](./elasticache.md) — Monitor Redis and
  Memcached on AWS
- [AWS ECS/Fargate Setup](../../collector-setup/ecs-setup.md) — Deploy
  the Collector on AWS ECS
