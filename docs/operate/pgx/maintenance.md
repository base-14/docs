---
title: Maintenance
sidebar_label: Maintenance
sidebar_position: 10
description:
  Monitor PostgreSQL maintenance operations with pgX in Base14 Scout. Track
  vacuum status, dead tuples, bloat levels, and freeze age.
keywords:
  [
    pgx,
    postgresql maintenance,
    vacuum,
    autovacuum,
    bloat,
    dead tuples,
    database maintenance monitoring,
    postgres vacuum tracking,
  ]
---

The Maintenance tab helps you monitor PostgreSQL maintenance operations and
identify tables requiring attention. Use it to track vacuum status, dead tuple
accumulation, bloat levels, and freeze age.

![Maintenance](/img/pgx/11-maintenance-full.png)

---

## Sections

The Maintenance tab is organized into three sections:

1. **Critical Stats** — Key maintenance health indicators
2. **Vacuum Analysis** — Manual and auto vacuum tracking
3. **Bloat Monitoring** — Table and index bloat trends

---

## Critical Stats Section

The Critical Stats section shows the most important maintenance metrics
requiring attention.

![Critical Stats](/img/pgx/11-maintenance-critical.png)

### Table Analyze Stats

**What it shows:** When tables were last analyzed and rows modified since.

**Why it matters:**

- ANALYZE updates table statistics
- Query planner uses statistics for optimization
- Stale statistics cause poor query plans

**Columns:**

| Column               | Description                     |
| -------------------- | ------------------------------- |
| **Table**            | Table name                      |
| **Last Analyze**     | When last ANALYZE ran           |
| **Last Autoanalyze** | When autovacuum last analyzed   |
| **Rows Modified**    | Rows changed since last analyze |

**When to investigate:**

- Very old analyze timestamps
- High rows modified counts
- Poor query performance

### Table Freeze Age Status

**What it shows:** Transaction ID age of tables approaching wraparound.

**Why it matters:**

- PostgreSQL uses 32-bit transaction IDs
- IDs must be "frozen" before wraparound
- Failure to freeze causes database shutdown

**Warning thresholds:**

| Age         | Status                             |
| ----------- | ---------------------------------- |
| < 100M      | Healthy                            |
| 100M - 150M | Monitor                            |
| 150M - 200M | Warning                            |
| > 200M      | Critical — immediate action needed |

**When to investigate:**

- Any table > 100M age
- Increasing age trends
- Tables not being frozen

**Emergency action:**

```sql
-- Check freeze age
SELECT c.relname, age(c.relfrozenxid) as freeze_age
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'r'
ORDER BY age(c.relfrozenxid) DESC;

-- Force vacuum freeze
VACUUM FREEZE tablename;
```

### Dead Tuple Percentage

**What it shows:** Percentage of dead tuples per table over time.

**Why it matters:**

- Dead tuples consume space
- Cause table bloat
- Slow down sequential scans

**Healthy range:** < 10% for most tables.

**When to investigate:**

- Tables > 10% dead tuples
- Growing dead tuple percentage
- Correlation with performance issues

---

## Vacuum Analysis Section

The Vacuum Analysis section shows vacuum operation frequency. This section is
collapsed by default — click to expand.

![Vacuum Analysis](/img/pgx/11-maintenance-vacuum.png)

### Manual Vacuum Events

**What it shows:** Manual VACUUM operations over time.

**How to interpret:**

- Scheduled maintenance windows
- Ad-hoc cleanup operations
- DBA interventions

**When you need manual vacuum:**

- After bulk deletions
- Before planned heavy read operations
- When autovacuum is falling behind

### Auto Vacuum Events

**What it shows:** Autovacuum operations over time.

**How to interpret:**

- Higher frequency = more dead tuples being generated
- Low frequency = low write activity or generous thresholds
- Spikes = after bulk operations

**When to investigate:**

- Very low autovacuum frequency on busy tables
- Autovacuum not running when expected
- High frequency indicating excessive churn

---

## Bloat Monitoring Section

The Bloat Monitoring section tracks wasted space in tables and indexes. This
section is collapsed by default — click to expand.

![Bloat Monitoring](/img/pgx/11-maintenance-bloat.png)

### Table Bloat Percentage

**What it shows:** Estimated table bloat over time.

**What causes bloat:**

- UPDATE operations (old versions retained)
- DELETE operations (space not immediately reclaimed)
- Vacuum not running frequently enough

**Healthy range:** < 20% for most tables.

**When to investigate:**

- Tables > 20% bloat
- Growing bloat trend
- Performance degradation

**Remediation:**

| Bloat Level | Action                                  |
| ----------- | --------------------------------------- |
| 10-20%      | Standard VACUUM                         |
| 20-40%      | VACUUM FULL (during maintenance window) |
| > 40%       | pg_repack or VACUUM FULL                |

