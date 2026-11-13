---
title: Per-user Sampling - decide which users Scout RUM records
sidebar_label: Per-user Sampling
sidebar_position: 28
description:
  Decide per user, from your own remote config or feature flags, whether Scout
  RUM records their sessions. Works across Android, iOS, Kotlin Multiplatform,
  Flutter, React Native, and React web.
keywords:
  [
    rum sampling,
    per user sampling,
    user based sampling,
    session sampling,
    remote config sampling,
    setUserSampling,
    userSampling,
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

# Per-user Sampling

By default every Scout RUM SDK samples each session independently at
`sessionSampleRate`, so one user ends up with some sessions recorded and
others dropped. Per-user sampling lets your app make that decision for each
user instead, typically from its own remote config or feature-flag service:
pass `true` to record all of a user's sessions, `false` to stop recording
them, or `null` to keep the default per-session roll.

:::note Running this in production

Storing and querying these sessions at production volume is what base14 Scout
does. [Check out Scout RUM](https://base14.io/scout/rum).

:::

## Requirements

| SDK | Minimum version |
| --- | --- |
| Android | `io.base14:scout-android:0.1.12` |
| iOS | `ios-0.1.12` (Swift Package) |
| Kotlin Multiplatform | `io.base14:scout-kmp:0.1.14` |
| Flutter | `scout_flutter` `0.4.0` |
| React Native and React web | `@base-14/scout-react` `0.1.22` |

## What each value does

| Value | Spans | Logs and metrics | Errors, crashes, ANRs |
| --- | --- | --- | --- |
| `true` | Sent for every session | Sent | Sent |
| `false` | Dropped | Still sent | Still sent while `alwaysCaptureErrors` is on (the default) |
| `null` (default) | Decided by `sessionSampleRate`, as before | Follow `sessionSampleRate` | Follow `alwaysCaptureErrors` |

`false` is not a full kill switch. A user set to `false` stops producing
screen views, network calls, interactions, and other spans, but their logs,
metrics, and error-class spans keep arriving, so you can still debug a
failure for that user. Their logs carry `session.sampled=false`. To stop
all of RUM, use [Turning RUM Off at Runtime](./runtime-enable.md).

## When a value takes effect

The SDK reads the value once, when a session starts, and keeps that decision
for the whole session. A new value never changes the session in progress; it
applies at the next session start, which happens on:

- an inactivity timeout (`sessionTimeoutMinutes`, 30 by default)
- the maximum session length (`maxSessionDurationMinutes`, 60 by default)
- the next app launch, when the previous session has expired
- an account switch or logout (see [Account switches and logout](#account-switches-and-logout))

The latest value is persisted, so a launch that passes nothing at
initialization still honors it. A value passed at initialization replaces the
stored one, and a `null` passed at initialization means "no opinion" and keeps
the stored value.

## Set it up

The pattern is the same on every platform:

1. At initialization, pass the value you last fetched for the signed-in user.
   Remote config SDKs keep this cached locally, so it is available
   synchronously at startup.
2. On login, fetch the user's value, call `setUserSampling(value)`, and then
   call `setUser(id)`. Calling them in this order makes an account switch
   start the new user's session with the new user's value.
3. On logout, call `clearUser()`. It also clears the per-user value.

<Tabs groupId="platform">
<TabItem value="android" label="Android">

```kotlin
// Application.onCreate()
Scout.initialize(
  this,
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
    userSampling = remoteConfig.cachedRumEnabled(), // Boolean? (null = no opinion)
  ),
)

// After login
Scout.setUserSampling(remoteConfig.fetchRumEnabled(user.id))
Scout.setUser(user.id)

// On logout
Scout.clearUser()
```

</TabItem>
<TabItem value="ios" label="iOS">

```swift
// application(_:didFinishLaunchingWithOptions:)
Scout.start(
  serviceName: "my-app",
  endpoint: "https://otel.example.com",
  userSampling: remoteConfig.cachedRumEnabled() // Bool? (nil = no opinion)
)

// After login
Scout.setUserSampling(remoteConfig.fetchRumEnabled(userId: user.id))
Scout.setUser(id: user.id)

// On logout
Scout.clearUser()
```

`userSampling:` is the last parameter of `Scout.start(...)`.

</TabItem>
<TabItem value="kmp" label="Kotlin Multiplatform">

```kotlin
Scout.initialize(
  ScoutConfig(
    serviceName = "my-app",
    endpoint = "https://otel.example.com",
    userSampling = remoteConfig.cachedRumEnabled(),
  ),
)

// After login
Scout.setUserSampling(remoteConfig.fetchRumEnabled(user.id))
Scout.setUser(id = user.id)

// On logout
Scout.clearUser()
```

</TabItem>
<TabItem value="flutter" label="Flutter">

```dart
await ScoutFlutter.initialize(
  config: ScoutFlutterConfig(
    serviceName: 'my-app',
    endpoint: 'https://otel.example.com',
    userSampling: remoteConfig.cachedRumEnabled(), // bool? (null = no opinion)
  ),
);

// After login
ScoutFlutter.setUserSampling(await remoteConfig.fetchRumEnabled(user.id));
ScoutFlutter.setUser(id: user.id);

// On logout
ScoutFlutter.clearUser();
```

`ScoutFlutter.setUserSampling` is safe to call before `initialize`.
`ScoutFlutter.sessionSamplingDecision` returns the current session's decision
and its source (`user` or `fallback`).

</TabItem>
<TabItem value="react" label="React Native and React web">

```ts
await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otel.example.com',
  userSampling: remoteConfig.cachedRumEnabled(), // boolean | null
});

// After login
Scout.setUserSampling(await remoteConfig.fetchRumEnabled(user.id));
Scout.setUser(user.id);

// On logout
Scout.clearUser();
```

`Scout.setUserSampling` is safe to call before `initialize`, and the
`useScout()` hook exposes it as well.

</TabItem>
</Tabs>

## Account switches and logout

While per-user sampling is in use, an identity change starts a new session so
that one user never inherits another user's decision:

- `setUser` with an id different from the current one starts a new session.
- `clearUser()` clears the per-user value and starts a new session, which
  falls back to `sessionSampleRate`.
- Going from anonymous to the first `setUser` call keeps the current session,
  and so does calling `setUser` again with the same id.

Apps that never pass a per-user value see no extra sessions: identity changes
only start a new session when the current session was decided by a per-user
value, or a per-user value is pending.

## Hybrid apps and WebViews

- **Native host embedding Flutter.** The native SDK owns the session, so it
  makes the decision. `ScoutFlutter.setUserSampling`, `setUser`, and
  `clearUser` are forwarded to it, and the Flutter layer follows its decision.
  On Android, a Flutter screen in a separate process follows the main
  process's decision; set the value in the main process. See
  [Hybrid (Native + Flutter)](./hybrid.md).
- **WebView pages.** A page that adopts the host app's session in
  session-only mode also follows the host's decision, so a user set to `false`
  stops the page's spans too. The Flutter WebView bridge passes this
  automatically; other hosts pass `sampled` and `samplingSource` to
  `Scout.setWebViewBridge(...)`. Pages need `@base-14/scout-react` 0.1.22 or
  later; older pages ignore the fields.

## Verify it in Scout

Every span and log carries `session.sampling_source`:

- `user` means a per-user value decided the session.
- `fallback` means `sessionSampleRate` decided it.

Open a session in [RUM Sessions](../../operate/rum/sessions.md) and read
`session.sampling_source` next to `session.sampled`. For a user set to `false`,
expect `session.sampled=false` and `session.sampling_source=user`, error spans
and logs present, and no screen views or network calls.

## FAQ

### Does setting a user to `false` stop all of their telemetry?

Setting a user to `false` drops only their spans; logs, metrics, and
error-class spans (errors, crashes, ANRs, app hangs) keep flowing, so failures
stay visible. Set
`alwaysCaptureErrors` to `false` if you also want to drop their error spans.

### Why didn't a new value apply right away?

The decision is fixed for the life of a session, so a new value applies from
the next session start: after the inactivity timeout, the maximum session
length, the next launch, or an account switch or logout.

### What happens if my app never calls `setUserSampling`?

If your app never calls `setUserSampling`, every session is sampled at
`sessionSampleRate` as before, and identity changes do not start extra
sessions.

### Do users set to `false` still count in RUM dashboards?

They count in metric-based charts, such as web vitals and other histograms,
because their metrics are still sent. They do not appear in span-based views
such as sessions, screens, and network calls.

## Related Guides

- [Android](./android.md), [iOS](./ios.md),
  [Kotlin Multiplatform](./kotlin-multiplatform.md), [Flutter](./flutter.md),
  and [React Native and React web](./react-native.md) - SDK setup
- [Turning RUM Off at Runtime](./runtime-enable.md) - A kill switch for all
  telemetry
- [Hybrid (Native + Flutter)](./hybrid.md) - One session across native and
  Flutter
- [RUM Sessions](../../operate/rum/sessions.md) - Session attributes and the
  session timeline
