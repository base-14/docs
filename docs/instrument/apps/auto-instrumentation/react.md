# React

Implement OpenTelemetry auto instrumentation for `React` applications to collect
traces using the JavaScript OTel SDK.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry auto instrumentation for React
- Configure automatic request and response tracing
- Export telemetry data to OpenTelemetry Collector

### Prerequisites

- Node.js 16+
- React application setup
- OTLP Collector setup

## Why Instrument apps in the Browser?

Browser-based applications run in an environment where performance is influenced
by factors like network speed, device type and user behavior. Instrumentation
helps developers understand how the app performs in real-world usage, identify
slow interactions, and improve user experience.

### What to Monitor in React Apps

- **Component Lifecycle**: Track mount/update/unmount cycles
- **User Interactions**: Clicks, form submissions, navigation
- **Performance**: Core Web Vitals (LCP, FID, CLS)

## Auto Instrumentation Setup

OpenTelemetry auto instrumentation allows developers to capture telemetry data
(mainly traces) without writing manual code.

> Note: OpenTelemetry auto instrumentation does not collect metrics by default.
> To capture meaningful metrics, you'll need to define and export them manually
> through custom instrumentation.

### Install Required Packages

```bash
npm install @opentelemetry/sdk-trace-web
npm install @opentelemetry/auto-instrumentations-web
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/resources
npm install @opentelemetry/exporter-trace-otlp-http 
npm install @opentelemetry/resources 
npm install @opentelemetry/semantic-conventions
```

### Setup OpenTelemetry

```js
// src/telemetry.js
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ZoneContextManager } from '@opentelemetry/context-zone';

export const setupTelemetry = () => {
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'react-service',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  });

  const traceExporter = new OTLPTraceExporter({
    url: 'http://<scout-collector-endpoint>:4318/v1/traces'
  });


  const provider = new WebTracerProvider({ resource });
  
  provider.addSpanProcessor(new BatchSpanProcessor(traceExporter));

  // Register the tracer provider with ZoneContextManager as it:
  // 1. Maintains context across async operations (Promises, setTimeout, etc.)
  // 2. Ensures proper trace context propagation in React's async rendering

  provider.register({
    contextManager: new ZoneContextManager()
  });


  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-fetch': {
          propagateTraceHeaderCorsUrls: [/.*/],
        },
        '@opentelemetry/instrumentation-xml-http-request': {
          propagateTraceHeaderCorsUrls: [/.*/],
        },
      }),
    ],
  });
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

### Auto-instrumentation Capabilities

OpenTelemetry's auto-instrumentation for browser applications automatically track
everal  key interactions:

1. **User Interactions**

2. **Fetch/XHR Requests**

3. **Document Loading**

## CORS Setup for Otel Collector

```http
Access-Control-Allow-Origin: http://<application-endpoint>:<application-port>
Access-Control-Allow-Headers: Content-Type, Traceparent 
Access-Control-Allow-Methods: POST, OPTIONS
```

## CSP Headers (if applicable)

```csp
connect-src 'self' http://<application-endpoint>:<application-port>;
img-src 'self' data:;
```

## Performance Considerations

1. **Bundle Size**
   - Use dynamic imports for non-critical instrumentation
   - Only include necessary instrumentations

2. **Sampling**
   - Sample high-frequency events to reduce overhead
   - Consider head-based sampling for distributed tracing

3. **Batching**
   - Use batch processors for better performance
   - Configure appropriate batch sizes and timeouts

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CORS errors | Verify collector CORS settings |
| Missing spans | Check browser console for errors |
| High memory usage | Adjust batch sizes and sampling |

> View these traces in base14 Scout observability backend.
>
## What's Next?

To monitor logs and metrics, see the
[custom instrumentation guide for JavaScript browser applications](https://github.com/base-14/docs/tree/main/docs/instrument/apps/custom-instrumentation/javascript-browser.md)

## References

[Sample react application with OTel instrumentation:](https://github.com/base14/react-auto-instrumentation)
