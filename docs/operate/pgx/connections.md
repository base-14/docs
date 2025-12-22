---
title: Connections
sidebar_label: Connections
sidebar_position: 6
---

# Connections

The Connections tab provides comprehensive visibility into PostgreSQL connection
management. Use it to monitor connection pools, identify connection leaks, and
optimize connection utilization.

![Connections](/img/pgx/07-connections-full.png)

---

## Sections

The Connections tab is organized into four sections:

1. **Overview** — Connection topology and key stats
2. **Active Sessions** — Detailed view of current sessions
3. **Connection Pool Analytics** — Pool utilization and behavior
4. **Historical Analysis** — Long-term connection patterns

---

## Overview Section

The Overview section provides immediate visibility into connection state and distribution.

![Overview Section](/img/pgx/07-connections-overview.png)

### Application Connections Graph

A node graph visualization showing which applications are connected to PostgreSQL.

**What it shows:**

- Connected applications and services
- Connection distribution
- Network topology

**How to use it:**

- Identify all connection sources
- Spot unexpected connections
- Verify application connectivity

### Current Connections

**What it shows:** Current connection count as a percentage of `max_connections`.

**Healthy range:** < 80% of max_connections.

**When to investigate:**

- Approaching 80% — plan capacity increase
- Above 90% — immediate attention needed
- Sudden spikes — possible connection leak

### Connection Count (Peak)

**What it shows:** Peak connection count in the selected time period.

**How to use it:**

- Understand peak demand
- Plan `max_connections` setting
- Identify peak usage times

### Connection Distribution

A pie chart showing connections by state.

| State | Description |
|-------|-------------|
| **active** | Currently executing a query |
| **idle** | Connected but not executing |
| **idle in transaction** | In a transaction but not executing |
| **idle in transaction (aborted)** | Transaction failed, waiting for rollback |

**Healthy pattern:**

- Mostly idle connections = good pooling
- Many active = high load or slow queries
- Many idle in transaction = possible issues

**When to investigate:**

- High "idle in transaction" — application not committing
- High "idle in transaction (aborted)" — unhandled errors
- Very few idle — may need more connections

### Connection Duration Heatmap

**What it shows:** Distribution of connection ages over time.

**How to interpret:**

- Vertical spread = varying connection lifetimes
- Concentrated band = consistent pool behavior
- Long-lived connections = persistent connections or leaks

---

## Active Sessions Section

The Active Sessions table shows details of all current connections. This section
is collapsed by default — click to expand.

![Active Sessions](/img/pgx/07-connections-active-sessions.png)

### Table Columns

| Column | Description |
|--------|-------------|
| **PID** | Process ID of the backend |
| **Database** | Connected database |
| **User** | PostgreSQL role |
| **Application** | Application name (if set) |
| **Client** | Client IP address |
| **State** | Current connection state |
| **Query** | Current or last query |
| **Duration** | Time in current state |

### How to Use

**Find long-running queries:**

- Sort by Duration descending
- Look for active connections with long duration
- May indicate stuck queries or missing indexes

**Identify idle in transaction:**

- Filter by state = "idle in transaction"
- Long duration = possible application bug
- Check application code for uncommitted transactions

**Track application connections:**

- Group by Application
- Verify expected applications are connected
- Identify connection counts per application

---

## Connection Pool Analytics Section

The Pool Analytics section helps you understand connection pool behavior. This
section is collapsed by default — click to expand.

![Pool Analytics](/img/pgx/07-connections-pool-analytics.png)

### Idle Connection Analysis

**What it shows:** Count of idle connections over time.

**How to interpret:**

- Stable idle count = healthy pool
- Growing idle = possible connection leak
- Zero idle = pool exhaustion risk

**Optimization tips:**

- Too many idle = reduce pool size
- Too few idle = increase pool size
- Fluctuating = adjust pool min/max settings

### Pool Utilization

**What it shows:** Percentage of connections actively in use.

**Healthy range:** 20-70% for typical workloads.

**When to investigate:**

- Consistently > 80% — increase pool size
- Consistently < 10% — decrease pool size
- Sudden spikes — traffic surge or slow queries

### Connection Wait Time

**What it shows:** Time spent waiting for available connections.

