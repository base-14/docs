---
title: Docker Compose OpenTelemetry Setup | base14 Scout
description: Set up OpenTelemetry Collector with Docker Compose. Complete guide for container monitoring with traces, metrics, and logs collection in minutes.
keywords: [docker monitoring, docker compose, opentelemetry setup, container monitoring, docker observability]
tags: [docker, opentelemetry, base14 scout]
sidebar_position: 1
---

# Docker Compose

Collect and monitor Docker container logs using Scout Collector and
base14 Scout with a complete `Docker Compose` setup.

## Overview

This guide provides a comprehensive setup for collecting Docker container
logs and metrics using Scout Collector and forwarding them to base14 Scout.

- Set up a complete logging pipeline using `Docker Compose`
- Configure Scout Collector for container log and metrics collection
- Transform and process logs with custom operators
- Forward telemetry data to Scout platform

## Prerequisites

- Docker Engine (version 20.10+) installed
- Docker Compose (version 2.0+) installed
- A base14 Scout account with valid access credentials

## Configuration

This section demonstrates how to set up a complete observability pipeline using
Docker Compose. The setup includes:

- A sample web application with Redis backend
- Scout Collector for telemetry collection

### Docker Compose Configuration

The following `docker-compose.yml` configuration creates a three-service stack:

1. A web service running a Python application
2. A Redis instance for data storage
3. Scout Collector for telemetry processing

```yaml showLineNumbers title="docker-compose.yml"
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
      test: [ "CMD", "curl", "-f", "localhost:8000/ping" ]
    logging: *logging

  redis:
    image: redis:6
    ports:
      - "6379:6379"
    logging: *logging
    healthcheck:
      test: [ "CMD", "redis-cli", "ping" ]


  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.119.0
    container_name: otel-collector
    deploy:
      resources:
        limits:
          memory: 200M
    restart: unless-stopped
    command: [ "--config=/etc/otelcol-config.yaml" ]
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

The Scout Collector is configured with multiple components to provide
comprehensive observability:

#### Key Features

- **Metrics Collection**:
  - Redis metrics monitoring
  - Docker container stats collection
  - Application metrics via OTLP protocol

- **Log Management**:
  - Container log collection using JSON driver
  - Automated log parsing and attribute extraction
  - Custom log processing pipeline

- **Data Export**:
  - Secure forwarding to base14 Scout platform
  - OAuth2 authentication
  - Debug capabilities via zPages UI

#### Components Overview

```yaml showLineNumbers title="otel-collector-config.yaml"
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
