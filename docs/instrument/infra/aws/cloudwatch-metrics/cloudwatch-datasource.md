---
date: 2026-07-07
id: querying-aws-cloudwatch-metrics-datasource
title: Query AWS CloudWatch in base14 Scout with the CloudWatch Datasource
sidebar_label: CloudWatch Datasource
sidebar_position: 5
description:
  Query AWS CloudWatch metrics directly from base14 Scout using the CloudWatch
  datasource. No ingestion, no storage - dashboards render CloudWatch data
  live. Setup, IAM permissions, and trade-offs.
keywords:
  [
    scout cloudwatch datasource,
    cloudwatch datasource,
    query cloudwatch metrics,
    cloudwatch without ingestion,
    cloudwatch query federation,
    aws cloudwatch scout,
    base14 scout aws,
  ]
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is the CloudWatch datasource in base14 Scout?","acceptedAnswer":{"@type":"Answer","text":"base14 Scout can query the AWS CloudWatch API directly through a CloudWatch datasource, so you can chart AWS metrics without ingesting or storing them in Scout. base14 enables the datasource for your tenant."}},{"@type":"Question","name":"Is CloudWatch data stored in Scout when I use the datasource?","acceptedAnswer":{"@type":"Answer","text":"No. This is query federation, not ingestion. Nothing is written to the Scout data lake. Each dashboard load queries CloudWatch live, so the data is bound by CloudWatch retention and cannot be joined with your OTLP telemetry in Scout."}},{"@type":"Question","name":"How do I enable the CloudWatch datasource in Scout?","acceptedAnswer":{"@type":"Answer","text":"Scout provisions datasources centrally, so ask base14 to enable the CloudWatch datasource for your tenant. base14 either grants you permission to add it under Connections, or configures it on your behalf using AWS credentials you supply."}},{"@type":"Question","name":"When should I use the CloudWatch datasource instead of ingesting metrics?","acceptedAnswer":{"@type":"Answer","text":"Use it when you only need to visualize CloudWatch and do not need the data stored, retained, or correlated with OTLP telemetry in Scout. It is the fastest path to standing up CloudWatch dashboards. For durable storage and correlation, ingest with a push or pull approach instead."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

base14 Scout can query AWS CloudWatch directly through a **CloudWatch
datasource**, so you can chart AWS metrics **without ingesting or storing them
in Scout**.

This is a **pull** approach, but unlike the other approaches it stores nothing.
It is query federation: each dashboard render calls CloudWatch live. That makes
it the fastest path to CloudWatch dashboards, at the cost of no retention in
Scout and no correlation with your OTLP telemetry. For a comparison of all
approaches, see the [AWS CloudWatch overview](./overview.md).

:::info Provisioned by base14

Scout provisions datasources centrally - users do not add arbitrary
datasources. Ask base14 to enable the CloudWatch datasource for your tenant
before following the configuration steps below.

:::

## How it works

```text
Scout ─ query at render time ─▶ CloudWatch API
  │
  └─ renders panels directly; nothing stored in Scout
```

## Is this the right approach?

| Aspect | CloudWatch datasource |
| --- | --- |
| Ingestion | None - queried live at render time |
| Stored in Scout | No |
| Correlate with OTLP telemetry | No - separate from the Scout data lake |
| Retention | Bounded by CloudWatch (up to 15 months) |
| Latency | Query time, bounded by CloudWatch availability |
| Cost driver | CloudWatch `GetMetricData` per dashboard query |
| Setup effort | Lowest of the four approaches |

Use it to visualize CloudWatch quickly. If you need durable storage, long
retention, or correlation with your OTLP metrics, logs, and traces, ingest the
data with a [push](./cloudwatch-firehose-receiver.md) or
[pull](./cloudwatch-prometheus-exporter.md) approach instead.

## Prerequisites

- A base14 Scout tenant with the CloudWatch datasource enabled (see Step 1).
- AWS credentials with CloudWatch read access (see Step 2).
- The AWS region where your metrics live.

## Step 1: Ask base14 to enable the CloudWatch datasource

Because Scout manages datasources centrally, contact base14 to enable the
CloudWatch datasource for your tenant. base14 will either grant your users
permission to add it under **Connections > Data sources**, or configure it on
your behalf using AWS credentials you provide.

## Step 2: Grant CloudWatch read permissions

The datasource needs read-only access to the CloudWatch metrics APIs. Attach a
policy like this to the IAM identity the datasource authenticates as:

```json showLineNumbers title="cloudwatch-datasource-policy.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadingMetricsFromCloudWatch",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:DescribeAlarmsForMetric",
        "cloudwatch:DescribeAlarmHistory",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListMetrics",
        "cloudwatch:GetMetricData",
        "cloudwatch:GetInsightRuleReport"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowReadingResourcesForTags",
      "Effect": "Allow",
      "Action": ["ec2:DescribeRegions", "tag:GetResources"],
      "Resource": "*"
    }
  ]
}
```

