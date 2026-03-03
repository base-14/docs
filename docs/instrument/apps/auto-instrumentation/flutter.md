---
title: Flutter OpenTelemetry Instrumentation — Complete Mobile APM Setup Guide
sidebar_label: Flutter
sidebar_position: 25
description:
  Instrument Flutter apps with OpenTelemetry for distributed tracing, crash
  monitoring, and mobile observability. Export traces to base14 Scout.
keywords:
  [
    flutter opentelemetry instrumentation,
    flutter monitoring,
    flutter apm,
    flutter distributed tracing,
    flutter mobile observability,
    flutter crash monitoring,
    flutter performance monitoring,
    dart opentelemetry sdk,
    flutter telemetry,
    flutter traces,
    flutter battery aware sampling,
    mobile app tracing,
    flutter http tracing,
    flutter error tracking,
    opentelemetry dart,
    flutter production monitoring,
    flutter instrumentation guide,
    mobile distributed tracing,
    flutter otlp exporter,
    flutter span batching,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does OpenTelemetry drain the battery on Flutter apps?","acceptedAnswer":{"@type":"Answer","text":"The battery impact depends on your sampling rate and flush intervals. At default settings (100% sampling, 30-second flush), the overhead is minimal. The battery-aware sampling automatically reduces sampling to 20% at critical battery levels, making the telemetry pipeline nearly invisible in power consumption."}},{"@type":"Question","name":"What happens to telemetry when a Flutter app goes to background?","acceptedAnswer":{"@type":"Answer","text":"The AppLifecycleObserver listens for the paused lifecycle state and immediately flushes all buffered traces, metrics, and logs. When the app returns to resumed, it refreshes battery status and resumes normal collection. If the OS kills the app while backgrounded, any unflushed buffer is lost."}},{"@type":"Question","name":"How do I trace a request from my Flutter app through backend services?","acceptedAnswer":{"@type":"Answer","text":"The HttpService injects a W3C traceparent header on every outgoing HTTP request. Backend services that support W3C Trace Context propagation will automatically continue the trace, creating an end-to-end trace waterfall from mobile to backend."}},{"@type":"Question","name":"What is the difference between a crash and an error in mobile telemetry?","acceptedAnswer":{"@type":"Answer","text":"A crash is a non-silent FlutterError or any uncaught platform/zone error that triggers a fatal log and immediate force-flush. A regular error is a caught exception that emits an error log but follows the normal batch cycle without force-flushing."}},{"@type":"Question","name":"How much network data does telemetry export consume?","acceptedAnswer":{"@type":"Answer","text":"A typical batch of 50 trace spans produces 15-25 KB of JSON. At the default 30-second flush interval, total telemetry overhead is roughly 2-4 KB/s at 100% sampling, dropping to under 1 KB/s at reduced sampling rates."}},{"@type":"Question","name":"Can I use the same OpenTelemetry setup for iOS and Android?","acceptedAnswer":{"@type":"Answer","text":"Yes. The entire telemetry pipeline is written in Dart and runs identically on iOS, Android, and web. The only platform-specific pieces are battery monitoring and secure credential storage."}},{"@type":"Question","name":"How do I reduce telemetry volume without losing crash data?","acceptedAnswer":{"@type":"Answer","text":"Lower the sampling rate for non-critical events while keeping fatal errors at 100%. The LogService gates debug and info logs behind sampling, while warn, error, and fatal bypass sampling. You can also increase the flush interval to reduce HTTP requests."}},{"@type":"Question","name":"Does the opentelemetry Dart package support metrics and logs?","acceptedAnswer":{"@type":"Answer","text":"The opentelemetry Dart package provides tracing (spans and the Tracer API). This guide implements metrics and logs as separate services that export directly via OTLP/HTTP JSON, giving full control over batching, sampling, and payload format."}},{"@type":"Question","name":"How do I add OpenTelemetry to an existing Flutter app?","acceptedAnswer":{"@type":"Answer","text":"Add opentelemetry, http, uuid, and flutter_dotenv to your pubspec.yaml. Create a .env file with your OTLP endpoint, then initialize TelemetryService, MetricsService, and LogService in your main() function before runApp(). Wrap runApp in runZonedGuarded to catch uncaught errors."}},{"@type":"Question","name":"What Flutter versions are compatible with the opentelemetry package?","acceptedAnswer":{"@type":"Answer","text":"The opentelemetry 0.18.10 package requires Dart SDK 3.9.2 or later, which corresponds to Flutter 3.32 and later. On iOS, you need a minimum platform target of 14.0. On Android, you need minSdkVersion 24."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument Flutter with OpenTelemetry","step":[{"@type":"HowToStep","name":"Install dependencies","text":"Add opentelemetry, http, uuid, and flutter_dotenv packages to pubspec.yaml and run flutter pub get."},{"@type":"HowToStep","name":"Configure environment variables","text":"Create a .env file with OTLP_ENDPOINT, SERVICE_NAME, and SCOUT_CLIENT_ID/SCOUT_CLIENT_SECRET for your collector endpoint."},{"@type":"HowToStep","name":"Initialize telemetry services","text":"Initialize TelemetryService, MetricsService, and LogService in main() before runApp(), and wrap the app in runZonedGuarded for crash handling."},{"@type":"HowToStep","name":"Add HTTP tracing with W3C context propagation","text":"Use HttpService to automatically inject W3C traceparent headers on every outgoing HTTP request for end-to-end distributed tracing."},{"@type":"HowToStep","name":"Configure production settings","text":"Set up battery-aware sampling, span batching (50 spans per 30 seconds), and resource attributes for device identification."},{"@type":"HowToStep","name":"Run and verify instrumentation","text":"Launch the app on a simulator or device, make test requests, and verify traces appear in base14 Scout with both mobile and backend spans."}]}
---

# Flutter

Implement OpenTelemetry instrumentation for Flutter mobile applications to
enable distributed tracing, crash monitoring, and real-time observability across
iOS and Android from a single Dart codebase. This guide shows you how to
integrate the `opentelemetry` Dart SDK into your Flutter app to collect traces
from HTTP requests, user interactions, screen navigation, and unhandled
exceptions, then export them to base14 Scout via OTLP.

Flutter's single-codebase architecture means instrumentation written once
applies to every target platform. The `opentelemetry` package provides a tracer
API that integrates naturally with Dart's async/await model, letting you trace
HTTP calls through `http` client interceptors, catch crashes inside
`runZonedGuarded`, and adjust sampling rates based on device battery level.
Because mobile devices operate under constrained bandwidth and power budgets,
the approach in this guide batches spans locally and flushes them on a timer
rather than sending each span individually.

Whether you are adding observability to a new Flutter project, correlating
mobile traces with backend services to debug latency across the full request
path, or building dashboards that track crash rates and slow screens in
production, this guide provides the configuration, code examples, and
operational patterns you need. All code is drawn from a working reference app —
the Astronomy Shop Mobile demo — so every snippet has been tested on real
devices.

:::tip TL;DR

Add `opentelemetry: ^0.18.10` to your `pubspec.yaml`, initialize
`TelemetryService` inside `main()` before wrapping `runApp` in
`runZonedGuarded`, and set `OTLP_ENDPOINT` in your `.env` file to point at your
Scout collector. Traces are batched locally (max 50 spans) and flushed every 30
seconds, with sampling automatically reduced when battery drops below 20%.

:::

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry tracing in a Flutter application using the Dart SDK
- Initialize telemetry before the widget tree loads and capture the full app
  lifecycle
- Trace HTTP requests to backend APIs with span attributes for status codes and
  latency
- Catch unhandled exceptions and zone errors with `runZonedGuarded` crash
  handling
- Implement battery-aware adaptive sampling to reduce telemetry overhead on low
  battery
- Batch and flush spans via OTLP/HTTP to a Scout collector
- Add custom spans for screen navigation, user interactions, and business events
- Authenticate with Scout using OIDC client credentials
- Configure environment-specific settings through `.env` files
- Deploy and test instrumented builds on iOS and Android

## Who This Guide Is For

This documentation is designed for:

- **Flutter developers** building cross-platform mobile apps who need visibility
  into runtime performance, crash rates, and user interaction patterns across
  iOS and Android
- **Mobile platform engineers** responsible for reliability and performance SLAs
  on mobile, looking to implement structured observability instead of ad-hoc
  logging
- **Backend engineers** who already have server-side tracing and want to
  correlate mobile client spans with backend traces to debug end-to-end latency
  across the request path
- **DevOps and SRE teams** deploying mobile backends and collectors, needing to
  configure OTLP ingestion endpoints and monitor mobile telemetry pipelines
- **Engineering managers** evaluating open-source mobile observability options
  and comparing OpenTelemetry-based approaches against commercial mobile APM
  vendors

## Prerequisites

Before starting, ensure you have:

- **Flutter SDK 3.32.0 or later** installed
- **Dart SDK 3.9.2 or later** (included with Flutter)
- **Xcode 15+** for iOS builds, or **Android Studio** with API 24+ for Android
- **Scout Collector** configured and accessible
  - See [Docker Compose Setup](../../../collector-setup/docker-compose-example/)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component             | Minimum Version | Recommended Version |
| --------------------- | --------------- | ------------------- |
| Flutter SDK           | 3.32.0          | 3.35.x              |
| Dart SDK              | 3.9.2           | 3.9.x               |
| iOS deployment target | 14.0            | 16.0+               |
| Android minSdkVersion | API 24 (7.0)    | API 33+ (13.0+)     |
| opentelemetry (Dart)  | 0.18.0          | 0.18.10+            |
| http (Dart)           | 1.1.0           | 1.1.0+              |

### Dependencies

Add the following packages to your `pubspec.yaml`:

```yaml showLineNumbers title="pubspec.yaml"
dependencies:
  flutter:
    sdk: flutter
  opentelemetry: ^0.18.10
  http: ^1.1.0
  uuid: ^4.0.0
  flutter_dotenv: ^6.0.0
  provider: ^6.1.2
  path_provider: ^2.1.4
  crypto: ^3.0.3
  device_info_plus: ^11.3.3
```

| Package            | Purpose                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `opentelemetry`    | OpenTelemetry Dart SDK providing tracer API, span creation, and attribute management    |
| `http`             | HTTP client used for OTLP export and API calls with span instrumentation                |
| `uuid`             | Generates unique session IDs and trace identifiers                                      |
| `flutter_dotenv`   | Loads environment variables from `.env` files for endpoint and credential configuration |
| `provider`         | State management for propagating service instances through the widget tree              |
| `path_provider`    | Access to device filesystem paths for image caching and local storage                   |
| `crypto`           | Cryptographic hashing for cache keys and data integrity checks                          |
| `device_info_plus` | Retrieves device manufacturer, model name, and model identifier per platform            |

Run `flutter pub get` after updating your `pubspec.yaml` to install all
dependencies.

## Configuration

This section covers three configuration approaches: initializing telemetry in
your app entry point, setting environment variables, and authenticating with
Scout for production deployments.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="config-approach">
<TabItem value="entry-point" label="App Entry Point" default>
```

### App Entry Point Initialization (Recommended)

The `main()` function is where you wire up every service before the widget tree
loads. The order matters: configuration validation runs first, then telemetry,
then dependent services, and finally the app itself wrapped in `runZonedGuarded`
to catch unhandled exceptions.

```dart showLineNumbers title="lib/main.dart"
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await dotenv.load(fileName: '.env');

  try {
    ConfigService.instance.validateConfiguration();
  } catch (e) {
    if (kDebugMode) {
      print('Configuration Error: $e');
      print(
        'Please check your .env file configuration',
      );
    }
  }

  await TelemetryService.instance.initialize();

  MetricsService.instance.initialize();
  LogService.instance.initialize();

  FunnelTrackingService.instance.initialize(
    TelemetryService.instance.sessionId,
  );

  ErrorHandlerService.instance.initialize();

  CartService.instance.initialize();
  CurrencyService.instance.initialize();
  PerformanceService.instance.initialize();
  await ImageCacheService.instance.initialize();

  runZonedGuarded(
    () => runApp(const AstronomyShopApp()),
    (error, stackTrace) {
      ErrorHandlerService.instance
          .recordZoneError(error, stackTrace);
    },
  );
}
```

Key points about this initialization sequence:

1. **`WidgetsFlutterBinding.ensureInitialized()`** must be called before any
   async work so that Flutter's binding is ready for platform channel calls
   (battery monitoring, filesystem access).
2. **`dotenv.load()`** reads the `.env` file bundled as a Flutter asset, making
   all environment variables available before any service reads them.
3. **`ConfigService.instance.validateConfiguration()`** checks that required
   variables like `OTLP_ENDPOINT` and `API_BASE_URL` exist and are valid URIs.
   Validation errors are caught and logged in debug mode so the app can still
   launch.
4. **Service initialization order** is intentional: `TelemetryService` must be
   ready before `MetricsService` and `LogService` because they depend on the
   tracer and session ID. `ErrorHandlerService` comes after logging so it can
   write structured error logs.
5. **`runZonedGuarded`** wraps `runApp` so that any uncaught async exception
   anywhere in the widget tree is routed to
   `ErrorHandlerService.instance.recordZoneError`, which creates an error span
   and log record instead of silently crashing.

```mdx-code-block
</TabItem>
<TabItem value="env-config" label="Environment Variables">
```

### Environment Configuration

All runtime configuration lives in a `.env` file bundled as a Flutter asset.
Copy `.env.example` to `.env` and adjust the values for your environment:

```bash showLineNumbers title=".env.example"
# OTLP Telemetry Configuration
OTLP_ENDPOINT=http://localhost:8080/otlp-http
OTLP_TRACES_EXPORTER=v1/traces
OTLP_METRICS_EXPORTER=v1/metrics
OTLP_LOGS_EXPORTER=v1/logs

# API Configuration (OpenTelemetry Demo frontend-proxy)
API_BASE_URL=http://localhost:8080/api

# App Configuration
SERVICE_NAME=astronomy-shop-mobile
SERVICE_VERSION=0.0.1
ENVIRONMENT=development
```

| Variable                | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `OTLP_ENDPOINT`         | Base URL of the OTLP collector (Scout or local)                 |
| `OTLP_TRACES_EXPORTER`  | Path appended to endpoint for trace export                      |
| `OTLP_METRICS_EXPORTER` | Path appended to endpoint for metric export                     |
| `OTLP_LOGS_EXPORTER`    | Path appended to endpoint for log export                        |
| `API_BASE_URL`          | Backend API base URL for product data                           |
| `SERVICE_NAME`          | Identifies the app in telemetry dashboards                      |
| `SERVICE_VERSION`       | Tracks which build is generating telemetry                      |
| `ENVIRONMENT`           | Deployment environment (`development`, `staging`, `production`) |

Make sure to register `.env` as a Flutter asset in your `pubspec.yaml`:

```yaml showLineNumbers title="pubspec.yaml"
flutter:
  assets:
    - .env
```

:::warning

Never commit `.env` files containing production credentials to source control.
Add `.env` to your `.gitignore` and use CI/CD secret injection for production
builds.

:::

```mdx-code-block
</TabItem>
<TabItem value="scout-auth" label="Scout Authentication">
```

### Scout Authentication (Production)

For production deployments to base14 Scout, add four additional environment
variables to your `.env` file:

```bash showLineNumbers title=".env (production)"
# Scout OIDC Authentication
SCOUT_CLIENT_ID=your-client-id
SCOUT_CLIENT_SECRET=your-client-secret
SCOUT_TOKEN_URL=https://auth.scout.example.com/oauth/token
SCOUT_ENDPOINT=https://ingest.scout.example.com/otlp-http
```

The `TelemetryService` checks for these variables during initialization and
automatically authenticates using an OAuth2 client credentials flow. Here is the
authentication logic from the reference app:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
// Scout/OIDC Authentication Configuration
static String? get scoutClientId =>
    dotenv.env['SCOUT_CLIENT_ID'];
static String? get scoutClientSecret =>
    dotenv.env['SCOUT_CLIENT_SECRET'];
static String? get scoutTokenUrl =>
    dotenv.env['SCOUT_TOKEN_URL'];
static String? get scoutEndpoint =>
    dotenv.env['SCOUT_ENDPOINT'];
```

During initialization, if the three auth variables (`SCOUT_CLIENT_ID`,
`SCOUT_CLIENT_SECRET`, and `SCOUT_TOKEN_URL`) are all present, the service
fetches an access token:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
Future<void> _initializeAuthentication() async {
  if (scoutClientId != null &&
      scoutClientSecret != null &&
      scoutTokenUrl != null) {
    await _fetchAccessToken();
  }
}

