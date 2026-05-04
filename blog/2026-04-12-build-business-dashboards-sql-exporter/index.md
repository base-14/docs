---
slug: build-business-dashboards-sql-exporter
date: 2026-04-12
title: >
  Build Business Dashboards from Your Database
  Without Writing a Custom Exporter
description: >
  Use sql_exporter to turn any SQL query into a
  Prometheus metric and build business dashboards
  from your existing database.
authors: [nitin]
unlisted: true
tags:
  - sql_exporter
  - prometheus
  - grafana
  - business-metrics
  - observability
  - postgresql
  - mysql
  - dashboards
---

The data your business cares about most,
order backlogs, signup rates, SLA compliance,
revenue by region, already lives in your database.
Every table in your PostgreSQL or MySQL instance
is a potential dashboard panel. The problem is
that your monitoring stack speaks Prometheus
metrics, and your database does not.

Most teams bridge this gap with cron jobs that run
queries and push results to a time-series database,
or with custom Python scripts that expose an HTTP
endpoint. These solutions work on day one.
By month six, the script has drifted out of sync
with the schema, nobody remembers which EC2
instance it runs on, and the alerts it feeds have
quietly stopped firing.

There is a better way.
[sql_exporter](https://github.com/burningalchemist/sql_exporter)
is an open-source, configuration-driven Prometheus
exporter that runs SQL queries against your database
and exposes the results as standard Prometheus
metrics. No code to maintain, no custom containers
to build, no drift between your schema and your
dashboards.

<!--truncate-->

## Operational metrics vs. business metrics

If you run PostgreSQL, you probably already have
`postgres_exporter` collecting internal database
metrics: active connections, replication lag,
transaction rates, cache hit ratios. MySQL users
have `mysqld_exporter` doing the same. These
exporters are essential for keeping your database
healthy.

But they cannot answer business questions like these:

* How many orders are stuck in pending?
* When was our pricing feed
last updated?
* What percentage of API requests met our SLA target
this hour?

These questions require querying your application tables,
and that is exactly what database-specific exporters
do not do.

The typical workaround is a custom script.
A Python process runs a query every minute, formats
the result, and serves it on a `/metrics` endpoint.
This works, but it means maintaining application
code for what is fundamentally a configuration
problem. Each new metric requires a code change,
a deploy, and a review cycle. The query lives in a
`.py` file instead of a `.yml` file, and the
operational overhead of running another service
adds up fast.

## sql_exporter: any SELECT becomes a metric

sql_exporter takes a different approach. You write
a YAML configuration that defines your database
connection, the SQL queries to run, and how to map
the result columns to Prometheus metric names and
labels. The exporter runs these queries on each
scrape and serves the results on a standard
`/metrics` endpoint.

It supports PostgreSQL, MySQL, Microsoft SQL
Server, Oracle, ClickHouse, Snowflake, and any
database with a Go SQL driver. The configuration
has three layers:

* **Target**: the database connection string (DSN)
  and which collectors to run against it
* **Collector**: a named group of related metrics,
  with an optional `min_interval` to control how
  often queries run
* **Metric**: the Prometheus metric name, type,
  labels, and the SQL query that produces the data

Here is a minimal example that counts active users
from a PostgreSQL database:

```yaml title="sql_exporter.yml" showLineNumbers
global:
  scrape_timeout_offset: 500ms
  min_interval: 0s
  max_connections: 3

target:
  data_source_name: "postgresql://exporter:${DB_PASSWORD}@db-primary:5432/app?sslmode=require"
  collectors:
    - active_users

collectors:
  - collector_name: active_users
    metrics:
      - metric_name: app_active_users_total
        type: gauge
        help: "Number of users active in the last 24 hours"
        values: [active_count]
        query: |
          SELECT COUNT(*) AS active_count
          FROM users
          WHERE last_seen_at > NOW() - INTERVAL '24 hours'
```

When Prometheus scrapes this exporter, it gets
back:

```text
# HELP app_active_users_total Number of users active in the last 24 hours
# TYPE app_active_users_total gauge
app_active_users_total 4827
```

That is the entire setup. No application code,
no build step, no container image to maintain.

## Three scenarios where this becomes useful

The single-metric example above is simple enough to
be a cron job. The value of sql_exporter becomes
clearer when you have multiple metrics across
different tables, each with their own labels and
query cadence.

### Data freshness monitoring

Stale data is one of the most common silent
failures in production systems. An ETL pipeline
stops running, a pricing feed goes down, or a sync
job starts failing silently. The data in the table
looks fine, it is just 6 hours old.

sql_exporter can monitor the age of your most
recent data and alert when it crosses a threshold:

```yaml title="collectors/data_freshness.collector.yml" showLineNumbers
collector_name: data_freshness
metrics:
  - metric_name: data_last_updated_unix
    type: gauge
    help: "Unix timestamp of the most recent row in each data feed"
    key_labels: [feed_name]
    values: [last_updated]
    query: |
      SELECT
        feed_name,
        EXTRACT(EPOCH FROM MAX(updated_at))::bigint AS last_updated
      FROM data_feeds
      GROUP BY feed_name
```

This produces a metric per feed:

```text
data_last_updated_unix{feed_name="pricing"} 1744444800
data_last_updated_unix{feed_name="inventory"} 1744441200
data_last_updated_unix{feed_name="exchange_rates"} 1744438800
```

A Prometheus alerting rule can then fire when any
feed is older than expected:

```yaml title="alerts/data_freshness.yml" showLineNumbers
groups:
  - name: data_freshness
    rules:
      - alert: StaleDataFeed
        expr: time() - data_last_updated_unix > 3600
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: >-
            Data feed {{ $labels.feed_name }}
            has not been updated in over 1 hour
```

This replaces an entire class of "is our data
still fresh?" checks that teams often build into
application code or run as standalone monitoring
scripts.

### Order backlog tracking

For e-commerce and marketplace teams, the shape of
your order pipeline is a core business metric. How
many orders are pending fulfillment? How many are
stuck in payment processing? How quickly is the
backlog growing?

A MySQL example:

```yaml title="collectors/order_backlog.collector.yml" showLineNumbers
collector_name: order_backlog
min_interval: 30s
metrics:
  - metric_name: orders_by_status_total
    type: gauge
    help: "Number of orders in each status"
    key_labels: [status, region]
    values: [order_count]
    query: |
      SELECT
        status,
        region,
        COUNT(*) AS order_count
      FROM orders
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY status, region
```

The `min_interval: 30s` setting ensures the query
runs at most once every 30 seconds, even if
Prometheus scrapes more frequently. This is
important for queries that scan large tables.

In Grafana, you can build a stacked bar chart from
this metric grouped by status, giving operations
teams a real-time view of the order pipeline
without any custom application code.

### SLA compliance from application logs

If your application writes request logs to a
database table (common in regulated industries
where log retention requirements exist), you can
compute SLA compliance directly from that data:

```yaml title="collectors/sla_compliance.collector.yml" showLineNumbers
collector_name: sla_compliance
min_interval: 60s
metrics:
  - metric_name: requests_within_sla_ratio
    type: gauge
    help: "Ratio of requests meeting the 500ms SLA target in the last hour"
    key_labels: [service_name]
    values: [sla_ratio]
    query: |
      SELECT
        service_name,
        ROUND(
          COUNT(*) FILTER (WHERE duration_ms <= 500)::numeric
          / GREATEST(COUNT(*), 1),
          4
        ) AS sla_ratio
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY service_name
```

This gives you a per-service SLA compliance ratio
that updates every 60 seconds. Pair it with a
Grafana gauge panel and a Prometheus alert at the
0.95 threshold, and you have SLA monitoring built
entirely from data you already collect.

## Wiring it into your dashboard pipeline

sql_exporter serves metrics on port 9399 by
default. Getting those metrics into your dashboards
requires connecting it to your existing monitoring
stack.

### Prometheus scrape configuration

The most common setup is a direct Prometheus
scrape:

```yaml title="prometheus.yml" showLineNumbers
scrape_configs:
  - job_name: sql_exporter
    scrape_interval: 60s
    static_configs:
      - targets: ["sql-exporter:9399"]
```

A 60-second scrape interval is a reasonable
default. Match it to your fastest `min_interval`
setting, there is no benefit in scraping more
frequently than your queries run.

### OpenTelemetry Collector alternative

If your infrastructure already runs the
OpenTelemetry Collector, you can scrape
sql_exporter through the Collector's prometheus
receiver instead of running a separate Prometheus
instance:

```yaml title="otel-collector-config.yaml" showLineNumbers
receivers:
  prometheus/sql:
    config:
      scrape_configs:
        - job_name: sql_exporter
          scrape_interval: 60s
          static_configs:
            - targets: ["sql-exporter:9399"]

exporters:
  prometheusremotewrite:
    endpoint: "https://your-metrics-backend/api/v1/write"

service:
  pipelines:
    metrics/sql:
      receivers: [prometheus/sql]
      exporters: [prometheusremotewrite]
```

This fits naturally into teams that have
standardized on OTel for all telemetry collection
and want a single pipeline for infrastructure,
application, and business metrics.

### Grafana dashboard

Once the metrics are in Prometheus (or any
Prometheus-compatible backend), building dashboard
panels is straightforward. A few useful PromQL
queries for the metrics defined above:

```promql
# Order backlog by status, summed across regions
sum by (status) (orders_by_status_total)

# Data freshness: minutes since last update per feed
(time() - data_last_updated_unix) / 60

# SLA compliance trend over the past 24 hours
requests_within_sla_ratio{service_name="checkout-api"}
```

### Alerting on business metrics

The real payoff is alerting. Once business data is
in Prometheus, you can define alerts with the same
tooling you use for infrastructure:

```yaml title="alerts/business.yml" showLineNumbers
groups:
  - name: business_metrics
    rules:
      - alert: HighPendingOrderBacklog
        expr: >-
          sum(orders_by_status_total{status="pending"}) > 500
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: >-
            Pending order backlog exceeds 500
            for over 10 minutes

      - alert: SLABreachRisk
        expr: requests_within_sla_ratio < 0.95
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: >-
            Service {{ $labels.service_name }}
            SLA compliance dropped below 95%
```

These alerts go through the same Alertmanager
routing as your infrastructure alerts, which means
they reach the same on-call channels, follow the
same escalation policies, and show up in the same
incident management tools.

## Operational considerations

Running sql_exporter in production requires some
care around performance and security.

### Query performance

Every Prometheus scrape triggers your SQL queries.
A slow query blocks the scrape until it completes
or times out. Keep queries fast by:

* Using `min_interval` to cache results for
  expensive queries. If a query takes 5 seconds to
  run, set `min_interval: 60s` so it runs at most
  once a minute regardless of scrape frequency.
* Adding appropriate indexes on the columns in your
  WHERE and GROUP BY clauses.
* Querying summary tables or materialized views
  instead of raw transaction tables where possible.
* Setting `max_connections` to a reasonable limit
  (default is 3) so the exporter does not consume a
  large share of your database connection pool.

### Credential management

sql_exporter supports environment variable
substitution in the DSN string. In Kubernetes,
inject the password from a Secret:

```yaml title="deployment.yaml"
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: password
```

The DSN in your config then references
`${DB_PASSWORD}`. sql_exporter also supports AWS
Secrets Manager, GCP Secret Manager, and HashiCorp
Vault as secret backends for environments where
environment variables are not sufficient.

### Scaling to multiple databases

For teams with multiple databases (staging,
production, regional replicas), sql_exporter's jobs
mode lets you run the same collectors against
multiple targets:

```yaml title="sql_exporter.yml" showLineNumbers
jobs:
  - job_name: order_metrics
    collectors:
      - order_backlog
    static_configs:
      - targets:
          db-us-east: "postgresql://exporter:${DB_PASSWORD}@db-us-east:5432/app"
          db-eu-west: "postgresql://exporter:${DB_PASSWORD}@db-eu-west:5432/app"
        labels:
          env: production
```

Each target gets a `target` label in the resulting
metrics, so you can filter and aggregate by
database in your dashboards.

### Connection pooler compatibility

If your database sits behind a connection pooler
like PgBouncer (in transaction mode) or ProxySQL,
you may need to disable prepared statements:

```yaml
target:
  data_source_name: "postgresql://exporter:${DB_PASSWORD}@pgbouncer:6432/app"
  no_prepared_statement: true
```

Without this setting, the pooler may route the
PREPARE and EXECUTE statements to different backend
connections, causing query failures.

## When sql_exporter is the right fit

sql_exporter works well for metrics that are
naturally expressed as periodic snapshots of
database state: counts, sums, ratios, timestamps.
If you can write a SELECT that returns labels and
numbers, you can turn it into a dashboard panel.

It is less suited for event-driven metrics where
you need to count every individual occurrence in
real time (use application-level instrumentation
for that), or for high-cardinality data where a
single query returns thousands of unique label
combinations (Prometheus struggles with this
regardless of the exporter).

For the common case of "I want a dashboard that
shows business data from my database,"
sql_exporter removes the need for custom code
entirely. A YAML file, a container, and a
Prometheus scrape config give you the same result
as hundreds of lines of application code, with the
added benefit that your business metrics live
alongside your infrastructure metrics in the same
alerting and dashboarding system.
