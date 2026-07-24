---
title: iOS Instrumentation - Native Swift RUM with ScoutKit
sidebar_label: iOS
sidebar_position: 22
description:
  iOS OpenTelemetry RUM for native Swift/SwiftUI apps with the Scout
  SDK. Captures taps, screens, KSCrash native crashes, app hangs, HTTP,
  and frame metrics as traces.
keywords:
  [
    ios opentelemetry,
    ios rum,
    ios crash reporting,
    kscrash,
    metrickit,
    ios app hang detection,
    swiftui observability,
    ios distributed tracing,
    ios otlp exporter,
    scout-ios,
  ]
---

# iOS

Scout for iOS is a native Swift SDK that ships **zero-config
OpenTelemetry RUM**. One `Scout.start(...)` call auto-captures the full
Real User Monitoring event set — taps, screens, native crashes, app
hangs, jank, startup, lifecycle, HTTP — and exports it as OTLP traces,
metrics, and logs to a Scout collector.

```swift
import Scout

Scout.start(
  serviceName: "my-app",
  endpoint: "https://otel.example.com"
)
```

That's the only code you write. The SDK is a thin Swift layer
(`ScoutKit`) over a Kotlin/Native engine (`ScoutNative`) that does all
the instrumentation — you only ever import and call the `Scout` type.

## What You Get

| Capability | Signal | Mechanism |
|---|---|---|
| App startup | `app_startup` span + `app_vital` (`vital.name = fbc`) on first screen | Process-start nanos → first init |
| Lifecycle | `app_lifecycle.changed` | `UIApplicationDidBecomeActive` / `DidEnterBackground` notifications; drives session foreground/background |
| Screen views | `screen_view` span | `UIViewController.viewDidAppear` IMP swizzle; class name (last path component); container controllers (Nav / Tab / Split / Page) skipped |
| Screen load | `screen_load` span | `viewDidLoad` → `viewDidAppear` timing via `CACurrentMediaTime` |
| View session | `view_session` span | Time-on-screen, emitted on screen change |
| Navigation vital | `app_vital` (`vital.name = inv`) | Tap → next-screen latency within 5 s |
| Tap tracking | `user_interaction` span (`ui.type = tap`, target, x/y) | Non-consuming `UITapGestureRecognizer` on every key window; label resolved via hit-test accessibility label / identifier / button title / `UILabel`, then the deepest accessibility element, then a cleaned class name |
| HTTP requests | `http.request` span with method, URL, status, duration | Global pass-through `NSURLProtocol`; times every request; skips the collector host to avoid loops; covers `URLSession` + Ktor/Darwin |
| Distributed tracing | W3C `traceparent` header injected into requests to `firstPartyHosts` | The http span's trace/span id is propagated so backend spans join the same trace. First-party only — third-party hosts get no header |
| Long task (UI hang) | `long_task` span | `CADisplayLink` on the main runloop; frame interval ≥ 100 ms |
| Frozen frame | `frozen_frame` span | Same `CADisplayLink`; frame interval ≥ 700 ms |
| App hang / ANR | `anr` span with a mach main-thread backtrace + breadcrumbs | `AppHangWatchdog` — a background-queue heartbeat to the main queue; fires once at threshold cross (default 5 s). MetricKit `MXHangDiagnostic` also → `anr` |
| Native crashes | `native_crash` **and** `app_crash` spans with `crash.reason`, registers, mach exception, symbolicated callstack tree, binary images, breadcrumbs | KSCrash 2.x (all monitors: mach exception, signal, C++ exception, NSException, main-thread deadlock, user-reported). Drained on the next launch. MetricKit `MXCrashDiagnostic` also → `native_crash` |
| Errors (handled) | `error` span | `Scout.reportError(...)` |
| Memory (opt-in) | `process.memory.usage` gauge (`By`) | mach `task_info(TASK_VM_INFO)` `phys_footprint` — the value iOS jetsam charges against the per-app limit and that Xcode's memory gauge shows. Polled every `vitalsCollectionIntervalSeconds`. Off by default (`enableMemoryMetrics`) |
| CPU (opt-in) | `process.cpu.usage` gauge | mach `thread_info` non-idle CPU sum. Off by default (`enableCpuMetrics`) |
| Logs | OTLP logs | `Scout.log*()` |
| Anonymous user id | `user.anonymous_id` on every span | UUID minted on first launch, persisted |

