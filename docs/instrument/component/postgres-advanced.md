---
title: >
  PostgreSQL Advanced OpenTelemetry Monitoring with pgdashex — Query Stats,
  Replication, and Table Metrics
sidebar_label: PostgreSQL Advanced
id: collecting-postgres-advanced-telemetry
sidebar_position: 2
description: >
  Advanced PostgreSQL monitoring with pgdashex. Collect query statistics,
  table/index metrics, replication status, and lock information using the
  Prometheus receiver and export to base14 Scout.
keywords:
  - postgresql advanced monitoring
  - pgdashex opentelemetry
  - postgresql query statistics
  - postgresql replication monitoring
  - opentelemetry postgresql metrics
  - postgres performance monitoring
  - postgresql table metrics
  - pgdashex prometheus
---

# PostgreSQL Advanced

Pgdashex is a PostgreSQL monitoring agent that collects comprehensive
database metrics across 17 metric groups — including query statistics,
table/index sizes, replication lag, lock activity, and background writer
stats — and exposes them in Prometheus format. This guide deploys pgdashex,
configures the OTel Collector to scrape its metrics, and ships them to
base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| PostgreSQL             | 9.6     | 14+         |
| pgdashex               | v0.5.10 | v0.5.10     |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | —           |

Before starting:

- PostgreSQL must be accessible from the host running pgdashex
- Superuser access for initial monitoring user creation
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Core**: connections, transactions, database size, backends
- **Tables & Indexes**: table/index sizes, usage stats, sequence info
- **Queries**: query performance via `pg_stat_statements`
- **Replication**: lag, status, publications, subscriptions
- **Locks & Vacuum**: lock statistics, vacuum/analyze progress
- **System**: configuration settings, extensions, roles, tablespaces

