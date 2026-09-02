---
title: Services
sidebar_label: Services
sidebar_position: 2
description:
  Track request rate, error rate, and latency percentiles for every service
  with the APM Services tab in base14 Scout.
keywords:
  [
    apm,
    services,
    red metrics,
    request rate,
    error rate,
    p95 latency,
    service health,
    base14,
    scout,
  ]
---

The Services tab lists every instrumented service with its key health signals
for the selected time range. It is the starting point for most investigations:
scan for a service whose error rate or latency stands out, then click through.

![Services Tab](/img/apm/services/services-table.png)

---

## The Services Table

Each row shows one service:

| Column | Meaning |
| ------ | ------- |
| **Service** | Service name from your instrumentation |
| **Requests** | Request throughput over the window |
| **Error rate** | Share of requests that failed |
| **Latency** | Percentile latency (p95 and friends) |
| **Trend** | Sparklines of rate, errors, and latency over time |

- Click a **column header** to sort
- Use the **search box** in the topbar to filter by name
- Click a **row** to open the Service Detail view

![Service Sparklines](/img/apm/services/services-sparklines.png)

---

## Filter Sidebar

The sidebar facets the list on span attributes such as span kind, HTTP status,
span name, and route. Counts next to each value show how much traffic matches.

- Check a value to filter; check several to combine them
- **Only** narrows to a single value in one click
- **Clear** removes all sidebar filters
- Each facet has its own search for long value lists

![Filter Sidebar](/img/apm/services/services-filter-sidebar.png)

---

## Service Detail

Clicking a service opens its detail view with charts for throughput, errors,
and latency, plus per-endpoint breakdowns.

![Service Detail](/img/apm/service-detail/service-detail-summary.png)

The detail view includes:

- **Summary charts** — request rate, error rate, and latency percentiles over
  time for this service
- **Transactions** — the service's endpoints ranked by traffic, errors, and
  latency, so you can see which route is responsible for a regression

![Service Transactions](/img/apm/service-detail/service-detail-transactions.png)

From any endpoint you can continue into the Traces tab with the service and
span already selected.

---

## Alerts from Charts

Charts include a panel menu action to **create an alert rule** pre-filled with
the chart's query and sensible defaults — for example, a p95 latency threshold
for the service you are viewing. The rule opens in Grafana's alert editor for
review before you save it.