## Prerequisites

| Requirement | Version |
|---|---|
| iOS deployment target | ≥ 13.0 |
| Xcode | ≥ 15 (Swift tools 5.9) |
| Swift Package Manager | Bundled with Xcode |

## Installation

The iOS SDK is distributed via **Swift Package Manager** from the
`scout-kotlin-multiplatform` repository. It exposes two products:
`Scout` (the Swift `ScoutKit` layer — your public API) and `ScoutNative`
(the Kotlin/Native engine, delivered as a hosted `xcframework`). Adding
`Scout` pulls in `ScoutNative` transitively.

Release tags are `ios-<version>` — **not** semver — so pin by
**revision**, not a version range:

```swift
// Package.swift
dependencies: [
  .package(
    url: "https://github.com/base-14/scout-kotlin-multiplatform",
    revision: "ios-0.1.8"
  )
],
targets: [
  .target(
    name: "MyApp",
    dependencies: [
      .product(name: "Scout", package: "scout-kotlin-multiplatform")
    ]
  )
]
```

In Xcode: **File → Add Package Dependencies…**, enter
`https://github.com/base-14/scout-kotlin-multiplatform`, set the
dependency rule to **Commit / Branch** = `ios-0.1.8`, and add the
**Scout** library product.

## Initialization

Call `Scout.start(...)` once, as early as possible — in
`application(_:didFinishLaunchingWithOptions:)` — so the crash handler
is armed and cold-start timing is anchored:

```swift
import Scout
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions:
      [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    Scout.start(
      serviceName: "my-app",
      endpoint: "https://otel.example.com",
      headers: ["Authorization": "Bearer …"]
    )
    return true
  }
}
```

### Setting user identity

```swift
Scout.setUser(id: "user-123", attributes: [
  "email": "jane@example.com",
  "plan": "pro",
])

// On logout:
Scout.clearUser()
```

### Setting session attributes

```swift
Scout.setSessionAttributes(["tenant": "acme", "ab_bucket": "B"])
Scout.clearSessionAttributes()
```

They attach to every subsequent span, metric, and log for the rest of
the session.

## Configuration

`Scout.start(...)` takes its configuration as named parameters. Only
`serviceName` and `endpoint` are required.

### Identity

| Parameter | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `String` | **(required)** | Logical app identifier. Used as `service.name`. |
| `endpoint` | `String` | **(required)** | OTLP-HTTP collector URL. Signal paths are appended automatically. |
| `environment` | `String?` | `nil` | Deployment environment (e.g. `production`). |
| `headers` | `[String: String]` | `[:]` | Extra HTTP headers on every OTLP export. Use for auth. |
| `firstPartyHosts` | `[String]` | `[]` | Hosts that receive a W3C `traceparent` header for distributed tracing. Exact match or `*.host` wildcards. Empty = no propagation. |

### Sessions & thresholds

| Parameter | Type | Default | Description |
|---|---|---|---|
| `sessionSampleRate` | `Double (0-100)` | `1.0` | Percent of sessions sampled — default **1%**. Decided once per session; applies uniformly to spans, metrics, and logs. |
| `anrThresholdMs` | `Double` | `5000` | Main-thread hang duration that fires an `anr` span (drives `AppHangWatchdog`). |

### Auto-instrumentation toggles

| Parameter | Type | Default | Description |
|---|---|---|---|
| `enableCrashReporting` | `Bool` | `true` | KSCrash native crash capture **and** the `AppHangWatchdog` + MetricKit subscribers. |
| `enableScreenTracking` | `Bool` | `true` | `screen_view` / `screen_load` / `view_session` spans. |
| `enableTapTracking` | `Bool` | `true` | `user_interaction` spans. |

