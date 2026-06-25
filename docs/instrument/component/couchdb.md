---
title: >
  CouchDB OpenTelemetry Monitoring - Request Latency, Database Operations,
  and Collector Setup
sidebar_label: CouchDB
id: collecting-couchdb-telemetry
sidebar_position: 10
description: >
  Collect CouchDB metrics with the OpenTelemetry Collector. Monitor request
  latency, database operations, HTTP request and response counts, and view
  queries, and ship to base14 Scout.
keywords:
  - couchdb opentelemetry
  - couchdb otel collector
  - couchdb metrics monitoring
  - couchdb performance monitoring
  - opentelemetry couchdb receiver
  - couchdb observability
  - couchdb database monitoring
  - couchdb telemetry collection
---

# CouchDB

The OpenTelemetry Collector's CouchDB receiver collects 8 metrics from
CouchDB 3.x across request latency, HTTP request and response counts,
database operations, file descriptors, and view and bulk requests. The
receiver connects to the CouchDB HTTP API and reads `/_node/_local/_stats`
with basic auth, so no exporter or sidecar is needed. This guide configures
the receiver, sets up the read access it needs, and ships metrics to base14
Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| CouchDB                | 2.3     | 3.x         |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- The CouchDB HTTP API must be reachable from the host running the Collector
  (default port 5984).
