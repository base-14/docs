---
title: >
  CockroachDB OpenTelemetry Monitoring - Node Liveness, Range Health,
  and Collector Setup
sidebar_label: CockroachDB
id: collecting-cockroachdb-telemetry
sidebar_position: 50
description: >
  Collect CockroachDB metrics with the OpenTelemetry Collector's Prometheus
  receiver. Monitor node liveness, range replication, clock offset, and SQL
  throughput, then export to base14 Scout.
keywords:
  - cockroachdb opentelemetry
  - cockroachdb otel collector
  - cockroachdb metrics monitoring
  - cockroachdb performance monitoring
  - opentelemetry prometheus receiver cockroachdb
  - distributed sql metrics
  - cockroachdb observability
  - cockroachdb telemetry collection
---

# CockroachDB

CockroachDB is distributed, PostgreSQL-wire-compatible SQL, so if you already
run the [PostgreSQL receiver](./postgres.md) you know most of the SQL-layer
signals here. What you do not have a PostgreSQL analogue for is the distributed
machinery: node liveness, range replication health, and clock offset. Those
are the signals that page you when a multi-node cluster degrades, and they are
the reason this is a separate guide.

Each node exposes them in Prometheus format on its HTTP port `8080`.
CockroachDB serves two Prometheus-compatible endpoints, `/_status/vars` and
a newer `/metrics` (in preview). This guide scrapes `/_status/vars` because
the per-operation names below (for example `sql_select_count`) come from it,
whereas `/metrics` consolidates them under labels. There is no native
CockroachDB receiver and no `pg_stat` views in play - the OpenTelemetry
Collector's `prometheus` receiver scrapes each node's endpoint directly.
CockroachDB emits 2,400+ distinct metric names this way (`sql_*`,
`liveness_*`, `ranges*`, `capacity_*`, `clock_offset_*`, and large internal
families), all un-prefixed and multi-namespaced. This guide configures the
receiver and ships the metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| CockroachDB            | 23.1    | 26.2+       |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- Each CockroachDB node's HTTP port (`8080`) must be reachable from the host
  running the Collector.
