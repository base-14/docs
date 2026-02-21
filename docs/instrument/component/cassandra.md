---
title: >
  Cassandra OpenTelemetry Monitoring — Client Requests, Compaction,
  and Collector Setup
sidebar_label: Cassandra
id: collecting-cassandra-telemetry
sidebar_position: 21
description: >
  Collect Cassandra metrics with the OpenTelemetry Collector. Monitor
  client request latency, compaction, and storage load using the
  Prometheus JMX exporter and export to base14 Scout.
keywords:
  - cassandra opentelemetry
  - cassandra otel collector
  - cassandra metrics monitoring
  - cassandra performance monitoring
  - opentelemetry prometheus receiver cassandra
  - cassandra observability
  - cassandra database monitoring
  - cassandra telemetry collection
---

# Cassandra

Cassandra exposes metrics via JMX (Java Management Extensions). The
Prometheus JMX exporter runs as a Java agent inside the Cassandra
JVM, converting JMX MBeans into Prometheus-format metrics at a
configurable HTTP endpoint. The OpenTelemetry Collector scrapes this
endpoint using the Prometheus receiver, collecting 250+ metrics
across client requests, compaction, storage, caches, thread pools,
and JVM health. This guide configures the exporter agent, sets up
the Collector, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Cassandra              | 3.11    | 5.0+        |
| JMX Exporter           | 0.20.0  | 1.5.0+      |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Download the
  [Prometheus JMX exporter](https://github.com/prometheus/jmx_exporter/releases)
  Java agent JAR
- The JMX exporter port (e.g., 9404) must be accessible from the
  host running the Collector
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Client Requests**: read, write, and range scan latency,
  timeouts, failures, unavailables, tombstone aborts
- **Compaction**: pending and completed tasks, bytes compacted,
  aborted compactions
- **Storage**: disk load, total hints, storage exceptions,
  uncompressed load
- **Caches**: key cache and row cache hit rates, capacity, size,
  entries
- **Thread Pools**: active tasks, pending tasks, blocked tasks,
  completed tasks by pool
- **JVM**: heap and non-heap memory, GC collection time and count,
  thread states, buffer pools

Full metric list: run
`curl -s http://localhost:9404/metrics` against your Cassandra
instance with the JMX exporter agent loaded.

## Access Setup

The Prometheus JMX exporter runs as a Java agent inside the
Cassandra process. No authentication is required — the agent reads
JMX MBeans directly from within the JVM.

### 1. Download the JMX Exporter Agent

```bash showLineNumbers title="Verify access"
# Download the latest JMX exporter agent JAR
curl -L -o jmx_prometheus_javaagent.jar \
  https://github.com/prometheus/jmx_exporter/releases/download/1.5.0/jmx_prometheus_javaagent-1.5.0.jar
```

### 2. Create the Exporter Configuration

The JMX exporter uses pattern rules to select and rename MBeans
into Prometheus metrics:

```yaml showLineNumbers title="jmx-config.yaml"
lowercaseOutputLabelNames: true
lowercaseOutputName: true
rules:
  # Client request metrics
  - pattern: org.apache.cassandra.metrics<type=ClientRequest, scope=(.*), name=(.*)><>(Count|OneMinuteRate|Mean|95thPercentile|99thPercentile)
    name: cassandra_clientrequest_$2
    labels:
      scope: $1
    type: GAUGE

  # Table metrics
  - pattern: org.apache.cassandra.metrics<type=Table, keyspace=(.*), scope=(.*), name=(.*)><>(Count|Value|Mean|95thPercentile|99thPercentile)
    name: cassandra_table_$3
    labels:
      keyspace: $1
      table: $2
    type: GAUGE

  # Keyspace metrics
  - pattern: org.apache.cassandra.metrics<type=Keyspace, keyspace=(.*), name=(.*)><>(Count|Value)
    name: cassandra_keyspace_$2
    labels:
      keyspace: $1
    type: GAUGE

  # ThreadPool metrics
  - pattern: org.apache.cassandra.metrics<type=ThreadPools, path=(.*), scope=(.*), name=(.*)><>(Count|Value)
    name: cassandra_threadpool_$3
    labels:
      path: $1
      pool: $2
    type: GAUGE

  # Storage metrics
  - pattern: org.apache.cassandra.metrics<type=Storage, name=(.*)><>(Count|Value)
    name: cassandra_storage_$1
    type: GAUGE

  # Compaction metrics
  - pattern: org.apache.cassandra.metrics<type=Compaction, name=(.*)><>(Count|Value)
    name: cassandra_compaction_$1
    type: GAUGE

  # CommitLog metrics
  - pattern: org.apache.cassandra.metrics<type=CommitLog, name=(.*)><>(Count|Value)
    name: cassandra_commitlog_$1
    type: GAUGE

  # Cache metrics
  - pattern: org.apache.cassandra.metrics<type=Cache, scope=(.*), name=(.*)><>(Count|Value)
    name: cassandra_cache_$2
    labels:
      cache: $1
    type: GAUGE

  # DroppedMessage metrics
  - pattern: org.apache.cassandra.metrics<type=DroppedMessage, scope=(.*), name=(.*)><>(Count)
    name: cassandra_droppedmessage_$2
    labels:
      scope: $1
    type: GAUGE
```

### 3. Add the Agent to Cassandra

Add the JMX exporter as a Java agent in `cassandra-env.sh`:

```bash showLineNumbers title="cassandra-env.sh"
JVM_OPTS="$JVM_OPTS -javaagent:/path/to/jmx_prometheus_javaagent.jar=9404:/path/to/jmx-config.yaml"
```

For Docker deployments, mount the JAR and config into the container
and set the `JVM_EXTRA_OPTS` environment variable:

```bash showLineNumbers title="Verify access"
JVM_EXTRA_OPTS="-javaagent:/opt/jmx_prometheus_javaagent.jar=9404:/opt/jmx-config.yaml"
```

Verify the metrics endpoint:

```bash showLineNumbers title="Verify access"
# Check Prometheus metrics are exposed
curl -s http://localhost:9404/metrics | head -20

# Verify Cassandra-specific metrics
curl -s http://localhost:9404/metrics \
  | grep cassandra_clientrequest_latency
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CASSANDRA_HOST}:9404

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
CASSANDRA_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

Cassandra exposes 250+ metrics including per-table and per-keyspace
breakdowns. To reduce volume, filter to the most important metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CASSANDRA_HOST}:9404
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "cassandra_clientrequest_.*|cassandra_compaction_.*|cassandra_storage_.*|cassandra_cache_.*|cassandra_threadpool_.*|cassandra_commitlog_.*|cassandra_droppedmessage_.*"
              action: keep
```

This excludes per-table and per-keyspace metrics which can produce
high cardinality in large clusters.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "cassandra"

# Verify Cassandra is running
cqlsh -e "describe cluster"

# Check metrics endpoint directly
curl -s http://localhost:9404/metrics \
  | grep cassandra_storage_load
```

## Troubleshooting

### Metrics endpoint not responding on port 9404

**Cause**: The JMX exporter agent is not loaded or the port is
wrong.

**Fix**:

1. Verify the `-javaagent` flag is in the Cassandra JVM options:
   `ps aux | grep javaagent`
2. Confirm the port number matches between the agent config and the
   Collector scrape target
3. Check Cassandra logs for agent startup errors

### Only JVM metrics appear, no Cassandra metrics

**Cause**: The JMX exporter config rules don't match Cassandra
MBeans.

**Fix**:

1. Verify `jmx-config.yaml` contains Cassandra-specific patterns
   (e.g., `org.apache.cassandra.metrics`)
2. Check for typos in the pattern regex
3. Test with an empty rules config — the exporter will export all
   MBeans as untyped metrics

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### High metric cardinality

**Cause**: Per-table metrics create many time series in clusters
with hundreds of tables.

**Fix**:

1. Use `metric_relabel_configs` to drop per-table metrics
   (`cassandra_table_*`) and keep only keyspace-level aggregates
2. Exclude system keyspaces by adding a relabel rule filtering on
   the `keyspace` label
3. Adjust JMX exporter `blacklist` rules to skip specific MBean
   patterns at the source

## FAQ

**Does this work with Cassandra running in Kubernetes?**

Yes. Mount the JMX exporter JAR and config into the Cassandra pod
via a ConfigMap or init container. Set `targets` to the Cassandra
service DNS
(e.g., `cassandra-0.cassandra.default.svc.cluster.local:9404`). The
Collector can run as a sidecar or DaemonSet.

**How do I monitor a multi-node Cassandra cluster?**

Each Cassandra node runs its own JMX exporter agent. Add all node
endpoints to the scrape config:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          static_configs:
            - targets:
                - cassandra-1:9404
                - cassandra-2:9404
                - cassandra-3:9404
```

Each node is scraped independently and identified by its `instance`
label.

**Why use the JMX exporter instead of the OTel JMX receiver?**

The OTel JMX receiver was deprecated in January 2026. It required a
JRE inside the Collector container and only collected a limited set
of Cassandra metrics. The Prometheus JMX exporter runs inside
Cassandra's JVM, requires no external JRE, and exposes the full set
of Cassandra MBeans.

**What is the performance impact of the JMX exporter agent?**

The JMX exporter reads MBeans locally within the JVM, avoiding the
overhead of remote JMX connections. The impact is minimal for 30s
scrape intervals. For large clusters with many tables, use
`blacklist` rules in the exporter config to skip high-cardinality
MBeans.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use JMX exporter `blacklist` rules and
  Collector `metric_relabel_configs` to control cardinality

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [MongoDB Monitoring](./mongodb.md)
  — NoSQL database monitoring
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Cassandra metrics
