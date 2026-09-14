---
title: >
  Redpanda OpenTelemetry Monitoring - Kafka Throughput, Partition
  Health, and Collector Setup
sidebar_label: Redpanda
id: collecting-redpanda-telemetry
sidebar_position: 67
description: >
  Collect Redpanda metrics with the OpenTelemetry Collector. Monitor
  Kafka throughput, unavailable partitions, Raft leadership, and disk
  headroom in base14 Scout.
keywords:
  - redpanda opentelemetry
  - redpanda otel collector
  - redpanda metrics monitoring
  - redpanda performance monitoring
  - opentelemetry prometheus receiver redpanda
  - redpanda observability
  - kafka compatible broker monitoring
  - redpanda telemetry collection
---

# Redpanda

Redpanda serves Prometheus text at `/public_metrics` on the admin port
`:9644` with no plugin and no sidecar. The OpenTelemetry Collector's
`prometheus` receiver scrapes that endpoint directly and collects 143
metric families covering Kafka produce and fetch throughput, cluster and
partition health, Raft leadership and recovery, storage and disk
headroom, seastar reactor and IO-queue internals, host disk and network
counters, and the Schema Registry and HTTP Proxy subsystems. This guide
configures the scrape, adds the Kafka-protocol receiver for consumer
lag, and ships metrics to base14 Scout.

Redpanda is a Kafka-protocol-compatible C++/seastar broker. If you
already run Kafka, the topic, partition and consumer-group model is
unchanged - what changes is the telemetry. There is **no JVM, no JMX and
no exporter sidecar**, and therefore **no `jvm_*`, `go_*` or `process_*`
families at all**. The whole component surface is `redpanda_*`. Coming
from [Kafka](./kafka.md), expect those runtime families to be absent.

