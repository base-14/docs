---
title: Fastify OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Fastify
sidebar_position: 9
description:
  Complete guide to Fastify OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with base14 Scout in minutes. Supports Fastify 5.x,
  PostgreSQL, Redis, BullMQ background jobs.
keywords:
  [
    fastify opentelemetry instrumentation,
    fastify monitoring,
    fastify apm,
    fastify distributed tracing,
    nodejs fastify observability,
    fastify performance monitoring,
    opentelemetry fastify typescript,
    fastify telemetry,
    fastify metrics,
    fastify traces,
    fastify postgresql monitoring,
    fastify redis instrumentation,
    bullmq opentelemetry,
    fastify drizzle tracing,
    fastify production monitoring,
    fastify instrumentation guide,
    fastify 5 monitoring,
    nodejs apm fastify,
    fastify pino logging,
    fastify jwt tracing,
  ]
---

# Fastify

Implement OpenTelemetry instrumentation for Fastify applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to auto-instrument your Fastify
application to collect traces and metrics from HTTP requests, database queries,
Redis operations, background jobs, and custom business logic using the
OpenTelemetry Node.js SDK with minimal code changes.

Fastify applications benefit from automatic instrumentation of the framework
itself, as well as popular libraries including PostgreSQL (pg), Redis (IORedis),
BullMQ, Drizzle ORM, and dozens of commonly used Node.js components. With
OpenTelemetry, you can monitor production performance, debug slow requests,
trace distributed transactions across microservices, and identify database query
bottlenecks without significant code modifications. Fastify's plugin-based
architecture and high-performance design work seamlessly with OpenTelemetry's
context propagation, ensuring accurate parent-child span relationships across
async operations.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like DataDog or New Relic, or troubleshooting
performance issues in production, this guide provides production-ready
configurations and best practices for Fastify OpenTelemetry instrumentation.
You'll learn how to set up auto-instrumentation, configure custom spans for
business logic, optimize performance, and deploy with Docker.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Fastify applications
- Configure automatic request and response tracing for HTTP endpoints
- Instrument database operations with PostgreSQL auto-instrumentation
- Implement custom spans for business logic and external API calls
- Trace background jobs with BullMQ and propagate context to workers
- Configure production-ready telemetry with BatchSpanProcessor
- Export telemetry data to base14 Scout via OTLP
- Deploy instrumented applications with Docker and Docker Compose
- Troubleshoot common instrumentation issues
- Optimize performance impact in production environments

## Who This Guide Is For

This documentation is designed for:

- **Fastify developers**: implementing observability and distributed tracing
  for the first time in Node.js applications
- **DevOps engineers**: deploying Fastify applications with production
  monitoring requirements and container orchestration
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-source observability
- **Backend developers**: debugging performance issues, slow queries, or async
  operation bottlenecks in Fastify services
- **Platform teams**: standardizing observability across multiple Fastify
  microservices with consistent instrumentation patterns

## Prerequisites

Before starting, ensure you have:

- **Node.js 24.0.0 or later** installed (latest LTS recommended)
- **Fastify 5.0.0 or later** installed in your project
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)
- Access to npm for package installation

### Compatibility Matrix

| Component                 | Minimum Version | Recommended Version | Notes                             |
| ------------------------- | --------------- | ------------------- | --------------------------------- |
| **Node.js**               | 24.0.0          | 24.x LTS            | Latest LTS with ESM support       |
| **Fastify**               | 5.0.0           | 5.7.1+              | Latest v5 with improved hooks     |
| **TypeScript** (optional) | 5.0.0           | 5.9.3+              | For type safety                   |
| **OpenTelemetry SDK**     | 0.200.0         | 0.211.0+            | Core SDK for traces and metrics   |
| **PostgreSQL** (optional) | 15.0            | 18.x                | For database instrumentation      |
| **Redis** (optional)      | 7.0             | 8.x                 | For IORedis instrumentation       |
| **Drizzle ORM** (optional)| 0.40.0          | 0.45.1+             | Type-safe SQL builder             |

