---
title: Apache HTTP Server Monitoring with OpenTelemetry
sidebar_label: Apache HTTP Server
id: collecting-apache-httpd-telemetry
sidebar_position: 11
description:
  Monitor Apache HTTP Server with OpenTelemetry Collector. Collect request
  counts, traffic, worker status, CPU, and connection metrics using Scout.
keywords:
  [
    apache monitoring,
    apache httpd metrics,
    web server monitoring,
    opentelemetry apache,
    apache observability,
  ]
---

# Apache HTTP Server

## Overview

This guide explains how to set up Apache HTTP Server metrics collection using
Scout Collector and forward them to Scout backend. The collector scrapes the
`mod_status` endpoint to gather server performance data.

## Prerequisites

1. Apache HTTP Server 2.4.13+ instance
2. `mod_status` module enabled with `ExtendedStatus On`
3. Network access to the server-status endpoint
4. Scout Collector installed

## Apache Configuration

Enable `mod_status` in your Apache configuration:

```apacheconf showLineNumbers
# Load the status module (if not already loaded)
LoadModule status_module modules/mod_status.so

# Enable extended status for full metrics
ExtendedStatus On

# Expose the status endpoint
<Location "/server-status">
    SetHandler server-status
    # Restrict access to monitoring network
    Require ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16
</Location>
```

Verify the status endpoint is accessible:

```bash showLineNumbers
# Check server-status (machine-readable format)
curl http://<apache-host>/server-status?auto
```

## Scout Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  apache:
    endpoint: http://<apache-host>/server-status?auto
    collection_interval: 10s

    metrics:
      # Connection metrics
      apache.connections.async:
        enabled: true
      apache.current_connections:
        enabled: true

      # Request and traffic metrics
      apache.requests:
        enabled: true
      apache.request.time:
        enabled: true
      apache.traffic:
        enabled: true

      # Worker metrics
      apache.workers:
        enabled: true
      apache.scoreboard:
        enabled: true

      # CPU metrics
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
      receivers: [apache]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test Apache status endpoint:

   ```bash showLineNumbers
   # Check server-status
   curl http://<apache-host>/server-status?auto

   # Check loaded modules
   apachectl -M | grep status
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [Apache mod_status](https://httpd.apache.org/docs/2.4/mod/mod_status.html)
- [Apache Performance Tuning](https://httpd.apache.org/docs/2.4/misc/perf-tuning.html)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [NGINX Monitoring](./nginx.md) - Alternative web server monitoring guide
