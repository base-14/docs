---
title: Rails OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Ruby on Rails
description:
  Complete guide to Rails OpenTelemetry instrumentation for application
  performance monitoring. Set up auto-instrumentation for traces, metrics,
  ActiveRecord database monitoring, and production deployments with
  base14 Scout in minutes.
keywords:
  [
    rails opentelemetry instrumentation,
    rails monitoring,
    ruby apm,
    rails application performance monitoring,
    opentelemetry rails,
    ruby on rails monitoring,
    rails distributed tracing,
    activerecord query monitoring,
    rails observability,
    rails performance monitoring,
    ruby opentelemetry sdk,
    rails production monitoring,
    rails database monitoring,
    rails metrics,
    rails tracing,
    sidekiq monitoring,
    rails n+1 queries,
    rails instrumentation guide,
    opentelemetry ruby,
    rails telemetry,
  ]
---

# Ruby on Rails

Implement OpenTelemetry instrumentation for Ruby on Rails applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to auto-instrument your Rails application
to collect traces and metrics from HTTP requests, database queries, background
jobs, and custom business logic using the OpenTelemetry Ruby SDK.

Rails applications benefit from automatic instrumentation of popular frameworks
and libraries including ActiveRecord, ActionPack, ActionView, Redis, Sidekiq,
and dozens of commonly used gems. With OpenTelemetry, you can monitor production
performance, debug slow requests, trace distributed transactions across
microservices, and identify database bottlenecks without significant code changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations and best practices for
Rails OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Rails-focused overview based on the
official OpenTelemetry documentation. For complete Ruby language information,
please consult the [official OpenTelemetry Ruby documentation](https://opentelemetry.io/docs/languages/ruby/instrumentation).

## Who This Guide Is For

This documentation is designed for:

- **Rails developers:**
  implementing observability and distributed tracing for the first time
- **DevOps engineers:**
  deploying Rails applications with production monitoring requirements
- **Engineering teams:**
  migrating from DataDog, New Relic, or other commercial APM solutions
- **Developers:**
  debugging performance issues, slow database queries, or N+1 problems in Rails applications
- **Platform teams:**
  standardizing observability across multiple Rails services

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK for Rails applications
- Set up automatic instrumentation for HTTP requests, database queries, and
  popular gems
- Configure production-ready telemetry export to Scout Collector
- Implement custom instrumentation for business-critical operations
- Collect and analyze traces, metrics, and performance data
- Deploy instrumented Rails applications to development, staging, and
  production environments
- Troubleshoot common instrumentation issues and optimize performance
- Secure sensitive data in telemetry exports

## Prerequisites

> 📦 **Using older versions?** If you're on Ruby 2.7, Rails 5.x, or other
> legacy versions, see our [Legacy Rails Instrumentation Guide](./rails-legacy.md)
> for version-specific configurations and known limitations.

Before starting, ensure you have:

- **Ruby 3.0 or later** (CRuby), **JRuby 9.3.2.0+**, or **TruffleRuby 22.1+**
  - For best performance and compatibility, Ruby 3.1+ is recommended
  - JRuby users should use the latest stable release
- **Rails 6.0 or later** installed
  - Rails 7.0+ is recommended for optimal OpenTelemetry support
  - Rails 6.x is supported but may require additional configuration
- **Bundler 2.0+** for dependency management
- **Scout Collector** configured and accessible
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - Production deployments should use a dedicated Scout Collector instance
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component | Minimum Version | Recommended Version |
|-----------|----------------|---------------------|
| Ruby (CRuby) | 3.0.0 | 3.2.0+ |
| JRuby | 9.3.2.0 | 9.4.0+ |
| TruffleRuby | 22.1.0 | Latest stable |
| Rails | 6.0.0 | 7.1.0+ |
| Bundler | 2.0.0 | 2.4.0+ |

## Required Packages

Install the following necessary packages by `gem install` or add it to `Gemfile`
and run `bundle install`.

```ruby showLineNumbers
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'
```

## Configuration

OpenTelemetry Rails instrumentation can be configured using multiple approaches
depending on your deployment requirements and preferences. Choose the method
that best fits your application architecture.

### Option 1: Initializer Configuration (Recommended)

The recommended approach is to create a dedicated OpenTelemetry initializer.
This provides the most flexibility and keeps configuration separate from your
application bootstrap.

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
      )
    )
  )

  c.use_all
end

