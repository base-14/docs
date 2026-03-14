---
title:
  Vercel AI SDK OpenTelemetry Instrumentation - Complete AI Pipeline Monitoring
  Guide | base14 Scout
sidebar_label: Vercel AI SDK
sidebar_position: 8
description:
  Trace LLM calls, track tokens and costs, and monitor multi-stage AI pipelines.
  Instrument Vercel AI SDK with OpenTelemetry GenAI semantic conventions and
  base14 Scout.
keywords:
  [
    vercel ai sdk opentelemetry,
    ai sdk observability,
    vercel ai sdk monitoring,
    nodejs llm monitoring,
    genai semantic conventions typescript,
    bun opentelemetry,
    hono opentelemetry,
    ai sdk instrumentation guide,
    typescript llm tracing,
    vercel ai sdk telemetry,
    vercel ai sdk metrics,
    llm token tracking typescript,
    llm cost monitoring nodejs,
    ai pipeline observability,
    multi-stage ai pipeline tracing,
    ai sdk middleware opentelemetry,
    vercel ai sdk production monitoring,
    opentelemetry nodejs ai,
    pgvector opentelemetry,
  ]
---

# Vercel AI SDK

Implement OpenTelemetry instrumentation for Vercel AI SDK v6 applications to
enable comprehensive AI pipeline monitoring, LLM cost tracking, and end-to-end
trace visibility. This guide shows you how to instrument a multi-stage AI
pipeline with custom GenAI semantic convention spans via
`LanguageModelV3Middleware`, multi-provider LLM support with automatic fallback,
token and cost metrics, concurrent pipeline stage execution, and production
deployment with Docker Compose.

Vercel AI SDK applications present unique observability challenges. A
multi-stage pipeline involves sequential and concurrent stages - ingestion,
routing, extraction, embedding, scoring, summarization - each making LLM or
embedding API calls, database queries, and file operations. The AI SDK's
middleware architecture (`LanguageModelV3Middleware`) provides a natural
interception point for attaching GenAI semantic conventions to every model call
without modifying business logic. This guide shows how to use that architecture
to produce standard OpenTelemetry telemetry that works with any OTel-compatible
backend.

Whether you're building contract analysis pipelines, document processing
systems, RAG applications with pgvector, or any TypeScript/Bun application that
uses Vercel AI SDK for LLM orchestration, this guide provides production-ready
patterns for unified AI observability where every pipeline stage, LLM call, and
database query lives in a single trace on base14 Scout.

:::tip TL;DR

Instrument Vercel AI SDK v6 applications with OpenTelemetry by implementing a
`LanguageModelV3Middleware` that attaches GenAI semantic convention attributes
to every LLM call. This gives you unified traces spanning HTTP requests,
pipeline stages, LLM completions, and database queries, with per-model token and
cost tracking.

:::

> **Note:** For general LLM observability patterns applicable to any framework,
> see the
> [LLM Observability guide](../../../guides/ai-observability/llm-observability.md).
> This guide focuses specifically on Vercel AI SDK integration patterns with
> TypeScript and Bun.

## Who This Guide Is For

This documentation is designed for:

- **Node.js/Bun AI developers**: building AI-powered features with Vercel AI SDK
  and needing visibility into model performance, cost, and pipeline throughput
- **Backend developers**: adding AI capabilities to existing Hono or Express
  applications and wanting unified tracing across all layers
- **Platform teams**: standardizing observability across AI services and
  traditional microservices using OpenTelemetry
- **Engineering teams**: migrating from proprietary AI observability tools
  (Traceloop, Helicone) to vendor-neutral OpenTelemetry
- **DevOps engineers**: deploying AI applications with production monitoring,
  cost alerting, and pipeline health tracking

## Vercel AI SDK OpenTelemetry Overview

This guide demonstrates how to:

- Set up unified OpenTelemetry for a Bun + Hono application (traces + metrics +
  logs)
- Create a `LanguageModelV3Middleware` that attaches GenAI semantic convention
  attributes to every LLM call
- Support multiple LLM providers (Anthropic, Google, Ollama) with automatic
  fallback
- Instrument multi-stage pipeline execution with concurrent stages
- Track token usage and calculate cost per LLM call with a pricing table
- Record HTTP request metrics via Hono middleware
- Correlate logs with traces via trace_id and span_id injection
- Deploy with Docker Compose, PostgreSQL/pgvector, and the OpenTelemetry
  Collector

## Prerequisites

Before starting, ensure you have:

- **Bun 1.2 or later** installed (1.2+ recommended for stable OpenTelemetry
  support)
- **An LLM API key** from at least one provider (Anthropic, OpenAI, or Google)
- **Scout Collector** configured and accessible
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics)
- Familiarity with Vercel AI SDK's `generateText` / `generateObject` APIs

### Compatibility Matrix

