---
date: 2026-09-02
id: collecting-gcp-memorystore-telemetry
title: Memorystore for Redis and Valkey Monitoring with OpenTelemetry
sidebar_label: Memorystore
sidebar_position: 5
description: >
  Collect Memorystore for Redis, Redis Cluster and Valkey metrics into
  base14 Scout with the OpenTelemetry googlecloudmonitoring receiver —
  hit rate, eviction, memory pressure and replication lag.
keywords:
  - memorystore monitoring opentelemetry
  - memorystore redis metrics scout
  - memorystore valkey metrics
  - gcp redis observability
  - redis googleapis metrics otel
  - memorystore cache hit ratio
  - memorystore eviction monitoring
  - gcp managed redis opentelemetry
---

Memorystore publishes cache metrics to Cloud Monitoring for all three of
its engines. This guide collects them into Scout with the
`googlecloudmonitoring` receiver, and covers the metric-namespace
differences between Redis, Redis Cluster and Valkey — which are larger
than the product naming suggests.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note Running this in production

Storing and querying these metrics at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Overview

Memorystore is three products under one name, and each publishes to a
different metric prefix. Getting this wrong is the most common reason a
Memorystore config returns no data at all.

| Product | Metric prefix | Monitored resource |
|---|---|---|
| Memorystore for Redis (Basic, Standard) | `redis.googleapis.com/` | `redis_instance` |
| Memorystore for Redis Cluster | `redis.googleapis.com/cluster/` | `redis_instance` |
| Memorystore for Valkey | `memorystore.googleapis.com/instance/` | `memorystore.googleapis.com/Instance` |

Check which you have before writing a config: **Monitoring → Metrics
Explorer**, type the prefix, and turn on the **Active** toggle so it
hides metrics with no data.

## Memorystore at a glance

| Layer | What it tells you | Where it comes from |
|---|---|---|
| Cache effectiveness | Hit ratio, evictions, expirations | Cloud Monitoring |
| Memory pressure | Usage ratio, system memory, maxmemory | Cloud Monitoring |
| Client health | Connected, blocked and rejected clients | Cloud Monitoring |
| Replication | Replica lag, offset difference | Cloud Monitoring |
| Command detail | Per-command call counts and latency | Cloud Monitoring (high cardinality) or the `redis` receiver |
| Keyspace contents | Key counts, TTL distribution | The `redis` receiver |

---

## Receiver configuration

The block below is for **Memorystore for Redis**. Swap the metric names
for the Valkey or Cluster set shown afterwards if that is what you run.

```yaml showLineNumbers title="memorystore-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/memorystore:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Cache effectiveness
      - metric_name: "redis.googleapis.com/stats/cache_hit_ratio"
      - metric_name: "redis.googleapis.com/stats/keyspace_misses"
      - metric_name: "redis.googleapis.com/stats/evicted_keys"
      # Memory
      - metric_name: "redis.googleapis.com/stats/memory/usage"
      - metric_name: "redis.googleapis.com/stats/memory/usage_ratio"
      - metric_name: "redis.googleapis.com/stats/memory/maxmemory"
      - metric_name: "redis.googleapis.com/stats/memory/system_memory_usage_ratio"
      # Clients and connections
      - metric_name: "redis.googleapis.com/clients/connected"
      - metric_name: "redis.googleapis.com/clients/blocked"
      - metric_name: "redis.googleapis.com/stats/connections/total"
      - metric_name: "redis.googleapis.com/stats/reject_connections_count"
      # Load and keyspace
      - metric_name: "redis.googleapis.com/stats/cpu_utilization"
      - metric_name: "redis.googleapis.com/stats/cpu_utilization_main_thread"
      - metric_name: "redis.googleapis.com/stats/network_traffic"
      - metric_name: "redis.googleapis.com/keyspace/keys"
      - metric_name: "redis.googleapis.com/server/uptime"
      # Replication — Standard tier only
      - metric_name: "redis.googleapis.com/replication/master/slaves/lag"
      - metric_name: "redis.googleapis.com/replication/offset_diff"

processors:
  resource/memorystore:
    attributes:
      - {key: service.name, value: memorystore-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_memorystore, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: cloud.region, value: "${env:GCP_REGION}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    metrics/memorystore:
      receivers: [googlecloudmonitoring/memorystore]
      processors: [memory_limiter, resource/memorystore, batch]
      exporters: [otlphttp/base14]
```

