---
title: Flutter RUM with Flutterific OpenTelemetry
sidebar_label: Flutter RUM with Flutterific
sidebar_position: 2
description:
  Add Real User Monitoring to Flutter apps with flutterrific_opentelemetry.
  Automatic session tracking, jank detection, ANR monitoring, screen
  load/dwell times, and navigation spans — all exported via OTLP.
keywords:
  [
    flutter rum,
    flutter real user monitoring,
    flutter opentelemetry rum,
    flutterrific opentelemetry,
    flutter jank detection,
    flutter anr detection,
    flutter screen load time,
    flutter session tracking,
    flutter mobile observability,
    flutter performance monitoring,
    flutter navigation tracing,
    flutter cold start,
    flutter rage click,
    flutter otlp exporter,
  ]
---

# Flutter RUM with Flutterific OpenTelemetry

Full Real User Monitoring (RUM) for Flutter apps using OpenTelemetry. Traces
and metrics are exported to any OTLP-compatible collector endpoint.

:::tip TL;DR
Add `flutterrific_opentelemetry`, create a `lib/otel/` directory with the files
below, wrap your `main.dart`, and you get automatic session, device, navigation,
cold start, jank, and ANR telemetry on every span.
:::

:::info Looking for the manual SDK approach?
If you prefer lower-level control with the `opentelemetry` Dart SDK, see the
[Flutter OpenTelemetry guide](./flutter.md).
:::

## What You Get

| Signal | Span / Metric | Automatic? |
| :--- | :--- | :--- |
| Session | `session.id`, `session.start`, `session.duration_ms` on **every** span | Yes |
| Device | `device.model`, `device.id`, `device.physical`, `os.type`, `os.version` | Yes |
| App | `app.version`, `app.build_number`, `app.package_name` | Yes |
| Network | `network.type` (wifi / cellular / ethernet / none) — live updates | Yes |
| Current Screen | `view.name` on **every** span | Yes |
| Cold Start | `app.cold_start` span + `app.cold_start_ms` histogram | Yes |
| Screen Load | `screen.load` span + `screen.load_time_ms` histogram | Yes |
| Screen Dwell | `screen.dwell` span + `screen.dwell_time_ms` histogram | Yes |
| Navigation | `navigation.push` / `pop` / `replace` / `remove` spans | Yes |
| App Lifecycle | `app_lifecycle.changed` spans (active, inactive, paused, etc.) | Yes |
| Jank / ANR | `jank.frame` spans + `anr.detected` spans + counters + histograms | Yes |
| Flutter Errors | Error spans with screen context and session ID | Yes |
| User Identity | `user.id`, `user.email`, `user.role` on all spans (when set) | Manual |
| Button Clicks | `interaction.*.click` spans | Manual |
| List Selections | `interaction.*.list_selection` spans | Manual |
| Rage Clicks | `rage_click.detected` spans + `rage_click.count` counter | Manual |
| Custom Events | `custom_event.*` spans | Manual |
| HTTP Requests | `http.*` spans with URL, status code, size | Manual |

## Add Dependencies

```yaml title="pubspec.yaml"
dependencies:
  flutterrific_opentelemetry: ^0.3.2
  device_info_plus: ^11.0.0
  package_info_plus: ^8.0.0
  connectivity_plus: ^6.0.0
```

```bash
flutter pub get
```

## Create the `lib/otel/` Directory

All instrumentation code lives in `lib/otel/`. Create these files:

### `rum_session.dart` — Central RUM State

Singleton that holds session, user, device, app, screen, and network context.
Every span gets a snapshot of this state via `getCommonAttributes()`.

