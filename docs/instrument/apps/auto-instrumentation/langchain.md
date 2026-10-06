---
title:
  LangChain OpenTelemetry Instrumentation - Official GenAI Package Guide
sidebar_label: LangChain
sidebar_position: 5.9
description:
  Trace LangChain agents, tools and retrieval with the official OpenTelemetry
  GenAI instrumentation, then add cost, conversation IDs and PII scrubbing.
keywords:
  [
    langchain opentelemetry instrumentation,
    opentelemetry-instrumentation-genai-langchain,
    langchain tracing,
    langchain callback handler,
    create_agent instrumentation,
    langchain agent observability,
    gen_ai semantic conventions,
    llm observability,
    rag retrieval tracing,
    tool calling agent tracing,
    langchain token cost tracking,
    langchain retry fallback middleware,
    ollama tracing,
    openllmetry alternative,
    langchain vs langsmith,
    ai agent monitoring python,
  ]
---

# LangChain

Trace a LangChain agent with the official OpenTelemetry GenAI instrumentation,
`opentelemetry-instrumentation-genai-langchain`. One call at startup gives you
an `invoke_agent` span for the agent, a `chat` span for every model call, an
`execute_tool` span for every tool and a `retrieval` span for every retriever,
with token metrics, all in the same trace as your HTTP and database spans.

The instrumentation does not know your application. This guide adds what it
leaves out: a conversation ID on every span, the data source on retrieval
spans, the cost of each model call, PII scrubbing of captured content, and
retry and fallback counters from `create_agent` middleware.

The example is a small SRE runbook assistant. You POST an incident question;
a tool-calling agent retrieves the relevant runbook from a pgvector store,
inspects service metrics, logs and status through tools, and returns a cited
diagnosis.

:::tip TL;DR

Install `opentelemetry-instrumentation-genai-langchain` and call
`LangChainInstrumentor().instrument()` after setting up the tracer provider.
Name the agent with `create_agent(name=...)` and pass a conversation ID in the
run's metadata. Add cost and PII scrubbing in a span exporter, and keep
content capture at `no_content` unless you need it.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## LangChain vs LangGraph

LangChain 1.x agents built with `create_agent` are LangGraph graphs under the
hood. This guide covers `create_agent` agents and the LangChain
instrumentation, which traces them through LangChain's callbacks. The
[LangGraph guide](./langgraph.md) covers a hand-built `StateGraph` whose nodes
are plain functions; the LangChain instrumentation gives such a graph one
workflow span and nothing for its nodes.

## Who This Guide Is For

- **AI/ML engineers** building LangChain agents who need to see which tool
  ran, how many tokens a turn used and where the time went.
- **Backend developers** adding an agent endpoint to an existing FastAPI
  service who want one trace across HTTP, agent, model and database.
- **Platform teams** standardizing GenAI observability on the OpenTelemetry
  conventions instead of a vendor-specific tracer.
- **Teams on OpenLLMetry or a hand-written callback handler** deciding whether
  to move to the official package.

## Overview

- Enable the official LangChain instrumentation and read the spans it creates.
- Name the agent and pass a conversation ID so one request is one search.
- Add the data source, the cost and PII scrubbing in a span processor and a
  span exporter.
- Retry and fall back between models with `create_agent` middleware, so every
  attempt is one span.
- Trace embeddings, which have no LangChain callback.
- Wire the collector to base14 Scout.

### Signals

| Signal | What the instrumentation emits | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invoke_agent`, `chat {model}`, `execute_tool {name}` and `retrieval` spans with GenAI attributes. | The conversation ID on every span, the data source and chunk count on retrieval spans, `base14.gen_ai.cost_usd` on chat spans, a `provider_fallback` event, an `embeddings {model}` span, and FastAPI, httpx and SQLAlchemy spans. |
| Metrics | `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, `gen_ai.invoke_agent.duration`, `gen_ai.execute_tool.duration`, and the streaming `gen_ai.client.operation.time_to_first_chunk` and `time_per_output_chunk`. | `base14.gen_ai.cost`, `.retry.count`, `.fallback.count` and `.error.count`. |
| Logs | None. | OTLP log records from the application's own logging, with the trace ID. |

## Prerequisites

