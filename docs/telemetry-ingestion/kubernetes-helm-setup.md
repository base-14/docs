---
sidebar_position: 3
---
# Kubernetes Helm Setup
This guide demonstrates how to configure Scout's OpenTelemetry Collector to collect logs, metrics and traces from Kubernetes pods and forward them to Scout. We'll use Helm to install the collector and configure it to collect the telemetry from all pods in the all the namespaces (except the configured system kube-system).


## Install the Helm Chart

```bash
helm repo add base14 https://helm.b14.dev
```

```bash
helm install scout base14/scout-collector --namespace scout --create-namespace --set scout.apiKey=YOUR_API_KEY --set scout.appName=YOUR_APP_NAME --set scout.env=YOUR_ENV --set scout.region=YOUR_REGION
```

## Detailed configuration via values.yaml

Following is an example of a values.yaml file that can be used to configure scout colllector.

```yaml

scout:
  apiKey: YOUR_API_KEY
  appName: YOUR_APP_NAME
  env: YOUR_ENV
  region: YOUR_REGION
  excludeNamespaces:
  - kube-system # Exclude kube-system namespace. by default all namespaces are collected
  logs:
    enabled: true # Defaults to true
    logLevel: debug # Defaults to info
    logFormat: json # Defaults to text
  metrics:
    enabled: true # Defaults to true
  traces:
    enabled: true # Defaults to true
```