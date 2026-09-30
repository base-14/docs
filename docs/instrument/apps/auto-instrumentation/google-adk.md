---
title:
  Google ADK OpenTelemetry - Agent, Model and Tool Spans
sidebar_label: Google ADK
sidebar_position: 7.8
description:
  Trace Google ADK agents with OpenTelemetry on any model. Agent, model and
  tool spans, gen_ai metrics, inference events, trace-correlated logs, content
  capture and the known gaps.
keywords:
  [
    google adk opentelemetry,
    google adk tracing,
    google adk observability,
    agent development kit opentelemetry,
    adk agent monitoring,
    adk litellm ollama,
    adk AgentTool tracing,
    adk output_schema set_model_response,
    adk before_model_callback,
    ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS,
    gen_ai.client.inference.operation.details,
    OTEL_SEMCONV_STABILITY_OPT_IN,
    maybe_set_otel_providers,
    llm observability python,
    ai agent monitoring python,
    multi-agent tracing python,
  ]
---

# Google ADK

Google's Agent Development Kit (ADK) has OpenTelemetry tracing and metrics
built in. It writes to the global tracer, meter and logger providers, so once
you set them, every agent run emits spans for the run, the agent, each model
call and each tool call, plus `gen_ai.*` metrics and one inference event per
model call.

:::tip TL;DR

