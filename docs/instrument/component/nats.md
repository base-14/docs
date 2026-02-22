---
title: >
  NATS OpenTelemetry Monitoring — Message Throughput, Connections,
  and Collector Setup
sidebar_label: NATS
id: collecting-nats-telemetry
sidebar_position: 23
description: >
  Collect NATS metrics with the OpenTelemetry Collector. Monitor
  message throughput, client connections, and JetStream storage.
  Export to base14 Scout.
keywords:
  - nats opentelemetry
  - nats otel collector
  - nats metrics monitoring
  - nats performance monitoring
  - opentelemetry prometheus receiver nats
  - nats observability
  - nats messaging monitoring
  - nats telemetry collection
---

# NATS

NATS exposes monitoring data in JSON format at its HTTP monitoring
port. The Prometheus NATS Exporter runs as a sidecar, converting
these endpoints into Prometheus-format metrics. The OpenTelemetry
Collector scrapes the exporter using the Prometheus receiver,
collecting 80+ metrics across message throughput, connections, slow
consumers, JetStream storage, and server resources. This guide
configures the exporter, sets up the Collector, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| NATS Server            | 2.0     | 2.10+       |
| NATS Prometheus Exporter | 0.12.0 | 0.15.0+    |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- NATS HTTP monitoring port (8222) must be enabled on the server
- The Prometheus NATS Exporter must be deployed alongside the server
- Exporter port (7777) must be accessible from the host running the
  Collector
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Message Throughput**: inbound/outbound messages per second, bytes
  in/out, total connections
- **Connections**: active client connections, subscriptions, pending
  bytes, slow consumers, stale connections
- **JetStream**: total streams, consumers, stored messages, memory
  and storage usage, API requests and errors
- **Server Resources**: CPU usage, memory (RSS), goroutines, cores,
  uptime
- **Routes & Clustering**: active routes, per-route message and byte
  counts

Full metric list: run
`curl -s http://localhost:7777/metrics` against the Prometheus NATS
Exporter.

## Access Setup

### 1. Enable NATS Monitoring

Start the NATS server with the HTTP monitoring port enabled:

```bash showLineNumbers title="Enable monitoring"
# Command-line flag
nats-server -m 8222

# Or in nats-server.conf
# http_port: 8222
```

Verify the monitoring endpoint:

```bash showLineNumbers title="Verify access"
# Check NATS is running with monitoring
curl -s http://localhost:8222/varz | head -20

# Check health endpoint
curl -s http://localhost:8222/healthz
```

### 2. Deploy the Prometheus NATS Exporter

The exporter converts NATS JSON monitoring endpoints into
Prometheus-format metrics:

```bash showLineNumbers title="Start exporter"
# Run the exporter with all monitoring endpoints enabled
prometheus-nats-exporter \
  -varz -connz -routez -jsz=all \
  http://localhost:8222
```

Flags control which monitoring endpoints are scraped:

- `-varz` — server statistics (CPU, memory, messages, connections)
- `-connz` — connection details
- `-routez` — cluster route metrics
- `-jsz=all` — JetStream streams, consumers, and storage

For Docker deployments, use the
`natsio/prometheus-nats-exporter` image:

```bash showLineNumbers title="Docker exporter"
docker run -p 7777:7777 \
  natsio/prometheus-nats-exporter:latest \
  -varz -connz -routez -jsz=all \
  http://nats:8222
```

Verify the Prometheus endpoint:

```bash showLineNumbers title="Verify exporter"
curl -s http://localhost:7777/metrics | head -20
```

No authentication is required. The exporter reads from the NATS
monitoring port which is unauthenticated by default.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:NATS_EXPORTER_HOST}:7777

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
NATS_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

To collect only NATS-specific metrics and exclude Go runtime and
process metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:NATS_EXPORTER_HOST}:7777
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "gnatsd_.*|jetstream_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "nats"

# Verify NATS is running
curl -s http://localhost:8222/healthz

# Check metrics endpoint directly
curl -s http://localhost:7777/metrics \
  | grep gnatsd_varz_connections
```

## Troubleshooting

### Exporter shows zero metrics

**Cause**: The exporter cannot reach the NATS monitoring port.

**Fix**:

1. Verify NATS is running with monitoring enabled:
   `curl http://localhost:8222/varz`
2. Confirm the NATS URL passed to the exporter is correct
3. Check that no firewall blocks access between the exporter and NATS

### JetStream metrics missing

**Cause**: JetStream is not enabled or the `-jsz` flag is not set.

**Fix**:

1. Enable JetStream on the NATS server: `nats-server -m 8222 -js`
2. Start the exporter with `-jsz=all` to include stream and consumer
   metrics
3. Verify: `curl http://localhost:8222/jsz`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Slow consumer count increasing

**Cause**: A client is not consuming messages fast enough, causing
the server to track it as a slow consumer.

**Fix**:

1. Monitor `gnatsd_varz_slow_consumers` for trends
2. Check per-connection stats:
   `curl http://localhost:8222/connz?sort=pending`
3. Increase client buffer sizes or add more consumer instances

## FAQ

**Does this work with NATS running in Kubernetes?**

Yes. Deploy the Prometheus NATS Exporter as a sidecar in the NATS
pod, pointing at `http://localhost:8222`. Set the Collector's
`targets` to the exporter's service DNS
(e.g., `nats-exporter.default.svc.cluster.local:7777`). The
Collector can run as a sidecar or DaemonSet.

**How do I monitor a NATS cluster?**

Each NATS node needs its own exporter sidecar. Add all exporter
endpoints to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          static_configs:
            - targets:
                - nats-exporter-1:7777
                - nats-exporter-2:7777
                - nats-exporter-3:7777
```

Each node is scraped independently and identified by its `instance`
label.

**Why does the exporter use `gnatsd_` as the metric prefix?**

The `gnatsd_` prefix is a legacy naming convention from when the NATS
server was called `gnatsd`. The exporter maintains this prefix for
backward compatibility with existing dashboards and alerting rules.

**Can I monitor NATS without the exporter sidecar?**

The native NATS monitoring endpoints (`/varz`, `/connz`, etc.) return
JSON, which the Prometheus receiver cannot parse directly. The
Prometheus NATS Exporter is required to convert these into
Prometheus-format metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md),
  [RabbitMQ](./rabbitmq.md),
  and other components
- **Fine-tune Collection**: Use exporter flags to control which
  monitoring endpoints are scraped

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on NATS metrics
- [Kafka Monitoring](./kafka.md)
  — Message queue monitoring
