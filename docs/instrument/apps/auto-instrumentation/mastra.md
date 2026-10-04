---
title:
  Mastra OpenTelemetry Instrumentation - Agent, Model and Tool Spans
sidebar_label: Mastra
sidebar_position: 7.97
description:
  Trace Mastra agents with OpenTelemetry through the OTel bridge. Agent,
  model and tool spans in your app's trace, your IDs, content capture and gaps.
keywords:
  [
    mastra opentelemetry instrumentation,
    mastra tracing,
    mastra observability,
    mastra otel bridge,
    mastra otel exporter,
    mastra agent monitoring,
    mastra ollama tracing,
    mastra agent as tool tracing,
    mastra structured output,
    mastra hideInput hideOutput,
    mastra tracingOptions metadata,
    mastra gen_ai spans,
    typescript agent observability,
    ai agent monitoring node.js,
    multi-agent tracing typescript,
    llm observability typescript,
  ]
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# Mastra

Mastra has its own tracing, and the `@mastra/otel-bridge` package turns it
into OpenTelemetry spans. With the bridge, Mastra creates its spans on the
OpenTelemetry SDK your service already runs, so an agent run becomes part of
the request's trace: an `invoke_agent` span for the run, a `chat` span for
each model call and an `execute_tool` span for each tool call.

The bridge follows the GenAI semantic conventions for span names and most
attributes. It does not emit metrics, and it records prompt and tool content
by default. This guide covers the setup and both of those.

The examples come from a service that runs a lead agent and researcher agents
on local Ollama models, so nothing here needs an API key.

:::tip TL;DR

