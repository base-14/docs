---
title: Infra
sidebar_label: Infra
sidebar_position: 8
description:
  Check the health of the hosts or Kubernetes nodes running your services with
  the APM Infra tab in base14 Scout.
keywords:
  [
    apm,
    infrastructure,
    hosts,
    kubernetes nodes,
    cpu,
    memory,
    network,
    filesystem,
    base14,
    scout,
  ]
---

The Infra tab answers the question that follows every application regression:
is it the code, or the machine underneath? It shows CPU, memory, network, and
filesystem usage for the hosts or Kubernetes nodes running your services,
right next to your application metrics.

![Infra Tab](/img/apm/infra/infra-overview.png)

---

## Hosts or Kubernetes

Depending on how your environment runs, the tab shows one of two modes:

- **Hosts** — physical or virtual machines, identified by host name
- **Kubernetes** — cluster nodes, identified by node name

The selector in the topbar lists the discovered hosts or nodes; pick one to
focus every chart and the table on it.

---

## Charts

Four charts cover the core resources:

| Chart | What it shows |
| ----- | ------------- |
| **CPU Usage** | CPU utilization percentage per host/node |
| **Memory Usage** | Memory utilization percentage |
| **Network Usage** | Network receive throughput |
| **Filesystem Usage** | Disk space utilization |

The Infra tab always shows a short live window (up to 15 minutes) so it
reflects what the machines are doing right now.

![Infra Charts](/img/apm/infra/infra-charts.png)

---

## The Instances Table

Below the charts, a sortable table lists every host or node with its current
CPU, memory, network, and filesystem figures — a quick way to spot the one
machine that is saturated while the rest are idle.

---

## Alerts from Charts

Each chart's panel menu can open a pre-filled alert rule — for example, a high
CPU alert for your nodes — in Grafana's alert editor with a sensible threshold
already set.
