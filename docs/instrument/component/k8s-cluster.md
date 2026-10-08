---
title: >
  Kubernetes Cluster OpenTelemetry Monitoring - Deployment, Pod, Node
  State, Events, and Collector Setup
sidebar_label: K8s Cluster
id: collecting-k8s-cluster-telemetry
sidebar_position: 47
description: >
  Collect cluster-level Kubernetes state with the OpenTelemetry Collector's
  k8s_cluster receiver and events as logs with k8sobjects. Monitor replica
  health, pod phases, restarts and node conditions in base14 Scout.
keywords:
  - kubernetes cluster opentelemetry
  - k8s_cluster receiver
  - kubernetes object state metrics
  - k8s.deployment.available
  - k8s.container.restarts
  - kubernetes events as logs
  - k8sobjects receiver
  - kubernetes observability
---

# K8s Cluster

The Collector's `k8s_cluster` receiver watches the API server and turns
object state into metrics: replicas available against desired, pod phases,
container restarts, node conditions, autoscaler and job progress. It needs
nothing deployed in the cluster beyond the Collector. Alongside it, the
`k8sobjects` receiver turns Kubernetes events into log records, which is
where reasons such as `OOMKilled` and `ImagePullBackOff` appear as text.
Run one Collector replica for both; the API server holds the whole
cluster. This guide covers the RBAC, both receivers, the tiers and
shipping to base14 Scout.

For usage per node and pod, pair this guide with
[Kubelet Stats](./kubelet-stats.md). For reasons as metrics, conditions by
name and object labels, see [kube-state-metrics](./kube-state-metrics.md).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.36        |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The Collector floor is about component names: the `otlp_http` exporter
was `otlphttp` before contrib 0.149.0.

Before starting:

- `kubectl` access with permission to create a ClusterRole.
- The Collector deployed as a one-replica Deployment - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- A Scout account and OTLP endpoint.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

The receiver emits 38 metrics by default and 40 with `k8s.pod.status_reason`
and `k8s.node.condition` turned on. Series scale with objects: one per
deployment, replicaset, pod, container, job and node.

### Core - are workloads where they should be

| Metric | Type | What it tells you |
| --- | --- | --- |
| `k8s.node.condition_ready` | gauge | 1 when the node's Ready condition is true. |
| `k8s.deployment.available`, `k8s.deployment.desired` | gauge | Available replicas against the spec, per Deployment. |
| `k8s.pod.phase` | gauge | The pod's phase as an integer: Pending 1, Running 2, Succeeded 3, Failed 4, Unknown 5. |
| `k8s.container.restarts` | gauge | Restarts per container. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `k8s.container.ready` | gauge | 1 when the container's readiness probe passes. |
| `k8s.job.failed_pods`, `k8s.job.active_pods` | gauge | Pods of a Job that failed, and that are running. |
| `k8s.daemonset.ready_nodes`, `k8s.daemonset.desired_scheduled_nodes`, `k8s.daemonset.misscheduled_nodes` | gauge | DaemonSet pods ready against the nodes that need one. |
| `k8s.statefulset.ready_pods`, `k8s.statefulset.desired_pods` | gauge | StatefulSet pods ready against the spec. |
| `k8s.hpa.current_replicas`, `k8s.hpa.desired_replicas`, `k8s.hpa.max_replicas` | gauge | Where an autoscaler is against its ceiling. |
| `k8s.replicaset.available`, `k8s.replicaset.desired` | gauge | ReplicaSet replicas, one per revision of a Deployment. |
| `k8s.node.condition_memory_pressure`, `k8s.node.condition_disk_pressure`, `k8s.node.condition_pid_pressure` | gauge | 1 when the node reports pressure. |
| `k8s.node.allocatable_cpu`, `k8s.node.allocatable_memory`, `k8s.node.allocatable_pods` | gauge | What the node can schedule. |
| `k8s.pod.status_reason` | gauge | The node-level reason a pod is not running, as an integer. Optional; see below. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `k8s.container.cpu_request`, `k8s.container.cpu_limit`, `k8s.container.memory_request`, `k8s.container.memory_limit` | Requests and limits per container, the denominators for usage ratios from Kubelet Stats. |
| `k8s.job.desired_successful_pods`, `k8s.job.successful_pods`, `k8s.job.max_parallel_pods` | Job sizing and progress. |
| `k8s.cronjob.active_jobs` | Jobs a CronJob has running. |
| `k8s.hpa.min_replicas` | The autoscaler's floor. |
| `k8s.statefulset.current_pods`, `k8s.statefulset.updated_pods` | StatefulSet rollout progress. |
| `k8s.daemonset.current_scheduled_nodes` | DaemonSet pods scheduled. |
| `k8s.node.allocatable_ephemeral_storage` | Ephemeral storage the node can schedule. |
| `k8s.namespace.phase` | Active 1, Terminating 0. |
| `k8s.node.condition` | One family with a `condition` attribute, alongside the `k8s.node.condition_*` families. Optional. |

