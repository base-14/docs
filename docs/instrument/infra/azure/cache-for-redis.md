---
date: 2026-05-08
id: collecting-azure-cache-for-redis-telemetry
title: Azure Cache for Redis Monitoring with OpenTelemetry - Hit Rate, Memory Pressure, and Connection Saturation
sidebar_label: Azure Cache for Redis
sidebar_position: 13
description:
  Wire Azure Cache for Redis metrics into your existing OpenTelemetry
  Collector and ship to base14 Scout. Covers tier choice (Basic to
  Enterprise), hit-rate and memory-pressure SLIs, server-load saturation,
  the SKU connection cap, and the Premium-tier diagnostic logs handoff.
keywords:
  - azure cache for redis monitoring
  - azure redis opentelemetry
  - azure monitor receiver redis
  - cache hit rate monitoring
  - redis memory pressure
  - server load metric
  - redis connection cap
  - cache for redis basic vs premium
  - application insights alternative
  - base14 scout azure redis
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add Azure Cache for Redis metrics to my existing OpenTelemetry Collector?","acceptedAnswer":{"@type":"Answer","text":"Add the azure_auth extension and an azure_monitor receiver scoped to Microsoft.Cache/Redis, route the receiver into a metrics pipeline that exports to Scout via the oauth2client-authenticated OTLP/HTTP exporter, and grant the collector's service principal Monitoring Reader at the resource group containing your cache. The receiver polls Azure Monitor's REST API every 60 seconds. Basic tier emits a smaller metric subset than Standard, Premium, and Enterprise; the receiver returns whatever the resource publishes without erroring on tier-gated metrics. The collector itself does not connect to Redis on port 6380 and does not need the cache's primary access key."}},{"@type":"Question","name":"What is the difference between cache-managed metrics and self-hosted Redis metrics?","acceptedAnswer":{"@type":"Answer","text":"Azure Cache for Redis publishes metrics through Azure Monitor at a 1-minute aggregation granularity with resource-level dimensions only. Self-hosted Redis exposes raw INFO output that the OTel redisreceiver scrapes every poll interval, producing per-key and per-database metrics that Azure Monitor does not surface. Pick the azure_monitor approach when running PaaS Cache for Redis. Pick the redisreceiver approach when running Redis on a VM, in a container, in Kubernetes, or on-premises. Both pipelines can coexist if you operate hybrid deployments."}},{"@type":"Question","name":"Why is my Cache for Redis hit rate under 50% on a freshly-deployed cache?","acceptedAnswer":{"@type":"Answer","text":"Cold-cache misses dominate the first traffic window after a deploy because every key is a miss until the application has populated the working set. Hit rate climbs as keys are written and read back. Wait for at least 10 to 30 minutes of representative production traffic before reading the cachemissrate metric as an SLI. Sustained low hit rate after warm-up is a workload-fit signal: the application is asking for keys it never wrote (cache key drift) or TTLs are firing faster than the access pattern (TTL too aggressive)."}},{"@type":"Question","name":"How do I monitor the SKU connection cap on Basic versus Premium?","acceptedAnswer":{"@type":"Answer","text":"The connectedclients metric publishes both Average and Maximum aggregations. Alert on the Maximum approaching the SKU's documented cap: Basic C0 at 256, Basic C1 at 1000, Basic C2 at 2000, Standard C1 at 1000, Premium P1 at 7500 scaling up to 40000 on P5. Saturation manifests as MAX_CLIENTS_REACHED errors at the application layer; pre-saturation alerting on connectedclients_maximum at 80 percent of the SKU's documented cap gives time to scale the cache or pool clients before traffic fails. Look up the cap for your specific SKU when setting the threshold rather than assuming a single value."}},{"@type":"Question","name":"Should I run Cache for Redis Diagnostic Logs through this metrics collector?","acceptedAnswer":{"@type":"Answer","text":"No. Cache for Redis exposes two Diagnostic Settings categories — ConnectedClientList and MSEntraAuthenticationAuditLog — but both emit data only on Premium tier per Microsoft documentation. On Premium, the recommended pattern is Diagnostic Settings forwarding to Event Hubs with the azureeventhubreceiver ingesting events as OTel logs in the same collector. That fragment is documented separately. On Basic and Standard tiers, the categories are listed by the API but no log data is emitted, so wiring the log pipeline produces nothing useful. Stay with the metrics-only configuration in this guide unless you operate Premium fleets."}}]}
---

