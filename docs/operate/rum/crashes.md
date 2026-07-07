---
title: RUM Crashes
sidebar_label: Crashes
sidebar_position: 3
description:
  Investigate mobile app crashes with RUM in base14 Scout. Group crashes,
  view symbolicated stack traces, and see affected devices, users, app
  versions, and OS versions.
keywords:
  [
    rum,
    crashes,
    crash reporting,
    symbolication,
    stack trace,
    native crash,
    mobile crash,
    base14,
    scout,
  ]
---

The **Crashes** tab groups individual crash events into deduplicated crash
groups so you can prioritize by impact.

![Crashes List](/img/rum/crashes.png)

Each crash group shows its **Title**, **Kind**, **Type** (Native or JS Error),
**Occurrences**, affected **Sessions** and **Users**, **App Version**, and
**Last Seen**.

---

## Crash Details

Click a crash group to open the detail view with:

- **Symbolicated stack trace** (Java / Android), memory map, and raw tombstone
- Occurrences broken down **by App Version**, **by OS Version**, and
  **by Device Model**
- **Affected Devices** (brand, model, OS, app version, count)
- **Affected Users** (user, crash count, last hit)

![Crash Details](/img/rum/crash-details.png)
