# Celery

Implement OpenTelemetry auto instrumentation for `Celery` to collect
logs, metrics and traces using the `Python` OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/celery/celery.html).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for `Celery`
- Configure automatic tracing for task execution
- Collect metrics from Celery workers
- Capture structured logs from Celery operations
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- Python 3.7 or later installed
- A project set up with Celery
- Access to package installation (`pip`)

:::warning
Ensure the local development environment is complete as described
[here](../local-dev-env-setup.md).
:::

## Required Packages

`opentelemetry-api` defines the API interfaces for logging, metrics, and tracing;
`opentelemetry-sdk` provides the implementation for these APIs.

Install the following necessary packages or add it to `requirements.txt`
and install it.

```plaintext
opentelemetry-api
opentelemetry-sdk
opentelemetry-exporter-otlp-proto-http
opentelemetry-instrumentation-celery
```

## Configuration

The setup process involves three main components:

1. **Traces Configuration**:

- Initialize Celery instrumentation
- Configure trace context propagation
- Set up custom span attributes

1. **Metrics Configuration**:

- Set up meter provider
- Configure metric exporters
- Define collection intervals

1. **Logs Configuration**:

- Initialize logger provider
- Set up log processors
- Configure log exporters

### Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

#### Auto Instrumentation of Traces

```python showLineNumbers
from opentelemetry.instrumentation.celery import CeleryInstrumentor

from celery import Celery
from celery.signals import worker_process_init

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    CeleryInstrumentor().instrument()

app = Celery("tasks", broker="amqp://localhost")

@app.task
def add(x, y):
    return x + y

add.delay(42, 50)
```

Once configured, trace data will be automatically collected and sent to
the OpenTelemetry Collector with the following details:

- Task execution spans
- Task arguments and results
- Task timing information
- Error details (if any)
- Distributed context propagation

> View your traces in the base14 Scout observability platform.
>
> **Note**: Ensure your OpenTelemetry Collector is properly configured to
> receive and process the trace data.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

#### Adding Custom Instrumentation

```python showLineNumbers
from opentelemetry.propagate import inject, extract
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.trace import get_tracer
from celery import Celery
from celery.signals import worker_process_init
from opentelemetry.context import get_current

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    CeleryInstrumentor().instrument()

app = Celery("tasks", broker="amqp://localhost")

@app.task
def add(x, y, carrier):
    with tracer.start_as_current_span("add", context=ctx):
        return x + y

def do_work():
    carrier = {}
    inject(carrier)
    add.delay(1, 2, carrier)
     tracer = get_tracer(__name__)

    # Extract the context from the incoming carrier
    if context:
        ctx = extract(context)
    else:
        ctx = get_current()

do_work()
```

### Metrics

OpenTelemetry metrics provide quantitative data about service behavior and
performance. Celery metrics capture:

- Task execution times
- Queue lengths
- Worker status
- Task success/failure rates
- Resource utilization

#### Auto Instrumentation of Metrics

```python showLineNumbers
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from celery import Celery
from celery.signals import worker_process_init
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.metrics import MeterProvider

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    CeleryInstrumentor().instrument()

app = Celery("tasks", broker="amqp://localhost")

# Configure metrics with service name and export interval
resource = Resource(attributes={SERVICE_NAME: "celery"})
metric_reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(endpoint="http://0.0.0.0:4318/v1/metrics"),
    export_interval_millis=1000
)
metrics.set_meter_provider(
    MeterProvider(resource=resource, metric_readers=[metric_reader])
)

@app.task
def add(x, y):
    return x + y

add.delay(42, 50)
```

Key metrics collected:

- `celery.task.execution.time`: Duration of task execution
- `celery.tasks.pending`: Number of tasks waiting in queue
- `celery.workers.active`: Count of active workers
- `celery.task.retries`: Number of task retry attempts
- `celery.memory.usage`: Memory consumption by workers

Metrics will be automatically exported to the OpenTelemetry Collector at the
configured interval.

> View these metrics in base14 Scout observability backend.

#### Reference

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

### Logs

OpenTelemetry logs provide detailed insights into application behavior through
structured records. The Celery logging integration captures:

- Task execution events
- Worker state changes
- Error conditions
- System statistics
- Queue operations

#### Auto Instrumentation of Logs

```python showLineNumbers
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry import _logs
import logging

from celery import Celery
from celery.signals import worker_process_init

@worker_process_init.connect(weak=False)
def init_celery_tracing(*args, **kwargs):
    CeleryInstrumentor().instrument()

app = Celery("tasks", broker="amqp://localhost")

# Configure logger provider with resource attributes
provider = LoggerProvider(resource=resource)
_logs.set_logger_provider(provider)

# Set up OTLP log exporter
log_exporter = OTLPLogExporter(endpoint="http://localhost:4318/v1/logs")
provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))

# Configure logging handler
otel_handler = LoggingHandler(level=logging.INFO)

# Set up root logger
root_logger = logging.getLogger()
root_logger.addHandler(otel_handler)

# Configure Celery-specific loggers
for name in [
    "celery",
    "celery.app.trace",
    "celery.worker",
    "kombu",
    "amqp"
]:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.addHandler(otel_handler)

@app.task
def add(x, y):
    return x + y

add.delay(42, 50)
```

Logs will be automatically exported to the OpenTelemetry Collector.

> View these logs in base14 Scout observability backend.

#### Reference

[Official Logs Documentation](https://opentelemetry.io/docs/concepts/signals/logs/)
