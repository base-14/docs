---
title: Kotlin Multiplatform Instrumentation - RUM with scout-kmp
sidebar_label: Kotlin Multiplatform
sidebar_position: 23
description:
  Kotlin Multiplatform OpenTelemetry RUM with the scout-kmp SDK. One
  commonMain initialize() call instruments Android and iOS with taps,
  screens, crashes, ANR, HTTP, and frame metrics.
keywords:
  [
    kotlin multiplatform opentelemetry,
    kmp rum,
    kmp crash reporting,
    compose multiplatform observability,
    kmp distributed tracing,
    kmp otlp exporter,
    scout-kmp,
  ]
---

# Kotlin Multiplatform

`scout-kmp` is the unified Kotlin Multiplatform entry point for Scout
RUM. One `commonMain` call routes to the native `scout-android` and
`scout-ios` engines, so a KMP app gets the full native Real User
Monitoring event set on both platforms: taps, screens, crashes, ANR,
jank, startup, lifecycle, and HTTP.

```kotlin
import io.base14.scout.core.ScoutConfig
import io.base14.scout.kmp.Scout

Scout.initialize(
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
  ),
)
```

That is the whole setup, in shared code — no Android `Context` argument
to thread through. HTTP on Android is the one exception: it needs an
OkHttp interceptor registered in `androidMain` (see
[HTTP tracking](#http-tracking-on-android)).

## What You Get

`scout-kmp` delegates to the platform SDKs, so you get the **same
capabilities** documented for each platform, driven from common code:

- **Android** — the full [scout-android](/instrument/mobile/android)
  set: Activity/Compose screens, taps, JVM + NDK crashes,
  `ApplicationExitInfo`, ANR, jank, startup, lifecycle, HTTP.
- **iOS** — the full [scout-ios](/instrument/mobile/ios) set: screens,
  taps, KSCrash native crashes, app hangs, jank, startup, lifecycle,
  HTTP.

Every signal flows through the shared `scout-core` engine — the same
sessions, sampling, batching, and OTLP export on both platforms. Each
export additionally carries a `scout.kmp.version` resource attribute so
you can tell KMP-originated telemetry apart.

| Signal | Android | iOS |
|---|---|---|
| Screen / navigation (`screen_view`, `screen_load`, `view_session`) | ✓ | ✓ |
| Tap tracking (`user_interaction`) | ✓ | ✓ |
| App startup (`app_startup`) + FBC/INV vitals (`app_vital`) | ✓ | ✓ |
| Lifecycle (`app_lifecycle.changed`) | ✓ | ✓ |
| HTTP (`http.request`) | ✓ (add `ScoutOkHttpInterceptor`) | ✓ (automatic) |
| Native crashes (`native_crash` / `app_crash`) | ✓ (NDK + ExitInfo) | ✓ (KSCrash) |
| ANR (`anr`) | ✓ | ✓ |
| Jank (`long_task`, `frozen_frame`) | ✓ | ✓ |
| Errors (`error`) | ✓ | ✓ |
| Memory / CPU gauges (opt-in) | ✓ | ✓ |
| Frame gauge (opt-in) | ✓ (`android.frame.build_time`) | — (jank still arrives as `long_task` / `frozen_frame` spans) |
| Logs | ✓ | ✓ |

See the [Android](/instrument/mobile/android) and
[iOS](/instrument/mobile/ios) docs for the exact span attributes and
per-platform mechanisms.

## Prerequisites

| Requirement | Version |
|---|---|
| Kotlin | 2.x (multiplatform) |
| Android `minSdkVersion` | ≥ 26 |
| Android `compileSdkVersion` | 35 |
| iOS deployment target | ≥ 13.0 |
| Targets | Android (via the AGP `androidLibrary` KMP plugin), `iosArm64`, `iosSimulatorArm64` |

`scout-kmp` publishes `iosArm64` and `iosSimulatorArm64` only. There is
no `iosX64` artifact, so the **Intel iOS simulator is unsupported** — on
an Intel Mac the link step fails with no matching binary.

## Installation

`scout-kmp` is published on Maven Central. Add it to your shared
module's `commonMain`:

```kotlin
// shared/build.gradle.kts
kotlin {
  sourceSets {
    commonMain.dependencies {
      implementation("io.base14:scout-kmp:0.1.8")
    }
  }
}
```

Make sure `mavenCentral()` is in your `dependencyResolutionManagement`
repositories. `scout-kmp` pins and re-exports the platform SDKs
transitively — you don't add them yourself:

| Module | Version |
|---|---|
| `scout-core` | 0.1.6 |
| `scout-android` | 0.1.6 |
| `scout-ios` | 0.1.8 |

## Initialization

Call `Scout.initialize(config)` once from shared code, as early as
possible in each platform's startup path (e.g. from a shared
`initialize()` you invoke in Android's `Application.onCreate()` and the
iOS app entry point).

```kotlin
import io.base14.scout.core.ScoutConfig
import io.base14.scout.kmp.Scout

fun startTelemetry() {
  Scout.initialize(
    ScoutConfig(
      serviceName = "my-app",
      serviceVersion = "1.0.0",
      endpoint = "https://otel.example.com",
      headers = mapOf("Authorization" to "Bearer …"),
    ),
  )
}
```

**No Android `Context` argument.** On Android, `scout-kmp` captures the
`Application` automatically via a `ContentProvider`
(`ScoutInitProvider`) auto-registered in the library manifest, which
runs before your app's `onCreate` — so `initialize` needs nothing
platform-specific. On iOS it delegates straight to the native engine.
Both platforms inject the `scout.kmp.version` resource attribute.

### HTTP tracking on Android

Android HTTP tracking is opt-in and is the one piece of setup that does
not live in `commonMain`. Register `ScoutOkHttpInterceptor` on the
`OkHttpClient` in your `androidMain` source set:

```kotlin
// androidMain
import io.base14.scout.android.http.ScoutOkHttpInterceptor
import okhttp3.OkHttpClient

val client = OkHttpClient.Builder()
  .addInterceptor(ScoutOkHttpInterceptor())
  .build()
```

The interceptor skips your collector endpoint and anything matching
`ignoreUrlPatterns`, and injects a W3C `traceparent` on hosts listed in
`firstPartyHosts`.

On iOS nothing is required — the engine installs a pass-through
`NSURLProtocol` that times every request automatically.

### Setting user identity & session attributes

```kotlin
Scout.setUser(id = "user-123", attributes = mapOf("plan" to "pro"))
Scout.clearUser()

Scout.setSessionAttributes(mapOf("tenant" to "acme"))
Scout.clearSessionAttributes()
```

## Configuration

`ScoutConfig` is the single shared config object (from `scout-core`).
`serviceName` and `endpoint` are the only **required** fields.

### Identity

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `String` | **(required)** | Logical app identifier (`service.name`). Must be non-blank. |
| `endpoint` | `String` | **(required)** | OTLP-HTTP collector URL. Signal paths appended automatically. Must be non-blank. |
| `serviceVersion` | `String?` | `null` | Maps to `service.version`. |
| `environment` | `String?` | `null` | Deployment environment. |
| `headers` | `Map<String, String>` | `{}` | Extra HTTP headers on every OTLP export. Use for auth. |
| `resourceAttributes` | `Map<String, String>` | `{}` | Extra attributes merged into every signal's `Resource`. |

### Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionSampleRate` | `Double (0-100)` | `1.0` | Percent of sessions sampled — default **1%**. Decided once per session; applies to spans, metrics, and logs together. |
| `alwaysCaptureErrors` | `Boolean` | `true` | Error / crash / ANR-class signals bypass sampling. |
| `sessionTimeoutMinutes` | `Int` | `30` | Inactivity timeout before a new session. |
| `maxSessionDurationMinutes` | `Int` | `60` | Hard cap on session lifetime. |

### Network

| Field | Type | Default | Description |
|---|---|---|---|
| `firstPartyHosts` | `List<String>` | `[]` | Hosts that receive a W3C `traceparent`. Exact match or `*.host` wildcards. |
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
| `exportIntervalSeconds` | `Int` | `30` | One export cadence for spans, metrics, and logs. |
| `maxExportBatchSize` | `Int` | `512` | Max items per export batch, per signal. |
| `maxQueueSize` | `Int` | `2048` | Max items buffered awaiting export; overflow dropped. |
| `maxRetries` | `Int` | `0` | Delivery attempts after a failed export. Default **0 = at-most-once**. |
| `metricExportIntervalSeconds` | `Int?` | `null` | Metrics-only override of `exportIntervalSeconds`. |
| `vitalsCollectionIntervalSeconds` | `Int` | `60` | How often memory / CPU / frame gauges are polled (when enabled). |

### Per-metric switches & auto-instrumentation toggles

The SDK ships **no metrics by default**; each gauge is opt-in
(`enableMemoryMetrics`, `enableCpuMetrics`, `enableFrameMetrics` — all
`false`). `enableFrameMetrics` only produces a gauge on Android; iOS has
no frame gauge. Span and log auto-instrumentation defaults to **on** and
can be turned off independently: `enableScreenTracking`,
`enableTapTracking`, `enableHttpTracking`, `enableErrorTracking`,
`enableCrashTracking`, `enableAnrTracking`, `enableJankTracking`,
`enableLifecycleTracking`, `enableStartupTracking`, `enableLogging`,
`enableMetrics` — each a `Boolean` defaulting to `true`. Turning off
`enableErrorTracking` also makes manual `Scout.reportError(...)` calls
no-ops.

### Offline buffer

Disabled by default (strict at-most-once). `offlineBufferEnabled`
(`false`) is the master toggle. The cap fields `offlineMaxTraceItems` /
`offlineMaxMetricItems` / `offlineMaxLogItems` (`0`) and
`maxOfflineStorageMb` (`5`) are part of the config surface but nothing
reads them yet — when the buffer is on, the persisted queue is bounded
by `maxQueueSize` and `maxExportBatchSize` instead.

### Diagnostics

| Field | Type | Default | Description |
|---|---|---|---|
| `debugLogging` | `Boolean` | `false` | Print SDK-internal export logging to the platform console. Use it to confirm batches are leaving the device; leave it off in release builds. |

### Filtering — `beforeSend`

```kotlin
ScoutConfig(
  // …
  beforeSend = { name, attributes ->
    // Return false to drop the signal; mutate attributes for scrubbing.
    attributes.remove("user.email")
    true
  },
)
```

Runs synchronously on every span / metric / log before export; sees
per-signal attributes only (not resource attributes).

## Native crashes

Crash capture is on by default (`enableCrashTracking`) and needs no
app-side setup on either platform:

- **Android** — JVM `app_crash` (uncaught handler, replayed next
  launch), NDK `native_crash` (signal handler), and `ApplicationExitInfo`
  fallback (API 30+).
- **iOS** — KSCrash emits both `native_crash` and `app_crash`, drained
  on the next launch.

On both platforms crashes are persisted at crash time and **exported on
the next launch** — to test, trigger a real fault, relaunch, then check
the collector. See the platform docs for the full attribute set.

## Manual API

The common `Scout` object exposes the same manual API on every platform
(a no-op before `initialize`):

| Method | Purpose |
|---|---|
| `setScreen(name)` | Set the current screen / view name. |
| `setUser(id)` / `setUser(id, attributes)` / `setUserAttributes(attributes)` / `clearUser()` | User identity. |
| `setSessionAttributes(attributes)` / `clearSessionAttributes()` | Session attributes. |
| `setAccount(id, name)` / `clearAccount()` | Account / org context. |
| `setFeatureFlag(name, value)` / `clearFeatureFlags()` | Feature-flag values. |
| `reportError(throwable)` | Report a handled exception (`error` span). |
| `reportError(type, message, stackTrace)` | Report an error from string fields. |
| `logInfo / logWarning / logError / logDebug(message)` (+ `logInfo(message, attributes)`) | Emit a log. |
| `logEvent(name)` / `logEvent(name, attributes)` | Emit a named custom event. |
| `addTiming(name)` | Record a named timing marker. |
| `startVital(name)` / `endVital(name, description)` | Custom vital measurement. |
| `recordOperationStep(name, step, key, failureReason)` | Step in a multi-step operation. |
| `reportHttp(method, url, statusCode, startEpochNanos, endEpochNanos)` | Manually emit an `http.request` span. |
| `reportLongTask(durationMs)` | Manually emit a `long_task` span. |
| `reportTap(target, targetType, x, y)` | Manually emit a `user_interaction` span. |
| `emitGauge(name, value, unit)` | Emit a custom gauge metric. |
| `recordScreenLoad(name, durationMs)` / `recordViewSession(name, durationMs)` | Timing spans. |
| `recordSpan(name, durationMs, attributes)` | Emit an arbitrary named span. |
| `addBreadcrumb(type, message)` | Add a breadcrumb. |

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| No telemetry on Android | Confirm `initialize` runs early (the `ScoutInitProvider` captures the `Application` before `onCreate`, but `initialize` itself must still be called). |
| No `http.request` spans on Android | Android HTTP is opt-in — add `ScoutOkHttpInterceptor` to your `OkHttpClient`. iOS HTTP is automatic. |
| Crashes not appearing | They drain on the *next* launch on both platforms. Relaunch, then check the collector. |
| Telemetry hard to distinguish from native SDK data | KMP exports carry a `scout.kmp.version` resource attribute — filter on it. |
| No telemetry at all | Set `debugLogging = true` to print export attempts and their HTTP status, then confirm the endpoint is reachable from the device. Remember the default `sessionSampleRate` is **1%**. |

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Read the [Android](/instrument/mobile/android) and
  [iOS](/instrument/mobile/ios) docs for per-platform attribute detail
- Ship [Flutter](/instrument/mobile/flutter) apps on the same backend

## References

- scout-kotlin-multiplatform repo:
  [github.com/base-14/scout-kotlin-multiplatform](https://github.com/base-14/scout-kotlin-multiplatform)
