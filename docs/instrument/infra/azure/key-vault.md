---
date: 2026-05-09
id: collecting-azure-key-vault-telemetry
title: Azure Key Vault Monitoring with OpenTelemetry - API Latency, Throttling Saturation, and Per-Secret Audit Forensics
sidebar_label: Azure Key Vault
sidebar_position: 14
description:
  Wire Azure Key Vault metrics and audit logs into your existing
  OpenTelemetry Collector and ship to base14 Scout. Covers Standard
  versus Premium tier, the ServiceApi triplet, SaturationShoebox
  throttling proximity, and the AuditEvent log path for per-secret
  access forensics that metrics cannot provide.
keywords:
  - azure key vault monitoring
  - azure key vault opentelemetry
  - azure monitor receiver key vault
  - serviceapihit metric
  - serviceapilatency metric
  - serviceapiresult metric
  - saturationshoebox throttling
  - per-secret audit forensics
  - azure key vault rbac monitoring
  - audit event diagnostic settings
  - azure event hub receiver
  - application insights alternative
  - base14 scout azure key vault
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Key Vault metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.KeyVault/vaults, route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing your vaults. The receiver polls Azure Monitor's REST API every 60 seconds. The five-metric whitelist (ServiceApiHit, ServiceApiLatency, ServiceApiResult, Availability, SaturationShoebox) covers Standard and Premium tiers identically. The collector does not connect to the vault's data plane and does not need any data-plane role assignment - it queries Azure Monitor for whatever your vaults auto-publish."}},{"@type":"Question","name":"Why does my ServiceApiResult metric show a high count of 401 status codes on the Authentication operation?","acceptedAnswer":{"@type":"Answer","text":"Every Key Vault data-plane call begins with an unauthenticated probe that returns 401, then retries with a token. The receiver surfaces both the 401 from the probe and the 200 from the retry as separate ServiceApiResult datapoints, so a healthy vault under steady traffic shows a roughly 1:1 ratio of Authentication 401 records to data-plane 200 records. This is normal Azure SDK behaviour, not a security signal. Filter Authentication 401 records out of security alerts; alert on 401 against secret operations (SecretGet 401, SecretSet 401) instead."}},{"@type":"Question","name":"What is the difference between metrics and AuditEvent logs for Key Vault?","acceptedAnswer":{"@type":"Answer","text":"Metrics aggregate operations by activity type, status code, and transaction type at one-minute granularity. AuditEvent logs record one entry per data-plane operation with the requester's source IP, user agent, Microsoft Entra ID identity (UPN and app ID), the specific operation name (SecretGet, SecretSet, etc.), and the HTTP status. Metrics tell you how many operations are happening and at what latency; AuditEvent logs tell you who did what to which secret from where. Metrics are sufficient for SLO and capacity work; logs are required for compliance, security forensics, and per-secret access patterns. Both ship in this guide, the metrics path via the azure_monitor receiver and the logs path via Diagnostic Settings to Event Hubs to the azure_event_hub receiver."}},{"@type":"Question","name":"How do I monitor proximity to Key Vault's data-plane rate limit?","acceptedAnswer":{"@type":"Answer","text":"Azure caps Key Vault data-plane operations at 2000 requests per 10 seconds per vault per region. The SaturationShoebox metric publishes the percentage of that cap consumed, aggregated over a one-minute window. Alert at 70 percent for warning and 90 percent for critical. Saturation manifests as 429 Too Many Requests responses on the application side; pre-saturation alerting on SaturationShoebox gives time to scale by sharding secrets across vaults, caching values application-side, or moving high-throughput paths off Key Vault entirely. The cap is per-vault per-region, so a regional fleet of vaults sharing a workload should be monitored individually."}},{"@type":"Question","name":"Should I enable AzurePolicyEvaluationDetails or AllMetrics in my Diagnostic Setting?","acceptedAnswer":{"@type":"Answer","text":"No, neither category is needed alongside this guide. AzurePolicyEvaluationDetails records Azure Policy compliance evaluations against the vault, which is policy-engine telemetry rather than vault telemetry, and ships through a separate compliance pipeline if at all. AllMetrics duplicates the metric data this guide already collects via the azure_monitor receiver, so enabling it produces double-counted data in Scout. Stay with AuditEvent only in the Diagnostic Setting; the receiver-fed metrics path covers the metric surface separately."}}]}
---