## Overview

This guide is the **execution playbook** for Azure Cache for Redis. For
the cross-surface architecture (auth, push vs pull, latency, the trace
gap), read [Azure Monitoring with OpenTelemetry — Architecture for
base14 Scout](./overview.md) first.

This guide is for engineers running Azure Cache for Redis (PaaS) in
production who want to add cache telemetry to an existing OpenTelemetry
Collector and ship it to base14 Scout. The collector polls Azure
Monitor's REST API for `Microsoft.Cache/Redis` metrics every 60
seconds, emits OTel metric series, and exports via OTLP/HTTP. The
receiver does not connect to the cache on port 6380 and does not need
the primary access key — it queries Azure Monitor for whatever your
cache auto-publishes.

The receiver does not connect to Redis directly. It queries Azure
Monitor for any cache your subscription auto-publishes to, so the
same configuration covers Basic, Standard, Premium, and Enterprise
tiers across any number of caches and shards per cache.

> **Self-hosted Redis?** If you run Redis on a VM, in a container, in
> Kubernetes, or on-premises, use the
> [Redis OpenTelemetry component guide](../../component/redis.md) which
> scrapes raw INFO output via the OTel `redisreceiver`. The two paths
> produce different metric sets and the dashboards differ accordingly.
> Both can run in the same collector for hybrid deployments.

