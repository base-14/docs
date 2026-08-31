---
title: Next.js Full-Stack OpenTelemetry - Browser and Server
sidebar_label: Next.js (Full-Stack)
sidebar_position: 12.5
description:
  Instrument Next.js App Router end to end with OpenTelemetry - server traces,
  browser RUM, and logs in one trace, with no collector CORS to configure.
keywords:
  [
    nextjs full stack opentelemetry,
    nextjs browser instrumentation,
    nextjs app router tracing,
    nextjs opentelemetry instrumentation,
    nextjs rum opentelemetry,
    nextjs real user monitoring,
    nextjs server components tracing,
    nextjs instrumentation.ts hook,
    nextjs otlp proxy route,
    nextjs collector cors,
    nextjs web vitals opentelemetry,
    nextjs error boundary tracing,
    nextjs ssr error logs,
    react error boundary opentelemetry,
    nextjs distributed tracing,
    nextjs observability,
    nextjs standalone docker opentelemetry,
    nextjs edge runtime opentelemetry,
    nextjs traceparent propagation,
    nextjs three signals observability,
  ]
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# Next.js (Full-Stack)

:::note Running this in production

Storing and querying this data at production volume is what base14 Scout does.
[Check out Scout APM](https://base14.io/scout/apm).

:::

:::info Server side only?

This guide covers browser and server together, exporting to a collector. If you
only need the server side, or you have nowhere to run a collector, start with
[Next.js](./nextjs-scout.md) — direct OTLP to Scout with OIDC client
credentials — and add the browser tier from here on top.

:::

## Introduction

Instrument a Next.js App Router application with OpenTelemetry on both sides of
the network boundary: the Node.js server that renders pages and serves API
routes, and the browser that hydrates and runs them. This guide wires the Node
SDK into the `instrumentation.ts` register hook, mounts the web SDK from a
client component in the root layout, and links the two through the W3C
`traceparent` header so a click in the browser and the API route it calls land
in one trace.

It covers all three signals. **Traces** cover document load, user interactions,
browser `fetch`/XHR, server-side rendering, and API route execution.
**Metrics** cover HTTP and Node.js runtime instruments exported on a periodic
reader. **Logs** cover application records emitted through the OTel logger plus
a console bridge that captures the SSR error output Next.js prints to stdout
instead of surfacing through a span. Three kinds of browser error are handled
separately: uncaught exceptions, unhandled promise rejections, and React error
boundary crashes, which a `window.onerror` listener does not see.

Browser telemetry reaches the collector through a catch-all API route at
`/api/otel` rather than being exported directly. The browser posts same-origin,
so there is no preflight and no `cors` block on the OTLP HTTP receiver, and the
collector does not have to be reachable from a user's network. The alternative
is direct export with a CORS allow-list on the collector; the
[Angular guide](./angular.md) covers the same three signals that way.

:::tip TL;DR

Server side, create `instrumentation.ts` at the project root and dynamically
import your `NodeSDK` setup only when `process.env.NEXT_RUNTIME === 'nodejs'`,
so the SDK never loads in the Edge runtime. Browser side, call the web SDK
bootstrap from a `'use client'` component mounted in the root layout, and point
its OTLP exporter at a catch-all `/api/otel/[...signal]` route that forwards to
the collector - this makes browser telemetry same-origin and removes collector
CORS entirely. Set `propagateTraceHeaderCorsUrls` so `traceparent` links browser
spans to API route spans, and wrap `console.*` after `sdk.start()` so Next.js
internal SSR errors reach your logs pipeline.

:::

## Who This Guide Is For

This documentation is designed for:

- **Next.js developers**: adding tracing, metrics, and logs to an App Router
  app without bolting on a proprietary RUM agent.
- **Full-stack engineers**: connecting a browser interaction to the server
  render and API route behind it through a single trace id.
- **Front-end platform teams**: standardizing browser observability across
  several Next.js apps, including error boundaries and Core Web Vitals.
- **SRE and DevOps**: shipping an instrumented Next.js container that exports to
  a collector without exposing that collector to the public internet.
- **Teams migrating off commercial APM**: replacing a vendor agent with
  vendor-neutral OTLP while keeping browser-to-server correlation.

## Overview

### Prerequisites

Before starting, ensure you have:

- **Node.js 22 or later** - the example builds and runs on `node:22-alpine`.
- **Next.js 15 or later** using the App Router. The `instrumentation.ts`
  register hook has been stable since 15; the example runs **Next.js 16.3**.
- **A Scout Collector** reachable from the Next.js server over OTLP/HTTP, with
  traces, metrics, and logs pipelines. See
  [Docker Compose collector setup](../../collector-setup/docker-compose-example.md).
- **Docker and Docker Compose** to run the full stack locally.

### Compatibility Matrix

| Component | Version | Notes |
| --- | --- | --- |
| Next.js | 16.3.0 | App Router; register hook stable since 15 |
| React | 19.2.8 | Error boundaries via `error.tsx` / `global-error.tsx` |
| Node.js | 22 | Server runtime; Edge runtime is excluded by design |
| TypeScript | 6.0.3 | |
| `@opentelemetry/api` | 1.9.1 | |
| `@opentelemetry/sdk-node` | 0.221.0 | Server SDK, loaded from the register hook |
| `@opentelemetry/auto-instrumentations-node` | 0.79.0 | HTTP, fetch, and runtime |
| `@opentelemetry/sdk-trace-web` | 2.10.0 | Browser tracer provider |
| `@opentelemetry/auto-instrumentations-web` | 0.66.0 | Document load, fetch, XHR, interactions |
| `@opentelemetry/semantic-conventions` | 1.43.0 | `ATTR_*` constants |
| `web-vitals` | 5.3.0 | CLS, LCP, TTFB, INP |

### Instrumented Components

| Surface | What is captured | Automatic |
| --- | --- | --- |
| Incoming HTTP requests | Method, route, status, duration | Yes |
| Server-side rendering | Render spans per route | Yes |
| API route execution | One span per handler invocation | Yes |
| Server-side `fetch` | Outbound calls made during SSR | Yes |
| Node.js runtime metrics | Event loop, memory, GC | Yes |
| Document load | Navigation and resource timing | Yes |
| Browser `fetch` / XHR | One span per client request, with `traceparent` | Yes |
| User interactions | `click` and `submit` spans | Yes |
| Application logs | INFO / WARN / ERROR records with attributes | No |
| Next.js SSR error output | stdout error text as ERROR log records | No |
| Browser JS errors | Uncaught exceptions and rejections as spans | No |
| React error boundaries | `error.tsx` and `global-error.tsx` catches | No |
| Core Web Vitals | CLS, LCP, TTFB, INP as spans | No |

The rows marked **No** are wired explicitly in the example, and each has its own
section below. The full runnable project is at
[base-14/examples/nodejs/nextjs-fullstack-otel](https://github.com/base-14/examples/tree/main/nodejs/nextjs-fullstack-otel).

:::note

This example has no database. The `/api/products` route serves an in-memory
array behind a small artificial delay. For database span capture in a Next.js
app, see the [Next.js server-side guide](./nextjs.md), whose example uses
MongoDB.

:::

## Installation

The server and browser SDKs are separate dependency sets, but they install
together because both bundles are built from one `package.json`.

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash
npm install \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/auto-instrumentations-web \
  @opentelemetry/instrumentation \
  @opentelemetry/context-zone \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
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
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/auto-instrumentations-web \
  @opentelemetry/instrumentation \
  @opentelemetry/context-zone \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
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
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/sdk-trace-web \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/auto-instrumentations-web \
  @opentelemetry/instrumentation \
  @opentelemetry/context-zone \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  web-vitals
```

```mdx-code-block
</TabItem>
</Tabs>
```

The web packages ship to the client bundle and the node packages do not,
because the browser module is imported only from a `'use client'` component,
and the server module only from the register hook.

## Configuration

Server and browser configuration are separate. Server variables stay private to
the container; browser variables need the `NEXT_PUBLIC_` prefix, which is how
Next.js decides what may be inlined into the client bundle at build time.

```mdx-code-block
<Tabs>
<TabItem value="env" label="Environment Variables (Recommended)" default>
```

```bash title=".env.example"
# Server-side OTel config
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=sample-nextjs-app

# Browser-side OTel config (NEXT_PUBLIC_ prefix exposes to browser)
# Default: browser sends to /api/otel proxy (no CORS needed)
# To send directly to collector, set: NEXT_PUBLIC_OTEL_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_SERVICE_NAME=sample-nextjs-app-browser
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

Leave `NEXT_PUBLIC_OTEL_ENDPOINT` unset. When it is absent the browser falls
back to the same-origin `/api/otel` proxy, which needs no CORS. Set it only to
export straight to a collector, and configure that collector's CORS allow-list
to match.

```mdx-code-block
</TabItem>
<TabItem value="register" label="Register Hook">
```

Next.js calls the exported `register` function once per server runtime, before
the first request is handled. It is the only hook that runs early enough for
the Node SDK to instrument the first render.

```typescript title="instrumentation.ts" showLineNumbers
export async function register() {
  // Only load server-side OTel in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./src/lib/server-telemetry');
  }
}
```

The import is dynamic, so the Node SDK is not resolved at module-evaluation
time and never enters the Edge bundle. The `NEXT_RUNTIME` guard keeps the Edge
runtime from throwing on Node.js built-ins the SDK depends on.

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose">
```

```yaml title="docker-compose.yml" showLineNumbers
services:
  # --- Next.js App ---
  nextjs-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_SERVICE_NAME=sample-nextjs-app
      # Browser telemetry proxied through /api/otel (no CORS needed)
      # To bypass proxy: NEXT_PUBLIC_OTEL_ENDPOINT=http://localhost:4318
      - NEXT_PUBLIC_OTEL_SERVICE_NAME=sample-nextjs-app-browser
      - NEXT_PUBLIC_BASE_URL=http://localhost:3000
    depends_on:
      otel-collector:
        condition: service_started

  # --- OpenTelemetry Collector ---
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./config/otel-collector.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC (server-side)
      - "4318:4318"   # OTLP HTTP (browser-side + server-side)
```

The collector's OTLP endpoint is an internal Compose hostname. The browser
never resolves `otel-collector`; it posts to the Next.js app, which forwards
from inside the network.

```mdx-code-block
</TabItem>
</Tabs>
```

### Server SDK Setup

The server module configures all three signals against one OTLP HTTP endpoint
and starts the SDK at import time.

```typescript title="src/lib/server-telemetry.ts" showLineNumbers
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'sample-nextjs-app',
  [ATTR_SERVICE_VERSION]: '1.0.0',
  'deployment.environment': process.env.NODE_ENV || 'development',
  'environment': process.env.NODE_ENV || 'development',
});

