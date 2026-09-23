---
title: APM Database Operations - Slow, Frequent, and Failing Queries
sidebar_label: Database Operations
sidebar_position: 7
description:
  Find frequent, slow, or failing database operations and drill into their
  traces with base14 Scout APM.
keywords:
  [
    apm,
    database operations,
    database spans,
    sql,
    query latency,
    slow queries,
    database errors,
    db time,
    p95 latency,
    postgresql,
    redis,
    database monitoring,
    traces,
    opentelemetry,
    scout apm,
    base14,
    scout,
  ]
---

# Database Operations

Database Operations summarizes database spans by system, namespace,
collection, operation, and statement. Use it to find the query or datastore
operation consuming time or contributing errors.

The tab appears only when enabled for a deployment with the database rollup
configured.

![Database operations, latency, error rate, and DB time charts above the operations table](/img/apm/database-operations/database-operations-overview.png)

---

## Overview Charts

Four charts follow the current environment, service, search, filter, and time
scope:

| Chart | Meaning |
| ----- | ------- |
| **Database operations** | Call volume |
| **Database latency P95** | P95 execution duration |
| **Database error rate** | Percentage of failed operations |
| **DB time (ms per second)** | Aggregate time spent in database calls per second |

Drag across a chart to narrow the whole application to that interval.
Configured annotations appear on these charts.

---

## Search and Filters

Topbar search matches database system, collection, operation, and statement.
The filter sidebar provides facets for:

- System.
- Namespace.
- Collection.
- Operation.
- Raw span kind.

The service and environment selectors remain in the topbar.

---

## Operations Table

| Column | Meaning |
| ------ | ------- |
| **System** | Database technology, such as PostgreSQL or Redis |
| **Namespace** | Database or logical namespace |
| **Collection** | Table, collection, or equivalent entity |
| **Operation** | Database operation name |
| **Statement** | Captured statement or span name |
| **Calls** | Number of executions |
| **P95** | P95 execution duration |
| **Errors** | Failed execution count |

Click a heading to sort server-side results. Use **Load more** in scrolling mode
or page controls in pagination mode. Select a row to open its resizable detail
drawer.

---

## Database Operation Detail

The drawer contains:

![Database operation drawer with the statement, database time chart, and slowest executions](/img/apm/database-operations/database-operation-detail.png)

- A summary with service, environment, span name, database dimensions, calls,
  P95, errors, and total database time.
- A syntax-highlighted statement.
- A per-minute **Database time** chart.
- The **Top 10 slowest executions** from raw spans.

The chart remains rollup-backed. Slowest executions are loaded separately, so
a raw-query failure does not remove the operation summary or chart.

### Raw Execution Window

The slowest-executions section displays the exact absolute range queried. The
start is moved forward when necessary so APM never reads data older than the
administrator's raw trace limit. No progressive one-hour search applies here;
the top ten are selected over the entire allowed portion of the chosen range.

Select an execution to open its exact trace and database span in traceX.

---

## Use Cases

### Find the Query Behind a Slow Endpoint

1. Scope to the service that owns the endpoint.
2. Sort the operations table by P95 to find its slowest statement.
3. Open the drawer, read the statement, and select one of the ten slowest
   executions to see it inside a full trace.

### Cut Total Database Time

1. Read the **DB time** chart rather than P95: a fast query called constantly
   can cost more than a slow one called rarely.
2. Sort by calls to find the chatty operations.
3. Check whether the caller can batch or cache them.

### Chase Database Errors

1. Filter the sidebar to the system or collection reporting failures.
2. Sort by errors and open the failing operation.
3. Follow an execution into traceX to see what the application did next.

---

## FAQ

### Should I chase P95 or DB time first?

Start with DB time. P95 finds the slowest single execution, while DB time
counts duration multiplied by frequency, so it surfaces the cheap query called
thousands of times that actually dominates the request. The two often point at
different operations.

### Why does the slowest-executions list cover less time than the chart above it?

The chart reads the rollup and the list reads raw spans, which have their own
retention limit. The list states the absolute interval it queried, and its
start is moved forward when the selection reaches past that limit. There is no
progressive one-hour search here; the top ten are chosen over the whole allowed
interval.

### Why is the Database Operations tab missing?

The tab appears only for deployments where an administrator has enabled it and
configured the database rollup. Database spans alone are not enough.

---

## Related Guides

- [Getting Started](./getting-started.md) - Scope, filters, and trace limits
- [Services](./services.md) - The service issuing the query
- [Traces](./traces.md) - The request around a database span
- [pgX](../pgx/overview.md) - PostgreSQL monitoring from the database side
