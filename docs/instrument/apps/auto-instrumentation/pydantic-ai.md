---
title:
  Pydantic AI OpenTelemetry Instrumentation - Built-In GenAI Agent Spans
sidebar_label: Pydantic AI
sidebar_position: 7.5
description:
  Trace Pydantic AI agents with OpenTelemetry and no Logfire. Agent, model and
  tool spans, token metrics, content capture and prompt versions on Ollama.
keywords:
  [
    pydantic ai opentelemetry,
    pydantic ai tracing,
    pydantic ai instrumentation,
    pydantic ai without logfire,
    Agent.instrument_all,
    InstrumentationSettings,
    pydantic ai token usage metrics,
    gen_ai.client.token.usage,
    pydantic ai output validation retry,
    pydantic ai ollama,
    OllamaProvider tracing,
    genai semantic conventions python,
    llm observability python,
    ai agent monitoring python,
    invoke_agent chat execute_tool spans,
    prompt version tracing,
  ]
---

# Pydantic AI

Pydantic AI has OpenTelemetry instrumentation built in. Call
`Agent.instrument_all` once at startup and every agent run emits GenAI spans
for the run, each model request and each tool call, plus a token usage
metric. It writes to whichever tracer and meter providers are installed, so
it works with the plain OpenTelemetry SDK and needs no Logfire account.

The examples come from a KYC (know your customer) onboarding service with two
agents on local Ollama models. An extraction agent reads one identity
document and returns typed fields. An assessment agent calls three tools to
check expiry, identity and sanctions, then approves, asks for documents again
or escalates to a reviewer. In the example both agents run inside Temporal
workflows; this page covers what applies to any Pydantic AI agent. For the
durable setup, see [Pydantic AI on Temporal](./pydantic-ai-temporal.md).

:::tip TL;DR

Set up an OpenTelemetry tracer and meter provider, then call
`Agent.instrument_all(InstrumentationSettings(include_content=...))`. Each run
emits `invoke_agent <agent>`, `chat <model>` and `execute_tool <tool>` spans
and records `gen_ai.client.token.usage`. Pass `conversation_id` and `metadata`
to `agent.run` to tie spans to your own IDs and prompt versions.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For other Python agent frameworks, see [LangChain](./langchain.md) and
> [LangGraph](./langgraph.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Python developers running Pydantic AI agents who want traces in an
  OpenTelemetry backend rather than Logfire.
- Teams running local models through Ollama who want the same spans and
  token metrics as with a hosted provider.
- Teams that version their prompts and want the version on every agent span.

## Overview

- Turn on Pydantic AI instrumentation over the plain OpenTelemetry SDK.
- Control prompt and completion capture with an environment variable.
- Read the `invoke_agent`, `chat` and `execute_tool` span tree.
- Use the `gen_ai.client.token.usage` metric.
- Recognise an output validation retry in a trace.
- Carry a prompt version in run `metadata`.
- Turn thinking off for Ollama models.

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- Ollama with a model that supports tool calls pulled. The Quick Start uses
  `qwen3.5:9B`. No provider API key is needed for Ollama.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `pydantic-ai-slim` | 2.49.0, with the `openai` extra |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.44.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.44.0 |
| `opentelemetry-instrumentation-fastapi`, `-psycopg`, `-logging` | 0.65b0 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| OTel Collector contrib | 0.161.0 |
| Example | [`ai-kyc-onboarding`](https://github.com/base-14/examples/tree/main/python/ai-kyc-onboarding) |

Pydantic AI releases almost daily. Pin an exact version and re-check the
instrumentation when you upgrade.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="uv" label="uv" default>
```

```bash showLineNumbers title="Terminal"
uv add "pydantic-ai-slim[openai]==2.49.0" \
  opentelemetry-sdk==1.44.0 \
  opentelemetry-exporter-otlp-proto-http==1.44.0
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash showLineNumbers title="Terminal"
pip install "pydantic-ai-slim[openai]==2.49.0" \
  opentelemetry-sdk==1.44.0 \
  opentelemetry-exporter-otlp-proto-http==1.44.0
```

```mdx-code-block
</TabItem>
</Tabs>
```

The `openai` extra covers `OllamaProvider`, which talks to Ollama's
OpenAI-compatible endpoint. The example also installs the `temporal` extra,
which you only need for [durable agents](./pydantic-ai-temporal.md).

## Quick Start

This file is a minimal starting point, not part of the example. It sets up
tracing and metrics, turns on Pydantic AI instrumentation and runs one agent
with one tool on Ollama. Save it as `quickstart.py`:

```python showLineNumbers title="quickstart.py"
import asyncio

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from pydantic_ai import Agent, InstrumentationSettings
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.ollama import OllamaProvider

tracer_provider = TracerProvider()
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)

meter_provider = MeterProvider(metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())])
metrics.set_meter_provider(meter_provider)

