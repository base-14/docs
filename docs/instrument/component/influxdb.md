---
title: >
  InfluxDB OpenTelemetry Monitoring — Write Throughput, Query Duration,
  and Collector Setup
sidebar_label: InfluxDB
id: collecting-influxdb-telemetry
sidebar_position: 40
description: >
  Collect InfluxDB metrics with the OpenTelemetry Collector. Monitor
  write throughput, query duration, and storage cardinality using the
  Prometheus receiver and export to base14 Scout.
keywords:
  - influxdb opentelemetry
  - influxdb otel collector
  - influxdb metrics monitoring
  - influxdb performance monitoring
  - opentelemetry prometheus receiver influxdb
  - influxdb observability
  - influxdb time series monitoring
  - influxdb telemetry collection
---

# InfluxDB

InfluxDB 2.x exposes Prometheus-format metrics at `/metrics` on port
8086 by default — no additional configuration required. The
OpenTelemetry Collector scrapes this endpoint using the Prometheus
receiver, collecting 60+ metrics including HTTP request rates, write
throughput, query duration, storage cardinality, task execution status,
and Go runtime statistics. This guide configures the receiver and ships
metrics to base14 Scout.

:::note
The OTel Collector's `influxdbreceiver` is for **receiving** InfluxDB
line protocol writes (push model) — it is NOT for monitoring InfluxDB
health. This guide uses the Prometheus receiver to scrape InfluxDB's
built-in `/metrics` endpoint.
:::

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| InfluxDB               | 2.0     | 2.7+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- InfluxDB HTTP API port (8086) must be accessible from the host running
  the Collector
- InfluxDB initial setup must be complete (org, bucket, admin user)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Go Runtime**: goroutines, memory alloc, GC pause, heap objects
- **HTTP**: request count, request duration
- **Storage**: retention check duration, writer points, writer errors,
  writer timeouts
- **Writes**: points written, dropped points, write errors
- **Tasks**: executor active runs, scheduler execution calls, schedule
  failures
- **Internal**: bucket/org/user/token counts, BoltDB read/write
  operations

Full metric list: run
`curl -s http://localhost:8086/metrics` against your InfluxDB instance.

## Access Setup

The `/metrics` endpoint is enabled by default in InfluxDB 2.x — no
configuration changes are needed. The endpoint does not require
authentication.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check InfluxDB is running
curl -s http://localhost:8086/health

# Verify Prometheus metrics endpoint
curl -s http://localhost:8086/metrics | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: influxdb
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:INFLUXDB_HOST}:8086

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
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
INFLUXDB_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "influx"

# Verify InfluxDB is healthy
curl -s http://localhost:8086/health

# Check metrics endpoint directly
curl -s http://localhost:8086/metrics | grep influxdb_
```

## Troubleshooting

### Connection refused on port 8086

**Cause**: Collector cannot reach InfluxDB at the configured address.

**Fix**:

1. Verify InfluxDB is running: `docker ps | grep influxdb` or
   `systemctl status influxd`
2. Confirm the HTTP bind address in InfluxDB config
3. Check firewall rules if the Collector runs on a separate host

### Metrics endpoint returns 404

**Cause**: InfluxDB has not completed initial setup, or the instance
is running InfluxDB 1.x with a different metrics configuration.

**Fix**:

1. Complete the initial setup via the UI at `http://localhost:8086` or
   via environment variables (`DOCKER_INFLUXDB_INIT_MODE=setup`)
2. For InfluxDB 1.x, verify `/metrics` is enabled in the configuration

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**What about the OTel InfluxDB receiver?**

The `influxdbreceiver` in the OTel Collector Contrib is for receiving
InfluxDB line protocol writes — it acts as an InfluxDB-compatible write
endpoint, not a metrics scraper. To monitor InfluxDB itself, use the
Prometheus receiver as shown in this guide.

**Does this work with InfluxDB 1.x?**

InfluxDB 1.x also exposes a `/metrics` endpoint, but the internal
metrics differ from 2.x. The Prometheus receiver will scrape them
correctly — the metric names will reflect 1.x internals (e.g.,
`influxdb_shard_*` instead of `storage_*`).

**Does this work with InfluxDB running in Kubernetes?**

Yes. Set `targets` to the InfluxDB service DNS
(e.g., `influxdb.default.svc.cluster.local:8086`). The Collector can
run as a sidecar or DaemonSet.

**How do I monitor multiple InfluxDB instances?**

Add all instances to the scrape targets:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: influxdb
          static_configs:
            - targets:
                - influxdb-1:8086
                - influxdb-2:8086
```

Each instance is identified by its `instance` label.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [MySQL](./mysql.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to filter to
  just write, query, and storage metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [MySQL Monitoring](./mysql.md) — Database monitoring
- [PostgreSQL Monitoring](./postgres.md) — Database monitoring
