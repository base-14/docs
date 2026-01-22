---
title: Next.js OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Next.js
sidebar_position: 11
description:
  Complete guide to Next.js OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, logs,
  and production deployments with base14 Scout. Supports Next.js 16+, App Router,
  MongoDB, Redis, BullMQ workers.
keywords:
  [
    nextjs opentelemetry instrumentation,
    nextjs monitoring,
    nextjs apm,
    nextjs distributed tracing,
    nextjs observability,
    nextjs performance monitoring,
    opentelemetry nextjs,
    nextjs telemetry,
    nextjs app router instrumentation,
    nextjs api routes tracing,
    nextjs mongodb monitoring,
    nextjs bullmq instrumentation,
    nextjs background jobs tracing,
    nextjs redis monitoring,
    nextjs production monitoring,
    nextjs turbopack observability,
    nextjs server components tracing,
    nextjs route handlers monitoring,
    nextjs middleware tracing,
    nextjs mongoose instrumentation,
    typescript nextjs observability,
    nextjs debugging performance,
    opentelemetry typescript nextjs,
    nextjs standalone deployment,
    nextjs docker monitoring,
  ]
---

# Next.js

## Introduction

Implement OpenTelemetry instrumentation for Next.js applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability across your full-stack React applications. This guide shows you
how to auto-instrument Next.js API routes, server components, middleware,
MongoDB queries, Redis operations, and BullMQ background jobs using the
OpenTelemetry Node.js SDK with the built-in Next.js instrumentation hook.

Next.js applications benefit from automatic instrumentation of the framework
itself, HTTP requests, database queries, and background job processing. The
Next.js instrumentation file (`instrumentation.ts`) provides a clean integration
point that initializes OpenTelemetry before your application code runs. With
OpenTelemetry, you can trace requests through API routes, monitor server
component rendering, debug slow database queries, track background job
execution, and identify performance bottlenecks without significant code changes.
The App Router architecture works seamlessly with OpenTelemetry's context
propagation, ensuring accurate parent-child span relationships across async
operations.

Whether you're building REST APIs with Next.js, implementing server-side
rendering with App Router, migrating from commercial APM solutions like DataDog
or New Relic, or troubleshooting performance issues in production, this guide
provides production-ready configurations and best practices for Next.js
OpenTelemetry instrumentation with base14 Scout. You'll learn how to set up
auto-instrumentation, configure custom spans for business logic, implement
distributed tracing for background workers, and deploy with Docker.

## Who This Guide Is For

This documentation is designed for:

- **Next.js developers**: implementing observability and distributed tracing for
  full-stack React applications with API routes
- **Backend engineers**: building REST APIs with Next.js App Router and
  requiring production monitoring
- **DevOps teams**: deploying Next.js applications with Docker and Kubernetes
  with comprehensive observability requirements
- **Full-stack developers**: debugging MongoDB queries, Redis operations, and
  BullMQ job processing in production Next.js apps
- **Platform teams**: standardizing observability across multiple Next.js
  microservices with consistent instrumentation patterns

## Prerequisites

Before starting, ensure you have:

- **Node.js 22.x or later** (24.x LTS recommended for production)
- **Next.js 15.x or later** installed (16.x recommended with Turbopack)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)
- Familiarity with Next.js App Router and API routes

### Compatibility Matrix

| Component                   | Minimum Version | Recommended Version |
| --------------------------- | --------------- | ------------------- |
| Node.js                     | 22.0.0          | 24.x LTS            |
| Next.js                     | 15.0.0          | 16.1.0+             |
| @opentelemetry/sdk-node     | 0.200.0         | 0.210.0+            |
| @opentelemetry/auto-inst... | 0.60.0          | 0.68.0+             |
| Mongoose (if used)          | 8.0.0           | 9.1.0+              |
| BullMQ (if used)            | 5.0.0           | 5.66.0+             |
| IORedis (if used)           | 5.0.0           | 5.9.0+              |
| TypeScript                  | 5.0.0           | 5.9.0+              |

## Installation

Install the OpenTelemetry SDK and auto-instrumentation packages:

```bash showLineNumbers title="Install OpenTelemetry for Next.js"
npm install --save \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/sdk-metrics
```

For logging support, add the logs packages:

```bash showLineNumbers
npm install --save \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-logs \
  @opentelemetry/exporter-logs-otlp-http
```

Optional packages for Prometheus metrics endpoint:

```bash showLineNumbers
npm install --save @opentelemetry/exporter-prometheus
```

## Configuration

Next.js provides a built-in instrumentation hook through the `instrumentation.ts`
file at the project root. This is the recommended approach for initializing
OpenTelemetry.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="instrumentation" label="Next.js Instrumentation File (Recommended)" default>
```

Create the instrumentation entry point at the project root:

```typescript showLineNumbers title="instrumentation.ts"
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./src/lib/telemetry');
  }
}
```

Create the telemetry module with full configuration:

```typescript showLineNumbers title="src/lib/telemetry.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';

const serviceName = process.env.OTEL_SERVICE_NAME || 'nextjs-app';
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
  'deployment.environment': process.env.NODE_ENV || 'development',
});

const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  }),
  exportIntervalMillis: 60000,
});

const meterProvider = new MeterProvider({
  resource,
  readers: [metricReader],
});

metrics.setGlobalMeterProvider(meterProvider);

const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          return url.startsWith('/_next') || url === '/favicon.ico';
        },
      },
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-dns': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-net': {
        enabled: false,
      },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  Promise.all([sdk.shutdown(), meterProvider.shutdown()])
    .then(() => console.log('Telemetry SDK shut down successfully'))
    .catch((error) => console.error('Error shutting down SDK', error))
    .finally(() => process.exit(0));
});

console.log(`OpenTelemetry initialized for service: ${serviceName}`);

export function getTracer(name: string = 'api') {
  return trace.getTracer(name);
}

export function getMeter(name: string = 'api') {
  return metrics.getMeter(name);
}

export async function withSpan<T>(
  spanName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { SpanStatusCode };
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

Configure OpenTelemetry through environment variables for container deployments:

```bash showLineNumbers title=".env"
# Application
NODE_ENV=production
PORT=3000

# OpenTelemetry
OTEL_SERVICE_NAME=nextjs-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=api

# MongoDB
MONGODB_URI=mongodb://mongo:27017/nextjs-app?replicaSet=rs0

# Redis (for BullMQ)
REDIS_HOST=redis
REDIS_PORT=6379

# Scout Configuration
SCOUT_ENDPOINT=https://your-tenant.base14.io:4318
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token
```

```mdx-code-block
</TabItem>
<TabItem value="with-logs" label="With Logs Export">
```

Add OpenTelemetry logs export to the telemetry module:

```typescript showLineNumbers title="src/lib/telemetry.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
import { trace, metrics } from '@opentelemetry/api';

const serviceName = process.env.OTEL_SERVICE_NAME || 'nextjs-app';
const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: '1.0.0',
  'deployment.environment': process.env.NODE_ENV || 'development',
});

// Traces
const traceExporter = new OTLPTraceExporter({
  url: `${otlpEndpoint}/v1/traces`,
});

// Metrics
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  }),
  exportIntervalMillis: 60000,
});

const meterProvider = new MeterProvider({
  resource,
  readers: [metricReader],
});
metrics.setGlobalMeterProvider(meterProvider);

// Logs
const logExporter = new OTLPLogExporter({
  url: `${otlpEndpoint}/v1/logs`,
});

const loggerProvider = new LoggerProvider({
  resource,
  processors: [new BatchLogRecordProcessor(logExporter)],
});
logs.setGlobalLoggerProvider(loggerProvider);

// SDK
const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          return url.startsWith('/_next') || url === '/favicon.ico';
        },
      },
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  Promise.all([
    sdk.shutdown(),
    meterProvider.shutdown(),
    loggerProvider.shutdown(),
  ])
    .then(() => console.log('Telemetry SDK shut down'))
    .catch((error) => console.error('Shutdown error', error))
    .finally(() => process.exit(0));
});
```

```mdx-code-block
</TabItem>
<TabItem value="selective" label="Selective Instrumentation">
```

Control which components are instrumented:

```typescript showLineNumbers title="src/lib/telemetry.ts"
const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy instrumentations
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      // Disable Redis if not using BullMQ tracing
      '@opentelemetry/instrumentation-ioredis': { enabled: false },

      // Configure HTTP instrumentation
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          // Skip Next.js internal routes and static assets
          return (
            url.startsWith('/_next') ||
            url === '/favicon.ico' ||
            url === '/api/health'
          );
        },
      },

      // MongoDB instrumentation
      '@opentelemetry/instrumentation-mongodb': {
        enabled: true,
      },
    }),
  ],
});
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Next.js Configuration

Configure Next.js to work properly with OpenTelemetry packages:

```typescript showLineNumbers title="next.config.ts"
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'mongoose',
    'bcrypt',
    'pino',
    'bullmq',
    'ioredis',
  ],
};