**Healthy range:** Near zero for well-sized pools.

**When to investigate:**

- Any consistent wait time — pool too small
- Spikes correlating with traffic — scale pool dynamically
- Growing trend — connection leak or load increase

### Pool Turnover

**What it shows:** Rate of connection creation and destruction.

**How to interpret:**

- Low turnover = stable, persistent connections
- High turnover = connections being recycled frequently
- Spiky turnover = burst traffic patterns

**Optimization:**

- High turnover is expensive — consider connection pooler
- Very low turnover with high wait = increase pool
- Match turnover to application pattern

---

## Historical Analysis Section

The Historical Analysis section provides long-term connection pattern insights.
This section is collapsed by default — click to expand.

![Historical Analysis](/img/pgx/07-connections-historical.png)

### Application Connection Behavior

**What it shows:** Connection patterns per application over time.

**How to use it:**

- Identify which apps use most connections
- Spot applications with connection issues
- Plan capacity per application

### Peak Connection Analysis

**What it shows:** Peak connections over extended periods.

**How to use it:**

- Understand daily/weekly patterns
- Plan for peak capacity
- Set appropriate `max_connections`

### 7-Day Connection Pattern

**What it shows:** Connection behavior over the past week.

**How to use it:**

- Identify weekly patterns (weekday vs weekend)
- Spot anomalies in connection behavior
- Plan maintenance windows

---

## Use Cases

### Diagnosing Connection Exhaustion

When applications report "too many connections":

1. Check **Current Connections** percentage
2. Review **Connection Distribution** for state breakdown
3. Look for "idle in transaction" in **Active Sessions**
4. Check **Connection Wait Time** for queuing
5. Review **Pool Utilization** trends

**Common causes:**

- Connection leaks in application
- Transactions not being committed
- Pool size too small for load
- Slow queries holding connections

### Optimizing Connection Pool Size

1. Review **Pool Utilization** over time
2. Check **Connection Wait Time** for bottlenecks
3. Analyze **Idle Connection Analysis** for waste
4. Review **Pool Turnover** for efficiency
5. Adjust pool min/max based on patterns

**Guidelines:**

- Target 30-60% utilization during peak
- Near-zero wait time
- Stable idle count matching pool minimum
- Low turnover indicates efficient pooling

### Identifying Connection Leaks

1. Watch **Idle Connection Analysis** for growth
2. Check **Active Sessions** for long idle connections
3. Review **Application Connection Behavior** by app
4. Look for applications not releasing connections

**Signs of leaks:**

- Growing idle connection count
- Same connections idle for hours
- Applications with disproportionate connections

### Capacity Planning

1. Review **Peak Connection Analysis**
2. Analyze **7-Day Connection Pattern**
3. Check **Application Connection Behavior** growth
4. Plan `max_connections` with headroom

**Recommendations:**

- Set `max_connections` to 1.5x peak usage
- Consider connection pooler (PgBouncer) for high connection counts
- Monitor trends for growth patterns

### Troubleshooting Idle in Transaction

When you see many "idle in transaction" connections:

1. Check **Connection Distribution** for proportion
2. Find specific sessions in **Active Sessions** table
3. Note the Application and Query
4. Review application code for:
   - Missing COMMIT statements
   - Error handling not rolling back
   - Long-running batch operations

---

## Related Metrics

The Connections section uses these metrics from the [Metrics Reference](./metrics.md):

| Panel | Primary Metrics |
|-------|-----------------|
| Current Connections | `pg_connections`, `pg_settings.max_connections` |
| Connection Count | `pg_connections` |
| Distribution | `pg_connections` (by state) |
| Duration Heatmap | `pg_backend_age_seconds` |
| Active Sessions | `pg_backend_info`, `pg_backend_age_seconds` |
| Idle Analysis | `pg_connections` (state = idle) |
| Pool Utilization | `pg_connections`, `pg_settings.max_connections` |
| Wait Time | `pg_database_stats.session_time_ms` |
| Application Behavior | `pg_connections` (by application) |

---

## Next Steps

- [Overview](./overview.md) — High-level cluster health
- [Locks & Waits](./locks-waits.md) — Investigate blocked connections
- [Performance](./performance.md) — Query performance affecting connections