- Python 3.10 or later. The example uses 3.14.
- A chat model that can call tools. The Quick Start and the example use Ollama
  with `qwen3.5:9B`, which needs no API key. Anthropic, OpenAI and Google are
  configurable alternatives.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- PostgreSQL 18 with pgvector for the example's runbook store.
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `langchain` | 1.3.18 |
| `langchain-core` | 1.6.1 |
| `langgraph` | 1.2.12 |
| `langchain-ollama` | 1.1.0 |
| `opentelemetry-instrumentation-genai-langchain` | 1.2b0 |
| `opentelemetry-util-genai` | 1.2b0 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| `opentelemetry-exporter-otlp-proto-http` | 1.45.0 |
| `opentelemetry-instrumentation-fastapi`, `-sqlalchemy`, `-httpx`, `-logging` | 0.66b0 |
| Python | 3.14 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `embeddinggemma` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-runbook-assistant`](https://github.com/base-14/examples/tree/main/python/ai-runbook-assistant) |

Last verified 2026-10-06 with LangChain 1.3.18 and
`opentelemetry-instrumentation-genai-langchain` 1.2b0, with content capture
off and with `span_only`. The package supports `langchain>=0.3.21,<2`. It is
beta and always emits the latest experimental GenAI conventions, so attribute
names can change between releases. Pin exact versions and re-check the spans
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
  langchain langchain-ollama \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-langchain
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
uv add \
  langchain langchain-ollama \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-genai-langchain
```

```mdx-code-block
</TabItem>
</Tabs>
```

Swap `langchain-ollama` for `langchain-anthropic`, `langchain-openai` or
`langchain-google-genai` to match your provider. Add the FastAPI, SQLAlchemy
and httpx instrumentations so the agent's spans join the same trace as your
HTTP and database calls.

:::warning Two packages, similar names

