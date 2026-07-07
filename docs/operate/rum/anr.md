---
title: RUM ANR
sidebar_label: ANR
sidebar_position: 5
description:
  Detect Application Not Responding (ANR) events in your Flutter apps with RUM
  in base14 Scout. Analyze frozen-UI durations by app version, OS, and device.
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

The **ANR** (Application Not Responding) tab tracks frozen-UI events — periods
where the app's main thread was blocked and unresponsive to user input.

![ANR](/img/rum/anr.png)

ANR events include duration breakdowns **by App Version**, **by OS Version**,
and **by Device Model**, helping you pin down which builds and devices freeze
most often.

---

## ANR Details

Click an ANR group to open the detail view.

![ANR Details](/img/rum/anr-details.png)

- **Total Occurrences**, **Affected Users**, and **Affected Sessions** stats
- **Attributes** panel with device, OS, screen, session, and SDK context
- Occurrences broken down **by App Version**, **by OS Version**, and
  **by Device Model**
- **Stack Trace (Main Thread)** showing where the main thread was blocked
- **All Threads** dump listing every thread with its state
  (`RUNNABLE`, `TIMED_WAITING`, `WAITING`) and frame count — useful for finding
  which thread held the lock the main thread was waiting on
- **Breadcrumbs** — the sequence of lifecycle, navigation, and tap events
  leading up to the freeze
- **Affected Devices** and **Affected Users** tables

Use **View Session Timeline** to jump into the full
[session](./sessions.md) where the ANR occurred.
