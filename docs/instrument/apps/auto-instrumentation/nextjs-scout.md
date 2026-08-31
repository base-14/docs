---
title: Next.js OpenTelemetry - Direct OTLP to Scout, No Collector
sidebar_label: Next.js
sidebar_position: 12
description:
  Instrument a server-side Next.js app with OpenTelemetry and export OTLP
  straight to base14 Scout using OIDC client credentials. No collector required.
keywords:
  [
    nextjs opentelemetry,
    nextjs opentelemetry without collector,
    nextjs otlp direct export,
    nextjs scout instrumentation,
    nextjs oidc client credentials otlp,
    nextjs instrumentation.ts hook,
    nextjs serverless opentelemetry,
    vercel opentelemetry,
    nextjs after flush telemetry,
    opentelemetry delta temporality serverless,
    nextjs serverExternalPackages opentelemetry,
    nextjs app router tracing,
    nextjs server actions tracing,
    nextjs route handler monitoring,
    nextjs apm,
    nextjs observability,
    nextjs distributed tracing,
    nextjs otel metrics logs,
  ]
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# Next.js

:::note Running this in production

Storing and querying this data at production volume is what base14 Scout does.
[Check out Scout APM](https://base14.io/scout/apm).

:::

## Introduction

This is the default path for instrumenting a **server-side Next.js app** with
base14 Scout. The Next.js Node runtime authenticates to Scout itself and
exports OTLP over the public internet. There is no collector container, no
sidecar, and no private network hop.

That matters most on a serverless host. On Vercel, Netlify Functions, AWS
Lambda or Cloud Run, there is nowhere to put a collector next to the app and no
private network to reach a shared one over. The application process is the only
thing that exists, so it holds the credential and does the exporting.

The same code runs unchanged on a long-lived `next start` process, a container,
or a VM. Nothing here is Vercel-specific: the deployment environment and build
version come from your own variables, and the Vercel equivalents are only used
as a fallback when you have not set them.

:::tip TL;DR

Put the Node SDK behind Next's `instrumentation.ts` register hook, guarded on
`NEXT_RUNTIME`, `NEXT_PHASE` and the presence of credentials. Authenticate with
OAuth2 client credentials against your tenant's realm and pass
`scoutAuthHeaders` (an **async function**, not an object) as the exporter's
`headers`, so every export carries a fresh bearer. Keep provider handles on
`globalThis`; module scope does not survive Next's bundle split. Call
`flush()` from `after()` in every route that produces telemetry, because a
frozen function's batch timers never fire. Use **delta** temporality for
metrics. List the OTel packages in `serverExternalPackages`.

:::

## Who This Guide Is For

This documentation is designed for:

- **Next.js developers** shipping App Router apps who want traces, metrics and
  logs in Scout without running any additional infrastructure.
- **Teams on serverless platforms** (Vercel, Lambda, Cloud Run) where a
  collector sidecar is not an option.
- **Platform engineers** who want one credential per app rather than a
  collector fleet to operate, patch and monitor.
- **SRE and DevOps** who need to know exactly where telemetry is dropped when
  credentials are absent, and why an unconfigured deployment must stay silent.

## When to Use This Instead of a Collector

| Situation | Use |
| --- | --- |
| Serverless or PaaS with no sidecar | **This guide** - direct OTLP to Scout |
| One app, no existing collector fleet | **This guide** |
| You want a credential per app, rotated with the app | **This guide** |
| Many services on one network already | [Collector setup](./nextjs.md) |
| You need tail sampling, redaction or routing | [Collector setup](./nextjs.md) |
| You need host, container or k8s metrics too | [Collector setup](./nextjs.md) |
| Browser RUM alongside server traces | [Next.js Full-Stack](./nextjs-fullstack.md) |

A collector is still the right answer when telemetry from many services needs
common processing before it leaves your network. For a single Next.js app it
adds a hop without adding any processing. The general tradeoffs are covered in
[Direct to Scout Backend](../../collector-setup/sending-telemetry-directly-to-scout-backend.md).

## Overview

### Prerequisites

Before starting, ensure you have:

- **Node.js 22 or later**.
- **Next.js 15.1 or later** using the App Router. The `instrumentation.ts`
  register hook is stable from 15 and `after()` from 15.1. This guide is
  written against **Next.js 16**.
- **Scout tenant credentials**: OTLP endpoint, token URL, client ID and client
  secret. [Contact the base14 team](mailto:support@base14.io) if you do not
  have them.
- **Your service name registered in the tenant.** Scout silently discards
  telemetry from an unregistered `service.name`, and both the exporter and the
  backend report success while it happens.

### Compatibility Matrix

| Component | Version | Notes |
| --- | --- | --- |
| Next.js | 16.1 | App Router; register hook stable since 15 |
| React | 19.2 | |
| Node.js | 22 | Edge runtime is excluded by design |
| `@opentelemetry/api` | 1.9.1 | |
| `@opentelemetry/sdk-trace-node` | 2.10.0 | |
| `@opentelemetry/sdk-metrics` | 2.10.0 | |
| `@opentelemetry/sdk-logs` | 0.221.0 | |
| `@opentelemetry/auto-instrumentations-node` | 0.79.0 | |
| `@opentelemetry/exporter-*-otlp-http` | 0.221.0 | Async headers verified on this version |
| `@opentelemetry/semantic-conventions` | 1.43.0 | `ATTR_*` constants |

:::warning Do not downgrade the exporter packages

`@opentelemetry/otlp-exporter-base` **0.221.0** accepts `headers` as an async
function and awaits it inside every send - `http-exporter-transport.js` calls
`const headers = await this._parameters.headers();`. Exporters that predate
that read `headers` once at construction, so the first token is frozen into the
exporter and every export 401s the moment it expires, silently. Verify this
before downgrading, and pin the exporter packages to one release train.

:::

### Instrumented Components

`getNodeAutoInstrumentations()` patches these at `require()` time, and Next.js
contributes its own spans on top once a tracer provider is registered.

| Component | Source | What you get |
| --- | --- | --- |
| Incoming HTTP requests | `instrumentation-http` | Server spans with method, route, status code |
| Route handlers and server components | Next.js built-in | `executing api route`, `resolve page components`, `render route` |
| Server actions | Next.js built-in | One span per action invocation |
| Outbound `fetch()` and `http` calls | `instrumentation-http`, `instrumentation-undici` | Client spans with `traceparent` propagated downstream |
| PostgreSQL, MySQL, MongoDB, Redis | `instrumentation-pg`, `-mysql2`, `-mongodb`, `-ioredis` | Query spans with obfuscated statements |
| Prisma, Drizzle | Their own OTel integrations | Enable separately; not part of the auto set |
| Winston, Pino, Bunyan | `instrumentation-winston`, `-pino`, `-bunyan` | Log records with `trace_id` and `span_id` attached |
| Filesystem, DNS, net | disabled here | Too noisy on serverless; see the pipeline module |
| V8 heap, GC, event loop | disabled here | Turn on for a long-lived server |

Anything not in this list needs a manual span. See
[Custom Instrumentation](#custom-instrumentation).

### Architecture

```text
NEXT.JS NODE RUNTIME                                    SCOUT
service.name = your-app

  instrumentation.ts
    register()  --> startTelemetry()
                      |
                      +-- NodeTracerProvider  --+
                      +-- LoggerProvider      --+--> getScoutToken()
                      +-- MeterProvider       --+      client_credentials
                                                |      --> id.b14.dev
  route handlers                                |
    after(() => flush())  ---------------------+--> OTLP/HTTP + gzip
                                                       --> otel.<region>.base14.io
                                                             /<tenant>/otlp
```

The token is fetched once per process, cached, refreshed on age, and attached
per export. Nothing exports on a timer; `flush()` triggers each export.

## Installation

Install the Node SDK, the auto-instrumentation bundle and the three OTLP/HTTP
exporters. All of them are runtime dependencies; the server bundle loads them
on every cold start.

```mdx-code-block
<Tabs>
<TabItem value="npm" label="npm (Recommended)" default>
```

```bash showLineNumbers title="Install OpenTelemetry for Next.js"
npm install --save \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/otlp-exporter-base \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
<TabItem value="pnpm" label="pnpm">
```

```bash showLineNumbers title="Install OpenTelemetry for Next.js"
pnpm add \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/otlp-exporter-base \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
<TabItem value="yarn" label="yarn">
```

```bash showLineNumbers title="Install OpenTelemetry for Next.js"
yarn add \
  @opentelemetry/api \
  @opentelemetry/api-logs \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/instrumentation \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/otlp-exporter-base \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions
```

```mdx-code-block
</TabItem>
</Tabs>
```

Pin the four `0.221.0` packages together. They share an internal transport
contract, and mixing release trains is what reintroduces the frozen-header bug
described above.

## Configuration

### Environment Variables

| Variable | Secret | Purpose |
| --- | --- | --- |
| `SCOUT_ENDPOINT` | no | OTLP base, no trailing slash. Signals append `/v1/traces` etc. |
| `SCOUT_TOKEN_URL` | no | Your realm's token endpoint |
| `SCOUT_CLIENT_ID` | no | OAuth2 client |
| `SCOUT_CLIENT_SECRET` | **yes** | OAuth2 client secret |
| `SCOUT_AUDIENCE` | no | Defaults to `b14collector` |
| `OTEL_SERVICE_NAME` | no | Must match the service registered in your tenant |
| `DEPLOYMENT_ENVIRONMENT` | no | Deployment environment. Falls back to `VERCEL_ENV`, then `NODE_ENV` |
| `SERVICE_VERSION` | no | Build identifier. Falls back to `VERCEL_GIT_COMMIT_SHA`, then `dev` |

Supply them however your host does secrets. The application code reads
`process.env` and does not care which of these you use.

```mdx-code-block
<Tabs>
<TabItem value="env" label=".env.local (Recommended)" default>
```

```bash showLineNumbers title=".env.local"
SCOUT_ENDPOINT=https://otel.<region>.base14.io/<tenant-id>/otlp
SCOUT_TOKEN_URL=https://id.b14.dev/realms/<tenant>/protocol/openid-connect/token
SCOUT_CLIENT_ID=<client-id>
SCOUT_CLIENT_SECRET=<client-secret>
OTEL_SERVICE_NAME=your-app
```

```mdx-code-block
</TabItem>
<TabItem value="vercel" label="Vercel CLI">
```

```bash showLineNumbers title="Set the same values on a Vercel project"
vercel env add SCOUT_ENDPOINT production
vercel env add SCOUT_TOKEN_URL production
vercel env add SCOUT_CLIENT_ID production
vercel env add SCOUT_CLIENT_SECRET production
vercel env add OTEL_SERVICE_NAME production

# Pull them back into .env.local for local runs.
vercel env pull .env.local
```

`VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` are injected by the platform, so the
`environment()` and `serviceVersion()` helpers below need nothing extra here.

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

```yaml showLineNumbers title="docker-compose.yml"
services:
  web:
    build: .
    ports:
      - '3000:3000'
    environment:
      SCOUT_ENDPOINT: https://otel.<region>.base14.io/<tenant-id>/otlp
      SCOUT_TOKEN_URL: https://id.b14.dev/realms/<tenant>/protocol/openid-connect/token
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET}
      OTEL_SERVICE_NAME: your-app
      # No VERCEL_ENV here, so set the deployment environment yourself.
      DEPLOYMENT_ENVIRONMENT: production
      SERVICE_VERSION: ${GIT_SHA:-dev}
```

```mdx-code-block
</TabItem>
</Tabs>
```

These are the same four values a collector puts in its `oauth2client`
extension, so an app instrumented this way and a collector in the same tenant
rotate together.

Put real values in `.env.local` (which `create-next-app` gitignores) and in
your host's environment settings. Never in `.env`, and never in a commit. A
build-time check that fails when the secret's literal value appears in a
client bundle is worth adding; one is shown under
[Security Considerations](#security-considerations).

:::danger Never prefix any of these with `NEXT_PUBLIC_`

`NEXT_PUBLIC_` values are inlined into the client bundle at build time. A
`NEXT_PUBLIC_SCOUT_CLIENT_SECRET` is a published credential. The browser in
this design needs no endpoint, tenant or credential at all - it talks to
same-origin relative paths only. Add a build-time grep for `NEXT_PUBLIC_` in
your telemetry directory if you want that enforced rather than remembered.

:::

:::warning If the secret contains a `$`, escape it as `\$`

Next expands `$VAR` references when it loads `.env` files. An unescaped `$` in
a client secret is silently truncated or mangled: the file looks correct, and
the realm answers `invalid_client`. The token module below names this cause in
its warning, because nothing in the error says it.

:::

### Connection Settings

```typescript showLineNumbers title="src/lib/telemetry/config.ts"
// Every read is inside a function, never at module scope. Module-scope reads
// are evaluated when the module is first imported, which during `next build`
// is the prerender pass rather than a request. Reading per call keeps one
// build artifact correct when it is promoted between environments.

export type ScoutConfig = {
  /** OTLP base, no trailing slash. Signals append /v1/traces etc. */
  endpoint: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience: string;
};

/**
 * Null when unconfigured, which must stay a clean no-op rather than an error.
 * A fork, a credential-less CI build and a plain `next dev` all land here, and
 * none of them should see a failed token request on every page load.
 */
export function scoutConfig(): ScoutConfig | null {
  const endpoint = process.env.SCOUT_ENDPOINT;
  const tokenUrl = process.env.SCOUT_TOKEN_URL;
  const clientId = process.env.SCOUT_CLIENT_ID;
  const clientSecret = process.env.SCOUT_CLIENT_SECRET;
  if (!endpoint || !tokenUrl || !clientId || !clientSecret) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    tokenUrl,
    clientId,
    clientSecret,
    // Scout passes this as a form field on the token request, not a scope.
    audience: process.env.SCOUT_AUDIENCE || 'b14collector',
  };
}

export function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME || 'nextjs-app';
}

/**
 * DEPLOYMENT_ENVIRONMENT first, then VERCEL_ENV, and NODE_ENV only as a floor.
 *
 * NODE_ENV only takes production/development/test and is "production" on
 * PREVIEW deploys too, so deriving the environment from it files every preview
 * under production and quietly corrupts the environment filter on every
 * dashboard. Set DEPLOYMENT_ENVIRONMENT on any host that is not Vercel.
 */
export function environment(): string {
  return (
    process.env.DEPLOYMENT_ENVIRONMENT ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    'development'
  );
}

export function serviceVersion(): string {
  const explicit = process.env.SERVICE_VERSION;
  if (explicit) return explicit;
  // Only the commit SHA is shortened. An explicit version is used verbatim,
  // so a tag like 1.2.3-rc.1 survives intact.
  return (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);
}
```

### Resource Attributes

```typescript showLineNumbers title="src/lib/telemetry/resource.ts"
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { environment, serviceName, serviceVersion } from './config';

/** Separates tiers of one service: server, browser, worker. */
export const ATTR_SERVICE_ROLE = 'service.role';

export type ServiceRole = 'browser' | 'server';

function base(role: ServiceRole): Record<string, string> {
  const env = environment();
  return {
    [ATTR_SERVICE_NAME]: serviceName(),
    [ATTR_SERVICE_VERSION]: serviceVersion(),
    [ATTR_SERVICE_ROLE]: role,
    // Both keys, same value. Scout's UI and its CLI --environment flag filter
    // on the bare key; the OTel semantic convention is the dotted one. Setting
    // both means a dashboard filter written either way works.
    environment: env,
    'deployment.environment': env,
  };
}

export function serverResource(region?: string): Resource {
  const attrs = base('server');
  // service.instance.id is a resource attribute, so a per-request or
  // per-visitor value partitions every metric time series. Use something
  // bounded - a region, a pod name - or leave it unset.
  if (region) attrs['service.instance.id'] = region;
  attrs['os.type'] = process.platform;
  return resourceFromAttributes(attrs);
}

export function browserResource(): Resource {
  return resourceFromAttributes(base('browser'));
}
```

### OAuth2 Token Manager

Scout's realm issues short-lived tokens - five minutes is typical. A warm
serverless instance comfortably outlives that, so a token fetched once at
startup **will** be expired while the instance is still serving requests. The
cache below refreshes on age.

The cache is ordinary module state, not `globalThis`. Next's bundle split can
give the route handlers their own copy, which costs one extra token fetch per
copy and nothing else. Only the provider handles have to be shared, because
those carry the queued spans.

```typescript showLineNumbers title="src/lib/telemetry/token.ts"
// OAuth2 client-credentials against the tenant's realm. This is the collector's
// oauth2client extension, ported, because there is no collector here.
//
// Deliberately not OTEL_EXPORTER_OTLP_HEADERS: that is parsed once when the
// exporter is constructed, so a rotated token silently becomes a 401 that
// nothing surfaces.

import { scoutConfig } from './config';

type Cached = { token: string; expiresAt: number };

// Module scope, so the cache is shared by every request this instance
// serves. A fresh instance pays one token fetch; a warm one pays none.
let cached: Cached | null = null;
let inflight: Promise<string | null> | null = null;
let warnedInvalidClient = false;

/** Refresh this long before the token actually expires. */
const SKEW_MS = 60_000;

async function fetchToken(): Promise<string | null> {
  const cfg = scoutConfig();
  if (!cfg) return null;

  try {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        audience: cfg.audience,
      }),
      // Capped so a slow identity provider cannot delay a page. The batch is
      // dropped instead.
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Warned once per process. This cause is non-obvious: Next
      // expands $VAR references inside .env files, so a client secret
      // containing a literal $ arrives mangled unless escaped as \$.
      if (!warnedInvalidClient && body.includes('invalid_client')) {
        warnedInvalidClient = true;
        console.warn(
          '[telemetry] Scout rejected the client credentials (invalid_client). ' +
            "If SCOUT_CLIENT_SECRET contains a '$', escape it as '\\$' in .env " +
            'files: Next expands $VAR references when loading them.',
        );
      }
      return null;
    }

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) return null;

    const ttlMs = (json.expires_in ?? 300) * 1000;
    cached = { token: json.access_token, expiresAt: Date.now() + ttlMs };
    return cached.token;
  } catch {
    // Network error, timeout, malformed JSON. Return null rather than
    // throwing; the caller treats it as an export failure.
    return null;
  }
}

/**
 * A valid bearer, or null if telemetry should be dropped.
 *
 * Single-flight: traces, logs and metrics all flush at the same moment in
 * `after()`, and would otherwise each open their own token request on a cold
 * start.
 */
export async function getScoutToken(): Promise<string | null> {
  if (cached && Date.now() < cached.expiresAt - SKEW_MS) return cached.token;

  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = null;
    });
  }
  const fresh = await inflight;
  if (fresh) return fresh;

  // A failed refresh falls back to the cached token while it is still valid.
  // Inside the skew window it has not actually expired, so a transient
  // identity-provider failure does not immediately cost telemetry.
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  return null;
}

/**
 * Headers factory for the OTLP exporters.
 *
 * @opentelemetry/otlp-exporter-base 0.221+ accepts `headers` as
 * `() => Promise<Record<string,string>>` and awaits it inside every send, so a
 * rotating token needs no exporter wrapper and no instance swapping.
 *
 * Upstream contract: functions passed to the exporter must not throw.
 * Returning {} on failure yields an unauthenticated request that Scout answers
 * with 401, which the exporter treats as a normal export failure.
 */
export async function scoutAuthHeaders(): Promise<Record<string, string>> {
  const token = await getScoutToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Test seam: drop the cache so the next call re-authenticates. */
export function resetScoutToken(): void {
  cached = null;
  inflight = null;
}
```

### Exporters

```typescript showLineNumbers title="src/lib/telemetry/exporters.ts"
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from '@opentelemetry/exporter-metrics-otlp-http';
import { scoutConfig } from './config';
import { scoutAuthHeaders } from './token';

/** Shared exporter options. `signal` is the OTLP path segment. */
function opts(signal: 'traces' | 'logs' | 'metrics') {
  const cfg = scoutConfig();
  return {
    url: `${cfg?.endpoint ?? ''}/v1/${signal}`,
    // Passing the function itself is what gives per-export token refresh.
    // An object here would freeze the first token into the exporter.
    headers: scoutAuthHeaders,
    compression: CompressionAlgorithm.GZIP,
    // Shorter than the platform's own limit, so a stalled export cannot be
    // what holds an invocation open at flush time.
    timeoutMillis: 5000,
  };
}

export function traceExporter(): OTLPTraceExporter {
  return new OTLPTraceExporter(opts('traces'));
}

export function logExporter(): OTLPLogExporter {
  return new OTLPLogExporter(opts('logs'));
}

/**
 * Delta temporality, which is not the default.
 *
 * A serverless platform freezes a function between requests and discards it
 * without warning. Under the default cumulative temporality each new instance
 * restarts its counters at zero, the backend sees a monotonic series jump
 * backwards on every cold start, and those resets read as enormous negative
 * rates. Delta reports only what happened since the last collection, which is
 * the only temporality that survives this execution model.
 */
export function metricExporter(): OTLPMetricExporter {
  return new OTLPMetricExporter({
    ...opts('metrics'),
    temporalityPreference: AggregationTemporalityPreference.DELTA,
  });
}
```

:::note No `insecure_skip_verify` equivalent

Some sample collector configs disable TLS verification, including on the hop
that carries the credential. There is no reason to do that here, and no option
above turns it off.

:::

### The Telemetry Pipeline

This module creates the three providers, installs the auto-instrumentations
and exposes `flush()`. Two details carry the setup: the provider handles live
on `globalThis`, and `flush()` drains every provider. Both are marked in the
comments below.

```typescript showLineNumbers title="src/lib/telemetry/server.ts"
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { metrics, type Context } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { logs } from '@opentelemetry/api-logs';
import { logExporter, metricExporter, traceExporter } from './exporters';
import { serverResource } from './resource';

type Registry = {
  tracerProvider?: NodeTracerProvider;
  serverLogs?: LoggerProvider;
  meterProvider?: MeterProvider;
  started: boolean;
};

/**
 * Keep the provider handles on globalThis.
 *
 * Next compiles instrumentation.ts into a different bundle from the route
 * handlers, so each gets its own copy of this module and its own module-level
 * variables. As module state, startTelemetry() populates one copy while
 * flush() reads another, empty one: `started` is false at flush time and
 * nothing is ever exported. Spans still dribble out under `next start`,
 * because the OTel global API is process-wide, so the bug does not show up in
 * development.
 */
const SLOT = Symbol.for('app.telemetry.registry');

function registry(): Registry {
  const g = globalThis as typeof globalThis & { [SLOT]?: Registry };
  if (!g[SLOT]) g[SLOT] = { started: false };
  return g[SLOT];
}

/**
 * Drops spans for the telemetry endpoints themselves.
 *
 * ignoreIncomingRequestHook on instrumentation-http does not cover these:
 * Next.js emits its own spans ("POST /api/otel", "executing api route",
 * "resolve page components") from its built-in OpenTelemetry support the
 * moment a tracer provider is registered, and that support does not consult
 * the HTTP instrumentation's filters.
 */
class FilteringSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  private noisy(span: ReadableSpan): boolean {
    const route = String(
      span.attributes['next.route'] ?? span.attributes['http.route'] ?? '',
    );
    return span.name.includes('/api/otel') || route.includes('/api/otel');
  }

  onStart(span: Span, parentContext: Context): void {
    // Delegated, even though BatchSpanProcessor's onStart is a no-op today.
    // A processor swapped in later may well need it.
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (!this.noisy(span)) this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export function startTelemetry(): void {
  const reg = registry();
  if (reg.started) return;
  reg.started = true;

  // Own the MeterProvider rather than letting NodeSDK build one: flush() needs
  // a handle to force-collect it.
  reg.meterProvider = new MeterProvider({
    resource: serverResource(),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter(),
        // Deliberately long. flush() drives collection; this interval is only
        // a fallback for a long-lived process.
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: 10_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(reg.meterProvider);

  const tracerProvider = new NodeTracerProvider({
    resource: serverResource(),
    spanProcessors: [
      new FilteringSpanProcessor(new BatchSpanProcessor(traceExporter())),
    ],
  });
  tracerProvider.register();
  reg.tracerProvider = tracerProvider;

  const serverLogs = new LoggerProvider({
    resource: serverResource(),
    processors: [new BatchLogRecordProcessor({ exporter: logExporter() })],
  });
  logs.setGlobalLoggerProvider(serverLogs);
  reg.serverLogs = serverLogs;

  registerInstrumentations({
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return (
              url.startsWith('/_next') ||
              url.startsWith('/api/otel') ||
              url === '/favicon.ico'
            );
          },
          // Without this, the exporter's own POST to Scout is traced, and
          // each exported span produces another one.
          ignoreOutgoingRequestHook: (opts) => {
            const host =
              typeof opts === 'string'
                ? opts
                : String(opts.hostname ?? opts.host ?? '');
            // b14.dev is the identity host and base14.io is ingest. Both
            // are requests this pipeline makes on its own behalf.
            return host.includes('base14.io') || host.includes('b14.dev');
          },
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // ~20 series per collection of V8 heap sizes, GC durations and event
        // loop utilisation. On a platform that discards the instance between
        // requests, these describe a process that no longer exists by the time
        // anyone reads the chart. Enable it on a long-lived server.
        '@opentelemetry/instrumentation-runtime-node': { enabled: false },
      }),
    ],
  });
}

/**
 * Push everything to Scout before the instance freezes.
 *
 * Drain every provider, not only the tracer. Draining the tracer alone lets
 * server spans arrive while logs and metrics are silently dropped.
 *
 * Never rejects. A flush failure must not turn into a 500 on a page.
 */
export async function flush(): Promise<void> {
  const reg = registry();
  if (!reg.started) return;

  const jobs: Promise<unknown>[] = [];
  if (reg.tracerProvider) jobs.push(reg.tracerProvider.forceFlush().catch(() => {}));
  if (reg.serverLogs) jobs.push(reg.serverLogs.forceFlush().catch(() => {}));
  if (reg.meterProvider) jobs.push(reg.meterProvider.forceFlush().catch(() => {}));
  await Promise.all(jobs);
}
```

### The Register Hook

```typescript showLineNumbers title="src/instrumentation.ts"
// Next's server bootstrap hook. Three guards, each for a different failure.
//
// 1. NEXT_RUNTIME. The Node SDK cannot run on the Edge runtime. The import is
//    dynamic so the SDK is not even resolved at module-evaluation time and
//    therefore never enters the Edge bundle.
//
// 2. NEXT_PHASE. register() runs whenever a Next server bootstraps, including
//    the prerender pass of `next build`. Without this guard the SDK starts on
//    the build machine, fetches a token from CI, and emits a burst of
//    build-time spans indistinguishable from real traffic in the tenant.
//
// 3. Credentials. A fork, or CI without secrets, must be a silent no-op rather
//    than a failed token request on every request. Guard on the whole config,
//    not the secret alone: with a secret but no SCOUT_ENDPOINT the exporters
//    are built with a relative URL and throw at construction, which turns the
//    promised silent no-op into an error on every boot.
//
// Do Not Track belongs in the browser, not here: this hook has no request
// context to read it from.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { scoutConfig } = await import('./lib/telemetry/config');
  if (!scoutConfig()) return;

  const { startTelemetry } = await import('./lib/telemetry/server');
  startTelemetry();
}
```

### Next.js Configuration

```typescript showLineNumbers title="next.config.ts"
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The OpenTelemetry Node SDK must stay external to the server bundle. Its
  // instrumentations work by patching modules at require() time, so bundling
  // them rewrites the very module identities they hook and the patches
  // silently attach to nothing. This produces no error and no spans.
  serverExternalPackages: [
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/instrumentation',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-logs-otlp-http',
    '@opentelemetry/exporter-metrics-otlp-http',
  ],
};

export default nextConfig;
```

## Export Timing

Call `flush()` from `after()` in every route that produces telemetry.

A serverless platform freezes the function the instant it responds, so a
`BatchSpanProcessor`'s timer never fires and a
`PeriodicExportingMetricReader`'s interval never elapses. Nothing exports on
schedule. `after()` runs once the response is on the wire, and is the only
window in which an export can start.

```typescript showLineNumbers title="src/app/api/example/route.ts"
import { after } from 'next/server';
import { trace } from '@opentelemetry/api';
import { flush } from '@/lib/telemetry/server';

export const runtime = 'nodejs';
// force-dynamic so process.env is read per request rather than frozen into the
// build, which is what lets one build artifact be promoted between
// environments.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const span = trace.getActiveSpan();
  span?.setAttribute('app.handler', 'example');

  const body = await doWork();

  // The only window before the instance freezes.
  after(async () => {
    await flush();
  });

  return Response.json(body);
}
```

Add this to **every route that produces telemetry**. On a long-lived server
(`next start`, a container, a VM) the batch processors work normally and
`after()` is simply harmless, so the same code is correct in both places.

:::info Statically prerendered pages produce no server spans

If most of your routes are static, a near-empty trace view is the expected
outcome, not a symptom. Only dynamic routes, route handlers and server actions
run per request.

:::

## Production Configuration

### Batch Tuning

The defaults are tuned for a long-lived process. On a host that freezes the
instance the batch never fills and never times out, so the numbers that matter
are the queue caps rather than the intervals.

```typescript showLineNumbers title="src/lib/telemetry/server.ts (batch options)"
new BatchSpanProcessor(traceExporter(), {
  // A frozen instance never reaches this timer. It only does work on a
  // long-lived server, where 5s keeps the trace view close to live.
  scheduledDelayMillis: 5_000,
  // Cap the queue rather than the batch. A burst that overruns this is
  // dropped in memory, which bounds heap growth in a container with a hard
  // memory limit.
  maxQueueSize: 2_048,
  maxExportBatchSize: 512,
  // Below the exporter's own 5s, so a stalled export cannot stack.
  exportTimeoutMillis: 4_000,
});
```

| Setting | Serverless | Long-lived server |
| --- | --- | --- |
| `scheduledDelayMillis` | Irrelevant; `flush()` drives export | 5000 |
| `maxQueueSize` | 2048 | 2048, raise if you see drops |
| `maxExportBatchSize` | 512 | 512 |
| `exportIntervalMillis` (metrics) | 60000 fallback only | 15000 to 30000 |
| `after(() => flush())` | Required on every route | Harmless, leave it in |

Compression is already on for all three signals (`CompressionAlgorithm.GZIP`
in the exporter options). OTLP payloads are highly repetitive, so gzip
typically cuts them by more than half for a few milliseconds of CPU per
export.

### Dockerfile

For a container or VM rather than a serverless host, build the standalone
output and keep the OTel packages unbundled.

```dockerfile showLineNumbers title="Dockerfile"
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# serverExternalPackages keeps @opentelemetry/* out of the bundle; standalone
# output copies them into .next/standalone/node_modules instead.
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

On a long-lived server, turn the runtime metrics back on:

```typescript showLineNumbers title="src/lib/telemetry/server.ts (long-lived server)"
'@opentelemetry/instrumentation-runtime-node': { enabled: true },
```

### Multi-Service Tracing

Context propagates over the wire as a `traceparent` header, and
`instrumentation-http` and `instrumentation-undici` both handle it. No code
change is needed for a Next.js route that calls another instrumented service:
the outbound span is a child of the incoming request, and the downstream
service continues the same trace.

```typescript showLineNumbers title="src/app/api/orders/route.ts"
import { after } from 'next/server';
import { flush } from '@/lib/telemetry/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  // traceparent is injected automatically. The billing service sees this
  // request as part of the same trace.
  const billing = await fetch('https://billing.internal/v1/summary').then((r) =>
    r.json(),
  );

  after(async () => {
    await flush();
  });

  return Response.json(billing);
}
```

Give every service its own `OTEL_SERVICE_NAME` and the same
`DEPLOYMENT_ENVIRONMENT`, so a trace crosses services while dashboard filters
still separate environments.

## Framework-Specific Features

### Route Handlers and Server Components

Next.js emits its own spans as soon as a tracer provider is registered, so
route handlers, page renders and component resolution are covered without any
code in the handler itself.

| Span name | Emitted for |
| --- | --- |
| `GET /api/orders` | The incoming request, from `instrumentation-http` |
| `executing api route (app) /api/orders/route` | The route handler body |
| `resolve page components` | App Router component resolution |
| `render route (app) /orders` | Server rendering of a dynamic route |
| `start response` | Time to first byte |

Set `NEXT_OTEL_VERBOSE=1` to add Next's more granular internal spans. Leave it
off in production; the extra spans are only useful while debugging.

### Server Actions

Server actions are traced by the same built-in support. Add attributes to the
active span rather than creating a new one, so the action stays attached to the
request that triggered it.

```typescript showLineNumbers title="src/app/orders/actions.ts"
'use server';

import { after } from 'next/server';
import { trace } from '@opentelemetry/api';
import { flush } from '@/lib/telemetry/server';

export async function submitOrder(formData: FormData): Promise<void> {
  const span = trace.getActiveSpan();
  span?.setAttribute('app.action', 'submitOrder');
  // A bounded value. Never the customer id, and never the raw form body.
  span?.setAttribute('app.order.currency', String(formData.get('currency')));

  await persist(formData);

  after(async () => {
    await flush();
  });
}
```

### Middleware Is Not Instrumented

Next.js middleware runs on the Edge runtime, where the Node SDK cannot run.
That is why `register()` returns early unless `NEXT_RUNTIME` is `nodejs`. A
request that is rewritten or redirected in middleware produces no span until it
reaches a Node route.

If you need visibility there, propagate a header from middleware and read it in
the route handler, where you can put it on the active span:

```typescript showLineNumbers title="src/middleware.ts"
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest): NextResponse {
  // Set this on the request headers rather than the response. Only request
  // headers reach the route handler; a response header would not.
  const headers = new Headers(request.headers);
  headers.set('x-mw-rule', request.nextUrl.pathname.split('/')[1] ?? '');
  return NextResponse.next({ request: { headers } });
}
```

Then read it where a span already exists. `headers()` is async from Next.js 15:

```typescript showLineNumbers title="src/app/[section]/page.tsx"
import { headers } from 'next/headers';
import { trace } from '@opentelemetry/api';

export default async function Page() {
  const rule = (await headers()).get('x-mw-rule');
  if (rule) trace.getActiveSpan()?.setAttribute('app.mw.rule', rule);

  return <section>...</section>;
}
```

### Logs Correlated to Traces

`instrumentation-pino` and `instrumentation-winston` are both in the auto set.
They inject `trace_id` and `span_id` into every record and forward records to
the global `LoggerProvider`, which is why `startTelemetry()` registers one. No
separate log exporter wiring is needed.

```typescript showLineNumbers title="src/lib/logger.ts"
import pino from 'pino';

// No transport and no OTLP config here. The instrumentation picks these
// records up and routes them through the LoggerProvider set in
// startTelemetry(), so they land in Scout with trace context attached.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Redact before the record is ever created. The log bridge forwards
  // whatever pino produces.
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
});
```

A log line emitted inside a request handler carries the trace id, so clicking
through from a slow span to its logs works without any correlation id of your
own.

### Database Queries

`instrumentation-pg`, `-mysql2`, `-mongodb` and `-ioredis` are all in the auto
set and produce query spans with the statement obfuscated. Prisma and Drizzle
are not: they ship their own OpenTelemetry integrations and have to be enabled
separately.

Register Prisma in the same `registerInstrumentations()` call as the auto set,
inside `startTelemetry()`. Registering it at module scope in your database
module would leave the ordering up to import order, and an instrumentation that
loads before the tracer provider exists produces nothing.

```typescript showLineNumbers title="src/lib/telemetry/server.ts (Prisma)"
import { PrismaInstrumentation } from '@prisma/instrumentation';

