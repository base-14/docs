---
date: 2026-05-05
id: azure-monitoring-overview
title: Azure Monitoring with OpenTelemetry - Architecture for base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  How base14 Scout consumes Azure Monitor metrics and resource logs through
  the OpenTelemetry Collector. Two-leg pull plus push architecture, Workload
  Identity Federation, latency expectations, and the trace gap explained.
keywords:
  - azure monitoring opentelemetry
  - azure monitor receiver
  - azure event hub receiver
  - azure diagnostic settings
  - workload identity federation
  - azure monitor metrics rest api
  - azure monitor latency
  - base14 scout azure
  - azure observability architecture
  - azure platform metrics opentelemetry
  - azure resource logs opentelemetry
  - azure monitor batch api
  - azure metrics streaming
  - azure event grid resource events
  - azure monitor throttling
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How does base14 Scout consume Azure Monitor metrics?","acceptedAnswer":{"@type":"Answer","text":"Two ways. The azure_monitor receiver pulls from Azure Monitor's REST API on a configurable interval. For higher volume and lower freshness, Diagnostic Settings push metrics to an Event Hubs namespace, where the azure_event_hub receiver consumes them and forwards via OTLP to Scout. Most production deployments run both legs: pull for slow or definitive metrics, push for fast metrics like latency and throttle counters."}},{"@type":"Question","name":"Do I need to install an agent on my Azure resources?","acceptedAnswer":{"@type":"Answer","text":"No. Both paths use Azure-native interfaces (Metrics REST API and Diagnostic Settings) that every Azure resource exposes. You run the OpenTelemetry Collector somewhere that can reach those interfaces, typically inside an AKS cluster or as an Azure Container Apps job. Nothing is installed onto Cosmos DB, SQL Database, AKS control plane, or any other managed resource."}},{"@type":"Question","name":"What permissions does Scout need on my Azure subscription?","acceptedAnswer":{"@type":"Answer","text":"For the pull leg: Monitoring Reader on each subscription you want to scrape. That role grants read access to metric definitions and metric values without any control-plane write permissions. For the push leg: the customer's IaC needs Monitoring Contributor (or higher) at the time it provisions Diagnostic Settings; Scout's runtime collector needs Manage, Send, and Listen on the Event Hubs shared access policy it consumes from. Both are documented inline in each per-surface guide."}},{"@type":"Question","name":"How fresh is metric data once it reaches Scout?","acceptedAnswer":{"@type":"Answer","text":"Pull leg: a few minutes end-to-end. Microsoft documents that platform metrics are available in the metrics database in under a minute, then take another three minutes to be exported to a data collection endpoint; the receiver's collection_interval sits on top of that and is yours to tune. Push leg via Event Hubs: single-digit seconds in steady state. Use the push leg for any signal you want to alert on quickly."}},{"@type":"Question","name":"Why do I not see distributed traces from Cosmos DB, SQL Database, or AKS?","acceptedAnswer":{"@type":"Answer","text":"Azure infrastructure resources do not emit OpenTelemetry traces describing their own internal operations. Distributed traces come from your application code, instrumented with the Azure Monitor OpenTelemetry Distro or a vanilla OTel SDK, sent over OTLP directly to Scout. The Azure Monitor pipeline this guide describes carries metrics and logs only. Tracing your application code is a separate setup covered in the App Instrumentation guides."}},{"@type":"Question","name":"Can Scout coexist with my existing Log Analytics workspace?","acceptedAnswer":{"@type":"Answer","text":"Yes. A single Diagnostic Setting can fan out to a Log Analytics workspace and an Event Hubs namespace simultaneously. Customers commonly keep their Azure portal KQL workbooks running while Scout becomes the primary observability surface. The data is duplicated, the cost on the Log Analytics side is unchanged, and Scout adds the Event Hubs charge on top."}},{"@type":"Question","name":"Should I use service principal secrets or workload identity?","acceptedAnswer":{"@type":"Answer","text":"If the runtime hosting your collector can federate with Microsoft Entra ID (AKS, EKS, GKE, on-prem Kubernetes with workload identity, GitHub Actions, Azure Pipelines), Workload Identity Federation is the recommended default - it eliminates client secrets and the silent-zero failure mode that comes with secret expiry. Service principal with client secret is fully supported for runtimes where federation is not available; rotate the secret on a schedule and alarm on expiry. Managed identity and the default credential chain are also supported by the azureauthextension and pick themselves in the right runtimes."}},{"@type":"Question","name":"How does Azure Monitor REST API throttling work, and how do I avoid 429s?","acceptedAnswer":{"@type":"Answer","text":"Set use_batch_api: true on the azure_monitor receiver. That switches to the Metrics Data Plane API (metrics:getBatch), which raises the per-subscription rate ceiling from 12,000 to 360,000 calls per hour and lets a single REST call fetch metrics for up to 50 resources. Tune the scrape interval and the resource set per shard so the projected call rate stays inside that budget. If you operate at fleet scale and want explicit headroom, shard by (subscription, region) so each shard's ceiling is independent."}},{"@type":"Question","name":"What is the difference between the azure_monitor and azure_event_hub receivers?","acceptedAnswer":{"@type":"Answer","text":"azure_monitor pulls. It calls Azure Monitor's REST API on a schedule and emits OTel metrics. Use it for slow or definitive signals and for resource types that do not yet support streaming export. azure_event_hub consumes. It reads from an Event Hubs namespace that Diagnostic Settings has been configured to push into, and it decodes Azure Resource Logs and platform metrics natively. Use it for high-volume, low-latency signals and for any resource log surfacing in Scout. Production deployments run both."}},{"@type":"Question","name":"Does Scout support Azure Government or Azure China clouds?","acceptedAnswer":{"@type":"Answer","text":"Yes. Both the azure_monitor and azure_event_hub receivers support Azure Government, Azure China, and the Azure US Government cloud variants by setting the cloud parameter and the appropriate management endpoint. The auth model is identical to Azure public cloud. Per-surface guides note any region-specific caveats for the resource type they cover."}}]}
---

