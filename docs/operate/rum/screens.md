---
title: RUM Screens
sidebar_label: Screens
sidebar_position: 7
description:
  Measure per-screen performance in your mobile and web apps with RUM in
  base14 Scout. Track load times, Core Web Vitals (LCP, INP, CLS), frame
  rendering, memory and CPU usage, jank, and crashes by screen.
keywords:
  [
    rum,
    screens,
    screen performance,
    load time,
    core web vitals,
    lcp,
    inp,
    cls,
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

## Load Time on Mobile vs. Web

What "load time" means depends on the platform, and the tab adapts to the app
you have selected:

| | Mobile (Flutter, iOS, Android) | Web |
| --- | --- | --- |
| **Headline load metric** | **Load Time**: time to render the screen after navigation | **LCP** (Largest Contentful Paint), p75 |
| **Secondary timing** | — | **Route Transition**: time from a client-side route change to the next rendered frames |
| **Core Web Vitals row** | Only when the app relays vitals from embedded WebViews | Always |

On the web, **Route Transition** is not a page-load measurement. It's a few
milliseconds for most navigations. It can also stretch to hours when a tab is
left in the background, because the browser stops rendering hidden tabs. For
that reason it is reported as p50 / p95 rather than an average. LCP, which the
browser measures once per full page load, is the page-load number.

All load times are shown as percentiles (p50 / p95 for load time and route
transition, p75 for Core Web Vitals) so that a handful of extreme outliers
cannot dominate them.

![Total Screens, Slowest Screen, Most Janky, and Most Crashing stat cards above a table with Screen, Views, Unique Sessions, Load Time p50, Load Time p95, Avg Time Spent, Long Tasks, and Crashes columns](/img/rum/screens/list.png)

---

## Screen List

Four stat tiles summarize the whole app before the table: **Total Screens**,
**Slowest Screen**, **Most Janky** (with its long task count), and **Most
Crashing** (with its crash count). **Slowest Screen** is ranked by p75 LCP on
web apps and by p95 load time on mobile apps.

### Core Web Vitals

On web apps, and on mobile apps that embed WebViews, a row of three tiles
sits above the table: **LCP**, **INP** (Interaction to Next Paint), and
**CLS** (Cumulative Layout Shift). Each shows the p75 value, colored against
the standard thresholds:

| Vital | Good | Needs improvement | Poor |
| --- | --- | --- | --- |
| LCP | ≤ 2.5 s | ≤ 4 s | > 4 s |
| INP | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

Under each value, a bar shows the share of measurements the browser itself
rated good, needs improvement, or poor.

### Table Columns

| Column | Description |
| ------ | ----------- |
| **Screen** | The screen's route/name |
| **Views** | Number of times the screen was viewed |
| **Unique Sessions** | Distinct sessions that viewed it (links to a filtered session list) |
| **LCP p75** / **INP p75** / **CLS p75** | Core Web Vitals for the screen (web apps and WebView-embedding apps only) |
| **Load Time p50** / **p95** | Median and 95th-percentile load time. Shown as **Route Transition p50** / **p95** on web apps |
| **Avg Time Spent** | Average time users spent on the screen |
| **Long Tasks** | Count of long-running UI-thread tasks (jank) |
| **Crashes** | Crashes that occurred on this screen |

Sort by **LCP p75** (web), **Load Time p95** (mobile), or **Long Tasks** to
find the screens most in need of optimization.

---

## Screen Details

Select a screen to see its full performance breakdown.

### Summary Stats

![Views, Unique Sessions, Load Time p50, Load Time p95, Long Tasks, and Crashes stat cards](/img/rum/screens/summary-stats.png)

**Views**, **Unique Sessions**, **Load Time p50**, **Load Time p95**,
**Long Tasks**, and **Crashes** for the selected screen and time range. On a
web app the load tiles are labeled **Route Transition p50** / **p95**, and the
screen's own **Core Web Vitals** row (LCP / INP / CLS at p75) sits beneath
them.

### Load Time Trend and Views Over Time

![Load Time Trend chart and Views Over Time chart](/img/rum/screens/load-time-views.png)

- **Load Time Trend** (mobile) - p50 and p95 load time over the range, with
  a Name / Min / Mean / Max table
- **LCP Trend** (web) - p50 and p75 LCP over the range. The
  **Route Transition Trend** follows further down the page
- **Views Over Time** - view volume over the range

### Web Vitals

On web apps two further charts follow:

- **Web Vitals (p75)** - LCP, INP, FCP, and TTFB for the screen, one line
  each, in milliseconds
- **CLS (p75)** - layout shift on its own axis, since it is a unitless score

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

- **Slowest Loads** (mobile) - table of individual slow screen loads
  (**Time**, **Load Time**, **User**, **Session**)
- **Slowest LCP** (web) - table of the slowest individual page loads by LCP,
  with the LCP broken into **Delay / Load / Render** (resource load delay,
  resource load time, render delay, in ms) and the **Element** resource that
  was the largest paint. A large delay points at the server or at
  late-discovered resources, a large load time at the resource itself, and a
  large render delay at blocking scripts or styles
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
   **LCP p75** (web) or **Load Time p95** (mobile)
2. Open the screen and check **LCP Trend** / **Load Time Trend** for a
   gradual regression vs. a one-time spike
3. Cross-check **Slowest LCP** / **Slowest Loads** for the specific sessions
   affected. On the web, the Delay / Load / Render split and the element URL
   show where the time went

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
