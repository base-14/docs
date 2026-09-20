---
title:
  Vercel AI SDK OpenTelemetry Instrumentation - AI Pipeline Monitoring
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

The Vercel AI SDK is a TypeScript toolkit for LLM applications. For Python
alternatives, see [LangGraph](./langgraph.md) and [LlamaIndex](./llamaindex.md).

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

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

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

- **Bun 1.3 or later** installed.
- **Ollama** running locally with `qwen3.5:9B` and `embeddinggemma` pulled.
  Ollama is the default provider and needs no API key; Anthropic and Google
  are opt-in through `LLM_PROVIDER` and their own keys.
- **`OLLAMA_CONTEXT_LENGTH=32768` set on the Ollama daemon.** Ollama serves a
  4096-token context by default and the extract and score stages run past it,
  so the answer comes back cut off mid-JSON. The daemon reads this at startup,
  not the application, so set it where the daemon starts
  (`launchctl setenv OLLAMA_CONTEXT_LENGTH 32768` for a Homebrew service or
  the macOS app, an `Environment=` drop-in for systemd) and confirm it with
  `ollama ps`, which prints a CONTEXT column.
- **Scout Collector** configured and accessible.
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development.
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics).
- Familiarity with Vercel AI SDK's `generateText` / `generateObject` APIs.

### Compatibility Matrix

| Component | Minimum Version | Pinned in the example |
| --- | --- | --- |
| Bun | 1.3 | 1.3.9 |
| ai (Vercel AI SDK) | 6.0 | 6.0.286 |
| @ai-sdk/provider | 3.0 | 3.0.16 |
| @ai-sdk/anthropic | 3.0 | 3.0.118 |
| @ai-sdk/google | 3.0 | 3.0.124 |
| @ai-sdk/openai | 3.0 | 3.0.114 |
| Hono | 4.0 | 4.13.8 |
| @opentelemetry/api | 1.9 | 1.9.1 |
| @opentelemetry/sdk-node | 0.222 | 0.222.0 |
| @opentelemetry/instrumentation-pg | 0.74 | 0.74.0 |
| pg | 8.0 | 8.23.0 |
| Zod | 4.0 | 4.6.5 |
| OTel Collector contrib | 0.158.0 | 0.158.0 |

## Installation

```bash showLineNumbers title="Terminal"
bun add \
  ai @ai-sdk/provider \
  @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-logs \
  @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/instrumentation-pg \
  hono pg pgvector pdf-parse zod
```

`@ai-sdk/openai` covers two providers. It supplies OpenAI embeddings, and it
also reaches Ollama, which speaks the OpenAI wire protocol at `/v1`. Pin every
version rather than using a range, so a rebuild resolves the same tree.

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
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
      }),
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
import { flattenError, z } from "zod";

const ConfigSchema = z
  .object({
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
    llmProvider: z.enum(["anthropic", "google", "ollama"]).default("ollama"),
    embeddingProvider: z.enum(["openai", "ollama", "google"]).default("ollama"),
    ollamaBaseUrl: z.string().default("http://localhost:11434"),
    llmModelCapable: z.string().optional(),
    llmModelFast: z.string().optional(),
    llmProviderFallback: z.enum(["anthropic", "google", "ollama"]).optional(),
    llmModelFallback: z.string().optional(),
    embeddingModel: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.llmProvider === "anthropic" && !data.anthropicApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
        path: ["anthropicApiKey"],
      });
    }
    // ... the same check for google and for EMBEDDING_PROVIDER=openai|google
  });

// compose forwards an unset optional variable as "" (`${VAR:-}`), which an enum
// rejects and a default does not replace. Treat blank as absent.
const env = (value: string | undefined): string | undefined => value || undefined;

const parsed = ConfigSchema.safeParse({
  port: env(Bun.env.PORT),
  databaseUrl: Bun.env.DATABASE_URL,
  anthropicApiKey: env(Bun.env.ANTHROPIC_API_KEY),
  openaiApiKey: env(Bun.env.OPENAI_API_KEY),
  googleApiKey: env(Bun.env.GOOGLE_GENERATIVE_AI_API_KEY),
  otelServiceName: env(Bun.env.OTEL_SERVICE_NAME),
  otelExporterEndpoint: env(Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT),
  otelEnabled: env(Bun.env.OTEL_ENABLED),
  llmProvider: env(Bun.env.LLM_PROVIDER),
  embeddingProvider: env(Bun.env.EMBEDDING_PROVIDER),
  ollamaBaseUrl: env(Bun.env.OLLAMA_BASE_URL),
  llmModelCapable: env(Bun.env.LLM_MODEL_CAPABLE),
  llmModelFast: env(Bun.env.LLM_MODEL_FAST),
  llmProviderFallback: env(Bun.env.FALLBACK_PROVIDER),
  llmModelFallback: env(Bun.env.FALLBACK_MODEL),
  embeddingModel: env(Bun.env.EMBEDDING_MODEL),
});

if (!parsed.success) {
  console.error("Configuration error:", flattenError(parsed.error).fieldErrors);
  throw new Error("Invalid configuration - check environment variables");
}

export const config = parsed.data;
```

Both providers default to `ollama`, so the application starts with no API key
at all. `superRefine` only demands a key once you switch `LLM_PROVIDER` or
`EMBEDDING_PROVIDER` to a hosted provider. The `env()` helper exists because
Docker Compose passes an unset variable through as an empty string, which a
Zod enum rejects and a `.default()` does not replace.

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

For container deployments where configuration is managed externally:

```bash showLineNumbers title=".env.example"
# Application
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/contract_analyzer

# LLM provider: ollama (default) | anthropic | google
LLM_PROVIDER=ollama
# Embedding provider: ollama (default) | openai | google
EMBEDDING_PROVIDER=ollama

