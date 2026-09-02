---
date: 2026-09-02
id: gcp-monitoring-overview
title: GCP Monitoring with OpenTelemetry - Architecture for base14 Scout
sidebar_label: Overview
sidebar_position: 1
description: >
  How base14 Scout consumes Google Cloud telemetry through the
  OpenTelemetry Collector — Cloud Monitoring pull, Cloud Logging push via
  Pub/Sub, and direct receivers — with the IAM, resource attributes, and
  metric temporality rules every GCP guide depends on.
keywords:
  - gcp monitoring opentelemetry
  - google cloud observability architecture
  - googlecloudmonitoring receiver
  - googlecloudpubsub receiver
  - gcp workload identity opentelemetry
  - gcp metrics to scout
  - gcp logs to scout
  - base14 scout gcp
  - google cloud otel collector
---

This is the architectural landing page for monitoring Google Cloud
infrastructure with **base14 Scout** through the **OpenTelemetry
Collector**. It covers the three paths telemetry can take out of GCP,
the IAM each one needs, and the resource attributes every per-service
guide sets. Read it once, then jump to the guide for the surface you
are instrumenting.

:::note Running this in production

Storing and querying this telemetry at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## The three paths

Google Cloud emits telemetry in three shapes, and a production
deployment usually runs all three.

```text
┌──────────────────────── Google Cloud ─────────────────────────┐
│                                                               │
│  Managed service (Cloud SQL, Pub/Sub, Cloud Run, LB, ...)     │
│        │                          │                           │
│        │ metrics                  │ logs                      │
│        ▼                          ▼                           │
│  Cloud Monitoring          Cloud Logging                      │
│        │                          │                           │
│        │                    Log Router sink                   │
│        │                          ▼                           │
│        │                    Pub/Sub topic                     │
│        │                          │                           │
└────────┼──────────────────────────┼───────────────────────────┘
         │ Monitoring API (pull)    │ subscription (push)
         ▼                          ▼
   googlecloudmonitoring      googlecloudpubsub
       receiver                   receiver
         │                          │
         └──────────┬───────────────┘
                    │        ┌─────────────────────────────────┐
                    │        │ In-VPC collector                │
                    │◀───────┤ postgresql / mysql / redis /    │
                    │        │ nginx / prometheus receivers    │
                    │        │ Cloud Run OTLP sidecar          │
                    │        └─────────────────────────────────┘
                    ▼
              OpenTelemetry Collector
                    │  OTLP
                    ▼
                  Scout
```

| Path | Component | Signals | Freshness | Main cost driver |
|---|---|---|---|---|
| **Cloud Monitoring pull** | `googlecloudmonitoring` receiver | Metrics | 60s floor plus GCP's own export delay (often 3-5 min) | Monitoring API read quota |
| **Cloud Logging push** | `googlecloudpubsub` receiver + `google_cloud_logentry_encoding` | Logs | Seconds | Pub/Sub delivery and egress |
| **Direct scrape** | `postgresql`, `mysql`, `redis`, `nginx`, `prometheus` receivers | Metrics | Your `collection_interval` | Collector compute; no GCP API cost |

The first two are documented once, as mechanism guides:

- [GCP Cloud Monitoring](./gcp-cloud-monitoring-to-scout.md) — the pull
  path, IAM, and the metric-kind rules.
- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) — the Log Router
  sink, Pub/Sub topic and subscription, and log encoding.

The per-service guides below assume you have read whichever of those two
applies, and cover only what is specific to their surface.

## What about traces?

**No GCP managed service emits distributed traces.** Cloud SQL, Pub/Sub,
Cloud Load Balancing, API Gateway and VPC produce metrics and logs only.
Traces in a GCP architecture come from two places:

- **Your application code**, instrumented with an OpenTelemetry SDK. On
  Cloud Run, a collector sidecar is the cleanest way to get them out —
  see [Cloud Run](./cloud-run.md).
- **Google Cloud client libraries**, which emit client spans for calls
  into managed services. Be aware that the Pub/Sub client libraries emit
  `rpc.*` attributes only and no `messaging.*` attributes at all; see
  [Pub/Sub](./pub-sub.md) for what that means downstream.

## Which collector image to run

Run **`otel/opentelemetry-collector-contrib`**. None of the GCP
components — `googlecloudmonitoring`, `googlecloudpubsub`, the
`google_cloud_logentry_encoding` extension — ship in the core collector
distribution, and none of them are in the Scout collector distribution
either. The same is true of the `postgresql`, `mysql`, `redis` and
`nginx` receivers the alternative paths use.

If you already run a Scout collector for application telemetry, add a
**second collector** for the GCP receivers rather than swapping the
image on the first one. That also gives you the separate pipeline the
next section requires.

:::warning Run the pull receiver on a single replica

`googlecloudmonitoring` polls on an interval. Every replica polls
independently, so a three-replica Deployment triples your Monitoring API
usage and produces duplicate series. Put it on a single-replica
Deployment, never a DaemonSet.

:::

## Resource attributes every GCP pipeline sets

