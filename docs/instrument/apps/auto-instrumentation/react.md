---
title: React OpenTelemetry Instrumentation - Browser Tracing & Web Vitals
sidebar_label: React
sidebar_position: 17
description:
  Auto-instrument React web apps with @base-14/scout-react — captures routes,
  clicks, fetch/XHR, errors, Core Web Vitals, long tasks, frustration signals,
  and frame metrics. Exports OpenTelemetry traces, metrics, and logs to base14
  Scout via OTLP.
keywords:
  [
    react opentelemetry,
    react rum,
    react real user monitoring,
    react browser tracing,
    react web vitals,
    scout-react,
    react performance monitoring,
    react crash reporting,
    react frustration detection,
    spa monitoring,
    react fetch tracing,
    opentelemetry react,
  ]
---

# React (web)

`@base-14/scout-react` ships **zero-config Real User Monitoring** for React
web apps. One npm install, one `Scout.initialize()` call, and every click,
route change, fetch request, error, Core Web Vital, long task, and lifecycle
transition is captured as an OpenTelemetry span / metric / log and exported
via OTLP to your Scout endpoint.

:::tip TL;DR
`npm install @base-14/scout-react`, call `Scout.initialize({ serviceName,
endpoint, headers })` once on app boot from the browser, optionally wrap your
root with `ScoutErrorBoundary`. No manual `Scout.track(...)` calls needed —
the SDK auto-instruments the entire browser-RUM surface.
:::

:::info Mobile (React Native)?
The same SDK package targets React Native. See the
[React Native + React Web instrumentation guide](../../mobile/react-native.md)
for the full reference including native crash capture, ANR detection,
session-context persistence, and Expo integration.
:::

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## What you get

| Capability | Signal | How it's captured |
|---|---|---|
| Route / page navigation | `screen_view` ROOT span with `view.id`, `view.loading_type`, `view.referrer`, `screen_load` span with `screen.load_time` | History API + `popstate` listener |
| Click tracking | `user_interaction` span (`type=click`, target selector, x/y, composed-path) | Capture-phase `click` listener |
| Frustration signals | `user_interaction.action.frustration.type` (`rage_click` / `dead_click` / `error_click`) | DOM mutation observer + error correlation |
| Fetch / XHR | `http.request` span with method / `url.full` / `http.response.status_code` / `http.duration_ms` / phase breakdown (DNS / connect / SSL / TTFB / download / redirect) / `network.protocol.name` / GraphQL operation parse / third-party provider classification (Stripe / CloudFront / Google Fonts / …) | Global `fetch` + `XMLHttpRequest` wrap + `PerformanceResourceTiming` |
| Errors | `error` span with `error.id`, `error.type`, `error.message`, `error.stack_trace`, `error.fingerprint`, `error.causes_json`, `breadcrumbs` | `window.onerror` + `unhandledrejection` + `ErrorBoundary` |
| `app_crash` (catch-all) | Emitted on next launch if the previous session didn't exit cleanly (`pagehide` never fired) | Session marker in `localStorage` |
| Core Web Vitals | `web_vital` spans for LCP / INP / CLS / FCP / TTFB plus sub-parts (input_delay, processing_duration, presentation_delay for INP; load_delay, load_time, render_delay for LCP; layout-shift rects for CLS) | `web-vitals` library |
| Long tasks | `long_task` span with `long_task.duration`, blocking_duration, render_start, style_and_layout_start, first_ui_event_timestamp, `scripts_json` | `PerformanceObserver('longtask')` + `long-animation-frame` (Chrome 123+) |
| Frozen frames | `frozen_frame` span (≥ 700 ms blocks) | Same `PerformanceObserver` |
| Scroll depth | `display.scroll.max_depth`, `max_scroll_height`, `max_scroll_height_time_ms` on `screen_view` | `window.scroll` listener with rAF coalescing |
| CSP violations | `error` span with `error.csp.violated_directive`, `blocked_uri`, `disposition` | `securitypolicyviolation` event listener |
| Page lifecycle | `app_paused` / `app_resumed` spans + `view.page_states_json` + `view.in_foreground_periods_json` | `visibilitychange` + `freeze` / `resume` events |
| Background flush | All batched signals force-flushed on `visibilitychange=hidden` / `pagehide` | OTel `BatchSpanProcessor.forceFlush()` |
| Resource attributes | `service.name`, `service.version`, `app.bundle_id`, `os.name`, `device.locale`, `network.connection.type`, `viewport.width/height`, `screen.pixel_ratio`, `a11y.*` (~20 accessibility flags) | Collected at init |
| Identity + session attrs | `user.id` + `user.*` (from `setUser`), `account.id` (from `setAccount`), `feature_flag.*` (from `setFeatureFlag`), arbitrary session bag (from `setSessionAttributes`) | In-memory; merged into every span via `commonAttributes()` |
| Retry with jitter | Exponential backoff with full jitter on 5xx / 408 / 429 / network errors; configurable max retries | `wrapWithRetry` exporter wrapper |
| Offline buffer | Retry-exhausted batches persisted to `localStorage`; replayed on `Scout.initialize()` + `visibilitychange=visible` + `online` events | Per-signal FIFO item caps |

