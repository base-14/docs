---
title: FastAPI OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: FastAPI
sidebar_position: 6
description:
  Complete guide to FastAPI OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with base14 Scout in minutes.
keywords:
  [
    fastapi opentelemetry instrumentation,
    fastapi monitoring,
    fastapi apm,
    fastapi distributed tracing,
    python fastapi observability,
    fastapi performance monitoring,
    opentelemetry python fastapi,
    fastapi telemetry,
    fastapi metrics,
    fastapi traces,
    fastapi sqlalchemy monitoring,
    fastapi production monitoring,
    python async monitoring,
    fastapi instrumentation guide,
    fastapi application monitoring,
    fastapi opentelemetry setup,
    python web framework monitoring,
    fastapi debugging,
    fastapi observability platform,
    fastapi otlp exporter,
  ]
---

# FastAPI

Implement OpenTelemetry instrumentation for FastAPI applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to auto-instrument your FastAPI
application to collect traces and metrics from HTTP requests, database queries,
and external API calls using the OpenTelemetry Python SDK with minimal code
changes.

FastAPI applications benefit from automatic instrumentation of the framework
itself, as well as popular libraries including SQLAlchemy, Redis, PostgreSQL,
and dozens of commonly used Python components. With OpenTelemetry, you can
monitor production performance, debug slow requests, trace distributed
transactions across microservices, and identify database query bottlenecks
without significant code modifications. The async-native design of FastAPI works
seamlessly with OpenTelemetry's context propagation.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like DataDog or New Relic, or troubleshooting
performance issues in production, this guide provides production-ready
configurations and best practices for FastAPI OpenTelemetry instrumentation.
You'll learn how to set up auto-instrumentation, configure custom spans for
business logic, optimize performance, and deploy with Docker.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for FastAPI applications
- Configure automatic request and response tracing for HTTP endpoints
- Instrument database operations with SQLAlchemy auto-instrumentation
- Implement custom spans for business logic and external API calls
- Collect and export HTTP metrics using custom middleware
- Configure production-ready telemetry with BatchSpanProcessor
- Export telemetry data to base14 Scout via OTLP
- Deploy instrumented applications with Docker and Docker Compose
- Troubleshoot common instrumentation issues
- Optimize performance impact in production environments

## Who This Guide Is For

This documentation is designed for:

- **FastAPI developers**: implementing observability and distributed tracing for
  the first time in async Python applications
- **DevOps engineers**: deploying FastAPI applications with production
  monitoring requirements and container orchestration
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-source observability
- **Backend developers**: debugging performance issues, slow database queries,
  or async operation bottlenecks in FastAPI services
- **Platform teams**: standardizing observability across multiple FastAPI
  microservices with consistent instrumentation patterns

## Prerequisites

Before starting, ensure you have:

- **Python 3.9 or later** installed (Python 3.13+ recommended for best
  performance)
- **FastAPI 0.100.0 or later** installed in your project (0.115.6+ recommended)
- **Scout Collector** configured and accessible from your application
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production deployment
- **Basic understanding** of OpenTelemetry concepts (traces, spans, attributes)
- Access to package installation via `pip` or your preferred package manager

### Compatibility Matrix

| Component                         | Minimum Version | Recommended Version | Notes                                                  |
| --------------------------------- | --------------- | ------------------- | ------------------------------------------------------ |
| **Python**                        | 3.9             | 3.13+               | Python 3.13+ offers best performance and type system   |
| **FastAPI**                       | 0.100.0         | 0.115.6+            | Full Pydantic v2 and modern dependency injection       |
| **OpenTelemetry SDK**             | 1.20.0          | 1.29.0+             | Core SDK for traces and metrics                        |
| **OpenTelemetry Instrumentation** | 0.41b0          | 0.50b0+             | FastAPI auto-instrumentation                           |
| **SQLAlchemy** (optional)         | 1.4+            | 2.0.36+             | For database instrumentation                           |
| **Pydantic**                      | 2.0+            | 2.10+               | Included with FastAPI, v2 required for modern patterns |

### Supported Libraries

OpenTelemetry automatically instruments these commonly used libraries:

- **Web frameworks**: FastAPI, Starlette
- **Databases**: SQLAlchemy, asyncpg, psycopg2, pymongo
- **HTTP clients**: requests, httpx, aiohttp
- **Task queues**: Celery (with additional instrumentation)
- **Caching**: Redis, memcached

## Installation

### Core Packages

Install the required OpenTelemetry packages for FastAPI instrumentation:

```bash
pip install opentelemetry-api
pip install opentelemetry-sdk
pip install opentelemetry-instrumentation-fastapi
pip install opentelemetry-exporter-otlp
```

### Optional Instrumentation Libraries

Add these packages to instrument additional components:

```bash
# HTTP client instrumentation
pip install opentelemetry-instrumentation-requests
pip install opentelemetry-instrumentation-httpx

# Database instrumentation
pip install opentelemetry-instrumentation-sqlalchemy

# Redis instrumentation
pip install opentelemetry-instrumentation-redis
```

### Complete Requirements File

For production applications, add all dependencies to `requirements.txt`:

```plaintext title="requirements.txt" showLineNumbers
# Web framework
fastapi[all]
uvicorn[standard]

# OpenTelemetry core
opentelemetry-api
opentelemetry-sdk
opentelemetry-exporter-otlp

# OpenTelemetry instrumentation
opentelemetry-instrumentation-fastapi
opentelemetry-instrumentation-requests
opentelemetry-instrumentation-sqlalchemy

# Optional: Application dependencies
sqlalchemy
psycopg2-binary
pydantic-settings
```

Then install all dependencies:

```bash
pip install -r requirements.txt
```

## Configuration

FastAPI OpenTelemetry instrumentation can be configured in multiple ways
depending on your application architecture and deployment requirements. This
section covers different setup approaches and advanced configuration options.

### Setup Approaches

