---
title: Flutter Mobile Observability
sidebar_label: Flutter Mobile Observability
sidebar_position: 5
description:
  Add OpenTelemetry observability to your Flutter app. Choose between automatic
  RUM instrumentation or manual SDK control, wire telemetry into your app, and
  verify spans in your collector.
keywords:
  [
    flutter observability,
    flutter opentelemetry guide,
    flutter mobile monitoring,
    flutter rum setup,
    flutter tracing guide,
    mobile app observability,
    flutter instrumentation quickstart,
  ]
---

# Flutter Mobile Observability

Mobile apps face observability challenges that backend services do not: devices
run on battery, connectivity is unreliable, and the OS can kill your app at any
time. OpenTelemetry gives you traces, metrics, and error data from your Flutter
app exported to any OTLP-compatible collector.

This guide walks you through choosing an instrumentation approach, adding
dependencies, wiring telemetry into your app, and verifying that spans reach
your collector.

## Time to Complete

15-20 minutes

## What You'll Accomplish

- Choose between automatic RUM and manual SDK instrumentation
- Add OpenTelemetry dependencies to your Flutter project
- Initialize telemetry in your app entry point
- Verify spans are flowing to your collector

## Prerequisites

- **Flutter SDK 3.32.0+** and **Dart SDK 3.9.2+** installed
- A running **OpenTelemetry Collector** with an OTLP endpoint
  (see [Docker Compose Setup](../instrument/collector-setup/docker-compose-example.md)
  for local development)
- An existing Flutter app to instrument

## Step 1: Choose Your Approach

Two instrumentation paths are available. Pick the one that fits your needs.

| | Flutterific RUM | Manual SDK |
| :--- | :--- | :--- |
| **Package** | `flutterrific_opentelemetry` | `opentelemetry` |
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

> **Decision guide**: Use **Flutterific RUM** if you want session-level UX
> monitoring (jank, screen times, navigation) with minimal code. Use the
> **Manual SDK** if you need W3C trace propagation to correlate mobile spans
> with backend traces, or if you want full control over sampling, batching,
> and span creation.

Full reference docs:

- [Flutter RUM with Flutterific](../instrument/mobile/flutter-rum-flutterific.md)
- [Flutter OpenTelemetry (Manual SDK)](../instrument/mobile/flutter.md)

## Step 2: Install Dependencies

Add the packages for your chosen approach.

**Flutterific RUM:**

```yaml title="pubspec.yaml"
dependencies:
  flutterrific_opentelemetry: ^0.3.2
  device_info_plus: ^11.0.0
  package_info_plus: ^8.0.0
  connectivity_plus: ^6.0.0
```

**Manual SDK:**

```yaml title="pubspec.yaml"
dependencies:
  opentelemetry: ^0.18.10
  http: ^1.1.0
  uuid: ^4.0.0
  flutter_dotenv: ^6.0.0
  device_info_plus: ^11.3.3
```

Then install:

```bash
flutter pub get
```

## Step 3: Initialize Telemetry

Both approaches initialize telemetry before `runApp()`. Below are the minimal
entry points — see the reference docs for the complete file listings.

**Flutterific RUM** — create `lib/main_otel.dart`:

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

> **Note**: The full `lib/otel/` directory with all supporting files is
> documented in the
> [Flutterific RUM reference](../instrument/mobile/flutter-rum-flutterific.md#create-the-libotel-directory).

**Manual SDK** — wrap your existing `main()` in `runZonedGuarded`:

```dart title="lib/main.dart"
import 'dart:async';
import 'package:flutter/material.dart';
import 'services/telemetry_service.dart';

void main() {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await TelemetryService.instance.initialize();
    runApp(const MyApp());
  }, (error, stack) {
    TelemetryService.instance.recordCrash(error, stack);
  });
}
```

> **Note**: The full `TelemetryService`, `MetricsService`, and `LogService`
> implementations are documented in the
> [Manual SDK reference](../instrument/mobile/flutter.md#configuration).

Run the app with the appropriate entry point:

```bash
# Flutterific RUM
flutter run --target=lib/main_otel.dart

# Manual SDK (default entry point)
flutter run
```

## Step 4: Verify Telemetry

Once the app is running, confirm spans are reaching your collector.

1. **Check collector logs** — look for incoming OTLP requests:

   ```bash
   docker logs otel-collector 2>&1 | grep -i "traces"
   ```

2. **Look for expected span names** — depending on your approach:
   - Flutterific RUM: `app.cold_start`, `navigation.push`, `screen.load`,
     `screen.dwell`, `jank.frame`
   - Manual SDK: `GET /api/products`, `screen_view`, `device.app.lifecycle`

3. **Open Scout** — navigate to the Traces view and filter by
   `service.name = your-app-name`. You should see spans arriving within
   30 seconds of app activity.

> **Troubleshooting**: If no spans appear, check that the
> `OTEL_TRACE_ENDPOINT` environment variable or hardcoded endpoint matches your
> collector's OTLP receiver address. See
> [Troubleshooting Missing Telemetry Data](./troubleshooting-missing-data.md)
> for common issues.

## Next Steps

- [Flutter RUM with Flutterific](../instrument/mobile/flutter-rum-flutterific.md)
  — full reference for automatic RUM instrumentation
- [Flutter OpenTelemetry (Manual SDK)](../instrument/mobile/flutter.md) — full
  reference for manual SDK instrumentation
- [Create Your First Dashboard](./create-your-first-dashboard.md) — build
  dashboards from your mobile telemetry data
- [Creating Alerts with LogX](./creating-alerts-with-logx.md) — set up alerts
  on crash rates, ANR counts, or slow screen loads
- [Troubleshooting Missing Telemetry Data](./troubleshooting-missing-data.md)
  — diagnose issues when spans are not arriving