Agent.instrument_all(InstrumentationSettings(include_content=True))

model = OpenAIChatModel(
    "qwen3.5:9B",
    provider=OllamaProvider(base_url="http://localhost:11434/v1"),
    settings=OpenAIChatModelSettings(openai_reasoning_effort="none"),
)
agent = Agent(
    model,
    name="order-agent",
    instructions="Look up the order with the order_status tool, then answer in one sentence.",
)


@agent.tool_plain
def order_status(order_id: str) -> str:
    """Return the shipping status of an order."""
    return "shipped" if order_id == "A-100" else "not found"


async def main() -> None:
    result = await agent.run(
        "Where is order A-100?",
        conversation_id="order-A-100",
        metadata={"prompt_version": "v1"},
    )
    print(result.output)


asyncio.run(main())
tracer_provider.shutdown()
meter_provider.shutdown()
```

Pull the model, point the file at your collector and run it:

```bash showLineNumbers title="Terminal"
ollama pull qwen3.5:9B
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=order-agent
python quickstart.py
```

It prints the answer, for example `Order A-100 has been shipped.` The
exporters post to `/v1/traces` and `/v1/metrics` under
`OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_SERVICE_NAME` sets `service.name`.
Your backend then shows one trace for the run, with the service name you set:

```text showLineNumbers title="The Quick Start trace"
invoke_agent order-agent
|-- chat qwen3.5:9B                 asks for the tool call
|-- execute_tool order_status
`-- chat qwen3.5:9B                 writes the answer
```