### Memorystore for Valkey

Valkey uses an entirely different namespace, and splits metrics between
instance scope and node scope:

```yaml showLineNumbers title="memorystore-config.yaml"
    metrics_list:
      - metric_name: "memorystore.googleapis.com/instance/cpu/average_utilization"
      - metric_name: "memorystore.googleapis.com/instance/cpu/maximum_utilization"
      - metric_name: "memorystore.googleapis.com/instance/memory/total_used_memory"
      - metric_name: "memorystore.googleapis.com/instance/memory/utilization"
      - metric_name: "memorystore.googleapis.com/instance/keyspace/total_keys"
      - metric_name: "memorystore.googleapis.com/instance/stats/total_keyspace_hits_count"
      - metric_name: "memorystore.googleapis.com/instance/stats/total_keyspace_misses_count"
      - metric_name: "memorystore.googleapis.com/instance/stats/total_connections_received_count"
      - metric_name: "memorystore.googleapis.com/instance/replication/average_ack_lag"
      - metric_name: "memorystore.googleapis.com/instance/node/clients/connected_clients"
      - metric_name: "memorystore.googleapis.com/instance/node/memory/usage"
      - metric_name: "memorystore.googleapis.com/instance/node/stats/evicted_keys_count"
```

Note that Valkey has **no equivalent of `cache_hit_ratio`** — it
publishes `total_keyspace_hits_count` and `total_keyspace_misses_count`
as separate cumulative counters, so compute the ratio at query time.
Memorystore for Redis is the reverse: it publishes the ready-made ratio
and `keyspace_misses`, but no hits counter.

