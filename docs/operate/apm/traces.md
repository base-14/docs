---
title: APM Traces - Drill from Aggregate Metrics to One Request
sidebar_label: Traces
sidebar_position: 5
description:
  Inspect individual requests behind APM metrics with the embedded traceX
  Traces tab in base14 Scout.
keywords:
  [
    apm,
    traces,
    tracex,
    distributed tracing,
    trace waterfall,
    trace search,
    trace id,
    span id,
    exact trace,
    drill-down,
    root cause analysis,
    opentelemetry traces,
    scout apm,
    base14,
    scout,
  ]
---

# Traces

The Traces tab embeds [traceX](../tracex/index.md) inside APM. It preserves the
context from the APM view you drilled from, avoiding a second round of
filtering before you inspect a request.

![Embedded traceX Traces tab showing trace search results and the trace waterfall](/img/apm/traces/traces-embedded.png)

---

## How Context Carries Over

Depending on the origin, APM passes some or all of these values to traceX:

- Time range.
- Environment.
- Service name.
- Span or operation name.
- Trace ID and span ID for an exact occurrence.
- Error status when the drill-down requires failed traces.

Inside the tab you have the complete traceX experience: trace search, duration
visualizations, attribute filtering, and the trace waterfall with span details,
events, and links.

See the [traceX documentation](../tracex/index.md) for the complete guide.

---

## Aggregate Search versus Exact Trace

APM offers two kinds of trace navigation:

- An aggregate link opens traceX with filters. Examples include a Service Map
  node or **View traces for last 15 minutes** from an operation detail.
- An occurrence link passes the trace ID and span ID. It opens the exact trace
  behind an operation, error, database execution, or message.

---

## Drill-Through Origins

| Origin | Result in traceX |
| ------ | ---------------- |
| Operation detail occurrence | Exact trace and selected span |
| Operation detail 15-minute action | Traces for that service and operation during the last 15 minutes |
| Error occurrence | Exact trace and failing span |
| Database execution | Exact trace and database span |
| Messaging occurrence | Exact trace and messaging span |
| Service Map node | Traces scoped to the selected service |
| Service Map connection | Traces from the caller service |

---

## Use Cases

### See What One Slow Request Actually Did

1. Reach Traces from an operation occurrence so the trace ID is carried over.
2. Read the waterfall for the span that holds the time.
3. Open that span's attributes and events for the detail the aggregate view
   cannot show.

### Compare a Failure Against a Healthy Request

1. From an error occurrence, open the exact failing trace.
2. Use **View traces for last 15 minutes** on the same operation to find a
   successful one.
3. Compare the two waterfalls to see which call changed.

### Search Traces Without a Starting Point

1. Open the Traces tab directly and set the environment and service.
2. Filter by duration or attributes in traceX.
3. Return to [Services](./services.md) once you know which operation to chase.

---

## FAQ

### What is the difference between an aggregate trace link and an occurrence link?

An aggregate link opens traceX with filters, such as a Service Map node or
**View traces for last 15 minutes** on an operation. An occurrence link passes
a trace ID and span ID, so traceX opens that exact trace with the relevant
span selected.

### What context does APM carry into traceX?

Depending on where you came from, APM passes the time range, environment,
service name, span or operation name, trace and span ID for an exact
occurrence, and an error status when the drill-down requires failed traces.
You land in traceX already scoped rather than starting a blank search.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [traceX](../tracex/index.md) - The full trace explorer
- [Services](./services.md) - The operation an occurrence belongs to
- [Errors](./errors.md) - Drill into a failing span from its exception
