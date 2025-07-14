# React – Custom Instrumentation with OpenTelemetry

This guide provides instructions for setting up **custom instrumentation**
in React applications using the OpenTelemetry JavaScript SDK.It covers
how to manually create spans, capture custom metrics, and log structured events.
> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/getting-started/browser/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for React
- Export telemetry data to OpenTelemetry Collector

> **Note:** Auto instrumentation does not support metrics. To collect meaningful
metrics, you need to implement them manually.

---

## Prerequisites

- Node.js 16+
- React application setup
- OTLP Collector setup

---

## Required Packages

Install the following packages:

```bash
npm install @opentelemetry/api     
npm install @opentelemetry/sdk-trace-web 
npm install @opentelemetry/sdk-metrics 
npm install @opentelemetry/sdk-logs 
npm install @opentelemetry/api-logs 
npm install @opentelemetry/context-zone 
npm install @opentelemetry/exporter-trace-otlp-http 
npm install @opentelemetry/exporter-metrics-otlp-http 
npm install @opentelemetry/exporter-logs-otlp-http 
npm install @opentelemetry/resources
```

---

## Custom Instrumentation Setup (`telemetry.js`)

```javascript
// src/telemetry.js
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import * as logsAPI from '@opentelemetry/api-logs';
import * as api from '@opentelemetry/api';

export const setupTelemetry = () => {
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'your-react-app',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  });

  // Trace setup
  const traceExporter = new OTLPTraceExporter({ url: 'http://0.0.0.0:4318/v1/traces' });
  const traceProvider = new WebTracerProvider({ resource });
  traceProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
  traceProvider.register({ contextManager: new    () });

  // Metric setup
  const metricExporter = new OTLPMetricExporter({ url: 'http://0.0.0.0:4318/v1/metrics' });
  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10000,
    })],
  });

  api.metrics.setGlobalMeterProvider(meterProvider);

  // Log setup
  const logExporter = new OTLPLogExporter({ url: 'http://0.0.0.0:4318/v1/logs' });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
};
```

### Initialize in index.js

```js
// src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import { setupTelemetry } from './telemetry';

setupTelemetry();

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
```

---

## Custom Tracing Example

```javascript

import { trace } from '@opentelemetry/api';

function fetchUserData(userId) {
  // Get the tracer from the global tracer provider set in the setupTelemetry function
  const tracer = trace.getTracer('user-service');
  return tracer.startActiveSpan('fetchUserData', async (span) => {
    try {
      span.setAttribute('user.id', userId);
      const res = await fetch(`/api/users/${userId}`);
      return await res.json();
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

## Custom Metrics Example

```javascript

import { metrics } from '@opentelemetry/api';
//Gets the meter from the global meter provider set in the setupTelemetry function
const meter = metrics.getMeter('react-app');
const renderCount = meter.createCounter('component.render.count');

function TrackedComponent() {
  useEffect(() => {
    renderCount.add(1, { component: 'TrackedComponent' });
  }, []);

  return <div>Tracked!</div>;
}
```

---

## Custom Logs Example

```javascript
import { logs } from '@opentelemetry/api-logs';
//Gets the logger from the global logger provider set in the setupTelemetry function
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
```

---

## Configuration

### CORS Headers for Otel Collector

```http
Access-Control-Allow-Origin: http://0.0.0.0:{application_port}
Access-Control-Allow-Headers: Content-Type, Traceparent
Access-Control-Allow-Methods: POST, OPTIONS
```

### CSP Headers (if applicable)

```csp
connect-src 'self' http://0.0.0.0:{application_port};
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

> View these traces in base14 Scout observability backend.
>

## References

 Sample react application with OTel instrumentation: <https://github.com/base14/react-custom-instrumentation>
