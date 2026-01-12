---
title: Express.js OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Express.js
sidebar_position: 5
description:
  Complete guide to Express.js OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with base14 Scout in minutes. Supports Express 5.x,
  MongoDB, Redis, BullMQ, Socket.IO.
keywords:
  [
    express opentelemetry instrumentation,
    express monitoring,
    express apm,
    express distributed tracing,
    nodejs express observability,
    express performance monitoring,
    opentelemetry express typescript,
    express telemetry,
    express metrics,
    express traces,
    express mongoose monitoring,
    express mongodb tracing,
    express redis instrumentation,
    express socketio tracing,
    bullmq opentelemetry,
    express middleware tracing,
    express production monitoring,
    express instrumentation guide,
    express 5 monitoring,
    nodejs apm express,
  ]
---

# Express.js

Implement OpenTelemetry instrumentation for Express.js applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to auto-instrument your Express.js
application to collect traces and metrics from HTTP requests, database queries,
Redis operations, background jobs, and WebSocket connections using the
OpenTelemetry Node.js SDK with minimal code changes.

Express.js applications benefit from automatic instrumentation of the framework
itself, as well as popular libraries including MongoDB (Mongoose), Redis
(IORedis), BullMQ, Socket.IO, and dozens of commonly used Node.js components.
With OpenTelemetry, you can monitor production performance, debug slow requests,
trace distributed transactions across microservices, and identify database query
bottlenecks without significant code modifications. The async-native design of
Node.js works seamlessly with OpenTelemetry's context propagation, ensuring
accurate parent-child span relationships across async operations.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like DataDog or New Relic, or troubleshooting
performance issues in production, this guide provides production-ready
configurations and best practices for Express.js OpenTelemetry instrumentation.
You'll learn how to set up auto-instrumentation, configure custom spans for
business logic, optimize performance, and deploy with Docker.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Express.js applications
- Configure automatic request and response tracing for HTTP endpoints
- Instrument database operations with Mongoose auto-instrumentation
- Implement custom spans for business logic and external API calls
- Collect and export HTTP metrics using custom middleware
- Configure production-ready telemetry with BatchSpanProcessor
- Export telemetry data to base14 Scout via OTLP
- Deploy instrumented applications with Docker and Docker Compose
- Troubleshoot common instrumentation issues
- Optimize performance impact in production environments

## Who This Guide Is For

This documentation is designed for:

- **Express.js developers**: implementing observability and distributed tracing
  for the first time in Node.js applications
- **DevOps engineers**: deploying Express.js applications with production
  monitoring requirements and container orchestration
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-source observability
- **Backend developers**: debugging performance issues, N+1 queries, or async
  operation bottlenecks in Express.js services
- **Platform teams**: standardizing observability across multiple Express.js
  microservices with consistent instrumentation patterns

## Prerequisites

Before starting, ensure you have:

- **Node.js 24.0.0 or later** installed (Krypton LTS recommended, active until
  April 2028)
- **Express 5.0.0 or later** installed in your project (5.0.1+ recommended for
  latest security)
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)
- Access to npm for package installation

### Compatibility Matrix

| Component                 | Minimum Version | Recommended Version | Notes                                  |
| ------------------------- | --------------- | ------------------- | -------------------------------------- |
| **Node.js**               | 24.0.0          | 24.x LTS            | Krypton - Active until April 2028      |
| **Express**               | 5.0.0           | 5.0.1+              | Latest v5 with improved security       |
| **TypeScript** (optional) | 5.0.0           | 5.7.2+              | For type safety                        |
| **OpenTelemetry SDK**     | 0.200.0         | 0.208.0+            | Core SDK for traces and metrics        |
| **Mongoose** (optional)   | 8.0.0           | 8.20.1+             | For MongoDB (**v9 not yet supported**) |
| **IORedis** (optional)    | 5.0.0           | 5.4.2+              | For Redis instrumentation              |

### Supported Libraries

OpenTelemetry automatically instruments these commonly used libraries:

- **Web frameworks**: Express, HTTP/HTTPS
- **Databases**: MongoDB (Mongoose), PostgreSQL, MySQL
- **Caching**: Redis (IORedis), Memcached
- **Job Queues**: BullMQ
- **Real-time**: Socket.IO
- **HTTP Clients**: axios, node-fetch, http/https

## Installation

### Core Packages

Install the required OpenTelemetry packages for Express.js instrumentation:

```bash
npm install @opentelemetry/api
npm install @opentelemetry/sdk-node
npm install @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/exporter-metrics-otlp-http
npm install @opentelemetry/resources
npm install @opentelemetry/semantic-conventions
```

### Optional Instrumentation Libraries

Add these packages to instrument additional components:

```bash
# MongoDB/Mongoose instrumentation
npm install @opentelemetry/instrumentation-mongoose

# Redis instrumentation
npm install @opentelemetry/instrumentation-ioredis

# Winston logging instrumentation
npm install @opentelemetry/instrumentation-winston
```

### Complete Requirements File

For production applications, add all dependencies to `package.json`:

```json title="package.json" showLineNumbers
{
  "dependencies": {
    "express": "^5.0.1",
    "mongoose": "^8.20.1",
    "ioredis": "^5.4.2",

    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.208.0",
    "@opentelemetry/sdk-node": "^0.208.0",
    "@opentelemetry/sdk-logs": "^0.208.0",
    "@opentelemetry/auto-instrumentations-node": "^0.67.2",
    "@opentelemetry/exporter-trace-otlp-http": "^0.208.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.208.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.208.0",
    "@opentelemetry/instrumentation-express": "^0.57.0",
    "@opentelemetry/instrumentation-http": "^0.208.0",
    "@opentelemetry/instrumentation-mongodb": "^0.61.0",
    "@opentelemetry/instrumentation-mongoose": "^0.55.0",
    "@opentelemetry/instrumentation-ioredis": "^0.56.0",
    "@opentelemetry/instrumentation-winston": "^0.53.0",
    "@opentelemetry/resources": "^2.2.0",
    "@opentelemetry/semantic-conventions": "^1.29.0"
  }
}
```

