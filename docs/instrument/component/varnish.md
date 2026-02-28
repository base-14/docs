---
title: >
  Varnish OpenTelemetry Monitoring — Cache Hit Ratio, Backend Health,
  and Collector Setup
sidebar_label: Varnish
id: collecting-varnish-telemetry
sidebar_position: 42
description: >
  Collect Varnish metrics with the OpenTelemetry Collector. Monitor
  cache hit ratio, backend health, and thread pools using the Prometheus
  receiver with a Varnish exporter and export to base14 Scout.
keywords:
  - varnish opentelemetry
  - varnish otel collector
  - varnish metrics monitoring
  - varnish cache monitoring
  - opentelemetry prometheus receiver varnish
  - varnish observability
  - varnish performance monitoring
  - varnish telemetry collection
---

# Varnish

Varnish uses shared memory (VSM) for statistics rather than an HTTP
endpoint, so a Prometheus exporter sidecar is required to expose
metrics. The `prometheus_varnish_exporter` reads Varnish shared memory
and exposes Prometheus-format metrics on port 9131. The OpenTelemetry
Collector scrapes this endpoint using the Prometheus receiver,
collecting 190+ metrics including cache hit/miss ratios, backend
health, connection counts, thread pool status, and storage usage. This
guide configures the exporter, receiver, and ships metrics to base14
Scout.

## Prerequisites

| Requirement                    | Minimum | Recommended |
| ------------------------------ | ------- | ----------- |
| Varnish                        | 6.0     | 7.6+        |
| prometheus_varnish_exporter    | 1.6     | latest      |
| OTel Collector Contrib         | 0.90.0  | latest      |
| base14 Scout                   | Any     | —           |

Before starting:

- Varnish must be running with a configured backend
- The exporter needs access to Varnish shared memory (VSM) — in Docker
  this means sharing a volume at `/var/lib/varnish`
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cache**: hit count, miss count, hit-for-pass count, hit ratio
- **Connections**: client connections accepted, client requests received,
  backend connections
- **Backend**: backend health, backend connections, backend failures
- **Storage**: memory allocations, storage bytes used/available
- **Threads**: thread pool size, threads created, threads failed, queue
  length
- **Bans**: bans count, bans tested, bans added

Full metric list:
[prometheus_varnish_exporter](https://github.com/jonnenauha/prometheus_varnish_exporter)
or run `curl -s http://localhost:9131/metrics` against the exporter.

## Access Setup

Varnish does not expose Prometheus metrics natively. Install the
`prometheus_varnish_exporter` as a sidecar process that reads Varnish
shared memory (VSM).

**Docker setup** — build a custom exporter image (the project does not
publish a Docker image) and share a volume at `/var/lib/varnish`:

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
services:
  varnish:
    image: varnish:7.6
    volumes:
      - varnish-data:/var/lib/varnish

  varnish-exporter:
    build: ./exporter
    volumes:
      - varnish-data:/var/lib/varnish:ro
    ports:
      - "9131:9131"

volumes:
  varnish-data:
```

The exporter Dockerfile builds from source and includes `varnishstat`:

```dockerfile showLineNumbers title="exporter/Dockerfile"
FROM golang:1.22-bookworm AS builder
ARG EXPORTER_VERSION=1.6.1
RUN git clone --depth 1 --branch ${EXPORTER_VERSION} \
    https://github.com/jonnenauha/prometheus_varnish_exporter.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -o /prometheus_varnish_exporter .

FROM varnish:7.6
COPY --from=builder /prometheus_varnish_exporter /usr/local/bin/
EXPOSE 9131
ENTRYPOINT ["prometheus_varnish_exporter"]
```

**Bare-metal setup** — install the exporter binary and run it on the
same host as Varnish:

```bash showLineNumbers title="Install exporter"
# Download the latest release
curl -LO https://github.com/jonnenauha/prometheus_varnish_exporter/releases/latest/download/prometheus_varnish_exporter-linux-amd64.tar.gz
tar xzf prometheus_varnish_exporter-linux-amd64.tar.gz
./prometheus_varnish_exporter
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Varnish is running
varnishadm status

# Verify exporter metrics endpoint
curl -s http://localhost:9131/metrics | head -20
```

### VCL Configuration

Varnish needs a backend to serve traffic. Create a minimal VCL:

```text showLineNumbers title="config/default.vcl"
vcl 4.1;

backend default {
    .host = "backend";   # Your backend hostname or IP
    .port = "80";
}
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: varnish
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:VARNISH_EXPORTER_HOST}:9131

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
VARNISH_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "varnish"

# Verify exporter is running
curl -s http://localhost:9131/metrics | grep varnish_main

# Generate some cache traffic to produce metrics
curl -s http://localhost:6081/ > /dev/null
```

## Troubleshooting

### Exporter returns no Varnish metrics

**Cause**: The exporter cannot read Varnish shared memory (VSM).

**Fix**:

1. In Docker: verify both containers share the `/var/lib/varnish`
   volume. The Varnish container must have `:rw`, the exporter can
   use `:ro`.
2. On bare metal: verify the exporter process has read access to
   `/var/lib/varnish`
3. Check the exporter logs for VSM access errors

### Connection refused on port 9131

**Cause**: The exporter is not running or not reachable.

**Fix**:

1. Verify the exporter container is running:
   `docker ps | grep varnish-exporter`
2. Check exporter logs: `docker logs varnish-exporter`
3. Ensure the exporter starts after Varnish — use `depends_on` in
   Docker Compose

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Cache hit metrics showing zero

**Cause**: No traffic has passed through Varnish.

**Fix**:

1. Send requests through Varnish to generate cache metrics:
   `curl http://localhost:6081/`
2. Cache hit metrics only populate after Varnish processes requests
3. First request is always a miss — repeat to see hits

## FAQ

**Why do I need a separate exporter?**

Varnish stores statistics in shared memory (VSM), not over HTTP. The
`prometheus_varnish_exporter` reads VSM counters and translates them to
Prometheus format. There is no built-in Prometheus or OpenTelemetry
endpoint in Varnish.

**Does this work in Kubernetes?**

Yes. Run the exporter as a sidecar container in the same pod as
Varnish, sharing an `emptyDir` volume at `/var/lib/varnish`. The
Collector scrapes the exporter sidecar.

**How do I monitor multiple Varnish instances?**

Deploy an exporter sidecar per Varnish instance, each on a different
port. Add all exporters to the scrape targets:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: varnish
          static_configs:
            - targets:
                - varnish-exporter-1:9131
                - varnish-exporter-2:9131
```

Each instance is identified by its `instance` label.

**What does `varnish_main_cache_hit` vs `varnish_main_cache_hitpass` mean?**

`cache_hit` is a normal cache hit — the response was served from cache.
`cache_hitpass` means Varnish remembered that a previous request for
this object was uncacheable, so it passed directly to the backend
without attempting a cache lookup. Monitor the ratio of
`cache_hit / (cache_hit + cache_miss)` for overall cache efficiency.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [Caddy](./caddy.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to filter to
  just cache, backend, and thread pool metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [NGINX Monitoring](./nginx.md) — Alternative web server monitoring
- [Caddy Monitoring](./caddy.md) — Alternative web server monitoring