# Optional: the provider to switch to when the primary exhausts its retries.
# FALLBACK_PROVIDER=ollama
# FALLBACK_MODEL=qwen3.5:9B

# API keys, required only for the active provider
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
OPENAI_API_KEY=

# From a container use http://host.docker.internal:11434
OLLAMA_BASE_URL=http://localhost:11434
# Read by the Ollama daemon at startup, not by this app. See Prerequisites.
OLLAMA_CONTEXT_LENGTH=32768

LLM_MODEL_CAPABLE=qwen3.5:9B
LLM_MODEL_FAST=qwen3.5:9B
EMBEDDING_MODEL=embeddinggemma

# OpenTelemetry
OTEL_SERVICE_NAME=ai-contract-analyzer
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_ENABLED=true
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# Prompts and completions stay out of telemetry unless this is true.
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false

# Base14 Scout (OTel Collector)
SCOUT_CLIENT_ID=
SCOUT_CLIENT_SECRET=
SCOUT_TOKEN_URL=
SCOUT_ENDPOINT=
SCOUT_ENVIRONMENT=
```

Copy this to `.env` and it runs against a local Ollama with no key. The Zod
`ConfigSchema` reads every variable listed here (see the Zod Config tab). The
Scout credentials ship blank; paste your own before the collector can export.

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

```yaml showLineNumbers title="compose.yaml"
services:
  app:
    build:
      context: .
      # _shared/pricing.json sits at the repo root, outside this directory, so
      # a named context carries just that directory in.
      additional_contexts:
        shared: ../../_shared
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/contract_analyzer
      - OTEL_SERVICE_NAME=ai-contract-analyzer
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_ENABLED=true
      - OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
      - OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
      - LLM_PROVIDER=${LLM_PROVIDER:-ollama}
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-ollama}
      - LLM_MODEL_CAPABLE=${LLM_MODEL_CAPABLE:-qwen3.5:9B}
      - LLM_MODEL_FAST=${LLM_MODEL_FAST:-qwen3.5:9B}
      - EMBEDDING_MODEL=${EMBEDDING_MODEL:-embeddinggemma}
      - FALLBACK_PROVIDER=${FALLBACK_PROVIDER:-}
      - FALLBACK_MODEL=${FALLBACK_MODEL:-}
      # Ollama runs on the host by default, so the container reaches it through
      # host.docker.internal. The `ollama` profile below runs it in Compose.
      - OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY:-}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
      - PORT=3000
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./data:/app/data
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
      start_period: 30s

  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_DB: contract_analyzer
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5434:5432"
    volumes:
      - postgres_data:/var/lib/postgresql
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./config/otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
      - "55679:55679"
    environment:
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-unset}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-unset}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-https://collector.base14.io}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy

  ollama:
    image: ollama/ollama:latest
    profiles: [ollama]
    ports:
      - "11434:11434"
    environment:
      # Ollama defaults to a 4096-token context, which is too small for the
      # extract and score stages.
      - OLLAMA_CONTEXT_LENGTH=${OLLAMA_CONTEXT_LENGTH:-32768}
    volumes:
      - ollama_data:/root/.ollama

volumes:
  postgres_data:
  ollama_data:
```

The `ollama` service sits behind a profile. With the profile off,
`docker compose up -d` leaves it out and the app reaches the Ollama you
already run on the host through `host.docker.internal`, which `extra_hosts`
maps to the host gateway. To run Ollama in Compose instead, start it with
`docker compose --profile ollama up -d` and pull the two models into the
container:

```bash showLineNumbers
docker compose exec ollama ollama pull qwen3.5:9B
docker compose exec ollama ollama pull embeddinggemma
```

### Dockerfile

```dockerfile showLineNumbers title="Dockerfile"
FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.9-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache curl && \
    addgroup --system --gid 1001 analyzer && \
    adduser --system --uid 1001 --ingroup analyzer analyzer

COPY --from=deps --chown=analyzer:analyzer /app/node_modules ./node_modules
COPY --chown=analyzer:analyzer package.json tsconfig.json ./
COPY --chown=analyzer:analyzer src ./src

# src/llm/pricing.ts resolves the price table four levels up from
# /app/src/llm/pricing.ts, which is /_shared/pricing.json in this image. It
# comes from the `shared` named build context because the repo root is outside
# the build context.
COPY --from=shared --chown=analyzer:analyzer pricing.json /_shared/pricing.json

ENV NODE_ENV=production

USER analyzer

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "--preload", "./src/telemetry.ts", "src/index.ts"]
```

Three things in this Dockerfile matter for the running container. The
`--preload ./src/telemetry.ts` flag makes OpenTelemetry initialise before any
application code runs, which `PgInstrumentation` needs so it can patch the
`pg` module before it is first imported. The image runs as the unprivileged
`analyzer` user, not root. And `_shared/pricing.json` is copied from a named
build context, because the price table is shared across every example in the
repo and lives above this directory.

## Framework-Specific Features

This section covers Vercel AI SDK-specific instrumentation patterns that go
beyond generic LLM observability. These patterns give you visibility into the AI
SDK middleware layer - how models are wrapped, how GenAI semantic conventions
are attached, and how multi-stage pipelines are orchestrated.

### GenAI Semantic Convention Middleware

The core instrumentation pattern uses `LanguageModelV3Middleware` to intercept
every `doGenerate` call and attach OpenTelemetry spans with GenAI semantic
convention attributes. This means you instrument once at the middleware level
and every LLM call in your application automatically gets traced. The
`gen_ai.*` attributes below follow the OpenTelemetry GenAI semantic
conventions, which are still in Development status as of September 2026, with
no tagged release, so the names can still change; see
[open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai).

Two small modules sit under the middleware. `src/llm/provider-target.ts`
carries what a span needs to say about where a call went, so the middleware
takes one object per provider instead of a list of strings:

```typescript showLineNumbers title="src/llm/provider-target.ts"
/** Where a provider is reached and what it is called in telemetry. */
export interface ProviderTarget {
  /** `gen_ai.provider.name`. The config key `google` maps to `gcp.gemini` here. */
  semconvName: string;
  serverAddress: string;
  serverPort: number;
}

