---
title: BullMQ OpenTelemetry Instrumentation - Job & Queue Tracing
sidebar_label: BullMQ
sidebar_position: 33
description:
  Instrument BullMQ with OpenTelemetry. Trace jobs end-to-end across producer
  and worker, propagate context through Redis, and export queue-depth metrics.
keywords:
  [
    bullmq opentelemetry instrumentation,
    bullmq monitoring,
    bullmq tracing,
    bullmq observability,
    bullmq job tracing,
    bullmq queue metrics,
    bullmq redis monitoring,
    opentelemetry bullmq,
    nodejs job queue observability,
    bullmq distributed tracing,
    bullmq worker monitoring,
    bullmq context propagation,
    bullmq apm,
    ioredis instrumentation opentelemetry,
    nestjs bullmq tracing,
    bullmq performance monitoring,
    background job tracing,
    nodejs queue monitoring,
    bullmq prometheus metrics,
    opentelemetry job queue,
  ]
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does OpenTelemetry auto-instrument BullMQ?","acceptedAnswer":{"@type":"Answer","text":"There is no dedicated BullMQ instrumentation in the auto-instrumentations-node bundle. The Redis commands BullMQ issues are traced automatically by instrumentation-ioredis, and you add manual spans plus W3C context propagation for job-level tracing across producer and worker."}},{"@type":"Question","name":"How do I trace a BullMQ job from producer to worker?","acceptedAnswer":{"@type":"Answer","text":"Inject the active trace context into the job data on the producer with propagation.inject, then extract it on the worker with propagation.extract and run the job span inside context.with. This links the enqueue span and the process span into one trace."}},{"@type":"Question","name":"Why do my BullMQ jobs show up as disconnected traces?","acceptedAnswer":{"@type":"Answer","text":"BullMQ does not carry trace context across the Redis boundary on its own. Without injecting context into job data on enqueue and extracting it in the worker, the worker starts a brand-new root span, so the job appears as a separate trace."}},{"@type":"Question","name":"How do I monitor BullMQ queue depth with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Use OpenTelemetry observable gauges that read queue.getWaitingCount(), getActiveCount(), getDelayedCount(), getFailedCount(), and getCompletedCount() on a short interval. These export waiting, active, delayed, failed, and completed job counts per queue."}},{"@type":"Question","name":"How much overhead does OpenTelemetry add to BullMQ workers?","acceptedAnswer":{"@type":"Answer","text":"With the batch span processor, expect roughly 0.5-2ms added per job from span creation and context propagation, low single-digit CPU increase, and 15-35MB extra memory on the worker process. The Redis round trips dominate job latency, not the instrumentation."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# BullMQ

## Overview