## Overview

This guide is the **execution playbook** for Azure Key Vault. For the
cross-surface architecture (auth, push vs pull, latency, the trace
gap), read [Azure Monitoring with OpenTelemetry - Architecture for
base14 Scout](./overview.md) first.

This guide is for engineers running Azure Key Vault (Standard or
Premium) in production who want to add vault telemetry to an existing
OpenTelemetry Collector and ship it to base14 Scout. The collector
polls Azure Monitor's REST API for `Microsoft.KeyVault/vaults` metrics
every 60 seconds, and a sibling pipeline ingests AuditEvent records
from the vault's Diagnostic Settings via Event Hubs as OTel logs.

The receiver does not connect to the vault's data plane. It queries
Azure Monitor for any vault your subscription auto-publishes to, so
the same configuration covers Standard and Premium tiers across any
number of vaults in the configured scope.

> **Managed HSM?** If you operate `Microsoft.KeyVault/managedHSMs`
> rather than `Microsoft.KeyVault/vaults`, the namespace is different,
> the metric names differ, and the RBAC model is FIPS 140-2 Level 3
> rather than Level 2. The receiver pattern is the same shape, but
> the whitelist below does not apply directly. Managed HSM coverage
> is a separate roadmap entry.

This guide ships both paths: metrics via the `azure_monitor` receiver
and AuditEvent logs via the `azure_event_hub` receiver. See
[Receiver configuration](#receiver-configuration) for metrics and
[Logs](#logs) for the audit path.

## Key Vault at a glance

Azure Key Vault is a fully managed secret, key, and certificate store.
Applications fetch secrets over HTTPS to the vault's
`{vault-name}.vault.azure.net` endpoint, authenticated by Microsoft
Entra ID.

| Layer | What it produces |
| --- | --- |
| Authentication | Microsoft Entra ID token negotiation per data-plane call (the "Authentication 401 then retry" pattern that dominates `ServiceApiResult` volume). |
| Data plane | Per-operation counters (SecretGet, SecretSet, KeyGet, etc.) split by activity name and status code. Latency per operation. |
| Throttling subsystem | `SaturationShoebox` reports proximity to the per-vault, per-region 2000-ops-per-10-second rate limit. |
| Availability subsystem | `Availability` percentage based on Microsoft's external probes. |

The receiver does not see per-secret breakdowns - Azure Monitor
publishes activity-level aggregates only. **Per-secret access
attribution requires the AuditEvent log path, not metrics.** This
is the design rationale for shipping §Logs alongside metrics for KV.

## Tier choice

Azure Key Vault has two pricing tiers as of 2026, plus the separate
Managed HSM offering.

| Tier | Pricing model (region-dependent, current as of May 2026) | Key/secret protection | Metric coverage |
| --- | --- | --- | --- |
| **Standard** | Vault: $0/month; software-protected secret + key operations $0.03 per 10k. Certificate operations themselves are free; certificate renewals are billed separately (typically a few dollars per certificate per year, depending on issuer). | Software-protected, FIPS 140-2 Level 1 | Full metric surface (the 5-metric whitelist below). |
| **Premium** | Same as Standard for vault + ops; HSM-protected keys add ~$1 per key per month for the first 250 keys, with per-key cost dropping at higher counts. | HSM-protected, FIPS 140-2 Level 2 | Identical metric surface to Standard. No additional metrics. |
| **Managed HSM** | Per-HSM hourly billing (typically several dollars per hour), starting in the low thousands of dollars per month for the smallest SKU. | Fully managed dedicated HSM, FIPS 140-2 Level 3 | Different namespace (`Microsoft.KeyVault/managedHSMs`), different metric names. **Out of scope** - separate guide. |

Pick Standard for nearly all use cases. Premium adds HSM-backed key
protection with no metric surface change - the receiver configuration
in this guide covers both. Managed HSM serves regulated workloads with
strict isolation requirements at substantially higher cost; the
receiver pattern is similar but the whitelist must be re-derived.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, and pipeline are all keyed `/keyvault` so they coexist
with other Azure receivers under one collector and one Scout exporter.
The `Microsoft.KeyVault/vaults` namespace is **not currently known to
exhibit receiver bug #45942** (the case-mismatched-dimensions bug
seen on `Microsoft.ApiManagement/service`,
`Microsoft.Network/azureFirewalls`, and a subset of
`Microsoft.Storage` metrics on `azuremonitorreceiver` v0.151.0), so no
`transform` processor is required for this surface. Re-check on
receiver upgrades.

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/keyvault:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:KEYVAULT_RESOURCE_GROUP}
    services:
      - Microsoft.KeyVault/vaults
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.KeyVault/vaults":
        ServiceApiHit:           [Total]
        ServiceApiLatency:       [Average, Maximum]
        ServiceApiResult:        [Total]
        Availability:            [Average]
        SaturationShoebox:       [Average]