export interface ModelPricing {
  inputCostPerMToken: number;
  outputCostPerMToken: number;
}
```

`src/llm/instruments.ts` creates each instrument once and exports it. Every
model call, chat or embedding, records into the same six instruments, so a
dashboard sums one series per metric rather than one per module:

```typescript showLineNumbers title="src/llm/instruments.ts"
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("ai-contract-analyzer");

export const tokenUsageHistogram = meter.createHistogram(
  "gen_ai.client.token.usage",
  { description: "Tokens used per model call, split by type", unit: "{token}" },
);

export const opDurationHistogram = meter.createHistogram(
  "gen_ai.client.operation.duration",
  { description: "Wall-clock duration of a GenAI operation", unit: "s" },
);

export const costCounter = meter.createCounter("base14.gen_ai.cost", {
  description: "Cumulative cost of GenAI operations in USD",
  unit: "usd",
});

export const retryCounter = meter.createCounter("base14.gen_ai.retry.count", {
  description: "Retry attempts, excluding the initial attempt",
  unit: "{retry}",
});

export const fallbackCounter = meter.createCounter(
  "base14.gen_ai.fallback.count",
  { description: "Times the fallback provider was triggered", unit: "{fallback}" },
);

export const errorCounter = meter.createCounter("base14.gen_ai.error.count", {
  description: "GenAI call errors by provider and type",
  unit: "{error}",
});
```

The middleware itself opens the span, retries, and records into those
instruments:

```typescript showLineNumbers title="src/llm/middleware.ts"
import type { LanguageModelV3, LanguageModelV3Middleware } from "@ai-sdk/provider";
import { type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { wrapLanguageModel } from "ai";
import {
  costCounter,
  errorCounter,
  fallbackCounter,
  opDurationHistogram,
  retryCounter,
  tokenUsageHistogram,
} from "./instruments.ts";
import type { ModelPricing, ProviderTarget } from "./provider-target.ts";
import { scrubPii } from "./scrub.ts";

const tracer = trace.getTracer("ai-contract-analyzer");

const TRUNCATE_PROMPT = 1_000;
const TRUNCATE_COMPLETION = 2_000;
const TRUNCATE_SYSTEM = 500;

const MAX_RETRIES = 2; // 3 total attempts
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

function scrubAndTruncate(text: string, max: number): string {
  return scrubPii(text).slice(0, max);
}

function errorType(err: unknown): string {
  return (err as Error)?.constructor?.name ?? "UnknownError";
}

export function createSemconvMiddleware(
  target: ProviderTarget,
  pricing?: ModelPricing,
): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, params, model }) {
      const modelId = model.modelId;
      const prompt = extractPromptText(params.prompt);

      // Sampling-relevant attributes are set at span creation.
      const metricAttrs = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": target.semconvName,
        "gen_ai.request.model": modelId,
      };
      const spanAttrs: Record<string, string | number> = {
        ...metricAttrs,
        "server.address": target.serverAddress,
        "server.port": target.serverPort,
      };
      if (params.maxOutputTokens !== undefined)
        spanAttrs["gen_ai.request.max_tokens"] = params.maxOutputTokens;
      if (params.temperature !== undefined)
        spanAttrs["gen_ai.request.temperature"] = params.temperature;

      return tracer.startActiveSpan(
        `chat ${modelId}`,
        { kind: SpanKind.CLIENT, attributes: spanAttrs },
        async (span) => {
          const startMs = Date.now();
          let lastError: Error | undefined;

          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              const result = await doGenerate();

              const inputTokens = result.usage.inputTokens.total ?? 0;
              const outputTokens = result.usage.outputTokens.total ?? 0;

              if (result.response?.modelId)
                span.setAttribute("gen_ai.response.model", result.response.modelId);
              if (result.finishReason)
                span.setAttribute("gen_ai.response.finish_reasons", [
                  result.finishReason.unified,
                ]);
              span.setAttribute("gen_ai.usage.input_tokens", inputTokens);
              span.setAttribute("gen_ai.usage.output_tokens", outputTokens);

              tokenUsageHistogram.record(inputTokens, {
                ...metricAttrs,
                "gen_ai.token.type": "input",
              });
              tokenUsageHistogram.record(outputTokens, {
                ...metricAttrs,
                "gen_ai.token.type": "output",
              });

              const costUsd = pricing
                ? (inputTokens * pricing.inputCostPerMToken +
                    outputTokens * pricing.outputCostPerMToken) /
                  1_000_000
                : 0;
              span.setAttribute("base14.gen_ai.cost_usd", costUsd);
              costCounter.add(costUsd, metricAttrs);

              opDurationHistogram.record((Date.now() - startMs) / 1000, metricAttrs);

              const completionText = result.content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("");
              emitInferenceEvent(span, prompt, completionText);

              span.end();
              return result;
            } catch (err) {
              lastError = err as Error;
              // ... retry branch, shown under Retry and Fallback Instrumentation
            }
          }

          const failure = lastError as Error;
          const type = errorType(failure);

          span.recordException(failure);
          span.setAttribute("error.type", type);
          span.setStatus({ code: SpanStatusCode.ERROR, message: failure.message });

          errorCounter.add(1, {
            "gen_ai.provider.name": target.semconvName,
            "gen_ai.request.model": modelId,
            "error.type": type,
          });
          opDurationHistogram.record((Date.now() - startMs) / 1000, {
            ...metricAttrs,
            "error.type": type,
          });

          emitInferenceEvent(span, prompt, undefined);

          span.end();
          throw failure;
        },
      );
    },
  };
}
```

The span is created with `kind: SpanKind.CLIENT`, and `server.address` and
`server.port` go on at creation time rather than afterwards, because a
sampler only sees the attributes present when the span starts.

The middleware intercepts `wrapGenerate` - the AI SDK's hook that runs around
every `doGenerate()` call. This means structured output (`generateObject`),
plain text (`generateText`), and streaming calls all get instrumented
automatically.

Content capture lives in one helper, `emitInferenceEvent`, so the success and
the failure path emit the same event shape:

```typescript showLineNumbers title="src/llm/middleware.ts"
function contentCaptureEnabled(): boolean {
  return process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === "true";
}

