---
title:
  LangGraph OpenTelemetry Instrumentation - Complete AI Agent Monitoring
  Guide | base14 Scout
sidebar_label: LangGraph
sidebar_position: 10
description:
  Complete guide to LangGraph OpenTelemetry instrumentation for AI agent
  pipeline monitoring. Trace agent nodes, conditional routing, tool calls,
  track tokens and costs, monitor state transitions with base14 Scout.
keywords:
  [
    langgraph opentelemetry instrumentation,
    langgraph tracing,
    ai agent monitoring,
    langgraph observability,
    langgraph agent pipeline tracing,
    python ai agent apm,
    opentelemetry langgraph python,
    langgraph telemetry,
    langgraph metrics,
    langgraph spans,
    llm token tracking,
    llm cost monitoring,
    genai semantic conventions,
    langgraph conditional edges,
    langgraph tool calling,
    langgraph state management,
    ai agent production monitoring,
    langgraph instrumentation guide,
    multi-provider llm,
  ]
---

# LangGraph

Implement OpenTelemetry instrumentation for LangGraph applications to
enable comprehensive AI agent pipeline monitoring, LLM cost tracking,
and end-to-end trace visibility. This guide shows you how to instrument
a LangGraph-powered agent pipeline with custom GenAI semantic convention
spans, conditional edge routing observability, tool-calling node traces,
multi-provider LLM support, token and cost metrics, PII scrubbing, and
production deployment with Docker Compose.

LangGraph applications present unique observability challenges beyond
standard LLM calls. An agent pipeline involves multiple nodes executing
sequentially or conditionally, each potentially making LLM calls,
database queries, or tool invocations. Without instrumentation, you
cannot see which node is slow, which routing decision was taken, or how
much each agent step costs. OpenTelemetry bridges this gap by letting
you wrap every node, edge, and tool call with spans that carry
LangGraph-specific context alongside standard HTTP and database
telemetry.

Whether you're building multi-step agent pipelines, sales automation
workflows, RAG systems with agent orchestration, or any application
that uses LangGraph's StateGraph for complex control flow, this guide
provides production-ready patterns for unified AI agent observability
where every node execution, routing decision, LLM call, and database
query lives in a single trace on base14 Scout.

> **Note:** For general LLM observability patterns applicable to any
> Python framework, see the
> [LLM Observability guide](../../../guides/ai-observability/llm-observability.md).
> This guide focuses specifically on LangGraph integration patterns.

## Who This Guide Is For

This documentation is designed for:

- **AI/ML engineers**: building LangGraph agent pipelines and needing
  visibility into node performance, routing decisions, and cost
- **Backend developers**: adding agent orchestration to existing FastAPI
  applications and wanting unified tracing across all layers
- **Platform teams**: standardizing observability across AI agent
  services and traditional microservices
- **Engineering teams**: migrating from LangSmith tracing to
  OpenTelemetry for vendor-neutral observability
- **DevOps engineers**: deploying LangGraph applications with production
  monitoring, cost alerting, and pipeline health tracking

## Overview

This guide demonstrates how to:

- Set up unified OpenTelemetry for a LangGraph application
  (traces + metrics + logs)
- Wrap LangGraph nodes with `wrap_agent` for automatic span creation
- Instrument conditional edge routing with span attributes for
  routing decisions
- Trace tool-calling nodes with dedicated tool spans
- Create a pipeline-level parent span for aggregate metrics
- Track token usage and calculate cost per LLM call with a pricing
  table
- Record evaluation metrics for agent output quality tracking
- Scrub PII from prompts and completions before recording in telemetry
- Support multiple LLM providers (Anthropic, OpenAI, Google) through
  a single interface
- Deploy with Docker Compose and the OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- **Python 3.12 or later** installed (3.13+ recommended)
- **An LLM API key** from at least one provider (Anthropic, OpenAI,
  or Google)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics)
- Familiarity with LangGraph's StateGraph API

### Compatibility Matrix