processors:
  resource/keyvault:
    attributes:
      - {key: cloud.provider,    value: azure,                       action: insert}
      - {key: cloud.platform,    value: azure_key_vault,             action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: cloud.region,      value: "${env:KEYVAULT_REGION}",     action: insert}
      - {key: cloud.resource_id, value: "${env:KEYVAULT_RESOURCE_ID}", action: insert}
      - {key: service.name,      value: "${env:KEYVAULT_SERVICE_NAME}", action: insert}

service:
  pipelines:
    metrics/keyvault:
      receivers: [azure_monitor/keyvault]
      processors: [resource/keyvault, batch]
      exporters: [otlp_http/b14]
```

The receiver emits 6 OTel series from the 5 whitelist entries
(`ServiceApiLatency` is dual-aggregation Average + Maximum, producing
two series). Activity-name and status-code dimensions further split
the series at runtime; expect ~25-35 datapoints per poll on an active
vault.

## Authentication and RBAC

The collector authenticates to Azure Monitor as a service principal
holding **`Monitoring Reader`** at the **resource group** containing
the vault. Resource-group scope is the minimum necessary; subscription
scope is acceptable but broader than needed.

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Monitoring Reader" \
  --scope "$(az group show --name <rg> --query id -o tsv)"
```

`Monitoring Reader` is sufficient for both the metrics path
(`azuremonitorreceiver`) and the logs path (the receiver consumes
from Event Hubs via a SAS token, no Key Vault data-plane role
needed). The collector **never** touches the vault's data plane -
it cannot read secrets, keys, or certificates and does not need any
of the `Key Vault Secrets User`, `Key Vault Crypto User`, or
`Key Vault Certificates User` roles.

Two propagation delays apply after first assignment:

1. **Control-plane RBAC propagation** - typically 60-300 seconds
   before the receiver's `metricDefinitions` and `metrics` REST
   calls succeed. The receiver retries on its 60-second poll cycle.
2. **First-poll metric-definitions race** - Azure Monitor's
   metricDefinitions catalog can take 60-180 seconds to populate
   after `provisioningState: Succeeded`. The receiver caches an
   empty list if it polls during that window. Mitigation: restart
   the collector 3-5 minutes after the vault reaches `Succeeded`,
   or accept the delay and the next poll cycle picks up the
   populated catalog.

## What you'll monitor

The 5-metric whitelist intersects the universal Key Vault metric
surface. `ServiceApiLatency` is dual-aggregation (`Average` +
`Maximum`) and produces two OTel series; the other four are
single-aggregation, for 6 emitted series in total.