### Supported Libraries

OpenTelemetry automatically instruments these commonly used libraries:

- **Web frameworks**: Fastify, HTTP/HTTPS
- **Databases**: PostgreSQL (pg), MySQL, SQLite
- **Caching**: Redis (IORedis), Memcached
- **Job Queues**: BullMQ
- **HTTP Clients**: axios, node-fetch, http/https
- **Logging**: Pino (with trace correlation)

## Installation

### Core Packages

Install the required OpenTelemetry packages for Fastify instrumentation:

```bash showLineNumbers
npm install @opentelemetry/api
npm install @opentelemetry/sdk-node
npm install @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/exporter-metrics-otlp-http
npm install @opentelemetry/resources
npm install @opentelemetry/semantic-conventions
```

### Optional Instrumentation Libraries

Add these packages for specific component instrumentation:

```bash showLineNumbers
# Fastify-specific instrumentation (included in auto-instrumentations)
npm install @opentelemetry/instrumentation-fastify

# Logs export (optional)
npm install @opentelemetry/api-logs
npm install @opentelemetry/sdk-logs
npm install @opentelemetry/exporter-logs-otlp-http

# Pino trace correlation (optional)
npm install pino-opentelemetry-transport
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
imports. This is the recommended approach for Fastify applications.

```typescript showLineNumbers title="src/telemetry.ts"
/**
 * OpenTelemetry instrumentation setup for Fastify application.
 *
 * CRITICAL: This file MUST be imported before any other modules
 * to ensure auto-instrumentation captures all dependencies.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const serviceName = process.env.OTEL_SERVICE_NAME || 'fastify-app';
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
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          const url = req.url || '';
          // Skip health checks and metrics endpoints
          return url === '/health' || url === '/metrics';
        },
      },
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable noisy filesystem instrumentation
      },
    }),
  ],
});

sdk.start();

// Graceful shutdown
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

import { createApp } from './app.js';
import { config } from './config/index.js';

const start = async () => {
  const app = await createApp();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server running at http://${config.host}:${config.port}`);
};

start();
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

### Environment Variables Only

For simpler setups or container deployments, configure via environment
variables:

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=fastify-app
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_NODE_RESOURCE_DETECTORS=env,host,os,process
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
<TabItem value="logs" label="With Log Export">
```

### With Log Export

For complete observability including structured logs:

```typescript showLineNumbers title="src/telemetry.ts"
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

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'fastify-app',
  [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.0',
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
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 512

  resource:
    attributes:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlphttp/scout:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client

extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}

  health_check:
    endpoint: 0.0.0.0:13133

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp/scout]
    metrics:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp/scout]
    logs:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp/scout]
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### Resource Attributes

Configure resource attributes for production deployments:

```typescript showLineNumbers title="src/telemetry.ts"
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_NAMESPACE,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_HOST_NAME,
} from '@opentelemetry/semantic-conventions';
import os from 'os';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'fastify-app',
  [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || '1.0.0',
  [ATTR_SERVICE_NAMESPACE]: process.env.SERVICE_NAMESPACE || 'production',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  [ATTR_HOST_NAME]: os.hostname(),
  'service.instance.id': process.env.HOSTNAME || crypto.randomUUID(),
});
```

### Production Environment Variables

```bash showLineNumbers title=".env.production"
# Service identification
OTEL_SERVICE_NAME=fastify-api
OTEL_SERVICE_VERSION=1.2.3
SERVICE_NAMESPACE=production

# Collector endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

# Resource attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=api

# Sampling (reduce volume in high-traffic scenarios)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

### Docker Deployment

```dockerfile showLineNumbers title="Dockerfile"
# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production=false
COPY . .
RUN npm run build

# Runtime stage
FROM node:24-alpine AS runtime
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

USER nodejs
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### Docker Compose Configuration

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build:
      context: .
      target: runtime
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/app
      REDIS_URL: redis://redis:6379
      OTEL_SERVICE_NAME: fastify-api
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      otel-collector:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
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
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/app
      REDIS_URL: redis://redis:6379
      OTEL_SERVICE_NAME: fastify-worker
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
    depends_on:
      - postgres
      - redis
      - otel-collector
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
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:13133/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
```

## Framework-Specific Instrumentation

### Fastify Hooks and Plugins

Fastify's hook system integrates naturally with OpenTelemetry:

```typescript showLineNumbers title="src/app.ts"
import Fastify, { FastifyInstance, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { trace } from '@opentelemetry/api';

export async function createApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
    requestIdLogLabel: 'requestId',
    genReqId: () => crypto.randomUUID(),
  });

  // Security plugins
  await fastify.register(helmet);
  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Error handler with trace context
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext()?.traceId;

    fastify.log.error({ err: error, traceId }, 'Request error');

    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: error.message,
      statusCode,
      ...(traceId && { traceId }),
    });
  });

  return fastify;
}
```

### Automatic Route Instrumentation

OpenTelemetry automatically instruments Fastify routes:

```typescript showLineNumbers title="src/routes/articles.ts"
import { FastifyPluginAsync } from 'fastify';
import * as articleService from '../services/article.js';

const articlesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/articles - automatically traced
  fastify.get('/', async (request, reply) => {
    const { limit, offset, author } = request.query as {
      limit?: number;
      offset?: number;
      author?: string;
    };

    const result = await articleService.findArticles(
      { limit, offset, author },
      request.user?.id
    );

    return result;
  });

  // POST /api/articles - automatically traced
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { title, description, body } = request.body as {
      title: string;
      description?: string;
      body: string;
    };

    return articleService.createArticle(request.user!.id, {
      title,
      description,
      body,
    });
  });
};

export default articlesRoutes;
```

### PostgreSQL with Drizzle ORM

Database queries are automatically instrumented:

```typescript showLineNumbers title="src/db/index.ts"
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const db = drizzle(pool, { schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
```

## Custom Instrumentation

### Business Logic Spans

Add custom spans for business-critical operations:

```typescript showLineNumbers title="src/services/article.ts"
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { db } from '../db/index.js';
import { articles, users } from '../db/schema.js';

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

      // Enqueue background job (fire and forget)
      enqueueNotification(newArticle).catch((err) => {
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

### External API Calls

Instrument external service calls with error handling:

```typescript showLineNumbers title="src/services/external.ts"
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

const tracer = trace.getTracer('external-service');

export async function fetchExternalData(resourceId: string): Promise<unknown> {
  return tracer.startActiveSpan(
    'external.fetch',
    { kind: SpanKind.CLIENT },
    async (span) => {
      try {
        span.setAttribute('external.resource_id', resourceId);
        span.setAttribute('http.url', `https://api.example.com/${resourceId}`);

        const response = await fetch(
          `https://api.example.com/resources/${resourceId}`,
          {
            headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
          }
        );

        span.setAttribute('http.status_code', response.status);

        if (!response.ok) {
          throw new Error(`External API error: ${response.status}`);
        }

        const data = await response.json();
        span.setStatus({ code: SpanStatusCode.OK });
        return data;
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
}
```

### Background Job Tracing with BullMQ

Propagate trace context to background workers:

```typescript showLineNumbers title="src/jobs/tasks/notification.ts"
import { Queue } from 'bullmq';
import { context, propagation } from '@opentelemetry/api';

const notificationQueue = new Queue('notifications', {
  connection: { host: 'localhost', port: 6379 },
});

interface ArticleCreatedData {
  articleId: number;
  articleSlug: string;
  authorId: number;
  authorName: string;
  title: string;
  traceContext?: Record<string, string>;
}

export async function enqueueArticleCreatedNotification(
  data: Omit<ArticleCreatedData, 'traceContext'>
): Promise<void> {
  // Capture current trace context
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);

  await notificationQueue.add('article-created', {
    ...data,
    traceContext,
  });
}
```

Process jobs with trace context restoration:

```typescript showLineNumbers title="src/jobs/worker.ts"
import '../telemetry.js';

import { Worker, Job } from 'bullmq';
import { trace, context, propagation, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('notification-worker');

const worker = new Worker<JobData>(
  'notifications',
  async (job) => {
    // Restore parent trace context
    const parentContext = job.data.traceContext
      ? propagation.extract(context.active(), job.data.traceContext)
      : context.active();

    return context.with(parentContext, async () => {
      return tracer.startActiveSpan(
        `job.${job.name}`,
        {
          attributes: {
            'job.id': job.id || 'unknown',
            'job.name': job.name,
            'job.queue': 'notifications',
            'job.attempt': job.attemptsMade + 1,
          },
        },
        async (span) => {
          try {
            // Process the job
            await processJob(job);

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

### Development Mode

Run with console output for debugging:

```bash showLineNumbers
# Start the application
npm run dev

# In a separate terminal, start the worker
npm run dev:worker
```

### Production Mode

```bash showLineNumbers
# Build
npm run build

# Start with environment variables
NODE_ENV=production \
OTEL_SERVICE_NAME=fastify-api \
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 \
node dist/index.js
```

### Docker Deployment

```bash showLineNumbers
# Build and run with Docker Compose
docker compose up --build

# View logs
docker compose logs -f app worker

# Stop services
docker compose down
```

## Troubleshooting

### Verification Test

Test that instrumentation is working:

```typescript showLineNumbers title="scripts/verify-telemetry.ts"
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('verification');

async function verify() {
  const span = tracer.startSpan('verification.test');
  span.setAttribute('test.attribute', 'value');
  console.log('Trace ID:', span.spanContext().traceId);
  span.end();
}

verify();
```

### Health Check Endpoint

Implement a health check that includes telemetry status:

```typescript showLineNumbers title="src/routes/health.ts"
import { FastifyPluginAsync } from 'fastify';
import { trace } from '@opentelemetry/api';
import { db } from '../db/index.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    const span = trace.getActiveSpan();
    const traceId = span?.spanContext()?.traceId;

    // Check database connectivity
    try {
      await db.execute('SELECT 1');
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        traceId,
      };
    }

    return {
      status: 'healthy',
      database: 'connected',
      traceId,
      timestamp: new Date().toISOString(),
    };
  });
};

export default healthRoutes;
```

### Debug Mode

Enable verbose OpenTelemetry logging:

```bash showLineNumbers
# Enable debug logging
OTEL_LOG_LEVEL=debug npm run dev
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. Verify collector connectivity:

   ```bash
   curl -f http://localhost:4318/v1/traces
   ```

2. Check environment variables are set correctly
3. Ensure telemetry.ts is imported first in index.ts
4. Verify Scout credentials in collector config

#### Issue: Missing database spans

**Solutions:**

1. Ensure `@opentelemetry/auto-instrumentations-node` is installed
2. Verify the pg driver is being used (not pg-native)
3. Check that telemetry initialization happens before database import

#### Issue: Background job traces not linked

**Solutions:**

1. Verify trace context is being propagated to job data
2. Ensure worker imports telemetry.ts before other modules
3. Check that context.with() wraps the job processor

#### Issue: High memory usage

**Solutions:**

1. Reduce batch size in exporter configuration
2. Enable sampling for high-traffic endpoints
3. Disable filesystem instrumentation

## Security Considerations

### Sensitive Data Protection

Avoid capturing sensitive information in spans:

```typescript showLineNumbers title="src/services/auth.ts"
// BAD: Captures password
span.setAttribute('user.password', password);

// GOOD: Only capture non-sensitive identifiers
span.setAttribute('user.id', userId);
span.setAttribute('user.email_domain', email.split('@')[1]);
```

### SQL Query Obfuscation

Configure database instrumentation to obfuscate queries:

```typescript showLineNumbers title="src/telemetry.ts"
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pg': {
      enhancedDatabaseReporting: false, // Don't include query parameters
    },
  }),
],
```

### HTTP Header Filtering

Filter sensitive headers from HTTP spans:

```typescript showLineNumbers title="src/telemetry.ts"
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': {
      headersToSpanAttributes: {
        server: {
          requestHeaders: ['x-request-id', 'user-agent'],
          responseHeaders: ['x-request-id'],
        },
      },
    },
  }),
],
```

### Compliance Considerations

For GDPR, HIPAA, or PCI-DSS compliance:

- Never log PII (names, emails, addresses) in span attributes
- Use pseudonymization for user identifiers when possible
- Configure data retention policies in your observability backend
- Implement attribute filtering at the collector level

## Performance Considerations

### Expected Impact

| Metric        | Typical Impact | High-Traffic Impact |
| ------------- | -------------- | ------------------- |
| Latency       | +1-3ms         | +2-5ms              |
| CPU overhead  | 2-5%           | 5-10%               |
| Memory        | +50-100MB      | +100-200MB          |

### Impact Factors

- Number of spans per request
- Attribute count and size
- Batch export frequency
- Sampling configuration

### Optimization Best Practices

#### 1. Use Sampling in Production

```typescript showLineNumbers title="src/telemetry.ts"
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(0.1), // Sample 10% of traces
  // ...
});
```

#### 2. Skip Non-Critical Endpoints

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  ignoreIncomingRequestHook: (req) => {
    const url = req.url || '';
    return url === '/health' || url === '/metrics' || url === '/favicon.ico';
  },
},
```

#### 3. Limit Attribute Sizes

```typescript showLineNumbers
span.setAttribute('request.body', JSON.stringify(body).slice(0, 1000));
```

#### 4. Configure Batch Export

```typescript showLineNumbers
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

const batchProcessor = new BatchSpanProcessor(traceExporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
});
```

#### 5. Disable Unnecessary Instrumentations

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

### What is the performance impact of OpenTelemetry on Fastify?

OpenTelemetry typically adds 1-3ms latency per request with 2-5% CPU overhead.
For high-traffic applications, use sampling to reduce this impact. The
BatchSpanProcessor helps minimize overhead by buffering spans and exporting
them in batches.

### Which versions of Fastify are supported?

OpenTelemetry instrumentation supports Fastify 3.x and later. This guide
focuses on Fastify 5.x which provides improved hooks and TypeScript support.
For older versions, the same instrumentation approach works with minor
adjustments.

### How do I instrument Fastify with PostgreSQL and Drizzle ORM?

PostgreSQL queries are automatically instrumented through the `pg` driver.
Drizzle ORM uses `pg` under the hood, so all queries are captured as database
spans. No additional configuration is needed beyond the standard
auto-instrumentation setup.

### How do I reduce trace volume in production?

Use sampling to capture a percentage of traces:

```typescript
sampler: new TraceIdRatioBasedSampler(0.1) // 10% sampling
```

You can also exclude health checks and static assets from tracing using
`ignoreIncomingRequestHook`.

### How do I handle multi-tenancy in traces?

Add tenant context as span attributes:

```typescript
span.setAttribute('tenant.id', request.headers['x-tenant-id']);
span.setAttribute('tenant.name', tenantName);
```

This allows filtering traces by tenant in Scout Dashboard.

### What's the difference between traces and metrics?

**Traces** capture the journey of individual requests through your system,
showing timing and relationships between operations. Use traces for debugging
specific requests and understanding request flow.

**Metrics** are aggregated measurements over time (counters, gauges, histograms).
Use metrics for dashboards, alerting, and capacity planning.

### How do I debug slow database queries with OpenTelemetry?

Database spans include query timing and (optionally) the SQL statement. In
Scout Dashboard, filter spans by `db.system = postgresql` and sort by duration
to find slow queries. The span attributes include table names and operation
types.

### How do I trace background jobs with BullMQ?

Inject trace context when enqueuing jobs and extract it in the worker:

```typescript
// Producer: inject context
propagation.inject(context.active(), jobData.traceContext);

// Consumer: extract and restore context
const parentContext = propagation.extract(context.active(), job.data.traceContext);
context.with(parentContext, () => { /* process job */ });
```

### Can I use OpenTelemetry with Fastify plugins?

Yes, plugins are automatically instrumented as part of the request lifecycle.
Custom plugin operations can be wrapped in spans using the tracer API for
additional visibility.

### How do I correlate Pino logs with traces?

Use `pino-opentelemetry-transport` to automatically inject trace IDs into log
entries:

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    targets: [
      { target: 'pino-opentelemetry-transport', level: 'info' },
      { target: 'pino-pretty', level: 'debug' },
    ],
  },
});
```

