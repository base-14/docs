---
title: >
  PgBouncer OpenTelemetry Monitoring - Pool Saturation, Client Wait,
  and Collector Setup
sidebar_label: PgBouncer
id: collecting-pgbouncer-telemetry
sidebar_position: 28
description: >
  Collect PgBouncer metrics with the OpenTelemetry Collector. Monitor pool
  saturation, client wait time, and query throughput via the pgbouncer_exporter
  and ship to base14 Scout.
keywords:
  - pgbouncer opentelemetry
  - pgbouncer otel collector
  - pgbouncer metrics monitoring
  - pgbouncer performance monitoring
  - opentelemetry prometheus receiver pgbouncer
  - pgbouncer observability
  - pgbouncer connection pooling monitoring
  - pgbouncer exporter prometheus
---

# PgBouncer

PgBouncer exposes its statistics only over its admin console; the
prometheuscommunity `pgbouncer_exporter` translates them to Prometheus on
`:9127`, and the OpenTelemetry Collector's `prometheus` receiver scrapes it.
This collects metrics across pool saturation and client wait, query and
transaction throughput, client and server connection counts against the
configured caps, and per-database limits, then ships them to base14 Scout.
PgBouncer has no native Prometheus endpoint and there is no `pgbouncerreceiver`
in collector-contrib, so the exporter is part of the pipeline. This guide
configures the exporter and the receiver, sets up admin-console access, and
ships metrics to Scout.

:::note Running this in production

