---
title: Angular OpenTelemetry - Browser Traces, Metrics, Logs
sidebar_label: Angular
sidebar_position: 14
description:
  Instrument Angular 22 (zoneless) with OpenTelemetry - browser traces, Core Web
  Vitals metrics, and error logs, correlated end-to-end to your API and database.
keywords:
  [
    angular opentelemetry instrumentation,
    angular monitoring,
    angular apm,
    angular distributed tracing,
    angular observability,
    angular performance monitoring,
    opentelemetry angular,
    angular telemetry,
    angular browser tracing,
    angular rum opentelemetry,
    angular real user monitoring,
    zoneless angular opentelemetry,
    angular web vitals metrics,
    angular router navigation spans,
    angular fetch instrumentation,
    angular browser logs opentelemetry,
    angular traceparent propagation,
    angular three signals observability,
    angular error tracking opentelemetry,
    angular production monitoring,
  ]
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# Angular

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## Introduction

Implement OpenTelemetry instrumentation for Angular applications to bring real
user monitoring (RUM), distributed tracing, and front-end observability to
single-page apps. This guide shows you how to auto-instrument document loads,
user interactions, and `fetch`/`XHR` calls in the browser, then propagate W3C
trace context to your backend so a single trace spans the browser, your API,
and your database.

It covers all three OpenTelemetry signals from the browser: **traces** (page
loads, interactions, route changes, and API calls), **metrics** (Core Web
Vitals as histograms), and **logs** (uncaught errors and failed requests as
ERROR records, correlated to the trace that caused them). The backend adds HTTP
and runtime metrics plus trace-correlated logs, so the browser and API tell one
story.

The example app is **Angular 22**, which is **zoneless by default**. The
instrumentation is identical on a zone.js application; the only difference is
how an interaction's asynchronous work is parented inside the browser. Both
variants are covered under
[Context Propagation](#context-propagation-zoneless-vs-zonejs). Whether you are
migrating from a commercial RUM product, debugging why a page feels slow, or
connecting a slow API call back to the click that caused it, this guide gives
you production-ready configuration.

:::tip TL;DR

Initialize the browser SDK in `main.ts` before `bootstrapApplication`. Register
the `WebTracerProvider` with the default `StackContextManager`
(`provider.register()` - no zone.js needed), and call
`setGlobalMeterProvider()` and `setGlobalLoggerProvider()` so metrics and logs
are not silently dropped. Add `@opentelemetry/auto-instrumentations-web` for
document-load, fetch, XHR, and interaction spans, set
`propagateTraceHeaderCorsUrls` to your API origin so the `traceparent` header
links the browser trace to your backend, record Core Web Vitals as metric
histograms, and emit uncaught errors as ERROR logs.

:::

## Who This Guide Is For

This documentation is designed for:

- **Angular developers**: adding browser tracing, metrics, and error logs to
  standalone, signal-based Angular apps.
- **Front-end engineers**: connecting slow user interactions to the API and
  database calls behind them with one end-to-end trace.
- **Full-stack teams**: correlating browser spans, Web Vitals, and error logs
  with existing backend instrumentation across a shared trace id.
- **Platform teams**: standardizing web observability across several Angular
  apps with a consistent, zoneless-ready setup.
- **SRE and DevOps**: deploying instrumented Angular SPAs behind nginx and a
  collector with correct CORS in both directions.

## Overview

### Prerequisites

Before starting, ensure you have:

- **Node.js 24.15+ or 26+** to build the app (the Angular 22 engines range).
- **Angular 20 or later** - the example uses `provideBrowserGlobalErrorListeners()`
  (added in v20) and zoneless change detection (stable in v20, default in v21);
  this guide uses **Angular 22**. The browser SDK setup itself works on any
  standalone Angular (16+), but the error-handling wiring shown here needs v20+.
- **A Scout Collector** reachable from the browser over OTLP/HTTP, with traces,
  metrics, and logs pipelines.
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development.
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production.
- A backend API that accepts cross-origin requests and echoes back CORS
  headers (this guide uses Express + Postgres).
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics, logs,
  attributes).

### Compatibility Matrix

| Component                                    | Minimum Version | Recommended |
| -------------------------------------------- | --------------- | ----------- |
| Angular                                      | 20.0.0          | 22.0.4      |
| Node.js (build)                              | 24.15.0         | 26.x        |
| @opentelemetry/api                           | 1.9.0           | 1.9.1       |
| @opentelemetry/api-logs                      | 0.200.0         | 0.219.0     |
| @opentelemetry/sdk-trace-web                 | 2.0.0           | 2.8.0       |
| @opentelemetry/sdk-metrics                   | 2.0.0           | 2.8.0       |
| @opentelemetry/sdk-logs                      | 0.200.0         | 0.219.0     |
| @opentelemetry/auto-instrumentations-web     | 0.50.0          | 0.64.0      |
| @opentelemetry/exporter-trace-otlp-http      | 0.200.0         | 0.219.0     |
| @opentelemetry/exporter-metrics-otlp-http    | 0.200.0         | 0.219.0     |
| @opentelemetry/exporter-logs-otlp-http       | 0.200.0         | 0.219.0     |
| web-vitals                                   | 4.0.0           | 5.3.0       |
| opentelemetry-collector-contrib              | 0.120.0         | 0.153.0     |