Future<void> _fetchAccessToken() async {
  try {
    if (scoutClientId == null ||
        scoutClientSecret == null ||
        scoutTokenUrl == null) {
      return;
    }

    final credentials = base64Encode(
      utf8.encode('$scoutClientId:$scoutClientSecret'),
    );

    final response = await _httpClient.post(
      Uri.parse(scoutTokenUrl!),
      headers: {
        'Content-Type':
            'application/x-www-form-urlencoded',
        'Authorization': 'Basic $credentials',
      },
      body: 'grant_type=client_credentials',
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      _accessToken = data['access_token'] as String?;

      final expiresIn =
          data['expires_in'] as int? ?? 3600;
      _tokenExpiry = DateTime.now().add(
        Duration(seconds: expiresIn - 60),
      );
    }
  } catch (e) {
    if (kDebugMode) {
      print('Error fetching Scout access token: $e');
    }
  }
}
```

The token is refreshed automatically before it expires. Every OTLP export call
checks token validity via `_ensureValidToken()` and re-fetches if the token has
expired or is within 60 seconds of expiry.

When Scout credentials are configured, the service routes telemetry to
`SCOUT_ENDPOINT` instead of `OTLP_ENDPOINT`. When they are absent, it falls back
to the standard OTLP endpoint, which makes the same codebase work for both local
development and production.

The `ConfigService` validates that required configuration exists on startup:

```dart showLineNumbers title="lib/services/config_service.dart"
void validateConfiguration() {
  try {
    if (apiBaseUrl.isEmpty) {
      throw ConfigurationException(
        'API_BASE_URL is required',
      );
    }

    if (otlpEndpoint.isEmpty) {
      throw ConfigurationException(
        'OTLP_ENDPOINT is required',
      );
    }

    if (kDebugMode) {
      final apiUri = Uri.parse(apiBaseUrl);
      Uri.parse(otlpEndpoint);

      if (apiUri.scheme == 'http') {
        debugPrint(
          '[CONFIG WARNING] Using HTTP for API: '
          '$apiBaseUrl',
        );
        debugPrint(
          '[CONFIG WARNING] For production, '
          'use HTTPS endpoints',
        );
      }

      debugPrint(
        '[CONFIG] Environment: $environment',
      );
      debugPrint(
        '[CONFIG] API Base URL: $apiBaseUrl',
      );
      debugPrint(
        '[CONFIG] OTLP Endpoint: $otlpEndpoint',
      );
    }
  } catch (e) {
    if (kDebugMode) {
      debugPrint(
        '[CONFIG ERROR] Validation failed: $e',
      );
    }
    rethrow;
  }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

Mobile telemetry in production must respect device constraints. Battery drain,
network bandwidth, and storage pressure all affect user experience, so the
instrumentation adapts its behavior based on device state.

### Battery-Aware Sampling

The `TelemetryService` defines battery thresholds and corresponding sampling
rates that reduce telemetry volume as battery decreases:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
static const double _lowBatteryThreshold = 0.20;
static const double _criticalBatteryThreshold = 0.10;

static const double _normalSamplingRate = 1.0;
static const double _lowBatterySamplingRate = 0.5;
static const double _criticalBatterySamplingRate = 0.2;
static const double _lowPowerModeSamplingRate = 0.3;
```

The sampling rate is updated whenever battery state changes:

| Battery State      | Sampling Rate | Affected Signals                        |
| ------------------ | ------------- | --------------------------------------- |
| Normal (&gt;20%)    | 1.0 (100%)    | All events, all logs                    |
| Low (10-20%)       | 0.5 (50%)     | Events sampled, DEBUG/INFO logs sampled |
| Critical (&lt;10%) | 0.2 (20%)     | Events sampled, DEBUG/INFO logs sampled |
| Low Power Mode     | 0.3 (30%)     | Events sampled, DEBUG/INFO logs sampled |

WARN, ERROR, and FATAL logs are always sent regardless of sampling rate. Metrics
are always recorded because they aggregate locally and consume minimal bandwidth
on flush.

The `_updateSamplingRate()` method selects the appropriate rate based on current
battery level and power mode:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
void _updateSamplingRate() {
  if (_isLowPowerMode) {
    _samplingRate = _lowPowerModeSamplingRate;
  } else if (
    _batteryLevel <= _criticalBatteryThreshold
  ) {
    _samplingRate = _criticalBatterySamplingRate;
  } else if (
    _batteryLevel <= _lowBatteryThreshold
  ) {
    _samplingRate = _lowBatterySamplingRate;
  } else {
    _samplingRate = _normalSamplingRate;
  }
}
```

The `LogService` checks the current sampling rate before buffering DEBUG and
INFO logs, while WARN and above always bypass the check:

```dart showLineNumbers title="lib/services/log_service.dart"
void debug(
  String message, {
  Map<String, String>? attributes,
}) {
  if (!TelemetryService.instance
      .shouldSampleForLogs()) return;
  _addRecord(
    message, LogSeverity.debug,
    attributes: attributes,
  );
}

void info(
  String message, {
  Map<String, String>? attributes,
}) {
  if (!TelemetryService.instance
      .shouldSampleForLogs()) return;
  _addRecord(
    message, LogSeverity.info,
    attributes: attributes,
  );
}

void warn(
  String message, {
  Map<String, String>? attributes,
  String? traceId,
  String? spanId,
}) {
  _addRecord(
    message, LogSeverity.warn,
    attributes: attributes,
    traceId: traceId,
    spanId: spanId,
  );
}
```

### Batching Configuration

Each telemetry signal uses its own batching strategy to balance freshness
against network efficiency:

| Signal  | Batch Size  | Flush Interval | Buffer Limit           |
| ------- | ----------- | -------------- | ---------------------- |
| Traces  | 50 events   | 30 seconds     | Individual + batch     |
| Metrics | Unbounded   | 60 seconds     | Accumulate until flush |
| Logs    | 100 records | 30 seconds     | Auto-flush at capacity |

The trace batch constants are defined in `TelemetryService`:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
final List<Map<String, dynamic>> _eventBatch = [];
static const int _maxBatchSize = 50;
static const Duration _batchFlushInterval =
    Duration(seconds: 30);
```

The metrics service accumulates counters, histograms, and gauges in memory and
flushes them on a 60-second timer:

```dart showLineNumbers title="lib/services/metrics_service.dart"
static const Duration _flushInterval =
    Duration(seconds: 60);
```

The log service buffers up to 100 records and auto-flushes when the buffer
fills, or every 30 seconds on a timer:

```dart showLineNumbers title="lib/services/log_service.dart"
static const int _maxBufferSize = 100;
static const Duration _flushInterval =
    Duration(seconds: 30);
static const int _maxStackTraceLength = 4000;
```

Stack traces are truncated at 4,000 characters to prevent oversized payloads
when exporting error logs.

### Resource Attributes

Every OTLP payload includes a standard set of resource attributes that identify
the app, session, and device. These attributes are attached to all traces,
metrics, and logs:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
List<Map<String, dynamic>> getResourceAttributes() {
  return [
    {
      'key': 'service.name',
      'value': {'stringValue': serviceName},
    },
    {
      'key': 'service.version',
      'value': {'stringValue': serviceVersion},
    },
    {
      'key': 'deployment.environment',
      'value': {'stringValue': environment},
    },
    {
      'key': 'telemetry.sdk.name',
      'value': {
        'stringValue': 'flutter-opentelemetry',
      },
    },
    {
      'key': 'telemetry.sdk.version',
      'value': {'stringValue': '0.18.10'},
    },
    {
      'key': 'session.id',
      'value': {'stringValue': _sessionId},
    },
    {
      'key': 'app.build_id',
      'value': {'stringValue': serviceVersion},
    },
    if (_installationId.isNotEmpty)
      {
        'key': 'app.installation.id',
        'value': {'stringValue': _installationId},
      },
    for (final entry in _deviceInfo.entries)
      {
        'key': entry.key,
        'value': {'stringValue': entry.value},
      },
  ];
}
```

The `_deviceInfo` map is populated during initialization with platform-specific
values using `device_info_plus` for manufacturer and model details:

| Attribute                  | Source                            | Example Value           |
| -------------------------- | --------------------------------- | ----------------------- |
| `service.name`             | `SERVICE_NAME` env var            | `astronomy-shop-mobile` |
| `service.version`          | `SERVICE_VERSION` env var         | `0.0.1`                 |
| `deployment.environment`   | `ENVIRONMENT` env var             | `production`            |
| `telemetry.sdk.name`       | Hardcoded                         | `flutter-opentelemetry` |
| `telemetry.sdk.version`    | Hardcoded                         | `0.18.10`               |
| `session.id`               | Generated UUID v4                 | `a1b2c3d4-...`          |
| `app.build_id`             | `SERVICE_VERSION` env var         | `0.0.1`                 |
| `app.installation.id`      | Persisted UUID v4                 | `e5f6g7h8-...`          |
| `os.name`                  | `Platform.operatingSystem`        | `ios`                   |
| `os.version`               | `Platform.operatingSystemVersion` | `17.4`                  |
| `device.locale`            | `Platform.localeName`             | `en_US`                 |
| `device.manufacturer`      | `DeviceInfoPlugin`                | `Apple`                 |
| `device.model.identifier`  | `DeviceInfoPlugin`                | `iPhone16,2`            |
| `device.model.name`        | `DeviceInfoPlugin`                | `iPhone`                |
| `device.screen.width`      | `PlatformDispatcher`              | `393`                   |
| `device.screen.height`     | `PlatformDispatcher`              | `852`                   |
| `device.screen.density`    | `PlatformDispatcher`              | `3.0`                   |

## Mobile-Specific Instrumentation

Mobile apps face unique observability challenges that server-side applications
do not: requests cross network boundaries between device and backend, users
navigate between screens unpredictably, and business events like cart additions
and checkout conversions need tracking for product analytics. This section
covers the four instrumentation patterns that are specific to Flutter mobile
apps.

### HTTP Client Instrumentation with W3C Trace Context

Every HTTP request your app makes to the backend should carry trace context so
that mobile-originated spans connect to backend spans in the same trace. The
`HttpService` wraps Dart's `http` package to create a span for each request,
inject W3C `traceparent` and `tracestate` headers, and record response
attributes when the call completes.

The `_makeRequest` method follows this flow:

1. Create a span named `{METHOD} {path}` with standard HTTP attributes
2. Generate a trace ID (16 bytes) and span ID (8 bytes)
3. Inject `traceparent` and `tracestate` headers into the request
4. Execute the HTTP call and record response status and duration
5. Set error status on the span if the response code is 400+

Here is the span creation and header injection from `_makeRequest`:

```dart showLineNumbers title="lib/services/http_service.dart"
Future<HttpResponse<T>> _makeRequest<T>(
  String method,
  String endpoint, {
  Map<String, String>? headers,
  Map<String, String>? queryParams,
  Object? body,
  T Function(Map<String, dynamic>)? fromJson,
  List<T> Function(List<dynamic>)? fromJsonList,
}) async {
  final uri = _buildUri(endpoint, queryParams);
  final spanName = '$method ${uri.path}';
  final span = _tracer.startSpan(spanName);
  span.setAttributes([
    otel.Attribute.fromString(
      'http.request.method', method,
    ),
    otel.Attribute.fromString(
      'url.full', uri.toString(),
    ),
    otel.Attribute.fromString('url.scheme', uri.scheme),
    otel.Attribute.fromString('url.path', uri.path),
    otel.Attribute.fromString(
      'server.address', uri.host,
    ),
    otel.Attribute.fromInt('server.port', uri.port),
    otel.Attribute.fromString(
      'session.id',
      TelemetryService.instance.sessionId,
    ),
  ]);

  final startTime = DateTime.now();
  final traceId = _generateTraceId();
  final currentSpanId = _generateSpanId();

  // ... request execution follows
```

The W3C trace context headers are injected into every outgoing request. The
`traceparent` header uses the standard format `00-{traceId}-{spanId}-01` where
`01` indicates the trace is sampled. The `tracestate` header carries
app-specific context:

```dart showLineNumbers title="lib/services/http_service.dart"
  final requestHeaders = {
    'Content-Type': 'application/json',
    'User-Agent':
        '${TelemetryService.serviceName}'
        '/${TelemetryService.serviceVersion}',
    'X-Session-ID':
        TelemetryService.instance.sessionId,
    'traceparent':
        '00-$traceId-$currentSpanId-01',
    'tracestate':
        'astronomy-shop-mobile=session:'
        '${TelemetryService.instance.sessionId}',
    ...?headers,
  };

  span.setAttributes([
    otel.Attribute.fromString('trace.id', traceId),
    otel.Attribute.fromString(
      'span.id', currentSpanId,
    ),
    otel.Attribute.fromString(
      'trace.propagated', 'true',
    ),
  ]);
```

This produces headers in the following format on the wire:

```text
traceparent: 00-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1a2b3c4d5e6f7a8b-01
tracestate: astronomy-shop-mobile=session:e4f5a6b7-...
```

After the response arrives, the span records status code, body size, and
duration, then sets an error status for 4xx and 5xx responses:

```dart showLineNumbers title="lib/services/http_service.dart"
  span.setAttributes([
    otel.Attribute.fromInt(
      'http.response.status_code',
      response.statusCode,
    ),
    otel.Attribute.fromInt(
      'http.response.body.size',
      response.bodyBytes.length,
    ),
    otel.Attribute.fromInt(
      'http.request.duration_ms',
      duration.inMilliseconds,
    ),
  ]);

  // ... metrics recording

  if (response.statusCode >= 400) {
    span.setAttributes([
      otel.Attribute.fromString(
        'error.type', '${response.statusCode}',
      ),
    ]);
    span.setStatus(
      otel.StatusCode.error,
      'HTTP ${response.statusCode}',
    );
  }
```

If the request throws an exception (network timeout, DNS failure), the catch
block records the exception on the span and sets error status:

```dart showLineNumbers title="lib/services/http_service.dart"
  } catch (e, stackTrace) {
    // ...
    span.recordException(e, stackTrace: stackTrace);
    span.setStatus(otel.StatusCode.error, e.toString());
    span.end();
    // ...
  }
```

### Screen Navigation and User Interaction Events

Tracking which screens users visit and what they interact with is essential for
understanding user behavior and diagnosing issues. All interaction events use
semconv-compatible attribute names: `app.screen.name` for the current screen,
and `app.widget.click` with `app.widget.id` and `app.widget.name` for widget
taps.

The `screen_view` event fires after the product list loads successfully,
capturing how many products were returned and their data source:

```dart showLineNumbers title="lib/main.dart"
TelemetryService.instance.recordEvent(
  'screen_view',
  attributes: {
    'app.screen.name': 'product_list',
    'product_count': products.length,
    'data_source': 'api',
  },
  parentOperation: 'load_products',
);
```

When a user taps a product card, the app starts a trace for the navigation flow
and records an `app.widget.click` event with widget and product details:

```dart showLineNumbers title="lib/main.dart"
void _onProductTapped(Product product) {
  TelemetryService.instance
      .startTrace('view_product');

  TelemetryService.instance.recordEvent(
    'app.widget.click',
    attributes: {
      'app.widget.id':
          'product_card_${product.id}',
      'app.widget.name': 'Product Card',
      'product_id': product.id,
      'product_name': product.name,
      'product_price': product.priceUsd,
      'app.screen.name': 'product_list',
    },
    parentOperation: 'view_product',
  );

  Navigator.push<void>(
    context,
    MaterialPageRoute<void>(
      builder: (context) =>
          ProductDetailScreen(product: product),
    ),
  );
}
```

Other interaction events follow the same `app.widget.click` pattern with
`app.widget.id` and `app.widget.name` attributes. For example, tapping the cart
badge records `app.widget.click` with `app.widget.id: 'cart_badge'`, and tapping
the search icon records `app.widget.click` with `app.widget.id: 'search_button'`.

### Business Event Telemetry

Business events like adding items to a cart, changing quantities, and starting
checkout need dedicated telemetry so product and engineering teams can build
conversion dashboards. The `CartService` records a `cart_add_item` event with
product and user context every time an item is added:

```dart showLineNumbers title="lib/services/cart_service.dart"
Future<void> addItem(
  Product product, {
  int quantity = 1,
}) async {
  ErrorHandlerService.instance
      .recordBreadcrumb('cart:add:${product.id}');

  // ... loading state

  try {
    TelemetryService.instance.recordEvent(
      'cart_add_item',
      attributes: {
        'product_id': product.id,
        'product_name': product.name,
        'product_price': product.priceUsd,
        'quantity': quantity,
        'user_id': _userId ?? 'anonymous',
      },
    );

    // ... cart logic and backend sync
```

The `recordBreadcrumb` call at the top of the method adds a navigation
breadcrumb to the error handler's trail. If a crash occurs later in the session,
the breadcrumb history shows the user's path leading up to the crash, which is
invaluable for reproducing issues:

```dart showLineNumbers title="lib/services/cart_service.dart"
ErrorHandlerService.instance
    .recordBreadcrumb('cart:add:${product.id}');
```

The cart service records events for every mutation: `cart_add_item`,
`cart_update_quantity`, `cart_remove_item`, and `cart_clear`. Each event
includes the `user_id` and relevant product context so you can filter by user or
product in your telemetry backend.

### Conversion Funnel Tracking

The `FunnelTrackingService` provides structured tracking for your purchase
conversion funnel from app launch through order confirmation. It defines nine
stages as an enum, where each stage has an event name, display name, and sort
order:

```dart showLineNumbers title="lib/services/funnel_tracking_service.dart"
enum FunnelStage {
  appLaunch('app_launch', 'App Launch', 0),
  productListView(
    'product_list_view', 'Product List Viewed', 1,
  ),
  productDetailView(
    'product_detail_view', 'Product Detail Viewed', 2,
  ),
  addToCart('add_to_cart', 'Added to Cart', 3),
  cartView('cart_view', 'Cart Viewed', 4),
  checkoutStart(
    'checkout_start', 'Checkout Started', 5,
  ),
  checkoutInfoEntered(
    'checkout_info_entered',
    'Checkout Info Entered', 6,
  ),
  orderPlaced('order_placed', 'Order Placed', 7),
  orderConfirmed(
    'order_confirmed', 'Order Confirmed', 8,
  );

  const FunnelStage(
    this.eventName, this.displayName, this.order,
  );

  final String eventName;
  final String displayName;
  final int order;
}
```

Each time the user progresses through the funnel, `trackStage()` records a
`funnel_stage_transition` event with attributes that capture whether the
transition is a progression, regression, or revisit:

```dart showLineNumbers title="lib/services/funnel_tracking_service.dart"
FunnelTrackingService.instance.trackStage(
  FunnelStage.productListView,
  metadata: {'product_count': products.length},
);
```

The recorded attributes include:

| Attribute                          | Description                       |
| ---------------------------------- | --------------------------------- |
| `funnel.stage`                     | Event name of the current stage   |
| `funnel.stage_order`               | Numeric position in the funnel    |
| `funnel.is_progression`            | `true` if moving forward          |
| `funnel.is_regression`             | `true` if moving backward         |
| `funnel.is_revisit`                | `true` if stage visited before    |
| `funnel.visit_count`               | Times this stage has been visited |
| `funnel.journey_length`            | Total transitions in session      |
| `funnel.stage_path`                | `previous_stage -> current_stage` |
| `funnel.time_in_previous_stage_ms` | Dwell time in last stage          |
| `funnel.completion_rate`           | Fraction of funnel completed      |

When a user converts from one stage to another (for example, viewing a product
detail and then adding it to the cart), `trackConversion()` records the time
between the two stages:

```dart showLineNumbers title="lib/services/funnel_tracking_service.dart"
FunnelTrackingService.instance.trackConversion(
  FunnelStage.productDetailView,
  FunnelStage.addToCart,
  metadata: {
    'product_id': product.id,
    'product_name': product.name,
  },
);
```

The service also detects abandonment: if a user stays on `cartView` or
`checkoutStart` for more than 5 minutes without progressing, a
`funnel_abandonment` event fires automatically via a timer.

## Custom Manual Instrumentation

While automatic HTTP tracing and lifecycle events cover the infrastructure
layer, custom spans let you trace specific business operations within your app.
This section shows how to create spans, record events, handle errors, and
implement fallback logic with proper span attribution.

### Creating Spans with the OTel API

The `ProductsApiService.getProducts()` method demonstrates the standard span
lifecycle: create a span, set attributes, add events for key milestones, set
status based on outcome, and end the span.

```dart showLineNumbers title="lib/services/products_api_service.dart"
Future<List<Product>> getProducts({
  String currencyCode = 'USD',
  bool forceRefresh = false,
}) async {
  final tracer = _telemetryService.tracer;

  _telemetryService.startTrace('load_products');

  final span =
      tracer.startSpan('products_api_get_all');

  span.setAttributes([
    otel.Attribute.fromString(
      'currency_code', currencyCode,
    ),
    otel.Attribute.fromString(
      'session.id', _telemetryService.sessionId,
    ),
    otel.Attribute.fromString(
      'force_refresh', forceRefresh.toString(),
    ),
  ]);

  try {
    if (!forceRefresh && _isCacheValid()) {
      span.addEvent('cache_hit');
      span.setAttributes([
        otel.Attribute.fromInt(
          'product_count',
          _cachedProducts!.length,
        ),
        otel.Attribute.fromString(
          'data_source', 'cache',
        ),
      ]);

      span.end();
      return _cachedProducts!;
    }

    span.addEvent('api_call_start');

    final response = await _httpService
        .get<Map<String, dynamic>>(
      '/products',
      queryParams: {'currencyCode': currencyCode},
    );

    // ... parse response and update cache

    span.setStatus(otel.StatusCode.ok);
    span.end();
    return products;

  } catch (e, stackTrace) {
    span.recordException(
      e, stackTrace: stackTrace,
    );
    span.setStatus(
      otel.StatusCode.error, e.toString(),
    );

    // ... fallback logic

    span.end();
    return hardcodedProducts;
  }
}
```

Key patterns in this span:

- **`tracer.startSpan('products_api_get_all')`** creates a new span. The name
  should describe the operation, not include variable data.
- **`span.setAttributes([...])`** adds context at creation time and again later
  when more information is available (like response data).
- **`span.addEvent('cache_hit')`** marks a milestone within the span's timeline
  without creating a child span.
- **`span.setStatus(otel.StatusCode.ok)`** marks the span as successful. For
  errors, use `otel.StatusCode.error` with a description string.
- **`span.end()`** must be called in every code path, including catch blocks and
  early returns.

### Recording Custom Events

The `TelemetryService.instance.recordEvent()` method is the primary way to
record structured events throughout the app. It accepts an event name and a map
of attributes. Here are examples from different services:

**Cart initialization** (from `CartService`):

```dart showLineNumbers title="lib/services/cart_service.dart"
TelemetryService.instance.recordEvent(
  'cart_initialize',
  attributes: {
    'user_id': _userId!,
    'session_id':
        TelemetryService.instance.sessionId,
  },
);
```

**Currency conversion** (from `CurrencyService`):

```dart showLineNumbers title="lib/services/currency_service.dart"
TelemetryService.instance.recordEvent(
  'currency_changed',
  attributes: {
    'old_currency': oldCurrency,
    'new_currency': currencyCode,
    'session_id':
        TelemetryService.instance.sessionId,
  },
);
```

**Search metrics** (from `SearchService`):

```dart showLineNumbers title="lib/services/search_service.dart"
TelemetryService.instance.recordEvent(
  'search_result_clicked',
  attributes: {
    'product_id': product.id,
    'product_name': product.name,
    'search_query': query,
    'result_position': position,
    'price_usd': product.priceUsd,
    'session_id':
        _telemetryService.sessionId,
  },
);
```

Every event includes `session_id` so you can correlate all events from a single
user session.

### Error Recording in Spans

When an exception occurs inside a span, use `span.recordException()` to attach
the error and stack trace to the span before setting the error status. From the
products API service:

```dart showLineNumbers title="lib/services/products_api_service.dart"
} catch (e, stackTrace) {
  span.recordException(
    e, stackTrace: stackTrace,
  );
  span.setStatus(
    otel.StatusCode.error, e.toString(),
  );

  // ... fallback logic

  span.end();
  return hardcodedProducts;
}
```

The `recordException` call creates a span event named `exception` with
attributes `exception.type`, `exception.message`, and `exception.stacktrace`.
This makes exceptions searchable and filterable in your trace viewer.

In the HTTP service, the same pattern handles network-level failures:

```dart showLineNumbers title="lib/services/http_service.dart"
} catch (e, stackTrace) {
  // ...
  span.setAttributes([
    otel.Attribute.fromInt(
      'http.duration_ms',
      duration.inMilliseconds,
    ),
    otel.Attribute.fromString(
      'error.type', e.runtimeType.toString(),
    ),
    otel.Attribute.fromString(
      'error.message', e.toString(),
    ),
  ]);

  span.recordException(
    e, stackTrace: stackTrace,
  );
  span.setStatus(
    otel.StatusCode.error, e.toString(),
  );
  span.end();
  // ...
}
```

### Search with Cache Fallback

The `SearchService.searchProducts()` method demonstrates a common mobile
pattern: try an API call first, fall back to local search if the API fails, and
record the data source in span attributes so you can track how often the
fallback fires.

```dart showLineNumbers title="lib/services/search_service.dart"
Future<SearchResult> searchProducts(
  String query, {
  String currencyCode = 'USD',
  int limit = 20,
  bool forceRefresh = false,
}) async {
  final searchStartTime = DateTime.now();
  final tracer = _telemetryService.tracer;
  final span = tracer.startSpan('product_search');

  final normalizedQuery =
      query.trim().toLowerCase();

  span.setAttributes([
    otel.Attribute.fromString(
      'search_query', query,
    ),
    otel.Attribute.fromString(
      'normalized_query', normalizedQuery,
    ),
    otel.Attribute.fromString(
      'currency_code', currencyCode,
    ),
    otel.Attribute.fromInt('limit', limit),
    otel.Attribute.fromString(
      'session_id', _telemetryService.sessionId,
    ),
  ]);

  // ... empty query validation

  try {
    // Check cache first
    if (!forceRefresh
        && _isCacheValid(normalizedQuery)) {
      span.addEvent('cache_hit');
      // ... return cached result
    }

    span.addEvent('api_search_start');

    // Try API search first
    try {
      final apiResult = await _searchViaAPI(
        normalizedQuery, currencyCode, limit,
      );
      // ...
      span.setAttributes([
        otel.Attribute.fromInt(
          'results_count',
          result.products.length,
        ),
        otel.Attribute.fromString(
          'data_source', 'api',
        ),
        otel.Attribute.fromInt(
          'search_duration_ms',
          searchDuration.inMilliseconds,
        ),
      ]);

      span.setStatus(otel.StatusCode.ok);
      span.end();
      return result;

    } catch (apiError) {
      span.addEvent('api_search_failed');
      span.setAttributes([
        otel.Attribute.fromString(
          'api_error', apiError.toString(),
        ),
      ]);

      // Fallback to local search
      span.addEvent('fallback_to_local_search');
      final localResult = await _searchLocally(
        normalizedQuery, currencyCode,
      );
      // ...
      span.setAttributes([
        otel.Attribute.fromString(
          'data_source', 'local_fallback',
        ),
      ]);

      span.setStatus(otel.StatusCode.ok);
      span.end();
      return result;
    }
  } catch (e, stackTrace) {
    span.recordException(
      e, stackTrace: stackTrace,
    );
    span.setStatus(
      otel.StatusCode.error, e.toString(),
    );
    span.end();
    rethrow;
  }
}
```

The `data_source` attribute is the key piece: when you query your trace backend
for spans named `product_search`, you can group by `data_source` to see what
percentage of searches are hitting the API versus falling back to local search.
A spike in `local_fallback` tells you the search API is having issues before
your users report it.

## App Lifecycle and Crash Handling

Mobile apps can be paused, backgrounded, or killed by the OS at any time.
Telemetry that has not been flushed is lost. Crashes that are not captured leave
you blind. This section covers lifecycle tracking, crash classification,
breadcrumb trails, force-flush on fatal errors, and error boundary widgets.

### App Lifecycle Tracking

The `AppLifecycleObserver` extends `WidgetsBindingObserver` to record a
`device.app.lifecycle` event for every lifecycle state transition, using
platform-specific state keys (`ios.app.state` or `android.app.state`) with
semconv-compatible values. This gives you visibility into how your app behaves
across foreground/background cycles and ensures telemetry is flushed before the
OS kills the process.

```dart showLineNumbers title="lib/services/app_lifecycle_observer.dart"
class AppLifecycleObserver
    extends WidgetsBindingObserver {
  AppLifecycleObserver() {
    _tracer = _telemetryService.tracer;
  }

  final TelemetryService _telemetryService =
      TelemetryService.instance;

  @override
  void didChangeAppLifecycleState(
    AppLifecycleState state,
  ) {
    super.didChangeAppLifecycleState(state);

    final stateKey = _platformStateKey();
    final stateValue =
        _mapLifecycleState(state);

    _telemetryService.recordEvent(
      'device.app.lifecycle',
      attributes: {
        stateKey: stateValue,
        'session.id':
            _telemetryService.sessionId,
      },
    );

    switch (state) {
      case AppLifecycleState.resumed:
        PerformanceService.instance
            .recordMemoryUsage();
        _telemetryService.updateBatteryStatus();
        break;

      case AppLifecycleState.paused:
        _telemetryService.flush();
        break;

      case AppLifecycleState.detached:
        _telemetryService.shutdown();
        break;

      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
        break;
    }
  }

  String _platformStateKey() {
    if (kIsWeb) return 'android.app.state';
    if (Platform.isIOS) return 'ios.app.state';
    return 'android.app.state';
  }

  String _mapLifecycleState(
    AppLifecycleState state,
  ) {
    if (!kIsWeb && Platform.isIOS) {
      return switch (state) {
        AppLifecycleState.resumed => 'active',
        AppLifecycleState.inactive =>
          'inactive',
        AppLifecycleState.paused =>
          'background',
        AppLifecycleState.detached =>
          'terminate',
        AppLifecycleState.hidden =>
          'background',
      };
    }
    return switch (state) {
      AppLifecycleState.resumed => 'foreground',
      AppLifecycleState.inactive => 'created',
      AppLifecycleState.paused => 'background',
      AppLifecycleState.detached => 'background',
      AppLifecycleState.hidden => 'background',
    };
  }
}
```

The critical behaviors are:

- **`paused`** calls `flush()` to send all buffered telemetry before the app
  goes to the background. On iOS, you have roughly 5 seconds of background
  execution time before the OS suspends the process.
- **`detached`** calls `shutdown()` to close connections and flush any remaining
  data. This fires when the app is being terminated.
- **`resumed`** records memory usage and updates the battery status, which may
  adjust the sampling rate if the battery level changed while the app was
  backgrounded.

Register the observer in your screen's `initState` and remove it in `dispose`:

```dart showLineNumbers title="lib/main.dart"
@override
void initState() {
  super.initState();
  _lifecycleObserver = AppLifecycleObserver();
  WidgetsBinding.instance
      .addObserver(_lifecycleObserver);
}

@override
void dispose() {
  WidgetsBinding.instance
      .removeObserver(_lifecycleObserver);
  super.dispose();
}
```

### Crash Classification

The `ErrorHandlerService` classifies errors into severity levels based on their
source. This determines whether the error is recorded as a recoverable error or
a fatal crash, and whether telemetry is force-flushed before the app potentially
dies.

| Error Source                        | Severity | Type                  | Fatal |
| ----------------------------------- | -------- | --------------------- | ----- |
| `FlutterError.onError` (non-silent) | crash    | `flutter_error`       | Yes   |
| `FlutterError.onError` (silent)     | error    | `flutter_error`       | No    |
| `PlatformDispatcher.onError`        | crash    | `platform_error`      | Yes   |
| `runZonedGuarded` catch             | crash    | `zone_uncaught_error` | Yes   |
| `recordCustomError()`               | error    | `custom_error`        | No    |

The `initialize()` method sets up the three error capture hooks:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
void initialize() {
  FlutterError.onError = _handleFlutterError;

  PlatformDispatcher.instance.onError =
      (error, stack) {
    _handlePlatformError(error, stack);
    return true;
  };

  TelemetryService.instance.recordEvent(
    'error_handler_initialize',
    attributes: {
      'session_id':
          TelemetryService.instance.sessionId,
    },
  );
}
```

The `_handleFlutterError` callback checks the `silent` flag to determine crash
severity. Silent errors (like layout overflows during debug) are logged but not
treated as crashes:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
void _handleFlutterError(
  FlutterErrorDetails details,
) {
  final isCrash = !details.silent;

  final errorDetails = ErrorDetails(
    error: details.exception.toString(),
    stackTrace: details.stack?.toString(),
    context: details.context?.toString(),
    timestamp: DateTime.now(),
    metadata: {
      'error_type': 'flutter_error',
      'library': details.library,
      'silent': details.silent,
    },
  );

  _recordError(errorDetails, isCrash: isCrash);
}
```

Zone errors from `runZonedGuarded` are always classified as crashes because they
represent uncaught exceptions that escaped all error handling:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
void recordZoneError(
  Object error, StackTrace stackTrace,
) {
  final errorDetails = ErrorDetails(
    error: error.toString(),
    stackTrace: stackTrace.toString(),
    context: 'zone_uncaught',
    timestamp: DateTime.now(),
    metadata: {
      'error_type': 'zone_uncaught_error',
    },
  );
  _recordError(errorDetails, isCrash: true);
}
```

### Breadcrumb Trail

Breadcrumbs record a trail of user actions leading up to an error. When a crash
occurs, the breadcrumb history shows you exactly what the user did before the
crash, which makes reproduction much easier.

The `recordBreadcrumb()` method maintains a rolling buffer of the last 20
actions:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
final List<String> _breadcrumbs = [];
static const int _maxBreadcrumbs = 20;

void recordBreadcrumb(String action) {
  _breadcrumbs.add(action);
  if (_breadcrumbs.length > _maxBreadcrumbs) {
    _breadcrumbs.removeAt(0);
  }
  _lastUserAction = action;
}
```

Throughout the app, services record breadcrumbs for significant user actions.
The cart service records breadcrumbs for every cart mutation:

```dart showLineNumbers title="lib/services/cart_service.dart"
// Adding an item
ErrorHandlerService.instance
    .recordBreadcrumb('cart:add:${product.id}');

// Removing an item
ErrorHandlerService.instance
    .recordBreadcrumb('cart:remove:$productId');

// Clearing the cart
ErrorHandlerService.instance
    .recordBreadcrumb('cart:clear');
```

Screen navigation is also recorded as a breadcrumb:

```dart showLineNumbers title="lib/main.dart"
ErrorHandlerService.instance
    .recordBreadcrumb('navigate:ProductList');
```

When an error is recorded, the full breadcrumb trail is included as a joined
string in the event attributes:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
final attrs = <String, Object>{
  // ... other attributes
  'breadcrumbs': _breadcrumbs.join(' > '),
  // ...
};
```

This produces a breadcrumb string like:
`navigate:ProductList > cart:add:OLJCESPC7Z > cart:remove:OLJCESPC7Z` that tells
you exactly the sequence of actions before the error.

### Force-Flush on Fatal Error

When a fatal crash occurs, the app may be killed by the OS at any moment. The
`_recordError` method's crash path ensures all telemetry is exported before that
happens by incrementing the crash counter, logging a FATAL record, and then
force-flushing all three telemetry services with a 3-second timeout:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
void _recordError(
  ErrorDetails errorDetails, {
  bool isCrash = false,
}) {
  // ... store error in recent errors list

  final severity = isCrash ? 'crash' : 'error';
  if (isCrash) _hasCrashed = true;

  final attrs = <String, Object>{
    'error.message': errorDetails.error,
    'error.context':
        errorDetails.context ?? 'unknown',
    'error.type':
        (errorDetails.metadata['error_type']
            as String?) ?? 'unknown',
    'error.severity': severity,
    'error.is_fatal': isCrash,
    'session.id':
        TelemetryService.instance.sessionId,
    'session.duration_ms': DateTime.now()
        .difference(TelemetryService
            .instance.sessionStartTime)
        .inMilliseconds,
    'app.screen.name': _currentScreen,
    'user.last_action': _lastUserAction,
    'breadcrumbs': _breadcrumbs.join(' > '),
    'has_stack_trace':
        errorDetails.stackTrace != null,
  };

  TelemetryService.instance.recordEvent(
    'error_occurred', attributes: attrs,
  );

  // ... log as FATAL or ERROR

  MetricsService.instance.incrementCounter(
    isCrash
        ? 'app.crash.count'
        : 'app.error.count',
    attributes: {
      'error.type':
          (errorDetails.metadata['error_type']
              as String?) ?? 'unknown',
      'app.screen.name': _currentScreen,
    },
  );

  if (isCrash) {
    _forceFlushAll();
  }
}
```

The `_forceFlushAll()` method flushes traces, metrics, and logs in parallel with
a 3-second timeout. If any flush hangs or fails, the timeout ensures the crash
handler does not block indefinitely:

```dart showLineNumbers title="lib/services/error_handler_service.dart"
Future<void> _forceFlushAll() async {
  try {
    await Future.wait([
      TelemetryService.instance.flush(),
      MetricsService.instance.flush(),
      LogService.instance.flush(),
    ]).timeout(const Duration(seconds: 3));
  } catch (_) {
    // Best effort - don't let flush failure
    // mask the crash
  }
}
```

The 3-second timeout is a deliberate trade-off: long enough to complete most
network requests, short enough to finish before the OS kills a crashing app.

### Error Boundary Widget

The `ErrorBoundary` widget catches render-time errors in a subtree and shows a
recovery UI instead of crashing the entire app. It wraps any widget subtree and
provides a retry mechanism:

```dart showLineNumbers title="lib/widgets/error_boundary.dart"
class ErrorBoundary extends StatefulWidget {
  const ErrorBoundary({
    super.key,
    required this.child,
    required this.context,
    this.onRetry,
  });

  final Widget child;
  final String context;
  final VoidCallback? onRetry;

  @override
  State<ErrorBoundary> createState() =>
      _ErrorBoundaryState();
}

class _ErrorBoundaryState
    extends State<ErrorBoundary> {
  Object? _error;
  StackTrace? _stackTrace;

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return _buildErrorUI();
    }

    return ErrorHandler(
      onError: _handleError,
      child: widget.child,
    );
  }

  void _handleError(
    Object error, StackTrace stackTrace,
  ) {
    WidgetsBinding.instance
        .addPostFrameCallback((_) {
      if (mounted) {
        setState(() {
          _error = error;
          _stackTrace = stackTrace;
        });
      }
    });

    debugPrint(
      'Error in ${widget.context}: $error',
    );
  }

  void _retryDefault() {
    setState(() {
      _error = null;
      _stackTrace = null;
    });

    TelemetryService.instance.recordEvent(
      'error_boundary_retry',
      attributes: {
        'context': widget.context,
      },
    );
  }
}
```

The companion `withErrorBoundary()` extension makes it easy to wrap any widget:

```dart showLineNumbers title="lib/widgets/error_boundary.dart"
extension WidgetErrorBoundary on Widget {
  Widget withErrorBoundary(
    String context, {
    VoidCallback? onRetry,
  }) {
    return ErrorBoundary(
      context: context,
      onRetry: onRetry,
      child: this,
    );
  }
}
```

Usage in the widget tree:

```dart showLineNumbers title="lib/main.dart"
child: AppErrorBoundary(
  child: MaterialApp(
    title: 'Astronomy Shop Mobile',
    // ...
  ),
),
```

The `AppErrorBoundary` wraps the entire `MaterialApp` at the root level. You can
also wrap individual screens or sections with `withErrorBoundary` to provide
localized error recovery without losing the rest of the app state. Telemetry
recording for the actual crash is handled by the chained
`ErrorHandlerService._handleFlutterError` via `FlutterError.onError`, so the
boundary only handles UI recovery.

## Running Your Application

The example app supports three deployment targets: web (for fast iteration), iOS
simulator, and Android emulator. All three share the same `.env` configuration
and telemetry pipeline.

```mdx-code-block
<Tabs groupId="run-target">
<TabItem value="web" label="Web (Chrome)" default>
```

### Development (Web)

The fastest way to iterate is Chrome on `localhost:8090`. Copy the environment
template and run:

```bash showLineNumbers title="Terminal"
cp .env.example .env
make run    # launches Chrome at localhost:8090
```

Under the hood, `make run` calls:

```bash showLineNumbers title="Makefile"
flutter run -d chrome --web-browser-flag="--disable-web-security" \
  --web-browser-flag="--disable-features=VizDisplayCompositor" \
  --web-hostname localhost --web-port 8090
```

The `--disable-web-security` flag is needed during local development so the
browser allows cross-origin requests to the OTLP collector and the OpenTelemetry
Demo API running on `localhost:8080`.

```mdx-code-block
</TabItem>
<TabItem value="ios" label="iOS Simulator">
```

### iOS Simulator

```bash showLineNumbers title="Terminal"
make install-ios   # runs: cd ios && pod install
make run-ios       # runs: flutter run -d ios
```

If you hit CocoaPods errors, make sure your `Podfile` specifies at least
`platform :ios, '14.0'`. Older platform versions lack APIs the `opentelemetry`
package depends on.

```mdx-code-block
</TabItem>
<TabItem value="android" label="Android Emulator">
```

### Android Emulator

```bash showLineNumbers title="Terminal"
make install-android   # runs: cd android && ./gradlew dependencies
make run-android       # runs: flutter run -d android
```

Ensure `android/app/build.gradle` sets `minSdkVersion 24` or higher. The
`opentelemetry` Dart package requires Dart SDK ^3.9.2, which in turn needs a
recent Android build toolchain.

```mdx-code-block
</TabItem>
</Tabs>
```

### Backend Setup

The app expects the
[OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo)
running locally. The demo includes a frontend-proxy that the mobile app sends
API requests and OTLP telemetry through:

```bash showLineNumbers title="Terminal"
git clone https://github.com/open-telemetry/opentelemetry-demo.git
cd opentelemetry-demo
docker compose -f docker-compose.minimal.yml up -d
```

Once the containers are healthy, the default `.env` values work out of the box:

```properties showLineNumbers title=".env.example"
OTLP_ENDPOINT=http://localhost:8080/otlp-http
OTLP_TRACES_EXPORTER=v1/traces
OTLP_METRICS_EXPORTER=v1/metrics
OTLP_LOGS_EXPORTER=v1/logs

API_BASE_URL=http://localhost:8080/api

SERVICE_NAME=astronomy-shop-mobile
SERVICE_VERSION=0.0.1
ENVIRONMENT=development
```

Verify telemetry is arriving by opening Jaeger at
[http://localhost:16686](http://localhost:16686) and selecting the
`astronomy-shop-mobile` service. You should see traces for HTTP requests, screen
views, and lifecycle events within a few seconds of interacting with the app.

## Troubleshooting

### Debugging Telemetry Locally

Enable verbose telemetry logging by wrapping debug output in `kDebugMode`
checks. The codebase already does this throughout:

```dart showLineNumbers title="lib/services/telemetry_service.dart"
if (kDebugMode) {
  print('OTLP span sent: $method $uri (trace: ${traceId.substring(0, 8)}...)');
}
```

When running in debug mode (`flutter run`), every OTLP export prints its status
to the console. In release builds these prints are stripped by the compiler, so
there is zero overhead in production.

#### Issue: No traces appearing from mobile app

**Solutions:**

1. Verify the OTLP endpoint is reachable from the device or simulator. On
   Android emulators, `localhost` refers to the emulator itself, not your host
   machine. Use `10.0.2.2` instead, or run the web target first to rule out
   network issues.
2. Check that the collector or frontend-proxy is running:
   `curl http://localhost:8080/otlp-http/v1/traces` should return a response
   (even if it is an error about missing body).
3. Confirm the app calls `forceFlush()` on fatal errors. Without a flush,
   buffered spans may never leave the device if the app is killed.
4. If battery-aware sampling is active, low battery levels reduce the sampling
   rate to 20%. Set `_batteryLevel = 1.0` in `TelemetryService` during local
   testing to disable adaptive sampling.

#### Issue: Distributed traces broken between mobile and backend

**Solutions:**

1. Confirm `http_service.dart` injects the `traceparent` header on every
   outgoing request. The header format must be `00-{traceId}-{spanId}-01`:

   ```dart showLineNumbers title="lib/services/http_service.dart"
   'traceparent': '00-$traceId-$currentSpanId-01',
   'tracestate': 'astronomy-shop-mobile=session:${TelemetryService.instance.sessionId}',
   ```

2. Check that the backend service parses the `traceparent` header and uses the
   same trace ID for its own spans. Most OpenTelemetry SDKs do this
   automatically if W3C propagation is enabled.
3. If you use a reverse proxy or CDN, verify it is not stripping the
   `traceparent` and `tracestate` headers. Add them to your CORS
   `Access-Control-Allow-Headers` list.

#### Issue: High battery drain from telemetry

**Solutions:**

1. Increase the batch flush interval. The default is 30 seconds for traces
   (`_batchFlushInterval`) and 60 seconds for metrics
   (`MetricsService._flushInterval`). For production, consider 60-120 seconds
   for traces.
2. Enable battery-aware sampling. The app already reduces sampling to 50% at 20%
   battery and 20% at 10% battery. Verify these thresholds match your needs:

   | Battery Level  | Sampling Rate |
   | -------------- | ------------- |
   | &gt; 20%       | 100%          |
   | &lt;= 20%      | 50%           |
   | &lt;= 10%      | 20%           |
   | Low Power Mode | 30%           |

3. Reduce event volume by sampling non-critical events (debug and info logs are
   already gated by `shouldSampleForLogs()`). Only fatal and error severity logs
   bypass sampling.

#### Issue: Telemetry lost on app background or kill

**Solutions:**

1. The `AppLifecycleObserver` already flushes telemetry when the app enters the
   `paused` state:

   ```dart showLineNumbers title="lib/services/app_lifecycle_observer.dart"
   case AppLifecycleState.paused:
     _telemetryService.flush();
     break;
   ```

2. Fatal errors trigger an immediate force-flush across all three pipelines
   (traces, metrics, logs) with a 3-second timeout:

   ```dart showLineNumbers title="lib/services/error_handler_service.dart"
   Future<void> _forceFlushAll() async {
     try {
       await Future.wait([
         TelemetryService.instance.flush(),
         MetricsService.instance.flush(),
         LogService.instance.flush(),
       ]).timeout(const Duration(seconds: 3));
     } catch (_) {
       // Best effort
     }
   }
   ```

3. For network interruptions, consider adding an offline buffer that persists
   unsent spans to disk and retries on the next `resumed` lifecycle event.

#### Issue: Build errors with opentelemetry package

**Solutions:**

1. Verify your Dart SDK version matches the constraint in `pubspec.yaml`. The
   `opentelemetry: ^0.18.10` package requires Dart SDK `^3.9.2`:

   ```yaml showLineNumbers title="pubspec.yaml"
   environment:
     sdk: ^3.9.2
   ```

2. For iOS, set the platform minimum in your `Podfile`:

   ```ruby showLineNumbers title="ios/Podfile"
   platform :ios, '14.0'
   ```

3. For Android, set `minSdkVersion 24` in `android/app/build.gradle`. Lower
   versions lack TLS and networking APIs the HTTP client needs.
4. Run `flutter clean && flutter pub get` to clear cached build artifacts after
   changing SDK constraints.

## Security Considerations

### Avoid PII in Device Attributes

The telemetry service collects device info for debugging, but you must avoid
capturing personally identifiable information like device IDs, IMEI numbers, or
user emails in resource attributes.

Bad (leaks PII):

```dart showLineNumbers title="lib/services/telemetry_service.dart — avoid this"
_deviceInfo['device.id'] = Platform.localHostname;
_deviceInfo['user.email'] = currentUser.email;
_deviceInfo['device.imei'] = await getDeviceImei();
```

Good (safe device context):

```dart showLineNumbers title="lib/services/telemetry_service.dart"
_deviceInfo['os.name'] = Platform.operatingSystem;
_deviceInfo['os.version'] = Platform.operatingSystemVersion;
_deviceInfo['device.locale'] = Platform.localeName;
_deviceInfo['device.manufacturer'] = iosInfo.manufacturer;
_deviceInfo['device.model.identifier'] = iosInfo.utsname.machine;
_deviceInfo['device.model.name'] = iosInfo.model;
_deviceInfo['device.screen.width'] = (size.width / ratio).round().toString();
_deviceInfo['device.screen.height'] = (size.height / ratio).round().toString();
_deviceInfo['device.screen.density'] = ratio.toStringAsFixed(1);
```

### Secure Credential Storage

The `.env` file with OTLP endpoints and Scout credentials is for local
development only. In production deployments:

- **iOS**: Store OAuth tokens in the Keychain using `flutter_secure_storage` or
  the native `Security` framework.
- **Android**: Use `EncryptedSharedPreferences` for token storage.
- Never hardcode `SCOUT_CLIENT_ID` or `SCOUT_CLIENT_SECRET` in source code.
  Inject them at build time via environment variables or a secrets management
  service.

### Stack Trace Truncation

Stack traces are truncated to a maximum of 4000 characters before export to
prevent oversized OTLP payloads and accidental leaking of deep internal paths:

```dart showLineNumbers title="lib/services/log_service.dart"
static const int _maxStackTraceLength = 4000;

String? _truncateStackTrace(StackTrace? stackTrace) {
  if (stackTrace == null) return null;
  final str = stackTrace.toString();
  if (str.length <= _maxStackTraceLength) return str;
  return '${str.substring(0, _maxStackTraceLength)}... [truncated]';
}
```

### HTTPS in Production

The `.env.example` uses `http://localhost:8080` because the OTel Demo runs
locally without TLS. In production, all OTLP exports must use HTTPS. Update your
endpoint configuration to point at a TLS-terminated collector:

```properties showLineNumbers title=".env (production)"
OTLP_ENDPOINT=https://collector.yourcompany.com
SCOUT_ENDPOINT=https://ingest.base14.io
```

### Sensitive Data in Span Attributes

Never include passwords, tokens, or PII in span attributes. Filter sensitive
fields before attaching them to spans:

```dart showLineNumbers title="lib/services/http_service.dart — filtering pattern"
final sanitizedHeaders = Map<String, String>.from(requestHeaders)
  ..remove('Authorization')
  ..remove('Cookie')
  ..remove('X-API-Key');

span.setAttributes([
  otel.Attribute.fromString('http.request.method', method),
  otel.Attribute.fromString('url.path', uri.path),
  // Do NOT log: uri.queryParameters (may contain tokens)
  // Do NOT log: requestHeaders['Authorization']
]);
```

## Performance Considerations

### Battery Impact

Battery-aware sampling is the single biggest lever for reducing telemetry
overhead on mobile. The sampling rate table from the production configuration
section applies here:

| Battery Level  | Sampling Rate | Constant                       |
| -------------- | ------------- | ------------------------------ |
| &gt; 20%       | 100%          | `_normalSamplingRate`          |
| &lt;= 20%      | 50%           | `_lowBatterySamplingRate`      |
| &lt;= 10%      | 20%           | `_criticalBatterySamplingRate` |
| Low Power Mode | 30%           | `_lowPowerModeSamplingRate`    |

At critical battery, the image cache also skips downloads entirely when battery
drops below 15%:

```dart showLineNumbers title="lib/services/image_cache_service.dart"
final batteryLevel = batteryInfo['battery_level'] as double;
if (batteryAware && batteryLevel < 0.15) {
  telemetry.recordEvent('image_cache_battery_skip', attributes: {
    'url': url,
    'battery_level': batteryLevel,
  });
  return null;
}
```

### Memory Footprint

The telemetry pipeline uses bounded buffers to prevent runaway memory growth:

| Signal  | Buffer                     | Max Size                       | Flush Interval |
| ------- | -------------------------- | ------------------------------ | -------------- |
| Traces  | `_eventBatch`              | 50 events (`_maxBatchSize`)    | 30 seconds     |
| Logs    | `_buffer`                  | 100 records (`_maxBufferSize`) | 30 seconds     |
| Metrics | counters/histograms/gauges | Unbounded (keyed maps)         | 60 seconds     |

When the trace buffer reaches 50 events, it flushes immediately regardless of
the timer. The log buffer does the same at 100 records. Metrics are unbounded
because they use delta aggregation -- each flush clears the maps, so memory
stays proportional to the number of unique metric-attribute combinations, not
the number of data points.

### Network Bandwidth

All three signals export as OTLP/HTTP JSON. Each flush sends a single HTTP POST
per signal type, so at worst the app makes 3 requests per flush cycle. Batching
significantly reduces connection overhead compared to per-span or per-log-record
export.

To estimate bandwidth: a typical trace batch of 50 spans produces roughly 15-25
KB of JSON. At one flush per 30 seconds, that is under 1 KB/s of upload
bandwidth. Logs and metrics add a similar amount.

### Optimization Practices

1. **Battery-aware sampling** reduces telemetry volume automatically as battery
   drops. Use the existing constants (`_lowBatterySamplingRate`,
   `_criticalBatterySamplingRate`, `_lowPowerModeSamplingRate`) rather than
   inventing ad-hoc thresholds.

2. **Batch export over individual spans**. The `_sendToOTLPCollector` method
   sends up to 50 spans in a single HTTP request. Avoid calling
   `_sendIndividualSpanToOTLP` for high-frequency events; use the batch queue
   instead.

3. **Stack trace truncation** at 4000 characters prevents oversized payloads
   from consuming bandwidth and collector storage.

4. **Skip image downloads at low battery**. The image cache service returns
   `null` when battery drops below 15%, avoiding large HTTP downloads that would
   drain the battery further.

5. **Force-flush only on fatal errors**, not every error. Non-fatal errors
   follow the regular batch cycle. Only `LogService.fatal()` calls
   `forceFlush()` immediately, ensuring crash data reaches the collector without
   adding flush overhead to recoverable errors.

## FAQ

### Does OpenTelemetry drain the battery on Flutter apps?

The battery impact depends on your sampling rate and flush intervals. At default
settings (100% sampling, 30-second flush), the overhead is minimal -- comparable
to any app that makes periodic HTTP requests. The battery-aware sampling in this
guide automatically reduces sampling to 20% at critical battery levels, which
makes the telemetry pipeline nearly invisible in power consumption.

### What happens to telemetry when a Flutter app goes to background?

The `AppLifecycleObserver` listens for the `paused` lifecycle state and
immediately flushes all buffered traces, metrics, and logs. When the app returns
to `resumed`, it refreshes battery status and resumes normal collection. If the
OS kills the app while backgrounded, any unflushed buffer is lost -- this is why
the `paused` flush is essential.

### How do I trace a request from my Flutter app through backend services?

The `HttpService` injects a W3C `traceparent` header on every outgoing HTTP
request with format `00-{traceId}-{spanId}-01`. Backend services that support
W3C Trace Context propagation will automatically continue the trace. In Jaeger,
search for the `astronomy-shop-mobile` service and you will see spans from both
the mobile app and any backend service in the same trace waterfall.

### What is the difference between a crash and an error in mobile telemetry?

In the `ErrorHandlerService`, a crash is a non-silent `FlutterError` or any
uncaught platform/zone error. It sets `_hasCrashed = true`, emits a `fatal` log,
increments `app.crash.count`, and triggers an immediate force-flush. A regular
error is a caught exception or a silent Flutter error. It emits an `error` log
and increments `app.error.count` but follows the normal batch cycle without
force-flushing.

### How much network data does telemetry export consume?

A typical batch of 50 trace spans produces 15-25 KB of JSON. At the default
30-second flush interval, that is under 1 KB/s of upload bandwidth. Logs and
metrics add a similar amount. Total telemetry overhead is roughly 2-4 KB/s at
100% sampling, which drops to under 1 KB/s at reduced sampling rates.

### Can I use the same OpenTelemetry setup for iOS and Android?

Yes. The entire telemetry pipeline is written in Dart and runs identically on
iOS, Android, and web. The only platform-specific pieces are battery monitoring
(which uses a `MethodChannel` for native battery APIs) and secure credential
storage (Keychain on iOS, EncryptedSharedPreferences on Android). The OTLP
export, sampling, batching, and error handling code is fully cross-platform.

### How do I reduce telemetry volume without losing crash data?

Lower the sampling rate for non-critical events while keeping fatal errors at
100%. The `LogService` already gates `debug` and `info` logs behind
`shouldSampleForLogs()`, while `warn`, `error`, and `fatal` bypass sampling. You
can also increase the flush interval from 30 to 60-120 seconds to reduce the
number of HTTP requests without losing data -- spans just wait longer in the
buffer before export.

### Does the opentelemetry Dart package support metrics and logs?

The `opentelemetry: ^0.18.10` Dart package provides tracing (spans and the
`Tracer` API). This guide implements metrics and logs as separate services
(`MetricsService` and `LogService`) that export directly via OTLP/HTTP JSON.
This approach gives full control over batching, sampling, and payload format
without waiting for the Dart SDK to stabilize its metrics and logs APIs.

### How do I add OpenTelemetry to an existing Flutter app?

Add `opentelemetry: ^0.18.10`, `http: ^1.1.0`, `uuid: ^4.0.0`, and
`flutter_dotenv: ^6.0.0` to your `pubspec.yaml`. Create a `.env` file with your
OTLP endpoint, then initialize `TelemetryService`, `MetricsService`, and
`LogService` in your `main()` function before `runApp()`. Wrap `runApp` in
`runZonedGuarded` to catch uncaught errors. The services are singletons, so you
can call them from anywhere in your app.

### What Flutter versions are compatible with the opentelemetry package?

The `opentelemetry: ^0.18.10` package requires Dart SDK `^3.9.2`, which
corresponds to Flutter 3.32 and later. On iOS, you need a minimum platform
target of `14.0` in your Podfile. On Android, you need `minSdkVersion 24` in
your `build.gradle`. Older Flutter versions may work with earlier
`opentelemetry` package versions, but you will lose access to newer Dart
language features used in this guide.

## What's Next?

### Advanced Topics

- [Custom instrumentation](/instrument/apps/custom-instrumentation/) for
  business-specific spans tailored to your app's domain
- React Native, iOS (Swift), and Android (Kotlin) guides (coming soon)

### Scout Platform Features

- Creating alerts for crash rates and error thresholds in
  [Dashboards and Alerts](../../../../operate/dashboards-and-alerts/)
- Building mobile observability dashboards for session health and request
  latency

### Deployment and Operations

- [Docker Compose collector setup](../../../collector-setup/docker-compose-example/)
  for local development and staging environments
- [Debugging OTel pipelines](../../../../operate/debugging-otel-pipelines/) when
  telemetry is not reaching your backend

## Complete Example

The full working example is available on GitHub:

```bash showLineNumbers title="Terminal"
git clone https://github.com/base-14/examples.git
cd examples/astronomy_shop_mobile
cp .env.example .env
make run
```

The example includes:

- Distributed tracing across mobile and backend with W3C `traceparent`
  propagation
- Battery-aware adaptive sampling with four threshold levels
- OTLP/HTTP JSON export for traces, metrics, and logs with batched flushing
- App lifecycle telemetry with flush-on-background and shutdown-on-detach
- Error boundary widgets with automatic recovery and telemetry recording
- Conversion funnel tracking for product browse through checkout

Once telemetry is flowing, you can
[monitor Flutter app performance in Scout APM](https://base14.io/scout/apm) --
track request latency, crash rates, and session health across all your mobile
endpoints.

## References

- [OpenTelemetry Dart SDK](https://pub.dev/packages/opentelemetry) -- the
  `opentelemetry: ^0.18.10` package used in this guide
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/) -- the
  propagation format used by `traceparent` headers
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
  -- standard attribute names for HTTP, device, and error spans
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/) -- the
  protocol used for exporting traces, metrics, and logs

## Related Guides

- [Node.js auto-instrumentation](./nodejs.md) for backend service traces that
  connect to mobile app spans
- [Docker Compose collector setup](../../../collector-setup/docker-compose-example/)
  for running a local OTel Collector alongside the OpenTelemetry Demo
- [Debugging OTel pipelines](../../../../operate/debugging-otel-pipelines/) when
  telemetry is not reaching your backend or data looks incomplete