TRACER = OpenTelemetry.tracer_provider.tracer('rails-app', '1.0.0')
```

This configuration automatically instruments all supported Rails components and
gems including:

- **Rails Core**: ActionPack, ActionView, ActiveRecord, ActiveJob, ActionMailer
- **HTTP Clients**: Net::HTTP, Faraday, HTTPClient, RestClient
- **Databases**: PostgreSQL, MySQL, SQLite, MongoDB
- **Caching**: Redis, Memcached
- **Background Jobs**: Sidekiq, DelayedJob, Resque
- **Web Servers**: Rack, Puma, Unicorn

### Option 2: Environment Configuration

For applications using `config/environment.rb` for initialization, you can
configure OpenTelemetry before Rails boots:

```ruby showLineNumbers title="config/environment.rb"
require_relative 'application'
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.use_all
end

Rails.application.initialize!
```

This approach ensures OpenTelemetry is configured before any application code
runs, which can be useful for capturing early initialization events.

### Option 3: Environment Variables Only

For containerized deployments or environments where configuration is managed
externally, you can rely entirely on environment variables:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.use_all
end
```

With this minimal configuration, use environment variables to control behavior:

```bash
export OTEL_SERVICE_NAME=rails-app
export OTEL_SERVICE_VERSION=1.0.0
export OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_LEVEL=info
```

### Selective Instrumentation

If you want to enable only specific instrumentations or disable certain gems,
use selective configuration:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  # Enable specific instrumentations only
  c.use 'OpenTelemetry::Instrumentation::Rails'
  c.use 'OpenTelemetry::Instrumentation::ActionPack'
  c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
  c.use 'OpenTelemetry::Instrumentation::Redis'
  c.use 'OpenTelemetry::Instrumentation::Sidekiq'
end
```

To use all instrumentations except specific ones:

```ruby showLineNumbers
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  # Use all but disable specific instrumentations
  c.use_all({
    'OpenTelemetry::Instrumentation::ActionCable' => { enabled: false },
    'OpenTelemetry::Instrumentation::MongoDB' => { enabled: false }
  })
end
```

### Configuring Instrumentation Options

Many instrumentations support additional configuration options:

```ruby showLineNumbers
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  c.use_all({
    'OpenTelemetry::Instrumentation::ActiveRecord' => {
      enabled: true,
      enable_statement_obfuscation: true,  # Sanitize SQL in spans
      db_statement_limit: 2000              # Limit SQL length in attributes
    },
    'OpenTelemetry::Instrumentation::Redis' => {
      enabled: true,
      db_statement_limit: 500
    },
    'OpenTelemetry::Instrumentation::Rack' => {
      enabled: true,
      untraced_endpoints: ['/health', '/metrics']  # Skip health checks
    }
  })
end
```

### Scout Collector Integration

When using Scout Collector, configure your Rails application to send telemetry
data to the Scout Collector endpoint:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Scout Collector endpoint
  scout_endpoint = ENV.fetch('SCOUT_COLLECTOR_ENDPOINT', 'http://localhost:4318')

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: scout_endpoint,
        headers: {
          'x-scout-api-key' => ENV['SCOUT_API_KEY']
        }.compact
      )
    )
  )

  c.use_all
end
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
in the Scout Dashboard. Navigate to the Traces section to view request flows,
identify performance bottlenecks, and analyze distributed transactions across
your Rails services.

## Production Configuration

Production deployments require additional configuration for optimal performance,
reliability, and resource utilization. This section covers production-specific
settings and best practices.

### Batch Span Processor (Recommended for Production)

The `BatchSpanProcessor` is recommended for production environments as it
reduces network overhead by batching span exports:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Configure batch span processor for production
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT')
      ),
      max_queue_size: 2048,        # Maximum spans in queue
      schedule_delay: 5000,        # Export every 5 seconds
      exporter_timeout: 30000,     # 30 second timeout
      max_export_batch_size: 512   # Export up to 512 spans at once
    )
  )

  c.use_all
end
```

**Benefits of BatchSpanProcessor:**

- Reduces network requests by up to 95%
- Lower CPU overhead compared to SimpleSpanProcessor
- Prevents network saturation during traffic spikes
- Configurable batching for optimal throughput

### Resource Attributes

Add rich context to all telemetry data with resource attributes:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Add resource attributes for production context
  c.resource = OpenTelemetry::SDK::Resources::Resource.create({
    'deployment.environment' => Rails.env,
    'service.namespace' => ENV.fetch('SERVICE_NAMESPACE', 'production'),
    'service.instance.id' => Socket.gethostname,
    'host.name' => Socket.gethostname,
    'host.type' => ENV.fetch('HOST_TYPE', 'container'),
    'cloud.provider' => ENV.fetch('CLOUD_PROVIDER', 'aws'),
    'cloud.region' => ENV.fetch('AWS_REGION', 'us-east-1'),
    'k8s.pod.name' => ENV['K8S_POD_NAME'],
    'k8s.namespace.name' => ENV['K8S_NAMESPACE']
  }.compact)

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT')
      )
    )
  )

  c.use_all