Angular 21 and later ship **zoneless** by default (`ng new` no longer adds
zone.js). The setup below assumes zoneless; the zone.js opt-in is a three-line
delta shown later.

### Instrumented Components

| Signal  | Source                                     | Emitted as         |
| ------- | ------------------------------------------ | ------------------ |
| Traces  | `instrumentation-document-load`            | document-load span |
| Traces  | `instrumentation-user-interaction`         | click/submit span  |
| Traces  | `instrumentation-fetch` / `-xml-http-request` | HTTP client span |
| Traces  | Custom `Router.events` subscription        | `router.navigation` span |
| Metrics | `web-vitals` library                       | histograms (`web_vitals.*`) |
| Logs    | Custom Angular `ErrorHandler`              | ERROR log (best-effort) |
| Logs    | Custom `HttpClient` interceptor            | ERROR log (trace-correlated) |

The backend (Express + Node SDK) adds `http.server.request.duration` and
runtime metrics plus trace-correlated `pino` logs, so the browser and API share
one trace id across all three signals.

A complete, runnable version of everything in this guide lives in
[base-14/examples/nodejs/angular-fullstack-otel](https://github.com/base-14/examples/tree/main/nodejs/angular-fullstack-otel).

## Installation

Install the browser SDK for all three signals, the web auto-instrumentations,
the OTLP/HTTP exporters, and the Web Vitals library.

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash
npm install \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-web \
  web-vitals
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash
yarn add \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-web \
  web-vitals
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash
pnpm add \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-web \
  web-vitals
```

```mdx-code-block
</TabItem>
</Tabs>
```

The OpenTelemetry JS packages move on a few separate version lines: the SDK
packages `sdk-trace-web`, `sdk-metrics`, and `resources` are on the stable `2.x`
line (2.8.0), `semantic-conventions` is on the `1.x` line (1.41.1), and
`api-logs`, `sdk-logs`, `instrumentation`, plus the OTLP exporters share the
`0.2xx` experimental line (0.219.0), while `auto-instrumentations-web` tracks
its own contrib line (0.64.0). Keep `@opentelemetry/api` to a single version
(1.9.1) so the bundle does not pull duplicate copies.

## Configuration

Telemetry settings differ between a development build (`ng serve`) and a
production build (`ng build`). Angular's environment files are the simplest
place to keep them, but a runtime config file or container environment also
works.

```mdx-code-block
<Tabs>
<TabItem value="env" label="environment.ts (Recommended)" default>
```

```typescript title="src/environments/environment.ts" showLineNumbers
// Production build config (used by `ng build`). The browser runs on the host in
// every mode of this example, so the collector/API are reached via localhost.
// The whole local stack runs as a single `development` environment (matching the
// backend DEPLOY_ENV and the collector's SCOUT_ENVIRONMENT default) so one trace
// carries one environment. For a real deployment, set this to `production` and
// override the endpoints (e.g. a runtime assets/config.json).
export const environment = {
  production: true,
  otelServiceName: 'angular-browser',
  deploymentEnvironment: 'development',
  otelCollectorUrl: 'http://localhost:4318',
  apiBaseUrl: 'http://localhost:3000/api',
  // Only attach `traceparent` to our own API (don't leak trace headers cross-site).
  apiTraceUrls: [/^http:\/\/localhost:3000/] as RegExp[],
};
```

Angular swaps in `environment.development.ts` during `ng serve` via the
`fileReplacements` entry in `angular.json`, so dev and prod can point at
different collector and API origins without code changes.

```mdx-code-block
</TabItem>
<TabItem value="runtime" label="Runtime config.json">
```

For container images that must be configurable without a rebuild, load a JSON
file from `assets/` at startup instead of compiling values into the bundle.

```json title="src/assets/otel-config.json"
{
  "otelServiceName": "angular-browser",
  "deploymentEnvironment": "production",
  "otelCollectorUrl": "https://collector.example.com",
  "apiBaseUrl": "https://api.example.com"
}
```

For this variant, refactor `initBrowserTelemetry` to accept the config object
(instead of reading the compiled-in `environment`), then fetch the file and pass
it in before bootstrap:

```typescript title="src/main.ts (runtime variant)"
// initBrowserTelemetry(cfg: OtelConfig) reads endpoints from cfg, not environment
const cfg = await fetch('/assets/otel-config.json').then((r) => r.json());
initBrowserTelemetry(cfg);
```

Fetch the config before bootstrap so the SDK starts with the right endpoints. The
trade-off is one extra request before bootstrap.

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose (collector)">
```

The browser exports straight to the collector, so the collector decides which
SPA origins it trusts. Set the OTLP HTTP receiver's CORS allow-list to every
origin the app is served from, and run a pipeline for each signal.

```yaml title="config/otel-config.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - http://localhost:4200   # ng serve (dev)
            - http://localhost:8080   # nginx container
          allowed_headers:
            - "*"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### Build-time vs runtime configuration

Compiling endpoints into the bundle (the `environment.ts` approach) is simplest
and fastest, but it bakes the collector and API URLs into the image. If you
ship one image to several environments, prefer the runtime `config.json`
approach so the same artifact reads its endpoints at startup.

### Serving the built app

The `@angular/build:application` builder emits the browser bundle under
`dist/<project>/browser`. Serve it from any static host. With nginx, add an SPA
fallback so deep links resolve to `index.html`:

```nginx title="frontend/nginx.conf"
server {
  listen 80;

  # SPA fallback: Angular handles client-side routes, so unknown paths must
  # return index.html rather than 404 (deep links like /items, /about).
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }
}
```

```dockerfile title="frontend/Dockerfile"
# Build the Angular bundle, then serve the static output from nginx.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

