---
date: 2026-09-02
id: collecting-gcp-pubsub-telemetry
title: Google Cloud Pub/Sub Monitoring with OpenTelemetry - Backlog and Delivery
sidebar_label: Pub/Sub
sidebar_position: 8
description: >
  Collect Pub/Sub topic and subscription metrics into base14 Scout with
  the OpenTelemetry googlecloudmonitoring receiver — backlog age,
  undelivered messages, dead lettering and ack deadline expiry.
keywords:
  - pubsub monitoring opentelemetry
  - gcp pubsub metrics scout
  - pubsub backlog monitoring
  - oldest unacked message age alert
  - pubsub dead letter monitoring
  - pubsub subscription metrics otel
  - google cloud pubsub observability
  - pubsub tracing opentelemetry
---

A stalled Pub/Sub consumer raises no error. The backlog grows, messages
age, and the first hard failure is a message dropped at the retention
limit hours later. This guide collects Pub/Sub's topic and
subscription metrics into Scout, and covers what its client-library
spans do and do not carry.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note Pub/Sub appears twice in these guides

This page monitors Pub/Sub **as a service you run**. The
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) guide uses Pub/Sub
as the **transport** carrying GCP logs into your collector. They are
unrelated setups, and you can run either without the other.

:::

:::note Running this in production

Storing and querying these metrics at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Overview

Pub/Sub metrics split across two monitored resources, and the split
matters because they answer different questions:

| Resource | Prefix | Answers |
|---|---|---|
| `pubsub_topic` | `pubsub.googleapis.com/topic/` | Are publishers succeeding, and what are they sending? |
| `pubsub_subscription` | `pubsub.googleapis.com/subscription/` | Are consumers keeping up, and is anything being lost? |

Almost all operational value is on the subscription side. A topic is
healthy or it is not; a subscription can be failing in half a dozen
distinguishable ways.

## Pub/Sub at a glance

| Concern | Metric | Shape |
|---|---|---|
| Backlog size | `subscription/num_undelivered_messages` | Gauge |
| Backlog age | `subscription/oldest_unacked_message_age` | Gauge, seconds |
| Consumer throughput | `subscription/ack_message_count` | Delta sum |
| Delivery attempts | `subscription/sent_message_count` | Delta sum |
| Redelivery pressure | `subscription/expired_ack_deadlines_count` | Delta sum |
| Permanent failure | `subscription/dead_letter_message_count` | Delta sum |
| Publish health | `topic/send_request_count` | Delta sum |

---

## Receiver configuration

```yaml showLineNumbers title="pubsub-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/pubsub:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Subscription health — the operational core
      - metric_name: "pubsub.googleapis.com/subscription/num_undelivered_messages"
      - metric_name: "pubsub.googleapis.com/subscription/oldest_unacked_message_age"
      - metric_name: "pubsub.googleapis.com/subscription/backlog_bytes"
      - metric_name: "pubsub.googleapis.com/subscription/ack_message_count"
      - metric_name: "pubsub.googleapis.com/subscription/sent_message_count"
      - metric_name: "pubsub.googleapis.com/subscription/expired_ack_deadlines_count"
      - metric_name: "pubsub.googleapis.com/subscription/dead_letter_message_count"
      - metric_name: "pubsub.googleapis.com/subscription/pull_request_count"
      - metric_name: "pubsub.googleapis.com/subscription/push_request_count"
      # Topic health
      - metric_name: "pubsub.googleapis.com/topic/send_request_count"
      - metric_name: "pubsub.googleapis.com/topic/byte_cost"

processors:
  resource/pubsub:
    attributes:
      - {key: service.name, value: pubsub-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_pubsub, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    metrics/pubsub:
      receivers: [googlecloudmonitoring/pubsub]
      processors: [memory_limiter, resource/pubsub, batch]
      exporters: [otlphttp/base14]
```

:::warning topic/message_sizes is a distribution

`pubsub.googleapis.com/topic/message_sizes` is `DELTA` +
`DISTRIBUTION`, supported from collector v0.129.0. It is deliberately
omitted from the list above because message size is rarely the thing you
are debugging, and a distribution failure drops every metric from the
receiver. Add it only if you need it, and only on v0.129.0 or later.

:::

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

### Collecting the whole service

```yaml showLineNumbers title="pubsub-config.yaml"
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("pubsub.googleapis.com/")'
```

This pulls in the distribution metrics too, so confirm your collector
version first.

---

## Authentication and IAM

