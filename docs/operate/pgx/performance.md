---
title: Performance
sidebar_label: Performance
sidebar_position: 3
---

# Performance

The Performance section provides detailed insights into query and transaction performance. Use it to identify slow queries, analyze execution patterns, and optimize your database workload.

![Performance](/img/pgx/04-performance-full.png)

---

## Sections

The Performance dashboard is organized into three sections:

1. **Overview** — Key performance visualizations
2. **Query Analytics** — Detailed query analysis table
3. **Transactions** — Transaction throughput and health

---

## Overview Section

The Overview section provides immediate visibility into query performance and distribution.

### Average Response Time

A time-series chart showing query response times over the selected period.

![Average Response Time](/img/pgx/04-performance-response-time.png)

**What it shows:**
- Average query execution time
- Trends over time
- Response time variations

**How to interpret:**
- Flat line at low values = healthy, consistent performance
- Spikes = potential issues (locks, resource contention, complex queries)
- Gradual increase = possible index degradation or data growth issues

**When to investigate:**
- Response times exceeding baseline by > 20%
- Sudden spikes correlating with errors
- Sustained elevated response times

### Query Distribution

A pie chart showing the breakdown of query types.

![Query Distribution](/img/pgx/04-performance-query-distribution.png)

**What it shows:**
- Proportion of SELECT, INSERT, UPDATE, DELETE operations
- Overall query mix

**How to interpret:**
- Most OLTP systems are read-heavy (SELECT > 70%)
- Write-heavy patterns may indicate bulk operations or data ingestion
- Unexpected changes may indicate application behavior changes

**When to investigate:**
- Sudden shift in query type distribution
- Unexpected write-heavy patterns
- High proportion of DELETE operations (may indicate cleanup jobs)

### Top Consuming Queries

A heatmap visualization showing which queries consume the most resources.

![Top Consuming Queries](/img/pgx/04-performance-heatmap.png)

**What it shows:**
- Query execution time distribution
- Resource-intensive queries highlighted
- Time-based patterns

**How to interpret:**
- Darker cells = higher resource consumption
- Horizontal patterns = consistently expensive queries
- Vertical patterns = time-based load spikes

**How to use it:**
- Identify your most expensive queries
- Spot queries that need optimization
- Correlate with deployment or traffic patterns

---

## Query Analytics Section

A detailed table showing performance metrics for individual queries. This section is collapsed by default — click to expand.

![Query Analytics](/img/pgx/04-performance-query-analytics.png)

### Table Columns

| Column | Description |
|--------|-------------|
| **Query** | The SQL query text (normalized) |
| **Calls** | Number of times the query was executed |
| **Total Time** | Cumulative execution time |
| **Mean Time** | Average execution time per call |
| **Min Time** | Fastest execution |
| **Max Time** | Slowest execution |
| **Rows** | Total rows returned/affected |
| **Shared Blks Hit** | Buffer cache hits |
| **Shared Blks Read** | Disk reads required |

### How to Use

**Find slow queries:**
1. Sort by "Mean Time" descending
2. Identify queries with high average execution time
3. Focus optimization efforts on high-call-count slow queries

**Find resource-intensive queries:**
1. Sort by "Total Time" descending
2. These queries consume the most cumulative resources
3. Even fast queries with high call counts can dominate

**Identify caching issues:**
1. Compare "Shared Blks Hit" vs "Shared Blks Read"
2. High read ratio = poor cache utilization
3. Consider index improvements or memory tuning

---

## Transactions Section

The Transactions section shows throughput and transaction health. This section is collapsed by default — click to expand.

![Transactions](/img/pgx/04-performance-transactions.png)

### Transactions Per Second (TPS)

**What it shows:**
- Number of committed transactions per second
- Throughput trends over time

**How to interpret:**
- Stable TPS = consistent workload
- Drops in TPS = potential bottlenecks or issues
- Spikes = batch operations or traffic surges

**Benchmarking:**
- Establish baseline TPS for your workload
- Set alerts for significant deviations
- Use for capacity planning

### Commit/Rollback Ratio

**What it shows:**
- Ratio of successful commits to rollbacks
- Transaction success rate over time

**Healthy range:** > 99% commits for most workloads.

**When to investigate:**
- Rollback rate exceeding 1%
- Sudden increase in rollbacks
- Correlation with application errors

**Common causes of high rollbacks:**
- Application errors
- Constraint violations
- Deadlocks
- Lock timeouts

---

## Use Cases

### Query Optimization Workflow

1. Open the **Performance** section
2. Identify expensive queries in the **heatmap**
3. Expand **Query Analytics** for details
4. Sort by "Total Time" to find biggest impact queries
5. Analyze query patterns (missing indexes, full table scans)
6. Implement optimizations
7. Monitor response time improvements

### Post-Deployment Performance Check

After deploying application changes:

1. Compare **Average Response Time** before/after
2. Check **Query Distribution** for unexpected changes
3. Review **Top Consuming Queries** for new expensive queries
4. Verify **TPS** hasn't degraded
5. Confirm **Commit/Rollback Ratio** is healthy

### Performance Baseline Establishment

To establish performance baselines:

1. Monitor during typical load periods
2. Record normal **Average Response Time** range
3. Document typical **TPS** patterns
4. Note expected **Query Distribution**
5. Use these as reference for anomaly detection

### Troubleshooting Slow Application

When users report slow application performance:

1. Check **Average Response Time** for database-level latency
2. Look for spikes correlating with reported issues
3. Identify slow queries in **Query Analytics**
4. Check **Commit/Rollback Ratio** for transaction failures
5. Review **TPS** for throughput bottlenecks

---

## Related Metrics

The Performance section uses these metrics from the [Metrics Reference](./metrics.md):

| Panel | Primary Metrics |
|-------|-----------------|
| Average Response Time | `pg_statement_stats.avg_time_ms` |
| Query Distribution | `pg_statement_stats.calls` |
| Top Consuming Queries | `pg_statement_stats.total_time_ms`, `pg_statement_stats.calls` |
| Query Analytics | `pg_statement_stats.*` |
| TPS | `pg_database_stats.xact_commit` |
| Commit/Rollback | `pg_database_stats.xact_commit`, `pg_database_stats.xact_rollback` |

---

## Next Steps

- [Queries](./queries.md) — Deep query analysis with filtering
- [Tables & Indexes](./tables-indexes.md) — Index and table optimization
- [Locks & Waits](./locks-waits.md) — Investigate transaction blocking
