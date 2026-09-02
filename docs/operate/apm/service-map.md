---
title: Service Map
sidebar_label: Service Map
sidebar_position: 3
description:
  Visualize service dependencies and failure propagation with the APM Service
  Map in base14 Scout.
keywords:
  [
    apm,
    service map,
    service dependencies,
    topology,
    distributed systems,
    base14,
    scout,
  ]
---

The Service Map draws your architecture as a live graph: services as nodes,
calls between them as edges. It answers "what talks to what" at a glance and
shows where errors and latency sit in the call graph.

![Service Map](/img/apm/service-map/service-map-overview.png)

---

## Reading the Map

- **Nodes** are services; size and badges reflect traffic and health
- **Edges** show call relationships and their direction
- Services with elevated error rates are highlighted, so a failing dependency
  stands out immediately

The map runs in a live mode with a short rolling window, so what you see
reflects current traffic rather than a stale snapshot.

---

## Inspecting a Service

Click a node to open its detail panel:

![Service Map Detail](/img/apm/service-map/service-map-detail.png)

The panel shows the service's rate, errors, and latency, along with its direct
upstream and downstream dependencies. From here you can jump to:

- The service's **Service Detail** view for full charts
- The **Traces** tab scoped to this service
- **Logs** for the service in logX

---

## Typical Workflow

1. An alert fires for a user-facing service
2. Open the Service Map — the highlighted node downstream shows the actual
   source of the failures
3. Click that node and drill into its traces or logs to find the cause
