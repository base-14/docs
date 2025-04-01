# Scout Exporter Configuration


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
      insecure_skip_verify: true # this appears to be required for now due to Otel Collector bugs.

exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true # this appears to be required for now due to Otel Collector bugs.
```