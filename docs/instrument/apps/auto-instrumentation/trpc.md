---
title: tRPC OpenTelemetry Instrumentation - Prisma & PostgreSQL Tracing
sidebar_label: tRPC
sidebar_position: 15
description:
  Instrument tRPC with OpenTelemetry NodeSDK, Prisma auto-tracing,
  and Pino structured logging. Full distributed tracing across
  microservices with PostgreSQL query visibility.
keywords:
  [
    trpc opentelemetry instrumentation,
    trpc monitoring,
    trpc apm,
    trpc distributed tracing,
    trpc observability,
    trpc performance monitoring,
    opentelemetry trpc,
    trpc prisma tracing,
    trpc postgres monitoring,
    trpc typescript observability,
    trpc metrics,
    trpc pino logging,
    trpc zod validation,
    prisma opentelemetry,
    trpc production monitoring,
    trpc docker deployment,
    trpc microservices tracing,
    trpc custom instrumentation,
    nodejs trpc observability,
    trpc rest bridge monitoring,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add OpenTelemetry tracing to a tRPC application?","acceptedAnswer":{"@type":"Answer","text":"Create a tracing.ts file that initializes the OpenTelemetry NodeSDK with getNodeAutoInstrumentations() and PrismaInstrumentation, then preload it via node --require ./dist/tracing.js before your server starts."}},{"@type":"Question","name":"Does OpenTelemetry automatically trace Prisma queries in tRPC?","acceptedAnswer":{"@type":"Answer","text":"Yes. Register PrismaInstrumentation from @prisma/instrumentation in your NodeSDK instrumentations array. All Prisma queries including findMany, create, update, and delete generate spans with query details automatically."}},{"@type":"Question","name":"How does distributed tracing work across tRPC microservices?","acceptedAnswer":{"@type":"Answer","text":"Node.js fetch() is auto-instrumented by OpenTelemetry HTTP instrumentation. When one service calls another via fetch, W3C traceparent headers propagate automatically, linking spans across services into a single trace."}},{"@type":"Question","name":"What is the performance overhead of OpenTelemetry on tRPC?","acceptedAnswer":{"@type":"Answer","text":"Typical overhead is 0.5-2ms per request, 2-5% CPU increase, and 15-30MB additional memory. Using BatchSpanProcessor and excluding health check endpoints keeps impact minimal."}},{"@type":"Question","name":"Can I use tRPC createCallerFactory with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Yes. The createCallerFactory pattern works seamlessly because HTTP instrumentation creates the parent span, and Prisma instrumentation traces database calls within the caller. The full call chain is captured automatically."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"Add OpenTelemetry to tRPC","step":[{"@type":"HowToStep","name":"Install packages","text":"Install @opentelemetry/sdk-node, auto-instrumentations-node, OTLP exporters, and @prisma/instrumentation"},{"@type":"HowToStep","name":"Create tracing.ts","text":"Initialize NodeSDK with PrismaInstrumentation and getNodeAutoInstrumentations()"},{"@type":"HowToStep","name":"Configure Pino logger","text":"Add a mixin that injects trace_id and span_id from the active span context"},{"@type":"HowToStep","name":"Set environment variables","text":"Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, and resource attributes"},{"@type":"HowToStep","name":"Run with preload","text":"Start with node --require ./dist/tracing.js ./dist/server.js to ensure SDK initializes before application code"}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# tRPC

## Introduction

Implement OpenTelemetry instrumentation for tRPC applications to get full
distributed tracing across your TypeScript backend, including Prisma database
queries, inter-service HTTP calls, and structured logging with trace context.
This guide shows you how to instrument a tRPC application using the
OpenTelemetry Node.js SDK with `PrismaInstrumentation` for automatic database
query spans, `getNodeAutoInstrumentations()` for HTTP server and client
tracing, and Pino for structured logs correlated to traces.

tRPC applications benefit from automatic instrumentation of the HTTP layer,
Prisma ORM queries, and outbound `fetch()` calls. With OpenTelemetry, you can
trace requests from the REST API surface through tRPC procedure calls into
Prisma database operations, follow distributed traces across microservices, and
correlate structured logs to specific traces. The `createCallerFactory` pattern
used in tRPC works naturally with OpenTelemetry because the HTTP instrumentation
creates the root span, and Prisma instrumentation captures every downstream
query as a child span.

Whether you're building a new tRPC backend, adding observability to an existing
application, or migrating from DataDog or New Relic to open-source
observability, this guide provides production-ready configurations for tRPC
with Prisma, PostgreSQL, and base14 Scout.

:::tip TL;DR

Create a `tracing.ts` file that initializes `NodeSDK` with
`getNodeAutoInstrumentations()` and `PrismaInstrumentation`, then preload it
via `node --require ./dist/tracing.js`. This single step auto-instruments HTTP
endpoints, Prisma queries, outbound `fetch()` calls, and Pino logs. Set
`OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` to point at your Scout
collector.

:::

## Who This Guide Is For

This documentation is designed for:

- **tRPC developers**: adding observability and distributed tracing to
  type-safe TypeScript APIs for the first time
- **Backend engineers**: running tRPC with Prisma and PostgreSQL who need
  production monitoring and query performance visibility
- **DevOps teams**: deploying tRPC microservices with Docker and needing
  end-to-end trace correlation across services
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-source OpenTelemetry
- **Full-stack developers**: debugging slow Prisma queries, failed procedures,
  or inter-service communication issues in production

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for tRPC applications with Prisma
- Configure automatic tracing for HTTP endpoints and database queries
- Instrument inter-service communication with automatic W3C trace propagation
- Add structured logging with Pino that includes trace context in every log line
- Create custom metrics (counters, histograms) for business-level monitoring
- Map REST endpoints to tRPC procedures using `createCallerFactory`
- Export telemetry data to base14 Scout via OTLP/gRPC
- Deploy instrumented applications with Docker and Docker Compose

### Prerequisites

Before starting, ensure you have:

- **Node.js 24.0.0 or later** installed (Krypton LTS recommended)
- **tRPC 11.x** installed (`@trpc/server`)
- **Prisma 7.x** with the PostgreSQL adapter (`@prisma/adapter-pg`)
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)
- Docker and Docker Compose for running the complete example

