---
title:
  LLM Observability with OpenTelemetry - Unified AI Application Tracing Guide
sidebar_label: LLM Observability
sidebar_position: 8
description:
  Trace LLM calls in Python with the OpenTelemetry GenAI packages, then add
  agent context, cost, PII scrubbing and retry metrics in one unified trace.
keywords:
  [
    llm observability,
    llm opentelemetry instrumentation,
    opentelemetry-instrumentation-genai-openai,
    opentelemetry-instrumentation-genai-anthropic,
    opentelemetry-instrumentation-google-genai,
    opentelemetry genai semantic conventions,
    llm token tracking,
    llm cost monitoring,
    ai application monitoring,
    llm tracing python,
    gen_ai opentelemetry,
    llm metrics opentelemetry,
    unified ai tracing,
    opentelemetry span processor,
    llm retry fallback observability,
    llm evaluation metrics,
    ai pipeline observability,
  ]
---

# LLM Observability

Trace every layer of a Python AI application, from the HTTP request through
the agent pipeline to each model call and database query, in one
OpenTelemetry trace. The model calls are traced by the official OpenTelemetry
GenAI packages for the OpenAI, Anthropic and Google Gen AI SDKs; this guide
shows what they record and how to add what they cannot know.

An LLM call is more than an HTTP request. It has a model, token counts, a cost,
and sometimes a quality score, and it belongs to an agent and a business
operation. The GenAI packages record the model and the tokens on a
`chat {model}` span. The application adds the rest: which agent made the call,
which customer or campaign it served, what it cost, whether it was retried or
fell back to another provider, and how its output scored.

The example is a sales intelligence pipeline: a LangGraph graph of five nodes
that research prospects in Postgres and enrich, score, draft and evaluate
outreach with model calls, behind a FastAPI endpoint.

![LLM observability dashboard in Scout](/img/docs/llm-o11y.png)

:::tip TL;DR

Install `opentelemetry-instrumentation-genai-openai`, `-genai-anthropic` and
`opentelemetry-instrumentation-google-genai`, and call `instrument()` on each
after setting up the tracer provider. Add agent and business context to their
spans in a span processor, cost and PII scrubbing in a span exporter, and
retry, fallback and cost counters in your client. Keep content capture at
`no_content`.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Overview

- Trace OpenAI, Anthropic and Gemini calls with the official GenAI packages.
- Put the agent, the business ID and the real provider on the packages' spans
  with a span processor.
- Add cost and scrub captured content with a span exporter.
- Record retry, fallback, error and cost metrics, with one span per attempt.
- Trace the agent pipeline and record evaluation results.
- Deploy with Docker Compose and a collector that exports to base14 Scout.

## Who This Guide Is For

- **AI/ML engineers** building LLM features who need to see model, token, cost
  and quality per call.
- **Backend developers** adding model calls to an existing service who want
  them in the same trace as HTTP and database work.
- **Platform teams** standardizing AI observability on the OpenTelemetry GenAI
  conventions.
- **Teams moving from LangSmith, Weights & Biases or Helicone** to an open
  standard.

### Signals

