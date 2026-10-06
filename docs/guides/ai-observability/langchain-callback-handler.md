---
title:
  LangChain Callback Handler for OpenTelemetry - Writing Your Own GenAI Spans
sidebar_label: LangChain Callback Handler
sidebar_position: 12
description:
  Write a LangChain callback handler that maps the run tree onto OpenTelemetry
  GenAI spans, for chains the official instrumentation does not cover.
keywords:
  [
    langchain callback handler,
    langchain callback handler opentelemetry,
    BaseCallbackHandler opentelemetry,
    langchain run tree,
    parent_run_id span,
    langchain custom instrumentation,
    langchain gen_ai spans,
    on_chat_model_start,
    on_tool_start span,
    on_retriever_start span,
    langchain tracing python,
    genai semantic conventions,
    base14 scout,
  ]
---

# LangChain Callback Handler

Write your own LangChain callback handler to turn LangChain's run tree into
OpenTelemetry spans. Most applications do not need one: the official
[LangChain instrumentation](../../instrument/apps/auto-instrumentation/langchain.md),
`opentelemetry-instrumentation-genai-langchain`, is itself a callback handler
and covers `create_agent` agents, chat models, tools and retrievers. Write
your own when that package does not fit.

:::tip TL;DR

Subclass `BaseCallbackHandler`, keep a `run_id -> span` map, start a span on
each `*_start` event and end it on the matching `*_end` or `*_error`, and
parent every span on the span of its `parent_run_id`, never on the current
span. Pass the handler per request in `config={"callbacks": [...]}`.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## When to Write Your Own

- Your chains or runnables are ones the official package does not trace.
- You need attributes it does not set, and cannot add them in a span processor
  or exporter.
- Your LangChain version is outside the package's `>=0.3.21,<2`.
- You want span names or a tree shape the package does not produce, such as
  one span per LangGraph node.

Run one LangChain instrumentation per process. A handler of your own next to
the official package traces every operation twice.

## Who This Guide Is For

- **Engineers whose LangChain code the official package does not cover**, such
  as custom runnables or older LangChain releases.
- **Teams that need span names and attributes fixed by their own contract**,
  for dashboards and alerts that must not move with a package release.
- **Anyone porting the pattern** to another callback-based framework.

## Overview

- Map LangChain's run events onto spans.
- Parent spans on the run tree rather than the ambient context.
- Emit `invoke_agent`, `chat`, `execute_tool` and `retrieval` spans with GenAI
  attributes.
- End every span on failure as well as success.
- Attach the handler per request.

