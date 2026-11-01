---
title: ScoutCollector resource
sidebar_label: ScoutCollector
description:
  Deploy Agent, Daemon, and Gateway OpenTelemetry Collectors with the
  ScoutCollector resource. Services, autoscaling, disruption budgets, RBAC,
  health checks, and status.
keywords:
  [
    scoutcollector,
    scout operator,
    gateway collector,
    daemonset collector,
    agent collector,
    collector autoscaling,
    kubernetes collector rbac,
  ]
tags: [kubernetes, opentelemetry, base14 scout]
sidebar_position: 2
---

# ScoutCollector resource

A `ScoutCollector` describes one collector role: one workload whose pods all
run the same configuration. To run the Agent, Daemon, and Gateway collectors
from the [Deployment Topology](../collector-deployment-topology.md), create
three `ScoutCollector` resources.

From each one, the operator creates:

- a Deployment or a DaemonSet;
- a ServiceAccount, unless you name an existing one;
- the RBAC the Collector configuration needs;
- a Service, when you ask for one;
- a HorizontalPodAutoscaler, when autoscaling is enabled;
- a PodDisruptionBudget, unless you disable it.

The examples on this page use Direct mode, where the Collector runs the
configuration in a ConfigMap. To let Scout change that configuration at
runtime, see [Remote configuration](./remote-configuration.md).

## Before you start

Create a namespace and a Secret holding your Scout client secret. The Gateway
reads it to authenticate to Scout:

```bash
kubectl create namespace observability

kubectl create secret generic scout-credentials \
  --namespace observability \
  --from-literal=client-secret=__YOUR_CLIENT_SECRET__
```

## Gateway Collector

The Gateway receives OTLP from the Agent and Daemon collectors and from your
applications, runs your processors, and exports to Scout. It is stateless, so
it scales horizontally.

Its configuration lives in a ConfigMap:

```yaml showLineNumbers
apiVersion: v1
kind: ConfigMap
metadata:
  name: gateway-config
  namespace: observability
data:
  collector.yaml: |
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      oauth2client:
        client_id: __YOUR_CLIENT_ID__
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        endpoint_params:
          audience: b14collector
        token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      memory_limiter:
        check_interval: 1s
        limit_percentage: 80
        spike_limit_percentage: 20
      batch: {}

    exporters:
      otlphttp/b14:
        endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
        auth:
          authenticator: oauth2client

    service:
      extensions: [health_check, oauth2client]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [otlphttp/b14]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [otlphttp/b14]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [otlphttp/b14]
```

Then the `ScoutCollector`:

```yaml showLineNumbers
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutCollector
metadata:
  name: gateway
  namespace: observability
spec:
  managementMode: Direct
  identity:
    cluster: prod-eu
    environment: production
    role: gateway
  workload:
    kind: Deployment
  collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    fallbackConfig:
      name: gateway-config
      key: collector.yaml
    env:
      - name: SCOUT_CLIENT_SECRET
        valueFrom:
          secretKeyRef:
            name: scout-credentials
            key: client-secret
    resources:
      requests:
        cpu: 200m
        memory: 256Mi
      limits:
        memory: 1Gi
  service: {}
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
```

`service: {}` creates a Service named `gateway` with a port for every
receiver endpoint in the configuration, here 4317 and 4318. Other collectors
and applications send to `gateway.observability.svc.cluster.local:4317`.

## Daemon Collector

The Daemon runs one pod on every node and collects only from that node, so
it never duplicates another node's data. It forwards everything to the
Gateway. For more on the kubelet receiver, see
[Kubelet Stats](../../component/kubelet-stats.md).

```yaml showLineNumbers
apiVersion: v1
kind: ConfigMap
metadata:
  name: daemon-config
  namespace: observability
data:
  collector.yaml: |
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
      kubeletstats:
        auth_type: serviceAccount
        endpoint: https://${env:K8S_NODE_IP}:10250
        insecure_skip_verify: true
        collection_interval: 30s

    processors:
      memory_limiter:
        check_interval: 1s
        limit_percentage: 80
        spike_limit_percentage: 20
      k8sattributes:
        filter:
          node_from_env_var: K8S_NODE_NAME
      batch: {}

    exporters:
      otlp/gateway:
        endpoint: gateway.observability.svc.cluster.local:4317
        tls:
          insecure: true

    service:
      extensions: [health_check]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [otlp/gateway]
        metrics:
          receivers: [otlp, kubeletstats]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [otlp/gateway]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, k8sattributes, batch]
          exporters: [otlp/gateway]
---
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutCollector
metadata:
  name: daemon
  namespace: observability
spec:
  managementMode: Direct
  identity:
    cluster: prod-eu
    environment: production
    role: daemon
  workload:
    kind: DaemonSet
    hostNetwork: true
    tolerations:
      - operator: Exists
  collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    fallbackConfig:
      name: daemon-config
      key: collector.yaml
    env:
      - name: K8S_NODE_NAME
        valueFrom:
          fieldRef:
            fieldPath: spec.nodeName
      - name: K8S_NODE_IP
        valueFrom:
          fieldRef:
            fieldPath: status.hostIP
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        memory: 512Mi
```

