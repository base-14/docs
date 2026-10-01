---
title:
  Strands Agents OpenTelemetry - Agent, Model and Tool Spans
sidebar_label: Strands Agents
sidebar_position: 7.7
description:
  Trace Strands Agents with OpenTelemetry on any model provider. Agent, model
  and tool spans, strands metrics, trace-correlated logs, redaction and the
  known gaps.
keywords:
  [
    strands agents opentelemetry,
    strands agents tracing,
    strands agents observability,
    strands agents instrumentation,
    StrandsTelemetry,
    strands trace_attributes,
    strands agents ollama,
    OllamaModel tracing,
    strands agents as tools tracing,
    strands structured_output_model,
    strands agents metrics,
    strands agents logs,
    gen_ai_latest_experimental,
    OTEL_SEMCONV_STABILITY_OPT_IN,
    gen_ai.provider.name strands-agents,
    llm observability python,
    ai agent monitoring python,
    multi-agent tracing python,
  ]
---

# Strands Agents

Strands Agents has OpenTelemetry tracing and metrics built in. It writes to
the global tracer and meter providers, so once you set them, every agent run
emits GenAI spans for the run, each event loop cycle, each model call and each
tool call, plus `strands.*` metrics. Strands exports no logs; add the
OpenTelemetry logging handler for those.

:::tip TL;DR

Set a global tracer and meter provider before the first agent runs, and set
`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`. Each run emits
`invoke_agent <agent>`, `execute_event_loop_cycle`, `chat` and
`execute_tool <tool>` spans. Pass `trace_attributes` to each `Agent` to put
your IDs on every span, and to replace the `gen_ai.provider.name` of
`strands-agents` with the real provider.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For other Python agent frameworks, see [Pydantic AI](./pydantic-ai.md) and
> [LangChain](./langchain.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running Strands agents who want traces, metrics and logs
  in an OpenTelemetry backend.
- Teams on any model provider Strands supports, hosted or local, who want the
  same spans whichever provider they use.
- Teams nesting one agent inside another as a tool, who want one trace per
  request across both.

## Overview

- Set up tracing and metrics yourself or with `StrandsTelemetry`.
- Read the span tree of a run, including an agent called as a tool.
- Put request IDs, prompt versions and the real provider on every span with
  `trace_attributes`.
- Export trace-correlated logs, which Strands does not do.
- Turn content capture off with Strands' redaction token.
- Recognize a structured output failure and a budget stop in a trace.
- Add `error.type` and cost in a span exporter.

### Signals

| Signal | What Strands emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invoke_agent`, `execute_event_loop_cycle`, `chat` and `execute_tool` spans with GenAI attributes. | `gen_ai.provider.name`, `server.address` and request IDs through `trace_attributes`. `error.type` and cost in a span exporter. FastAPI, httpx and psycopg spans, and one hand-written span. |
| Metrics | `strands.event_loop.*`, `strands.tool.*` and `strands.model.time_to_first_token`. | Application counters and a duration histogram under `base14.filing.*`. `http.server.*` and `http.client.duration` from the FastAPI and httpx instrumentations. |
| Logs | Standard `logging` only, not exported. | The OpenTelemetry `LoggingHandler` on the root logger, so every line carries the trace and span ID. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model provider Strands supports, with a model that can call tools. The
  Quick Start and the example use Ollama with `qwen3.5:9B`, which needs no API
  key.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `strands-agents` | 1.57.1, with the `otel` and `ollama` extras |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-httpx`, `-psycopg`, `-logging` | 0.66b0 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `gemma4:e2b` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst) |

