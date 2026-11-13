---
title: Turning RUM Off at Runtime - a kill switch for Scout RUM
sidebar_label: Turning RUM Off at Runtime
sidebar_position: 29
description:
  Turn Scout RUM fully off and back on at runtime with enabled and
  setEnabled, for example outside working hours or when a background job wakes
  the app. Works across Android, iOS, Kotlin Multiplatform, Flutter, React
  Native, and React web.
keywords:
  [
    rum kill switch,
    disable rum,
    turn off rum,
    rum working hours,
    workmanager rum session,
    background wake session,
    setEnabled,
    scout-android,
    scout-ios,
    scout-kmp,
    scout-flutter,
    scout-react,
    base14,
  ]
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Turning RUM Off at Runtime

Every Scout RUM SDK has a kill switch. Pass `enabled` at initialization and
call `setEnabled(true | false)` at runtime to turn RUM fully off and back on in
the same process. While it is off, nothing leaves the device and no session is
counted.

A common case is an app that must not record outside working hours. If a 24/7
background service, an Android WorkManager job, or a React Native headless task
wakes the app at night, `initialize` runs with `enabled: false`, so that wake
sends nothing and counts no session. The app turns RUM on again, for example
an hour before a shift starts.

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## Requirements

| SDK | Minimum version |
| --- | --- |
| Android | `io.base14:scout-android:0.1.13` |
| iOS | `ios-0.1.13` (Swift Package) |
| Kotlin Multiplatform | `io.base14:scout-kmp:0.1.15` |
| Flutter | `scout_flutter` `0.5.0` |
| React Native and React web | `@base-14/scout-react` `0.1.23` |

## Kill switch or per-user sampling?

| | `setEnabled(false)` | `setUserSampling(false)` |
| --- | --- | --- |
| Spans | Dropped | Dropped |
| Logs and metrics | Dropped | Still sent |
| Errors, crashes, ANRs | Dropped, whatever `alwaysCaptureErrors` says | Still sent while `alwaysCaptureErrors` is on |
| Session | None is created or counted | A session is created and counted |
| Takes effect | Immediately | At the next session start |
| Persisted | No, your app passes it every launch | Yes |

Use [Per-user Sampling](./user-sampling.md) to choose which users are traced.
Use the kill switch when RUM must not run at all.

## Set it up

Your app owns the schedule. Cache it locally, because a background wake may
have no network. Then:

1. At initialization, pass `enabled` from that cached schedule.
2. When the window opens or closes in a running process, call
   `setEnabled(true)` or `setEnabled(false)`.

<Tabs groupId="platform">
<TabItem value="android" label="Android">

```kotlin
// Application.onCreate() also runs when WorkManager wakes the app.
Scout.initialize(
  this,
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
    enabled = shiftSchedule.isRumWindow(System.currentTimeMillis()),
  ),
)

// When the window opens or closes
Scout.setEnabled(true)
Scout.setEnabled(false)
Scout.isEnabled // current state
```

</TabItem>
<TabItem value="ios" label="iOS">

```swift
Scout.start(
  serviceName: "my-app",
  endpoint: "https://otel.example.com",
  enabled: shiftSchedule.isRumWindow(Date())
)

// When the window opens or closes
Scout.setEnabled(true)
Scout.setEnabled(false)
Scout.isEnabled // current state
```

`enabled:` is the last parameter of `Scout.start(...)` and
`Scout.startBridge(...)`.

</TabItem>
<TabItem value="kmp" label="Kotlin Multiplatform">

```kotlin
Scout.initialize(
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
    enabled = shiftSchedule.isRumWindow(),
  ),
)

// When the window opens or closes
Scout.setEnabled(true)
Scout.setEnabled(false)
Scout.isEnabled // current state
```

</TabItem>
<TabItem value="flutter" label="Flutter">

```dart
bool rumWindow(DateTime now, Shift shift) =>
    now.isAfter(shift.start.subtract(const Duration(hours: 1))) &&
    now.isBefore(shift.end);

Future<void> main() async {
  final shift = await ShiftCache.read(); // local, no network
  await ScoutFlutter.initialize(
    config: ScoutFlutterConfig(
      serviceName: 'my-app',
      endpoint: 'https://otel.example.com',
      enabled: rumWindow(DateTime.now(), shift),
    ),
  );
  runApp(const MyApp());

  // The process may stay alive into the window, or out of it.
  Timer.periodic(const Duration(minutes: 1), (_) {
    ScoutFlutter.setEnabled(rumWindow(DateTime.now(), shift));
  });
}
```

