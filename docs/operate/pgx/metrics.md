---
title: Metrics Reference
sidebar_label: Metrics
sidebar_position: 12
description:
  Complete pgX metrics reference for Base14 Scout. All PostgreSQL metrics
  including connections, replication, queries, locks, tables, indexes, and more.
keywords:
  [
    pgx,
    postgresql metrics,
    monitoring metrics,
    database metrics,
    prometheus,
    postgres observability,
    database telemetry,
  ]
---

pgX provides the most comprehensive PostgreSQL monitoring available. From server
health to query performance, replication lag to lock contention — every metric
you need to understand, optimize, and troubleshoot your PostgreSQL clusters is
at your fingertips.

Below is the complete reference of all metrics you can collect and use.

---

## Table of Contents

1. [Service Health & Connection](#1-service-health--connection)
2. [Server Metadata & Version](#2-server-metadata--version)
3. [Checkpoint & Recovery](#3-checkpoint--recovery)
4. [WAL (Write-Ahead Log)](#4-wal-write-ahead-log)
5. [Background Writer](#5-background-writer)
6. [Database Statistics](#6-database-statistics)
7. [Backend & Connection Details](#7-backend--connection-details)
8. [Table Metrics](#8-table-metrics)
9. [Index Metrics](#9-index-metrics)
10. [Sequence Metrics](#10-sequence-metrics)
11. [Function Metrics](#11-function-metrics)
12. [System Metrics](#12-system-metrics)
13. [Replication - Outgoing](#13-replication---outgoing)
14. [Replication - Slots](#14-replication---slots)
15. [Replication - Incoming](#15-replication---incoming)
16. [Query Statement Statistics](#16-query-statement-statistics)
17. [Role Metrics](#17-role-metrics)
18. [Tablespace Metrics](#18-tablespace-metrics)
19. [Lock Metrics](#19-lock-metrics)
20. [Extension Metrics](#20-extension-metrics)
21. [Configuration Settings](#21-configuration-settings)
22. [Progress Metrics](#22-progress-metrics)
23. [Logical Replication - Publications](#23-logical-replication---publications)
24. [Logical Replication - Subscriptions](#24-logical-replication---subscriptions)
25. [Cluster Metadata](#25-cluster-metadata)

---

## 1. Service Health & Connection

| Metric Name | Description                      | Type  | Labels |
| ----------- | -------------------------------- | ----- | ------ |
| `pg_up`     | 1 if PostgreSQL is up, 0 if down | Gauge | -      |

---

## 2. Server Metadata & Version

| Metric Name                    | Description                                          | Type  | Labels         |
| ------------------------------ | ---------------------------------------------------- | ----- | -------------- |
| `pg_metadata`                  | PostgreSQL metadata information                      | Gauge | `key`, `value` |
| `pg_system_identifier`         | PostgreSQL system identifier                         | Gauge | `identifier`   |
| `pg_server_version`            | PostgreSQL server version (e.g., 14.0)               | Gauge | `version`      |
| `pg_server_start_time_seconds` | PostgreSQL server start time as unix timestamp       | Gauge | -              |
| `pg_conf_load_time_seconds`    | PostgreSQL configuration load time as unix timestamp | Gauge | -              |

---

## 3. Checkpoint & Recovery

| Metric Name          | Description                       | Type  | Labels   |
| -------------------- | --------------------------------- | ----- | -------- |
| `pg_checkpoint_info` | PostgreSQL checkpoint information | Gauge | `metric` |
| `pg_recovery_status` | PostgreSQL recovery status        | Gauge | `metric` |

### pg_checkpoint_info Sub-metrics

| Sub-metric          | Description                            |
| ------------------- | -------------------------------------- |
| `checkpoint_lsn`    | Checkpoint LSN position                |
| `redo_lsn`          | Redo LSN position                      |
| `timeline_id`       | Current timeline ID                    |
| `next_xid`          | Next transaction ID                    |
| `oldest_xid`        | Oldest active transaction ID           |
| `oldest_active_xid` | Oldest currently active transaction ID |
| `checkpoint_time`   | Time of last checkpoint                |
| `wal_flush_lsn`     | WAL flush LSN position                 |
| `wal_insert_lsn`    | WAL insert LSN position                |
| `wal_lsn`           | Current WAL LSN position               |

### pg_recovery_status Sub-metrics

| Sub-metric             | Description                     |
| ---------------------- | ------------------------------- |
| `is_in_recovery`       | 1 if server is in recovery mode |
| `is_wal_replay_paused` | 1 if WAL replay is paused       |

---

## 4. WAL (Write-Ahead Log)

| Metric Name              | Description                         | Type    | Labels   | Notes          |
| ------------------------ | ----------------------------------- | ------- | -------- | -------------- |
| `pg_wal`                 | PostgreSQL WAL statistics           | Counter | `metric` | PostgreSQL 14+ |
| `pg_wal_archiving`       | PostgreSQL WAL archiving statistics | Counter | `metric` |                |
| `pg_wal_files`           | PostgreSQL WAL file counts          | Gauge   | `type`   |                |
| `pg_highest_wal_segment` | Numerically highest WAL segment     | Gauge   | -        |                |

### pg_wal Sub-metrics (PostgreSQL 14+)

| Sub-metric      | Description                              |
| --------------- | ---------------------------------------- |
| `records`       | Number of WAL records generated          |
| `fpi`           | Number of full page images generated     |
| `bytes`         | Total bytes of WAL generated             |
| `buffers_full`  | Number of times WAL buffers became full  |
| `write`         | Number of times WAL buffers were written |
| `sync`          | Number of times WAL files were synced    |
| `write_time_ms` | Total time spent writing WAL buffers     |
| `sync_time_ms`  | Total time spent syncing WAL files       |

### pg_wal_archiving Sub-metrics

| Sub-metric           | Description                               |
| -------------------- | ----------------------------------------- |
| `archived_count`     | Number of WAL files successfully archived |
| `failed_count`       | Number of failed WAL archive attempts     |
| `last_archived_time` | Timestamp of last successful archive      |
| `last_failed_time`   | Timestamp of last failed archive          |
| `stats_reset`        | Statistics reset timestamp                |

### pg_wal_files Sub-metrics

| Sub-metric    | Description                             |
| ------------- | --------------------------------------- |
| `count`       | Total number of WAL files               |
| `ready_count` | Number of WAL files ready for archiving |

---

## 5. Background Writer

| Metric Name   | Description                             | Type    | Labels   |
| ------------- | --------------------------------------- | ------- | -------- |
| `pg_bgwriter` | PostgreSQL background writer statistics | Counter | `metric` |

### pg_bgwriter Sub-metrics

| Sub-metric                 | Description                          |
| -------------------------- | ------------------------------------ |
| `checkpoints_timed`        | Number of scheduled checkpoints      |
| `checkpoints_req`          | Number of requested checkpoints      |
| `checkpoint_write_time_ms` | Time spent writing checkpoint files  |
| `checkpoint_sync_time_ms`  | Time spent syncing checkpoint files  |
| `buffers_checkpoint`       | Buffers written during checkpoints   |
| `buffers_clean`            | Buffers written by background writer |
| `buffers_backend`          | Buffers written directly by backends |
| `buffers_backend_fsync`    | Backend fsync calls                  |
| `buffers_alloc`            | Buffers allocated                    |

---

## 6. Database Statistics

| Metric Name               | Description                          | Type    | Labels                      |
| ------------------------- | ------------------------------------ | ------- | --------------------------- |
| `pg_connections`          | PostgreSQL connection statistics     | Gauge   | `state`, `database`, `user` |
| `pg_database_info`        | Database information including owner | Gauge   | `database`, `owner`         |
| `pg_database_size_bytes`  | Database size in bytes               | Gauge   | `database`                  |
| `pg_database_stats`       | Database statistics (counters)       | Counter | `database`, `metric`        |
| `pg_database_gauge_stats` | Database statistics (gauges)         | Gauge   | `database`, `metric`        |

### pg_database_stats Sub-metrics

| Sub-metric                    | Description                         | Notes |
| ----------------------------- | ----------------------------------- | ----- |
| `num_backends`                | Number of connected backends        |       |
| `xact_commit`                 | Transactions committed              |       |
| `xact_rollback`               | Transactions rolled back            |       |
| `blks_read`                   | Disk blocks read                    |       |
| `blks_hit`                    | Buffer cache hits                   |       |
| `tup_returned`                | Rows returned by queries            |       |
| `tup_fetched`                 | Rows fetched by queries             |       |
| `tup_inserted`                | Rows inserted                       |       |
| `tup_updated`                 | Rows updated                        |       |
| `tup_deleted`                 | Rows deleted                        |       |
| `temp_files`                  | Temporary files created             |       |
| `temp_bytes`                  | Temporary file bytes written        |       |
| `deadlocks`                   | Number of deadlocks detected        |       |
| `conflicts`                   | Queries canceled due to conflicts   |       |
| `blk_read_time_ms`            | Time spent reading blocks           |       |
| `blk_write_time_ms`           | Time spent writing blocks           |       |
| `stats_reset`                 | Statistics reset timestamp          |       |
| `checksum_failures`           | Data page checksum failures         | PG12+ |
| `checksum_last_failure`       | Last checksum failure timestamp     | PG12+ |
| `session_time_ms`             | Total session time                  | PG14+ |
| `active_time_ms`              | Time spent executing queries        | PG14+ |
| `idle_in_transaction_time_ms` | Time spent idle in transaction      | PG14+ |
| `sessions`                    | Total sessions                      | PG14+ |
| `sessions_abandoned`          | Abandoned sessions                  | PG14+ |
| `sessions_fatal`              | Sessions terminated by fatal errors | PG14+ |
| `sessions_killed`             | Sessions terminated by operator     | PG14+ |

### pg_database_gauge_stats Sub-metrics

| Sub-metric         | Description                         |
| ------------------ | ----------------------------------- |
| `connection_limit` | Maximum allowed connections         |
| `age_datfrozenxid` | Age of oldest frozen transaction ID |

---

## 7. Backend & Connection Details

| Metric Name              | Description                                    | Type  | Labels                                                                          |
| ------------------------ | ---------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `pg_backend_type_count`  | Count of PostgreSQL backends by type           | Gauge | `type`                                                                          |
| `pg_backend_wait_events` | Count of backends by wait event                | Gauge | `wait_event_type`, `wait_event`                                                 |
| `pg_backend_age_seconds` | Backend connection/transaction/query age       | Gauge | `pid`, `database`, `user`, `application`, `state`, `metric`                     |
| `pg_backend_info`        | PostgreSQL backend information with query text | Gauge | `pid`, `database`, `user`, `application`, `client`, `state`, `query`, `queryid` |

### pg_backend_age_seconds Sub-metrics

| Sub-metric        | Description                    |
| ----------------- | ------------------------------ |
| `backend_age`     | Age of the backend connection  |
| `transaction_age` | Age of the current transaction |
| `query_age`       | Age of the current query       |
| `state_age`       | Time in current state          |

---

## 8. Table Metrics

| Metric Name      | Description                | Type  | Labels                                                                                             |
| ---------------- | -------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `pg_table_info`  | Table metadata information | Gauge | `database`, `schema`, `table`, `relkind`, `relpersistence`, `tablespace`, `parent`, `is_partition` |
| `pg_table_stats` | Table statistics           | Gauge | `database`, `schema`, `table`, `metric`                                                            |

### pg_table_stats Sub-metrics

| Sub-metric            | Description                          | Notes |
| --------------------- | ------------------------------------ | ----- |
| `size_bytes`          | Table size in bytes                  |       |
| `seq_scan`            | Sequential scans initiated           |       |
| `seq_tup_read`        | Rows fetched by sequential scans     |       |
| `idx_scan`            | Index scans initiated                |       |
| `idx_tup_fetch`       | Rows fetched by index scans          |       |
| `n_tup_ins`           | Rows inserted                        |       |
| `n_tup_upd`           | Rows updated                         |       |
| `n_tup_del`           | Rows deleted                         |       |
| `n_tup_hot_upd`       | HOT updates (no index update needed) |       |
| `n_live_tup`          | Estimated live rows                  |       |
| `n_dead_tup`          | Estimated dead rows                  |       |
| `vacuum_count`        | Manual vacuum count                  |       |
| `autovacuum_count`    | Autovacuum count                     |       |
| `analyze_count`       | Manual analyze count                 |       |
| `autoanalyze_count`   | Autoanalyze count                    |       |
| `heap_blks_read`      | Heap blocks read from disk           |       |
| `heap_blks_hit`       | Heap blocks found in cache           |       |
| `idx_blks_read`       | Index blocks read from disk          |       |
| `idx_blks_hit`        | Index blocks found in cache          |       |
| `toast_blks_read`     | TOAST blocks read from disk          |       |
| `toast_blks_hit`      | TOAST blocks found in cache          |       |
| `tidx_blks_read`      | TOAST index blocks read              |       |
| `tidx_blks_hit`       | TOAST index blocks in cache          |       |
| `bloat_bytes`         | Estimated table bloat in bytes       |       |
| `last_vacuum`         | Last manual vacuum timestamp         |       |
| `last_autovacuum`     | Last autovacuum timestamp            |       |
| `last_analyze`        | Last manual analyze timestamp        |       |
| `last_autoanalyze`    | Last autoanalyze timestamp           |       |
| `n_mod_since_analyze` | Rows modified since last analyze     |       |
| `age_relfrozenxid`    | Age of table's frozen XID            |       |
| `num_columns`         | Number of columns in table           |       |
| `n_ins_since_vacuum`  | Rows inserted since last vacuum      | PG13+ |

---

## 9. Index Metrics

| Metric Name              | Description                          | Type  | Labels                                                                                   |
| ------------------------ | ------------------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| `pg_index_info`          | Index metadata information           | Gauge | `database`, `schema`, `table`, `index`, `am_name`, `tablespace`, `definition`            |
| `pg_index_stats`         | Index statistics                     | Gauge | `database`, `schema`, `table`, `index`, `metric`                                         |
| `pg_index_extended_info` | Extended index metadata              | Gauge | `schema`, `table`, `index`, `is_unique`, `is_primary`, `is_partial`, `partial_condition` |
| `pg_column_stats`        | Column statistics for index analysis | Gauge | `schema`, `table`, `column`, `metric`                                                    |

### pg_index_stats Sub-metrics

| Sub-metric      | Description                    | Notes |
| --------------- | ------------------------------ | ----- |
| `oid`           | Index OID                      |       |
| `table_oid`     | Parent table OID               |       |
| `size_bytes`    | Index size in bytes            |       |
| `idx_scan`      | Index scans initiated          |       |
| `idx_tup_read`  | Index entries read             |       |
| `idx_tup_fetch` | Table rows fetched             |       |
| `idx_blks_read` | Index blocks read from disk    |       |
| `idx_blks_hit`  | Index blocks found in cache    |       |
| `bloat_bytes`   | Estimated index bloat in bytes |       |
| `num_columns`   | Number of columns in index     |       |
| `last_idx_scan` | Last index scan timestamp      | PG16+ |

### pg_column_stats Sub-metrics

| Sub-metric    | Description                         |
| ------------- | ----------------------------------- |
| `n_distinct`  | Estimated number of distinct values |
| `correlation` | Physical row ordering correlation   |
| `null_frac`   | Fraction of null values             |

---

## 10. Sequence Metrics

| Metric Name         | Description         | Type    | Labels                                     |
| ------------------- | ------------------- | ------- | ------------------------------------------ |
| `pg_sequence_stats` | Sequence statistics | Counter | `database`, `schema`, `sequence`, `metric` |

### pg_sequence_stats Sub-metrics

| Sub-metric  | Description           |
| ----------- | --------------------- |
| `blks_read` | Blocks read from disk |
| `blks_hit`  | Blocks found in cache |

---

## 11. Function Metrics

| Metric Name               | Description                    | Type    | Labels                                     |
| ------------------------- | ------------------------------ | ------- | ------------------------------------------ |
| `pg_function_stats`       | User function statistics       | Counter | `database`, `schema`, `function`, `metric` |
| `pg_function_gauge_stats` | User function gauge statistics | Gauge   | `database`, `schema`, `function`, `metric` |

### pg_function_stats Sub-metrics

| Sub-metric      | Description                            |
| --------------- | -------------------------------------- |
| `calls`         | Number of function calls               |
| `total_time_ms` | Total time spent in function           |
| `self_time_ms`  | Self time (excluding called functions) |

### pg_function_gauge_stats Sub-metrics

| Sub-metric    | Description           |
| ------------- | --------------------- |
| `avg_time_ms` | Average time per call |

---

## 12. System Metrics

| Metric Name              | Description                    | Type  | Labels                               |
| ------------------------ | ------------------------------ | ----- | ------------------------------------ |
| `pg_system_info`         | System information             | Gauge | `cpu_model`, `hostname`, `num_cores` |
| `pg_system_load_avg`     | System load average (1-minute) | Gauge | -                                    |
| `pg_system_memory_bytes` | System memory usage            | Gauge | `type`                               |
| `pg_system_swap_bytes`   | System swap usage              | Gauge | `type`                               |

### pg_system_memory_bytes Types

| Type      | Description   |
| --------- | ------------- |
| `used`    | Used memory   |
| `free`    | Free memory   |
| `buffers` | Buffer memory |
| `cached`  | Cached memory |
| `slab`    | Slab memory   |

### pg_system_swap_bytes Types

| Type   | Description |
| ------ | ----------- |
| `used` | Used swap   |
| `free` | Free swap   |

---

## 13. Replication - Outgoing

| Metric Name                       | Description                                     | Type  | Labels                                                                               |
| --------------------------------- | ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `pg_replication_outgoing`         | PostgreSQL outgoing replication statistics      | Gauge | `client_addr`, `usename`, `application_name`, `state`, `sync_state`, `metric`        |
| `pg_replication_lag_milliseconds` | PostgreSQL replication lag in milliseconds      | Gauge | `client_addr`, `usename`, `application_name`, `lag_type`                             |
| `pg_replication_outgoing_info`    | PostgreSQL outgoing replication connection info | Gauge | `client_addr`, `usename`, `application_name`, `pid`, `backend_xmin`, `sync_priority` |

### pg_replication_outgoing Sub-metrics

| Sub-metric           | Description                      | Notes |
| -------------------- | -------------------------------- | ----- |
| `sent_lsn`           | LSN position sent to standby     |       |
| `write_lsn`          | LSN position written by standby  |       |
| `flush_lsn`          | LSN position flushed by standby  |       |
| `replay_lsn`         | LSN position replayed by standby |       |
| `backend_start_time` | Backend start timestamp          |       |
| `reply_time`         | Last reply timestamp             | PG12+ |

### pg_replication_lag_milliseconds Lag Types

| Lag Type | Description |
| -------- | ----------- |
| `write`  | Write lag   |
| `flush`  | Flush lag   |
| `replay` | Replay lag  |

---

## 14. Replication - Slots

| Metric Name                     | Description                                  | Type  | Labels                                                                                                          |
| ------------------------------- | -------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `pg_replication_slot_info`      | PostgreSQL replication slot information      | Gauge | `slot_name`, `slot_type`, `database`, `active`, `plugin`, `temporary`, `wal_status`, `two_phase`, `conflicting` |
| `pg_replication_slot_detail`    | PostgreSQL replication slot detailed metrics | Gauge | `slot_name`, `slot_type`, `metric`                                                                              |
| `pg_replication_slot_lsn`       | PostgreSQL replication slot LSN values       | Gauge | `slot_name`, `lsn_type`                                                                                         |
| `pg_replication_slot_lag_bytes` | PostgreSQL replication slot lag in bytes     | Gauge | `slot_name`                                                                                                     |

### pg_replication_slot_detail Sub-metrics

| Sub-metric            | Description                                  | Notes |
| --------------------- | -------------------------------------------- | ----- |
| `xmin`                | Oldest transaction needed by slot            |       |
| `catalog_xmin`        | Oldest transaction affecting system catalogs |       |
| `safe_wal_size_bytes` | Safe WAL size for slot                       | PG13+ |

### pg_replication_slot_lsn LSN Types

| LSN Type          | Description                  |
| ----------------- | ---------------------------- |
| `restart`         | Restart LSN position         |
| `confirmed_flush` | Confirmed flush LSN position |

---

## 15. Replication - Incoming

| Metric Name               | Description                                | Type  | Labels                                         |
| ------------------------- | ------------------------------------------ | ----- | ---------------------------------------------- |
| `pg_replication_incoming` | PostgreSQL incoming replication statistics | Gauge | `status`, `sender_host`, `slot_name`, `metric` |

### pg_replication_incoming Sub-metrics

| Sub-metric                   | Description                             |
| ---------------------------- | --------------------------------------- |
| `received_lsn`               | LSN position received                   |
| `latest_end_lsn`             | Latest end LSN                          |
| `lag_bytes`                  | Replication lag in bytes                |
| `seconds_since_last_message` | Seconds since last message from primary |

---

## 16. Query Statement Statistics

| Metric Name          | Description                     | Type    | Labels                                           |
| -------------------- | ------------------------------- | ------- | ------------------------------------------------ |
| `pg_statement_stats` | PostgreSQL statement statistics | Counter | `database`, `user`, `query`, `queryid`, `metric` |

### pg_statement_stats Sub-metrics

| Sub-metric            | Description                          | Notes |
| --------------------- | ------------------------------------ | ----- |
| `calls`               | Number of query executions           |       |
| `total_time_ms`       | Total execution time                 |       |
| `rows`                | Total rows affected/returned         |       |
| `max_time_ms`         | Maximum execution time               |       |
| `min_time_ms`         | Minimum execution time               |       |
| `avg_time_ms`         | Average execution time               |       |
| `stddev_time_ms`      | Standard deviation of execution time |       |
| `shared_blks_hit`     | Shared buffer cache hits             |       |
| `shared_blks_read`    | Shared blocks read from disk         |       |
| `shared_blks_dirtied` | Shared blocks dirtied                |       |
| `shared_blks_written` | Shared blocks written                |       |
| `local_blks_hit`      | Local buffer cache hits              |       |
| `local_blks_read`     | Local blocks read                    |       |
| `local_blks_dirtied`  | Local blocks dirtied                 |       |
| `local_blks_written`  | Local blocks written                 |       |
| `temp_blks_read`      | Temp blocks read                     |       |
| `temp_blks_written`   | Temp blocks written                  |       |
| `blk_read_time_ms`    | Block read time                      |       |
| `blk_write_time_ms`   | Block write time                     |       |
| `plans`               | Number of times planned              | PG13+ |
| `total_plan_time_ms`  | Total planning time                  | PG13+ |
| `min_plan_time_ms`    | Minimum planning time                | PG13+ |
| `max_plan_time_ms`    | Maximum planning time                | PG13+ |
| `stddev_plan_time_ms` | Standard deviation of planning time  | PG13+ |

---

## 17. Role Metrics

| Metric Name    | Description                 | Type  | Labels              |
| -------------- | --------------------------- | ----- | ------------------- |
| `pg_role_info` | PostgreSQL role information | Gauge | `name`, `attribute` |

### pg_role_info Attributes

| Attribute     | Description                        |
| ------------- | ---------------------------------- |
| `superuser`   | 1 if superuser                     |
| `inherit`     | 1 if inherits privileges           |
| `createrole`  | 1 if can create roles              |
| `createdb`    | 1 if can create databases          |
| `canlogin`    | 1 if can login                     |
| `replication` | 1 if can initiate replication      |
| `bypassrls`   | 1 if bypasses row-level security   |
| `connlimit`   | Connection limit (-1 for no limit) |

---

## 18. Tablespace Metrics

| Metric Name                | Description                     | Type  | Labels                      |
| -------------------------- | ------------------------------- | ----- | --------------------------- |
| `pg_tablespace_size_bytes` | Tablespace size in bytes        | Gauge | `name`, `owner`, `location` |
| `pg_tablespace_usage`      | Tablespace disk and inode usage | Gauge | `name`, `metric`            |

### pg_tablespace_usage Sub-metrics

| Sub-metric     | Description      |
| -------------- | ---------------- |
| `disk_used`    | Disk space used  |
| `disk_total`   | Total disk space |
| `inodes_used`  | Inodes used      |
| `inodes_total` | Total inodes     |

---

## 19. Lock Metrics

| Metric Name        | Description                                  | Type  | Labels                                                                         |
| ------------------ | -------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `pg_locks_count`   | Count of PostgreSQL locks by type and mode   | Gauge | `locktype`, `mode`, `granted`                                                  |
| `pg_lock_detail`   | Detailed PostgreSQL lock information per PID | Gauge | `pid`, `database`, `locktype`, `mode`, `granted`, `relation_oid`, `wait_start` |
| `pg_blocking_pids` | Which PIDs are blocking which other PIDs     | Gauge | `blocked_pid`, `blocking_pid`                                                  |

---

## 20. Extension Metrics

| Metric Name         | Description                      | Type  | Labels                                                                   |
| ------------------- | -------------------------------- | ----- | ------------------------------------------------------------------------ |
| `pg_extension_info` | PostgreSQL extension information | Gauge | `name`, `db_name`, `schema_name`, `default_version`, `installed_version` |

---

## 21. Configuration Settings

| Metric Name   | Description                       | Type  | Labels                    |
| ------------- | --------------------------------- | ----- | ------------------------- |
| `pg_settings` | PostgreSQL configuration settings | Gauge | `name`, `value`, `source` |

### Tracked Settings

| Setting                           | Description                     |
| --------------------------------- | ------------------------------- |
| `max_connections`                 | Maximum number of connections   |
| `shared_buffers`                  | Shared buffer size              |
| `work_mem`                        | Work memory per operation       |
| `maintenance_work_mem`            | Maintenance work memory         |
| `effective_cache_size`            | Effective cache size            |
| `max_wal_size`                    | Maximum WAL size                |
| `min_wal_size`                    | Minimum WAL size                |
| `max_worker_processes`            | Maximum worker processes        |
| `max_parallel_workers`            | Maximum parallel workers        |
| `max_parallel_workers_per_gather` | Max parallel workers per gather |
| `autovacuum`                      | Autovacuum enabled              |
| `synchronous_commit`              | Synchronous commit mode         |
| `checkpoint_timeout`              | Checkpoint timeout              |
| `wal_level`                       | WAL level                       |
| `max_locks_per_transaction`       | Max locks per transaction       |
| `deadlock_timeout`                | Deadlock timeout                |

---

## 22. Progress Metrics

| Metric Name                | Description                            | Type  | Labels                                        |
| -------------------------- | -------------------------------------- | ----- | --------------------------------------------- |
| `pg_vacuum_progress`       | PostgreSQL vacuum progress information | Gauge | `database`, `table`, `phase`, `pid`, `metric` |
| `pg_analyze_progress`      | PostgreSQL ANALYZE progress            | Gauge | `database`, `table`, `phase`, `pid`, `metric` |
| `pg_cluster_progress`      | PostgreSQL CLUSTER progress            | Gauge | `database`, `table`, `phase`, `pid`, `metric` |
| `pg_create_index_progress` | PostgreSQL CREATE INDEX progress       | Gauge | `database`, `index`, `phase`, `pid`, `metric` |
| `pg_recovery_detail`       | PostgreSQL recovery detail metrics     | Gauge | `metric`                                      |

### pg_vacuum_progress Sub-metrics

| Sub-metric           | Description           |
| -------------------- | --------------------- |
| `heap_blks_total`    | Total heap blocks     |
| `heap_blks_scanned`  | Heap blocks scanned   |
| `heap_blks_vacuumed` | Heap blocks vacuumed  |
| `index_vacuum_count` | Index vacuum count    |
| `num_dead_tuples`    | Number of dead tuples |
| `max_dead_tuples`    | Maximum dead tuples   |

### pg_analyze_progress Sub-metrics

| Sub-metric            | Description           |
| --------------------- | --------------------- |
| `sample_blks_total`   | Total sample blocks   |
| `sample_blks_scanned` | Sample blocks scanned |

### pg_cluster_progress Sub-metrics

| Sub-metric          | Description         |
| ------------------- | ------------------- |
| `heap_blks_total`   | Total heap blocks   |
| `heap_blks_scanned` | Heap blocks scanned |

### pg_create_index_progress Sub-metrics

| Sub-metric     | Description      |
| -------------- | ---------------- |
| `blocks_total` | Total blocks     |
| `blocks_done`  | Blocks completed |
| `tuples_total` | Total tuples     |
| `tuples_done`  | Tuples completed |

### pg_recovery_detail Sub-metrics

| Sub-metric                   | Description                       |
| ---------------------------- | --------------------------------- |
| `last_wal_receive_lsn`       | Last WAL receive LSN              |
| `last_wal_replay_lsn`        | Last WAL replay LSN               |
| `last_xact_replay_timestamp` | Last transaction replay timestamp |

---

## 23. Logical Replication - Publications

| Metric Name                  | Description                        | Type  | Labels                                                                |
| ---------------------------- | ---------------------------------- | ----- | --------------------------------------------------------------------- |
| `pg_publication_info`        | PostgreSQL publication information | Gauge | `database`, `publication`, `all_tables`, `insert`, `update`, `delete` |
| `pg_publication_table_count` | Number of tables in publication    | Gauge | `database`, `publication`                                             |

---

## 24. Logical Replication - Subscriptions

| Metric Name             | Description                         | Type          | Labels                                |
| ----------------------- | ----------------------------------- | ------------- | ------------------------------------- |
| `pg_subscription_info`  | PostgreSQL subscription information | Gauge         | `database`, `subscription`, `enabled` |
| `pg_subscription_stats` | PostgreSQL subscription statistics  | Gauge/Counter | `database`, `subscription`, `metric`  |

### pg_subscription_stats Sub-metrics

| Sub-metric             | Description                 | Notes |
| ---------------------- | --------------------------- | ----- |
| `pub_count`            | Number of publications      |       |
| `table_count`          | Number of subscribed tables |       |
| `worker_count`         | Number of workers           |       |
| `received_lsn`         | Received LSN position       |       |
| `latest_end_lsn`       | Latest end LSN              |       |
| `latency_microseconds` | Replication latency         |       |
| `apply_error_count`    | Apply error count           | PG15+ |
| `sync_error_count`     | Sync error count            | PG15+ |

---

## 25. Cluster Metadata

| Metric Name                   | Description                               | Type  | Labels   |
| ----------------------------- | ----------------------------------------- | ----- | -------- |
| `pg_notification_queue_usage` | Fraction of async notification queue used | Gauge | -        |
| `pg_last_xact`                | Last committed transaction information    | Gauge | `metric` |
| `pg_prior_lsn`                | Previous checkpoint LSN                   | Gauge | -        |

### pg_last_xact Sub-metrics

| Sub-metric  | Description                |
| ----------- | -------------------------- |
| `xid`       | Last transaction ID        |
| `timestamp` | Last transaction timestamp |

> **Note:** `pg_last_xact` is only exported if `track_commit_timestamp` is
> enabled.

---

## Metric Collection Configuration

Metric collection can be controlled via configuration flags:

| Flag                   | Description                |
| ---------------------- | -------------------------- |
| `CollectBasic`         | Basic server metrics       |
| `CollectBackends`      | Backend/connection details |
| `CollectTables`        | Table statistics           |
| `CollectIndexes`       | Index statistics           |
| `CollectSequences`     | Sequence statistics        |
| `CollectFunctions`     | Function statistics        |
| `CollectSystem`        | System metrics             |
| `CollectReplication`   | Replication metrics        |
| `CollectQueries`       | Query/statement statistics |
| `CollectRoles`         | Role information           |
| `CollectTablespaces`   | Tablespace metrics         |
| `CollectLocks`         | Lock metrics               |
| `CollectExtensions`    | Extension information      |
| `CollectSettings`      | Configuration settings     |
| `CollectProgress`      | Progress metrics           |
| `CollectPublications`  | Publication metrics        |
| `CollectSubscriptions` | Subscription metrics       |
| `CollectMetadata`      | Metadata metrics           |

---

## PostgreSQL Version Compatibility

Some metrics are only available in specific PostgreSQL versions:

| Version | Additional Metrics                                                 |
| ------- | ------------------------------------------------------------------ |
| PG12+   | `checksum_failures`, `checksum_last_failure`, `reply_time`         |
| PG13+   | `n_ins_since_vacuum`, `safe_wal_size_bytes`, planning time metrics |
| PG14+   | `pg_wal` stats, session time metrics                               |
| PG15+   | `apply_error_count`, `sync_error_count`                            |
| PG16+   | `last_idx_scan`                                                    |

---

## Related Guides

- [Quick Start](./quickstart.md) — Get started with pgX
- [Overview](./overview.md) — Cluster health monitoring
- [Configuration Reference](./configuration.md) — Configuration options
