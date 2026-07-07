---
id: aws-monitoring-overview
title: AWS Monitoring with base14 Scout - Metrics, Logs, and Traces
sidebar_label: Overview
description:
  Send AWS telemetry to base14 Scout with OpenTelemetry. CloudWatch metrics
  ingestion, per-service guides for RDS, ALB, ElastiCache, and Amazon MQ,
  Lambda instrumentation, and VPC flow logs.
keywords:
  [
    aws monitoring,
    aws opentelemetry,
    aws observability,
    cloudwatch metrics,
    base14 scout aws,
  ]
---

## Overview

base14 Scout ingests AWS telemetry through the OpenTelemetry Collector -
metrics from CloudWatch, logs from CloudWatch Logs and S3, and traces from
instrumented applications. Use the guides below to wire up each AWS service.

## In this section

| Guide | What it covers |
| ----- | -------------- |
| [CloudWatch Metrics](./cloudwatch-metrics/overview.md) | Four ways to get CloudWatch metrics into Scout - push and pull compared. |
| [AWS RDS](./rds.md) | PostgreSQL metrics, logs, and alerts. |
| [AWS ALB](./elb.md) | Load balancer request rates, latencies, and target health. |
| [AWS ElastiCache](./elasticache.md) | Redis and Memcached cache metrics. |
| [AWS Amazon MQ](./amazonMQ.md) | RabbitMQ and ActiveMQ broker metrics and logs. |
| [AWS Lambda](./lambda.md) | Auto-instrument functions for traces, metrics, and logs. |
| [AWS VPC Flow Logs](./aws-vpc.md) | Stream VPC flow logs to Scout via S3 and Lambda. |

## Getting started with CloudWatch metrics

Most AWS services publish their metrics to CloudWatch, so that's where most
setups begin. The [CloudWatch Metrics](./cloudwatch-metrics/overview.md)
section compares four approaches - two push paths (Amazon Data Firehose to the
Collector, or Firehose to S3 to Lambda), the Prometheus CloudWatch exporter
(pull), and the CloudWatch datasource (query at render time, no ingestion) -
so you can pick the one that fits your latency and cost constraints. The
per-service guides build on whichever approach you choose.

## Related guides

- [Scout OTLP exporter](../../collector-setup/scout-exporter.md) - the
  Collector export block every AWS pipeline reuses.
