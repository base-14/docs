# Local Dev Environment Setup

This guide helps you set up a local observability stack for development
and testing purposes. The setup includes:

- **OpenTelemetry Collector**:
  For collecting, processing, and exporting telemetry data
- **Jaeger**:
  For distributed tracing visualization and analysis
- **Prometheus**:
  For metrics collection and monitoring

This environment allows you to:

- Collect and visualize distributed traces using Jaeger
- Monitor application metrics using Prometheus
- Process logs, metrics, and traces through the OpenTelemetry Collector
- Test your instrumentation code locally before deploying to production

## Requirements

- [Docker](https://www.docker.com/) Installed.

## OpenTelemetry Collector config

Copy the below content to `otel-collector-config.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
  otlp:
    endpoint: "jaeger:4317"
    tls:
      insecure: true
  prometheus:
    endpoint: "0.0.0.0:8889"
    namespace: app-namespace
    send_timestamps: true
    metric_expiration: 180m
    resource_to_telemetry_conversion:
      enabled: true

service:
  pipelines:
    traces:
      receivers: [ otlp ]
      exporters: [ debug, otlp ]
    metrics:
      receivers: [ otlp ]
      exporters: [ debug, otlp, prometheus ]
    logs:
      receivers: [ otlp ]
      exporters: [ debug ]
```

## Docker Compose

Create a Docker compose file `compose.yml`

```yaml
version: "3.8"

networks:
  otel-network:

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib
    container_name: otel-collector
    restart: unless-stopped
    command: [ "--config=/etc/otelcol/config.yaml" ]
    environment:
      - PROMETHEUS_EXPORTER_ENDPOINT = 0.0.0.0:8899
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol/config.yaml
    ports:
      - "4317:4317"
      - "4318:4318"
      - "8889:8889"
    networks:
      - otel-network

  jaeger:
    image: jaegertracing/all-in-one:latest
    container_name: jaeger
    restart: unless-stopped
    environment:
      - COLLECTOR_ZIPKIN_HTTP_PORT=9411
    ports:
      - "16686:16686"
      - "9411:9411"
    networks:
      - otel-network

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
    networks:
      - otel-network
```

## Prometheus Config

Create a `prometheus.yml`

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: "otel-collector"
    static_configs:
      - targets: [ "otel-collector:8889" ]
```

## Start the Containers

Run the below command to start the local development setup

```shell
docker-compose up -d
```

> Goto [http://localhost:16686/](http://localhost:16686/) to see the Jaeger UI.
> Goto [http://localhost:9090](http://localhost:9090) to see the Prometheus UI.