> For a complete list of dependencies including security, validation, and other
> libraries, see the
> [complete example](https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/package.json).

Then install all dependencies:

```bash
npm install
```

## Configuration

Express.js OpenTelemetry instrumentation can be configured in multiple ways
depending on your application architecture and deployment requirements. This
section covers different setup approaches and advanced configuration options.

### Setup Approaches

Choose the initialization method that best fits your application architecture:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="module" label="Telemetry Module (Recommended)" default>
```

#### Separate Telemetry Module (Recommended)

For better code organization and reusability, create a dedicated telemetry
module. This approach is recommended for production applications.

```typescript title="src/telemetry.ts" showLineNumbers
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { MongooseInstrumentation } from "@opentelemetry/instrumentation-mongoose";
import { WinstonInstrumentation } from "@opentelemetry/instrumentation-winston";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export function setupTelemetry(): NodeSDK {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "express-app",
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || "1.0.0",
    "deployment.environment": process.env.NODE_ENV || "development",
  });

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

  const sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 60000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
          enabled: false,
        },
        "@opentelemetry/instrumentation-express": {
          enabled: true,
        },
        "@opentelemetry/instrumentation-http": {
          enabled: true,
        },
        "@opentelemetry/instrumentation-ioredis": {
          enabled: true,
        },
      }),
      new MongooseInstrumentation({
        requireParentSpan: false,
      }),
      new WinstonInstrumentation(),
    ],
  });

  sdk.start();
  console.log("✅ OpenTelemetry SDK initialized");

  process.on("SIGTERM", () => {
    sdk
      .shutdown()
      .then(() => console.log("OpenTelemetry SDK shut down successfully"))
      .catch((error) =>
        console.error("Error shutting down OpenTelemetry SDK", error),
      )
      .finally(() => process.exit(0));
  });

  return sdk;
}
```

This configuration automatically captures:

- HTTP request method, path, status code, and duration
- Request and response headers (configurable)
- Query parameters and path parameters
- MongoDB queries (via Mongoose)
- Redis operations (via IORedis)
- Error and exception information

```mdx-code-block
</TabItem>
<TabItem value="entry" label="Instrumentation Entry Point">
```

#### Instrumentation Entry Point Pattern

Create a separate instrumentation file that Node.js loads before your main
application using the `--import` flag. This ensures OpenTelemetry is initialized
before any application code runs.

```typescript title="src/instrumentation.ts" showLineNumbers
import { setupTelemetry } from "./telemetry.js";

setupTelemetry();
```

Then use the Node.js `--import` flag to load instrumentation first:

```bash
node --import ./dist/instrumentation.js dist/index.js
```

In `package.json` scripts:

```json title="package.json" showLineNumbers
{
  "scripts": {
    "build": "tsc",
    "start": "node --import ./dist/instrumentation.js dist/index.js"
  }
}
```

**Main application file**:

```typescript title="src/index.ts" showLineNumbers
import express from "express";
import { connectDatabase } from "./database.js";

// Instrumentation is already loaded via --import flag

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Hello World" });
});

const PORT = process.env.APP_PORT || 3000;

async function startServer() {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
```

```mdx-code-block
</TabItem>
<TabItem value="env" label="Environment Variables">
```

#### Environment Variables Configuration

Configure OpenTelemetry entirely through environment variables for
container-friendly deployments:

```bash title=".env" showLineNumbers
# Application
NODE_ENV=development
APP_PORT=3000
APP_VERSION=1.0.0

# OpenTelemetry
OTEL_SERVICE_NAME=express-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

# MongoDB
MONGODB_URI=mongodb://mongo:27017/express-app

# Redis
REDIS_URL=redis://redis:6379
```

Update your telemetry module to use environment variables:

```typescript title="src/telemetry.ts" showLineNumbers
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "express-app",
  [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || "1.0.0",
  "deployment.environment": process.env.NODE_ENV || "development",
});

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
```

```mdx-code-block
</TabItem>
<TabItem value="selective" label="Selective Instrumentation">
```

#### Selective Instrumentation

Control which components are instrumented by enabling or disabling specific
auto-instrumentations:

```typescript title="src/telemetry.ts" showLineNumbers
const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable filesystem instrumentation (reduces overhead)
      "@opentelemetry/instrumentation-fs": {
        enabled: false,
      },
      // Enable Express with custom configuration
      "@opentelemetry/instrumentation-express": {
        enabled: true,
        ignoreLayersType: ["request_handler"], // Skip specific middleware
      },
      // Enable HTTP with endpoint exclusions
      "@opentelemetry/instrumentation-http": {
        enabled: true,
        ignoreIncomingPaths: ["/health", "/metrics", "/favicon.ico"],
      },
      // Enable MongoDB
      "@opentelemetry/instrumentation-mongodb": {
        enabled: true,
      },
      // Enable Redis
      "@opentelemetry/instrumentation-ioredis": {
        enabled: true,
      },
    }),
  ],
});
```

```mdx-code-block
</TabItem>
<TabItem value="scout" label="Scout Integration">
```

#### Scout Collector Integration

Configure direct integration with base14 Scout collector:

```typescript title="src/telemetry.ts" showLineNumbers
const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.SCOUT_ENDPOINT}/v1/traces`,
    headers: {
      Authorization: `Bearer ${process.env.SCOUT_TOKEN}`,
    },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${process.env.SCOUT_ENDPOINT}/v1/metrics`,
      headers: {
        Authorization: `Bearer ${process.env.SCOUT_TOKEN}`,
      },
    }),
    exportIntervalMillis: 60000,
  }),
  // ... rest of configuration
});
```

Environment variables for Scout:

```bash title=".env" showLineNumbers
SCOUT_ENDPOINT=https://your-tenant.base14.io:4318
SCOUT_TOKEN=your_bearer_token
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Traces

