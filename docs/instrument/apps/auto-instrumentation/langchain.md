---
title:
  LangChain OpenTelemetry Instrumentation - Callback Handler Tracing Guide
sidebar_label: LangChain
sidebar_position: 5.9
description:
  Trace LangChain agents, tool calls, and RAG retrieval with OpenTelemetry.
  Start with zero-code auto-instrumentation, then write a custom callback
  handler for clean GenAI spans.
keywords:
  [
    langchain opentelemetry instrumentation,
    langchain tracing,
    langchain callback handler,
    openllmetry,
    opentelemetry-instrumentation-langchain,
    gen_ai semantic conventions,
    llm observability,
    rag retrieval tracing,
    tool calling agent tracing,
    langchain token cost tracking,
    create_agent instrumentation,
    ollama tracing,
    langchain vs langsmith,
    ai agent monitoring python,
    genai agent spans,
  ]
---

# LangChain

Instrument a LangChain agent with OpenTelemetry to get one trace across the
whole request: the HTTP call, the agent run, every LLM turn, each tool
invocation, the RAG retrieval, and the database write. This guide takes two
paths. First, zero-code auto-instrumentation that produces traces in minutes.
Then a hand-written callback handler that emits clean GenAI
semantic-convention spans when you need control over names, attributes, cost
metrics, and content capture.

Both paths rest on the same mechanism: **a LangChain callback handler**. The
zero-code library injects one for you; the custom path is you writing your
own.

The example is a small SRE runbook assistant. You POST an incident question;
a tool-calling agent retrieves the relevant runbook from a pgvector store,
inspects service metrics, logs, and status through tools, and returns a cited
diagnosis. That shape - agent, tools, retrieval, database - is where a flat
log stream stops being enough. Your own agent will differ in the details; the
handler is the same either way.

:::tip TL;DR

For a quick start, `pip install opentelemetry-instrumentation-langchain` and
call `LangchainInstrumentor().instrument()` - traces appear in Scout with no
code changes. For production-grade GenAI spans, attach a custom
`BaseCallbackHandler` that maps LangChain's `run_id` / `parent_run_id` run
tree to OpenTelemetry spans with `gen_ai.*` attributes, token and cost
metrics, and content capture off by default.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## LangChain vs LangGraph

LangChain 1.x agents built with `create_agent` are **LangGraph graphs under
the hood** - a stateful `model` / `tools` graph, not the old `AgentExecutor`
loop. This guide covers the high-level `create_agent` API and
callback-handler instrumentation, where you observe the agent as a run tree
without touching graph internals. The
[LangGraph guide](./langgraph.md) covers the complementary case: a
hand-built `StateGraph` where you wrap each node and edge with spans
yourself. If you build graphs by hand, read that guide; if you use
`create_agent` and want the agent, tools, and retrieval traced, stay here.

## Who This Guide Is For

This documentation is designed for:

- **AI/ML engineers**: building LangChain agents and needing visibility into
  which tool ran, how many tokens a turn used, and where latency accrues.
- **Backend developers**: adding an agent endpoint to an existing FastAPI
  service and wanting one trace across HTTP, agent, LLM, and database.
- **Platform teams**: standardizing GenAI observability on OpenTelemetry
  semantic conventions instead of a vendor-specific tracer.
- **DevOps and SRE engineers**: deploying LangChain services with cost
  tracking, error visibility, and unified traces in production.

## Overview

This guide demonstrates how to:

- Enable zero-code LangChain tracing with OpenLLMetry auto-instrumentation.
- Understand why every LangChain instrumentor is a callback handler.
- Build a custom `OTelCallbackHandler` that emits GenAI-semconv spans for
  chains, chat models, tools, and retrievers.
- Parent spans correctly across threads and `await` boundaries using the
  run tree, not the ambient context.
- Record token, cost, and duration metrics per LLM call.
- Capture prompts and completions safely, off by default, with PII scrubbing.
- Handle real failures and graceful degradation without leaking spans.
- Read the resulting span tree and avoid the common pitfalls.
- Wire the collector to base14 Scout with the dual-key environment
  convention.

## Prerequisites

Before starting, ensure you have:

- **Python 3.10 or later** installed. That is the floor for LangChain 1.x and
  the OpenTelemetry SDK, which is what the callback handler needs.
- **A running collector** reachable over OTLP - see
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- **PostgreSQL 18 with pgvector** for the runbook store (the compose file
  below provisions it).
