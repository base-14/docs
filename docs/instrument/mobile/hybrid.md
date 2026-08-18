---
title: Hybrid Instrumentation - Native + Flutter RUM in one session
sidebar_label: Hybrid (Native + Flutter)
sidebar_position: 27
description:
  Instrument add-to-app hybrids, a native Android/iOS app embedding Flutter,
  with Scout so native and Flutter OpenTelemetry RUM stitch into one session,
  same-process or in a separate process.
keywords:
  [
    hybrid mobile observability,
    hybrid opentelemetry,
    add-to-app flutter,
    flutter embed native,
    native flutter session,
    android process flutter,
    unified session rum,
    scout-android,
    scout-flutter,
    base14,
  ]
---

# Hybrid (Native + Flutter)

An add-to-app hybrid is a native Android (Kotlin) or iOS (Swift) app that embeds
Flutter for some screens. To instrument one, initialize the native SDK and
`scout_flutter` with the same `serviceName` and `endpoint`. The Flutter SDK
detects the native SDK and delegates to it, and both layers report under one
`session.id`.

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## What You Get

| Capability | Owner | Notes |
|---|---|---|
| Unified session | Native | The native side mints the session; the Flutter side adopts its `session.id`. One session across both scopes |
| Export pipeline | Native | Flutter forwards spans, logs, and metrics over the bridge. Same-process, one exporter for both layers; different-process, one per process |
| Breadcrumbs, user and session attributes | Shared | Set on either side, visible to both |
| Native Android telemetry | `scout-android` | Screens, taps, HTTP, JVM and NDK crashes, ANR, jank, vitals. See [Android](./android.md) |
| Native iOS telemetry | Bridge engine | Screens, KSCrash native crashes, app hangs, MetricKit diagnostics, HTTP, jank, vitals. Taps and startup tracking are off in bridge mode |
| Flutter telemetry | `scout_flutter` | Screens, taps, HTTP, errors, and jank from the Flutter layer, forwarded to the native side. See [Flutter](./flutter.md) |
| Crash de-duplication | Native | In hybrid mode `scout_flutter` drains and discards its own crash files, so a crash is reported once |

## How it works

- The native SDK (`scout-android` on Android; the Kotlin/Native engine that
  ships inside `scout_flutter` on iOS) and the Flutter SDK (`scout_flutter`)
  both run inside your app.
