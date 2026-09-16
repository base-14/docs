---
title: Conventions
sidebar_label: Conventions
description:
  Shared rules across the Scout API — time ranges and their maximum
  windows, the attribute filter syntax, pagination, and result limits.
keywords:
  - scout api filters
  - attribute filtering
  - span_attr
  - log_attr
  - api pagination
  - rfc3339 time range
---

# Conventions

These rules apply across the API. The attribute filter syntax is not
something you would guess from an endpoint's parameter list, so it is worth
reading before you build anything beyond a first query.

## Base URL

Every path in the reference is relative to your **API base URL**:

```text
https://api.<region>-scout.base14.io/<your-org>/api/v1
```

That is the discovery URL returned by
[step 3 of the quickstart](./quickstart.md#3-find-your-base-url) with
`/api/v1` appended. Discover it rather than hardcoding it. Your
organization slug is already part of it, so it never appears again in a
path.

## Time ranges

Query endpoints take `start_time` and `end_time` as RFC3339 timestamps:

```text
2026-09-16T06:00:00Z
```

Most endpoints require both. The `/services*` and `discover` endpoints
default to the last five minutes if you omit them.

### Maximum windows

Each endpoint family caps how wide a window you may request. Asking for
more returns `400` — the response is not silently truncated.

| Endpoint | Default maximum window |
| --- | --- |
| `/telemetry/logs`, `/telemetry/logs/discover` | 15 minutes |
| `/telemetry/traces/discover` | 15 minutes |
| `/telemetry/traces` | 24 hours |
| `/telemetry/traces/{traceId}` | 24 hours |
| `/telemetry/metrics/discover` | 30 minutes |
| `/telemetry/metrics` | 1 hour (30 minutes with `raw=true`) |
| `/services`, `/services/topology` | 1 hour |
| `/rum/*` | 7 days |
| `/apm/*` | 30 days |

Note that the two trace endpoints differ: querying traces allows 24 hours,
but `discover` on the same signal allows 15 minutes, because it scans
every span in the window to collect attribute keys.

To cover a longer period, page through it in chunks. The tight windows on
logs and span discovery are what keep those queries fast; the APM and RUM
endpoints read pre-aggregated data, which is why they reach 30 days.

### Maximum lookback

Separately from the window width, `start_time` cannot be more than **30
days** in the past on any endpoint. A 15-minute window is still rejected if
it sits 40 days back.

:::tip
If you are tempted to loop 15-minute windows across a whole day to compute
a rate or an error percentage, check the APM endpoints first.
`/apm/kpis` and `/apm/operations` return that already aggregated, over a
much wider window, in one request.
:::

## Attribute filters

Traces, logs and metrics carry arbitrary OpenTelemetry attributes. You
filter on them with prefixed query parameters — the prefix says which
attribute bag to look in, and the rest of the parameter name is the
attribute key.

| Prefix | Applies to | Example |
| --- | --- | --- |
| `span_attr_<key>` | Span attributes, on traces | `span_attr_http.method=GET` |
| `log_attr_<key>` | Log attributes, on logs | `log_attr_user_id=123` |
| `attr_<key>` | Metric attributes, on metrics | `attr_http.method=GET` |
| `resource_attr_<key>` | Resource attributes, on all three | `resource_attr_k8s.pod.name=pod-1` |

`/services` also accepts `span_attr_` and `resource_attr_` filters, which
is a useful way to narrow the service list to, say, one Kubernetes
namespace.

### Combining filters

Same key is OR, different keys are AND.

```text
# method is GET OR POST
?span_attr_http.method=GET&span_attr_http.method=POST

# method is GET AND status is 200
?span_attr_http.method=GET&span_attr_http.status_code=200
```

### Matching on presence

A `[ne]` suffix with an empty value matches records where the attribute is
present and non-empty, whatever its value:

```text
# every trace that has a gen_ai.request.model attribute
?span_attr_gen_ai.request.model[ne]=
```

This is the idiomatic way to select a class of telemetry — LLM calls,
database spans, anything identified by the presence of an attribute rather
than a specific value.

### Finding out which attributes exist

You rarely know the attribute keys up front. Each signal has a `discover`
endpoint that returns the keys, values, severities and span names actually
present for a service in a window:

- `/telemetry/logs/discover`
- `/telemetry/traces/discover`
- `/telemetry/metrics/discover`

Call `discover` first, build your filters from what it returns, then query.

## Pagination

Pagination is not uniform across the API — which style an endpoint uses
depends on how its data is stored.

### Cursor pagination

`/telemetry/logs` and `/telemetry/traces` return a `meta` object:

```json
{
  "logs": [],
  "meta": {
    "has_more": true,
    "next_cursor": "eyJ0cyI6IjIwMjYtMDktMTZUMDY6MDA6MDBaIn0"
  }
}
```

Pass `next_cursor` back as `cursor` to get the next page, and stop when
`has_more` is `false`. Treat the cursor as opaque — do not parse it or
construct one.

### Offset pagination

Every `/rum/*` and `/apm/*` list endpoint takes `limit` and `offset` and
returns a `count` for the current page. There is no cursor and no total, so
page until you get fewer rows than you asked for.

The exception is `/apm/facets`, which takes `limit` but no `offset` — it
returns the top values for a dimension, not a pageable list.

## Result limits

| Endpoint family | Default `limit` | Maximum |
| --- | --- | --- |
| `/telemetry/traces` | 20 | 100 |
| `/telemetry/logs` | 100 | 1000 |
| `/telemetry/metrics` | 1000 | 5000 |
| `/rum/*`, `/apm/*` | 100 | 1000 |

## Rate limits

There are none today. Do not design an integration around a specific
requests-per-second figure in either direction — the per-request `limit`
caps and the maximum time windows are the real constraints.

Rate limiting may be introduced. Handle `429` responses with a retry and
backoff even though nothing returns one right now.

## Browser access

The API does not return CORS headers, so browser JavaScript cannot call it
directly — the request fails at preflight. Call it from a server, a
scheduled job, or a CLI, and if a browser app needs the data, proxy it
through your own backend.

## FAQ

### Why does my query return 400 with a valid time range?

The window is almost certainly wider than the endpoint allows. Logs and
traces cap at 15 minutes by default. Check the maximum windows table above
and split the request into chunks.

### How do I filter on an attribute I cannot name?

Call the matching `discover` endpoint for that service and time window. It
returns the attribute keys and values actually present, which you then use
to build the real query.

### Can I sort results?

Only `/apm/operations`, which takes `sort_by` and `sort_order`. Every other
endpoint returns a server-defined order, usually newest first.

### Why do some endpoints use a cursor and others an offset?

They read different stores. The raw telemetry endpoints stream from a
time-ordered store where a cursor is both correct and cheap; the RUM and
APM endpoints read pre-aggregated rollups where offsets are fine. Write
your client to handle whichever style the endpoint you are calling uses.
