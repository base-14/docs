---
title: >
  dbt OpenTelemetry Monitoring - Run Outcomes, Model Build Time, Traces,
  and Collector Setup
sidebar_label: dbt
id: collecting-dbt-telemetry
sidebar_position: 71
description: >
  Push dbt traces and logs to the OpenTelemetry Collector and derive run,
  model and test metrics from the spans. Alert on failed models, failed
  tests and slow builds in base14 Scout.
keywords:
  - dbt opentelemetry
  - dbt otel collector
  - dbt fusion telemetry
  - dbt model build time monitoring
  - dbt test failure alerting
  - dbt run traces
  - dbt observability
  - dbt telemetry collection
---

# dbt

dbt v2 pushes traces and logs over OTLP/HTTP when you set one environment
variable. There is no exporter to run and no endpoint to scrape. Each
`dbt build` produces one trace: the invocation, its phases, every model,
seed and test, and every warehouse query. Log records carry the trace and
span ID of the span they belong to.

dbt emits no metrics. The metrics in this guide are derived in the
Collector from the node spans by the `span_metrics` connector. That gives
you a run count, per-node outcomes and per-node durations, which is enough
to alert on a run that did not happen, a model that failed, a test that
failed and a build that is getting slower.

dbt 1.x can send node spans too, with more setup and less detail. It is
covered in [dbt 1.x](#dbt-1x).

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| dbt v2                 | 2.0.0   | 2.0         |
| dbt Core 1.x           | 1.12.1  | 1.12        |
| OTel Collector Contrib | 0.151.0 | Latest      |
| base14 Scout           | Any     | -           |

You need one dbt engine, not both. dbt v2 is the default path in this
guide.

The Collector floor is about component names. The `span_metrics`
connector was called `spanmetrics` before contrib 0.151.0, and the
`file_log` receiver and `otlp_http` exporter were `filelog` and `otlphttp`
before 0.149.0.

Before starting:

- dbt running on a schedule, from an orchestrator, cron or CI. dbt is a
  command-line tool that exits after each run, so the Collector has to be
  running when dbt runs.
- Network from wherever dbt runs to the Collector on port 4318.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Both metrics come from the `span_metrics` connector, with
`namespace: dbt`. They count and time the node spans and the invocation
span, one series per node:

| Metric | Type | Unit | What it tells you |
| --- | --- | --- | --- |
| `dbt.calls` | counter | - | Node and invocation spans, by `span.name`, `status.code`, `node_type`, `node_outcome` and `test_outcome`. |
| `dbt.duration` | histogram | `ms` | Duration of the same spans. |

Series count follows project size, not traffic: one series per model,
seed and test, plus one for the invocation. A project of 30 nodes gives
31 series per metric.

The attribute values differ between the engines:

| Attribute | dbt v2 | dbt 1.x |
| --- | --- | --- |
| `span.name` | `Node processed (<unique_id>)`, `dbt invocation` | `<unique_id>`, `dbt.invocation` |
| `node_type` | `NODE_TYPE_MODEL`, `NODE_TYPE_SEED`, `NODE_TYPE_TEST` | `model`, `seed`, `test` |
| `node_outcome` | `NODE_OUTCOME_SUCCESS`, `NODE_OUTCOME_ERROR` | `success`, `error`, `pass`, `fail` |
| `test_outcome` | `TEST_OUTCOME_FAILED` on failing tests | not set |

### Core - did it run and did anything fail

| Metric | What it tells you |
| --- | --- |
| `dbt.calls` on the invocation span | Runs completed. Flat means dbt stopped running. |
| `dbt.calls` with an error `node_outcome` (v2 `NODE_OUTCOME_ERROR`, 1.x `error`) | Models or seeds that failed to build. |
| `dbt.calls` with v2 `test_outcome` `TEST_OUTCOME_FAILED`, or 1.x `node_outcome` `fail` | Tests that failed. |

### Operational - what to alert on

| Metric | What it tells you |
| --- | --- |
| `dbt.duration` on the invocation span | End-to-end run time. |
| `dbt.duration` per `span.name` with `node_type` model | Build time per model. Names the model that got slower. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `dbt.duration` per `span.name` with `node_type` test | Time per test. |
| `dbt.calls` by `status.code` | A cross-check of the outcome attributes. |

### dbt v2 reports a failing test as a successful node

On v2, a test that returns rows has a `Node processed` span with status
`Ok` and `node_outcome` `NODE_OUTCOME_SUCCESS`. The node ran; the test
result is a separate field. It sits in the `node_test_detail` attribute as
a JSON string:

- A failing test: `{"failing_rows":38,"test_outcome":"TEST_OUTCOME_FAILED"}`.
- A passing test: `{}`.

An alert on `node_outcome` alone never fires for a failed test on v2. The
Collector configuration below parses the JSON and sets a `test_outcome`
attribute, which the connector then uses as a dimension.

A model that fails is reported plainly: status `Error`, `node_outcome`
`NODE_OUTCOME_ERROR` and `node_error_type` `NODE_ERROR_TYPE_USER`. The
invocation span also gets status `Error`.

dbt 1.x reports a failing test directly, with status `Error` and
`node_outcome` `fail`. The 1.x `dbt.invocation` span keeps status `UNSET`
even when nodes fail.

### Three fixes the derived metrics need

Feeding the spans straight into `span_metrics` gives wrong output. The
configuration below makes three changes in a separate traces pipeline, so
the spans sent to Scout are untouched:

- **v2 puts the invocation ID in the invocation span name**, for example
  `dbt invocation (01a0cecb-d1c5-7537-a431-ef21f77865e9)`. Each run would
  create a new series. A `transform` processor rewrites the name to
  `dbt invocation`.
- **dbt 1.x gets a new `service.instance.id` on every run.** The Python
  SDK sets a random one per process, and every `dbt` command is a new
  process, so each run adds a full set of series. After three runs, a
  30-node project has 93 series per metric instead of 31. The configuration
  deletes the attribute before the connector.
- **The v2 test result has to be lifted out of `node_test_detail`**, as
  described in the previous section.

The derive pipeline also filters down to node spans and the invocation
span. v2 emits several spans per node, and counting all of them would
multiply the series.

### What the traces show

Every span is kind `Internal`.

**dbt v2** produces one trace per command. The trace ID is the invocation
ID with the hyphens removed, so invocation
`01a0cedb-3efd-77d5-b11d-0166a89a1160` is trace
`01a0cedb3efd77d5b11d0166a89a1160`. A 30-node `dbt build` produces 186
spans:

| Span name | What it covers | Attribute keys |
| --- | --- | --- |
| `dbt process (<host>)` | The dbt process. Root span. | `host_arch`, `host_os`, `package`, `version` |
| `dbt invocation (<invocation_id>)` | One dbt command. Also a root span. | `eval_args`, `invocation_id`, `metrics`, `process_info`, `raw_command` |
| `Phase: LOAD_PROJECT`, `Phase: PARSE`, `Phase: SCHEDULE`, `Phase: TASK_GRAPH_BUILD` | Build phases. | `phase` |
| `Phase: RENDER (nodes: N)`, `Phase: RUN (nodes: N)` | Render and run phases. | `node_count_error`, `node_count_skipped`, `node_count_total`, `phase` |
| `Asset parsed (<path>)` | One per parsed file. | `display_path`, `name`, `package_name`, `phase`, `relative_path` |
| `Node evaluated (<unique_id>)` | A node in one phase. | `node_outcome`, `node_type`, `node_test_detail`, `materialization`, `schema`, `unique_id` and more |
| `Node processed (<unique_id>)` | A node end to end. The span the metrics come from. | as `Node evaluated`, plus `duration_ms`, `in_selection`, `last_phase`, `node_count_total`, `node_index`; no `phase` |
| `Query executed (<unique_id>)` | One warehouse query for a node. | `adapter_type`, `query_description`, `query_outcome`, `query_error_adapter_message`, `query_error_vendor_code`, `sql`, `sql_hash`, `unique_id` and more |
| `Query executed` | A query outside any node. | `adapter_type`, `dbt_core_event_code`, `query_description`, `query_outcome`, `sql`, `sql_hash` |
| `GenericOpItem: loading (packages)` | Package loading. | `operation_id`, `target` and display fields |
| `Artifact: target/manifest.json`, `Artifact: target/semantic_manifest.json` | Artifact writes. | `artifact_type`, `relative_path` |

`query_outcome` is `QUERY_OUTCOME_SUCCESS` or `QUERY_OUTCOME_ERROR`. The
`metrics` attribute on the invocation span is a JSON string with node and
status counts, for example
`{"node_type_counts":{"model":"5","seed":"3","test":"21"},"status_counts":{"error":"1","success":"28"},"total_errors":"1","total_warnings":"0"}`.
It is a span attribute, not an OpenTelemetry metric.

`sql` on `Query executed` spans holds the full compiled SQL text. If your
queries contain values you treat as sensitive, drop or hash the attribute
in the Collector before it leaves your network.

v2 sets `service.name` to `dbt-oss` and `service.version` to the dbt
version.

**dbt 1.x** produces one span per node, plus `dbt.invocation` and
`metadata.setup`: 32 spans for the same 30-node project. Node span names
are the bare `unique_id`, for example `model.jaffle_shop.orders`. The keys
are `database`, `identifier`, `materialization`, `name`, `node_outcome`,
`node_type`, `relative_path`, `schema` and `unique_id`, with
`rows_affected` on seeds. `dbt.invocation` carries `command`,
`invocation_id` and `version`.

Model and test spans on 1.x carry span links to their upstream nodes,
each link with an `upstream.name` attribute, so the lineage is in the
trace. v2 has no links. 1.x has no query spans and no SQL text.

### What the logs show

**dbt v2 sends logs over OTLP**, with the same switch as traces. Every
record carries the trace ID and span ID of the span it belongs to, so a
log line links straight to its node. A 30-node run sends around 640
records. Progress events have an empty body; errors carry the message. A
failed model looks like this: severity `ERROR`, a body starting
`Database Error in model broken_model`, and the attributes `code`
`1308`, `code_name` `DbDriverFailed`, `phase` and `unique_id`.

**dbt 1.x has no OTLP log export.** It writes JSON to a file, which the
Collector reads with a `file_log` receiver. The records have no trace ID.
Join them to spans on `invocation_id`, which the `dbt.invocation` span
also carries. See [Collect dbt 1.x logs](#collect-dbt-1x-logs).

## Key Alerts to Configure

dbt run times depend entirely on your models and warehouse, so this guide
proposes no absolute duration thresholds. The failure alerts fire on any
increase, because any failure matters.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `dbt.calls` on the invocation span | `increase(...[2 x schedule interval]) == 0` | The scheduled run did not happen. Check the orchestrator. |
| `dbt.calls` with an error `node_outcome` | `increase(...) > 0` | A model or seed failed, and the models downstream of it were skipped. |
| `dbt.calls` with a failed test outcome | `increase(...) > 0` | A data test failed. Route it to the owner of the model under test. On v2 this needs the `test_outcome` transform. |
| `dbt.duration` on the invocation span | p95 above your trailing baseline | Runs are getting slower and will eventually overrun the schedule window. |
| `dbt.duration` per model | p95 above your trailing baseline | Names the model that slowed down. |

The run-count alert has to span at least two schedule intervals. A window
shorter than the gap between runs fires between every pair of runs.

## Access Setup

### dbt v2

Set two environment variables where dbt runs:

```bash
DBT_EXPORT_TO_OTLP=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

`--export-to-otlp` on the command line does the same as
`DBT_EXPORT_TO_OTLP`. The flag does not appear in `dbt --help`,
because it is hidden in the CLI.

v2 sends traces and logs over OTLP/HTTP with protobuf, so the Collector
needs its HTTP port open.

v2 ignores `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`. The service
name is always `dbt-oss`. To report under your own name, set it in the
Collector, as the configuration below does.

When dbt v2 uses DuckDB it fetches its database driver from a CDN on first
use, over HTTPS. A slim container image without CA certificates fails the
build with `No CA certificates were loaded from the system`. Install the
`ca-certificates` package in the image.

### dbt 1.x

dbt 1.x needs three things:

1. The `DBT_ENGINE_SNOWFLAKE_PROJECTS_OTEL=true` environment variable.
2. The OpenTelemetry SDK and an OTLP exporter installed alongside dbt.
   dbt 1.x depends only on the OpenTelemetry API, which does nothing on
   its own.
3. dbt started under `opentelemetry-instrument`, which sets up the SDK.

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http
```

```bash
DBT_ENGINE_SNOWFLAKE_PROJECTS_OTEL=true
OTEL_SERVICE_NAME=dbt
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none

opentelemetry-instrument dbt build
```

With the flag off, or without `opentelemetry-instrument`, dbt runs and
sends nothing. The build output is identical in both cases, and nothing
logs a warning. The only sign is that no spans reach the
Collector.

dbt 1.x sends only traces through the SDK, so `OTEL_METRICS_EXPORTER` and
`OTEL_LOGS_EXPORTER` are set to `none`.

## Configuration

This configuration takes traces and logs from dbt v2, derives the two
metrics, and works unchanged for dbt 1.x traces. The filter and transform
match both engines' span names.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

connectors:
  span_metrics:
    namespace: dbt
    dimensions:
      - name: node_type
      - name: node_outcome
      - name: test_outcome

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  # Keep only node spans and the invocation span for the derived metrics
  filter/dbt_nodes:
    error_mode: ignore
    traces:
      span:
        - >-
          attributes["node_outcome"] == nil
          and not IsMatch(name, "^(dbt invocation|dbt\\.invocation)")
        - IsMatch(name, "^Node evaluated")

  transform/dbt_nodes:
    error_mode: ignore
    trace_statements:
      - replace_pattern(span.name, "^dbt invocation \\(.*\\)$", "dbt invocation")
      - set(span.attributes["test_outcome"], ParseJSON(span.attributes["node_test_detail"])["test_outcome"]) where IsMatch(span.attributes["node_test_detail"], "test_outcome")

  resource/drop_instance_id:
    attributes:
      - key: service.instance.id
        action: delete

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    traces/dbt_node_metrics:
      receivers: [otlp]
      processors: [filter/dbt_nodes, transform/dbt_nodes, resource/drop_instance_id]
      exporters: [span_metrics]
    metrics:
      receivers: [span_metrics]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    logs:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest`.

The `otlp` receiver feeds two traces pipelines. `traces` sends the spans
to Scout as they arrived. `traces/dbt_node_metrics` filters, renames and
strips them, then hands them to the connector, and nothing from it is
exported as a trace.

The filter drops any span without a `node_outcome` attribute, except the
invocation span, and drops v2's `Node evaluated` spans, which repeat each
node once per phase. What is left is one span per node per run, plus one
for the invocation.

The guard on the `set` statement matters. Passing tests have
`node_test_detail` set to `{}`, and without the `IsMatch` check the
statement logs `key not found in map` for every one of them.

The `resource` processor sets `service.name` with `upsert`, which replaces
v2's fixed `dbt-oss`. If you run both engines against one Collector and
want them apart, use `insert` instead: 1.x keeps the name from
`OTEL_SERVICE_NAME` and v2 keeps `dbt-oss`.

The logs pipeline carries dbt v2 logs. dbt 1.x sends no OTLP logs, so on
1.x the pipeline is idle until you add the file receiver below.

### Collect dbt 1.x logs

Have dbt 1.x write JSON to a file the Collector can read:

```bash
opentelemetry-instrument dbt \
  --log-format-file json --log-level-file info --no-use-colors-file \
  --log-path /dbt-logs \
  build
```

`--log-level-file info` keeps the file to run and node events. At the
default debug level, most lines are debug output. `--no-use-colors-file`
keeps ANSI colour codes out of the messages.

Each line nests its fields under `info` and `data`. The receiver moves the
useful ones to the body, severity, timestamp and flat attributes:

```yaml showLineNumbers title="config/otel-collector.yaml (dbt 1.x logs)"
receivers:
  file_log/dbt_v1:
    include: [/dbt-logs/dbt.log]
    operators:
      - type: json_parser
        parse_to: attributes
        timestamp:
          parse_from: attributes.info.ts
          layout_type: gotime
          layout: '2006-01-02T15:04:05.999999Z'
        severity:
          parse_from: attributes.info.level
      - type: move
        from: attributes.info.msg
        to: body
      - type: move
        from: attributes.info.invocation_id
        to: attributes.invocation_id
      - type: move
        from: attributes.info.code
        to: attributes.code
      - type: move
        from: attributes.info.name
        to: attributes.event_name
      - type: move
        if: 'attributes.data?.node_info?.unique_id != nil'
        from: attributes.data.node_info.unique_id
        to: attributes.unique_id
      - type: remove
        field: attributes.info
      - type: remove
        field: attributes.data

service:
  pipelines:
    logs/dbt_v1:
      receivers: [file_log/dbt_v1]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Mount the dbt log directory into the Collector read-only. The receiver
starts at the end of the file by default; set `start_at: beginning` to
read lines written before the Collector started. The `resource`
processor gives the records a service name, which file-based records do
not otherwise have.

A failed model arrives with severity `error`, `event_name`
`LogModelResult`, `code` `Q012`, the model's `unique_id` and the
`invocation_id` of the run.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=dbt
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector, run `dbt build` once, then check. Metrics appear
shortly after the run finishes, when the connector flushes.

```bash showLineNumbers
# Node spans are arriving (v2)
docker logs otel-collector 2>&1 | grep -c "Node processed"

# Spans are arriving (1.x)
docker logs otel-collector 2>&1 | grep -c "dbt.invocation"

# The derived metrics exist
docker logs otel-collector 2>&1 | grep -o "dbt\.\(calls\|duration\)" | sort -u
```

The `docker logs` checks need a `debug` exporter in the pipeline. Add one
while you verify and take it out afterwards.

In Scout, filter on the service name you set. Search traces for
`dbt invocation` on v2 or `dbt.invocation` on 1.x. Each run has one
invocation span and one span per node. `dbt.calls` should have one series per
node plus one for the invocation, and the count should stay the same from
one run to the next.

## Troubleshooting

### dbt 1.x runs and no spans arrive

**Cause**: The flag is off, the SDK is missing, or dbt was not started
under `opentelemetry-instrument`. With the flag off or without the
wrapper, the build looks normal and nothing logs a warning.

**Look at**: `DBT_ENGINE_SNOWFLAKE_PROJECTS_OTEL` in the environment dbt
actually runs in, and whether the command starts with
`opentelemetry-instrument`.

**Fix**: Set all three, as in [dbt 1.x](#dbt-1x). Run once by hand with a
`debug` exporter on the Collector to confirm.

### dbt v2 runs and no spans arrive

**Cause**: `DBT_EXPORT_TO_OTLP` is not set in the environment dbt runs in,
or the endpoint does not point at the Collector's HTTP port.

**Fix**: Set `DBT_EXPORT_TO_OTLP=true` and point
`OTEL_EXPORTER_OTLP_ENDPOINT` at the Collector's HTTP port, 4318.

### Everything from dbt v2 reports as `dbt-oss`

**Cause**: v2 hard-codes its service name and ignores `OTEL_SERVICE_NAME`
and `OTEL_RESOURCE_ATTRIBUTES`.

**Fix**: Set `service.name` in the Collector's `resource` processor with
`action: upsert`.

### A failed test never fires the alert on dbt v2

**Cause**: v2 reports a failing test with status `Ok` and `node_outcome`
`NODE_OUTCOME_SUCCESS`. The result is only in `node_test_detail`.

**Fix**: Add the `transform/dbt_nodes` processor from
[Configuration](#configuration) and alert on `test_outcome`
`TEST_OUTCOME_FAILED`.

### `dbt.calls` series grow with every run

**Cause**: Something per-run is reaching the connector. On v2 it is the
invocation ID in the invocation span name. On 1.x it is the random
`service.instance.id` the Python SDK sets per process.

**Look at**: the `span.name` values and resource attributes on the new
series.

**Fix**: Use the `replace_pattern` statement and the
`resource/drop_instance_id` processor from the configuration, both in the
derive pipeline.

### The Collector logs `key not found in map`

**Cause**: The `test_outcome` statement runs on passing tests, whose
`node_test_detail` is `{}`.

**Fix**: Guard the statement with
`where IsMatch(span.attributes["node_test_detail"], "test_outcome")`.

### The Collector warns that `spanmetrics` is deprecated

**Cause**: The connector was renamed to `span_metrics` in contrib 0.151.0.
The old name still loads, with a warning.

**Fix**: Rename it in the `connectors` block and in the pipeline that
exports to it.

### dbt v2 fails to load the DuckDB driver in a container

**Cause**: The image has no CA certificates, so the driver download from
the CDN fails.

**Fix**: Install `ca-certificates` in the image. To move the download out
of run time, run one dbt command while building the image.

### dbt 1.x log messages contain escape codes

**Cause**: The file log is written with colour codes.

**Fix**: Add `--no-use-colors-file`.

## FAQ

### Does dbt emit metrics?

No. Both engines send traces, and v2 sends logs. Every metric in this
guide is derived in the Collector by the `span_metrics` connector.

### Which engine should I use?

dbt v2, if your adapter supports it. It turns on with one variable, sends
logs that link to spans, and includes per-query spans. dbt 1.x needs the
Python SDK and a wrapper, sends only node spans, and writes logs to a
file. 1.x has span links to upstream nodes, which v2 does not.

### How do I join dbt 1.x logs to traces?

On `invocation_id`. The log records and the `dbt.invocation` span both
carry it. The records have no trace ID.

### Does dbt continue a trace started by my orchestrator?

Do not rely on it. Search by `invocation_id` instead, and on v2 derive the
trace ID from it by removing the hyphens.

### Can I use OpenLineage instead?

Not for this. OpenLineage sends lineage events to an OpenLineage backend,
not OTLP to a Collector.

### Does the telemetry contain my SQL?

On v2, yes. `Query executed` spans carry the full compiled SQL in the
`sql` attribute. dbt 1.x sends no query spans.

## Related Guides

- [Apache Airflow Monitoring](./airflow.md) - Workflow orchestrator that
  often schedules dbt runs. Its DAG run traces and dbt's invocation traces
  are separate; correlate on your own run identifier.
- [Trino Monitoring](./trino.md) - Distributed SQL engine that dbt can
  build models on. Slow models in dbt usually show up as slow queries
  there.
- [PostgreSQL Monitoring](./postgres.md) - Relational database and a
  common dbt warehouse.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  dbt metrics.

## What's Next?

- **Create Dashboards**: Start with run count, failed nodes and failed
  tests from the Core tier, and invocation duration beside them. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of invocation and per-model
  `dbt.duration`, then fill in the relative alerts above with numbers
  that match your project.
- **Decide what leaves your network**: If query text is sensitive, drop
  or hash `sql` before building dashboards on v2 traces.
