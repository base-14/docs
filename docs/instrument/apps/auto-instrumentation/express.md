---
date: 2025-11-19
title: Express.js OpenTelemetry Instrumentation Guide
sidebar_label: Express.js
sidebar_position: 3
description:
  Auto-instrument Express.js with OpenTelemetry for traces and metrics. Complete
  Node.js APM setup with distributed tracing and HTTP monitoring.
keywords:
  [
    express monitoring,
    nodejs apm,
    express instrumentation,
    opentelemetry express,
    nodejs monitoring,
  ]
---

# Express

Implement OpenTelemetry instrumentation for `Express.js` applications to collect
traces, metrics and monitor HTTP requests using the `Node.js` OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/instrumentation/).

## Required Packages

`opentelemetry-api` defines the API interfaces for tracing, metrics, and logging;
`opentelemetry-sdk` provides the implementation for these APIs.

Install the following necessary packages or add them to `package.json` and install:

```plaintext
@opentelemetry/api
@opentelemetry/resources
@opentelemetry/sdk-node
@opentelemetry/semantic-conventions
```

## Configuration

The setup process involves three main components:

### SDK Initialization

- Configure OpenTelemetry SDK
- Set up resource attributes
- Initialize trace and metric exporters

```typescript title="src/utils/telemetry.ts" showLineNumbers
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "express-application",
    [ATTR_SERVICE_VERSION]: "1.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),

  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
  }),
});

sdk.start();
```

```typescript title="src/index.ts" showLineNumbers
// Main Entry Point
// Before importing anything, import this to initialize the SDK

import "../src/utils/telemetry";
```

### Middleware Configuration

- Set up request tracking
- Configure response monitoring
- Implement error handling

```typescript title="src/middlewares/telemetryMiddleware.ts" showLineNumbers
import { Request, Response, NextFunction } from "express";
import { context, trace, SpanStatusCode, metrics } from "@opentelemetry/api";

const tracer = trace.getTracer("express-application", "1.0.0");
const meter = metrics.getMeter("express-application");

const totalRequestsCounter = meter.createCounter("http_requests_total", {
  description: "Total number of HTTP requests received",
});

const successfulRequestsCounter = meter.createCounter("http_requests_success", {
  description: "Total number of successful HTTP responses sent by the server",
});

const failedRequestsCounter = meter.createCounter("http_requests_fail", {
  description: "Total number of failed HTTP responses sent by the server",
});

export function telemetryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const safeHeaders = { ...req.headers };
  if (safeHeaders.authorization) {
    safeHeaders.authorization = "[REDACTED]";
  }

  const span = tracer.startSpan(
    `HTTP ${req.method}`,
    {
      attributes: {
        "http.method": req.method,
        "http.url": req.url,
        "http.path": req.path,
        "request.http.headers": JSON.stringify(safeHeaders),
      },
    },
    context.active(),
  );

  context.with(trace.setSpan(context.active(), span), () => {
    totalRequestsCounter.add(1, {
      method: req.method,
      path: req.path,
      route: req.route?.path || "unknown",
    });

    res.on("finish", () => {
      span.setAttribute("http.status_code", res.statusCode);
      span.setAttribute(
        "response.http.headers",
        JSON.stringify(res.getHeaders()),
      );
      if (res.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        failedRequestsCounter.add(1, {
          method: req.method,
          path: req.path,
          route: req.route?.path || "unknown",
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
        successfulRequestsCounter.add(1, {
          method: req.method,
          path: req.path,
          route: req.route?.path || "unknown",
        });
      }
      span.end();
    });

    next();
  });
}
```

```typescript title="src/index.ts" showLineNumbers
import { telemetryMiddleware } from "./middleware/telemetryMiddleware";

const app = express();

app.use(telemetryMiddleware);
```

> This will capture the request and response information and construct traces
> out of it.

## References

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Node.js Instrumentation](../custom-instrumentation/javascript-node.md)
  \- Manual instrumentation for advanced use cases
- [Fast API Instrumentation](./fast-api.md) - Python web framework alternative
