---
title: APM Services and Operations - RED Metrics and Occurrences
sidebar_label: Services
sidebar_position: 3
description:
  Compare service RED metrics, inspect server operations, and open
  individual span occurrences in the APM Services view.
keywords:
  [
    apm,
    services,
    operations,
    spans,
    red metrics,
    throughput,
    error rate,
    p99 latency,
    service latency,
    slow operations,
    span occurrences,
    service detail,
    filter sidebar,
    opentelemetry,
    scout apm,
    base14,
    scout,
  ]
---

# Services and Operations

The Services tab compares every instrumented service over the selected time
range. Start here to find unusual throughput, latency, or failures, then drill
into the service and operation responsible.

![Services table listing each service with throughput, P99 latency, and error rate](/img/apm/services/services-table.png)

---

## Services Table

Each row shows one service:

| Column | Meaning |
| ------ | ------- |
| **Service** | Service name reported by OpenTelemetry instrumentation |
| **Throughput** | Current request rate, with its trend across the selected range |
| **P99 latency** | Current P99 server-span latency and its trend |
| **Error rate** | Share of server spans whose status is Error, with severity indication and trend |

Hovering a metric sparkline aligns the crosshair across the other metric
columns in that row. Deployment and alert annotations appear in the sparklines
when enabled.

- Click a column heading to sort.
- Use topbar search to filter by service name.
- Click a row to open **Service Detail**.

![Synchronized throughput, latency, and error rate sparklines on one service row](/img/apm/services/services-sparklines.png)

---

## Filter Sidebar

The sidebar facets services on the rollup columns configured by your
administrator. Typical facets include span name, kind, status, HTTP status, and
route.

- Select a value to add it to the scope.
- Select several values in a facet to include any of them.
- Use **Only** to replace that facet with one value.
- Use **Clear** to remove sidebar filters.
- Search within a facet when its value list is long.

Active filters also appear as chips above the page and are stored in the URL.

![Filter sidebar faceting services by span name, kind, status, HTTP status, and route](/img/apm/services/services-filter-sidebar.png)

---

## Service Detail

Clicking a service opens its detail page. It contains:

- **Throughput** over time.
- **Latency** with P50, P95, and P99 series.
- **Error rate** based on spans with Error status.
- A **Spans** table containing the service's server operations.

The charts and Spans table load independently. A slow table query therefore
does not prevent aggregate charts from appearing.

![Service detail page with throughput, latency percentile, and error rate charts](/img/apm/service-detail/service-detail-summary.png)

### Spans Table

Each operation row contains:

| Column | Meaning |
| ------ | ------- |
| **Name** | Server span or operation name |
| **Latency (avg.)** | Mean duration in the selected range |
| **Throughput** | Calls per minute |
| **Failed rate** | Percentage of calls with Error status |

Sort by a heading to find the busiest, slowest, or least reliable operation.
Use **Load more** or page controls to browse additional rows.

![Spans table listing server operations with average latency, throughput, and failed rate](/img/apm/service-detail/service-detail-transactions.png)

---

## Operation Detail

Click an operation row to open its detail view. This keeps the service context
instead of immediately switching to Traces.

The operation view shows:

- Calls, throughput, failed calls and error rate.
- Average, P50, P95, and P99 latency.
- Throughput, latency-percentile, and error-rate charts.
- **Recent**, **Slowest**, and **Failed** occurrence views.

Each occurrence includes its time, duration, status, and trace ID. Select one
to open its complete trace in traceX.

### Finding Occurrences Progressively

Raw occurrence search is intentionally narrower than the aggregate charts:

1. Search begins at the end of the selected range and covers the configured
   initial window, one hour by default.
2. If no occurrence is found, **Search 30m earlier** expands the queried window
   by the configured increment.
3. Expansion stops at the beginning of the selected range or at the
   administrator's raw-trace retention limit.

The page always shows the exact absolute interval queried. The same progressive
window applies when switching among Recent, Slowest, and Failed occurrences.

Use **View traces for last 15 minutes** when you want a broader traceX search
for the selected service and operation rather than one exact occurrence.
Browser Back returns from operation detail to the previous service view.

---

## Create Alerts from Service Charts

The Throughput, Latency, and Error rate chart menus can open Grafana's alert
editor with the service, environment, query, reducer, and a suggested threshold
already filled in. Review the draft before saving it. Availability depends on
your Grafana permissions and alerting configuration.

---

## Use Cases

### Morning Health Check

1. Leave **SERVICE** on **All** and sort the table by error rate.
2. Scan the sparklines for a service whose trend has moved since yesterday.
3. Open that service and check which operation carries the change.

### Find the Operation Behind a Latency Spike

1. Drag across the spike in the service's Latency chart to narrow the range.
2. Sort the Spans table by average latency.
3. Open the slowest operation and pick a **Slowest** occurrence to see its
   trace in traceX.

### Confirm a Deploy Made Things Worse

1. Find the release in the sparklines, if deployment annotations are enabled
   for your deployment.
2. Compare throughput, P99 latency, and error rate either side of the marker.
3. If the error rate moved, continue in [Errors](./errors.md) to see which
   exception is new.

---

## FAQ

### What do throughput, P99 latency, and error rate actually measure here?

They are the RED metrics for a service's server spans over the selected range.
Throughput is the current request rate, P99 latency is the 99th-percentile
server-span duration, and error rate is the share of server spans whose status
is Error. Each is drawn with its trend across the window.

### Why does an operation show no occurrences when its charts have data?

Occurrence search starts at the end of the selected range and covers a
configured initial window, one hour by default, while the charts read rollups
across the whole range. Use **Search 30m earlier** to widen the raw query. It
stops at the start of the range or at the administrator's raw-trace retention
limit, whichever comes first.

### How do I get from a slow service to the request that caused it?

Open the service, find the operation in its Spans table, then open that
operation and pick a **Slowest** or **Failed** occurrence. The occurrence
carries its trace ID into traceX, which opens the exact trace and span.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Service Map](./service-map.md) - The dependencies behind a slow service
- [Errors](./errors.md) - The exceptions behind an error rate
- [Traces](./traces.md) - One request end to end
