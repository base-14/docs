---
title: Node.js OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Node.js
sidebar_position: 11
description:
  Node.js OpenTelemetry instrumentation for Express, NestJS, Fastify with
  database, Redis, and message queue tracing using base14 Scout.
keywords:
  [
    nodejs opentelemetry instrumentation,
    nodejs monitoring,
    nodejs apm,
    nodejs distributed tracing,
    nodejs observability,
    nodejs performance monitoring,
    opentelemetry nodejs,
    nodejs telemetry,
    express monitoring,
    nestjs monitoring,
    nodejs application monitoring,
    nodejs tracing,
    nodejs metrics,
    opentelemetry auto-instrumentation nodejs,
    nodejs instrumentation guide,
    nodejs production monitoring,
    typescript opentelemetry,
    nodejs microservices tracing,
    nodejs async tracing,
    nodejs database monitoring,
    mongoose instrumentation,
    typeorm instrumentation,
    redis nodejs monitoring,
    bullmq instrumentation,
    nodejs debugging performance,
    opentelemetry sdk nodejs,
    nodejs observability platform,
    nodejs telemetry data,
    express.js instrumentation,
    fastify instrumentation,
    koa instrumentation,
  ]
---

# Node.js

## Introduction

Implement OpenTelemetry instrumentation for Node.js applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide covers auto-instrumentation setup for popular Node.js
frameworks including Express, NestJS, Fastify, and Koa, with production-ready
configurations for collecting traces and metrics.

Node.js applications benefit from automatic instrumentation of the event loop,
async operations, popular frameworks (Express, NestJS, Fastify), database
clients (MongoDB, PostgreSQL, MySQL), Redis, message queues (BullMQ, RabbitMQ),
and HTTP clients. With OpenTelemetry, you can monitor async context propagation,
identify performance bottlenecks, trace distributed transactions across
microservices, and debug issues in production without significant code changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like New Relic or Datadog, or troubleshooting async
performance issues in production, this guide provides framework-agnostic patterns
and best practices for Node.js OpenTelemetry instrumentation with Base14 Scout.

## Who This Guide Is For

This documentation is designed for:

- **Node.js developers**: implementing observability and distributed tracing
  across Express, NestJS, or other frameworks
- **Backend engineers**: deploying Node.js microservices with production
  monitoring requirements
- **DevOps teams**: standardizing observability across multiple Node.js services
  and containers
- **Full-stack developers**: debugging performance issues in async operations,
  database queries, and API calls
- **Platform engineers**: migrating from DataDog, New Relic, or Dynatrace to
  OpenTelemetry-based solutions

## Overview

This guide covers Node.js OpenTelemetry instrumentation across all major
frameworks. For framework-specific details, see:

- **[Express.js](./express.md)** - Express 4.x and 5.x instrumentation with
  MongoDB, Redis, WebSockets
- **NestJS** - Enterprise framework with DI, TypeORM, BullMQ, WebSocket gateway
  (coming soon)
- **Fastify** - High-performance framework instrumentation
- **Koa** - Middleware-based framework patterns
- **Next.js** - React framework with SSR/SSG instrumentation (coming soon)

### What You'll Learn

- Auto-instrument Node.js applications with zero code changes
- Configure OpenTelemetry SDK for production deployments
- Trace async operations and maintain context across event loop
- Monitor database queries, HTTP requests, and external API calls
- Implement custom instrumentation for business logic
- Optimize performance and reduce telemetry overhead
- Debug common issues and verify trace collection

## Prerequisites

Before starting, ensure you have:

- **Node.js 18.x or later** (20.x LTS recommended for production)
- **npm 9.x or later** or **yarn 1.22+** package manager
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)
- Familiarity with async/await patterns in Node.js

### Compatibility Matrix

| Component                   | Minimum Version | Recommended Version |
| --------------------------- | --------------- | ------------------- |
| Node.js                     | 18.0.0          | 20.x LTS or 22.x    |
| @opentelemetry/sdk-node     | 0.40.0          | 0.54.0+             |
| @opentelemetry/auto-inst... | 0.40.0          | 0.54.0+             |
| TypeScript (optional)       | 4.5.0           | 5.3.0+              |

### Supported Libraries

OpenTelemetry auto-instrumentation automatically traces these popular Node.js
libraries:

**Web Frameworks**: Express, NestJS, Fastify, Koa, Hapi, Restify

**Databases**: MongoDB (Mongoose), PostgreSQL (pg, Sequelize), MySQL, Redis,
Prisma, TypeORM

**HTTP Clients**: axios, node-fetch, got, request, http/https (built-in)