| Component               | Minimum Version | Recommended     |
| ----------------------- | --------------- | --------------- |
| Python                  | 3.12            | 3.13+           |
| LangGraph               | 0.2             | 1.0.6+          |
| langgraph-core          | 0.2             | 0.3.38+         |
| langchain-core          | 0.3             | 0.3.63+         |
| opentelemetry-sdk       | 1.39.0          | 1.39.1+         |
| opentelemetry-api       | 1.39.0          | 1.39.1+         |
| FastAPI                 | 0.115+          | 0.128+          |
| SQLAlchemy              | 2.0             | 2.0.45+         |
| Anthropic SDK           | 0.40+           | 0.76+           |
| OpenAI SDK              | 1.0+            | 1.60+           |
| Google GenAI SDK        | 1.0+            | 1.59+           |

## Installation

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
  opentelemetry-instrumentation-logging \
  langgraph langchain-core \
  anthropic openai google-genai \
  fastapi uvicorn pydantic-settings \
  asyncpg sqlalchemy tenacity httpx
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
  opentelemetry-instrumentation-logging \
  langgraph langchain-core \
  anthropic openai google-genai \
  fastapi uvicorn pydantic-settings \
  asyncpg sqlalchemy tenacity httpx
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

```mdx-code-block
<Tabs>
<TabItem value="module" label="Telemetry Module (Recommended)" default>
```

```python showLineNumbers title="src/sales_intelligence/telemetry.py"
import atexit
import logging
import os

from opentelemetry import _logs, metrics, trace
from opentelemetry.exporter.otlp.proto.http._log_exporter import (
    OTLPLogExporter,
)
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
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_telemetry(
    service_name: str,
    otlp_endpoint: str,
    engine=None,
) -> tuple[trace.Tracer, metrics.Meter]:
    """Initialize unified observability: traces, metrics, logs.

    Auto-instruments HTTP, database, and httpx layers.
    LangGraph agent spans and GenAI spans are handled by
    custom instrumentation in graph.py and llm.py.
    """
    if os.environ.get("OTEL_SDK_DISABLED") == "true":
        return (
            trace.get_tracer(service_name),
            metrics.get_meter(service_name),
        )

    resource = Resource.create({
        "service.name": service_name,
        "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
        "deployment.environment": os.getenv(
            "SCOUT_ENVIRONMENT", "development"
        ),
    })

    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(
                endpoint=f"{otlp_endpoint}/v1/traces"
            )
        )
    )
    trace.set_tracer_provider(trace_provider)

    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(
            endpoint=f"{otlp_endpoint}/v1/metrics"
        ),
        export_interval_millis=10000,
    )
    metric_provider = MeterProvider(
        resource=resource, metric_readers=[metric_reader]
    )
    metrics.set_meter_provider(metric_provider)

    log_provider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(
        BatchLogRecordProcessor(
            OTLPLogExporter(
                endpoint=f"{otlp_endpoint}/v1/logs"
            )
        )
    )
    _logs.set_logger_provider(log_provider)
    logging.getLogger().addHandler(
        LoggingHandler(
            level=logging.INFO, logger_provider=log_provider
        )
    )

    atexit.register(trace_provider.shutdown)
    atexit.register(metric_provider.shutdown)
    atexit.register(log_provider.shutdown)

    HTTPXClientInstrumentor().instrument()
    LoggingInstrumentor().instrument(set_logging_format=True)

    if engine:
        SQLAlchemyInstrumentor().instrument(
            engine=engine.sync_engine
        )

    return (
        trace.get_tracer(service_name),
        metrics.get_meter(service_name),
    )


def instrument_fastapi(app) -> None:
    from opentelemetry.instrumentation.fastapi import (
        FastAPIInstrumentor,
    )

    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="health",
        exclude_spans=["receive", "send"],
    )
```

```mdx-code-block
</TabItem>
<TabItem value="config" label="Pydantic Settings">
```

```python showLineNumbers title="src/sales_intelligence/config.py"
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "ai-sales-intelligence"
    database_url: str = (
        "postgresql+asyncpg://postgres:postgres"
        "@localhost:5432/sales"
    )
    llm_provider: str = "anthropic"
    llm_model: str = "claude-sonnet-4-20250514"
    llm_temperature: float = 0.7
    llm_timeout: float = 30.0
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""
    fallback_provider: str = ""
    fallback_model: str = ""
    score_threshold: int = 50
    quality_threshold: int = 60
    request_timeout: float = 120.0
    otlp_endpoint: str = "http://otel-collector:4318"
    otel_sdk_disabled: bool = False
    scout_environment: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

For container deployments where configuration is managed externally:

```bash showLineNumbers title=".env"
# Application
SERVICE_NAME=ai-sales-intelligence
DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/sales
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
LLM_TEMPERATURE=0.7
LLM_TIMEOUT=30.0
REQUEST_TIMEOUT=120.0
HOST=0.0.0.0
PORT=8000

