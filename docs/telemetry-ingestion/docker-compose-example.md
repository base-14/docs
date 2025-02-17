---
sidebar_position: 2
---
# Docker Compose Example

This guide demonstrates how to configure Docker container log collection using the OpenTelemetry Collector and forward those logs to Scout. We'll use Docker Compose to set up both a sample application and the collector.

## Prerequisites

Docker and Docker Compose installed on your system
A Scout account with access credentials

## Overview
The OpenTelemetry Collector's file logs receiver component enables collection of Docker container logs. When properly configured, the collector will:

- Monitor container log files
- Process and transform the logs
- Forward them to your Scout instance

## Configuration
The following example uses Docker Compose to create a complete logging pipeline with a sample application and the OpenTelemetry Collector.

### Docker Compose Configuration

Following is a sample docker-compose.yml file that sets up a sample application that uses redis as a component and the OpenTelemetry Collector. 

```yaml

version: '3.8'

x-default-logging: &logging
 driver: "json-file"
 options:
   max-size: "5m"
   max-file: "2"
   tag: "{{.Name}}|{{.ImageName}}|{{.ID}}"

services:
  web:
    build: .
    command: poetry run uvicorn demo.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - .:/demo
    ports:
      - "8000:8000"
    environment:
      - REDIS_HOST=redis
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4320
    depends_on:
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "localhost:8000/ping"]
    logging: *logging

  redis:
    image: redis:6
    ports:
      - "6379:6379"
    logging: *logging
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]


  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.119.0
    container_name: otel-collector
    deploy:
      resources:
        limits:
          memory: 200M
    restart: unless-stopped
    command: [ "--config=/etc/otelcol-config.yaml"]
    user: 0:0
    volumes:
      - /:/hostfs:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./config:/etc/
    ports:
      - "4319:4319"
      - "4318:4318"
      - "55679:55679"  # zpages: http://localhost:55679/debug/tracez
    logging: *logging
volumes:
  postgres_data:
```

### Collector Configuration

OpenTelemetry Collector is configured to
- Monitor Redis metrics
- Monitor logs for all containers using json logs driver and filereciver
- Collect telemetry data into otel-collector container and then forward them to Scout using an otlp exporter

```yaml

extensions:
  zpages:
    endpoint: 0.0.0.0:55679
  oauth2client:
    client_id: demo
    client_secret: 01JM94R5DPSZXBGK5QA4D329N5
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/playground/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

exporters:
  debug:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/01jm94npk4h8ys63x1kzw2bjes/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

  resource:
    attributes:
    - key: service.name
      value: ${env:SERVICE_NAME}
      action: upsert

receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4320

  filelog:
    include:
    - /var/lib/docker/containers/*/*-json.log
    operators:
    - id: parser-docker
      timestamp:
        layout: '%Y-%m-%dT%H:%M:%S.%LZ'
        parse_from: attributes.time
      type: json_parser
    - field: attributes.time
      type: remove
    - id: extract_metadata_from_docker_tag
      parse_from: attributes.attrs.tag
      regex: ^(?P<name>[^\|]+)\|(?P<image_name>[^\|]+)\|(?P<id>[^$]+)$
      type: regex_parser
      if: 'attributes?.attrs?.tag != nil'
    - from: attributes.name
      to: resource["docker.container.name"]
      type: move
      if: 'attributes?.name != nil'
    - from: attributes.image_name
      to: resource["docker.image.name"]
      type: move
      if: 'attributes?.image_name != nil'
    - from: attributes.id
      to: resource["docker.container.id"]
      type: move
      if: 'attributes?.id != nil'
    - from: attributes.log
      to: body
      type: move


  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 20s

  redis:
    endpoint: "redis:6379"
    collection_interval: 20s

service:
  extensions: [ oauth2client, zpages ]
  pipelines:
    traces:
      receivers: [ otlp ]
      processors: [ batch ]
      exporters: [ otlphttp/b14, debug ]
    metrics:
      receivers: [ otlp, postgresql, redis, rabbitmq, docker_stats ]
      processors: [ batch ]
      exporters: [ otlphttp/b14, debug ]
    logs:
      receivers: [ otlp, filelog ]
      processors: [ batch ]
      exporters: [ otlphttp/b14, debug ]
  telemetry:
    logs:
      level: info
```

