---
title: >
  ArgoCD Monitoring with OpenTelemetry — Metrics, Sync Status & Health
sidebar_label: ArgoCD
id: collecting-argocd-telemetry
sidebar_position: 34
description: >
  Collect ArgoCD Prometheus metrics with the OpenTelemetry Collector.
  Monitor application sync status, health, reconciliation, and Git
  operations. Step-by-step Kubernetes setup with export to base14 Scout.
keywords:
  - argocd opentelemetry
  - argocd otel collector
  - argocd metrics monitoring
  - argocd performance monitoring
  - opentelemetry prometheus receiver argocd
  - argocd observability
  - argocd gitops monitoring
  - argocd telemetry collection
  - argocd prometheus metrics
  - monitor argocd
  - argocd sync status monitoring
  - argocd health status metrics
  - argocd application controller metrics
  - argocd kubernetes monitoring
  - argocd metrics helm
  - argocd grafana dashboard metrics
  - argocd_app_info
  - argocd_app_reconcile
  - gitops observability
tags:
  - argocd
  - opentelemetry
  - prometheus
  - kubernetes
  - gitops
  - metrics
  - base14 scout
---

# ArgoCD

ArgoCD is a declarative GitOps continuous delivery tool for
Kubernetes that exposes Prometheus-format metrics from three core
components: the application controller (`:8082/metrics`), the API
server (`:8083/metrics`), and the repo server (`:8084/metrics`).
The OpenTelemetry Collector scrapes these endpoints using the
Prometheus receiver, collecting metrics across application sync
status, health state, reconciliation performance, Git request
latency, and gRPC request rates. This guide configures the
receiver, connects to an ArgoCD installation on Kubernetes, and
ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| ArgoCD                 | 2.5     | 2.13+       |
| OTel Collector Contrib | 0.90.0  | 0.127.0+    |
| base14 Scout           | Any     | —           |

Before starting:

- ArgoCD must be running on a Kubernetes cluster
- Metrics ports (8082, 8083, 8084) must be accessible from the
  host or pod running the Collector
- ArgoCD exposes metrics by default — no additional configuration
  is needed on the ArgoCD side
- OTel Collector installed — see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)

## What You'll Monitor

- **Application State** (controller): sync status (synced,
  out-of-sync), health status (healthy, degraded, missing,
  unknown), app count per cluster and project, orphaned resource
  count
- **Reconciliation** (controller): reconciliation duration per
  destination cluster, kubectl execution count and duration,
  kubectl request/response sizes
- **Cluster** (controller): cluster connection status, cluster
  cache age, API resource objects count, cluster event totals
- **API Server**: ArgoCD version info, gRPC request rates and
  totals by method, kubectl and Redis request performance
- **Repository Operations** (repo-server): Git request duration
  and count by repo and request type (fetch, ls-remote), manifest
  generation time, pending request count
- **Notifications** (optional): Go runtime and process metrics for
  the notifications controller

Full metric list: port-forward each component and run
`curl -s http://localhost:{port}/metrics` against your ArgoCD
installation.

## Access Setup

ArgoCD exposes Prometheus metrics by default on all components.
No additional configuration is needed to enable the endpoints.

Each component exposes metrics on a dedicated port:

| Component                       | Default Port | Endpoint   |
| ------------------------------- | ------------ | ---------- |
| argocd-application-controller   | 8082         | `/metrics` |
| argocd-server                   | 8083         | `/metrics` |
| argocd-repo-server              | 8084         | `/metrics` |
| argocd-applicationset-controller| 8080         | `/metrics` |
| argocd-notifications-controller | 9001         | `/metrics` |

### Manifest Install

When installed via plain manifests (`kubectl apply`), ArgoCD
creates dedicated metrics services:

| Service Name                              | Port |
| ----------------------------------------- | ---- |
| `argocd-metrics`                          | 8082 |
| `argocd-server-metrics`                   | 8083 |
| `argocd-repo-server`                      | 8084 |
| `argocd-notifications-controller-metrics` | 9001 |

Verify the endpoints are working:

```bash showLineNumbers title="Verify access (manifest install)"
# Port-forward the application controller metrics
kubectl -n argocd port-forward svc/argocd-metrics 8082:8082

# In another terminal, check metrics
curl -s http://localhost:8082/metrics | head -20

# Verify a key ArgoCD metric exists
curl -s http://localhost:8082/metrics | grep argocd_app_info
```

### Helm Install

When installed via the Helm chart (`argo/argo-cd`), metrics
services are **not created by default**. Enable them in your
Helm values:

```yaml showLineNumbers title="values.yaml"
controller:
  metrics:
    enabled: true

server:
  metrics:
    enabled: true

repoServer:
  metrics:
    enabled: true

notifications:
  metrics:
    enabled: true
```

Or pass the flags directly:

```bash showLineNumbers title="Helm install with metrics"
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --set controller.metrics.enabled=true \
  --set server.metrics.enabled=true \
  --set repoServer.metrics.enabled=true \
  --set notifications.metrics.enabled=true
```

With metrics enabled, the Helm chart creates these services:

| Service Name                              | Port |
| ----------------------------------------- | ---- |
| `argocd-application-controller-metrics`   | 8082 |
| `argocd-server-metrics`                   | 8083 |
| `argocd-repo-server-metrics`              | 8084 |
| `argocd-notifications-controller-metrics` | 9001 |

Verify:

```bash showLineNumbers title="Verify access (Helm install)"
kubectl -n argocd port-forward svc/argocd-application-controller-metrics 8082:8082

curl -s http://localhost:8082/metrics | grep argocd_app_info
```

In Kubernetes, the Collector typically runs as a sidecar or
DaemonSet and accesses these ports via the cluster network.
No port-forwarding is needed in that case.

## Configuration

ArgoCD has three primary components that expose metrics. The
Collector configuration uses one scrape job per component.

### Manifest Install

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: argocd-application-controller
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-metrics.argocd.svc.cluster.local:8082

        - job_name: argocd-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-server-metrics.argocd.svc.cluster.local:8083

        - job_name: argocd-repo-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-repo-server.argocd.svc.cluster.local:8084

processors:
  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Helm Install

When using the Helm chart with metrics services enabled, the
service names differ:

```yaml showLineNumbers title="config/otel-collector.yaml (Helm)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: argocd-application-controller
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-application-controller-metrics.argocd.svc.cluster.local:8082

        - job_name: argocd-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-server-metrics.argocd.svc.cluster.local:8083

        - job_name: argocd-repo-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-repo-server-metrics.argocd.svc.cluster.local:8084

processors:
  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Kubernetes Service Discovery

For dynamic scrape target discovery, use `kubernetes_sd_configs`
instead of static targets. This automatically discovers ArgoCD
metrics services:

```yaml showLineNumbers title="config/otel-collector.yaml (service discovery)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: argocd
          scrape_interval: 30s
          kubernetes_sd_configs:
            - role: endpoints
              namespaces:
                names:
                  - argocd
          relabel_configs:
            - source_labels: [__meta_kubernetes_service_name]
              regex: "argocd-metrics|argocd-server-metrics|argocd-repo-server|argocd-application-controller-metrics|argocd-repo-server-metrics"
              action: keep
            - source_labels: [__meta_kubernetes_service_name]
              target_label: argocd_component
```

This approach works with both manifest and Helm installations.

### Filtering Metrics

ArgoCD components expose Go runtime and process metrics alongside
ArgoCD-specific metrics. The server also exposes standard gRPC
metrics. To collect only relevant metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: argocd-application-controller
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-metrics.argocd.svc.cluster.local:8082
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "argocd_.*"
              action: keep

        - job_name: argocd-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-server-metrics.argocd.svc.cluster.local:8083
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "argocd_.*|grpc_server_.*"
              action: keep

        - job_name: argocd-repo-server
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - argocd-repo-server.argocd.svc.cluster.local:8084
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "argocd_.*|grpc_server_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
kubectl logs -n <collector-namespace> <collector-pod> \
  | grep -i "argocd"

# Verify ArgoCD controller metrics directly
kubectl -n argocd port-forward svc/argocd-metrics 8082:8082
curl -s http://localhost:8082/metrics \
  | grep argocd_app_info

# Check server metrics
kubectl -n argocd port-forward svc/argocd-server-metrics 8083:8083
curl -s http://localhost:8083/metrics \
  | grep grpc_server_handled_total
```

## Troubleshooting

### Connection refused on metrics port

**Cause**: Collector cannot reach ArgoCD pods at the configured
service address.

**Fix**:

1. Verify the metrics services exist:
   `kubectl -n argocd get svc | grep metrics`