Every span carries `gen_ai.conversation.id=order-A-100`, and
`invoke_agent` carries the `metadata` JSON. The metric
`gen_ai.client.token.usage` arrives with the same service name. If no trace
shows up, check the endpoint and see [Troubleshooting](#troubleshooting).

## Configuration

This section explains the parts of the Quick Start file and what the example
adds.

```mdx-code-block
<Tabs>
<TabItem value="setup" label="Telemetry Setup" default>
```

- **`TracerProvider` with `BatchSpanProcessor(OTLPSpanExporter())`** exports
  spans in batches on a background thread, off the request path.
- **`MeterProvider` with `PeriodicExportingMetricReader(OTLPMetricExporter())`**
  exports the token metric. Without a meter provider, Pydantic AI records no
  metric.
- **`Agent.instrument_all`** applies to every agent that does not set its own
  instrumentation. Call it before the first run.
- **`InstrumentationSettings`** uses the global tracer and meter providers
  unless you pass `tracer_provider` or `meter_provider`. `include_content`
  turns prompt and completion capture on or off.
- **`shutdown()`** on both providers flushes what is still buffered. A
  long-running service calls it on exit.

The example adds two things. It sets `include_content` from an environment
variable, as shown in [Content Capture](#content-capture):

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
def configure_instrumentation() -> None:
    Agent.instrument_all(InstrumentationSettings(include_content=_capture_content_enabled()))
```

It also wraps the OTLP span exporter in its own
`CostAndErrorAttributingSpanExporter`. See
[Cost and error type](#cost-and-error-type). For the tracer provider a
Temporal worker needs, see
[Pydantic AI on Temporal](./pydantic-ai-temporal.md#configuration).

```mdx-code-block
</TabItem>
<TabItem value="agent" label="Agent and Model">
```

The agent's `name` and the model settings end up on the spans. The example's
extraction agent, with its Ollama model and profile:

```python showLineNumbers title="src/kyc_onboarding/agents/extraction.py (excerpt, simplified)"
provider = OllamaProvider(base_url=f"{base_url}/v1")
profile = OpenAIModelProfile(
    supports_json_object_output=False,
    openai_chat_supports_max_completion_tokens=False,
    json_schema_transformer=OpenAIJsonSchemaTransformer,
)
model = OpenAIChatModel(
    model_name,
    provider=provider,
    settings=OpenAIChatModelSettings(
        openai_reasoning_effort="none", temperature=TEMPERATURE, max_tokens=MAX_TOKENS
    ),
    profile=profile,
)

Agent(
    model,
    name="kyc-extraction",
    description="Reads one KYC document and returns its fields for that document type.",
    retries={"output": OUTPUT_RETRIES},
    output_type=[
        ExtractedIdFields,
        ExtractedProofOfAddressFields,
        ExtractedRegistrationCertificateFields,
    ],
    instructions=instructions,
)
```

- **`name`** becomes `gen_ai.agent.name` and the span name
  `invoke_agent kyc-extraction`.
- **`description`** becomes `gen_ai.agent.description`.
- **`OllamaProvider`** sets `gen_ai.provider.name` to `ollama`.
- **`temperature` and `max_tokens`** are recorded as
  `gen_ai.request.temperature` and `gen_ai.request.max_tokens`.
- **The model profile** settings are explained in
  [Thinking Off for Ollama](#thinking-off-for-ollama).

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

The Quick Start reads `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_SERVICE_NAME`.
The example also reads its model names and prompt versions from the
environment:

```bash showLineNumbers title=".env.example (excerpt)"
OLLAMA_BASE_URL=http://host.docker.internal:11434
EXTRACTION_MODEL=gemma4:e2b
ASSESSMENT_MODEL=qwen3.5:9B
EXTRACTION_PROMPT_VERSION=v1
ASSESSMENT_PROMPT_VERSION=v3
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

`OLLAMA_BASE_URL` has no `/v1`; the code adds it. On the host, use
`http://localhost:11434` and `http://localhost:4318`. The OTLP exporters read
`OTEL_EXPORTER_OTLP_ENDPOINT` and add each signal's path.

```mdx-code-block
</TabItem>
</Tabs>
```

## What Pydantic AI Emits

One assessment run, with the tool calls it is required to make:

```text showLineNumbers title="One assessment agent run"
invoke_agent kyc-assessment
|-- chat qwen3.5:9B
|-- execute_tool compare_identity
|-- execute_tool screen_sanctions
|-- execute_tool check_expiry
|-- chat qwen3.5:9B
`-- execute_tool decision_from_answer     the answer, checked by the output function
```

| Span | One per |
| --- | --- |
| `invoke_agent <agent name>` | Agent run. |
| `chat <model>` | Model request. |
| `execute_tool <tool name>` | Tool call, and the output function when the agent has one. |

The extraction agent has no tools, so its run is `invoke_agent
kyc-extraction` with one `chat gemma4:e2b` child, or more when the output is
retried.

The GenAI attributes follow the OpenTelemetry GenAI semantic conventions,
which are in Development status as of September 2026, so names can change.
The keys worth knowing:

| Attribute | On | Value |
| --- | --- | --- |
| `gen_ai.conversation.id` | Every GenAI span | The `conversation_id` passed to `agent.run`. |
| `gen_ai.agent.name`, `gen_ai.agent.description` | `invoke_agent` | From the agent's `name` and `description`. |
| `gen_ai.provider.name` | `chat` | `ollama` with `OllamaProvider`. |
| `gen_ai.request.model`, `gen_ai.response.model` | `chat` | Requested and returned model. |
| `gen_ai.request.temperature`, `gen_ai.request.max_tokens` | `chat` | From the model settings. |
| `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `chat` | Tokens for one request. |
| `gen_ai.aggregated_usage.*` | `invoke_agent` | Tokens for the whole run. |
| `gen_ai.response.finish_reasons` | `chat` | Why the model stopped. |
| `gen_ai.tool.name`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | `execute_tool` | Tool name, arguments and result. |
| `server.address`, `server.port` | `chat` | The Ollama endpoint. |
| `metadata` | `invoke_agent` | The run `metadata`, as one JSON string. |

Run totals use `gen_ai.aggregated_usage.*`, not `gen_ai.usage.*`, so a
backend that sums `gen_ai.usage.input_tokens` across spans does not count
each request twice. `gen_ai.aggregated_usage.*` is Pydantic AI's own
namespace, not part of the conventions.

Pass the ID you want to search by as `conversation_id`. The example passes the
case ID on every run, so one filter on `gen_ai.conversation.id` finds every
model call for a case:

```python showLineNumbers title="src/kyc_onboarding/workflows.py (excerpt)"
result = await agents.extraction.run(
    prompt,
    usage=self._usage,
    usage_limits=self._usage_limits(EXTRACTION_RUN_REQUEST_LIMIT),
    metadata={PROMPT_VERSION_METADATA_KEY: self._input.extraction_prompt_version},
    conversation_id=self._case.case_id,
)
```

## Token Usage Metrics

Pydantic AI records `gen_ai.client.token.usage`, a histogram in `{token}`,
once per model request and token type. Each data point carries
`gen_ai.token.type` (`input` or `output`) with the model and provider
attributes of the request. It records through the global meter provider
unless you pass `meter_provider` to `InstrumentationSettings`, so a process
with no meter provider records nothing.

## Content Capture

With `include_content=True`, Pydantic AI records system instructions,
prompts, completions, tool arguments and tool results on its spans, in
`gen_ai.system_instructions`, `gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.tool.call.arguments` and
`gen_ai.tool.call.result`.

Pydantic AI does not read `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
itself. The example maps it onto `include_content`:

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
def _capture_content_enabled() -> bool:
    return (
        os.environ.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true").lower()
        != "false"
    )
```

The example defaults to `true` because its documents are synthetic. With
`include_content=False`, the message attributes are still present but hold no
prompt or completion text. Token counts and the other attributes are recorded
either way.

## Output Validation Retries

When a response fails validation, Pydantic AI sends the model a retry prompt
and makes another request. Each request is its own `chat` span under the same
`invoke_agent`. A retried extraction run looks like this:

```text showLineNumbers title="An extraction run with one output retry"
invoke_agent kyc-extraction
|-- chat gemma4:e2b      the response was plain text, not the output tool call
`-- chat gemma4:e2b      input carries the retry prompt
```

The first `chat` span has no error status. The retry shows only as the extra
span, and the second span's `gen_ai.input.messages` holds the retry prompt
when content capture is on. `retries={"output": 2}` allows two retries.
After that the run raises `UnexpectedModelBehavior`, which the example's
workflow turns into an escalation with reason `invalid_output`.

The assessment agent's output function raises `ModelRetry` for the same
effect. It sends the answer back when a required tool has not returned yet:

```python showLineNumbers title="src/kyc_onboarding/agents/assessment.py (excerpt)"
missing = missing_tool_calls(ctx)
if missing:
    raise ModelRetry(
        "Before deciding, call the tools that have not returned a result yet: "
        f"{', '.join(missing)}."
    )
```

To count retries, count the `chat` children of an `invoke_agent` span. A run
with no retries and no tools has one.

## Prompt Version in Run Metadata

Pass the prompt version in `metadata` on each run. Pydantic AI records the
whole `metadata` dict as one JSON attribute, `metadata`, on `invoke_agent`.
The example loads versioned prompts from `prompts/extraction_v1.yaml` and
`prompts/assessment_v3.yaml`, chosen by `EXTRACTION_PROMPT_VERSION` and
`ASSESSMENT_PROMPT_VERSION`, and passes the version on every run:

```python showLineNumbers
metadata={PROMPT_VERSION_METADATA_KEY: self._input.assessment_prompt_version}
```

A JSON string is awkward to filter on, so the example's span exporter copies
the version out into a flat `base14.prompt.version` attribute on
`invoke_agent`:

```python showLineNumbers title="src/kyc_onboarding/telemetry.py (excerpt)"
def _prompt_version_attributes(
    attributes: Mapping[str, AttributeValue],
) -> dict[str, AttributeValue]:
    if attributes.get(GEN_AI_OPERATION_ATTRIBUTE) != INVOKE_AGENT_OPERATION_NAME:
        return {}
    try:
        metadata = json.loads(str(attributes.get(RUN_METADATA_ATTRIBUTE)))
    except ValueError:
        return {}
    if not isinstance(metadata, dict) or PROMPT_VERSION_METADATA_KEY not in metadata:
        return {}
    return {PROMPT_VERSION_ATTRIBUTE: str(metadata[PROMPT_VERSION_METADATA_KEY])}
```

## Cost and Error Type

Pydantic AI records token counts but no cost. To add cost, or any attribute
derived from Pydantic AI's own, wrap the span exporter. Pydantic AI owns its
spans and a finished span cannot be changed, so the wrapper rebuilds each
GenAI span it changes on the way out and passes the rest through.

A wrapper can add:

- **A cost attribute on `chat`**, from `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens` and a price table keyed by
  `gen_ai.request.model`.
- **A simulated flag** when the model has no row in the table, so a zero cost
  from a local model is not read as a real price.
- **A flat prompt version** on `invoke_agent`, copied out of `metadata` as
  above.
- **`error.type`** on `chat` and `invoke_agent` spans with error status, from
  the span's first recorded exception.

The example's `CostAndErrorAttributingSpanExporter` does all four. It writes
`base14.gen_ai.cost` and `base14.gen_ai.cost.simulated` from the prices in
`_shared/pricing.json`, and a run that hits a usage limit gets
`error.type=pydantic_ai.exceptions.UsageLimitExceeded`. Use your own prefix
for application attributes. `gen_ai.` belongs to the semantic conventions.

## Thinking Off for Ollama

Reasoning models on Ollama think before they answer unless told not to.
`openai_reasoning_effort="none"` in the model settings tells the model not to
produce reasoning tokens, as in the Quick Start. Three more settings in the
model profile matter on Ollama:

- **`supports_json_object_output=False`** stops `PromptedOutput` from sending
  a `response_format`. With one set, Ollama never returns a tool call.
- **`openai_chat_supports_max_completion_tokens=False`** sends the cap as
  `max_tokens`, which Ollama reads. It ignores `max_completion_tokens`.
- **`json_schema_transformer=OpenAIJsonSchemaTransformer`** keeps `format`
  in the output schema. `OllamaProvider` picks a profile by model name, and
  for Gemma models that profile's JSON schema transformer removes
  `format: date` and moves it into the field description. The model may
  then leave date fields empty.

## Running Your Application

Run `quickstart.py` as shown in [Quick Start](#quick-start), or call
`Agent.instrument_all` at startup in your own service. The example runs both
agents inside Temporal; see
[Running Your Application](./pydantic-ai-temporal.md#running-your-application)
on the durable page for its commands.

## Troubleshooting

### No GenAI spans

`Agent.instrument_all` was not called, or the agent sets its own
instrumentation, which takes precedence. Call it once at startup.

### Spans appear but no token metric

No meter provider with an exporting reader is installed. Set a
`MeterProvider` with a `PeriodicExportingMetricReader`, as in
[Configuration](#configuration).

### Date fields come back empty

One cause: a Gemma model on `OllamaProvider`, whose profile moves
`format: date` out of the schema. Set
`json_schema_transformer=OpenAIJsonSchemaTransformer` on an
`OpenAIModelProfile`, as in [Agent and Model](#configuration).

### The model never calls a tool

A `response_format` is being sent with the tool definitions, and Ollama does
not return tool calls under one. Avoid `NativeOutput`, and set
`supports_json_object_output=False` on the model profile when you use
`PromptedOutput`.

### `gen_ai.provider.name` is not `ollama`

The model uses the plain OpenAI provider with a custom base URL. Use
`OllamaProvider`.

## Security Considerations

- **Content capture records applicant data.** KYC prompts carry names, dates
  of birth and addresses. Set
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` for real data, or
  scrub in the collector with the `attributes` or `transform` processor.
- **Tool results are content too.** With capture on,
  `gen_ai.tool.call.result` on `execute_tool screen_sanctions` carries the
  nearest sanctions list entry's name, even for a `clear` result.
- **Keep identifiers, not names, in your own attributes.** The example puts
  the sanctions result and score on spans, never the matched name.

## Performance Considerations

- Each model request adds one `chat` span and each tool call one
  `execute_tool` span. Output retries add spans.
- Content capture copies the whole conversation into each `chat` span, and a
  tool loop resends the conversation on every request.
- An exporter wrapper like the one in
  [Cost and error type](#cost-and-error-type) does one price lookup and one
  JSON parse per GenAI span it changes.
- Spans export from a `BatchSpanProcessor`, off the request path.

## FAQ

### Does Pydantic AI need Logfire for OpenTelemetry tracing?

No. `Agent.instrument_all(InstrumentationSettings())` writes to the global
OpenTelemetry tracer and meter providers, so any OTLP exporter and backend
works.

### Which spans does a Pydantic AI agent run produce?

One `invoke_agent <agent>` span per run, one `chat <model>` span per model
request and one `execute_tool <tool>` span per tool call. An output function
also shows as an `execute_tool` span.

### How do I turn off prompt and completion capture in Pydantic AI?

Pass `include_content=False` to `InstrumentationSettings`. Pydantic AI does not
read `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`, so map the variable
yourself as the example does.

### Does Pydantic AI record token usage metrics?

Yes. It records the `gen_ai.client.token.usage` histogram per model request,
split by `gen_ai.token.type`.

### How do I see an output validation retry in a Pydantic AI trace?

Count the `chat` spans under the `invoke_agent` span. A retry adds one, and
its input messages carry the retry prompt. The first attempt has no error
status.

### How do I tag Pydantic AI spans with a prompt version?

Pass it in `metadata` on `agent.run`. Pydantic AI records `metadata` as one
JSON attribute on `invoke_agent`. To filter on it, copy the value into a flat
attribute in a span exporter wrapper.

### How do I group all model calls of one request or case?

Pass your ID as `conversation_id` to `agent.run`. It is recorded as
`gen_ai.conversation.id` on every GenAI span of the run.

### Does Pydantic AI record cost?

No. Pydantic AI records token counts, not cost. To add a cost attribute,
wrap the span exporter and compute it from the token counts and a price
table, as in [Cost and error type](#cost-and-error-type).

### How do I run Pydantic AI agents durably with tracing?

Give each agent the `TemporalDurability` capability and use Temporal's
`OpenTelemetryPlugin` with a replay-safe tracer provider. See
[Pydantic AI on Temporal](./pydantic-ai-temporal.md).

## What's Next?

### Related Guides

- [Pydantic AI on Temporal](./pydantic-ai-temporal.md) - durable agents, one
  trace across replay and worker restarts.
- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [LangChain](./langchain.md) - the same GenAI spans from a callback handler.
- [FastAPI](./fast-api.md) - the HTTP service in front of the agents.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - alert on
  token usage or failed runs.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - chart
  tokens and cost by model.

## Complete Example

```text showLineNumbers
ai-kyc-onboarding/
|-- prompts/                     versioned extraction and assessment prompts
`-- src/kyc_onboarding/
    |-- telemetry.py             providers, instrument_all, cost and error attributes
    `-- agents/
        |-- extraction.py        Ollama model, extraction agent
        |-- assessment.py        assessment agent, output function
        |-- tools.py             check_expiry, compare_identity, screen_sanctions
        `-- prompts.py           prompt loading, metadata key
```

Source:
[`python/ai-kyc-onboarding`](https://github.com/base-14/examples/tree/main/python/ai-kyc-onboarding).

## References

- [Pydantic AI Logfire integration](https://pydantic.dev/docs/ai/integrations/logfire/),
  which also covers plain OpenTelemetry.
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai).
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/).
