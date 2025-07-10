# Node.js OpenTelemetry Custom Instrumentation Guide

Implement OpenTelemetry custom instrumentation for Node.js applications to collect
logs, metrics, and traces using the Node.js OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation]
> (<https://opentelemetry.io/docs/languages/python/>).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for Node.js
- Configure manual tracing using spans
- Create and manage custom metrics
- Add semantic attributes and events
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- Node.js 14 or later installed
- A Node.js project set up
- Access to package installation (npm/yarn)

## Required Packages

Install the following necessary packages or add them to `package.json`:

```bash
npm install @opentelemetry/sdk-node
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/resources
npm install @opentelemetry/sdk-trace-node
npm install @opentelemetry/sdk-trace-base
npm install @opentelemetry/exporter-metrics-otlp-http
npm install @opentelemetry/sdk-metrics
npm install @opentelemetry/sdk-logs
npm install @opentelemetry/exporter-logs-otlp-http
npm install @opentelemetry/api
npm install @opentelemetry/api-logs
```

> **Note**: Ensure your OpenTelemetry Collector is properly configured to receive
> and process the telemetry data before forwarding to Scout backend.
[Click to know more](https://docs.base14.io/instrument/collector-setup/scout-exporter)
>
## Traces

To start tracing, first initialize the NodeSDK with trace configuration.
A Resource is an immutable representation of entity producing telemetry.

### Sample Reference code for Initialization

```javascript
// instrumentation.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');

// Define your service information
const resource = new Resource({
  'service.name': 'course-management-app-backend',
  'service.version': '1.0.0',
});

// Initialize NodeSDK with trace configuration
const sdk = new NodeSDK({
  resource,
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces'
  })),
});

// Start the SDK
sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
```

### Application Setup

> **Note:** Import instrumentation before any other modules

```javascript
// app.js
'use strict';
require('./instrumentation');

const express = require('express');
const { trace } = require('@opentelemetry/api');

const app = express();
// ... rest of your application setup
```

### Span

#### Creating Spans in Express Routes

```javascript
const express = require('express');
const { trace, context } = require('@opentelemetry/api');
const tracer = trace.getTracer('course-management-app-backend');

const router = express.Router();

router.get('/users', async (req, res) => {
  const span = tracer.startSpan('get-users');
  const ctx = trace.setSpan(context.active(), span);
  
  try {
    await context.with(ctx, async () => {
      // Your route logic here
      const users = await User.findAll();
      res.json(users);
    });
  } finally {
    span.end();
  }
});
```

### Span Attributes, Events, and Status

Spans can be enriched with additional context using attributes,
events and status indicators.
These features help in better understanding and debugging the behavior of your application.

#### Complete Span Example

```javascript
const { trace, context } = require('@opentelemetry/api');

router.post('/users', async (req, res) => {
  // Start a new span
  const span = tracer.startSpan('create-user');
  const ctx = trace.setSpan(context.active(), span);
  
  try {
    // Add attributes to the span
    span.setAttributes({
      'http.method': req.method,
      'http.route': '/users',
      'user.id': req.body?.id || 'unknown',
      'operation.type': 'create',
      'request.size': JSON.stringify(req.body).length
    });

    // Add an event for the start of user creation
    span.addEvent('Starting user creation', {
      'user.email': req.body?.email || 'unknown',
      'timestamp': new Date().toISOString()
    });

    // Business logic
    const user = await User.create(req.body);
    
    // Add another event for successful creation
    span.addEvent('User created successfully', {
      'user.id': user.id,
      'timestamp': new Date().toISOString()
    });
    
    // Set span status to OK (optional as it's the default)
    span.setStatus({ code: 1 }); // 1 = OK, 2 = Error
    
    res.status(201).json(user);
  } catch (error) {
    // Record the exception
    span.recordException(error);
    
    // Set error status and add error details
    span.setStatus({
      code: 2, // Error code
      message: error.message
    });
    
    // Add error-specific attributes
    span.setAttributes({
      'error.type': error.name,
      'error.stack': error.stack
    });
    
    // Add an error event
    span.addEvent('User creation failed', {
      'error.message': error.message,
      'error.type': error.name,
      'timestamp': new Date().toISOString()
    });
    
    res.status(400).json({ error: error.message });
  } finally {
    // Always end the span
    span.end();
  }
});
```

## Metrics

To start collecting metrics, you'll need to initialize the NodeSDK with metrics configuration.

### Sample Reference code for Metrics Initialization

```javascript
// instrumentation.js
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const sdk = new NodeSDK({
  resource,
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4318/v1/metrics'
    }),
  }),
});

sdk.start();
```

### Application Setup

```javascript
// app.js
const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('course-management-app-backend');
```

### Metrics types

#### Counter

##### Creating a Synchronous Counter

```javascript
const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('course-management-app-backend');

// Create a counter
const requestCounter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});

// Middleware to count requests
app.use((req, res, next) => {
  requestCounter.add(1, {
    method: req.method,
    route: req.route?.path || 'unknown',
  });
  next();
});
```

#### Histogram

##### Creating a Histogram

```javascript
const meter = metrics.getMeter('course-management-app-backend');

const requestDurationHistogram = meter.createHistogram(
  'http_request_duration_seconds', {
    description: 'HTTP request duration in seconds',
    boundaries: [0.01, 0.05, 0.1, 0.5, 1, 5]
  });

// Middleware to track request duration
app.use((req, res, next) => {
  const startTime = performance.now();
  
  res.on('finish', () => {
    const duration = (performance.now() - startTime) / 1000; // Convert to seconds
    requestDurationHistogram.record(duration, {
      method: req.method,
      route: req.route?.path || 'unknown',
      status: res.statusCode,
    });
  });
  
  next();
});
```

## Logs

Configure logs export in your instrumentation setup.

```javascript
// instrumentation.js
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');

const sdk = new NodeSDK({
  resource,
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter({
    url: 'http://localhost:4318/v1/logs'
  })),
});
```

### Creating Logs

```javascript
const logAPI = require('@opentelemetry/api-logs');

const logger = logAPI.logs.getLogger('course-management-app-backend');

// Emit a log with trace correlation
router.get('/users', async (req, res) => {
  const span = tracer.startSpan('get-users');
  
  try {
    const users = await User.findAll();
    
    // Emit log with trace correlation
    logger.emit({
      body: 'Users fetched successfully',
      severityNumber: logAPI.SeverityNumber.INFO,
      attributes: {
        userCount: users.length,
        endpoint: req.url
      },
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
    });
    
    res.json(users);
  } finally {
    span.end();
  }
});
```

>View your complete telemetry data in the base14 Scout observability platform.
[Click to know more](https://docs.base14.io/)

## References

- For complete setup example refer to [sample-react-full-stack application](https://opentelemetry.io/docs/instrumentation/js/)
- [Official OpenTelemetry Node.js Documentation](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [OpenTelemetry API Documentation](https://opentelemetry.io/docs/reference/specification/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/semantic-conventions/)
