---
title: Celery OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Celery
sidebar_position: 2
description:
  Complete guide to Celery OpenTelemetry instrumentation for distributed task
  queue monitoring. Set up auto-instrumentation for traces, metrics, and
  production deployments with base14 Scout in minutes.
keywords:
  [
    celery opentelemetry instrumentation,
    celery monitoring,
    python celery apm,
    celery distributed tracing,
    celery task queue monitoring,
    opentelemetry celery,
    celery worker monitoring,
    celery performance monitoring,
    python task queue observability,
    celery rabbitmq monitoring,
    celery redis monitoring,
    celery production monitoring,
    celery metrics,
    celery tracing,
    python opentelemetry sdk,
    celery instrumentation guide,
    distributed task tracing,
    async task monitoring,
    celery observability,
  ]
---

# Celery

Implement OpenTelemetry instrumentation for Celery applications to enable
comprehensive distributed task queue monitoring, end-to-end tracing, and
observability. This guide shows you how to auto-instrument your Celery workers
and task producers to collect traces and metrics from task execution, message
queues, and result backends using the OpenTelemetry Python SDK.

Celery applications benefit from automatic instrumentation that captures task
lifecycle events including task publishing, worker processing, retries, and
failures. With OpenTelemetry, you can trace distributed transactions from HTTP
requests through message brokers (RabbitMQ, Redis) to worker execution, monitor
task performance and queue depths, debug slow or failing tasks, and identify
bottlenecks in your async processing pipeline without significant code changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting production issues with distributed
task queues, this guide provides production-ready configurations and best
practices for Celery OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Celery-focused overview based on the
> official OpenTelemetry documentation. For complete Python language
> information, please consult the
> [official OpenTelemetry Python documentation](https://opentelemetry.io/docs/languages/python/).

## Who This Guide Is For

This documentation is designed for:

- **Python developers**: implementing observability for Celery task queues and
  distributed systems for the first time
- **DevOps engineers**: deploying Celery workers with production monitoring
  requirements and distributed tracing needs
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to OpenTelemetry
- **Developers**: debugging slow tasks, failed retries, or tracing issues across
  HTTP requests and async task execution
- **Platform teams**: standardizing observability across multiple Python
  services using Celery for background processing

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK for Celery applications
- Set up automatic instrumentation for task publishing and worker execution
- Propagate trace context across async boundaries (HTTP → Celery → Worker)
- Configure production-ready telemetry export to Scout Collector
- Implement custom instrumentation for business-critical task operations
- Collect and analyze traces, metrics, and logs from distributed task processing
- Deploy instrumented Celery workers to development, staging, and production
- Troubleshoot common instrumentation issues and optimize performance
- Secure sensitive data in telemetry exports

## Prerequisites

Before starting, ensure you have:

- **Python 3.9 or later** installed
  - Python 3.11+ is recommended for best performance
  - Python 3.13 is fully supported
- **Celery 5.3 or later** installed
  - Celery 5.4+ is recommended for optimal OpenTelemetry support
- **Message broker** configured (RabbitMQ or Redis)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - Production deployments should use a dedicated Scout Collector instance
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component        | Minimum Version | Recommended Version |
| ---------------- | --------------- | ------------------- |
| Python           | 3.9.0           | 3.11.0+             |
| Celery           | 5.3.0           | 5.4.0+              |
| RabbitMQ         | 3.8.0           | 3.13.0+             |
| Redis            | 6.0.0           | 7.0.0+              |
| opentelemetry-\* | 1.20.0          | 1.27.0+             |

## Required Packages

Install the following packages using pip or add them to your `requirements.txt`:

```plaintext showLineNumbers title="requirements.txt"
opentelemetry-api
opentelemetry-sdk
opentelemetry-exporter-otlp
opentelemetry-instrumentation-celery
```

For comprehensive auto-instrumentation including Redis, SQLAlchemy, and other
libraries commonly used with Celery:

```plaintext showLineNumbers title="requirements.txt"
opentelemetry-distro
opentelemetry-exporter-otlp
opentelemetry-instrumentation-celery
opentelemetry-instrumentation-redis
opentelemetry-instrumentation-sqlalchemy
opentelemetry-instrumentation-logging
```

Install with pip:

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp \
    opentelemetry-instrumentation-celery opentelemetry-instrumentation-redis
```

Or using Poetry:

```bash
poetry add opentelemetry-distro opentelemetry-exporter-otlp \
    opentelemetry-instrumentation-celery opentelemetry-instrumentation-redis
```

## Configuration

OpenTelemetry Celery instrumentation can be configured using multiple approaches
depending on your deployment requirements and preferences. Choose the method
that best fits your application architecture.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="cli" label="CLI Auto-Instrumentation (Recommended)" default>
```

The recommended approach uses the `opentelemetry-instrument` CLI command which
automatically instruments all supported libraries without code changes:

```bash showLineNumbers
# Start Celery worker with auto-instrumentation
opentelemetry-instrument celery -A myapp.tasks worker --loglevel=info
```

Configure via environment variables:

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=celery-worker
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
```

This approach automatically instruments:

- **Celery**: Task execution, worker operations, task publishing
- **Redis**: Result backend operations, broker commands
- **SQLAlchemy**: Database queries within tasks
- **Logging**: Trace-correlated log records

```mdx-code-block
</TabItem>
<TabItem value="signal" label="Worker Signal Handler">
```

For more control over instrumentation timing, use Celery's `worker_process_init`
signal:

```python showLineNumbers title="myapp/telemetry.py"
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    """Initialize tracing for Celery worker processes."""
    CeleryInstrumentor().instrument()
```

Import this module in your Celery app to ensure it runs on worker startup:

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from . import telemetry  # Import to trigger signal registration

app = Celery("tasks", broker="amqp://localhost")

@app.task
def process_task(task_id: int):
    return {"task_id": task_id, "status": "completed"}
```

```mdx-code-block
</TabItem>
<TabItem value="programmatic" label="Programmatic Configuration">
```

For full control over OpenTelemetry configuration:

```python showLineNumbers title="myapp/telemetry.py"
import os
from celery.signals import worker_process_init
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

def init_telemetry():
    """Initialize OpenTelemetry tracing and metrics."""
    service_name = os.getenv("OTEL_SERVICE_NAME", "celery-worker")
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

    resource = Resource(attributes={
        ResourceAttributes.SERVICE_NAME: service_name,
        ResourceAttributes.SERVICE_VERSION: "1.0.0",
    })

    # Setup trace provider with batch processor
    trace.set_tracer_provider(TracerProvider(resource=resource))
    tracer_provider = trace.get_tracer_provider()

    span_exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
    span_processor = BatchSpanProcessor(span_exporter)
    tracer_provider.add_span_processor(span_processor)

    # Setup metrics provider
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics")
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[metric_reader])
    )

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    """Initialize tracing for Celery worker processes."""
    init_telemetry()
    CeleryInstrumentor().instrument()
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables Only">
```

For containerized deployments, rely entirely on environment variables with
minimal code:

```python showLineNumbers title="myapp/telemetry.py"
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    CeleryInstrumentor().instrument()
```

Configure all settings via environment:

```bash showLineNumbers title=".env"
# Service identification
OTEL_SERVICE_NAME=celery-worker
OTEL_SERVICE_VERSION=1.0.0

# Exporter configuration
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_COMPRESSION=gzip

# Enable all exporters
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp

# Resource attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=myapp
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Scout Collector Integration

When using Scout Collector, configure your Celery application to send telemetry
data to the Scout Collector endpoint:

```python showLineNumbers title="myapp/telemetry.py"
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

def init_telemetry():
    """Initialize OpenTelemetry with Scout Collector."""
    resource = Resource(attributes={
        ResourceAttributes.SERVICE_NAME: os.getenv("OTEL_SERVICE_NAME", "celery-worker"),
        ResourceAttributes.SERVICE_VERSION: os.getenv("APP_VERSION", "1.0.0"),
    })

    # Scout Collector endpoint
    scout_endpoint = os.getenv("SCOUT_COLLECTOR_ENDPOINT", "http://localhost:4318")

    trace.set_tracer_provider(TracerProvider(resource=resource))
    tracer_provider = trace.get_tracer_provider()

    span_exporter = OTLPSpanExporter(endpoint=f"{scout_endpoint}/v1/traces")
    span_processor = BatchSpanProcessor(span_exporter)
    tracer_provider.add_span_processor(span_processor)
```

> **Scout Dashboard Integration**: After configuration, your Celery task traces
> will appear in the Scout Dashboard. Navigate to the Traces section to view
> task execution flows, identify slow tasks, and analyze distributed
> transactions across your services.

## Production Configuration

Production deployments require additional configuration for optimal performance,
reliability, and resource utilization.

### Batch Span Processor (Recommended for Production)

The `BatchSpanProcessor` is essential for production as it reduces network
overhead by batching span exports:

```python showLineNumbers title="myapp/telemetry.py"
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes
import os

def init_telemetry():
    """Initialize OpenTelemetry with production settings."""
    resource = Resource(attributes={
        ResourceAttributes.SERVICE_NAME: os.getenv("OTEL_SERVICE_NAME"),
        ResourceAttributes.SERVICE_VERSION: os.getenv("APP_VERSION", "1.0.0"),
        ResourceAttributes.DEPLOYMENT_ENVIRONMENT: os.getenv("ENVIRONMENT", "production"),
    })

    trace.set_tracer_provider(TracerProvider(resource=resource))
    tracer_provider = trace.get_tracer_provider()

    # Configure batch processor for production
    span_processor = BatchSpanProcessor(
        OTLPSpanExporter(
            endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        ),
        max_queue_size=2048,           # Maximum spans in queue
        schedule_delay_millis=5000,    # Export every 5 seconds
        export_timeout_millis=30000,   # 30 second timeout
        max_export_batch_size=512      # Export up to 512 spans at once
    )
    tracer_provider.add_span_processor(span_processor)
```

### Resource Attributes

Add rich context to all telemetry data:

```python showLineNumbers title="myapp/telemetry.py"
import socket
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

resource = Resource(attributes={
    ResourceAttributes.SERVICE_NAME: os.getenv("OTEL_SERVICE_NAME", "celery-worker"),
    ResourceAttributes.SERVICE_VERSION: os.getenv("APP_VERSION", "1.0.0"),
    ResourceAttributes.DEPLOYMENT_ENVIRONMENT: os.getenv("ENVIRONMENT", "production"),
    ResourceAttributes.SERVICE_NAMESPACE: os.getenv("SERVICE_NAMESPACE", "myapp"),
    ResourceAttributes.SERVICE_INSTANCE_ID: socket.gethostname(),
    ResourceAttributes.HOST_NAME: socket.gethostname(),
    "cloud.provider": os.getenv("CLOUD_PROVIDER", "aws"),
    "cloud.region": os.getenv("AWS_REGION", "us-east-1"),
    "k8s.pod.name": os.getenv("K8S_POD_NAME"),
    "k8s.namespace.name": os.getenv("K8S_NAMESPACE"),
})
```

### Production Environment Variables

```bash showLineNumbers title=".env.production"
# Service Configuration
OTEL_SERVICE_NAME=celery-worker-production
APP_VERSION=2.1.3
SERVICE_NAMESPACE=production
ENVIRONMENT=production

# Scout Collector Endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4318

# Batch Processor Settings
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Exporter Settings
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_EXPORTER_OTLP_TIMEOUT=30000

# Celery Configuration
CELERY_BROKER_URL=amqp://user:pass@rabbitmq:5672//
CELERY_RESULT_BACKEND=redis://redis:6379/0

# Infrastructure Context
CLOUD_PROVIDER=aws
AWS_REGION=us-east-1
```

### Docker Production Configuration

```dockerfile showLineNumbers title="Dockerfile"
FROM python:3.13-slim

RUN groupadd -r celeryuser && useradd -r -g celeryuser -m celeryuser

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

USER celeryuser

RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="/home/celeryuser/.local/bin:$PATH"

COPY --chown=celeryuser:celeryuser pyproject.toml poetry.lock* ./
RUN poetry install --no-root

COPY --chown=celeryuser:celeryuser . .
```

```yaml showLineNumbers title="compose.yaml"
services:
  celery_worker:
    build: .
    command: poetry run opentelemetry-instrument celery -A myapp.tasks worker --loglevel=info
    environment:
      OTEL_SERVICE_NAME: celery-worker
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_TRACES_EXPORTER: otlp
      OTEL_METRICS_EXPORTER: otlp
      OTEL_LOGS_EXPORTER: otlp
      OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED: "true"
      CELERY_BROKER_URL: amqp://guest:guest@rabbitmq:5672//
      CELERY_RESULT_BACKEND: redis://redis:6379/0
    depends_on:
      - rabbitmq
      - redis
      - otel-collector

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otelcol-config.yaml"]
    volumes:
      - ./config/otelcol-config.yaml:/etc/otelcol-config.yaml:ro
    ports:
      - "4318:4318"
      - "4317:4317"
```

## Distributed Tracing Across Async Boundaries

The most critical aspect of Celery instrumentation is propagating trace context
across async boundaries. Without context propagation, Celery workers start new
traces, breaking the correlation between HTTP requests and task execution.

### Understanding Context Propagation

```text
POST /tasks/                                    Trace ID: abc123
├── INSERT task_db (PostgreSQL)
├── apply_async/process_task ─► RabbitMQ ─► run/process_task
                                            ├── process_task
                                            │   └── heavy_processing
                                            └── SETEX (Redis)
```

Without context propagation, the worker would create a new trace ID, making it
impossible to correlate the HTTP request with task execution.

### Injecting Trace Context (Producer Side)

When publishing tasks from a web framework (FastAPI, Django, Flask), inject the
trace context into Celery task headers:

```python showLineNumbers title="app/api/endpoints.py"
from fastapi import FastAPI, Depends
from opentelemetry.propagate import inject
from . import tasks

app = FastAPI()

@app.post("/tasks/")
def create_task(task_data: dict):
    # Create database record, etc.
    db_task = create_task_record(task_data)

    # Inject trace context into Celery task headers
    headers = {}
    inject(headers)

    # Publish task with trace context
    tasks.process_task.apply_async(
        args=[db_task.id],
        headers=headers
    )

    return {"task_id": db_task.id, "status": "queued"}
```

### Extracting Context (Worker Side)

The Celery instrumentation automatically extracts context from task headers when
properly configured. For custom span creation within tasks:

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from opentelemetry import trace
from opentelemetry.propagate import extract
from opentelemetry.context import attach, detach

celery = Celery("tasks", broker="amqp://localhost")

@celery.task(bind=True)
def process_task(self, task_id: int):
    tracer = trace.get_tracer(__name__)

    # Create custom span within the propagated context
    with tracer.start_as_current_span("process_task") as span:
        span.set_attribute("task.id", task_id)

        # Business logic with nested spans
        with tracer.start_span("heavy_processing") as processing_span:
            result = perform_processing(task_id)
            processing_span.set_attribute("processing.duration_ms", result.duration)

        span.set_attribute("task.status", "completed")
        return {"task_id": task_id, "status": "completed"}
```

### Complete Producer-Consumer Example

```python showLineNumbers title="app/main.py"
from fastapi import FastAPI
from opentelemetry.propagate import inject
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from . import tasks
from .telemetry import setup_telemetry

app = FastAPI()
setup_telemetry(app)

@app.post("/orders/")
def create_order(order_data: dict):
    """Create order and queue async processing."""
    order = Order.create(**order_data)

    # Propagate trace context to Celery
    headers = {}
    inject(headers)

    # Queue multiple tasks with same trace context
    tasks.validate_inventory.apply_async(args=[order.id], headers=headers)
    tasks.process_payment.apply_async(args=[order.id], headers=headers)
    tasks.send_confirmation.apply_async(args=[order.id], headers=headers)

    return {"order_id": order.id}
```

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from opentelemetry import trace
import logging

logger = logging.getLogger(__name__)
celery = Celery("tasks")

@celery.task
def validate_inventory(order_id: int):
    logger.info(f"Validating inventory for order {order_id}")
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("validate_inventory") as span:
        span.set_attribute("order.id", order_id)
        # Validation logic
        return {"order_id": order_id, "inventory_valid": True}

@celery.task
def process_payment(order_id: int):
    logger.info(f"Processing payment for order {order_id}")
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("process_payment") as span:
        span.set_attribute("order.id", order_id)
        # Payment logic
        return {"order_id": order_id, "payment_status": "completed"}

@celery.task
def send_confirmation(order_id: int):
    logger.info(f"Sending confirmation for order {order_id}")
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("send_confirmation") as span:
        span.set_attribute("order.id", order_id)
        # Email logic
        return {"order_id": order_id, "email_sent": True}
```

## Custom Manual Instrumentation

While automatic instrumentation covers task lifecycle events, add custom
instrumentation for business logic and performance-critical operations.

### Creating Custom Spans in Tasks

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from opentelemetry import trace
import time

celery = Celery("tasks")

@celery.task
def generate_report(report_id: int, params: dict):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("generate_report") as span:
        span.set_attribute("report.id", report_id)
        span.set_attribute("report.type", params.get("type", "standard"))

        # Data gathering phase
        with tracer.start_span("gather_data") as data_span:
            data = gather_report_data(report_id, params)
            data_span.set_attribute("data.records_count", len(data))
            data_span.add_event("Data gathered", attributes={
                "records": len(data)
            })

        # Processing phase
        with tracer.start_span("process_data") as process_span:
            processed = process_data(data)
            process_span.set_attribute("processing.duration_ms", processed.duration)

        # Rendering phase
        with tracer.start_span("render_report") as render_span:
            report = render_report(processed, params.get("format", "pdf"))
            render_span.set_attribute("report.size_bytes", len(report))

        span.set_status(trace.Status(trace.StatusCode.OK))
        return {"report_id": report_id, "status": "completed"}
```

### Adding Attributes to Current Span

```python showLineNumbers title="myapp/tasks.py"
from opentelemetry import trace

@celery.task(bind=True)
def process_order(self, order_id: int):
    current_span = trace.get_current_span()

    # Add business context
    current_span.set_attributes({
        "order.id": order_id,
        "celery.task.name": self.name,
        "celery.task.id": self.request.id,
        "celery.task.retries": self.request.retries,
    })

    order = Order.get(order_id)
    current_span.set_attributes({
        "order.total": order.total,
        "order.items_count": len(order.items),
        "customer.tier": order.customer.tier,
    })

    return process(order)
```

### Exception Handling and Error Tracking

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

celery = Celery("tasks")

@celery.task(bind=True, max_retries=3)
def risky_task(self, data: dict):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("risky_task") as span:
        span.set_attribute("task.data_size", len(str(data)))

        try:
            result = perform_risky_operation(data)
            span.set_status(Status(StatusCode.OK))
            return result

        except TransientError as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute("error.retryable", True)

            # Retry with exponential backoff
            raise self.retry(exc=e, countdown=2 ** self.request.retries)

        except PermanentError as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute("error.retryable", False)
            raise
```

### Custom Business Metrics

```python showLineNumbers title="myapp/metrics.py"
from opentelemetry import metrics

meter = metrics.get_meter("myapp.tasks", "1.0.0")

# Task execution counter
tasks_executed = meter.create_counter(
    "tasks.executed",
    unit="tasks",
    description="Total number of tasks executed"
)

# Task duration histogram
task_duration = meter.create_histogram(
    "tasks.duration",
    unit="ms",
    description="Task execution duration"
)

# Active tasks gauge
active_tasks = meter.create_up_down_counter(
    "tasks.active",
    unit="tasks",
    description="Currently executing tasks"
)
```

```python showLineNumbers title="myapp/tasks.py"
import time
from .metrics import tasks_executed, task_duration, active_tasks

@celery.task
def monitored_task(task_id: int):
    active_tasks.add(1, attributes={"task.type": "monitored"})
    start_time = time.time()

    try:
        result = perform_work(task_id)
        tasks_executed.add(1, attributes={
            "task.type": "monitored",
            "task.status": "success"
        })
        return result

    except Exception as e:
        tasks_executed.add(1, attributes={
            "task.type": "monitored",
            "task.status": "error",
            "error.type": type(e).__name__
        })
        raise

    finally:
        duration_ms = (time.time() - start_time) * 1000
        task_duration.record(duration_ms, attributes={"task.type": "monitored"})
        active_tasks.add(-1, attributes={"task.type": "monitored"})
```

## Running Your Instrumented Application

### Development Mode

For local development with console output:

```bash
# Set environment variables
export OTEL_SERVICE_NAME=celery-worker-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_TRACES_EXPORTER=console
export OTEL_METRICS_EXPORTER=console

# Start worker with auto-instrumentation
opentelemetry-instrument celery -A myapp.tasks worker --loglevel=debug
```

### Production Mode

```bash
# Set production environment variables
export OTEL_SERVICE_NAME=celery-worker-production
export APP_VERSION=2.1.0
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4318
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true

# Start worker
opentelemetry-instrument celery -A myapp.tasks worker \
    --loglevel=info \
    --concurrency=4 \
    --prefetch-multiplier=4
```

### Docker Deployment

```bash
# Build the image
docker build -t celery-worker:latest .

# Run worker with Scout Collector
docker run -d \
  --name celery-worker \
  -e OTEL_SERVICE_NAME=celery-worker \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318 \
  -e CELERY_BROKER_URL=amqp://guest:guest@rabbitmq:5672// \
  -e CELERY_RESULT_BACKEND=redis://redis:6379/0 \
  celery-worker:latest
```

## Troubleshooting

### Verifying OpenTelemetry Installation

Test your OpenTelemetry configuration:

```python
# test_telemetry.py
from opentelemetry import trace

tracer = trace.get_tracer("test")

with tracer.start_as_current_span("test_span") as span:
    span.set_attribute("test", "value")
    print(f"OpenTelemetry is working!")
    print(f"Tracer provider: {trace.get_tracer_provider().__class__.__name__}")
    print(f"Active span: {span.name}")
```

Run with instrumentation:

```bash
opentelemetry-instrument python test_telemetry.py
```

### Health Check Task

Create a health check task to verify telemetry export:

```python showLineNumbers title="myapp/tasks.py"
from celery import Celery
from opentelemetry import trace

celery = Celery("tasks")

@celery.task
def health_check():
    """Health check task that creates a test span."""
    tracer = trace.get_tracer("health_check")

    with tracer.start_as_current_span("health_check_task") as span:
        span.set_attribute("service.name", "celery-worker")
        span.set_attribute("health.status", "ok")

        return {
            "status": "ok",
            "tracer_provider": trace.get_tracer_provider().__class__.__name__,
        }
```

### Debug Mode

Enable debug logging:

```bash
export OTEL_LOG_LEVEL=debug
export OTEL_PYTHON_LOG_LEVEL=debug
opentelemetry-instrument celery -A myapp.tasks worker --loglevel=debug
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash
   curl -v http://scout-collector:4318/v1/traces
   ```

2. Check environment variables are set:

   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_SERVICE_NAME
   ```

3. Enable debug logging and check for export errors

4. Verify the worker is using `opentelemetry-instrument` command

#### Issue: Traces not correlated between HTTP requests and Celery tasks

**Solutions:**

1. Ensure trace context is injected when publishing tasks:

   ```python
   headers = {}
   inject(headers)
   task.apply_async(args=[...], headers=headers)
   ```

2. Verify Celery instrumentation is installed:

   ```bash
   pip show opentelemetry-instrumentation-celery
   ```

3. Check that both producer and worker use the same OTLP endpoint

#### Issue: Missing task execution spans

**Solutions:**

1. Ensure `worker_process_init` signal is properly connected
2. Verify instrumentation runs before task execution
3. Check that `CeleryInstrumentor().instrument()` is called

#### Issue: High memory usage in workers

**Solutions:**

1. Use `BatchSpanProcessor` instead of `SimpleSpanProcessor`
2. Reduce `max_queue_size` in BatchSpanProcessor
3. Increase `schedule_delay_millis` to batch more spans

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```python
# Bad - exposes sensitive data
span.set_attributes({
    "user.password": user.password,           # Never!
    "payment.card_number": card_number,       # Never!
    "user.ssn": social_security_number,       # Never!
})

# Good - uses safe identifiers
span.set_attributes({
    "user.id": user.id,
    "payment.status": "completed",
    "payment.provider": "stripe",
})
```

### Sanitizing Task Arguments

Be careful with task arguments that may contain sensitive data:

```python showLineNumbers title="myapp/tasks.py"
@celery.task
def process_user_data(user_id: int, data: dict):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("process_user_data") as span:
        # Good - only record safe identifiers
        span.set_attribute("user.id", user_id)
        span.set_attribute("data.keys", list(data.keys()))

        # Bad - never record raw user data
        # span.set_attribute("user.data", str(data))

        return process(user_id, data)
```

### Filtering Sensitive Headers

Configure instrumentation to skip sensitive headers:

```python showLineNumbers
from opentelemetry.instrumentation.celery import CeleryInstrumentor

CeleryInstrumentor().instrument(
    # Skip recording certain headers
    request_hook=lambda span, task_id, args, kwargs: None,
)
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized identifiers
- Configure data retention policies in Scout Dashboard
- Audit span attributes regularly for sensitive data leaks
- Consider using span sampling for high-volume sensitive operations

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead:

- **Average latency increase**: 0.5-2ms per task
- **CPU overhead**: Less than 1% with BatchSpanProcessor
- **Memory overhead**: ~30-50MB depending on queue size

**Impact varies based on:**

- Number of enabled instrumentations
- Span processor type (Batch vs Simple)
- Task execution volume
- Number of custom spans per task

### Optimization Best Practices

#### 1. Use BatchSpanProcessor in Production

```python
# Good - batches exports, low overhead
span_processor = BatchSpanProcessor(exporter)

# Bad - exports every span immediately
span_processor = SimpleSpanProcessor(exporter)
```

#### 2. Limit Custom Span Creation

```python
# Good - single span for task
with tracer.start_as_current_span("process_order") as span:
    validate(order)
    charge(order)
    fulfill(order)

# Avoid - excessive spans for simple operations
with tracer.start_as_current_span("process_order"):
    with tracer.start_span("validate"):
        validate(order)
    with tracer.start_span("charge"):
        charge(order)
    with tracer.start_span("fulfill"):
        fulfill(order)
```

#### 3. Conditional Span Recording

```python
span = trace.get_current_span()

# Only compute expensive attributes if recording
if span.is_recording():
    span.set_attribute("data.summary", expensive_computation())
```

#### 4. Optimize Attribute Sizes

```python
# Good - bounded attribute
span.set_attribute("task.result", str(result)[:1000])

# Bad - unbounded attribute
span.set_attribute("task.result", str(large_result))
```

## Frequently Asked Questions

### Does OpenTelemetry impact Celery task performance?

OpenTelemetry adds approximately 0.5-2ms overhead per task with proper
configuration (BatchSpanProcessor). This is negligible for most workloads. For
high-frequency tasks (>1000/second), consider using sampling.

### Which Celery versions are supported?

OpenTelemetry supports Celery 5.3+ with Python 3.9+. Celery 5.4+ with Python
3.11+ is recommended for optimal compatibility and performance.

### How do I trace tasks across multiple services?

Use `inject()` when publishing tasks and ensure all services send telemetry to
the same Scout Collector. The trace context is automatically propagated through
Celery task headers.

### Can I use OpenTelemetry with Celery Beat (scheduled tasks)?

Yes! Celery Beat scheduled tasks are automatically instrumented. Each scheduled
execution creates a new trace. For correlation with external triggers, inject
context when scheduling dynamic tasks.

### How do I monitor task retries?

Retries are automatically captured as span events. Use custom attributes to
track retry counts:

```python
span.set_attribute("celery.task.retries", self.request.retries)
span.set_attribute("celery.task.max_retries", self.max_retries)
```

### Can I use both RabbitMQ and Redis as brokers?

Yes, OpenTelemetry instruments both brokers. The `rabbitmq` and `redis` receiver
components in the collector can gather infrastructure metrics from both.

### How do I correlate Celery logs with traces?

Enable log instrumentation to automatically inject trace IDs:

```bash
export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
```

Logs will include `trace_id` and `span_id` for correlation in Scout Dashboard.

### What's the difference between task traces and worker metrics?

**Task traces** show individual task execution with timing and attributes. Use
traces to debug specific task failures or performance issues.

**Worker metrics** provide aggregated statistics (queue depth, task rate, worker
utilization). Use metrics for monitoring overall system health and capacity
planning.

### How do I handle multi-tenant Celery applications?

Add tenant context to spans:

```python
span.set_attributes({
    "tenant.id": tenant_id,
    "tenant.name": tenant_name,
})
```

Filter traces by tenant in Scout Dashboard.

### Can I disable instrumentation for specific tasks?

Use the `@celery.task` decorator options or check task name in hooks:

```python
@celery.task(typing=False)  # Disable type checking, not instrumentation

# Or filter in custom hook
def task_hook(span, task_id, args, kwargs):
    if "health_check" in span.name:
        span.set_attribute("otel.ignore", True)
```

## What's Next?

Now that your Celery application is instrumented with OpenTelemetry, explore
these resources:

### Advanced Topics

- **[Custom Python Instrumentation](../custom-instrumentation/python.md)** -
  Deep dive into manual tracing and advanced patterns
- **[FastAPI Instrumentation](./fast-api.md)** - Instrument your API layer for
  complete request-to-task tracing
- **[Redis Monitoring](../../component/redis.md)** - Monitor Celery result
  backend performance

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  alerts for task failures, queue depth, and latency thresholds
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** -
  Build custom dashboards for Celery task monitoring

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Set up Scout Collector for local development
- **[Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)** -
  Production Kubernetes deployment

## Complete Example

Here's a complete working example of a FastAPI + Celery application with
OpenTelemetry instrumentation:

### Project Structure

```plaintext
celery-demo/
├── celery_demo/
│   ├── __init__.py
│   ├── config.py
│   ├── main.py
│   ├── tasks.py
│   └── telemetry.py
├── config/
│   └── otelcol-config.yaml
├── compose.yaml
├── Dockerfile
├── pyproject.toml
└── .env
```

### Dependencies

```toml showLineNumbers title="pyproject.toml"
[project]
name = "celery-demo"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    "fastapi>=0.124.0",
    "uvicorn[standard]>=0.38.0",
    "celery>=5.4.0",
    "redis>=5.0.0",
    "sqlalchemy>=2.0.0",
    "opentelemetry-distro>=0.48b0",
    "opentelemetry-exporter-otlp>=1.27.0",
    "opentelemetry-instrumentation-celery>=0.48b0",
    "opentelemetry-instrumentation-fastapi>=0.48b0",
    "opentelemetry-instrumentation-sqlalchemy>=0.48b0",
    "opentelemetry-instrumentation-redis>=0.48b0",
    "opentelemetry-instrumentation-logging>=0.48b0",
]
```

### Telemetry Setup

```python showLineNumbers title="celery_demo/telemetry.py"
import logging
import os
from celery.signals import worker_process_init
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes

logger = logging.getLogger(__name__)

OTEL_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "celery-demo")
OTEL_ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")


@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    """Initialize tracing for Celery worker processes."""
    logger.info("Initializing OpenTelemetry for Celery worker")
    init_telemetry()
    CeleryInstrumentor().instrument()


def init_telemetry():
    """Initialize OpenTelemetry tracing and metrics."""
    resource = Resource(attributes={
        ResourceAttributes.SERVICE_NAME: OTEL_SERVICE_NAME,
        ResourceAttributes.SERVICE_VERSION: "1.0.0",
    })

    # Setup trace provider
    trace.set_tracer_provider(TracerProvider(resource=resource))
    tracer_provider = trace.get_tracer_provider()

    span_exporter = OTLPSpanExporter(endpoint=f"{OTEL_ENDPOINT}/v1/traces")
    span_processor = BatchSpanProcessor(span_exporter)
    tracer_provider.add_span_processor(span_processor)

    # Enable logging instrumentation
    LoggingInstrumentor().instrument(set_logging_format=True)

    # Setup metrics provider
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{OTEL_ENDPOINT}/v1/metrics")
    )
    metrics.set_meter_provider(
        MeterProvider(resource=resource, metric_readers=[metric_reader])
    )

    logger.info(f"OpenTelemetry initialized for service: {OTEL_SERVICE_NAME}")


