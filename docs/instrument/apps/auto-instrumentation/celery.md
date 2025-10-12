---
title: Celery OpenTelemetry Instrumentation | base14 Scout
description: Auto-instrument Celery task queue with OpenTelemetry for traces, metrics, and logs. Complete Python Celery monitoring with distributed tracing.
keywords: [celery monitoring, python celery, celery instrumentation, opentelemetry celery, task queue monitoring]
---

# Celery

This guide demonstrates how to Auto instrument tracing, metrics and logs using
OpenTelemetry for Celery and export them to a collector using python OTEL sdk.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/celery/celery.html).

## Setup

opentelemetry-api defines the API interfaces for tracing, metrics, and logging
and opentelemetry-sdk provides the implementation for these APIs.
Install the following necessary packages or add it to
`requirements.txt` and install it.

```plaintext
opentelemetry-api
opentelemetry-sdk
opentelemetry-exporter-otlp-proto-http
opentelemetry-instrumentation-celery
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

### Auto Instrumentation of Traces

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

> Trace data will now be sent to the OTEL Collector.

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Adding Custom Instrumentation

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

## Metrics

A metric is a measurement of a service captured at runtime. The moment of
capturing a measurements is known as a metric event, which consists not only of
the measurement itself, but also the time at which it was captured and
associated metadata.

### Auto Instrumentation of Metrics

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

> Metrics will now be exported to the OTEL Collector.

[Official Metrics Documentation](https://opentelemetry.io/docs/concepts/signals/metrics/)

## Logs

A log is a timestamped text record, either structured (recommended) or
unstructured, with optional metadata.

### Auto Instrumentation of Logs

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


provider = LoggerProvider(resource=resource)
_logs.set_logger_provider(provider)

log_exporter = OTLPLogExporter(endpoint="http://localhost:4318/v1/logs")
provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))

otel_handler = LoggingHandler(level=logging.INFO)

root_logger = logging.getLogger()
root_logger.addHandler(otel_handler)

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

> Logs will now be exported to OTEL Collector.

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [Custom Python Instrumentation](../custom-instrumentation/python.md) - Manual
  instrumentation for advanced use cases
- [Fast API Instrumentation](./fast-api.md) - Python web framework alternative

[Official Logs Documentation](https://opentelemetry.io/docs/concepts/signals/logs/)