end
```

These attributes help you:

- Filter traces by environment, region, or instance
- Correlate issues with specific deployments
- Analyze performance across different infrastructure
- Debug production incidents faster

### Environment-Based Configuration

Use environment variables to manage configuration across deployments:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  # Service identification
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Resource attributes
  c.resource = OpenTelemetry::SDK::Resources::Resource.create({
    'deployment.environment' => Rails.env,
    'service.instance.id' => Socket.gethostname
  })

  # Span processor selection based on environment
  exporter = OpenTelemetry::Exporter::OTLP::Exporter.new(
    endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318'),
    compression: ENV.fetch('OTEL_EXPORTER_OTLP_COMPRESSION', 'gzip'),
    timeout: ENV.fetch('OTEL_EXPORTER_OTLP_TIMEOUT', '10').to_i
  )

  if Rails.env.production?
    # Use batch processor for production
    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
        exporter,
        max_queue_size: ENV.fetch('OTEL_BSP_MAX_QUEUE_SIZE', '2048').to_i,
        schedule_delay: ENV.fetch('OTEL_BSP_SCHEDULE_DELAY', '5000').to_i,
        max_export_batch_size: ENV.fetch('OTEL_BSP_MAX_EXPORT_BATCH_SIZE', '512').to_i
      )
    )
  else
    # Use simple processor for development (immediate export)
    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(exporter)
    )
  end

  c.use_all
end
```

### Production Environment Variables

Create a production environment configuration file:

```bash showLineNumbers title=".env.production"
# Service Configuration
OTEL_SERVICE_NAME=rails-app
APP_VERSION=2.1.3
SERVICE_NAMESPACE=production

# Scout Collector Endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4318
SCOUT_API_KEY=your-scout-api-key

# Batch Processor Settings
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Exporter Settings
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_EXPORTER_OTLP_TIMEOUT=30

# Infrastructure Context
CLOUD_PROVIDER=aws
AWS_REGION=us-east-1
HOST_TYPE=container
```

### Docker Production Configuration

For containerized Rails applications, configure OpenTelemetry in your Docker setup:

```dockerfile showLineNumbers title="Dockerfile"
FROM ruby:3.2-alpine

WORKDIR /app

# Install dependencies
COPY Gemfile Gemfile.lock ./
RUN bundle install --without development test

# Copy application code
COPY . .

# Set production environment
ENV RAILS_ENV=production
ENV OTEL_SERVICE_NAME=rails-app
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

# Precompile assets
RUN bundle exec rails assets:precompile

EXPOSE 3000

CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0"]
```

```yaml showLineNumbers title="docker-compose.yml"
version: '3.8'

services:
  rails-app:
    build: .
    environment:
      OTEL_SERVICE_NAME: rails-app
      APP_VERSION: ${APP_VERSION:-1.0.0}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4318
      DATABASE_URL: postgres://user:pass@postgres:5432/rails_production
    depends_on:
      - postgres
      - scout-collector
    ports:
      - "3000:3000"

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4318:4318"

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: password
```

## Metrics

In addition to traces, OpenTelemetry can collect metrics from your Rails
application to monitor resource utilization, request rates, error counts, and
custom business metrics.

### Automatic HTTP Metrics

The Rails instrumentation automatically collects HTTP-related metrics when you
configure the metrics exporter:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  # Configure trace export
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
      )
    )
  )

  # Enable all instrumentations including metrics
  c.use_all
end
```

**Automatic metrics include:**

- `http.server.duration` - HTTP request duration histogram
- `http.server.active_requests` - Currently active requests
- `http.server.request.size` - HTTP request body size
- `http.server.response.size` - HTTP response body size

### Custom Business Metrics

Create custom metrics to track business-specific events and KPIs:

```ruby showLineNumbers title="app/services/order_service.rb"
class OrderService
  def initialize
    @meter = OpenTelemetry.meter_provider.meter('order-service', '1.0.0')

    # Create custom metrics
    @orders_created = @meter.create_counter(
      'orders.created',
      unit: 'orders',
      description: 'Total number of orders created'
    )

    @order_value = @meter.create_histogram(
      'orders.value',
      unit: 'USD',
      description: 'Distribution of order values'
    )

    @active_orders = @meter.create_up_down_counter(
      'orders.active',
      unit: 'orders',
      description: 'Currently active orders'
    )
  end

  def create_order(params)
    order = Order.create!(params)

    # Increment orders created counter
    @orders_created.add(1, attributes: {
      'order.type' => order.order_type,
      'user.tier' => order.user.tier
    })

    # Record order value
    @order_value.record(order.total_amount, attributes: {
      'order.type' => order.order_type
    })

    # Increment active orders
    @active_orders.add(1)

    order
  rescue => e
    @orders_created.add(1, attributes: {
      'order.status' => 'failed',
      'error.type' => e.class.name
    })
    raise
  end
