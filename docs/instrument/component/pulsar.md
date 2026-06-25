---
title: >
  Pulsar OpenTelemetry Monitoring - Broker Throughput, Message Backlog,
  and Collector Setup
sidebar_label: Pulsar
id: collecting-pulsar-telemetry
sidebar_position: 31
description: >
  Collect Apache Pulsar metrics with the OpenTelemetry Collector. Monitor
  broker throughput, message backlog, and publish latency via the Prometheus
  receiver, and ship to base14 Scout.
keywords:
  - pulsar opentelemetry
  - pulsar otel collector
  - pulsar metrics monitoring
  - pulsar performance monitoring
  - opentelemetry prometheus receiver pulsar
  - pulsar observability
  - monitor pulsar kubernetes
  - pulsar telemetry collection
---

# Pulsar

Apache Pulsar serves Prometheus text at `/metrics` on its web port (`:8080`).
A standalone process hosts the broker, the BookKeeper managed-ledger storage,
and the functions worker together, and exposes all of their metrics on that one
endpoint. The OpenTelemetry Collector's `prometheus` receiver scrapes it,
collecting 270+ metrics from Pulsar 2.x+ across broker message rate /
throughput / backlog and publish latency, per-topic and per-subscription rates
and backlog, the BookKeeper storage write-latency path, and the JVM runtime.
This guide configures the receiver and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended    |
| ---------------------- | ------- | -------------- |
| Apache Pulsar          | 2.x     | 4.x (4.0.3)    |
| OTel Collector Contrib | 0.90.0  | 0.153.0        |
| base14 Scout           | Any     | -              |

Before starting:

- The Pulsar web port (`8080`) must be reachable from the host running the
  Collector.
- Metrics are enabled by default - no configuration changes are needed on the
  Pulsar side.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

A few things shape this surface, and they matter for every tier below:

- **`up` is the liveness signal here.** The `prometheus` receiver emits `up`
  = 1 when `/metrics` responds - that is the scrape liveness signal.
  `pulsar_health` (Pulsar 4.0.0+) is Pulsar's own broker self health-check
  (1 = healthy), and broker-wide backlog (`pulsar_broker_msg_backlog`) is the
  headline "are consumers keeping up" signal.
- **Standalone collapses several roles into one `/metrics`.** Broker aggregates
  (`pulsar_broker_*`), per-topic series (`pulsar_*` with a `topic` label),
  per-subscription series (`pulsar_subscription_*`), and the BookKeeper
  managed-ledger internals (`pulsar_ml_*`) all come from the same endpoint. A
  real cluster splits these across broker, bookie, and function-worker
  processes - the metric names are identical, so the same scrape config applies
  per process.
- **Two write paths, two latency histograms.**
  `pulsar_broker_publish_latency` is the producer-facing publish latency, while
  `pulsar_storage_write_latency_*` and `pulsar_storage_ledger_write_latency_*`
  are the BookKeeper persistence latencies behind it. Compare them to localize
  a publish slowdown to broker vs storage.
- **Histograms expand into buckets.** The `_le_*` / `_sum` / `_count` families
  are Pulsar's native bucket layout, not OTel exponential histograms; the
  receiver keeps each bucket as its own series.
- **Managed-ledger names keep their case as exposed.**
  `pulsar_ml_AddEntryErrors`, `pulsar_ml_ReadEntriesRate`, and
  `pulsar_ml_StoredMessagesSize` reproduce BookKeeper's camel-case exactly -
  they are not normalized to snake_case.
- **The per-topic, per-subscription, and managed-ledger families warm up under
  traffic.** They populate only after a topic exists and produces / consumes -
  a fresh idle standalone shows mostly broker-level zeros plus the JVM runtime.
  Left enabled, they populate once traffic flows.
- **The JVM / Jetty / Caffeine / process families are the host runtime**, not
  Pulsar product signals: `jvm_*`, `jetty_*`, `caffeine_cache_*`, `process_*`.
  Filter to `pulsar_.*|up` with a keep rule if the runtime is covered
  elsewhere.

