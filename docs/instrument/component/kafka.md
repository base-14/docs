---
title: >
  Kafka OpenTelemetry Monitoring — Consumer Lag, Partition Offsets,
  and Collector Setup
sidebar_label: Kafka
id: collecting-kafka-telemetry
sidebar_position: 14
description: >
  Collect Kafka metrics with the OpenTelemetry Collector. Monitor
  consumer group lag, partition offsets, and broker count using the
  Kafka Metrics receiver and export to base14 Scout.
keywords:
  - kafka opentelemetry
  - kafka otel collector
  - kafka metrics monitoring
  - kafka consumer lag monitoring
  - opentelemetry kafka metrics receiver
  - kafka observability
  - kafka cluster monitoring
  - kafka telemetry collection
---

# Kafka

The OpenTelemetry Collector's Kafka Metrics receiver collects 16 metrics
from Kafka 2.x and 3.x, including consumer group lag, partition offsets,
topic configuration, replica sync status, and broker count. This guide
configures the receiver, connects to a Kafka cluster, and ships metrics
to base14 Scout.

> **Note**: This guide uses the `kafkametricsreceiver`, which collects
> metrics **about** Kafka. Do not confuse it with the `kafkareceiver`,
> which receives telemetry data **through** Kafka as a transport.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kafka                  | 2.x     | 3.x+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- At least one Kafka broker must be accessible from the host running
  the Collector (port 9092)
- No special user required for unauthenticated clusters
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Brokers**: broker count, log retention period
- **Topics**: partition count, replication factor, min in-sync replicas,
  log retention period and size
- **Partitions**: current offset, oldest offset, replica count,
  in-sync replicas
- **Consumer groups**: lag per partition, lag sum per topic, current
  offset, offset sum, member count

Full metric reference:
[OTel Kafka Metrics Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/kafkametricsreceiver)

## Access Setup

Verify your Kafka cluster is accessible:

```bash showLineNumbers
# List topics
kafka-topics.sh --list --bootstrap-server localhost:9092

# Describe a topic
kafka-topics.sh --describe --topic <topic-name> \
  --bootstrap-server localhost:9092

# List consumer groups
kafka-consumer-groups.sh --list --bootstrap-server localhost:9092
```

No special permissions are required for unauthenticated clusters. For
clusters with SASL or TLS authentication, see the
[Authentication](#authentication) section below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  kafkametrics:
    brokers:
      - ${env:KAFKA_BROKERS}
    protocol_version: "3.6.0"   # Must match your Kafka cluster version
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
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [kafkametrics]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
KAFKA_BROKERS=localhost:9092
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For clusters with SASL authentication, add the `auth` block:

```yaml showLineNumbers title="config/otel-collector.yaml (auth section)"
receivers:
  kafkametrics:
    brokers:
      - ${env:KAFKA_BROKERS}
    protocol_version: "3.6.0"
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

Supported SASL mechanisms: `PLAIN`, `SCRAM-SHA-256`,
`SCRAM-SHA-512`, `AWS_MSK_IAM`.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "kafka"

# List topics to confirm connectivity
kafka-topics.sh --list --bootstrap-server localhost:9092

# List consumer groups
kafka-consumer-groups.sh --list --bootstrap-server localhost:9092
```

## Troubleshooting

### Connection refused on port 9092

**Cause**: Collector cannot reach the Kafka broker at the configured
address.

**Fix**:

1. Verify Kafka is running: `docker ps | grep kafka` or
   `systemctl status kafka`
2. Confirm `advertised.listeners` in the broker config resolves
   correctly from the Collector host
3. Check firewall rules between the Collector and broker

### Consumer group metrics missing

**Cause**: The `consumers` scraper is not enabled, or there are no
active consumer groups.

**Fix**:

1. Ensure `consumers` is listed in the `scrapers` config
2. Verify consumer groups exist:
   `kafka-consumer-groups.sh --list --bootstrap-server localhost:9092`
3. Consumer group metrics only appear when at least one group has
   committed offsets

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Protocol version mismatch errors

**Cause**: The `protocol_version` in the receiver config does not
match the Kafka cluster version.

**Fix**:

1. Check your Kafka version:
   `kafka-broker-api-versions.sh --bootstrap-server localhost:9092`
2. Set `protocol_version` to match your cluster version
3. The receiver defaults to `2.1.0` — update this for Kafka 3.x
   clusters

## FAQ

**Does this work with Kafka running in Kubernetes?**

Yes. Set `brokers` to the Kafka service DNS
(e.g., `kafka-0.kafka.default.svc.cluster.local:9092`). The Collector
can run as a sidecar or DaemonSet. Inject SASL credentials via a
Kubernetes secret if authentication is enabled.

**How do I filter which topics are monitored?**

Use the `topic_match` regex in the receiver config. The default
`^[^_].*$` excludes internal topics (those starting with `_`). To
monitor specific topics:

```yaml
receivers:
  kafkametrics:
    topic_match: "^(orders|payments|events)$"
```

**Does this work with KRaft mode (no ZooKeeper)?**

Yes. The receiver connects directly to Kafka brokers over the client
protocol. It does not connect to ZooKeeper. KRaft and ZooKeeper-based
clusters produce identical metrics.

**What is the difference between `kafkametricsreceiver` and
`kafkareceiver`?**

The `kafkametricsreceiver` collects metrics **about** the Kafka
cluster (broker count, consumer lag, partition offsets). The
`kafkareceiver` consumes telemetry data (traces, metrics, logs)
**from** Kafka topics — it is a transport mechanism, not a monitoring
tool.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your
  own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [ZooKeeper](./zookeeper.md),
  [RabbitMQ](./rabbitmq.md),
  and other components
- **Fine-tune Collection**: Use `topic_match` and `group_match` to
  limit metric volume on large clusters

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [RabbitMQ Monitoring](./rabbitmq.md) — Message queue monitoring
- [ZooKeeper Monitoring](./zookeeper.md)
  — Coordination service monitoring