Set global tracer, meter and logger providers before the first run, or call
`maybe_set_otel_providers()`. Set
`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`. Each run emits
`invocation`, `invoke_agent <agent>`, `call_llm`, `generate_content <model>`
and `execute_tool <tool>` spans. ADK has no per-agent trace attributes, so put
your request IDs on its spans with a span processor.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For other Python agent frameworks, see
> [Strands Agents](./strands-agents.md),
> [Microsoft Agent Framework](./microsoft-agent-framework.md) and
> [OpenAI Agents SDK](./openai-agents-sdk.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running ADK agents who want traces, metrics and logs in
  an OpenTelemetry backend.
- Teams running ADK on models other than Gemini through LiteLLM, such as a
  local Ollama model.
- Teams nesting one agent inside another with `AgentTool`, who want one trace
  per request across both.

## Overview

- Set up tracing, metrics and logs yourself or with
  `maybe_set_otel_providers`.
- Read the span tree of a run, including an agent called through `AgentTool`.
- Put request IDs, prompt versions and the model server on ADK's spans with a
  span processor.
- Read the inference event ADK writes for each model call.
- Control content capture, which ADK splits across two variables.
- Recognize a budget stop and a failed tool in a trace.
- Add `error.type` and cost in a span exporter.

### Signals

| Signal | What ADK emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invocation`, `invoke_agent`, `call_llm`, `generate_content` and `execute_tool` spans. | Request IDs, prompt versions and the model server through a span processor. `error.type`, cost and `gen_ai.provider.name` in a span exporter. FastAPI, httpx and psycopg spans, and one hand-written span. |
| Metrics | `gen_ai.client.*`, `gen_ai.invoke_agent.*` and `gen_ai.execute_tool.duration`. | Application counters and a duration histogram under `base14.filing.*`. `http.server.*` and `http.client.duration`. |
| Logs | A `gen_ai.client.inference.operation.details` event per model call, through the logger provider. | The OpenTelemetry `LoggingHandler` on the root logger, so application log lines carry the trace and span ID. The request ID on every record. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model ADK can reach, with tool calling. The Quick Start and the example
  use Ollama with `qwen3.5:9B` through LiteLLM, which needs no API key.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `google-adk` | 2.10.0 |
| `litellm` | 1.103.0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.42.1 |
| `opentelemetry-exporter-otlp-proto-http` | 1.42.1 |
| `opentelemetry-instrumentation-fastapi`, `-httpx`, `-psycopg`, `-logging` | 0.63b1 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `gemma4:e2b` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst) with `FILING_FRAMEWORK=adk` |

Last verified 2026-09-29 with Google ADK 2.10.0. The GenAI conventions are in
Development status, so attribute names can change between ADK releases. Pin
`google-adk` to an exact version and re-check the spans after each upgrade.

`google-adk` 2.10.0 requires `opentelemetry-api` and `opentelemetry-sdk` at
1.42.1 or earlier. Pin the SDK, the exporters and the instrumentations to
match, as the table does.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add google-adk==2.10.0 litellm==1.103.0 \
  opentelemetry-sdk==1.42.1 \
  opentelemetry-exporter-otlp-proto-http==1.42.1
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install google-adk==2.10.0 litellm==1.103.0 \
  opentelemetry-sdk==1.42.1 \
  opentelemetry-exporter-otlp-proto-http==1.42.1
```

```mdx-code-block
</TabItem>
</Tabs>
```

`litellm` is only needed for models other than Gemini. For Gemini, pass the
model name as a string and leave it out. For logs from your own code, add
`opentelemetry-instrumentation-logging==0.63b1`.

## Quick Start

This file is a minimal starting point, not part of the example. It sets up
tracing, metrics and logs with ADK's `maybe_set_otel_providers` and runs one
agent with one tool on Ollama through LiteLLM. Save it as `quickstart.py`:

```python showLineNumbers title="quickstart.py"
import asyncio

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import InMemoryRunner
from google.adk.telemetry.setup import maybe_set_otel_providers
from google.genai import types
from opentelemetry import _logs, metrics, trace

maybe_set_otel_providers()


def order_status(order_id: str) -> str:
    """Return the shipping status of an order."""
    return "shipped" if order_id == "A-100" else "not found"


agent = LlmAgent(
    name="order_agent",
    model=LiteLlm(model="ollama_chat/qwen3.5:9B", api_base="http://localhost:11434", reasoning_effort="none"),
    tools=[order_status],
    instruction="Look up the order with the order_status tool, then answer in one sentence.",
)


async def main() -> None:
    runner = InMemoryRunner(agent=agent, app_name="orders")
    await runner.session_service.create_session(app_name="orders", user_id="user-1", session_id="order-A-100")
    message = types.Content(role="user", parts=[types.Part(text="Where is order A-100?")])
    async for event in runner.run_async(user_id="user-1", session_id="order-A-100", new_message=message):
        if event.is_final_response() and event.content and event.content.parts:
            print(event.content.parts[0].text)


asyncio.run(main())
trace.get_tracer_provider().shutdown()
metrics.get_meter_provider().shutdown()
_logs.get_logger_provider().shutdown()
```

Pull the model, point the file at your collector and run it:

```bash showLineNumbers title="Terminal"
ollama pull qwen3.5:9B
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=order-agent
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
python quickstart.py
```

It prints the answer, for example `Order A-100 has been shipped.` Your backend
then shows one trace for the run under the service `order-agent`:

```text showLineNumbers title="The Quick Start trace"
invocation
`-- invoke_agent order_agent
    |-- call_llm
    |   `-- generate_content ollama_chat/qwen3.5:9B    asks for the tool call
    |-- execute_tool order_status
    `-- call_llm
        `-- generate_content ollama_chat/qwen3.5:9B    writes the answer
```

The session ID, `order-A-100`, is `gen_ai.conversation.id` on `invoke_agent`
and `generate_content`. The `gen_ai.*` metrics and two
`gen_ai.client.inference.operation.details` events arrive with the same
service name. If no trace shows up, check the endpoint and see
[Troubleshooting](#troubleshooting).

`maybe_set_otel_providers` adds an OTLP exporter for each signal whose
endpoint is set, and does not replace a provider that is already set. An
agent name must be a Python identifier, so `order_agent`, not `order-agent`.

## Configuration

ADK reads the global tracer, meter and logger providers. Set them before the
first run and ADK uses them, with your resource. The example does this in
`telemetry.py` and does not call `maybe_set_otel_providers`:

```python showLineNumbers title="telemetry.py (condensed)"
def configure_telemetry() -> None:
    resource = Resource.create()

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(AgentRunAttributesProcessor())
    tracer_provider.add_span_processor(BatchSpanProcessor(CostAndErrorAttributingSpanExporter(OTLPSpanExporter(), "ollama")))
    trace.set_tracer_provider(tracer_provider)

    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())])
    )

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(QuestionIdLogProcessor())
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(logger_provider)
    logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))
```

`AgentRunAttributesProcessor`, `QuestionIdLogProcessor` and
`CostAndErrorAttributingSpanExporter` are the example's own. Each is covered
below.

### Environment Variables

| Variable | Value in the example | Read by |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | `ai-filing-analyst` | The SDK resource. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | The OTLP exporters. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | The OTLP exporters. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | `gen_ai_latest_experimental` | ADK. Selects the inference event format. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` | ADK, for content on the inference events. See [Content Capture](#content-capture). |
| `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS` | Set by the example to match the variable above | ADK, for content in its own span attributes. On by default. |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `4096` | The SDK. Caps each captured value. |
| `OTEL_PYTHON_LOG_CORRELATION` | `true` | The example. Adds trace and span IDs to console log lines. |

With `gen_ai_latest_experimental`, ADK writes one
`gen_ai.client.inference.operation.details` event per model call. Without it,
ADK writes the older per-message events instead: `gen_ai.system.message`,
`gen_ai.user.message` and `gen_ai.choice`. Spans and metrics are the same
either way.

## What ADK Emits

This is the ranking question from the example, one trace per HTTP request.
The psycopg `SELECT` and `INSERT` spans and the ASGI `http receive` and
`http send` spans are left out.

```text showLineNumbers title="One ranking question"
POST /questions
|-- invocation
|   `-- invoke_agent analyst
|       |-- call_llm
|       |   `-- generate_content ollama_chat/qwen3.5:9B
|       |-- execute_tool rank_among_filers
|       |   `-- invocation
|       |       `-- invoke_agent ranking
|       |           |-- call_llm
|       |           |   `-- generate_content ollama_chat/gemma4:e2b
|       |           |-- execute_tool frame_values
|       |           |   `-- GET                            SEC frames API
|       |           `-- call_llm
|       |               `-- generate_content ollama_chat/gemma4:e2b
|       |-- call_llm
|       |   `-- generate_content ollama_chat/qwen3.5:9B
|       `-- execute_tool set_model_response              the typed answer
`-- filing.verify_answer                                  hand-written
```

ADK emits one `invocation` span per runner call, one `invoke_agent <agent>`
per agent run, one `call_llm` per model turn with a
`generate_content <model>` inside it, and one `execute_tool <tool>` per tool
call. An agent attached with `AgentTool` runs its own `invocation` inside the
`execute_tool` span, so both agents share one trace. The model name keeps the
LiteLLM route, `ollama_chat/`.

The model decides the tool calls, so the shape varies between runs of the
same question.

The attributes worth knowing, with the opt-in set:

- `gen_ai.agent.name` and `gen_ai.agent.description` on `invoke_agent`.
- `gen_ai.conversation.id`, the session ID, on `invoke_agent` and
  `generate_content`.
- `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens` and `gen_ai.response.finish_reasons` on
  `generate_content`, and on `call_llm`, with
  `gen_ai.usage.cache_read.input_tokens` when the model reports it.
- `gen_ai.tool.definitions` on `generate_content`. The parameters are there
  only when `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` is `SPAN_ONLY`
  or `SPAN_AND_EVENT`.
- `gen_ai.tool.name`, `gen_ai.tool.description`, `gen_ai.tool.type` and
  `gen_ai.tool.call.id` on `execute_tool`.

ADK also writes keys of its own under `gcp.vertex.agent.*`: the request and
response on `call_llm`, and the tool arguments and result on `execute_tool`,
while content capture in spans is on. `call_llm` carries
`gen_ai.system=gcp.vertex.agent`. No span carries `gen_ai.provider.name` or
`server.address`.

### ADK Metrics

ADK records these through the global meter provider:

| Metric | What it measures | Attributes |
| --- | --- | --- |
| `gen_ai.client.operation.duration` | Model call duration. | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.agent.name`. |
| `gen_ai.client.token.usage` | Tokens per model call. | The above, plus `gen_ai.token.type`. |
| `gen_ai.invoke_agent.duration` | Agent run duration. | `gen_ai.agent.name`, and `error.type` on a failed run. |
| `gen_ai.invoke_agent.inference_calls` | Model calls per agent run. | `gen_ai.agent.name`. |
| `gen_ai.invoke_agent.tool_calls` | Tool calls per agent run. | `gen_ai.agent.name`. |
| `gen_ai.execute_tool.duration` | Tool call duration. | `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.agent.name`, and `error.type` on a failed call. |

Through LiteLLM, `gen_ai.provider.name` on the metrics is the route, such as
`ollama_chat`, and `gen_ai.request.model` carries the route prefix.

### Inference Events

With the opt-in set, ADK writes a `gen_ai.client.inference.operation.details`
log record for each model call, through the global logger provider. It
carries the trace and span ID of the model call, the agent name, the
conversation ID, the token counts, the finish reasons and the tool
definitions. With content capture on, it also carries
`gen_ai.system_instructions`, `gen_ai.input.messages` and
`gen_ai.output.messages`. The record has no body.

## Request Attributes

ADK has no per-agent trace attributes. The example sets the request's
attributes in a context variable around the run, and a span processor copies
them onto each GenAI span as it starts:

```python showLineNumbers title="telemetry.py (condensed)"
class AgentRunAttributesProcessor(SpanProcessor):
    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        run = _agent_run.get()
        if run is None or not span.name.startswith(("invoke_agent", "invocation", "call_llm", "generate_content", "execute_tool")):
            return
        attributes = span.attributes or {}
        added = {**run.question, **_agent_or_model(run, span.name, attributes)}
        span.set_attributes({key: value for key, value in added.items() if key not in attributes})
```

`run.question` holds the request ID, `gen_ai.conversation.id` and the
ticker. `_agent_or_model` picks the agent's prompt version, model digest and
server from the span's agent name or model, so the ranking agent's spans carry
its own. ADK sets its own attributes after the span starts, so where both
set a key, ADK's value wins.

The session ID is ADK's `gen_ai.conversation.id`. The example uses the
request ID as the analyst's session ID, so the two match.

## Agents as Tools

`AgentTool` wraps an agent as a tool of another agent:

```python showLineNumbers title="frameworks/adk.py (condensed)"
ranking = LlmAgent(
    name="ranking",
    model=models(config.ranking_model),
    description=RANKING_TOOL_DESCRIPTION,
    instruction=verbatim(config.ranking_prompt.system),
    tools=list(tools.ranking),
    **hooks,
)
ranking_tool = AgentTool(agent=ranking)
ranking_tool.name = "rank_among_filers"

analyst = LlmAgent(
    name="analyst",
    model=models(config.analyst_model),
    instruction=verbatim(analyst_instructions(config, FINISH_RULE)),
    tools=[*tools.analyst, ranking_tool],
    output_schema=FilingAnswer,
    **hooks,
)
```

`hooks` maps the four `*_callback` arguments to the methods of one
`Callbacks` object, shown in [Budgets](#budgets).

The inner agent runs in a new session, so ADK sets that session's UUID as
`gen_ai.conversation.id` on its `invoke_agent` and `generate_content` spans,
not the outer session ID. The example's processor puts the request ID on its
other spans. Search by your own
request ID attribute to see both agents.

ADK fills `{name}` placeholders in a string instruction from session state.
The ranking prompt holds `{rank}` as text, so the example passes each prompt
through an instruction provider, `verbatim`, whose text ADK uses as it is.

A tool that fails inside the inner agent shows on its `execute_tool` span with
error status. The outer `execute_tool rank_among_filers` span ends without
error. The example's `after_tool_callback` on the ranking tool appends the
frame's facts to the inner agent's reply, and replaces the reply with a fixed
line when the frames fetch failed.

## Structured Output

`output_schema=FilingAnswer` on an agent with tools gives it ADK's
`set_model_response` tool, with the schema as its parameters. The model
finishes by calling it, which shows as `execute_tool set_model_response`.

ADK lists `set_model_response` before the agent's own tools. With the answer
schema listed first, `qwen3.5:9B` passes fiscal years it assumes to
`query_facts` on "last three years" questions instead of calling the tool
without years. The example moves the answer tool to the end of the request in
`before_model_callback`:

```python showLineNumbers title="frameworks/adk.py (condensed)"
def answer_tool_last(llm_request: LlmRequest) -> None:
    for tool in llm_request.config.tools or []:
        if isinstance(tool, types.Tool) and tool.function_declarations:
            tool.function_declarations.sort(key=lambda declaration: declaration.name == "set_model_response")
```

The typed answer arrives as the final event's text, and the example
validates it with Pydantic after the run.

## Budgets

ADK's callbacks cover both agents when you pass the same ones to each. The
example counts model and tool calls across both agents with a plain
`CallBudget` counter:

```python showLineNumbers title="frameworks/adk.py (condensed)"
class Callbacks:
    async def before_model(self, callback_context: CallbackContext, llm_request: LlmRequest) -> LlmResponse | None:
        answer_tool_last(llm_request)
        self._budget.count_model()  # raises past the budget
        return None

    def before_tool(self, tool: BaseTool, args: dict[str, Any], tool_context: ToolContext) -> dict[str, Any] | None:
        exceeded = self._budget.count_tool()
        if exceeded is None:
            return None
        return {"error": "budget", "detail": str(exceeded)}

    def on_tool_error(self, tool: BaseTool, args: dict[str, Any], tool_context: ToolContext, error: Exception) -> dict[str, Any] | None:
        return {"error": type(error).__name__, "detail": str(error)}
```

A model call over the budget raises, which ends `call_llm`, `invoke_agent`
and `invocation` with error status. A dict returned from `before_tool`
replaces the tool's result, so the tool does not run.

A tool that raises ends the whole run. The example's `on_tool_error` returns
the error to the model as a tool result instead, so the model can answer
without it.

ADK marks a function tool's span with error status and `error.type=TOOL_ERROR`
whenever the tool's result is a dict with an `error` key, whether the tool,
`before_tool` or `on_tool_error` produced it. An `AgentTool` span ends without
error.

ADK has no wall-clock limit. The example wraps the run in `asyncio.wait_for`,
which cancels it at the deadline. A cancelled run ends `invoke_agent` without
error status.

## Logs and Trace Correlation

The `LoggingHandler` in [Configuration](#configuration) sends every
application log record to the collector with the trace ID and span ID of the
span it was written under. ADK's own loggers, under `google_adk`, go through
the same handler. A failed run logs `Node execution failed with exception` and
`Root node <agent> failed.` at ERROR, with the traceback.

The inference events go to the logger provider directly, not through
`logging`. The example's `QuestionIdLogProcessor` adds the request ID to
those records too, so every record of a request can be found by one
attribute.

## Content Capture

ADK splits content capture across two variables:

- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` controls content on
  the inference events. `true` puts it on the event only. `SPAN_ONLY`,
  `EVENT_ONLY` and `SPAN_AND_EVENT` pick where it goes. Unset or `false`
  records none.
- `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS` controls the request, response,
  tool arguments and tool results in the `gcp.vertex.agent.*` span
  attributes. It is on unless set to `false`.

Setting only the first to `false` leaves prompts and tool results on the
spans. The example sets the second from the first before the first run:

```python showLineNumbers title="frameworks/adk.py (condensed)"
def apply_capture_setting() -> None:
    capture = os.environ.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true").strip().lower() != "false"
    os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] = "true" if capture else "false"
```

## Adding Cost and Error Type with a Span Exporter

ADK records the exception on a failed `generate_content`, `call_llm`,
`invoke_agent` and `invocation` span but sets no `error.type` there, and
records no cost. The example wraps the OTLP span exporter to add both on the
way out:

- `error.type` from the first recorded exception, then from the HTTP status
  code, then `_OTHER`.
- `base14.gen_ai.cost` on each `generate_content` span, from the token counts
  and a price table. A model with no price, such as a local Ollama model, gets
  0 and `base14.gen_ai.cost.simulated=true`.
- `gen_ai.provider.name=ollama` on each `generate_content` span, since ADK
  writes none.

See `CostAndErrorAttributingSpanExporter` in the example's
[`telemetry.py`](https://github.com/base-14/examples/blob/main/python/ai-filing-analyst/src/filing_analyst/telemetry.py).

## Known Gaps

As of Google ADK 2.10.0, verified 2026-09-29:

- **OpenTelemetry is capped at 1.42.1.** Libraries that need a later SDK
  cannot share an environment with ADK.
- **No `gen_ai.provider.name` or `server.address` on spans.** The metrics
  carry the LiteLLM route, such as `ollama_chat`, as the provider. Add the
  provider and server in a span processor or exporter.
- **Model names keep the LiteLLM route.** `gen_ai.request.model` reads
  `ollama_chat/qwen3.5:9B`, on spans and metrics.
- **No `error.type` on failed agent and model spans.** The metrics carry it.
  Add it in a span exporter.
- **A tool that raises ends the run.** Return the error from
  `on_tool_error_callback` to hand it to the model instead.
- **A tool error returned to the model is marked by the result's shape.** A
  function tool whose result is a dict with an `error` key ends with error
  status and `error.type=TOOL_ERROR`. An `AgentTool` span ends without error.
- **An agent called through `AgentTool` gets its own conversation ID**, the
  inner session's UUID.
- **Span names depend on ADK's telemetry schema version.** This page shows
  version 1, the default outside Agent Engine. On Agent Engine, or with
  `ADK_TELEMETRY_SCHEMA_VERSION_OPT_IN=2`, `invoke_workflow <agent>` replaces
  `invocation`.
- **`set_model_response` is listed first.** With a schema that has fields
  like the tools' parameters, a small model can fill tool parameters from it.
  Move it to the end in `before_model_callback`.
- **Content capture has two switches.** Setting
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` alone leaves
  content in the `gcp.vertex.agent.*` span attributes.
- **String instructions are templates.** `{name}` in an instruction is filled
  from session state. Pass literal braces through an instruction provider.

## What to Look For in Scout

### Follow one request across both agents

Search spans by your own request ID attribute. The trace shows
`invoke_agent ranking` under `execute_tool rank_among_filers`, with its own
`gen_ai.request.model`. `gen_ai.conversation.id` differs between the two
agents.

### Find failed runs and why

Filter spans on `status = Error` and group by `error.type`. With the
example's exporter, a model server that cannot be reached shows on
`generate_content` as `litellm.exceptions.APIConnectionError`, and
`filing_analyst.budget.BudgetExceeded` on `invoke_agent` marks a budget stop.
A timeout leaves `invoke_agent` without error status. The example's server
span ends with error status, a 504 and `base14.filing.outcome=timeout`.

### Find a tool that failed inside a run that completed

Filter `execute_tool` spans on error status. A failed frames fetch in the
ranking agent shows here, with `error.type=TOOL_ERROR`, while
`invoke_agent analyst` completes. The analyst's answer then says the ranking
is unavailable.

### Read tokens by model

Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on
`generate_content` spans, grouped by `gen_ai.request.model`, or read the
`gen_ai.client.token.usage` metric by `gen_ai.request.model` and
`gen_ai.token.type`.

### Read a model call's messages

With content capture on, open the `gen_ai.client.inference.operation.details`
record for the `generate_content` span. It holds the system instructions and
the messages in the conventions' format.

## Production Patterns

- **Turn content capture off for real data.** Set both
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` and
  `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`.
- **Cap attribute length.** Tool results and the `gcp.vertex.agent.*`
  request attributes can be long. The example sets
  `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=4096`.
- **Bound every run twice.** A call budget in the callbacks stops a loop, and
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
ADK:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-filing-analyst
cp .env.example .env
ollama pull qwen3.5:9B
ollama pull gemma4:e2b
make docker-up FRAMEWORK=adk
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
`FILING_FAULTS_ENABLED=true make docker-up FRAMEWORK=adk`.

## Troubleshooting

### No ADK spans

No global tracer provider is set, so ADK writes to the no-op provider. Set
one at startup, or call `maybe_set_otel_providers()` with
`OTEL_EXPORTER_OTLP_ENDPOINT` set.

### Inference events arrive as separate message events

`OTEL_SEMCONV_STABILITY_OPT_IN` does not contain
`gen_ai_latest_experimental`, so ADK writes `gen_ai.user.message`,
`gen_ai.choice` and similar events instead of
`gen_ai.client.inference.operation.details`.

### Prompts still show with capture turned off

`ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS` is unset, so ADK keeps content in the
`gcp.vertex.agent.*` span attributes. Set it to `false`.

### A tool error stops the run

The tool raised and no `on_tool_error_callback` returned a result. The
`execute_tool` span has error status and `error.type` set to the exception
class. Add a callback that returns the error as a result.

### Dependency conflict on opentelemetry-sdk

Another package needs OpenTelemetry later than 1.42.1. Pin the SDK and the
instrumentations to 1.42.1 and 0.63b1, or run that package in another
environment.

## FAQ

### Does Google ADK support OpenTelemetry?

Yes, Google ADK emits OpenTelemetry spans, `gen_ai.*` metrics and inference
events to the global tracer, meter and logger providers.

### Which spans does an ADK agent run produce?

One `invocation` per runner call, one `invoke_agent <agent>` per agent run,
one `call_llm` with a `generate_content <model>` per model call, and one
`execute_tool <tool>` per tool call.

### Does ADK work with OpenTelemetry on models other than Gemini?

Yes, the spans are the same through LiteLLM. The model name keeps the LiteLLM
route, such as `ollama_chat/qwen3.5:9B`.

### How do I add my own IDs to ADK spans?

Add a span processor that sets them in `on_start` from a context variable you
set around the run. ADK has no per-agent trace attributes.

### How do I turn off prompt capture in ADK?

Set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` and
`ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`. The first covers the inference
events, the second ADK's span attributes.

### Does ADK record token usage?

Yes, ADK records `gen_ai.usage.input_tokens` and `output_tokens` on each
`generate_content` span and in the `gen_ai.client.token.usage` metric.

### Does ADK record cost?

No, ADK records token counts but not cost. Add a cost attribute in a span
exporter, as in
[Adding Cost and Error Type](#adding-cost-and-error-type-with-a-span-exporter).

### How do I trace one ADK agent calling another?

Attach the inner agent with `AgentTool`. It runs inside the outer agent's
`execute_tool` span, so both share one trace.

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [Strands Agents](./strands-agents.md) - the same example on Strands.
- [Microsoft Agent Framework](./microsoft-agent-framework.md) - the same
  example on Agent Framework.
- [OpenAI Agents SDK](./openai-agents-sdk.md) - the same example on the
  OpenAI Agents SDK.
- [FastAPI](./fast-api.md) - the HTTP service in front of the agents.

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
`FILING_FRAMEWORK=adk` runs it on ADK.

```text showLineNumbers
ai-filing-analyst/
|-- prompts/                     analyst and ranking prompts, named by UTC timestamp
|-- scripts/
|   |-- test-api.sh              seventeen scenarios
|   `-- verify-scout.sh          checks the run's telemetry in the collector output
`-- src/filing_analyst/
    |-- telemetry.py             providers, logging, run attributes, cost and error attributes
    |-- frameworks/adk.py        the two agents, callbacks, answer tool order, capture setting
    |-- agents.py                what every framework adapter shares
    |-- budget.py                the call budget counter
    |-- tools.py                 query_facts, compute_ratio, frame_values
    `-- verifier.py              the grounding check
```

Source:
[`python/ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst).

## References

- [ADK observability](https://google.github.io/adk-docs/observability/).
- [ADK LiteLLM models](https://google.github.io/adk-docs/agents/models/litellm/).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/).
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