- **An LLM**: a local
  [Ollama](https://ollama.com) model works with no API key; Anthropic,
  OpenAI, and Google are configurable alternatives.
- Basic familiarity with OpenTelemetry traces, spans, and metrics.

### Compatibility Matrix

What the instrumentation itself needs:

| Component                                  | Minimum | Recommended |
| ------------------------------------------ | ------- | ----------- |
| Python                                     | 3.10    | 3.13+       |
| langchain                                  | 1.3     | 1.3.13+     |
| langchain-core                             | 1.4     | 1.4.9+      |
| opentelemetry-sdk / api                    | 1.40.0  | 1.40+       |
| opentelemetry-instrumentation-langchain    | 0.62    | 0.62.1+     |

The `BaseCallbackHandler` lifecycle this guide builds on has been stable since
LangChain 0.1, so the handler ports back further than the table suggests. The
`create_agent` API is the part that needs 1.x.

Everything else depends on what your app already uses. The example app happens
to run FastAPI, SQLAlchemy, and pgvector on PostgreSQL 18, and pins Python 3.14
for unrelated reasons - none of that is required to instrument LangChain. Swap
in your own web framework and datastore; the handler does not care.

`create_agent` pulls LangGraph in transitively. For LangGraph's own node and
graph spans, see [LangGraph](./langgraph.md).

Treat every package as version-sensitive and re-pin at build time; the
LangChain and OpenLLMetry lines move quickly.

## Installation

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="package-manager">
<TabItem value="pip" label="pip" default>
```

```bash showLineNumbers title="Terminal"
# Core - LangChain plus the OpenTelemetry SDK and an OTLP exporter
pip install \
  langchain langchain-core \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http

# Zero-code path only, for the quick start below
pip install opentelemetry-instrumentation-langchain

# Whichever LLM provider you use
pip install langchain-ollama
# langchain-anthropic | langchain-openai | langchain-google-genai

# Instrumentation for the rest of your stack, so LangChain spans
# join the same trace as your HTTP and database calls
pip install \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-httpx
```

```mdx-code-block
</TabItem>
<TabItem value="uv" label="uv">
```

```bash showLineNumbers title="Terminal"
# Core - LangChain plus the OpenTelemetry SDK and an OTLP exporter
uv add \
  langchain langchain-core \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http

# Zero-code path only, for the quick start below
uv add opentelemetry-instrumentation-langchain

# Whichever LLM provider you use
uv add langchain-ollama
# langchain-anthropic | langchain-openai | langchain-google-genai

# Instrumentation for the rest of your stack, so LangChain spans
# join the same trace as your HTTP and database calls
uv add \
  opentelemetry-instrumentation-fastapi \
  opentelemetry-instrumentation-sqlalchemy \
  opentelemetry-instrumentation-httpx
```

```mdx-code-block
</TabItem>
</Tabs>
```

:::warning Package name collision

The PyPI name `opentelemetry-instrumentation-langchain` is **Traceloop's
OpenLLMetry** package, not the official OpenTelemetry GenAI SIG one.
`pip install opentelemetry-instrumentation-langchain` installs Traceloop's
build. It is mature and exports to any OTLP collector, so it is the right
choice to start. The official SIG instrumentation ships from the
`opentelemetry-python-contrib` source tree and is the emerging
`gen_ai`-native standard to track. See
[Choosing an Approach](#choosing-an-approach).

:::

## Configuration

Instrumentation is configured entirely through environment variables. These
are the standard OpenTelemetry ones, read by the SDK itself:

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=your-agent-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

| Variable | Default | What it controls |
| -------- | ------- | ---------------- |
| `OTEL_SERVICE_NAME` | unset | Becomes `service.name` on every span. Set it, or your agent shows up as `unknown_service`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint of your collector. |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Comma-separated resource attributes. Use it for `deployment.environment.name`. |
| `OTEL_SEMCONV_STABILITY_OPT_IN` | unset | Set to `gen_ai_latest_experimental` to opt into the current GenAI conventions rather than the frozen older set. |

Then there is content capture, which is the one GenAI-specific decision and
the one that carries privacy consequences. Each path has its own flag, and
they default in opposite directions:

| Path | Variable | Default |
| ---- | -------- | ------- |
| Custom callback handler | `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false` |
| OpenLLMetry auto-instrumentation | `TRACELOOP_TRACE_CONTENT` | **`true`** |

If you start with the zero-code path, prompts and completions are recorded
unless you turn them off:

```bash showLineNumbers title="Terminal"
export TRACELOOP_TRACE_CONTENT=false
```

See [Content Capture and PII](#content-capture-and-pii) before enabling either
in production.

:::tip One switch for the whole thing

Worth copying from the example app: a single `INSTRUMENTATION_MODE` setting
with values `auto`, `callback`, and `off`, read once at startup. It lets you
compare the two paths against the same workload and kill instrumentation
outright without a redeploy. Your own app config (model names, datastore URLs,
API keys) stays separate from this and has no bearing on the telemetry.

:::

## Quick Start: Auto-Instrumentation

The fastest path to a trace is zero-code. Enable OpenLLMetry's
`LangchainInstrumentor` once, before you build the agent, and every LangChain
run emits spans.

```python showLineNumbers title="src/runbook_assistant/telemetry/auto.py"
"""Zero-code LangChain instrumentation via OpenLLMetry (Traceloop)."""

import logging


logger = logging.getLogger(__name__)
_enabled = False


def enable_auto_instrumentation() -> None:
    global _enabled
    if _enabled:
        return
    from opentelemetry.instrumentation.langchain import LangchainInstrumentor

    LangchainInstrumentor().instrument()
    _enabled = True
    logger.info("OpenLLMetry LangChain auto-instrumentation enabled")
```

That is the entire integration. Point the OTLP exporter at your collector
(see [Scout Wiring](#scout-wiring)), send a request, and the trace appears in
Scout. With the agent answering an incident question, the auto-instrumented
trace looks like this:

```text
POST /api/v1/diagnose                                 SERVER  (FastAPI)
└─ invoke_agent LangGraph                             INTERNAL
   └─ LangGraph.workflow                              INTERNAL
      ├─ execute_task model                           INTERNAL  (graph node)
      │  └─ ChatOllama.chat                           CLIENT    (LLM turn)
      │     └─ POST /api/chat                         CLIENT    (httpx → Ollama)
      └─ execute_task tools                           INTERNAL  (graph node)
         ├─ execute_tool search_runbooks              INTERNAL
         │  └─ vector_db_retrieve VectorStoreRetriever CLIENT   (retrieval)
         └─ execute_tool query_metrics                INTERNAL
   (repeats model → tools until the agent answers)
```

Notice how much shows up for free: the agent run, each LangGraph node
(`model`, `tools`), the LLM turns, the tool calls, and the vector retrieval.
The LLM spans carry token usage, and the whole tree nests under the FastAPI
server span, so the agent shares a trace with your HTTP and database
telemetry.

### Auto-Instrumentation Is a Callback Handler

`LangchainInstrumentor().instrument()` works by monkeypatching
`langchain_core.callbacks.BaseCallbackManager.__init__` to inject its own
callback handler into every run. Traceloop OpenLLMetry, the official OTel
GenAI SIG instrumentation, and OpenInference all do the same thing - they add
a handler for you.

LangChain emits observability through callback handlers. Auto-instrumentation
injects one; the deep dive below is you writing your own.

### Where Auto-Instrumentation Falls Short

The zero-code trace is excellent for exploration, but a few things make a
custom handler worthwhile. These are observed from OpenLLMetry 0.62.1 against
a local `ChatOllama` model:

- **Framework-centric span names.** The LLM span is `ChatOllama.chat`, not
  the GenAI-semconv `chat {model}`; the agent is `invoke_agent LangGraph`
  rather than your service name; retrieval is
  `vector_db_retrieve VectorStoreRetriever`.
- **Model field is `unknown`.** For Ollama, `gen_ai.request.model` and
  `gen_ai.response.model` come through as `"unknown"`; the real model name is
  only in a proprietary `traceloop.association.properties.ls_model_name`
  attribute.
- **Proprietary attributes.** Every span carries `traceloop.*` association
  properties alongside the `gen_ai.*` ones.
- **Content on by default.** Auto-instrumentation records the full prompt,
  system message, tool arguments, and retrieved documents in span attributes
  such as `gen_ai.input.messages` and `gen_ai.task.input`. Crucially, it
  **ignores** `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`; it is
  gated by OpenLLMetry's own `TRACELOOP_TRACE_CONTENT` (default `true`). To
  turn content off, set `TRACELOOP_TRACE_CONTENT=false`.

None of these block you - they are the reasons a team with compliance or
naming requirements moves to the custom handler next.

## Callback-Handler Deep Dive

### Why Callbacks

A LangChain run is a **tree**. Every step - the agent, each LLM call, each
tool, each retrieval - has a `run_id`, and every child step carries its
parent's id as `parent_run_id`. LangChain reports lifecycle events for each
node to any registered callback handler:

| LangChain event                        | Fires when                     |
| -------------------------------------- | ------------------------------ |
| `on_chain_start` / `on_chain_end`      | a chain or agent run begins    |
| `on_chat_model_start` / `on_llm_end`   | an LLM turn begins and returns |
| `on_tool_start` / `on_tool_end`        | a tool is invoked              |
| `on_retriever_start` / `on_retriever_end` | a retriever runs            |
| `on_*_error`                           | any of the above raises        |

Mapping that run tree onto an OpenTelemetry span tree is the whole job: start
a span on each `*_start`, end it on the matching `*_end`, and parent each
span on its `parent_run_id`'s span.

### Telemetry Setup

Bootstrap the SDK once, before the app serves traffic. This wires the OTLP
exporters for all three signals, the dual-key environment resource, and base
auto-instrumentation for httpx, SQLAlchemy, and logging.

```python showLineNumbers title="src/runbook_assistant/telemetry/setup.py"
def build_resource() -> Resource:
    """Resource with the dual-key environment convention."""
    s = get_settings()
    return Resource.create(
        {
            "service.name": s.otel_service_name,
            "service.version": _APP_VERSION,
            # Dual-key: Scout UI filters on lowercase `environment`.
            "deployment.environment.name": s.scout_environment,
            "environment": s.scout_environment,
        }
    )
```

```python showLineNumbers title="src/runbook_assistant/telemetry/setup.py"
def setup_telemetry(engine: Any = None) -> tuple[trace.Tracer, metrics.Meter]:
    resource = build_resource()
    endpoint = os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"
    )

    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(trace_provider)

    # Required for the GenAI token, cost, duration, and error instruments
    # in the Metrics section below - without a meter provider they no-op.
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics"),
        export_interval_millis=10_000,
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[reader])
    )

    # OTLP logs carry the active trace_id/span_id for trace<>log correlation.
    log_provider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{endpoint}/v1/logs"))
    )
    _logs.set_logger_provider(log_provider)

    HTTPXClientInstrumentor().instrument()
    LoggingInstrumentor().instrument(set_logging_format=True)
    if engine is not None:
        SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)

    return (
        trace.get_tracer("langchain-agent"),
        metrics.get_meter("langchain-agent"),
    )
