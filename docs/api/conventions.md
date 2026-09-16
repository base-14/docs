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

These rules apply across the API. The attribute filter syntax in particular
is not something you would guess from an endpoint's parameter list, so it
is worth reading before you build anything beyond a first query.

## Base URL

Every path in the reference is relative to your organisation's base URL
plus `/api/v1`:

```text
https://api.<region>-scout.base14.io/<your-org>/api/v1
```

Discover it rather than hardcoding it — see
[Quickstart](./quickstart.md#3-find-your-base-url). Your organisation slug
is already part of the base URL, so it never appears again in a path.

## Time ranges

Query endpoints take `start_time` and `end_time` as RFC3339 timestamps:

```text
2026-09-16T06:00:00Z
```

Most endpoints require both. Discovery and topology endpoints default to
the last five minutes if you omit them.

### Maximum windows

Each endpoint family caps how wide a window you may request. Asking for
more returns `400` — the response is not silently truncated.

| Endpoint family | Default maximum window |
| --- | --- |
| `/telemetry/logs`, `/telemetry/logs/discover` | 15 minutes |
| `/telemetry/traces`, `/telemetry/traces/discover` | 15 minutes |
| `/telemetry/traces/{traceId}` | 24 hours |
| `/telemetry/metrics/discover` | 30 minutes |
| `/telemetry/metrics` | 1 hour (30 minutes with `raw=true`) |
| `/services`, `/services/topology` | 1 hour |
| `/rum/*` | 7 days |
| `/apm/*` | 30 days |

To cover a longer period, page through it in chunks. The narrow windows on
logs and traces are what keep those queries fast; the APM and RUM
endpoints read pre-aggregated data, which is why they can span months.

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

### Combining filters

The rule is the one you would want: same key is OR, different keys are AND.

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
It is the difference between guessing attribute names and reading them.

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

All `/rum/*` and `/apm/*` list endpoints take `limit` and `offset`, and
return a `count` for the current page. There is no cursor and no total, so
page until you get fewer rows than you asked for.

### Result limits

| Endpoint family | Default `limit` | Maximum |
| --- | --- | --- |
| `/telemetry/traces` | 20 | 100 |
| `/telemetry/logs` | 100 | 1000 |
| `/telemetry/metrics` | 1000 | Enforced server-side |
| `/rum/*`, `/apm/*` | 100 | 1000 |
| `/alerts` | 10 | Enforced server-side |

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