- No SQL monitoring user is required - the Prometheus endpoint is plain HTTP
  (see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. Every series carries a `node_id` label; range and capacity series also
carry `store`.

The tiers below lead with the distributed signals that have no PostgreSQL
counterpart - liveness, range replication, and clock health - then cover the
familiar SQL throughput and latency series.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `liveness_livenodes` | Live nodes the cluster sees; equals the node count when healthy. Distributed signal with no PostgreSQL analogue. |
| `sql_query_count` | Total SQL queries served - the headline throughput KPI. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `liveness_heartbeatfailures` | Failed node-liveness heartbeats; rising means a node is struggling to stay in the cluster. Distributed signal. |
| `ranges_underreplicated` | Ranges below their replication target; should sit at 0 in a healthy cluster. Distributed signal. |
| `ranges_unavailable` | Ranges with no quorum; greater than 0 means data is unavailable. Distributed signal. |
| `clock_offset_meannanos` | Mean clock offset versus peers; a node self-terminates once its offset against a majority of peers passes ~80% of the cluster max-offset (≈400ms at the 500ms default). Distributed signal. |
| `sql_query_count` | Throughput; a sustained drop toward 0 under expected load means SQL serving stalled. |
| `sql_service_latency` | SQL service latency distribution (histogram) - the latency SLI. |
| `sql_conns` | Open SQL connections - a saturation signal. |
| `capacity_available` | Available store capacity per node. |

### Diagnostic - for investigation and tuning

Higher cardinality - per-statement throughput, transaction internals,
replication queues, and the large engine families. Enable on demand; in
production you can drop this tier with a `metric_relabel_configs` block while
keeping Core + Operational.

| Metric | What it tells you |
|---|---|
| `sql_select_count`, `sql_insert_count`, `sql_update_count`, `sql_delete_count` | Per-statement throughput by operation. |
| `sql_txn_begin_count`, `sql_txn_commit_count`, `sql_txn_abort_count` | Transaction outcomes; aborts signal contention or app errors. |
| `sql_txn_latency`, `sql_exec_latency` | Transaction and execution latency distributions. |
| `sql_distsql_queries_active`, `sql_failure_count`, `sql_new_conns` | Distributed-SQL activity, failed statements, new-connection rate. |
| `ranges`, `ranges_overreplicated`, `replicas`, `replicas_leaders`, `replicas_leaseholders` | Replication and lease placement across stores. |
| `leases_success`, `leases_error`, `range_splits`, `rebalancing_queriespersecond` | Lease transfers, range splits, and rebalancing pressure. |
| `sys_cpu_combined_percent_normalized`, `sys_rss`, `sys_uptime` | Per-node CPU, memory, and uptime. |
| `capacity_used`, `liveness_heartbeatlatency` | Store fill and heartbeat round-trip time. |

The long diagnostic tail groups into internal families: `admission_*` (409
names, CPU/IO/KV admission control), `jobs_*` (381, background jobs),
`sql_*` (291, the full SQL layer), `storage_*` (182, storage engine),
`distsender_*` (142, DistSender RPC batches), `kv_*` (113), `queue_*` (108,
replica queues), `changefeed_*` (88, CDC), `raft_*` (70, consensus),
`rpc_*` (68), `sys_*` (58), `txn_*` (46, transaction coordinator),
`schedules_*` (23), `rocksdb_*` (17, Pebble/RocksDB), and `tenant_*` (13,
multi-tenancy). Each `sql_*` user-facing counter also has a `_internal`
sibling (for example `sql_query_count_internal`) covering CockroachDB's own
internal queries.

Full metric reference:
[CockroachDB monitoring and alerting](https://www.cockroachlabs.com/docs/stable/monitoring-and-alerting),
or `curl -s http://localhost:8080/_status/vars` against any node.

## Key Alerts to Configure

Threshold guidance for the most useful Core- and Operational-tier series. Tune
to your workload and cluster size; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `liveness_livenodes` | < node count | Falling further | A node is down or partitioned; investigate the missing node before quorum is at risk. |
| `rate(sql_query_count)` | Dipping vs baseline | ≈ 0 sustained under expected load | SQL serving has stalled; check the SQL layer and node health. |
| `ranges_underreplicated` | > 0 | > 0 sustained | Replication is not converging; the cluster cannot restore the replication target. |
| `ranges_unavailable` | > 0 | > 0 | Data is unavailable - one or more ranges lost quorum. |
| `clock_offset_meannanos` | > 40% of `--max-offset` | ≈ 80% of `--max-offset` (≈400ms / 4e8 ns at default) | Clock skew risk; a node self-terminates when its offset against a majority of peers exceeds ~80% of `--max-offset`. |
| `capacity_available` | Falling toward a floor | < a small fraction of `capacity_available + capacity_used` | The store is filling; scale storage before writes start failing. |

## Access Setup

CockroachDB needs no SQL monitoring user for metrics. Unlike the PostgreSQL
receiver - which connects over the SQL wire protocol with a `pg_monitor`-role
account - CockroachDB's `prometheus` endpoint is plain HTTP. "Access setup"
here means exposing each node's HTTP port (`8080`) to the Collector.

Every node serves its own metrics, so the Collector scrapes each node, not a
single load-balanced endpoint - the per-node `node_id` series is exactly what
the liveness and range tiers depend on.

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
services:
  roach1:
    image: cockroachdb/cockroach:v26.2.2
    command: start --join=roach1,roach2,roach3 --advertise-addr=roach1
    ports:
      - "8080:8080"     # DB Console + /_status/vars
      - "26257:26257"   # SQL

  roach2:
    image: cockroachdb/cockroach:v26.2.2
    command: start --join=roach1,roach2,roach3 --advertise-addr=roach2

  roach3:
    image: cockroachdb/cockroach:v26.2.2
    command: start --join=roach1,roach2,roach3 --advertise-addr=roach3
```

On a secure cluster (`--certs-dir`), the HTTP endpoint serves over `https`.
Expose it to the Collector over a trusted network path - the metrics carry no
secrets, but the endpoint should not be public. The scrape config below uses
`http`; switch the scheme to `https` and supply `tls` settings when the cluster
is secure.

Verify the endpoint serves metrics:

```bash showLineNumbers title="Verify access"
# Each node exposes its own metrics at /_status/vars on port 8080
curl -s http://localhost:8080/_status/vars | grep -E '^liveness_livenodes|^sql_query_count'
```

## Configuration

CockroachDB serves metrics at the non-default `/_status/vars` path, so set
`metrics_path` explicitly and list every node as a scrape target. Each node
returns its own series, tagged with `node_id`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cockroachdb
          scrape_interval: 15s
          metrics_path: /_status/vars        # Not the default /metrics
          static_configs:
            - targets:
                - roach1:8080                 # Each CockroachDB node's HTTP port
                - roach2:8080
                - roach3:8080

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
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

CockroachDB's `/_status/vars` is whitelist-free - the receiver delivers the
full 2,400+ metric surface with no filter. To control metric volume in
production, drop the Diagnostic tier with a `metric_relabel_configs` block on
the scrape config while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute. Scout's UI filters on the lowercase `environment` key, so emit
> it alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped CockroachDB metrics
docker logs otel-collector 2>&1 | grep -iE "sql_query_count|liveness_livenodes"

# Confirm a node is serving metrics on its HTTP endpoint
curl -s http://localhost:8080/_status/vars | grep -E '^sql_query_count'
```

Several SQL counters only move once the cluster does work. Drive some load and
confirm `sql_query_count` rises and `liveness_livenodes` equals your node
count:

```bash showLineNumbers title="Generate SQL load"
# Built-in kv load generator against the cluster (~40 reads/s, ~10 writes/s)
cockroach workload init kv "postgresql://root@localhost:26257?sslmode=disable"
cockroach workload run kv --max-rate=50 --read-percent=80 \
  "postgresql://root@localhost:26257?sslmode=disable"
```

The load generator connects over the SQL port (`26257`); on a secure cluster
supply certs and use the secure SQL endpoint. This is separate from the
cert-free metrics scrape on port `8080`.

## Troubleshooting

### No CockroachDB metrics in the Collector

**Cause**: The Collector cannot reach a node's HTTP endpoint, or the scrape
path is wrong.

**Fix**:

1. Confirm the nodes are running and joined: `cockroach node status`.
2. Verify each target's host and port (`8080`) match the scrape config.
3. Confirm `metrics_path` is set to `/_status/vars`. The receiver defaults to
   `/metrics`; CockroachDB also serves `/metrics`, but with different,
   label-based metric names, so the default scrapes a surface that does not
   match the tiers in this guide.

### Metric name present but no datapoints

**Cause**: The cluster is idle, so the SQL counters have not moved since the
last scrape.

**Look at**: `sql_query_count` (should rise under load) and `sql_conns` (open
connections). `liveness_livenodes` should equal your node count even when
idle.

**Fix**:

1. Run SQL against the cluster - the built-in `cockroach workload run kv`
   generator is the quickest way - and re-check.

### A node dropped out of the cluster

**Cause**: A node failed its liveness heartbeats or self-terminated on clock
skew.

**Look at**: `liveness_heartbeatfailures` (rising means a node is struggling
to stay live) and the Diagnostic `liveness_heartbeatlatency` for the heartbeat
round-trip. `clock_offset_meannanos` approaching the cluster max-offset means
the node will remove itself to preserve consistency - check NTP/chrony on that
host.

**Fix**:

1. Restore network reachability or restart the node, then confirm
   `liveness_livenodes` returns to the node count.
2. Fix clock sync on the affected host if `clock_offset_meannanos` is high.

### Ranges stay under-replicated or unavailable

**Cause**: A node is down long enough that replicas cannot meet the
replication target, or a range has lost quorum.

**Look at**: `ranges_underreplicated` (not converging back to 0) and
`ranges_unavailable` (greater than 0 means data is unavailable). The
Diagnostic `replicas_leaseholders`, `leases_error`, and
`rebalancing_queriespersecond` show whether the cluster is actively
re-replicating.

**Fix**:

1. Bring the missing node back or add capacity so the cluster can restore the
   replication target.
2. If `ranges_unavailable` is greater than 0, recover or replace the nodes
   holding the affected ranges - quorum must be restored before the data is
   readable.

### No metrics appearing in Scout

**Cause**: Metrics are scraped but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `prometheus` receiver and the
   `otlphttp/b14` exporter.

## FAQ

### Which port and path does CockroachDB use for metrics?

Each node serves Prometheus-format metrics on its HTTP port `8080`. CockroachDB
exposes both `/_status/vars` and a newer `/metrics`; this guide uses
`/_status/vars`, so set `metrics_path: /_status/vars` in the scrape job (the
receiver would otherwise default to `/metrics`). No SQL login is involved - the
endpoint is HTTP, not the SQL wire protocol.

### Do I need a monitoring user like the PostgreSQL `pg_monitor` role?

No. Unlike the PostgreSQL receiver, which connects over the SQL wire protocol
with a `pg_monitor`-role account, CockroachDB's Prometheus endpoint is plain
HTTP and needs no SQL credentials. Access setup is exposing the HTTP port
(`8080`) to the Collector.

### How do I monitor all the nodes in a cluster?

Add every node's `host:8080` to the scrape job's `static_configs.targets`.
Each node serves only its own series, tagged with `node_id`, so scraping each
node is what makes the per-node liveness and range tiers work. Do not scrape a
single load-balanced endpoint - you would lose per-node visibility.

### What does `liveness_livenodes` report in CockroachDB?

The number of nodes the cluster currently considers live. In a healthy cluster
it equals the total node count; a drop signals a node the cluster can no longer
reach. PostgreSQL has no analogue - this is a distributed-cluster signal.

### Why monitor `clock_offset_meannanos` in CockroachDB?

CockroachDB relies on loosely-synchronized clocks. If a node's offset against
a majority of its peers exceeds ~80% of the cluster max-offset (≈400ms at the
500ms / 5e8 ns default), the node removes itself to preserve consistency.
Tracking this metric warns you before that happens.

## Related Guides

- [PostgreSQL Monitoring](./postgres.md) - The single-node PostgreSQL
  counterpart; the SQL-layer signals here mirror its receiver, and this guide
  is the distributed delta on it (liveness, ranges, clock offset).
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on node liveness and clock skew.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `metric_relabel_configs` block to control volume; keep it available for
  incident investigation.
