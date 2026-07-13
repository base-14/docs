---
title:
  AI Agent Observability with OpenTelemetry - Tracing Multi-Agent Systems and
  Tool Calls
sidebar_label: AI Agent Observability
sidebar_position: 7
description:
  Instrument AI agents with OpenTelemetry GenAI semantic conventions. Trace the
  agent timeline, tool calls, and multi-agent handoffs with base14 Scout.
keywords:
  [
    ai agent observability,
    agent tracing opentelemetry,
    multi-agent observability,
    gen_ai conversation id,
    invoke_agent span,
    execute_tool span,
    agent tool call tracing,
    genai semantic conventions agents,
    agent timeline,
    llm agent monitoring,
    mcp observability,
    agent handoff tracing,
    opentelemetry agent spans,
    ai agent debugging,
    base14 scout,
  ]
---

# AI Agent Observability

Instrument AI agents with OpenTelemetry to trace the **whole conversation** -
model calls, tool invocations, agent handoffs, and the downstream API and
database work each decision triggers - in a single correlated view.

An agent is not a single LLM call. It is a loop: the model reasons, calls a
tool, reads the result, calls another agent, and eventually answers. When that
loop misbehaves - a tool times out, a sub-agent returns garbage, a retry storm
burns tokens - the LLM is rarely the root cause. The failure lives in the tool
call, the handoff, or the downstream service. To debug it you need telemetry
that spans the entire agent execution, not just the chat completion.

This guide is the framework-agnostic companion to the language-specific
[LLM Observability](./llm-observability.md) guides. It focuses on the **agent
layer**: the spans, attributes, and conventions that turn a scattered set of
LLM calls into a coherent agent timeline. Code samples use the OpenTelemetry
Python SDK, but every pattern is portable - the attribute names are the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/),
so the same telemetry works with any OpenTelemetry backend, including base14
Scout.

![AI agent observability dashboard in Scout](/img/docs/llm-o11y.png)

:::tip TL;DR

Bind every span an agent produces - LLM calls, tool calls, sub-agent handoffs,
and downstream HTTP and database work - with three attributes:
`gen_ai.conversation.id`, `gen_ai.agent.name`, and `gen_ai.operation.name`.
Emit `invoke_agent` spans for agent steps and `execute_tool` spans for tool
calls, and thread the conversation ID through the whole call stack. The result
is a single agent timeline in base14 Scout that shows exactly where an agent
run spent time and where it failed.

:::

## AI Agent Observability Overview

This guide shows you how to:

- Model an agent run as a conversation-level timeline, not isolated LLM calls
- Use the GenAI agent operation types (`invoke_agent`, `execute_tool`,
  `create_agent`, `chat`)
- Bind every span in a run with `gen_ai.conversation.id` and propagate it to
  downstream HTTP, database, and queue work
- Instrument tool calls with the `gen_ai.tool.*` attributes and proper error
  handling
- Trace Model Context Protocol (MCP) tool calls as `execute_tool` spans
- Trace multi-agent orchestration and handoffs so each agent gets its own
  swim lane
- Record agent metrics and evaluation results for cost, latency, and quality
- Handle content capture, PII, and the experimental semantic-convention opt-in

## Who This Guide Is For

This documentation is designed for:

- **AI engineers**: building tool-using or multi-agent systems and needing to
  see why a run was slow, expensive, or wrong
- **Backend developers**: embedding agents into existing services and wanting
  agent spans correlated with HTTP and database telemetry
- **Platform teams**: standardizing agent observability across frameworks
  (LangGraph, custom orchestration, MCP servers) on one open standard
- **DevOps and SRE**: operating agents in production with cost, error-rate, and
  quality alerting

## Prerequisites

This guide builds on the base OpenTelemetry setup covered elsewhere. Before
starting, ensure you have:

- A working OpenTelemetry SDK setup (tracer and meter providers, OTLP
  exporter). See [LLM Observability](./llm-observability.md) for the Python
  bootstrap, or the [Rust](./rust-llm-observability.md) and
  [Java](./spring-ai-llm-observability.md) guides for those stacks.