2. Service names differ between manifest and Helm installs — see
   [Access Setup](#access-setup)
3. Check network policies — ArgoCD creates NetworkPolicy resources
   that may block Collector access
4. Confirm the Collector pod can reach the argocd namespace

### No application metrics (argocd_app_info missing)

**Cause**: No ArgoCD Applications have been created yet.

**Fix**:

1. ArgoCD only emits `argocd_app_*` metrics when at least one
   Application CR exists
2. Create a sample Application to verify:
   `kubectl -n argocd get applications`
3. Once an Application is synced, `argocd_app_info`,
   `argocd_app_reconcile`, and `argocd_cluster_*` metrics appear

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `kubectl logs <collector-pod>`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Partial metrics — only some components reporting

**Cause**: Not all ArgoCD component endpoints are configured in
the scrape config.

**Fix**:

1. Verify all three scrape jobs are present in the Collector config
2. Check that service names match your install method (manifest vs
   Helm)
3. Verify each service is reachable:
   `kubectl -n argocd port-forward svc/<service-name> <port>:<port>`

### Helm install — no metrics services found

**Cause**: The Helm chart does not create metrics services by
default.

**Fix**:

1. Enable metrics in Helm values:
   `controller.metrics.enabled=true`,
   `server.metrics.enabled=true`,
   `repoServer.metrics.enabled=true`
2. Upgrade: `helm upgrade argocd argo/argo-cd -n argocd -f values.yaml`
3. Verify: `kubectl -n argocd get svc | grep metrics`

## FAQ

**Does this work with ArgoCD installed via Helm?**

Yes. Enable metrics services in the Helm values by setting
`controller.metrics.enabled`, `server.metrics.enabled`, and
`repoServer.metrics.enabled` to `true`. The Helm chart creates
dedicated metrics services with different names than the manifest
install — see [Access Setup](#access-setup) for the full mapping.
Verify your service names with `kubectl -n argocd get svc`.

**How do I monitor ArgoCD in a multi-cluster setup?**

Each ArgoCD instance manages one or more target clusters. Deploy
one Collector config per ArgoCD control plane. The
`argocd_cluster_info` metric includes a `server` label identifying
the managed cluster, and `argocd_cluster_connection_status` reports
whether each cluster is reachable.

**Which component exposes sync status metrics?**

The application controller (port 8082) emits all application state
metrics. The `argocd_app_info` metric includes `sync_status` and
`health_status` labels:

```text
argocd_app_info{name="guestbook",sync_status="OutOfSync",health_status="Missing",...} 1
```

The server (port 8083) only exposes API/gRPC request metrics and
ArgoCD version info (`argocd_info`).

**Can I use Kubernetes service discovery instead of static targets?**

Yes. See the
[Kubernetes Service Discovery](#kubernetes-service-discovery)
section above. This approach uses `kubernetes_sd_configs` with
`relabel_configs` to match ArgoCD metrics services automatically
and works with both manifest and Helm installations.

**What is the difference between manifest and Helm service names?**

The service names for metrics differ between install methods:

| Component           | Manifest                                  | Helm (metrics enabled)                    |
| ------------------- | ----------------------------------------- | ----------------------------------------- |
| Application Controller | `argocd-metrics`                       | `argocd-application-controller-metrics`   |
| Server              | `argocd-server-metrics`                   | `argocd-server-metrics`                   |
| Repo Server         | `argocd-repo-server`                      | `argocd-repo-server-metrics`              |
| Notifications       | `argocd-notifications-controller-metrics` | `argocd-notifications-controller-metrics` |

Always verify with `kubectl -n argocd get svc` to confirm the
service names in your environment.

**How do I monitor ArgoCD with Prometheus?**

ArgoCD exposes Prometheus-format metrics on dedicated endpoints
(ports 8082, 8083, 8084) for the application controller, API
server, and repo server. Scrape these endpoints using the
OpenTelemetry Collector's Prometheus receiver or a native
Prometheus ServiceMonitor. See
[Configuration](#configuration) for complete scrape configs.

**What metrics does ArgoCD expose?**

ArgoCD exposes metrics across five categories:
`argocd_app_info` (sync and health status per application),
`argocd_app_reconcile` (reconciliation duration),
`argocd_git_request_total` (Git fetch/ls-remote counts and
duration), `argocd_cluster_connection_status` (managed cluster
connectivity), and `grpc_server_handled_total` (API request
rates). Run `curl http://localhost:8082/metrics` against a
running instance for the full list.

**What is the default ArgoCD metrics endpoint?**

The application controller exposes metrics at `:8082/metrics`,
the API server at `:8083/metrics`, and the repo server at
`:8084/metrics`. These are enabled by default in manifest
installs. For Helm installs, set `controller.metrics.enabled`,
`server.metrics.enabled`, and `repoServer.metrics.enabled` to
`true`.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [etcd](./etcd.md),
  [Consul](./consul.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  application sync and health metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment on Kubernetes
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on ArgoCD metrics
- [etcd Monitoring](./etcd.md)
  — Often co-deployed with ArgoCD on Kubernetes