The `googlecloudmonitoring` receiver sets `gcp.resource_type` and the
monitored-resource labels as resource attributes — and **no
`service.name`**. Without one, every GCP metric arrives as
`unknown_service`, which in the Scout data lake means it shares a sort-key
prefix with everything else that went unnamed.

Set one per surface, following the convention already used for infra
telemetry across the fleet (`system-metrics`, `kubernetes-metrics`):

| Surface | `service.name` | `cloud.platform` |
|---|---|---|
| Cloud SQL | `cloudsql-metrics` | `gcp_cloud_sql` |
| Memorystore | `memorystore-metrics` | `gcp_memorystore` |
| Cloud Load Balancing | `loadbalancing-metrics` | `gcp_load_balancing` |
| API Gateway (managed) | `apigateway-metrics` | `gcp_api_gateway` |
| nginx gateway (self-managed) | `nginx-gateway-metrics` | `gcp_kubernetes_engine` |
| Pub/Sub | `pubsub-metrics` | `gcp_pubsub` |
| Cloud Run | `cloudrun-metrics` | `gcp_cloud_run` |
| VPC | `vpc-logs` (flow logs), `vpc-metrics` (Cloud NAT) | `gcp_vpc` |

The block each guide repeats, with its own values substituted:

```yaml showLineNumbers title="gcp-common.yaml"
processors:
  resource/cloudsql:
    attributes:
      - {key: service.name, value: cloudsql-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_cloud_sql, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      # Regional surfaces only — omit for Pub/Sub, Cloud Load Balancing and VPC
      - {key: cloud.region, value: "${env:GCP_REGION}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}
```

`cloud.region` belongs only on surfaces that have one. Cloud SQL and
Memorystore instances live in a region; Pub/Sub topics, global load
balancers and VPC networks do not, and stamping a region on them
invents a dimension that is not real.

:::note Semconv version note

`deployment.environment.name` is the current OTel attribute (semantic
conventions v1.27+, stable in v1.40.0). Scout's UI filters on the
lowercase `environment` key, so emit it alongside the OTel-native
`deployment.environment.name`. The legacy `deployment.environment` is
still accepted for backward compatibility.

:::

:::warning Give each surface its own pipeline

The `insert` action on `service.name` and the `/cloudsql` suffix on the
processor are both load-bearing. A blanket `resource` processor that
`upsert`s a single `service.name` across a shared pipeline will stamp
your application's name onto every GCP metric, and they become
indistinguishable from application telemetry. Keep one
`receiver/processor/pipeline` triple per surface, all suffix-keyed, so
they coexist in one collector without overwriting each other.

:::

## Metric kinds and temporality

Each GCP metric has a **kind** (`GAUGE`, `DELTA`, `CUMULATIVE`) and a
**value type** (`INT64`, `DOUBLE`, `DISTRIBUTION`). The receiver maps
them like this:

| GCP kind and type | OTel result | Temporality |
|---|---|---|
| `GAUGE` + scalar | Gauge | — |
| `CUMULATIVE` + scalar | Monotonic sum | Cumulative |
| `DELTA` + scalar | Sum | **Delta** |
| `DELTA` + `DISTRIBUTION` | Histogram | **Delta** |
| `GAUGE` + `DISTRIBUTION` | **Unsupported** | — |

Two consequences:

**Most GCP counters are `DELTA`.** `request_count`,
`ack_message_count`, `disk/read_ops_count` and their siblings all arrive
as delta sums, not cumulative ones. A panel or rollup that assumes a
monotonically increasing counter — one that applies `rate()`-style
logic, or subtracts consecutive points — will be wrong against them. Sum
delta points over the window instead.

**A `GAUGE`-kind `DISTRIBUTION` can drop everything.** It yields an
invalid data point that fails the *entire scrape batch*, so every metric
from that receiver instance disappears, not just the offending one. If
metrics vanish after a config change, remove the distribution-valued
metric you just added. Latency metrics (`*_latencies`, `*_times`) are
the usual culprits. Each per-service guide flags its distributions.

## Authentication

Both GCP receivers use **Application Default Credentials**. Create one
Google service account (GSA) and grant it what the paths you use need:

| Path | Role | Scope |
|---|---|---|
| Cloud Monitoring pull | `roles/monitoring.viewer` | Project |
| Cloud Logging push | `roles/pubsub.subscriber` | The subscription |

```bash showLineNumbers
gcloud iam service-accounts create scout-telemetry-reader \
  --display-name="base14 Scout telemetry reader"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:scout-telemetry-reader@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.viewer"
```

:::tip GKE Workload Identity

On GKE, bind the GSA to the collector's Kubernetes service account and
skip key files entirely:

```bash showLineNumbers
gcloud iam service-accounts add-iam-policy-binding \
  scout-telemetry-reader@PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/KSA_NAME]"
```

Then annotate the KSA:

```yaml showLineNumbers
metadata:
  annotations:
    iam.gke.io/gcp-service-account: scout-telemetry-reader@PROJECT_ID.iam.gserviceaccount.com
```

:::

