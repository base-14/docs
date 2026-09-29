---
title: APM Errors - Grouped Exceptions, Stack Traces, and Alerts
sidebar_label: Errors
sidebar_position: 6
description:
  Triage grouped exceptions, inspect occurrence trends and stack traces,
  and jump from an APM error to its exact trace.
keywords:
  [
    apm,
    errors,
    exceptions,
    error tracking,
    error inbox,
    issues,
    stack trace,
    grouped errors,
    error rate,
    error alert,
    occurrence trend,
    exception monitoring,
    opentelemetry,
    scout apm,
    base14,
    scout,
  ]
---

# Errors

The Errors tab groups exceptions into issues so a recurring failure appears as
one item with a count and trend rather than thousands of separate events. The
tab is available when your deployment has enabled the error rollup.

![Issues list grouping exceptions by type with trend, count, service, and last-seen columns](/img/apm/errors/errors-issues.png)

---

## Issues List

Each issue shows:

| Column | Meaning |
| ------ | ------- |
| **Issue** | Exception type and representative message |
| **Trend** | Occurrence trend across the selected range |
| **Count** | Number of occurrences |
| **Service** | Service reporting the exception |
| **Last seen** | Most recent occurrence |

- Search by exception type, message, or operation.
- Click a sortable heading to change order.
- Use **Load 50 more** to retrieve another batch of grouped issues.
- Select an issue to open its resizable detail drawer.

---

## Issue Detail

![Issue detail drawer with summary, occurrences chart, stack trace, and recent occurrences](/img/apm/errors/errors-detail.png)

The drawer contains:

- **Issue summary** with service, span name, count, and last-seen time.
- An **Occurrences** chart across the full selected range.
- The latest available **Stack trace**, with a copy action.
- **Recent occurrences** with time, message, and trace ID.

The grouped count and chart come from the error rollup. Stack traces and recent
occurrences are loaded from raw spans only after you select an issue.

### Raw Occurrence Window

The Recent occurrences caption states the exact absolute interval queried. If
the selected interval begins before the administrator's raw trace limit, APM
moves the start to that retention floor. A completely expired historical range
returns no raw events rather than reading older data.

Use **Load 10 more** to retrieve additional occurrences within that same
allowed interval.

### From Error to Trace

Select an occurrence to open traceX on its exact trace and failing span. This
shows the request's other service calls, database work, events, and timing
around the failure.

---

## Create an Error Alert

When the issue is backed by the error rollup, the Occurrences chart menu can
open a Grafana alert-rule draft scoped by the issue's numeric error key. The
error message is not placed in the alert URL or labels. Review the query and
threshold before saving; the action requires Grafana alerting permissions.

---

## Use Cases

### Triage a New Exception

1. Sort the Issues list by last seen to surface what started recently.
2. Open the issue and read the stack trace and its occurrence chart.
3. Select a recent occurrence to see the failing span in its full trace.

### Work Through the Loudest Errors First

1. Sort by count over the range you care about.
2. Check each issue's trend: a flat high count is background noise, a rising
   one is a regression.
3. Use the service column to decide which team owns the fix.

### Alert on an Issue You Cannot Fix Today

1. Open the issue and use the Occurrences chart menu.
2. Review the generated query and threshold in the Grafana alert draft.
3. Save it so the issue's return is reported rather than rediscovered.

---

## FAQ

### How are exceptions grouped into issues?

An issue groups occurrences of the same exception type and representative
message, so a failure that fired ten thousand times appears as one row with a
count and a trend. The grouped count and the occurrences chart come from the
error rollup.

### Why is there no stack trace on an older issue?

Stack traces and recent occurrences are read from raw spans, which have a
shorter retention limit than the rollup behind the count and chart. If the
selected range starts before that limit, APM moves the query start to the
retention floor, and a fully expired range returns no raw events at all.

### Does an error alert include the exception message?

No. The alert draft is scoped by the issue's numeric error key, and the error
message is not placed in the alert URL or its labels. Review the query and
threshold before saving; the action needs Grafana alerting permissions.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - The error rate an issue contributes to
- [Traces](./traces.md) - The request around a failing span
- [logX](../logx/index.md) - Logs from the same service
