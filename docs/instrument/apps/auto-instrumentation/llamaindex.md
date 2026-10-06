---
title:
  LlamaIndex OpenTelemetry Instrumentation - GenAI SDK Tracing for LLM Calls
sidebar_label: LlamaIndex
sidebar_position: 7
description:
  Trace LlamaIndex LLM calls with the official OpenTelemetry GenAI SDK packages,
  then add cost, request context and PII scrubbing for base14 Scout.
keywords:
  [
    llamaindex opentelemetry instrumentation,
    llamaindex tracing,
    llamaindex observability,
    opentelemetry llamaindex python,
    llamaindex ollama opentelemetry,
    openailike opentelemetry,
    opentelemetry-instrumentation-genai-openai,
    llamaindex token tracking,
    llm cost monitoring,
    genai semantic conventions,
    llamaindex structured output,
    pii scrubbing telemetry,
    promptfoo evaluation,
    openllmetry llamaindex alternative,
    multi-provider llm,
  ]
---

# LlamaIndex

Trace a LlamaIndex application's model calls with OpenTelemetry. There is no
official LlamaIndex instrumentation, but LlamaIndex's OpenAI, OpenAI-compatible,
Anthropic and Google integrations call those vendors' SDKs, and the official
OpenTelemetry GenAI packages for the SDKs trace every call: a `chat {model}`
(`generate_content {model}` for the Google Gen AI SDK) span with the model and
tokens, and the `gen_ai.client.*` metrics.

The application adds what the packages cannot know: which endpoint and content
a call served, the real provider behind an OpenAI-compatible endpoint, the
cost, and scrubbing of captured content. Local Ollama models are reached
through Ollama's OpenAI-compatible endpoint with LlamaIndex's `OpenAILike`, so
the OpenAI package traces them too.

The example is a content quality service: a FastAPI app that reviews, improves
and scores text with structured LLM output, versioned YAML prompts and
Promptfoo evaluations.

:::tip TL;DR

Install `opentelemetry-instrumentation-genai-openai`, plus the Anthropic and
Google packages if you use them, and call `instrument()` after setting up the
tracer provider. Build Ollama models with `OpenAILike` on
`http://localhost:11434/v1`. Add request context, the provider and cost in a
span processor and exporter, and keep content capture at `no_content`.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- **AI/ML engineers** building on LlamaIndex who need model, tokens, cost and
  quality per call.
- **Backend developers** serving LlamaIndex behind FastAPI who want one trace
  across HTTP and model calls.
- **Teams on local models** who want Ollama calls traced like hosted ones.
- **Teams comparing OpenLLMetry or OpenInference** with the official packages.

## Overview

- Trace LlamaIndex model calls with the official GenAI SDK packages.
- Route Ollama through `OpenAILike` so the OpenAI package covers it.
- Add the request context, the provider and the cost to the packages' spans.
- Count retries, fallbacks and errors, with one span per attempt.
- Record evaluation results and scrub captured content.

### Signals

| Signal | What the instrumentation emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | A `chat {model}` span per SDK call from the OpenAI and Anthropic packages, `generate_content {model}` from the Google package, and FastAPI spans. LlamaIndex itself emits none. | The endpoint, content type and length, `ollama` as the provider and `base14.gen_ai.cost_usd` on chat spans; `gen_ai.evaluation.result` and `provider_fallback` events. |
| Metrics | `gen_ai.client.token.usage` and `gen_ai.client.operation.duration`. | `base14.gen_ai.cost`, `.retry.count`, `.fallback.count`, `.error.count` and `.evaluation.score`; HTTP request metrics. |
| Logs | None. | OTLP log records from the application's logging, with the trace ID. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model. The Quick Start and the example use Ollama with `qwen3.5:9B`, which
  needs no API key; OpenAI, Anthropic and Gemini are configurable.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `llama-index-core` | 0.14.24 |
