---
title: Full Kubernetes coverage with ScoutInstallation
sidebar_label: ScoutInstallation
description:
  Collect application telemetry, Kubernetes and host metrics, events, and
  container logs from a whole cluster with one ScoutInstallation resource.
  Presets, defaults, every field, and moving from the scout-collector chart.
keywords:
  [
    scoutinstallation,
    scout operator,
    kubernetes observability,
    kubernetes monitoring,
    kubernetes logs collection,
    kubeletstats,
    k8s_cluster receiver,
    kubernetes events,
    opentelemetry collector kubernetes,
  ]
tags: [kubernetes, opentelemetry, base14 scout]
sidebar_position: 2
---

# ScoutInstallation

A `ScoutInstallation` turns on Scout's standard collection for a whole
Kubernetes cluster from one short resource. Every kind of coverage is a
preset, and every preset is on by default, so the smallest resource already
collects application telemetry, Kubernetes and host metrics, events, container
logs, and Kubernetes metadata. Turning a preset off is one line.

From the presets that are on, the operator decides which collectors to run and
creates them as ordinary [`ScoutCollector`](./scoutcollector.md) resources:

| Collector | Runs as | Exists when |
| --- | --- | --- |
| node | DaemonSet on the node's network, one pod per node | `applicationTelemetry`, `kubernetesMetrics`, `logs`, or `hostMetrics` is on |
| cluster | Deployment, always one replica | `kubernetesMetrics` or `kubernetesEvents` is on |
| gateway | Deployment with a HorizontalPodAutoscaler and a PodDisruptionBudget | `gateway.enabled` is `true`, the default |

The node and cluster collectors send to the gateway, and the gateway sends to
Scout. Each collector is visible with `kubectl get scoutcollectors`, and the
operator keeps them in step with the `ScoutInstallation`: an edit to a
generated collector is reverted.

Use one `ScoutInstallation` per cluster. For a collector this page does not
cover, such as one that scrapes a specific application, write a
`ScoutCollector` that sends to the gateway.

## Presets

| Preset | What you get | Runs on | Brings with it |
| --- | --- | --- | --- |
| `applicationTelemetry` | Traces, metrics, and logs your applications send over OTLP on ports 4317 (gRPC) and 4318 (HTTP) | node and gateway | The receiving ports |
| `kubernetesMetrics` | Node, pod, container, and volume metrics from the kubelet, and cluster state such as deployments, replicas, restarts, and pod phases | kubelet metrics on node, cluster state on cluster | Read access to nodes and cluster objects |
| `kubernetesEvents` | Kubernetes events as logs | cluster | Read access to events |
| `logs` | Every container's stdout and stderr | node | A read-only mount of the pod log directory, and the collector runs as root |
| `hostMetrics` | Node CPU, memory, disk, filesystem, network, load, paging, and processes | node | A read-only mount of the node's root filesystem |
| `kubernetesAttributes` | Pod, namespace, workload, node, and container names and IDs, container image, cluster UID, `resource.opentelemetry.io/*` pod annotations, and `app.kubernetes.io/*` pod labels on all telemetry | node and cluster | Read access to pods, namespaces, and ReplicaSets |
| `selfMonitoring` | Each collector's own metrics | every collector | Nothing |

Turning a preset off removes everything it brought: its receivers, its
permissions, its mounts, and the root user for `logs`. Turning off both
`kubernetesMetrics` and `kubernetesEvents` removes the cluster collector.

`kubernetesAttributes` and `selfMonitoring` add to collectors that exist for
another reason. On their own they collect nothing, so a resource whose only
presets are these two, with the gateway off, is rejected as having nothing to
collect.

## Before you start

