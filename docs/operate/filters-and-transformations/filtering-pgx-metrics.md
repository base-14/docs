---
title: Filtering pgX Metrics at the Collector Level
description:
  Filter and drop pgX PostgreSQL metrics at the OpenTelemetry collector level
  using the filter processor. Drop metrics by name, attributes, or regex
  patterns with OTTL expressions in Scout.
keywords:
  [
    pgx metrics filtering,
    postgresql metric filtering,
    opentelemetry filter processor,
    drop metrics,
    ottl metric filtering,
  ]
---

## Problem Statement

pgX collects 60+ PostgreSQL metrics covering tables, indexes, replication,
queries, functions, system health, and more. In many environments, not all of
these metrics are needed. High-cardinality metrics like per-table and per-index
statistics can generate significant volume and cost, especially in clusters with
hundreds of tables.

Common filtering needs include:

1. **Dropping metrics by name** — Remove entire metric families you don't need
2. **Filtering by attributes** — Drop metrics for specific databases, schemas,
   or tables
3. **Filtering by regex** — Drop groups of related metrics matching a pattern

## Solution

The Scout Collector's `filter` processor with
[OTTL](https://opentelemetry.io/docs/collector/transforming-telemetry/)
expressions lets you drop metrics before they leave the collector. This guide
covers three approaches: exact name matching, attribute-based filtering, and
regex pattern matching.

## Implementation

### Prerequisites

- A Scout Collector configuration with a pgdashex metrics pipeline (see
  [PostgreSQL Advanced Monitoring](../../instrument/component/postgres-advanced.md))

### pgX Metric Categories

pgX organizes metrics into categories. Use this quick reference to identify
which metrics to filter. See the full
[Metrics Reference](../pgx/metrics.md) for all sub-metrics and labels.

| Category    | Metric Names                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Table       | `pg_table_info`, `pg_table_stats`                                                                                   |
| Index       | `pg_index_info`, `pg_index_stats`, `pg_index_extended_info`, `pg_column_stats`                                      |
| Replication | `pg_replication_outgoing`, `pg_replication_lag_milliseconds`, `pg_replication_outgoing_info`, `pg_replication_incoming`, `pg_replication_slot_info`, `pg_replication_slot_detail`, `pg_replication_slot_lsn`, `pg_replication_slot_lag_bytes` |
| Function    | `pg_function_stats`, `pg_function_gauge_stats`                                                                      |
| Sequence    | `pg_sequence_stats`                                                                                                 |
| Lock        | `pg_locks_count`, `pg_lock_detail`, `pg_blocking_pids`                                                              |
| Query       | `pg_statement_stats`                                                                                                |
| System      | `pg_system_info`, `pg_system_load_avg`, `pg_system_memory_bytes`, `pg_system_swap_bytes`                            |
| Database    | `pg_connections`, `pg_database_info`, `pg_database_size_bytes`, `pg_database_stats`, `pg_database_gauge_stats`      |
| Backend     | `pg_backend_type_count`, `pg_backend_wait_events`, `pg_backend_age_seconds`, `pg_backend_info`                      |
| WAL         | `pg_wal`, `pg_wal_archiving`, `pg_wal_files`, `pg_highest_wal_segment`                                             |
| Progress    | `pg_vacuum_progress`, `pg_analyze_progress`, `pg_cluster_progress`, `pg_create_index_progress`                      |

### Drop Metrics by Name

Use the `metrics.metric` context to drop entire metrics by exact name. This
removes all datapoints for the matched metric.

**Drop table and index metrics:**

```yaml
processors:
  filter/drop_table_index:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "pg_table_stats"'
        - 'name == "pg_table_info"'
        - 'name == "pg_index_stats"'
        - 'name == "pg_index_info"'
        - 'name == "pg_index_extended_info"'
        - 'name == "pg_column_stats"'
```

> **Tip:** If you want to drop an entire metric category (e.g., all table or
> index metrics), consider disabling it at the source instead. Set
> `PGDASHEX_COLLECT_METRICS` to only the groups you need (e.g.,
> `PGDASHEX_COLLECT_METRICS=basic,queries,replication`). This is more efficient
> because metrics are never collected or transmitted. However, source-level
> filtering is group-level only — you can disable all table metrics but you
> can't keep `pg_table_info` while dropping `pg_table_stats`. For that
> granularity, use the collector filter processor as shown above. See
> [pgdashex Metric Groups](../../instrument/component/postgres-advanced.md#metric-groups)
> for the full list.

**Drop function and sequence metrics:**

```yaml
processors:
  filter/drop_functions:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "pg_function_stats"'
        - 'name == "pg_function_gauge_stats"'
        - 'name == "pg_sequence_stats"'
```

Add the filter processor to your metrics pipeline:

```yaml
service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [filter/drop_table_index, batch, resource]
      exporters: [otlp/scout]
```

### Filter by Attributes

pgdashex exposes Prometheus metrics with labels like `database`, `schema`,
`table`, `index`, and others. When scraped by the Prometheus receiver, these
labels become datapoint `attributes` in OpenTelemetry.

Use the `metrics.datapoint` context to drop individual datapoints based on
attribute values. If all datapoints for a metric are dropped, the metric itself
is also dropped.

**Drop metrics for a specific database:**

```yaml
processors:
  filter/drop_test_db:
    error_mode: ignore
    metrics:
      datapoint:
        - 'attributes["database"] == "test_db"'
```

**Drop metrics for a specific schema:**

```yaml
processors:
  filter/drop_schema:
    error_mode: ignore
    metrics:
      datapoint:
        - 'attributes["schema"] == "pg_catalog"'
```

**Drop metrics for a specific table:**

```yaml
processors:
  filter/drop_table:
    error_mode: ignore
    metrics:
      datapoint:
        - 'attributes["table"] == "audit_logs"'
```

**Combine name and attribute filtering** to drop table stats only for a specific
database:

```yaml
processors:
  filter/drop_staging_tables:
    error_mode: ignore
    metrics:
      datapoint:
        - 'name == "pg_table_stats" and attributes["database"] == "staging"'
```

**Filter by resource attributes** to drop all pgX metrics from a specific source
(e.g., a Kubernetes pod or environment). Resource attributes describe the
telemetry source and are available in both `metrics.metric` and
`metrics.datapoint` contexts:

```yaml
processors:
  filter/drop_by_pod:
    error_mode: ignore
    metrics:
      metric:
        - 'resource.attributes["k8s.pod.name"] == "test-pod"'
```

```yaml
processors:
  filter/drop_by_environment:
    error_mode: ignore
    metrics:
      metric:
        - 'resource.attributes["environment"] == "staging"'
```

### Filter by Regex

Use `IsMatch()` to drop metrics matching a regular expression pattern.
`IsMatch()` works on any string field — metric names, datapoint attributes, and
resource attributes. It uses
[RE2 syntax](https://github.com/google/re2/wiki/Syntax) (Go regex) — lookahead
and lookbehind are not supported.

**Drop metric name families:**

```yaml
processors:
  filter/drop_replication:
    error_mode: ignore
    metrics:
      metric:
        - 'IsMatch(name, "pg_replication_.*")'
        - 'IsMatch(name, "pg_system_.*")'
```

**Drop datapoints by attribute pattern** — e.g., drop all metrics from databases
matching `test_*` or `dev_*`:

```yaml
processors:
  filter/drop_test_dbs:
    error_mode: ignore
    metrics:
      datapoint:
        - 'IsMatch(attributes["database"], "test_.*|dev_.*")'
```

**Drop by resource attribute pattern** — e.g., drop all metrics from
non-production Kubernetes namespaces:

```yaml
processors:
  filter/drop_dev_namespaces:
    error_mode: ignore
    metrics:
      metric:
        - 'IsMatch(resource.attributes["k8s.namespace.name"], "dev-.*|staging-.*")'
```

**Drop multiple categories at once:**

```yaml
processors:
  filter/drop_bulk:
    error_mode: ignore
    metrics:
      metric:
        - 'IsMatch(name, "pg_replication_.*")'
        - 'IsMatch(name, "pg_system_.*")'
        - 'IsMatch(name, "pg_lock.*")'
        - 'IsMatch(name, "pg_vacuum_.*|pg_analyze_.*|pg_cluster_.*|pg_create_index_.*")'
```

### Full Configuration Example

A complete collector config that scrapes pgdashex, filters unwanted metrics, and
exports to Scout:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: 'pgdashex'
          scrape_interval: 30s
          static_configs:
            - targets: ['pgdashex:9187']

processors:
  # Drop table and index metrics to reduce volume
  filter/drop_table_index:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "pg_table_stats"'
        - 'name == "pg_table_info"'
        - 'name == "pg_index_stats"'
        - 'name == "pg_index_info"'
        - 'name == "pg_index_extended_info"'
        - 'name == "pg_column_stats"'

  # Drop metrics for non-production databases
  filter/drop_test_databases:
    error_mode: ignore
    metrics:
      datapoint:
        - 'attributes["database"] == "test_db"'
        - 'attributes["database"] == "dev_db"'

  # Drop progress and system metric families
  filter/drop_progress_system:
    error_mode: ignore
    metrics:
      metric:
        - 'IsMatch(name, "pg_system_.*")'
        - 'IsMatch(name, "pg_vacuum_progress|pg_analyze_progress|pg_cluster_progress|pg_create_index_progress")'

  batch:
    timeout: 10s
    send_batch_size: 1024

  resource:
    attributes:
      - key: environment
        value: production
        action: upsert

extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: __YOUR_CLIENT_SECRET__
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__ORG_NAME__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

exporters:
  otlp/scout:
    endpoint: https://api.scout.base14.io:4317
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  pipelines:
    metrics:
      receivers: [prometheus]
      processors:
        [
          filter/drop_table_index,
          filter/drop_test_databases,
          filter/drop_progress_system,
          batch,
          resource,
        ]
      exporters: [otlp/scout]
```

## How It Works

### Understanding OTTL Contexts

The filter processor's context determines **what it iterates over** and therefore
what fields are accessible and what the drop/keep decision applies to.

The OpenTelemetry data model is hierarchical:

```
Resource (resource.attributes: pod, service, environment...)
  └─ Metric (name, description, type)
       ├─ Datapoint (value, timestamp, attributes: database, schema, table...)
       ├─ Datapoint (value, timestamp, attributes: database, schema, table...)
       └─ ...
```

- **`metrics.metric` context** — Iterates over metrics one at a time. Each
  iteration sees one metric as a whole unit. The decision is all-or-nothing:
  drop or keep the entire metric with all its datapoints. Available fields
  include `name` and `resource.attributes`. Datapoint `attributes` are **not**
  available here because a single metric contains many datapoints with different
  attribute values — there's no single value to check.
- **`metrics.datapoint` context** — Iterates over individual datapoints one at a
  time. Each iteration sees exactly one datapoint, so `attributes["database"]`
  always refers to a single unambiguous value. This is the only context where
  you can surgically drop some datapoints while keeping others. If all
  datapoints for a metric are dropped, the metric is also removed.
- **`resource.attributes`** — Available in **both** contexts. A resource
  describes the telemetry source (a pod, a service) and has a 1:1 relationship
  with each metric, so it's always unambiguous regardless of which level you're
  at.

### Other Key Concepts

- **`IsMatch()`** — Evaluates a regular expression against a field value. Uses
  [RE2 syntax](https://github.com/google/re2/wiki/Syntax) (Go's regex engine),
  which does not support lookahead or lookbehind.
- **`error_mode: ignore`** — Silently skips expressions that fail to evaluate
  (e.g., when an attribute doesn't exist on a datapoint) instead of failing the
  pipeline.
- **Processor ordering** — Filter processors run in the order listed in the
  pipeline. Place them before `batch` and exporters so filtered metrics are never
  batched or transmitted.

## Best Practices

1. **Use `error_mode: ignore`** to prevent pipeline failures when expressions
   don't match all metric types
2. **Prefer exact name matches over broad regex** for better performance — regex
   evaluation is more expensive per metric
3. **Consider source-level filtering** via the `PGDASHEX_COLLECT_METRICS`
   environment variable when you want to disable entire metric categories (e.g.,
   `PGDASHEX_COLLECT_METRICS=basic,queries,replication` to skip tables, indexes,
   and more). This avoids collecting and transmitting metrics you'll never use.
4. **Place filter processors before batch/export** in the pipeline definition to
   reduce downstream processing
5. **Test in non-production first** — verify that your dashboards and alerts
   still have the data they need after applying filters

## Related Guides

- [pgX Metrics Reference](../pgx/metrics.md) — Complete list of all pgX
  metric names and labels
- [PostgreSQL Advanced Monitoring](../../instrument/component/postgres-advanced.md)
  — pgdashex setup and collector pipeline configuration
- [pgX Configuration](../pgx/configuration.md) — pgX configuration options
  including `PGDASHEX_COLLECT_METRICS`
- [Filtering Logs with Regex and JSON](filter-logs-regex-and-json.md) — Similar
  filtering techniques applied to log pipelines
- [OTTL Span Transformations](ottl-span-transformations.md) — Filter and
  transform spans using OTTL