| Component                           | Minimum Version | Recommended |
| ----------------------------------- | --------------- | ----------- |
| Bun                                 | 1.2             | 1.2+        |
| ai (Vercel AI SDK)                  | 6.0             | 6.0.95+     |
| @ai-sdk/anthropic                   | 3.0             | 3.0.46+     |
| @ai-sdk/google                      | 3.0             | 3.0.30+     |
| @ai-sdk/openai                      | 3.0             | 3.0.30+     |
| Hono                                | 4.0             | 4.12+       |
| @opentelemetry/sdk-node             | 0.212           | 0.212+      |
| @opentelemetry/api                  | 1.9             | 1.9+        |
| @opentelemetry/semantic-conventions | 1.39            | 1.39+       |
| @opentelemetry/instrumentation-pg   | 0.64            | 0.64+       |
| pg                                  | 8.0             | 8.18+       |
| Zod                                 | 4.0             | 4.3+        |

## Installation

```bash showLineNumbers title="Terminal"
bun add \
  ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-logs \
  @opentelemetry/sdk-metrics \
  @opentelemetry/semantic-conventions \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/instrumentation \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-pg \
  hono pg pgvector zod
```

## Configuration

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="module" label="Telemetry Module (Recommended)" default>
```

The telemetry module must be loaded **before** any other imports via Bun's
`--preload` flag. This ensures the OpenTelemetry SDK instruments `pg` and `http`
before they are imported elsewhere.

```typescript showLineNumbers title="src/telemetry.ts"
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

const otelEnabled = Bun.env.OTEL_ENABLED !== "false";
const endpoint = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const serviceName = Bun.env.OTEL_SERVICE_NAME ?? "ai-contract-analyzer";

if (otelEnabled) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 15_000,
        exportTimeoutMillis: 10_000,
      }),
    ],
    instrumentations: [new PgInstrumentation()],
  });
  sdk.start();

  const loggerProvider = new LoggerProvider({
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${endpoint}/v1/logs`,
        }),
      ),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
}
```

Key design decisions:

- **`NodeSDK` owns the `MeterProvider`** - passing `metricReaders` here avoids
  the duplicate-registration error that occurs when a separate `MeterProvider`
  is created after `sdk.start()`
- **`PgInstrumentation`** auto-instruments all PostgreSQL queries so they appear
  as child spans under your pipeline stages
- **Logs are exported** to the collector so Scout can correlate them with traces
  via `trace_id` / `span_id`

```mdx-code-block
</TabItem>
<TabItem value="config" label="Zod Config">
```

```typescript showLineNumbers title="src/config.ts"
import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  otelServiceName: z.string().default("ai-contract-analyzer"),
  otelExporterEndpoint: z.string().default("http://localhost:4318"),
  otelEnabled: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  llmProvider: z.enum(["anthropic", "google", "ollama"]).default("anthropic"),
  embeddingProvider: z.enum(["openai", "ollama", "google"]).default("openai"),
  llmProviderFallback: z.enum(["anthropic", "google", "ollama"]).optional(),
  llmModelFallback: z.string().optional(),
});

const parsed = ConfigSchema.safeParse({
  port: Bun.env.PORT,
  databaseUrl: Bun.env.DATABASE_URL,
  anthropicApiKey: Bun.env.ANTHROPIC_API_KEY,
  openaiApiKey: Bun.env.OPENAI_API_KEY,
  googleApiKey: Bun.env.GOOGLE_GENERATIVE_AI_API_KEY,
  otelServiceName: Bun.env.OTEL_SERVICE_NAME,
  otelExporterEndpoint: Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  otelEnabled: Bun.env.OTEL_ENABLED,
  llmProvider: Bun.env.LLM_PROVIDER,
  embeddingProvider: Bun.env.EMBEDDING_PROVIDER,
  llmProviderFallback: Bun.env.LLM_PROVIDER_FALLBACK,
  llmModelFallback: Bun.env.LLM_MODEL_FALLBACK,
});

if (!parsed.success) {
  console.error("Configuration error:", parsed.error);
  throw new Error("Invalid configuration");
}

export const config = parsed.data;
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

For container deployments where configuration is managed externally:

```bash showLineNumbers title=".env"
# Application
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/contract_analyzer

# LLM Provider
LLM_PROVIDER=anthropic
EMBEDDING_PROVIDER=openai
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=

# Fallback Provider (optional)
LLM_PROVIDER_FALLBACK=google
LLM_MODEL_FALLBACK=gemini-2.5-flash

# OpenTelemetry
OTEL_SERVICE_NAME=ai-contract-analyzer
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_ENABLED=true
SCOUT_ENVIRONMENT=production
```

The Zod `ConfigSchema` reads all environment variables automatically (see the
Zod Config tab). No code changes needed - set the variables and the application
picks them up.

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### OpenTelemetry Collector

```yaml showLineNumbers title="config/otel-collector-config.yaml"
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
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'
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
    verbosity: basic

service:
  extensions: [health_check, zpages, oauth2client]
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

The `filter/noisy` processor drops health check spans from traces, preventing
them from cluttering your pipeline traces in Scout.

### Docker Compose

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/contract_analyzer
      - OTEL_SERVICE_NAME=ai-contract-analyzer
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_ENABLED=true
      - LLM_PROVIDER=${LLM_PROVIDER:-anthropic}
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-openai}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY:-}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 60s
      timeout: 5s
      retries: 3

  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: contract_analyzer
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5434:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./config/otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
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
FROM oven/bun:1.2-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "--preload", \
     "./src/telemetry.ts", "src/index.ts"]