Choose the initialization method that best fits your application architecture:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="inline" label="Inline (Quick Start)" default>
```

#### Inline Configuration (Quick Start)

The simplest approach is to configure OpenTelemetry directly in your main
application file. This works well for small applications and development
environments.

```python title="main.py" showLineNumbers
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# Configure trace provider with service name
resource = Resource.create({"service.name": "my-fastapi-service"})
trace.set_tracer_provider(TracerProvider(resource=resource))

# Set up trace exporter
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces")
    )
)

# Create FastAPI app
app = FastAPI()

# Instrument the FastAPI app
FastAPIInstrumentor.instrument_app(app)

@app.get("/")
def root():
    return {"message": "Hello World"}
```

This configuration automatically captures:

- HTTP request method, path, and status code
- Request duration and timing
- Error and exception information
- Request headers (configurable)
- Query parameters and path parameters

```mdx-code-block
</TabItem>
<TabItem value="module" label="Telemetry Module (Recommended)">
```

#### Separate Telemetry Module (Recommended)

For better code organization and reusability, create a dedicated telemetry
module. This approach is recommended for production applications.

```python title="app/telemetry.py" showLineNumbers
import os
from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

def setup_telemetry(otel_endpoint: str) -> None:
    """
    Initialize OpenTelemetry tracing and metrics.

    Args:
        otel_endpoint: OTLP collector endpoint (e.g., "localhost:4318")
    """
    # Get service name from environment or use default
    service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-app")

    # Create resource with service identification
    resource = Resource.create({
        "service.name": service_name,
        "service.version": os.getenv("APP_VERSION", "1.0.0"),
        "deployment.environment": os.getenv("ENVIRONMENT", "development")
    })

    # Configure trace provider
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"http://{otel_endpoint}/v1/traces")
        )
    )
    trace.set_tracer_provider(provider)

    # Configure metrics provider
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"http://{otel_endpoint}/v1/metrics"),
        export_interval_millis=5000  # Export every 5 seconds
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[metric_reader])
    )
```

Then use it in your main application file:

```python title="app/main.py" showLineNumbers
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
import os

from .telemetry import setup_telemetry

# Initialize telemetry before creating the app
otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4318")
setup_telemetry(otel_endpoint)

# Create FastAPI app
app = FastAPI()

# Instrument FastAPI and HTTP clients
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

@app.get("/")
def root():
    return {"message": "Hello World"}
```

```mdx-code-block
</TabItem>
<TabItem value="cli" label="CLI Auto-Instrumentation">
```

#### CLI Auto-Instrumentation (Zero-Code)

The simplest approach for containerized deployments uses the OpenTelemetry CLI
tool for zero-code instrumentation. This is the **recommended starting point**
for new projects.

**Installation:**

```bash
# Install the distro package (includes CLI tools)
pip install opentelemetry-distro
pip install opentelemetry-exporter-otlp

# Bootstrap auto-instrumentation (installs all available instrumentations)
opentelemetry-bootstrap -a install
```

**Development mode** (console output):

```bash
opentelemetry-instrument \
    --traces_exporter console \
    --metrics_exporter console \
    --service_name fastapi-app \
    uvicorn app.main:app --reload
```

**Production mode** (OTLP export):

```bash
# Set environment variables
export OTEL_SERVICE_NAME="fastapi-app"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export OTEL_TRACES_EXPORTER="otlp"
export OTEL_METRICS_EXPORTER="otlp"

# Run with auto-instrumentation (no code changes needed!)
opentelemetry-instrument uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Docker deployment:**

```dockerfile title="Dockerfile" showLineNumbers
FROM python:3.12-slim

WORKDIR /app

# Install dependencies including OpenTelemetry
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install opentelemetry-distro opentelemetry-exporter-otlp && \
    opentelemetry-bootstrap -a install

# Copy application
COPY ./app ./app

# Run with auto-instrumentation
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Advantages:**

- ✅ Zero code changes required
- ✅ Automatic instrumentation of FastAPI, database clients, HTTP clients
- ✅ Easy to enable/disable via environment variables
- ✅ Perfect for containerized deployments

**When to use:** Production deployments where you want automatic instrumentation
without modifying application code.

```mdx-code-block
</TabItem>
</Tabs>
```

### Advanced Configuration

Fine-tune instrumentation behavior for specific requirements:

```mdx-code-block
<Tabs>
<TabItem value="selective" label="Selective Instrumentation" default>
```

#### Selective Instrumentation

To instrument only specific components or exclude certain endpoints:

```python title="main.py" showLineNumbers
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import trace

# ... telemetry setup ...

app = FastAPI()

# Instrument with custom configuration
FastAPIInstrumentor.instrument_app(
    app,
    excluded_urls="/health,/metrics,/docs,/openapi.json",  # Skip these endpoints
    tracer_provider=trace.get_tracer_provider(),
)

@app.get("/health")
def health_check():
    """This endpoint won't be traced"""
    return {"status": "healthy"}

@app.get("/api/users")
def get_users():
    """This endpoint will be traced"""
    return {"users": []}
```

```mdx-code-block
</TabItem>
<TabItem value="hooks" label="Request/Response Hooks">
```

### Approach 5: Request/Response Hooks

Add custom attributes to spans using hooks for advanced use cases:

```python title="app/main.py" showLineNumbers
from typing import Any
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.trace import Span

app = FastAPI()

def server_request_hook(span: Span, scope: dict[str, Any]) -> None:
    """
    Hook called when a request is received.
    Add custom attributes based on request data.
    """
    if span and span.is_recording():
        # Add custom business context
        span.set_attribute("app.user_tier", scope.get("user_tier", "free"))
        span.set_attribute("app.request_id", scope.get("request_id"))

        # Add query parameters as attributes
        query_string = scope.get("query_string", b"").decode()
        if query_string:
            span.set_attribute("http.query_string", query_string)