### Export cadence and batching

Each signal exports off the interaction path on its own schedule. The
`BatchSpanProcessor` and `BatchLogRecordProcessor` buffer spans and log records
and flush on a timer; the `PeriodicExportingMetricReader` exports metrics every
`exportIntervalMillis` (10 seconds in the example). For chatty UIs, raise the
span processor's `maxQueueSize` and `maxExportBatchSize` so bursts are not
dropped. Because Core Web Vitals and last-moment errors are reported as the page
is hidden, force a flush of all three providers on `visibilitychange` and
`pagehide` (shown in the bootstrap below) so that data is not lost with the tab.

### Reverse-proxy alternative to collector CORS

Instead of opening CORS on the collector, you can serve the collector under the
same origin as the SPA through a reverse proxy (for example, proxy
`/v1/traces`, `/v1/metrics`, and `/v1/logs` on the app's domain to the
collector). Same-origin export removes the browser preflight entirely. Point
`otelCollectorUrl` at the app origin and drop the `cors` block from the
receiver.

## Angular-Specific Features

### Initialize before bootstrap

Call the SDK setup in `main.ts` **before** `bootstrapApplication`, so the
document-load span and the earliest interactions are captured. The Angular
Router is not available here (it only exists after dependency injection is up),
so router tracing is wired separately from the root component.

```typescript title="src/main.ts" showLineNumbers
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initBrowserTelemetry } from './app/telemetry/browser-telemetry';

initBrowserTelemetry();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
```

### HttpClient uses the fetch backend

In Angular 22, `fetch` is the default `HttpClient` backend and `withFetch()` is
deprecated, so `provideHttpClient()` alone routes requests through it. Because
HttpClient calls go through `fetch()`, the OpenTelemetry fetch instrumentation
captures them and injects the `traceparent` header automatically. Register the custom
`ErrorHandler` (for uncaught errors) and the HTTP error interceptor (for failed
requests) here too - both emit ERROR logs, covered under
[Errors as logs](#errors-as-logs).

```typescript title="src/app/app.config.ts" showLineNumbers
import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { TelemetryErrorHandler } from './telemetry/error-handler';
import { errorLogInterceptor } from './telemetry/error-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: TelemetryErrorHandler },
    provideRouter(routes),
    // Fetch backend is the v22 default (OTel fetch instrumentation captures it +
    // attaches traceparent); interceptor emits a correlated log on failure.
    provideHttpClient(withInterceptors([errorLogInterceptor])),
  ],
};
```

### Router navigation spans

The web auto-instrumentations cover document load, fetch, XHR, and user
interactions, but **not** Angular's client-side Router. Subscribe to
`Router.events`, filter for `NavigationEnd`, and emit a span per navigation.

```typescript title="src/app/telemetry/router-tracing.ts" showLineNumbers
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { trace } from '@opentelemetry/api';

// The OTel web auto-instrumentations cover document-load, fetch/XHR, and user
// interactions, but not Angular's client-side Router. Subscribe to NavigationEnd
// so each SPA route change shows up as its own span.
export function initRouterTracing(router: Router): void {
  const tracer = trace.getTracer('angular-router');
  router.events
    .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
    .subscribe((e) => {
      const span = tracer.startSpan('router.navigation');
      span.setAttributes({
        'route.path': e.urlAfterRedirects,
        'nav.id': e.id,
        'page.url': window.location.href,
      });
      span.end();
    });
}
```

Wire it from the root component, where the `Router` is available via injection:

```typescript title="src/app/app.ts" showLineNumbers
import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { initRouterTracing } from './telemetry/router-tracing';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    initRouterTracing(inject(Router));
  }
}
```

### Context Propagation (zoneless vs zone.js)

The distributed trace - browser to API to database - links through the injected
`traceparent` header, which does **not** depend on the context manager. Only
in-browser parenting of an interaction's asynchronous work differs between the
two modes.

```mdx-code-block
<Tabs>
<TabItem value="zoneless" label="Zoneless (default)" default>
```

Angular 22 ships zoneless, so there is no zone.js to hook. Register the tracer
provider with no arguments to install the default `StackContextManager` and the
W3C trace context propagator. Metrics and logs have no `register()` equivalent,
so their providers are set global explicitly - miss that step and every metric
and log is silently dropped (see
[Why metrics/logs go missing](#no-metrics-or-logs-reach-the-collector)).

```typescript title="src/app/telemetry/browser-telemetry.ts" showLineNumbers
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  AggregationType,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { environment } from '../../environments/environment';
import { setupWebVitals } from './web-vitals';

let initialized = false;

// Per-vital histogram bucket boundaries - see "Core Web Vitals as metrics".
const VITAL_VIEWS: ViewOptions[] = [ /* ... */ ];

// Call once before Angular bootstraps so document-load + early interactions are
// captured.
export function initBrowserTelemetry(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }
  initialized = true;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: environment.otelServiceName,
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment.name': environment.deploymentEnvironment,
    environment: environment.deploymentEnvironment,
  });

  // --- Traces ---
  const tracerProvider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${environment.otelCollectorUrl}/v1/traces` }),
      ),
    ],
  });
  // Zoneless: installs the StackContextManager + W3C propagator and sets the
  // global TracerProvider.
  tracerProvider.register();

  // --- Metrics ---
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${environment.otelCollectorUrl}/v1/metrics` }),
        exportIntervalMillis: 10000,
      }),
    ],
    views: VITAL_VIEWS,
  });
  // No register() sugar for metrics/logs: without setGlobal*, getMeter/getLogger
  // return Noop and every data point is silently dropped.
  metrics.setGlobalMeterProvider(meterProvider);

  // --- Logs ---
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({ url: `${environment.otelCollectorUrl}/v1/logs` }),
      ),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  // Vitals and last-moment error logs emit as the page hides; flush all signals
  // then so nothing is lost with the tab.
  const flush = (): void => {
    void tracerProvider.forceFlush();
    void meterProvider.forceFlush();
    void loggerProvider.forceFlush();
  };
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
  window.addEventListener('pagehide', flush);

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-user-interaction': {
          eventNames: ['click', 'submit'],
        },
        '@opentelemetry/instrumentation-fetch': {
          propagateTraceHeaderCorsUrls: environment.apiTraceUrls,
        },
        '@opentelemetry/instrumentation-xml-http-request': {
          propagateTraceHeaderCorsUrls: environment.apiTraceUrls,
        },
      }),
    ],
  });

  setupWebVitals();
}
```