// Inside startTelemetry(), replacing the registerInstrumentations() call
// shown earlier.
registerInstrumentations({
  instrumentations: [
    getNodeAutoInstrumentations({
      // ... the options shown earlier
    }),
    new PrismaInstrumentation(),
  ],
});
```

## Custom Instrumentation

Auto-instrumentation covers the request, the query and the outbound call.
Anything specific to your domain needs a span or a metric you write yourself.

### Manual Spans

```typescript showLineNumbers title="src/lib/checkout.ts"
import { SpanStatusCode, trace } from '@opentelemetry/api';

// Module scope is fine for a tracer: the OTel global API is process-wide, so
// this resolves to the real provider once startTelemetry() has run. Only the
// provider handles need to live on globalThis.
const tracer = trace.getTracer('app.checkout', '1.0.0');

export async function processCheckout(cartId: string, itemCount: number) {
  return tracer.startActiveSpan('checkout.process', async (span) => {
    try {
      // Use bounded values. itemCount is a small integer. cartId has
      // unbounded cardinality on a metric, but is fine on a span.
      span.setAttribute('app.cart.id', cartId);
      span.setAttribute('app.cart.item_count', itemCount);

      const result = await chargeAndFulfil(cartId);

      span.setAttribute('app.checkout.outcome', result.outcome);
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'checkout failed' });
      throw error;
    } finally {
      // Always end the span. An unended span is never exported.
      span.end();
    }
  });
}
```

### Custom Metrics

```typescript showLineNumbers title="src/lib/metrics.ts"
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('app.checkout', '1.0.0');