const sdk = new NodeSDK({
  resource,

  // Traces - batch and export via OTLP HTTP
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`,
    })
  ),

  // Metrics - periodic export every 10s
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTEL_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 10_000,
  }),

  // Logs - batch and export via OTLP HTTP
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${OTEL_ENDPOINT}/v1/logs`,
      }),
    }),
  ],

  // Auto-instrument HTTP, fetch, etc. Disable noisy ones.
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          // Skip static assets and health checks
          return url.startsWith('/_next') || url === '/favicon.ico';
        },
      },
      // Disable noisy low-level instrumentations
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    }),
  ],
});

sdk.start();
```

The resource sets `environment` alongside `deployment.environment`. The
lowercase key is what Scout filters on, and carrying both keeps the resource
valid under semantic conventions while staying queryable in the UI.

The `ignoreIncomingRequestHook` filter drops `/_next` asset requests. A single
page load pulls dozens of chunks from that path, and without the filter they
dominate the trace view and the HTTP metric cardinality. Filesystem, DNS, and
socket instrumentations are disabled for the same reason: Next.js reads from
disk continuously during SSR.

### Browser SDK Setup

The browser module registers a `WebTracerProvider` and guards against double
initialization, because React strict mode mounts effects twice in development.

```typescript title="src/lib/browser-telemetry.ts" showLineNumbers
'use client';

