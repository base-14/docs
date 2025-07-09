# React

Implement OpenTelemetry custom instrumentation for `React`
applications to collect logs, metrics, and traces using the
JavaScript OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for `React`
- Configure manual instrumentation
- Create and manage custom metrics and logs
- Add semantic attributes and events
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- Node.js 16 or later installed
- A React application set up (create-react-app or similar)
- Access to package installation (npm or yarn)

## Required Packages

Install the following necessary packages or add them to your `package.json`:

```bash
# Core packages
npm install @opentelemetry/sdk-trace-web @opentelemetry/sdk-metrics @opentelemetry/api

# Instrumentation and Exporters
npm install @opentelemetry/auto-instrumentations-web \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http

# Additional required packages
npm install @opentelemetry/resources @opentelemetry/sdk-logs @opentelemetry/api-logs
```

## Basic Configuration

Create a `telemetry.js` file in your `src` directory with the
following OpenTelemetry setup:

```javascript
// src/telemetry.js
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import * as logsAPI from '@opentelemetry/api-logs';

export const setupTelemetry = () => {
  // Create resource
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'your-react-app',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  });

  // 1. Configure Traces
  const traceExporter = new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  });
  
  const traceProvider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  
  traceProvider.register();

  // 2. Configure Metrics
  const metricExporter = new OTLPMetricExporter({
    url: 'http://localhost:4318/v1/metrics',
  });
  
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000, // 10 seconds
      })
    ],
  });

  // 3. Configure Logs
  const logExporter = new OTLPLogExporter({
    url: 'http://localhost:4318/v1/logs',
  });
  
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  
  logsAPI.logs.setGlobalLoggerProvider(loggerProvider);

  // 4. Auto-instrumentation
  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-xml-http-request': {
          propagateTraceHeaderCorsUrls: [/.+/g],
        },
        '@opentelemetry/instrumentation-fetch': {
          propagateTraceHeaderCorsUrls: [/.+/g],
        },
      }),
    ],
  });

  return {
    traceProvider,
    meterProvider,
    loggerProvider,
  };
};
```

### Initialization in Your App

Initialize the telemetry in your application's entry point (e.g., `index.js`):

```javascript
// src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import { setupTelemetry } from './telemetry';
import App from './App';

// Initialize OpenTelemetry
setupTelemetry();

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
```

## Traces

### Basic Tracing

```javascript
// This will use the globally registered trace provider
import { trace } from '@opentelemetry/api';

function fetchUserData(userId) {
  const tracer = trace.getTracer('user-service');
  return tracer.startActiveSpan('fetchUserData', async (span) => {
    try {
      span.setAttribute('user.id', userId);
      const response = await fetch(`/api/users/${userId}`);
      return await response.json();
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### 1. Track Component Performance

```javascript
import { trace } from '@opentelemetry/api';

function withPerformanceMonitor(WrappedComponent, componentName) {
  return function MonitoredComponent(props) {
    const tracer = trace.getTracer('react-performance');
    const span = tracer.startSpan(`render:${componentName}`);
    
    try {
      return <WrappedComponent {...props} />;
    } finally {
      span.end();
    }
  };
}
```

### 2. Track User Interactions

```javascript
function trackInteraction(interactionName, attributes = {}) {
  const tracer = trace.getTracer('user-interactions');
  const span = tracer.startSpan(interactionName);
  
  Object.entries(attributes).forEach(([key, value]) => {
    span.setAttribute(key, value);
  });
  
  span.end();
}
```

## Metrics

### Component Metrics

```javascript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('react-app');
const pageLoadTime = meter.createHistogram('page.load.time', { unit: 'ms' });
const renderCount = meter.createCounter('component.render.count');

function TrackedComponent() {
  useEffect(() => {
    const start = performance.now();
    renderCount.add(1, { component: 'TrackedComponent' });
    
    return () => {
      pageLoadTime.record(performance.now() - start, { page: 'home' });
    };
  }, []);
  
  return <div>Component</div>;
}
```

### API Metrics

```javascript
const apiDuration = meter.createHistogram('api.duration', { unit: 'ms' });

async function fetchWithMetrics(url, options = {}) {
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    apiDuration.record(performance.now() - start, {
      method: options.method || 'GET',
      status: res.status,
      path: new URL(url).pathname
    });
    return res;
  } catch (error) {
    apiDuration.record(performance.now() - start, {
      method: options.method || 'GET',
      error: error.message,
      path: new URL(url).pathname
    });
    throw error;
  }
}
```

## Logs

### Structured Logging

```javascript
import { logs } from '@opentelemetry/api-logs';

const logger = logs.getLogger('app');

function logEvent(action, details = {}) {
  logger.emit({
    severityNumber: logs.SeverityNumber.INFO,
    body: action,
    attributes: {
      ...details,
      timestamp: new Date().toISOString()
    }
  });
}

// Usage
function Login() {
  const login = (email) => {
    try {
      // login logic
      logEvent('login_success', { email });
    } catch (error) {
      logEvent('login_failed', { 
        error: error.message,
        email,
        stack: error.stack 
      });
    }
  };
}
```

## Configuration

### CORS Headers

```http
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: POST, OPTIONS
```

### CSP Headers

```csp
connect-src 'self' http://localhost:4318;
img-src 'self' data:;
```

## Best Practices

1. **Component Instrumentation**
   - Wrap performance-critical components with performance monitors
   - Track user journeys with custom spans

2. **Error Handling**
   - Use Error Boundaries to catch React errors
   - Log errors with relevant context

3. **Performance**
   - Batch telemetry data to reduce network requests
   - Use sampling in production
   - Monitor bundle size impact

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CORS errors | Verify collector CORS settings |
| Missing spans | Check browser console for errors |
| High memory usage | Adjust batch sizes and sampling |
| Missing logs | Verify log level configuration |

## Next Steps

- [OpenTelemetry JavaScript Documentation](https://opentelemetry.io/docs/languages/js/)