function emitInferenceEvent(
  span: Span,
  prompt: { system: string; user: string },
  completion: string | undefined,
): void {
  if (!contentCaptureEnabled()) return;

  const attributes: Record<string, string> = {
    "gen_ai.input.messages": scrubAndTruncate(prompt.user, TRUNCATE_PROMPT),
  };
  const systemInstructions = scrubAndTruncate(prompt.system, TRUNCATE_SYSTEM);
  if (systemInstructions) attributes["gen_ai.system_instructions"] = systemInstructions;
  if (completion !== undefined) {
    attributes["gen_ai.output.messages"] = scrubAndTruncate(
      completion,
      TRUNCATE_COMPLETION,
    );
  }

  span.addEvent("gen_ai.client.inference.operation.details", attributes);
}
```

`scrubAndTruncate()` scrubs before it slices. Running truncation first can cut
a PII pattern in half, leaving the first digits of a card number or the local
part of an email address in the event; scrubbing the full string first avoids
that. `scrubPii` comes from `src/llm/scrub.ts`, which replaces emails, card
numbers, SSNs, phone numbers and LinkedIn URLs with markers such as `[EMAIL]`.

### Wrapping Models with Semconv Middleware

Apply the middleware to any AI SDK model with a convenience function:

```typescript showLineNumbers title="src/llm/middleware.ts"
export function withSemconv(
  model: LanguageModelV3,
  target: ProviderTarget,
  pricing?: ModelPricing,
): LanguageModelV3 {
  return wrapLanguageModel({ model, middleware: createSemconvMiddleware(target, pricing) });
}
```

### Multi-Provider Support

`src/providers.ts` turns a provider config key into a `ProviderTarget`, so
spans carry the correct `gen_ai.provider.name`, `server.address` and
`server.port`. Ollama is the default for both chat and embeddings:

```typescript showLineNumbers title="src/providers.ts"
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { config } from "./config.ts";
import { withFallback, withSemconv } from "./llm/middleware.ts";
import { modelPricing } from "./llm/pricing.ts";
import type { ModelPricing, ProviderTarget } from "./llm/provider-target.ts";
import { thinkingOff } from "./llm/thinking-off.ts";

export interface ModelDescriptor extends ModelPricing {
  modelId: string;
  model: LanguageModel;
}

type LlmProvider = "anthropic" | "google" | "ollama";

const OLLAMA_CAPABLE_DEFAULT = "qwen3.5:9B";
const OLLAMA_FAST_DEFAULT = "qwen3.5:9B";
const ANTHROPIC_CAPABLE_DEFAULT = "claude-sonnet-4-6";
const GOOGLE_CAPABLE_DEFAULT = "gemini-2.5-flash";

/**
 * Provider config key to telemetry target.
 * The key `google` selects Gemini; its `gen_ai.provider.name` is `gcp.gemini`.
 */
function providerTarget(provider: LlmProvider | "openai"): ProviderTarget {
  switch (provider) {
    case "anthropic":
      return {
        semconvName: "anthropic",
        serverAddress: "api.anthropic.com",
        serverPort: 443,
      };
    case "google":
      return {
        semconvName: "gcp.gemini",
        serverAddress: "generativelanguage.googleapis.com",
        serverPort: 443,
      };
    case "openai":
      return { semconvName: "openai", serverAddress: "api.openai.com", serverPort: 443 };
    case "ollama":
      return {
        semconvName: "ollama",
        serverAddress: new URL(config.ollamaBaseUrl).hostname,
        serverPort: 11434,
      };
  }
}

// Ollama speaks the OpenAI wire protocol at /v1, which is what ai@6 accepts.
function ollamaClient() {
  return createOpenAI({
    baseURL: `${config.ollamaBaseUrl}/v1`,
    apiKey: "ollama",
    fetch: thinkingOff as typeof fetch,
  });
}

function buildRawModel(provider: LlmProvider, modelId: string): LanguageModelV3 {
  if (provider === "google") return google(modelId) as unknown as LanguageModelV3;
  if (provider === "ollama") return ollamaClient()(modelId) as unknown as LanguageModelV3;
  return anthropic(modelId) as unknown as LanguageModelV3;
}

function buildDescriptor(provider: LlmProvider, modelId: string): ModelDescriptor {
  const target = providerTarget(provider);
  const pricing = modelPricing(modelId);
  let model = withSemconv(buildRawModel(provider, modelId), target, pricing);

  if (config.llmProviderFallback && config.llmProviderFallback !== provider) {
    const fallbackProvider = config.llmProviderFallback;
    const fallbackModelId = config.llmModelFallback ?? modelId;
    const fallbackTarget = providerTarget(fallbackProvider);
    const fallback = withSemconv(
      buildRawModel(fallbackProvider, fallbackModelId),
      fallbackTarget,
      modelPricing(fallbackModelId),
    );
    model = withFallback(model, target, fallback, fallbackTarget);
  }

  return { modelId, model: model as unknown as LanguageModel, ...pricing };
}

