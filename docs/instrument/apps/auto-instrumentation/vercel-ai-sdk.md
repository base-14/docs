---
title:
  Vercel AI SDK OpenTelemetry Instrumentation - AI SDK 7 Agents and v6
sidebar_label: Vercel AI SDK
sidebar_position: 8
description:
  Trace Vercel AI SDK 7 agents with @ai-sdk/otel, add run ids, per-run cost and
  subagent fan-out metrics, and instrument AI SDK v6 with semconv middleware.
keywords:
  [
    vercel ai sdk opentelemetry,
    ai sdk 7 telemetry,
    ai-sdk otel,
    registerTelemetry ai sdk,
    ToolLoopAgent tracing,
    vercel ai sdk agent observability,
    subagent fan-out tracing,
    llm cost per run,
    ai sdk enrichSpan,
    genai semantic conventions typescript,
    vercel ai sdk metrics,
    llm token tracking typescript,
    ai sdk v6 middleware opentelemetry,
    LanguageModelV3Middleware,
    opentelemetry nodejs ai,
    ollama opentelemetry,
  ]
---

# Vercel AI SDK

AI SDK 7 emits OpenTelemetry spans through `@ai-sdk/otel`. You register it,
then add what it cannot know: the run a span belongs to, the run's cost and the
agent's fan-out. AI SDK v6 has no `@ai-sdk/otel` and is covered in
[AI SDK v6: Semconv Middleware](#ai-sdk-v6-semconv-middleware).

The example is a Node.js service. A lead agent splits a topic into subtopics
and runs one researcher subagent per subtopic, on local Ollama models.

:::tip TL;DR

Install `@ai-sdk/otel`, start the OpenTelemetry `NodeSDK` from a module loaded
with `node --import`, and call `registerTelemetry(new OpenTelemetry())`. Each
agent run then produces `invoke_agent`, `step`, `chat` and `execute_tool`
spans. Use `enrichSpan` to add a run id, and a span processor to add cost.

:::

> **Note:** For framework-agnostic agent patterns, see
> [AI Agent Observability](../../../guides/ai-observability/agent-observability.md).
> For Python, see [LangGraph](./langgraph.md) and
> [LlamaIndex](./llamaindex.md).

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Who This Guide Is For

- Node.js developers running agents on the Vercel AI SDK.
- Teams with a lead agent and subagents who want the fan-out in one trace.
- Teams on AI SDK v6 who instrument model calls with middleware.

## Overview

- Register `@ai-sdk/otel` with the OpenTelemetry Node SDK.
- Read the span tree of an agent run.
- Add a run id, agent role and subtopic to every AI SDK span.
- Nest subagent spans under the tool call that started them.
- Compute cost per span and per run, including simulated cost.
- Record run-level metrics with suitable bucket boundaries.
- Measure the token cost of tool definitions.
- Instrument AI SDK v6 with a `LanguageModelV3Middleware`.

## Prerequisites

- Node.js 26 for the v7 example. Bun 1.3 for the v6 example.
- Ollama with the example's models pulled. No provider API key is needed.
- An OpenTelemetry Collector. See
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md).
- For the v6 example, Postgres with pgvector. Its Compose file starts one.
- A base14 Scout account, optional. Both examples run without one.

### Compatibility Matrix

