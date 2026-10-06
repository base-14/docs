---
title:
  LangGraph OpenTelemetry Instrumentation - Node Spans and GenAI SDK Tracing
sidebar_label: LangGraph
sidebar_position: 6
description:
  Trace LangGraph pipelines with OpenTelemetry. Span each node, trace model
  calls with the official GenAI SDK packages, and add cost and context.
keywords:
  [
    langgraph opentelemetry instrumentation,
    langgraph tracing,
    langgraph observability,
    langgraph node spans,
    langgraph agent pipeline tracing,
    opentelemetry langgraph python,
    opentelemetry-instrumentation-genai-openai,
    opentelemetry-instrumentation-genai-anthropic,
    llm token tracking,
    llm cost monitoring,
    genai semantic conventions,
    langgraph retries fallback,
    ai agent production monitoring,
    langgraph instrumentation guide,
    multi-provider llm,
  ]
---

# LangGraph

Trace a LangGraph pipeline with OpenTelemetry when its nodes are plain
functions that call model SDKs directly. LangGraph emits no spans of its own,
so each node gets an `invoke_agent` span, and the official OpenTelemetry GenAI
packages for the OpenAI, Anthropic and Google SDKs trace every model call
inside it. One trace covers the HTTP request, the graph, each node, each model
call and each database query.

The packages record the model and the tokens. The application adds which node
made the call, the business ID it served, the real provider behind an
OpenAI-compatible endpoint, and the cost.

The example is a sales intelligence pipeline: five nodes that research
prospects in Postgres, then enrich, score, draft and evaluate outreach with
model calls, behind a FastAPI endpoint. If your nodes use LangChain agents or
chat models instead, see [LangChain](./langchain.md).

:::tip TL;DR

Install the GenAI packages for your model SDKs and call `instrument()` on each.
Wrap every node in an `invoke_agent {node}` span when you build the graph, and
add the node name, business IDs and cost to the packages' `chat` spans in a
span processor and exporter. Build the SDK clients with `max_retries=0` so each
attempt is one span.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- **AI/ML engineers** building LangGraph pipelines whose nodes call model SDKs
  directly, who need to see which node is slow and what each one costs.
- **Backend developers** running a graph behind a FastAPI endpoint who want one
  trace across HTTP, graph, model and database.
- **Platform teams** standardizing agent observability on the OpenTelemetry
  GenAI conventions.

## Overview

- Trace model calls with the official OpenTelemetry GenAI packages for the
  OpenAI, Anthropic and Google SDKs.
- Give each graph node an `invoke_agent` span, since no package traces plain
  function nodes.
- Add the agent, the business ID, the real provider and the cost to the
  packages' spans in a span processor and a span exporter.
- Retry and fall back between providers so that each attempt is one span.
- Record evaluation results and mark failed items without failing the run.

### Signals

| Signal | What the instrumentation emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | A `chat {model}` span per SDK call from the OpenAI, Anthropic and Google packages, and FastAPI and SQLAlchemy spans. LangGraph itself emits none for plain function nodes. | `pipeline.run` and an `invoke_agent {node}` span per node, per-item spans, a `retrieval` span, and the agent, campaign ID, provider and cost on chat spans. |
| Metrics | `gen_ai.client.token.usage` and `gen_ai.client.operation.duration` from the packages. | `base14.gen_ai.cost`, `.retry.count`, `.fallback.count`, `.error.count` and `.evaluation.score`. |
| Logs | None. | Trace and span IDs on the application's log lines, through the logging instrumentation. No OTLP log export. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A model the SDKs can reach. The Quick Start and the example use Ollama with
  `qwen3.5:9B` through its OpenAI-compatible `/v1` endpoint, which needs no API
  key. Anthropic, OpenAI and Google are configurable alternatives.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- PostgreSQL for the example's prospect store.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `langgraph` | 1.2.11 |
| `openai` | 3.7.0 |
| `anthropic` | 0.125.0 |
| `google-genai` | 2.21.0 |
| `opentelemetry-instrumentation-genai-openai`, `-genai-anthropic` | 1.2b0 |
| `opentelemetry-instrumentation-google-genai` | 1.2b0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-sqlalchemy`, `-httpx`, `-logging` | 0.66b0 |
| `fastapi` | 0.141.1 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-sales-intelligence`](https://github.com/base-14/examples/tree/main/python/ai-sales-intelligence) |

Last verified 2026-10-06: the example's verify script passed against Ollama
`qwen3.5:9B`, and the Quick Start ran against a local collector. The GenAI
packages are beta and always emit the latest experimental conventions, so pin
exact versions and re-check the spans after each upgrade.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
pip install \
  langgraph openai \
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
  langgraph openai \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-openai
```

```mdx-code-block
</TabItem>
</Tabs>
```

Add `opentelemetry-instrumentation-genai-anthropic` for the Anthropic SDK and
`opentelemetry-instrumentation-google-genai` for the Google Gen AI SDK. All
three are beta, from the OpenTelemetry GenAI SIG.

## Quick Start

A two-node graph whose nodes call Ollama through the OpenAI SDK, traced to a
local collector on `localhost:4318`.

```python showLineNumbers title="quickstart.py"
import asyncio
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from openai import AsyncOpenAI
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

resource = Resource.create({"service.name": "langgraph-quickstart"})
tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)
meter_provider = MeterProvider(
    resource=resource, metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())]
)
metrics.set_meter_provider(meter_provider)

