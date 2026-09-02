---
date: 2026-09-02
id: collecting-gcp-cloud-sql-telemetry
title: Google Cloud SQL Monitoring with OpenTelemetry - Metrics, Logs & Alerts
sidebar_label: Cloud SQL
sidebar_position: 4
description: >
  Collect Cloud SQL host metrics, PostgreSQL and MySQL engine counters,
  and database logs into base14 Scout using the OpenTelemetry
  googlecloudmonitoring receiver, with in-database scraping as a
  complementary second view.
keywords:
  - cloud sql monitoring opentelemetry
  - cloud sql metrics scout
  - gcp cloud sql observability
  - cloudsql googleapis metrics
  - cloud sql postgresql metrics otel
  - cloud sql mysql metrics otel
  - cloud sql replica lag monitoring
  - cloud sql logs opentelemetry
---

Cloud SQL publishes host-level and engine-level metrics to Cloud
Monitoring automatically. This guide collects them into Scout with the
`googlecloudmonitoring` receiver, adds database logs through the Cloud
Logging path, and shows where an in-database scrape fills the gaps that
Cloud Monitoring cannot reach.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note Running this in production

Storing and querying these metrics at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Overview

Cloud SQL splits into two metric families that behave differently:

- **Host metrics** (`database/cpu/`, `database/memory/`,
  `database/disk/`, `database/network/`) describe the managed instance —
  the VM, its disk, and its quota. Only Cloud Monitoring has these.
- **Engine metrics** (`database/postgresql/`, `database/mysql/`,
  `database/sqlserver/`) are a curated subset of what the engine's own
  statistics views expose. Useful, but thin compared to what you get by
  querying the database directly.

