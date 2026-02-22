---
title: >
  Couchbase OpenTelemetry Monitoring — CPU, Memory,
  and Collector Setup
sidebar_label: Couchbase
id: collecting-couchbase-telemetry
sidebar_position: 30
description: >
  Collect Couchbase metrics with the OpenTelemetry
  Collector. Monitor CPU utilization, memory usage,
  and active connections using the Prometheus receiver.
keywords:
  - couchbase opentelemetry
  - couchbase otel collector
  - couchbase metrics monitoring
  - couchbase performance monitoring
  - opentelemetry prometheus receiver couchbase
  - couchbase observability
  - monitor couchbase kubernetes
  - couchbase telemetry collection
---

# Couchbase

Couchbase Server 7.0+ exposes Prometheus-format metrics at
`/metrics` on port 8091. The OpenTelemetry Collector scrapes
this endpoint using the Prometheus receiver, collecting 137
Couchbase-specific metrics across cluster management, data
service connections, CPU utilization, memory usage, and disk
I/O. This guide configures the receiver, sets up the required
authentication, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Couchbase Server       | 7.0     | 7.6+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Couchbase management port (8091) must be accessible from
  the host running the Collector
- A monitoring user with the External Stats Reader role
  (see [Access Setup](#access-setup) below)
- Cluster must be initialized before metrics are available
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cluster Manager** (`cm_*`): auth cache hits, auto
  failover status, rebalance progress, REST requests,
  balanced state
- **Data Service** (`kv_*`): active connections, auth
  errors, command duration, rejected connections, daemon
  memory, uptime
- **System Resources** (`sys_*`): CPU utilization (host,
  user, sys, cgroup), memory (free, used, total, limit),
  disk I/O (reads, writes, bytes, queue depth), swap
- **System Processes** (`sysproc_*`): CPU seconds, resident
  memory, shared memory, page faults, process start time
- **Audit**: queue length, unsuccessful retries

Full metric list: run
`curl -su admin:password http://localhost:8091/metrics`
against your Couchbase instance.

## Access Setup

Create a dedicated monitoring user with the External Stats
Reader role. This grants read-only access to the `/metrics`
endpoint without exposing cluster administration.

```bash showLineNumbers title="Create monitoring user"
# Using the Couchbase CLI
couchbase-cli user-manage \
  --cluster http://localhost:8091 \
  --username Administrator \
  --password your_admin_password \
  --set \
  --rbac-username otel_monitor \
  --rbac-password monitoring_password \
  --rbac-name "OTel Monitor" \
  --roles external_stats_reader \
  --auth-domain local
```

**Minimum required permissions:**

- `external_stats_reader`: Required to read `/metrics`

No write or data-access permissions are needed. For quick
testing, admin credentials also work.

Verify the endpoint:

```bash showLineNumbers title="Verify metrics access"
# Check Couchbase is running and initialized
curl -s http://localhost:8091/pools/default \
  | head -5

# Verify Prometheus metrics endpoint
curl -su otel_monitor:monitoring_password \
  http://localhost:8091/metrics | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: couchbase
          scrape_interval: 30s
          metrics_path: /metrics
          basic_auth:
            username: ${env:COUCHBASE_USER}
            password: ${env:COUCHBASE_PASSWORD}
          static_configs:
            - targets:
                - ${env:COUCHBASE_HOST}:8091

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
COUCHBASE_HOST=localhost
COUCHBASE_USER=otel_monitor
COUCHBASE_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

Couchbase exposes 137 metrics with `cm_`, `kv_`, `sys_`,
`sysproc_`, and `audit_` prefixes alongside standard Go
runtime and process metrics. To collect only
Couchbase-specific metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: couchbase
          scrape_interval: 30s
          metrics_path: /metrics
          basic_auth:
            username: ${env:COUCHBASE_USER}
            password: ${env:COUCHBASE_PASSWORD}
          static_configs:
            - targets:
                - ${env:COUCHBASE_HOST}:8091
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "(cm|kv|sys|sysproc|audit)_.*"
              action: keep
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "couchbase"

# Verify Couchbase is healthy
curl -su ${COUCHBASE_USER}:${COUCHBASE_PASSWORD} \
  http://localhost:8091/pools/default \
  | python3 -m json.tool | head -10

# Check metrics endpoint directly
curl -su ${COUCHBASE_USER}:${COUCHBASE_PASSWORD} \
  http://localhost:8091/metrics \
  | grep kv_curr_connections
```

## Troubleshooting

### Authentication failed (401 Unauthorized)

**Cause**: Monitoring credentials are incorrect or the user
lacks the External Stats Reader role.

**Fix**:

Test credentials directly against the metrics endpoint:

```bash showLineNumbers title="Test auth"
curl -su otel_monitor:password \
  http://localhost:8091/metrics | head -5
```

If that fails, verify the user exists and has the
`external_stats_reader` role:

```bash showLineNumbers title="List users"
couchbase-cli user-manage \
  --cluster http://localhost:8091 \
  --username Administrator \
  --password admin_pass --list
```

Also confirm `COUCHBASE_USER` and `COUCHBASE_PASSWORD` are
set in the Collector environment.

### Connection refused on port 8091

**Cause**: Collector cannot reach Couchbase at the configured
address.

**Fix**:

1. Verify Couchbase is running:
   `docker ps | grep couchbase` or
   `systemctl status couchbase-server`
2. Confirm the management port is listening:
   `curl -s http://localhost:8091/ui/index.html`
3. Check firewall rules if the Collector runs on a separate
   host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and
   exporter

### kv_* metrics missing

**Cause**: Data service metrics require at least one bucket
to exist in the cluster.

**Fix**:

Create a bucket via the Couchbase UI or CLI:

```bash showLineNumbers title="Create a bucket"
couchbase-cli bucket-create \
  --cluster http://localhost:8091 \
  --username Administrator \
  --password admin_pass \
  --bucket default \
  --bucket-type couchbase \
  --bucket-ramsize 256
```

Wait 30 seconds for the next scrape interval, then verify:

```bash showLineNumbers title="Check kv metrics"
curl -su otel_monitor:password \
  http://localhost:8091/metrics | grep kv_
```

## FAQ

**Does this work with Couchbase running in Kubernetes?**

Yes. Set `targets` to the Couchbase service DNS
(e.g., `couchbase-cluster.default.svc.cluster.local:8091`).
If using the Couchbase Autonomous Operator, each pod exposes
`/metrics` on port 8091. Add all pod addresses to the
scrape config or use Prometheus service discovery.

**How do I monitor a multi-node Couchbase cluster?**

Each Couchbase node exposes its own `/metrics` endpoint. Add
all node addresses to the scrape config:

```yaml showLineNumbers title="Multi-node scrape config"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: couchbase
          metrics_path: /metrics
          basic_auth:
            username: ${env:COUCHBASE_USER}
            password: ${env:COUCHBASE_PASSWORD}
          static_configs:
            - targets:
                - couchbase-1:8091
                - couchbase-2:8091
                - couchbase-3:8091
```

Each node is scraped independently and identified by its
`instance` label.

**Why are kv_* metrics not appearing?**

Data service (`kv_*`) metrics are only emitted once at least
one bucket exists in the cluster. Create a bucket and wait
for the next scrape interval. Cluster manager (`cm_*`) and
system (`sys_*`) metrics are available immediately after
cluster initialization.

**What's the difference between cm_*, kv_*, and sys_*
metrics?**

`cm_*` metrics cover cluster management operations like
rebalance, auto failover, and REST API activity. `kv_*`
metrics track the data service — connections, auth, and
command performance. `sys_*` metrics report host-level
resource usage including CPU, memory, disk I/O, and swap.

**Does this work with Couchbase Community Edition?**

Yes. Couchbase Community Edition 7.0+ exposes the same
`/metrics` endpoint with the same metric set. The
`couchbase:community` Docker image works without a license.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or
  build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [CouchDB](./couchdb.md),
  [MongoDB](./mongodb.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to
  focus on `kv_*` and `sys_*` metrics for production
  alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [CouchDB Monitoring](./couchdb.md)
  — Document database monitoring
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Couchbase metrics