import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { onCLS, onLCP, onTTFB, onINP } from 'web-vitals';

let initialized = false;

export function initBrowserTelemetry() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Use the Next.js API proxy by default - no CORS config needed on collector.
  // Set NEXT_PUBLIC_OTEL_ENDPOINT to send directly to collector instead (requires CORS).
  const OTEL_ENDPOINT = process.env.NEXT_PUBLIC_OTEL_ENDPOINT || '/api/otel';

  // --- 1. Trace Provider ---
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.NEXT_PUBLIC_OTEL_SERVICE_NAME || 'sample-nextjs-app-browser',
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
    'environment': process.env.NODE_ENV || 'development',
    'telemetry.sdk.language': 'webjs',
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  // --- 2. Auto-Instrumentations (fetch, XHR, document load, user interaction) ---
  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-document-load': {},
        '@opentelemetry/instrumentation-user-interaction': {
          eventNames: ['click', 'submit'],
        },
        '@opentelemetry/instrumentation-fetch': {
          propagateTraceHeaderCorsUrls: [/.*/],
        },
        '@opentelemetry/instrumentation-xml-http-request': {
          propagateTraceHeaderCorsUrls: [/.*/],
        },
      }),
    ],
  });
```

The `ZoneContextManager` keeps asynchronous work parented under the interaction
that started it, so a click span becomes the parent of the `fetch` it triggers
rather than a sibling. The `propagateTraceHeaderCorsUrls: [/.*/]` value is
correct for a local example but too broad for production - narrow it to your own
API origins so `traceparent` is never attached to third-party requests. See
[Security Considerations](#security-considerations).

Mount it from a client component in the root layout so it starts on hydration:

```tsx title="src/components/TelemetryProvider.tsx" showLineNumbers
'use client';

import { useEffect } from 'react';
import { initBrowserTelemetry } from '@/lib/browser-telemetry';

export default function TelemetryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initBrowserTelemetry();
  }, []);

  return <>{children}</>;
}
```

```tsx title="src/app/layout.tsx (excerpt)" showLineNumbers
import TelemetryProvider from '@/components/TelemetryProvider';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TelemetryProvider>
          <main>{children}</main>
        </TelemetryProvider>
      </body>
    </html>
  );
}
```

`TelemetryProvider` renders its children unchanged, so it does not alter the
component tree. Place it as high in the layout as possible: anything rendered
above it produces interactions the SDK has not yet started to observe.

## Production Configuration

### Collector configuration

The collector receives from two sources: the Next.js server exporting directly,
and browser telemetry arriving through the proxy route. Both use the same OTLP
HTTP receiver.

```yaml title="config/otel-collector.yaml" showLineNumbers
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
        # CORS not needed - browser telemetry is proxied through /api/otel
        # If sending directly from browser, uncomment:
        # cors:
        #   allowed_origins:
        #     - "http://localhost:3000"
        #   allowed_headers:
        #     - "*"

processors:
  batch:
    timeout: 5s
    send_batch_size: 512
```

For a production Scout deployment, replace the local debug exporter with the
authenticated Scout exporter and add a memory limiter:

```yaml title="config/otel-collector.yaml (Scout export)" showLineNumbers
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
  health_check:
    endpoint: 0.0.0.0:13133

