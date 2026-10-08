---
title: >
  Kubelet Stats OpenTelemetry Monitoring - Node, Pod, Container Usage,
  Limit Utilization, and Collector Setup
sidebar_label: Kubelet Stats
id: collecting-kubelet-stats-telemetry
sidebar_position: 46
description: >
  Collect node, pod, container and volume usage from each kubelet with the
  OpenTelemetry Collector's kubelet_stats receiver. Monitor memory
  headroom, limit utilization and node disk in base14 Scout.
keywords:
  - kubelet opentelemetry
  - kubelet_stats receiver
  - kubeletstats receiver
  - kubernetes node pod container metrics
  - k8s.pod.cpu.usage
  - memory limit utilization kubernetes
  - opentelemetry kubelet receiver
  - kubernetes observability
---

# Kubelet Stats

The Collector's `kubelet_stats` receiver reads each node's kubelet for
what is running there now: CPU, memory, filesystem and network for the
node, every pod and every container, and space on every volume. It is
usage, not state: a container's working set and how close it is to its
limit, not whether it restarted or why. Run it as a DaemonSet so each
Collector scrapes its own node. This guide covers the RBAC, the receiver
configuration, the optional utilization metrics, the tiers and shipping
to base14 Scout.

For object state, replica counts, phases and restart reasons, pair this
receiver with the [K8s Cluster receiver](./k8s-cluster.md) or
[kube-state-metrics](./kube-state-metrics.md).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.36        |
| OTel Collector Contrib | 0.152.0 | Latest      |
| base14 Scout           | Any     | -           |

The Collector floor is the receiver name: `kubelet_stats` was
`kubeletstats` before contrib 0.152.0. Later versions still accept
`kubeletstats` and log a deprecation warning.

Before starting:

- `kubectl` access with permission to create a ClusterRole.
- The Collector deployed as a DaemonSet - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- A Scout account and OTLP endpoint.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

The receiver emits 42 metrics by default and 53 with the uptime and
utilization metrics turned on. Series scale with containers and volumes:
each pod adds its own set, each container its own, and each mounted
volume five.

### Core - is the node within limits

| Metric | Type | What it tells you |
| --- | --- | --- |
| `k8s.node.memory.available` | gauge | Memory the node has left. |
| `k8s.node.filesystem.available`, `k8s.node.filesystem.capacity` | gauge | Node filesystem free space and size. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `k8s.node.cpu.usage`, `k8s.node.memory.working_set` | gauge | Node CPU and non-reclaimable memory. |
| `k8s.node.memory.usage`, `k8s.node.filesystem.usage` | gauge | Node memory and filesystem in use. |
| `k8s.node.network.errors` | sum | Interface errors on the node, by `interface` and `direction`. |
| `k8s.pod.cpu.usage`, `k8s.pod.memory.working_set` | gauge | Pod CPU and working set. |
| `k8s.pod.memory.usage`, `k8s.pod.memory.available` | gauge | Pod memory in use and left under its limit. |
| `container.cpu.usage`, `container.memory.working_set` | gauge | Container CPU and working set. |
| `container.memory.usage`, `container.memory.available` | gauge | Container memory in use and left under its limit. |
| `k8s.container.memory_limit_utilization`, `k8s.container.cpu_limit_utilization` | gauge | Container usage as a fraction of its limit. Optional; see below. |
| `k8s.pod.memory_limit_utilization`, `k8s.pod.cpu_limit_utilization` | gauge | Pod usage as a fraction of its limits. Optional. |
| `k8s.volume.available`, `k8s.volume.capacity` | gauge | Free space and size per mounted volume. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `k8s.node.cpu.time`, `k8s.pod.cpu.time`, `container.cpu.time` | Cumulative CPU seconds. |
| `k8s.node.memory.rss`, `k8s.pod.memory.rss`, `container.memory.rss` | Resident set size. |
| `k8s.node.memory.page_faults`, `k8s.node.memory.major_page_faults`, the pod and container equivalents | Page fault counts. |
| `k8s.node.network.io`, `k8s.pod.network.io`, `k8s.pod.network.errors` | Bytes by `direction`, and pod interface errors. |
| `k8s.pod.filesystem.available`, `k8s.pod.filesystem.capacity`, `k8s.pod.filesystem.usage` | Pod ephemeral storage. |
| `container.filesystem.available`, `container.filesystem.capacity`, `container.filesystem.usage` | Container writable layer. |
| `k8s.volume.inodes`, `k8s.volume.inodes.free`, `k8s.volume.inodes.used` | Inodes per volume. |
| `k8s.container.memory_request_utilization`, `k8s.container.cpu_request_utilization`, `k8s.pod.memory_request_utilization`, `k8s.pod.cpu_request_utilization` | Usage as a fraction of the request. Optional. |
| `k8s.node.uptime`, `k8s.pod.uptime`, `container.uptime` | Seconds since start. Optional. |