This guide is metrics-only. For ingesting Cache for Redis diagnostic
logs (`ConnectedClientList`, `MSEntraAuthenticationAuditLog`), see
[Logs](#logs) for the Premium-tier handoff.

## Cache for Redis at a glance

Azure Cache for Redis is a fully managed Redis-compatible PaaS: the
application connects on TLS port 6380 with a primary access key (or
Microsoft Entra ID on Premium), Azure handles patching, replication
on Standard and above, persistence on Premium, and clustering on
Premium and Enterprise.

| Layer | What it produces |
| --- | --- |
| Listener | TLS connection accept, primary-key auth, optional Entra-ID auth on Premium. |
| Command engine | Per-command counters split by command class (GET, SET), hit/miss counters, evictions, expirations. |
| Memory subsystem | Used memory bytes + percentage, RSS bytes, eviction events when `maxmemory` trips. |
| CPU subsystem | `serverLoad` — Redis is single-threaded, so this approximates per-core CPU saturation. |

The receiver does not see per-key or per-database breakdowns — Azure
Monitor publishes coarse aggregates. For per-key drill-down on
Premium, ship logs via Diagnostic Settings.

## Tier choice

Azure Cache for Redis has four pricing tiers as of 2026. Each gates
feature availability, which in turn gates which metrics emit data.

| Tier | Pricing model (centralindia, May 2026) | Connection cap | Metric coverage |
| --- | --- | --- | --- |
| **Basic** | C0 ~$16/mo (250 MB), C1 ~$30/mo (1 GB) up to C6 ~$770/mo (53 GB) | C0 256, C1 1000, C2 2000, C3+ 5000-20000 | Core metrics only. No replication, no clustering, no persistence telemetry. |
| **Standard** | C1 ~$60/mo (1 GB) up to C6 ~$1700/mo (53 GB) | 1000-20000 depending on size | Same as Basic + replication-lag metrics + 99.9% SLA. |
| **Premium** | P1 ~$420/mo (6 GB) up to P5 ~$5500/mo (120 GB) | 7500-40000 | Same as Standard + clustering + persistence (RDB/AOF) + geo-replication + VNet integration + Entra-ID auth + Diagnostic Logs data emission + `cacheLatency` per-shard. |
| **Enterprise / Enterprise Flash** | Premium pricing tiers, contact Azure for quotes | 30000+ | Same as Premium + RedisJSON / RedisSearch / RedisBloom modules + Active-Active geo-replication. Ships under the `Microsoft.Cache/redisEnterprise` namespace, **not** covered by this guide. |

The receiver configuration is identical across Basic, Standard, and
Premium (all under `Microsoft.Cache/Redis`). Tier-gated metrics that
the resource does not publish simply emit no data points — there is
no error and no zero-valued series. The whitelist below intersects
what every tier publishes; expand it for Premium fleets by adding
geo-replication and persistence metrics from §[Premium-tier
additions](#premium-tier-additions).

Pick Basic for development, demo environments, and side projects where
the 99.9% SLA is not required. Pick Standard for production workloads
that need replication and the SLA but do not need clustering or
persistence. Production caches with high throughput, multi-shard
working sets, or audit-log requirements live on Premium.

## Receiver configuration

Drop this into your existing collector. The receiver, resource
processor, and pipeline are all keyed `/cacheforredis` so they coexist
with other Azure receivers under one collector and one Scout exporter.
The `Microsoft.Cache/Redis` namespace is not currently known to
exhibit receiver bug #45942 (the case-mismatched-dimensions bug seen
on `Microsoft.ApiManagement/service`,
`Microsoft.Network/azureFirewalls`, and a subset of `Microsoft.Storage`
metrics on `azuremonitorreceiver` v0.151.0), so no `transform`
processor is required for this surface. Re-check on receiver upgrades.

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/cacheforredis:
    subscription_ids:
      - ${env:AZURE_SUBSCRIPTION_ID}
    resource_groups:
      - ${env:CACHEFORREDIS_RESOURCE_GROUP}
    services:
      - Microsoft.Cache/Redis
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    initial_delay: 1s
    use_batch_api: false
    cache_resources: 86400
    dimensions:
      enabled: true
    metrics:
      "Microsoft.Cache/Redis":
        cachehits:               [Total]
        cachemisses:             [Total]
        cachemissrate:           [Average]
        connectedclients:        [Average, Maximum]
        evictedkeys:             [Total]
        expiredkeys:             [Total]
        getcommands:             [Total]
        setcommands:             [Total]
        operationsPerSecond:     [Average, Maximum]
        totalcommandsprocessed:  [Total]
        usedmemory:              [Average, Maximum]
        usedmemorypercentage:    [Average, Maximum]
        usedmemoryRss:           [Average]
        serverLoad:              [Average, Maximum]
        errors:                  [Total]
        cacheLatency:            [Average]

processors:
  resource/cacheforredis:
    attributes:
      - {key: cloud.provider,    value: azure,                action: insert}
      - {key: cloud.platform,    value: azure_cache_for_redis, action: insert}
      - {key: cloud.account.id,  value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
      - {key: cloud.region,      value: "${env:CACHEFORREDIS_REGION}", action: insert}
      - {key: cloud.resource_id, value: "${env:CACHEFORREDIS_RESOURCE_ID}", action: insert}
      - {key: service.name,      value: "${env:CACHEFORREDIS_SERVICE_NAME}", action: insert}

service:
  pipelines:
    metrics/cacheforredis:
      receivers: [azure_monitor/cacheforredis]
      processors: [resource/cacheforredis, batch]
      exporters: [otlp_http/b14]
```

The `service.name` env var should match what your alert routing
expects — `cache-for-redis-monitor` is a reasonable default. The
receiver emits 21 OTel series from the 16 whitelist entries (5
metrics are dual-aggregation Average + Maximum, producing two series
each).

## Authentication and RBAC

The collector authenticates to Azure Monitor as a service principal
holding **`Monitoring Reader`** at the **resource group** containing
the cache. Resource-group scope is the minimum necessary; subscription
scope is acceptable but broader than needed.

```bash
az role assignment create \
  --assignee "$AZURE_CLIENT_ID" \
  --role "Monitoring Reader" \
  --scope "$(az group show --name <rg> --query id -o tsv)"
```

Two propagation delays apply after first assignment:

1. **Control-plane RBAC propagation** — typically 60-300 seconds before
   the receiver's `metricDefinitions` and `metrics` REST calls succeed.
   The receiver retries on its 60-second poll cycle.
2. **First-poll metric-definitions race** — Azure Monitor's
   metricDefinitions catalog can take 60-180 seconds to populate after
   `provisioningState: Succeeded`. The receiver caches an empty list
   if it polls during that window. Mitigation: restart the scraper
   3-5 minutes after the cache reaches `Succeeded`, or accept the
   delay and the next poll cycle picks up the populated catalog.

Cache for Redis does NOT require the receiver to know the primary
access key. The key is only needed by clients connecting to the cache
on port 6380. Scrub it from any collector configuration; the receiver
exclusively uses Azure Monitor's REST API.

## What you'll monitor

The 16-metric whitelist intersects the universal Cache for Redis
metric surface (Basic and above). Five metrics are dual-aggregation
(`Average` + `Maximum`) and produce two OTel series each, for 21
emitted series in total.

| OTel series | Type | Unit | Use case |
| --- | --- | --- | --- |
| `azure_cachehits_total` | Counter (Gauge in OTel form) | Count | Throughput numerator for hit-rate calculation. |
| `azure_cachemisses_total` | Counter | Count | Throughput denominator for hit-rate; cold-start spike is normal. |
| `azure_cachemissrate_average` | Gauge | Percent | Pre-aggregated miss rate. Hit rate = 100 - cachemissrate. |
| `azure_connectedclients_average` | Gauge | Count | Steady-state connection load. |
| `azure_connectedclients_maximum` | Gauge | Count | SKU-cap saturation signal. |
| `azure_evictedkeys_total` | Counter | Count | Memory-pressure back-pressure. Healthy caches show zero. |
| `azure_expiredkeys_total` | Counter | Count | TTL lifecycle. Zero on workloads that don't set TTLs. |
| `azure_getcommands_total` | Counter | Count | Read load. |
| `azure_setcommands_total` | Counter | Count | Write load. |
| `azure_operationspersecond_average` | Gauge | Ops/s | Steady-state throughput. |
| `azure_operationspersecond_maximum` | Gauge | Ops/s | Burst envelope. |
| `azure_totalcommandsprocessed_total` | Counter | Count | Aggregate throughput, including auth and ping overhead. |
| `azure_usedmemory_average` | Gauge | Bytes | Working-set size, raw bytes. |
| `azure_usedmemory_maximum` | Gauge | Bytes | Peak working-set within the aggregation window. |
| `azure_usedmemorypercentage_average` | Gauge | Percent | Fraction of SKU max in use. The capacity-planning signal. |
| `azure_usedmemorypercentage_maximum` | Gauge | Percent | Peak fraction of SKU max in use. |
| `azure_usedmemoryrss_average` | Gauge | Bytes | Resident set size. Always ≥ used memory; gap = allocator overhead. |
| `azure_serverload_average` | Gauge | Percent | Redis CPU-equivalent saturation, steady state. |
| `azure_serverload_maximum` | Gauge | Percent | Peak CPU saturation within the aggregation window. |
| `azure_errors_total` | Counter, splits by `metadata_errortype` | Count | Failure types (auth, RDB, AOF, failover). All zero on healthy caches; non-zero is the page. |
| `azure_cachelatency_average` | Gauge | Microseconds | Internal command-processing latency. **Premium-tier data**; emits a baseline-zero series on lower tiers. |

### Operations notes

- The `errors` metric splits across roughly 10 `metadata_errortype`
  dimensions: `MicrosoftEntraTokenExpired`, `MicrosoftEntraAuthenticationFailure`,
  `AADTokenExpired`, `AADAuthenticationFailure`, `Failover`,
  `UnresponsiveClients`, `Import`, `Export`, `RDB`, `AOF`. All zero on a
  healthy cache. Alert per type; route the page based on which type fired.
- `cacheLatency` is documented by Microsoft as Premium-tier-only. The
  receiver may emit a baseline-zero series on Basic and Standard
  caches because the metric appears in the catalog. Treat sustained
  non-zero values as meaningful signal; treat near-zero on Basic /
  Standard as no-data-equivalent.
- `evictedkeys` and `expiredkeys` are absolute counters that reset
  only on Redis restart — graph them as derivatives (`$perSecond`) to
  surface change rate.

## Cardinality control

Cache for Redis emits resource-level dimensions only — no per-key,
per-database, or per-shard breakdowns appear in metrics (Premium
clustering produces per-shard splits via `metadata_shardid`, but
that's the only built-in cardinality multiplier). The receiver
attaches the following per-data-point attributes:

| Attribute | Source | Cardinality |
| --- | --- | --- |
| `azuremonitor.resource_id` | Receiver | One per cache (low). |
| `name` | Receiver | One per cache. |
| `resource_group` | Receiver | One per RG. |
| `type` | Receiver | Constant: `Microsoft.Cache/Redis`. |
| `location` | Receiver | One per region. |
| `metadata_shardid` | Azure Monitor | `0` on Basic / Standard (single shard); `0..N-1` on Premium clustered caches. |
| `metadata_errortype` | Azure Monitor (`errors` only) | ~10 types per cache. |

Cardinality stays bounded at 21 series per cache on Basic and
Standard (single-shard, no per-error split until errors fire).
`metadata_errortype` adds up to ten per-type splits on `azure_errors_total`
when the cache produces errors, taking steady state to ~30 datapoints
per scrape per cache. Premium clusters with N shards multiply the
single-shard total by N — a 10-shard P3 cluster lands at ~210 datapoints
per scrape per cache. Well within Scout's per-account default for
fleets up to a few hundred caches.

If you operate dozens of caches in one collector, scope the receiver
to a single resource group per fragment under `_shared/azure/scraper/`
to keep query latency predictable.

## Alert tuning

Operational alerting on Cache for Redis follows the **RED method on
the cache**: Rate (operations per second), Errors (errors counter),
Duration (cacheLatency on Premium, serverLoad as a proxy on Basic /
Standard).

### RED method on the cache

| Signal | Source metric | Warning | Critical | Notes |
| --- | --- | --- | --- | --- |
| **Hit rate** | `100 - azure_cachemissrate_average` | < 70% / 5m | < 50% / 15m | Cold-start excluded; first 30 min after deploy is unreliable. |
| **Memory pressure** | `azure_usedmemorypercentage_average` | > 70% / 15m | > 90% / 5m | Eviction starts at 100%. The 90% critical gives time to scale the cache. |
| **CPU saturation** | `azure_serverload_average` | > 80% / 15m | > 95% / 5m | Redis is single-threaded; 100% means no headroom. Premium clusters hide saturation behind shard splits. |
| **Connection saturation** | `azure_connectedclients_maximum` | ≥ 80% of SKU cap | = SKU cap | Caps: Basic C0 256, C1 1000, Standard C1 1000, Premium P1 7500. Look up the cap for your SKU before setting the threshold. |
| **Eviction events** | `$increase(azure_evictedkeys_total)` | > 0 / 5m sustained | > 0 / 1m sustained | Sustained eviction without expiration = under-sized cache. |
| **Error events** | `$increase(azure_errors_total)` per `metadata_errortype` | > 0 / 5m | > 0 / 1m | Per-type routing: `RDB` / `AOF` to platform on-call; auth types to identity team. |
| **Latency (Premium)** | `azure_cachelatency_average` | > 1000 / 5m (= 1 ms) | > 5000 / 5m (= 5 ms) | Metric publishes in microseconds. Premium-tier only. On lower tiers the metric reads zero or near-zero; alert only when emitting non-zero data. |

### Cold-start exclusion

Hit rate alerts must respect cache warm-up. Common pattern: alert on
hit rate only after the cache has been receiving traffic for at least
30 minutes (`absent_over_time` or equivalent), and only when the
operations counter shows non-trivial throughput. Otherwise a paused
service or an off-hours quiet period triggers as a low-hit-rate page.

## Premium-tier additions

Premium tier emits additional metrics not exercised in this guide.
Add them to the receiver whitelist when monitoring Premium fleets.

| Metric (suggested whitelist additions) | Aggregation | What it covers |
| --- | --- | --- |
| `geoReplicationHealthy` | Average | Geo-replication link status, 0 or 1. |
| `geoReplicationConnectivityLag` | Average | Time delta between primary and replica writes. |
| `geoReplicationDataSyncOffset` | Average | Bytes-pending between primary and replica. |
| `cacheRead` | Total | Bytes read from the cache. |
| `cacheWrite` | Total | Bytes written to the cache. |
| `usedmemoryscripts` | Average | Memory used by Lua scripts. |
| `serverLoad` (per shard) | Average + Maximum | Splits by `metadata_shardid` on clustered Premium caches. |
| `connectedclients` (per shard) | Average + Maximum | Splits by `metadata_shardid`. |

The receiver does not need configuration changes to handle the
per-shard splits — `metadata_shardid` simply takes more values once
the cache is clustered. Existing dashboards and alerts that group by
`metadata_shardid` work unchanged.

For RedisJSON / RedisSearch / RedisBloom module metrics on Enterprise
caches, the resource type is `Microsoft.Cache/redisEnterprise` and
requires a separate receiver block. Out of scope for this guide.

## Apps-side instrumentation

The metrics in this guide describe the cache itself. End-to-end
visibility — application latency including cache lookup time, cache
keys requested, miss-rate per code path — requires client-side OTel
instrumentation in the application. The OTel auto-instrumentation
agents for Java, .NET, Python, Node.js, and Go all wrap the standard
Redis client libraries (StackExchange.Redis, lettuce, redis-py,
ioredis, go-redis) and produce per-call spans with `db.system: redis`
and `db.statement` set to the command + key.

The cache-side metrics in this guide and the apps-side traces are
complementary: cache metrics tell you whether the cache is healthy;
apps-side spans tell you which code paths are using the cache and
how. Wire both for full coverage.

For self-hosted Redis where the cache itself runs in your
infrastructure, see the
[Redis OpenTelemetry component guide](../../component/redis.md) for
INFO-driven scrape configuration.

## Logs

On Premium tier, log-driven analysis fills three gaps that metrics
do not cover:

- **Per-IP audit** is what you reach for when correlating cache
  usage to specific source addresses. `ConnectedClientList` records
  every client IP connecting to the cache; the metrics surface only
  aggregate connection counts.
- **Per-key-prefix audit** ties cache traffic to specific service
  principals or applications via the subscription key prefix used
  for each connection. The metrics carry no per-key dimension.
- **Auth failure attribution** records the principal ID, error
  reason, and timestamp for every failed Entra-ID auth attempt in
  `MSEntraAuthenticationAuditLog`. The `azure_errors_total` metric
  with `metadata_errortype = MicrosoftEntraAuthenticationFailure`
  shows the count; the log shows who, why, and when.

Cache for Redis publishes two Diagnostic Settings categories:

| Category | What it contains | Tier emission |
| --- | --- | --- |
| `ConnectedClientList` | Periodic snapshot of currently-connected clients with source IP and the subscription key prefix. | Premium tier only. Listed by the API on Basic and Standard but no data emits. |
| `MSEntraAuthenticationAuditLog` | Microsoft Entra ID authentication attempts against the cache, success and failure. | Premium tier only (Entra ID auth is itself Premium-only). |

The recommended pattern on Premium is **Diagnostic Settings to Event
Hubs to `azureeventhubreceiver`** in the same collector. The receiver
ingests events as OTel logs and routes them to Scout via the same
`oauth2client` / `otlphttp/b14` pipeline used for metrics. That
configuration lives in a sibling fragment under
`_shared/azure/scraper/conf.d/` and is documented separately.

On Basic and Standard caches, the categories are listed by the API
but emit no log data. Wiring the log pipeline produces no events;
stay with the metrics-only configuration in this guide and revisit if
the cache is upgraded to Premium.

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
no metrics. Cause: Azure Monitor's metricDefinitions catalog has not
yet populated for the freshly-deployed cache (typically true within
60-180 seconds of `provisioningState: Succeeded`). Fix: restart the
scraper after the cache has been up for at least 3 minutes, OR wait
5-10 minutes and the next 60-second poll picks up the now-populated
catalog.

### `MAX_CLIENTS_REACHED` from the application

Symptom: clients fail with `max number of clients reached` or
`MAX_CLIENTS_REACHED`. Cause: the cache hit its SKU connection cap.
Basic C0 caps at 256 clients; Basic C1 and Standard C1 at 1000;
Basic C2 / Standard C2 at 2000; Premium P1 at 7500 scaling to 40000
on P5. Fix: scale the cache up
(`az redis update --sku Standard --vm-size C1`), pool clients in the
application (one connection multiplexed across requests), or move to
Premium for higher caps. Pre-saturation alerting on
`azure_connectedclients_maximum` at 80% of the SKU's documented cap
gives time to act before traffic fails.

### `cacheLatency` reads near-zero on Basic / Standard

Symptom: `azure_cachelatency_average` emits but stays near zero
across all polls. Cause: the metric is documented by Microsoft as
Premium-tier-only; the receiver still queries it on lower tiers
because the catalog entry exists. Fix: this is expected behaviour
on Basic and Standard. Either filter the metric out of dashboards
on lower-tier caches, or accept the baseline-zero series. The
metric becomes meaningful when the cache is upgraded to Premium.

### Hit rate stays low after warm-up

Symptom: `100 - azure_cachemissrate_average` reads below 50% for
hours after the cache is in steady state. Cause: working-set drift
(application asks for keys it never wrote) or TTL aggression
(keys expire before they can be reused). Fix: check TTL settings on
SET commands; profile which keys the application reads vs writes;
consider a key-prefix audit on Premium via `ConnectedClientList`
logs.

### Eviction events without memory pressure

Symptom: `azure_evictedkeys_total` increments while
`azure_usedmemorypercentage_average` reads below 100%. Cause: Azure
Cache for Redis aggregates `usedmemorypercentage` over the 1-minute
window; brief spikes to 100% can trigger evictions before the
metric average reflects them. Fix: cross-reference with
`azure_usedmemory_maximum` over the same window; if max hits the
SKU cap, eviction is correlated.

### Scout OAuth2 returns 401

Symptom: `oauth2client` extension logs 401 from the token endpoint.
Cause: stale `SCOUT_CLIENT_ID` / `SCOUT_CLIENT_SECRET` /
`SCOUT_TOKEN_URL`. Fix: re-source
`~/.config/base14/scout-otel-config.env` (or the equivalent secret
store) and restart the collector. The `oauth2client` extension
caches tokens for the configured TTL; restart is the fastest
invalidation.

## Frequently Asked Questions

### When should I use Cache for Redis versus a self-hosted Redis on AKS?

Pick Azure Cache for Redis when you want a 99.9%+ SLA, automated
patching, replication on Standard and above, and Premium-tier
features (clustering, persistence, geo-replication) without
operating Redis yourself. Pick self-hosted Redis on AKS or VMs
when you need RedisJSON / RedisGraph / module support not available
in Premium, when you have specific Redis configuration requirements
not exposed by the PaaS, or when the unit economics at scale favour
self-managed (Premium tier crossovers vary by workload).

The metrics paths differ: this guide covers the PaaS surface via
`azure_monitor`; self-hosted Redis is covered by the
[Redis OpenTelemetry component guide](../../component/redis.md) via
`redisreceiver` scraping INFO output.

### What changes between Basic, Standard, Premium, and Enterprise for monitoring?

Basic and Standard publish identical metric sets (the metric
whitelist in this guide covers both). Premium adds clustering
(`metadata_shardid` splits), persistence (`RDB` and `AOF` error
types become non-zero on disk-write failure), geo-replication
metrics, Diagnostic Logs data emission (`ConnectedClientList`,
`MSEntraAuthenticationAuditLog`), and Microsoft Entra ID
authentication. Enterprise ships under a different resource type
(`Microsoft.Cache/redisEnterprise`) with module-specific metrics
not covered by this guide.

For Premium fleets, expand the receiver whitelist with the
metrics in §[Premium-tier additions](#premium-tier-additions).

### What metrics are unavailable on Basic tier?

Basic tier does not emit data for Premium-only metrics:
geo-replication families (`geoReplicationHealthy`,
`geoReplicationConnectivityLag`, `geoReplicationDataSyncOffset`),
Lua-script memory (`usedmemoryscripts`), and the per-shard splits
of `serverLoad` / `connectedclients`. Diagnostic Settings
categories are listed but emit no log data. The whitelist in this
guide intersects what Basic publishes plus `cacheLatency` (which
appears in the catalog on Basic but emits baseline-zero data).

### How do I detect a slow cache versus slow Redis client code?

Cache metrics describe the cache itself: `cacheLatency` on Premium
(internal command-processing time), `serverLoad` on all tiers
(saturation), `connectedclients_maximum` (cap pressure). Sustained
high `serverLoad` plus rising `cacheLatency` means the cache is
overloaded — scale up or pool clients differently. If cache metrics
stay healthy but the application reports slow Redis calls, the
bottleneck is between the application and the cache: TLS handshake
overhead per connection (use connection pooling), DNS resolution
delays (cache the resolved hostname), or network latency between
the app's region and the cache's region (collocate where possible).
Apps-side OTel spans on the Redis client library distinguish these
three cases by showing the wall-clock time of the call.

### How does Cache for Redis compare to AWS ElastiCache for monitoring?

Both expose Redis-compatible APIs and ship metrics through the
cloud's native monitoring service (Azure Monitor for Cache for
Redis, CloudWatch for ElastiCache). The OTel paths differ: this
guide uses `azure_monitor` (pull-based, polls every 60 s);
ElastiCache uses CloudWatch metrics streams (push-based via
Kinesis Firehose, near-real-time). Metric coverage is roughly
equivalent at the SLI layer (hit rate, memory, evictions, server
CPU); the dimensions and aggregation primitives differ. Scout
dashboards normalise both into the same metric names where
possible (`azure_cachehits_total` and `aws_elasticache_cachehits_sum`
unify under one panel via Scout query overlays).

## Reference

- [Microsoft.Cache/Redis supported
  metrics](https://learn.microsoft.com/azure/azure-monitor/reference/supported-metrics/microsoft-cache-redis-metrics)
- [Cache for Redis Diagnostic Settings
  reference](https://learn.microsoft.com/azure/azure-cache-for-redis/cache-monitor-diagnostic-settings)
- [Cache for Redis pricing
  tiers](https://azure.microsoft.com/pricing/details/cache/)
- [opentelemetry-collector-contrib
  azuremonitorreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/azuremonitorreceiver)
- [Self-hosted Redis component guide](../../component/redis.md) — the
  `redisreceiver` path for non-PaaS deployments.

## Related Guides

- [Azure Monitoring with OpenTelemetry — Architecture](./overview.md) —
  start here for the cross-surface story.
- [Self-hosted Redis](../../component/redis.md) — same metric vocabulary
  via the `redisreceiver` for VM, container, or on-prem deployments.
- [Azure Cosmos DB](./cosmos-db.md) — sibling data-plane PaaS;
  identical auth pattern.
- [Azure SQL Database](./sql-database.md) — also a delta on a
  shipped self-hosted component doc; bidirectional cross-link
  precedent.
- [Azure Service Bus](./service-bus.md) — sibling messaging surface;
  identical auth pattern.
