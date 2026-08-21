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

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## What You Get

`scout-kmp` delegates to the platform SDKs, so you get the **same
capabilities** documented for each platform, driven from common code:

- **Android** — the full [scout-android](/instrument/mobile/android)
  set: Activity/Compose screens, taps, JVM + NDK crashes,
  `ApplicationExitInfo`, ANR, jank, startup, lifecycle, HTTP.
- **iOS** — the [scout-ios](/instrument/mobile/ios) set: screens, taps,
  KSCrash native crashes, app hangs, jank, startup, lifecycle, HTTP, and
  MetricKit `MXCrashDiagnostic` / `MXHangDiagnostic` diagnostics.

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
      implementation("io.base14:scout-kmp:0.1.9")
    }
  }
}
```

Make sure `mavenCentral()` is in your `dependencyResolutionManagement`
repositories. `scout-kmp` pins and re-exports the platform SDKs
transitively — you don't add them yourself:

| Module | Version | Reaches your build as |
|---|---|---|
| `scout-core` | 0.1.7 | Maven artifact `io.base14:scout-core` |
| `scout-android` | 0.1.7 | Maven artifact `io.base14:scout-android` |
| `scout-ios` | 0.1.9 | Kotlin/Native klib, linked into your iOS framework |

A pure-Swift app consumes `scout-ios` differently — as the `Scout` SPM
package described in the [iOS](/instrument/mobile/ios) docs. Under KMP
you never add it yourself.

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
| `endpoint` | `String` | **(required)** | OTLP-HTTP collector URL. `/v1/traces`, `/v1/metrics`, `/v1/logs` are appended automatically. Must be non-blank. |
| `serviceVersion` | `String?` | `null` | Maps to `service.version`. |
| `environment` | `String?` | `null` | Deployment environment. |
| `headers` | `Map<String, String>` | `{}` | Extra HTTP headers on every OTLP export. Use for auth. |
| `resourceAttributes` | `Map<String, String>` | `{}` | Extra attributes merged into every signal's `Resource`. |

### Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionSampleRate` | `Double (0-100)` | `1.0` | Percent of sessions sampled — default **1%**. Decided once per session; a sampled session sends everything (spans, metrics, logs), an unsampled one sends nothing. |
| `alwaysCaptureErrors` | `Boolean` | `true` | Error / crash / ANR-class spans bypass `sessionSampleRate` and are always exported. |
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
| `exportIntervalSeconds` | `Int` | `30` | One export cadence for spans, metrics, and logs (coerced ≥ 1). |
| `maxExportBatchSize` | `Int` | `512` | Max items per export batch, per signal. |
| `maxQueueSize` | `Int` | `2048` | Max items buffered awaiting export; overflow dropped. |
| `maxRetries` | `Int` | `0` | Delivery attempts after a failed export. Default **0 = at-most-once**. |
| `metricExportIntervalSeconds` | `Int?` | `null` | Metrics-only override of `exportIntervalSeconds`. |
| `vitalsCollectionIntervalSeconds` | `Int` | `60` | How often memory / CPU / frame gauges are polled (when enabled). |

### Per-metric switches

The SDK ships **no metrics by default** — each gauge is opt-in.

| Field | Default | Description |
|---|---|---|
| `enableMetrics` | `true` | Master switch for the metrics pipeline. Individual gauges still need their own switch below. |
| `enableMemoryMetrics` | `false` | Memory gauge. |
| `enableCpuMetrics` | `false` | CPU gauge. |
| `enableFrameMetrics` | `false` | Frame gauge. Android only — iOS emits no frame gauge. |

### Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. Span and log
instrumentation defaults to **on**; metric collection defaults to
**off** (see [Per-metric switches](#per-metric-switches)).

| Toggle | Default | What you lose when `false` |
|---|---|---|
| `enableScreenTracking` | `true` | `screen_view` / `screen_load` / `view_session` spans. |
| `enableTapTracking` | `true` | All `user_interaction` spans. |
| `enableHttpTracking` | `true` | `http.request` spans on both platforms. |
| `enableErrorTracking` | `true` | `error` spans — including manual `Scout.reportError(...)` calls, which become no-ops. |
| `enableCrashTracking` | `true` | Android JVM + NDK crashes and iOS KSCrash capture. |
| `enableAnrTracking` | `true` | `anr` spans on both platforms. |
| `enableJankTracking` | `true` | `long_task` / `frozen_frame` spans. |
| `enableLifecycleTracking` | `true` | `app_lifecycle.changed` spans and the session foreground/background transitions they drive. |
| `enableStartupTracking` | `true` | `app_startup` spans and the FBC vital. |
| `enableLogging` | `true` | `Scout.log*()` calls become no-ops. |

### Offline buffer

Disabled by default (strict at-most-once). `offlineBufferEnabled`
(`false`) is the master toggle. When the buffer is on,
`maxOfflineStorageMb` (`5`) caps the on-disk buffer — once the cap is
exceeded the oldest persisted batches are pruned first (FIFO) — and the
persisted queue is additionally bounded by `maxQueueSize` and
`maxExportBatchSize`.

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

## Native crash setup

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

## What happens when export fails

Both platforms share `scout-core`'s exporter, so the behaviour is
identical on Android and iOS. Delivery is **at-most-once by default**
(`maxRetries = 0`): a batch gets one attempt, and a failed batch is
dropped rather than risking a duplicate delivery.

A batch counts as delivered only on an HTTP 2xx. Any other status, or a
transport exception, is a failure.

| Failure | What Scout does (defaults) |
|---|---|
| Any export failure, `maxRetries = 0` (default) | One attempt; batch dropped. No duplicates, ever. |
| `maxRetries = n` configured | Up to `n + 1` attempts total, retried back-to-back with no backoff. Duplicate risk on ambiguous failures. |
| Failure with `offlineBufferEnabled = true` | Batch persisted to disk and replayed on a later launch. |
| Queue overflow (`maxQueueSize`, default 2048) | Oldest items dropped before they are ever exported. |
| Process dies mid-interval | Anything emitted since the last export is lost — there is no flush-on-background hook. Crash evidence is the exception: it is persisted at crash time and replayed on the next launch. |

Set `debugLogging = true` to print each batch's destination and HTTP
status to the platform console.

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| No telemetry on Android | Confirm `initialize` runs early (the `ScoutInitProvider` captures the `Application` before `onCreate`, but `initialize` itself must still be called). |
| No `http.request` spans on Android | Android HTTP is opt-in — add `ScoutOkHttpInterceptor` to your `OkHttpClient`. iOS HTTP is automatic. |
| Crashes not appearing | They drain on the *next* launch on both platforms. Relaunch, then check the collector. |
| Telemetry hard to distinguish from native SDK data | KMP exports carry a `scout.kmp.version` resource attribute — filter on it. |
| No telemetry at all | Set `debugLogging = true` to print export attempts and their HTTP status, then confirm the endpoint is reachable from the device. Remember the default `sessionSampleRate` is **1%**. |

## Performance considerations

- **Unified 30 s batching.** Spans, metrics, and logs each flush once
  per `exportIntervalSeconds` (default 30 s), on both platforms.
- **No metrics unless enabled.** The default configuration ships zero
  metric data points; the memory, CPU, and frame gauges are opt-ins.
- **Zero disk usage by default.** Offline buffering is off; the only
  disk writes are crash evidence.
- **Sampling.** `sessionSampleRate` drops *full sessions* — never
  individual events — so session traces stay coherent.
- **Idempotent init.** `Scout.initialize` is a no-op once the SDK is
  running, on both platforms.

## Security considerations

- **PII scrubbing.** Use `beforeSend` to mutate attributes
  (`attributes.remove("user.email")`) or drop signals (return `false`).
  It runs in shared code, so one filter covers both platforms.
- **Custom headers for auth.** Pass
  `headers = mapOf("Authorization" to "Bearer …")`.
- **No telemetry-to-disk PII by default.** The offline buffer is off;
  when enabled, scrub in `beforeSend` before batches hit disk.
- **TLS.** Use an `https://` endpoint.

## FAQ

### Do I need to add `scout-android` and `scout-ios` separately?

No. `scout-kmp` depends on them with `api(...)`, so both come in
transitively at the versions listed under
[Installation](#installation).

### Does the iOS side go through `ScoutKit`?

No. `scout-kmp` calls the Kotlin engine (`ScoutEngine`) directly rather
than the Swift `Scout.start(...)` entry point. KSCrash still installs,
ANR detection still runs — from the Kotlin watchdog, gated by
`enableAnrTracking`, instead of the Swift `AppHangWatchdog` — and the
engine subscribes to MetricKit, so Apple's asynchronous
`MXCrashDiagnostic` / `MXHangDiagnostic` payloads are collected. The full
[iOS](/instrument/mobile/ios) capability table applies.

### How do I track screens in a Compose Multiplatform app?

Call `Scout.setScreen("Checkout")` from shared code at each navigation
point. The automatic trackers key off platform view containers
(Activities on Android, `UIViewController` on iOS), and a Compose
Multiplatform app presents one host container per platform — so
automatic screen names collapse to that single host.

### Can I still use the platform-specific APIs?

Yes. The common `Scout` object exposes the cross-platform surface; from
`androidMain` you can call `io.base14.scout.android.Scout` directly for
Android-only helpers such as `NavController.trackScoutScreens()` and
`setBreadcrumbs(...)`, which have no common equivalent.

### How do I tell KMP telemetry apart from native SDK telemetry?

Every export carries a `scout.kmp.version` resource attribute. Filter on
it.

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Read the [Android](/instrument/mobile/android) and
  [iOS](/instrument/mobile/ios) docs for per-platform attribute detail
- Ship [Flutter](/instrument/mobile/flutter) apps on the same backend

## References

- scout-kotlin-multiplatform repo:
  [github.com/base-14/scout-kotlin-multiplatform](https://github.com/base-14/scout-kotlin-multiplatform)
