---
title:
  Pydantic AI on Temporal OpenTelemetry Tracing - One Trace Across Replay
sidebar_label: Pydantic AI on Temporal
sidebar_position: 7.6
description:
  Trace durable Pydantic AI agents on Temporal with OpenTelemetry. One trace per
  workflow across replay and crashes, with logs and replay-safe metrics.
keywords:
  [
    pydantic ai temporal opentelemetry,
    temporal python tracing,
    durable agent observability,
    temporal workflow spans,
    OpenTelemetryPlugin temporal,
    create_tracer_provider,
    ReplaySafeMeterProvider,
    ReplaySafeLoggerProvider,
    TemporalDurability,
    PydanticAIPlugin,
    temporal TracingInterceptor alternative,
    temporal replay safe spans,
    temporal worker crash tracing,
    temporal signal span link,
    human in the loop agent tracing,
    temporal activity retry tracing,
    genai semantic conventions python,
  ]
---

# Pydantic AI on Temporal

A durable agent runs inside a Temporal workflow. Every model request and tool
call becomes an activity, the workflow can wait days for a person, and a
worker can die and be replaced without losing the run. This guide wires
OpenTelemetry so that a whole workflow stays one trace through all of that:
through replay, retries and a worker restart, with logs and metrics that are
not duplicated when Temporal replays history.

The example is a KYC (know your customer) onboarding service. Each case is a
workflow. Documents arrive as signals, an extraction agent and an assessment
agent decide the case on local Ollama models, and escalated cases wait for a
reviewer's decision, sent as a Temporal update. For the agent-level spans,
content capture and token metrics, see [Pydantic AI](./pydantic-ai.md). This
page covers what Temporal adds.

:::tip TL;DR

Build the tracer provider with `create_tracer_provider` from
`temporalio.contrib.opentelemetry` and export through a `BatchSpanProcessor`.
Wrap the meter and logger providers in `ReplaySafeMeterProvider` and
`ReplaySafeLoggerProvider`. Connect the client with `PydanticAIPlugin()` and
`OpenTelemetryPlugin(add_temporal_spans=True)`, and give each agent
`TemporalDurability`. Spans started in workflow code are then emitted once,
with real durations, in one trace per workflow.

:::

