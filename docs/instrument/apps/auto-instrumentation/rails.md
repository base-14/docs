# Rails

Implement OpenTelemetry instrumentation for `Ruby on Rails` applications to
collect traces, metrics, and monitor HTTP requests using the Ruby OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult
> the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/ruby/instrumentation).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Rails applications
- Configure automatic request and database tracing
- Implement custom instrumentation
- Collect HTTP metrics
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- Ruby 2.7 or later installed
- Rails application set up
- Bundler installed for package management

## Required Packages

Install the following necessary packages by `gem install` or add it to
`Gemfile` and run `bundle install`.

```ruby showLineNumbers
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

### Auto Instrumentation

```ruby showLineNumbers title="config/initializers/otel.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

otlp_endpoint = ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://0.0.0.0:4318')

OpenTelemetry::SDK.configure do |c|
    c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
        OpenTelemetry::Exporter::OTLP::Exporter.new(
          endpoint: otlp_endpoint
        )
      )
    )

    c.use_all
end

TRACER = OpenTelemetry.tracer_provider.tracer('rails-app', '0.1.0')
```

> Trace data will now be sent to the OTEL Collector.

#### Add Custom Spans

```ruby showLineNumbers
def do_work():
    TRACER.in_span("span.name") do |span|
        # doing some work
    end
end
```

#### Add Span Attributes

Attributes let you attach key/value pairs to a span so it carries more
information about the current operation that it’s tracking.

```ruby showLineNumbers
def do_work():
    TRACER.in_span("span.name") do |span|
        span.set_attribute("attribute.key", "attribute.value")
        # doing some work
    end
end
```

#### Add Semantic Attribute

Semantic Attributes are pre-defined Attributes that are well-known naming
conventions for common kinds of data.

```ruby showLineNumbers
require 'opentelemetry/semantic_conventions'

def do_work():
    TRACER.in_span("span.name") do |span|
        span.add_attributes({
            OpenTelemetry::SemanticConventions::Trace::HTTP_METHOD => "GET",
            OpenTelemetry::SemanticConventions::Trace::HTTP_URL => "https://opentelemetry.io/",
        })
        # doing some work
    end
end
```

#### Add Span Events

A span event is a human-readable message on a span that represents “something
happening” during it’s lifetime.

```ruby showLineNumbers
def do_work():
    TRACER.in_span("span.name") do |span|
        span.add_event("Starting to work")
        # doing some work
        span.add_event("Ending the work")
    end
end
```

Once configured, trace data will be automatically collected and sent to
the OpenTelemetry Collector.

> View your traces in the base14 Scout observability platform.
>
> **Note**: Ensure your OpenTelemetry Collector is properly configured to
> receive and process the trace data.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)
