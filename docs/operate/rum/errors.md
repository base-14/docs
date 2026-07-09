---
title: RUM Errors
sidebar_label: Errors
sidebar_position: 4
description:
  Track non-fatal errors in your Flutter apps with RUM in base14 Scout. Group
  and rank errors by occurrence, inspect stack traces and breadcrumbs, and
  prioritize fixes.
keywords:
  [
    rum,
    errors,
    non-fatal errors,
    dart errors,
    flutter errors,
    mobile errors,
    base14,
    scout,
  ]
---

The **Errors** tab surfaces non-fatal errors reported by the app, grouped and
ranked by occurrence so you can prioritize the errors affecting the most
users. Use it alongside [Crashes](./crashes.md) to separate fatal crashes from
recoverable errors.

![Errors](/img/rum/errors/list.png)

---

## Error List

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Title** | The error's grouping title (exception message or a custom label) |
| **Kind** | High-level classification badge for the error |
| **Type** | More specific classification, for example `flutter_error` (framework-level, such as widget build/layout errors), `uncaught_error` (unhandled Dart exceptions), or `manual_error` (explicitly reported via the SDK) |
| **Occurrences** | Total times this error group has been seen |
| **Sessions** | Number of distinct sessions affected |
| **Users** | Number of distinct users affected |
| **App Version** | Version most recently associated with the group |
| **Last Seen** | When the error group was last observed |

The **Errors** filter category adds `error.message`, `crash.kind`,
`crash.type`, and `crash.last_screen` to the shared
[Filters](./getting-started.md#filters) sidebar.

---

## Error Details

Click an error group to open the detail view. The header shows the exception
message along with badges for its **Type** and whether it was
**`error.handled`**.

### Summary Stats

![Error title, Type/handled badges, and Total Occurrences/Affected Users/Affected Sessions stat cards](/img/rum/errors/summary-stats.png)

**Total Occurrences**, **Affected Users**, and **Affected Sessions** for the
selected error group and time range.

### Occurrence Breakdown

![Occurrences by App Version, OS Version, and Device Model charts](/img/rum/errors/occurrence-breakdown.png)

**Occurrences by App Version**, **by OS Version**, and **by Device Model** -
the same multi-line-chart-plus-table pattern used throughout RUM, so you can
see which versions or devices hit this error most.

### Attributes

![Attributes panel showing app.*, device.*, error.*, and other grouped attributes](/img/rum/errors/attributes.png)

A grouped attribute panel, similar to [Crashes](./crashes.md#attributes):

| Group | Example attributes |
| ----- | ------------------- |
| `error.*` | `error.message`, `error.type`, `error.handled`, `error.source`, `error.source_type`, `error.fingerprint` |
| `app.*` | `app.build`, `app.bundle_id`, `app.launch_id`, `app.version`, `build.channel` |
| `device.*` | `device.model.name`, `device.locale`, `device.timezone`, `device.is_physical`, `device.is_jail_broken` |
| `os.*` | `os.name`, `os.version`, `os.build` |
| `process.*` | `process.runtime.name`, `process.runtime.version`, `process.num_threads` |
| `session.*` | `session.id`, `session.type`, `session.start_time` |
| `user.*` | `user.id`, `user.anonymous_id` (only present once the app identifies the user) |
| custom | feature flags and experiment attributes your app attaches, for example `feature_flag.v2_checkout`, `experiment.recommendation_model` |

`error.source_type` shows the layer that reported the error (for example
`flutter` for framework-level errors, `custom` for manually-reported ones).

### Stack Trace

![Numbered stack trace frames with package paths](/img/rum/errors/stack-trace.png)

Numbered frames pointing to the exact source location, including package
paths - useful for tracing framework-level errors (`flutter_error`) back to
the widget or gesture handler that triggered them.

If the app is built with `flutter build --split-debug-info`, frames need the
matching Dart symbols/obfuscation map uploaded to resolve past raw addresses -
see [scout artifacts upload](../../scout-cli/scout-access/artifacts.md).

### Breadcrumbs

![Breadcrumbs table with Time, Type, and Message columns](/img/rum/errors/breadcrumbs.png)

A chronological table (**Time**, **Type**, **Message**) of what happened
before the error: session start, navigation, taps, long tasks, and UI hangs.

### Affected Devices and Affected Users

![Affected Devices and Affected Users tables](/img/rum/errors/affected.png)

Same structure as [Crashes](./crashes.md#affected-devices-and-affected-users):
device/OS/app-version breakdown and per-user occurrence counts.

Use **View Session Timeline** to open the full [session](./sessions.md) where
the error was thrown.

---

## Use Cases

### Prioritizing Non-Fatal Fixes

1. Sort the **Error List** by **Occurrences**
2. Check **Sessions**/**Users** to weigh reach vs. raw count
3. Open the top group and use **Stack Trace** + **Breadcrumbs** to reproduce it

### Separating Framework Bugs from App Bugs

1. Filter by **Type** = `flutter_error` to isolate framework-level issues
   (layout overflows, `setState` misuse) versus `uncaught_error`
   (application-level exceptions)
2. Triage each category with a different owner if useful

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Crashes](./crashes.md) - Fatal crashes and symbolicated stack traces
- [Sessions](./sessions.md) - Full session timeline for a specific occurrence
- [traceX](../tracex/index.md) - Distributed tracing explorer
- [logX](../logx/index.md) - Log explorer with trace correlation