end
```

### Viewing Metrics in Scout Dashboard

After configuring metrics export, navigate to the Scout Dashboard to:

- View HTTP request rate and latency percentiles (p50, p95, p99)
- Monitor error rates and status code distributions
- Track custom business metrics in real-time
- Create alerts based on metric thresholds
- Build custom dashboards combining metrics and traces

## ActiveRecord Database Monitoring

OpenTelemetry automatically instruments ActiveRecord to provide comprehensive
database query monitoring and performance insights.

### Automatic Query Tracing

Once configured, all ActiveRecord queries are automatically traced with detailed
information:

```ruby
# This query is automatically instrumented
users = User.where(active: true).includes(:posts).limit(10)

# The trace will show:
# - SQL query statement
# - Database name and operation
# - Query duration
# - Connection pool metrics
```

### Configuring ActiveRecord Instrumentation

Fine-tune ActiveRecord instrumentation for security and performance:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  c.use_all({
    'OpenTelemetry::Instrumentation::ActiveRecord' => {
      enabled: true,
      # Obfuscate SQL parameter values for security
      enable_statement_obfuscation: true,
      # Limit SQL statement length in spans
      db_statement_limit: 2000,
      # Include SQL comments in traces
      enable_sql_obfuscation: false
    }
  })

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT')
      )
    )
  )
end
```

**ActiveRecord span attributes include:**

- `db.system` - Database type (postgresql, mysql, sqlite)
- `db.name` - Database name
- `db.statement` - SQL query
- `db.operation` - Operation type (SELECT, INSERT, UPDATE, DELETE)
- `db.sql.table` - Table name
- `db.connection.pool.name` - Connection pool identifier

### Detecting N+1 Queries

Use OpenTelemetry traces to identify and fix N+1 query problems:

```ruby
# Bad: N+1 query pattern (visible in traces as multiple DB spans)
posts = Post.limit(10)
posts.each do |post|
  puts post.author.name  # Triggers 10 additional queries
end

# Good: Optimized with eager loading (single query in trace)
posts = Post.includes(:author).limit(10)
posts.each do |post|
  puts post.author.name  # No additional queries
end
```

In Scout Dashboard, N+1 queries will appear as:

- Multiple identical database spans within a single request trace
- High span count for simple operations
- Repeated query patterns with different parameters

### Custom Database Spans

Add custom instrumentation for complex database operations:

```ruby showLineNumbers title="app/services/report_generator.rb"
class ReportGenerator
  def initialize
    @tracer = OpenTelemetry.tracer_provider.tracer('report-generator', '1.0.0')
  end

  def generate_monthly_report(month)
    @tracer.in_span('generate_monthly_report',
                    attributes: { 'report.month' => month },
                    kind: :internal) do |span|

      @tracer.in_span('aggregate_sales_data') do
        sales_data = aggregate_sales(month)
        span.add_event('Sales data aggregated', attributes: {
          'sales.total' => sales_data.sum,
          'sales.count' => sales_data.count
        })
      end

      @tracer.in_span('generate_charts') do
        charts = generate_charts(month)
        span.add_event('Charts generated', attributes: {
          'charts.count' => charts.length
        })
      end

      span.set_status(OpenTelemetry::Trace::Status.ok)
      span.add_attributes({ 'report.generated_at' => Time.current.iso8601 })
    end
  end
end
```

## Custom Manual Instrumentation

While automatic instrumentation covers most Rails components, you can add
custom instrumentation for business logic, external API calls, or
performance-critical code paths.

### Creating Custom Spans for Business Logic

Instrument important business operations in controllers and services:

```ruby showLineNumbers title="app/controllers/orders_controller.rb"
class OrdersController < ApplicationController
  before_action :set_tracer

  def create
    @tracer.in_span('create_order',
                    attributes: {
                      'user.id' => current_user.id,
                      'order.items_count' => params[:items].length
                    },
                    kind: :server) do |span|

      span.add_event('Validating order data')

      @order = Order.new(order_params)

      if @order.save
        span.add_event('Order saved successfully', attributes: {
          'order.id' => @order.id,
          'order.total' => @order.total_amount
        })

        @tracer.in_span('process_payment') do |payment_span|
          payment_result = PaymentService.charge(current_user, @order.total_amount)
          payment_span.add_attributes({
            'payment.provider' => payment_result.provider,
            'payment.status' => payment_result.status
          })
        end

        @tracer.in_span('send_confirmation_email') do
          OrderMailer.confirmation(@order).deliver_later
        end

        span.set_status(OpenTelemetry::Trace::Status.ok)
        render json: @order, status: :created
      else
        span.add_event('Order validation failed', attributes: {
          'validation.errors' => @order.errors.full_messages
        })
        span.set_status(
          OpenTelemetry::Trace::Status.error("Validation failed: #{@order.errors.full_messages.join(', ')}")
        )
        render json: @order.errors, status: :unprocessable_entity
      end
    end
  end

  private

  def set_tracer
    @tracer = OpenTelemetry.tracer_provider.tracer('orders-controller', '1.0.0')
  end

  def order_params
    params.require(:order).permit(:items, :shipping_address, :payment_method)
  end
end
```

### Adding Attributes to Current Spans

Enrich existing spans with additional context:

```ruby showLineNumbers title="app/controllers/application_controller.rb"
class ApplicationController < ActionController::Base
  before_action :add_user_context_to_trace

  private

  def add_user_context_to_trace
    return unless current_user

    # Get the current span
    current_span = OpenTelemetry::Trace.current_span

    # Add user context attributes
    current_span.add_attributes({
      'user.id' => current_user.id,
      'user.email' => current_user.email,
      'user.tier' => current_user.subscription_tier,
      'user.authenticated' => true
    })
  end
end
```

### Exception Handling and Error Tracking

Capture exceptions in custom spans:

```ruby showLineNumbers title="app/services/external_api_client.rb"
class ExternalApiClient
  def initialize
    @tracer = OpenTelemetry.tracer_provider.tracer('external-api-client', '1.0.0')
  end

  def fetch_data(endpoint)
    @tracer.in_span('external_api_call',
                    attributes: {
                      'http.url' => endpoint,
                      'http.method' => 'GET'
                    },
                    kind: :client) do |span|

      begin
        response = HTTP.get(endpoint)

        span.add_attributes({
          'http.status_code' => response.code,
          'http.response_size' => response.body.length
        })

        if response.code == 200
          span.set_status(OpenTelemetry::Trace::Status.ok)
          JSON.parse(response.body)
        else
          span.set_status(
            OpenTelemetry::Trace::Status.error("HTTP #{response.code}")
          )
          raise "API request failed with status #{response.code}"
        end

      rescue => e
        span.record_exception(e)
        span.set_status(
          OpenTelemetry::Trace::Status.error("Exception: #{e.message}")
        )
        raise
      end
    end
  end
end
```

### Using Semantic Conventions

Follow OpenTelemetry semantic conventions for consistent attribute naming:

```ruby showLineNumbers
# HTTP semantic conventions
span.add_attributes({
  'http.method' => 'POST',
  'http.url' => 'https://api.example.com/users',
  'http.status_code' => 201,
  'http.request.header.content_type' => 'application/json'
})

# Database semantic conventions
span.add_attributes({
  'db.system' => 'postgresql',
  'db.name' => 'production',
  'db.statement' => 'SELECT * FROM users WHERE active = true',
  'db.operation' => 'SELECT'
})

# Messaging semantic conventions
span.add_attributes({
  'messaging.system' => 'sidekiq',
  'messaging.destination' => 'orders_queue',
  'messaging.operation' => 'process'
})
```

## Running Your Instrumented Application

### Development Mode

For local development, use console output to verify instrumentation:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app-dev'

  if Rails.env.development?
    # Use console exporter for debugging
    require 'opentelemetry/exporter/otlp'

    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(
        OpenTelemetry::SDK::Trace::Export::ConsoleSpanExporter.new
      )
    )
  end

  c.use_all
end
```

Start your Rails server:

```bash
bundle exec rails server
```

You'll see span output in the console for each request:

``` ruby
#<struct OpenTelemetry::SDK::Trace::SpanData
  name="GET /users",
  kind=:server,
  status=#<OpenTelemetry::Trace::Status:0x00007f8b1c0a3e80 @code=1, @description="">,
  attributes={"http.method"=>"GET", "http.target"=>"/users", "http.status_code"=>200}>