| Signal | What the instrumentation emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `chat {model}` spans from the GenAI packages; FastAPI and SQLAlchemy spans. | Agent, business ID, provider and cost on chat spans; pipeline, agent and per-item spans; a retrieval span; `provider_fallback` and `gen_ai.evaluation.result` events. |
| Metrics | `gen_ai.client.token.usage` and `gen_ai.client.operation.duration`. | `base14.gen_ai.cost`, `.retry.count`, `.fallback.count`, `.error.count` and `.evaluation.score`. |
| Logs | None. | Trace and span IDs on log lines through the logging instrumentation. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model the SDKs can reach. The example uses Ollama with `qwen3.5:9B` through
  its OpenAI-compatible endpoint, which needs no API key; Anthropic, OpenAI and
  Google are configurable.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  for local development and
  [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
  for production.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `opentelemetry-instrumentation-genai-openai` | 1.2b0, for `openai>=1.26.0,<4` |
| `opentelemetry-instrumentation-genai-anthropic` | 1.2b0, for `anthropic>=0.51.0,<2` |
| `opentelemetry-instrumentation-google-genai` | 1.2b0, for `google-genai>=1.32.0,<3` |
| `openai` | 3.7.0 |
| `anthropic` | 0.125.0 |
| `google-genai` | 2.21.0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-sqlalchemy`, `-httpx`, `-logging` | 0.66b0 |
| `langgraph` | 1.2.11 |
| Python | 3.14 |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-sales-intelligence`](https://github.com/base-14/examples/tree/main/python/ai-sales-intelligence) |

Last verified 2026-10-06: the example's verify script passed against Ollama
`qwen3.5:9B` through the OpenAI package. The GenAI packages are beta and
always emit the latest experimental conventions, so pin exact versions and
re-check the spans after each upgrade.

## The Unified Trace

One request to run a campaign produces one trace:

```text
POST /campaigns/{campaign_id}/run       (FastAPI)
├─ SELECT                               (SQLAlchemy)
├─ pipeline.run
│  ├─ invoke_agent research
│  │  └─ retrieval prospects_fts
│  │     └─ SELECT                      (SQLAlchemy)
│  ├─ invoke_agent enrich
│  │  └─ enrich.prospect
│  │     └─ chat qwen3.5:9B             (OpenAI package)
│  ├─ invoke_agent score
│  │  └─ score.prospect
│  │     └─ chat qwen3.5:9B
│  ├─ invoke_agent draft
│  │  └─ draft.email
│  │     └─ chat qwen3.5:9B
│  └─ invoke_agent evaluate
│     └─ evaluate.draft
│        └─ chat qwen3.5:9B
└─ INSERT                               (SQLAlchemy)
```

Three kinds of spans work together:

- **Instrumentation spans**, with no code: FastAPI requests, SQLAlchemy
  queries, and a `chat {model}` span for every SDK call from the GenAI
  packages.
- **Application spans**: `pipeline.run`, an `invoke_agent` span per graph node,
  and one span per prospect or draft.
- **Enrichment on instrumentation spans**: the agent, the campaign ID, the
  provider and the cost, added to the packages' `chat` spans without a second
  span.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
pip install \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-openai \
  opentelemetry-instrumentation-genai-anthropic \
  opentelemetry-instrumentation-google-genai \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
uv add \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-openai \
  opentelemetry-instrumentation-genai-anthropic \
  opentelemetry-instrumentation-google-genai \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
</Tabs>
```

Install only the GenAI packages for the SDKs you use. They are beta, from the
OpenTelemetry GenAI SIG, and move as one release line: bump them together.
`opentelemetry-instrumentation-genai-openai` continues the package published as
`opentelemetry-instrumentation-openai-v2`.

## Instrumenting the Model SDKs

Set up the providers first, then instrument each SDK:

```python showLineNumbers title="src/sales_intelligence/telemetry.py"
    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(LLMCallAttributesProcessor())
    trace_provider.add_span_processor(
        BatchSpanProcessor(
            GenAISpanExporter(
                OTLPSpanExporter(endpoint=f"{settings.otel_exporter_otlp_endpoint}/v1/traces")
            )
        )
    )
    trace.set_tracer_provider(trace_provider)
```

```python showLineNumbers title="src/sales_intelligence/telemetry.py"
    from opentelemetry.instrumentation.genai.anthropic import AnthropicInstrumentor
    from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor
    from opentelemetry.instrumentation.google_genai import GoogleGenAiSdkInstrumentor

    OpenAIInstrumentor().instrument()
    AnthropicInstrumentor().instrument()
    GoogleGenAiSdkInstrumentor().instrument()
```

Every SDK call then gets a `chat {model}` CLIENT span with
`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`,
`gen_ai.request.temperature`, `gen_ai.request.max_tokens`,
`gen_ai.response.model`, `gen_ai.response.id`,
`gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens` and `server.address`, and the
`gen_ai.client.token.usage` and `gen_ai.client.operation.duration` histograms
record each call. `server.port` is left out when it is the default 443, and
Anthropic's `end_turn` is reported as the convention's `stop`.

The OpenAI package also covers OpenAI-compatible endpoints, such as Ollama's
`/v1`, Azure OpenAI, Groq and DeepSeek, when called through the OpenAI SDK.

## Adding Application Context

The packages do not know which agent made a call or which business operation
it served. Set that context around the call:

```python showLineNumbers title="src/sales_intelligence/llm.py"
        call = LLMCallAttributes(
            provider=PROVIDER_SEMCONV_NAMES[provider],
            agent_name=agent_name,
            campaign_id=campaign_id,
        )
        try:
            with llm_call_attributes(call):
                response = await llm_provider.generate(
                    model=model,
                    system=system,
                    prompt=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
```

`llm_call_attributes` stores it in a context variable, and a span processor
copies it onto the package's span when the span starts:

```python showLineNumbers title="src/sales_intelligence/genai_spans.py"
class LLMCallAttributesProcessor(SpanProcessor):
    """Adds the agent, the campaign and the provider to model call spans as they start."""

    def on_start(self, span: Span, parent_context: otel_context.Context | None = None) -> None:
        call = _llm_call.get()
        if call is None or not _is_genai_instrumentation_span(span):
            return
        attributes: dict[str, AttributeValue] = {"gen_ai.provider.name": call.provider}
        if call.agent_name:
            attributes["gen_ai.agent.name"] = call.agent_name
        if call.campaign_id:
            attributes["base14.campaign_id"] = call.campaign_id
        span.set_attributes(attributes)
```

`_is_genai_instrumentation_span` checks the span's instrumentation scope, so
only the packages' spans are touched. Setting `gen_ai.provider.name` here also
corrects the OpenAI package, which reports `openai` for any endpoint the SDK
reaches, Ollama's included. Attributes set at span start win over the ones the
package set when it created the span, and the package does not rewrite the
provider when the span ends.

Custom attributes carry a `base14.` prefix, because the conventions reserve
`gen_ai.*`.

## Cost

Cost needs the token counts, which exist only once the call has finished, and
a finished span's attributes cannot be changed. A span exporter wraps the OTLP
exporter and rebuilds the spans it adds to:

```python showLineNumbers title="src/sales_intelligence/genai_spans.py"
def _derived_attributes(span: ReadableSpan) -> dict[str, AttributeValue]:
    attributes = span.attributes or {}
    if attributes.get("gen_ai.operation.name") not in MODEL_CALL_OPERATIONS:
        return {}
    derived: dict[str, AttributeValue] = {}
    model = attributes.get("gen_ai.response.model") or attributes.get("gen_ai.request.model")
    if model is not None:
        derived[COST_ATTRIBUTE] = calculate_cost(
            str(model),
            _as_token_count(attributes.get("gen_ai.usage.input_tokens")),
            _as_token_count(attributes.get("gen_ai.usage.output_tokens")),
        )
    for key in CONTENT_ATTRIBUTES:
        value = attributes.get(key)
        if isinstance(value, str):
            derived[key] = scrub_pii(value)
    return derived
```

Prices come from `_shared/pricing.json`, in USD per million tokens. A model
missing from it costs 0, which covers every local Ollama model.

For dashboards, the client also records a `base14.gen_ai.cost` counter with
the agent and campaign, which the packages' metrics do not carry:

```python showLineNumbers title="src/sales_intelligence/llm.py"
def _record_cost(
    provider: LLMProvider,
    model: str,
    response: LLMResponse,
    agent_name: str | None,
    campaign_id: str | None,
) -> None:
    attributes: dict[str, Any] = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": PROVIDER_SEMCONV_NAMES[provider],
        "gen_ai.request.model": model,
        "gen_ai.response.model": response.model,
    }
    if agent_name:
        attributes["gen_ai.agent.name"] = agent_name
    if campaign_id:
        attributes["base14.campaign_id"] = campaign_id
    _cost_counter.add(
        calculate_cost(response.model, response.input_tokens, response.output_tokens),
        attributes,
    )
```

## Content Capture and PII

The packages capture no content by default.
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` takes `no_content`,
`span_only`, `event_only` or `span_and_event`. `true` and `false` are not
valid: the packages log a warning and capture nothing. The mode is read once,
when `instrument()` runs.

With `span_only`, chat spans carry `gen_ai.input.messages`,
`gen_ai.output.messages` and `gen_ai.system_instructions` as JSON. The span
exporter above scrubs emails, phone numbers, LinkedIn URLs and card numbers
from them before export. Two limits:

- **Events are not scrubbed.** `event_only` and `span_and_event` emit content
  as log events, which a span exporter does not see.
- **A completion hook cannot scrub.** It runs after the content is set on the
  span. Use it to upload content to storage instead, with
  `OTEL_INSTRUMENTATION_GENAI_COMPLETION_HOOK=upload`.

Treat the scrubber as a backstop. Decide what may leave your boundary before
turning capture on in production.

## Retry and Fallback

Retry in the application, not in the SDK. Both the OpenAI and Anthropic SDKs
retry inside a single call by default, and the package records that call as
one span, so a retry neither shows in the trace nor in your counters. Build
the clients with `max_retries=0`:

```python showLineNumbers title="src/sales_intelligence/llm.py"
        # tenacity in generate() is the only retry layer, so each attempt is one span.
        self._client = AsyncAnthropic(api_key=api_key, max_retries=0)
```

Each attempt is then its own `chat` span. A failed attempt's span has error
status, the recorded exception, and `error.type` set to the SDK's exception
class, such as `RateLimitError`. Count retries in the retry library's hook:

```python showLineNumbers title="src/sales_intelligence/llm.py"
def _on_retry(retry_state: RetryCallState) -> None:
    provider = "unknown"
    if retry_state.args and hasattr(retry_state.args[0], "provider_name"):
        provider = PROVIDER_SEMCONV_NAMES[retry_state.args[0].provider_name]

    error_type = "unknown"
    if retry_state.outcome and retry_state.outcome.exception():
        error_type = type(retry_state.outcome.exception()).__qualname__

    _retry_counter.add(
        1,
        {
            "gen_ai.provider.name": provider,
            "error.type": error_type,
            "base14.retry.attempt": retry_state.attempt_number,
        },
    )
```

When the primary provider's retries run out, the client switches to the
fallback provider and records the switch on the calling span, which does not
fail if the fallback answers:

```python showLineNumbers title="src/sales_intelligence/llm.py"
    def _record_fallback(self, provider: LLMProvider, exc: Exception) -> None:
        """Record the provider switch on the calling span without failing it."""
        error_type = type(exc).__qualname__
        attrs = {
            "gen_ai.provider.name": PROVIDER_SEMCONV_NAMES[provider],
            "base14.gen_ai.fallback.provider": PROVIDER_SEMCONV_NAMES[self._fallback_provider],
            "error.type": error_type,
        }

        span = trace.get_current_span()
        span.record_exception(exc)
        span.add_event("provider_fallback", attributes=attrs)
        span.set_attribute("gen_ai.fallback.triggered", True)

        _fallback_counter.add(1, attrs)
```

## Agent Pipeline Spans

The example's graph nodes are plain functions, so each gets an `invoke_agent
{node}` span by hand, inside a `pipeline.run` span, and nodes that handle many
items open one span per item. A failed item marks its own span failed while
the node goes on. The [LangGraph guide](../../instrument/apps/auto-instrumentation/langgraph.md)
covers this in detail.

If your agents run on a framework with its own telemetry, use that instead of
hand-written agent spans: [LangChain](../../instrument/apps/auto-instrumentation/langchain.md),
[Pydantic AI](../../instrument/apps/auto-instrumentation/pydantic-ai.md),
[Strands Agents](../../instrument/apps/auto-instrumentation/strands-agents.md),
[Google ADK](../../instrument/apps/auto-instrumentation/google-adk.md),
[Microsoft Agent Framework](../../instrument/apps/auto-instrumentation/microsoft-agent-framework.md)
and the [OpenAI Agents SDK](../../instrument/apps/auto-instrumentation/openai-agents-sdk.md)
each have a page. Do not combine a framework's model spans with an SDK
package's on the same call; each call would appear twice.

## Evaluation and Quality

The evaluate node scores each draft with a model call and records the result
as a `gen_ai.evaluation.result` event on the draft's span:

```python showLineNumbers title="src/sales_intelligence/agents/evaluate.py"
                espan.add_event(
                    "gen_ai.evaluation.result",
                    attributes={
                        "gen_ai.evaluation.name": "email_quality",
                        "gen_ai.evaluation.score.value": score,
                        "gen_ai.evaluation.score.label": "passed" if passed else "failed",
                        "gen_ai.evaluation.explanation": data.get("feedback", "")[:200],
                    },
                )
```

A `base14.gen_ai.evaluation.score` histogram, normalized to 0-1, carries the
same name and label for dashboards. The conventions define the event but no
evaluation metric, hence the prefix.

## SDKs Without a Package

Where no GenAI package exists, such as `go-openai` in Go or `async-openai` in
Rust, write the `chat {model}` span by hand with the same attributes the
packages set, and record the two `gen_ai.client.*` histograms yourself. The
[Rust LLM Observability guide](./rust-llm-observability.md) shows the pattern.
In Python, check the
[`opentelemetry-python-genai`](https://github.com/open-telemetry/opentelemetry-python-genai)
repository first; a hand-written span next to a package span records the call
twice.

## Known Gaps

As of the OpenAI, Anthropic and Google GenAI packages 1.2b0, verified
2026-10-06:

- **`gen_ai.provider.name` is `openai` for OpenAI-compatible endpoints.**
  Correct it on spans in a span processor; the `gen_ai.client.*` metric points
  keep `openai`.
- **No HTTP client span for OpenAI calls.** The OpenAI SDK 3.x sends through
  `httpx2`, which `opentelemetry-instrumentation-httpx` does not patch.
- **No application context on spans or metrics.** Add it to spans in a span
  processor. The token and duration metrics carry the provider and model only;
  record your own counter for per-agent or per-customer views.
- **SDK retries are invisible.** They happen inside one span. Turn them off
  when the application retries.
- **Content capture takes mode values only**, read once at `instrument()`.
- **Content events are not scrubbed** by a span exporter.

## What to Look For in Scout

### Follow one campaign end to end

Search spans by `base14.campaign_id`. The trace holds the HTTP span, the
pipeline, each node, each item and each model call, with the database queries
in between.

### Find failed model calls and why

Filter `chat` spans on error status and group by `error.type`. A retry shows
as a failed `chat` span followed by a successful one under the same item span;
a fallback adds a `provider_fallback` event to the calling span. Plot
`base14.gen_ai.retry.count`, `.fallback.count` and `.error.count` for the
rates.

### Read tokens and cost by agent

Sum `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` and
`base14.gen_ai.cost_usd` on `chat` spans grouped by `gen_ai.agent.name`, or
sum the `base14.gen_ai.cost` counter by the same attribute.

### Read tokens by model

Plot `gen_ai.client.token.usage` split by `gen_ai.token.type` and grouped by
`gen_ai.request.model`.

### Track output quality

Plot `base14.gen_ai.evaluation.score` by `gen_ai.evaluation.score.label`, and
read the `gen_ai.evaluation.result` events for the explanation.

## Production Patterns

- **Keep content capture at `no_content`** for real data. Turn on `span_only`
  where you need it, with a scrubbing exporter.
- **Turn off SDK retries** when the application retries.
- **Add context in a processor, not a second span.** A hand-written span next
  to a package span doubles every call.
- **Keep the price table current.** A missing model records 0.
- **Pin the GenAI packages** and re-check the spans after each upgrade; they
  are beta and always emit the latest experimental conventions.
- **Batch exports and send through a collector**, which holds the Scout
  credentials.

## Production Configuration

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=my-ai-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=no_content
SCOUT_ENVIRONMENT=production

LLM_PROVIDER=anthropic
LLM_MODEL_CAPABLE=claude-sonnet-4-6
ANTHROPIC_API_KEY=...

FALLBACK_PROVIDER=google
FALLBACK_MODEL=gemini-3-flash-preview
GOOGLE_API_KEY=...
```

The GenAI packages do not read `OTEL_SEMCONV_STABILITY_OPT_IN`; they always
emit the latest experimental conventions.

### OpenTelemetry Collector Configuration

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'
  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048
  attributes:
    actions:
      - key: deployment.environment.name
        value: ${SCOUT_ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s
  debug:
    verbosity: detailed

service:
  extensions: [health_check, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, attributes, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
```

Drop the `debug` exporter once you are past first setup.

### Docker Compose Deployment

```yaml showLineNumbers title="compose.yaml"
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/mydb
      - OTEL_SERVICE_NAME=my-ai-service
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-no_content}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started

  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    environment:
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-https://collector.base14.io}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
```

## Troubleshooting

### Verify telemetry is working

The collector's `debug` exporter prints each span. After a request:

```bash showLineNumbers title="Terminal"
docker compose logs otel-collector --since=2m | grep -E "Name +: (chat|invoke_agent)"
```

Every `chat` span should come from a scope named
`opentelemetry.instrumentation.genai.*` or
`opentelemetry.instrumentation.google_genai`. The example's
`scripts/verify-scout.sh` checks that, and that no chat span names Ollama as
`openai`.

### No chat spans

The instrumentors did not run, or ran before the tracer provider was set. In
tests, a mocked SDK class produces no spans; replace the SDK's HTTP transport
instead.

### Two chat spans per call

Both a hand-written span and a package span, or a framework's span and an SDK
package's span, cover the same call. Keep one.

### No content with capture set to `true`

Use `span_only`. The packages accept mode values only.

### Token counts are zero or missing

The call failed, or the provider returned no usage. Check the span's status
first; only a call that returned a response carries token counts.

## FAQ

### Is there an official OpenTelemetry instrumentation for the OpenAI Python SDK?

Yes. `opentelemetry-instrumentation-genai-openai`, from the OpenTelemetry
GenAI SIG, traces the OpenAI Python SDK, including chat completions, the
Responses API and embeddings, and OpenAI-compatible endpoints reached through
it. It continues the package published as
`opentelemetry-instrumentation-openai-v2`.

### How do I trace Anthropic and Gemini calls with OpenTelemetry?

Install `opentelemetry-instrumentation-genai-anthropic` and
`opentelemetry-instrumentation-google-genai`, and call `instrument()` on
`AnthropicInstrumentor` and `GoogleGenAiSdkInstrumentor` after setting up the
tracer provider.

### How do I add my own attributes to the GenAI packages' spans?

Use a span processor. Its `on_start` runs when the package creates the span,
before the call, so attributes set there stay on the span. Pass the values in
through a context variable set around the call.

### How do I track LLM cost per agent with OpenTelemetry?

Add a cost attribute to each finished `chat` span in a span exporter, from the
token counts and a price table, and record a cost counter in your client with
the agent's name.

### Can I see prompts and completions in traces?

Yes, with `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only`. Scrub
them in a span exporter before export.

### Does OpenTelemetry record LLM retries?

Only those your application makes. An SDK's own retries happen inside one
span. Set `max_retries=0` on the client and retry in the application, and
each attempt is a span.

### What if my agent framework has its own tracing?

Use it, and do not add an SDK package for the same calls. See the framework
pages under [Agent Pipeline Spans](#agent-pipeline-spans).

## What's Next?

### Advanced Topics

- [LangGraph Instrumentation](../../instrument/apps/auto-instrumentation/langgraph.md)
  \- Node spans for a graph of plain functions.
- [AI Agent Observability](./agent-observability.md) - Agent timelines,
  conversation IDs and tool calls.
- [Rust LLM Observability](./rust-llm-observability.md) - Hand-written GenAI
  spans where no package exists.

### Scout Platform Features

- [Creating Alerts](../creating-alerts-with-logx.md) - Alert on cost spikes,
  error rates, or quality drops.
- [Dashboard Creation](../create-your-first-dashboard.md) - Build token, cost
  and quality dashboards.

### Deployment and Operations

- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  \- Local development with the collector.
- [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
  \- Production collector deployment.

## Complete Example

The code on this page comes from
[`python/ai-sales-intelligence`](https://github.com/base-14/examples/tree/main/python/ai-sales-intelligence).

```text
src/sales_intelligence/
├── telemetry.py         # providers, exporters, SDK instrumentation
├── genai_spans.py       # context, provider, cost and scrubbing on chat spans
├── llm.py               # SDK clients, retries, fallback, counters
├── pricing.py           # price table from _shared/pricing.json
├── pii.py               # scrubbing patterns
├── graph.py             # LangGraph pipeline and node spans
├── agents/              # research, enrich, score, draft, evaluate
└── main.py              # FastAPI app
```

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-sales-intelligence
cp .env.example .env
ollama pull qwen3.5:9B
docker compose up -d --build
./scripts/verify-scout.sh
```

## References

- [OpenTelemetry GenAI instrumentation for Python](https://github.com/open-telemetry/opentelemetry-python-genai)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
