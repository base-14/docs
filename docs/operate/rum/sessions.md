---
title: RUM Sessions
sidebar_label: Sessions
sidebar_position: 6
description:
  Inspect individual user sessions with RUM in base14 Scout. Review session
  and device details, and a chronological event timeline of screen views,
  taps, network calls, errors, and crashes.
keywords:
  [
    rum,
    sessions,
    session timeline,
    event timeline,
    mobile sessions,
    user interaction,
    base14,
    scout,
  ]
---

The **Sessions** tab lists individual user sessions so you can go from an
aggregate stat straight to the exact session that produced it.

![Sessions List](/img/rum/sessions/list.png)

---

## Session List

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Session ID** | Unique identifier for the session |
| **User** | The user's identifier |
| **Started At** | When the session began |
| **Duration** | How long the session lasted |
| **Screens** | Number of distinct screens viewed |
| **Errors** | Non-fatal errors during the session |
| **Crashes** | Crashes during the session |
| **Device** | Device model the session ran on |

Sessions with one or more crashes are highlighted in the table so you can
spot them while scanning. Sort by **Duration** or **Errors** to find outliers
worth a closer look.

The shared [Filters](./getting-started.md#filters) sidebar applies here too,
plus `user.anonymous_id` under the User category.

---

## Session Timeline

Click a session to open its timeline: a chronological view of everything
that happened during that session.

### Session Attributes and Resource Attributes

Two separate attribute panels:

![Session Attributes panel with session.id, app_lifecycle.*, device, and user identifiers](/img/rum/sessions/session-attributes.png)

- **Session Attributes** - `session.id`, `session.sample_rate`,
  `session.sampled`, `session.start_time`, `session.type`,
  `app_lifecycle.id`, `app_lifecycle.state`, `app_lifecycle.timestamp`,
  device and OS identifiers, and (when the user is identified) `user.id`,
  `user.email`, `user.name`, `user.phone`, `user.plan`, `user.tenant`,
  `user.anonymous_id`

`session.sample_rate` is the app's configured sampling percentage (the SDK
defaults to 1%); `session.sampled` shows whether this particular session was
kept. Crash, error, and ANR sessions are typically kept regardless of the
sample rate, so a low rate doesn't mean those sessions are missing - see
[Sessions](../../instrument/mobile/flutter.md#sessions) in the
instrumentation guide.

![Resource Attributes (mobile) panel with app.*, device.*, os.*, and telemetry.sdk.* attributes](/img/rum/sessions/resource-attributes.png)

- **Resource Attributes (mobile)** - the static resource context attached to
  every event in the session: `app.build`, `app.bundle_id`, `app.version`,
  `device.battery.level`, `device.battery.state`, `device.is_physical`,
  `device.locale`, `device.model.name`, `device.type`, `host.arch`,
  `network.connection.type`, `os.build`, `os.name`, `os.version`,
  `service.name`, `service.version`, `telemetry.sdk.language`,
  `telemetry.sdk.name`, `telemetry.sdk.version`

### Summary Stats

![Duration, Screens, Errors, and Crashes stat cards](/img/rum/sessions/summary-stats.png)

**Duration**, **Screens**, **Errors**, and **Crashes** for the session,
matching the columns in the Session List.

### Event Timeline

![Event Timeline table with filter chips and Time/Event/Details/Status columns](/img/rum/sessions/event-timeline.png)

A chronological table (**Time**, **Event**, **Details**, **Status**) of every
event captured during the session, including:

| Event type | What it represents |
| ---------- | ------------------- |
| `screen_view` / `screen_load` | A screen was shown / finished loading, with load duration |
| `user_interaction` | A tap or gesture, with the widget name in Details (for example "Back (ElevatedButton)") |
| `http.request` | An API call, with method, URL, status code, and duration |
| `view_session` | Time spent on a screen - an "entered" marker when the user arrives, paired with a duration when they leave |
| `app_startup` | App start, tagged cold or warm, with startup duration |
| `long_task` | A long-running task on the UI thread (potential jank) |
| `app_lifecycle.changed` | App lifecycle transitions (backgrounded, resumed) |
| `app_crash` | A crash occurred during the session |

Failed requests and errors are highlighted in the **Status** column so they
stand out in a long timeline. Use the event-type filter chips above the
timeline (with per-type counts) to toggle categories on or off and cut a
noisy session down to just, say, `http.request` and `app_crash` events.

---

## Use Cases

### Reproducing a Bug Report

1. Find the user's session (filter by `user.id` if known, or search by
   session ID from a support ticket)
2. Open the timeline and filter down to `screen_view` and `user_interaction`
   events
3. Walk through the sequence leading up to the reported issue

### Investigating a Slow Session

1. Sort the **Session List** by **Duration**
2. Open the timeline and filter to `http.request` and `long_task` events
3. Look for slow requests or repeated long tasks clustered together

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Overview](./overview.md) - Session volume trend
- [Crashes](./crashes.md) - Crash groups, with a link back into the session
- [Users](./users.md) - Per-user session history
