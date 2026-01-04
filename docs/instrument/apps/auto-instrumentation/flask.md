---
title: Flask OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Flask
sidebar_position: 6
description:
  Flask OpenTelemetry instrumentation guide for APM, distributed tracing,
  SQLAlchemy monitoring, and Celery task tracing with base14 Scout.
keywords:
  [
    flask opentelemetry instrumentation,
    flask monitoring,
    flask apm,
    flask distributed tracing,
    flask observability,
    flask performance monitoring,
    opentelemetry python,
    flask telemetry,
    flask postgresql monitoring,
    flask sqlalchemy instrumentation,
    flask celery tracing,
    flask blueprint monitoring,
    flask middleware tracing,
    flask application factory,
    flask template monitoring,
    flask extension tracing,
    flask async views,
    flask request context,
    flask database query monitoring,
    flask api monitoring,
    flask redis instrumentation,
    flask cache monitoring,
    opentelemetry collector flask,
    base14 scout flask,
    flask telemetry configuration,
    flask wsgi instrumentation,
    flask jinja2 tracing,
    flask login tracing,
    flask jwt monitoring,
    flask cors instrumentation,
    flask production monitoring,
    flask microservices tracing,
  ]
---

# Flask

## Introduction

Flask is a lightweight WSGI web application framework designed to make getting
started quick and easy, with the ability to scale up to complex applications.
As a micro-framework, Flask provides the essentials for building web
applications without imposing rigid structure, making it ideal for APIs,
microservices, and rapid prototyping.

This guide demonstrates how to instrument Flask applications with OpenTelemetry
for comprehensive distributed tracing, metrics collection, and application
performance monitoring. We'll cover automatic instrumentation of Flask routes,
SQLAlchemy queries, blueprint-based applications, and Celery background
tasks—all while maintaining Flask's minimalist philosophy and flexibility.

Unlike Django's batteries-included approach with automatic middleware injection,
Flask instrumentation requires explicit initialization in your application
factory or startup code. This manual approach provides fine-grained control over
what gets traced and how, making it ideal for microservices architectures where
minimal overhead is critical. We'll explore both automatic and custom
instrumentation patterns, including Flask-specific considerations like request
context propagation, blueprint isolation, and extension compatibility.

## Who This Guide Is For

This guide is designed for:

- **Flask Developers** building RESTful APIs and microservices requiring
  lightweight tracing with minimal performance overhead
- **API Engineers** working with Flask-RESTful or Flask-RESTX and needing
  endpoint-level observability across distributed services
- **Microservices Teams** deploying Flask applications in containers and
  requiring distributed tracing across service boundaries
- **Backend Developers** using Flask with SQLAlchemy and needing query-level
  performance insights without ORM overhead
- **Technical Leads** implementing observability in Flask applications using the
  application factory pattern and blueprints

## Overview

This guide covers Flask OpenTelemetry instrumentation using the official
OpenTelemetry Python SDK and Flask-specific auto-instrumentation packages. The
approach leverages Flask's request hooks and context locals for comprehensive
tracing.

### What You'll Learn

- Installing and configuring OpenTelemetry SDK for Flask with automatic
  instrumentation
- Instrumenting Flask routes and blueprints with minimal code changes
- Tracing SQLAlchemy queries with full SQL visibility and parameter binding
- Setting up application factory pattern with centralized tracing initialization
- Implementing Celery distributed tracing for background tasks
- Tracing Flask extensions (Flask-Login, Flask-JWT-Extended, Flask-CORS)
- Managing request context propagation across blueprints and utilities
- Detecting slow database queries and N+1 patterns using span attributes
- Optimizing telemetry overhead for high-throughput Flask APIs
- Deploying instrumented Flask apps with Gunicorn, uWSGI, or gevent workers

### Prerequisites

**System Requirements:**

- **Python:** 3.9+ (3.13+ recommended for latest features)
- **Flask:** 2.0+ (3.0+ recommended)
- **PostgreSQL:** 12+ (18+ recommended) or other supported databases
- **Celery:** 5.0+ for background task tracing (optional)
- **Redis:** 6.0+ for caching and Celery broker (optional)

**Supported Flask Versions:**

| Flask Version | Python Version | OpenTelemetry Support | Status      |
| ------------- | -------------- | --------------------- | ----------- |
| 3.1+          | 3.9+           | ✅ Full               | Recommended |
| 3.0           | 3.8+           | ✅ Full               | Current     |
| 2.3           | 3.8+           | ✅ Full               | Supported   |
| 2.0-2.2       | 3.7+           | ✅ Full               | Legacy      |
| 1.1           | 3.5+           | ⚠️ Limited            | EOL         |
| 0.x           | 2.7+           | ❌ Not supported      | EOL         |

**Instrumented Components:**

OpenTelemetry Flask instrumentation automatically traces:

- ✅ **HTTP Requests** - All Flask routes and blueprints
- ✅ **Database Queries** - SQLAlchemy ORM and Core queries
- ✅ **Template Rendering** - Jinja2 template execution
- ✅ **Cache Operations** - Redis and Memcached operations
- ✅ **Celery Tasks** - Background task execution with distributed context
- ✅ **HTTP Clients** - Requests library and httpx calls
- ✅ **Extensions** - Flask-Login, Flask-JWT-Extended, Flask-CORS
- ✅ **Before/After Request Hooks** - Flask request lifecycle
- ✅ **Error Handlers** - Exception handling and error responses
- ✅ **Blueprints** - Modular application components

:::info Example Application

