---
title: Flutter Instrumentation - Mobile + Web RUM with scout_flutter
sidebar_label: Flutter
sidebar_position: 25
description:
  Flutter OpenTelemetry RUM for iOS, Android, and web with the scout_flutter
  SDK. Captures taps, navigation, crashes, HTTP, and frame metrics as traces.
keywords:
  [
    flutter opentelemetry,
    flutter rum,
    flutter crash reporting,
    flutter distributed tracing,
    flutter mobile observability,
    kscrash flutter,
    metrickit flutter,
    android ndk crash flutter,
    application exit info flutter,
    flutter ui hang detection,
    flutter otlp exporter,
    scout-flutter,
  ]
---

# Flutter

`scout_flutter` is a single Dart package that ships **zero-config
OpenTelemetry RUM** for Flutter on iOS, Android, macOS, and web. Auto-
captures the full Real User Monitoring event set (except Session Replay
and Profiling) and exports it as OTLP traces, metrics, and logs to a
Scout collector.

```dart
await ScoutFlutter.initialize(
  config: ScoutFlutterConfig(
    serviceName: 'my-app',
    endpoint: 'https://otel.example.com',
  ),
);
runApp(const MyApp());
```

That's all the code you write. Every tap, navigation, HTTP request,
error, crash, scroll, and frame metric is gathered automatically — no
manual `Scout.track(...)` calls anywhere in your app.

## What You Get

| Capability | Signal | Mechanism |
|---|---|---|
| Tap tracking | `user_interaction` span (`type=tap`, target, name_source, permanent_id, x/y) | Global `GestureBinding.instance.pointerRouter` interception |
| Screen / route navigation | `screen_view` span with `view.id`, `view.loading_type`, `view.referrer`, `view.is_active` | `AutoNameNavigatorObserver` attached to every `Navigator` |
| Screen load time | `screen_load` span with `screen.load_time` | First-frame measurement after route push |
| App startup | `app_startup` span with `app_startup.type = cold \| warm`, `app_startup.duration` | `WidgetsBinding.addPostFrameCallback` on first frame |
| FBC vital (First Build Complete) | `app_vital` span with `vital.name = fbc` | Emitted alongside cold-start; ready for dashboards as a first-class vital |
| INV vital (Interaction → Next View) | `app_vital` span with `vital.name = inv`, `vital.from_screen`, `vital.to_screen` | Tap timestamp correlated with next `screen_view` within 5 s |
| Errors (Flutter framework) | `error` span with `error.id`, `error.fingerprint`, `error.handled`, breadcrumbs | `FlutterError.onError` + `PlatformDispatcher.instance.onError` |
| Manual error reporting | `error` span | `ScoutFlutter.reportError(e, stackTrace)` |
| Native crashes (iOS) | `native_crash` span with `crash.reason`, registers (FAR/ESR), mach_exception, callstack_tree, binary_images | KSCrash 2.x all five monitors + MetricKit `MXCrashDiagnostic` / `MXHangDiagnostic` |
| Native crashes (Android) | `native_crash` span with `crash.reason`, signal info, tombstone (≤ 128 KB, configurable), `crash.os_reason_*`, PSS/RSS | Custom NDK signal handler + `ApplicationExitInfo` (API 30+; reflective subReason on API 31+). Each OS death is reported exactly once (persisted watermark); normal exits (swipe-away, Force Stop, `exit()`) are never reported as crashes |
| ANR | `anr` span with `anr.duration`, `anr.threshold`, `anr.thread_count`, `anr.threads_json`, `anr.main_thread_stack`, and breadcrumbs | iOS: `AppHangWatchdog` (5 s default). Android: native ping watchdog polling every 100 ms (deterministic detection, fires once per hang) + ApplicationExitInfo `REASON_ANR` post-mortem. Captures a full thread dump at detection time. |
| UI hang (iOS) | `ui_hang` span with `ui_hang.duration`, `ui_hang.threshold` | iOS-only sub-ANR watchdog at 250 ms (configurable). Complements KSCrash mainThreadDeadlock and the 5 s ANR detector |
| Long tasks | `long_task` span with `long_task.duration`, `long_task.threshold` | Dart isolate event-loop polling |
| HTTP requests | `http.request` span with method, URL, status, duration, headers | `HttpOverrides` global wrap + Dio interceptor (optional) |
| Distributed tracing | W3C `traceparent` header injected into outgoing requests to hosts in `firstPartyHosts` | Wrap on the HTTP client |
| Scroll depth | `display.scroll.max_depth`, `display.scroll.max_depth_scroll_top`, `display.scroll.max_scroll_height`, `display.scroll.max_scroll_height_time_ms` on `screen_view` | `ScoutScrollObserver` widget wrapping `NotificationListener<ScrollNotification>` |
| Lifecycle | `app_paused`, `app_resumed` spans + force-flush on background | `AppLifecycleListener` |
| Frame metrics (opt-in) | `flutter.frame.build_time`, `flutter.frame.raster_time` histograms | `WidgetsBinding.instance.addTimingsCallback`. Off by default (`enableFrameMetrics`) — records on every frame, one stream per screen |
| Memory + CPU (opt-in) | `flutter.memory.usage`, `flutter.cpu.usage` gauges | Platform channel poll every `vitalsCollectionIntervalSeconds` (60 s). Off by default (`enableMemoryMetrics` / `enableCpuMetrics`) |
| Network connectivity | `network.connection.type` resource attribute (`wifi`, `cellular`, `none`) | `connectivity_plus` listener |
| Battery | `device.battery.level`, `device.battery.state`, `device.battery.discharge_rate` resource attributes | `battery_plus` + platform channel |
| Device orientation | `device.orientation` resource attribute (`portrait` / `landscape`) | Orientation-change listener |
| Device integrity | `device.is_jail_broken` resource attribute | Jailbreak / root heuristic via platform channel |
| Logs | OTLP logs | `ScoutFlutter.log*()` and (opt-in) `print` / `debugPrint` capture |
| Anonymous user id | `user.anonymous_id` on every span | UUID v4 minted on first launch, persisted to temp dir |
| WebView bridge | Embedded web pages adopt the native `session.id` + `user.anonymous_id`; their spans flow back as `span.source = "webview"` | `ScoutWebViewBridge.attach()` + `injectShim()` on every page finish |