export default nextConfig;
```

The `serverExternalPackages` option ensures native modules are bundled correctly
for production deployment.

## Production Configuration

For production deployments with Docker:

### Dockerfile

```dockerfile showLineNumbers title="Dockerfile"
# Multi-stage Dockerfile for Next.js with OpenTelemetry

# Stage 1: Base
FROM node:24-alpine AS base

# Stage 2: Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 3: Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 4: Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

### Docker Compose

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build:
      context: .
      target: runner
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongodb:27017/nextjs-api?replicaSet=rs0
      - JWT_SECRET=${JWT_SECRET}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SERVICE_NAME=nextjs-app
    depends_on:
      mongodb:
        condition: service_healthy
      redis:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        ['CMD', 'wget', '-q', '--spider', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - app-network

  mongodb:
    image: mongo:8
    ports:
      - '27017:27017'
    volumes:
      - mongodb_data:/data/db
    command: ['--replSet', 'rs0', '--bind_ip_all']
    healthcheck:
      test: |
        mongosh --eval "try { rs.status().ok } catch(e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017' }] }).ok }" --quiet
      interval: 10s
      timeout: 10s
      retries: 5
    networks:
      - app-network

  redis:
    image: redis:8-alpine
    ports:
      - '6379:6379'
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.116.1
    command: ['--config=/etc/otelcol-config.yaml']
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-config.yaml:ro
    ports:
      - '4317:4317' # OTLP gRPC
      - '4318:4318' # OTLP HTTP
    environment:
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT}
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL}
    networks:
      - app-network

volumes:
  mongodb_data:

networks:
  app-network:
    driver: bridge
```

### OpenTelemetry Collector Configuration

```yaml showLineNumbers title="config/otel-config.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
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

exporters:
  otlphttp/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
```

## Framework-Specific Features

### API Routes (App Router)

Next.js API routes are automatically instrumented via HTTP instrumentation. Add
custom spans for business logic:

```typescript showLineNumbers title="src/app/api/articles/route.ts"
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { Article } from '@/models/Article';
import { withSpan } from '@/lib/telemetry';
import { recordArticle } from '@/lib/metrics';

export async function GET(request: NextRequest) {
  return withSpan('articles.list', async () => {
    try {
      await connectDB();

      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '10');
      const skip = (page - 1) * limit;

      const [articles, total] = await Promise.all([
        Article.find()
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('authorId', 'username'),
        Article.countDocuments(),
      ]);

      recordArticle('list', true);
      return NextResponse.json({
        success: true,
        data: { articles, total, page, limit },
      });
    } catch (error) {
      recordArticle('list', false);
      return NextResponse.json(
        { success: false, error: 'Failed to list articles' },
        { status: 500 }
      );
    }
  });
}

export async function POST(request: NextRequest) {
  return withSpan('articles.create', async () => {
    try {
      await connectDB();
      const body = await request.json();

      const article = await Article.create(body);

      recordArticle('create', true);
      return NextResponse.json(
        { success: true, data: article },
        { status: 201 }
      );
    } catch (error) {
      recordArticle('create', false);
      return NextResponse.json(
        { success: false, error: 'Failed to create article' },
        { status: 500 }
      );
    }
  });
}
```

### Custom Metrics

Create application-specific metrics:

```typescript showLineNumbers title="src/lib/metrics.ts"
import { getMeter } from './telemetry';

