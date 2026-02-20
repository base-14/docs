---
title: HAProxy Monitoring with OpenTelemetry
sidebar_label: HAProxy
id: collecting-haproxy-telemetry
sidebar_position: 12
description:
  Monitor HAProxy with OpenTelemetry Collector. Collect request rates, session
  counts, connection errors, backend health, and traffic metrics using Scout.
keywords:
  [
    haproxy monitoring,
    haproxy metrics,
    load balancer monitoring,
    opentelemetry haproxy,
    haproxy observability,
  ]
---

# HAProxy

## Overview

This guide explains how to set up HAProxy metrics collection using Scout
Collector and forward them to Scout backend. The collector scrapes the HAProxy
stats endpoint to gather frontend, backend, and server metrics.

## Prerequisites

1. HAProxy 2.4+ instance
2. Stats endpoint enabled (HTTP or Unix socket)
3. Scout Collector installed

## HAProxy Configuration

Enable the stats endpoint in your HAProxy configuration:

```text showLineNumbers
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
```

Verify the stats endpoint is accessible:

```bash showLineNumbers
# Check stats page (HTML)
curl http://<haproxy-host>:8404/stats

# Check stats in CSV format
curl 'http://<haproxy-host>:8404/stats;csv'
```

## Scout Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  haproxy:
    endpoint: http://<haproxy-host>:8404/stats
    collection_interval: 10s

    metrics:
      # Traffic metrics
      haproxy.bytes.input:
        enabled: true
      haproxy.bytes.output:
        enabled: true

      # Connection metrics
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

      # Request metrics
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

      # Response metrics
      haproxy.responses.denied:
        enabled: true
      haproxy.responses.errors:
        enabled: true
      haproxy.responses.average_time:
        enabled: true

      # Session metrics
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

      # Server metrics
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

      # Client metrics
      haproxy.clients.canceled:
        enabled: true

      # Compression metrics
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
        value: ${ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to Base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [haproxy]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test HAProxy stats endpoint:

   ```bash showLineNumbers
   # Check stats page
   curl http://<haproxy-host>:8404/stats

   # Check backend health
   curl 'http://<haproxy-host>:8404/stats;csv' | grep -i "backend"
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [HAProxy Stats Configuration](https://www.haproxy.com/documentation/haproxy-configuration-manual/latest/#stats-enable)
- [HAProxy Monitoring Guide](https://www.haproxy.com/blog/exploring-the-haproxy-stats-page)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [NGINX Monitoring](./nginx.md) - Web server and reverse proxy monitoring guide
- [AWS ELB Monitoring](../infra/aws/elb.md) - AWS managed load balancer
  monitoring guide
