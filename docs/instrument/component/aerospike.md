---
title: >
  Aerospike OpenTelemetry Monitoring - Connections, Transactions,
  and Collector Setup
sidebar_label: Aerospike
id: collecting-aerospike-telemetry
sidebar_position: 15
description: >
  Collect Aerospike metrics with the OpenTelemetry Collector. Monitor
  connections, transaction throughput, and memory saturation, then export
  to base14 Scout.
keywords:
  - aerospike opentelemetry
  - aerospike otel collector
  - aerospike metrics monitoring
  - aerospike performance monitoring
  - opentelemetry aerospike receiver
  - aerospike observability
  - monitor aerospike kubernetes
  - aerospike telemetry collection
---

# Aerospike

The OpenTelemetry Collector's Aerospike receiver talks the native info
protocol to an Aerospike node on port 3000 and collects 9 metrics across
node- and namespace-scoped resources - connection, transaction, memory, and
query series. There is no exporter to run and no HTTP endpoint to expose;
the receiver reads the statistics directly. This guide configures the
receiver, connects to a node, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Aerospike              | 4.9     | 8.x         |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- The Aerospike client port (3000) must be reachable from the host running
  the Collector.
- Community Edition needs no authentication. Enterprise Edition uses a
  username and password - see [Access Setup](#access-setup).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review. The receiver emits two resource scopes per scrape -
one node-scoped, one namespace-scoped - so node and namespace metrics
carry different resource attributes.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `aerospike.node.connection.open` | Open client, heartbeat, and fabric connections - node reachability plus current client load. |
| `aerospike.namespace.transaction.count` | Transactions by type and result; the headline throughput KPI and the source of the error rate via its `result` dimension. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `aerospike.node.memory.free` | Free node memory percent - the saturation signal that drives stop-writes. |
| `aerospike.node.connection.count` | Connection opens and closes by type (client / heartbeat / fabric) and operation - reconnect storms and leaks. |
| `aerospike.namespace.query.count` | Queries by type and result - query load and query-side errors. |

### Diagnostic - for investigation and tuning

The GeoJSON region-query series. They only carry meaning for geospatial
workloads and read zero otherwise, so drop them in production with the
receiver's per-metric toggle and re-enable when investigating geospatial
query behaviour.

| Metric | What it tells you |
|---|---|
| `aerospike.namespace.geojson.region_query_requests` | GeoJSON region-query requests. |
| `aerospike.namespace.geojson.region_query_points` | Points returned by region queries. |
| `aerospike.namespace.geojson.region_query_cells` | Cells scanned to satisfy region queries. |
| `aerospike.namespace.geojson.region_query_false_positive` | Region-query false positives - index selectivity for geospatial queries. |

Some receiver-whitelisted metrics may not emit on every server build - see
[Troubleshooting](#namespace-memory-and-disk-metrics-missing). Full metric
reference:
[OTel Aerospike Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/aerospikereceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `aerospike.node.memory.free` | Approaching the stop-writes margin | At or below the high-water mark | Writes are rejected near the high-water mark. Add capacity or evict before it bites. |
| `aerospike.node.connection.count{operation=open}` (rate) | Spiking vs baseline | Sustained spike with `node.connection.open` climbing | Client reconnect storms or a connection leak. Check client connection pooling. |
| `aerospike.namespace.transaction.count{result=error}` (rate) | Rising vs total transactions | Sustained error share climbing | Client-visible transaction failures. Correlate with node health and capacity. |

## Access Setup

Verify the node is reachable on the client port before wiring the
Collector:

```bash showLineNumbers title="Verify access"
# Check node status with asadm (if installed)
asadm -e "info"

# Or test connectivity with aql
aql -h localhost -p 3000 -c "show namespaces"
```

Community Edition requires no authentication. Enterprise Edition uses a
username and password; create a read-only monitoring user and grant it the
`read` role, which is enough for the info-protocol statistics the receiver
reads. No write privileges are needed. Pass those credentials to the
receiver as shown in [Configuration](#configuration).

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  aerospike:
    endpoint: localhost:3000   # Change to your Aerospike address
    collection_interval: 10s
    collect_cluster_metrics: false

    metrics:
      # Core
      aerospike.node.connection.open:
        enabled: true
      aerospike.namespace.transaction.count:
        enabled: true

      # Operational
      aerospike.node.memory.free:
        enabled: true
      aerospike.node.connection.count:
        enabled: true
      aerospike.namespace.query.count:
        enabled: true

      # Diagnostic - geospatial workloads only; drop in production
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
      - key: deployment.environment.name
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
      insecure_skip_verify: true        # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [aerospike]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, disable the GeoJSON Diagnostic
metrics with their per-metric `enabled: false` toggle while keeping the
Core and Operational series.

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

To collect from every node discovered through the seed node, point the
receiver at any node and enable cluster discovery:

```yaml showLineNumbers title="config/otel-collector.yaml (cluster)"
receivers:
  aerospike:
    endpoint: localhost:3000
    collect_cluster_metrics: true
```

### Environment Variables

```bash showLineNumbers title=".env"
# Enterprise Edition only; omit for Community Edition
AEROSPIKE_USERNAME=otel_monitor
AEROSPIKE_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the Aerospike receiver
docker logs otel-collector 2>&1 | grep -i "aerospike"

# Confirm Aerospike is reachable on the client port
aql -h localhost -p 3000 -c "show namespaces"
```

With the debug exporter enabled you should see a batch carrying the node-
and namespace-scoped metrics; with the Scout exporter, confirm the series
land in Scout. Transaction and query counts only move once traffic hits the
namespace, so send some load if the counts read zero.

## Troubleshooting

### Connection refused on port 3000

**Cause**: The Collector cannot reach Aerospike at the configured endpoint.

**Fix**:

1. Verify Aerospike is running: `docker ps | grep aerospike` or
   `systemctl status aerospike`.
2. Confirm the service port in `aerospike.conf` matches the receiver
   `endpoint`.
3. Check firewall rules if the Collector runs on a separate host.

### Transaction or query counts stay at zero

**Cause**: No traffic has reached the namespace yet.

**Look at**: `aerospike.namespace.transaction.count` and
`aerospike.namespace.query.count` - both are traffic-driven and read zero on
an idle node.

**Fix**:

1. Drive load against the namespace (for example with `asbench`).
2. Confirm the receiver is pointed at the namespace actually taking traffic.

### Namespace memory and disk metrics missing

**Cause**: On Aerospike 8.x the receiver does not surface the namespace-
scoped capacity stats - `aerospike.namespace.memory.free`,
`aerospike.namespace.memory.usage`, and `aerospike.namespace.disk.available`
do not emit even under load, because the underlying namespace memory and
disk info stats were renamed or removed in the 8.x info protocol and the
receiver cannot read them on that build.

**Look at**: `aerospike.node.memory.free` - node-level memory still emits, so
read namespace-level capacity from node memory plus per-namespace tooling
(`asadm`, `asinfo`) until the receiver catches up.

**Fix**:

1. Leave the namespace capacity metrics enabled - they cost nothing when
   silent and will start emitting once receiver support lands.

### GeoJSON metrics read zero

**Cause**: No geospatial queries have run.

**Look at**: the Diagnostic `aerospike.namespace.geojson.*` series - they
only increment for region queries against secondary indexes with GeoJSON
data types.

**Fix**: Expect zero unless you run geospatial workloads. Disable the series
in the receiver config if you do not use them.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Aerospike running in Kubernetes?**

Yes. Set `endpoint` to the Aerospike service DNS
(e.g., `aerospike.default.svc.cluster.local:3000`). The Collector can run as
a sidecar or DaemonSet.

**How do I monitor an Aerospike cluster?**

Set `collect_cluster_metrics: true` and point the receiver at any seed node;
it discovers the peer nodes and collects from the cluster. For explicit
control, add multiple named receiver blocks instead:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-node)"
receivers:
  aerospike/node1:
    endpoint: aerospike-1:3000
  aerospike/node2:
    endpoint: aerospike-2:3000
```

**Does this work with both Community and Enterprise Edition?**

Yes. Community Edition needs no authentication. Enterprise Edition requires
`username` and `password` in the receiver config. The same metrics are
collected from both editions.

**Why are the namespace memory and disk metrics not showing up?**

On Aerospike 8.x the receiver cannot read the namespace-scoped capacity
stats and they stay silent; node memory (`aerospike.node.memory.free`) still
emits. See
[Troubleshooting](#namespace-memory-and-disk-metrics-missing).

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Aerospike metrics.
- [Redis Monitoring](./redis.md) - Another in-memory key-value store.
- [MongoDB Monitoring](./mongodb.md) - A common companion document store.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [MongoDB](./mongodb.md), and other components.
- **Fine-tune Collection**: Disable the GeoJSON Diagnostic tier in
  production to control volume; keep it available for incident
  investigation.
