---
title: base14 Scout APM - Application Performance Monitoring Overview
sidebar_label: Overview
sidebar_position: 2
description:
  Monitor application performance with APM in base14 Scout. Track service,
  operation, dependency, database, messaging, error, and infrastructure health.
keywords:
  [
    apm,
    application performance monitoring,
    opentelemetry apm,
    red metrics,
    latency,
    error rate,
    throughput,
    p99 latency,
    service map,
    service dependencies,
    database monitoring,
    messaging monitoring,
    error tracking,
    distributed tracing,
    span occurrences,
    scout apm,
    base14,
    scout,
  ]
---

# APM

APM is the application performance monitoring app built into base14 Scout. It
turns OpenTelemetry traces and metrics into service health views, dependency
maps, grouped errors, database and messaging analysis, and links to individual
traces.

![Services table with throughput, P99 latency, and error rate sparklines for every instrumented service](/img/apm/getting-started/apm-overview.png)

Charts read pre-aggregated rollups and detail views read raw spans, and the
two have different retention limits. See
[Raw trace limits](./getting-started.md#raw-trace-limits) for what that means
when a chart has data and its occurrence list does not.

---

## Tabs at a Glance

| Tab | What it answers |
| --- | --------------- |
| [Services](./services.md) | Which services or server operations have abnormal traffic, latency, or failures? |
| [Service Map](./service-map.md) | What calls what, and which node or connection is unhealthy? |
| [Traces](./traces.md) | What happened during an individual request? |
| [Errors](./errors.md) | Which exceptions are recurring, and what did their latest occurrences do? |
| [Database Operations](./database-operations.md) | Which database statements or operations are slow, frequent, or failing? |
| [Messaging Queues](./messaging-queues.md) | Which messaging operations are busy, slow, or failing? |
| [Infra](./infra.md) | Are the hosts or Kubernetes nodes beneath the services healthy? |

Services, Service Map, and Traces are always present. The other four depend on
rollups and metrics an administrator enables per deployment.

---

## Use Cases

### Triage a Latency Regression

1. Open [Services](./services.md) and sort by P99 latency to find the service
   that moved.
2. Open Service Detail and check its Spans table for the operation carrying
   the increase.
3. Open the operation and pick a slow occurrence to see the full trace in
   traceX.
4. If the trace spends its time in a query, continue in
   [Database Operations](./database-operations.md).

### Find Which Dependency Broke

1. Open [Service Map](./service-map.md) and isolate the failing service.
2. Inspect its unhealthy outgoing connections for call volume, latency, and
   error rate.
3. Open the suspect dependency's Service Detail or its logs in logX.

### Decide Whether It Is the Code or the Machine

1. Confirm the regression in [Services](./services.md).
2. Open [Infra](./infra.md) and select the instances you know run that
   service, then check CPU, memory, network, and filesystem.
3. If the resources are healthy, the cause is in the application path, so go
   back to the operation and its traces.

---

## FAQ

### Which APM tab should I start with?

Start with Services. It compares every instrumented service by throughput,
P99 latency, and error rate over the same window, which is the fastest way to
see which service moved. Every other tab is reached by drilling down from
something you found there.

### Why do some APM tabs not appear in my deployment?

Errors, Database Operations, Messaging Queues, and Infra depend on rollups and
metrics an administrator enables per deployment. Until the rollup exists, the
tab stays hidden rather than rendering an empty page. Services, Service Map,
and Traces are always present.

### Does APM read the same data as traceX?

Both read the spans your instrumentation sends, but at different resolutions.
APM aggregates them into rollups so fleet-wide views stay fast, and traceX
reads raw spans for one request. That is why an APM chart can cover a period
its occurrence list cannot.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - Service and operation RED metrics
- [Service Map](./service-map.md) - Dependencies and connection health
- [Errors](./errors.md) - Grouped exceptions and stack traces
- [traceX](../tracex/index.md) - The full trace explorer
- [logX](../logx/index.md) - Logs for the same services
- [k8X](../k8x/getting-started.md) - The Kubernetes fleet underneath
- [RUM](../rum/getting-started.md) - How mobile clients experience these
  same services