| Component | AI SDK 7 example | AI SDK v6 example |
| --- | --- | --- |
| `ai` | 7.0.111 | 6.0.288 |
| Telemetry | `@ai-sdk/otel` 1.0.111 | Hand-written `LanguageModelV3Middleware` |
| Runtime | Node.js 26 | Bun 1.3.9 |
| Hono | 4.13.8 | 4.13.8 |
| `@opentelemetry/sdk-node` | 0.222.0 | 0.222.0 |
| `@opentelemetry/auto-instrumentations-node` | 0.80.0 | Not used |
| Provider | Ollama, `ollama-ai-provider-v2` 4.0.1 | Ollama by default, Anthropic, Google or OpenAI optional |
| OTel Collector contrib | 0.161.0 | 0.161.0 |
| Example | [`ai-learning-path-planner`](https://github.com/base-14/examples/tree/main/nodejs/ai-learning-path-planner) | [`ai-contract-analyzer`](https://github.com/base-14/examples/tree/main/nodejs/ai-contract-analyzer) |

## Installation

```bash showLineNumbers title="Terminal"
npm install \
  ai @ai-sdk/otel ollama-ai-provider-v2 \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http
```

Replace `ollama-ai-provider-v2` with your provider package. Pin exact versions.

## Configuration

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="module" label="Telemetry Module" default>
```

Load this module with `node --import` so it runs before the application code:

```typescript showLineNumbers title="src/telemetry.ts"
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { OpenTelemetry } from "@ai-sdk/otel";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK, metrics as sdkMetrics } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { registerTelemetry } from "ai";
import { loadConfig } from "./config.js";
import { assertPriceModelIsKnown } from "./llm/cost.js";
import { enrichSpan, PlanCostSpanProcessor } from "./telemetry/enrich.js";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

const config = loadConfig();

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

assertPriceModelIsKnown(config);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "ai-learning-path-planner",
    [ATTR_SERVICE_VERSION]: version,
  }),
  spanProcessors: [
    new PlanCostSpanProcessor(config),
    new BatchSpanProcessor(new OTLPTraceExporter()),
  ],
  metricReader: new sdkMetrics.PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