Elsewhere, point `GOOGLE_APPLICATION_CREDENTIALS` at a service account
key file. Both mechanism guides cover this in full.

## One project per receiver

`project_id` is singular. To collect from several projects, add one
receiver instance per project, each suffix-keyed:

```yaml showLineNumbers title="multi-project.yaml"
receivers:
  googlecloudmonitoring/prod:
    project_id: my-prod-project
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("cloudsql.googleapis.com/")'
  googlecloudmonitoring/staging:
    project_id: my-staging-project
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("cloudsql.googleapis.com/")'
```

Grant the GSA `roles/monitoring.viewer` in each project.

## Verifying data has landed

GCP telemetry lands in the base `otel_metrics_*` and `otel_logs` tables,
with the GCP labels in the `ResourceAttributes` and `Attributes` maps.
The metric name is the **raw GCP metric type**, not a translated one —
so `MetricName` is literally
`cloudsql.googleapis.com/database/cpu/utilization`.

Every verification query in these guides filters on `ServiceName`,
`MetricName` and a bounded one-hour window, and caps itself:

```sql showLineNumbers
SELECT MetricName, count() AS points, max(Value) AS latest
FROM otel_metrics_gauge
WHERE ServiceName = 'cloudsql-metrics'
  AND MetricName = 'cloudsql.googleapis.com/database/cpu/utilization'
  AND TimeUnix >= now() - INTERVAL 1 HOUR
GROUP BY MetricName
SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
```

Delta counters land in `otel_metrics_sum` and distributions in
`otel_metrics_histogram` — if a metric is missing from one table, look
for it in the other before concluding it failed.

## Per-surface guides

| Guide | Lead path | Covers |
|---|---|---|
| [Cloud SQL](./cloud-sql.md) | Cloud Monitoring | Host and engine metrics, database logs, in-database scraping |
| [Memorystore](./memorystore.md) | Cloud Monitoring | Redis, Redis Cluster and Valkey engines |
| [Cloud Load Balancing](./load-balancing.md) | Cloud Monitoring + Logging | Request rates, latency distributions, access logs |
| [API Gateway and nginx](./api-gateway.md) | Cloud Monitoring / Prometheus | Managed API Gateway and self-managed nginx gateways |
| [Pub/Sub](./pub-sub.md) | Cloud Monitoring | Topic and subscription health, backlog alerting |
| [Cloud Run](./cloud-run.md) | OTLP sidecar | Application traces, platform metrics, request logs |
| [VPC](./vpc.md) | Cloud Logging | Flow logs, Cloud NAT, network metrics |

## FAQ

### How does base14 Scout collect Google Cloud telemetry?

base14 Scout collects Google Cloud telemetry through the OpenTelemetry
Collector, along three paths. The `googlecloudmonitoring` receiver pulls
metrics from the Cloud Monitoring API, the `googlecloudpubsub` receiver
consumes logs that a Log Router
sink pushes into Pub/Sub, and standard receivers such as `postgresql`
and `redis` scrape services directly from inside the VPC.

### Which collector distribution do I need for GCP?

GCP telemetry needs the `otel/opentelemetry-collector-contrib`
distribution. The GCP receivers and the Cloud Logging encoding extension
are contrib components, present in neither the core collector nor the
Scout collector distribution.

### Do GCP managed services emit distributed traces?

No GCP managed service emits distributed traces. Cloud SQL, Pub/Sub,
Cloud Load Balancing, API Gateway and VPC emit metrics and logs only.
Traces come from your own application code, or from Google Cloud client
libraries emitting client spans.

### Why do my GCP metrics show up as unknown_service?

The `googlecloudmonitoring` receiver does not set `service.name`. Add a
`resource` processor that inserts one per surface — `cloudsql-metrics`,
`pubsub-metrics`, and so on. Because `ServiceName` is the leading sort
key in the Scout data lake, leaving it unset makes queries far more
expensive.

### Why does my GCP counter graph look wrong?

Most GCP counters have `DELTA` kind and arrive as delta sums, not
cumulative ones. Sum the points over your window rather than applying
counter-rate logic that assumes a monotonically increasing series.

### Can one collector serve several GCP projects?

One collector can serve several projects, but `project_id` is singular
per receiver — add one receiver instance per project, and grant the
service account `roles/monitoring.viewer` in each.

## Reference

- [Google Cloud metrics list](https://docs.cloud.google.com/monitoring/api/metrics_gcp)
- [googlecloudmonitoring receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/googlecloudmonitoringreceiver)
- [googlecloudpubsub receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/googlecloudpubsubreceiver)
- [Cloud Logging LogEntry encoding extension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/encoding/googlecloudlogentryencodingextension)
- [OTel cloud resource semantic conventions](https://opentelemetry.io/docs/specs/semconv/resource/cloud/)

## Related Guides

- [GCP Cloud Monitoring](./gcp-cloud-monitoring-to-scout.md) - the pull
  path in full, including IAM and metric selection.
- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - the Log Router
  sink and Pub/Sub subscription setup every log guide reuses.
- [Collector setup](../../collector-setup/otel-collector-config.md) -
  deployment options for the collector itself.