The dual-key resource attributes (`deployment.environment.name` plus a
lowercase `environment`) keep the SDK aligned with the current semantic
conventions while satisfying dashboards that filter on the short key. The same
`resource` is shared across all three providers so traces, metrics, and logs
carry identical service identity.

```mdx-code-block
</TabItem>
<TabItem value="zone" label="Zone-based (opt-in)">
```

If your app still uses zone.js (Angular 20 or earlier, or an explicit opt-in),
add the `ZoneContextManager` so an interaction span becomes the parent of the
async work it triggers. This is **not** part of the zoneless example - it is the
three-line delta for a zone-based app. Metrics and logs are unchanged.

```bash
npm install @opentelemetry/context-zone zone.js
```

```typescript title="src/app/telemetry/browser-telemetry.ts (zone-based delta)"
import 'zone.js';
import { ZoneContextManager } from '@opentelemetry/context-zone';

// ...build the tracer provider as above, then register with the zone manager:
tracerProvider.register({ contextManager: new ZoneContextManager() });
```

The difference shows up only across an asynchronous boundary. Work that runs
synchronously inside an interaction handler nests under it either way - in this
example the `fetch` fires synchronously on `subscribe`, so it parents correctly
under `items.load` and `click` even when zoneless (verified in the span tree
below). `ZoneContextManager` additionally propagates context across async gaps
(a later microtask, `setTimeout`, or an awaited call), so a `fetch` issued after
such a gap still nests under the interaction. Without it, that deferred `fetch`
starts a new root unless you wrap it in `startActiveSpan`. Either way the
distributed link to the API is unchanged - it rides the `traceparent` header.

```mdx-code-block
</TabItem>
</Tabs>
```

## Custom Instrumentation

### Manual spans around HttpClient

Wrap a request in a manual span when you want application-level timing
(`items.load`) around the auto-generated `fetch` span. `startActiveSpan` makes
the manual span the active parent, so the fetch nests under it even without
zone.js because the subscribe fires synchronously. The second button
(`items.load.missing`) fires a request that 404s, which drives the correlated
error log shown later.

```typescript title="src/app/items/items.ts" showLineNumbers
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { environment } from '../../environments/environment';

interface Item {
  id: number;
  name: string;
  price: string;
}

@Component({
  selector: 'app-items',
  imports: [],
  templateUrl: './items.html',
  styleUrl: './items.css',
})
export class Items {
  private http = inject(HttpClient);
  items = signal<Item[]>([]);

  loadItems(): void {
    const tracer = trace.getTracer('angular-items');
    // startActiveSpan makes items.load the active parent; the fetch fired
    // synchronously on subscribe nests under it even without zone.js.
    tracer.startActiveSpan('items.load', (span) => {
      this.http.get<Item[]>(`${environment.apiBaseUrl}/items`).subscribe({
        next: (data) => {
          this.items.set(data);
          span.end();
        },
        error: (err) => {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        },
      });
    });
  }

  // Demo: failing request inside an active span -> interceptor emits a correlated log.
  triggerApiError(): void {
    const tracer = trace.getTracer('angular-items');
    tracer.startActiveSpan('items.load.missing', (span) => {
      this.http.get<Item[]>(`${environment.apiBaseUrl}/missing`).subscribe({
        next: () => span.end(),
        error: (err) => {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
        },
      });
    });
  }

  // Demo: uncaught throw -> ErrorHandler emits a best-effort (uncorrelated) log.
  triggerError(): void {
    throw new Error('Demo: uncaught error from Items page');
  }
}
```

### Core Web Vitals as metrics

Record Core Web Vitals as **metric histograms**, one instrument per vital.
The `web-vitals` library reports CLS, INP, LCP, FCP, and TTFB through callbacks;
each callback records a measurement tagged with the page path and the library's
rating (`good` / `needs-improvement` / `poor`).

