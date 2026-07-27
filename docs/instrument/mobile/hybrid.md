---
title: Hybrid Instrumentation - Native + Flutter RUM with one unified session
sidebar_label: Hybrid (Native + Flutter)
sidebar_position: 24
description:
  Instrument add-to-app hybrids — a native Android/iOS app embedding Flutter —
  with Scout so native and Flutter telemetry stitch into one unified session,
  same-process or in a separate process.
keywords:
  [
    hybrid mobile observability,
    add-to-app flutter,
    flutter embed native,
    native flutter session,
    scout hybrid,
    android process flutter,
    unified session rum,
  ]
---

# Hybrid (Native + Flutter) instrumentation

Many production apps are **add-to-app** hybrids: a native Android (Kotlin) or
iOS (Swift) app that embeds Flutter for some screens. Instrumenting each layer
in isolation gives you two disconnected views of the same user — a native
session and a Flutter session that never join up.

Scout instruments **both** layers and stitches them into **one session**, so a
journey that crosses the native ↔ Flutter boundary is a single, continuous
session in your backend.

## How it works

- The **native SDK** (`scout-android` on Android; the Kotlin/Native engine that
  ships inside `scout_flutter` on iOS) and the **Flutter SDK** (`scout_flutter`)
  both run inside your app.
- `scout_flutter` **delegates to the native SDK**: it forwards its spans, logs,
  and metrics to the native side, which is the **single exporter** to your
  collector. You get one export pipeline, not two.
- The native side **owns the session**; the Flutter side **adopts that
  `session.id`**. Breadcrumbs and user/session attributes are shared.

In your backend you see **one service** (the shared service name) with **two
instrumentation scopes**, all under **one `session.id`**:

| Platform | Native scope | Flutter scope |
| --- | --- | --- |
| Android | `base14.scout.android` | `base14.scout.flutter` |
| iOS | `base14.scout.ios` | `base14.scout.flutter` |

### Process models

| Platform | Same-process | Different-process |
| --- | --- | --- |
| **Android** | ✅ Default (no `android:process`) | ✅ `android:process=":flutter"` |
| **iOS** | ✅ Only mode — iOS apps are single-process | — Not applicable |

:::note scout_flutter version

The hybrid bridge lands in **`scout_flutter` 0.2.0** (the `0.2.x` line). The
`0.1.x` line does not include the native delegation bridge — use `0.2.0` or
later for hybrid apps.

:::

## Prerequisites

- **Same `serviceName` and `endpoint` on both the native and Flutter init.**
  This is what ties the two layers to one service; the bridge then unifies the
  session automatically.
- Android native SDK: `io.base14:scout-android:0.1.7` (Maven Central).
- Flutter SDK: `scout_flutter` **`^0.2.0`** — the `0.2.x` line includes the
  native delegation bridge.
- The iOS native engine ships **inside** `scout_flutter` — you do not add a
  separate iOS native dependency for the bridge.

---

## Android

On Android you initialise the native `scout-android` SDK in your native host and
initialise `scout_flutter` in Dart. The native SDK becomes the session owner and
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

In your launcher `Activity` (or `Application`), before presenting Flutter:

```kotlin
import io.base14.scout.android.Scout
import io.base14.scout.core.ScoutConfig

Scout.initialize(
    this,
    ScoutConfig(
        serviceName = "my-hybrid-app",                 // MUST match Flutter
        endpoint = "https://<your-collector>/otlp",     // MUST match Flutter
        headers = mapOf("Authorization" to "Bearer <token>"),
        // role defaults to ScoutRole.AUTO — leave it; the bridge resolves ownership.
    ),
)
```

This also auto-instruments your **native** screens (Compose / Views), taps,
HTTP, crashes, ANR, and frame metrics — see [Android](./android.md).

### 3. Initialize scout_flutter (same service name + endpoint)

In your Flutter module's `main()`:

```dart
import 'package:scout_flutter/scout_flutter.dart';

void main() async {
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

`scout_flutter` detects the already-initialised native SDK and **delegates** to
it — forwarding all Flutter telemetry through the bridge and adopting the native
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
You don't need to hand-sequence the two SDKs. Initialise each at its own entry
point — native in the host's `onCreate`, Flutter in `main()`. Because the native
host is shown first and initialises Scout **before** it launches Flutter, the
native session owner is always in place by the time the Flutter side attaches.
(Same-process is order-independent regardless — whichever SDK initialises first
establishes the shared owner. In different-process, keep native init in the host,
which naturally runs before the Flutter process starts.)
:::

### Same-process (default, recommended)

The Flutter `Activity` runs in the **same OS process** as the native host.
Declare it in `AndroidManifest.xml` **without** an `android:process` attribute:

```xml
<activity
    android:name=".MainActivity"
    android:exported="false"
    android:launchMode="singleTop"
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
    android:hardwareAccelerated="true"
    android:windowSoftInputMode="adjustResize" />
