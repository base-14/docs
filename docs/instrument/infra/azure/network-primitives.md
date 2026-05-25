---
date: 2026-05-17
id: collecting-azure-network-primitives-telemetry
title: Azure Network Primitives Monitoring with OpenTelemetry - Public IPs, NICs, NAT Gateways, and Private Endpoints
sidebar_label: Azure Network Primitives
sidebar_position: 20
description:
  Wire Azure Public IP, Network Interface, NAT Gateway, and Private
  Endpoint telemetry into your existing OpenTelemetry Collector and
  ship it to base14 Scout. Covers the network-path metrics that matter
  (NAT SNAT health, NIC throughput, Private Endpoint volume), why the
  Public IP namespace is the weak member of this set, and the
  subscription-scope Activity Log path for control-plane audit.
keywords:
  - azure network monitoring opentelemetry
  - azure nat gateway snat metrics
  - azure private endpoint monitoring
  - azure network interface throughput
  - azure public ip metrics
  - azure monitor receiver network
  - snat port exhaustion alert
  - azure activity log opentelemetry
  - subscription diagnostic settings
  - azure event hub receiver
  - base14 scout azure network
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure network primitives with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and a single azure_monitor receiver with four namespaces under services - Microsoft.Network/publicIPAddresses, Microsoft.Network/networkInterfaces, Microsoft.Network/natGateways, and Microsoft.Network/privateEndpoints - route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing the network resources. The receiver polls Azure Monitor every 60 seconds. Every metric on these namespaces is traffic-gated: an idle Public IP, a detached NIC, an unused NAT Gateway, or a Private Endpoint carrying no traffic publishes nothing, which is expected and not a misconfiguration."}},{"@type":"Question","name":"Why does my Public IP publish almost no metrics?","acceptedAnswer":{"@type":"Answer","text":"The Microsoft.Network/publicIPAddresses namespace is the weak member of this set. A Public IP attached to a NAT Gateway publishes no byte or packet metrics at all - that traffic is accounted on the Microsoft.Network/natGateways namespace instead. A Public IP used as a plain VM front end emits only ByteCount and PacketCount, and only while it carries direct inbound traffic. SynCount and VipAvailability emit only behind a Standard Load Balancer front end, never on a NAT-attached or plain VM Public IP. The operationally meaningful network-path signal in this set lives on natGateways, networkInterfaces, and privateEndpoints; treat publicIPAddresses as low-signal by design and do not build alerts on it for NAT or plain-VM topologies."}},{"@type":"Question","name":"My receiver discovers more NICs than I have VMs. Why?","acceptedAnswer":{"@type":"Answer","text":"Every Private Endpoint injects its own auto-created network interface into the resource group. That PE NIC is a real Microsoft.Network/networkInterfaces resource but it publishes no Azure Monitor metrics - it is metric-silent by design. Expect the NIC resource count to exceed your VM count by the number of Private Endpoints in scope. When correlating NIC throughput to a VM, select the NIC whose virtualMachine property is set; the PE NICs have a nil virtualMachine and no series. This is expected and needs no filter."}},{"@type":"Question","name":"How do I alert on NAT Gateway SNAT port exhaustion?","acceptedAnswer":{"@type":"Answer","text":"SNAT port exhaustion is the NAT-Gateway-specific failure mode. Watch SNATConnectionCount split by its ConnectionState dimension - a rising count in the failed state, together with a non-zero and rising PacketDropCount, is the exhaustion signature. PacketDropCount sits at zero on a healthy NAT Gateway and rises only when SNAT ports are exhausted, so any sustained non-zero value is actionable. If your outbound path uses a Load Balancer rather than a NAT Gateway, SNAT metrics live on the Load Balancer namespace instead - see the Azure Load Balancer guide."}},{"@type":"Question","name":"Why are my Private Endpoint metrics zero even though the app works?","acceptedAnswer":{"@type":"Answer","text":"PEBytesIn and PEBytesOut count only traffic that actually traverses the Private Endpoint. They emit only when the consumer resolves the linked PaaS FQDN to the Private Endpoint's private IP, which requires a Private DNS Zone (for example privatelink.blob.core.windows.net) linked to the consumer's VNet. Without that DNS link the consumer resolves the resource's public endpoint, the application still works, and the Private Endpoint metrics stay at zero because no traffic crosses the PE. Confirm the VNet DNS link and that the FQDN resolves to a private VNet address from inside the consumer subnet. Service Endpoints have no equivalent metrics at all - PE metrics exist only for Private Endpoints."}},{"@type":"Question","name":"How do I audit who attached a Public IP or approved a Private Endpoint connection?","acceptedAnswer":{"@type":"Answer","text":"Network primitive resource types do not expose per-resource Diagnostic Settings categories (aside from DDoS categories on Public IPs that require a DDoS Protection Standard plan). The control-plane audit signal lives in the subscription-scope Activity Log. Configure a subscription Diagnostic Setting forwarding the Administrative category to an Event Hubs hub, point the azure_event_hub receiver at the hub, and apply a collector-side filter processor scoped to cloud.resource_id matching Microsoft.Network. The subscription Activity Log spans every resource provider, so a large fraction of records is dropped by the filter - that is expected and the filter is doing real work. Subscription-scope routing is not real-time; plan for 10-40 minutes to the first batch and 5-15 minutes steady-state."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for the Azure network
primitives - Public IPs, Network Interfaces, NAT Gateways, and
Private Endpoints. For the cross-surface architecture (auth, push vs
pull, latency, the trace gap), read [Azure Monitoring with
OpenTelemetry - Architecture for base14 Scout](./overview.md) first.

This guide is for engineers who run Azure network plumbing in
production and want to add Public IP, NIC, NAT Gateway, and Private
Endpoint telemetry to an existing OpenTelemetry Collector and ship it
to base14 Scout. The collector polls Azure Monitor's REST API for the
four `Microsoft.Network` namespaces every 60 seconds, and a sibling
pipeline ingests network control-plane operations from the
subscription Activity Log via Event Hubs as OTel logs.

These four resource types are monitored together because individually
each carries thin signal; together they answer one operational
question: **is my workload's network path healthy end to end** -
outbound (NAT Gateway plus its Public IP), the NIC itself, and
private-link traffic (Private Endpoint). Treat them as one
network-path story, not four unrelated surfaces.

