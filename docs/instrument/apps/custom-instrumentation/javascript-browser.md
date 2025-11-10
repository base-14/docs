---
title: Browser JavaScript Custom OpenTelemetry Instrumentation
sidebar_label: Browser JavaScript
description:
  Custom instrumentation for browser JavaScript with OpenTelemetry. Manual
  tracing, metrics, logs for web applications with browser OTel SDK.
keywords:
  [
    browser monitoring,
    javascript instrumentation,
    frontend monitoring,
    opentelemetry browser,
    web application monitoring,
  ]
---

# JavaScript Browser

This guide provides instructions for setting up **custom instrumentation** for
JavaScript browser applications using the OpenTelemetry JavaScript SDK.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for JavaScript browser
  applications
- Export telemetry data to Scout

> **Note:** Auto instrumentation does not support metrics. To collect meaningful
> metrics, you need to implement them manually.

## Prerequisites

- Node.js 16+
- JavaScript browser application setup
- Scout Collector setup

## Required Packages

Install the following packages:

```bash
npm install @opentelemetry/api
npm install @opentelemetry/sdk-trace-web
npm install @opentelemetry/sdk-metrics
npm install @opentelemetry/sdk-logs
npm install @opentelemetry/context-zone
npm install @opentelemetry/exporter-trace-otlp-http
npm install @opentelemetry/exporter-metrics-otlp-http
npm install @opentelemetry/resources
```

## Custom Instrumentation Setup (`telemetry.js`)

```javascript
// src/telemetry.js
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import * as logsAPI from "@opentelemetry/api-logs";
import * as api from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";

export const setupTelemetry = () => {
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "react-service",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  });

  // Trace setup
  const traceExporter = new OTLPTraceExporter({
    url: "http://<scout-collector-endpoint>:4318/v1/traces",
  });
  const traceProvider = new WebTracerProvider({ resource });
  traceProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
  traceProvider.register({ contextManager: new ZoneContextManager() });

  // Metric setup
  const metricExporter = new OTLPMetricExporter({
    url: "http://<scout-collector-endpoint>:4318/v1/metrics",
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000,
      }),
    ],
  });

  api.metrics.setGlobalMeterProvider(meterProvider);

  // Log setup
  const logExporter = new OTLPLogExporter({
    url: "http://<scout-collector-endpoint>:4318/v1/logs",
  });
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

## Custom Tracing Example

```javascript
import { trace } from "@opentelemetry/api";

async function checkServiceHealth() {
  // Get the tracer from the global tracer provider set in the setupTelemetry function
  const tracer = trace.getTracer("health-service");
  const span = tracer.startSpan("checkServiceHealth");

  try {
    span.setAttribute("health.check", "ping");
    const res = await fetch("/ping");
    const data = await res.json();
    return data;
  } catch (error) {
    // handle error
    throw error;
  } finally {
    span.end();
  }
}
```

## Custom Metrics Example

```javascript
import { metrics } from "@opentelemetry/api";
// Gets the meter from the global meter provider set in the setupTelemetry function
const meter = metrics.getMeter("react-app");
const renderCount = meter.createCounter("component.render.count");

function TrackedComponent() {
  useEffect(() => {
    renderCount.add(1, { component: "TrackedComponent" });
  }, []);

  return <div>Tracked!</div>;
}
```

## Configuration

### CORS Headers for Otel Collector

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

> View these traces in Scout Grafana dashboards.

## References

[Sample react application with OTel instrumentation](https://github.com/base14/react-custom-instrumentation)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [React Auto-Instrumentation](../auto-instrumentation/react.md) -
  Auto-instrumentation for React applications
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
