---
date: 2026-07-07
id: aws-cloudwatch-overview
title: AWS CloudWatch to base14 Scout - Push and Pull Approaches Compared
sidebar_label: Overview
sidebar_position: 1
description:
  Four ways to get AWS CloudWatch metrics into base14 Scout - Kinesis
  Firehose to the OTel Collector, Firehose to S3 to Lambda, the Prometheus
  CloudWatch exporter, and the CloudWatch datasource. Push vs pull,
  latency, cost, and when to use each.
keywords:
  [
    aws cloudwatch opentelemetry,
    cloudwatch metrics to scout,
    cloudwatch metrics stream,
    kinesis firehose receiver,
    awsfirehosereceiver,
    prometheus cloudwatch exporter,
    cloudwatch datasource,
    aws observability architecture,
    cloudwatch push vs pull,
  ]
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What are the ways to get AWS CloudWatch metrics into base14 Scout?","acceptedAnswer":{"@type":"Answer","text":"Four. Two push: CloudWatch Metric Streams through Amazon Data Firehose into the OpenTelemetry Collector's awsfirehosereceiver, or the same stream through Firehose to S3 with a Lambda that forwards OTLP. Two pull: the Prometheus CloudWatch exporter scraped by the Collector, or the CloudWatch datasource that queries CloudWatch directly at dashboard render time without ingesting anything."}},{"@type":"Question","name":"Which approach has the lowest latency?","acceptedAnswer":{"@type":"Answer","text":"The push approaches. CloudWatch Metric Streams deliver in 2-3 minutes, so the Firehose-to-Collector path is the lowest-latency option that stores data in Scout. Pulling with the Prometheus exporter adds your scrape interval on top of CloudWatch's own metric-availability delay, so it is typically slower."}},{"@type":"Question","name":"Which approach avoids ingestion and storage cost in Scout?","acceptedAnswer":{"@type":"Answer","text":"The CloudWatch datasource. It queries CloudWatch directly when a dashboard loads, so nothing is ingested or stored in Scout. You pay CloudWatch query API costs instead, and the data is bound by CloudWatch retention rather than kept long-term in Scout."}},{"@type":"Question","name":"Do I need a public OpenTelemetry Collector to receive CloudWatch metrics?","acceptedAnswer":{"@type":"Answer","text":"Only for the Firehose-to-Collector push approach. Amazon Data Firehose HTTP endpoint delivery requires a publicly reachable HTTPS endpoint with a valid certificate. The Firehose-to-S3-to-Lambda path and the Prometheus exporter path do not need an inbound endpoint because the collector or Lambda reaches out to AWS."}},{"@type":"Question","name":"Can I query CloudWatch metrics in Scout without ingesting them?","acceptedAnswer":{"@type":"Answer","text":"Yes. Enable the CloudWatch datasource in Scout and query CloudWatch directly from dashboards. base14 provisions the datasource for your tenant. This is query federation, not ingestion, so the metrics are not stored in Scout and cannot be joined with your OTLP telemetry."}},{"@type":"Question","name":"Push or pull for CloudWatch metrics?","acceptedAnswer":{"@type":"Answer","text":"Push (CloudWatch Metric Streams through Firehose) when you want the lowest latency and durable storage in Scout. Pull (Prometheus exporter) when a Kubernetes-native scrape model and fine-grained metric selection matter more than latency, or when you cannot expose an inbound endpoint. Use the CloudWatch datasource when you only need to visualize CloudWatch and do not need to retain the data in Scout."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This is the architectural landing page for getting **AWS CloudWatch**
metrics into **base14 Scout**. AWS resources publish their operational
metrics to CloudWatch (`AWS/EC2`, `AWS/RDS`, `AWS/ApplicationELB`, and so
on). There are four supported ways to get that data to Scout, split across
**push** and **pull** mechanisms. This page frames the trade-offs and points
you at the right per-approach guide.

