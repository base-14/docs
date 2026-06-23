---
title: >
  NATS OpenTelemetry Monitoring - Message Throughput, Slow Consumers,
  and Collector Setup
sidebar_label: NATS
id: collecting-nats-telemetry
sidebar_position: 23
description: >
  Collect NATS metrics with the OpenTelemetry Collector. Monitor message
  throughput, slow consumers, and JetStream storage via the Prometheus NATS
  Exporter, and ship to base14 Scout.
keywords:
  - nats opentelemetry
  - nats otel collector
  - nats metrics monitoring
  - nats performance monitoring
  - opentelemetry prometheus receiver nats
  - nats observability
  - nats jetstream monitoring
  - nats telemetry collection
---

# NATS

NATS serves JSON monitoring data at its HTTP port (`:8222`). The
`prometheus-nats-exporter` sidecar converts that into Prometheus text on
`:7777`, and the OpenTelemetry Collector's `prometheus` receiver scrapes the
exporter, collecting 80+ metrics from NATS 2.0+ across message throughput,
client connections, slow consumers, JetStream storage, and server resources.
This guide configures the exporter and receiver and ships metrics to base14
Scout.

## Prerequisites

| Requirement              | Minimum | Recommended |
| ------------------------ | ------- | ----------- |
| NATS Server              | 2.0     | 2.10+       |
| Prometheus NATS Exporter | 0.12.0  | 0.15.0+     |
| OTel Collector Contrib   | 0.90.0  | 0.153.0     |
| base14 Scout             | Any     | -           |

Before starting:

- NATS must be running with the HTTP monitoring port (`8222`) enabled.
- JetStream must be enabled (`-js`) if you want the `jetstream_*` metrics.
- The `prometheus-nats-exporter` must be deployed alongside the server, one
  per NATS node, with its port (`7777`) reachable from the host running the
  Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

A few things shape this surface, and they matter for every tier below:

- **The exporter sidecar is mandatory.** NATS exposes its monitoring data as
  JSON at `:8222`, which the `prometheus` receiver cannot parse. The
  `prometheus-nats-exporter` converts it to Prometheus text - run one per NATS
  node.
- **`up` is the liveness signal here.** Unlike the native-receiver components,
  NATS has a real `up` series: the `prometheus` receiver emits `up` = 1 when
  the exporter scrape succeeds. Note that `up` tracks *exporter* reachability;
  the `gnatsd_*` values are only fresh while the exporter can reach NATS at
  `:8222`.
- **Everything is exposed as a Prometheus gauge.** The exporter re-reads the
  monitoring data each scrape and publishes even cumulative server counters -
  `gnatsd_varz_in_msgs`, `gnatsd_varz_out_msgs`,
  `gnatsd_varz_total_connections` - as gauges carrying the running total.
  Derive throughput with `rate()` or deltas, and expect a reset to 0 on a
  server restart.
- **JetStream metrics need `-jsz=all` on the exporter and `-js` on the
  server.** The `jetstream_*` family and the `gnatsd_varz_jetstream_stats_*`
  series are absent otherwise.
- **The `gnatsd_` prefix is legacy** - from when the server binary was
  `gnatsd`. The exporter keeps it for dashboard and alert compatibility.