> **Set `metrics_path: /public_metrics`.** Port `:9644` serves two
> different Prometheus endpoints. `/public_metrics` (prefix `redpanda_`)
> is the one Redpanda documents for monitoring and the one this guide
> uses. `/metrics` (prefix `vectorized_`) is the legacy debugging
> surface. The `prometheus` receiver defaults `metrics_path` to
> `/metrics`, so omitting the key silently scrapes the legacy endpoint
> and none of the metric names below will exist in your backend. See
> [Two endpoints on one port](#two-endpoints-on-one-port).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Redpanda               | 23.1    | 26.2        |
| OTel Collector Contrib | 0.90.0  | 0.160.0     |
| base14 Scout           | Any     | -           |

The `kafka_metrics` receiver and `otlp_http` exporter names used in this
guide were introduced in contrib 0.149.0. On builds below that, use the
previous spellings, `kafkametrics` and `otlphttp`.

Before starting:

- The broker's admin port `:9644` must be reachable from the host
  running the Collector.
- The Kafka port `:9092` must also be reachable if you add the
  Kafka-protocol receiver for consumer lag (see
  [Collection paths](#collection-paths)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

**Licensing.** Community Edition is BSL, converting to Apache 2.0 four
years after merge. No metric family is itself enterprise-gated, but
families belonging to enterprise features only emit while those features
run, which needs a licence. The Core and Operational tiers below are
entirely unlicensed families.

## What You'll Monitor

Every series carries seastar's per-shard `shard` label. seastar is
shard-per-core, so a single-core broker emits `shard="0"` and a
multi-core broker fans the same metric out to one series per core. That
label has no Kafka analogue, and it is the multiplier behind
[Cardinality: two all-zero quota histograms dominate](#cardinality-two-all-zero-quota-histograms-dominate).

Workload series also carry `redpanda_topic`, `redpanda_partition` and
`redpanda_namespace`. The namespace splits user topics (`kafka`) from
Redpanda's own (`redpanda/controller`, `kafka_internal/id_allocator`,
`kafka/__consumer_offsets`), so a topic-level sum counts Redpanda's
internal traffic unless it filters `redpanda_namespace="kafka"`.

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` (scrape meta, job `redpanda`) | Whether the admin port answered the scrape. Redpanda exposes no self-reported health gauge on `/public_metrics`, so this carries liveness. `rpk cluster health` is the out-of-band equivalent. |
| `redpanda_kafka_records_produced_total`, `redpanda_kafka_records_fetched_total` | Records written to and read from each topic - the headline throughput KPI, split by `redpanda_topic` and `redpanda_namespace`. Filter to `redpanda_namespace="kafka"` to exclude internal topics. |
| `redpanda_cluster_unavailable_partitions` | Partitions that lack quorum among their replicas. Non-zero means data is unreachable right now. |
| `redpanda_kafka_request_latency_seconds` | Internal latency of produce requests (histogram, by `redpanda_request`) - the producer-facing latency headline. |
| `redpanda_cluster_brokers`, `redpanda_cluster_topics`, `redpanda_cluster_partitions` | Cluster shape. A drop in `brokers` is a node loss; these are the denominators for most ratios below. |
| `redpanda_application_uptime_seconds_total` | Seconds since broker start. A reset identifies a restart that a rate-based view would otherwise smooth over. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `redpanda_kafka_under_replicated_replicas` | Replicas that are live but behind the latest offset, per topic and partition. Sustained non-zero usually precedes an outage. |
| `redpanda_kafka_max_offset` minus `redpanda_kafka_consumer_group_committed_offset`, or `kafka.consumer_group.lag` from the Kafka-protocol receiver | Consumer lag has no metric of its own on the Prometheus surface - see [Consumer lag](#consumer-lag). Growing lag means consumers cannot keep up or have stalled. |
| `redpanda_storage_disk_free_bytes`, `redpanda_storage_disk_total_bytes`, `redpanda_storage_disk_free_space_alert` | Free and total bytes on the data disk, and Redpanda's own three-state alert (0 OK, 1 Low Space, 2 Degraded). The alert gauge is the better signal - it reflects Redpanda's configured thresholds rather than one you pick. `redpanda_storage_cache_disk_*` is the same pair for the tiered-storage cache disk. |
| `redpanda_raft_leadership_changes` | Won leader elections per topic. A steady trickle means partitions are flapping between brokers, usually from network or disk stalls. A burst at cluster bootstrap is expected. |
| `redpanda_rpc_request_errors_total`, `redpanda_rpc_active_connections` | Errors on the internal inter-broker RPC, and live connection count. Internal RPC failures precede partition unavailability. |
| `redpanda_kafka_handler_latency_seconds` | Latency by Kafka handler (`produce`, `fetch`, and the rest). Splits a latency regression by request type where `request_latency_seconds` cannot. |
| `redpanda_cluster_features_enterprise_license_expiry_sec` | Seconds until the Enterprise licence expires. Licensed features stop working at expiry, so alert on this wherever you use them. |
| `redpanda_memory_available_memory`, `redpanda_memory_available_memory_low_water_mark` | Per-shard seastar memory. The low-water mark is the more useful of the two: it records the worst point since start, which a sampled gauge misses. |
| `redpanda_io_queue_disk_queue_length`, `redpanda_io_queue_consumption` | Requests queued in the disk and accumulated capacity units consumed. A per-second increment rate on `consumption` indicates full IO utilization. |
| `redpanda_cluster_partition_moving_from_node`, `_moving_to_node`, `_node_cancelling_movements` | Partition movement in flight. Expected during a rebalance, a problem if it never settles. |
| `redpanda_cluster_controller_log_limit_requests_dropped` | Controller-log requests shed by rate limiting. Non-zero means admin operations are being dropped. |
| `redpanda_schema_registry_request_errors_total`, `redpanda_rest_proxy_request_errors_total` | Errors on the Schema Registry and HTTP Proxy, bucketed by `redpanda_status` (`3xx`/`4xx`/`5xx`). These are the only usable signal for those subsystems - see [Subsystem latency counts successes only](#subsystem-latency-counts-successes-only). Relevant only if you run either endpoint. |

#### Consumer lag

Consumer lag has no metric of its own on the Prometheus surface.
Redpanda exposes the partition high watermark and the group's committed
offset as separate gauges; lag is the subtraction, joined on
`redpanda_topic` and `redpanda_partition`:

```text showLineNumbers title="Consumer lag per group, topic and partition"
redpanda_kafka_max_offset{redpanda_namespace="kafka"}
  - on (redpanda_topic, redpanda_partition) group_right
    redpanda_kafka_consumer_group_committed_offset
```

The `redpanda_kafka_consumer_group_*` families do not emit at all until
a group registers, so an idle cluster reports no committed offsets.

If consumer lag is your main concern, add the `kafka_metrics` receiver
instead of doing this arithmetic - it reports
`kafka.consumer_group.lag` and `kafka.consumer_group.lag_sum` directly,
with `group`, `topic` and `partition` attributes. See
[Collection paths](#collection-paths).

#### Subsystem latency counts successes only

`redpanda_schema_registry_request_latency_seconds_count` and
`redpanda_rest_proxy_request_latency_seconds_count` observe successful
requests only. Failing requests move
`redpanda_schema_registry_request_errors_total` and
`redpanda_rest_proxy_request_errors_total` while the latency counts stay
at zero. Two consequences:

- The latency count is **not** a request-rate metric for these
  subsystems. It undercounts by exactly the error volume.
- A subsystem failing every request shows **zero latency samples**, not
  high latency.

Alert on the error counters for both subsystems. This has not been
established for `redpanda_rpc_request_latency_seconds` (inter-broker
RPC), which has its own `redpanda_rpc_request_errors_total`; do not
assume the same behaviour there without checking.

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity
review. These are grouped families, not individual rows - the counts are
the distinct `redpanda_*` names in each group, 143 in total.

| Family | Count | What it covers |
|---|---|---|
| `redpanda_host_*` | 46 | Host `/proc` disk, netstat and SNMP counters. |
| `redpanda_kafka_*` | 17 | Records produced/fetched, request bytes and latency, handler latency, partitions/replicas, max offset, under-replicated replicas, consumer groups, client quotas, SASL sessions. |
| `redpanda_cluster_*` | 13 | Brokers, topics, partitions, unavailable partitions, partition movement, controller rate limiting, licence expiry, FIPS homogeneity, rack constraint. |
| `redpanda_io_queue_*` | 11 | Seastar IO scheduler config and live queue counters, including `redpanda_io_queue_disk_queue_length` and `_consumption`. |
| `redpanda_raft_*` | 8 | Leadership, recovery and partition-movement bandwidth. |
| `redpanda_schema_registry_*` | 6 | Schema Registry request latency, errors, in-flight ratios, schema cache memory. |
| `redpanda_storage_*` | 6 | Data-disk and cache-disk free/total bytes and alert state. |
| `redpanda_rest_proxy_*` | 5 | HTTP Proxy request latency, errors, in-flight ratios. |
| `redpanda_rpc_*` | 5 | Inter-broker RPC latency, errors, connections, bytes. |
| `redpanda_debug_bundle_*` | 4 | Support-bundle generation counts and timestamps. |
| `redpanda_memory_*` | 4 | Per-shard seastar allocator. |
| `redpanda_reactor_*` | 4 | AIO read/write operations and bytes. |
| `redpanda_application_*` | 3 | Build info, FIPS mode, uptime. |
| `redpanda_node_status_*` | 3 | Peer liveness RPCs sent, received, timed out. |
| `redpanda_network_*` | 2 | Socket bytes sent and received per listener. |
| `redpanda_security_*` | 2 | Audit-log errors and last event timestamp. |
| `redpanda_authorization_result` | 1 | Authorization outcomes by type. |
| `redpanda_cpu_busy_seconds_total` | 1 | Total CPU busy time. |
| `redpanda_instance_info` | 1 | Cloud instance detection. |
| `redpanda_scheduler_runtime_seconds_total` | 1 | Runtime per scheduling group. |

The host block is the largest single group: 40 `diskstats` families plus
netstat and SNMP counters, read from the `/proc` of the host the broker
process runs on, carrying `disk`, `device`, `mountpoint`, `data_disk`
and `cache_disk` labels and a full set of `underlying_` variants. Keep
them. Redpanda is IO-bound, and these are the disk numbers underneath
`redpanda_io_queue_*`.

#### Cardinality: two all-zero quota histograms dominate

`redpanda_kafka_quotas_client_quota_throughput` and
`redpanda_kafka_quotas_client_quota_throttle_time` produce 1,692 of
2,155 series - 78.5% of the scrape - on a single broker with one shard
and no client quotas configured. The count is 12 `redpanda_quota_rule`
values times 3 `redpanda_quota_type` values times buckets times shards,
and every value is zero. They emit unconditionally, and the shard
multiplier means a 16-core broker pays 16 times that. Upstream frames
`/public_metrics` as the low-cardinality endpoint; these two families
are the exception.

If you do not use client quotas, drop them at the scrape - see
[Controlling metric volume](#controlling-metric-volume).

Full metric surface: run
`curl -s http://localhost:9644/public_metrics` against any broker.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
These are starting points; tune them to your workload.

| Metric | Threshold | Why it matters / action |
|---|---|---|
| `redpanda_cluster_unavailable_partitions` | `> 0` for 1m | Partitions without quorum. Data is unreachable now. Check broker liveness and `rpk cluster health`. |
| `redpanda_kafka_under_replicated_replicas` | `> 0` sustained 5m | Replicas live but behind. A broker is struggling on disk or network. |
| `redpanda_kafka_max_offset` - `redpanda_kafka_consumer_group_committed_offset` | Set from your observed baseline; alert on monotonic growth over 15m rather than an absolute | Consumer lag, which has no metric of its own. Growing lag means consumers cannot keep up or have stalled. |
| `redpanda_storage_disk_free_space_alert` | `>= 1` | Redpanda's own three-state disk alert (1 Low Space, 2 Degraded). Prefer this to a free-bytes threshold, because it reflects Redpanda's configured limits. |
| `redpanda_storage_disk_free_bytes / redpanda_storage_disk_total_bytes` | `< 20%` | Secondary disk headroom signal for dashboards, where the alert gauge gives no trend. |
| `rate(redpanda_raft_leadership_changes[15m])` | `> 0` sustained | Partitions flapping between brokers. Usually disk or network stalls, not Raft itself. Ignore the burst at cluster bootstrap. |
| `rate(redpanda_rpc_request_errors_total[5m])` | `> 0` | Internal inter-broker RPC failing. Precedes partition unavailability. |
| `redpanda_cluster_brokers` | `<` expected count | A broker left the cluster. |
| `redpanda_cluster_features_enterprise_license_expiry_sec` | `< 2592000` (30 days) | Licensed features stop working at expiry. Only relevant on clusters using enterprise features. |
| `increase(redpanda_cluster_controller_log_limit_requests_dropped[5m])` | `> 0` | Admin operations being shed by controller rate limiting. |
| `histogram_quantile(0.99, redpanda_kafka_request_latency_seconds)` | Set from your observed baseline | Producer-facing latency. Workload-specific, so take the number from your own traffic rather than a fixed value. |
| `rate(redpanda_schema_registry_request_errors_total{redpanda_status="5xx"}[5m])` | `> 0` | Schema Registry failing. Producers and consumers that resolve schemas fail with it. Its latency histogram records successes only, so alert on the counter. |
| `rate(redpanda_rest_proxy_request_errors_total{redpanda_status="5xx"}[5m])` | `> 0` | HTTP Proxy failing. Its latency histogram also records successes only, so alert on the counter. |

## Access Setup

Redpanda needs **no exporter and no agent**. The broker process serves
the metrics endpoint itself on the admin port. What you set up is
network reach to two ports: `:9644` for the Prometheus scrape and
`:9092` for the Kafka-protocol receiver.

### Collection paths

Two receivers collect from Redpanda. They are complementary, not
alternatives - the metric names they emit do not overlap at all.

| Path | What it covers | What it misses | When to pick it |
| --- | --- | --- | --- |
| **`prometheus` receiver → `:9644/public_metrics`** | All 143 Redpanda-native families: Kafka throughput and latency, cluster and partition health, Raft, storage, seastar reactor and IO queue, host disk and network, Schema Registry and HTTP Proxy. Prefix `redpanda_`. | No ready-made consumer lag - you derive it from two gauges. | Always. This is the base layer and everything in the tiers above comes from it. |
| **`kafka_metrics` receiver → `:9092`** | 11 `kafka.*` families over the Kafka protocol, including `kafka.consumer_group.lag` and `kafka.consumer_group.lag_sum` reported directly with `group`, `topic` and `partition` attributes, plus partition offsets, replica and ISR counts, topic partition counts and broker count. | Everything else. No Raft, no seastar, no storage, no host disk, no Schema Registry. | Add it when consumer lag matters. It is easier than the subtraction, and it is the same receiver the [Kafka](./kafka.md) guide uses. |

Run both receivers in the same pipeline.

### Two endpoints on one port

Port `:9644` serves two Prometheus endpoints with disjoint name sets:

| Endpoint | Prefix | Families | Use |
| --- | --- | --- | --- |
| `/public_metrics` | `redpanda_` | 143 | The endpoint Redpanda documents for monitoring. Scrape this one. |
| `/metrics` | `vectorized_` | 361 | The legacy debugging surface. |

There is no overlap between them: every name on `/public_metrics`
carries the `redpanda_` prefix, and every name on `/metrics` carries
`vectorized_`. Because the `prometheus` receiver defaults
`metrics_path` to `/metrics`, a scrape config that names the port but
not the path lands on the legacy endpoint and collects 361 families that
share no names with this guide.

If you have a reason to scrape `/metrics`, the `aggregate_metrics`
cluster property collapses its per-shard fan-out. It is not the endpoint
to build dashboards or alerts on.

### Expose the ports

In Docker, publish or network-attach the admin and Kafka ports so the
Collector can reach them:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  redpanda-0:
    image: docker.redpanda.com/redpandadata/redpanda:v26.2.2
    ports:
      - "9092:9092"   # Kafka API - kafka_metrics receiver
      - "9644:9644"   # Admin API - serves /public_metrics and /metrics
    healthcheck:
      test: ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true'"]
      interval: 10s
      timeout: 5s
      retries: 30

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./config/otel-collector.yaml:/etc/otel/config.yaml:ro
    depends_on:
      redpanda-0:
        condition: service_healthy
```

Verify both endpoints before wiring the Collector:

```bash showLineNumbers title="Verify access"
# Cluster is up and healthy
rpk cluster health

# The documented metrics endpoint answers and carries the redpanda_ prefix
curl -s http://localhost:9644/public_metrics | grep redpanda_kafka_records_produced_total

# The Kafka API answers
rpk cluster info -X brokers=localhost:9092
```

## Configuration

The `prometheus` receiver scrapes `/public_metrics` and keeps whatever
the endpoint exposes - there is no metric enable list to maintain. The
`kafka_metrics` receiver speaks the Kafka protocol to the broker;
`protocol_version: 2.0.0` negotiates cleanly against Redpanda.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: redpanda
          scrape_interval: 15s
          metrics_path: /public_metrics   # Required - the default is /metrics
          static_configs:
            - targets:
                # One target per broker's admin port
                - ${env:REDPANDA_ADMIN_HOST}:9644

  # Kafka-protocol path: reports consumer lag directly
  kafka_metrics:
    brokers:
      - ${env:REDPANDA_BROKERS}
    protocol_version: 2.0.0
    collection_interval: 15s
    scrapers:
      - brokers
      - topics
      - consumers

processors:
  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus, kafka_metrics]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Use the `kafka_metrics` receiver key and the `otlp_http` exporter key.
Current Collector builds still accept the older `kafkametrics` and
`otlphttp` spellings, but `kafkametrics` logs `"kafkametrics" alias is
deprecated; use "kafka_metrics" instead` at startup.

Each broker is identified by its `instance` label (`host:9644`) on the
Prometheus path.

### Environment Variables

```bash showLineNumbers title=".env"
REDPANDA_ADMIN_HOST=localhost
REDPANDA_BROKERS=localhost:9092
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Controlling metric volume

The two client-quota histograms emit unconditionally and are all zero
unless you configure client quotas. Drop them at the scrape:

```yaml showLineNumbers title="config/otel-collector.yaml (excerpt)"
scrape_configs:
  - job_name: redpanda
    scrape_interval: 15s
    metrics_path: /public_metrics
    static_configs:
      - targets:
          - ${env:REDPANDA_ADMIN_HOST}:9644
    metric_relabel_configs:
      # Drop the client-quota histograms - 78.5% of the series, all zero
      # when no client quotas are configured. Remove this if you use them.
      - source_labels: [__name__]
        regex: 'redpanda_kafka_quotas_client_quota_.*'
        action: drop
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Redpanda metrics
docker logs otel-collector 2>&1 | grep -i "redpanda_"

# Confirm the documented endpoint is serving
curl -s http://localhost:9644/public_metrics | grep redpanda_cluster_brokers

# Confirm the Kafka-protocol path is collecting lag
docker logs otel-collector 2>&1 | grep -i "kafka.consumer_group.lag"
```

In Scout, `up{job="redpanda"}` should read `1`,
`redpanda_cluster_unavailable_partitions` should read `0`, and
`redpanda_kafka_records_produced_total` should climb while producers are
writing. Every name from the Prometheus path starts with `redpanda_`; if
any starts with `vectorized_`, the scrape is on the wrong path.

## Troubleshooting

### Every metric name starts with `vectorized_`

**Cause**: The scrape is hitting `/metrics` on `:9644`, the legacy
debugging endpoint, because `metrics_path` was not set. The
`prometheus` receiver defaults it to `/metrics`.

**Look at**: any scraped name. 361 `vectorized_*` families and zero
`redpanda_*` families is the signature.

**Fix**:

1. Add `metrics_path: /public_metrics` to the scrape config.
2. Restart the Collector and confirm with
   `curl -s http://localhost:9644/public_metrics | head`.
3. Drop or re-label any `vectorized_*` series already ingested, so
   dashboards do not read from both surfaces.

### A metric family from the reference is missing

**Cause**: A family emits only once its feature is in use. The upstream
public-metrics reference lists 234 names; a broker typically emits 143.

**Fix**:

1. Check whether the feature is actually running. Tiered storage and
   cloud storage, archival, data transforms, Iceberg and datalake, and
   cluster linking families are absent until those features are enabled.
2. For `redpanda_kafka_consumer_group_*`, confirm a consumer group has
   registered - those families do not emit at all until one does.
3. Treat absence as expected rather than a scrape failure; confirm the
   scrape itself with `up{job="redpanda"}`.

### The series count is far higher than the family count suggests

**Cause**: The client-quota histograms fan out across quota rules, quota
types, buckets and shards.

**Look at**: the Diagnostic `redpanda_kafka_quotas_*` families -
`_client_quota_throughput` and `_client_quota_throttle_time` account for
roughly four fifths of the series on a single-shard broker and scale
with core count.

**Fix**:

1. Drop them with `metric_relabel_configs` if you do not use client
   quotas - see [Controlling metric volume](#controlling-metric-volume).
2. Remember the `shard` label multiplies every remaining family by core
   count when you size ingest.

### Schema Registry or HTTP Proxy is down but latency looks fine

**Cause**: Those latency histograms observe successful requests only, so
a subsystem failing every request records no latency samples at all.

**Look at**: `redpanda_schema_registry_request_errors_total` and
`redpanda_rest_proxy_request_errors_total`, bucketed by
`redpanda_status`. The Diagnostic `redpanda_schema_registry_*` and
`redpanda_rest_proxy_*` in-flight
ratios show whether requests are arriving at all.

**Fix**:

1. Alert on the error counters, not on latency, for both subsystems.
2. Do not use `request_latency_seconds_count` as a request rate - it
   undercounts by exactly the error volume.

### Topic throughput looks higher than the application accounts for

**Cause**: The sum includes Redpanda's internal namespaces alongside
user topics.

**Look at**: `redpanda_namespace` on the throughput series. Values
include `kafka` for user topics plus `kafka/__consumer_offsets`,
`redpanda/controller` and `kafka_internal/id_allocator`.

**Fix**: filter to `redpanda_namespace="kafka"` in queries, dashboards
and alerts.

### Partitions are unavailable or under-replicated

**Cause**: A broker is down, or a broker is too slow on disk or network
to keep its replicas current.

**Look at**: `redpanda_cluster_unavailable_partitions` and
`redpanda_kafka_under_replicated_replicas` first, then the Diagnostic
families for the cause - `redpanda_node_status_rpcs_timed_out` for peer
liveness, `redpanda_raft_*` recovery gauges for how far behind the
learners are, and `redpanda_io_queue_*` plus the host `diskstats`
families for disk saturation underneath.

**Fix**:

1. Restore the missing broker and confirm with `rpk cluster health`.
2. If all brokers are up, chase IO: a rising
   `redpanda_io_queue_disk_queue_length` with a climbing
   `_consumption` rate means the disk is the constraint.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both receivers and the exporter.

## FAQ

### Why is there no JMX exporter or JVM metrics like Kafka?

Redpanda is a C++/seastar broker, so there is no JVM and no JMX. The
broker process serves Prometheus text itself on the admin port `:9644`
at `/public_metrics`, and you scrape it with the `prometheus` receiver.
There is no JAR to download, no `-javaagent` flag, and no exporter
sidecar. The entire surface is `redpanda_*`, with no `jvm_*`, `go_*` or
`process_*` families.

### Should I scrape `/public_metrics` or `/metrics`?

`/public_metrics`. Both are on `:9644`, but `/metrics` is the legacy
`vectorized_*` debugging surface with 361 families and no names in
common with `/public_metrics`. Set `metrics_path: /public_metrics`
explicitly, because the `prometheus` receiver defaults to `/metrics`.

### How do I get consumer lag?

Two ways. Subtract
`redpanda_kafka_consumer_group_committed_offset` from
`redpanda_kafka_max_offset`, joined on `redpanda_topic` and
`redpanda_partition`. Or add the `kafka_metrics` receiver against
`:9092`, which reports `kafka.consumer_group.lag` and
`kafka.consumer_group.lag_sum` directly with `group`, `topic` and
`partition` attributes. The second is less work and the two receivers
run side by side in one pipeline.

### What is the `shard` label on every metric?

seastar is shard-per-core: each CPU core is one shard with its own
thread, memory and IO queue. A single-core broker emits `shard="0"`; a
multi-core broker emits the same metric once per core. Account for it
when sizing ingest - it multiplies every family, including the
client-quota histograms.

### Does this work with Redpanda in Kubernetes?

Yes. Point the scrape `targets` at each broker's service DNS on `:9644`
with `metrics_path: /public_metrics`, and point `kafka_metrics` at the
Kafka service on `:9092`. The Collector can run as a sidecar or a
Deployment. The metrics endpoint needs no credentials in the default
configuration.

## Related Guides

- [Kafka Monitoring](./kafka.md) - Distributed commit log and
  stream-processing broker; the protocol Redpanda implements, so these
  alert shapes largely port over.
- [Pulsar Monitoring](./pulsar.md) - Multi-tenant messaging and
  streaming platform with tiered storage.
- [NATS Monitoring](./nats.md) - Lightweight messaging system with
  optional JetStream persistence.
- [RabbitMQ Monitoring](./rabbitmq.md) - Traditional message broker for
  queues and routing.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  Redpanda metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for [Kafka](./kafka.md),
  [Pulsar](./pulsar.md), and other messaging components.
- **Fine-tune Collection**: Drop the client-quota histograms with
  `metric_relabel_configs` when you do not configure client quotas.