OpenAIInstrumentor().instrument()

tracer = trace.get_tracer("quickstart")
client = AsyncOpenAI(base_url="http://localhost:11434/v1", api_key="ollama", max_retries=0)


class State(TypedDict, total=False):
    company: str
    summary: str
    email: str


async def ask(prompt: str) -> str:
    response = await client.chat.completions.create(
        model="qwen3.5:9B",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        reasoning_effort="none",
    )
    return response.choices[0].message.content or ""


def node(name, fn):
    async def wrapped(state: State) -> State:
        with tracer.start_as_current_span(f"invoke_agent {name}") as span:
            span.set_attribute("gen_ai.operation.name", "invoke_agent")
            span.set_attribute("gen_ai.agent.name", name)
            return await fn(state)

    return wrapped


async def research(state: State) -> State:
    return {"summary": await ask(f"In one sentence, what does {state['company']} do?")}


async def draft(state: State) -> State:
    return {"email": await ask(f"Write a two-line intro email. Context: {state['summary']}")}


graph = StateGraph(State)
graph.add_node("research", node("research", research))
graph.add_node("draft", node("draft", draft))
graph.add_edge(START, "research")
graph.add_edge("research", "draft")
graph.add_edge("draft", END)
pipeline = graph.compile()


async def main() -> None:
    with tracer.start_as_current_span("pipeline.run"):
        result = await pipeline.ainvoke({"company": "Grafana Labs"})
    print(result["email"])


asyncio.run(main())
tracer_provider.shutdown()
meter_provider.shutdown()
```

The collector receives one trace:

```text
pipeline.run
├─ invoke_agent research
│  └─ chat qwen3.5:9B
└─ invoke_agent draft
   └─ chat qwen3.5:9B
```

The `chat` spans come from `OpenAIInstrumentor`, with token usage, the request
and response model, and `server.address` and `server.port` for Ollama. Their
`gen_ai.provider.name` is `openai`: see
[Correcting the Provider](#adding-context-provider-and-cost).

## Configuration

| Variable | Default | What it controls |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | unset | `service.name` on every span. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint of the collector. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `no_content` | `no_content`, `span_only`, `event_only` or `span_and_event`. `true` and `false` are not valid: the packages log a warning and capture nothing. |

The packages read the capture mode once, when instrumented, and always emit
the latest experimental GenAI conventions; they do not read
`OTEL_SEMCONV_STABILITY_OPT_IN`.

## Why the Graph Needs Its Own Spans

LangGraph emits no spans of its own. The official LangChain instrumentation,
`opentelemetry-instrumentation-genai-langchain`, traces LangGraph through
LangChain's callbacks, but for a graph of plain function nodes that call SDKs
directly it records only one `invoke_workflow` span per run. On `ainvoke` the
spans created inside the graph do not nest under it either, so the workflow
span ends up empty beside them. The example does not use it.

Use the LangChain instrumentation when the nodes run LangChain agents, chat
models, tools or retrievers on sync `invoke`; see
[LangChain](./langchain.md). For plain nodes, trace the model calls with the
SDK packages and give each node its own span.

## Node Spans

Each node is wrapped in an `invoke_agent {node}` span when the graph is
built. The node's own work, including the SDK's `chat` spans, nests under it:

```python showLineNumbers title="src/sales_intelligence/graph.py"
        async def wrapped(state: AgentState) -> AgentState:
            with tracer.start_as_current_span(f"invoke_agent {name}") as span:
                span.set_attribute("gen_ai.operation.name", "invoke_agent")
                span.set_attribute("gen_ai.agent.name", name)
                span.set_attribute("base14.campaign_id", state.campaign_id)

                if needs_session:
                    result = await agent_fn(state, session)
                else:
                    result = await agent_fn(state)

                span.set_attribute("base14.errors_count", len(result.errors))
                return result
