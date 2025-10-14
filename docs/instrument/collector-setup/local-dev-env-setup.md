---
title: Local Development Environment Setup with OpenTelemetry
sidebar_label: Local Dev Setup
description:
  Set up Scout collector locally for development and testing. Run OpenTelemetry
  Collector with Docker for processing traces, metrics, and logs in your dev
  environment.
keywords:
  [
    local development,
    opentelemetry dev setup,
    otel collector local,
    development environment,
    testing observability,
  ]
tags: [development, local, base14 scout]
sidebar_position: 7
---

# Local Dev Environment

Set up a Scout collector locally for development and testing purposes. It
includes:

- **Scout Collector**: For collecting, processing, and exporting telemetry data
  to Scout Backend

This environment allows you to:

- Process logs, metrics, and traces through the Scout Collector
- Test your instrumentation code locally before deploying to production

## Requirements

- [Docker](https://www.docker.com/) Installed.

## Scout Collector config

Copy the below content to `otel-collector-config.yaml`

```yaml showLineNumbers
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
  otlphttp/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip

processors:
  resource/env:
    attributes:
      - key: environment
        value: development
        action: upsert

extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    endpoint_params:
      audience: b14collector
    token_url: ${SCOUT_TOKEN_URL}
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource/env]
      exporters: [otlphttp/b14]
    metrics:
      receivers: [otlp]
      processors: [resource/env]
      exporters: [otlphttp/b14]
    logs:
      receivers: [otlp]
      processors: [resource/env]
      exporters: [otlphttp/b14]
```

> Replace the placeholders with your Scout credentials. For Adding Receiver,
> Processor, Exporter, and Service Extensions, please refer to
> [Scout Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)

## Start the Containers

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="docker-compose" label="Using Docker Compose">
```

Create a Docker compose file `compose.yml`

```yaml showLineNumbers
version: "3.8"

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.130.0
    container_name: otel-collector
    restart: unless-stopped
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol/config.yaml
    ports:
      - "4317:4317"
      - "4318:4318"
```

Run the below command to start the local development setup

```bash
docker-compose up -d
```

```mdx-code-block
</TabItem>
<TabItem value="docker-run" label="Using Docker Run">
```

Run the below command to start the local development setup

```shell
docker run -d \
  --name otel-collector \
  --restart unless-stopped \
  -p 4317:4317 \
  -p 4318:4318 \
  -v $(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector-contrib:0.130.0 \
  --config=/etc/otelcol/config.yaml
```

```mdx-code-block
</TabItem>
</Tabs>
```

That's it! Navigate to Scout Grafana dashboards to visualize the data.

## Related Guides

- [Docker Compose Setup](./docker-compose-example.md) - Complete Docker Compose
  example with Grafana
- [Scout Exporter Configuration](./scout-exporter.md) - Authentication and
  endpoint configuration
- [Express.js Instrumentation](../apps/auto-instrumentation/express.md) - Test
  with a sample application