Last verified 2026-09-27 with Strands Agents 1.57.1, against
[`open-telemetry/semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai)
at commit `e57c543` (2026-09-24). The GenAI conventions are in Development
status, so attribute names can change between Strands releases. Pin
`strands-agents` to an exact version and re-check the spans after each
upgrade.

The example uses Strands' Ollama model provider. Strands opens its spans in
the agent loop and the tool executor, not in the model classes, so the span
tree and attributes are the same on every provider Strands supports. Values
the provider reports, such as token and cache counts, depend on the provider.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add "strands-agents[otel,ollama]==1.57.1" \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install "strands-agents[otel,ollama]==1.57.1" \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
</Tabs>
```

Strands depends on the OpenTelemetry API and SDK. The `otel` extra adds the
OTLP HTTP exporter, which `StrandsTelemetry` uses. The `ollama` extra installs
the client behind `OllamaModel`. For another provider, install its extra
instead, such as `openai`, `anthropic`, `gemini`, `mistral` or `litellm`.
Amazon Bedrock needs no extra. For logs,
add `opentelemetry-instrumentation-logging==0.66b0`.

## Quick Start

This file is a minimal starting point, not part of the example. It sets up
tracing and metrics with `StrandsTelemetry` and runs one agent with one tool on
Ollama. Any model class Strands ships works in place of `OllamaModel`. Save it
as `quickstart.py`:

```python showLineNumbers title="quickstart.py"
from strands import Agent, tool
from strands.models.ollama import OllamaModel
from strands.telemetry import StrandsTelemetry

telemetry = StrandsTelemetry().setup_otlp_exporter().setup_meter(enable_otlp_exporter=True)


@tool
def order_status(order_id: str) -> str:
    """Return the shipping status of an order."""
    return "shipped" if order_id == "A-100" else "not found"


agent = Agent(
    name="order-agent",
    model=OllamaModel(
        host="http://localhost:11434",
        model_id="qwen3.5:9B",
        additional_args={"think": False},
    ),
    tools=[order_status],
    system_prompt="Look up the order with the order_status tool, then answer in one sentence.",
    trace_attributes={"gen_ai.conversation.id": "order-A-100"},
    callback_handler=None,
)

print(agent("Where is order A-100?"))
telemetry.tracer_provider.shutdown()
telemetry.meter_provider.shutdown()
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
invoke_agent order-agent
|-- execute_event_loop_cycle
|   |-- chat                        asks for the tool call
|   `-- execute_tool order_status
`-- execute_event_loop_cycle
    `-- chat                        writes the answer
```

Every span carries `gen_ai.conversation.id=order-A-100`. The `strands.*`
metrics arrive with the same service name. If no trace shows up, check the
endpoint and see [Troubleshooting](#troubleshooting).

`StrandsTelemetry` builds its own resource and takes no resource argument.
It sets `service.version` to the Strands version. For a service,
build the providers yourself, as in [Configuration](#configuration).

## Configuration

Strands reads the global tracer and meter providers when it first needs them.
Set both before the first agent is built and Strands uses them, with your
resource. The example does this in `telemetry.py` and does not call
`StrandsTelemetry`:

```python showLineNumbers title="telemetry.py (condensed)"
import logging

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.logging.handler import LoggingHandler
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def configure_telemetry() -> None:
    resource = Resource.create()

    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tracer_provider)

    metrics.set_meter_provider(
        MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())],
        )
    )

    logger_provider = LoggerProvider(resource=resource)
    logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(logger_provider)
    logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))