- **Scout Collector** configured and reachable from your application
  - See
    [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
    for local development
  - See
    [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
    for production
- Auto-instrumentation for your web framework and HTTP client, so downstream
  work joins the trace automatically. See
  [Auto-Instrumentation](../../instrument/apps/auto-instrumentation/index.md).
- Familiarity with GenAI spans for LLM calls (the `chat` operation). This guide
  extends that model to the agent and tool layers.

### Compatibility Matrix

| Component               | Minimum Version | Recommended |
| ----------------------- | --------------- | ----------- |
| opentelemetry-sdk       | 1.39.0          | 1.39+       |
| opentelemetry-api       | 1.39.0          | 1.39+       |
| GenAI semantic conv.    | 1.36 (baseline) | 1.37+       |
| Python (samples)        | 3.12            | 3.13+       |

## The Agent Timeline

The core idea of agent observability is that **a GenAI span is not just an LLM
call**. When an agent decides to call a tool, that tool might query a database,
hit a third-party API, or enqueue a background job. All of that work is part of
the same agent run and belongs in the same trace.

Three attributes bind an agent run together. Set them on **every** span the run
produces:

| Attribute               | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `gen_ai.conversation.id`| Shared ID linking all operations in a run     |
| `gen_ai.agent.name`     | Which agent produced the span                 |
| `gen_ai.operation.name` | What kind of operation the span represents    |

With those in place, a single agent run reads as one timeline:

```text showLineNumbers title="Agent timeline for one conversation"
POST /chat                                        6.1s  [auto: HTTP]
└─ invoke_agent orchestrator                      6.0s  [agent]
   ├─ chat claude-sonnet-4                          1.2s  [LLM: plan]
   ├─ execute_tool search_orders                    0.9s  [tool]
   │  └─ db.query SELECT orders                     18ms  [auto: DB]
   ├─ invoke_agent billing                          2.4s  [handoff]
   │  ├─ chat claude-sonnet-4                        1.1s  [LLM]
   │  └─ execute_tool issue_refund                   1.2s  [tool]
   │     └─ HTTP POST api.stripe.com                1.1s  [auto: httpx]
   └─ chat claude-sonnet-4                           1.3s  [LLM: final answer]
```

Every span above carries the same `gen_ai.conversation.id`. The
auto-instrumented `db.query` and `HTTP POST` spans join the trace because they
run inside the tool-call span's context - so a slow refund shows up as a slow
Stripe call under a specific tool under a specific agent, not as an
unattributed blip somewhere in the system.

## Agent Operation Types

The GenAI semantic conventions define `gen_ai.operation.name` values that
classify each span. Use them consistently - backends and dashboards group and
filter on this attribute.

| `gen_ai.operation.name` | Span represents                                  |
| ----------------------- | ------------------------------------------------ |
| `create_agent`          | Creating/registering an agent (e.g. Assistants)  |
| `invoke_agent`          | One agent taking a turn or being handed control  |
| `chat`                  | An LLM chat completion                           |
| `execute_tool`          | A tool or function call made by an agent         |
| `embeddings`            | Generating vector embeddings                     |
| `generate_content`      | A multimodal content-generation call             |

Most agent frameworks only need `invoke_agent`, `chat`, and `execute_tool`.
Use `create_agent` for remote agent services (OpenAI Assistants, AWS Bedrock
Agents) where agent creation is a distinct, observable step.

## Instrumenting the Agent Layer

Framework auto-instrumentation (LangChain callbacks, provider instrumentors)
usually owns the `chat` spans. You own the **agent-layer** and
**conversation-layer** attributes. A good division of labor:

> Let the framework instrumentation own the LLM-layer spans, and you own the
> agent-layer and conversation-layer attributes.

### The invoke_agent Span

Wrap each agent turn in an `invoke_agent` span that carries the three binding
attributes. This is the parent under which the agent's LLM and tool spans nest:

```python showLineNumbers title="agent.py - invoke_agent span"
from opentelemetry import trace

tracer = trace.get_tracer("gen_ai.agent")


async def run_agent(agent_name, state, conversation_id):
    """Run one agent turn under an invoke_agent span."""
    with tracer.start_as_current_span(
        f"invoke_agent {agent_name}"
    ) as span:
        # The three binding attributes
        span.set_attribute(
            "gen_ai.operation.name", "invoke_agent"
        )
        span.set_attribute("gen_ai.agent.name", agent_name)
        span.set_attribute(
            "gen_ai.conversation.id", conversation_id
        )

        # Optional agent metadata
        span.set_attribute("gen_ai.agent.id", state.agent_id)

        result = await agent_logic(state)

        span.set_attribute(
            "gen_ai.response.finish_reasons",
            [result.finish_reason],
        )
        return result
```

### Threading the Conversation ID

The conversation ID is only useful if it reaches **every** span, including
downstream HTTP clients, database queries, and queue workers. Because those
spans are auto-instrumented and created deep in library code, you cannot set
the attribute on them directly. Two portable options:

1. **Set it at the root and read it back.** Store the conversation ID on the
   first span of the run, and have your agent code re-read it and set it on each
   child span it creates.
2. **Propagate it as baggage.** OpenTelemetry
   [baggage](https://opentelemetry.io/docs/concepts/signals/baggage/) travels
   with the context across async boundaries and process hops. A span processor
   can then copy it onto every span, including auto-instrumented ones.

The baggage approach keeps the conversation ID flowing without threading it
through every function signature:

```python showLineNumbers title="conversation.py - baggage + span processor"
from opentelemetry import baggage, context
from opentelemetry.sdk.trace import SpanProcessor


def set_conversation(conversation_id):
    """Attach the conversation ID to the current context."""
    return context.attach(
        baggage.set_baggage(
            "gen_ai.conversation.id", conversation_id
        )
    )


class ConversationSpanProcessor(SpanProcessor):
    """Copy the conversation ID from baggage onto every span."""

    def on_start(self, span, parent_context=None):
        conversation_id = baggage.get_baggage(
            "gen_ai.conversation.id", parent_context
        )
        if conversation_id:
            span.set_attribute(
                "gen_ai.conversation.id", conversation_id
            )
```

Register `ConversationSpanProcessor` on the tracer provider alongside your
`BatchSpanProcessor`. Now the auto-instrumented `db.query` and `HTTP POST`
spans carry the conversation ID too, and the whole run stays linked.

> **Note**: Baggage is propagated over the wire via the `baggage` HTTP header.
> Do not put secrets or PII in baggage - treat the conversation ID as an opaque
> correlation key.

## Tool Call Observability

Tool calls are **where most agentic failures live**. A model that picks the
wrong tool, passes malformed arguments, or mishandles a tool error will fail
even when every `chat` span looks healthy. Instrument tool calls as
first-class `execute_tool` spans.

### The execute_tool Span

```python showLineNumbers title="tools.py - execute_tool span"
import json

from opentelemetry import trace

tracer = trace.get_tracer("gen_ai.tool")


async def call_tool(tool, arguments, call_id):
    """Run a tool under an execute_tool span."""
    with tracer.start_as_current_span(
        f"execute_tool {tool.name}"
    ) as span:
        span.set_attribute(
            "gen_ai.operation.name", "execute_tool"
        )
        span.set_attribute("gen_ai.tool.name", tool.name)
        span.set_attribute("gen_ai.tool.call.id", call_id)
        span.set_attribute(
            "gen_ai.tool.description", tool.description
        )

        # Arguments and result capture PII - see PII section
        span.set_attribute(
            "gen_ai.tool.call.arguments",
            json.dumps(arguments)[:2000],
        )

        try:
            result = await tool.run(**arguments)
        except Exception as e:
            span.record_exception(e)
            span.set_attribute("error.type", type(e).__name__)
            raise

        span.set_attribute(
            "gen_ai.tool.call.result",
            json.dumps(result)[:2000],
        )
        return result
```

### Tool Call Attribute Reference

| Attribute                     | Type   | Required    | Description               |
| ----------------------------- | ------ | ----------- | ------------------------- |
| `gen_ai.operation.name`       | string | Yes         | Always `"execute_tool"`   |
| `gen_ai.tool.name`            | string | Recommended | Tool/function name        |
| `gen_ai.tool.call.id`         | string | Recommended | Unique ID for this call   |
| `gen_ai.tool.description`     | string | Recommended | What the tool does        |
| `gen_ai.tool.type`            | string | Recommended | `function`, `extension`   |
| `gen_ai.tool.call.arguments`  | string | Opt-in      | JSON arguments (PII risk) |
| `gen_ai.tool.call.result`     | string | Opt-in      | JSON result (PII risk)    |
| `error.type`                  | string | Conditional | Exception class on failure|

Setting `error.type` and recording the exception is what lets base14 Scout
highlight the failing tool in the timeline and lets you query for the tools
that fail most often.

### MCP Tools

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is a
common way for agents to reach external tools. An MCP `tools/call` is just a
tool invocation, so model it as an `execute_tool` span with the same
`gen_ai.tool.*` attributes, adding MCP-specific context:

```python showLineNumbers title="mcp_tools.py - MCP call as execute_tool"
with tracer.start_as_current_span(
    f"execute_tool {tool_name}"
) as span:
    span.set_attribute("gen_ai.operation.name", "execute_tool")
    span.set_attribute("gen_ai.tool.name", tool_name)
    span.set_attribute("gen_ai.tool.type", "function")

    # MCP context
    span.set_attribute("mcp.server.name", server_name)
    span.set_attribute("mcp.method.name", "tools/call")

    result = await mcp_session.call_tool(tool_name, arguments)
```

Because the MCP client's transport is auto-instrumented, the underlying
HTTP or stdio call nests under this span automatically - so a slow or failing
MCP server is attributed to the exact tool the agent invoked. If you run your
own MCP server with Scout, see the
[Scout MCP guides](../../scout-mcp/setup.md) for setup and usage.

## Multi-Agent Orchestration

In a multi-agent system, one agent hands control to another: an orchestrator
calls a specialist, a planner delegates to a worker. Two rules keep these
handoffs readable in the timeline.

### Rule 1: The Caller Emits the Handoff Span

The **calling** agent emits the `invoke_agent` span for the agent it invokes -
not the agent being called. This makes orchestration explicit: the span sits
under the orchestrator, so the timeline shows who delegated to whom.

```python showLineNumbers title="orchestrator.py - handoff ownership"
async def orchestrator(state, conversation_id):
    with tracer.start_as_current_span(
        "invoke_agent orchestrator"
    ) as span:
        span.set_attribute(
            "gen_ai.operation.name", "invoke_agent"
        )
        span.set_attribute(
            "gen_ai.agent.name", "orchestrator"
        )
        span.set_attribute(
            "gen_ai.conversation.id", conversation_id
        )

        # The orchestrator emits the handoff span for "billing"
        with tracer.start_as_current_span(
            "invoke_agent billing"
        ) as handoff:
            handoff.set_attribute(
                "gen_ai.operation.name", "invoke_agent"
            )
            handoff.set_attribute(
                "gen_ai.agent.name", "billing"
            )
            handoff.set_attribute(
                "gen_ai.conversation.id", conversation_id
            )
            return await billing_agent(state)
```

The `billing` agent then emits its own `chat` and `execute_tool` spans under
its own `gen_ai.agent.name`, so its work appears in the billing swim lane.

### Rule 2: Every Agent Gets a Distinct Name

Give each agent - including sub-agents - a distinct `gen_ai.agent.name`. Spans
that omit it collapse into an `Unknown` swim lane, and you lose the ability to
tell which agent did what or attribute cost per agent. When you fan out to
parallel sub-agents, name each one.

## Agent Metrics

Agent runs need the same GenAI metrics as LLM calls, dimensioned by agent and
tool so you can answer "which agent is slowest?" and "which tool fails most?".
Reuse the metric definitions from the
[LLM Observability guide](./llm-observability.md#token-and-cost-tracking) and
add
agent/tool attributes when recording:

| Metric                             | Type      | Key attributes                     |
| ---------------------------------- | --------- | ---------------------------------- |
| `gen_ai.client.token.usage`        | Histogram | `gen_ai.agent.name`, model         |
| `gen_ai.client.operation.duration` | Histogram | `gen_ai.operation.name`, agent     |
| `gen_ai.client.cost`               | Counter   | `gen_ai.agent.name`, model         |
| `gen_ai.client.error.count`        | Counter   | `gen_ai.tool.name`, `error.type`   |

Recording `gen_ai.agent.name` on both spans and metrics lets you build
`sum(gen_ai.client.cost) by (gen_ai.agent.name)` to find your most expensive
agent, and `sum(gen_ai.client.error.count) by (gen_ai.tool.name)` to find your
flakiest tool.

## Evaluation and Quality

Agent quality - did it use the right tool, was the final answer correct, did it
hallucinate - is a first-class observability concern. Attach evaluation results
as `gen_ai.evaluation.result` events on the relevant span:

```python showLineNumbers title="eval.py - evaluation event"
span.add_event(
    "gen_ai.evaluation.result",
    attributes={
        "gen_ai.evaluation.name": "tool_selection",
        "gen_ai.evaluation.score.value": 1.0,
        "gen_ai.evaluation.score.label": "correct",
    },
)
```

Record the same score as a `gen_ai.evaluation.score` histogram to track quality
trends over time. See the
[evaluation section of the LLM Observability guide](./llm-observability.md#evaluation-and-quality-metrics)
for the metric definition and dashboard patterns.

## Content Capture, PII and Security

The richest agent-debugging attributes also carry the most sensitive data:

- `gen_ai.input.messages` / `gen_ai.output.messages` - full prompts and
  responses
- `gen_ai.system_instructions` - your system prompt
- `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` - tool inputs and
  outputs

These **capture PII and sensitive data by default when enabled**. Protect them:

- **Keep content capture off by default.** Enable it deliberately, and prefer
  non-production environments for full capture.
- **Redact at the application layer** before setting attributes, and truncate
  long payloads (2000 characters is a practical limit).
- **Redact at the collector** with the
  [`redaction`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/redactionprocessor)
  or `attributes` processor as a safety net, so sensitive fields never reach
  the backend.

### Enabling the Latest GenAI Conventions

The GenAI semantic conventions are still under active development. Newer
instrumentations gate the latest attribute shapes behind an environment
variable so existing pipelines do not break:

```bash showLineNumbers title="Terminal"
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

Set this when you want the current message and tool-call attribute formats.
Without it, instrumentations default to the transition baseline. Pin your
collector and backend expectations to the same convention version.

## Production Configuration

Agents send telemetry to a local OpenTelemetry Collector, which authenticates
to base14 Scout and forwards traces, metrics, and logs. Point your application
at the collector with `OTEL_EXPORTER_OTLP_ENDPOINT`, and configure the
collector to export to Scout:

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
  redaction:
    allow_all_keys: true
    blocked_values:
      - "[0-9]{16}" # credit card numbers
      - "[\\w.]+@[\\w.]+" # email addresses
  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048

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
  extensions: [health_check, zpages, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, redaction, batch]
      exporters: [otlphttp/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, redaction, batch]
      exporters: [otlphttp/b14, debug]
```

The `redaction` processor in the traces and logs pipelines strips sensitive
values from captured content before it leaves your environment. For the full
collector reference and deployment options, see
[OpenTelemetry Collector Setup](../../instrument/collector-setup/otel-collector-config.md).

## Troubleshooting

### Common Issues

#### Issue: Spans show an "Unknown" agent

A span is missing `gen_ai.agent.name`, so the backend cannot assign it to a
swim lane.

**Solutions:**

1. Set `gen_ai.agent.name` on every `invoke_agent`, `chat`, and `execute_tool`
   span the agent produces
2. For sub-agents, give each a distinct name - do not reuse the parent's
3. Verify the attribute is set before the span ends, not after

#### Issue: The conversation does not link end to end

LLM and tool spans appear, but downstream HTTP and database spans are not part
of the same conversation.

**Solutions:**

1. Confirm `gen_ai.conversation.id` is set on the root agent span
2. If using baggage, verify `ConversationSpanProcessor` is registered on the
   tracer provider and that baggage is attached to the active context
3. Ensure downstream calls run **inside** the agent span's context so they
   inherit the trace

#### Issue: Tool spans are missing

Tool calls do not appear as `execute_tool` spans.

**Solutions:**

1. Wrap tool execution explicitly - framework auto-instrumentation covers LLM
   calls but often not custom tools
2. Check that the tool wrapper runs inside the `invoke_agent` span's context
3. For MCP tools, ensure the transport (HTTP/stdio) instrumentation is enabled
   so the underlying call nests under the `execute_tool` span

## Performance Considerations

Agent instrumentation overhead is negligible next to model and tool latency. A
tool call or LLM completion takes hundreds of milliseconds to seconds; span
creation adds microseconds.

- **Span creation**: ~1-5 microseconds per span
- **Attribute setting**: ~0.5 microseconds per attribute
- **Baggage propagation**: negligible; a single small header
- **Content capture**: the main cost - large argument/result payloads inflate
  span size, so truncate and gate capture behind a flag

## FAQ

### What is the difference between LLM observability and agent observability?

LLM observability traces individual model calls - model, tokens, cost, latency.
Agent observability traces the **whole run**: the loop of LLM calls, tool
calls, and sub-agent handoffs, plus the downstream work each triggers, all
bound by a conversation ID. Agent failures usually live in the tool calls and
handoffs, not the model call - which is exactly what the agent layer makes
visible.

### Do I need an agent framework to get agent observability?

No. The conventions are framework-agnostic. Whether you use LangGraph, another
framework, or hand-rolled orchestration, you emit `invoke_agent` and
`execute_tool` spans with the GenAI attributes. Frameworks with OpenTelemetry
support give you some spans for free; you still own the conversation ID and
agent names.

### How do I trace multi-agent handoffs?

The calling agent emits the `invoke_agent` span for the agent it delegates to,
and every agent uses a distinct `gen_ai.agent.name`. This produces one swim
lane per agent and makes the delegation structure explicit in the timeline.

### Are MCP tool calls traced?

Yes. Model an MCP `tools/call` as an `execute_tool` span with the
`gen_ai.tool.*` attributes plus MCP context (`mcp.server.name`,
`mcp.method.name`). The auto-instrumented transport nests the underlying call
under that span.

### Can I see the arguments an agent passed to a tool?

Yes, via `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`. These
capture PII by default, so redact and truncate them, keep capture off in
production unless needed, and add a collector redaction processor as a backstop.

### How do I find the most expensive or slowest agent?

Record `gen_ai.agent.name` on both spans and metrics, then query
`sum(gen_ai.client.cost) by (gen_ai.agent.name)` for cost and
`histogram_quantile` over `gen_ai.client.operation.duration` grouped by agent
for latency.

## What's Next?

### Language-Specific Guides

- [LLM Observability (Python)](./llm-observability.md) - full Python setup with
  FastAPI, LangGraph, and multi-provider LLMs
- [Rust LLM Observability](./rust-llm-observability.md) - manual GenAI
  instrumentation in Rust
- [Java AI Observability](./spring-ai-llm-observability.md) - Spring AI with the
  three-layer instrumentation model

### Framework Guides

- [LangGraph Instrumentation](../../instrument/apps/auto-instrumentation/langgraph.md)
  \- node wrapping, conditional routing, tool-calling nodes
- [LlamaIndex Instrumentation](../../instrument/apps/auto-instrumentation/llamaindex.md)
  \- RAG, structured output, self-correction loops
- [Vercel AI SDK Instrumentation](../../instrument/apps/auto-instrumentation/vercel-ai-sdk.md)
  \- TypeScript multi-stage agent pipelines

### Scout Platform Features

- [Monitor AI agents in Scout](https://base14.io/scout/llm-observability) -
  track token usage, tool failures, and agent latency
- [Creating Alerts](../creating-alerts-with-logx.md) - alert on tool error
  rates, cost spikes, or evaluation regressions
- [Create Your First Dashboard](../create-your-first-dashboard.md) - build agent
  cost and reliability dashboards

## References

- [Instrumenting AI Agents with OpenTelemetry (Honeycomb)](https://www.honeycomb.io/blog/instrumenting-ai-agents-agent-timeline-opentelemetry-guide)
- [Inside the LLM Call: GenAI Observability with OpenTelemetry](https://opentelemetry.io/blog/2026/genai-observability/)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## Related Guides

- [LLM Observability][llm-o11y] - the Python end-to-end foundation this guide
  builds on
- [LangGraph Instrumentation][langgraph] - framework-specific agent tracing
- [Scout MCP Setup][scout-mcp] - run and observe an MCP server with Scout
- [OpenTelemetry Collector Setup][collector] - full collector configuration
- [Scout Exporter][scout-exporter] - configure base14 Scout authentication

[llm-o11y]: ./llm-observability.md
[langgraph]: ../../instrument/apps/auto-instrumentation/langgraph.md
[scout-mcp]: ../../scout-mcp/setup.md
[collector]: ../../instrument/collector-setup/otel-collector-config.md
[scout-exporter]: ../../instrument/collector-setup/scout-exporter.md
