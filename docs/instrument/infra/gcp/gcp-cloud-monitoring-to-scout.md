---
date: 2026-08-18
id: gcp-cloud-monitoring-to-scout
title: Sending GCP Managed Service Metrics to Scout with OpenTelemetry
sidebar_label: GCP Cloud Monitoring
description: >
  Collect metrics for GCP managed services — Cloud SQL, Memorystore,
  Pub/Sub, Cloud Run, BigQuery, Compute Engine — into base14 Scout
  using the OpenTelemetry googlecloudmonitoring receiver.
keywords:
  - gcp cloud monitoring
  - google cloud monitoring receiver
  - gcp metrics to scout
  - googlecloudmonitoring opentelemetry
  - cloud sql metrics opentelemetry
  - memorystore redis metrics
  - gcp managed services observability
  - opentelemetry gcp metrics
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I send GCP managed service metrics to OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Use the OpenTelemetry googlecloudmonitoring receiver. It polls the Cloud Monitoring API on an interval and needs only the roles/monitoring.viewer IAM role — no Pub/Sub topic, subscription, or Log Router sink."}},{"@type":"Question","name":"Do GCP metrics need Pub/Sub like Cloud Logging logs do?","acceptedAnswer":{"@type":"Answer","text":"No. Logs are pushed through a Log Router sink into Pub/Sub, but metrics are pulled directly from the Cloud Monitoring API by the collector. There is no sink, topic, subscription, or publisher IAM binding to create."}},{"@type":"Question","name":"How does the collector authenticate to Cloud Monitoring?","acceptedAnswer":{"@type":"Answer","text":"Through Application Default Credentials. On GKE, use Workload Identity so no key file is needed. Elsewhere, set GOOGLE_APPLICATION_CREDENTIALS to a service account key file."}},{"@type":"Question","name":"Can I collect a whole GCP service without listing every metric?","acceptedAnswer":{"@type":"Answer","text":"Yes. Use metric_descriptor_filter with a starts_with expression on metric.type, for example metric.type = starts_with(\"cloudsql.googleapis.com/\"), instead of naming each metric individually."}},{"@type":"Question","name":"Why did all my GCP metrics stop arriving after adding one metric?","acceptedAnswer":{"@type":"Answer","text":"A GAUGE-kind DISTRIBUTION metric can produce an invalid data point that fails the whole scrape batch, dropping every metric from that receiver instance. Remove the distribution-valued metric and the rest resume."}}]}
---

This guide shows you how to collect metrics for **GCP managed
services** — Cloud SQL, Memorystore, Pub/Sub, Cloud Run, BigQuery,
Compute Engine — into Scout using the OpenTelemetry
`googlecloudmonitoring` receiver.

If you also want GCP **logs**, that is a separate mechanism:
see [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md).

## How it works

Anything visible in Cloud Monitoring's Metrics Explorer can be
collected. The receiver **pulls** from the Cloud Monitoring API on an
interval — nothing is pushed to it:

```text
  Managed service (e.g. Cloud SQL)
        │  (GCP publishes metrics automatically)
        ▼
  Cloud Monitoring
        │  Monitoring API (polled)
        ▼
  Scout collector (googlecloudmonitoring receiver)
        │
        ▼
      Scout
```

This is much less setup than the logs path. Because it is a pull, there
is **no** Log Router sink, Pub/Sub topic, subscription, or publisher IAM
binding to create — just one IAM role and a list of metrics.

:::note
Metrics are pulled on a schedule, not streamed. If the collector is down
for a period, that window is not backfilled — unlike the logs path,
where Pub/Sub retains a backlog.
:::

## Prerequisites

- A Scout collector deployed and exporting to Scout
  (the `otlphttp/base14` exporter). See the
  [collector setup guides](../../collector-setup/otel-collector-config.md)
  for deployment options.
- Permission to manage IAM in your GCP project.
- `gcloud` and/or Google Cloud console access.
- The managed services you want to monitor are already running —
  GCP publishes their metrics automatically, with nothing to enable.

Replace these placeholders as you go:

| Placeholder | Meaning |
|---|---|
| `PROJECT_ID` | Your GCP project **ID** (not the display name or number) |

:::note
This guide assumes the metrics and the collector are in the **same** GCP
project. For multiple projects, add one receiver instance per project —
a receiver takes a single `project_id`.
:::

---

## Step 1 — Choose your metrics

Every metric is identified by its full **metric type**, for example
`cloudsql.googleapis.com/database/cpu/utilization`.

Find the ones you want in **Monitoring → Metrics Explorer**. Two things
to check while you are there:

1. **Confirm the metric is actually being emitted.** Enable the
   **Active** toggle in the metric picker, which hides metrics that have
   produced no data. Names vary between projects for the same service,
   so a name copied from documentation may return nothing in yours.
