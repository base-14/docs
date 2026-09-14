---
title: >
  Hatchet OpenTelemetry Monitoring - Task Outcomes, Queue Backlog,
  and Collector Setup
sidebar_label: Hatchet
id: collecting-hatchet-telemetry
sidebar_position: 64
description: >
  Collect Hatchet metrics and traces with the OpenTelemetry Collector.
  Monitor task outcomes, queue backlog, worker slots, and workflow
  duration in base14 Scout.
keywords:
  - hatchet opentelemetry
  - hatchet otel collector
  - hatchet metrics monitoring
  - hatchet task queue monitoring
  - opentelemetry prometheus receiver hatchet
  - hatchet observability
  - hatchet workflow monitoring
  - durable execution monitoring
  - hatchet telemetry collection
---

# Hatchet

Hatchet serves Prometheus text on port `9090` once
`SERVER_PROMETHEUS_ENABLED` is set; the OpenTelemetry Collector's
`prometheus` receiver scrapes it, collecting 34 Hatchet metric families
covering task inflow and outcome, queue backlog, worker slot capacity,
scheduling latency and per-workflow end-to-end duration, alongside 40
standard Go runtime families, on Hatchet v0.101.27+. The endpoint is off
by default: with the switch unset, nothing listens on 9090 at all.
Hatchet also pushes engine traces over OTLP gRPC behind a second switch.
This guide turns both surfaces on, configures the Collector and ships to
base14 Scout.

## Prerequisites

| Requirement            | Minimum   | Recommended |
| ---------------------- | --------- | ----------- |
| Hatchet                | v0.101.27 | v0.105.16   |
| OTel Collector Contrib | 0.90.0    | latest      |
| base14 Scout           | Any       | -           |

`hatchet_tenant_queue_size` is the only backlog signal and the only Core
metric that is version-gated: it, the two per-workflow
queued-to-assigned families and the two `hatchet_pubsub_*` histograms
first appear in v0.101.27. On v0.90.13, v0.94.10 and v0.98.9 all five
are absent and the engine emits 28 to 29 Hatchet families instead of 34.
Nothing has been removed or renamed across that range; every difference
is additive.

Before starting:

- Hatchet must run with `SERVER_PROMETHEUS_ENABLED=true`. Without it
  there is no listener on 9090 and the scrape fails with a connection
  refusal.
- Hatchet needs PostgreSQL. The message queue defaults to `postgres`, so
  RabbitMQ and NATS are not required for this metric surface.
- The Collector must reach the metrics port over plain HTTP. Hatchet
  serves the exposition with no authentication, so restrict the port at
  the network layer rather than at the application.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

On a split deployment the metrics come from the engine, not the API
server or the dashboard. On `hatchet-lite`, which runs the API, the
engine and the dashboard in one container, they come from that
container.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or a capacity review.