## Prerequisites

| Requirement | Version |
|---|---|
| Flutter SDK | ≥ 3.7.0 |
| Dart SDK | ≥ 3.7.0 |
| iOS deployment target | ≥ 12.0 |
| Android `minSdkVersion` | ≥ 21 (`ApplicationExitInfo` features activate from API 30+) |
| `compileSdkVersion` | ≥ 34 (recommended) |
| CocoaPods | ≥ 1.11 |
| NDK (Android, for native crash) | ≥ 25 (matches Flutter default) |

## Installation

scout_flutter is published on [pub.dev](https://pub.dev/packages/scout_flutter).
Add it to your `pubspec.yaml`:

```yaml
# pubspec.yaml
dependencies:
  scout_flutter: ^0.1.23
```

Or:

```bash
flutter pub add scout_flutter
```

### iOS — CocoaPods install

The first build after adding scout_flutter triggers a pod install for
the KSCrash 2.x and MetricKit dependencies. Make sure your iOS
Podfile has `platform :ios, '12.0'` or higher:

```ruby
# ios/Podfile
platform :ios, '12.0'
```

Then:

```bash
cd ios && pod install --repo-update && cd ..
```

### Android — NDK setup

The native signal handler is built automatically as part of the
plugin's Gradle build. No app-side configuration needed beyond
ensuring your project has the NDK available (`flutter doctor` will
warn if not).

## Initialization

In your `main.dart`, before `runApp()`:

```dart
import 'package:flutter/material.dart';
import 'package:scout_flutter/scout_flutter.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Fire-and-forget — never block app startup on SDK init.
  unawaited(
    ScoutFlutter.initialize(
      config: ScoutFlutterConfig(
        serviceName: 'my-app',
        serviceVersion: '1.0.0',
        endpoint: 'https://otel.example.com',
        headers: {'Authorization': 'Bearer …'},
      ),
    ),
  );

  // Wrap your root widget with the scroll observer so per-screen
  // scroll metrics decorate the active screen_view span.
  runApp(ScoutFlutter.observeScroll(child: const MyApp()));
}
```

### Navigation tracking

Attach `ScoutFlutter.navigatorObserver` to **every** `Navigator` in your
app — the root `MaterialApp` / `CupertinoApp` plus each nested
`Navigator` (commonly inside `CupertinoTabView`, `Navigator` widgets
used for bottom-sheet stacks, etc.):

```dart
MaterialApp(
  navigatorObservers: [ScoutFlutter.navigatorObserver],
  // …
);

// And per CupertinoTabView:
CupertinoTabView(
  navigatorObservers: [ScoutFlutter.navigatorObserver],
  builder: (context) => const SongsTab(),
);
```

`navigatorObserver` returns a **fresh instance on every read**, so
attaching it to multiple Navigators does not trip Flutter's
"observer already has a navigator" assertion. All instances funnel
events into shared static state so dashboards see one coherent screen
timeline regardless of which Navigator pushed a route.

### Setting user identity

```dart
ScoutFlutter.setUser(
  id: 'user-123',
  attributes: {
    'email': 'jane@example.com',   // → user.email
    'plan': 'pro',                 // → user.plan
    'role': 'admin',               // → user.role
  },
);

// On logout:
ScoutFlutter.clearUser();
```

`id` is optional. `user.id` and every attribute ride on every span
until cleared — bare attribute keys are auto-prefixed with `user.`, and
keys already starting with `user.` pass through unchanged. `setUser`
**replaces** the whole user map, so pass everything you want each call.

### Setting session attributes

Session attributes attach to every subsequent span, metric, and log for
the rest of the session. Keys are stored verbatim (no auto-prefix).

```dart
// Replaces all existing session attributes.
ScoutFlutter.setSessionAttributes({'tenant': 'acme', 'ab_bucket': 'B'});

// Add one without clobbering the rest — merge with the current view:
ScoutFlutter.setSessionAttributes({
  ...ScoutFlutter.sessionAttributes,
  'feature.new_checkout': 'true',
});

// Clear all.
ScoutFlutter.clearSessionAttributes();
```

They persist until you call `clearSessionAttributes()` — they are **not**
cleared automatically on session rotation.

## Configuration

`ScoutFlutterConfig` is the single config object. **Required fields**
are flagged below; everything else has a sensible default and is
opt-in.

### Identity

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `String` | **(required)** | Logical app identifier. Used as `service.name`. |
| `endpoint` | `String` | **(required)** | OTLP-HTTP collector URL. `/v1/traces`, `/v1/metrics`, `/v1/logs` are appended automatically. |
| `serviceVersion` | `String?` | `null` | Maps to `service.version`. Set to your app build version. |
| `secure` | `bool` | `true` | When `endpoint` has no scheme, prefix `https://` (true) or `http://` (false). |
| `headers` | `Map<String, String>?` | `null` | Extra HTTP headers on every OTLP export. Use for auth. |
| `resourceAttributes` | `Map<String, String>?` | `null` | Extra attributes merged into every signal's `Resource`. Use for `deployment.region`, `team`, etc. Static — set once at init. |

### Network

| Field | Type | Default | Description |
|---|---|---|---|
| `enableNetworkTracking` | `bool` | `true` | Wraps `HttpOverrides` globally. Disable if you wire `ScoutFlutter.dioInterceptor` manually. |
| `firstPartyHosts` | `List<String>?` | `null` | Hosts that receive a W3C `traceparent` header for distributed tracing. Supports exact match or `*.host` wildcards. |
| `ignoreUrlPatterns` | `List<RegExp>?` | `null` | URLs matching any pattern are not auto-instrumented. |

### Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionTimeoutMinutes` | `int` | `30` | Inactivity timeout before a new `session.id` is minted. |
| `maxSessionDurationMinutes` | `int` | `60` | Hard cap on session lifetime; rotates on the next ID read past this age regardless of activity. `0` disables. |
| `sessionSampleRate` | `double (0-100)` | `1.0` | Percent of sessions sampled — default **1%**. The decision is made once per session and applies uniformly to **spans, metrics, and logs**: a sampled session sends everything, an unsampled session sends nothing. |
| `alwaysCaptureErrors` | `bool` | `true` | Error / crash / ANR-class spans and error-level logs bypass `sessionSampleRate` and are always exported. Set `false` to subject them to the same gate. |

### Thresholds

| Field | Type | Default | Min | Description |
|---|---|---|---|---|
| `longTaskThresholdMs` | `int` | `100` | `20` | Dart isolate task duration that qualifies as a `long_task` span. |
| `anrThresholdMs` | `int` | `5000` | `1000` | Main-thread block duration that fires an `anr` span. |
| `iosHangThresholdMs` | `int` | `250` | `50` (or `0` to disable) | iOS only — sub-ANR `ui_hang` watchdog. Complements ANR (5 s) and KSCrash `mainThreadDeadlock` (5 s+). Catches micro-stutter / jank. |
| `maxTombstoneBytes` | `int` | `131072` | `4096` | Max bytes of Android `ApplicationExitInfo` tombstone (ANR / native post-mortem) captured per report. |

### Batching & export (applies to spans, metrics, AND logs)

All three signals share one batching model. Each exporter also holds a
single keep-alive HTTP connection for its lifetime (idle timeout sized
to outlive the export interval), so TLS handshakes happen once per app
session per signal — not once per export.

| Field | Type | Default | Min | Description |
|---|---|---|---|---|
| `exportIntervalSeconds` | `int` | `30` | `1` | One export cadence for spans, metrics, and logs. |
| `maxExportBatchSize` | `int` | `512` | `1` | Max items per export batch, per signal. |
| `maxQueueSize` | `int` | `2048` | `1` | Max items buffered awaiting export; overflow is dropped. |
| `maxRetries` | `int` | `0` | `0` | Delivery attempts after a failed export, for every signal. Default **0 = at-most-once**: retrying an ambiguous failure (a timeout whose request the collector may already have ingested) delivers duplicate events. |
| `metricExportIntervalSeconds` | `int?` | `null` | `1` | Metrics-only override of `exportIntervalSeconds`. Unset means metrics follow the unified interval. |
| `vitalsCollectionIntervalSeconds` | `int` | `60` | `1` | How often memory/CPU are polled natively (when the gauges are enabled). |

### Per-metric switches

The SDK ships **no metrics by default** — each gauge/histogram family
is opt-in.

| Field | Default | Description |
|---|---|---|
| `enableFrameMetrics` | `false` | `flutter.frame.build_time` / `flutter.frame.raster_time` histograms. They record on **every rendered frame** with one stream per screen — by far the highest-volume metrics the SDK can produce. Frozen-frame detection (the `frozen_frame` span) stays on regardless. |
| `enableMemoryMetrics` | `false` | The `flutter.memory.usage` gauge. When off, the native poll is skipped entirely. |
| `enableCpuMetrics` | `false` | The `flutter.cpu.usage` gauge, same behavior. |

### Offline buffer

Offline buffering is **fully disabled by default** — nothing is
written to disk, and a batch that fails to export is dropped (strict
at-most-once delivery). Opt in for durability at the cost of possible
duplicate delivery on replay.

| Field | Type | Default | Description |
|---|---|---|---|
| `offlineBufferEnabled` | `bool` | `false` | Master toggle. Set `true` to persist failed batches and replay them on next `initialize()` or connectivity change. |
| `offlineMaxTraceItems` | `int` | `0` | FIFO cap on persisted span items (`0` = signal disabled in the queue). Oldest evicted first. |
| `offlineMaxMetricItems` | `int` | `0` | Same, for metric data points. |
| `offlineMaxLogItems` | `int` | `0` | Same, for log records. |
| `maxOfflineStorageMb` | `int` | `5` | Coarse total-disk cap that runs alongside the per-signal `offlineMax*Items` caps when buffering is enabled — whichever limit is reached first wins. |

### Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. Span and
log instrumentation defaults to **on**; metric collection defaults to
**off** (see [Per-metric switches](#per-metric-switches)).

| Toggle | Default | What you lose when set to `false` |
|---|---|---|
| `enableAutoTapTracking` | `true` | All `user_interaction` spans. |
| `enableErrorTracking` | `true` | `error` spans from `FlutterError.onError` and `PlatformDispatcher.onError`. Manual `reportError()` still works. |
| `enableLifecycleTracking` | `true` | `app_paused` / `app_resumed` spans and the background-flush hook. Heavy loss — recommend leaving on. |
| `enableStartupTracking` | `true` | `app_startup` cold/warm spans **and** the FBC vital. |
| `enableConnectivityTracking` | `true` | `network.connection.type` resource attr updates on network transitions. |
| `enablePerformanceMetrics` | `true` | Master switch for the whole metrics pipeline (exporter + reader). With it on, individual gauges still need their per-metric switches. |
| `enableLongTaskDetection` | `true` | `long_task` spans. Tune with `longTaskThresholdMs` instead of disabling. |
| `enableAnrDetection` | `true` | `anr` spans **and** the iOS `ui_hang` watchdog. |
| `enableNetworkTracking` | `true` | `http.request` spans + `traceparent` injection. |
| `enableLogging` | `true` | `ScoutFlutter.log*()` calls become no-ops. |
| `capturePrintStatements` | `false` | (Off by default) When `true`, mirrors `print` / `debugPrint` calls to OTLP logs. Original console output is preserved. |

### Filtering — `beforeSend`

```dart
ScoutFlutterConfig(
  // …
  beforeSend: (event) {
    // event keys: 'type' ('span'|'metric'|'log'), 'name', plus
    // per-span attributes. Return null to drop the event.
    if ((event['http.url'] as String?)?.contains('/health') == true) {
      return null;
    }
    event.remove('user.email');
    return event;
  },
)
```

**Sees per-span attributes only.** Resource attributes set on the OTel
`Resource` (e.g. `service.name`, `os.name`, `device.*`) are **not** in
the event payload.

## Native crash setup

### iOS — KSCrash + MetricKit

The plugin auto-installs **KSCrash 2.5+** with all five monitors:

- Mach exceptions
- POSIX signals
- C++ exceptions
- NSException
- Main-thread deadlock (5 s+ — complementary to the 250 ms
  `iosHangThresholdMs` watchdog)

On every launch, scout_flutter drains any persisted KSCrash reports
from the previous run and emits them as `native_crash` spans
carrying:

- `crash.reason`, `crash.type`, `crash.signal`, `crash.os_name`,
  `crash.os_version`, `crash.kernel`
- `crash.registers_json` — full CPU register dump including FAR and
  ESR
- `crash.mach_exception`, `crash.mach_code`, `crash.mach_subcode`
- `crash.nsexception_name` (when applicable)
- `crash.callstack_tree_json` — symbolicated stack tree of every
  thread
- `crash.binary_images_json` — loaded image list for offline
  symbolication
- The prior session's last 20 breadcrumbs

In parallel, an `MXMetricManagerSubscriber` collects asynchronous
`MXCrashDiagnostic` and `MXHangDiagnostic` payloads that Apple
delivers the morning after a crash — useful for catching kernel-killed
crashes that KSCrash couldn't intercept.

#### Triggering a crash (testing)

scout_flutter does not ship a "simulate crash" API. To validate
end-to-end capture, trigger a real fault — and **never** use `exit()`,
which is a graceful shutdown that no crash reporter intercepts:

```dart
// Uncaught Dart error → `error` span (and, if fatal, `app_crash` on relaunch).
throw StateError('test crash');
```

For a true native signal (SIGSEGV on Android, `fatalError()` on iOS),
add a small platform-channel method on the app side. The repo's
`example/` app and the
[`flutter/samples/platform_design`](https://github.com/flutter/samples/tree/main/platform_design)
sample ship ready-made crash / ANR / deadlock buttons for exactly this.

### Android — NDK signal handler + ApplicationExitInfo

The plugin auto-installs a **custom NDK signal handler** that catches
SIGSEGV / SIGABRT / SIGBUS / SIGILL / SIGFPE before they kill the
process. A compact crash report (signal info, registers, stack,
memory map, binary images with ELF build-ids) is persisted to disk
and emitted on next launch as a `native_crash` span.

In parallel, on API 30+ (Android 11+), scout_flutter polls
`ActivityManager.getHistoricalProcessExitReasons` and emits a
`native_crash` span for any OS-recorded death newer than the persisted
watermark — **each death is reported exactly once across launches**.
Only crash-class exit reasons are reported (`anr`, `jvm_crash`,
`native_crash`, `low_memory`); benign exits such as the user swiping
the app away (`user_requested`), Force Stop (`user_stopped`), or a
normal `exit()` (`exit_self`) are filtered out and never counted as
crashes. Captured attributes:

- `crash.type` / `crash.reason`
- `crash.subreason` (API 31+ via reflection)
- `crash.exit_status`, `crash.importance`, `crash.death_timestamp_ms`,
  `crash.process_name`, `crash.pid`, `crash.pss_kb`, `crash.rss_kb`
- `crash.tombstone` — the OS's full thread dump with native frames
  (capped at 128 KB by default; tune with `maxTombstoneBytes`)

The two pipelines complement each other: NDK fires in-process at
crash time, ApplicationExitInfo catches deaths that the OS killed
before in-process handlers could write to disk (OOM, hard watchdog,
etc.).

## Background flush

scout_flutter calls `forceFlush()` on every signal provider when the
app transitions to `AppLifecycleState.paused` / `inactive` / `hidden`.
This drains the BatchSpanProcessor, metric reader, and log processor
before the OS suspends the process — without it, events emitted in
the last few seconds (the ones leading up to a crash) would die with
the in-memory batch queue.

If the in-memory exporter still doesn't deliver in time (OS kills us
mid-POST), the batch is dropped under the default at-most-once
delivery. Enable the **offline buffer** (`offlineBufferEnabled: true`
plus per-signal caps) to persist such batches to disk and replay them
on next `initialize()`.

## WebView bridge

Embed a WebView showing a page instrumented with `@base14/scout-react`
(web entry) v0.1.5+, and `scout_flutter` will flatten the WebView's
RUM session into the **native** session — both runtimes share one
`session.id` and `user.anonymous_id`, and the embedded page's spans
flow back into the native pipeline tagged with
`span.source = "webview"`.

```dart
import 'package:scout_flutter/scout_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';

final controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..setNavigationDelegate(
    NavigationDelegate(
      onPageFinished: (_) {
        // Re-inject the shim on every navigation. The shim has a
        // sentinel so re-injecting in the same page is a no-op.
        ScoutWebViewBridge.injectShim(
          runJavaScript: controller.runJavaScript,
        );
      },
    ),
  );

ScoutWebViewBridge.attach(
  addJavaScriptChannel: (name, onMessage) {
    controller.addJavaScriptChannel(
      name,
      onMessageReceived: (m) => onMessage(m.message),
    );
  },
);

await controller.loadRequest(Uri.parse('https://app.example.com'));
```

The bridge:

1. Registers a JavaScript channel (default name `ScoutBridge`) the
   page can `postMessage` into.
2. Injects a JS shim that polls `window.Scout` and calls
   `setWebViewBridge({sessionId, anonymousId, send})` once the page's
   web SDK appears.
3. Receives bridged span payloads via the channel and re-emits them
   as native spans with `span.source = "webview"`, `session.id`,
   `user.anonymous_id`, and the rest of the native common
   attributes.

The bridge is currently a **parallel** transport — both the web SDK's
own OTLP exporter and the native bridge ship a copy of each span.
Configure the web SDK with an unreachable endpoint, or filter
everything with `beforeSend` returning `null`, to make the bridge the
sole transport.

The bridge is generic — `attach()` accepts bare callbacks rather than
a typed `WebViewController`, so it works with `webview_flutter`,
`flutter_inappwebview`, or any future plugin. Adapt the integration
glue (~6 lines) per your plugin of choice.

## What happens when export fails

Delivery is **at-most-once by default** (`maxRetries: 0`): a batch
gets one attempt, and a failed batch is dropped rather than risking a
duplicate delivery (a retried timeout whose first request the
collector already ingested would store the same events twice).

| Failure | What Scout does (defaults) |
|---|---|
| Any export failure, `maxRetries: 0` (default) | One attempt; batch dropped on failure. No duplicates, ever. |
| `maxRetries > 0` configured | Failed batches are retried up to that many times — with the corresponding duplicate risk on ambiguous failures. |
| Failure with `offlineBufferEnabled: true` configured | Batch persisted to disk and replayed on next `initialize()` or connectivity change (single replay attempt). |
| Disk write fails (quota, permissions) | Caught and swallowed; batch dropped. |
| App crash mid-batch | The background-flush hook drains buffers on `paused`; anything emitted after the last flush is lost with the process. |

## Running the example app

The repo ships a runnable example at `example/`. For physical-device
testing of the full diagnostic suite (UI hang, ANR, real SIGSEGV
crash, WebView bridge) the
[`flutter/samples/platform_design`](https://github.com/flutter/samples/tree/main/platform_design)
sample is a good starting point.

```bash
# iOS simulator
cd example
flutter run -d "iPhone 17"

# Android emulator / physical device
flutter run -d <device-id>

# For physical Android: reverse-forward your local collector
adb reverse tcp:34318 tcp:34318
```

## Troubleshooting

| Symptom | Likely cause + fix |
|---|---|
| `ui_hang` never fires on iOS | `iosHangThresholdMs: 0` disables it; check your config. Or the main thread genuinely isn't hanging — try a 300 ms `while` loop to confirm the watchdog is armed. |
| Two `screen_view` per nav | You attached `ScoutFlutter.navigatorObserver` to both the root `MaterialApp` Navigator and a nested `CupertinoTabView` Navigator. That's correct — each Navigator emits its own `screen_view`. Filter dashboards by `view.id` to dedupe. |
| `native_crash` not appearing after iOS crash | KSCrash writes asynchronously; the report drains on the *next* launch. Force-quit and relaunch the app, then check the collector log. |
| Android `native_crash` empty on API < 30 | `ApplicationExitInfo` requires API 30+. Older devices only get whatever the in-process NDK handler caught. |
| WebView spans not tagged `span.source = webview` | Either the embedded page isn't `@base14/scout-react` v0.1.5+ (no `window.Scout`), or your `NavigationDelegate.onPageFinished` is missing the `injectShim(...)` call. |
| `Observer already has a Navigator` assertion | `navigatorObserver` returns a fresh instance on every read, so attaching it to multiple Navigators is fine. If you hit this, you're caching one instance and reusing it — read `ScoutFlutter.navigatorObserver` afresh per Navigator. |
| HTTP requests not getting `traceparent` | The host isn't in `firstPartyHosts`. Add it explicitly (e.g. `'api.example.com'`) or use a wildcard (`'*.example.com'`). |
| Crash button gives a graceful shutdown instead of SIGSEGV | You're calling `exit()`, which is graceful — no crash reporter intercepts it. Trigger a real fault instead (an uncaught error, or a native null-deref via your own platform-channel method). |

## Performance considerations

- **Unified 30 s batching.** Spans, metrics, and logs each flush once
  per `exportIntervalSeconds` (default 30 s) — including logs, which
  are buffered and batched rather than posted per line.
- **Connection reuse.** Each signal holds one keep-alive HTTP
  connection for the app session — TLS handshakes happen ~3 times per
  session, not once per export.
- **No metrics unless enabled.** The default configuration ships zero
  metric data points; the vitals gauges and frame histograms are
  per-app opt-ins.
- **Zero disk usage by default.** Offline buffering is off; the only
  disk writes are crash evidence (crash reports, breadcrumbs, session
  marker).
- **Sampling.** `sessionSampleRate` drops *full sessions* — spans,
  metrics, and logs together — never individual events, so session
  traces stay coherent.
- **Async init.** `ScoutFlutter.initialize()` is fire-and-forget. The
  app boot does not wait on it.

## Security considerations

- **PII scrubbing.** Use `beforeSend` to redact attributes
  (`event.remove('user.email')`) or drop entire events (return
  `null`). It runs synchronously on every span / metric / log before
  export.
- **Custom headers for auth.** Pass
  `headers: {'Authorization': 'Bearer …'}` to authenticate the OTLP
  export. Headers are sent on every request including offline-replay
  POSTs.
- **No telemetry-to-disk PII by default.** The offline buffer writes
  the same OTLP JSON your live exporter would have sent — it doesn't
  add anything extra. If you don't want sensitive attrs on disk,
  scrub them in `beforeSend` *before* the batch hits the buffer.
- **TLS.** Set `secure: true` (default) or pass an explicit
  `https://` endpoint. No CA pinning by default; if you need it,
  wrap the outbound HTTP client yourself.

## FAQ

**Does scout_flutter work on macOS / web / Linux / Windows desktop?**

iOS and Android are fully supported, including native crash capture.
macOS works for the Dart-side instrumentation (taps, navigation,
HTTP, errors, lifecycle, logs) but the KSCrash / MetricKit /
ApplicationExitInfo pipelines are mobile-only. Web works for
Dart-side instrumentation — for richer web RUM, use
`@base14/scout-react` directly in a web app and (for hybrid apps)
bridge with the WebView bridge.

**Will the SDK ever block my app's boot?**

No. `ScoutFlutter.initialize()` is async and fire-and-forget — wrap
it in `unawaited(...)` as shown above. If init fails (network down,
disk full, etc.) the error is swallowed; your app keeps running.

**How big are crash reports on the wire?**

A KSCrash report with full register dump + callstack tree typically
serializes to 30–80 KB. ApplicationExitInfo tombstones are capped at
128 KB by default (`maxTombstoneBytes`). They're sent as part of the
next launch's first batch — each death exactly once.

**Can I add custom spans?**

Yes — the underlying OTel Tracer is accessible. Custom spans go
through the same beforeSend / sampling / export pipeline as
auto-instrumented ones.

**Can I emit metrics or logs manually?**

Yes:

```dart
ScoutFlutter.logInfo('checkout started', attributes: {'cart.size': 3});
ScoutFlutter.logError('payment failed', attributes: {'order.id': 'ord-1'});

// For an error with a stack trace, use reportError (emits an `error` span):
ScoutFlutter.reportError(e, st);
```

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Look at [React Native + React Web instrumentation](/instrument/mobile/react-native)
  for the JavaScript equivalent (and the WebView bridge counterpart)

## References

- scout_flutter repo:
  [github.com/base-14/scout-flutter](https://github.com/base-14/scout-flutter)
- scout-react repo (web + RN companion):
  [github.com/base-14/scout-react](https://github.com/base-14/scout-react)
- KSCrash: [github.com/kstenerud/KSCrash](https://github.com/kstenerud/KSCrash)
- Apple MetricKit:
  [developer.apple.com/documentation/metrickit](https://developer.apple.com/documentation/metrickit)
- Android ApplicationExitInfo:
  [developer.android.com/reference/android/app/ApplicationExitInfo](https://developer.android.com/reference/android/app/ApplicationExitInfo)