export const checkoutsCompleted = meter.createCounter('app.checkouts.completed', {
  description: 'Checkouts that reached a terminal success state',
  unit: '{checkout}',
});

export const checkoutDuration = meter.createHistogram('app.checkout.duration', {
  description: 'End-to-end checkout latency',
  unit: 'ms',
});
```

```typescript showLineNumbers title="Recording a measurement"
import { checkoutDuration, checkoutsCompleted } from '@/lib/metrics';

const started = performance.now();
const result = await processCheckout(cartId, itemCount);

// Attributes here become metric dimensions. Keep them to a closed set:
// 'outcome' has three possible values, 'payment_method' has five. A cart id
// or a user id here would create one time series per customer.
checkoutsCompleted.add(1, {
  outcome: result.outcome,
  payment_method: result.paymentMethod,
});
checkoutDuration.record(performance.now() - started, { outcome: result.outcome });
```

:::warning Metric attributes are not span attributes

Every distinct combination of metric attribute values is a separate time
series, stored and billed for as long as it is retained. A cart id is fine on a
span. On a counter it creates one time series per cart. Collapse to route
patterns and closed enumerations before a value becomes a metric dimension.

:::

### Trace ID in Responses

Returning the trace id lets a support ticket or a client-side error report
point straight at the trace.

```typescript showLineNumbers title="src/app/api/checkout/route.ts"
import { after } from 'next/server';
import { trace } from '@opentelemetry/api';
import { flush } from '@/lib/telemetry/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  const result = await processCheckout(body.cartId, body.itemCount);

  const ctx = trace.getActiveSpan()?.spanContext();

  after(async () => {
    await flush();
  });

  return Response.json(result, {
    headers: ctx
      ? // A real span id, not zeroes: an all-zero span id is invalid under
        // the W3C trace context spec. Server-Timing is readable from the
        // browser via PerformanceObserver with no extra CORS configuration
        // on a same-origin response.
        {
          'Server-Timing': `traceparent;desc="00-${ctx.traceId}-${ctx.spanId}-01"`,
        }
      : {},
  });
}
```

## Running Your Application

### Development

```bash showLineNumbers title="Run locally against your tenant"
# .env.local supplies the four Scout variables.
npm run dev
```

`next dev` is a long-lived process, so the batch processors export on their own
timers and you do not need `after()` to see spans. This is why a missing
`flush()` does not show up locally. With no credentials in the
environment the register hook returns immediately and the app runs untouched.

### Production

```bash showLineNumbers title="Build and run"
npm run build
npm run start
```

The build emits no telemetry: `register()` returns early on
`phase-production-build`. Telemetry starts with the first request to the
running server.

### Expected Span Hierarchy

A single request to an instrumented route handler produces roughly this:

```text
GET /api/checkout                          (instrumentation-http, SERVER)
└── executing api route (app) /api/checkout/route   (Next.js built-in)
    └── checkout.process                   (your manual span)
        ├── pg.query:INSERT orders         (instrumentation-pg)
        └── POST payments.internal         (instrumentation-undici, CLIENT)
            └── ... continues in the payments service
