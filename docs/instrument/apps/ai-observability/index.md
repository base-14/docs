---
title:
  AI Observability Overview - LLM and Agent Instrumentation with
  OpenTelemetry | base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  Instrument AI and LLM apps with OpenTelemetry. Trace LLM calls,
  track tokens and costs, monitor agent pipelines with base14 Scout.
keywords:
  [
    ai observability,
    llm observability,
    llm opentelemetry,
    ai application monitoring,
    genai semantic conventions,
    llm tracing,
    llm cost tracking,
    ai agent monitoring,
    base14 scout,
  ]
---

# AI Observability

Instrument AI and LLM applications with OpenTelemetry to get
**unified traces** that connect HTTP requests, agent orchestration,
LLM API calls, and database queries in a single view.

## The Problem

Traditional APM tools (Datadog, New Relic) capture HTTP and
database telemetry. Specialized AI tools (LangSmith, Weights &
Biases) capture LLM traces. Neither shows the full picture:

| Tool Type | Captures | Misses |
|-----------|----------|--------|
| Traditional APM | HTTP requests, DB queries, latency | Model name, tokens, cost, prompt content |
| AI-specific tools | LLM calls, prompts, model metadata | HTTP context, DB queries, infrastructure |
| **OpenTelemetry** | **All of the above in one trace** | — |

With OpenTelemetry, a single trace shows that a slow HTTP response
was caused by a specific LLM call in a specific agent, which also
triggered 3 database queries and a fallback to a different
provider.

## When to Use AI Observability

| Use Case | Recommendation |
|----------|----------------|
| Track LLM token usage and costs | AI Observability |
| Monitor agent pipeline performance | AI Observability |
| Evaluate LLM output quality over time | AI Observability |
| Debug slow AI requests end-to-end | AI Observability |
| Attribute costs to agents or business operations | AI Observability |
| Standard HTTP/database monitoring only | [Auto-instrumentation](../auto-instrumentation/) |
| Generic custom spans and metrics | [Custom instrumentation](../custom-instrumentation/) |

## Guides

| Guide | What It Covers |
|-------|---------------|
| [LLM Observability](./llm-observability) | End-to-end guide: GenAI semantic conventions, token/cost metrics, agent pipeline spans, evaluation tracking, PII scrubbing, production deployment |

## What Gets Instrumented

AI observability builds on top of auto and custom instrumentation,
adding an LLM-specific layer:

### Auto-Instrumentation Layer (zero code changes)

- **HTTP requests** via FastAPI/Django/Flask instrumentors
- **Database queries** via SQLAlchemy/Django ORM instrumentors
- **Outbound HTTP** via httpx/requests instrumentors (captures raw
  LLM API calls)
- **Log correlation** via logging instrumentor (adds trace_id to
  logs)

### Custom AI Layer (GenAI semantic conventions)

- **LLM spans** with model, provider, token counts, cost
- **Prompt/completion events** with PII scrubbing
- **Agent spans** with pipeline orchestration context
- **Evaluation events** with quality scores and pass/fail
- **Cost metrics** with attribution by agent and business operation
- **Retry/fallback tracking** with error type classification

### Example: Unified Trace

```text showLineNumbers title="Single trace spanning all layers"
POST /api/generate                            4.2s  [auto: HTTP]
├─ db.query SELECT context                   15ms   [auto: DB]
├─ invoke_agent enrich                        1.8s  [custom: agent]
│  └─ gen_ai.chat claude-sonnet-4             1.7s  [custom: LLM]
│     └─ HTTP POST api.anthropic.com          1.7s  [auto: httpx]
├─ invoke_agent draft                         2.3s  [custom: agent]
│  └─ gen_ai.chat claude-sonnet-4             2.2s  [custom: LLM]
│     └─ HTTP POST api.anthropic.com          2.2s  [auto: httpx]
└─ db.query INSERT result                     5ms   [auto: DB]
```

## Key Concepts

### GenAI Semantic Conventions

OpenTelemetry defines
[GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
for standardized LLM telemetry. Key attributes:

| Attribute | Example | Purpose |
|-----------|---------|---------|
| `gen_ai.operation.name` | `"chat"` | Operation type |
| `gen_ai.provider.name` | `"anthropic"` | LLM provider |
| `gen_ai.request.model` | `"claude-sonnet-4"` | Model used |
| `gen_ai.usage.input_tokens` | `1240` | Tokens consumed |
| `gen_ai.usage.output_tokens` | `320` | Tokens generated |
| `gen_ai.agent.name` | `"draft"` | Agent in pipeline |

### GenAI Metrics

Custom metrics for dashboards and alerting:

| Metric | Type | Purpose |
|--------|------|---------|
| `gen_ai.client.token.usage` | Histogram | Token consumption by model/agent |
| `gen_ai.client.operation.duration` | Histogram | LLM call latency |
| `gen_ai.client.cost` | Counter | Cost in USD by model/agent |
| `gen_ai.evaluation.score` | Histogram | Output quality scores |
| `gen_ai.client.error.count` | Counter | Errors by provider/type |

## Next Steps

1. **Follow the [LLM Observability guide](./llm-observability)**
   for a complete setup walkthrough
2. **Set up [auto-instrumentation](../auto-instrumentation/)** for
   your web framework if you haven't already
3. **Configure the
   [OpenTelemetry Collector](../../collector-setup/docker-compose-example.md)**
   to export telemetry to base14 Scout