const meter = getMeter('api');

export const httpRequestCounter = meter.createCounter('http.server.requests', {
  description: 'Total number of HTTP requests',
  unit: '1',
});

export const httpRequestDuration = meter.createHistogram(
  'http.server.duration',
  {
    description: 'HTTP request duration in milliseconds',
    unit: 'ms',
  }
);

export const articleCounter = meter.createCounter('articles.operations', {
  description: 'Article operations count',
  unit: '1',
});

export const dbOperationDuration = meter.createHistogram(
  'db.operation.duration',
  {
    description: 'Database operation duration in milliseconds',
    unit: 'ms',
  }
);

export function recordRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number
): void {
  const attributes = {
    'http.method': method,
    'http.route': route,
    'http.status_code': statusCode,
  };

  httpRequestCounter.add(1, attributes);
  httpRequestDuration.record(durationMs, attributes);
}

export function recordArticle(
  operation: 'create' | 'update' | 'delete' | 'view' | 'list',
  success: boolean
): void {
  articleCounter.add(1, {
    operation,
    success: String(success),
  });
}
```

### BullMQ Background Jobs with Trace Propagation

Implement distributed tracing for background workers:

```typescript showLineNumbers title="src/lib/queue.ts"
import { Queue, Worker, Job } from 'bullmq';
import { context, propagation } from '@opentelemetry/api';
import { config } from './config';

const connectionConfig = {
  host: config.redisHost,
  port: config.redisPort,
};

export const emailQueue = new Queue('email', { connection: connectionConfig });

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

function injectTraceContext(): Record<string, string> {
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  return traceContext;
}

export async function addEmailJob(data: EmailJobData): Promise<Job> {
  const traceContext = injectTraceContext();
  return emailQueue.add(
    'send-email',
    { ...data, traceContext },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    }
  );
}
```

Worker with trace context extraction:

```typescript showLineNumbers title="src/jobs/worker.ts"
import { Job } from 'bullmq';
import {
  trace,
  context,
  propagation,
  SpanStatusCode,
  Context,
} from '@opentelemetry/api';
import { createEmailWorker, EmailJobData } from '../lib/queue';

const tracer = trace.getTracer('worker');

interface JobDataWithTrace {
  traceContext?: Record<string, string>;
}

function extractTraceContext(jobData: JobDataWithTrace): Context {
  if (jobData.traceContext) {
    return propagation.extract(context.active(), jobData.traceContext);
  }
  return context.active();
}

async function processWithSpan<T>(
  spanName: string,
  job: Job,
  parentContext: Context,
  processor: () => Promise<T>
): Promise<T> {
  return context.with(parentContext, async () => {
    return tracer.startActiveSpan(spanName, async (span) => {
      try {
        span.setAttribute('job.id', job.id || 'unknown');
        span.setAttribute('job.name', job.name);
        span.setAttribute('job.queue', job.queueName);
        span.setAttribute('job.attempt', job.attemptsMade);

        const result = await processor();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  });
}

const emailWorker = createEmailWorker(
  async (job: Job<EmailJobData & JobDataWithTrace>) => {
    const parentContext = extractTraceContext(job.data);

    await processWithSpan('job.email.send', job, parentContext, async () => {
      console.log(`Processing email job ${job.id}`);
      // Email sending logic here
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }
);

emailWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});
```

## Custom Instrumentation

### Creating Custom Spans

Use the `withSpan` utility for consistent span management:

```typescript showLineNumbers title="src/app/api/users/[id]/route.ts"
import { NextRequest, NextResponse } from 'next/server';
import { withSpan, getTracer, SpanStatusCode } from '@/lib/telemetry';
import { User } from '@/models/User';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withSpan(
    'users.get',
    async () => {
      const user = await User.findById(params.id);

      if (!user) {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, data: user });
    },
    { 'user.id': params.id }
  );
}
```

### Adding Attributes to Active Span

```typescript showLineNumbers title="src/lib/auth.ts"
import { trace, SpanStatusCode } from '@opentelemetry/api';
import jwt from 'jsonwebtoken';

export async function verifyToken(token: string): Promise<JwtPayload> {
  const currentSpan = trace.getActiveSpan();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (currentSpan) {
      currentSpan.setAttributes({
        'user.id': payload.userId,
        'auth.method': 'jwt',
      });
      currentSpan.addEvent('auth_success');
    }

    return payload;
  } catch (error) {
    if (currentSpan) {
      currentSpan.addEvent('auth_failed', { reason: 'invalid_token' });
      currentSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Token verification failed',
      });
    }
    throw error;
  }
}
```

### Nested Spans for Complex Operations

```typescript showLineNumbers title="src/services/article.service.ts"
import { getTracer, SpanStatusCode } from '@/lib/telemetry';
import { Article } from '@/models/Article';