With `hostNetwork: true`, applications reach the Daemon on their own node at
`$(HOST_IP):4317`. Set `HOST_IP` from `status.hostIP` in the application's
pod spec. Leave `hostNetwork` off if applications send to the Gateway
directly.

A DaemonSet rejects `workload.replicas` and `autoscaling`: the scheduler
decides how many pods run, one for each matching node.

:::note
Collector pods run with a read-only root filesystem and no host volumes, so
the Daemon cannot read container log files from `/var/log/pods` with the
`filelog` receiver. Collect logs over OTLP, or use the
[Kubernetes Helm Setup](../kubernetes-helm-setup.md) for node log files.
:::

## Agent Collector

The Agent polls cluster-wide and managed-service sources: the Kubernetes API,
cloud databases, queues. Any second copy would poll the same sources again,
so it must run exactly one replica.

```yaml showLineNumbers
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-config
  namespace: observability
data:
  collector.yaml: |
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133

    receivers:
      k8s_cluster:
        collection_interval: 30s
      k8sobjects:
        objects:
          - name: events
            mode: watch

    processors:
      memory_limiter:
        check_interval: 1s
        limit_percentage: 80
        spike_limit_percentage: 20
      batch: {}

    exporters:
      otlp/gateway:
        endpoint: gateway.observability.svc.cluster.local:4317
        tls:
          insecure: true

    service:
      extensions: [health_check]
      pipelines:
        metrics:
          receivers: [k8s_cluster]
          processors: [memory_limiter, batch]
          exporters: [otlp/gateway]
        logs:
          receivers: [k8sobjects]
          processors: [memory_limiter, batch]
          exporters: [otlp/gateway]
---
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutCollector
metadata:
  name: agent
  namespace: observability
spec:
  managementMode: Direct
  identity:
    cluster: prod-eu
    environment: production
    role: agent
  workload:
    kind: Deployment
    replicas: 1
    strategy:
      type: Recreate
  collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    fallbackConfig:
      name: agent-config
      key: collector.yaml
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        memory: 512Mi
```

`strategy: Recreate` matters here. The default rolling update starts the new
pod before stopping the old one, and for that overlap both pods poll the
same sources. `Recreate` stops the old pod first.

## Apply and check

```bash
kubectl apply -f gateway.yaml -f daemon.yaml -f agent.yaml
kubectl get scoutcol -n observability
```

```text
NAME      MODE     ROLE      READY   AGE
agent     Direct   agent     True    1m
daemon    Direct   daemon    True    1m
gateway   Direct   gateway   True    1m
```

`READY` turns `True` when every desired pod is ready.

## Kubernetes permissions

The operator reads the Collector configuration and grants the access its
components need, so you do not declare RBAC separately. In the examples above,
`kubeletstats` and `k8sattributes` give the Daemon read access to nodes and
pods, and `k8s_cluster` and `k8sobjects` give the Agent read access to the
cluster objects and events they watch. Removing a component from the
configuration removes its access.

The components the operator recognises are `k8sattributes`, `kubeletstats`,
`k8s_cluster`, `k8sobjects`, and `k8s_events`. Every grant is read-only.

You can also request access by name with presets:

```yaml
spec:
  kubernetesAccess:
    presets: [k8sattributes, kubeletstats]
```

The presets are `k8sattributes`, `kubeletstats`, `k8sevents`, and
`k8scluster`. When you list presets, the operator grants exactly those and
does not read the configuration for permissions.

:::note
In Supervised mode the operator reads permissions from the fallback
configuration only. If Scout later sends a configuration that adds, say,
`kubeletstats`, its access is not granted automatically. Include the
component in the fallback configuration, or list it as a preset.
:::

