---
title: Android Instrumentation - Native Kotlin RUM with scout-android
sidebar_label: Android
sidebar_position: 21
description:
  Android OpenTelemetry RUM for native Kotlin/Java apps with the
  scout-android SDK. Captures taps, screens, crashes, ANR, HTTP, and
  frame metrics as traces.
keywords:
  [
    android opentelemetry,
    android rum,
    android crash reporting,
    android ndk crash,
    application exit info,
    android anr detection,
    jetpack compose observability,
    android distributed tracing,
    android otlp exporter,
    scout-android,
  ]
---

# Android

`scout-android` is a native Kotlin SDK that ships **zero-config
OpenTelemetry RUM** for Android. One `Scout.initialize(...)` call
auto-captures the full Real User Monitoring event set — taps, screens,
crashes, ANR, jank, startup, lifecycle — and exports it as OTLP traces,
metrics, and logs to a Scout collector.

```kotlin
Scout.initialize(
  this,
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
  ),
)
```

That's the only code you write. Every tap, screen view, crash, ANR,
frozen frame, and startup is gathered automatically — no manual
`Scout.track(...)` calls anywhere in your app. HTTP tracking is the one
opt-in (add one OkHttp interceptor — see below).

## What You Get

| Capability | Signal | Mechanism |
|---|---|---|
| Screen / navigation | `screen_view` (long-lived **root span**) + `screen_load` + `view_session` | `ActivityLifecycleCallbacks` (250 ms post-resume debounce); Compose via `NavController.trackScoutScreens()`. Root span is resurrected on the next launch if the process dies mid-screen |
| App startup | `app_startup` span with `app.startup.type = cold \| warm` | Cold: `Process.getStartUptimeMillis()` → first resume. Warm: `onStart` |
| FBC vital (First Build Complete) | `app_vital` span with `vital.name = fbc` | Emitted from cold start; ready as a first-class dashboard vital |
| INV vital (Interaction → Next View) | `app_vital` span with `vital.name = inv` | Tap timestamp correlated with the next `screen_view` within 5 s |
| Lifecycle | `app_lifecycle.changed` (`device.app.lifecycle.resumed` / `.paused`) | `ProcessLifecycleOwner`; also drives session foreground/background |
| Tap tracking | `user_interaction` span (`ui.type = tap`, target, name source, x/y) | `Window.Callback` wrap intercepting `ACTION_UP`. Label resolved from Compose semantics (contentDescription / text / testTag) or the View tree (contentDescription → resource id → `TextView` text → class name) |
| HTTP requests | `http.request` CLIENT span with method, URL, status, duration | `ScoutOkHttpInterceptor` — **opt-in**: add it to your `OkHttpClient`. Injects a W3C `traceparent` on first-party hosts |
| Errors (handled) | `error` span with `error.fingerprint`, breadcrumbs | `Scout.reportError(...)` |
| JVM crashes | `app_crash` span with `error.type`, `error.stack_trace`, `error.fingerprint`, `crash.last_screen`, breadcrumbs | `Thread.setDefaultUncaughtExceptionHandler` persists synchronously; replayed on next launch |
| Native crashes | `native_crash` span with signal info, registers, stack, memory map, binary images (ELF build-ids) | Custom NDK signal handler (`libscout_crash`) + `ApplicationExitInfo` (API 30+). Each OS death is reported exactly once (persisted watermark); normal exits (swipe-away, Force Stop, `exit()`) are never reported as crashes |
| ANR | `anr` span with thread dump + breadcrumbs | Main-thread watchdog (`scout-anr-watchdog`, polls at `anrThresholdMs / 5`, clamped 200-1000 ms) + `ApplicationExitInfo` `REASON_ANR` post-mortem tombstone |
| Jank | `long_task` (≥ `longTaskThresholdMs`) + `frozen_frame` (≥ `frozenFrameThresholdMs`) | AndroidX `JankStats` per Activity window |
| Memory (opt-in) | `android.memory.usage` gauge (`By`) | `scout-metrics` thread polling every `vitalsCollectionIntervalSeconds` (60 s). Off by default (`enableMemoryMetrics`) |
| CPU (opt-in) | `android.cpu.usage` gauge (`%`) | Reads `/proc/self/stat`. Off by default (`enableCpuMetrics`) |
| Frame (opt-in) | `android.frame.build_time` gauge (`ms`) | Drains `FrameStats` averages. Off by default (`enableFrameMetrics`) |
| Device / network context | `network.connection.type`, device attributes | `DynamicAttributes` + `DeviceResources` as resource attributes (always on) |
| Logs | OTLP logs | `Scout.log*()` |
| Anonymous user id | `user.anonymous_id` on every span | UUID minted on first launch, persisted |

