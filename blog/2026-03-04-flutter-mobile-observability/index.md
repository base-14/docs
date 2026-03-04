---
slug: flutter-mobile-observability
title: "Flutter Mobile Observability with OpenTelemetry"
description: "Two approaches to instrumenting Flutter apps with OpenTelemetry, automatic RUM with Flutterific and direct SDK control, and how to choose between them."
authors: [nimisha-gj]
tags: [flutter, opentelemetry, mobile, rum, observability, dart]
unlisted: true
date: 2026-03-04
---

Most teams have solid observability on their backend. Structured logs,
distributed traces, SLOs, alerting. The mobile app, which is often the first
thing a user touches, gets crash reports at best.

A user taps a button and nothing happens. Was it the network? A janky frame
that swallowed the tap? A backend timeout? A state management bug? Without
telemetry on the device, you are guessing.

This post explains a couple of approaches we have used to help our customers
instrument their Flutter apps and when to use each approach.

<!--truncate-->

## Why Mobile Observability Is Different

With a backend service, you can SSH in, read logs, attach a debugger, and
deploy a fix in minutes. On mobile, your code runs on hardware you have never
seen, over networks you do not manage, inside an OS that will kill your process
to save battery.

A few things make mobile uniquely hard:

- **Battery constraints.** Telemetry export burns power. You need batching,
  compression, and sampling strategies that respect the device.
- **Unreliable connectivity.** Spans need to be buffered and retried. You
  cannot assume the network is there when you need it.
- **Background kills.** The OS can terminate your app at any time. If you
  haven't flushed your telemetry buffer, those spans are gone.
- **Release cycles.** You can't hot-fix a mobile app. A bad instrumentation
  build ships to the App Store and stays there until the next review cycle.

These constraints mean you can't just bolt your backend tracing library onto a
Flutter app and call it done. You need instrumentation designed for mobile.

## Two Approaches to Flutter Instrumentation

We documented two paths, each built on OpenTelemetry.

**Flutterific RUM** gives you automatic session-level monitoring. Drop in the
package, add a route observer, and you get session tracking, screen load times,
jank detection, ANR monitoring, cold start measurement, and navigation spans.
No per-signal tracing code required.

**Direct OpenTelemetry SDK** gives you full control. You manage span creation,
configure W3C trace context propagation to correlate mobile spans with backend
traces, add battery-aware sampling, and build custom conversion funnels.

Here's how they compare:

| | Flutterific RUM | Direct SDK |
| :--- | :--- | :--- |
| **Session tracking** | Automatic | Manual |
| **Device/app/network context** | Automatic on every span | Manual |
| **Navigation spans** | Automatic | Manual |
| **Screen load/dwell times** | Automatic | Not included |
| **Cold start measurement** | Automatic | Manual |
| **Jank/ANR detection** | Automatic | Not included |
| **HTTP tracing** | Via `RumHttpClient` wrapper | Via `HttpService` with W3C propagation |
| **W3C trace context propagation** | Not included | Automatic |
| **Battery-aware sampling** | Not included | Automatic |
| **Conversion funnel tracking** | Not included | Via `FunnelTrackingService` |
| **Custom spans and events** | Supported | Supported |
| **Best for** | RUM dashboards, UX monitoring | Backend correlation, fine-grained control |

The Flutterific setup is minimal. Here's the entry point:

```dart title="lib/main_otel.dart"
import 'package:flutter/material.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'main.dart';
import 'otel/otel_config.dart';
import 'otel/rum_cold_start.dart';

Future<void> main() async {
  RumColdStart.markMainStart();
  await OTelConfig.initialize();
  WidgetsBinding.instance.addObserver(OTelConfig.lifecycleObserver);
  runApp(const MyApp());
  RumColdStart.measureFirstFrame();
}
```

The `lib/otel/` directory holds session management, route observation, jank
detection, and span export. The
[Flutterific RUM reference](/instrument/mobile/flutter-rum-flutterific/) covers
every file.

## What You Get Out of the Box

With Flutterific RUM, the following signals are collected automatically once
you wire up the route observer and lifecycle observer:

| Signal | What's Captured |
| :--- | :--- |
| **Session** | `session.id`, `session.start`, `session.duration_ms` on every span |
| **Device** | `device.model`, `device.id`, `os.type`, `os.version` |
| **App** | `app.version`, `app.build_number`, `app.package_name` |
| **Network** | `network.type` (wifi / cellular / none), live updates |
| **Cold Start** | `app.cold_start` span with duration histogram |
| **Screen Load** | `screen.load` span with timing histogram |
| **Screen Dwell** | `screen.dwell` span with duration histogram |
| **Navigation** | `navigation.push` / `pop` / `replace` / `remove` spans |
| **Jank** | `jank.frame` spans for frames exceeding 16ms |
| **ANR** | `anr.detected` spans when the main thread blocks for 5+ seconds |
| **Lifecycle** | `app_lifecycle.changed` spans (active, inactive, paused) |

Additional signals like user identity, button clicks, rage click detection,
HTTP requests, and custom business events are available with a few lines of
code each.

## Getting Started

Start with the
[Flutter Mobile Observability guide](/guides/flutter-mobile-observability/).
It walks through choosing an approach, installing dependencies, initializing
telemetry, and verifying that spans reach your collector. Takes about 15-20
minutes.

The decision framework is straightforward:

- **Use Flutterific RUM** if you want session-level UX monitoring (jank,
  screen times, navigation patterns) with minimal boilerplate.
- **Use the Direct SDK** if you need W3C trace propagation to correlate mobile
  and backend spans, or if you want full control over sampling and batching.

The full reference docs cover everything from directory structure to production
deployment:

- [Flutter RUM with Flutterific](/instrument/mobile/flutter-rum-flutterific/),
  automatic RUM instrumentation
- [Flutter OpenTelemetry (Direct SDK)](/instrument/mobile/flutter/), direct
  SDK with W3C propagation and battery-aware sampling
- [Flutter Mobile Observability guide](/guides/flutter-mobile-observability/),
  quickstart that covers both approaches

## Closing

Every production service gets traces and metrics. Mobile apps should too.
OpenTelemetry makes it possible without locking into a vendor, and Flutter's
single-codebase model means you instrument once and cover both platforms.
