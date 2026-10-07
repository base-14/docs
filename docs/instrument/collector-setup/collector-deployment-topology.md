---
title: OpenTelemetry Collector deployment topology
sidebar_label: Deployment Topology
description:
  OpenTelemetry Collector topology for Kubernetes and VMs. Agent, Daemon, and
  Gateway Collector roles, which scale horizontally, and when to scale.
keywords:
  [
    opentelemetry collector topology,
    collector deployment,
    gateway collector,
    daemonset collector,
    scaling opentelemetry collector,
    agent to gateway,
  ]
tags: [opentelemetry, kubernetes, base14 scout]
sidebar_position: 1.5
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import ArchifyEmbed from '@site/src/components/ArchifyEmbed';

# OpenTelemetry Collector deployment topology

Scout collectors run in three roles. An Agent Collector scrapes managed
services, a Daemon Collector runs on each node (a VM Agent on each VM when
you run on virtual machines), and a Gateway Collector tier receives OTLP from
every other collector before anything leaves for Scout.

## Diagram

<Tabs>
<TabItem value="kubernetes" label="Kubernetes">

<ArchifyEmbed
  src="/diagrams/collector-topology/k8s.html"
  title="Scout collector topology on Kubernetes"
/>

</TabItem>
<TabItem value="vms" label="VMs">

<ArchifyEmbed
  src="/diagrams/collector-topology/vm.html"
  title="Scout collector topology on virtual machines"
/>

</TabItem>
</Tabs>

## Component roles

| Component | Kubernetes | VMs | Scaling | Why |
| --- | --- | --- | --- | --- |
| Agent Collector | Single replica | Single instance | **Singleton** (one per managed service) | Polls RDS, ElastiCache, and SQS. A second copy scrapes the same service twice. To grow, shard services so each has exactly one owner. |
| Daemon Collector / VM Agent | DaemonSet | One VM Agent per VM | **Singleton per node/VM** | Scrapes only its own host. The count grows with the fleet, never by adding replicas. |
| Gateway Collector | Horizontally scaled replicas | Horizontally scaled instances | **Horizontally scalable** | Stateless. Runs PII redaction and other transforms in one place before export. |

## Why the gateway owns PII and transforms

Every signal passes through the gateway, so redaction configured there
applies to all of it. That gives you one policy to maintain and one place to
audit, instead of a copy on every node that can fall out of step. The same
holds for filtering, attribute renames, and other transforms. See
[Filters and Transformations](/category/filters-and-transformations/) for the
processors and OTTL patterns.

## Scaling the collector

This section summarizes the OpenTelemetry guide
[Scaling the Collector](https://opentelemetry.io/docs/collector/scaling/).

**What to scale.** Treat each signal and receiver separately. A scraper owns
its targets, so it scales differently from a receiver that accepts pushed
OTLP.

**When to scale.** Watch for three things. The `memory_limiter` refuses data
(`otelcol_processor_refused_*` climbs). The exporter queue fills: add
capacity when `otelcol_exporter_queue_size` reaches about 60–70% of
`otelcol_exporter_queue_capacity`. A scrape takes nearly as long as its
interval, which means the targets need sharding.

**When not to scale.** If the queue stays near capacity after you enlarge it,
or `otelcol_exporter_send_failed_*` keeps rising, the backend or network is
the constraint. More collectors only add load to it.

**How to scale.** Put stateless collectors behind a gRPC-aware (L7) load
balancer and add replicas, keeping at least three so one failure is
survivable. An L4 balancer pins each long-lived OTLP/gRPC
connection to one replica, leaving new ones idle. Split scrape targets across
scrapers instead of duplicating them; on Kubernetes the Target Allocator does
this. Stateful processing such as tail sampling or span-to-metrics needs a
load-balancing exporter tier in front, routing by trace ID or service.

**What that means here.** The Agent Collector and the Daemon Collector or VM
Agent are scrapers, so each stays a singleton. The Gateway Collector is
stateless, so it scales out. Adding tail sampling to the gateway would make it
stateful and call for a load-balancing exporter tier in front of it.

## References

- [Scaling the Collector](https://opentelemetry.io/docs/collector/scaling/)
- [Agent deployment pattern](https://opentelemetry.io/docs/collector/deploy/agent/)
- [Gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/gateway/)
- [Agent-to-gateway pattern](https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/)
- [Target Allocator](https://opentelemetry.io/docs/platforms/kubernetes/operator/target-allocator/)
- [Load-balancing exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/loadbalancingexporter)

## FAQ

### Why can't I run two Agent Collectors for the same managed service?

Two Agent Collectors pointed at the same managed service collect every metric
twice. Each copy polls RDS, ElastiCache, or SQS on its own schedule, so Scout
receives duplicate series and you pay the provider's API cost twice. To spread
load, give each Agent Collector a different set of services so every service
has exactly one owner.

### How do I scale the Gateway Collector?

Add Gateway Collector replicas behind a gRPC-aware (L7) load balancer. The
gateway is stateless, so any replica can handle any request. An L4 balancer
keeps each OTLP/gRPC connection on the replica it first reached, which leaves
new replicas idle. Scale when the exporter queue passes about 60–70% of
capacity, and keep at least three replicas.

### Does the Daemon Collector scale horizontally?

No, the Daemon Collector runs exactly one copy per node, or one VM Agent per
VM. It scrapes only its own host, so a second copy on the same node would
duplicate that host's data. The number of Daemon Collectors grows as you add
nodes or VMs.

## Related guides

- [Kubernetes Helm Setup](./kubernetes-helm-setup.md) - Deploy the Scout
  Collector on Kubernetes with Helm
- [OpenTelemetry Operator Setup](./opentelemetry-operator-setup.md) -
  CRD-based collector management and the Target Allocator
- [Linux & VM Setup](./linux-setup.md) - Run the collector on virtual machines
- [Scout Exporter Configuration](./scout-exporter.md) - Configure
  authentication to send data to Scout