## Prerequisites

| Requirement | Version |
|---|---|
| `minSdkVersion` | ≥ 26 (`ApplicationExitInfo` features activate from API 30+) |
| `compileSdkVersion` | 35 |
| Android Gradle Plugin | ≥ 8.0 |
| Gradle | ≥ 7 |
| JDK | 17 |
| NDK (bundled native crash handler) | 27.1.12297006 |
| CMake | 3.22.1 |

The native signal handler ships as a prebuilt `libscout_crash` inside
the artifact for `arm64-v8a`, `x86_64`, `armeabi-v7a`, and `x86` — no
NDK setup is required in your app.

## Installation

`scout-android` is published on Maven Central. Add `mavenCentral()` to
your repositories and the dependency to your module:

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
  repositories {
    google()
    mavenCentral()
  }
}

// app/build.gradle.kts
dependencies {
  implementation("io.base14:scout-android:0.1.6")
}
```

`scout-android` re-exports `scout-core` transitively (`api(...)`) — you
do not add `scout-core` yourself.

## Initialization

Initialize once, as early as possible — in your `Application.onCreate()`
so the crash handler is armed and cold-start timing is anchored before
the first Activity:

```kotlin
import android.app.Application
import io.base14.scout.android.Scout
import io.base14.scout.core.ScoutConfig

class MyApp : Application() {
  override fun onCreate() {
    super.onCreate()
    Scout.initialize(
      this,
      ScoutConfig(
        serviceName = "my-app",
        serviceVersion = "1.0.0",
        endpoint = "https://otel.example.com",
        headers = mapOf("Authorization" to "Bearer …"),
      ),
    )
  }
}
```

`initialize` is **idempotent** — a second call is a no-op. Read-only
state is available on `Scout`: `isInitialized`, `sessionId`, `userId`,
`anonymousId`.

### Screen tracking with Compose Navigation

Activity screens are tracked automatically. For Compose Navigation,
attach the tracker to your `NavController` so route changes emit
`screen_view`:

```kotlin
val navController = rememberNavController()
navController.trackScoutScreens()
```

You can also set the current screen manually at any time —
`Scout.setScreen("Checkout")` switches the screen tracker to manual
mode.

### HTTP tracking (opt-in)

HTTP is the one signal you wire up. Add `ScoutOkHttpInterceptor` to your
client:

```kotlin
val client = OkHttpClient.Builder()
  .addInterceptor(ScoutOkHttpInterceptor())
  .build()
```

It emits an `http.request` span per call, skips the collector endpoint
and any `ignoreUrlPatterns`, and injects a W3C `traceparent` header on
hosts listed in `firstPartyHosts`.

### Setting user identity

```kotlin
Scout.setUser(
  id = "user-123",
  attributes = mapOf(
    "email" to "jane@example.com",
    "plan" to "pro",
  ),
)

// On logout:
Scout.clearUser()
```

`user.id` and every attribute ride on every span until cleared.

### Setting session attributes

```kotlin
Scout.setSessionAttributes(mapOf("tenant" to "acme", "ab_bucket" to "B"))
Scout.clearSessionAttributes()
```

They attach to every subsequent span, metric, and log for the rest of
the session, and persist until cleared.

## Configuration

`ScoutConfig` is the single config object. `serviceName` and `endpoint`
are the only **required** fields; everything else has a sensible
default.

### Identity

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `String` | **(required)** | Logical app identifier. Used as `service.name`. Must be non-blank. |
| `endpoint` | `String` | **(required)** | OTLP-HTTP collector URL. `/v1/traces`, `/v1/metrics`, `/v1/logs` are appended automatically. Must be non-blank. |
| `serviceVersion` | `String?` | `null` | Maps to `service.version`. Auto-detected if null. |
| `environment` | `String?` | `null` | Deployment environment (e.g. `production`). |
| `headers` | `Map<String, String>` | `{}` | Extra HTTP headers on every OTLP export. Use for auth. |
| `resourceAttributes` | `Map<String, String>` | `{}` | Extra attributes merged into every signal's `Resource`. |

### Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionSampleRate` | `Double (0-100)` | `1.0` | Percent of sessions sampled — default **1%**. Decided once per session; a sampled session sends everything (spans, metrics, logs), an unsampled one sends nothing. |
| `alwaysCaptureErrors` | `Boolean` | `true` | Error / crash / ANR-class spans bypass `sessionSampleRate` and are always exported. |
| `sessionTimeoutMinutes` | `Int` | `30` | Inactivity timeout before a new `session.id` is minted. |
| `maxSessionDurationMinutes` | `Int` | `60` | Hard cap on session lifetime. |

