---
title: Getting Started with APM - Scope, Filters, and Trace Limits
sidebar_label: Getting Started
sidebar_position: 1
description:
  Navigate APM in base14 Scout. Select an environment and service, set a time
  range, filter a long result set, and read raw trace limits.
keywords:
  [
    apm,
    apm getting started,
    application performance monitoring,
    opentelemetry apm,
    service monitoring,
    environment selector,
    time range,
    filter sidebar,
    red metrics,
    span occurrences,
    raw trace retention,
    trace drill-down,
    distributed tracing,
    scout apm,
    base14,
    scout,
  ]
---

# Getting Started with APM

APM reads the OpenTelemetry traces and metrics your services already send to
Scout and turns them into service health views, dependency maps, grouped
errors, database and messaging analysis, and links to individual traces.

Every tab shares the same scope: an environment, an optional service, and a
time range. Set that scope once and it follows you through the tabs and into
traceX. This page covers the controls each tab shares.

---

## Before You Start

APM needs services that are already sending OpenTelemetry traces to Scout.
Start with:

- [Auto-instrumentation](../../instrument/apps/auto-instrumentation/index.md)
  to add OpenTelemetry to your framework
- [OTel Collector configuration](../../instrument/collector-setup/otel-collector-config.md)
  to route that telemetry to Scout

Service names in APM are the `service.name` resource attribute your
instrumentation reports. Environments come from the `environment` attribute.
If a service is missing from the Services tab, check those two attributes
first.

Most charts and lists read pre-aggregated data from the Scout Telemetry Data
Lake. APM reads raw spans only after you select a specific operation, error,
database call, or message. Broad investigations stay fast, and trace-level
detail is still one click away.

---

## Interface Overview

| Section | Description |
| ------- | ----------- |
| **Topbar** | Environment group, environment, service, page-specific selectors, search, time range, and refresh |
| **Tabs** | Services, Service Map, Traces, and the optional analysis tabs enabled for your deployment |
| **Filter sidebar** | Faceted filtering on Services, Errors, Database Operations, and Messaging Queues |
| **Charts** | Rate, error, latency, and resource charts that follow the current scope |
| **Tables** | Sortable lists with scrolling or pagination and contextual drill-downs |
| **Detail views** | Service and operation pages plus resizable issue, database, and messaging drawers |

The available tabs depend on your deployment and its telemetry. Errors,
Database Operations, Messaging Queues, and Infra stay hidden until their data
sources and rollups are ready.

---

## Select a Scope

1. If shown, choose the **Production** or **Staging** environment group.
2. Use **ENV** to select an environment, or leave it on **All**.
3. Use **SERVICE** to focus on one service when needed.
4. Set the time range. All time-aware charts and tables follow it.
5. Use the page search or filter sidebar to narrow a long result set.

Selections are reflected in the URL, so a scoped view can be shared as a link.
Detail navigation also works with the browser Back button.

---

## Set the Time Range

- The topbar time picker sets the range for every time-aware chart and table.
- Drag across a time-series chart to apply that interval to the whole app.
- Alert and custom annotations can be overlaid on supported charts and
  sparklines.
- Your administrator sets the maximum overall APM range.

Infra is the exception. It uses a fixed live window of 5, 10, or 15 minutes
instead of the time picker.

---

## Filters

The filter sidebar appears on Services, Errors, Database Operations, and
Messaging Queues. Each tab facets on the dimensions stored in its rollup.

- Select a value to add it to the scope.
- Select several values in a facet to include any of them.
- Use **Only** to replace that facet with one value.
- Use **Clear** to remove sidebar filters.
- Search within a facet when its value list is long.

Active filters also appear as chips above the page and are stored in the URL.

---

## Raw Trace Limits

Raw detail queries have their own limit, separate from the overall APM range.
They never read spans older than the distance your administrator configured,
even when an older historical range is selected.

- Detail views display the absolute raw interval they actually queried.
- Span occurrence search starts at the most recent part of the selected range.
  By default it searches one hour and, when empty, offers to search 30 minutes
  earlier. Administrators can change both window sizes.
- The limit affects occurrence lists in operation, error, database, and
  messaging details. It does not shorten charts backed by rollup tables.

---

## Table Navigation

APM tables use either a continuously loaded list or page controls, depending
on plugin settings. Column headings sort server-side data, and **Load more**
retrieves another batch where available.

---

## FAQ

### Why is my service missing from the APM Services tab?

A service appears in APM once it sends server spans carrying its
`service.name` and `environment` resource attributes within the selected time
range. Check that the service is instrumented, that the collector is routing
its traces to Scout, and that the environment selector is not scoped to a
different environment.

### Why does a chart show data when the occurrence list is empty?

Charts read pre-aggregated rollup tables, and occurrence lists read raw spans.
Raw spans have a shorter retention limit, so a range that still has rollup
data can fall entirely outside the raw window. The detail view states the
absolute interval it queried.

### What is the difference between APM and traceX?

APM aggregates spans into service, operation, error, database, and messaging
views so you can find the problem. traceX shows one request end to end. Every
APM drill-down hands its context to traceX, either as a filtered search or as
one exact trace.

### How far back can APM query?

Your administrator sets two limits: the maximum overall range for
rollup-backed charts, and a shorter raw trace limit for occurrence lists and
stack traces. Charts can therefore cover a period that raw drill-downs cannot.

### Can I create an alert from an APM chart?

Yes. The Services, Errors, and Infra chart menus open a Grafana alert-rule
draft with the scope, query, and a suggested threshold pre-filled. Review the
draft before saving it. The action needs Grafana alerting permissions.

---

## Related Guides

- [APM Overview](./index.md) - What each tab answers
- [Services](./services.md) - Service and operation RED metrics
- [Service Map](./service-map.md) - Dependencies and connection health
- [Traces](./traces.md) - Drill from a metric to one request
- [traceX](../tracex/index.md) - The full trace explorer
- [Auto-instrumentation](../../instrument/apps/auto-instrumentation/index.md) -
  Send the traces APM reads