> **Note:** For the vendor-neutral reference agent, see the
> [OpenTelemetry Demo agent service](https://github.com/open-telemetry/opentelemetry-demo/tree/main/src/agent),
> added in OpenTelemetry Demo 3.0. It is a LangGraph agent without durable
> execution.

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running Pydantic AI agents as Temporal workflows.
- Teams with agents that wait for people, where a request trace ends long
  before the work does.
- Teams on Temporal's Python SDK who want workflow spans that survive replay.

## Overview

- Wire the Temporal and Pydantic AI plugins with a replay-safe tracer provider.
- Understand why the example does not use `TracingInterceptor`.
- Read the trace of a case, open or closed, with its wait spans, budgets and
  escalations.
- Link signals and updates from their own request traces into the case trace.
- Go from a log line to its trace and back.
- Record application metrics from workflow code without double counting.
- Keep content capture and Temporal history in mind as two copies of the same
  data.

## Prerequisites

- Python 3.14 and [uv](https://docs.astral.sh/uv/).
- Docker and Docker Compose. The example runs Temporal, Postgres and the
  collector in Compose, so the Temporal CLI is not needed on the host.
- Ollama on the host with `gemma4:e2b` and `qwen3.5:9B` pulled.
- `curl` and `jq` for the commands in [Running Your Application](#running-your-application).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `pydantic-ai-slim` | 2.49.0, with the `temporal` and `openai` extras |
| `temporalio` | 1.33.0, with the `opentelemetry` extra |
| `opentelemetry-sdk`, `opentelemetry-api`, OTLP HTTP exporter | 1.44.0 |
| `opentelemetry-instrumentation-fastapi`, `-psycopg`, `-logging` | 0.65b0 |
| `fastapi` / `uvicorn` | 0.141.1 / 0.53.0 |
| Temporal server and admin tools | 1.32.0 |
| Temporal UI | 2.54.1 |
| PostgreSQL | 18.6 |
| OTel Collector contrib | 0.161.0 |
| Example | [`ai-kyc-onboarding`](https://github.com/base-14/examples/tree/main/python/ai-kyc-onboarding) |

`OpenTelemetryPlugin`, `create_tracer_provider` and the replay-safe providers
are marked experimental in temporalio 1.33.0. Pin both `temporalio` and
`pydantic-ai-slim` exactly.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add "pydantic-ai-slim[temporal,openai]==2.49.0" \
  "temporalio[opentelemetry]==1.33.0" \
  opentelemetry-sdk==1.44.0 \
  opentelemetry-exporter-otlp-proto-http==1.44.0 \
  opentelemetry-instrumentation-logging==0.65b0
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install "pydantic-ai-slim[temporal,openai]==2.49.0" \
  "temporalio[opentelemetry]==1.33.0" \
  opentelemetry-sdk==1.44.0 \
  opentelemetry-exporter-otlp-proto-http==1.44.0 \
  opentelemetry-instrumentation-logging==0.65b0
```

```mdx-code-block
</TabItem>
</Tabs>
```

Add the FastAPI and psycopg instrumentations if your service uses them, as
the example does.

## Configuration

Take these steps in your own app. Each one says which process the code goes
in: the API process that starts workflows, the worker that runs them, or
both. The excerpts come from the example's `src/kyc_onboarding/telemetry.py`
unless a title says otherwise.

### 1. Build the tracer provider

In both processes, before the Temporal client is created:

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from temporalio.contrib.opentelemetry import create_tracer_provider


def configure_tracing(fallback_service_name: str) -> None:
    provider = create_tracer_provider(resource=_resource(fallback_service_name))
    exporter = CostAndErrorAttributingSpanExporter(OTLPSpanExporter())
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
```

- **`create_tracer_provider`** returns a provider whose IDs come from
  `TemporalIdGenerator`, which draws span and trace IDs from the workflow's
  deterministic random. A replay rebuilds the same IDs. Spans started during
  replay are backdated to workflow time, and `end()` is skipped while
  replaying, so no span is emitted twice.
- **`BatchSpanProcessor`** exports on its own thread. A `SimpleSpanProcessor`
  exports when each span ends, which puts a network call inside the workflow
  task.
- **`CostAndErrorAttributingSpanExporter`** is the example's own wrapper. Use
  `OTLPSpanExporter()` directly if you do not need one.
- **`Agent.instrument_all`** is called in the same setup, as on the
  [Pydantic AI](./pydantic-ai.md#configuration) page.

To confirm, finish step 5 and start the worker. It starts without the
`ReplaySafeTracerProvider` error described in
[Troubleshooting](#troubleshooting).

### 2. Wrap the meter and logger providers

In both processes, next to the tracer provider:

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
import logging

from opentelemetry import metrics as otel_metrics
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from temporalio.contrib.opentelemetry import ReplaySafeLoggerProvider, ReplaySafeMeterProvider


def configure_metrics(fallback_service_name: str) -> None:
    reader = PeriodicExportingMetricReader(OTLPMetricExporter())
    provider = MeterProvider(resource=_resource(fallback_service_name), metric_readers=[reader])
    otel_metrics.set_meter_provider(ReplaySafeMeterProvider(provider))


def install_logging(provider: LoggerProvider) -> None:
    replay_safe_provider = ReplaySafeLoggerProvider(provider)
    set_logger_provider(replay_safe_provider)
    logging.getLogger().addHandler(LoggingHandler(logger_provider=replay_safe_provider))


def configure_logging(fallback_service_name: str) -> None:
    provider = LoggerProvider(resource=_resource(fallback_service_name))
    provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    install_logging(provider)
```

`ReplaySafeMeterProvider` and `ReplaySafeLoggerProvider` drop records made
during replay, so a metric is counted once and a log line is written once.
`workflow.logger` already skips logging during replay; the logger wrapper
covers any other logger called from workflow code.

To confirm, record a counter from workflow code, then restart the worker
while that workflow is still open. After the replay, the counter has not
doubled.

### 3. Connect the client with both plugins

In both processes. The worker is built from this client and inherits its
plugins:

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from temporalio.client import Client
from temporalio.contrib.opentelemetry import OpenTelemetryPlugin
from temporalio.runtime import OpenTelemetryConfig, Runtime, TelemetryConfig


def build_temporal_runtime() -> Runtime:
    return Runtime(
        telemetry=TelemetryConfig(
            metrics=OpenTelemetryConfig(url=temporal_metrics_url(), http=True),
        )
    )


async def create_temporal_client(settings: Settings) -> Client:
    return await Client.connect(
        settings.temporal_address,
        runtime=build_temporal_runtime(),
        plugins=[PydanticAIPlugin(), OpenTelemetryPlugin(add_temporal_spans=True)],
    )
```

- **`OpenTelemetryPlugin`** propagates trace context through Temporal headers
  and adds `opentelemetry` to the workflow sandbox's passthrough modules.
- **`add_temporal_spans=True`** adds the `StartWorkflow`, `RunWorkflow`,
  `StartActivity`, `RunActivity`, signal, update and query spans. Without it
  there is no workflow span, and spans from workflow code parent straight to
  the caller's span, such as `POST /cases`.
- **`PydanticAIPlugin`** sets up the data converter and workflow sandbox
  settings Pydantic AI needs, and makes Pydantic AI's run errors fail the
  workflow rather than retry the workflow task.
- **The runtime** is optional. It exports Temporal SDK metrics over OTLP HTTP.
  It does not read `OTEL_EXPORTER_OTLP_ENDPOINT`, so `temporal_metrics_url()`
  builds `<endpoint>/v1/metrics` from it.

To confirm, start a workflow from the API. Its trace has a `StartWorkflow`
span under the request span.

### 4. Give each agent `TemporalDurability`

Where the agents are defined. Build them at worker startup, outside the
workflow, so their activities can be registered:

```python showLineNumbers title="src/kyc_onboarding/agents/extraction.py (excerpt)"
from datetime import timedelta

from pydantic_ai import Agent
from pydantic_ai.durable_exec.temporal import TemporalDurability
from temporalio.common import RetryPolicy
from temporalio.workflow import ActivityConfig

MODEL_ACTIVITY_CONFIG: ActivityConfig = ActivityConfig(
    start_to_close_timeout=timedelta(seconds=120),
    retry_policy=RetryPolicy(
        initial_interval=timedelta(seconds=2),
        backoff_coefficient=2.0,
        maximum_interval=timedelta(seconds=30),
        maximum_attempts=5,
    ),
)

Agent(
    ...,
    capabilities=[
        TemporalDurability[None](
            activity_config=TOOL_ACTIVITY_CONFIG,
            model_activity_config=MODEL_ACTIVITY_CONFIG,
        )
    ],
)
```

`TemporalDurability` routes each model request and tool call through an
activity. It replaces the deprecated `TemporalAgent`. The example's settings
give model requests a 120 second timeout and tool calls 30 seconds, each with
up to five attempts. `TemporalDurability` also gives model-request activities
a 30 second heartbeat timeout by default. Outside a workflow the capability
passes calls straight through, so the same agent still runs as a plain agent.

To confirm, run an agent from a workflow. Each `chat` span has a
`StartActivity` child with a `RunActivity` under it.

### 5. Register the agents on the worker

In the worker:

```python showLineNumbers title="src/kyc_onboarding/worker.py (excerpt)"
from pydantic_ai.durable_exec.temporal import AgentPlugin
from temporalio.worker import Worker

return Worker(
    client,
    task_queue=task_queue,
    workflows=[KycOnboardingWorkflow],
    plugins=[AgentPlugin(agents.extraction), AgentPlugin(agents.assessment)],
    interceptors=[ActivityAttemptInterceptor()],
    **options,
)
```

`AgentPlugin` registers each agent's model request and tool call activities
with the worker. To confirm, run a workflow to its end. A
`RunWorkflow:<workflow>` span appears under `StartWorkflow` when the workflow
closes.

### 6. Add the attempt interceptor (optional)

In the worker, in `Worker(interceptors=...)` as above. Temporal's spans carry
`temporalWorkflowID`, `temporalRunID` and `temporalActivityID`, but no attempt
number. This interceptor adds one:

```python showLineNumbers title="src/kyc_onboarding/interceptors.py"
from typing import Any

from opentelemetry import trace
from temporalio import activity
from temporalio.worker import ActivityInboundInterceptor, ExecuteActivityInput, Interceptor

ACTIVITY_ATTEMPT_ATTRIBUTE = "base14.temporal.activity.attempt"


class ActivityAttemptInterceptor(Interceptor):
    def intercept_activity(self, next: ActivityInboundInterceptor) -> ActivityInboundInterceptor:
        return _ActivityAttemptInboundInterceptor(next)


class _ActivityAttemptInboundInterceptor(ActivityInboundInterceptor):
    async def execute_activity(self, input: ExecuteActivityInput) -> Any:
        trace.get_current_span().set_attribute(ACTIVITY_ATTEMPT_ATTRIBUTE, activity.info().attempt)
        return await self.next.execute_activity(input)
```

Client interceptors run first, so the `RunActivity` span is already open when
it sets the attribute. To confirm, check that every `RunActivity` span carries
`base14.temporal.activity.attempt`.

### The example's environment

```bash showLineNumbers title=".env.example (excerpt)"
TEMPORAL_TASK_QUEUE=kyc-onboarding
KYC_FAULTS_ENABLED=false
DOCUMENT_DEADLINE_DAYS=3
REVIEW_DEADLINE_DAYS=2
REQUEST_BUDGET=40
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

`compose.yaml` sets `OTEL_SERVICE_NAME` to `ai-kyc-onboarding-api` and
`ai-kyc-onboarding-worker`, `TEMPORAL_ADDRESS` to `temporal:7233` and
`OTEL_METRIC_EXPORT_INTERVAL` to 10000 ms. Workflow code cannot read the
environment, so the API passes deadlines and the budget into the workflow
input when it starts a case.

## Why Not `TracingInterceptor`

`temporalio.contrib.opentelemetry` has an older integration,
`TracingInterceptor`. Two things in its source make it a poor fit for a
workflow that runs for days:

- **Workflow spans have no duration.** It starts and ends each workflow span
  at the same instant. A wait of days shows as a zero-length span.
- **Workflow spans can be missing.** With `always_create_workflow_spans=False`,
  the default, it creates workflow spans only when a client span is present.
  A workflow started from the CLI or a schedule gets none. Setting it to
  `True` risks orphaned spans after replay.

`OpenTelemetryPlugin` with `create_tracer_provider` replaces both with
deterministic IDs and replay-safe spans, so spans in workflow code have real
durations and parent correctly. Pydantic AI's `LogfirePlugin` still uses
`TracingInterceptor`; the example does not use it.

## The Trace of One Case

A case is one trace, from `POST /cases` to the close, however long it waits.
This case was escalated for a near sanctions match and approved by a
reviewer. `SELECT` spans from psycopg and some model turns are left out.

```text showLineNumbers title="One case, one trace"
POST /cases                                           api
`-- StartWorkflow:KycOnboardingWorkflow               api
    `-- RunWorkflow:KycOnboardingWorkflow             worker, ends when the case closes
        |-- kyc.await_documents                       round 0
        |   |-- kyc.document_received                 id, linked to its HandleSignal span
        |   `-- kyc.document_received                 proof_of_address
        |-- kyc.assess
        |   |-- invoke_agent kyc-extraction           one per document
        |   |   `-- chat gemma4:e2b
        |   |       `-- StartActivity:agent__kyc-extraction__model_request
        |   |           `-- RunActivity:agent__kyc-extraction__model_request
        |   |-- invoke_agent kyc-extraction
        |   |   `-- chat gemma4:e2b ...
        |   `-- invoke_agent kyc-assessment
        |       |-- chat qwen3.5:9B ...
        |       |-- execute_tool compare_identity
        |       |   `-- StartActivity:agent__kyc-assessment__toolset__<agent>__call_tool
        |       |       `-- RunActivity:agent__kyc-assessment__toolset__<agent>__call_tool
        |       |-- execute_tool screen_sanctions ...
        |       |-- execute_tool check_expiry ...
        |       |-- chat qwen3.5:9B ...
        |       `-- execute_tool decision_from_answer
        `-- kyc.await_review
            `-- kyc.review_received                   linked to its HandleUpdate span
```

The Pydantic AI spans run in workflow code and go through the replay-safe
provider with no extra wiring. Each model request nests as `invoke_agent` >
`chat` > `StartActivity` > `RunActivity`, across the activity boundary.

### Hand-written spans

The workflow adds five spans. They cover the waits and the arrivals, which no
framework records. Framework spans are not duplicated.

| Span | Covers |
| --- | --- |
| `kyc.await_documents` | One document round, until the documents are complete or the deadline passes. |
| `kyc.document_received` | The workflow taking in one signalled document. |
| `kyc.assess` | Extraction of new documents and one assessment run. |
| `kyc.await_review` | The wait for a reviewer, until a decision or the deadline. |
| `kyc.review_received` | The workflow taking in the reviewer's decision. |

Start them with the ordinary tracer in workflow code:

```python showLineNumbers title="src/kyc_onboarding/workflows.py (excerpt)"
with _tracer().start_as_current_span(
    "kyc.await_documents", attributes=self._round_attributes()
):
```

### Signals and updates link into the case trace

Documents, reviews and status reads are separate HTTP requests, so each has
its own trace:

- `POST /cases/{case_id}/documents` > `SignalWorkflow:submit_document` >
  `HandleSignal:submit_document`.
- `POST /cases/{case_id}/review` > `StartWorkflowUpdate:submit_review` >
  `ValidateUpdate:submit_review` and `HandleUpdate:submit_review`.
- `GET /cases/{case_id}` > `QueryWorkflow:status` > `HandleQuery:status`.

The handler span sits in the sender's trace, not the case trace. To connect
them, the handler keeps its span context and the workflow starts the arrival
span with a link to it:

```python showLineNumbers title="src/kyc_onboarding/workflows.py (excerpt)"
@workflow.signal
def submit_document(self, document: SubmittedDocument) -> None:
    self._document_inbox.append(
        _DocumentArrival(document, trace.get_current_span().get_span_context())
    )

# later, in the document wait
with _tracer().start_as_current_span(
    "kyc.document_received",
    links=[Link(arrival.sender_span)],
    attributes={
        CASE_ID_ATTRIBUTE: self._case.case_id,
        DOCUMENT_TYPE_ATTRIBUTE: document_type.value,
    },
):
```

The update handler does the same for `kyc.review_received`. The link resolves
to the exported `HandleSignal` or `HandleUpdate` span, under replay too.
Follow it from the case trace to the request that moved the case, and back.

### Attributes on the case spans

All custom keys use the `base14.` prefix, since semconv owns `gen_ai.*`.

| Span | Attributes |
| --- | --- |
| `POST /cases` | `base14.kyc.case_id`, `base14.kyc.account_type`. |
| `RunWorkflow:KycOnboardingWorkflow` | `base14.kyc.case_id`, `base14.kyc.account_type`. At the close, `base14.kyc.resubmission_round`, `base14.kyc.outcome` and, if escalated, `base14.kyc.escalation_reason`. |
| `kyc.await_documents` | The case and round attributes. `base14.kyc.missing_documents` when the deadline passes. |
| `kyc.assess` | The case and round attributes, `base14.prompt.version`, `base14.kyc.assessment_decision`. `base14.kyc.risk_level`, `base14.kyc.documents_to_resend` or `base14.kyc.escalation_reason` by decision. |
| `kyc.await_review` | The case and round attributes, `base14.kyc.escalation_reason`. |
| `kyc.document_received`, `kyc.review_received` | `base14.kyc.case_id`, `base14.kyc.document_type` or `base14.kyc.review_decision`. |
| Every `RunActivity:*` | `base14.temporal.activity.attempt`. |
| `RunActivity` of `screen_sanctions` | `base14.kyc.sanctions.result` and `base14.kyc.sanctions.score`, never the matched name. |

## Reading an Open Case

A span is exported when it ends. `RunWorkflow` ends when the case closes, so
while a case waits for documents or a reviewer, the trace store has
`POST /cases`, `StartWorkflow` and the finished child spans, but not the
`RunWorkflow` span they hang from. The finished children show under a missing
parent until the case closes. This is expected.

To read an open case:

- Search spans by `base14.kyc.case_id`. The wait and assess spans that have
  finished carry it.
- Search GenAI spans by `gen_ai.conversation.id`, which is the case ID.
- A `kyc.await_documents` span that has ended means that round's documents
  arrived. The current wait is still open and not yet exported.
- Use `GET /cases/{case_id}` or Temporal UI for the live status.

## Waits, Budgets and Escalation

- **Deadlines.** The example's settings give a case 3 days per document
  round and 2 days for a reviewer. A passed document deadline closes the case as
  `expired`, sets `base14.kyc.missing_documents` and logs WARN
  `document deadline passed` on `kyc.await_documents`. A passed review
  deadline logs WARN `review deadline passed` on `kyc.await_review` and also
  closes the case as `expired`.
- **Budget.** The example caps model requests at 40 per case, 3 per
  extraction run and 10 per assessment run, through Pydantic AI usage
  limits. The workflow sums usage across runs.
- **Escalation.** An agent failure never fails the workflow. It escalates the
  case with `base14.kyc.escalation_reason` on `kyc.assess`.

| Reason | When | What the trace shows |
| --- | --- | --- |
| `risk` | The assessment agent chose `escalate`. | `base14.kyc.risk_level` on `kyc.assess`, then `kyc.await_review`. |
| `budget` | A run hit its request limit. | The `invoke_agent` span that hit the limit, with error status and `error.type=pydantic_ai.exceptions.UsageLimitExceeded`. |
| `invalid_output` | Output still failed validation after its retries, extraction returned the wrong document type, or a resubmission named no documents. | ERROR `agent run failed` on `kyc.assess`, or only the WARN escalation line. |
| `agent_error` | An agent activity failed after all its retries, or the run failed some other way. | Failed `RunActivity` attempts, then the escalation. |

The escalation is caught in the workflow, so the case goes on to
`kyc.await_review`:

```python showLineNumbers title="src/kyc_onboarding/workflows.py (excerpt, Python 3.14 syntax)"
try:
    await self._extract_new_documents(agents)
    decision = await self._run_assessment(agents)
except UsageLimitExceeded:
    return self._agent_run_failed(span, EscalationReason.budget)
except UnexpectedModelBehavior, _ExtractedWrongDocumentType:
    return self._agent_run_failed(span, EscalationReason.invalid_output)
except ActivityError, AgentRunError:
    return self._agent_run_failed(span, EscalationReason.agent_error)
```

## Retries and Worker Crashes

Each activity attempt is its own `RunActivity` span with
`base14.temporal.activity.attempt`. The scenarios in the example produce
these shapes:

- **Model unavailable.** Two
  `RunActivity:agent__kyc-extraction__model_request` spans with error status,
  each with an ERROR `injected model_unavailable fault` line, then attempt 3
  succeeds. All three sit under one `StartActivity`, inside one `chat` span.
- **Sanctions service down.** Three failed `screen_sanctions` attempts per
  screening, each with `base14.kyc.sanctions.result=error`, then attempt 4
  succeeds.
- **Worker crash.** The worker is killed with SIGKILL during an assessment
  model request and restarted. What you see: the case stays one trace, with
  spans and logs from two worker `service.instance.id` values, and the killed
  model request shows as one `RunActivity` span, one attempt higher. The
  killed attempt exported nothing.
- **Why a crash keeps one trace.** The replacement worker replays the case
  and rebuilds the same span IDs. It rebuilds `RunWorkflow` with its original
  start and exports it when the case closes, so the span covers the whole
  case. The rerun starts after the model-request heartbeat timeout, 30 seconds
  by default in `TemporalDurability`.

A `kill -9` loses the spans the `BatchSpanProcessor` has not exported yet. Its
schedule delay is 5 seconds by default, set by `OTEL_BSP_SCHEDULE_DELAY`.
Temporal reruns the activity, so the case is unaffected, but those spans are
gone.

Workflow task failures, including nondeterminism after a code change, keep
Temporal's default of retrying the task. They show in Temporal UI and in the
Temporal SDK metrics.

## From a Log Line to Its Trace and Back

Worker and API export logs over OTLP through the replay-safe logger provider.
Workflow code logs through `workflow.logger` and activities through
`activity.logger`, so a replay after a crash writes no duplicate lines. Each
record carries the trace ID and span ID of the span it was written under, and
every case line carries `base14.kyc.case_id`.

| Line | Level | Span |
| --- | --- | --- |
| `case created` | INFO | `POST /cases` |
| `documents complete` | INFO | `kyc.await_documents` |
| `assessment decided <decision>` | INFO | `kyc.assess` |
| `case closed` | INFO | `RunWorkflow`, with the outcome. |
| `document deadline passed` | WARN | `kyc.await_documents` |
| `case escalated for review` | WARN | `kyc.assess` |
| `agent run failed` | ERROR | `kyc.assess`, with the exception. |
| `sanctions near match` | WARN | The tool's `RunActivity`, with the score. |
| `injected <fault> fault` | ERROR | The failing `RunActivity`, with the attempt. |

The example's README lists every line.

**A success case.** An auto-approved case reads as an INFO story in one trace:
`case created` on `POST /cases`, `documents complete` on
`kyc.await_documents`, `assessment decided approve` on `kyc.assess` and
`case closed` on `RunWorkflow`. Open the trace ID on any of them to land on
that span.

**A failure case.** In a `sanctions_down` case, each failed `screen_sanctions`
attempt has one ERROR `injected sanctions_down fault` line, on that attempt's
`RunActivity` span. Open the trace ID on the line to land on the failed
attempt, with the successful attempt beside it under the same `StartActivity`.

To go from a trace back to its logs, filter by trace ID. In Scout's
ClickHouse datasource:

```sql showLineNumbers title="Logs of one case trace"
SELECT Timestamp, SeverityText, ServiceName, Body, SpanId
FROM {{.Tenant}}.otel_logs
WHERE $timeFilter
  AND ServiceName IN ('ai-kyc-onboarding-api', 'ai-kyc-onboarding-worker')
  AND TraceId = '$traceId'
ORDER BY Timestamp
LIMIT 1000
```

A trace ID covers one trace. Documents and reviews have their own request
traces, so to get every line of a case, filter on
`LogAttributes['base14.kyc.case_id']` instead. Workflow and activity lines
also carry Temporal's `temporal_workflow` or `temporal_activity` attribute
with the workflow ID, run ID and attempt.

## Application Metrics

Workflow code records through `ReplaySafeMeterProvider`, so replay records
nothing. Durations are in workflow time. The example's histograms share
buckets from 1 second to 7 days, so a case that waits days lands in a real
bucket.

| Instrument | Type | Recorded | Attributes |
| --- | --- | --- | --- |
| `base14.kyc.cases` | counter, `{case}` | Workflow, at close | `base14.kyc.outcome`, `base14.kyc.escalation_reason` when escalated |
| `base14.kyc.case.duration` | histogram, seconds | Workflow, at close | `base14.kyc.outcome` |
| `base14.kyc.resubmissions` | counter, `{document}` | Workflow, per document to resend | `base14.kyc.document_type` |
| `base14.kyc.review.wait` | histogram, seconds | Workflow, when a review arrives or the deadline passes | `base14.kyc.review_decision`: `approve`, `reject` or `expired` |
| `base14.kyc.sanctions.checks` | counter, `{check}` | `screen_sanctions` activity | `base14.kyc.sanctions.result`: `clear`, `near_match`, `match` or `error` |

```python showLineNumbers title="src/kyc_onboarding/case_metrics.py (excerpt)"
def record_case_closed(outcome: str, escalation_reason: str | None, duration: timedelta) -> None:
    attributes = {OUTCOME_ATTRIBUTE: outcome}
    if escalation_reason is not None:
        attributes[ESCALATION_REASON_ATTRIBUTE] = escalation_reason
    _meter().create_counter(
        CASES, unit="{case}", description="KYC cases closed, by outcome and escalation reason"
    ).add(1, attributes)
```

The duration comes from `workflow.now() - workflow.info().start_time`, not
the wall clock, so it is the same on every replay.

Queries for each, in Scout's ClickHouse datasource. Scout panels take
`{{.Tenant}}.` as the database prefix. The counters use the
`$increaseColumns` macro, since their values are cumulative.

```sql showLineNumbers title="Cases closed, by outcome and escalation reason"
$increaseColumns(concat(Attributes['base14.kyc.outcome'], ' ', Attributes['base14.kyc.escalation_reason']) AS outcome, Value)
FROM {{.Tenant}}.otel_metrics_sum
WHERE $timeFilter
  AND ServiceName = 'ai-kyc-onboarding-worker'
  AND MetricName = 'base14.kyc.cases'
```

`$increaseColumns` keeps the largest series per key, so the key names both
attributes of the counter. With more than one worker process, add
`ResourceAttributes['service.instance.id']` to the key.

```sql showLineNumbers title="Documents asked for again, by type"
$increaseColumns(Attributes['base14.kyc.document_type'] AS document_type, Value)
FROM {{.Tenant}}.otel_metrics_sum
WHERE $timeFilter
  AND ServiceName = 'ai-kyc-onboarding-worker'
  AND MetricName = 'base14.kyc.resubmissions'
```

```sql showLineNumbers title="Sanctions checks, by result"
$increaseColumns(Attributes['base14.kyc.sanctions.result'] AS result, Value)
FROM {{.Tenant}}.otel_metrics_sum
WHERE $timeFilter
  AND ServiceName = 'ai-kyc-onboarding-worker'
  AND MetricName = 'base14.kyc.sanctions.checks'
```

A rising `error` series means the sanctions lookup is failing and retrying.

The histograms are in `otel_metrics_histogram` under the same names. The
same durations are on the spans, which gives a shorter query. Each span
counts in the time bucket where it started, and only once the case or the
wait has ended. Case duration p95 by outcome, from `RunWorkflow`:

```sql showLineNumbers title="Case duration p95 by outcome, from spans"
$columns(SpanAttributes['base14.kyc.outcome'] AS outcome, quantile(0.95)(Duration / 1e9) AS p95_seconds)
FROM {{.Tenant}}.otel_traces
WHERE $timeFilter
  AND ServiceName = 'ai-kyc-onboarding-worker'
  AND SpanName = 'RunWorkflow:KycOnboardingWorkflow'
GROUP BY t, outcome
ORDER BY t
```

Review wait p95, from `kyc.await_review`:

```sql showLineNumbers title="Review wait p95, from spans"
SELECT $timeSeries AS t, quantile(0.95)(Duration / 1e9) AS p95_seconds
FROM {{.Tenant}}.otel_traces
WHERE $timeFilter
  AND ServiceName = 'ai-kyc-onboarding-worker'
  AND SpanName = 'kyc.await_review'
GROUP BY t
ORDER BY t
```

Pydantic AI adds `gen_ai.client.token.usage`, and the FastAPI instrumentation
adds the `http.server.*` metrics.

### Temporal SDK metrics

The client's runtime exports the SDK's own metrics to the same collector.
Among them are `temporal_workflow_completed`,
`temporal_workflow_endtoend_latency`, `temporal_activity_execution_failed`,
`temporal_activity_execution_latency`,
`temporal_activity_schedule_to_start_latency`,
`temporal_workflow_task_replay_latency`, `temporal_sticky_cache_hit` and
`temporal_worker_task_slots_used`. For Temporal server metrics, see the
[Temporal component guide](../../component/temporal.md).

## Content Capture and Temporal History

Content capture is on in the example. See
[Content Capture](./pydantic-ai.md#content-capture).

Temporal history is a second copy of the same data, separate from telemetry.
The document text travels in the signal payloads and the activity inputs,
and every model request and tool call is recorded in the case's history.
Temporal stores it whatever the capture setting is. Encrypting history
payloads is out of scope for the example.

## Running Your Application

Clone the examples repository and run the commands from the example's
directory:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-kyc-onboarding
cp .env.example .env
ollama pull gemma4:e2b
ollama pull qwen3.5:9B
make docker-up
```

This starts Postgres, the Temporal server, Temporal UI at
`http://localhost:8080`, the collector, the API on port 8000 and the worker.
Start a case and send its documents:

```bash showLineNumbers title="Terminal"
CASE_ID=$(curl -s -X POST http://localhost:8000/cases \
  -H 'Content-Type: application/json' \
  -d '{"name": "Maria Elena Gonzalez", "country": "IE", "account_type": "personal"}' | jq -r .case_id)

for file in fixtures/clean_personal/*.txt; do
  jq -nc --arg document_type "$(basename "$file" .txt)" --rawfile raw_text "$file" \
    '{document_type: $document_type, raw_text: $raw_text}' \
  | curl -s -X POST "http://localhost:8000/cases/$CASE_ID/documents" \
      -H 'Content-Type: application/json' -d @-
done

curl -s "http://localhost:8000/cases/$CASE_ID" | jq
```

To run all eleven scenarios, six business outcomes and five injected
failures, start the stack with faults enabled and run the harness. Then check
the telemetry the run produced:

```bash showLineNumbers title="Terminal"
KYC_FAULTS_ENABLED=true docker compose up -d --build
scripts/test-api.sh
scripts/verify-scout.sh
```

`scripts/verify-scout.sh` reads the
collector's `debug` output and self-metrics and checks, per case: one trace
rooted at `POST /cases` > `StartWorkflow` > `RunWorkflow`, no duplicated
span, the wait spans, the arrival span links, the log lines on the right
spans, the `base14.*` and `gen_ai.*` attributes and each failure's shape. It
also checks every application metric and that the Scout exporter sent spans,
logs and metric points with no failures. Do not restart the collector between
the two scripts.

`make check` runs the unit tests in Temporal's time-skipping environment with
scripted agents. They include a replay of a recorded history and a test that
hands a case between two cache-less workers and asserts one trace.

## Troubleshooting

### The worker fails with `the global trace provider must be a ReplaySafeTracerProvider`

`OpenTelemetryPlugin` needs the global tracer provider to come from
`create_tracer_provider`. Build it that way and call
`trace.set_tracer_provider` before you create the worker.

### No `RunWorkflow` span

`OpenTelemetryPlugin` was created without `add_temporal_spans=True`, or the
case is still open. `RunWorkflow` is exported when the case closes.

### Metrics or log lines are counted twice after a restart

The meter or logger provider is not wrapped. Use `ReplaySafeMeterProvider` and
`ReplaySafeLoggerProvider`, and log from workflow code through
`workflow.logger`.

### No Temporal SDK metrics

The runtime does not read `OTEL_EXPORTER_OTLP_ENDPOINT`. Pass the full
`/v1/metrics` URL to `OpenTelemetryConfig`, with `http=True` for OTLP HTTP.

### A case stays in `assessing`

The API and the worker run with different prompt versions. The worker logs
`case needs prompt versions ..., this worker loaded ...`. Start both with the
same `EXTRACTION_PROMPT_VERSION` and `ASSESSMENT_PROMPT_VERSION`.

## Security Considerations

- **Capture is on in the example.** Turn it off with
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` before real
  applicant data reaches it.
- **Temporal history holds the documents.** Treat Temporal's database and UI
  as holding PII, whatever the telemetry settings.
- **Collector credentials.** Keep `SCOUT_CLIENT_SECRET` in the environment or a
  secret store.

## Performance Considerations

- Every model request and tool call adds a `StartActivity` span and one
  `RunActivity` span per attempt, on top of the Pydantic AI spans.
- Each workflow adds a `StartWorkflow` and a `RunWorkflow` span, and each
  signal, update or query adds a client span and a handler span.
- The replay-safe providers check replay state on each call and drop records
  made during replay.
- Spans export from a `BatchSpanProcessor`, off the workflow task.
- Content capture size is covered on the
  [Pydantic AI](./pydantic-ai.md#performance-considerations) page.

## FAQ

### How do I keep one trace across a Temporal worker restart?

Build the tracer provider with `create_tracer_provider` and use
`OpenTelemetryPlugin`. Span and trace IDs then come from the workflow's
deterministic random, so the replacement worker rebuilds the same IDs, and
the `RunWorkflow` span it exports at the close has the original start time.

### Why use `OpenTelemetryPlugin` instead of Temporal's `TracingInterceptor`?

`TracingInterceptor` starts and ends workflow spans at the same instant, so a
wait of days shows as zero length, and it skips workflow spans when no client
span is present. `OpenTelemetryPlugin` gives spans in workflow code real
durations.

### Why is the root span missing for an open Temporal workflow?

A span is exported when it ends, and `RunWorkflow` ends when the workflow
closes. Until then its finished children are visible without it.

### Do Pydantic AI spans need extra wiring inside a Temporal workflow?

No. With `Agent.instrument_all` and the replay-safe tracer provider, the
`invoke_agent`, `chat` and `execute_tool` spans in workflow code are emitted
once and nest above the activity spans.

### How do I link a Temporal signal to the workflow's trace?

Keep the handler's span context and start a span in the workflow with a link
to it. Temporal puts the `HandleSignal` span in the sender's trace, not the
workflow's.

### How do I record metrics from Temporal workflow code?

Wrap the meter provider in `ReplaySafeMeterProvider` and use workflow time for
durations. Replay then records nothing.

### How do I see which activity attempt failed?

Add a worker interceptor that sets the attempt number on the `RunActivity`
span. The example's `ActivityAttemptInterceptor` sets
`base14.temporal.activity.attempt`.

### Does turning off content capture keep KYC data out of Temporal?

No. Content capture affects telemetry only. Temporal stores signal payloads
and activity inputs in workflow history either way.

## What's Next?

### Related Guides

- [Pydantic AI](./pydantic-ai.md) - agent, model and tool spans, content
  capture and token metrics.
- [Temporal](../../component/temporal.md) - Temporal server metrics.
- [Agent Approval Gates](../../../guides/ai-observability/agent-approval-gates.md)
  \- tracing an agent that waits for a person.
- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines and tool calls.
- [FastAPI](./fast-api.md) - the API in front of the workflows.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - alert on
  sanctions check errors or budget escalations.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - chart
  cases, waits and agent failures.

## Complete Example

```text showLineNumbers
ai-kyc-onboarding/
|-- compose.yaml                 Postgres, Temporal, Temporal UI, collector, api, worker
|-- otel-collector-config.yaml   debug and Scout exporters
|-- prompts/                     versioned extraction and assessment prompts
|-- scripts/
|   |-- test-api.sh              the eleven scenarios
|   `-- verify-scout.sh          checks the run's telemetry in the collector output
`-- src/kyc_onboarding/
    |-- main.py                  FastAPI endpoints
    |-- worker.py                Temporal worker
    |-- workflows.py             KycOnboardingWorkflow and its spans, logs and metrics
    |-- telemetry.py             providers, plugins, instrumentation
    |-- interceptors.py          activity attempt attribute
    |-- case_metrics.py          application metrics
    `-- agents/                  the two agents, their tools and prompts
```

Source:
[`python/ai-kyc-onboarding`](https://github.com/base-14/examples/tree/main/python/ai-kyc-onboarding).

## References

- [Pydantic AI durable execution with Temporal](https://pydantic.dev/docs/ai/capabilities/durable_execution/temporal/).
- [Temporal Python SDK observability](https://docs.temporal.io/develop/python/platform/observability).
- [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/),
  in Development status as of September 2026.
