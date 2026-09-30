---
title:
  OpenAI Agents SDK OpenTelemetry - Agent, Model and Tool Spans
sidebar_label: OpenAI Agents SDK
sidebar_position: 7.9
description:
  Trace the OpenAI Agents SDK with OpenTelemetry on any OpenAI-compatible
  model. Workflow, agent, chat and tool spans, gen_ai metrics, trace export
  off OpenAI, content capture and the known gaps.
keywords:
  [
    openai agents sdk opentelemetry,
    openai agents sdk tracing,
    openai agents sdk observability,
    openai agents python tracing,
    OpenAIAgentsInstrumentor,
    disable_openai_trace_export,
    opentelemetry-instrumentation-genai-openai-agents,
    opentelemetry-instrumentation-genai-openai,
    openai agents ollama,
    openai agents as_tool tracing,
    openai agents StopAtTools,
    openai agents run hooks,
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT SPAN_ONLY,
    llm observability python,
    ai agent monitoring python,
    multi-agent tracing python,
  ]
---

# OpenAI Agents SDK

The OpenAI Agents SDK has a tracing system of its own, which sends traces to
OpenAI by default. The OpenTelemetry contrib instrumentation turns that
tracing into `invoke_workflow`, `invoke_agent` and `execute_tool` spans with
`gen_ai.*` metrics, and can remove the export to OpenAI. The OpenAI client
instrumentation adds a `chat` span for each model call.

:::tip TL;DR

Set a global tracer and meter provider, then call
`OpenAIAgentsInstrumentor().instrument(disable_openai_trace_export=True)` and
`OpenAIInstrumentor().instrument()` before the first run. Set
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY` to record
content. Setting it to `true` records no content. Pass
`RunConfig(group_id=...)` to set `gen_ai.conversation.id`.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For other Python agent frameworks, see
> [Strands Agents](./strands-agents.md), [Google ADK](./google-adk.md) and
> [Microsoft Agent Framework](./microsoft-agent-framework.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running the OpenAI Agents SDK who want traces and metrics
  in an OpenTelemetry backend instead of, or as well as, OpenAI's trace
  viewer.
- Teams running the SDK on an OpenAI-compatible server, such as Ollama's
  `/v1` endpoint, who need to keep traces off OpenAI.
- Teams nesting one agent inside another with `as_tool`, who want one trace
  per request across both.

## Overview

- Install the two instrumentations and turn off the export to OpenAI.
- Read the span tree of a run, including an agent called as a tool.
- Set the conversation ID with `group_id` or a span processor, and put
  request IDs on spans with
  a span processor.
- Turn content capture on with a capture mode.
- Recognize a budget stop and a failed tool in a trace.
- Add `error.type`, cost and the real provider in a span exporter.

### Signals

| Signal | What the instrumentations emit | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invoke_workflow`, `invoke_agent` and `execute_tool` spans from the SDK instrumentation, `chat` spans from the OpenAI client instrumentation. | Request IDs, prompt versions and the model server through a span processor. The exception type in place of `_OTHER`, cost and `gen_ai.provider.name` in a span exporter. FastAPI, httpx and psycopg spans, and one hand-written span. |
| Metrics | `gen_ai.client.*`, `gen_ai.invoke_agent.duration`, `gen_ai.invoke_workflow.duration` and `gen_ai.execute_tool.duration`. | Application counters and a duration histogram under `base14.filing.*`. `http.server.*` and `http.client.duration`. |
| Logs | None. | The OpenTelemetry `LoggingHandler` on the root logger, so every line carries the trace and span ID. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model the SDK can reach, with tool calling. The Quick Start and the
  example use Ollama's OpenAI-compatible endpoint with `qwen3.5:9B`, which
  needs no API key.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `openai-agents` | 0.22.3 |
