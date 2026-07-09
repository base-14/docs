---
title: RUM Overview
sidebar_label: Overview
sidebar_position: 2
description:
  Monitor mobile app health at a glance with the RUM Overview dashboard in
  base14 Scout. Track crash-free rate, sessions, active users, startup times,
  and trends by app version, OS, and device.
keywords:
  [
    rum,
    overview,
    crash-free rate,
    mobile health,
    app startup,
    cold start,
    warm start,
    base14,
    scout,
  ]
---

The **Overview** tab is your health-at-a-glance dashboard for the selected
mobile application, combining top-line stats, trend charts, breakdowns by
app version/OS/device, and the screens most worth investigating.

---

## Key Metrics

![Crash-Free Sessions, Total Sessions, Active Users, Avg Cold Start, Avg Warm Start, and Total Errors stat cards](/img/rum/overview/key-metrics.png)

| Metric | Description |
| ------ | ----------- |
| **Crash-Free Sessions** | Percentage of sessions with no crashes |
| **Total Sessions** | Number of user sessions in the range |
| **Active Users** | Distinct users in the range |
| **Avg Cold Start** | Average cold app-startup time, with a trend sparkline |
| **Avg Warm Start** | Average warm app-startup time, with a trend sparkline |
| **Total Errors** | Count of reported non-fatal errors |

Use the shared [Filters](./getting-started.md#filters) sidebar (Device, App,
Session, Network) to scope every metric below to a specific slice of traffic.

**Total Sessions** reflects the app's configured session sample rate (the SDK
defaults to sampling 1% of sessions). **Crash-Free Sessions** and
**Total Errors** aren't affected by that sampling - crash, error, and ANR
telemetry bypasses the session sample rate by default, so those counts stay
accurate even at a low sample rate. See
[Sessions](../../instrument/mobile/flutter.md#sessions) in the instrumentation
guide for how sampling is configured.

---

## Trends Over Time

Three daily time-series charts sit right under the Key Metrics row:

![Sessions Over Time, Crashes Over Time, and ANR Duration Over Time charts](/img/rum/overview/trends.png)

### Sessions Over Time

Session volume per day. Use it to spot release-day spikes or a sudden drop in
traffic that might indicate an app outage or a broken build.

### Crashes Over Time

Crash volume per day. A spike here that lines up with a Sessions spike
usually means a release just went out; check [Crashes](./crashes.md) for
which crash groups are driving it.

### ANR Duration Over Time

Frozen-UI (ANR) duration per day. Sustained increases point at a regression
in a specific screen or build; cross-check against
[ANR](./anr.md) for the affected screens.

---

## Detailed Breakdown

Expand **Detailed Breakdown** to slice Crashes, Sessions, and ANR Duration
each three ways: by App Version, by OS Version, and by Device Model. Every
chart pairs a multi-line time series with a table of Name / Min / Mean / Max,
so you can see both the trend and the worst-case value per version, OS, or
device at a glance:

- **Crashes by App Version / by OS Version / by Device Model**

  ![Crashes broken down by App Version, OS Version, and Device Model](/img/rum/overview/breakdown-crashes.png)

- **Sessions by App Version / by OS Version / by Device Model**

  ![Sessions broken down by App Version, OS Version, and Device Model](/img/rum/overview/breakdown-sessions.png)

- **ANR Duration by App Version / by OS Version / by Device Model**

  ![ANR Duration broken down by App Version, OS Version, and Device Model](/img/rum/overview/breakdown-anr.png)

This is the fastest way to answer "did the new release make things worse?" -
compare the latest app version's line against previous versions in the same
chart.

---

## Top Screens

Two tables at the bottom of the Overview surface the screens most worth
attention:

![Top Crashing Screens and Slowest Screens tables](/img/rum/overview/top-screens.png)

### Top Crashing Screens

Columns: **Screen**, **Crashes**, **Last Seen**. Ranked by crash count over
the selected range.

### Slowest Screens

Columns: **Screen**, **Avg Load**, **Views**. Ranked by average load time.

Click through to [Screens](./screens.md) for the full per-screen breakdown,
including frame timing and jank.

---

## Use Cases

### Morning Health Check

1. Check **Crash-Free Sessions** and **Total Errors** against their usual
   range
2. Scan **Sessions Over Time** and **Crashes Over Time** for overnight
   anomalies
3. Glance at **Top Crashing Screens** for anything new

### Post-Release Monitoring

1. Filter by the new **App Version** in the Filters sidebar
2. Compare its line in the **Crashes by App Version** and
   **ANR Duration by App Version** breakdowns against the previous version
3. If crashes or ANR duration are elevated, jump to
   [Crashes](./crashes.md) or [ANR](./anr.md) to find the specific cause

### Investigating a Spike

1. Find the spike in **Crashes Over Time** or **ANR Duration Over Time**
2. Narrow the time picker to that window
3. Check **Top Crashing Screens** for the screen driving it, then open
   [Crashes](./crashes.md) or [Screens](./screens.md) for details

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Crashes](./crashes.md) - Crash groups and symbolicated stack traces
- [Sessions](./sessions.md) - Session list and event timelines
- [Users](./users.md) - Per-user activity and history