```

The `--preload ./src/telemetry.ts` flag ensures OpenTelemetry initializes before
any application code runs. This is critical for `PgInstrumentation` to
monkey-patch the `pg` module before it is first imported.

## Framework-Specific Features

This section covers Vercel AI SDK-specific instrumentation patterns that go
beyond generic LLM observability. These patterns give you visibility into the AI
SDK middleware layer - how models are wrapped, how GenAI semantic conventions
are attached, and how multi-stage pipelines are orchestrated.

### GenAI Semantic Convention Middleware

The core instrumentation pattern uses `LanguageModelV3Middleware` to intercept
every `doGenerate` call and attach OpenTelemetry spans with GenAI semantic
convention attributes. This means you instrument once at the middleware level
and every LLM call in your application automatically gets traced:

```typescript showLineNumbers title="src/llm/middleware.ts"
import type {
  LanguageModelV3,
  LanguageModelV3Middleware,
} from "@ai-sdk/provider";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { wrapLanguageModel } from "ai";

const tracer = trace.getTracer("ai-contract-analyzer");
const meter = metrics.getMeter("ai-contract-analyzer");

const opDurationHistogram = meter.createHistogram(
  "gen_ai.client.operation.duration",
  { description: "LLM operation duration", unit: "s" },
);
const tokenUsageHistogram = meter.createHistogram("gen_ai.client.token.usage", {
  description: "LLM token usage",
  unit: "{token}",
});
const costCounter = meter.createCounter("gen_ai.client.cost", {
  description: "LLM cost in USD",
  unit: "usd",
});
const errorCounter = meter.createCounter("gen_ai.client.error.count", {
  description: "LLM call error count",
  unit: "{error}",
});
const retryCounter = meter.createCounter("gen_ai.client.retry.count", {
  description: "LLM call retry count",
  unit: "{retry}",
});

const TRUNCATE_PROMPT = 1_000;
const TRUNCATE_COMPLETION = 2_000;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function createSemconvMiddleware(
  providerName: string,
  serverAddress: string,
  pricing?: {
    inputCostPerMToken: number;
    outputCostPerMToken: number;
  },
): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, params, model }) {
      const modelId = model.modelId;
      const spanName = `gen_ai.chat ${modelId}`;

      return tracer.startActiveSpan(spanName, async (span) => {
        // Required GenAI semconv attributes
        span.setAttribute("gen_ai.operation.name", "chat");
        span.setAttribute("gen_ai.provider.name", providerName);
        span.setAttribute("gen_ai.request.model", modelId);
        span.setAttribute("server.address", serverAddress);

        // Recommended attributes
        if (params.maxOutputTokens !== undefined)
          span.setAttribute(
            "gen_ai.request.max_tokens",
            params.maxOutputTokens,
          );
        if (params.temperature !== undefined)
          span.setAttribute("gen_ai.request.temperature", params.temperature);

        const startMs = Date.now();

        try {
          const result = await doGenerate();
          const durationS = (Date.now() - startMs) / 1000;

          const inputTokens = result.usage.inputTokens.total ?? 0;
          const outputTokens = result.usage.outputTokens.total ?? 0;

          // Response attributes
          if (result.response?.modelId)
            span.setAttribute("gen_ai.response.model", result.response.modelId);
          span.setAttribute("gen_ai.usage.input_tokens", inputTokens);
          span.setAttribute("gen_ai.usage.output_tokens", outputTokens);

          // Token usage metrics
          const metricAttrs = {
            "gen_ai.operation.name": "chat",
            "gen_ai.provider.name": providerName,
            "gen_ai.request.model": modelId,
          };
          tokenUsageHistogram.record(inputTokens, {
            ...metricAttrs,
            "gen_ai.token.type": "input",
          });
          tokenUsageHistogram.record(outputTokens, {
            ...metricAttrs,
            "gen_ai.token.type": "output",
          });

          // Cost tracking
          if (pricing) {
            const costUsd =
              (inputTokens * pricing.inputCostPerMToken +
                outputTokens * pricing.outputCostPerMToken) /
              1_000_000;
            span.setAttribute("gen_ai.usage.cost_usd", costUsd);
            costCounter.add(costUsd, metricAttrs);
          }

          opDurationHistogram.record(durationS, {
            "gen_ai.request.model": modelId,
            "gen_ai.provider.name": providerName,
          });

          span.end();
          return result;
        } catch (err) {
          const durationS = (Date.now() - startMs) / 1000;
          const errorType = (err as Error).constructor?.name ?? "UnknownError";

          span.recordException(err as Error);
          span.setAttribute("error.type", errorType);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (err as Error).message,
          });

          errorCounter.add(1, {
            "gen_ai.request.model": modelId,
            "gen_ai.provider.name": providerName,
            "error.type": errorType,
          });
          opDurationHistogram.record(durationS, {
            "gen_ai.request.model": modelId,
            "gen_ai.provider.name": providerName,
          });

          span.end();
          throw err;
        }
      });
    },
  };
}
```

The middleware intercepts `wrapGenerate` - the AI SDK's hook that runs around
every `doGenerate()` call. This means structured output (`generateObject`),
plain text (`generateText`), and streaming calls all get instrumented
automatically.

### Wrapping Models with Semconv Middleware

Apply the middleware to any AI SDK model with a convenience function:

```typescript showLineNumbers title="src/llm/middleware.ts"
export function withSemconv(
  model: LanguageModelV3,
  providerName: string,
  serverAddress: string,
  pricing?: {
    inputCostPerMToken: number;
    outputCostPerMToken: number;
  },
): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: createSemconvMiddleware(providerName, serverAddress, pricing),
  });
}
```

### Multi-Provider Support

Configure providers with OTel semconv metadata so spans carry the correct
`gen_ai.provider.name` and `server.address`:

```typescript showLineNumbers title="src/providers.ts"
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { withFallback, withSemconv } from "./llm/middleware";

