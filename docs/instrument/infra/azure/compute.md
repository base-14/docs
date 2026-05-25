---
date: 2026-05-10
id: collecting-azure-compute-telemetry
title: Azure Compute Monitoring with OpenTelemetry - VMs, VM Scale Sets, and Managed Disks
sidebar_label: Azure Compute
sidebar_position: 15
description:
  Wire Azure VM, Virtual Machine Scale Set, and Managed Disk telemetry
  into your existing OpenTelemetry Collector and ship to base14 Scout.
  Covers Percentage CPU, Network bytes, Disk IOPS and bytes,
  Available Memory Bytes, and the subscription-scope Activity Log path
  for control-plane audit (who restarted, resized, scaled, or detached
  resources) that resource-level metrics cannot provide.
keywords:
  - azure compute monitoring
  - azure vm opentelemetry
  - azure vmss monitoring
  - virtual machine scale set metrics
  - managed disk monitoring
  - azure monitor receiver compute
  - azure activity log opentelemetry
  - subscription diagnostic settings
  - azure event hub receiver
  - hostmetricsreceiver alternative
  - application insights alternative
  - base14 scout azure compute
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor Azure VMs, VMSS, and Managed Disks with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and a single azure_monitor receiver with three namespaces under services - Microsoft.Compute/virtualMachines, Microsoft.Compute/virtualMachineScaleSets, and Microsoft.Compute/disks - route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing your Compute resources. The receiver polls Azure Monitor every 60 seconds. The whitelist below covers what every modern Linux and Windows VM SKU emits at the resource level (CPU, network, disk, memory). Guest-OS-level metrics beyond what Azure publishes (per-process CPU, memory beyond Available Memory Bytes, custom counters) require an in-guest agent and are out of scope for this guide."}},{"@type":"Question","name":"Why does my Compute receiver discover more disks than I provisioned?","acceptedAnswer":{"@type":"Answer","text":"Every Azure VM has an implicit OS disk that Azure surfaces as a Microsoft.Compute/disks resource even though customers usually never declare it explicitly in their templates. The receiver scrapes it alongside any data disks you attached. Expect resources_count to be (data disks + 1 per VM) when scoping to Compute namespaces. Filter or scope per-RG if a multi-VM RG produces too many OS disk series; alternatively, drop Microsoft.Compute/disks from the services list entirely and rely on VM-level Disk Read Bytes / Disk Write Bytes for guest-I/O volume."}},{"@type":"Question","name":"What's the difference between resource-level and guest-OS metrics?","acceptedAnswer":{"@type":"Answer","text":"Azure's resource-level metrics (Percentage CPU, Network In Total, Disk Read Bytes, etc.) are published by the Azure platform without any in-guest agent and are what the azure_monitor receiver in this guide collects. Guest-OS metrics (per-process CPU, memory beyond Available Memory Bytes, custom Linux performance counters, Windows perf counters) require either Azure Monitor Agent (AMA) plus a Data Collection Rule or an in-guest OpenTelemetry collector running hostmetricsreceiver. AMA is Azure-native; hostmetricsreceiver is OTel-native and ships directly via OTLP. Both are out of scope for this guide; the resource-level signal here is sufficient for capacity, throttling, and SLO work on standard SKUs."}},{"@type":"Question","name":"How do I audit Compute control-plane operations?","acceptedAnswer":{"@type":"Answer","text":"Compute resources don't expose per-resource Diagnostic Settings categories like Storage or Key Vault do. The audit signal lives in the subscription-scope Activity Log instead. Configure a subscription Diagnostic Setting forwarding the Administrative category to an Event Hubs hub, then point the azure_event_hub receiver at the hub. Apply a collector-side filter processor scoped to cloud.resource_id matching Microsoft.Compute so unrelated subscription activity is dropped. Subscription-scope routing is slower than resource-scope (10-40 min for first batch versus 5-15 min for resource-scope) so audit visibility is not real-time. Use Microsoft Defender for Cloud or Azure Sentinel for real-time control-plane security monitoring; the OTel path in this guide is appropriate for retention, compliance reporting, and forensic analysis."}},{"@type":"Question","name":"Why does my filter processor drop most subscription Activity Log records?","acceptedAnswer":{"@type":"Answer","text":"The subscription Activity Log captures every resource provider in your sub - Microsoft.Compute, Microsoft.Network, Microsoft.Storage, Microsoft.KeyVault, and so on - while the filter in this guide passes only Microsoft.Compute records. On a multi-resource subscription it is normal to see drop ratios of 70-95 percent. Even on a Compute-only subscription, VMSS scaling implicitly creates and deletes Microsoft.Network NICs and Public IPs, which produce records the filter drops. To broaden the filter, add resource providers to the regex (Microsoft.Compute|Microsoft.Network); to narrow it further, scope by operationName via an additional rule. The filter must reference resource.attributes[\"cloud.resource_id\"] not log-record attributes, because the receiver places the resource ID on the resource attributes set under format: azure with apply_semantic_conventions: true."}},{"@type":"Question","name":"Should I scrape per-VMSS-instance metrics?","acceptedAnswer":{"@type":"Answer","text":"Not by default. The Microsoft.Compute/virtualMachineScaleSets/virtualMachines sub-namespace exposes per-instance metrics with the same names as the VM and VMSS namespaces, but cardinality fans out as one extra series per instance per metric. A 50-instance VMSS with the 8-metric whitelist produces 400 extra series per scrape just from per-instance views. The VMSS-resource-level aggregate (this guide's default) is sufficient for capacity work; per-instance scrape is meaningful only when you suspect heterogeneous behaviour across instances (one instance hot, others idle), in which case enable it for the affected VMSS and drop it again once the investigation closes. Add Microsoft.Compute/virtualMachineScaleSets/virtualMachines to services to enable; keep an eye on receiver scrape duration."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for Azure Compute (VMs, VM
Scale Sets, and Managed Disks). For the cross-surface architecture
(auth, push vs pull, latency, the trace gap), read
[Azure Monitoring with OpenTelemetry - Architecture for base14
Scout](./overview.md) first.

This guide is for engineers running Azure Compute resources in
production who want to add VM, VMSS, and Disk telemetry to an existing
OpenTelemetry Collector and ship it to base14 Scout. The collector
polls Azure Monitor's REST API for the three Compute namespaces
(`Microsoft.Compute/virtualMachines`,
`Microsoft.Compute/virtualMachineScaleSets`, `Microsoft.Compute/disks`)
every 60 seconds, and a sibling pipeline ingests Compute control-plane
operations from the subscription Activity Log via Event Hubs as OTel
logs.