### Compatibility Matrix

| Component               | Minimum Version | Recommended Version | Notes                              |
| ----------------------- | --------------- | ------------------- | ---------------------------------- |
| **Node.js**             | 22.0.0          | 24.x LTS            | Krypton - Active until April 2028  |
| **tRPC**                | 11.0.0          | 11.16.0+            | v11 with createCallerFactory       |
| **Prisma**              | 6.0.0           | 7.6.0+              | @prisma/instrumentation required   |
| **TypeScript**          | 5.5.0           | 6.0.2+              | Full type safety                   |
| **OpenTelemetry SDK**   | 0.200.0         | 0.214.0+            | Core SDK for traces and metrics    |
| **Zod**                 | 3.22.0          | 4.3.6+              | Input validation for procedures    |
| **Pino**                | 9.0.0           | 10.3.1+             | Structured logging with OTel mixin |
| **PostgreSQL**          | 15.0            | 18.x                | Primary database                   |
| **OTel Collector**      | 0.100.0         | 0.148.0+            | Receives and forwards telemetry    |

### Instrumented Components

| Component          | Instrumentation Method          | Spans Generated                     |
| ------------------ | ------------------------------- | ----------------------------------- |
| HTTP Server        | `@opentelemetry/instrumentation-http` (auto) | `HTTP GET /api/articles`, `HTTP POST /api/articles` |
| Prisma Queries     | `@prisma/instrumentation` (auto) | `prisma:client:operation`, `prisma:engine:query` |
| HTTP Client (fetch) | `@opentelemetry/instrumentation-http` (auto) | `HTTP POST http://notify:8081/notify` |
| Pino Logs          | `@opentelemetry/instrumentation-pino` (auto) | Log records with trace_id, span_id  |
| Custom Metrics     | `@opentelemetry/api` (manual)   | `articles.created` counter           |

### Example Application

The complete working example is available on GitHub:

[base-14/examples/nodejs/trpc-postgres](https://github.com/base-14/examples/tree/main/nodejs/trpc-postgres)

The example implements a two-service article management API:

- **app** (port 8080) -- tRPC + Prisma + PostgreSQL article CRUD
- **notify** (port 8081) -- notification service receiving events via HTTP

## Installation

### Core Packages

Install the required OpenTelemetry and application packages:

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash
npm install @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @opentelemetry/exporter-logs-otlp-grpc \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @prisma/instrumentation
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash
yarn add @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @opentelemetry/exporter-logs-otlp-grpc \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @prisma/instrumentation
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash
pnpm add @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @opentelemetry/exporter-logs-otlp-grpc \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @prisma/instrumentation
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Application Dependencies

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash
npm install @trpc/server @prisma/client @prisma/adapter-pg zod pino
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash
yarn add @trpc/server @prisma/client @prisma/adapter-pg zod pino
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash
pnpm add @trpc/server @prisma/client @prisma/adapter-pg zod pino
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Dev Dependencies

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash
npm install -D typescript prisma tsx @types/node
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash
yarn add -D typescript prisma tsx @types/node
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash
pnpm add -D typescript prisma tsx @types/node
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Complete package.json

```json title="package.json" showLineNumbers
{
  "name": "trpc-postgres-app",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node --require ./dist/tracing.js ./dist/server.js",
    "dev": "tsx watch src/server.ts"
  },
  "dependencies": {
    "@trpc/server": "^11.16.0",
    "@prisma/client": "^7.6.0",
    "@prisma/adapter-pg": "^7.6.0",
    "@prisma/instrumentation": "^7.6.0",
    "zod": "^4.3.6",
    "@opentelemetry/sdk-node": "^0.214.0",
    "@opentelemetry/api": "^1.9.1",
    "@opentelemetry/auto-instrumentations-node": "^0.72.0",
    "@opentelemetry/exporter-trace-otlp-grpc": "^0.214.0",
    "@opentelemetry/exporter-metrics-otlp-grpc": "^0.214.0",
    "@opentelemetry/exporter-logs-otlp-grpc": "^0.214.0",
    "pino": "^10.3.1"
  },
  "devDependencies": {
    "typescript": "^6.0.2",
    "prisma": "^7.6.0",
    "tsx": "^4.19.0",
    "@types/node": "^24.0.0"
  }
}
```

### Tracing Setup (tracing.ts)

Create `src/tracing.ts` -- this file initializes the OpenTelemetry SDK before
any application code loads. The `--require` flag in the start script ensures
it runs first.

```typescript title="src/tracing.ts" showLineNumbers
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "trpc-articles",
  [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || "1.0.0",
});

const logExporter = new OTLPLogExporter({ url: endpoint });

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({ url: endpoint }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: endpoint }),
    exportIntervalMillis: parseInt(
      process.env.OTEL_METRIC_EXPORT_INTERVAL || "10000"
    ),
  }),
  logRecordProcessors: [new BatchLogRecordProcessor(logExporter)],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingRequestHook: (req) =>
          req.url?.includes("/health") ?? false,
      },
      "@opentelemetry/instrumentation-pino": {
        enabled: true,
      },
    }),
    new PrismaInstrumentation(),
  ],
});

sdk.start();

process.on("SIGTERM", () => {
  sdk.shutdown().then(() => process.exit(0));
});
```

Key details in this setup:

- **`PrismaInstrumentation`** is registered alongside auto-instrumentations so
  every Prisma query generates its own span with operation type and model name
- **`instrumentation-fs` is disabled** to avoid noisy filesystem spans that add
  overhead without useful signal
- **Health check endpoints are excluded** via `ignoreIncomingRequestHook` to
  keep traces focused on real traffic
- **`instrumentation-pino`** is enabled to automatically inject trace context
  into Pino log records
- **SIGTERM handler** flushes pending telemetry before the process exits,
  preventing data loss during container shutdowns

### Prisma Schema

```prisma title="prisma/schema.prisma" showLineNumbers
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Article {
  id        Int      @id @default(autoincrement())
  title     String   @db.VarChar(255)
  body      String   @db.Text
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("articles")
}
```

After defining the schema, generate the Prisma client:

```bash
npx prisma generate
```

## Configuration

### Environment Variables

Configure telemetry behavior through environment variables:

| Variable                        | Description                    | Default                  |
| ------------------------------- | ------------------------------ | ------------------------ |
| `OTEL_SERVICE_NAME`             | Service name in traces         | `trpc-articles`          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | Collector gRPC endpoint        | `http://localhost:4317`  |
| `OTEL_SERVICE_VERSION`          | Service version tag            | `1.0.0`                  |
| `OTEL_METRIC_EXPORT_INTERVAL`  | Metric export interval (ms)    | `10000`                  |
| `OTEL_RESOURCE_ATTRIBUTES`     | Additional resource attributes | --                       |
| `DATABASE_URL`                  | PostgreSQL connection string   | --                       |
| `NOTIFY_URL`                    | Notification service URL       | `http://localhost:8081`  |
| `PORT`                          | HTTP server port               | `8080`                   |
| `LOG_LEVEL`                     | Pino log level                 | `info`                   |

### Pino Logger with Trace Context

Create a shared logger that automatically injects `trace_id` and `span_id`
into every log line. This lets you jump from a log entry in Scout directly
to the trace that produced it.

```typescript title="src/lib/logger.ts" showLineNumbers
import pino from "pino";
import { context, trace } from "@opentelemetry/api";

function getTraceContext() {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  return {
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  mixin() {
    return getTraceContext();
  },
  formatters: {
    level(label) {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
```

The `mixin()` function runs on every log call and pulls the current trace and
span IDs from the active OpenTelemetry context. Combined with
`instrumentation-pino`, this means your logs in Scout are automatically linked
to the request trace that generated them.

### Scout Collector Integration

The OTel Collector sits between your application and base14 Scout. It handles
batching, retry, compression, and OAuth2 authentication.

```yaml title="config/otel-config.yaml" showLineNumbers
extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s
    tls:
      insecure_skip_verify: true
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    limit_mib: 256
    check_interval: 1s
  batch:
    send_batch_size: 1024
    timeout: 5s
  resource:
    attributes:
      - key: deployment.environment
        value: ${env:SCOUT_ENVIRONMENT}
        action: upsert
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*health.*")'
  filter/logs:
    error_mode: ignore
    logs:
      log_record:
        - 'severity_number < SEVERITY_NUMBER_INFO'
  transform/log_severity:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - set(severity_text, "INFO") where severity_number >= SEVERITY_NUMBER_INFO and severity_number < SEVERITY_NUMBER_WARN
          - set(severity_text, "WARN") where severity_number >= SEVERITY_NUMBER_WARN and severity_number < SEVERITY_NUMBER_ERROR
          - set(severity_text, "ERROR") where severity_number >= SEVERITY_NUMBER_ERROR

exporters:
  otlp_http/scout:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
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
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, resource, batch]
      exporters: [otlp_http/scout, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/scout, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, filter/logs, transform/log_severity, resource, batch]
      exporters: [otlp_http/scout, debug]
```

Scout Collector environment variables:

| Variable              | Description                          |
| --------------------- | ------------------------------------ |
| `SCOUT_ENDPOINT`      | base14 Scout OTLP/HTTP endpoint      |
| `SCOUT_CLIENT_ID`     | OAuth2 client ID for authentication  |
| `SCOUT_CLIENT_SECRET` | OAuth2 client secret                 |
| `SCOUT_TOKEN_URL`     | OAuth2 token endpoint URL            |
| `SCOUT_ENVIRONMENT`   | Deployment environment label         |

### Docker Compose

The full stack runs with Docker Compose -- application, notification service,
PostgreSQL, and OTel Collector:

```yaml title="compose.yml" showLineNumbers
services:
  app:
    build: ./app
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      DATABASE_URL: postgresql://postgres:postgres@db:5432/trpc_articles
      NOTIFY_URL: http://notify:8081
      OTEL_SERVICE_NAME: trpc-articles
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: "10000"
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8080/api/health"]
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
      OTEL_SERVICE_NAME: trpc-notify
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: "10000"
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8081/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: trpc_articles
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

## Production Configuration

### Production Environment Variables

For production deployments, set these environment variables:

```bash
OTEL_SERVICE_NAME=trpc-articles
OTEL_SERVICE_VERSION=1.2.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_METRIC_EXPORT_INTERVAL=60000
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=articles,service.instance.id=${HOSTNAME}
DATABASE_URL=postgresql://app_user:secure_password@db-primary:5432/trpc_articles?sslmode=require
NOTIFY_URL=http://notify:8081
LOG_LEVEL=warn
```

In production, increase `OTEL_METRIC_EXPORT_INTERVAL` to `60000` (60 seconds)
to reduce metric export overhead. Set `LOG_LEVEL=warn` to reduce log volume
while still capturing warnings and errors with trace context.

### Dockerfile

Multi-stage build with non-root user for production:

```dockerfile title="app/Dockerfile" showLineNumbers
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma/
RUN npx prisma generate
COPY src ./src/
RUN npm run build

FROM node:24-alpine AS runtime
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
RUN chown -R appuser:appgroup /app
USER appuser
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1
EXPOSE 8080
CMD ["node", "--require", "./dist/tracing.js", "./dist/server.js"]
```

Key details:

- **`--require ./dist/tracing.js`** ensures the OpenTelemetry SDK initializes
  and monkey-patches modules before `server.js` imports them
- **Prisma client is copied** from the builder stage (`node_modules/.prisma`)
  so the runtime stage has the generated client without dev dependencies
- **Non-root user** (`appuser:1001`) runs the application for container security
- **`npm ci --omit=dev`** in the runtime stage excludes TypeScript, tsx, and
  other dev dependencies from the final image

### Multi-Service Distributed Tracing

The notification service demonstrates distributed tracing across services.
When the app service creates an article, it calls the notify service via
`fetch()`. OpenTelemetry's HTTP instrumentation automatically propagates
the W3C `traceparent` header, linking spans across both services into a
single trace.

```typescript title="src/service/notification.ts" showLineNumbers
import logger from "../lib/logger";

const NOTIFY_URL = process.env.NOTIFY_URL || "http://localhost:8081";

export async function notifyArticleCreated(article: {
  id: number;
  title: string;
}) {
  try {
    const res = await fetch(`${NOTIFY_URL}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "article.created",
        article_id: article.id,
        title: article.title,
      }),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, article_id: article.id },
        "Notify service returned non-OK"
      );
    }
  } catch (err) {
    logger.error({ err, article_id: article.id }, "Notify service unreachable");
  }
}
```

No manual context propagation is needed. The `fetch()` call is intercepted
by `@opentelemetry/instrumentation-http`, which injects the `traceparent`
header automatically. The notify service's HTTP instrumentation extracts
it and creates a child span, completing the distributed trace.

## tRPC-Specific Features

### tRPC Router Setup

The tRPC router defines the type-safe API surface. `createCallerFactory`
enables server-side procedure calls from the REST bridge layer:

```typescript title="src/router.ts" showLineNumbers
import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
```

### REST-to-tRPC Bridge

The server maps REST HTTP endpoints to tRPC procedures via
`createCallerFactory`. This pattern lets you expose a conventional REST API
while keeping all business logic in type-safe tRPC procedures. OpenTelemetry
traces the full chain: HTTP request -> tRPC caller -> Prisma query.

```typescript title="src/server.ts (excerpt)" showLineNumbers
import http from "node:http";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { context, trace } from "@opentelemetry/api";
import { router, createCallerFactory } from "./router";
import { createArticleRouter } from "./routes/article";
import { createHealthRouter } from "./routes/health";
import logger from "./lib/logger";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const appRouter = router({
  health: createHealthRouter(prisma),
  article: createArticleRouter(prisma),
});

export type AppRouter = typeof appRouter;

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({});

function getTraceId(): string {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId || "";
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = req.url || "/";
  const path = url.split("?")[0];

  try {
    if (path === "/api/articles" && method === "GET") {
      const query = parseQuery(url);
      const result = await caller.article.list({
        page: query.page ? Number(query.page) : 1,
        per_page: query.per_page ? Number(query.per_page) : 20,
      });
      return json(res, 200, {
        ...result,
        meta: { ...result.meta, trace_id: getTraceId() },
      });
    }

    if (path === "/api/articles" && method === "POST") {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const result = await caller.article.create({
        title: body.title as string,
        body: body.body as string,
      });
      return json(res, 201, {
        ...result,
        meta: { trace_id: getTraceId() },
      });
    }

    json(res, 404, { error: "Not found", meta: { trace_id: getTraceId() } });
  } catch (err: unknown) {
    const trpcErr = err as { code?: string; message?: string };
    if (trpcErr.code === "NOT_FOUND") {
      return json(res, 404, {
        error: trpcErr.message || "Not found",
        meta: { trace_id: getTraceId() },
      });
    }
    logger.error({ err }, "Unhandled error");
    json(res, 500, {
      error: "Internal server error",
      meta: { trace_id: getTraceId() },
    });
  }
});

const PORT = parseInt(process.env.PORT || "8080");
server.listen(PORT, () => {
  logger.info({ port: PORT }, "tRPC articles server started");
});
```

The `getTraceId()` helper extracts the current trace ID from the active span
context and includes it in every API response. This lets clients and
debugging tools correlate a specific response to its trace in Scout.

### Prisma Auto-Tracing

`PrismaInstrumentation` from `@prisma/instrumentation` automatically generates
spans for every Prisma operation. Each span includes:

- **Operation type**: `findMany`, `create`, `update`, `delete`, `$queryRaw`
- **Model name**: `Article`, or raw for `$queryRaw`
- **Duration**: time spent in the Prisma engine and database

These spans appear as children of the HTTP request span, giving you a clear
breakdown of how much time each request spends in the database versus
application logic.

No additional configuration is needed beyond registering
`new PrismaInstrumentation()` in the `instrumentations` array (shown in the
tracing.ts setup above). The instrumentation works with both the standard
Prisma client and the PostgreSQL adapter (`@prisma/adapter-pg`).

### Zod Validation in Procedures

tRPC uses Zod schemas for input validation. When validation fails, tRPC
throws a `BAD_REQUEST` error before the procedure body executes. These
validation failures still appear in traces because the HTTP span captures the
error status code:

```typescript title="src/routes/article.ts (validation example)" showLineNumbers
import { z } from "zod";
import { publicProcedure } from "../router";

const createInput = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
});

const listInput = z.object({
  page: z.coerce.number().min(1).default(1),
  per_page: z.coerce.number().min(1).max(100).default(20),
});
```

Zod validation happens synchronously within the span context, so validation
errors are captured with the correct trace and span IDs in both the HTTP
response and log output.

## Custom Instrumentation

### Custom Metrics (articles.created Counter)

Track business-level metrics alongside traces. The `articles.created` counter
increments each time a new article is persisted:

```typescript title="src/routes/article.ts" showLineNumbers
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PrismaClient } from "@prisma/client";
import { router, publicProcedure } from "../router";
import { metrics } from "@opentelemetry/api";
import logger from "../lib/logger";
import { notifyArticleCreated } from "../service/notification";

const meter = metrics.getMeter("trpc-articles");
const articlesCreatedCounter = meter.createCounter("articles.created", {
  description: "Number of articles created",
});

export function createArticleRouter(prisma: PrismaClient) {
  return router({
    list: publicProcedure
      .input(
        z.object({
          page: z.coerce.number().min(1).default(1),
          per_page: z.coerce.number().min(1).max(100).default(20),
        })
      )
      .query(async ({ input }) => {
        const { page, per_page } = input;
        const skip = (page - 1) * per_page;
        const [articles, total] = await Promise.all([
          prisma.article.findMany({
            skip,
            take: per_page,
            orderBy: { createdAt: "desc" },
          }),
          prisma.article.count(),
        ]);
        logger.info({ page, per_page, total }, "Listed articles");
        return {
          data: articles,
          meta: {
            page,
            per_page,
            total,
            total_pages: Math.ceil(total / per_page),
          },
        };
      }),

    getById: publicProcedure
      .input(z.object({ id: z.coerce.number().int().positive() }))
      .query(async ({ input }) => {
        const article = await prisma.article.findUnique({
          where: { id: input.id },
        });
        if (!article) {
          logger.warn({ article_id: input.id }, "Article not found");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Article ${input.id} not found`,
          });
        }
        return { data: article };
      }),

    create: publicProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          body: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const article = await prisma.article.create({
          data: { title: input.title, body: input.body },
        });
        articlesCreatedCounter.add(1);
        logger.info(
          { article_id: article.id, title: article.title },
          "Article created"
        );
        notifyArticleCreated(article).catch((err) =>
          logger.error({ err }, "Failed to notify")
        );
        return { data: article };
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.coerce.number().int().positive(),
          title: z.string().min(1).max(255).optional(),
          body: z.string().min(1).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const existing = await prisma.article.findUnique({ where: { id } });
        if (!existing) {
          logger.warn({ article_id: id }, "Article not found for update");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Article ${id} not found`,
          });
        }
        const updateData: Record<string, string> = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.body !== undefined) updateData.body = data.body;
        if (Object.keys(updateData).length === 0) {
          return { data: existing };
        }
        const article = await prisma.article.update({
          where: { id },
          data: updateData,
        });
        logger.info({ article_id: id }, "Article updated");
        return { data: article };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.coerce.number().int().positive() }))
      .mutation(async ({ input }) => {
        const existing = await prisma.article.findUnique({
          where: { id: input.id },
        });
        if (!existing) {
          logger.warn({ article_id: input.id }, "Article not found for delete");
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Article ${input.id} not found`,
          });
        }
        await prisma.article.delete({ where: { id: input.id } });
        logger.info({ article_id: input.id }, "Article deleted");
        return null;
      }),
  });
}
```

The counter is created at module scope using `metrics.getMeter()`, not inside
request handlers. This ensures a single counter instance is reused across all
requests rather than being recreated per call.

### Trace ID in API Responses

Every API response includes the trace ID in its `meta` field. This pattern is
shown in the server.ts excerpt above with the `getTraceId()` helper. Clients
can log or display this ID for support workflows -- a user can report a
trace ID, and you can look it up in Scout to see the full request lifecycle.

### Manual Spans

For operations that aren't automatically instrumented, create manual spans:

```typescript title="Manual span example" showLineNumbers
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("trpc-articles");

