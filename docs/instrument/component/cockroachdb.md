---
title: >
  Monitor CockroachDB with OpenTelemetry - Distributed SQL Metrics
sidebar_label: CockroachDB
id: collecting-cockroachdb-telemetry
sidebar_position: 50
description: >
  Collect CockroachDB SQL throughput, node liveness, and clock-skew metrics
  with the OpenTelemetry Collector's Prometheus receiver. Monitor query rates,
  transaction latency, and range replication. Export to base14 Scout.
keywords:
  - cockroachdb opentelemetry
  - cockroachdb otel collector
  - distributed sql metrics
  - sql_query_count
  - cockroachdb prometheus
  - cockroachdb monitoring
  - cockroachdb observability
  - crdb telemetry
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which port and path does CockroachDB use for metrics?","acceptedAnswer":{"@type":"Answer","text":"Each node serves Prometheus metrics on its HTTP port 8080 at /_status/vars. This is not the default /metrics path, so set metrics_path to /_status/vars in the scrape job."}},{"@type":"Question","name":"What does liveness_livenodes report?","acceptedAnswer":{"@type":"Answer","text":"The number of nodes the cluster currently considers live. In a healthy cluster it equals the total node count; a drop signals a node the cluster can no longer reach."}},{"@type":"Question","name":"Why monitor clock_offset_meannanos?","acceptedAnswer":{"@type":"Answer","text":"CockroachDB relies on loosely-synchronized clocks. If a node's mean offset versus its peers grows too large, the node removes itself from the cluster to preserve consistency. Tracking this metric warns you before that happens."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# CockroachDB

Each CockroachDB node serves Prometheus-format metrics on its HTTP port 8080
at the `/_status/vars` path (not the default `/metrics`). These metrics
reflect SQL throughput, distributed-SQL activity, node liveness, clock skew,
and range replication health. The OpenTelemetry Collector scrapes this
endpoint with the Prometheus receiver, then exports the series to base14
Scout. This guide configures the receiver and ships the metrics.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.34+       |
| CockroachDB            | 23.1    | 26.2+       |
| OTel Collector Contrib | 0.90.0  | 0.152+      |
| base14 Scout           | Any     | -           |

Before starting:

- A running Kubernetes cluster.
- CockroachDB deployed in the cluster - see the
  [upstream CockroachDB chart](https://github.com/cockroachdb/helm-charts).
- An OTel Collector with the Prometheus receiver, reachable from the
  cluster - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- base14 Scout credentials.

## What You'll Monitor

- **SQL throughput**: total, SELECT, and INSERT query counts, plus active
  distributed-SQL queries and open connections.
- **Transaction latency**: the SQL transaction latency distribution.
- **Node liveness**: the count of live nodes the cluster sees.
- **Clock health**: mean clock offset versus other nodes - a key CockroachDB
  health signal.
- **Range replication**: range counts per store and under-replicated ranges,
  which should sit at 0 in a healthy cluster.

## Configuration

CockroachDB serves its metrics on port 8080 at the non-default
`/_status/vars` path. Point a Prometheus scrape job at the CockroachDB public
Service, and set `metrics_path` explicitly:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cockroachdb
          scrape_interval: 30s
          metrics_path: /_status/vars
          static_configs:
            - targets:
                - cockroachdb-public.cockroachdb.svc:8080

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
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Metrics Reference

| Metric | Type | Unit | Dimensions | Notes |
| --- | --- | --- | --- | --- |
| `sql_query_count` | sum (cumulative) | `1` | `node_id` | Total SQL queries served; rises steadily under load. |
| `sql_select_count` | sum (cumulative) | `1` | `node_id` | SELECT statements executed. |
| `sql_insert_count` | sum (cumulative) | `1` | `node_id` | INSERT statements executed. |
| `sql_distsql_queries_active` | gauge | `1` | `node_id` | Currently-active distributed-SQL queries. |
| `sql_conns` | gauge | `1` | `node_id` | Open SQL connections. |
| `sql_txn_latency` | histogram | `ns` | `node_id` | SQL transaction latency distribution. |
| `liveness_livenodes` | gauge | `1` | `node_id` | Count of live nodes the cluster sees; equals the node count in a healthy cluster. |
| `clock_offset_meannanos` | gauge | `ns` | `node_id` | Mean clock offset versus other nodes; a key health signal. |
| `ranges` | gauge | `1` | `node_id`, `store` | Number of ranges on the store. |
| `ranges_underreplicated` | gauge | `1` | `node_id`, `store` | Under-replicated ranges; should sit at 0 in a healthy cluster. |
| `capacity_available` | gauge | `byte` | `node_id`, `store` | Available store capacity. |
| `sys_uptime` | gauge | `s` | `node_id` | Process uptime per node. |

## Verify the Setup

Start the Collector and confirm a CockroachDB metric arrives within ~60
seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm CockroachDB is serving metrics in-cluster
kubectl -n cockroachdb port-forward svc/cockroachdb-public 8080:8080 &
curl -s http://localhost:8080/_status/vars | grep sql_query_count

# Check the Collector logs for a successful scrape
kubectl logs deployment/otel-collector | grep -i sql_query_count
```

## Troubleshooting

### No CockroachDB metrics in the Collector

**Cause**: The Collector cannot reach the CockroachDB Service, or the scrape
path is wrong.

**Fix**:

1. Confirm CockroachDB is Running:
   `kubectl -n cockroachdb get pods`.
2. Verify the Service DNS and port match the scrape target:
   `kubectl -n cockroachdb get svc cockroachdb-public`.
3. Confirm `metrics_path` is `/_status/vars`, not the default `/metrics` -
   CockroachDB returns 404 on `/metrics`.

### Metric name present but no datapoints

**Cause**: The cluster is idle, so the SQL counters have not moved since the
last scrape.

**Fix**:

1. Run some SQL against the cluster (for example, the built-in
   `cockroach workload run kv` load generator) and re-check.
2. Confirm the node is healthy: `liveness_livenodes` should equal your node
   count.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the Prometheus receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Which port and path does CockroachDB use for metrics?**

Each node serves Prometheus metrics on its HTTP port 8080 at `/_status/vars`.
This is not the default `/metrics` path, so set `metrics_path: /_status/vars`
in the scrape job.

**What does `liveness_livenodes` report?**

The number of nodes the cluster currently considers live. In a healthy
cluster it equals the total node count; a drop signals a node the cluster
can no longer reach.

**Why monitor `clock_offset_meannanos`?**

CockroachDB relies on loosely-synchronized clocks. If a node's mean offset
versus its peers grows too large, the node removes itself from the cluster to
preserve consistency. Tracking this metric warns you before that happens.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Redis](./redis.md),
  and other components
- **Set Up Alerts**: Alert on node liveness and clock skew. See
  [Creating Alerts](../../guides/creating-alerts-with-logx.md)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  - Advanced collector configuration
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  - Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  - Alert on CockroachDB metrics

Validated against: CockroachDB v26.2 on a 3-node managed Kubernetes cluster.
