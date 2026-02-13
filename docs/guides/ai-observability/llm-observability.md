---
title:
  LLM Observability with OpenTelemetry - Unified AI Application
  Tracing Guide | base14 Scout
sidebar_label: LLM Observability
sidebar_position: 8
description:
  Instrument AI and LLM apps with OpenTelemetry. Trace LLM calls,
  track tokens and costs, monitor agent pipelines with base14 Scout.
keywords:
  [
    llm observability,
    llm opentelemetry instrumentation,
    ai application monitoring,
    opentelemetry genai semantic conventions,
    llm token tracking,
    llm cost monitoring,
    langgraph tracing,
    ai agent observability,
    llm tracing,
    gen_ai opentelemetry,
    ai application performance monitoring,
    llm metrics opentelemetry,
    unified ai tracing,
    python llm instrumentation,
    opentelemetry llm spans,
    ai pipeline observability,
    llm evaluation metrics,
  ]
---

# LLM Observability

Implement unified observability for AI and LLM applications using
OpenTelemetry. This guide shows you how to trace every layer of
an AI application — from HTTP requests through agent orchestration
to LLM API calls and database queries — in a single correlated
trace using the OpenTelemetry Python SDK and base14 Scout.

AI applications introduce observability challenges that traditional
APM tools were not designed for. An LLM call is not just an HTTP
request — it carries semantic meaning: which model was used, how
many tokens were consumed, what it cost, whether the output passed
quality evaluation. Tools like LangSmith or Weights & Biases
capture LLM-specific telemetry but operate in isolation, creating
blind spots between your application layer (HTTP, database) and
your AI layer (prompts, models, agents). OpenTelemetry bridges
this gap with GenAI semantic conventions that let you capture
LLM-specific context alongside standard application telemetry.

Whether you are building AI agents with LangGraph, LangChain, or
custom orchestration, instrumenting LLM calls from Anthropic,
OpenAI, or Google, or trying to understand why your AI pipeline
is slow and expensive, this guide provides production-ready
patterns for unified AI observability. You will learn how to
combine auto-instrumentation for HTTP and database layers with
custom instrumentation for LLM calls, token tracking, cost
attribution, and quality evaluation — all visible in a single
trace on base14 Scout.

![LLM observability dashboard in Scout](/img/docs/llm-o11y.png)

## Overview

This guide demonstrates how to:

- Set up unified OpenTelemetry for an AI application (traces +
  metrics)
- Use auto-instrumentation for HTTP, database, and external API
  layers
- Create custom LLM spans following OpenTelemetry GenAI semantic
  conventions
- Track token usage and calculate cost per LLM call
- Attribute costs to specific agents and business operations
- Instrument agent pipelines (LangGraph or custom) with
  parent-child spans
- Record evaluation metrics for LLM output quality tracking
- Scrub PII from prompts and completions before recording in
  telemetry
- Deploy with Docker Compose and the OpenTelemetry Collector
- Export traces and metrics to base14 Scout

## Who This Guide Is For

This documentation is designed for:

- **AI/ML engineers**: building LLM-powered features and needing
  visibility into model performance, cost, and quality
- **Backend developers**: adding AI capabilities (chat, agents,
  RAG) to existing applications and wanting unified tracing
- **Platform teams**: standardizing observability across AI
  services and traditional microservices
- **Engineering teams**: migrating from LangSmith, Weights &
  Biases, or Helicone to open-standard observability with
  OpenTelemetry
- **DevOps engineers**: deploying AI applications with production
  monitoring, cost alerting, and quality tracking

## Prerequisites

Before starting, ensure you have:

- **Python 3.12 or later** installed (3.13+ recommended)
- **An LLM API key** from at least one provider (Anthropic,
  OpenAI, or Google)