const PROVIDER_META: Record<
  string,
  { semconvName: string; serverAddress: string }
> = {
  anthropic: {
    semconvName: "anthropic",
    serverAddress: "api.anthropic.com",
  },
  google: {
    semconvName: "google",
    serverAddress: "generativelanguage.googleapis.com",
  },
  openai: {
    semconvName: "openai",
    serverAddress: "api.openai.com",
  },
  ollama: {
    semconvName: "ollama",
    serverAddress: "localhost",
  },
};

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4.0,
  },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

function buildRawModel(provider: string, modelId: string): LanguageModelV3 {
  if (provider === "google")
    return google(modelId) as unknown as LanguageModelV3;
  if (provider === "ollama") {
    const ollamaOpenAI = createOpenAI({
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    return ollamaOpenAI(modelId) as unknown as LanguageModelV3;
  }
  return anthropic(modelId) as unknown as LanguageModelV3;
}

export function getCapableModel() {
  const provider = "anthropic";
  const modelId = "claude-sonnet-4-6";
  const meta = PROVIDER_META[provider];
  const pricing = MODEL_PRICING[modelId] ?? {
    input: 3.0,
    output: 15.0,
  };

  const raw = buildRawModel(provider, modelId);
  const model = withSemconv(raw, meta.semconvName, meta.serverAddress, {
    inputCostPerMToken: pricing.input,
    outputCostPerMToken: pricing.output,
  });

  return { modelId, model };
}
```

Every model returned by `getCapableModel()` or `getFastModel()` is already
wrapped with the GenAI semconv middleware. Call `generateText()` or
`generateObject()` normally - spans are created automatically.

### Pipeline Stage Spans

Wrap each pipeline stage in a span to see the full execution flow. Use
`tracer.startActiveSpan` so that LLM calls within a stage become child spans:

```typescript showLineNumbers title="src/pipeline/orchestrator.ts"
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("ai-contract-analyzer");
const meter = metrics.getMeter("ai-contract-analyzer");

const analysisDuration = meter.createHistogram("contract.analysis.duration", {
  description: "Total pipeline duration",
  unit: "s",
});

export async function analyzeContract(file: File, pool: Pool) {
  const startMs = Date.now();

  return tracer.startActiveSpan("analyze_contract", async (rootSpan) => {
    rootSpan.setAttribute("document.filename", file.name);
    rootSpan.setAttribute("document.size_bytes", file.size);

    try {
      // Stage 1: Ingest
      const ingestResult = await tracer.startActiveSpan(
        "pipeline_stage ingest",
        async (span) => {
          span.setAttribute("pipeline.stage", "ingest");
          const result = await ingestDocument(file);
          span.setAttribute("document.page_count", result.page_count);
          span.end();
          return result;
        },
      );

      // Stage 2: Route
      const routeResult = await tracer.startActiveSpan(
        "pipeline_stage route",
        async (span) => {
          span.setAttribute("pipeline.stage", "route");
          const result = await routeDocument(ingestResult.full_text);
          span.setAttribute("route.document_type", result.document_type);
          span.setAttribute("route.complexity", result.complexity);
          span.end();
          return result;
        },
      );

      // Stages 3 & 4: Embed + Extract (concurrent)
      const [, extractResult] = await Promise.all([
        tracer.startActiveSpan("pipeline_stage embed", async (span) => {
          span.setAttribute("pipeline.stage", "embed");
          const result = await embedChunks(ingestResult.chunks);
          span.setAttribute(
            "embedding.chunk_count",
            ingestResult.chunks.length,
          );
          span.end();
          return result;
        }),
        tracer.startActiveSpan("pipeline_stage extract", async (span) => {
          span.setAttribute("pipeline.stage", "extract");
          const result = await extractClauses(ingestResult.full_text);
          span.setAttribute("extraction.clauses_found", result.clauses.length);
          span.end();
          return result;
        }),
      ]);

      // Stage 5: Score
      // Stage 6: Summarize
      // ... (same pattern)

      const durationS = (Date.now() - startMs) / 1000;
      rootSpan.setAttribute("pipeline.status", "complete");
      rootSpan.setAttribute("pipeline.total_stages", 6);
      analysisDuration.record(durationS);
      rootSpan.end();
      return result;
    } catch (err) {
      rootSpan.recordException(err as Error);
      rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      rootSpan.end();
      throw err;
    }
  });
}
```

The resulting trace in Scout shows the full hierarchy:

```text showLineNumbers title="Single trace spanning all layers"
POST /api/contracts/analyze                       8.2s  [HTTP]
└─ analyze_contract                               8.1s  [pipeline]
   ├─ pipeline_stage ingest                       0.3s  [stage]
   │  └─ db.query INSERT contracts                5ms   [auto: pg]
   ├─ pipeline_stage route                        1.2s  [stage]
   │  └─ gen_ai.chat claude-sonnet-4-6            1.1s  [middleware]
   ├─ pipeline_stage embed                        0.8s  [stage]  ──┐
   │  └─ gen_ai.embeddings text-embedding-3-small 0.7s  [custom]  │ concurrent
   ├─ pipeline_stage extract                      2.4s  [stage]  ──┘
   │  └─ gen_ai.chat claude-sonnet-4-6            2.3s  [middleware]
   ├─ pipeline_stage score                        1.8s  [stage]
   │  └─ gen_ai.chat claude-haiku-4-5             1.7s  [middleware]
   ├─ pipeline_stage summarize                    1.5s  [stage]
   │  └─ gen_ai.chat claude-sonnet-4-6            1.4s  [middleware]
   └─ db.query INSERT analyses                    3ms   [auto: pg]
```

### Concurrent Stage Execution

Stages that don't depend on each other can run concurrently with `Promise.all`.
OpenTelemetry preserves the trace context across concurrent promises, so both
stages appear as siblings under the same parent span:

```typescript showLineNumbers title="Concurrent stages"
const [embedResult, extractResult] = await Promise.all([
  tracer.startActiveSpan("pipeline_stage embed", async (span) => {
    // This LLM call becomes a child of "embed"
    const result = await embedChunks(chunks);
    span.end();
    return result;
  }),
  tracer.startActiveSpan("pipeline_stage extract", async (span) => {
    // This LLM call becomes a child of "extract"
    const result = await extractClauses(text);
    span.end();
    return result;
  }),
]);
```

### HTTP Metrics Middleware

Track HTTP request duration and count with a Hono middleware that records
OpenTelemetry metrics:

```typescript showLineNumbers title="src/middleware/metrics.ts"
import { metrics } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

const meter = metrics.getMeter("ai-contract-analyzer");

const httpRequestDuration = meter.createHistogram(
  "http.server.request.duration",
  { description: "HTTP request duration", unit: "s" },
);

const httpRequestCount = meter.createCounter("http.server.request.count", {
  description: "HTTP request count",
});

export const requestMetrics: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = (Date.now() - start) / 1000;

  const attrs = {
    "http.request.method": c.req.method,
    "http.response.status_code": String(c.res.status),
    "url.path": c.req.path,
  };

  httpRequestDuration.record(duration, attrs);
  httpRequestCount.add(1, attrs);
};
```

### Log Correlation

Inject `trace_id` and `span_id` into every log record so logs can be correlated
with traces in Scout:

```typescript showLineNumbers title="src/logger.ts"
import { trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const otelLogger = logs.getLogger("ai-contract-analyzer");

type LogAttrs = Record<string, string | number | boolean | undefined>;

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  attrs?: LogAttrs,
) {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();

  otelLogger.emit({
    severityNumber,
    severityText,
    body: message,
    attributes: {
      ...attrs,
      ...(ctx
        ? {
            trace_id: ctx.traceId,
            span_id: ctx.spanId,
          }
        : {}),
    },
  });
}

export const logger = {
  info: (msg: string, attrs?: LogAttrs) =>
    emit(SeverityNumber.INFO, "INFO", msg, attrs),
  warn: (msg: string, attrs?: LogAttrs) =>
    emit(SeverityNumber.WARN, "WARN", msg, attrs),
  error: (msg: string, attrs?: LogAttrs) =>
    emit(SeverityNumber.ERROR, "ERROR", msg, attrs),
};
```

## Custom Manual Instrumentation

### Custom Spans for Pipeline Stages

Beyond the middleware-instrumented LLM calls, add manual spans for any custom
logic that deserves visibility:

```typescript showLineNumbers title="Custom span example"
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("ai-contract-analyzer");

async function processChunk(chunk: string, index: number) {
  return tracer.startActiveSpan(`process_chunk ${index}`, async (span) => {
    span.setAttribute("chunk.index", index);
    span.setAttribute("chunk.length", chunk.length);

    const result = await doProcessing(chunk);

    span.setAttribute("chunk.tokens_estimated", result.tokenCount);
    span.end();
    return result;
  });
}
```

### Retry and Fallback Instrumentation

The middleware supports application-level retry with exponential backoff and
provider fallback:

```typescript showLineNumbers title="src/llm/middleware.ts"
const MAX_RETRIES = 2;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

// Inside createSemconvMiddleware's wrapGenerate:
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const result = await doGenerate();
    // ... record success metrics
    span.end();
    return result;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      retryCounter.add(1, {
        "gen_ai.request.model": modelId,
        "gen_ai.provider.name": providerName,
      });
      const backoffMs = Math.min(MIN_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      span.addEvent("gen_ai.retry", {
        attempt: attempt + 1,
        backoff_ms: backoffMs,
        error: (err as Error).message,
      });
      await sleep(backoffMs);
    }
  }
}
```

### Provider Fallback

When all retries are exhausted for the primary provider, fall back to a
secondary model:

```typescript showLineNumbers title="src/llm/middleware.ts"
export function withFallback(
  primary: LanguageModelV3,
  primaryProviderName: string,
  fallback: LanguageModelV3,
): LanguageModelV3 {
  const fallbackMiddleware: LanguageModelV3Middleware = {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, params, model }) {
      try {
        return await doGenerate();
      } catch (err) {
        const fallbackCounter = metrics
          .getMeter("ai-contract-analyzer")
          .createCounter("gen_ai.client.fallback.count");
        fallbackCounter.add(1, {
          "gen_ai.request.model": model.modelId,
          "gen_ai.provider.name": primaryProviderName,
        });
        return await fallback.doGenerate(params);
      }
    },
  };

  return wrapLanguageModel({
    model: primary,
    middleware: fallbackMiddleware,
  });
}
```

The fallback model has its own semconv middleware, so both the failed primary
call and the successful fallback call appear as separate spans in the trace with
their respective provider attributes.

### Embedding Metrics

Track embedding operations alongside LLM calls:

```typescript showLineNumbers title="src/pipeline/orchestrator.ts"
// Inside the embed stage span
tokenUsageHistogram.record(embedResult.total_tokens, {
  "gen_ai.operation.name": "embeddings",
  "gen_ai.provider.name": config.embeddingProvider,
  "gen_ai.request.model": embedModelId,
  "gen_ai.token.type": "input",
});