```

The example also wraps the span exporter to add cost and `error.type`, maps
the content capture variable onto Strands' redaction, and instruments FastAPI,
httpx and psycopg. Each is covered below.

### Environment Variables

| Variable | Value in the example | Read by |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | `ai-filing-analyst` | The SDK resource. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | The OTLP exporters. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | The OTLP exporters. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | `gen_ai_latest_experimental` | Strands, once, when its tracer is first built. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` | The example, not Strands. See [Content Capture and Redaction](#content-capture-and-redaction). |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `4096` | The SDK. Caps each captured message and tool result. |
| `OTEL_PYTHON_LOG_CORRELATION` | `true` | The example. Adds trace and span IDs to console log lines. |

Set `OTEL_SEMCONV_STABILITY_OPT_IN` before the first agent runs. Without it,
Strands writes message content as span events instead of attributes.

## What Strands Emits

This is the ranking question from the example, one trace per HTTP request.
The psycopg `SELECT` and `INSERT` spans and the ASGI `http receive` and
`http send` spans are left out.

```text showLineNumbers title="One ranking question"
POST /questions
|-- invoke_agent analyst                     qwen3.5:9B
|   |-- execute_event_loop_cycle
|   |   |-- chat
|   |   `-- execute_tool rank_among_filers
|   |       `-- invoke_agent ranking         gemma4:e2b
|   |           |-- execute_event_loop_cycle
|   |           |   |-- chat
|   |           |   `-- execute_tool frame_values
|   |           |       `-- GET              SEC frames API
|   |           `-- execute_event_loop_cycle
|   |               `-- chat
|   `-- execute_event_loop_cycle
|       |-- chat
|       `-- execute_tool FilingAnswer        the typed answer
`-- filing.verify_answer                     hand-written
```

Strands emits one `invoke_agent <agent>` span per run, one
`execute_event_loop_cycle` per model turn, one `chat` per model call and one
`execute_tool <tool>` per tool call. An agent attached with `as_tool` runs
inside its `execute_tool` span, so both agents share one trace.

The model decides the tool calls, so the shape varies between runs of the
same question. The analyst may also call `query_facts` for the company's own
figure, which adds a cycle with `chat` and `execute_tool query_facts`.

The convention attributes worth knowing, with the opt-in set:

- `gen_ai.agent.name` on `invoke_agent`.
- `gen_ai.request.model` on `invoke_agent` and `chat`.
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on each `chat`,
  and the run's totals on `invoke_agent`.
- `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments` and
  `gen_ai.tool.call.result` on `execute_tool`.
- `gen_ai.system_instructions`, `gen_ai.input.messages` and
  `gen_ai.output.messages` when content is captured.

Strands also writes keys of its own that the conventions do not define:

- `gen_ai.agent.tools` on `invoke_agent`, listing the agent's tools.
- `gen_ai.tool.status` on `execute_tool`, `success` or `error`.
- `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens` and
  `gen_ai.usage.total_tokens` beside the convention token counts.
- `gen_ai.server.request.duration` and `gen_ai.server.time_to_first_token` on
  `chat`, which the conventions define as metrics, not span attributes.

Add the `gen_ai_tool_definitions` token to `OTEL_SEMCONV_STABILITY_OPT_IN`,
comma separated, to record `gen_ai.tool.definitions` on the agent span.

### Strands Metrics

Strands records these through the global meter provider:

| Metric | What it counts |
| --- | --- |
| `strands.event_loop.cycle_count`, `start_cycle`, `end_cycle` | Event loop cycles. |
| `strands.event_loop.cycle_duration`, `strands.event_loop.latency` | Cycle and model call duration. |
| `strands.event_loop.input.tokens`, `strands.event_loop.output.tokens` | Tokens per model call. |
| `strands.model.time_to_first_token` | Time to the first streamed token. |
| `strands.tool.call_count`, `success_count`, `error_count` | Tool calls by result. |
| `strands.tool.duration` | Tool call duration. |

These are Strands' own names, not the `gen_ai.client.*` metrics from the
conventions. The token and cycle metrics carry no model or agent attribute,
and the tool metrics carry `tool_name`. For token usage by model, use the
`chat` spans.

## Trace Attributes

Build each `Agent` per request and pass `trace_attributes`. Strands copies
them onto every span of that agent's run, not only `invoke_agent`. Strands
applies them after its own attributes, so a key you set replaces Strands'
value for it:

```python showLineNumbers title="frameworks/strands.py (condensed)"
def _attributes(request: QuestionRequest, config: AgentConfig, prompt: Prompt, model_id: str) -> dict[str, str | int]:
    server = urlsplit(config.ollama_base_url)
    return {
        "gen_ai.provider.name": "ollama",
        "server.address": server.hostname or "",
        "server.port": server.port or 11434,
        "gen_ai.conversation.id": request.question_id,
        "base14.filing.question_id": request.question_id,
        "base14.prompt.version": prompt.version,
        "base14.gen_ai.model.digest": config.digests.get(model_id, "unknown"),
    }
```

Scout attributes each model call to a provider by `gen_ai.provider.name`,
with `server.address` and `server.port` naming the endpoint. Set them for the
provider your agent uses: `anthropic`, `openai`, `gcp.gemini` or `ollama`. The
example sets `ollama`, with the host and port from `OLLAMA_BASE_URL`.

`gen_ai.conversation.id` groups every model and tool call of one request.
Each agent gets its own set, so the ranking agent's spans carry its own prompt
version and model digest. Custom attributes take a `base14.` prefix, since the
conventions own `gen_ai.*`.

## Agents as Tools

`agent.as_tool(name, description)` wraps an agent as a tool of another agent:

```python showLineNumbers title="frameworks/strands.py (condensed)"
ranking = Agent(
    name="ranking",
    model=models(config.ranking_model),
    tools=strands_tools(tools.ranking),
    hooks=[budget_hook],
    trace_attributes=_attributes(request, config, config.ranking_prompt, config.ranking_model),
    callback_handler=None,
)
analyst = Agent(
    name="analyst",
    model=models(config.analyst_model),
    tools=[*strands_tools(tools.analyst), ranking.as_tool(name="rank_among_filers", description=RANKING_TOOL_DESCRIPTION)],
    structured_output_model=FilingAnswer,
    hooks=[budget_hook, RankingHook(collector)],
    trace_attributes=_attributes(request, config, config.analyst_prompt, config.analyst_model),
    callback_handler=None,
)
```

A tool that fails inside the inner agent reaches the inner agent as a tool
result, and the run carries on. The failed call shows only on the inner span,
such as `execute_tool frame_values` with error status. The outer
`execute_tool rank_among_filers` span ends without error. When the inner
agent itself fails or is cancelled, the outer span ends with error status.

The outer agent reads only the inner agent's reply text. A small model can
drop facts from that reply, such as the frame or the accession number. The
example's `RankingHook`, on `AfterToolCallEvent`, appends the frame's
facts to the reply as the tool returned them, and replaces the reply with a
fixed line when the frames fetch failed.

## Structured Output

`Agent(structured_output_model=FilingAnswer)` registers a tool named after the
Pydantic class. The model finishes by calling it, and a failed validation
comes back to the model as a tool error to fix. In the trace:

- Each attempt is an `execute_tool FilingAnswer` span. A failed validation
  ends with error status and `gen_ai.tool.status=error`. Strands records no
  exception on it, so an exporter that derives `error.type` has only the
  `_OTHER` fallback.
- When the model ends a turn without calling the tool, Strands forces one more
  turn with `tool_choice`. `OllamaModel` ignores `tool_choice` with a warning,
  so on Ollama the retry depends on the model.
- A second end of turn without the tool raises `StructuredOutputException`,
  and `invoke_agent` ends with error status.

Validation has no retry limit of its own. The call budget below bounds it.

## Budgets

Strands has two native stops. `invoke_async(limits=Limits(...))` caps turns
and tokens for one agent, and `cancel_signal` takes a `threading.Event` for a
wall-clock timeout. Both end the run without error status, with a `limit_*`
or `cancelled` stop reason on the result.

Strands reads `cancel_signal` between stream chunks, cycles and tools. A model
call or tool that stalls does not see it. The example wraps the run in
`asyncio.wait_for` with two seconds of grace, so a stalled call is cancelled
outright.

`limits` counts one agent only. The example counts model and tool calls across
both agents with a hook shared by both, around a plain `CallBudget` counter:

```python showLineNumbers title="frameworks/strands.py (condensed)"
class BudgetHook(HookProvider):
    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeModelCallEvent, self._on_model_call)
        registry.add_callback(BeforeToolCallEvent, self._on_tool_call)

    def _on_model_call(self, event: BeforeModelCallEvent) -> None:
        self._budget.count_model()  # raises past the budget

    def _on_tool_call(self, event: BeforeToolCallEvent) -> None:
        exceeded = self._budget.count_tool()
        if exceeded is not None:
            trace.get_current_span().set_attribute("error.type", BUDGET_ERROR_TYPE)
            event.cancel_tool = str(exceeded)