| `llama-index-llms-openai-like` | 0.8.1 |
| `llama-index-llms-openai`, `-anthropic`, `-google-genai` | 0.8.0, 0.12.0, 0.11.0 |
| `openai`, `anthropic`, `google-genai` | 2.54.0, 0.125.0, 2.28.0 |
| `opentelemetry-instrumentation-genai-openai`, `-genai-anthropic` | 1.2b0 |
| `opentelemetry-instrumentation-google-genai` | 1.2b0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-logging` | 0.66b0 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-content-quality`](https://github.com/base-14/examples/tree/main/python/ai-content-quality) |

Last verified 2026-10-06: the example's verify script passed against Ollama
`qwen3.5:9B` with content capture off and with `span_only`, and the Quick Start
ran against a local collector. The GenAI packages are beta and always emit the
latest experimental conventions, so pin exact versions and re-check the spans
after each upgrade.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
pip install \
  llama-index-core llama-index-llms-openai-like \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-openai
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
uv add \
  llama-index-core llama-index-llms-openai-like \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-openai
```

```mdx-code-block
</TabItem>
</Tabs>
```

Add `opentelemetry-instrumentation-genai-anthropic` for
`llama-index-llms-anthropic` and `opentelemetry-instrumentation-google-genai`
for `llama-index-llms-google-genai`. LlamaIndex's own Ollama integration,
`llama-index-llms-ollama`, calls the `ollama` client, which no package traces;
use `OpenAILike` instead.

## Quick Start

One chat call to Ollama through `OpenAILike`, traced to a local collector on
`localhost:4318`.

```python showLineNumbers title="quickstart.py"
from llama_index.core.llms import ChatMessage
from llama_index.llms.openai_like import OpenAILike
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

resource = Resource.create({"service.name": "llamaindex-quickstart"})
tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)
meter_provider = MeterProvider(
    resource=resource, metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())]
)
metrics.set_meter_provider(meter_provider)

OpenAIInstrumentor().instrument()

llm = OpenAILike(
    model="qwen3.5:9B",
    api_base="http://localhost:11434/v1",
    api_key="ollama",
    is_chat_model=True,
    max_retries=0,
    additional_kwargs={"reasoning_effort": "none"},
)
response = llm.chat(
    [ChatMessage(role="user", content="Suggest a clearer title for: 'Thoughts on stuff'")]
)
print(response.message.content)

