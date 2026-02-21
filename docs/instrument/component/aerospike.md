---
title: >
  Aerospike OpenTelemetry Monitoring — Connections, Transactions,
  and Collector Setup
sidebar_label: Aerospike
id: collecting-aerospike-telemetry
sidebar_position: 15
description: >
  Collect Aerospike metrics with the OpenTelemetry Collector. Monitor
  connections, transactions, memory usage, and namespace statistics
  using the Aerospike receiver and export to base14 Scout.
keywords:
  - aerospike opentelemetry
  - aerospike otel collector
  - aerospike metrics monitoring
  - aerospike performance monitoring
  - opentelemetry aerospike receiver
  - aerospike observability
  - aerospike database monitoring
  - aerospike telemetry collection
---

# Aerospike

The OpenTelemetry Collector's Aerospike receiver collects 14 metrics
from Aerospike 4.9+, including node connections, transactions,
namespace memory and disk usage, query and scan counts, and geojson
query statistics. This guide configures the receiver, connects to an
Aerospike node, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Aerospike              | 4.9     | 7.x+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Aerospike client port (3000) must be accessible from the host
  running the Collector
- No authentication required for Community Edition
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Connections**: open connections, connection lifecycle counts
- **Transactions**: transaction counts by type and result
- **Memory**: node memory free percentage, namespace memory usage
- **Disk**: namespace disk availability
- **Queries & Scans**: query and scan counts by type and result,
  tracked queries
- **GeoJSON**: region query requests, points, cells, false positives

Full metric reference:
[OTel Aerospike Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/aerospikereceiver)

## Access Setup

Verify your Aerospike instance is accessible:

```bash showLineNumbers
# Check node status using asadm (if installed)
asadm -e "info"

# Or test connectivity with aql
aql -h localhost -p 3000 -c "show namespaces"
```

Community Edition requires no authentication. Enterprise Edition
uses username/password — see [Authentication](#authentication) below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  aerospike:
    endpoint: localhost:3000   # Change to your Aerospike address
    collection_interval: 30s
    collect_cluster_metrics: false

    metrics:
      # Node metrics
      aerospike.node.connection.count:
        enabled: true
      aerospike.node.connection.open:
        enabled: true
      aerospike.node.memory.free:
        enabled: true
      aerospike.node.query.tracked:
        enabled: true

      # Namespace metrics
      aerospike.namespace.disk.available:
        enabled: true
      aerospike.namespace.memory.free:
        enabled: true
      aerospike.namespace.memory.usage:
        enabled: true
      aerospike.namespace.transaction.count:
        enabled: true
      aerospike.namespace.query.count:
        enabled: true
      aerospike.namespace.scan.count:
        enabled: true

      # GeoJSON metrics
      aerospike.namespace.geojson.region_query_requests:
        enabled: true
      aerospike.namespace.geojson.region_query_points:
        enabled: true
      aerospike.namespace.geojson.region_query_cells:
        enabled: true
      aerospike.namespace.geojson.region_query_false_positive:
        enabled: true

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
      receivers: [aerospike]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For Aerospike Enterprise Edition with authentication enabled:

```yaml showLineNumbers title="config/otel-collector.yaml (auth)"
receivers:
  aerospike:
    endpoint: localhost:3000
    username: ${env:AEROSPIKE_USERNAME}
    password: ${env:AEROSPIKE_PASSWORD}
    tls:
      insecure_skip_verify: true
```

### Cluster-wide Collection

To collect metrics from all nodes discovered through the seed node:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  aerospike:
    endpoint: localhost:3000
    collect_cluster_metrics: true
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful connection
docker logs otel-collector 2>&1 | grep -i "aerospike"

# Verify Aerospike is running
aql -h localhost -p 3000 -c "show namespaces"
```

## Troubleshooting

### Connection refused on port 3000

**Cause**: Collector cannot reach Aerospike at the configured
endpoint.

**Fix**:

1. Verify Aerospike is running: `docker ps | grep aerospike` or
   `systemctl status aerospike`
2. Confirm the service port in `aerospike.conf` matches the
   receiver endpoint
3. Check firewall rules if the Collector runs on a separate host

### Namespace metrics missing

**Cause**: Namespace-level disk and memory metrics require the
namespace to have storage configured.

**Fix**:

1. `aerospike.namespace.disk.available` only appears when the
   namespace uses disk storage (`storage-engine device`)
2. `aerospike.namespace.memory.free` and `memory.usage` require
   `memory-size` to be configured in the namespace
3. In-memory-only namespaces emit fewer namespace metrics

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**Does this work with Aerospike running in Kubernetes?**

Yes. Set `endpoint` to the Aerospike service DNS
(e.g., `aerospike.default.svc.cluster.local:3000`). The Collector
can run as a sidecar or DaemonSet.

**How do I monitor an Aerospike cluster?**

Set `collect_cluster_metrics: true` and point the receiver at any
seed node. The receiver discovers all peer nodes and collects metrics
from the entire cluster. Alternatively, add multiple receiver blocks
for explicit control:

```yaml
receivers:
  aerospike/node1:
    endpoint: aerospike-1:3000
  aerospike/node2:
    endpoint: aerospike-2:3000
```

**Does this work with both Community and Enterprise Edition?**

Yes. Community Edition requires no authentication. Enterprise Edition
requires `username` and `password` in the receiver config. The same
metrics are collected from both editions.

**Why are GeoJSON metrics showing zero?**

GeoJSON metrics only increment when geospatial queries are executed
against secondary indexes with geojson data types. They remain at
zero if geospatial features are not used.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your
  own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md),
  [MongoDB](./mongodb.md),
  and other components
- **Fine-tune Collection**: Enable `collect_cluster_metrics` for
  cluster-wide visibility or adjust `collection_interval` based on
  your workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Redis Monitoring](./redis.md) — Alternative key-value store
  monitoring
