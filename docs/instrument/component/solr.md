---
title: >
  Solr OpenTelemetry Monitoring — JVM, Request Rates,
  and Collector Setup
sidebar_label: Solr
id: collecting-solr-telemetry
sidebar_position: 17
description: >
  Collect Solr metrics with the OpenTelemetry Collector. Monitor JVM
  heap, request rates, and core status using the Prometheus receiver
  and export to base14 Scout.
keywords:
  - solr opentelemetry
  - solr otel collector
  - solr metrics monitoring
  - solr performance monitoring
  - opentelemetry prometheus receiver solr
  - solr observability
  - solr search monitoring
  - solr telemetry collection
---

# Solr

Solr exposes Prometheus-format metrics at
`/solr/admin/metrics?wt=prometheus`. The OpenTelemetry Collector
scrapes this endpoint using the Prometheus receiver, collecting
17+ metrics across JVM heap and GC statistics, HTTP request rates,
thread pool activity, and core status. This guide configures the
receiver, connects to a Solr node, and ships metrics to base14
Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Solr                   | 7.x     | 9.x+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Solr HTTP port (8983) must be accessible from the host running
  the Collector
- The `/admin/metrics` endpoint is enabled by default
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **HTTP (Jetty)**: dispatches, requests by method, responses by
  status code class
- **JVM**: heap and non-heap memory, GC count and time, thread
  counts by state, buffer pools, memory pool details
- **OS**: CPU load, memory usage, file descriptors
- **Node**: connections, core counts, filesystem space, request
  counts by handler, request time, thread pool tasks

Full metric list: run
`curl -s http://localhost:8983/solr/admin/metrics?wt=prometheus`
against your Solr instance.

## Access Setup

Verify your Solr instance is accessible:

```bash showLineNumbers title="Verify access"
# Check Solr status
curl -s http://localhost:8983/solr/admin/info/system | head -20

# List cores
curl -s http://localhost:8983/solr/admin/cores

# Verify Prometheus metrics endpoint
curl -s 'http://localhost:8983/solr/admin/metrics?wt=prometheus' \
  | head -20
```

No authentication is required by default. For clusters with
authentication enabled, see [Authentication](#authentication)
below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          scrape_interval: 30s
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983

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
SOLR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For Solr clusters with Basic Authentication enabled:

```yaml showLineNumbers title="config/otel-collector.yaml (auth)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
          basic_auth:
            username: ${env:SOLR_USERNAME}
            password: ${env:SOLR_PASSWORD}
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983
```

### Filtering Metrics

To collect only specific metric groups, use Solr's `group`
parameter:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
            group: [jvm, node, jetty]
          static_configs:
            - targets:
                - ${env:SOLR_HOST}:8983
```

Available groups: `jvm`, `jetty`, `node`, `core`, `overseer`.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "solr"

# Verify Solr is running
curl -s http://localhost:8983/solr/admin/info/system \
  | grep -i "status"

# Check metrics endpoint directly
curl -s 'http://localhost:8983/solr/admin/metrics?wt=prometheus' \
  | grep solr_metrics_jvm_heap
```

## Troubleshooting

### Connection refused on port 8983

**Cause**: Collector cannot reach Solr at the configured address.

**Fix**:

1. Verify Solr is running: `docker ps | grep solr` or
   `systemctl status solr`
2. Confirm Solr is listening on the expected port:
   `curl http://localhost:8983/solr/`
3. Check firewall rules if the Collector runs on a separate host

### Metrics endpoint returns JSON instead of Prometheus format

**Cause**: The `wt=prometheus` parameter is missing from the
scrape config.

**Fix**:

1. Ensure `params: { wt: [prometheus] }` is set in the scrape
   job config
2. Verify with `curl`:
   `curl 'http://localhost:8983/solr/admin/metrics?wt=prometheus'`
3. Without `wt=prometheus`, Solr returns JSON which the
   Prometheus receiver cannot parse

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Core-level metrics missing

**Cause**: Core metrics only appear when at least one Solr core
exists.

**Fix**:

1. Create a core: `curl 'http://localhost:8983/solr/admin/cores?action=CREATE&name=mycore&configSet=_default'`
2. Core metrics (`solr_metrics_core_*`) are per-core and only
   appear after indexing begins
3. Verify cores exist:
   `curl http://localhost:8983/solr/admin/cores`

## FAQ

**Does this work with Solr running in Kubernetes?**

Yes. Set `targets` to the Solr pod or service DNS
(e.g., `solr-0.solr.default.svc.cluster.local:8983`). The
Collector can run as a sidecar or DaemonSet.

**How do I monitor a SolrCloud cluster?**

Add all Solr node endpoints to the scrape config:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: solr
          metrics_path: /solr/admin/metrics
          params:
            wt: [prometheus]
          static_configs:
            - targets:
                - solr-1:8983
                - solr-2:8983
                - solr-3:8983
```

Each node is scraped independently and identified by its
`instance` label.

**What is the difference between `node` and `core` metrics?**

Node metrics (`solr_metrics_node_*`) cover the entire Solr
instance — connections, filesystem, and aggregate request counts.
Core metrics (`solr_metrics_core_*`) are per-collection and
include index size, update handler stats, and query handler
performance. Core metrics only appear when cores are loaded.

**Why are `overseer` metrics missing?**

Overseer metrics only appear in SolrCloud mode when the node is
elected as the overseer. Standalone Solr instances do not emit
overseer metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Elasticsearch](./elasticsearch.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Use the `group` parameter to limit
  metric collection to specific categories

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Solr metrics
- [Elasticsearch Monitoring](./elasticsearch.md)
  — Search engine monitoring