Traces provide the complete picture of what happens when a request flows through
your Express.js application. They capture the entire lifecycle from the incoming
HTTP request, through your business logic, database queries, external API calls,
and finally the response sent back to the client.

### Automatic Trace Collection

Once instrumented, Express.js automatically captures detailed trace information
for every request:

**Captured Information:**

- HTTP method, path, and status code
- Request duration and timing breakdown
- Request and response headers (configurable)
- Query parameters and path parameters
- MongoDB queries (operation, collection, execution time)
- Redis operations (command, key, execution time)
- WebSocket connections (via Socket.IO)
- Error and exception stack traces
- Distributed trace context propagation (W3C Trace Context)

**Trace Hierarchy:**

```text
HTTP Request Span (root)
├── Express Router Span
│   ├── Auth Middleware Span
│   ├── Route Handler Span
│   │   ├── MongoDB Query Span (Mongoose)
│   │   ├── Redis GET Span (IORedis)
│   │   ├── BullMQ Job Enqueue Span
│   │   └── Custom Business Logic Span
│   └── Response Middleware Span
└── HTTP Response Span
```

### Key Tracing Features

- **Automatic HTTP tracking**: Every endpoint is automatically traced with no
  code changes
- **Error capturing**: Exceptions are automatically recorded with full stack
  traces
- **Context propagation**: Distributed traces work across microservices using
  W3C Trace Context headers
- **Custom attributes**: Add business-specific metadata to spans (covered in
  Custom Instrumentation section)
- **Async support**: Full support for async/await patterns with correct context
  preservation

> View traces in your base14 Scout dashboard to analyze request flows and
> identify bottlenecks.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Metrics

OpenTelemetry metrics capture runtime measurements of your Express.js
application including HTTP request counts, latencies, response status codes, and
custom business metrics. Unlike traces that show individual request flows,
metrics aggregate data over time for monitoring trends and alerting.

### Custom Metrics

Create custom metrics to track business operations:

```typescript title="src/utils/metrics.ts" showLineNumbers
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("express-app", "1.0.0");

export const articleMetrics = {
  created: meter.createCounter("articles.created.total", {
    description: "Total number of articles created",
    unit: "1",
  }),

  published: meter.createCounter("articles.published.total", {
    description: "Total number of articles published",
    unit: "1",
  }),

  publishDuration: meter.createHistogram("article.publish.duration", {
    description: "Duration of article publish job processing",
    unit: "ms",
  }),

  contentSize: meter.createHistogram("article.content.size", {
    description: "Size of article content in characters",
    unit: "characters",
  }),

  favorited: meter.createCounter("articles.favorited.total", {
    description: "Total number of article favorites",
    unit: "1",
  }),
};

export const authMetrics = {
  loginSuccess: meter.createCounter("users.login.success.total", {
    description: "Total number of successful login attempts",
    unit: "1",
  }),

  loginFailed: meter.createCounter("users.login.failed.total", {
    description: "Total number of failed login attempts",
    unit: "1",
  }),
};

export const jobMetrics = {
  enqueued: meter.createCounter("jobs.enqueued.total", {
    description: "Total number of jobs enqueued",
    unit: "1",
  }),

  completed: meter.createCounter("jobs.completed.total", {
    description: "Total number of jobs completed successfully",
    unit: "1",
  }),

  processingTime: meter.createHistogram("jobs.processing.duration", {
    description: "Duration of job processing",
    unit: "ms",
  }),
};
```

**Usage in controllers**:

```typescript title="src/controllers/article.controller.ts" showLineNumbers
import { articleMetrics } from "../utils/metrics.js";

export async function createArticle(req, res) {
  const article = await Article.create(req.body);

  articleMetrics.created.add(1);
  articleMetrics.contentSize.record(article.content.length);

  res.status(201).json(article);
}
```

### Available Metrics

Once configured, these metrics are automatically collected:

| Metric Name                 | Type      | Description              | Attributes |
| --------------------------- | --------- | ------------------------ | ---------- |
| `articles.created.total`    | Counter   | Total articles created   | -          |
| `articles.published.total`  | Counter   | Total articles published | -          |
| `articles.favorited.total`  | Counter   | Total favorites          | -          |
| `users.login.success.total` | Counter   | Successful logins        | -          |
| `users.login.failed.total`  | Counter   | Failed login attempts    | -          |
| `jobs.enqueued.total`       | Counter   | Jobs enqueued            | job.type   |
| `jobs.processing.duration`  | Histogram | Job processing time      | job.type   |
| `article.publish.duration`  | Histogram | Publish duration         | -          |
| `article.content.size`      | Histogram | Content size             | -          |

> View these metrics in base14 Scout to create dashboards, set up alerts, and
> monitor application health.

## Production Configuration

Production environments require careful configuration of OpenTelemetry to
balance observability needs with performance and reliability. This section
covers production-ready patterns.

### BatchSpanProcessor Configuration

Configure BatchSpanProcessor parameters for optimal performance:

```typescript title="src/telemetry.ts" showLineNumbers
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const batchProcessor = new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: "http://otel-collector:4318/v1/traces",
  }),
  {
    maxQueueSize: 2048, // Maximum spans in queue
    scheduledDelayMillis: 5000, // Export every 5 seconds
    maxExportBatchSize: 512, // Maximum spans per export
    exportTimeoutMillis: 30000, // Timeout for export operation
  },
);
```

### Resource Attributes for Production

Add comprehensive resource attributes to identify your service:

```typescript title="src/telemetry.ts" showLineNumbers
import os from "os";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const resource = resourceFromAttributes({
  // Service identification
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "express-app",
  [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || "1.0.0",

  // Deployment information
  "deployment.environment": process.env.NODE_ENV || "development",
  "deployment.region": process.env.AWS_REGION || "us-east-1",

  // Instance identification
  "service.instance.id": os.hostname(),
  "host.name": os.hostname(),
  "host.type": "container",

  // Container information (if applicable)
  "container.id": process.env.HOSTNAME || "",
  "container.name": process.env.CONTAINER_NAME || "",

  // Kubernetes information (if applicable)
  "k8s.namespace.name": process.env.K8S_NAMESPACE || "",
  "k8s.pod.name": process.env.K8S_POD_NAME || "",
});
```

### Environment-Based Configuration

Use environment variables to configure telemetry without code changes:

```typescript title="src/config.ts" showLineNumbers
export const config = {
  app: {
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.APP_PORT || "3000", 10),
    version: process.env.APP_VERSION || "1.0.0",
  },
  otel: {
    serviceName: process.env.OTEL_SERVICE_NAME || "express-app",
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
  },
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/express-app",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
};
```

### Docker Compose Configuration

Example `compose.yml` for production-like deployment:

```yaml title="compose.yml" showLineNumbers
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      APP_VERSION: "1.0.0"
      OTEL_SERVICE_NAME: express-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      MONGODB_URI: mongodb://mongo:27017/express-app
      REDIS_URL: redis://redis:6379
    depends_on:
      - mongo
      - redis
      - otel-collector

  mongo:
    image: mongo:8.0-noble
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:8-alpine
    ports:
      - "6379:6379"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.115.1
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-contrib/config.yaml
    ports:
      - "4317:4317" # OTLP gRPC
      - "4318:4318" # OTLP HTTP
      - "55679:55679" # zpages for debugging

volumes:
  mongo_data:
```

> For a production-ready compose configuration with health checks, networks, and
> env_file support, see the
> [complete example](https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/compose.yml).

### Environment Variables Template

Create a `.env.example` file for your team:

```bash title=".env.example" showLineNumbers
# Application
NODE_ENV=development
APP_PORT=3000
APP_VERSION=1.0.0

# OpenTelemetry
OTEL_SERVICE_NAME=express-mongodb-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development,service.version=1.0.0

# MongoDB
MONGODB_URI=mongodb://mongo:27017/express-app

# Redis (for BullMQ job queue)
REDIS_URL=redis://redis:6379

# JWT Authentication
JWT_SECRET=your-secret-key-change-in-development
JWT_EXPIRES_IN=7d

# Security
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# base14 Scout Configuration (Required - set these via environment or .env.local)
SCOUT_ENDPOINT=https://your-tenant.base14.io:4318
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token
```

### Dockerfile with OpenTelemetry

Build a production-ready Docker image:

```dockerfile title="Dockerfile" showLineNumbers
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./

RUN npm install

COPY src ./src

RUN npm run build

RUN npm prune --production

# Runtime stage
FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -S appuser && \
    adduser -D -S -G appuser appuser

COPY --from=builder --chown=appuser:appuser /app/dist ./dist
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --chown=appuser:appuser package*.json ./

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=5m --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "--import", "./dist/instrumentation.js", "dist/index.js"]
```

### Graceful Shutdown

Implement graceful shutdown to flush pending spans:

```typescript title="src/index.ts" showLineNumbers
import http from "http";
import { setupTelemetry } from "./telemetry.js";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./database.js";

// Initialize telemetry FIRST
const sdk = setupTelemetry();

const app = createApp();
const server = http.createServer(app);

async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed");
  });

  // 2. Shutdown OpenTelemetry SDK (flush pending spans)
  await sdk.shutdown();
  console.log("OpenTelemetry SDK shut down");

  // 3. Disconnect from database
  await disconnectDatabase();
  console.log("Database disconnected");

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const PORT = process.env.APP_PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Framework-Specific Features

Express.js integration with OpenTelemetry automatically instruments several
framework components and commonly used libraries. This section covers automatic
instrumentation for databases, caching, background jobs, and WebSockets.

### MongoDB/Mongoose Database Instrumentation

OpenTelemetry automatically instruments Mongoose database queries, providing
detailed visibility into database operations.

**Installation:**

```bash
npm install @opentelemetry/instrumentation-mongoose
```

**Automatic Instrumentation:**

```typescript title="src/telemetry.ts" showLineNumbers
import { MongooseInstrumentation } from "@opentelemetry/instrumentation-mongoose";

const sdk = new NodeSDK({
  instrumentations: [
    new MongooseInstrumentation({
      requireParentSpan: false, // Create spans even without parent
    }),
  ],
});
```

This automatically captures:

- MongoDB operation (find, insertOne, updateOne, deleteOne)
- Collection name
- Query execution time
- Database connection details
- N+1 query detection (via span hierarchy)

**Example traced query:**

```text
HTTP POST /api/v1/articles
└── article.create (custom span)
    └── mongodb.insertOne (auto-instrumented)
        Collection: articles
        Duration: 15ms
```

> **Note**: Mongoose 9.x is not yet supported by the instrumentation package.
> Use Mongoose 8.x (8.20.1+ recommended).

### Redis/IORedis Instrumentation

Automatically trace Redis operations:

```typescript title="src/telemetry.ts" showLineNumbers
const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-ioredis": {
        enabled: true,
      },
    }),
  ],
});
```

This captures:

- Redis command (GET, SET, HGET, LPUSH, etc.)
- Key names
- Command execution time
- Connection details

### Background Jobs (BullMQ) with Trace Propagation

Trace background jobs with context propagation:

```typescript title="src/jobs/publishArticleJob.ts" showLineNumbers
import { Queue, Worker, Job } from "bullmq";
import { trace } from "@opentelemetry/api";

// Create job queue
const publishQueue = new Queue("article-publish", {
  connection: { url: process.env.REDIS_URL },
});