**Message Queues**: BullMQ, RabbitMQ (amqplib), Kafka

**Other**: Socket.IO, GraphQL, gRPC, Winston, Pino (logging)

## Installation

Install the OpenTelemetry SDK and auto-instrumentation packages:

```bash showLineNumbers title="Install OpenTelemetry for Node.js"
npm install --save \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

For TypeScript projects, add type definitions:

```bash showLineNumbers
npm install --save-dev @types/node
```

## Configuration

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="separate-file" label="Separate File (Recommended)" default>
```

Create a dedicated file to initialize OpenTelemetry before your application
starts:

```javascript showLineNumbers title="instrumentation.js"
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} = require('@opentelemetry/semantic-conventions');

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME || 'nodejs-service',
    [SEMRESATTRS_SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Customize per-instrumentation config
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Disable filesystem tracing
      },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          // Skip health check endpoints
          return req.url?.includes('/health');
        },
      },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

module.exports = sdk;
```

Update your application startup:

```javascript showLineNumbers title="server.js"
// IMPORTANT: Require instrumentation FIRST, before any other imports
require('./instrumentation');

const express = require('express');
const app = express();

// Your application code here
app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

For containerized deployments, use environment variables without code changes:

```bash showLineNumbers title=".env"
# Service identification
OTEL_SERVICE_NAME=nodejs-api
OTEL_SERVICE_VERSION=1.0.0
NODE_ENV=production

# Exporter configuration
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

# Resource attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=backend

# Instrumentation settings
OTEL_NODE_ENABLED_INSTRUMENTATIONS=http,express,mongodb,redis
OTEL_PROPAGATORS=tracecontext,baggage

# Performance tuning
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_BSP_SCHEDULE_DELAY=5000
```

Then use the `--require` flag to load instrumentation:

```bash showLineNumbers
node --require ./instrumentation.js server.js
```

```mdx-code-block
</TabItem>
<TabItem value="typescript" label="TypeScript">
```

For TypeScript projects with ES modules:

```typescript showLineNumbers title="instrumentation.ts"
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME || 'nodejs-service',
    [SEMRESATTRS_SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

export default sdk;
```

Update `tsconfig.json`:

```json showLineNumbers title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true
  }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

For production deployments, use BatchSpanProcessor with optimized settings:

```javascript showLineNumbers title="instrumentation.production.js"
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const {
  BatchSpanProcessor,
} = require('@opentelemetry/sdk-trace-base');
const {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_INSTANCE_ID,
} = require('@opentelemetry/semantic-conventions');

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: {
    // Optional: Add authentication headers for Scout
    // 'Authorization': `Bearer ${process.env.SCOUT_API_KEY}`
  },
  timeoutMillis: 15000,
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: process.env.SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: process.env.SERVICE_VERSION,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    [SEMRESATTRS_SERVICE_INSTANCE_ID]:
      process.env.HOSTNAME || `${process.pid}`,
    'service.namespace': process.env.SERVICE_NAMESPACE || 'default',
    'container.id': process.env.CONTAINER_ID,
    'k8s.pod.name': process.env.K8S_POD_NAME,
    'k8s.namespace.name': process.env.K8S_NAMESPACE,
  }),
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => {
          const ignorePaths = ['/health', '/metrics', '/ready'];
          return ignorePaths.some((path) => req.url?.includes(path));
        },
      },
    }),
  ],
});

sdk.start();

// Handle graceful shutdown
const shutdown = () => {
  sdk
    .shutdown()
    .then(() => console.log('SDK shut down successfully'))
    .catch((error) => console.error('Error shutting down SDK', error))
    .finally(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

### Docker Deployment

```dockerfile showLineNumbers title="Dockerfile"
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Set OpenTelemetry environment variables
ENV OTEL_SERVICE_NAME=nodejs-api
ENV OTEL_TRACES_EXPORTER=otlp
ENV NODE_OPTIONS="--require ./instrumentation.js"

EXPOSE 3000

CMD ["node", "server.js"]
```

```yaml showLineNumbers title="docker-compose.yml"
version: '3.8'

services:
  nodejs-api:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - OTEL_SERVICE_NAME=nodejs-api
      - OTEL_SERVICE_VERSION=1.0.0
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
      - OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4318:4318'
```

## Custom Instrumentation

For business logic and application-specific operations, add manual spans:

```javascript showLineNumbers title="services/order-service.js"
const { trace } = require('@opentelemetry/api');