- **Scout Collector** configured and accessible from your
  application
  - See
    [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
    for local development
  - See
    [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
    for production deployment
- Basic understanding of OpenTelemetry concepts (traces, spans,
  metrics)

### Compatibility Matrix

| Component         | Minimum Version | Recommended     |
| ----------------- | --------------- | --------------- |
| Python            | 3.12            | 3.13+           |
| opentelemetry-sdk | 1.39.0          | 1.39.1+         |
| opentelemetry-api | 1.39.0          | 1.39.1+         |
| FastAPI           | 0.115+          | 0.128+          |
| SQLAlchemy        | 2.0             | 2.0.45+         |
| LangGraph         | 0.2+            | 1.0.6+          |
| Anthropic SDK     | 0.40+           | 0.76+           |
| OpenAI SDK        | 1.0+            | 1.60+           |
| Google GenAI SDK  | 1.0+            | 1.59+           |

## The Unified Trace

The core value of OpenTelemetry for AI applications is the
**unified trace** — a single trace ID that connects every layer
of a request, from HTTP entry to LLM completion and back.

Here is what a trace looks like for an AI pipeline request:

```text showLineNumbers title="Unified trace for POST /campaigns/{id}/run"
POST /campaigns/{id}/run                           8.4s  [auto: FastAPI]
├─ db.query SELECT connections                    12ms   [auto: SQLAlchemy]
├─ pipeline.run                                    8.3s  [custom: pipeline]
│  ├─ invoke_agent research                       80ms   [custom: agent]
│  │  └─ db.query SELECT ... tsvector             45ms   [auto: SQLAlchemy]
│  ├─ invoke_agent enrich                          2.1s  [custom: agent]
│  │  └─ gen_ai.chat claude-sonnet-4               2.0s  [custom: LLM]
│  │     └─ HTTP POST api.anthropic.com            1.9s  [auto: httpx]
│  ├─ invoke_agent score                           1.8s  [custom: agent]
│  │  └─ gen_ai.chat claude-sonnet-4               1.7s  [custom: LLM]
│  │     └─ HTTP POST api.anthropic.com            1.7s  [auto: httpx]
│  ├─ invoke_agent draft                           3.2s  [custom: agent]
│  │  └─ gen_ai.chat claude-sonnet-4               3.1s  [custom: LLM]
│  │     └─ HTTP POST api.anthropic.com            3.1s  [auto: httpx]
│  └─ invoke_agent evaluate                        1.1s  [custom: agent]
│     └─ gen_ai.chat claude-sonnet-4               1.0s  [custom: LLM]
│        └─ HTTP POST api.anthropic.com            0.9s  [auto: httpx]
└─ db.query INSERT prospects                       8ms   [auto: SQLAlchemy]
```

Three types of spans work together:

- **Auto-instrumented spans** (no code changes): FastAPI HTTP
  requests, SQLAlchemy database queries, httpx outbound HTTP calls
- **Custom LLM spans**: Model name, token counts, cost, prompt/
  completion events following GenAI semantic conventions
- **Custom agent spans**: Pipeline orchestration, agent names,
  business context like campaign ID

The auto-instrumented `httpx` span captures the raw HTTP call to
`api.anthropic.com`. The custom `gen_ai.chat` span wraps it,
adding LLM-specific context: which model, how many tokens, what
it cost. The custom `invoke_agent` span wraps both, adding
business context: which agent, which campaign. All three are
children of the same trace.

## Installation

Install the core OpenTelemetry packages and auto-instrumentation
libraries:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
pip install \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-httpx \
  opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
uv add \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-httpx \
  opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
<TabItem value="poetry" label="Poetry">
```

```bash showLineNumbers title="Terminal"
poetry add \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-httpx \
  opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
</Tabs>
```

> **Note**: The `httpx` instrumentor is key for AI applications.
> Most Python LLM SDKs (Anthropic, OpenAI) use httpx internally,
> so this instrumentor automatically captures all LLM API calls
> at the HTTP level without any changes to your LLM code.

## Auto-Instrumentation Setup

Auto-instrumentation provides the foundation layer: HTTP spans,
database spans, outbound API call spans, and log correlation.
Set this up first — it requires no changes to your business logic.

### Telemetry Initialization

```python showLineNumbers title="telemetry.py"
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
    OTLPMetricExporter,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.sqlalchemy import (
    SQLAlchemyInstrumentor,
)
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_telemetry(engine=None):
    """Initialize unified observability for traces and metrics."""
    resource = Resource.create(
        {
            "service.name": "my-ai-service",
            "service.version": "1.0.0",
            "deployment.environment": "production",
        }
    )

    # Traces
    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(
                endpoint="http://localhost:4318/v1/traces"
            )
        )
    )
    trace.set_tracer_provider(trace_provider)

    # Metrics
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(
            endpoint="http://localhost:4318/v1/metrics"
        ),
        export_interval_millis=10000,
    )
    metric_provider = MeterProvider(
        resource=resource, metric_readers=[metric_reader]
    )
    metrics.set_meter_provider(metric_provider)

    # Auto-instrumentation
    HTTPXClientInstrumentor().instrument()
    LoggingInstrumentor().instrument(set_logging_format=True)

    if engine:
        SQLAlchemyInstrumentor().instrument(
            engine=engine.sync_engine
        )

    return (
        trace.get_tracer("my-ai-service"),
        metrics.get_meter("my-ai-service"),
    )
```

### Instrumenting FastAPI

FastAPI instrumentation must be applied after the app is created:

```python showLineNumbers title="main.py"
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import (
    FastAPIInstrumentor,
)

from my_app.telemetry import setup_telemetry

# Initialize telemetry BEFORE creating the app
tracer, meter = setup_telemetry(engine)

app = FastAPI(title="My AI Service")

# Instrument AFTER creation
FastAPIInstrumentor.instrument_app(app)
```

### What Auto-Instrumentation Captures

| Instrumentor | Captures                                    |
| ------------ | ------------------------------------------- |
| `FastAPI`    | HTTP method, path, status code, duration    |
| `SQLAlchemy` | SQL statement, parameters, query duration   |
| `httpx`      | Outbound URL, status, headers, duration     |
| `Logging`    | Adds `trace_id` and `span_id` to log records |

Auto-instrumentation alone gives you visibility into the
application and infrastructure layers. But an LLM API call
appears as a generic `HTTP POST` to `api.anthropic.com` —
you cannot see the model name, token count, or cost. Custom
instrumentation fills this gap.

## Custom LLM Instrumentation

Custom instrumentation adds LLM-specific context to spans using
OpenTelemetry GenAI semantic conventions. This is where AI
observability diverges from standard APM.

### GenAI Span Attributes

The OpenTelemetry GenAI semantic conventions define standard
attributes for LLM operations. Using them ensures your telemetry
works with any OpenTelemetry-compatible backend.

The following example shows a provider-agnostic `generate` function
with full GenAI span instrumentation. Each LLM provider returns
token counts differently — the tabs below show the provider-specific
response handling:

```python showLineNumbers title="llm.py - span setup (common to all providers)"
from opentelemetry import trace