The code is the hand-written handler the
[`ai-runbook-assistant`](https://github.com/base-14/examples/tree/main/python/ai-runbook-assistant)
example used before it moved to the official package, at commit
[`e895ff2f`](https://github.com/base-14/examples/blob/e895ff2fcde68a9a038fcd76bbeda5efa5a75ded/python/ai-runbook-assistant/src/runbook_assistant/telemetry/callback.py).
The excerpts below are trimmed; the full file is at that link.

### Signals

| Signal | What LangChain emits | What the handler adds |
| --- | --- | --- |
| Traces | None. It reports run events to callback handlers. | `invoke_agent`, `chat {model}`, `execute_tool {name}` and `retrieval {source}` spans. |
| Metrics | None. | Whatever instruments the handler records into, such as `gen_ai.client.token.usage`. |
| Logs | None. | None. |

## Prerequisites

- Python 3.10 or later.
- LangChain with `langchain-core`. The callback API has been stable across the
  1.x line.
- The OpenTelemetry SDK and an exporter, set up before the first run. See
  [Python Custom Instrumentation](../../instrument/apps/custom-instrumentation/python.md).

### Compatibility Matrix

| Component | Version at commit `e895ff2f` |
| --- | --- |
| `langchain` | 1.3.18 |
| `langchain-core` | 1.6.1 |
| `opentelemetry-sdk`, `opentelemetry-api` | 1.45.0 |
| Python | 3.14 |

Last verified 2026-10-06: the handler at commit `e895ff2f` passed the
example's verify script against Ollama `qwen3.5:9B` with LangChain 1.3.18.
The GenAI conventions are in Development status, so the attribute names in
the handler can fall behind; compare them with the conventions when you
upgrade.

## How LangChain Reports Runs

A LangChain run is a tree. Every step, from the agent to each model call, tool
call and retrieval, has a `run_id`, and every child carries its parent's ID as
`parent_run_id`. LangChain reports each step's start and end to every
registered callback handler:

| LangChain event | Fires when |
| --- | --- |
| `on_chain_start` / `on_chain_end` | a chain or agent run begins and ends |
| `on_chat_model_start` / `on_llm_end` | a model call begins and returns |
| `on_tool_start` / `on_tool_end` | a tool runs |
| `on_retriever_start` / `on_retriever_end` | a retriever runs |
| `on_*_error` | any of the above raises |

Mapping that run tree onto a span tree is the whole job: start a span on each
`*_start`, end it on the matching `*_end` or `*_error`, and parent each span on
the span of its `parent_run_id`.

## The Handler

The handler keeps a `run_id -> span` map. `_parent_ctx` parents a new span on
the stored parent span, never on `trace.get_current_span()`, because LangChain
can fire callbacks on worker threads or across `await`.

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

A callback that arrives off the request thread sees the wrong current span, or
none. Resolve the parent from your own map through `parent_run_id`. Skipping
this is the most common cause of mis-nested LangChain traces.

:::

### The agent span

The root chain run, the one with no `parent_run_id`, becomes the
`invoke_agent` span. LangGraph's internal node runs, such as `model` and
`tools`, are collapsed: they reuse their parent's span, so their children nest
under the agent.

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
            parent = self._runs.get(parent_run_id)
            if parent is not None:
                self._runs[run_id] = _RunState(
                    parent.span, parent.start, owns_span=False
                )
```

### The chat span

`on_chat_model_start` opens a `chat {model}` CLIENT span. The model and
provider come from the run's metadata, `ls_model_name` and `ls_provider`,
which every LangChain provider integration fills in.

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

`on_llm_end` reads the token usage and finish reason off the result and ends
the span. The finish reason depends on the provider: Ollama reports
`done_reason`, others `stop_reason` or `finish_reason`, so read all three.

```python showLineNumbers title="src/runbook_assistant/telemetry/callback.py"
    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs) -> None:
        state = self._runs.get(run_id)
        if state is None:
            return
        span = state.span
        in_tok, out_tok, finish, resp_model = _usage_from_result(response)
        if resp_model:
            span.set_attribute("gen_ai.response.model", resp_model)
        if finish:
            span.set_attribute("gen_ai.response.finish_reasons", [finish])
        span.set_attribute("gen_ai.usage.input_tokens", in_tok)
        span.set_attribute("gen_ai.usage.output_tokens", out_tok)
        self._end(run_id)
```

### The tool span

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
```

### The retrieval span

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

Attributes the conventions do not define get an application prefix, here
`app.`, so they never collide with reserved `gen_ai.*` names.

## Errors

Every error event ends its span with error status and pops the run from the
map, so a failed run never leaks a span. A tool that fails while the agent
recovers marks the tool span failed and adds an event to the agent span,
which stays green because the request succeeded.

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

Keep the provider and model on your run state rather than reading them back
off the span. `attributes` exists on the SDK's span but not on the tracing
API, so code that reads it can fail on a non-recording span.

## Attaching the Handler

Pass a new handler per request, so each request can carry its own
conversation ID and no state crosses requests:

```python showLineNumbers title="src/runbook_assistant/agent.py"
def run_diagnosis(agent, question, callbacks=None) -> str:
    result = agent.invoke(
        {"messages": [{"role": "user", "content": question}]},
        config={"callbacks": callbacks or []},
    )
    messages = result.get("messages", [])
    return messages[-1].content if messages else ""
```

- **Per invocation**, as above: `config={"callbacks": [...]}` on each
  `invoke`. Best when per-request context matters.
- **Constructor**: `callbacks=[...]` when building the model or chain. The
  handler sees every call through that object.
- **Global**: add the handler to every callback manager at startup. The
  official instrumentation and OpenLLMetry both work this way.

## The Resulting Spans

```text
POST /api/v1/diagnose                 (FastAPI)
└─ invoke_agent runbook_assistant
   ├─ chat qwen3.5:9B                 (picks a tool)
   ├─ execute_tool search_runbooks
   │  └─ retrieval runbooks
   ├─ execute_tool query_metrics
   └─ chat qwen3.5:9B                 (writes the answer)
```

## Known Gaps

Limits of the callback approach in LangChain 1.3.18:

- **No embeddings callback.** LangChain reports no event for embedding calls.
  Wrap the embedding client and open the span yourself.
- **A chat model that wraps another fires callbacks for both.** A retry or
  fallback wrapper built as a chat model needs to run its inner model with an
  empty callback list, or every call gives two `chat` spans.
- **LangGraph reports a chain run per internal node.** Collapse them, as
  above, or the tree fills with graph plumbing.
- **You maintain the mapping.** New LangChain events and new GenAI attributes
  reach your traces only when you add them.

## What to Look For in Scout

### Check that spans nest under the agent

Open a request's trace. Every `chat`, `execute_tool` and `retrieval` span sits
under `invoke_agent`. A span directly under the HTTP span was parented on the
ambient context instead of the run tree.

### Find runs that never ended

A request with a server span and no `invoke_agent` span, or an agent span
with no children, points to a handler that missed an error event. Check that
every `on_*_error` path ends its span.

### Compare against the official package

Run the official instrumentation on the same request in a test environment
and compare the two trees. Attributes it sets that yours does not are the
ones to add.

## Production Patterns

- **Keep content capture off by default** and scrub what you capture, tool
  arguments included.
- **Run one LangChain instrumentation per process.**
- **Test the handler with an in-memory span exporter**, so a refactor that
  drops an attribute fails CI.
- **Pin LangChain** and re-check the spans after each upgrade.

## FAQ

### Do I need a custom LangChain callback handler for OpenTelemetry?

Usually not. The official `opentelemetry-instrumentation-genai-langchain`
package is a callback handler and traces agents, chat models, tools and
retrievers. Write your own only for chains or attributes it does not cover.

### Why parent LangChain spans on parent_run_id instead of the current span?

Because LangChain can fire callbacks on worker threads and across `await`,
where the current span is wrong or missing. The run tree's `parent_run_id` is
always right.

### Can I run my own handler and the official LangChain instrumentation together?

Not on the same runs. Both trace every operation, so each step appears twice.
Pick one per process.

### How do I add a conversation ID to a LangChain callback handler?

Build the handler per request with the ID and set `gen_ai.conversation.id` on
the root span, as `on_chain_start` does above.

## What's Next?

### Related Guides

- [LangChain Instrumentation](../../instrument/apps/auto-instrumentation/langchain.md)
  \- The official package, with cost and scrubbing added in a span exporter.
- [AI Agent Observability](./agent-observability.md) - Agent and tool tracing
  across frameworks.
- [Python Custom Instrumentation](../../instrument/apps/custom-instrumentation/python.md)
  \- Manual spans and metrics in Python.

### Scout Platform Features

- [Creating Alerts](../creating-alerts-with-logx.md) - Alert on error rates
  and slow agent runs.
- [Dashboard Creation](../create-your-first-dashboard.md) - Build token and
  latency dashboards.

## References

- [LangChain callbacks](https://python.langchain.com/docs/concepts/callbacks/)
- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
- [OpenTelemetry GenAI instrumentation for Python](https://github.com/open-telemetry/opentelemetry-python-genai)
