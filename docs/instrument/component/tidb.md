---
title: >
  TiDB OpenTelemetry Monitoring - Store Liveness, Region Replication,
  and Collector Setup
sidebar_label: TiDB
id: collecting-tidb-telemetry
sidebar_position: 54
description: >
  Collect TiDB metrics with the OpenTelemetry Collector's Prometheus
  receiver. Monitor store liveness, region replication, the TSO clock, and
  MySQL-wire query throughput, then export to base14 Scout.
keywords:
  - tidb opentelemetry
  - tidb otel collector
  - tidb metrics monitoring
  - tidb performance monitoring
  - opentelemetry prometheus receiver tidb
  - distributed sql metrics
  - tidb observability
  - tidb telemetry collection
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which ports and path does TiDB use for metrics?","acceptedAnswer":{"@type":"Answer","text":"TiDB is three component types, each with its own Prometheus /metrics endpoint: PD on port 2379, TiKV on status port 20180, and TiDB on status port 10080. The Collector runs one prometheus scrape job per component type, all at metrics_path /metrics. No SQL login is involved - these are HTTP status endpoints, not the MySQL wire protocol on port 4000."}},{"@type":"Question","name":"Do I need a MySQL monitoring user like the mysqlreceiver needs?","acceptedAnswer":{"@type":"Answer","text":"No. Unlike the MySQL receiver, which connects over the MySQL wire protocol with a GRANT-ed monitoring user, TiDB's metrics come from plain HTTP status endpoints on PD, TiKV, and TiDB. Access setup is exposing those status ports (2379, 20180, 10080) to the Collector, not creating a CREATE USER / GRANT monitoring account."}},{"@type":"Question","name":"What does pd_cluster_status with store_up_count report in TiDB?","acceptedAnswer":{"@type":"Answer","text":"The number of TiKV stores PD currently considers live. In a healthy cluster it equals the store count; a drop signals a store PD can no longer reach. Single-node MySQL has no analogue - this is a distributed-cluster liveness signal."}},{"@type":"Question","name":"Why monitor tso_monitor_time_jump_back_total in TiDB?","acceptedAnswer":{"@type":"Answer","text":"PD's timestamp oracle (TSO) issues the timestamps TiDB uses to order every transaction. tso_monitor_time_jump_back_total increments when PD's physical clock moves backwards, which puts transaction ordering at risk. A rising counter means you should check the PD host clock and NTP."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# TiDB

TiDB is a distributed, MySQL-wire-compatible SQL database: the SQL layer
speaks the MySQL protocol on port `4000`, so if you already run the
[MySQL receiver](./mysql.md) you know most of the query-layer signals here.
What you do not have a single-node-MySQL analogue for is the distributed
machinery - whether every storage node is in the cluster, whether every
region is fully replicated, and whether the cluster's single source of time
is healthy. Those are the signals that page you when a multi-node cluster
degrades, and they are the reason this is a separate guide.

A TiDB cluster is three separate component types, each with its own
Prometheus `/metrics` endpoint on a different port:

- **PD** (Placement Driver) on `2379` - cluster metadata, region scheduling,
  the TSO timestamp oracle, and an embedded etcd.
- **TiKV** (the distributed key-value storage tier) on status port `20180` -
  regions, RocksDB, and Raft. Three TiKV stores give the default 3-replica
  (RF-3) region placement, which is why region and replication signals are
  meaningful.
- **TiDB** (the stateless MySQL-wire SQL layer) on status port `10080` -
  the query engine, sessions, and the TiKV client.

There is no native TiDB receiver and no `information_schema` / `SHOW STATUS`
scraping in play - the OpenTelemetry Collector's `prometheus` receiver scrapes
each component's status endpoint directly. Metric names are prefixed per
component (`pd_*`, `tikv_*`, `tidb_*`), plus PD's embedded `etcd_*` and TiKV's
`raft_engine_*` (the Raft log WAL) and `tikv_engine_*` (RocksDB); TiDB emits
900+ distinct metric names across the three endpoints. This guide configures
the receiver and ships the metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| TiDB (PD/TiKV/TiDB)    | 6.5     | 8.5+        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Each component's status port must be reachable from the host running the
  Collector: PD `2379`, TiKV `20180`, TiDB `10080`.
