---
date: 2026-05-06
id: collecting-azure-load-balancer-telemetry
title: Azure Load Balancer Monitoring with OpenTelemetry
sidebar_label: Azure Load Balancer
sidebar_position: 9
description:
  Wire Azure Load Balancer (Standard SKU) metrics into your existing
  OpenTelemetry Collector and ship to base14 Scout. Covers VipAvailability,
  DipAvailability, SYNCount, byte and packet counters, and the SNAT-port
  exhaustion signal that determines outbound capacity. Includes the metric-
  definition discovery race operators hit on freshly-created LBs.
keywords:
  - azure load balancer monitoring
  - azure load balancer opentelemetry
  - azure monitor receiver
  - load balancer snat exhaustion
  - dipavailability vipavailability
  - workload identity federation
  - base14 scout azure load balancer
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Load Balancer metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.Network/loadBalancers, then route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every 60 seconds and emits one OTel metric per Azure aggregation. Standard SKU only; Basic SKU is end-of-life as of 2025-09-30."}},{"@type":"Question","name":"Why are my Load Balancer metrics not appearing after I provision a new LB?","acceptedAnswer":{"@type":"Answer","text":"Two common causes. First, the receiver caches metric definitions for the cache_resources interval (24h by default); if the LB was created after the receiver started, restart the collector to force re-discovery. Second, the LB needs a healthy backend with a working health probe before VipAvailability and DipAvailability emit non-default values; verify with az network lb show that backendAddressPools[].backendAddresses is populated and the NSG on the backend subnet allows the AzureLoadBalancer service tag."}},{"@type":"Question","name":"How do I detect SNAT port exhaustion?","acceptedAnswer":{"@type":"Answer","text":"Alert on UsedSnatPorts / AllocatedSnatPorts above 80 percent over a 5-minute window. SNAT port exhaustion presents as outbound connection failures from the backend pool to the internet, even when the LB itself is healthy. The fix is to either increase allocatedOutboundPorts on the outbound rule, add more frontend public IPs (each adds 1024 default SNAT ports), or move outbound traffic to NAT Gateway."}},{"@type":"Question","name":"Should I use a service principal or managed identity for the collector?","acceptedAnswer":{"@type":"Answer","text":"Managed identity if the collector runs in Azure, service principal if it does not. AKS pods use Workload Identity Federation with a federated credential bound to a Kubernetes ServiceAccount; Container Apps and Virtual Machine Scale Sets use system-assigned or user-assigned managed identity; out-of-Azure collectors fall back to service principal. The azure_auth extension's mode block is the only thing that changes; the rest of the receiver config is identical. RBAC requirement is Monitoring Reader at resource-group scope."}},{"@type":"Question","name":"What is the difference between this guide and Azure Application Gateway monitoring?","acceptedAnswer":{"@type":"Answer","text":"Azure Load Balancer is L4 (TCP / UDP), regional, and exposes metrics on the Microsoft.Network/loadBalancers namespace. Application Gateway is L7 (HTTP / HTTPS), regional, and exposes WAF v2 plus path-based routing on Microsoft.Network/applicationGateways. The receiver shape is identical for both; only the metric whitelist and dimensions differ. Run both in the same collector via separate fragments under the long-lived shared scraper pattern."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for Azure Load Balancer (Standard
SKU). For the cross-surface architecture (auth, push vs pull, latency, the
trace gap), read [Azure Monitoring with OpenTelemetry - Architecture for
base14 Scout](./overview.md) first.

The collector polls Azure Monitor's REST API for
`Microsoft.Network/loadBalancers` every 60 seconds, emits OTel metric
series, and exports via OTLP/HTTP. The receiver does not touch the LB
data plane.

**Standard SKU only.** Basic Load Balancer reached end-of-life on
2025-09-30 and no longer supports the metric set covered here. The
namespace `Microsoft.Network/loadBalancers` covers regional Standard
LBs and Cross-region (Global) LBs.

This guide focuses on regional LBs. Cross-region LBs use regional LBs
as backends (a tier-2 fan-out topology) and add one extra metric,
`GlobalBackendAvailability`. The receiver pattern works for both -
add `GlobalBackendAvailability: [Average]` to the whitelist for
Cross-region LBs.

## Topology preconditions

