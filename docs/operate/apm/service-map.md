---
title: APM Service Map - Service Dependencies and Connection Health
sidebar_label: Service Map
sidebar_position: 4
description:
  Visualize service dependencies and inspect service or connection health
  with the APM Service Map in base14 Scout.
keywords:
  [
    apm,
    service map,
    service dependencies,
    dependency graph,
    topology,
    distributed systems,
    upstream downstream,
    connection health,
    call volume,
    service latency,
    error rate,
    microservices,
    opentelemetry,
    scout apm,
    base14,
    scout,
  ]
---

# Service Map

The Service Map draws services as nodes and calls as directed edges. It helps
identify dependencies, failure propagation, and high-latency connections
without requiring you to know the topology in advance.

![Service map graph with sized service nodes and directed call edges between them](/img/apm/service-map/service-map-overview.png)

---

## Explore the Map

- Node size and health styling summarize traffic and errors.
- Directed edges represent observed calls between services.
- Service-kind chips show or hide categories of nodes.
- **Filter services** searches the map by service name.
- Selecting a service isolates its immediate neighborhood; clear isolation to
  return to the full map.
- The map follows the selected environment, service, and time range.

---

## Inspect a Service

Select a node to open its side panel.

![Service side panel with throughput, P99 latency, error rate, and span count](/img/apm/service-map/service-map-detail.png)

The panel shows:

- Throughput, P99 latency, error rate, and span count.
- Throughput and error-rate trends.
- A link to **Service Detail**.
- A scoped link to **Traces**.
- A link to the service's logs in logX when logX is available.

---

## Inspect a Connection

Select an edge to inspect the relationship between its caller and callee. The
connection panel includes:

- Call volume.
- Average, minimum, and maximum latency.
- Error rate and last-seen time.
- The operation identifying the connection.
- Links to either service's detail and to traces from the caller.

Connection statistics come from observed trace relationships, so a missing
edge generally means no matching relationship was recorded in the current
scope.

---

## Use Cases

### Follow an Alert to Its Cause

1. An alert identifies a user-facing service with rising failures.
2. Open Service Map and isolate that service.
3. Inspect unhealthy incoming and outgoing connections.
4. Open the suspected dependency's Service Detail, traces, or logs.
5. Use browser Back to return to the previous map context.

### Learn an Unfamiliar System

1. Clear the service selector so the whole environment is in scope.
2. Use the service-kind chips to hide datastores and focus on your own
   services first.
3. Select the busiest nodes to see what each one calls and who calls it.

### Check a Dependency Before Changing It

1. Isolate the service you are about to change.
2. Read each incoming connection's call volume and last-seen time to see who
   still depends on it.
3. Open traces from a caller to confirm which operations are in use.

---

## FAQ

### Why is a service or connection missing from the map?

Connections come from relationships observed in traces within the current
scope, so a missing edge means no matching relationship was recorded for the
selected environment, service, and time range. Widen the range or clear the
service selector before assuming the dependency is gone.

### What do node size and color mean?

Node size and health styling summarize the traffic and errors the service
reported in the selected window. Directed edges show observed calls between
services, and service-kind chips hide or show whole categories of node.

### Can I get from the map to a service's logs?

Yes, when logX is available in your Scout instance. The service side panel
links to Service Detail, to a scoped Traces view, and to that service's logs
in logX.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - RED metrics for a node on the map
- [Traces](./traces.md) - Traces from a selected node or connection
- [logX](../logx/index.md) - Logs for the selected service
