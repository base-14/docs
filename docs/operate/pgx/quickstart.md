---
title: pgX Quick Start
sidebar_label: Quick Start
sidebar_position: 1
description:
  Get started with pgX, the advanced PostgreSQL monitoring Grafana app. Monitor
  query performance, replication, connections, and more.
keywords:
  [
    pgx,
    postgresql monitoring,
    postgres grafana,
    database monitoring,
    postgres performance,
  ]
---

pgX is a powerful PostgreSQL monitoring and optimization Grafana app built into
Scout. It provides deep visibility into every aspect of your PostgreSQL
clusters.

## What is pgX?

pgX gives you complete visibility into your PostgreSQL infrastructure:

| Capability                 | What You Get                                                            |
| -------------------------- | ----------------------------------------------------------------------- |
| **Health Monitoring**      | Real-time cluster health, connection status, and error rates            |
| **Query Analysis**         | Identify slow queries, analyze execution patterns, track response times |
| **Table & Index Health**   | Monitor bloat, cache hit ratios, and vacuum status                      |
| **Connection Management**  | Track pool utilization, idle connections, and connection patterns       |
| **Replication Monitoring** | Monitor lag, standby health, and WAL generation                         |
| **Lock Analysis**          | Detect deadlocks, blocking sessions, and wait events                    |

## Prerequisites

Before configuring pgX, you need to set up PostgreSQL metrics collection:

:::tip Instrumentation Required pgX requires metrics from your PostgreSQL
instances. Follow the
[PostgreSQL Advanced Monitoring](../../instrument/component/postgres-advanced.md)
guide to set up the pgdashex collector. :::

## Configuration

### Step 1: Access pgX Configuration

1. Go to **Administration** → **Plugins** → **pgX**
2. Click the **Configuration** tab

### Step 2: Your PostgreSQL Deployment Type

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="self-hosted" label="Self-Hosted">
```

For PostgreSQL running on your own infrastructure (VMs, bare metal, Kubernetes).

No additional configuration required beyond the default settings.

```mdx-code-block
</TabItem>
<TabItem value="rds" label="AWS RDS">
```

For Amazon RDS for PostgreSQL, configure these additional settings:

| Setting                  | Description               | Default                  |
| ------------------------ | ------------------------- | ------------------------ |
| **RDS Service Name**     | CloudWatch service name   | `aws-cloudwatch-stream`  |
| **RDS Metrics Prefix**   | CloudWatch metric prefix  | `amazonaws.com/AWS/RDS/` |
| **RDS Metrics Table**    | Table for RDS metrics     | `otel_metrics_summary`   |
| **RDS Attribute Format** | How dimensions are stored | `nested`                 |

```mdx-code-block
</TabItem>
<TabItem value="cloudsql" label="Google Cloud SQL">
```

For Google Cloud SQL for PostgreSQL.

Configure your Cloud SQL metrics integration in Scout to collect Cloud SQL
specific metrics alongside PostgreSQL metrics.

```mdx-code-block
</TabItem>
</Tabs>
```

### Step 3: Select Your Environment

Use the environment dropdown in pgX to filter metrics by environment. This
corresponds to the `environment` attribute set in your collector configuration.

### Step 4: Verify Your Setup

1. Click the pgX icon in the Grafana sidebar
2. Select your environment and cluster from the dropdowns
3. Verify that metrics are appearing

**What to Check:**

- **Health Status**: Should show "UP" if PostgreSQL is reachable
- **Connection Count**: Should reflect current connections
- **Database Size**: Should show your database sizes

## Available Sections

pgX provides nine purpose-built sections:

| Section              | Purpose                                      | Guide                                   |
| -------------------- | -------------------------------------------- | --------------------------------------- |
| **Overview**         | High-level cluster health and key metrics    | [Overview](./overview.md)               |
| **Performance**      | Query and transaction performance analysis   | [Performance](./performance.md)         |
| **Tables & Indexes** | Table health, bloat, and index effectiveness | [Tables & Indexes](./tables-indexes.md) |
| **Queries**          | Deep query-level analysis with filtering     | [Queries](./queries.md)                 |
| **Connections**      | Connection pool management and patterns      | [Connections](./connections.md)         |
| **Replication**      | Replica health, lag, and WAL monitoring      | [Replication](./replication.md)         |
| **Resources**        | Cloud resource metrics (RDS/Cloud SQL)       | [Resources](./resources.md)             |
| **Locks & Waits**    | Concurrency analysis and deadlock detection  | [Locks & Waits](./locks-waits.md)       |
| **Maintenance**      | Vacuum, analyze, and maintenance tracking    | [Maintenance](./maintenance.md)         |

## Related Guides

- [Overview](./overview.md) - Start monitoring your cluster
- [Performance](./performance.md) - Analyze query performance
- [Metrics Reference](./metrics.md) - Explore all available metrics
- [Configuration Reference](./configuration.md) - All configuration options