```

If you take the zero-code path, call `enable_auto_instrumentation()` at the end
of this function, after the providers exist and before the agent is built.

The httpx instrumentation matters more than it looks: LangChain has no
embeddings callback event, and Ollama chat and embeddings both go over HTTP.
So even without a semantic span, the `POST /api/chat` and `POST /api/embed`
transport calls show up as CLIENT spans under the LLM and retrieval steps.

### Build the Callback Handler

The handler keeps a `run_id -> span` map and a small `_RunState` per run. The
central correctness point is `_parent_ctx`: it parents a new span on the
**stored** parent span, never on `trace.get_current_span()`, because
LangChain callbacks can fire on worker threads or across `await`.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
class OTelCallbackHandler(BaseCallbackHandler):
    def __init__(
        self,
        tracer: trace.Tracer | None = None,
        agent_name: str = "agent",
        data_source_id: str = "knowledge_base",
        conversation_id: str | None = None,
    ) -> None:
        self._tracer = tracer or trace.get_tracer("langchain.callback")
        self._agent_name = agent_name
        self._data_source_id = data_source_id
        self._conversation_id = conversation_id
        self._runs: dict[UUID, _RunState] = {}
        self._metrics = get_metrics()
        self._capture = get_settings().capture_content

    def _parent_ctx(self, parent_run_id: UUID | None) -> otel_context.Context | None:
        if parent_run_id is not None and parent_run_id in self._runs:
            return trace.set_span_in_context(self._runs[parent_run_id].span)
        return None

    def _start(self, run_id, parent_run_id, name, kind) -> Span:
        span = self._tracer.start_span(
            name, context=self._parent_ctx(parent_run_id), kind=kind
        )
        self._runs[run_id] = _RunState(span, time.perf_counter())
        return span
```

