# Configure base14 Scout Exporter

Securely send telemetry data to the base14 Scout observability platform using
the Scout exporter for OpenTelemetry Collector.

## Overview

The Scout exporter is a specialized OpenTelemetry Collector exporter that enables:

- Secure telemetry data export to base14 Scout
- OAuth2 authentication support

## Prerequisites

To configure the Scout exporter, ensure you have:

- base14 account credentials
- base14 tenant ID
- OAuth2 client credentials (client ID and secret)
- Network access to base14 endpoints
- OpenTelemetry Collector installed and running

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
      insecure_skip_verify: true # Required due to OpenTelemetry Collector bugs.

exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true # Required due to OpenTelemetry Collector bugs.
```
