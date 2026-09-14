---
title: >
  Materialize OpenTelemetry Monitoring - Dataflow Freshness, Replica
  Memory, and Collector Setup
sidebar_label: Materialize
id: collecting-materialize-telemetry
sidebar_position: 68
description: >
  Scrape Materialize's /metrics/public endpoint with the OpenTelemetry
  Collector. Monitor dataflow freshness, source lag, and replica memory
  in base14 Scout.
keywords:
  - materialize opentelemetry
  - materialize otel collector
  - materialize metrics monitoring
  - materialize dataflow freshness
  - opentelemetry prometheus receiver materialize
  - materialize observability
  - materialize source lag monitoring
  - materialize telemetry collection
---

# Materialize

Materialize serves Prometheus text at `/metrics/public` on its HTTP
listener with no exporter and no sidecar. The OpenTelemetry Collector's
`prometheus` receiver scrapes it and collects 532 metric families
covering dataflow freshness, source ingestion progress, query (peek)
outcomes and latency, cluster replica connectivity, per-replica memory,
and the persist storage layer. Materialize also exports OTLP spans
natively. This guide covers both surfaces, the Collector configuration,
and shipping to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Materialize            | -       | v26.39.0    |
| OTel Collector Contrib | 0.90.0  | 0.160.0     |
| base14 Scout           | Any     | -           |

The `otlp_http` exporter name used in this guide was introduced in
contrib 0.149.0. On builds below that, use the previous spelling,
`otlphttp`.

Materialize is on calendar versioning, so release numbers look like
`v26.39.0`. This guide claims no floor release for `/metrics/public` or
for the OTLP trace exporter; run a current release.

Before starting:

- `environmentd` reachable from the host running the Collector on its
  HTTP listener, port `6876` externally or `6878` internally.