```dart title="lib/otel/rum_session.dart"
import 'dart:async';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'package:package_info_plus/package_info_plus.dart';

class RumSession {
  RumSession._();
  static final RumSession instance = RumSession._();

  // --- Session ---
  String sessionId = 'pending';
  DateTime sessionStart = DateTime.now();

  // --- User ---
  String? _userId;
  String? _userEmail;
  String? _userRole;

  // --- Current Screen ---
  String _currentScreen = '/';
  DateTime _screenEnteredAt = DateTime.now();

  // --- Device ---
  String _deviceModel = 'unknown';
  bool _isPhysicalDevice = false;
  String _deviceId = 'unknown';

  // --- App ---
  String _appVersion = 'unknown';
  String _appBuildNumber = 'unknown';
  String _appPackageName = 'unknown';

  // --- Network ---
  String _networkType = 'unknown';
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  // --- Cold Start ---
  Duration? coldStartDuration;

  Future<void> initialize() async {
    sessionId = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
    sessionStart = DateTime.now();
    await _loadDeviceInfo();
    await _loadPackageInfo();
    await _initConnectivity();
  }

  void setUser({String? id, String? email, String? role}) {
    _userId = id;
    _userEmail = email;
    _userRole = role;
  }

  void clearUser() {
    _userId = null;
    _userEmail = null;
    _userRole = null;
  }

  void setCurrentScreen(String screen) {
    _currentScreen = screen;
    _screenEnteredAt = DateTime.now();
  }

  String get currentScreen => _currentScreen;

  Duration get currentScreenDwellTime =>
      DateTime.now().difference(_screenEnteredAt);

  Attributes getCommonAttributes() {
    final map = <String, Object>{
      'session.id': sessionId,
      'session.start': sessionStart.toIso8601String(),
      'session.duration_ms':
          DateTime.now().difference(sessionStart).inMilliseconds,
      'view.name': _currentScreen,
      'device.model': _deviceModel,
      'device.physical': _isPhysicalDevice.toString(),
      'device.id': _deviceId,
      'os.type': Platform.operatingSystem,
      'os.version': Platform.operatingSystemVersion,
      'app.version': _appVersion,
      'app.build_number': _appBuildNumber,
      'app.package_name': _appPackageName,
      'network.type': _networkType,
    };

    if (_userId != null) map['user.id'] = _userId!;
    if (_userEmail != null) map['user.email'] = _userEmail!;
    if (_userRole != null) map['user.role'] = _userRole!;
    if (coldStartDuration != null) {
      map['app.cold_start_ms'] = coldStartDuration!.inMilliseconds;
    }

    return map.toAttributes();
  }

  Future<void> _loadDeviceInfo() async {
    final deviceInfo = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final android = await deviceInfo.androidInfo;
      _deviceModel = android.model;
      _isPhysicalDevice = android.isPhysicalDevice;
      _deviceId = android.id;
    } else if (Platform.isIOS) {
      final ios = await deviceInfo.iosInfo;
      _deviceModel = ios.utsname.machine;
      _isPhysicalDevice = ios.isPhysicalDevice;
      _deviceId = ios.identifierForVendor ?? 'unknown';
    }
  }

  Future<void> _loadPackageInfo() async {
    final info = await PackageInfo.fromPlatform();
    _appVersion = info.version;
    _appBuildNumber = info.buildNumber;
    _appPackageName = info.packageName;
  }

  Future<void> _initConnectivity() async {
    final connectivity = Connectivity();
    final results = await connectivity.checkConnectivity();
    _updateNetworkType(results);
    _connectivitySub =
        connectivity.onConnectivityChanged.listen(_updateNetworkType);
  }

  void _updateNetworkType(List<ConnectivityResult> results) {
    if (results.contains(ConnectivityResult.wifi)) {
      _networkType = 'wifi';
    } else if (results.contains(ConnectivityResult.mobile)) {
      _networkType = 'cellular';
    } else if (results.contains(ConnectivityResult.ethernet)) {
      _networkType = 'ethernet';
    } else if (results.contains(ConnectivityResult.none)) {
      _networkType = 'none';
    } else {
      _networkType = 'other';
    }
  }

  void dispose() {
    _connectivitySub?.cancel();
  }
}
```

### `rum_span_processor.dart` — Span Enrichment

Wraps the real `BatchSpanProcessor` and injects RUM context into **every** span
at `onStart`. This is the key mechanism — you don't need to manually add
session/device/screen attributes to each span.

```dart title="lib/otel/rum_span_processor.dart"
// ignore: depend_on_referenced_packages
import 'package:dartastic_opentelemetry/dartastic_opentelemetry.dart' as sdk;
// ignore: depend_on_referenced_packages
import 'package:dartastic_opentelemetry_api/dartastic_opentelemetry_api.dart';
import 'rum_session.dart';

class RumSpanProcessor implements sdk.SpanProcessor {
  RumSpanProcessor(this._delegate);
  final sdk.SpanProcessor _delegate;

  @override
  Future<void> onStart(sdk.Span span, Context? parentContext) async {
    final rumAttributes = RumSession.instance.getCommonAttributes();
    span.addAttributes(rumAttributes);
    return _delegate.onStart(span, parentContext);
  }

  @override
  Future<void> onEnd(sdk.Span span) => _delegate.onEnd(span);

  @override
  Future<void> onNameUpdate(sdk.Span span, String newName) =>
      _delegate.onNameUpdate(span, newName);

  @override
  Future<void> shutdown() => _delegate.shutdown();

  @override
  Future<void> forceFlush() => _delegate.forceFlush();
}
```

### `rum_route_observer.dart` — Navigation + Screen Load/Dwell

Attach to `MaterialApp.navigatorObservers`. Automatically tracks:

- `navigation.push` / `pop` / `replace` / `remove` spans with route names
- `screen.load` — time from `Navigator.push` to first frame rendered
- `screen.dwell` — time user spent on each screen

