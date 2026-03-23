---
title: React OpenTelemetry Instrumentation - Browser Tracing & Web Vitals
sidebar_label: React
sidebar_position: 14
description:
  Add OpenTelemetry to React. Trace browser interactions, HTTP requests,
  and Core Web Vitals. Works with any backend.
keywords:
  [
    react monitoring,
    frontend monitoring,
    react instrumentation,
    opentelemetry react,
    browser monitoring,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I add OpenTelemetry tracing to a React application?","acceptedAnswer":{"@type":"Answer","text":"Install @opentelemetry/sdk-trace-web and @opentelemetry/auto-instrumentations-web, call setupTelemetry() before your React app renders, and point the OTLP exporter at your base14 Scout Collector endpoint."}},{"@type":"Question","name":"What does OpenTelemetry auto-instrumentation capture in the browser?","acceptedAnswer":{"@type":"Answer","text":"Auto-instrumentation captures fetch and XHR requests, document load timing, and user interactions like clicks and form submissions - all with no manual span code required."}},{"@type":"Question","name":"Can I monitor Core Web Vitals with OpenTelemetry in React?","acceptedAnswer":{"@type":"Answer","text":"Yes, you can capture Core Web Vitals (LCP, FID, CLS) alongside OpenTelemetry traces to correlate real user performance metrics with distributed traces in base14 Scout."}},{"@type":"Question","name":"Does OpenTelemetry browser tracing work with React Router?","acceptedAnswer":{"@type":"Answer","text":"Yes, OpenTelemetry traces navigation events and route changes in single-page React apps. Each route transition and associated API calls are captured as linked spans."}}]}
---

# React

Implement OpenTelemetry auto instrumentation for `React` applications to collect
traces using the JavaScript OTel SDK.

:::tip TL;DR

Install the `@opentelemetry/auto-instrumentations-web` package, call
`setupTelemetry()` before your React app renders, and point the OTLP exporter
at your Scout Collector endpoint. This gives you automatic tracing for fetch/XHR
requests, document load timing, and user interactions with no manual span code
required.

:::

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry auto instrumentation for React
- Configure automatic request and response tracing
- Export telemetry data to Scout Collector

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
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { ZoneContextManager } from "@opentelemetry/context-zone";

export const setupTelemetry = () => {
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "react-service",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  });

  const traceExporter = new OTLPTraceExporter({
    url: "http://<scout-collector-endpoint>:4318/v1/traces",
  });

  const provider = new WebTracerProvider({ resource });

  provider.addSpanProcessor(new BatchSpanProcessor(traceExporter));

  // Register the tracer provider with ZoneContextManager as it:
  // 1. Maintains context across async operations (Promises, setTimeout, etc.)
  // 2. Ensures proper trace context propagation in React's async rendering

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-fetch": {
          propagateTraceHeaderCorsUrls: [/.*/],
        },
        "@opentelemetry/instrumentation-xml-http-request": {
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
import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import { setupTelemetry } from "./telemetry";

setupTelemetry();

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root"),
);
```

### Auto-instrumentation Capabilities

OpenTelemetry's auto-instrumentation for browser applications automatically
track everal key interactions:

1. **User Interactions**

2. **Fetch/XHR Requests**

3. **Document Loading**

## CORS Setup for Otel Collector

Add the following CORS headers to the Otel Collector configuration:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - "https://example.com"
```

> View these traces in base14 Scout observability backend.

## What's Next?

To monitor logs and metrics, see the
[custom instrumentation guide for JavaScript browser applications](https://github.com/base-14/docs/tree/main/docs/instrument/apps/custom-instrumentation/javascript-browser.md)

## Related Guides

- [Custom JavaScript Browser Instrumentation](../custom-instrumentation/javascript-browser.md)
  \- Manual instrumentation for logs and metrics
- [Express.js Instrumentation](./express.md) - Backend Node.js framework
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