# Agent Pipeline
SCORE_THRESHOLD=50
QUALITY_THRESHOLD=60

# LLM Provider Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=
GOOGLE_API_KEY=

# Fallback Provider (optional)
FALLBACK_PROVIDER=openai
FALLBACK_MODEL=gpt-4.1-mini

# OpenTelemetry
OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SDK_DISABLED=false
SCOUT_ENVIRONMENT=production
```

The Pydantic `Settings` class reads all environment variables
automatically (see the Pydantic Settings tab). No code changes
needed — set the variables and the application picks them up.

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### OpenTelemetry Collector

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
  batch:
    timeout: 10s
    send_batch_size: 1024
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
  debug:
    verbosity: basic

service:
  extensions: [health_check, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14, debug]
```

### Docker Compose

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/sales
      - OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SDK_DISABLED=false
      - LLM_PROVIDER=${LLM_PROVIDER:-anthropic}
      - LLM_MODEL=${LLM_MODEL:-claude-sonnet-4-20250514}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY:-}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 60s
      timeout: 5s
      retries: 3

  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: sales
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
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

### Dockerfile

```dockerfile showLineNumbers title="Dockerfile"
FROM python:3.13-slim
WORKDIR /app

RUN pip install --no-cache-dir uv && \
    apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --no-dev

COPY src/ src/

ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uv", "run", "uvicorn", "sales_intelligence.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]
```

## Framework-Specific Features

This section covers LangGraph-specific instrumentation patterns that
go beyond generic LLM observability. These patterns give you visibility
into the agent orchestration layer — which nodes executed, what routing
decisions were made, how state flowed through the pipeline, and where
time was spent.

### State Definition

Define the pipeline state as a TypedDict. LangGraph passes this state
object between nodes, and each node returns updates to merge back:

```python showLineNumbers title="src/sales_intelligence/state.py"
from dataclasses import dataclass, field
from typing import TypedDict


@dataclass
class Prospect:
    name: str
    title: str
    company: str
    score: int = 0
    enrichment: str = ""
    draft: str = ""


@dataclass
class Evaluation:
    prospect_id: str
    quality_score: int
    passed: bool
    feedback: str = ""


class AgentState(TypedDict, total=False):
    campaign_id: str
    target_keywords: list[str]
    target_titles: list[str]
    score_threshold: int
    quality_threshold: int
    prospects: list[Prospect]
    drafts: list[str]
    evaluations: list[Evaluation]
    errors: list[str]
```

### Node Instrumentation with `wrap_agent`

Create a wrapper function that adds an OTel span around each
LangGraph node. Every node execution becomes a child span of
the pipeline span, carrying the agent name and business context:

```python showLineNumbers title="src/sales_intelligence/graph.py"
from opentelemetry import trace
from opentelemetry.trace import StatusCode

tracer = trace.get_tracer("gen_ai.agent")


def wrap_agent(name, agent_fn, needs_session=False):
    """Wrap a LangGraph node function with an OTel span.

    Each node receives the full AgentState and returns
    a partial dict to merge back into the state.
    """

    async def wrapped(state, config=None):
        with tracer.start_as_current_span(
            f"invoke_agent {name}"
        ) as span:
            span.set_attribute(
                "gen_ai.operation.name", "invoke_agent"
            )
            span.set_attribute("gen_ai.agent.name", name)
            span.set_attribute(
                "campaign_id", state.get("campaign_id", "")
            )

            try:
                if needs_session:
                    result = await agent_fn(state, session)
                else:
                    result = await agent_fn(state)

                errors = result.get("errors", [])
                span.set_attribute(
                    "agent.errors_count", len(errors)
                )
                return result

            except Exception as e:
                span.record_exception(e)
                span.set_status(
                    StatusCode.ERROR, str(e)
                )
                raise

    return wrapped
```

### Conditional Edge Routing

LangGraph's conditional edges let you branch the pipeline based
on state. Instrument the routing function to record which path
was taken and why:

```python showLineNumbers title="src/sales_intelligence/graph.py"
def route_after_score(state: AgentState) -> str:
    """Route based on whether any prospects passed scoring.

    Records the routing decision as span attributes so you
    can see in traces why a pipeline skipped drafting.
    """
    span = trace.get_current_span()
    prospects = state.get("prospects", [])
    threshold = state.get("score_threshold", 50)

    qualified = [
        p for p in prospects if p.score >= threshold
    ]

    span.set_attribute(
        "routing.total_prospects", len(prospects)
    )
    span.set_attribute(
        "routing.qualified_count", len(qualified)
    )
    span.set_attribute(
        "routing.threshold", threshold
    )

    if qualified:
        span.set_attribute("routing.decision", "draft")
        return "draft"

    span.set_attribute("routing.decision", "end")
    return "end"
```

### Building the Pipeline with Conditional Edges

```python showLineNumbers title="src/sales_intelligence/graph.py"
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

    graph.add_conditional_edges(
        "score",
        route_after_score,
        {"draft": "draft", "end": END},
    )

    graph.add_edge("draft", "evaluate")
    graph.add_edge("evaluate", END)

    return graph.compile()
```

### Tool-Calling Nodes

When agent nodes invoke tools (database searches, API calls,
calculations), wrap each tool invocation with a dedicated span:

```python showLineNumbers title="src/sales_intelligence/agents/research.py"
from opentelemetry import trace

tracer = trace.get_tracer("gen_ai.agent")


async def search_prospects(
    session, keywords: list[str], titles: list[str],
) -> list[dict]:
    """Database search tool with OTel instrumentation."""
    with tracer.start_as_current_span(
        "tool.search_prospects"
    ) as span:
        span.set_attribute(
            "gen_ai.operation.name", "tool"
        )
        span.set_attribute(
            "tool.name", "search_prospects"
        )
        span.set_attribute(
            "tool.keywords_count", len(keywords)
        )
        span.set_attribute(
            "tool.titles_count", len(titles)
        )

        query = build_search_query(keywords, titles)
        results = await session.execute(query)
        rows = results.fetchall()

        span.set_attribute(
            "tool.results_count", len(rows)
        )
        return [dict(r._mapping) for r in rows]


async def research_agent(state, session):
    """Research agent: finds prospects via database search."""
    prospects = await search_prospects(
        session,
        state["target_keywords"],
        state["target_titles"],
    )
    return {
        "prospects": [
            Prospect(
                name=p["name"],
                title=p["title"],
                company=p["company"],
            )
            for p in prospects
        ]
    }
```

### Pipeline-Level Parent Span

Wrap the entire pipeline run in a parent span to capture
aggregate metrics. All node spans become children of this span:

```python showLineNumbers title="src/sales_intelligence/graph.py"
async def run_pipeline(
    campaign_id: str,
    target_keywords: list[str],
    target_titles: list[str],
    session,
    score_threshold: int = 50,
    quality_threshold: int = 60,
):
    """Run the agent pipeline with a top-level span."""
    with tracer.start_as_current_span(
        "pipeline.run"
    ) as span:
        span.set_attribute("campaign_id", campaign_id)
        span.set_attribute(
            "target_keywords", target_keywords
        )
        span.set_attribute(
            "pipeline.score_threshold", score_threshold
        )
        span.set_attribute(
            "pipeline.quality_threshold",
            quality_threshold,
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

        span.set_attribute(
            "pipeline.prospects_found",
            len(result.get("prospects", [])),
        )
        span.set_attribute(
            "pipeline.drafts_generated",
            len(result.get("drafts", [])),
        )
        evaluations = result.get("evaluations", [])
        span.set_attribute(
            "pipeline.evaluations_passed",
            sum(1 for e in evaluations if e.passed),
        )

        return result
```

The resulting trace looks like this:

```text title="Unified trace for POST /campaigns/{id}/run"
POST /campaigns/{id}/run                           8.4s  [auto: FastAPI]
├─ db.query SELECT connections                    12ms   [auto: SQLAlchemy]
├─ pipeline.run                                    8.3s  [custom: pipeline]
│  ├─ invoke_agent research                       80ms   [custom: agent]
│  │  └─ tool.search_prospects                    45ms   [custom: tool]
│  │     └─ db.query SELECT ... tsvector          40ms   [auto: SQLAlchemy]
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

### Multi-Provider LLM Factory

Support multiple LLM providers through a single interface. Each
provider's API calls are automatically captured by the httpx
auto-instrumentor, while custom GenAI spans add model-specific
context:

```python showLineNumbers title="src/sales_intelligence/llm.py"
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from google import genai

