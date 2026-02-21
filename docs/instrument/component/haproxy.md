---
title: >
  HAProxy OpenTelemetry Monitoring — Request Rates, Connection Errors,
  and Collector Setup
sidebar_label: HAProxy
id: collecting-haproxy-telemetry
sidebar_position: 12
description: >
  Collect HAProxy metrics with the OpenTelemetry Collector. Monitor request
  rates, session counts, connection errors, and backend health using the
  HAProxy receiver and export to base14 Scout.
keywords:
  - haproxy opentelemetry
  - haproxy otel collector
  - haproxy metrics monitoring
  - haproxy performance monitoring
  - opentelemetry haproxy receiver
  - haproxy observability
  - haproxy load balancer monitoring
  - haproxy telemetry collection
---

# HAProxy

The OpenTelemetry Collector's HAProxy receiver collects 33 metrics from
HAProxy 2.4+, including request rates, session counts, connection errors,
backend health status, and compression ratios. This guide configures the
receiver, enables the required stats endpoint, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement              | Minimum | Recommended |
| ------------------------ | ------- | ----------- |
| HAProxy                  | 2.4     | 2.8+ (LTS)  |
| OTel Collector Contrib   | 0.90.0  | latest      |
| base14 Scout             | Any     | —           |

Before starting:

- HAProxy must be accessible from the host running the Collector
- Stats endpoint enabled over HTTP — see setup below
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Traffic**: bytes in/out, request rates, total requests
- **Connections**: active connections, errors, retries, average connection time
- **Sessions**: active sessions, session rate, session limits
- **Backend health**: active/backup servers, weight, downtime, failed checks
- **Responses**: denied responses, errors, average response time
- **Compression**: bypass count, compression ratio, input/output bytes

Full metric reference:
[OTel HAProxy Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/haproxyreceiver)

## Access Setup

Enable the stats endpoint in your HAProxy configuration:

```text showLineNumbers title="haproxy.cfg"
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
```

Verify the endpoint returns CSV data:

```bash showLineNumbers
curl -s 'http://localhost:8404/stats;csv' | head -5
```

No authentication is required by default. If you add `stats auth`, pass
credentials through the Collector endpoint URL.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  haproxy:
    endpoint: http://localhost:8404/stats   # Change to your HAProxy stats URL
    collection_interval: 30s

    metrics:
      # Traffic
      haproxy.bytes.input:
        enabled: true
      haproxy.bytes.output:
        enabled: true

      # Connections
      haproxy.connections.errors:
        enabled: true
      haproxy.connections.rate:
        enabled: true
      haproxy.connections.retries:
        enabled: true
      haproxy.connections.total:
        enabled: true
      haproxy.connections.average_time:
        enabled: true

      # Requests
      haproxy.requests.denied:
        enabled: true
      haproxy.requests.errors:
        enabled: true
      haproxy.requests.queued:
        enabled: true
      haproxy.requests.rate:
        enabled: true
      haproxy.requests.redispatched:
        enabled: true
      haproxy.requests.total:
        enabled: true
      haproxy.requests.average_time:
        enabled: true

      # Responses
      haproxy.responses.denied:
        enabled: true
      haproxy.responses.errors:
        enabled: true
      haproxy.responses.average_time:
        enabled: true

      # Sessions
      haproxy.sessions.average:
        enabled: true
      haproxy.sessions.count:
        enabled: true
      haproxy.sessions.rate:
        enabled: true
      haproxy.sessions.limit:
        enabled: true
      haproxy.sessions.total:
        enabled: true

      # Server health
      haproxy.server_selected.total:
        enabled: true
      haproxy.active:
        enabled: true
      haproxy.backup:
        enabled: true
      haproxy.weight:
        enabled: true
      haproxy.downtime:
        enabled: true
      haproxy.failed_checks:
        enabled: true

      # Clients
      haproxy.clients.canceled:
        enabled: true

      # Compression
      haproxy.compression.bypass:
        enabled: true
      haproxy.compression.count:
        enabled: true
      haproxy.compression.input:
        enabled: true
      haproxy.compression.output:
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
      receivers: [haproxy]
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
docker logs otel-collector 2>&1 | grep -i "haproxy"

# Verify stats endpoint is responding
curl -s 'http://localhost:8404/stats;csv' | head -5

# Check backend health
curl -s 'http://localhost:8404/stats;csv' | grep -i "backend"
```

## Troubleshooting

### Connection refused

**Cause**: Collector cannot reach HAProxy at the configured stats endpoint.

**Fix**:

1. Verify HAProxy is running: `systemctl status haproxy` or
   `docker ps | grep haproxy`
2. Confirm the stats endpoint and port in your config match the `bind`
   directive in `haproxy.cfg`
3. Check firewall rules if the Collector runs on a separate host

### Stats endpoint returns HTML instead of metrics

**Cause**: The endpoint URL points to the wrong path or the receiver is
misconfigured.

**Fix**:

1. The receiver handles CSV parsing internally — set the endpoint to
   `/stats`, not `/stats;csv`
2. Verify `stats uri` in `haproxy.cfg` matches the path in the receiver
   config

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Metrics missing for some backends

**Cause**: HAProxy backend servers are in maintenance mode or have never
received traffic.

**Fix**:

1. Check `haproxy.active` and `haproxy.backup` — zero indicates no
   healthy servers in that backend
2. Send test traffic to the backend to trigger metric collection
3. Verify all backends appear in
   `curl -s 'http://localhost:8404/stats;csv'`

## FAQ

**Does this work with HAProxy running in Kubernetes?**

Yes. Set `endpoint` to the HAProxy service DNS
(e.g., `http://haproxy.default.svc.cluster.local:8404/stats`) and expose
the stats port in the Service definition. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor multiple HAProxy instances?**

Add multiple receiver blocks with distinct names:

```yaml
receivers:
  haproxy/primary:
    endpoint: http://haproxy-1:8404/stats
  haproxy/secondary:
    endpoint: http://haproxy-2:8404/stats
```

Then include both in the pipeline:
`receivers: [haproxy/primary, haproxy/secondary]`

**Can I use a Unix socket instead of HTTP?**

The OTel HAProxy receiver requires an HTTP stats endpoint. If HAProxy
only exposes stats over a Unix socket, add an HTTP stats frontend in
`haproxy.cfg`:

```haproxy title="haproxy.cfg"
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
```

**Why are compression metrics showing zero?**

Compression metrics require compression to be enabled in HAProxy
(`compression algo gzip` in the frontend or backend config). Session
limit metrics require `maxconn` to be set. These metrics report zero
when the corresponding HAProxy feature is not configured.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [Apache HTTP Server](./apache-httpd.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` and metric groups
  based on your traffic patterns

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [NGINX Monitoring](./nginx.md) — Web server and
  reverse proxy monitoring
- [AWS ELB Monitoring](../infra/aws/elb.md) — AWS managed load balancer
  monitoring