You need Scout Operator 0.1.17 or later, from chart 0.1.14 or later. See
[Install](./index.md#install).

You need two credentials, each stored in a Secret:

- your **Scout client ID and secret**, which the collectors use to send
  telemetry to Scout and to connect to Scout fleet management;
- a **bootstrap credential**, which collectors use to recover their last
  applied configuration from fleet management when a pod starts.

Create the bootstrap credential in the Scout console:

1. Open `https://console.base14.io/<your-org>/api-keys`. You need admin
   access to your organization.
2. Select **Create API Key** and give it a name, such as the cluster name.
3. Set **Credential type** to **Capo Bootstrap**. This credential can only
   read collector configuration during recovery. Create one per cluster.
4. Copy the client ID and client secret. The secret is shown only once.

Then create a namespace and both Secrets:

```bash
kubectl create namespace scout

kubectl create secret generic scout-credentials \
  --namespace scout \
  --from-literal=clientId=__YOUR_CLIENT_ID__ \
  --from-literal=clientSecret=__YOUR_CLIENT_SECRET__

kubectl create secret generic scout-bootstrap \
  --namespace scout \
  --from-literal=clientId=__YOUR_BOOTSTRAP_CLIENT_ID__ \
  --from-literal=clientSecret=__YOUR_BOOTSTRAP_CLIENT_SECRET__
```

In Direct mode, collectors do not use fleet management, and you need only
`scout-credentials`. See [Credentials](#credentials) for every option.

## Full coverage

This resource turns on every preset and creates all three collectors:

```yaml showLineNumbers
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutInstallation
metadata:
  name: scout-collector
  namespace: scout
spec:
  clusterName: prod-eu
  environment: production
  scout:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    tokenURL: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    credentialsSecretRef:
      name: scout-credentials
  management:
    bootstrapCredentialsSecretRef:
      name: scout-bootstrap
```

`clusterName` identifies the cluster in Scout and cannot change after the
resource is created. Collectors connect to Scout fleet management at
`wss://capo.base14.io/v1/connect` and `https://capo.base14.io` by default;
set `management.opampEndpoint` and `management.bootstrapEndpoint` only to use
another one. The connection to fleet management uses
`scout-credentials` unless you give it its own Secret. See
[Credentials](#credentials).

To run the generated configuration only, without fleet management, set
`management.mode: Direct` and leave out the rest of `management`:

```yaml
spec:
  management:
    mode: Direct
```

## Apply and check

```bash
kubectl apply -f scoutinstallation.yaml
kubectl get scoutinstallation -n scout
kubectl get scoutcollectors -n scout
```

The resource reports `Ready` once every collector it created is ready:

```text
NAME              CLUSTER   READY   PRESETS   AGE
scout-collector   prod-eu   True    7         3m
```

`kubectl describe scoutinstallation scout-collector -n scout` lists each
collector with its ready replicas, and the addresses applications send to.

## Sending application telemetry

Applications send OTLP to the gateway Service:

| Protocol | Address |
| --- | --- |
| gRPC | `scout-collector-agent-collector.scout.svc.cluster.local:4317` |
| HTTP | `http://scout-collector-agent-collector.scout.svc.cluster.local:4318` |

The Service is named `<name>-agent-collector`, the same address the
scout-collector Helm chart uses, so applications already sending there need
no change. Set `gateway.serviceName` to use a different name.

The node collector also listens on each node's own address, which keeps
traffic on the node:

```yaml
env:
  - name: HOST_IP
    valueFrom:
      fieldRef:
        fieldPath: status.hostIP
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://$(HOST_IP):4318
```

With [auto-instrumentation](./auto-instrumentation.md), set the
`ScoutInstrumentation` exporter endpoint to the gateway address.

## Service names

Every signal arrives in Scout with a `service.name`:

| Signal | `service.name` |
| --- | --- |
| Traces, metrics, and logs your applications send | The name the application sets |
| Container logs | The pod's `resource.opentelemetry.io/service.name` annotation, or else the container name |
| Kubernetes and host metrics | `k8s` |
| Kubernetes events | `k8s-events` |

To name a workload's container logs, annotate its pods:

```yaml
spec:
  template:
    metadata:
      annotations:
        resource.opentelemetry.io/service.name: checkout
```

The pod labels `app.kubernetes.io/name`, `instance`, `version`, `component`,
`part-of`, and `managed-by` arrive as `kube_app_name`, `kube_app_instance`, and
so on.

## Turning coverage off

Set `enabled: false` on any preset. Nothing else in the resource changes:

```yaml
spec:
  presets:
    kubernetesEvents:
      enabled: false
    hostMetrics:
      enabled: false
```

Only the collectors whose configuration changes restart.

## Collection intervals

`kubernetesMetrics` and `hostMetrics` collect every 60 seconds by default:

```yaml
spec:
  presets:
    kubernetesMetrics:
      collectionInterval: 30s
    hostMetrics:
      collectionInterval: 2m
```

## Logs

The `logs` preset reads every container's log from the node. To limit it,
list namespaces to include or to exclude, not both:

```yaml
spec:
  presets:
    logs:
      excludeNamespaces: [kube-system]
```

The collectors' own logs are always excluded.

The node collector runs as root while `logs` is on, because the kubelet writes
pod logs readable only by root. All Linux capabilities stay dropped and the
root filesystem stays read-only.

### Custom pod log directory

Logs are read from `/var/log/pods`, where the kubelet writes them by default.
If your nodes' kubelet sets `podLogsDir` to another directory, set the same
directory on the preset:

```yaml
spec:
  presets:
    logs:
      podLogsDir: /var/data/kubelet/pods
```

The path must be absolute, and cannot be `/` or contain `..` or wildcard
characters. Inside the collector the directory is always mounted at
`/var/log/pods`, so the `log.file.path` attribute in Scout shows that path.

## Without a gateway

On small clusters you can leave out the gateway. The node and cluster
collectors then send to Scout directly:

```yaml
spec:
  gateway:
    enabled: false
```

Applications then send to the node collector on each node's address, since
the gateway Service no longer exists.

## Credentials

Up to three credentials are involved, each in a Secret in the
`ScoutInstallation` namespace. Each one defaults to the one above it:

| Field | Used for | Default |
| --- | --- | --- |
| `scout.credentialsSecretRef` | Sending telemetry to Scout | required |
| `management.credentialsSecretRef` | Each collector's connection to fleet management | `scout.credentialsSecretRef` |
| `management.bootstrapCredentialsSecretRef` | Reading a collector's last applied configuration when a pod starts, and refreshing the [recovery cache](./remote-configuration.md#the-recovery-cache) | `management.credentialsSecretRef` |

Each Secret holds the client ID under `clientId` and the secret under
`clientSecret`. To use other keys, set `clientIDKey` and `clientSecretKey`
next to the Secret name.

The bootstrap credential needs the `capo:bootstrap` scope, which only a
**Capo Bootstrap** credential from the console carries. Without it,
fleet management refuses the recovery read and pods cannot restore their
last configuration. Create one per cluster as in
[Before you start](#before-you-start).

The connection to fleet management accepts the same credential the
collectors send telemetry with, so `scout-credentials` works there. To give
it a credential of its own, store another collector client ID and secret the
same way and reference it:

```yaml
spec:
  management:
    credentialsSecretRef:
      name: scout-opamp
```

Every supervised collector mounts the fleet management credentials. Only
collectors that send to Scout directly get the Scout client secret: the
gateway, or every collector when the gateway is off. When the fleet management
connection uses `scout-credentials`, the default, every collector holds that
secret.

## Scheduling and sizing

Each collector role takes the same scheduling fields, under `node`, `cluster`,
and `gateway`:

| Field | Default |
| --- | --- |
| `nodeSelector` | `kubernetes.io/os: linux`. Setting it replaces the default |
| `tolerations` | none |
| `affinity` | none |
| `priorityClassName` | none |
| `resources` | node and cluster: requests `100m` CPU and `256Mi` memory, limit `512Mi`. gateway: requests `200m` and `512Mi`, limit `1Gi` |
| `podLabels`, `podAnnotations` | none |
| `strategy` | cluster: `Recreate`. gateway: rolling update with no pod unavailable. Ignored on node |

The node collector has no tolerations by default, so it skips tainted nodes
such as control planes or dedicated node pools. To collect from every node:

```yaml
spec:
  node:
    tolerations:
      - operator: Exists
```

There is no default priority class. Setting `system-node-critical` on the
node collector keeps it from being evicted first when a node runs short of
memory, but some providers, GKE among them, allow that class only in
`kube-system` unless a ResourceQuota permits it elsewhere. Set it where your
cluster allows it:

```yaml
spec:
  node:
    priorityClassName: system-node-critical
```

The gateway scales between 2 and 6 replicas at 70% CPU, and keeps at least
one replica available during disruptions:

```yaml
spec:
  gateway:
    autoscaling:
      minReplicas: 3
      maxReplicas: 10
      targetCPUUtilizationPercentage: 60
    minAvailable: 2
```

`minReplicas` is at least 2, and `maxReplicas` at least `minReplicas`.

## All fields

| Field | Default | Description |
| --- | --- | --- |
| `clusterName` | required | Cluster name in Scout. Lowercase letters, digits, and `-`, at most 63 characters. Cannot change |
| `environment` | required | Added to all telemetry |
| `scout.endpoint` | required | Your Scout OTLP endpoint |
| `scout.tokenURL` | required | Your Scout token endpoint |
| `scout.audience` | `b14collector` | Token audience |
| `scout.credentialsSecretRef.name` | required | Secret with the Scout client ID and secret |
| `scout.credentialsSecretRef.clientIDKey`, `clientSecretKey` | `clientId`, `clientSecret` | Keys in that Secret. The same two fields exist on every credentials reference |
| `management.mode` | `Supervised` | `Supervised` or `Direct` |
| `management.opampEndpoint`, `bootstrapEndpoint` | `wss://capo.base14.io/v1/connect`, `https://capo.base14.io` | Fleet management endpoints, used in Supervised mode. `bootstrapEndpoint` has no path |
| `management.credentialsSecretRef` | `scout.credentialsSecretRef` | See [Credentials](#credentials) |
| `management.bootstrapCredentialsSecretRef` | `management.credentialsSecretRef` | See [Credentials](#credentials) |
| `management.bootstrapScopes` | `[capo:bootstrap]` | Scopes requested for the bootstrap client |
| `presets.<preset>.enabled` | `true` | See [Presets](#presets) |
| `presets.kubernetesMetrics.collectionInterval` | `60s` | Kubelet and cluster metrics interval |
| `presets.hostMetrics.collectionInterval` | `60s` | Host metrics interval |
| `presets.kubernetesEvents.namespaces` | all | Namespaces whose events are collected |
| `presets.logs.includeNamespaces`, `excludeNamespaces` | none | Set one or neither |
| `presets.logs.podLogsDir` | `/var/log/pods` | See [Custom pod log directory](#custom-pod-log-directory) |
| `node`, `cluster`, `gateway` | see [Scheduling and sizing](#scheduling-and-sizing) | |
| `gateway.enabled` | `true` | `false` sends directly to Scout |
| `gateway.serviceName` | `<name>-agent-collector` | The Service applications send to |
| `gateway.autoscaling.minReplicas`, `maxReplicas`, `targetCPUUtilizationPercentage` | `2`, `6`, `70` | |
| `gateway.minAvailable` | `1` | PodDisruptionBudget |

The resource name is at most 43 characters, so the names of the collectors it
creates stay within Kubernetes limits.

## What it creates

For a `ScoutInstallation` named `scout-collector`:

| Collector | ScoutCollector | Configuration ConfigMap | Service |
| --- | --- | --- | --- |
| node | `scout-collector-daemon` | `supervisor-daemon-config` | `daemon-collector`, when `applicationTelemetry` is on |
| cluster | `scout-collector-agent-cluster` | `supervisor-agent-cluster-config` | none |
| gateway | `scout-collector-gateway` | `supervisor-gateway-config` | `scout-collector-agent-collector` |

These are the names the scout-collector Helm chart uses in operator mode. In
Scout fleet management the collectors report the roles `daemon`, `agent`
(with `collector.name=cluster`), and `gateway`. See
[How collectors appear in Scout](./remote-configuration.md#how-collectors-appear-in-scout).

The Collector version is the one the operator pins, 0.161.0 in operator
0.1.17. Upgrading the operator upgrades it.

## Moving from the scout-collector chart

A cluster running the [scout-collector chart](../kubernetes-helm-setup.md) in
operator mode can move without senders changing their address, because a
`ScoutInstallation` named after the chart release uses the chart's names.

1. In the release namespace, apply a `ScoutInstallation` named after the
   release, usually `scout-collector`, with the same cluster name and
   environment. Turn off presets the cluster does not collect today if the
   move should not add coverage.
2. The operator takes over the chart's `ScoutCollector` resources and
   ConfigMaps in place. The gateway Service keeps its address, and each
   collector restarts once.
3. Remove the chart straight away, without deleting what was taken over:
   exclude those objects from Argo CD's pruning, or mark them
   `helm.sh/resource-policy: keep`. Until the chart is gone, a sync can write
   its version of those objects back, so turn off automated sync for the
   release before step 1. If the objects are deleted anyway, the operator
   recreates them, at the cost of one more restart.
4. Once every collector is ready and data arrives in Scout, delete what the
   chart created that the `ScoutInstallation` does not use, such as its
   ServiceAccount and bootstrap Secret.

Named agents the chart runs beyond the cluster agent, and custom
configurations in chart values, have no `ScoutInstallation` equivalent. Keep
them as `ScoutCollector` resources that send to the gateway.

Try the move on one cluster before the rest.

## Deleting

Delete the `ScoutInstallation` to remove every collector it created, with
their permissions:

```bash
kubectl delete scoutinstallation scout-collector -n scout
```

:::warning
Delete every `ScoutInstallation` before uninstalling Scout Operator.
Collectors that hold cluster permissions keep a finalizer that only the
running operator removes, so uninstalling first leaves them, and the CRDs,
stuck in deletion.
:::

## Troubleshooting

`kubectl describe scoutinstallation <name>` shows why the resource is not
ready:

| Reason | Meaning |
| --- | --- |
| `CredentialsSecretNotFound`, `ManagementCredentialsSecretNotFound`, `BootstrapCredentialsSecretNotFound` | The Secret is missing. Create it and the resource recovers on its own |
| `InvalidCredentialsSecret`, `InvalidManagementCredentialsSecret`, `InvalidBootstrapCredentialsSecret` | The Secret lacks a client ID or secret under the expected keys |
| `InvalidSpec` | For example, nothing left to collect. See [Presets](#presets) |
| `DuplicateScoutInstallation` | Another `ScoutInstallation` in the cluster is older and active. This one creates nothing |
| `CollectorsNotReady` | A collector is still starting. Check `kubectl get scoutcollectors` |

### The node collector is missing from some nodes

Those nodes are tainted. Add [tolerations](#scheduling-and-sizing) to `node`.

### Node collector pods are not created

If the DaemonSet reports a priority class error, the cluster does not allow
the class set in `node.priorityClassName` in this namespace. Remove it or use
a class the cluster allows.

### No container logs arrive

Check where the kubelet writes pod logs on a node. If it is not
`/var/log/pods`, set [`podLogsDir`](#custom-pod-log-directory).

### Log volume grows without stopping

A workload that writes every log record it receives to its own output, such
as a Collector with a `debug` exporter, feeds back into the `logs` preset.
Add its namespace to `excludeNamespaces`.

## FAQ

### How many ScoutInstallations should a cluster have?

A cluster needs exactly one `ScoutInstallation`. Two would collect cluster
state and events twice, so only the oldest is active and any other reports
`DuplicateScoutInstallation`.

### Can I edit the ScoutCollectors a ScoutInstallation creates?

No, the operator reverts edits to the collectors it creates. Change the
`ScoutInstallation` instead, or write your own `ScoutCollector` for anything
it does not cover.

### Can I add my own receivers to the generated collectors?

Not in this version. Run a separate `ScoutCollector` with the receiver you
need and send its output to the gateway Service.

### Does ScoutInstallation collect from Windows nodes?

No, the node collector runs on Linux nodes only. Windows workloads can still
send OTLP to the gateway Service.

### Are logs lost when a node collector restarts?

Lines written while a node collector restarts are not collected. The collector
starts reading each log file from its end, so restarts from preset changes or
operator upgrades leave a short gap.

## Related guides

- [Scout Operator](./index.md): install the operator
- [ScoutCollector resource](./scoutcollector.md): run collectors you describe
  yourself
- [Remote configuration](./remote-configuration.md): change collector
  configuration from Scout
- [Auto-instrumentation](./auto-instrumentation.md): instrument applications
  that send to the gateway
- [Deployment Topology](../collector-deployment-topology.md): how the
  collector roles fit together