processors:
  memory_limiter:
    limit_mib: 256
    check_interval: 1s
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
```

Set `compression: gzip`. Browser spans carry long attribute values such as
stack traces and full page URLs, and with the proxy route all of it passes
through the collector's egress.

### Export cadence and batching

Spans and log records buffer in batch processors and flush on a timer; metrics
export every `exportIntervalMillis`, set to 10 seconds in the example. For an
app with heavy client interaction, raise the browser span processor's
`maxQueueSize` and `maxExportBatchSize` so interaction bursts are not dropped
between flushes. In the browser, a user can close the tab mid-batch. Flush all
providers on `visibilitychange` and `pagehide` so buffered spans are exported
before the page unloads.

### Dockerfile

A standalone build needs one extra copy step for instrumentation to reach the
runtime image.

```dockerfile title="Dockerfile" showLineNumbers
FROM node:22-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Run the app
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy the full server build output (includes instrumentation chunks)
COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

The last `COPY` is required. `output: "standalone"` traces the module graph and
emits a minimal bundle, but the compiled instrumentation hook lives in a server
chunk that the trace does not reliably include. Without the full `.next/server`
directory, the container starts, serves traffic, and emits no telemetry. It
logs no error in this state, so check for the startup line described under
[Troubleshooting](#no-server-spans-at-all-in-docker-only).

```typescript title="next.config.ts" showLineNumbers
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

## Framework-Specific Features

### Proxying browser OTLP through an API route

Next.js serves an HTTP surface on the same origin as the page, so a catch-all
route can forward OTLP to the collector and the browser never makes a
cross-origin request. A static SPA has no server on that origin, so the
[Angular guide](./angular.md) uses collector CORS instead.

```typescript title="src/app/api/otel/[...signal]/route.ts" showLineNumbers
import { NextRequest, NextResponse } from 'next/server';

// Proxy browser OTel data to the collector - avoids CORS configuration.
// Browser SDK sends to /api/otel/v1/traces (or /v1/metrics, /v1/logs)
// and this route forwards it to the collector's OTLP HTTP endpoint.

const COLLECTOR_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ signal: string[] }> }
) {
  const { signal } = await params;
  const path = signal.join('/'); // e.g. "v1/traces" or "v1/metrics" or "v1/logs"

  const body = await request.arrayBuffer();

  const collectorUrl = `${COLLECTOR_ENDPOINT}/${path}`;

  const response = await fetch(collectorUrl, {
    method: 'POST',
    headers: {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
    },
    body,
  });

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    },
  });
}
```

The catch-all segment `[...signal]` captures `v1/traces`, `v1/metrics`, and
`v1/logs` in one handler, and the body is forwarded as an `ArrayBuffer` so it
works for both JSON and protobuf encodings without the route needing to
understand either.

The proxy removes the `cors` block on the receiver and the preflight round trip
before every export, and lets the collector stay on a private network. It also
means browser telemetry consumes Next.js server capacity, and the route is a
public unauthenticated write path that needs rate limiting. If your collector
is already internet-facing, direct export with a scoped CORS allow-list is the
simpler option. See [Security Considerations](#security-considerations).

### Capturing SSR error output

When an uncaught exception happens during server-side rendering, Next.js
catches it and prints it to stdout as `⨯ Error: ...`. It does not rethrow into
an active span, so nothing in the SDK observes it and the error does not reach
the logs pipeline. Bridge `console` after `sdk.start()` to capture that output
as log records.

```typescript title="src/lib/server-telemetry.ts (console bridge)" showLineNumbers
// ============================================================
// Console bridge - captures console.log/warn/error as OTel logs.
// This catches Next.js internal error output (e.g. "⨯ Error: ...")
// that happens when uncaught exceptions occur during SSR.
// ============================================================

const loggerProvider = logs.getLoggerProvider() as LoggerProvider;
if (loggerProvider) {
  const otelLogger = loggerProvider.getLogger('console-bridge');

  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  console.log = (...args: unknown[]) => {
    originalConsoleLog.apply(console, args);
    otelLogger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      body: args.map(String).join(' '),
      attributes: { 'log.source': 'console.log' },
    });
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    otelLogger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'ERROR',
      body: args.map(String).join(' '),
      attributes: { 'log.source': 'console.error' },
    });
  };
}
```

Each wrapper calls the original first, so stdout behaviour is unchanged and
container log collection keeps working. The `log.source` attribute separates
bridged output from records emitted directly through the logger.

### Structured application logs

For logs you emit yourself, use the logger directly rather than the bridge.

```typescript title="src/lib/logger.ts" showLineNumbers
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const logger = logs.getLogger('sample-nextjs-app');

export function logInfo(message: string, attributes?: Record<string, string | number | boolean>) {
  logger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: message,
    attributes,
  });
}

export function logError(message: string, attributes?: Record<string, string | number | boolean>) {
  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: message,
    attributes,
  });
}
```

Called from an API route, the record is automatically correlated with the
enclosing span because the logger reads the active context:

```typescript title="src/app/api/products/route.ts" showLineNumbers
import { NextResponse } from 'next/server';
import { logInfo } from '@/lib/logger';

