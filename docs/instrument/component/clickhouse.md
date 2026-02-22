---
title: >
  ClickHouse OpenTelemetry Monitoring — Query Performance, Merges,
  and Collector Setup
sidebar_label: ClickHouse
id: collecting-clickhouse-telemetry
sidebar_position: 22
description: >
  Collect ClickHouse metrics with the OpenTelemetry Collector. Monitor
  query performance, merge operations, and memory usage. Export to
  base14 Scout.
keywords:
  - clickhouse opentelemetry
  - clickhouse otel collector
  - clickhouse metrics monitoring
  - clickhouse performance monitoring
  - opentelemetry prometheus receiver clickhouse
  - clickhouse observability
  - clickhouse analytics monitoring
  - clickhouse telemetry collection
---

# ClickHouse

ClickHouse exposes Prometheus-format metrics at a configurable HTTP
endpoint (default `:9363/metrics`) when the `<prometheus>` section is
enabled in the server configuration. The OpenTelemetry Collector
scrapes this endpoint using the Prometheus receiver, collecting 3000+
metrics across query performance, merge operations, connections,
memory allocation, disk I/O, and replication. This guide configures
the receiver, enables the metrics endpoint, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| ClickHouse             | 22.x    | 24.x+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- ClickHouse Prometheus port (9363) must be accessible from the host
  running the Collector
- The `<prometheus>` config section must be enabled (not enabled by
  default in all installations)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Queries**: select, insert, and failed query counts, query
  duration, queries in progress, queries with subqueries
- **Merges & Parts**: active merges, merged rows and bytes, merge
  duration, part count per partition, mutations
- **Connections**: HTTP, TCP, MySQL protocol, and interserver
  connections, rejected connections
- **Memory & Allocator**: resident memory, virtual memory, jemalloc
  allocation, cache sizes, memory tracking
- **Disk & I/O**: disk usage, read/write bytes, filesystem available
  space, block device I/O
- **Background Pools**: merge and mutation pool tasks, schedule pool
  size, distributed pool, buffer flush pool

Full metric list: run
`curl -s http://localhost:9363/metrics` against your ClickHouse
instance with the Prometheus endpoint enabled.

## Access Setup

Enable the Prometheus metrics endpoint by adding a `<prometheus>`
section to the ClickHouse server configuration. Create a config
override file:

```xml showLineNumbers title="config.d/prometheus.xml"
<clickhouse>
    <prometheus>
        <endpoint>/metrics</endpoint>
        <port>9363</port>
        <metrics>true</metrics>
        <events>true</events>
        <asynchronous_metrics>true</asynchronous_metrics>
        <status_info>true</status_info>
    </prometheus>
</clickhouse>
```

- `metrics` — current server gauges (connections, active queries,
  merge pool tasks)
- `events` — profile event counters (queries executed, bytes
  read/written, merge operations)
- `asynchronous_metrics` — periodically updated system metrics
  (memory, CPU, disk, uptime)
- `status_info` — server version and uptime info

For Docker deployments, mount this file into
`/etc/clickhouse-server/config.d/`.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check ClickHouse is running
curl -s http://localhost:8123/ping

# Verify Prometheus metrics endpoint
curl -s http://localhost:9363/metrics | head -20
```

No authentication is required on the Prometheus endpoint by default.
Use network-level access controls (firewall, network policies) to
restrict access to port 9363 in production.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CLICKHOUSE_HOST}:9363

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

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
CLICKHOUSE_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

ClickHouse exposes 3000+ metrics including per-device block I/O and
extensive error counters. To reduce volume, filter to the most
important metric categories:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CLICKHOUSE_HOST}:9363
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "ClickHouseProfileEvents_(Query|SelectQuery|InsertQuery|FailedQuery|FailedSelectQuery|FailedInsertQuery|InsertedRows|InsertedBytes|MergedRows|MergedUncompressedBytes|Merge|ReadCompressedBytes|CompressedReadBufferBytes).*|ClickHouseMetrics_(Query|Merge|HTTPConnection|TCPConnection|BackgroundMergesAndMutationsPoolTask|DelayedInserts|GlobalThread|GlobalThreadActive).*|ClickHouseAsyncMetrics_(MemoryResident|MemoryVirtual|Uptime|MaxPartCountForPartition|NumberOfDatabases|NumberOfTables|DiskUsed.*|jemalloc_resident).*"
              action: keep
```