Implement OpenTelemetry instrumentation for [BullMQ](https://bullmq.io) to get
distributed tracing and metrics across your Redis-backed background jobs. This
guide shows you how to connect the enqueue side and the worker side into a
single trace, capture per-job spans with timing and error status, and export
queue-depth metrics so you can alert on backlog and failure rate.

BullMQ is a Redis-backed queue used to move slow or unreliable work - email,
notifications, webhooks, report generation, image processing - out of the
request path. Because the producer and the worker run in different processes and
communicate through Redis, a job that fails or runs slowly is hard to debug
without a trace that spans both sides. OpenTelemetry gives you that end-to-end
view.

Unlike database drivers or HTTP frameworks, BullMQ has **no dedicated
auto-instrumentation package** in the OpenTelemetry contrib bundle. Observability
comes from two pieces working together: the
[`instrumentation-ioredis`](https://www.npmjs.com/package/@opentelemetry/instrumentation-ioredis)
package, which automatically traces the Redis commands BullMQ runs, and a small
amount of manual instrumentation that creates a job span and propagates trace
context through the job payload. This guide covers both.

:::tip TL;DR

BullMQ jobs are not auto-traced end-to-end. Add
`@opentelemetry/instrumentation-ioredis` to get the underlying Redis command
spans, then on the producer inject the active context into the job data with
`propagation.inject`, and in the worker extract it with `propagation.extract`
and wrap the work in `tracer.startActiveSpan` inside `context.with`. Export
queue depth with OpenTelemetry observable gauges reading BullMQ's
`getWaitingCount()` / `getActiveCount()` family.

:::

## Who This Guide Is For

This documentation is designed for:

- **Node.js backend engineers** running BullMQ workers in production who need to
  see why a job is slow or failing.
- **Teams migrating from New Relic or Datadog** that had queue dashboards and
  want equivalent visibility on an OpenTelemetry-native stack.
- **NestJS developers** using `@nestjs/bullmq` who want producer-to-worker
  traces across the dependency injection layer.
- **Platform / SRE teams** standardizing background-job observability and alerts
  (backlog, failure rate, processing latency) across services.
- **Developers debugging distributed flows** where an HTTP request enqueues a
  job and the real work happens asynchronously in another process.

## Prerequisites

Before starting, ensure you have:

- **Node.js 18.x or later** (20.x LTS recommended for production)
- **BullMQ 5.x** (`bullmq`)
- **Redis 6.2 or later** (BullMQ requires Redis; 7.x recommended)
- **Scout Collector** configured and reachable
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production
- Basic understanding of OpenTelemetry concepts (traces, spans, context)
- Familiarity with the BullMQ `Queue` and `Worker` APIs

### Compatibility Matrix

| Component                                  | Minimum Version | Recommended Version |
| ------------------------------------------ | --------------- | ------------------- |
| Node.js                                    | 18.0.0          | 20.x LTS            |
| BullMQ                                      | 5.0.0           | 5.x                 |
| Redis                                       | 6.2.0           | 7.x                 |
| @opentelemetry/sdk-node                    | 0.45.0          | 0.54+               |
| @opentelemetry/instrumentation-ioredis     | 0.40.0          | 0.45+               |
| @opentelemetry/api                         | 1.7.0           | 1.9+                |

### What Gets Instrumented

| Signal source                  | How                                   | Automatic? |
| ------------------------------ | ------------------------------------- | ---------- |
| Redis commands (queue ops)     | `instrumentation-ioredis`             | Yes        |
| Job span (process lifecycle)   | manual `startActiveSpan`              | No         |
| Producer -> worker context     | `propagation.inject` / `extract`      | No         |
| Job counters / duration        | manual metrics instruments            | No         |
| Queue depth (waiting/active)   | observable gauges over BullMQ counts  | No         |

The runnable source for every snippet below lives in the
[base14 examples repo](https://github.com/base-14/examples/tree/main/nodejs/nestjs-postgres)
under `src/jobs/`.

## Installation

Install the OpenTelemetry SDK, the OTLP exporter, and the IORedis
instrumentation. BullMQ uses [ioredis](https://github.com/redis/ioredis) under
the hood, so the IORedis instrumentation is what captures its Redis traffic.

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash showLineNumbers
npm install --save \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-ioredis \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash showLineNumbers
yarn add \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-ioredis \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash showLineNumbers
pnpm add \
  @opentelemetry/sdk-node \
  @opentelemetry/api \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-ioredis \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

Initialize the SDK **before** any BullMQ or ioredis code runs, so the Redis
client is wrapped. Load this file first via `node --require ./instrumentation.js`
or as the first import in your worker entry point.

```mdx-code-block
<Tabs>
<TabItem value="sdk" label="SDK Setup (Recommended)" default>
```

```typescript showLineNumbers title="src/instrumentation.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'bullmq-worker',
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new IORedisInstrumentation({
      // Keep payloads small and free of secrets in span attributes
      dbStatementSerializer: (cmdName, cmdArgs) =>
        `${cmdName} ${cmdArgs.slice(0, 2).join(' ')}`,
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

```bash showLineNumbers title=".env"
# Service identification
OTEL_SERVICE_NAME=bullmq-worker
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=jobs

# Exporter
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

# BullMQ connection
REDIS_URL=redis://redis:6379
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

```yaml showLineNumbers title="docker-compose.yml"
services:
  worker:
    build: .
    command: ['node', '--require', './dist/instrumentation.js', 'dist/worker.js']
    environment:
      - OTEL_SERVICE_NAME=bullmq-worker
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
      - scout-collector

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4318:4318'
```

```mdx-code-block
</TabItem>
</Tabs>
```

> All approaches export traces and metrics to the base14 Scout observability
> backend through the OTLP endpoint.

## Traces

A complete BullMQ trace has two halves that live in different processes: the
**producer** that enqueues the job during an HTTP request, and the **worker**
that processes it later. The Redis commands in between are traced automatically
by the IORedis instrumentation. The job span and the link between the two halves
are manual.

### Automatic Redis Spans

Once `IORedisInstrumentation` is registered, every Redis command BullMQ issues -
`LPUSH`, `BRPOPLPUSH`, `HSET`, `XADD`, and so on - becomes a span. This shows you
how long enqueue and dequeue operations take and surfaces Redis latency, but it
does **not** group the work of a single job or connect the producer to the
worker. For that, add the job span and propagate context.

### Propagate Context on Enqueue

On the producer, inject the active trace context into the job payload before
calling `queue.add`. BullMQ serializes job data to Redis, so the W3C
`traceparent` travels with the job.

```typescript showLineNumbers title="src/jobs/notification.producer.ts"
import { Queue } from 'bullmq';
import { context, propagation, trace } from '@opentelemetry/api';

const notificationsQueue = new Queue('notifications', {
  connection: { url: process.env.REDIS_URL },
});

export async function enqueueArticlePublished(payload: {
  articleId: string;
  title: string;
  authorId: string;
}): Promise<string | undefined> {
  // Capture the current trace context into a carrier object
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  const job = await notificationsQueue.add(
    'article.published',
    { ...payload, traceContext: carrier },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  );

  trace.getActiveSpan()?.setAttribute('job.id', job.id ?? '');
  return job.id;
}
```

### Start the Job Span on the Worker

In the worker, pull the carrier back out of the job data, restore it as the
parent context, and create a `CONSUMER` span for the job. Everything that runs
inside `context.with` - including the automatic Redis and database spans -
becomes a child of the job span, and the whole thing is linked back to the
request that enqueued it.

```typescript showLineNumbers title="src/jobs/notification.worker.ts"
import { Worker, Job } from 'bullmq';
import {
  context,
  propagation,
  trace,
  metrics,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

const tracer = trace.getTracer('notification-worker');
const meter = metrics.getMeter('notification-worker');

const jobsCompleted = meter.createCounter('jobs.completed', {
  description: 'Number of jobs completed successfully',
});
const jobsFailed = meter.createCounter('jobs.failed', {
  description: 'Number of jobs that failed',
});
const jobDuration = meter.createHistogram('jobs.duration', {
  description: 'Duration of job processing in milliseconds',
  unit: 'ms',
});

new Worker(
  'notifications',
  async (job: Job) => {
    const startTime = Date.now();
    const { traceContext, ...payload } = job.data;

    const parentContext = propagation.extract(
      context.active(),
      traceContext ?? {},
    );

    await context.with(parentContext, async () => {
      await tracer.startActiveSpan(
        'job.process',
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'job.id': job.id,
            'job.name': job.name,
            'job.queue': job.queueName,
            'job.attempt': job.attemptsMade + 1,
          },
        },
        async (span) => {
          try {
            await handleArticlePublished(payload);
            span.setStatus({ code: SpanStatusCode.OK });
            jobsCompleted.add(1, { queue: job.queueName });
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            jobsFailed.add(1, { queue: job.queueName });
            throw error;
          } finally {
            const duration = Date.now() - startTime;
            jobDuration.record(duration, { queue: job.queueName });
            span.setAttribute('job.duration_ms', duration);
            span.end();
          }
        },
      );
    });
  },
  { connection: { url: process.env.REDIS_URL } },
);
```

### Trace Hierarchy

```text
HTTP Request Span (root: POST /articles)
├── PostgreSQL INSERT Span (create article)
├── Redis LPUSH Span (enqueue: ioredis instrumentation)
│
└── (later, in the worker process — linked via traceparent in job data)
    job.process Span (CONSUMER, kind=consumer)
    ├── article.publish.update Span
    │   └── PostgreSQL UPDATE Span
    └── notification.send Span
```

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Metrics

Spans explain one job; metrics tell you about the queue as a whole - throughput,
failure rate, and backlog. Two kinds are useful for BullMQ: per-job counters and
a histogram (recorded in the worker, shown above), and queue-depth gauges
(sampled on an interval).

### Enable the Meter Provider

If you are not already exporting metrics, add an OTLP metric reader to the SDK
config from the Configuration section:

```typescript showLineNumbers title="src/instrumentation.ts"
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

// inside new NodeSDK({ ... })
metricReader: new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: `${otlpEndpoint}/v1/metrics`,
  }),
  exportIntervalMillis: 15000,
}),
```

### Queue-Depth Gauges

BullMQ exposes live counts per state. Read them on an interval and report them
through OpenTelemetry observable gauges. These are the metrics you alert on:
rising `waiting` means the workers cannot keep up, and rising `failed` means
something is broken downstream.

```typescript showLineNumbers title="src/jobs/queue-metrics.ts"
import { metrics } from '@opentelemetry/api';
import { Queue } from 'bullmq';

const meter = metrics.getMeter('job-queue-metrics');
const queue = new Queue('notifications', {
  connection: { url: process.env.REDIS_URL },
});

let stats = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };

const states = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
for (const state of states) {
  meter
    .createObservableGauge(`job_queue_${state}`, {
      description: `Number of ${state} jobs in the queue`,
    })
    .addCallback((result) =>
      result.observe(stats[state], { queue: 'notifications' }),
    );
}

setInterval(async () => {
  const [waiting, active, delayed, failed, completed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
    queue.getFailedCount(),
    queue.getCompletedCount(),
  ]);
  stats = { waiting, active, delayed, failed, completed };
}, 5000);
```

> View these metrics in your base14 Scout dashboard to chart throughput, failure
> ratio, and queue backlog, and to alert when `waiting` or `failed` climbs.

#### Reference

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

## Production Configuration

In production, batch span export and tune the worker so instrumentation does not
become the bottleneck.

```typescript showLineNumbers title="src/instrumentation.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'bullmq-worker',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
    'deployment.environment.name': process.env.NODE_ENV || 'production',
  }),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      }),
      {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
      },
    ),
  ],
  instrumentations: [new IORedisInstrumentation()],
});

sdk.start();
```

```dockerfile showLineNumbers title="Dockerfile"
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV OTEL_SERVICE_NAME=bullmq-worker
# Load instrumentation before the worker
CMD ["node", "--require", "./dist/instrumentation.js", "dist/worker.js"]
```

For high-throughput queues, run multiple worker processes and set BullMQ
`concurrency` per worker. Each process exports its own spans and metrics with a
distinct `service.instance.id`, and the job spans still link back to the
originating request through the propagated context.

## Framework-Specific Features

### Framework Integration

BullMQ's `Queue` and `Worker` API is the same regardless of the web framework
in front of it, so the instrumentation code is identical: `propagation.inject`
before `queue.add` on the producer, then `propagation.extract` → `context.with`
→ `startActiveSpan` on the worker. Only three things vary - where the producer
lives, whether the worker shares the web process, and how the SDK is bootstrapped.

| Framework | Producer injects in | Worker runs as | SDK bootstrap |
|-----------|--------------------|----------------|---------------|
| Express | route/service helper | standalone process | `telemetry.ts` preloaded (`node -r ./telemetry`) |
| Fastify | `jobs/tasks/*.ts` | standalone process | `telemetry.ts` preloaded |
| Hono | `jobs/tasks/*.ts` | standalone process | `telemetry.ts` preloaded |
| Next.js | `lib/queue.ts` wrapper | separate process (not the Next server) | `instrumentation.ts` `register()` hook |
| NestJS | `@InjectQueue` service | `@Processor` / `WorkerHost` | `instrumentation.ts` preloaded |

The span code does not change between these - copy the producer and worker
snippets from the [Traces](#traces) section as-is. NestJS is the only one where
the decorators move where that code sits, shown below. Working versions of each
live in the [base14 examples repo](https://github.com/base-14/examples/tree/main/nodejs).

### NestJS (@nestjs/bullmq)

With `@nestjs/bullmq`, the producer is a service that injects the queue and the
worker is a `WorkerHost`. The OpenTelemetry calls are identical - inject on
enqueue, extract and `startActiveSpan` in `process`.

```typescript showLineNumbers title="src/jobs/notification.service.ts"
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { context, propagation, trace } from '@opentelemetry/api';

@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue('notifications') private notificationsQueue: Queue,
  ) {}

  async notifyArticlePublished(articleId: string, title: string) {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    const job = await this.notificationsQueue.add(
      'article.published',
      { articleId, title, traceContext: carrier },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    trace.getActiveSpan()?.setAttribute('job.id', job.id ?? '');
    return job.id;
  }
}
```

```typescript showLineNumbers title="src/jobs/notification.processor.ts"
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

const tracer = trace.getTracer('notification-processor');

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    const { traceContext, ...payload } = job.data;
    const parentContext = propagation.extract(context.active(), traceContext);

    await context.with(parentContext, async () => {
      await tracer.startActiveSpan(
        'job.process',
        { kind: SpanKind.CONSUMER, attributes: { 'job.id': job.id } },
        async (span) => {
          try {
            await this.handle(payload);
            span.setStatus({ code: SpanStatusCode.OK });
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    });
  }

  private async handle(payload: unknown): Promise<void> {
    // business logic
  }
}
```

See the full NestJS implementation, including metrics and structured logs, in
the [base14 example](https://github.com/base-14/examples/tree/main/nodejs/nestjs-postgres).

### FlowProducer and Child Jobs

BullMQ `FlowProducer` creates parent/child job trees. Inject context into each
job's data the same way; the child worker extracts its own job's carrier so each
node in the flow links back to the request that started it.

## Custom Instrumentation

Add child spans inside the job span for the meaningful steps of your work, so a
slow job points you at the exact operation:

```typescript showLineNumbers title="src/jobs/notification.processor.ts"
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('notification-processor');

async function sendNotification(recipient: string): Promise<void> {
  await tracer.startActiveSpan(
    'notification.send',
    { attributes: { 'notification.recipient': recipient } },
    async (span) => {
      try {
        await deliver(recipient);
        span.setStatus({ code: SpanStatusCode.OK });
      } finally {
        span.end();
      }
    },
  );
}
```

To correlate logs with traces, attach the active trace and span IDs to log
records:

```typescript showLineNumbers
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
logger.info('Article published', {
  'trace.id': span?.spanContext().traceId,
  'span.id': span?.spanContext().spanId,
});
```

## Running Your Application

Start Redis, the collector, the worker, and the producer, then trigger a job and
follow it in Scout.

```bash showLineNumbers
# Start infrastructure
docker compose up -d redis scout-collector

# Run the worker (instrumentation loaded first)
node --require ./dist/instrumentation.js dist/worker.js

# In another terminal, run the producer / API
node --require ./dist/instrumentation.js dist/server.js

# Enqueue a job
curl -X POST http://localhost:3000/articles \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hello","authorId":"u_1"}'
```

Expected span hierarchy for the request and the job (two linked traces): the
`POST /articles` request span with a Redis `LPUSH` child, then a `job.process`
consumer span in the worker carrying the same trace ID, with its own database
and `notification.send` children.

## Troubleshooting

### Issue: Worker jobs appear as separate, disconnected traces

The most common problem. The worker is starting a new root span because no
context was propagated. Confirm the producer calls `propagation.inject` into the
job data **and** the worker calls `propagation.extract` and runs the span inside
`context.with(parentContext, ...)`. The carrier key in the job payload
(`traceContext`) must match on both sides.

### Issue: No Redis spans at all

The SDK started after the BullMQ/ioredis modules were imported, so the client
was never wrapped. Load `instrumentation.ts` first - use
`node --require ./instrumentation.js` or make it the very first import in your
entry file.

### Issue: Job span has no children for database or HTTP calls

Those calls are running outside `context.with`. Make sure all of the job's work
happens inside the `startActiveSpan` callback so the active context is set when
the database and HTTP instrumentations create their spans.

### Issue: Retried jobs are confusing in the trace view

Each attempt runs the worker again and creates a new `job.process` span linked to
the original enqueue. Use the `job.attempt` attribute (`job.attemptsMade + 1`) to
distinguish attempts, and set the span status to ERROR on the failing attempts.

### Issue: Queue-depth gauges always read zero

The `Queue` instance used for metrics must point at the same Redis connection and
queue name as the workers. Verify `REDIS_URL` and the queue name match, and that
the sampling `setInterval` is actually running in a live process.

## Security Considerations

- **Do not put secrets in job data.** Job payloads are stored in Redis and, if
  you add them as span attributes, exported to your backend. Pass identifiers,
  not credentials or PII.
- **Trim Redis statement attributes.** The `dbStatementSerializer` shown in the
  SDK config truncates command arguments so queue contents are not captured
  verbatim in spans.
- **Secure Redis.** Use authentication and TLS (`rediss://`) in production;
  BullMQ inherits the connection security you configure on ioredis.
- **Be deliberate about attributes.** Only attach business fields you are
  comfortable storing centrally (article IDs are fine; email bodies are not).

## Performance Considerations

- **Overhead.** Expect roughly 0.5-2ms added per job from span creation and
  context propagation, low single-digit CPU increase, and 15-35MB additional
  memory on the worker process. Redis round trips dominate job latency, not the
  instrumentation.
- **Batch export.** Use `BatchSpanProcessor` (Production Configuration) so export
  happens off the hot path.
- **Sample queue metrics sensibly.** A 5s gauge interval is plenty; polling
  BullMQ counts too aggressively adds Redis load for little benefit.
- **Filter noisy Redis commands** if needed via the IORedis instrumentation
  hooks, but keep the queue operations you care about.

## FAQ

### Does OpenTelemetry auto-instrument BullMQ?

No. There is no dedicated BullMQ package in `auto-instrumentations-node`. The
Redis commands BullMQ issues are traced automatically by
`instrumentation-ioredis`, and you add manual spans plus context propagation for
job-level, producer-to-worker tracing.

### How do I trace a BullMQ job from producer to worker?

Inject the active context into the job data with `propagation.inject` on
enqueue, then extract it with `propagation.extract` in the worker and run the job
span inside `context.with`. This stitches the enqueue and process spans into one
trace.

### Why do my BullMQ jobs show up as disconnected traces?

BullMQ does not carry trace context across Redis on its own. Without injecting
context into the job data and extracting it in the worker, the worker starts a
fresh root span, so the job looks like a separate trace.

### How do I monitor BullMQ queue depth with OpenTelemetry?

Use observable gauges that read `getWaitingCount()`, `getActiveCount()`,
`getDelayedCount()`, `getFailedCount()`, and `getCompletedCount()` on an
interval, reporting one gauge per state with a `queue` attribute.

### Does instrumentation-ioredis cover BullMQ completely?

It covers the Redis command layer, which is the transport. It does not group a
job's work into one span or link producer and worker - that is what the manual
job span and context propagation add.

### How much overhead does OpenTelemetry add to BullMQ workers?

Roughly 0.5-2ms per job and low single-digit CPU, with 15-35MB extra memory per
worker process when using the batch span processor. The Redis and downstream
calls dominate job time.

### Can I trace BullMQ flows and child jobs?

Yes. With `FlowProducer`, inject context into each job's data. Every child worker
extracts its own carrier, so each node in the flow links back to the originating
request.

### How do I trace failed and retried jobs?

Each retry re-runs the worker and creates a new `job.process` span. Record the
exception and set the span status to ERROR on failures, and use the
`job.attempt` attribute to tell attempts apart.

### Does this work with NestJS @nestjs/bullmq?

Yes. The producer service and the `WorkerHost` processor use the exact same
`propagation.inject` / `propagation.extract` and `startActiveSpan` calls; only
the BullMQ wiring differs.

### How do I propagate context through delayed or scheduled jobs?

The same way - context is injected into the job data at enqueue time and travels
with the job in Redis regardless of how long it is delayed. The worker extracts
it whenever the job eventually runs.

### Should I sample BullMQ traces?

This guide does not cover sampling. Export the spans your workers produce and let
the collector handle volume centrally.

## What's Next

- Build a queue dashboard in Scout from the `jobs.*` and `job_queue_*` metrics.
- Set alerts on `job_queue_waiting` (backlog) and the `jobs.failed` rate.
- Add child spans for the slow steps inside your jobs.

For teams standardizing background-job observability across services, base14
Scout gives you [unified traces, metrics, and logs](https://base14.io/scout) for
producers and workers in one place.

## Complete Example

A complete NestJS + BullMQ + PostgreSQL application with producer-to-worker
tracing, job metrics, queue-depth gauges, and trace-correlated logs is available
in the base14 examples repository.

```text
nestjs-postgres/
├── src/
│   ├── instrumentation / telemetry.ts   # SDK + ioredis instrumentation
│   └── jobs/
│       ├── notification.service.ts      # producer: inject context, enqueue
│       ├── notification.processor.ts    # worker: extract context, job span
│       └── job-metrics.service.ts       # queue-depth observable gauges
└── docker-compose.yml
```

```bash showLineNumbers
git clone https://github.com/base-14/examples.git
cd examples/nodejs/nestjs-postgres
npm install
docker compose up -d
npm run start:dev
```

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [OpenTelemetry JavaScript SDK](https://opentelemetry.io/docs/languages/js/)
- [IORedis Instrumentation](https://www.npmjs.com/package/@opentelemetry/instrumentation-ioredis)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)

## Related Guides

- [NestJS Instrumentation](./nestjs.md) - Structured TypeScript framework that
  uses BullMQ for background jobs
- [Express Instrumentation](./express.md) - Enqueue jobs from an Express API
- [Fastify Instrumentation](./fastify.md) - High-performance Node.js web
  framework
- [Node.js Custom Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans and advanced patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up the collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production collector deployment
- [All framework guides](/instrument/apps/auto-instrumentation/) -
  Auto-instrumentation overview for every language