| OTel series | Type | Unit | Use case |
| --- | --- | --- | --- |
| `azure_serviceapihit_total` | Counter (Gauge in OTel form) | Count | Throughput. Splits by `metadata_activitytype` + `metadata_activityname`. **Does NOT split by status code** - the throughput numerator is total ops, success or failure. |
| `azure_serviceapilatency_average` | Gauge | Milliseconds | Mean per-operation latency. Splits by activity + `metadata_statuscode` + `metadata_statuscodeclass`. |
| `azure_serviceapilatency_maximum` | Gauge | Milliseconds | Peak per-operation latency within the 1-minute aggregation window. Same dimensions as `_average`. |
| `azure_serviceapiresult_total` | Counter | Count | Per-status-code throughput. Splits by activity + `metadata_statuscode` + `metadata_statuscodeclass`. **The SLI numerator** - split by `metadata_statuscodeclass = '2xx'` for success rate. |
| `azure_availability_average` | Gauge | Percent | Microsoft's external availability probe result, 0-100. Single series per vault. |
| `azure_saturationshoebox_average` | Gauge | Percent | Throttling capacity consumed, 0-100. KV's data-plane rate limit is 2000 ops / 10s / vault per region; this metric tracks proximity. **The capacity-planning signal.** |

### Operations notes

- **Authentication 401 dominates `ServiceApiResult` volume on any
  active vault.** Every data-plane call begins with an
  unauthenticated probe (the Azure SDK pattern); the probe returns
  401, then the SDK retries with a token. The receiver surfaces both
  the 401 from the probe and the 200 from the retry as separate
  datapoints. **Filter `metadata_activityname = 'authentication'`
  out of security alerts** - the 401s from this activity are
  expected. Alert on 401s on `secret*` / `key*` / `vaultget`
  activities, where they indicate a real authorization problem.
- **Activity names emit lowercase in metric dimensions**
  (`secretset`, `secretget`, `vaultget`) but appear PascalCase in
  the Azure portal and AuditEvent log records. Cross-reference using
  case-insensitive matching when correlating metrics to logs.
- **`ServiceApiHit` does NOT carry status code dimensions** - it's
  the total throughput counter. To compute success rate, use
  `azure_serviceapiresult_total{metadata_statuscodeclass='2xx'}` /
  `sum(azure_serviceapiresult_total)` rather than dividing
  `serviceapihit` by anything.
- `Availability` is computed by Microsoft's external probes and
  smooths over short outages; spikes from full outages typically
  appear within 5 minutes. Treat sustained `< 100` as an active
  incident; treat single-point dips as probe noise.

## Cardinality control

Key Vault metrics are bounded by the activity-name and status-code
dimension space, both of which have small fixed cardinalities:

| Attribute | Source | Cardinality |
| --- | --- | --- |
| `azuremonitor.resource_id` | Receiver | One per vault (low). |
| `name` | Receiver | One per vault. |
| `resource_group` | Receiver | One per RG. |
| `type` | Receiver | Constant: `Microsoft.KeyVault/vaults`. |
| `location` | Receiver | One per region. |
| `metadata_activitytype` | Azure Monitor | ~5-10 distinct values per vault: `secret`, `key`, `certificate`, `vault`, `authentication`, `storageaccount` (legacy), `task`. |
| `metadata_activityname` | Azure Monitor | ~30-50 across the activity-type space (e.g. `secretset`, `secretget`, `secretlist`, `secretdelete`, `secretpurge`, plus key/cert equivalents). |
| `metadata_statuscode` | Azure Monitor (Latency / Result / Availability only) | ~5-10 distinct values: `200`, `204`, `400`, `401`, `403`, `404`, `409`, `429`, `500`. |
| `metadata_statuscodeclass` | Azure Monitor (same as statuscode) | Constant set: `2xx`, `4xx`, `5xx`. |
| `metadata_transactiontype` | Azure Monitor (`SaturationShoebox` only) | Single dimension partitioning the rate limit accounting. |

**Per-secret name is NOT emitted by Azure Monitor for Key Vault.**
This is by design - secret names can themselves be sensitive
(naming conventions can leak schema, credentials, or business
relationships). Per-secret attribution requires the AuditEvent log
path; metrics aggregate to the activity level only.

Cardinality stays bounded at 25-35 emitted datapoints per scrape per
vault under typical activity. A fleet of 50 vaults under one
collector lands at ~1500 datapoints per minute - well within Scout's
default capacity for any reasonable plan.