### Core - is it up, moving messages, and keeping consumers fed

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 = the Pulsar metrics endpoint responded. The liveness signal on this surface. |
| `pulsar_health` | Broker self health-check result - 1 = healthy (Pulsar 4.0.0+). |
| `pulsar_broker_rate_in` | Broker-wide messages published per second - headline ingest throughput. |
| `pulsar_broker_rate_out` | Broker-wide messages dispatched per second - headline delivery throughput. |
| `pulsar_broker_msg_backlog` | Broker-wide unacked-message backlog - the headline "are consumers keeping up" signal. |
| `pulsar_broker_publish_latency` | Producer-facing publish latency - the write SLO. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Broker throughput | `pulsar_broker_throughput_in`, `pulsar_broker_throughput_out` | Broker-wide inbound / outbound bytes per second. |
| Broker entity counts | `pulsar_broker_topics_count`, `pulsar_broker_subscriptions_count`, `pulsar_broker_producers_count`, `pulsar_broker_consumers_count`, `pulsar_active_connections` | Topics, subscriptions, producers, consumers, and live client connections on the broker. |
| Dispatch backpressure | `pulsar_broker_pending_bytes_to_dispatch`, `pulsar_broker_throttled_connections` | Bytes queued for dispatch and connections being throttled - producers hitting rate limits. |
| Lookup path | `pulsar_broker_lookup_failures_total`, `pulsar_broker_lookup_pending_requests`, `pulsar_broker_topic_load_pending_requests` | Failed topic lookups, lookups in flight, and queued topic-load requests. |
| Broker storage | `pulsar_broker_storage_size`, `pulsar_broker_storage_write_rate`, `pulsar_broker_storage_read_rate`, `pulsar_broker_storage_read_cache_misses_rate`, `pulsar_broker_storage_backlog_quota_exceeded_evictions_total` | Stored size, write / read rates, read-cache misses, and messages evicted by quota policy (data loss). |
| Per-topic rate / throughput | `pulsar_rate_in`, `pulsar_rate_out`, `pulsar_throughput_in`, `pulsar_throughput_out`, `pulsar_publish_rate_limit_times` | Per-topic publish / dispatch message rate, bytes per second, and rate-limit hits. |
| Per-topic backlog | `pulsar_msg_backlog`, `pulsar_storage_backlog_size`, `pulsar_storage_backlog_age_seconds`, `pulsar_storage_backlog_quota_limit` | Per-topic unacked backlog, backlog bytes, age of the oldest unacked message, and the configured quota. |
| Storage write latency | `pulsar_storage_write_latency_sum`, `pulsar_storage_write_latency_count`, `pulsar_storage_write_latency_le_*` | Per-topic persistence write-latency distribution - the storage write SLO behind a publish. |
| Per-subscription health | `pulsar_subscription_back_log`, `pulsar_subscription_unacked_messages`, `pulsar_subscription_blocked_on_unacked_messages`, `pulsar_subscription_msg_rate_redeliver`, `pulsar_subscription_msg_drop_rate`, `pulsar_subscription_msg_rate_out` | Per-subscription backlog, unacked count, the blocked flag, redelivery and drop rate, and dispatch rate. |
| Write errors | `pulsar_ml_AddEntryErrors`, `pulsar_ml_ReadEntriesErrors` | Managed-ledger entry-write / read errors - the BookKeeper path is failing. |
| Topic load / metadata | `pulsar_topic_load_failed_count`, `pulsar_metadata_store_ops_latency_ms` | Failed topic loads and metadata-store (ZooKeeper / RocksDB) operation latency - slow metadata stalls topic ops cluster-wide. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity review.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Per-topic detail | `pulsar_average_msg_size`, `pulsar_in_bytes_total`, `pulsar_out_bytes_total`, `pulsar_in_messages_total`, `pulsar_out_messages_total`, `pulsar_storage_logical_size`, `pulsar_storage_offloaded_size`, `pulsar_storage_write_rate`, `pulsar_delayed_message_index_size_bytes` | Per-topic byte / message totals, logical and offloaded storage size, and delayed-delivery index size. |
| Entry-size / ledger-write histograms | `pulsar_entry_size_sum` / `_count` / `_le_*`, `pulsar_storage_ledger_write_latency_sum` / `_count` / `_le_*` | The message-entry size distribution and the BookKeeper ledger write latency behind the topic write path. |
| Per-namespace counts | `pulsar_producers_count`, `pulsar_consumers_count`, `pulsar_subscriptions_count`, `pulsar_topics_count` | Per-namespace producer / consumer / subscription / topic accounting. |
| Per-subscription detail | `pulsar_subscription_consumers_count`, `pulsar_subscription_msg_ack_rate`, `pulsar_subscription_msg_throughput_out`, `pulsar_subscription_msg_rate_expired`, `pulsar_subscription_delayed`, `pulsar_subscription_in_replay` | Consumer count, ack rate, outbound throughput, TTL expiry, and delayed / replay detail on a subscription. |
| Subscription progress timestamps | `pulsar_subscription_last_acked_timestamp`, `pulsar_subscription_last_consumed_timestamp`, `pulsar_subscription_last_mark_delete_advanced_timestamp` | A stalled timestamp marks a stuck consumer. |
| Subscription server-side filters | `pulsar_subscription_filter_accepted_msg_count`, `pulsar_subscription_filter_rejected_msg_count`, `pulsar_subscription_filter_rescheduled_msg_count` | Outcomes when a subscription has a server-side selector attached. |
| Managed-ledger internals | `pulsar_ml_AddEntryBytesRate`, `pulsar_ml_ReadEntriesRate`, `pulsar_ml_StoredMessagesSize`, `pulsar_ml_NumberOfMessagesInBacklog`, `pulsar_ml_MarkDeleteRate`, `pulsar_ml_cache_*`, `pulsar_ml_AddEntryLatencyBuckets`, `pulsar_ml_LedgerSwitchLatencyBuckets` | BookKeeper add / read rates, stored size, mark-delete rate, the read cache, and the latency bucket layouts. |
| Schema registry / topic load | `pulsar_schema_get_ops_latency`, `pulsar_schema_put_ops_latency`, `pulsar_topic_load_rate_s`, `pulsar_topic_load_times`, `pulsar_topic_load_time_*_ms` | Schema read / write latency and topic-load rate / time percentiles. |
| Transactions / resource groups | `pulsar_txn_tb_active_total`, `pulsar_txn_tb_committed_total`, `pulsar_txn_tb_aborted_total`, `pulsar_resource_group_aggregate_usage_secs`, `pulsar_resource_group_calculate_quota_secs` | Transaction-buffer counts and resource-group usage / quota timings. |
| Functions worker | `pulsar_function_worker_*` | Functions-worker scheduling, rebalance, instance-count, and leader state. |
| Web thread pool | `pulsar_web_executor_active_threads`, `pulsar_web_executor_idle_threads`, `pulsar_web_executor_max_threads` | Web / admin thread-pool sizing. |
| JVM / Jetty / Caffeine / process runtime | `jvm_memory_bytes_used`, `jvm_memory_direct_bytes_used`, `jvm_gc_collection_seconds`, `jvm_threads_current`, `jetty_*`, `caffeine_cache_*`, `process_cpu_seconds_total`, `process_resident_memory_bytes`, `log4j2_appender_total` | Host runtime - heap, off-heap direct memory, GC, threads, the admin HTTP server, in-process caches, and OS process stats. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped` | Receiver-side scrape health, not from Pulsar. |

Full metric list: run `curl -s http://localhost:8080/metrics` against your
Pulsar broker.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload.