This keeps query performance, merge operations, connections, memory,
and disk metrics while excluding per-device block I/O and error
counters.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "clickhouse"

# Verify ClickHouse is running
curl -s http://localhost:8123/ping

# Check metrics endpoint directly
curl -s http://localhost:9363/metrics \
  | grep ClickHouseMetrics_Query
```

## Troubleshooting

### Metrics endpoint not responding on port 9363

**Cause**: The `<prometheus>` section is not enabled in the ClickHouse
server configuration.

**Fix**:

1. Add a config override file to `config.d/` with the `<prometheus>`
   block (see Access Setup above)
2. Restart ClickHouse: `systemctl restart clickhouse-server` or
   `docker restart clickhouse`
3. Verify: `curl http://localhost:9363/metrics`

### Only partial metrics appear

**Cause**: One or more metric types are disabled in the `<prometheus>`
config.

**Fix**:

1. Ensure all four flags are set to `true`: `metrics`, `events`,
   `asynchronous_metrics`, `status_info`
2. Restart ClickHouse after changing the config
3. Check the metric count:
   `curl -s http://localhost:9363/metrics | grep "^# TYPE" | wc -l`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### High cardinality from per-device metrics

**Cause**: ClickHouse exposes block device I/O metrics per device
(e.g., `BlockReadBytes_vda`, `BlockWriteBytes_nbd0`), creating many
time series on hosts with many devices.

**Fix**:

1. Use `metric_relabel_configs` to drop per-device metrics (see
   Filtering Metrics above)
2. Keep only aggregate async metrics like `MemoryResident` and
   `DiskUsed`
3. For disk monitoring, rely on `DiskAvailable` and `DiskUsed` which
   report per configured ClickHouse disk, not per block device

## FAQ

**Does this work with ClickHouse running in Kubernetes?**

Yes. Set `targets` to the ClickHouse pod or service DNS
(e.g., `clickhouse-0.clickhouse.default.svc.cluster.local:9363`).
Mount the Prometheus config override via a ConfigMap into
`/etc/clickhouse-server/config.d/`. The Collector can run as a
sidecar or DaemonSet.

**How do I monitor a ClickHouse cluster with multiple shards?**

Each ClickHouse node exposes its own Prometheus endpoint. Add all node
endpoints to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: clickhouse
          static_configs:
            - targets:
                - clickhouse-shard1-replica1:9363
                - clickhouse-shard1-replica2:9363
                - clickhouse-shard2-replica1:9363
```

Each node is scraped independently and identified by its `instance`
label.

**What are the four metric categories?**

ClickHouse exposes metrics in four groups: `ClickHouseMetrics`
(current gauges like active queries and connections),
`ClickHouseProfileEvents` (cumulative counters for operations
performed), `ClickHouseAsyncMetrics` (periodically sampled system
metrics like memory and disk), and `ClickHouseErrorMetric` (counters
for specific error codes). Enable all four via the `<prometheus>`
config for complete visibility.

**Why are replication metrics missing?**

Replication metrics only appear when ClickHouse is configured with
ReplicatedMergeTree tables and a ZooKeeper or ClickHouse Keeper
backend. Standalone instances without replicated tables do not emit
replication metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Kafka](./kafka.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  query performance and merge operations for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on ClickHouse metrics
- [Kafka Monitoring](./kafka.md)
  — Message queue monitoring