- No SQL monitoring user is required - the Prometheus endpoints are plain HTTP
  (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. Every series carries its scrape `job` (`tidb-pd` / `tidb-tikv` /
`tidb-tidb`) and `instance` (the component's `host:port`); per-store TiKV
series additionally carry the store endpoint.

The tiers below lead with the distributed signals that single-node MySQL
cannot show - store liveness, region replication, and the centralized
timestamp oracle - then cover the familiar MySQL-wire throughput and latency
series. The MySQL-wire QPS KPI carries over from single MySQL; the other Core
signals are the ones single MySQL has no analogue for.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `pd_cluster_status` (`type="store_up_count"` / `region_count` / `storage_size`) | The cluster brain's census: live TiKV stores (= the store count when whole), total regions, and used bytes. The "is the cluster whole" headline. No single-MySQL analogue. |
| `tidb_server_query_total` (by `type` / `result`) | MySQL-wire statements served on the SQL layer - the headline throughput KPI, and the `result="Error"` split is the error-rate SLI. The direct delta on single MySQL's `Queries` / `Com_*`. |
| `pd_regions_status` (`type="miss-peer-region-count"` / `down-peer-region-count` / `pending-peer-region-count`) | Region replication health: peers missing, down, or pending. 0 in steady state; greater than 0 means regions are under-replicated and the cluster is healing or stuck. The signature distributed signal. |
| `tso_monitor_time_jump_back_total` | The PD timestamp oracle's physical clock moved backwards. TiDB orders every transaction by TSO, so a jump-back is the centralized-clock health signal. No single-MySQL analogue. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `pd_cluster_status` (`type="store_down_count"` / `store_unhealth_count"` / `store_low_space_count"`) | PD has marked a TiKV store down, unhealthy, or low on space; each should be 0. Distributed signal. |
| `tidb_server_handle_query_duration_seconds` | SQL-layer query latency distribution (histogram) - the user-facing latency SLI. |
| `tidb_server_execute_error_total` / `tidb_server_critical_error_total` | SQL execution errors and critical (panic-class) errors on the TiDB node. |
| `tidb_server_connections` | Open client connections, against the `max-server-connections` limit (0 = unlimited by default). `token-limit` separately caps concurrently-running requests. The MySQL-wire connection-count delta. |
| `tidb_tikvclient_backoff_seconds` | TiDB backing off while waiting on TiKV; rising means the storage layer is slow or a region is unavailable. Distributed retry-pressure signal with no single-MySQL analogue. |
| `tikv_grpc_msg_duration_seconds` | TiKV-side request latency per command - the storage-layer SLI underneath the SQL layer. |
| `tikv_store_size_bytes` (`type="capacity"` / `available"`) | Per-store disk capacity and available bytes - storage pressure that drives PD rebalancing and, at the limit, write stalls. |
| `tikv_raftstore_region_count` (`type="region"` / `leader"`) | Regions and Raft leaders held per store; leader imbalance across stores concentrates load (hotspot). |
| `etcd_server_has_leader` / `etcd_server_leader_changes_seen_total` | PD's embedded etcd leader health. If PD's etcd has no leader or flaps, scheduling and TSO stall cluster-wide. |
| `pd_scheduler_handle_region_heartbeat_duration_seconds` | How long PD takes to process region heartbeats; rising latency means the scheduler is falling behind on a large cluster. |

### Diagnostic - for investigation and tuning

Higher cardinality - the storage engine internals, the Raft and scheduler
machinery, and the SQL-to-storage RPC layer. Enable on demand; in production
you can drop this tier with a `metric_relabel_configs` block while keeping
Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| TiKV RocksDB engine (`tikv_engine_*`) | `tikv_engine_size_bytes`, `tikv_engine_compaction_duration_seconds`, `tikv_engine_cache_efficiency`, `tikv_engine_bytes_per_read` / `_per_write`, plus the Titan blob-storage `tikv_engine_blob_*` family | Storage-engine size, compaction stalls, and cache behavior under load. |
| TiKV Raft store (`tikv_raftstore_*`) | `tikv_raftstore_apply_log_duration_seconds`, `_commit_log_duration_seconds`, `_append_log_duration_seconds`, `tikv_raftstore_raft_ready_handled_total`, `tikv_raftstore_leader_missing`, `tikv_raftstore_process_busy` | Raft replication latency and whether the raftstore thread is saturated. |
| TiKV Raft log engine (`raft_engine_*`) | `raft_engine_write_duration_seconds`, `raft_engine_sync_log_duration_seconds`, `raft_engine_log_entry_count`, `raft_engine_memory_usage` | The WAL underneath Raft - write/sync latency and log-entry backlog. |
| TiKV scheduler / coprocessor / storage (`tikv_scheduler_*`, `tikv_coprocessor_*`, `tikv_storage_*`) | `tikv_scheduler_latch_wait_duration_seconds`, `tikv_scheduler_commands_pri_total`, write-conflict and command-stage counters | Transaction-scheduler contention and pushed-down read execution. |
| TiDB → TiKV client (`tidb_tikvclient_*`) | `tidb_tikvclient_txn_cmd_duration_seconds`, `tidb_tikvclient_request_seconds`, region-cache and 2PC commit counters (`tidb_tikvclient_backoff_seconds` is also Operational) | The SQL-to-storage RPC layer - txn latency, region-cache misses, commit pressure. |
| TiDB session / executor / DDL (`tidb_session_*`, `tidb_executor_*`, `tidb_ddl_*`) | `tidb_session_transaction_duration_seconds`, `tidb_session_retry_error_total`, `tidb_executor_statement_total`, `tidb_ddl_worker_operation_total` | Transaction retries, statement mix, and schema-change progress. |
| TiDB optimizer stats / SLI (`tidb_statistics_*`, `tidb_sli_*`, `tidb_topsql_*`) | auto-analyze and stats-cache health; `tidb_sli_*` small-transaction SLI | Stale-statistics regressions and per-transaction SLI. |
| PD scheduling (`pd_scheduler_*`, `pd_schedule_*`, `pd_checker_*`) | `pd_scheduler_region_heartbeat`, `pd_schedule_operators_count`, hot-region and balance operators | Whether PD is rebalancing, splitting hot regions, or stuck. |
| PD client / replication / TSO (`pd_client_*`, `pd_replication_*`, `pd_tso_*`) | request latencies, replication mode, TSO issuance (`pd_tso_events`) | PD-client RPC latency and TSO issuance rate. |
| PD embedded etcd internals (`etcd_*`) | `etcd_disk_wal_fsync_duration_seconds`, `etcd_disk_backend_commit_duration_seconds`, `etcd_mvcc_db_total_size_in_bytes`, `etcd_server_proposals_*` | PD's own storage and consensus health behind the cluster metadata. |
| TiDB Resource Control (`resource_manager_*`) | per-resource-group Request Unit accounting (`resource_manager_resource_unit_read_request_unit_sum` / `_write_…`, `resource_manager_client_token_request_*`) | Request-Unit consumption - only meaningful when resource groups are configured. |

The long diagnostic tail groups into families, with distinct-name counts:
`tikv_raftstore_*` (103), `etcd_*` (75), `tikv_engine_*` (73),
`tidb_tikvclient_*` (73), `tidb_server_*` (52), `tikv_resolved_*` /
`tikv_cdc_*` (39, resolved-ts safe-point and change-data-capture),
`tikv_scheduler_*` (24), `resource_manager_*` (20), `tidb_session_*` (18),
`pd_scheduler_*` (17), `raft_engine_*` (16), `tidb_statistics_*` (16),
`tikv_coprocessor_*` (14), and `pd_server_*` / `pd_cluster_*` (24). The Go
and process runtime families (`go_*`, `process_*`) are emitted by every
PD/TiKV/TiDB binary.

Full metric reference:
[TiDB monitoring metrics](https://docs.pingcap.com/tidb/stable/grafana-overview-dashboard/),
or `curl -s http://localhost:10080/metrics` (TiDB),
`http://localhost:2379/metrics` (PD), and `http://localhost:20180/metrics`
(TiKV) against the components.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series. Tune
to your workload and cluster size; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `pd_cluster_status{type="store_up_count"}` (summed) | < store count | Falling further | A TiKV store is down or partitioned; investigate the missing store before region replication is at risk. |
| `pd_cluster_status{type="store_down_count"}` | > 0 | > 0 sustained | PD has declared a TiKV store down; recover or replace it. |
| `pd_regions_status{type="miss-peer-region-count"}` / `down-peer-region-count` | > 0 | > 0 sustained | Regions are under-replicated and not healing; a store loss is not recovering. Restore the missing store or add capacity. |
| `tso_monitor_time_jump_back_total` | Any increase | Increasing across scrapes | The PD timestamp oracle's clock jumped backwards; transaction ordering is at risk. Check the PD host clock / NTP. |
| `rate(tidb_server_query_total{result="OK"})` | Dipping vs baseline | ≈ 0 sustained under expected load | The SQL layer has stopped serving; check the TiDB nodes and TiKV health. |
| `rate(tidb_server_query_total{result="Error"}) / rate(tidb_server_query_total)` | Rising vs baseline | Climbing steeply | SQL error rate climbing; express the threshold as an error-ratio relative to your workload's baseline. |
| `tidb_server_handle_query_duration_seconds` (p99) | Rising vs baseline | Well above normal p99 | Query-latency regression; relate the threshold to the workload's normal p99. |
| `tidb_tikvclient_backoff_seconds` | Rising vs baseline | Sustained high | TiDB is backing off on TiKV; the storage layer is slow or a region is unavailable. |
| `tikv_store_size_bytes{type="available"}` | < a low fraction of `{type="capacity"}` | Approaching zero | A TiKV store is filling; writes stall when a store runs out of space. Add storage or rebalance. |
| `etcd_server_has_leader` (PD) | == 0 | == 0 sustained, or `rate(etcd_server_leader_changes_seen_total) > 0` sustained | PD's embedded etcd has no stable leader; scheduling and TSO are impaired cluster-wide. |

## Access Setup

TiDB needs no SQL monitoring user for metrics. Unlike the MySQL receiver -
which connects over the MySQL wire protocol with a `GRANT`-ed monitoring
account - TiDB's metrics come from each component's plain-HTTP status
endpoint. "Access setup" here means exposing the three components' status
ports to the Collector: PD `2379`, TiKV `20180`, and TiDB `10080`.

Every component serves its own metrics, and each TiKV store serves its own,
so the Collector scrapes each component instance - the per-store TiKV series
are exactly what the region and replication tiers depend on.

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
services:
  pd0:
    image: pingcap/pd:v8.5.6
    command:
      - --name=pd0
      - --client-urls=http://0.0.0.0:2379
      - --advertise-client-urls=http://pd0:2379
    ports:
      - "2379:2379"        # PD client + /metrics

  tikv0:
    image: pingcap/tikv:v8.5.6
    command:
      - --pd=pd0:2379
      - --addr=0.0.0.0:20160
      - --advertise-addr=tikv0:20160
      - --status-addr=0.0.0.0:20180   # TiKV /metrics
    depends_on: [pd0]

  # tikv1, tikv2 are identical with their own advertise-addr - three stores
  # give the default 3-replica (RF-3) region placement.

  tidb0:
    image: pingcap/tidb:v8.5.6
    command:
      - --store=tikv
      - --path=pd0:2379
      - --status=10080               # TiDB /metrics
    ports:
      - "4000:4000"        # MySQL wire protocol
      - "10080:10080"      # TiDB status + /metrics
    depends_on: [tikv0]
```

The status endpoints carry no secrets but should not be public. In a secured
deployment the status ports serve over `https` (TiDB and PD support TLS on the
status/client ports); expose them to the Collector over a trusted network path
and switch the scrape scheme to `https` with `tls` settings when TLS is on.

Verify each endpoint serves metrics:

```bash showLineNumbers title="Verify access"
# PD - cluster status and region health
curl -s http://localhost:2379/metrics | grep -E '^pd_cluster_status|^pd_regions_status'

# TiKV - per-store size and region count
curl -s http://localhost:20180/metrics | grep -E '^tikv_store_size_bytes|^tikv_raftstore_region_count'

# TiDB - MySQL-wire query throughput
curl -s http://localhost:10080/metrics | grep -E '^tidb_server_query_total'
```

## Configuration

The `prometheus` receiver scrapes the three endpoint types with one scrape job
per component, all at the default `metrics_path` `/metrics`. The `tidb-tikv`
job fans across every store so each TiKV instance's series are collected.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: tidb-pd
          scrape_interval: 15s
          static_configs:
            - targets:
                - pd0:2379                    # PD client/metrics port
        - job_name: tidb-tikv
          scrape_interval: 15s
          static_configs:
            - targets:
                - tikv0:20180                 # Each TiKV store's status port
                - tikv1:20180
                - tikv2:20180
        - job_name: tidb-tidb
          scrape_interval: 15s
          static_configs:
            - targets:
                - tidb0:10080                 # TiDB status port

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true             # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

The three endpoints deliver their full `/metrics` surface with no filter (900+
distinct names across PD, TiKV, and TiDB). To control metric volume in
production, drop the Diagnostic tier with a `metric_relabel_configs` block on
the scrape jobs while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute. The legacy `deployment.environment` is still accepted by Scout
> for backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped TiDB metrics across the three components
docker logs otel-collector 2>&1 | grep -iE "tidb_server_query_total|pd_cluster_status|tikv_store_size_bytes"

# Confirm each component is serving metrics on its status endpoint
curl -s http://localhost:2379/metrics  | grep -E '^pd_cluster_status'
curl -s http://localhost:10080/metrics | grep -E '^tidb_server_query_total'
```

The SQL counters only move once the cluster does work. Drive some MySQL-wire
load against TiDB and confirm `tidb_server_query_total` rises, all stores
report up, and regions are fully replicated:

```bash showLineNumbers title="Generate MySQL-wire load"
# TiDB speaks the MySQL protocol on port 4000 - use any MySQL client
mysql -h 127.0.0.1 -P 4000 -u root -e \
  "CREATE DATABASE IF NOT EXISTS bench;
   USE bench;
   CREATE TABLE IF NOT EXISTS t (id INT PRIMARY KEY, n INT);
   INSERT INTO t VALUES (1,1) ON DUPLICATE KEY UPDATE n=n+1;
   SELECT COUNT(*) FROM t;"

# PD should report all stores up and no under-replicated regions
curl -s http://localhost:2379/metrics | grep -E 'store_up_count|miss-peer-region-count'
```

## Troubleshooting

### No TiDB metrics in the Collector

**Cause**: The Collector cannot reach one of the component status endpoints, or
a scrape job targets the wrong port.

**Fix**:

1. Confirm the components are running and joined: PD on `2379`, each TiKV on
   `20180`, TiDB on `10080`.
2. Verify each job's targets and ports match the scrape config - the three
   component types use three different ports.
3. Confirm the `tidb-tikv` job lists every store; a missing store target means
   that store's `tikv_*` series never arrive even when the store is healthy.

### Metric name present but no datapoints

**Cause**: The cluster is idle, so the SQL and TiKV counters have not moved
since the last scrape.

**Look at**: `tidb_server_query_total` (should rise under load) and
`tidb_server_connections` (open connections). `pd_cluster_status{type="store_up_count"}`
should equal your store count even when idle.

**Fix**:

1. Drive MySQL-wire load against TiDB on port `4000` and re-check.

### A TiKV store dropped out of the cluster

**Cause**: A store failed its heartbeats to PD, or PD marked it down.

**Look at**: `pd_cluster_status{type="store_down_count"}` (greater than 0 means
PD declared a store down) and the Diagnostic `tikv_raftstore_leader_missing`
on the affected store. `tidb_tikvclient_backoff_seconds` rising on the SQL
side confirms TiDB is retrying against the missing store.

**Fix**:

1. Restore network reachability or restart the store, then confirm
   `pd_cluster_status{type="store_up_count"}` returns to the store count.

### Regions stay under-replicated

**Cause**: A store is down long enough that PD cannot meet the 3-replica
target, or rebalancing is stuck.

**Look at**: `pd_regions_status{type="miss-peer-region-count"}` /
`down-peer-region-count` (not converging back to 0). The Diagnostic
`pd_scheduler_*` operators and `pd_scheduler_handle_region_heartbeat_duration_seconds`
show whether PD is actively re-replicating or falling behind.

**Fix**:

1. Bring the missing store back or add a store so PD can restore the
   replication target.
2. If `tikv_store_size_bytes{type="available"}` is low on the remaining
   stores, PD cannot place new replicas - add storage or rebalance first.

### Transaction ordering or clock alarms

**Cause**: PD's physical clock moved backwards, or PD's embedded etcd lost its
leader, so the TSO cannot issue ordered timestamps.

**Look at**: `tso_monitor_time_jump_back_total` (any increase is a clock
jump-back) and `etcd_server_has_leader` / `etcd_server_leader_changes_seen_total`
on PD. The Diagnostic `etcd_disk_wal_fsync_duration_seconds` shows whether
PD's etcd disk is the bottleneck behind leader flaps.

**Fix**:

1. Fix clock sync (NTP / chrony) on the PD host if `tso_monitor_time_jump_back_total`
   increments.
2. If PD's etcd has no stable leader, check the PD host disk and network; a
   slow `etcd_disk_wal_fsync_duration_seconds` drives leader churn.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `prometheus` receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Which ports and path does TiDB use for metrics?**

TiDB is three component types, each with its own Prometheus `/metrics`
endpoint: PD on `2379`, TiKV on status port `20180`, and TiDB on status port
`10080`. The Collector runs one `prometheus` scrape job per component type,
all at `metrics_path` `/metrics`. No SQL login is involved - these are HTTP
status endpoints, not the MySQL wire protocol on port `4000`.

**Do I need a MySQL monitoring user like the `mysqlreceiver` needs?**

No. Unlike the MySQL receiver, which connects over the MySQL wire protocol
with a `GRANT`-ed monitoring user, TiDB's metrics come from plain-HTTP status
endpoints on PD, TiKV, and TiDB. Access setup is exposing those status ports
(`2379`, `20180`, `10080`) to the Collector, not creating a `CREATE USER` /
`GRANT` monitoring account.

**How do I monitor all the stores in a cluster?**

Add every TiKV store's `host:20180` to the `tidb-tikv` job's
`static_configs.targets`, every PD's `host:2379` to `tidb-pd`, and every TiDB
node's `host:10080` to `tidb-tidb`. Each instance serves only its own series,
tagged with `job` and `instance`, so scraping each one is what makes the
per-store region and replication tiers work.

**What does `pd_cluster_status{type="store_up_count"}` report?**

The number of TiKV stores PD currently considers live. In a healthy cluster it
equals the store count; a drop signals a store PD can no longer reach.
Single-node MySQL has no analogue - this is a distributed-cluster liveness
signal.

**Why monitor `tso_monitor_time_jump_back_total`?**

PD's timestamp oracle (TSO) issues the timestamps TiDB uses to order every
transaction. `tso_monitor_time_jump_back_total` increments when PD's physical
clock moves backwards, which puts transaction ordering at risk. A rising
counter means you should check the PD host clock and NTP.

## Related Guides

- [MySQL Monitoring](./mysql.md) - The single-node MySQL-wire counterpart; the
  SQL-layer signals here mirror its receiver, and this guide is the
  distributed delta on it (store liveness, region replication, the TSO clock).
- [CockroachDB Monitoring](./cockroachdb.md) - Another distributed SQL
  database, PostgreSQL-wire instead of MySQL-wire.
- [YugabyteDB Monitoring](./yugabytedb.md) - PostgreSQL-wire distributed SQL;
  the same Prometheus-scrape pattern across a multi-process cluster.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on store liveness and region replication.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [MySQL](./mysql.md), [CockroachDB](./cockroachdb.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `metric_relabel_configs` block to control volume; keep it available for
  incident investigation.