```dart title="lib/otel/rum_route_observer.dart"
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'rum_session.dart';

class RumRouteObserver extends NavigatorObserver {
  final _tracer = FlutterOTel.tracer;
  final Map<String, DateTime> _screenPushTimes = {};
  final Map<String, DateTime> _dwellStartTimes = {};

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final routeName = route.settings.name ?? 'unknown';
    final previousName = previousRoute?.settings.name;
    _endDwellSpan(previousName);

    RumSession.instance.setCurrentScreen(routeName);
    _screenPushTimes[routeName] = DateTime.now();

    final span = _tracer.startSpan('navigation.push');
    span.setStringAttribute<String>('nav.action', 'push');
    span.setStringAttribute<String>('nav.route', routeName);
    if (previousName != null) {
      span.setStringAttribute<String>('nav.previous_route', previousName);
    }
    span.end();

    _startDwellTracking(routeName);
    SchedulerBinding.instance.addPostFrameCallback((_) {
      _recordScreenLoadTime(routeName);
    });
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final routeName = route.settings.name ?? 'unknown';
    final previousName = previousRoute?.settings.name;
    _endDwellSpan(routeName);
    _screenPushTimes.remove(routeName);

    if (previousName != null) {
      RumSession.instance.setCurrentScreen(previousName);
      _startDwellTracking(previousName);
    }

    final span = _tracer.startSpan('navigation.pop');
    span.setStringAttribute<String>('nav.action', 'pop');
    span.setStringAttribute<String>('nav.route', routeName);
    if (previousName != null) {
      span.setStringAttribute<String>('nav.previous_route', previousName);
    }
    span.end();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final oldName = oldRoute?.settings.name;
    final newName = newRoute?.settings.name ?? 'unknown';
    _endDwellSpan(oldName);

    RumSession.instance.setCurrentScreen(newName);
    _startDwellTracking(newName);

    final span = _tracer.startSpan('navigation.replace');
    span.setStringAttribute<String>('nav.action', 'replace');
    span.setStringAttribute<String>('nav.route', newName);
    if (oldName != null) {
      span.setStringAttribute<String>('nav.previous_route', oldName);
    }
    span.end();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    final routeName = route.settings.name ?? 'unknown';
    _endDwellSpan(routeName);

    final span = _tracer.startSpan('navigation.remove');
    span.setStringAttribute<String>('nav.action', 'remove');
    span.setStringAttribute<String>('nav.route', routeName);
    span.end();
  }

  void _startDwellTracking(String routeName) {
    _dwellStartTimes[routeName] = DateTime.now();
  }

  void _endDwellSpan(String? routeName) {
    if (routeName == null) return;
    final startTime = _dwellStartTimes.remove(routeName);
    if (startTime == null) return;

    final dwellMs = DateTime.now().difference(startTime).inMilliseconds;
    final span = _tracer.startSpan('screen.dwell');
    span.setStringAttribute<String>('view.name', routeName);
    span.setIntAttribute('view.dwell_time_ms', dwellMs);
    span.end();

    FlutterOTel.meter(name: 'rum.screen')
        .createHistogram<double>(
          name: 'screen.dwell_time_ms',
          unit: 'ms',
          description: 'Time user spent on screen',
        )
        .record(dwellMs.toDouble());
  }

  void _recordScreenLoadTime(String routeName) {
    final pushTime = _screenPushTimes[routeName];
    if (pushTime == null) return;

    final loadMs = DateTime.now().difference(pushTime).inMilliseconds;
    final span = _tracer.startSpan('screen.load');
    span.setStringAttribute<String>('view.name', routeName);
    span.setIntAttribute('view.load_time_ms', loadMs);
    span.end();

    FlutterOTel.meter(name: 'rum.screen')
        .createHistogram<double>(
          name: 'screen.load_time_ms',
          unit: 'ms',
          description: 'Time from navigation push to first frame rendered',
        )
        .record(loadMs.toDouble());
  }
}
```

### `rum_cold_start.dart` — Startup Time

Measures time from `main()` entry to the first frame painted on screen.

```dart title="lib/otel/rum_cold_start.dart"
import 'package:flutter/scheduler.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'rum_session.dart';

class RumColdStart {
  RumColdStart._();
  static DateTime? _mainStartTime;

  /// Call as the VERY FIRST line in main().
  static void markMainStart() {
    _mainStartTime = DateTime.now();
  }

  /// Call after runApp(). Schedules a post-frame callback to measure total
  /// cold start duration and emit a span + metric.
  static void measureFirstFrame() {
    if (_mainStartTime == null) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      final duration = DateTime.now().difference(_mainStartTime!);
      RumSession.instance.coldStartDuration = duration;

      final tracer = FlutterOTel.tracer;
      final span = tracer.startSpan('app.cold_start');
      span.setIntAttribute('app.cold_start_ms', duration.inMilliseconds);
      span.setStringAttribute<String>('app.start_type', 'cold');
      span.end();

      FlutterOTel.meter(name: 'rum.app')
          .createHistogram<double>(
            name: 'app.cold_start_ms',
            unit: 'ms',
            description: 'Time from main() to first frame rendered',
          )
          .record(duration.inMilliseconds.toDouble());
    });
  }
}
```

### `jank_detector.dart` — Frame Jank + ANR Detection

Monitors every frame for jank (>16 ms) and runs a background isolate watchdog
for ANR (main thread blocked >5 s).

