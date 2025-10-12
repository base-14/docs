---
title: Ruby Custom OpenTelemetry Instrumentation
description:
  Custom instrumentation for Ruby applications with OpenTelemetry. Manual
  tracing, metrics, logs, spans, and telemetry export with Ruby OTel SDK.
keywords:
  [
    ruby instrumentation,
    ruby monitoring,
    opentelemetry ruby,
    ruby custom instrumentation,
    ruby observability,
  ]
---

# Ruby

Implement OpenTelemetry custom instrumentation for `Ruby` applications to
collect logs, metrics, and traces using the Ruby OTel SDK.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for `Ruby`
- Configure manual tracing using spans
- Create and manage custom metrics
- Add semantic attributes and events
- Export telemetry data to Scout Collector

## Prerequisites

Before starting, ensure you have:

- Ruby 3.4.4 or later installed
- A Ruby project set up

## Required Packages

Install the following necessary packages:

```bash
gem install opentelemetry-sdk
gem install opentelemetry-exporter-otlp
gem install opentelemetry-metrics-sdk

# Optional package for adding semantic attributes
gem install opentelemetry-semantic_conventions
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single database or a
sophisticated mesh of services, traces are essential to understanding the full
“path” a request takes in your application.

### Initialization

To Start tracing, first a tracer should be acquired and a TraceProvider should
be initialized optionally we can pass a resource to TraceProvider.

> A Resource is an immutable representation of the entity producing telemetry.
> For example, a process producing telemetry that is running in a container on
> Kubernetes has a Pod name, it is in a namespace and possibly is part of a
> Deployment which also has a name. All three of these attributes can be
> included in the Resource.

Sample Reference code for Initialization

```ruby showLineNumbers
require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'ruby-application'

  c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
        OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: "http://0.0.0.0:4318/v1/traces"
        )
      )
    )
end

# 'Tracer' can be used throughout your code now
MyAppTracer = OpenTelemetry.tracer_provider.tracer('my.tracer.name')
```

> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the trace data.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Span

A span represents a unit of work or operation. Spans are the building blocks of
Traces. In OpenTelemetry, they include some necessary information.

#### Creating a Span

```ruby showLineNumbers
def do_work
  MyAppTracer.in_span("span.name") do |span|
    # do some work that 'span' tracks
    puts "[do_work] Doing some traced work..."
  end
end
```

#### Creating nested Spans

```ruby showLineNumbers
def do_work
  MyAppTracer.in_span("parent") do |span|
    puts "Doing some work..."
    MyAppTracer.in_span("child") do |span|
      puts "Doing some nested work..."
    end
  end
end
```

#### Reference

[Official Span Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#spans)

### Attributes

Attributes let you attach key/value pairs to a span so it carries more
information about the current operation that it’s tracking.

#### Adding Attributes to a Span

```ruby showLineNumbers
def do_work
  current_span = OpenTelemetry::Trace.current_span
  current_span.add_attributes({
    "operation.value"=> 1,
    "operation.name"=> "Saying hello!",
    "operation.other-stuff"=> [1, 2, 3]
  })

  puts "doing some work..."
end
```

#### Adding Semantic Attributes to a Span

Semantic Attributes are pre-defined Attributes that are well-known naming
conventions for common kinds of data. Using Semantic Attributes lets you
normalize this kind of information across your systems.

> Ensure that you have installed `opentelemetry-semantic_conventions` gem for
> using Semantic Attributes

```ruby showLineNumbers
require 'opentelemetry/sdk'
require 'opentelemetry/semantic_conventions'
def do_work
  current_span = OpenTelemetry::Trace.current_span

  current_span.add_attributes({
    OpenTelemetry::SemanticConventions::Trace::HTTP_METHOD => "GET",
    OpenTelemetry::SemanticConventions::Trace::HTTP_URL => "https://base14.io/",
  })

  puts "Doing some work..."
end
```

> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the span data.

#### Reference

[Official Attributes Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#attributes)

### Events

An event is a human-readable message on a span that represents “something
happening” during its lifetime.

You can think of it as a primitive log.

#### Adding an event to a span

```ryby showLineNumbers
def do_work
  span = OpenTelemetry::Trace.current_span

  span.add_event("Acquiring lock")
  if mutex.try_lock
    span.add_event("Got lock, doing work...")
    # some code here
    span.add_event("Releasing lock")
  else
    span.add_event("Lock already in use")
  end
end
```

#### Reference

[Official Event Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)

### Span Status

A Status can be set on a Span, typically used to specify that a Span has not
completed successfully - `Error`. By default, all spans are Unset, which means a
span completed without error. The `Ok` status is reserved for when you need to
explicitly mark a span as successful rather than stick with the default of
`Unset` (i.e., “without error”).

We also look at how to record an exception in the Span.

#### Setting a Span Status

```ruby showLineNumbers
require "opentelemetry/sdk"

def do_work():
  current_span = OpenTelemetry::Trace.current_span

  begin
    1/0 # something that obviously fails
  rescue Exception => e
    current_span.status = OpenTelemetry::Trace::Status.error("error message here!")
    current_span.record_exception(e)
  end
end
```

> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the span data.

## Metrics

The metrics API & SDK are currently under development.

## Logs

The logs API & SDK are currently under development.

## Extracting Trace and Span IDs

To extract trace ID and span ID from the current context for log correlation or
debugging purposes:

```ruby showLineNumbers
require 'opentelemetry/trace'

def get_trace_span_ids
  # Get the current span
  current_span = OpenTelemetry::Trace.current_span

  if current_span.context.valid?
    # Extract trace ID and span ID
    trace_id = current_span.context.trace_id.unpack1('H*')
    span_id = current_span.context.span_id.unpack1('H*')

    puts "Trace ID: #{trace_id}"
    puts "Span ID: #{span_id}"

    return trace_id, span_id
  else
    puts "No active span found"
    return nil, nil
  end
end

# Usage within a traced function
def traced_function
  MyAppTracer.in_span("my-operation") do |span|
    trace_id, span_id = get_trace_span_ids
    # Use these IDs for log correlation or debugging
    puts "Processing operation with trace: #{trace_id}, span: #{span_id}"
  end
end
```

## References

- [Official OpenTelemetry Ruby Documentation](https://opentelemetry.io/docs/languages/ruby/getting-started/)
- [OpenTelemetry API Documentation](https://opentelemetry.io/docs/reference/specification/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/semantic-conventions/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
- [Rails Auto-Instrumentation](../auto-instrumentation/rails.md) -
  Auto-instrumentation for Ruby on Rails applications