tracer = trace.get_tracer("gen_ai.client")


async def generate(
    prompt: str,
    system: str,
    model: str,
    provider: str,
    agent_name: str | None = None,
    campaign_id: str | None = None,
) -> str:
    """Generate LLM completion with full OTel instrumentation."""
    with tracer.start_as_current_span(
        f"gen_ai.chat {model}"
    ) as span:
        # Required attributes (GenAI semconv)
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", provider)

        # Conditionally required
        span.set_attribute("gen_ai.request.model", model)

        # Recommended
        span.set_attribute(
            "gen_ai.request.temperature", 0.7
        )
        span.set_attribute(
            "gen_ai.request.max_tokens", 1024
        )
        span.set_attribute(
            "server.address", "api.anthropic.com"
        )

        # Business context (custom attributes)
        if agent_name:
            span.set_attribute(
                "gen_ai.agent.name", agent_name
            )
        if campaign_id:
            span.set_attribute("campaign_id", campaign_id)

        # Call provider (see tabs below for response handling)
        response = await call_provider(
            provider, model, system, prompt
        )

        # Record response attributes on span
        span.set_attribute(
            "gen_ai.response.model", response.model
        )
        span.set_attribute(
            "gen_ai.usage.input_tokens",
            response.input_tokens,
        )
        span.set_attribute(
            "gen_ai.usage.output_tokens",
            response.output_tokens,
        )

        return response.content
```

```mdx-code-block
<Tabs groupId="llm-provider">
<TabItem value="anthropic" label="Anthropic" default>
```

```python showLineNumbers title="providers/anthropic.py"
from anthropic import AsyncAnthropic


async def call_anthropic(
    model: str, system: str, prompt: str,
    temperature: float, max_tokens: int,
) -> LLMResponse:
    client = AsyncAnthropic(api_key=api_key)

    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system,
        messages=[
            {"role": "user", "content": prompt}
        ],
    )

    content = ""
    if response.content:
        block = response.content[0]
        if hasattr(block, "text"):
            content = block.text

    return LLMResponse(
        content=content,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        model=response.model,
        response_id=response.id,
        finish_reason=response.stop_reason,
    )
```

```mdx-code-block
</TabItem>
<TabItem value="openai" label="OpenAI">
```

```python showLineNumbers title="providers/openai.py"
from openai import AsyncOpenAI


async def call_openai(
    model: str, system: str, prompt: str,
    temperature: float, max_tokens: int,
) -> LLMResponse:
    client = AsyncOpenAI(api_key=api_key)

    response = await client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )

    choice = response.choices[0] if response.choices else None
    content = (
        choice.message.content
        if choice and choice.message
        else ""
    )
    usage = response.usage

    return LLMResponse(
        content=content or "",
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=(
            usage.completion_tokens if usage else 0
        ),
        model=response.model,
        response_id=response.id,
        finish_reason=(
            choice.finish_reason if choice else None
        ),
    )
```

```mdx-code-block
</TabItem>
<TabItem value="google" label="Google Gemini">
```

```python showLineNumbers title="providers/google.py"
from google import genai
from google.genai.types import GenerateContentConfig


async def call_google(
    model: str, system: str, prompt: str,
    temperature: float, max_tokens: int,
) -> LLMResponse:
    client = genai.Client(api_key=api_key)

    config = GenerateContentConfig(
        system_instruction=system,
        temperature=temperature,
        max_output_tokens=max_tokens,
    )

    response = await client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )

    content = response.text or ""
    usage = response.usage_metadata
    input_tokens = (
        usage.prompt_token_count
        if usage and usage.prompt_token_count
        else 0
    )
    output_tokens = (
        usage.candidates_token_count
        if usage and usage.candidates_token_count
        else 0
    )

    return LLMResponse(
        content=content,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model=model,
        response_id=None,
        finish_reason=None,
    )
```

```mdx-code-block
</TabItem>
</Tabs>
```

### GenAI Span Attribute Reference

| Attribute                         | Type     | Required    | Description                |
| --------------------------------- | -------- | ----------- | -------------------------- |
| `gen_ai.operation.name`           | string   | Yes         | Operation type: `"chat"`   |
| `gen_ai.provider.name`           | string   | Yes         | Provider: `"anthropic"`, etc. |
| `gen_ai.request.model`           | string   | Conditional | Model requested            |
| `gen_ai.response.model`          | string   | Recommended | Model actually used        |
| `gen_ai.usage.input_tokens`      | int      | Recommended | Input tokens consumed      |
| `gen_ai.usage.output_tokens`     | int      | Recommended | Output tokens generated    |
| `gen_ai.request.temperature`     | float    | Recommended | Sampling temperature       |
| `gen_ai.request.max_tokens`      | int      | Recommended | Max tokens requested       |
| `gen_ai.response.id`             | string   | Recommended | Provider response ID       |
| `gen_ai.response.finish_reasons` | string[] | Recommended | Why generation stopped     |
| `server.address`                 | string   | Recommended | Provider API host          |

### Prompt and Completion Events

Record prompts and completions as span events for debugging.
Always scrub PII before recording (see
[PII and Security](#pii-and-security)):

```python showLineNumbers title="llm.py - recording events"
# Before calling the LLM
span.add_event(
    "gen_ai.user.message",
    attributes={
        "gen_ai.prompt": scrub_prompt(prompt)[:1000],
        "gen_ai.system": scrub_prompt(system)[:500],
    },
)