PROVIDER_SERVERS = {
    "anthropic": "api.anthropic.com",
    "openai": "api.openai.com",
    "gcp.gemini": "generativelanguage.googleapis.com",
}


async def call_provider(
    provider: str,
    model: str,
    system: str,
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int = 1024,
):
    if provider == "anthropic":
        client = AsyncAnthropic()
        response = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[
                {"role": "user", "content": prompt}
            ],
        )
        content = response.content[0].text
        return LLMResponse(
            content=content,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            model=response.model,
        )

    if provider == "openai":
        client = AsyncOpenAI()
        response = await client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        choice = response.choices[0]
        return LLMResponse(
            content=choice.message.content or "",
            input_tokens=response.usage.prompt_tokens,
            output_tokens=response.usage.completion_tokens,
            model=response.model,
        )

    raise ValueError(f"Unknown provider: {provider!r}")
```

For detailed provider-specific handling including Google Gemini,
see the
[LLM Observability guide](../../../guides/ai-observability/llm-observability.md#custom-llm-instrumentation).

## Custom Manual Instrumentation

### GenAI Span Attributes

Create LLM spans following OpenTelemetry GenAI semantic conventions.
Each LLM call within an agent node becomes a child span with model,
token, and cost attributes:

```python showLineNumbers title="src/sales_intelligence/llm.py"
import time

from opentelemetry import trace
from opentelemetry.trace import StatusCode

tracer = trace.get_tracer("gen_ai.client")


async def generate(
    prompt: str,
    system: str,
    model: str,
    provider: str,
    agent_name: str | None = None,
    campaign_id: str | None = None,
) -> str:
    """Generate LLM completion with GenAI span."""
    server_address = PROVIDER_SERVERS.get(provider, "")

    with tracer.start_as_current_span(
        f"gen_ai.chat {model}"
    ) as span:
        span.set_attribute(
            "gen_ai.operation.name", "chat"
        )
        span.set_attribute(
            "gen_ai.provider.name", provider
        )
        span.set_attribute(
            "gen_ai.request.model", model
        )
        span.set_attribute(
            "gen_ai.request.temperature", 0.7
        )
        if server_address:
            span.set_attribute(
                "server.address", server_address
            )
        if agent_name:
            span.set_attribute(
                "gen_ai.agent.name", agent_name
            )
        if campaign_id:
            span.set_attribute(
                "campaign_id", campaign_id
            )

        start = time.perf_counter()

        try:
            response = await call_provider(
                provider, model, system, prompt
            )
            duration = time.perf_counter() - start

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

            _record_token_metrics(
                response, model, provider,
                agent_name, campaign_id, duration,
            )

            return response.content

        except Exception as e:
            span.record_exception(e)
            span.set_status(StatusCode.ERROR, str(e))
            span.set_attribute(
                "error.type", type(e).__name__
            )
            error_counter.add(1, {
                "gen_ai.request.model": model,
                "gen_ai.provider.name": provider,
                "error.type": type(e).__name__,
            })
            raise
```

### Custom GenAI Metrics

Define metrics following OpenTelemetry GenAI semantic conventions:

```python showLineNumbers title="src/sales_intelligence/llm.py"
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

error_counter = meter.create_counter(
    name="gen_ai.client.error.count",
    description="GenAI operation errors",
    unit="1",
)
```

### Token and Cost Tracking

Define pricing per model and record cost metrics with business
context for attribution by agent and campaign:

```python showLineNumbers title="src/sales_intelligence/llm.py"
MODEL_PRICING = {
    "claude-opus-4-20250514": {
        "input": 15.0, "output": 75.0,
    },
    "claude-sonnet-4-20250514": {
        "input": 3.0, "output": 15.0,
    },
    "claude-haiku-3-5-20241022": {
        "input": 0.80, "output": 4.0,
    },
    "gpt-4o": {"input": 2.50, "output": 10.0},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
}


def calculate_cost(
    model: str, input_tokens: int, output_tokens: int,
) -> float:
    pricing = MODEL_PRICING.get(
        model, {"input": 0.0, "output": 0.0}
    )
    return (
        input_tokens * pricing["input"]
        + output_tokens * pricing["output"]
    ) / 1_000_000