- An account with read access to `/_node/_local/_stats` - an admin or a
  dedicated read-only user works (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The receiver connects to the CouchDB HTTP API and reads
`/_node/_local/_stats`. A few things follow from that surface:

- **There is no `up`, uptime, or health metric.** That series is
  prometheus-receiver-only; the CouchDB receiver does not emit it. Liveness
  is the receiver scraping the stats endpoint successfully - if it returns
  data, the node is up and serving.
- **The receiver needs read access to `/_node/_local/_stats`.** An admin or
  a dedicated read-only user works; no write access is required.
- **`couchdb.httpd.views` reads 0 until a MapReduce view is queried, and
  `couchdb.httpd.bulk_requests` until a `_bulk_docs` request runs.** A zero
  on a cluster that never runs views or bulk updates is expected, not a
  fault.
- **The response-status breakdown is your error signal.**
  `couchdb.httpd.responses` carries an `http.status_code` attribute, so 4xx
  and 5xx rates come from filtering that series.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `couchdb.average_request_time` | Average request processing time in ms - the serving-latency KPI. No `up`/health on this surface; liveness is scrape success. |
| `couchdb.httpd.requests` | HTTP requests by `http.method` (GET/POST/PUT/...) - request throughput. |
| `couchdb.database.operations` | Database operations by `operation` (reads/writes) - the DB-work KPI. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `couchdb.httpd.responses` | Responses by `http.status_code` (200/201/202/4xx/5xx) - the error-rate signal. |
| `couchdb.file_descriptor.open` | Open file descriptors - saturation against the OS limit. |
| `couchdb.database.open` | Open databases - resource footprint. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
|---|---|
| `couchdb.httpd.bulk_requests` | Bulk-update (`_bulk_docs`) request count - reach for it when a write spike correlates with batch ingest. |
| `couchdb.httpd.views` | MapReduce view (temporary and permanent) query count - reach for it when view-heavy reads drive latency. |

Full metric reference:
[OTel CouchDB Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/couchdbreceiver).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload. They are all relative to
your own baseline - the right absolute values depend on your traffic and
hardware.

| Alert | Threshold | Why it matters |
|---|---|---|
| CouchDB unreachable | The `couchdb` receiver produces no data for > 1m | No `up`/health on this surface - scrape success is liveness. Check the CouchDB process and the receiver credentials/endpoint. |
| Request latency rising | `couchdb.average_request_time` rising vs baseline | Slow request processing; check disk, compaction, and load. |
| Error responses | `rate(couchdb.httpd.responses{http.status_code=~"5.."})` rising vs baseline | Server-side errors; inspect the CouchDB logs and recent writes/views. |
| File-descriptor saturation | `couchdb.file_descriptor.open` approaching the OS file-descriptor limit | Approaching the descriptor ceiling; raise the ulimit before requests start failing. |

## Access Setup

The CouchDB receiver reads an authenticated stats endpoint. Use the admin
account or create a dedicated monitoring user:

```bash showLineNumbers title="Create monitoring user (optional)"
curl -X PUT http://localhost:5984/_users/org.couchdb.user:otel_monitor \
  -H "Content-Type: application/json" \
  -u admin:password \
  -d '{"name":"otel_monitor","password":"monitor_pass","roles":[],"type":"user"}'
```

**Minimum required permissions:**

- Read access to `/_node/_local/_stats` - required for all metrics.
- No write permissions are needed; the Collector only reads metrics.

Verify the endpoint responds before wiring up the Collector:

```bash showLineNumbers title="Verify access"
# Liveness check
curl http://localhost:5984/_up

# Stats endpoint the receiver reads
curl -u otel_monitor:monitor_pass http://localhost:5984/_node/_local/_stats
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  couchdb:
    endpoint: http://localhost:5984     # Change to your CouchDB address
    username: ${env:COUCHDB_USER}
    password: ${env:COUCHDB_PASSWORD}
    collection_interval: 10s

    metrics:
      # Performance
      couchdb.average_request_time:
        enabled: true

      # Database
      couchdb.database.open:
        enabled: true
      couchdb.database.operations:
        enabled: true

      # System
      couchdb.file_descriptor.open:
        enabled: true

      # HTTP
      couchdb.httpd.bulk_requests:
        enabled: true
      couchdb.httpd.requests:
        enabled: true
      couchdb.httpd.responses:
        enabled: true
      couchdb.httpd.views:
        enabled: true

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

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [couchdb]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
COUCHDB_USER=otel_monitor
COUCHDB_PASSWORD=your_password
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for the CouchDB receiver
docker logs otel-collector 2>&1 | grep -i "couchdb"

# Verify the CouchDB stats endpoint responds
curl -u ${COUCHDB_USER}:${COUCHDB_PASSWORD} http://localhost:5984/_node/_local/_stats

# List databases
curl -u ${COUCHDB_USER}:${COUCHDB_PASSWORD} http://localhost:5984/_all_dbs
```

## Troubleshooting

### Connection refused

**Cause**: The Collector cannot reach CouchDB at the configured endpoint.

**Fix**:

1. Verify CouchDB is running: `systemctl status couchdb` or
   `docker ps | grep couchdb`.
2. Confirm the endpoint address and port (default 5984) in your config.
3. Check whether CouchDB is bound to `127.0.0.1` - change to `0.0.0.0` in
   `local.ini` if the Collector runs on a separate host.

### Authentication failed

**Cause**: The monitoring credentials are incorrect or the user lacks read
access to the stats endpoint.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:5984/_node/_local/_stats`.
2. Verify the user exists in the `_users` database.
3. Check the `COUCHDB_USER` and `COUCHDB_PASSWORD` environment variables.

### View or bulk metrics read zero

**Cause**: No view has been queried, or no bulk request has run, yet.

**Look at**: `couchdb.httpd.views` and `couchdb.httpd.bulk_requests` - both
stay at 0 until the matching traffic occurs. This is expected, not a fault.

**Fix**:

1. `couchdb.httpd.views` populates only after a MapReduce view is queried.
   Create and query one to confirm:
   `curl -u user:pass http://localhost:5984/mydb/_design/test/_view/all`.
2. `couchdb.httpd.bulk_requests` populates only after a `_bulk_docs` request
   runs.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with CouchDB running in Kubernetes?**

Yes. Set `endpoint` to the CouchDB service DNS
(e.g., `http://couchdb.default.svc.cluster.local:5984`) and inject
credentials via a Kubernetes secret. The Collector can run as a sidecar or
DaemonSet.

**How do I monitor a CouchDB cluster?**

Each CouchDB node exposes its own `/_node/_local/_stats` endpoint. Add a
separate receiver block per node:

```yaml
receivers:
  couchdb/node1:
    endpoint: http://couchdb-1:5984
    username: ${env:COUCHDB_USER}
    password: ${env:COUCHDB_PASSWORD}
  couchdb/node2:
    endpoint: http://couchdb-2:5984
    username: ${env:COUCHDB_USER}
    password: ${env:COUCHDB_PASSWORD}
```

Then include both in the pipeline:
`receivers: [couchdb/node1, couchdb/node2]`.

**What permissions does the monitoring account need?**

Read access to `/_node/_local/_stats`. No write access is required - the
Collector only reads metrics and never modifies CouchDB data. An admin
account works, but a dedicated read-only user is cleaner.

**Why do the view and bulk metrics read zero?**

`couchdb.httpd.views` counts MapReduce view queries and
`couchdb.httpd.bulk_requests` counts `_bulk_docs` requests. Each stays at 0
until that traffic occurs, so a zero on a node that never runs views or bulk
updates is expected, not a problem.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on CouchDB metrics.
- [MongoDB Monitoring](./mongodb.md) - Another document database to monitor
  alongside CouchDB.
- [PostgreSQL Monitoring](./postgres.md) - A relational store you may run in
  the same stack.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MongoDB](./mongodb.md), [PostgreSQL](./postgres.md), and other components.
- **Fine-tune Collection**: Adjust `collection_interval` to match your
  database workload and metric-volume budget.