Full metric groups listed in [Configuration](#metric-groups) below.

## Access Setup

Create a dedicated PostgreSQL user with monitoring privileges:

```sql showLineNumbers
-- Connect as superuser (postgres)
CREATE USER pgdashex_monitor WITH ENCRYPTED PASSWORD '<strong_password>';

GRANT pg_monitor TO pgdashex_monitor;

-- Enable query statistics per database
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

> **Note**: Learn more about these predefined roles:
> [PostgreSQL Predefined Roles Documentation](https://www.postgresql.org/docs/current/predefined-roles.html)
>
> **Note**: The `pg_stat_statements` extension tracks query execution
> statistics and helps identify slow-running queries. Learn how to configure it:
> [pg_stat_statements Documentation](https://www.postgresql.org/docs/current/pgstatstatements.html)

Test the connection:

```bash showLineNumbers
psql -h <postgres-host> -p 5432 -U pgdashex_user -d postgres -c "SELECT version();"
```

## Docker Image Information

### Image Details

- **Image Name**: `base14/pgdashex`
- **Image Tag**: `base14/pgdashex:v0.5.10`

### Exposed Ports

| Port | Protocol | Description |
|------|----------|-------------|
| `9187` | HTTP | Prometheus metrics endpoint |

### Quick Start

Pull and run the Docker image:

```bash showLineNumbers
docker pull base14/pgdashex:v0.5.10

docker run -d \
  --name pgdashex \
  -p 9187:9187 \
  -e PG_HOST=your-postgres-host \
  -e PG_PORT=5432 \
  -e PG_USER=pgdashex_user \
  -e PG_PASSWORD='your_secure_password' \
  -e PG_DATABASE=postgres \
  -e PGDASHEX_COLLECT_METRICS=all \
  base14/pgdashex:v0.5.10
```

**Note**: If PostgreSQL is on the host machine, use `host.docker.internal` as
PG_HOST (Docker Desktop) or `--network host` (Linux).

### Example Docker Compose

```yaml showLineNumbers title="docker-compose.yaml"
version: '3.8'

services:
  pgdashex:
    image: base14/pgdashex:v0.5.10
    container_name: pgdashex
    ports:
      - "9187:9187"
    environment:
      # Required PostgreSQL connection settings
      PG_HOST: postgres-host
      PG_PORT: 5432
      PG_USER: pgdashex_user
      PG_PASSWORD: your_secure_password
      PG_DATABASE: postgres

      # Optional settings
      PG_SSLMODE: require
      COLLECT_INTERVAL: 30
      PGDASHEX_COLLECT_METRICS: all

      # OpenTelemetry integration
      OTEL_ENABLED: "true"
      OTEL_ENDPOINT: http://otel-collector:4318
      OTEL_SERVICE_NAME: pgdashex
      OTEL_ENVIRONMENT: production
    restart: unless-stopped
```

## Integrating with Scout

pgdashex exposes metrics in Prometheus format on port 9187. To send these
metrics to Scout, configure your OpenTelemetry Collector to scrape pgdashex and
forward to Scout.

### Configure OpenTelemetry Collector

Update your Scout Collector configuration to scrape pgdashex metrics:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  # Scrape Prometheus metrics from pgdashex
  prometheus:
    config:
      scrape_configs:
        - job_name: 'pgdashex'
          scrape_interval: 30s
          static_configs:
            - targets: ['pgdashex:9187']

  # Receive traces from pgdashex (if OTEL_ENABLED=true)
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: __YOUR_CLIENT_SECRET__
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__ORG_NAME__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

exporters:
  otlp/scout:
    endpoint: https://api.scout.base14.io:4317
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch, resource]
      exporters: [otlp/scout]
    traces:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlp/scout]
```

## Configuration

### Environment Variables

pgdashex is configured using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PG_HOST` | `localhost` | PostgreSQL server hostname |
| `PG_PORT` | `5432` | PostgreSQL server port |
| `PG_USER` | `postgres` | PostgreSQL username |
| `PG_PASSWORD` | - | PostgreSQL password (special characters are<br/>auto-encoded) |
| `PG_DATABASE` | `postgres` | PostgreSQL database name |
| `PG_SSLMODE` | `disable` | SSL mode (`disable`, `require`, `verify-ca`,<br/>`verify-full`) |
| `PG_ALL_DBS` | `false` | Collect metrics from all databases in the cluster |
| `PG_DATABASES` | - | Comma-separated list of databases to monitor<br/>(overrides `PG_ALL_DBS`) |
| `CLUSTER_NAME` | - | Cluster name label added to all metrics<br/>(falls back to connection hostname if not set) |
| `LISTEN_ADDRESS` | `:9187` | Address to expose metrics |
| `METRICS_PATH` | `/metrics` | Path to expose metrics |
| `SCRAPE_TIMEOUT` | `10` | Timeout in seconds for metrics collection |
| `COLLECT_INTERVAL` | `30` | Interval in seconds between collections |
| `PGDASHEX_COLLECT_METRICS` | `basic` | Metric groups to collect (see below) |
| `TLS_ENABLED` | `false` | Enable TLS for metrics endpoint |
| `TLS_CERT_FILE` | - | Path to TLS certificate file |
| `TLS_KEY_FILE` | - | Path to TLS key file |
| `OTEL_ENABLED` | `true` | Enable OpenTelemetry tracing |
| `OTEL_ENDPOINT` | `http://localhost:4318` | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME` | `pgdashex` | Service name for traces |
| `OTEL_ENVIRONMENT` | `development` | Environment name for traces |

### Metric Groups

Control which metrics are collected using the `PGDASHEX_COLLECT_METRICS`
environment variable:

**Predefined Values:**

- `all` - Collect all available metrics (recommended for comprehensive monitoring)
- `basic` - Collect essential metrics only (lower overhead)

**Custom Groups:**
Specify a comma-separated list of metric groups:

```bash showLineNumbers
PGDASHEX_COLLECT_METRICS=basic,tables,indexes,queries,replication
```

**Available Metric Groups:**

- `basic` - Core database metrics (connections, transactions, database size)
- `tables` - Table statistics and sizes
- `indexes` - Index usage and sizes
- `queries` - Query performance (requires pg_stat_statements)
- `replication` - Replication lag and status
- `backends` - Active connections and backend processes
- `locks` - Lock statistics
- `sequences` - Sequence information
- `functions` - Function statistics
- `system` - System-level metrics
- `settings` - PostgreSQL configuration
- `extensions` - Installed extensions
- `tablespaces` - Tablespace information
- `progress` - Vacuum and analyze progress
- `publications` - Logical replication publications
- `subscriptions` - Logical replication subscriptions
- `metadata` - Database metadata
- `roles` - User and role information

**Examples:**

```bash showLineNumbers
# Collect all metrics
PGDASHEX_COLLECT_METRICS=all

# Collect basic metrics plus table and index stats
PGDASHEX_COLLECT_METRICS=basic,tables,indexes

# Comprehensive monitoring for production
PGDASHEX_COLLECT_METRICS=basic,tables,indexes,queries,replication,backends,locks
```

## Troubleshooting

### pgdashex cannot connect to PostgreSQL

**Cause**: Network, credentials, or SSL configuration issue.

**Fix**:

```bash showLineNumbers
# Test PostgreSQL connection
psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DATABASE -c "SELECT version();"
```

1. Verify hostname and port are correct
2. Check `pg_hba.conf` allows connections from the pgdashex host
3. Confirm SSL mode matches your PostgreSQL configuration
4. Check firewall rules between pgdashex and PostgreSQL

### No metrics on port 9187

**Cause**: pgdashex is not running or the port is not exposed.

**Fix**:

1. Check container status: `docker ps | grep pgdashex`
2. Verify port mapping: `curl -s http://localhost:9187/metrics | head -20`
3. Check pgdashex logs: `docker logs pgdashex`

### Query statistics not appearing

**Cause**: `pg_stat_statements` extension is not installed or the metric
group is not enabled.

**Fix**:

1. Verify the extension: `SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';`
2. Ensure `PGDASHEX_COLLECT_METRICS` includes `queries` or is set to `all`

## FAQ

**What is the difference between Basic and Advanced monitoring?**

The [Basic guide](./postgres.md) uses the OTel PostgreSQL receiver for
core database metrics (34 metrics). This Advanced guide uses pgdashex,
which collects deeper metrics across 17 groups including query-level
statistics, per-table I/O, and logical replication.

**Can I run pgdashex alongside the Basic PostgreSQL receiver?**

Yes. They collect different metrics and use different endpoints. The
Basic receiver connects directly to PostgreSQL, while pgdashex exposes
a Prometheus endpoint that the Collector scrapes separately.

**How do I monitor multiple PostgreSQL databases?**

Set `PG_ALL_DBS=true` to monitor all databases in the cluster, or use
`PG_DATABASES=db1,db2,db3` to monitor specific databases.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [MySQL](./mysql.md), [MongoDB](./mongodb.md),
  and other components
- **Fine-tune Collection**: Optimize metric groups using
  `PGDASHEX_COLLECT_METRICS` — use `basic,tables,indexes,queries` for
  targeted monitoring or `all` for comprehensive coverage

## Related Guides

- [PostgreSQL Basic Monitoring](./postgres.md) — Core PostgreSQL metrics
  via OTel receiver
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Collector setup with Docker Compose
- [Filtering pgX Metrics](../../operate/filters-and-transformations/filtering-pgx-metrics.md)
  — Filter and tune pgdashex metrics in the Collector pipeline