Three Standard LB topology constraints determine whether the metrics
in this guide reflect reality. Get these wrong before you deploy the
collector and `DipAvailability` will read 100 even when the backend
pool is empty, or `UsedSnatPorts` will double-account because two
outbound paths share one frontend. Verify each before you start
collecting.

### IP-based vs NIC-based backend pools

Standard LB supports two backend-pool addressing modes. The
operational difference is significant:

| Mode | Backend specification | Constraint | When to use |
| --- | --- | --- | --- |
| **NIC-based** | NIC resource IDs of backend VMs | NIC and LB must share a region; cross-VNET allowed via VNET peering | Default for VM and VMSS backends. Survives backend IP changes. |
| **IP-based** | Backend IPs directly | Backend IPs **must reside in the LB's VNET**; non-VNET IPs are silently rejected (the API accepts them, the pool stays empty) | Container-based backends, or backends without a NIC resource (private endpoints, etc.). |

If you specify backend IPs for an IP-based pool from outside the LB's
VNET, `az network lb show` returns
`backendAddressPools[].backendAddresses` empty and
`DipAvailability` flatlines at the default. Always verify with
`az network lb show -g <rg> -n <lb> --query backendAddressPools[].backendAddresses`
after pool changes.

### `disableOutboundSnat: true` when frontend is shared

If the same frontend IP is referenced by both an LB rule (inbound) and
an outbound rule, the LB rule's implicit SNAT and the explicit
outbound rule double-account on `UsedSnatPorts` and `AllocatedSnatPorts`.
Set `disableOutboundSnat: true` on the LB rule to delegate all SNAT to
the outbound rule. The Azure API rejects deployments where the
constraint is violated and the same frontend feeds both paths, but
older `azure-cli` versions silently swallow the error; verify
post-deploy with:

```bash
az network lb rule show -g <rg> --lb-name <lb> -n <rule-name> \
  --query disableOutboundSnat
```

**NAT Gateway preempts the LB SNAT path.** A subnet attached to NAT
Gateway routes outbound traffic through NAT Gateway, not the LB. The
LB's outbound rule still emits `AllocatedSnatPorts` and `UsedSnatPorts`
series for the same frontend, but the values do not reflect actual
outbound capacity for NAT-attached subnets - treat NAT Gateway's
metrics as ground truth there.

## Receiver configuration

Add this fragment to your existing collector config. It contributes the
`azure_auth` extension, an `azure_monitor` receiver scoped to the LB
namespace, a resource processor, and a metrics pipeline. Component keys
are suffixed `/loadbalancer` so the fragment composes cleanly with other
Azure-surface receivers in the same collector.

