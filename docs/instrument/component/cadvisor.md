---
title: >
  cAdvisor OpenTelemetry Monitoring - Container CPU, Memory,
  and Collector Setup
sidebar_label: cAdvisor
id: collecting-cadvisor-telemetry
sidebar_position: 48
description: >
  Collect per-container resource metrics from cAdvisor with the
  OpenTelemetry Collector. Monitor container CPU, memory, filesystem,
  and network using the Prometheus receiver and export to base14 Scout.
keywords:
  - cadvisor opentelemetry
  - cadvisor otel collector
  - container metrics monitoring
  - cadvisor prometheus receiver
  - container resource monitoring
  - cadvisor observability
  - per-container cpu memory metrics
  - cadvisor telemetry collection
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does this work with cAdvisor running in Kubernetes?","acceptedAnswer":{"@type":"Answer","text":"Yes. Set targets to the cAdvisor pod or service address. cAdvisor is commonly run as a DaemonSet so each node's containers are measured by a local cAdvisor instance."}},{"@type":"Question","name":"Why are some metric names different from the kubelet's cAdvisor endpoint?","acceptedAnswer":{"@type":"Answer","text":"The kubelet embeds a cAdvisor and exposes a curated subset under /metrics/cadvisor. A standalone cAdvisor exposes the full native metric set on :8080/metrics. The core container and machine metric names match."}},{"@type":"Question","name":"How do I reduce the cAdvisor metric volume?","acceptedAnswer":{"@type":"Answer","text":"Use metric_relabel_configs with a keep action to retain only the metric families you need, for example container_cpu and container_memory series."}},{"@type":"Question","name":"What is the difference between container_memory_usage_bytes and container_memory_working_set_bytes?","acceptedAnswer":{"@type":"Answer","text":"container_memory_usage_bytes includes reclaimable page cache. container_memory_working_set_bytes excludes cache that can be evicted under pressure, so it is the figure the OOM killer acts on and the better signal for memory alerts."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# cAdvisor

cAdvisor (Container Advisor) exposes per-container resource metrics in
Prometheus format on `:8080/metrics`. The OpenTelemetry Collector
scrapes this endpoint with the Prometheus receiver, collecting
container-level CPU, memory, filesystem, and network metrics plus
machine-level capacity, then ships them to base14 Scout. This guide
configures the receiver, connects to a cAdvisor instance, and exports
the metrics.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| cAdvisor               | 0.45    | 0.49+       |
| OTel Collector Contrib | 0.90.0  | 0.152+      |
| base14 Scout           | Any     | -           |

Before starting:

- cAdvisor's metrics port (8080) must be reachable from the host
  running the Collector
- No authentication is required for the metrics endpoint by default
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **CPU**: cumulative per-container CPU time, per-core breakdown
- **Memory**: usage including cache, working set (the OOM-relevant
  figure), and limits
- **Filesystem**: bytes consumed per container per device
- **Network**: bytes received and transmitted per interface
- **Machine**: total CPU cores and memory on the host node

Full metric list: run `curl -s http://localhost:8080/metrics` against
your cAdvisor instance.

## Access Setup

Verify your cAdvisor instance is reachable:

```bash showLineNumbers title="Verify access"
# Confirm cAdvisor is serving metrics
curl -s http://localhost:8080/metrics | head -20

# Check a representative container metric is present
curl -s http://localhost:8080/metrics | grep container_cpu_usage_seconds_total
```

cAdvisor must see the host's container runtime and cgroup state to
populate per-container labels (`container`, `pod`, `namespace`,
`image`). When the host uses containerd rather than docker, point
cAdvisor at the containerd socket with
`--containerd=/run/containerd/containerd.sock`; otherwise the metrics
appear with empty per-container labels.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cadvisor
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - ${env:CADVISOR_HOST}:8080

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
CADVISOR_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Filtering Metrics

cAdvisor exposes a large catalog including Go runtime and process
internals. To collect only the container and machine metrics:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cadvisor
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:CADVISOR_HOST}:8080
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "container_.*|machine_.*"
              action: keep