### Core - is it up, moving messages, and keeping clients fed

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 = the NATS exporter responded. The liveness signal on this surface. |
| `gnatsd_varz_in_msgs`, `gnatsd_varz_out_msgs` | Messages received / sent - the headline broker throughput. Cumulative gauges; use `rate()` for msgs/sec. |
| `gnatsd_varz_connections` | Current client connections - load. |
| `gnatsd_varz_slow_consumers` | Clients or routes that fell behind and had messages dropped. NATS's signature health signal; non-zero means back-pressure. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Bandwidth | `gnatsd_varz_in_bytes`, `gnatsd_varz_out_bytes` | Bytes in / out (cumulative gauges) - throughput in bytes. |
| Connections | `gnatsd_varz_subscriptions`, `gnatsd_varz_total_connections` | Active subscriptions; connections since start (a reconnect-storm / churn signal). |
| Server resources | `gnatsd_varz_mem`, `gnatsd_varz_cpu` | Process RSS and CPU - memory and CPU saturation. |
| Clustering | `gnatsd_varz_routes`, `gnatsd_routez_num_routes`, `gnatsd_varz_leafnodes` | Cluster routes and leaf-node connections; a missing route signals a partition. |
| JetStream storage | `gnatsd_varz_jetstream_stats_storage`, `gnatsd_varz_jetstream_stats_memory` | JetStream bytes on disk / in memory - saturate against the configured max. |
| JetStream API | `gnatsd_varz_jetstream_stats_api_errors`, `jetstream_server_total_messages` | API errors (alert when climbing); messages stored across all streams. |
| Consumer lag | `jetstream_consumer_num_pending`, `jetstream_consumer_num_ack_pending`, `jetstream_consumer_num_redelivered` | Per-consumer lag: undelivered, awaiting-ack, and redelivered (processing-failure) messages. |
| Slow-consumer breakdown | `gnatsd_varz_slow_consumer_stats_*` (by connection type: clients / routes / gateways / leafs) | Where the back-pressure is coming from. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Per-connection drill-down | `gnatsd_connz_in_msgs`, `gnatsd_connz_out_msgs`, `gnatsd_connz_subscriptions`, `gnatsd_connz_pending_bytes`, `gnatsd_connz_num_connections` | Find the specific connection behind a slow consumer or a pending-bytes spike. Reads 0 when no client is connected at scrape time. |
| Per-stream JetStream internals | `jetstream_stream_total_messages`, `jetstream_stream_total_bytes`, `jetstream_stream_consumer_count`, `jetstream_stream_first_seq`, `jetstream_stream_last_seq` | Stream depth, sequence range, and per-stream limits during a backlog. |
| Per-consumer internals | `jetstream_consumer_delivered_stream_seq`, `jetstream_consumer_ack_floor_stream_seq`, `jetstream_consumer_num_waiting` | Delivery / ack sequence position when diagnosing a stuck consumer. |
| Account / server capacity | `jetstream_account_storage_used`, `jetstream_server_total_streams`, `jetstream_server_total_consumers` | JetStream account and server-wide capacity accounting. |
| Static config constants | `gnatsd_varz_max_connections`, `gnatsd_varz_max_payload`, `gnatsd_varz_ping_interval` (and the rest of the `gnatsd_varz_*` config values) | Context for a limit breach - what the server is configured to allow. |
| Server identity | `gnatsd_varz_version`, `gnatsd_varz_server_id` | Confirm which server / version a series came from. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped` | Receiver-side scrape health, not from NATS. |

Full metric list: run `curl -s http://localhost:7777/metrics` against the
exporter.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload.

| Metric | Threshold | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The exporter scrape failed, or NATS is down behind it. Check the exporter and the NATS monitoring port. |
| `gnatsd_varz_slow_consumers` | `> 0` | Clients or routes are falling behind and messages are being dropped. Increase client buffers or add consumers; inspect `connz?sort=pending`. |
| `gnatsd_varz_jetstream_stats_storage / gnatsd_varz_jetstream_config_max_storage` | `> 0.85` | Streams start rejecting writes at the configured limit - add storage or tighten stream retention. |
| `rate(gnatsd_varz_jetstream_stats_api_errors)` | `> 0` | JetStream operations are failing - inspect stream / consumer config and the server logs. |
| `jetstream_consumer_num_pending` | Rising vs baseline | A consumer is not keeping up with producers - scale the consumer or check its processing. |
| `gnatsd_varz_mem` | Rising toward the host limit | The NATS process is approaching memory pressure - check message backlog and connections. |
| `gnatsd_varz_routes` | Below the expected peer count | A cluster peer is disconnected - quorum / clustering is degraded. Check the peer and network. |

The storage alert is a ratio against the server's own configured limit, and the
rest are read states or relative-to-baseline - so they hold regardless of your
host size. Set absolute byte thresholds only against your own provisioned
capacity.

## Access Setup

NATS does not expose Prometheus metrics natively. Enable the HTTP monitoring
port, then run the `prometheus-nats-exporter` as a sidecar that reads it.

### 1. Enable NATS monitoring

Start NATS with the HTTP monitoring port enabled (add `-js` for JetStream):

```bash showLineNumbers title="Enable monitoring"
# Command-line flags
nats-server -m 8222 -js

# Or in nats-server.conf
# http_port: 8222
# jetstream: enabled
```

Verify the monitoring endpoint:

```bash showLineNumbers title="Verify NATS"
# Health endpoint
curl -s http://localhost:8222/healthz

# Server stats
curl -s http://localhost:8222/varz | head -20
```

The monitoring port is unauthenticated by default - no credentials are needed
for the exporter to read it. In production, restrict access to it at the
network layer.

### 2. Deploy the Prometheus NATS Exporter

