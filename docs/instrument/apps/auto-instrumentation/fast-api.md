# Fast API

Implement OpenTelemetry instrumentation for `FastAPI` applications to collect
traces and metrics; monitor HTTP requests using the Python OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for FastAPI
- Configure automatic request and response tracing
- Implement custom instrumentation
- Collect HTTP metrics
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- Python 3.7 or later installed
- FastAPI application set up
- Access to package installation (`pip`)

## Required Packages

`opentelemetry-api` defines the API interfaces for tracing, metrics and logging;
`opentelemetry-sdk` provides the implementation for these APIs.

Install the following necessary packages or add it to
`requirements.txt` and install it.

```plaintext
opentelemetry-instrumentation-fastapi
opentelemetry-sdk
opentelemetry-exporter-otlp
opentelemetry-api

# Optional
opentelemetry-instrumentation-requests
requests
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

### Auto Instrumentation of Traces

```python showLineNumbers
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.requests import RequestsInstrumentor

# Configure trace provider with service name
resource = Resource.create({"service.name": "custom-fastapi-service"})
trace.set_tracer_provider(
    TracerProvider(
        resource=resource
    )
)

# Set up trace exporter
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://0.0.0.0:4318/v1/traces"))
)

app = FastAPI()

FastAPIInstrumentor.instrument_app(app)

# Optional: Instrument HTTP client requests
RequestsInstrumentor().instrument()
```

Key tracing features:

- Automatic HTTP request/response tracking
- Error and exception capturing
- Request context propagation
- Custom attribute support
- Distributed tracing capabilities

> View these metrics in base14 Scout observability backend.

##### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

#### Adding Custom Instrumentation

```python showLineNumbers
def do_work():
    tracer = trace.get_tracer(__name__)
    parent_span = trace.get_current_span()
    ctx_with_parent_span = trace.set_span_in_context(parent_span)

    with tracer.start_as_current_span("span", context=ctx_with_parent_span) as span:
        span.set_attribute("key", "value")
        # do some work ...
```

### Metrics

OpenTelemetry metrics capture runtime measurements of your FastAPI application,
including:

- HTTP request counts and latencies
- Response status codes
- Resource utilization
- Custom business metrics

#### Auto Instrumentation of Metrics

```python title="main.py" showLineNumbers

from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import  metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.metrics import MeterProvider
from .MetricsMiddleware import MetricsMiddleware

from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

# Configure metrics with service name
resource = Resource.create({"service.name": "custom-fastapi-service"})

# Set up metrics export
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(endpoint="http://0.0.0.0:4318/v1/metrics"),
    export_interval_millis=1000
)
metrics.set_meter_provider(
    MeterProvider(resource=resource, metric_readers=[metric_reader])
)

app = FastAPI()

app.add_middleware(MetricsMiddleware)
FastAPIInstrumentor.instrument_app(app)
```

```python title="MetricsMiddleware.py" showLineNumbers
from starlette.middleware.base import BaseHTTPMiddleware
from opentelemetry.metrics import get_meter

class MetricsMiddleware(BaseHTTPMiddleware):
  def __init__(self, app):
    super().__init__(app)
    self.meter = get_meter("custom-fastapi-service")
    self.http_requests_counter = self.meter.create_counter(
      name="http_requests_total",
      unit="1",
      description="Number of HTTP requests per route"
    )

  async def dispatch(self, request, call_next):
    response = await call_next(request)
    self.http_requests_counter.add(
      1,
      {
        "method": request.method,
        "path": request.url.path,
        "status_code": str(response.status_code),
      }
    )
    return response
```

Metrics will be automatically exported to the OpenTelemetry Collector at the
configured interval. `MetricsMiddleware` captures each HTTP request,
including the method, path, and status code, and tracks the total request count.

> View these metrics in base14 Scout observability backend.

##### Reference

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

## Sample Application
>
> A sample application with OpenTelemetry instrumentation can be found at
> this [GitHub repository](https://github.com/base-14/examples/tree/main)
