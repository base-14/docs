---
title: Scout Exporter Configuration
sidebar_label: Scout Exporter
description:
  Configure Scout exporter for OpenTelemetry Collector. Set up OAuth2
  authentication and OTLP export to send telemetry data to base14 Scout
  platform.
keywords:
  [
    scout exporter,
    opentelemetry exporter,
    otlp exporter,
    telemetry export,
    opentelemetry configuration,
  ]
tags: [opentelemetry, base14 scout]
sidebar_position: 5
---

# Scout Exporter

The Scout exporter is a custom exporter for the Scout Collector that exports
telemetry data to Scout.

## Configuration

The Scout exporter requires two main configuration components:

1. OAuth2 Authentication Setup:

- Configure OAuth2 client credentials
- Set up token endpoint
- Configure TLS settings

1. Exporter Configuration:

- Set up endpoint URL
- Configure authentication
- Enable TLS settings

```yaml showLineNumbers
extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: __YOUR_CLIENT_SECRET__
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
```

## Related Guides

- [Docker Compose Setup](./docker-compose-example.md) - Quick local development
  setup
- [Kubernetes Helm Setup](./kubernetes-helm-setup.md) - Production Kubernetes
  deployment
- [OpenTelemetry Operator Setup](./opentelemetry-operator-setup.md) -
  Auto-instrumentation and CRD-based collector management
- [Advanced Collector Configuration](./otel-collector-config.md) - Full
  collector configuration reference