:::danger Parent on the run tree, not the ambient context

Because callbacks can arrive off the request thread,
`trace.get_current_span()` may point at the wrong span, or none. Always
resolve the parent from your own `run_id -> span` map via `parent_run_id`.
Skipping this is the most common cause of mis-nested LangChain traces.

:::

#### The chain (agent) span

The root chain run - the one with no `parent_run_id` - becomes the
`invoke_agent` span, named after your service. Intermediate LangGraph node
runs (`model`, `tools`) are collapsed to a pass-through so the tree shows the
meaningful chat, tool, and retrieval spans instead of graph plumbing.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_chain_start(
        self, serialized, inputs, *, run_id, parent_run_id=None,
        tags=None, metadata=None, **kwargs,
    ) -> None:
        if parent_run_id is None:
            span = self._start(
                run_id, None, f"invoke_agent {self._agent_name}", SpanKind.INTERNAL
            )
            span.set_attribute("gen_ai.operation.name", "invoke_agent")
            span.set_attribute("gen_ai.agent.name", self._agent_name)
            if self._conversation_id:
                span.set_attribute("gen_ai.conversation.id", self._conversation_id)
        else:
            # Skip the span for intermediate LangGraph nodes; pass-through keeps
            # child spans nested under the nearest real ancestor.
            parent = self._runs.get(parent_run_id)
            if parent is not None:
                self._runs[run_id] = _RunState(
                    parent.span, parent.start, owns_span=False
                )
```

Whether you collapse node runs or keep them is a judgment call. Collapsing
gives a clean agent-centric tree; keeping them mirrors the auto-instrumented
view where `execute_task model` and `execute_task tools` are visible. This
example collapses them - see
[Reading the Span Tree](#reading-the-span-tree).

#### The chat model span

`on_chat_model_start` opens a `chat {model}` CLIENT span. The model and
provider come from the run metadata (`ls_model_name`, `ls_provider`), which
is how the handler gets the real model name that auto-instrumentation reports
as `unknown`.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def _start_llm(self, run_id, parent_run_id, metadata, messages) -> None:
        meta = metadata or {}
        model = meta.get("ls_model_name", "unknown")
        provider = meta.get("ls_provider", "unknown")
        span = self._start(run_id, parent_run_id, f"chat {model}", SpanKind.CLIENT)
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", provider)
        span.set_attribute("gen_ai.request.model", model)
```

`on_llm_end` reads token usage and the finish reason off the result, sets the
usage attributes, and records the metrics. The finish reason is
provider-aware: Ollama reports `done_reason`, while cloud providers use
`stop_reason` or `finish_reason`.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs) -> None:
        state = self._runs.get(run_id)
        if state is None:
            return
        span = state.span
        in_tok, out_tok, finish, resp_model = _usage_from_result(response)
        provider = getattr(span, "attributes", {}).get("gen_ai.provider.name", "unknown")
        model = resp_model or "unknown"
        if resp_model:
            span.set_attribute("gen_ai.response.model", resp_model)
        if finish:
            span.set_attribute("gen_ai.response.finish_reasons", [finish])
        span.set_attribute("gen_ai.usage.input_tokens", in_tok)
        span.set_attribute("gen_ai.usage.output_tokens", out_tok)

        attrs = {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": provider,
            "gen_ai.request.model": model,
        }
        self._metrics.record_tokens(attrs, in_tok, out_tok)
        self._metrics.record_duration(attrs, time.perf_counter() - state.start)
        cost = calculate_cost(model, in_tok, out_tok)
        if cost:
            span.set_attribute("gen_ai.usage.cost_usd", cost)
            self._metrics.add_cost(attrs, cost)
        self._end(run_id)
```

#### The tool span

`on_tool_start` opens an `execute_tool {name}` INTERNAL span with the
GenAI tool attributes.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_tool_start(
        self, serialized, input_str, *, run_id, parent_run_id=None, **kwargs,
    ) -> None:
        name = (serialized or {}).get("name") or "tool"
        span = self._start(
            run_id, parent_run_id, f"execute_tool {name}", SpanKind.INTERNAL
        )
        span.set_attribute("gen_ai.operation.name", "execute_tool")
        span.set_attribute("gen_ai.tool.name", name)
        span.set_attribute("gen_ai.tool.type", "function")
        if self._capture and input_str:
            from runbook_assistant.pii import scrub

            span.set_attribute("gen_ai.tool.call.arguments", scrub(input_str))
```

#### The retrieval span

`on_retriever_start` opens a `retrieval {data_source}` CLIENT span; on end,
the handler records how many chunks came back as a custom `app.*` attribute.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_retriever_start(
        self, serialized, query, *, run_id, parent_run_id=None, **kwargs,
    ) -> None:
        span = self._start(
            run_id, parent_run_id,
            f"retrieval {self._data_source_id}", SpanKind.CLIENT,
        )
        span.set_attribute("gen_ai.operation.name", "retrieval")
        span.set_attribute("gen_ai.data_source.id", self._data_source_id)

    def on_retriever_end(self, documents, *, run_id: UUID, **kwargs) -> None:
        state = self._runs.get(run_id)
        if state is not None:
            state.span.set_attribute("app.retrieval.chunk_count", len(documents or []))
        self._end(run_id)
