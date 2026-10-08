---
title: >
  kube-state-metrics OpenTelemetry Monitoring - Pod Phases, Restarts,
  Replica Health, and Collector Setup
sidebar_label: kube-state-metrics
id: collecting-kube-state-metrics-telemetry
sidebar_position: 49
description: >
  Collect kube_* object state metrics from kube-state-metrics with the
  OpenTelemetry Collector. Monitor pod phases, restart reasons, replica
  health, node conditions and job failures in base14 Scout.
keywords:
  - kube-state-metrics opentelemetry
  - ksm otel collector
  - kubernetes state metrics
  - kube_pod_status_phase
  - kube_pod_container_status_restarts_total
  - kubernetes object metrics
  - ksm prometheus
  - kubernetes observability
---

# kube-state-metrics

kube-state-metrics serves Prometheus-format metrics for the state of
Kubernetes objects: pods, containers, deployments, nodes, jobs,
autoscalers and the rest. It is the one Kubernetes metrics source that
carries the reasons behind a state, such as `OOMKilled` on a terminated
container or `ImagePullBackOff` on a waiting one. The Collector's
`prometheus` receiver scrapes its Service on port 8080 and ships the
`kube_*` series to base14 Scout. This guide covers the endpoint, the
Collector configuration, the tiers and what each state metric means.

Two other sources report Kubernetes state. The Collector's own
[K8s Cluster receiver](./k8s-cluster.md) needs no exporter and emits a
fixed set of counts and phases; the
[Kubelet Stats receiver](./kubelet-stats.md) reports resource usage per
node. Use kube-state-metrics when you need reasons, conditions and labels
on the objects.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.36        |
| kube-state-metrics     | 2.10    | 2.20        |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The metric names in this guide are the 2.20 names. The Collector floor is
about component names: the `otlp_http` exporter was `otlphttp` before
contrib 0.149.0.

Before starting:

- kube-state-metrics deployed in the cluster from the
  [upstream standard manifests](https://github.com/kubernetes/kube-state-metrics/tree/main/examples/standard)
  or the Helm chart.
- A Collector running in the cluster that can reach the kube-state-metrics
  Service - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md). One
  replica is enough; the scrape is cluster-wide.
- A Scout account and OTLP endpoint.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

Expect around 240 families. Series scale with objects: every pod carries
one series per phase, per condition and per QoS class, most of them 0, so
`kube_pod_status_phase`, `kube_pod_status_scheduled`,
`kube_pod_status_qos_class`, `kube_pod_tolerations` and
`kube_pod_status_ready` are the largest families on any cluster.

