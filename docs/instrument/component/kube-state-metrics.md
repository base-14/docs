---
title: >
  Monitor kube-state-metrics with OpenTelemetry - Kubernetes State Metrics
sidebar_label: kube-state-metrics
id: collecting-kube-state-metrics-telemetry
sidebar_position: 49
description: >
  Collect kube_* Kubernetes object state metrics with the OpenTelemetry
  Collector's Prometheus receiver. Monitor pod phases, deployment replica
  health, node conditions, and job success. Export to base14 Scout.
keywords:
  - kube-state-metrics opentelemetry
  - ksm otel collector
  - kubernetes state metrics
  - kube_pod_status_phase
  - kubernetes object metrics
  - ksm prometheus
  - kubernetes observability
  - ksm telemetry
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which port does kube-state-metrics use for metrics?","acceptedAnswer":{"@type":"Answer","text":"KSM serves Prometheus metrics and /livez on the main port 8080, and its own self-telemetry plus /readyz on port 8081. Scrape port 8080 for the kube object-state series."}},{"@type":"Question","name":"What does kube_pod_status_phase report?","acceptedAnswer":{"@type":"Answer","text":"One time series per pod per phase. The pod's current phase reads 1 and the other phases read 0, so summing across the Running phase gives the count of running pods in a namespace."}},{"@type":"Question","name":"How do I monitor a Job's success with kube-state-metrics?","acceptedAnswer":{"@type":"Answer","text":"kube_job_status_succeeded reaches 1 when a Job's pod completes successfully. Pair it with kube_job_status_failed to alert on Jobs that exhaust their backoff limit."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# kube-state-metrics

kube-state-metrics (KSM) listens on port 8080 and serves Prometheus-format
metrics that reflect the live state of Kubernetes objects - pods,
deployments, nodes, jobs, HPAs, and namespaces. The OpenTelemetry Collector
scrapes this endpoint with the Prometheus receiver, then exports the
`kube_*` series to base14 Scout. This guide configures the receiver and
ships the metrics.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Kubernetes             | 1.27    | 1.34+       |
| kube-state-metrics     | 2.10    | 2.19        |
| OTel Collector Contrib | 0.90.0  | 0.152+      |
| base14 Scout           | Any     | -           |

Before starting:

- A running Kubernetes cluster.
- kube-state-metrics deployed in the cluster - see the
  [upstream KSM project](https://github.com/kubernetes/kube-state-metrics).
- An OTel Collector with the Prometheus receiver, reachable from the
  cluster - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).
- base14 Scout credentials.

## What You'll Monitor

- **Pod health**: phase (Pending/Running/Succeeded/Failed), readiness, and
  container restart counts.
- **Deployment health**: desired, spec, and available replica counts.
- **Node conditions**: Ready, MemoryPressure, DiskPressure, PIDPressure, and
  allocatable cpu/memory per node.
- **Job success**: succeeded and failed pod counts per Job.
- **Namespace lifecycle**: Active and Terminating phases.

## Configuration

KSM serves its metrics on port 8080 at the default `/metrics` path. Point a
Prometheus scrape job at the KSM Service:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: kube-state-metrics
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets:
                - kube-state-metrics.kube-state-metrics.svc:8080

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
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Metrics Reference

| Metric | Type | Unit | Dimensions | Notes |
| --- | --- | --- | --- | --- |
| `kube_pod_status_phase` | gauge | `1` | `namespace`, `pod`, `phase` | One series per pod per phase; the active phase reads 1, the rest 0. |
| `kube_pod_container_status_restarts_total` | sum | `1` | `namespace`, `pod`, `container` | Monotonic restart counter per container. |
| `kube_pod_status_ready` | gauge | `1` | `namespace`, `pod`, `condition` | Pod Ready condition (1/0). |
| `kube_deployment_status_replicas` | gauge | `1` | `namespace`, `deployment` | Desired replica count reflected by the Deployment status. |
| `kube_deployment_status_replicas_available` | gauge | `1` | `namespace`, `deployment` | Available (ready) replicas. |
| `kube_deployment_spec_replicas` | gauge | `1` | `namespace`, `deployment` | Spec-requested replicas. |
| `kube_node_status_condition` | gauge | `1` | `node`, `condition`, `status` | One series per node per condition per status. |
| `kube_node_status_allocatable` | gauge | mixed | `node`, `resource`, `unit` | Allocatable cpu/memory/ephemeral-storage per node. |
| `kube_namespace_status_phase` | gauge | `1` | `namespace`, `phase` | Namespace lifecycle phase (Active/Terminating). |
| `kube_job_status_succeeded` | gauge | `1` | `namespace`, `job_name` | Succeeded pods for a Job. |
| `kube_job_status_failed` | gauge | `1` | `namespace`, `job_name` | Failed pods for a Job. |
| `kube_hpa_status_current_replicas` | gauge | `1` | `namespace`, `hpa` | Current replicas an HPA reports. |

## Verify the Setup

Start the Collector and confirm a KSM metric arrives within ~60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm KSM is serving metrics in-cluster
kubectl -n kube-state-metrics port-forward svc/kube-state-metrics 8080:8080 &
curl -s http://localhost:8080/metrics | grep kube_pod_status_phase

# Check the Collector logs for a successful scrape
kubectl logs deployment/otel-collector | grep -i kube_pod_status_phase
```

## Troubleshooting

### No KSM metrics in the Collector

**Cause**: The Collector cannot reach the KSM Service.

**Fix**:

1. Confirm KSM is Running:
   `kubectl -n kube-state-metrics get pods`.
2. Verify the Service DNS and port match the scrape target:
   `kubectl -n kube-state-metrics get svc kube-state-metrics`.
3. Port-forward and curl `/metrics` to confirm the endpoint serves data.

### Metric name present but no datapoints

**Cause**: KSM lacks RBAC to list/watch the object kind, so the series is
empty.

**Fix**:

1. Confirm the KSM ServiceAccount is bound to a ClusterRole granting
   `list`/`watch` on the object kinds you expect.
2. Check the KSM logs for `forbidden` errors:
   `kubectl -n kube-state-metrics logs deployment/kube-state-metrics`.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the Prometheus receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Which port does KSM use for metrics?**

KSM serves Prometheus metrics and `/livez` on the main port 8080, and its
own self-telemetry plus `/readyz` on port 8081. Scrape port 8080 for the
`kube_*` object-state series.

**What does `kube_pod_status_phase` report?**

One time series per pod per phase. The pod's current phase reads 1 and the
other phases read 0, so summing across `phase="Running"` gives the count of
running pods in a namespace.

**How do I monitor a Job's success?**

`kube_job_status_succeeded` reaches 1 when a Job's pod completes
successfully. Pair it with `kube_job_status_failed` to alert on Jobs that
exhaust their backoff limit.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md),
  [Redis](./redis.md),
  and other components
- **Set Up Alerts**: Alert on pod restarts and Job failures. See
  [Creating Alerts](../../guides/creating-alerts-with-logx.md)

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  - Advanced collector configuration
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  - Production deployment
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  - Alert on KSM metrics

Validated against: kube-state-metrics v2.13 on a 3-node managed Kubernetes
cluster.
