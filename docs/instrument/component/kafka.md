---
title: >
  Kafka OpenTelemetry Monitoring - Consumer Lag, Partition Offsets,
  and Collector Setup
sidebar_label: Kafka
id: collecting-kafka-telemetry
sidebar_position: 14
description: >
  Collect Kafka metrics with the OpenTelemetry Collector. Monitor consumer
  group lag, partition offsets, and replica sync status, then ship to base14
  Scout.
keywords:
  - kafka opentelemetry
  - kafka otel collector
  - kafka metrics monitoring
  - kafka consumer lag monitoring
  - opentelemetry kafka metrics receiver
  - kafka observability
  - monitor kafka kubernetes
  - kafka telemetry collection
---

# Kafka

The OpenTelemetry Collector's Kafka Metrics receiver collects 16 metrics
from Kafka 2.x, 3.x, and 4.x, including consumer group lag, partition
offsets, replica sync status, topic configuration, and broker count. The
receiver speaks the Kafka client protocol directly to a broker on port
9092 - no JMX bridge or exporter sidecar - and works the same against
ZooKeeper-based and KRaft clusters. This guide configures the receiver,
connects it to your cluster, and ships metrics to base14 Scout.

> **Note**: This guide uses the `kafkametricsreceiver`, which collects
> metrics **about** Kafka. Do not confuse it with the `kafkareceiver`,
> which receives telemetry data **through** Kafka as a transport.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kafka                  | 2.x     | 4.x         |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

Before starting:

- At least one Kafka broker must be accessible from the host running the
  Collector (port 9092).