costCounter.add(embedCostUsd, {
  "gen_ai.operation.name": "embeddings",
  "gen_ai.provider.name": config.embeddingProvider,
  "gen_ai.request.model": embedModelId,
});
```

### Pipeline-Level Metrics

Record aggregate metrics on the root pipeline span for dashboards and alerting:

```typescript showLineNumbers title="Root span attributes"
rootSpan.setAttribute("pipeline.total_stages", 6);
rootSpan.setAttribute("pipeline.total_tokens", totalTokens);
rootSpan.setAttribute(
  "pipeline.total_cost_usd",
  Math.round(totalCost * 10_000) / 10_000,
);
rootSpan.setAttribute("pipeline.duration_ms", totalDurationMs);
rootSpan.setAttribute("route.document_type", routeResult.document_type);
rootSpan.setAttribute("pipeline.status", "complete");
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash showLineNumbers
bun run --watch --preload ./src/telemetry.ts src/index.ts
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

```bash showLineNumbers
OTEL_ENABLED=true \
LLM_PROVIDER=anthropic \
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
bun run --preload ./src/telemetry.ts src/index.ts
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build

curl http://localhost:3000/health

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verify Telemetry Is Working

```bash showLineNumbers
# Collector health check
curl http://localhost:13133

# zpages trace viewer
# Open http://localhost:55679/debug/tracez
```

### Enable Debug Mode

```typescript showLineNumbers
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. Confirm the OTel Collector is running: `curl http://localhost:13133`
2. Check collector logs: `docker compose logs otel-collector`
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` points to the collector, not directly to
   Scout
4. Ensure `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` are set in the collector
   environment

#### Issue: Token counts are zero

**Solutions:**

1. Verify you're using AI SDK v6+ - earlier versions use a different `usage`
   response shape
2. Check that `result.usage.inputTokens.total` exists (v6 uses nested token
   objects)
3. For Ollama models, ensure the model returns usage metadata (some older models
   don't)

#### Issue: Pipeline spans not nested correctly

**Solutions:**

1. Ensure `telemetry.ts` is loaded via `--preload` before any application code
2. Verify all `span.end()` calls happen after async work completes
3. Check that `tracer.startActiveSpan` is used (not `tracer.startSpan`) so child
   spans inherit the parent context

#### Issue: Duplicate MeterProvider registration

**Solutions:**

1. Pass `metricReaders` to `NodeSDK` instead of creating a separate
   `MeterProvider`
2. Ensure `telemetry.ts` runs only once (preload, not imported from multiple
   files)

#### Issue: PostgreSQL queries not appearing as spans

**Solutions:**

1. Verify `PgInstrumentation` is included in the `instrumentations` array in
   `NodeSDK`
2. Confirm `telemetry.ts` is preloaded before `pg` is first imported

## Security Considerations

### Protecting Sensitive Data

- **Truncate prompts and completions** - the middleware truncates user messages
  to 1,000 characters and completions to 2,000 characters to avoid oversized
  spans
- **Never record raw API keys** in span attributes - the Zod config validates
  keys are present but never logs their values
- **Disable content capture** in production if compliance requires it by
  removing `span.addEvent("gen_ai.user.message", ...)` calls

### SQL Query Obfuscation

The `PgInstrumentation` auto-instrumentor captures SQL statements by default.
For sensitive queries, configure it to obfuscate:

```typescript showLineNumbers
new PgInstrumentation({
  enhancedDatabaseReporting: false,
});
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Use opt-in content capture - disabled by default in production
- Record only token counts and model metadata, not prompt content
- Audit span attributes regularly for sensitive data leaks
- Use the OTel Collector `attributes` processor to redact fields before export

