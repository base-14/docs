---
title: RUM Errors
sidebar_label: Errors
sidebar_position: 4
description:
  Track non-fatal errors in your Flutter apps with RUM in base14 Scout. Group
  and rank JS and Dart errors by occurrence to prioritize fixes.
keywords:
  [
    rum,
    errors,
    non-fatal errors,
    dart errors,
    js errors,
    mobile errors,
    base14,
    scout,
  ]
---

The **Errors** tab surfaces non-fatal JS/Dart errors reported by the app,
grouped and ranked by occurrence so you can prioritize the errors affecting the
most users.

![Errors](/img/rum/errors.png)

Each error group shows its message, occurrence count, and the sessions and users
affected. Use it alongside [Crashes](./crashes.md) to separate fatal crashes
from recoverable errors.

---

## Error Details

Click an error group to open the detail view. The header shows the exception
message along with badges such as the error kind (for example `manual_error`)
and whether it was `handled`.

![Error Details](/img/rum/error-details.png)

- **Total Occurrences**, **Affected Users**, and **Affected Sessions** stats
- **Attributes** panel with rich context — device, OS, network, process and
  runtime details, plus custom attributes like feature flags and experiments
- Occurrences broken down **by App Version**, **by OS Version**, and
  **by Device Model**
- **Stack Trace** with numbered frames pointing to the source location
- **Breadcrumbs** — the events (screen views, taps, long tasks, UI hangs)
  leading up to the error
- **Affected Devices** and **Affected Users** tables

Use **View Session Timeline** to open the full [session](./sessions.md) where
the error was thrown.
