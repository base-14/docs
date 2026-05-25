---
date: 2026-05-06
id: collecting-azure-event-hubs-telemetry
title: Azure Event Hubs Monitoring with OpenTelemetry - Throughput, Connections, and Capture
sidebar_label: Azure Event Hubs
sidebar_position: 11
description:
  Wire Azure Event Hubs metrics into your existing OpenTelemetry Collector
  and ship to base14 Scout. Covers receiver config, managed-identity auth,
  tier choice (Basic to Dedicated), Capture metrics, partition cardinality,
  and the streaming-vs-queueing distinction from Service Bus.
keywords:
  - azure event hubs monitoring
  - event hubs opentelemetry
  - azure monitor receiver
  - kafka compatible streaming
  - event hubs connections
  - event hubs capture metrics
  - event hubs basic vs standard
  - event hubs production monitoring
  - application insights alternative
  - base14 scout azure event hubs
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"When should I use Event Hubs vs Service Bus?","acceptedAnswer":{"@type":"Answer","text":"Event Hubs is a streaming primitive: high-throughput, partitioned, replay-capable, Kafka-compatible. Use it for telemetry pipelines, event sourcing, and stream processing where consumers track their own offsets. Service Bus is a queueing primitive: point-to-point or pub/sub via topics, with dead-letter queues, scheduled messages, and sessions. Use it for transactional messaging, work distribution, and request/reply patterns. Both expose Azure Monitor metrics through the same azure_monitor receiver; the resource type differs (Microsoft.EventHub/namespaces vs Microsoft.ServiceBus/namespaces) and the metric set emphasises throughput on Event Hubs vs message lifecycle on Service Bus."}},{"@type":"Question","name":"What changes between Basic, Standard, Premium, and Dedicated tiers for monitoring?","acceptedAnswer":{"@type":"Answer","text":"Metric coverage is largely the same across tiers, but feature availability gates several metrics. Capture metrics (CapturedMessages, CapturedBytes, CaptureBacklog) require Standard or higher because Basic does not support Capture. NamespaceCpuUsage and NamespaceMemoryUsage are Premium-only since they report dedicated-capacity-unit utilisation. ReplicationLagCount and ReplicationLagDuration require geo-paired namespaces, which are Premium-only. Basic also rejects user-created consumer groups; only the implicit $Default consumer group exists. Start at Standard if you need Capture, named consumer groups, longer retention than 1 day, or Kafka surface."}},{"@type":"Question","name":"What metrics are unavailable on Basic or without an active consumer?","acceptedAnswer":{"@type":"Answer","text":"OutgoingMessages and OutgoingBytes only emit when a consumer is reading; a producer-only namespace shows them as silent in Azure Monitor (no points returned, not zero values). Capture metrics (CapturedMessages, CapturedBytes, CaptureBacklog) emit nothing on Basic because Capture is a Standard+ feature. ServerErrors, UserErrors, ThrottledRequests, and QuotaExceededErrors are silent-when-quiet: Azure Monitor returns data points only for time windows where the underlying condition occurred, so a healthy namespace emits no series for them. Wire alerts on these to fire on series presence in window, not on threshold crossings."}},{"@type":"Question","name":"How does Event Hubs compare to AWS Kinesis Data Streams for monitoring?","acceptedAnswer":{"@type":"Answer","text":"Both are partitioned streaming primitives with similar producer-consumer-offset semantics. Monitoring shape differs in collection pattern: Event Hubs is pulled from Azure Monitor's metricDefinitions API via the azure_monitor receiver every 60 seconds; Kinesis is pushed via CloudWatch Metrics Stream into the awscloudwatchmetricstreamreceiver. Metric coverage is broadly equivalent (incoming and outgoing throughput, error counts, throttling) with vendor-specific names. Both surfaces flow through the same OTLP/HTTP exporter to Scout, so multi-cloud streaming dashboards are unified at query time."}},{"@type":"Question","name":"How do I instrument the producer and consumer code, not just the broker?","acceptedAnswer":{"@type":"Answer","text":"This guide is metrics-only. For per-message distributed traces (producer span linked through the broker to consumer span), instrument your producer and consumer with an OTel Event Hubs client integration. .NET applications use Azure.Messaging.EventHubs which emits ActivitySource spans; register OpenTelemetry.Extensions.Hosting and AddSource(\"Azure.Messaging.EventHubs\") to forward them. Java applications get auto-instrumentation via the OpenTelemetry Java agent and the azure-core-tracing-opentelemetry adapter. Python and Node.js client instrumentation is community-maintained; verify span shape before promoting. Run apps-side spans alongside this metrics collector with distinct service.name values to keep the broker view and the request-flow view separately filterable in Scout."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide is the **execution playbook** for Azure Event Hubs. For the
cross-surface architecture (auth, push vs pull, latency, the trace gap),
read [Azure Monitoring with OpenTelemetry - Architecture for base14
Scout](./overview.md) first.

This guide is for engineers running Event Hubs in production who want
to add Event Hubs telemetry to an existing OpenTelemetry Collector and
ship it to base14 Scout. The collector polls Azure Monitor's REST API
for `Microsoft.EventHub/namespaces` metrics every 60 seconds, emits
OTel metric series, and exports via OTLP/HTTP. The receiver does not
touch the Event Hubs data plane.

The receiver does not connect to Event Hubs directly. It queries Azure
Monitor for any namespace your subscription auto-publishes to, so the
same configuration covers Basic, Standard, Premium, and Dedicated tiers
across any number of event hubs and consumer groups per namespace.

This guide is metrics-only. For ingesting the events themselves into the
collector pipeline as logs or traces, see
[`azureeventhubreceiver` distinction](#azureeventhubreceiver-distinction).

## Event Hubs vs Service Bus

Event Hubs and Service Bus are both messaging primitives in Azure, but
they solve different problems. Pick by workload, not by metric overlap.

|  | Event Hubs | Service Bus |
| --- | --- | --- |
| Pattern | Streaming, partitioned, replay-capable | Queueing or pub/sub via topics |
| Consumer model | Pull, consumer-tracks-offset (Kafka semantics) | Lock-and-ack, broker-tracks-offset |
| Throughput | Millions of events/sec at Premium / Dedicated | Tens of thousands of msg/sec at Standard |
| Retention | 1 day (Basic) up to 90 days (Premium) | Per-message TTL, dead-letter on failure |
| Use cases | Telemetry pipelines, event sourcing, stream processing | Transactional messaging, work distribution, request/reply |
| Compatible with | Apache Kafka clients (Standard+) | AMQP 1.0 + REST + .NET / Java SDKs |

For the queueing surface, see
[Azure Service Bus](./service-bus.md). The receiver configuration is
nearly identical between the two; only the resource type and the metric
whitelist change.

## Tier choice

Azure Event Hubs has four pricing tiers. Each gates feature availability,
which in turn gates which metrics emit data.

| Tier | Throughput / quotas | Capture | Retention | Consumer groups | Metric coverage |
| --- | --- | --- | --- | --- | --- |
| **Basic** | 1-20 TUs (1 MB/s ingress, 2 MB/s egress per TU) | No | Max 1 day | `$Default` only - user-created groups rejected | 14 of 17 (all except Capture). `OutgoingMessages` and `OutgoingBytes` need an active consumer to emit. |
| **Standard** | 1-20 TUs, same per-TU envelope | Yes (to Blob Storage / Data Lake) | Max 7 days | Up to 20 user-created | All 17 in this guide's whitelist |
| **Premium** | Dedicated capacity units (CUs); per-CU envelope independent of TUs | Yes | Max 90 days | Up to 1,000 | All 17 + 4 Premium-only (`NamespaceCpuUsage`, `NamespaceMemoryUsage`, `ReplicationLagCount`, `ReplicationLagDuration`) |
| **Dedicated** | Reserved cluster; multiple Premium namespaces share a cluster | Yes | Max 90 days | Up to 1,000 per namespace | Same as Premium |

Start at Basic if you only need throughput and request metrics on a
single producer-and-consumer pair. Move to Standard if you want Capture
or named consumer groups. Premium and Dedicated are for fleets where
per-TU throughput limits or 7-day retention are blockers, or where
geo-disaster-recovery is a hard requirement.

## Receiver configuration

Add this fragment to your existing collector config. It contributes the
`azure_auth` extension, an `azure_monitor` receiver, a resource processor,
and a metrics pipeline. Component keys are suffixed `/eventhubs` so the
fragment composes cleanly with other Azure-surface receivers in the same
collector.

```yaml showLineNumbers title="otel-collector.yaml (Event Hubs addition)"
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
  azure_monitor/eventhubs:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
      # Add more entries to scrape namespaces across multiple subscriptions
      # in one collector. Each subscription needs its own Monitoring Reader
      # role assignment on the configured identity.
    resource_groups:
      - ${env:AZURE_RESOURCE_GROUP}
      # Omit resource_groups entirely to scrape every resource group in
      # the listed subscriptions.
    services:
      - Microsoft.EventHub/namespaces
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    # Legacy ARM /metrics endpoint. Immediate RBAC propagation; 12k calls/h
    # per-subscription ceiling. Flip to true to use the Metrics Data Plane
    # batch API (360k/h ceiling) once the data-plane RBAC has propagated;
    # see Scale and rate limits.
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    # The receiver only emits the metrics you list; there is no implicit
    # default + my picks merge. Each entry pins the Azure aggregation(s)
    # to emit per metric.
    metrics:
      "Microsoft.EventHub/namespaces":
        # Throughput (universal across Basic / Standard / Premium / Dedicated)
        IncomingMessages: [Total]
        OutgoingMessages: [Total]
        IncomingBytes: [Total]
        OutgoingBytes: [Total]
        IncomingRequests: [Total]
        SuccessfulRequests: [Total]
        ServerErrors: [Total]
        UserErrors: [Total]
        ThrottledRequests: [Total]
        QuotaExceededErrors: [Total]
        # Connections - Maximum aggregation only for Opened/Closed.
        ActiveConnections: [Average]
        ConnectionsOpened: [Maximum]
        ConnectionsClosed: [Maximum]
        # Sizing
        Size: [Average]
        # Capture (Standard+ feature; emits no points on Basic).
        CapturedMessages: [Total]
        CapturedBytes: [Total]
        CaptureBacklog: [Total]

processors:
  resource/eventhubs:
    attributes:
      - {key: cloud.provider,    value: azure,                               action: insert}
      - {key: cloud.platform,    value: azure_event_hubs,                    action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",      action: insert}
      - {key: cloud.region,      value: "${env:AZURE_REGION}",               action: insert}
      # cloud.resource_id pins all metrics to one namespace. Drop this line
      # for multi-namespace fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically.
      - {key: cloud.resource_id, value: "${env:EVENTHUBS_RESOURCE_ID}",      action: insert}
      - {key: service.name,      value: "${env:EVENTHUBS_SERVICE_NAME}",     action: insert}

service:
  # Merge `azure_auth` into your top-level extensions: block (defines it)
  # AND list it under service.extensions: (enables it). The two lists are
  # independent.
  extensions: [azure_auth]
  pipelines:
    metrics/eventhubs:
      receivers: [azure_monitor/eventhubs]
      processors: [resource/eventhubs, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                  # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed `/eventhubs`
so they coexist with other Azure receivers (Service Bus, Cosmos DB, Storage,
Load Balancer, Firewall) in a single collector. Your Scout exporter
(`oauth2client` + `otlphttp/b14`) stays unchanged; one Scout pipeline serves
every Azure surface.

For multi-subscription scoping, add entries to `subscription_ids:`. The
alternative `discover_subscriptions: true` scrapes every namespace the
identity has `Monitoring Reader` on; prefer the explicit list in
production, since discovery silently includes sandbox and dormant
subscriptions. See [Scale and rate limits](#scale-and-rate-limits).

## Authentication and RBAC

Pick the `azure_auth` mode for where the collector runs:

- **AKS pod** - `workload_identity` (federated credential, no secret).
- **Container Apps / VMSS / Azure VM** - `managed_identity` (user-assigned
  survives instance replacement).
- **External or on-prem** - `service_principal`.
- **Local dev only** - `use_default: true` (Azure SDK credential chain).

Grant `Monitoring Reader` at the resource group containing your namespaces.
For mode-by-mode YAML, federation-credential setup, and the
`az role assignment create` snippet, see
[Azure Service Bus § Authentication](./service-bus.md#authentication) -
the configuration is identical except for the receiver's `services:` line
and the resource processor's `cloud.platform` value.

This guide defaults `use_batch_api: false` to match the validated runnable
example. Flip to `true` once the data-plane RBAC has settled (5-30 minutes
after a fresh `Monitoring Reader` grant) for the 360k-calls/hour ceiling.

## What you'll monitor

Seventeen metrics from `Microsoft.EventHub/namespaces`. The receiver
renames them from Azure's PascalCase (e.g. `IncomingMessages`) to
OTel-style `azure_<lowercased>_<aggregation>` (e.g.
`azure_incomingmessages_total`).

| Azure REST name | OTel emitted | Unit | What it tells you |
| --- | --- | --- | --- |
| `IncomingMessages` | `azure_incomingmessages_total` | Count | Producer ingestion rate per event hub (`metadata_EntityName`). |
| `OutgoingMessages` | `azure_outgoingmessages_total` | Count | Consumer drain rate per event hub. Pair with `IncomingMessages` to see backlog growth. *Silent-when-quiet.* |
| `IncomingBytes` | `azure_incomingbytes_total` | Bytes | Producer byte rate. Track against TU envelope (1 MB/s per TU on Basic and Standard). |
| `OutgoingBytes` | `azure_outgoingbytes_total` | Bytes | Consumer byte rate. Track against TU egress envelope (2 MB/s per TU). *Silent-when-quiet.* |
| `IncomingRequests` | `azure_incomingrequests_total` | Count | Per-minute producer API call count. |
| `SuccessfulRequests` | `azure_successfulrequests_total` | Count | Successful subset of `IncomingRequests`. The `OperationResult` dimension (see [Cardinality control](#cardinality-control)) splits by Success / Failure / Throttle codes for cross-referencing the error counters. |
| `ServerErrors` | `azure_servererrors_total` | Count | Service-side failures. Alert on series presence. *Silent-when-quiet.* |
| `UserErrors` | `azure_usererrors_total` | Count | Client-induced errors (auth, malformed, oversize). High with low `ServerErrors` means producer / consumer code. *Silent-when-quiet.* |
| `ThrottledRequests` | `azure_throttledrequests_total` | Count | TU ceiling hit. *Silent-when-quiet.* |
| `QuotaExceededErrors` | `azure_quotaexceedederrors_total` | Count | Per-event-hub or per-message size / partition / send-quota breaches. *Silent-when-quiet.* |
| `ActiveConnections` | `azure_activeconnections_average` | Count | AMQP / Kafka connection count to the namespace. |
| `ConnectionsOpened` | `azure_connectionsopened_maximum` | Count | New connections established per poll. *Maximum-only aggregation* - `[Total]` silently emits nothing. |
| `ConnectionsClosed` | `azure_connectionsclosed_maximum` | Count | Connections closed per poll. *Maximum-only aggregation.* |
| `Size` | `azure_size_average` | Bytes | Bytes stored in the event hub. Pair with retention envelope. |
| `CapturedMessages` | `azure_capturedmessages_total` | Count | Messages archived by Capture. *Standard+ feature.* |
| `CapturedBytes` | `azure_capturedbytes_total` | Bytes | Bytes archived by Capture. *Standard+ feature.* |
| `CaptureBacklog` | `azure_capturebacklog_total` | Count | Bytes pending capture. Climbing means Capture target storage is throttling. *Standard+ feature.* |

`metadata_EntityName` rides alongside every per-event-hub metric, splitting
the namespace-scope series into per-event-hub series automatically. For
metrics that have no `EntityName` dimension at the Azure Monitor level
(`ConnectionsOpened`, `ConnectionsClosed`), the receiver injects the
sentinel value `metadata_EntityName: "-NamespaceOnlyMetric-"` so the
dimension column is stable across the full metric set. `ActiveConnections`
omits `metadata_EntityName` entirely.

**Silent-when-quiet.** Azure Monitor returns data points for these
metrics only when the underlying condition occurs. A healthy namespace
emits zero series for `ServerErrors`, `UserErrors`, `ThrottledRequests`,
and `QuotaExceededErrors`; a producer-only namespace with no consumer
drain emits zero for `OutgoingMessages` and `OutgoingBytes`. Wire alerts
on these metrics to fire on series presence in window (any non-zero point),
not on threshold crossings.

**Maximum-only aggregation.** `ConnectionsOpened` and `ConnectionsClosed`
support `Maximum` aggregation only per the
[Microsoft.EventHub/namespaces metric
reference](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-eventhub-namespaces-metrics).
Listing them with `[Total]` returns no data points and no error.

**Standard+ feature.** Capture metrics (`CapturedMessages`,
`CapturedBytes`, `CaptureBacklog`) emit only when Capture is configured,
which requires Standard tier or higher and a target storage account.
On Basic, the three metrics are silent.

**Premium-only metrics.** `NamespaceCpuUsage`, `NamespaceMemoryUsage`,
`ReplicationLagCount`, and `ReplicationLagDuration` are Premium-tier only;
Basic and Standard return 401 if listed. See
[Premium-tier additions](#premium-tier-additions).

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST API.
Azure Monitor enforces two ceilings:

| Endpoint | Rate limit | When it applies |
| --- | --- | --- |
| Legacy Azure Resource Manager `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Default in this guide. Immediate RBAC propagation. |
| Data-plane batch (`use_batch_api: true`) | 360,000 calls / hour / subscription | Switch once data-plane RBAC has propagated (5-30 min after grant). |

At a 60-second collection interval, a single resource costs roughly 60
calls per hour (one per metric per poll, deduplicated within the receiver).
A 50-namespace fleet running on legacy `/metrics` consumes ~3,000 calls
per hour - well within the 12k ceiling. Above ~150 namespaces per
subscription, switch to `use_batch_api: true` to lift the per-subscription
ceiling and benefit from batched fan-out.

The receiver shares one rate-limit budget across all subscriptions in the
list; it does not bypass per-subscription quotas. Splitting heavy
subscriptions across separate collector instances lifts the aggregate
ceiling linearly.

`cache_resources` is the resource-list cache TTL in seconds. The receiver
default is `86400` (24 hours), which is correct for a stable fleet. Lower
to `3600` or `600` only if namespaces are created and destroyed frequently
enough that 24-hour-stale resource lists become a problem.

## Cardinality control

By default, the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. With 17
metrics, one aggregation each, and `metadata_EntityName` as the sole
dimension on per-event-hub metrics, a 1-event-hub namespace produces
roughly 17 series. Multi-event-hub fan-out multiplies linearly on the
12 metrics that split by `EntityName`; the 5 metrics without
`EntityName` (`ActiveConnections`, `ConnectionsOpened`,
`ConnectionsClosed`, and the 2 namespace-level Capture rollups) emit
once per namespace regardless of event-hub count.

```text
~5 + (12 × M event-hubs) per namespace × N namespaces ≈ active series
```

A worked example: 5 namespaces × 2 event hubs each ≈ 5 × (5 + 12 × 2)
= 145 series before any `OperationResult` fan-out on the error
counters. Partitions do not contribute extra series - partition is
exposed via the SDK consumer-group offsets, not at the Azure Monitor
namespace level.

`OperationResult` adds a fan-out factor of 1.5-3x on `SuccessfulRequests`,
`ServerErrors`, `UserErrors`, `ThrottledRequests`, and `QuotaExceededErrors`
during error-heavy windows. Two control levers, in order of preference:

1. **`dimensions.overrides`** drops or whitelists dimensions per metric.
   Drop `EntityName` on namespaces where per-event-hub granularity is
   not actionable for alerting; drop `OperationResult` on metrics other
   than the error / throttle counters.

   The override config uses the **bare Azure dimension name** (e.g.
   `EntityName`, not `metadata_EntityName`); the receiver adds the
   `metadata_` prefix when it emits.

   ```yaml
   azure_monitor/eventhubs:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.EventHub/namespaces":
           IncomingMessages:
             - EntityName       # keep
           ServerErrors:
             - EntityName
             - OperationResult
           ThrottledRequests:
             - EntityName
             - OperationResult
           Size: []             # drop EntityName too; aggregate at namespace level
   ```

2. **Per-namespace receiver instances.** Split high-cardinality namespaces
   into separate `azure_monitor/eventhubs-bigfleet` and
   `azure_monitor/eventhubs-quiet` receivers with different override
   profiles. Both contribute to the same `metrics/eventhubs` pipeline.

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric on
the collector's Prometheus self-telemetry endpoint (port 8888 by default)
to see actual cardinality after `overrides` apply.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting points;
derive your own from observed 99th percentile over a representative week.

`azure_throttledrequests_total`, `azure_servererrors_total`,
`azure_usererrors_total`, and `azure_quotaexceedederrors_total` only emit
data points when their condition occurs. Wire alerts on these to fire on
series presence in window, not on numeric thresholds; a healthy namespace
emits no points at all.

| Metric (OTel name) | Warning | Critical | Why it matters |
| --- | --- | --- | --- |
| `azure_incomingbytes_total` (per `metadata_EntityName`) / TU envelope | > 70% | > 90% | TU ingress saturation. Each TU is 1 MB/s on Basic and Standard. |
| `azure_outgoingbytes_total` (per `metadata_EntityName`) / TU egress envelope | > 70% | > 90% | TU egress saturation. Each TU is 2 MB/s. Egress saturation hits before ingress in fan-out-heavy workloads. |
| `azure_throttledrequests_total` | `> 0` over 5m | `> 0` over 15m | TU ceiling hit. Add TUs (Basic / Standard scale-out) or upgrade to Premium. |
| `azure_servererrors_total` | `> 0` over 5m | `> 0` over 15m | Service-side failures. Cross-check Azure Service Health. |
| `azure_capturebacklog_total` (Standard+) | climbing | sustained climbing | Capture target storage is throttling or unreachable. Investigate the destination Blob / Data Lake account. |
| `azure_size_average` per event hub / retention envelope | > 80% | > 95% | Approaching the per-event-hub byte cap. Drain consumer or split into more event hubs. |
| `azure_activeconnections_average` (per namespace) | > 5x baseline / 15m | sustained > 10x | Misbehaving client opening connections in a loop. Set baseline from a steady-state week. |

### RED method on the broker

If you run Event Hubs as part of a service backed by service-level
objectives (SLOs), frame Event Hubs metrics as RED (rate, errors,
duration) on the broker:

- **Rate.** `azure_incomingrequests_total` per namespace, sliced by event
  hub. For consumer-side rate, instrument the apps-side Event Hubs client
  (see [Apps-side instrumentation](#apps-side-instrumentation)).
- **Errors.** Split into two service-level indicators (SLIs):
  - **Availability error rate** = `(azure_servererrors_total +
    azure_throttledrequests_total + azure_quotaexceedederrors_total) /
    azure_incomingrequests_total`. Routes to platform on-call.
  - **Request-quality error rate** = `azure_usererrors_total /
    azure_incomingrequests_total`. Routes to the owning service team.
- **Duration.** Event Hubs does not expose a broker-side latency metric
  (Service Bus's `ServerSendLatency` has no Event Hubs equivalent). For
  end-to-end producer-to-consumer latency, instrument the client.

For saturation (the U in USE), pair `azure_incomingbytes_total / TU
envelope`, `azure_outgoingbytes_total / TU envelope`, `azure_size_average
/ retention envelope`, and `azure_throttledrequests_total > 0`. On
Premium, add `azure_namespacecpuusage_maximum` and
`azure_namespacememoryusage_maximum` for direct messaging-unit
utilisation.

## Premium-tier additions

Premium adds dedicated capacity units, optional geo-disaster recovery
(geo-DR), and a handful of extra metrics. When the namespace is Premium,
extend the whitelist:

```yaml
metrics:
  "Microsoft.EventHub/namespaces":
    # ...all 17 from the universal + Capture set above...
    NamespaceCpuUsage: [Average]      # CU CPU saturation; alert > 70%
    NamespaceMemoryUsage: [Average]   # CU memory saturation; alert > 70%
    ReplicationLagCount: [Maximum]    # geo-DR lag in messages (paired only)
    ReplicationLagDuration: [Maximum] # geo-DR lag in seconds (paired only)
```

Aggregations match the rest of the whitelist: one per metric. CPU /
memory use Average for steady-state alerting; replication lag uses
Maximum because the worst-case lag is the operationally relevant
number.

The `Replica` dimension splits replication-lag metrics across paired
namespaces. A geo-DR failover changes which replica is active without
changing metric content. Pin dashboards to namespace name rather than
resource id if you want continuity across failover.

## `azureeventhubreceiver` distinction

This guide uses **`azuremonitorreceiver`** to read **metrics about**
Event Hubs from Azure Monitor's REST API. It does not connect to Event
Hubs itself.

A separate receiver, **`azureeventhubreceiver`**, ingests **the events
themselves** as OTel logs or traces into the collector pipeline. That is
a different workflow - typically used for Diagnostic Settings logs
forwarded from another Azure surface (Service Bus, Storage, AKS) into an
Event Hub for centralised processing. It is covered separately, not in
this guide.

If you want both - metrics about Event Hubs and event-data ingestion via
Event Hubs - run both receivers in the same collector. They do not
interact.

## Apps-side instrumentation

This guide is metrics-only. To produce per-message distributed traces
(producer span linked through the broker to consumer span), instrument
your producer / consumer code with one of these OTel Event Hubs
integrations:

- **.NET / C#:** `Azure.Messaging.EventHubs` ships built-in
  ActivitySource emission. Add `OpenTelemetry.Extensions.Hosting` and
  register `AddSource("Azure.Messaging.EventHubs")` to forward producer,
  consumer, and receive spans.
- **Java:** the OTel Java agent (`opentelemetry-javaagent.jar`)
  auto-instruments the Azure SDK
  (`com.azure:azure-messaging-eventhubs`) via the
  `azure-core-tracing-opentelemetry` adapter. No code changes.
- **Python:** community
  `opentelemetry-instrumentation-azure-eventhub` packages exist; verify
  span shape before promoting.
- **Node.js / Go:** no first-party OTel instrumentation as of 2026-05.
  Manual span creation around `producer.sendBatch` and `consumer.receive`
  is the workaround.

Run apps-side spans alongside this metrics collector with distinct
`service.name` values to keep the broker view and the request-flow view
separately filterable in Scout.

## Logs

Two destinations, two purposes:

- **Log Analytics workspace** (`--workspace`) - for ad-hoc query in the
  Azure Portal or Log Analytics. Not in the Scout pipeline.
- **Event Hubs** (`--event-hub-rule`) - for OTel ingest via the
  `azureeventhubreceiver` into the same collector. Architecture in the
  [overview](./overview.md#choosing-pull-push-or-both).

The Event Hubs log categories worth enabling:

| Log category | What it captures |
| --- | --- |
| `OperationalLogs` | Namespace-level operational events |
| `RuntimeAuditLogs` | Data-plane authentication and authorisation activity |
| `KafkaCoordinatorLogs` (Standard+) | Kafka surface coordination events |
| `KafkaUserErrorLogs` (Standard+) | Kafka client errors |

```bash
# Log Analytics destination (ad-hoc query):
az monitor diagnostic-settings create \
  --resource <namespace-resource-id> \
  --name eventhubs-to-loganalytics \
  --logs '[{"category":"OperationalLogs","enabled":true},{"category":"RuntimeAuditLogs","enabled":true}]' \
  --workspace <log-analytics-workspace-id>
```

Activity logs (control-plane operations on the namespace) are
**subscription-scoped**, not resource-scoped; configure them once per
subscription via `az monitor diagnostic-settings subscription create`.

## Troubleshooting

### `AuthorizationFailed` from the receiver in the first 60 seconds

`Monitoring Reader` propagation on the legacy ARM `/metrics` endpoint
is fast but not instantaneous. Wait one minute after the role assignment
before declaring an auth failure. If the data-plane batch API is in use
(`use_batch_api: true`), allow 5-30 minutes for separate data-plane
RBAC propagation; flip to `false` as a temporary fallback to confirm the
role itself is correct.

### `metrics_definitions_count: 0` on first poll after provisioning

Azure Monitor's metric-definition catalogue can lag a few minutes behind
namespace provisioning. The receiver caches a zero-count for the
`cache_resources` interval (default 86400 / 24 h) and stops re-discovering
within that window - symptom: receiver scrapes successfully but emits
zero metric points. **Workaround:** restart the collector once after the
namespace reaches `provisioningState=Succeeded`. This resets the
discovery cache. Tracked upstream as
[issue #46047](https://github.com/open-telemetry/opentelemetry-collector-contrib/issues/46047).

### `OutgoingMessages` and `OutgoingBytes` stay at zero

There is no consumer reading from the event hub. Azure Monitor only
emits points for these metrics when a consumer is actively pulling.
Producer-only validation runs are expected to see them silent - this is
not a bug. Add a consumer (apps-side instrumentation) to drive the
metrics.

### `ConnectionsOpened` or `ConnectionsClosed` returns no points

`Maximum`-only aggregation; `[Total]` or `[Average]` returns no data and
no error. See the [metric table](#what-youll-monitor) note.

### Capture metrics emit zero on Basic SKU

Capture is a Standard+ feature. `CapturedMessages`, `CapturedBytes`, and
`CaptureBacklog` will not emit points on Basic. Either upgrade to Standard
to enable Capture, or remove the three metrics from the whitelist.

### Bicep deploy fails with `MessagingGatewayBadRequest` on consumer-group resource

Basic tier rejects user-created consumer groups. Only the implicit
`$Default` consumer group exists. Remove the
`Microsoft.EventHub/namespaces/eventhubs/consumergroups@2024-01-01` child
from your Bicep template, or upgrade the namespace SKU to Standard before
deploying named consumer groups.

### Cardinality blowup on Scout volume

A single high-fan-out namespace (many event hubs, all per-event-hub
metrics enabled) can dominate volume. Apply `dimensions.overrides` (see
[Cardinality control](#cardinality-control)) or split the noisy namespace
into a separate receiver instance with a narrower whitelist.

### Scout OAuth2 returns 401

Verify `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL`
match the values in your Scout console. The `endpoint_params.audience`
must be `b14collector`.

## Frequently Asked Questions

### When should I use Event Hubs vs Service Bus?

Event Hubs is a streaming primitive: high-throughput, partitioned,
replay-capable, Kafka-compatible. Use it for telemetry pipelines, event
sourcing, and stream processing where consumers track their own offsets.
Service Bus is a queueing primitive: point-to-point or pub/sub via topics,
with dead-letter queues, scheduled messages, and sessions. Use it for
transactional messaging, work distribution, and request/reply patterns.
Both expose Azure Monitor metrics through the same `azure_monitor`
receiver; the resource type differs (`Microsoft.EventHub/namespaces` vs
`Microsoft.ServiceBus/namespaces`) and the metric set emphasises
throughput on Event Hubs vs message lifecycle on Service Bus.

### What changes between Basic, Standard, Premium, and Dedicated tiers for monitoring?

Metric coverage is largely the same across tiers, but feature availability
gates several metrics. Capture metrics (`CapturedMessages`, `CapturedBytes`,
`CaptureBacklog`) require Standard or higher because Basic does not
support Capture. `NamespaceCpuUsage` and `NamespaceMemoryUsage` are
Premium-only since they report dedicated-capacity-unit utilisation.
`ReplicationLagCount` and `ReplicationLagDuration` require geo-paired
namespaces, which are Premium-only. Basic also rejects user-created
consumer groups; only the implicit `$Default` consumer group exists.
Start at Standard if you need Capture, named consumer groups, longer
retention than 1 day, or the Kafka surface.

### What metrics are unavailable on Basic or without an active consumer?

`OutgoingMessages` and `OutgoingBytes` only emit when a consumer is
reading; a producer-only namespace shows them as silent in Azure Monitor
(no points returned, not zero values). Capture metrics
(`CapturedMessages`, `CapturedBytes`, `CaptureBacklog`) emit nothing on
Basic because Capture is a Standard+ feature. `ServerErrors`, `UserErrors`,
`ThrottledRequests`, and `QuotaExceededErrors` are silent-when-quiet:
Azure Monitor returns data points only for time windows where the
underlying condition occurred, so a healthy namespace emits no series for
them. Wire alerts on these to fire on series presence in window, not on
threshold crossings.

### How does Event Hubs compare to AWS Kinesis Data Streams for monitoring?

Both are partitioned streaming primitives with similar
producer-consumer-offset semantics. Monitoring shape differs in collection
pattern: Event Hubs is pulled from Azure Monitor's `metricDefinitions` API
via the `azure_monitor` receiver every 60 seconds; Kinesis is pushed via
CloudWatch Metrics Stream into the `awscloudwatchmetricstreamreceiver`.
Metric coverage is broadly equivalent (incoming and outgoing throughput,
error counts, throttling) with vendor-specific names. Both surfaces flow
through the same OTLP/HTTP exporter to Scout, so multi-cloud streaming
dashboards are unified at query time.

### How do I instrument the producer and consumer code, not just the broker?

This guide is metrics-only. For per-message distributed traces (producer
span linked through the broker to consumer span), instrument your
producer and consumer with an OTel Event Hubs client integration.
.NET applications use `Azure.Messaging.EventHubs` which emits
ActivitySource spans; register `OpenTelemetry.Extensions.Hosting` and
`AddSource("Azure.Messaging.EventHubs")` to forward them. Java
applications get auto-instrumentation via the OpenTelemetry Java agent
and the `azure-core-tracing-opentelemetry` adapter. Python and Node.js
client instrumentation is community-maintained; verify span shape before
promoting. Run apps-side spans alongside this metrics collector with
distinct `service.name` values to keep the broker view and the
request-flow view separately filterable in Scout.

## Reference

- **Receiver source.**
  [opentelemetry-collector-contrib / receiver /
azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver).
- **Auth extension source.**
  [opentelemetry-collector-contrib / extension /
azureauthextension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/azureauthextension).
- **Azure Monitor metric reference.**
  [Microsoft.EventHub/namespaces
metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-eventhub-namespaces-metrics).
- **Runnable example.**
  [`examples/components/azure-event-hubs-telemetry/`](https://github.com/base-14/examples/tree/main/components/azure-event-hubs-telemetry)
  - Bicep + provisioning wrappers + Python traffic generator.

## Related Guides

- [Azure Service Bus](./service-bus.md) - managed message broker for
  queues and topics. Pick Service Bus for transactional messaging and
  work distribution; pick Event Hubs for high-throughput partitioned
  streaming.
- [Azure Monitoring with OpenTelemetry - Architecture](./overview.md) -
  cross-surface architecture for the Azure track.
- [Azure Storage](./storage.md) - managed object/blob/queue/table/file
  storage.
- [Azure Cosmos DB](./cosmos-db.md) - globally-distributed multi-model
  NoSQL database.
- [Azure SQL Database](./sql-database.md) - managed relational database.
