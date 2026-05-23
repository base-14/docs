---
title: React Native + React Web Instrumentation - Mobile + Browser RUM
sidebar_label: React Native
sidebar_position: 26
description:
  Auto-instrument React Native (iOS + Android) and React (browser) apps with
  the `@base-14/scout-react` SDK. Captures taps, navigation, errors, native
  crashes, HTTP, scroll, web vitals — exports OpenTelemetry traces, metrics,
  and logs to a Scout collector.
keywords:
  [
    react native opentelemetry,
    react native rum,
    react native crash reporting,
    react native distributed tracing,
    react native mobile observability,
    react web vitals,
    expo opentelemetry,
    kscrash react native,
    metrickit react native,
    babel plugin tap tracking,
    react native otlp exporter,
    scout-react,
  ]
---

# React Native + React Web

`@base-14/scout-react` is a single npm package that ships **zero-config
OpenTelemetry RUM** for three runtimes:

| Runtime | Entry import | Native bridge required? |
|---|---|---|
| **React Native (iOS + Android)** | `import Scout from '@base-14/scout-react/native'` | Yes — Expo module (auto-linked) |
| **React (web)** | `import Scout from '@base-14/scout-react'` | No |
| **React-on-web hooks** | `import { ScoutErrorBoundary } from '@base-14/scout-react/react'` | No |

The SDK auto-captures the full Real User Monitoring (RUM) event set
(except Session Replay and Profiling) and exports it as OTLP traces,
metrics, and logs to a Scout collector. No manual `Scout.track(...)`
calls anywhere in your app — every tap, navigation, HTTP request,
error, crash, scroll, and frame metric is gathered automatically.

## What You Get

| Capability | Signal Shape | Mechanism |
|---|---|---|
| Tap / press tracking | `user_interaction` span (`type=tap`, target, name_source, permanent_id, x/y) | Babel plugin wraps every `onPress` at build time |
| Web click tracking | `user_interaction` span (`type=click`, target.selector, composed_path_selector, width/height) | `document.addEventListener('click', …, capture)` |
| Frustration signals | `user_interaction.action.frustration.type` (`rage_click`, `dead_click`, `error_click`) | DOM mutation observer + error correlation (web only) |
| Screen / page navigation | `screen_view` ROOT span with `view.id`, `view.loading_type`, `view.referrer`, `view.is_active`, per-view counters | `@react-navigation` integration + `history` listener (web) |
| HTTP requests | `http.request` span with method / url / status / duration / size / provider classification / GraphQL parse | Wraps `fetch` + `XMLHttpRequest` globally |
| Errors | `error` span with `error.id`, `fingerprint`, `handling`, `source`, `causes_json`, `time_since_app_start_ms`, breadcrumbs | `ErrorUtils.setGlobalHandler` (RN) + `window.onerror` + `unhandledrejection` |
| Native crashes (iOS) | `native_crash` span with FAR/ESR registers, mach_exception, signal, NSException, callstack tree, binary images | KSCrash 2.5+ + MetricKit subscriber |
| Native crashes (Android) | `native_crash` span with NDK signal info, tombstone, ApplicationExitInfo subreason, PSS/RSS | Custom NDK signal handler (`scout_signal_handler.c`) + `ApplicationExitInfo` (API 30+) + JVM uncaught handler |
| Frame metrics (RN) | `react_native.frame.refresh_rate`, `slow_frames_rate`, `freeze_rate`, `frozen_frame` spans | rAF-based polling loop + `view.slow_frames_json` |
| Long tasks | `long_task` span with `id`, `duration`, `threshold` | `PerformanceObserver('longtask')` (web) + main-thread polling (RN) |
| ANRs | `anr` span with `duration`, `threshold` | Timer drift detector + iOS `MetricKit.didReceive` hang payloads |
| Scroll depth | `display.scroll.max_depth`, `max_depth_scroll_top`, `max_scroll_height`, `max_scroll_height_time_ms` on `screen_view` | `RN.ScrollView` lazy-getter wrap (RN) + `window.scroll` listener (web) |
| Web vitals | `web_vital` span with `name`, `value`, `rating` (LCP, INP, CLS, FCP, TTFB) | `web-vitals` library on web |
| CSP violations | `error` span with `error.csp.violated_directive`, `blocked_uri`, `disposition` | `securitypolicyviolation` event listener (web) |
| Page lifecycle | `view.page_states_json`, `view.in_foreground_periods_json` | `visibilitychange` + `freeze`/`resume` events (web), `AppState` (RN) |
| Session management | `session.id` UUID, `session.type: user`, `enduser.anonymous_id` persisted across sessions | AsyncStorage (RN) / localStorage (web) |
| Resource attributes | `service.*`, `device.*`, `os.*`, `network.*`, `a11y.*` (~20 a11y flags), `screen.*`, `viewport.*`, `application.current_locale` | Collected at init |
| Configurable batching | `traceExportIntervalMs`, `traceMaxQueueSize`, `traceMaxExportBatchSize`, `logExportScheduledDelayMs`, `metricExportIntervalMs`, `exportTimeoutMs` | OTel `BatchSpanProcessor` config |
| Retry with backoff | Exponential backoff + full jitter on network errors / 408 / 429 / 5xx; default 3 retries, 1s initial, 30s cap | Custom `wrapWithRetry` exporter wrapper |
| On-disk offline buffer | Persists retry-exhausted batches to AsyncStorage / localStorage; replays on init + on resume / online / `visibilitychange=visible` | Per-signal item caps (`offlineBuffer.maxItems.{traces,metrics,logs}`) |
| Background flush | Force-flush all in-flight batches on `AppState=background` / `visibilitychange=hidden` / `pagehide` | Lifecycle hook calls `Scout.flush()` |