The exporter converts the NATS JSON monitoring endpoints into Prometheus-format
metrics. Pass the flags for the endpoints you want; `-jsz=all` is required for
JetStream metrics:

```bash showLineNumbers title="Docker exporter"
docker run -p 7777:7777 \
  natsio/prometheus-nats-exporter:latest \
  -varz -connz -routez -jsz=all \
  http://nats:8222
```

Flags control which endpoints are scraped:

- `-varz` - server statistics (CPU, memory, messages, connections).
- `-connz` - per-connection details.
- `-routez` - cluster route metrics.
- `-jsz=all` - JetStream streams, consumers, and storage.

Verify the Prometheus endpoint:

```bash showLineNumbers title="Verify exporter"
curl -s http://localhost:7777/metrics | head -20
```

## Configuration

The recommended config scrapes the exporter and keeps only the NATS series with
a `metric_relabel_configs` keep filter, dropping the Go-runtime and process
noise the exporter also emits:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:NATS_EXPORTER_HOST}:7777   # exporter host:port
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "gnatsd_.*|jetstream_.*"
              action: keep

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
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

The `up` and `scrape_*` series survive the keep filter - the `prometheus`
receiver synthesizes them after relabeling - so the liveness signal is
preserved.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable in v1.41.0). The legacy
> `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
NATS_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped NATS metrics
docker logs otel-collector 2>&1 | grep -i "nats"

# Confirm NATS monitoring is up
curl -s http://localhost:8222/healthz

# Confirm the exporter is serving the metric
curl -s http://localhost:7777/metrics | grep gnatsd_varz_connections
```

## Troubleshooting

### Exporter shows zero metrics

**Cause**: The exporter cannot reach the NATS monitoring port.

**Fix**:

1. Verify NATS is running with monitoring enabled:
   `curl http://localhost:8222/varz`.
2. Confirm the NATS URL passed to the exporter is correct.
3. Check that no firewall blocks access between the exporter and NATS. Remember
   `up` tracks the exporter, not NATS - a green `up` with stale `gnatsd_*`
   values means the exporter lost its link to `:8222`.

### JetStream metrics missing

**Cause**: JetStream is not enabled, or the `-jsz` flag is not set on the
exporter.

**Look at**: the per-stream `jetstream_stream_*` and per-consumer
`jetstream_consumer_*` Diagnostic series - they are absent entirely when
JetStream is off.

**Fix**:

1. Enable JetStream on the server: `nats-server -m 8222 -js`.
2. Start the exporter with `-jsz=all` to include stream and consumer metrics.
3. Verify: `curl http://localhost:8222/jsz`.

### Slow consumer count increasing

**Cause**: A client is not consuming fast enough, so the server tracks it as a
slow consumer and drops its messages.

**Look at**: `gnatsd_varz_slow_consumers` for the trend, the
`gnatsd_varz_slow_consumer_stats_*` breakdown for the connection type, and the
per-connection `gnatsd_connz_pending_bytes` to find the offending client.

**Fix**:

1. Inspect per-connection stats:
   `curl http://localhost:8222/connz?sort=pending`.
2. Increase client buffer sizes or add more consumer instances.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with NATS running in Kubernetes?**

Yes. Run the `prometheus-nats-exporter` as a sidecar in the NATS pod, pointing
at `http://localhost:8222`. Set the Collector's `targets` to the exporter's
service DNS (e.g., `nats-exporter.default.svc.cluster.local:7777`). The
Collector can run as a sidecar or a DaemonSet.

**How do I monitor a NATS cluster?**

Each NATS node needs its own exporter sidecar. Add all exporter endpoints to
the scrape config:

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

Each node is scraped independently and identified by its `instance` label.

**Why does the exporter use `gnatsd_` as the metric prefix?**

It is a legacy naming convention from when the NATS server binary was called
`gnatsd`. The exporter keeps the prefix so existing dashboards and alerting
rules keep working.

**Can I monitor NATS without the exporter sidecar?**

No. The native NATS monitoring endpoints (`/varz`, `/connz`, `/routez`, `/jsz`)
return JSON, which the `prometheus` receiver cannot parse. The
`prometheus-nats-exporter` is required to convert them into Prometheus-format
metrics.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on NATS metrics.
- [Kafka Monitoring](./kafka.md) - Consumer lag and partition offsets for
  another high-throughput broker.
- [RabbitMQ Monitoring](./rabbitmq.md) - Queue depth and consumer health for a
  classic message queue.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md), [RabbitMQ](./rabbitmq.md), and other components.