def client_request_hook(span: Span, scope: dict[str, Any]) -> None:
    """Hook for outbound HTTP requests."""
    if span and span.is_recording():
        span.set_attribute("app.calling_service", "fastapi-app")

def client_response_hook(span: Span, message: dict[str, Any]) -> None:
    """Hook called when a response is received."""
    if span and span.is_recording():
        # Track response metadata
        content_type = message.get("headers", {}).get("content-type")
        if content_type:
            span.set_attribute("http.response.content_type", content_type)

# Instrument with hooks
FastAPIInstrumentor.instrument_app(
    app,
    server_request_hook=server_request_hook,
    client_request_hook=client_request_hook,
    client_response_hook=client_response_hook,
)
```

```mdx-code-block
</TabItem>
<TabItem value="headers" label="HTTP Header Capture">
```

### Approach 6: HTTP Header Capture

Capture and sanitize HTTP headers automatically:

```python title="app/main.py" showLineNumbers
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI()

# Configure header capture with sanitization
FastAPIInstrumentor.instrument_app(
    app,
    # Capture specific request headers (lowercase with underscores)
    http_capture_headers_server_request=[
        "content-type",
        "user-agent",
        "accept",
        "x-request-id",
    ],
    # Capture specific response headers
    http_capture_headers_server_response=[
        "content-type",
        "content-length",
        "x-correlation-id",
    ],
    # IMPORTANT: Sanitize sensitive headers (never capture these)
    # This prevents accidental leaking of secrets
    # Note: Even if listed above, these will be redacted
    excluded_urls="/health,/metrics",
)

# Headers appear as span attributes:
# http.request.header.content_type
# http.request.header.user_agent
# http.response.header.content_type
```

**Security Note:** Never capture authorization headers, cookies, API keys, or
any authentication tokens. Use sanitization to protect sensitive data.

```mdx-code-block
</TabItem>
</Tabs>
```

## Traces

Traces provide the complete picture of what happens when a request flows through
your FastAPI application. They capture the entire lifecycle from the incoming
HTTP request, through your business logic, database queries, external API calls,
and finally the response sent back to the client.

### Automatic Trace Collection

Once instrumented, FastAPI automatically captures detailed trace information for
every request:

**Captured Information:**

- HTTP method, path, and status code
- Request duration and timing breakdown
- Request and response headers (configurable)
- Query parameters and path parameters
- Error and exception stack traces
- Distributed trace context propagation (W3C Trace Context)

**Trace Hierarchy:**

```text
HTTP Request Span (root)
├── Route Handler Span
│   ├── Database Query Span
│   ├── External API Call Span
│   └── Business Logic Span
└── Response Span
```

### Key Tracing Features

- **Automatic HTTP tracking**: Every endpoint is automatically traced with no
  code changes
- **Error capturing**: Exceptions are automatically recorded with full stack
  traces
- **Context propagation**: Distributed traces work across microservices using
  W3C Trace Context headers
- **Custom attributes**: Add business-specific metadata to spans (covered in
  Custom Instrumentation section)
- **Async support**: Full support for FastAPI's async/await patterns

> View traces in your base14 Scout dashboard to analyze request flows and
> identify bottlenecks.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Metrics

OpenTelemetry metrics capture runtime measurements of your FastAPI application
including HTTP request counts, latencies, response status codes, and custom
business metrics. Unlike traces that show individual request flows, metrics
aggregate data over time for monitoring trends and alerting.

### Custom Metrics Middleware

Create a custom middleware to capture HTTP metrics for all requests:

```python title="app/metrics_middleware.py" showLineNumbers
import os
import time
from starlette.middleware.base import BaseHTTPMiddleware
from opentelemetry.metrics import get_meter

class MetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-app")
        self.meter = get_meter(service_name)

        # Create metrics instruments
        self.http_requests_counter = self.meter.create_counter(
            name="http.server.requests",
            unit="1",
            description="Total number of HTTP requests"
        )

        self.http_request_duration = self.meter.create_histogram(
            name="http.server.duration",
            unit="ms",
            description="HTTP request duration in milliseconds"
        )

    async def dispatch(self, request, call_next):
        start_time = time.time()

        # Process request
        response = await call_next(request)

        # Calculate duration
        duration_ms = (time.time() - start_time) * 1000

        # Record metrics with attributes
        attributes = {
            "http.method": request.method,
            "http.route": request.url.path,
            "http.status_code": response.status_code,
        }

        self.http_requests_counter.add(1, attributes)
        self.http_request_duration.record(duration_ms, attributes)

        return response
```

Add the middleware to your FastAPI application:

```python title="app/main.py" showLineNumbers
from fastapi import FastAPI
from .metrics_middleware import MetricsMiddleware
from .telemetry import setup_telemetry

# Initialize telemetry
setup_telemetry("localhost:4318")

app = FastAPI()

# Add metrics middleware BEFORE FastAPI instrumentation
app.add_middleware(MetricsMiddleware)

# Then add FastAPI instrumentation
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
FastAPIInstrumentor.instrument_app(app)
```

### Available Metrics

Once configured, these metrics are automatically collected:

| Metric Name                   | Type          | Description                 | Attributes                 |
| ----------------------------- | ------------- | --------------------------- | -------------------------- |
| `http.server.requests`        | Counter       | Total HTTP requests         | method, route, status_code |
| `http.server.duration`        | Histogram     | Request duration in ms      | method, route, status_code |
| `http.server.active_requests` | UpDownCounter | Currently active requests   | method, route              |
| `http.server.response.size`   | Histogram     | Response body size in bytes | method, route, status_code |

> View these metrics in base14 Scout to create dashboards, set up alerts, and
> monitor application health.

## Production Configuration

Production environments require careful configuration of OpenTelemetry to
balance observability needs with performance and reliability. This section
covers production-ready patterns.

### BatchSpanProcessor Configuration

Configure BatchSpanProcessor parameters for optimal performance:

```python title="app/telemetry.py" showLineNumbers
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# Production-optimized batch processor
batch_processor = BatchSpanProcessor(
    OTLPSpanExporter(endpoint="http://otel-collector:4318/v1/traces"),
    max_queue_size=2048,           # Maximum spans in queue
    schedule_delay_millis=5000,    # Export every 5 seconds
    max_export_batch_size=512,     # Maximum spans per export
    export_timeout_millis=30000    # Timeout for export operation
)