# After receiving the response
span.add_event(
    "gen_ai.assistant.message",
    attributes={
        "gen_ai.completion": scrub_completion(
            response.content
        )[:2000],
    },
)
```

> **Note**: Truncate prompts and completions to keep span sizes
> reasonable. 1000 characters for prompts and 2000 for
> completions is a practical limit.

### Error Handling

Record exceptions on spans and track error metrics:

```python showLineNumbers title="llm.py - error handling"
try:
    response = await provider.generate(
        model=model, system=system, prompt=prompt,
        temperature=temperature, max_tokens=max_tokens,
    )
except Exception as e:
    span.record_exception(e)
    span.set_attribute(
        "error.type", type(e).__name__
    )

    error_counter.add(
        1,
        {
            "gen_ai.provider.name": provider_name,
            "gen_ai.request.model": model,
            "error.type": type(e).__name__,
        },
    )
    raise
```

## Token and Cost Tracking

Token usage and cost are the most critical metrics for AI
applications. Auto-instrumentation cannot capture these — the
information is inside the LLM SDK response, not in HTTP headers.

### Defining GenAI Metrics

```python showLineNumbers title="llm.py - metric definitions"
from opentelemetry import metrics

meter = metrics.get_meter("gen_ai.client")

token_usage = meter.create_histogram(
    name="gen_ai.client.token.usage",
    description="Tokens used per LLM call",
    unit="{token}",
)

operation_duration = meter.create_histogram(
    name="gen_ai.client.operation.duration",
    description="Duration of GenAI operations",
    unit="s",
)

cost_counter = meter.create_counter(
    name="gen_ai.client.cost",
    description="Cost of GenAI operations in USD",
    unit="usd",
)
```

### Recording Token Usage

Record input and output tokens separately for analysis:

```python showLineNumbers title="llm.py - recording tokens"
base_attrs = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": provider,
    "gen_ai.request.model": model,
    "gen_ai.response.model": response.model,
    "server.address": server_address,
}

# Separate input/output for per-direction analysis
token_usage.record(
    response.input_tokens,
    {**base_attrs, "gen_ai.token.type": "input"},
)
token_usage.record(
    response.output_tokens,
    {**base_attrs, "gen_ai.token.type": "output"},
)

