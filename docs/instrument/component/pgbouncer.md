---
title: >
  PgBouncer OpenTelemetry Monitoring — Connection Pools,
  Query Throughput, and Collector Setup
sidebar_label: PgBouncer
id: collecting-pgbouncer-telemetry
sidebar_position: 28
description: >
  Collect PgBouncer metrics with the OpenTelemetry Collector.
  Monitor connection pools, query throughput, and client wait
  times using the pgbouncer-exporter and Prometheus receiver.
keywords:
  - pgbouncer opentelemetry
  - pgbouncer otel collector
  - pgbouncer metrics monitoring
  - pgbouncer performance monitoring
  - opentelemetry prometheus receiver pgbouncer
  - pgbouncer observability
  - pgbouncer connection pooling monitoring
  - pgbouncer exporter prometheus
---

# PgBouncer

PgBouncer does not expose a native Prometheus endpoint. The
`pgbouncer-exporter` sidecar connects to PgBouncer's admin
interface (the virtual `pgbouncer` database) and translates
`SHOW STATS` and `SHOW POOLS` output into 44 Prometheus
metrics with the `pgbouncer_*` prefix. The OpenTelemetry
Collector scrapes the exporter using the Prometheus receiver,
collecting metrics across connection pools, query throughput,
client wait times, and server utilization. This guide
configures the exporter, the Collector, and ships metrics
to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| PgBouncer              | 1.12    | 1.23+       |
| pgbouncer-exporter     | 0.7.0   | latest      |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | ---         |

Before starting:

- PgBouncer must be accessible from the host running the
  exporter
- The exporter must be accessible from the host running
  the Collector
