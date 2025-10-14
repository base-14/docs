---
title: Ruby on Rails OpenTelemetry Instrumentation
sidebar_label: Ruby on Rails
description:
  Auto-instrument Rails with OpenTelemetry for traces and metrics. Complete Ruby
  APM setup with distributed tracing and database monitoring.
keywords:
  [
    rails monitoring,
    ruby apm,
    rails instrumentation,
    opentelemetry rails,
    ruby on rails monitoring,
  ]
---

# Rails

Implement OpenTelemetry instrumentation for `Ruby on Rails` applications to
collect traces, metrics, and monitor HTTP requests using the Ruby OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/ruby/instrumentation).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Rails applications
- Configure automatic request and database tracing
- Implement custom instrumentation
- Collect HTTP metrics
- Export telemetry data to Scout Collector

## Prerequisites

Before starting, ensure you have:

- Ruby 2.7 or later installed
- Rails application set up
- Bundler installed for package management

## Required Packages

Install the following necessary packages by `gem install` or add it to `Gemfile`
and run `bundle install`.

```ruby showLineNumbers
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single database or a
sophisticated mesh of services, traces are essential to understanding the full
“path” a request takes in your application.

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

> View your traces in the base14 Scout platform.
>
> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the trace data.

## References

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Ruby Instrumentation](../custom-instrumentation/ruby.md) - Manual
  instrumentation for advanced use cases
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