operation_duration.record(duration_seconds, base_attrs)
```

### Cost Calculation and Attribution

Define pricing per model and record costs with business context
for attribution:

```mdx-code-block
<Tabs groupId="llm-provider">
<TabItem value="anthropic" label="Anthropic" default>
```

```python showLineNumbers title="pricing.py - Anthropic models"
MODEL_PRICING = {
    "claude-opus-4-20250514": {
        "input": 15.0,
        "output": 75.0,
    },
    "claude-sonnet-4-20250514": {
        "input": 3.0,
        "output": 15.0,
    },
    "claude-haiku-3-5-20241022": {
        "input": 0.80,
        "output": 4.0,
    },
}
```

```mdx-code-block
</TabItem>
<TabItem value="openai" label="OpenAI">
```

```python showLineNumbers title="pricing.py - OpenAI models"
MODEL_PRICING = {
    "gpt-4o": {"input": 2.50, "output": 10.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "o1": {"input": 15.0, "output": 60.0},
    "o1-mini": {"input": 1.10, "output": 4.40},
}
```

```mdx-code-block
</TabItem>
<TabItem value="google" label="Google Gemini">
```

```python showLineNumbers title="pricing.py - Google models"
MODEL_PRICING = {
    "gemini-3-flash": {"input": 0.50, "output": 3.0},
    "gemini-3-pro-preview": {
        "input": 2.0,
        "output": 12.0,
    },
    "gemini-2.5-pro": {
        "input": 1.25,
        "output": 10.0,
    },
    "gemini-2.5-flash": {
        "input": 0.30,
        "output": 2.50,
    },
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

All pricing is per million tokens. The cost calculation and
metric recording is the same regardless of provider:

```python showLineNumbers title="llm.py - cost calculation"
def calculate_cost(
    model: str, input_tokens: int, output_tokens: int
) -> float:
    """Calculate cost in USD for a model call."""
    pricing = MODEL_PRICING.get(
        model, {"input": 0.0, "output": 0.0}
    )
    return (
        input_tokens * pricing["input"]
        + output_tokens * pricing["output"]
    ) / 1_000_000


# Record cost with business context
cost = calculate_cost(
    model, response.input_tokens, response.output_tokens
)

cost_attrs = {**base_attrs}
if agent_name:
    cost_attrs["gen_ai.agent.name"] = agent_name
if campaign_id:
    cost_attrs["campaign_id"] = campaign_id

cost_counter.add(cost, cost_attrs)

# Also record on span for per-request visibility
span.set_attribute("gen_ai.usage.cost_usd", cost)
```

This enables queries like:

```text showLineNumbers title="Example queries in base14 Scout"
# Cost by agent
sum(gen_ai.client.cost) by (gen_ai.agent.name)

# Token usage by model
sum(gen_ai.client.token.usage) by (gen_ai.request.model)

# Cost per campaign
sum(gen_ai.client.cost) by (campaign_id)
```

## Agent Pipeline Observability

Agent orchestration frameworks like LangGraph do not have
OpenTelemetry auto-instrumentation. Custom spans are required
to track which agent is executing, how long each step takes,
and where errors occur.

### Wrapping Agent Nodes

Create a wrapper function that adds an OTel span around each
agent in your pipeline:

```python showLineNumbers title="graph.py"
from opentelemetry import trace

tracer = trace.get_tracer("gen_ai.agent")


def wrap_agent(name, agent_fn, needs_session=False):
    """Wrap an agent function with OTel agent span."""

    async def wrapped(state):
        with tracer.start_as_current_span(
            f"invoke_agent {name}"
        ) as span:
            # Required attributes (GenAI agent semconv)
            span.set_attribute(
                "gen_ai.operation.name", "invoke_agent"
            )
            span.set_attribute("gen_ai.agent.name", name)

            # Business context
            span.set_attribute(
                "campaign_id", state.campaign_id
            )

            if needs_session:
                result = await agent_fn(state, session)
            else:
                result = await agent_fn(state)

            span.set_attribute(
                "errors_count", len(result.errors)
            )
            return result

    return wrapped
```

### Building the Pipeline

```python showLineNumbers title="graph.py - pipeline construction"
from langgraph.graph import END, START, StateGraph


def create_pipeline(session):
    """Create instrumented LangGraph pipeline."""
    graph = StateGraph(AgentState)

    graph.add_node(
        "research",
        wrap_agent(
            "research", research_agent,
            needs_session=True,
        ),
    )
    graph.add_node(
        "enrich",
        wrap_agent("enrich", enrich_agent),
    )
    graph.add_node(
        "score",
        wrap_agent("score", score_agent),
    )
    graph.add_node(
        "draft",
        wrap_agent("draft", draft_agent),
    )
    graph.add_node(
        "evaluate",
        wrap_agent("evaluate", evaluate_agent),
    )

    graph.add_edge(START, "research")
    graph.add_edge("research", "enrich")
    graph.add_edge("enrich", "score")
    graph.add_edge("score", "draft")
    graph.add_edge("draft", "evaluate")
    graph.add_edge("evaluate", END)

    return graph.compile()
```

### Pipeline-Level Span

Wrap the entire pipeline run in a parent span to capture
aggregate metrics:

```python showLineNumbers title="graph.py - pipeline run"
async def run_pipeline(
    campaign_id, target_keywords, target_titles, session,
    score_threshold=50, quality_threshold=60,
):
    """Run pipeline with top-level observability span."""
    with tracer.start_as_current_span(
        "pipeline.run"
    ) as span:
        span.set_attribute("campaign_id", campaign_id)
        span.set_attribute(
            "target_keywords", target_keywords
        )

        initial_state = AgentState(
            campaign_id=campaign_id,
            target_keywords=target_keywords,
            target_titles=target_titles,
            score_threshold=score_threshold,
            quality_threshold=quality_threshold,
        )

        pipeline = create_pipeline(session)
        result = await pipeline.ainvoke(initial_state)

        # Record pipeline outcome on span
        span.set_attribute(
            "prospects_found", len(result.prospects)
        )
        span.set_attribute(
            "drafts_generated", len(result.drafts)
        )
        span.set_attribute(
            "evaluations_passed",
            sum(
                1
                for e in result.evaluations
                if e.passed
            ),
        )

        return result
```

## Evaluation and Quality Metrics

LLM output quality is a first-class observability concern. The
OpenTelemetry GenAI semantic conventions define evaluation events
and metrics for tracking quality over time.

### Recording Evaluation Events

```python showLineNumbers title="agents/evaluate.py"
from opentelemetry import metrics, trace

tracer = trace.get_tracer("gen_ai.evaluation")
meter = metrics.get_meter("gen_ai.evaluation")

evaluation_score = meter.create_histogram(
    name="gen_ai.evaluation.score",
    description="Quality evaluation scores (0-1 normalized)",
    unit="1",
)


async def evaluate_draft(draft, campaign_id, threshold):
    """Evaluate draft quality with OTel events."""
    with tracer.start_as_current_span(
        "evaluate.draft"
    ) as span:
        span.set_attribute(
            "prospect_id", draft.prospect_id
        )

        score = await run_quality_check(draft)
        passed = score >= threshold

        span.set_attribute("quality_score", score)
        span.set_attribute("passed", passed)

        # GenAI evaluation event (semconv)
        span.add_event(
            "gen_ai.evaluation.result",
            attributes={
                "gen_ai.evaluation.name": (
                    "email_quality"
                ),
                "gen_ai.evaluation.score.value": score,
                "gen_ai.evaluation.score.label": (
                    "passed" if passed else "failed"
                ),
                "gen_ai.evaluation.explanation": (
                    feedback[:200]
                ),
            },
        )

        # Record metric for dashboards
        evaluation_score.record(
            score / 100.0,
            {
                "gen_ai.evaluation.name": (
                    "email_quality"
                ),
                "gen_ai.evaluation.score.label": (
                    "passed" if passed else "failed"
                ),
                "campaign_id": campaign_id,
            },
        )

        return EvaluationResult(
            quality_score=score,
            passed=passed,
            feedback=feedback,
        )
```

### GenAI Evaluation Event Attributes

| Attribute                        | Type   | Description                              |
| -------------------------------- | ------ | ---------------------------------------- |
| `gen_ai.evaluation.name`        | string | Evaluation name (e.g., `"email_quality"`) |
| `gen_ai.evaluation.score.value` | number | Raw score value                          |
| `gen_ai.evaluation.score.label` | string | `"passed"` or `"failed"`                 |
| `gen_ai.evaluation.explanation` | string | Human-readable feedback                  |

## PII and Security

LLM prompts and completions often contain personally identifiable
information. Recording raw prompts in telemetry creates a
compliance risk. Scrub PII before adding prompt or completion
events to spans.

### PII Scrubbing

```python showLineNumbers title="pii.py"
import re
from dataclasses import dataclass


@dataclass
class PIIPattern:
    name: str
    pattern: re.Pattern[str]
    replacement: str


DEFAULT_PATTERNS = [
    PIIPattern(
        "email",
        re.compile(
            r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+"
            r"\.[A-Z|a-z]{2,}\b"
        ),
        "[EMAIL]",
    ),
    PIIPattern(
        "phone",
        re.compile(
            r"(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?"
            r"[0-9]{3}[-.\s]?[0-9]{4}\b"
        ),
        "[PHONE]",
    ),
    PIIPattern(
        "linkedin",
        re.compile(
            r"https?://(?:www\.)?linkedin\.com"
            r"/in/[A-Za-z0-9_-]+/?"
        ),
        "[LINKEDIN_URL]",
    ),
    PIIPattern(
        "ssn",
        re.compile(r"\b\d{3}[-]?\d{2}[-]?\d{4}\b"),
        "[SSN]",
    ),
]


def scrub_pii(text: str) -> str:
    """Replace PII with safe placeholders."""
    result = text
    for p in DEFAULT_PATTERNS:
        result = p.pattern.sub(p.replacement, result)
    return result
```

### Applying PII Scrubbing to Telemetry

Always scrub before recording span events:

```python showLineNumbers title="llm.py - PII-safe events"
from my_app.pii import scrub_pii

# Record prompt with PII scrubbed and truncated
span.add_event(
    "gen_ai.user.message",
    attributes={
        "gen_ai.prompt": scrub_pii(prompt)[:1000],
        "gen_ai.system": scrub_pii(system)[:500],
    },
)

# Record completion with PII scrubbed and truncated
span.add_event(
    "gen_ai.assistant.message",
    attributes={
        "gen_ai.completion": scrub_pii(
            response.content
        )[:2000],
    },
)
```

### Security Considerations

- **Never record raw prompts** that may contain user data, API
  keys, or credentials in span attributes or events
- **Truncate content** to avoid oversized spans (1000 chars for
  prompts, 2000 for completions)
- **Disable prompt recording** in production if compliance
  requirements prohibit it — the GenAI span attributes (model,
  tokens, cost) still provide full operational visibility
- **Use the OTel Collector `attributes` processor** to redact
  sensitive fields before export if additional filtering is needed
- **GDPR/HIPAA**: If prompts may contain regulated data, consider
  recording only token counts and model metadata, not content

## Production Configuration

### Environment Variables

```bash showLineNumbers title=".env"
# Application
OTEL_SERVICE_NAME=my-ai-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_ENABLED=true
SCOUT_ENVIRONMENT=production

# LLM Provider
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...

# Fallback (optional)
FALLBACK_PROVIDER=google
FALLBACK_MODEL=gemini-3-flash
GOOGLE_API_KEY=...
```

### OpenTelemetry Collector Configuration

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  zpages:
    endpoint: 0.0.0.0:55679
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
  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048
  attributes:
    actions:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlphttp/b14:
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
    verbosity: basic
    sampling_initial: 5
    sampling_thereafter: 200

service:
  extensions:
    [health_check, zpages, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors:
        [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
    metrics:
      receivers: [otlp]
      processors:
        [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
    logs:
      receivers: [otlp]
      processors:
        [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
```

### Docker Compose Deployment

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/mydb
      - OTEL_SERVICE_NAME=my-ai-service
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_ENABLED=true
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 60s
      timeout: 5s
      retries: 3

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
    image: otel/opentelemetry-collector-contrib:0.127.0
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

## Retry and Fallback Observability

LLM APIs are inherently unreliable. Retries and provider
fallbacks should be observable so you can track error rates,
retry frequency, and fallback triggers.

### Retry Metrics

```python showLineNumbers title="llm.py - retry instrumentation"
from opentelemetry import metrics
from tenacity import (
    RetryCallState,
    retry,
    stop_after_attempt,
    wait_exponential,
)

meter = metrics.get_meter("gen_ai.client")

retry_counter = meter.create_counter(
    name="gen_ai.client.retry.count",
    description="Number of retry attempts",
    unit="{retry}",
)
fallback_counter = meter.create_counter(
    name="gen_ai.client.fallback.count",
    description="Number of fallback triggers",
    unit="{fallback}",
)
error_counter = meter.create_counter(
    name="gen_ai.client.error.count",
    description="Number of errors by type",
    unit="{error}",
)


def on_retry(retry_state: RetryCallState):
    """Record retry metric before each attempt."""
    error_type = "unknown"
    if (
        retry_state.outcome
        and retry_state.outcome.exception()
    ):
        error_type = type(
            retry_state.outcome.exception()
        ).__name__

    retry_counter.add(
        1,
        {
            "gen_ai.provider.name": provider_name,
            "error.type": error_type,
            "retry.attempt": (
                retry_state.attempt_number
            ),
        },
    )


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(
        multiplier=1, min=1, max=10
    ),
    before_sleep=on_retry,
)
async def generate(self, model, system, prompt, **kw):
    """LLM call with automatic retry."""
    ...
```

### Fallback Instrumentation

When the primary provider fails, record the fallback trigger
on both the span and as a metric:

```python showLineNumbers title="llm.py - fallback tracking"
except Exception as e:
    span.record_exception(e)
    span.set_attribute("error.type", type(e).__name__)

    if use_fallback and provider != fallback_provider:
        span.set_attribute(
            "gen_ai.fallback.triggered", True
        )

        fallback_counter.add(
            1,
            {
                "gen_ai.provider.name": provider,
                "gen_ai.fallback.provider": (
                    fallback_provider
                ),
                "error.type": type(e).__name__,
            },
        )

        # Retry with fallback provider
        return await self.generate(
            prompt=prompt,
            system=system,
            provider=fallback_provider,
            model=fallback_model,
            use_fallback=False,
        )
    raise
```

## Troubleshooting

### Verify Telemetry Is Working

Check that the OTel Collector is receiving data:

```bash showLineNumbers title="Verify collector health"
# Check collector health
curl http://localhost:13133

# View recent traces in zpages debug UI
# Open http://localhost:55679/debug/tracez in a browser
```

### Enable Debug Mode

Set debug-level logging to see span exports:

```python showLineNumbers title="Debug logging"
import logging

logging.getLogger("opentelemetry").setLevel(
    logging.DEBUG
)
```

### Common Issues

#### Issue: LLM spans not appearing in traces

The custom `gen_ai.chat` span exists but is not connected to
the HTTP request trace.

**Solutions:**

1. Ensure `setup_telemetry()` is called **before** creating
   the FastAPI app
2. Verify `HTTPXClientInstrumentor().instrument()` is called
   during setup — this creates the parent HTTP span that the
   custom span nests under
3. Check that the `gen_ai.chat` span is created inside an
   async context where the trace context is propagated

#### Issue: Token counts are zero

**Solutions:**

1. Check your LLM SDK version — older versions may not expose
   `usage` on the response object
2. Verify the provider response object has `input_tokens` and
   `output_tokens` fields (naming varies by provider)
3. For Google GenAI, check `response.usage_metadata` instead
   of `response.usage`

#### Issue: Cost metrics not accurate

**Solutions:**

1. Verify your `MODEL_PRICING` dictionary contains the exact
   model ID string returned by the provider (e.g.,
   `claude-sonnet-4-20250514`, not `claude-sonnet-4`)
2. Check that cost is calculated with `/1_000_000` (pricing is
   per million tokens)

#### Issue: Spans not exported to Scout

**Solutions:**

1. Confirm the OTel Collector is running:
   `curl http://localhost:13133`
2. Check collector logs:
   `docker compose logs otel-collector`
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` points to the
   collector, not directly to Scout
4. Ensure `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` are set
   in the collector environment

## Performance Considerations

OpenTelemetry overhead is negligible relative to LLM API
latency. A typical LLM call takes 1-5 seconds; span creation
and metric recording add microseconds.

### Impact Factors

- **Span creation**: ~1-5 microseconds per span
- **Attribute setting**: ~0.5 microseconds per attribute
- **Metric recording**: ~1 microsecond per record
- **Batch export**: Happens in background thread, no request
  impact

### Optimization Strategies

#### 1. Use BatchSpanProcessor in Production

The `BatchSpanProcessor` batches spans before export, avoiding
per-span network calls:

```python showLineNumbers title="Production trace setup"
trace_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint=endpoint),
        max_queue_size=2048,
        max_export_batch_size=512,
        schedule_delay_millis=5000,
    )
)
```

#### 2. Truncate Prompt and Completion Events

Long prompts and completions increase span payload size. Always
truncate:

```python showLineNumbers title="Truncation"
span.add_event(
    "gen_ai.user.message",
    attributes={
        "gen_ai.prompt": scrub_pii(prompt)[:1000],
    },
)
```

#### 3. Disable Prompt Recording in High-Volume Scenarios

If you process thousands of LLM calls per minute and do not
need prompt data in traces, skip the event recording:

```python showLineNumbers title="Conditional recording"
if settings.record_prompts:
    span.add_event(
        "gen_ai.user.message",
        attributes={
            "gen_ai.prompt": scrub_pii(prompt)[:1000],
        },
    )
```

#### 4. Use the Collector Memory Limiter

The OTel Collector `memory_limiter` processor prevents
out-of-memory issues under heavy load:

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128
```

## FAQ

### Does OpenTelemetry add latency to LLM calls?

No. Span creation takes microseconds. LLM API calls take
seconds. The overhead is unmeasurable in practice.
`BatchSpanProcessor` exports spans in a background thread, so
export does not block request handling.

### How do I track cost across multiple LLM providers?

Use the `gen_ai.client.cost` counter metric with
`gen_ai.provider.name` and `gen_ai.request.model` attributes.
Define a pricing dictionary per model and calculate cost from
token counts. This gives you `sum(cost) by (provider)` in
your dashboards.

### Can I see the actual prompts and completions in traces?

Yes, if you record them as `gen_ai.user.message` and
`gen_ai.assistant.message` span events. Always scrub PII first.
You can disable prompt recording in production for compliance.

### How does this compare to LangSmith?

LangSmith provides deep LLM-specific tracing but operates in
isolation from your HTTP and database telemetry. OpenTelemetry
gives you a single trace that spans all layers. You can see
that a slow HTTP response was caused by a specific LLM call in
a specific agent, and that the same request also ran 3 database
queries. LangSmith cannot show that correlation.

### Do I need to instrument each LLM provider separately?

No. Use a provider-agnostic abstraction (like the `LLMClient`
pattern shown in this guide) that wraps all providers with the
same span structure. The `gen_ai.provider.name` attribute
identifies which provider handled each call.

### How do I monitor LLM evaluation quality over time?

Record `gen_ai.evaluation.score` as a histogram metric with
`gen_ai.evaluation.name` and
`gen_ai.evaluation.score.label` attributes. This lets you
track pass rates, score distributions, and quality trends per
evaluation type in your dashboards.

### What if my agent framework supports tracing natively?

Some frameworks (e.g., LangChain) have their own tracing. You
can still use OpenTelemetry alongside or instead. The key
advantage of OpenTelemetry is portability — your traces work
with any backend (base14 Scout, Jaeger, Grafana Tempo, etc.)
without vendor lock-in.

### How do I reduce trace volume for high-throughput AI apps?

Use head-based sampling in the OTel Collector or SDK. For AI
applications, a practical approach is to sample 100% of error
traces and a percentage of successful traces. The
`probabilistic_sampler` processor in the collector handles
this.

### Can I track which agent is the most expensive?

Yes. Set `gen_ai.agent.name` as an attribute on both the
`gen_ai.chat` span and the `gen_ai.client.cost` metric. This
enables `sum(gen_ai.client.cost) by (gen_ai.agent.name)` in
your dashboards.

### How do I add observability to an existing AI app?

Start with auto-instrumentation (FastAPI, SQLAlchemy, httpx)
— this requires no code changes. Then add custom LLM spans in
your LLM client layer. Finally, add agent-level spans if you
use an orchestration framework. Each layer adds value
independently.

## What's Next?

### Advanced Topics

- [Python Custom Instrumentation][py-custom] -
  Manual tracing and metrics for Python applications
- [FastAPI Auto-Instrumentation][fastapi-auto] -
  Comprehensive FastAPI instrumentation guide

### Scout Platform Features

- [Creating Alerts](../creating-alerts-with-logx.md) -
  Set up alerts for LLM error rates, cost spikes, or quality
  degradation
- [Create Your First Dashboard](../create-your-first-dashboard.md)
  \- Build dashboards for token usage, cost attribution, and
  evaluation scores

### Deployment and Operations

- [Docker Compose Setup][docker-setup] -
  Local development with the OTel Collector
- [Kubernetes Helm Setup][k8s-setup] -
  Production deployment
- [Scout Exporter][scout-exporter] -
  Configure authentication with base14 Scout

## Complete Example

The
[AI Sales Intelligence](https://github.com/base14/examples/tree/main/python/ai-sales-intelligence)
example application implements every pattern described in this
guide. It is a FastAPI + LangGraph + multi-provider LLM
application with full OpenTelemetry instrumentation.

### Project Structure

```text showLineNumbers title="Project structure"
ai-sales-intelligence/
├── src/sales_intelligence/
│   ├── telemetry.py        # OTel setup (auto + custom)
│   ├── llm.py              # LLM client with GenAI spans
│   ├── graph.py            # LangGraph pipeline with agent spans
│   ├── agents/
│   │   ├── research.py     # Database search agent
│   │   ├── enrich.py       # LLM enrichment agent
│   │   ├── score.py        # LLM scoring agent
│   │   ├── draft.py        # LLM email draft agent
│   │   └── evaluate.py     # LLM quality evaluation agent
│   ├── pii.py              # PII scrubbing for telemetry
│   ├── config.py           # Provider-agnostic settings
│   ├── main.py             # FastAPI application
│   └── middleware/
│       └── metrics.py      # HTTP request metrics
├── otel-collector-config.yaml
├── compose.yml
└── pyproject.toml
```

### Key Files

| File           | Demonstrates                                    |
| -------------- | ----------------------------------------------- |
| `telemetry.py` | Auto-instrumentation setup                      |
| `llm.py`       | GenAI spans, token/cost metrics, retry/fallback |
| `graph.py`     | Agent pipeline spans with LangGraph             |
| `evaluate.py`  | Evaluation events and quality metrics           |
| `pii.py`       | PII scrubbing before telemetry recording        |
| `config.py`    | Provider-agnostic settings with Pydantic        |
| `compose.yml`  | Docker deployment with OTel Collector           |

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)

## Related Guides

- [Python Custom Instrumentation][py-custom] -
  Manual tracing and metrics fundamentals
- [FastAPI Auto-Instrumentation][fastapi-auto] -
  Comprehensive FastAPI setup
- [Docker Compose Setup][docker-setup] -
  Local collector deployment
- [Scout Exporter][scout-exporter] -
  Configure base14 Scout authentication

[py-custom]: ../../instrument/apps/custom-instrumentation/python.md
[fastapi-auto]: ../../instrument/apps/auto-instrumentation/fast-api.md
[docker-setup]: ../../instrument/collector-setup/docker-compose-example.md
[k8s-setup]: ../../instrument/collector-setup/kubernetes-helm-setup.md
[scout-exporter]: ../../instrument/collector-setup/scout-exporter.md