trace.get_tracer_provider().add_span_processor(batch_processor)
```

### Resource Attributes for Production

Add comprehensive resource attributes to identify your service:

```python title="app/telemetry.py" showLineNumbers
import os
import socket
from opentelemetry.sdk.resources import Resource

resource = Resource.create({
    # Service identification
    "service.name": os.getenv("OTEL_SERVICE_NAME", "fastapi-app"),
    "service.version": os.getenv("APP_VERSION", "1.0.0"),
    "service.namespace": os.getenv("SERVICE_NAMESPACE", "production"),

    # Deployment information
    "deployment.environment": os.getenv("ENVIRONMENT", "production"),
    "deployment.region": os.getenv("AWS_REGION", "us-east-1"),

    # Instance identification
    "service.instance.id": socket.gethostname(),
    "host.name": socket.gethostname(),
    "host.type": os.getenv("HOST_TYPE", "container"),

    # Container information (if applicable)
    "container.id": os.getenv("HOSTNAME", ""),
    "container.name": os.getenv("CONTAINER_NAME", ""),

    # Kubernetes information (if applicable)
    "k8s.namespace.name": os.getenv("K8S_NAMESPACE", ""),
    "k8s.pod.name": os.getenv("K8S_POD_NAME", ""),
    "k8s.deployment.name": os.getenv("K8S_DEPLOYMENT_NAME", ""),
})
```

### Environment-Based Configuration

Use environment variables to configure telemetry without code changes:

```python title="app/telemetry.py" showLineNumbers
import os
import logging
from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

logger = logging.getLogger(__name__)

def setup_telemetry() -> None:
    """Initialize telemetry with environment-based configuration."""
    # Get configuration from environment
    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    environment = os.getenv("ENVIRONMENT", "development")
    service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-app")

    # Create resource
    resource = Resource.create({
        "service.name": service_name,
        "deployment.environment": environment,
        "service.version": os.getenv("APP_VERSION", "dev"),
    })

    # Configure trace provider
    provider = TracerProvider(resource=resource)

    # Add exporters based on environment
    if environment == "development":
        # Console exporter for development
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        logger.info("Using console exporter for traces")
    else:
        # OTLP exporter for production/staging
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=f"{otel_endpoint}/v1/traces"),
                max_queue_size=2048,
                schedule_delay_millis=5000,
            )
        )
        logger.info(f"Using OTLP exporter at {otel_endpoint}")

    trace.set_tracer_provider(provider)

    # Configure metrics
    if environment != "development":
        metric_reader = PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint=f"{otel_endpoint}/v1/metrics"),
            export_interval_millis=5000
        )
        metrics.set_meter_provider(
            MeterProvider(resource=resource, metric_readers=[metric_reader])
        )
```

### Docker Compose Configuration

Example `docker-compose.yml` for production-like deployment:

```yaml title="docker-compose.yml" showLineNumbers
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      # Application config
      ENVIRONMENT: production
      APP_VERSION: "1.2.0"

      # OpenTelemetry config
      OTEL_SERVICE_NAME: fastapi-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318

      # Database config
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: myapp
    depends_on:
      - postgres
      - otel-collector
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000

  postgres:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_DB: myapp
    volumes:
      - postgres_data:/var/lib/postgresql/data

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4318:4318" # OTLP HTTP receiver
      - "55679:55679" # zpages for debugging

volumes:
  postgres_data:
```

### Environment Variables Template

Create a `.env.example` file for your team:

```bash title=".env.example" showLineNumbers
# Application
ENVIRONMENT=production
APP_VERSION=1.0.0
SERVICE_NAMESPACE=my-company

# OpenTelemetry
OTEL_SERVICE_NAME=fastapi-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=myapp
DB_USER=postgres
DB_PASSWORD=changeme

# Security (for production, use secrets management)
SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60
```

### Dockerfile with OpenTelemetry

Build a production-ready Docker image:

```dockerfile title="Dockerfile" showLineNumbers
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./app ./app

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/health')"

# Run application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Framework-Specific Features

FastAPI's integration with OpenTelemetry automatically instruments several
framework components and commonly used libraries. This section covers automatic
instrumentation for databases, HTTP clients, and other integrations.

### SQLAlchemy Database Instrumentation

OpenTelemetry automatically instruments SQLAlchemy database queries, providing
detailed visibility into database operations.

**Installation:**

```bash
pip install opentelemetry-instrumentation-sqlalchemy
```

**Automatic Instrumentation:**

```python title="app/database.py" showLineNumbers
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

# Create database engine
DATABASE_URL = "postgresql://user:password@localhost:5432/mydb"
engine = create_engine(DATABASE_URL)

# Instrument SQLAlchemy BEFORE creating sessions
SQLAlchemyInstrumentor().instrument(
    engine=engine,
    service="fastapi-app",
    enable_commenter=True,  # Add SQL comments with trace context
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

This automatically captures:

- SQL query text with parameters
- Query execution time
- Database connection details
- Transaction boundaries
- N+1 query detection (via span hierarchy)

**Example Traced Query:**

```python title="app/routers/users.py" showLineNumbers
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import SessionLocal
from .. import models

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/users/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    # This query is automatically traced with full SQL details
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

### HTTP Client Instrumentation

Trace outbound HTTP requests to external APIs and services.

**For `requests` library:**

```bash
pip install opentelemetry-instrumentation-requests
```

