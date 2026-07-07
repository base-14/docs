---
title: Getting Started with RUM
sidebar_label: Getting Started
sidebar_position: 1
description:
  Get started with RUM in base14 Scout. Learn the interface, select a mobile
  application, and set a time range to monitor real user experience for your
  Flutter apps.
keywords:
  [
    rum,
    real user monitoring,
    mobile monitoring,
    flutter monitoring,
    getting started,
    base14,
    scout,
  ]
---

RUM (Real User Monitoring) is a mobile monitoring Grafana app built into Scout.
It gives you deep visibility into how real users experience your Flutter
applications — tracking crashes, errors, ANRs, app startup, screen performance,
network calls, and full session timelines.

RUM queries mobile telemetry stored in the Scout Telemetry Data Lake and
correlates crashes, sessions, and screens so you can move from a symptom
(a crash spike) to a root cause (a specific screen, app version, or device) in
a few clicks.

![RUM Overview](/img/rum/overview.png)

---

## Interface Overview

The RUM interface consists of:

| Section | Description |
| ------- | ----------- |
| **Application Selector** | Choose which mobile application to inspect |
| **Navigation Tabs** | Switch between Overview, Errors, Crashes, ANR, Sessions, Screens, Network, and Users |
| **Time Picker** | Set the time range for all panels |
| **Breakdown Filters** | Slice metrics by app version, OS version, and device model |

---

## Select an Application

The **Applications** tab lists every mobile app reporting telemetry to Scout.

1. Open the **Applications** tab
2. Select the application you want to monitor
3. RUM loads that app's data across all other tabs

![Applications](/img/rum/applications.png)

---

## Set the Time Range

Use the time picker to scope every panel to a time window. All charts, tables,
and breakdowns update to the selected range.

---

## Next Steps

- [Overview](./overview.md) - Health-at-a-glance dashboard
- [Crashes](./crashes.md) - Crash groups and symbolicated stack traces
- [Sessions](./sessions.md) - Session list and event timelines
- [Screens](./screens.md) - Per-screen performance