export function getCapableModel(): ModelDescriptor {
  if (config.llmProvider === "google") {
    return buildDescriptor("google", config.llmModelCapable ?? GOOGLE_CAPABLE_DEFAULT);
  }
  if (config.llmProvider === "ollama") {
    return buildDescriptor("ollama", config.llmModelCapable ?? OLLAMA_CAPABLE_DEFAULT);
  }
  return buildDescriptor("anthropic", config.llmModelCapable ?? ANTHROPIC_CAPABLE_DEFAULT);
}
```

Every model returned by `getCapableModel()` or `getFastModel()` is already
wrapped with the GenAI semconv middleware, and with the fallback middleware
when `FALLBACK_PROVIDER` names a different provider. Call
`generateText()` or `generateObject()` normally - spans are created
automatically.

The `google` config key maps to the semconv value `gcp.gemini`. The key stays
`google` because that is what the reader types into `LLM_PROVIDER`; the value
that reaches telemetry is always `gcp.gemini`.

Ollama needs one extra thing. A reasoning model returns its chain of thought
on a separate channel and leaves the message content empty, so structured
output has nothing to parse. Ollama turns thinking off with
`reasoning_effort: "none"`, but the AI SDK drops that field for any model it
does not class as a reasoning model, so `src/llm/thinking-off.ts` puts it on
the request body in a `fetch` wrapper instead:

```typescript showLineNumbers title="src/llm/thinking-off.ts"
export const thinkingOff: FetchLike = (input, init) => {
  if (typeof init?.body !== "string" || !isChatRequest(input)) return fetch(input, init);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body);
  } catch {
    return fetch(input, init);
  }

  body.reasoning_effort = "none";
  return fetch(input, { ...init, body: JSON.stringify(body) });
};

function isChatRequest(input: string | URL | Request): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.endsWith("/responses") || url.endsWith("/chat/completions");
}
```

Only chat requests are rewritten; the embeddings endpoint has no such field.

Prices come from `_shared/pricing.json` at the repo root, the one table every
example in this repository reads. `src/llm/pricing.ts` loads it once at module
load and normalises the model id before the lookup, because providers return
dated ids such as `claude-sonnet-4-5-20250929` and dash-minor forms such as
`claude-opus-4-6`, while the file keys are dot-form:

```typescript showLineNumbers title="src/llm/pricing.ts"
const MODEL_DATE_SUFFIX = /-\d{8}$/;
const MODEL_MINOR_VERSION = /^(claude-(?:sonnet|opus|haiku))-(\d+)-(\d+)$/;

function normalizeModelId(modelId: string): string {
  return modelId.replace(MODEL_DATE_SUFFIX, "").replace(MODEL_MINOR_VERSION, "$1-$2.$3");
}

export function modelPricing(modelId: string): ModelPricing {
  const price =
    MODEL_PRICING[modelId] ?? MODEL_PRICING[normalizeModelId(modelId)] ?? UNKNOWN_MODEL_PRICING;
  return { inputCostPerMToken: price.input, outputCostPerMToken: price.output };
}
```

A model the file does not list costs zero, which is not an error. A
`base14.gen_ai.cost_usd` of exactly `0` on a trace is a visible signal that
the model is missing from `pricing.json`, rather than a plausible-looking but
wrong number.

### Pipeline Stage Spans

Wrap each pipeline stage in a span to see the full execution flow. Use
`tracer.startActiveSpan` so that LLM calls within a stage become child spans:

```typescript showLineNumbers title="src/pipeline/orchestrator.ts"
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("ai-contract-analyzer");
const meter = metrics.getMeter("ai-contract-analyzer");

const analysisDuration = meter.createHistogram("base14.contract.analysis.duration", {
  description: "Total pipeline duration",
  unit: "s",
});