```python title="app/main.py" showLineNumbers
from opentelemetry.instrumentation.requests import RequestsInstrumentor

# Instrument requests library globally
RequestsInstrumentor().instrument()

# Now all requests calls are automatically traced
import requests

@app.get("/external-api")
async def call_external_api():
    # This HTTP call is automatically traced
    response = requests.get("https://api.example.com/data")
    return response.json()
```

**For `httpx` library (async HTTP):**

```bash
pip install opentelemetry-instrumentation-httpx
```

```python title="app/main.py" showLineNumbers
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
import httpx

# Instrument httpx globally
HTTPXClientInstrumentor().instrument()

@app.get("/async-external-api")
async def call_async_external_api():
    async with httpx.AsyncClient() as client:
        # This async HTTP call is automatically traced
        response = await client.get("https://api.example.com/data")
        return response.json()
```

### Dependency Injection with Tracing

FastAPI's dependency injection system works seamlessly with OpenTelemetry:

```python title="app/dependencies.py" showLineNumbers
from typing import Annotated
from fastapi import Depends, Header, HTTPException
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

def get_current_user(token: Annotated[str, Header()]) -> dict[str, str]:
    """Dependency that validates user token - automatically traced"""
    with tracer.start_as_current_span("validate_user_token"):
        # Token validation logic
        if not validate_token(token):
            raise HTTPException(status_code=401, detail="Invalid token")
        return get_user_from_token(token)

@app.get("/protected")
def protected_endpoint(
    user: Annotated[dict[str, str], Depends(get_current_user)]
) -> dict[str, dict[str, str]]:
    """The dependency span appears as a child of the HTTP request span"""
    return {"user": user}
```

### Background Tasks with Tracing

Trace FastAPI background tasks:

```python title="app/main.py" showLineNumbers
from fastapi import BackgroundTasks
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

def send_email(email: str, message: str) -> None:
    """Background task - create manual span"""
    with tracer.start_as_current_span("send_email") as span:
        span.set_attribute("email.to", email)
        span.set_attribute("email.message_length", len(message))
        # Email sending logic
        print(f"Sending email to {email}")

@app.post("/register")
async def register_user(
    email: str,
    background_tasks: BackgroundTasks
) -> dict[str, str]:
    # Add background task
    background_tasks.add_task(send_email, email, "Welcome!")
    return {"message": "User registered"}
```

## Custom Instrumentation

While auto-instrumentation captures HTTP requests and database queries, custom
instrumentation lets you trace business logic, add contextual attributes, and
instrument specific operations.

### Creating Custom Spans

Add manual spans to trace specific operations:

```python title="app/services/order_service.py" showLineNumbers
from typing import Annotated
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from opentelemetry import trace

router = APIRouter()
tracer = trace.get_tracer(__name__)

class OrderCreate(BaseModel):
    product_id: int
    quantity: int
    payment_method: str
    order_type: str
    amount: float

class OrderResponse(BaseModel):
    order_id: int
    status: str

@router.post("/orders")
async def create_order(
    order: Annotated[OrderCreate, Body()]
) -> OrderResponse:
    # Parent span is automatically the HTTP request span
    with tracer.start_as_current_span("create_order") as span:
        # Add custom attributes
        span.set_attribute("order.type", order.order_type)
        span.set_attribute("order.amount", order.amount)
        span.set_attribute("order.quantity", order.quantity)

        # Nested span for inventory check
        with tracer.start_as_current_span("check_inventory") as inventory_span:
            inventory_span.set_attribute("product.id", order.product_id)
            available = await check_product_availability(order.product_id)
            inventory_span.set_attribute("inventory.available", available)

            if not available:
                span.set_status(trace.Status(trace.StatusCode.ERROR, "Out of stock"))
                raise HTTPException(status_code=400, detail="Product out of stock")

        # Nested span for payment processing
        with tracer.start_as_current_span("process_payment") as payment_span:
            payment_span.set_attribute("payment.method", order.payment_method)
            payment_result = await process_payment(order)
            payment_span.set_attribute("payment.transaction_id", payment_result["transaction_id"])

        span.add_event("Order created successfully")
        return OrderResponse(order_id=123, status="created")
```

### Adding Custom Attributes

Enrich spans with business-specific metadata:

```python title="app/routers/posts.py" showLineNumbers
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from opentelemetry import trace

router = APIRouter()

class Post(BaseModel):
    id: int
    title: str
    author_id: int
    category: str
    published: bool

@router.get("/posts/{post_id}")
async def get_post(post_id: int) -> Post:
    # Get current span (automatically created by FastAPI instrumentation)
    current_span = trace.get_current_span()

    # Add custom attributes to existing span
    current_span.set_attribute("post.id", post_id)
    current_span.set_attribute("user.action", "view_post")

    # Fetch post
    post = await fetch_post_from_db(post_id)

    if not post:
        current_span.set_attribute("post.found", False)
        raise HTTPException(status_code=404, detail="Post not found")

    current_span.set_attribute("post.found", True)
    current_span.set_attribute("post.author_id", post.author_id)
    current_span.set_attribute("post.category", post.category)
    current_span.set_attribute("post.published", post.published)

    return post
```

### Error Handling and Status

Record errors and exceptions in spans:

```python title="app/services/external_api.py" showLineNumbers
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
import requests

tracer = trace.get_tracer(__name__)

def call_external_service(url: str):
    with tracer.start_as_current_span("external_api_call") as span:
        span.set_attribute("http.url", url)

        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()

            span.set_attribute("http.status_code", response.status_code)
            span.set_status(Status(StatusCode.OK))

            return response.json()

        except requests.exceptions.Timeout as e:
            # Record exception details
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, "Request timeout"))
            raise

        except requests.exceptions.HTTPError as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, f"HTTP {response.status_code}"))
            raise

        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, "Unknown error"))
            raise
```

### Span Events

Add timestamped events to spans for debugging:

```python title="app/services/data_processor.py" showLineNumbers
from typing import Any
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

async def process_large_dataset(data: list[dict[str, Any]]) -> dict[str, int]:
    """Process large dataset in chunks with tracing."""
    with tracer.start_as_current_span("process_dataset") as span:
        span.set_attribute("dataset.size", len(data))
        span.add_event("Processing started")

        # Process in chunks
        chunk_size = 100
        processed_count = 0

        for i in range(0, len(data), chunk_size):
            chunk = data[i:i + chunk_size]
            await process_chunk(chunk)
            processed_count += len(chunk)

            # Add event for each chunk
            span.add_event(
                "Chunk processed",
                attributes={
                    "chunk.index": i // chunk_size,
                    "chunk.size": len(chunk),
                    "total.processed": processed_count
                }
            )

        span.add_event("Processing completed")
        span.set_attribute("dataset.processed", processed_count)
        return {"processed": processed_count}
```

### Semantic Conventions

Use OpenTelemetry semantic conventions for consistent attribute naming:

```python title="app/services/user_service.py" showLineNumbers
from opentelemetry import trace
from opentelemetry.semconv.trace import SpanAttributes

tracer = trace.get_tracer(__name__)

@app.post("/login")
async def login(username: str, password: str):
    with tracer.start_as_current_span("user.login") as span:
        # Use semantic conventions for HTTP attributes
        span.set_attribute(SpanAttributes.HTTP_METHOD, "POST")
        span.set_attribute(SpanAttributes.HTTP_ROUTE, "/login")

        # Use semantic conventions for user attributes
        span.set_attribute(SpanAttributes.ENDUSER_ID, username)

        # Authentication logic
        if authenticate(username, password):
            span.set_attribute("auth.success", True)
            return {"token": generate_token(username)}
        else:
            span.set_attribute("auth.success", False)
            span.set_status(Status(StatusCode.ERROR, "Authentication failed"))
            raise HTTPException(status_code=401, detail="Invalid credentials")
```

## Running Your Application

### Development Mode

Run with console output for local development:

```python title="app/telemetry.py" showLineNumbers
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, BatchSpanProcessor

# Development configuration - print spans to console
if os.getenv("ENVIRONMENT") == "development":
    console_processor = BatchSpanProcessor(ConsoleSpanExporter())
    trace.get_tracer_provider().add_span_processor(console_processor)
```

Start the application:

```bash
# Set environment to development
export ENVIRONMENT=development
export OTEL_SERVICE_NAME=fastapi-app

# Run with uvicorn
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Production Mode

Run with OTLP exporter pointing to Scout Collector:

```bash
# Set production environment variables
export ENVIRONMENT=production
export OTEL_SERVICE_NAME=fastapi-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export APP_VERSION=1.0.0

# Run with production settings
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Docker Deployment

Build and run with Docker:

```bash
# Build image
docker build -t fastapi-app:latest .

# Run container
docker run -d \
  --name fastapi-app \
  -p 8000:8000 \
  -e OTEL_SERVICE_NAME=fastapi-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  -e ENVIRONMENT=production \
  fastapi-app:latest
```

Or use Docker Compose (see Production Configuration section above).

## Troubleshooting

### Verifying Instrumentation

Create a test endpoint to verify OpenTelemetry is working:

```python title="app/main.py" showLineNumbers
from opentelemetry import trace

@app.get("/health")
def health_check():
    """Health check endpoint that verifies tracing"""
    current_span = trace.get_current_span()

    if current_span.is_recording():
        return {
            "status": "healthy",
            "tracing": "enabled",
            "trace_id": format(current_span.get_span_context().trace_id, '032x'),
            "span_id": format(current_span.get_span_context().span_id, '016x')
        }
    else:
        return {
            "status": "healthy",
            "tracing": "disabled"
        }
```

### Common Issues

#### Issue: No traces appearing in Scout

**Solutions:**

1. Verify OTLP endpoint is accessible:

   ```bash
   curl http://otel-collector:4318/v1/traces
   ```

2. Check telemetry initialization happens before FastAPI app creation:

   ```python
   # Correct order:
   setup_telemetry()  # First
   app = FastAPI()    # Second
   FastAPIInstrumentor.instrument_app(app)  # Third
   ```

3. Enable console exporter to verify spans are being created:

   ```python
   from opentelemetry.sdk.trace.export import ConsoleSpanExporter
   trace.get_tracer_provider().add_span_processor(
       BatchSpanProcessor(ConsoleSpanExporter())
   )
   ```

#### Issue: ImportError for OpenTelemetry packages

**Solutions:**

1. Verify all packages are installed:

   ```bash
   pip list | grep opentelemetry
   ```

2. Reinstall with specific versions:

   ```bash
   pip install --upgrade opentelemetry-api opentelemetry-sdk
   pip install --upgrade opentelemetry-instrumentation-fastapi
   ```

3. Check for conflicting packages:

   ```bash
   pip check
   ```

#### Issue: Database queries not traced

**Solutions:**

1. Ensure SQLAlchemy instrumentation is called BEFORE creating the engine:

   ```python
   from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

   engine = create_engine(DATABASE_URL)
   SQLAlchemyInstrumentor().instrument(engine=engine)
   ```

2. Verify the instrumentation package is installed:

   ```bash
   pip install opentelemetry-instrumentation-sqlalchemy
   ```

#### Issue: High memory usage or performance degradation

**Solutions:**

1. Configure BatchSpanProcessor with appropriate limits:

   ```python
   batch_processor = BatchSpanProcessor(
       exporter,
       max_queue_size=2048,        # Reduce if memory is constrained
       schedule_delay_millis=5000,  # Increase to batch more spans
       max_export_batch_size=512
   )
   ```

2. Exclude high-volume endpoints:

   ```python
   FastAPIInstrumentor.instrument_app(
       app,
       excluded_urls="/health,/metrics"
   )
   ```