Node-scoped metrics carry a `node_id` label. On a large cluster that
multiplies your series count by the shard count; see
[Cardinality control](#cardinality-control).

### Collecting the whole service

```yaml showLineNumbers title="memorystore-config.yaml"
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("redis.googleapis.com/")'
```

Around 40 metric types for Redis, considerably more for Valkey. Both are
small enough that the whole-service filter is reasonable here, unlike
Cloud SQL.

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
GCP_REGION=asia-south1
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

---

## Authentication and IAM

`roles/monitoring.viewer` on the project. Nothing Memorystore-specific —
see [GCP Monitoring overview](./overview.md#authentication).

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `stats/cache_hit_ratio` | Gauge | ratio | A falling ratio means the working set has outgrown the instance, or TTLs are too short. |
| `stats/keyspace_misses` | Cumulative sum | count | Absolute miss volume. The ratio can hold steady while misses climb with traffic, which costs the backend either way. |
| `stats/evicted_keys` | Cumulative sum | count | The instance is at `maxmemory` and discarding data. Any sustained value means it is undersized. |
| `stats/memory/usage_ratio` | Gauge | ratio | Memory used against `maxmemory`. Above 0.9 and evictions become likely. |
| `stats/memory/system_memory_usage_ratio` | Gauge | ratio | Whole-VM memory, including replication buffers. Can be high while `usage_ratio` looks fine. |
| `stats/memory/maxmemory` | Gauge | bytes | The cap the ratio is measured against; also shows tier changes. |
| `clients/connected` | Gauge | count | Client count against the tier's limit. |
| `clients/blocked` | Gauge | count | Clients waiting on `BLPOP` and friends. Sustained non-zero suggests a stuck consumer. |
| `stats/reject_connections_count` | Cumulative sum | count | Connections refused at the limit. Should be zero. |
| `stats/cpu_utilization` | Gauge | seconds | CPU seconds per minute across the whole server process. |
| `stats/cpu_utilization_main_thread` | Gauge | seconds | The one that matters. Redis executes commands on a single thread, so this saturates long before whole-process CPU looks busy. |
| `stats/network_traffic` | Cumulative sum | bytes | Bandwidth, which is what large-value workloads actually hit first. |
| `keyspace/keys` | Gauge | count | Total keys. A cliff here usually means a flush or a mass expiry. |
| `replication/master/slaves/lag` | Gauge | seconds | Standard-tier replica staleness, and your failover data-loss window. |
| `server/uptime` | Gauge | seconds | A reset to near zero is an unplanned restart. |

None of these are distributions, so the scrape-batch failure mode does
not apply to Memorystore.

---

## Cardinality control

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `instance_id` | Resource label | One per instance | Yes — the grouping key |
| `region`, `project_id` | Resource label | Small | Yes |
| `node_id` | Resource label (Cluster, Valkey) | One per shard and replica | Only if you debug per-shard skew |
| `cmd` | Metric label on `commands/calls` | One per Redis command used | No, unless you are specifically profiling |
| `role` | Metric label | Two (`primary`, `replica`) | Yes |

The per-command metrics — `redis.googleapis.com/commands/calls` and
`commands/usec_per_call` — are where this surface gets expensive. Redis
has over 200 commands, and a busy application touches dozens. They are
worth their cost while you profile a latency problem, and not
afterwards. Add them deliberately, and drop them again.

To keep node-scoped metrics but collapse the shards:

```yaml showLineNumbers title="memorystore-config.yaml"
processors:
  transform/memorystore:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - delete_key(attributes, "node_id")
```

---

## Alert tuning

| Signal | Source metric | Warning | Critical | Notes |
|---|---|---|---|---|
| Hit rate collapse | `stats/cache_hit_ratio` | < 0.85 for 15m | < 0.70 for 15m | Exclude the first minutes after a restart, when the cache is legitimately cold. |
| Memory pressure | `stats/memory/usage_ratio` | > 0.85 for 10m | > 0.95 for 5m | Read alongside the eviction counter — the ratio alone does not say whether data is being lost. |
| Eviction | `stats/evicted_keys` | any sustained | rising | On a pure cache this may be acceptable; on anything session-shaped it is data loss. |
| Rejected connections | `stats/reject_connections_count` | any | sustained | The client-connection limit, not memory. |
| Replica lag | `replication/master/slaves/lag` | > 10s for 5m | > 60s for 5m | Standard tier only; this is your failover data-loss window. |
| Unplanned restart | `server/uptime` | drops below 300 | — | Correlate with `keyspace/keys` falling to zero. |

---

## Logs

Memorystore does not write application-level logs to Cloud Logging.
Instance lifecycle events — creation, scaling, failover, maintenance —
appear as Cloud Audit Logs. Route them alongside your other GCP logs if
you want maintenance windows visible next to the metrics:

```bash showLineNumbers
gcloud logging sinks create scout-memorystore-audit \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='protoPayload.serviceName="redis.googleapis.com"'
```

The `google_cloud_logentry_encoding` extension recognizes audit entries
and maps them to `gcp.audit.*` attributes plus `user.email` and
`client.address`. See
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md).

---

## Alternative: the Redis receiver

The OTel `redis` receiver connects to the instance and parses `INFO`
output directly. It produces OTel-native metric names (`redis.memory.used`,
`redis.keyspace.hits`) rather than GCP metric types, with cumulative
temporality, and reaches things Cloud Monitoring never exposes — per-database
key and TTL breakdowns, fragmentation ratio, fork duration, and RDB
change counts.

Memorystore adds two caveats:

- **The collector must reach the instance.** Memorystore is private-IP
  only, so the collector has to run inside the VPC or a peered one.
- **Coverage is not identical.** Memorystore restricts `CONFIG`, so
  receiver metrics derived from it — `redis.maxmemory` among them —
  return nothing. The `INFO` fields Google restricts vary by tier.

Configuration is in [Redis component](../../component/redis.md). Set
`password` to the instance's AUTH string if AUTH is enabled, enable
`tls` if in-transit encryption is on, and give the pipeline its own
`service.name` so the two views stay separable.

:::note Managed versus self-hosted

If you run Redis or Valkey yourself on Compute Engine or GKE rather than
using Memorystore, this guide does not apply — those instances publish
nothing to Cloud Monitoring beyond VM-level metrics. Use
[Redis component](../../component/redis.md) directly.

:::

---

## Verify

1. **The collector starts cleanly** — check for `PermissionDenied` or
   `could not find default credentials` in its logs.

2. **The prefix is right for your product.** This is the failure that
   looks like everything else. Paste your prefix into Metrics Explorer
   with the **Active** toggle on; if nothing lists, you are on the wrong
   namespace for the engine you run.

3. **Confirm the series landed:**

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, max(Value) AS latest
   FROM otel_metrics_gauge
   WHERE ServiceName = 'memorystore-metrics'
     AND MetricName = 'redis.googleapis.com/stats/memory/usage_ratio'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

   The cumulative counters (`keyspace_misses`, `evicted_keys`) are in
   `otel_metrics_sum`.

---

## Troubleshooting

**No metrics at all, and the metric names look correct.**
Almost always the wrong prefix for the engine. Valkey is
`memorystore.googleapis.com/instance/`, not `redis.googleapis.com/`, and
Redis Cluster puts everything under `redis.googleapis.com/cluster/`.

**Replication metrics return nothing.**
`replication/master/slaves/lag` exists only on Standard-tier instances.
Basic tier has no replica, so no series is emitted.

**`cache_hit_ratio` is missing on Valkey.**
Valkey does not publish it. Compute it from
`total_keyspace_hits_count` and `total_keyspace_misses_count` at query
time.

**Series count jumped after adding one metric.**
You added `commands/calls` or `commands/usec_per_call`, which carry a
per-command label. See [Cardinality control](#cardinality-control).

**Everything arrives under `unknown_service`.**
The `resource/memorystore` processor is missing, or a blanket `resource`
processor in the same pipeline is overwriting `service.name`.

## FAQ

### How do I monitor Memorystore with OpenTelemetry?

Use the `googlecloudmonitoring` receiver against the metric prefix for
your engine — `redis.googleapis.com/` for Memorystore for Redis,
`redis.googleapis.com/cluster/` for Redis Cluster, and
`memorystore.googleapis.com/instance/` for Valkey. It needs only
`roles/monitoring.viewer`.

### What is the difference between the Redis and Valkey metric namespaces?

They share almost no metric names. Valkey publishes under
`memorystore.googleapis.com/instance/` with separate instance-scoped and
node-scoped families, and omits some Redis conveniences such as
`cache_hit_ratio`. Configs are not portable between the two.

### Which Memorystore metrics should I alert on?

Alert on cache hit ratio, memory usage ratio, evicted keys and rejected
connections, plus replica lag on Standard tier. Evictions and rejected
connections matter most because both mean the instance is actively
refusing work.

### Can I use the OTel redis receiver against Memorystore?

The OTel `redis` receiver works against Memorystore from a collector
inside the VPC, and gives you keyspace and fragmentation detail Cloud
Monitoring never exposes. Metrics derived
from `CONFIG` will be missing, because Memorystore restricts that
command.

### Why does system memory usage look high when memory usage ratio looks fine?

`stats/memory/usage_ratio` measures data against `maxmemory`, while
`system_memory_usage_ratio` measures the whole VM, which also holds
replication buffers and client output buffers. A large replication
backlog raises the second without touching the first.

### Are evicted keys always a problem?

On a pure read-through cache, some eviction is the design working. On
anything holding sessions, rate-limit counters or queues, an eviction is
data loss. Decide per instance rather than alerting uniformly.

## Reference

- [Memorystore for Redis metrics](https://docs.cloud.google.com/memorystore/docs/redis/supported-monitoring-metrics)
- [Memorystore for Valkey metrics](https://docs.cloud.google.com/memorystore/docs/valkey/supported-monitoring-metrics)
- [Memorystore for Redis Cluster metrics](https://docs.cloud.google.com/memorystore/docs/cluster/supported-monitoring-metrics)

## Related Guides

- [GCP Monitoring overview](./overview.md) - the one-time IAM and
  collector setup this guide assumes you already have.
- [Redis component](../../component/redis.md) - the direct-scrape
  receiver, and the guide to use for self-hosted Redis or Valkey.
- [Cloud SQL](./cloud-sql.md) - the database this cache usually sits in
  front of.