Start the OpenTelemetry Node SDK before your app, then give `Mastra` an
`Observability` config with `bridge: new OtelBridge()`. Each run emits
`invoke_agent <agent>`, `agent_step`, `chat <model>` and
`execute_tool <tool>` spans under the active span. Pass a `threadId` in
`tracingOptions.metadata` to get `gen_ai.conversation.id` on every span, and
`hideInput` and `hideOutput` to keep prompts off them.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For the same agents on the Vercel AI SDK, see
> [Vercel AI SDK](./vercel-ai-sdk.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- TypeScript developers running Mastra agents who want their traces in an
  OpenTelemetry backend.
- Teams with a Node.js service already on OpenTelemetry who want Mastra's
  spans in the same trace as the HTTP request.
- Teams calling one agent from another's tool, who want one trace per request
  across both.

## Overview

- Bridge Mastra's tracing onto the OpenTelemetry SDK.
- Read the span tree of a run, including an agent called from a tool.
- Put a conversation ID and your own attributes on every Mastra span.
- Keep prompts, responses and tool content off spans.
- Add cost and a clean provider name in a span processor.
- Derive `gen_ai.client.*` metrics in the Collector, since Mastra emits none.

### Signals

| Signal | What Mastra emits through the bridge | What the [example](#complete-example) adds |
| --- | --- | --- |
| Traces | `invoke_agent`, `model_generation`, `agent_step`, `chat` and `execute_tool` spans with GenAI attributes, plus `model_chunk` and `processor_run` spans. | `gen_ai.conversation.id` and `base14.*` IDs on every Mastra span, cost on `chat` spans, a provider name of `ollama`. HTTP server and client spans from the Node.js auto-instrumentations. |
| Metrics | None. | Application histograms under `base14.plan.*`. `gen_ai.client.token.usage` and `gen_ai.client.operation.duration` derived from `chat` spans in the Collector. |
| Logs | Mastra's own log lines, when a logger provider is registered. | A logger provider, and pino records with the trace and span ID through the pino auto-instrumentation. |

## Prerequisites

- Node.js 22.13 or later. The example uses 26.
- A model provider with a model that can call tools. The Quick Start and the
  example use Ollama with `qwen3.5:9B`, which needs no API key.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- A base14 Scout account, optional. The example runs without one.

### Compatibility Matrix

| Component | Version in the example |
| --- | --- |
| `@mastra/core` | 1.74.0 |
| `@mastra/observability` | 1.18.3 |
| `@mastra/otel-bridge` | 1.5.13 |
| `@opentelemetry/sdk-node`, OTLP HTTP exporters | 0.222.0 |
| `@opentelemetry/api` | 1.9.1 |
| `ollama-ai-provider-v2` | 4.0.1 |
| `ai` | 7.0.127, for the tool definitions the example shares with its AI SDK agents |
| Node.js | 26 |
| Ollama | 0.34.2, with `qwen3.5:9B` and `gemma4:e2b` |
| OpenTelemetry Collector Contrib | 0.161.0 |
| Example | [`ai-learning-path-planner`](https://github.com/base-14/examples/tree/main/nodejs/ai-learning-path-planner) |

Last verified 2026-10-04 with `@mastra/core` 1.74.0 and `@mastra/otel-bridge`
1.5.13. Mastra documents the bridge as experimental, and the GenAI
conventions are in Development status, so span and attribute names can change
between releases. Pin the Mastra packages to exact versions and re-check the
spans after each upgrade.

The spans come from Mastra's agent loop, not from the model provider, so the
span tree is the same on every provider. Values the provider reports, such as
token counts, depend on the provider.

## Installation

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm" default>
```

```bash showLineNumbers title="Terminal"
npm install --save-exact @mastra/core@1.74.0 @mastra/observability@1.18.3 \
  @mastra/otel-bridge@1.5.13 ollama-ai-provider-v2@4.0.1 zod
npm install @opentelemetry/sdk-node @opentelemetry/sdk-trace-base \
  @opentelemetry/exporter-trace-otlp-http
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash showLineNumbers title="Terminal"
pnpm add --save-exact @mastra/core@1.74.0 @mastra/observability@1.18.3 \
  @mastra/otel-bridge@1.5.13 ollama-ai-provider-v2@4.0.1 zod
pnpm add @opentelemetry/sdk-node @opentelemetry/sdk-trace-base \
  @opentelemetry/exporter-trace-otlp-http
```

```mdx-code-block
</TabItem>
</Tabs>
```

Pull the model once:

```bash showLineNumbers title="Terminal"
ollama pull qwen3.5:9B
```

## Quick Start

This file is a minimal starting point, not part of the example. It starts the
OpenTelemetry SDK, bridges Mastra onto it and runs one agent with one tool on
Ollama. Any AI SDK provider works in place of `ollama-ai-provider-v2`. Save
it as `quickstart.ts`:

```typescript showLineNumbers title="quickstart.ts"
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { Observability } from "@mastra/observability";
import { OtelBridge } from "@mastra/otel-bridge";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createOllama } from "ollama-ai-provider-v2";
import { z } from "zod";

const sdk = new NodeSDK({
  serviceName: "mastra-quickstart",
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
});
sdk.start();

const orderStatus = createTool({
  id: "order_status",
  description: "Looks up the status of an order by its id.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({ orderId, status: "shipped" }),
});

const ollama = createOllama({ baseURL: "http://localhost:11434/api" });

const agent = new Agent({
  id: "support",
  name: "support",
  instructions: "Answer questions about orders. Use order_status to look an order up.",
  model: ollama("qwen3.5:9B"),
  tools: { order_status: orderStatus },
});

new Mastra({
  agents: { support: agent },
  observability: new Observability({
    configs: { default: { serviceName: "mastra-quickstart", bridge: new OtelBridge() } },
  }),
});

const result = await agent.generate("Where is order A-100?", {
  providerOptions: { ollama: { options: { num_ctx: 8192 } } },
  tracingOptions: { metadata: { threadId: "order-A-100" } },
});
console.log(result.text);

await sdk.shutdown();
```

Run it against a local Collector:

```bash showLineNumbers title="Terminal"
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export MASTRA_TELEMETRY_DISABLED=1
npx tsx quickstart.ts
```

One trace arrives under the service `mastra-quickstart`: `invoke_agent
support` at the root, two `chat qwen3.5:9B` spans and one
`execute_tool order_status` span. Every span carries
`gen_ai.conversation.id=order-A-100`. If no trace shows up, check the
endpoint and see [Troubleshooting](#troubleshooting).

`MASTRA_TELEMETRY_DISABLED=1` turns off the anonymous usage analytics Mastra
sends to its maintainers. It does not affect your OpenTelemetry export.

## Configuration

The bridge uses the tracer provider registered globally, so the OpenTelemetry
SDK has to start before Mastra creates a span. In a service, start it in a
file loaded with `node --import`, and keep the Mastra setup in the app.

```mdx-code-block
<Tabs>
<TabItem value="sdk" label="SDK bootstrap" default>
```

```typescript showLineNumbers title="telemetry.ts"
import { register } from "node:module";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Under ESM the HTTP server span is missing unless this hook is registered before anything
// imports node:http.
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "ai-learning-path-planner" }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
```

```mdx-code-block
</TabItem>
<TabItem value="mastra" label="Mastra instance">
```

```typescript showLineNumbers title="src/telemetry/mastra.ts"
import { Mastra } from "@mastra/core";
import { Observability } from "@mastra/observability";
import { OtelBridge } from "@mastra/otel-bridge";

let instance: Mastra | undefined;

export function mastraInstance(): Mastra {
  process.env.MASTRA_TELEMETRY_DISABLED ??= "1";
  instance ??= new Mastra({
    observability: new Observability({
      configs: {
        default: { serviceName: "ai-learning-path-planner", bridge: new OtelBridge() },
      },
    }),
  });
  return instance;
}
```

```mdx-code-block
</TabItem>
<TabItem value="run" label="Start command">
```

```json showLineNumbers title="package.json"
{
  "scripts": {
    "start": "node --import ./dist/telemetry.js dist/index.js"
  }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

The example's `src/telemetry.ts` has the same shape, with metric and log
exporters, its span processors and the AI SDK telemetry registration added.

An agent picks the bridge up from the `Mastra` instance it belongs to.
Register agents on the instance, as the Quick Start does, or pass the instance
to an agent built per request:

```typescript showLineNumbers title="src/agents/mastra.ts"
const mastra = mastraInstance();

const loop = new Agent({
  id: "lead",
  name: "lead",
  instructions: LEAD_INSTRUCTIONS,
  model,
  tools: pick(tools, activeToolsFor("lead", deps.config)),
  mastra,
});
```

Mastra also ships `@mastra/otel-exporter`, which exports Mastra's traces over
OTLP on its own, without an OpenTelemetry SDK in the process. Those traces do
not join your HTTP spans. This guide uses the bridge.

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=ai-learning-path-planner
MASTRA_TELEMETRY_DISABLED=1
```

## What Mastra Emits

One agent run, with one tool call, under the request's server span:

```text showLineNumbers
POST                                   SERVER    the HTTP request
└─ invoke_agent lead                   INTERNAL  the run
   └─ model_generation qwen3.5:9B      INTERNAL  the loop over model steps
      ├─ agent_step lead               INTERNAL  one per model step
      │  ├─ chat qwen3.5:9B            CLIENT    the model call
      │  │  └─ model_chunk lead        INTERNAL  one per part of the response
      │  ├─ execute_tool corpus_map    INTERNAL  one per tool call
      │  └─ processor_run ...          INTERNAL  Mastra's input processors
      └─ agent_step lead               INTERNAL
         └─ chat qwen3.5:9B            CLIENT
```

| Span | Key attributes |
| --- | --- |
| `invoke_agent <agent>` | `gen_ai.operation.name`, `gen_ai.agent.id`, `gen_ai.agent.name`, `gen_ai.tool.definitions`, `gen_ai.system_instructions` |
| `chat <model>` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`, `gen_ai.agent.name` |
| `execute_tool <tool>` | `gen_ai.operation.name`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.description`, `gen_ai.tool.type` |
| `agent_step <agent>` | `mastra.model_step.step_index`, `mastra.model_step.is_continued` |

Every span also carries `mastra.span.type` and `mastra.metadata.runId`. The
instrumentation scope is `@mastra/otel-bridge`. A span that completes has
status `Ok`.

When the model cannot be reached, the `invoke_agent` span has status `Error`
with the message as its description. It carries `error.type` and
`error.message` as attributes and an `exception` span event. The spans below
it keep status `Ok`.

Token usage is on the `chat` spans only. The `invoke_agent` span carries no
`gen_ai.usage.*` attributes, so a run's tokens are the sum over its `chat`
spans.

## Your IDs on Every Span

A `threadId` in `tracingOptions.metadata` becomes `gen_ai.conversation.id` on
every span of the run. Other metadata keys arrive under the
`mastra.metadata.` prefix:

```typescript showLineNumbers title="quickstart.ts"
const result = await agent.generate("Where is order A-100?", {
  tracingOptions: { metadata: { threadId: "order-A-100" } },
});
```

Mastra has no hook that runs at span creation, so to write an attribute under
a name of your own, use a span processor. The example carries its IDs in the
OpenTelemetry context and reads them back when a Mastra span starts:

```typescript showLineNumbers title="src/telemetry/plan-context.ts"
const PLAN_CONTEXT_KEY = createContextKey("base14.plan.runtime-context");

export function withPlanContext<T>(
  runtimeContext: PlanRuntimeContext | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (runtimeContext === undefined) {
    return run();
  }
  return context.with(context.active().setValue(PLAN_CONTEXT_KEY, runtimeContext), run);
}

export class MastraPlanSpanProcessor implements SpanProcessor {
  onStart(span: Span, parentContext: Context): void {
    if (span.instrumentationScope.name !== MASTRA_SCOPE) {
      return;
    }
    const attributes = planAttributes(
      parentContext.getValue(PLAN_CONTEXT_KEY) as PlanRuntimeContext | undefined,
    );
    if (attributes !== undefined) {
      span.setAttributes(attributes);
    }
  }
}
```

The agent call runs inside `withPlanContext`, and every Mastra span it
creates gets `base14.plan.id`, `base14.agent.role` and, from the same value
as the plan ID, `gen_ai.conversation.id`. Register the processor ahead of the
exporting one.

## Agents as Tools

When a tool's `execute` function runs another agent, that agent's
`invoke_agent` span sits under the tool span. The example's lead calls
`research_subtopic`, which runs a researcher agent on a smaller model:

```text showLineNumbers
invoke_agent lead
└─ model_generation qwen3.5:9B
   └─ agent_step lead
      └─ execute_tool research_subtopic
         ├─ invoke_agent researcher            gemma4:e2b
         │  └─ ... chat, execute_tool search_docs, execute_tool fetch_section
         └─ invoke_agent researcher-findings   the structured call
```

The researcher runs inside its own `withPlanContext`, so its spans carry
`base14.agent.role=researcher` and `base14.subtopic`, and the lead's carry
`base14.agent.role=lead`.

## Structured Output

`structuredOutput` returns a typed object in `result.object`:

```typescript showLineNumbers title="src/agents/mastra.ts"
const shaped = await shaper.generate(prompt, {
  structuredOutput: { schema: PlanSchema },
  providerOptions,
  tracingOptions,
});
return { output: shaped.object as Plan };
```

The example keeps the tool loop and the structured call as two agents. On
Ollama, a response format sent alongside tool definitions stops the model
calling tools, so the loop runs with tools and no schema, and a second agent
with no tools shapes the result. In a trace the two are separate
`invoke_agent` spans, `lead` and `lead-plan`.

## Content Capture and Redaction

Mastra records content on spans by default: the prompt and the response on
`invoke_agent`, `model_generation` and `agent_step`, output messages on
`chat`, arguments and results on `execute_tool`, the prompt on
`processor_run` and response text on `model_chunk`.

`hideInput` and `hideOutput` remove most of it for a run:

```typescript showLineNumbers title="src/agents/mastra.ts"
function tracingOptionsFor(config: Config) {
  return { hideInput: !config.captureMessageContent, hideOutput: !config.captureMessageContent };
}
```

With both set, `gen_ai.system_instructions` and `gen_ai.tool.definitions`
stay on `invoke_agent`, and `gen_ai.tool.description` stays on
`execute_tool`. The example removes the system instructions in the same span
processor, when the span ends:

```typescript showLineNumbers title="src/telemetry/plan-context.ts"
onEnd(span: ReadableSpan): void {
  if (this.captureMessageContent || span.instrumentationScope.name !== MASTRA_SCOPE) {
    return;
  }
  for (const key of Object.keys(span.attributes)) {
    if (CONTENT_ATTRIBUTES.includes(key) || CONTENT_ATTRIBUTE_PATTERN.test(key)) {
      delete span.attributes[key];
    }
  }
}
```

## Adding Cost and a Provider Name

Mastra sets `gen_ai.provider.name` to the AI SDK provider ID, which for
Ollama is `ollama.responses`. It sets no cost. The example fixes both in span
processors registered ahead of the exporter. Because usage is on `chat` spans
only, a run's cost is summed from those:

```typescript showLineNumbers title="src/telemetry/enrich.ts"
const fromMastra = span.instrumentationScope.name === MASTRA_SCOPE;
const carriesRunUsage = fromMastra
  ? operation === CHAT_OPERATION
  : operation === AGENT_OPERATION;
if (planId !== undefined && carriesRunUsage) {
  addRunCost(planId, cost.usd);
}
```

## Metrics

The bridge emits no metrics. The example gets the GenAI client metrics from
the `chat` spans in the Collector, with the `signal_to_metrics` connector, and
records its own histograms with the OpenTelemetry metrics API. The connector
recipe is on the [Vercel AI SDK](./vercel-ai-sdk.md) page and works unchanged,
because Mastra's `chat` spans carry the same attributes.

## Logs and Trace Correlation

Mastra's spans are ordinary OpenTelemetry spans in the active context, so a
log line written inside an agent run or a tool carries that span's trace and
span ID. The example logs with pino, and the pino auto-instrumentation
exports each record with those IDs.

## Known Gaps

As of `@mastra/core` 1.74.0 and `@mastra/otel-bridge` 1.5.13, verified
2026-10-04:

- **Content is on spans by default.** Prompts, responses, tool arguments and
  tool results are recorded unless a run passes `hideInput` and `hideOutput`.
  The system instructions stay even then. Workaround: pass both, and remove
  `gen_ai.system_instructions` in a span processor.
- **Only `threadId` maps to a convention attribute.** Other metadata keys
  arrive as `mastra.metadata.*`. Workaround: set attributes under your own
  names in a span processor, as in
  [Your IDs on Every Span](#your-ids-on-every-span).
- **No usage on `invoke_agent`.** A query that reads tokens off agent spans
  finds none. Sum `gen_ai.usage.*` over the run's `chat` spans.
- **Operation names outside the conventions.** `model_generation`,
  `agent_step`, `model_chunk` and `processor_run` spans carry those values in
  `gen_ai.operation.name`. Filter on `chat`, `invoke_agent` and
  `execute_tool` for the convention spans.
- **`model_chunk` and `processor_run` spans.** Each `chat` span has a
  `model_chunk` child per part of the response, and each step a
  `processor_run`. They carry no usage. Drop them in the Collector with a
  `filter` processor on `mastra.span.type` if you do not use them.
- **`gen_ai.provider.name` is the AI SDK provider ID.** `ollama.responses`,
  not `ollama`, so Scout lists these calls apart from other Ollama calls.
  Workaround: rewrite it in a span processor.
- **`error.type` is `unknown` on a failed model connection.** The reason is
  in `error.message` and the span's status description. Group failures by
  those.
- **No metrics.** Derive them from spans in the Collector.
- **No cost.** Compute it from the token counts.
- **Usage analytics are on by default.** Mastra reports anonymous usage to
  its maintainers unless `MASTRA_TELEMETRY_DISABLED=1` is set.

## What to Look For in Scout

### Follow one request across both agents

Search spans by `gen_ai.conversation.id`. The trace shows
`invoke_agent researcher` under `execute_tool research_subtopic`, with its own
`gen_ai.request.model`.

### Read tokens and cost by agent

Filter on `gen_ai.operation.name = chat` and group by `gen_ai.agent.name`.
Sum `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. In the
example, group by `base14.agent.role` to split the lead from the researchers.

### Find the slow step of a run

Open an `invoke_agent` span and sort its `agent_step` children by duration.
Each has a `chat` span and the `execute_tool` spans of that step, which
shows whether the model call or a tool took the time.

### Find failed runs and why

Filter spans on `gen_ai.operation.name = invoke_agent` and a status of
`Error`. The status description and `error.message` say why. In the example,
a run with Ollama stopped reads `Cannot connect to API`.

### Go from a log line to its trace

Filter logs on your message and open the trace from the record's trace ID.

## Production Patterns

- **Hide content in production.** Pass `hideInput` and `hideOutput` on every
  `generate` call, and strip `gen_ai.system_instructions` in a processor.
- **Pin the Mastra packages.** The bridge is experimental. Pin exact versions
  and re-check the span tree after an upgrade.
- **Drop the spans you do not read.** `model_chunk` and `processor_run`
  carry no usage and are leaves, so a Collector filter removes them without
  breaking the tree.
- **Send through a Collector.** The example exports OTLP HTTP to a Collector,
  which authenticates to Scout and derives the GenAI metrics.
- **Reset `prepareStep` overrides.** A `toolChoice` or system message
  returned from `prepareStep` stays in force on later steps. Return the
  normal values again once the condition clears, or a run that is required
  to call a tool never ends.
- **Set `MASTRA_TELEMETRY_DISABLED=1`** where outbound analytics are not
  allowed.
- **Flush on shutdown.** Call `sdk.shutdown()` on `SIGTERM` and `SIGINT`, or
  the last span batch is lost.

## Running Your Application

Run `quickstart.ts` as in [Quick Start](#quick-start). For the full example:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/nodejs/ai-learning-path-planner
cp .env.example .env
ollama pull qwen3.5:9B && ollama pull gemma4:e2b

PLANNER_FRAMEWORK=mastra docker compose up -d --build
curl -s -X POST http://localhost:3000/plans \
  -H 'content-type: application/json' \
  -d '{"topic":"PostgreSQL monitoring"}'

PLANNER_FRAMEWORK=mastra make verify
```

`make verify` drives one planned run and one declined run, then checks the
span tree, the attributes and the metrics in the Collector's output.

## Troubleshooting

### No Mastra spans

The bridge found no tracer provider. Start the OpenTelemetry SDK before the
app, with `node --import`, and give the agent a `Mastra` instance that has
the bridge configured.

### Mastra spans arrive as their own trace

The agent ran outside the request's context. Call `generate` from the request
handler, not from a detached timer or queue, or pass the context along.

### Prompts appear on spans

Content capture is on by default. Pass `hideInput` and `hideOutput` in
`tracingOptions`. See
[Content Capture and Redaction](#content-capture-and-redaction).

### No `gen_ai.client.*` metrics

Mastra emits none. Add the `signal_to_metrics` connector to the Collector.

### An agent keeps calling tools until `maxSteps`

A `prepareStep` that returned `toolChoice: "required"` is still in force.
Return `toolChoice: "auto"` on the steps where it should not apply.

### A warning about in-memory storage

Mastra prints `No storage configured` when the instance has no storage
adapter. It concerns Mastra's own state, not the OpenTelemetry export.

## FAQ

### Does Mastra support OpenTelemetry?

Yes. Mastra has its own tracing, and `@mastra/otel-bridge` creates
OpenTelemetry spans from it on the SDK your service runs. A second package,
`@mastra/otel-exporter`, exports Mastra's traces over OTLP on its own.

### Which spans does a Mastra agent run produce?

A run produces an `invoke_agent` span, a `model_generation` span, an
`agent_step` span per model step, a `chat` span per model call and an
`execute_tool` span per tool call. It also produces `model_chunk` and
`processor_run` spans.

### How do I see Mastra spans in the same trace as my HTTP request?

Use the bridge and call the agent from the request handler. The bridge
creates Mastra's spans under the active OpenTelemetry span, so the
`invoke_agent` span sits under the server span.

### How do I add a conversation ID to Mastra spans?

Pass it as `threadId` in `tracingOptions.metadata`. Mastra writes it as
`gen_ai.conversation.id` on every span of the run. Other metadata keys arrive
as `mastra.metadata.*` attributes.

### How do I keep prompts out of Mastra traces?

Pass `hideInput: true` and `hideOutput: true` in `tracingOptions` on each
`generate` call. Remove `gen_ai.system_instructions` in a span processor,
because those two options leave it in place.

### Does Mastra record token usage?

Yes, on `chat` spans, as `gen_ai.usage.input_tokens` and
`gen_ai.usage.output_tokens`. The `invoke_agent` span carries no usage.

### Does Mastra emit OpenTelemetry metrics?

No. The bridge emits spans only. Derive `gen_ai.client.token.usage` and
`gen_ai.client.operation.duration` from the `chat` spans in the Collector.

### Does Mastra record cost?

No. Compute it from the token counts on `chat` spans, in a span processor or
in the backend.

### Does this work with a local model?

Yes. The example runs on Ollama through `ollama-ai-provider-v2`, with no API
key. Set `num_ctx` in `providerOptions`, because Ollama's default context is
too small for an agent with tools.

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation IDs and tool calls.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token, cost and latency signals.
- [Vercel AI SDK](./vercel-ai-sdk.md) - the same example on AI SDK 7, and the
  Collector recipe for GenAI metrics.
- [Strands Agents](./strands-agents.md) - built-in GenAI spans from a Python
  framework.
- [Node.js](./nodejs.md) - the SDK and auto-instrumentations under the
  agents.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - alert on
  failed runs.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - chart
  tokens by agent and runs by outcome.

## Complete Example

`ai-learning-path-planner` turns a topic into a multi-week learning plan over
a documentation corpus. A lead agent breaks the topic into subtopics and
calls one researcher agent per subtopic. `PLANNER_FRAMEWORK=mastra` runs
those agents on Mastra; the default runs them on the Vercel AI SDK.

```text showLineNumbers
ai-learning-path-planner/
|-- scripts/
|   |-- test-api.sh              the API scenarios
|   `-- verify-scout.sh          checks a run's telemetry in the collector output
`-- src/
    |-- telemetry.ts             the OpenTelemetry SDK, loaded with --import
    |-- telemetry/mastra.ts      the Mastra instance and the bridge
    |-- telemetry/plan-context.ts  the context helper and the span processor
    |-- telemetry/enrich.ts      cost and provider name processors
    |-- agents/mastra.ts         the lead and researcher agents on Mastra
    |-- agents/lead.ts           the plan logic both frameworks share
    |-- tools/                   the nine corpus tools
    `-- routes/plans.ts          POST /plans, which picks the framework
```

Source:
[`nodejs/ai-learning-path-planner`](https://github.com/base-14/examples/tree/main/nodejs/ai-learning-path-planner).

## References

- [Mastra OtelBridge](https://mastra.ai/docs/observability/tracing/bridges/otel).
- [Mastra OtelExporter](https://mastra.ai/docs/observability/tracing/exporters/otel).
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/languages/js/).
