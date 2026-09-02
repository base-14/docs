---
title: Traces
sidebar_label: Traces
sidebar_position: 7
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
    base14,
    scout,
  ]
---

The Traces tab embeds [traceX](/operate/tracex/) inside APM, carrying over your
current context — the selected service, environment, and time range — so
moving from an aggregate chart to the individual requests behind it takes one
click and no re-filtering.

![Traces Tab](/img/apm/traces/traces-embedded.png)

---

## How Context Carries Over

When you open the Traces tab, or drill through from another screen:

- The **time range** matches what you were looking at
- The **service** and **span** filters reflect where you drilled from — an
  endpoint in Service Detail or an error occurrence
- The **environment** selection is preserved

Inside the tab you have the full traceX experience: the duration heatmap,
attribute filtering, and the trace waterfall with span details, events, and
links.

See the [traceX documentation](/operate/tracex/) for the complete guide to reading
traces.

---

## Where Drill-Throughs Come From

| Origin | What the Traces tab shows |
| ------ | ------------------------- |
| Service Detail endpoint | Traces for that service and endpoint |
| Errors occurrence | The exact trace of the failing request |
| Service Map node | Traces for the selected service |