### How do I export metrics to Prometheus?

OpenTelemetry metrics can be exported to Prometheus via the collector or
directly using the Prometheus exporter. For Fastify applications, you can
also expose a `/metrics` endpoint using `prom-client` alongside OpenTelemetry
metrics.

## What's Next?

### Advanced Topics

- [Express.js Instrumentation](./express.md) - Similar Node.js patterns
- [NestJS Instrumentation](./nestjs.md) - Framework-specific setup
- [Node.js Instrumentation](./nodejs.md) - Core Node.js patterns

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerting for Fastify services
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development configuration
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment

## Complete Example

### Project Structure

```plain
fastify-postgres/
├── src/
│   ├── telemetry.ts      # OpenTelemetry initialization (import first!)
│   ├── index.ts          # Application entry point
│   ├── app.ts            # Fastify app configuration
│   ├── config/
│   │   └── index.ts      # Environment configuration
│   ├── db/
│   │   ├── index.ts      # Database connection
│   │   └── schema.ts     # Drizzle schema
│   ├── routes/
│   │   ├── health.ts     # Health check endpoint
│   │   ├── auth.ts       # Authentication routes
│   │   └── articles.ts   # Article CRUD routes
│   ├── services/
│   │   ├── article.ts    # Article business logic
│   │   └── redis.ts      # Redis client
│   └── jobs/
│       ├── queue.ts      # BullMQ queue setup
│       ├── worker.ts     # Background worker
│       └── tasks/
│           └── notification.ts
├── config/
│   └── otel-config.yaml  # Collector configuration
├── compose.yml           # Docker Compose
├── Dockerfile
├── package.json
└── tsconfig.json
```

