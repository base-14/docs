---
title: RUM Screens
sidebar_label: Screens
sidebar_position: 7
description:
  Measure per-screen performance in your Flutter apps with RUM in base14
  Scout. Track load times, frame rendering, memory and CPU usage, jank, and
  crashes by screen.
keywords:
  [
    rum,
    screens,
    screen performance,
    load time,
    frame rendering,
    jank,
    memory usage,
    mobile performance,
    base14,
    scout,
  ]
---

The **Screens** tab measures per-screen performance across your app, so you
can find the slowest or jankiest screens without knowing what to look for
up front.

![Screen Performance](/img/rum/screens/list.png)

---

## Screen List

Four stat tiles summarize the whole app before the table: **Total Screens**,
**Slowest Screen** (with its avg load time), **Most Janky** (with its long
task count), and **Most Crashing** (with its crash count).

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Screen** | The screen's route/name |
| **Views** | Number of times the screen was viewed |
| **Unique Sessions** | Distinct sessions that viewed it (links to a filtered session list) |
| **Avg Load** | Average load time |
| **P95 Load** | 95th-percentile load time |
| **Avg Time Spent** | Average time users spent on the screen |
| **Long Tasks** | Count of long-running UI-thread tasks (jank) |
| **Crashes** | Crashes that occurred on this screen |

Sort by **Avg Load** or **Long Tasks** to find the screens most in need of
optimization.

---

## Screen Details

Select a screen to see its full performance breakdown.

### Summary Stats

![Views, Unique Sessions, Avg Load Time, P95 Load Time, Long Tasks, and Crashes stat cards](/img/rum/screens/summary-stats.png)

**Views**, **Unique Sessions**, **Avg Load Time**, **P95 Load Time**,
**Long Tasks**, and **Crashes** for the selected screen and time range.

### Load Time Trend and Views Over Time

![Load Time Trend chart and Views Over Time chart](/img/rum/screens/load-time-views.png)

- **Load Time Trend** - Avg and p95 load time over the range, with a
  Name / Min / Mean / Max table
- **Views Over Time** - view volume over the range

### Rendering and Resource Usage

![Frame Build Time and Frame Raster Time charts](/img/rum/screens/frame-timing.png)

- **Frame Build Time** and **Frame Raster Time** - how long each frame took
  to build (widget/layout work) versus rasterize (GPU work); sustained spikes
  in either indicate jank

![Memory Usage and CPU Usage charts](/img/rum/screens/resource-usage.png)

- **Memory Usage** - resident memory over time
- **CPU Usage** - CPU utilization over time

### Slowest Loads and Long Tasks

![Slowest Loads and Long Tasks (Jank Events) tables](/img/rum/screens/slowest-loads-long-tasks.png)

- **Slowest Loads** - table of individual slow page loads (**Time**,
  **Load Time**, **User**, **Session**)
- **Long Tasks (Jank Events)** - table of individual long tasks (**Time**,
  **Duration**, **User**, **Session**)

Both tables link straight to the **User** and **Session** involved, and
support **Load more** to page through additional rows.

### Crashes on this Screen

![Crashes on this Screen table with Time, Error Type, Message, and Session columns](/img/rum/screens/crashes-on-screen.png)

A table of crashes attributed to this screen (**Time**, **Error Type**,
**Message**, **Session**), or "No crashes on this screen" when there are
none in range.

---

## Use Cases

### Finding the Slowest Screen

1. Check the **Slowest Screen** stat tile, or sort the **Screen List** by
   **Avg Load**
2. Open the screen and check **Load Time Trend** for a gradual regression vs.
   a one-time spike
3. Cross-check **Slowest Loads** for the specific sessions affected

### Diagnosing Jank on a Screen

1. Check the **Most Janky** stat tile, or sort by **Long Tasks**
2. Open the screen and compare **Frame Build Time** vs. **Frame Raster Time**
   to narrow down whether it's widget/layout work or GPU work
3. Check **Long Tasks (Jank Events)** for the specific sessions and times

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Overview](./overview.md) - Top Crashing Screens and Slowest Screens at a glance
- [ANR](./anr.md) - Frozen-UI events grouped by screen
- [Sessions](./sessions.md) - Full session timeline for a specific view