```

A model call over the budget raises, which ends `invoke_agent` with error
status. A tool call over the budget is cancelled with `event.cancel_tool`
instead of raising. See [Known Gaps](#known-gaps) for why.

## Logs and Trace Correlation

Strands logs through standard `logging` and exports nothing. The
`LoggingHandler` in [Configuration](#configuration) sends every record to the
collector with the trace ID and span ID of the span it was written under.

To print the IDs in console lines too, add a console handler to the root
logger first, then instrument logging. The instrumentation's own
`basicConfig` does nothing once the root logger has a handler:

```python showLineNumbers title="telemetry.py (condensed)"
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.logging.constants import DEFAULT_LOGGING_FORMAT

console = logging.StreamHandler()
console.setFormatter(logging.Formatter(DEFAULT_LOGGING_FORMAT))
logging.getLogger().addHandler(console)
LoggingInstrumentor().instrument(
    set_logging_format=True,
    inject_trace_context=True,
    enable_log_auto_instrumentation=False,
)
```

The instrumentation adds `otelTraceID` and similar fields to every record. The
`LoggingHandler` exports non-reserved record fields as attributes, so the
example strips them with a filter on the OTLP handler. Exported records carry
the trace context already.

## Content Capture and Redaction

With the opt-in set, Strands records system instructions, messages, tool
arguments and tool results as span attributes. Strands does not read
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`. It redacts those
attributes when `OTEL_SEMCONV_STABILITY_OPT_IN` carries a
`gen_ai_unredacted_attributes=` token, and an empty list after the `=`
redacts all of them.