## Prerequisites

- **React Native 0.74+** (Hermes recommended) for RN apps, or
  **React 18+** for web
- **Node 20 or 22** (for SDK build / Metro)
- **Xcode 15+** + CocoaPods for iOS, **Android Studio** + NDK r25+
  for Android
- **Scout Collector** reachable from your app — see
  [Docker Compose Setup](/instrument/collector-setup/docker-compose-example/)
  for local dev

### Compatibility Matrix

| Component | Minimum | Recommended |
|---|---|---|
| React | 18.0 | 18.3+ |
| React Native | 0.74 | 0.76+ |
| Expo SDK (if using) | 51 | 53+ |
| Node (build) | 20 | 22 |
| iOS deployment target | 13.0 | 16.0+ |
| Android `minSdkVersion` | 24 (Android 7.0) | 31+ (Android 12+) for ApplicationExitInfo |
| `@react-navigation/native` (optional, for screen tracking) | 6.0 | 6.1+ |

## Installation

```bash
npm install @base-14/scout-react
```

For React Native apps with the bare workflow:

```bash
cd ios && pod install && cd ..
```

For Expo workflow no extra step — the Expo module auto-links on `prebuild`.

### Upgrading

```bash
npm install @base-14/scout-react@latest
```

Or pin to a specific version:

```bash
npm install @base-14/scout-react@0.1.7
```

### Babel plugin (React Native only)

Tap tracking on React Native uses a Babel plugin that wraps every `onPress`
prop at compile time. Add it to `babel.config.js`:

```js title="babel.config.js"
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@base-14/scout-react/babel-plugin'],
  };
};
```

The plugin transforms:

```jsx
<Pressable onPress={handleTap} accessibilityLabel="Buy now" />
```

into:

```jsx
<Pressable onPress={(...$scoutArgs) => {
  if (typeof globalThis.__scoutTap === 'function') {
    globalThis.__scoutTap({
      componentName: 'Pressable',
      accessibilityLabel: 'Buy now',
      testID: undefined,
      children: undefined,
    }, $scoutArgs);
  }
  return handleTap && handleTap.apply(this, $scoutArgs);
}} accessibilityLabel="Buy now" />
```

This runs **before** any other JSX transform, so it catches every
`Pressable`, `TouchableOpacity`, `TouchableHighlight`,
`TouchableWithoutFeedback`, `TouchableNativeFeedback`, and `Button`
regardless of how they're imported.

## Initialization

### React Native

```ts title="index.js"
import Scout from '@base-14/scout-react/native';
import App from './App';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'http://localhost:34318',
  serviceVersion: '1.0.0',
});

Scout.registerRootComponent(App);
```