const tracer = getTracer('article-service');

export async function publishArticle(articleId: string): Promise<void> {
  return tracer.startActiveSpan('article.publish', async (span) => {
    try {
      span.setAttribute('article.id', articleId);

      // Validate article
      await tracer.startActiveSpan('article.validate', async (validateSpan) => {
        const article = await Article.findById(articleId);
        if (!article) {
          throw new Error('Article not found');
        }
        validateSpan.setAttribute('article.title', article.title);
        validateSpan.end();
      });

      // Update status
      await tracer.startActiveSpan('article.updateStatus', async (updateSpan) => {
        await Article.findByIdAndUpdate(articleId, {
          published: true,
          publishedAt: new Date(),
        });
        updateSpan.addEvent('article_published');
        updateSpan.end();
      });

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
  });
}
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

Start with Turbopack for fast refresh:

```bash showLineNumbers
# Start with Turbopack (recommended)
npm run dev

# Or with standard webpack
npm run dev -- --no-turbo
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

Build and run the production server:

```bash showLineNumbers
# Build the application
npm run build

# Start production server
npm start
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

Deploy with Docker Compose:

```bash showLineNumbers
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f app

# Stop services
docker compose down
```

```mdx-code-block
</TabItem>
<TabItem value="worker" label="Background Worker">
```

Run the BullMQ worker process:

```bash showLineNumbers
# Development (with hot reload)
npm run worker

# Production (from built bundle)
node --import ./dist/instrumentation.js dist/worker.js
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verifying Instrumentation

Create a health endpoint that verifies OpenTelemetry is active:

```typescript showLineNumbers title="src/app/api/health/route.ts"
import { NextResponse } from 'next/server';
import { trace } from '@opentelemetry/api';

export async function GET() {
  const currentSpan = trace.getActiveSpan();

  if (currentSpan && currentSpan.isRecording()) {
    const spanContext = currentSpan.spanContext();

    return NextResponse.json({
      status: 'healthy',
      tracing: 'enabled',
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    });
  }

  return NextResponse.json({
    status: 'healthy',
    tracing: 'disabled',
  });
}
```

### Issue: No Traces from API Routes

**Solutions:**

1. Ensure `instrumentation.ts` exists at the project root
2. Verify the runtime check:

```typescript
export async function register() {
  // Must check for nodejs runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./src/lib/telemetry');
  }
}
```

1. Confirm telemetry module is imported correctly (check path)

### Issue: Mongoose Queries Not Traced

**Solutions:**

1. Add mongoose to `serverExternalPackages` in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose'],
};
```

1. Verify MongoDB instrumentation is enabled (not disabled in config)

### Issue: Next.js Internal Routes Creating Noise

**Solutions:**

Filter internal routes in HTTP instrumentation:

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  ignoreIncomingRequestHook: (request) => {
    const url = request.url || '';
    return (
      url.startsWith('/_next') ||
      url === '/favicon.ico' ||
      url.includes('__nextjs')
    );
  },
},
```

### Issue: Worker Traces Not Connected to API Traces

**Solutions:**

Ensure trace context is injected when enqueuing jobs:

```typescript
function injectTraceContext(): Record<string, string> {
  const traceContext: Record<string, string> = {};
  propagation.inject(context.active(), traceContext);
  return traceContext;
}

