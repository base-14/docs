---
title: >
  Argo CD OpenTelemetry Monitoring - Sync Status, Health, Reconciliation,
  Git Operations, and Collector Setup
sidebar_label: ArgoCD
id: collecting-argocd-telemetry
sidebar_position: 2
description: >
  Collect Argo CD metrics from all five components with the OpenTelemetry
  Collector. Monitor Application sync and health, reconciliation, Git
  operations and cluster connections in base14 Scout.
keywords:
  - argocd opentelemetry
  - argocd otel collector
  - argocd metrics monitoring
  - argocd sync status monitoring
  - argocd health status metrics
  - argocd_app_info
  - argocd application controller metrics
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

# Argo CD

Argo CD serves Prometheus-format metrics from each of its five
components: the application controller, the API server, the repo server,
the ApplicationSet controller and the notifications controller. The
Collector's `prometheus` receiver scrapes them with one job per component
and ships the `argocd_*` series to base14 Scout. Application state lives
on the controller: one `argocd_app_info` series per Application carries
its sync status and health. This guide covers the endpoints for manifest
and Helm installs, the Collector configuration, the tiers and what the
state metrics mean.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Argo CD                | 2.5     | 3.5         |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The metric names in this guide are the 3.5 names. The Collector floor is
about component names: the `otlp_http` exporter was `otlphttp` before
contrib 0.149.0.

Before starting:

- Argo CD running on a Kubernetes cluster, installed from the upstream
  manifests or the Helm chart. Apply the upstream `install.yaml` with
  `kubectl apply --server-side`; the ApplicationSet CRD is too large for
  a client-side apply.
- A Collector in the cluster that can reach the `argocd` namespace - see
  [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md).
  One replica is enough.
- A Scout account and OTLP endpoint.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

Each component serves its own registry. The application controller
carries the Application and cluster families; the repo server the Git
families; the API server mostly gRPC counters; the ApplicationSet and
notifications controllers little beyond Go runtime metrics.

### Core - are Applications in the state Git says

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 per component job when the Collector scraped it. |
| `argocd_app_info` | gauge | One series per Application with `sync_status`, `health_status`, `project`, `repo`, `dest_server`, `dest_namespace`, `autosync_enabled` and `operation`. Always 1; the labels are the state. |
| `argocd_cluster_connection_status` | gauge | 1 when the controller can reach a destination cluster, by `server`. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `argocd_app_sync_total` | counter | Syncs by Application and `phase`: `Succeeded`, `Failed`, `Error`. |
| `argocd_app_reconcile` | histogram | Reconcile duration by destination. |
| `argocd_app_k8s_request_total` | counter | Kubernetes API requests the controller makes per Application. |
| `argocd_kubectl_requests_total` | counter | API requests per component, by verb and code. |
| `argocd_git_request_total` | counter | Git operations on the repo server by `repo` and `request_type`, `fetch` or `ls-remote`. |
| `argocd_git_lsremote_fail_total` | counter | Failed `ls-remote` calls, the first sign of an unreachable repo or a missing revision. |
| `argocd_repo_pending_request_total` | gauge | Requests waiting on the repo server, by `repo`. |
| `argocd_repo_parallelism_wait_duration_seconds` | histogram | Time requests wait for a repo server slot. |
| `argocd_redis_request_total` | counter | Redis calls per component, with a `failed` label. |
| `argocd_app_orphaned_resources_count` | gauge | Resources in an Application's namespace that Git does not own. |
| `argocd_cluster_events_total` | counter | Watch events received from each destination cluster. |
| `argocd_cluster_api_resources` | gauge | API resource types the controller tracks per cluster. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `argocd_kubectl_request_duration_seconds`, `argocd_kubectl_request_size_bytes`, `argocd_kubectl_response_size_bytes`, `argocd_kubectl_rate_limiter_duration_seconds` | API client latency, sizes and client-side throttling. |
| `argocd_kubectl_exec_total`, `argocd_kubectl_exec_pending`, `argocd_kubectl_transport_cache_entries`, `argocd_kubectl_transport_create_calls_total` | Client internals. |
| `argocd_cluster_cache_age_seconds`, `argocd_cluster_api_resource_objects` | Cluster cache age and size. |
| `argocd_redis_request_duration`, `argocd_redis_request_duration_seconds` | Redis latency; the name differs between the controller and the repo server. |
| `argocd_app_sync_duration_seconds_total` | Cumulative sync time per Application. |
| `argocd_webhook_handlers_in_flight` | Webhooks being handled on the API server and the notifications controller. |
| `argocd_info` | The running version, on the API server. |
| `go_*`, `process_*`, `grpc_server_*`, `controller_runtime_*`, `workqueue_*` | Runtime, gRPC and controller internals on every component. |

