---
title: >
  Kubernetes Cluster OpenTelemetry Monitoring - Deployment, Pod,
  and Node State Metrics
sidebar_label: K8s Cluster
id: collecting-k8s-cluster-telemetry
sidebar_position: 47
description: >
  Collect cluster-level Kubernetes metrics with the OpenTelemetry
  Collector's k8s_cluster receiver. Watch deployments, pods, nodes,
  HPAs, and jobs from the API server and export to base14 Scout.
keywords:
  - kubernetes cluster opentelemetry
  - k8s_cluster receiver
  - kubernetes object state metrics
  - k8s.deployment.available
  - k8s.hpa.current_replicas
  - kubernetes events as logs
  - opentelemetry k8sobjects receiver
  - kubernetes observability
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why one Collector for the cluster instead of one per node?","acceptedAnswer":{"@type":"Answer","text":"The k8s_cluster receiver reads from the API server, which holds the state of every object in the cluster. A single Collector sees everything; running one per node would produce duplicate metrics for the same cluster-scope objects."}},{"@type":"Question","name":"What is the difference between the k8s_cluster receiver and the kubeletstats receiver?","acceptedAnswer":{"@type":"Answer","text":"The k8s_cluster receiver reports object state from the API server - replica counts, phases, conditions. The kubeletstats receiver reads each node's kubelet for actual runtime resource usage - CPU, memory, network, filesystem. They are complementary: state versus usage."}},{"@type":"Question","name":"Why is k8s.pod.phase a number?","acceptedAnswer":{"@type":"Answer","text":"The receiver encodes phase as an integer (1=Pending, 2=Running, 3=Succeeded, 4=Failed, 5=Unknown) so it can be stored and queried as a gauge. Map the value back to the phase name when building dashboards."}},{"@type":"Question","name":"Do I need the Kubernetes events stream?","acceptedAnswer":{"@type":"Answer","text":"No. Metrics work on their own. The k8sobjects events-to-logs stream is optional and useful when you want scheduling, scaling, and probe events alongside the state metrics."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# K8s Cluster