export async function analyzeContract(file: File, pool: Pool) {
  const startMs = Date.now();

  return tracer.startActiveSpan("analyze_contract", async (rootSpan) => {
    rootSpan.setAttribute("base14.document.filename", file.name);
    rootSpan.setAttribute("base14.document.size_bytes", file.size);

    try {
      // Stage 1: Ingest
      const ingestResult = await tracer.startActiveSpan(
        "pipeline_stage ingest",
        async (span) => {
          span.setAttribute("base14.pipeline.stage", "ingest");
          const result = await ingestDocument(file);
          span.setAttribute("base14.document.page_count", result.page_count);
          span.end();
          return result;
        },
      );

      // Stage 2: Route
      const routeResult = await tracer.startActiveSpan(
        "pipeline_stage route",
        async (span) => {
          span.setAttribute("base14.pipeline.stage", "route");
          const result = await routeDocument(ingestResult.full_text);
          span.setAttribute("base14.route.document_type", result.document_type);
          span.setAttribute("base14.route.complexity", result.complexity);
          span.end();
          return result;
        },
      );

      // Stages 3 & 4: Embed + Extract (concurrent)
      const [, extractResult] = await Promise.all([
        tracer.startActiveSpan("pipeline_stage embed", async (span) => {
          span.setAttribute("base14.pipeline.stage", "embed");
          const result = await embedChunks(ingestResult.chunks);
          span.setAttribute(
            "base14.embedding.chunk_count",
            ingestResult.chunks.length,
          );
          span.end();
          return result;
        }),
        tracer.startActiveSpan("pipeline_stage extract", async (span) => {
          span.setAttribute("base14.pipeline.stage", "extract");
          const result = await extractClauses(ingestResult.full_text);
          span.setAttribute("base14.extraction.clauses_found", result.clauses.length);
          span.end();
          return result;
        }),
      ]);

      // Stage 5: Score
      // Stage 6: Summarize
      // ... (same pattern)

      const durationS = (Date.now() - startMs) / 1000;
      rootSpan.setAttribute("base14.pipeline.status", "complete");
      rootSpan.setAttribute("base14.pipeline.total_stages", 6);
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
POST /api/contracts                               8.2s  [HTTP]
└─ analyze_contract                               8.1s  [orchestrator.ts]
   ├─ pipeline_stage ingest                       0.3s  [orchestrator.ts]
   │  └─ db.query INSERT contracts                5ms   [auto: pg]
   ├─ pipeline_stage route                        1.2s  [orchestrator.ts]
   │  └─ chat qwen3.5:9B                          1.1s  [middleware.ts]
   ├─ pipeline_stage embed                        0.8s  [orchestrator.ts] ─┐
   │  └─ embeddings embeddinggemma                0.7s  [embeddings.ts]   │
   ├─ pipeline_stage extract                      2.4s  [orchestrator.ts] ┘
   │  └─ chat qwen3.5:9B                          2.3s  [middleware.ts]
   ├─ pipeline_stage score                        1.8s  [orchestrator.ts]
   │  └─ chat qwen3.5:9B                          1.7s  [middleware.ts]
   ├─ pipeline_stage summarize                    1.5s  [orchestrator.ts]
   │  └─ chat qwen3.5:9B                          1.4s  [middleware.ts]
   └─ db.query INSERT analyses                    3ms   [auto: pg]
```

The embed and extract stages run concurrently. The `chat` spans come from the
semconv middleware, the `embeddings` span from `src/llm/embeddings.ts`, and
the `db.query` spans from `PgInstrumentation` with no application code at
all. The model names above are the Ollama defaults; switching `LLM_PROVIDER`
changes the model in the span name and the `gen_ai.provider.name` attribute,
and nothing else about the shape of the trace.

The semantic search and per-contract query routes produce a second shape: an
`embeddings embeddinggemma` span for the query text, then a sibling
`retrieval contract_chunks` span for the pgvector lookup, both under the HTTP
span of the route.

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

An unhandled error anywhere in a route reaches Hono's `onError` handler in
`src/index.ts`, which records it on whichever span is active at that point -
in practice the HTTP server span - and returns a 500:

```typescript showLineNumbers title="src/index.ts"
app.onError((err, c) => {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(err);
    span.setAttribute("error.type", err.constructor.name);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  }
  logger.error("Unhandled error", { error: String(err) });
  return c.json({ error: "internal server error" }, 500);
});
```

Without this, a thrown error unwinds past every `startActiveSpan` callback
and the HTTP span ends with an OK status and a 500 body, which is the one
combination a trace search cannot find.

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
logic that deserves visibility. The pgvector lookup is one: it is not a model
call, so no middleware sees it, but it is a GenAI retrieval and the
conventions give it a span name and a `gen_ai.data_source.id`.
`src/llm/retrieval.ts` opens it:

```typescript showLineNumbers title="src/llm/retrieval.ts"
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { type SearchResult, similaritySearch } from "../db/chunks.ts";

const tracer = trace.getTracer("ai-contract-analyzer");

const DATA_SOURCE_ID = "contract_chunks";

export async function retrieveChunks(
  pool: Pool,
  queryEmbedding: number[],
  limit: number,
  contractId?: string,
): Promise<SearchResult[]> {
  return tracer.startActiveSpan(
    `retrieval ${DATA_SOURCE_ID}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": "retrieval",
        "gen_ai.data_source.id": DATA_SOURCE_ID,
        "gen_ai.request.top_k": limit,
      },
    },
    async (span) => {
      try {
        const results = await similaritySearch(pool, queryEmbedding, limit, contractId);
        const scores = results.map((r) => r.similarity);

        span.setAttribute("app.retrieval.chunk_count", results.length);
        if (scores.length > 0) {
          span.setAttribute("app.retrieval.score_min", Math.min(...scores));
          span.setAttribute("app.retrieval.score_max", Math.max(...scores));
        }

        span.end();
        return results;
      } catch (err) {
        span.recordException(err as Error);
        span.setAttribute("error.type", (err as Error)?.constructor?.name ?? "UnknownError");
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.end();
        throw err;
      }
    },
  );
}
```

The span name is `retrieval {data_source_id}` and the kind is CLIENT, the
same as a model call. Match count and score range are application detail, so
they go under `app.retrieval.*` rather than `gen_ai.*`. The `db.query` span
that `PgInstrumentation` creates for the underlying SQL nests inside this one
with no extra work.

### Retry and Fallback Instrumentation

The retry loop lives inside `createSemconvMiddleware`, in the `catch` branch
elided from the block above. Three attempts total, exponential backoff from
1 s to 10 s, and every error is retried:

```typescript showLineNumbers title="src/llm/middleware.ts"
} catch (err) {
  lastError = err as Error;

  if (attempt < MAX_RETRIES) {
    const backoffMs = Math.min(MIN_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    retryCounter.add(1, {
      "gen_ai.provider.name": target.semconvName,
      "gen_ai.request.model": modelId,
      "error.type": errorType(err),
      "base14.retry.attempt": attempt + 1,
    });
    span.addEvent("base14.gen_ai.retry", {
      "base14.retry.attempt": attempt + 1,
      "base14.retry.backoff_ms": backoffMs,
      "error.type": errorType(err),
    });
    await sleep(backoffMs);
  }
}
```

Both the counter and the event carry `error.type` and `base14.retry.attempt`,
so a retry can be attributed to a cause and to a position in the sequence.
Application-specific attributes sit under `base14.`, never under `gen_ai.*`.
The counter fires before each retry, so it counts retries and excludes the
initial attempt. All three attempts happen inside one `chat {model}` span:
the span is the logical call, and the retries are events on it.

### Provider Fallback

When all retries are exhausted for the primary provider, fall back to a
secondary model. `withFallback` takes a `ProviderTarget` for each side,
because the event it records names both:

```typescript showLineNumbers title="src/llm/middleware.ts"
export function withFallback(
  primary: LanguageModelV3,
  primaryTarget: ProviderTarget,
  fallback: LanguageModelV3,
  fallbackTarget: ProviderTarget,
): LanguageModelV3 {
  const fallbackMiddleware: LanguageModelV3Middleware = {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate, params }) {
      try {
        return await doGenerate();
      } catch (err) {
        const attrs = {
          "gen_ai.provider.name": primaryTarget.semconvName,
          "base14.gen_ai.fallback.provider": fallbackTarget.semconvName,
          "error.type": errorType(err),
        };

        const span = trace.getActiveSpan();
        if (span) {
          span.recordException(err as Error);
          span.addEvent("provider_fallback", attrs);
          span.setAttribute("gen_ai.fallback.triggered", true);
        }
        fallbackCounter.add(1, attrs);

        return await fallback.doGenerate(params);
      }
    },
  };

  return wrapLanguageModel({ model: primary, middleware: fallbackMiddleware });
}
```

The switch is non-fatal. The calling span gets a `provider_fallback` event,
`gen_ai.fallback.triggered=true` and the recorded exception, but it is not
marked ERROR, because the request succeeded on the second provider. The
fallback model carries its own semconv middleware, so the failed primary call
and the successful fallback call appear as two `chat {model}` spans with
their own provider attributes, and `base14.gen_ai.fallback.count` carries
both the provider that failed and the one that took over.

### Embedding Metrics

Embedding calls do not go through `LanguageModelV3Middleware`, so
`src/llm/embeddings.ts` opens their span directly. Every embedding in the
application goes through this one function: the pipeline's embed stage, the
semantic search route and the per-contract query route:

```typescript showLineNumbers title="src/llm/embeddings.ts"
export async function embedValues(values: string[]): Promise<EmbedOutcome> {
  const descriptor = getEmbeddingModel();
  const metricAttrs = {
    "gen_ai.operation.name": "embeddings",
    "gen_ai.provider.name": descriptor.target.semconvName,
    "gen_ai.request.model": descriptor.modelId,
  };

  return tracer.startActiveSpan(
    `embeddings ${descriptor.modelId}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        ...metricAttrs,
        "server.address": descriptor.target.serverAddress,
        "server.port": descriptor.target.serverPort,
        "gen_ai.embeddings.dimension.count": descriptor.dimensions,
      },
    },
    async (span) => {
      const startMs = Date.now();
      try {
        const { embeddings, usage } = await embedMany({ model: descriptor.model, values });
        const costUsd = (usage.tokens * descriptor.costPerMToken) / 1_000_000;

        span.setAttribute("gen_ai.usage.input_tokens", usage.tokens);
        span.setAttribute("base14.gen_ai.cost_usd", costUsd);

        tokenUsageHistogram.record(usage.tokens, { ...metricAttrs, "gen_ai.token.type": "input" });
        costCounter.add(costUsd, metricAttrs);
        opDurationHistogram.record((Date.now() - startMs) / 1000, metricAttrs);

        span.end();
        return { embeddings, tokens: usage.tokens, costUsd };
      } catch (err) {
        // ... recordException, error.type, ERROR status, errorCounter, duration
        span.end();
        throw err;
      }
    },
  );
}
```

The span name is `embeddings {model}` and the kind is CLIENT, matching the
chat span. It records into the same instruments from `instruments.ts`, with
`gen_ai.operation.name` set to `embeddings`, so a token or cost query can
either split by operation or sum across both.

### Pipeline-Level Metrics

Record aggregate metrics on the root pipeline span for dashboards and alerting:

```typescript showLineNumbers title="Root span attributes"
rootSpan.setAttribute("base14.pipeline.total_stages", 6);
rootSpan.setAttribute("base14.pipeline.total_tokens", totalTokens);
rootSpan.setAttribute(
  "base14.pipeline.total_cost_usd",
  Math.round(totalCost * 10_000) / 10_000,
);
rootSpan.setAttribute("base14.pipeline.duration_ms", totalDurationMs);
rootSpan.setAttribute("base14.route.document_type", routeResult.document_type);
rootSpan.setAttribute("base14.pipeline.status", "complete");
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
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
LLM_PROVIDER=ollama \
EMBEDDING_PROVIDER=ollama \
OLLAMA_BASE_URL=http://ollama:11434 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
bun run --preload ./src/telemetry.ts src/index.ts
```

To run against a hosted provider instead, set `LLM_PROVIDER=anthropic` with
`ANTHROPIC_API_KEY`, or `LLM_PROVIDER=google` with
`GOOGLE_GENERATIVE_AI_API_KEY`.

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build -d

curl http://localhost:3000/health

# Drive the pipeline and check what reached the collector
./scripts/test-api.sh
./scripts/verify-scout.sh

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verify Telemetry Is Working

`scripts/verify-scout.sh` is the fastest check. It confirms the app and the
collector are up, drives one contract through the pipeline, then greps the
collector's debug output for each span, attribute and metric this guide
describes - `chat {model}`, `embeddings {model}`,
`retrieval contract_chunks`, CLIENT span kind, `gen_ai.provider.name`,
`base14.gen_ai.cost_usd`, the four `base14.gen_ai.*` metrics - and prints a
PASS or FAIL line for each:

```bash showLineNumbers
./scripts/verify-scout.sh
```

The manual equivalents:

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

- **Scrub, then truncate** - `scrubAndTruncate()` runs `scrubPii` from
  `src/llm/scrub.ts` over the full string first, then slices user messages to
  1,000 characters, system instructions to 500 and completions to 2,000,
  before writing them to the
  `gen_ai.client.inference.operation.details` event.
- **Never record raw API keys** in span attributes - the Zod config validates
  that the active provider's key is present but never logs its value.
- **Content capture is off by default** - the middleware only adds the
  `gen_ai.client.inference.operation.details` event when
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` is set. Leave it
  unset in production if compliance requires it.
- **Run the container as a non-root user** - the Dockerfile creates the
  `analyzer` user and switches to it before the entrypoint.

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

| Metric | Typical Impact |
| --- | --- |
| Span creation overhead | &lt; 0.05 ms per span |
| CPU overhead | &lt; 0.5% |
| Memory (OTel SDK) | ~5-10 MB |
| Network (batch export) | ~50 KB/min |

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

Always scrub and truncate prompts and completions:

```typescript showLineNumbers
scrubAndTruncate(prompt.user, TRUNCATE_PROMPT); // 1,000 chars max
scrubAndTruncate(completion, TRUNCATE_COMPLETION); // 2,000 chars max
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

Use the `base14.gen_ai.cost` counter from `src/llm/instruments.ts`, which
carries `gen_ai.operation.name`, `gen_ai.provider.name` and
`gen_ai.request.model`. Rates come from `_shared/pricing.json` through
`modelPricing()` in `src/llm/pricing.ts`, so adding a model means adding a
row to that file, not editing code. This enables
`sum(base14.gen_ai.cost) by (gen_ai.provider.name)` in dashboards.

### Can I see prompts and completions in traces?

Yes, when you opt in. Set
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` and the middleware
adds one `gen_ai.client.inference.operation.details` event per call, carrying
truncated `gen_ai.input.messages` and `gen_ai.output.messages`. The event is
disabled by default, so leave the variable unset in production if compliance
requires it.

### How do I add OpenAI, Anthropic, or other providers to Vercel AI SDK?

Add the provider SDK package (for example `@ai-sdk/mistral`), add a case to
`providerTarget()` in `src/providers.ts` returning its `semconvName`,
`serverAddress` and `serverPort`, add the model's rates to
`_shared/pricing.json`, add the key to the `llmProvider` enum in
`src/config.ts`, and create a case in `buildRawModel`. The semconv middleware
wraps it automatically.

### How does LLM provider fallback appear in OpenTelemetry traces?

Set `FALLBACK_PROVIDER` to a provider other than the primary and
`buildDescriptor()` wraps the model in `withFallback`. When all retries are
exhausted for the primary model, that middleware records a
`provider_fallback` event with `base14.gen_ai.fallback.provider`, sets
`gen_ai.fallback.triggered=true` on the calling span, increments
`base14.gen_ai.fallback.count`, and calls the secondary model's
`doGenerate` directly. The secondary model has its own semconv wrapper, so
the failed primary and the successful fallback appear as two `chat {model}`
spans. The calling span keeps its OK status, because the request succeeded.

### Can I use this with Next.js instead of Hono?

Yes. The `LanguageModelV3Middleware` pattern works with any framework. Replace
the Hono HTTP metrics middleware with Next.js middleware and configure the
telemetry module as a Node.js `--require` flag instead of Bun `--preload`. The
SDK's client hooks (`useChat`, `useCompletion`) run in the browser - to trace
those alongside the server spans, add the browser SDK from the
[Next.js browser section](./nextjs.md#browser--client-side-instrumentation).

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

### Related Guides

- [Next.js Instrumentation](./nextjs-scout.md) - Common host for AI SDK applications
- [Node.js Custom Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans and advanced patterns
- [All framework guides](/instrument/apps/auto-instrumentation/) -
  Auto-instrumentation overview for every language

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
│   ├── index.ts                # Hono app entry point, onError handler
│   ├── config.ts               # Zod config validation
│   ├── telemetry.ts            # OTel initialization (preload)
│   ├── logger.ts               # Log correlation with trace context
│   ├── providers.ts            # Multi-provider model factory
│   ├── llm/
│   │   ├── middleware.ts       # GenAI semconv middleware, retry, fallback
│   │   ├── instruments.ts      # The six shared metric instruments
│   │   ├── provider-target.ts  # Per-provider semconv name and server
│   │   ├── embeddings.ts       # embeddings {model} CLIENT span
│   │   ├── retrieval.ts        # retrieval contract_chunks CLIENT span
│   │   ├── pricing.ts          # _shared/pricing.json lookup
│   │   ├── scrub.ts            # PII scrubbing before content capture
│   │   └── thinking-off.ts     # reasoning_effort: none for Ollama
│   ├── pipeline/
│   │   ├── orchestrator.ts     # Pipeline stage spans
│   │   ├── ingest.ts           # Document ingestion
│   │   ├── route.ts            # Document routing (LLM)
│   │   ├── extract.ts          # Clause extraction (LLM)
│   │   ├── embed.ts            # Embedding generation
│   │   ├── score.ts            # Risk scoring (LLM)
│   │   └── summarize.ts        # Summary generation (LLM)
│   ├── middleware/
│   │   ├── metrics.ts          # HTTP request metrics
│   │   └── tracing.ts          # HTTP server span
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
├── scripts/
│   ├── test-api.sh             # Drives every endpoint
│   └── verify-scout.sh         # Asserts on the collector debug output
├── config/
│   └── otel-collector-config.yaml
├── .env.example
├── compose.yaml
├── Dockerfile
└── package.json
```

### Key Files

| File | Demonstrates |
| --- | --- |
| `telemetry.ts` | OTel setup (traces + metrics + logs) |
| `middleware.ts` | GenAI semconv span, retry, provider fallback |
| `instruments.ts` | One instrument per metric, shared by every call site |
| `embeddings.ts` | `embeddings {model}` CLIENT span |
| `retrieval.ts` | `retrieval contract_chunks` CLIENT span |
| `pricing.ts` | Cost from `_shared/pricing.json` |
| `scrub.ts` | PII scrubbing before content capture |
| `thinking-off.ts` | Turning Ollama reasoning off for structured output |
| `orchestrator.ts` | Pipeline stages, concurrent execution, metrics |
| `providers.ts` | Multi-provider factory with fallback |
| `metrics.ts` | HTTP request duration and count |
| `logger.ts` | Log correlation with trace_id/span_id |
| `config.ts` | Zod-validated environment config |
| `compose.yaml` | Docker deployment with OTel Collector |
| `verify-scout.sh` | End-to-end check of the exported telemetry |

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
