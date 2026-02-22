---
title: >
  Pulsar OpenTelemetry Monitoring — Broker Throughput,
  Message Backlog, and Collector Setup
sidebar_label: Pulsar
id: collecting-pulsar-telemetry
sidebar_position: 31
description: >
  Collect Pulsar metrics with the OpenTelemetry Collector.
  Monitor broker throughput, message backlog, and managed
  ledger latency using the Prometheus receiver.
keywords:
  - pulsar opentelemetry
  - pulsar otel collector
  - pulsar metrics monitoring
  - pulsar performance monitoring
  - opentelemetry prometheus receiver pulsar
  - pulsar observability
  - monitor pulsar kubernetes
  - pulsar telemetry collection
---

# Pulsar

Apache Pulsar exposes 210+ Prometheus-format metrics at port
8080 on the `/metrics/` endpoint, enabled by default with no
additional configuration. The OpenTelemetry Collector scrapes
this endpoint using the Prometheus receiver, collecting metrics
across broker throughput, message backlog, managed ledger
latency, storage operations, and connection health. This guide
configures the receiver and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Apache Pulsar          | 2.10    | 3.x+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | --          |

Before starting:

- Pulsar broker HTTP port (8080) must be accessible from the
  host running the Collector
- Metrics are enabled by default -- no configuration changes
  needed on the Pulsar side
- OTel Collector installed -- see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Broker**: topics count, producers and consumers count,
  throughput in/out, message rate in/out, message backlog,
  storage size, throttled connections
- **Topics & Subscriptions**: subscription backlog, consumer
  count, message rates, ack rates, unacked messages, delayed
  messages, dispatch throttling
- **Storage**: storage size, logical size, write/read rate,
  write latency histogram, backlog quota, offloaded size
- **Managed Ledger** (`pulsar_ml_*`): AddEntry latency and
  rate, cache hits/misses/evictions, ReadEntries rate, mark
  delete rate, AddEntry errors
- **Connections**: active connections, created/closed/failed
  connection counts
- **Function Workers**: instance count, leader status,
  schedule and rebalance execution time, startup time

Full metric list: run
`curl -s http://localhost:8080/metrics/` against your Pulsar
broker.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar
          scrape_interval: 30s
          metrics_path: /metrics/
          static_configs:
            - targets:
                - ${env:PULSAR_HOST}:8080

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
      receivers: [prometheus]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
PULSAR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

Pulsar exposes 210+ metrics including JVM and process
statistics. To collect only Pulsar-specific metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar
          scrape_interval: 30s
          metrics_path: /metrics/
          static_configs:
            - targets:
                - ${env:PULSAR_HOST}:8080
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "pulsar_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "pulsar"

# Verify Pulsar metrics endpoint directly
curl -s http://localhost:8080/metrics/ \
  | grep pulsar_topics_count

# Check broker throughput metric
curl -s http://localhost:8080/metrics/ \
  | grep pulsar_throughput_in
```

## Troubleshooting

### Connection refused on port 8080

**Cause**: Collector cannot reach the Pulsar broker HTTP
endpoint.

**Fix**:

1. Verify Pulsar is running:
   `docker ps | grep pulsar` or
   `bin/pulsar-admin brokers list`
2. Confirm the broker HTTP port in `broker.conf`:
   `webServicePort=8080`
3. Check firewall rules if the Collector runs on a separate
   host

### Metrics endpoint returns 404

**Cause**: The metrics path is missing the trailing slash.

**Fix**:

1. Use `/metrics/` (with trailing slash), not `/metrics`
2. Verify directly:
   `curl -s http://localhost:8080/metrics/`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and
   exporter

### Topic-level metrics missing

**Cause**: Topic-level metrics like `pulsar_subscription_*`
only appear when topics have active producers or consumers.

**Fix**:

1. Create a topic and produce a test message:
   `bin/pulsar-client produce test-topic -m "hello"`
2. Verify topic metrics appear:
   `curl -s http://localhost:8080/metrics/ | grep pulsar_subscription`

## FAQ

**Does this work with Pulsar running in Kubernetes?**

Yes. Set `targets` to the Pulsar broker service DNS
(e.g., `pulsar-broker.pulsar.svc.cluster.local:8080`).
If using the Apache Pulsar Helm chart, the broker HTTP
port is exposed by default. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor a multi-node Pulsar cluster?**

Brokers, BookKeeper nodes, and ZooKeeper nodes each expose
their own metrics endpoints. Add all endpoints to the
scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar-broker
          metrics_path: /metrics/
          static_configs:
            - targets:
                - broker-1:8080
                - broker-2:8080
        - job_name: pulsar-bookkeeper
          metrics_path: /metrics
          static_configs:
            - targets:
                - bookie-1:8000
                - bookie-2:8000
        - job_name: pulsar-zookeeper
          metrics_path: /metrics
          static_configs:
            - targets:
                - zk-1:8000
                - zk-2:8000
```

Each component is scraped independently and identified by
its `instance` label.

**What about the OTel Collector pulsarreceiver?**

The `pulsarreceiver` in OTel Collector Contrib is for
consuming telemetry data (traces, metrics, logs) from Pulsar
topics as a message transport layer. It does not collect
Pulsar's own operational metrics. To monitor Pulsar itself,
use the Prometheus receiver as shown in this guide.

**Why are topic-level metrics not appearing?**

Topic-level metrics such as `pulsar_subscription_backlog` and
`pulsar_consumer_msg_rate_out` only appear once a topic has
active producers or consumers. Idle or empty topics do not
emit these metrics. Produce a test message to confirm:
`bin/pulsar-client produce test-topic -m "hello"`.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md),
  [ZooKeeper](./zookeeper.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to
  focus on broker throughput, backlog, and managed ledger
  metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  -- Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  -- Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  -- Production deployment
- [Kafka Monitoring](./kafka.md)
  -- Another distributed messaging system
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  -- Alert on Pulsar metrics