If a WorkManager job runs its own Dart entry point (for example the
`workmanager` plugin's `callbackDispatcher`) and never calls
`ScoutFlutter.initialize`, it records nothing already. Add `enabled` wherever
`initialize` runs. `ScoutFlutter.isEnabled` returns the current state.

</TabItem>
<TabItem value="react" label="React Native and React web">

```ts
// Top level of your entry file. React Native headless JS tasks and background
// wakes load the whole bundle, so this runs off-hours too.
Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otel.example.com',
  enabled: isWithinShiftWindow(),
});

// When the window opens or closes
await Scout.setEnabled(true);  // resolves once the new session has started
await Scout.setEnabled(false); // resolves once the flush has finished
Scout.enabled; // current state
```

The `useScout()` hook exposes `setEnabled` and `enabled` as well.

</TabItem>
</Tabs>

## While RUM is off

- **Nothing leaves the device.** No spans, logs, metrics, errors, crashes, or
  ANRs, and no request to the collector at all. `alwaysCaptureErrors` does not
  apply.
- **Nothing is kept for later.** Telemetry produced while RUM is off is
  discarded. It is not queued or written to the offline buffer, and breadcrumbs
  are not recorded.
- **No session.** A launch with `enabled: false` does not create, resume, or
  extend a session, and sends no app start or lifecycle telemetry. `sessionId`
  is `null` on Android, Flutter, and React.
- **Identity still applies.** `setUser`, user attributes, and
  `setUserSampling` calls are kept and take effect once RUM is on.

## Turning it off and on

- **Off.** `setEnabled(false)` sends what was already recorded, then ends the
  session. A later launch never resumes that session. Spans still open at that
  moment are dropped.
- **On.** `setEnabled(true)` always starts a new session, sampled like any new
  session: the per-user value if you set one, otherwise `sessionSampleRate`.
  Startup metrics are not measured again for that process.
- Calling `setEnabled` with the current state does nothing.
- A `setEnabled` call made before `initialize` wins over the `enabled` config
  value.
- Nothing is persisted. Each launch uses the value your app passes.

## Crashes

A crash, ANR, native crash, or OS-recorded exit that happens while RUM is off
is never reported, not even after RUM is turned back on. A crash from an
earlier run where RUM was on is kept until the next time RUM is on, then
reported.

iOS MetricKit reports are the exception, because they cover a time window
rather than a moment. The native iOS SDK drops MetricKit reports delivered
while RUM is off. `@base-14/scout-react` drops a report whose 24-hour window
overlaps any time RUM was off, so an app that turns RUM off every day loses
most MetricKit crash reports.

## Hybrid apps, WebViews, and multiple processes

- **Native host embedding Flutter.** `ScoutFlutter` passes `enabled` to the
  native SDK and forwards `setEnabled`, so both layers go quiet together. On
  enable, Flutter follows the native SDK's new session. See
  [Hybrid (Native + Flutter)](./hybrid.md).
- **WebView pages** do not follow the host's switch yet. Call
  `Scout.setEnabled` in the page too.
- **Separate Android processes** each take `enabled` from their own config.

## Verify it

With debug logging on, each SDK logs its initial state and every change, in
lines starting with `SCOUTDBG enabled=` (Android and iOS) or `[scout] enabled`
(Flutter and React). While RUM is off, your collector receives no requests from
the app, and no new sessions appear in
[RUM Sessions](../../operate/rum/sessions.md).

## FAQ

### Does turning RUM off stop error and crash reports too?

Turning RUM off stops everything, errors and crashes included, whatever
`alwaysCaptureErrors` says. To keep error reports while dropping the rest of a
user's telemetry, use [Per-user Sampling](./user-sampling.md) instead.

### Why does a WorkManager or background wake count as a session?

The wake starts your app process, which runs `Application.onCreate` or your
entry file, which calls `initialize`. Pass `enabled: false` there when RUM
should be off, and the wake sends nothing and counts no session.

### Does the SDK remember `enabled` between launches?

The SDK does not persist `enabled`. Your app decides on every launch by passing
it at initialization, usually from a schedule it has cached locally.

### What happens to a session when I turn RUM back on?

Turning RUM back on always starts a new session. The session that ended when
RUM was turned off is never resumed.

## Related Guides

- [Android](./android.md), [iOS](./ios.md),
  [Kotlin Multiplatform](./kotlin-multiplatform.md), [Flutter](./flutter.md),
  and [React Native and React web](./react-native.md) - SDK setup
- [Per-user Sampling](./user-sampling.md) - Choose which users Scout records
- [Hybrid (Native + Flutter)](./hybrid.md) - One session across native and
  Flutter
- [RUM Sessions](../../operate/rum/sessions.md) - Session attributes and the
  session timeline