### Core - are nodes ready and are workloads where they should be

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 when the Collector scraped kube-state-metrics. |
| `kube_node_status_condition` | gauge | One series per node, `condition` and `status`. `condition="Ready",status="true"` reads 1 on a healthy node. |
| `kube_pod_status_phase` | gauge | One series per pod and `phase`; the current phase reads 1. |
| `kube_pod_container_status_restarts_total` | counter | Restarts per container. |
| `kube_deployment_status_replicas_available`, `kube_deployment_spec_replicas` | gauge | Available replicas against the spec. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `kube_pod_container_status_waiting_reason` | gauge | Why a container is waiting: `ImagePullBackOff`, `CrashLoopBackOff`, `CreateContainerConfigError`. |
| `kube_pod_container_status_last_terminated_reason` | gauge | Why a container last died: `OOMKilled`, `Error`, `Completed`. |
| `kube_pod_status_unschedulable` | gauge | 1 while the scheduler cannot place the pod. |
| `kube_pod_status_ready` | gauge | The pod's Ready condition, by `condition`. |
| `kube_job_failed`, `kube_job_status_failed` | gauge | A Job past its backoff limit, and its failed pods by `reason`. |
| `kube_cronjob_status_active` | gauge | Jobs a CronJob has running. |
| `kube_daemonset_status_number_ready`, `kube_daemonset_status_desired_number_scheduled` | gauge | DaemonSet pods ready against the nodes that need one. |
| `kube_statefulset_status_replicas_ready`, `kube_statefulset_status_replicas` | gauge | StatefulSet pods ready against the spec. |
| `kube_horizontalpodautoscaler_status_current_replicas`, `kube_horizontalpodautoscaler_status_desired_replicas`, `kube_horizontalpodautoscaler_spec_max_replicas` | gauge | Where an autoscaler is against its ceiling. |
| `kube_persistentvolumeclaim_status_phase`, `kube_persistentvolume_status_phase` | gauge | Claims and volumes by `phase`: `Bound`, `Pending`, `Lost`. |
| `kube_node_spec_unschedulable` | gauge | 1 on a cordoned node. |
| `kube_pod_container_resource_requests`, `kube_pod_container_resource_limits` | gauge | Requests and limits per container by `resource`, the denominators for usage ratios from other receivers. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `kube_pod_info`, `kube_node_info`, `kube_deployment_labels`, the other `*_info` and `*_labels` families | Identity and labels, for joins. |
| `kube_pod_created`, `kube_deployment_created`, the other `*_created` families | Object age. |
| `kube_pod_tolerations`, `kube_pod_status_qos_class`, `kube_pod_owner` | Scheduling and ownership detail. |
| `kube_secret_info`, `kube_configmap_info`, `kube_service_info`, `kube_endpointslice_info`, `kube_networkpolicy_labels`, `kube_lease_owner`, `kube_storageclass_info`, `kube_namespace_status_phase` | Object inventory. |
| `kube_replicaset_status_replicas`, `kube_replicaset_spec_replicas` | ReplicaSet counts behind each Deployment. |

### Reasons are here and nowhere else

The Collector's K8s Cluster receiver and the kubelet know that a
container restarted. Only kube-state-metrics says why:
`kube_pod_container_status_last_terminated_reason{reason="OOMKilled"}`
reads 1 on a container the kernel killed for memory, and
`kube_pod_container_status_waiting_reason{reason="ImagePullBackOff"}` on
one whose image cannot be pulled. Both are gauges that read 1 while the
reason holds.

### A Job that fails reads two ways

`kube_job_failed{condition="true"}` reads 1 once a Job has exhausted its
backoff limit, and `kube_job_status_failed` counts its failed pods with
`reason="BackoffLimitExceeded"`. Alert on the first; read the second for
the cause.

### Where the series come from

Every pod has five `kube_pod_status_phase` series, one per phase, and a
series per condition and per QoS class. A cluster with a thousand pods
carries about five thousand phase series alone. The `_info`, `_labels`
and `_created` families add one series per object.

## Key Alerts to Configure

Thresholds are a state read or a comparison between two gauges.
Durations are the only knob; set them to the time your rollouts take.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0` | kube-state-metrics is down or unreachable. |
| `kube_node_status_condition{condition="Ready",status="true"}` | `== 0` | A node is NotReady. |
| `kube_pod_container_status_restarts_total` | `increase(...[15m]) > 0` | A crash loop. Join `kube_pod_container_status_last_terminated_reason` for `OOMKilled` or `Error`. |
| `kube_pod_container_status_waiting_reason{reason=~"ImagePullBackOff\|CrashLoopBackOff\|CreateContainerConfigError"}` | `== 1` for 10 minutes | A container cannot start. |
| `kube_pod_status_unschedulable` | `== 1` for 10 minutes | No node fits the pod. |
| `kube_deployment_status_replicas_available` | `< kube_deployment_spec_replicas` for 10 minutes | A rollout is stuck or pods are failing. |
| `kube_job_failed{condition="true"}` | `== 1` | A Job exhausted its backoff. |
| `kube_persistentvolumeclaim_status_phase{phase="Pending"}` | `== 1` for 10 minutes | No provisioner bound the claim. |
| `kube_horizontalpodautoscaler_status_current_replicas` | `== kube_horizontalpodautoscaler_spec_max_replicas`, sustained | The autoscaler is at its ceiling. |

## Access Setup

kube-state-metrics authenticates nothing on its metrics port. The
standard manifests deploy it in `kube-system` with a Service named
`kube-state-metrics` on port 8080 for `/metrics` and 8081 for its own
telemetry, and a ClusterRole that grants it `list` and `watch` on every
object kind it reports. The Collector needs no RBAC of its own for this
scrape, only network reach to the Service.

```bash showLineNumbers
kubectl apply -k https://github.com/kubernetes/kube-state-metrics/examples/standard?ref=v2.20.0
kubectl -n kube-system get svc kube-state-metrics
```

The Helm chart installs into its own namespace by default; adjust the
target below to match.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: kube-state-metrics
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:KSM_ADDRESS}

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

Run one Collector replica for this scrape; a second one doubles every
series. The exporter name is `otlp_http` from contrib 0.144.0 on; the
older `otlphttp` spelling still works.

### Environment Variables

```bash showLineNumbers title=".env"
KSM_ADDRESS=kube-state-metrics.kube-system.svc:8080
SERVICE_NAME=kube-state-metrics
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

