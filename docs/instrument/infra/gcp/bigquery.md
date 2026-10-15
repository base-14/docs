---
date: 2026-10-15
id: collecting-gcp-bigquery-telemetry
title: BigQuery Monitoring with OpenTelemetry - Audit Logs, Metrics & Alerts
sidebar_label: BigQuery
sidebar_position: 11
description: >
  Monitor BigQuery in base14 Scout with OpenTelemetry. Collect slot usage,
  query counts and bytes billed with the googlecloudmonitoring receiver, and
  stream BigQuery Admin Activity and Data Access audit logs for per-job cost,
  user attribution and table access through Pub/Sub.
keywords:
  - bigquery monitoring
  - bigquery audit logs
  - bigquery data access logs
  - bigquery table access audit
  - bigquery logs opentelemetry
  - bigquery slot usage monitoring
  - bigquery query cost monitoring
  - bigquery bytes billed
  - bigquery metrics scout
  - bigquery observability
  - bigquery pubsub audit logs
---

BigQuery reports two kinds of telemetry. Cloud Monitoring holds aggregate
metrics: slots in use, queries in flight, bytes scanned and stored. Cloud
Audit Logs hold one entry per job with the user, the SQL text, the tables
read, the bytes billed and the slot time. This guide collects both into
Scout: metrics with the `googlecloudmonitoring` receiver, and audit logs
through the Pub/Sub path from
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md).

This page covers only what is specific to BigQuery. The generic GCP
setup lives in two other guides, and the steps below assume you have
completed them.

:::note Running this in production

