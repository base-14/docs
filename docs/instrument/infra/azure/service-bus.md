---
date: 2026-05-03
id: collecting-azure-service-bus-telemetry
title: Azure Service Bus Monitoring with OpenTelemetry - Production Wiring for SREs
sidebar_label: Azure Service Bus
sidebar_position: 4
description:
  Wire Azure Service Bus metrics into your existing OpenTelemetry Collector
  and ship to base14 Scout. Production-shaped guidance on receiver config,
  managed-identity auth, multi-subscription scale, cardinality control,
  alert tuning, and the migration path from Application Insights.
keywords:
  - azure service bus monitoring
  - service bus opentelemetry
  - azure monitor receiver
  - service bus managed identity
  - workload identity federation
  - service bus production monitoring
  - service bus sli slo
  - service bus cardinality
  - application insights alternative
  - base14 scout azure service bus
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Service Bus metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.ServiceBus/namespaces, then route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every 60 seconds and emits one OTel metric per Azure aggregation. No data-plane connection to Service Bus; the broker is never on the collector's path."}},{"@type":"Question","name":"Should I use a service principal or managed identity for the collector?","acceptedAnswer":{"@type":"Answer","text":"Managed identity if the collector runs in Azure, service principal if it doesn't. AKS pods use Workload Identity Federation with a federated credential bound to a Kubernetes ServiceAccount; Container Apps and Virtual Machine Scale Sets use system-assigned or user-assigned managed identity; out-of-Azure collectors fall back to service principal. The azure_auth extension's mode block is the only thing that changes; the rest of the receiver config is identical."}},{"@type":"Question","name":"How do I scope the receiver to multiple subscriptions and resource groups?","acceptedAnswer":{"@type":"Answer","text":"subscription_ids and resource_groups are both lists. The receiver fans out queries across all combinations, sharing one Azure Resource Manager rate-limit budget per subscription. With Monitoring Reader granted on each scope, one collector can poll dozens of namespaces across many subscriptions; flip use_batch_api to true once you exceed roughly fifty resources to lift the per-subscription ceiling from 12,000 to 360,000 calls per hour."}},{"@type":"Question","name":"How do I keep metric cardinality under control with thousands of entities?","acceptedAnswer":{"@type":"Answer","text":"By default the receiver emits a series per entity per metric per aggregation; a 50-namespace fleet with 200 entities each and 13 whitelisted metrics produces roughly 100,000 active series. Use dimensions.overrides on the receiver to drop EntityName or OperationResult on namespaces where per-entity granularity is not actionable. Drop the count and total aggregations on latency metrics; only average, minimum, and maximum are operationally meaningful for durations."}},{"@type":"Question","name":"How does Scout compare to Application Insights for Service Bus?","acceptedAnswer":{"@type":"Answer","text":"Both surfaces draw from the same Azure Monitor REST API, so metric coverage is identical. The differences are commercial and operational: Scout is vendor-neutral OTLP, queryable via SQL, with ingest-volume pricing rather than per-GB ingestion fees; Application Insights is Kusto Query Language-only, Azure-tenant-bound, and bills for log ingestion alongside metric storage. The collector also unifies multi-cloud surfaces under one pipeline: Service Bus, Cosmos DB, AKS, and AWS or GCP equivalents flow through the same exporter."}},{"@type":"Question","name":"What is the service principal secret rotation procedure?","acceptedAnswer":{"@type":"Answer","text":"Generate a new credential with az ad app credential reset --append (the --append flag preserves the existing credential so the collector can roll over without downtime), update the AZURE_CLIENT_SECRET secret store the collector reads from, restart or hot-reload the collector, then revoke the old credential. The federated-credential alternative (Workload Identity Federation for AKS, system-assigned managed identity for Container Apps) eliminates the rotation entirely; if the collector runs in Azure, prefer that path."}},{"@type":"Question","name":"Do I need this guide AND Diagnostic Settings to Log Analytics?","acceptedAnswer":{"@type":"Answer","text":"Yes if you want logs alongside metrics. This guide ships metrics. For activity logs, operational logs, and runtime audit logs from the namespace, configure Diagnostic Settings on the namespace to forward to Log Analytics or to Event Hubs and pipe Event Hubs into the collector via the azure_event_hub receiver. The two paths are complementary: metrics for SLI and SLO dashboards and alerts, logs for incident investigation."}}]}
---

## Overview

This guide is for engineers running Azure Service Bus in production who want
to add Service Bus telemetry to an existing OpenTelemetry Collector and ship
it to base14 Scout. The collector polls Azure Monitor's REST API for
`Microsoft.ServiceBus/namespaces` metrics every 60 seconds, emits OTel
metric series, and exports via OTLP/HTTP. Nothing on the data plane.

The receiver does not connect to Service Bus directly. It queries Azure
Monitor for any namespace your subscription auto-publishes to, so the same
configuration covers Basic, Standard, and Premium tiers and any number of
queues, topics, and subscriptions per namespace.