- `scout_flutter` delegates to the native SDK, forwarding its spans, logs, and
  metrics to the native side, which owns the export pipeline. Same-process, that
  is a single OTLP exporter for both layers. In a separate `:flutter` process
  each process runs its own exporter, described in
  [Different-process](#different-process).
- The native side owns the session; the Flutter side adopts that `session.id`.
  Breadcrumbs and user/session attributes are shared.

In your backend you see one service (the shared service name) with two
OpenTelemetry instrumentation scopes, all under one `session.id`:

| Platform | Native scope | Flutter scope |
| --- | --- | --- |
| Android | `base14.scout.android` | `base14.scout.flutter` |
| iOS | `base14.scout.ios` | `base14.scout.flutter` |

### Process models

| Platform | Same-process | Different-process |
| --- | --- | --- |
| Android | Default (no `android:process`) | `android:process=":flutter"` |
| iOS | Only mode; iOS apps are single-process | Not applicable |

## Prerequisites

| Requirement | Version |
| --- | --- |
| Android native SDK | `io.base14:scout-android:0.1.7` (Maven Central) |
| Flutter SDK | `scout_flutter` `^0.2.0` |
| iOS native engine | Ships inside `scout_flutter`; no separate dependency |

The hybrid bridge lands in `scout_flutter` 0.2.0. The `0.1.x` line does not
include the native delegation bridge, so use `0.2.0` or later for hybrid apps.

Both inits must use the same `serviceName` and `endpoint`. That is what ties the
two layers to one service; the bridge then unifies the session automatically.

---

## Android

On Android you initialize the native `scout-android` SDK in your native host and
initialize `scout_flutter` in Dart. The native SDK becomes the session owner and
the sole exporter; `scout_flutter` detects it and bridges automatically.

### 1. Dependencies

`android/app/build.gradle.kts` (native host):

```kotlin
dependencies {
    implementation("io.base14:scout-android:0.1.7")
}
```

`pubspec.yaml` (Flutter module):

```yaml
dependencies:
  scout_flutter: ^0.2.0
```

### 2. Initialize the native SDK (session owner)

Initialize Scout in `Application.onCreate`, once per process, before any
`Activity` starts, whether that is your native host or the embedded
`FlutterActivity`:

```kotlin
package com.example.myapp

import android.app.Application
import io.base14.scout.android.Scout
import io.base14.scout.core.ScoutConfig

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Scout.initialize(
            this,
            ScoutConfig(
                serviceName = "my-hybrid-app",                 // MUST match Flutter
                endpoint = "https://<your-collector>/otlp",     // MUST match Flutter
                headers = mapOf("Authorization" to "Bearer <token>"),
                // Leave `role` at its ScoutRole.AUTO default; see Different-process.
            ),
        )
    }
}
```

Register it in `AndroidManifest.xml`:

```xml
<application android:name=".MyApplication" ...>
```

This also auto-instruments your native screens (Compose and Views), taps, HTTP,
crashes, ANR, and frame metrics. See [Android](./android.md).

### 3. Initialize scout_flutter (same service name + endpoint)

In your Flutter module's `main()`:

```dart
import 'package:flutter/widgets.dart';
import 'package:scout_flutter/scout_flutter.dart';

Future<void> main() async {
  // Required: initialize() talks to the native side over a platform channel,
  // which needs the binding in place.
  WidgetsFlutterBinding.ensureInitialized();

  await ScoutFlutter.initialize(
    config: ScoutFlutterConfig(
      serviceName: 'my-hybrid-app',                    // MUST match native
      endpoint: 'https://<your-collector>/otlp',        // MUST match native
      headers: const {'Authorization': 'Bearer <token>'},
    ),
  );
  runApp(const MyApp());
}
```

`scout_flutter` detects the already-initialized native SDK and delegates to it,
forwarding all Flutter telemetry through the bridge and adopting the native
`session.id`. No extra wiring is required.

### 4. Launch Flutter from the native host

Add a `FlutterActivity` subclass for the Flutter UI (a bare subclass is enough;
add a `MethodChannel` only if you call native code from Dart):

```kotlin
package com.example.myapp

import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity()
```

Then present it from your native host:

```kotlin
startActivity(Intent(this, MainActivity::class.java))
```

:::note Init ordering
You don't need to hand-sequence the two SDKs. Initialize each at its own entry
point: native in `Application.onCreate`, Flutter in `main()`. `onCreate` runs
before any `Activity`, so the native session owner is always in place by the
time the Flutter side attaches. Same-process is order-independent regardless:
whichever SDK initializes first establishes the shared owner.
:::

### 5. Choose a process model

#### Same-process (default, recommended)

The Flutter `Activity` runs in the same OS process as the native host. Declare
it in `AndroidManifest.xml` without an `android:process` attribute:

```xml
<activity
    android:name=".MainActivity"
    android:exported="false"
    android:launchMode="singleTop"
    android:theme="@style/LaunchTheme"
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
    android:hardwareAccelerated="true"
    android:windowSoftInputMode="adjustResize">
    <!-- Theme applied once the Flutter UI has initialized. Without it the
         launch theme stays behind the Flutter surface. -->
    <meta-data
        android:name="io.flutter.embedding.android.NormalTheme"
        android:resource="@style/NormalTheme" />
</activity>
```

Unification happens in memory: the native and Flutter SDKs share the same
process, so the Flutter side reads the native session directly. This is the
default.

#### Different-process

If your Flutter `Activity` must run in a separate OS process, usually for memory
isolation, add `android:process=":flutter"`:

```xml
<activity
    android:name=".MainActivity"
    android:process=":flutter"
    android:exported="false"
    android:launchMode="singleTop"
    ... />
```

`Application.onCreate` runs again in the `:flutter` process, so `Scout.initialize`
runs there too. That process cannot read the main process's in-memory owner, so
the bridge queries `ScoutBridgeProvider` instead. This is a `ContentProvider`
that `scout-android` declares in its own manifest with authority
`${applicationId}.scout.bridge`, `android:exported="false"`, and
`android:multiprocess="false"`, so a single instance runs in the main process.
It returns the live session context, and the `:flutter` process adopts the same
`session.id`. You do not declare the provider yourself; the manifest merger
pulls it in.

:::warning Keep `role` at `ScoutRole.AUTO` here
The Android bridge only performs the cross-process lookup when `role` is not
`OWNER`. Setting `role = ScoutRole.OWNER` skips it, so the `:flutter` process
mints its own session and you get two sessions. `AUTO`, the default, resolves
ownership correctly in both process models.

The `flutter-android-example` app in the `scout-kotlin-multiplatform` repo does
set `ScoutRole.OWNER`. That is safe there because it runs same-process, where
the lookup is not needed. Do not copy it into a different-process app.
:::

In the backend you still get one session across both scopes, but each process
runs its own exporter: the main process exports native telemetry, the
`:flutter` process exports the forwarded Flutter telemetry. That is two export
pipelines and two processes, which is the overhead this mode costs you.

:::tip Choosing a process model
Prefer same-process unless you have a specific reason to isolate Flutter, such
as a memory-heavy Flutter surface you want the OS to reclaim independently. Both
produce one unified session.
:::

---

## iOS

iOS apps are single-process, so there is only one process model. You do not
write any native Scout initialization for the bridge. `scout_flutter` starts the
native iOS engine in bridge mode for you.

### 1. Dependency

Add `scout_flutter` to your Flutter module. The iOS native engine is bundled
with the plugin (no separate native dependency).

```yaml
dependencies:
  scout_flutter: ^0.2.0
```

### 2. Initialize scout_flutter

In your Flutter module's `main()`, same as Android:

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await ScoutFlutter.initialize(
    config: ScoutFlutterConfig(
      serviceName: 'my-hybrid-app',
      endpoint: 'https://<your-collector>/otlp',
      headers: const {'Authorization': 'Bearer <token>'},
    ),
  );
  runApp(const MyApp());
}
```

On iOS, `scout_flutter` starts the native Kotlin/Native engine in bridge mode
internally (via `Scout.startBridge`). That engine emits the `base14.scout.ios`
scope and shares one `session.id` with the Flutter layer. No native Swift init
code is required.

### 3. Present Flutter from the native host

Standard add-to-app: keep a cached `FlutterEngine` and present a
`FlutterViewController`:

```swift
lazy var flutterEngine = FlutterEngine(name: "my_engine")

