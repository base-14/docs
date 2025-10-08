---
date: 2025-06-25
id: collecting-mongodb-telemetry
title: MongoDB
description: Use Scout to monitor your MongoDB instance with ease
---

## Overview

This guide explains how to set up MongoDB metrics collection using OTel
Collector and forward them to Scout backend.

## Prerequisites

1. MongoDB instance (standalone or replica set)
2. MongoDB user with `clusterMonitor` role
3. OpenTelemetry Collector installed
4. Scout access credentials

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
    
    metrics:
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

# Export to Scout Collector
exporters:
  otlphttp:
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [mongodb]
      processors: [batch, resource]
      exporters: [otlphttp]
```

## Verification

1. Check collector logs for errors
2. Verify metrics in Scout dashboard
3. Test MongoDB connectivity:

   ```bash
   mongosh "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@localhost:27017/"\
     "admin?authSource=admin" --eval "db.serverStatus().ok"
   ```

## References

1. [Base14 OpenTelemetry Collector Setup](
   https://docs.base14.io/instrument/collector-setup/otel-collector-config)