| `openai` | 3.20.0 |
| `opentelemetry-instrumentation-genai-openai-agents` | 1.2b0 |
| `opentelemetry-instrumentation-genai-openai` | 1.2b0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-httpx`, `-psycopg`, `-logging` | 0.66b0 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `gemma4:e2b` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst) with `FILING_FRAMEWORK=openai-agents` |

Last verified 2026-09-29 with the OpenAI Agents SDK 0.22.3. The GenAI
conventions are in Development status and both instrumentations are betas,
so attribute names can change between releases. Pin all three packages to
exact versions and re-check the spans after each upgrade.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add openai-agents==0.22.3 \
  opentelemetry-instrumentation-genai-openai-agents==1.2b0 \
  opentelemetry-instrumentation-genai-openai==1.2b0 \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install openai-agents==0.22.3 \
  opentelemetry-instrumentation-genai-openai-agents==1.2b0 \
  opentelemetry-instrumentation-genai-openai==1.2b0 \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
</Tabs>
```

Both instrumentations need `opentelemetry-api` 1.43 or later. The agents
instrumentation emits no model-call spans. The OpenAI client instrumentation
adds them. For logs, add `opentelemetry-instrumentation-logging==0.66b0`.

## Quick Start

This file is a minimal starting point, not part of the example. It sets up
tracing and metrics, instruments the SDK and the OpenAI client, and runs one
agent with one tool on Ollama's `/v1` endpoint. Save it as `quickstart.py`:

```python showLineNumbers title="quickstart.py"
import asyncio

from agents import Agent, OpenAIChatCompletionsModel, RunConfig, Runner, function_tool
from openai import AsyncOpenAI
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor
from opentelemetry.instrumentation.genai.openai_agents import OpenAIAgentsInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

tracer_provider = TracerProvider()
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)
meter_provider = MeterProvider(metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())])
metrics.set_meter_provider(meter_provider)

OpenAIAgentsInstrumentor().instrument(disable_openai_trace_export=True)
OpenAIInstrumentor().instrument()


@function_tool
def order_status(order_id: str) -> str:
    """Return the shipping status of an order."""
    return "shipped" if order_id == "A-100" else "not found"


ollama = AsyncOpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
agent = Agent(
    name="order-agent",
    model=OpenAIChatCompletionsModel(model="qwen3.5:9B", openai_client=ollama),
    tools=[order_status],
    instructions="Look up the order with the order_status tool, then answer in one sentence.",
)


async def main() -> None:
    result = await Runner.run(agent, "Where is order A-100?", run_config=RunConfig(group_id="order-A-100"))
    print(result.final_output)


asyncio.run(main())
tracer_provider.shutdown()
meter_provider.shutdown()
```

Pull the model, point the file at your collector and run it:

```bash showLineNumbers title="Terminal"
ollama pull qwen3.5:9B
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=order-agent
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY
python quickstart.py
```

It prints the answer, for example
`Order A-100 has been shipped and is currently on its way to you.` Your
backend then shows one trace for the run under the service `order-agent`:

```text showLineNumbers title="The Quick Start trace"
invoke_workflow Agent workflow
`-- invoke_agent order-agent
    |-- chat qwen3.5:9B              asks for the tool call
    |-- execute_tool order_status
    `-- chat qwen3.5:9B              writes the answer
```