pgX shows the queries holding the connections these pool metrics count.
[Check out base14 pgX](https://base14.io/scout/pgx).

:::

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ------------------------ |
| PgBouncer              | 1.x     | 1.25+ (e.g. 1.25.2)      |
| pgbouncer_exporter     | -       | 0.12+ (e.g. 0.12.0)      |
| OTel Collector Contrib | 0.90.0  | 0.153.0                  |
| base14 Scout           | Any     | -                        |

Before starting:

- PgBouncer must be reachable from the host running the exporter, over its
  admin console (the virtual `pgbouncer` database on the listen port, default
  `6432`).
- The exporter must be reachable from the host running the Collector, on
  `:9127`.
- A PgBouncer user listed in `stats_users` or `admin_users` (see
  [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review.

A few things shape how you read this surface:

- **Two liveness signals.** `up` (from the `prometheus` receiver) is 1 when the
  exporter's `/metrics` responds; `pgbouncer_up` is 1 when the exporter could
  reach PgBouncer's admin console. A healthy pipeline has both at 1. `up == 1`
  with `pgbouncer_up == 0` means the exporter is running but cannot talk to
  PgBouncer.
- **The exporter is required.** PgBouncer exposes stats only over its admin
  console; there is no native Prometheus endpoint and no dedicated collector
  receiver. The only pure-collector alternative is the `sqlqueryreceiver`
  pointed at the same admin console with hand-mapped `SHOW` queries (more
  config, custom metric names).
- **Pool exhaustion is the signal that matters.** When every server connection
  in a pool is busy, new clients queue: `pgbouncer_pools_client_waiting_connections`
  rises and `pgbouncer_pools_client_maxwait_seconds` grows. That wait is added
  latency on every query. Pool capacity is `pgbouncer_databases_pool_size`.
- **Pool mode shapes interpretation.** Server-connection reuse - and thus the
  idle / active server counts - differs across session, transaction, and
  statement mode.
- **Per-pool / per-database cardinality.** The `pgbouncer_pools_*` and
  `pgbouncer_databases_*` families are labeled by database and user, so series
  count scales with `#databases x #users`.
- **Admin access.** The exporter must authenticate as a user listed in
  PgBouncer's `stats_users` / `admin_users`; `SHOW STATS` needs stats access.

### Core - is it up, reachable, and serving

| Metric | What it tells you |
|---|---|
| `up` | Prometheus scrape liveness - 1 when the exporter's `/metrics` responded. |
| `pgbouncer_up` | 1 when the exporter reached PgBouncer's admin console - the PgBouncer liveness signal. |
| `pgbouncer_pools_client_waiting_connections` | Clients queued waiting for a server connection - pool exhaustion. |
| `pgbouncer_pools_client_maxwait_seconds` | Longest a client is currently waiting for a connection - exhaustion severity / added latency. |
| `pgbouncer_stats_totals_queries_pooled_total` | Queries routed through the pooler - headline throughput. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `pgbouncer_pools_client_active_connections` | Clients with an assigned server connection (actively served). |
| `pgbouncer_pools_server_active_connections` | Server connections currently executing client queries. |
| `pgbouncer_pools_server_idle_connections` | Idle server connections available to take work - 0 with waiting clients means saturation. |
| `pgbouncer_pools_server_used_connections` | Recently used server connections. |
| `pgbouncer_stats_totals_sql_transactions_pooled_total` | Transactions routed through the pooler. |
| `pgbouncer_stats_totals_queries_duration_seconds_total` | Cumulative query time - average latency is its rate over `queries_pooled`. |
| `pgbouncer_stats_totals_client_wait_seconds_total` | Cumulative time clients spent waiting for a connection. |
| `pgbouncer_stats_totals_received_bytes_total` | Bytes received from clients. |
| `pgbouncer_stats_totals_sent_bytes_total` | Bytes sent to clients. |
| `pgbouncer_client_connections` | Total client connections to PgBouncer. |
| `pgbouncer_config_max_client_connections` | `max_client_conn` - the global client-connection ceiling. |
| `pgbouncer_databases_current_connections` | Current server connections per database. |
| `pgbouncer_databases_max_connections` | Configured per-database connection limit. |
| `pgbouncer_databases_pool_size` | Configured pool size per database - the saturation denominator. |
| `pgbouncer_databases_paused` | 1 when the database is paused (clients cannot connect). |
| `pgbouncer_free_servers` | Free server-connection slots. |
| `pgbouncer_used_servers` | Used server-connection slots. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity review.
Grouped, not exhaustive - see the upstream reference for the full list.

| Group | Representative metrics | When you reach for it |
|---|---|---|
| Prepared-statement counters | `pgbouncer_stats_totals_binds_total`, `pgbouncer_stats_totals_client_parses_total`, `pgbouncer_stats_totals_server_parses_total` | Prepared-statement parse / bind volume; these are newer SHOW STATS columns. |
| Server-connection lifecycle | `pgbouncer_pools_server_login_connections`, `pgbouncer_pools_server_testing_connections`, `pgbouncer_pools_server_being_canceled_connections` | Backends stuck in login / testing / cancel transitions. |
| Cancel requests | `pgbouncer_pools_client_active_cancel_connections`, `pgbouncer_pools_client_waiting_cancel_connections` | Cancellation activity during query cancels. |
| Pool / database / user counts | `pgbouncer_pools`, `pgbouncer_databases`, `pgbouncer_users` | Topology size as you add databases and users. |
| DNS cache | `pgbouncer_cached_dns_names`, `pgbouncer_in_flight_dns_queries` | Backend-host resolution when PgBouncer resolves by DNS. |
| Version / build info | `pgbouncer_version_info`, `pgbouncer_exporter_build_info` | The running PgBouncer and exporter versions. |
| Exporter handler stats | `promhttp_metric_handler_requests_total` | The exporter's own `/metrics` handler. |
| Runtime / scrape meta | `go_*`, `process_*`, `scrape_duration_seconds` | Exporter Go-runtime and Prometheus scrape housekeeping series. |

Full metric reference:
[pgbouncer_exporter](https://github.com/prometheus-community/pgbouncer_exporter#metrics),
or run `curl -s http://localhost:9127/metrics` against the exporter.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `up` | - | `== 0` for > 1m | No PgBouncer metrics are arriving - check the exporter container. |
| `pgbouncer_up` | - | `== 0` for > 1m | The exporter is up but cannot reach PgBouncer's admin console - check PgBouncer and the stats user. |
| `pgbouncer_pools_client_waiting_connections` | `> 0` sustained | Rising across scrapes | Clients are queuing for server connections - raise the pool size or fix slow queries holding connections. |
| `pgbouncer_pools_client_maxwait_seconds` | `>` a few seconds | Growing | A client has waited too long for a connection; the pool is saturated and latency is added to every query. |
| `pgbouncer_client_connections / pgbouncer_config_max_client_connections` | `> 0.9` | Approaching 1.0 | Approaching `max_client_conn` - new clients will be refused; raise the cap or shed load. |
| `pgbouncer_databases_current_connections` vs `pgbouncer_databases_max_connections` | Approaching the limit | At the limit | A database has reached its connection limit. |
| `pgbouncer_databases_paused` | - | `== 1` | A database is paused - clients cannot connect (maintenance or blocked). |
| `pgbouncer_pools_server_idle_connections` | - | `== 0` with waiting clients `> 0` | Every backend is busy - the pool or the backend is the bottleneck. |

The `max_client_conn` ratio compares the live client count against PgBouncer's
own configured cap (`pgbouncer_config_max_client_connections`), not an invented
absolute. The maxwait threshold is small fixed wait-time guidance - any client
that has waited several seconds for a connection is on a saturated pool.

## Access Setup

PgBouncer exposes statistics only over its admin console - the virtual
`pgbouncer` database on the listen port (default `6432`). The exporter
authenticates there as a stats user and runs the `SHOW` commands.

### 1. Create a monitoring user

Add the exporter's connecting user to `stats_users` in `pgbouncer.ini`:

```ini showLineNumbers title="pgbouncer.ini"
[pgbouncer]
stats_users = otel_monitor
ignore_startup_parameters = extra_float_digits
```

- `stats_users` grants read-only access to the `SHOW` commands the exporter
  runs (`SHOW STATS`, `SHOW POOLS`, `SHOW DATABASES`, `SHOW LISTS`). A user in
  `admin_users` also works.
- `ignore_startup_parameters` is required because the exporter's PostgreSQL
  driver sends `extra_float_digits` during connection startup, which PgBouncer
  rejects by default.

### 2. Add authentication

Add the monitoring user to `userlist.txt`:

```text showLineNumbers title="userlist.txt"
"otel_monitor" "your_password"
```

### 3. Verify access

Confirm the user can read stats over the admin console:

```bash showLineNumbers title="Verify admin-console access"
psql -p 6432 pgbouncer -c 'SHOW STATS;'
# or with an explicit connection string:
psql "postgres://otel_monitor:your_password@localhost:6432/pgbouncer?sslmode=disable" \
  -c 'SHOW STATS;'
```

No write permissions are needed. The exporter only reads pool and traffic
statistics.

## Configuration

### pgbouncer_exporter

Run the exporter alongside PgBouncer. Its connection string points at
PgBouncer's admin console - the virtual `pgbouncer` database on the listen port
(default `6432`):

```bash showLineNumbers title="Run pgbouncer_exporter"
docker run -d \
  --name pgbouncer-exporter \
  -p 9127:9127 \
  prometheuscommunity/pgbouncer-exporter \
  --pgBouncer.connectionString="postgres://${PGBOUNCER_USER}:${PGBOUNCER_PASSWORD}@${PGBOUNCER_HOST}:6432/pgbouncer?sslmode=disable"
```

The exporter listens on `:9127` and serves the `pgbouncer_*` metrics at
`/metrics`.

### OTel Collector

The `prometheus` receiver scrapes the exporter. The keep filter scopes
collection to the PgBouncer surface and the scrape-liveness series, dropping
the exporter's own `go_*` / `process_*` / `promhttp_*` runtime metrics:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pgbouncer
          scrape_interval: 10s
          static_configs:
            - targets:
                - ${env:PGBOUNCER_EXPORTER_HOST}:9127
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'pgbouncer_.*|up'
              action: keep

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
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable as of v1.41.0). Scout's UI
> filters on the lowercase `environment` key, so emit it alongside the
> OTel-native `deployment.environment.name`. The legacy `deployment.environment`
> is still accepted for backward compatibility.

To keep more or fewer series, adjust the `regex` in `metric_relabel_configs`.
Dropping the keep filter entirely sends the exporter's runtime and scrape-meta
metrics too.

### Environment Variables

```bash showLineNumbers title=".env"
PGBOUNCER_HOST=pgbouncer
PGBOUNCER_USER=otel_monitor
PGBOUNCER_PASSWORD=your_password
PGBOUNCER_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the exporter and Collector, then check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the admin console answers
psql -p 6432 pgbouncer -c 'SHOW STATS'

# Confirm the exporter is serving metrics and reached PgBouncer
curl -s http://localhost:9127/metrics | grep pgbouncer_up
# Expected: pgbouncer_up 1

# Check Collector logs for the scraped PgBouncer metrics
docker logs otel-collector 2>&1 | grep -i "pgbouncer"
```

A healthy pipeline shows both `up` and `pgbouncer_up` at 1.

## Troubleshooting

### `pgbouncer_up` is 0

**Cause**: The exporter is running but cannot reach PgBouncer's admin console.

**Look at**: `up` is 1 (the exporter scrape works) while `pgbouncer_up` is 0
(the exporter cannot talk to PgBouncer).

**Fix**:

1. Check the exporter's connection string - host, port `6432`, and the virtual
   `pgbouncer` database.
2. Test the admin console manually:

   ```bash showLineNumbers title="Test the admin console"
   psql "postgres://otel_monitor:your_password@localhost:6432/pgbouncer?sslmode=disable" \
     -c 'SHOW STATS'
   ```

3. Confirm the connecting user is listed in `stats_users` or `admin_users` in
   `pgbouncer.ini`.
4. Confirm `ignore_startup_parameters` includes `extra_float_digits`.

### `up` is 0

**Cause**: The exporter container is down or unreachable from the Collector.

**Fix**:

1. Verify the exporter is running: `docker ps | grep pgbouncer-exporter`.
2. Confirm `:9127` is reachable: `curl http://localhost:9127/metrics`.
3. Check firewall rules if the Collector runs on a separate host.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

### Server connection counts read differently than expected

**Cause**: Interpretation depends on the pool mode. Server-connection reuse,
and thus the idle / active server counts, differs across session, transaction,
and statement mode.

**Look at**: the Diagnostic server-lifecycle series
(`pgbouncer_pools_server_login_connections`,
`pgbouncer_pools_server_testing_connections`) alongside
`pgbouncer_pools_server_idle_connections` and `_active_connections` to see
where backends sit.

**Fix**:

1. Confirm the pool mode for the database (`SHOW DATABASES` /
   `pgbouncer.ini`).
2. Read idle / active counts against that mode - session mode pins a backend
   per client for the whole session; transaction mode returns it between
   transactions.

## FAQ

**Why do I need a separate exporter?**

PgBouncer exposes its statistics only over its admin console, not over HTTP,
and there is no `pgbouncerreceiver` in collector-contrib. The
`pgbouncer_exporter` connects to the admin console, runs `SHOW STATS` /
`SHOW POOLS` / `SHOW DATABASES` / `SHOW LISTS`, and exposes `pgbouncer_*` in
Prometheus format. The only pure-collector alternative is the
`sqlqueryreceiver` pointed at the same admin console with hand-mapped `SHOW`
queries (more config, custom metric names).

**What is the difference between `up` and `pgbouncer_up`?**

There are two liveness signals. `up` comes from the `prometheus` receiver and
is 1 when the exporter's `/metrics` responded. `pgbouncer_up` comes from the
exporter and is 1 when it could reach PgBouncer's admin console. Both at 1 is
healthy; `up == 1` with `pgbouncer_up == 0` means the exporter is running but
cannot talk to PgBouncer.

**Does this work with PgBouncer in Kubernetes?**

Yes. Run the `pgbouncer_exporter` as a sidecar in the same pod as PgBouncer,
with its connection string pointed at the admin console on `localhost:6432`
since both containers share the pod network. Supply the stats-user credentials
via a Kubernetes secret. Point the Collector's scrape target at the pod IP or a
headless service on `:9127`.

**What pool mode should I use, and does it change monitoring?**

The exporter works with all pool modes (`session`, `transaction`, `statement`).
Pool mode does not change the monitoring interface - the exporter reads the
admin console regardless - but it changes how to read the server-connection
counts, because backend reuse differs across the modes.

**How do I monitor multiple databases or PgBouncer instances?**

The `pgbouncer_pools_*` and `pgbouncer_databases_*` families are labeled by
database and user, so series multiply with `#databases x #users` on one
instance. For multiple PgBouncer instances, run one exporter per instance and
add each as a scrape target; the `instance` label differentiates them:

```yaml showLineNumbers title="config/otel-collector.yaml (multiple instances)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pgbouncer
          scrape_interval: 10s
          static_configs:
            - targets:
                - pgbouncer-exporter-1:9127
                - pgbouncer-exporter-2:9127
```

**Why are some `pgbouncer_stats_totals_*` metrics missing?**

The `pgbouncer_stats_totals_*` set reflects PgBouncer's `SHOW STATS` columns,
and the prepared-statement parse / bind counters are newer columns. Older
PgBouncer versions expose fewer of them - what you see depends on the PgBouncer
version, not the exporter.

## Related Guides

- [PostgreSQL Monitoring](./postgres.md) - Monitor the PostgreSQL backend
  PgBouncer pools in front of.
- [HAProxy Monitoring](./haproxy.md) - Another exporter-fronted Prometheus
  surface in the data path.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Run
  the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [PostgreSQL](./postgres.md), [HAProxy](./haproxy.md), and other components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your pool churn,
  and widen or narrow the keep filter to the series you want to retain.