tracer_provider.shutdown()
meter_provider.shutdown()
```

The collector receives one `chat qwen3.5:9B` span with
`gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, and
`server.address` and `server.port` for Ollama, plus the
`gen_ai.client.token.usage` and `gen_ai.client.operation.duration` metrics.
Its `gen_ai.provider.name` is `openai`; see
[Adding Context, Provider and Cost](#adding-context-provider-and-cost).

`reasoning_effort` is passed through to Ollama's OpenAI-compatible endpoint;
`none` asks a thinking model to answer without a reasoning phase. Drop it for
models that do not reason.

## Configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint of the collector. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `no_content` | `no_content`, `span_only`, `event_only` or `span_and_event`. `true` and `false` are not valid: the packages log a warning and capture nothing. |

The packages read the capture mode once, when instrumented, and do not read
`OTEL_SEMCONV_STABILITY_OPT_IN`. The example reads its own `SERVICE_NAME` and
`OTLP_ENDPOINT` settings and passes them to the SDK.

Through Ollama's OpenAI-compatible endpoint, LlamaIndex cannot set the context
size per call. `context_window` on `OpenAILike` only tells LlamaIndex how much
room it has; the Ollama server's `OLLAMA_CONTEXT_LENGTH` decides what it
allocates.

## Model Calls

The example builds each provider's LlamaIndex model with the SDK's own retries
off, and reaches Ollama through its `/v1` endpoint:

```python showLineNumbers title="src/content_quality/services/llm.py"
    if provider == "ollama":
        from llama_index.llms.openai_like import OpenAILike

        # Ollama's OpenAI-compatible endpoint, so the OpenAI instrumentation traces it.
        return OpenAILike(  # type: ignore[no-any-return]
            model=model,
            api_base=f"{ollama_base_url.rstrip('/')}/v1",
            api_key="ollama",
            is_chat_model=True,
            context_window=ollama_context_window,
            temperature=temperature,
            timeout=timeout,
            max_retries=0,
            additional_kwargs={} if ollama_reasoning else {"reasoning_effort": "none"},
        )
```

Each SDK call is one `chat {model}` CLIENT span (`generate_content {model}` for
the Google Gen AI SDK) carrying `gen_ai.operation.name`, `gen_ai.provider.name`,
`gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.request.temperature`,
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.id`,
`gen_ai.response.finish_reasons` and `server.address`, with `server.port` unless
it is the default 443. One request to `/review` gives:

```text
POST /review                (FastAPI)
└─ chat qwen3.5:9B          (OpenAI package, through OpenAILike)
```

The example asks for JSON and validates it against a Pydantic model. When a
response fails validation, it sends the model a correction, and each
correction is its own `chat` span under the same request.

## Adding Context, Provider and Cost

The client sets the request's context around each call, and a span processor
copies it onto the package's span when the span starts:

```python showLineNumbers title="src/content_quality/services/llm.py"
        call = LLMCallAttributes(
            provider=provider,
            endpoint=endpoint,
            content_type=content_type,
            content_length=len(content),
        )
        try:
            with llm_call_attributes(call):
                return await _chat_and_parse_with_retry(
                    llm=llm,
                    base_messages=messages,
                    achat_kwargs=achat_kwargs,
                    output_cls=output_cls,
                    model_name=model_name,
                    provider=provider,
                    content_type=content_type,
                    endpoint=endpoint,
                )
```

```python showLineNumbers title="src/content_quality/genai_spans.py"
class LLMCallAttributesProcessor(SpanProcessor):
    """Adds the request context and the provider to model call spans as they start."""

    def on_start(self, span: Span, parent_context: otel_context.Context | None = None) -> None:
        call = _llm_call.get()
        if call is None or not _is_genai_instrumentation_span(span):
            return
        attributes: dict[str, AttributeValue] = {
            "gen_ai.provider.name": call.provider,
            "base14.content.type": call.content_type,
            "base14.content.length": call.content_length,
        }
        if call.endpoint:
            attributes["base14.endpoint"] = call.endpoint
        span.set_attributes(attributes)
```

Setting `gen_ai.provider.name` corrects the OpenAI package, which reports
`openai` for any endpoint the SDK reaches. A span exporter then adds
`base14.gen_ai.cost_usd` from `_shared/pricing.json` and scrubs emails, phone
numbers, SSNs and card numbers from captured content, because both need the
finished span. The
[LLM Observability guide](../../../guides/ai-observability/llm-observability.md#cost)
walks through the exporter.

## Retries, Fallback and Errors

The client retries a failed call twice with exponential backoff, then switches
to the fallback model. With the SDK's own retries off, each attempt is one
`chat` span, and a failed one has error status and `error.type`. A switch adds
a `provider_fallback` event and `gen_ai.fallback.triggered=true` to the
request's span. `base14.gen_ai.retry.count`, `.fallback.count` and
`.error.count` record the rates, and `base14.gen_ai.cost` records cost with
the endpoint and content type.

## Evaluations and Prompts

Each review and score is recorded as a `gen_ai.evaluation.result` event on the
request's span, with a `base14.gen_ai.evaluation.score` histogram:

```python showLineNumbers title="src/content_quality/services/analyzer.py"
        span = trace.get_current_span()
        issue_score = max(
            0, 100 - sum(QUALITY_ISSUE_WEIGHTS.get(i.severity, 1) * 10 for i in result.issues)
        )
        span.add_event(
            "gen_ai.evaluation.result",
            {
                "gen_ai.evaluation.name": "content_review",
                "gen_ai.evaluation.score.value": issue_score,
                "gen_ai.evaluation.score.label": "passed" if issue_score >= 60 else "failed",
                "gen_ai.evaluation.explanation": result.summary,
            },
        )
```

Prompts live in `prompts/` as versioned YAML with a system and a user message,
and `promptfooconfig.yaml` runs Promptfoo assertions against the three
endpoints. The example's README covers both.

## Known Gaps

As of the OpenAI, Anthropic and Google GenAI packages 1.2b0 with LlamaIndex
0.14.24, verified 2026-10-06:

- **No official LlamaIndex instrumentation.** Only model calls are traced.
  Query engines, retrievers and workflows get no spans unless you add them;
  OpenLLMetry and OpenInference trace those, with the trade-offs in
  [Choosing an Approach](#choosing-an-approach).
- **LlamaIndex's Ollama integration is not traced.** It calls the `ollama`
  client. Use `OpenAILike` on Ollama's `/v1` endpoint.
- **`gen_ai.provider.name` is `openai` for Ollama.** Correct it on spans in a
  span processor; the `gen_ai.client.*` metric points keep `openai`.
- **No request context on spans or metrics.** Add the endpoint and similar in
  a span processor, and record your own counter for per-endpoint views.
- **`context_window` does not reach Ollama** through the OpenAI-compatible
  endpoint. Set the server's context length.
- **Content capture takes mode values only**, read once at `instrument()`.
  Content events from `event_only` and `span_and_event` are not scrubbed by a
  span exporter.

## What to Look For in Scout

### Follow one request

Open a `POST /review`, `/improve` or `/score` trace. It holds the `chat` span
for each model call, including schema corrections and retries, and the
evaluation event.

### Find failed model calls and why

Filter `chat` spans on error status and group by `error.type`. Plot
`base14.gen_ai.retry.count`, `.fallback.count` and `.error.count` for the
rates.

### Read tokens and cost by endpoint

Sum `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` and
`base14.gen_ai.cost_usd` on `chat` spans grouped by `base14.endpoint`, or sum
`base14.gen_ai.cost` by the same attribute.

### Track quality

Plot `base14.gen_ai.evaluation.score` by `gen_ai.evaluation.name` and
`gen_ai.evaluation.score.label`.

### Spot structured output trouble

Count `chat` spans per request. More than one without an error means the model
needed a schema correction.

## Production Patterns

- **Keep content capture at `no_content`** for real data, and scrub in a span
  exporter when you turn it on.
- **Turn off the SDKs' own retries** when the application retries.
- **Route Ollama through `OpenAILike`** so local calls are traced like hosted
  ones, and correct the provider name.
- **Keep the price table current.** A missing model records 0.
- **Pin the GenAI packages** and bump them together.
- **Batch exports and send through a collector**, which holds the Scout
  credentials.

## Choosing an Approach

| Approach | Package | What it traces | Notes |
| --- | --- | --- | --- |
| **Official GenAI SDK packages** | `opentelemetry-instrumentation-genai-openai`, `-anthropic`, `opentelemetry-instrumentation-google-genai` | Model calls through the SDKs | `gen_ai.*` only, content off by default. This guide. |
| **OpenLLMetry (Traceloop)** | `opentelemetry-instrumentation-llamaindex` | LlamaIndex components and model calls | At 0.62.4 on the example: span named `Ollama.workflow`, provider `ollama_llm`, empty `gen_ai.request.model`, no metrics, content on by default, `traceloop.*` attributes. |
| **OpenInference (Arize)** | `openinference-instrumentation-llama-index` | LlamaIndex components and model calls | `openinference.*` attributes, not `gen_ai.*`. |
| **Your own spans** | your code | What you write | For query engines or workflows on top of the SDK packages. |

Do not run the SDK packages and a LlamaIndex instrumentation that also records
model calls on the same app; each call would appear twice.

## Running Your Application

```bash showLineNumbers title="Terminal"
docker compose up -d --build
./scripts/test-api.sh
./scripts/verify-scout.sh
```

`verify-scout.sh` reviews, improves and scores sample content and checks the
collector output: that every `chat` span comes from a GenAI package, that
none names Ollama as `openai`, the attributes, metrics and evaluation events,
and that no PII from the samples reaches the collector.

## Troubleshooting

### No chat spans

The instrumentors did not run, or ran before the tracer provider was set, or
the model is LlamaIndex's `Ollama` class, which no package traces. Use
`OpenAILike` for Ollama.

### Empty answers from a thinking model

A thinking model's reasoning counts against the output token limit, and a low
limit can leave no room for the answer. Raise `max_tokens`, or send
`additional_kwargs={"reasoning_effort": "none"}` on `OpenAILike`.

### Chat spans say `openai` for Ollama

Expected from the OpenAI package. Set the provider in a span processor.

### No content with capture set to `true`

Use `span_only`. The packages accept mode values only.

## FAQ

### Is there an official OpenTelemetry instrumentation for LlamaIndex?

No. The official OpenTelemetry GenAI packages instrument the SDKs LlamaIndex
calls, OpenAI, Anthropic and Google Gen AI, so model calls are traced through
them. OpenLLMetry and OpenInference publish LlamaIndex instrumentations.

### How do I trace Ollama calls from LlamaIndex with OpenTelemetry?

Use `OpenAILike` with `api_base` set to Ollama's `/v1` endpoint and
`is_chat_model=True`, and call `OpenAIInstrumentor().instrument()`. Each call
is a `chat {model}` span.

### Should I use OpenLLMetry or OpenInference for LlamaIndex?

Use one when you need spans for query engines, retrievers or workflows. For
model calls alone, the official SDK packages give convention-named spans with
content off by default.

### How do I track LLM cost in a LlamaIndex app?

Add a cost attribute to each finished `chat` span in a span exporter, from the
token counts and a price table, and record a cost counter in your client.

### Can I capture prompts and completions in LlamaIndex traces?

Yes, with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only`.
Scrub them in a span exporter before export.

### How do I trace structured output corrections in LlamaIndex?

Each correction is a separate SDK call, so it is its own `chat` span under the
request. Count them per request to see how often the model misses the schema.

## What's Next?

### Related Guides

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  The same pattern in detail: context, cost, scrubbing and retries.
- [LangChain Instrumentation](./langchain.md) - The official LangChain
  package.
- [FastAPI Instrumentation](./fast-api.md) - The HTTP host in front of the
  model calls.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Alert on
  cost spikes, error rates, or quality drops.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  token, cost and quality dashboards.

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OpenTelemetry Collector.

## Complete Example

The code on this page comes from
[`python/ai-content-quality`](https://github.com/base-14/examples/tree/main/python/ai-content-quality).

```text
src/content_quality/
├── telemetry.py         # providers, exporters, SDK instrumentation
├── genai_spans.py       # context, provider, cost and scrubbing on chat spans
├── pricing.py           # price table from _shared/pricing.json
├── services/llm.py      # LlamaIndex models, structured output, retries, fallback
├── services/analyzer.py # review, improve and score, evaluation events
├── services/prompts.py  # versioned YAML prompts
└── main.py              # FastAPI app
```

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-content-quality
cp .env.example .env
ollama pull qwen3.5:9B
docker compose up -d --build
./scripts/verify-scout.sh
```

## References

- [OpenTelemetry GenAI instrumentation for Python](https://github.com/open-telemetry/opentelemetry-python-genai)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [LlamaIndex OpenAILike](https://docs.llamaindex.ai/en/stable/api_reference/llms/openai_like/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