## Performance Considerations

OpenTelemetry overhead is negligible relative to LLM API latency. A typical LLM
call takes 1-5 seconds; span creation adds microseconds.

| Metric                 | Typical Impact        |
| ---------------------- | --------------------- |
| Span creation overhead | &lt; 0.05 ms per span |
| CPU overhead           | &lt; 0.5%             |
| Memory (OTel SDK)      | ~5-10 MB              |
| Network (batch export) | ~50 KB/min            |

### Optimization Strategies

#### 1. Batch Span Export

The `NodeSDK` uses `BatchSpanProcessor` by default, which batches span exports
to minimize network overhead. Tune the metric reader interval for your workload:

```typescript showLineNumbers
new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url }),
  exportIntervalMillis: 15_000, // 15s for dev
  // Use 60_000 for production
});
```

#### 2. Truncate Content Events

Always truncate prompts and completions:

```typescript showLineNumbers
truncate(userPrompt, 1_000); // 1,000 chars max
truncate(completion, 2_000); // 2,000 chars max
```

#### 3. Concurrent Pipeline Stages

Run independent stages concurrently with `Promise.all` to reduce total pipeline
latency. The embed and extract stages in the example run concurrently because
neither depends on the other's output.

#### 4. Filter Noisy Spans

Use the collector's `filter/noisy` processor to drop health check spans that
would otherwise dominate your trace view:

