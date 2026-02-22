---
title: >
  MinIO OpenTelemetry Monitoring — Cluster Capacity, Drive Health,
  and Collector Setup
sidebar_label: MinIO
id: collecting-minio-telemetry
sidebar_position: 26
description: >
  Collect MinIO metrics with the OpenTelemetry Collector. Monitor
  cluster capacity, drive health, and S3 request rates using the
  Prometheus receiver. Export to base14 Scout.
keywords:
  - minio opentelemetry
  - minio otel collector
  - minio metrics monitoring
  - minio performance monitoring
  - opentelemetry prometheus receiver minio
  - minio observability
  - minio object storage monitoring
  - minio telemetry collection
---

# MinIO

MinIO exposes Prometheus-format metrics at
`/minio/v2/metrics/cluster` on the S3 API port (default 9000). The
OpenTelemetry Collector scrapes this endpoint using the Prometheus
receiver, collecting 60+ metrics across cluster capacity, drive
health, S3 request rates, node resources, ILM lifecycle, and
scanner activity. This guide configures the receiver, sets up
authentication, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| MinIO                  | 2022-01 | latest      |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- MinIO S3 API port (9000) must be accessible from the host running
  the Collector
- Prometheus metrics are exposed by default — no additional config
  needed
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Cluster Capacity**: raw and usable free/total bytes, write
  quorum, erasure set status
- **Drive Health**: online, offline, and total drive counts, healing
  drives, read/write quorum per erasure set
- **S3 Requests**: incoming requests, waiting requests, rejected
  requests (auth, header, invalid, timestamp), traffic bytes
- **Node Resources**: CPU seconds, resident memory, file descriptors,
  goroutines, process uptime
- **ILM & Scanner**: expiry tasks, transition tasks, bucket scans,
  objects and versions scanned

Full metric list: run
`curl -s http://localhost:9000/minio/v2/metrics/cluster` against
your MinIO instance.

## Access Setup

MinIO exposes Prometheus metrics by default. Authentication is
required unless explicitly disabled.

### Option 1: Bearer Token Authentication (Recommended)

Generate a bearer token using the MinIO client:

```bash showLineNumbers title="Generate bearer token"
# Set up mc alias
mc alias set myminio http://localhost:9000 minioadmin minioadmin

# Generate Prometheus scrape config with token
mc admin prometheus generate myminio cluster
```

This outputs a YAML snippet with the bearer token to use in the
Collector config.

### Option 2: Public Metrics (No Authentication)

For testing or internal networks, disable authentication on the
metrics endpoint:

```bash showLineNumbers title="Disable metrics auth"
# Set environment variable before starting MinIO
export MINIO_PROMETHEUS_AUTH_TYPE=public
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check MinIO is running
curl -s http://localhost:9000/minio/health/live

# Verify Prometheus metrics endpoint
curl -s http://localhost:9000/minio/v2/metrics/cluster | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio
          scrape_interval: 30s
          metrics_path: /minio/v2/metrics/cluster
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000

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
MINIO_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

For MinIO instances with the default JWT authentication, add a
bearer token to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (auth)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio
          metrics_path: /minio/v2/metrics/cluster
          bearer_token: ${env:MINIO_PROMETHEUS_TOKEN}
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000
```

Generate the token with `mc admin prometheus generate <alias> cluster`.

### Additional Metric Endpoints

MinIO exposes metrics at multiple paths for different scopes:

```yaml showLineNumbers title="config/otel-collector.yaml (all endpoints)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio-cluster
          metrics_path: /minio/v2/metrics/cluster
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000
        - job_name: minio-node
          metrics_path: /minio/v2/metrics/node
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000
        - job_name: minio-bucket
          metrics_path: /minio/v2/metrics/bucket
          static_configs:
            - targets:
                - ${env:MINIO_HOST}:9000
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "minio"

# Verify MinIO is healthy
curl -s http://localhost:9000/minio/health/live

# Check metrics endpoint directly
curl -s http://localhost:9000/minio/v2/metrics/cluster \
  | grep minio_cluster_capacity_raw_total_bytes
```

## Troubleshooting

### 403 Forbidden on metrics endpoint

**Cause**: Bearer token authentication is required but not
configured.

**Fix**:

1. Generate a token: `mc admin prometheus generate <alias> cluster`
2. Add the `bearer_token` to the scrape config
3. Or set `MINIO_PROMETHEUS_AUTH_TYPE=public` on the MinIO server

### Connection refused on port 9000

**Cause**: Collector cannot reach MinIO at the configured address.

**Fix**:

1. Verify MinIO is running: `docker ps | grep minio` or
   `mc admin info <alias>`
2. Confirm the S3 API port: `curl http://localhost:9000/minio/health/live`
3. Check firewall rules if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Bucket metrics missing

**Cause**: Bucket-level metrics use a separate endpoint.

**Fix**:

1. Add a second scrape job with
   `metrics_path: /minio/v2/metrics/bucket`
2. Bucket metrics only appear after at least one bucket exists with
   objects

## FAQ

**Does this work with MinIO running in Kubernetes?**

Yes. Set `targets` to the MinIO service DNS
(e.g., `minio.minio.svc.cluster.local:9000`). Store the bearer
token in a Kubernetes secret and reference it in the Collector
config. The Collector can run as a sidecar or DaemonSet.

**How do I monitor a distributed MinIO cluster?**

In a distributed setup, each MinIO node exposes the same cluster
metrics. Scrape any one node to get cluster-wide capacity and
health. For per-node metrics, add all node endpoints with the
`/minio/v2/metrics/node` path:

```yaml showLineNumbers title="config/otel-collector.yaml (distributed)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: minio-cluster
          metrics_path: /minio/v2/metrics/cluster
          static_configs:
            - targets:
                - minio-1:9000
        - job_name: minio-nodes
          metrics_path: /minio/v2/metrics/node
          static_configs:
            - targets:
                - minio-1:9000
                - minio-2:9000
                - minio-3:9000
                - minio-4:9000
```

**What does `minio_cluster_health_status` mean?**

A value of `1` indicates the cluster is healthy and has write quorum.
A value of `0` means the cluster is degraded — check
`minio_cluster_drive_offline_total` and
`minio_cluster_nodes_offline_total` to identify the cause.

**What is the difference between v2 and v3 metrics endpoints?**

The `/minio/v2/metrics/` endpoints expose metrics grouped by scope
(cluster, node, bucket, resource). The newer `/minio/metrics/v3/`
endpoints provide finer-grained categories (api, system, scanner,
replication, etc.). Both are supported; v2 is sufficient for most
monitoring needs.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Redis](./redis.md),
  and other components
- **Fine-tune Collection**: Add node and bucket metric endpoints
  for comprehensive coverage

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on MinIO metrics
