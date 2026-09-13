---
title: >
  Apache Airflow OpenTelemetry Monitoring - Scheduler Health, Task
  Outcomes, Traces, and Collector Setup
sidebar_label: Apache Airflow
id: collecting-airflow-telemetry
sidebar_position: 69
description: >
  Push Airflow metrics, traces and logs to the OpenTelemetry Collector.
  Monitor scheduler health, task outcomes, pool saturation and DAG run
  traces in base14 Scout.
keywords:
  - airflow opentelemetry
  - airflow otel collector
  - airflow metrics monitoring
  - airflow scheduler health
  - airflow dag run traces
  - airflow task failure alerting
  - airflow observability
  - airflow telemetry collection
---

# Apache Airflow

Airflow builds an OpenTelemetry SDK inside each of its processes and
pushes metrics and traces to a Collector. There is no exporter to run
and no endpoint to scrape. Turn it on with two configuration settings
and the standard `OTEL_*` environment variables, and the scheduler, DAG
processor, worker, triggerer and API server all export to the same
Collector. Metrics cover scheduler health, task and operator outcomes,
pool and executor saturation, and DAG parsing. Traces cover a DAG run
end to end, across the three processes that handle it. Logs need
collecting from disk, because Airflow has no OTLP log exporter.

This guide covers all three signals, the Collector configuration, and
shipping to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Apache Airflow         | 2.6     | 3.3         |
| OTel Collector Contrib | 0.149.0 | Latest      |
| base14 Scout           | Any     | -           |

The signals have different floors, and several settings this guide uses
arrived later than the signal they control:

| Capability | Setting | From |
| --- | --- | --- |
| Metrics push over OTLP | `[metrics] otel_on` | 2.6.0 |
| Metric allow and block lists | `[metrics] metrics_allow_list`, `metrics_block_list` | 2.6.0 |
| Metrics to console for debugging | `[metrics] otel_debugging_on` | 2.7.0 |
| Traces push over OTLP | `[traces] otel_on` | 2.10.0 |
| Service name from Airflow config | `[metrics] otel_service` | 2.10.3 |
| Spans from Airflow internals | `[traces] otel_debug_traces_on` | 3.1.0 |
| Canonical metric names with attributes | `[metrics] legacy_names_on` | 3.2.0 |
| Structured JSON process logs | `[logging] json_logs` | 3.2.0 |
| Span flush timeout on task exit | `[traces] task_runner_flush_timeout_milliseconds` | 3.2.0 |

