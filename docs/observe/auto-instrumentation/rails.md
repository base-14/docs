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

:::warning
Make sure you have set up the local development environment as
described [here](../local-dev-env-setup.md).
:::

## Required Packages

Install the following necessary packages by `gem install` or add it to
`Gemfile` and run `bundle install`.

```ruby
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'
gem 'opentelemetry-instrumentation-rails'
gem 'opentelemetry-instrumentation-net_http'
gem 'opentelemetry-instrumentation-active_support'
gem 'opentelemetry-instrumentation-active_record'
gem 'opentelemetry-instrumentation-rack'
gem 'opentelemetry-semantic_conventions'
```

## Configuration

### Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full “path” a request takes in your application.

#### Auto Instrumentation

```ruby title="config/initializers/otel.rb"

require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  c.use 'OpenTelemetry::Instrumentation::Rails'
  c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
  c.use 'OpenTelemetry::Instrumentation::Net::HTTP'
  c.use 'OpenTelemetry::Instrumentation::ActiveSupport'
  c.use 'OpenTelemetry::Instrumentation::Rack', {
    record_frontend_span: true
  }

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: 'http://localhost:4318/v1/traces'
      )
    )
  )

end

TRACER = OpenTelemetry.tracer_provider.tracer('rails-app', '0.1.0')
```

> Trace data will now be sent to the OTEL Collector.

#### Add Custom Spans

```ruby
def do_work():
    TRACER.in_span("span.name") do |span|
        # doing some work
    end
end
```

#### Add Span Attributes

Attributes let you attach key/value pairs to a span so it carries more
information about the current operation that it’s tracking.

```ruby
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

```ruby
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

```ruby
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