export async function GET() {
  // Simulate some latency like a real DB/API call
  await new Promise((resolve) => setTimeout(resolve, 50));

  logInfo('Products fetched', { 'products.count': PRODUCTS.length });

  return NextResponse.json({
    products: PRODUCTS,
    total: PRODUCTS.length,
  });
}
```

### Server Components and SSR fetch

A Server Component that fetches during render produces a server-side `fetch`
span nested under the route's render span, with no extra code:

```tsx title="src/app/products/page.tsx (excerpt)" showLineNumbers
// Server component - fetch happens server-side during SSR
// This generates an AppRender.fetch span on the server
async function getProducts(): Promise<{ products: Product[]; total: number }> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/products`, { cache: 'no-store' });
  return res.json();
}

export default async function ProductsPage() {
  const { products } = await getProducts();
  // ...
}
```

`cache: 'no-store'` makes the fetch run on every request. With caching enabled,
Next.js serves the cached payload and produces no `fetch` span after the first
render.

### Browser error capture

Uncaught exceptions and unhandled rejections are caught at the window level:

```typescript title="src/lib/browser-telemetry.ts (error handlers)" showLineNumbers
function setupErrorHandlers() {
  const tracer = trace.getTracer('browser-errors');

  // Catch uncaught JS errors (e.g., TypeError, ReferenceError thrown in event handlers)
  window.addEventListener('error', (event) => {
    tracer.startActiveSpan('browser.error', (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR, message: event.message });
      span.setAttributes({
        'error.type': event.error?.name || 'Error',
        'error.message': event.message,
        'error.stack': event.error?.stack || '',
        'error.filename': event.filename || '',
        'error.lineno': event.lineno || 0,
        'error.colno': event.colno || 0,
        'page.url': window.location.href,
        'page.path': window.location.pathname,
      });
      span.end();
    });
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);

    tracer.startActiveSpan('browser.unhandled_rejection', (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttributes({
        'error.type': reason?.name || 'UnhandledRejection',
        'error.message': message,
        'page.url': window.location.href,
        'page.path': window.location.pathname,
      });
      span.end();
    });
  });
}
```

React error boundaries need a separate hook. React catches render errors before
they reach `window`, so neither listener above fires. Export a helper and call
it from the boundary itself:

```typescript title="src/lib/browser-telemetry.ts (error boundary helper)" showLineNumbers
export function reportErrorBoundary(error: Error, componentStack?: string) {
  const tracer = trace.getTracer('browser-errors');

  tracer.startActiveSpan('browser.react_error_boundary', (span) => {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.setAttributes({
      'error.type': error.name || 'ReactError',
      'error.message': error.message,
      'error.stack': error.stack || '',
      'error.component_stack': componentStack || '',
      'page.url': typeof window !== 'undefined' ? window.location.href : '',
      'page.path': typeof window !== 'undefined' ? window.location.pathname : '',
    });
    span.end();
  });
}
```

```tsx title="src/app/error-demo/error.tsx" showLineNumbers
'use client';

import { useEffect } from 'react';
import { reportErrorBoundary } from '@/lib/browser-telemetry';

export default function ErrorDemoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report this error boundary catch to OTel as a browser span
    reportErrorBoundary(error);
  }, [error]);

  return (
    <div>
      <h2>React Error Boundary Caught a Crash</h2>
      <p><strong>Error:</strong> {error.message}</p>
      <button onClick={reset}>Try Again</button>
    </div>
  );
}
```

Repeat the same `useEffect` in `src/app/global-error.tsx` to cover crashes in
the root layout, which segment-level boundaries cannot catch.

## Custom Instrumentation

### Core Web Vitals

The example records each vital as a short-lived span carrying the value and
Google's rating bucket:

```typescript title="src/lib/browser-telemetry.ts (web vitals)" showLineNumbers
function setupWebVitals() {
  const tracer = trace.getTracer('web-vitals');

  function reportVital(metric: { name: string; value: number; rating: string; id: string }) {
    tracer.startActiveSpan(`web-vital.${metric.name}`, (span) => {
      span.setAttributes({
        'web_vital.name': metric.name,
        'web_vital.value': metric.value,
        'web_vital.rating': metric.rating, // "good", "needs-improvement", or "poor"
        'web_vital.id': metric.id,
        'page.url': window.location.href,
        'page.path': window.location.pathname,
      });
      span.end();
    });
  }

  onCLS(reportVital);
  onLCP(reportVital);
  onTTFB(reportVital);
  onINP(reportVital);
}
```