To use an existing ServiceAccount and the RBAC already bound to it, set
`workload.serviceAccountName`. The operator then creates no ServiceAccount.

## Services

Set `spec.service` to publish the collector:

| Field | Default | Description |
| --- | --- | --- |
| `name` | the `ScoutCollector` name | Service name |
| `type` | `ClusterIP` | Any Kubernetes Service type |
| `ports` | derived from the configuration | List these to publish ports explicitly instead |
| `headless` | `false` | Also creates `<name>-headless`, which resolves to the pods themselves |

When the configuration enables the Collector's own metrics endpoint
(`service.telemetry.metrics`), the operator also creates `<name>-monitoring`
on that port. With `headless: true` it adds `<name>-monitoring-headless`, so
Prometheus can scrape every pod instead of one at random. A `health_check`
extension gets `<name>-extension`.

## Autoscaling and disruption budgets

Autoscaling applies to Deployments only. It needs at least one CPU or memory
target, and a matching resource request for each target you set:

```yaml
spec:
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    behavior:
      scaleDown:
        stabilizationWindowSeconds: 300
```

When autoscaling is on, the HorizontalPodAutoscaler owns the replica count
and the operator stops setting it.

Every collector gets a PodDisruptionBudget with `maxUnavailable: 1` unless you
change or disable it:

```yaml
spec:
  disruptionBudget:
    enabled: true
    minAvailable: 2
```

Set either `minAvailable` or `maxUnavailable`, not both.

## Health checks

The readiness and liveness probes call `/health` on port 13133. In Direct
mode that is the Collector's own `health_check` extension, so the
configuration must enable it on that port, as the examples above do.

To use a different port or path, point the probes at it:

```yaml
spec:
  collector:
    healthCheck:
      port: 13134
      path: /health
```

