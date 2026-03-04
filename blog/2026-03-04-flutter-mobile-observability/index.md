---
slug: flutter-mobile-observability
title: "Flutter Mobile Observability with OpenTelemetry"
description: "Two approaches to instrumenting Flutter apps with OpenTelemetry, automatic RUM with Flutterific and direct SDK control, and how to choose between them."
authors: [nimisha-gj]
tags: [flutter, opentelemetry, mobile, rum, observability, dart]
unlisted: false
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
| **HTTP tracing** | Via `RumHttpClient` wrapper | Via `HttpService` wrapper |
| **W3C trace context propagation** | Automatic (`traceparent` header) | Automatic |
| **Battery-aware sampling** | Automatic (4-tier adaptive) | Automatic |
| **Breadcrumb trail** | Automatic (last 20 actions on error spans) | Not included |
| **Error boundary widget** | Included | Not included |
| **Flush on background** | Automatic (`AppLifecycleListener`) | Manual |
| **Conversion funnel tracking** | Not included | Via `FunnelTrackingService` |
| **Custom spans and events** | Supported | Supported |
| **Best for** | RUM dashboards, UX monitoring | Backend correlation, fine-grained control |

The Flutterific setup is minimal. Here's the entry point:

```dart title="lib/main_otel.dart"
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';

import 'main.dart';
import 'otel/otel_config.dart';
import 'otel/rum_cold_start.dart';
import 'otel/rum_session.dart';

Future<void> main() async {
  RumColdStart.markMainStart();

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    RumSession.instance.forceNextSample();
    RumSession.instance.recordBreadcrumb(
      'error',
      'flutter_error: ${details.exceptionAsString()}',
    );
    FlutterOTel.reportError(
      details.exceptionAsString(),
      details.exception,
      details.stack,
      attributes: {
        'app.screen.name': RumSession.instance.currentScreen,
        'session.id': RumSession.instance.sessionId,
        'error.breadcrumbs': RumSession.instance.getBreadcrumbString(),
      },
    );
    OTelConfig.flush();
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    RumSession.instance.forceNextSample();
    RumSession.instance.recordBreadcrumb(
      'error',
      'uncaught_error: ${error.runtimeType}',
    );
    FlutterOTel.reportError(
      'Uncaught error',
      error,
      stack,
      attributes: {
        'app.screen.name': RumSession.instance.currentScreen,
        'session.id': RumSession.instance.sessionId,
        'error.breadcrumbs': RumSession.instance.getBreadcrumbString(),
      },
    );
    OTelConfig.flush();
    return true;
  };

  await OTelConfig.initialize();
  WidgetsBinding.instance.addObserver(OTelConfig.lifecycleObserver);

  AppLifecycleListener(
    onPause: () {
      OTelConfig.flush();
      OTelConfig.pauseJankDetection();
    },
    onResume: () {
      OTelConfig.resumeJankDetection();
      RumSession.instance.refreshBatteryState();
    },
    onExitRequested: () async {
      await OTelConfig.shutdown();
      return AppExitResponse.exit;
    },
  );

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
| **Device** | `device.model.identifier`, `device.model.name`, `device.manufacturer`, `os.type`, `os.version` |
| **App** | `service.version`, `app.build_id`, `app.installation.id` |
| **Network** | `network.type` (wifi / cellular / none), live updates |
| **Battery** | `device.battery.level`, `device.battery.state` with 4-tier adaptive sampling |
| **Cold Start** | `app.cold_start` span with duration histogram |
| **Screen Load** | `screen.load` span with timing histogram |
| **Screen Dwell** | `screen.dwell` span with duration histogram |
| **Navigation** | `navigation.push` / `pop` / `replace` / `remove` spans |
| **Jank** | `jank.frame` spans for frames exceeding 16ms |
| **ANR** | `anr.detected` spans when the main thread blocks for 5+ seconds |
| **Lifecycle** | `app_lifecycle.changed` spans (active, inactive, paused) |
| **Breadcrumbs** | Last 20 user actions attached to error spans as `error.breadcrumbs` |
| **W3C Propagation** | `traceparent` header injected on outgoing HTTP requests |
| **Flush on Background** | Pending spans flushed via `AppLifecycleListener` on pause/exit |
| **Error Boundary** | `ErrorBoundaryWidget` catches render errors with fallback UI and retry |

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
  screen times, navigation, breadcrumbs, battery-aware sampling) with minimal
  boilerplate.
- **Use the Direct SDK** if you need conversion funnel tracking or full control
  over span creation and batching.

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