```

A node function adds its own counts to that span through
`trace.get_current_span()` rather than opening a second span for the same
work. A `pipeline.run` span around `pipeline.ainvoke()` carries the run's
totals.

Nodes that handle several items open one span per item, such as
`enrich.prospect` and `draft.email`. When an item fails and the node moves on,
the item's span is marked failed:

```python showLineNumbers title="src/sales_intelligence/errors.py"
def record_item_failure(span: Span, exc: Exception) -> None:
    """Mark one prospect's or draft's span failed when the pipeline skips it and goes on."""
    span.record_exception(exc)
    span.set_attribute("error.type", type(exc).__qualname__)
    span.set_status(Status(StatusCode.ERROR, str(exc)))
```

The research node wraps its Postgres full-text search in a
`retrieval prospects_fts` CLIENT span with `gen_ai.data_source.id`, and the
SQLAlchemy span nests under it.

## Model Call Spans

The example's client calls the SDKs directly, and the packages record each
call:

```python showLineNumbers title="src/sales_intelligence/telemetry.py"
    from opentelemetry.instrumentation.genai.anthropic import AnthropicInstrumentor
    from opentelemetry.instrumentation.genai.openai import OpenAIInstrumentor
    from opentelemetry.instrumentation.google_genai import GoogleGenAiSdkInstrumentor

    OpenAIInstrumentor().instrument()
    AnthropicInstrumentor().instrument()
    GoogleGenAiSdkInstrumentor().instrument()