| Metric | Threshold | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The metrics endpoint stopped responding - check the broker process and the web port. |
| `pulsar_health` | `< 1` | The broker self health-check is failing (Pulsar 4.0.0+) - check BookKeeper and the metadata store. |
| `pulsar_broker_msg_backlog` / `pulsar_storage_backlog_age_seconds` | Backlog rising vs baseline, or age climbing | Consumers are not keeping up - scale consumers or investigate slow processing. |
| `pulsar_subscription_blocked_on_unacked_messages` | `== 1` | A subscription hit its unacked-message limit - consumers are not acking; check consumer health. |
| `pulsar_subscription_msg_rate_redeliver` | Rising vs baseline | Consumers are failing to ack and messages are being redelivered - check consumer errors and ack timeout. |
| `pulsar_ml_AddEntryErrors` | `> 0` | The BookKeeper write path is failing - check bookie health and disk. |
| `pulsar_broker_publish_latency` / `pulsar_storage_write_latency_*` | p99 rising vs baseline | Writes are slow - compare broker vs storage latency to localize. |
| `rate(pulsar_broker_storage_backlog_quota_exceeded_evictions_total)` | `> 0` | Messages are being evicted by quota policy (data loss) - raise the quota or drain the backlog. |
| `rate(pulsar_broker_lookup_failures_total)` | `> 0` | Clients cannot resolve topic ownership - check the metadata store and broker load. |
| `pulsar_metadata_store_ops_latency_ms` | p99 rising vs baseline | Slow metadata operations stall topic load / unload cluster-wide - check ZooKeeper / RocksDB. |

