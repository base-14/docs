---
title: Scout Operator for Kubernetes
sidebar_label: Overview and install
description:
  Install Scout Operator on Kubernetes with Helm and manage Scout collectors
  as ScoutCollector resources, with optional remote configuration from Scout.
keywords:
  [
    scout operator,
    kubernetes operator,
    scoutcollector,
    opentelemetry collector operator,
    collector management,
    opamp supervisor,
  ]
tags: [kubernetes, opentelemetry, base14 scout]
sidebar_position: 1
---

# Scout Operator

Scout Operator runs OpenTelemetry Collectors on Kubernetes from a single
custom resource, `ScoutCollector`. You describe the collector you want, and
the operator creates and keeps in step the Deployment or DaemonSet, Service,
ServiceAccount, RBAC, HorizontalPodAutoscaler, and PodDisruptionBudget that
run it.

A collector can run in one of two modes:

- **Direct** runs the Collector with a configuration you keep in a ConfigMap.
- **Supervised** runs the Collector under the OpAMP Supervisor, so Scout can
  send it new configuration at runtime. See
  [Remote configuration](./remote-configuration.md).

## When to use it

| You want to | Use |
| --- | --- |
| Run the Scout Collector from one Helm release with Scout's defaults | [Kubernetes Helm Setup](../kubernetes-helm-setup.md) |
| Manage each collector role as its own resource, or change configuration from Scout without a redeploy | Scout Operator |

## Prerequisites

- A Kubernetes cluster
- Helm 3
- `kubectl` access with permission to install CRDs and ClusterRoles
- Your Scout client ID and client secret

## Install

Add the base14 Helm repository and install the operator:

```bash
helm repo add base14 https://charts.base14.io/
helm repo update

helm install scout-operator base14/scout-operator \
  --namespace scout-operator-system \
  --create-namespace
```

The chart installs the `ScoutCollector` CRD, the operator Deployment, and the
RBAC the operator needs. It watches every namespace by default.

Check that the operator is running and the CRD is registered:

```bash
kubectl get pods -n scout-operator-system
kubectl get crd scoutcollectors.telemetry.scout.base14.io
```

## Install into specific namespaces

On clusters where the operator may not hold cluster-wide permissions, limit it
to a list of namespaces:

```bash
helm install scout-operator base14/scout-operator \
  --namespace scout-operator-system \
  --create-namespace \
  --set manager.scope=namespaced \
  --set manager.watchNamespaces="observability,payments" \
  --set manager.collectorRBACMode=PreProvisioned
```

In this mode the operator uses Roles in the watched namespaces only, so it
cannot create the ClusterRoles some Collector components need, such as
`k8sattributes` or `kubeletstats`. A cluster administrator creates those
ahead of time and binds them to the collector's ServiceAccount, which is named
after the `ScoutCollector` unless you set `workload.serviceAccountName`.

A namespaced install requires `collectorRBACMode` to be `PreProvisioned` or
`Disabled`. The chart refuses to render `Auto` with `scope: namespaced`.

## Upgrading

Upgrade the operator before applying resources that use fields a newer
release adds.

```bash
helm repo update
helm upgrade scout-operator base14/scout-operator \
  --namespace scout-operator-system
```

The chart ships the CRD as a template, so an upgrade updates it. This order
matters: Kubernetes silently drops properties the CRD does not declare, so a
`ScoutCollector` applied against an older CRD loses the new fields without
any error, and the apply still reports success.

## Moving collectors you already run

If a collector is already running from a Helm chart or the OpenTelemetry
Operator, deleting the old definition is part of the move, not an
afterthought. Two owners for one collector means either duplicated telemetry
or two pods competing.

- **Two collectors exporting the same data.** Both run happily, and your
  backend sees everything twice, until the old definition is removed.
- **A DaemonSet using `hostNetwork`.** The old pod holds the node's ports, so
  the new one cannot bind and crash-loops with `address already in use`.

With Argo CD, sync with pruning enabled so the superseded objects are removed
in the same operation. Applying by hand, delete the old resource once the
`ScoutCollector` is ready.

Keep the Service name the same across the move. Set `service.name` on the
`ScoutCollector` to whatever senders already use, and nothing that sends
telemetry has to be reconfigured.

## Uninstall

:::warning
The chart owns the `ScoutCollector` CRD. `helm uninstall` removes the CRD, and
Kubernetes then deletes every `ScoutCollector` and the collectors it runs.
:::

```bash
helm uninstall scout-operator --namespace scout-operator-system
```

To keep your collectors' definitions across a reinstall, manage the CRD
outside the release and install with `--set crds.create=false`.

## Chart values

| Value | Default | Description |
| --- | --- | --- |
| `manager.scope` | `cluster` | `cluster` watches every namespace. `namespaced` watches only `manager.watchNamespaces`. |
| `manager.watchNamespaces` | `""` | Comma-separated namespaces, required when the scope is `namespaced`. |
| `manager.collectorRBACMode` | `Auto` | `Auto` lets the operator create Collector RBAC. `PreProvisioned` expects it to exist. `Disabled` rejects collectors that need it. |
| `manager.cacheSync.enabled` | `true` | Copies each supervised collector's latest applied configuration into its recovery cache. |
| `manager.cacheSync.interval` | `30s` | How often that copy runs. Each supervised collector makes one request per interval. |
| `crds.create` | `true` | Set to `false` when the CRD is managed outside this release. |
| `metrics.enabled` | `true` | Serves operator metrics over HTTPS on port 8443. |
| `metrics.serviceMonitor.enabled` | `false` | Creates a ServiceMonitor. Requires the Prometheus Operator CRDs. |

## Next steps

- [ScoutCollector resource](./scoutcollector.md): deploy the Agent, Daemon,
  and Gateway collectors.
- [Remote configuration](./remote-configuration.md): let Scout configure a
  running collector.
- [Deployment Topology](../collector-deployment-topology.md): how the three
  collector roles fit together.

## FAQ

### What happens to my collectors if the operator stops?

Your collectors keep running. The operator only reconciles Kubernetes
objects, so while it is down, changes to a `ScoutCollector` are not applied
until it returns. Telemetry is not routed through the operator.