```

Each `chat {model}` CLIENT span carries `gen_ai.operation.name`,
`gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.request.temperature`,
`gen_ai.request.max_tokens`, `gen_ai.response.model`, `gen_ai.response.id`,
`gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens` and `server.address`. `server.port` is left out
when it is the default 443. With `span_only`, the span also carries the input
and output messages and the system instructions.

## Adding Context, Provider and Cost

The packages do not know which node made a call, which campaign it served, or
that an OpenAI-compatible endpoint is Ollama. The client sets that context
around each call:

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

and a span processor puts it on the package's span as it starts:

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

Cost and PII scrubbing need the finished span, so a span exporter wraps the
OTLP exporter, adds `base14.gen_ai.cost_usd` from `_shared/pricing.json` and
scrubs emails, phone numbers and similar from captured content before export.
The [LLM Observability guide](../../../guides/ai-observability/llm-observability.md)
walks through both pieces.

## Retries and Fallbacks

The client retries each call three times with exponential backoff, then
switches to the fallback provider. The SDK clients are built with
`max_retries=0`, so the client's retries are the only layer and each attempt
is one `chat` span: a failed attempt's span has error status and `error.type`
set to the SDK's exception class. A switch adds a `provider_fallback` event
and `gen_ai.fallback.triggered=true` to the node's span, and the
`base14.gen_ai.retry.count`, `.fallback.count` and `.error.count` counters
record the rates.

## Evaluation Results

The evaluate node scores each draft with a model call and records the result
as a `gen_ai.evaluation.result` event on the item's span, plus a
`base14.gen_ai.evaluation.score` histogram:

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

## Known Gaps

As of the OpenAI, Anthropic and Google GenAI packages 1.2b0 with LangGraph
1.2.11, verified 2026-10-06:

- **No spans for plain function nodes.** Neither LangGraph nor the LangChain
  instrumentation traces them. Open an `invoke_agent` span per node.
- **The LangChain instrumentation's workflow span is empty on `ainvoke`.**
  Spans inside the run do not nest under it.
- **`gen_ai.provider.name` is `openai` for Ollama.** The OpenAI package names
  any endpoint the SDK reaches `openai`. A span processor corrects the span;
  the `gen_ai.client.*` metric points still say `openai`.
- **No HTTP client span for OpenAI or Ollama calls.** The OpenAI SDK 3.x sends
  through `httpx2`, which `opentelemetry-instrumentation-httpx` does not
  patch. The Anthropic and Google SDKs send through `httpx`.
- **No node or business context on chat spans**, and none on the token and
  duration metrics. Add it to spans in a span processor; group token metrics by
  model, not by node.
- **One span per attempt.** An SDK's own retries happen inside one span; turn
  them off when the application retries.
- **Content capture takes mode values only**, and is read once at
  `instrument()`. Content events from `event_only` and `span_and_event` are not
  scrubbed by a span exporter.

## What to Look For in Scout

### Follow one campaign through the pipeline

Search spans by `base14.campaign_id`. The trace is rooted at
`POST /campaigns/{campaign_id}/run` and holds `pipeline.run`, one
`invoke_agent` span per node, the per-item spans and the `chat` spans under
them.

### Find the slow node

Sort `invoke_agent` spans by duration, grouped by `gen_ai.agent.name`. The
model nodes, `enrich`, `score`, `draft` and `evaluate`, hold one `chat` span
per prospect or draft.

### Read tokens and cost by node

Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on `chat`
spans grouped by `gen_ai.agent.name`, and `base14.gen_ai.cost` by the same
attribute. The `gen_ai.client.token.usage` metric carries no node, so use it
for totals by model.

### Find prospects the pipeline skipped

Filter `enrich.prospect`, `score.prospect`, `draft.email` and
`evaluate.draft` spans on error status. The recorded exception says why, such
as a model answer that failed validation.

### Track draft quality

Plot `base14.gen_ai.evaluation.score` by `gen_ai.evaluation.score.label`, or
read the `gen_ai.evaluation.result` events on `evaluate.draft` spans.

## Production Patterns

- **Keep content capture at `no_content` for real data**, and scrub in a span
  exporter when you turn it on.
- **Turn off the SDKs' own retries** when the application retries, so the
  trace and the retry counter agree.
- **Correct the provider for OpenAI-compatible endpoints** on spans, and expect
  the metrics to keep the SDK's name.
- **Put business IDs on node spans and model spans**, so one search finds a
  whole run.
- **Mark failed items, not the run**, when a node skips an item and goes on.
- **Keep the price table current.** A model missing from it records 0.
- **Batch exports and send through a collector**, which holds the Scout
  credentials.

## Running Your Application

```bash showLineNumbers title="Terminal"
docker compose up -d --build
./scripts/verify-scout.sh
```

`verify-scout.sh` creates a campaign, imports one connection, runs the
pipeline and checks the collector output: that every `chat` span comes from a
GenAI package, that none names Ollama as `openai`, and the GenAI attributes and
metrics. `scripts/test-api.sh` runs the API end to end on one prospect; set
`CONNECTIONS_CSV=data/sample-connections.csv` for the full sample of eight,
and raise `PIPELINE_TIMEOUT` on a local model.

## Troubleshooting

### No chat spans

The instrumentors did not run, or ran before the tracer provider was set. Call
`instrument()` after `trace.set_tracer_provider`. A mocked SDK class in tests
produces no spans either; replace the HTTP transport instead.

### Chat spans say `openai` for Ollama

Expected from the OpenAI package. Set the provider in a span processor at span
start, as above.

### No content with capture set to `true`

Use `span_only`. The packages accept mode values only and read the variable
once at startup.

### Node spans and chat spans are in separate traces

The node ran outside the context of `pipeline.run`. Open `pipeline.run` around
`pipeline.ainvoke()` and the node spans inside the node functions.

## FAQ

### Does LangGraph support OpenTelemetry?

Not directly. LangGraph emits no spans of its own. The official LangChain
instrumentation traces LangGraph runs through callbacks, which covers graphs
whose nodes use LangChain agents and chat models; graphs of plain function
nodes need a span per node by hand, with the model SDKs traced by their own
packages.

### Should I use opentelemetry-instrumentation-genai-langchain for LangGraph?

Use it when the nodes run LangChain components on sync `invoke`. For plain
function nodes on `ainvoke` it adds one workflow span that holds none of the
work.

### How do I trace OpenAI, Anthropic and Gemini calls inside LangGraph nodes?

Install `opentelemetry-instrumentation-genai-openai`,
`opentelemetry-instrumentation-genai-anthropic` and
`opentelemetry-instrumentation-google-genai`, and call `instrument()` on each
after setting up the tracer provider. Every SDK call then gets a `chat {model}`
span under the node's span.

### How do I attribute tokens and cost to a LangGraph node?

Put the node's name on the model call spans in a span processor, then group
`chat` spans by `gen_ai.agent.name`. Record a cost counter with the node's name
for dashboards.

### Why does each retry show up as its own span?

The packages open one span per SDK call. With the SDK's own retries off, every
attempt is a call. A failed attempt's span has error status, and the
successful one carries the tokens.

### How do I trace a conditional edge?

Open a short span inside the routing function and set the decision on it, or
record the path taken on `pipeline.run` from the final state. The routing
function runs after the preceding node's span has ended, so it cannot add to
that span. The example's graph is linear and has no conditional edge.

## What's Next?

### Related Guides

- [LangChain Instrumentation](./langchain.md) - The official LangChain
  package, for graphs built from LangChain components.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  The same example, with cost, scrubbing, retries and evaluation in detail.
- [FastAPI Instrumentation](./fast-api.md) - The HTTP host in front of the
  graph.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Alert on
  cost spikes, error rates, or quality degradation.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  dashboards for token usage, cost attribution, and evaluation scores.

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OpenTelemetry Collector.

## Complete Example

The code on this page comes from
[`python/ai-sales-intelligence`](https://github.com/base-14/examples/tree/main/python/ai-sales-intelligence).

```text
src/sales_intelligence/
├── telemetry.py         # providers, exporters, SDK instrumentation
├── genai_spans.py       # agent, campaign, provider, cost and scrubbing on chat spans
├── llm.py               # SDK clients, retries, fallback, counters
├── graph.py             # StateGraph, node spans, pipeline.run
├── errors.py            # failed-item spans
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
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