The liveness, health, blocked-flag, and error / eviction alerts read states or
events; the latency and backlog alerts are relative to your own baseline. Set
absolute thresholds only against your own workload and provisioned capacity.

## Access Setup

Pulsar exposes Prometheus metrics natively - no exporter sidecar is needed. The
`/metrics` endpoint on the web port (`8080`) is unauthenticated by default.

Bring up a standalone instance, which runs the broker, BookKeeper storage, and
functions worker in one process:

```bash showLineNumbers title="Run Pulsar standalone"
docker run -d --name pulsar \
  -p 6650:6650 -p 8080:8080 \
  apachepulsar/pulsar:4.0.3 \
  bin/pulsar standalone
```

Verify the metrics endpoint is serving:

```bash showLineNumbers title="Verify access"
# Confirm the broker is healthy
curl -s http://localhost:8080/admin/v2/brokers/health

# Confirm the Prometheus endpoint responds
curl -s http://localhost:8080/metrics | head -20
```

A secured production cluster fronts the web port with TLS and authentication.
When metrics are behind auth, point the scrape job at `https` and supply the
broker's credentials to the receiver; restrict the endpoint at the network
layer either way.

## Configuration

The recommended config scrapes Pulsar's `/metrics` and keeps only the Pulsar
series with a `metric_relabel_configs` keep filter, dropping the JVM / Jetty /
Caffeine runtime noise the endpoint also emits:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:PULSAR_HOST}:8080   # Pulsar web port; default /metrics
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "pulsar_.*|up"
              action: keep

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
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
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

The keep filter scopes collection to the `pulsar_*` product families plus the
`up` liveness series, and drops the `jvm_*` / `jetty_*` / `caffeine_cache_*` /
`process_*` host-runtime series. Remove the filter if you want the runtime in
Scout too.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable in v1.41.0). Scout's UI filters
> on the lowercase `environment` key, so emit it alongside the OTel-native
> `deployment.environment.name`. The legacy `deployment.environment` is still
> accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
PULSAR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Pulsar metrics
docker logs otel-collector 2>&1 | grep -i "pulsar"

# Confirm the broker health metric is exposed
curl -s http://localhost:8080/metrics | grep pulsar_health

