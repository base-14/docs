---
title: PostgreSQL Advanced Monitoring
sidebar_label: PostgreSQL Advanced
description:
  Advanced PostgreSQL monitoring. Collect comprehensive database
  metrics including query statistics, table/index metrics, and replication status.
keywords:
  [
    pgdashex,
    postgresql exporter,
    postgres metrics,
    advanced postgresql monitoring,
    database monitoring,
    postgres observability,
  ]
---

# PostgreSQL Advanced Monitoring

Pgdashex is a PostgreSQL monitoring agent that collects comprehensive database
metrics and exposes them in Prometheus format. This guide covers deploying
pgdashex to monitor your PostgreSQL databases and send metrics to Scout.

## Overview

Pgdashex collects PostgreSQL metrics including server information, database
statistics, table and index metrics, replication status, WAL and archiving
statistics, background writer statistics, connection and backend information,
query statistics, lock information, vacuum and analyze progress, and PostgreSQL
configuration settings.

## Prerequisites

- PostgreSQL instance
- Scout account and API credentials
- Scout Collector installed and configured (see [Quick Start](../../guides/quick-start.md))

## PostgreSQL User Setup

Create a dedicated PostgreSQL user with monitoring privileges:

```sql
-- Connect as superuser (postgres) 
CREATE USER pgdashex_monitor WITH ENCRYPTED PASSWORD '<strong_password>';


-- Grant monitoring roles per cluster
GRANT pg_read_all_stats TO pgdashex_monitor;
GRANT pg_monitor TO pgdashex_monitor;


-- Grant database access per database 
GRANT CONNECT ON DATABASE <database_name> TO pgdashex_monitor;

--- Grant schema usage and table access per database
GRANT USAGE ON SCHEMA information_schema TO pgdashex_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO pgdashex_monitor;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pgdashex_monitor;

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

```bash
psql -h <postgres-host> -p 5432 -U pgdashex_user -d postgres -c "SELECT version();"
```

## Docker Image Information

### Image Details

- **Image Name**: `base14/pgdashex`
- **Image Tag**: `base14/pgdashex:v0.5.7`

### Exposed Ports

| Port | Protocol | Description |
|------|----------|-------------|
| `9187` | HTTP | Prometheus metrics endpoint |

### Quick Start

Pull and run the Docker image:

```bash
docker pull base14/pgdashex:v0.5.7

docker run -d \
  --name pgdashex \
  -p 9187:9187 \
  -e PG_HOST=your-postgres-host \
  -e PG_PORT=5432 \
  -e PG_USER=pgdashex_user \
  -e PG_PASSWORD='your_secure_password' \
  -e PG_DATABASE=postgres \
  -e PGDASHEX_COLLECT_METRICS=all \
  base14/pgdashex:v0.5.7
```

**Note**: If PostgreSQL is on the host machine, use `host.docker.internal` as
PG_HOST (Docker Desktop) or `--network host` (Linux).

### Example Docker Compose

```yaml
version: '3.8'

services:
  pgdashex:
    image: base14/pgdashex:v0.5.7
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

```yaml
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
        value: production
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

```bash
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

```bash
# Collect all metrics
PGDASHEX_COLLECT_METRICS=all

# Collect basic metrics plus table and index stats
PGDASHEX_COLLECT_METRICS=basic,tables,indexes

# Comprehensive monitoring for production
PGDASHEX_COLLECT_METRICS=basic,tables,indexes,queries,replication,backends,locks
```

## Troubleshooting

### pgdashex Can't Connect to PostgreSQL

**Check connectivity:**

```bash
# Test PostgreSQL connection
psql -h $PG_HOST -p $PG_PORT -U $PG_USER -d $PG_DATABASE -c "SELECT version();"
```

**Common issues:**

- Incorrect hostname or port
- PostgreSQL not accepting connections from pgdashex host
- Check `pg_hba.conf` for connection rules
- Firewall blocking connection
- Incorrect SSL mode

### Metrics Issues

Check OTel Collector logs and pgdashex logs for errors.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for [Redis](./redis.md),
  [MongoDB](./mongodb.md), [RabbitMQ](./rabbitmq.md), and other components
- **Fine-tune Collection**: Optimize metric groups based on your needs

## Related Guides

- [PostgreSQL Basic Monitoring](./postgres.md) - Basic PostgreSQL monitoring
  setup
- [Quick Start](../../guides/quick-start.md) - Scout setup guide
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Collector setup with Docker Compose