Storing and querying these logs at production volume is what base14 Scout
does. [Check out Scout Logs](https://base14.io/scout/logs).

:::

## Prerequisites

Complete these before configuring anything on this page:

1. **[GCP Monitoring overview](./overview.md)**, required for both
   metrics and logs. It sets up the collector image, the service
   account, `roles/monitoring.viewer`, and the resource attributes every
   GCP pipeline sets.
2. **[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md), Steps 2 to
   5**, required for the logs sections. They create the `scout-logs`
   Pub/Sub topic and subscription, give the collector Subscriber on it,
   and add the `googlecloudpubsub` receiver with the
   `google_cloud_logentry_encoding` extension. The sinks on this page
   publish into that topic; without it, the logs never reach the
   collector. Step 3 also shows the Publisher grant that each sink on
   this page needs; its load balancer sink itself is only an example and
   can be skipped.

If you only want BigQuery metrics, the first guide is enough.

## Overview

Each source answers a different question:

- **Metrics** show the shape of usage: slot consumption against your
  reservation, how many queries are running, how many bytes you are
  billed for per hour. They are cheap to collect, but they cannot tell
  you who ran a query or which one was expensive.
- **Audit logs** show each job: the principal, the statement, the
  referenced tables, `totalBilledBytes` and `totalSlotMs`. They are the
  source for cost attribution and for access questions.

Which of these maps to your bill depends on the pricing model. On
on-demand pricing you pay per byte billed, so `scanned_bytes_billed` and
the per-job `totalBilledBytes` are the cost signals. On capacity pricing
(BigQuery editions) you pay for slots, so slot allocation against your
reservation is the number to watch.

This guide does not cover exporting logs *to* BigQuery, which is a Log
Router sink with a BigQuery dataset as its destination. See the
[FAQ](#is-this-the-same-as-exporting-cloud-logging-logs-to-bigquery).

## BigQuery at a glance

All metric types start `bigquery.googleapis.com/`, elided below.

| Layer | Source | Prefix or filter | Collected by |
|---|---|---|---|
| Query and job counts | Cloud Monitoring | `query/`, `job/` | `googlecloudmonitoring` |
| Slot usage | Cloud Monitoring | `slots/` | `googlecloudmonitoring` |
| Storage and streaming ingest | Cloud Monitoring | `storage/` | `googlecloudmonitoring` |
| Completed jobs, per-job cost | Data Access audit log | `resource.type="bigquery_project"` | `googlecloudpubsub` |
| Dataset and table changes | Admin Activity audit log | `resource.type="bigquery_dataset"` | `googlecloudpubsub` |
| Table reads and writes (optional) | Data Access audit log | `resource.type="bigquery_dataset"` | `googlecloudpubsub` |

The monitored resources are `bigquery_project` (labels `project_id`,
`location`) for query, job and slot metrics, and `bigquery_dataset`
(labels `project_id`, `dataset_id`) for storage metrics. A few older
metrics, including `query/scanned_bytes`, are reported against the
`global` resource and carry only `project_id`.

---

## Receiver configuration

```yaml showLineNumbers title="bigquery-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/bigquery:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Queries and jobs
      - metric_name: "bigquery.googleapis.com/query/count"
      - metric_name: "bigquery.googleapis.com/query/execution_count"
      - metric_name: "bigquery.googleapis.com/job/num_in_flight"
      # Bytes scanned and billed
      - metric_name: "bigquery.googleapis.com/query/scanned_bytes_billed"
      - metric_name: "bigquery.googleapis.com/query/statement_scanned_bytes_billed"
      # Slots
      - metric_name: "bigquery.googleapis.com/slots/allocated_for_project"
      - metric_name: "bigquery.googleapis.com/slots/allocated"
      - metric_name: "bigquery.googleapis.com/slots/assigned"
      - metric_name: "bigquery.googleapis.com/slots/max_assigned"
      # Storage and streaming ingest
      - metric_name: "bigquery.googleapis.com/storage/stored_bytes"
      - metric_name: "bigquery.googleapis.com/storage/table_count"
      - metric_name: "bigquery.googleapis.com/storage/insertall_inserted_rows"
      - metric_name: "bigquery.googleapis.com/storage/uploaded_bytes_billed"

processors:
  resource/bigquery:
    attributes:
      - {key: service.name, value: bigquery-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_bigquery, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

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
    metrics/bigquery:
      receivers: [googlecloudmonitoring/bigquery]
      processors: [memory_limiter, resource/bigquery, batch]
      exporters: [otlphttp/base14]
```

The `slots/assigned` and `slots/max_assigned` metrics only report
data when the project has a reservation assignment it can see. On
on-demand projects, and on editions projects that rely on autoscaling
without a visible reservation, they never emit; drop them there and
alert on absolute slot counts instead (see [Alert tuning](#alert-tuning)).

Some projects emit only `query/statement_scanned_bytes_billed` and never
`query/scanned_bytes_billed`. Collect the `statement_` variant either
way; it is the one this page's alerts use.

:::warning Leave out `query/execution_times`

`query/execution_times` is a `GAUGE`-kind `DISTRIBUTION`. The receiver
cannot convert it, and the invalid data point fails the whole scrape
batch, so every metric in this receiver disappears with it. The same
applies to `query/column_metadata_index_staleness`. Take query latency
from the audit log instead (`jobStats.startTime` and `endTime`), or see
[Metric kinds and temporality](./overview.md#metric-kinds-and-temporality).

:::

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

### Why some metrics arrive hours late

BigQuery publishes several metrics with a long ingestion delay. The
receiver reads each metric's delay from its descriptor and shifts its
query window back by that amount, so the points do arrive, with their
original timestamps, but only after the delay has passed:

| Metric | Sampled every | Visible after up to |
|---|---|---|
| `query/count`, `slots/*`, `job/num_in_flight` | 60s | 7 to 12 minutes |
| `query/statement_scanned_bytes_billed` | 60s | 3 minutes |
| `query/scanned_bytes`, `query/scanned_bytes_billed` | 60s | about 6 hours |
| `storage/uploaded_bytes_billed` | 60s | about 6 hours |
| `storage/stored_bytes`, `storage/table_count` | 30 minutes | 3 hours |

For a near-real-time cost signal, use
`query/statement_scanned_bytes_billed` (Beta), which also splits bytes by
`statement_type`. Keep `query/scanned_bytes_billed` for daily totals.

### Collecting the whole service

A `metric_descriptor_filter` on `starts_with("bigquery.googleapis.com/")`
picks up `query/execution_times`, which takes down the receiver as
described above. Keep the explicit list.

---

## Authentication and IAM

The metrics path needs `roles/monitoring.viewer` on the project, granted
to the collector's service account. Nothing BigQuery-specific is
required; the full setup is in
[GCP Monitoring overview](./overview.md#authentication).

The audit log path needs the same Pub/Sub roles as any other Cloud
Logging source: Pub/Sub Publisher for the sink's writer identity, and
Pub/Sub Subscriber for the collector. See Steps 3 and 4 of
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md). The collector
never needs a BigQuery role, because it does not query BigQuery.

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `query/count` | Gauge, `INT64` | count | Queries in flight, split by `priority`. Sustained growth means queries are queuing for slots. |
| `query/execution_count` | **Delta** sum | count | Query throughput, split by `priority` and `caching_mode`. |
| `job/num_in_flight` | Gauge, `INT64` | count | All jobs (query, load, extract, copy) by `job_type` and `state`. Pending jobs are waiting for slots. |
| `query/scanned_bytes_billed` | **Delta** sum | bytes | The on-demand bill, about 6 hours behind. |
| `query/statement_scanned_bytes_billed` | **Delta** sum | bytes | The same bill within minutes, split by `statement_type`. |
| `slots/allocated_for_project` | Gauge, `INT64` | slots | Slots the project is using right now. |
| `slots/allocated` | Gauge, `INT64` | slots | The same, split by `reservation` and `job_type`. Google notes the per-reservation split can be inaccurate. |
| `slots/assigned` | Gauge, `INT64` | slots | Baseline slots assigned to the project from a reservation. |
| `slots/max_assigned` | Gauge, `INT64` | slots | Ceiling including autoscale; the denominator for saturation. |
| `storage/stored_bytes` | Gauge, `INT64` | bytes | Logical bytes per dataset, labeled for the 100 largest tables. |
| `storage/table_count` | Gauge, `INT64` | count | Table sprawl per dataset. |
| `storage/insertall_inserted_rows` | **Delta** sum | rows | Streaming insert rate through the `insertAll` API. A drop to zero usually means a broken producer. |
| `storage/uploaded_bytes_billed` | **Delta** sum | bytes | Billed streaming ingest. |

The delta-marked rows arrive with delta temporality and land in
`otel_metrics_sum`. Sum them over the window rather than applying
counter-rate logic; see
[Metric kinds and temporality](./overview.md#metric-kinds-and-temporality).

---

## Cardinality control

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `project_id` | Resource label | One per project | Yes |
| `location` | Resource label | Small | Yes |
| `dataset_id` | Resource label on `storage/*` | One per dataset | Yes |
| `table` | Metric label on `storage/*` | Up to 100 per dataset | Only if you track individual tables |
| `reservation`, `job_type` | Metric label on `slots/*` | Small | Yes |
| `statement_type` | Metric label | Bounded enum | Yes |

`table` is the label that grows. Projects with many datasets produce
up to 100 `stored_bytes` series per dataset. If you track storage per
dataset only, drop it:

```yaml showLineNumbers title="bigquery-config.yaml"
processors:
  transform/bigquery:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - delete_key(attributes, "table")
```

---

## Alert tuning

| Signal | Source | Warning | Critical | Notes |
|---|---|---|---|---|
| Slot saturation | `slots/allocated_for_project` / `slots/max_assigned` | > 0.85 for 15m | > 0.95 for 15m | Needs a reservation the project can see. Queries queue rather than fail. |
| Slot usage, no ceiling visible | `slots/allocated_for_project` | Above your normal P99 for 5m | Above the P99 peak for 2m | Use when `slots/max_assigned` never emits. Set thresholds from a week of data. |
| Queued jobs | `job/num_in_flight` with pending `state` | > 0 for 10m | > 0 for 30m | The user-visible effect of slot saturation. |
| Billed bytes spike | `query/statement_scanned_bytes_billed` | 2x the same hour last week | 5x the same hour last week | On-demand pricing. Follow up in the audit log to find the job. |
| Streaming stopped | `storage/insertall_inserted_rows` | 0 for 15m | 0 for 30m | Only for tables you expect to stream continuously. |
| Failed jobs | Audit log, `gcp.bigquery.job.error` present | > 5% of jobs for 15m | > 20% for 15m | See [Logs](#logs). |

---

## Logs

BigQuery records job and table activity in Cloud Audit Logs; it writes
no separate service logs for queries. "BigQuery audit logs" therefore
covers all four audit log types, Data Access included.

This section assumes the Pub/Sub pipeline from
[Prerequisites](#prerequisites) is already running. It adds only the
BigQuery-specific parts: which entries to route, and how to keep the
per-job cost fields.

### The four audit log types

| Audit log type | What BigQuery writes there | On by default | Routed below |
|---|---|---|---|
| Admin Activity | Dataset, table, routine and IAM changes | Yes, cannot be disabled | Yes |
| Data Access | Jobs (`jobInsertion`, `jobChange`), table reads (`tableDataRead`), table writes (`tableDataChange`) | Yes for BigQuery, cannot be disabled | Job completions; table reads and writes optionally |
| System Event | Actions Google takes, such as deleting a table when it expires | Yes | No |
| Policy Denied | Requests blocked by VPC Service Controls | Yes | No |

Data Access logs are normally off for GCP services until you enable
them. BigQuery is the exception, so there is nothing to enable here.

The skipped entries are either low volume (System Event, Policy Denied)
or duplicate what the job completion carries (`jobInsertion`). To route
them anyway, add a sink on `resource.type="bigquery_project"` or
`bigquery_dataset` with the matching `logName` suffix
(`system_event`, `policy`) into the shared topic.

### Which entries to route

BigQuery writes audit logs in two formats. Use the newer one:

| Format | `resource.type` | Details in | Status |
|---|---|---|---|
| `BigQueryAuditMetadata` | `bigquery_project` (jobs), `bigquery_dataset` (storage) | `protoPayload.metadata` | Current, recommended by Google |
| `AuditData` | `bigquery_resource` | `protoPayload.serviceData` | Legacy |

Job events are in the **Data Access** log. Each job writes several
entries (insertion, state changes, one `tableDataRead` per table it
reads). The entry worth
keeping is the final state change, which carries the full statistics:

```text
logName="projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Fdata_access"
protoPayload.serviceName="bigquery.googleapis.com"
protoPayload.metadata.jobChange.after="DONE"
```

BigQuery also writes a legacy `jobservice.jobcompleted` entry for the
same job. Filtering on `protoPayload.metadata` excludes it, so each job
arrives once.

Dataset, table, routine and IAM changes are in the **Admin Activity**
log under `resource.type="bigquery_dataset"`.

### Admin activity: the shared topic

Route dataset and table changes into the topic your collector already
consumes. The `google_cloud_logentry_encoding` extension recognizes
audit entries and maps the common fields to `gcp.audit.*` attributes
plus `user.email` and `client.address`:

```bash showLineNumbers
gcloud logging sinks create scout-bigquery-admin \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="bigquery_dataset" AND logName:"cloudaudit.googleapis.com%2Factivity"'
```

Grant the new sink's writer identity Publisher on the topic, as in Step
3 of the Cloud Logging guide.

### Completed jobs: a dedicated subscription

:::warning The encoding extension drops BigQuery job statistics

Collector versions that parse audit logs into `gcp.audit.*` attributes
do not map `protoPayload.metadata`, and do not keep it in the body
either. That field holds everything BigQuery-specific: the SQL text,
`totalBilledBytes`, `totalSlotMs`, referenced tables and errors. Route
completed jobs through the shared topic and you get the user and the
method, but not the cost.

:::

To keep the job statistics, give completed jobs their own topic and
subscription, read them with the `text_encoding` extension so the whole
`LogEntry` arrives as a JSON string, and extract the fields with OTTL.

Create the topic, subscription, sink and both IAM bindings exactly as in
Steps 2 to 4 of
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md), with these names
and this filter:

```bash showLineNumbers
gcloud pubsub topics create scout-bigquery-jobs

gcloud pubsub subscriptions create scout-bigquery-jobs-sub \
  --topic=scout-bigquery-jobs \
  --ack-deadline=30

gcloud logging sinks create scout-bigquery-jobs \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-bigquery-jobs \
  --log-filter='logName="projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Fdata_access" AND protoPayload.serviceName="bigquery.googleapis.com" AND protoPayload.metadata.jobChange.after="DONE"'
```

Then add a receiver and pipeline:

```yaml showLineNumbers title="bigquery-config.yaml"
extensions:
  # ...existing extensions...
  text_encoding/bigquery:
    encoding: utf8
    # One Pub/Sub message is one LogEntry. Split on NUL, which never
    # appears in JSON, so a multi-line message stays one record.
    unmarshaling_separator: "\\x00"

receivers:
  googlecloudpubsub/bigquery_jobs:
    project: ${env:GCP_PROJECT_ID}
    subscription: projects/${env:GCP_PROJECT_ID}/subscriptions/scout-bigquery-jobs-sub
    encoding: text_encoding/bigquery    # raw_text below collector 0.132

processors:
  resource/bigquery_jobs:
    attributes:
      - {key: service.name, value: bigquery-jobs, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_bigquery, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}

  transform/bigquery_jobs:
    # Missing paths (errorResult on success, queryStats on load jobs)
    # resolve to nil, and set() with nil does nothing.
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - set(cache["e"], ParseJSON(body))
          - set(cache["p"], cache["e"]["protoPayload"])
          - set(cache["j"], cache["p"]["metadata"]["jobChange"]["job"])
          # The text encoding sets no timestamp: use now, then the
          # LogEntry timestamp when it parses.
          - set(time, Now())
          - set(time, Time(cache["e"]["timestamp"], "%Y-%m-%dT%H:%M:%S.%fZ"))
          - set(severity_text, cache["e"]["severity"])
          - set(attributes["gcp.bigquery.project_id"], cache["e"]["resource"]["labels"]["project_id"])
          - set(attributes["gcp.bigquery.location"], cache["e"]["resource"]["labels"]["location"])
          - set(attributes["user.email"], cache["p"]["authenticationInfo"]["principalEmail"])
          # Job identity
          - set(attributes["gcp.bigquery.job.name"], cache["j"]["jobName"])
          - set(attributes["gcp.bigquery.job.state"], cache["j"]["jobStatus"]["jobState"])
          - set(attributes["gcp.bigquery.statement_type"], cache["j"]["jobConfig"]["queryConfig"]["statementType"])
          - set(attributes["gcp.bigquery.priority"], cache["j"]["jobConfig"]["queryConfig"]["priority"])
          # Scheduled queries carry their transfer config in job labels
          - set(attributes["gcp.bigquery.dts.config_id"], cache["j"]["jobConfig"]["labels"]["dts_config_id"])
          - set(attributes["gcp.bigquery.dts.run_id"], cache["j"]["jobConfig"]["labels"]["dts_run_id"])
          # Cost and duration
          - set(attributes["gcp.bigquery.job.billed_bytes"], Int(cache["j"]["jobStats"]["queryStats"]["totalBilledBytes"]))
          - set(attributes["gcp.bigquery.job.processed_bytes"], Int(cache["j"]["jobStats"]["queryStats"]["totalProcessedBytes"]))
          - set(attributes["gcp.bigquery.job.slot_ms"], Int(cache["j"]["jobStats"]["totalSlotMs"]))
          - set(attributes["gcp.bigquery.job.start_time"], cache["j"]["jobStats"]["startTime"])
          - set(attributes["gcp.bigquery.job.end_time"], cache["j"]["jobStats"]["endTime"])
          - set(attributes["gcp.bigquery.job.reservation"], cache["j"]["jobStats"]["reservation"])
          - set(attributes["gcp.bigquery.job.cache_hit"], cache["j"]["jobStats"]["queryStats"]["cacheHit"])
          - set(attributes["gcp.bigquery.job.referenced_tables"], cache["j"]["jobStats"]["queryStats"]["referencedTables"])
          # Failures
          - set(attributes["gcp.bigquery.job.error"], cache["j"]["jobStatus"]["errorResult"]["message"])
          - set(attributes["gcp.bigquery.job.error_reason"], cache["j"]["jobStatus"]["errorResult"]["reason"])
          # Drop the SQL text, then replace the raw JSON body with the
          # scrubbed map. If parsing failed, never ship the raw string.
          - delete_key(cache["e"]["protoPayload"]["metadata"]["jobChange"]["job"]["jobConfig"]["queryConfig"], "query")
          - set(body, cache["e"])
          - set(body, "unparsed bigquery audit entry") where cache["e"] == nil

service:
  extensions: [text_encoding/bigquery]
  pipelines:
    logs/bigquery_jobs:
      receivers: [googlecloudpubsub/bigquery_jobs]
      processors: [memory_limiter, resource/bigquery_jobs, transform/bigquery_jobs, batch]
      exporters: [otlphttp/base14]
```

Load, extract and copy jobs have no `queryConfig` or `queryStats`, so
the query-specific attributes are absent on those records.

The record's timestamp comes from the `LogEntry`, so a backlog drained
after a collector outage lands at the right time rather than at receive
time.

:::note The SQL text is removed by default

Audit entries include the full query, truncated at 50 KB, and queries
often embed literals such as customer IDs or emails. The transform
deletes it before export. To keep it, remove the `delete_key` statement;
the query is then at
`protoPayload.metadata.jobChange.job.jobConfig.queryConfig.query` in the
body.

:::

Below collector 0.132, use the receiver's built-in `encoding: raw_text`
instead of the extension; it also delivers the `LogEntry` as a JSON
string, and the same transform applies. Do not use the built-in
`cloud_logging` encoding for this subscription. It decodes
`protoPayload` strictly against a compiled schema and rejects BigQuery
entries carrying fields it does not know, such as
`authenticationInfo.oauthInfo`, so messages are delivered but never
acked.

With these attributes in Scout, "which queries cost the most this week"
is a sum of `gcp.bigquery.job.billed_bytes` grouped by `user.email` or
`gcp.bigquery.statement_type`. For scheduled queries, group by
`gcp.bigquery.dts.config_id` to find the most expensive schedule, or
compare `gcp.bigquery.job.slot_ms` across runs of the same config to
catch a run that suddenly costs more.

### Optional: table reads and writes

The rest of the Data Access log records access per table:
`tableDataRead` for every table a job, export or Storage Read API
session reads, and `tableDataChange` for every insert, update, delete or
streaming write. This is what you need to answer "who read this table"
for security or compliance reviews.

:::warning Volume

These entries are the high-volume part of BigQuery's logs. A query that
joins five tables writes five `tableDataRead` entries, and a busy
streaming pipeline writes `tableDataChange` entries continuously.
Measure the rate in Logs Explorer before routing them, and narrow the
filter to the datasets you audit.

:::

The audit-log mapping in the encoding extension keeps what an access
review needs: the principal as `user.email`, the table as
`gcp.audit.resource.name`
(`projects/PROJECT_ID/datasets/DATASET/tables/TABLE`), the method and
the caller IP. That means these entries can share the main topic:

```bash showLineNumbers
gcloud logging sinks create scout-bigquery-table-access \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="bigquery_dataset" AND logName:"cloudaudit.googleapis.com%2Fdata_access" AND (protoPayload.metadata.tableDataRead:* OR protoPayload.metadata.tableDataChange:*)'
```

To audit only some datasets, add
`AND resource.labels.dataset_id=("finance" OR "pii")` to the filter.
Drop the `tableDataChange` clause if you only care about reads.

As with job completions, the encoding extension drops
`protoPayload.metadata`, so the column list (`tableDataRead.fields`),
the read `reason` and the row counts in `tableDataChange` do not reach
Scout. If you need them, send this sink to the `scout-bigquery-jobs`
topic instead and extend `transform/bigquery_jobs` with statements for
those paths.

---

## Alternative: `INFORMATION_SCHEMA.JOBS`

BigQuery keeps 180 days of job metadata in the `INFORMATION_SCHEMA.JOBS`
views, with fields the audit log lacks, such as per-stage timing and
`total_bytes_billed` already typed as integers. It is the right tool for
an ad-hoc look back, for example a monthly cost review.

It is a poor fit for continuous collection. Every read is itself a
billed query, the views are regional so you query each location
separately, and the collector has no BigQuery receiver to run it. The
audit log path above gives the same per-job cost in near real time at
no query cost.

---

## Verify

1. **The collector starts cleanly.** Check its logs for
   `PermissionDenied` or `could not find default credentials`:

   ```bash showLineNumbers
   # The exact command depends on your deployment:
   #   Docker:     docker logs <container>
   #   systemd:    journalctl -u otelcol
   #   Kubernetes: kubectl logs deploy/<name> -n <ns>
   ```

2. **Slot metrics appear in Scout.** Allow 15 minutes for the first
   points, given the ingestion delays above:

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, max(Value) AS latest
   FROM otel_metrics_gauge
   WHERE ServiceName = 'bigquery-metrics'
     AND MetricName = 'bigquery.googleapis.com/slots/allocated_for_project'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

   `scanned_bytes_billed` and the storage metrics take hours to arrive.
   An empty result for them in the first hour is expected.

3. **Completed jobs are reaching the subscription.** Run any query in
   the BigQuery console, then peek without consuming:

   ```bash showLineNumbers
   gcloud pubsub subscriptions pull scout-bigquery-jobs-sub --limit=1
   ```

4. **Job records landed with their statistics:**

   ```sql showLineNumbers
   SELECT LogAttributes['user.email'] AS user,
          LogAttributes['gcp.bigquery.job.name'] AS job,
          LogAttributes['gcp.bigquery.job.billed_bytes'] AS billed_bytes
   FROM otel_logs
   WHERE ServiceName = 'bigquery-jobs'
     AND TimestampTime >= now() - INTERVAL 1 HOUR
   LIMIT 10
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

---

## Troubleshooting

**Every BigQuery metric stopped after a config change.**
A distribution-valued metric was added, most likely
`query/execution_times` or a `starts_with` descriptor filter that
includes it. Remove it and the batch recovers on the next scrape.

**`query/scanned_bytes_billed` is empty.**
It runs about 6 hours behind. If it is still empty the next day, the
project may emit only `query/statement_scanned_bytes_billed`; check in
Metrics Explorer which of the two has data.

**`slots/assigned` returns nothing.**
The project has no reservation assignment it can see. On-demand projects
use a shared pool, and editions projects using only autoscaling may not
expose one either; neither reports assigned slots.

**The job subscription has a growing backlog, but nothing reaches Scout.**
If the subscription lives in the BigQuery project and the collector
runs in another, the receiver's streaming pull can fail with gRPC
`UNAVAILABLE` and restart every few minutes. The receiver logs this only
at `debug` level, so nothing shows at `info`. Create the subscription
in the collector's project instead, attached to the topic in the
BigQuery project, and point the receiver at it:

```bash showLineNumbers
gcloud pubsub subscriptions create scout-bigquery-jobs-sub \
  --topic=projects/BQ_PROJECT_ID/topics/scout-bigquery-jobs \
  --ack-deadline=60 \
  --project=COLLECTOR_PROJECT_ID
```

Creating it requires `roles/pubsub.subscriber` on the topic for the
identity running the command. Grant the collector Subscriber on the new
subscription as usual.

**Messages are delivered but never acked.**
The receiver is using the built-in `cloud_logging` encoding, which
rejects BigQuery audit entries with fields it does not know. Switch to
`text_encoding` (or `raw_text` below 0.132) as shown above.

**Job records arrive, but `billed_bytes` is missing.**
Either the records are decoded by the `google_cloud_logentry_encoding`
extension rather than `text_encoding` (check which subscription
the sink targets), or the job is not a query job. Load and copy jobs
carry no `queryStats`.

**One Pub/Sub message becomes many log records.**
The `unmarshaling_separator` was left at its default, which splits on
newlines. Set it as shown above.

**The subscription receives nothing after a query.**
The sink filter does not match. Check in Logs Explorer that
`protoPayload.metadata.jobChange.after="DONE"` returns entries for your
project. If you only see `bigquery_resource` entries, you are looking at
the legacy format, which uses different field paths.

## FAQ

### How do I monitor BigQuery with OpenTelemetry?

Use the `googlecloudmonitoring` receiver for slot, query and storage
metrics, and route the BigQuery Data Access audit log through a Log
Router sink into Pub/Sub for per-job detail. Neither path connects to
BigQuery or runs queries against it.

### How do I find which BigQuery queries cost the most?

Sum `totalBilledBytes` from the audit log entries for completed jobs,
grouped by user or statement. Cloud Monitoring metrics only show the
project total, so per-query cost has to come from the audit log or from
`INFORMATION_SCHEMA.JOBS`.

### Do I need to enable BigQuery Data Access audit logs?

No, BigQuery Data Access audit logs are on by default and cannot be
turned off. This makes BigQuery an exception among GCP services, where
Data Access logs are normally disabled until you enable them.

### How do I see who accessed a BigQuery table?

Route the `tableDataRead` entries from the BigQuery Data Access audit log
into Scout and filter on `gcp.audit.resource.name` for the table. Each
entry records the principal, the table and the method, one entry per
table per job.

### Why are BigQuery bytes billed metrics hours behind?

Google publishes `query/scanned_bytes_billed` with an ingestion delay of
up to about 6 hours, and storage metrics up to 3 hours. The receiver
waits for that delay, so the data arrives late but with correct
timestamps. `query/statement_scanned_bytes_billed` is available within a
few minutes.

### Why do my BigQuery audit logs in Scout have no bytes billed or SQL text?

The Cloud Logging encoding extension does not map the
`protoPayload.metadata` field, which holds BigQuery's job statistics.
Route completed jobs to a separate subscription read with the
`text_encoding` extension and extract the fields with a `transform`
processor.

### Is this the same as exporting Cloud Logging logs to BigQuery?

No, exporting logs to BigQuery is a Log Router sink with a BigQuery
dataset as its destination, used to analyze any GCP logs with SQL. This
guide goes the other way: it sends BigQuery's own metrics and audit logs
to Scout.

## Reference

- [BigQuery metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_a_b#gcp-bigquery)
- [Introduction to audit logs in BigQuery](https://docs.cloud.google.com/bigquery/docs/introduction-audit-workloads)
- [BigQueryAuditMetadata reference](https://docs.cloud.google.com/bigquery/docs/reference/auditlogs/rest/Shared.Types/BigQueryAuditMetadata)
- [INFORMATION_SCHEMA.JOBS view](https://docs.cloud.google.com/bigquery/docs/information-schema-jobs)

## Related Guides

- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - the topic,
  subscription and sink setup the Logs section above depends on.
- [GCP Monitoring overview](./overview.md) - collector image, IAM, and
  why distribution metrics can take down a receiver.
- [Pub/Sub](./pub-sub.md) - monitoring the subscriptions this guide
  creates, including backlog age.
- [Cloud SQL](./cloud-sql.md) - the transactional database that often
  feeds BigQuery.