## Overview

This guide is the architectural landing for monitoring Azure infrastructure
with **base14 Scout** through the **OpenTelemetry Collector**. It explains
how Scout consumes signals from Azure Monitor, what to expect on freshness
and limits, where Workload Identity Federation fits, and what is and is not
in scope (the trace gap, in particular). For execution, jump to the
per-surface guides linked below.

The reader profile is **DevOps and SRE engineers** running production
Azure workloads, evaluating or operating Scout, who want to understand the
shape of the pipeline before configuring it for AKS, Cosmos DB, SQL
Database, Service Bus, Front Door, or Application Gateway.

:::tip TL;DR

base14 Scout consumes Azure telemetry through two parallel paths and
production deployments typically run **both**. **Metrics pull** via the
`azure_monitor` receiver against Azure Monitor's REST API, and a
**push leg for metrics and logs** via Diagnostic Settings to Event Hubs,
consumed by the `azure_event_hub` receiver. Authentication is via the
`azureauthextension`; Workload Identity Federation is the recommended
default where the runtime supports it, with managed identity, service
principal, and default-credential chain also supported. Metric freshness
is a few minutes on the pull leg (3-minute export floor plus your
scrape interval), single-digit seconds on the push
leg. Azure infrastructure resources do not emit distributed traces;
instrument your application with the Azure Monitor OpenTelemetry Distro
to get traces into Scout.

:::

## The Azure observability landscape

Every Azure resource emits two signal types natively:

- **Platform metrics** - time-series numeric data (CPU, RU consumption,
  request rates, latency percentiles). Stored in the Azure Monitor metrics
  database. Available without configuration. Free at the platform tier.
- **Resource logs** - structured event data (audit, query store, WAF
  blocks, AKS control-plane events). Off by default; enabled per-resource
  via Diagnostic Settings. Billed at the destination (Log Analytics, Event
  Hubs, or Storage).

