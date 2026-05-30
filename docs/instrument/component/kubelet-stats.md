---
title: >
  Kubelet Stats OpenTelemetry Monitoring - Node, Pod,
  and Container Metrics
sidebar_label: Kubelet Stats
id: collecting-kubelet-stats-telemetry
sidebar_position: 46
description: >
  Collect Kubernetes node, pod, and container metrics with the
  OpenTelemetry Collector's kubeletstats receiver. Scrape the kubelet
  Summary API on each node and export to base14 Scout.
keywords:
  - kubelet opentelemetry
  - kubeletstats receiver
  - kubernetes node pod container metrics
  - k8s.pod.cpu.usage
  - kubernetes resource utilization
  - opentelemetry kubelet receiver
  - kubernetes observability
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why one Collector per node instead of one for the cluster?","acceptedAnswer":{"@type":"Answer","text":"The kubelet only reports containers running on its own node. A DaemonSet gives each Collector a local kubelet to scrape, which spreads the load and avoids cross-node network hops. A single Collector would have to reach every node's kubelet and would miss nodes it cannot route to."}},{"@type":"Question","name":"What is the difference between the kubeletstats receiver and the metrics-server?","acceptedAnswer":{"@type":"Answer","text":"The metrics-server aggregates a small CPU/memory set for the Horizontal Pod Autoscaler. The kubeletstats receiver reads the full kubelet Summary API - network, filesystem, working set, RSS, utilization - and ships it as OpenTelemetry metrics for long-term storage and querying."}},{"@type":"Question","name":"Why are volume metrics missing from the kubeletstats receiver?","acceptedAnswer":{"@type":"Answer","text":"k8s.volume.available and k8s.volume.capacity emit only for PVC-backed volumes. Pods using emptyDir or no volumes produce no volume metrics - this is expected."}},{"@type":"Question","name":"Does k8s.pod.cpu.utilization exist?","acceptedAnswer":{"@type":"Answer","text":"No. The receiver reports k8s.pod.cpu.usage (instantaneous usage) and k8s.pod.cpu_limit_utilization / k8s.pod.cpu_request_utilization (usage relative to the configured limit or request). There is no plain cpu.utilization metric."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# Kubelet Stats

The OpenTelemetry Collector's `kubeletstats` receiver scrapes the
kubelet Summary API on each node for node, pod, container, and volume
metrics - CPU and memory usage, network I/O, filesystem usage, and
limit/request utilization. It reads directly from the node's own
kubelet, so it reports actual runtime resource usage rather than the
desired state held in the API server.

Run one receiver per node (a DaemonSet) so each Collector instance
scrapes only its local kubelet. This guide configures the receiver, the
ServiceAccount it needs, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.34+       |
| OTel Collector Contrib | 0.90.0  | 0.152+      |
| base14 Scout           | Any     | -           |

Before starting:

- A ServiceAccount the Collector runs as, with read access to
  `nodes/stats` and `nodes/proxy` (see Access Setup below).
- OTel Collector Contrib deployed as a DaemonSet - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- At least one workload scheduled on the node. With no pods running,
  the pod and container metric groups stay empty - the kubelet only
  reports containers that exist on the node.

## What You'll Monitor

- **Node**: CPU usage and time, memory usage and working set, network
  I/O, filesystem usage, node uptime.
- **Pod**: CPU usage and time, CPU limit/request utilization, memory
  usage and working set, network I/O and errors, filesystem usage, pod
  uptime.
- **Container**: CPU usage and time, CPU and memory limit/request
  utilization, memory usage, working set and RSS, filesystem usage,
  container uptime.
- **Volume**: available and capacity bytes, reported only for
  PVC-backed volumes mounted by a pod.

Full metric reference:
[OTel Kubeletstats Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/kubeletstatsreceiver)

## Access Setup