// Include traceContext in job data
await queue.add('job-name', { ...data, traceContext });
```

## Security Considerations

### Sensitive Data Protection

Avoid capturing sensitive information in spans:

```typescript showLineNumbers
// BAD - Exposes sensitive data
span.setAttributes({
  'user.password': password,
  'user.email': email,
  'api_key': apiKey,
});

// GOOD - Use safe identifiers
span.setAttributes({
  'user.id': userId,
  'user.type': 'customer',
  'request.has_api_key': Boolean(apiKey),
});
```

### HTTP Header Filtering

The HTTP instrumentation automatically excludes sensitive headers. For custom
headers:

```typescript showLineNumbers
'@opentelemetry/instrumentation-http': {
  headersToSpanAttributes: {
    requestHeaders: ['content-type', 'user-agent', 'x-request-id'],
    // Exclude: authorization, cookie, x-api-key
  },
},
```

### Environment Variable Security

Never commit secrets to version control:

```bash showLineNumbers title=".env.example"
# Good - Template without real values
JWT_SECRET=your-secret-key-at-least-32-characters
SCOUT_CLIENT_SECRET=your_client_secret

# Production: Use secrets management
# - AWS Secrets Manager
# - HashiCorp Vault
# - Kubernetes Secrets
```

## Performance Considerations

### Expected Performance Impact

| Metric      | Impact               | Notes                              |
| ----------- | -------------------- | ---------------------------------- |
| **Latency** | +0.5-2ms per request | Span creation and context overhead |
| **CPU**     | +2-5%                | During span export operations      |
| **Memory**  | +15-40MB             | SDK and span buffer overhead       |
| **Network** | +1-5KB per trace     | OTLP HTTP with gzip compression    |

### Optimization Best Practices

#### 1. Use BatchSpanProcessor (Default)

The NodeSDK uses BatchSpanProcessor by default, which batches spans for
efficient export.

#### 2. Skip Non-Critical Endpoints

```typescript showLineNumbers
ignoreIncomingRequestHook: (request) => {
  const url = request.url || '';
  return ['/api/health', '/api/metrics', '/_next', '/favicon.ico'].some(
    (path) => url.includes(path)
  );
},
```

#### 3. Disable Noisy Instrumentations

```typescript showLineNumbers
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },
  }),
],
```

#### 4. Limit Attribute Sizes

```typescript showLineNumbers
function addSafeAttribute(
  span: Span,
  key: string,
  value: string,
  maxLength: number = 256
) {
  if (value.length > maxLength) {
    value = value.substring(0, maxLength) + '...';
  }
  span.setAttribute(key, value);
}
```

#### 5. Configure Export Intervals

```typescript showLineNumbers
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
  exportIntervalMillis: 60000, // Export every 60 seconds in production
});
```

## FAQ

### Does OpenTelemetry work with Next.js App Router?

Yes, OpenTelemetry fully supports Next.js App Router. The `instrumentation.ts`
file at the project root initializes OpenTelemetry before any application code
runs. API routes, server components, and middleware are automatically traced.

### What's the performance impact on Next.js applications?

Expect +0.5-2ms latency per request, +2-5% CPU, and +15-40MB memory. This impact
is minimal for most production workloads. Use BatchSpanProcessor and filter
internal Next.js routes to minimize overhead.

### Which Next.js versions are supported?

Next.js 15.x and later are supported. Next.js 16.x with Turbopack is recommended
for best performance. The `instrumentation.ts` hook was stabilized in Next.js 15.

### How do I trace MongoDB/Mongoose queries?

MongoDB queries are automatically traced via the mongodb instrumentation
included in auto-instrumentations-node. Add `mongoose` to `serverExternalPackages`
in `next.config.ts` for proper bundling.

### How does distributed tracing work with BullMQ workers?

Inject trace context when enqueuing jobs using `propagation.inject()`, then
extract it in workers using `propagation.extract()`. This creates parent-child
relationships between API requests and background job execution.

### Can I use it with Next.js middleware?

Yes, middleware requests are traced via HTTP instrumentation. Add custom spans
in middleware using `trace.getActiveSpan()` to add attributes.

### How do I handle multi-tenant applications?

Add tenant ID as span attribute in your authentication middleware or API routes:

```typescript
const currentSpan = trace.getActiveSpan();
if (currentSpan) {
  currentSpan.setAttribute('tenant.id', tenantId);
}
```

Then filter by tenant in the Scout Dashboard.

### What's the difference between traces and metrics?

Traces show individual request flows with timing (e.g., "this API call took
150ms with 3 database queries"). Metrics aggregate measurements over time (e.g.,
"average response time is 120ms"). Use both together for complete observability.

### How do I trace server components?

Server components execute during rendering and are traced via HTTP
instrumentation. For specific component tracing, create custom spans within the
component's async data fetching logic.

### Can I export metrics to Prometheus?

Yes, add the Prometheus exporter for metrics scraping:

```typescript
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const prometheusExporter = new PrometheusExporter({ preventServerStart: true });
const meterProvider = new MeterProvider({
  readers: [otlpMetricReader, prometheusExporter],
});
```

## What's Next?

### Framework-Specific Guides

- **[Express.js Instrumentation](./express.md)** - Express framework patterns
- **[NestJS Instrumentation](./nestjs.md)** - NestJS with dependency injection
- **[Node.js Overview](./nodejs.md)** - General Node.js instrumentation guide

### Advanced Topics

- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans, context propagation, and advanced patterns

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for API latency, errors, and database queries
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards for Next.js metrics

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment on Kubernetes

## Complete Example

A complete production-ready example with Next.js 16, MongoDB, Redis, BullMQ,
and comprehensive OpenTelemetry instrumentation is available at:

**GitHub**:
[base-14/examples/nodejs/nextjs-api-mongodb](https://github.com/base-14/examples/tree/main/nodejs/nextjs-api-mongodb)

**Features**:

- Next.js 16.1.x with Turbopack
- Full auto-instrumentation with NodeSDK
- Custom spans, metrics, and logs
- BullMQ background job tracing with context propagation
- MongoDB with Mongoose 9.x
- Production Docker deployment (standalone output)
- JWT authentication
- Health check endpoints
- Graceful shutdown handling

### package.json

```json showLineNumbers title="package.json"
{
  "name": "nextjs-api-mongodb",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "worker": "tsx --import ./src/jobs/instrumentation.ts src/jobs/worker.ts"
  },
  "dependencies": {
    "next": "16.1.3",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "mongoose": "9.1.4",
    "bullmq": "5.66.5",
    "ioredis": "5.9.2",
    "@opentelemetry/api": "1.9.0",
    "@opentelemetry/sdk-node": "0.210.0",
    "@opentelemetry/auto-instrumentations-node": "0.68.0",
    "@opentelemetry/exporter-trace-otlp-http": "0.210.0",
    "@opentelemetry/exporter-metrics-otlp-http": "0.210.0",
    "@opentelemetry/resources": "2.4.0",
    "@opentelemetry/semantic-conventions": "1.39.0",
    "@opentelemetry/sdk-metrics": "2.4.0"
  }
}
```

### Environment Variables

```bash showLineNumbers title=".env.example"
# Application
NODE_ENV=development
PORT=3000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/nextjs-api?replicaSet=rs0

# Authentication
JWT_SECRET=your-super-secret-jwt-key-must-be-at-least-32-characters-long

# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=nextjs-api-mongodb

# Scout (production)
SCOUT_ENDPOINT=https://scout.example.com
SCOUT_CLIENT_ID=your-client-id
SCOUT_CLIENT_SECRET=your-client-secret
SCOUT_TOKEN_URL=https://auth.example.com/oauth/token
```

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [Next.js Instrumentation Documentation](https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [BullMQ Documentation](https://docs.bullmq.io/)

## Related Guides

- [Express.js Instrumentation](./express.md) - Express framework guide
- [NestJS Instrumentation](./nestjs.md) - NestJS framework guide
- [Node.js Overview](./nodejs.md) - General Node.js instrumentation
- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Advanced patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development setup
- [Kubernetes Deployment](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
