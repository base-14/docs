# Express

This guide demonstrates how to Auto instrument tracing and metrics using
OpenTelemetry for Express and export them to a collector using OTEL sdk.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/instrumentation/).

## Setup

opentelemetry-api defines the API interfaces for tracing, metrics, and logging
and opentelemetry-sdk provides the implementation for these APIs.
Run the following commands to install the necessary packages or add it to
`package.json` and install it.

```plaintext
'@opentelemetry/api'
'@opentelemetry/resources'
'@opentelemetry/sdk-node'
'@opentelemetry/semantic-conventions'
```

## Initialization

Before any other module in your application is loaded, you must initialize the
SDK. If you fail to initialize the SDK or initialize it too late, no-op
implementations will be provided to any library that acquires a tracer or meter
from the API.

```typescript
// src/utils/telemetry.ts

import {NodeSDK} from '@opentelemetry/sdk-node';
import {PeriodicExportingMetricReader} from '@opentelemetry/sdk-metrics';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-proto';
import {OTLPMetricExporter} from '@opentelemetry/exporter-metrics-otlp-proto';
import {resourceFromAttributes} from '@opentelemetry/resources';
import {
    ATTR_SERVICE_NAME,
    ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
    resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'express-application',
        [ATTR_SERVICE_VERSION]: '1.0',
    }),
    traceExporter: new OTLPTraceExporter({
        url: 'http://localhost:4318/v1/traces',
    }),

    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
            url: 'http://localhost:4318/v1/metrics',
        }),
    }),
});

sdk.start();
```

```typescript
// src/index.ts ( Main Entry Point )
// Before importing Anything importing this would initilize the sdk

import '../src/utils/telemetry';
```

## Capturing Request and Response Info

We will have a middleware which capture the request headers, url, path and the
response headers.

```typescript
//src/middlewares/telemetryMiddleware.ts

import {Request, Response, NextFunction} from 'express';
import {context, trace, SpanStatusCode, metrics} from '@opentelemetry/api';

const tracer = trace.getTracer('express-application', '1.0.0');
const meter = metrics.getMeter('express-application');

const totalRequestsCounter = meter.createCounter('http_requests_total', {
    description: 'Total number of HTTP requests received',
});

const successfulRequestsCounter = meter.createCounter('http_requests_success', {
    description: 'Total number of successful HTTP responses sent by the server',
});

const failedRequestsCounter = meter.createCounter('http_requests_fail', {
    description: 'Total number of failed HTTP responses sent by the server',
});

export function telemetryMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const safeHeaders = {...req.headers};
    if (safeHeaders.authorization) {
        safeHeaders.authorization = '[REDACTED]';
    }

    const span = tracer.startSpan(`HTTP ${req.method}`, {
        attributes: {
            'http.method': req.method,
            'http.url': req.url,
            'http.path': req.path,
            'request.http.headers': JSON.stringify(safeHeaders),
        },
    }, context.active());

    context.with(trace.setSpan(context.active(), span), () => {
        totalRequestsCounter.add(1, {
            method: req.method,
            path: req.path,
            route: req.route?.path || 'unknown',
        });

        res.on('finish', () => {
            span.setAttribute('http.status_code', res.statusCode);
            span.setAttribute('response.http.headers', JSON.stringify(res.getHeaders()))
            if (res.statusCode >= 400) {
                span.setStatus({code: SpanStatusCode.ERROR});
                failedRequestsCounter.add(1, {
                    method: req.method,
                    path: req.path,
                    route: req.route?.path || 'unknown',
                });
            } else {
                span.setStatus({code: SpanStatusCode.OK});
                successfulRequestsCounter.add(1, {
                    method: req.method,
                    path: req.path,
                    route: req.route?.path || 'unknown',
                });
            }
            span.end();
        });

        next();
    });
}
```

```typescript
// src/index.ts

import {telemetryMiddleware} from './middleware/telemetryMiddleware';

const app = express();

app.use(telemetryMiddleware);
```

> This will capture the request and response information and construct traces
> out of it.

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

### Custom Instrumentation

#### Add Span Attributes in Child Functions

```typescript
import opentelemetry from '@opentelemetry/api';
import {trace, Span, context} from '@opentelemetry/api';

const tracer = opentelemetry.trace.getTracer(
    'express-application',
    '0.1.0',
);

const do_work = () => {
    const span = trace.getSpan(context.active());
    span.setAttribute('attribute.key', 'attribute.value');
    // doing some work...
}
```

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Create Nested Spans

```typescript
import opentelemetry from '@opentelemetry/api';
import {trace, context} from '@opentelemetry/api';

const tracer = trace.getTracer('express-application', '0.1.0');

const do_work = () => {
    const parentSpan = trace.getSpan(context.active());
    return context.with(context.active(), () => {
        child_func();
    });
};

const child_func = () => {
    const childSpan = tracer.startSpan('child_func', undefined, context.active());
    return context.with(trace.setSpan(context.active(), childSpan), () => {
        // doing some work....

        childSpan.end();
    });
};
```

### Add Span Events

```typescript
import opentelemetry from '@opentelemetry/api';
import {trace, Span, context} from '@opentelemetry/api';

const tracer = opentelemetry.trace.getTracer(
    'express-application',
    '0.1.0',
);

const do_work = () => {
    const span = trace.getSpan(context.active());
    span.addEvent('Doing something');
    // doing some work...
}
```

[Official Span Events Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)

## Metrics

Metrics combine individual measurements into aggregates, and produce data which
is constant as a function of system load. Aggregates lack details required to
diagnose low level issues, but complement spans by helping to identify trends
and providing application runtime telemetry.

### Add a Counter Metric

```typescript
import {metrics} from '@opentelemetry/api';

const meter = metrics.getMeter('express-application');

const totalRequestsCounter = meter.createCounter('http_requests_total', {
    description: 'Total number of HTTP requests received',
});

totalRequestsCounter.add(1, {
    method: "example method",
    path: "GET",
    route: 'unknown',
});

```

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)