If you operate dozens of vaults in one collector, scope each
`azure_monitor` receiver instance to a single resource group rather
than letting one receiver span the whole subscription. Query latency
stays predictable, and any per-RG outage is contained to that
receiver instance.

## Alert tuning

Operational alerting on Key Vault follows the **RED method on the
vault**: Rate (operations per second), Errors (non-2xx status codes),
Duration (`ServiceApiLatency`).

### RED method on the vault

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **Throttling proximity** | `azure_saturationshoebox_average` | > 70% / 5m | > 90% / 5m | Cap is 2000 ops / 10s / vault / region. Pre-saturation alerting at 70% gives time to scale by sharding secrets or caching values application-side. |
| **Auth failures (data plane)** | `$increase(azure_serviceapiresult_total{metadata_statuscode='401', metadata_activityname!='authentication'})` | > 0 / 5m | > 0 / 1m | Excludes the expected `authentication`/401 noise. Real 401s on `secret*` / `key*` operations indicate stale credentials or revoked role assignments. |
| **Forbidden (RBAC denial)** | `$increase(azure_serviceapiresult_total{metadata_statuscode='403'})` | > 0 / 5m | > 5 / 1m | A caller has a token but lacks the required data-plane role. Indicates either misconfigured role assignment or attempted privilege escalation. |
| **Throttled (429)** | `$increase(azure_serviceapiresult_total{metadata_statuscode='429'})` | > 0 / 5m | > 0 / 1m | Rate limit hit. Correlates with `SaturationShoebox` rising; if SaturationShoebox is healthy but 429s appear, suspect a single client burst rather than steady traffic. |
| **Latency p95 (proxy via Maximum)** | `azure_serviceapilatency_maximum` | > 100 / 5m | > 500 / 5m | Milliseconds. Maximum approximates p95-p99 for the 1-min aggregation window. KV is normally <10ms; spikes above 100ms indicate Azure-side issues. |
| **Availability dip** | `azure_availability_average < 100` | < 99% / 5m | < 95% / 5m | Microsoft's external probe. Sustained sub-100% indicates an active vault incident. |
| **Server errors** | `$increase(azure_serviceapiresult_total{metadata_statuscodeclass='5xx'})` | > 0 / 5m | > 5 / 1m | Azure-side failures. Page platform on-call. |

### Authentication 401 exclusion

The single most important alert filter for Key Vault metrics is
excluding `metadata_activityname = 'authentication'` from any 401
alerting. Authentication 401s are a normal SDK pattern (probe →
token → retry); on a vault serving 50 ops/min you may see 50
Authentication 401 records per minute. Without filtering, every 401
alert fires constantly. With filtering, 401s on data-plane
operations become a meaningful signal.

## Premium-tier additions

Premium tier is software-equivalent to Standard at the metrics
layer. The receiver configuration above covers both tiers without
modification. Premium adds HSM-backed key protection (FIPS 140-2
Level 2) without changing the metric surface.

For deeper HSM telemetry, customers operating
`Microsoft.KeyVault/managedHSMs` need a separate receiver block
against that namespace; the metric names differ and are not covered
by this guide.

## Apps-side instrumentation

The metrics in this guide describe the vault itself. End-to-end
visibility - application latency including secret-fetch time,
secrets accessed, miss-rate per code path - requires client-side OTel
instrumentation in the application. The OTel auto-instrumentation
agents for Java, .NET, Python, Node.js, and Go all wrap the standard
Azure SDKs (`Azure.Security.KeyVault.Secrets`,
`azure-identity`, etc.). Calls emit HTTP-style client spans
annotated with `azure.namespace: Microsoft.KeyVault`, the vault
hostname under `server.address`, and the operation name (`SecretGet`,
`KeyEncrypt`, etc.) under `azure.operation` per the OTel Azure SDK
semantic conventions - not the `db.*` family, since Key Vault is
not a database.

The vault-side metrics in this guide and the apps-side traces are
complementary: vault metrics tell you whether the vault is healthy;
apps-side spans tell you which code paths are reading secrets and
how often. Wire both for full coverage.

## Logs