Activity logs (subscription-level control-plane events: deployments, RBAC
changes, policy assignments) are a third signal in the same family,
collected automatically and exported via Diagnostic Settings.

There is a fourth signal Azure does not emit at the infrastructure layer:
**distributed traces**. Traces in the Azure ecosystem come from your
application code, not from the managed services it talks to. We cover the
implications in [What about traces?](#what-about-traces) below.

Microsoft's
[Application Insights overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
recommends the Azure Monitor OpenTelemetry Distro for code-based
server-side instrumentation: "For most code-based server-side scenarios,
the recommended setup uses the Azure Monitor OpenTelemetry Distro." That
puts customer applications on OTel-shaped emission natively. Scout is
the OTel-native destination such applications can target without going
through Azure Monitor as a middleman. The vendor-neutral pipeline this
guide describes makes that destination swap a configuration change
rather than a re-instrumentation.

## Architecture at a glance

```text
┌───────────────────── Azure ────────────────────┐    ┌────── base14 Scout ────────┐
│                                                │    │                            │
│  Per-resource Diagnostic Setting               │    │                            │
│   ├── push metrics  ─┐                         │    │                            │
│   └── push logs    ──┼──▶ Event Hubs namespace │──▶ │  azure_event_hub receiver  │
│                      │      (per region)       │    │   (push leg, beta)         │
│                      │                         │    │                            │
│                      │                         │    │  azure_monitor receiver    │
│  Metrics REST API ◀──┴─────────────────────────┼────│   (pull leg, alpha)        │
│   (use_batch_api: true)                        │    │                            │
│                                                │    │  azureauthextension        │
│                                                │    │   (alpha; WIF / MI / SP)   │
└────────────────────────────────────────────────┘    │                            │
                                                      │   ───────── OTLP ────────▶ │
                                                      │                            │
                                                      └────────────────────────────┘
```

Three pieces, one picture:

- **`azure_monitor` receiver** polls Azure Monitor's Metrics REST API on a
  scrape interval. Use the batch API
  ([`use_batch_api: true`](#limits-throttling-and-cost-framing)) to raise
  the rate ceiling from 12,000 to 360,000 calls per hour per subscription.
- **`azure_event_hub` receiver** consumes from an Event Hubs namespace
  that Diagnostic Settings pushes into. Decodes Azure Resource Logs and
  platform metrics from the Event Hub payload (platform metrics arrive
  as Gauge points with Total / Min / Max / Avg / Count datapoints, per
  the receiver's [native Azure
  decoder](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azureeventhubreceiver));
  beta stability for both signals.
- **`azureauthextension`** holds one identity per shard, federated to the
  runtime that hosts the collector (most often an AKS service account).
  Every receiver references it via `auth.authenticator: azure_auth`.

Per-surface guides spell out the exact YAML for each piece.

## Authentication

The `azureauthextension` supports four authentication methods, all
peers from the extension's perspective: **managed identity**, **workload
identity** (federated, the case where Microsoft Entra ID trusts a token
from an external identity provider), **service principal** with client
secret or certificate, and the Azure **default credential** chain. Pick
the one that matches how your collector runtime authenticates today.

For collectors running in AKS, EKS, GKE, on-prem Kubernetes, GitHub
Actions, or any runtime Microsoft Entra ID can federate with, **Workload
Identity Federation (WIF)** is the recommended default. It eliminates
client secrets entirely, which removes the largest silent-zero failure
mode (expired SP secrets are indistinguishable from "no traffic" on
dashboards). Microsoft documents the value plainly in
[Microsoft Entra Workload Identity Federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation):

> "These credentials pose a security risk and have to be stored securely
> and rotated regularly. You also run the risk of service downtime if the
> credentials expire."
>
> "You eliminate the maintenance burden of manually managing credentials
> and eliminates the risk of leaking secrets or having certificates
> expire."

Service principal with client secret remains fully supported for
deployments where federation is not available (e.g., shrink-wrapped
on-prem environments, runtimes outside the federation matrix); rotate
the secret on a schedule and alarm on expiry.

Reference snippet (used by every per-surface guide):

```yaml
extensions:
  azure_auth:
    workload_identity:
      client_id: ${env:AZURE_CLIENT_ID}
      tenant_id: ${env:AZURE_TENANT_ID}
      federated_token_file: /var/run/secrets/azure/tokens/azure-identity-token

receivers:
  azure_monitor:
    auth:
      authenticator: azure_auth
    # ... rest of config
```

The federated token is short-lived (typically one hour) and renewed
automatically by the cluster's projected service account token. There is
no expiry alarm because there is no static credential.

## Choosing pull, push, or both

| Aspect | Pull (`azure_monitor`) | Push (`azure_event_hub`) |
| --- | --- | --- |
| **What it consumes** | Metrics REST API | Diagnostic Settings → Event Hubs |
| **Stability** | alpha | beta |
| **Freshness** | ~3 minutes export + receiver `collection_interval` | Single-digit seconds |
| **Volume ceiling** | 360,000 API calls/hour/subscription | Bounded by Event Hubs throughput units |
| **Best for** | Slow / definitive metrics; resource types without streaming support; drift detection | High-volume metrics; resource logs; any signal you alert on |
| **Per-resource config** | None per resource | One Diagnostic Setting per resource |
| **Cost driver** | Free (REST API reads) | Event Hubs namespace + throughput units |

The decision rule for a real production deployment is **both**. Use the
pull leg for the metrics that change slowly (storage size, capacity,
billing-class counters) and for the safety net that confirms the push leg
matches Azure's own metrics database. Use the push leg for the metrics and
logs your dashboards and alert rules actually depend on.

The largest single resilience improvement available today is adding the
push leg to a pull-only deployment. It cuts pull-side REST volume 5-10x
for a typical multi-surface customer, drops alerting freshness to seconds,
and unblocks resource log ingestion at the same time.

## Latency expectations by signal

End-to-end latency for the four signal types Scout consumes from Azure.
The first three rows are quoted from
[Microsoft's published ingestion-time documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-ingestion-time);
the inactive backoff row is from the
[Diagnostic Settings reference](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings).

| Signal | Latency floor | Notes |
| --- | --- | --- |
| Platform metrics (pull leg) | ~3 minutes export + your scrape interval | "Available in under a minute in the metrics database, but they take another three minutes to be exported to the data collection endpoint" |
| Platform metrics (push leg) | Single-digit seconds | Diagnostic Settings to Event Hubs is push-mode through Microsoft's own pipeline |
| Resource logs | 3 to 10 minutes typical | "Azure SQL Database and Azure Virtual Network currently provide their logs every five minutes" |
| Activity logs | 3 to 20 minutes | Subscription-level control-plane events |
| Inactive resource backoff | up to 15 minutes after 1 hour idle; up to 2 hours after 7 days idle | Diagnostic Settings backs off zero-value emissions to reduce export cost |

Two operational consequences worth surfacing in customer dashboards:

- **No real-time alerting on resource logs.** Design alert rules with
  5-10 minute freshness as the floor for resource logs and 5-25 minutes
  for activity logs. Real-time alerting needs the metrics push leg.
- **Inactive resource backoff is not a bug.** A resource that goes idle
  will show a `metricsBackoffLatency` gap; explicit dashboard tiles for
  this avoid spurious "data missing" pages.

## Limits, throttling, and cost framing

The numbers that drive the design, all from
[Azure Monitor service limits](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/service-limits)
and the [Diagnostic Settings reference](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings):

| Limit | Default | With batch API | Source |
| --- | --- | --- | --- |
| Metrics REST API reads / hour / subscription | 12,000 | 360,000 | Service limits |
| Resources per `metrics:getBatch` request | n/a | 50 | Receiver README |
| Diagnostic settings per resource | 5 | 5 (max) | Service limits |
| Logs Ingestion API requests / minute / DCR | 12,000 | n/a | Service limits |
| Log Analytics ingestion volume rate threshold | 500 MB compressed (~6 GB/min uncompressed) | n/a | Service limits |

Three constraints worth budgeting around explicitly:

- **`use_batch_api: true` is non-negotiable** for any production pull-leg
  config. The 360,000 calls/hour ceiling is what makes multi-surface
  monitoring viable; the 12,000 default will throttle on any real estate.
- **5 Diagnostic Settings per resource** is a hard cap. Onboarding scripts
  must check existing settings count before provisioning a new one. If a
  customer is already on 5, the Scout setting either replaces a duplicate
  or merges destinations.
- **Same-region constraint**: Event Hubs and Storage destinations must be
  in the same region as the resource being monitored. The recommended
  topology is **one Event Hubs namespace per region per subscription**,
  not a single global hub. A multi-region, multi-subscription customer
  ends up with `R × S` Event Hubs namespaces; each per-surface guide
  shows the Bicep / IaC for one of them and you fan out from there.
- **Networking caveat for VNet-bound destinations**: when an Event Hubs
  namespace or Storage account has VNet rules enabled, Diagnostic
  Settings cannot reach it unless the namespace also has **"Allow
  trusted Microsoft services"** set. The Diagnostic Settings reference
  flags this explicitly. If your destinations are public-endpoint, this
  does not apply.

### Cost framing

For customers comparing "Scout + Log Analytics in parallel" against "Azure
Monitor alone":

- The Log Analytics line is unchanged (already paid).
- Scout adds an Event Hubs namespace + throughput units (typically modest;
  one TU handles ~1 MB/s ingress / ~1,000 events per second).
- Scout-side ingest is per the [Scout pricing page](https://base14.io/pricing).

The pitch is **consolidation**, not undercutting Azure Monitor on raw cost
per GB. Pricing differentiation is against Datadog and Dynatrace.

## What about traces?

Azure infrastructure resources do **not** emit OpenTelemetry traces.
There is no infrastructure-level distributed trace describing, for
example, "this Cosmos DB request was served by partition X, replicated to
region Y, took 12 ms in the index lookup." That kind of telemetry exists
inside Microsoft's fleet but is not exposed to customers in OTel trace
format on any documented Azure surface.

Distributed traces in the Azure ecosystem come from **application
instrumentation**:

- **Azure Monitor OpenTelemetry Distro** - Microsoft's recommended path
  for code-based server-side instrumentation. Outputs OTLP-shaped traces
  that target Scout directly without going through Azure Monitor.
- **Vanilla OpenTelemetry SDKs** for any language Scout's [App
  Instrumentation guides](/instrument/apps/auto-instrumentation/) cover.
- **Application Insights JavaScript SDK** for browser apps - per
  Microsoft's
  [overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview),
  the JS SDK is not OpenTelemetry. Browser telemetry is a separate path
  from this guide.

The trace path is therefore:

```text
Customer application
   │
   │ instrumented with OTel SDK / Azure Monitor Distro
   ▼
OTLP traces ───── direct ─────▶ base14 Scout
```

The Azure Monitor pipeline this guide describes is **not in that path**.
Per-surface guides for AKS, Cosmos DB, SQL Database, Service Bus, and
Front Door cover infrastructure metrics and logs only.

The one transitional case where Azure Monitor *does* carry traces is the
**Application Insights migration window**: customers transitioning off
Application Insights can dual-emit AppRequests and AppDependencies records
through Diagnostic Settings to Event Hubs, where the `azure_event_hub`
receiver decodes them. This is a bridge during cutover, not a sustainable
architecture; the long-term path is the Distro shipping OTLP directly.

## Per-surface guides

Pick the guide that matches the resource you're configuring. Each is the
execution playbook for that surface, including exact YAML, RBAC scope,
metric tables, and surface-specific gotchas.

| Surface | What you'll monitor | Guide |
| --- | --- | --- |
| **Azure Kubernetes Service (AKS)** - in-cluster pattern | Pod / node / cluster metrics via the OTel agent + Cluster collector + kube-state-metrics | [AKS guide](./aks.md) |
| **AKS via Helm** - Helm-installed variant of the above | Same scope, deployed via the OTel Helm chart | [AKS with Helm guide](./aks-with-helm.md) |
| **Azure Cosmos DB** (SQL / NoSQL API) | RU consumption, request rates, server-side latency, document count, storage, availability | [Cosmos DB guide](./cosmos-db.md) |
| **Azure SQL Database** | DTU / vCore utilisation, deadlocks, storage, log IO, query store metrics | [SQL Database guide](./sql-database.md) |
| **Azure Service Bus** | Active / dead-letter message counts, throughput, request counts, server errors | [Service Bus guide](./service-bus.md) |
| **Azure Front Door** (Standard / Premium) | Request count, request size, response size, latency, WAF metrics | [Front Door guide](./front-door.md) |
| **Azure Application Gateway** (v2 / WAF_v2) | Throughput, healthy / unhealthy host count, response status, backend latency; WAF_v2 rule matches | [Application Gateway guide](./application-gateway.md) |

Every per-surface guide assumes you have read this overview for the
shared concepts (auth, push vs pull, latency, trace gap) and links back
here for those topics rather than re-explaining.

## How these guides stay current

The OpenTelemetry collector-contrib `azure_monitor` and `azure_event_hub`
receivers move quickly, and Microsoft renames or deprecates platform
metrics from time to time. Scout tracks both upstream changelogs as part
of weekly maintenance, pins the validated contrib image in the example
configs, and refreshes per-surface guides when receiver behaviour
changes (the
[`azuremonitorreceiver` evolution
notebook](https://github.com/base-14/examples/blob/main/research/azuremonitorreceiver-evolution-2026-05.md)
is the public version-by-version trace). When you copy a config snippet
from a per-surface guide, the version it was validated against is
specified.

## Frequently Asked Questions

### How does base14 Scout consume Azure Monitor metrics?

Two ways. The `azure_monitor` receiver pulls from Azure Monitor's REST
API on a configurable interval. For higher volume and lower freshness,
Diagnostic Settings push metrics to an Event Hubs namespace, where the
`azure_event_hub` receiver consumes them and forwards via OTLP to
Scout. Most production deployments run both legs: pull for slow or
definitive metrics, push for fast metrics like latency and throttle
counters.

### Do I need to install an agent on my Azure resources?

No. Both paths use Azure-native interfaces (Metrics REST API and
Diagnostic Settings) that every Azure resource exposes. You run the
OpenTelemetry Collector somewhere that can reach those interfaces,
typically inside an AKS cluster or as an Azure Container Apps job.
Nothing is installed onto Cosmos DB, SQL Database, AKS control plane, or
any other managed resource.

### What permissions does Scout need on my Azure subscription?

For the pull leg: **Monitoring Reader** on each subscription you want to
scrape. That role grants read access to metric definitions and metric
values without any control-plane write permissions. For the push leg:
the customer's IaC needs **Monitoring Contributor** (or higher) at the
time it provisions Diagnostic Settings; Scout's runtime collector needs
`Manage`, `Send`, and `Listen` on the Event Hubs shared access policy it
consumes from. Both are documented inline in each per-surface guide.

### How fresh is metric data once it reaches Scout?

Pull leg: a few minutes end-to-end. Microsoft documents that platform
metrics are available in the metrics database in under a minute, then
take another three minutes to be exported to a data collection
endpoint; the receiver's `collection_interval` sits on top of that and
is yours to tune. Push leg via Event Hubs: single-digit seconds in
steady state. Use the push leg for any signal you want to alert on
quickly.

### Why do I not see distributed traces from Cosmos DB, SQL Database, or AKS?

Azure infrastructure resources do not emit OpenTelemetry traces
describing their own internal operations. Distributed traces come from
your application code, instrumented with the Azure Monitor OpenTelemetry
Distro or a vanilla OTel SDK, sent over OTLP directly to Scout. The
Azure Monitor pipeline this guide describes carries metrics and logs
only. Tracing your application code is a separate setup covered in the
[App Instrumentation guides](/instrument/apps/auto-instrumentation/).

### Can Scout coexist with my existing Log Analytics workspace?

Yes. A single Diagnostic Setting can fan out to a Log Analytics
workspace and an Event Hubs namespace simultaneously. Customers commonly
keep their Azure portal KQL workbooks running while Scout becomes the
primary observability surface. The data is duplicated, the cost on the
Log Analytics side is unchanged, and Scout adds the Event Hubs charge on
top.

### Should I use service principal secrets or workload identity?

If the runtime hosting your collector can federate with Microsoft Entra
ID (AKS, EKS, GKE, on-prem Kubernetes with workload identity, GitHub
Actions, Azure Pipelines), **Workload Identity Federation** is the
recommended default - it eliminates client secrets and the silent-zero
failure mode that comes with secret expiry. Service principal with
client secret is fully supported for runtimes where federation is not
available; rotate the secret on a schedule and alarm on expiry.
Managed identity and the default credential chain are also supported by
the `azureauthextension` and pick themselves in the right runtimes.

### How does Azure Monitor REST API throttling work, and how do I avoid 429s?

Set `use_batch_api: true` on the `azure_monitor` receiver. That switches
to the Metrics Data Plane API (`metrics:getBatch`), which raises the
per-subscription rate ceiling from 12,000 to 360,000 calls per hour and
lets a single REST call fetch metrics for up to 50 resources. Tune the
scrape interval and the resource set per shard so the projected call
rate stays inside that budget. If you operate at fleet scale and want
explicit headroom, shard by `(subscription, region)` so each shard's
ceiling is independent.

### What is the difference between the `azure_monitor` and `azure_event_hub` receivers?

`azure_monitor` pulls. It calls Azure Monitor's REST API on a schedule
and emits OTel metrics. Use it for slow or definitive signals and for
resource types that do not yet support streaming export.
`azure_event_hub` consumes. It reads from an Event Hubs namespace that
Diagnostic Settings has been configured to push into, and it decodes
Azure Resource Logs and platform metrics natively. Use it for
high-volume, low-latency signals and for any resource log surfacing in
Scout. Production deployments run both.

### Does Scout support Azure Government or Azure China clouds?

Yes. Both the `azure_monitor` and `azure_event_hub` receivers support
Azure Government, Azure China, and the Azure US Government cloud
variants by setting the `cloud` parameter and the appropriate management
endpoint. The auth model is identical to Azure public cloud. Per-surface
guides note any region-specific caveats for the resource type they
cover.

## Related Guides

- **App instrumentation** for distributed traces - see [App
  Instrumentation](/instrument/apps/auto-instrumentation/) for OTel SDK
  setup in Node, Python, .NET, Java, Go, PHP, and Ruby.
- **base14 Scout** - the OTel-native observability platform this guide
  is written for. See [base14.io](https://base14.io) for the platform
  pitch and pricing.

## References

- **Diagnostic Settings in Azure Monitor.** Universal entry point for
  resource logs and metric streaming.
  [learn.microsoft.com/azure/azure-monitor/essentials/diagnostic-settings](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/diagnostic-settings)
- **Log data ingestion time in Azure Monitor.** Latency expectations
  quoted in this guide.
  [learn.microsoft.com/azure/azure-monitor/logs/data-ingestion-time](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-ingestion-time)
- **Microsoft Entra Workload Identity Federation.** The secret-free auth
  path Scout standardises on.
  [learn.microsoft.com/entra/workload-id/workload-identity-federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- **`azure_monitor` receiver README.** Pull-leg receiver, alpha
  stability.
  [github.com/open-telemetry/opentelemetry-collector-contrib / receiver / azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- **`azure_event_hub` receiver README.** Push-leg receiver, beta
  stability.
  [github.com/open-telemetry/opentelemetry-collector-contrib / receiver / azureeventhubreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azureeventhubreceiver)