// Enqueue job with trace context
export async function enqueuePublishJob(articleId: string) {
  await publishQueue.add("publish-article", {
    articleId,
    // Trace context is automatically propagated by IORedis instrumentation
  });
}

// Job worker with tracing
const worker = new Worker("article-publish", async (job: Job) => {
  const tracer = trace.getTracer("article-job");
  const span = tracer.startSpan("article.publish");

  try {
    span.setAttributes({
      "article.id": job.data.articleId,
      "job.id": job.id,
    });

    // Publish article logic
    await Article.findByIdAndUpdate(job.data.articleId, {
      published: true,
      publishedAt: new Date(),
    });

    span.addEvent("article_published");
    return { success: true };
  } catch (error) {
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
});
```

### WebSocket (Socket.IO) Tracing

Trace WebSocket connections and events:

```typescript title="src/socket.ts" showLineNumbers
import { Server } from "socket.io";
import { trace } from "@opentelemetry/api";
import http from "http";

const tracer = trace.getTracer("socket-io");

export function setupWebSocket(server: http.Server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    const span = tracer.startSpan("websocket.connection");

    span.setAttributes({
      "socket.id": socket.id,
      "socket.transport": socket.conn.transport.name,
    });

    span.addEvent("client_connected", {
      "socket.id": socket.id,
    });

    socket.on("subscribe:articles", () => {
      socket.join("articles");
      span.addEvent("subscribed_to_articles");
      socket.emit("subscribed", { channel: "articles" });
    });

    socket.on("disconnect", () => {
      span.addEvent("client_disconnected");
      span.end();
    });
  });

  return io;
}
```

## Custom Instrumentation

While auto-instrumentation captures HTTP requests and database queries, custom
instrumentation lets you trace business logic, add contextual attributes, and
instrument specific operations.

### Creating Custom Spans with Utility Function

Create a reusable utility for consistent span management:

```typescript title="src/utils/tracing.ts" showLineNumbers
import {
  trace,
  SpanStatusCode,
  context as otelContext,
  type Span,
} from "@opentelemetry/api";

type AsyncSpanFn<T> = (span: Span) => Promise<T>;

export function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: AsyncSpanFn<T>,
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  const span = tracer.startSpan(spanName);

  return otelContext.with(
    trace.setSpan(otelContext.active(), span),
    async () => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
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
    },
  );
}
```

**Usage in controller**:

```typescript title="src/controllers/article.controller.ts" showLineNumbers
import { withSpan } from "../utils/tracing.js";

export async function createArticle(req, res) {
  return withSpan("article-controller", "article.create", async (span) => {
    const article = await Article.create(req.body);

    span.setAttributes({
      "article.id": article._id.toString(),
      "article.title": article.title,
      "article.published": article.published,
    });

    span.addEvent("article_created", {
      "article.id": article._id.toString(),
    });

    res.status(201).json(article);
  });
}
```

### Adding Custom Attributes to Active Span

Enrich the automatically created span with custom data:

```typescript title="src/middleware/auth.middleware.ts" showLineNumbers
import { trace, SpanStatusCode } from "@opentelemetry/api";

export async function authenticate(req, res, next) {
  const currentSpan = trace.getActiveSpan();

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      if (currentSpan) {
        currentSpan.addEvent("auth_failed", { reason: "missing_token" });
      }
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    const user = await User.findById(payload.userId);

    if (!user) {
      if (currentSpan) {
        currentSpan.addEvent("auth_failed", { reason: "user_not_found" });
      }
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;

    // Add user context to active span
    if (currentSpan) {
      currentSpan.setAttributes({
        "user.id": user._id.toString(),
        "user.email": user.email,
        "user.role": user.role,
      });
      currentSpan.addEvent("auth_success");
    }

    next();
  } catch (error) {
    if (currentSpan) {
      currentSpan.recordException(error as Error);
      currentSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
    }
    next(error);
  }
}
```

### Error Handling and Status

Record errors and set span status appropriately:

```typescript title="src/controllers/article.controller.ts" showLineNumbers
import { trace, SpanStatusCode } from "@opentelemetry/api";

export async function getArticle(req, res) {
  const tracer = trace.getTracer("article-controller");
  const span = tracer.startSpan("article.get");

  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      span.setAttributes({
        "article.id": req.params.id,
        "article.found": false,
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Article not found",
      });
      span.end();

      return res.status(404).json({ error: "Article not found" });
    }

    span.setAttributes({
      "article.id": article._id.toString(),
      "article.title": article.title,
      "article.found": true,
    });

    span.setStatus({ code: SpanStatusCode.OK });
    res.json(article);
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
```

### Span Events for Business Operations

Add timestamped events to track important operations:

```typescript title="src/controllers/favorite.controller.ts" showLineNumbers
import { withSpan } from "../utils/tracing.js";

export async function favoriteArticle(req, res) {
  return withSpan("favorite-controller", "article.favorite", async (span) => {
    const article = await Article.findById(req.params.id);

    span.setAttributes({
      "article.id": article._id.toString(),
      "user.id": req.user._id.toString(),
    });

    // Add event for favorite action
    span.addEvent("article_favorited", {
      "article.id": article._id.toString(),
      "article.title": article.title,
      "user.id": req.user._id.toString(),
      timestamp: new Date().toISOString(),
    });

    // Update favorites count
    article.favorites.push(req.user._id);
    await article.save();

    span.setAttributes({
      "article.favorites_count": article.favorites.length,
    });

    res.json(article);
  });
}
```

### Semantic Conventions

Use OpenTelemetry semantic conventions for consistent attribute naming:

```typescript title="src/middleware/request-logger.middleware.ts" showLineNumbers
import { trace } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";