```typescript title="src/app/telemetry/web-vitals.ts" showLineNumbers
import { metrics, type Histogram } from '@opentelemetry/api';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

// Web Vitals as histograms (not spans) so RUM can report p75/p95; one instrument
// per vital for per-vital bucket Views (see browser-telemetry.ts).
export function setupWebVitals(): void {
  // Acquire after the global MeterProvider is set (else Noop meter, dropped).
  const meter = metrics.getMeter('web-vitals', '1.0.0');

  const cls = meter.createHistogram('web_vitals.cls', {
    unit: '1',
    description: 'Cumulative Layout Shift',
  });
  const lcp = meter.createHistogram('web_vitals.lcp', {
    unit: 'ms',
    description: 'Largest Contentful Paint',
  });
  const inp = meter.createHistogram('web_vitals.inp', {
    unit: 'ms',
    description: 'Interaction to Next Paint',
  });
  const fcp = meter.createHistogram('web_vitals.fcp', {
    unit: 'ms',
    description: 'First Contentful Paint',
  });
  const ttfb = meter.createHistogram('web_vitals.ttfb', {
    unit: 'ms',
    description: 'Time to First Byte',
  });

  const record =
    (histogram: Histogram) =>
    (metric: Metric): void => {
      histogram.record(metric.value, {
        'web_vital.rating': metric.rating,
        'page.path': window.location.pathname,
      });
    };

  onCLS(record(cls));
  onLCP(record(lcp));
  onINP(record(inp));
  onFCP(record(fcp));
  onTTFB(record(ttfb));
}
```

Default histogram buckets (0, 5, 10, 25, ...) fit neither a CLS score (roughly
0 to 1) nor millisecond timings, so give each instrument its own bucket
boundaries with a `View`. These are the `VITAL_VIEWS` elided from the bootstrap
above:

```typescript title="src/app/telemetry/browser-telemetry.ts (VITAL_VIEWS)"
const VITAL_VIEWS: ViewOptions[] = [
  {
    instrumentName: 'web_vitals.cls',
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [0.05, 0.1, 0.15, 0.25, 0.5, 1] },
    },
  },
  {
    instrumentName: 'web_vitals.lcp',
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000] },
    },
  },
  {
    instrumentName: 'web_vitals.inp',
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [50, 100, 150, 200, 300, 500, 750, 1000] },
    },
  },
  {
    instrumentName: 'web_vitals.fcp',
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [500, 1000, 1500, 1800, 2500, 3000, 4000, 6000] },
    },
  },
  {
    instrumentName: 'web_vitals.ttfb',
    aggregation: {
      type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
      options: { boundaries: [100, 200, 400, 600, 800, 1200, 1800, 3000] },
    },
  },
];
```

#### Web Vitals: spans vs metrics

An earlier version of this example recorded each vital as a short-lived span
(`web_vital.lcp`, and so on). That works and puts page performance in the trace
stream, but it is the wrong shape for real user monitoring:

- **Core Web Vitals are distributions, not events.** Google scores a site at
  the **p75** of each vital across real sessions. A metric `Histogram`
  aggregates measurements into buckets in the SDK, so the backend computes p75
  and p95 directly; a pile of individual spans has to be aggregated downstream
  before it means anything.
- **Spans are per-event and unbounded.** One span per vital per page view is a
  lot of zero-duration spans that clutter traces and cost storage, without
  giving you the percentile view you actually want.
- **Bucketing is explicit and cheap.** Per-vital `View` boundaries (a CLS score
  needs different buckets than an LCP in milliseconds) keep the histogram
  meaningful and small.

Use a **span** (or a span event) when you want a single vital tied to one
specific trace for debugging a single session. Use a **metric histogram** - as
this example does - for fleet-wide RUM percentiles. The two are not exclusive,
but percentiles are the common need, so metrics are the default here.

### Errors as logs

Browser errors are emitted as **ERROR logs**, on two paths. Failed HTTP
requests go through an `HttpClient` interceptor that captures the active trace
context and re-enters it when it emits, so the log carries the trace id of the
request that failed. Everything else - uncaught throws, and the global `error`
and `unhandledrejection` events - lands in a custom `ErrorHandler`, which emits
a best-effort log (usually without a trace id in a zoneless app, because the
originating span has already unwound).

```typescript title="src/app/telemetry/error-interceptor.ts" showLineNumbers
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { catchError, throwError } from 'rxjs';

// Trace-correlated ERROR log for every failed HttpClient request. catchError runs
// async, after the zoneless context has unwound, so we capture the context here
// (synchronous, caller's span still active) and re-enter it at emit - emit()
// stamps the trace id from the active context, so this is what keeps the log
// correlated.
export const errorLogInterceptor: HttpInterceptorFn = (req, next) => {
  const activeContext = context.active();
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const logger = logs.getLogger('browser-http');
      context.with(activeContext, () => {
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: 'ERROR',
          body: `HTTP ${req.method} ${req.urlWithParams} failed: ${err.status} ${err.message}`,
          attributes: {
            'http.request.method': req.method,
            'url.full': req.urlWithParams,
            'http.response.status_code': err.status,
            'error.type': err.name,
          },
        });
      });
      return throwError(() => err);
    }),
  );
};
```