```dart title="lib/otel/jank_detector.dart"
import 'dart:async';
import 'dart:isolate';
// ignore: depend_on_referenced_packages
import 'package:dartastic_opentelemetry_api/dartastic_opentelemetry_api.dart'
    as api;
import 'package:flutter/scheduler.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';

class JankDetector {
  JankDetector({
    required UITracer tracer,
    required UIMeter meter,
    this.jankThresholdMs = 16.0,
    this.severeJankThresholdMs = 100.0,
    this.anrThresholdMs = 5000.0,
  })  : _tracer = tracer,
        _meter = meter;

  final UITracer _tracer;
  final UIMeter _meter;
  final double jankThresholdMs;
  final double severeJankThresholdMs;
  final double anrThresholdMs;

  late final api.APICounter<int> _jankCounter;
  late final api.APICounter<int> _severeJankCounter;
  late final api.APICounter<int> _anrCounter;
  late final api.APIHistogram<double> _buildDurationHistogram;
  late final api.APIHistogram<double> _rasterDurationHistogram;

  Isolate? _watchdogIsolate;
  SendPort? _heartbeatPort;
  Timer? _heartbeatTimer;
  ReceivePort? _anrReceivePort;
  bool _paused = false;

  void start() {
    _initMetrics();
    _startFrameTimingCallback();
    _startAnrWatchdog();
  }

  void stop() {
    _heartbeatTimer?.cancel();
    _watchdogIsolate?.kill(priority: Isolate.immediate);
    _anrReceivePort?.close();
  }

  void pause() {
    _paused = true;
    _heartbeatTimer?.cancel();
  }

  void resume() {
    _paused = false;
    _startHeartbeats();
  }

  void _initMetrics() {
    _jankCounter = _meter.createCounter<int>(
      name: 'app.jank.count',
      description: 'Number of janky frames (>16ms)',
    );
    _severeJankCounter = _meter.createCounter<int>(
      name: 'app.jank.severe.count',
      description: 'Number of severely janky frames (>100ms)',
    );
    _anrCounter = _meter.createCounter<int>(
      name: 'app.anr.count',
      description: 'Number of ANR events (main thread blocked >5s)',
    );
    _buildDurationHistogram = _meter.createHistogram<double>(
      name: 'app.frame.build_duration_ms',
      unit: 'ms',
      description: 'Frame build phase duration in milliseconds',
    );
    _rasterDurationHistogram = _meter.createHistogram<double>(
      name: 'app.frame.raster_duration_ms',
      unit: 'ms',
      description: 'Frame raster phase duration in milliseconds',
    );
  }

  void _startFrameTimingCallback() {
    SchedulerBinding.instance.addTimingsCallback((timings) {
      for (final timing in timings) {
        final buildMs = timing.buildDuration.inMicroseconds / 1000.0;
        final rasterMs = timing.rasterDuration.inMicroseconds / 1000.0;
        final totalMs = buildMs + rasterMs;

        _buildDurationHistogram.record(buildMs);
        _rasterDurationHistogram.record(rasterMs);

        if (totalMs > jankThresholdMs) {
          _jankCounter.add(1);
          final span = _tracer.startSpan('jank.frame');
          span.setDoubleAttribute('frame.build_duration_ms', buildMs);
          span.setDoubleAttribute('frame.raster_duration_ms', rasterMs);
          span.setDoubleAttribute('frame.total_duration_ms', totalMs);

          if (totalMs > severeJankThresholdMs) {
            _severeJankCounter.add(1);
            span.setStringAttribute<String>('jank.severity', 'severe');
            span.setStatus(SpanStatusCode.Error, 'Severe jank detected');
          } else {
            span.setStringAttribute<String>('jank.severity', 'minor');
          }
          span.end();
        }
      }
    });
  }

  Future<void> _startAnrWatchdog() async {
    _anrReceivePort = ReceivePort();
    _watchdogIsolate = await Isolate.spawn(
      _watchdogEntryPoint,
      _WatchdogConfig(
        mainSendPort: _anrReceivePort!.sendPort,
        anrThresholdMs: anrThresholdMs,
      ),
    );
    _anrReceivePort!.listen((message) {
      if (message is SendPort) {
        _heartbeatPort = message;
        _startHeartbeats();
      } else if (message == 'ANR') {
        _onAnrDetected();
      }
    });
  }

  void _startHeartbeats() {
    _heartbeatTimer?.cancel();
    if (_paused) return;
    _heartbeatTimer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _heartbeatPort?.send('heartbeat'),
    );
  }

  void _onAnrDetected() {
    _anrCounter.add(1);
    final span = _tracer.startSpan('anr.detected');
    span.setDoubleAttribute('anr.threshold_ms', anrThresholdMs);
    span.setStatus(SpanStatusCode.Error, 'ANR: main thread unresponsive');
    span.end();

    FlutterOTel.reportError(
      'ANR detected: main thread unresponsive for '
      '>${anrThresholdMs.toInt()}ms',
      Exception('ANR detected'),
      StackTrace.current,
    );
  }

  static void _watchdogEntryPoint(_WatchdogConfig config) {
    final receivePort = ReceivePort();
    config.mainSendPort.send(receivePort.sendPort);

    DateTime lastHeartbeat = DateTime.now();
    receivePort.listen((message) {
      if (message == 'heartbeat') {
        lastHeartbeat = DateTime.now();
      }
    });

    Timer.periodic(const Duration(seconds: 1), (_) {
      final elapsed =
          DateTime.now().difference(lastHeartbeat).inMilliseconds;
      if (elapsed > config.anrThresholdMs) {
        config.mainSendPort.send('ANR');
        lastHeartbeat = DateTime.now();
      }
    });
  }
}

class _WatchdogConfig {
  const _WatchdogConfig({
    required this.mainSendPort,
    required this.anrThresholdMs,
  });
  final SendPort mainSendPort;
  final double anrThresholdMs;
}
```