```

### Production Mode

For production deployments, ensure the Scout Collector endpoint is properly configured:

```bash
# Set environment variables
export OTEL_SERVICE_NAME=rails-app-production
export APP_VERSION=2.1.0
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4318
export SCOUT_API_KEY=your-scout-api-key
export RAILS_ENV=production

# Start Rails server
bundle exec puma -C config/puma.rb
```

### Docker Deployment

Run your instrumented Rails application in Docker:

```bash
# Build the image
docker build -t rails-app:latest .

# Run with Scout Collector
docker run -d \
  --name rails-app \
  -e OTEL_SERVICE_NAME=rails-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318 \
  -e DATABASE_URL=postgres://user:pass@db:5432/production \
  -p 3000:3000 \
  rails-app:latest
```

Or use Docker Compose (see [Production Configuration](#production-configuration)
section for complete example).

## Troubleshooting

### Verifying OpenTelemetry Installation

Test your OpenTelemetry configuration in the Rails console:

```ruby
# Start Rails console
bundle exec rails console

# Create a test span
tracer = OpenTelemetry.tracer_provider.tracer('test')

tracer.in_span('test_span') do |span|
  span.add_attributes({'test' => 'value'})
  puts "OpenTelemetry is working!"
  puts "Tracer provider: #{OpenTelemetry.tracer_provider.class}"
  puts "Active span: #{span.name}"
end

# Check instrumented libraries
OpenTelemetry.instrumentation_registry.each do |instrumentation|
  puts "#{instrumentation.name}: #{instrumentation.installed? ? 'INSTALLED' : 'NOT INSTALLED'}"
end
```

Expected output:

``` ruby
OpenTelemetry is working!
Tracer provider: OpenTelemetry::SDK::Trace::TracerProvider
Active span: test_span
OpenTelemetry::Instrumentation::ActionPack: INSTALLED
OpenTelemetry::Instrumentation::ActiveRecord: INSTALLED
OpenTelemetry::Instrumentation::Rails: INSTALLED
```

### Health Check Endpoint

Create a health check endpoint to verify telemetry export:

```ruby showLineNumbers title="config/routes.rb"
Rails.application.routes.draw do
  get '/health', to: 'health#check'
  get '/health/telemetry', to: 'health#telemetry'
end
```

```ruby showLineNumbers title="app/controllers/health_controller.rb"
class HealthController < ApplicationController
  def check
    render json: {
      status: 'ok',
      timestamp: Time.current,
      environment: Rails.env
    }
  end

  def telemetry
    tracer = OpenTelemetry.tracer_provider.tracer('health_check')

    tracer.in_span('telemetry_health_check') do |span|
      span.add_attributes({
        'service.name' => ENV.fetch('OTEL_SERVICE_NAME', 'rails-app'),
        'service.version' => ENV.fetch('APP_VERSION', '1.0.0'),
        'rails.environment' => Rails.env,
        'ruby.version' => RUBY_VERSION
      })

      render json: {
        status: 'ok',
        telemetry: {
          tracer_provider: OpenTelemetry.tracer_provider.class.name,
          instrumented_gems: instrumented_gems_list
        }
      }
    end
  end

  private

  def instrumented_gems_list
    OpenTelemetry.instrumentation_registry.map do |i|
      { name: i.name, installed: i.installed? }
    end
  end
end
```

Test the endpoint:

```bash
curl http://localhost:3000/health/telemetry
```

### Debug Mode

Enable debug logging to troubleshoot instrumentation issues:

```bash
export OTEL_LOG_LEVEL=debug
bundle exec rails server
```

Or configure in the initializer:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'

# Enable debug logging
OpenTelemetry.logger.level = Logger::DEBUG if Rails.env.development?

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'
  c.use_all
end
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash
   curl -v http://scout-collector:4318/v1/traces
   ```