func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: ...) -> Bool {
  flutterEngine.run()
  GeneratedPluginRegistrant.register(with: flutterEngine)
  return super.application(application, didFinishLaunchingWithOptions: launchOptions)
}

func presentFlutter() {
  let vc = FlutterViewController(engine: flutterEngine, nibName: nil, bundle: nil)
  vc.modalPresentationStyle = .fullScreen
  keyWindow?.rootViewController?.present(vc, animated: true)
}
```

:::note What bridge mode leaves out on iOS
The engine `scout_flutter` starts for you covers sessions, screen views,
KSCrash native crashes, app hangs, MetricKit `MXCrashDiagnostic` /
`MXHangDiagnostic` diagnostics, HTTP, jank, and vitals on the native side.
Two things are off in bridge mode:

- Tap tracking (`enableTapTracking` defaults to `false`).
- Startup and cold-start tracking (`enableStartupTracking` defaults to `false`).

To get both, call `Scout.start(...)` yourself in
`application(_:didFinishLaunchingWithOptions:)` **before** `flutterEngine.run()`,
using the same `serviceName` and `endpoint` as the Flutter config. The engine is
a first-wins singleton: whichever of `Scout.start` and the plugin's
`Scout.startBridge` runs first configures it, and the later call is a no-op.
Calling `Scout.start` after Flutter has started has no effect. See
[iOS](./ios.md).
:::

---

## Configuration in hybrid mode

- Service name and endpoint must match on both sides. A mismatch produces two
  separate services and no session unification.
- The native SDK is the exporter. Batching and retry settings on the native
  config govern what actually leaves the device; the Flutter side forwards to it
  rather than exporting directly. In different-process, each process applies
  these settings to its own exporter.
- The Flutter config is forwarded to the native side through the bridge:
  `exportIntervalSeconds`, `maxExportBatchSize`, `maxQueueSize`, `maxRetries`,
  `metricExportIntervalSeconds`, `firstPartyHosts`, and `debugLogging`.
- Crash and ANR/app-hang reporting is handled by the native side in hybrid mode.
- For the per-layer configuration options, see the platform pages:
  [Android](./android.md), [iOS](./ios.md), and [Flutter](./flutter.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Two separate services** in the backend instead of one | The native and Flutter inits used a different `serviceName` or `endpoint` | Make `serviceName` and `endpoint` identical on both sides. That is what ties them to one service. |
| **Flutter screens/events don't appear** (native data does) | `ScoutFlutter.initialize(...)` never ran, or ran with a non-hybrid build of `scout_flutter` | Ensure `ScoutFlutter.initialize` runs in `main()` before `runApp`, using `scout_flutter` `0.2.0` or later. |
| **`main()` throws on startup** before any telemetry appears | `ScoutFlutter.initialize` reaches the native side over a platform channel, which needs the binding | Call `WidgetsFlutterBinding.ensureInitialized()` as the first line of `main()`. |
| **Flutter data lands but under a different `session.id`** than native (not unified) | Different-process only: `role` was set to `ScoutRole.OWNER`, so the `:flutter` process skipped the cross-process lookup and minted its own session | Leave `role` at its `ScoutRole.AUTO` default. Same-process is unaffected. |
| **Native screens/events don't appear on Android** | The native SDK was never initialized | Call `Scout.initialize` in `Application.onCreate`. |
| **No native taps or cold-start spans on iOS** | Bridge mode leaves tap tracking and startup tracking off | Call `Scout.start(...)` in `application(_:didFinishLaunchingWithOptions:)` before `flutterEngine.run()`. Screens, KSCrash crashes, hangs, and MetricKit diagnostics are already covered without it. |

## FAQ

**Do I need to change my Flutter code for hybrid?**

No. The same `ScoutFlutter.initialize` call works. It detects the native SDK and
delegates automatically. Matching `serviceName` and `endpoint` is the only
requirement.

**What happens if I use `scout_flutter` 0.1.x in a hybrid app?**

The `0.1.x` line has no delegation bridge, so both SDKs export independently.
You get two sessions under one service instead of one unified session.

**Does the bridge change anything for pure-Flutter apps?**

Yes. From 0.2.0 the native engine starts alongside the Flutter SDK on both
platforms, even with no native host. A pure-Flutter app gains a native scope
with native crash capture and CPU/memory vitals. Flutter telemetry is unchanged.

**Can the two layers use different service names?**

No. A different `serviceName` or `endpoint` on either side produces two separate
services and no session unification.

**Does iOS need a separate native dependency?**

No. The iOS engine ships inside `scout_flutter` through the
`scout-kotlin-multiplatform` Swift package.

## What's next

- [Configure your collector](/instrument/collector-setup/docker-compose-example/)
  to receive OTLP-HTTP on `:4318`
- Explore the data in [RUM](/operate/rum/getting-started) - both layers appear
  under the one session you just unified
- Read the per-layer pages for the configuration options this page does not
  cover: [Android](/instrument/mobile/android), [iOS](/instrument/mobile/ios),
  and [Flutter](/instrument/mobile/flutter)
- Read [RUM with OpenTelemetry](/instrument/mobile/rum-opentelemetry) if you need
  the span names and attributes behind those views

## References

- scout_flutter repo:
  [github.com/base-14/scout-flutter](https://github.com/base-14/scout-flutter)
- scout-kotlin-multiplatform repo:
  [github.com/base-14/scout-kotlin-multiplatform](https://github.com/base-14/scout-kotlin-multiplatform)
- Flutter add-to-app:
  [docs.flutter.dev/add-to-app](https://docs.flutter.dev/add-to-app)
- Android manifest `android:process`:
  [developer.android.com/guide/topics/manifest/activity-element#proc](https://developer.android.com/guide/topics/manifest/activity-element#proc)