def _record_token_metrics(
    response, model, provider,
    agent_name, campaign_id, duration,
):
    base_attrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": provider,
        "gen_ai.request.model": model,
    }

    token_usage.record(
        response.input_tokens,
        {**base_attrs, "gen_ai.token.type": "input"},
    )
    token_usage.record(
        response.output_tokens,
        {**base_attrs, "gen_ai.token.type": "output"},
    )
    operation_duration.record(duration, base_attrs)

    cost = calculate_cost(
        model,
        response.input_tokens,
        response.output_tokens,
    )
    cost_attrs = {**base_attrs}
    if agent_name:
        cost_attrs["gen_ai.agent.name"] = agent_name
    if campaign_id:
        cost_attrs["campaign_id"] = campaign_id

    cost_counter.add(cost, cost_attrs)
```

### Evaluation Metrics

Track agent output quality as OpenTelemetry metrics and span
events:

```python showLineNumbers title="src/sales_intelligence/agents/evaluate.py"
from opentelemetry import metrics, trace

tracer = trace.get_tracer("gen_ai.evaluation")
meter = metrics.get_meter("gen_ai.evaluation")

evaluation_score = meter.create_histogram(
    name="gen_ai.evaluation.score",
    description="Quality evaluation scores",
    unit="1",
)


async def evaluate_agent(state):
    """Evaluate draft quality with OTel events."""
    evaluations = []
    for draft in state.get("drafts", []):
        with tracer.start_as_current_span(
            "evaluate.draft"
        ) as span:
            score = await run_quality_check(draft)
            threshold = state.get(
                "quality_threshold", 60
            )
            passed = score >= threshold

            span.set_attribute("quality_score", score)
            span.set_attribute("passed", passed)

            span.add_event(
                "gen_ai.evaluation.result",
                attributes={
                    "gen_ai.evaluation.name": (
                        "email_quality"
                    ),
                    "gen_ai.evaluation.score.value": (
                        score
                    ),
                    "gen_ai.evaluation.score.label": (
                        "passed" if passed else "failed"
                    ),
                },
            )

            evaluation_score.record(
                score / 100.0,
                {
                    "gen_ai.evaluation.name": (
                        "email_quality"
                    ),
                    "campaign_id": state.get(
                        "campaign_id", ""
                    ),
                },
            )

            evaluations.append(
                Evaluation(
                    prospect_id=draft.prospect_id,
                    quality_score=score,
                    passed=passed,
                )
            )

    return {"evaluations": evaluations}
```

### PII Scrubbing

Scrub PII from all content before recording in span events:

```python showLineNumbers title="src/sales_intelligence/pii.py"
import re

_PII_PATTERNS = [
    (re.compile(
        r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"
    ), "[EMAIL]"),
    (re.compile(
        r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"
    ), "[PHONE]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    (re.compile(
        r"https?://(?:www\.)?linkedin\.com/in/[\w-]+"
    ), "[LINKEDIN]"),
]


def scrub_pii(text: str) -> str:
    for pattern, replacement in _PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text
```

### Error Handling with Trace IDs

Include trace IDs in API error responses so users can reference
them when reporting issues:

```python showLineNumbers title="src/sales_intelligence/main.py"
from fastapi import Request
from fastapi.responses import JSONResponse
from opentelemetry import trace


@app.exception_handler(Exception)
async def global_error_handler(
    request: Request, exc: Exception,
):
    span = trace.get_current_span()
    trace_id = span.get_span_context().trace_id
    trace_id_hex = format(trace_id, "032x")

    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "trace_id": trace_id_hex,
        },
    )
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash showLineNumbers
uv run uvicorn sales_intelligence.main:app \
  --reload --host 0.0.0.0 --port 8000
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

```bash showLineNumbers
OTEL_SDK_DISABLED=false \
LLM_PROVIDER=anthropic \
LLM_MODEL=claude-sonnet-4-20250514 \
OTLP_ENDPOINT=http://collector:4318 \
uv run uvicorn sales_intelligence.main:app \
  --host 0.0.0.0 --port 8000
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build

curl http://localhost:8000/health

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verify Telemetry Is Working

```bash showLineNumbers
curl http://localhost:13133
```

### Enable Debug Mode

```python showLineNumbers
import logging
logging.getLogger("opentelemetry").setLevel(logging.DEBUG)
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. Confirm the OTel Collector is running:
   `curl http://localhost:13133`
