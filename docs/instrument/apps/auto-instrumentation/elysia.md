---
title: Elysia (Bun) OpenTelemetry Instrumentation - Complete APM Setup Guide
sidebar_label: Elysia
sidebar_position: 16
description:
  Elysia (Bun) OpenTelemetry instrumentation. SDK-based tracing, custom
  metrics, PostgreSQL auto-instrumentation. Export to base14 Scout.
keywords:
  [
    bun opentelemetry,
    elysia monitoring,
    elysia opentelemetry instrumentation,
    elysia apm,
    elysia distributed tracing,
    bun observability,
    elysia performance monitoring,
    opentelemetry elysia typescript,
    elysia telemetry,
    elysia metrics,
    elysia traces,
    elysia postgresql monitoring,
    elysia drizzle tracing,
    elysia production monitoring,
    elysia instrumentation guide,
    bun runtime tracing,
    bun apm,
    elysia bun docker,
    elysia custom spans,
    bun preload opentelemetry,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does OpenTelemetry work with Bun?","acceptedAnswer":{"@type":"Answer","text":"Yes. Bun supports the OpenTelemetry Node.js SDK (@opentelemetry/sdk-node) through its Node.js compatibility layer. Use bun run --preload to load tracing before your app starts. Auto-instrumentation packages that rely on monkey-patching (like getNodeAutoInstrumentations) may not work fully, but targeted instrumentations such as @opentelemetry/instrumentation-pg work correctly."}},{"@type":"Question","name":"Why do I need manual spans in Elysia instead of auto-instrumentation?","acceptedAnswer":{"@type":"Answer","text":"Bun does not use Node.js http module internally, so @opentelemetry/instrumentation-http cannot intercept Elysia's request handling. You create manual spans with tracer.startActiveSpan() using a traced() helper function to wrap route handlers, giving you full control over span names and attributes."}},{"@type":"Question","name":"How do I instrument Drizzle ORM with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Drizzle ORM uses the pg driver under the hood when configured with drizzle-orm/node-postgres. The @opentelemetry/instrumentation-pg package automatically instruments all pg Pool queries, so every Drizzle query generates a database span with no additional code."}},{"@type":"Question","name":"How do I propagate trace context between Bun services?","acceptedAnswer":{"@type":"Answer","text":"Use propagation.inject(context.active(), headers) before outgoing fetch calls to add W3C traceparent headers. On the receiving service, extract with propagation.extract(context.active(), carrier) and pass the returned context to startActiveSpan as the parent context."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"Instrument Elysia (Bun) with OpenTelemetry","description":"Add distributed tracing, metrics, and structured logging to an Elysia application running on Bun using the OpenTelemetry Node.js SDK.","step":[{"@type":"HowToStep","name":"Install OpenTelemetry packages","text":"Add @opentelemetry/sdk-node, OTLP exporters, instrumentation-pg, and api-logs packages with bun add."},{"@type":"HowToStep","name":"Create tracing.ts","text":"Configure NodeSDK with OTLP HTTP exporters, PgInstrumentation, LoggerProvider, and resource attributes."},{"@type":"HowToStep","name":"Preload tracing before app start","text":"Run with bun run --preload ./src/tracing.ts to initialize instrumentation before any imports."},{"@type":"HowToStep","name":"Add manual spans and metrics","text":"Use a traced() helper with tracer.startActiveSpan() to wrap route handlers. Create counters with metrics.getMeter().createCounter()."},{"@type":"HowToStep","name":"Deploy with Docker Compose","text":"Use oven/bun:1.3-alpine base image and configure OTLP endpoint to point at the Scout Collector."}]}
---

# Elysia (Bun)

Implement OpenTelemetry instrumentation for Elysia applications running on
the Bun runtime to enable distributed tracing, custom metrics, and structured
logging. This guide shows you how to use the OpenTelemetry Node.js SDK with
Bun's `--preload` flag, create manual spans for Elysia route handlers,
auto-instrument PostgreSQL queries through Drizzle ORM, and propagate trace
context across services -- all without relying on `getNodeAutoInstrumentations()`.

Elysia on Bun requires a different instrumentation approach than traditional
Node.js frameworks. Because Bun does not use Node's `http` module internally,
HTTP auto-instrumentation cannot intercept Elysia requests. Instead, you create
targeted manual spans with a `traced()` wrapper function and rely on
`@opentelemetry/instrumentation-pg` for automatic database span generation.
The result is a lean, precise instrumentation setup with full control over span
names, attributes, and context propagation.

Whether you're building with Bun for its startup speed, migrating from
Node.js-based frameworks, or evaluating Elysia for a new microservice, this
guide provides production-ready configurations for OpenTelemetry on the Bun
runtime.

:::tip TL;DR

Create a `tracing.ts` file with `NodeSDK` + `PgInstrumentation` +
`LoggerProvider`, preload it with `bun run --preload ./src/tracing.ts`, and
wrap route handlers with a `traced()` helper that calls
`tracer.startActiveSpan()`. Database spans from Drizzle ORM are captured
automatically through the `pg` driver instrumentation.

:::

## Who This Guide Is For

This documentation is designed for:

- **Elysia developers**: adding observability to Bun-based APIs for the
  first time
- **Bun adopters**: navigating the differences between Bun and Node.js
  OpenTelemetry support
- **DevOps engineers**: deploying Elysia/Bun services with production
  monitoring and container orchestration
- **Engineering teams**: migrating from DataDog, New Relic, or other
  commercial APM solutions to open-source observability
- **Backend developers**: debugging performance issues or tracing requests
  across multiple Bun-based microservices

## Overview

This guide demonstrates how to:

- Set up the OpenTelemetry Node.js SDK on the Bun runtime
- Preload instrumentation with `bun run --preload` for early initialization
- Create manual spans for Elysia route handlers using a `traced()` wrapper
- Auto-instrument PostgreSQL queries via `@opentelemetry/instrumentation-pg`
- Build a custom OTel logger with `@opentelemetry/api-logs` and stdout mirror
- Implement custom metrics with `articles.created` counters
- Propagate trace context across services with `propagation.inject/extract`
- Use Elysia's `t.Object()` validation with type-safe request bodies
- Export traces, metrics, and logs to base14 Scout via OTLP HTTP
- Deploy with Docker using `oven/bun:1.3-alpine` base images

### Prerequisites

Before starting, ensure you have:

- **Bun 1.3 or later** installed
- **Elysia 1.4 or later** installed in your project
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component                    | Minimum Version | Recommended Version | Notes                              |
| ---------------------------- | --------------- | ------------------- | ---------------------------------- |
| **Bun**                      | 1.1.0           | 1.3.x               | Node.js compat layer required      |
| **Elysia**                   | 1.0.0           | 1.4.x               | Latest v1 with plugin system       |
| **TypeScript**               | 5.0.0           | 6.0.x               | Bun includes TS transpiler         |
| **OpenTelemetry SDK**        | 0.200.0         | 0.214.0+            | Core SDK for traces/metrics        |
| **@opentelemetry/api-logs**  | 0.200.0         | 0.214.0+            | LogRecord API for structured logs  |
| **instrumentation-pg**       | 0.60.0          | 0.66.0+             | PostgreSQL auto-instrumentation    |
| **PostgreSQL**               | 15.0            | 18.x                | For database instrumentation       |
| **Drizzle ORM**              | 0.40.0          | 0.45.x              | Type-safe SQL via node-postgres    |

### Instrumented Components

| Component        | Method              | What You Get                                  |
| ---------------- | ------------------- | --------------------------------------------- |
| HTTP routes      | Manual spans        | Route-level traces with status codes           |
| PostgreSQL       | Auto (pg driver)    | Query spans with statement and duration        |
| Drizzle ORM      | Auto (via pg)       | All Drizzle queries appear as database spans   |
| Business metrics | Custom counter      | `articles.created` count                       |
| Logging          | OTel LoggerProvider | Structured logs with trace/span correlation    |
| Cross-service    | Manual propagation  | Distributed traces across Bun services         |

### Example Application

The complete working example is available at
[elysia-postgres](https://github.com/base-14/examples/tree/main/bun/elysia-postgres).
It includes two Elysia services (app + notify), PostgreSQL with Drizzle ORM,
and a Scout Collector configuration.

## Installation

### Core Packages

Install the required OpenTelemetry and application packages with Bun:

```bash showLineNumbers
bun add @opentelemetry/api
bun add @opentelemetry/sdk-node
bun add @opentelemetry/sdk-metrics
bun add @opentelemetry/exporter-trace-otlp-http
bun add @opentelemetry/exporter-metrics-otlp-http
bun add @opentelemetry/resources
bun add @opentelemetry/semantic-conventions
bun add @opentelemetry/instrumentation-pg
```

### Logging Packages

```bash showLineNumbers
bun add @opentelemetry/api-logs
bun add @opentelemetry/sdk-logs
bun add @opentelemetry/exporter-logs-otlp-http
```

### Application Packages

```bash showLineNumbers
bun add elysia
bun add drizzle-orm pg
bun add -d drizzle-kit @types/pg typescript
```

:::info Why not `getNodeAutoInstrumentations()`?

Bun's runtime does not use Node.js's internal `http` module for its HTTP
server. The `@opentelemetry/instrumentation-http` package -- which
`getNodeAutoInstrumentations()` relies on -- monkey-patches Node's `http`
module and has no effect on Elysia/Bun request handling. Instead, use targeted
instrumentations like `@opentelemetry/instrumentation-pg` for database spans
and create manual spans for HTTP route handlers.

:::

### Tracing Setup

Create a `tracing.ts` file that initializes the OpenTelemetry SDK, metric
reader, and logger provider. This file runs before your application code
via Bun's `--preload` flag.

```typescript showLineNumbers title="src/tracing.ts"
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "elysia-articles",
  [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? "1.0.0",
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
    exportIntervalMillis: parseInt(
      process.env.OTEL_METRIC_EXPORT_INTERVAL || "10000"
    ),
  }),
  instrumentations: [new PgInstrumentation({ requireParentSpan: true })],
});
sdk.start();

const loggerProvider = new LoggerProvider({
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({ url: `${endpoint}/v1/logs` })
    ),
  ],
});
logs.setGlobalLoggerProvider(loggerProvider);

process.on("SIGTERM", async () => {
  await loggerProvider.shutdown();
  await sdk.shutdown();
  process.exit(0);
});
```

Key details in this setup:

- **OTLP HTTP exporters** with explicit `/v1/traces`, `/v1/metrics`, and
  `/v1/logs` paths -- Bun's fetch-based HTTP client works reliably with HTTP
  exporters (not gRPC)
- **`PgInstrumentation`** with `requireParentSpan: true` so database spans
  only appear within the context of a request span, not from connection pool
  health checks
- **Separate `LoggerProvider`** because the `NodeSDK` `logRecordProcessor`
  option may not initialize correctly on all Bun versions -- setting the global
  logger provider explicitly is more reliable
- **`SIGTERM` handler** for graceful shutdown in containerized deployments

## Configuration

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=elysia-articles
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_METRIC_EXPORT_INTERVAL=10000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/elysia_articles
NOTIFY_URL=http://localhost:8081
PORT=8080
```

### Custom OTel Logger

Instead of using Pino or another logging library, this setup uses the
OpenTelemetry Logs API directly. Every log entry is emitted as an OTel
`LogRecord` with automatic trace correlation, plus a JSON line to stdout
for local debugging.

```typescript showLineNumbers title="src/logger.ts"
import { trace, context as otelContext } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const otelLogger = logs.getLogger("elysia-articles");

type LogAttrs = Record<string, string | number | boolean | undefined>;

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  attrs?: LogAttrs
) {
  const span = trace.getActiveSpan();
  const ctx = span?.spanContext();

  otelLogger.emit({
    severityNumber,
    severityText,
    body: message,
    context: otelContext.active(),
    attributes: {
      ...attrs,
      ...(ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {}),
    },
  });

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: severityText,
    msg: message,
    ...attrs,
    ...(ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {}),
  };
  const line = JSON.stringify(record);
  if (severityNumber >= SeverityNumber.ERROR) {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
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

This approach has two advantages over Pino on Bun: it avoids the
`pino-opentelemetry-transport` worker thread (which has inconsistent behavior
on Bun), and it emits `LogRecord` objects with proper `context` for automatic
trace/span ID correlation in Scout.

### Database with Drizzle ORM

Drizzle ORM uses the `node-postgres` (`pg`) adapter, which means every query
flows through a `pg.Pool` instance. The `PgInstrumentation` in `tracing.ts`
hooks into that pool to generate database spans automatically.

```typescript showLineNumbers title="src/schema.ts"
import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const articles = pgTable("articles", {
  id: serial().primaryKey(),
  title: varchar({ length: 255 }).notNull(),
  body: text().notNull(),
  createdAt: timestamp("created_at", { precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { precision: 3 }).notNull().defaultNow(),
});
```

```typescript showLineNumbers title="src/db.ts"
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
```

Because `tracing.ts` is preloaded before `db.ts` is imported, the `pg` module
is already instrumented when the pool is created. Every Drizzle query --
`db.select()`, `db.insert()`, `db.update()`, `db.delete()` -- produces a
`pg.query` span with the SQL statement and execution time.

### Docker Compose

The full development stack with both Elysia services, PostgreSQL, and the
Scout Collector:

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: ./app
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      DATABASE_URL: postgresql://postgres:postgres@db:5432/elysia_articles
      NOTIFY_URL: http://notify:8081
      OTEL_SERVICE_NAME: elysia-articles
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_METRIC_EXPORT_INTERVAL: "10000"
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:8080/api/health",
        ]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

  notify:
    build: ./notify
    ports:
      - "8081:8081"
    environment:
      PORT: "8081"
      OTEL_SERVICE_NAME: elysia-notify
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_METRIC_EXPORT_INTERVAL: "10000"
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:8081/api/health",
        ]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: elysia_articles
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.148.0
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./config/otel-config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    environment:
      SCOUT_ENDPOINT: ${SCOUT_ENDPOINT:-http://localhost:4318}
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID:-}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET:-}
      SCOUT_TOKEN_URL: ${SCOUT_TOKEN_URL:-http://localhost/token}
      SCOUT_ENVIRONMENT: ${SCOUT_ENVIRONMENT:-development}
    healthcheck:
      test: ["NONE"]

volumes:
  pgdata:
```

### Scout Collector Integration

The collector uses OAuth2 authentication to forward telemetry to Scout. Set
these environment variables before running `docker compose up`:

```bash showLineNumbers
export SCOUT_ENDPOINT=https://your-scout-endpoint.base14.io
export SCOUT_CLIENT_ID=your-client-id
export SCOUT_CLIENT_SECRET=your-client-secret
export SCOUT_TOKEN_URL=https://auth.base14.io/oauth/token
export SCOUT_ENVIRONMENT=production
```

The collector configuration uses the `oauth2client` extension for
authentication, `batch` processor for efficient export, and `memory_limiter`
for safety. Health check spans are filtered out via the `filter/noisy`
processor to reduce noise.

## Production Configuration

### Production Environment Variables

```bash showLineNumbers title=".env.production"
OTEL_SERVICE_NAME=elysia-articles
OTEL_SERVICE_VERSION=1.2.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_METRIC_EXPORT_INTERVAL=60000
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=articles
DATABASE_URL=postgresql://app_user:secure_password@db-primary:5432/articles_prod
NOTIFY_URL=http://notify:8081
PORT=8080
```

In production, increase `OTEL_METRIC_EXPORT_INTERVAL` to `60000` (60 seconds)
to reduce metric export frequency and collector load.

### Dockerfile

Both services use a multi-stage build with `oven/bun:1.3-alpine` for minimal
image size. The `--preload` flag in the `CMD` ensures tracing initializes
before the application.

```dockerfile showLineNumbers title="app/Dockerfile"
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-alpine
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src/
RUN chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1
EXPOSE 8080
CMD ["bun", "run", "--preload", "./src/tracing.ts", "./src/index.ts"]
```

The `oven/bun:1.3-alpine` image is roughly 100MB -- significantly smaller
than most Node.js images. Bun's built-in TypeScript transpiler means no
separate build step is needed.

### Multi-Service Tracing

The example application consists of two Bun services that communicate via
HTTP. Trace context flows from the app service to the notify service through
W3C `traceparent` headers, creating a single distributed trace across both
services.

**Outgoing side** -- inject trace context into fetch headers:

```typescript showLineNumbers title="src/notification.ts"
import { context, propagation } from "@opentelemetry/api";
import { logger } from "./logger";

const notifyUrl = process.env.NOTIFY_URL ?? "http://localhost:8081";

export async function notifyArticleCreated(articleId: number, title: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  propagation.inject(context.active(), headers);

  try {
    const res = await fetch(`${notifyUrl}/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ event: "article.created", article_id: articleId, title }),
    });
    if (!res.ok) {
      logger.warn("Notify service returned non-OK", { status: res.status });
    }
  } catch (err) {
    logger.warn("Notify service unreachable", { error: String(err) });
  }
}
```

`propagation.inject()` writes the `traceparent` and `tracestate` headers into
the plain object. Bun's native `fetch` sends these headers to the downstream
service.

**Incoming side** -- extract trace context and create a child span:

```typescript showLineNumbers title="notify/src/index.ts"
import { Elysia, t } from "elysia";
import { trace, SpanKind, context, propagation } from "@opentelemetry/api";
import { logger } from "./logger";

const tracer = trace.getTracer("elysia-notify");
const PORT = parseInt(process.env.PORT || "8081");

const app = new Elysia()
  .get("/api/health", () => ({ status: "healthy", service: "elysia-notify" }))
  .post("/notify", async ({ body, request }) => {
    const carrier: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      carrier[key] = value;
    });

    const parentCtx = propagation.extract(context.active(), carrier);

    return trace.getTracer("elysia-notify").startActiveSpan(
      "POST /notify",
      { kind: SpanKind.SERVER },
      parentCtx,
      async (span) => {
        logger.info("Notification received", {
          event: String(body.event),
          article_id: Number(body.article_id),
        });
        span.setAttribute("notification.event", String(body.event));
        span.setAttribute("notification.article_id", Number(body.article_id));
        span.end();
        return { status: "received" };
      }
    );
  })
  .listen(PORT);

logger.info("Notify service started", { port: PORT });
```

The notify service converts `request.headers` (a `Headers` object) into a
plain object so `propagation.extract()` can read the `traceparent` header.
The extracted context is passed as the third argument to `startActiveSpan`,
creating a child span that links back to the originating request in the app
service.

## Elysia-Specific Features

### Plugin System

Elysia uses a plugin-based architecture where route groups are defined as
separate `Elysia` instances and composed with `.use()`:

```typescript showLineNumbers title="src/index.ts"
import { Elysia } from "elysia";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { logger } from "./logger";
import { healthRoutes } from "./routes/health";
import { articleRoutes } from "./routes/article";

const tracer = trace.getTracer("elysia-articles");
const PORT = parseInt(process.env.PORT || "8080");

const app = new Elysia()
  .onError(({ code, error, set, request }) => {
    const url = new URL(request.url);
    return tracer.startActiveSpan(
      `${request.method} ${url.pathname}`,
      { kind: SpanKind.SERVER },
      (span) => {
        if (code === "VALIDATION") {
          logger.warn("Validation failed", { path: url.pathname });
          span.setAttribute("http.response.status_code", 422);
          span.setStatus({ code: SpanStatusCode.ERROR, message: "Validation failed" });
          span.end();
          set.status = 422;
          return {
            error: "Validation failed",
            details: error.message,
            meta: { trace_id: span.spanContext().traceId },
          };
        }
        logger.error("Unhandled error", { error: String(error) });
        span.setAttribute("http.response.status_code", 500);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        span.end();
        set.status = 500;
        return {
          error: "Internal server error",
          meta: { trace_id: span.spanContext().traceId },
        };
      }
    );
  })
  .use(healthRoutes)
  .use(articleRoutes)
  .listen(PORT);

logger.info("Elysia articles server started", { port: PORT });
```

The `onError` hook creates a span for every unhandled error, capturing the
HTTP method, path, and status code. Validation errors from Elysia's built-in
`t.Object()` validators return 422 with a trace ID in the response body.

### Type-Safe Routes with Validation

Elysia provides compile-time type inference from runtime validators. When you
define a body schema with `t.Object()`, both request validation and TypeScript
types are derived from a single source:

```typescript showLineNumbers
.post(
  "/",
  async ({ body, set }) =>
    traced("POST /api/articles", set, async () => {
      const [article] = await db
        .insert(articles)
        .values({ title: body.title, body: body.body })
        .returning();
      // body.title and body.body are type-checked at compile time
      set.status = 201;
      return { data: article, meta: { trace_id: getTraceId() } };
    }),
  {
    body: t.Object({
      title: t.String({ minLength: 1 }),
      body: t.String({ minLength: 1 }),
    }),
  }
)
```

If validation fails, Elysia throws a `VALIDATION` error that the `onError`
hook captures and wraps in a span (see above).

### The `traced()` Wrapper Pattern

Since Elysia on Bun cannot use HTTP auto-instrumentation, every route handler
is wrapped with a `traced()` function that manages span lifecycle:

```typescript showLineNumbers title="src/routes/article.ts"
const tracer = trace.getTracer("elysia-articles");

function traced<T>(
  name: string,
  set: { status?: number | string },
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.SERVER }, async (span) => {
    try {
      const result = await fn();
      const status = typeof set.status === "number" ? set.status : 200;
      span.setAttribute("http.response.status_code", status);
      if (status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      return result;
    } catch (err) {
      span.setAttribute("http.response.status_code", 500);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.end();
      throw err;
    }
  });
}
```

This wrapper:

- Creates a `SERVER` span with the route name (e.g., `GET /api/articles`)
- Reads the response status code from Elysia's `set` object after the
  handler completes
- Marks spans as `ERROR` for 4xx and 5xx responses
- Ensures `span.end()` is called in both success and error paths
- Propagates the active context so that database queries within `fn()`
  become child spans

### Drizzle ORM Auto-Tracing via PgInstrumentation

Because Drizzle ORM uses the `pg` driver internally, all database operations
are automatically instrumented. A single route handler like this:

```typescript showLineNumbers
const [rows, [{ total }]] = await Promise.all([
  db
    .select()
    .from(articles)
    .orderBy(desc(articles.createdAt))
    .limit(perPage)
    .offset(offset),
  db.select({ total: count() }).from(articles),
]);
```

Generates a span hierarchy like:

```text
GET /api/articles (SERVER)
  ├── pg.query:SELECT (CLIENT) — article rows
  └── pg.query:SELECT (CLIENT) — count query
```

Each `pg.query` span includes the SQL statement (with parameter values
obfuscated by default), execution duration, database name, and host.

### onError Hook

The global `onError` hook ensures that even failed requests produce spans
with meaningful error information:

```typescript showLineNumbers
.onError(({ code, error, set, request }) => {
  const url = new URL(request.url);
  return tracer.startActiveSpan(
    `${request.method} ${url.pathname}`,
    { kind: SpanKind.SERVER },
    (span) => {
      if (code === "VALIDATION") {
        span.setAttribute("http.response.status_code", 422);
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Validation failed" });
        span.end();
        set.status = 422;
        return { error: "Validation failed", details: error.message };
      }
      // ... handle other errors
    }
  );
})
```

Elysia's error codes (`VALIDATION`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR`,
`PARSE`) let you distinguish error types in span attributes for targeted
alerting.

## Custom Instrumentation

### Business Metrics with Counters

Track application-level metrics alongside trace data. The `articles.created`
counter increments every time a new article is successfully inserted:

```typescript showLineNumbers title="src/routes/article.ts"
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("elysia-articles");
const articlesCreated = meter.createCounter("articles.created", {
  description: "Number of articles created",
});

// Inside the POST handler:
const [article] = await db
  .insert(articles)
  .values({ title: body.title, body: body.body })
  .returning();

articlesCreated.add(1);
```

This counter is exported via the `PeriodicExportingMetricReader` configured
in `tracing.ts` and appears in Scout as a time-series metric.

### Trace ID in Responses

Every API response includes a `trace_id` field so callers can reference the
exact trace when reporting issues:

```typescript showLineNumbers
function getTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? "";
}

// Used in responses:
return { data: article, meta: { trace_id: getTraceId() } };
```

This is especially useful during development and debugging -- the trace ID
links directly to the full distributed trace in Scout.

### Manual Spans with startActiveSpan

For operations that need additional detail beyond what `traced()` provides,
create nested spans directly:

```typescript showLineNumbers
import { trace, SpanKind } from "@opentelemetry/api";

const tracer = trace.getTracer("elysia-articles");

async function enrichArticle(articleId: number) {
  return tracer.startActiveSpan(
    "enrichArticle",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      span.setAttribute("article.id", articleId);
      try {
        const result = await performEnrichment(articleId);
        span.end();
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.end();
        throw err;
      }
    }
  );
}
```

When called inside a `traced()` handler, this span becomes a child of the
route span, creating a detailed breakdown of the request processing steps.

### Complete Route Example

Here is the full article routes file with all instrumentation patterns
combined -- the `traced()` wrapper, business counter, trace ID in responses,
type-safe validation, and notification with context propagation:

```typescript showLineNumbers title="src/routes/article.ts"
import { Elysia, t } from "elysia";
import { eq, desc, count, sql } from "drizzle-orm";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { metrics } from "@opentelemetry/api";
import { db } from "../db";
import { articles } from "../schema";
import { logger } from "../logger";
import { notifyArticleCreated } from "../notification";

const tracer = trace.getTracer("elysia-articles");
const meter = metrics.getMeter("elysia-articles");
const articlesCreated = meter.createCounter("articles.created", {
  description: "Number of articles created",
});

function getTraceId(): string {
  return trace.getActiveSpan()?.spanContext().traceId ?? "";
}

function traced<T>(
  name: string,
  set: { status?: number | string },
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { kind: SpanKind.SERVER }, async (span) => {
    try {
      const result = await fn();
      const status = typeof set.status === "number" ? set.status : 200;
      span.setAttribute("http.response.status_code", status);
      if (status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      return result;
    } catch (err) {
      span.setAttribute("http.response.status_code", 500);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.end();
      throw err;
    }
  });
}

export const articleRoutes = new Elysia({ prefix: "/api/articles" })
  .get("/", async ({ query, set }) =>
    traced("GET /api/articles", set, async () => {
      const page = Number(query.page) || 1;
      const perPage = Number(query.per_page) || 20;
      const offset = (page - 1) * perPage;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(articles)
          .orderBy(desc(articles.createdAt))
          .limit(perPage)
          .offset(offset),
        db.select({ total: count() }).from(articles),
      ]);

      logger.info("Listed articles", { page, per_page: perPage, total });
      return {
        data: rows,
        meta: {
          page,
          per_page: perPage,
          total,
          trace_id: getTraceId(),
        },
      };
    })
  )

  .post(
    "/",
    async ({ body, set }) =>
      traced("POST /api/articles", set, async () => {
        const [article] = await db
          .insert(articles)
          .values({ title: body.title, body: body.body })
          .returning();

        articlesCreated.add(1);
        logger.info("Article created", { id: article.id, title: article.title });

        await notifyArticleCreated(article.id, article.title);

        set.status = 201;
        return { data: article, meta: { trace_id: getTraceId() } };
      }),
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        body: t.String({ minLength: 1 }),
      }),
    }
  )

  .get("/:id", async ({ params, set }) =>
    traced("GET /api/articles/:id", set, async () => {
      const id = Number(params.id);
      if (isNaN(id) || !Number.isInteger(id) || id < 1) {
        logger.warn("Invalid article ID format", { raw_id: params.id });
        set.status = 400;
        return {
          error: "Invalid ID format",
          details: "ID must be a positive integer",
          meta: { trace_id: getTraceId() },
        };
      }

      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, id));

      if (!article) {
        logger.warn("Article not found", { id });
        set.status = 404;
        return { error: "Article not found", meta: { trace_id: getTraceId() } };
      }

      return { data: article, meta: { trace_id: getTraceId() } };
    })
  )

  .put(
    "/:id",
    async ({ params, body, set }) =>
      traced("PUT /api/articles/:id", set, async () => {
        const id = Number(params.id);
        if (isNaN(id) || !Number.isInteger(id) || id < 1) {
          set.status = 400;
          return {
            error: "Invalid ID format",
            meta: { trace_id: getTraceId() },
          };
        }

        const updates: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (body.title) updates.title = body.title;
        if (body.body) updates.body = body.body;

        const [article] = await db
          .update(articles)
          .set(updates)
          .where(eq(articles.id, id))
          .returning();

        if (!article) {
          logger.warn("Article not found for update", { id });
          set.status = 404;
          return { error: "Article not found", meta: { trace_id: getTraceId() } };
        }

        logger.info("Article updated", { id });
        return { data: article, meta: { trace_id: getTraceId() } };
      }),
    {
      body: t.Partial(
        t.Object({
          title: t.String({ minLength: 1 }),
          body: t.String({ minLength: 1 }),
        })
      ),
    }
  )

  .delete("/:id", async ({ params, set }) =>
    traced("DELETE /api/articles/:id", set, async () => {
      const id = Number(params.id);
      if (isNaN(id) || !Number.isInteger(id) || id < 1) {
        set.status = 400;
        return { error: "Invalid ID format", meta: { trace_id: getTraceId() } };
      }

      const [article] = await db
        .delete(articles)
        .where(eq(articles.id, id))
        .returning();

      if (!article) {
        logger.warn("Article not found for delete", { id });
        set.status = 404;
        return { error: "Article not found", meta: { trace_id: getTraceId() } };
      }

      logger.info("Article deleted", { id });
      set.status = 204;
    })
  );
```

## Running Your Application

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="development" label="Development" default>
```

Start the application in development mode with watch and preload:

```bash showLineNumbers
bun run --watch --preload ./src/tracing.ts ./src/index.ts
```

Or use the `package.json` scripts:

```bash showLineNumbers
bun run dev
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

```bash showLineNumbers
docker compose up --build

docker compose logs -f app notify

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Verification

After starting the application, create an article and verify spans are
generated:

```bash showLineNumbers
curl -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello Elysia", "body": "First post with OpenTelemetry tracing"}'
```

Expected response:

```json
{
  "data": {
    "id": 1,
    "title": "Hello Elysia",
    "body": "First post with OpenTelemetry tracing",
    "createdAt": "2026-03-31T10:00:00.000Z",
    "updatedAt": "2026-03-31T10:00:00.000Z"
  },
  "meta": {
    "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
  }
}
```

The `trace_id` in the response maps to this span hierarchy in Scout:

```text
elysia-articles: POST /api/articles (SERVER, 201)
  ├── pg.query:INSERT (CLIENT) — insert article
  └── elysia-notify: POST /notify (SERVER)
       └── [notification processing]
```

List articles to verify pagination and database spans:

```bash showLineNumbers
curl http://localhost:8080/api/articles?page=1&per_page=10
```

Check the health endpoint:

```bash showLineNumbers
curl http://localhost:8080/api/health
```

## Troubleshooting

### Common Issues

#### Issue: Preload not loading tracing.ts

**Symptoms**: No spans or metrics appear. Application starts normally but
the collector receives no data.

**Solutions:**

1. Verify the `--preload` flag is before the entry point in the command:

   ```bash showLineNumbers
   # Correct
   bun run --preload ./src/tracing.ts ./src/index.ts

   # Wrong — preload after entry point is ignored
   bun run ./src/index.ts --preload ./src/tracing.ts
   ```

2. Check that `tracing.ts` does not import any application modules (it should
   only import `@opentelemetry/*` packages)
3. Confirm the file path is relative to the working directory, not the `src`
   folder

#### Issue: PgInstrumentation not capturing database spans

**Symptoms**: Route spans appear but no `pg.query` child spans.

**Solutions:**

1. Ensure `tracing.ts` is preloaded before `pg` is imported. The
   instrumentation must patch `pg` before any `Pool` or `Client` is created
2. Verify you are using `pg` (node-postgres), not `postgres` (postgres.js) --
   `PgInstrumentation` only supports the `pg` package
3. Check that `requireParentSpan: true` is not filtering out spans -- try
   setting it to `false` temporarily to confirm spans appear

#### Issue: Manual context propagation not linking traces

**Symptoms**: The app service and notify service produce separate, unlinked
traces instead of a single distributed trace.

**Solutions:**

1. Verify `propagation.inject()` is called within an active span context.
   If called outside a `traced()` wrapper, there is no active context to
   propagate
2. On the receiving side, convert `request.headers` to a plain object before
   calling `propagation.extract()` -- the W3C propagator expects a simple
   key-value carrier, not a `Headers` instance
3. Pass the extracted context as the third argument to `startActiveSpan`:

   ```typescript showLineNumbers
   const parentCtx = propagation.extract(context.active(), carrier);
   tracer.startActiveSpan("span-name", { kind: SpanKind.SERVER }, parentCtx, (span) => {
     // ...
   });
   ```

#### Issue: OTLP export failures on Bun

**Symptoms**: Console shows connection errors or timeout warnings from
OTLP exporters.

**Solutions:**

1. Use HTTP exporters (port 4318), not gRPC (port 4317). Bun does not support
   gRPC natively
2. Verify the endpoint URL includes the signal-specific path:
   `http://collector:4318/v1/traces` (not just `http://collector:4318`)
3. Check that the collector is running and reachable from the Bun process.
   In Docker Compose, use the service name as hostname

#### Issue: LoggerProvider not emitting logs

**Symptoms**: Trace and metric data appears in Scout but no log records.

**Solutions:**

1. Ensure `logs.setGlobalLoggerProvider(loggerProvider)` is called in
   `tracing.ts` after creating the `LoggerProvider`
2. Verify the logger calls `otelLogger.emit()` with the `context` field set
   to `otelContext.active()` for trace correlation
3. Check that the log exporter URL ends with `/v1/logs`

### Debug Mode

Enable verbose SDK logging to diagnose initialization issues:

```bash showLineNumbers
OTEL_LOG_LEVEL=debug bun run --preload ./src/tracing.ts ./src/index.ts
```

## Security Considerations

### SQL Query Obfuscation

`PgInstrumentation` obfuscates SQL parameter values by default. Query
statements appear in spans as:

```text
INSERT INTO "articles" ("title", "body") VALUES ($1, $2) RETURNING *
```

Parameter values (`$1`, `$2`) are never captured in span attributes. To
verify this behavior, avoid setting `enhancedDatabaseReporting: true` in
production:

```typescript showLineNumbers
// Safe default — parameter values are obfuscated
new PgInstrumentation({ requireParentSpan: true })

// AVOID in production — captures actual parameter values
new PgInstrumentation({ enhancedDatabaseReporting: true })
```

### PII Protection

Prevent sensitive data from leaking into telemetry:

```typescript showLineNumbers
// BAD: Captures user email in span
span.setAttribute("user.email", email);

// GOOD: Only capture non-sensitive identifiers
span.setAttribute("user.id", userId);
span.setAttribute("user.email_domain", email.split("@")[1]);
```

For the custom OTel logger, be cautious with structured attributes:

```typescript showLineNumbers
// BAD: Logs request body that might contain passwords
logger.info("Request received", { body: JSON.stringify(req.body) });

// GOOD: Log only safe identifiers
logger.info("Article created", { id: article.id, title: article.title });
```

### Compliance Considerations

For GDPR, HIPAA, or PCI-DSS compliance:

- Never log PII in span attributes or log record attributes
- Use pseudonymization for user identifiers when possible
- Configure data retention policies in your observability backend
- Implement attribute filtering at the collector level using the
  `transform` processor

## Performance Considerations

### Bun Runtime Advantages

Bun's startup time is typically 3-5x faster than Node.js, which means the
overhead of preloading `tracing.ts` is minimal -- usually under 100ms.
The OpenTelemetry SDK initialization adds roughly 50-80ms to cold start,
compared to 150-300ms on Node.js.

### Expected Impact

| Metric       | Typical Impact | High-Traffic Impact |
| ------------ | -------------- | ------------------- |
| Latency      | +1-2ms         | +2-4ms              |
| CPU overhead | 2-4%           | 4-8%                |
| Memory       | +30-60MB       | +60-120MB           |

Bun's lower baseline memory usage means the absolute overhead of
OpenTelemetry is smaller than on Node.js.

### Batch Export Tuning

The `PeriodicExportingMetricReader` and `BatchLogRecordProcessor` buffer data
before export. Adjust these for your traffic patterns:

```typescript showLineNumbers
// Development: frequent exports for fast feedback
metricReader: new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
  exportIntervalMillis: 10000, // every 10 seconds
}),

// Production: less frequent exports to reduce overhead
metricReader: new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
  exportIntervalMillis: 60000, // every 60 seconds
}),
```

### Skip Health Check Spans

Health check endpoints generate high-volume, low-value spans. The collector
configuration filters these out with the `filter/noisy` processor:

```yaml showLineNumbers
filter/noisy:
  error_mode: ignore
  traces:
    span:
      - 'IsMatch(name, ".*health.*")'
```

This keeps health checks functional for container orchestrators while
preventing span noise in Scout.

## FAQ

### Does OpenTelemetry work with Bun?

Yes. Bun supports the OpenTelemetry Node.js SDK (`@opentelemetry/sdk-node`)
through its Node.js compatibility layer. The `NodeSDK` class, OTLP HTTP
exporters, and targeted instrumentations like `@opentelemetry/instrumentation-pg`
work correctly. However, `getNodeAutoInstrumentations()` does not fully work
because Bun does not use Node's internal `http`, `net`, `dns`, or `fs`
modules for its core operations.

### Why do I need manual spans instead of auto-instrumentation?

Bun's HTTP server does not go through Node.js's `http.createServer()`, so
`@opentelemetry/instrumentation-http` has nothing to patch. The `traced()`
wrapper pattern gives you explicit control over span names (e.g.,
`GET /api/articles/:id` instead of generic `HTTP GET`) and lets you
set response status codes from Elysia's `set` object.

### How does Drizzle ORM get instrumented without explicit setup?

Drizzle ORM with the `drizzle-orm/node-postgres` adapter delegates all SQL
execution to a `pg.Pool` instance. The `PgInstrumentation` patches the `pg`
module at the driver level, so every query that flows through the pool --
whether from Drizzle's query builder, raw SQL, or transactions -- generates
a `pg.query` span automatically.

### How do I propagate trace context between Bun services?

On the sending side, call `propagation.inject(context.active(), headers)`
to write `traceparent` and `tracestate` headers into a plain object, then
pass that object to `fetch`. On the receiving side, extract headers into a
plain object and call `propagation.extract(context.active(), carrier)` to
get the parent context. Pass this context to `startActiveSpan` as the third
argument.

### What is the difference between OTLP HTTP and gRPC on Bun?

Use OTLP HTTP (port 4318). Bun does not have native gRPC support, and the
`@grpc/grpc-js` package has compatibility issues on Bun. HTTP exporters work
reliably with Bun's native `fetch` implementation and support HTTP proxies
and load balancers.

### How do I use Drizzle ORM vs Prisma with OpenTelemetry on Bun?

Drizzle ORM with `node-postgres` works well because `PgInstrumentation`
patches the underlying `pg` driver. Prisma uses its own query engine binary,
which bypasses the `pg` driver entirely -- `PgInstrumentation` cannot capture
Prisma queries. If you use Prisma, you need Prisma's built-in tracing
integration (`previewFeatures = ["tracing"]`) or its OpenTelemetry extension.

### Can I use Pino logging instead of the custom OTel logger?

You can, but the `pino-opentelemetry-transport` package uses Node.js worker
threads, which have inconsistent behavior on Bun. The custom OTel logger
approach in this guide uses `@opentelemetry/api-logs` directly, avoiding
worker threads entirely while providing the same trace correlation and
structured log export.

### How do I add custom attributes to all spans?

Set `OTEL_RESOURCE_ATTRIBUTES` as an environment variable:

```bash showLineNumbers
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=articles
```

These attributes are added to the resource and appear on every span, metric,
and log record exported by the service.

### What happens if the collector is unavailable?

The OTLP HTTP exporters fail silently -- your application continues to handle
requests normally. Spans, metrics, and logs are buffered in memory and dropped
when the buffer is full. When the collector comes back online, new telemetry
data is exported normally. There is no automatic retry of dropped data.

### How do I monitor multiple Elysia services in a single trace?

Each service needs its own `tracing.ts` with a unique `OTEL_SERVICE_NAME`.
Use `propagation.inject()` on outgoing requests and `propagation.extract()`
on incoming requests to link spans across services. The example in this
guide demonstrates this with the `elysia-articles` and `elysia-notify`
services.

## What's Next

### Advanced Topics

- [Express.js Instrumentation](./express.md) - Node.js auto-instrumentation
  patterns for comparison
- [Hono Instrumentation](./hono.md) - Another lightweight framework with
  OpenTelemetry
- [Fastify Instrumentation](./fastify.md) - Plugin-based Node.js framework

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerting for Elysia services
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards for Bun service metrics

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector configuration
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment

## Complete Example

### Project Structure

```text
elysia-postgres/
├── app/
│   ├── src/
│   │   ├── tracing.ts           # OTel SDK initialization (preloaded)
│   │   ├── index.ts             # Elysia app entry point
│   │   ├── logger.ts            # Custom OTel logger with stdout mirror
│   │   ├── db.ts                # Drizzle + pg pool
│   │   ├── schema.ts            # Drizzle table schema
│   │   ├── notification.ts      # Outgoing fetch with propagation.inject
│   │   └── routes/
│   │       ├── article.ts       # Article CRUD with traced() wrapper
│   │       └── health.ts        # Health check endpoint
│   ├── Dockerfile               # oven/bun:1.3-alpine multi-stage
│   ├── package.json
│   └── tsconfig.json
├── notify/
│   ├── src/
│   │   ├── tracing.ts           # OTel SDK for notify service
│   │   ├── index.ts             # Notify service with propagation.extract
│   │   └── logger.ts            # Shared logger pattern
│   ├── Dockerfile
│   └── package.json
├── config/
│   └── otel-config.yaml         # Scout Collector configuration
├── db/
│   └── init.sql                 # PostgreSQL schema
├── compose.yml                  # Full development stack
└── README.md
```

### Running the Example

```bash showLineNumbers
git clone https://github.com/base-14/examples.git
cd examples/bun/elysia-postgres
docker compose up --build
```

### Testing

```bash showLineNumbers
# Create an article
curl -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Article", "body": "Testing OpenTelemetry with Elysia on Bun"}'

# List articles
curl http://localhost:8080/api/articles

# Get a specific article
curl http://localhost:8080/api/articles/1

# Update an article
curl -X PUT http://localhost:8080/api/articles/1 \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Title"}'

# Delete an article
curl -X DELETE http://localhost:8080/api/articles/1

# Health check
curl http://localhost:8080/api/health
```

### Dependencies

```json showLineNumbers title="app/package.json"
{
  "name": "elysia-postgres-app",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "bun run --preload ./src/tracing.ts ./src/index.ts",
    "dev": "bun run --watch --preload ./src/tracing.ts ./src/index.ts"
  },
  "dependencies": {
    "elysia": "^1.4.28",
    "drizzle-orm": "^0.45.2",
    "pg": "^8.20.0",
    "@opentelemetry/api": "^1.9.1",
    "@opentelemetry/api-logs": "^0.214.0",
    "@opentelemetry/sdk-node": "^0.214.0",
    "@opentelemetry/sdk-metrics": "^2.6.1",
    "@opentelemetry/sdk-logs": "^0.214.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.214.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.214.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.214.0",
    "@opentelemetry/instrumentation-pg": "^0.66.0",
    "@opentelemetry/resources": "^2.6.1",
    "@opentelemetry/semantic-conventions": "^1.40.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10",
    "@types/pg": "^8.20.0",
    "typescript": "^6.0.2"
  }
}
```

### GitHub Repository

For the complete working example, see the
[Elysia PostgreSQL Example](https://github.com/base-14/examples/tree/main/bun/elysia-postgres)
repository.

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [Elysia Documentation](https://elysiajs.com/)
- [Bun Documentation](https://bun.sh/docs)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [@opentelemetry/instrumentation-pg](https://www.npmjs.com/package/@opentelemetry/instrumentation-pg)
- [OpenTelemetry Logs API](https://opentelemetry.io/docs/specs/otel/logs/)

## Related Guides

- [Express.js Instrumentation](./express.md) - Classic Node.js framework
- [Hono Instrumentation](./hono.md) - Lightweight Node.js/Bun framework
- [Node.js Instrumentation](./nodejs.md) - Generic Node.js setup
- [Fastify Instrumentation](./fastify.md) - Plugin-based Node.js framework
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector configuration