### `rum_http_client.dart` — Instrumented HTTP Client

Drop-in replacement for `http.Client`. Creates OTel spans around every HTTP
request.

```dart title="lib/otel/rum_http_client.dart"
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
// ignore: depend_on_referenced_packages
import 'package:http/http.dart' as http;

class RumHttpClient extends http.BaseClient {
  RumHttpClient([http.Client? inner]) : _inner = inner ?? http.Client();
  final http.Client _inner;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final tracer = FlutterOTel.tracer;
    final span = tracer.startSpan('http.${request.method.toLowerCase()}');
    span.setStringAttribute<String>('http.method', request.method);
    span.setStringAttribute<String>('http.url', request.url.toString());
    span.setStringAttribute<String>('http.url.host', request.url.host);
    span.setStringAttribute<String>('http.url.path', request.url.path);

    if (request.contentLength != null && request.contentLength! > 0) {
      span.setIntAttribute('http.request.size', request.contentLength!);
    }

    try {
      final response = await _inner.send(request);
      span.setIntAttribute('http.status_code', response.statusCode);
      if (response.contentLength != null) {
        span.setIntAttribute('http.response.size', response.contentLength!);
      }
      if (response.statusCode >= 400) {
        span.setStatus(
          SpanStatusCode.Error,
          'HTTP ${response.statusCode} ${response.reasonPhrase}',
        );
      }
      span.end();
      return response;
    } catch (error, stackTrace) {
      span.setStringAttribute<String>(
          'error.type', error.runtimeType.toString());
      span.setStringAttribute<String>('error.message', error.toString());
      span.setStatus(SpanStatusCode.Error, error.toString());
      FlutterOTel.reportError(
        'HTTP request failed: ${request.method} ${request.url}',
        error,
        stackTrace,
      );
      span.end();
      rethrow;
    }
  }

  @override
  void close() {
    _inner.close();
    super.close();
  }
}
```

### `rum_rage_click_detector.dart` — Frustration Signal

Detects rapid repeated taps on the same UI element (3+ within 2 seconds).

```dart title="lib/otel/rum_rage_click_detector.dart"
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';

class RumRageClickDetector {
  RumRageClickDetector._();
  static final RumRageClickDetector instance = RumRageClickDetector._();

  static const int _rageThreshold = 3;
  static const Duration _rageWindow = Duration(seconds: 2);
  final Map<String, List<DateTime>> _clickHistory = {};

  /// Record a tap on [elementId]. Returns true if rage click was detected.
  bool recordClick(String elementId) {
    final now = DateTime.now();
    final history = _clickHistory.putIfAbsent(elementId, () => []);
    history.removeWhere((t) => now.difference(t) > _rageWindow);
    history.add(now);

    if (history.length >= _rageThreshold) {
      _emitRageClick(elementId, history.length);
      history.clear();
      return true;
    }
    return false;
  }

  void _emitRageClick(String elementId, int clickCount) {
    final tracer = FlutterOTel.tracer;
    final span = tracer.startSpan('rage_click.detected');
    span.setStringAttribute<String>('rage_click.element_id', elementId);
    span.setIntAttribute('rage_click.count', clickCount);
    span.setIntAttribute(
        'rage_click.window_ms', _rageWindow.inMilliseconds);
    span.setStatus(
      SpanStatusCode.Error,
      'Rage click detected on $elementId',
    );
    span.end();

    FlutterOTel.meter(name: 'rum.interaction')
        .createCounter<int>(
          name: 'rage_click.count',
          description: 'Number of rage click events detected',
        )
        .add(1);
  }
}
```

### `rum_events.dart` — Custom Business Events

Fire-and-forget API for custom business events. RUM context is automatically
attached.

```dart title="lib/otel/rum_events.dart"
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';

class RumEvents {
  RumEvents._();

  static void logEvent(String name, {Map<String, Object>? attributes}) {
    final tracer = FlutterOTel.tracer;
    final span = tracer.startSpan('custom_event.$name');
    span.setStringAttribute<String>('event.name', name);
    span.setStringAttribute<String>('event.domain', 'business');

    if (attributes != null) {
      for (final entry in attributes.entries) {
        final value = entry.value;
        if (value is String) {
          span.setStringAttribute<String>(entry.key, value);
        } else if (value is int) {
          span.setIntAttribute(entry.key, value);
        } else if (value is double) {
          span.setDoubleAttribute(entry.key, value);
        }
      }
    }
    span.end();
  }

  static void logTimedEvent(
    String name,
    Duration duration, {
    Map<String, Object>? attributes,
  }) {
    final allAttrs = <String, Object>{
      'event.duration_ms': duration.inMilliseconds,
      ...?attributes,
    };
    logEvent(name, attributes: allAttrs);
  }
}
```