```typescript title="src/app/telemetry/error-handler.ts" showLineNumbers
import { ErrorHandler, Injectable } from '@angular/core';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

// Single capture point for uncaught errors in a zoneless app (Angular errors +
// the window error/unhandledrejection events via provideBrowserGlobalErrorListeners).
// Correlation is best-effort: the span has usually unwound by the time an error
// lands here, so logs may have no trace id. For correlated HTTP-failure logs see
// error-interceptor.
@Injectable()
export class TelemetryErrorHandler implements ErrorHandler {
  private logger = logs.getLogger('browser-errors');

  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: err.message,
      attributes: {
        'exception.type': err.name,
        'exception.message': err.message,
        'exception.stacktrace': err.stack ?? '',
        'page.path': window.location.pathname,
      },
    });
    console.error(error);
  }
}
```

### Reading the active trace id

To surface the current trace id (for a support widget or a "copy trace id"
button), read it from the active span context:

```typescript
import { trace } from '@opentelemetry/api';

const span = trace.getActiveSpan();
const traceId = span?.spanContext().traceId;
```

## Backend Signals

The Express API is auto-instrumented with the OpenTelemetry Node SDK, which
adds the API leg of every trace plus its own metrics and logs. Two details make
the browser and API tell one story:

- **Metrics**: enabling a `PeriodicExportingMetricReader` turns on
  `http.server.request.duration` and runtime metrics automatically. Set
  `OTEL_SEMCONV_STABILITY_OPT_IN=http` so the metric uses the stable name
  (`http.server.request.duration`) rather than the deprecated
  `http.server.duration`.
- **Logs**: `pino` records are auto-bridged to OTLP by the Node
  auto-instrumentations, with `trace_id` and `span_id` injected, so a backend
  log line links to the exact request span.

```typescript title="backend/src/instrumentation.ts" showLineNumbers
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const env = process.env.DEPLOY_ENV || 'development';
const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

// http.server.request.duration + runtime-node metrics and pino log-bridging are
// automatic once a reader/processor exists. Stable metric name needs
// OTEL_SEMCONV_STABILITY_OPT_IN=http (compose.yaml).
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'angular-items-api',
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment.name': env,
    environment: env,
  }),
  traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: 10000,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${base}/v1/logs` })),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-runtime-node': { enabled: true },
    }),
  ],
});

sdk.start();
```

Preload the SDK with `node -r ./dist/instrumentation.js ./dist/server.js` so it
patches Express, `pg`, and `pino` before they are imported. The API must also
allow the `traceparent` and `tracestate` request headers so the browser's trace
context survives the cross-origin call:

```typescript title="backend/src/server.ts" showLineNumbers
import express from 'express';
import cors from 'cors';
import pino from 'pino';
import { pool } from './db';

const app = express();

// Auto-bridged + trace-correlated by instrumentation-pino (via the -r preload).
const log = pino();

// allowedHeaders must include traceparent/tracestate so the browser fetch can
// propagate trace context and stay in one trace with the server span.
app.use(
  cors({
    origin: ['http://localhost:4200', 'http://localhost:8080'],
    allowedHeaders: ['Content-Type', 'traceparent', 'tracestate'],
  }),
);

app.get('/api/items', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, price FROM items ORDER BY id');
  log.info({ count: rows.length }, 'served items');
  res.json(rows);
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => log.info(`angular-items-api listening on :${port}`));
```

## Running Your Application

### Development

Run the collector and API (see the example's `compose.yaml`), then start the
Angular dev server:

```bash
ng serve
```

Open `http://localhost:4200`, interact with the page, and watch signals arrive
at the collector. The dev origin (`http://localhost:4200`) must be in the
collector's CORS allow-list and the API's CORS policy.

### Full stack with Docker Compose

```bash
docker compose up --build
```

Open `http://localhost:8080/items`, click **Load items**, navigate between
routes, and click **Trigger API error** and **Trigger error**.

### Expected span tree

A single "Load items" click produces one trace across three services:

```text
click (angular-browser)                          (user-interaction instrumentation)
└─ items.load                                    (manual span in loadItems())
   └─ HTTP GET http://localhost:3000/api/items   (browser fetch instrumentation)
      └─ GET /api/items                           (angular-items-api, Express)
         └─ pg.query:SELECT items                 (Postgres)
```

### Verifying in the collector

With the collector's `debug` exporter on, the browser fetch span and the
backend spans share one trace id:

```text
Span #0
    Trace ID       : 5d6d4c8814af19ee...
    Name           : HTTP GET
     -> http.url: Str(http://localhost:3000/api/items)
     -> service.name: Str(angular-browser)
Span #1
    Trace ID       : 5d6d4c8814af19ee...
    Name           : GET /api/items
     -> service.name: Str(angular-items-api)
Span #2
    Trace ID       : 5d6d4c8814af19ee...
    Name           : pg.query:SELECT items
```

Alongside the traces you should see:

- **Metrics**: `web_vitals.{cls,fcp,lcp,ttfb}` histograms from the browser
  (INP needs a real measured interaction, so it may not appear under a scripted
  drive), plus `http.server.request.duration` and `runtime.node.*` from the
  backend.
- **Logs**: the backend `served items` `pino` record carrying `trace_id` /
  `span_id`; a browser interceptor ERROR log with a non-zero trace id after
  **Trigger API error**; and an `ErrorHandler` ERROR log (best-effort, no trace
  id) after **Trigger error**.
- One `router.navigation` span per client-side route change.

## Troubleshooting

### The browser span and the API span are in different traces

The `traceparent` header is not making it to the API. This needs two fixes,
because CORS is involved in both directions:

1. **SDK side**: add the API origin to `propagateTraceHeaderCorsUrls` on the
   fetch and XHR instrumentations. Without it, OpenTelemetry will not inject
   `traceparent` on cross-origin requests.