export function requestLogger(req, res, next) {
  const currentSpan = trace.getActiveSpan();

  if (currentSpan && currentSpan.isRecording()) {
    // Use semantic convention constants
    currentSpan.setAttributes({
      [ATTR_HTTP_REQUEST_METHOD]: req.method,
      [ATTR_HTTP_ROUTE]: req.route?.path || req.path,
      [ATTR_USER_AGENT_ORIGINAL]: req.get("user-agent") || "",
      "http.request.body.size": JSON.stringify(req.body).length,
    });

    res.on("finish", () => {
      currentSpan.setAttributes({
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: res.statusCode,
        "http.response.body.size": res.get("content-length") || 0,
      });
    });
  }

  next();
}
```

## Running Your Application

### Development Mode

Run with console output for local development:

```bash
# Set environment to development
export NODE_ENV=development
export OTEL_SERVICE_NAME=express-app

# Run with ts-node (TypeScript)
npm run dev
# or
ts-node src/index.ts
```

**package.json scripts**:

```json title="package.json" showLineNumbers
{
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node --import ./dist/instrumentation.js dist/index.js"
  }
}
```

### Production Mode

Run with OTLP exporter pointing to Scout Collector:

```bash
# Build TypeScript
npm run build

# Set production environment variables
export NODE_ENV=development
export OTEL_SERVICE_NAME=express-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export APP_VERSION=1.0.0

# Run with instrumentation
npm start
# Runs: node --import ./dist/instrumentation.js dist/index.js
```

### Docker Deployment

Build and run with Docker:

```bash
# Build image
docker build -t express-app:latest .

# Run container
docker run -d \
  --name express-app \
  -p 3000:3000 \
  -e NODE_ENV=development \
  -e OTEL_SERVICE_NAME=express-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  -e MONGODB_URI=mongodb://mongo:27017/express-app \
  -e REDIS_URL=redis://redis:6379 \
  express-app:latest
```

Or use Docker Compose:

```bash
# Start all services (app, MongoDB, Redis, OTel Collector)
docker compose up --build

# View logs
docker compose logs -f app

# Stop services
docker compose down
```

## Troubleshooting

### Verifying Instrumentation

Create a test endpoint to verify OpenTelemetry is working:

```typescript title="src/routes/health.ts" showLineNumbers
import { trace } from "@opentelemetry/api";

router.get("/health", (req, res) => {
  const currentSpan = trace.getActiveSpan();

  if (currentSpan && currentSpan.isRecording()) {
    const spanContext = currentSpan.spanContext();

    return res.json({
      status: "healthy",
      tracing: "enabled",
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    });
  }

  return res.json({
    status: "healthy",
    tracing: "disabled",
  });
});
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. **Verify OTLP endpoint is accessible**:

   ```bash
   curl http://otel-collector:4318/v1/traces
   # Should return 405 Method Not Allowed (endpoint exists)
   ```

2. **Check telemetry initialization happens BEFORE app creation**:

   ```typescript
   // ❌ WRONG ORDER
   import { createApp } from "./app.js";
   import { setupTelemetry } from "./telemetry.js";
   setupTelemetry(); // Too late!

   // ✅ CORRECT ORDER
   import { setupTelemetry } from "./telemetry.js";
   setupTelemetry(); // First!
   import { createApp } from "./app.js";
   ```

3. **Enable console exporter to verify spans are being created**:

   ```typescript
   import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
   import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";

   const sdk = new NodeSDK({
     spanProcessors: [new BatchSpanProcessor(new ConsoleSpanExporter())],
   });
   ```

#### Issue: Database queries not traced

**Solutions:**

1. **Ensure Mongoose instrumentation is registered BEFORE creating connection**:

   ```typescript
   // ✅ CORRECT ORDER
   const sdk = new NodeSDK({
     instrumentations: [new MongooseInstrumentation()],
   });
   sdk.start();
   await mongoose.connect(MONGODB_URI);
   ```

2. **Check Mongoose version compatibility**:

   ```bash
   npm list mongoose
   # Must be 8.x (9.x not yet supported)
   ```

#### Issue: High memory usage or performance degradation

**Solutions:**

1. **Configure BatchSpanProcessor with appropriate limits**:

   ```typescript
   const batchProcessor = new BatchSpanProcessor(exporter, {
     maxQueueSize: 2048, // Reduce if memory is constrained
     scheduledDelayMillis: 5000, // Increase to batch more spans
     maxExportBatchSize: 512,
   });
   ```

2. **Exclude high-volume endpoints**:

   ```typescript
   instrumentations: [
     getNodeAutoInstrumentations({
       "@opentelemetry/instrumentation-http": {
         ignoreIncomingPaths: ["/health", "/metrics", "/favicon.ico"],
       },
     }),
   ];
   ```

#### Issue: Background jobs losing trace context

**Solutions:**

1. **Verify IORedis instrumentation is enabled** (BullMQ uses Redis):

   ```typescript
   instrumentations: [
     getNodeAutoInstrumentations({
       "@opentelemetry/instrumentation-ioredis": {
         enabled: true,
       },
     }),
   ];
   ```

2. **Use manual span creation in job workers**:

   ```typescript
   const worker = new Worker("queue-name", async (job) => {
     const tracer = trace.getTracer("job-worker");
     const span = tracer.startSpan("process-job");

     try {
       // Job logic with proper tracing
     } finally {
       span.end();
     }
   });
   ```

## Security Considerations

### Sensitive Data in Spans

Avoid capturing sensitive information in span attributes:

**Bad Example (DON'T DO THIS)**:

```typescript
// ❌ NEVER capture sensitive data
span.setAttribute("user.password", password);
span.setAttribute("credit_card.number", cardNumber);
span.setAttribute("user.ssn", ssn);
span.setAttribute("api_key", apiKey);
span.setAttribute("auth_token", token);
```

**Good Example (DO THIS INSTEAD)**:

```typescript
// ✅ GOOD - Reference IDs and metadata only
span.setAttribute("user.id", user.id);
span.setAttribute("payment.method", "credit_card");
span.setAttribute("payment.last4", cardNumber.slice(-4));
span.setAttribute("user.email_domain", email.split("@")[1]);
span.setAttribute("api_key.prefix", apiKey.substring(0, 8));
```

### HTTP Header Filtering

Filter sensitive headers from traces:

```typescript title="src/middleware/sanitize-headers.ts" showLineNumbers
import { trace } from "@opentelemetry/api";

export function sanitizeHeaders(req) {
  const currentSpan = trace.getActiveSpan();

  if (currentSpan) {
    // ✅ Safe headers to capture
    const safeHeaders = {
      "content-type": req.get("content-type"),
      "user-agent": req.get("user-agent"),
      accept: req.get("accept"),
      "x-request-id": req.get("x-request-id"),
    };

    currentSpan.setAttributes({
      "http.request.headers": JSON.stringify(safeHeaders),
    });

    // ❌ NEVER capture these headers:
    // - authorization
    // - cookie
    // - x-api-key
    // - proxy-authorization
  }
}
```

### Query Parameter Sanitization

Sanitize query parameters before adding to spans:

```typescript title="src/utils/sanitize.ts" showLineNumbers
export function sanitizeQueryParams(
  params: Record<string, any>,
): Record<string, any> {
  const sensitiveKeys = ["password", "token", "api_key", "secret", "ssn"];
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// Usage
const currentSpan = trace.getActiveSpan();
if (currentSpan) {
  currentSpan.setAttribute(
    "http.query",
    JSON.stringify(sanitizeQueryParams(req.query)),
  );
}
```

### Environment Variable Security

Never commit sensitive values to version control:

```bash title=".env" showLineNumbers
# ❌ BAD - Don't commit .env files with real secrets
SECRET_KEY=actual-secret-key-here
MONGODB_URI=mongodb://admin:password123@mongo:27017/db
JWT_SECRET=my-super-secret-jwt-key
```

In production, use environment-specific secrets management:

- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets
- Azure Key Vault
- Google Cloud Secret Manager

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead when properly configured:

| Metric      | Impact               | Notes                                             |
| ----------- | -------------------- | ------------------------------------------------- |
| **Latency** | +0.5-2ms per request | Mostly from span creation and context propagation |
| **CPU**     | +2-5%                | Primarily during span export operations           |
| **Memory**  | +10-50MB             | BatchSpanProcessor queue and SDK overhead         |
| **Network** | +1-5KB per trace     | OTLP HTTP with gzip compression                   |

**Impact Factors**:

- Number of spans per request
- Span attribute size and count
- Export frequency (BatchSpanProcessor schedule)
- Number of active requests
- Enabled instrumentations

### Optimization Strategies

#### 1. Use BatchSpanProcessor in Production

Always use `BatchSpanProcessor` (never `SimpleSpanProcessor`) for production:

```typescript title="src/telemetry.ts" showLineNumbers
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";

// ✅ GOOD - Batches spans for efficient export
const batchProcessor = new BatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  scheduledDelayMillis: 5000,
  maxExportBatchSize: 512,
});

// ❌ BAD - Exports each span immediately (only for debugging)
// const simpleProcessor = new SimpleSpanProcessor(exporter);
```

#### 2. Skip Non-Critical Endpoints

Exclude health checks and metrics endpoints:

```typescript title="src/telemetry.ts" showLineNumbers
const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingPaths: [
          "/health",
          "/metrics",
          "/favicon.ico",
          "/robots.txt",
        ],
      },
    }),
  ],
});
```

#### 3. Limit Attribute Sizes

Prevent large attributes from consuming memory:

```typescript title="src/utils/tracing.ts" showLineNumbers
export function addSafeAttribute(
  span: Span,
  key: string,
  value: string | number | boolean,
  maxLength: number = 256,
) {
  if (typeof value === "string" && value.length > maxLength) {
    value = value.substring(0, maxLength) + "... (truncated)";
  }

  span.setAttribute(key, value);
}

// Usage
addSafeAttribute(span, "article.content", article.content, 500);
addSafeAttribute(span, "http.request.body", JSON.stringify(req.body), 1024);
```

#### 4. Optimize Metric Export Intervals

Adjust metric export frequency for production:

```typescript title="src/telemetry.ts" showLineNumbers
const sdk = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://otel-collector:4318/v1/metrics",
    }),
    // ✅ Production: Export every 60 seconds (reduces network overhead)
    exportIntervalMillis: 60000,
  }),
});
```

## FAQ

### Does Express.js instrumentation work with async/await?

Yes, OpenTelemetry fully supports Express.js async/await patterns. The NodeSDK
automatically preserves context across async operations, ensuring parent-child
span relationships are maintained correctly. All automatically instrumented
libraries (Mongoose, IORedis, etc.) work seamlessly with async/await.

### What is the performance impact of Express.js instrumentation?

Typical overhead is 0.5-2ms added latency per request, 2-5% CPU increase, and
10-50MB additional memory usage. This impact is minimal and acceptable for most
production applications. Using BatchSpanProcessor and excluding high-volume
endpoints further reduces overhead.

### Which Node.js and Express versions are supported?

- **Node.js**: 24.0.0+ (Krypton LTS recommended, active until April 2028)
- **Express**: 5.0.0+ (5.0.1+ recommended for latest security improvements)
- **OpenTelemetry SDK**: 0.200.0+ (always use latest stable version for bug
  fixes)
- Full TypeScript support with type definitions included

### How do I instrument MongoDB/Mongoose queries?

Install `@opentelemetry/instrumentation-mongoose` and register it in your
NodeSDK instrumentations array before connecting to MongoDB. All Mongoose
queries are automatically traced with operation name, collection, query
execution time, and database details. N+1 queries are visible in the span
hierarchy.

```typescript
import { MongooseInstrumentation } from "@opentelemetry/instrumentation-mongoose";

const sdk = new NodeSDK({
  instrumentations: [new MongooseInstrumentation()],
});
sdk.start();
await mongoose.connect(MONGODB_URI); // Connect AFTER SDK start
```

**Note**: Mongoose 9.x is not yet supported. Use Mongoose 8.x (8.20.1+
recommended).

### How does distributed tracing work across Express.js microservices?

OpenTelemetry uses W3C Trace Context headers (`traceparent`, `tracestate`) to
propagate trace context between services. Express HTTP instrumentation
automatically extracts these headers from incoming requests and injects them
into outgoing HTTP calls, enabling end-to-end distributed traces across your
entire microservices architecture.

### What's the difference between traces and metrics in Express.js?

- **Traces**: Show individual request flows with detailed timing and call
  hierarchy (e.g., "this specific API call took 150ms with 3 database queries")
- **Metrics**: Aggregate measurements over time for monitoring trends (e.g.,
  "average response time is 120ms, 99th percentile is 500ms")

Use both together: traces for debugging specific issues, metrics for monitoring
overall health and setting up alerts.

### How do I debug N+1 database query problems in Express.js?

View the span hierarchy in base14 Scout TraceX. N+1 queries appear as many
sequential database spans under a single parent span. For example, a list
endpoint that loads 10 articles with separate author queries will show 1
articles query span followed by 10 author query spans, making the N+1 pattern
obvious.

### Can I use OpenTelemetry with TypeScript in Express.js?

Yes, OpenTelemetry has full first-class TypeScript support with comprehensive
type definitions. All examples in this guide use TypeScript syntax. The
instrumentation works identically with JavaScript - just omit type annotations.

### How do I instrument background jobs with BullMQ?

Create manual spans in BullMQ workers to trace job execution. Trace context is
automatically propagated through Redis (via IORedis instrumentation). Ensure
IORedis instrumentation is enabled in your NodeSDK configuration.

### Does instrumentation affect WebSocket connections (Socket.IO)?

Yes, Socket.IO connections can be traced by creating manual spans for connection
events. Each connection creates a span tracking the connection lifetime,
subscriptions, and events. See the Framework-Specific Features section for full
Socket.IO tracing examples.

### How do I handle multi-tenancy in Express.js traces?

Add tenant identification to span attributes using the active span or request
middleware:

```typescript
const currentSpan = trace.getActiveSpan();
if (currentSpan) {
  currentSpan.setAttributes({
    "tenant.id": req.tenant.id,
    "tenant.name": req.tenant.name,
  });
}
```

Then filter and query by tenant attributes in base14 Scout dashboard.

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
  custom dashboards for Express.js applications

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment with collector
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production Kubernetes deployment
- [Scout Exporter Configuration](../../collector-setup/scout-exporter.md) -
  Configure authentication and endpoints

## Complete Example

A complete production-ready example with Express 5.x, TypeScript, MongoDB
(Mongoose), Redis, BullMQ, Socket.IO, and comprehensive OpenTelemetry
instrumentation is available at:

**GitHub**:
[base-14/examples/nodejs/express-typescript-mongodb](https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb)

**Features**:

- Full auto-instrumentation with NodeSDK
- Custom spans, metrics, and events
- Background job tracing with BullMQ
- WebSocket tracing with Socket.IO
- Production Docker deployment
- 74.31% test coverage with Vitest
- Security: Helmet, CORS, rate limiting, JWT, XSS protection
- Graceful shutdown handling

### Complete package.json

```json title="package.json" showLineNumbers
{
  "name": "express-typescript-mongodb-otel",
  "version": "1.0.0",
  "type": "module",
  "description": "Express.js + TypeScript + MongoDB + OpenTelemetry example",
  "scripts": {
    "build": "tsc",
    "start": "node --import ./dist/instrumentation.js dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.208.0",
    "@opentelemetry/sdk-node": "^0.208.0",
    "@opentelemetry/sdk-logs": "^0.208.0",
    "@opentelemetry/auto-instrumentations-node": "^0.67.2",
    "@opentelemetry/exporter-trace-otlp-http": "^0.208.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.208.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.208.0",
    "@opentelemetry/instrumentation-express": "^0.57.0",
    "@opentelemetry/instrumentation-http": "^0.208.0",
    "@opentelemetry/instrumentation-mongodb": "^0.61.0",
    "@opentelemetry/instrumentation-mongoose": "^0.55.0",
    "@opentelemetry/instrumentation-ioredis": "^0.56.0",
    "@opentelemetry/instrumentation-winston": "^0.53.0",
    "@opentelemetry/resources": "^2.2.0",
    "@opentelemetry/semantic-conventions": "^1.29.0",
    "express": "^5.0.1",
    "mongoose": "^8.20.1",
    "ioredis": "^5.4.2"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^24.10.1",
    "typescript": "^5.7.2",
    "vitest": "^4.0.15",
    "@vitest/coverage-v8": "^4.0.15"
  }
}
```

> For additional dependencies like BullMQ, Socket.IO, security libraries, and
> more, see the
> [complete example](https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb).

### Additional Configuration Files

For complete production-ready configuration files, see the example repository:

- [src/telemetry.ts][example-telemetry] - Complete telemetry setup with logs,
  metrics, and traces
- [.env.example][example-env] - All environment variables with Scout
  configuration
- [Dockerfile][example-dockerfile] - Multi-stage production build
- [compose.yml][example-compose] - Full stack with health checks and networks

[example-telemetry]: https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/src/telemetry.ts
[example-env]: https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/.env.example
[example-dockerfile]: https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/Dockerfile
[example-compose]: https://github.com/base-14/examples/tree/main/nodejs/express-typescript-mongodb/compose.yml

## References

- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/)
- [Express.js Documentation](https://expressjs.com/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual instrumentation for advanced use cases
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment guide