```yaml showLineNumbers title="otel-collector.yaml (Load Balancer addition)"
extensions:
  azure_auth:
    # Pick one of: service_principal, managed_identity, workload_identity.
    # See the Authentication section below for the right choice per
    # collector deployment surface.
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/loadbalancer:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:LOADBALANCER_RESOURCE_GROUP}
      # Multi-resource-group scoping. Omit resource_groups entirely to
      # scrape every resource group in the listed subscriptions.
    services:
      - Microsoft.Network/loadBalancers
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    # Data-plane batch API (*.metrics.monitor.azure.com). Lifts the
    # per-subscription rate ceiling from 12k to 360k calls/hour and is
    # the recommended default. Flip to false only as a temporary fallback
    # while data-plane RBAC propagates after a fresh Monitoring Reader
    # grant (5-30 min lag).
    use_batch_api: true
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Network/loadBalancers":
        # Availability
        VipAvailability: [Average]
        DipAvailability: [Average]
        # Traffic counters
        ByteCount: [Total]
        PacketCount: [Total]
        SYNCount: [Total]
        # SNAT
        SnatConnectionCount: [Total]
        AllocatedSnatPorts: [Average]
        UsedSnatPorts: [Average]

processors:
  resource/loadbalancer:
    attributes:
      - {key: cloud.provider,    value: azure,                              action: insert}
      - {key: cloud.platform,    value: azure_loadbalancer,                 action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",     action: insert}
      - {key: cloud.region,      value: "${env:LOADBALANCER_REGION}",       action: insert}
      # cloud.resource_id pins all metrics to one LB. Drop this line for
      # multi-LB fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically.
      - {key: cloud.resource_id, value: "${env:LOADBALANCER_RESOURCE_ID}",  action: insert}
      - {key: service.name,      value: "${env:LOADBALANCER_SERVICE_NAME}", action: insert}

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/loadbalancer:
      receivers: [azure_monitor/loadbalancer]
      processors: [memory_limiter, resource/loadbalancer, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                                     # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed
`/loadbalancer` so they coexist with other Azure-surface receivers in
a single collector. Your Scout exporter (`oauth2client` +
`otlphttp/b14`) stays unchanged; one Scout pipeline serves every
Azure surface.

For multi-subscription scoping, add entries to `subscription_ids:`. The
alternative `discover_subscriptions: true` scrapes every subscription
the identity has `Monitoring Reader` on; prefer the explicit list in
production, since discovery silently includes sandbox and dormant
subscriptions.

## Authentication and RBAC

Pick the `azure_auth` mode for where the collector runs:

- **AKS pod** - `workload_identity` (federated credential, no secret).
- **Container Apps / VMSS / Azure VM** - `managed_identity` (user-assigned
  survives instance replacement; system-assigned dies with the instance).
- **External or on-prem** - `service_principal`.
- **Local dev only** - `use_default: true` (Azure SDK credential chain).

Grant `Monitoring Reader` at the resource group containing your load
balancers. For mode-by-mode YAML, federation-credential setup, and the
`az role assignment create` snippet, see
[Azure Service Bus § Authentication](./service-bus.md#authentication) -
the configuration is identical except for the receiver's `services:`
line and the resource processor's `cloud.platform` value.

This guide defaults `use_batch_api: true` for the 360k-calls/hour ceiling.
Data-plane RBAC lags 5-30 minutes after a fresh `Monitoring Reader`
grant; if the receiver returns 401s in that window, temporarily flip to
`false` (legacy ARM `/metrics`, immediate propagation) and revert once
the data-plane RBAC settles.

## What you'll monitor

Load Balancer publishes 8 metrics on the
`Microsoft.Network/loadBalancers` namespace, all at PT1M time grain.
The receiver renames Azure's PascalCase names (e.g. `VipAvailability`)
to OTel-style `azure_<lowercased>_<aggregation>` (e.g.
`azure_vipavailability_average`).

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `VipAvailability` | `azure_vipavailability_average` | % | Frontend availability. 100 means the LB itself is reachable; below 100 means Azure-side LB degradation in the region. |
| `DipAvailability` | `azure_dipavailability_average` | % | Backend health-probe success rate. 100 means all backends pass; below 100 means probes are failing. The single most important per-backend signal. |
| `ByteCount` | `azure_bytecount_total` | Bytes | Bytes transmitted through the LB per minute. Splits by `Direction` (Inbound / Outbound) and `FrontendPort`. |
| `PacketCount` | `azure_packetcount_total` | Count | Packets transmitted. Splits same as ByteCount. Pair with ByteCount to compute average packet size. |
| `SYNCount` | `azure_syncount_total` | Count | TCP SYN packets seen. New-connection-attempt rate; pair with `SnatConnectionCount` to see how many of those completed SNAT. |
| `SnatConnectionCount` | `azure_snatconnectioncount_total` | Count | New SNAT connections created. Splits by `ConnectionState` (Pending / Successful / Failed). The Failed slice fires when SNAT exhaustion is occurring. |
| `AllocatedSnatPorts` | `azure_allocatedsnatports_average` | Count | SNAT ports allocated to the backend pool by the outbound rule. Constant unless you change `allocatedOutboundPorts`. |
| `UsedSnatPorts` | `azure_usedsnatports_average` | Count | SNAT ports currently in use. Divided by `AllocatedSnatPorts` gives utilisation; sustained > 80% indicates approaching SNAT exhaustion. |

Eight `metadata_*` dimensions split these metrics:

- `metadata_FrontendIPAddress`, `metadata_FrontendPort` (ByteCount,
  PacketCount, SYNCount) - one series per LB rule.
- `metadata_BackendIPAddress`, `metadata_BackendPort` (DipAvailability)
  - one series per backend.
- `metadata_Direction` (ByteCount, PacketCount, SYNCount) -
  `Inbound` / `Outbound`.
- `metadata_Protocol`, `metadata_ProtocolType` (SnatConnectionCount,
  AllocatedSnatPorts, UsedSnatPorts) - `TCP` / `UDP`.
- `metadata_ConnectionState` (SnatConnectionCount only) -
  `Pending` / `Successful` / `Failed`.

See [Cardinality control](#cardinality-control) for shaping advice.

**Silent-when-quiet caveat.** Azure Monitor returns data points for
ByteCount, PacketCount, SYNCount, and SnatConnectionCount only when the
underlying activity occurs. An LB with no traffic emits zero series for
those four. Wire alerts to fire on series presence in window (any
non-zero point) rather than threshold crossings, since absence of points
is the steady state for under-utilised LBs.

`VipAvailability` flows continuously every minute regardless of
traffic. `DipAvailability` requires at least one backend and a
configured health probe before it emits non-default values.

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST
API. Single-namespace surfaces like Load Balancer cost roughly 60
calls per LB per hour at 60s `collection_interval` (one call per
metric per poll, deduplicated).

Azure Monitor enforces two ceilings:

| Endpoint | Rate limit | When it applies |
| --- | --- | --- |
| Data-plane batch (`use_batch_api: true`) | 360,000 calls / hour / subscription | Default in this guide. RBAC lags 5-30 min after the Monitoring Reader grant. |
| Legacy Azure Resource Manager `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Temporary fallback if the data plane is still 401-ing after RBAC propagation should have completed. Immediate RBAC propagation. |