2. Check collector logs:
   `docker compose logs otel-collector`
3. Verify `OTLP_ENDPOINT` points to the collector, not directly
   to Scout
4. Ensure `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` are set
   in the collector environment

#### Issue: Token counts are zero

**Solutions:**

1. Check your LLM SDK version — older versions may not expose
   `usage` on the response object
2. Verify the provider response has `input_tokens` and
   `output_tokens` (naming varies by provider)
3. For Google GenAI, check `response.usage_metadata` instead
   of `response.usage`

#### Issue: Agent spans not nested under pipeline span

**Solutions:**

1. Ensure `wrap_agent` creates spans inside the pipeline span
   context — call `pipeline.ainvoke()` within the
   `pipeline.run` span (see
   [Pipeline-Level Parent Span](#pipeline-level-parent-span))
2. Verify `setup_telemetry()` is called **before** creating
   the FastAPI app
3. Check that async context propagation is working — LangGraph
   preserves the OTel context across `await` boundaries

#### Issue: Cost metrics not accurate

**Solutions:**

1. Verify your `MODEL_PRICING` dictionary contains the exact
   model ID string returned by the provider (e.g.,
   `claude-sonnet-4-20250514`, not `claude-sonnet-4`)
2. Check that cost is calculated with `/1_000_000` (pricing is
   per million tokens)

#### Issue: Conditional edge routing not visible in traces

**Solutions:**

1. Ensure the routing function reads the current span with
   `trace.get_current_span()` and sets routing attributes
2. Verify the routing function is called within the span
   context of the preceding node

## Security Considerations

### Protecting Sensitive Data

- **Never record raw prompts** that may contain user data, API
  keys, or credentials in span attributes or events
- **Truncate content** to 500 characters to avoid oversized spans
- **Disable content capture** in production if compliance requires
  it — set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`
- **Scrub PII** before recording any content in telemetry (see
  [PII Scrubbing](#pii-scrubbing) for the regex patterns used)

### SQL Query Obfuscation

The SQLAlchemy auto-instrumentor captures SQL statements by default.
For sensitive queries, disable enhanced reporting:

```python showLineNumbers
SQLAlchemyInstrumentor().instrument(
    engine=engine.sync_engine,
    enable_commenter=False,
)
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Use opt-in content capture — disabled by default in this guide
- Record only token counts and model metadata, not prompt content
- Audit span attributes regularly for sensitive data leaks
- Use the OTel Collector `attributes` processor to redact fields
  before export if additional filtering is needed

## Performance Considerations

OpenTelemetry overhead is negligible relative to LLM API latency.
A typical LLM call takes 1-5 seconds; span creation adds
microseconds.

### Optimization Strategies

#### 1. Use BatchSpanProcessor

```python showLineNumbers
trace_provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint=endpoint),
        max_queue_size=2048,
        max_export_batch_size=512,
    )
)
```

#### 2. Truncate Content Events

Always truncate prompts and completions to keep span sizes
reasonable:

```python showLineNumbers
scrub_pii(prompt)[:500]
```

#### 3. Disable Content Capture in High-Volume Scenarios

```bash showLineNumbers
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

#### 4. Skip Health Check Endpoints

Exclude high-frequency health checks from tracing:

```python showLineNumbers
FastAPIInstrumentor.instrument_app(
    app, excluded_urls="health,metrics"
)
```

## FAQ

### Does OpenTelemetry add latency to LLM calls?

No. Span creation takes microseconds. LLM API calls take seconds.
The overhead is unmeasurable. `BatchSpanProcessor` exports spans
in a background thread.

### How does this differ from LangSmith tracing?

LangSmith provides deep LangGraph-specific tracing but operates
in isolation from your HTTP and database telemetry. OpenTelemetry
gives you a single trace that spans all layers — you can see that
a slow HTTP response was caused by a specific agent node making an
LLM call, and that the same request also ran database queries.
LangSmith cannot show that correlation.

### Which LangGraph versions are supported?

This guide supports LangGraph 0.2+ and recommends 1.0.6+. The
`StateGraph` API and `add_conditional_edges` have been stable since
0.2. The `wrap_agent` pattern works with any version that supports
async node functions.

### How do I instrument conditional edges?

Use `trace.get_current_span()` inside your routing function to
record attributes like `routing.decision` and
`routing.qualified_count`. See
[Conditional Edge Routing](#conditional-edge-routing) for the
full pattern.

### How do I track cost across multiple providers?

Use the `gen_ai.client.cost` counter metric with
`gen_ai.provider.name` and `gen_ai.request.model` attributes.
Define pricing per model and calculate from token counts. This
enables `sum(gen_ai.client.cost) by (gen_ai.agent.name)` in
your dashboards.

### Can I see prompts and completions in traces?

Yes, if you set
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`. Content
is PII-scrubbed and truncated to 500 characters. Disable in
production for compliance.

### How do I add a new agent node?

Create the agent function, wrap it with `wrap_agent("name", fn)`,
add the node to the `StateGraph` with `graph.add_node()`, and
connect it with `add_edge` or `add_conditional_edges`. The
`wrap_agent` wrapper automatically handles span creation.

### How does trace propagation work across subgraphs?

LangGraph subgraphs execute within the same Python async context.
OpenTelemetry automatically propagates the trace context across
`await` boundaries, so subgraph node spans appear as children of
the parent graph's span without additional configuration.

### How do I instrument tool-calling nodes?

Wrap each tool invocation with a dedicated span using
`tracer.start_as_current_span("tool.<name>")`. Set
`gen_ai.operation.name` to `"tool"` and `tool.name` to the
specific tool. See [Tool-Calling Nodes](#tool-calling-nodes)
for the full pattern.

### Can I use this with LangChain alongside LangGraph?

Yes. LangGraph builds on top of `langchain-core`. The
`wrap_agent` pattern works regardless of whether your node
functions use LangChain components internally. The GenAI spans
capture the LLM calls at the provider SDK level, not the
framework level.

## What's Next?

### Advanced Topics

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability patterns
- [LlamaIndex Instrumentation](./llamaindex.md) -
  LlamaIndex-specific setup
- [FastAPI Auto-Instrumentation](./fast-api.md) -
  FastAPI-specific setup
- [Python Custom Instrumentation](../custom-instrumentation/python.md) -
  Manual tracing fundamentals

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) -
  Alert on cost spikes, error rates, or quality degradation
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) -
  Build dashboards for token usage, cost attribution, and
  evaluation scores

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OTel Collector

## Complete Example

### Project Structure

```text
ai-sales-intelligence/
├── src/sales_intelligence/
│   ├── main.py              # FastAPI app with lifespan
│   ├── config.py            # Pydantic Settings
│   ├── telemetry.py         # OTel initialization (auto + custom)
│   ├── state.py             # AgentState TypedDict
│   ├── llm.py               # LLM client with GenAI spans
│   ├── graph.py             # LangGraph pipeline with agent spans
│   ├── pii.py               # PII scrubbing for telemetry
│   ├── agents/
│   │   ├── research.py      # Database search agent
│   │   ├── enrich.py        # LLM enrichment agent
│   │   ├── score.py         # LLM scoring agent
│   │   ├── draft.py         # LLM email draft agent
│   │   └── evaluate.py      # LLM quality evaluation agent
│   └── middleware/
│       └── metrics.py       # HTTP request metrics
├── otel-collector-config.yaml
├── compose.yml
├── Dockerfile
└── pyproject.toml
```

### Key Files

| File           | Demonstrates                                    |
| -------------- | ----------------------------------------------- |
| `telemetry.py` | OTel setup (traces + metrics + logs)             |
| `llm.py`       | GenAI spans, token/cost metrics, retry/fallback  |
| `graph.py`     | LangGraph pipeline, `wrap_agent`, conditional edges |
| `state.py`     | TypedDict state flowing through nodes            |
| `evaluate.py`  | Evaluation events and quality metrics            |
| `research.py`  | Tool-calling node with database search           |
| `pii.py`       | PII scrubbing before telemetry recording         |
| `config.py`    | Provider-agnostic settings with Pydantic         |
| `compose.yml`  | Docker deployment with OTel Collector            |

### GitHub Repository

For a complete working example, see the
[AI Sales Intelligence](https://github.com/base14/examples/tree/main/python/ai-sales-intelligence)
repository.

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)

## Related Guides

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability guide
- [LlamaIndex Instrumentation](./llamaindex.md) -
  LlamaIndex-specific setup
- [FastAPI Auto-Instrumentation](./fast-api.md) -
  FastAPI-specific setup
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector deployment