Everything below assumes 3.x. On 2.x the push works, but the two
settings that control metric cardinality and log structure do not exist
yet. See [Updates & Upgrades](#updates--upgrades) for what changes when
you cross each boundary.

The Collector floor is about component names. The `file_log` receiver
and `otlp_http` exporter names used in this guide were introduced in
contrib 0.149.0. Older builds need the previous spellings, `filelog` and
`otlphttp`.

Before starting:

- Airflow running on CeleryExecutor or KubernetesExecutor. The metric
  set differs slightly between them.
- Network from every Airflow process to the Collector. All five
  processes export independently.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

With `legacy_names_on = False`, the cardinality setting this guide
recommends, we observed 55 distinct metric names: 24 gauges, 16 counters
and 15 timers. Every name carries the `airflow.` prefix.

### Core - is the scheduler alive and are tasks finishing

| Metric | Type | What it tells you |
| --- | --- | --- |
| `airflow.scheduler_heartbeat` | counter | The scheduler increments this once per loop. Flat means the scheduler is not running and nothing is being queued. |
| `airflow.dag_processor_heartbeat` | counter | The same for the DAG processor. Flat means DAG file changes are no longer picked up. |
| `airflow.ti.finish` | counter | Task instances that reached a terminal state, split by `state`, `dag_id` and `task_id`. |
| `airflow.scheduler.dagruns.running` | gauge | DAG runs currently running. |

`airflow.ti.finish` carries the `state` attribute, so success rate,
failure rate and throughput all come from the one counter.

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `airflow.ti_failures` | counter | Task instances that failed, by `dag_id` and `task_id`. |
| `airflow.operator_failures` | counter | Failures attributed to an operator class, by `operator_name`. |
| `airflow.dag_processing.import_errors` | gauge | DAG files that currently fail to import. Any value above zero means a DAG is unschedulable. |
| `airflow.dag_processing.total_parse_time` | gauge | Seconds the last full parse loop took across every DAG file. |
| `airflow.dag_processing.last_run.seconds_ago` | gauge | Age of the last successful parse, per file. |
| `airflow.pool.starving_tasks` | gauge | Tasks that cannot start because their pool has no free slot. |
| `airflow.pool.open_slots` | gauge | Free slots in a pool. |
| `airflow.pool.queued_slots` | gauge | Slots held by queued tasks. |
| `airflow.pool.running_slots` | gauge | Slots held by running tasks. |
| `airflow.scheduler.tasks.starving` | gauge | Tasks the scheduler could not make executable this loop. |
| `airflow.scheduler.tasks.executable` | gauge | Tasks the scheduler judged ready to send to the executor. |
| `airflow.executor.open_slots` | gauge | Free executor slots, by `executor_class_name`. |
| `airflow.executor.queued_tasks` | gauge | Tasks queued on the executor. |
| `airflow.executor.running_tasks` | gauge | Tasks the executor reports as running. |
| `airflow.scheduler.scheduler_loop_duration` | timer | How long one scheduler loop took. |
| `airflow.scheduler.critical_section_duration` | timer | Time inside the scheduler's locked critical section, where task queuing happens. |
| `airflow.scheduler.executor_heartbeat_duration` | timer | Time the scheduler spent heartbeating the executor. On Celery this covers the broker and result backend. |
| `airflow.dagrun.schedule_delay` | timer | Gap between a DAG run's scheduled time and its actual start. |
| `airflow.dagrun.first_task_scheduling_delay` | timer | Gap between the DAG run starting and its first task being scheduled. |
| `airflow.dagrun.duration.failed` | timer | Wall-clock duration of DAG runs that ended failed, by `dag_id`. |
| `airflow.triggerer_heartbeat` | counter | The triggerer increments this each loop. Only meaningful if you use deferrable operators. |
| `airflow.triggerer.capacity_left` | gauge | Free trigger slots on a triggerer host. |
| `airflow.triggers.running` | gauge | Triggers currently running on a triggerer host. |
| `airflow.ti.queued` | gauge | Task instances in the queued state, by `dag_id`, `task_id` and `queue`. |
| `airflow.ti.running` | gauge | Task instances in the running state, same attributes. |
| `airflow.dagbag_size` | gauge | Number of DAGs the processor loaded. |

### Diagnostic - for investigation and tuning

| Metric | Type | What it tells you |
| --- | --- | --- |
| `airflow.task.duration` | timer | How long a task instance took, by `dag_id` and `task_id`. |
| `airflow.task.scheduled_duration` | timer | How long a task sat in the scheduled state before running. |
| `airflow.dagrun.duration.success` | timer | Wall-clock duration of DAG runs that succeeded. The denominator for a failure-rate view. |
| `airflow.dagrun.first_task_start_delay` | timer | Gap between the DAG run starting and the first task actually starting. |
| `airflow.dagrun.dependency-check` | timer | Time spent evaluating DAG run dependencies. |
| `airflow.scheduler.critical_section_query_duration` | timer | The database query inside the critical section. Where scheduler slowness usually originates. |
| `airflow.dag_processing.last_duration` | timer | Parse time for a single DAG file. |
| `airflow.dag_processing.processes` | counter | DAG file parsing processes started. |
| `airflow.dag_processing.file_path_queue_size` | gauge | Files waiting to be parsed. |
| `airflow.dag_processing.file_path_queue_update_count` | counter | Times the parse queue was refilled. |
| `airflow.ti.start` | counter | Task instances that started, by `dag_id` and `task_id`. |
| `airflow.ti_successes` | counter | Task instances that succeeded. |
| `airflow.ti_failures` | counter | Task instances that failed. Listed in Operational as the alert source, and useful here for after-the-fact grouping. |
| `airflow.operator_successes` | counter | Successes attributed to an operator class. |
| `airflow.task_instance_created` | counter | Task instances created, by `operator_name`. |
| `airflow.scheduler.orphaned_tasks.adopted` | counter | Orphaned task instances the scheduler adopted after a worker died. |
| `airflow.scheduler.orphaned_tasks.cleared` | counter | Orphaned task instances the scheduler cleared instead. |
| `airflow.pool.deferred_slots` | gauge | Slots held by deferred tasks. |
| `airflow.pool.scheduled_slots` | gauge | Slots held by scheduled tasks. |
| `airflow.asset.orphaned` | gauge | Assets no longer referenced by any DAG. |
| `airflow.connection_test.active` | gauge | Connection tests currently running. |
| `airflow.connection_test.pending` | gauge | Connection tests queued. |
| `airflow.job_start` | counter | Airflow jobs started. |
| `airflow.schedulerjobrunner_end` | counter | Scheduler job runners that ended. |
| `airflow.serde.load_serializers` | timer | Time to load the serializer registry at start-up. |
| `airflow.airflow.io.load_filesystems` | timer | Time to load the filesystem registry at start-up. The `airflow.` prefix appears twice; see [Two metric names that are not typos](#two-metric-names-that-are-not-typos). |

### The configuration keys in the Airflow docs are deprecated

Airflow's `[metrics]` and `[traces]` sections document `otel_host`,
`otel_port`, `otel_prefix`, `otel_interval_milliseconds` and
`otel_service`, with defaults of `localhost`, `8889`, `airflow`, `60000`
and `Airflow`. Those keys still work and their documented defaults do
not apply. Every one of them is read with a `None` fallback, so an
unset key falls through to the standard OpenTelemetry environment
variable instead of to the documented value. The service name ends up as
`airflow`, lowercase, from a hard-coded fallback rather than from the
`Airflow` the configuration reference shows.

Use the standard environment variables instead:

- `OTEL_EXPORTER_OTLP_ENDPOINT` instead of `otel_host` and `otel_port`.
- `OTEL_EXPORTER_OTLP_PROTOCOL` instead of `otel_ssl_active`.
- `OTEL_SERVICE_NAME` instead of `otel_service`.
- `OTEL_METRIC_EXPORT_INTERVAL` instead of `otel_interval_milliseconds`.

### Metrics go over HTTP and traces go over gRPC

`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` sets the protocol for
metrics. It does not reach traces. The traces path resolves
`OTEL_TRACES_EXPORTER` against the SDK's exporter entry points, and the
default value `otlp` maps to the gRPC exporter. The protocol variable is
never consulted.

The result is a Collector listening on HTTP 4318 that receives metrics
and no traces, while Airflow logs an HTTP/2 parse failure. Set
`OTEL_TRACES_EXPORTER=otlp_proto_http` and both signals take the same
path.

### Metrics and spans disagree about the service name

The metrics path falls back to `airflow` when nothing sets a service
name. The traces path does not, and its spans arrive as
`unknown_service`, the SDK's own default. The same deployment then shows
up twice.

Set `OTEL_SERVICE_NAME` once in the shared environment and both agree.

### Nothing Airflow sends says which process sent it

The five processes export independently, and no metric, span or resource
attribute identifies which one is which. A scheduler and a worker
reporting the same metric are indistinguishable.

Set `OTEL_RESOURCE_ATTRIBUTES` per process to add the identifier
yourself:

```bash
OTEL_RESOURCE_ATTRIBUTES=airflow.process=scheduler
```

The attribute name is yours to choose. Pick one and use it on every
process, including the API server.

### Which process emits what

Metric names are not spread evenly across the processes. In the
deployment we tested the DAG processor emits the most names, then the
worker and the scheduler. The triggerer emits a few.

The API server emits exactly one metric name,
`airflow.serde.load_serializers`, at start-up. Monitor it through its
traces instead, where it emits every `task_run.*` span.

### `legacy_names_on` controls metric cardinality

`legacy_names_on` arrived in Airflow 3.2.0 and defaults to `True`. With
it on, every metric is emitted twice: once under its canonical name with
the identifiers as attributes, and once under a legacy name with the
identifiers interpolated into the metric name. `ti.finish` also arrives
as `ti.finish.{dag_id}.{task_id}.{state}`, and `task.duration` also
arrives as `dag.{dag_id}.{task_id}.duration`.

The canonical name is the primary one. The legacy name is an extra
emission, looked up per metric from a registry Airflow ships, and only
metrics that have a legacy form in that registry get one. Every metric
name in this guide is the canonical form.

On the DAG set we tested, turning it off took 326 metric names down to
55 and cut data points by 39 percent. The legacy forms carry the same
information as the canonical names, with the identifiers in the name
instead of in attributes.

```ini
[metrics]
legacy_names_on = False
```

Name count grows with the number of DAGs and tasks. Leave the setting on
only if you have dashboards built against the interpolated names.

One metric ignores the setting.
`airflow.dagrun.{dag_id}.first_task_scheduling_delay` keeps a DAG id in
the metric name whatever `legacy_names_on` says, because the flag does
not reach that call site.

### Two more ways to cut cardinality

`metrics_allow_list` and `metrics_block_list` take comma-separated
regular expressions. Both match against the metric name before the
`airflow.` prefix is prepended, and against the lowercased form, so
write the patterns without the prefix:

```ini
[metrics]
metrics_block_list = serde,dependency-check
```

`OTEL_METRIC_EXPORT_INTERVAL` controls how often each process exports,
in milliseconds. The default is 60000. Lowering it multiplies data-point
volume in proportion.

### Timers are exponential histograms

Every Airflow timer is aggregated as an exponential histogram rather
than with explicit buckets. The SDK view that sets this is
unconditional, so no configuration key and no environment variable
changes it. Bucket boundaries adapt to the values recorded, so the same
aggregation covers millisecond and multi-hour durations. All timer
metrics carry `Unit: ms`.

### Two metric names that are not typos

`airflow.airflow.io.load_filesystems` has the prefix twice. The registry
entry is named `airflow.io.load_filesystems`, after the `airflow.io`
module, and the `airflow.` metric prefix is prepended to that.

`airflow.job_start` and `airflow.schedulerjobrunner_end` are asymmetric.
Both come from a `{job_name}_start` and `{job_name}_end` template, but
only the end metric resolves the job class into the name. The start
metric carries no attributes either, so there is no way to split job
starts by job type.

### Metrics that stay silent

Airflow ships a registry of 124 metric names, and the healthy deployment
we tested emitted 55 of them. The rest are silent for one of four
reasons:

- **A different executor.** The `kubernetes_executor.*` and
  `edge_worker.*` families, and the adopt and sync timers for the Batch,
  ECS, Lambda and Edge executors, only emit on the executor that owns
  them.
- **A feature that is off.** The `ol.*` metrics need OpenLineage
  enabled.
- **An error that has not happened.** OpenTelemetry counters are created
  on first increment, so a counter for a condition that never occurred
  does not exist at all. `airflow.celery.task_timeout_error`,
  `airflow.dag_processing.processor_timeouts`,
  `airflow.scheduler.tasks.killed_externally` and a dozen more behave
  this way. A query for one of them returns nothing on a healthy
  deployment.
- **A path not exercised.** The `connection_test.*` timers need someone
  to press the test button in the UI; `triggers.failed` and
  `triggers.succeeded` need deferrable operators.

Alert on the error counters going above zero. An alert on one of these
names being absent will fire on a healthy deployment.

### What the traces show

Turning on `[traces] otel_on` produces one trace per DAG run, spanning
three processes:

| Span name | Emitted by | What it covers |
| --- | --- | --- |
| `dag_run.<dag_id>` | scheduler | The DAG run. Root span. |
| `task_run.<task_id>` | API server | One task instance as the scheduler and API server see it. |
| `worker.<task_id>` | worker | The same task instance as the worker executes it. |

They nest, so a two-task DAG run looks like this:

```text
dag_run.my_pipeline
  task_run.extract
    worker.extract
  task_run.load
    worker.load
```

Context crosses the process boundary in the Celery workload, which
carries a `traceparent`. A DAG run of N tasks produces 2N+1 spans.

Span attributes are all `airflow.`-prefixed. `dag_run.*` spans carry
`airflow.dag_id`, `airflow.dag_run.run_id`, `airflow.dag_run.run_type`
and the run's timestamps. `task_run.*` spans add `airflow.task_id`,
`airflow.task_instance.id`, `airflow.task_instance.state`,
`airflow.task_instance.try_number` and `airflow.task_instance.map_index`.
`worker.*` spans carry the same set without the task instance id and
state.

There are no semantic-convention attributes: no `code.*`, `db.*` or
`messaging.*` keys appear. These are Airflow's own keys.

Three properties to account for:

- **Span names contain DAG and task ids.** Name cardinality grows with
  the number of tasks you have defined, not with traffic. There is no
  equivalent of `legacy_names_on` to move the ids into attributes.
- **Error status is only on `task_run.*` spans.** When a task raises,
  the `task_run.*` span gets an error status and its
  `airflow.task_instance.state` reads `failed` or `up_for_retry`. The
  `worker.*` span stays unset, even though that is where the exception
  was raised. Search `task_run.*` for failures.
- **A DAG run always starts a new trace.** Airflow generates a fresh
  trace id when the DAG run is created and never extracts an incoming
  `traceparent`. Triggering a DAG from an instrumented service gives you
  a new root trace, not a child of the caller.

Sampling is honoured and is decided once per DAG run.
`OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` drive a single root
decision that every span in the run inherits, so a DAG run is either
entirely sampled or entirely absent, never partially.

### What the logs need

Airflow has no OTLP log exporter. The `[logging]` section has no
endpoint, no exporter and no protocol setting, and there is no `otel_on`
for logs the way there is for metrics and traces. Logs are collected
from where Airflow writes them, which takes two receivers because the
two kinds of log behave differently.

**Task logs are already JSON**, with no configuration needed. They land
on a path that encodes the identifiers:

```text
logs/dag_id=my_pipeline/run_id=scheduled__2026-01-01T00:00:00+00:00/task_id=extract/attempt=1.log
```

Each line carries `event` as the message, plus `timestamp`, `level`,
`logger`, `filename`, `lineno`, and usually `dag_id`, `task_id`,
`run_id`, `ti_id`, `try_number` and `map_index`. Task failures add
`error_detail`, a structured array of exception frames rather than a
flattened traceback, so the failing file and line are separate fields.

The first few lines of each attempt carry only `logger`, so parse the
file path as well as the body. The path template is the
`log_filename_template` option; override it and a path-based parser has
to change with it.

**Process logs are plain text by default.** The scheduler, API server,
DAG processor, worker and triggerer write console-rendered text to
stdout. `json_logs`, added in Airflow 3.2.0, turns every line into
single-line JSON, API server HTTP access logs included:

```ini
[logging]
json_logs = True
```

Nothing in the JSON says which process wrote it, the same gap the
metrics have. If you run in containers, label them and have the log
driver write the label into each entry. In Kubernetes the pod metadata
already provides this.

**Logs carry no trace context.** Airflow's log processor chain adds no
`trace_id` and no `span_id`, so log records arrive with both empty and
will not link to spans automatically. Correlate on attributes instead.
The identifiers are the same, under different names:

| Log attribute | Span attribute |
| --- | --- |
| `dag_id` | `airflow.dag_id` |
| `task_id` | `airflow.task_id` |
| `run_id` | `airflow.dag_run.run_id` |
| `try_number` | `airflow.task_instance.try_number` |
| `map_index` | `airflow.task_instance.map_index` |

There is a third route if you would rather push than collect.
`logging_config_class` points Airflow at a Python logging configuration
of your own, and the OpenTelemetry logging SDK ships in the Airflow
image already. Attaching the SDK's logging handler there sends logs over
OTLP with no file collection at all. This guide does not cover writing
that configuration.

## Key Alerts to Configure

Thresholds below are either absolute where the correct value is
unambiguous, or relative to your own trailing baseline. Airflow timings
depend on what your DAGs do, so this guide proposes no absolute latency
numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `airflow.scheduler_heartbeat` | `increase(...[5m]) == 0` | The scheduler is not looping. Nothing will be queued. |
| `airflow.dag_processor_heartbeat` | `increase(...[5m]) == 0` | DAG files stop being re-read, so edits and new DAGs never appear. |
| `airflow.triggerer_heartbeat` | `increase(...[5m]) == 0` | Deferred tasks never resume. Only applies if you use deferrable operators. |
| `airflow.dag_processing.import_errors` | `> 0` | A DAG file does not import, so its DAG cannot be scheduled. |
| `airflow.ti.finish` with `state="failed"` | rate above your trailing baseline | Tasks are failing faster than normal. |
| `airflow.ti_failures` | rate above your trailing baseline | The per-task view of the same signal. Use it to name the task. |
| `airflow.operator_failures` | rate above your trailing baseline | Failures grouped by operator class. Points at a shared dependency rather than one DAG. |
| `airflow.pool.starving_tasks` | `> 0` sustained | Tasks are ready and cannot start because the pool is full. Raise slots or reduce concurrency. |
| `airflow.scheduler.tasks.starving` | `> 0` sustained | The scheduler could not make ready tasks executable. |
| `airflow.executor.open_slots` | `== 0` sustained | Executor saturated. Queued work is not moving. |
| `airflow.pool.open_slots` | `== 0` sustained | Pool saturated. The same condition on a pool instead of the executor. |
| `airflow.triggerer.capacity_left` | `== 0` | Deferrable operators cannot defer. |
| `airflow.ti.queued` | growing while `airflow.ti.running` stays flat | Work is queuing and not starting. Look at the executor or the workers. |
| `airflow.dagbag_size` | drops against its own trailing value | DAGs are missing from the DAG bag. Usually a bad deploy or a failed parse. |
| `airflow.dag_processing.last_run.seconds_ago` | above a multiple of your parse interval | One file has stopped being parsed while others continue. |
| `airflow.dag_processing.total_parse_time` | rising against its own baseline | The parse loop is slowing, so DAG changes take longer to appear. |
| `airflow.scheduler.scheduler_loop_duration` | p95 rising against its own baseline | Scheduler saturation shows up here before work starts queuing. |
| `airflow.scheduler.critical_section_duration` | p95 rising against its own baseline | The locked section where queuing happens is slow. Usually database contention. |
| `airflow.scheduler.executor_heartbeat_duration` | p95 rising against its own baseline | The scheduler is waiting on the executor. On Celery this is the broker or the result backend. |
| `airflow.dagrun.schedule_delay` | p95 above the DAG's own schedule interval | Runs are starting late. A delay larger than the interval means runs are stacking up. |
| `airflow.dagrun.first_task_scheduling_delay` | p95 rising against its own baseline | The run started but its first task waited. Separates scheduler lag from DAG-level delay. |
| `airflow.dagrun.duration.failed` | count rising, or p95 far below `dagrun.duration.success` | Runs are failing. A failed run much shorter than a successful one usually means a dependency is down. |

The remaining Operational gauges - `pool.queued_slots`,
`pool.running_slots`, `scheduler.tasks.executable`,
`executor.queued_tasks`, `executor.running_tasks`, `triggers.running`
and `ti.running` - are dashboard context rather than alerts. Use them to
follow up when one of the alerts above fires.

## Access Setup

### Turn on metrics and traces

Two settings, in `airflow.cfg` or as environment variables:

```ini
[metrics]
otel_on = True
legacy_names_on = False

[traces]
otel_on = True
```

As environment variables, which is usually easier because every process
needs them:

```bash
AIRFLOW__METRICS__OTEL_ON=True
AIRFLOW__METRICS__LEGACY_NAMES_ON=False
AIRFLOW__TRACES__OTEL_ON=True
```

Apply them to all five processes. Each one builds its own SDK and
exports independently.

### Point them at the Collector

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp_proto_http
OTEL_SERVICE_NAME=airflow
```

`OTEL_TRACES_EXPORTER` is required. Without it traces go to gRPC on port
4317 regardless of what `OTEL_EXPORTER_OTLP_PROTOCOL` says.

Then add the process identifier, one value per process:

```bash
# on the scheduler
OTEL_RESOURCE_ATTRIBUTES=airflow.process=scheduler
# on the worker
OTEL_RESOURCE_ATTRIBUTES=airflow.process=worker
```

### Turn on structured process logs

```bash
AIRFLOW__LOGGING__JSON_LOGS=True
```

Task logs are already JSON and are unaffected by this setting.

## Configuration

The `otlp` receiver takes both pushed signals. Airflow sends over
`http/protobuf`, so only the HTTP protocol needs to be open.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      # Scout filters on the lowercase key
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest`. Drop
the traces pipeline if you are only collecting metrics.

`service.name` is set by Airflow through `OTEL_SERVICE_NAME`, so the
`resource` processor here only adds the environment. If you would rather
own the service name at the Collector, add it with `action: upsert`.

### Collecting logs

Logs need a second pipeline and two `file_log` receivers. Task logs come
from the Airflow log directory; process logs come from wherever your
runtime writes container stdout.

```yaml showLineNumbers title="config/otel-collector.yaml (logs)"
receivers:
  file_log/airflow_tasks:
    include: [/airflow-logs/dag_id=*/run_id=*/task_id=*/attempt=*.log]
    include_file_path: true
    operators:
      - type: json_parser
        parse_to: attributes
        timestamp:
          parse_from: attributes.timestamp
          layout_type: gotime
          layout: '2006-01-02T15:04:05.999999Z'
        severity:
          parse_from: attributes.level
          mapping:
            fatal: critical
      - type: move
        from: attributes.event
        to: body
      # The body does not always carry the identifiers; the path always does
      - type: regex_parser
        parse_from: attributes["log.file.path"]
        regex: 'dag_id=(?P<dag_id>[^/]+)/run_id=(?P<run_id>[^/]+)/task_id=(?P<task_id>[^/]+)/attempt=(?P<attempt>\d+)\.log$'
      - type: remove
        field: attributes.timestamp
      - type: remove
        field: attributes.level

  file_log/airflow_processes:
    include: [/var/log/containers/airflow-*.log]
    operators:
      - type: json_parser
        parse_to: attributes
        severity:
          parse_from: attributes.level
          mapping:
            fatal: critical
      - type: move
        from: attributes.event
        to: body

processors:
  # Log records come from files, so nothing has set a service name on them
  resource/logs:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

service:
  pipelines:
    logs:
      receivers: [file_log/airflow_tasks, file_log/airflow_processes]
      processors: [resource/logs, resource, batch]
      exporters: [otlp_http/b14]
```

Mount the Airflow log directory into the Collector read-only. Give the
Collector permission to read it: task log files are written by the
Airflow user, not by the user the Collector runs as.

Point `file_log/airflow_processes` at whatever path your runtime writes
container stdout to, and narrow the glob to Airflow's containers. A
receiver that reads every container on the host parses records it then
discards, and reads the Collector's own output back into the pipeline.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=airflow
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start Airflow and the Collector, then check within about two minutes.
Metrics export on a 60 second interval by default, and traces appear
only once a DAG runs.

```bash showLineNumbers
# Airflow is exporting metrics
docker logs otel-collector 2>&1 | grep -c "airflow.scheduler_heartbeat"

# The process attribute is landing
docker logs otel-collector 2>&1 | grep -o "airflow.process: Str(.*)" | sort -u

# Traces are arriving, once a DAG run has completed
docker logs otel-collector 2>&1 | grep -o "Name *: dag_run\..*" | sort -u

# Task logs are being read
docker logs otel-collector 2>&1 | grep -c "log.file.path"
```

In Scout, filter on the service name you set. You should see
`airflow.scheduler_heartbeat` climbing, `airflow.ti.finish` split by
`state`, and your process attribute with one value per Airflow process.
Search traces for `dag_run.` and you should get a run with 2N+1 spans
for its N tasks.

If metrics arrive and traces do not, check whether a DAG has run. Traces
come only from DAG runs.

## Troubleshooting

### Metrics arrive but traces never do

**Cause**: Traces are going to gRPC. `OTEL_EXPORTER_OTLP_PROTOCOL` does
not apply to the traces path, which reads `OTEL_TRACES_EXPORTER` and
defaults to the gRPC exporter.

**Look at**: the Airflow process logs for an HTTP/2 parse failure -
`Expected SETTINGS frame as the first frame, got frame type 80`, from
`opentelemetry.exporter.otlp.proto.grpc.exporter`. That is a gRPC client
talking to an HTTP server.

**Fix**: Set `OTEL_TRACES_EXPORTER=otlp_proto_http` on every process and
restart. Or open the gRPC port on the Collector if you would rather use
gRPC, in which case set `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` so both
signals agree.

### No traces at all, and no errors anywhere

**Cause**: No DAG has run. Every span comes from a DAG run, so a
deployment with all DAGs paused produces metrics normally and no traces
at all. The symptom is indistinguishable from a broken trace exporter.

**Look at**: whether your DAGs are unpaused, and whether any DAG run
completed since you turned tracing on.

**Fix**: Unpause a DAG or trigger one by hand, then look again. If task
lifecycle metrics such as `airflow.ti.finish` are also missing, this is
almost certainly the cause.

### Spans say `unknown_service` while metrics say `airflow`

**Cause**: No service name is set. The metrics path falls back to
`airflow` and the traces path falls back to the SDK default.

**Fix**: Set `OTEL_SERVICE_NAME` in the shared environment so both
paths read the same value.

### Metric volume is much higher than expected

**Cause**: `legacy_names_on` is on, which is the default from 3.2.0. It
doubles emission and interpolates DAG and task ids into metric names.

**Look at**: whether names like `ti.finish.my_dag.my_task.success`
appear alongside `airflow.ti.finish`.

**Fix**: Set `legacy_names_on = False`. Expect name count to fall by
roughly 80 percent and data points by roughly 40 percent. If a dashboard
depends on the interpolated names, migrate it to the canonical name plus
its attributes first.

### One DAG id still appears inside a metric name

**Cause**: `airflow.dagrun.{dag_id}.first_task_scheduling_delay` ignores
`legacy_names_on`.

**Fix**: Drop it with `metrics_block_list` if the cardinality matters,
remembering that the pattern matches the unprefixed name:
`first_task_scheduling_delay`.

### A block list entry has no effect

**Cause**: The pattern includes the `airflow.` prefix, or uppercase.
Both lists match against the unprefixed, lowercased name.

**Fix**: Write `serde`, not `airflow.serde`.

### Metrics from the API server never appear

**Cause**: This is expected. The API server emits one metric name,
`airflow.serde.load_serializers`, and only at start-up.

**Fix**: Monitor the API server through its traces. It emits every
`task_run.*` span.

### You cannot tell which process a metric came from

**Cause**: Airflow sets no process identifier on anything it sends.

**Fix**: Set `OTEL_RESOURCE_ATTRIBUTES` per process, using the same
attribute name and a different value for each.

### A failure alert on worker spans never fires

**Cause**: Error status lives only on `task_run.*` spans. The
`worker.*` span for a failed task is unset, even though the exception
was raised there.

**Fix**: Alert on `task_run.*` spans with an error status, or on
`airflow.ti.finish` with `state="failed"`.

### Log records show up under the wrong service

**Cause**: Log records built from files have no service name, because
the service name comes from the OpenTelemetry SDK and files have no SDK.
The backend then fills in its own default.

**Fix**: Add a `resource` processor to the logs pipeline that sets
`service.name` with `action: upsert`.

### Trace search returns nothing for a DAG triggered by another service

**Cause**: Airflow does not continue an incoming trace. It generates a
fresh trace id when the DAG run is created.

**Fix**: Search by `airflow.dag_id` and `airflow.dag_run.run_id`
instead, and join to the caller's trace on your own correlation id.

## Updates & Upgrades

### Airflow version changes

- **2.10 adds traces**: `[traces] otel_on` does not exist before 2.10.0.
  An older 2.x deployment gets metrics only, and the trace configuration
  in this guide has nothing to attach to. _(additive)_
- **2.10.3 adds `[metrics] otel_service`**: before it there is no
  metrics-side configuration key for the service name. Use
  `OTEL_SERVICE_NAME` regardless of version: it works on every release
  that supports the push and covers both signals. _(additive)_
- **3.1 adds `[traces] otel_debug_traces_on`** (default `False`), which
  exports spans from Airflow's internal methods on top of the three span
  families in this guide. The spans it adds describe Airflow's own
  internals rather than your DAGs, so leave it off unless you are
  debugging Airflow itself. _(additive)_
- **3.2 changes the primary metric name form**: `legacy_names_on` arrives
  in 3.2.0 with a default of `True`. From 3.2 on, the canonical name
  carrying identifiers as attributes is the primary form, and the
  interpolated legacy name is an additional emission. Both are sent by
  default, so existing dashboards keep resolving across the upgrade, and
  metric volume roughly doubles immediately after it. Migrate queries to
  the canonical names, then set `legacy_names_on = False`.
  _(additive on upgrade, breaking for your volume budget)_
- **3.2 adds `[logging] json_logs`** (default `False`). Below 3.2,
  process logs are console-rendered text and need a text parser rather
  than the `json_parser` shown above. Task logs are JSON on both sides of
  the boundary. _(additive)_
- **3.2 adds `[traces] task_runner_flush_timeout_milliseconds`**
  (default `30000`), how long a task runner waits for the span exporter
  to flush before the process exits. Buffered spans are dropped if it
  does not finish in time. Below 3.2 the wait is not configurable.
  _(additive)_
- **The `otel_*` keys are deprecated across all of these versions.**
  Their documented defaults have never applied. Configure through the
  standard `OTEL_*` environment variables, which behave the same across
  every release listed here. _(no action, but do not adopt the config
  keys)_

### Collector changes

- **The component names in this guide were renamed in contrib 0.149.0.**
  `file_log` was `filelog` and `otlp_http` was `otlphttp`. Both old
  spellings still load and log a deprecation warning on every start.
  Below 0.149.0 the new spellings fail to parse, so a config written
  from this guide needs the old names on an older Collector.
  _(breaking below 0.149.0)_
- **The `otlp` receiver has no rename across the supported range**, so
  the metrics and traces pipelines are stable on a Collector image bump.
  Airflow pushes, so a new Airflow metric needs no Collector change at
  all; there is no per-metric enable list to maintain. _(no breaking
  change on the push path)_

## FAQ

### Do I need an exporter or a sidecar?

No. Airflow builds an OpenTelemetry SDK in each process and pushes
directly to the Collector.

### Which Airflow version do I need?

2.6.0 for metrics, 2.10.0 for traces. The settings this guide uses to
control cardinality and log structure, `legacy_names_on` and
`json_logs`, both need 3.2.0. The table in
[Prerequisites](#prerequisites) lists each setting and the release it
arrived in.

### Do I configure each process separately?

Mostly no. All the settings go in the shared environment. The one
per-process setting is `OTEL_RESOURCE_ATTRIBUTES`, which is how you tell
the processes apart.

### Why do the `otel_host` and `otel_port` settings not work as documented?

They are deprecated, and their documented defaults never apply. Every
one of those keys is read with a `None` fallback, so an unset key falls
through to the standard `OTEL_*` environment variable rather than to the
documented value. Use the environment variables.

### Should I turn `legacy_names_on` off?

Yes, unless you have dashboards built on the interpolated names. It cuts
metric names by about 80 percent and data points by about 40 percent,
and the canonical names carry the same information as attributes.

### Why is there a metric called `airflow.airflow.io.load_filesystems`?

The registry entry is `airflow.io.load_filesystems`, named after the
`airflow.io` module, and the `airflow.` metric prefix is prepended to it.
The doubled prefix is what arrives on the wire.

### How many spans does a DAG run produce?

2N+1 for N tasks: one root `dag_run.*` span, one `task_run.*` span per
task from the API server, and one `worker.*` span per task from the
worker.

### Can I reduce trace volume?

Yes, with `OTEL_TRACES_SAMPLER`. The decision is made once per DAG run
and every span inherits it, so you get whole traces or nothing, never
partial ones.

### Why do my logs not link to my traces?

Airflow does not put trace context into log records. Correlate on
`dag_id`, `task_id`, `run_id` and `try_number`, which appear on both
logs and spans under different names.

### A metric in the Airflow docs never appears. Is something broken?

Probably not. Airflow ships 124 metric names and the deployment we
tested emitted 55. Counters are created on first increment, so an error
counter for something that has not happened does not exist at all.
Others belong to a different executor or to a feature you have not
enabled.

## Related Guides

- [Temporal Monitoring](./temporal.md) - Durable workflow engine where
  workflow code itself is replayable. The closest orchestration
  neighbour, monitored on task queue depth and shard health.
- [Hatchet Monitoring](./hatchet.md) - Postgres-backed distributed task
  queue for background jobs. Task inflow, outcome and worker slot
  capacity map closely onto Airflow's executor and pool metrics, so
  these alert shapes port over.
- [Celery-backed workers on Redis](./redis.md) - In-memory data store
  that serves as the Celery broker behind most Airflow deployments.
  Watch it alongside `airflow.scheduler.executor_heartbeat_duration`,
  which is where broker slowness shows up first.
- [PostgreSQL Monitoring](./postgres.md) - Relational database holding
  the Airflow metadata database. Scheduler critical-section slowness is
  usually database contention, so pair the two.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert
  on Airflow metrics.

## What's Next?

- **Create Dashboards**: Start with a scheduler health and task outcome
  view built on the four Core metrics. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of
  `scheduler_loop_duration`, `dagrun.schedule_delay` and task failure
  rate, then fill in the relative alerts above with numbers that match
  your workload.
- **Decide on cardinality**: `legacy_names_on` and
  `OTEL_METRIC_EXPORT_INTERVAL` are the two settings that move volume
  most. Set both before you build dashboards.
