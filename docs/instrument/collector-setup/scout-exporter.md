---
keywords: [opentelemetry, otel-collector, scout exporter]
tags: [opentelemetry, base14 scout]
sidebar_position: 5
---

# Scout Exporter

The Scout exporter is a custom exporter for the Scout Collector that
exports telemetry data to Scout.

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