```sql
-- Standard vacuum (non-blocking)
VACUUM tablename;

-- Vacuum full (blocking, reclaims all space)
VACUUM FULL tablename;

-- Using pg_repack (non-blocking, requires extension)
-- pg_repack --table tablename
```

### Index Bloat Percentage

**What it shows:** Estimated index bloat over time.

**What causes index bloat:**

- Same factors as table bloat
- Page splits in B-tree indexes
- Non-HOT updates

**Healthy range:** < 30% for most indexes.

**Remediation:**

```sql
-- Rebuild a single index (blocking)
REINDEX INDEX indexname;

-- Rebuild all indexes on a table (blocking)
REINDEX TABLE tablename;

-- Concurrent reindex (PostgreSQL 12+, non-blocking)
REINDEX INDEX CONCURRENTLY indexname;
```

---

## Use Cases

### Daily Maintenance Check

Daily health check routine:

1. Check **Table Freeze Age Status** for critical ages
2. Review **Dead Tuple Percentage** for accumulation
3. Verify **Auto Vacuum Events** are running
4. Check **Table Bloat Percentage** trends

### Planning Maintenance Windows

Before scheduling maintenance:

1. Identify tables with high **Dead Tuple Percentage**
2. Check **Table Bloat Percentage** for candidates
3. Review **Index Bloat Percentage** for reindex needs
4. Schedule VACUUM FULL or pg_repack for bloated tables
5. Plan REINDEX for bloated indexes

### Investigating Slow Queries

When queries slow down:

1. Check **Table Analyze Stats** — stale statistics?
2. Review **Dead Tuple Percentage** — high dead tuples?
3. Check **Table Bloat Percentage** — excessive bloat?
4. Run ANALYZE and VACUUM as needed

### Configuring Autovacuum

Use maintenance data to tune autovacuum:

```sql
-- Check autovacuum settings
SELECT name, setting
FROM pg_settings
WHERE name LIKE 'autovacuum%';

-- Per-table autovacuum settings
ALTER TABLE tablename SET (
  autovacuum_vacuum_threshold = 50,
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05
);
```

**Tuning guidelines:**

- High-churn tables: Lower thresholds, more frequent vacuum
- Large tables: Lower scale factors
- Read-heavy tables: Less aggressive vacuum acceptable

### Emergency Freeze Prevention

If a table approaches wraparound:

1. Check **Table Freeze Age Status** for critical tables
2. Identify the specific table(s)
3. Run emergency vacuum freeze:

```sql
-- Check current oldest unfrozen XID
SELECT datname, age(datfrozenxid) FROM pg_database;

-- Vacuum freeze specific table
VACUUM (FREEZE, VERBOSE) tablename;

-- Monitor progress
SELECT relname, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname = 'tablename';
```

---

## Best Practices

### Autovacuum Configuration

Recommended settings for most workloads:

```sql
-- Increase autovacuum workers
ALTER SYSTEM SET autovacuum_max_workers = 4;

-- More aggressive vacuum
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;

-- Cost limits (adjust based on I/O capacity)
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 400;

-- Apply changes
SELECT pg_reload_conf();
```

### Monitoring Thresholds

Set up alerts for:

| Metric             | Warning  | Critical  |
| ------------------ | -------- | --------- |
| Dead Tuple %       | > 10%    | > 20%     |
| Table Bloat %      | > 20%    | > 40%     |
| Index Bloat %      | > 30%    | > 50%     |
| Freeze Age         | > 100M   | > 150M    |
| Time Since Analyze | > 7 days | > 14 days |

### Maintenance Schedule

Recommended maintenance cadence:

| Task                            | Frequency                    |
| ------------------------------- | ---------------------------- |
| Review maintenance dashboard    | Daily                        |
| ANALYZE heavily modified tables | After bulk loads             |
| VACUUM FULL bloated tables      | Monthly (maintenance window) |
| REINDEX bloated indexes         | Monthly (maintenance window) |
| Check freeze ages               | Weekly                       |

---

## Related Metrics

The Maintenance section uses these metrics from the
[Metrics Reference](./metrics.md):

| Panel         | Primary Metrics                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Analyze Stats | `pg_table_stats.last_analyze`, `pg_table_stats.last_autoanalyze`, `pg_table_stats.n_mod_since_analyze` |
| Freeze Age    | `pg_table_stats.age_relfrozenxid`                                                                      |
| Dead Tuple %  | `pg_table_stats.n_dead_tup`, `pg_table_stats.n_live_tup`                                               |
| Vacuum Events | `pg_table_stats.vacuum_count`, `pg_table_stats.autovacuum_count`                                       |
| Table Bloat   | `pg_table_stats.bloat_bytes`, `pg_table_stats.size_bytes`                                              |
| Index Bloat   | `pg_index_stats.bloat_bytes`, `pg_index_stats.size_bytes`                                              |

---

## Related Guides

- [Tables & Indexes](./tables-indexes.md) — Detailed table analysis
- [Performance](./performance.md) — Query performance
- [Configuration Reference](./configuration.md) — pgX settings