class OrderService {
  async createOrder(userId, items) {
    const tracer = trace.getTracer('order-service');

    return tracer.startActiveSpan('createOrder', async (span) => {
      try {
        span.setAttributes({
          'user.id': userId,
          'order.items.count': items.length,
          'order.total': items.reduce((sum, item) => sum + item.price, 0),
        });

        // Validate items
        await tracer.startActiveSpan('validateItems', async (validateSpan) => {
          await this.validateItems(items);
          validateSpan.end();
        });

        // Create order in database
        const order = await tracer.startActiveSpan(
          'saveOrderToDatabase',
          async (dbSpan) => {
            const result = await this.db.orders.create({
              userId,
              items,
              createdAt: new Date(),
            });
            dbSpan.setAttribute('order.id', result.id);
            dbSpan.end();
            return result;
          }
        );

        // Send confirmation email
        await tracer.startActiveSpan('sendConfirmation', async (emailSpan) => {
          await this.emailService.sendOrderConfirmation(userId, order.id);
          emailSpan.end();
        });

        span.setStatus({ code: 1 }); // OK
        return order;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: 2, message: error.message }); // ERROR
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async validateItems(items) {
    // Validation logic
    if (items.length === 0) {
      throw new Error('Order must contain at least one item');
    }
  }
}

module.exports = OrderService;
```

## Running Your Application

### Development Mode

```bash showLineNumbers
# With console output for debugging
export OTEL_TRACES_EXPORTER=console
node --require ./instrumentation.js server.js
```

### Production Mode

```bash showLineNumbers
export NODE_ENV=production
export OTEL_SERVICE_NAME=nodejs-api
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.yourdomain.com/v1/traces
node --require ./instrumentation.js server.js
```

### Using PM2

```javascript showLineNumbers title="ecosystem.config.js"
module.exports = {
  apps: [
    {
      name: 'nodejs-api',
      script: 'server.js',
      node_args: '--require ./instrumentation.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        OTEL_SERVICE_NAME: 'nodejs-api',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://scout-collector:4318',
      },
    },
  ],
};
```

## Troubleshooting

### Issue: No Traces Appearing in Scout Dashboard

**Solutions:**

1. Verify collector connectivity:

```javascript showLineNumbers
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});

// Send test span
exporter
  .export([{ name: 'test-span' }], (result) => {
    console.log('Export result:', result);
  })
  .catch(console.error);
```

1. Enable debug logging:

```bash
export OTEL_LOG_LEVEL=debug
node --require ./instrumentation.js server.js
```

1. Check if instrumentation loads before application:

```javascript
// WRONG - instrumentation loaded too late
const express = require('express');
require('./instrumentation');

// CORRECT - instrumentation loaded first
require('./instrumentation');
const express = require('express');
```

### Issue: Missing Async Context in Traces

**Solutions:**

Ensure async operations use `async/await` or properly propagate context:

```javascript showLineNumbers
const { context, trace } = require('@opentelemetry/api');

// WRONG - loses context
async function processData() {
  setTimeout(() => {
    // This runs in different async context
    const span = trace.getActiveSpan(); // undefined!
  }, 1000);
}

// CORRECT - preserve context
async function processData() {
  const activeContext = context.active();
  setTimeout(() => {
    context.with(activeContext, () => {
      const span = trace.getActiveSpan(); // Works!
    });
  }, 1000);
}
```

### Issue: High Memory Usage

**Solutions:**

1. Reduce batch size and queue limits:

```javascript
spanProcessor: new BatchSpanProcessor(traceExporter, {
  maxQueueSize: 1024,  // Reduced from 2048
  maxExportBatchSize: 256,  // Reduced from 512
}),
```

1. Disable unnecessary instrumentations:

```javascript
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
  }),
];
```

### Issue: TypeScript Compilation Errors

**Solutions:**

Install type definitions:

```bash
npm install --save-dev \
  @types/node \
  @types/express
```

## Performance Considerations

OpenTelemetry instrumentation adds minimal overhead to Node.js applications:

**Expected Impact:**

- **Latency**: +0.5-2ms per request (automatic instrumentation)
- **CPU**: +2-5% in production with BatchSpanProcessor
- **Memory**: +10-30MB for trace buffers and SDK
- **Event Loop**: Minimal impact with proper batching

### Optimization Best Practices

#### 1. Use BatchSpanProcessor in Production

```javascript showLineNumbers
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