```

Custom attributes use the `app.*` prefix so they never collide with reserved
`gen_ai.*` names - `app.retrieval.chunk_count` here, and you might add
`app.retrieval.score_threshold` or similar.

### The Resulting Spans

With the custom handler, the same incident question produces a clean,
semconv-named tree:

```text
POST /api/v1/diagnose                       SERVER    (FastAPI)
└─ invoke_agent runbook_assistant           INTERNAL
   ├─ chat qwen3.5:9B                        CLIENT    (LLM turn, picks tools)
   │  └─ POST /api/chat                      CLIENT    (httpx → Ollama)
   ├─ execute_tool search_runbooks           INTERNAL
   │  └─ retrieval runbooks                  CLIENT
   │     ├─ POST /api/embed                  CLIENT    (httpx → Ollama)
   │     └─ SELECT runbooks                  CLIENT    (pgvector query)
   ├─ execute_tool query_metrics             INTERNAL
   ├─ execute_tool search_logs               INTERNAL
   ├─ execute_tool get_service_status        INTERNAL
   └─ chat qwen3.5:9B                        CLIENT    (LLM turn, writes answer)
└─ INSERT diagnoses                          CLIENT    (SQLAlchemy)
```

The attributes on each span type:

| Span                          | Kind     | Key attributes                                                                                                                                          |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoke_agent runbook_assistant` | INTERNAL | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`, `gen_ai.conversation.id`                                                                  |
| `chat qwen3.5:9B`             | CLIENT   | `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| `execute_tool {name}`         | INTERNAL | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.type=function`                                                                   |
| `retrieval runbooks`          | CLIENT   | `gen_ai.operation.name=retrieval`, `gen_ai.data_source.id`, `app.retrieval.chunk_count`                                                                 |

Compared with the auto-instrumented trace, the model name is correct rather
than `unknown`, span names follow the GenAI conventions, there are no
proprietary attributes, and content is absent unless you opt in.

## Metrics

The handler records GenAI metrics on every LLM turn using dedicated
instruments, so cost and token usage aggregate in dashboards independent of
the spans.

```python showLineNumbers title="src/runbook_assistant/telemetry/metrics.py"
class GenAIMetrics:
    def __init__(self) -> None:
        meter = metrics.get_meter("gen_ai.client")
        self._tokens = meter.create_histogram(
            "gen_ai.client.token.usage", unit="{token}",
            description="Tokens used per LLM call",
        )
        self._duration = meter.create_histogram(
            "gen_ai.client.operation.duration", unit="s",
            description="Duration of GenAI operations",
        )
        self._cost = meter.create_counter(
            "gen_ai.client.cost", unit="usd",
            description="Cost of GenAI operations in USD",
        )
        self._errors = meter.create_counter(
            "gen_ai.client.error.count", unit="{error}",
            description="GenAI errors by type",
        )

    def record_tokens(self, attrs, input_tokens, output_tokens) -> None:
        self._tokens.record(input_tokens, {**attrs, "gen_ai.token.type": "input"})
        self._tokens.record(output_tokens, {**attrs, "gen_ai.token.type": "output"})

    def add_error(self, attrs) -> None:
        self._errors.add(1, attrs)
```

Cost comes from a small per-model price table. Unknown models return `0.0` so
the calculation never raises - local Ollama has no per-token price, so cost
is zero there and non-zero once you point the agent at a cloud provider.

```python showLineNumbers title="src/runbook_assistant/cost.py"
PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-opus-4-8": (5.0, 25.0),
    "gpt-4o": (2.5, 10.0),
    "gemini-2.5-pro": (1.25, 10.0),
}


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = PRICING.get(model) or PRICING.get(_normalize(model))
    if not rates:
        return 0.0
    in_rate, out_rate = rates
    return (input_tokens * in_rate + output_tokens * out_rate) / 1_000_000
```

With `gen_ai.request.model` and `gen_ai.provider.name` on the metric points,
a dashboard query like `sum(gen_ai.client.cost) by (gen_ai.request.model)`
gives per-model spend, and the token histogram splits input from output via
`gen_ai.token.type`.

## Content Capture and PII

Prompts and completions are **off by default**. The handler captures them
only when `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`, and even
then it runs the text through a scrubber first and records it as a span event,
not a raw attribute.

```python showLineNumbers title="src/runbook_assistant/pii.py"
_EMAIL = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_BEARER = re.compile(r"(?i)bearer\s+[a-z0-9._-]+")
_APIKEY = re.compile(r"\b(sk-|key-)[A-Za-z0-9]{8,}\b")


def scrub(text: str, limit: int = 1000) -> str:
    if not text:
        return ""
    text = _EMAIL.sub("[email]", text)
    text = _IPV4.sub("[ip]", text)
    text = _BEARER.sub("[token]", text)
    text = _APIKEY.sub("[key]", text)
    return text[:limit]
```

:::warning Auto-instrumentation captures content by default

The custom handler above respects
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`. OpenLLMetry
auto-instrumentation does **not** - it records full prompts, tool arguments,
and retrieved documents by default and is controlled by its own
`TRACELOOP_TRACE_CONTENT` variable. If you run auto mode in an environment
with sensitive data, set `TRACELOOP_TRACE_CONTENT=false` explicitly.

:::

## Error Handling