registerTelemetry(
  new OpenTelemetry({
    enrichSpan,
    usage: true,
  }),
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
```

- **Loader hook.** Under ESM, register the `@opentelemetry/instrumentation`
  hook before anything imports `node:http`. Without it the HTTP server span is
  missing, while the agent spans still appear.
- **`registerTelemetry`.** Sets `@ai-sdk/otel` as the AI SDK's telemetry
  integration. It uses the global tracer the `NodeSDK` registers.
- **`usage: true`.** Adds AI SDK usage details that the `gen_ai.usage.*`
  attributes do not cover.
- **Processor order.** `PlanCostSpanProcessor` goes before the exporting
  processor, so the cost it writes in `onEnd` is exported.
- **Both signals.** Handling `SIGINT` flushes the last batch when you stop the
  process with Ctrl-C.

```mdx-code-block
</TabItem>
<TabItem value="agent" label="Agent Telemetry Options">
```

Each agent has its own telemetry settings:

```typescript showLineNumbers title="src/agents/researcher.ts"
const telemetry = {
  includeRuntimeContext: PLAN_RUNTIME_CONTEXT_KEYS,
  recordInputs: deps.config.captureMessageContent,
  recordOutputs: deps.config.captureMessageContent,
};

const loop = new ToolLoopAgent({
  id: `researcher-${deps.subtopic}`,
  model,
  instructions: RESEARCHER_INSTRUCTIONS,
  tools,
  activeTools: activeToolsFor("researcher", deps.config) as ActiveTools<typeof tools>,
  stopWhen: isStepCount(6),
  providerOptions,
  runtimeContext,
  telemetry: { functionId: "researcher", ...telemetry },
});
```

- **`functionId`** becomes `gen_ai.agent.name`. The example uses `lead`,
  `lead-plan`, `researcher` and `researcher-findings`.
- **`includeRuntimeContext`** lists the runtime context keys telemetry can
  read. Unlisted keys never reach `enrichSpan`.
- **`recordInputs` and `recordOutputs`** turn on prompt and completion capture.
  The example sets both from `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`,
  which defaults to `false`.

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

```bash showLineNumbers title=".env.example (excerpt)"
OLLAMA_NUM_CTX=16384
MODEL_SMALL=gemma4:e2b
MODEL_LARGE=qwen3.5:9B
PRICE_MODEL=
TOOL_CATALOGUE=deferred
MAX_SUBTOPICS=8
MAX_ESCALATIONS=2
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
SCOUT_ENDPOINT=
SCOUT_CLIENT_ID=
SCOUT_CLIENT_SECRET=
SCOUT_TOKEN_URL=
SCOUT_ENVIRONMENT=development
```

The `SCOUT_*` variables are read by the collector. A host run needs no OTLP
settings, because the SDK defaults to `http://localhost:4318`. Compose sets
`OTEL_EXPORTER_OTLP_ENDPOINT` to the collector's service name.

```mdx-code-block
</TabItem>
</Tabs>
```

## What AI SDK 7 Emits

One planned run, as the collector receives it:

```text showLineNumbers title="One POST /plans request, one trace"
POST                                              server span, url.path=/plans
|-- invoke_agent qwen3.5:9B                       the lead's tool loop
|   |-- step 1
|   |   |-- chat qwen3.5:9B
|   |   `-- execute_tool corpus_map
|   |-- step 2
|   |   |-- chat qwen3.5:9B
|   |   `-- execute_tool research_subtopic
|   |       |-- invoke_agent gemma4:e2b           one researcher, one subtopic
|   |       |   `-- step 1
|   |       |       |-- chat gemma4:e2b
|   |       |       `-- execute_tool search_docs
|   |       `-- invoke_agent gemma4:e2b           the researcher's shaping call
|   |           `-- step 1
|   |               `-- chat gemma4:e2b
|   `-- step 3
|       `-- chat qwen3.5:9B
`-- invoke_agent qwen3.5:9B                       the lead's shaping call
    `-- step 1
        `-- chat qwen3.5:9B
```

| Span | One per |
| --- | --- |
| `invoke_agent <model id>` | Agent call. |
| `step <n>` | Step of the tool loop. |
| `chat <model id>` | Model call. |
| `execute_tool <tool name>` | Tool call. |

Each `chat` span also has a child HTTP client span, `POST`, for the provider
call.
The HTTP server span is named for the method only, because there is no route
to name it from. Use `url.path` for the path.

Attributes on the AI SDK spans:

| Attribute | Value |
| --- | --- |
| `gen_ai.operation.name` | `invoke_agent`, `chat` or `execute_tool`. |
| `gen_ai.agent.name` | The agent's `functionId`. |
| `gen_ai.request.model` | The requested model id. |
| `gen_ai.response.model` | The model id the provider returned. |
| `gen_ai.usage.input_tokens` | Input tokens. |
| `gen_ai.usage.output_tokens` | Output tokens. |

`@ai-sdk/otel` emits spans only. The metrics in this guide come from the
application.

Each agent has two `invoke_agent` spans: the tool loop and a separate
structured-output call. They are separate because the local model stops
calling tools when a response format is sent with the tool definitions.

## Enriching Spans with Runtime Context

`enrichSpan` runs when an AI SDK span starts and returns attributes to add. It
only receives the agent's runtime context, so put what you need there:

```typescript showLineNumbers title="src/telemetry/enrich.ts"
export interface PlanRuntimeContext extends Record<string, unknown> {
  planId: string;
  agentRole: "lead" | "researcher";
  toolCatalogue: "deferred" | "full";
  subtopic?: string;
}

export const PLAN_RUNTIME_CONTEXT_KEYS = {
  planId: true,
  agentRole: true,
  toolCatalogue: true,
  subtopic: true,
} as const;

export const enrichSpan: EnrichSpan = ({ runtimeContext }) => {
  if (runtimeContext === undefined) {
    return undefined;
  }

  const attributes: Attributes = {};
  const { planId, agentRole, toolCatalogue, subtopic } = runtimeContext;

  if (typeof planId === "string") attributes["base14.plan.id"] = planId;
  if (typeof agentRole === "string") attributes["base14.agent.role"] = agentRole;
  if (typeof toolCatalogue === "string") attributes["base14.tool.catalogue"] = toolCatalogue;
  if (typeof subtopic === "string") attributes["base14.subtopic"] = subtopic;

  return attributes;
};
```

The route handler creates the plan id and passes it into each agent's runtime
context. Researchers are built per subtopic, so theirs also carries the
subtopic.

| Attribute | On |
| --- | --- |
| `base14.plan.id` | Every AI SDK span in the run. |
| `base14.agent.role` | `lead` or `researcher`. |
| `base14.subtopic` | Researcher spans. |
| `base14.tool.catalogue` | `deferred` or `full`. |

HTTP spans come from the Node auto-instrumentations, not the AI SDK, so they
have no `base14.*` attributes. Filtering on `base14.plan.id` misses the root
span. Filter on the trace id to get the whole trace.

Use your own prefix for application attributes. `gen_ai.` belongs to the
semantic conventions.

## Tracing Subagents

The lead calls the `research_subtopic` tool, and the tool's `execute` builds
and runs a researcher. The researcher's `invoke_agent` span is therefore a
child of `execute_tool research_subtopic`. No extra code is needed.

The tool also applies the caps:

- **`MAX_SUBTOPICS`.** A subtopic past the cap returns a gap and starts no
  researcher.
- **`MAX_ESCALATIONS`.** A low-confidence subtopic past the cap returns a gap
  with the small model's findings, instead of retrying on the large model.

The run-level metrics report the same counters the caps use.

Researchers started in parallel have overlapping spans. On one Ollama instance
their model calls run one at a time, so the trace shows the fan-out cost, not a
speedup.

## Per-Run Cost

Token counts do not exist when a span starts, so cost cannot come from
`enrichSpan`. A span processor adds it when the span ends:

```typescript showLineNumbers title="src/telemetry/enrich.ts"
export class PlanCostSpanProcessor implements SpanProcessor {
  constructor(private readonly config: Config) {}

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes;
    const inputTokens = numberAttribute(attributes, "gen_ai.usage.input_tokens");
    const outputTokens = numberAttribute(attributes, "gen_ai.usage.output_tokens");
    if (inputTokens === undefined && outputTokens === undefined) {
      return;
    }

    const modelId =
      stringAttribute(attributes, "gen_ai.response.model") ??
      stringAttribute(attributes, "gen_ai.request.model");
    if (modelId === undefined) {
      return;
    }

    const usage = usageFrom(
      inputTokens ?? 0,
      outputTokens ?? 0,
      numberAttribute(attributes, "gen_ai.usage.cache_read.input_tokens") ?? 0,
    );

    let cost: { usd: number; simulated: boolean };
    try {
      cost = costOf(usage, modelId, this.config);
    } catch {
      return;
    }

    attributes["base14.gen_ai.cost"] = cost.usd;
    attributes["base14.gen_ai.cost.simulated"] = cost.simulated;

    const planId = stringAttribute(attributes, "base14.plan.id");
    if (planId !== undefined && attributes["gen_ai.operation.name"] === "invoke_agent") {
      addRunCost(planId, cost.usd);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
```

- **Cost on spans.** `base14.gen_ai.cost` and `base14.gen_ai.cost.simulated`
  are set on every `chat` and `invoke_agent` span.
- **Run total from `invoke_agent` only.** `chat` spans have token counts too.
  Adding both counts every model call twice.
- **Bounded totals.** Totals are kept per plan id, up to 1024 runs, and the
  least recently updated run is evicted first. Evicting by insertion order can
  drop a run that is still in progress.
- **No exceptions in `onEnd`.** An error there is hard to trace back to a
  request. The example checks the price configuration at startup and catches
  anything else.

When the run ends, the route handler reads its total and records it on
`base14.plan.cost`.

### Simulated Cost for Local Models

Local models have no price. The example looks up `_shared/pricing.json`:

- The model has a price row. That rate is used, `simulated: false`.
- No row and no `PRICE_MODEL`. Cost is zero, `simulated: true`.
- No row and `PRICE_MODEL` names a row. That rate is used, `simulated: true`.

With Ollama, an unset `PRICE_MODEL` defaults to `gpt-5-nano`. A `PRICE_MODEL`
that names no row stops the service at startup. Check
`base14.gen_ai.cost.simulated` before reading a cost as a real bill.

## Run-Level Metrics

Six instruments are recorded once per run, whether it is planned, declined or
failed. Recording only successful runs would hide declines and outages.

| Instrument | Type | Attributes |
| --- | --- | --- |
| `base14.plan.cost` | Histogram, USD | `catalogue`, `fanout_bucket`, `outcome` |
| `base14.plan.fanout` | Histogram, subtopics | `outcome` |
| `base14.plan.duration` | Histogram, seconds | `outcome` |
| `base14.plan.gap.count` | Counter | `reason` |
| `base14.plan.escalation.count` | Counter | `trigger` |
| `base14.gen_ai.tool_definition.tokens` | Histogram, tokens | `role`, `catalogue` |

The SDK's default histogram boundaries go from 0 to 5 in one step, so most
costs and durations land in one bucket. Set your own with `advice`:

```typescript showLineNumbers title="src/telemetry/metrics.ts"
export const COST_BOUNDARIES_USD = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
export const DURATION_BOUNDARIES_SECONDS = [0.1, 1, 10, 30, 60, 90, 120, 150, 180, 240, 300];
export const FANOUT_BOUNDARIES = [0, 1, 2, 3, 4, 5, 6, 8];

planCost: meter.createHistogram("base14.plan.cost", {
  unit: "USD",
  description: "Cost of one plan run, summed over the lead and every researcher.",
  advice: { explicitBucketBoundaries: COST_BOUNDARIES_USD },
}),
```

- **Create instruments lazily.** Instruments created at import time can bind to
  the no-op meter provider. The example gets the meter on first use and
  rebuilds the instruments if it changes.
- **Use fixed tag values.** Gap reasons are free text, some with numbers or
  paths. The example maps each to a fixed tag, such as `no_research` or
  `model_reported`.

## Tool Definition Cost

Tool definitions are sent with every model call, so every tool an agent can
see costs input tokens on every step.

`base14.gen_ai.tool_definition.tokens` records an estimate per role and
catalogue. No tokenizer is available for the local model, so the estimate is
the character count of the tool definitions divided by four, without the
`$schema` URL. State the divisor when you quote the number.

`TOOL_CATALOGUE=deferred` gives each agent only its own tools.
`TOOL_CATALOGUE=full` gives both agents all nine. `make measure` runs the same
request both ways:

| | Deferred | Full | Difference |
| --- | --- | --- | --- |
| First model call, input tokens | 705 | 1080 | +375 |
| Tool definition estimate, lead | 290 | 650 | +360 |
| Tool definition estimate, researcher | 361 | 650 | +289 |

Compare first calls. Whole-run totals depend on how many steps the model
takes.

## Production Configuration

### OpenTelemetry Collector

The collector configuration is split into two files. The local file always
loads and exports to `debug`. The Scout file adds the Scout exporter and loads
only when credentials are set:

```yaml showLineNumbers title="compose.yaml (collector service)"
otel-collector:
  image: otel/opentelemetry-collector-contrib:0.161.0
  command: --config=/etc/otel-collector.yaml ${SCOUT_CLIENT_ID:+--config=/etc/otel-collector-scout.yaml}
  volumes:
    - ./config/otel-collector.yaml:/etc/otel-collector.yaml:ro
    - ./config/otel-collector-scout.yaml:/etc/otel-collector-scout.yaml:ro
```

`${SCOUT_CLIENT_ID:+...}` is empty when the variable is empty. With both files,
the collector merges maps and replaces lists, so each pipeline keeps its
receivers and processors and gets the Scout exporter.

```yaml showLineNumbers title="config/otel-collector-scout.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s

exporters:
  otlp_http/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      exporters: [otlp_http/b14, debug]
    metrics:
      exporters: [otlp_http/b14, debug]
    logs:
      exporters: [otlp_http/b14, debug]
```

Leave unused `SCOUT_*` values empty. Placeholder values pass validation, so the
collector starts and then fails every export.

The local file drops health checks by `url.path`, because the server span name
has no route:

```yaml showLineNumbers title="config/otel-collector.yaml"
filter/noisy:
  error_mode: ignore
  traces:
    span:
      - 'attributes["url.path"] == "/health"'
      - 'attributes["url.path"] == "/alive"'
```

### Docker Compose

```yaml showLineNumbers title="compose.yaml (app service, excerpt)"
app:
  environment:
    OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://host.docker.internal:11434/api}
    OLLAMA_NUM_CTX: ${OLLAMA_NUM_CTX:-16384}
    MODEL_SMALL: ${MODEL_SMALL:-gemma4:e2b}
    MODEL_LARGE: ${MODEL_LARGE:-qwen3.5:9B}
    PRICE_MODEL: ${PRICE_MODEL:-}
    TOOL_CATALOGUE: ${TOOL_CATALOGUE:-deferred}
    OTEL_SERVICE_NAME: ai-learning-path-planner
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: ${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
    OTEL_RESOURCE_ATTRIBUTES: service.namespace=examples,deployment.environment.name=${SCOUT_ENVIRONMENT:-development},environment=${SCOUT_ENVIRONMENT:-development}
  extra_hosts:
    - "host.docker.internal:host-gateway"
```

`OTEL_EXPORTER_OTLP_ENDPOINT` is fixed, because inside Compose the collector is
reachable only by its service name. Keep the `/api` suffix on
`OLLAMA_BASE_URL`.

### Dockerfile

```dockerfile showLineNumbers title="Dockerfile"
CMD ["node", "--import", "./dist/telemetry.js", "dist/index.js"]
```

Without `--import`, the service runs but exports nothing.

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="docker" label="Docker" default>
```

```bash showLineNumbers
cp .env.example .env
ollama pull qwen3.5:9B
ollama pull gemma4:e2b
make docker-up

curl -sN -X POST http://localhost:3000/plans \
  -H 'Content-Type: application/json' \
  -d '{"topic": "OpenTelemetry tracing for Node.js services"}'

make verify
```

```mdx-code-block
</TabItem>
<TabItem value="host" label="Host">
```

```bash showLineNumbers
npm install
npm run build
make start
```

The collector must be running on `http://localhost:4318`.

```mdx-code-block
</TabItem>
</Tabs>
```

A planned run takes a couple of minutes on a laptop. `make verify` runs a plan
and checks the spans, attributes and six instruments in the collector's
`debug` output. It does not need Scout.

## Troubleshooting

### No HTTP server span

The ESM loader hook was registered after `node:http` was imported. Register it
at the top of the module loaded with `node --import`.

### No spans from the container

The container started without `--import ./dist/telemetry.js`. Check the
Dockerfile `CMD`.

### Runtime context attributes are missing

The key is not listed in `includeRuntimeContext`, or the agent has no
`runtimeContext`. Both are needed.

### Cost attributes are missing

The cost processor is registered after the exporting processor. Put it first
in `spanProcessors`.

### Every cost is zero

The model has no price row and no `PRICE_MODEL` applies. Set `PRICE_MODEL` to a
model id in `_shared/pricing.json`.

### A run returns no output

The context window is too small. Ollama defaults to 4096 tokens, which a lead
run exceeds. The example sets `OLLAMA_NUM_CTX=16384`.

### No traces in Scout

Check that all four `SCOUT_*` variables are set for the collector, that it
loaded the second config file, and that `docker compose logs otel-collector`
shows no export errors.

## Security Considerations

- **Content capture is off by default.** `recordInputs` and `recordOutputs`
  follow `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`. Token counts are
  always recorded.
- **Hosted providers are opt-in.** The example will not start a hosted provider
  unless `ALLOW_HOSTED_PROVIDER=true`.
- **No keys in telemetry.** Provider keys come from the environment and are not
  set as attributes.
- **Redact in the collector.** Use the `attributes` or `transform` processor to
  remove fields before export.

## Performance Considerations

- Span count grows with requests, loop steps, tool calls and subagents. Each
  step adds a `step` and a `chat` span, and each tool call adds one more.
- The cost processor does a price lookup and a few additions per span with
  token counts.
- Content capture copies prompts and completions into spans. A tool loop
  resends the conversation on every step, so keep capture off in production
  unless you need it.
- Metrics are recorded once per run.

## AI SDK v6: Semconv Middleware

AI SDK v6 has no `@ai-sdk/otel`. Its built-in `experimental_telemetry` emits
`ai.generateText` spans that do not follow the current GenAI conventions, for
example `gen_ai.system` instead of `gen_ai.provider.name`. Leave it off and
wrap each model in a `LanguageModelV3Middleware` that opens a GenAI span per
call.

The
[`ai-contract-analyzer`](https://github.com/base-14/examples/tree/main/nodejs/ai-contract-analyzer)
example does this on Bun. It uses Ollama by default and supports Anthropic,
Google and OpenAI, with retries and provider fallback.

```typescript showLineNumbers title="src/llm/middleware.ts"
export function createSemconvMiddleware(
  target: ProviderTarget,
  pricing?: ModelPricing,
): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, model }) {
      const modelId = model.modelId;
      const metricAttrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": target.semconvName,
        "gen_ai.request.model": modelId,
      };

      return tracer.startActiveSpan(
        `chat ${modelId}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            ...metricAttrs,
            "server.address": target.serverAddress,
            "server.port": target.serverPort,
          },
        },
        async (span) => {
          const startMs = Date.now();
          const result = await doGenerate();

          const inputTokens = result.usage.inputTokens.total ?? 0;
          const outputTokens = result.usage.outputTokens.total ?? 0;
          span.setAttribute("gen_ai.usage.input_tokens", inputTokens);
          span.setAttribute("gen_ai.usage.output_tokens", outputTokens);

          tokenUsageHistogram.record(inputTokens, { ...metricAttrs, "gen_ai.token.type": "input" });
          tokenUsageHistogram.record(outputTokens, { ...metricAttrs, "gen_ai.token.type": "output" });
          opDurationHistogram.record((Date.now() - startMs) / 1000, metricAttrs);

          span.end();
          return result;
        },
      );
    },
  };
}