### `otel_config.dart` — Wire Everything Together

Central initialization. Call `OTelConfig.initialize()` once before `runApp()`.

Replace the endpoint URLs with your OTLP collector endpoint.

```dart title="lib/otel/otel_config.dart"
import 'package:flutter/widgets.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'jank_detector.dart';
import 'rum_http_client.dart';
import 'rum_route_observer.dart';
import 'rum_session.dart';
import 'rum_span_processor.dart';

class OTelConfig {
  OTelConfig._();
  static JankDetector? _jankDetector;
  static RumHttpClient? _httpClient;

  /// Call once before runApp().
  static Future<void> initialize() async {
    WidgetsFlutterBinding.ensureInitialized();

    // ── Configure your collector endpoint ──────────────────────────
    // Replace these with your public OTel collector URL.
    const traceEndpoint = String.fromEnvironment(
      'OTEL_TRACE_ENDPOINT',
      defaultValue: 'https://otel-collector.example.com',
    );
    const metricEndpoint = String.fromEnvironment(
      'OTEL_METRIC_ENDPOINT',
      defaultValue: 'https://otel-collector.example.com',
    );
    // ───────────────────────────────────────────────────────────────

    // Initialize RUM session FIRST — before FlutterOTel, because
    // FlutterOTel.initialize() creates lifecycle spans that trigger
    // RumSpanProcessor, which needs RumSession to be ready.
    await RumSession.instance.initialize();

    // Trace exporter (OTLP/HTTP)
    final spanExporter = OtlpHttpSpanExporter(
      OtlpHttpExporterConfig(endpoint: traceEndpoint),
    );
    final batchProcessor = BatchSpanProcessor(spanExporter);

    // Wrap in RumSpanProcessor to enrich ALL spans with RUM context.
    final rumProcessor = RumSpanProcessor(batchProcessor);

    // Metric exporter (OTLP/gRPC)
    final metricExporter = OtlpGrpcMetricExporter(
      OtlpGrpcMetricExporterConfig(
        endpoint: metricEndpoint,
        insecure: false, // set true for non-TLS endpoints
      ),
    );

    await FlutterOTel.initialize(
      serviceName: 'your-app-name',
      serviceVersion: '1.0.0',
      tracerName: 'your-app',
      spanProcessor: rumProcessor,
      metricExporter: metricExporter,
      enableMetrics: true,
      secure: true, // set false for non-TLS endpoints
    );

    // Start jank/ANR detection.
    _jankDetector = JankDetector(
      tracer: FlutterOTel.tracer,
      meter: FlutterOTel.meter(name: 'jank_detector'),
    );
    _jankDetector!.start();

    // Create instrumented HTTP client.
    _httpClient = RumHttpClient();
  }

  /// Attach to MaterialApp.navigatorObservers.
  static RumRouteObserver get routeObserver => RumRouteObserver();

  static OTelLifecycleObserver get lifecycleObserver =>
      FlutterOTel.lifecycleObserver;

  static OTelInteractionTracker get interactionTracker =>
      FlutterOTel.interactionTracker;

  /// Use this for all HTTP requests instead of http.Client().
  static RumHttpClient get httpClient => _httpClient ?? RumHttpClient();

  static void pauseJankDetection() => _jankDetector?.pause();
  static void resumeJankDetection() => _jankDetector?.resume();

  static void dispose() {
    _jankDetector?.stop();
    _httpClient?.close();
    RumSession.instance.dispose();
  }
}
```

## Create the Instrumented Entry Point

Create `lib/main_otel.dart` — a wrapper around your existing `main.dart` that
adds OTel initialization, error handlers, and cold start measurement. Your
original `main.dart` stays untouched.

```dart title="lib/main_otel.dart"
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutterrific_opentelemetry/flutterrific_opentelemetry.dart';
import 'main.dart';          // Your existing app
import 'otel/otel_config.dart';
import 'otel/rum_cold_start.dart';
import 'otel/rum_session.dart';

Future<void> main() async {
  RumColdStart.markMainStart(); // FIRST LINE — records main() entry time.

  // Capture Flutter framework errors with screen + session context.
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    FlutterOTel.reportError(
      details.exceptionAsString(),
      details.exception,
      details.stack,
      attributes: {
        'error.screen': RumSession.instance.currentScreen,
        'error.session_id': RumSession.instance.sessionId,
      },
    );
  };

  // Capture uncaught async errors.
  PlatformDispatcher.instance.onError = (error, stack) {
    FlutterOTel.reportError(
      'Uncaught error',
      error,
      stack,
      attributes: {
        'error.screen': RumSession.instance.currentScreen,
        'error.session_id': RumSession.instance.sessionId,
      },
    );
    return true;
  };

  await OTelConfig.initialize();
  WidgetsBinding.instance.addObserver(OTelConfig.lifecycleObserver);
  runApp(const MyApp());
  RumColdStart.measureFirstFrame(); // Schedules post-first-frame callback.
}
```