- No special user is required for unauthenticated clusters. For SASL or
  TLS clusters, see [Access Setup](#access-setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The consumer, topic, and partition series only emit once a topic exists
and a consumer group has committed offsets - an idle cluster reports just
`kafka.brokers` until traffic flows.

### Core - is it up and keeping up

| Metric | What it tells you |
|---|---|
| `kafka.brokers` | Brokers in the cluster - reachability and node count. |
| `kafka.consumer_group.lag_sum` | Total consumer-group lag, summed across partitions. The single number that says whether consumers are keeping up. Requires at least one committed consumer group to emit. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `kafka.consumer_group.lag` | Consumer-group lag per topic/partition - which partition is falling behind. |
| `kafka.consumer_group.members` | Members in the consumer group; a drop or flap signals dead consumers or rebalance storms. |
| `kafka.partition.current_offset` | Latest offset per partition - produce throughput. |
| `kafka.partition.oldest_offset` | Earliest retained offset per partition - the retention window. |
| `kafka.partition.replicas` | Assigned replicas per partition. |
| `kafka.partition.replicas_in_sync` | In-sync replicas per partition - durability. A value below `replicas` means under-replicated. |
| `kafka.topic.min_insync_replicas` | Configured ISR floor for the topic; `acks=all` produces fail when in-sync replicas drop below it. |

### Diagnostic - for investigation and tuning

Higher cardinality; topology and committed-offset detail you reach for
during an investigation, not signals you page on. In production you can
drop this tier with a `filter` processor and keep Core + Operational.

| Metric | What it tells you |
|---|---|
| `kafka.topic.partitions` | Partition count per topic. |
| `kafka.topic.replication_factor` | Replication factor per topic. |
| `kafka.topic.log_retention_period` | Topic log-retention time. |
| `kafka.topic.log_retention_size` | Topic log-retention size. |
| `kafka.broker.log_retention_period` | Broker default log-retention time. |
| `kafka.consumer_group.offset` | Committed offset per group/topic/partition. |
| `kafka.consumer_group.offset_sum` | Committed offset summed across partitions. |

Consumer-group metrics carry a `group` attribute (plus `topic` and
`partition` on the per-partition series); partition metrics carry `topic`
and `partition`; topic metrics carry `topic`. `kafka.brokers` has no
attributes.

Full metric reference:
[OTel Kafka Metrics Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/kafkametricsreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `kafka.partition.replicas_in_sync` vs `kafka.partition.replicas` | `in_sync < replicas` | Sustained under-replication | Durability at risk; check broker health and disk. |
| `kafka.partition.replicas_in_sync` vs `kafka.topic.min_insync_replicas` | Approaching the floor | `in_sync < min_insync_replicas` | `acks=all` produces will fail; restore in-sync replicas. |
| `kafka.consumer_group.members` | Dropping | Flapping across scrapes | Dead consumers or rebalance storms; check consumer health. |

## Access Setup

Verify your Kafka cluster is reachable from the Collector host:

```bash showLineNumbers title="Verify access"
# List topics
kafka-topics.sh --list --bootstrap-server localhost:9092

# Describe a topic
kafka-topics.sh --describe --topic <topic-name> \
  --bootstrap-server localhost:9092

# List consumer groups
kafka-consumer-groups.sh --list --bootstrap-server localhost:9092
```

No special permissions are required for unauthenticated clusters. The
receiver reads cluster metadata, partition offsets, and committed consumer
offsets over the standard client protocol - it does not connect to
ZooKeeper, so KRaft and ZooKeeper clusters behave identically.

For clusters fronted by SASL or TLS, add an `auth` block to the receiver:

```yaml showLineNumbers title="config/otel-collector.yaml (auth section)"
receivers:
  kafkametrics:
    brokers:
      - ${env:KAFKA_BROKERS}
    protocol_version: "4.0.0"
    scrapers:
      - brokers
      - topics
      - consumers
    auth:
      sasl:
        mechanism: SCRAM-SHA-512
        username: ${env:KAFKA_USERNAME}
        password: ${env:KAFKA_PASSWORD}
      tls:
        insecure_skip_verify: true
```

Supported SASL mechanisms: `PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512`,
`AWS_MSK_IAM`.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  kafkametrics:
    brokers:
      - ${env:KAFKA_BROKERS}
    protocol_version: "4.0.0"   # Must match your Kafka cluster version
    collection_interval: 30s
    scrapers:
      - brokers
      - topics
      - consumers

    metrics:
      # Broker metrics
      kafka.brokers:
        enabled: true
      kafka.broker.log_retention_period:
        enabled: true

      # Topic metrics
      kafka.topic.partitions:
        enabled: true
      kafka.topic.replication_factor:
        enabled: true
      kafka.topic.min_insync_replicas:
        enabled: true
      kafka.topic.log_retention_period:
        enabled: true
      kafka.topic.log_retention_size:
        enabled: true

      # Partition metrics
      kafka.partition.current_offset:
        enabled: true
      kafka.partition.oldest_offset:
        enabled: true
      kafka.partition.replicas:
        enabled: true
      kafka.partition.replicas_in_sync:
        enabled: true

      # Consumer group metrics
      kafka.consumer_group.lag:
        enabled: true
      kafka.consumer_group.lag_sum:
        enabled: true
      kafka.consumer_group.members:
        enabled: true
      kafka.consumer_group.offset:
        enabled: true
      kafka.consumer_group.offset_sum:
        enabled: true

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true        # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [kafkametrics]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

Set `protocol_version` to match your cluster - `4.0.0` for Kafka 4.x,
`3.6.0` for a 3.x cluster, and so on. To control metric volume in
production, drop the Diagnostic-tier topic and committed-offset series
with a `filter` processor while keeping Core and Operational.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
KAFKA_BROKERS=localhost:9092
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the Kafka receiver and scraped metrics
docker logs otel-collector 2>&1 | grep -i "kafka"

# Confirm connectivity from the same host
kafka-topics.sh --list --bootstrap-server localhost:9092

# Consumer-group series only emit once a group has committed offsets
kafka-consumer-groups.sh --list --bootstrap-server localhost:9092
```

`kafka.brokers` emits as soon as the receiver connects. The topic,
partition, and consumer-group series appear once a topic exists and a
consumer group has committed at least one offset.

## Troubleshooting

### Connection refused on port 9092

**Cause**: The Collector cannot reach the Kafka broker at the configured
address.

**Fix**:

1. Verify Kafka is running: `docker ps | grep kafka` or
   `systemctl status kafka`.
2. Confirm `advertised.listeners` in the broker config resolves correctly
   from the Collector host.
3. Check firewall rules between the Collector and broker.

### Consumer group metrics missing

**Cause**: The `consumers` scraper is not enabled, or no consumer group
has committed offsets yet.

**Look at**: `kafka.consumer_group.offset` and
`kafka.consumer_group.offset_sum` - if these are absent, no group has
committed, so `lag_sum` and `lag` cannot be computed either.

**Fix**:

1. Ensure `consumers` is listed under `scrapers`.
2. Verify consumer groups exist:
   `kafka-consumer-groups.sh --list --bootstrap-server localhost:9092`.
3. Consumer-group metrics only appear after at least one group commits an
   offset.

### Partitions look under-replicated

**Cause**: One or more brokers are unhealthy or out of disk, so replicas
have fallen out of the in-sync set.

**Look at**: `kafka.partition.replicas_in_sync` against
`kafka.partition.replicas` (the under-replication gap) and
`kafka.topic.min_insync_replicas` (the floor below which `acks=all`
produces fail). `kafka.broker.log_retention_period` and the topic
retention series help confirm whether retention config, not broker
health, is shrinking the available offset window.

**Fix**:

1. Check broker health and disk on the node hosting the lagging replicas.
2. Restore in-sync replicas before producers hit the `min_insync_replicas`
   floor.

### Protocol version mismatch errors

**Cause**: The `protocol_version` in the receiver config does not match
the Kafka cluster version.

**Fix**:

1. Check your Kafka version:
   `kafka-broker-api-versions.sh --bootstrap-server localhost:9092`.
2. Set `protocol_version` to match - `4.0.0` for Kafka 4.x, `3.6.0` for
   3.x.
3. The receiver defaults to an older protocol; set this explicitly for
   modern clusters.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and exporter.

## FAQ

**Does this work with Kafka running in Kubernetes?**

Yes. Set `brokers` to the Kafka service DNS
(e.g., `kafka-0.kafka.default.svc.cluster.local:9092`). The Collector can
run as a sidecar or DaemonSet. Inject SASL credentials via a Kubernetes
secret if authentication is enabled.

**Does this work with KRaft mode (no ZooKeeper)?**

Yes. The receiver connects directly to Kafka brokers over the client
protocol and never talks to ZooKeeper. KRaft and ZooKeeper-based clusters
produce identical metrics.

**How do I filter which topics are monitored?**

Use the `topic_match` regex in the receiver config. The default
`^[^_].*$` excludes internal topics (those starting with `_`). To monitor
specific topics:

```yaml
receivers:
  kafkametrics:
    topic_match: "^(orders|payments|events)$"
```

**Why is consumer lag not showing up?**

`kafka.consumer_group.lag_sum` and `kafka.consumer_group.lag` are computed
from committed offsets, so they only emit once a consumer group has
committed at least one offset. An idle cluster, or one with producers but
no committing consumers, reports `kafka.brokers` and partition offsets but
no lag.

**What is the difference between `kafkametricsreceiver` and
`kafkareceiver`?**

The `kafkametricsreceiver` collects metrics **about** the Kafka cluster
(broker count, consumer lag, partition offsets). The `kafkareceiver`
consumes telemetry data (traces, metrics, logs) **from** Kafka topics - it
is a transport mechanism, not a monitoring tool.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Kafka metrics.
- [RabbitMQ Monitoring](./rabbitmq.md) - A common companion message broker.
- [ZooKeeper Monitoring](./zookeeper.md) - Coordination service for
  ZooKeeper-based Kafka clusters.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [RabbitMQ](./rabbitmq.md), [ZooKeeper](./zookeeper.md), and other
  components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
