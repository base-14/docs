# Fast API

This guide demonstrates how to Auto instrument tracing and metrics using
OpenTelemetry for Fast API and export them to a collector using python OTEL sdk.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html).

## Setup

opentelemetry-api defines the API interfaces for tracing, metrics, and logging
and opentelemetry-sdk provides the implementation for these APIs.
Install the following necessary packages or add it to
`requirements.txt` and install it.

```shell
opentelemetry-instrumentation-fastapi
opentelemetry-sdk
opentelemetry-exporter-otlp
opentelemetry-api

# Optional
opentelemetry-instrumentation-requests
requests
```

:::warning

Make sure you have set up the local development environment as
described in [here](../local-dev-env-setup.md).
:::

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

### Auto Instrumentation of Traces

```python
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


resource = Resource.create({"service.name": "custom-fastapi-service"})
trace.set_tracer_provider(
    TracerProvider(
        resource=resource
    )
)
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://0.0.0.0:4318/v1/traces"))
)

app = FastAPI()

FastAPIInstrumentor.instrument_app(app)

# Optional to capture traces for requests made using requests package
RequestsInstrumentor().instrument()
```

> Trace data will now be sent to the OTEL Collector, enabling distributed
> tracing and deeper insights into request flows within the application.

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Adding Custom Instrumentation

```python
def do_work():
    tracer = trace.get_tracer(__name__)
    parent_span = trace.get_current_span()
    ctx_with_parent_span = trace.set_span_in_context(parent_span)

    with tracer.start_as_current_span("span", context=ctx_with_parent_span) as span:
        span.set_attribute("key", "value")
        # do some work ...
```

## Metrics

A metric is a measurement of a service captured at runtime. The moment of
capturing a measurements is known as a metric event, which consists not only of
the measurement itself, but also the time at which it was captured and
associated metadata.

### Auto Instrumentation of Metrics

```python
// main.py

from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import  metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.metrics import MeterProvider
from .MetricsMiddleware import MetricsMiddleware

from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
resource = Resource.create({"service.name": "custom-fastapi-service"})


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

```python
// MetricsMiddleware.py

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

> Metrics will now be exported to the OTEL Collector. The `MetricsMiddleware`
> captures each HTTP request, including the method, path, and status code, and
> tracks the total request count.

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

> 🧪 **Sample Application:** A sample application with OpenTelemetry
> instrumentation can be found at
> this [GitHub repository](https://github.com/base-14/examples/tree/main)