2. **Note the metric's Kind and Type** (shown in the picker as, for
   example, `GAUGE`, `DOUBLE`). This matters — see
   [Metric kinds and types](#metric-kinds-and-types) below.

:::tip Finding the full list for a service
Google publishes every metric it emits, split across alphabetical pages
under [Google Cloud metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp).
Each entry gives the metric type, kind, value type, and unit — so this
is also where you check whether a metric is a distribution.

- [Cloud SQL](https://docs.cloud.google.com/monitoring/api/metrics_gcp_c#gcp-cloudsql)
  — around 100 metrics, including engine-specific ones under
  `database/postgresql/`, `database/mysql/`, and `database/sqlserver/`.
- [Memorystore for Redis](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#gcp-redis)
  — around 40 metrics under `stats/`, `clients/`, `commands/`,
  `replication/`, and `server/`.

Use these to discover candidates, then confirm each one against Metrics
Explorer's **Active** toggle before adding it to your config. The lists
are exhaustive for the service, but no project emits all of them.
:::

---

## Step 2 — Authenticate the collector

The collector needs a Google service account (GSA) with the
**Monitoring Viewer** role. It discovers credentials via
[Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials),
so how you provide them depends on your deployment.

If you already set up
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md), reuse that
service account and add the role below — no second identity needed.

### a. Create the GSA

```bash showLineNumbers
gcloud iam service-accounts create scout-metrics-reader \
  --display-name="Scout collector - Cloud Monitoring reader"
```

### b. Grant Monitoring Viewer

This is a **project-level** role — metrics are read per project, not
per resource:

```bash showLineNumbers
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:scout-metrics-reader@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.viewer" \
  --condition=None
```

:::note
`roles/monitoring.viewer` is read-only. It grants no ability to write
metrics, change alerting, or read logs.
:::

### c. Provide credentials to the collector

#### Service account key file (any environment)

```bash showLineNumbers
gcloud iam service-accounts keys create \
  scout-metrics-reader-key.json \
  --iam-account=scout-metrics-reader@PROJECT_ID.iam.gserviceaccount.com
```

```bash showLineNumbers title=".env"
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-metrics-reader-key.json
```

:::tip GKE Workload Identity
On GKE with Workload Identity enabled, skip the key file. Bind the
collector's Kubernetes ServiceAccount (KSA) to the GSA:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  scout-metrics-reader@PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/COLLECTOR_SERVICE_ACCOUNT]"
```

Then annotate the KSA:

```yaml
serviceAccount:
  annotations:
    iam.gke.io/gcp-service-account: "scout-metrics-reader@PROJECT_ID.iam.gserviceaccount.com"
```

:::

:::warning Deployment, not DaemonSet
Put this receiver on a collector **Deployment**, not a DaemonSet. It
scrapes a remote API rather than local state, so every replica repeats
the same calls — a 3-replica DaemonSet triples your API usage and
produces duplicate series. Where the GSA annotation lives determines
which collector can authenticate at all.
:::

---

## Step 3 — Configure the collector

Add the `googlecloudmonitoring` receiver and a metrics pipeline:

```yaml showLineNumbers title="cloud-monitoring-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Cloud SQL
      - metric_name: "cloudsql.googleapis.com/database/cpu/utilization"
      - metric_name: "cloudsql.googleapis.com/database/memory/utilization"
      - metric_name: "cloudsql.googleapis.com/database/disk/bytes_used"
      - metric_name: "cloudsql.googleapis.com/database/disk/quota"
      - metric_name: "cloudsql.googleapis.com/database/disk/utilization"
      # Memorystore for Redis
      - metric_name: "redis.googleapis.com/stats/memory/usage_ratio"
      - metric_name: "redis.googleapis.com/stats/cpu_utilization_main_thread"
      - metric_name: "redis.googleapis.com/clients/connected"
      - metric_name: "redis.googleapis.com/stats/keyspace_hits"
      - metric_name: "redis.googleapis.com/stats/keyspace_misses"
      - metric_name: "redis.googleapis.com/stats/evicted_keys"

processors:
  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    metrics/gcp:
      receivers: [googlecloudmonitoring]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/base14]
```

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity (see Step 2c)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-metrics-reader-key.json
```

### Receiver options

| Field | Default | Notes |
|---|---|---|
| `project_id` | — | **Required.** One project per receiver instance. |
| `metrics_list` | — | **Required.** One entry per metric or filter. |
| `collection_interval` | `300s` | Minimum `60s`. Shorter intervals cost more API quota. |
| `initial_delay` | `1s` | Delay before the first scrape. |
| `timeout` | `1m` | Timeout for Monitoring API calls. |
| `endpoint` | `monitoring.googleapis.com:443` | Override only for non-standard universe domains. |

### Collecting a whole service at once

Instead of naming every metric, an entry can use
`metric_descriptor_filter` with a `starts_with` expression on
`metric.type`:

```yaml showLineNumbers
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("cloudsql.googleapis.com/")'
```

An entry must set **either** `metric_name` **or**
`metric_descriptor_filter` — never both. Only `project` and
`metric.type` are supported in the filter.

:::warning
A broad prefix collects everything the service emits, including
high-cardinality and distribution-valued metrics you may not want. Start
with an explicit `metric_name` list, and move to a prefix filter only
once you know what a service emits.
:::

---

## Step 4 — Verify

1. **The collector starts cleanly.** Check its logs for
   `PermissionDenied` or `could not find default credentials`:

   ```bash showLineNumbers
   # The exact command depends on your deployment:
   #   Docker:     docker logs <container>
   #   systemd:    journalctl -u otelcol
   #   Kubernetes: kubectl logs deploy/<name> -n <ns>
   ```

2. **Metrics appear in Scout.** Allow at least one full
   `collection_interval` plus export time before concluding anything.

3. **Check the metric landed where you expect.** The GCP metric kind
   does not reliably predict which OTel metric type the receiver
   produces — a `CUMULATIVE` metric can arrive as a gauge. If a metric
   is missing from one view in Scout, look for it as the other type
   before assuming it failed.

---

## Metric kinds and types

Each GCP metric has a **kind** (`GAUGE`, `DELTA`, `CUMULATIVE`) and a
**value type** (`INT64`, `DOUBLE`, `DISTRIBUTION`). Scalar metrics are
straightforward. Distributions need care:

| Value type | Behaviour |
|---|---|
| `INT64`, `DOUBLE`, `BOOL` | Collected normally. |
| `DELTA` + `DISTRIBUTION` | Supported from collector v0.129.0. |
| `GAUGE` + `DISTRIBUTION` | **Not supported.** Can fail the scrape. |

:::warning One bad metric can drop all of them
A `GAUGE`-kind `DISTRIBUTION` can yield an invalid data point that fails
the **entire scrape batch** — dropping every metric from that receiver
instance, not just the offending one. The symptom is confusing: metrics
that worked yesterday all vanish after one new entry was added.

If metrics disappear after a config change, remove the
distribution-valued metric you just added and confirm the rest return.
Latency metrics (`*_latencies`, `*_times`) are the usual culprits.
:::

Most managed-service metrics are scalars, so this rarely bites — but it
is worth checking a metric's value type in Metrics Explorer before
adding it.

---

## Common services

Prefixes to use with Metrics Explorer or `metric_descriptor_filter`:

| Service | Metric type prefix |
|---|---|
| Cloud SQL | `cloudsql.googleapis.com/` |
| Memorystore for Redis | `redis.googleapis.com/` |
| Pub/Sub | `pubsub.googleapis.com/` |
| Cloud Run | `run.googleapis.com/` |
| BigQuery | `bigquery.googleapis.com/` |
| Compute Engine | `compute.googleapis.com/` |
| Cloud Load Balancing | `loadbalancing.googleapis.com/` |
| Cloud Storage | `storage.googleapis.com/` |

:::tip Managed service vs. self-hosted
This receiver only sees **GCP-managed** services. Software you run
yourself on a VM or in Kubernetes — Redis on Compute Engine, self-hosted
PostgreSQL — publishes nothing to Cloud Monitoring beyond VM-level
metrics. For those, use the matching
[component receiver](../../component/redis.md)
instead.
:::

:::note Managed databases: two complementary views
For Cloud SQL, this receiver gives you host-level metrics — CPU, memory,
disk, quota. It cannot see inside the database. For query, table, lock,
and connection detail, point
[pgx](../../../operate/pgx/overview.md) at the instance as well. The two
overlap very little.
:::

---

## Troubleshooting

**No metrics at all, and the collector logs `PermissionDenied`.**
The `roles/monitoring.viewer` grant (Step 2b) is missing or has not
propagated yet — allow a few minutes. Confirm it applies to the project
named in `project_id`.

**"could not find default credentials".**
`GOOGLE_APPLICATION_CREDENTIALS` is unset or points at a missing file.
On GKE, the Workload Identity binding or the KSA annotation is missing.

**One specific metric never appears.**
Usually the name is wrong or that project does not emit it. Paste the
exact metric type into Metrics Explorer with the **Active** toggle on.
Projects legitimately differ in which variants of a metric family they
emit.

**Everything stopped after adding a metric.**
See [Metric kinds and types](#metric-kinds-and-types) — a
distribution-valued metric can fail the whole scrape batch.

**Metrics are duplicated, or API quota is higher than expected.**
More than one collector replica is running the receiver. Each replica
polls independently. Run this receiver on a single-replica Deployment.

**The receiver is configured but nothing happens.**
Confirm it is referenced in a **pipeline**. A receiver that no pipeline
lists is loaded but never runs.