HTTP tracking is always on. Screen, tap, jank (`long_task` /
`frozen_frame`), startup, and lifecycle instrumentation are on by
default; `long_task` (100 ms) and `frozen_frame` (700 ms) thresholds are
fixed.

### Batching & export (applies to spans, metrics, AND logs)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `exportIntervalSeconds` | `Int` | `30` | One export cadence for spans, metrics, and logs. |
| `maxExportBatchSize` | `Int` | `512` | Max items per export batch, per signal. |
| `maxQueueSize` | `Int` | `2048` | Max items buffered awaiting export; overflow is dropped. |
| `maxRetries` | `Int` | `0` | Delivery attempts after a failed export. Default **0 = at-most-once**. |
| `vitalsCollectionIntervalSeconds` | `Int` | `60` | How often memory / CPU gauges are polled (when enabled). |
| `offlineBufferEnabled` | `Bool` | `false` | Persist failed batches and replay on next launch. Off by default (strict at-most-once). |

### Metrics (opt-in)

The SDK ships **no metrics by default** — each gauge is opt-in.

| Parameter | Default | Description |
|---|---|---|
| `enableMemoryMetrics` | `false` | `process.memory.usage` gauge. |
| `enableCpuMetrics` | `false` | `process.cpu.usage` gauge. |
| `enableFrameMetrics` | `false` | Frame metrics. Frozen-frame detection (the `frozen_frame` span) stays on regardless. |

## Native crash setup

No app-side setup is required — KSCrash and the MetricKit subscriber
install automatically when `enableCrashReporting` is on (the default).

### KSCrash

On `start`, the engine installs **KSCrash 2.x** with all monitors:
mach exceptions, POSIX signals, C++ exceptions, NSException, and
main-thread deadlock. KSCrash writes reports out-of-process at crash
time. On the **next launch**, Scout drains any persisted reports and
emits **both** a `native_crash` span (full crash detail) and an
`app_crash` span (`error.handled = false`, `error.source.type = ios`) —
the latter is parity with Android's `app_crash`. Captured attributes
include:

- `crash.reason`, `crash.type`, `crash.signal`
- `crash.registers_json` — full CPU register dump
- `crash.mach_exception` / `crash.mach_code` / `crash.mach_subcode`
- `crash.callstack_tree_json` — symbolicated stack tree of every thread
- `crash.binary_images_json` — loaded image list for offline
  symbolication
- The prior session's breadcrumb trail + last screen

### MetricKit

An `MXMetricManagerSubscriber` (iOS 14+) collects asynchronous
`MXCrashDiagnostic` (→ `native_crash`) and `MXHangDiagnostic`
(→ `anr`) payloads Apple delivers the morning after — useful for
kernel-killed crashes KSCrash couldn't intercept.

### App hangs

`AppHangWatchdog` is a Swift-side heartbeat that detects a hung main
thread and emits an `anr` span with a mach frame-pointer backtrace once
the hang crosses `anrThresholdMs` (default 5 s).

Because crashes drain on the **next** launch, to test: trigger a real
fault (`fatalError()`, an out-of-bounds access — never `exit()`, which
is graceful), relaunch the app, then check the collector.

## Manual API

All methods are `static` on the `Scout` type.

