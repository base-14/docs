# Scout Exporter Configuration

The Scout exporter is a custom exporter for the OpenTelemetry Collector that
exports telemetry data to the Scout endpoint.

## Configuration

```yaml

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
