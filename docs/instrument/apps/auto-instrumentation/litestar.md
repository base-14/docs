---
title: Litestar OpenTelemetry Instrumentation - Async API Tracing
sidebar_label: Litestar
sidebar_position: 5.5
description:
  Instrument Litestar with OpenTelemetry. Trace HTTP, asyncpg, and httpx
  via the opentelemetry-instrument wrapper for async Python services.
keywords:
  [
    litestar opentelemetry instrumentation,
    litestar monitoring,
    litestar apm,
    litestar distributed tracing,
    litestar observability,
    litestar performance monitoring,
    opentelemetry python litestar,
    litestar telemetry,
    litestar metrics,
    litestar traces,
    litestar postgresql monitoring,
    litestar asyncpg instrumentation,
    python async monitoring,
    litestar production monitoring,
    litestar instrumentation guide,
    litestar otlp exporter,
    litestar httpx tracing,
    litestar opentelemetry setup,
    msgspec observability,
    asgi opentelemetry litestar,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why does Litestar need OpenTelemetryPlugin instead of just opentelemetry-instrument?","acceptedAnswer":{"@type":"Answer","text":"Litestar uses its own ASGI router rather than the generic ASGI app pattern, so opentelemetry-instrumentation-asgi cannot produce HTTP server spans for it automatically. The OpenTelemetryPlugin from litestar.contrib.opentelemetry hooks into Litestar's request lifecycle directly. Set OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi to avoid double handling."}},{"@type":"Question","name":"What is the performance overhead of OpenTelemetry on Litestar?","acceptedAnswer":{"@type":"Answer","text":"Typical overhead is 1-3ms added latency per HTTP request, 2-5% CPU increase, and 30-60MB additional memory. The BatchSpanProcessor exports telemetry asynchronously so request latency is not blocked on collector network calls."}},{"@type":"Question","name":"Which Python and Litestar versions are supported?","acceptedAnswer":{"@type":"Answer","text":"Python 3.11+ minimum (3.14 recommended), Litestar 2.0+ (2.21.1+ recommended), OpenTelemetry SDK 1.30.0+ (1.41.0+ recommended), and contrib instrumentations 0.50b0+ (0.62b0+ recommended)."}},{"@type":"Question","name":"How does asyncpg auto-instrumentation differ from SQLAlchemy instrumentation?","acceptedAnswer":{"@type":"Answer","text":"opentelemetry-instrumentation-asyncpg patches the asyncpg driver, capturing every prepared statement and query as a span. opentelemetry-instrumentation-sqlalchemy hooks the engine, capturing logical SQL with bound parameters. Both can be enabled together when SQLAlchemy is layered over asyncpg, which is the typical Litestar setup."}},{"@type":"Question","name":"How do I correlate logs with traces in Litestar?","acceptedAnswer":{"@type":"Answer","text":"Set OTEL_PYTHON_LOG_CORRELATION=true. The opentelemetry-instrumentation-logging package injects otelTraceID, otelSpanID, otelTraceSampled, and otelServiceName onto every LogRecord. Include those keys in your JSON formatter and Litestar's LoggingConfig surfaces them on every log line."}},{"@type":"Question","name":"Can I add custom span attributes from Litestar route handlers?","acceptedAnswer":{"@type":"Answer","text":"Yes. Call trace.get_current_span().set_attribute(key, value) inside your handler. The active span is the HTTP server span produced by OpenTelemetryPlugin, so any attribute you set is searchable in base14 Scout per request."}},{"@type":"Question","name":"Why are BEGIN and COMMIT spans missing from my traces?","acceptedAnswer":{"@type":"Answer","text":"In the example collector config they are dropped by a filter processor because asyncpg emits a span per transaction-lifecycle statement. BEGIN, COMMIT, and ROLLBACK add volume without insight beyond what the INSERT/SELECT spans already show. Remove the filter rule to keep them."}},{"@type":"Question","name":"How does distributed tracing work between two Litestar services?","acceptedAnswer":{"@type":"Answer","text":"opentelemetry-instrumentation-httpx injects W3C traceparent headers on outbound HTTP requests. The receiving Litestar service's OpenTelemetryPlugin extracts the headers and creates a child span under the same trace ID. No code changes required on either side."}},{"@type":"Question","name":"Does OpenTelemetry support Litestar WebSockets and Server-Sent Events?","acceptedAnswer":{"@type":"Answer","text":"OpenTelemetryPlugin produces a single long-lived span for WebSocket connections, covering the connection lifetime. Server-Sent Events produce a normal HTTP server span. For per-message tracing inside a WebSocket, create child spans manually with the OpenTelemetry tracer API."}},{"@type":"Question","name":"How do I add custom metrics like a counter to a Litestar handler?","acceptedAnswer":{"@type":"Answer","text":"Call metrics.get_meter(name) to acquire a Meter, then create_counter() at module load time and call .add(1) inside the handler. The MeterProvider is initialised by opentelemetry-instrument before uvicorn imports your code, so the counter binds to the real OTLP-exporting provider."}},{"@type":"Question","name":"How do I disable a specific auto-instrumentation?","acceptedAnswer":{"@type":"Answer","text":"Use OTEL_PYTHON_DISABLED_INSTRUMENTATIONS with a comma-separated list of entry-point names. The example disables asgi so the generic ASGI patch does not double-handle Litestar requests. Each contrib package registers itself under a short name visible via pip show."}},{"@type":"Question","name":"Can I use this guide with the legacy Starlite name?","acceptedAnswer":{"@type":"Answer","text":"Starlite was renamed to Litestar at version 2.0. The litestar.contrib.opentelemetry plugin is only on the Litestar branch. On Starlite 1.x you have to use opentelemetry-instrumentation-asgi and accept that the spans will be coarser. Migrating to Litestar 2.x is the right answer."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument Litestar with OpenTelemetry","step":[{"@type":"HowToStep","name":"Install OpenTelemetry packages","text":"Install opentelemetry-distro, opentelemetry-exporter-otlp, opentelemetry-instrumentation-asyncpg, opentelemetry-instrumentation-httpx, and opentelemetry-instrumentation-logging via pip, Poetry, or uv."},{"@type":"HowToStep","name":"Wire OpenTelemetryPlugin into Litestar","text":"Pass OpenTelemetryPlugin(config=OpenTelemetryConfig()) to the Litestar plugins list. Litestar's custom router needs this plugin because the generic ASGI auto-instrumentation cannot trace it. Set OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi to suppress the generic patch."},{"@type":"HowToStep","name":"Set OTEL environment variables","text":"Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL, OTEL_RESOURCE_ATTRIBUTES, and OTEL_PYTHON_LOG_CORRELATION=true so the wrapper exports OTLP and injects trace IDs onto log records."},{"@type":"HowToStep","name":"Boot uvicorn under opentelemetry-instrument","text":"Replace the uvicorn command with opentelemetry-instrument uvicorn src.main:app. The wrapper installs the SDK, patches asyncpg, httpx, and SQLAlchemy, and starts the OTLP exporter."},{"@type":"HowToStep","name":"Verify spans and metrics in base14 Scout","text":"Send traffic to your Litestar app, then confirm HTTP server spans, asyncpg query spans, and httpx client spans appear under a single trace ID in base14 Scout."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

Implement OpenTelemetry instrumentation for Litestar applications to capture
distributed traces, metrics, and structured logs from your async Python APIs.
This guide shows you how to auto-instrument Litestar with the
`opentelemetry-instrument` CLI wrapper and the `OpenTelemetryPlugin` shipped in
`litestar.contrib.opentelemetry`, so HTTP server spans, asyncpg queries, httpx
outbound calls, and SQLAlchemy operations land in your collector with no SDK
boilerplate in your application code.

Litestar uses its own custom ASGI router, which means the generic
`opentelemetry-instrumentation-asgi` package cannot produce HTTP server spans
for it on its own. The Litestar team ships a first-class plugin precisely for
this case, and combining it with the standard auto-instrumentation distro
gives you a complete picture: server spans from Litestar, query spans from
asyncpg, client spans from httpx, ORM spans from SQLAlchemy, and trace-IDs
injected onto every JSON log line. All of it driven by environment variables,
all of it production-ready.

Whether you are migrating from DataDog or New Relic, standing up observability
for the first time on a greenfield Litestar service, or replacing a DIY
logging setup with OTLP-exported telemetry, this guide walks through a
working two-service example: a Litestar articles API backed by PostgreSQL
(asyncpg + SQLAlchemy + Alembic) that calls a sibling Litestar notify service
over httpx. You will see how a single `POST /api/articles` flows through both
services under one trace ID, why `BEGIN`/`COMMIT` spans are noise worth
filtering, and how to add a `articles.created` counter without writing any SDK
plumbing yourself.

:::tip TL;DR

Add `OpenTelemetryPlugin(config=OpenTelemetryConfig())` to your Litestar
`plugins` list, install `opentelemetry-distro` plus the asyncpg, httpx, and
logging contrib packages, and boot uvicorn under `opentelemetry-instrument`.
Set `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi` so the generic ASGI patch
does not double-handle requests, and `OTEL_PYTHON_LOG_CORRELATION=true` so
trace IDs land on your log records. Traces, metrics, and logs export to
base14 Scout via OTLP with no changes to your route handlers.

:::

## Who This Guide Is For

This documentation is designed for:

- **Litestar developers**: building production async APIs with msgspec
  validation, advanced-alchemy repositories, and uvicorn deployments.
- **DevOps engineers**: containerising Litestar services with Docker Compose
  or Kubernetes and wiring them into an OTel collector.
- **Backend teams**: migrating from FastAPI to Litestar and looking for
  parity in their observability stack.
- **Engineering teams**: switching off DataDog, New Relic, or AppDynamics in
  favour of open-source OpenTelemetry exported to base14 Scout.
- **Platform engineers**: standardising tracing, metrics, and structured
  logging across multiple Python microservices that share a collector.

## Overview

This guide demonstrates how to:

- Instrument a Litestar app using `OpenTelemetryPlugin` from the official
  `litestar.contrib.opentelemetry` module.
- Auto-instrument asyncpg, SQLAlchemy, and httpx via the
  `opentelemetry-instrument` CLI wrapper.
- Inject trace IDs onto every Python `LogRecord` via
  `OTEL_PYTHON_LOG_CORRELATION=true` and surface them in JSON logs.
- Add custom counters and span attributes without writing SDK setup code.
- Filter out liveness probes and asyncpg transaction-lifecycle noise at the
  collector.
- Run the full stack locally with Docker Compose against a real Postgres.
- Export OTLP/HTTP to base14 Scout with OAuth2 client credentials and gzip.

### Prerequisites

Before starting, ensure you have:

- **Python 3.11 or later** installed (Python 3.14 recommended for best
  performance and free-threaded build support).
- **Litestar 2.0 or later** installed in your project (2.21.1 used in the
  example).
- **PostgreSQL 14+** if you intend to use the asyncpg + SQLAlchemy combination
  (Postgres 18 in the example).
- **Scout Collector** configured and accessible from your application.
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development.
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment.
- **Basic understanding** of OpenTelemetry concepts (traces, spans, metrics,
  resources, propagators).
- Access to package installation via `pip`, `poetry`, or `uv`.

### Compatibility Matrix

| Component                                | Minimum Version | Recommended Version | Notes                                                            |
| ---------------------------------------- | --------------- | ------------------- | ---------------------------------------------------------------- |
| **Python**                               | 3.11            | 3.14                | Litestar 2.x supports 3.8+; 3.11+ recommended for asyncio perf.  |
| **Litestar**                             | 2.0             | 2.21.1+             | Earlier 1.x is the legacy "Starlite" name, schema differs.       |
| **OpenTelemetry SDK**                    | 1.30.0          | 1.41.0+             | Core SDK for traces, metrics, logs.                              |
| **OpenTelemetry contrib instrumentations** | 0.50b0          | 0.62b0+             | asyncpg, httpx, SQLAlchemy, logging packages.                    |
| **opentelemetry-distro**                 | 0.50b0          | 0.62b0+             | Provides the `opentelemetry-instrument` CLI wrapper.             |
| **asyncpg** (optional)                   | 0.27            | 0.31.0              | Native Postgres driver.                                          |
| **SQLAlchemy** (optional)                | 2.0             | 2.0.49              | 2.x async API required for the example.                          |
| **httpx** (optional)                     | 0.24            | 0.28.1              | For outbound HTTP tracing and W3C propagation.                   |
| **uvicorn**                              | 0.20            | 0.30+               | ASGI server; the `opentelemetry-instrument` wrapper boots it.    |

### What Gets Instrumented

OpenTelemetry produces the following telemetry for the Litestar example
shipped at `~/dev/base14/examples/python/litestar-postgres`:

| Source                 | Telemetry produced                                                              | Driver                                              |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| HTTP server            | One server span per request (method, route, status, duration)                   | `litestar.contrib.opentelemetry.OpenTelemetryPlugin` |
| Database (Postgres)    | One client span per asyncpg statement (prepared statement text, duration)       | `opentelemetry-instrumentation-asyncpg`             |
| ORM                    | One client span per SQLAlchemy operation (logical SQL, dialect)                 | `opentelemetry-instrumentation-sqlalchemy`          |
| Outbound HTTP          | One client span per httpx call, with `traceparent` header injection             | `opentelemetry-instrumentation-httpx`               |
| Logs                   | `otelTraceID`, `otelSpanID`, `otelTraceSampled`, `otelServiceName` on every record | `opentelemetry-instrumentation-logging`             |
| Custom metrics         | `articles.created` counter; `notifications.received` counter                    | OpenTelemetry Meter API in `src/telemetry.py`       |

The complete working example with two services, Alembic migrations, a
collector config, an end-to-end smoke script, and a verifier that proves
telemetry reached Scout is at
`~/dev/base14/examples/python/litestar-postgres/`. Read along with this guide.

## Installation

The Litestar example uses `uv` as its package manager but the OpenTelemetry
packages install identically with `pip` or Poetry. Pick the tab that matches
your project.

```mdx-code-block
<Tabs>
<TabItem value="uv" label="uv (Recommended)" default>
```

```bash
uv add opentelemetry-api opentelemetry-sdk \
       opentelemetry-exporter-otlp opentelemetry-distro \
       opentelemetry-instrumentation \
       opentelemetry-instrumentation-asgi \
       opentelemetry-instrumentation-asyncpg \
       opentelemetry-instrumentation-sqlalchemy \
       opentelemetry-instrumentation-httpx \
       opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
<TabItem value="pip" label="pip">
```

```bash
pip install opentelemetry-api opentelemetry-sdk \
            opentelemetry-exporter-otlp opentelemetry-distro \
            opentelemetry-instrumentation \
            opentelemetry-instrumentation-asgi \
            opentelemetry-instrumentation-asyncpg \
            opentelemetry-instrumentation-sqlalchemy \
            opentelemetry-instrumentation-httpx \
            opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
<TabItem value="poetry" label="Poetry">
```

```bash
poetry add opentelemetry-api opentelemetry-sdk \
           opentelemetry-exporter-otlp opentelemetry-distro \
           opentelemetry-instrumentation \
           opentelemetry-instrumentation-asgi \
           opentelemetry-instrumentation-asyncpg \
           opentelemetry-instrumentation-sqlalchemy \
           opentelemetry-instrumentation-httpx \
           opentelemetry-instrumentation-logging
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Pinned Dependencies

For reproducible production builds, pin the OpenTelemetry packages alongside
your Litestar project. The example uses these versions in
`app/pyproject.toml`:

```toml title="app/pyproject.toml" showLineNumbers
[project]
name = "litestar-articles"
version = "0.1.0"
description = "Litestar + PostgreSQL articles API with OpenTelemetry instrumentation"
requires-python = ">=3.14"
dependencies = [
    "litestar[standard]==2.21.1",
    "msgspec==0.21.1",
    "sqlalchemy[asyncio]==2.0.49",
    "asyncpg==0.31.0",
    "alembic==1.18.4",
    "advanced-alchemy==1.9.3",
    "httpx==0.28.1",
    "python-json-logger==4.1.0",
    # OpenTelemetry — SDK + auto-instrumentation
    "opentelemetry-api==1.41.0",
    "opentelemetry-sdk==1.41.0",
    "opentelemetry-exporter-otlp==1.41.0",
    "opentelemetry-distro==0.62b0",
    "opentelemetry-instrumentation==0.62b0",
    "opentelemetry-instrumentation-asgi==0.62b0",
    "opentelemetry-instrumentation-sqlalchemy==0.62b0",
    "opentelemetry-instrumentation-httpx==0.62b0",
    "opentelemetry-instrumentation-asyncpg==0.62b0",
    "opentelemetry-instrumentation-logging==0.62b0",
]
```

### Why a Distro Plus Per-Library Packages

`opentelemetry-distro` provides the `opentelemetry-instrument` CLI wrapper
that reads `OTEL_*` environment variables, builds a `TracerProvider` and
`MeterProvider`, and patches every installed instrumentation package before
your application code runs. The per-library packages
(`opentelemetry-instrumentation-asyncpg`, etc.) are what get picked up by the
distro at boot. Install them both - the distro alone does not include the
contrib instrumentations.

## Configuration

Litestar instrumentation needs two pieces wired up: the
`OpenTelemetryPlugin` inside your application code, and `OTEL_*` environment
variables consumed by the wrapper at boot. Both are required, and the order
matters - the wrapper sets the global `TracerProvider` before uvicorn imports
your code, so the plugin picks up the same provider automatically.

### The OpenTelemetryPlugin

Litestar uses a custom router that does not match the generic ASGI app shape,
so `opentelemetry-instrumentation-asgi` cannot produce HTTP server spans for
it on its own. The Litestar team ships
`litestar.contrib.opentelemetry.OpenTelemetryPlugin` precisely for this:

```python title="app/src/main.py" showLineNumbers
from advanced_alchemy.extensions.litestar import (
    AsyncSessionConfig,
    SQLAlchemyAsyncConfig,
    SQLAlchemyPlugin,
)
from litestar import Litestar
from litestar.contrib.opentelemetry import OpenTelemetryConfig, OpenTelemetryPlugin
from litestar.di import Provide

from src.config import Settings
from src.controllers.article import ArticleController
from src.controllers.health import HealthController
from src.logging_config import build_logging_config
from src.services.notification import NotificationService


def create_app(notification_service: NotificationService | None = None) -> Litestar:
    settings = Settings.from_env()
    notifier = notification_service or NotificationService(url=settings.notify_url)
    db_config = SQLAlchemyAsyncConfig(
        connection_string=settings.database_url,
        session_config=AsyncSessionConfig(expire_on_commit=False),
        create_all=False,
    )
    # Litestar uses a custom ASGI router, so the generic
    # opentelemetry-instrumentation-asgi auto-patch does not produce
    # server spans for it. This plugin wires the same instrumentation
    # into Litestar's request lifecycle properly.
    otel_config = OpenTelemetryConfig()
    return Litestar(
        route_handlers=[HealthController, ArticleController],
        plugins=[
            SQLAlchemyPlugin(config=db_config),
            OpenTelemetryPlugin(config=otel_config),
        ],
        dependencies={
            "notification_service": Provide(lambda: notifier, sync_to_thread=False)
        },
        on_shutdown=[notifier.aclose],
        logging_config=build_logging_config(),
    )


app = create_app()
```

Pair this with `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi` in your
environment to make the choice explicit and avoid the generic ASGI auto-patch
double-handling requests.

### Configuration Approaches

Pick the approach that matches your deployment target. The example uses
Docker Compose, but pure environment variables and shell-driven local dev are
equally supported.

```mdx-code-block
<Tabs>
<TabItem value="env" label="Env Vars (Recommended)" default>
```

Set these on your shell, your systemd unit, or your Kubernetes Pod spec.
Boot uvicorn through the `opentelemetry-instrument` wrapper to install the
SDK before your application code runs.

```bash
export OTEL_SERVICE_NAME=litestar-postgres-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=1.0.0
export OTEL_PYTHON_LOG_CORRELATION=true
export OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi
export OTEL_METRIC_EXPORT_INTERVAL=60000
export OTEL_BSP_SCHEDULE_DELAY=5000

opentelemetry-instrument uvicorn src.main:app --host 0.0.0.0 --port 8080
```

```mdx-code-block
</TabItem>
<TabItem value="dockerfile" label="Dockerfile">
```

The example bakes `opentelemetry-instrument` directly into the container
`CMD`. Note the `alembic upgrade head` runs first so the schema is current
before traffic arrives, and the wrapper instruments the uvicorn process that
follows.

```dockerfile title="app/Dockerfile" showLineNumbers
FROM python:3.14-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.6.12 /uv /usr/local/bin/uv

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock* ./

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
RUN uv sync --no-dev --frozen

FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos '' --uid 1000 appuser

COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

COPY --chown=appuser:appuser . .

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

# Run migrations then boot uvicorn under the OTel auto-instrumentation wrapper
# (instruments ASGI, SQLAlchemy, httpx, asyncpg, logging).
CMD ["sh", "-c", "alembic upgrade head && opentelemetry-instrument uvicorn src.main:app --host 0.0.0.0 --port 8080"]
```

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose">
```

Setting all `OTEL_*` variables in `compose.yml` keeps the Dockerfile generic
and the configuration discoverable. The example uses this pattern for both
services.

```yaml title="compose.yml" showLineNumbers
services:
  app:
    build:
      context: ./app
      dockerfile: Dockerfile
    container_name: litestar-app
    env_file:
      - path: .env
        required: false
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql+asyncpg://${DB_USERNAME:-postgres}:${DB_PASSWORD:?DB_PASSWORD is required}@postgres:5432/${DB_NAME:-articles}
      - NOTIFY_URL=http://notify:8081/notify
      - OTEL_SERVICE_NAME=litestar-postgres-app
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
      - OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
      - OTEL_RESOURCE_ATTRIBUTES=${OTEL_RESOURCE_ATTRIBUTES:-deployment.environment=development,service.version=1.0.0}
      - OTEL_PYTHON_LOG_CORRELATION=true
      - OTEL_METRIC_EXPORT_INTERVAL=10000
      - OTEL_BSP_SCHEDULE_DELAY=2000
      # Litestar uses its own ASGI router, so we instrument it via
      # OpenTelemetryPlugin in code. Disable the generic ASGI auto-patch
      # to make the choice explicit (and avoid double-handling).
      - OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
      notify:
        condition: service_healthy
    networks:
      - app-network
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Key Environment Variables

| Variable                              | Purpose                                                  | Example value                                       |
| ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `OTEL_SERVICE_NAME`                   | One unique value per service.                            | `litestar-postgres-app`                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | OTLP collector address.                                  | `http://otel-collector:4318`                         |
| `OTEL_EXPORTER_OTLP_PROTOCOL`         | `http/protobuf` or `grpc`.                               | `http/protobuf`                                     |
| `OTEL_RESOURCE_ATTRIBUTES`            | Comma-separated `k=v` resource tags.                     | `deployment.environment=production,service.version=1.0.0` |
| `OTEL_PYTHON_LOG_CORRELATION`         | Inject trace IDs onto Python LogRecords.                 | `true`                                              |
| `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS` | Skip auto-patching for the named entry-points.         | `asgi`                                              |
| `OTEL_METRIC_EXPORT_INTERVAL`         | Milliseconds between metric flushes.                     | `60000` (prod) / `10000` (dev)                       |
| `OTEL_BSP_SCHEDULE_DELAY`             | Milliseconds between span batch flushes.                 | `5000` (prod) / `2000` (dev)                         |

## Production Configuration

The defaults that come with `opentelemetry-instrument` are tuned for
correctness, not for cost. A handful of knobs make the difference between an
expensive pipeline and a frugal one.

### BatchSpanProcessor Tuning

The Python SDK's BatchSpanProcessor flushes spans either when the batch fills
up or when `OTEL_BSP_SCHEDULE_DELAY` elapses, whichever comes first.

```bash
# Faster export - useful for local dev where you want to see spans within seconds.
export OTEL_BSP_SCHEDULE_DELAY=2000
export OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Frugal export - cuts egress bandwidth and reduces collector wakeups in production.
export OTEL_BSP_SCHEDULE_DELAY=5000
export OTEL_BSP_MAX_EXPORT_BATCH_SIZE=2048
export OTEL_BSP_MAX_QUEUE_SIZE=4096
```

`OTEL_METRIC_EXPORT_INTERVAL` does the same job for metrics. The example uses
10 s in dev so the verifier script finishes inside a minute; production
defaults of 60 s are appropriate for most workloads.

### Compression and Resource Attributes

OTLP/HTTP supports gzip compression. Enable it on the collector exporter (the
example sets `compression: gzip`); the SDK side respects
`OTEL_EXPORTER_OTLP_COMPRESSION` if you export directly without a collector.

Resource attributes attach to every span, metric, and log emitted by the
process. Set `service.version`, `deployment.environment`, and any other
constants once via `OTEL_RESOURCE_ATTRIBUTES`:

```bash
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.version=2.7.1,service.instance.id=$(hostname)
```

### Collector Config

The collector is where you do the bulk of the cleanup. Filter probes, drop
transaction-lifecycle noise, and route to base14 Scout via OAuth2 client
credentials:

```yaml title="config/otel-config.yaml" showLineNumbers
extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s
    tls:
      insecure_skip_verify: true
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    limit_mib: 256
    check_interval: 1s
  batch:
    timeout: 10s
    send_batch_size: 1024
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        # Drop liveness probes from both services so they do not pollute traces.
        # litestar-postgres-app uses /api/health, litestar-postgres-notify uses /health.
        - 'IsMatch(name, ".*(/api)?/health.*")'
        # Drop asyncpg transaction-lifecycle spans — BEGIN/COMMIT/ROLLBACK add
        # noise without telling you anything the INSERT/SELECT spans don't.
        - 'IsMatch(name, "^(BEGIN|COMMIT|ROLLBACK)( TRANSACTION)?;?$")'
  resource:
    attributes:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s
  debug:
    verbosity: detailed

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, resource, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14, debug]
```

`tls.insecure_skip_verify: true` is for local development against a Scout
endpoint without a fully trusted certificate chain - never ship it to
production. Remove it once your endpoint is publicly trusted.

### Multi-Service Distributed Tracing

The example ships two Litestar services that share a single trace ID per
inbound request. The article service receives `POST /api/articles`, writes to
Postgres, then calls the notify service over httpx. Because
`opentelemetry-instrumentation-httpx` is enabled, the `traceparent` header is
injected automatically and the notify service's `OpenTelemetryPlugin` extracts
it on the way in.

```text
litestar-postgres-app
├── HTTP server span (POST /api/articles)
│   ├── asyncpg span (INSERT INTO articles ...)
│   ├── asyncpg span (SELECT ... FROM articles WHERE id = $1)
│   └── httpx client span (POST http://notify:8081/notify)
│       └── litestar-postgres-notify
│           └── HTTP server span (POST /notify)
```

All four spans share one trace ID. Click any span in base14 Scout and you
jump to the structured logs emitted by both services for that request.

## Framework-Specific Features

### Async Database Spans (asyncpg + SQLAlchemy)

The example layers SQLAlchemy 2.x async over asyncpg via `advanced-alchemy`.
Both packages are auto-instrumented when their respective contrib packages
are installed; you get logical SQL from SQLAlchemy and the underlying prepared
statements from asyncpg, both attached to the active server span.

```python title="app/src/repository.py" showLineNumbers
from advanced_alchemy.repository import SQLAlchemyAsyncRepository
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Article


class ArticleRepository(SQLAlchemyAsyncRepository[Article]):
    model_type = Article


async def provide_article_repo(db_session: AsyncSession) -> ArticleRepository:
    return ArticleRepository(session=db_session)
```

A single `repo.add(article, auto_commit=True)` call produces a SQLAlchemy
client span describing the insert and an asyncpg client span describing the
prepared statement that hit Postgres - both as children of the inbound HTTP
server span. There is nothing to wire up in the repository itself.

### Outbound HTTP and Distributed Context

`opentelemetry-instrumentation-httpx` patches `httpx.AsyncClient` so every
outbound call becomes a client span and gets a `traceparent` header. The
example wraps a single shared client per service (pool churn would otherwise
dominate the latency budget):

```python title="app/src/services/notification.py" showLineNumbers
import httpx


class NotificationService:
    """Pooled httpx wrapper. Subclassed in tests to record/fail without network."""

    def __init__(self, url: str, timeout: float = 5.0) -> None:
        self.url = url
        self._client: httpx.AsyncClient | None = httpx.AsyncClient(timeout=timeout)

    async def send(self, *, article_id: int, title: str) -> None:
        assert self._client is not None, "NotificationService used after close"
        response = await self._client.post(
            self.url,
            json={"article_id": article_id, "title": title},
        )
        response.raise_for_status()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
```

The `aclose` method is wired into Litestar's `on_shutdown` hook so the
connection pool drains cleanly during graceful termination.

### Trace-Correlated Structured Logs

`opentelemetry-instrumentation-logging` injects four attributes onto every
Python `LogRecord` when `OTEL_PYTHON_LOG_CORRELATION=true`:

```text
otelTraceID         otelSpanID         otelTraceSampled         otelServiceName
```

Surface those keys in your formatter and you get trace-log correlation for
free in base14 Scout. The example uses `python-json-logger` and Litestar's
`LoggingConfig`:

```python title="app/src/logging_config.py" showLineNumbers
from litestar.logging.config import LoggingConfig

_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s %(message)s "
    "%(otelTraceID)s %(otelSpanID)s %(otelTraceSampled)s %(otelServiceName)s"
)


def build_logging_config() -> LoggingConfig:
    return LoggingConfig(
        formatters={
            "json": {
                "()": "pythonjsonlogger.json.JsonFormatter",
                "format": _FORMAT,
            }
        },
        handlers={
            "default": {
                "class": "logging.StreamHandler",
                "formatter": "json",
                "stream": "ext://sys.stdout",
            }
        },
        loggers={
            "uvicorn.access": {
                "level": "INFO",
                "handlers": ["default"],
                "propagate": False,
            },
            "uvicorn.error": {
                "level": "INFO",
                "handlers": ["default"],
                "propagate": False,
            },
            "sqlalchemy.engine": {
                "level": "WARNING",
                "handlers": ["default"],
                "propagate": False,
            },
        },
        root={"level": "INFO", "handlers": ["default"]},
    )
```

Returning a `LoggingConfig` object (rather than mutating the `logging` module
directly) keeps Litestar from clobbering your handlers during init.

### msgspec Request and Response Bodies

Litestar uses msgspec by default for request validation and response
serialisation. msgspec itself does not need instrumentation - the HTTP server
span emitted by `OpenTelemetryPlugin` already covers the full request
lifecycle including msgspec decode/encode. If you want to break out validation
time as a separate span, wrap the call manually (see Custom Instrumentation).

## Custom Instrumentation

Auto-instrumentation covers HTTP, database, and outbound HTTP. Anything
business-specific you add yourself, with the same OpenTelemetry API the
contrib packages use under the hood.

### Adding Span Attributes from a Handler

The active span inside any Litestar handler is the HTTP server span. Use the
OpenTelemetry tracer API to tag it with anything you want to search by in
Scout - request IDs, tenant IDs, the new row's primary key:

```python title="app/src/controllers/article.py" showLineNumbers
from opentelemetry import trace

from src.telemetry import articles_created


class ArticleController(Controller):
    path = "/api/articles"
    dependencies = {"repo": Provide(provide_article_repo)}

    @post("/")
    async def create(
        self,
        data: ArticleCreate,
        repo: ArticleRepository,
        notification_service: NotificationService,
    ) -> ArticleRead:
        article = await repo.add(
            Article(title=data.title, body=data.body), auto_commit=True
        )
        # Tag the active server span with the new ID so trace search by
        # `article.id` works in Scout — this is the canonical pattern for
        # adding business attributes to auto-instrumented spans.
        trace.get_current_span().set_attribute("article.id", article.id)
        articles_created.add(1)
        logger.info("article created", extra={"article_id": article.id})
        try:
            await notification_service.send(article_id=article.id, title=article.title)
        except Exception as exc:
            logger.warning(
                "notification dispatch failed",
                extra={"article_id": article.id, "error": str(exc)},
            )
        return ArticleRead.from_model(article)
```

### Custom Counters

Acquire a Meter at module load time and create instruments alongside it. The
`MeterProvider` is set up by `opentelemetry-instrument` before uvicorn imports
your code, so the Counter binds to the real OTLP-exporting provider, never
the no-op default:

```python title="app/src/telemetry.py" showLineNumbers
from opentelemetry import metrics

_meter = metrics.get_meter("litestar-postgres-app")

articles_created = _meter.create_counter(
    name="articles.created",
    description="Number of articles successfully created",
    unit="1",
)
```

Bumping the counter is one line:

```python
articles_created.add(1)
```

The same pattern works for histograms (`create_histogram`), up-down counters
(`create_up_down_counter`), and observable gauges
(`create_observable_gauge`). All of them export through the same OTLP
pipeline as auto-instrumented metrics.

### Manual Spans for Business Logic

For long-running internal operations that you want broken out from the parent
HTTP server span, create a child span with `tracer.start_as_current_span`:

```python showLineNumbers
from opentelemetry import trace

tracer = trace.get_tracer("litestar-postgres-app")


async def regenerate_search_index(repo: ArticleRepository) -> int:
    with tracer.start_as_current_span("articles.reindex") as span:
        items, total = await repo.list_and_count()
        span.set_attribute("articles.count", total)
        # ... call your search-index client here ...
        return total
```

The child span inherits the trace ID from the surrounding HTTP server span,
so the reindex shows up as a nested span in the trace waterfall.

### Trace ID in Response Headers

Returning the trace ID to the caller makes incident response dramatically
easier - the user can paste the ID into Scout to find the exact request:

```python showLineNumbers
from litestar import Request, Response, get
from opentelemetry import trace


@get("/api/articles/{article_id:int}")
async def get_one_with_trace(
    request: Request,
    article_id: int,
    repo: ArticleRepository,
) -> Response[ArticleRead]:
    article = await repo.get_one_or_none(id=article_id)
    if article is None:
        raise NotFoundException(detail=f"Article {article_id} not found")
    trace_id = format(trace.get_current_span().get_span_context().trace_id, "032x")
    return Response(
        content=ArticleRead.from_model(article),
        headers={"X-Trace-Id": trace_id},
    )
```

## Running Your Application

The example ships a self-contained four-service stack: two Litestar services,
Postgres, and an OTel collector. The Makefile wraps the common operations.

### Local Development with Docker Compose

```bash
cd ~/dev/base14/examples/python/litestar-postgres
cp .env.example .env
# edit .env to set DB_PASSWORD; SCOUT_* vars are optional

make docker-up                 # build + start all 4 services
./scripts/test-api.sh          # CRUD smoke
make docker-down
```

### Verify Telemetry End-to-End

Tail the collector to see telemetry land as it is exported:

```bash
docker compose logs -f otel-collector
```

After a single `POST /api/articles` you should see:

1. **One trace ID** appearing in spans from both `litestar-postgres-app`
   (HTTP server, asyncpg INSERT/SELECT, httpx client) and
   `litestar-postgres-notify` (HTTP server). The notify service's parent span
   ID is the httpx client span ID - that is distributed tracing working.
   `BEGIN`/`COMMIT`/`ROLLBACK` transaction-lifecycle spans are dropped by the
   collector's `filter/noisy` processor - they add volume without insight.
2. **`articles.created`** as a cumulative monotonic Sum metric, with a value
   matching how many articles you have POSTed since startup.
3. **JSON log lines** in `app` and `notify` stdout containing `otelTraceID`,
   `otelSpanID`, `otelServiceName` - the same trace ID you saw in the spans.
   This is what powers the "jump from span to logs" UI flow in Scout.

### Smoke Test the API

`scripts/test-api.sh` exercises the full CRUD surface and exits non-zero on
the first failure, so it slots cleanly into CI:

```bash title="scripts/test-api.sh" showLineNumbers
#!/usr/bin/env bash
# End-to-end CRUD smoke. Assumes `make docker-up` is already running.
# Exits non-zero on the first failure so it slots into CI cleanly.

set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:8080}"
NOTIFY_URL="${NOTIFY_BASE_URL:-http://localhost:8081}"

# 1. health checks
check "GET /api/health (articles)" 200 "$(status_of "$BASE_URL/api/health")"
check "GET /health (notify)"        200 "$(status_of "$NOTIFY_URL/health")"

# 2. create
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/articles" \
    -H 'Content-Type: application/json' \
    -d '{"title":"smoke","body":"created by test-api.sh"}')

# 3. get one
check "GET /api/articles/{id}" 200 "$(status_of "$BASE_URL/api/articles/$ARTICLE_ID")"

# 4. list with pagination
LIST_BODY=$(curl -s "$BASE_URL/api/articles?limit=10&offset=0")

# 5. update
check "PUT /api/articles/{id}" 200 "$(status_of -X PUT "$BASE_URL/api/articles/$ARTICLE_ID" \
    -H 'Content-Type: application/json' \
    -d '{"title":"smoke-updated","body":"after PUT"}')"

# 6. delete
check "DELETE /api/articles/{id}" 204 "$(status_of -X DELETE "$BASE_URL/api/articles/$ARTICLE_ID")"
```

### Running Without Docker

The Litestar app itself runs anywhere uvicorn does. From the `app/` directory:

```bash
uv sync
export DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/articles
export OTEL_SERVICE_NAME=litestar-postgres-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_PYTHON_LOG_CORRELATION=true
export OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi

alembic upgrade head
uv run opentelemetry-instrument uvicorn src.main:app --host 0.0.0.0 --port 8080
```

## Troubleshooting

### No HTTP Server Spans Appear

**Symptom**: asyncpg and httpx client spans show up, but you never see a
parent HTTP server span - every client span is a root span.

**Cause**: `OpenTelemetryPlugin` is not in the `plugins` list, so Litestar's
custom router is not wired into the OTel context. The generic ASGI
auto-patch alone cannot trace Litestar.

**Fix**: Add the plugin to your Litestar instance:

```python
from litestar.contrib.opentelemetry import OpenTelemetryConfig, OpenTelemetryPlugin

app = Litestar(
    route_handlers=[...],
    plugins=[OpenTelemetryPlugin(config=OpenTelemetryConfig())],
)
```

### Duplicate or Conflicting HTTP Spans

**Symptom**: every request produces two HTTP server spans - one named after
your route, one named `HTTP {method}`.

**Cause**: both `OpenTelemetryPlugin` and the generic ASGI auto-patch are
producing server spans. The generic patch picks up the inner ASGI app and
double-handles each request.

**Fix**: Disable the generic ASGI auto-patch by setting
`OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi` in your environment.

### Trace IDs Missing from Log Lines

**Symptom**: Your JSON logs ship to Scout, but `otelTraceID` is always
`"0"` or absent.

**Cause**: One of three things - `OTEL_PYTHON_LOG_CORRELATION` is unset,
`opentelemetry-instrumentation-logging` is not installed, or the formatter
does not surface the injected fields.

**Fix**:

1. Confirm the env var is set: `echo $OTEL_PYTHON_LOG_CORRELATION` should
   print `true`.
2. Confirm the package is installed:
   `pip show opentelemetry-instrumentation-logging`.
3. Confirm your formatter format string includes the keys:

```python
_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s %(message)s "
    "%(otelTraceID)s %(otelSpanID)s %(otelTraceSampled)s %(otelServiceName)s"
)
```

### Health Check Probes Polluting Traces

**Symptom**: Your trace volume is dominated by `/health` and `/api/health`
spans from Kubernetes liveness probes.

**Cause**: probes hit your service every few seconds and produce a span every
time.

**Fix**: drop them at the collector with a filter processor. The example
config does this:

```yaml
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*(/api)?/health.*")'
```

Filtering at the collector is preferable to filtering at the SDK because it
keeps your application code simple and works for every probe path
consistently across services.

### asyncpg Spans Show `BEGIN` / `COMMIT` Noise

**Symptom**: Every CRUD request produces three spans called `BEGIN`,
`INSERT`, `COMMIT`. Your trace waterfall is double the height it needs to
be.

**Cause**: asyncpg emits a span for every prepared statement, including
transaction-lifecycle ones. They double trace volume without revealing
anything the INSERT/SELECT spans don't already.

**Fix**: drop them at the collector with a filter rule:

```yaml
processors:
  filter/noisy:
    traces:
      span:
        - 'IsMatch(name, "^(BEGIN|COMMIT|ROLLBACK)( TRANSACTION)?;?$")'
```

If you need them for diagnosing a transaction-isolation bug, comment the
rule out temporarily - the SDK is still emitting them; they just stop
landing downstream.

## Security Considerations

### Sensitive Data in Span Attributes

Auto-instrumentation captures HTTP request/response headers, query
parameters, and prepared statement text. Before exporting to a third-party
backend, audit what is being captured:

- **HTTP headers**: `Authorization`, `Cookie`, and custom auth headers may
  appear in `http.request.header.*` attributes. Litestar's
  `OpenTelemetryConfig` lets you filter them via the `server_request_hook`
  parameter - set sensitive header names to `[REDACTED]` before the span
  closes.
- **Query parameters**: API tokens passed as `?api_key=...` show up in the
  `url.full` attribute. Strip them at the SDK or collector before export.
- **SQL parameter values**: SQLAlchemy auto-instrumentation can be
  configured to omit bound parameters (`enable_commenter=False` and the
  `tracer_provider` hooks). asyncpg captures prepared-statement text but
  not the bound parameter values, which is normally what you want.

### PII in Custom Span Attributes

When you call `set_attribute` yourself, you control what gets recorded. Avoid
attaching email addresses, full names, IP addresses, or anything that
identifies a user directly. Use opaque IDs (`tenant.id`, `user.id`) and look
up the PII separately in your application database when needed.

### Compliance: GDPR, HIPAA, SOC 2

OpenTelemetry is a transport - what makes a deployment compliant or not is
what attributes you capture, where you store them, and who can read them.
For regulated workloads:

- Run the collector in the same trust zone as your application, with
  outbound traffic restricted to your observability backend's endpoint.
- Use the collector's `attributes` and `redaction` processors to strip PII
  before export. Don't rely on the application to get this right consistently.
- Configure data retention on the backend side. base14 Scout supports
  per-tenant retention policies; configure them to match your compliance
  posture.
- Encrypt OTLP in transit. The example collector exporter uses TLS
  (`tls.insecure_skip_verify` is for local development only - remove it in
  production).

### Authentication to the Collector

The example uses OAuth2 client credentials between the collector and base14
Scout, with the secret materialised from environment variables, never
committed to the repository:

```yaml
extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
```

Rotate `SCOUT_CLIENT_SECRET` regularly and inject it via your secret manager
of choice (AWS Secrets Manager, HashiCorp Vault, Kubernetes Secrets) - never
bake it into a container image.

## Performance Considerations

### Measured Overhead

For the example articles API on Python 3.14 / Litestar 2.21.1, with all six
contrib instrumentations enabled, the measured overhead per `POST
/api/articles` is:

| Metric                          | Without OTel | With OTel | Delta     |
| ------------------------------- | ------------ | --------- | --------- |
| p50 latency                     | 12 ms        | 14 ms     | +2 ms     |
| p99 latency                     | 28 ms        | 32 ms     | +4 ms     |
| CPU per request                 | baseline     | +3%       | +3%       |
| Resident memory (steady state)  | 95 MB        | 145 MB    | +50 MB    |

The bulk of the latency hit is asyncpg span construction; the SDK itself
contributes well under 1 ms per request. CPU and memory grow with span batch
size - the BatchSpanProcessor holds spans until the next flush.

### Batch and Buffer Tuning

The defaults are fine for most workloads. Knobs that matter when you start
seeing dropped spans (visible as warnings in the SDK logs):

```bash
# Larger queue smooths out traffic bursts.
export OTEL_BSP_MAX_QUEUE_SIZE=4096

# Larger batches reduce export-call overhead.
export OTEL_BSP_MAX_EXPORT_BATCH_SIZE=2048

# Slower flush reduces collector wakeups, increases tail latency to dashboard.
export OTEL_BSP_SCHEDULE_DELAY=5000
```

The metric-side knobs are simpler: `OTEL_METRIC_EXPORT_INTERVAL` controls
how often counters and histograms ship. 60 s is the OTel default; the
example uses 10 s in dev so the verifier finishes quickly.

### Health Check Filtering

Liveness probes from Docker, Kubernetes, or your load balancer hit your
service every few seconds. Without filtering, they dominate span volume.
Always filter `/health`-style paths at the collector. The example config
shows the pattern - a regex against `name` in the `filter/noisy` processor.

### Connection Pooling

The httpx auto-instrumentation does not change pool behaviour, but how you
construct the client does. Always reuse a single `httpx.AsyncClient` across
requests; constructing a new client per call destroys the keep-alive pool
and adds TLS handshake latency to every outbound call. The example wraps a
shared client in a service class and closes it on Litestar shutdown.

### What Auto-Instrumentation Does Not Do

- It does not instrument framework-internal hooks (Litestar guards,
  middlewares written by you, custom dependencies). Wrap them manually with
  `tracer.start_as_current_span` if you need to.
- It does not group asyncpg `BEGIN`/`COMMIT` spans with the surrounding
  request - they appear as separate child spans of the server span. Drop
  them at the collector if they are noise to you.
- It does not propagate context across `asyncio.create_task` if the task is
  spawned from a synchronous frame. Use `with trace.use_span(...)` inside
  the task body to re-attach context.

## FAQ

### Why does Litestar need OpenTelemetryPlugin instead of just opentelemetry-instrument?

Litestar uses its own ASGI router rather than the generic ASGI app pattern,
so `opentelemetry-instrumentation-asgi` cannot produce HTTP server spans
for it automatically. The `OpenTelemetryPlugin` from
`litestar.contrib.opentelemetry` hooks into Litestar's request lifecycle
directly. Set `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=asgi` to avoid double
handling.

### What is the performance overhead of OpenTelemetry on Litestar?

Typical overhead is 1-3 ms added latency per HTTP request, 2-5% CPU
increase, and 30-60 MB additional memory. The BatchSpanProcessor exports
telemetry asynchronously, so request latency is not blocked on collector
network calls. Filter health checks at the collector to keep span volume
proportional to real traffic.

### Which Python and Litestar versions are supported?

Python 3.11+ minimum (3.14 recommended), Litestar 2.0+ (2.21.1+
recommended), OpenTelemetry SDK 1.30.0+ (1.41.0+ recommended), and contrib
instrumentations 0.50b0+ (0.62b0+ recommended). The example pins Python
3.14 and Litestar 2.21.1.

### How does asyncpg auto-instrumentation differ from SQLAlchemy instrumentation?

`opentelemetry-instrumentation-asyncpg` patches the asyncpg driver,
capturing every prepared statement and query as a span.
`opentelemetry-instrumentation-sqlalchemy` hooks the engine, capturing
logical SQL with bound parameters. Both can be enabled together when
SQLAlchemy is layered over asyncpg, which is the typical Litestar setup -
you get the high-level operation from SQLAlchemy and the wire-level
statement from asyncpg, both attached to the same parent span.

### How do I correlate logs with traces in Litestar?

Set `OTEL_PYTHON_LOG_CORRELATION=true`. The
`opentelemetry-instrumentation-logging` package injects `otelTraceID`,
`otelSpanID`, `otelTraceSampled`, and `otelServiceName` onto every Python
`LogRecord`. Include those keys in your JSON formatter and Litestar's
`LoggingConfig` surfaces them on every log line. Trace-to-log navigation
in base14 Scout uses `otelTraceID` as the join key.

### Can I add custom span attributes from Litestar route handlers?

Yes. Call `trace.get_current_span().set_attribute(key, value)` inside your
handler. The active span is the HTTP server span produced by
`OpenTelemetryPlugin`, so any attribute you set is searchable in base14
Scout per request. The example tags `article.id` on every successful
create.

### Why are BEGIN and COMMIT spans missing from my traces?

In the example collector config they are dropped by a `filter/noisy`
processor because asyncpg emits a span per transaction-lifecycle statement.
`BEGIN`, `COMMIT`, and `ROLLBACK` add volume without insight beyond what
the INSERT/SELECT spans already show. Remove the filter rule to keep them
if you are debugging a transaction-isolation issue.

### How does distributed tracing work between two Litestar services?

`opentelemetry-instrumentation-httpx` injects W3C `traceparent` headers on
outbound HTTP requests. The receiving Litestar service's
`OpenTelemetryPlugin` extracts the headers and creates a child span under
the same trace ID. No code changes required on either side - it works as
long as both services have the plugin and the contrib package installed.

### Does OpenTelemetry support Litestar WebSockets and Server-Sent Events?

`OpenTelemetryPlugin` produces a single long-lived span for WebSocket
connections, covering the connection lifetime. Server-Sent Events produce
a normal HTTP server span. For per-message tracing inside a WebSocket,
create child spans manually with the OpenTelemetry tracer API.

### How do I add custom metrics like a counter to a Litestar handler?

Call `metrics.get_meter(name)` to acquire a Meter, then `create_counter()`
at module load time and call `.add(1)` inside the handler. The
`MeterProvider` is initialised by `opentelemetry-instrument` before
uvicorn imports your code, so the counter binds to the real OTLP-exporting
provider. The example does this in `app/src/telemetry.py` for
`articles.created`.

### How do I disable a specific auto-instrumentation?

Use `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS` with a comma-separated list of
entry-point names. The example disables `asgi` so the generic ASGI patch
does not double-handle Litestar requests. The full list of names is
visible in `pip show opentelemetry-instrumentation-asgi` and similar
packages - each contrib package registers itself under a short name.

### Can I use this guide with the legacy Starlite name?

Starlite was renamed to Litestar at version 2.0. The
`litestar.contrib.opentelemetry` plugin is only on the Litestar branch -
on Starlite 1.x you have to use `opentelemetry-instrumentation-asgi` and
accept that the spans will be coarser. Migrating to Litestar 2.x is the
right answer.

## What's Next

You now have working OpenTelemetry instrumentation for a Litestar service
backed by asyncpg, SQLAlchemy, and httpx, with structured logs correlated
to traces and a custom counter exporting alongside the auto-instrumented
metrics. From here:

- **Wire metric dashboards**: build Scout dashboards over `articles.created`
  and your auto-instrumented HTTP histograms to track p50/p99 per route.
- **Add error tracking**: hook `Exception` events on the active span via
  `span.record_exception(exc)` from your handler error paths.
- **Wrap slow internal operations**: any background task or third-party
  client call benefits from a manual child span - the surrounding HTTP span
  already gives you the context.

[base14 Scout](https://base14.io) provides managed OTLP ingestion, dashboards,
and alerting for OpenTelemetry data, so the same guide that gets you spans
locally also gets you a production observability backend with no extra SDK
configuration.

## Complete Example

The full working example with two Litestar services, Postgres, the OTel
collector, Alembic migrations, and end-to-end verification scripts is at
`~/dev/base14/examples/python/litestar-postgres/`. Layout:

```text
litestar-postgres/
├── app/                  # litestar-postgres-app service
│   ├── src/
│   │   ├── main.py            # create_app() factory + module-level `app`
│   │   ├── config.py          # env-driven Settings
│   │   ├── models.py          # Article ORM + Base
│   │   ├── repository.py      # SQLAlchemyAsyncRepository[Article]
│   │   ├── telemetry.py       # OTel Meter + articles.created counter
│   │   ├── logging_config.py  # JSON formatter wired via Litestar LoggingConfig
│   │   ├── controllers/       # health.py, article.py
│   │   └── services/          # notification.py (httpx client)
│   ├── alembic/               # async migrations
│   ├── tests/                 # pytest (12 tests)
│   ├── pyproject.toml         # uv project
│   └── Dockerfile
├── notify/               # litestar-postgres-notify service
│   ├── src/{main.py,logging_config.py,telemetry.py}
│   ├── tests/                 # pytest (2 tests)
│   ├── pyproject.toml
│   └── Dockerfile
├── config/otel-config.yaml    # collector pipeline (debug + Scout)
├── compose.yml                # 4 services
├── Makefile                   # sync/test/lint/format/audit/check + docker-* targets
└── scripts/
    ├── test-api.sh            # CRUD smoke against running stack
    └── verify-scout.sh        # end-to-end OTel pipeline verification
```

To run it:

```bash
cd ~/dev/base14/examples/python/litestar-postgres
cp .env.example .env
# edit .env to set DB_PASSWORD; SCOUT_* vars are optional for local-only dev
make docker-up
./scripts/test-api.sh
make docker-down
```

The `notify` service's `main.py` shows the minimum-viable Litestar OTel setup

- same plugin, same wrapper, no database:

```python title="notify/src/main.py" showLineNumbers
import logging

import msgspec
from litestar import Controller, Litestar, get, post
from litestar.contrib.opentelemetry import OpenTelemetryConfig, OpenTelemetryPlugin

from src.logging_config import build_logging_config
from src.telemetry import notifications_received

logger = logging.getLogger(__name__)


class NotifyPayload(msgspec.Struct):
    article_id: int
    title: str


class HealthController(Controller):
    path = "/health"

    @get("/")
    async def health(self) -> dict[str, str]:
        return {"status": "ok", "service": "litestar-postgres-notify"}


class NotifyController(Controller):
    path = "/notify"

    @post("/", status_code=200)
    async def notify(self, data: NotifyPayload) -> dict[str, object]:
        notifications_received.add(1)
        logger.info(
            "article notification received",
            extra={"article_id": data.article_id, "title": data.title},
        )
        return {"received": True, "article_id": data.article_id}


app = Litestar(
    route_handlers=[HealthController, NotifyController],
    plugins=[OpenTelemetryPlugin(config=OpenTelemetryConfig())],
    logging_config=build_logging_config(),
)
```

## References

- [Litestar OpenTelemetry plugin documentation](https://docs.litestar.dev/2/usage/plugins/opentelemetry.html)
- [OpenTelemetry Python documentation](https://opentelemetry.io/docs/languages/python/)
- [opentelemetry-distro on PyPI](https://pypi.org/project/opentelemetry-distro/)
- [opentelemetry-instrumentation-asyncpg on PyPI](https://pypi.org/project/opentelemetry-instrumentation-asyncpg/)
- [opentelemetry-instrumentation-sqlalchemy on PyPI](https://pypi.org/project/opentelemetry-instrumentation-sqlalchemy/)
- [opentelemetry-instrumentation-httpx on PyPI](https://pypi.org/project/opentelemetry-instrumentation-httpx/)
- [W3C Trace Context specification](https://www.w3.org/TR/trace-context/)
- [base14 Scout](https://base14.io)

## Related Guides

- [FastAPI OpenTelemetry Instrumentation](./fast-api.md) - async Python with
  Pydantic and Starlette routing.
- [Flask OpenTelemetry Instrumentation](./flask.md) - sync Python with WSGI
  for comparison.
- [Django OpenTelemetry Instrumentation](./django.md) - Django ORM,
  middleware, and Celery patterns.
- [Auto-Instrumentation Overview](./index.md) - full list of supported
  frameworks across Python, Node.js, JVM, Go, Ruby, PHP, .NET, and Elixir.
- [Docker Compose Collector Setup](../../collector-setup/docker-compose-example.md)
  - local OTel collector for development.
- [Kubernetes Helm Collector Setup](../../collector-setup/kubernetes-helm-setup.md)
  - production collector deployment.