### Dependencies

```json showLineNumbers title="package.json"
{
  "name": "fastify-postgres",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=24.0.0"
  },
  "dependencies": {
    "@fastify/cors": "^11.2.0",
    "@fastify/helmet": "^13.0.2",
    "@fastify/jwt": "^10.0.0",
    "@fastify/rate-limit": "^10.3.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.69.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.211.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.211.0",
    "@opentelemetry/resources": "^2.4.0",
    "@opentelemetry/sdk-metrics": "^2.4.0",
    "@opentelemetry/sdk-node": "^0.211.0",
    "@opentelemetry/semantic-conventions": "^1.39.0",
    "bullmq": "^5.66.7",
    "drizzle-orm": "^0.45.1",
    "fastify": "^5.7.1",
    "ioredis": "^5.9.2",
    "pg": "^8.17.2",
    "pino": "^10.3.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
```

### GitHub Repository

For a complete working example, see the
[Fastify PostgreSQL Example](https://github.com/base-14/examples/tree/main/nodejs/fastify-postgres)
repository.

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [OpenTelemetry Fastify Instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-fastify)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)

## Related Guides

- [Express.js Instrumentation](./express.md) - Similar Node.js web framework
- [NestJS Instrumentation](./nestjs.md) - TypeScript-first framework
- [Node.js Instrumentation](./nodejs.md) - Core Node.js patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local collector configuration