```

### Verify the Setup

Work through these three in order. Each one checks a different layer.

#### 1. Check the credentials directly

```bash showLineNumbers title="Fetch a token"
TOKEN=$(curl -s -X POST "$SCOUT_TOKEN_URL" \
  -d grant_type=client_credentials \
  -d client_id="$SCOUT_CLIENT_ID" \
  -d client_secret="$SCOUT_CLIENT_SECRET" \
  -d audience=b14collector | jq -r .access_token)

[ -n "$TOKEN" ] && [ "$TOKEN" != null ] && echo "token ok" || echo "no token"
```

An `invalid_client` here is a credential problem, not an instrumentation
problem. Check the `$`-escaping note above first. Load the variables from
`.env.local` (`set -a; source .env.local; set +a`) rather than typing the
secret on the command line, where it lands in shell history.

#### 2. Check the ingest path

```bash showLineNumbers title="Send an empty payload"
curl -i -X POST "$SCOUT_ENDPOINT/v1/traces" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"resourceSpans":[]}'
```

Expect `200` with `{"partialSuccess":{}}`. Without the bearer, expect `401`.
The same holds for `/v1/logs` and `/v1/metrics`.

#### 3. Check the app

```bash showLineNumbers
npm run build && npm run start
curl -s localhost:3000/api/example > /dev/null
```

Then look for your `service.name` in Scout. If the two curl checks pass and the
app produces nothing, work through the troubleshooting table below.

## Browser Telemetry

The browser holds no credential in this design. If you want RUM alongside these
server traces, keep it that way: have the browser export to a same-origin
route that attaches the bearer server-side.

First, a small guard module. The limiter is a cost cap, not a security
boundary: a serverless platform runs many instances and freezes them
arbitrarily, so the bucket is per instance and per lifetime. It stops one
looping tab or a naive script from turning into unbounded ingest.

```typescript showLineNumbers title="src/lib/telemetry/guard.ts"
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
/** Bounded so the map cannot itself become the memory leak. */
const MAX_TRACKED = 5000;

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    if (hits.size > MAX_TRACKED) hits.clear();
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_PER_WINDOW;
}