```yaml showLineNumbers
filter/noisy:
  error_mode: ignore
  traces:
    span:
      - 'IsMatch(name, ".*/health.*")'
```

## FAQ

### Does OpenTelemetry add latency to LLM calls?

No. Span creation takes microseconds. LLM API calls take seconds. The overhead
is unmeasurable. `BatchSpanProcessor` exports spans in a background thread.

### How do I add OpenTelemetry to Vercel AI SDK without Traceloop?

Traceloop's `@traceloop/node-server-sdk` provides auto- instrumentation but
produces attributes that may not align with the OpenTelemetry GenAI semantic
conventions. The middleware approach gives you full control over what gets
recorded and ensures standard `gen_ai.*` attributes that work with any
OTel-compatible backend.

### Which Vercel AI SDK versions are supported?

This guide requires AI SDK v6+ (`ai@6.0.0`). The `LanguageModelV3Middleware`
interface and `wrapLanguageModel` API were introduced in v6. Earlier versions
used a different middleware signature.

### How do I initialize OpenTelemetry before my Bun application starts?

Bun's `--preload` flag runs the specified file before the application entry
point. This ensures `NodeSDK.start()` and `PgInstrumentation` initialize before
any `pg` or `http` imports, which is required for monkey-patching to work
correctly.

### How do I track cost across multiple providers?

Use the `gen_ai.client.cost` counter metric with `gen_ai.provider.name` and
`gen_ai.request.model` attributes. Define pricing per model in `MODEL_PRICING`
and calculate from token counts. This enables
`sum(gen_ai.client.cost) by (gen_ai.provider.name)` in dashboards.

### Can I see prompts and completions in traces?

Yes. The middleware records `gen_ai.user.message` and `gen_ai.assistant.message`
span events with truncated content. Remove these `span.addEvent` calls in
production for compliance.

### How do I add OpenAI, Anthropic, or other providers to Vercel AI SDK?

Add the provider SDK package (e.g., `@ai-sdk/mistral`), add its entry to
`PROVIDER_META` with the semconv name and server address, add model pricing to
`MODEL_PRICING`, and create a case in `buildRawModel`. The semconv middleware
wraps it automatically.

### How does LLM provider fallback appear in OpenTelemetry traces?

When all retries are exhausted for the primary model, the fallback middleware
catches the error and calls the secondary model's `doGenerate` directly. The
secondary model has its own semconv wrapper, so both the failed primary and
successful fallback appear as separate spans in the trace.