#### Issue: Middleware ordering problems

**Solution:** Ensure correct middleware order (metrics before instrumentation):

```python
app = FastAPI()
app.add_middleware(MetricsMiddleware)  # Custom middleware first
FastAPIInstrumentor.instrument_app(app)  # Then instrument
```

## Security Considerations

### Sensitive Data in Spans

Avoid capturing sensitive information in span attributes:

**Bad Example:**

```python
# DON'T DO THIS
span.set_attribute("user.password", password)
span.set_attribute("credit_card.number", card_number)
span.set_attribute("user.ssn", ssn)
```

**Good Example:**

```python
# DO THIS INSTEAD
span.set_attribute("user.id", user_id)  # Reference, not sensitive data
span.set_attribute("payment.method", "credit_card")  # Type, not details
span.set_attribute("user.email_domain", email.split("@")[1])  # Partial info
```

### HTTP Header Filtering

Filter sensitive headers from traces:

```python title="app/telemetry.py" showLineNumbers
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

# Exclude sensitive headers from capture
FastAPIInstrumentor.instrument_app(
    app,
    http_capture_headers_server_request=["content-type", "user-agent"],
    # DO NOT include: authorization, cookie, api-key, etc.
)
```

### SQL Query Obfuscation

SQLAlchemy instrumentation automatically obfuscates query parameters, but verify
this is enabled:

```python title="app/database.py" showLineNumbers
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

SQLAlchemyInstrumentor().instrument(
    engine=engine,
    enable_commenter=True,
    # Query parameters are automatically obfuscated
)
```

### Environment Variable Security

Never commit sensitive values to version control:

```bash title=".env" showLineNumbers
# ❌ BAD - Don't commit this file
SECRET_KEY=actual-secret-key
DB_PASSWORD=actual-password

# ✅ GOOD - Use secrets management in production
# AWS Secrets Manager, Vault, Kubernetes Secrets, etc.
```

In production, use environment-specific secrets management:

- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets
- Azure Key Vault

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead when properly configured:

| Metric      | Impact               | Notes                     |
| ----------- | -------------------- | ------------------------- |
| **Latency** | +0.5-2ms per request | Mostly from span creation |
| **CPU**     | +2-5%                | Primarily during export   |
| **Memory**  | +10-50MB             | BatchSpanProcessor queue  |
| **Network** | +1-5KB per trace     | OTLP compressed payload   |

### Optimization Strategies

#### 1. Use BatchSpanProcessor in Production

Always use `BatchSpanProcessor` (never `SimpleSpanProcessor`) for production:

```python title="app/telemetry.py" showLineNumbers
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# ✅ GOOD - Batches spans for efficient export
batch_processor = BatchSpanProcessor(
    exporter,
    max_queue_size=2048,
    schedule_delay_millis=5000,
    max_export_batch_size=512
)

# ❌ BAD - Exports each span immediately (only for debugging)
# simple_processor = SimpleSpanProcessor(exporter)
```

#### 2. Skip Non-Critical Endpoints

Exclude health checks and metrics endpoints:

```python title="app/main.py" showLineNumbers
FastAPIInstrumentor.instrument_app(
    app,
    excluded_urls="/health,/metrics,/favicon.ico,/docs,/openapi.json"
)
```

#### 3. Limit Attribute Sizes

Prevent large attributes from consuming memory:

```python title="app/services/data_service.py" showLineNumbers
def add_safe_attribute(span, key: str, value: str, max_length: int = 256):
    """Add attribute with size limit"""
    if isinstance(value, str) and len(value) > max_length:
        value = value[:max_length] + "... (truncated)"
    span.set_attribute(key, value)

# Usage
span = trace.get_current_span()
add_safe_attribute(span, "response.body", large_response)
```

#### 5. Optimize Database Instrumentation

For high-traffic endpoints with many queries:

```python title="app/database.py" showLineNumbers
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

# Disable commenter for performance (optional)
SQLAlchemyInstrumentor().instrument(
    engine=engine,
    enable_commenter=False,  # Reduces overhead slightly
)
```

## FAQ

### Does FastAPI instrumentation work with async/await?

Yes, OpenTelemetry fully supports FastAPI's async/await patterns. Context
propagation works automatically across async operations, ensuring parent-child
span relationships are maintained correctly.

### What is the performance impact of instrumentation?

Typical overhead is 0.5-2ms added latency per request, 2-5% CPU increase, and
10-50MB additional memory. This impact is minimal and acceptable for most
production applications.

### Which Python and FastAPI versions are supported?

- **Python**: 3.9+ minimum (Python 3.13+ recommended for best performance)
- **FastAPI**: 0.100.0+ (0.115.6+ recommended for Pydantic v2)
- **OpenTelemetry**: SDK 1.20.0+ (1.29.0+ recommended, always use latest stable)

### How do I instrument SQLAlchemy database queries?

Install `opentelemetry-instrumentation-sqlalchemy` and instrument your engine:

```python
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
SQLAlchemyInstrumentor().instrument(engine=engine)
```

All queries will automatically be traced with full SQL details.

### How does distributed tracing work across microservices?

OpenTelemetry uses W3C Trace Context headers (`traceparent`, `tracestate`) to
propagate trace context between services. FastAPI instrumentation automatically
extracts and injects these headers, enabling distributed traces across your
entire system.

### What's the difference between traces and metrics?

