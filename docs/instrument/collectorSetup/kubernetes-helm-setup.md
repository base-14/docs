---
sidebar_position: 2
---

# OTel Collector on Kubernetes using Helm

Deploy and configure the base14 Scout OpenTelemetry Collector on Kubernetes
using Helm.

## Overview

This guide covers how to collect telemetry data (logs, metrics, and traces)
from your Kubernetes environment and send it to base14 Scout.

- Install base14 Scout's OpenTelemetry Collector using Helm
- Configure telemetry collection for Kubernetes pods
- Set up multi-namespace monitoring
- Configure custom metrics endpoints
- Implement trace collection

## Prerequisites

- A Kubernetes cluster (EKS, GKE, AKS, or other distributions)
- Helm 3.x installed
- `kubectl` configured with cluster access
- Scout account credentials
  - Endpoint URL
  - API Key
  - Token URL
  - Application Name

## Quick Start Guide

Deploy base14 Scout OpenTelemetry Collector in minutes by following these steps:

```bash
helm repo add base14 https://charts.base14.io/
```

```bash
helm install scout base14/scout-collector  \
--namespace scout --create-namespace -f values.yaml
```

## Configuration Guide

### Basic Configuration

The `values.yaml` file below demonstrates a standard configuration for the base14
Scout collector. This configuration is suitable for most deployments and
covers essential telemetry collection.

```yaml showLineNumbers title="values.yaml"
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
5. Sets up a local otlp endpoint for apps to send traces which are then
   forwarded to Scout.

## Using Otelcol style configuration

Following is an example of a values.yaml file that can be used to configure
scout collector using otelcol style
configuration. Here the configuration follows the same semantics as the
OpenTelemetry Collector otelcol config. This
gives a greater flexibility in terms of what you can configure to be scraped,
collected etc. Reference the [otel-collector-config](./otel-collector-config.md)
for more details.

```yaml showLineNumbers
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
        extensions: [health_check, pprof, zpages, oauth2client]
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
