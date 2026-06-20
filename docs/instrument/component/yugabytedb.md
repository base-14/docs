---
title: >
  YugabyteDB OpenTelemetry Monitoring - Tablet-Server Liveness, Clock Skew,
  and Collector Setup
sidebar_label: YugabyteDB
id: collecting-yugabytedb-telemetry
sidebar_position: 53
description: >
  Collect YugabyteDB metrics with the OpenTelemetry Collector's Prometheus
  receiver. Monitor tablet-server liveness, clock skew, re-replication, and
  YSQL throughput, then export to base14 Scout.
keywords:
  - yugabytedb opentelemetry
  - yugabytedb otel collector
  - yugabytedb metrics monitoring
  - yugabytedb performance monitoring
  - opentelemetry prometheus receiver yugabytedb
  - distributed sql metrics
  - yugabytedb observability
  - yugabytedb telemetry collection
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which ports and path does YugabyteDB use for metrics?","acceptedAnswer":{"@type":"Answer","text":"Each node serves Prometheus-format metrics at /prometheus-metrics on four ports: 7000 (yb-master), 9000 (yb-tserver), 13000 (YSQL, Postgres-wire), and 12000 (YCQL, Cassandra-wire). The Collector's prometheus receiver runs one scrape job per endpoint type across all nodes. No SQL login is involved - the endpoints are HTTP, not the SQL wire protocol."}},{"@type":"Question","name":"What does num_tablet_servers_live report in YugabyteDB?","acceptedAnswer":{"@type":"Answer","text":"The number of tablet servers the master currently considers live. In a healthy cluster it equals the node count; a drop signals a tablet server that is down or partitioned. Single-node PostgreSQL has no analogue - this is a distributed-cluster signal."}},{"@type":"Question","name":"Why monitor hybrid_clock_skew in YugabyteDB?","acceptedAnswer":{"@type":"Answer","text":"YugabyteDB tolerates clock skew up to hybrid_clock_error (the max_clock_skew_usec setting, 500ms by default). Beyond that bound, reads restart and a node can stall, so tracking hybrid_clock_skew against hybrid_clock_error warns you before consistency is at risk. It is the signature distributed-SQL health signal with no single-node PostgreSQL equivalent."}},{"@type":"Question","name":"Do I need a monitoring user like the PostgreSQL pg_monitor role?","acceptedAnswer":{"@type":"Answer","text":"No. Unlike the PostgreSQL receiver, YugabyteDB's Prometheus endpoints are plain HTTP and need no SQL credentials. Access setup is exposing the four HTTP ports (7000, 9000, 13000, 12000) to the Collector, not creating a monitoring role."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

# YugabyteDB

YugabyteDB is distributed SQL whose YSQL API speaks the PostgreSQL wire
protocol, so if you already run the [PostgreSQL receiver](./postgres.md) you
know most of the SQL-layer signals here. What single-node PostgreSQL gives you
no analogue for is the distributed machinery: tablet-server liveness, clock
skew across peers, and re-replication while the cluster heals from a node loss.
Those are the signals that page you when a multi-node cluster degrades, and
they are the reason this is a separate guide.

YugabyteDB exposes metrics in Prometheus format at `/prometheus-metrics`, but
on **four ports per node**: `7000` (yb-master), `9000` (yb-tserver), `13000`
(YSQL, the Postgres-wire API), and `12000` (YCQL, the Cassandra-wire API).
Every node runs both a yb-master and a yb-tserver. There is no native
YugabyteDB receiver and no `pg_stat` views in play - the OpenTelemetry
Collector's `prometheus` receiver scrapes each endpoint directly with one
scrape job per endpoint type. Metric names are un-prefixed and split across the
daemons (`handler_latency_yb_*`, `rocksdb_*` / `intentsdb_rocksdb_*` for the
two per-tablet RocksDB stores, `hybrid_clock_*`, `num_tablet_servers_*`,
`follower_lag_ms`), 3,400+ distinct names in all. This guide configures the
receiver and ships the metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum    | Recommended  |
| ---------------------- | ---------- | ------------ |
| YugabyteDB             | 2.18       | 2025.2+      |
| OTel Collector Contrib | 0.90.0     | latest       |
| base14 Scout           | Any        | —            |

Before starting:

- Each YugabyteDB node's metrics ports (`7000`, `9000`, `13000`, `12000`) must
  be reachable from the host running the Collector.
