---
title: Ruby Custom OpenTelemetry Instrumentation - Manual Tracing Guide
sidebar_label: Ruby
description:
  Custom instrumentation for Ruby applications with OpenTelemetry. Manual
  tracing, spans, metrics, and telemetry export with Ruby OpenTelemetry SDK.
keywords:
  [
    ruby instrumentation,
    ruby opentelemetry,
    ruby custom instrumentation,
    ruby tracing,
    ruby observability,
    ruby distributed tracing,
    ruby manual instrumentation,
    opentelemetry ruby sdk,
  ]
---

# Ruby

Implement OpenTelemetry custom instrumentation for Ruby applications to collect
traces, metrics, and logs using the Ruby OpenTelemetry SDK. This guide covers
manual instrumentation for any Ruby application, including Sinatra, Hanami,
plain Rack applications, and custom frameworks.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK for manual instrumentation
- Create and manage custom spans
- Add attributes, events, and exception tracking
- Implement metrics collection
- Propagate context across service boundaries
- Instrument common Ruby patterns and frameworks

## Prerequisites

Before starting, ensure you have:

- **Ruby 3.0 or later** installed
- **Bundler** for dependency management
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

## Required Packages

Add to your `Gemfile`:

```ruby showLineNumbers title="Gemfile"
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'

# Optional: Semantic conventions
gem 'opentelemetry-semantic_conventions'
```

Install dependencies:

```bash showLineNumbers
bundle install
```

## Traces

Traces provide a complete picture of request flows through your application,
from initial request to final response, including all operations and services
involved.

### Initialization

Initialize the OpenTelemetry SDK and configure exporters:

```ruby showLineNumbers title="config/telemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'my-ruby-app'
  c.service_version = '1.0.0'

  # Use OTLP exporter for production
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318/v1/traces')
      )
    )
  )
end

# Get a tracer
MyAppTracer = OpenTelemetry.tracer_provider.tracer('my-app', '1.0.0')
```

> **Note**: Ensure your Scout Collector is properly configured to receive trace
> data at the endpoint specified above.

### Creating Spans

Create a span to track an operation:

```ruby showLineNumbers
MyAppTracer.in_span('operation-name') do |span|
  # Perform your operation
  perform_work
end
```

### Creating Nested Spans

Create parent-child span relationships:

```ruby showLineNumbers
def process_request
  MyAppTracer.in_span('process_request') do |parent_span|
    # Validate input
    MyAppTracer.in_span('validate_input') do
      validate_input
    end

    # Fetch data
    MyAppTracer.in_span('fetch_data') do
      fetch_from_database
    end

    # Process results
    MyAppTracer.in_span('process_data') do
      process_results
    end
  end
end
```

## Attributes

Attributes add context to spans as key-value pairs:

### Adding Custom Attributes

```ruby showLineNumbers
def process_order(order_id)
  MyAppTracer.in_span('process_order') do |span|
    span.set_attribute('order.id', order_id)
    span.set_attribute('order.status', 'processing')
    span.set_attribute('order.items_count', 5)

    # Process the order
    result = process(order_id)

    span.set_attribute('order.total', result.total)
    span.set_attribute('order.status', 'completed')
  end
end
```

### Using Semantic Conventions

Use standardized attribute names for common operations:

```ruby showLineNumbers
require 'opentelemetry/semantic_conventions'

def make_http_request(url, method)
  MyAppTracer.in_span('http_request') do |span|
    span.set_attribute(
      OpenTelemetry::SemanticConventions::Trace::HTTP_METHOD,
      method
    )
    span.set_attribute(
      OpenTelemetry::SemanticConventions::Trace::HTTP_URL,
      url
    )

    response = HTTP.send(method.downcase, url)

    span.set_attribute(
      OpenTelemetry::SemanticConventions::Trace::HTTP_STATUS_CODE,
      response.code
    )
  end
end
```

## Events

Events mark significant moments during a span's lifetime:

```ruby showLineNumbers
def process_payment(payment_info)
  MyAppTracer.in_span('process_payment') do |span|
    span.add_event('payment_received', attributes: {
      'payment.method' => payment_info[:method],
      'payment.amount' => payment_info[:amount]
    })

    # Process payment
    result = charge_card(payment_info)

    span.add_event('payment_processed', attributes: {
      'transaction.id' => result.transaction_id,
      'payment.status' => result.status
    })

    if result.success?
      span.add_event('payment_confirmed')
    end
  end
end
```

## Exception Recording

Capture and record exceptions in spans:

```ruby showLineNumbers
def risky_operation
  MyAppTracer.in_span('risky_operation') do |span|
    begin
      perform_risky_work
      span.status = OpenTelemetry::Trace::Status.ok

    rescue StandardError => e
      span.record_exception(e)
      span.status = OpenTelemetry::Trace::Status.error(e.message)
      raise
    end
  end
end
```

## Metrics

Collect custom metrics to track application performance:

### Counter

Track cumulative values that only increase:

```ruby showLineNumbers
meter = OpenTelemetry.meter_provider.meter('my-app')

request_counter = meter.create_counter(
  'http.requests',
  unit: 'requests',
  description: 'Total number of HTTP requests'
)

# Increment counter
def handle_request(method, route)
  request_counter.add(1, attributes: {
    'http.method' => method,
    'http.route' => route
  })

  # Handle request...
end
```

### Histogram

Record distributions of values:

```ruby showLineNumbers
request_duration = meter.create_histogram(
  'http.request.duration',
  unit: 'ms',
  description: 'HTTP request duration'
)

def track_request_duration(method, status)
  start_time = Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond)

  # Process request
  yield

  duration = Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond) - start_time

  request_duration.record(duration, attributes: {
    'http.method' => method,
    'http.status_code' => status
  })
end
```

### UpDownCounter

Track values that can increase or decrease:

```ruby showLineNumbers
active_connections = meter.create_up_down_counter(
  'db.connections.active',
  unit: 'connections',
  description: 'Currently active database connections'
)

# Connection opened
active_connections.add(1)

# Connection closed
active_connections.add(-1)
```

## Context Propagation

Propagate trace context across HTTP requests:

### Outgoing HTTP Requests

```ruby showLineNumbers
require 'net/http'
require 'opentelemetry/propagator/trace_context'

def make_external_request(url)
  MyAppTracer.in_span('external_api_call') do |span|
    uri = URI(url)
    request = Net::HTTP::Get.new(uri)

    # Inject trace context into headers
    carrier = {}
    OpenTelemetry.propagation.inject(carrier)

    carrier.each do |key, value|
      request[key] = value
    end

    # Make the request with trace headers
    response = Net::HTTP.start(uri.hostname, uri.port) do |http|
      http.request(request)
    end

    span.set_attribute('http.status_code', response.code.to_i)
    response
  end
end
```

### Incoming HTTP Requests

```ruby showLineNumbers
def handle_incoming_request(env)
  # Extract context from incoming request headers
  context = OpenTelemetry.propagation.extract(env)

  # Start span with extracted context
  OpenTelemetry::Context.with_current(context) do
    MyAppTracer.in_span('handle_request') do |span|
      span.set_attribute('http.method', env['REQUEST_METHOD'])
      span.set_attribute('http.url', env['REQUEST_URI'])

      # Process request
      process_request(env)
    end
  end
end
```

## Framework-Specific Examples

### Sinatra Application

```ruby showLineNumbers title="app.rb"
require 'sinatra'
require_relative 'config/telemetry'

before do
  # Extract trace context from headers
  context = OpenTelemetry.propagation.extract(request.env)

  OpenTelemetry::Context.with_current(context) do
    MyAppTracer.in_span("#{request.request_method} #{request.path}") do |span|
      span.set_attribute('http.method', request.request_method)
      span.set_attribute('http.route', request.path)

      @current_span = span
    end
  end
end

get '/users/:id' do |id|
  MyAppTracer.in_span('fetch_user') do |span|
    span.set_attribute('user.id', id)

    user = User.find(id)

    @current_span.set_attribute('http.status_code', 200)
    user.to_json
  end
end

post '/orders' do
  MyAppTracer.in_span('create_order') do |span|
    data = JSON.parse(request.body.read)

    span.set_attribute('order.items_count', data['items'].length)

    order = Order.create(data)

    span.set_attribute('order.id', order.id)
    span.set_attribute('order.total', order.total)

    @current_span.set_attribute('http.status_code', 201)
    status 201
    order.to_json
  end
end
```

### Rack Middleware

```ruby showLineNumbers title="lib/telemetry_middleware.rb"
class TelemetryMiddleware
  def initialize(app)
    @app = app
    @tracer = OpenTelemetry.tracer_provider.tracer('rack-app')
  end

  def call(env)
    context = OpenTelemetry.propagation.extract(env)

    OpenTelemetry::Context.with_current(context) do
      @tracer.in_span("#{env['REQUEST_METHOD']} #{env['PATH_INFO']}") do |span|
        span.set_attribute('http.method', env['REQUEST_METHOD'])
        span.set_attribute('http.url', env['PATH_INFO'])

        status, headers, response = @app.call(env)

        span.set_attribute('http.status_code', status)

        [status, headers, response]
      end
    end
  end
end

# Use in config.ru
use TelemetryMiddleware
```

### Plain Ruby Application

```ruby showLineNumbers title="worker.rb"
require_relative 'config/telemetry'

class BackgroundWorker
  def process_jobs
    loop do
      job = fetch_next_job

      MyAppTracer.in_span('process_job') do |span|
        span.set_attribute('job.id', job.id)
        span.set_attribute('job.type', job.type)

        begin
          process_job(job)

          span.set_attribute('job.status', 'completed')
          span.status = OpenTelemetry::Trace::Status.ok

        rescue StandardError => e
          span.record_exception(e)
          span.set_attribute('job.status', 'failed')
          span.status = OpenTelemetry::Trace::Status.error(e.message)

          handle_job_failure(job, e)
        end
      end

      sleep 1
    end
  end
end
```