### Network

| Field | Type | Default | Description |
|---|---|---|---|
| `firstPartyHosts` | `List<String>` | `[]` | Hosts that receive a W3C `traceparent` header. Supports exact match or `*.host` wildcards. |
| `ignoreUrlPatterns` | `List<String>` | `[]` | URL substrings excluded from HTTP tracking. |

### Thresholds

| Field | Type | Default | Description |
|---|---|---|---|
| `anrThresholdMs` | `Long` | `5000` | Main-thread block duration that fires an `anr` span. |
| `longTaskThresholdMs` | `Long` | `100` | Frame duration that qualifies as a `long_task`. |
| `frozenFrameThresholdMs` | `Long` | `700` | Frame duration that qualifies as a `frozen_frame`. |

### Batching & export (applies to spans, metrics, AND logs)

| Field | Type | Default | Description |
|---|---|---|---|
| `exportIntervalSeconds` | `Int` | `30` | One export cadence for spans, metrics, and logs (coerced ≥ 1). |
| `maxExportBatchSize` | `Int` | `512` | Max items per export batch, per signal. |
| `maxQueueSize` | `Int` | `2048` | Max items buffered awaiting export; overflow is dropped. |
| `maxRetries` | `Int` | `0` | Delivery attempts after a failed export. Default **0 = at-most-once**. |
| `metricExportIntervalSeconds` | `Int?` | `null` | Metrics-only override of `exportIntervalSeconds`. |
| `vitalsCollectionIntervalSeconds` | `Int` | `60` | How often memory/CPU/frame gauges are polled (when enabled). |

### Per-metric switches

The SDK ships **no metrics by default** — each gauge is opt-in.

| Field | Default | Description |
|---|---|---|
| `enableMetrics` | `true` | Master switch for the metrics pipeline. Individual gauges still need their own switch below. |
| `enableMemoryMetrics` | `false` | `android.memory.usage` gauge. |
| `enableCpuMetrics` | `false` | `android.cpu.usage` gauge. |
| `enableFrameMetrics` | `false` | `android.frame.build_time` gauge. |

### Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. Span and log
instrumentation defaults to **on**; metric collection defaults to
**off** (see [Per-metric switches](#per-metric-switches)).

| Toggle | Default | What you lose when `false` |
|---|---|---|
| `enableScreenTracking` | `true` | `screen_view` / `screen_load` / `view_session` spans. |
| `enableTapTracking` | `true` | All `user_interaction` spans. |
| `enableHttpTracking` | `true` | `http.request` spans from `ScoutOkHttpInterceptor`. |
| `enableErrorTracking` | `true` | `error` spans — including manual `Scout.reportError(...)` calls, which become no-ops. |
| `enableCrashTracking` | `true` | JVM `app_crash` + NDK `native_crash` + `ApplicationExitInfo` fallback. |
| `enableAnrTracking` | `true` | `anr` spans (watchdog + tombstone). |
| `enableJankTracking` | `true` | `long_task` / `frozen_frame` spans. |
| `enableLifecycleTracking` | `true` | `app_lifecycle.changed` spans and the session foreground/background transitions they drive. |
| `enableStartupTracking` | `true` | `app_startup` spans and the FBC vital. |
| `enableLogging` | `true` | `Scout.log*()` calls become no-ops. |

### Offline buffer

Offline buffering is **fully disabled by default** — nothing is written
to disk, and a batch that fails to export is dropped (strict
at-most-once delivery).

| Field | Type | Default | Description |
|---|---|---|---|
| `offlineBufferEnabled` | `Boolean` | `false` | Master toggle. Persist failed batches and replay them on next `initialize()` or connectivity change. |
| `offlineMaxTraceItems` | `Int` | `0` | Accepted, not yet enforced. |
| `offlineMaxMetricItems` | `Int` | `0` | Accepted, not yet enforced. |
| `offlineMaxLogItems` | `Int` | `0` | Accepted, not yet enforced. |
| `maxOfflineStorageMb` | `Int` | `5` | Accepted, not yet enforced. |

The four cap fields are part of the config surface but nothing reads
them yet. When `offlineBufferEnabled` is on, the persisted queue is
bounded by `maxQueueSize` and `maxExportBatchSize` — the same limits the
in-memory path uses. Size the buffer with those.

### Diagnostics

| Field | Type | Default | Description |
|---|---|---|---|
| `debugLogging` | `Boolean` | `false` | Print SDK-internal export logging to Logcat. Use it to confirm batches are leaving the device; leave it off in release builds. |

### Filtering — `beforeSend`

```kotlin
ScoutConfig(
  // …
  beforeSend = { name, attributes ->
    // Mutate attributes to scrub; return false to drop the signal.
    attributes.remove("user.email")
    val isHealthCheck = (attributes["http.url"] as? String)
      ?.contains("/health") == true
    !isHealthCheck
  },
)
```

`beforeSend` runs synchronously on every span / metric / log before
export. It sees per-signal attributes — resource attributes
(`service.name`, `os.*`, `device.*`) are not in the payload.

## Native crash setup

No app-side setup is required — the JVM handler, the NDK signal handler,
and the `ApplicationExitInfo` reader all install automatically inside
`Scout.initialize`.

### JVM crashes

A `Thread.setDefaultUncaughtExceptionHandler` (chaining any previous
handler) catches uncaught exceptions on **any** thread, persists a
report synchronously (`error.type`, `error.message`, `error.stack_trace`,
`error.fingerprint`, `crash.last_screen`, breadcrumbs) before the
process dies, and replays it as an `app_crash` span on the **next
launch**.

### Native (NDK) crashes

A custom in-process signal handler (`libscout_crash`) catches SIGSEGV /
SIGABRT / SIGBUS / SIGILL / SIGFPE, writes a compact report to
`cacheDir` (signal info, registers, stack, memory map, binary images
with ELF build-ids), and emits it as a `native_crash` span on the next
launch.

### ApplicationExitInfo fallback (API 30+)

On Android 11+, scout-android reads
`ActivityManager.getHistoricalProcessExitReasons` and emits a span for
any OS-recorded death newer than a persisted watermark — **each death
exactly once across launches**. `REASON_CRASH_NATIVE` → `native_crash`,
`REASON_CRASH` → `app_crash`, `REASON_ANR` → `anr` (with a tombstone
thread dump, capped at 128 KB). Benign exits (`user_requested`,
`user_stopped`, `exit_self`) are filtered out. This catches deaths the
OS killed before in-process handlers could run (OOM, hard watchdog).

Because crashes drain on the **next** launch, to test: trigger a real
fault, relaunch the app, then check the collector.

## Manual API

Every method is `@JvmStatic` and a no-op if the SDK is not initialized.

| Method | Purpose |
|---|---|
| `setScreen(name)` | Set the current screen (switches to manual mode). |
| `setUser(id, attributes = {})` / `setUserAttributes(attributes)` / `clearUser()` | User identity. |
| `setAccount(id, name = null)` / `clearAccount()` | Account / org context. |
| `setFeatureFlag(name, value)` / `clearFeatureFlags()` | Feature-flag values. |
| `setSessionAttributes(attributes)` / `clearSessionAttributes()` | Session attributes. |
| `addBreadcrumb(type, message)` / `setBreadcrumbs(list)` | Breadcrumb trail. |
| `reportError(throwable, handled = true)` | Report an error from a `Throwable` (`error` span). |
| `reportError(type, message, stackTrace)` | Report an error from string fields. |
| `logDebug / logInfo / logWarning / logError(message, attributes = {})` | Emit a log at that level. |
| `log(level, message, attributes = {})` | Emit a log at an explicit `ScoutLogLevel`. |
| `logEvent(name, attributes = {})` | Emit a named custom event. |
| `addTiming(name)` | Record a named timing marker. |
| `startVital(name)` / `endVital(name, description = null)` | Custom vital measurement. |
| `recordOperationStep(name, step, key = null, failureReason = null)` | Step in a multi-step operation. |
| `reportHttp(method, url, statusCode, startEpochNanos, endEpochNanos)` | Manually emit an `http.request` span. |
| `reportLongTask(durationMs)` | Manually emit a `long_task` span. |
| `reportTap(target, targetType, x, y)` | Manually emit a `user_interaction` span. |
| `emitGauge(name, value, unit)` | Emit a custom gauge metric. |
| `recordScreenLoad(name, durationMs)` / `recordViewSession(name, durationMs)` | Timing spans. |
| `recordSpan(name, durationMs, attributes = {})` | Emit an arbitrary named span. |

## What happens when export fails

Delivery is **at-most-once by default** (`maxRetries = 0`): a batch gets
one attempt, and a failed batch is dropped rather than risking a
duplicate delivery. A retried timeout whose first request the collector
already ingested would store the same events twice.

A batch counts as delivered only on an HTTP 2xx. Any other status, or a
transport exception, is a failure.

| Failure | What Scout does (defaults) |
|---|---|
| Any export failure, `maxRetries = 0` (default) | One attempt; batch dropped. No duplicates, ever. |
| `maxRetries = n` configured | Up to `n + 1` attempts total, retried back-to-back with no backoff. Duplicate risk on ambiguous failures. |
| Failure with `offlineBufferEnabled = true` | Batch persisted to `cacheDir` and replayed on a later launch. |
| Queue overflow (`maxQueueSize`, default 2048) | Oldest items dropped before they are ever exported. |
| Process dies mid-interval | Anything emitted since the last export is lost — there is no flush-on-background hook. Crash evidence is the exception: it is persisted synchronously at crash time and replayed on the next launch. |

Set `debugLogging = true` to print each batch's destination and HTTP
status to Logcat.

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| No `http.request` spans | HTTP is opt-in — add `ScoutOkHttpInterceptor` to your `OkHttpClient`. |
| `native_crash` / `app_crash` not appearing after a crash | Crashes drain on the *next* launch. Relaunch the app, then check the collector. |
| Android `native_crash` empty on API < 30 | `ApplicationExitInfo` requires API 30+. Older devices only get whatever the in-process NDK handler caught. |
| Crash button gives a graceful shutdown | You're calling `exit()`, which no crash reporter intercepts. Trigger a real fault (uncaught exception, or a native null-deref). |
| Compose screens not tracked | Attach `NavController.trackScoutScreens()`, or call `Scout.setScreen(...)` manually. |
| Tap labels are class names | The tapped widget has no `contentDescription` / `testTag` / text to resolve a friendlier name. Add a `contentDescription` or `Modifier.testTag(...)`. |
| Requests not getting `traceparent` | The host isn't in `firstPartyHosts`. Add it (`api.example.com`) or a wildcard (`*.example.com`). |
| No telemetry at all | Set `debugLogging = true` to print export attempts and their HTTP status to Logcat, then confirm the endpoint is reachable from the device. Remember the default `sessionSampleRate` is **1%**. |

## Performance considerations

- **Unified 30 s batching.** Spans, metrics, and logs each flush once
  per `exportIntervalSeconds` (default 30 s).
- **No metrics unless enabled.** The default configuration ships zero
  metric data points; the memory / CPU / frame gauges are opt-ins.
- **Zero disk usage by default.** Offline buffering is off; the only
  disk writes are crash evidence.
- **Sampling.** `sessionSampleRate` drops *full sessions* — never
  individual events — so session traces stay coherent.
- **Idempotent init.** A second `initialize` is a no-op.

## Security considerations

- **PII scrubbing.** Use `beforeSend` to mutate attributes
  (`attributes.remove("user.email")`) or drop signals (return `false`).
- **Custom headers for auth.** Pass
  `headers = mapOf("Authorization" to "Bearer …")`.
- **No telemetry-to-disk PII by default.** The offline buffer is off;
  when enabled, scrub in `beforeSend` before batches hit disk.

## FAQ

**Does scout-android require the NDK in my app?**

No. The native crash handler ships prebuilt for all four ABIs inside
the artifact.

**Will init block app startup?**

`Scout.initialize` does its work inline but is lightweight; call it in
`Application.onCreate()`. Instrumentation runs on background threads.

**Can I add custom spans, metrics, or logs?**

Yes — `recordSpan`, `emitGauge`, and `log*` are the manual entry
points. They go through the same sampling / export pipeline.

**Does it work with Java-only apps?**

Yes — every method is `@JvmStatic`; call `Scout.initialize(this, config)`
from Java the same way.

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Instrument [iOS](/instrument/mobile/ios) for the Swift counterpart, or
  [Kotlin Multiplatform](/instrument/mobile/kotlin-multiplatform) to
  cover both from shared code
- Ship [Flutter](/instrument/mobile/flutter) apps on the same backend

## References

- scout-kotlin-multiplatform repo:
  [github.com/base-14/scout-kotlin-multiplatform](https://github.com/base-14/scout-kotlin-multiplatform)
- Android ApplicationExitInfo:
  [developer.android.com/reference/android/app/ApplicationExitInfo](https://developer.android.com/reference/android/app/ApplicationExitInfo)
- AndroidX JankStats:
  [developer.android.com/reference/androidx/metrics/performance/JankStats](https://developer.android.com/reference/androidx/metrics/performance/JankStats)