`gen_ai.conversation.id=order-A-100` is on `invoke_workflow`, `invoke_agent`
and both `chat` spans. The `gen_ai.*` metrics arrive with the same service
name. If no trace shows up, check the endpoint and see
[Troubleshooting](#troubleshooting).

The workflow name comes from `RunConfig(workflow_name=...)`, default
`Agent workflow`.

## Configuration

The instrumentations read the global tracer and meter providers. Set both
before instrumenting. The example sets them, with a logger provider, in
`telemetry.py`, then instruments in the OpenAI Agents adapter:

```python showLineNumbers title="frameworks/openai_agents.py (condensed)"
def from_settings(settings: Settings) -> OpenAIAgentsFramework:
    apply_capture_mode()
    OpenAIAgentsInstrumentor().instrument(disable_openai_trace_export=True)
    OpenAIInstrumentor().instrument()
    return OpenAIAgentsFramework(ollama_models(settings.ollama_base_url), settings.ollama_think)
```

### Keep Traces Off OpenAI

The SDK exports its traces to OpenAI whenever an OpenAI API key is
available, usually from `OPENAI_API_KEY`.
`OpenAIAgentsInstrumentor().instrument()` adds its processor next to that
exporter, so both run. With `disable_openai_trace_export=True`, it replaces
the SDK's processors with its own, so traces go only to OpenTelemetry. Pass
it whenever the traces must stay in your own backend.

The example's container has no `OPENAI_API_KEY`, and after instrumenting its
only SDK trace processor is the OpenTelemetry one.

### Environment Variables

| Variable | Value in the example | Read by |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | `ai-filing-analyst` | The OpenTelemetry SDK resource. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | The OTLP exporters. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | The OTLP exporters. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true`, mapped to `SPAN_ONLY` by the example | Both instrumentations. Takes a capture mode. See [Content Capture](#content-capture). |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `4096` | The OpenTelemetry SDK. Caps each captured value. |
| `OTEL_PYTHON_LOG_CORRELATION` | `true` | The example. Adds trace and span IDs to console log lines. |

## What the Instrumentations Emit

This is the ranking question from the example, one trace per HTTP request.
The psycopg `SELECT` and `INSERT` spans and the ASGI `http receive` and
`http send` spans are left out.

```text showLineNumbers title="One ranking question"
POST /questions
|-- invoke_workflow Agent workflow
|   `-- invoke_agent analyst
|       |-- chat qwen3.5:9B
|       |-- execute_tool rank_among_filers
|       |   `-- invoke_agent ranking
|       |       |-- chat gemma4:e2b
|       |       |-- execute_tool frame_values
|       |       |   `-- GET                    SEC frames API
|       |       `-- chat gemma4:e2b
|       |-- chat qwen3.5:9B
|       `-- execute_tool FilingAnswer          the typed answer
`-- filing.verify_answer                       hand-written
```

The agents instrumentation emits one `invoke_workflow <workflow name>` per
`Runner.run`, one `invoke_agent <agent>` per agent run and one
`execute_tool <tool>` per function tool call. The OpenAI client
instrumentation emits one `chat <model>` per model call. An agent attached
with `as_tool` runs inside its `execute_tool` span without a workflow of its
own, so both agents share one trace.

The model decides the tool calls, so the shape varies between runs of the
same question. When the analyst ends a run in text without calling
`FilingAnswer`, the example runs it once more with a reminder, which adds a
second `invoke_workflow` under the server span.

The attributes worth knowing:

- `gen_ai.workflow.name` on `invoke_workflow`, and `gen_ai.agent.name` on
  `invoke_agent`.
- `gen_ai.conversation.id`, from `group_id`, on `invoke_workflow`,
  `invoke_agent` and `chat`.
- `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.id`,
  `gen_ai.response.finish_reasons`, `gen_ai.request.temperature`,
  `server.address` and `server.port` on `chat`.
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` and
  `gen_ai.usage.cache_read.input_tokens` on `chat`.
- `gen_ai.tool.name` and `gen_ai.tool.type` on `execute_tool`, plus
  `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` when content is
  captured.
- `gen_ai.input.messages`, `gen_ai.output.messages` and
  `gen_ai.tool.definitions` on `chat` when content is captured.

`gen_ai.provider.name` is `openai` on `chat`, whichever server the client
reached. `invoke_agent` carries no model or provider.

### OpenAI Agents SDK Metrics

The two instrumentations record these through the global meter provider:

| Metric | What it measures | Attributes |
| --- | --- | --- |
| `gen_ai.client.operation.duration` | Model call duration. | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `server.address`, `server.port`. |
| `gen_ai.client.token.usage` | Tokens per model call. | The above, plus `gen_ai.token.type`. |
| `gen_ai.invoke_workflow.duration` | Workflow duration. | `gen_ai.workflow.name`. |
| `gen_ai.invoke_agent.duration` | Agent run duration. | `gen_ai.agent.name`, and `error.type` on a failed run. |
| `gen_ai.execute_tool.duration` | Tool call duration. | `gen_ai.tool.name`, `gen_ai.tool.type`, and `error.type` on a failed call. |

`gen_ai.provider.name` on the client metrics is `openai` on any
OpenAI-compatible server. Filter them by `server.address` to tell servers
apart.

## Request Attributes

`group_id` sets the conversation ID. For other request attributes, the
instrumentations take none, so the example uses a span processor. It sets the
request's attributes in a context variable around the run, and the processor
copies them onto each GenAI span as it starts, picking the agent's prompt
version and model digest from the span's agent name or model:

```python showLineNumbers title="telemetry.py (condensed)"
class AgentRunAttributesProcessor(SpanProcessor):
    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        run = _agent_run.get()
        if run is None or not span.name.startswith(GEN_AI_SPAN_PREFIXES):
            return
        attributes = span.attributes or {}
        added = {**run.question, **_agent_or_model(run, span.name, attributes)}
        span.set_attributes({key: value for key, value in added.items() if key not in attributes})
```

`run.question` holds the request ID, `gen_ai.conversation.id` and the ticker.
The example does not pass `group_id`. Its processor sets
`gen_ai.conversation.id` on every GenAI span, including `execute_tool`.

## Agents as Tools

`agent.as_tool(tool_name, tool_description)` wraps an agent as a tool of
another agent. `custom_output_extractor` decides what the outer agent reads:

```python showLineNumbers title="frameworks/openai_agents.py (condensed)"
ranking = Agent(
    name="ranking",
    instructions=config.ranking_prompt.system,
    model=models(config.ranking_model),
    model_settings=settings,
    tools=openai_tools(tools.ranking, budget),
)
analyst = Agent(
    name="analyst",
    instructions=analyst_instructions(config, FINISH_RULE),
    model=models(config.analyst_model),
    model_settings=settings,
    tools=[
        *openai_tools(tools.analyst, budget),
        *openai_tools([answer_tool(sink)], budget),
        ranking.as_tool(
            tool_name="rank_among_filers",
            tool_description=RANKING_TOOL_DESCRIPTION,
            custom_output_extractor=ranking_report,
        ),
    ],
    tool_use_behavior=StopAtTools(stop_at_tool_names=["FilingAnswer"]),
)
```

A tool that fails inside the inner agent shows on its `execute_tool` span with
error status. The outer `execute_tool rank_among_filers` span ends without
error. The example's `ranking_report` appends the frame's facts to the inner
agent's reply, and replaces the reply with a fixed line when the frames
fetch failed.

## Structured Output on Ollama

`output_type=FilingAnswer` asks the server for JSON in that schema through
`response_format`. Ollama applies that format to every call of the run, so
the model can no longer call a tool. The example gives the analyst a
`FilingAnswer` function tool instead, whose parameters are the answer's
fields, and ends the run when it is called with
`StopAtTools(stop_at_tool_names=["FilingAnswer"])`. The typed answer shows as
`execute_tool FilingAnswer`.

The SDK builds strict JSON schemas for function tools by default, which mark
every parameter required. `qwen3.5:9B` then fills an optional year with the
text `None`, which fails validation. The example registers its tools with
`strict_mode=False`:

```python showLineNumbers title="frameworks/openai_agents.py (condensed)"
def openai_tools(tools: list[Callable[..., Any]], budget: CallBudget) -> list[Tool]:
    return [function_tool(within_budget(bound, budget), name_override=bound.__name__, strict_mode=False) for bound in tools]
```

## Budgets

Run hooks see the model and tool calls of every agent in a run, including one
called as a tool. The example counts both across the two agents with a plain
`CallBudget` counter:

```python showLineNumbers title="frameworks/openai_agents.py (condensed)"
class Hooks(RunHooks[Any]):
    async def on_llm_start(self, context, agent, system_prompt, input_items) -> None:
        try:
            self._budget.count_model()  # raises past the budget
        except Exception as error:
            trace.get_current_span().record_exception(error)
            raise

    async def on_tool_start(self, context, agent, tool) -> None:
        self._budget.count_tool()


def within_budget(bound: Callable[..., Any], budget: CallBudget) -> Callable[..., Any]:
    @functools.wraps(bound)
    def call(*args: Any, **kwargs: Any) -> Any:
        if budget.exceeded is not None:
            return {"error": "budget", "message": str(budget.exceeded)}
        return bound(*args, **kwargs)

    return call
```

A model call over the budget raises from `on_llm_start`, which ends
`invoke_agent` with error status. A run hook cannot cancel a tool, and a hook
that raises at tool start puts the stop on the tool span. The example wraps
each tool instead, so a tool past the budget returns the stop as its result
without running.

The instrumentation sets `error.type=_OTHER` on a failed `invoke_agent` and
records no exception. The hook records the exception on the current span,
which is `invoke_agent`, so an exporter can report the real type. See
[Adding Cost and Error Type](#adding-cost-and-error-type-with-a-span-exporter).

The SDK has no wall-clock limit. The example wraps the run in
`asyncio.wait_for`, which cancels it at the deadline. A cancelled run ends
`invoke_agent` without error status.

## Logs and Trace Correlation

The instrumentations emit no logs. The example adds the OpenTelemetry
`LoggingHandler` to the root logger, as in
[Strands Agents](./strands-agents.md#logs-and-trace-correlation), so every
application log record goes to the collector with the trace ID and span ID
of the span it was written under.

## Content Capture

Both instrumentations read `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
as a capture mode, not a boolean. `SPAN_ONLY` records messages, tool
definitions, tool arguments and tool results on the spans. `true`, unset or
any value that is not a mode records none. The instrumentations also take
`EVENT_ONLY` and `SPAN_AND_EVENT`.

The example keeps a `true` or `false` setting, shared with its other
frameworks, and maps it to a mode before instrumenting:

```python showLineNumbers title="frameworks/openai_agents.py (condensed)"
def apply_capture_mode() -> None:
    capture = os.environ.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true").strip().lower() != "false"
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "SPAN_ONLY" if capture else "NO_CONTENT"
```

## Adding Cost and Error Type with a Span Exporter

The example wraps the OTLP span exporter to add, on the way out:

- `error.type` from the first recorded exception, in place of the
  instrumentation's `_OTHER`. A failed span with no exception and no type
  gets the HTTP status code, then `_OTHER`.
- `base14.gen_ai.cost` on each `chat` span, from the token counts and a price
  table. A model with no price, such as a local Ollama model, gets 0 and
  `base14.gen_ai.cost.simulated=true`.
- `gen_ai.provider.name=ollama` on each `chat` span, in place of `openai`.

See `CostAndErrorAttributingSpanExporter` in the example's
[`telemetry.py`](https://github.com/base-14/examples/blob/main/python/ai-filing-analyst/src/filing_analyst/telemetry.py).

## Known Gaps

As of the OpenAI Agents SDK 0.22.3 and both instrumentations at 1.2b0,
verified 2026-09-29:

- **Traces go to OpenAI unless you turn that off.** Without
  `disable_openai_trace_export=True`, the SDK's exporter stays active next to
  OpenTelemetry whenever an OpenAI API key is available.
- **`error.type` is `_OTHER` on failed agent and tool spans**, with no
  recorded exception. Record the exception in a hook and derive the type in
  an exporter.
- **The provider is `openai` on any OpenAI-compatible server**, on spans and
  metrics. Tell servers apart by `server.address`, or set the provider in an
  exporter.
- **`true` does not turn content capture on.** Use a mode such as
  `SPAN_ONLY`.
- **No model-call spans from the agents instrumentation.** Add the OpenAI
  client instrumentation.
- **`execute_tool` has no conversation ID.** `group_id` reaches the
  workflow, agent and `chat` spans only.
- **`invoke_workflow` keeps an unset status when the run fails.** The failure
  shows on `invoke_agent`, and on `chat` when the model call itself failed.
- **`output_type` cannot be used with tools on Ollama.** Ollama applies the
  schema to every call. Use a function tool with `StopAtTools`.
- **Strict tool schemas make every parameter required.** Small models fill
  optional parameters with placeholder text. Register tools with
  `strict_mode=False`.
- **No logs.** Add the `LoggingHandler` yourself.

## What to Look For in Scout

### Follow one request across both agents

Search spans by `gen_ai.conversation.id` or your own request ID attribute.
The trace shows `invoke_agent ranking` under
`execute_tool rank_among_filers`, with its own `chat` spans.

### Find failed runs and why

Filter spans on `status = Error` and group by `error.type`. A model server
that cannot be reached shows on `chat` as `openai.APIConnectionError`. With
the example's exporter, `filing_analyst.budget.BudgetExceeded` on
`invoke_agent` marks a budget stop. Without it, `invoke_agent` reads
`_OTHER`. A timeout leaves `invoke_agent` without error status. The
example's server span ends with error status, a 504 and `base14.filing.outcome=timeout`.

### Find a tool that failed inside a run that completed

Filter `execute_tool` spans on error status. A failed frames fetch in the
ranking agent shows here while `invoke_agent analyst` completes. The
analyst's answer then says the ranking is unavailable.

### Read tokens by model

Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on `chat`
spans, grouped by `gen_ai.request.model`, or read the
`gen_ai.client.token.usage` metric by `gen_ai.request.model` and
`gen_ai.token.type`.

## Production Patterns

- **Turn the export to OpenAI off** with `disable_openai_trace_export=True`
  when traces must stay in your own backend.
- **Leave content capture off for real data.** Unset
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` or set it to
  `NO_CONTENT`.
- **Cap attribute length.** Tool results can be long. The example sets
  `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=4096`.
- **Bound every run twice.** A call budget in run hooks stops a loop, and
  `asyncio.wait_for` stops a slow or stalled model or tool.
- **Put the prompt version and model digest on spans.** An Ollama tag can
  point at new weights. The example reads each model's digest from Ollama at
  startup.
- **Send through a collector.** The example exports OTLP HTTP to a collector,
  which authenticates to Scout and keeps a `debug` exporter for local checks.
- **Keep fault injection off.** The example's fault fields are refused unless
  `FILING_FAULTS_ENABLED=true`. Set it only for the scenario harness.

## Running Your Application

Run `quickstart.py` as in [Quick Start](#quick-start). For the full example on
the OpenAI Agents SDK:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-filing-analyst
cp .env.example .env
ollama pull qwen3.5:9B
ollama pull gemma4:e2b
make docker-up FRAMEWORK=openai-agents
```

Set `SEC_USER_AGENT` in `.env` to your organisation's name and a contact
email first. Then ask a question:

```bash showLineNumbers title="Terminal"
curl -s -X POST http://localhost:8000/questions \
  -H 'Content-Type: application/json' \
  -d '{"ticker": "KVYO", "question": "What was Klaviyo'"'"'s revenue for its latest fiscal year?"}' | jq
```

`scripts/test-api.sh` runs seventeen scenarios, eight with injected faults,
and `scripts/verify-scout.sh` checks the telemetry each one produced. The
fault scenarios need the stack started with
`FILING_FAULTS_ENABLED=true make docker-up FRAMEWORK=openai-agents`.

## Troubleshooting

### No agent spans

The instrumentor ran before the global tracer provider was set, or not at
all. Set the providers first, then call `instrument()`.

### Agent spans but no chat spans

`OpenAIInstrumentor().instrument()` was not called. The agents
instrumentation emits no model-call spans.

### Traces also show in the OpenAI dashboard

`OPENAI_API_KEY` is set and the instrumentor ran without
`disable_openai_trace_export=True`.

### No messages on spans

`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` is `true` or unset. Set
it to `SPAN_ONLY` before instrumenting.

### Failed agent spans have `error.type` `_OTHER`

The instrumentation sets `_OTHER` on failed `invoke_agent` and
`execute_tool` spans. Record the exception on the span and
derive the type in an exporter, as in
[Budgets](#budgets).

## FAQ

### Does the OpenAI Agents SDK support OpenTelemetry?

Yes, through the OpenTelemetry contrib instrumentation
`opentelemetry-instrumentation-genai-openai-agents`, which turns the SDK's
own tracing into GenAI spans and metrics.

### How do I stop the OpenAI Agents SDK from sending traces to OpenAI?

Call `OpenAIAgentsInstrumentor().instrument(disable_openai_trace_export=True)`.
It replaces the SDK's trace processors with the OpenTelemetry one.

### Which spans does an OpenAI Agents SDK run produce?

One `invoke_workflow` per `Runner.run`, one `invoke_agent <agent>` per agent
run and one `execute_tool <tool>` per tool call, plus one `chat <model>` per
model call from the OpenAI client instrumentation.

### Does the OpenAI Agents SDK work with models other than OpenAI's?

Yes, on any OpenAI-compatible server. The spans are the same, with
`gen_ai.provider.name` set to `openai` and `server.address` naming the
server.

### How do I set the conversation ID in the OpenAI Agents SDK?

Pass `RunConfig(group_id=...)` to `Runner.run`. It becomes
`gen_ai.conversation.id` on the workflow, agent and `chat` spans.

### How do I turn on prompt capture in the OpenAI Agents SDK?

Set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY` before
instrumenting. `true` records nothing.

### Does the OpenAI Agents SDK record cost?

No, the instrumentations record token counts but not cost. Add a cost
attribute in a span exporter, as in
[Adding Cost and Error Type](#adding-cost-and-error-type-with-a-span-exporter).

### How do I trace one OpenAI Agents SDK agent calling another?

Attach the inner agent with `as_tool`. It runs inside the outer agent's
`execute_tool` span, so both share one trace.

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [Google ADK](./google-adk.md) - the same example on ADK.
- [Microsoft Agent Framework](./microsoft-agent-framework.md) - the same
  example on Agent Framework.
- [Strands Agents](./strands-agents.md) - the same example on Strands.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - alert on
  failed runs or budget stops.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - chart
  tokens by model and runs by outcome.

## Complete Example

`ai-filing-analyst` answers questions about a US-listed company's reported
financials from SEC XBRL data. An analyst agent on local Ollama calls tools
and, for a ranking question, a second agent attached as a tool. A verifier
checks every figure against the tool results before the answer is served.
`FILING_FRAMEWORK=openai-agents` runs it on the OpenAI Agents SDK.

```text showLineNumbers
ai-filing-analyst/
|-- prompts/                          analyst and ranking prompts, named by UTC timestamp
|-- scripts/
|   |-- test-api.sh                   seventeen scenarios
|   `-- verify-scout.sh               checks the run's telemetry in the collector output
`-- src/filing_analyst/
    |-- telemetry.py                  providers, logging, run attributes, cost and error attributes
    |-- frameworks/openai_agents.py   the two agents, run hooks, answer tool, capture mode
    |-- agents.py                     what every framework adapter shares
    |-- budget.py                     the call budget counter
    |-- tools.py                      query_facts, compute_ratio, frame_values
    `-- verifier.py                   the grounding check
```

Source:
[`python/ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst).

## References

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/).
-
  [opentelemetry-instrumentation-genai-openai-agents](https://pypi.org/project/opentelemetry-instrumentation-genai-openai-agents/).
- [opentelemetry-instrumentation-genai-openai](https://pypi.org/project/opentelemetry-instrumentation-genai-openai/).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