- No SQL monitoring user is required - the Prometheus endpoints are plain HTTP
  (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. Every series carries `exported_instance` (the node's `host:port`) and a
`metric_id` namespace (`yb.tabletserver`, `yb.master`, ...); per-tablet series
also carry `table_id` and `tablet_id`.

The tiers below lead with the distributed signals that have no single-node
PostgreSQL counterpart - tablet-server liveness, clock skew, and
re-replication - then cover the familiar YSQL throughput and latency series.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `num_tablet_servers_live` | Live tablet servers the master sees; equals the node count when healthy. Distributed signal with no PostgreSQL analogue. |
| `hybrid_clock_skew` | Live clock skew versus peers. YugabyteDB tolerates skew up to `hybrid_clock_error` (the `max_clock_skew_usec` setting, 500ms / 500000 µs by default); beyond it, reads restart and a node can stall. The signature distributed-SQL health signal. |
| `num_tablet_peers_undergoing_rbs` | Tablet peers being remote-bootstrapped (re-replicated); 0 in steady state, greater than 0 while the cluster heals from a node loss. The "is the cluster recovering" headline. Distributed signal. |
| `handler_latency_yb_ysqlserver_SQLProcessor_SelectStmt_count` (+ `InsertStmt` / `UpdateStmt` / `DeleteStmt`) | YSQL statements served on the Postgres-wire API - the headline throughput KPI. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `num_tablet_servers_live` | Below the node count means a tablet server is down or partitioned. Distributed signal. |
| `num_tablet_servers_dead` | The master has declared a tablet server dead; should sit at 0. Distributed signal. |
| `handler_latency_yb_tserver_TabletServerService_Read` / `Write` | DocDB read/write latency distribution (histogram via `_sum` / `_count`) - the latency SLI. |
| `follower_lag_ms` | Max follower replication lag per tablet; a rising value means a replica is falling behind its leader. Distributed signal. |
| `yb_ysqlserver_active_connection_total` / `yb_ysqlserver_connection_total` | Active and open YSQL connections versus `yb_ysqlserver_max_connection_total` (saturation). Postgres-wire delta. |
| `yb_ysqlserver_connection_over_limit_total` | YSQL connections rejected over the configured limit. |

### Diagnostic - for investigation and tuning

Higher cardinality - per-statement throughput, the per-tablet RocksDB stores,
WAL/Raft internals, and the large RPC families. Enable on demand; in production
you can drop this tier with a `metric_relabel_configs` block while keeping
Core + Operational.

| Metric | What it tells you |
|---|---|
| `handler_latency_yb_ysqlserver_SQLProcessor_{SelectStmt,InsertStmt,UpdateStmt,DeleteStmt}_{count,sum}`, `_Transactions_`, `_SingleShardTransactions_` | YSQL per-statement throughput and latency by operation. |
| `yb_ysqlserver_CatalogCacheMisses_count`, `yb_ysqlserver_CatCacheRefresh_count` | YSQL catalog-cache pressure. |
| `handler_latency_yb_tserver_TabletServerService_Write_count` / `_Read_count` | API-independent DocDB op rate underneath both YSQL and YCQL (the YSQL statement counters are the page-worthy KPI; these are the storage-layer detail). |
| `majority_sst_files_rejections`, `rocksdb_stall_micros`, `intentsdb_rocksdb_stall_micros` | Storage backpressure - writes rejected on too many SST files, and time the storage engine stalled writes. |
| `rocksdb_current_version_num_sst_files`, `rocksdb_current_version_sst_files_size`, `rocksdb_bytes_written` / `rocksdb_bytes_read`, `rocksdb_compaction_times_micros_*` (+ the `intentsdb_rocksdb_*` mirror) | DocDB RocksDB stores - the regular store and the intents (provisional-records) store, one of each per tablet. |
| `log_append_latency_*`, `log_sync_latency_*`, `log_wal_size`, `raft_term`, `handler_latency_yb_consensus_ConsensusService_UpdateConsensus_*`, `RunLeaderElection_count`, `LeaderElectionLost_count` | WAL append/sync and Raft replication RPC, terms, and elections. |
| `ts_live_tablet_peers`, `ts_supportable_tablet_peers`, `Create_Tablet_Task_count`, `AddServer_ChangeConfig_Task_count`, `is_load_balancing_enabled`, `blacklisted_leaders` | Tablet topology and master cluster-management tasks. |
| `generic_heap_size`, `mem_tracker_server` (+ `BlockBasedTable`, `Call`, `LogCache` subtrackers) | Server heap and per-component memory trackers. |

YugabyteDB also exposes a Cassandra-wire API (YCQL) on port `12000` with the
parallel `handler_latency_yb_cqlserver_SQLProcessor_*` per-statement counters
and `rpc_connections_alive`. The Configuration below scrapes it; if you do not
run YCQL workloads, those counters stay near zero. The primary delta in this
guide is against [PostgreSQL](./postgres.md) on the YSQL API.

The long diagnostic tail groups into RPC and engine families. The largest are
`proxy_*` / `service_*_bytes` (per-RPC-method request/response byte counters),
`handler_latency_yb_master_*` (master admin / cluster / DDL / client RPC),
`handler_latency_yb_tserver_*` (TServer RPC), `intentsdb_rocksdb_*` and
`rocksdb_*` (the two DocDB stores), `handler_latency_yb_cqlserver_*` (YCQL
engine), `mem_tracker_*`, `handler_latency_yb_consensus_*` (Raft),
`handler_latency_yb_ysqlserver_*` (YSQL per-statement), `log_*` (WAL),
`yb_ysqlserver_*` / `ysql_conn_mgr_*` (connections, catalog cache),
`transaction_*` / `pgsql_*` (distributed transaction coordinator), and
`hybrid_clock_*` (clock skew / error / hybrid-time).

Full metric reference:
[YugabyteDB metrics](https://docs.yugabyte.com/preview/launch-and-manage/monitor-and-alert/metrics/),
or `curl -s http://localhost:9000/prometheus-metrics` against any tablet server.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series. Tune
to your workload and cluster size; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `num_tablet_servers_live` | < node count | Falling further | A tablet server is down or partitioned; investigate the missing node. |
| `num_tablet_servers_dead` | > 0 | > 0 sustained | The master has declared a tablet server dead. |
| `hybrid_clock_skew` | > 40% of `hybrid_clock_error` | ≈ 80% of `hybrid_clock_error` (≈400ms at the 500ms default) | Clock-skew risk; skew beyond the configured max drives read restarts and can stall the node. Check NTP/chrony on the affected host. |
| `num_tablet_peers_undergoing_rbs` | > 0 | > 0 sustained | Re-replication (remote bootstrap) is not completing; a node loss is not healing. |
| `rate(handler_latency_yb_ysqlserver_SQLProcessor_SelectStmt_count + InsertStmt_count + UpdateStmt_count + DeleteStmt_count)` | Dipping vs baseline | ≈ 0 sustained under expected load | YSQL serving has stalled; check the YSQL layer and node health. |
| `follower_lag_ms` | Rising above your baseline follower lag | Sustained at a multiple of baseline / not converging | A replica is falling behind; replication is not converging. |
| `yb_ysqlserver_connection_over_limit_total` | > 0 | Increasing | YSQL is rejecting connections; raise `ysql_max_connections` or add a pooler. |

## Access Setup

YugabyteDB needs no SQL monitoring user for metrics. Unlike the PostgreSQL
receiver - which connects over the SQL wire protocol with a `pg_monitor`-role
account - YugabyteDB's `prometheus` endpoints are plain HTTP. "Access setup"
here means exposing each node's four metrics ports to the Collector:

- `7000` - yb-master
- `9000` - yb-tserver
- `13000` - YSQL (Postgres-wire)
- `12000` - YCQL (Cassandra-wire)

Every node serves its own metrics, so the Collector scrapes each node, not a
single load-balanced endpoint - the per-node `exported_instance` series is
exactly what the liveness, clock-skew, and replication tiers depend on.

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
services:
  yb1:                                  # Seed node - the others join it
    image: yugabytedb/yugabyte:2025.2.3.2-b1
    command: bin/yugabyted start --background=false
    ports:
      - "7000:7000"     # yb-master metrics + UI
      - "9000:9000"     # yb-tserver metrics + UI
      - "13000:13000"   # YSQL metrics
      - "12000:12000"   # YCQL metrics
      - "5433:5433"     # YSQL (Postgres-wire) SQL port

  yb2:
    image: yugabytedb/yugabyte:2025.2.3.2-b1
    command: bin/yugabyted start --background=false --join=yb1

  yb3:
    image: yugabytedb/yugabyte:2025.2.3.2-b1
    command: bin/yugabyted start --background=false --join=yb1
```

On a secure deployment the endpoints serve over `https`. Expose them to the
Collector over a trusted network path - the metrics carry no secrets, but the
endpoints should not be public. The scrape config below uses `http`; switch the
scheme to `https` and supply `tls` settings when the deployment is secure.

Verify the endpoints serve metrics:

```bash showLineNumbers title="Verify access"
# yb-master liveness view
curl -s http://localhost:7000/prometheus-metrics | grep -E '^num_tablet_servers_live'

# yb-tserver clock skew + DocDB
curl -s http://localhost:9000/prometheus-metrics | grep -E '^hybrid_clock_skew'

# YSQL throughput
curl -s http://localhost:13000/prometheus-metrics | grep -E 'SQLProcessor_SelectStmt_count'
```

## Configuration

YugabyteDB serves metrics at the non-default `/prometheus-metrics` path on four
ports, so set `metrics_path` explicitly and run one scrape job per endpoint
type, each targeting every node on its port. Each node returns its own series,
tagged with `exported_instance`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: yb-master
          scrape_interval: 15s
          metrics_path: /prometheus-metrics    # Not the default /metrics
          static_configs:
            - targets:
                - yb1:7000                      # Each node's yb-master port
                - yb2:7000
                - yb3:7000

        - job_name: yb-tserver
          scrape_interval: 15s
          metrics_path: /prometheus-metrics
          static_configs:
            - targets:
                - yb1:9000                      # Each node's yb-tserver port
                - yb2:9000
                - yb3:9000

        - job_name: yb-ysql
          scrape_interval: 15s
          metrics_path: /prometheus-metrics
          static_configs:
            - targets:
                - yb1:13000                     # Each node's YSQL port
                - yb2:13000
                - yb3:13000

        - job_name: yb-ycql
          scrape_interval: 15s
          metrics_path: /prometheus-metrics
          static_configs:
            - targets:
                - yb1:12000                     # Each node's YCQL port
                - yb2:12000
                - yb3:12000

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
      insecure_skip_verify: true               # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

YugabyteDB's `/prometheus-metrics` is whitelist-free - the receiver delivers
the full 3,400+ metric surface across the four endpoints with no filter. To
control metric volume in production, drop the Diagnostic tier with a
`metric_relabel_configs` block on the scrape configs while keeping the Core and
Operational series. If you do not run YCQL workloads, dropping the `yb-ycql`
job is the simplest first cut.

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
# Check Collector logs for scraped YugabyteDB metrics
docker logs otel-collector 2>&1 | grep -iE "num_tablet_servers_live|hybrid_clock_skew"

# Confirm a node is serving metrics on its yb-master endpoint
curl -s http://localhost:7000/prometheus-metrics | grep -E '^num_tablet_servers_live'
```

Several YSQL counters only move once the cluster does work. Drive some load and
confirm the statement counters rise and `num_tablet_servers_live` equals your
node count:

```bash showLineNumbers title="Generate YSQL load"
# YSQL speaks the Postgres wire protocol on port 5433
ysqlsh -h localhost -p 5433 -U yugabyte -c \
  "CREATE TABLE IF NOT EXISTS kv (k int PRIMARY KEY, v int);"
ysqlsh -h localhost -p 5433 -U yugabyte -c \
  "INSERT INTO kv VALUES (1, 1) ON CONFLICT (k) DO UPDATE SET v = kv.v + 1;
   SELECT count(*) FROM kv;"
```

The load runs over the YSQL SQL port (`5433`), which is separate from the
metrics scrape on ports `7000` / `9000` / `13000` / `12000`. Writes replicate
across all nodes (RF-3), so the statement counters move on every tablet server.

## Troubleshooting

### No YugabyteDB metrics in the Collector

**Cause**: The Collector cannot reach a node's metrics endpoint, or the scrape
path is wrong.

**Fix**:

1. Confirm the nodes are running and joined - the yb-master UI on `7000` lists
   the live tablet servers.
2. Verify each target's host and port (`7000` / `9000` / `13000` / `12000`)
   match the scrape configs.
3. Confirm `metrics_path` is set to `/prometheus-metrics` on every job. The
   receiver defaults to `/metrics`, which YugabyteDB does not serve.

### Metric name present but no datapoints

**Cause**: The cluster is idle, so the YSQL counters have not moved since the
last scrape.

**Look at**: `handler_latency_yb_ysqlserver_SQLProcessor_SelectStmt_count`
(should rise under load) and the YSQL connection counters
(`yb_ysqlserver_active_connection_total`). `num_tablet_servers_live` should
equal your node count even when idle.

**Fix**:

1. Run YSQL against the cluster on the SQL port (`5433`) and re-check.

### A tablet server dropped out of the cluster

**Cause**: A tablet server failed its heartbeats, was partitioned, or stalled
on clock skew.

**Look at**: `num_tablet_servers_dead` (should be 0) and
`num_tablet_servers_live` (below the node count means one is gone).
`hybrid_clock_skew` approaching `hybrid_clock_error` means the node is at risk
of read restarts and stalls - check NTP/chrony on that host.

**Fix**:

1. Restore network reachability or restart the node, then confirm
   `num_tablet_servers_live` returns to the node count.
2. Fix clock sync on the affected host if `hybrid_clock_skew` is high.

### Re-replication does not complete or followers lag

**Cause**: A node is down long enough that the cluster is remote-bootstrapping
tablet peers, or a replica cannot keep up with its leader.

**Look at**: `num_tablet_peers_undergoing_rbs` (greater than 0 sustained means
re-replication is not finishing) and `follower_lag_ms` (rising means a replica
is falling behind). The Diagnostic `log_sync_latency_*` and the Raft
`handler_latency_yb_consensus_*` series show whether replication RPC is the
bottleneck.

**Fix**:

1. Bring the missing node back or add capacity so remote bootstrap can finish
   and `num_tablet_peers_undergoing_rbs` returns to 0.
2. Investigate disk or network on the lagging replica if `follower_lag_ms`
   stays high.

### Writes are being rejected or the storage engine stalls

**Cause**: A tablet has accumulated too many SST files, so DocDB throttles
writes.

**Look at**: `majority_sst_files_rejections` (writes rejected on the SST-file
ceiling) and `rocksdb_stall_micros` / `intentsdb_rocksdb_stall_micros` (time
the regular and intents stores stalled writes). `rocksdb_current_version_num_sst_files`
shows the file count driving it.

**Fix**:

1. Let compaction catch up or tune compaction settings if SST-file counts climb
   faster than they are merged.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `prometheus` receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Which ports and path does YugabyteDB use for metrics?**

Each node serves Prometheus-format metrics at `/prometheus-metrics` on four
ports: `7000` (yb-master), `9000` (yb-tserver), `13000` (YSQL, Postgres-wire),
and `12000` (YCQL, Cassandra-wire). The `prometheus` receiver runs one scrape
job per endpoint type across all nodes. No SQL login is involved - the
endpoints are HTTP, not the SQL wire protocol.

**Do I need a monitoring user like the PostgreSQL `pg_monitor` role?**

No. Unlike the PostgreSQL receiver, which connects over the SQL wire protocol
with a `pg_monitor`-role account, YugabyteDB's Prometheus endpoints are plain
HTTP and need no SQL credentials. Access setup is exposing the four HTTP ports
to the Collector.

**How do I monitor all the nodes in a cluster?**

Add every node's `host:port` to each job's `static_configs.targets`. Each node
serves only its own series, tagged with `exported_instance`, so scraping each
node is what makes the per-node liveness, clock-skew, and replication tiers
work. Do not scrape a single load-balanced endpoint - you would lose per-node
visibility.

**What does `num_tablet_servers_live` report?**

The number of tablet servers the master currently considers live. In a healthy
cluster it equals the node count; a drop signals a tablet server the cluster can
no longer reach. Single-node PostgreSQL has no analogue - this is a
distributed-cluster signal.

**Why monitor `hybrid_clock_skew`?**

YugabyteDB tolerates clock skew up to `hybrid_clock_error` (the
`max_clock_skew_usec` setting, 500ms by default). Beyond that bound, reads
restart and a node can stall, so tracking `hybrid_clock_skew` against
`hybrid_clock_error` warns you before consistency is at risk. It is the
signature distributed-SQL health signal with no single-node PostgreSQL
equivalent.

**Does YugabyteDB also expose Cassandra-wire (YCQL) metrics?**

Yes. The YCQL API on port `12000` exposes parallel
`handler_latency_yb_cqlserver_SQLProcessor_*` per-statement counters. The
Configuration here scrapes it, but if you only run YSQL (Postgres-wire)
workloads those counters stay near zero, and you can drop the `yb-ycql` scrape
job to trim volume.

## Related Guides

- [PostgreSQL Monitoring](./postgres.md) - The single-node PostgreSQL
  counterpart; the YSQL-layer signals here speak its wire protocol, and this
  guide is the distributed delta on it (tablet-server liveness, clock skew,
  re-replication).
- [CockroachDB Monitoring](./cockroachdb.md) - The other distributed,
  PostgreSQL-wire-compatible SQL database, with the same Prometheus-scrape
  pattern and distributed signals.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on tablet-server liveness and clock skew.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [CockroachDB](./cockroachdb.md), and other
  components.
- **Fine-tune Collection**: Drop the Diagnostic tier (and the `yb-ycql` job if
  unused) in production with a `metric_relabel_configs` block to control volume;
  keep it available for incident investigation.