This guide references the
[flask-postgres example](https://github.com/base-14/examples/tree/main/python/flask-postgres)
featuring:

- **Framework**: Flask 3.1+ with application factory pattern
- **Database**: PostgreSQL 18 with SQLAlchemy 2.0
- **Background Jobs**: Celery 5.4+ with Redis broker
- **Features**: Blueprint-based architecture, JWT authentication, PII masking
- **Deployment**: Gunicorn WSGI server with Docker and Kubernetes

:::

## Installation & Setup

Flask OpenTelemetry instrumentation requires the core SDK and Flask-specific
auto-instrumentation packages. The setup process installs dependencies and
initializes tracing in your application factory.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="installation-method">
<TabItem value="pip" label="pip (Recommended)" default>

Install OpenTelemetry SDK and Flask instrumentation:

```bash title="Terminal" showLineNumbers
# Install core OpenTelemetry SDK
pip install opentelemetry-api opentelemetry-sdk

# Install Flask auto-instrumentation
pip install opentelemetry-instrumentation-flask

# Install SQLAlchemy instrumentation
pip install opentelemetry-instrumentation-sqlalchemy

# Install Celery instrumentation (optional)
pip install opentelemetry-instrumentation-celery

# Install Redis instrumentation (optional)
pip install opentelemetry-instrumentation-redis

# Install Requests instrumentation (optional)
pip install opentelemetry-instrumentation-requests

# Install OTLP exporter
pip install opentelemetry-exporter-otlp

# Freeze dependencies
pip freeze > requirements.txt
```

</TabItem>
<TabItem value="poetry" label="Poetry">

Add dependencies to `pyproject.toml`:

```toml title="pyproject.toml" showLineNumbers
[tool.poetry.dependencies]
python = "^3.10"
flask = "^3.1"
sqlalchemy = "^2.0"
psycopg2-binary = "^2.9"
celery = "^5.4"
redis = "^5.0"

# OpenTelemetry dependencies
opentelemetry-api = "^1.27"
opentelemetry-sdk = "^1.27"
opentelemetry-instrumentation-flask = "^0.48b0"
opentelemetry-instrumentation-sqlalchemy = "^0.48b0"
opentelemetry-instrumentation-celery = "^0.48b0"
opentelemetry-instrumentation-redis = "^0.48b0"
opentelemetry-instrumentation-requests = "^0.48b0"
opentelemetry-exporter-otlp = "^1.27"
```

Install dependencies:

```bash
poetry install
```

</TabItem>
<TabItem value="pipenv" label="Pipenv">

Add to `Pipfile`:

```toml title="Pipfile" showLineNumbers
[packages]
flask = "~=3.1"
sqlalchemy = "~=2.0"
psycopg2-binary = "~=2.9"
celery = "~=5.4"
redis = "~=5.0"
opentelemetry-api = "~=1.27"
opentelemetry-sdk = "~=1.27"
opentelemetry-instrumentation-flask = "~=0.48b0"
opentelemetry-instrumentation-sqlalchemy = "~=0.48b0"
opentelemetry-instrumentation-celery = "~=0.48b0"
opentelemetry-instrumentation-redis = "~=0.48b0"
opentelemetry-instrumentation-requests = "~=0.48b0"
opentelemetry-exporter-otlp = "~=1.27"
```

Install:

```bash
pipenv install
```

</TabItem>
<TabItem value="auto-instrument" label="Auto-Instrumentation Bootstrap">

Use the OpenTelemetry bootstrap command:

```bash title="Terminal" showLineNumbers
# Install bootstrap tool
pip install opentelemetry-bootstrap

# Auto-detect and install instrumentation
opentelemetry-bootstrap -a install

# This automatically installs:
# - opentelemetry-instrumentation-flask
# - opentelemetry-instrumentation-sqlalchemy
# - opentelemetry-instrumentation-celery
# - opentelemetry-instrumentation-redis
# (based on detected packages)
```

</TabItem>
</Tabs>

:::tip Flask Application Factory Pattern

Flask best practices recommend using the application factory pattern for
scalability and testing. This guide demonstrates tracing initialization within
the factory function for centralized configuration.

:::

## Configuration

Flask OpenTelemetry configuration involves initializing the SDK and
instrumenting your Flask application instance. Unlike Django, Flask requires
explicit instrumentation calls.

### Application Factory with Tracing

Create an application factory with integrated tracing:

```python title="app/__init__.py" showLineNumbers
"""Flask application factory with OpenTelemetry tracing."""
import os
from flask import Flask
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor


def create_app(config_name='default'):
    """Create and configure Flask application with tracing."""
    app = Flask(__name__)

    # Load configuration
    app.config.from_object(f'config.{config_name.capitalize()}Config')

    # Initialize OpenTelemetry
    initialize_tracing(app)

    # Initialize extensions
    from app.extensions import db, migrate, redis_client
    db.init_app(app)
    migrate.init_app(app, db)

    # Register blueprints
    from app.routes.orders import orders_bp
    from app.routes.health import health_bp
    app.register_blueprint(orders_bp, url_prefix='/api/orders')
    app.register_blueprint(health_bp, url_prefix='/health')

    return app


def initialize_tracing(app):
    """Initialize OpenTelemetry tracing for Flask application."""
    # Create resource with service information
    resource = Resource.create({
        "service.name": os.getenv("OTEL_SERVICE_NAME", "flask-order-service"),
        "service.version": os.getenv("APP_VERSION", "1.0.0"),
        "deployment.environment": os.getenv("ENVIRONMENT", "development"),
    })

    # Create tracer provider
    provider = TracerProvider(resource=resource)

    # Configure OTLP exporter
    otlp_exporter = OTLPSpanExporter(
        endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
        insecure=os.getenv("OTEL_EXPORTER_OTLP_INSECURE", "true") == "true",
    )

    # Add batch span processor
    provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

    # Set as global tracer provider
    trace.set_tracer_provider(provider)

    # Instrument Flask application
    FlaskInstrumentor().instrument_app(app)

    # Instrument SQLAlchemy
    from app.extensions import db
    SQLAlchemyInstrumentor().instrument(
        engine=db.engine,
        enable_commenter=True,
    )

    # Instrument Redis
    RedisInstrumentor().instrument()

    app.logger.info(f"OpenTelemetry initialized: {resource.attributes.get('service.name')}")
```

### Configuration Classes

```python title="config.py" showLineNumbers
"""Flask configuration classes."""
import os
from datetime import timedelta


class Config:
    """Base configuration."""
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-change-in-production')

    # Database
    SQLALCHEMY_DATABASE_URI = os.getenv(
        'DATABASE_URL',
        'postgresql://postgres:postgres@localhost:5432/orders'
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = os.getenv('SQLALCHEMY_ECHO', 'False') == 'True'

    # Redis
    REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

    # Celery
    CELERY_BROKER_URL = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')

    # OpenTelemetry
    OTEL_SERVICE_NAME = os.getenv('OTEL_SERVICE_NAME', 'flask-order-service')
    OTEL_EXPORTER_OTLP_ENDPOINT = os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4317')


class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    SQLALCHEMY_ECHO = True


class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    SQLALCHEMY_ECHO = False

    # Production-specific settings
    SQLALCHEMY_POOL_SIZE = 20
    SQLALCHEMY_POOL_RECYCLE = 3600


class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    OTEL_SDK_DISABLED = True  # Disable tracing in tests


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
```

### Environment Variables

```bash title=".env" showLineNumbers
# Flask configuration
FLASK_APP=wsgi.py
FLASK_ENV=development
SECRET_KEY=your-secret-key-here

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orders
SQLALCHEMY_ECHO=False

# Redis
REDIS_URL=redis://localhost:6379/0

# Celery
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# OpenTelemetry
OTEL_SERVICE_NAME=flask-order-service
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_INSECURE=true
APP_VERSION=1.0.0
ENVIRONMENT=development
```

### WSGI Entry Point

```python title="wsgi.py" showLineNumbers
"""WSGI entry point for Flask application."""
import os
from app import create_app

# Create application instance
config_name = os.getenv('FLASK_ENV', 'development')
app = create_app(config_name)

if __name__ == '__main__':
    # Development server with auto-reload
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('DEBUG', 'True') == 'True'
    )
```

### Docker Compose Configuration

```yaml title="docker-compose.yml" showLineNumbers
version: '3.9'

services:
  flask-app:
    build: .
    command: gunicorn wsgi:app --bind 0.0.0.0:5000 --workers 4
    ports:
      - '5000:5000'
    environment:
      FLASK_ENV: production
      OTEL_SERVICE_NAME: flask-order-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4317
      DATABASE_URL: postgresql://flask:flask123@postgres:5432/orders
      REDIS_URL: redis://redis:6379/0
      CELERY_BROKER_URL: redis://redis:6379/0
    depends_on:
      - postgres
      - redis
      - scout-collector

  celery-worker:
    build: .
    command: celery -A app.celery_app worker --loglevel=info
    environment:
      FLASK_ENV: production
      OTEL_SERVICE_NAME: flask-celery-worker
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4317
      DATABASE_URL: postgresql://flask:flask123@postgres:5432/orders
      REDIS_URL: redis://redis:6379/0
      CELERY_BROKER_URL: redis://redis:6379/0
    depends_on:
      - postgres
      - redis
      - scout-collector

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: orders
      POSTGRES_USER: flask
      POSTGRES_PASSWORD: flask123
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4317:4317'

volumes:
  postgres_data:
```

:::info Scout Integration

When using [Base14 Scout](https://base14.io/scout), configure the OTLP endpoint
to point to your Scout Collector with authentication headers. Scout provides
managed infrastructure optimized for Flask microservices.

:::

## Production Configuration

Production deployments require optimized sampling, secure credential management,
and performance tuning for high-traffic Flask APIs.

### Production Tracing Initialization

```python title="app/__init__.py" showLineNumbers
"""Production-optimized Flask tracing configuration."""
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ParentBased
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor


def initialize_production_tracing(app):
    """Initialize production-grade OpenTelemetry tracing."""
    # Create resource with comprehensive metadata
    resource = Resource.create({
        "service.name": os.getenv("OTEL_SERVICE_NAME", "flask-order-service"),
        "service.version": os.getenv("APP_VERSION", "1.0.0"),
        "deployment.environment": os.getenv("ENVIRONMENT", "production"),
        "cloud.provider": os.getenv("CLOUD_PROVIDER", "aws"),
        "cloud.region": os.getenv("AWS_REGION", "us-east-1"),
        "k8s.cluster.name": os.getenv("K8S_CLUSTER", "production"),
        "k8s.namespace.name": os.getenv("K8S_NAMESPACE", "default"),
        "k8s.pod.name": os.getenv("HOSTNAME", "unknown"),
    })

    # Configure sampling (10% in production)
    sample_rate = float(os.getenv("OTEL_TRACE_SAMPLE_RATE", "0.1"))
    sampler = ParentBased(root=TraceIdRatioBased(sample_rate))

    # Create tracer provider with sampler
    provider = TracerProvider(resource=resource, sampler=sampler)

    # Configure OTLP exporter with authentication
    otlp_exporter = OTLPSpanExporter(
        endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://scout.base14.io:4317"),
        headers={
            "authorization": f"Bearer {os.getenv('SCOUT_API_KEY', '')}",
        },
        insecure=False,
    )

    # Configure batch span processor with production settings
    batch_processor = BatchSpanProcessor(
        otlp_exporter,
        max_queue_size=2048,
        max_export_batch_size=512,
        schedule_delay_millis=5000,
        export_timeout_millis=30000,
    )

    provider.add_span_processor(batch_processor)
    trace.set_tracer_provider(provider)

    # Instrument Flask with excluded paths
    FlaskInstrumentor().instrument_app(
        app,
        excluded_urls="health,readiness,metrics,favicon.ico"
    )

    # Instrument SQLAlchemy with query commenter
    from app.extensions import db
    SQLAlchemyInstrumentor().instrument(
        engine=db.engine,
        enable_commenter=True,
        commenter_options={
            "db_driver": True,
            "db_framework": True,
        }
    )

    # Instrument external HTTP calls
    RequestsInstrumentor().instrument()

    # Instrument Redis
    RedisInstrumentor().instrument()

    app.logger.info(
        f"OpenTelemetry initialized: {resource.attributes.get('service.name')} "
        f"v{resource.attributes.get('service.version')} (sample rate: {sample_rate})"
    )
```

### Gunicorn Production Configuration

```python title="gunicorn.conf.py" showLineNumbers
"""Gunicorn configuration for production Flask deployment."""
import multiprocessing
import os

# Server socket
bind = "0.0.0.0:5000"
backlog = 2048

# Worker processes
workers = int(os.getenv("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))
worker_class = "sync"  # Or "gevent" for async workers
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 30
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"'

# Process naming
proc_name = "flask-order-service"

# Server hooks
def on_starting(server):
    """Server starting hook."""
    print("Gunicorn server starting with OpenTelemetry tracing enabled")

def post_worker_init(worker):
    """Worker initialization hook."""
    print(f"Worker {worker.pid} initialized")
```

### Dockerfile (Multi-Stage Build)

```dockerfile title="Dockerfile" showLineNumbers
# Stage 1: Build dependencies
FROM python:3.13-slim AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /app/wheels -r requirements.txt

# Stage 2: Runtime image
FROM python:3.13-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy wheels from builder
COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/requirements.txt .

# Install Python packages
RUN pip install --no-cache /wheels/*

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 flask && chown -R flask:flask /app
USER flask

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=wsgi.py

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5000/health/')"

# Run Gunicorn
CMD ["gunicorn", "wsgi:app", "--config", "gunicorn.conf.py"]
```

### Kubernetes Deployment

```yaml title="k8s/deployment.yaml" showLineNumbers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flask-order-service
  labels:
    app: flask-order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: flask-order-service
  template:
    metadata:
      labels:
        app: flask-order-service
    spec:
      containers:
        - name: flask-app
          image: flask-order-service:latest
          ports:
            - containerPort: 5000
              name: http
          env:
            - name: FLASK_ENV
              value: production
            - name: OTEL_SERVICE_NAME
              value: flask-order-service
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://scout-collector:4317
            - name: SCOUT_API_KEY
              valueFrom:
                secretKeyRef:
                  name: scout-credentials
                  key: api-key
            - name: OTEL_TRACE_SAMPLE_RATE
              value: '0.1'
            - name: ENVIRONMENT
              value: production
            - name: APP_VERSION
              value: '1.0.0'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: connection-string
            - name: REDIS_URL
              value: redis://redis-service:6379/0
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '512Mi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health/
              port: 5000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 5000
            initialDelaySeconds: 10
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: flask-order-service
spec:
  selector:
    app: flask-order-service
  ports:
    - protocol: TCP
      port: 80
      targetPort: 5000
  type: ClusterIP
```

## Flask-Specific Features

Flask's auto-instrumentation automatically captures routes, database queries,
and template rendering. The minimalist design allows fine-grained control over
what gets traced.

### Route Auto-Instrumentation

All Flask routes are automatically instrumented:

```python title="app/routes/orders.py" showLineNumbers
"""Flask routes with automatic tracing."""
from flask import Blueprint, request, jsonify
from opentelemetry import trace
from app.models import Order, db
from app.tasks import process_order

orders_bp = Blueprint('orders', __name__)
tracer = trace.get_tracer(__name__)


# Function-based route (automatically traced)
# Span name: "GET /api/orders/"
@orders_bp.route('/', methods=['GET'])
def get_orders():
    """Get all orders - automatically creates span."""
    orders = Order.query.all()
    return jsonify([order.to_dict() for order in orders])


# Route with parameter (automatically traced)
# Span name: "GET /api/orders/<order_id>"
@orders_bp.route('/<int:order_id>', methods=['GET'])
def get_order(order_id):
    """Get order by ID."""
    order = Order.query.get_or_404(order_id)
    return jsonify(order.to_dict())


# POST route with request body
# Span name: "POST /api/orders/"
@orders_bp.route('/', methods=['POST'])
def create_order():
    """Create new order."""
    data = request.get_json()

    # Database insert automatically traced
    order = Order(
        product_name=data['product_name'],
        amount=data['amount'],
        status='pending'
    )
    db.session.add(order)
    db.session.commit()

    # Trigger background task (traced separately)
    process_order.delay(order.id)

    return jsonify(order.to_dict()), 201


# Error handling (automatically traced)
@orders_bp.route('/<int:order_id>', methods=['DELETE'])
def delete_order(order_id):
    """Delete order."""
    order = Order.query.get_or_404(order_id)
    db.session.delete(order)
    db.session.commit()
    return '', 204


# Custom span with manual instrumentation
@orders_bp.route('/analytics', methods=['GET'])
def get_analytics():
    """Get order analytics with custom span."""
    with tracer.start_as_current_span("calculate_analytics") as span:
        total_orders = Order.query.count()
        pending_orders = Order.query.filter_by(status='pending').count()

        span.set_attribute("analytics.total_orders", total_orders)
        span.set_attribute("analytics.pending_orders", pending_orders)

        return jsonify({
            "total_orders": total_orders,
            "pending_orders": pending_orders
        })
```

### Blueprint-Based Architecture

Flask blueprints are automatically instrumented:

```python title="app/routes/health.py" showLineNumbers
"""Health check blueprint."""
from flask import Blueprint, jsonify
from app.extensions import db, redis_client

health_bp = Blueprint('health', __name__)


@health_bp.route('/', methods=['GET'])
def health():
    """Basic health check - excluded from tracing via config."""
    return jsonify({"status": "healthy"})


@health_bp.route('/ready', methods=['GET'])
def readiness():
    """Readiness check with dependencies."""
    try:
        # Check database connection
        db.session.execute('SELECT 1')

        # Check Redis connection
        redis_client.ping()

        return jsonify({"status": "ready"})
    except Exception as e:
        return jsonify({"status": "not ready", "error": str(e)}), 503
```

### SQLAlchemy Query Instrumentation

Database queries are automatically traced:

```python title="app/models.py" showLineNumbers
"""SQLAlchemy models with automatic query tracing."""
from datetime import datetime
from app.extensions import db


class Order(db.Model):
    """Order model - all queries automatically traced."""
    __tablename__ = 'orders'

    id = db.Column(db.Integer, primary_key=True)
    product_name = db.Column(db.String(200), nullable=False)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(50), default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        """Convert to dictionary."""
        return {
            'id': self.id,
            'product_name': self.product_name,
            'amount': float(self.amount),
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

    @classmethod
    def get_by_status(cls, status):
        """Get orders by status - traced as SELECT query."""
        return cls.query.filter_by(status=status).all()

    @classmethod
    def get_recent(cls, limit=10):
        """Get recent orders - traced with ORDER BY and LIMIT."""
        return cls.query.order_by(cls.created_at.desc()).limit(limit).all()


class OrderService:
    """Business logic with automatic query tracing."""

    @staticmethod
    def create_order_with_validation(data):
        """Create order with validation."""
        # All database operations traced automatically
        order = Order(
            product_name=data['product_name'],
            amount=data['amount'],
            status='pending'
        )

        db.session.add(order)
        db.session.commit()

        return order

    @staticmethod
    def get_order_analytics():
        """Complex aggregation query - automatically traced."""
        from sqlalchemy import func

        result = db.session.query(
            Order.status,
            func.count(Order.id).label('count'),
            func.sum(Order.amount).label('total')
        ).group_by(Order.status).all()

        return [
            {
                'status': row.status,
                'count': row.count,
                'total': float(row.total or 0)
            }
            for row in result
        ]
```

### Before/After Request Hooks

Flask request hooks are automatically traced:

```python title="app/__init__.py" showLineNumbers
"""Flask hooks with custom attributes."""
from flask import request, g
from opentelemetry import trace
import time


def register_hooks(app):
    """Register Flask request hooks with tracing."""

    @app.before_request
    def before_request():
        """Before request hook - adds custom attributes."""
        g.start_time = time.time()

        # Get current span and add custom attributes
        current_span = trace.get_current_span()
        current_span.set_attribute("http.user_agent", request.user_agent.string)
        current_span.set_attribute("http.method", request.method)
        current_span.set_attribute("http.path", request.path)

        if request.is_json:
            current_span.set_attribute("http.request.content_type", "application/json")

    @app.after_request
    def after_request(response):
        """After request hook - records response details."""
        current_span = trace.get_current_span()

        # Record response attributes
        current_span.set_attribute("http.status_code", response.status_code)
        current_span.set_attribute("http.response.content_length", response.content_length or 0)

        # Calculate request duration
        if hasattr(g, 'start_time'):
            duration_ms = (time.time() - g.start_time) * 1000
            current_span.set_attribute("http.request.duration_ms", duration_ms)

        return response

    @app.errorhandler(Exception)
    def handle_exception(e):
        """Global error handler - records exceptions in span."""
        current_span = trace.get_current_span()
        current_span.record_exception(e)
        current_span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))

        return jsonify({"error": str(e)}), 500
```

### Celery Task Tracing

Celery tasks with distributed context propagation:

```python title="app/celery_app.py" showLineNumbers
"""Celery configuration with OpenTelemetry."""
import os
from celery import Celery
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor


def make_celery(app):
    """Create Celery instance with Flask app context."""
    celery = Celery(
        app.import_name,
        broker=app.config['CELERY_BROKER_URL'],
        backend=app.config['CELERY_RESULT_BACKEND']
    )

    celery.conf.update(app.config)

    # Ensure Flask app context in tasks
    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask

    return celery


@worker_process_init.connect
def init_celery_tracing(**kwargs):
    """Initialize tracing in Celery worker process."""
    from app import create_app
    app = create_app('production')

    # Instrument Celery tasks
    CeleryInstrumentor().instrument()

    print("OpenTelemetry initialized in Celery worker")
```

```python title="app/tasks.py" showLineNumbers
"""Celery tasks with automatic tracing."""
from app.celery_app import make_celery
from app import create_app
from opentelemetry import trace

app = create_app()
celery = make_celery(app)
tracer = trace.get_tracer(__name__)


@celery.task
def process_order(order_id):
    """
    Process order asynchronously.
    Automatically creates span: 'app.tasks.process_order'
    """
    from app.models import Order, db

    # Current span linked to original request
    current_span = trace.get_current_span()
    current_span.set_attribute("order.id", order_id)

    # Query automatically traced
    order = Order.query.get(order_id)

    if order.amount > 1000:
        # Custom validation span
        with tracer.start_as_current_span("validate_high_value_order") as span:
            span.set_attribute("order.amount", float(order.amount))
            # Validation logic
            pass

    # Update status (UPDATE query traced)
    order.status = 'processing'
    db.session.commit()

    return {"order_id": order_id, "status": "processed"}
```

## Custom Instrumentation

While Flask auto-instrumentation covers most use cases, custom spans are needed
for specific business logic.

### Manual Span Creation

```python title="app/services/payment.py" showLineNumbers
"""Payment service with custom instrumentation."""
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
import requests

tracer = trace.get_tracer(__name__)


class PaymentService:
    """Payment processing with custom spans."""

    @staticmethod
    def process_payment(order_id, amount, method):
        """Process payment with detailed tracing."""
        with tracer.start_as_current_span("process_payment") as span:
            span.set_attribute("order.id", order_id)
            span.set_attribute("payment.amount", float(amount))
            span.set_attribute("payment.method", method)

            try:
                # Validate payment method
                PaymentService._validate_method(method)

                # Call external gateway
                transaction_id = PaymentService._charge_gateway(amount, method)

                span.set_attribute("payment.transaction_id", transaction_id)
                span.set_status(Status(StatusCode.OK))

                return {
                    "success": True,
                    "transaction_id": transaction_id
                }

            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise

    @staticmethod
    def _validate_method(method):
        """Validate payment method."""
        with tracer.start_as_current_span("validate_payment_method") as span:
            span.set_attribute("payment.method", method)

            valid_methods = ["credit_card", "debit_card", "paypal"]
            if method not in valid_methods:
                span.set_status(Status(StatusCode.ERROR, "Invalid method"))
                raise ValueError(f"Invalid payment method: {method}")

    @staticmethod
    def _charge_gateway(amount, method):
        """Charge payment gateway - external API call."""
        with tracer.start_as_current_span(
            "payment_gateway.charge",
            kind=trace.SpanKind.CLIENT
        ) as span:
            span.set_attribute("payment.gateway", "stripe")
            span.set_attribute("payment.amount", float(amount))

            # External HTTP call (auto-instrumented by requests library)
            response = requests.post(
                "https://api.stripe.com/v1/charges",
                json={"amount": float(amount), "method": method},
                timeout=10
            )

            span.set_attribute("http.status_code", response.status_code)

            if response.status_code == 200:
                transaction_id = response.json().get("id")
                span.set_attribute("payment.transaction_id", transaction_id)
                return transaction_id
            else:
                span.set_status(Status(StatusCode.ERROR, "Payment failed"))
                raise Exception("Payment gateway error")
```

### Context Manager for Business Logic

```python title="app/utils/tracing.py" showLineNumbers
"""Custom tracing utilities."""
from opentelemetry import trace
from functools import wraps
import time

tracer = trace.get_tracer(__name__)


def trace_function(name=None):
    """Decorator to automatically trace function execution."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            span_name = name or f"{func.__module__}.{func.__name__}"

            with tracer.start_as_current_span(span_name) as span:
                # Add function metadata
                span.set_attribute("function.name", func.__name__)
                span.set_attribute("function.module", func.__module__)

                # Record arguments (be careful with PII!)
                if kwargs:
                    span.set_attribute("function.kwargs_count", len(kwargs))

                start_time = time.time()

                try:
                    result = func(*args, **kwargs)
                    duration_ms = (time.time() - start_time) * 1000
                    span.set_attribute("function.duration_ms", duration_ms)
                    return result

                except Exception as e:
                    span.record_exception(e)
                    span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                    raise

        return wrapper
    return decorator


# Usage
@trace_function("calculate_order_total")
def calculate_total(order_items):
    """Calculate order total - automatically traced."""
    return sum(item['price'] * item['quantity'] for item in order_items)
```

### Flask Extension Instrumentation

```python title="app/extensions.py" showLineNumbers
"""Flask extensions with tracing integration."""
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_redis import FlaskRedis
from opentelemetry import trace

db = SQLAlchemy()
migrate = Migrate()
redis_client = FlaskRedis()
tracer = trace.get_tracer(__name__)


def init_extensions(app):
    """Initialize Flask extensions with tracing."""
    db.init_app(app)
    migrate.init_app(app, db)
    redis_client.init_app(app)

    # Add custom event listeners for database operations
    @event.listens_for(db.engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """Log SQL queries in current span."""
        current_span = trace.get_current_span()
        current_span.add_event("sql_query_start", {
            "db.statement": statement[:100],  # Truncate long queries
        })

    app.logger.info("Extensions initialized with OpenTelemetry tracing")
```

## Running Your Application

Flask applications can run with various WSGI servers. OpenTelemetry
instrumentation works with all standard deployment methods.

### Development Server

```bash title="Terminal" showLineNumbers
# Run Flask development server
export FLASK_APP=wsgi.py
export FLASK_ENV=development
flask run --host=0.0.0.0 --port=5000

# Or using Python directly
python wsgi.py

# Run Celery worker (separate terminal)
celery -A app.celery_app worker --loglevel=info

# Test endpoints
curl http://localhost:5000/api/orders/
curl -X POST http://localhost:5000/api/orders/ \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Widget","amount":"99.99"}'
```

### Gunicorn (Production)

```bash title="Terminal" showLineNumbers
# Run with Gunicorn
gunicorn wsgi:app --bind 0.0.0.0:5000 --workers 4

# With configuration file
gunicorn wsgi:app --config gunicorn.conf.py

# With environment variables
OTEL_SERVICE_NAME=flask-order-service \
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.base14.io:4317 \
SCOUT_API_KEY=your_api_key \
gunicorn wsgi:app --bind 0.0.0.0:5000
```

### uWSGI

```ini title="uwsgi.ini" showLineNumbers
[uwsgi]
module = wsgi:app
master = true
processes = 4
socket = /tmp/flask-app.sock
chmod-socket = 666
vacuum = true
die-on-term = true

# OpenTelemetry environment
env = OTEL_SERVICE_NAME=flask-order-service
env = OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

Run:

```bash
uwsgi --ini uwsgi.ini
```

### Docker Deployment

```bash title="Terminal" showLineNumbers
# Build Docker image
docker build -t flask-order-service:latest .

# Run container
docker run -p 5000:5000 \
  -e OTEL_SERVICE_NAME=flask-order-service \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.base14.io:4317 \
  -e SCOUT_API_KEY=your_api_key \
  flask-order-service:latest

# Run with Docker Compose
docker-compose up -d

# Check logs
docker-compose logs -f flask-app

# Run database migrations
docker-compose exec flask-app flask db upgrade
```

### Kubernetes Deployment

```bash title="Terminal" showLineNumbers
# Deploy to Kubernetes
kubectl apply -f k8s/deployment.yaml

# Check pod status
kubectl get pods -l app=flask-order-service

# View logs
kubectl logs -f deployment/flask-order-service

# Run migrations
kubectl run flask-migrate --rm -i --tty \
  --image=flask-order-service:latest \
  --restart=Never \
  --command -- flask db upgrade

# Port forward for testing
kubectl port-forward deployment/flask-order-service 5000:5000
curl http://localhost:5000/api/orders/
```

## Troubleshooting

### Issue 1: No Traces Generated

**Symptoms:** Flask application starts but no traces appear in collector.

**Solution:**

Ensure instrumentation is called on the Flask app instance:

```python
# INCORRECT: Instrumenting before app creation
from opentelemetry.instrumentation.flask import FlaskInstrumentor
FlaskInstrumentor().instrument()  # No app provided!

from flask import Flask
app = Flask(__name__)

# CORRECT: Instrument specific app instance
from flask import Flask
app = Flask(__name__)

from opentelemetry.instrumentation.flask import FlaskInstrumentor
FlaskInstrumentor().instrument_app(app)  # Instrument this specific app
```

### Issue 2: SQLAlchemy Queries Not Traced

**Symptoms:** HTTP requests create spans but database queries are missing.

**Solution:**

Instrument SQLAlchemy engine after database initialization:

```python
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

# Initialize database
from app.extensions import db
db.init_app(app)

# IMPORTANT: Instrument engine after init_app
SQLAlchemyInstrumentor().instrument(
    engine=db.engine,
    enable_commenter=True
)
```

### Issue 3: Blueprint Routes Not Traced

**Symptoms:** Some routes traced, blueprint routes missing.

**Solution:**

Register blueprints before instrumenting Flask app:

```python
# INCORRECT order
FlaskInstrumentor().instrument_app(app)
app.register_blueprint(orders_bp)  # Too late!

# CORRECT order
app.register_blueprint(orders_bp)
app.register_blueprint(health_bp)
FlaskInstrumentor().instrument_app(app)  # Instrument after blueprints
```

### Issue 4: Celery Tasks Not Linked to Requests

**Symptoms:** Celery task spans exist but disconnected from originating request.

**Solution:**

Initialize Celery instrumentation in worker process:

```python
from celery.signals import worker_process_init
from opentelemetry.instrumentation.celery import CeleryInstrumentor

@worker_process_init.connect
def init_celery_tracing(**kwargs):
    """Initialize in each worker process."""
    # Initialize OpenTelemetry
    from app import initialize_tracing
    app = create_app()
    initialize_tracing(app)

    # Instrument Celery
    CeleryInstrumentor().instrument()
```

### Issue 5: High Memory Usage

**Symptoms:** Flask application memory grows continuously.

**Solution:**

Configure batch span processor limits:

```python
from opentelemetry.sdk.trace.export import BatchSpanProcessor

batch_processor = BatchSpanProcessor(
    otlp_exporter,
    max_queue_size=1024,  # Reduced from default
    max_export_batch_size=256,
    schedule_delay_millis=3000,
)
```

## Security Considerations

### PII Data Masking

Implement custom span processor to mask sensitive data:

```python title="app/tracing.py" showLineNumbers
"""PII masking span processor."""
import re
from opentelemetry.sdk.trace import SpanProcessor, ReadableSpan


class PIIMaskingProcessor(SpanProcessor):
    """Mask PII in span attributes."""

    EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    PHONE_PATTERN = re.compile(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b')
    CREDIT_CARD_PATTERN = re.compile(r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b')

    def on_start(self, span: "ReadableSpan", parent_context=None):
        """Mask PII on span start."""
        if hasattr(span, '_name'):
            span._name = self._mask(span._name)

    def on_end(self, span: ReadableSpan):
        """Mask PII on span end."""
        if hasattr(span, 'attributes'):
            for key, value in list(span.attributes.items()):
                if isinstance(value, str):
                    span.attributes[key] = self._mask(value)

    def _mask(self, text):
        """Mask sensitive patterns."""
        if not isinstance(text, str):
            return text

        text = self.EMAIL_PATTERN.sub('***@***.**', text)
        text = self.PHONE_PATTERN.sub('***-***-****', text)
        text = self.CREDIT_CARD_PATTERN.sub('****-****-****-****', text)

        return text

    def shutdown(self):
        pass

    def force_flush(self, timeout_millis=30000):
        return True
```

### SQL Parameter Sanitization

```python
# Enable SQL commenter without parameter values
SQLAlchemyInstrumentor().instrument(
    engine=db.engine,
    enable_commenter=True,
    commenter_options={
        "db_driver": True,
        "opentelemetry_values": False,  # Don't log parameters
    }
)
```

### Request Header Filtering

```python title="app/__init__.py" showLineNumbers
"""Filter sensitive headers."""

@app.before_request
def filter_sensitive_headers():
    """Remove sensitive headers from tracing."""
    current_span = trace.get_current_span()

    # Don't trace authorization headers
    # current_span.set_attribute("http.authorization", request.headers.get("Authorization"))

    # Only log that auth is present
    if request.headers.get("Authorization"):
        current_span.set_attribute("http.auth.present", True)
```

## Performance Considerations

### Tracing Overhead Metrics

| Configuration      | Latency (p50) | Latency (p99) | Throughput | Memory  |
| ------------------ | ------------- | ------------- | ---------- | ------- |
| **No Tracing**     | 8ms           | 25ms          | 12,000 rps | 180MB   |
| **Tracing (100%)** | 9ms (+12%)    | 30ms (+20%)   | 11,000 rps | 250MB   |
| **Tracing (10%)**  | 8ms (+&lt;1%) | 26ms (+4%)    | 11,800 rps | 195MB   |

### Optimization Strategies

#### 1. Exclude High-Volume Endpoints

```python
FlaskInstrumentor().instrument_app(
    app,
    excluded_urls="health,readiness,metrics,static,favicon.ico"
)
```

#### 2. Optimize Database Queries

```python
# BAD: N+1 query problem
orders = Order.query.all()
for order in orders:
    print(order.user.username)  # N queries!

# GOOD: Eager loading
from sqlalchemy.orm import joinedload
orders = Order.query.options(joinedload(Order.user)).all()
for order in orders:
    print(order.user.username)  # Single query
```

#### 3. Batch Span Export

```python
batch_processor = BatchSpanProcessor(
    otlp_exporter,
    max_queue_size=2048,
    max_export_batch_size=512,
    schedule_delay_millis=5000,
)
```

#### 4. Disable Tracing in Tests

```python
# config.py
class TestingConfig(Config):
    TESTING = True
    OTEL_SDK_DISABLED = True
```

## FAQ

### 1. Do I need to manually instrument Flask routes?

**No.** Flask's auto-instrumentation automatically traces all routes when you
call `FlaskInstrumentor().instrument_app(app)`. No decorators required.

### 2. How do I trace Flask blueprints?

Blueprints are automatically instrumented when registered before calling
`instrument_app()`. Ensure blueprints are registered first, then instrument.

### 3. Can I use OpenTelemetry with Flask-RESTful?

**Yes.** Flask-RESTful resources are automatically instrumented through Flask's
route system. Each resource method creates a span.

### 4. How do I trace SQLAlchemy queries?

Install `opentelemetry-instrumentation-sqlalchemy` and instrument the engine
after `db.init_app(app)`:

```python
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
SQLAlchemyInstrumentor().instrument(engine=db.engine)
```

### 5. Does tracing work with Flask application factory?

**Yes.** Initialize tracing inside your `create_app()` function after creating
the app instance but before returning it.

### 6. How do I trace Celery tasks from Flask?

Install `opentelemetry-instrumentation-celery` and initialize in the worker
process using `@worker_process_init` signal. Trace context automatically
propagates from Flask to Celery.

### 7. Can I exclude specific routes from tracing?

**Yes.** Use the `excluded_urls` parameter:

```python
FlaskInstrumentor().instrument_app(app, excluded_urls="health,metrics")
```

### 8. What's the performance overhead?

With 10% sampling, overhead is typically &lt;1% for latency and ~8% for memory.
Without sampling (100% tracing), expect ~12% latency increase.

### 9. How do I send traces to Base14 Scout?

Configure the OTLP exporter with Scout endpoint and API key:

```python
OTLPSpanExporter(
    endpoint="https://scout.base14.io:4317",
    headers={"authorization": f"Bearer {os.getenv('SCOUT_API_KEY')}"},
)
```

### 10. Can I trace template rendering?

**Yes.** Jinja2 template rendering is automatically traced when using
`render_template()`. Each template creates a child span.

### 11. How do I trace before/after request hooks?

Flask hooks are automatically traced. Add custom attributes in hooks using
`trace.get_current_span()`.

### 12. Does tracing work with gevent workers?

**Yes.** OpenTelemetry works with gevent and eventlet WSGI workers. Context
propagation is maintained across greenlets.

## What's Next

Now that you have Flask instrumented with OpenTelemetry, explore advanced
observability patterns:

### Advanced Tracing Topics

- **[Custom Instrumentation for Python](/instrument/apps/custom-instrumentation/python)**
  \- Deep dive into manual span creation and context propagation
- **[Django Instrumentation](/instrument/apps/auto-instrumentation/django)** \-
  Compare Flask's manual approach with Django's automatic middleware
- **FastAPI Instrumentation** \- Explore async Python framework tracing
  patterns

### Scout Platform Features

- **[Base14 Scout Dashboard](https://base14.io/scout)** - Visualize Flask
  traces with route-level insights
- **Service Map Visualization** - Understand dependencies between Flask
  microservices
- **Alert Configuration** - Set up alerts for slow routes and high error rates

### Deployment & Operations

- **Docker Instrumentation** - Deploy instrumented Flask apps in containers
- **Kubernetes Deployment** - Run Flask with sidecar collectors
- **AWS Lambda** - Deploy Flask with AWS Lambda + API Gateway tracing

### Related Frameworks

- **[Node.js Instrumentation](/instrument/apps/auto-instrumentation/nodejs)** \-
  Compare Flask's patterns with Express.js
- **[Go Instrumentation](/instrument/apps/auto-instrumentation/go)** \-
  Lightweight framework comparison with Go Fiber
- **[Spring Boot Instrumentation](/instrument/apps/auto-instrumentation/spring-boot)**
  \- Enterprise framework with similar blueprint/module patterns

## Complete Example

Here's a complete Flask application with OpenTelemetry instrumentation,
including routes, SQLAlchemy, blueprints, and Celery tasks.

### Project Structure

```text
flask-order-service/
├── app/
│   ├── __init__.py
│   ├── extensions.py
│   ├── models.py
│   ├── celery_app.py
│   ├── tasks.py
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── orders.py
│   │   └── health.py
│   └── services/
│       └── payment.py
├── config.py
├── wsgi.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── gunicorn.conf.py
```

### Running the Example

```bash title="Terminal" showLineNumbers
# Clone the examples repository
git clone https://github.com/base-14/examples.git
cd examples/python/flask-postgres

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start infrastructure
docker-compose up -d postgres redis scout-collector

# Initialize database
export FLASK_APP=wsgi.py
flask db upgrade

# Run development server
flask run

# In another terminal: Run Celery worker
celery -A app.celery_app worker --loglevel=info

# Test endpoints
curl http://localhost:5000/api/orders/

curl -X POST http://localhost:5000/api/orders/ \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Widget","amount":"99.99"}'

# View traces in Scout
open https://scout.base14.io
```

### Expected Trace Output

```text
POST /api/orders/ (150ms)
├── create_order (120ms)
│   ├── INSERT INTO orders (...) (15ms)
│   ├── celery.apply_async (5ms)
│   └── db.session.commit (10ms)
└── Celery Task: process_order (100ms) [linked trace]
    ├── SELECT FROM orders WHERE id = ? (8ms)
    ├── validate_high_value_order (30ms)
    └── UPDATE orders SET status = ? (10ms)
```

:::tip Complete Example Repository

The full example application with Docker Compose, Kubernetes manifests, and
production configurations is available at:

**[https://github.com/base-14/examples/tree/main/python/flask-postgres](https://github.com/base-14/examples/tree/main/python/flask-postgres)**

:::

## References

### Official Documentation

- **[Flask Documentation](https://flask.palletsprojects.com/)** \- Official
  Flask framework documentation
- **[OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)**
  \- Core OpenTelemetry Python documentation
- **[Flask Instrumentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/flask/flask.html)**
  \- Official Flask auto-instrumentation docs
- **[SQLAlchemy Documentation](https://www.sqlalchemy.org/)** \- ORM and Core
  documentation

### Related Guides

- **[Django Instrumentation](/instrument/apps/auto-instrumentation/django)** \-
  Full-featured Python framework with ORM
- **[FastAPI Instrumentation](/instrument/apps/auto-instrumentation/fast-api)**
  \- Modern async Python framework
- **[Python Custom Instrumentation](/instrument/apps/custom-instrumentation/python)**
  \- Advanced manual instrumentation patterns
- **[Celery Tracing](/instrument/apps/auto-instrumentation/celery)** \-
  Distributed task queue instrumentation

### Tools & Resources

- **[Base14 Scout](https://base14.io/scout)** \- Managed OpenTelemetry platform
  for Flask microservices
- **[Flask-RESTful](https://flask-restful.readthedocs.io/)** \- REST API
  extension for Flask
- **[Flask-SQLAlchemy](https://flask-sqlalchemy.palletsprojects.com/)** \- Flask
  extension for SQLAlchemy
