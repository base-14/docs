---
title: CouchDB Monitoring with OpenTelemetry
sidebar_label: CouchDB
id: collecting-couchdb-telemetry
sidebar_position: 10
description:
  Monitor CouchDB with OpenTelemetry Collector. Collect request times, database
  operations, HTTP stats, and file descriptor metrics using Scout.
keywords:
  [
    couchdb monitoring,
    couchdb metrics,
    document database monitoring,
    opentelemetry couchdb,
    couchdb observability,
  ]
---

# CouchDB

## Overview

This guide explains how to set up CouchDB metrics collection using Scout
Collector and forward them to Scout backend.

## Prerequisites

1. CouchDB 3.x instance
2. Network access to the CouchDB HTTP API (port 5984)
3. CouchDB admin or monitoring user credentials
4. Scout Collector installed

## CouchDB Configuration

Verify your CouchDB instance is accessible:

```bash showLineNumbers
# Check CouchDB info
curl -u ${COUCHDB_USERNAME}:${COUCHDB_PASSWORD} http://<couchdb-host>:5984/

# Check node stats
curl -u ${COUCHDB_USERNAME}:${COUCHDB_PASSWORD} \
     http://<couchdb-host>:5984/_node/_local/_stats
```

## Scout Collector Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  couchdb:
    endpoint: http://<couchdb-host>:5984
    username: ${COUCHDB_USERNAME}
    password: ${COUCHDB_PASSWORD}
    collection_interval: 10s

    metrics:
      # Request performance
      couchdb.average_request_time:
        enabled: true

      # Database metrics
      couchdb.database.open:
        enabled: true
      couchdb.database.operations:
        enabled: true

      # System resources
      couchdb.file_descriptor.open:
        enabled: true

      # HTTP metrics
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
        value: ${ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to Base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${SCOUT_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [couchdb]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test CouchDB connectivity:

   ```bash showLineNumbers
   # Check node stats
   curl -u ${COUCHDB_USERNAME}:${COUCHDB_PASSWORD} \
        http://<couchdb-host>:5984/_node/_local/_stats

   # List databases
   curl -u ${COUCHDB_USERNAME}:${COUCHDB_PASSWORD} \
        http://<couchdb-host>:5984/_all_dbs
   ```

## References

- [Scout Collector Setup](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
- [CouchDB Server Statistics](https://docs.couchdb.org/en/stable/api/server/common.html#node-node-name-stats)
- [CouchDB Monitoring Guide](https://docs.couchdb.org/en/stable/maintenance/performance.html)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [MongoDB Monitoring](./mongodb.md) - Alternative document database monitoring
  guide