For authentication, you have two practical options:

- **Access and secret key** - create an IAM user with the policy above and use
  its keys.
- **Assume role** - let the datasource assume a role in your account. The role
  must trust base14's Scout account as the calling principal; coordinate the
  role ARN and trust policy with base14.

## Step 3: Configure the datasource in Scout

Once base14 has enabled it, in Scout go to **Connections > Data sources > Add
data source > CloudWatch**, then set:

- **Authentication Provider** - `Access & secret key` (paste the IAM user
  keys) or `Assume Role ARN` (enter the role ARN from Step 2).
- **Default Region** - the region your metrics live in, for example
  `us-east-1`.
- **Namespaces of Custom Metrics** - optional, only if you publish custom
  CloudWatch namespaces.

Click **Save & test**. A green result confirms Scout can reach CloudWatch with
the credentials.

## Step 4: Build panels against the CloudWatch datasource

When you create a panel, select the **CloudWatch** datasource instead of the
Scout data lake. Then choose:

- **Namespace** - for example `AWS/EC2`, `AWS/RDS`, `AWS/ApplicationELB`.
- **Metric name** - for example `CPUUtilization`, `RequestCount`.
- **Statistic** - for example `Average`, `Sum`, `p99`.
- **Dimensions** - for example `InstanceId`, `DBInstanceIdentifier`.

The panel now renders CloudWatch data live. Repeat for each panel; every
panel that uses this datasource queries CloudWatch when the dashboard loads.

## Verify the setup

1. On the datasource page, **Save & test** returns a green success message.
2. A new panel using the CloudWatch datasource renders data for a namespace
   you know is active (for example `AWS/EC2` `CPUUtilization`).
3. Changing the dashboard time range re-queries CloudWatch and updates the
   panel.

## Troubleshooting

### The CloudWatch datasource is not available in Scout

**Cause**: the datasource is not enabled for your tenant.

**Fix**: contact base14 to enable it (Step 1). Users cannot add arbitrary
datasources to a Scout tenant.

### Save & test fails

**Cause**: credentials, permissions, or region are wrong.

**Fix**:

1. Confirm the IAM policy from Step 2 is attached.
2. Verify the access key or assume-role ARN is correct and, for assume-role,
   that the trust policy allows base14's account.
3. Check the default region matches where the metrics live.

### A panel shows no data

**Cause**: the namespace, metric, dimension, or region does not match.

**Fix**: confirm the namespace and metric exist in that region, and that the
dimension names and values are exact (they are case-sensitive).

### Dashboards are slow or CloudWatch cost is rising

**Cause**: frequent queries against many metrics.

**Fix**: widen the dashboard auto-refresh interval, reduce the number of
high-cardinality panels, and remember each query bills `GetMetricData`. For
heavy or always-on dashboards, ingesting the metrics with a
[push](./cloudwatch-firehose-receiver.md) or
[pull](./cloudwatch-prometheus-exporter.md) approach is usually cheaper.

## FAQ

**What is the CloudWatch datasource in base14 Scout?**

base14 Scout can query the AWS CloudWatch API directly through a CloudWatch
datasource, so you can chart AWS metrics without ingesting or storing them in
Scout. base14 enables the datasource for your tenant.

**Is CloudWatch data stored in Scout when I use the datasource?**

No. This is query federation, not ingestion. Nothing is written to the Scout
data lake. Each dashboard load queries CloudWatch live, so the data is bound by
CloudWatch retention and cannot be joined with your OTLP telemetry in Scout.

**How do I enable the CloudWatch datasource in Scout?**

Scout provisions datasources centrally, so ask base14 to enable the CloudWatch
datasource for your tenant. base14 either grants you permission to add it under
Connections, or configures it on your behalf using AWS credentials you supply.

**When should I use the CloudWatch datasource instead of ingesting metrics?**

Use it when you only need to visualize CloudWatch and do not need the data
stored, retained, or correlated with OTLP telemetry in Scout. It is the
fastest path to standing up CloudWatch dashboards. For durable storage and
correlation, ingest with a push or pull approach instead.

## Related Guides

- [AWS CloudWatch Overview](./overview.md) - compare all four approaches.
- [Firehose to the OTel Collector](./cloudwatch-firehose-receiver.md) - push
  ingestion with the lowest latency.
- [Prometheus CloudWatch exporter](./cloudwatch-prometheus-exporter.md) - pull
  ingestion with fine-grained metric selection.
- [CloudWatch Metrics Stream (S3 + Lambda)](./cloudwatch-metrics-stream.md) -
  push ingestion without an inbound endpoint.
- [Create Your First Dashboard](../../../../guides/create-your-first-dashboard.md)
  - build panels in Scout.
