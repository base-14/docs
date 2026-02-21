---
title: >
  Apache HTTP Server OpenTelemetry Monitoring — Request Rates, Worker Status,
  and Collector Setup
sidebar_label: Apache HTTP Server
id: collecting-apache-httpd-telemetry
sidebar_position: 11
description: >
  Collect Apache HTTP Server metrics with the OpenTelemetry Collector. Monitor
  request rates, worker status, CPU load, and traffic throughput using the
  Apache receiver and export to base14 Scout.
keywords:
  - apache opentelemetry
  - apache httpd otel collector
  - apache metrics monitoring
  - apache performance monitoring
  - opentelemetry apache receiver
  - apache httpd observability
  - apache web server monitoring
  - apache telemetry collection
---

# Apache HTTP Server

The OpenTelemetry Collector's Apache receiver collects 13 metrics from
Apache HTTP Server 2.4.13+, including request rates, traffic throughput,
worker status, CPU usage, and system load averages. This guide configures
the receiver, enables the required `mod_status` endpoint, and ships metrics
to base14 Scout.

## Prerequisites

| Requirement            | Minimum  | Recommended |
| ---------------------- | -------- | ----------- |
| Apache HTTP Server     | 2.4.13   | 2.4.x       |
| OTel Collector Contrib | 0.90.0   | latest      |
| base14 Scout           | Any      | —           |

Before starting:

- Apache must be accessible from the host running the Collector
- `mod_status` module loaded with `ExtendedStatus On`
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Requests**: total request count, request processing time
- **Traffic**: bytes served, current connections, async connection states
- **Workers**: busy/idle workers, scoreboard slot states
- **CPU**: CPU load percentage, user/system CPU time
- **System**: 1/5/15-minute load averages, server uptime

Full metric reference:
[OTel Apache Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/apachereceiver)

## Access Setup

Enable `mod_status` in your Apache configuration:

```apacheconf showLineNumbers title="httpd-status.conf"
# Enable extended status for full metrics
ExtendedStatus On

# Expose the status endpoint
<Location "/server-status">
    SetHandler server-status
    # Restrict access to monitoring network
    Require ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
</Location>
```

`mod_status` is loaded by default in most Apache installations. If not,
add `LoadModule status_module modules/mod_status.so` before the block
above.

Verify the endpoint returns machine-readable data:

```bash showLineNumbers
curl -s http://localhost/server-status?auto
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  apache:
    endpoint: http://localhost/server-status?auto   # Change to your Apache URL
    collection_interval: 30s

    metrics:
      # Connections
      apache.connections.async:
        enabled: true
      apache.current_connections:
        enabled: true

      # Requests and traffic
      apache.requests:
        enabled: true
      apache.request.time:
        enabled: true
      apache.traffic:
        enabled: true

      # Workers
      apache.workers:
        enabled: true
      apache.scoreboard:
        enabled: true

      # CPU
      apache.cpu.load:
        enabled: true
      apache.cpu.time:
        enabled: true

      # System load
      apache.load.1:
        enabled: true
      apache.load.5:
        enabled: true
      apache.load.15:
        enabled: true

      # Uptime
      apache.uptime:
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

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [apache]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "apache"

# Verify server-status endpoint responds
curl -s http://localhost/server-status?auto

# Check mod_status is loaded
apachectl -M 2>&1 | grep status
```

## Troubleshooting

### 403 Forbidden on server-status

**Cause**: The `Require` directive restricts access and the Collector's
IP is not allowed.

**Fix**:

1. Add the Collector's IP to the `Require ip` list in the `<Location>`
   block
2. For Docker setups, use the container network CIDR
   (e.g., `Require ip 172.16.0.0/12`)
3. Restart Apache after changing the config: `apachectl graceful`

### No metrics or partial metrics

**Cause**: `ExtendedStatus` is not enabled, so only basic metrics are
returned.

**Fix**:

1. Add `ExtendedStatus On` before the `<Location>` block
2. Verify by checking the output of
   `curl -s http://localhost/server-status?auto` — it should include
   `Total Accesses`, `CPULoad`, and `ReqPerSec`
3. Restart Apache: `apachectl graceful`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Load average metrics showing zero on non-Linux

**Cause**: `apache.load.1`, `apache.load.5`, and `apache.load.15` rely
on system load averages exposed by Apache, which may not be available on
all operating systems.

**Fix**:

1. These metrics are populated on Linux systems where Apache reports
   system load in `server-status`
2. On macOS or Windows, these may report zero — this is expected behavior
3. Use OS-level monitoring for load averages on non-Linux platforms

## FAQ

**Does this work with Apache running in Kubernetes?**

Yes. Set `endpoint` to the Apache service DNS
(e.g., `http://apache.default.svc.cluster.local/server-status?auto`) and
ensure `mod_status` allows access from the Collector pod's network. The
Collector can run as a sidecar or DaemonSet.

**How do I monitor multiple Apache instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  apache/web1:
    endpoint: http://web-1/server-status?auto
  apache/web2:
    endpoint: http://web-2/server-status?auto
```

Then include both in the pipeline:
`receivers: [apache/web1, apache/web2]`

**Is `mod_status` already loaded by default?**

In most Apache installations (including the official Docker image),
`mod_status` is loaded by default. You only need to add the `<Location>`
block and `ExtendedStatus On`. Check with `apachectl -M | grep status`.

**What is the scoreboard metric?**

`apache.scoreboard` tracks the state of each Apache worker slot: waiting,
reading, sending, keepalive, DNS lookup, closing, logging, graceful
finish, idle cleanup, or open. It gives a real-time view of how Apache is
distributing work across its worker pool.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [HAProxy](./haproxy.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your traffic
  patterns

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [NGINX Monitoring](./nginx.md) — Alternative web server monitoring