The reader profile is **DevOps and SRE engineers** who run AWS workloads and
want to choose an ingestion path before configuring it. For execution, jump
to the guides linked in the [approach guides](#approach-guides) table below.

:::tip TL;DR

There is no single best path - pick by your latency, cost, and
infrastructure constraints.

- **Lowest latency, stored in Scout, no custom code:**
  [Firehose to the OTel Collector](./cloudwatch-firehose-receiver.md) with
  the `awsfirehosereceiver`. Needs a public HTTPS collector.
- **Push without an inbound endpoint:**
  [Firehose to S3 to Lambda](./cloudwatch-metrics-stream.md). S3 buffers the
  stream and a Lambda forwards OTLP.
- **Pull, Kubernetes-native, fine-grained metric selection:** the
  [Prometheus CloudWatch exporter](./cloudwatch-prometheus-exporter.md)
  scraped by the Collector.
- **Visualize without ingesting or retaining in Scout:** the
  [CloudWatch datasource](./cloudwatch-datasource.md).

:::

## Push vs pull

CloudWatch metrics reach Scout by one of two mechanisms:

- **Push** - AWS sends metrics out as they are published. CloudWatch Metric
  Streams deliver continuously through Amazon Data Firehose (formerly Kinesis
  Data Firehose) with 2-3 minute latency. This is the freshest data and it
  lands in the Scout data lake, but it needs streaming infrastructure on the
  AWS side.
- **Pull** - something polls the CloudWatch API on an interval and either
  ships the result to Scout or renders it directly. Pull is simpler to reason
  about and needs no inbound endpoint, but it adds the poll interval on top of
  CloudWatch's own metric-availability delay and it bills against the
  CloudWatch query APIs.

The two push approaches differ only in what carries the stream to the
Collector. The two pull approaches differ in whether the data is stored in
Scout at all.

## Architecture at a glance

**Approach 1 - Firehose to the Collector (push):**

```text
CloudWatch ─▶ Metric Stream ─▶ Amazon Data Firehose ─▶ OTel Collector ─▶ Scout
              (JSON format)     (HTTP endpoint)         awsfirehosereceiver   (OTLP)
```

**Approach 2 - Firehose to S3 to Lambda (push):**

```text
CloudWatch ─▶ Metric Stream ─▶ Firehose ─▶ S3 ─▶ Lambda ─▶ Scout
              (JSON format)                       (OTLP forwarder)  (OTLP)
```

**Approach 3 - Prometheus CloudWatch exporter (pull):**

```text
                       poll GetMetricData
OTel Collector ◀─ scrape /metrics ─ CloudWatch exporter ──────────────▶ CloudWatch
   │                                                                       API
   └─ OTLP ─▶ Scout
```

**Approach 4 - CloudWatch datasource (pull, no ingestion):**

```text
Scout ─ query at render time ─▶ CloudWatch API
  │
  └─ renders panels directly; nothing stored in Scout
```

## Choosing an approach

| Approach | Mechanism | Data path | Latency | Stored in Scout? | Main cost driver | Best for |
| --- | --- | --- | --- | --- | --- | --- |
| **1. Firehose to Collector** | Push | Metric Stream → Firehose → `awsfirehosereceiver` → OTLP | Stream delivery (~2-3 min) | Yes | Firehose ingestion + Scout ingest | Lowest-latency push, no custom code, when you can run a public HTTPS collector |
| **2. Firehose to S3 to Lambda** | Push | Metric Stream → Firehose → S3 → Lambda → OTLP | Stream + S3/Lambda hop (~3-5 min) | Yes | Firehose + S3 + Lambda + Scout ingest | Push without an inbound endpoint; already documented and deployed |
| **3. Prometheus exporter** | Pull | Exporter polls CloudWatch → Collector scrapes → OTLP | Scrape interval + CloudWatch delay | Yes | CloudWatch `GetMetricData` API + Scout ingest | Kubernetes-native scrape model, fine-grained metric selection, no inbound endpoint |
| **4. CloudWatch datasource** | Pull | Scout queries CloudWatch at render time | Live at query time | No | CloudWatch `GetMetricData` API | Visualizing CloudWatch without ingesting or retaining in Scout |

## Decision guide

**Choose Firehose to the Collector when:**

- You want the freshest CloudWatch data stored in Scout and can expose a
  publicly reachable HTTPS collector endpoint.
- You prefer a native Collector receiver over maintaining Lambda code.

**Choose Firehose to S3 to Lambda when:**

- You cannot expose an inbound collector endpoint to Firehose.
- You want S3 to buffer and retain the raw stream, or you already run this
  pipeline and do not want to change it.

**Choose the Prometheus CloudWatch exporter when:**

- You already run a Prometheus-style scrape model, especially in Kubernetes.
- You want precise control over which namespaces, metrics, and dimensions are
  collected, and latency is not your first concern.
- You cannot or do not want to expose an inbound endpoint - the collector
  pulls, so nothing inbound is required.

**Choose the CloudWatch datasource when:**

- You only need to visualize CloudWatch metrics and do not need them stored or
  retained in Scout.
- You want the fastest possible setup and are comfortable that the data cannot
  be correlated with your OTLP telemetry.

## Approach guides

Each guide is the execution playbook for one approach, with the exact AWS
setup, the Collector or datasource configuration, and verification steps.

| Approach | Mechanism | Guide |
| --- | --- | --- |
| Firehose to the OTel Collector | Push | [Firehose receiver guide](./cloudwatch-firehose-receiver.md) |
| Firehose to S3 to Lambda | Push | [Metrics stream guide](./cloudwatch-metrics-stream.md) |
| Prometheus CloudWatch exporter | Pull | [Prometheus exporter guide](./cloudwatch-prometheus-exporter.md) |
| CloudWatch datasource | Pull | [CloudWatch datasource guide](./cloudwatch-datasource.md) |

The per-service AWS guides ([RDS](../rds.md), [ELB](../elb.md),
[ElastiCache](../elasticache.md), [Amazon MQ](../amazonMQ.md)) all build on the
push mechanism and delegate the streaming setup to these approach guides.

## Frequently Asked Questions

### What are the ways to get AWS CloudWatch metrics into base14 Scout?

Four. Two push: CloudWatch Metric Streams through Amazon Data Firehose into
the OpenTelemetry Collector's `awsfirehosereceiver`, or the same stream
through Firehose to S3 with a Lambda that forwards OTLP. Two pull: the
Prometheus CloudWatch exporter scraped by the Collector, or the CloudWatch
datasource that queries CloudWatch directly at dashboard render time without
ingesting anything.

### Which approach has the lowest latency?

The push approaches. CloudWatch Metric Streams deliver in 2-3 minutes, so the
Firehose-to-Collector path is the lowest-latency option that stores data in
Scout. Pulling with the Prometheus exporter adds your scrape interval on top of
CloudWatch's own metric-availability delay, so it is typically slower.

### Which approach avoids ingestion and storage cost in Scout?

The CloudWatch datasource. It queries CloudWatch directly when a
dashboard loads, so nothing is ingested or stored in Scout. You pay CloudWatch
query API costs instead, and the data is bound by CloudWatch retention rather
than kept long-term in Scout.

### Do I need a public OpenTelemetry Collector to receive CloudWatch metrics?

Only for the Firehose-to-Collector push approach. Amazon Data Firehose HTTP
endpoint delivery requires a publicly reachable HTTPS endpoint with a valid
certificate. The Firehose-to-S3-to-Lambda path and the Prometheus exporter
path do not need an inbound endpoint because the collector or Lambda reaches
out to AWS.

### Can I query CloudWatch metrics in Scout without ingesting them?

Yes. Enable the CloudWatch datasource in Scout and query CloudWatch
directly from dashboards. base14 provisions the datasource for your tenant.
This is query federation, not ingestion, so the metrics are not stored in
Scout and cannot be joined with your OTLP telemetry.

### Push or pull for CloudWatch metrics?

Push (CloudWatch Metric Streams through Firehose) when you want the lowest
latency and durable storage in Scout. Pull (Prometheus exporter) when a
Kubernetes-native scrape model and fine-grained metric selection matter more
than latency, or when you cannot expose an inbound endpoint. Use the
CloudWatch datasource when you only need to visualize CloudWatch and do not
need to retain the data in Scout.

## Related Guides

- [Scout Exporter Configuration](../../../collector-setup/scout-exporter.md) -
  OAuth2 authentication and the OTLP endpoint every Collector-based approach
  reuses.
- [AWS RDS Monitoring](../rds.md) - stream RDS metrics and scrape database
  internals.
- [AWS ELB Monitoring](../elb.md) - stream Application Load Balancer metrics.
- [AWS ElastiCache Monitoring](../elasticache.md) - monitor Redis and
  Memcached.
- [AWS Amazon MQ Monitoring](../amazonMQ.md) - monitor RabbitMQ and ActiveMQ.