```

## Metrics Reference

| Metric | Type | Unit | Description |
| --- | --- | --- | --- |
| `container_cpu_usage_seconds_total` | counter | s | Cumulative CPU time consumed per container cgroup. |
| `container_memory_usage_bytes` | gauge | By | Current memory usage including cache. |
| `container_memory_working_set_bytes` | gauge | By | Working-set memory (the OOM-relevant figure). |
| `container_fs_usage_bytes` | gauge | By | Filesystem bytes consumed by the container. |
| `container_network_receive_bytes_total` | counter | By | Cumulative bytes received per interface. |
| `container_network_transmit_bytes_total` | counter | By | Cumulative bytes transmitted per interface. |
| `machine_cpu_cores` | gauge | `{cpu}` | Total CPU cores on the host node. |
| `machine_memory_bytes` | gauge | By | Total memory on the host node. |

Container-level series carry `container`, `pod`, `namespace`, and
`image` labels sourced from cAdvisor. Machine-level series
(`machine_*`) are node-scoped and carry no container labels.

## Workload Guidance

Run any container workload so cAdvisor reports non-trivial
per-container metrics. An idle host with no running containers leaves
the `container_*` counters flat, so confirm at least one workload is
active before checking the data in Scout.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for a successful cadvisor scrape
docker logs otel-collector 2>&1 | grep -i "cadvisor"

# Check the metrics endpoint directly
curl -s http://localhost:8080/metrics | grep container_memory_working_set_bytes
```

## Troubleshooting

### Connection refused on port 8080

**Cause**: The Collector cannot reach cAdvisor at the configured
address.

**Fix**:

1. Verify cAdvisor is running: `docker ps | grep cadvisor`
2. Confirm cAdvisor's metrics port (8080) is published or reachable
   from the Collector host
3. Check firewall rules if the Collector runs on a separate host

### Metrics appear with empty container labels

**Cause**: cAdvisor cannot read the container runtime, so it reports
metric names without per-container `container` / `pod` / `namespace` /
`image` labels.

**Fix**:

1. On a containerd host, pass
   `--containerd=/run/containerd/containerd.sock` to cAdvisor
2. Mount the host's cgroup filesystem (`/sys/fs/cgroup`) into the
   cAdvisor container
3. Confirm cAdvisor runs with the privileges needed to read host
   container state

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Network counters stay flat

**Cause**: The container produces no network traffic, so
`container_network_*` counters do not advance.

**Fix**:

1. This is expected for containers that do not send or receive
   traffic
2. CPU and working-set memory are the reliable liveness signals - use
   those to confirm collection is working

## FAQ

**Does this work with cAdvisor running in Kubernetes?**

Yes. Set `targets` to the cAdvisor pod or service address. cAdvisor is
commonly run as a DaemonSet so each node's containers are measured by
a local cAdvisor instance.

**Why are some metric names different from the kubelet's cAdvisor
endpoint?**

The kubelet embeds a cAdvisor and exposes a curated subset under
`/metrics/cadvisor`. A standalone cAdvisor exposes the full native
metric set on `:8080/metrics`. The core
`container_*` and `machine_*` names match.

**How do I reduce the metric volume?**

Use `metric_relabel_configs` with a `keep` action to retain only the
metric families you need (for example `container_cpu_.*` and
`container_memory_.*`), as shown in
[Filtering Metrics](#filtering-metrics).

**What is the difference between `container_memory_usage_bytes` and
`container_memory_working_set_bytes`?**

`container_memory_usage_bytes` includes reclaimable page cache.
`container_memory_working_set_bytes` excludes cache that can be
evicted under pressure, so it is the figure the OOM killer acts on and
the better signal for memory alerts.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md),
  [etcd](./etcd.md),
  and other components
- **Fine-tune Collection**: Use `metric_relabel_configs` to filter
  specific metric families and reduce storage volume

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  - Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  - Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  - Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  - Alert on container metrics