- **Traces**: Show individual request flows with detailed timing (e.g., "this
  specific request took 150ms")
- **Metrics**: Aggregate measurements over time (e.g., "average response time is
  120ms")

Use both: traces for debugging specific issues, metrics for monitoring overall
health.

### How do I debug N+1 database query problems?

View the span hierarchy in base14 Scout. N+1 queries appear as many sequential
database spans under a single parent span. The trace visualization clearly shows
the query pattern, making N+1 issues obvious.

### Can I use OpenTelemetry with Pydantic v2?

Yes, OpenTelemetry works with both Pydantic v1 and v2. FastAPI automatically
handles Pydantic model serialization, and instrumentation captures the HTTP
layer regardless of Pydantic version.

### How do I instrument background tasks and Celery?

For FastAPI background tasks, manually create spans (see Background Tasks
section). For Celery, install `opentelemetry-instrumentation-celery`:

```bash
pip install opentelemetry-instrumentation-celery
```

### Does instrumentation affect WebSocket connections?

FastAPI WebSocket connections are automatically traced. Each WebSocket
connection creates a long-lived span that tracks the entire connection duration
and messages exchanged.

### How do I handle multi-tenancy in traces?

Add tenant identification to resource attributes or span attributes:

```python
span.set_attribute("tenant.id", tenant_id)
span.set_attribute("tenant.name", tenant_name)
```

Then filter and query by tenant in base14 Scout.

## What's Next?

### Advanced Topics

- [Python Custom Instrumentation](../custom-instrumentation/python.md) - Manual
  spans, metrics, and advanced patterns
- [OpenTelemetry Collector Configuration](../../collector-setup/otel-collector-config.md)
  \- Advanced collector features

### base14 Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts based on traces and metrics
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production Kubernetes deployment
- [Scout Exporter Configuration](../../collector-setup/scout-exporter.md) -
  Configure authentication and endpoints

## Complete Example

Here's a complete production-ready FastAPI application with OpenTelemetry
instrumentation:

### Complete requirements.txt

```plaintext title="requirements.txt" showLineNumbers
# Web framework
fastapi[all]==0.115.6
uvicorn[standard]==0.32.0

# Database
sqlalchemy==2.0.36
psycopg2-binary==2.9.10
alembic==1.14.0

# Authentication
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
python-multipart==0.0.20

# OpenTelemetry core
opentelemetry-api==1.29.0
opentelemetry-sdk==1.29.0
opentelemetry-exporter-otlp==1.29.0

# OpenTelemetry instrumentation
opentelemetry-instrumentation-fastapi==0.50b0
opentelemetry-instrumentation-sqlalchemy==0.50b0
opentelemetry-instrumentation-requests==0.50b0
opentelemetry-instrumentation-httpx==0.50b0

# Utilities
pydantic==2.10.3
pydantic-settings==2.6.1
python-dotenv==1.0.1
```

### Complete telemetry.py

```python title="app/telemetry.py" showLineNumbers
import os
import socket
from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

def setup_telemetry(otel_endpoint: str = None):
    """
    Initialize OpenTelemetry tracing and metrics with production-ready configuration.

    Args:
        otel_endpoint: OTLP collector endpoint (e.g., "localhost:4318")
    """
    # Get configuration from environment
    service_name = os.getenv("OTEL_SERVICE_NAME", "fastapi-app")
    environment = os.getenv("ENVIRONMENT", "development")
    otel_endpoint = otel_endpoint or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4318")

    # Create comprehensive resource attributes
    resource = Resource.create({
        "service.name": service_name,
        "service.version": os.getenv("APP_VERSION", "1.0.0"),
        "service.namespace": os.getenv("SERVICE_NAMESPACE", "default"),
        "deployment.environment": environment,
        "service.instance.id": socket.gethostname(),
        "host.name": socket.gethostname(),
    })

    # Configure trace provider
    provider = TracerProvider(resource=resource)

    # Add OTLP exporter for production/staging
    if environment in ["production", "staging"]:
        otlp_processor = BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"http://{otel_endpoint}/v1/traces"),
            max_queue_size=2048,
            schedule_delay_millis=5000,
            max_export_batch_size=512,
            export_timeout_millis=30000
        )
        provider.add_span_processor(otlp_processor)
    else:
        # Add console exporter for development
        console_processor = BatchSpanProcessor(ConsoleSpanExporter())
        provider.add_span_processor(console_processor)

    trace.set_tracer_provider(provider)

    # Configure metrics provider
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"http://{otel_endpoint}/v1/metrics"),
        export_interval_millis=5000
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[metric_reader])
    )

    print(f"✅ OpenTelemetry initialized: {service_name} ({environment})")
```

### Complete main.py

```python title="app/main.py" showLineNumbers
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

from .telemetry import setup_telemetry
from .metrics_middleware import MetricsMiddleware
from .database import engine
from .routers import users, posts

# Initialize telemetry FIRST
otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4318")
setup_telemetry(otel_endpoint)

# Instrument SQLAlchemy
SQLAlchemyInstrumentor().instrument(engine=engine)

# Create FastAPI app
app = FastAPI(
    title="FastAPI with OpenTelemetry",
    version="1.0.0",
    description="Production-ready FastAPI with full observability"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add custom metrics middleware
app.add_middleware(MetricsMiddleware)

# Instrument FastAPI (excludes health/metrics endpoints)
FastAPIInstrumentor.instrument_app(
    app,
    excluded_urls="/health,/metrics"
)

# Instrument HTTP clients
RequestsInstrumentor().instrument()

# Include routers
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(posts.router, prefix="/api", tags=["posts"])

@app.get("/")
def root():
    return {"message": "Hello World", "status": "operational"}

@app.get("/health")
def health_check():
    from opentelemetry import trace
    current_span = trace.get_current_span()

    return {
        "status": "healthy",
        "tracing": "enabled" if current_span.is_recording() else "disabled"
    }
```

### Repository Link

A complete working example with database integration, authentication, and full
instrumentation is available at:

[GitHub: base-14/examples/python/fastapi-postgres](https://github.com/base-14/examples/tree/main/python/fastapi-postgres)

## References

- [Official OpenTelemetry Python Documentation](https://opentelemetry.io/docs/languages/python/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Python Instrumentation](../custom-instrumentation/python.md) - Manual
  instrumentation for advanced use cases
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment guide