> **Every metric here is traffic-gated.** Azure publishes nothing for
> an idle Public IP, a detached NIC, an unused NAT Gateway, or a
> Private Endpoint that carries no traffic. The series are absent or
> zero until the resource actually moves packets. This is the single
> most important interpretation caveat for this set: an empty
> scrape on a quiet resource is expected behaviour, not a receiver,
> whitelist, or RBAC failure. Confirm traffic is actually flowing
> before treating absent series as a fault.

This guide ships both paths: metrics via the `azure_monitor` receiver,
and network control-plane audit logs via the `azure_event_hub`
receiver fed from a **subscription-scope** Diagnostic Setting. See
[Receiver configuration](#receiver-configuration) for metrics and
[Logs](#logs) for the audit path.

## Network primitives at a glance

| Resource type | What it is | Why monitor it in the set |
| --- | --- | --- |
| `Microsoft.Network/publicIPAddresses` | A static or dynamic public IP, attached to a NAT Gateway, a Load Balancer front end, or directly to a VM NIC. | The **weak member** of this set (see below). Useful only as a plain VM front end, and even then only for raw byte/packet counts. |
| `Microsoft.Network/networkInterfaces` | The NIC attached to a VM. Throughput and packet rate at the interface layer. | The per-VM network throughput vantage. Strong signal whenever the attached VM passes traffic. |
| `Microsoft.Network/natGateways` | Managed outbound SNAT for a subnet. The modern replacement for outbound-rule Load Balancers and instance-level public IPs. | The outbound-path health vantage. SNAT connection counts and packet-drop are where outbound saturation shows up first. |
| `Microsoft.Network/privateEndpoints` | A private-link network interface into a PaaS resource (Storage, SQL, Key Vault, and so on) inside your VNet. | The private-link traffic-volume vantage. Confirms data is actually flowing over the PE and not leaking to the public endpoint. |

The four namespaces share several metric names (`ByteCount` and
`PacketCount` appear on both `publicIPAddresses` and `natGateways`). A
single-fragment multi-namespace receiver is the recommended shape: one
`services:` block listing all four, one `metrics:` block keyed by
namespace. Output is split downstream by `azuremonitor.resource_id`,
so same-named metrics from different resource types stay distinct.

### The Public IP namespace is the weak member - plan around it

`Microsoft.Network/publicIPAddresses` does not behave like the other
three. Its emission depends entirely on **how the Public IP is
attached**:

- **Attached to a NAT Gateway:** the Public IP publishes **no byte or
  packet metrics at all**. Outbound traffic through that IP is
  accounted on the `Microsoft.Network/natGateways` namespace instead.
  A NAT-fronting Public IP is effectively metric-silent.
- **Attached directly to a VM as a front end:** the Public IP emits
  only `ByteCount` and `PacketCount`, and only while it carries direct
  inbound traffic. These two counters are coarse and rarely the signal
  you want when the NIC namespace already gives you throughput.
- **`SynCount` and `VipAvailability`** emit only behind a **Standard
  Load Balancer** front end. They never emit on a NAT-attached or
  plain VM Public IP. Keep them in the whitelist (they cost nothing
  when absent) but do not expect them outside a Load Balancer
  topology - the [Azure Load Balancer guide](./load-balancer.md)
  covers that vantage.

The operational consequence: **do not build alerts or dashboards on
the Public IP namespace for NAT or plain-VM topologies.** The
network-path signal in this set lives on `natGateways`,
`networkInterfaces`, and `privateEndpoints`. The Public IP namespace
stays in the whitelist for the Load-Balancer-front-end case and for
completeness, not because it carries the set's signal.

## Topology choices and conditional metrics

The whitelist in [Receiver configuration](#receiver-configuration)
covers what these four resource types emit at the platform layer.
Several metrics are **topology-conditional** - they emit only in
specific network designs. Keep them in the whitelist regardless; they
cost nothing on topologies where they do not emit (Azure Monitor
returns no series and the receiver shows zero datapoints).

| Metric | Emits when | Keep in whitelist? |
| --- | --- | --- |
| `publicIPAddresses` / `ByteCount`, `PacketCount` | Only on a Public IP used as a **plain VM front end** carrying direct inbound. Silent when the Public IP fronts a NAT Gateway. | **Yes**, but expect silence in NAT topologies. Not an alerting signal. |
| `publicIPAddresses` / `SynCount`, `VipAvailability` | Only behind a **Standard Load Balancer** front end. | **Yes** for Load-Balancer-fronted Public IPs. Never emits on NAT or plain VM attachment - see the [Load Balancer guide](./load-balancer.md). |
| `natGateways` / `PacketDropCount` | Always present; sits at **zero on a healthy NAT Gateway** and rises only on SNAT port exhaustion. | **Yes** - the leading SNAT-exhaustion signal. Zero is the healthy state, not absence. |
| `natGateways` / `SNATConnectionCount` (with `ConnectionState`) | Always present once the subnet sends outbound traffic. The `ConnectionState` dimension splits attempted / failed connections. | **Yes** - the primary outbound-saturation signal. |
| `privateEndpoints` / `PEBytesIn`, `PEBytesOut` | Only when traffic actually traverses the Private Endpoint - which requires the consumer to resolve the PaaS FQDN to the PE private IP via a linked Private DNS Zone. | **Yes** - the private-link volume signal. Asymmetric In-vs-Out is normal and reflects the workload's read/write mix. |
| Public IP **DDoS family** (`BytesDroppedDDoS`, `IfUnderDDoSAttack`, `PacketsInDDoS`, ...) | Only with a **DDoS Protection Standard** plan attached (~$3k/mo). | **Not in this whitelist.** Add the DDoS metrics and the resource-scope DDoS log categories only if you run the plan. |

Choose the network design for the workload, not for telemetry. The
practical reading: if you run a NAT Gateway for outbound, your signal
is on `natGateways` plus `networkInterfaces`; the NAT-fronting Public
IP is plumbing you will not see in metrics. If you front a VM directly
with a Public IP, you get coarse byte/packet counts on that IP but the
NIC namespace remains the better throughput vantage. If you front a
Standard Load Balancer, `SynCount` and `VipAvailability` come alive -
but that is the Load Balancer guide's territory.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, and pipeline are all keyed `/network` so they coexist with
other Azure receivers under one collector and one Scout exporter. The
four Network namespaces are **not currently known to exhibit receiver
bug #45942** (the case-mismatched-dimensions bug seen on
`Microsoft.ApiManagement/service`, `Microsoft.Network/azureFirewalls`,
and a subset of `Microsoft.Storage` metrics on `azuremonitorreceiver`
v0.151.0). These four namespaces emit **no `metadata_*` dimensions at
all**, so a case-pair collision is structurally impossible and no
`transform` processor is required. Re-check on receiver upgrades.

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/network:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:NETWORK_RESOURCE_GROUP}
    services:
      - Microsoft.Network/publicIPAddresses
      - Microsoft.Network/networkInterfaces
      - Microsoft.Network/natGateways
      - Microsoft.Network/privateEndpoints
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Network/publicIPAddresses":
        ByteCount:        [Total]
        PacketCount:      [Total]
        SynCount:         [Total]
        VipAvailability:  [Average]
      "Microsoft.Network/networkInterfaces":
        BytesSentRate:        [Total]
        BytesReceivedRate:    [Total]
        PacketsSentRate:      [Total]
        PacketsReceivedRate:  [Total]
      "Microsoft.Network/natGateways":
        SNATConnectionCount:   [Total]
        TotalConnectionCount:  [Total]
        PacketCount:           [Total]
        PacketDropCount:       [Total]
        ByteCount:             [Total]
        DatapathAvailability:  [Average]
      "Microsoft.Network/privateEndpoints":
        PEBytesIn:   [Total]
        PEBytesOut:  [Total]

processors:
  resource/network:
    attributes:
      - {key: cloud.provider,    value: azure,                          action: insert}
      - {key: cloud.platform,    value: azure_network,                  action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: cloud.region,      value: "${env:NETWORK_REGION}",        action: insert}
      - {key: service.name,      value: "${env:NETWORK_SERVICE_NAME}",  action: insert}

service:
  pipelines:
    metrics/network:
      receivers: [azure_monitor/network]
      processors: [resource/network, batch]
      exporters: [otlp_http/b14]
```

The 16-metric whitelist (4 Public IP + 4 NIC + 6 NAT Gateway + 2
Private Endpoint) renames on the OTel side to lowercase snake-cased
series with the aggregation appended (for example
`Microsoft.Network/natGateways` `ByteCount` `[Total]` becomes the
`azure_byte_count_total` series). `ByteCount` and `PacketCount` exist
on both `publicIPAddresses` and `natGateways`; the receiver tags every
datapoint with `azuremonitor.resource_id` to keep the per-resource
split, so a NAT Gateway's `ByteCount` and a Public IP's `ByteCount`
never collide downstream.

> **No fixed `cloud.resource_id` on the resource processor.** This
> set scrapes four different resource types under one receiver. The
> receiver auto-injects `azuremonitor.resource_id` on each datapoint
> with the correct per-resource ID. Hard-coding `cloud.resource_id`
> from a single env var would tag every series with the same ID and
> break the per-resource split downstream. Leave it off the resource
> processor whenever the receiver covers more than one resource type
> (the same rule applies to the Compute and App Service guides).

## Authentication and RBAC

The collector authenticates to Azure Monitor as a service principal
holding **`Monitoring Reader`** at the **resource group** containing
the network resources. Resource-group scope is the minimum necessary;
subscription scope works but is broader than needed.

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Monitoring Reader" \
  --scope "$(az group show --name <rg> --query id -o tsv)"
```

`Monitoring Reader` is sufficient for the metrics path. The collector
never touches a data plane - it cannot open a socket through the NAT
Gateway, read packets off a NIC, or send traffic through a Private
Endpoint. None of the `Network Contributor` or data-plane-equivalent
roles are required.

The logs path adds a separate auth requirement at subscription scope -
see [Logs](#logs).

Two propagation delays apply to the metrics path after first
assignment:

1. **Control-plane RBAC propagation** - typically 60-300 seconds
   before the receiver's `metricDefinitions` and `metrics` REST calls
   succeed. The receiver retries on its 60-second poll cycle.
2. **First-poll metric-definitions race** - Azure Monitor's
   `metricDefinitions` catalog can take 60-180 seconds to populate
   after a freshly-deployed network resource reaches
   `provisioningState: Succeeded`. The receiver caches an empty list
   if it polls during that window. Mitigation: restart the collector
   3-5 minutes after the resources reach `Succeeded` **and** traffic
   has started, or accept the delay and the next poll cycle picks up
   the populated catalog.

## What you'll monitor

The tables below are keyed by the Azure metric name (the authoritative
name from Microsoft's supported-metrics reference). The receiver emits
each as a lowercase snake-cased `azure_*` series with the aggregation
suffixed. Every series is traffic-gated.

### Public IPs (`Microsoft.Network/publicIPAddresses`)

| Azure metric | Aggregation | Use case |
| --- | --- | --- |
| `ByteCount` | Total | Bytes through the Public IP. **Emits only on a plain VM front end carrying direct inbound. Silent when the Public IP fronts a NAT Gateway** - that traffic is on the NAT Gateway namespace. |
| `PacketCount` | Total | Packets through the Public IP. Same plain-VM-front-end-only behaviour as `ByteCount`. |
| `SynCount` | Total | TCP SYN count. Emits only behind a Standard Load Balancer front end - never on NAT or plain VM attachment. |
| `VipAvailability` | Average | Data-path availability of the VIP. Emits only behind a Standard Load Balancer front end. |

Read this namespace as low-signal by design for NAT and plain-VM
topologies. Its purpose in this set is completeness and the
Load-Balancer-front-end case; the byte/packet counters here are not an
alerting signal in a NAT design.

### Network Interfaces (`Microsoft.Network/networkInterfaces`)

| Azure metric | Aggregation | Use case |
| --- | --- | --- |
| `BytesSentRate` | Total | NIC egress throughput. Strong signal whenever the attached VM passes traffic. |
| `BytesReceivedRate` | Total | NIC ingress throughput. The primary per-VM network-volume vantage. |
| `PacketsSentRate` | Total | NIC egress packet rate. Pairs with `BytesSentRate` to derive average packet size. |
| `PacketsReceivedRate` | Total | NIC ingress packet rate. |

> **Private Endpoints inject their own NICs.** Every Private Endpoint
> creates an auto-generated `Microsoft.Network/networkInterfaces`
> resource. That PE NIC is **metric-silent by design** - it publishes
> no Azure Monitor series. Expect the NIC resource count to exceed
> your VM count by the number of Private Endpoints in scope. When
> correlating NIC throughput to a VM, select the NIC whose
> `virtualMachine` property is set; the PE NICs have a nil
> `virtualMachine` and no series. This is expected and needs no
> filter - the PE NICs simply contribute nothing to the metrics
> pipeline.

### NAT Gateways (`Microsoft.Network/natGateways`)

| Azure metric | Aggregation | Use case |
| --- | --- | --- |
| `SNATConnectionCount` | Total | Outbound SNAT connections. Carries a `ConnectionState` dimension (attempted / failed) and a `Protocol` dimension. **The primary outbound-saturation signal.** |
| `TotalConnectionCount` | Total | Total active connections through the NAT Gateway. |
| `PacketCount` | Total | Packets through the NAT Gateway (the outbound-path counterpart to the silent NAT-attached Public IP). |
| `PacketDropCount` | Total | Dropped packets. **Sits at zero on a healthy NAT Gateway and rises only on SNAT port exhaustion.** Any sustained non-zero value is actionable. |
| `ByteCount` | Total | Bytes through the NAT Gateway. The outbound volume vantage. |
| `DatapathAvailability` | Average | NAT Gateway data-path availability. |

`PacketDropCount` at zero is the **healthy** state, not an absent
series - the NAT Gateway always reports it once the subnet sends
outbound traffic. SNAT port exhaustion is the NAT-Gateway-specific
failure mode; see [Alert tuning](#alert-tuning).

### Private Endpoints (`Microsoft.Network/privateEndpoints`)

| Azure metric | Aggregation | Use case |
| --- | --- | --- |
| `PEBytesIn` | Total | Bytes into the Private Endpoint (from the consumer toward the PaaS resource). |
| `PEBytesOut` | Total | Bytes out of the Private Endpoint (PaaS resource back to the consumer). |

> **Private Endpoint metrics require the DNS link to be correct.**
> `PEBytesIn` / `PEBytesOut` count only traffic that actually
> traverses the Private Endpoint. The consumer must resolve the linked
> PaaS FQDN (for example `<account>.blob.core.windows.net`) to the
> PE's private IP, which requires a Private DNS Zone (for example
> `privatelink.blob.core.windows.net`) linked to the consumer's VNet.
> Without that link the consumer resolves the resource's public
> endpoint, the application keeps working, and the PE metrics stay at
> zero because no traffic crosses the PE. An In-vs-Out asymmetry is
> normal and reflects the workload's read/write mix. Service Endpoints
> have **no equivalent metrics at all** - PE metrics exist only for
> Private Endpoints.

### Operations notes

- **Idle and detached resources publish nothing.** A reserved-but-idle
  Public IP, a NIC on a stopped VM, a NAT Gateway on a quiet subnet,
  and a Private Endpoint with no traffic all emit zero or absent
  series. This is expected; do not alert on absence alone for these
  resource types.
- **`SynCount` / `VipAvailability` need a Standard Load Balancer.**
  They never emit on NAT-attached or plain VM Public IPs. If you need
  these, the resource you actually care about is a Load Balancer -
  see the [Load Balancer guide](./load-balancer.md).
- **NAT Gateway vs Load Balancer outbound.** SNAT exhaustion metrics
  live on `natGateways` only when the subnet's outbound path is a NAT
  Gateway. If outbound is via a Load Balancer outbound rule instead,
  the SNAT signal is on the Load Balancer namespace - the
  network-path story moves with the design.
- **DDoS metrics are plan-gated.** The Public IP DDoS family
  (`BytesDroppedDDoS`, `IfUnderDDoSAttack`, and so on) and the
  resource-scope DDoS log categories require a DDoS Protection
  Standard plan (~$3k/mo). They are intentionally absent from this
  whitelist; add them only if you run the plan.

## Cardinality control

These four namespaces emit a small, bounded dimension set and **no
`metadata_*` dimensions at all**, so cardinality is low and
predictable. The only fan-out vector is the `ConnectionState` /
`Protocol` split on the NAT Gateway's `SNATConnectionCount`.

| Attribute | Source | Cardinality |
| --- | --- | --- |
| `azuremonitor.resource_id` | Receiver | One per network resource (low). |
| `name` | Receiver | One per resource. |
| `resource_group` | Receiver | One per RG. |
| `type` | Receiver | Constant per namespace (four values). |
| `location` | Receiver | One per region. |
| `ConnectionState`, `Protocol` | Azure Monitor (NAT `SNATConnectionCount` only) | A few values (attempted / failed; TCP / UDP). Bounded - not a fan-out risk. |

A resource group with 10 VMs (10 NICs), one NAT Gateway, its Public
IP, and 5 Private Endpoints (5 metric-silent PE NICs) lands at roughly:

- Public IP: 1 resource, mostly silent on NAT topology - ~0-2
  datapoints/scrape.
- NICs: 10 VM NICs x 4 series = 40 datapoints/scrape (the 5 PE NICs
  contribute nothing).
- NAT Gateway: 1 resource x 6 series, with `SNATConnectionCount` split
  by `ConnectionState` - ~8 datapoints/scrape.
- Private Endpoints: 5 resources x 2 series = 10 datapoints/scrape.

Total: roughly 60 datapoints/scrape per minute - negligible against
Scout's default capacity for any reasonable plan. Network primitives
are one of the lowest-cardinality Azure surfaces.

## Alert tuning

Network-primitive alerting centres on the **outbound path** (NAT
Gateway) and **per-VM throughput** (NIC). The Public IP namespace is
not an alerting surface in NAT or plain-VM topologies.

### NAT Gateway - SNAT port exhaustion

SNAT port exhaustion is the single most important network-primitive
failure mode and the one customers hit in production. The exhaustion
signature is a rising failed-state `SNATConnectionCount` together with
a non-zero, rising `PacketDropCount`.

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **SNAT connection failures** | `SNATConnectionCount` filtered to the `ConnectionState` = failed dimension | > 0 sustained / 5m | rising trend / 5m | A healthy NAT Gateway has near-zero failed connections. Any sustained failed-state count means the SNAT port pool is under pressure. Add NAT Gateway public IPs or a Public IP Prefix to expand the port pool. |
| **Packet drop** | `PacketDropCount` | > 0 / 5m | rising trend / 5m | Zero is the healthy state. Non-zero means SNAT ports are exhausted and connections are being dropped. This is a hard customer-facing failure - treat any sustained non-zero value as critical. |
| **Datapath availability** | `DatapathAvailability` | < 100% / 5m | < 99% / 5m | The NAT Gateway data path itself degrading. Rare; an Azure-side issue rather than a workload one. |
| **Outbound volume anomaly** | `ByteCount` rate | configurable | configurable | Alert on absolute byte/sec deltas over a baseline rather than fixed thresholds. Useful for catching a runaway egress process or a data-exfiltration anomaly. |

### NIC - throughput saturation

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **Egress saturation** | `BytesSentRate` | > 70% of the VM SKU's network cap / 5m | > 85% / 5m | Each VM SKU has a documented network bandwidth cap (for example a D2s_v3 caps around 1 Gbps). Compute the threshold against the SKU's published cap. |
| **Ingress saturation** | `BytesReceivedRate` | > 70% of cap / 5m | > 85% / 5m | Same SKU-cap reasoning as egress. |
| **Packet-rate anomaly** | `PacketsSentRate` / `PacketsReceivedRate` | configurable | configurable | A high packet rate with low byte rate indicates many tiny packets (chatty protocol, SYN flood, or a misbehaving client). Derive average packet size from the byte/packet ratio at the query layer. |

### Private Endpoint - volume and continuity

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **Traffic stopped** | `PEBytesIn` + `PEBytesOut` | sustained zero during expected-traffic window | sustained zero / 15m | A Private Endpoint that was carrying traffic and goes to zero during a window you expect activity often means a DNS regression (the consumer started resolving the public endpoint) or a connection-approval state change. Cross-check the Private DNS Zone link and the PE connection state. |

The Public IP namespace has no recommended alert rule for NAT or
plain-VM topologies. If your Public IP fronts a Standard Load
Balancer, `VipAvailability` and `SynCount` become meaningful - that
alerting is covered in the [Load Balancer guide](./load-balancer.md).

## Host and app-side network telemetry

The metrics in this guide describe the network primitives at the Azure
platform layer - the NIC, the NAT Gateway, the Private Endpoint as
resources. They do not describe per-process or per-connection network
behaviour inside the VM. For that vantage:

- **In-guest host network counters** via the OTel
  [hostmetricsreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/hostmetricsreceiver)
  running on the VM (the `network` scraper), or Azure Monitor Agent
  with a Data Collection Rule. This gives per-interface, per-protocol,
  and connection-state counters from inside the OS - depth the
  platform-layer NIC metrics cannot reach. See the [Azure Compute
  guide](./compute.md) for the in-guest collector pattern.
- **App-side network telemetry** via the OTel auto-instrumentation
  agents for Java, .NET, Python, Node.js, or Go. The agents emit
  client/server spans with peer addresses and latencies, which is the
  right vantage for "which downstream call is slow" rather than "is
  the NIC saturated". See the per-language guides under
  `instrument/{language}/`.

These are complementary vantages, not alternatives: the platform-layer
metrics in this guide tell you whether the network path is healthy;
the in-guest and app-side telemetry tell you which process and which
code path is responsible for the traffic. This guide ships the
platform-layer path end to end; the host and app-side paths are
cross-links, not validated here.

## Logs

Resource-level metrics aggregate counters at 1-minute granularity.
They cannot answer **who** attached or detached a Public IP, **who**
approved a Private Endpoint connection, **when** a NAT Gateway was
bound to or unbound from a subnet, **from where**, **with what
identity**, or **why**. Three operational gaps the network
control-plane Activity Log fills where metrics cannot:

- **Per-operation control-plane audit** records each Public IP
  associate/disassociate, Private Endpoint connection approval or
  rejection, NAT Gateway subnet binding change, and NIC
  attach/detach, with the requester's identity (UPN, app ID, OID),
  source IP, correlation ID, and result status. The metrics path sees
  throughput drop to zero on a disassociation but cannot attribute
  the action.
- **Per-resource lifecycle** preserves the create / update / delete
  history of every network primitive, useful for change diagnostics
  ("when did this Private Endpoint connection get re-approved", "who
  moved the NAT Gateway off this subnet last Tuesday") and capacity
  audits.
- **Cross-provider correlation** is available in the same Activity Log
  stream - the network changes that accompany a VM resize or a VMSS
  scale event appear alongside the Compute records. The default
  filter scopes to `Microsoft.Network`; broaden it (see [Filter
  expression](#filter-expression-broadening-and-narrowing)) when you
  need correlated forensics across providers.

Network primitive resource types do **not** expose useful per-resource
Diagnostic Settings categories. `publicIPAddresses` has DDoS-only
categories that require a DDoS Protection Standard plan;
`networkInterfaces`, `natGateways`, and `privateEndpoints` have none.
The control-plane audit signal lives in the **subscription-scope**
Activity Log instead. This is the same shape as the
[Compute](./compute.md) logs path, and the meaningful difference from
the resource-scope Diagnostic Settings used by
[Storage](./storage.md) and [Key Vault](./key-vault.md).

The recommended pattern is **subscription Activity Log to Event Hubs
to `azure_event_hub` plus a `filter` processor** in the same
collector. The receiver ingests events as OTel logs, the filter scopes
to `Microsoft.Network` records only, and the resource processor tags
them with `cloud.platform: azure_network`. Everything routes to Scout
via the same `oauth2client` / `otlp_http/b14` pipeline used for
metrics.

```yaml showLineNumbers title="otel-collector.yaml (logs excerpt)"
receivers:
  azure_event_hub/networklogs:
    connection: ${env:NETWORKLOGS_CONNECTION_STRING}
    partition: ""
    offset: ""
    format: azure
    apply_semantic_conventions: true

processors:
  filter/networkonly:
    error_mode: ignore
    logs:
      log_record:
        - 'resource.attributes["cloud.resource_id"] == nil'
        - 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/[Mm][Ii][Cc][Rr][Oo][Ss][Oo][Ff][Tt]\\.[Nn][Ee][Tt][Ww][Oo][Rr][Kk]/.*")'

  resource/networklogs:
    attributes:
      - {key: cloud.provider,    value: azure,                          action: insert}
      - {key: cloud.platform,    value: azure_network,                  action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: service.name,      value: "${env:NETWORKLOGS_SERVICE_NAME}", action: insert}

service:
  pipelines:
    logs/networklogs:
      receivers: [azure_event_hub/networklogs]
      processors: [filter/networkonly, resource/networklogs, batch]
      exporters: [otlp_http/b14]
```

The `connection` string must include the `EntityPath=<hub-name>`
suffix so the receiver knows which hub to consume. The receiver
defaults to consuming all partitions from the oldest available offset
(`partition: ""`, `offset: ""`); on collector restart it re-reads from
the saved offset, providing at-least-once delivery.

> **Why the filter expression looks so paranoid.** The
> `azure_event_hub` receiver with `format: azure` plus
> `apply_semantic_conventions: true` places the per-record Azure
> resource ID at `resource.attributes["cloud.resource_id"]` (OTel
> semantic-conventions form, **not** `azure.resource.id`), and
> UPPERCASES it. The filter regex matches case-insensitively against
> `[Mm]icrosoft\.[Nn]etwork` to handle the inconsistency and protect
> against future Azure-side changes. The first rule
> (`resource.attributes["cloud.resource_id"] == nil`) drops records
> that arrive without a resource ID at all. Together the two rules
> pass only records with a `Microsoft.Network` provider segment and
> drop everything else.

### Wiring the subscription Diagnostic Setting

Subscription-scope Diagnostic Settings use a different `az` subcommand
than resource-scope: `az monitor diagnostic-settings subscription
create`. Three flag-name differences from resource-scope:

| Resource-scope (Storage, Key Vault, etc.) | Subscription-scope (this guide) |
| --- | --- |
| `--event-hub <hub-name>` | `--event-hub-name <hub-name>` |
| `--event-hub-rule <armId>` | `--event-hub-auth-rule <armId>` |
| (no location flag) | `--location global` |

```bash
az monitor diagnostic-settings subscription create \
  --name network-activity-log \
  --location global \
  --event-hub-name "$EVENT_HUB_NAME" \
  --event-hub-auth-rule "$DIAG_SEND_RULE_ARM_ID" \
  --logs '[{"category":"Administrative","enabled":true}]'
```

The `--event-hub-auth-rule` value is the full ARM resource ID of a
namespace-level SAS authorization rule with `Send` rights. Microsoft's
documentation is imprecise on the flag name
(`--event-hub-auth-rule-id` is rejected on `az` CLI 2.85.0); use
`--event-hub-auth-rule`.

The `Administrative` category covers `create`, `update`, `delete`,
associate, disassociate, and similar control-plane operations across
**every** resource provider in the subscription - including the
Public IP, NIC, NAT Gateway, and Private Endpoint operations this
guide cares about. The collector-side filter then scopes it to
`Microsoft.Network`. Other categories (`Security`, `ServiceHealth`,
`Alert`, `Recommendation`, `Policy`, `Autoscale`, `ResourceHealth`)
are typically routed elsewhere - see [Why not other
categories](#why-not-other-categories).

### Auth for the subscription Diagnostic Setting

Creating a subscription-scope Diagnostic Setting requires
**`Monitoring Contributor`** at **subscription scope**. This is
broader than the metrics path's `Monitoring Reader` at RG scope, and a
deliberate split: the role lives on the **operator's signed-in user
identity** (a human Microsoft Entra ID account), not on the long-lived
service principal that the collector uses for the metrics path.

```bash
OPERATOR_OID="$(az ad signed-in-user show --query id -o tsv)"
az role assignment create \
  --assignee-object-id "$OPERATOR_OID" \
  --assignee-principal-type User \
  --role "Monitoring Contributor" \
  --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID"
```

The role assignment is permanent unless revoked. Operators who manage
compliance boundaries can revoke it once the Diagnostic Setting is in
place:

```bash
az role assignment delete \
  --assignee "$OPERATOR_OID" \
  --role "Monitoring Contributor" \
  --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID"
```

After revocation, the subscription Diagnostic Setting continues to
ship records to Event Hubs; modifying it later requires re-granting
the role.

### Diagnostic Settings ship cadence

Azure batches subscription Activity Log records and ships them to
Event Hubs on a non-real-time cadence. Subscription-scope routing is
slower than resource-scope:

- **First batch from a freshly-wired subscription Diagnostic Setting:
  10-40 minutes.** Resource-scope Diagnostic Settings ship the first
  batch within 5-20 minutes; subscription-scope routing adds a hop
  and stretches the upper bound. Plan for 40 minutes and do not treat
  an empty pipeline in that window as a failure.
- **Steady-state batches: 5-15 minutes.**
- **End-to-end latency from operation to Scout: 5-15 minutes
  steady-state, 10-40 minutes for the first batch.** Audit visibility
  is **not** real-time. For real-time control-plane security
  monitoring, use Microsoft Defender for Cloud or Azure Sentinel. The
  OTel path is appropriate for audit retention, compliance reporting,
  and forensic analysis where per-event minutes-of-lag is acceptable.

### Filter expression: broadening and narrowing

The subscription Activity Log spans **every** resource provider in the
subscription, while the filter passes only `Microsoft.Network`
records. On any real subscription the filter drops the large majority
of records - that is normal and the filter is doing real work. Even a
network-focused resource group also holds `Microsoft.Compute` (the
VMs whose NICs you monitor), `Microsoft.Storage` (Private Endpoint
targets), and `Microsoft.EventHub` (this sink), all of which produce
Activity Log records the filter drops.

To **broaden** the filter to additional providers, add them to the
regex alternation:

```yaml
- 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/(?:[Mm]icrosoft\\.[Nn]etwork|[Mm]icrosoft\\.[Cc]ompute)/.*")'
```

To **narrow** to specific network operations, add a second rule on
the operation name:

```yaml
filter/networkonly:
  error_mode: ignore
  logs:
    log_record:
      - 'resource.attributes["cloud.resource_id"] == nil'
      - 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/[Mm][Ii][Cc][Rr][Oo][Ss][Oo][Ff][Tt]\\.[Nn][Ee][Tt][Ww][Oo][Rr][Kk]/.*")'
      # Drop everything except associate/disassociate/write/delete ops
      - 'not IsMatch(attributes["azure.operation.name"], ".*(?i:write|delete|join|action)$")'
```

### Why not other categories

- **`Security`** records Defender / Sentinel alerts. These flow
  through dedicated security pipelines rather than the OTel logs path.
- **`ServiceHealth`** records Azure service-health events. Better
  routed through Azure Service Health alerts or a separate
  service-health-only Diagnostic Setting.
- **`Alert`** records firings of Azure Monitor alert rules. Routing
  alert firings back through the Activity Log creates feedback loops.
- **`Recommendation`** is Azure Advisor output - not real-time
  operational telemetry.
- **`Policy`** records Azure Policy compliance evaluations - belongs
  in a compliance pipeline.
- **`Autoscale`** records autoscale rule firings. Re-enable it if you
  correlate autoscale events (which churn NICs and Public IPs) with
  network control-plane audit.
- **`ResourceHealth`** records per-resource health-state changes.
  Worth enabling as a follow-on once network audit is in place -
  Private Endpoint and NAT Gateway health transitions show up here.

## Troubleshooting

### Empty scrape on a resource that exists

Symptom: the receiver discovers the Public IP / NIC / NAT Gateway /
Private Endpoint but emits no datapoints for it. Cause: every metric
on these namespaces is traffic-gated. An idle Public IP, a NIC on a
stopped VM, a NAT Gateway on a quiet subnet, or a Private Endpoint
with no traffic publishes nothing. Fix: confirm traffic is actually
flowing before treating this as a fault. This is expected behaviour,
not a receiver, whitelist, or RBAC problem.

### Public IP publishes no byte/packet metrics

Symptom: a Public IP resource is discovered but `ByteCount` /
`PacketCount` stay empty. Cause: the Public IP is attached to a NAT
Gateway, which accounts that traffic on the `natGateways` namespace
instead - a NAT-fronting Public IP is metric-silent by design. Fix:
read the outbound signal off `Microsoft.Network/natGateways`
(`ByteCount`, `PacketCount`, `SNATConnectionCount`). The Public IP
namespace only emits byte/packet counts on a plain VM front end.

### NIC count exceeds VM count

Symptom: `resources_count` reports more NICs than you have VMs, and
the extra NICs emit nothing. Cause: every Private Endpoint injects an
auto-created NIC that is metric-silent by design. Fix: this is
expected. When correlating NIC throughput to a VM, select the NIC
whose `virtualMachine` property is set; the PE NICs have a nil
`virtualMachine` and contribute no series.

### Private Endpoint metrics are zero but the app works

Symptom: `PEBytesIn` / `PEBytesOut` stay at zero while the application
successfully reaches the PaaS resource. Cause: the consumer is
resolving the resource's public endpoint, not the Private Endpoint
private IP, so traffic never crosses the PE. Fix: confirm a Private
DNS Zone (for example `privatelink.blob.core.windows.net`) is linked
to the consumer's VNet and that the PaaS FQDN resolves to a private
VNet address from inside the consumer subnet
(`dig +short <account>.blob.core.windows.net` should return a private
VNet address, not a public one).

### `metrics_definitions_count: 0` on first poll after provisioning

Symptom: the receiver logs `metrics_definitions_count: 0` and emits
no metrics for one or more network resources. Cause: Azure Monitor's
`metricDefinitions` catalog has not yet populated for the
freshly-deployed resource, or the resource has not yet carried
traffic. Fix: ensure traffic is flowing, then restart the collector
after the resources have been up for at least 3 minutes, OR wait and
the next 60-second poll picks up the now-populated catalog.

### `AuthorizationFailed` from the receiver in the first 60 seconds

Symptom: the receiver logs `AuthorizationFailed` or `403` shortly
after provisioning. Cause: `Monitoring Reader` was granted but Azure
RBAC is still propagating. Fix: wait 60-300 seconds; the receiver
retries on its next poll cycle. If it persists past 5 minutes, verify
the assignment with
`az role assignment list --assignee <sp-app-id> --scope <rg-id>`.

### Network logs path: empty Event Hubs for 30+ minutes

Symptom: `azure_event_hub/networklogs` reports zero events for the
first 30 or more minutes after the subscription Diagnostic Setting is
created. Cause: subscription-scope Diagnostic Settings ship the first
batch on a 10-40 minute cadence. Fix: wait. Subsequent batches arrive
in 5-15 minutes. Verify the Diagnostic Setting with
`az monitor diagnostic-settings subscription show --name network-activity-log`.

### Filter processor drops all log records

Symptom: `filter/networkonly` shows incoming records but
`outgoing_items_total` stays at zero. Cause: the receiver places the
resource ID at `resource.attributes["cloud.resource_id"]`, not
`azure.resource.id`, and UPPERCASES it. A filter expression targeting
the wrong attribute name or doing a case-sensitive match drops every
record. Fix: use the filter shape in this guide, which checks
`resource.attributes["cloud.resource_id"]` case-insensitively.

### Subscription Diagnostic Setting rejects `--event-hub-auth-rule-id`

Symptom: `az monitor diagnostic-settings subscription create` fails
with `unrecognized arguments: --event-hub-auth-rule-id`. Cause: the
flag is `--event-hub-auth-rule` (no `-id` suffix) on `az` CLI 2.85.0.
Fix: use `--event-hub-auth-rule "$DIAG_SEND_RULE_ARM_ID"` exactly.

### Scout OAuth2 returns 401

Symptom: the `oauth2client` extension logs 401 from the token
endpoint. Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` /
`SCOUT_TOKEN_URL`. Fix: re-source the Scout credential env file (or
the equivalent secret store) and restart the collector.

## Frequently Asked Questions

### How do I monitor Azure network primitives with OpenTelemetry?

Add the `azure_auth` extension and a single `azure_monitor` receiver
with four namespaces under `services:` -
`Microsoft.Network/publicIPAddresses`,
`Microsoft.Network/networkInterfaces`,
`Microsoft.Network/natGateways`, and
`Microsoft.Network/privateEndpoints` - route the receiver into a
metrics pipeline that exports to Scout via the
`oauth2client`-authenticated OTLP/HTTP exporter, and grant the
collector's service principal `Monitoring Reader` at the resource
group containing the network resources. The receiver polls Azure
Monitor every 60 seconds. Every metric on these namespaces is
traffic-gated: an idle Public IP, a detached NIC, an unused NAT
Gateway, or a Private Endpoint carrying no traffic publishes nothing,
which is expected and not a misconfiguration.

### Why does my Public IP publish almost no metrics?

The `Microsoft.Network/publicIPAddresses` namespace is the weak member
of this set. A Public IP attached to a NAT Gateway publishes no
byte or packet metrics at all - that traffic is accounted on the
`Microsoft.Network/natGateways` namespace instead. A Public IP used as
a plain VM front end emits only `ByteCount` and `PacketCount`, and
only while it carries direct inbound traffic. `SynCount` and
`VipAvailability` emit only behind a Standard Load Balancer front end,
never on a NAT-attached or plain VM Public IP. The operationally
meaningful network-path signal in this set lives on `natGateways`,
`networkInterfaces`, and `privateEndpoints`; treat `publicIPAddresses`
as low-signal by design and do not build alerts on it for NAT or
plain-VM topologies.

### My receiver discovers more NICs than I have VMs. Why?

Every Private Endpoint injects its own auto-created network interface
into the resource group. That PE NIC is a real
`Microsoft.Network/networkInterfaces` resource but it publishes no
Azure Monitor metrics - it is metric-silent by design. Expect the NIC
resource count to exceed your VM count by the number of Private
Endpoints in scope. When correlating NIC throughput to a VM, select
the NIC whose `virtualMachine` property is set; the PE NICs have a nil
`virtualMachine` and no series. This is expected and needs no filter.

### How do I alert on NAT Gateway SNAT port exhaustion?

SNAT port exhaustion is the NAT-Gateway-specific failure mode. Watch
`SNATConnectionCount` split by its `ConnectionState` dimension - a
rising count in the failed state, together with a non-zero and rising
`PacketDropCount`, is the exhaustion signature. `PacketDropCount` sits
at zero on a healthy NAT Gateway and rises only when SNAT ports are
exhausted, so any sustained non-zero value is actionable. If your
outbound path uses a Load Balancer rather than a NAT Gateway, SNAT
metrics live on the Load Balancer namespace instead - see the [Azure
Load Balancer guide](./load-balancer.md).

### Why are my Private Endpoint metrics zero even though the app works?

`PEBytesIn` and `PEBytesOut` count only traffic that actually
traverses the Private Endpoint. They emit only when the consumer
resolves the linked PaaS FQDN to the Private Endpoint's private IP,
which requires a Private DNS Zone (for example
`privatelink.blob.core.windows.net`) linked to the consumer's VNet.
Without that DNS link the consumer resolves the resource's public
endpoint, the application still works, and the Private Endpoint
metrics stay at zero because no traffic crosses the PE. Confirm the
VNet DNS link and that the FQDN resolves to a private VNet address
from inside the consumer subnet. Service Endpoints have no equivalent
metrics at all - PE metrics exist only for Private Endpoints.

### How do I audit who attached a Public IP or approved a Private Endpoint connection?

Network primitive resource types do not expose per-resource Diagnostic
Settings categories (aside from DDoS categories on Public IPs that
require a DDoS Protection Standard plan). The control-plane audit
signal lives in the subscription-scope Activity Log. Configure a
subscription Diagnostic Setting forwarding the `Administrative`
category to an Event Hubs hub, point the `azure_event_hub` receiver at
the hub, and apply a collector-side `filter` processor scoped to
`cloud.resource_id` matching `Microsoft.Network`. The subscription
Activity Log spans every resource provider, so a large fraction of
records is dropped by the filter - that is expected and the filter is
doing real work. Subscription-scope routing is not real-time; plan for
10-40 minutes to the first batch and 5-15 minutes steady-state.

## Reference

- [Microsoft.Network/publicIPAddresses supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-publicipaddresses-metrics)
- [Microsoft.Network/networkInterfaces supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-networkinterfaces-metrics)
- [Microsoft.Network/natGateways supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-natgateways-metrics)
- [Microsoft.Network/privateEndpoints supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-privateendpoints-metrics)
- [NAT Gateway SNAT and port
  exhaustion](https://learn.microsoft.com/azure/nat-gateway/nat-gateway-resource)
- [Azure Monitor Activity Log
  schema](https://learn.microsoft.com/azure/azure-monitor/essentials/activity-log-schema)
- [Subscription Diagnostic Settings
  reference](https://learn.microsoft.com/azure/azure-monitor/essentials/activity-log#diagnostic-settings)
- [opentelemetry-collector-contrib
  azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- [opentelemetry-collector-contrib
  azureeventhubreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azureeventhubreceiver)

## Related Guides

- [Azure Monitoring with OpenTelemetry - Architecture](./overview.md) -
  start here for the cross-surface story.
- [Azure Load Balancer](./load-balancer.md) - the L4 outbound and
  front-end alternative to a NAT Gateway; `SynCount` and
  `VipAvailability` on a Public IP belong to this surface.
- [Azure Compute](./compute.md) - the VMs behind the NICs in this
  set; the in-guest `hostmetrics` network counters and the
  subscription-scope Activity Log path are companions to this guide.
- [Azure Storage](./storage.md) - a common Private Endpoint target;
  resource-scope Diagnostic Settings logs path counterpart to this
  guide's subscription-scope path.
- [Azure Application Gateway](./application-gateway.md) - WAF + L7
  load balancer that often fronts the same VNet-internal workloads.
