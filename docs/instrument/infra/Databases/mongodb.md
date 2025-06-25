---
date: 2025-06-25
id: collecting-mongodb-telemetry
title: MongoDB Metrics Collection with OTel Collector
description: Use Scout to monitor your MongoDB instance with ease
hide_table_of_contents: true
---

## Overview

This guide explains how to set up MongoDB metrics collection using OTel
Collector and forward them to Base14 Scout backend.

## Prerequisites

1. MongoDB instance (standalone or replica set)
2. MongoDB user with `clusterMonitor` role
3. OpenTelemetry Collector installed
4. Base14 Scout access credentials

## MongoDB User Setup

Create a dedicated MongoDB user with the `clusterMonitor` role:

```javascript
use admin
db.createUser({
  user:${MONGO_USER},
  pwd: ${MONGO_PASSWORD},
  roles: [
    { role: "clusterMonitor", db: "admin" },
  ]
})
```

## Otel Collector Configuration

```yaml
receivers:
  mongodb:
    hosts:
      - endpoint: localhost:27017  # Update with your MongoDB host
    username: ${MONGO_USER}
    password: ${MONGO_PASSWORD}
    collection_interval: 60s
    timeout: 10s
    
    # TLS Configuration
    tls:  
      insecure: true
      insecure_skip_verify: true    

    direct_connection: true  # false for replica sets
    
    # Metrics Configuration (Some metrics are disabled by default)
    mongodb.uptime:
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
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true


extensions:
  oauth2client:
    client_id: ${OAUTH2_CLIENT_ID}
    client_secret: ${OAUTH2_CLIENT_SECRET}
    token_url: ${OAUTH2_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  pipelines:
    metrics:
      receivers: [mongodb]
      processors: [batch, resource]
      exporters: [otlphttp/b14]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Base14 Scout dashboard
3. Test MongoDB connectivity:

   ```bash
   mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
     "admin?authSource=admin" --eval "db.serverStatus().ok"
   ```

## References

1. [Base14 OpenTelemetry Collector Setup](
   https://docs.base14.io/instrument/collector-setup/otel-collector-config)