2. **API side**: allow the `traceparent` and `tracestate` request headers in
   the API's CORS policy. If the API does not echo them back as allowed
   headers, the browser strips them before the request leaves.

```typescript title="backend CORS (Express example)"
app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:8080'],
  allowedHeaders: ['Content-Type', 'traceparent', 'tracestate'],
}));
```

### Backend-only OPTIONS traces with no browser parent

Because the SPA (`:8080`) and API (`:3000`) are cross-origin, every API call
fires a CORS **preflight `OPTIONS`** first, and browsers do not allow custom
headers such as `traceparent` on a preflight. Each preflight therefore starts
its own backend-only trace with no browser parent. This is expected: the actual
`GET`/`POST` request carries the `traceparent` and links the browser to the API.
If a trace looks "browser-less", check that you are looking at the real request,
not its `OPTIONS` preflight (or a browser-only trace such as `documentLoad`).

### No metrics or logs reach the collector

Traces call `provider.register()`, which sets the global tracer, but metrics and
logs have no such sugar. If you skip `metrics.setGlobalMeterProvider()` or
`logs.setGlobalLoggerProvider()`, then `getMeter()` / `getLogger()` return a
No-op implementation and every measurement or log is silently dropped - no
error, just nothing. Set both globals during bootstrap, and acquire meters and
loggers **after** that (as `setupWebVitals()` does).

### A deferred interaction span does not parent its async fetch (zoneless)

A synchronous fetch nests fine without zone.js (see the span tree above). But if
the request is issued after an async gap - a `setTimeout`, a later microtask, or
an `await` before the call - the active-context link is lost in zoneless mode and
the fetch starts a new root. If you need that deferred work parented, either wrap
it in a manual `startActiveSpan` (as the `items.load` example does) or opt into
`ZoneContextManager`. The distributed link to the API is unaffected either way.

### No spans at all, or the document-load span is missing

`initBrowserTelemetry()` is not running early enough, or not at all. Confirm it
is called in `main.ts` **before** `bootstrapApplication`. If only the
document-load span is missing, the SDK is starting after the page has already
loaded - move the call ahead of bootstrap.

### Signals are created but never reach the collector

Check the collector's OTLP HTTP receiver CORS. A browser preflight (`OPTIONS`)
that the collector rejects shows up as a CORS error in the browser console and
nothing in the collector. Add the SPA origin to `allowed_origins`, confirm
`otelCollectorUrl` points at the collector's `:4318` endpoint (the exporters
append `/v1/traces`, `/v1/metrics`, `/v1/logs`), and confirm the collector has a
pipeline for each signal.

## Security Considerations

- **No PII in span attributes, metric labels, or log bodies**: browser
  telemetry is visible to anyone with collector access. Do not put emails,
  tokens, or session ids into attributes, and avoid query strings that carry
  secrets in `http.url` or `url.full`.
- **Scope CORS origins**: list exact SPA origins in the collector receiver and
  the API. Never use `*` for `allowed_origins` in production - it lets any site
  post telemetry to your collector.
- **Scope trace propagation**: keep `propagateTraceHeaderCorsUrls` limited to
  your own API origins so the `traceparent` header is never sent to third-party
  domains.
- **Header filtering**: if you add request/response headers to spans, allow-list
  the safe ones rather than capturing everything (avoid `authorization`,
  `cookie`, `set-cookie`).
- **Transport security**: serve the collector endpoint over HTTPS in production
  so telemetry is encrypted in transit.

## Performance Considerations

- **Runtime overhead**: span creation and histogram recording are cheap (object
  allocation plus a timestamp). Every signal exports off the interaction path -
  spans and logs through batch processors, metrics through a periodic reader
  (10 s here) - so user-facing latency is unaffected.
- **Batch tuning**: raise the span processor's `maxQueueSize` and
  `maxExportBatchSize` for chatty UIs so interaction-span bursts are not dropped;
  lower a flush interval if you want data to appear sooner while debugging.
- **What not to span**: avoid creating a span per animation frame, scroll event,
  or mousemove. Restrict `instrumentation-user-interaction` to meaningful events
  (`click`, `submit`) as the example does.
- **Web Vitals cost**: the `web-vitals` callbacks fire a handful of times per
  page, and each records a single histogram measurement - negligible.

## FAQ

### Does OpenTelemetry work with zoneless Angular?

Yes. Angular 21 and later are zoneless by default. Register the
`WebTracerProvider` with the default `StackContextManager` by calling
`provider.register()` with no arguments. The browser-to-API trace links through
the `traceparent` header, which is independent of the context manager, so
distributed tracing works the same with or without zone.js.

### Do I need zone.js for OpenTelemetry in Angular?

No. zone.js is optional in modern Angular. You only need the
`ZoneContextManager` (and zone.js) if you want an interaction's asynchronous
work nested under the interaction span inside the browser. Distributed tracing
to your API and database works without zone.js.

### Why is my Angular browser span in a different trace than my API span?

The `traceparent` header is not reaching your API. Either the request URL is not
in `propagateTraceHeaderCorsUrls` (so the header is not injected), or the API's
CORS policy does not allow the `traceparent` and `tracestate` headers (so the
browser strips them). Fix both. If instead you are looking at a lone backend
`OPTIONS` trace, that is the CORS preflight - preflights cannot carry
`traceparent`, so the real request is the one that links.

