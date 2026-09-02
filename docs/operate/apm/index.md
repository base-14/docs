---
title: APM
sidebar_label: Overview
sidebar_position: 1
description:
  Monitor application performance with APM in base14 Scout. Track request
  rates, errors, and latency across services, and drill down to traces.
keywords:
  [
    apm,
    application performance monitoring,
    opentelemetry,
    red metrics,
    latency,
    error rate,
    throughput,
    service map,
    base14,
    scout,
  ]
---

APM is the application performance monitoring app built into base14 Scout. It
gives you a service-level view of your systems from OpenTelemetry traces:
request rates, error rates, and latency percentiles for every service, a live
service dependency map, and drill-downs into transactions and errors.

APM reads pre-aggregated telemetry from the Scout Telemetry Data Lake, so
screens stay fast even over long time ranges, and it integrates with traceX so
you can jump from any aggregate view to the underlying traces.

![APM Services Overview](/img/apm/getting-started/apm-overview.png)

---

## Interface Overview

| Section | Description |
| ------- | ----------- |
| **Topbar** | Environment and service selectors, search, time range picker, refresh |
| **Tabs** | Services, Service Map, Traces, Errors, Infra |
| **Filter Sidebar** | Attribute-based filtering on screens that support it |
| **Charts** | Rate, error, and latency charts that follow your selections |
| **Tables** | Sortable, searchable detail tables with drill-through |

The tabs you see depend on what is enabled for your environment — for example,
the Errors and Infra tabs appear once the matching telemetry is flowing.

---

## Getting Started

### Select Environment and Time Range

1. Use the **ENV** selector to pick an environment, or leave it on **All**
2. Use the **SERVICE** selector to focus on a single service
3. Set the **Time Range** with the picker — all charts and tables follow it

Every selector is searchable: start typing to narrow long lists.

### Read the Services List

The Services tab is the home screen. Each row is one service with its request
rate, error rate, and latency percentiles for the selected window, plus
sparklines showing the trend.

From here you can:

- Click a service to open its **Service Detail** view
- Switch to the **Service Map** to see dependencies
- Use the search box to filter the list

### Drill to Traces

Most screens link into the **Traces** tab, which embeds traceX with your
current context — service, time range, and environment carry over, so the
traces you land on are the ones behind the numbers you were just looking at.

---

## Tabs at a Glance

| Tab | What it answers |
| --- | --------------- |
| [Services](./services) | Which services are healthy? Where is latency or error rate rising? |
| [Service Map](./service-map) | What calls what? Where do failures propagate? |
| [Traces](./traces) | What did individual requests actually do? |
| [Errors](./errors) | What exceptions are happening, how often, and where? |
| [Infra](./infra) | Are the hosts or nodes running my services healthy? |

---

## Time Ranges and Annotations

- Charts support **brush selection** — drag across a chart to zoom the whole
  app to that window
- Deployment and alert **annotations** can be overlaid on charts, so you can
  line up a latency change with the release or alert that caused it
- The **refresh** button re-runs every query on the current screen
