---
sidebar_position: 3
---

# OTel Collector on Kubernetes using Helm

This guide walks you through deploying and configuring the Scout OpenTelemetry
Collector on Kubernetes using Helm.

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

```yaml title="values.yaml"
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

#### Features Enabled by Default

The Scout Helm chart automatically configures the following telemetry
collection capabilities:

1. **Cluster Logging**: Complete log collection from all cluster components
2. **Kubernetes Events**: Real-time monitoring of all cluster events
3. **Resource Metrics**: Comprehensive metrics from nodes and pods
4. **Application Metrics**: Custom metrics from specified application endpoints
5. **Distributed Tracing**: OTLP endpoint for trace collection and forwarding

### Advanced Configuration (OpenTelemetry Native)

For advanced use cases, base14 Scout supports native OpenTelemetry Collector
configuration, giving you complete control over your telemetry pipeline:

#### Key Capabilities

- **Receivers**:
  Configure custom data ingestion points for metrics, traces, and logs
- **Processors**:
  Apply transformations, filtering, and batching to your telemetry data
- **Exporters**: Set up multiple export destinations with custom authentication
- **Extensions**:
  Enable advanced features like health checks, debugging, and custom authentication
- **Custom Pipelines**: Design specialized data flows for different telemetry types

#### Common Use Cases

- Multi-cluster telemetry aggregation
- Complex data transformation requirements
- Custom authentication mechanisms
- High-performance pipeline optimization
- Integration with external monitoring systems

For detailed configuration options and examples,
see our [OpenTelemetry Configuration Guide](/otelcol-config/otelcol-config.md).

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