The handler distinguishes a real failure from a failure the agent recovers
from. A failed LLM call records the exception, sets `error.type`, and marks
the span `ERROR`. A tool that fails but that the agent works around marks the
tool span `ERROR` while leaving the parent `invoke_agent` span green, adding
an event instead - the request succeeded, so the agent span should not read
as failed.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def _error(self, run_id: UUID, error: BaseException) -> None:
        state = self._runs.pop(run_id, None)
        if state is None or not state.owns_span:
            return
        span = state.span
        span.record_exception(error)
        span.set_attribute("error.type", type(error).__name__)
        span.set_status(Status(StatusCode.ERROR, str(error)))
        span.end()

    def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs) -> None:
        self._error(run_id, error)
        parent = self._runs.get(parent_run_id) if parent_run_id else None
        if parent is not None:
            parent.span.add_event(
                "tool_execution_failed", {"error.type": type(error).__name__}
            )
```

Retrieval failure follows the same graceful-degradation shape: the retriever
span is marked `ERROR`, and the parent gets a `rag_retrieval_degraded` event
rather than an error status. Because every `_error` path pops the `run_id`
from the map, a failed run never orphans a span or leaks a stored context.

Record the error on the metric side too. Spans tell you about one failed
request; the `gen_ai.client.error.count` counter tells you the rate, and it
survives sampling:

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_llm_error(self, error, *, run_id: UUID, **kwargs) -> None:
        state = self._runs.get(run_id)
        self._metrics.add_error(
            {
                "gen_ai.operation.name": "chat",
                "error.type": type(error).__name__,
                # Read provider from your own run state, not from the span
                "gen_ai.provider.name": state.provider if state else "unknown",
            }
        )
        self._error(run_id, error)
```

Keep `provider` and `model` on your `_RunState` rather than reading them back
off the span. `Span.attributes` exists on the SDK's `ReadableSpan` but not on
the tracing API, so a sampled-out run hands you a `NonRecordingSpan` and the
attribute silently degrades to `unknown` on the metric point.

## Reading the Span Tree

A few things to look for, and the pitfalls that produce a confusing trace:

- **Two LLM turns per diagnosis.** The first `chat` span chooses tools; the
  final one writes the answer. If you see only one, the agent answered
  without calling a tool.
- **Retrieval nests under its tool.** `retrieval runbooks` is a child of
  `execute_tool search_runbooks`, and the `POST /api/embed` and
  `SELECT runbooks` spans nest under retrieval - embedding then vector query.
- **LangGraph node noise.** In auto mode you also see `execute_task model`
  and `execute_task tools`; the custom handler collapses those. If your
  custom trees look too deep, you are keeping node runs instead of collapsing
  them.
- **Orphan or mis-nested spans** almost always mean a span was parented on
  the ambient context instead of the run tree. Re-check `_parent_ctx`.
- **Double instrumentation.** Running `auto` and `callback` together
  double-instruments every operation. Pick exactly one mode.

## Integration Patterns

There are three places to attach a callback handler; this example uses the
first, one handler per request, so each diagnosis gets its own
`conversation_id`.

```python showLineNumbers title="src/runbook_assistant/main.py"
    @app.post("/api/v1/diagnose", response_model=DiagnoseResponse)
    async def diagnose(req: DiagnoseRequest) -> DiagnoseResponse:
        conversation_id = str(uuid.uuid4())
        callbacks = app.state.handler_factory(conversation_id)
        answer = run_diagnosis(app.state.agent, req.question, callbacks)
        ...
```

```python showLineNumbers title="src/runbook_assistant/agent.py"
def run_diagnosis(agent, question, callbacks=None) -> str:
    result = agent.invoke(
        {"messages": [{"role": "user", "content": question}]},
        config={"callbacks": callbacks or []},
    )
    messages = result.get("messages", [])
    return messages[-1].content if messages else ""
```

- **Per-invocation** (shown): pass `config={"callbacks": [...]}` on each
  `invoke`. Best when per-request context like a conversation id matters.
- **Constructor**: pass `callbacks=[...]` when building the model or chain.
  The handler applies to every call through that object.
- **Global**: register a handler on the callback manager once at startup so
  it applies process-wide. This is effectively what auto-instrumentation
  does.

## The Example Application