2. Check environment variables:

   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_SERVICE_NAME
   ```

3. Enable debug logging and check for export errors

4. Verify network connectivity between Rails app and Scout Collector

#### Issue: Missing database query spans

**Solutions:**

1. Ensure `opentelemetry-instrumentation-active_record` is installed
2. Verify ActiveRecord instrumentation is enabled:

   ```ruby
   OpenTelemetry.instrumentation_registry.lookup('OpenTelemetry::Instrumentation::ActiveRecord').installed?
   ```

3. Check that `c.use_all` or specific ActiveRecord instrumentation is configured

#### Issue: High memory usage

**Solutions:**

1. Use `BatchSpanProcessor` instead of `SimpleSpanProcessor`
2. Reduce `max_queue_size` in BatchSpanProcessor configuration
3. Limit span attribute sizes with `db_statement_limit`

#### Issue: Performance degradation

**Solutions:**

1. Use `enable_statement_obfuscation` to reduce attribute processing
2. Skip health check endpoints with `untraced_endpoints`
3. Verify BatchSpanProcessor is configured (not SimpleSpanProcessor)

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```ruby
# Bad - exposes sensitive data
span.add_attributes({
  'user.password' => user.password,              # Never include passwords!
  'credit_card.number' => params[:cc_number],    # Never include payment data!
  'user.ssn' => user.social_security_number      # Never include PII!
})

# Good - uses safe identifiers
span.add_attributes({
  'user.id' => user.id,
  'user.role' => user.role,
  'payment.provider' => 'stripe',
  'payment.status' => 'completed'
})
```

### Sanitizing SQL Statements

Enable SQL obfuscation to remove sensitive parameter values:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  c.use_all({
    'OpenTelemetry::Instrumentation::ActiveRecord' => {
      enabled: true,
      # Obfuscate SQL parameters
      enable_statement_obfuscation: true,
      # Limit SQL statement length
      db_statement_limit: 2000
    }
  })
end
```

Before obfuscation:

```sql
SELECT * FROM users WHERE email = 'user@example.com' AND password = 'secret123'
```

After obfuscation:

```sql
SELECT * FROM users WHERE email = ? AND password = ?
```

### Filtering Sensitive HTTP Headers

Avoid capturing sensitive HTTP headers:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app'

  c.use_all({
    'OpenTelemetry::Instrumentation::Rack' => {
      enabled: true,
      # Don't capture these headers
      untraced_endpoints: ['/health', '/metrics'],
      # Additional security configuration
      allowed_request_headers: ['content-type', 'accept'],
      allowed_response_headers: ['content-type']
    }
  })
end
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard
- Configure SQL obfuscation for all database queries
- Audit span attributes regularly for sensitive data leaks

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead to Rails applications:

- **Average latency increase**: 1-3ms per request
- **CPU overhead**: Less than 2% in production with BatchSpanProcessor
- **Memory overhead**: ~50-100MB depending on queue size and traffic

**Impact varies based on:**

- Number of enabled instrumentations
- Span processor type (Batch vs Simple)
- Application request volume
- Complexity of database queries

### Optimization Best Practices

#### 1. Use BatchSpanProcessor in Production

```ruby
# Good - batches exports, low overhead
c.add_span_processor(
  OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(exporter)
)

# Bad - exports every span immediately, high overhead
c.add_span_processor(
  OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(exporter)
)
```

#### 2. Skip Non-Critical Endpoints

```ruby
c.use_all({
  'OpenTelemetry::Instrumentation::Rack' => {
    untraced_endpoints: ['/health', '/metrics', '/favicon.ico']
  }
})
```

#### 3. Conditional Span Recording

```ruby
span = OpenTelemetry::Trace.current_span

# Only add expensive attributes if span is being recorded
if span.recording?
  span.add_attributes(expensive_computation())
end
```

#### 4. Limit Attribute Sizes

```ruby
c.use_all({
  'OpenTelemetry::Instrumentation::ActiveRecord' => {
    db_statement_limit: 2000  # Truncate long SQL statements
  }
})
```

## Frequently Asked Questions

### Does OpenTelemetry impact Rails performance?

OpenTelemetry adds approximately 1-3ms of latency per request in typical Rails
applications. With proper configuration (BatchSpanProcessor), the performance
impact is minimal and acceptable for most production workloads.

### Which Rails versions are supported?