# Confirm broker throughput is exposed
curl -s http://localhost:8080/metrics | grep pulsar_broker_rate_in
```

## Troubleshooting

### Connection refused on port 8080

**Cause**: The Collector cannot reach the Pulsar web endpoint.

**Fix**:

1. Verify Pulsar is running: `docker ps | grep pulsar` or
   `bin/pulsar-admin brokers list`.
2. Confirm the web port is open: `curl http://localhost:8080/metrics`.
3. Check firewall rules if the Collector runs on a separate host.

### Only broker-level metrics appear

**Cause**: There is no topic with traffic yet. The per-topic
(`pulsar_*` with a `topic` label), per-subscription (`pulsar_subscription_*`),
and managed-ledger (`pulsar_ml_*`) families populate only once a topic exists
and produces / consumes.

**Look at**: the broker-level series first - if `pulsar_broker_*` populates but
the per-topic / per-subscription / `pulsar_ml_*` families read 0 or are absent,
the broker is healthy and simply idle.

**Fix**:

1. Create a topic and produce a test message:
   `bin/pulsar-client produce persistent://public/default/test -m "hello"`.
2. Run a consumer so the subscription and managed-ledger families advance.
3. Re-check: `curl -s http://localhost:8080/metrics | grep pulsar_subscription`.

### Publish latency is high

**Cause**: Writes are slow, either at the broker or in BookKeeper storage.

**Look at**: `pulsar_broker_publish_latency` against the storage latencies -
`pulsar_storage_write_latency_*` and the Diagnostic
`pulsar_storage_ledger_write_latency_*`. If the storage latency tracks the
publish latency, the bottleneck is BookKeeper; if not, it is broker-side.
Check `pulsar_ml_AddEntryErrors` for write-path failures.

**Fix**:

1. Inspect bookie health and disk if storage latency is climbing.
2. Check broker CPU and `jvm_gc_collection_seconds` if the broker side is slow.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Pulsar running in Kubernetes?**

Yes. Set the Collector's `targets` to the broker's web-port service DNS
(e.g., `pulsar-broker.pulsar.svc.cluster.local:8080`). With the Apache Pulsar
Helm chart the broker web port is exposed by default. The Collector can run as
a sidecar or a DaemonSet.

**What is the difference between standalone and a cluster for monitoring?**

Standalone runs the broker, BookKeeper bookie, and functions worker in one
process, so all metrics come from one `/metrics`. A production cluster splits
those roles across separate processes - the metric names are the same, so add
a scrape job per broker, bookie, and function-worker endpoint:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar-broker
          static_configs:
            - targets:
                - broker-1:8080
                - broker-2:8080
        - job_name: pulsar-bookie
          static_configs:
            - targets:
                - bookie-1:8000
                - bookie-2:8000
        - job_name: pulsar-function-worker
          static_configs:
            - targets:
                - fn-worker-1:6750
```

Each process is scraped independently and identified by its `instance` label.

**Why do I only see broker-level metrics?**

The per-topic, per-subscription, and managed-ledger families populate only once
a topic exists and has active producers or consumers. An idle standalone shows
mostly broker-level zeros plus the JVM runtime. Produce and consume on a topic
to advance them.

**Why are the `pulsar_ml_*` metrics in camel-case?**

The BookKeeper managed-ledger family (`pulsar_ml_AddEntryErrors`,
`pulsar_ml_ReadEntriesRate`, `pulsar_ml_StoredMessagesSize`, and the rest) keeps
BookKeeper's camel-case by design. The `prometheus` receiver reproduces the name
exactly as exposed and does not normalize it to snake_case.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Pulsar metrics.
- [Kafka Monitoring](./kafka.md) - Consumer lag and partition offsets for
  another high-throughput streaming broker.
- [RabbitMQ Monitoring](./rabbitmq.md) - Queue depth and consumer health for a
  classic message queue.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md), [RabbitMQ](./rabbitmq.md), and other components.
- **Fine-tune Collection**: The Diagnostic tier is higher cardinality. You can
  scope its collection with `metric_relabel_configs` if you need to, and reach
  for it during incident investigation.