Neither family sees individual queries, tables, locks or index usage.
For that you need the in-database path described under
[Alternative: scraping the engine directly](#alternative-scraping-the-engine-directly).

## Cloud SQL at a glance

| Layer | What emits it | Metric prefix | Collected by |
|---|---|---|---|
| Instance host | Cloud SQL platform | `cloudsql.googleapis.com/database/` | `googlecloudmonitoring` |
| Engine counters | Cloud SQL platform | `cloudsql.googleapis.com/database/{postgresql,mysql,sqlserver}/` | `googlecloudmonitoring` |
| Query and table detail | The database itself | `postgresql.*` / `mysql.*` | `postgresql` / `mysql` receiver |
| Database logs | Cloud Logging | `resource.type="cloudsql_database"` | `googlecloudpubsub` |

The monitored resource is `cloudsql_database`, whose labels
(`project_id`, `database_id`, `region`) arrive as resource attributes
alongside `gcp.resource_type`. `database_id` has the form
`PROJECT_ID:INSTANCE_ID` — it is the field to group by when you run
several instances.

---

## Receiver configuration

```yaml showLineNumbers title="cloud-sql-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/cloudsql:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Host — CPU, memory, disk, network
      - metric_name: "cloudsql.googleapis.com/database/cpu/utilization"
      - metric_name: "cloudsql.googleapis.com/database/memory/utilization"
      - metric_name: "cloudsql.googleapis.com/database/memory/total_usage"
      - metric_name: "cloudsql.googleapis.com/database/disk/utilization"
      - metric_name: "cloudsql.googleapis.com/database/disk/quota"
      - metric_name: "cloudsql.googleapis.com/database/disk/bytes_used"
      - metric_name: "cloudsql.googleapis.com/database/disk/read_ops_count"
      - metric_name: "cloudsql.googleapis.com/database/disk/write_ops_count"
      - metric_name: "cloudsql.googleapis.com/database/network/connections"
      - metric_name: "cloudsql.googleapis.com/database/network/sent_bytes_count"
      - metric_name: "cloudsql.googleapis.com/database/network/received_bytes_count"
      - metric_name: "cloudsql.googleapis.com/database/instance_state"
      # Replication
      - metric_name: "cloudsql.googleapis.com/database/replication/replica_lag"
      - metric_name: "cloudsql.googleapis.com/database/replication/network_lag"
      # PostgreSQL engine — drop this block on MySQL instances
      - metric_name: "cloudsql.googleapis.com/database/postgresql/num_backends"
      - metric_name: "cloudsql.googleapis.com/database/postgresql/transaction_count"
      - metric_name: "cloudsql.googleapis.com/database/postgresql/deadlock_count"
      - metric_name: "cloudsql.googleapis.com/database/postgresql/temp_bytes_written_count"

processors:
  resource/cloudsql:
    attributes:
      - {key: service.name, value: cloudsql-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_cloud_sql, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: cloud.region, value: "${env:GCP_REGION}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
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
    metrics/cloudsql:
      receivers: [googlecloudmonitoring/cloudsql]
      processors: [memory_limiter, resource/cloudsql, batch]
      exporters: [otlphttp/base14]
```

On a MySQL instance, replace the PostgreSQL block with the counters you
care about under `cloudsql.googleapis.com/database/mysql/` —
`queries`, `questions`, `innodb_pages_read`, and the
`innodb_buffer_pool_*` family are the usual starting set.

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
GCP_REGION=asia-south1
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

### Collecting the whole service

To take everything Cloud SQL emits rather than naming each metric:

```yaml showLineNumbers title="cloud-sql-config.yaml"
    metrics_list:
      - metric_descriptor_filter: 'metric.type = starts_with("cloudsql.googleapis.com/")'
```

Cloud SQL publishes around 100 metric types, so expect a
correspondingly larger Monitoring API bill and more series in Scout.
Start with the explicit list and widen it once you know what you use.

---

## Authentication and IAM

`roles/monitoring.viewer` on the project, granted to the collector's
service account. Nothing Cloud SQL-specific is required — the full setup
is in [GCP Monitoring overview](./overview.md#authentication).

The in-database path needs a separate database user; see
[below](#alternative-scraping-the-engine-directly).

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `database/cpu/utilization` | Gauge, `DOUBLE` | ratio | Saturation. Sustained above 0.8 usually means the tier is undersized. |
| `database/memory/utilization` | Gauge, `DOUBLE` | ratio | Buffer-cache pressure; rising utilization with falling cache hit rate is the signal to look for. |
| `database/memory/total_usage` | Gauge, `INT64` | bytes | Absolute usage, for capacity planning against the tier. |
| `database/disk/utilization` | Gauge, `DOUBLE` | ratio | Cloud SQL auto-grows storage and never shrinks it, so a full disk costs money permanently as well as stopping writes. |
| `database/disk/quota` | Gauge, `INT64` | bytes | Denominator for the above; also shows auto-growth events. |
| `database/disk/bytes_used` | Gauge, `INT64` | bytes | Growth rate, for forecasting. |
| `database/disk/read_ops_count` | **Delta** sum | ops | IOPS against the tier's limit. |
| `database/disk/write_ops_count` | **Delta** sum | ops | Write amplification and checkpoint behavior. |
| `database/network/connections` | Gauge, `INT64` | count | Compare against `max_connections`; the classic exhaustion signal. |
| `database/network/sent_bytes_count` | **Delta** sum | bytes | Egress volume, which is billable across regions. |
| `database/instance_state` | Gauge, `BOOL` | — | Whether the instance is running. |
| `database/replication/replica_lag` | Gauge, `DOUBLE` | seconds | Read-replica staleness. |
| `database/replication/network_lag` | Gauge, `INT64` | seconds | Splits replica lag into transport versus apply delay. |
| `database/postgresql/num_backends` | Gauge, `INT64` | count | Per-database connection counts. |
| `database/postgresql/transaction_count` | **Delta** sum | count | Throughput, split by commit and rollback. |
| `database/postgresql/deadlock_count` | **Delta** sum | count | Should be flat at zero; any sustained value is a bug. |
| `database/postgresql/temp_bytes_written_count` | **Delta** sum | bytes | Spills to disk — `work_mem` is too small for the queries running. |

None of these are distributions, so this receiver's most disruptive
failure mode does not apply to Cloud SQL. The delta-marked rows arrive
with delta temporality; see
[Metric kinds and temporality](./overview.md#metric-kinds-and-temporality).

---

## Cardinality control

The resource labels here are bounded by how many instances you run, so
this surface stays small on its own.

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `database_id` | Resource label | One per instance | Yes — the grouping key |
| `region` | Resource label | Small | Yes |
| `project_id` | Resource label | One per project | Yes |
| `database` | Metric label on `postgresql/*` | One per database in the instance | Yes, unless you run many databases per instance |

If a single instance hosts dozens of databases, the
`database/postgresql/num_backends` series count multiplies accordingly.
Drop the label if you only track the instance total:

```yaml showLineNumbers title="cloud-sql-config.yaml"
processors:
  transform/cloudsql:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - delete_key(attributes, "database")
```

---

## Alert tuning

| Signal | Source metric | Warning | Critical | Notes |
|---|---|---|---|---|
| Disk full | `database/disk/utilization` | > 0.80 for 15m | > 0.90 for 5m | Auto-growth buys time but raises cost permanently. |
| CPU saturation | `database/cpu/utilization` | > 0.80 for 15m | > 0.95 for 5m | Correlate with `transaction_count` before resizing. |
| Connection exhaustion | `database/network/connections` | > 80% of `max_connections` | > 95% | Usually a pooler problem, not a database one. |
| Replica lag | `database/replication/replica_lag` | > 30s for 5m | > 300s for 5m | Thresholds depend on what reads the replica. |
| Deadlocks | `database/postgresql/deadlock_count` | any for 5m | sustained | Alert on presence, not on a rate. |
| Instance down | `database/instance_state` | — | not running | Pair with your own connectivity probe. |

---

## Logs

Cloud SQL writes engine logs to Cloud Logging under
`resource.type="cloudsql_database"`. Route them with a Log Router sink
into the Pub/Sub topic your collector already subscribes to — the setup
is in [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md).

```bash showLineNumbers
gcloud logging sinks create scout-cloudsql-logs \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="cloudsql_database"'
```

The log streams that matter, by `logName` suffix:

| Engine | `logName` suffix | Contents |
|---|---|---|
| PostgreSQL | `postgres.log` | Server log — errors, slow queries if `log_min_duration_statement` is set, connection events |
| MySQL | `mysql-general.log` | General query log; off by default and expensive to enable |
| MySQL | `mysql.err` | Error log — crashes, replication failures, InnoDB messages |
| MySQL | `mysql-slow.log` | Slow query log, gated on `slow_query_log` |

PostgreSQL slow-query logging is a database flag, not a Cloud SQL
setting: set `log_min_duration_statement` on the instance, then the
entries appear in `postgres.log` and flow through the same sink.

---

## Alternative: scraping the engine directly

Cloud Monitoring cannot see inside the database. For per-query, per-table
and lock detail, run a collector inside the VPC with the `postgresql` or
`mysql` receiver pointed at the instance, in addition to the Cloud
Monitoring pipeline above. The two overlap very little.

Reaching the instance takes one of:

- **Private IP** — the collector runs in a VPC peered with the Cloud SQL
  instance's network. Simplest if you already run workloads there.
- **Cloud SQL Auth Proxy** — a sidecar next to the collector, which
  handles IAM authentication and TLS. Needed for public-IP instances and
  the usual choice on GKE.

Create a monitoring user with no data access:

```sql showLineNumbers
-- PostgreSQL
CREATE USER otel_monitor WITH PASSWORD '<your_password>';
GRANT pg_monitor TO otel_monitor;
```

Then follow [PostgreSQL](../../component/postgres.md) or
[MySQL](../../component/mysql.md) for the receiver configuration. Give
the direct-scrape pipeline its own `service.name` so the two views stay
distinguishable in Scout.

:::note Two complementary views

Cloud Monitoring gives you the host — CPU, memory, disk, quota,
replication lag — and cannot see the workload. The engine receiver gives
you the workload — connections by state, table and index statistics,
locks, WAL — and cannot see the host. Production instances are worth
instrumenting both ways.

:::

For deeper query-level analysis on PostgreSQL, see
[base14 pgX](../../../operate/pgx/overview.md). Note that pgX's Cloud
SQL integration is not yet available; point it at the instance the same
way you would any other PostgreSQL server.

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

2. **Metrics appear in Scout.** Allow at least one full
   `collection_interval` plus export time.

3. **Confirm the series landed under the right name:**

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, max(Value) AS latest
   FROM otel_metrics_gauge
   WHERE ServiceName = 'cloudsql-metrics'
     AND MetricName = 'cloudsql.googleapis.com/database/cpu/utilization'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

   The delta counters (`*_count`) live in `otel_metrics_sum`, not
   `otel_metrics_gauge`.

---

## Troubleshooting

**The engine metrics never appear, but host metrics do.**
You are listing PostgreSQL metrics against a MySQL instance or the other
way round. The `database/postgresql/` and `database/mysql/` families are
mutually exclusive per instance.

**`database/replication/replica_lag` returns nothing.**
The metric only exists on instances that have a replica. A primary with
no replica emits no series at all, which reads as a collection failure
but is not.

**Metrics stop for one instance after a maintenance window.**
Cloud SQL restarts change nothing about metric names, but a failover
changes `database_id` if you point at the replica by name. Group by the
resource attribute rather than pinning an instance in a query.

**Everything arrives under `unknown_service`.**
The `resource/cloudsql` processor is missing from the pipeline, or a
blanket `resource` processor elsewhere in the same pipeline is
overwriting `service.name`. See
[Give each surface its own pipeline](./overview.md#resource-attributes-every-gcp-pipeline-sets).

**Connection counts look far lower than the application reports.**
`database/network/connections` counts connections to the instance. If a
connection pooler sits in front, you are seeing pooled connections, not
application ones.

## FAQ

### How do I monitor Cloud SQL with OpenTelemetry?

Use the `googlecloudmonitoring` receiver against the
`cloudsql.googleapis.com/` metric prefix. It needs only
`roles/monitoring.viewer` and reaches every host and engine metric Cloud
SQL publishes, with no agent on the instance.

### What Cloud SQL metrics should I alert on first?

Alert on disk utilization, CPU utilization, connection count and replica
lag first. Disk is the most urgent of the four because a full Cloud SQL disk stops
writes, and auto-growth raises your bill permanently rather than
reverting.

### Can I get query-level detail from Cloud Monitoring?

Cloud Monitoring exposes host metrics and a curated set of engine
counters, but never individual queries, tables, indexes or locks. Run
the `postgresql` or `mysql` receiver against the instance for those.

### Do I need the Cloud SQL Auth Proxy?

The Cloud SQL Auth Proxy is needed only for the direct-scrape path, and
only when the collector cannot reach the instance over private IP. The
Cloud Monitoring path talks to the Monitoring API and never connects to
the database at all.

### Why are my Cloud SQL counters flat when I graph them as rates?

Counters such as `database/disk/read_ops_count` have `DELTA` kind, so
each point is already the change over the interval. Sum them over the
window instead of applying counter-rate logic.

### How do I collect Cloud SQL slow query logs?

Enable them at the engine level — `log_min_duration_statement` on
PostgreSQL, `slow_query_log` on MySQL — then route
`resource.type="cloudsql_database"` through a Log Router sink into
Pub/Sub, as described in the Logs section above.

## Reference

- [Cloud SQL metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_c#gcp-cloudsql)
- [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy)
- [Cloud SQL logging](https://docs.cloud.google.com/sql/docs/postgres/logging)

## Related Guides

- [GCP Monitoring overview](./overview.md) - why most of these counters
  are delta rather than cumulative, and what that changes.
- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - the sink and
  subscription setup the Logs section above depends on.
- [PostgreSQL component](../../component/postgres.md) - the in-database
  receiver, for the detail Cloud Monitoring cannot reach.
- [MySQL component](../../component/mysql.md) - the same for MySQL
  instances.
- [Memorystore](./memorystore.md) - the caching tier usually sitting in
  front of this database.
