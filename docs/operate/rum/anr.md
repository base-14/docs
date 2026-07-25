---
title: RUM ANR
sidebar_label: ANR
sidebar_position: 5
description:
  Detect Application Not Responding (ANR) events in your Flutter apps with RUM
  in base14 Scout. Group frozen-UI events by screen and analyze thread state
  to find what blocked the main thread.
keywords:
  [
    rum,
    anr,
    application not responding,
    frozen ui,
    mobile performance,
    jank,
    base14,
    scout,
  ]
---

The **ANR** (Application Not Responding) tab tracks frozen-UI events - periods
where the app's main thread was blocked and unresponsive to user input -
grouped by the screen where they occurred.

![ANR list grouped by screen with Occurrences, Sessions, Users, App Version, and Last Seen columns](/img/rum/anr/list.png)

---

## ANR List

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Screen** | The screen the ANR occurred on (or `unknown` if it couldn't be attributed to a screen) |
| **Occurrences** | Total times an ANR was recorded for this screen |
| **Sessions** | Number of distinct sessions affected |
| **Users** | Number of distinct users affected |
| **App Version** | Version most recently associated with this screen's ANRs |
| **Last Seen** | When an ANR was last observed on this screen |

The **Errors** filter category (`error.message`, `crash.kind`, `crash.type`,
`crash.last_screen`) is available here too, alongside the shared
[Filters](./getting-started.md#filters) sidebar.

---

## ANR Details

Click a screen's ANR group to open the detail view, scoped to a specific
occurrence.

### Summary Stats

![ANR title, badges, and Total Occurrences/Affected Users/Affected Sessions stat cards](/img/rum/anr/summary-stats.png)

**Total Occurrences**, **Affected Users**, and **Affected Sessions** for the
selected screen and time range.

### Occurrence Breakdown

![Occurrences by App Version, OS Version, and Device Model charts](/img/rum/anr/occurrence-breakdown.png)

Here - unlike the list page - occurrences are broken down **by App
Version**, **by OS Version**, and **by Device Model**, each with the usual
multi-line-chart-plus-table pattern. This is where you find out which builds
and devices freeze most often for this screen.

### Attributes

![Attributes panel showing app.*, device.*, session.*, and other grouped attributes](/img/rum/anr/attributes.png)

A grouped attribute panel:

| Group | Example attributes |
| ----- | ------------------- |
| `app.*` | `app.build`, `app.bundle_id`, `app.version` |
| `crash.*` | `crash.type` (`anr`) |
| `device.*` | `device.brand`, `device.manufacturer`, `device.model.name`, `device.locale`, `device.orientation`, `device.type` |
| `error.*` | `error.message` (for example "Application Not Responding") |
| `os.*` | `os.name`, `os.version`, `os.build` |
| `screen.*` | `screen.name` |
| `service.*` | `service.name`, `service.version` |
| `session.*` | `session.id`, `session.sample_rate`, `session.start_time`, `session.type` |
| `telemetry.sdk.*` | `telemetry.sdk.name`, `telemetry.sdk.language`, `telemetry.sdk.version` |
| `user.*` | `user.anonymous_id` |

### Stack Trace (Main Thread) and All Threads

![Stack Trace (Main Thread) frames and All Threads list with state badges and frame counts](/img/rum/anr/stack-trace.png)

The **Stack Trace (Main Thread)** panel shows where the main thread was
blocked. Below it, **All Threads** lists every thread with its state
(`RUNNABLE`, `TIMED_WAITING`, `WAITING`) and frame count - expand a thread to
see its own stack. This is how you find which thread was holding the lock
the main thread was waiting on.

As with [crash stack traces](./crashes.md#stack-trace-and-translated-report),
frames resolve to readable file, line, and symbol names once the matching
debug artifacts for that build have been uploaded.

### Breadcrumbs

![Breadcrumbs table with Time, Type, and Message columns](/img/rum/anr/breadcrumbs.png)

A chronological table (**Time**, **Type**, **Message**) of lifecycle,
navigation, and tap events leading up to the freeze.

### Affected Devices and Affected Users

![Affected Devices and Affected Users tables](/img/rum/anr/affected.png)

Same structure as [Crashes](./crashes.md#affected-devices-and-affected-users).

Use **View Session Timeline** to jump into the full
[session](./sessions.md) where the ANR occurred.

---

## Use Cases

### Finding the Worst Frozen Screen

1. Sort the **ANR List** by **Occurrences**
2. Open the top screen and check **Occurrences by App Version** to see if
   it's a regression in a specific release
3. Use **All Threads** to identify what was blocking the main thread (a
   `RUNNABLE` thread holding a lock the main thread is `WAITING` on is a
   common culprit)

### Confirming a Fix Reduced Freezes

1. Open the screen's ANR group
2. Filter to the version containing the fix
3. Confirm **Occurrences by App Version** drops for that version

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Overview](./overview.md) - ANR duration trend alongside crashes and sessions
- [Screens](./screens.md) - Per-screen performance, including jank and load time
- [Sessions](./sessions.md) - Full session timeline for a specific occurrence
- [traceX](../tracex/index.md) - Distributed tracing explorer
- [logX](../logx/index.md) - Log explorer with trace correlation