- The scrape path set to `/metrics/public`. The `prometheus` receiver
  defaults to `/metrics`, which on Materialize is a different and
  smaller surface. See [Access Setup](#access-setup) for which listener
  serves which path.
- A SQL client for the `ALTER SYSTEM` statements in this guide.
  Materialize speaks the Postgres wire protocol, so `psql` works, as
  does any Postgres driver.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

The Materialize Emulator is a single container holding `environmentd`, a
bundled Postgres for catalog and consensus, the Console, and every
`clusterd` replica as a child process. It is for testing and evaluation:
BSL 1.1 with an additional use grant capped at 24 GiB cluster memory and
48 GiB disk, no persistence, no fault tolerance, no upgrade path, and it
collects telemetry. The endpoint, path, auth and trace behaviour below
are `environmentd` behaviour and apply wherever it runs; how a
self-managed Kubernetes install lays out pods and ports is set by your
deployment configuration and is not covered here.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or a capacity review.

There is no metrics enable list to author - `/metrics/public` is
unfiltered, and the `prometheus` receiver synthesises `up` alongside
`scrape_duration_seconds`, `scrape_samples_scraped`,
`scrape_samples_post_metric_relabeling` and `scrape_series_added`.
Almost every family carries the `mz_` prefix. The eight that do not are
covered in [The prefix is not `mz_` alone](#the-prefix-is-not-mz_-alone).

### Core - is it up, fresh, and answering queries

| Metric | What it tells you |
|---|---|
| `mz_compute_controller_connected_replica_count` | Replicas actually connected, per `instance_id`. This is the liveness signal for a cluster, because a lost replica removes its own series rather than reporting a bad value. |
| `up` | Scrape liveness, synthesised by the `prometheus` receiver for each target. It reads 0 when the Collector cannot reach the endpoint. |
| `mz_dataflow_wallclock_lag_seconds` | How far behind wallclock each collection's frontier is - the freshness SLO. A summary with `quantile="0"` and `quantile="1"` only. |
| `mz_source_offset_known`, `mz_source_offset_committed` | Ingestion progress against upstream. The difference between the pair is source lag; there is no lag metric. |
| `mz_compute_peeks_total` | Query outcomes, split by `result="rows"` / `"error"` / `"canceled"` / `"rows_stashed"`. |
| `mz_compute_peek_duration_seconds` | Query latency histogram, with the same `result` split. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `mz_storage_controller_connected_replica_count` | Storage-side twin of the compute replica count. |
| `mz_source_messages_received`, `mz_bytes_read_total` | Ingestion throughput. |
| `mz_source_error_inserts`, `mz_source_error_retractions` | Errors written into a source's data shard. |
| `mz_source_updates_staged`, `mz_source_updates_committed` | Writes staged but not yet durable. |
| `mz_persist_blob_failures`, `mz_persist_cmd_failed_count`, `mz_persist_consensus_failures` | Storage-layer failures against blob and consensus. |
| `mz_compute_controller_peek_count` | Pending peeks. A queue that grows means compute is saturated. |
| `mz_compute_controller_hydration_queue_size` | Dataflows waiting to hydrate after a restart. |
| `mz_compute_collection_count` | Maintained collections, split by `hydrated="0"` / `"1"`. The other half of the restart-recovery picture, next to the hydration queue. |
| `mz_arrangement_maintenance_seconds_total` | Time spent compacting arrangements. |
| `jemalloc_resident` | Process memory, reported once unlabelled for `environmentd` and once per replica. The capacity ceiling. |
| `mz_active_sessions`, `mz_active_subscribes` | Session and `SUBSCRIBE` load. |
| `mz_connection_status` | Completed pgwire connections by `status`, with `source="external"` / `"internal"`. The `status="error"` split is the connection-failure signal. |
| `mz_catalog_sync_latency_seconds` | Catalog sync against durable storage. |
| `mz_http_requests_total`, `mz_http_request_duration_seconds` | HTTP API load. |
| `mz_cluster_info`, `mz_replica_info`, `mz_source_info`, `mz_object_info` | Constant-1 metadata series, for joining IDs to names. |

The metadata families are always 1 and exist to be joined against.
`mz_replica_info` in particular is catalog state, not liveness. See
[A lost replica shows up as missing series](#a-lost-replica-shows-up-as-missing-series).

### Diagnostic - for investigation and tuning

Most of the surface sits here. These families are engine internals with
no documented thresholds. Put them on dashboards you open during an
incident, not in alerts.

| Group | Families | When you reach for it |
|---|---|---|
| `mz_persist_*` | 268 | Half the entire surface. Blob, consensus, compaction, pushdown, pubsub, state, schema, GC, audit, semaphore and retry paths in the storage layer, excluding the three Operational failure families above. |
| `mz_column_*` | 36 | The columnar memory pool and pager, which engage under memory pressure. |
| `mz_metrics_*` | 30 | lgalloc and libc allocator internals. |
| `mz_tokio_*` | 20 | Async runtime worker stats. |
| `mz_index_*` | 10 | A peek broken into cursor setup, seek, row collection, sort and error scan. |
| `mz_timely_step_duration_seconds`, `mz_cluster_handle_command_duration_seconds`, `mz_slow_message_handling` | 3 | Dataflow scheduler histograms; where a slow worker shows up. |
| `mz_ts_*`, `mz_txn_*` | 28 | Timestamp oracle and transaction internals. |

### The prefix is not `mz_` alone

Eight families carry no `mz_` prefix: `jemalloc_active`,
`jemalloc_allocated`, `jemalloc_metadata`, `jemalloc_resident`,
`jemalloc_retained`, `transform_hits`, `transform_total` and
`outer_join_lowering_cases`.

A relabel `keep` on `mz_.*` drops all eight, and the five `jemalloc_*`
families are the only process-memory signal on the endpoint. If you
filter by name, the pattern is `mz_|jemalloc_`.

`jemalloc_*` is reported once unlabelled for `environmentd` and once per
replica with `cluster_name` and `replica_name`. A `jemalloc_resident`
query without a `replica_name` matcher sums `environmentd` and every
replica into one number.

### A lost replica shows up as missing series

When a cluster loses its replicas - `ALTER CLUSTER quickstart SET
(REPLICATION FACTOR 0)`, for example - every series carrying
`cluster_name="quickstart"` disappears. Both the family count and the
series count fall. Source offsets, arrangement, peek and per-replica
`jemalloc_*` stop being reported rather than reporting zero.

An alert therefore cannot be a threshold on a replica-side metric. It has
to be `absent()` or the controller-side count, which moves 1 to 0 and back
to 1 as replicas leave and return.

`mz_replica_info{cluster_id="u1"}` stays at 1 the whole time a cluster
has no replicas. It is catalog metadata, not a liveness signal, so an
alert built on it reports healthy through a total outage.

### Freshness needs two filters before you can alert on it

`mz_dataflow_wallclock_lag_seconds` is a summary with only
`quantile="0"` and `quantile="1"` - the minimum and maximum over the
last minute. There is no median and no p99, so a query for
`quantile="0.99"` returns nothing.

Two filters belong in the alert expression itself:

- **Introspection collections trail by minutes, and that is normal.**
  Collections whose `collection_id` begins `si` sit minutes behind,
  while user (`u`) and system (`s`) collections sit at seconds. Exclude
  `collection_id=~"si.*"`.
- **A freshly created replica reports `u64::MAX` until its first
  measurement.** The series read 18446744073709552000, the float
  rendering of 18446744073709551615, and clear within about 30 seconds.
  Any `max()` alert fires on every replica restart or resize unless the
  expression also drops values above a sane bound.

`collection_id` is an opaque catalog ID. Resolving it to an object name
needs a SQL join against `mz_objects`, or the `mz_object_info`
constant-1 series.

### Source lag is a pair, summed across workers

There is no lag metric. Lag is `mz_source_offset_known` minus
`mz_source_offset_committed`, and both are reported **per worker**, with
only the worker that owns a partition reporting a non-zero value. `sum
by (source_id)` is the correct aggregation; `avg` or a bare comparison
between the two is wrong.

Pick your lag threshold from your own baseline; a healthy source sits at
zero, and the number that matters is how far above zero your workload
tolerates.

Do not use `mz_kafka_partition_offset_max`. It exists and is labelled by
`topic` and `partition_id`, and it reads zero even while a Kafka source
is actively ingesting. Use the source offset pair.

### Per-object memory is not on the scrape

The endpoint has process totals (`jemalloc_*`) and allocator internals
(`mz_metrics_lgalloc_*`), and nothing that attributes memory to an
index, materialized view or source.
`mz_arrangement_sizes_collection_time_seconds` and
`mz_arrangement_sizes_rows_written_total` measure the collection of that
data, not the sizes.

Use the metric for "is this replica near its limit" and SQL for "which
view is eating the memory":

```sql showLineNumbers title="Per-object memory lives in SQL"
SELECT * FROM mz_introspection.mz_arrangement_sizes;
SELECT * FROM mz_introspection.mz_dataflow_arrangement_sizes;
SELECT * FROM mz_internal.mz_frontiers;
SELECT * FROM mz_internal.mz_source_statistics;
SELECT * FROM mz_internal.mz_compute_hydration_statuses;
```

### Cardinality scales with the catalog, not with traffic

Series count is driven by the number of objects in the catalog. The
distribution is long-tailed rather than dominated by one family:

| Series | Family |
|---|---|
| 2,340 | `mz_cluster_handle_command_duration_seconds_bucket` |
| 860 | `mz_object_info` |
| 672 | `mz_slow_message_handling_bucket` |
| 592 | `mz_dataflow_wallclock_lag_seconds` |
| 432 | `mz_compute_peek_duration_seconds_bucket` |

The tail is per-shard persist families - about 30 families at 191 series
each, one per persist shard - and shard count grows with the number of
objects. Two labels multiply everything on the replica side: `worker_id`
(12 on a `600cc` replica) and `process`.

A small two-replica instance is the floor for these numbers. The
configuration below uses a 30s scrape interval; shorten it only after you
have measured what your catalog produces.

### Families that stay at zero

Many families read zero until the feature or code path that owns them is
exercised. A zero here, or no series at all for the envelope-state
families, is expected rather than a collection failure:

| Subsystem | Why it reads zero |
|---|---|
| `mz_persist_*` | GC, leases, pubsub fallbacks, audit and retry paths an instance that is not exercising those paths never takes. |
| `mz_column_*` | The columnar pool and pager engage only under memory pressure. |
| `mz_metrics_*` | lgalloc paths that need spilling. |
| `mz_source_*` | Envelope-state families (`mz_source_bytes_indexed`, `mz_source_records_indexed`, `mz_source_envelope_state_tombstones`, `mz_source_rehydration_latency_ms`) need `ENVELOPE UPSERT` or `DEBEZIUM`. |
| `mz_compute_*`, `mz_tokio_*`, `mz_ts_*`, `mz_txn_*` | Error and contention paths. |
| `mz_arrangement_*`, `mz_shard_*`, `mz_dataflow_*` | Maintenance and expiration paths. |
| `mz_kafka_partition_offset_max` | Reads zero even with an active Kafka source. |
| `mz_active_subscribes`, `mz_canceled_peeks_total` | No `SUBSCRIBE` running and no query cancelled. |

The Operational error counters (`mz_persist_blob_failures`,
`mz_persist_cmd_failed_count`, `mz_persist_consensus_failures`,
`mz_source_error_inserts`) sit in this set because nothing has failed.

### What the traces show

`--startup-opentelemetry-filter` and the runtime system parameter
`opentelemetry_filter` both default to `info`, which runs at about
**42,000 spans per minute** for a single instance, roughly 700 a second.
At `warn` the rate falls to zero.

The filter is changeable at runtime, with no restart:

```sql showLineNumbers title="Set the OpenTelemetry filter at runtime"
ALTER SYSTEM SET opentelemetry_filter = 'warn';
```

Run it as `mz_system` on the internal SQL listener. Set the filter before
you point `environmentd` at a Collector.

The trace surface is engine internals, not query traces. Span names are
Rust `tracing` spans, ordered here by how much of the volume they
account for:

| Span name | Count |
|---|---|
| `handle_message` / `coord::handle_message` | 37,315 / 37,314 |
| `consensus::compare_and_set` | 15,850 |
| `consensus::scan` | 1,992 |
| `blob::set` / `blob::get` | 899 / 432 |
| `message_command` | 600 |
| `parse_plan` / `parse_item_inner` | 397 / 397 |
| `oracle::write_ts` | 210 |
| `query` | 100 |
| `sequence_end_transaction` | 100 |

Attributes on every span are the Rust tracing set mapped to current
semantic conventions: `code.file.path`, `code.module.name`,
`code.line.number`, `thread.id`, `thread.name`. There is no `db.*`
attribute and no statement text. `query` spans are root spans (empty
parent) from `mz_pgwire::protocol`, Kind `Internal`. Use them to
investigate coordinator slowness; for query behaviour, use the peek
metrics and the SQL introspection views.

Resource attributes arrive as `telemetry.sdk.language=rust`,
`telemetry.sdk.name=opentelemetry`, `telemetry.sdk.version=0.32.1`, plus
`cluster_id` and `replica_id` on replica spans. Materialize sets no
`service.name`, so the Collector has to supply one.

## Key Alerts to Configure

Threshold guidance drawn from the Core and Operational tiers. These are
starting points; tune them to your workload.

| Alert | Expression shape | Threshold | Why it matters |
|---|---|---|---|
| Cluster has no connected replica | `mz_compute_controller_connected_replica_count{instance_id=~"u.*"} == 0` | `== 0` for 2m | The cluster is serving nothing. Replica-side series stop being reported too, so this is the signal to alert on. |
| Storage controller lost its replica | `mz_storage_controller_connected_replica_count{instance_id=~"u.*"} == 0` | `== 0` for 2m | Ingestion has stopped for that cluster's sources. |
| Data is stale | `mz_dataflow_wallclock_lag_seconds{quantile="1",collection_id!~"si.*"} > N and < 1e15` | Set `N` from your observed baseline | Answers are behind wallclock. Both filters are required: `si.*` collections trail by minutes normally, and a new replica reports `u64::MAX` until its first measurement. |
| Source is falling behind | `sum by (source_id) (mz_source_offset_known) - sum by (source_id) (mz_source_offset_committed) > N` sustained | Set `N` from your observed baseline | Ingestion is not keeping up with upstream. Sum across workers; only the partition-owning worker reports. |
| Query error rate | `rate(mz_compute_peeks_total{result="error"}[5m])` against `result="rows"` | Relative to baseline | Queries are failing. Check the failing objects before the engine. |
| Query latency | `mz_compute_peek_duration_seconds` p99 by `instance_id` | Relative to baseline | Peeks are slow. Usually a replica that is saturated or still hydrating. |
| Replica memory | `jemalloc_resident{replica_name!=""}` against the replica's size limit | 80% of the announced limit | The replica is approaching an OOM kill. Alert on the ratio, never an absolute byte count - a replica using 515 MB against a 97.6 GB limit is idle, and the same number on a small size is critical. |
| Source writing errors | `increase(mz_source_error_inserts[5m]) > 0` | `> 0` | Errors are being written into a source's data shard; downstream views inherit them. |
| Persist blob failures | `increase(mz_persist_blob_failures[5m]) > 0` | `> 0` | The storage layer cannot reach blob storage. |
| Persist consensus failures | `increase(mz_persist_consensus_failures[5m]) > 0` | `> 0` | The storage layer cannot reach consensus; writes will stall. |
| Peeks queueing | `mz_compute_controller_peek_count > N` | Set `N` from your observed baseline | Compute is saturated. Resize the cluster or shed query load. |
| Hydration backlog after restart | `mz_compute_controller_hydration_queue_size > 0` sustained | `> 0` for 10m | Dataflows are still rebuilding state; results are incomplete until they finish. |
| Collections not hydrated | `mz_compute_collection_count{hydrated="0"} > 0` sustained | `> 0` for 10m | A collection never finished hydrating. Check memory and the object's dependencies. |
| pgwire connection errors | `increase(mz_connection_status{status="error"}[5m]) > 0` | `> 0` | Clients are failing to connect. Split by `source` to separate external from internal. |
| Scrape target down | `up{job="materialize"} == 0` | `== 0` for 2m | The Collector cannot reach the endpoint. Check the path and the listener before suspecting Materialize. |

Three thresholds are deliberately left to you: wallclock lag, source lag
and peek queue depth. A healthy instance sits at zero source lag, a few
seconds of wallclock lag on user collections, and a peek queue near
zero, so there is no useful absolute number to copy - take a week of
your own data and set each bound above your normal peak.

## Access Setup

### Which path to scrape

`environmentd` serves two metrics paths from different HTTP route
groups:

| Path | Families | Series | Contents |
|---|---|---|---|
| `/metrics/public` | 532 | ~22,200 | `environmentd`'s own registry and every cluster replica's, labelled `cluster_id`, `replica_id`, `cluster_name`, `replica_name`. |
| `/metrics` | 441 | 10,627 | `environmentd` only. No replica metrics at all. |

Scraped back to back, `/metrics` has zero families that
`/metrics/public` lacks, while `/metrics/public` has 91 that `/metrics`
lacks. Twenty of those are the `mz_source_*` families: the source offset
pair is not on `/metrics` at all, so a scrape that takes
the receiver default loses the entire ingestion-lag signal along with
everything replica-side.

`/metrics/public` is a strict superset. Scraping both double-counts.

### Which listener, and what auth does to it

The listener layout comes from a JSON file the image ships in
`/listener_configs/`, chosen at startup:

| Start mode | `6876` (external HTTP) | `6878` (internal) |
|---|---|---|
| No password set | `/metrics/public` 200, `/metrics` 404 | `/metrics/public` 200, `/metrics` 200 |
| `MZ_EXTERNAL_LOGIN_PASSWORD_MZ_SYSTEM` set | Both 401 without credentials. With basic auth as `mz_system`: `/metrics/public` 200, `/metrics` 404 | `/metrics/public` **404**, `/metrics` 200 |

With a password set, the internal listener is replaced by a dedicated
metrics listener that enables only the `metrics` route group, which is
why `/metrics/public` disappears from `6878` there.

The rule: **scrape `/metrics/public` on the HTTP listener, and add basic
auth as `mz_system` when a password is set.** Authenticated
`/metrics/public` on `6876` returns the full superset.

Port `6874` serves the Materialize Console. It answers 200 with HTML on
every path, including `/metrics`, so a health check that only asserts
HTTP 200 passes against a target that has no metrics on it.

The listener JSON files declare their own `"version"`, which trails the
image version. The route-group layout can move independently of the
binary, so re-check the table above after a major image bump.

### Reach the endpoint

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  materialized:
    image: materialize/materialized:v26.39.0
    environment:
      # One variable instruments environmentd and every replica
      MZ_OPENTELEMETRY_ENDPOINT: http://otel-collector:4317
      MZ_STARTUP_OPENTELEMETRY_FILTER: warn
    ports:
      - "6875:6875"   # SQL
      - "6876:6876"   # HTTP, serves /metrics/public
```

Confirm the exposition before touching the Collector:

```bash showLineNumbers title="Verify access"
# Family count on the right path
curl -s http://localhost:6876/metrics/public | grep -c '^# TYPE'

# The replica-side signal that /metrics does not carry
curl -s http://localhost:6876/metrics/public | grep '^mz_source_offset_known'

# With a password set
curl -s -u mz_system:"$MZ_SYSTEM_PASSWORD" \
  http://localhost:6876/metrics/public | head -5
```

`/metrics/public` is on by default and can be turned off at runtime with
`ALTER SYSTEM SET enable_public_metrics_endpoint = false`, which makes
both listeners return 503. Leave it at its default, and see
[Troubleshooting](#the-endpoint-returns-503-with-an-empty-body) if you
meet a 503.

### Export traces

Setting `MZ_OPENTELEMETRY_ENDPOINT` on `environmentd` is all that is
needed. `environmentd` propagates the endpoint to every `clusterd`
replica it launches, adding
`--opentelemetry-resource=cluster_id=<id>
--opentelemetry-resource=replica_id=<id>` to each, so one variable
instruments the whole instance. Transport is OTLP gRPC.

Set the filter at the same time. `MZ_STARTUP_OPENTELEMETRY_FILTER`
defaults to `info`, which is about 42,000 spans a minute per instance;
change
it at startup as above, or at runtime with `ALTER SYSTEM SET
opentelemetry_filter`.

## Configuration

The `prometheus` receiver handles metrics and the `otlp` receiver takes
the pushed spans. The scrape is unfiltered, so there is no metrics
enable list to maintain.

Two settings in this config are required. The first is `metrics_path:
/metrics/public`; without it the receiver scrapes `/metrics` and you lose
every replica-side metric. The second is `action: upsert` on the
`resource` processor's `service.name`, because Materialize sets none -
with `insert` the spans arrive as
`service.name=unknown_service:materialized`, the Rust SDK's fallback.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: materialize
          scrape_interval: 30s
          metrics_path: /metrics/public   # Required; the default is wrong
          static_configs:
            - targets:
                - ${env:MATERIALIZE_HOST}:6876

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest`. Drop
the traces pipeline if you are only collecting metrics.

When `MZ_EXTERNAL_LOGIN_PASSWORD_MZ_SYSTEM` is set, add credentials to
the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (with auth)"
        - job_name: materialize
          scrape_interval: 30s
          metrics_path: /metrics/public
          basic_auth:
            username: mz_system
            password: ${env:MZ_SYSTEM_PASSWORD}
          static_configs:
            - targets:
                - ${env:MATERIALIZE_HOST}:6876
```

Add one target per instance, not one per path. Scraping `/metrics` as
well as `/metrics/public` double-counts every family they share.

Diagnostic families can be filtered at the receiver rather than
downstream. If you do, keep `jemalloc_` in any keep-pattern you write:

```yaml showLineNumbers title="config/otel-collector.yaml (Diagnostic drop)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'mz_(persist|column|metrics|tokio|ts|txn)_.*'
              action: drop
```

### Environment Variables

```bash showLineNumbers title=".env"
MATERIALIZE_HOST=localhost
SERVICE_NAME=materialize
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers
# The endpoint is reachable on the right path
curl -s http://localhost:6876/metrics/public | grep -c '^# TYPE'

# The Collector is scraping Materialize
docker logs otel-collector 2>&1 | grep -i "mz_dataflow_wallclock_lag_seconds"

# Per-replica memory is arriving, which proves the path is right
curl -s http://localhost:6876/metrics/public | grep '^jemalloc_resident'

# Traces are arriving, if the traces pipeline is enabled
docker logs otel-collector 2>&1 | grep -i "coord::handle_message"
```

In Scout, `up{job="materialize"}` should read 1,
`mz_compute_controller_connected_replica_count` should match your
replica count per cluster, and `jemalloc_resident` should return one
series per replica plus one unlabelled series for `environmentd`. If the
`jemalloc_resident` result has only the unlabelled series, the scrape
landed on `/metrics`.

## Troubleshooting

### No per-replica series, and no source offsets

**Cause**: The scrape is hitting `/metrics` instead of
`/metrics/public`. The `prometheus` receiver defaults to `/metrics`.

**Look at**: `jemalloc_resident` - if every result is unlabelled, there
are no replica metrics. `mz_source_offset_known` returns nothing at all,
because that family is not on `/metrics`.

**Fix**:

1. Add `metrics_path: /metrics/public` to the scrape config.
2. Restart the Collector and confirm the family count climbs from about
   441 to about 532.

### The scrape returns 404

**Cause**: The path and the listener do not match. On the external
listener `/metrics` is a 404; on a password-protected instance the
internal listener 404s `/metrics/public`.

**Fix**:

1. Scrape `/metrics/public` on the HTTP listener (`6876` externally).
2. If a password is set, keep the target on the HTTP listener and add
   basic auth rather than moving to the internal port.

### The scrape returns 401

**Cause**: `MZ_EXTERNAL_LOGIN_PASSWORD_MZ_SYSTEM` is set, so the
external listener requires credentials for every path.

**Fix**: Add the `basic_auth` block shown in
[Configuration](#configuration), authenticating as `mz_system`.
Authenticated `/metrics/public` returns the full superset.

### The endpoint returns 503 with an empty body

**Cause**: `enable_public_metrics_endpoint` has been set to `false`.
Both listeners then return 503 with an empty body within about two
seconds, while `/metrics` keeps serving. The Collector is not at fault.

**Fix**: Restore the default with `ALTER SYSTEM RESET
enable_public_metrics_endpoint` on the internal SQL listener.

### A health check passes but no metrics arrive

**Cause**: The check is pointed at port `6874`, the Console. It answers
200 with HTML on every path, including `/metrics`.

**Fix**: Point health checks at the HTTP listener and assert on content,
not only status - for example `grep -c '^mz_'` on the response.

### A cluster went down and no alert fired

**Cause**: The alert was built on a replica-side metric or on
`mz_replica_info`. A lost replica removes its series rather than
reporting a bad value, and `mz_replica_info` stays at 1 because it is
catalog metadata.

**Fix**: Alert on
`mz_compute_controller_connected_replica_count == 0` and its storage
twin, or on `absent()` of a replica-side series.

### The freshness alert fires on every restart

**Cause**: The expression has no upper bound. A freshly created replica
reports `u64::MAX` (rendered 18446744073709552000) until its first
measurement, clearing within about 30 seconds.

**Fix**: Bound the expression with `< 1e15` and exclude
`collection_id=~"si.*"`, which legitimately trails by minutes. Put both
filters in the alert expression itself.

### Series volume is higher than expected

**Cause**: Cardinality scales with the catalog, not with traffic.
Per-shard persist families alone contribute about 30 families at 191
series each, and `worker_id` multiplies everything replica-side.

**Look at**: the Diagnostic groups - `mz_persist_*` is 268 families on
its own, with `mz_column_*`, `mz_metrics_*`, `mz_tokio_*`, `mz_ts_*` and
`mz_txn_*` behind it.

**Fix**:

1. Drop the Diagnostic families at the receiver with the
   `metric_relabel_configs` block above, keeping `jemalloc_`.
2. Check you are not scraping `/metrics` and `/metrics/public` on the
   same instance.
3. Leave the scrape interval at 30s unless you have measured the cost of
   shortening it.

### Memory metrics disappeared after adding a relabel rule

**Cause**: A `keep` on `mz_.*` drops the eight unprefixed families,
including all five `jemalloc_*`.

**Fix**: Use `mz_|jemalloc_` in the keep pattern. Without the
`jemalloc_*` families there is no process-memory signal on the endpoint
at all.

### Spans arrive as `unknown_service:materialized`

**Cause**: The `resource` processor is using `action: insert` for
`service.name`. Materialize sets no `service.name`, so the Rust SDK
fallback is what arrives.

**Fix**: Change the `service.name` attribute to `action: upsert`.

### Trace volume is far higher than the metrics volume

**Cause**: `opentelemetry_filter` is at its `info` default, which is
about 700 spans a second per instance.

**Fix**: Set `ALTER SYSTEM SET opentelemetry_filter = 'warn'` on the
internal SQL listener. It takes effect without a restart. Set
`MZ_STARTUP_OPENTELEMETRY_FILTER` too, so the setting survives a
restart.

### Memory is climbing and the metrics do not say which object

**Cause**: The endpoint carries process totals and allocator internals
only. Nothing on the scrape attributes memory to an index, materialized
view or source.

**Look at**: the Diagnostic `mz_metrics_lgalloc_*` families for
allocator behaviour, then move to SQL.

**Fix**: Query `mz_introspection.mz_arrangement_sizes` and
`mz_introspection.mz_dataflow_arrangement_sizes` for per-object memory,
and `mz_internal.mz_compute_hydration_statuses` for objects still
building state.

## FAQ

### Do I need an exporter or a sidecar?

No. `environmentd` serves Prometheus text itself. The Collector's
`prometheus` receiver scrapes it directly.

### Why `/metrics/public` and not `/metrics`?

They are served by different HTTP route groups. `/metrics/public`
carries `environmentd`'s registry and every replica's, labelled by
cluster and replica. `/metrics` carries `environmentd` only, and the
source offset families are not on it at all.

### Can I scrape both paths?

No. `/metrics/public` is a strict superset, so scraping both
double-counts every family they share.

### How do I alert on a replica going away?

Use `mz_compute_controller_connected_replica_count == 0`, or `absent()`
on a replica-side series. Do not use `mz_replica_info` - it is catalog
metadata and reports 1 through an outage.

### Why does my p99 freshness query return nothing?

`mz_dataflow_wallclock_lag_seconds` is a summary with `quantile="0"` and
`quantile="1"` only - minimum and maximum over the last minute. There is
no median and no p99.

### How do I find which view is using the memory?

In SQL. `mz_introspection.mz_arrangement_sizes` and
`mz_introspection.mz_dataflow_arrangement_sizes` attribute memory to
objects; the metrics only tell you how close a replica is to its limit.

### Do the traces show my queries?

No. They are Rust `tracing` spans from the engine - coordinator message
handling, consensus and blob operations, planning. There is no `db.*`
attribute and no statement text. Use them to explain coordinator
slowness, and the peek metrics for query behaviour.

### Do I have to instrument replicas separately?

No. Setting `MZ_OPENTELEMETRY_ENDPOINT` on `environmentd` propagates the
endpoint to every `clusterd` replica it launches, tagged with
`cluster_id` and `replica_id`.

### What do Materialize version numbers mean?

Materialize uses calendar versioning, so `v26.39.0` is a release from
2026, not a pre-1.0 build. The listener configuration files inside the
image carry their own version, which trails the image version.

## Related Guides

- [ClickHouse Monitoring](./clickhouse.md) - Column-oriented OLAP
  database for analytical queries over stored data. The closest
  analytical neighbour, monitored on query throughput and merge
  activity.
- [PostgreSQL Monitoring](./postgres.md) - Relational database whose
  wire protocol Materialize speaks, so the same clients and drivers
  connect to both, and a common upstream for a Materialize source.
- [Kafka Monitoring](./kafka.md) - Distributed commit log and
  stream-processing broker, the most common upstream for a Materialize
  source. Redpanda, the Kafka-compatible C++ broker without a JVM,
  fills the same role and these alert shapes port over to it.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert
  on Materialize metrics.

## What's Next?

- **Create Dashboards**: Build a freshness and replica-memory view
  first. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of `wallclock_lag`, source
  lag and peek queue data, then fill in the three alerts left open
  above.
- **Fine-tune Collection**: The `metric_relabel_configs` block in
  [Configuration](#configuration) is where the Diagnostic families are
  filtered, if you decide to filter them.