The code excerpts throughout this guide come from a working reference app, an
SRE runbook assistant, at
[base-14/examples/python/ai-runbook-assistant](https://github.com/base-14/examples/tree/main/python/ai-runbook-assistant).
Clone it if you want a running trace to compare yours against. The snippets
below are trimmed for readability - helpers like `_RunState`, `get_settings`,
and the PII scrubber live in that repo rather than in the text here.

The pieces the handler observes are ordinary LangChain. The agent is built
with `create_agent`, which returns a LangGraph-backed graph:

```python showLineNumbers title="src/runbook_assistant/agent.py"
from langchain.agents import create_agent


def build_agent(retriever: Any) -> Any:
    return create_agent(
        model=build_chat_model(),
        tools=build_tools(retriever),
        system_prompt=SYSTEM_PROMPT,
    )
```

Tools are plain `@tool` functions; their docstrings are the descriptions the
model sees. `search_runbooks` wraps the pgvector retriever, the rest read a
fixture so the example runs offline and the captured trace is reproducible.

```python showLineNumbers title="src/runbook_assistant/tools.py"
def build_search_runbooks(retriever: Any) -> Any:
    @tool
    def search_runbooks(query: str) -> str:
        """Search the SRE runbook knowledge base for relevant procedures."""
        docs = retriever.invoke(query)
        if not docs:
            return "No matching runbooks found."
        return "\n\n".join(
            f"# {d.metadata.get('title', 'runbook')}\n{d.page_content}" for d in docs
        )

    return search_runbooks
```

The retriever is a `PGVector` store over local `embeddinggemma` embeddings.
The LLM is provider-agnostic - Ollama by default, with Anthropic, OpenAI, and
Google selectable by environment variable.

```python showLineNumbers title="src/runbook_assistant/retriever.py"
def build_retriever(connection_string: str) -> tuple[Any, Any]:
    from langchain_ollama import OllamaEmbeddings
    from langchain_postgres import PGVector

    s = get_settings()
    embeddings = OllamaEmbeddings(model=s.embedding_model, base_url=s.ollama_base_url)
    store = PGVector(
        embeddings=embeddings,
        collection_name="runbooks",
        connection=connection_string,
        use_jsonb=True,
    )
    return store.as_retriever(search_kwargs={"k": 3}), store
```

The `INSTRUMENTATION_MODE` setting selects the path; the app builds the
handler factory accordingly and passes the handlers to each `invoke`.

```python showLineNumbers title="src/runbook_assistant/main.py"
    if s.instrumentation_mode == "callback":
        app.state.handler_factory = lambda conversation_id: [
            OTelCallbackHandler(
                agent_name="runbook_assistant",
                data_source_id=s.data_source_id,
                conversation_id=conversation_id,
            )
        ]
    else:
        app.state.handler_factory = lambda _conversation_id: []
```

## Choosing an Approach

Every option here works by injecting a LangChain callback handler; they differ
in semantic conventions, maturity, and defaults.

| Approach                         | Package                                          | Conventions                    | Notes                                                                 |
| -------------------------------- | ------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------- |
| **OpenLLMetry (Traceloop)**      | `opentelemetry-instrumentation-langchain`        | `gen_ai.*` plus `traceloop.*`  | Mature, exports to any OTLP collector. **Lead with this.** Content on by default; owns the PyPI name. |
| **Official OTel GenAI SIG**      | contrib `instrumentation-genai` (source for now) | `gen_ai.*` native              | Emerging standard; being packaged as `opentelemetry-instrumentation-genai-langchain`. Track it. |
| **OpenInference (Arize)**        | `openinference-instrumentation-langchain`        | own `llm.*` / `openinference.*` | Needs a translation step for `gen_ai.*` alignment.                    |
| **LangSmith `[otel]`**           | `langsmith[otel]`                                | LangSmith model                | Defaults to LangSmith cloud; override with `OTEL_EXPORTER_OTLP_ENDPOINT`. |
| **Custom callback handler**      | your code                                        | exactly what you emit          | Full control over names, attributes, cost, and content. This guide.   |

A practical rule: start with OpenLLMetry, move to the custom handler when you
need clean semconv names, correct model fields, custom retrieval attributes,
or content off by default. Watch the official SIG package and adopt it once it
is pip-installable and covers your needs.

## Related Conventions and Frameworks

Where this fits alongside neighbouring conventions and frameworks:

- **Tools as MCP.** The
  [Model Context Protocol](https://modelcontextprotocol.io) is a common tool
  layer, and agents increasingly expose tools as MCP servers. If your tools run
  in-process, the callback handler traces them as `execute_tool` spans. Once
  they sit behind an MCP server, OpenTelemetry's
  [MCP spans](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
  cover that hop instead.
- **Agent spans.** The `invoke_agent` and `execute_tool` spans follow the
  OpenTelemetry GenAI
  [agent and framework span conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai),
  which supersede the older generic chat-span definitions.
- **Agent to agent.** Multi-agent A2A messaging is out of scope here; the
  handler traces a single agent's run tree.
- **Other frameworks.** `create_agent` is one of several agent APIs (LangGraph,
  OpenAI Agents SDK, Google ADK, Claude Agent SDK, Pydantic AI, CrewAI). This
  guide uses it because it is the idiomatic LangChain 1.x agent and pairs with
  the [LangGraph guide](./langgraph.md).

## Scout Wiring

Route the SDK's OTLP output to a collector that forwards to base14 Scout. The
collector authenticates with `oauth2client` and applies the dual-key
environment on the way out.

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
      - key: deployment.environment
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

The dual-key environment is deliberate: the SDK resource sets
`deployment.environment.name` and the collector upserts both
`deployment.environment` and a lowercase `environment` with the same value,
because the Scout UI filters on `environment`.

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
      - OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
      - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
      # If your LLM runs on the host rather than in a container
      - OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
    extra_hosts:
      - "host.docker.internal:host-gateway"  # needed on Linux, not Docker Desktop
    depends_on:
      otel-collector:
        condition: service_started

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.153.0
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
# start the stack (collector picks up Scout creds from the environment)
docker compose up -d

# send an incident question
curl -s -X POST http://localhost:8000/api/v1/diagnose \
  -H 'Content-Type: application/json' \
  -d '{"question": "orders-service is returning 500s and the logs show
       connection pool exhausted. What is the likely cause?"}'
```

If you adopted the single-switch pattern from
[Configuration](#configuration), you can flip between the two paths without a
code change and compare the traces against the same workload:

```bash showLineNumbers title="Terminal"
INSTRUMENTATION_MODE=auto docker compose up -d --force-recreate app
```

## Troubleshooting

### Verify Telemetry Is Working

The collector's `debug` exporter prints spans as they arrive. Send a request,
then read the collector's log. If you run it under Docker Compose:

```bash showLineNumbers title="Terminal"
docker compose logs otel-collector --since=1m | grep -E "Name|gen_ai"
```

With the custom handler attached you should see `invoke_agent`, `chat`,
`execute_tool`, and `retrieval` spans. With auto-instrumentation you get the
OpenLLMetry names instead - `LangGraph.workflow`, `ChatOllama.chat`, and
`execute_task` nodes.

### Common Issues

| Symptom                                  | Cause and fix                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No GenAI spans, only HTTP and DB         | Neither path is active, or the handler was never passed to `invoke`. Pass it in `config={"callbacks": [...]}`. |
| Spans appear but mis-nested              | Parenting on the ambient context. Parent on the run tree via `parent_run_id`.                  |
| `gen_ai.request.model` is `unknown`      | Auto-instrumentation with Ollama. Use the custom handler, which reads `ls_model_name` from run metadata. |
| Every operation traced twice             | Auto-instrumentation and a custom handler are both active. Run exactly one.                     |
| Metrics missing, spans fine              | No `MeterProvider` installed. See [Telemetry Setup](#telemetry-setup).                           |
| Prompts show up unexpectedly             | Auto-instrumentation captures content by default. Set `TRACELOOP_TRACE_CONTENT=false`.          |
| No traces reach Scout                    | Check the collector `oauth2client` credentials and that the SDK points at the collector's OTLP port. |

## Security Considerations

- **Content is off by default** in the custom handler; keep it off in
  production unless you have a specific need, and scrub before recording.
- **Auto-instrumentation is the opposite** - set `TRACELOOP_TRACE_CONTENT=false`
  in any environment with sensitive prompts.
- **Scrub tool arguments and queries**, not just prompts. Incident text often
  carries IPs, hostnames, and tokens; the `scrub` helper handles the common
  cases and truncates.
- **Protect collector credentials** with environment variables or a secret
  store; never commit `SCOUT_CLIENT_SECRET`.

## Performance Considerations

- **The handler is cheap.** It stores a `run_id -> span` entry and sets
  attributes; the cost is dwarfed by the LLM call. Spans export in a
  background thread via `BatchSpanProcessor`.
- **Collapse graph node runs** if you do not need `model` / `tools` node
  spans - fewer spans per trace, lower export volume.
- **Sample in production.** Head or tail sampling on the collector keeps
  trace volume manageable while preserving errors and slow requests.
- **Batch exports** are already configured; tune `send_batch_size` and
  `timeout` for your throughput.

## FAQ

### How does LangChain OpenTelemetry tracing differ from LangSmith?

LangSmith gives deep LangChain-specific traces but sits apart from your HTTP,
database, and infrastructure telemetry. OpenTelemetry produces one trace
across every layer, so a slow `/diagnose` response links to the exact LLM
call, tool invocation, vector query, and SQL `INSERT` that caused it. It is
also vendor-neutral: the same spans flow to base14 Scout or any OTLP backend.

### Does a LangChain callback handler add latency?

No. Starting and ending a span takes microseconds; LLM calls take seconds.
The handler only stores a `run_id -> span` map and sets attributes, and spans
export in a background thread off the request path.

### Which LangChain versions does this guide support?

LangChain 1.3+ with `langchain-core` 1.4+, where the agent is built with
`create_agent` and is LangGraph-backed. The callback API has been stable
across the 1.x line.

### How do I trace tool calls in a LangChain agent?

Implement `on_tool_start` and `on_tool_end` in a callback handler and emit an
`execute_tool` span with `gen_ai.tool.name` and `gen_ai.tool.type`. The
zero-code OpenLLMetry library does this for you; the custom handler here shows
the exact mapping.

### How do I track LLM cost with LangChain and OpenTelemetry?

Read `usage_metadata` in `on_llm_end` for token counts, multiply by a
per-model price table, and record a `gen_ai.client.cost` counter alongside the
`gen_ai.client.token.usage` histogram. Attach `gen_ai.request.model` and
`gen_ai.provider.name` so you can group cost by model.

### Can I capture prompts and completions in LangChain traces?

Yes, but it is off by default. The custom handler captures PII-scrubbed
content only when `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
OpenLLMetry auto-instrumentation captures content by default and is controlled
by its own `TRACELOOP_TRACE_CONTENT`, so set `TRACELOOP_TRACE_CONTENT=false`
to disable it there.

### Should I use auto-instrumentation or a custom callback handler?

Start with OpenLLMetry for traces in minutes and no code changes. Move to a
custom handler when you need clean `gen_ai` span names, correct model and
finish-reason fields, custom retrieval attributes, or content off by default.
Both inject a LangChain callback handler.

### Why does that package come from Traceloop, not OpenTelemetry?

The PyPI name belongs to Traceloop's OpenLLMetry, not the official
OpenTelemetry GenAI SIG. That package is mature and exports to any OTLP
collector. The official SIG instrumentation is distributed from the
`opentelemetry-python-contrib` source tree and is the emerging `gen_ai`-native
standard to track.

### How do MCP tools fit, and are they traced?

This example uses in-process LangChain tools, which the callback handler
traces as `execute_tool` spans. When tools live behind a Model Context
Protocol server, the OpenTelemetry MCP span conventions capture that hop; that
is a separate integration and no MCP server runs here.

## What's Next?

### Related Guides

- [LangGraph Instrumentation](./langgraph.md) - Hand-built `StateGraph`
  agents with manual node and edge spans.
- [LlamaIndex Instrumentation](./llamaindex.md) - RAG-first framework tracing
  with the same GenAI conventions.
- [FastAPI Instrumentation](./fast-api.md) - The HTTP host that carries the
  agent endpoint.
- [Python Custom Instrumentation](../custom-instrumentation/python.md) -
  Manual spans and advanced patterns.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Alert on
  cost spikes, error rates, or slow diagnoses.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  token, cost, and latency dashboards from the GenAI metrics.

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OpenTelemetry Collector.

## References

- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [LangChain Documentation](https://python.langchain.com/)
- [OpenLLMetry (Traceloop)](https://github.com/traceloop/openllmetry)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