The receiver authenticates to the kubelet with its ServiceAccount
token (`auth_type: serviceAccount`). Grant that ServiceAccount read
access to the kubelet stats endpoints with a ClusterRole:

```yaml showLineNumbers title="kubeletstats-rbac.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-kubeletstats
rules:
  - apiGroups: [""]
    resources: ["nodes/stats", "nodes/proxy"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-kubeletstats
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: observability
roleRef:
  kind: ClusterRole
  name: otel-kubeletstats
  apiGroup: rbac.authorization.k8s.io
```

The receiver discovers the local kubelet from the node name, which the
DaemonSet injects as an environment variable from the pod's
`spec.nodeName`:

```yaml showLineNumbers
env:
  - name: K8S_NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  kubeletstats:
    # Each DaemonSet pod scrapes its own node's kubelet.
    endpoint: ${env:K8S_NODE_NAME}:10250
    auth_type: serviceAccount
    collection_interval: 30s
    # Most managed kubelets serve the Summary API over a
    # self-signed cert; skip verification for the in-cluster scrape.
    insecure_skip_verify: true
    metric_groups:
      - container
      - pod
      - node
      - volume

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
      receivers: [kubeletstats]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

`K8S_NODE_NAME` is injected by the DaemonSet from `spec.nodeName` (see
Access Setup), not set in the `.env` file.

## Metrics Reference

### Node group

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.node.cpu.usage` | gauge | `1` | Instantaneous node CPU usage. |
| `k8s.node.cpu.time` | sum | `s` | Cumulative node CPU seconds. |
| `k8s.node.memory.usage` | gauge | `By` | Node memory in bytes. |
| `k8s.node.memory.working_set` | gauge | `By` | Non-reclaimable working set. |
| `k8s.node.network.io` | sum | `By` | Bytes over node interfaces. |
| `k8s.node.filesystem.usage` | gauge | `By` | Node filesystem usage. |
| `k8s.node.uptime` | sum | `s` | Seconds since node boot. |

### Pod group

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.pod.cpu.usage` | gauge | `1` | Instantaneous pod CPU usage. |
| `k8s.pod.cpu.time` | sum | `s` | Cumulative pod CPU seconds. |
| `k8s.pod.cpu_limit_utilization` | gauge | `1` | usage / CPU limit; emits only when a limit is set. |
| `k8s.pod.cpu_request_utilization` | gauge | `1` | usage / CPU request; emits only when a request is set. |
| `k8s.pod.memory.usage` | gauge | `By` | Pod memory in bytes. |
| `k8s.pod.memory.working_set` | gauge | `By` | Pod non-reclaimable working set. |
| `k8s.pod.network.io` | sum | `By` | Bytes over pod interfaces. |
| `k8s.pod.filesystem.usage` | gauge | `By` | Pod ephemeral filesystem usage. |
| `k8s.pod.uptime` | sum | `s` | Seconds since pod start. |

### Container group

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `container.cpu.usage` | gauge | `1` | Instantaneous container CPU usage. |
| `container.cpu.time` | sum | `s` | Cumulative container CPU seconds. |
| `container.memory.usage` | gauge | `By` | Container working memory. |
| `container.memory.working_set` | gauge | `By` | Non-reclaimable working set. |
| `container.memory.rss` | gauge | `By` | Resident set size. |
| `container.filesystem.usage` | gauge | `By` | Writable-layer filesystem usage. |
| `k8s.container.cpu_limit_utilization` | gauge | `1` | usage / CPU limit; emits only when a limit is set. |
| `k8s.container.cpu_request_utilization` | gauge | `1` | usage / CPU request; emits only when a request is set. |
| `k8s.container.memory_limit_utilization` | gauge | `1` | usage / memory limit; emits only when a limit is set. |

### Volume group

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.volume.available` | gauge | `By` | Available bytes; PVC-backed volumes only. |
| `k8s.volume.capacity` | gauge | `By` | Capacity in bytes; PVC-backed volumes only. |