## Best Practices

### 1. Always Use Blocks for Spans

```ruby
# Good - span automatically ended
MyAppTracer.in_span('operation') do |span|
  do_work
end

# Bad - manual span management (error-prone)
span = MyAppTracer.start_span('operation')
do_work
span.finish # May not be called if exception occurs
```

### 2. Use Descriptive Span Names

```ruby
# Good
MyAppTracer.in_span('UserRepository#find_by_email')
MyAppTracer.in_span('PaymentService#process_payment')

# Bad
MyAppTracer.in_span('operation')
MyAppTracer.in_span('query')
```

### 3. Add Relevant Attributes

```ruby
# Good
span.set_attribute('user.id', user_id)
span.set_attribute('order.amount', amount)
span.set_attribute('cache.hit', true)

# Bad - sensitive data
span.set_attribute('user.password', password) # Never!
span.set_attribute('credit_card.number', cc_number) # Never!
```

### 4. Use Semantic Conventions

```ruby
# Good - using semantic conventions
span.set_attribute(OpenTelemetry::SemanticConventions::Trace::HTTP_METHOD, 'POST')

# Also good - using semantic convention values
span.set_attribute('http.method', 'POST')
span.set_attribute('db.system', 'postgresql')
```

### 5. Handle Exceptions Properly

```ruby
# Good
MyAppTracer.in_span('operation') do |span|
  begin
    risky_operation
  rescue StandardError => e
    span.record_exception(e)
    span.status = OpenTelemetry::Trace::Status.error(e.message)
    raise
  end
end

# Bad - swallowing exceptions without recording
begin
  risky_operation
rescue StandardError
  # Exception lost
end
```

## Complete Example

Here's a complete example of a Ruby application with custom instrumentation:

```ruby showLineNumbers title="app.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/semantic_conventions'
require 'json'

# Initialize OpenTelemetry
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'my-ruby-app'
  c.service_version = '1.0.0'

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: 'http://localhost:4318/v1/traces'
      )
    )
  )
end

tracer = OpenTelemetry.tracer_provider.tracer('my-app', '1.0.0')
meter = OpenTelemetry.meter_provider.meter('my-app')

# Create metrics
request_counter = meter.create_counter('requests.total', unit: 'requests')
request_duration = meter.create_histogram('requests.duration', unit: 'ms')

# Process request
def process_request(tracer, request_counter, request_duration)
  start_time = Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond)

  tracer.in_span('http.request') do |span|
    span.set_attribute('http.method', 'POST')
    span.set_attribute('http.url', '/api/orders')

    begin
      # Business logic
      result = create_order

      span.set_attribute('http.status_code', 201)
      span.status = OpenTelemetry::Trace::Status.ok

      status_code = 201

    rescue StandardError => e
      span.record_exception(e)
      span.set_attribute('http.status_code', 500)
      span.status = OpenTelemetry::Trace::Status.error(e.message)

      status_code = 500
    ensure
      duration = Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond) - start_time

      request_counter.add(1, attributes: { 'status' => status_code })
      request_duration.record(duration, attributes: { 'status' => status_code })
    end
  end
end

def create_order
  tracer.in_span('create_order') do |span|
    # Simulate order creation
    order_id = rand(1000..9999)

    span.set_attribute('order.id', order_id)
    span.set_attribute('order.total', 99.99)

    { id: order_id, total: 99.99, status: 'created' }
  end
end

# Run the application
process_request(tracer, request_counter, request_duration)

# Shutdown to flush remaining spans
OpenTelemetry.tracer_provider.shutdown
```

## Extracting Trace and Span IDs

Extract trace ID and span ID for log correlation:

```ruby showLineNumbers
def get_trace_span_ids
  current_span = OpenTelemetry::Trace.current_span

  if current_span.context.valid?
    trace_id = current_span.context.trace_id.unpack1('H*')
    span_id = current_span.context.span_id.unpack1('H*')

    puts "Trace ID: #{trace_id}"
    puts "Span ID: #{span_id}"

    [trace_id, span_id]
  else
    [nil, nil]
  end
end

# Usage
MyAppTracer.in_span('my-operation') do
  trace_id, span_id = get_trace_span_ids

  # Use for structured logging
  logger.info("Processing request", {
    trace_id: trace_id,
    span_id: span_id,
    operation: 'my-operation'
  })
end
```

## References

- [Official OpenTelemetry Ruby Documentation](https://opentelemetry.io/docs/languages/ruby/)
- [OpenTelemetry Ruby GitHub](https://github.com/open-telemetry/opentelemetry-ruby)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Rails Auto-Instrumentation](../auto-instrumentation/rails.md) - Automatic
  tracing for Ruby on Rails applications
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up Scout Collector for local development
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for your telemetry data