Run with:

```bash
flutter run --target=lib/main_otel.dart
```

## Wire Into Your App

### Navigator Observer

Add the route observer to your `MaterialApp` (or `CupertinoApp`):

```dart
MaterialApp(
  navigatorObservers: [OTelConfig.routeObserver],
  // ...
)
```

### Named Routes

For screen load/dwell tracking to work, every `Navigator.push` must include a
`RouteSettings` with a name:

```dart
Navigator.push<void>(
  context,
  MaterialPageRoute(
    settings: const RouteSettings(name: '/song_detail'),
    builder: (context) => const SongDetailPage(),
  ),
);
```

Without `RouteSettings`, the route name defaults to `'unknown'`.

## Manual Instrumentation

Everything above is automatic once wired. The following are opt-in for
richer telemetry.

### User Identification

Call after login:

```dart
RumSession.instance.setUser(
  id: 'user_123',
  email: 'user@example.com',
  role: 'premium',
);
```

Call on logout:

```dart
RumSession.instance.clearUser();
```

Once set, `user.id`, `user.email`, and `user.role` appear on every subsequent
span.

### Interaction Tracking

Use `OTelConfig.interactionTracker` in `onPressed` / `onTap` callbacks:

```dart
// Button click
ElevatedButton(
  onPressed: () {
    OTelConfig.interactionTracker
        .trackButtonClick(context, 'checkout_button');
    // ... your logic
  },
  child: const Text('Checkout'),
)

// List item selection
ListView.builder(
  itemBuilder: (context, index) {
    return ListTile(
      onTap: () {
        OTelConfig.interactionTracker
            .trackListItemSelected(context, 'product_list', index);
        // ... your logic
      },
    );
  },
)
```

### Rage Click Detection

Add alongside interaction tracking for elements users might frustration-tap:

```dart
onTap: () {
  OTelConfig.interactionTracker
      .trackListItemSelected(context, 'song_list', index);
  RumRageClickDetector.instance.recordClick('song_card_$index');
  // ... your logic
}
```

### Custom Business Events

```dart
// Simple event
RumEvents.logEvent('purchase_completed', attributes: {
  'item.id': 'SKU-123',
  'item.price': 29.99,
  'payment.method': 'credit_card',
});

// Timed event (e.g., how long a search took)
final stopwatch = Stopwatch()..start();
final results = await searchApi(query);
stopwatch.stop();
RumEvents.logTimedEvent('search_completed', stopwatch.elapsed, attributes: {
  'search.query': query,
  'search.result_count': results.length,
});
```

### Instrumented HTTP Client

Use `OTelConfig.httpClient` instead of `http.Client()`:

```dart
final response = await OTelConfig.httpClient.get(
  Uri.parse('https://api.example.com/songs'),
);
```

Every request automatically gets an `http.get` (or `http.post`, etc.) span with
URL, status code, and response size. RUM context is attached by the
`RumSpanProcessor`.

## Configuration

### Collector Endpoint

Set at build time via `--dart-define`:

```bash
flutter run \
  --dart-define=OTEL_TRACE_ENDPOINT=https://otel.yourcompany.com \
  --dart-define=OTEL_METRIC_ENDPOINT=https://otel.yourcompany.com
```

Or hardcode in `otel_config.dart`.

### Jank Thresholds

In `otel_config.dart`, customize the `JankDetector`:

```dart
_jankDetector = JankDetector(
  tracer: FlutterOTel.tracer,
  meter: FlutterOTel.meter(name: 'jank_detector'),
  jankThresholdMs: 16.0,        // Minimum frame duration to flag
  severeJankThresholdMs: 100.0,  // Threshold for "severe" jank
  anrThresholdMs: 5000.0,       // Main thread blocked threshold
);
```

### Service Name

Change `serviceName` and `tracerName` in `OTelConfig.initialize()`:

```dart
await FlutterOTel.initialize(
  serviceName: 'my-flutter-app',   // Appears as service.name in traces
  serviceVersion: '2.1.0',
  tracerName: 'my-flutter-app',
  // ...
);
```

## Initialization Order

The order matters. `RumSession.initialize()` **must** be called before
`FlutterOTel.initialize()` because `FlutterOTel.initialize()` creates lifecycle
spans during startup, which trigger `RumSpanProcessor.onStart()`, which calls
`RumSession.instance.getCommonAttributes()`. If the session isn't ready, you get
stale default values.

1. `RumColdStart.markMainStart()` — records timestamp
2. Set error handlers — catches errors during init
3. `RumSession.instance.initialize()` — loads device info, network, session ID
4. `FlutterOTel.initialize(...)` — creates lifecycle spans (RumSession must be
   ready)
5. `JankDetector.start()` — frame monitoring begins
6. `WidgetsBinding.addObserver(...)` — lifecycle observer
7. `runApp(...)` — app starts
8. `RumColdStart.measureFirstFrame()` — schedules post-frame callback

## Telemetry Reference

### Spans