Metrics aggregate operations by activity type, status code, and
transaction type - they cannot answer who, from where, on which
specific secret, or with what client-side identity. Three operational
gaps that AuditEvent logs fill where metrics cannot:

- **Per-secret access attribution** records each `SecretGet`,
  `SecretSet`, `SecretDelete`, `SecretPurge` operation with the
  exact secret name. The metrics path collapses these to
  `metadata_activityname = 'secretget'` aggregates with no per-name
  dimension. Per-secret attribution is the canonical requirement for
  PCI / HIPAA / SOC 2 audits and incident-response forensics.
- **Per-IP and per-identity audit** records the requester's source IP,
  user agent, and Microsoft Entra ID identity (UPN, app ID, OID) for every
  data-plane call. The metrics path has no source-IP dimension at
  all. Per-IP audit is the canonical requirement for security
  investigations after a credential compromise - without it, you
  cannot answer "did this stolen token actually touch my vault?".
- **Per-key delete forensics** preserves the operation record beyond
  the soft-delete window. The metrics path shows `secretdelete`
  Count incremented; the log shows which principal deleted which
  secret at which timestamp from which IP, available even after the
  soft-delete catalog expires.

Key Vault publishes one Diagnostic Settings category that fills these
gaps:

| Category | What it contains | Tier emission |
| --- | --- | --- |
| `AuditEvent` | One record per data-plane operation with `operationName`, `properties.requesterIpAddress`, `properties.userAgentHeader`, `identity.claim.appid`, `identity.claim.upn`, `properties.httpStatusCode`, and the affected resource (vault, secret name, key name). | All tiers (Standard and Premium). Emits regardless of whether RBAC or Access Policy auth model is used. |

The recommended pattern is **Diagnostic Settings to Event Hubs to
`azure_event_hub`** in the same collector. The receiver ingests
events as OTel logs and routes them to Scout via the same
`oauth2client` / `otlp_http/b14` pipeline used for metrics.

```yaml
receivers:
  azure_event_hub/keyvaultlogs:
    connection: ${env:KEYVAULTLOGS_CONNECTION_STRING}
    partition: ""
    offset: ""
    format: azure
    apply_semantic_conventions: true

processors:
  resource/keyvaultlogs:
    attributes:
      - {key: cloud.provider,    value: azure,                                action: insert}
      - {key: cloud.platform,    value: azure_key_vault,                      action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}",       action: insert}
      - {key: cloud.region,      value: "${env:KEYVAULTLOGS_SOURCE_REGION}",  action: insert}
      - {key: cloud.resource_id, value: "${env:KEYVAULTLOGS_SOURCE_RESOURCE_ID}", action: insert}
      - {key: service.name,      value: "${env:KEYVAULTLOGS_SERVICE_NAME}",   action: insert}

service:
  pipelines:
    logs/keyvaultlogs:
      receivers: [azure_event_hub/keyvaultlogs]
      processors: [resource/keyvaultlogs, batch]
      exporters: [otlp_http/b14]
```

The `connection` string must include the `EntityPath=<hub-name>`
suffix so the receiver knows which hub to consume. The receiver
defaults to consuming all partitions from the oldest available
offset (`partition: ""`, `offset: ""`); on collector restart it
re-reads from the saved offset, providing at-least-once delivery.

### Wiring the Diagnostic Setting

Create the Diagnostic Setting against the vault, forwarding only
the `AuditEvent` category to your Event Hubs hub:

```bash
az monitor diagnostic-settings create \
  --resource "$(az keyvault show --name <vault-name> --query id -o tsv)" \
  --name keyvault-audit \
  --event-hub "$EVENT_HUB_NAME" \
  --event-hub-rule "$DIAG_SEND_RULE_ARM_ID" \
  --logs '[{"category":"AuditEvent","enabled":true}]'
```

The flag is `--event-hub` (NOT `--event-hub-name`) on `az` CLI
2.85.0 and later. The `--event-hub-rule` value is the full ARM
resource ID of a namespace-level SAS authorization rule with `Send`
rights.

### Diagnostic Settings ship cadence

Azure batches AuditEvent records and ships them to Event Hubs on a
non-real-time cadence. Expect:

- **First batch from a freshly-wired vault: 5-20 minutes**. Azure
  documents 5-15 minutes; the upper end can stretch to 20 minutes
  in practice on freshly-wired vaults. Plan for 20.
- **Steady-state batches: 5-15 minutes**. After the first batch,
  subsequent ones arrive in the documented range.
- **End-to-end latency from vault op to Scout: 5-15 minutes
  steady-state**. Audit visibility is NOT real-time. For real-time
  audit (e.g. live security monitoring), use Microsoft Defender for
  Cloud / Azure Sentinel, which read AuditEvent directly with lower
  latency. The OTel path is appropriate for audit retention,
  forensics, and compliance reporting where per-event minutes-of-lag
  is acceptable.

### Why not `AzurePolicyEvaluationDetails` or `AllMetrics`?

- **`AzurePolicyEvaluationDetails`** records Azure Policy compliance
  evaluations against the vault. This is policy-engine telemetry
  rather than vault telemetry; it answers "is this vault compliant
  with policy X?" rather than "what is happening to this vault?".
  Customers using Azure Policy at scale should ship policy-engine
  events via a separate compliance pipeline.
- **`AllMetrics`** duplicates the metric data the
  `azure_monitor` receiver already collects. Enabling it produces
  double-counted data in Scout. Stay with `AuditEvent` only.

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
no metrics. Cause: Azure Monitor's metricDefinitions catalog has
not yet populated for the freshly-deployed vault. Fix: restart the
collector after the vault has been up for at least 3 minutes, OR
wait 5-10 minutes and the next 60-second poll picks up the
now-populated catalog.

### Authentication 401 dominates `ServiceApiResult`

Symptom: the largest series in `azure_serviceapiresult_total` is
`metadata_activityname = 'authentication', metadata_statuscode = '401'`.
Cause: Azure SDK's standard probe-then-token pattern. Each
data-plane call begins with an unauthenticated probe that returns
401, followed by a retry with a token. Fix: this is normal and
expected. **Filter `metadata_activityname = 'authentication'` out
of 401 alerts** so real 401s on `secret*` / `key*` operations
remain visible.

### 429 Too Many Requests under steady traffic

Symptom: `azure_serviceapiresult_total{metadata_statuscode='429'}`
fires repeatedly while `SaturationShoebox` reads below 70%. Cause:
the per-vault rate limit is per-region, and a single bursty client
can saturate the limit briefly even when the 1-minute aggregate
looks healthy. Fix: identify the bursty client via the AuditEvent
log path (`properties.requesterIpAddress`), then either pool calls
client-side or shard secrets across multiple vaults to spread the
rate-limit load.

### Empty Event Hubs for several minutes after provisioning the logs path

Symptom: `azure_event_hub/keyvaultlogs` receiver reports zero
events for the first 5-20 minutes after the Diagnostic Setting is
created. Cause: this is the standard Azure Diagnostic Settings ship
cadence - the first batch can take up to 20 minutes to ship from a
freshly-wired vault. Fix: wait. Subsequent batches arrive in 5-15
minutes per Azure's documented cadence. The receiver is not
broken; the EH is genuinely empty.

### `consumer_group` config key not accepted

Symptom: collector boot fails with
`unknown field 'consumer_group'`. Cause: the
`azure_event_hub` receiver removed the top-level `consumer_group`
field before contrib v0.151.0; user-defined consumer groups now
require a separate receiver instance per group. Fix: omit the
field; the receiver consumes from the implicit `$Default`
consumer group, which works on Event Hubs Basic and above.

### Activity names case-mismatch between metrics and logs

Symptom: a metric query for `metadata_activityname = 'SecretGet'`
returns no data despite log records showing `operationName:
SecretGet`. Cause: metric dimensions emit lowercase
(`metadata_activityname = 'secretget'`); log records emit
PascalCase (`operationName: SecretGet`). Fix: use lowercase in
metric queries and PascalCase in log queries, or apply
case-insensitive matching at the query layer.

### Scout OAuth2 returns 401