The OpenTelemetry Collector's `k8s_cluster` receiver watches the
Kubernetes API server and synthesizes cluster-level metrics from object
state - deployment and replicaset replica counts, pod phases, node
conditions, HPA replicas, and job progress. It reports the desired and
observed state the API server holds, not per-node runtime usage (that
is the `kubeletstats` receiver's job).

Run a single Collector for the cluster (a Deployment, not a DaemonSet):
the receiver reads from the API server, so one instance sees the whole
cluster. This guide configures the receiver, the ServiceAccount it
needs, an optional events-to-logs stream, and ships everything to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.34+       |
| OTel Collector Contrib | 0.90.0  | 0.152+      |
| base14 Scout           | Any     | -           |

Before starting:

- A ServiceAccount the Collector runs as, with `get`/`list`/`watch` on
  the cluster-shape resources the receiver counts (see Access Setup
  below).
- OTel Collector Contrib deployed as a single-replica Deployment - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- At least one Deployment in the cluster. With no workloads, the
  deployment, replicaset, and pod metric families stay empty - the
  receiver only reports objects that exist.

## What You'll Monitor

- **Workloads**: deployment available/desired replicas, replicaset
  available/desired replicas, container readiness and restart counts.
- **Pods**: pod phase (Pending, Running, Succeeded, Failed, Unknown)
  and the status reason when a pod is not Running.
- **Nodes**: node Ready condition across the cluster.
- **Namespaces**: namespace phase (Active, Terminating).
- **Autoscaling** (when an HPA exists): current, desired, min, and max
  replicas the HPA observes.
- **Jobs** (when a Job exists): active and successful pod counts.

Full metric reference:
[OTel k8s_cluster Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/k8sclusterreceiver)

## Access Setup

The receiver authenticates to the API server with its ServiceAccount
token (`auth_type: serviceAccount`). Grant that ServiceAccount
`get`/`list`/`watch` on the object kinds it counts with a ClusterRole:

```yaml showLineNumbers title="k8s-cluster-rbac.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-k8s-cluster
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
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["daemonsets", "deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-k8s-cluster
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: observability
roleRef:
  kind: ClusterRole
  name: otel-k8s-cluster
  apiGroup: rbac.authorization.k8s.io
```

A missing verb shows up as an informer cache-sync timeout in the
Collector logs (for example, the HPA family needs the `autoscaling`
rule). Keep the rules in sync with the object kinds you expect to see.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  k8s_cluster:
    auth_type: serviceAccount
    collection_interval: 30s
    # Node conditions to surface as k8s.node.condition_* metrics.
    node_conditions_to_report: [Ready, MemoryPressure, DiskPressure]
    # Node allocatable capacity to surface as k8s.node.allocatable_* metrics.
    allocatable_types_to_report: [cpu, memory]

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
      receivers: [k8s_cluster]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Metrics Reference

These metrics emit for any non-empty cluster. The receiver reports
whatever objects the cluster has - deploy or scale workloads to see the
counts move.

### Workloads

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.deployment.available` | gauge | `{pods}` | Available replicas of a Deployment. |
| `k8s.deployment.desired` | gauge | `{pods}` | Desired replicas (the spec target). |
| `k8s.replicaset.available` | gauge | `{pods}` | Available replicas of a ReplicaSet. |
| `k8s.replicaset.desired` | gauge | `{pods}` | Desired replicas of a ReplicaSet. |
| `k8s.container.ready` | gauge | `1` | 1 when the container's readiness probe passes. |
| `k8s.container.restarts` | sum | `{restarts}` | Container restart count. |

### Pods and namespaces

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.pod.phase` | gauge | `1` | Phase code (1=Pending, 2=Running, 3=Succeeded, 4=Failed, 5=Unknown). |
| `k8s.pod.status_reason` | gauge | `1` | Reason code when a pod is not Running. |
| `k8s.namespace.phase` | gauge | `1` | Namespace phase (1=Active, 0=Terminating). |

### Nodes

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.node.condition_ready` | gauge | `1` | 1 when the node's Ready condition is true. |

### Autoscaling and jobs (conditional)

The HPA and Job families emit only when those objects exist in the
cluster. Ship an HPA or run a Job to see them.

| Metric | Type | Unit | Notes |
| --- | --- | --- | --- |
| `k8s.hpa.current_replicas` | gauge | `{pods}` | Current replicas the HPA observes. |
| `k8s.hpa.desired_replicas` | gauge | `{pods}` | Replicas the HPA wants. |
| `k8s.hpa.min_replicas` | gauge | `{pods}` | HPA floor. |
| `k8s.hpa.max_replicas` | gauge | `{pods}` | HPA ceiling. |
| `k8s.job.active_pods` | gauge | `{pods}` | Active pods of a Job. |
| `k8s.job.successful_pods` | gauge | `{pods}` | Pods the Job completed successfully. |

## Cluster Events as Logs

To capture Kubernetes events (scheduling, scaling, image pulls, probe
failures) as log records, add the `k8sobjects` receiver in `mode:
watch` against the Events API. Each event becomes one log record.

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
      exporters: [otlphttp/b14]
```

The ServiceAccount needs `get`/`list`/`watch` on `events` in both the
core (`""`) and `events.k8s.io` API groups - the core rule is already
in the ClusterRole above; add the `events.k8s.io` group the same way.

## Verify the Setup

Deploy the Collector and check that metrics flow within 60 seconds.
The receiver scrapes a definition catalog before it has values, so
allow one or two collection intervals before judging an empty result:

```bash showLineNumbers
# Confirm the Collector pod is running (one replica for the cluster).
kubectl -n observability get pods -l app=otel-collector

# Check the Collector logs for k8s_cluster activity.
kubectl -n observability logs deployment/otel-collector \
  | grep -i k8s_cluster
```

A quick way to confirm the receiver is emitting is to add a `debug`
exporter (`verbosity: detailed`) to the metrics pipeline temporarily
and watch for a real metric name such as `k8s.deployment.available` in
the pod logs.

## Troubleshooting

### Informer cache-sync timeout on startup

**Cause**: the Collector ServiceAccount lacks `get`/`list`/`watch` on
one of the object kinds the receiver counts.

**Fix**:

1. Apply the ClusterRole and ClusterRoleBinding from Access Setup.
2. Confirm the Deployment's `serviceAccountName` matches the binding
   subject.
3. If only one family is missing (for example the HPA metrics), add the
   matching API group to the ClusterRole.

### Deployment and pod metrics are empty

**Cause**: the cluster has no workloads, or the receiver is not reaching
the API server.

**Fix**:

1. Confirm workloads exist: `kubectl get deployments -A`.
2. Check the Collector logs for API connection errors.
3. Allow one or two collection intervals after startup before judging.

### HPA or Job metrics never appear

**Cause**: those families only emit when an HPA or Job object exists.

**Fix**:

1. Confirm the objects exist: `kubectl get hpa,jobs -A`.
2. Verify the `autoscaling` and `batch` rules are in the ClusterRole.

## FAQ

**Why one Collector for the cluster instead of one per node?**

The `k8s_cluster` receiver reads from the API server, which holds the
state of every object in the cluster. A single Collector sees
everything; running one per node would produce duplicate metrics for
the same cluster-scope objects.

**What is the difference between this and the kubeletstats receiver?**

The `k8s_cluster` receiver reports object state from the API server -
replica counts, phases, conditions. The `kubeletstats` receiver reads
each node's kubelet for actual runtime resource usage - CPU, memory,
network, filesystem. They are complementary: state versus usage.

**Why is `k8s.pod.phase` a number?**

The receiver encodes phase as an integer (1=Pending, 2=Running,
3=Succeeded, 4=Failed, 5=Unknown) so it can be stored and queried as a
gauge. Map the value back to the phase name when building dashboards.

**Do I need the events stream?**

No. Metrics work on their own. The `k8sobjects` events-to-logs stream
is optional and useful when you want scheduling, scaling, and probe
events alongside the state metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Pair this with the kubelet stats receiver
  for per-node runtime usage.
- **Fine-tune Collection**: Adjust `collection_interval` based on how
  quickly you need to see object-state shifts.

## Related Guides

- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) —
  Deploy the Collector in your cluster
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration

Validated against: managed Kubernetes, OTel Collector Contrib 0.152.0.