`registerRootComponent` is a drop-in replacement for Expo's
`registerRootComponent` (or RN's `AppRegistry.registerComponent`). It
wraps your root tree with `ScoutRootBoundary` so render errors become
`error` spans automatically.

### Navigation tracking (React Native)

Attach `@react-navigation`'s ref in `onReady`:

```tsx title="App.tsx"
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';

export default function App() {
  const navRef = useNavigationContainerRef();
  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => Scout.attachNavigationContainer(navRef)}
    >
      {/* … */}
    </NavigationContainer>
  );
}
```

The SDK buffers the navigationRef if `attachNavigationContainer` is called
before `Scout.initialize` resolves, and installs the tracker once init
completes — safe to call from `onReady` regardless of init timing.

### Web

```tsx title="main.tsx"
import Scout from '@base-14/scout-react';
import { ScoutErrorBoundary } from '@base-14/scout-react/react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import App from './App';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otel.example.com',
});

createRoot(document.getElementById('root')!).render(
  <ScoutErrorBoundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ScoutErrorBoundary>,
);
```

## Configuration

Every option you can pass to `Scout.initialize()`:

### Identity

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `string` | **required** | `service.name` resource attribute |
| `endpoint` | `string` | **required** | OTLP-HTTP collector URL (suffixes `/v1/{traces,metrics,logs}` appended automatically) |
| `serviceVersion` | `string` | `'1.0.0'` | `service.version` |
| `applicationId` | `string?` | — | Maps to `application.id` |
| `buildId` | `string?` | — | Build hash; maps to `app.build_id` |
| `secure` | `boolean` | `true` | Prefix `https://` when scheme is missing |

### Transport

| Field | Type | Default | Description |
|---|---|---|---|
| `headers` | `Record<string,string>` | `{}` | Extra HTTP headers (auth tokens, tenant IDs) |
| `firstPartyHosts` | `Array<string \| RegExp>` | `[]` | Hosts that get a `traceparent` injected for distributed tracing |
| `ignoreUrlPatterns` | `RegExp[]` | `[]` | URLs matching these are not auto-instrumented |

### Batching

| Field | Type | Default | Description |
|---|---|---|---|
| `traceExportIntervalMs` | `number` | `5000` | Trace flush interval |
| `traceMaxQueueSize` | `number` | `2048` | Max spans buffered before drop |
| `traceMaxExportBatchSize` | `number` | `512` | Max spans per HTTP POST |
| `metricExportIntervalMs` | `number` | `30000` | Metric reader interval |
| `logExportScheduledDelayMs` | `number` | `5000` | Log flush interval |
| `logMaxQueueSize` | `number` | `2048` | |
| `logMaxExportBatchSize` | `number` | `512` | |
| `exportTimeoutMs` | `number` | `30000` | Per-export HTTP timeout |

### Retry + Offline

| Field | Type | Default | Description |
|---|---|---|---|
| `exportRetry.maxRetries` | `number` | `3` | Retries per batch on retryable failures (5xx / 408 / 429 / network). `0` disables. |
| `exportRetry.initialDelayMs` | `number` | `1000` | First retry backoff |
| `exportRetry.maxDelayMs` | `number` | `30000` | Cap on exponential backoff |
| `offlineBuffer.enabled` | `boolean` | `true` | Persist retry-exhausted batches to disk |
| `offlineBuffer.maxItems.traces` | `number` | `5000` | FIFO item cap |
| `offlineBuffer.maxItems.metrics` | `number` | `2000` | |
| `offlineBuffer.maxItems.logs` | `number` | `5000` | |
| `maxOfflineStorageMb` | `number` | `5` | Coarse total-disk cap that runs alongside the per-signal item caps. Lower priority than `offlineBuffer.maxItems.*`. |

### Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionTimeoutMinutes` | `number` | `30` | Inactivity before new session |
| `sessionSampleRate` | `number (0-100)` | `100` | Per-session binary sampling rate. Below `100`, full sessions are dropped (never partial) so traces stay coherent. |

### Thresholds

| Field | Type | Default | Min | Description |
|---|---|---|---|---|
| `longTaskThresholdMs` | `number` | `100` | `20` | JS task duration that qualifies as a `long_task` span. Below `20` is clamped up. |
| `anrThresholdMs` | `number` | `5000` | `1000` | Main-thread block duration that fires an `anr` span. Below `1000` is clamped up. |

### Resource attributes

| Field | Type | Description |
|---|---|---|
| `resourceAttributes` | `Record<string, string \| number \| boolean>` | Extra attrs merged into every signal's `Resource` block (e.g. `deployment.region`, `team`). Static — set once at init, never re-evaluated. |

### Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. **All default
to `true`** except `captureConsole` / `capturePrintStatements`.

| Toggle | Default | What you lose when set to `false` |
|---|---|---|
| `enableAutoTapTracking` | `true` | All `user_interaction` spans (taps on RN, clicks on web). Babel-plugin compile-time wrap still runs but the runtime hook is inert. |
| `enableErrorTracking` | `true` | `error` spans from `FlutterError.onError` / `window.onerror` / `unhandledrejection` / `ErrorUtils.setGlobalHandler`. Manual `Scout.reportError(…)` still works. |
| `enableLifecycleTracking` | `true` | `app_paused`/`app_resumed` spans, background flush, screen_view ROOT span end on background. Heavy loss — recommend leaving on. |
| `enableStartupTracking` | `true` | `app_startup` span (cold + warm start measurement). |
| `enableConnectivityTracking` | `true` | `network.connection.type`, `network.cellular.carrier_name` resource attrs and changes on network transitions. |
| `enablePerformanceMetrics` | `true` | `react_native.memory.usage` metric, generic perf samples. |
| `enableLongTaskDetection` | `true` | `long_task` spans (use `longTaskThresholdMs` to tune sensitivity instead of disabling). |
| `enableAnrDetection` | `true` | `anr` spans, iOS hang watchdog, Android ANR detector. |
| `enableFrameMetrics` | `true` | `react_native.frame.refresh_rate` / `slow_frames_rate` / `freeze_rate` metrics + `frozen_frame` spans + `view.slow_frames_json` attribute. |
| `enableMemoryMetrics` | `true` | RN-only process memory polling. |
| `enableWebVitals` | `true` | Web-only LCP / INP / CLS / FCP / TTFB spans. |
| `enableBatteryTracking` | `true` | `device.battery.level` / `device.battery.state` on every span. |
| `enableNetworkTracking` | `true` | `http.request` spans, fetch/XHR wrap, GraphQL parse, provider classification, `traceparent` injection. |
| `enableLogging` | `true` | `Scout.log*()` calls become no-ops (or the OTel log pipeline never gets created). |
| `captureConsole` | `false` | (Off by default) When true, mirrors `console.log/info/warn/error/debug` to OTLP logs. Original `console` output is preserved. |
| `capturePrintStatements` | `false` | Alias of `captureConsole` for Flutter-flavored naming consistency. |

### Filtering

| Field | Type | Description |
|---|---|---|
| `beforeSend` | `(event) => event \| null` | Runs on every span / metric / log before export. Return `null` to drop. Mutate the passed object to redact PII. **Sees per-span attributes only; resource attributes set on the OTel `Resource` (e.g. `service.name`, `os.name`, `device.*`) are not in the event payload.** |

## Identifying the user and setting custom attributes

Once `Scout.initialize(...)` has resolved you can attach identity, account,
feature-flag, and free-form attributes that **ride on every subsequent span,
metric, and log** until you change or clear them. Five APIs cover the common
cases:

### `Scout.setUser(id, attributes?)` — end-user identity

```ts
Scout.setUser('user-123', {
  email: 'jane@example.com',
  name: 'Jane Doe',
  plan: 'pro',
  signupDate: '2025-08-14',
});
```

Maps to OpenTelemetry semantic-convention attributes — `enduser.id` is the
primary key; everything else in the `attributes` map is prefixed
`enduser.<key>` so it lands as `enduser.email`, `enduser.plan`, etc. Errors
and crashes captured after this call carry these attributes automatically —
your dashboard can filter "errors for users on plan=pro."

### `Scout.setAccount(id, name?)` — B2B tenant

```ts
Scout.setAccount('acme-corp', 'Acme Corp');
```

For multi-tenant apps. Emits `account.id` and (optionally) `account.name`.
Useful for grouping sessions by tenant in dashboards.

### `Scout.setFeatureFlag(name, value)` — flag values at error time

```ts
Scout.setFeatureFlag('new-checkout', true);
Scout.setFeatureFlag('checkout-variant', 'B');
```

Each flag becomes a `feature_flag.<name>` attribute. The killer use case:
when an error span is emitted, the flag values **active at error time** are
attached to it, so you can correlate "this crash only happens when
`new-checkout=true`."

### `Scout.setRuntimeAttribute(key, value)` — free-form session attribute

This is the general-purpose hook for any custom attribute you want on every
signal in this session — A/B experiments, app theme, route prefix, current
locale, anything that doesn't fit the named APIs above.

```ts
Scout.setRuntimeAttribute('experiment.cohort', 'B');
Scout.setRuntimeAttribute('app.theme', 'dark');
Scout.setRuntimeAttribute('subscription.tier', 'pro');
```

The key is used verbatim as the attribute name — no namespacing — so you
control the schema. Supported value types: `string`, `number`, `boolean`, or
arrays of those.

### `Scout.addBreadcrumb(type, message)` — action trail (not an attribute, related)

Not strictly an attribute, but related: every breadcrumb you record lands in
a ring buffer that gets serialized onto every subsequent `error` /
`app_crash` / `native_crash` span. Useful for "what did the user do in the
20 actions before this crash?"

```ts
Scout.addBreadcrumb('checkout', 'added item to cart');
Scout.addBreadcrumb('navigation', 'screen: /payment');
```

### Removing attributes

| To remove | Call |
|---|---|
| The user identity (and all `enduser.*` attributes) | `Scout.clearUser()` |
| The B2B account identity | `Scout.clearAccount()` |
| A single feature flag | `Scout.setFeatureFlag(name, null)` |
| All feature flags at once | `Scout.clearFeatureFlags()` |
| A single runtime attribute | `Scout.setRuntimeAttribute(key, null)` (`null` or `undefined` deletes the key) |
| All breadcrumbs (rarely needed) | They roll out of the ring buffer naturally; no explicit clear |

A typical sign-out flow:

```ts
async function signOut() {
  await api.signOut();
  Scout.clearUser();
  Scout.clearAccount();
  Scout.clearFeatureFlags();
  Scout.setRuntimeAttribute('experiment.cohort', null);
}
```

### Lifetime and persistence

These attributes live in memory for the SDK instance — i.e., **for the
lifetime of the session**. They are NOT persisted across app restarts. If
you want a user identity to be reattached on every launch, call
`Scout.setUser(...)` again in your initialization code (typically inside a
`useEffect` that re-reads from your auth store).

The OpenTelemetry session lifecycle (the `session.id` resource attribute)
rotates after `sessionTimeoutMinutes` of inactivity (default 30 min) — but
user / account / runtime attributes you set survive that rotation as long
as the JS context is alive.

## Native crash setup

### iOS (KSCrash + MetricKit)

The Expo module auto-installs **KSCrash 2.5+** with all five monitors:

- Mach exceptions
- POSIX signals
- C++ exceptions
- NSExceptions
- Main-thread deadlocks

Plus a **MetricKit** subscriber that collects delayed crash + hang
diagnostic payloads the OS delivers asynchronously, up to 24 h after
the event.

On the next launch after a crash, both pipelines drain into the same
`native_crash` span with full attribute coverage:

```text
crash.type:                 mach
crash.reason:               EXC_BREAKPOINT
crash.mach_exception:       EXC_BREAKPOINT
crash.mach_code:            KERN_INVALID_ADDRESS
crash.signal:               SIGTRAP
crash.signal_code:          0
crash.cpu_arch:             arm64
crash.os_name:              iOS
crash.os_version:           17.5
crash.kernel_version:       Darwin Kernel Version 24.5.0...
crash.device_model:         iPhone17,2
crash.machine:              arm64e
crash.build_type:           debug
crash.report_id:            04446A8C-65BC-486C-A7CD-F7A65DAB797B
crash.stack_trace:          libswiftCore.dylib 0x… $ss17_assertionFailure…
crash.registers_json:       { "basic": { "pc": …, "lr": …, "sp": …, "fp": …,
                              "x0": …, …, "x29": … },
                              "exception": { "far": …, "esr": …, "exception": 0 } }
crash.binary_images_json:   [ { "name": …, "uuid": …, "image_addr": …, … }, … ]
crash.callstack_tree_json:  [ { "thread_id": …, "crashed": true, "backtrace": … }, … ]
```

The **FAR** (Fault Address Register) and **ESR** (Exception Syndrome
Register) values are the gold standard for ARM64 fault diagnosis —
they tell the backend exactly what memory access caused the fault.

### Android (NDK signal handler + ApplicationExitInfo)

The plugin ships:

- A **custom NDK signal handler** in `android/src/main/cpp/scout_signal_handler.c`
  that catches `SIGSEGV` / `SIGABRT` / `SIGBUS` / `SIGFPE` / `SIGILL`
  / `SIGTRAP` and writes a JSON report to disk before re-raising.
- A **JVM uncaught exception handler** for Kotlin / Java crashes.
- An **`ApplicationExitInfo` collector** (Android 11 / API 30+) that
  drains every historical process death reason — including ANRs, OOM
  kills, low-memory kills, user force-stops — with tombstone payload
  and (on API 31+, via reflection) the `subReason` int.

Resulting attributes:

```text
crash.type:                 native_crash | jvm_exception | anr | low_memory | …
crash.reason:               signal name or exception message
crash.signal:               SIGSEGV (signal source only)
crash.signal_code:          SEGV_MAPERR
crash.signal_address:       0x0
crash.tombstone:            (truncated to 32 KB) full Android tombstone text
crash.subreason:            12 (e.g. SUBREASON_TOO_MANY_EMPTY)
crash.exit_status:          139
crash.importance:           300
crash.pss_kb:               125440
crash.rss_kb:               145200
crash.death_timestamp_ms:   1747469392458
crash.process_name:         com.example.myapp
crash.pid / .tid / .uid
crash.abi:                  arm64-v8a
crash.build_fingerprint:    google/sdk_gphone64_arm64/...
crash.kernel:               Linux version 5.15.…
crash.process_uptime_secs:  847
crash.last_screen:          OrderDetailScreen
crash.registers / .memory_map  (NDK path only)
```

## React Native lifecycle integration

The SDK installs an `AppState` listener that:

1. **On `background` / `inactive`** — ends the active `screen_view` ROOT
   span (so its decorated `display.scroll.*`, `view.slow_frames_json`,
   `view.page_states_json` attrs flush), emits an `app_paused` span,
   and force-flushes every batch processor so taps emitted in the last
   few seconds don't die with the OS suspending the process.
2. **On `active`** — rotates session if inactivity timeout elapsed,
   restarts the `screen_view` ROOT for the current route (so spans
   after resume are properly parented), emits `app_resumed`, drains
   the offline buffer.

The fire-and-forget initialization means `Scout.initialize()` never
blocks the host UI even if the collector is unreachable or init
internally throws — the host app renders normally and telemetry just
no-ops.

## What happens when export fails

Three layers of resilience, in order:

1. **Retry with jitter**: `wrapWithRetry` wraps every OTLP exporter.
   On a retryable failure (network error / 408 / 429 / 5xx), the batch
   is re-sent after exponential backoff with full jitter (configurable
   via `exportRetry`). Permanent 4xx failures (400 / 401 / 403) drop
   immediately so we don't waste retries.

2. **On-disk offline buffer**: after `maxRetries` exhausts, the batch
   is serialized to OTLP-compliant JSON via
   `@opentelemetry/otlp-transformer` and persisted to AsyncStorage
   (RN) / localStorage (web) under per-signal keys. Per-signal FIFO
   caps (`offlineBuffer.maxItems`) bound storage.

3. **Replay on next opportunity**: persisted batches are drained when:
   - `Scout.initialize()` resolves
   - On RN, `AppState` transitions to `active`
   - On web, `visibilitychange → visible` or `online` fires

   The replay POSTs each batch directly via `fetch` (using your
   configured `headers` so auth still applies) and stops on the first
   failure, leaving the remaining batches on disk for the next attempt.

What's still lost:

- Process killed before a batch is even queued (very rare).
- Disk write fails (`QuotaExceededError` on web, sandbox issues on RN) —
  the batch is silently dropped.
- Storage cap is hit during a long outage — oldest items evict first;
  your most-recent telemetry survives.

## Running the example app

The repo ships a runnable Expo example at
`examples/platform-design-mobile`. Its `package.json` depends on the
published SDK (`"@base-14/scout-react": "^0.1.7"`):

```bash
git clone https://github.com/base-14/scout-react.git
cd scout-react/examples/platform-design-mobile
npm install
# iOS sim
npx expo run:ios
# Android emulator / device
npx expo run:android
```

Tap around — every interaction generates spans. The example points at
`http://localhost:34318` by default; edit `App.tsx` if your collector
lives elsewhere. For Android, also run
`adb reverse tcp:34318 tcp:34318` so the emulator can reach the
collector on the host.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bundle JS error: `globalThis.__scoutTap?.call is not a function` | Babel plugin not picked up by Metro cache | Restart Metro with `--clear` |
| Taps captured as `target: "pressable"` / `target.type: "Component"` with same `permanent_id` every time | The responder system is intercepting at the wrong layer | Make sure the babel plugin is in `babel.config.js` (not just the deprecated runtime patch) |
| `scout_anonymous_id` not present | First launch; `AsyncStorage` write failed silently | Verify file system permissions; check device storage isn't full |
| No `screen_view` spans | `attachNavigationContainer(navRef)` never called | Add it to `NavigationContainer.onReady` |
| No `display.scroll.*` attrs | App was on the same screen when backgrounded (root span never ended) | The bg-flush hook ends it on background; otherwise navigate to flush |
| iOS sim: `Failed to load script` red box | `adb reverse`-style port forwarding missing | iOS sim shares host network — no extra step needed; check Metro on port 8081 |
| Android: `localhost` unreachable from app | Android emulator doesn't share host network like iOS sim | `adb reverse tcp:8081 tcp:8081` and `adb reverse tcp:34318 tcp:34318` |
| `dist/` not found inside `node_modules/@base-14/scout-react` | Corrupt install, partial download | `rm -rf node_modules package-lock.json && npm install` |
| Web: `Scout.flush()` doesn't drain anything | Page already navigated; service worker may be intercepting | Use `pagehide` listener (already wired internally) |

## Performance considerations

- **Tap spans**: ~0.5 ms per tap (synchronous fiber walk for
  descriptor extraction, async OTLP queue).
- **Span size**: ~5 KB per scout-react span average — ~3-5× the
  typical backend span because of rich RUM context (battery, network,
  a11y, device, session, enduser, screen).
- **Default trace flush**: 5 s — at 100 spans/s a busy app generates
  ~500 KB/flush. Tune `traceExportIntervalMs` +
  `traceMaxExportBatchSize` for your traffic shape.
- **Offline buffer**: default 5000 trace items ≈ 25 MB worst case on
  disk. Drop to `traces: 2000` (10 MB) for low-end Android.
- **Babel plugin overhead**: zero runtime cost — the wrapping happens
  at compile time.

## Security considerations

- **PII redaction**: use the `beforeSend` callback to scrub fields before export:

  ```ts
  beforeSend: (event) => {
    delete event['enduser.email'];
    delete event['http.url']; // if it contains tokens in query string
    return event;
  }
  ```

- **No silent SDK failure logging in production**:
  `Scout.initialize()` rejections are silently caught by the example
  app's fire-and-forget pattern. Don't propagate them to the
  user-facing error UI.

- **Headers contain credentials**: anything you pass in `headers` (e.g.
  Authorization Bearer tokens) is replayed on offline-buffer drain too.
  Use short-lived tokens or rotate frequently.

- **Anonymous user ID is persistent**: stored in `${ApplicationDocuments}/scout_anonymous_id`
  (RN) or `localStorage` (web). Clear it on logout if your use case
  requires it.

## FAQ

**Does scroll tracking work on FlatList?**

Yes. The SDK patches `RN.ScrollView`'s lazy getter at module load —
since `FlatList → VirtualizedList → ScrollView`, every list's
`onScroll` flows through the same observer. Custom `ScrollView`
subclasses you don't pull from `react-native` won't be tracked.

**Will the babel plugin break my existing `onPress` handlers?**

No. The plugin's wrapper preserves `this` binding, forwards all
arguments, returns the original handler's return value, and uses a
`typeof === 'function'` guard so the call short-circuits cleanly when
the SDK isn't loaded.

**What if I'm on React Native 0.71 (old architecture)?**

Mostly fine. The babel plugin works on any React/Babel version >= 7.
The `ScrollView` lazy-getter patch relies on RN's `react-native/index.js`
using lazy `get`-based exports — this has been the case since RN 0.60.
KSCrash 2.5+ requires iOS 13.0 minimum.

**Can I use this with React Navigation v6 AND v7?**

Yes. The integration depends only on `NavigationContainerRef`'s
`addListener('state', fn)` API which is stable across both major
versions.

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Look at [Flutter mobile instrumentation](/instrument/mobile/flutter)
  for the Dart equivalent

## References

- Repository: [github.com/base-14/scout-react](https://github.com/base-14/scout-react)
- OpenTelemetry JS SDK: [opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js)
- KSCrash: [kstenerud/KSCrash](https://github.com/kstenerud/KSCrash)
- MetricKit overview: [Apple Developer docs](https://developer.apple.com/documentation/metrickit)
- ApplicationExitInfo: [Android Developer docs](https://developer.android.com/reference/android/app/ApplicationExitInfo)