| Span Name | Source | Key Attributes |
| :--- | :--- | :--- |
| `app.cold_start` | `RumColdStart` | `app.cold_start_ms`, `app.start_type` |
| `navigation.push` | `RumRouteObserver` | `nav.route`, `nav.previous_route`, `nav.action` |
| `navigation.pop` | `RumRouteObserver` | `nav.route`, `nav.previous_route`, `nav.action` |
| `navigation.replace` | `RumRouteObserver` | `nav.route`, `nav.previous_route`, `nav.action` |
| `navigation.remove` | `RumRouteObserver` | `nav.route`, `nav.action` |
| `screen.load` | `RumRouteObserver` | `view.name`, `view.load_time_ms` |
| `screen.dwell` | `RumRouteObserver` | `view.name`, `view.dwell_time_ms` |
| `app_lifecycle.changed` | `OTelLifecycleObserver` | `app_lifecycle.state`, `app_lifecycle.previous_state` |
| `jank.frame` | `JankDetector` | `frame.build_duration_ms`, `frame.raster_duration_ms`, `jank.severity` |
| `anr.detected` | `JankDetector` | `anr.threshold_ms` |
| `http.<method>` | `RumHttpClient` | `http.method`, `http.url`, `http.status_code`, `http.response.size` |
| `interaction.*.click` | `OTelInteractionTracker` | `interaction.target`, `interaction.type` |
| `interaction.*.list_selection` | `OTelInteractionTracker` | `interaction.target`, `list_selected_index` |
| `rage_click.detected` | `RumRageClickDetector` | `rage_click.element_id`, `rage_click.count` |
| `custom_event.<name>` | `RumEvents` | `event.name`, `event.domain`, custom attributes |
| `error.*` | Error handlers | `error.screen`, `error.session_id` |

### Attributes on Every Span (via RumSpanProcessor)

| Attribute | Example Value |
| :--- | :--- |
| `session.id` | `hgbat8zso5` |
| `session.start` | `2026-03-03T18:26:04.137259` |
| `session.duration_ms` | `14614` |
| `view.name` | `/song_detail` |
| `device.model` | `Pixel 8a` |
| `device.id` | `BP4A.260105.004.E1` |
| `device.physical` | `true` |
| `os.type` | `android` |
| `os.version` | `BP4A.260105.004.E1` |
| `app.version` | `1.0.0` |
| `app.build_number` | `1` |
| `app.package_name` | `dev.flutter.platform_design` |
| `network.type` | `cellular` |
| `app.cold_start_ms` | `1305` |
| `user.id` | `user_123` (when set) |
| `user.email` | `user@example.com` (when set) |
| `user.role` | `premium` (when set) |

### Metrics

| Metric Name | Type | Unit |
| :--- | :--- | :--- |
| `app.cold_start_ms` | Histogram | ms |
| `screen.load_time_ms` | Histogram | ms |
| `screen.dwell_time_ms` | Histogram | ms |
| `app.jank.count` | Counter | — |
| `app.jank.severe.count` | Counter | — |
| `app.anr.count` | Counter | — |
| `app.frame.build_duration_ms` | Histogram | ms |
| `app.frame.raster_duration_ms` | Histogram | ms |
| `rage_click.count` | Counter | — |

## File Structure

```text
lib/
├── main.dart                    # Original app (no OTel imports needed)
├── main_otel.dart               # Instrumented entry point
└── otel/
    ├── otel_config.dart         # Central initialization
    ├── rum_session.dart         # Session/device/user/screen/network state
    ├── rum_span_processor.dart  # Enriches every span with RUM context
    ├── rum_route_observer.dart  # Navigation + screen load/dwell
    ├── rum_cold_start.dart      # Cold start measurement
    ├── rum_http_client.dart     # Instrumented HTTP client
    ├── rum_rage_click_detector.dart  # Frustration signal detection
    ├── rum_events.dart          # Custom business events
    └── jank_detector.dart       # Frame jank + ANR detection
```

## Quick Start Checklist

- [ ] Add dependencies to `pubspec.yaml` and run `flutter pub get`
- [ ] Copy the `lib/otel/` directory into your project
- [ ] Update `otel_config.dart` with your collector endpoint and service name
- [ ] Create `main_otel.dart` wrapping your existing app
- [ ] Add `navigatorObservers: [OTelConfig.routeObserver]` to `MaterialApp`
- [ ] Add `RouteSettings(name: '/route_name')` to all `Navigator.push` calls
- [ ] Add `OTelConfig.interactionTracker.trackButtonClick(...)` to key buttons
- [ ] Run with `flutter run --target=lib/main_otel.dart`
- [ ] Verify spans in your collector/backend

## Next Steps

- [Flutter Mobile Observability guide](/guides/flutter-mobile-observability/)
  for comparing this approach with the manual SDK
- [Create Your First Dashboard](/guides/create-your-first-dashboard/) to
  build dashboards from your mobile telemetry data
- [Creating Alerts with LogX](/guides/creating-alerts-with-logx/) to set up
  alerts on crash rates, ANR counts, or slow screen loads
- [Troubleshooting Missing Telemetry Data](/guides/troubleshooting-missing-data/)
  if spans are not arriving at your collector