The receiver does not connect to the VM's data plane or the VMSS
instances. It queries Azure Monitor for whatever your subscription
auto-publishes at the platform layer - CPU percentage, network
bytes, disk IOPS, available memory - so the same configuration covers
Linux and Windows VMs, every SKU family, and any number of VMSS or
Disk resources in the configured scope.

> **Looking for guest-OS metrics?** This guide covers what Azure
> publishes at the resource level. Guest-OS metrics (per-process CPU,
> memory beyond `Available Memory Bytes`, custom Linux perf counters,
> Windows perf counters) require an in-guest agent: either Azure
> Monitor Agent (AMA) with a Data Collection Rule, or an in-guest
> OpenTelemetry collector running
> [hostmetricsreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/hostmetricsreceiver).
> Both are out of scope here. The resource-level signal is sufficient
> for capacity planning, SLO tracking, and SKU-level performance work.

This guide ships both paths: metrics via the `azure_monitor` receiver
and Compute control-plane audit logs via the `azure_event_hub`
receiver fed from a **subscription-scope** Diagnostic Setting. See
[Receiver configuration](#receiver-configuration) for metrics and
[Logs](#logs) for the audit path.

## Compute resources at a glance

The three resource types in this guide are typically monitored together:

| Resource type | What it is | Why monitor it together |
| --- | --- | --- |
| `Microsoft.Compute/virtualMachines` | Standalone VM, single OS instance, single network interface, optionally one or more attached data disks. | The standalone VM is the unit of capacity for fixed-fleet workloads (databases, lift-and-shift apps, CI runners). |
| `Microsoft.Compute/virtualMachineScaleSets` | Group of identical VMs managed as one logical resource, with manual or autoscaled capacity. | VMSS aggregates capacity for elastic workloads (App Service Premium plans run on VMSS underneath, AKS node pools are VMSS, batch jobs commonly use VMSS). |
| `Microsoft.Compute/disks` | Managed Disk - the storage backing for VM OS disks and any explicitly attached data disks. | Per-disk metrics surface IOPS and bandwidth at the disk-resource layer; VM-level disk metrics aggregate across all attached disks but lose the per-disk split. |

The three namespaces share most metric names. A single-fragment
multi-namespace receiver is the recommended shape: one `services:`
block listing all three, one `metrics:` block keyed by namespace.
Output is split downstream by `azuremonitor.resource_id`.

> **Implicit OS disks.** Every VM provisioned with the standard image
> reference automatically creates an OS disk that Azure surfaces as a
> `Microsoft.Compute/disks` resource. The receiver scrapes it
> alongside any data disks you explicitly attached. Customers who
> manage 50 VMs in one RG will see ~50 extra Disks-namespace series
> from those auto-created OS disks. Drop `Microsoft.Compute/disks`
> from `services:` if VM-level `Disk Read Bytes` / `Disk Write Bytes`
> are sufficient for your case and the OS disk per-resource view is
> noise.

## SKU choice and conditional metrics

Azure offers ~40 VM SKU families across general-purpose, compute-
optimized, memory-optimized, storage-optimized, GPU, and confidential
compute, plus several Managed Disk tiers (Standard HDD, Standard SSD,
Premium SSD P-series, Premium SSD v2, Ultra Disk). The whitelist in
[Receiver configuration](#receiver-configuration) covers what every
modern SKU emits at the resource level. **Several metrics are
SKU-conditional - they only emit on specific instance types or disk
tiers.** Add them to your whitelist when you operate the relevant
SKU; they cost nothing on SKUs where they don't emit (Azure Monitor
returns no series, the receiver shows zero datapoints for them).

| Metric | Emits on | Add to whitelist? |
| --- | --- | --- |
| `Available Memory Bytes` | Current-generation Hyper-V Linux and Windows images (Ubuntu 22.04+, RHEL 8+, Windows Server 2019+). Older images may not emit it at all without Azure Monitor Agent. | **Yes by default** - included in the main whitelist. Verify on your image; drop and document in your runbook if absent. |
| `CPU Credits Consumed`, `CPU Credits Remaining` | All B-series SKUs (any `Standard_B*` family - the burstable line, including the ARM-based `Bp*_v2` and `Bp*_v3` variants). | **Yes for B-series fleets.** Critical for capacity work - `CPU Credits Remaining` approaching zero is the leading indicator of the next throttling event. Absent on D-series, E-series, F-series, and every non-burstable SKU. |
| `Disk Used Burst IO Credits Percentage`, `Disk Used Burst Bandwidth Percentage` | Premium SSD disks using **credit-based bursting** (default for P1-P50; the metrics emit when bursting is actively draining the credit pool). | **Yes for Premium SSD fleets** with workload that crosses baseline. `az monitor metrics list-definitions --resource <diskId>` shows whether your tier exposes them. |
| `Disk On-demand Burst Operations`, `DiskPaidBurstIOPS` | Premium SSD P30+ disks with **on-demand bursting enabled** (`burstingEnabled: true` on the disk resource). On-demand bursting is opt-in and paid per-burst; these metrics record the count and rate of paid operations. | **Yes for Premium SSD P30+ fleets** that have explicitly enabled on-demand bursting. Absent on disks left at the default (credit-based) bursting behaviour, and on Premium SSD v2 / Ultra Disk (those have configurable per-disk IOPS / throughput settings rather than burst pools). |
| `OS Disk Read/Write Bytes/sec`, `OS Disk Read/Write Operations/Sec`, `Data Disk *`, `Temp Disk *` | All VMs (per-disk-class breakdown of the VM-aggregate `Disk *` metrics in the main whitelist). | **Optional**. Useful when you want to attribute I/O between OS, data, and temp disks at the VM level without enabling per-disk Disks-namespace scrape. Adds 12 series per VM. |

Pick the SKU family for application performance, not telemetry.
Burstable B-series VMs are economical for variable workloads and emit
two extra metrics that are operationally important for that family.
Premium SSD P30+ with on-demand bursting trades higher per-second cost
for headroom over baseline; the bursting metrics tell you whether the
extra cost is being earned. D-series, E-series, and other non-burstable
SKUs trade the credits metrics for steady-state performance and need
fewer SKU-specific extras.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, and pipeline are all keyed `/compute` so they coexist
with other Azure receivers under one collector and one Scout exporter.
The three Compute namespaces are **not currently known to exhibit
receiver bug #45942** (the case-mismatched-dimensions bug seen on
`Microsoft.ApiManagement/service`,
`Microsoft.Network/azureFirewalls`, and a subset of
`Microsoft.Storage` metrics on `azuremonitorreceiver` v0.151.0), so no
`transform` processor is required. Re-check on receiver upgrades.

```yaml showLineNumbers title="otel-collector.yaml (excerpt)"
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/compute:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:COMPUTE_RESOURCE_GROUP}
    services:
      - Microsoft.Compute/virtualMachines
      - Microsoft.Compute/virtualMachineScaleSets
      - Microsoft.Compute/disks
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Compute/virtualMachines":
        Percentage CPU:                  [Average, Maximum]
        Network In Total:                [Total]
        Network Out Total:               [Total]
        Disk Read Bytes:                 [Total]
        Disk Write Bytes:                [Total]
        Disk Read Operations/Sec:        [Average]
        Disk Write Operations/Sec:       [Average]
        Available Memory Bytes:          [Average]
      "Microsoft.Compute/virtualMachineScaleSets":
        Percentage CPU:                  [Average, Maximum]
        Network In Total:                [Total]
        Network Out Total:               [Total]
        Disk Read Bytes:                 [Total]
        Disk Write Bytes:                [Total]
        Disk Read Operations/Sec:        [Average]
        Disk Write Operations/Sec:       [Average]
        Available Memory Bytes:          [Average]
      "Microsoft.Compute/disks":
        Composite Disk Read Bytes/sec:        [Average]
        Composite Disk Write Bytes/sec:       [Average]
        Composite Disk Read Operations/sec:   [Average]
        Composite Disk Write Operations/sec:  [Average]

processors:
  resource/compute:
    attributes:
      - {key: cloud.provider,    value: azure,                                action: insert}
      - {key: cloud.platform,    value: azure_compute,                        action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",       action: insert}
      - {key: cloud.region,      value: "${env:COMPUTE_REGION}",              action: insert}
      - {key: service.name,      value: "${env:COMPUTE_SERVICE_NAME}",        action: insert}

service:
  pipelines:
    metrics/compute:
      receivers: [azure_monitor/compute]
      processors: [resource/compute, batch]
      exporters: [otlp_http/b14]
```

The 20-metric whitelist (8 VM + 8 VMSS + 4 Disk) renames to **13 unique
OTel metric names** because the OTel-side names collapse the VM and
VMSS-namespace duplicates - same metric kind, different Azure resource
type. The receiver tags every datapoint with `azuremonitor.resource_id`
to preserve the per-resource split. Per-scrape datapoint count scales
with resource count and VMSS instance fan-out - see [Cardinality
control](#cardinality-control) for the math.

> **Burstable B-series fleets.** Add these to the
> `Microsoft.Compute/virtualMachines` map if you operate B-series VMs:
>
> ```yaml
> CPU Credits Consumed:    [Average]
> CPU Credits Remaining:   [Average]
> ```
>
> The two metrics are not emitted on D-series or other non-burstable
> SKUs and produce no series for those resources; safe to enable
> globally if your fleet is mixed.
>
> **No fixed `cloud.resource_id` on the resource processor.** Unlike
> single-resource-type fragments (Key Vault, Storage), this guide
> scrapes three different resource types (VM + VMSS + Disk) under one
> receiver. The receiver auto-injects `azuremonitor.resource_id` on
> each datapoint with the correct per-resource ID; hard-coding
> `cloud.resource_id` from a single env var would tag every series
> with the same ID and break per-resource splitting downstream. Leave
> it off the resource processor when the receiver covers more than
> one resource type.

## Authentication and RBAC

The collector authenticates to Azure Monitor as a service principal
holding **`Monitoring Reader`** at the **resource group** containing
the Compute resources. Resource-group scope is the minimum necessary;
subscription scope is acceptable but broader than needed.

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Monitoring Reader" \
  --scope "$(az group show --name <rg> --query id -o tsv)"
```

`Monitoring Reader` is sufficient for the metrics path
(`azuremonitorreceiver`). The collector **never** touches VM data
planes - it cannot SSH or RDP, cannot read disk contents, cannot list
VMSS instances by name beyond what the metric dimensions expose. None
of the `Virtual Machine Contributor`, `Reader and Data Access`, or
data-plane-equivalent roles are required.

The logs path adds a separate auth requirement at subscription scope -
see [Logs](#logs).

Two propagation delays apply to the metrics path after first assignment:

1. **Control-plane RBAC propagation** - typically 60-300 seconds
   before the receiver's `metricDefinitions` and `metrics` REST
   calls succeed. The receiver retries on its 60-second poll cycle.
2. **First-poll metric-definitions race** - Azure Monitor's
   metricDefinitions catalog can take 60-180 seconds to populate
   after a freshly-deployed VM or VMSS reaches `provisioningState:
   Succeeded`. The receiver caches an empty list if it polls during
   that window. Mitigation: restart the collector 3-5 minutes after
   the resources reach `Succeeded`, or accept the delay and the next
   poll cycle picks up the populated catalog.

## What you'll monitor

The 20-metric whitelist intersects what every Linux and Windows VM
SKU emits at the resource level. `Percentage CPU` is dual-aggregation
on both VM and VMSS namespaces (`Average` + `Maximum`), producing two
series. The other metrics are single-aggregation. After OTel-side
renaming the receiver emits **13 unique metric names** (the VM and
VMSS namespaces share names like `azure_percentage_cpu_average`; the
receiver keeps the data points separate via the per-datapoint
`azuremonitor.resource_id` attribute).

### VMs (`Microsoft.Compute/virtualMachines`)

| OTel series | Type | Unit | Use case |
| --- | --- | --- | --- |
| `azure_percentage_cpu_average` | Gauge | Percent | Mean CPU over the 1-minute window. Primary saturation signal. |
| `azure_percentage_cpu_maximum` | Gauge | Percent | Peak CPU within the window. Spike-detection. |
| `azure_network_in_total_total` | Counter | Bytes | NIC-level ingress bytes. Sum across all NICs on the VM. |
| `azure_network_out_total_total` | Counter | Bytes | NIC-level egress bytes. |
| `azure_disk_read_bytes_total` | Counter | Bytes | VM-aggregate read bytes across OS + every attached data disk. |
| `azure_disk_write_bytes_total` | Counter | Bytes | VM-aggregate write bytes. |
| `azure_disk_read_operations` | Gauge | Ops/sec | VM-aggregate read IOPS. |
| `azure_disk_write_operations` | Gauge | Ops/sec | VM-aggregate write IOPS. |
| `azure_available_memory_bytes_average` | Gauge | Bytes | Guest memory available to the OS. Emits without AMA on current-gen Hyper-V Linux and Windows images. |

### VMSS (`Microsoft.Compute/virtualMachineScaleSets`)

Same eight metrics as VMs, aggregated across all instances. The
`metadata_vmname` dimension splits per-instance (`<vmss-name>_0`,
`<vmss-name>_1`, etc.) for instance-level breakdowns within the
scale-set view. Per-instance namespace
(`Microsoft.Compute/virtualMachineScaleSets/virtualMachines`) is **not
in this whitelist** - see [Per-VMSS-instance scrape](#per-vmss-instance-scrape)
below.

### Managed Disks (`Microsoft.Compute/disks`)

| OTel series | Type | Unit | Use case |
| --- | --- | --- | --- |
| `azure_composite_disk_read_bytes` | Gauge | Bytes/sec | Per-disk read bandwidth. Reports zero when guest I/O is below the disk-tier baseline. |
| `azure_composite_disk_write_bytes` | Gauge | Bytes/sec | Per-disk write bandwidth. Same baseline behaviour. |
| `azure_composite_disk_read_operations` | Gauge | Ops/sec | Per-disk read IOPS. |
| `azure_composite_disk_write_operations` | Gauge | Ops/sec | Per-disk write IOPS. |

> **Composite Disk metrics on lightly-loaded disks may read zero.**
> Production workloads at or above the disk tier's baseline (Premium
> SSD P4: 25 MB/s, 120 IOPS; P10: 100 MB/s, 500 IOPS; P30: 200 MB/s,
> 5000 IOPS) emit accurate `Composite Disk *` series. On idle or
> lightly-loaded disks running well below baseline, Azure Monitor
> may publish zero rather than the actual low rate. If you observe
> zero on a disk you expect to be busy, cross-check via the VM-level
> `azure_disk_*_bytes_total` / `azure_disk_*_operations` series to
> confirm whether the I/O is genuinely zero or whether the
> Disks-namespace metric is below its emit threshold for this tier.
> Burst credit and on-demand bursting metrics are SKU-conditional -
> see [SKU choice and conditional metrics](#sku-choice-and-conditional-metrics).

### Operations notes

- **VMSS implicit per-instance NICs and Public IPs.** Scaling a VMSS up
  or down implicitly creates and deletes per-instance
  `Microsoft.Network/networkInterfaces` and
  `Microsoft.Network/publicIPAddresses` resources. These show up in the
  subscription Activity Log (and are filtered out by the logs-path filter
  processor below) but do not affect the metrics path - the receiver
  scrapes only the parent VMSS resource for metric purposes.
- **OS disk auto-discovery.** Every VM creates an implicit OS disk that
  Azure surfaces as a `Microsoft.Compute/disks` resource. Expect
  `resources_count` to be `(data disks + 1 per VM)` when the receiver
  scopes to the Compute namespaces.
- **Available Memory Bytes is Hyper-V image-version conditional.** On
  current-gen Linux and Windows images (Ubuntu 22.04+, RHEL 8+, Windows
  Server 2019+) the metric emits without AMA. On older images it may not
  emit at all. Verify presence on your chosen image:

  ```bash
  az monitor metrics list-definitions --resource <vmId> \
    --query "[?name.value=='Available Memory Bytes']"
  ```

  Drop from the whitelist if absent and document the gap in your
  runbook so future debugging knows the metric is unavailable on this
  image.

## Cardinality control

Compute metrics are bounded by the small per-VM dimension set the
receiver emits, plus the per-instance fan-out on VMSS via
`metadata_vmname`.

| Attribute | Source | Cardinality |
| --- | --- | --- |
| `azuremonitor.resource_id` | Receiver | One per Compute resource (low). |
| `name` | Receiver | One per resource. |
| `resource_group` | Receiver | One per RG. |
| `type` | Receiver | Constant per namespace: `Microsoft.Compute/virtualMachines`, `Microsoft.Compute/virtualMachineScaleSets`, `Microsoft.Compute/disks`. |
| `location` | Receiver | One per region. |
| `metadata_vmname` | Azure Monitor (VMSS only) | One per VMSS instance. **The fan-out vector** - a 50-instance VMSS produces 50× the per-metric series count. |

A 10-VM RG with five 4-instance VMSSes and ~25 disks lands at:

- VM: 10 resources × 9 series = 90 datapoints/scrape
- VMSS: 5 resources × 9 series × 4 instances = 180 datapoints/scrape
  (with `metadata_vmname` fan-out)
- Disk: 25 resources × 4 series = 100 datapoints/scrape

Total: ~370 datapoints/scrape per minute = ~22k datapoints/hour - well
within Scout's default capacity for any reasonable plan.

### Per-VMSS-instance scrape

The `Microsoft.Compute/virtualMachineScaleSets/virtualMachines`
sub-namespace exposes per-instance metrics with the same names as the
VM and VMSS namespaces. Adding it to `services:` enables a per-instance
view useful for diagnosing heterogeneous behaviour across instances
(one instance hot, others idle) - the kind of investigation that the
VMSS aggregate hides.

The trade-off is cardinality. Each instance produces a full series set
per metric. A 50-instance VMSS with the 8-metric whitelist produces 400
extra datapoints per scrape. For fixed-size scale sets in
fault-tolerance mode (DBs on VMSS, etc.) this is fine; for elastic
scale sets that grow into the hundreds of instances, the receiver's
scrape duration grows proportionally and your storage cost grows
linearly with instance count. Enable per-instance only when the
investigation requires it; drop it once closed.

```yaml
services:
  - Microsoft.Compute/virtualMachines
  - Microsoft.Compute/virtualMachineScaleSets
  - Microsoft.Compute/virtualMachineScaleSets/virtualMachines  # opt-in
  - Microsoft.Compute/disks
```

## Alert tuning

Operational alerting on Compute follows the **USE method on each
resource type**: Utilization, Saturation, Errors. For VMs and VMSS,
saturation manifests as CPU near 100% or memory near zero; errors are
sparse at the platform layer (Azure surfaces them in the Activity Log,
not in metrics).

### Per-resource thresholds

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **CPU saturation** | `azure_percentage_cpu_average` (or `_maximum`) | > 70% / 5m | > 85% / 5m | The `_maximum` aggregation catches short spikes the `_average` smooths over. Use `_maximum` for spike-sensitive workloads (latency-critical APIs); use `_average` for batch / ETL where short bursts are expected. |
| **Memory pressure** | `azure_available_memory_bytes_average` | < 20% of VM RAM | < 10% of VM RAM | Compute the threshold against the SKU's documented RAM (e.g. 8 GB on D2s_v3). Sustained low available memory indicates the OS is approaching swap / OOM. |
| **Disk IOPS saturation** | `azure_disk_read_operations` + `azure_disk_write_operations` (sum) | > 70% of SKU IOPS limit | > 85% of SKU IOPS limit | SKU IOPS limits are documented per SKU (e.g. D2s_v3 baseline is 3200 IOPS). Use the appropriate Disks-namespace metric for per-disk view (`azure_composite_disk_*_operations`) when the VM hosts multiple disks. |
| **Disk bandwidth saturation** | `azure_disk_read_bytes_total` + `azure_disk_write_bytes_total` rate | > 70% of SKU bandwidth limit | > 85% of SKU bandwidth limit | Convert the totals to bytes/sec at the query layer (`rate()` or `irate()` in Prometheus query languages, equivalent in Scout's query). |
| **Network egress anomaly** | `azure_network_out_total_total` rate | configurable | configurable | Network egress is uncapped on most SKUs but is the cost vector for cross-region or internet egress. Alert on absolute byte/sec deltas over a baseline rather than fixed thresholds. |

### SKU-conditional thresholds

Add these alert rules when the relevant SKU is in your fleet. The
underlying metrics must be added to the whitelist - see [SKU choice
and conditional metrics](#sku-choice-and-conditional-metrics).

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **B-series CPU credit drain** | `azure_cpu_credits_remaining_average` | < 25% of the SKU's max credits | < 10% of max | Credit drain is the leading throttling indicator. Compute the threshold against your SKU's max credits (look up the figure for your SKU in [Azure's B-series documentation](https://learn.microsoft.com/azure/virtual-machines/sizes-b-series-burstable) - it varies from ~144 on B1s to several thousand on the larger Bms variants). The VM enters baseline-throttled mode when credits hit zero. |
| **Premium SSD credit-based burst drain** | OTel-renamed `Disk Used Burst IO Credits Percentage` series | > 70% / 5m | > 90% / 5m | Continuous credit consumption indicates the workload exceeds the disk tier's baseline IOPS. Either size up the disk or accept the eventual rate-limit when credits drain. The bandwidth-side counterpart (`Disk Used Burst Bandwidth Percentage`) follows the same threshold shape; many workloads saturate one before the other. |
| **Spot eviction rate** | Count of Activity Log records with `operationName` matching `Microsoft.Compute/virtualMachines/preemptedSpotVm/action` (or the deallocate that follows the eviction) on Spot resources | > 1 / 1h | > 5 / 1h | Sourced from the logs path, not metrics. Frequent eviction means Azure is reclaiming capacity often; either tolerate restart cost in your batch design or move latency-sensitive paths to on-demand. |

### VMSS-specific tuning

VMSS aggregates across instances and obscures heterogeneous behaviour.
For most production VMSS, alerts on the aggregate CPU and memory are
sufficient (the autoscaler reacts to averages too); when investigating
per-instance issues, temporarily enable the per-instance scrape per
[Per-VMSS-instance scrape](#per-vmss-instance-scrape).

When the VMSS has autoscale enabled, alert on the **rate of capacity
changes** as a secondary signal - frequent scale-in / scale-out
oscillation indicates autoscale rule mismatch with workload pattern.
The capacity change itself shows up in the Activity Log
(`Microsoft.Compute/virtualMachineScaleSets/write`); see [Logs](#logs).

## Specialty SKU classes

The metrics whitelist in this guide covers the universal Azure-side
metric surface that every Compute SKU emits. Four SKU classes carry
considerations beyond the universal set:

- **Spot VMs** (`Standard_*` with `priority: Spot`). Same metrics
  whitelist as on-demand. Eviction events surface via the
  subscription Activity Log rather than as Azure Monitor metrics -
  Azure emits a `Microsoft.Compute/virtualMachines/preemptedSpotVm/action`
  record at the moment of preemption, followed by an implicit
  `deallocate`. The default filter in [Logs](#logs) passes both
  records as Microsoft.Compute, so Spot evictions appear automatically
  in the logs pipeline. Alert on the preemption operationName to
  catch batch workloads losing capacity.
- **Confidential VMs** (`Standard_DC*s_v3`, `Standard_EC*s_v5`). Same
  metrics whitelist as general-purpose; attestation events surface
  via Activity Log. The `Microsoft.Compute/virtualMachines` namespace
  covers them.
- **GPU and FPGA SKUs** (`Standard_NC*`, `Standard_NV*`, `Standard_NP*`,
  `Standard_PB*`). Same CPU + memory + disk + network whitelist as
  general-purpose - those metrics emit normally. **GPU utilization,
  GPU memory, and ML-framework metrics are NOT in Azure Monitor** -
  Azure does not surface in-GPU telemetry at the platform layer.
  Capture them with an in-guest agent (NVIDIA's `dcgm-exporter` for
  NVIDIA H100 / A100 / L4 / etc., AMD's ROCm exporter for MI
  series), scraped via the OTel `prometheusreceiver`. The GPU
  surface is out of scope for this guide.
- **Ultra Disk and Premium SSD v2** (per-disk performance configured
  separately from the SKU tier). The four `Composite Disk *` metrics
  emit. Burst-credit metrics from the Premium SSD P-series do not
  apply - performance is reserved per-disk via configurable IOPS and
  throughput settings rather than via burst pools. Per-disk operation
  metrics (`Composite Disk *_operations`) and bandwidth (`*_bytes`)
  are the same; if you need to alert on configured-vs-consumed
  performance ratio, derive it at the query layer from the SKU's
  configured settings (visible via
  `az disk show --query "{iops:diskIOPSReadWrite, mbps:diskMBpsReadWrite}"`).

## Apps-side instrumentation

The metrics in this guide describe the VMs and VMSS themselves. For
end-to-end visibility - application latency, request volume, cache hit
rates, downstream call timing - instrument your applications with the
OTel auto-instrumentation agents for Java, .NET, Python, Node.js, or
Go. The agents wrap the standard SDKs and emit traces and metrics
that complement the VM-level signal.

The VM-side metrics in this guide and the apps-side traces are
complementary: VM metrics tell you whether the host is healthy
(CPU saturated, memory exhausted, disk thrashing); apps-side spans
tell you which code paths run on the host and how long each takes.
Wire both for full coverage. See the per-language instrumentation
guides under `instrument/{language}/` for SDK setup.

## Logs

Resource-level metrics aggregate operations and capacity counters at
1-minute granularity. They cannot answer **who** restarted, resized,
scaled, or detached a Compute resource, **from where**, **with what
identity**, or **why**. Three operational gaps that the Compute
control-plane Activity Log fills where metrics cannot:

- **Per-operation control-plane audit** records each
  `Microsoft.Compute/virtualMachines/restart`,
  `Microsoft.Compute/virtualMachines/deallocate`,
  `Microsoft.Compute/virtualMachineScaleSets/scale`, and
  `Microsoft.Compute/disks/detach` operation with the requester's
  identity (UPN, app ID, OID), source IP, correlation ID, and result
  status. The metrics path has no concept of who or why - it sees CPU
  drop to zero on a deallocate but cannot attribute the action.
- **Per-resource lifecycle** preserves the create / update / delete
  history of every Compute resource, useful for change diagnostics
  ("when did this VMSS last scale", "who increased the disk size last
  Tuesday") and capacity audits.
- **Implicit Microsoft.Network correlation** is available in the same
  Activity Log stream - VMSS scaling generates implicit NIC and Public
  IP create/delete records. The default filter in this guide drops
  them so the Compute audit signal stays clean; broaden the filter
  (see [Filter expression](#filter-expression-broadening-and-narrowing))
  if you need NIC-level forensics alongside Compute audit.

Compute resources do **not** expose per-resource Diagnostic Settings
categories. The audit signal lives in the **subscription-scope**
Activity Log instead. This is the meaningful difference from the
[Storage](./storage.md) and [Key Vault](./key-vault.md) logs paths,
which use resource-scope Diagnostic Settings against the storage
account or vault directly.

The recommended pattern is **subscription Activity Log to Event Hubs
to `azure_event_hub` plus a `filter` processor** in the same collector.
The receiver ingests events as OTel logs, the filter scopes to
Microsoft.Compute records only, and the resource processor tags them
with `cloud.platform: azure_compute`. All routes to Scout via the same
`oauth2client` / `otlp_http/b14` pipeline used for metrics.

```yaml showLineNumbers title="otel-collector.yaml (logs excerpt)"
receivers:
  azure_event_hub/computelogs:
    connection: ${env:COMPUTELOGS_CONNECTION_STRING}
    partition: ""
    offset: ""
    format: azure
    apply_semantic_conventions: true

processors:
  filter/computeonly:
    error_mode: ignore
    logs:
      log_record:
        - 'resource.attributes["cloud.resource_id"] == nil'
        - 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/[Mm][Ii][Cc][Rr][Oo][Ss][Oo][Ff][Tt]\\.[Cc][Oo][Mm][Pp][Uu][Tt][Ee]/.*")'

  resource/computelogs:
    attributes:
      - {key: cloud.provider,    value: azure,                                action: insert}
      - {key: cloud.platform,    value: azure_compute,                        action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",       action: insert}
      - {key: service.name,      value: "${env:COMPUTELOGS_SERVICE_NAME}",    action: insert}

service:
  pipelines:
    logs/computelogs:
      receivers: [azure_event_hub/computelogs]
      processors: [filter/computeonly, resource/computelogs, batch]
      exporters: [otlp_http/b14]
```

The `connection` string must include the `EntityPath=<hub-name>`
suffix so the receiver knows which hub to consume. The receiver
defaults to consuming all partitions from the oldest available offset
(`partition: ""`, `offset: ""`); on collector restart it re-reads from
the saved offset, providing at-least-once delivery.

> **Why the filter expression looks so paranoid.** The
> `azure_event_hub` receiver with `format: azure` +
> `apply_semantic_conventions: true` places the per-record Azure
> resource ID at `resource.attributes["cloud.resource_id"]` (OTel
> semantic-conventions form, **not** `azure.resource.id`). The full
> resource ID is also UPPERCASED by the receiver. The filter regex
> matches case-insensitively against `[Mm]icrosoft\.[Cc]ompute` to
> handle the inconsistency in the wild and protect against future
> Azure-side changes. The first rule
> (`resource.attributes["cloud.resource_id"] == nil`) drops records
> that arrive without a resource ID at all (rare but possible during
> Azure-side outages). Together the two rules pass only records with a
> Microsoft.Compute provider segment and drop everything else.

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
  --name compute-activity \
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
`start`, `restart`, `deallocate`, `scale`, `detach`, and similar
control-plane operations across every resource provider in the
subscription. The collector-side filter processor then scopes it to
Microsoft.Compute. Other categories (`Security`, `ServiceHealth`,
`Alert`, `Recommendation`, `Policy`, `Autoscale`, `ResourceHealth`)
are typically routed elsewhere - see [Why not other categories](#why-not-other-categories).

### Auth for the subscription Diagnostic Setting

Creating a subscription-scope Diagnostic Setting requires
**`Monitoring Contributor`** at **subscription scope**. This is broader
than the metrics path's `Monitoring Reader` at RG scope, and a
deliberate split: the role lives on the **operator's signed-in user
identity** (a human Microsoft Entra ID account), not on the
long-lived service principal that the collector uses for the metrics
path.

```bash
OPERATOR_OID="$(az ad signed-in-user show --query id -o tsv)"
az role assignment create \
  --assignee-object-id "$OPERATOR_OID" \
  --assignee-principal-type User \
  --role "Monitoring Contributor" \
  --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID"
```

The role assignment is permanent - the operator's account will
continue to hold `Monitoring Contributor` at subscription scope after
the Diagnostic Setting is created. Operators who manage compliance
boundaries can revoke it once the Diagnostic Setting is in place:

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
  10-40 minutes**.
  Resource-scope Diagnostic Settings on Storage and Key Vault ship the
  first batch within 5-20 minutes; the subscription-scope routing adds
  an extra hop and stretches the upper bound. Plan for 40 minutes.
- **Steady-state batches: 5-15 minutes**. After the first batch,
  subsequent ones arrive in the documented range.
- **End-to-end latency from operation to Scout: 5-15 minutes
  steady-state, 10-40 minutes for the first batch**. Audit visibility
  is **not** real-time. For real-time control-plane security
  monitoring, use Microsoft Defender for Cloud or Azure Sentinel,
  which read the Activity Log directly with lower latency. The OTel
  path is appropriate for audit retention, compliance reporting, and
  forensic analysis where per-event minutes-of-lag is acceptable.

### Filter expression: broadening and narrowing

The filter passes only records with `Microsoft.Compute` in the resource
ID path. To **broaden** the filter to additional resource providers,
add them to the regex alternation:

```yaml
- 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/(?:[Mm]icrosoft\\.[Cc]ompute|[Mm]icrosoft\\.[Nn]etwork|[Mm]icrosoft\\.[Ss]torage)/.*")'
```

To **narrow** the filter to specific Compute operations, add a second
rule on `attributes["azure.operation.name"]`:

```yaml
filter/computeonly:
  error_mode: ignore
  logs:
    log_record:
      - 'resource.attributes["cloud.resource_id"] == nil'
      - 'not IsMatch(resource.attributes["cloud.resource_id"], ".*/[Mm][Ii][Cc][Rr][Oo][Ss][Oo][Ff][Tt]\\.[Cc][Oo][Mm][Pp][Uu][Tt][Ee]/.*")'
      # Drop everything except VM lifecycle ops
      - 'not IsMatch(attributes["azure.operation.name"], ".*(?i:write|delete|restart|deallocate|start|powerOff)$")'
```

A multi-resource subscription typically sees 70-95% of subscription
Activity Log records dropped by this filter - that is normal and the
filter is doing real work.

### Why not other categories

- **`Security`** records security-relevant events (Defender, Sentinel
  alerts). These flow through dedicated security pipelines (Sentinel
  workspace, Defender connectors) rather than the OTel logs path.
- **`ServiceHealth`** records Azure service-health events (planned
  maintenance, regional outages). These are useful but better routed
  through Azure Service Health alerts or a separate
  service-health-only Diagnostic Setting.
- **`Alert`** records firings of Azure Monitor alert rules. The
  alert system is the consumer; routing alert firings to Scout via
  the Activity Log creates feedback loops.
- **`Recommendation`** is Azure Advisor output - not real-time
  operational telemetry.
- **`Policy`** records Azure Policy compliance evaluations - belongs
  in a compliance pipeline, not vault-style audit.
- **`Autoscale`** records autoscale rule firings on VMSS / App
  Service plans. Re-enable this if you operate VMSS autoscale at
  scale and want autoscale events alongside Compute control-plane
  audit.
- **`ResourceHealth`** records per-resource health-state changes
  (Healthy / Degraded / Unavailable / Unknown). Worth enabling as a
  follow-on once Compute audit is in place.

## Troubleshooting

### `AuthorizationFailed` from the receiver in the first 60 seconds

Symptom: scraper logs `AuthorizationFailed` or `403` shortly after
provisioning. Cause: `Monitoring Reader` was granted but Azure RBAC
is still propagating to the data-plane endpoint. Fix: wait 60-300
seconds. The receiver retries on its next poll cycle. If the error
persists after 5 minutes, verify the role assignment with
`az role assignment list --assignee <sp-app-id> --scope <rg-id>`.

### `metrics_definitions_count: 0` on first poll after provisioning

Symptom: the receiver logs `metrics_definitions_count: 0` and emits
no metrics for one or more Compute resources. Cause: Azure Monitor's
metricDefinitions catalog has not yet populated for the freshly-deployed
VM, VMSS, or Disk. Fix: restart the collector after the resources have
been up for at least 3 minutes, OR wait 5-10 minutes and the next
60-second poll picks up the now-populated catalog.

### Receiver discovers more disks than expected

Symptom: `resources_count` reports a Disks count higher than the
number of Managed Disks you provisioned. Cause: every VM creates an
implicit OS disk that Azure surfaces as a `Microsoft.Compute/disks`
resource. With 10 VMs in the RG, expect (data disks + 10) Disks-
namespace resources. Fix: this is expected. To suppress, drop
`Microsoft.Compute/disks` from `services:` and rely on VM-level
`azure_disk_*_bytes_total` for disk-I/O volume; per-disk burst metrics
are lost in that mode.

### `Available Memory Bytes` series is empty

Symptom: `azure_available_memory_bytes_average` returns no data for
some VMs. Cause: older Linux or Windows images don't emit guest memory
without AMA. Fix: redeploy with a current-gen image (Ubuntu 22.04+,
RHEL 8+, Windows Server 2019+), OR install Azure Monitor Agent +
Data Collection Rule, OR drop the metric from the whitelist and rely
on the OS-level memory tooling. Verify the catalog with
`az monitor metrics list-definitions --resource <vmId>`.

### Compute logs path: empty Event Hubs for 30+ minutes after provisioning

Symptom: `azure_event_hub/computelogs` receiver reports zero events
for the first 30 or more minutes after the subscription Diagnostic
Setting is created. Cause: subscription-scope Diagnostic Settings ship
the first batch on a 10-40 minute cadence, slower than the
resource-scope 5-20 minutes. Fix: wait. Subsequent batches arrive in
5-15 minutes per Azure's documented cadence. Verify the Diagnostic
Setting is configured correctly with
`az monitor diagnostic-settings subscription show --name compute-activity`.

### Filter processor drops all log records

Symptom: `filter/computeonly` shows incoming records but
`outgoing_items_total` stays at zero. Cause: the receiver places the
resource ID at `resource.attributes["cloud.resource_id"]`, not
`azure.resource.id`. A filter expression targeting the wrong
attribute name will match all records and drop them. Fix: use the
filter shape in this guide, which checks
`resource.attributes["cloud.resource_id"]`. Also verify case-
insensitive matching - the receiver UPPERCASES the resource ID, so
literal `Microsoft.Compute` will not match a `MICROSOFT.COMPUTE`
record.

### Subscription Diagnostic Setting rejects `--event-hub-auth-rule-id`

Symptom: `az monitor diagnostic-settings subscription create` fails
with `unrecognized arguments: --event-hub-auth-rule-id`. Cause: the
flag is `--event-hub-auth-rule` (no `-id` suffix) on `az` CLI 2.85.0.
Documentation in some sources mis-names the flag. Fix: use
`--event-hub-auth-rule "$DIAG_SEND_RULE_ARM_ID"` exactly.

### Scout OAuth2 returns 401

Symptom: `oauth2client` extension logs 401 from the token endpoint.
Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` /
`SCOUT_TOKEN_URL`. Fix: re-source the Scout credential env file (or
the equivalent secret store) and restart the collector.

## Frequently Asked Questions

### How do I monitor Azure VMs, VMSS, and Managed Disks with OpenTelemetry?

Add the `azure_auth` extension and a single `azure_monitor` receiver
with three namespaces under `services:` -
`Microsoft.Compute/virtualMachines`,
`Microsoft.Compute/virtualMachineScaleSets`, and
`Microsoft.Compute/disks` - route the receiver into a metrics pipeline
that exports to Scout via the `oauth2client`-authenticated OTLP/HTTP
exporter, and grant the collector's service principal `Monitoring
Reader` at the resource group containing your Compute resources. The
receiver polls Azure Monitor every 60 seconds. The whitelist in this
guide covers what every modern Linux and Windows VM SKU emits at the
resource level (CPU, network, disk, memory). Guest-OS-level metrics
beyond what Azure publishes (per-process CPU, memory beyond `Available
Memory Bytes`, custom counters) require an in-guest agent and are out
of scope.

### Why does my Compute receiver discover more disks than I provisioned?

Every Azure VM has an implicit OS disk that Azure surfaces as a
`Microsoft.Compute/disks` resource even though customers usually never
declare it explicitly in their templates. The receiver scrapes it
alongside any data disks you attached. Expect `resources_count` to be
`(data disks + 1 per VM)` when scoping to Compute namespaces. Filter
or scope per-RG if a multi-VM RG produces too many OS-disk series;
alternatively, drop `Microsoft.Compute/disks` from `services:`
entirely and rely on VM-level `azure_disk_*_bytes_total` for guest-I/O
volume.

### What's the difference between resource-level and guest-OS metrics?

Azure's resource-level metrics (`Percentage CPU`, `Network In Total`,
`Disk Read Bytes`, etc.) are published by the Azure platform without
any in-guest agent and are what the `azure_monitor` receiver in this
guide collects. Guest-OS metrics (per-process CPU, memory beyond
`Available Memory Bytes`, custom Linux performance counters, Windows
perf counters) require either Azure Monitor Agent (AMA) plus a Data
Collection Rule or an in-guest OpenTelemetry collector running
`hostmetricsreceiver`. AMA is Azure-native; `hostmetricsreceiver` is
OTel-native and ships directly via OTLP. Both are out of scope for
this guide; the resource-level signal is sufficient for capacity,
throttling, and SLO work on standard SKUs.

### How do I audit Compute control-plane operations?

Compute resources don't expose per-resource Diagnostic Settings
categories like Storage or Key Vault do. The audit signal lives in
the subscription-scope Activity Log instead. Configure a subscription
Diagnostic Setting forwarding the `Administrative` category to an
Event Hubs hub, then point the `azure_event_hub` receiver at the hub.
Apply a collector-side `filter` processor scoped to `cloud.resource_id`
matching `Microsoft.Compute` so unrelated subscription activity is
dropped. Subscription-scope routing is slower than resource-scope
(10-40 min for first batch versus 5-15 min for resource-scope) so
audit visibility is not real-time. Use Microsoft Defender for Cloud or
Azure Sentinel for real-time control-plane security monitoring; the
OTel path in this guide is appropriate for retention, compliance
reporting, and forensic analysis.

### Why does my filter processor drop most subscription Activity Log records?

The subscription Activity Log captures every resource provider in your
sub - Microsoft.Compute, Microsoft.Network, Microsoft.Storage,
Microsoft.KeyVault, and so on - while the filter in this guide passes
only Microsoft.Compute records. On a multi-resource subscription it is
normal to see drop ratios of 70-95%. Even on a Compute-only subscription,
VMSS scaling implicitly creates and deletes Microsoft.Network NICs and
Public IPs, which produce records the filter drops. To broaden the
filter, add resource providers to the regex
(`Microsoft.Compute|Microsoft.Network`); to narrow it further, scope
by `operationName` via an additional rule. The filter must reference
`resource.attributes["cloud.resource_id"]` not log-record attributes,
because the receiver places the resource ID on the resource attributes
set under `format: azure` with `apply_semantic_conventions: true`.

### Should I scrape per-VMSS-instance metrics?

Not by default. The
`Microsoft.Compute/virtualMachineScaleSets/virtualMachines`
sub-namespace exposes per-instance metrics with the same names as the
VM and VMSS namespaces, but cardinality fans out as one extra series
per instance per metric. A 50-instance VMSS with the 8-metric
whitelist produces 400 extra series per scrape just from per-instance
views. The VMSS-resource-level aggregate (this guide's default) is
sufficient for capacity work; per-instance scrape is meaningful only
when you suspect heterogeneous behaviour across instances (one
instance hot, others idle), in which case enable it for the affected
VMSS and drop it again once the investigation closes. Add
`Microsoft.Compute/virtualMachineScaleSets/virtualMachines` to
`services:` to enable; keep an eye on receiver scrape duration.

## Reference

- [Microsoft.Compute/virtualMachines supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-compute-virtualmachines-metrics)
- [Microsoft.Compute/virtualMachineScaleSets supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-compute-virtualmachinescalesets-metrics)
- [Microsoft.Compute/disks supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-compute-disks-metrics)
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
- [Azure Kubernetes Service](./aks.md) - managed Kubernetes built on
  VMSS underneath; Compute metrics on the VMSS namespace surface
  per-node-pool capacity in addition to the in-cluster signal.
- [Azure Application Gateway](./application-gateway.md) - WAF + L7
  load balancer commonly fronting VMSS-backed application tiers.
- [Azure Load Balancer](./load-balancer.md) - L4 load balancer
  fronting VM and VMSS backends.
- [Azure Storage](./storage.md) - object / blob / queue / table /
  file storage; per-resource Diagnostic Settings logs path companion
  to this guide's subscription-scope path.