```

Unification happens **in-memory** (the native and Flutter SDKs share the same
process, so the Flutter side reads the native session directly). This is the
default and the lowest-overhead option.

### Different-process

If your Flutter `Activity` must run in a **separate OS process** (for memory
isolation), add `android:process=":flutter"`:

```xml
<activity
    android:name=".MainActivity"
    android:process=":flutter"
    android:exported="false"
    android:launchMode="singleTop"
    ... />
```

Here the Flutter process cannot read the native session in-memory, so the bridge
falls back to a **persisted cross-process owner record**: the Flutter process
reads the native session context and **adopts** the same `session.id`. The
result is identical in the backend — one session across both scopes — at the
cost of a slightly heavier bridge and a second process.

:::tip Which process model?
Prefer **same-process** unless you have a specific reason to isolate Flutter
(e.g. a memory-heavy Flutter surface you want the OS to reclaim independently).
Both produce one unified session.
:::

---

## iOS

iOS apps are **single-process**, so there is only one process model. You do
**not** write any native Scout initialisation for the bridge — `scout_flutter`
starts the native iOS engine in bridge mode for you.

### 1. Dependency

Add `scout_flutter` to your Flutter module. The iOS native engine is bundled
with the plugin (no separate native dependency).

```yaml
dependencies:
  scout_flutter: ^0.2.0
```

### 2. Initialize scout_flutter

In your Flutter module's `main()` — same as Android:

```dart
await ScoutFlutter.initialize(
  config: ScoutFlutterConfig(
    serviceName: 'my-hybrid-app',
    endpoint: 'https://<your-collector>/otlp',
    headers: const {'Authorization': 'Bearer <token>'},
  ),
);
```

On iOS, `scout_flutter` starts the native Kotlin/Native engine in **bridge mode**
internally (via `Scout.startBridge`). That engine emits the `base14.scout.ios`
scope (session, crash, hang, vitals) and shares one `session.id` with the
Flutter layer. **No native Swift init code is required.**

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

:::note Native iOS screens
In this hybrid setup, Scout instruments the **Flutter** UI plus the shared
native engine (session, crashes, app-hangs, vitals). Your app's own **native
SwiftUI/UIKit screens are not auto-instrumented** unless you additionally
initialise the native iOS SDK yourself — see [iOS](./ios.md).
:::

---

## Notes

- **Service name + endpoint must match** on both sides. A mismatch produces two
  separate services and no session unification.
- The **native SDK is the exporter**. Batching/retry settings on the native
  config (`exportIntervalSeconds`, `maxExportBatchSize`, `maxQueueSize`,
  `maxRetries`) govern what actually leaves the device; the Flutter side
  forwards to it rather than exporting directly.
- Crash and ANR/app-hang reporting is handled by the native side in hybrid mode.
- For the per-layer configuration options, see the platform pages:
  [Android](./android.md), [iOS](./ios.md), and [Flutter](./flutter.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **Two separate services** in the backend instead of one | The native and Flutter inits used a different `serviceName` or `endpoint` | Make `serviceName` **and** `endpoint` identical on both sides — this is what ties them to one service. |
| **Flutter screens/events don't appear** (native data does) | `ScoutFlutter.initialize(...)` never ran, or ran with a non-hybrid build of `scout_flutter` | Ensure `ScoutFlutter.initialize` runs in `main()` before `runApp`, using the hybrid `scout_flutter` version. |
| **Flutter data lands but under a different `session.id`** than native (not unified) | The bridge didn't attach — in different-process, the Flutter process started before the native host initialised Scout | Keep native `Scout.initialize` in the host and launch Flutter **from** the host (so native init runs first). For same-process this can't happen. |
| **Native screens/events don't appear** | On Android the native SDK was never initialised in the host (on iOS the native side starts automatically with `scout_flutter`) | Android: call `Scout.initialize` in the host `Activity`/`Application`. |