### Can I use this with Next.js instead of Hono?

Yes. The `LanguageModelV3Middleware` pattern works with any framework. Replace
the Hono HTTP metrics middleware with Next.js middleware and configure the
telemetry module as a Node.js `--require` flag instead of Bun `--preload`.

### How do I instrument streaming responses?

The current middleware instruments `wrapGenerate` for non-streaming calls. For
streaming, implement `wrapStream` in the middleware with the same span and
metric logic. AI SDK v6 calls `wrapStream` for `streamText()` and
`streamObject()`.

### Can I use this with Express or Fastify?

Yes. The OpenTelemetry instrumentation and AI SDK middleware are
framework-agnostic. Replace the Hono HTTP metrics middleware with the
appropriate Express or Fastify instrumentor from the
`@opentelemetry/instrumentation-*` packages.

### How do concurrent stages appear in traces?

Stages run with `Promise.all` appear as sibling spans under the same parent.
OpenTelemetry preserves the trace context across concurrent promises, so each
stage and its child LLM calls are correctly nested.

## What's Next?

### Advanced Topics

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability patterns
- [LangGraph Instrumentation](./langgraph.md) - Python agent pipeline
  instrumentation
- [LlamaIndex Instrumentation](./llamaindex.md) - Python structured output
  instrumentation
- [Node.js Auto-Instrumentation](./nodejs.md) - Node.js-specific setup
- [Node.js Manual Spans](../custom-instrumentation/javascript-node.md) - Custom
  tracing fundamentals

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Alert on
  cost spikes, error rates, or pipeline failures
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  dashboards for token usage, cost attribution, and pipeline duration

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with the OTel Collector

## Complete Example

### Project Structure

```text showLineNumbers
ai-contract-analyzer/
├── src/
│   ├── index.ts                # Hono app entry point
│   ├── config.ts               # Zod config validation
│   ├── telemetry.ts            # OTel initialization (preload)
│   ├── logger.ts               # Log correlation with trace context
│   ├── providers.ts            # Multi-provider model factory
│   ├── llm/
│   │   └── middleware.ts       # GenAI semconv middleware
│   ├── pipeline/
│   │   ├── orchestrator.ts     # Pipeline stage spans
│   │   ├── ingest.ts           # Document ingestion
│   │   ├── route.ts            # Document routing (LLM)
│   │   ├── extract.ts          # Clause extraction (LLM)
│   │   ├── embed.ts            # Embedding generation
│   │   ├── score.ts            # Risk scoring (LLM)
│   │   └── summarize.ts        # Summary generation (LLM)
│   ├── middleware/
│   │   └── metrics.ts          # HTTP request metrics
│   ├── routes/
│   │   ├── contracts.ts        # Contract upload endpoint
│   │   ├── query.ts            # Contract query endpoint
│   │   ├── search.ts           # Vector search endpoint
│   │   └── health.ts           # Health check
│   ├── db/
│   │   ├── pool.ts             # PostgreSQL connection pool
│   │   ├── contracts.ts        # Contract CRUD
│   │   ├── chunks.ts           # Chunk storage with pgvector
│   │   ├── clauses.ts          # Clause storage
│   │   ├── risks.ts            # Risk storage
│   │   └── analyses.ts         # Analysis results
│   └── types/
│       ├── contracts.ts        # Contract types
│       ├── clauses.ts          # Clause types
│       └── pipeline.ts         # Pipeline result types
├── config/
│   └── otel-collector-config.yaml
├── compose.yml
├── Dockerfile
└── package.json
```

### Key Files

| File              | Demonstrates                                   |
| ----------------- | ---------------------------------------------- |
| `telemetry.ts`    | OTel setup (traces + metrics + logs)           |
| `middleware.ts`   | GenAI semconv via LanguageModelV3Middleware    |
| `orchestrator.ts` | Pipeline stages, concurrent execution, metrics |
| `providers.ts`    | Multi-provider factory with fallback           |
| `metrics.ts`      | HTTP request duration and count                |
| `logger.ts`       | Log correlation with trace_id/span_id          |
| `config.ts`       | Zod-validated environment config               |
| `compose.yml`     | Docker deployment with OTel Collector          |

### GitHub Repository

For a complete working example, see the
[AI Contract Analyzer](https://github.com/base-14/examples/tree/main/nodejs/ai-contract-analyzer)
repository.

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/languages/js/)
- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs)
- [Hono Documentation](https://hono.dev/docs/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)

## Related Guides

- [LLM Observability](../../../guides/ai-observability/llm-observability.md) -
  Comprehensive GenAI observability guide
- [LangGraph Instrumentation](./langgraph.md) - Python agent pipeline
  instrumentation
- [LlamaIndex Instrumentation](./llamaindex.md) - Python structured output
  instrumentation
- [Node.js Auto-Instrumentation](./nodejs.md) - Node.js-specific setup
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector deployment