`roles/monitoring.viewer` on the project. Note that this is a **different
grant** from the `roles/pubsub.subscriber` needed when Pub/Sub carries
your logs — monitoring Pub/Sub never reads a message. See
[GCP Monitoring overview](./overview.md#authentication).

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `subscription/num_undelivered_messages` | Gauge | count | Backlog depth. A rising line means consumers are slower than publishers. |
| `subscription/oldest_unacked_message_age` | Gauge | seconds | **The single most important Pub/Sub metric.** Backlog depth can look stable while the oldest message ages toward its retention limit. |
| `subscription/backlog_bytes` | Gauge | bytes | Backlog in bytes, for storage cost and large-payload workloads. |
| `subscription/ack_message_count` | **Delta** sum | count | Consumer throughput, labelled by `delivery_type`. |
| `subscription/sent_message_count` | **Delta** sum | count | Delivery attempts. Divide `ack_message_count` by this for the success ratio. |
| `subscription/expired_ack_deadlines_count` | **Delta** sum | count | Messages redelivered because the consumer did not ack in time. Sustained non-zero means the deadline is too short or the handler too slow. |
| `subscription/dead_letter_message_count` | **Delta** sum | count | Messages that exhausted their retry policy. Every one is a message your system failed to process. |
| `subscription/pull_request_count` | **Delta** sum | count | Labelled by `response_code`; where pull-side errors show up. |
| `subscription/push_request_count` | **Delta** sum | count | Labelled by `response_code` and `delivery_type`; push endpoint health. |
| `topic/send_request_count` | **Delta** sum | count | Publish rate and publish errors, by `response_code`. |
| `topic/byte_cost` | **Delta** sum | bytes | Billable volume, by `operation_type`. |

The two gauges are the alerting metrics. Everything else is context for
explaining them.

:::tip Depth and age tell different stories

A backlog of 10,000 messages with an oldest-age of 5 seconds is a busy,
healthy system. A backlog of 50 messages with an oldest-age of 40 minutes
is a stuck consumer holding a poison message. Depth alone cannot tell
these apart, which is why `oldest_unacked_message_age` is the one to
page on.

:::

---

## Cardinality control

Pub/Sub is well behaved here. The resource labels are bounded by how
many topics and subscriptions you have.

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `subscription_id` | Resource label | One per subscription | Yes — the grouping key |
| `topic_id` | Resource label | One per topic | Yes |
| `response_code` | Metric label | Tens | Yes |
| `delivery_type` | Metric label | A few | Yes |
| `operation_type` | Metric label | A few | Yes |

The risk is growth rather than width: a system that creates
subscriptions programmatically — one per tenant, per worker, per
deployment — grows its series count without any label changing. If you
do that, filter to the subscriptions you actually operate:

```yaml showLineNumbers title="pubsub-config.yaml"
processors:
  filter/pubsub:
    error_mode: ignore
    metrics:
      datapoint:
        - 'not IsMatch(resource.attributes["subscription_id"], "^(orders|payments|notifications)-")'
```

---

## Alert tuning

| Signal | Source metric | Warning | Critical | Notes |
|---|---|---|---|---|
| Backlog age | `subscription/oldest_unacked_message_age` | > 300s for 5m | > 25% of the retention window | Scale the threshold to what the subscription does, not to a fleet-wide number. |
| Backlog growth | `subscription/num_undelivered_messages` | rising for 15m | rising for 1h | Alert on the trend, not an absolute — normal depth varies enormously between subscriptions. |
| Dead lettering | `subscription/dead_letter_message_count` | any | sustained | Each one is a permanently failed message. Alert on presence. |
| Ack deadline expiry | `subscription/expired_ack_deadlines_count` | > 1% of `sent_message_count` | > 10% | Usually the deadline is shorter than the handler's real runtime. |
| Delivery failures | `subscription/push_request_count` where `response_code` is not 2xx | > 1% for 5m | > 5% | Push subscriptions only. |
| Publish failures | `topic/send_request_count` where `response_code` is not 2xx | > 0.1% for 5m | > 1% | Publisher-side problems, usually IAM or quota. |
| Consumer stopped | `subscription/ack_message_count` | zero for 10m | zero for 30m | Only meaningful on subscriptions with steady traffic. |

Set the backlog-age critical threshold from the subscription's message
retention (7 days by default). Past that point messages are dropped
permanently, so paging at a quarter of the window leaves room to react.

---

## Tracing Pub/Sub

The Google Cloud Pub/Sub client libraries emit spans for publish and
subscribe operations, which flow to Scout through your application's
normal OTLP pipeline. There is a significant caveat.

:::warning Pub/Sub spans carry no messaging.* attributes

Unlike Kafka or RabbitMQ instrumentation, the GCP Pub/Sub client
libraries emit **`rpc.system`, `rpc.service` and `rpc.method` only** —
no `messaging.system`, `messaging.destination.name` or
`messaging.operation`. The spans also arrive as `SpanKind = Client`
rather than `Producer` or `Consumer`.

If you build any messaging view, dashboard or aggregation that keys on
`messaging.*`, Pub/Sub traffic will be invisible to it. Resolve the
system from `rpc.service` instead, and treat `Client` spans with an
`rpc.service` of `google.pubsub.v1.Publisher` or `Subscriber` as your
producer and consumer spans.

:::

Trace context does not propagate through a Pub/Sub message by default.
To link publisher and consumer traces, inject the W3C `traceparent` into
a message attribute at publish time and extract it at consume time. The
attribute survives the broker; the span context does not travel on its
own.

---

## Logs

Pub/Sub emits no data-plane logs — individual publishes and deliveries
are not logged. Administrative operations (topic and subscription
creation, IAM changes, schema updates) appear as Cloud Audit Logs:

```bash showLineNumbers
gcloud logging sinks create scout-pubsub-audit \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='protoPayload.serviceName="pubsub.googleapis.com"'
```

Useful for correlating a metric change with a configuration change —
an ack deadline edit, a retry policy change — but not for debugging
message flow. For that, the metrics above and your consumer's own logs
are what you have.

---

## Verify

1. **The collector starts cleanly** — check for `PermissionDenied` in
   its logs.

2. **Confirm the gauges landed:**

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, max(Value) AS latest
   FROM otel_metrics_gauge
   WHERE ServiceName = 'pubsub-metrics'
     AND MetricName = 'pubsub.googleapis.com/subscription/oldest_unacked_message_age'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

   The counters (`ack_message_count` and the rest) are in
   `otel_metrics_sum` with delta temporality.

3. **Sanity-check against reality.** Publish a message to a topic with a
   subscription nobody is consuming, and confirm
   `num_undelivered_messages` rises within two collection intervals.

---

## Troubleshooting

**`oldest_unacked_message_age` is missing for some subscriptions.**
The metric is only emitted while a backlog exists, so an empty
subscription reports nothing. That silence is the healthy state.

**Backlog depth is flat but consumers are clearly behind.**
Check `oldest_unacked_message_age` instead.

**`expired_ack_deadlines_count` is high but nothing is failing.**
Messages are being redelivered and eventually acked, so no data is lost,
but you are doing the work more than once. Raise the ack deadline or
extend it from the handler.

**Dead letter count is rising with no corresponding errors in the app.**
The consumer is nacking or timing out rather than throwing. Check the
subscription's retry policy and maximum delivery attempts.

**Pub/Sub spans do not appear in messaging views.**
They carry `rpc.*` attributes only, not `messaging.*`. See
[Tracing Pub/Sub](#tracing-pubsub).

**Metrics stopped for a subscription that still exists.**
Confirm the subscription id has not changed. Recreating a subscription
with the same name produces a new resource as far as Cloud Monitoring is
concerned only if the id changed; if the id is stable, check the receiver
is still listing that project.

## FAQ

### How do I monitor Pub/Sub with OpenTelemetry?

Use the `googlecloudmonitoring` receiver against the
`pubsub.googleapis.com/` prefix, with `roles/monitoring.viewer`. Focus
the metric list on the subscription family, where the operational
signals are.

### What is the difference between undelivered messages and backlog age?

Depth counts messages waiting; age measures how long the oldest one has
waited. A large, fast-moving backlog is healthy; a small, old backlog is
a stuck consumer, and depth alone cannot tell them apart. Alert on
`subscription/oldest_unacked_message_age`, at a fraction of your
retention window.

### Why do Pub/Sub traces not show messaging attributes?

The Google Cloud Pub/Sub client libraries emit `rpc.system`,
`rpc.service` and `rpc.method` rather than the `messaging.*` semantic
conventions, and their spans are `Client` kind rather than `Producer` or
`Consumer`. Resolve the system from `rpc.service` when building any
messaging view.

### How do I propagate trace context through Pub/Sub?

Inject the W3C `traceparent` header into a message attribute when
publishing and extract it when consuming. Trace context does not travel
through the broker on its own.

### Is monitoring Pub/Sub the same as sending GCP logs through Pub/Sub?

No — the two are independent setups. This guide reads Pub/Sub's own
metrics from the Monitoring API and needs `roles/monitoring.viewer`.
Sending logs through Pub/Sub uses the `googlecloudpubsub` receiver to
consume messages and needs
`roles/pubsub.subscriber`. They are independent.

## Reference

- [Pub/Sub metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp#gcp-pubsub)
- [Pub/Sub monitoring guide](https://docs.cloud.google.com/pubsub/docs/monitoring)
- [Handling message failures](https://docs.cloud.google.com/pubsub/docs/handling-failures)

## Related Guides

- [GCP Monitoring overview](./overview.md) - how delta counters like
  `ack_message_count` land in the data lake.
- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - Pub/Sub in its
  other role, as the transport for GCP logs.
- [Cloud Run](./cloud-run.md) - a common Pub/Sub consumer, and where
  push subscriptions usually terminate.