async function processArticleContent(content: string): Promise<string> {
  return tracer.startActiveSpan("processArticleContent", async (span) => {
    try {
      span.setAttribute("content.length", content.length);
      const processed = content.trim();
      span.setAttribute("content.processed_length", processed.length);
      return processed;
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}
```

Use `startActiveSpan` so the span is set as the active span in the context,
and any child spans (e.g., from Prisma calls inside) are correctly parented.

## Running Your Application

### Development Mode

Run locally with `tsx` for hot-reloading during development:

```bash
export OTEL_SERVICE_NAME=trpc-articles
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trpc_articles

npx tsx watch src/server.ts
```

In development, `tsx` handles the TypeScript compilation. Note that the
`--require` flag is only needed for the compiled `node` command in production.
With `tsx`, the `tracing.ts` module is imported at the top of the module graph
automatically.

### Docker Compose

Start the full stack:

```bash
docker compose up --build
```

This starts all four services:

- **app** on port 8080 (waits for db and otel-collector)
- **notify** on port 8081
- **db** (PostgreSQL 18) on port 5432
- **otel-collector** on ports 4317 (gRPC) and 4318 (HTTP)

To connect to base14 Scout, provide your credentials:

```bash
SCOUT_ENDPOINT=https://your-scout.base14.io \
SCOUT_CLIENT_ID=your-client-id \
SCOUT_CLIENT_SECRET=your-client-secret \
SCOUT_TOKEN_URL=https://auth.base14.io/oauth/token \
SCOUT_ENVIRONMENT=staging \
docker compose up --build
```

### Verification

After the services are running, verify instrumentation is working:

**Create an article:**

```bash
curl -s -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello tRPC", "body": "OpenTelemetry works!"}' | jq .
```

Expected response:

```json
{
  "data": {
    "id": 1,
    "title": "Hello tRPC",
    "body": "OpenTelemetry works!",
    "createdAt": "2026-03-31T12:00:00.000Z",
    "updatedAt": "2026-03-31T12:00:00.000Z"
  },
  "meta": {
    "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
  }
}
```

**List articles:**

```bash
curl -s http://localhost:8080/api/articles | jq .
```

**Check health:**

```bash
curl -s http://localhost:8080/api/health | jq .
```

### Expected Span Hierarchy

After creating an article, you should see this span tree in Scout:

```text
HTTP POST /api/articles (trpc-articles)
├── prisma:client:operation create Article
│   └── prisma:engine:query INSERT INTO "articles" ...
└── HTTP POST http://notify:8081/notify (trpc-articles, outbound)
    └── HTTP POST /notify (trpc-notify, inbound)
```

The distributed trace links the app service's outbound `fetch()` call to the
notify service's inbound HTTP handler, showing the full cross-service flow
in a single trace view.

## Troubleshooting

### Issue: No traces appearing in Scout

**Solutions:**

1. **Verify the collector is reachable from the app container**:

   ```bash
   docker compose exec app wget -q -O- http://otel-collector:4317
   ```

2. **Check that `tracing.ts` loads before `server.ts`** -- the `--require`
   flag in the Dockerfile CMD must point to the compiled `tracing.js`:

   ```dockerfile
   CMD ["node", "--require", "./dist/tracing.js", "./dist/server.js"]
   ```

3. **Enable the debug exporter** temporarily to verify spans are created:

   ```typescript
   import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
   import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

   const sdk = new NodeSDK({
     spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
   });
   ```

### Issue: Prisma queries not generating spans

**Solutions:**

1. **Ensure `@prisma/instrumentation` is installed and registered**:

   ```bash
   npm list @prisma/instrumentation
   ```

   Verify it appears in the `instrumentations` array in `tracing.ts`:

   ```typescript
   instrumentations: [
     getNodeAutoInstrumentations({ /* ... */ }),
     new PrismaInstrumentation(),
   ],
   ```

2. **Regenerate the Prisma client** after installing the instrumentation
   package:

   ```bash
   npx prisma generate
   ```

### Issue: Distributed traces not linking across services

**Solutions:**

1. **Both services must send telemetry to the same collector** -- check
   `OTEL_EXPORTER_OTLP_ENDPOINT` is identical for both `app` and `notify`
   in `compose.yml`.

2. **Verify W3C traceparent propagation** by inspecting outbound headers:

   ```typescript
   const res = await fetch(`${NOTIFY_URL}/notify`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify(payload),
   });
   // OpenTelemetry automatically adds traceparent header
   // Check notify service logs for matching trace_id
   ```

### Issue: Logs missing trace_id and span_id

**Solutions:**

1. **Confirm `instrumentation-pino` is enabled** in the auto-instrumentations
   config:

   ```typescript
   getNodeAutoInstrumentations({
     "@opentelemetry/instrumentation-pino": { enabled: true },
   }),
   ```

2. **Verify the Pino `mixin()` function** calls `trace.getSpan(context.active())`
   -- if the logger is called outside an HTTP request context (e.g., during
   startup), trace_id will be empty, which is expected.

### Issue: High memory usage in production

**Solutions:**

1. **Disable filesystem instrumentation** to reduce span volume:

   ```typescript
   "@opentelemetry/instrumentation-fs": { enabled: false },
   ```

2. **Increase metric export interval** to reduce buffering overhead:

   ```bash
   OTEL_METRIC_EXPORT_INTERVAL=60000
   ```

3. **Configure the collector's memory limiter** to prevent OOM:

   ```yaml
   processors:
     memory_limiter:
       limit_mib: 256
       check_interval: 1s
   ```

## Security Considerations

### SQL Query Obfuscation

Prisma instrumentation captures query information in spans. By default,
`PrismaInstrumentation` does not include raw SQL parameter values in span
attributes. The query text shows the structure (e.g.,
`SELECT * FROM "articles" WHERE "id" = $1`) with parameterized placeholders,
not actual values.

If you use `$queryRaw` with string interpolation (which you should avoid
for SQL injection reasons), the raw query could appear in spans. Always use
parameterized queries:

```typescript
// Safe -- parameters are not included in span attributes
await prisma.$queryRaw`SELECT 1`;

// Safe -- Prisma parameterizes automatically
await prisma.article.findUnique({ where: { id: input.id } });
```

### PII Protection

Avoid setting span attributes that contain personally identifiable
information:

```typescript
// Do not do this
span.setAttribute("user.email", user.email);
span.setAttribute("article.body", articleBody);

// Do this instead
span.setAttribute("user.id", user.id);
span.setAttribute("article.id", article.id);
span.setAttribute("article.title_length", article.title.length);
```

Log statements with PII should be filtered at the collector level using the
`filter/logs` processor, or scrubbed using the `transform` processor before
export.

### Collector Authentication

The collector config uses OAuth2 (`oauth2client` extension) to authenticate
with base14 Scout. Store `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` as
secrets in your deployment platform (e.g., Kubernetes Secrets, Docker Swarm
secrets, or CI/CD environment variables). Never commit these values to source
control.

## Performance Considerations

### Instrumentation Overhead

Typical overhead with the configuration shown in this guide:

| Metric        | Impact                        |
| ------------- | ----------------------------- |
| Latency       | 0.5-2ms per request           |
| CPU           | 2-5% increase                 |
| Memory        | 15-30MB additional            |
| Network       | ~1KB per span (gRPC + gzip)   |

### Reducing Overhead

**Exclude health checks** -- the `ignoreIncomingRequestHook` in tracing.ts
already excludes `/health` endpoints. This prevents high-frequency health
probes from generating spans.

**Disable filesystem instrumentation** -- `@opentelemetry/instrumentation-fs`
is disabled in the example configuration. Node.js makes many filesystem calls
internally (module resolution, config loading), and tracing them adds noise
without actionable signal.

**Batch tuning** -- the collector's `batch` processor is configured with
`send_batch_size: 1024` and `timeout: 5s`. For high-throughput services,
increase the batch size to reduce the number of export calls. For
low-throughput services, decrease the timeout to ensure spans are exported
promptly.

**GZIP compression** -- the collector-to-Scout exporter uses `compression: gzip`
to reduce network bandwidth. This is already configured in the collector config
above. The application-to-collector connection uses gRPC, which handles
compression at the transport level.

## FAQ

### Does tRPC need a special OpenTelemetry instrumentation library?

No. tRPC runs on top of Node.js HTTP, and OpenTelemetry's HTTP instrumentation
traces all incoming requests automatically. The `createCallerFactory` pattern
means tRPC procedures execute within the HTTP span context, so Prisma queries
and other operations are correctly parented without any tRPC-specific library.

### Why use `--require` instead of importing tracing.ts directly?

The `--require` flag ensures `tracing.ts` executes before any other module
loads. OpenTelemetry works by monkey-patching Node.js modules (`http`, `net`,
etc.) at import time. If your server imports `http` before the SDK initializes,
those imports won't be instrumented. `--require` guarantees the SDK patches
modules first.

### Can I use the tRPC HTTP adapter instead of a REST bridge?

Yes. If you use `@trpc/server/adapters/node` or `@trpc/server/adapters/express`,
HTTP instrumentation still creates spans for every request. The tracing setup
in `tracing.ts` does not depend on the REST bridge pattern. However, the
bridge pattern shown here gives you control over URL paths, status codes, and
response formatting.

### How do I trace tRPC subscriptions (WebSocket)?

For WebSocket-based tRPC subscriptions, add `@opentelemetry/instrumentation-ws`
to the instrumentations array. WebSocket frames won't generate per-message
spans by default, but connection establishment and upgrade requests will be
traced.

### What happens if the collector is down?

The OTLP gRPC exporter retries failed exports with exponential backoff. If the
collector remains unreachable, spans accumulate in memory up to the
`maxQueueSize` limit (default 2048). Once the queue is full, new spans are
dropped. The application continues to function normally -- telemetry loss
does not affect request processing.

### How do I add custom attributes to Prisma spans?

`PrismaInstrumentation` does not support custom attribute hooks directly.
Instead, add attributes to the parent span (the HTTP request span) or create
a manual child span around the Prisma call:

```typescript
const tracer = trace.getTracer("trpc-articles");
const article = await tracer.startActiveSpan("findArticle", async (span) => {
  span.setAttribute("article.id", id);
  const result = await prisma.article.findUnique({ where: { id } });
  span.setAttribute("article.found", result !== null);
  span.end();
  return result;
});
```

### How do I correlate logs with traces in Scout?

The Pino logger's `mixin()` function injects `trace_id` and `span_id` into
every log record. When logs are exported to Scout via the OTel Collector's
logs pipeline, Scout automatically links log entries to their parent trace.
You can click from a log entry to see the full trace, or from a trace span
to see all logs emitted during that span.

### Does the notify service need PrismaInstrumentation?

No. The notify service does not use Prisma or a database. It only needs
`getNodeAutoInstrumentations()` to trace inbound HTTP requests and enable
Pino log correlation. This is why the notify service's `tracing.ts` does not
include `PrismaInstrumentation`.

### Can I use OTLP/HTTP instead of OTLP/gRPC?

Yes. Replace the gRPC exporter packages with their HTTP equivalents:

```bash
npm install @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http
```

Update the endpoint to port 4318 and append the signal path:

```typescript
const traceExporter = new OTLPTraceExporter({
  url: "http://otel-collector:4318/v1/traces",
});
```

### How do I add request duration histograms?

Create a histogram using the meter API and record durations in the HTTP
handler:

```typescript
const requestDuration = meter.createHistogram("http.request.duration", {
  description: "HTTP request duration in milliseconds",
  unit: "ms",
});

const start = performance.now();
// ... handle request ...
requestDuration.record(performance.now() - start, {
  "http.method": method,
  "http.route": path,
  "http.status_code": statusCode,
});
```

## What's Next?

### Advanced Topics

- [Node.js Custom Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans, metrics, logs, and advanced instrumentation patterns
- [OpenTelemetry Collector Configuration](../../collector-setup/otel-collector-config.md)
  \- Advanced collector features, processors, and exporters

### base14 Scout Platform Features

- [Creating Alerts with LogX](../../../guides/creating-alerts-with-logx.md) -
  Set up alerts based on traces and metrics
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards for tRPC applications

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment with collector
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production Kubernetes deployment
- [Scout Exporter Configuration](../../collector-setup/scout-exporter.md) -
  Configure authentication and endpoints

## Complete Example

A complete production-ready example with tRPC 11.16, Prisma 7.6, PostgreSQL 18,
TypeScript 6.0, and OpenTelemetry instrumentation is available at:

**GitHub**:
[base-14/examples/nodejs/trpc-postgres](https://github.com/base-14/examples/tree/main/nodejs/trpc-postgres)

**Features**:

- Full auto-instrumentation with NodeSDK and PrismaInstrumentation
- Custom metrics with articles.created counter
- Distributed tracing across two services via fetch()
- Structured logging with Pino and trace context correlation
- REST-to-tRPC bridge with createCallerFactory
- Multi-stage Docker build with non-root user
- PostgreSQL with Prisma adapter and Zod validation
- Graceful shutdown handling

### Project Structure

```text
trpc-postgres/
├── app/
│   ├── src/
│   │   ├── tracing.ts          # OpenTelemetry SDK setup
│   │   ├── server.ts           # HTTP server + REST-to-tRPC bridge
│   │   ├── router.ts           # tRPC router + createCallerFactory
│   │   ├── lib/
│   │   │   └── logger.ts       # Pino with trace context mixin
│   │   ├── routes/
│   │   │   ├── article.ts      # Article CRUD procedures
│   │   │   └── health.ts       # Health check procedure
│   │   └── service/
│   │       └── notification.ts # Notification client (fetch)
│   ├── prisma/
│   │   └── schema.prisma       # Prisma schema
│   ├── Dockerfile              # Multi-stage build
│   ├── package.json
│   └── tsconfig.json
├── notify/
│   ├── src/
│   │   ├── tracing.ts          # OTel SDK (no Prisma)
│   │   └── server.ts           # Notification handler
│   ├── Dockerfile
│   └── package.json
├── config/
│   └── otel-config.yaml        # Collector config with Scout auth
├── db/
│   └── init.sql                # Database initialization
├── compose.yml                 # Full stack orchestration
└── README.md
```

### Running the Example

```bash
git clone https://github.com/base-14/examples.git
cd examples/nodejs/trpc-postgres
docker compose up --build
```

### Testing Commands

```bash
# Health check
curl http://localhost:8080/api/health | jq .

# Create article (generates trace across both services)
curl -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Article", "body": "Content here"}' | jq .

# List articles with pagination
curl "http://localhost:8080/api/articles?page=1&per_page=10" | jq .

# Get single article
curl http://localhost:8080/api/articles/1 | jq .

# Update article
curl -X PUT http://localhost:8080/api/articles/1 \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Title"}' | jq .

# Delete article
curl -X DELETE http://localhost:8080/api/articles/1
```

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [tRPC Documentation](https://trpc.io/docs)
- [Prisma Instrumentation Guide](https://www.prisma.io/docs/orm/prisma-client/observability-and-logging/opentelemetry-tracing)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Pino Logger](https://getpino.io/)

## Related Guides

- [Express.js Instrumentation](./express.md) - Express.js with MongoDB and
  Redis auto-instrumentation
- [NestJS Instrumentation](./nestjs.md) - NestJS with TypeORM and BullMQ
  tracing
- [Node.js Instrumentation](./nodejs.md) - General Node.js OpenTelemetry setup
- [Fastify Instrumentation](./fastify.md) - Fastify framework instrumentation
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