spanProcessor: new BatchSpanProcessor(traceExporter, {
  maxQueueSize: 2048,
  scheduledDelayMillis: 5000,  // Export every 5 seconds
});
```

#### 2. Skip Health Check and Metrics Endpoints

```javascript showLineNumbers
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (req) => {
        return ['/health', '/metrics', '/ready'].some((path) =>
          req.url?.includes(path)
        );
      },
    },
  }),
];
```

#### 3. Disable Filesystem and DNS Tracing

```javascript showLineNumbers
'@opentelemetry/instrumentation-fs': { enabled: false },
'@opentelemetry/instrumentation-dns': { enabled: false },
```

## Security Considerations

### Sensitive Data in Spans

Avoid capturing sensitive information in span attributes:

```javascript showLineNumbers
// BAD - Exposes sensitive data
span.setAttributes({
  'user.password': userPassword,
  'credit_card.number': ccNumber,
});

// GOOD - Use safe identifiers
span.setAttributes({
  'user.id': userId,
  'payment.method': 'credit_card',
  'payment.last4': last4Digits,
});
```

### HTTP Header Filtering

Configure header filtering for sensitive authentication tokens:

```javascript showLineNumbers
'@opentelemetry/instrumentation-http': {
  headersToSpanAttributes: {
    requestHeaders: ['content-type', 'user-agent'],
    responseHeaders: ['content-type'],
  },
},
```

## What's Next?

### Framework-Specific Guides

- **[Express.js Instrumentation](./express.md)** - Detailed Express 4.x/5.x
  setup with MongoDB, Redis, and WebSockets
- **NestJS Instrumentation** - Enterprise DI framework with TypeORM and BullMQ
  (coming soon)
- **Fastify Instrumentation** - High-performance framework patterns (coming
  soon)

### Advanced Topics

- [Custom JavaScript Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual spans and advanced patterns
- [Celery Background Jobs](./celery.md) - Distributed task tracing

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for latency and errors
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment

## FAQ

### Does OpenTelemetry work with TypeScript?

Yes, OpenTelemetry fully supports TypeScript with official type definitions.
Install `@types/node` and use `.ts` instrumentation files.

### What's the performance impact on Node.js applications?

With BatchSpanProcessor, expect +0.5-2ms latency per request, +2-5% CPU, and
+10-30MB memory. Impact is minimal for most production workloads.

### Can I use OpenTelemetry with Express, NestJS, and Fastify?

Yes, auto-instrumentation supports all major Node.js frameworks including
Express, NestJS, Fastify, Koa, and Hapi automatically.

### How do I trace async operations and callbacks?

OpenTelemetry automatically propagates context through async/await. For
callbacks, manually propagate context using `context.with()`.

### Does it work with Mongoose, TypeORM, and Prisma?

Yes, auto-instrumentation includes MongoDB (Mongoose), PostgreSQL (pg, Sequelize,
TypeORM), MySQL, and Prisma ORM.

### Can I trace BullMQ and RabbitMQ jobs?

Yes, auto-instrumentation includes BullMQ, RabbitMQ (amqplib), and other message
queue libraries.

### How do I handle multi-tenant applications?

Add tenant identifiers as span attributes: `span.setAttribute('tenant.id',
tenantId)` and filter in Scout Dashboard.

### What's the difference between traces and metrics?

Traces show request flow and timing (spans), while metrics aggregate performance
data (counters, histograms). Both are supported by OpenTelemetry.

## Complete Example

This guide provides framework-agnostic Node.js instrumentation patterns. For
complete working examples with full application code, see the framework-specific
guides:

### Express.js

```bash showLineNumbers title="Quick Start"
git clone https://github.com/base-14/examples.git
cd examples/nodejs/express-mongodb

npm install
docker-compose up -d

# Run with tracing
node --require ./instrumentation.js server.js
```

See **[Express.js Instrumentation](./express.md)** for the complete guide with
MongoDB, Redis, WebSockets, and BullMQ integration.

### NestJS

```bash showLineNumbers title="Quick Start"
git clone https://github.com/base-14/examples.git
cd examples/nodejs/nestjs-typeorm

npm install
docker-compose up -d

npm run start:prod
```

See **[NestJS Instrumentation](./nestjs.md)** for enterprise patterns with
TypeORM, BullMQ, and WebSocket gateway tracing.

:::tip Complete Examples Repository

All Node.js examples with Docker Compose, Kubernetes manifests, and production
configurations are available at:

**[https://github.com/base-14/examples/tree/main/nodejs](https://github.com/base-14/examples/tree/main/nodejs)**

:::

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Node.js Examples Repository](https://github.com/base-14/examples/tree/main/nodejs)

## Related Guides

- [Express.js Instrumentation](./express.md) - Express-specific
  auto-instrumentation
- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual instrumentation patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development with collector
- [Kubernetes Deployment](../../collector-setup/kubernetes-helm-setup.md) -
  Production Kubernetes setup
