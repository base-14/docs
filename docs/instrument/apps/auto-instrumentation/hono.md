---
title: Hono OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Hono
sidebar_position: 10
description:
  Complete guide to Hono OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with base14 Scout in minutes. Supports Hono 4.x,
  PostgreSQL, Redis, BullMQ background jobs.
keywords:
  [
    hono opentelemetry instrumentation,
    hono monitoring,
    hono apm,
    hono distributed tracing,
    nodejs hono observability,
    hono performance monitoring,
    opentelemetry hono typescript,
    hono telemetry,
    hono metrics,
    hono traces,
    hono postgresql monitoring,
    hono redis instrumentation,
    bullmq opentelemetry,
    hono drizzle tracing,
    hono production monitoring,
    hono instrumentation guide,
    hono 4 monitoring,
    nodejs apm hono,
    hono pino logging,
    hono zod validation,
  ]
---

# Hono

Implement OpenTelemetry instrumentation for Hono applications to enable
comprehensive application performance monitoring (APM), distributed tracing,
and observability. This guide shows you how to auto-instrument your Hono
application to collect traces and metrics from HTTP requests, database queries,
Redis operations, background jobs, and custom business logic using the
OpenTelemetry Node.js SDK with minimal code changes.

Hono applications benefit from automatic instrumentation of HTTP and database
layers, combined with the `@hono/otel` middleware for framework-specific span
generation. With OpenTelemetry, you can monitor production performance, debug
slow requests, trace distributed transactions across microservices, and
identify database query bottlenecks. Hono's lightweight design and middleware
architecture work seamlessly with OpenTelemetry's context propagation,
ensuring accurate parent-child span relationships across async operations
including BullMQ background jobs.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like DataDog or New Relic, or troubleshooting
performance issues in production, this guide provides production-ready
configurations and best practices for Hono OpenTelemetry instrumentation.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Hono applications
- Configure automatic request tracing with `@hono/otel` middleware
- Instrument database operations with PostgreSQL auto-instrumentation
- Implement custom spans for business logic with `startActiveSpan`
- Trace background jobs with BullMQ and propagate context to workers
- Bridge Pino structured logging with OpenTelemetry trace correlation
- Configure Prometheus metrics alongside OpenTelemetry
- Validate request input with Zod via `@hono/zod-validator`
- Export telemetry data to base14 Scout via OTLP HTTP
- Deploy instrumented applications with Docker and Docker Compose

## Who This Guide Is For

This documentation is designed for:

- **Hono developers**: implementing observability and distributed tracing for
  the first time in Node.js applications
- **DevOps engineers**: deploying Hono applications with production monitoring
  requirements and container orchestration
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-source observability
- **Backend developers**: debugging performance issues, slow queries, or async
  operation bottlenecks in Hono services
- **Platform teams**: standardizing observability across multiple Hono
  microservices with consistent instrumentation patterns

## Prerequisites

Before starting, ensure you have:

- **Node.js 24.0.0 or later** installed (latest LTS recommended)
- **Hono 4.0.0 or later** installed in your project
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)
- Access to npm for package installation

### Compatibility Matrix

| Component                 | Minimum Version | Recommended Version | Notes                         |
| ------------------------- | --------------- | ------------------- | ----------------------------- |
| **Node.js**               | 24.0.0          | 24.x LTS            | Latest LTS with ESM support   |
| **Hono**                  | 4.0.0           | 4.11.9+             | Latest v4 with middleware     |
| **TypeScript** (optional) | 5.0.0           | 5.9.3+              | For type safety               |
| **OpenTelemetry SDK**     | 0.200.0         | 0.212.0+            | Core SDK for traces/metrics   |
| **PostgreSQL** (optional) | 15.0            | 18.x                | For database instrumentation  |
| **Redis** (optional)      | 7.0             | 8.x                 | For IORedis instrumentation   |
| **Drizzle ORM** (optional)| 0.40.0          | 0.45.1+             | Type-safe SQL builder         |

### Supported Libraries

OpenTelemetry automatically instruments these commonly used libraries:

- **Web frameworks**: Hono (via @hono/otel), HTTP/HTTPS
- **Databases**: PostgreSQL (pg), MySQL, SQLite
- **Caching**: Redis (IORedis), Memcached
- **Job Queues**: BullMQ
- **HTTP Clients**: fetch, axios, http/https
- **Logging**: Pino (with trace correlation)

## Installation

### Core Packages

Install the required OpenTelemetry packages for Hono instrumentation:

```bash showLineNumbers
npm install @opentelemetry/api
npm install @opentelemetry/sdk-node
npm install @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/exporter-metrics-otlp-http
npm install @opentelemetry/resources
npm install @opentelemetry/semantic-conventions
```

### Hono-Specific Packages

```bash showLineNumbers
npm install @hono/otel
npm install @hono/node-server
npm install @hono/zod-validator
```

### Optional Instrumentation Libraries

```bash showLineNumbers
# Logs export
npm install @opentelemetry/api-logs
npm install @opentelemetry/sdk-logs
npm install @opentelemetry/exporter-logs-otlp-http

# Pino trace correlation
npm install pino pino-opentelemetry-transport

# Prometheus metrics
npm install prom-client
```

## Configuration

Choose the initialization method that best fits your application architecture:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="sdk" label="SDK Module (Recommended)" default>
```

### SDK Configuration File (Recommended)

Create a `telemetry.ts` file that initializes OpenTelemetry before any other
imports. This is the recommended approach for Hono applications.

```typescript showLineNumbers title="src/telemetry.ts"
/**
 * OpenTelemetry instrumentation setup for Hono application.
 *
 * CRITICAL: This file MUST be imported before any other modules
 * to ensure auto-instrumentation captures all dependencies.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const serviceName = process.env.OTEL_SERVICE_NAME || 'hono-postgres-app';
const serviceVersion = process.env.OTEL_SERVICE_VERSION || '1.0.0';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: serviceVersion,
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 60000,
  }),
  logRecordProcessor: new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: `${otlpEndpoint}/v1/logs`,
    })
  ),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          return url === '/health' || url === '/metrics';
        },
      },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('OpenTelemetry SDK shut down'))
    .catch((err) => console.error('Error shutting down SDK', err))
    .finally(() => process.exit(0));
});

export { sdk };
```

Import this file as the first line in your application entry point:

```typescript showLineNumbers title="src/index.ts"
import './telemetry.js';

import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config/index.js';

const start = async () => {
  serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });
  console.log(`Server running at http://${config.host}:${config.port}`);
};

start();
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

### Environment Variables Only

For simpler setups or container deployments:

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=hono-postgres-app
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
```

Then use a minimal telemetry file:

```typescript showLineNumbers title="src/telemetry.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

```mdx-code-block
</TabItem>
<TabItem value="scout" label="Scout Integration">
```

### Scout Collector Integration

Configure for base14 Scout with OAuth2 authentication:

```yaml showLineNumbers title="config/otel-config.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s
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
    timeout: 10s
    send_batch_size: 1024
  resource:
    attributes:
      - key: deployment.environment
        value: ${env:SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
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
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### Docker Deployment

```dockerfile showLineNumbers title="Dockerfile"
# Stage 1: Dependencies
FROM node:24.13.1-alpine3.23 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Stage 2: Builder
FROM node:24.13.1-alpine3.23 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Runtime
FROM node:24.13.1-alpine3.23 AS runtime
WORKDIR /app
RUN apk add --no-cache curl gcompat
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle ./drizzle

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono && \
    chown -R hono:nodejs /app
USER hono
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Docker Compose Configuration

```yaml showLineNumbers title="compose.yml"
services:
  db-migrate:
    build:
      context: .
      target: runtime
    command: ["node", "dist/db/migrate.js"]
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/hono_app
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - app-network

  app:
    build:
      context: .
      target: runtime
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      JWT_SECRET: dev-secret-key-change-in-production-must-be-32-chars
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/hono_app
      REDIS_URL: redis://redis:6379
      OTEL_SERVICE_NAME: hono-postgres-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
    depends_on:
      db-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - app-network

  worker:
    build:
      context: .
      target: runtime
    command: ["node", "dist/jobs/worker.js"]
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/hono_app
      REDIS_URL: redis://redis:6379
      OTEL_SERVICE_NAME: hono-postgres-worker
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
    depends_on:
      db-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    networks:
      - app-network

  postgres:
    image: postgres:18.2-alpine3.23
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hono_app
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  redis:
    image: redis:8.6.0-alpine3.23
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    command: ["--config=/etc/otelcol-config.yaml"]
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    env_file:
      - path: .env
        required: false
    environment:
      SCOUT_ENDPOINT: ${SCOUT_ENDPOINT:-http://localhost:4318}
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID:-}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET:-}
      SCOUT_TOKEN_URL: ${SCOUT_TOKEN_URL:-}
      SCOUT_ENVIRONMENT: ${SCOUT_ENVIRONMENT:-development}
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
```

## Framework-Specific Instrumentation

### Hono Middleware and Plugins

Hono's middleware system integrates with OpenTelemetry via `@hono/otel`:

```typescript showLineNumbers title="src/app.ts"
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { trace } from '@opentelemetry/api';
import client from 'prom-client';
import type { Variables } from './types/index.js';

const app = new Hono<{ Variables: Variables }>();

// Prometheus metrics
const register = new client.Registry();
register.setDefaultLabels({ app: 'hono-postgres' });
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Global middleware
app.use('*', httpInstrumentationMiddleware());
app.use('*', secureHeaders());
app.use('*', cors({ origin: '*' }));

// Metrics collection middleware
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  const duration = (performance.now() - start) / 1000;
  const route = c.req.routePath || c.req.path;
  httpRequestsTotal.inc({
    method: c.req.method,
    route,
    status_code: c.res.status.toString(),
  });
  httpRequestDuration.observe(
    { method: c.req.method, route, status_code: c.res.status.toString() },
    duration
  );
});

// Prometheus metrics endpoint
app.get('/metrics', async (c) => {
  const metrics = await register.metrics();
  return c.text(metrics, 200, { 'Content-Type': register.contentType });
});

// Global error handler with trace ID
app.onError((err, c) => {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext()?.traceId;

  return c.json(
    {
      error: err.message,
      statusCode: 500,
      ...(traceId && { traceId }),
    },
    500
  );
});

export { app, register };
```

### Pino Logger with OpenTelemetry Bridge

Structured logging with automatic trace correlation:

```typescript showLineNumbers title="src/services/logger.ts"
import pino, { Logger, LoggerOptions } from 'pino';
import { trace } from '@opentelemetry/api';
import { logs as otelLogs, SeverityNumber } from '@opentelemetry/api-logs';

const isDevelopment = process.env.NODE_ENV === 'development';

function createLoggerOptions(name: string): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL || 'info',
    name,
    formatters: {
      log(object: Record<string, unknown>) {
        const span = trace.getActiveSpan();
        if (span) {
          const { traceId, spanId } = span.spanContext();
          return { ...object, traceId, spanId };
        }
        return object;
      },
    },
    hooks: {
      logMethod(inputArgs, method, level) {
        const levelLabel = pino.levels.labels[level] || 'info';
        const [objOrMsg, ...rest] = inputArgs;
        let msg = '';
        let obj: Record<string, unknown> = {};

        if (typeof objOrMsg === 'string') {
          msg = objOrMsg;
        } else if (typeof objOrMsg === 'object' && objOrMsg !== null) {
          obj = objOrMsg as Record<string, unknown>;
          msg = rest[0] as string || '';
        }

        if (levelLabel === 'warn' || levelLabel === 'error' || levelLabel === 'fatal') {
          const logger = otelLogs.getLogger('pino-otel-bridge');
          const span = trace.getActiveSpan();
          const spanContext = span?.spanContext();

          const severityMap: Record<string, SeverityNumber> = {
            warn: SeverityNumber.WARN,
            error: SeverityNumber.ERROR,
            fatal: SeverityNumber.FATAL,
          };

          logger.emit({
            severityNumber: severityMap[levelLabel] || SeverityNumber.INFO,
            severityText: levelLabel.toUpperCase(),
            body: msg,
            attributes: {
              ...obj,
              ...(spanContext && {
                'trace.id': spanContext.traceId,
                'span.id': spanContext.spanId,
              }),
            },
          });
        }

        method.apply(this, inputArgs);
      },
    },
    transport: isDevelopment ? { target: 'pino-pretty' } : undefined,
  };
}

export function createLogger(name: string): Logger {
  return pino(createLoggerOptions(name));
}
```

### Drizzle ORM with PostgreSQL

Database queries are automatically instrumented through the `pg` driver:

```typescript showLineNumbers title="src/db/schema.ts"
import {
  pgTable, varchar, text, timestamp, integer, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  bio: text('bio'),
  image: varchar('image', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('users_email_idx').on(table.email)]);

export const articles = pgTable('articles', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  body: text('body').notNull(),
  authorId: integer('author_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  favoritesCount: integer('favorites_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('articles_slug_idx').on(table.slug),
  index('articles_author_id_idx').on(table.authorId),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
```

```typescript showLineNumbers title="src/db/index.ts"
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const db = drizzle(pool, { schema });
```

### Zod Request Validation

Use `@hono/zod-validator` for type-safe request validation:

```typescript showLineNumbers title="src/validators/article.ts"
import { z } from 'zod';

export const createArticleSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(1000).optional(),
  body: z.string().min(1, 'Body is required'),
});

export const updateArticleSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  body: z.string().min(1).optional(),
});
```

```typescript showLineNumbers title="src/routes/articles.ts"
import { zValidator } from '@hono/zod-validator';
import { createArticleSchema } from '../validators/article.js';

articlesRouter.post(
  '/',
  authenticate,
  zValidator('json', createArticleSchema),
  async (c) => {
    const data = c.req.valid('json');
    const { id: userId } = c.get('user');
    const article = await createArticle(userId, data);
    return c.json({ article }, 201);
  }
);
```

## Custom Instrumentation

### Business Logic Spans with startActiveSpan

Add custom spans for business-critical operations:

```typescript showLineNumbers title="src/services/article.ts"
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { db } from '../db/index.js';
import { articles, users } from '../db/schema.js';
import { enqueueArticleCreatedNotification } from '../jobs/tasks/notification.js';

const tracer = trace.getTracer('article-service');

export async function createArticle(
  authorId: number,
  input: { title: string; description?: string; body: string }
) {
  return tracer.startActiveSpan('article.create', async (span) => {
    try {
      span.setAttribute('user.id', authorId);
      const slug = generateSlug(input.title);

      const [newArticle] = await db
        .insert(articles)
        .values({
          slug,
          title: input.title,
          description: input.description || null,
          body: input.body,
          authorId,
        })
        .returning();

      span.setAttribute('article.id', newArticle.id);
      span.setAttribute('article.slug', newArticle.slug);
      span.setStatus({ code: SpanStatusCode.OK });

      enqueueArticleCreatedNotification({
        articleId: newArticle.id,
        articleSlug: newArticle.slug,
        authorId,
        authorName: '',
        title: newArticle.title,
      }).catch((err) => {
        console.error('Failed to enqueue notification', err);
      });

      return newArticle;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Background Job Tracing with BullMQ

#### Producer: Inject Trace Context

```typescript showLineNumbers title="src/jobs/tasks/notification.ts"
import { context, propagation, trace, SpanKind } from '@opentelemetry/api';
import { notificationQueue } from '../queue.js';

const tracer = trace.getTracer('notification-tasks');

function getTraceContext(): Record<string, string> {
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  return traceContext;
}

export async function enqueueArticleCreatedNotification(
  payload: ArticleCreatedPayload
): Promise<void> {
  return tracer.startActiveSpan(
    'job.enqueue.article-created',
    { kind: SpanKind.PRODUCER },
    async (span) => {
      try {
        span.setAttribute('article.id', payload.articleId);
        span.setAttribute('messaging.system', 'bullmq');
        span.setAttribute('messaging.destination.name', 'notifications');
        span.setAttribute('messaging.operation.type', 'publish');

        const job = await notificationQueue.add('article-created', {
          ...payload,
          traceContext: getTraceContext(),
        });

        span.setAttribute('job.id', job.id || 'unknown');
        span.addEvent('job_enqueued');
      } finally {
        span.end();
      }
    }
  );
}
```

#### Consumer: Extract and Restore Trace Context

```typescript showLineNumbers title="src/jobs/worker.ts"
import '../telemetry.js';

import { Worker, Job } from 'bullmq';
import {
  trace, context, propagation, SpanStatusCode, SpanKind,
} from '@opentelemetry/api';

const tracer = trace.getTracer('notification-worker');

const worker = new Worker<JobData>(
  'notifications',
  async (job) => {
    const parentContext = job.data.traceContext
      ? propagation.extract(context.active(), job.data.traceContext)
      : context.active();

    return context.with(parentContext, async () => {
      return tracer.startActiveSpan(
        `job.${job.name}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'job.id': job.id || 'unknown',
            'job.name': job.name,
            'job.queue': 'notifications',
            'job.attempt': job.attemptsMade + 1,
            'messaging.system': 'bullmq',
            'messaging.destination.name': 'notifications',
            'messaging.operation.type': 'process',
          },
        },
        async (span) => {
          try {
            switch (job.name) {
              case 'article-created':
                await processArticleCreated(job);
                break;
              default:
                console.warn(`Unknown job type: ${job.name}`);
            }
            span.setStatus({ code: SpanStatusCode.OK });
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
            throw error;
          } finally {
            span.end();
          }
        }
      );
    });
  },
  { connection: { host: 'localhost', port: 6379 }, concurrency: 5 }
);
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash showLineNumbers
npm run dev

# In a separate terminal
npm run dev:worker
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

```bash showLineNumbers
npm run build

NODE_ENV=production \
OTEL_SERVICE_NAME=hono-postgres-app \
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
node dist/index.js
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build

docker compose logs -f app worker

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Health Check Endpoint

```typescript showLineNumbers title="src/routes/health.ts"
import { Hono } from 'hono';
import { trace } from '@opentelemetry/api';
import { checkDatabaseHealth } from '../db/index.js';

const healthRouter = new Hono();

healthRouter.get('/', async (c) => {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext()?.traceId;
  const dbHealthy = await checkDatabaseHealth();

  return c.json({
    status: dbHealthy ? 'healthy' : 'unhealthy',
    database: dbHealthy ? 'connected' : 'disconnected',
    traceId,
    timestamp: new Date().toISOString(),
  });
});

export default healthRouter;
```

### Debug Mode

```bash showLineNumbers
OTEL_LOG_LEVEL=debug npm run dev
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. Verify collector connectivity:

   ```bash showLineNumbers
   curl -f http://localhost:4318/v1/traces
   ```

2. Ensure `telemetry.ts` is imported first in `index.ts`
3. Check environment variables are set correctly
4. Verify Scout credentials in collector config

#### Issue: Missing database spans

**Solutions:**

1. Ensure `@opentelemetry/auto-instrumentations-node` is installed
2. Verify the `pg` driver is being used (not `pg-native`)
3. Check that telemetry initialization happens before database import

#### Issue: Background job traces not linked

**Solutions:**

1. Verify trace context is propagated to job data with `propagation.inject`
2. Ensure worker imports `telemetry.ts` before other modules
3. Check that `context.with()` wraps the job processor

#### Issue: High memory usage

**Solutions:**

1. Reduce batch size in exporter configuration
2. Disable filesystem instrumentation (already disabled in recommended config)

## Security Considerations

### Sensitive Data Protection

```typescript showLineNumbers
// BAD: Captures password
span.setAttribute('user.password', password);

// GOOD: Only capture non-sensitive identifiers
span.setAttribute('user.id', userId);
span.setAttribute('user.email_domain', email.split('@')[1]);
```

### SQL Query Obfuscation

```typescript showLineNumbers title="src/telemetry.ts"
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pg': {
      enhancedDatabaseReporting: false,
    },
  }),
],
```

### Compliance Considerations

For GDPR, HIPAA, or PCI-DSS compliance:

- Never log PII in span attributes
- Use pseudonymization for user identifiers when possible
- Configure data retention policies in your observability backend
- Implement attribute filtering at the collector level

## Performance Considerations

### Expected Impact

| Metric       | Typical Impact | High-Traffic Impact |
| ------------ | -------------- | ------------------- |
| Latency      | +1-3ms         | +2-5ms              |
| CPU overhead | 2-5%           | 5-10%               |
| Memory       | +50-100MB      | +100-200MB          |

### Optimization Best Practices

#### 1. Skip Non-Critical Endpoints

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  ignoreIncomingRequestHook: (req) => {
    const url = req.url || '';
    return url === '/health' || url === '/metrics' || url === '/favicon.ico';
  },
},
```

#### 2. Disable Unnecessary Instrumentations

```typescript showLineNumbers
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },
  }),
],
```

## FAQ

### What is the performance impact of OpenTelemetry on Hono?

OpenTelemetry typically adds 1-3ms latency per request with 2-5% CPU overhead.
The `BatchSpanProcessor` minimizes impact by buffering spans for batch export.

### Which versions of Hono are supported?

This guide focuses on Hono 4.x with `@hono/otel` middleware. The same
auto-instrumentation approach works with any Hono version since HTTP-level
instrumentation is framework-agnostic.

### How does @hono/otel differ from @fastify/otel?

`@hono/otel` is a Hono middleware that creates spans with route-parameterized
names. Fastify uses hooks and plugins. Both achieve the same result —
automatic HTTP span generation with method, route, and status code.

### How do I instrument Hono with PostgreSQL and Drizzle ORM?

PostgreSQL queries are automatically instrumented through the `pg` driver.
Drizzle ORM uses `pg` under the hood, so all queries appear as database spans
without additional configuration.

### How do I trace background jobs with BullMQ?

Inject trace context when enqueuing with `propagation.inject()` and extract
it in the worker with `propagation.extract()`. Wrap the worker processor in
`context.with(parentContext, ...)` to link consumer spans to the producer.

### How do I correlate Pino logs with traces?

The custom `createLogger` function adds `traceId` and `spanId` to every log
entry automatically. Warn, error, and fatal logs are also emitted to the OTel
log provider for export alongside traces.

### Can I use Prometheus metrics alongside OpenTelemetry?

Yes. The example uses `prom-client` for Prometheus-compatible metrics exposed
at `/metrics`, alongside OpenTelemetry metrics exported via OTLP. Both can
coexist.

### How do I handle multi-tenancy in traces?

Add tenant context as span attributes:

```typescript showLineNumbers
span.setAttribute('tenant.id', request.headers['x-tenant-id']);
```

### How do I reduce trace volume in production?

Use `ignoreIncomingRequestHook` to skip health checks and static assets,
and disable unnecessary instrumentations like filesystem and DNS.

### What's the difference between OTLP HTTP and gRPC?

This guide uses OTLP HTTP (port 4318) which works through HTTP proxies and
load balancers. OTLP gRPC (port 4317) offers slightly better performance but
requires HTTP/2 support. Both are fully supported by Scout Collector.

## What's Next?

### Advanced Topics

- [Express.js Instrumentation](./express.md) - Similar Node.js patterns
- [Fastify Instrumentation](./fastify.md) - Alternative Node.js framework
- [NestJS Instrumentation](./nestjs.md) - TypeScript-first framework

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerting for Hono services
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development configuration
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment

## Complete Example

### Project Structure

```text
hono-postgres/
├── src/
│   ├── telemetry.ts          # OTel SDK initialization (import first!)
│   ├── index.ts              # Application entry point
│   ├── app.ts                # Hono app with @hono/otel middleware
│   ├── config/
│   │   └── index.ts          # Environment configuration
│   ├── db/
│   │   ├── schema.ts         # Drizzle schema (users, articles, favorites)
│   │   ├── index.ts          # Database connection pool
│   │   └── migrate.ts        # Drizzle migration runner
│   ├── services/
│   │   ├── logger.ts         # Pino + OTel bridge
│   │   ├── article.ts        # Article CRUD with custom spans
│   │   └── user.ts           # Auth operations with custom spans
│   ├── routes/
│   │   ├── health.ts         # Health check endpoints
│   │   ├── auth.ts           # Authentication routes
│   │   └── articles.ts       # Article CRUD routes
│   ├── middleware/
│   │   └── auth.ts           # JWT authentication
│   ├── validators/
│   │   ├── user.ts           # Zod schemas for auth
│   │   └── article.ts        # Zod schemas for articles
│   └── jobs/
│       ├── queue.ts          # BullMQ queue setup
│       ├── worker.ts         # Background worker (CONSUMER)
│       └── tasks/
│           └── notification.ts   # Job producers (PRODUCER)
├── config/
│   └── otel-config.yaml      # Collector configuration
├── compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

### Dependencies

```json showLineNumbers title="package.json"
{
  "name": "hono-postgres",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "dependencies": {
    "@hono/node-server": "^1.19.9",
    "@hono/otel": "^1.1.0",
    "@hono/zod-validator": "^0.7.6",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.212.0",
    "@opentelemetry/auto-instrumentations-node": "^0.69.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.212.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.212.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.212.0",
    "@opentelemetry/resources": "^2.5.1",
    "@opentelemetry/sdk-logs": "^0.212.0",
    "@opentelemetry/sdk-metrics": "^2.5.1",
    "@opentelemetry/sdk-node": "^0.212.0",
    "@opentelemetry/semantic-conventions": "^1.39.0",
    "bullmq": "^5.69.1",
    "drizzle-orm": "^0.45.1",
    "hono": "^4.11.9",
    "ioredis": "^5.9.3",
    "pg": "^8.18.0",
    "pino": "^10.3.1",
    "prom-client": "^15.1.3",
    "zod": "^4.3.6"
  }
}
```

### GitHub Repository

For a complete working example, see the
[Hono PostgreSQL Example](https://github.com/base-14/examples/tree/main/nodejs/hono-postgres)
repository.

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [Hono Documentation](https://hono.dev/docs/)
- [@hono/otel Middleware](https://www.npmjs.com/package/@hono/otel)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)

## Related Guides

- [Fastify Instrumentation](./fastify.md) - Similar Node.js web framework
- [Express.js Instrumentation](./express.md) - Classic Node.js framework
- [NestJS Instrumentation](./nestjs.md) - TypeScript-first framework
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector configuration