- A PgBouncer user listed in `stats_users` or `admin_users`
  (see [Access Setup](#access-setup))
- Scout account and API credentials
- Scout Collector installed and configured (see
  [Quick Start](../../guides/quick-start.md))

:::info Docker images
For Docker deployments, use `edoburu/pgbouncer`
(multi-architecture including ARM64) or `bitnami/pgbouncer`
with an explicit version tag. The Bitnami image does not
publish a `latest` tag.
:::

## What You'll Monitor

- **Connection Pools**: client active/waiting connections,
  server active/idle/used/testing/login connections, max
  wait time
- **Traffic & Throughput**: SQL transactions pooled,
  queries pooled, bytes sent/received, query duration
- **Client Experience**: client wait time, server
  in-transaction time, cancel requests
- **Configuration State**: max client connections, max user
  connections, pool size, database count
- **Health**: `pgbouncer_up` status, free clients/servers,
  used clients/servers, cached DNS entries

Full metric reference:
[pgbouncer-exporter metrics](https://github.com/prometheus-community/pgbouncer_exporter#metrics)

## Access Setup

PgBouncer requires two configuration changes to support the
exporter.

### 1. Create a monitoring user

Add the exporter's connecting user to `stats_users` in
`pgbouncer.ini`:

```ini showLineNumbers title="pgbouncer.ini"
[pgbouncer]
stats_users = otel_monitor
ignore_startup_parameters = extra_float_digits
```

- `stats_users` grants read-only access to `SHOW` commands
- `ignore_startup_parameters` is required because the
  exporter's PostgreSQL driver sends `extra_float_digits`
  during connection startup, which PgBouncer rejects by
  default

### 2. Add authentication

Add the monitoring user to `userlist.txt`:

```text showLineNumbers title="userlist.txt"
"otel_monitor" "your_password"
```

### 3. Verify access

```bash showLineNumbers title="Verify exporter connectivity"
# Connect to PgBouncer admin interface
psql "postgres://otel_monitor:your_password@localhost:6432/pgbouncer?sslmode=disable" \
  -c "SHOW STATS;"
```

No write permissions are needed. The exporter only reads
pool and traffic statistics.

## Configuration

### pgbouncer-exporter

Run the exporter as a sidecar alongside PgBouncer:

```bash showLineNumbers title="Run pgbouncer-exporter"
docker run -d \
  --name pgbouncer-exporter \
  -p 9127:9127 \
  prometheuscommunity/pgbouncer-exporter \
  --pgBouncer.connectionString="postgres://${PGBOUNCER_USER}:${PGBOUNCER_PASSWORD}@pgbouncer-host:6432/pgbouncer?sslmode=disable"
```

The exporter listens on port 9127 and serves metrics at
`/metrics`.

### OTel Collector

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pgbouncer
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:PGBOUNCER_EXPORTER_HOST}:9127

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
PGBOUNCER_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the exporter and Collector, then check for metrics
within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check exporter is serving metrics
curl -s http://localhost:9127/metrics \
  | grep pgbouncer_up

# Expected: pgbouncer_up 1

# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "pgbouncer"
```

## Troubleshooting

### pgbouncer_up showing 0

**Cause**: The exporter cannot connect to PgBouncer's admin
interface.

**Fix**:

1. Verify PgBouncer is running:
   `docker ps | grep pgbouncer` or `ss -tlnp | grep 6432`
2. Test the connection string manually:
   `psql "postgres://otel_monitor:pass@localhost:6432/pgbouncer?sslmode=disable"`
3. Confirm the user is listed in `stats_users` or
   `admin_users` in `pgbouncer.ini`
4. Check that `ignore_startup_parameters` includes
   `extra_float_digits`

### Connection refused on port 9127

**Cause**: The exporter is not running or not reachable
from the Collector.

**Fix**:

1. Verify the exporter container is running:
   `docker ps | grep pgbouncer-exporter`
2. Confirm port 9127 is exposed:
   `curl http://localhost:9127/metrics`
3. Check firewall rules if the Collector runs on a
   separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Verify your Scout Collector is running
4. Confirm the pipeline includes both the receiver and
   exporter

### Exporter fails with "unsupported startup parameter"

**Cause**: `ignore_startup_parameters` is not set in
`pgbouncer.ini`.

**Fix**:

1. Add `ignore_startup_parameters = extra_float_digits`
   to the `[pgbouncer]` section
2. Reload PgBouncer: `pgbouncer -R` or send `SIGHUP`
3. Restart the exporter

## FAQ

**Does this work with PgBouncer in Kubernetes?**

Yes. Deploy the exporter as a sidecar container in the
same pod as PgBouncer. Set the exporter's connection
string to `localhost:6432` since both containers share
the pod network. Point the Collector's scrape target to
the pod IP or a headless service on port 9127.

**How do I monitor multiple PgBouncer instances?**

Add multiple targets to the scrape config:

```yaml showLineNumbers title="Multiple PgBouncer instances"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pgbouncer
          scrape_interval: 30s
          static_configs:
            - targets:
                - pgbouncer-exporter-1:9127
                - pgbouncer-exporter-2:9127
```

Each PgBouncer instance needs its own exporter sidecar.
The `instance` label differentiates metrics from each
target.

**Why is pgbouncer_up showing 0?**

The exporter cannot reach PgBouncer's admin interface.
Common causes: the connecting user is not in `stats_users`,
`ignore_startup_parameters` does not include
`extra_float_digits`, or PgBouncer is not listening on the
expected port. See the
[Troubleshooting](#pgbouncer_up-showing-0) section.

**What pool mode should I use for monitoring?**

The exporter works with all PgBouncer pool modes
(`session`, `transaction`, `statement`). Pool mode affects
how PgBouncer manages backend connections, not the
monitoring interface. The exporter connects to the virtual
`pgbouncer` database, which is independent of pool mode
settings for application databases.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or
  build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [HAProxy](./haproxy.md),
  and other components
- **Fine-tune Collection**: Adjust `scrape_interval` based
  on pool churn rate — high-traffic deployments may benefit
  from 15s intervals

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  --- Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  --- Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  --- Production deployment
- [PostgreSQL Monitoring](./postgres.md)
  --- Monitor the databases behind PgBouncer
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  --- Alert on PgBouncer metrics