In Supervised mode the Supervisor holds port 13133, so `healthCheck` is how
readiness follows the Collector itself. See
[Remote configuration](./remote-configuration.md#health-checks).

## Scheduling and pod settings

| Field | Description |
| --- | --- |
| `workload.nodeSelector`, `workload.tolerations`, `workload.affinity` | Standard pod scheduling |
| `workload.podLabels`, `workload.podAnnotations` | Added to every pod |
| `workload.hostNetwork` | Runs pods on the node's network |
| `workload.volumes`, `collector.volumeMounts` | Extra volumes for the collector. See [Reading files from the node](#reading-files-from-the-node) |
| `workload.runAsRoot` | Runs the collector as uid 0. Off by default |
| `workload.strategy` | Deployment rollout strategy. Defaults to `maxUnavailable: 0`, `maxSurge: 1` |
| `collector.env`, `collector.resources` | Collector environment and resources |
| `collector.imagePullPolicy` | Defaults to `IfNotPresent` |

Pods run as user 10001 with a read-only root filesystem, no privilege
escalation, and all Linux capabilities dropped. `workload.runAsRoot` changes
the user id only, and is for roles that read root-owned paths on the node:
see [Reading files from the node](#reading-files-from-the-node).

## Reading files from the node

A collector only sees what its pod can see. Components that read the node's
filesystem need the path mounted, and often need a user that is allowed to
read it.

Declare the volume on the workload and mount it on the collector:

```yaml
spec:
  workload:
    volumes:
      - name: varlogpods
        hostPath:
          path: /var/log/pods
          type: Directory
  collector:
    volumeMounts:
      - name: varlogpods
        mountPath: /var/log/pods
        readOnly: true
```

Any Kubernetes volume source works: `hostPath`, `configMap`, `secret`,
`persistentVolumeClaim`, `csi`, and the rest. In Supervised mode the mount
lands on the Supervisor container, because the Collector runs as its child.

The operator rejects a volume that reuses one of its own names, a mount that
names no volume, and a path that is not clean and absolute, so a mistake is
refused when you apply the resource rather than found later as a pod that
will not start.

:::note
`type: FileOrCreate` creates a missing *file*, not missing parent
directories. Mounting `/var/lib/dbus/machine-id` on a node without
`/var/lib/dbus` fails with `no such file or directory`. Use
`type: Directory` for directories that already exist.
:::

### Collecting pod logs

`/var/log/pods` is owned by root and is not readable by the user collectors
run as, on GKE, EKS, AKS and most other distributions. A `filelog` receiver
pointed at it will match no files and report no error: the pipeline simply
stays empty.

Mount the path and let that role run as root:

```yaml showLineNumbers
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutCollector
metadata:
  name: daemon
  namespace: observability
spec:
  workload:
    kind: DaemonSet
    runAsRoot: true
    volumes:
      - name: varlogpods
        hostPath:
          path: /var/log/pods
          type: Directory
  collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    fallbackConfig:
      name: daemon-config
      key: collector.yaml
    volumeMounts:
      - name: varlogpods
        mountPath: /var/log/pods
        readOnly: true
```

`runAsRoot` grants the user id and nothing else. Privilege escalation stays
off, the root filesystem read-only, every Linux capability dropped, and the
seccomp profile the runtime default.

Set it only on the role that reads the node. A Gateway that receives OTLP
reads nothing from the filesystem and should keep running unprivileged.

Confirm it worked, rather than assuming:

```bash
kubectl exec -n observability ds/daemon -c supervisor -- ls /var/log/pods
```

An empty logs pipeline and `Permission denied` look identical from outside
the pod, so this one command separates them.

## Status

`kubectl describe scoutcol <name>` shows these conditions:

| Condition | Meaning |
| --- | --- |
| `Ready` | All desired pods are ready |
| `Progressing` | Resources are being updated, or pods are not ready yet |
| `Degraded` | The spec is invalid or a resource could not be created. The message says why |
| `ServiceReady` | The Service exists, or none was requested |
| `AutoscalingReady` | The HorizontalPodAutoscaler is configured, or autoscaling is off |
| `DisruptionBudgetReady` | The PodDisruptionBudget exists, or it is disabled |
| `CacheReady`, `CacheSynchronized` | Supervised mode only. See [Remote configuration](./remote-configuration.md) |

## Troubleshooting

### The collector shows `Degraded` with reason `InvalidSpec`

The operator rejected the spec and created nothing new. The condition message
names the field, for example `autoscaling requires a Deployment workload` or
`CPU autoscaling requires a collector CPU request`. Fix the spec and apply it
again.

### Pods start but never become ready

The readiness probe is not reaching a health endpoint. Check that the
configuration enables `health_check` on 0.0.0.0:13133, or that
`collector.healthCheck` points at the port it does use:

```bash
kubectl logs -n observability deploy/gateway
```

### A filelog pipeline produces nothing and reports no error

The path is almost certainly not readable. `/var/log/pods` is root-owned, and
a `filelog` receiver that matches no files logs nothing at all. Check from
inside the pod:

```bash
kubectl exec -n observability ds/daemon -c supervisor -- ls /var/log/pods
```

`No such file or directory` means the volume is not mounted.
`Permission denied` means it is mounted but the collector may not read it.
Both are covered in [Reading files from the node](#reading-files-from-the-node).

### A field I set is missing from the pod

The CRD predates the field. Kubernetes drops properties its schema does not
declare, without an error, so the apply succeeds and the setting never
arrives. Upgrade the operator, confirm the CRD, then apply the resource
again:

```bash
kubectl get crd scoutcollectors.telemetry.scout.base14.io \
  -o jsonpath='{.spec.versions[0].schema.openAPIV3Schema.properties.spec.properties.workload.properties.runAsRoot}'
```

### A component fails with a permissions error

In `PreProvisioned` or namespaced installs the operator does not create RBAC,
so a cluster administrator must bind the access to the collector's
ServiceAccount. In Supervised mode, check that the component is in the
fallback configuration or listed as a preset.

## FAQ

### Why are Agent, Daemon, and Gateway separate resources?

Each role has a different workload shape and scales differently, so each is
its own `ScoutCollector`. The Agent is a single replica, the Daemon is a
DaemonSet, and the Gateway scales with load. Keeping them apart also means a
problem with one role never blocks changes to the others.

### Can I run more than one Gateway?

Yes, create another `ScoutCollector` with a different name. Each one gets its
own workload, Service, and autoscaler, which is useful for keeping one
team's or one signal's traffic apart.

### Does changing the ConfigMap restart the collector?

In Direct mode, no. The operator re-reads the ConfigMap to update ports and
permissions, but running pods keep the configuration they started with.
Restart them to load the change:

```bash
kubectl rollout restart deployment/gateway -n observability
```

In Supervised mode, send configuration through Scout instead. See
[Remote configuration](./remote-configuration.md).

## Related guides

- [Scout Operator](./index.md): install the operator
- [Remote configuration](./remote-configuration.md): configure collectors
  from Scout
- [Deployment Topology](../collector-deployment-topology.md): the three
  collector roles
- [Scout Exporter](../scout-exporter.md): authenticate to Scout