```bash showLineNumbers
# The endpoint serves state series
kubectl -n kube-system port-forward svc/kube-state-metrics 8080:8080 &
curl -s http://localhost:8080/metrics | grep -c '^kube_pod_status_phase'

# The Collector scrapes without errors
kubectl logs -n <collector-namespace> <collector-pod> | grep "Failed to scrape"
```

The first command prints five times your pod count. The second prints
nothing when the scrape works.

In Scout, filter on the service name you set. `up` should be 1,
`kube_node_status_condition` should have a series per node and
condition, and `kube_pod_status_phase{phase="Running"}` should sum to
your running pod count.

## Troubleshooting

### `up` is 0 and the connection is refused

**Cause**: The target does not match the Service, usually the namespace.
The standard manifests use `kube-system`; the Helm chart uses its own.

**Fix**: `kubectl get svc -A | grep kube-state-metrics` and set
`KSM_ADDRESS` to that Service and port 8080.

### A family is present with no data points

**Cause**: kube-state-metrics lacks `list` and `watch` on that object
kind, or the kind does not exist in the cluster.

**Fix**: Check its logs for `forbidden`, and compare its ClusterRole with
the standard manifests.

### Restarts rise but no reason is set

**Cause**: `kube_pod_container_status_last_terminated_reason` reads 1
only while the last termination's reason is one it reports.

**Fix**: Read `kube_pod_container_status_waiting_reason` as well; a crash
loop alternates between `CrashLoopBackOff` and a terminated `Error`.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Which port does kube-state-metrics use for metrics?

Port 8080 serves the `kube_*` series and `/livez`; port 8081 serves
kube-state-metrics' own telemetry and `/readyz`. Scrape 8080.

### When should I use kube-state-metrics instead of the K8s Cluster receiver?

When you need the reason behind a state, conditions by name, labels for
joins, or object kinds the receiver does not cover. The receiver is
enough for replica counts, phases and restarts, and needs nothing
deployed.

### What does `kube_pod_status_phase` report?

One series per pod per phase. The current phase reads 1 and the other
four read 0, so summing `phase="Running"` gives the running pod count.

### How do I monitor a Job's success?

`kube_job_failed{condition="true"}` reads 1 when a Job exhausts its
backoff limit, and `kube_job_status_failed` carries the `reason`.

## Related Guides

- [K8s Cluster Monitoring](./k8s-cluster.md) - The Collector's own object
  state receiver, no exporter to run.
- [Kubelet Stats Monitoring](./kubelet-stats.md) - Resource usage per
  node, pod and container.
- [K3s Monitoring](./k3s.md) - The control plane metrics kube-state-metrics
  does not carry.
- [k8X](../../operate/k8x/getting-started.md) - Explore this telemetry as
  clusters, nodes, namespaces and workloads in Scout.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector in the cluster.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  kube-state-metrics series.

## What's Next?

- **Create Dashboards**: Start with pods by phase, restarts with their
  reasons, and deployments below spec. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your durations**: Take a week of rollout times, then set the
  alert durations above.
- **Add usage**: Pair this guide with kubelet stats for the usage behind
  the requests and limits.
