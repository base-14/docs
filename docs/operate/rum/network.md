---
title: RUM Network
sidebar_label: Network
sidebar_position: 8
description:
  Analyze API and network performance from the mobile client's perspective
  with RUM in base14 Scout. Track response times, error rates, and failed
  requests by endpoint.
keywords:
  [
    rum,
    network,
    api performance,
    response time,
    error rate,
    failed requests,
    mobile network,
    base14,
    scout,
  ]
---

The **Network** tab surfaces API and network performance from the mobile
client's perspective - what your app actually experienced, not what your
backend logs say it sent.

---

## Avg Response Time by Endpoint

![Avg Response Time by Endpoint (top 10) chart with Name/Min/Mean/Max table](/img/rum/network/avg-response-time.png)

A time-series chart of the top 10 endpoints by response time, with a
Name / Min / Mean / Max table underneath so you can spot both a slow trend
and its worst-case latency per endpoint.

---

## All Endpoints

![All Endpoints table with URL, Method, Avg Duration, Error Rate, and Requests columns](/img/rum/network/all-endpoints.png)

A table of every endpoint the app called:

| Column | Description |
| ------ | ----------- |
| **URL** | The endpoint path |
| **Method** | HTTP method |
| **Avg Duration** | Average response time |
| **Error Rate** | Percentage of requests that failed |
| **Requests** | Total request count |

Sort by **Error Rate** or **Requests** to find the endpoints worth
investigating first.

---

## Failed Requests

A table scoped to just the failing calls: **URL**, **Method**, **Status**,
**Occurrences**, and **First/Last Seen** - useful for catching an endpoint
that's failing consistently even if its overall request volume is low enough
to not stand out in **All Endpoints**.

---

## Filters

Network adds HTTP-specific attributes to the shared
[Filters](./getting-started.md#filters) sidebar: `http.host`, `http.route`,
`http.method`, `http.status_code`, and `network.connection.type` - use these
to scope every panel above to a specific host, route, verb, status class, or
connection type.

---

## Use Cases

### Finding a Slow Endpoint

1. Check **Avg Response Time by Endpoint** for the top 10 offenders
2. Cross-check **All Endpoints**, sorted by **Avg Duration**, for anything
   outside the top 10 that's still slow relative to its request volume

### Catching a Silently Failing Endpoint

1. Sort **All Endpoints** by **Error Rate**
2. Open **Failed Requests** and filter by `http.route` to confirm the
   failure pattern (a specific status code, a specific host)

---

## Related Guides

- [Getting Started](./getting-started.md) - Interface layout and shared filters
- [Sessions](./sessions.md) - See individual `http.request` events in context
- [Screens](./screens.md) - Screen-level performance, for issues that aren't network-bound