def setup_telemetry(app, engine):
    """Configure auto-instrumentation for all components."""
    init_telemetry()

    FastAPIInstrumentor.instrument_app(app)
    SQLAlchemyInstrumentor().instrument(engine=engine)
    CeleryInstrumentor().instrument()
    RedisInstrumentor().instrument()

    logger.info("OpenTelemetry auto-instrumentation setup complete")
```

### FastAPI Application

```python showLineNumbers title="celery_demo/main.py"
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from opentelemetry.propagate import inject
from . import models, tasks
from .database import SessionLocal, engine
from .telemetry import setup_telemetry

models.Base.metadata.create_all(bind=engine)

app = FastAPI()
setup_telemetry(app, engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/ping")
async def ping():
    return {"message": "pong"}


@app.post("/tasks/")
def create_task(task_data: dict, db: Session = Depends(get_db)):
    db_task = models.Task(title=task_data.get("title"))
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    # Propagate trace context to Celery
    headers = {}
    inject(headers)
    tasks.process_task.apply_async(args=[db_task.id], headers=headers)

    return {"task_id": db_task.id, "status": "queued"}
```

### Celery Tasks

```python showLineNumbers title="celery_demo/tasks.py"
from celery import Celery
from opentelemetry import trace
import os
import time
import logging

logger = logging.getLogger(__name__)

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")

celery = Celery(
    "tasks",
    broker=f"amqp://guest:guest@{RABBITMQ_HOST}//",
    backend=f"redis://{REDIS_HOST}:6379/0",
)


@celery.task
def process_task(task_id: int):
    logger.info(f"Starting to process task {task_id}")
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("process_task") as span:
        span.set_attribute("task.id", task_id)

        with tracer.start_span("heavy_processing") as processing_span:
            time.sleep(2)  # Simulate processing
            processing_span.set_attribute("processing.duration_ms", 2000)

        span.set_attribute("task.status", "completed")
        logger.info(f"Task {task_id} completed successfully")
        return {"task_id": task_id, "status": "completed"}
```

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=celery-demo
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
```

This complete example is available in our
[GitHub examples repository](https://github.com/base-14/examples/tree/main/scout-collector/docker/celery-demo).

## References

- [Official OpenTelemetry Celery Instrumentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/celery/celery.html)
- [OpenTelemetry Python Documentation](https://opentelemetry.io/docs/languages/python/)
- [Celery Documentation](https://docs.celeryq.dev/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Python Instrumentation](../custom-instrumentation/python.md) - Manual
  instrumentation for advanced use cases
- [FastAPI Instrumentation](./fast-api.md) - Python web framework integration