```swift
// Errors & logs
Scout.reportError(error)                       // → `error` span
Scout.logInfo("checkout started", attributes: ["cart.size": "3"])
Scout.logError("payment failed")
Scout.logWarning("…"); Scout.logDebug("…")
Scout.logEvent("promo_applied", attributes: ["code": "SAVE10"])

// Identity
Scout.setUser(id: "user-123", attributes: ["plan": "pro"])
Scout.setUserAttributes(["role": "admin"]); Scout.clearUser()

// Session / account / feature flags
Scout.setSessionAttributes(["tenant": "acme"]); Scout.clearSessionAttributes()
Scout.setAccount(id: "org-1", name: "Acme"); Scout.clearAccount()
Scout.setFeatureFlag(name: "new_checkout", value: "true")
Scout.clearFeatureFlags()

// Screens & custom spans
Scout.setScreen("Checkout")
Scout.recordScreenLoad(name: "Checkout", durationMs: 320)
Scout.recordViewSession(name: "Checkout", durationMs: 8400)
Scout.recordSpan(name: "sync", durationMs: 120, attributes: ["items": "12"])

// Manual instrumentation
Scout.reportHttp(method: "GET", url: "https://api…", statusCode: 200,
                 startEpochNanos: t0, endEpochNanos: t1)   // → `http.request`
Scout.reportLongTask(durationMs: 180)                       // → `long_task`
Scout.reportTap(target: "Buy", targetType: "Button", x: 40, y: 88)
Scout.emitGauge(name: "queue.depth", value: 12, unit: "1")

// Vitals / operations / breadcrumbs
Scout.addTiming("first_paint")
Scout.startVital("checkout"); Scout.endVital("checkout", description: "ok")
Scout.recordOperationStep(name: "checkout", step: "payment")
Scout.addBreadcrumb(type: "tap", message: "Buy")
```

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| `native_crash` not appearing after a crash | KSCrash writes asynchronously; the report drains on the *next* launch. Force-quit and relaunch, then check the collector. |
| Crash button gives a graceful shutdown | You're calling `exit()`, which no crash reporter intercepts. Trigger a real fault (`fatalError()`, out-of-bounds access). |
| `anr` never fires | The main thread genuinely isn't hanging, or `anrThresholdMs` is higher than your hang. Try a 6 s `Thread.sleep` on the main thread to confirm the watchdog is armed. |
| Tap labels are class names like `ComposeCanvas` | The tapped surface is a single canvas view (SwiftUI/Compose) with no per-widget accessibility label. Add `.accessibilityLabel(...)` / `.accessibilityIdentifier(...)` to the tappable view. |
| SPM can't resolve the package | Pin by `revision: "ios-0.1.8"` — the tags are not semver, so `from:` / `exact:` version rules won't match. |
| HTTP spans missing for a custom session | The pass-through `NSURLProtocol` covers `URLSession.shared` and default configs; a session with a custom `protocolClasses` that omits it won't be traced. |

## Performance considerations

- **Unified 30 s batching.** Spans, metrics, and logs each flush once
  per `exportIntervalSeconds` (default 30 s).
- **No metrics unless enabled.** The default configuration ships zero
  metric data points; the memory / CPU gauges are opt-ins.
- **Zero disk usage by default.** Offline buffering is off; the only
  disk writes are crash evidence (KSCrash reports, breadcrumbs).
- **Sampling.** `sessionSampleRate` drops *full sessions* — never
  individual events.

## Security considerations

- **Custom headers for auth.** Pass
  `headers: ["Authorization": "Bearer …"]` — sent on every OTLP export.
- **No telemetry-to-disk PII by default.** The offline buffer is off;
  crash reports contain register / stack detail, not app data.
- **TLS.** Use an `https://` endpoint.

## FAQ

**What's the difference between `native_crash` and `app_crash`?**

iOS emits both for one crash: `native_crash` carries the full KSCrash
detail (registers, mach exception, symbolicated tree), and `app_crash`
is the cross-platform crash record (parity with Android). Dedupe in
dashboards by crash fingerprint if you want a single row.

**Do I need to add ScoutNative separately?**

No — depending on the `Scout` product pulls the `ScoutNative`
xcframework in transitively.

**Can I add custom spans, metrics, or logs?**

Yes — `recordSpan`, `emitGauge`, and `log*` are the manual entry
points.

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Instrument [Android](/instrument/mobile/android) for the Kotlin
  counterpart, or [Kotlin Multiplatform](/instrument/mobile/kotlin-multiplatform)
  to cover both from shared code
- Ship [Flutter](/instrument/mobile/flutter) apps on the same backend

## References

- scout-kotlin-multiplatform repo:
  [github.com/base-14/scout-kotlin-multiplatform](https://github.com/base-14/scout-kotlin-multiplatform)
- KSCrash: [github.com/kstenerud/KSCrash](https://github.com/kstenerud/KSCrash)
- Apple MetricKit:
  [developer.apple.com/documentation/metrickit](https://developer.apple.com/documentation/metrickit)
