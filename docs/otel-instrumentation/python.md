# OpenTelemetry Instrumentation for python services


This guide explains how to instrument OTEL into your codebase.

## Setup

opentelemetry-api defines the API interfaces for tracing, metrics, and logging and opentelemetry-sdk provides the implementation for these APIs.
Run the following commands to install the necessary packages or add it to `requirements.txt` and install it.

```shell
pip install opentelemetry-api
pip install opentelemetry-sdk

# Optional
pip install opentelemetry-semantic-conventions
```

## Traces

### Initialization

To Start tracing first a tracer should be acquired and a TraceProvider should be initialized optionally we can pass a resource to TraceProvider.

> A Resource is an immutable representation of the entity producing telemetry. For example, a process
producing telemetry that is running in a container on Kubernetes has a Pod name, it is in a namespace and possibly
is part of a Deployment which also has a name. All three of these attributes can be included in the Resource.

Sample Reference code for Initialization

```python

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
)
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

resource = Resource({SERVICE_NAME: "my.service.name"})
provider = TracerProvider(resource=resource)
processor = BatchSpanProcessor(OTLPSpanExporter(endpoint="http://0.0.0.0:4318/v1/traces"))
provider.add_span_processor(processor)
processor = BatchSpanProcessor(ConsoleSpanExporter())
provider.add_span_processor(processor)

# Sets the global default tracer provider
trace.set_tracer_provider(provider)

# Creates a tracer from the global tracer provider
tracer = trace.get_tracer("my.tracer.name")
    
```

### Span

A span represents a unit of work or operation. Spans are the building blocks of Traces. In OpenTelemetry, they include some necessary information.

#### Creating a Span

```python
def do_work():
    with tracer.start_as_current_span("span.name") as span:
        # do some work that 'span' tracks
        print("doing some work...")
```

#### Creating nested Spans

```python
def do_work():
    with tracer.start_as_current_span("parent") as parent:
        # do some work that 'parent' tracks
        print("doing some work...")
        # Create a nested span to track nested work
        with tracer.start_as_current_span("child") as child:
            # do some work that 'child' tracks
            print("doing some nested work...")
```

#### Creating Spans with decorators

```python
@tracer.start_as_current_span("span")
def do_work():
    print("doing some work...")
```


[Official Span Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#spans)

### Attributes

Attributes let you attach key/value pairs to a span so it carries more information about the current operation that it’s tracking.

#### Adding Attributes to a Span

```python
def do_work():
    with tracer.start_as_current_span("span.name") as span:
        span.set_attribute("operation.value", 1)
        span.set_attribute("operation.name", "Saying hello!")
        span.set_attribute("operation.other-stuff", [1, 2, 3])
        
        print("doing some work...")
```

#### Adding Semantic Attributes to a Span

Semantic Attributes are pre-defined Attributes that are well-known naming conventions for common kinds of data. 
Using Semantic Attributes lets you normalize this kind of information across your systems.

> Ensure that you have installed `opentelemetry-semantic-conventions` package for using Semantic Attributes

```python
from opentelemetry.semconv.trace import SpanAttributes

def do_work():
    with tracer.start_as_current_span("span.name") as span:
        span.set_attribute(SpanAttributes.HTTP_METHOD, "GET")
        span.set_attribute(SpanAttributes.HTTP_URL, "https://base14.io/")
        
        print("doing some work...")
```

[Official Attributes Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#attributes)

### Events

An event is a human-readable message on a span that represents “something happening” during its lifetime. 
You can think of it as a primitive log.

#### Adding an event to a span

```python
def do_work():
    with tracer.start_as_current_span("span.name") as span:
        span.add_event("Starting some work")
        print("doing some work...")
        span.add_event("Finished working")
```

[Official Event Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)

### Span Status

A Status can be set on a Span, typically used to specify that a Span has not completed successfully - Error. 
By default, all spans are Unset, which means a span completed without error. The Ok status is reserved for 
when you need to explicitly mark a span as successful rather than stick with the default of Unset (i.e., “without error”).
We also look at how to record an exception in the Span.

#### Setting a Span Status

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

def do_work():
    with tracer.start_as_current_span("span.name") as span:
        try:
            # something that might fail
        except Exception as exception:
            span.set_status(Status(StatusCode.ERROR))
            span.record_exception(exception)
```

## Metrics

### Initialization

To start collecting metrics, you’ll need to initialize a MeterProvider and optionally set it as the global default.

Sample Reference code for Metrics Initialization

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    ConsoleMetricExporter,
    PeriodicExportingMetricReader,
)
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter

metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter(endpoint="http://0.0.0.0:4317/v1/metrics"))
metric_provider = MeterProvider(metric_readers=[metric_reader])
metrics.set_meter_provider(metric_provider)

# Creates a meter from the global meter provider
meter = metrics.get_meter("my.meter.name")
```

### Counter
Counter is a synchronous Instrument which supports non-negative increments.

#### Creating a Synchronous Counter

```python
work_counter = meter.create_counter(
    "work.counter", unit="1", description="Counts the amount of work done"
)

def do_work(work_type: string):
    work_counter.add(1, {"work.type": work_type})
    print("doing some work...")
```

#### Creating Asynchronous Counter

```python
from opentelemetry.metrics import Observation

def pf_callback(callback_options):
    return [
        Observation(8, attributes={"pid": 0, "bitness": 64}),
        Observation(37741921, attributes={"pid": 4, "bitness": 64}),
        Observation(10465, attributes={"pid": 880, "bitness": 32}),
    ]


meter.create_observable_counter(name="PF", description="process page faults", callbacks=[pf_callback])
```

[Official Counter Documentation](https://opentelemetry.io/docs/specs/otel/metrics/api/#counter)

### Histogram
Histogram is a synchronous Instrument which can be used to report arbitrary values that are likely to be statistically meaningful. It is intended for statistics such as histograms, summaries, and percentile.

#### Creating a Histogram

```python
http_server_duration = meter.create_histogram(
    name="http.server.duration",
    description="measures the duration of the inbound HTTP request",
    unit="ms",
    value_type=float)

http_server_duration.Record(50, {"http.request.method": "POST", "url.scheme": "https"})
http_server_duration.Record(100, http_method="GET", http_scheme="http")

```

[Official Histogram Documentation](https://opentelemetry.io/docs/specs/otel/metrics/api/#histogram)