/** Best-effort client identity. Most hosts set x-forwarded-for at the edge. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
}
```

Then the route itself:

```typescript showLineNumbers title="src/app/api/otel/[...signal]/route.ts"
import { after } from 'next/server';
import { scoutConfig } from '@/lib/telemetry/config';
import { clientKey, rateLimit } from '@/lib/telemetry/guard';
import { getScoutToken } from '@/lib/telemetry/token';
import { flush } from '@/lib/telemetry/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Spans can be larger than a metrics batch, but not unboundedly so. */
const MAX_BYTES = 512 * 1024;

/** The two OTLP/HTTP encodings. Anything else is not a span payload. */
const CONTENT_TYPES = new Set(['application/json', 'application/x-protobuf']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ signal: string[] }> },
): Promise<Response> {
  const { signal } = await params;

  // Traces only. Proxying /v1/logs and /v1/metrics would let anyone write
  // arbitrary log bodies and arbitrary metric attributes into the tenant.
  if ((signal ?? []).join('/') !== 'v1/traces') {
    return new Response(null, { status: 404 });
  }

  // Unconfigured: accept and discard, so a fork or a local run behaves the
  // same as production from the browser's point of view.
  const cfg = scoutConfig();
  if (!cfg) return new Response(null, { status: 202 });

  if (!rateLimit(clientKey(request))) return new Response(null, { status: 429 });

  const contentType = (request.headers.get('content-type') ?? '').split(';')[0];
  if (!CONTENT_TYPES.has(contentType)) return new Response(null, { status: 415 });

  // Checked before AND after reading: content-length is client-supplied.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return new Response(null, { status: 413 });

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 413 });

  const token = await getScoutToken();
  if (!token) return new Response(null, { status: 202 });

  // Relayed byte for byte. The browser stamped service.role=browser on its
  // resource, and re-resourcing it here would erase what separates browser
  // spans from server spans in the tenant.
  try {
    await fetch(`${cfg.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': contentType, authorization: `Bearer ${token}` },
      body,
      // Telemetry must never be what holds a function open.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Dropped. Never surface an upstream failure to the browser.
  }

  after(async () => {
    await flush();
  });

  // Scout's response is deliberately not echoed: that would turn this route
  // into a probe for whether the tenant and credential are valid.
  return new Response(null, { status: 202 });
}

/** Only POST is valid on this route. A GET is a scanner or a misconfiguration. */
export function GET(): Response {
  return new Response(null, { status: 405 });
}
```

Because the browser posts same-origin, `connect-src 'self'` in an existing
Content-Security-Policy already permits it. No Scout origin, tenant id or
credential is added to the CSP or to the client bundle.

:::warning This is an unauthenticated write path

`/api/otel` accepts POSTs from anyone who can reach your app. The route above
rate-limits, caps the body, allow-lists the content type and rejects anything
that is not `v1/traces`. Keep all four. If you later proxy logs or metrics
too, validate every value that can become a metric attribute against a closed
set on the server first; the browser cannot be trusted to bound its own
cardinality, and one unbounded attribute degrades the whole tenant.

:::

For the full browser side - web SDK setup, `traceparent` propagation, Core Web
Vitals and error boundaries - see
[Next.js Full-Stack](./nextjs-fullstack.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Nothing arrives, no errors anywhere | `service.name` is not registered in the tenant. Scout discards it silently and both the exporter and backend report success | Check the tenant's service list before touching code |
| Works on `next start`, nothing in production | `flush()` is not called from `after()`, so the frozen instance never exports | Add `after(() => flush())` to every telemetry-producing route |
| Spans arrive, logs and metrics do not | `flush()` drains only the tracer provider | Drain every provider you created |
| `flush()` runs but `started` is false | Provider handles are in module scope, and the route bundle has a different copy from `instrumentation.ts` | Keep the registry on `globalThis` behind a `Symbol.for` |
| All exports 401 after a few minutes | Exporter packages below 0.221, so `headers` was read once at construction | Upgrade the exporter packages; pass `headers` as a function |
| Realm answers `invalid_client` | A `$` in the client secret was expanded by Next when loading `.env` | Escape it as `\$` |
| Build-time spans in the tenant | Missing `NEXT_PHASE` guard, so the SDK started during prerender | Return early on `phase-production-build` |
| No spans at all, no error | OTel packages were bundled, so the require-time patches attached to nothing | Add them to `serverExternalPackages` |
| Metric rates spike hugely negative | Cumulative temporality plus cold starts resetting counters | Use `AggregationTemporalityPreference.DELTA` |
| Trace view is mostly the `/api/otel` route | Next emits its own spans for that route regardless of HTTP instrumentation filters | Add the `FilteringSpanProcessor` |
| Every export produces another span | The exporter's own POST is being traced | Set `ignoreOutgoingRequestHook` for the Scout and identity hosts |
| Edge runtime build errors | The Node SDK was statically imported | Import it dynamically, inside the `NEXT_RUNTIME` guard |

## Security Considerations

- **The credential lives in one place.** Only the Node runtime reads
  `SCOUT_CLIENT_SECRET`. No `NEXT_PUBLIC_` prefix, ever, and no endpoint or
  tenant id in the client bundle.
- **Enforce that at build time.** The rule is a one-word prefix and easy to
  miss in review, and breaking it ships the secret to every visitor and every
  CDN cache. Fail the build on either signal:

  ```javascript showLineNumbers title="scripts/check-no-secrets.mjs"
  import { existsSync, globSync, readFileSync } from 'node:fs';

  let failed = false;

  // 1. No NEXT_PUBLIC_ anywhere in the telemetry code. The browser is
  //    configured by same-origin relative paths and needs none.
  for (const file of globSync('src/lib/telemetry/*.ts')) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (!t.startsWith('//') && t.includes('NEXT_PUBLIC_')) {
        console.error(`${file}:${i + 1}  NEXT_PUBLIC_ in telemetry code`);
        failed = true;
      }
    });
  }

  // 2. No literal secret in a built client bundle. Read from the environment,
  //    never hardcoded: this script is committed.
  const secret = process.env.SCOUT_CLIENT_SECRET;
  if (existsSync('.next/static') && secret && secret.length >= 12) {
    for (const file of globSync('.next/static/**/*.js')) {
      if (readFileSync(file, 'utf8').includes(secret)) {
        console.error(`${file}  CONTAINS A CREDENTIAL`);
        failed = true;
      }
    }
  }

  if (failed) process.exit(1);
  ```

  Wire it into `prebuild` so `next build` cannot succeed past it.
- **The token is never logged.** The only warning the token module prints is
  the `invalid_client` hint, and it prints no request or response body. Keep
  it that way. A token written to a log is stored for the life of that log.
- **Unconfigured is a clean no-op.** With any of the four Scout variables
  missing, `scoutConfig()` returns null, the register hook returns immediately
  and the routes accept and discard. A fork, a preview build without secrets,
  and a plain `next dev` all behave identically and silently.
- **Rate-limit and size-cap any public write path** you expose for browser
  telemetry, and proxy traces only.
- **Do not disable TLS verification** on the hop that carries the credential.
- **Keep high-cardinality values off metric attributes.** Collapse paths to
  route patterns (`/blog/[slug]`, not `/blog/why-otel`) before they become
  attributes; the full path can still go on a span or log record.

## Performance Considerations

- **Cold start**: one token fetch, cached per instance. `instrumentation-fs`
  is disabled because its patching is expensive enough to show up in cold-start
  time.
- **Per export**: `scoutAuthHeaders()` is a cache read in the common case, not
  a network call.
- **Payload size**: gzip is on for every signal.
- **Request latency**: unchanged. `after()` runs once the response is on the
  wire, and every timeout (4s token, 5s export) is set so telemetry can never
  be what holds an invocation open.
- **Runtime metrics are off by default** here. On a long-lived server, turn
  `instrumentation-runtime-node` back on - that is where it earns its ~20
  series per collection.

## FAQ

### Do I need an OpenTelemetry Collector to send Next.js telemetry to Scout?

No. The Next.js Node runtime can authenticate to Scout with OAuth2 client
credentials and export OTLP directly, which is what this guide sets up. A
collector is worth adding when several services need shared processing -
tail sampling, redaction, routing - or when you also want host and container
metrics. For a single app on a serverless platform, it has nowhere to run and
nothing to add.

### Why do my spans disappear in production but work locally?

Because a serverless platform freezes the function the moment it responds, so
the batch processor's export timer never fires. Locally, `next start` is a
long-lived process, the timers elapse normally, and everything looks correct.
The fix is to call `flush()` from `after()` in every route that produces
telemetry, which is the only window between the response being sent and the
instance being frozen.

### Why does the OTLP exporter start returning 401 after a few minutes?

The exporter captured a single bearer token at construction and the token
expired. Scout's realm issues short-lived tokens - five minutes is typical -
so a token fetched at startup expires while the instance is still serving.
Pass `headers` as an async function rather than an object, and use
`@opentelemetry/otlp-exporter-base` 0.221 or later, where the transport awaits
that function on every send.

### Should the browser export OTLP directly to Scout?

No, because it would need a credential to do so, and anything the browser has
is public. Have the browser POST to a same-origin route in your own app that
attaches the bearer server-side. That also removes the CORS preflight, needs no
new origin in your CSP, and keeps your tenant id out of the client bundle.

### Why must OpenTelemetry packages be listed in serverExternalPackages?

Because the instrumentations work by patching modules at `require()` time.
Bundling them rewrites the very module identities they hook, so the patches
attach to nothing. This fails silently: there is no error, there are simply no
spans, which makes it one of the harder setup mistakes to diagnose.

### Why delta temporality for metrics on serverless?

Because each new instance restarts its counters at zero. Under the default
cumulative temporality the backend sees a monotonic series jump backwards on
every cold start and reads those resets as enormous negative rates. Delta
reports only what happened since the last collection, so a discarded instance
takes nothing with it.

### Does the SDK run during `next build`?

It will, unless you guard against it. `register()` runs whenever a Next server
bootstraps, and that includes the prerender pass of `next build` - so the SDK
starts on the build machine, fetches a token from CI, and emits build-time
spans that are indistinguishable from real traffic once they are in the tenant.
Return early when `process.env.NEXT_PHASE === 'phase-production-build'`.

### How much overhead does OpenTelemetry add to a Next.js app?

Expect single-digit milliseconds on the request path and roughly 30 to 60MB of
additional heap. The auto-instrumentation patches add about 1 to 3ms per
request across HTTP and database spans, and the export itself costs nothing on
the request path because `after()` runs once the response is on the wire. The
larger cost is cold start: loading and patching the SDK adds roughly 150 to
300ms, which is why `instrumentation-fs` and the runtime metrics are disabled
in this setup.

### Can I use this on the Edge runtime or in middleware?

No. The OpenTelemetry Node SDK needs Node APIs that the Edge runtime does not
provide, which is why `register()` returns early unless `NEXT_RUNTIME` is
`nodejs`. Middleware therefore produces no spans. Move the work you need to see
into a Node route handler, or pass a header from middleware and record it on
the span there.

### Do I need to call flush() in every route?

Yes, in every route that produces telemetry, if you deploy to a serverless
host. The platform freezes the instance the moment the response is sent, so
nothing that is still sitting in a batch queue will ever leave. On a long-lived
server the batch processors handle it and `after(() => flush())` is a harmless
no-op, which is what lets the same code run correctly in both places.

### What happens if Scout is unreachable or the credentials are wrong?

Telemetry is dropped and your application keeps serving. Every failure path in
the token module and the exporters swallows its error: a failed token fetch
returns null, `scoutAuthHeaders()` returns an empty object, and the resulting
401 is handled by the exporter as an ordinary export failure. The token fetch
is capped at 4 seconds and each export at 5, so a slow or dead endpoint cannot
hold a request or an invocation open.

## What's Next?

- [Next.js Full-Stack](./nextjs-fullstack.md) - add browser RUM, Core Web
  Vitals and error boundaries on top of this server setup.
- [Next.js (Collector)](./nextjs.md) - the same app exporting to a collector
  you run, with Docker and Docker Compose examples.
- [Direct to Scout Backend](../../collector-setup/sending-telemetry-directly-to-scout-backend.md)
  is the language-agnostic version of this pattern.
- [Custom instrumentation for Node.js](../custom-instrumentation/javascript-node.md)
  covers business spans and metrics beyond what auto-instrumentation captures.
- [Create your first dashboard](../../../guides/create-your-first-dashboard.md)
  turns these signals into charts and alerts.

## Complete Example

The telemetry code is nine files, six of them under `src/lib/telemetry/`.
Your route handlers change only to add `after(() => flush())`.

```text title="Project structure"
your-app/
├── next.config.ts                   # serverExternalPackages
├── package.json
├── .env.example                     # variable names only, no values
├── .env.local                       # Scout credentials, gitignored
├── scripts/
│   └── check-no-secrets.mjs         # prebuild guard
└── src/
    ├── instrumentation.ts           # Next register hook, four guards
    ├── lib/
    │   ├── logger.ts                # pino, picked up by the log bridge
    │   ├── metrics.ts               # counters and histograms
    │   └── telemetry/
    │       ├── config.ts            # env reads, all inside functions
    │       ├── resource.ts          # service.name, version, environment
    │       ├── token.ts             # OAuth2 client credentials + cache
    │       ├── exporters.ts         # OTLP/HTTP, gzip, delta temporality
    │       ├── server.ts            # providers on globalThis, flush()
    │       └── guard.ts             # rate limit for the browser proxy
    └── app/
        ├── api/
        │   ├── checkout/route.ts    # after(() => flush())
        │   └── otel/[...signal]/route.ts   # browser trace proxy
        └── orders/
            └── actions.ts           # server action
```

```json showLineNumbers title="package.json (scripts)"
{
  "scripts": {
    "dev": "next dev",
    "prebuild": "node scripts/check-no-secrets.mjs",
    "build": "next build",
    "start": "next start"
  }
}
```

```bash showLineNumbers title="Run it end to end"
npm install
cp .env.example .env.local        # fill in the four SCOUT_* values
npm run build
npm run start

curl -s localhost:3000/api/checkout -X POST \
  -H 'content-type: application/json' \
  -d '{"cartId":"c_123","itemCount":2}' -i | grep -i server-timing
```

The `Server-Timing` header carries the trace id. Paste it into Scout's trace
search to land on the exact request you just made.

If you would rather start from a collector-based project you can run with
`docker compose up`, the
[Next.js (Collector)](./nextjs.md) guide is backed by
[base-14/examples/nodejs/nextjs-api-mongodb](https://github.com/base-14/examples/tree/main/nodejs/nextjs-api-mongodb).
The telemetry modules above drop into that project in place of its collector
wiring.

[base14 Scout](https://base14.io/scout/apm) stores and queries this telemetry
across services.

## References

- [OpenTelemetry JavaScript documentation](https://opentelemetry.io/docs/languages/js/)
- [Next.js instrumentation.ts reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Next.js `after()` reference](https://nextjs.org/docs/app/api-reference/functions/after)
- [Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry)
- [OTLP/HTTP specification](https://opentelemetry.io/docs/specs/otlp/#otlphttp)
- [OAuth 2.0 client credentials grant](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Next.js (Collector)](./nextjs.md) - the same framework exporting to a
  collector you run
- [Next.js Full-Stack](./nextjs-fullstack.md) - browser and server together,
  with Web Vitals and error boundaries
- [Node.js Instrumentation](./nodejs.md) - the generic Node SDK setup this
  builds on
- [Vercel AI SDK](./vercel-ai-sdk.md) - LLM call tracing inside a Next.js app
- [tRPC Instrumentation](./trpc.md) - type-safe procedures hosted in Next.js
  route handlers
- [Node.js Custom Instrumentation](../custom-instrumentation/javascript-node.md)
  covers manual spans and metrics in depth