The example maps the capture variable onto that token before the first agent
is built:

```python showLineNumbers title="telemetry.py (condensed)"
def apply_content_capture_setting() -> None:
    if os.environ.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true").strip().lower() != "false":
        return
    tokens = [t.strip() for t in os.environ.get("OTEL_SEMCONV_STABILITY_OPT_IN", "").split(",") if t.strip()]
    if not any(t.startswith("gen_ai_unredacted_attributes=") for t in tokens):
        os.environ["OTEL_SEMCONV_STABILITY_OPT_IN"] = ",".join([*tokens, "gen_ai_unredacted_attributes="])
```

Token counts and the other attributes are recorded either way. To keep a few
attributes readable, list them after the `=`.

## Adding Cost and Error Type with a Span Exporter

Strands records the exception on a failed span but sets no `error.type`, and
records no cost. The example wraps the OTLP span exporter to add both on the
way out:

- `error.type` from the first recorded exception, then from the HTTP status
  code, then `_OTHER`. Strands wraps event loop failures in
  `EventLoopException`, so the exporter reports the cause instead.
- `base14.gen_ai.cost` on each `chat` span, from the token counts and a price
  table. A model with no price, such as a local Ollama model, gets 0 and
  `base14.gen_ai.cost.simulated=true`.

A finished span's attributes are frozen, so the exporter rebuilds each span it
changes. See `CostAndErrorAttributingSpanExporter` in the example's
[`telemetry.py`](https://github.com/base-14/examples/blob/main/python/ai-filing-analyst/src/filing_analyst/telemetry.py).

## Known Gaps

As of Strands Agents 1.57.1, verified 2026-09-27:

- **`gen_ai.provider.name` is `strands-agents`** on every span, not the model
  provider, and no span carries `server.address` or `server.port`. Without an
  override, Scout attributes every model call to `strands-agents`. Set all
  three through `trace_attributes`.
- **No `error.type`.** A failed span gets error status and a recorded
  exception only. Add `error.type` in a span exporter.
- **No OTLP logs.** Add the `LoggingHandler` yourself.
- **Metric names are Strands' own.** It records `strands.*` metrics, not the
  `gen_ai.client.*` ones.
- **No cache token metrics on Ollama.**
  `strands.event_loop.cache_read.input.tokens` and
  `strands.event_loop.cache_write.input.tokens` are recorded only when the
  provider reports prompt caching, and Ollama does not.
- **A tool hook that raises loses the tool span.** Strands opens
  `execute_tool` before `BeforeToolCallEvent` and does not end it when a hook
  raises, so the span is never exported. Cancel the tool with
  `event.cancel_tool` instead.
- **An agent called as a tool hides its failures from the outer span.** When
  a tool inside the inner agent fails, the outer `execute_tool` span still
  ends without error. The failure shows only on the inner span.
- **`cancel_signal` does not interrupt a call in flight.** Strands checks it
  between stream chunks, cycles and tools. Bound the whole run with
  `asyncio.wait_for` as well.
- **`tool_choice` is ignored on Ollama**, so a forced structured output turn
  is not forced.
- **`StrandsTelemetry` sets its own resource**, with `service.version` set to
  the Strands version.
- **Capture is not read from the standard variable.** Map
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` onto the redaction
  token yourself.

## What to Look For in Scout

### Follow one request across both agents

Search spans by `gen_ai.conversation.id` or your own request ID attribute.
The trace shows `invoke_agent ranking` under
`execute_tool rank_among_filers`, with its own `gen_ai.request.model`.

### Find failed runs and why

Filter spans on `status = Error` and group by `error.type`. In the example,
`filing_analyst.budget.BudgetExceeded` marks a budget stop and
`strands.types.exceptions.StructuredOutputException` a model that never
produced a valid answer. A timeout through `cancel_signal` leaves
`invoke_agent` without error status. The example's server span ends with
error status, a 504 and `base14.filing.outcome=timeout`.

### Find a tool that failed inside a run that completed

Filter `execute_tool` spans on error status. A failed frames fetch in the
ranking agent shows here while `invoke_agent analyst` completes. The analyst's
answer then says the ranking is unavailable.

### Read tokens by model

Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on `chat`
spans, grouped by `gen_ai.request.model`. The `strands.event_loop.*.tokens`
metrics carry no model attribute, so they give totals only.

### Go from a log line to its trace

Open the trace ID on the line. From a trace, filter logs by trace ID or by the
request ID attribute the example puts on every record.

## Production Patterns

- **Turn content capture off for real data.** Set
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` with the mapping
  above, or list only the attributes to keep after
  `gen_ai_unredacted_attributes=`.
- **Cap attribute length.** Tool results can be long. The example sets
  `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=4096`. The SDK logs a warning for each
  truncated value, so the example raises the `opentelemetry.attributes`
  logger to ERROR to keep those out of the exported logs.
- **Bound every run twice.** A call budget across agents stops a loop, and a
  wall-clock budget through `cancel_signal`, backed by `asyncio.wait_for`,
  stops a slow or stalled model or tool.
- **Put the prompt version and model digest on spans.** An Ollama tag can
  point at new weights. The example reads each model's digest from Ollama at
  startup.
- **Respect the upstream API.** The SEC asks for a User-Agent with a name and
  contact email, allows ten requests a second and answers 403 when it
  throttles. The example holds to five a second, caps calls per question and
  stops SEC calls for a back-off period after a 403.
- **Send through a collector.** The example exports OTLP HTTP to a collector,
  which authenticates to Scout and keeps a `debug` exporter for local checks.
- **Keep fault injection off.** The example's fault fields are refused unless
  `FILING_FAULTS_ENABLED=true`. Set it only for the scenario harness.

## Running Your Application

Run `quickstart.py` as in [Quick Start](#quick-start). For the full example:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-filing-analyst
cp .env.example .env
ollama pull qwen3.5:9B
ollama pull gemma4:e2b
make docker-up
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
`FILING_FAULTS_ENABLED=true make docker-up FRAMEWORK=strands`.

## Troubleshooting

### No Strands spans

No global tracer provider is set, so Strands writes to the no-op provider.
Set one at startup, before the first agent runs.

### Spans carry `gen_ai.provider.name=strands-agents`

That is Strands' default. Set `gen_ai.provider.name` in `trace_attributes`.

### No message content on spans

`OTEL_SEMCONV_STABILITY_OPT_IN` is missing `gen_ai_latest_experimental`, so
content went to span events, or a `gen_ai_unredacted_attributes=` token is
redacting it. Strands reads the variable once, so restart after changing it.

### Metrics carry a different resource from spans

`StrandsTelemetry().setup_meter()` installed a meter provider with its own
resource. Build the meter provider yourself.

### A tool span is missing from a trace

A `BeforeToolCallEvent` hook raised. Set `event.cancel_tool` instead.

### Console log lines have no trace ID

`OTEL_PYTHON_LOG_CORRELATION=true` alone does not change the format once the
root logger has a handler. Add a console handler with
`DEFAULT_LOGGING_FORMAT`, as in
[Logs and Trace Correlation](#logs-and-trace-correlation).

## FAQ

### Does Strands Agents support OpenTelemetry?

Yes, Strands Agents emits OpenTelemetry spans and metrics to the global
tracer and meter providers. It does not export logs.

### Which spans does a Strands agent run produce?

One `invoke_agent <agent>` span per run, one `execute_event_loop_cycle` per
model turn, one `chat` per model call and one `execute_tool <tool>` per tool
call.

### Do I need StrandsTelemetry?

No. Strands uses the global tracer and meter providers, so any providers you
set work. `StrandsTelemetry` is a shortcut that sets its own resource.

### How do I add my own IDs to Strands spans?

Pass `trace_attributes` to the `Agent`. Strands copies them onto every span of
the run, including `chat` and `execute_tool`.

### How do I turn off prompt capture in Strands?

Add `gen_ai_unredacted_attributes=` to `OTEL_SEMCONV_STABILITY_OPT_IN` before
the first agent runs. Strands then redacts messages, tool arguments and tool
results.

### Does Strands record token usage?

Yes, Strands records `gen_ai.usage.input_tokens` and `output_tokens` on each
`chat` span and in the `strands.event_loop.*.tokens` metrics.

### Does Strands record cost?

No, Strands records token counts but not cost. Add a cost attribute in a span
exporter, as in
[Adding Cost and Error Type](#adding-cost-and-error-type-with-a-span-exporter).

### How do I trace one Strands agent calling another?

Attach the inner agent with `as_tool`. It runs inside the outer agent's
`execute_tool` span, so both share one trace.

### Why is gen_ai.provider.name strands-agents?

Strands 1.57.1 writes its own name there. Override it in `trace_attributes`.

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [Google ADK](./google-adk.md) - the same example on ADK.
- [Microsoft Agent Framework](./microsoft-agent-framework.md) - the same
  example on Agent Framework.
- [OpenAI Agents SDK](./openai-agents-sdk.md) - the same example on the
  OpenAI Agents SDK.
- [Pydantic AI](./pydantic-ai.md) - built-in GenAI spans from another Python
  framework.
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

```text showLineNumbers
ai-filing-analyst/
|-- prompts/                     analyst and ranking prompts, named by UTC timestamp
|-- scripts/
|   |-- test-api.sh              seventeen scenarios
|   `-- verify-scout.sh          checks the run's telemetry in the collector output
`-- src/filing_analyst/
    |-- telemetry.py             providers, logging, redaction, cost and error attributes
    |-- frameworks/strands.py    the two agents, trace attributes, budget and ranking hooks
    |-- agents.py                what every framework adapter shares
    |-- budget.py                the call budget counter
    |-- tools.py                 query_facts, compute_ratio, frame_values
    `-- verifier.py              the grounding check
```

Source:
[`python/ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst).

## References

- [Strands Agents traces](https://strandsagents.com/docs/user-guide/sdk/observability-evaluation/traces/).
- [Strands Agents Ollama model provider](https://strandsagents.com/docs/user-guide/sdk/model-providers/ollama/).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai).
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/).
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
