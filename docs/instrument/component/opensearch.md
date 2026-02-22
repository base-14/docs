---
title: >
  OpenSearch OpenTelemetry Monitoring — Cluster Health, Search Performance,
  and Collector Setup
sidebar_label: OpenSearch
id: collecting-opensearch-telemetry
sidebar_position: 27
description: >
  Collect OpenSearch metrics with the OpenTelemetry Collector. Monitor
  cluster health, search query latency, and JVM heap usage using the
  Prometheus receiver.
keywords:
  - opensearch opentelemetry
  - opensearch otel collector
  - opensearch metrics monitoring
  - opensearch performance monitoring
  - opentelemetry prometheus receiver opensearch
  - opensearch observability
  - opensearch cluster monitoring
  - opensearch telemetry collection
---

# OpenSearch

OpenSearch exposes Prometheus-format metrics at `/_prometheus/metrics`
when the
[prometheus-exporter plugin](https://github.com/opensearch-project/opensearch-prometheus-exporter)
is installed. The OpenTelemetry Collector scrapes this endpoint using
the Prometheus receiver, collecting 230+ metrics across cluster health,
index and search performance, JVM runtime, OS resources, and storage
I/O. This guide installs the plugin, configures the receiver, and
ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| OpenSearch             | 2.0     | 3.5+        |
| prometheus-exporter    | match   | match       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- OpenSearch HTTP port (9200) must be accessible from the host running
  the Collector
- The prometheus-exporter plugin version must match your OpenSearch
  version exactly (e.g., 3.5.0 needs plugin 3.5.0.0)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cluster Health**: cluster status, node and datanode count, shard
  distribution, pending tasks, disk watermark thresholds
- **Index & Search Performance**: indexing rate, search query and fetch
  latency, merge operations, refresh and flush rates, scroll contexts
- **JVM Runtime**: heap and non-heap memory, GC collection count and
  duration, buffer pools, thread counts, class loading
- **OS & Process**: CPU percent, memory usage, load averages, file
  descriptors, swap usage
- **Storage & I/O**: filesystem capacity, read and write bytes, I/O
  operations, translog size, store size
- **Caches**: query cache hits and misses, request cache evictions,
  fielddata memory and evictions

Full metric list: install the plugin and run
`curl -s http://localhost:9200/_prometheus/metrics | grep "^# TYPE"`
against your OpenSearch instance.

## Access Setup

The prometheus-exporter plugin is not bundled with OpenSearch. Install
it on every node in the cluster:

```bash showLineNumbers title="Install prometheus-exporter plugin"
# Plugin version must match your OpenSearch version exactly
bin/opensearch-plugin install \
  https://github.com/opensearch-project/opensearch-prometheus-exporter/releases/download/3.5.0.0/prometheus-exporter-3.5.0.0.zip
```

Restart the node after installation. Verify the plugin is active:

```bash showLineNumbers title="Verify plugin"
curl -s http://localhost:9200/_cat/plugins | grep prometheus
```

For Docker deployments, build a custom image with the plugin
pre-installed:

```dockerfile showLineNumbers title="Dockerfile"
FROM opensearchproject/opensearch:3.5.0
RUN /usr/share/opensearch/bin/opensearch-plugin install -b \
  https://github.com/opensearch-project/opensearch-prometheus-exporter/releases/download/3.5.0.0/prometheus-exporter-3.5.0.0.zip
```

No authentication is required when the security plugin is disabled.
For secured clusters, see [Authentication](#authentication) below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 30s
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200

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
OPENSEARCH_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For clusters with the security plugin enabled, add basic auth to the
scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (secured)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 30s
          metrics_path: /_prometheus/metrics
          scheme: https
          tls_config:
            insecure_skip_verify: true  # Set false in production with valid certs
          basic_auth:
            username: ${env:OPENSEARCH_USER}
            password: ${env:OPENSEARCH_PASSWORD}
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200
```

Create a read-only monitoring role in OpenSearch Dashboards or via
the API. The monitoring account only needs `cluster:monitor/*`
permissions.

### Filtering Metrics

OpenSearch exposes 230+ metrics including per-index breakdowns. To
collect only cluster-level metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          scrape_interval: 30s
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - ${env:OPENSEARCH_HOST}:9200
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "opensearch_(cluster|indices|jvm|os|process|transport|http)_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "opensearch"

# Verify the metrics endpoint directly
curl -s http://localhost:9200/_prometheus/metrics \
  | grep opensearch_cluster_status

# Check cluster health
curl -s http://localhost:9200/_cluster/health?pretty
```

## Troubleshooting

### Metrics endpoint returns 400 or not found

**Cause**: The prometheus-exporter plugin is not installed or failed
to load.

**Fix**:

1. Check installed plugins:
   `curl -s http://localhost:9200/_cat/plugins`
2. Look for `prometheus-exporter` in the output
3. If missing, install the plugin and restart the node
4. Verify the plugin version matches your OpenSearch version exactly

### Connection refused on port 9200

**Cause**: Collector cannot reach OpenSearch at the configured address.

**Fix**:

1. Verify OpenSearch is running:
   `curl -s http://localhost:9200`
2. For Docker: ensure both containers are on the same network
3. Check firewall rules if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Plugin version mismatch error

**Cause**: The prometheus-exporter plugin version does not match the
OpenSearch version.

**Fix**:

1. Check your OpenSearch version:
   `curl -s http://localhost:9200 | jq .version.number`
2. Download the matching plugin release from
   [GitHub releases](https://github.com/opensearch-project/opensearch-prometheus-exporter/releases)
3. Remove the old plugin and install the correct version

## FAQ

**Does this work with OpenSearch running in Kubernetes?**

Yes. Set `targets` to the OpenSearch service DNS
(e.g., `opensearch-cluster.opensearch.svc.cluster.local:9200`).
The prometheus-exporter plugin must be installed in the container
image — use a custom Dockerfile or an init container. The Collector
can run as a sidecar or DaemonSet.

**How do I monitor an OpenSearch cluster with multiple nodes?**

Add all data and coordinator node endpoints to the scrape config:

```yaml showLineNumbers title="Multi-node scrape"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: opensearch
          metrics_path: /_prometheus/metrics
          static_configs:
            - targets:
                - opensearch-1:9200
                - opensearch-2:9200
                - opensearch-3:9200
```

Each node exposes its own node-level and index-level metrics. Cluster
health metrics are consistent across all nodes.

**What is the difference between `opensearch_index_*` and
`opensearch_indices_*` metrics?**

`opensearch_index_*` metrics are per-index breakdowns with an `index`
label. `opensearch_indices_*` metrics are node-level aggregates across
all indices on that node. For cluster-wide monitoring, the
`opensearch_indices_*` metrics are usually sufficient.

**Can I use this instead of the OpenSearch Dashboards monitoring?**

Yes. The prometheus-exporter plugin provides the same underlying
cluster and node statistics that OpenSearch Dashboards displays. The
OTel Collector approach centralizes metrics alongside your other
infrastructure telemetry in base14 Scout.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Elasticsearch](./elasticsearch.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  cluster health, search latency, and JVM metrics for production
  alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Elasticsearch Monitoring](./elasticsearch.md)
  — Monitor Elasticsearch clusters
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on OpenSearch metrics
