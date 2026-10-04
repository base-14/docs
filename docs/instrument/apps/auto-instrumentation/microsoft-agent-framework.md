---
title:
  Microsoft Agent Framework OpenTelemetry - Agent, Chat and Tool Spans
sidebar_label: Microsoft Agent Framework
sidebar_position: 7.85
description:
  Trace Microsoft Agent Framework in Python and .NET with built-in
  OpenTelemetry instrumentation. Agent, chat and tool spans, gen_ai metrics,
  known gaps.
keywords:
  [
    microsoft agent framework opentelemetry,
    microsoft agent framework tracing,
    microsoft agent framework observability,
    agent framework python tracing,
    microsoft agent framework dotnet opentelemetry,
    agent framework UseOpenTelemetry,
    Experimental.Microsoft.Agents.AI,
    agent_framework observability,
    configure_otel_providers,
    enable_instrumentation,
    enable_sensitive_data,
    agent-framework-ollama,
    agent framework as_tool tracing,
    agent framework middleware,
    agent_framework.function.invocation.duration,
    llm observability python,
    ai agent monitoring python,
    multi-agent tracing python,
  ]
---

# Microsoft Agent Framework

Microsoft Agent Framework has OpenTelemetry built in. With instrumentation on,
which is the default, every agent run emits `invoke_agent`, `chat` and
`execute_tool` spans, `gen_ai.*` metrics, and message events when sensitive
data is on. Most of this page covers the Python packages. The .NET packages
are in [.NET](#net).

:::tip TL;DR

Call `configure_otel_providers()` once at startup, or set your own providers
and call `enable_instrumentation()`. Pass `enable_sensitive_data=True` to
record messages, tool arguments and tool results. The Ollama client leaves
`server.address` as `Unknown` and sets no conversation ID, so add those in a
span processor.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For other Python agent frameworks, see
> [Strands Agents](./strands-agents.md), [Google ADK](./google-adk.md) and
> [OpenAI Agents SDK](./openai-agents-sdk.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running Microsoft Agent Framework who want traces,
  metrics and message events in an OpenTelemetry backend.
- .NET developers wiring `UseOpenTelemetry()` and the framework's source and
  meter into an OTLP pipeline.
- Teams running it on a local model through `agent-framework-ollama`.
- Teams nesting one agent inside another with `as_tool`, who want one trace
  per request across both.

## Overview

- Turn the built-in instrumentation on and send it to a collector.
- Read the span tree of a run, including an agent called as a tool.
- Put a conversation ID and request IDs on spans with a span processor.
- Turn content capture on with sensitive data.
- Recognize a budget stop and a failed tool in a trace.
- Add cost and the real server in a span exporter.

### Signals

| Signal | What Agent Framework emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invoke_agent`, `chat` and `execute_tool` spans. | Request IDs, the conversation ID, prompt versions and the server port through a span processor. Cost in a span exporter. FastAPI, httpx and psycopg spans, and one hand-written span. |
| Metrics | `gen_ai.client.operation.duration`, `gen_ai.client.token.usage` and `agent_framework.function.invocation.duration`. | Application counters and a duration histogram under `base14.filing.*`. `http.server.*` and `http.client.duration`. |
| Logs | Message events for each model call, with sensitive data on. | The OpenTelemetry `LoggingHandler` on the root logger, so every line carries the trace and span ID. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model with tool calling. The Quick Start and the example use Ollama with
  `qwen3.5:9B`.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `agent-framework-core` | 1.19.0 |
| `agent-framework-ollama` | 1.0.0b260813, which pins `ollama` 0.5.3 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-httpx`, `-psycopg`, `-logging` | 0.66b0 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `gemma4:e2b` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst) with `FILING_FRAMEWORK=maf` |

Last verified 2026-09-29 with Agent Framework 1.19.0. The GenAI conventions
are in Development status and `agent-framework-ollama` is a beta, so
attribute names can change between releases. Pin exact versions and re-check
the spans after each upgrade.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add agent-framework-core==1.19.0 \
  agent-framework-ollama==1.0.0b260813 \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install agent-framework-core==1.19.0 \
  agent-framework-ollama==1.0.0b260813 \
  opentelemetry-sdk==1.45.0 \
  opentelemetry-exporter-otlp-proto-http==1.45.0
```

```mdx-code-block
</TabItem>
</Tabs>
```

`agent-framework-core` depends on the OpenTelemetry API only. Install the SDK
and an OTLP exporter to send anything. `configure_otel_providers()` uses gRPC
unless `OTEL_EXPORTER_OTLP_PROTOCOL` says otherwise. For gRPC, install
`opentelemetry-exporter-otlp-proto-grpc` instead.

## Quick Start

This file is a minimal starting point, not part of the example. It sets up
tracing, metrics and logs, turns sensitive data on, and runs one agent with
one tool on Ollama. Save it as `quickstart.py`:

```python showLineNumbers title="quickstart.py"
import asyncio

from agent_framework import Agent, tool
from agent_framework.observability import configure_otel_providers
from agent_framework_ollama import OllamaChatClient
from opentelemetry import metrics, trace

configure_otel_providers(enable_sensitive_data=True)


@tool(approval_mode="never_require")
def order_status(order_id: str) -> str:
    """Return the shipping status of an order."""
    return "shipped" if order_id == "A-100" else "not found"


agent = Agent(
    OllamaChatClient(host="http://localhost:11434", model="qwen3.5:9B"),
    "Look up the order with the order_status tool, then answer in one sentence.",
    name="order-agent",
    tools=[order_status],
)


async def main() -> None:
    result = await agent.run("Where is order A-100?")
    print(result.text)


asyncio.run(main())
trace.get_tracer_provider().shutdown()
metrics.get_meter_provider().shutdown()
```

Pull the model, point the file at your collector and run it:

```bash showLineNumbers title="Terminal"
ollama pull qwen3.5:9B
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_SERVICE_NAME=order-agent
python quickstart.py
```

It prints the answer, for example `Order A-100 has been shipped.` Your
backend then shows one trace for the run under the service `order-agent`:

```text showLineNumbers title="The Quick Start trace"
invoke_agent order-agent
|-- chat qwen3.5:9B              asks for the tool call
|-- execute_tool order_status
`-- chat qwen3.5:9B              writes the answer
```

The three metrics and the message events arrive with the same service name.
The explicit shutdowns flush the metrics before the process exits. If no
trace shows up, check the endpoint and protocol and see
[Troubleshooting](#troubleshooting).

`configure_otel_providers()` sets `service.version` to the Agent Framework
version unless you pass `service_version` or set `OTEL_SERVICE_VERSION`.

## Configuration

`configure_otel_providers()` creates the providers and exporters from the
standard `OTEL_*` variables and turns instrumentation on. Call it once. To
keep providers you already set, call `enable_instrumentation()` instead. The
example sets its providers, with its own exporter wrapper and logging
handler, in `telemetry.py`, then:

```python showLineNumbers title="frameworks/maf.py (condensed)"
def from_settings(settings: Settings) -> MafFramework:
    capture = os.environ.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true").strip().lower() != "false"
    enable_instrumentation(enable_sensitive_data=capture)
    return MafFramework(ollama_clients(settings.ollama_base_url), settings.ollama_think)
```

### Environment Variables

| Variable | Value in the example | Read by |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | `ai-filing-analyst` | The SDK resource. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | The OTLP exporters. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | The OTLP exporters. `configure_otel_providers()` defaults to `grpc`. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | `gen_ai_latest_experimental` | Agent Framework. Selects the latest GenAI conventions, which is also its default. A value without that token selects the v1.36.0 conventions, without tool arguments and results on spans. |
| `ENABLE_INSTRUMENTATION` | Not set. | Agent Framework. Default `true`. |
| `ENABLE_SENSITIVE_DATA` | Not set. The example passes `enable_sensitive_data`. | Agent Framework. Default `false`. |
| `ENABLE_MESSAGE_EVENTS` | Not set. | Agent Framework. Default `true`. Emits message events when sensitive data is on. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `true` | The example, which maps it to `enable_sensitive_data`. Agent Framework does not read it. |
| `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` | `4096` | The SDK. Caps each captured value. |

## What Agent Framework Emits

This is the ranking question from the example, one trace per HTTP request.
The psycopg `SELECT` and `INSERT` spans and the ASGI `http receive` and
`http send` spans are left out.

```text showLineNumbers title="One ranking question"
POST /questions
|-- invoke_agent analyst
|   |-- chat qwen3.5:9B
|   |-- execute_tool rank_among_filers
|   |   `-- invoke_agent ranking
|   |       |-- chat gemma4:e2b
|   |       |-- execute_tool frame_values
|   |       |   `-- GET                    SEC frames API
|   |       `-- chat gemma4:e2b
|   |-- chat qwen3.5:9B
|   `-- execute_tool FilingAnswer          the typed answer
`-- filing.verify_answer                   hand-written
```

Agent Framework emits one `invoke_agent <agent>` per `agent.run`, one
`chat <model>` per model call and one `execute_tool <tool>` per tool call. An
agent attached with `as_tool` runs inside its `execute_tool` span, so both
agents share one trace. When the analyst ends a run in text without calling
`FilingAnswer`, the example runs it once more in the same session with a
reminder, which adds a second `invoke_agent analyst`.

The attributes worth knowing:

- `gen_ai.agent.name`, `gen_ai.agent.id` and `gen_ai.request.model` on
  `invoke_agent`, with the run's total `gen_ai.usage.input_tokens` and
  `gen_ai.usage.output_tokens`.
- `gen_ai.request.model`, `gen_ai.response.model`,
  `gen_ai.response.finish_reasons` and the call's token counts on `chat`.
- `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type` and
  `gen_ai.tool.description` on `execute_tool`.
- With sensitive data on, `gen_ai.system_instructions`,
  `gen_ai.input.messages` and `gen_ai.output.messages` on `invoke_agent` and
  `chat`, `gen_ai.tool.definitions` on `invoke_agent`, and
  `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` on
  `execute_tool`.

`gen_ai.provider.name` is `ollama` on `chat` and `microsoft.agent_framework`
on `invoke_agent`. The Ollama client sets `server.address` to `Unknown` and
no `server.port`.

### Agent Framework Metrics

| Metric | What it measures | Attributes |
| --- | --- | --- |
| `gen_ai.client.operation.duration` | Model call duration. | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `server.address`, and `error.type` on a failed call. |
| `gen_ai.client.token.usage` | Tokens per model call. | The same, without `error.type`, plus `gen_ai.token.type`. |
| `agent_framework.function.invocation.duration` | Tool call duration. | The `execute_tool` span's attributes, `agent_framework.function.name`, and `error.type` on a failed call. |

There is no agent-level duration metric. `invoke_agent` spans carry the run
duration.

`agent_framework.function.invocation.duration` takes the tool span's
attributes, which include `gen_ai.tool.call.id` on every call and
`gen_ai.tool.call.arguments` with sensitive data on. Each tool call then
makes a new time series. Drop those attributes with a metric view or in the
collector before they reach a metrics backend:

```python showLineNumbers title="Keep tool metrics to the tool name"
from opentelemetry.sdk.metrics.view import View

tool_duration = View(
    instrument_name="agent_framework.function.invocation.duration",
    attribute_keys={"gen_ai.operation.name", "gen_ai.tool.name", "gen_ai.tool.type", "error.type"},
)
```

Pass the view in `MeterProvider(views=[...])`, or in
`configure_otel_providers(views=[...])`.

## Message Events

With sensitive data on, Agent Framework also emits the v1.36.0 GenAI message
events as log records under the scope `agent_framework`: `gen_ai.system.message`,
`gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.tool.message` and
`gen_ai.choice`. Each carries the trace and span ID of its `chat` span and
`gen_ai.system=ollama`. Set `ENABLE_MESSAGE_EVENTS=false`, or pass
`enable_message_events=False`, to keep content on the spans only. They need a
global logger provider, which `configure_otel_providers()` sets.

## Request Attributes

Agent Framework sets `gen_ai.conversation.id` only from a session ID that the
model service manages. A local Ollama session has none. The example sets the
question's attributes in a context variable around the run, and a span
processor copies them onto each GenAI span as it starts:

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
The processor also adds `server.port` from the Ollama URL, and the prompt
version and model digest from the span's agent name or model. It keeps any
attribute the framework already set, so `server.address` stays `Unknown`. To
replace it, overwrite it in the processor instead.

## Agents as Tools

`agent.as_tool(name=..., description=...)` wraps an agent as a tool of another agent:

```python showLineNumbers title="frameworks/maf.py (condensed)"
ranking = Agent(
    clients(config.ranking_model),
    config.ranking_prompt.system,
    name="ranking",
    tools=maf_tools(tools.ranking),
    default_options=options,
    middleware=[middleware.chat(analyst=False), middleware.function()],
)
analyst = Agent(
    clients(config.analyst_model),
    analyst_instructions(config, FINISH_RULE),
    name="analyst",
    tools=[
        *maf_tools(tools.analyst),
        *maf_tools([answer_tool(sink)]),
        ranking.as_tool(name="rank_among_filers", description=RANKING_TOOL_DESCRIPTION),
    ],
    default_options=options,
    middleware=[middleware.chat(analyst=True), middleware.function()],
)
```

A tool that fails inside the inner agent shows on its `execute_tool` span with
error status. The outer `execute_tool rank_among_filers` span ends without
error. The example's function middleware rewrites the ranking tool's result:
it appends the frame's facts to the inner agent's reply, or replaces the reply
with a fixed line when the frames fetch failed.

## Structured Output on Ollama

The `response_format` option asks the model for JSON in a schema. The Ollama
client sends it as `format` on every call of the run, so the model can no
longer call a tool. The example gives the analyst a `FilingAnswer` function
tool instead, whose parameters are the answer's fields. Function middleware
ends the run once it is called:

```python showLineNumbers title="frameworks/maf.py (condensed)"
if context.function.name == "FilingAnswer":
    await call_next()
    raise MiddlewareTermination
```

The typed answer shows as `execute_tool FilingAnswer`.

## Budgets

Chat middleware runs before each model call and function middleware before
each tool call. Registered on both agents, they see every call in a run,
including those of an agent called as a tool. The example counts both with a
plain `CallBudget` counter, which raises past the budget:

```python showLineNumbers title="frameworks/maf.py (condensed)"
@chat_middleware
async def on_chat(context: ChatContext, call_next: Next) -> None:
    budget.count_model()  # raises past the budget
    await call_next()


@function_middleware
async def on_function(context: FunctionInvocationContext, call_next: Next) -> None:
    exceeded = budget.count_tool()
    if exceeded is not None:
        raise exceeded
    await call_next()
```

The exception ends `invoke_agent` with error status and `error.type` set to
the exception's class name, `BudgetExceeded`. Agent Framework records the
exception on the span, so the type needs no exporter.

Agent Framework has no wall-clock limit. The example wraps the run in
`asyncio.wait_for`, which cancels it at the deadline. A cancelled run does not
mark `invoke_agent` as an error. The example's server span ends with error
status, a 504 and `base14.filing.outcome=timeout`.

## Logs and Trace Correlation

Apart from the message events, Agent Framework writes to Python logging only.
The example adds the OpenTelemetry `LoggingHandler` to the root logger, as in
[Strands Agents](./strands-agents.md#logs-and-trace-correlation), so every
application log record, including Agent Framework's own, goes to the
collector with the trace ID and span ID of the span it was written under.

## Content Capture

Content capture follows sensitive data, off by default. With
`enable_sensitive_data=True` or `ENABLE_SENSITIVE_DATA=true`, Agent Framework
records messages, system instructions and tool definitions on the spans, tool
arguments and results on `execute_tool`, and the message events. Agent
Framework does not read `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`.
The example maps it to `enable_sensitive_data` so all its frameworks follow
one setting.

## Adding Cost and Error Type with a Span Exporter

The example wraps the OTLP span exporter to add, on the way out:

- `base14.gen_ai.cost` on each `chat` span, from the token counts and a price
  table. A model with no price, such as a local Ollama model, gets 0 and
  `base14.gen_ai.cost.simulated=true`.
- `error.type` on a failed span that has none, from the recorded exception or
  the HTTP status. Agent Framework's own spans already have it.

`gen_ai.provider.name` on `chat` is already `ollama`. See
`CostAndErrorAttributingSpanExporter` in the example's
[`telemetry.py`](https://github.com/base-14/examples/blob/main/python/ai-filing-analyst/src/filing_analyst/telemetry.py).

## .NET

The .NET packages have the same built-in instrumentation, wired differently.
There is no global switch. Each agent is wrapped with `UseOpenTelemetry()`,
and the application registers the framework's source and meter by name.

| Component | Version in the example |
| --- | --- |
| `Microsoft.Agents.AI.OpenAI`, `Microsoft.Agents.AI.Workflows` | 1.23.0 |
| `Microsoft.Extensions.AI` | 10.10.0 |
| `ModelContextProtocol` | 2.2.0 |
| `OpenTelemetry.Extensions.Hosting`, `OpenTelemetry.Exporter.OpenTelemetryProtocol` | 1.19.1 |
| .NET SDK | 10.0.400 |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`agent-rebooking`](https://github.com/base-14/examples/tree/main/csharp/agent-rebooking) on Ollama with `qwen3.5:9b` |

Last verified 2026-10-04 with Agent Framework 1.23.0 for .NET.

### Wrap Each Agent

`UseOpenTelemetry()` goes on the agent builder. The `configure` callback sets
`EnableSensitiveData`, which the example drives from
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`.

```csharp title="AgentRebooking/Agents/AgentSetup.cs" showLineNumbers
        var triage = new ChatClientAgent(
                chatClient,
                new ChatClientAgentOptions
                {
                    Id = TriageAgentId,
                    Name = TriageAgentId,
                    Description = "Classifies traveller messages and routes disruptions to rebooking.",
                    ChatOptions = new ChatOptions { Instructions = TriageInstructions },
                })
            .AsBuilder().UseOpenTelemetry(configure: Capture(captureMessageContent)).Build();
```

```csharp title="AgentRebooking/Agents/AgentSetup.cs"
    private static Action<OpenTelemetryAgent> Capture(bool captureMessageContent) =>
        agent => agent.EnableSensitiveData = captureMessageContent;
```

Instrumentation is per agent: an agent is instrumented only when it is built
through `UseOpenTelemetry()`. The example wraps the agents and not the chat
client, so each model call produces one `chat` span. Wrapping both records
the same call twice.

### Register the Source and the Meter

The framework's `ActivitySource` and `Meter` share one name,
`Experimental.Microsoft.Agents.AI`. `AddSource` gives the spans and `AddMeter`
gives the metrics. Both match by name, so a missing or misspelled name drops
the telemetry without an error.

```csharp title="AgentRebooking/Telemetry/TelemetryRegistration.cs" showLineNumbers
    public static TracerProviderBuilder ConfigureTracing(TracerProviderBuilder tracing) => tracing
        .AddAspNetCoreInstrumentation(o => o.RecordException = true)
        .AddHttpClientInstrumentation()
        // Dropping the MCP name here silently costs every mcp.* attribute and the trace
        // context hop into the server. See Telemetry/Sources.cs.
        .AddSource(Sources.TraceSourceNames);

    public static MeterProviderBuilder ConfigureMetrics(MeterProviderBuilder metrics) => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        // AddMeter matches by name, not by instance, and a mismatch drops measurements silently.
        .AddMeter(Sources.MeterNames)
        .AddView(ApprovalTelemetry.WaitDurationInstrument, new ExplicitBucketHistogramConfiguration
        {
            Boundaries = ApprovalTelemetry.WaitDurationBucketBoundaries,
        });
```

`Sources.TraceSourceNames` and `Sources.MeterNames` both hold
`Experimental.Microsoft.Agents.AI`, `Experimental.ModelContextProtocol`,
`Npgsql` and the example's own `AgentRebooking`.

The exporter is the OTLP exporter, added when an endpoint is set:

```csharp title="AgentRebooking/Program.cs"
if (useOtlpExporter)
{
    builder.Services.AddOpenTelemetry().UseOtlpExporter();
}
```

### What the .NET Packages Emit

| Source or meter | Spans | Metrics |
| --- | --- | --- |
| `Experimental.Microsoft.Agents.AI` | `invoke_agent <name>(<id>)`, `chat <model>`, `execute_tool <tool>` | `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `gen_ai.client.operation.time_to_first_chunk`, `gen_ai.client.operation.time_per_output_chunk` |
| `Experimental.ModelContextProtocol` | `tools/call <tool>`, `tools/list`, `server/discover` | `mcp.client.operation.duration`, `mcp.server.operation.duration` |

`chat` and `invoke_agent` spans carry `gen_ai.provider.name`,
`gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `server.address` and `server.port`.
`invoke_agent` adds `gen_ai.agent.id`, `gen_ai.agent.name` and
`gen_ai.agent.description`. `execute_tool` carries `gen_ai.tool.name`,
`gen_ai.tool.call.id` and, for an MCP tool, `mcp.method.name` and
`mcp.session.id`.

`gen_ai.client.token.usage` is split by `gen_ai.token.type`, and both
histograms carry the provider and the request model, so tokens by model need
no custom code.

The Python metric `agent_framework.function.invocation.duration` has no .NET
counterpart. The two chunk histograms are recorded for streaming calls, which
is how the example calls the model.

### Semantic Conventions in .NET

The .NET packages at 1.23.0 do not read `OTEL_SEMCONV_STABILITY_OPT_IN`.
They emit one set of names, the current ones: `gen_ai.provider.name`, not
`gen_ai.system`. Setting the variable on a .NET service changes nothing.

The Python packages do read it, and `gen_ai_latest_experimental` is their
default. A system with agents in both languages gets the same attribute names
from both as long as the Python side keeps that default.

### Sending to Scout Instead of Application Insights

Microsoft's samples export through the Azure Monitor exporter to Application
Insights. The spans and metrics are standard OpenTelemetry, so changing the
destination means changing the exporter. The example registers the OTLP
exporter and points `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector, which
forwards to Scout. Nothing in the agent code changes.

The .NET Aspire dashboard accepts OTLP as well, so the same exporter setting
works for a local view during development.

For approval gates, trace context across a pause and where the error status
goes in a .NET agent, see
[Agent Approval Gates](../../../guides/ai-observability/agent-approval-gates.md).

## Known Gaps

As of Agent Framework 1.19.0 and `agent-framework-ollama` 1.0.0b260813,
verified 2026-09-29:

- **`server.address` is `Unknown` on Ollama `chat` spans and metrics**, and
  there is no `server.port`. Overwrite them in a span processor.
- **No conversation ID with a local session.** Set
  `gen_ai.conversation.id` in a span processor.
- **The tool duration metric carries `gen_ai.tool.call.id`**, and the tool
  arguments with sensitive data on. Drop them with a metric view.
- **`invoke_agent` reports the provider as `microsoft.agent_framework`.** The
  model's provider is on `chat`.
- **No agent-level duration metric.**
- **`service.version` defaults to the Agent Framework version** with
  `configure_otel_providers()`, even when `OTEL_RESOURCE_ATTRIBUTES` sets one.
  Pass `service_version` or set `OTEL_SERVICE_VERSION`.
- **`response_format` cannot be used with tools on Ollama.** Ollama applies
  the schema to every call. Use a function tool and end the run in
  middleware.
- **`agent-framework-ollama` is a beta.** It pins `ollama` below 0.5.4.
- **Message events use the v1.36.0 names** and `gen_ai.system`, while the
  spans use the latest conventions and `gen_ai.provider.name`.

## What to Look For in Scout

### Follow one request across both agents

Search spans by `gen_ai.conversation.id` or your own request ID attribute.
The trace shows `invoke_agent ranking` under
`execute_tool rank_among_filers`, with its own `chat` spans.

### Find failed runs and why

Filter spans on `status = Error` and group by `error.type`.
`BudgetExceeded` on `invoke_agent` marks a budget stop. A model server that
cannot be reached shows as `ChatClientException` on `chat` and
`invoke_agent`. A timeout leaves `invoke_agent` without error
status. The example's server span ends with error status, a 504 and
`base14.filing.outcome=timeout`.

### Find a tool that failed inside a run that completed

Filter `execute_tool` spans on error status. A tool that raises gets
`error.type` set to the exception's class name, and the error goes back to
the model, so the run can still complete. A failed frames fetch in the
ranking agent shows here as `SecUnavailable`.

### Read tokens by model

Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on `chat`
spans, grouped by `gen_ai.request.model`, or read the
`gen_ai.client.token.usage` metric by `gen_ai.request.model` and
`gen_ai.token.type`. The totals on `invoke_agent` repeat the `chat` counts,
so do not add both.

## Production Patterns

- **Leave sensitive data off for real data.** It is off by default.
- **Cap attribute length.** Tool results can be long. The example sets
  `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=4096`.
- **Keep the tool metric's attributes small** with a view, as in
  [Agent Framework Metrics](#agent-framework-metrics).
- **Bound every run twice.** A call budget in middleware stops a loop, and
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
Agent Framework:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-filing-analyst
cp .env.example .env
ollama pull qwen3.5:9B
ollama pull gemma4:e2b
make docker-up FRAMEWORK=maf
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
`FILING_FAULTS_ENABLED=true make docker-up FRAMEWORK=maf`.

## Troubleshooting

### No agent spans

Nothing set a tracer provider. Call `configure_otel_providers()`, or set your
own and call `enable_instrumentation()`. If `ENABLE_INSTRUMENTATION=false` or
`disable_instrumentation()` was called, pass `force=True`.

### Spans but no metrics

The process exited before the periodic metric export. Shut the meter
provider down before exit, as the Quick Start does.

### Nothing arrives at the collector

`configure_otel_providers()` defaults to gRPC. For port 4318, set
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` and install the HTTP exporter.

### No messages on spans

Sensitive data is off. Pass `enable_sensitive_data=True` or set
`ENABLE_SENSITIVE_DATA=true`.

### No tool arguments or results on `execute_tool`

`OTEL_SEMCONV_STABILITY_OPT_IN` is set without `gen_ai_latest_experimental`,
which selects the v1.36.0 conventions. Add the token.

## FAQ

### Does Microsoft Agent Framework support OpenTelemetry?

Yes, the Agent Framework Python packages have OpenTelemetry built in and on
by default.
`configure_otel_providers()` sets up the exporters, or you can bring your own
providers.

### Which spans does an Agent Framework run produce?

One `invoke_agent <agent>` per run, one `chat <model>` per model call and one
`execute_tool <tool>` per tool call.

### How do I turn on prompt capture in Agent Framework?

Pass `enable_sensitive_data=True` to `configure_otel_providers()` or
`enable_instrumentation()`, or set `ENABLE_SENSITIVE_DATA=true`.

### How do I set the conversation ID in Agent Framework?

Agent Framework sets `gen_ai.conversation.id` only from a service-managed
session ID. With a local model, add it in a span processor, as in
[Request Attributes](#request-attributes).

### Does Agent Framework record cost?

No, Agent Framework records token counts but not cost. Add a cost attribute in
a span exporter, as in
[Adding Cost and Error Type](#adding-cost-and-error-type-with-a-span-exporter).

### How do I trace one Agent Framework agent calling another?

Attach the inner agent with `as_tool`. It runs inside the outer agent's
`execute_tool` span, so both share one trace.

### How do I enable OpenTelemetry in Microsoft Agent Framework for .NET?

Build each agent through `.AsBuilder().UseOpenTelemetry().Build()` and
register `Experimental.Microsoft.Agents.AI` with both `AddSource` and
`AddMeter`. The source gives `invoke_agent`, `chat` and `execute_tool` spans
and the meter gives the `gen_ai.client.*` histograms. See [.NET](#net).

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [Google ADK](./google-adk.md) - the same example on ADK.
- [OpenAI Agents SDK](./openai-agents-sdk.md) - the same example on the
  OpenAI Agents SDK.
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
`FILING_FRAMEWORK=maf` runs it on Agent Framework.

```text showLineNumbers
ai-filing-analyst/
|-- prompts/                  analyst and ranking prompts, named by UTC timestamp
|-- scripts/
|   |-- test-api.sh           seventeen scenarios
|   `-- verify-scout.sh       checks the run's telemetry in the collector output
`-- src/filing_analyst/
    |-- telemetry.py          providers, logging, run attributes, cost and error attributes
    |-- frameworks/maf.py     the two agents, middleware, answer tool
    |-- agents.py             what every framework adapter shares
    |-- budget.py             the call budget counter
    |-- tools.py              query_facts, compute_ratio, frame_values
    `-- verifier.py           the grounding check
```

Source:
[`python/ai-filing-analyst`](https://github.com/base-14/examples/tree/main/python/ai-filing-analyst).

## References

- [Agent Framework observability](https://learn.microsoft.com/en-us/agent-framework/agents/observability).
- [agent-framework-core](https://pypi.org/project/agent-framework-core/).
- [agent-framework-ollama](https://pypi.org/project/agent-framework-ollama/).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