This guide is metrics-only. For per-message distributed traces, instrument
your producer and consumer code with an OTel Service Bus client integration
(see [Apps-side instrumentation](#apps-side-instrumentation)).

## Receiver configuration

Add this fragment to your existing collector config. It contributes the
`azure_auth` extension, an `azure_monitor` receiver, a resource processor,
and a metrics pipeline. Component keys are suffixed `/servicebus` so the
fragment composes cleanly with other Azure-surface receivers in the same
collector.

```yaml showLineNumbers title="otel-collector.yaml (Service Bus addition)"
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
  azure_monitor/servicebus:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
      # Add more entries to scrape namespaces across multiple subscriptions
      # in one collector. Each subscription needs its own Monitoring Reader
      # role assignment on the configured identity; the receiver fans out queries across
      # all subscription x resource-group combinations.
    resource_groups:
      - ${env:AZURE_RESOURCE_GROUP}
      # Multi-resource-group scoping. Omit resource_groups entirely to scrape every resource group
      # in the listed subscriptions.
    services:
      - Microsoft.ServiceBus/namespaces
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    # Legacy Azure Resource Manager /metrics path. Monitoring Reader propagates immediately on
    # this endpoint. Flip to true (with use_batch_api) once you exceed ~50
    # resources to lift the per-subscription rate ceiling from 12k to 360k
    # calls/hour; see Scale and rate limits below.
    use_batch_api: false
    # Resource-list cache TTL in seconds. The receiver default is 86400 (24h),
    # which is the right setting for a stable fleet. Lower (e.g. 3600 or 600)
    # only if namespaces are added or removed frequently.
    cache_resources: 86400
    dimensions:
      enabled: true
    # The receiver only emits the metrics you list; there is no implicit
    # default + my picks merge. Empty aggregation list `[]` requests all
    # aggregations Azure Monitor publishes for the metric.
    metrics:
      "Microsoft.ServiceBus/namespaces":
        IncomingRequests: []
        SuccessfulRequests: []
        ServerErrors: []
        UserErrors: []
        ThrottledRequests: []
        ServerSendLatency: []
        IncomingMessages: []
        OutgoingMessages: []
        ActiveMessages: []
        DeadletteredMessages: []
        ScheduledMessages: []
        Size: []
        ActiveConnections: []

processors:
  resource/servicebus:
    attributes:
      - {key: cloud.provider,    value: azure,                              action: insert}
      - {key: cloud.platform,    value: azure_service_bus,                  action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",     action: insert}
      - {key: cloud.region,      value: "${env:AZURE_REGION}",              action: insert}
      # cloud.resource_id pins all metrics to one namespace. Drop this line
      # for multi-namespace fleets; the receiver injects azuremonitor.resource_id
      # per-resource automatically.
      - {key: cloud.resource_id, value: "${env:SERVICEBUS_RESOURCE_ID}",    action: insert}
      - {key: service.name,      value: "${env:SERVICEBUS_SERVICE_NAME}",   action: insert}

service:
  extensions: [azure_auth]   # keep your existing extensions alongside
  pipelines:
    metrics/servicebus:
      receivers: [azure_monitor/servicebus]
      processors: [resource/servicebus, batch]   # plus your existing processors
      exporters: [otlphttp/b14]                   # your Scout exporter
```

The receiver, resource processor, and pipeline are all keyed `/servicebus`
so they coexist with other Azure receivers (Cosmos DB, SQL Database, Storage)
in a single collector. Your Scout exporter (`oauth2client` + `otlphttp/b14`)
stays unchanged; one Scout pipeline serves every Azure surface.

For multi-subscription scoping, the `subscription_ids:` list takes any
number of entries; alternatively set `discover_subscriptions: true` to
scrape every subscription the configured identity has `Monitoring Reader`
on, with no explicit list. See
[Scale and rate limits](#scale-and-rate-limits).

## Authentication

`azure_auth` supports four modes. Pick the one matching where the collector
runs.

| Collector deployment            | Recommended mode      | Why                                                                       |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| Azure Kubernetes Service (AKS) pod | `workload_identity` | Federated credential, no secret to rotate, scoped to the ServiceAccount.  |
| Container Apps                  | `managed_identity` (system or user-assigned) | First-class integration, no secret to rotate.    |
| Virtual Machine Scale Sets / Azure VM                 | `managed_identity` (user-assigned) | User-assigned identity survives instance replacement; the system-assigned identity dies with the VM or scale-set instance. |
| External or on-prem             | `service_principal`   | Only option without an Azure-resident identity.                           |
| Local dev / ad-hoc              | `use_default: true`   | Falls back to the Azure SDK default credential chain (CLI, env, managed identity).      |

### Workload Identity Federation (Azure Kubernetes Service)

The cleanest production auth. Bind a federated credential on a Microsoft
Entra app registration to your collector's Kubernetes ServiceAccount; the
collector mounts a token file and exchanges it for an Azure access token
on every request. No client secret. No rotation.

```yaml
extensions:
  azure_auth:
    workload_identity:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}      # the user-assigned managed identity's clientId
      federated_token_file: /var/run/secrets/azure/tokens/azure-identity-token
```

Setup:

1. Enable the workload-identity addon on the AKS cluster
   (`az aks update --enable-workload-identity --enable-oidc-issuer`).
2. Create a user-assigned managed identity, capture its `clientId` and
   `principalId`.
3. Add a federated credential to the managed identity scoped to your ServiceAccount:

   ```bash
   az identity federated-credential create \
     --name otel-collector-fed \
     --identity-name otel-collector-mi \
     --resource-group <mi-rg> \
     --issuer "$(az aks show -g <aks-rg> -n <aks> --query oidcIssuerProfile.issuerUrl -o tsv)" \
     --subject "system:serviceaccount:<namespace>:<serviceaccount>"
   ```

4. Annotate the ServiceAccount: `azure.workload.identity/client-id: <mi-clientId>`.
5. Label the collector pod: `azure.workload.identity/use: "true"`.
6. Grant `Monitoring Reader` to the managed identity's `principalId` on
   every Service Bus resource group it should scrape.

### Managed Identity (Container Apps, Virtual Machine Scale Sets, Azure VM)

```yaml
extensions:
  azure_auth:
    managed_identity:
      # System-assigned: omit client_id; the resource's identity is used.
      # User-assigned: provide the client_id of the assigned managed identity.
      client_id: ${env:AZURE_CLIENT_ID}   # optional for system-assigned
```

Container Apps: assign system-assigned managed identity on the app
(`az containerapp identity assign --system-assigned`); grant the resulting
`principalId` `Monitoring Reader` on each target resource group.

### Service Principal (out-of-Azure collectors)

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}
```

`AZURE_CLIENT_SECRET` is the only credential that needs rotation; see
[Service principal credential lifecycle](#service-principal-credential-lifecycle).

### RBAC scope

`Monitoring Reader` at the resource group containing your namespaces is
sufficient and minimal. The role grants read on metric definitions and
metric data only, no control-plane write. `Reader` is not required.

```bash
RG_ID=$(az group show --name <your-rg> --query id -o tsv)
az role assignment create \
  --assignee <appId or principalId> \
  --role "Monitoring Reader" \
  --scope "$RG_ID"
```

For multi-subscription fleets, repeat the assignment on each subscription's
resource group. Subscription-scoped assignments work too if the managed
identity or service principal should see every namespace in a subscription.

RBAC propagation on the legacy Azure Resource Manager `/metrics` endpoint
is immediate. The data-plane batch API at `*.metrics.monitor.azure.com`
requires separate propagation that lags 5-30 minutes after grant; flip
`use_batch_api: true` only after the role has settled.

## What you'll monitor

Thirteen metrics from `Microsoft.ServiceBus/namespaces`. The receiver renames
them from Azure's PascalCase (e.g. `IncomingMessages`) to OTel-style
`azure_<lowercased>_<aggregation>` (e.g. `azure_incomingmessages_total`).
Counter-style metrics emit five aggregations per poll
(`_average`, `_count`, `_maximum`, `_minimum`, `_total`); gauge-style
metrics emit only `_average` when the aggregation list is empty.

| Azure REST name        | OTel emitted                       | Unit  | What it tells you                                                                                            |
| ---------------------- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `IncomingRequests`     | `azure_incomingrequests_*`         | Count | Per-minute API call count to the namespace (sends, receives, control-plane).                                 |
| `SuccessfulRequests`   | `azure_successfulrequests_*`       | Count | Successful subset of `IncomingRequests`. Pair with `ServerErrors` + `UserErrors` via the `OperationResult` dimension. |
| `ServerErrors`†        | `azure_servererrors_*`             | Count | Service-side failures. Sustained > 0 is a page.                                                              |
| `UserErrors`†          | `azure_usererrors_*`               | Count | Client-induced errors (auth, malformed, filter mismatch). High with low `ServerErrors` means producer / consumer code. |
| `ThrottledRequests`†   | `azure_throttledrequests_*`        | Count | Capacity-ceiling hits. `MessagingErrorSubCode` dimension splits 50001 (throughput), 50002 (size quota), 50009 (unit credit). |
| `ServerSendLatency`    | `azure_serversendlatency_average`‡ | ms    | Broker-side send latency. Excludes network and client.                                                       |
| `IncomingMessages`     | `azure_incomingmessages_total`     | Count | Producer ingestion rate per entity (`EntityName` dimension).                                                 |
| `OutgoingMessages`†    | `azure_outgoingmessages_total`     | Count | Consumer drain rate per entity. Pair with `IncomingMessages` to see backlog growth.                          |
| `ActiveMessages`       | `azure_activemessages_average`     | Count | Queue / topic backlog gauge: visible-but-not-locked messages. The primary depth metric.                      |
| `DeadletteredMessages` | `azure_deadletteredmessages_average` | Count | Dead-letter queue depth per entity. Climbing means consumer is failing past `maxDeliveryCount`.            |
| `ScheduledMessages`    | `azure_scheduledmessages_average`  | Count | Messages scheduled for future delivery (set via `ScheduledEnqueueTimeUtc`).                                  |
| `Size`                 | `azure_size_average`               | Bytes | Bytes consumed per queue / topic. Standard quota is 1 GB / entity; alert at 80%.                             |
| `ActiveConnections`    | `azure_activeconnections_*`        | Count | AMQP connection count to the namespace.                                                                      |

`EntityName` and `EntityType` ride alongside every message-flow and
entity-state metric, splitting the namespace-scope series into per-queue,
per-topic, and per-subscription series automatically. Subscriptions appear
under `EntityName` as `<topic-name>/<subscription-name>` once the
subscription has its own activity (a receiver pulling messages, dead-letter
accumulation). A topic that is only fanned out without consumers does not
surface a subscription dimension.

**`†` silent-when-quiet.** Azure Monitor returns data points for these
metrics only when the underlying condition occurs. A healthy namespace
emits zero series for `ServerErrors`, `UserErrors`, and `ThrottledRequests`;
a producer-only namespace with no consumer drain emits zero for
`OutgoingMessages`. Wire alerts on these metrics to fire on series
presence in window (any non-zero point), not on threshold crossings, since
the absence of points is the steady state.

**`‡` latency aggregations.** `ServerSendLatency` is a duration metric, but
the receiver still emits all five aggregations. Only `_average`, `_minimum`,
and `_maximum` are operationally meaningful; `_count` and `_total` are sums
of the latency values themselves and not call counts. Drop the count and
total via aggregation-list narrowing if Scout cardinality matters:
`ServerSendLatency: [Average, Minimum, Maximum]`.

**Gauge `_total` caveat.** The same logic applies to `ActiveConnections`,
`ActiveMessages`, `DeadletteredMessages`, `ScheduledMessages`, and `Size`
when they are configured to emit multiple aggregations. `_total` on a
gauge is a sum of point-in-time samples and has no physical meaning.
Alert on `_average`, `_minimum`, or `_maximum` for these metrics, never
on `_total`.

**First poll after a namespace is added.** Azure Monitor publishes
`Size` and `ActiveConnections` immediately on a freshly-created namespace.
Every other metric requires real traffic to emit its first data point;
expect 1-3 minutes of empty series after the producer or consumer makes
its first call. This applies any time a namespace is added to scope
(provisioning, expanding `subscription_ids`, or `cache_resources` TTL
expiry refreshing the resource list).

Premium-only metrics (`NamespaceCpuUsage`, `NamespaceMemoryUsage`,
`ReplicationLagCount`, `ReplicationLagDuration`) and deprecated metrics
(`CPUXNS`, `WSXNS`) are intentionally excluded. Listing Premium-only metrics
on a Standard namespace returns 401 from Azure Monitor and the receiver
burns rate-limit budget retrying. Add them when targeting Premium; see
[Premium-tier additions](#premium-tier-additions).

## Scale and rate limits

The receiver fans out per-resource queries to Azure Monitor's REST API.
Azure Monitor enforces two ceilings:

| Endpoint                                    | Rate limit              | When it applies                       |
| ------------------------------------------- | ----------------------- | ------------------------------------- |
| Legacy Azure Resource Manager `/metrics` (`use_batch_api: false`) | 12,000 calls / hour / subscription | Default; immediate RBAC propagation.  |
| Data-plane batch (`use_batch_api: true`)    | 360,000 calls / hour / subscription | Higher ceiling but RBAC lags 5-30 min. |

At a 60-second collection interval, a single resource costs roughly 60
calls per hour (one per metric per poll, deduplicated within the receiver).
The break-even point for flipping `use_batch_api: true` is around 50
resources per subscription; below that, the legacy endpoint is simpler.

```yaml
receivers:
  azure_monitor/servicebus:
    # Pick one of two scoping patterns:
    #   1. Explicit list: subscription_ids: [...] (predictable, audit-friendly).
    #   2. Discovery: discover_subscriptions: true (any sub the configured identity has
    #      Monitoring Reader on; no list to maintain as orgs add subs).
    subscription_ids:
      - ${env:HUB_SUB_ID}
      - ${env:WORKLOAD_SUB_1}
      - ${env:WORKLOAD_SUB_2}
      - ${env:WORKLOAD_SUB_3}
    # discover_subscriptions: true   # alternative to subscription_ids
    # No resource_groups: at all; receiver scrapes every resource group in every sub.
    services: [Microsoft.ServiceBus/namespaces]
    auth: { authenticator: azure_auth }
    use_batch_api: true        # 360k/h ceiling per sub
    cache_resources: 86400     # receiver default (24h)
```

The receiver shares one rate-limit budget across all subscriptions in the
list; it does not bypass per-subscription quotas. Splitting heavy
subscriptions across separate collector instances lifts the aggregate
ceiling linearly.

`cache_resources` is the resource-list cache TTL in seconds. The receiver
default is `86400` (24 hours), which is correct for a stable fleet. Lower
to `3600` or `600` only if namespaces are created and destroyed frequently
enough that 24-hour-stale resource lists become a problem; per-minute
resource-list calls otherwise burn Azure Resource Manager rate-limit
budget for no benefit.

## Cardinality control

By default, the receiver emits one OTel series per
`(resource × metric × aggregation × dimension-combination)`. The 13-metric
whitelist splits as 9 counter-style metrics (5 aggregations each:
`_average`, `_count`, `_maximum`, `_minimum`, `_total`) plus 4 gauge-style
metrics (`_average` only). That is `9 × 5 + 4 × 1 = 49` series per
resource per poll before dimension fan-out.

A measured baseline (one namespace, one queue + one topic + one
subscription, dimensions enabled) emits ~29 active series during steady
producer-only traffic. Extrapolating to a 50-namespace fleet averaging
200 entities per namespace:

```text
~29 series × (50 namespaces / 1) × (200 entities / 3) ≈ 100,000 active series
```

`OperationResult` (on `SuccessfulRequests`, `ServerErrors`, `UserErrors`,
`ThrottledRequests`) and `MessagingErrorSubCode` (on `ThrottledRequests`)
multiply on those specific metrics, adding another 1.5-3x growth on the
error and throttle counters during incidents. Three control levers, in
order of preference:

1. **`dimensions.overrides`** drops or whitelists dimensions per metric.
   Drop `EntityName` on namespaces where per-queue granularity is not
   actionable for alerting (transactional outbox, internal scratch
   namespaces); drop `OperationResult` and `MessagingErrorSubCode` on
   metrics other than the error / throttle counters.

   ```yaml
   azure_monitor/servicebus:
     dimensions:
       enabled: true
       overrides:
         "Microsoft.ServiceBus/namespaces":
           IncomingMessages:
             - EntityName       # keep
           OutgoingMessages:
             - EntityName
           ServerErrors:
             - EntityName
             - OperationResult
           ThrottledRequests:
             - EntityName
             - MessagingErrorSubCode
           Size: []             # drop EntityName too; aggregate at namespace level
   ```

2. **Aggregation-list narrowing.** Replace `[]` with explicit lists to drop
   the high-cost aggregations. For latency metrics, `[Average, Minimum,
   Maximum]` saves two series per resource. For counter metrics, the
   `_count` and `_total` aggregations are usually redundant on the same
   metric (Azure publishes both as the same value); pick one.

3. **Per-namespace receiver instances.** Split high-cardinality namespaces
   into separate `azure_monitor/servicebus-bigfleet` and
   `azure_monitor/servicebus-quiet` receivers with different override
   profiles. Both contribute to the same `metrics/servicebus` pipeline.

Watch the `otelcol_processor_batch_metadata_cardinality` self-metric on the
collector's Prometheus self-telemetry endpoint (port 8888 by default) to
see actual cardinality after `overrides` apply.

## Alert tuning

Threshold guidance for the high-signal series. Numbers are starting points
for a Standard tier namespace with steady traffic; derive your own from
observed 99th percentile over a representative week.

`azure_throttledrequests_total` and `azure_servererrors_total` only emit
data points when their condition occurs (silent-when-quiet, see metric
table). Wire alerts on these to fire on series presence in window, not on
numeric thresholds; a healthy namespace emits no points at all.

| Metric (OTel name)                                        | Warning              | Critical             | Why it matters                                                                                                |
| --------------------------------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `azure_activemessages_average` (per `EntityName`)         | > 99th percentile baseline       | sustained > 2x 99th percentile   | Consumer is not keeping up. Pair with `IncomingMessages` to confirm send rate has not spiked.                 |
| `azure_deadletteredmessages_average` (per `EntityName`)   | > 0 / 5m             | sustained > 0 / 30m  | Consumer is failing past `maxDeliveryCount`. These messages are stuck.                                        |
| `azure_throttledrequests_total`                           | `> 0` over 5m        | `> 0` over 15m       | Capacity ceiling hit. Upgrade to Premium or split namespaces. Use `count_over_time(...) > 0` semantics; healthy namespaces emit no points. |
| `azure_servererrors_total`                                | `> 0` over 5m        | `> 0` over 15m       | Service-side failures. Cross-check Azure Service Health for incidents. Same presence-based alerting as `ThrottledRequests`. |
| `azure_size_average` / 1 GB                               | > 80%                | > 95%                | Standard tier per-entity quota is 1 GB. Approaching the cap means consumers must drain or you must split.    |
| `azure_serversendlatency_average`                         | > 100 ms             | > 500 ms             | Broker-side send latency. Excludes client and network.                                                        |
| `azure_activeconnections_total` (per namespace)           | > 5x baseline / 15m  | sustained > 10x      | Misbehaving client opening connections in a loop. Set baseline from a steady-state week.                      |

### RED method on the broker

If you run Service Bus as part of a service backed by service-level
objectives (SLOs), frame Service Bus metrics as RED (rate, errors,
duration) on the broker:

- **Rate.** `azure_incomingrequests_total` per namespace, sliced by entity.
- **Errors.** Split into two service-level indicators (SLIs), since they
  map to different remediation:
  - **Availability error rate** = `(azure_servererrors_total +
    azure_throttledrequests_total) / azure_incomingrequests_total`.
    A spike here is "Service Bus or your capacity envelope is broken"; route
    to platform on-call.
  - **Request-quality error rate** = `azure_usererrors_total / azure_incomingrequests_total`.
    A spike here is "your producer or consumer code is broken"; route to
    the owning service team.
- **Duration.** `azure_serversendlatency_average` (and `_minimum` /
  `_maximum`) per entity. Broker-side only; client + network adds round-trip
  cost. For end-to-end producer-to-consumer latency, instrument the client
  (see [Apps-side instrumentation](#apps-side-instrumentation)).

For saturation (the U in USE), pair `azure_size_average / quota`,
`azure_activeconnections_total / 1000` (per-namespace AMQP connection
limit), and `azure_throttledrequests_total > 0` (capacity-ceiling proxy).
On Premium, add `azure_namespacecpuusage_maximum` and
`azure_namespacememoryusage_maximum` for direct messaging-unit utilisation.

## Premium-tier additions

Premium adds dedicated messaging units, optional geo disaster recovery
(geo-DR), and a handful of extra metrics. When the namespace is Premium,
extend the whitelist:

```yaml
metrics:
  "Microsoft.ServiceBus/namespaces":
    # ...all 13 from the Standard set above...
    NamespaceCpuUsage: []                # Messaging-unit CPU saturation; alert > 70%
    NamespaceMemoryUsage: []             # Messaging-unit memory saturation; alert > 70%
    ReplicationLagCount: []              # geo-DR lag in messages (geo-paired only)
    ReplicationLagDuration: []           # geo-DR lag in seconds (geo-paired only)
    MessagingActiveGeoDR: []             # 1 on the active replica, 0 on the secondary
    PendingCheckpointOperationCount: []  # Internal checkpoint queue depth
```

The `Replica` dimension splits replication-lag and `MessagingActiveGeoDR`
metrics across paired namespaces. On Premium-with-partitions namespaces
(generally available 2024), the same dimension also splits `NamespaceCpuUsage` and
`NamespaceMemoryUsage` per partition, which changes series shape vs.
non-partitioned Premium; verify with one poll against your namespace
before pre-allocating dashboards.

A geo-DR failover changes which replica is active without changing metric
content. Pin dashboards to namespace name rather than resource id if you
want continuity across failover, and alert on `MessagingActiveGeoDR == 1`
per replica to detect unexpected role changes.

## Service principal credential lifecycle

If you run a service principal (collector outside Azure), rotate the
client secret before its expiry, not after.

### Proactive rotation (zero-downtime)

```bash
# 0. Capture the current credential's keyId BEFORE rotating, so step 4
#    knows which one to revoke. (Multiple credentials with similar names
#    accumulate; sort by endDateTime to pick the oldest active one.)
OLD_KEY_ID=$(az ad app credential list --id "$AZURE_CLIENT_ID" \
  --query "sort_by([], &endDateTime)[0].keyId" -o tsv)

# 1. Append a new credential alongside the existing one. --append is what
#    makes this zero-downtime: without it, the previous credential is
#    revoked immediately and the collector errors until the new value
#    reaches its secret store.
NEW_RESULT=$(az ad app credential reset \
  --id "$AZURE_CLIENT_ID" \
  --append \
  --years 1 \
  -o json)

NEW_SECRET=$(echo "$NEW_RESULT" | jq -r .password)
# The new keyId is also returned; useful for audit.
NEW_KEY_ID=$(echo "$NEW_RESULT" | jq -r .keyId)

# 2. Update the collector's secret store with $NEW_SECRET. Examples:
#      kubectl create secret generic otel-azure-sp \
#        --from-literal=AZURE_CLIENT_SECRET="$NEW_SECRET" \
#        --dry-run=client -o yaml | kubectl apply -f -
#      External Secrets Operator + Azure Key Vault auto-rotation
#      Azure Key Vault Container Storage Interface driver with auto-rotation

# 3. Restart or hot-reload the collector. Wait for /metrics on the
#    collector's self-telemetry to confirm it auth'd successfully, then:

# 4. Revoke the old credential.
az ad app credential delete --id "$AZURE_CLIENT_ID" --key-id "$OLD_KEY_ID"
```

Set a calendar alert 30 days before secret expiry. `az ad app credential
list --id $AZURE_CLIENT_ID --query "[].{keyId:keyId,
endDateTime:endDateTime}" -o table` shows every active credential with
its expiry. Tag credentials with
`displayName` at creation if you want to identify them later by purpose
rather than `keyId`.

### Eliminate rotation entirely

If the collector runs in Azure, switch to managed identity or Workload
Identity Federation; rotation goes away. Federated credentials and managed
identities do not have client secrets; the platform mints short-lived
tokens on demand.

## Apps-side instrumentation

This guide is metrics-only. To produce per-message distributed traces
(producer span linked through the broker to consumer span), instrument
your producer / consumer code with one of these OTel Service Bus
integrations:

- **.NET / C#:** `Azure.Messaging.ServiceBus` ships built-in
  ActivitySource emission. Add `OpenTelemetry.Extensions.Hosting` and
  register `AddSource("Azure.Messaging.ServiceBus")` to forward producer,
  consumer, and receive spans.
- **Java:** the OTel Java agent (`opentelemetry-javaagent.jar`)
  auto-instruments the Azure SDK
  (`com.azure:azure-messaging-servicebus`) via the
  `azure-core-tracing-opentelemetry` adapter. No code changes.
- **Python:** the OTel community
  `opentelemetry-instrumentation-azure-servicebus` package wraps
  `azure-servicebus`. Less mature than .NET / Java; verify span shape
  before promoting.
- **Node.js / Go:** no first-party OTel instrumentation as of 2026-05.
  Manual span creation around `sender.sendMessages` and
  `receiver.receiveMessages` is the workaround.

Run the apps-side spans alongside this metrics collector with distinct
`service.name` values to keep the broker view and the request-flow view
separately filterable in Scout.

## Pairing with Diagnostic Settings

Service Bus Diagnostic Settings forward operational logs (operational,
runtime audit, application metric logs) and activity logs to Log Analytics,
Event Hubs, or a Storage account. The collector covers metrics; logs
require a separate forwarder.

Two integration paths:

1. **Diagnostic Settings to Event Hubs to `azure_event_hub` receiver.** The
   collector reads Event Hubs and ships logs alongside metrics. One
   pipeline, OTLP-native. Recommended when migrating off Application
   Insights.
2. **Diagnostic Settings to Log Analytics workspace.** Keep Kusto Query
   Language-based log investigation in Azure; Scout handles metrics +
   alerts. Pragmatic when incident response runbooks already use the Log
   Analytics surface.

```bash
az monitor diagnostic-settings create \
  --resource <namespace-resource-id> \
  --name servicebus-to-eventhubs \
  --logs '[{"category":"OperationalLogs","enabled":true},{"category":"RuntimeAuditLogs","enabled":true}]' \
  --event-hub-rule <eh-namespace-rule-id>
```

Activity logs (control-plane operations on the namespace) are
subscription-scoped, not resource-scoped; configure them once per
subscription via `az monitor diagnostic-settings subscription create`.

## Troubleshooting

### `AuthorizationFailed` from the receiver

Legacy Azure Resource Manager `/metrics` endpoint propagates `Monitoring
Reader` immediately; data-plane batch API can lag 5-30 minutes. If
`use_batch_api: true` is set and you've just granted the role, temporarily
flip to `false` to confirm the role itself is correct.

### `403 Forbidden` from the receiver

If using a service principal: the client_secret has expired. See
[Service principal credential
lifecycle](#service-principal-credential-lifecycle) for the rotation
procedure. If using managed identity: check that the namespace is in a
subscription / resource group where the managed identity has `Monitoring
Reader`.

### `RequestThrottled` warnings from the receiver

You have hit Azure Monitor's per-subscription rate ceiling (12,000 / hour
on legacy, 360,000 / hour on batch). Either:

- Lower polling rate: `collection_interval: 120s`.
- Narrow scope: list specific `resource_groups:` rather than scraping
  every resource group.
- Enable `use_batch_api: true` once data-plane RBAC has settled (see
  Authentication).
- Split heavy subscriptions across multiple collector instances; each
  consumes a separate per-subscription rate budget.

### Cardinality blowup on Scout volume

A single high-fanout namespace can dominate volume. Apply
`dimensions.overrides` (see [Cardinality control](#cardinality-control))
or split the noisy namespace into a separate receiver instance with a
narrower whitelist.

### `OutgoingMessages` flat while `IncomingMessages` rises

Producer is healthy; consumer has stopped or slowed. Cross-check
`ActiveMessages_average` (rising = backlog accumulating) and
`DeadletteredMessages_average` (rising = consumer failing past
`maxDeliveryCount`). Page on the consumer service, not Service Bus
itself.

### Scout OAuth2 returns 401

Verify `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL`
match the values in your Scout console. The `endpoint_params.audience`
must be `b14collector`.

## Frequently Asked Questions

### How do I add Azure Service Bus metrics to my existing OpenTelemetry Collector?

Add the `azure_auth` extension and an `azure_monitor` receiver scoped to
`Microsoft.ServiceBus/namespaces`, then route the receiver into a metrics
pipeline that exports to Scout via the `oauth2client`-authenticated
OTLP/HTTP exporter. The receiver polls Azure Monitor's REST API every
60 seconds and emits one OTel metric per Azure aggregation. No data-plane
connection to Service Bus; the broker is never on the collector's path.

### Should I use a service principal or managed identity for the collector?

Managed identity if the collector runs in Azure, service principal if it
does not. AKS pods use Workload Identity Federation with a federated
credential bound to a Kubernetes ServiceAccount; Container Apps and
Virtual Machine Scale Sets use system-assigned or user-assigned managed
identity; out-of-Azure collectors fall back to service principal. The
`azure_auth` extension's mode block is the only thing that changes; the
rest of the receiver config is identical.

### How do I scope the receiver to multiple subscriptions and resource groups?

`subscription_ids` and `resource_groups` are both lists. The receiver fans
out queries across all combinations, sharing one Azure Resource Manager
rate-limit budget per subscription. With `Monitoring Reader` granted on
each scope, one
collector can poll dozens of namespaces across many subscriptions; flip
`use_batch_api: true` once you exceed roughly fifty resources to lift the
per-subscription ceiling from 12,000 to 360,000 calls per hour.

### How do I keep metric cardinality under control with thousands of entities?

By default the receiver emits a series per entity per metric per
aggregation; a 50-namespace fleet with 200 entities each and 13
whitelisted metrics produces roughly 100,000 active series. Use
`dimensions.overrides` on the receiver to drop `EntityName` or
`OperationResult` on namespaces where per-entity granularity is not
actionable. Drop `_count` and `_total` aggregations on latency metrics;
only `_average`, `_minimum`, and `_maximum` are operationally meaningful
for durations.

### How does Scout compare to Application Insights for Service Bus?

Both surfaces draw from the same Azure Monitor REST API, so metric
coverage is identical. The differences are commercial and operational:
Scout is vendor-neutral OTLP, queryable via SQL, with
ingest-volume pricing rather than per-GB ingestion fees; Application
Insights uses Kusto Query Language only, is Azure-tenant-bound, and bills
for log ingestion alongside metric storage. The collector also unifies
multi-cloud surfaces under one pipeline: Service Bus, Cosmos DB, Azure
Kubernetes Service, and AWS or GCP equivalents flow through the same
exporter.

### What is the service principal secret rotation procedure?

Generate a new credential with `az ad app credential reset --append` (the
`--append` flag preserves the existing credential so the collector can
roll over without downtime), update the `AZURE_CLIENT_SECRET` secret store
the collector reads from, restart or hot-reload the collector, then
revoke the old credential. The federated-credential alternative (Workload
Identity Federation for AKS, system-assigned managed identity for Container Apps)
eliminates the rotation entirely; if the collector runs in Azure, prefer that path.

### Do I need this guide AND Diagnostic Settings to Log Analytics?

Yes if you want logs alongside metrics. This guide ships metrics. For
activity logs, operational logs, and runtime audit logs from the
namespace, configure Diagnostic Settings on the namespace to forward to
Log Analytics or to Event Hubs and pipe Event Hubs into the collector via
the `azure_event_hub` receiver. The two paths are complementary: metrics
for SLI and SLO dashboards and alerts, logs for incident investigation.

## Reference

- **Receiver source.**
  [opentelemetry-collector-contrib / receiver / azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver).
- **Auth extension source.**
  [opentelemetry-collector-contrib / extension / azureauthextension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/azureauthextension).
- **Azure Monitor metric reference.**
  [Microsoft.ServiceBus/namespaces metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-servicebus-namespaces-metrics).

## Related Guides

- [Azure Cosmos DB](./cosmos-db.md) - sister guide; same `azure_monitor`
  pattern, NoSQL surface.
- [Azure SQL Database](./sql-database.md) - sister guide; relational PaaS
  surface. Pairs with the self-hosted [SQL Server
  guide](../../component/sqlserver.md).
- [Azure Kubernetes Service](./aks.md) - sister guide; uses the same
  `azure_monitor` receiver pattern but scopes to
  `Microsoft.ContainerService/managedClusters` and adds an in-cluster
  collector pair.
- [Amazon MQ](../aws/amazonMQ.md) - managed messaging on AWS. Different
  collection pattern (CloudWatch Metrics Stream) and protocol, but the
  same observability question: depth, drain rate, dead-letter, throttling.