The `*_limit_utilization` and `*_request_utilization` metrics only emit
when the workload sets the corresponding resource limit or request. Set
CPU and memory `requests` and `limits` on your pods to get them.

## Verify the Setup

Deploy the DaemonSet and check that metrics flow within 60 seconds.
The receiver may report metric definitions before any data points
arrive, so allow one or two collection intervals before treating an
empty result as a failure:

```bash showLineNumbers
# Confirm the Collector pods are running, one per node.
kubectl -n observability get pods -l app=otel-collector -o wide

# Check a Collector pod's logs for kubeletstats activity.
kubectl -n observability logs daemonset/otel-collector \
  | grep -i kubeletstats
```

A quick way to confirm the receiver is emitting is to add a `debug`
exporter (`verbosity: detailed`) to the metrics pipeline temporarily
and watch for a real metric name such as `k8s.pod.cpu.usage` in the
pod logs.

## Troubleshooting

### 401 or 403 scraping the kubelet

**Cause**: the Collector ServiceAccount lacks `nodes/stats` /
`nodes/proxy` access.

**Fix**:

1. Apply the ClusterRole and ClusterRoleBinding from Access Setup.
2. Confirm the DaemonSet's `serviceAccountName` matches the binding
   subject.
3. Check the binding namespace matches the ServiceAccount's namespace.

### x509 certificate error

**Cause**: the kubelet serves the Summary API with a self-signed cert
that the Collector does not trust.

**Fix**:

1. Set `insecure_skip_verify: true` in the receiver (the in-cluster
   scrape stays on the node-local network).
2. Alternatively, point the receiver at the cluster CA bundle if your
   kubelet certificate is signed by it.

### Pod and container metrics are empty

**Cause**: no workloads are scheduled on the node, or the receiver is
not reaching the kubelet.

**Fix**:

1. Confirm pods are running on the node:
   `kubectl get pods -A --field-selector spec.nodeName=<node>`.
2. Verify `K8S_NODE_NAME` resolves to the node's name inside the pod.
3. Confirm port `10250` is reachable from the Collector pod.

### Utilization metrics never appear

**Cause**: the `*_limit_utilization` and `*_request_utilization`
metrics need the workload to declare resource limits/requests.

**Fix**:

1. Set CPU and memory `requests` and `limits` on the monitored pods.
2. Re-check after one collection interval - they emit per container.

## FAQ

**Why one Collector per node instead of one for the cluster?**

The kubelet only reports containers running on its own node. A
DaemonSet gives each Collector a local kubelet to scrape, which spreads
the load and avoids cross-node network hops. A single Collector would
have to reach every node's kubelet and would miss nodes it cannot
route to.

**What is the difference between this and the metrics-server?**

The metrics-server aggregates a small CPU/memory set for the
Horizontal Pod Autoscaler. The `kubeletstats` receiver reads the full
kubelet Summary API - network, filesystem, working set, RSS,
utilization - and ships it as OpenTelemetry metrics for long-term
storage and querying.

**Why are volume metrics missing?**

`k8s.volume.available` and `k8s.volume.capacity` emit only for
PVC-backed volumes. Pods using `emptyDir` or no volumes produce no
volume metrics - this is expected.

**Does `k8s.pod.cpu.utilization` exist?**

No. The receiver reports `k8s.pod.cpu.usage` (instantaneous usage) and
`k8s.pod.cpu_limit_utilization` / `k8s.pod.cpu_request_utilization`
(usage relative to the configured limit/request). There is no plain
`*.cpu.utilization` metric.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for other workloads
  running on your cluster.
- **Fine-tune Collection**: Adjust `collection_interval` based on how
  quickly you need to see node and pod resource shifts.

## Related Guides

- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) —
  Deploy the Collector as a DaemonSet
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration

Validated against: managed Kubernetes 1.30, OTel Collector Contrib 0.152.0.