OpenTelemetry supports Rails 6.0+ with Ruby 3.0+. Rails 7.0+ with Ruby 3.1+ is
recommended for optimal compatibility and performance. See the
[Prerequisites](#prerequisites) section for detailed version compatibility.

### Can I use OpenTelemetry with Sidekiq or other background job processors?

Yes! The `opentelemetry-instrumentation-all` gem includes automatic instrumentation
for Sidekiq, DelayedJob, and Resque. Background jobs are traced automatically,
and you can see the complete trace from HTTP request through asynchronous job
processing in Scout Dashboard.

### Is OpenTelemetry compatible with Rack middleware?

Yes, OpenTelemetry instruments at the Rack level, making it compatible with all
Rack-based frameworks and middleware. Custom Rack middleware will appear in
traces automatically.

### Can I use OpenTelemetry alongside other APM tools?

Yes, OpenTelemetry can run alongside tools like New Relic or DataDog during
migration periods. However, running multiple APM agents simultaneously will
multiply the performance overhead, so plan your migration carefully.

### How do I handle multi-tenant Rails applications?

Add tenant context to spans using attributes:

```ruby
current_span.add_attributes({
  'tenant.id' => current_tenant.id,
  'tenant.name' => current_tenant.name
})
```

Then filter traces by tenant in Scout Dashboard.

### What's the difference between traces and metrics?

**Traces** show the complete request flow through your application with timing
details for each operation. Use traces to debug slow requests and understand
distributed transactions.

**Metrics** provide aggregated statistics over time (request rate, error rate,
latency percentiles). Use metrics for monitoring overall application health
and setting alerts.

### How do I monitor N+1 database queries?

OpenTelemetry traces automatically expose N+1 queries as multiple database
spans within a single request trace. In Scout Dashboard, look for repeated
query patterns or high span counts for simple operations.

### Can I customize which gems are instrumented?

Yes! Use selective instrumentation instead of `c.use_all`:

```ruby
c.use 'OpenTelemetry::Instrumentation::Rails'
c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
c.use 'OpenTelemetry::Instrumentation::Redis'
```

Or disable specific instrumentations:

```ruby
c.use_all({
  'OpenTelemetry::Instrumentation::MongoDB' => { enabled: false }
})
```

## What's Next?

Now that your Rails application is instrumented with OpenTelemetry, explore
these resources to maximize your observability:

### Advanced Topics

- **[Custom Ruby Instrumentation](../custom-instrumentation/ruby.md)** - Deep dive
  into manual tracing, custom spans, and advanced instrumentation patterns
- **[PostgreSQL Monitoring Best Practices](../../component/postgres.md)** - Optimize
  database observability with connection pooling metrics and query performance analysis
- **[Redis Instrumentation](../../component/redis.md)** - Monitor caching
  performance and identify slow Redis operations

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  intelligent alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** - Build
  custom dashboards combining traces, metrics, and business KPIs

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** - Set
  up Scout Collector for local development and testing

## Complete Example

Here's a complete working example of a Rails 7 application with OpenTelemetry instrumentation:

### Gemfile

```ruby title="Gemfile"
source 'https://rubygems.org'

ruby '3.2.0'

gem 'rails', '~> 7.1.0'
gem 'pg', '~> 1.5'
gem 'puma', '~> 6.0'

# OpenTelemetry gems
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'

group :development, :test do
  gem 'debug'
  gem 'rspec-rails'
end
```

### OpenTelemetry Initializer

```ruby title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  # Service identification
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Resource attributes
  c.resource = OpenTelemetry::SDK::Resources::Resource.create({
    'deployment.environment' => Rails.env,
    'service.instance.id' => Socket.gethostname
  })

  # Configure exporter
  exporter = OpenTelemetry::Exporter::OTLP::Exporter.new(
    endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
  )

  # Use batch processor for production, simple for development
  if Rails.env.production?
    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(exporter)
    )
  else
    c.add_span_processor(
      OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(exporter)
    )
  end

  # Enable all instrumentations
  c.use_all
end

# Create global tracer
TRACER = OpenTelemetry.tracer_provider.tracer('rails-app', '1.0.0')
```

### Instrumented Controller

```ruby title="app/controllers/api/v1/orders_controller.rb"
module Api
  module V1
    class OrdersController < ApplicationController
      before_action :set_tracer

      def create
        @tracer.in_span('create_order') do |span|
          span.add_attributes({
            'user.id' => current_user.id,
            'order.items_count' => order_params[:items].length
          })

          @order = Order.create!(order_params)

          span.add_event('Order created', attributes: {
            'order.id' => @order.id,
            'order.total' => @order.total_amount
          })

          render json: @order, status: :created
        end
      rescue => e
        OpenTelemetry::Trace.current_span.record_exception(e)
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def set_tracer
        @tracer = OpenTelemetry.tracer_provider.tracer('api', '1.0.0')
      end

      def order_params
        params.require(:order).permit(:items, :total_amount)
      end
    end
  end
end
```

### Environment Variables

```bash title=".env.production"
OTEL_SERVICE_NAME=rails-app-production
APP_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
RAILS_ENV=production
DATABASE_URL=postgres://user:pass@db:5432/production
```

This complete example is available in our [GitHub examples repository](https://github.com/base14/opentelemetry-examples/tree/main/rails).

## References

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Custom Ruby Instrumentation](../custom-instrumentation/ruby.md) - Manual
  instrumentation for advanced use cases
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
