---
sidebar_position: 3
---
# Kubernetes Helm Setup
This guide demonstrates how to configure Scout's OpenTelemetry Collector to collect logs, metrics and traces from Kubernetes pods and forward them to Scout. We'll use Helm to install the collector and configure it to collect the telemetry from all pods in the all the namespaces (except the configured system kube-system).


## Install the Helm Chart

```bash
helm repo add base14 https://charts.base14.io/
```

```bash
helm install scout base14/scout-collector --namespace scout --create-namespace -f values.yaml
```

## Detailed configuration via values.yaml

Following is an example of a values.yaml file that can be used to configure scout colllector.

```yaml

scout:
  endpoint: __YOUR_ENDPOINT__
  tokenUrl: __YOUR_TOKEN_URL__
  appName: __YOUR_APP_NAME__
  apiKey: __YOUR_API_KEY__
  distribution: EKS # or GKE, AKS, EKS
  metrics:
    apps:
      enabled: true
      endpoints:
        - name: app1
          target: app1.app1.svc.cluster.local:9131
          collectionInterval: 60s
        - name: haproxy
          collectionInterval: 60s
          target: haproxy.gateway.svc.cluster.local
```

## Scout helm chart uses the above configuration to configure the OpenTelemetry Collector

1. Collects logs for the current cluster
2. Sends k8s events data.
3. Sends node and pods metrics data.
4. Sends apps metrics data for the configured app endpoints.
5. Sets up a local otlp endpoint for apps to send traces which are then forwarded to Scout.

## Using Otelcol style configuration

Following is an example of a values.yaml file that can be used to configure scout collector using otelcol style configuration. Here the configuration follows the same semantics as the OpenTelemetry Collector otelcol config. This gives a greater flexibility in terms of what you can configure to be scraped, collected etc. Reference the [otelcol-config](/otelcol-config/otelcol-config.md) for more details.

```yaml

scout:
  endpoint: __YOUR_ENDPOINT__
  tokenUrl: __YOUR_TOKEN_URL__
  appName: __YOUR_APP_NAME__
  apiKey: __YOUR_API_KEY__
  distribution: microk8s

  otelcolConfig:
    enabled: enabled
    config: |
      receivers:
        otlp:
          protocols:
            grpc:
              endpoint: 0.0.0.0:4317
            http:
              endpoint: 0.0.0.0:4318
      processors:
        batch:

      exporters:
        otlphttp/base14:
          endpoint: {{scout.endpoint}}
          auth:
            authenticator: oauth2client
          tls:
            insecure_skip_verify: true

      extensions:
        health_check:
        pprof:
        zpages:
        oauth2client:
          client_id: {{scout.clientId}}
          client_secret: {{scout.clientSecret}}
          endpoint_params:
            audience: b14collector
          token_url: {{scout.tokenUrl}}
          tls:
            insecure_skip_verify: true

      service:
        extensions: [health_check, pprof, zpages]
        pipelines:
          traces:
            receivers: [otlp]
            processors: [batch]
            exporters: [otlphttp/base14]
          metrics:
            receivers: [otlp]
            processors: [batch]
            exporters: [otlphttp/base14]
          logs:
            receivers: [otlp]
            processors: [batch]
            exporters: [otlphttp/base14]

```

