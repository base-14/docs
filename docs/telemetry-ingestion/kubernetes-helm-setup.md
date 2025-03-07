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
  token_url: __YOUR_TOKEN_URL__
  app_name: __YOUR_APP_NAME__
  api_key: __YOUR_API_KEY__
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