Spans keep each vital attached to the session that produced it, which helps when
investigating a single slow page. For fleet-wide trends, histogram instruments
aggregate into p75 and p95 without storing every event; the
[Angular guide](./angular.md#core-web-vitals-as-metrics) shows that variant.

### Manual spans around business logic

Auto-instrumentation covers HTTP and transport. Domain operations need an
explicit span:

```typescript title="Manual span in an API route"
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('checkout');

export async function POST(request: Request) {
  return tracer.startActiveSpan('checkout.process', async (span) => {
    try {
      const order = await request.json();
      span.setAttributes({
        'order.item_count': order.items.length,
        'order.currency': order.currency,
      });

      const result = await processOrder(order);
      span.setAttribute('order.id', result.id);
      return Response.json(result);
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

End the span in a `finally` block. An unended span holds its slot in the
processor queue and never exports, so a throw path that skips `span.end()`
leaks spans.

### Custom metrics

Counters and histograms come from a meter, which the Node SDK registers
globally:

```typescript title="Custom counter in an API route"
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('sample-nextjs-app');

const ordersPlaced = meter.createCounter('orders.placed', {
  description: 'Count of successfully placed orders',
});

const orderValue = meter.createHistogram('order.value', {
  description: 'Order value distribution',
  unit: 'INR',
});

export async function POST(request: Request) {
  const order = await request.json();
  const result = await processOrder(order);

  ordersPlaced.add(1, { 'order.channel': order.channel });
  orderValue.record(result.total, { 'order.channel': order.channel });

  return Response.json(result);
}
```

Keep attribute values bounded. `order.channel` has a handful of values and is
safe as a label; `order.id` is unbounded and would multiply the time series
count by the number of orders.

### Returning the trace id to the client

Return the trace id in a response header so a user-reported problem can be
looked up by id:

```typescript title="Trace id in a response header"
import { trace } from '@opentelemetry/api';

export async function GET() {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId ?? '';

  return Response.json(
    { status: 'ok' },
    { headers: { 'X-Trace-Id': traceId } },
  );
}
```

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash
# Start the collector stack first
docker compose up -d otel-collector jaeger

# Then run Next.js against it
npm run dev
```

The dev server reads `OTEL_EXPORTER_OTLP_ENDPOINT` from `.env`, defaulting to
`http://localhost:4318`.

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose">
```

```bash
docker compose up --build
```

This starts the Next.js app on `http://localhost:3000`, the collector on 4317
and 4318, and Jaeger on `http://localhost:16686`.

```mdx-code-block
</TabItem>
</Tabs>
```

### Generating telemetry

```bash
# Server-side SSR + fetch spans
curl http://localhost:3000/products

# API route span with a correlated INFO log
curl http://localhost:3000/api/products

# API route span with ERROR status and a correlated ERROR log
curl -X POST http://localhost:3000/api/error
```

Browser spans require loading the app in a browser. Open
`http://localhost:3000`, navigate to **Products** and click "Fetch Products
(Client-Side)", then visit **Error Demo** and trigger each of the four error
types.

### Expected span tree

A client-side fetch from the products page produces this shape across both
services:

```text
documentLoad                                 [browser]
└── resourceFetch (x N)                      [browser]

click ClientFetchButton                      [browser]
└── HTTP GET /api/products                   [browser]
    └── GET /api/products                    [server]   <- linked via traceparent
        └── (log) "Products fetched"         [server]
```

A server-rendered page load produces this shape:

```text
GET /products                                [server]
└── AppRender /products                      [server]
    └── HTTP GET /api/products               [server]
        └── GET /api/products                [server]
```

### Verifying in the collector

With the `debug` exporter enabled, confirm both services are reporting:

```bash
docker compose logs otel-collector | grep -E 'service.name|Span #' | head -20
```

You should see two distinct `service.name` values: `sample-nextjs-app` for
server telemetry and `sample-nextjs-app-browser` for browser telemetry.

## Troubleshooting

### No server spans at all, in Docker only

The instrumentation chunk is missing from the standalone image. `output:
"standalone"` traces the module graph, and the compiled register hook is not
always included. Confirm the Dockerfile copies the full server build:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/.next/server ./.next/server
```

Without it the container starts and serves traffic, and logs no error. Check
for the startup line the server module prints:

```bash
docker compose logs nextjs-app | grep 'OTel'
# [OTel] Server-side instrumentation initialized - exporting to http://otel-collector:4318
```

### Browser telemetry returns 404 on `/api/otel/v1/traces`

The catch-all route is missing or misnamed. The directory must be
`src/app/api/otel/[...signal]/route.ts` with the square brackets and the three
dots - `[signal]` alone matches a single segment and will not catch
`v1/traces`. Confirm the browser exporter URL resolves as expected: with
`NEXT_PUBLIC_OTEL_ENDPOINT` unset it should post to `/api/otel/v1/traces`.

### Browser telemetry blocked by CORS

You have set `NEXT_PUBLIC_OTEL_ENDPOINT` to the collector origin, which switches
off the proxy and exports directly. Either unset it to go back through
`/api/otel`, or enable CORS on the receiver for the app's origin:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - "http://localhost:3000"
          allowed_headers:
            - "*"
```

### SSR errors appear in the terminal but not in the logs pipeline

Next.js printed the error to stdout instead of rethrowing it into a span. Check
that the console bridge is installed **after** `sdk.start()` - if it runs
before, `logs.getLoggerProvider()` returns the no-op provider and every bridged
record is discarded silently. Records that arrive correctly carry a
`log.source` attribute of `console.error`.

### Browser and server spans land in different traces

The `traceparent` header is not reaching the server. Check
`propagateTraceHeaderCorsUrls` covers the request URL. If the browser posts
cross-origin, the server's CORS policy must also list `traceparent` and
`tracestate` in its allowed request headers, otherwise the browser strips them
before the request is sent. Same-origin requests to your own API routes, as in
this example, are unaffected.

### Every page load floods the trace view with asset spans

The `ignoreIncomingRequestHook` filter is not applied. Next.js requests dozens
of chunks from `/_next` per page load, and each becomes a span without it:

```typescript
'@opentelemetry/instrumentation-http': {
  ignoreIncomingRequestHook: (request) => {
    const url = request.url || '';
    return url.startsWith('/_next') || url === '/favicon.ico';
  },
},
```

## Security Considerations

- **The proxy route is an unauthenticated write path**: `/api/otel` accepts
  POSTs from anyone who can reach your app and forwards them to your collector.
  Rate-limit it, and consider requiring a session cookie before forwarding. If
  your collector is already internet-facing with a scoped CORS allow-list,
  direct export is the safer choice.
- **Narrow `propagateTraceHeaderCorsUrls`**: the example uses `[/.*/]`, which
  attaches `traceparent` to every outbound request including third-party
  analytics and CDN calls. In production, list your own API origins explicitly
  so trace context never leaks off-site.
- **No PII in attributes**: browser spans carry `page.url`, which includes query
  strings. Strip or redact any parameter that can hold a token, email, or
  session id before it becomes an attribute.
- **Stack traces are attributes here**: `error.stack` and
  `error.component_stack` reach your telemetry backend in full. Confirm that is
  acceptable under your data policy, and that access to the backend is scoped
  accordingly.
- **Never use `*` for `allowed_origins`**: if you do switch to direct export,
  an open allow-list lets any site on the internet post telemetry into your
  collector.
- **Transport security**: terminate TLS in front of the collector in
  production so telemetry is encrypted in transit.

## Performance Considerations

### Expected impact

| Metric | Impact | Notes |
| --- | --- | --- |
| **Server latency** | +0.5-2ms per request | Span creation and context propagation |
| **Server CPU** | +2-5% | During export operations |
| **Server memory** | +15-40MB | SDK plus span and log buffers |
| **Client bundle** | +90-130KB gzipped | Web SDK, auto-instrumentations, web-vitals |
| **Network** | +1-5KB per trace | OTLP HTTP with gzip |

### Tuning notes

- **Filter `/_next` requests**: asset requests outnumber page and API requests
  by roughly an order of magnitude on a typical page load, so this filter has
  the largest effect on server-side span volume.
- **Load the browser SDK from a client component**: it adds to first-load
  JavaScript. Mounting it from a client component, as shown above, keeps it out
  of the root layout module graph so it does not block hydration.
- **Restrict interaction events**: the example limits
  `instrumentation-user-interaction` to `click` and `submit`. Adding
  `mousemove` or `scroll` produces spans faster than most backends can consume
  them.
- **Account for proxy traffic**: every browser export becomes a request the
  Next.js server handles. Measure that load before choosing the proxy over
  direct export at high traffic.
- **Export runs off the request path**: batch processors and the periodic
  metric reader keep export latency out of user-facing response times.

## FAQ

### How do I instrument both the browser and the server in one Next.js app?

Use two SDKs with two service names. The server side loads the Node SDK from the
`register()` hook in `instrumentation.ts`, which Next.js calls once per runtime
before any request is handled. The browser side loads the web SDK from a client
component mounted in the root layout, so it starts on hydration. They emit under
different service names and link through the W3C `traceparent` header on
`fetch` calls.

### Why does `instrumentation.ts` check `NEXT_RUNTIME`?

Next.js calls `register()` once for every server runtime, including Edge. The
Node SDK depends on Node.js built-ins that do not exist in the Edge runtime, so
importing it there throws at startup. Guarding with
`process.env.NEXT_RUNTIME === 'nodejs'` and using a dynamic import keeps the
Node SDK out of the Edge bundle entirely.

### Can I avoid configuring CORS on the collector for Next.js browser telemetry?

Yes. Add a catch-all API route at `/api/otel/[...signal]` that forwards the OTLP
request body to the collector, and point the browser exporter at `/api/otel`
instead of the collector origin. The browser then posts same-origin, so there is
no preflight and no `cors` block on the OTLP HTTP receiver. The collector never
needs to be reachable from the public internet.

### Why are my Next.js SSR errors missing from OpenTelemetry logs?

Next.js catches uncaught server-side exceptions itself and prints them to stdout
rather than rethrowing them into a span. Nothing in the OTel SDK observes
stdout, so the error never reaches the logs pipeline. Wrapping `console.log`,
`console.warn`, and `console.error` after `sdk.start()` and re-emitting each
call through the OTel logger captures that output as log records.

### How much overhead does OpenTelemetry add to a Next.js app?

Server-side, expect roughly 0.5-2ms added latency per request, 2-5% CPU during
export, and 15-40MB of resident memory for the SDK and its span buffers.
Browser-side, the web SDK adds roughly 90-130KB gzipped to the client bundle.
All signals export off the request path through batch processors and a periodic
metric reader, so export cost does not appear in user-facing latency.

### Why do I see two services for one Next.js app?

The server SDK reports as `sample-nextjs-app` and the browser SDK as
`sample-nextjs-app-browser`. They have different lifecycles, resource
attributes, and failure modes. Separate names let you filter browser telemetry
out of backend dashboards, and the two still join through a shared trace id.

### How do I capture React error boundary crashes with OpenTelemetry?

A `window.onerror` listener does not see them, because React catches render
errors before they reach the window. Export a reporting helper from your browser
telemetry module and call it from a `useEffect` inside the App Router
`error.tsx` and `global-error.tsx` boundaries. The helper opens a span, sets an
ERROR status, and attaches the error message, stack, and component stack.

### Should I record Core Web Vitals as spans or metrics in Next.js?

Metric histograms aggregate better, because Core Web Vitals are scored as
fleet-wide distributions at p75 and a histogram lets the backend compute
percentiles without storing every event. Recording them as spans, as this
example does, is simpler to wire up and keeps each vital attached to the session
that produced it, which is useful when debugging one slow page rather than
tracking a fleet trend.

### Why is my Next.js browser span in a different trace than my API route span?

The `traceparent` header is not reaching the server. Check that the request URL
matches `propagateTraceHeaderCorsUrls` in the fetch instrumentation config. If
the browser posts to a different origin than the page, the server's CORS policy
must also allow the `traceparent` and `tracestate` request headers, otherwise
the browser strips them before the request leaves.

### Do I need `output: "standalone"` for OpenTelemetry in a Next.js image?

Standalone output is not required, but if you use it you must copy the full
`.next/server` directory into the runtime image alongside the standalone
bundle. The instrumentation hook is compiled into a separate server chunk that
the standalone trace does not always include, so omitting it produces an image
that starts cleanly and emits nothing.

### Does OpenTelemetry work with the Next.js Edge runtime?

Not with the Node SDK. The Edge runtime is a restricted JavaScript environment
without the Node.js built-ins the SDK requires. Guard the register hook so the
Node SDK loads only under the `nodejs` runtime, and instrument Edge routes with
the OpenTelemetry API alone, or move them to the Node runtime if you need full
auto-instrumentation.

### Which Next.js version does this guide target?

The example runs Next.js 16.3 with React 19.2 on Node.js 22. The instrumentation
hook has been stable since Next.js 15, so the server-side setup applies
unchanged from 15 onward. The browser-side setup has no Next.js version
dependency beyond the App Router and client components.

### How is this different from the Next.js server-side guide?

The [Next.js guide](./nextjs.md) covers a server-only application with MongoDB
and BullMQ background jobs, and is the right starting point if your API tier is
the concern. This guide covers the browser and server together in one app, with
the OTLP proxy route, browser error capture, and Web Vitals that a server-only
setup does not need.

## What's Next?

- Narrow `propagateTraceHeaderCorsUrls` to your own API origins before
  deploying.
- Add rate limiting or session checks to the `/api/otel` proxy route.
- Add release and version attributes to browser error spans so crashes can be
  triaged per deploy.
- Move Core Web Vitals from spans to histogram instruments if you are tracking
  fleet-wide page performance rather than debugging single sessions.
- Add a database tier and confirm its spans nest under the API route spans this
  guide already produces.

## Complete Example

The full project - Next.js 16 App Router with browser and server
instrumentation, a pre-configured collector, and Jaeger for local viewing - is
available at
[base-14/examples/nodejs/nextjs-fullstack-otel](https://github.com/base-14/examples/tree/main/nodejs/nextjs-fullstack-otel).

```text
nextjs-fullstack-otel/
├── docker-compose.yml
├── Dockerfile                            # standalone build + .next/server copy
├── next.config.ts                        # output: "standalone"
├── instrumentation.ts                    # register hook, NEXT_RUNTIME guard
├── config/otel-collector.yaml            # OTLP in, traces+metrics+logs pipelines
└── src/
    ├── lib/
    │   ├── server-telemetry.ts           # NodeSDK + console bridge
    │   ├── browser-telemetry.ts          # WebTracerProvider, errors, Web Vitals
    │   └── logger.ts                     # structured OTel log helpers
    ├── components/TelemetryProvider.tsx  # mounts browser SDK on hydration
    └── app/
        ├── layout.tsx                    # wraps tree in TelemetryProvider
        ├── api/otel/[...signal]/route.ts # OTLP proxy - removes collector CORS
        ├── api/products/route.ts         # API route + correlated INFO log
        ├── api/error/route.ts            # error paths for span status demo
        ├── products/                     # SSR fetch + client fetch demo
        ├── error-demo/                   # four browser error types
        └── global-error.tsx              # root-layout crash boundary
```

Run it:

```bash
git clone https://github.com/base-14/examples
cd examples/nodejs/nextjs-fullstack-otel
docker compose up --build
# open http://localhost:3000, then http://localhost:16686 for traces
```

base14 Scout receives these browser spans, server spans, and logs over OTLP and
correlates them for
[end-to-end application performance monitoring](https://base14.io/scout/apm).

## References

- [Next.js instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation).
- [Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry).
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/).
- [OpenTelemetry browser instrumentation](https://opentelemetry.io/docs/languages/js/getting-started/browser/).
- [auto-instrumentations-web](https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-web).
- [web-vitals](https://github.com/GoogleChrome/web-vitals).
- [W3C Trace Context](https://www.w3.org/TR/trace-context/).

## Related Guides

- [Next.js instrumentation](./nextjs.md) - server-side Next.js with MongoDB and
  BullMQ background jobs.
- [Angular instrumentation](./angular.md) - the same three-signal browser setup
  on a standalone SPA, exporting directly to the collector with CORS.
- [React browser instrumentation](./react.md) - browser RUM through the Scout
  React SDK.
- [Node.js instrumentation](./nodejs.md) - the Node SDK underneath the server
  side of this guide.
- [Custom JavaScript browser instrumentation](../custom-instrumentation/javascript-browser.md):
  manual browser spans and metrics beyond the auto-instrumentations.