## Prerequisites

- React 18 or 19
- A Scout collector / RUM ingest endpoint reachable from the browser

## Install

```bash
npm install @base-14/scout-react
```

## Initialize

`Scout.initialize()` must run only in the browser. For pure CSR (Create React
App, Vite without SSR), import it from your client entry. For any SSR setup
(Next.js, Remix, Astro, Docusaurus, etc.), gate it with `useEffect` or a
`typeof window !== 'undefined'` check so it doesn't run during SSR build time
when `window` / `document` / `localStorage` are absent.

### Pure CSR (Vite, CRA)

```tsx title="src/main.tsx"
import Scout from '@base-14/scout-react';
import { ScoutErrorBoundary } from '@base-14/scout-react/react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import App from './App';

await Scout.initialize({
  serviceName: 'my-web-app',
  endpoint: 'https://rum.example.com/<tenant>/otlp',
  secure: true,
  headers: { Authorization: `Bearer ${import.meta.env.VITE_SCOUT_TOKEN}` },
});

createRoot(document.getElementById('root')!).render(
  <ScoutErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ScoutErrorBoundary>,
);
```

### SSR-aware (Next.js, Remix, Docusaurus, etc.)

Run `Scout.initialize()` inside `useEffect` (which only fires on the client),
or guard a top-level module with a `typeof window` check:

```tsx title="components/ScoutBootstrap.tsx (Next.js client component)"
'use client';
import { useEffect } from 'react';
import Scout from '@base-14/scout-react';

let initialized = false;

export function ScoutBootstrap() {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    void Scout.initialize({
      serviceName: 'my-web-app',
      endpoint: 'https://rum.example.com/<tenant>/otlp',
      secure: true,
      headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SCOUT_TOKEN}` },
    });
  }, []);
  return null;
}
```

Render `<ScoutBootstrap />` once at the root of your app.

The `!initialized` flag is a belt-and-braces idempotency check — bundler HMR
sometimes re-evaluates top-level modules.

## Identity + session attributes

Once `Scout.initialize()` resolves you can attach identity and arbitrary
session-scoped attributes. Every subsequent span, metric, and log carries them
automatically until you change or clear them.

```ts
// End-user identity → user.id + user.<key> on every span
Scout.setUser('user-123', {
  email: 'jane@example.com',
  plan: 'pro',
});

// B2B tenant → account.id + account.name
Scout.setAccount('acme-corp', 'Acme Corp');

// Session-scoped attribute bag (tenant id, build flavor, A/B cohort)
Scout.setSessionAttributes({
  'tenant.id': 'acme',
  'tenant.plan': 'enterprise',
  'build.flavor': 'production',
});

// Feature flags — attached to every error span emitted while flags are active
Scout.setFeatureFlag('new-checkout', true);
Scout.setFeatureFlag('checkout-variant', 'B');

// Manual breadcrumbs (rolling 100-entry trail attached to every crash / error)
Scout.addBreadcrumb('checkout', 'added item to cart');

// Logs — go to the OTel log pipeline with active trace context
Scout.logInfo('app booted');
Scout.logError('payment failed', { 'order.id': 'ord-42' });

