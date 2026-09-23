---
title: APM Messaging Queues - Throughput, Latency, and Slow Messages
sidebar_label: Messaging Queues
sidebar_position: 8
description:
  Monitor messaging throughput, latency, errors, and slow spans with the APM
  Messaging Queues tab in base14 Scout.
keywords:
  [
    apm,
    messaging,
    queues,
    topics,
    service bus,
    kafka,
    message latency,
    consumer group,
    messaging throughput,
    messaging errors,
    slow messages,
    span kind,
    opentelemetry messaging,
    scout apm,
    base14,
    scout,
  ]
---

# Messaging Queues

Messaging Queues reports RED-style metrics for instrumented messaging spans.
It groups activity by the dimensions stored in the messaging rollup rather than
attempting to infer producer or consumer categories.

The tab appears only when enabled for a deployment with the messaging rollup
configured.

![Messages per second, processing latency, error rate, and messaging time charts above the table](/img/apm/messaging-queues/messaging-queues-overview.png)

---

## Overview Charts

Four charts follow the current environment, service, search, filter, and time
scope:

| Chart | Meaning |
| ----- | ------- |
| **Messages / s** | Messaging span throughput |
| **Processing latency P95** | P95 span duration |
| **Error rate** | Percentage of messaging spans with Error status |
| **Messaging time / s** | Aggregate messaging duration per second |

Drag across a chart to narrow the application to that interval.

---

## Search and Filters

Topbar search matches messaging system, destination, operation, and consumer
group. The filter sidebar provides facets for:

- System.
- Destination.
- Operation.
- Consumer group.
- Span kind.

**Span kind is the value reported by the instrumented span.** A receive
operation may therefore appear as `Client`, `Consumer`, or another value based
on its instrumentation. APM does not reclassify it from the operation name.

---

## Messaging Table

| Column | Meaning |
| ------ | ------- |
| **Service** | Service that emitted the span |
| **System** | Messaging system, such as Kafka or Azure Service Bus |
| **Destination** | Queue, topic, subscription, or destination name |
| **Operation** | Reported messaging operation |
| **Consumer group** | Consumer group when provided |
| **Kind** | Raw OpenTelemetry span kind stored by the rollup |
| **Messages** | Number of matching spans |
| **P95** | P95 messaging-span duration |
| **Error rate** | Percentage with Error status |

Click a heading to sort. Select a row to open its resizable detail drawer.

---

## Messaging Detail

The drawer's summary and charts are scoped to the selected service,
environment, system, destination, operation, consumer group, and raw span kind.
It contains:

![Messaging detail drawer with RED metric charts and the ten slowest messages](/img/apm/messaging-queues/messaging-queue-detail.png)

- A summary of those dimensions and their RED metrics.
- Throughput, P95 latency, error-rate, and messaging-time charts.
- The **Top 10 slowest messages** found in raw spans.

The detail deliberately does not present a separate producer-versus-consumer
panel or derive either role from the operation name.

### Raw Message Window

The slowest-messages section displays the exact absolute interval queried. If
the selection extends beyond the administrator's raw trace limit, APM moves
the start to that retention floor. No progressive one-hour search applies to
this list; it finds the ten slowest spans over the entire allowed interval.

Raw occurrence matching uses service, environment, system, destination,
operation, and span kind. If charts contain data but the raw list is empty,
check that the rollup and raw span use the same values and configured attribute
mapping for those dimensions. In particular, the rollup's span kind must remain
the raw span kind.

Select a slow message to open its exact trace and span in traceX.

---

## Use Cases

### Explain a Growing Backlog

1. Compare **Messages / s** for the producing and consuming services over the
   same range.
2. Check processing latency P95 on the consumer side for a slowdown.
3. Open the destination's drawer and inspect its ten slowest messages.

### Find Which Destination Is Failing

1. Sort the messaging table by error rate.
2. Filter the sidebar to that system and destination.
3. Open a slow or failed message to see its trace in traceX.

### Confirm a Consumer Group Is Keeping Up

1. Filter by consumer group.
2. Read throughput and P95 latency for that group alone.
3. Compare against another group on the same destination.

---

## FAQ

### Why does a receive operation show span kind Client instead of Consumer?

Because the kind shown is the raw value your instrumentation reported. APM
stores what the span said and never reclassifies it from the operation name,
so a receive can legitimately appear as `Client`, `Consumer`, or another kind
depending on the library that produced it.

### The charts have data but the slowest-messages list is empty. Why?

Raw occurrence matching uses service, environment, system, destination,
operation, and span kind, and every one of those has to agree between the
rollup and the raw span. The usual cause is a mismatch in attribute mapping,
most often a span kind stored differently in the rollup than in the raw span.

### Does APM separate producers from consumers?

No, and that is deliberate. The detail view does not derive either role from
the operation name or show a separate producer-versus-consumer panel. Filter
by span kind and operation when you need one side of the exchange.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - The service producing or consuming messages
- [Traces](./traces.md) - The request around a messaging span
- [Errors](./errors.md) - Exceptions raised while processing a message