### Should I record Core Web Vitals as spans or metrics in Angular?

Record them as metric histograms. Core Web Vitals are fleet-wide distributions
(Google scores at p75), and a `Histogram` aggregates into buckets so the backend
computes p75 and p95 without storing every event. A short-lived span per vital
is fine for debugging a single session but does not aggregate into percentiles,
so metrics are the better fit for real user monitoring.

### How do I trace Angular route changes?

The web auto-instrumentations do not cover Angular's Router. Subscribe to
`Router.events`, filter for `NavigationEnd`, and emit a span per navigation with
the resolved route path as an attribute.

### How do I capture uncaught Angular errors with OpenTelemetry?

Emit them as ERROR logs. Provide a custom `ErrorHandler` that calls
`logger.emit` with `SeverityNumber.ERROR`; `provideBrowserGlobalErrorListeners()`
forwards the window `error` and `unhandledrejection` events into it, so a plain
`window.onerror` listener misses framework-intercepted errors. For failed HTTP
requests, an `HttpClient` interceptor emits a log that carries the active trace
id.

### Why are my Angular browser metrics or logs missing?

Traces call `provider.register()`, which sets the global tracer, but metrics and
logs have no such sugar. Call `metrics.setGlobalMeterProvider()` and
`logs.setGlobalLoggerProvider()` during bootstrap. Without the global set,
`getMeter()` and `getLogger()` return a No-op implementation and every data
point is silently dropped.

### Where do I initialize the browser SDK in Angular?

In `main.ts`, before `bootstrapApplication`, so the document-load span and early
interactions are captured. Wire router tracing from the root component
constructor, because the Router is only available through dependency injection.

### Does Angular HttpClient go through the OpenTelemetry fetch instrumentation?

Yes. In Angular 22, `fetch` is the default `HttpClient` backend and
`withFetch()` is deprecated, so HttpClient requests run through `fetch()` and are
captured by `instrumentation-fetch`, which also injects `traceparent`.

### How do I send Angular browser telemetry to a collector on another origin?

The browser posts OTLP over HTTP directly from the SPA origin, so the
collector's OTLP HTTP receiver must allow that origin via CORS. Add every origin
the SPA is served from to the receiver's `allowed_origins` list.

### Can I use Core Web Vitals with OpenTelemetry in Angular?

Yes. The `web-vitals` library reports CLS, INP, LCP, FCP, and TTFB through
callbacks. Record each as a `Histogram` measurement when its callback fires,
tagged with the page path and rating, so page performance aggregates into p75
and p95 alongside your request traces.

## What's Next?

- Add custom metrics (interaction counters, feature-usage rates) alongside the
  Web Vitals histograms.
- Instrument additional interactions (`submit`, custom events) and forms.
- Enrich browser error logs with release/version attributes for triage.
- Roll the same three-signal pattern out to other front-end apps for consistent
  RUM.

## Complete Example

The full project - Angular 22 SPA, Express + Postgres API, and a pre-configured
collector - is available at
[base-14/examples/nodejs/angular-fullstack-otel](https://github.com/base-14/examples/tree/main/nodejs/angular-fullstack-otel).

```text
angular-fullstack-otel/
├── compose.yaml
├── config/otel-config.yaml          # collector: OTLP-in (CORS), traces+metrics+logs
├── backend/                         # Express 5 + Postgres, Node OTel SDK
│   ├── src/instrumentation.ts       # NodeSDK: traces + metrics + logs
│   ├── src/server.ts                # API + pino logging
│   └── schema.sql
└── frontend/                        # Angular 22 SPA
    ├── src/app/telemetry/
    │   ├── browser-telemetry.ts     # bootstrap: tracer + meter + logger providers
    │   ├── router-tracing.ts        # NavigationEnd -> span
    │   ├── error-handler.ts         # ErrorHandler -> best-effort ERROR log
    │   ├── error-interceptor.ts     # HttpClient failure -> correlated ERROR log
    │   └── web-vitals.ts            # Core Web Vitals -> metric histograms
    ├── Dockerfile
    └── nginx.conf
```

Run it:

```bash
git clone https://github.com/base-14/examples
cd examples/nodejs/angular-fullstack-otel
docker compose up --build
# open http://localhost:8080/items
```

base14 Scout turns these browser-to-database traces, Web Vitals, and correlated
logs into
[end-to-end application performance monitoring](https://base14.io/scout/apm)
without locking you into a single vendor's agent.

## References

- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [OpenTelemetry browser instrumentation](https://opentelemetry.io/docs/languages/js/getting-started/browser/)
- [auto-instrumentations-web](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-web)
- [web-vitals](https://github.com/GoogleChrome/web-vitals)
- [Angular zoneless guide](https://angular.dev/guide/zoneless)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

## Related Guides

- [React browser instrumentation](./react.md) - full browser RUM powered by the
  Scout React SDK.
- [Next.js instrumentation](./nextjs.md) - server and client tracing for a
  full-stack React framework.
- [Next.js full-stack instrumentation](./nextjs-fullstack.md) - browser and
  server in one trace across all three signals, with browser OTLP routed
  through a same-origin API route instead of collector CORS.
- [Express instrumentation](./express.md) - the API tier that receives the
  propagated trace context.
- [Node.js instrumentation](./nodejs.md) - the Node SDK behind the backend in
  this guide.