Even small fleets benefit from `use_batch_api: true` because batched
fan-out is more rate-limit-friendly than per-metric ARM calls. A 100-LB
fleet polling at 60s costs ~6,000 calls/hour against the 360k ceiling
(under 2% utilization), leaving room for sibling surfaces on the same
collector.

`cache_resources` is the resource-list cache TTL in seconds. The
receiver default of `86400` (24 hours) is the right setting for a
stable fleet. Lower to `3600` or `600` only if LBs are created and
destroyed frequently enough that 24-hour-stale resource lists become a
problem (see Troubleshooting § "Metrics never appear on a freshly
provisioned LB").

## Cardinality control

By default the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. The
dimension shape on Load Balancer is moderate: a single LB with one
frontend and one backend produces roughly 25 active series during
steady traffic.

Per-LB scaling factors:

- `metadata_FrontendIPAddress` × `metadata_FrontendPort` - one series
  per LB rule. Most LBs have 1-3 rules.
- `metadata_BackendIPAddress` - one series per backend. A 5-node
  backend pool produces 5x the per-rule fan-out on
  `DipAvailability`.
- `metadata_ConnectionState` (SnatConnectionCount only) - three values
  (Pending, Successful, Failed). The Failed slice is where SNAT
  exhaustion shows up.
- `metadata_Direction` (ByteCount, PacketCount, SYNCount) - Inbound
  and Outbound; doubles the fan-out on those three metrics.

A 50-LB fleet with 2 rules and 5 backends per LB lands around
~1,650 active series (25 baseline + ~8 per LB for the extra rule
and backends). Most fleets stay in the 1,500-3,500 range; trim
with `dimensions.overrides` before crossing 5,000.

Three control levers:

1. **`dimensions.overrides`** drops or whitelists dimensions per
   metric. Drop `metadata_BackendPort` on `DipAvailability` if you do
   not need per-port backend availability:

   ```yaml
   azure_monitor/loadbalancer:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.Network/loadBalancers":
           DipAvailability:
             - metadata_BackendIPAddress    # keep
             - metadata_FrontendIPAddress   # keep
             # drop ProtocolType, BackendPort
   ```

2. **Aggregation-list narrowing.** Replace `[]` with explicit lists
   (the snippet above already does this - `[Average]` and `[Total]`
   only). Adding `[Maximum, Minimum]` to gauges grows series by 2x
   without operational benefit on availability metrics.

3. **Per-account receiver instances.** Split the public-facing-LB
   tier (high cardinality on FrontendIPAddress) into a separate
   `azure_monitor/loadbalancer-public` receiver with a narrower
   override profile, while letting `azure_monitor/loadbalancer` stay
   broad on internal LBs.

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric
on the collector's port-8888 Prometheus endpoint to see actual
cardinality after `overrides` apply.

### Receiver bug #45942 (case-mismatch dimensions)

Receiver bug
[#45942](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/45942)
emits the same logical dimension under both PascalCase
(`metadata_Status`) and lowercase (`metadata_status`) keys, doubling
cardinality silently. Validation 2026-05-06 confirmed the bug
manifests on `Microsoft.Network/azureFirewalls` and
`Microsoft.Storage/storageAccounts` but **not** on
`Microsoft.Network/loadBalancers` at receiver v0.151.0.

If a future receiver version regresses and you see matched-pair keys
(`metadata_Status` and `metadata_status`) on Load Balancer metrics,
add this transform processor to the pipeline (see [Azure Firewall §
Cardinality control](./azure-firewall.md#bug-45942-case-mismatched-dimension-keys)
for the explanation):

```yaml
processors:
  transform/loadbalancer_dim_lowercase:
    metric_statements:
      - context: datapoint
        statements:
          # Replicate this pair for each affected dimension.
          - set(attributes["metadata_status"], attributes["metadata_Status"]) where attributes["metadata_Status"] != nil and attributes["metadata_status"] == nil
          - delete_key(attributes, "metadata_Status") where attributes["metadata_Status"] != nil
```

Insert `transform/loadbalancer_dim_lowercase` into the
`metrics/loadbalancer` pipeline's `processors:` list (after
`resource/loadbalancer`, before `batch`). Re-validate on each
receiver upgrade.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting
points; derive your own from observed 99th-percentile baselines over a
representative week.

| Metric | Warning | Critical | Why it matters |
| --- | --- | --- | --- |
| `azure_dipavailability_average` (per backend) | < 100% over 5m | < 50% over 5m | Backend health-probe failure. Below 50% means the backend is effectively unreachable and traffic is concentrating on the remaining healthy nodes. |
| `azure_vipavailability_average` | < 99.9% over 5m | < 99.0% over 15m | LB-side degradation. Cross-check Azure Service Health for the region; this is rarely user-actionable. |
| `azure_usedsnatports_average / azure_allocatedsnatports_average` | > 80% over 5m | > 95% over 5m | SNAT-port exhaustion is imminent. See SNAT exhaustion below. |
| `azure_snatconnectioncount_total` filtered to `metadata_ConnectionState="Failed"` | `> 0` over 5m | `> 0` over 15m | SNAT exhaustion occurring now. Outbound from the backend pool is breaking. |
| `azure_syncount_total / azure_packetcount_total` | tune to your fleet - no universal threshold | - | High SYN-to-packet ratio can indicate SYN floods or aggressive new-connection patterns, but the baseline ratio is entirely connection-pattern dependent (request-heavy services run high; long-lived bulk transfers run low). Establish a 7-day baseline before alerting; alert on deviation, not absolute value. |

For `azure_snatconnectioncount_total` filtered to Failed, fire alerts on
series presence in window rather than numeric thresholds - see the
[silent-when-quiet caveat](#what-youll-monitor) above.

### SNAT port exhaustion

SNAT-port exhaustion is the most common operational failure mode for
Azure Load Balancer. The default outbound rule allocates 1024 SNAT
ports per backend instance per frontend public IP. A single TCP
connection holds one port for ~4 minutes after close (TIME_WAIT).
Burst patterns where backends open many short-lived connections to
the internet (microservice → managed PaaS over public endpoint, for
example) exhaust the pool well before traffic levels become visible
on the application side.

Symptoms operators see:

- `azure_usedsnatports_average / azure_allocatedsnatports_average`
  sustained > 80%.
- `azure_snatconnectioncount_total` filtered to
  `metadata_ConnectionState="Failed"` non-zero.
- Backend application logs show `connect: cannot assign requested
  address`, `EADDRNOTAVAIL`, or `connection timed out` errors against
  external hostnames.

Three remediations, in order of operational ease:

1. **Increase `allocatedOutboundPorts` on the outbound rule.** Up to
   the per-VM cap, which varies by SKU. See [Microsoft Learn: outbound
   connections](https://learn.microsoft.com/azure/load-balancer/load-balancer-outbound-connections)
   for the current per-SKU limits.
2. **Add more frontend public IPs.** Each adds 1024 default SNAT ports
   per backend. Use this for fleets where increasing
   `allocatedOutboundPorts` per-rule is not enough.
3. **Move outbound traffic to NAT Gateway.** NAT Gateway preempts the
   LB SNAT pool with up to 64,512 ports per VNET, scaling
   independently of inbound LB traffic. Best fit when outbound
   throughput is the bottleneck.

For a deeper look at the math, see Microsoft's
[SNAT exhaustion article](https://learn.microsoft.com/azure/load-balancer/load-balancer-outbound-connections).

## Apps-side instrumentation

This guide is metrics-only. Load Balancer is L4 (TCP / UDP) and is
generally invisible to application-layer instrumentation. To produce
per-request distributed traces, instrument your backend application
code with an HTTP server SDK (e.g. OpenTelemetry instrumentation for
your framework) - the LB itself does not emit per-connection traces.

Run apps-side spans alongside this metrics collector with distinct
`service.name` values to keep the platform view (this guide) and the
request-flow view separately filterable in Scout.

## Logs

Azure Load Balancer health-event logs ship via Diagnostic Settings.
Architecture for the Diagnostic Settings → Event Hubs →
`azure_event_hub` path is in the [overview](./overview.md#choosing-pull-push-or-both).

```bash
LB_RES_ID=$(az network lb show -n <lb> -g <rg> --query id -o tsv)
az monitor diagnostic-settings create \
  --resource "$LB_RES_ID" \
  --name "lb-to-eventhubs" \
  --logs '[{"category":"LoadBalancerAlertEvent","enabled":true},{"category":"LoadBalancerProbeHealthStatus","enabled":true}]' \
  --event-hub-rule <eh-namespace-rule-id>
```

`LoadBalancerProbeHealthStatus` captures every health-probe state
transition with the backend IP and probe details. Pair it with the
`azure_dipavailability_average` metric to see which backends are
behind a threshold-breach alert.

## Service principal credential lifecycle

If you run a service principal (collector outside Azure), rotate the
client secret before its expiry, not after. The procedure is identical
to Service Bus and other azure-monitor surfaces; see
[Service Bus § Service principal credential lifecycle](./service-bus.md#service-principal-credential-lifecycle).

## Troubleshooting

### `AuthorizationFailed` from the receiver

Data-plane batch API (`use_batch_api: true`, the default) propagates
`Monitoring Reader` 5-30 minutes after grant; legacy ARM `/metrics`
(`use_batch_api: false`) propagates immediately. If you've just granted
the role and the receiver is 401-ing, temporarily flip to `false` to
confirm the role itself is correct, then revert once the data-plane
RBAC has settled.

### `403 Forbidden` from the receiver

If using a service principal: the `client_secret` has expired. See
[Service principal credential
lifecycle](#service-principal-credential-lifecycle). If using managed
identity: check that the LB is in a subscription / resource group where
the managed identity has `Monitoring Reader`.

### Metrics never appear on a freshly provisioned LB

The receiver caches metric definitions for the `cache_resources`
interval (default 86400s / 24h). On the first poll after a fresh LB
is created, Azure Monitor's metric-definition catalogue may not yet
have populated for the new resource - the receiver's first-poll
`metrics_definitions_count: 0` log line confirms the diagnosis.
Subsequent polls within the same `cache_resources` window will not
retry the discovery.

**Restart the collector** after the LB is fully provisioned (about 5
minutes after `az network lb create` completes). The restart resets
the discovery cache. To verify recovery, look for
`metrics_definitions_count: <N>` with `N > 0` on the next poll cycle.
If `N` is still `0`, Azure Monitor's catalogue has not populated yet

- wait 2-3 minutes and restart again.

If restarting the collector is operationally heavy, the alternatives
are: lower `cache_resources` to `600` for the first hour of a new
LB's life (then revert to `86400`), or wait one full
`cache_resources` cycle.

### `DipAvailability` stuck at 0

Backend health probe is failing. Three causes, in order of likelihood:

1. **NSG on the backend subnet blocks `AzureLoadBalancer`.** The
   service tag must be allowed inbound on the probe port. The Bicep
   pattern in this guide's example sets this up correctly.
2. **Backend application is not listening on the probe port** (or
   responding with an unexpected status). Check from inside the
   backend VM with `curl localhost:<probe-port>`.
3. **Backend is not in the LB's VNET.** Standard LB IP-based backend
   pools require the backend IPs to live in the LB's VNET; non-VNET
   IPs are silently rejected and `backendAddressPools[].backendAddresses`
   appears empty. Verify with
   `az network lb show -g <rg> -n <lb> --query backendAddressPools[].backendAddresses`.

### `RequestThrottled` warnings from the receiver

You have hit Azure Monitor's per-subscription rate ceiling
(12,000 / hour on legacy, 360,000 / hour on batch). Either:

- Lower polling rate: `collection_interval: 120s` for the fast receiver.
- Confirm `use_batch_api: true` is set (the guide default) - the
  legacy ARM endpoint caps at 12k/h versus 360k/h on data-plane batch.
- Split heavy subscriptions across multiple collector instances.

### Cardinality blowup on Scout volume

A high-fanout LB (many frontend IPs, many backends) can dominate
volume. Apply `dimensions.overrides` (see
[Cardinality control](#cardinality-control)) or split the noisy LB
into a separate receiver instance with a narrower whitelist.

### Scout OAuth2 returns 401

Verify `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL`
match the values in your Scout console. The `endpoint_params.audience`
must be `b14collector`.

## Frequently Asked Questions

### How do I add Azure Load Balancer metrics to my OTel collector?

Add the `azure_auth` extension and an `azure_monitor` receiver scoped
to `Microsoft.Network/loadBalancers`, then route the receiver into a
metrics pipeline that exports to Scout via the
`oauth2client`-authenticated OTLP/HTTP exporter. The receiver polls
Azure Monitor's REST API every 60 seconds and emits one OTel metric
per Azure aggregation. Standard SKU only; Basic SKU is end-of-life as
of 2025-09-30.

### Why are my Load Balancer metrics not appearing?

Two common causes. First, the receiver caches metric definitions for
the `cache_resources` interval (24h by default); if the LB was created
after the receiver started, restart the collector to force
re-discovery. Second, the LB needs a healthy backend with a working
health probe before `VipAvailability` and `DipAvailability` emit
non-default values; verify with `az network lb show` that
`backendAddressPools[].backendAddresses` is populated and the NSG on
the backend subnet allows the `AzureLoadBalancer` service tag.

### How do I detect SNAT port exhaustion?

Alert on `azure_usedsnatports_average / azure_allocatedsnatports_average`
above 80% over a 5-minute window. SNAT port exhaustion presents as
outbound connection failures from the backend pool to the internet,
even when the LB itself is healthy. The fix is to either increase
`allocatedOutboundPorts` on the outbound rule, add more frontend
public IPs (each adds 1024 default SNAT ports), or move outbound
traffic to NAT Gateway.

### Should I use a service principal or managed identity for the collector?

Managed identity if the collector runs in Azure, service principal if
it does not. AKS pods use Workload Identity Federation with a
federated credential bound to a Kubernetes ServiceAccount; Container
Apps and Virtual Machine Scale Sets use system-assigned or
user-assigned managed identity; out-of-Azure collectors fall back to
service principal. The `azure_auth` extension's mode block is the only
thing that changes; the rest of the receiver config is identical. RBAC
requirement is `Monitoring Reader` at resource-group scope.

### What is the difference between this guide and Azure Application Gateway?

Azure Load Balancer is L4 (TCP / UDP), regional, and exposes metrics
on the `Microsoft.Network/loadBalancers` namespace. Application
Gateway is L7 (HTTP / HTTPS), regional, and exposes WAF v2 plus
path-based routing on `Microsoft.Network/applicationGateways`. The
receiver shape is identical for both; only the metric whitelist and
dimensions differ. Run both in the same collector via separate
fragments under the long-lived shared scraper pattern.

## Reference

- **Receiver source.**
  [opentelemetry-collector-contrib / receiver /
azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver).
- **Auth extension source.**
  [opentelemetry-collector-contrib / extension /
azureauthextension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/azureauthextension).
- **Azure Monitor metric reference.**
  [Microsoft.Network/loadBalancers
metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-network-loadbalancers-metrics).
- **SNAT exhaustion deep-dive.**
  [Microsoft Learn: outbound
connections](https://learn.microsoft.com/azure/load-balancer/load-balancer-outbound-connections).
- **Basic SKU EOL announcement.**
  [Azure Updates: Basic Load Balancer
retirement](https://azure.microsoft.com/updates/azure-basic-load-balancer-will-be-retired-on-30-september-2025-upgrade-to-standard-load-balancer/).

## Related Guides

- [Azure Application Gateway](./application-gateway.md) - regional L7
  load balancer with WAF v2.
- [Azure Front Door](./front-door.md) - global CDN and L7 edge with WAF.
- [Azure Service Bus](./service-bus.md) - managed message broker for
  queues and topics.
- [Azure Storage](./storage.md) - managed
  object/blob/queue/table/file storage.
- [Azure Kubernetes Service](./aks.md) - managed Kubernetes.