// Manual error report (handled errors)
try { /* … */ } catch (err) { Scout.reportError(err, { handled: true }); }
```

On sign-out, clear identity / account / flags:

```ts
async function signOut() {
  await api.signOut();
  Scout.clearUser();
  Scout.clearAccount();
  Scout.clearFeatureFlags();
  Scout.clearSessionAttributes();
}
```

## Filtering / PII redaction

Pass a `beforeSend` callback that runs on every span / metric / log before
export. Return `null` to drop, or mutate the attributes object to redact:

```ts
Scout.initialize({
  // …
  beforeSend: (event) => {
    if (String(event['url.full'] ?? '').includes('/health')) return null;
    delete event['user.email'];
    return event;
  },
});
```

The callback sees per-span attributes only; resource attributes (e.g.
`service.name`, `os.name`, `device.*`) aren't in the event payload.

## CORS

The browser SDK exports via OTLP-HTTP. If your collector is on a different
origin you'll need to allow CORS:

```yaml title="collector config"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        cors:
          allowed_origins:
            - "https://my-web-app.example.com"
```

## Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently — see the
[React Native + React Web reference](../../mobile/react-native.md#auto-instrumentation-toggles)
for the complete list (`enableErrorTracking`, `enableWebVitals`,
`enableNetworkTracking`, `enableLongTaskDetection`, `enableAutoTapTracking`,
`captureConsole`, etc.). All default to `true` except `captureConsole`.

## Sampling

`sessionSampleRate` defaults to `1` (1% of sessions) to bound telemetry
volume in production. Error / crash / ANR / UI-hang spans bypass this gate
(controlled by `alwaysCaptureErrors`, default `true`) so failures are always
captured regardless of sampling. Below `100`, full sessions are dropped
(never partial) so traces stay coherent.

For development bump it to `100`:

```ts
Scout.initialize({
  // …
  sessionSampleRate: 100,
});
```

## Full reference

For the complete configuration surface (transport, batching, retry, offline
buffer, thresholds, resource attrs, every `enable*` toggle, native crash
setup, ANR detection, troubleshooting, FAQ), see the
[React Native + React Web instrumentation guide](../../mobile/react-native.md).
The same package and the same APIs apply across React Native and React web —
only the entry import (`@base-14/scout-react` vs
`@base-14/scout-react/native`) and the runtime-specific captures differ.

## FAQ

### How do I add Real User Monitoring to a React web app with base14 Scout?

Install `@base-14/scout-react`, call `Scout.initialize()` once on app boot
from the browser, and wrap your root with `ScoutErrorBoundary`. Routes,
clicks, fetch and XHR calls, errors, Core Web Vitals, and lifecycle events
are then captured automatically and exported as OTLP traces, metrics, and
logs to your Scout endpoint.

### What does scout-react capture without manual instrumentation?

Clicks, route navigations, fetch and XHR requests, JavaScript errors,
unhandled rejections, Core Web Vitals (LCP, INP, CLS, FCP, TTFB), long
tasks, frozen frames, scroll depth, CSP violations, page lifecycle
transitions, and frustration signals such as rage clicks, dead clicks, and
error clicks. These arrive as OpenTelemetry spans, metrics, and logs.

### Does scout-react work with React Router, Next.js, Remix, or Docusaurus?

Yes. The route tracker subscribes to the History API, which every SPA
router uses. For SSR setups such as Next.js, Remix, Astro, and Docusaurus,
initialize Scout inside a `useEffect` or guard it with a `typeof window`
check so it runs only in the browser, never during SSR.

### How do I scrub PII before telemetry leaves the browser?

Pass a `beforeSend` callback to `Scout.initialize()`. It runs on every
span, metric, and log before export. Return `null` to drop the event, or
mutate the attributes object to redact specific fields such as
`user.email` or query-string tokens.

## What's next

- [Configure your collector](../../collector-setup/docker-compose-example.md)
  to receive OTLP-HTTP on `:4318`
- [React Native + React Web instrumentation reference](../../mobile/react-native.md)
- [Custom JavaScript browser instrumentation](../custom-instrumentation/javascript-browser.md)
  for manual span / metric / log emission
- [Query your RUM data in Scout](../../../operate/rum/getting-started.md) once
  sessions, errors, and Core Web Vitals are flowing

## References

- Package: [`@base-14/scout-react`](https://www.npmjs.com/package/@base-14/scout-react)
- Repository: [github.com/base-14/scout-react](https://github.com/base-14/scout-react)
- OpenTelemetry JS SDK: [opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)
- Web Vitals: [github.com/GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals)
