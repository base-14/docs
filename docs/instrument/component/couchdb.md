---
title: >
  CouchDB OpenTelemetry Monitoring — Request Times, Database Operations,
  and Collector Setup
sidebar_label: CouchDB
id: collecting-couchdb-telemetry
sidebar_position: 10
description: >
  Collect CouchDB metrics with the OpenTelemetry Collector. Monitor request
  times, database operations, HTTP request rates, and view queries using
  the CouchDB receiver and export to base14 Scout.
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
CouchDB 2.3+, including average request time, database operations, HTTP
request rates, and view query counts. This guide configures the receiver,
sets up monitoring credentials, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| CouchDB                | 2.3     | 3.x         |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- CouchDB HTTP API must be accessible from the host running the Collector
- Admin or monitoring credentials with read access to `/_node/_local/_stats`
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Performance**: average request time across all requests
- **Database**: open database count, read/write/delete operations
- **HTTP**: total requests, bulk request count, response codes, view queries
- **System**: open file descriptor count

Full metric reference:
[OTel CouchDB Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/couchdbreceiver)

## Access Setup

CouchDB requires authenticated access to the stats endpoint. Use the
admin account or create a dedicated monitoring user:

```bash showLineNumbers title="Create monitoring user (optional)"
curl -X PUT http://localhost:5984/_users/org.couchdb.user:otel_monitor \
  -H "Content-Type: application/json" \
  -u admin:password \
  -d '{"name":"otel_monitor","password":"monitor_pass","roles":[],"type":"user"}'
```

**Minimum required permissions:**

- Read access to `/_node/_local/_stats` — required for all metrics
- No write permissions are needed

Verify the stats endpoint:

```bash showLineNumbers
curl -u otel_monitor:monitor_pass http://localhost:5984/_node/_local/_stats
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  couchdb:
    endpoint: http://localhost:5984     # Change to your CouchDB address
    username: ${env:COUCHDB_USER}
    password: ${env:COUCHDB_PASSWORD}
    collection_interval: 30s

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
      receivers: [couchdb]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

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
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "couchdb"

# Verify CouchDB stats endpoint responds
curl -u ${COUCHDB_USER}:${COUCHDB_PASSWORD} http://localhost:5984/_node/_local/_stats

# List databases
curl -u ${COUCHDB_USER}:${COUCHDB_PASSWORD} http://localhost:5984/_all_dbs
```

## Troubleshooting

### Authentication failed

**Cause**: Monitoring credentials are incorrect or the user lacks
permissions.

**Fix**:

1. Test credentials directly:
   `curl -u user:pass http://localhost:5984/_node/_local/_stats`
2. Verify the user exists in `/_users` database
3. Check `COUCHDB_USER` and `COUCHDB_PASSWORD` environment variables

### Connection refused

**Cause**: Collector cannot reach CouchDB at the configured endpoint.

**Fix**:

1. Verify CouchDB is running: `systemctl status couchdb` or
   `docker ps | grep couchdb`
2. Confirm the endpoint address and port (default 5984) in your config
3. Check if CouchDB is bound to `127.0.0.1` — change to `0.0.0.0` in
   `local.ini` if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### View query metrics always zero

**Cause**: No view queries have been executed against the database.

**Fix**:

1. `couchdb.httpd.views` tracks MapReduce view requests — it stays zero
   until views are queried
2. Create and query a view to verify:
   `curl -u user:pass http://localhost:5984/mydb/_design/test/_view/all`

## FAQ

**Does this work with CouchDB running in Kubernetes?**

Yes. Set `endpoint` to the CouchDB service DNS
(e.g., `http://couchdb.default.svc.cluster.local:5984`) and inject
credentials via a Kubernetes secret. The Collector can run as a sidecar
or DaemonSet.

**How do I monitor a CouchDB cluster?**

Each CouchDB node exposes its own `/_node/_local/_stats` endpoint. Add
a separate receiver block for each node:

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
`receivers: [couchdb/node1, couchdb/node2]`

**What permissions does the monitoring account need?**

Read access to `/_node/_local/_stats`. No write access is required.
The Collector only reads metrics — it does not modify CouchDB data.
An admin account works but a dedicated read-only user is recommended.

**Does this work with CouchDB 2.x and 3.x?**

Yes. The receiver uses the `/_node/_local/_stats` endpoint introduced
in CouchDB 2.0. All 8 metrics are available on both CouchDB 2.3+ and
3.x. The stats API is stable across these versions.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [MongoDB](./mongodb.md), [PostgreSQL](./postgres.md),
  and other components
- **Fine-tune Collection**: Adjust `collection_interval` based on your
  database workload

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [MongoDB Monitoring](./mongodb.md) — Alternative document database
  monitoring