Every global counter has a `hatchet_tenant_` twin carrying a `tenant_id`
label. Read
[Global and per-tenant families](#global-and-per-tenant-families) before
you decide which half to keep - collecting both doubles the series for
no extra signal.

### Core - is work flowing, failing or backing up

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the engine is reachable and the metrics listener is on. |
| `hatchet_created_tasks_total` | Task inflow. |
| `hatchet_succeeded_tasks_total` | Tasks that reached a successful final state. |
| `hatchet_failed_tasks_total` | Tasks that reached a final failure. Attempts that will be retried are excluded. |
| `hatchet_scheduling_timed_out` | Tasks that hit `schedule_timeout` before a worker slot freed. |
| `hatchet_tenant_queue_size` | Queue depth per `queue` and `workflow_name`. The backlog signal. |
| `hatchet_tenant_available_worker_slots` | Free slots per `worker_id` / `worker_name`. Zero means new work can only queue. |
| `hatchet_tenant_workflow_duration_milliseconds` | End-to-end run duration per `workflow_name` and `status`. Milliseconds, not seconds. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `hatchet_cancelled_tasks_total` | Tasks cancelled. Includes tasks cancelled by a scheduling timeout. |
| `hatchet_skipped_tasks_total` | DAG tasks whose `skip_if` condition matched. |
| `hatchet_assigned_tasks` | Tasks the queuer assigned to a worker. |
| `hatchet_queued_to_assigned` | Tasks that were queued and later assigned. First attempts only. |
| `hatchet_reassigned_tasks` | Tasks moved to another worker after the first assignment lapsed, usually a lost heartbeat. |
| `hatchet_rate_limited` | Scheduling attempts blocked by a rate limit. Attempts, not tasks. |
| `hatchet_queued_to_assigned_time_seconds` | Seconds queued before assignment. Buckets stop at 15s. |
| `hatchet_pubsub_publish_duration_seconds` | Publisher-side blocking cost of the message queue's `Pub` call. Labels `kind`, `topic_kind`, `result`. |
| `hatchet_pubsub_transit_seconds` | Publish-to-delivery latency from the message's own timestamp. Labels `kind`, `topic_kind`. |
| `hatchet_tenant_worker_slots` | Total slots across connected workers. A drop means workers left the pool. |
| `hatchet_tenant_used_worker_slots` | Slots currently occupied. |
| `hatchet_tenant_queued_to_assigned_by_workflow` | Queued-then-assigned count broken out by `workflow_name`. |
| `hatchet_tenant_queued_to_assigned_time_seconds_by_workflow` | Queue wait per `workflow_name`. Same 15s ceiling. |
| `go_goroutines` | Goroutine count in the engine. Growth runs ahead of a memory problem. |
| `process_resident_memory_bytes` | Engine resident memory. |

`hatchet_pubsub_publish_duration_seconds` measures how long the
publisher blocked, not broker delivery latency, and is not comparable
across message-queue backends because they block at different depths
before returning. `hatchet_pubsub_transit_seconds` is subject to clock
skew between publisher and subscriber, and messages from older engines
carry no timestamp and are never observed.

### Diagnostic - for investigation and tuning

Reach for these during an incident or a capacity review. On a
single-tenant install the per-tenant twins carry the same numbers as
their global counterparts, so this whole tier is droppable with
`metric_relabel_configs` while Core and Operational stay.

| Metric | When you reach for it |
|---|---|
| `hatchet_tenant_created_tasks`, `_succeeded_tasks`, `_failed_tasks`, `_cancelled_tasks`, `_skipped_tasks` | Outcome counters split by `tenant_id` on a multi-tenant install. |
| `hatchet_tenant_assigned_tasks`, `_queued_to_assigned`, `_reassigned_tasks`, `_scheduling_timed_out`, `_rate_limited` | Assignment and scheduling counters split by `tenant_id`. |
| `hatchet_tenant_queue_invocations`, `hatchet_queue_invocations_total` | Invocations of the queuer function. Engine loop activity, not work done. |
| `hatchet_tenant_queued_to_assigned_time_seconds` | Per-tenant queue wait. Same 15s ceiling as the global histogram. |
| `hatchet_retried_tasks_total` | Documented as retried tasks. Stuck at 0 - see below. |
| `go_gc_*`, `go_memstats_*`, `go_threads`, `process_cpu_seconds_total`, `process_open_fds`, `promhttp_metric_handler_requests_total` | Go runtime and scrape-handler detail for engine-level debugging. |

### Reading the task counters

Five things about this counter set change what you can build on it.

- **`hatchet_retried_tasks_total` never increments.** A task that fails
  its first attempts and succeeds on a retry leaves the counter at 0,
  and its per-tenant twin `hatchet_tenant_retried_tasks` never registers
  at all. Retried attempts appear in neither that counter nor
  `hatchet_failed_tasks_total`. The only place a retry is visible is a
  `status="FAILED"` observation on
  `hatchet_tenant_workflow_duration_milliseconds` for that workflow. Do
  not build a retry alert on it, and do not read a zero there as a
  healthy system.
- **A scheduling timeout is also counted as a cancellation.**
  `hatchet_cancelled_tasks_total` covers both the cancels you issue and
  every task that timed out waiting to be scheduled. Summing the two
  double-counts every timed-out task, so a cancellation alert has to
  subtract the increase in `hatchet_scheduling_timed_out`.
- **`hatchet_rate_limited` counts scheduling attempts, not tasks.** It
  runs orders of magnitude above the number of rate-limited task runs,
  because the queuer re-evaluates a blocked task on every pass. A
  `rate()` on it measures how hard the scheduler is spinning against the
  limit, not how much work was delayed.
- **The four terminal counters partition the created count.** The sum of
  succeeded, failed, cancelled and skipped tracks the created count, the
  gap being tasks in flight. Use
  `created - (succeeded + failed + cancelled + skipped)` as an in-flight
  estimate.
- **The `_total` suffix is inconsistent upstream.** `created`,
  `succeeded`, `failed`, `cancelled`, `skipped`, `queue_invocations` and
  `retried` carry it; `assigned_tasks`, `scheduling_timed_out`,
  `rate_limited`, `queued_to_assigned` and `reassigned_tasks` do not.
  They are the same kind of metric and the difference means nothing, so
  do not hunt for a missing series.

`hatchet_tenant_workflow_duration_milliseconds` is the only end-to-end
latency signal and the only per-workflow breakdown. Its unit is
**milliseconds**, over 24 buckets running from 0.1ms to 24 hours.
Observed `status` values are `COMPLETED`, `FAILED` and `CANCELLED`.

### Queue depth and queue-time histograms

`hatchet_tenant_queue_size` disappears when a queue drains. The
scheduler polls queue depth every 15 seconds; a series that stops being
reported is set to 0 for exactly one poll, so a scraper sees the drop,
then deleted on the next. The Hatchet family count is 34 while any queue
is non-empty and 33 when every queue is drained. An absent series means
an empty queue, not a broken scrape. Write backlog alerts so the gap
reads as zero rather than as missing data, for example
`max_over_time(hatchet_tenant_queue_size[10m])` or an `or vector(0)`
fallback, and never alert on `absent()`.

Both queue-time histograms top out at 15 seconds. Once queue waits pass
that ceiling, most observations on
`hatchet_queued_to_assigned_time_seconds` land in `+Inf`, and a
`histogram_quantile` above roughly p20 returns `+Inf` on a backed-up
system, which is exactly when the number is wanted. Use the assignment
counters and `hatchet_tenant_queue_size` to measure saturation instead
of these quantiles.

### Global and per-tenant families

Eleven families exist in both a global and a `hatchet_tenant_` form, and
on a single-tenant deployment each pair carries the same value at the
same scrape. The rule applies to those eleven pairs only:

- Keep the `hatchet_tenant_` half on a multi-tenant install and drop the
  global half.
- Keep the global half on a single-tenant install and drop the
  `hatchet_tenant_` half.

**Do not drop `hatchet_tenant_` by prefix.** Eight families exist only
in the per-tenant form and have no global counterpart, and seven of them
are Core or Operational: `hatchet_tenant_queue_size`,
`hatchet_tenant_available_worker_slots`, `hatchet_tenant_worker_slots`,
`hatchet_tenant_used_worker_slots`,
`hatchet_tenant_workflow_duration_milliseconds`,
`hatchet_tenant_queued_to_assigned_by_workflow` and
`hatchet_tenant_queued_to_assigned_time_seconds_by_workflow`. A prefix
rule takes the only backlog signal, both worker-slot gauges and the only
end-to-end latency signal with them. The drop rule in
[Configuration](#configuration) lists the eleven names in full for
exactly this reason.

Per-tenant series also appear for seeded tenants with no traffic at all:
a second tenant showed a `hatchet_tenant_reassigned_tasks` series pinned
at 0. The families are not scoped to tenants doing work.

### Cardinality and restarts

`hatchet_tenant_workflow_duration_milliseconds` drives the series count.
24 explicit buckets means 27 series per
`(tenant_id, workflow_name, status)` triple - 24 `_bucket` series plus
`+Inf`, `_sum` and `_count` - and 11 triples produced 297 of the 449
`hatchet_` series in a single scrape. Series scale with the number of
distinct workflow names times the three statuses, so budget against your
workflow catalogue.

The worker slot gauges carry `worker_id` and `worker_name` but do not
leak: restarting a worker mints a new `worker_id`, and the previous
series are gone from the next scrape.

Counters are process-local. Restarting the engine zeroes every counter
and de-registers every per-tenant family until traffic re-registers it -
a freshly started engine exposes only a subset of the Hatchet families
and reaches the full set once each code path has run. Dashboards built
on `increase()` see the reset, and a panel that lists families on a
fresh engine sees them appear over the first few minutes.

### Metrics that stay silent

- `hatchet_tenant_additional_metadata_queue_size` only appears when
  tasks carry additional metadata. Its help text warns that an item
  counts towards every metadata key it carries, so series for different
  keys overlap and must not be summed across keys.
- `hatchet_pubsub_nats_scheduler_partition_drops_total` registers only
  when the message queue is NATS. On the default Postgres queue it never
  appears.
- `hatchet_retried_tasks_total` is registered and scraped but stuck at
  0, so its zero is not a statement about your system.

The scrape is unfiltered - there is no metric enable list on this
surface, so every family the engine registers arrives.

### Traces - engine internals, not workflow traces

Hatchet pushes OTLP traces over gRPC when `SERVER_OTEL_COLLECTOR_URL` is
set. `SERVER_OTEL_TRACE_ID_RATIO` defaults to `1`, meaning every trace,
and that is the first thing to change: a single-node engine with one
four-slot worker and no dashboard traffic emits on the order of 100
spans per second. Sample it before enabling it anywhere real.

The trace surface is engine internals. There are 181 distinct span
names, all Go function names or SQL statement names, and nothing
corresponding to a task run, a workflow run or a user operation. It
answers "why is the scheduler slow", not "what happened to my job".
End-to-end workflow tracing is the SDK's own worker-side
instrumentation, which is a separate setup.

| Scope | Span names | Kind |
|---|---|---|
| `go.opentelemetry.io/otel/sdk/tracer` | `hatchet.run/<function>`, e.g. `hatchet.run/queue`, `hatchet.run/try-assign`, `hatchet.run/process-task-timeout`, `hatchet.run/process-retry-queue-items` | Internal |
| `github.com/exaring/otelpgx` v0.10.0 | `pool.acquire`, `query BEGIN`, `query COMMIT`, `query ROLLBACK`, and one `query <Name>` per named SQL statement, e.g. `query ReadMessages`, `query UpdateTaskStatuses` | Client |
| `otelgrpc` 0.68.0 | `Dispatcher/Heartbeat` | Server |

The database spans dominate: Client spans from `otelpgx` are roughly two
thirds of the volume, Internal `hatchet.run/*` spans most of the rest,
and Server spans a trickle.

| Span group | Attribute keys |
|---|---|
| `hatchet.run/*` | Ad-hoc dotted keys named after the Go call site, e.g. `olap_repository.update_task_statuses.partition.number`, `olap_repository.update_dag_statuses.is_saturated`, `match_repository.process_cel_expressions.conditions_count`. Not semantic conventions. |
| `query *`, `pool.acquire` | `db.system`, `pgx.rows_affected` |
| `Dispatcher/Heartbeat` | `rpc.method`, `rpc.response.status_code`, `rpc.system.name`, `server.address`, `server.port`, `tenant_id` |

Three details to plan queries around:

- The database spans carry `db.system`, the pre-1.26 semantic convention
  key; the current key is `db.system.name`. Filter on `db.system`.
- They carry no statement text under any key, so a `query <Name>` span
  identifies the prepared statement by name only.
- The tenant identifier on spans is `tenant_id` with an underscore, not
  the dotted `tenant.id` used elsewhere.

The only resource attributes Hatchet sets on itself are `service.name`,
from `SERVER_OTEL_SERVICE_NAME`, and `library.language=go`. Everything
else on these spans in Scout comes from the Collector's `resource`
processor.

## Key Alerts to Configure

Threshold guidance for the Core and Operational tiers. Task rate, queue
depth and run duration are workload-specific, so the rows below are
written as ratios, proportional changes or comparisons against your own
history rather than as absolute numbers. The three exceptions are
definitional: `up == 0`, no free worker slots, and a failure ratio.

| Metric | Threshold | Why it matters |
|---|---|---|
| `up` | `== 0` for 2 scrapes | The engine is gone or the metrics listener was turned off. |
| `hatchet_failed_tasks_total` | failure ratio against created `> 5%` over 15m | Final failures, retries already excluded. The headline error signal. |
| `hatchet_tenant_queue_size` | above the 24h p95 for that queue for 10m | Backlog outside its own normal range. Absolute depths are workload-specific. |
| `hatchet_tenant_available_worker_slots` | `== 0` for 5m | No capacity left; new work can only queue. Add workers or slots. |
| `hatchet_scheduling_timed_out` | any increase over 10m | Work is expiring unscheduled, which is silent data loss from the caller's point of view. |
| `hatchet_tenant_workflow_duration_milliseconds` | p95 above the 7-day p95 for that `workflow_name` by `> 2x` | Per-workflow latency regression. |
| `hatchet_cancelled_tasks_total` | increase not matched by a corresponding increase in `hatchet_scheduling_timed_out` | Isolates real cancellations from the timeouts folded into the same counter. |
| `hatchet_tenant_worker_slots` | drops by `> 25%` over 10m | Workers left the pool. |
| `hatchet_pubsub_publish_duration_seconds` | p95 above its own 24h p95 by `> 3x` | The message-queue backend is blocking the publisher. |
| `hatchet_reassigned_tasks` | any increase over 10m | Assignments are lapsing, usually a worker losing its heartbeat. |
| `hatchet_rate_limited` | any increase over 10m while `hatchet_tenant_queue_size` is also rising | Rate limits are the reason for the backlog rather than a symptom of it. The counter carries no labels, so this is a time correlation, not a per-workflow one. |
| `go_goroutines` | above the 24h p95 by `> 3x` | Goroutine growth in the engine ahead of a memory problem. |

## Access Setup

### Turn on the metrics endpoint

The endpoint does not exist until you enable it. Set
`SERVER_PROMETHEUS_ENABLED=true` on the engine (or on `hatchet-lite`,
which carries the engine) and expose the port:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  hatchet-lite:
    image: ghcr.io/hatchet-dev/hatchet/hatchet-lite:v0.105.16
    environment:
      DATABASE_URL: ${DATABASE_URL}
      # no listener on 9090 without this
      SERVER_PROMETHEUS_ENABLED: "true"
      # defaults; both are changeable
      SERVER_PROMETHEUS_ADDRESS: ":9090"
      SERVER_PROMETHEUS_PATH: "/metrics"
    ports:
      - "9090:9090"
```

Unlike most components both the address and the path move.
`SERVER_PROMETHEUS_ADDRESS` defaults to `:9090` and
`SERVER_PROMETHEUS_PATH` defaults to `/metrics`; setting them to, for
example, `:9464` and `/telemetry` serves the exposition there instead,
with `/metrics` on that port returning 404 and 9090 refusing
connections. Point the scrape config at whatever you set.

Confirm the exposition before touching the Collector:

```bash showLineNumbers title="Verify access"
curl -s http://localhost:9090/metrics | grep -c '^# TYPE'
curl -s http://localhost:9090/metrics | grep '^hatchet_created_tasks_total'
```

A connection refusal here - `curl` exiting 7 with
`Failed to connect to localhost:9090 after 0 ms: Could not connect to
server` - means the switch is off. It is not a 404 and not an empty
page, so a check that only looks at HTTP status sees no server rather
than a disabled endpoint.

The exposition is plain HTTP with no authentication. Bind it to an
internal interface or restrict the port to the Collector's address.

### Turn on trace export

Traces are a separate switch and push to the Collector rather than being
scraped:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  hatchet-lite:
    environment:
      # bare host:port, no scheme; OTLP over gRPC, there is no HTTP option
      SERVER_OTEL_COLLECTOR_URL: "otel-collector:4317"
      SERVER_OTEL_SERVICE_NAME: "hatchet"
      SERVER_OTEL_INSECURE: "true"
      # defaults to 1, meaning every trace; sample before production
      SERVER_OTEL_TRACE_ID_RATIO: "0.01"
```

`SERVER_OTEL_SERVICE_NAME` defaults to `server`, so set it or every
Hatchet deployment lands under the same service in Scout. Set
`SERVER_OTEL_INSECURE` to `false` and terminate TLS on the Collector
where the hop leaves the host.

Hatchet also has a `SERVER_OTEL_METRICS_ENABLED` switch, defaulting to
false, which turns on an OTLP metrics exporter to the same collector
URL. This guide collects metrics by scraping the Prometheus endpoint
instead, and what the OTLP path emits is not covered here.

## Configuration

The `prometheus` receiver handles metrics and the `otlp` receiver
handles the pushed traces. The scrape is unfiltered, so no metric enable
list is needed; the Prometheus receiver synthesises the `up` series
alongside `scrape_duration_seconds`, `scrape_samples_scraped`,
`scrape_samples_post_metric_relabeling` and `scrape_series_added`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: hatchet
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:HATCHET_HOST}:9090   # match SERVER_PROMETHEUS_ADDRESS
          # metrics_path: /metrics           # set if you moved the path

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

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
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest` or a
pinned tag of it. Drop the traces pipeline if you are only collecting
metrics.

On a single-tenant install the per-tenant twins carry the same numbers
as the global counters. If you do not want to collect them, filter them
in the receiver rather than downstream:

```yaml showLineNumbers title="config/otel-collector.yaml (Diagnostic drop)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'hatchet_tenant_(created_tasks|succeeded_tasks|failed_tasks|cancelled_tasks|skipped_tasks|assigned_tasks|reassigned_tasks|scheduling_timed_out|rate_limited|queue_invocations|queued_to_assigned|queued_to_assigned_time_seconds(_bucket|_sum|_count)?)'
              action: drop
```

Prometheus anchors `metric_relabel_configs` patterns at both ends, so
each name is listed in full and no trailing `.*` is used. That is what
keeps `hatchet_tenant_queued_to_assigned_by_workflow` and
`hatchet_tenant_queued_to_assigned_time_seconds_by_workflow`, which are
Operational, out of the drop. A trailing `.*` after
`queued_to_assigned` would take both.

### Environment Variables

```bash showLineNumbers title=".env"
HATCHET_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers
# The scrape target is up
curl -s http://localhost:9090/metrics | grep -c '^hatchet_'

# The Collector is scraping Hatchet
docker logs otel-collector 2>&1 | grep -i "hatchet_created_tasks"

# Traces are arriving, if the traces pipeline is enabled
docker logs otel-collector 2>&1 | grep -i "hatchet.run/"
```

In Scout, `up{job="hatchet"}` should read 1 and
`hatchet_created_tasks_total` should climb as work is submitted. On an
engine that has just started, expect fewer than 34 Hatchet families
until each code path has run once.

## Troubleshooting

### The scrape fails with a connection refusal

**Cause**: `SERVER_PROMETHEUS_ENABLED` is unset or false, so nothing is
listening, or the listener moved.

**Look at**: `up` for the `hatchet` job. It reads 0, and no
`hatchet_` series arrive at all.

**Fix**:

1. Set `SERVER_PROMETHEUS_ENABLED=true` on the engine and restart it.
2. If `SERVER_PROMETHEUS_ADDRESS` or `SERVER_PROMETHEUS_PATH` is set,
   match the scrape config to them.
3. Probe from the Collector's network namespace, not from your laptop:
   `curl -s http://hatchet:9090/metrics | head`.

### `hatchet_tenant_queue_size` vanishes from a dashboard

**Cause**: The queue drained. The scheduler reports the series as 0 for
one poll, then deletes it.

**Look at**: the Hatchet family count. It is 34 with a non-empty queue
and 33 when every queue is drained, and `up` stays at 1 throughout.

**Fix**:

1. Treat an absent series as an empty queue, not a broken scrape.
2. Use `max_over_time(hatchet_tenant_queue_size[10m])` or an
   `or vector(0)` fallback so panels and alerts tolerate the gap.
3. Do not alert on `absent()` for this metric.

### A retry alert never fires

**Cause**: `hatchet_retried_tasks_total` does not increment, and retried
attempts are excluded from `hatchet_failed_tasks_total` as well.

**Look at**: the Diagnostic-tier `hatchet_retried_tasks_total` - it sits
at 0 regardless of retry activity, and `hatchet_tenant_retried_tasks`
never registers at all.

**Fix**:

1. Count `status="FAILED"` observations on
   `hatchet_tenant_workflow_duration_milliseconds` for the workflow;
   that is where a retried attempt shows up.
2. Alert on final failures with `hatchet_failed_tasks_total` and treat
   retries as a per-workflow signal, not a global counter.

### Cancellations look higher than the cancels you issued

**Cause**: A scheduling timeout also increments
`hatchet_cancelled_tasks_total`.

**Look at**: `hatchet_scheduling_timed_out` over the same window. Most
of the cancellation count is usually timeouts rather than cancels you
issued.

**Fix**:

1. Subtract the increase in `hatchet_scheduling_timed_out` from the
   increase in `hatchet_cancelled_tasks_total` before alerting.
2. Never sum the two - that double-counts every timed-out task.

### The failure rate is up and the Core counters do not say whose

**Cause**: `hatchet_created_tasks_total`, `hatchet_succeeded_tasks_total`
and `hatchet_failed_tasks_total` are summed across tenants, so one tenant
failing hard looks the same as every tenant degrading a little.

**Look at**: the Diagnostic tier's per-tenant twins, split by
`tenant_id` - `hatchet_tenant_created_tasks` against
`hatchet_tenant_failed_tasks` for the failure split, and
`hatchet_tenant_rate_limited` and `hatchet_tenant_scheduling_timed_out`
for tenants the scheduler is already holding back. `tenant_id` is the
only label that separates them; the Core counters carry none.

**Fix**: rate-limit the tenant that dominates the split, or give it its
own worker pool. On a single-tenant install the twins carry the same
numbers as the Core counters, so this tier can stay dropped.

### Queue-wait p95 reads `+Inf`

**Cause**: `hatchet_queued_to_assigned_time_seconds` and its per-tenant
and per-workflow variants stop bucketing at 15 seconds. Once queue
waits pass that ceiling, most observations land in `+Inf`.

**Look at**: the `le="+Inf"` bucket against `le="15"` - when the
overflow bucket dominates, quantiles above roughly p20 are meaningless.

**Fix**:

1. Measure saturation with `hatchet_tenant_queue_size` and the
   assignment counters instead.
2. Use `hatchet_tenant_workflow_duration_milliseconds` for latency; its
   buckets run to 24 hours.

### Counters reset and families disappear after a deploy

**Cause**: The counters are process-local. Restarting the engine zeroes
them and de-registers every per-tenant family until traffic
re-registers it.

**Look at**: `process_start_time_seconds` for the restart, and the
Hatchet family count climbing from 18 back to 34 over the first few
minutes.

**Fix**:

1. Build dashboards on `rate()` or `increase()`, which handle counter
   resets, rather than on raw counter values.
2. Do not treat a missing family on a freshly started engine as a
   configuration problem.

### Trace volume overwhelms the pipeline

**Cause**: `SERVER_OTEL_TRACE_ID_RATIO` defaults to `1`. A single-node
engine with one four-slot worker and no dashboard traffic emits on the
order of 100 spans per second.

**Look at**: Collector queue and export metrics, and the span-kind mix -
Client spans from `otelpgx` dominate at roughly two thirds of the
volume.

**Fix**:

1. Set `SERVER_OTEL_TRACE_ID_RATIO` to a small fraction before enabling
   traces outside a test environment.
2. Add a `tail_sampling` or `probabilistic_sampler` processor in the
   Collector if you need the ratio tuned without restarting Hatchet.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

### Do I need RabbitMQ or NATS to get these metrics?

No. The message queue defaults to `postgres`, and every metric in this
guide is emitted on that default. The only family that depends on the
backend is
`hatchet_pubsub_nats_scheduler_partition_drops_total`, which registers
only on NATS.

### Which component do I scrape in a split deployment?

The engine. The API server and the dashboard do not carry this
exposition. On `hatchet-lite` the API, the engine and the dashboard run
in one container, so you scrape that container.

### Can I move the metrics port or path?

Yes. `SERVER_PROMETHEUS_ADDRESS` (default `:9090`) and
`SERVER_PROMETHEUS_PATH` (default `/metrics`) both take non-default
values. Set `metrics_path` in the scrape config to match if you move the
path.

### Do the traces show my workflow runs?

No. The span names are Go function names and SQL statement names, so
the trace surface explains engine behaviour - scheduling, queue polling,
database calls - not the lifecycle of a specific task or workflow run.
End-to-end workflow tracing comes from the SDK's own worker-side
instrumentation.

### Should I collect the global counters, the per-tenant ones, or both?

One or the other. On a single-tenant deployment all eleven pairs carry
identical values, so collecting both doubles the series for no extra
signal. Keep `hatchet_tenant_*` on a multi-tenant install and the global
counters on a single-tenant one.

### Why do some counters end in `_total` and others do not?

The naming is inconsistent upstream. `hatchet_assigned_tasks`,
`hatchet_scheduling_timed_out`, `hatchet_rate_limited`,
`hatchet_queued_to_assigned` and `hatchet_reassigned_tasks` are counters
with no suffix; the rest carry `_total`. They are the same kind of
metric and there is no missing series to look for.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Hatchet metrics.
- [Temporal Monitoring](./temporal.md) - Durable-execution engine with a
  workflow-and-activity model rather than Hatchet's task-and-DAG one.
- [PostgreSQL Monitoring](./postgres.md) - Hatchet's database and, by
  default, its message queue.

## What's Next?

- **Create Dashboards**: Start with task inflow, the four terminal
  counters and `hatchet_tenant_queue_size`. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add
  [PostgreSQL](./postgres.md) for the database behind the queue, and
  [Temporal](./temporal.md) if you run both engines.
- **Fine-tune Collection**: Decide which tiers you keep. On a
  single-tenant install the Diagnostic tier repeats the global counters,
  and `SERVER_OTEL_TRACE_ID_RATIO` sets the trace sample rate before you
  turn traces on in production.