### Which component serves what

| Component | Argo CD families | What else is on the port |
| --- | --- | --- |
| application controller | `argocd_app_*`, `argocd_cluster_*`, `argocd_kubectl_*`, `argocd_redis_*` | Go runtime, controller-runtime, workqueue |
| API server | `argocd_info`, `argocd_kubectl_*`, `argocd_redis_*`, `argocd_webhook_handlers_in_flight` | `grpc_server_*` counters, the bulk of its series |
| repo server | `argocd_git_*`, `argocd_repo_*`, `argocd_redis_*` | Go runtime |
| ApplicationSet controller | `argocd_kubectl_*` only | Go runtime, controller-runtime, workqueue |
| notifications controller | `argocd_webhook_handlers_in_flight` only | Go runtime |

### A missing source is a sync state, not a health state

An Application whose repo path does not exist reads
`sync_status="Unknown"` and `health_status="Healthy"` in
`argocd_app_info`, with a `ComparisonError` condition on the object. It
never syncs, so it has no `argocd_app_sync_total` series. Health describes
the resources Argo CD manages, and a source it cannot read manages none.
Alert on `sync_status` as well as on health.

### `argocd_app_info` is the only Application state series

There is no separate sync or health gauge. Count Applications by state
with `sum by (sync_status) (argocd_app_info)` and
`sum by (health_status) (argocd_app_info)`. `argocd_app_labels` and
`argocd_app_condition` are off unless configured on the controller.

## Key Alerts to Configure

Thresholds are a state read or relative to your own trailing baseline.
Reconcile and sync times depend on repo size and cluster size, so this
guide proposes no absolute latency numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0`, by job | An Argo CD component is down or unreachable. |
| `argocd_app_info{sync_status!="Synced"}` | `== 1` for 15 minutes, by `name` | An Application is out of sync or cannot be compared with Git. |
| `argocd_app_info{health_status=~"Degraded\|Missing"}` | `== 1` | Managed resources are unhealthy or absent. |
| `argocd_cluster_connection_status` | `== 0` | A destination cluster is unreachable; nothing syncs there. |
| `argocd_app_sync_total{phase=~"Error\|Failed"}` | `increase(...[30m]) > 0` | Syncs are failing. |
| `argocd_git_lsremote_fail_total` | `increase(...[15m]) > 0` | A repo is unreachable or a revision is gone. |
| `argocd_repo_pending_request_total` | above your trailing baseline | The repo server is a bottleneck. |
| `argocd_app_reconcile` | p95 above your trailing baseline | Reconciles are slowing down. |

## Access Setup

Every component serves `/metrics` on its own port with no
authentication. Which Services exist depends on how Argo CD was
installed.

### Manifest Install

The upstream `install.yaml` creates these Services in the `argocd`
namespace:

| Component | Service | Port |
| --- | --- | --- |
| application controller | `argocd-metrics` | 8082 |
| API server | `argocd-server-metrics` | 8083 |
| repo server | `argocd-repo-server` | 8084 |
| ApplicationSet controller | `argocd-applicationset-controller` | 8080 |
| notifications controller | `argocd-notifications-controller-metrics` | 9001 |

```bash showLineNumbers title="Verify access (manifest install)"
kubectl -n argocd port-forward svc/argocd-metrics 8082:8082 &
curl -s http://localhost:8082/metrics | grep argocd_app_info
```

### Helm Install

The `argo/argo-cd` chart creates no metrics Services by default. Enable
them:

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
applicationSet:
  metrics:
    enabled: true
notifications:
  metrics:
    enabled: true
```

With metrics enabled the chart creates `argocd-application-controller-metrics`
(8082), `argocd-server-metrics` (8083), `argocd-repo-server-metrics`
(8084), `argocd-applicationset-controller-metrics` (8080) and
`argocd-notifications-controller-metrics` (9001). Confirm with
`kubectl -n argocd get svc`.

## Configuration

One job per component. The targets below are the manifest install's
Services; substitute the Helm names from Access Setup.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: argocd-application-controller
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-metrics.argocd.svc:8082"]
        - job_name: argocd-server
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-server-metrics.argocd.svc:8083"]
        - job_name: argocd-repo-server
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-repo-server.argocd.svc:8084"]
        - job_name: argocd-applicationset-controller
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-applicationset-controller.argocd.svc:8080"]
        - job_name: argocd-notifications-controller
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-notifications-controller-metrics.argocd.svc:9001"]

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