### The utilization metrics are off by default

`k8s.container.memory_limit_utilization` and the other seven
`*_limit_utilization` and `*_request_utilization` metrics, and the three
`*.uptime` metrics, need enabling in the receiver's `metrics` block. The
utilization ones also need `k8s_api_config`, because the kubelet reports
usage and the requests and limits come from the pod specs in the API
server. A container with no limit has no `*_limit_utilization` series; one
with no request has no `*_request_utilization` series. The values are
fractions: a container using 3 MiB of a 64 MiB limit reads 0.046.

### `k8s_api_config` changes what a volume reports

Without `k8s_api_config`, a claim-backed volume reads
`k8s.volume.type=persistentVolumeClaim`. With it, the receiver resolves
the claim to its volume and reports the backing type instead, such as
`local` on a `local-path` volume. `k8s.persistentvolumeclaim.name` is
present either way, so group on it rather than on the type.

### Usage is here, reasons are not

A container that restarts shows up as a new set of series. The receiver
has no restart count and no termination reason. `OOMKilled` and
`ImagePullBackOff` come from the
[K8s Cluster receiver](./k8s-cluster.md) or
[kube-state-metrics](./kube-state-metrics.md).

### CPU usage starts on the second collection

From contrib 0.161.0, `k8s.node.cpu.usage`, `k8s.pod.cpu.usage` and
`container.cpu.usage` are computed from CPU time between two collections,
so they appear from the second interval onward.

### The bundled metrics-server reads the same endpoint

On distributions that ship metrics-server, such as K3s, it reads the same
kubelet summary this receiver reads, for the Horizontal Pod Autoscaler. A
dashboard that pulls from both counts the node twice. Keep this receiver as
the long-term record and leave metrics-server to the autoscaler.

## Key Alerts to Configure

Thresholds are a fraction of a limit or capacity, a state read, or
relative to your own trailing baseline.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `k8s.node.filesystem.available` / `k8s.node.filesystem.capacity` | below 10% | Most kubelets start evicting pods at 5% free. |
| `k8s.node.memory.available` | below your trailing baseline floor | Many distributions set no memory eviction threshold. |
| `k8s.container.memory_limit_utilization` | above 0.9 | The container is close to an OOM kill. Needs the optional metric; otherwise join `container.memory.working_set` on the limit from another receiver. |
| `k8s.container.cpu_limit_utilization` | above 0.9, sustained | The container is being throttled. |
| `k8s.node.network.errors` | `increase(...[10m]) > 0`, by `interface` | The node's network interface is dropping. |
| `k8s.volume.available` / `k8s.volume.capacity` | below 10% on claim-backed volumes | A persistent volume is filling. |

## Access Setup

The receiver authenticates to the kubelet with its service account token.
The kubelet's summary needs `nodes/stats`; `extra_metadata_labels` reads
the kubelet's `/pods` endpoint, which needs `nodes/proxy`; and
`k8s_api_config` reads pod specs, claims and volumes from the API server:

```yaml showLineNumbers title="rbac.yaml"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector
  namespace: otel
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector
rules:
  - apiGroups: [""]
    resources: [nodes/stats, nodes/metrics, nodes/proxy]
    verbs: [get]
  - apiGroups: [""]
    resources: [nodes, pods, persistentvolumeclaims, persistentvolumes]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-collector
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: otel
```

Without `nodes/proxy`, a receiver with `extra_metadata_labels` collects
nothing and logs `call to /pods endpoint failed`. Without the claim and
volume rules, a receiver with `k8s_api_config` drops every claim-backed
volume and logs `Failed to gather additional volume metadata`.

Run the Collector as a DaemonSet and pass each node's IP in from the pod
spec:

```yaml showLineNumbers title="daemonset.yaml (pod spec excerpt)"
spec:
  serviceAccountName: otel-collector
  tolerations:
    - operator: Exists
  containers:
    - name: otel-collector
      image: otel/opentelemetry-collector-contrib:latest
      env:
        - name: K8S_NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: K8S_NODE_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  kubelet_stats:
    collection_interval: 30s
    auth_type: serviceAccount
    endpoint: https://${env:K8S_NODE_IP}:10250
    insecure_skip_verify: true
    metric_groups: [node, pod, container, volume]
    extra_metadata_labels: [container.id, k8s.volume.type]
    k8s_api_config:
      auth_type: serviceAccount
    metrics:
      k8s.container.memory_limit_utilization:
        enabled: true
      k8s.container.cpu_limit_utilization:
        enabled: true
      k8s.pod.memory_limit_utilization:
        enabled: true
      k8s.pod.cpu_limit_utilization:
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
      receivers: [kubelet_stats]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Most kubelets serve a certificate from the cluster's own CA, hence
`insecure_skip_verify`. Add the four `*_request_utilization` metrics and
the three `*.uptime` metrics to the `metrics` block the same way when you
want them. The exporter name is `otlp_http` from contrib 0.144.0 on; the
older `otlphttp` spelling still works.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=kubelet-stats
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

`K8S_NODE_NAME` and `K8S_NODE_IP` come from the DaemonSet pod spec, not
from `.env`.

## Verify the Setup

```bash showLineNumbers
# One Collector per node
kubectl -n otel get pods -o wide

# The receiver collects without errors
kubectl -n otel logs <collector-pod> | grep -iE "endpoint failed|Failed to gather|error"
```

The second command prints nothing when the RBAC is complete. Allow two
intervals before judging: the CPU usage metrics need two collections.

In Scout, filter on the service name you set. `k8s.node.memory.available`
should have one series per node, `k8s.pod.cpu.usage` one per pod on each
node, and `k8s.container.memory_limit_utilization` one per container
with a memory limit.

## Troubleshooting

### Nothing is collected and the log says `call to /pods endpoint failed`

**Cause**: `extra_metadata_labels` is set and the ClusterRole lacks
`nodes/proxy`.

**Fix**: Add `nodes/proxy` to the `get` rule and restart the Collector.

### Claim-backed volumes are missing with `Failed to gather additional volume metadata`

**Cause**: `k8s_api_config` is set and the ClusterRole lacks
`persistentvolumeclaims` and `persistentvolumes`.

**Fix**: Add both to the `get`, `list`, `watch` rule.

### The scrape returns 401 or 403

**Cause**: The service account has no token mounted, or its ClusterRole
lacks `nodes/stats`.

**Fix**: Apply the RBAC above and confirm the DaemonSet's
`serviceAccountName` matches the binding.

### x509 certificate error

**Cause**: The kubelet serves a certificate the Collector does not trust.

**Fix**: Set `insecure_skip_verify: true`, or point the receiver at the
cluster CA when the kubelet certificate is signed by it.

### Utilization metrics never appear

**Cause**: They are off by default, `k8s_api_config` is missing, or the
workload sets no requests and limits.

**Fix**: Enable them in the `metrics` block, add `k8s_api_config` and the
`pods` rule, and set resources on the pods.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the metrics pipeline includes the receiver and the exporter.

## FAQ

### Why one Collector per node instead of one for the cluster?

The kubelet reports only the containers on its own node. A DaemonSet gives
each Collector a local kubelet; one Collector would have to reach every
kubelet across the network.

### What is the difference between this receiver and metrics-server?

metrics-server reads the same kubelet summary and keeps a small CPU and
memory set for the autoscaler. This receiver ships the whole summary, with
network, filesystem, working set and utilization, for storage and
querying.

### Why are volume metrics missing for some pods?

`k8s.volume.*` series exist per mounted volume, including `configMap`,
`emptyDir` and `secret` volumes. A pod with no volumes has none. On
`local-path` volumes the capacity is the node disk's.

### Is there a plain pod CPU utilization metric?

No. The receiver reports `k8s.pod.cpu.usage` and, when enabled,
`k8s.pod.cpu_limit_utilization` and `k8s.pod.cpu_request_utilization`,
each a fraction of the matching limit or request.

## Related Guides

- [K8s Cluster Monitoring](./k8s-cluster.md) - Object state from the API
  server: phases, replicas, restarts.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - State with
  reasons, conditions and labels.
- [K3s Monitoring](./k3s.md) - Running this receiver on K3s, with its
  control plane metrics.
- [k8X](../../operate/k8x/getting-started.md) - Explore this telemetry as
  clusters, nodes, namespaces and workloads in Scout.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector as a DaemonSet.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  node and container headroom.

## What's Next?

- **Create Dashboards**: Start with node memory and disk headroom, then
  container memory against limit. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of node memory, then fill in
  the relative alert above.
- **Add state**: Pair this guide with the K8s Cluster receiver or
  kube-state-metrics for restarts and reasons.