export function withSemconv(
  model: LanguageModelV3,
  target: ProviderTarget,
  pricing?: ModelPricing,
): LanguageModelV3 {
  return wrapLanguageModel({ model, middleware: createSemconvMiddleware(target, pricing) });
}
```

The full middleware in the example also:

- Retries with backoff.
- Sets `error.type` and an error status on failure.
- Records cost.
- Adds a `gen_ai.client.inference.operation.details` event with scrubbed,
  truncated content when capture is on.

`withFallback` switches to a second provider when the first one's retries run
out. The failed call and the successful call appear as two `chat` spans.

| | AI SDK v6 middleware | AI SDK 7 `@ai-sdk/otel` |
| --- | --- | --- |
| Spans | One `chat` span per model call, written by you. | Agent, step, chat and tool spans from the SDK. |
| Metrics | `gen_ai.client.token.usage` and `gen_ai.client.operation.duration` from the middleware. | None. Record your own. |
| Streaming | Needs `wrapStream` as well. | Included. |
| Run context | Set attributes on your own spans. | `enrichSpan` with runtime context. |

To move from v6 to v7, remove the middleware, register `@ai-sdk/otel` and move
cost into a span processor. Keep any metrics you need, because `@ai-sdk/otel`
does not record them.

## FAQ

### Does AI SDK 7 emit OpenTelemetry spans by itself?

Yes, through `@ai-sdk/otel`. After `registerTelemetry(new OpenTelemetry())`,
each `ToolLoopAgent`, `generateText` or `streamText` call produces
`invoke_agent`, `step`, `chat` and `execute_tool` spans.

### Does `@ai-sdk/otel` record metrics?

No. Record token, cost and duration metrics in your application.

### How do I add my own attributes to AI SDK spans?

Pass `enrichSpan` to the `OpenTelemetry` constructor. It receives the agent's
runtime context. List each key you use in `includeRuntimeContext`.

### Why is `gen_ai.agent.name` not my agent's id?

It comes from the telemetry `functionId`, not the agent `id`. Set `functionId`
on each agent.

### How do I track the cost of one agent run?

Add the run id with `enrichSpan`. Compute cost in a span processor's `onEnd`
and sum it per run id over `invoke_agent` spans only.

### How do I report cost for a local model?

Borrow a hosted model's rate and mark the cost as simulated. The example sets
`base14.gen_ai.cost.simulated=true`.

### Why do subagent spans nest under a tool span?

The subagent runs inside the tool's `execute`, so the tool span is its parent.

### Why is the HTTP server span missing under ESM?

The loader hook was registered after `node:http` was imported. Register it at
the top of the module loaded with `node --import`.

### Which AI SDK versions does this guide cover?

AI SDK 7 with `@ai-sdk/otel`, and AI SDK v6 with a
`LanguageModelV3Middleware` in
[AI SDK v6: Semconv Middleware](#ai-sdk-v6-semconv-middleware).

### Can I see prompts and completions in traces?

Yes. Set `recordInputs` and `recordOutputs` on the agent's telemetry settings.

### Can I use this with Next.js, Express or Fastify?

Yes. AI SDK telemetry does not depend on the HTTP framework. Start the
OpenTelemetry SDK before the framework loads. See [Next.js](./nextjs-scout.md)
and [Express](./express.md).

## What's Next?

### Related Guides

- [AI Agent Observability](../../../guides/ai-observability/agent-observability.md)
  \- agent timelines, conversation ids and multi-agent patterns.
- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  token and cost metrics and evaluation, in Python.
- [Node.js Custom Instrumentation](../custom-instrumentation/javascript-node.md)
  \- manual spans and metrics.

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - alert on
  run cost, failure rate or duration.
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - chart
  cost, fan-out and tool definition tokens.

## Complete Example

### AI SDK 7

```text showLineNumbers
ai-learning-path-planner/
├── src/
│   ├── telemetry.ts            # NodeSDK, loader hook, registerTelemetry
│   ├── telemetry/
│   │   ├── enrich.ts           # enrichSpan, cost span processor
│   │   └── metrics.ts          # Six run-level instruments
│   ├── agents/
│   │   ├── lead.ts             # Lead ToolLoopAgent and shaping call
│   │   └── researcher.ts       # Researcher subagent per subtopic
│   ├── tools/
│   │   ├── research-subtopic.ts # Fan-out tool, caps
│   │   └── catalogue.ts        # Deferred and full tool catalogues
│   ├── llm/cost.ts             # Real and simulated cost
│   └── routes/plans.ts         # POST /plans, run id, metric recording
├── config/
│   ├── otel-collector.yaml     # Local pipelines, debug exporter
│   └── otel-collector-scout.yaml
├── scripts/
│   ├── verify-scout.sh         # Span, attribute and metric assertions
│   └── measure-catalogue.sh    # Deferred against full
├── compose.yaml
└── Dockerfile
```

Source:
[`nodejs/ai-learning-path-planner`](https://github.com/base-14/examples/tree/main/nodejs/ai-learning-path-planner).

### AI SDK v6

Middleware, a multi-stage pipeline, pgvector retrieval, retries and provider
fallback on Bun:
[`nodejs/ai-contract-analyzer`](https://github.com/base-14/examples/tree/main/nodejs/ai-contract-analyzer).

## References

- [Vercel AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/languages/js/)
- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/)