The exporter name is `otlp_http` from contrib 0.144.0 on; the older
`otlphttp` spelling still works.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=argocd
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Kubernetes Service Discovery

To discover the metrics Services instead of naming them, use
`kubernetes_sd_configs` on the `argocd` namespace and keep the Services
whose names match either install:

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
                names: [argocd]
          relabel_configs:
            - source_labels: [__meta_kubernetes_service_name]
              regex: "argocd-metrics|argocd-server-metrics|argocd-repo-server|argocd-applicationset-controller|argocd-notifications-controller-metrics|argocd-application-controller-metrics|argocd-repo-server-metrics|argocd-applicationset-controller-metrics"
              action: keep
            - source_labels: [__meta_kubernetes_service_name]
              target_label: argocd_component
```

The Collector's ServiceAccount then needs `get`, `list` and `watch` on
`services`, `endpoints` and `pods` in that namespace.

### Keep the API server's gRPC counters out

The API server's registry is mostly `grpc_server_*` series, one per
method and status code, almost all 0. To keep the Argo CD families only:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
        - job_name: argocd-server
          scrape_interval: 30s
          static_configs:
            - targets: ["argocd-server-metrics.argocd.svc:8083"]
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "argocd_.*"
              action: keep
```

## Verify the Setup

```bash showLineNumbers
# One Application state series per Application
kubectl -n argocd port-forward svc/argocd-metrics 8082:8082 &
curl -s http://localhost:8082/metrics | grep -c '^argocd_app_info'

# Every job scraped
kubectl logs -n <collector-namespace> <collector-pod> | grep "Failed to scrape"
```

The first command prints your Application count. The second prints
nothing when all five jobs work.

In Scout, filter on the service name you set. `up` should be 1 for five
jobs, `argocd_app_info` should have one series per Application, and
`argocd_cluster_connection_status` should read 1 for each destination.

## Troubleshooting

### `up` is 0 and the connection is refused

**Cause**: The Service name does not match the install. The manifest and
Helm names differ for three of the five components.

**Fix**: `kubectl -n argocd get svc` and set the targets from
[Access Setup](#access-setup). On a Helm install, enable the metrics
Services first.

### An Application is Unknown but Healthy

**Cause**: Argo CD cannot read the source: the repo path or revision does
not exist, or the repo is unreachable. Health describes managed
resources, and there are none.

**Fix**: Read the Application's conditions with
`kubectl -n argocd get application <name> -o yaml`; a
`ComparisonError` names the cause. Alert on `sync_status`, not only on
health.

### No `argocd_app_*` series

**Cause**: No Application exists, or the controller job scrapes the wrong
component.

**Fix**: `kubectl -n argocd get applications`, and confirm the job targets
the application controller's Service.

### Network policies block the scrape

**Cause**: The upstream manifests create NetworkPolicies in the `argocd`
namespace.

**Fix**: Add a policy that allows ingress from the Collector's namespace
to the metrics ports.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Which component serves sync status?

The application controller. `argocd_app_info` on its port carries
`sync_status` and `health_status` for every Application. The API server
serves `argocd_info` and request counters only.

### How do I monitor Argo CD across several clusters?

One Argo CD instance manages many destinations. `argocd_cluster_info`
and `argocd_cluster_connection_status` carry a `server` label per
destination, and `argocd_app_info` carries `dest_server`. Scrape each
Argo CD control plane with its own set of jobs.

### Do I need to scrape the ApplicationSet and notifications controllers?

For their health, yes: `up` and the process metrics. They serve almost no
Argo CD families of their own; ApplicationSet activity shows up as
Applications on the controller.

### Does this work with Argo CD installed via Helm?

Yes, once the chart's metrics Services are enabled. Use the Helm Service
names from Access Setup, or the service discovery job, which matches
both.

## Related Guides

- [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
  - Run the Collector in the cluster.
- [OTel Collector Configuration](../../instrument/collector-setup/otel-collector-config.md)
  - Advanced collector configuration.
- [kube-state-metrics Monitoring](../../instrument/component/kube-state-metrics.md)
  - The state of the resources Argo CD deploys.
- [GitHub Actions Observability](./github-actions-observability.md) - The
  pipeline that feeds Git before Argo CD syncs it.
- [Creating Alerts](../creating-alerts-with-logx.md) - Alert on Argo CD
  metrics.

## What's Next?

- **Create Dashboards**: Start with Applications by sync and health
  status, sync failures and repo request latency. See
  [Create Your First Dashboard](../create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of reconcile and repo wait
  times, then fill in the relative alerts above.
- **Watch the deployed resources**: Pair this guide with
  kube-state-metrics for the pods behind each Application.
