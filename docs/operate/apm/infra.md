---
title: APM Infra - Host and Node Health Beside Your Services
sidebar_label: Infra
sidebar_position: 9
description:
  Check host or Kubernetes node CPU, memory, receive-network, and filesystem
  health alongside application performance in base14 Scout APM.
keywords:
  [
    apm,
    infrastructure,
    hosts,
    kubernetes nodes,
    cpu usage,
    memory usage,
    network throughput,
    filesystem usage,
    node health,
    host metrics,
    resource saturation,
    infrastructure alerts,
    opentelemetry,
    scout apm,
    base14,
    scout,
  ]
---

# Infra

The Infra tab shows a live view of host or Kubernetes node resource usage
next to your APM workflows, so you can tell an application regression apart
from a saturated machine.

The tab appears only when enabled for a deployment with the required
OpenTelemetry metrics.

![Infra tab with CPU, memory, network, and filesystem charts above the instances table](/img/apm/infra/infra-overview.png)

---

## Hosts or Kubernetes Nodes

An administrator configures the page in one of two modes:

- **Hosts** identifies machines by host name.
- **Kubernetes** identifies cluster nodes by node name.

Use the instance selector in the topbar to show one or several discovered hosts
or nodes. Environment and configured telemetry-service restrictions also apply.

---

## Fixed Live Window

Infra uses a fixed recent window rather than the application's general time
picker. Depending on plugin settings, the window is 5, 10, or 15 minutes. The
page clearly reports when no instances have sent data during that interval.

---

## Charts

| Chart | What it shows |
| ----- | ------------- |
| **CPU Usage** | CPU utilization percentage per host or node |
| **Memory Usage** | Memory utilization percentage |
| **Network Usage (receive)** | Receive throughput in bytes per second |
| **Filesystem Usage** | Filesystem utilization percentage |

Multiple instances are plotted as separate series. The charts do not share a
crosshair because each resource uses a different unit or scale.

![CPU Usage, Memory Usage, Network Usage, and Filesystem Usage charts plotted per instance](/img/apm/infra/infra-charts.png)

---

## Instances Table

The table shows the latest recorded CPU, memory, network receive, and filesystem
value for every visible host or node. Select any metric heading to sort; missing
measurements stay below recorded values in either direction.

---

## Create Infrastructure Alerts

Each chart menu can open a Grafana alert-rule draft for the selected host or
node scope. The query, environment, data source, metric, and infra mode are
pre-filled. Review the threshold before saving. Availability depends on your
Grafana permissions and alerting configuration.

---

## Use Cases

### Decide Whether to Blame the Machine

1. Confirm the application regression in [Services](./services.md).
2. Open Infra and select the instances you know run that service. Infra lists
   hosts or nodes, not services, so the mapping is yours to make.
3. If CPU, memory, and filesystem are all unremarkable, the cause is in the
   application path.

### Catch a Saturating Node

1. Sort the instances table by CPU, then by memory.
2. Watch whether one instance sits above the rest across the live window.
3. Open the chart menu to draft an alert for that scope.

### Check a Host After a Deploy

1. Select the instance that took the new build.
2. Watch memory across the live window for a step change that does not settle.
3. Cross-check the service's error rate in [Services](./services.md).

---

## FAQ

### Why doesn't Infra follow the time range I set?

Infra uses a fixed live window instead of the application time picker, either
5, 10, or 15 minutes depending on plugin settings. It reports clearly when no
instance has sent data during that interval. Every other APM tab follows the
time picker.

### Can I see which host or node runs a given service?

Not from this tab. Infra lists hosts or nodes, selected with the instance
selector, and does not map services onto them. Pick the instances you know run
the service, or use [k8X](../k8x/getting-started.md) when you need workloads
resolved to nodes.

### Why don't the charts share a crosshair?

Each chart uses a different unit or scale, so a shared crosshair would imply a
comparison the values do not support. Compare instances within a chart rather
than across them.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - The application side of the same regression
- [k8X](../k8x/getting-started.md) - Full Kubernetes fleet observability
- [Linux collector setup](../../instrument/collector-setup/linux-setup.md) -
  Send the host metrics this tab reads
- [Kubelet Stats](../../instrument/component/kubelet-stats.md) - Send the
  per-node metrics this tab reads in Kubernetes mode