Symptom: `oauth2client` extension logs 401 from the token endpoint.
Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` /
`SCOUT_TOKEN_URL`. Fix: re-source
`~/.config/base14/scout-otel-config.env` (or the equivalent secret
store) and restart the collector.

## Frequently Asked Questions

### When should I use Key Vault versus a self-hosted secret store?

Pick Azure Key Vault when you want a managed secret store with
99.99% SLA, automated patching, Entra-ID-integrated RBAC, soft-delete
recovery, and Premium-tier HSM-backed protection without operating
the secret store yourself. Pick HashiCorp Vault on Azure VMs / AKS
when you need cross-cloud portability, more flexible authorization
policies (Vault's policy DSL is more expressive than Azure RBAC),
or HSM brands not available on Azure Premium. The metrics paths
differ entirely: this guide covers Key Vault PaaS via
`azure_monitor`; HashiCorp Vault is monitored via the OTel
`prometheus` receiver against Vault's `/v1/sys/metrics` endpoint.

### How does AuditEvent logging compare to Microsoft Defender / Sentinel?

Microsoft Defender for Cloud and Azure Sentinel both read AuditEvent
directly from Azure's internal log store, with lower latency than
the Diagnostic Settings → Event Hubs → receiver path. Defender /
Sentinel are appropriate for real-time security monitoring and
SIEM integration. The OTel path in this guide is appropriate for
audit retention, compliance reporting, and forensic analysis where
per-event minutes-of-lag is acceptable. Both can coexist; many
production deployments ship to both for separate use cases.

### Can I monitor Managed HSM with this configuration?

No. Managed HSM ships under the
`Microsoft.KeyVault/managedHSMs` namespace with different metric
names. The `azure_monitor` receiver pattern is similar but the
whitelist must be re-derived from Azure Monitor's catalog for the
HSM resource type. Managed HSM coverage is a separate roadmap entry.

### How does Key Vault compare to AWS Secrets Manager for monitoring?

Both expose secret-store APIs and ship metrics through the cloud's
native monitoring service (Azure Monitor for Key Vault, CloudWatch
for Secrets Manager). The OTel paths differ: this guide uses
`azure_monitor` (pull-based, polls every 60 s); AWS Secrets Manager
typically uses CloudWatch metrics streams (push-based via Kinesis
Firehose, near-real-time). Metric coverage at the SLI layer is
roughly equivalent (request count, latency, error rate); per-secret
audit on AWS uses CloudTrail rather than CloudWatch, which is the
direct analogue to Azure's AuditEvent path through Diagnostic
Settings.

### Should I deploy this collector inside the VNet that hosts my private-endpoint Key Vault?

If your vault uses Private Endpoints and disables public network
access, the collector needs network reachability to Azure Monitor's
public REST endpoints (which are NOT affected by Private Endpoints
on the vault - Azure Monitor is a separate control-plane service).
The collector must reach `management.azure.com` and the Event Hubs
namespace endpoint on `*.servicebus.windows.net`. If the collector
runs outside the vault's network entirely (e.g. on a different
cloud), only outbound HTTPS to those Azure endpoints is required.
Network architecture is independent of this telemetry pipeline.

## Reference

- [Microsoft.KeyVault/vaults supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-keyvault-vaults-metrics)
- [Key Vault Diagnostic Logs
  reference](https://learn.microsoft.com/azure/key-vault/general/logging)
- [Key Vault data-plane RBAC roles](https://learn.microsoft.com/azure/key-vault/general/rbac-guide)
- [opentelemetry-collector-contrib
  azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- [opentelemetry-collector-contrib
  azureeventhubreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azureeventhubreceiver)

## Related Guides

- [Azure Monitoring with OpenTelemetry - Architecture](./overview.md) -
  start here for the cross-surface story.
- [Azure Storage](./storage.md) - managed
  object/blob/queue/table/file storage.
- [Azure Cache for Redis](./cache-for-redis.md) - managed
  Redis-compatible cache.
- [Azure Service Bus](./service-bus.md) - managed message broker for
  queues and topics.
- [Azure API Management](./api-management.md) - API gateway and
  management plane.