### Phases and reasons are integers

`k8s.pod.phase` reads Pending 1, Running 2, Succeeded 3, Failed 4,
Unknown 5. `k8s.pod.status_reason`, once enabled, reads Evicted 1,
NodeAffinity 2, NodeLost 3, Shutdown 4, UnexpectedAdmissionError 5 and
Unknown 6. On a healthy cluster every pod reads 6: the reason covers
node-level evictions, not image pull or crash failures. Map the integers
back to names in dashboards.

### The termination reason is a resource attribute, not a metric

With the `k8s.container.status.last_terminated_reason` resource attribute
enabled, every container's series carry why it last died: `OOMKilled` on
a container the kernel killed for memory, `Error` on one that exited
non-zero, empty on one that never did. Group `k8s.container.restarts` by
it to tell OOM kills from crash loops. Without it, the receiver counts
restarts and says nothing about the cause.

### Events carry the rest

Image pull failures, crash loops, evictions and failed Jobs each raise a
Kubernetes event with a `reason` such as `ImagePullBackOff`,
`CrashLoopBackOff`, `OOMKilled`, `Evicted` or `BackoffLimitExceeded`. The
`k8sobjects` receiver ships them as log records; see
[Collecting logs](#collecting-logs).

### One replica, not two

The receiver reports every object in the cluster. A second Collector
replica reports every object twice. Run one, and let the Deployment
restart it.

## Key Alerts to Configure

Thresholds are a state read or a comparison between two gauges.
Durations are the only knob; set them to the time your rollouts take.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `k8s.node.condition_ready` | `== 0` for one interval | A node is NotReady. |
| `k8s.deployment.available` | `< k8s.deployment.desired` for 10 minutes | A rollout is stuck or pods are failing. |
| `k8s.container.restarts` | `increase(...[15m]) > 0` | A crash loop or an OOM kill; group by the termination reason attribute. |
| `k8s.pod.phase` | `== 1` for 10 minutes | A pod is Pending: unschedulable or waiting on an image. |
| `k8s.job.failed_pods` | `> 0` | A Job exhausted its backoff. |
| `k8s.node.condition_memory_pressure`, `k8s.node.condition_disk_pressure` | `== 1` | The kubelet is evicting. |
| `k8s.hpa.current_replicas` | `== k8s.hpa.max_replicas`, sustained | The autoscaler is at its ceiling. |

## Access Setup

The receiver authenticates to the API server with its service account
token and needs `get`, `list` and `watch` on every kind it reports. The
events rule serves the `k8sobjects` receiver as well:

```yaml showLineNumbers title="rbac.yaml"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-cluster
  namespace: otel
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-cluster
rules:
  - apiGroups: [""]
    resources:
      - events
      - namespaces
      - namespaces/status
      - nodes
      - nodes/spec
      - pods
      - pods/status
      - replicationcontrollers
      - replicationcontrollers/status
      - resourcequotas
      - services
      - endpoints
      - persistentvolumes
      - persistentvolumeclaims
    verbs: [get, list, watch]
  - apiGroups: [apps]
    resources: [daemonsets, deployments, replicasets, statefulsets]
    verbs: [get, list, watch]
  - apiGroups: [batch]
    resources: [jobs, cronjobs]
    verbs: [get, list, watch]
  - apiGroups: [autoscaling]
    resources: [horizontalpodautoscalers]
    verbs: [get, list, watch]
  - apiGroups: [events.k8s.io]
    resources: [events]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-cluster
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-cluster
subjects:
  - kind: ServiceAccount
    name: otel-cluster
    namespace: otel
```

A missing rule shows as an informer cache sync timeout in the Collector
log, naming the kind. Run the Collector as a one-replica Deployment with
`serviceAccountName: otel-cluster`.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  k8s_cluster:
    auth_type: serviceAccount
    collection_interval: 30s
    node_conditions_to_report: [Ready, MemoryPressure, DiskPressure, PIDPressure]
    allocatable_types_to_report: [cpu, memory, ephemeral-storage, pods]
    metrics:
      k8s.pod.status_reason:
        enabled: true
    resource_attributes:
      k8s.container.status.last_terminated_reason:
        enabled: true

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
      receivers: [k8s_cluster]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

`node_conditions_to_report` names the `k8s.node.condition_*` families
and `allocatable_types_to_report` the `k8s.node.allocatable_*` ones. The
exporter name is `otlp_http` from contrib 0.144.0 on; the older
`otlphttp` spelling still works.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=k8s-cluster
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Collecting logs

Add the `k8sobjects` receiver in watch mode on the Events API and a logs
pipeline. Each event becomes one log record whose body is the Event
object: `reason`, `note`, `regarding`, `type` and the count the API
server keeps for repeated events. The resource carries
`k8s.namespace.name`.

```yaml showLineNumbers title="config/otel-collector.yaml (events)"
receivers:
  k8sobjects:
    auth_type: serviceAccount
    objects:
      - name: events
        mode: watch
        group: events.k8s.io

service:
  pipelines:
    logs:
      receivers: [k8sobjects]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Watch mode ships events as they happen. A busy cluster raises several a
second during rollouts; the batch processor absorbs that.

## Verify the Setup

```bash showLineNumbers
# One replica
kubectl -n otel get pods -l app=otel-cluster

# No informer timeouts, no watch errors
kubectl -n otel logs deployment/otel-cluster | grep -iE "timeout|error"
```

The second command prints nothing when the RBAC is complete. Allow one
interval before judging; the receiver lists every kind once at start.

In Scout, filter on the service name you set. `k8s.node.condition_ready`
should have one series per node, `k8s.deployment.available` one per
Deployment, and the logs view should show an event record for each pod
start.

## Troubleshooting

### Informer cache sync timeout on startup

**Cause**: The ClusterRole lacks `get`, `list` or `watch` on the kind
named in the message.

**Fix**: Add the rule for that kind's API group and restart the
Collector.

### Restarts rise but every reason reads the same

**Cause**: `k8s.pod.status_reason` covers node-level evictions only, so it
reads Unknown, 6, for image pull and crash failures.

**Fix**: Enable the `k8s.container.status.last_terminated_reason` resource
attribute for container deaths, and read the events for pull failures.

### HPA or Job metrics never appear

**Cause**: Those families exist only while an HPA or Job object does.

**Fix**: `kubectl get hpa,jobs -A`, and confirm the `autoscaling` and
`batch` rules are in the ClusterRole.

### Every object is reported twice

**Cause**: The Collector runs with more than one replica, or a second
Collector carries the same receiver.

**Fix**: Run one replica.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipelines include the receivers and the exporter.

## FAQ

### When should I use this receiver instead of kube-state-metrics?

When you want object state with nothing to deploy. kube-state-metrics
adds the reasons as metrics, conditions by name, labels for joins and
about six times the series. Many clusters run both; keep them apart by
service name.

### Why one Collector for the cluster instead of one per node?

The receiver reads the API server, which holds every object. One
Collector sees everything; one per node would repeat it.

### Why is `k8s.pod.phase` a number?

The receiver encodes phase as an integer so it can be stored as a gauge:
Pending 1, Running 2, Succeeded 3, Failed 4, Unknown 5.

### Do I need the events stream?

No. The metrics stand on their own. The events add the reasons behind
state changes as text, which the metrics do not carry.

## Related Guides

- [Kubelet Stats Monitoring](./kubelet-stats.md) - Usage per node, pod
  and container, the other half of this picture.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - State with
  reasons, conditions and labels.
- [K3s Monitoring](./k3s.md) - The control plane metrics this receiver
  does not carry.
- [k8X](../../operate/k8x/getting-started.md) - Explore this telemetry as
  clusters, nodes, namespaces and workloads in Scout.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector in the cluster.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  cluster state.

## What's Next?

- **Create Dashboards**: Start with deployments below spec, pods by
  phase, restarts by termination reason and node conditions. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your durations**: Take a week of rollout times, then set the
  alert durations above.
- **Add usage**: Pair this guide with Kubelet Stats for the usage behind
  the requests and limits.