`opentelemetry-instrumentation-genai-langchain` is the official OpenTelemetry
package, published from
[`opentelemetry-python-genai`](https://github.com/open-telemetry/opentelemetry-python-genai).
`opentelemetry-instrumentation-langchain`, without `genai`, is Traceloop's
OpenLLMetry. See [Choosing an Approach](#choosing-an-approach).

:::

The instrumentation checks that the `langchain` distribution is installed. An
app that installs only `langchain-core` and `langgraph` needs
`LangChainInstrumentor().instrument(skip_dep_check=True)`, or nothing is
instrumented.

## Quick Start

One agent with one tool, traced to a local collector on `localhost:4318`.

```python showLineNumbers title="quickstart.py"
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_ollama import ChatOllama
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.genai.langchain import LangChainInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

resource = Resource.create({"service.name": "langchain-quickstart"})
tracer_provider = TracerProvider(resource=resource)
tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(tracer_provider)
meter_provider = MeterProvider(
    resource=resource, metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())]
)
metrics.set_meter_provider(meter_provider)

LangChainInstrumentor().instrument()


@tool
def service_status(service: str) -> str:
    """Return the current status of a service."""
    return f"{service}: 2 of 3 replicas healthy, last restart OOMKilled"


agent = create_agent(
    model=ChatOllama(model="qwen3.5:9B", reasoning=False),
    tools=[service_status],
    name="status_agent",
)
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Is checkout healthy?"}]},
    config={"metadata": {"conversation_id": "quickstart-1"}},
)
print(result["messages"][-1].content)

tracer_provider.shutdown()
meter_provider.shutdown()
```

The collector receives one trace:

```text
invoke_agent status_agent
├─ chat qwen3.5:9B             (picks the tool)
├─ execute_tool service_status
└─ chat qwen3.5:9B             (writes the answer)
```

`gen_ai.agent.name` is `status_agent` on the agent and tool spans, and
`gen_ai.conversation.id` is `quickstart-1` on the agent and chat spans. The
two `shutdown` calls flush the batch before the script exits.

## Configuration

The OpenTelemetry SDK reads the standard variables:

| Variable | Default | What it controls |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | unset | `service.name` on every span. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint of the collector. |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Resource attributes such as `environment`. |

The instrumentation reads the GenAI ones:

| Variable | Default | What it controls |
| --- | --- | --- |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `no_content` | `no_content`, `span_only`, `event_only` or `span_and_event`, case-insensitive. `true` and `false` are not valid: the package logs a warning and captures nothing. |
| `OTEL_INSTRUMENTATION_GENAI_EMIT_EVENT` | follows the mode | `true` or `false`, overrides whether content events are emitted. |
| `OTEL_INSTRUMENTATION_GENAI_COMPLETION_HOOK` | unset | `upload` sends content to `OTEL_INSTRUMENTATION_GENAI_UPLOAD_BASE_PATH` instead of the span. Needs `opentelemetry-util-genai[upload]`. |

The capture mode is read once, when `instrument()` runs. Set it before the
process starts. The package always emits the latest experimental GenAI
conventions and does not read `OTEL_SEMCONV_STABILITY_OPT_IN`.

## What the Instrumentation Emits

`LangChainInstrumentor` adds a callback handler to every LangChain callback
manager, so it sees each run of the agent, its model, its tools and its
retriever. For a `create_agent` agent on sync `invoke`, it also makes its
spans current, so the httpx, SQLAlchemy and other spans created inside a run
nest under them.

| Span | Kind | Attributes the instrumentation sets |
| --- | --- | --- |
| `invoke_agent {name}` | `INTERNAL` | `gen_ai.operation.name`, `gen_ai.agent.name` from `create_agent(name=...)`, `gen_ai.conversation.id` from the run's metadata |
| `chat {model}` | `CLIENT` | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.request.temperature`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.conversation.id` |
| `execute_tool {name}` | `INTERNAL` | `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.tool.call.id`, `gen_ai.tool.description`, `gen_ai.agent.name` |
| `retrieval` | `CLIENT` | `gen_ai.operation.name`, `gen_ai.provider.name` set to the vector store class, such as `PGVector` |

With `span_only`, chat spans add `gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.system_instructions` and
`gen_ai.tool.definitions`; tool spans add the call arguments and result; and
retrieval spans add `gen_ai.retrieval.query.text` and
`gen_ai.retrieval.documents`, a JSON list of document IDs and scores.

The example's trace for one diagnosis:

```text
POST /api/v1/diagnose                 (FastAPI)
├─ invoke_agent runbook_assistant
│  ├─ chat qwen3.5:9B                 (picks a tool)
│  │  └─ POST                         (httpx, to Ollama)
│  ├─ execute_tool search_runbooks
│  │  └─ retrieval
│  │     ├─ embeddings embeddinggemma (the example's own span)
│  │     └─ SELECT runbooks           (SQLAlchemy)
│  ├─ execute_tool query_metrics
│  ├─ execute_tool search_logs
│  └─ chat qwen3.5:9B                 (writes the diagnosis)
└─ INSERT                             (SQLAlchemy, the saved diagnosis)
```

## Conversation IDs and Agent Names

Name the agent in `create_agent`, and pass a conversation ID in the run's
metadata. The instrumentation reads both:

```python showLineNumbers title="src/runbook_assistant/agent.py"
def build_agent(retriever: Any) -> Any:
    model, resilience = build_models()
    return create_agent(
        model=model,
        tools=build_tools(retriever),
        system_prompt=SYSTEM_PROMPT,
        middleware=[resilience],
        name=AGENT_NAME,
    )


def run_diagnosis(agent: Any, question: str, conversation_id: str) -> str:
    """The instrumentation reads the conversation ID from the run's metadata."""
    with run_attributes(RunAttributes(conversation_id=conversation_id)):
        result = agent.invoke(
            {"messages": [{"role": "user", "content": question}]},
            config={"metadata": {"conversation_id": conversation_id}},
        )
    messages = result.get("messages", [])
    return messages[-1].content if messages else ""
```

Without `name`, the agent span is `invoke_agent` with no `gen_ai.agent.name`.
The instrumentation puts the conversation ID on agent and chat spans only;
`run_attributes` hands it to the span processor below for the tool and
retrieval spans.

## Adding Context, Cost and Scrubbing

Two pieces of the example add what the instrumentation cannot know. Both live
in `telemetry/genai_spans.py` and are registered on the tracer provider before
`instrument()` runs.

A span processor adds the conversation ID and the data source when a span
starts:

```python showLineNumbers title="src/runbook_assistant/telemetry/genai_spans.py"
class RunAttributesProcessor(SpanProcessor):
    """Adds the conversation and the data source to the instrumentation's spans."""

    def __init__(self, data_source: DataSource) -> None:
        self._data_source = data_source

    def on_start(self, span: Span, parent_context: otel_context.Context | None = None) -> None:
        if not _is_langchain_span(span):
            return
        attributes = span.attributes or {}
        added: dict[str, AttributeValue] = {}
        run = _run.get()
        if run is not None:
            added["gen_ai.conversation.id"] = run.conversation_id
        if _operation(span) == "retrieval":
            added["gen_ai.data_source.id"] = self._data_source.id
            if self._data_source.address is not None:
                added["server.address"] = self._data_source.address
            if self._data_source.port is not None:
                added["server.port"] = self._data_source.port
        span.set_attributes({k: v for k, v in added.items() if k not in attributes})
```

Cost and scrubbing need the finished span, whose attributes are frozen, so a
span exporter wraps the OTLP exporter and rebuilds the spans it changes:

```python showLineNumbers title="src/runbook_assistant/telemetry/genai_spans.py"
def _derived_attributes(span: ReadableSpan) -> dict[str, AttributeValue]:
    attributes = span.attributes or {}
    derived: dict[str, AttributeValue] = {}
    model = attributes.get("gen_ai.response.model") or attributes.get("gen_ai.request.model")
    if attributes.get("gen_ai.operation.name") == "chat" and model is not None:
        derived[COST_ATTRIBUTE] = calculate_cost(
            str(model),
            _as_token_count(attributes.get("gen_ai.usage.input_tokens")),
            _as_token_count(attributes.get("gen_ai.usage.output_tokens")),
        )
    for key in CONTENT_ATTRIBUTES:
        value = attributes.get(key)
        if isinstance(value, str):
            derived[key] = scrub(value, limit=len(value))
    return derived
```

```python showLineNumbers title="src/runbook_assistant/telemetry/setup.py"
trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(
    RunAttributesProcessor(DataSource(id=s.data_source_id, address=address, port=port))
)
trace_provider.add_span_processor(
    BatchSpanProcessor(
        GenAISpanExporter(
            OTLPSpanExporter(endpoint=f"{s.otel_exporter_otlp_endpoint}/v1/traces")
        )
    )
)
trace.set_tracer_provider(trace_provider)
LangChainInstrumentor().instrument()
```

Cost comes from `_shared/pricing.json`; a model missing from it, every Ollama
model included, costs 0. The scrubber replaces emails, IPv4 addresses, bearer
tokens and API keys. It runs only on span attributes: with `event_only` or
`span_and_event`, the content events are not scrubbed. A completion hook
cannot scrub either, because it runs after the content is set on the span.

The retriever records how many chunks it returned as
`app.retrieval.chunk_count`, on the retrieval span, which is current while it
runs.

## Retries and Fallbacks with Middleware

Do not wrap a chat model in another chat model to retry it. The
instrumentation traces both, so every call gives two `chat` spans, one inside
the other, and the token counts double. Retry and fall back in `create_agent`
middleware instead, where every attempt runs the real model:

```python showLineNumbers title="src/runbook_assistant/llm.py"
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        try:
            response = self._attempt(handler, request, self.primary_provider)
        except Exception as exc:
            if self.fallback is None or self.fallback_provider is None:
                self._record_error(exc)
                raise
            self._record_switch(exc)
            response = self._attempt(
                handler, request.override(model=self.fallback), self.fallback_provider
            )
            self._record_cost(response, self.fallback_provider, self.fallback_model)
            return response
        self._record_cost(response, self.primary_provider, self.primary_model)
        return response
```

`_attempt` retries three times with exponential backoff, and records
`base14.gen_ai.retry.count` before each retry. A switch to the fallback adds a
`provider_fallback` event and `gen_ai.fallback.triggered=true` to the agent
span, and increments `base14.gen_ai.fallback.count` and
`base14.gen_ai.error.count`. Each attempt is its own `chat` span: a failed one
ends with error status and the exception recorded, and the fallback's span is
named after the model that answered.

Build the chat models with `max_retries=0` where the provider integration has
one, so the provider SDK does not retry inside a single span. LangChain also
ships `ModelRetryMiddleware` and `ModelFallbackMiddleware`. The example uses
its own to count retries and fallbacks.

## Embeddings

LangChain has no callback for embeddings, so the instrumentation does not
trace them. The example wraps the vector store's embedding client and opens an
`embeddings {model}` span around each call. It parents on the current span,
which is the retrieval span while a retriever runs.

## Known Gaps

As of `opentelemetry-instrumentation-genai-langchain` 1.2b0 with LangChain
1.3.18, verified 2026-10-06:

- **`gen_ai.response.finish_reasons` is `["error"]` on Ollama.** The package
  reads `finish_reason` or `stop_reason`, and `ChatOllama` reports
  `done_reason`. A successful call looks failed when you group by finish
  reason. Filter on span status instead.
- **No `gen_ai.request.max_tokens` on Ollama.** `ChatOllama`'s `num_predict`
  is not mapped.
- **No `server.address` on chat spans.** The Ollama host appears only on the
  httpx span under each chat span.
- **Retrieval spans name the vector store class as the provider** and carry no
  data source. Add `gen_ai.data_source.id` and the database address in a span
  processor, as above.
- **The conversation ID reaches agent and chat spans only.** Add it to the rest
  in a span processor.
- **A chat model that wraps another doubles chat spans and tokens.** Use
  middleware for retries and fallbacks.
- **No context propagation on the async API.** With `ainvoke`, spans created
  inside the run parent to the span around the call, not to the
  instrumentation's spans.
- **Content capture takes mode values only**, and is read once at
  `instrument()`. `true` captures nothing.
- **The dependency check needs the `langchain` distribution**, though the
  package imports only `langchain_core`.

## What to Look For in Scout

### Follow one diagnosis end to end

Search spans by `gen_ai.conversation.id`. The trace is rooted at
`POST /api/v1/diagnose` and holds `invoke_agent runbook_assistant`, its
`chat qwen3.5:9B` turns, the `execute_tool` spans, the retrieval with its
embedding and SQL spans, and the `INSERT` of the saved diagnosis.

### Find failed model calls and why

Filter `chat` spans on error status and read the recorded exception. A retried
attempt shows as a failed `chat` span next to the one that succeeded; a
fallback shows as failed spans for the primary model, a span for the fallback
model, and a `provider_fallback` event on the agent span. Plot
`base14.gen_ai.retry.count` and `base14.gen_ai.fallback.count` for the rate.

### Read tokens and cost by model

Plot `gen_ai.client.token.usage` split by `gen_ai.token.type` and grouped by
`gen_ai.request.model`, and sum `base14.gen_ai.cost` by the same attribute. On
Ollama the cost is 0, and so is `base14.gen_ai.cost_usd` on each chat span.

### Check that retrieval found runbooks

Open the `retrieval` spans. `gen_ai.data_source.id` is `runbooks` and
`app.retrieval.chunk_count` is the number of chunks returned, 3 in the
example. With `span_only`, `gen_ai.retrieval.documents` lists their IDs.

### Find slow tools

Group `gen_ai.execute_tool.duration` by `gen_ai.tool.name`, or sort
`execute_tool` spans by duration.

## Production Patterns

- **Keep content capture at `no_content` for real data.** Set `span_only` only
  where you need it, and scrub in a span exporter before export.
- **Scrub tool arguments, results and retrieval queries, not just prompts.**
  Incident text often carries IPs, hostnames and tokens.
- **Name every agent and pass a conversation ID per request**, so one request
  is one search in Scout.
- **Retry in middleware, not in a wrapper model**, and turn off the provider
  SDK's own retries.
- **Keep the price table current.** A model missing from it records 0 rather
  than failing.
- **Run one LangChain instrumentation.** The official package together with
  OpenLLMetry or your own handler traces every operation twice.
- **Batch exports and send through a collector**, which holds the Scout
  credentials.

## Choosing an Approach

Every LangChain instrumentation works through a callback handler; they differ
in conventions and defaults.

| Approach | Package | Conventions | Notes |
| --- | --- | --- | --- |
| **Official OpenTelemetry** | `opentelemetry-instrumentation-genai-langchain` | `gen_ai.*` | Beta, from the OpenTelemetry GenAI SIG. Content off by default. This guide. |
| **OpenLLMetry (Traceloop)** | `opentelemetry-instrumentation-langchain` | `gen_ai.*` plus `traceloop.*` | Content on by default, controlled by `TRACELOOP_TRACE_CONTENT`. At 0.62.4 the model is `unknown` on Ollama. |
| **OpenInference (Arize)** | `openinference-instrumentation-langchain` | `openinference.*` | Needs translation to `gen_ai.*`. |
| **LangSmith** | `langsmith[otel]` | LangSmith's own | Defaults to LangSmith cloud. |
| **Your own callback handler** | your code | what you emit | For chains the package does not cover or attributes it does not set. |

### When to write your own callback handler

Write one when the package does not fit: custom chains or runnables it does
not trace, attributes it does not set that you cannot add in a span processor,
or LangChain versions outside `>=0.3.21,<2`. The
[LangChain callback handler guide](../../../guides/ai-observability/langchain-callback-handler.md)
maps LangChain's run tree onto spans, step by step.

## Scout Wiring

Route the SDK's OTLP output to a collector that forwards to base14 Scout. The
collector authenticates with `oauth2client` and applies the `environment`
attribute on the way out.

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
        - 'IsMatch(name, ".*/healthz.*")'
        - 'IsMatch(name, ".*/readyz.*")'

  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048

  attributes:
    actions:
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

The collector upserts `environment` because the Scout UI filters on it; the
upsert guarantees the attribute is present even when an SDK resource does
not set it.

`filter/noisy` drops health-probe spans from the traces pipeline only. The
`debug` exporter prints every batch to the collector log, which is what the
troubleshooting steps below read; drop it once you are past first setup.

### Docker Compose

Substitute your own application for the `app` service. The parts that matter
for telemetry are the two `OTEL_*` variables pointing at the collector, and the
collector service itself.

```yaml showLineNumbers title="compose.yaml"
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OTEL_SERVICE_NAME=your-agent-service
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-no_content}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
      # If your LLM runs on the host rather than in a container
      - OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
    extra_hosts:
      - "host.docker.internal:host-gateway"  # needed on Linux, not Docker Desktop
    depends_on:
      otel-collector:
        condition: service_started

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

The collector needs Scout credentials in its own environment, not your app's.
Your app only ever talks OTLP to `otel-collector:4318` and stays unaware of
Scout entirely, which is what lets you point the same app at a different
backend by editing one file.

If your models run on the host rather than in a container, `extra_hosts` is
what makes `host.docker.internal` resolve on Linux. Docker Desktop provides it
without the entry.

## Running Your Application

```bash showLineNumbers title="Terminal"
# start the stack (the collector picks up Scout credentials from the environment)
docker compose up -d --build

# send an incident question
curl -s -X POST http://localhost:8000/api/v1/diagnose \
  -H 'Content-Type: application/json' \
  -d '{"question": "checkout pods are being OOMKilled, what do I do?"}'
```

The example's `scripts/verify-scout.sh` sends diagnoses and checks the
collector output: the span tree, that every `chat` span comes from the
LangChain instrumentation and none is nested in another, the GenAI attributes
and the metrics. Run the stack and the script with
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only` to check content
capture as well.

## Troubleshooting

### No chat or agent spans

`instrument()` did not run, ran before the tracer provider was set, or the
dependency check failed because `langchain` is not installed. The package logs
an error in that case. Call `instrument()` after `trace.set_tracer_provider`,
and pass `skip_dep_check=True` for an app built on `langchain-core` and
`langgraph` only.

### Two chat spans per model call

A chat model wraps another chat model, and both are traced. Move retries and
fallbacks into `create_agent` middleware, as in
[Retries and Fallbacks with Middleware](#retries-and-fallbacks-with-middleware).
Two chat spans side by side with the same parent, one failed, are a retry.

### No content on spans with capture set to `true`

The package accepts `no_content`, `span_only`, `event_only` and
`span_and_event` only. Set `span_only`, and restart the process: the mode is
read once at `instrument()`.

### HTTP and database spans are not under the agent

The agent runs on `ainvoke`. The package does not propagate context on the
async API. Use sync `invoke` where the nesting matters.

### `gen_ai.response.finish_reasons` is `["error"]` on a successful call

Expected on Ollama; see [Known Gaps](#known-gaps). Check the span status.

## FAQ

### Is there an official OpenTelemetry instrumentation for LangChain?

Yes. `opentelemetry-instrumentation-genai-langchain` is published by the
OpenTelemetry GenAI SIG from the `opentelemetry-python-genai` repository. It is
beta, supports `langchain>=0.3.21,<2`, and traces LangChain and LangGraph runs
through LangChain's callbacks.

### Is `opentelemetry-instrumentation-langchain` the official package?

No. `opentelemetry-instrumentation-langchain` is Traceloop's OpenLLMetry; the
official OpenTelemetry package is
`opentelemetry-instrumentation-genai-langchain`. Both trace LangChain through
callbacks. The official one emits
only `gen_ai.*` attributes and captures no content by default; OpenLLMetry adds
`traceloop.*` attributes and captures content unless
`TRACELOOP_TRACE_CONTENT=false`.

### Which spans does a LangChain agent produce?

A `create_agent` run gives an `invoke_agent` span with a `chat {model}` span
for each model call, an `execute_tool {name}` span for each tool and a
`retrieval` span for each retriever. LangGraph's internal nodes get no spans
of their own.

### How do I set the agent name and conversation ID on LangChain spans?

Pass `name=` to `create_agent` and `config={"metadata": {"conversation_id":
...}}` to `invoke`. The instrumentation puts the name on agent and tool spans
and the conversation ID on agent and chat spans. A span processor can copy the
conversation ID to the rest.

### How do I track LLM cost with LangChain and OpenTelemetry?

Add it in a span exporter. Read `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens` and the model from each finished `chat` span,
price them from a table, and set `base14.gen_ai.cost_usd` before export. Record
a cost counter in middleware for dashboards.

### Can I capture prompts and completions in LangChain traces?

Yes. Set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only` before
the process starts. Chat spans then carry the input and output messages, the
system instructions and the tool definitions, and tool spans carry arguments
and results. Scrub them in a span exporter before export.

### How do I retry or fall back between models without doubling spans?

Use `create_agent` middleware. A `wrap_model_call` hook can call the handler
again on failure, or with `request.override(model=fallback)`, and every
attempt runs the real model with one `chat` span. A wrapper chat model gives
two spans per call.

### Does the LangChain instrumentation trace embeddings?

No. LangChain has no callback for embeddings. Wrap the embedding client and
open an `embeddings {model}` span yourself, as the example does.

### Should I write my own LangChain callback handler?

Only if the official package does not cover your chains or the attributes you
need cannot be added in a span processor. See the
[LangChain callback handler guide](../../../guides/ai-observability/langchain-callback-handler.md).

## What's Next?

### Related Guides

- [LangChain Callback Handler][callback-guide] - Write your own handler when
  the package does not fit.
- [LangGraph Instrumentation](./langgraph.md) - Hand-built `StateGraph`
  agents.
- [LlamaIndex Instrumentation](./llamaindex.md) - RAG-first framework tracing
  with the same GenAI conventions.
- [FastAPI Instrumentation](./fast-api.md) - The HTTP host that carries the
  agent endpoint.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Alert on
  cost spikes, error rates, or slow diagnoses.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  token, cost, and latency dashboards from the GenAI metrics.

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OpenTelemetry Collector.

## Complete Example

The code on this page comes from
[`python/ai-runbook-assistant`](https://github.com/base-14/examples/tree/main/python/ai-runbook-assistant).

```text
src/runbook_assistant/
├── telemetry/
│   ├── setup.py         # providers, exporters, instrumentation
│   ├── genai_spans.py   # conversation, data source, cost and scrubbing
│   └── metrics.py       # base14.gen_ai.* instruments
├── agent.py             # create_agent, conversation ID
├── llm.py               # chat models, retry and fallback middleware
├── embeddings.py        # embeddings span
├── retriever.py         # pgvector retriever, chunk count
├── tools.py             # search_runbooks, query_metrics, search_logs, get_service_status
└── main.py              # FastAPI app
```

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/python/ai-runbook-assistant
cp .env.example .env
ollama pull qwen3.5:9B && ollama pull embeddinggemma
docker compose up -d --build
./scripts/test-api.sh
./scripts/verify-scout.sh
```

## References

- [OpenTelemetry GenAI instrumentation for Python](https://github.com/open-telemetry/opentelemetry-python-genai)
- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
- [LangChain agent middleware](https://docs.langchain.com/oss/python/langchain/middleware)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)

[callback-guide]: ../../../guides/ai-observability/langchain-callback-handler.md
