---
title:
  Ruby on Rails (Legacy) OpenTelemetry Instrumentation - Complete APM Setup
  Guide | base14 Scout
sidebar_label: Ruby on Rails (Legacy)
sidebar_position: 20
description:
  Legacy Rails OpenTelemetry instrumentation for Ruby 3.0 / Rails 6.1 and Ruby
  2.7 / Rails 5.x with pinned SDK versions and upgrade recommendations using
  base14 Scout.
keywords:
  [
    rails 6.1 opentelemetry,
    ruby 3.0 opentelemetry,
    rails 5 opentelemetry,
    ruby 2.7 opentelemetry,
    legacy rails monitoring,
    rails 5.2 instrumentation,
    ruby 2.7 apm,
    ruby 3.0 apm,
    old rails observability,
    rails 6.1 instrumentation,
    pinned otel gems ruby,
  ]
---

# Ruby on Rails (Legacy)

> This guide covers Ruby 3.0 (EOL: March 2024), Ruby 2.7 (EOL: March 2023),
> Rails 6.1 (EOL: April 2024), and Rails 5.2 (EOL: June 2022)

This guide covers OpenTelemetry instrumentation for legacy Rails applications
running on end-of-life Ruby or Rails versions. The latest OTel Ruby gems now
require Ruby >= 3.1, so users on older versions need pinned gem versions. While
instrumentation works, these versions are no longer officially maintained or
tested.

> ⚠️ **Production Warning**: Legacy versions have known limitations, security
> vulnerabilities, and reduced performance. We strongly recommend upgrading to
> supported versions. See [Migration Path](#migration-path) below.

## Supported Legacy Versions

This guide covers:

- **Ruby 3.0** (EOL: March 2024) with **Rails 6.1** (EOL: April 2024)
- **Ruby 2.7** (EOL: March 2023)
- **Rails 5.2** (Maintenance ended: June 2022)
- **Rails 6.0** with Ruby 2.7

**Not covered**: Ruby 2.6 or earlier, Rails 5.1 or earlier (no OpenTelemetry
support)

## Ruby 3.0 / Rails 6.1

Ruby 3.0 reached EOL in March 2024 and Rails 6.1 in April 2024. Many production
apps still run this combination. The latest OTel Ruby gems require Ruby >= 3.1,
so you must pin gem versions to the last compatible releases.

### Why Pinned Versions?

Starting in late 2024, the `opentelemetry-sdk` gem and its dependencies began
requiring Ruby >= 3.1. Running `bundle update` on a Ruby 3.0 app will pull
incompatible versions and fail. The configuration below pins every OTel gem to
its last Ruby 3.0–compatible release.

### Known Limitations

- **Gem version ceiling**: OTel gems are pinned — no new features or bug fixes
  from upstream
- **Logger 1.4.3 pin**: newer `logger` versions break
  `ActiveSupport::LoggerThreadSafeLevel` in Rails 6.1
- **Bundler 2.3.27**: required in Docker to handle default gem replacement
  correctly
- **Bootsnap incompatible**: latest bootsnap (1.23.0+) does not support Ruby 3.0

### Working Configuration

#### Gemfile

Pin OTel gems to the last Ruby 3.0–compatible versions:

```ruby showLineNumbers title="Gemfile"
source "https://rubygems.org"

ruby "~> 3.0.0"

gem "rails", "~> 6.1.0"
gem "mysql2", "~> 0.5"
gem "puma", "~> 5.0"
gem "logger", "1.4.3"

# OpenTelemetry — pinned to last Ruby 3.0 compatible versions
gem "opentelemetry-api", "1.4.0"
gem "opentelemetry-sdk", "1.7.0"
gem "opentelemetry-exporter-otlp", "0.29.1"
gem "opentelemetry-instrumentation-rails", "0.34.1"
gem "opentelemetry-instrumentation-mysql2", "0.28.0"
```

> Swap `mysql2` for `pg` or `sqlite3` as needed. The OTel core gem versions stay
> the same.

#### Initializer

`use_all()` auto-instruments Rack, ActionPack, ActiveRecord, ActiveSupport, and
your database adapter. The OTLP exporter reads its endpoint from environment
variables, so no hardcoded URLs are needed:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"

OpenTelemetry::SDK.configure do |c|
  c.use_all()
end
```

Unlike Ruby 2.7, Ruby 3.0 works fine with `BatchSpanProcessor` (the SDK
default), so there is no need to switch to `SimpleSpanProcessor`.

#### Custom Spans

Wrap business logic in custom spans for richer traces:

```ruby showLineNumbers title="app/controllers/items_controller.rb"
class ItemsController < ApplicationController
  def create
    permitted = item_params
    tracer = OpenTelemetry.tracer_provider.tracer("items-controller")
    item = nil

    tracer.in_span("item.create",
                   attributes: { "item.title" => permitted[:title] }) do |span|
      item = Item.create!(permitted)
      span.set_attribute("item.id", item.id)
    end

    render json: item, status: :created
  end

  private

  def item_params
    params.require(:item).permit(:title, :description)
  end
end
```

Auto-instrumented DB calls nest under the custom span automatically:

```text
HTTP POST /api/items
  └── item.create        (custom span)
      ├── Item query      (ActiveRecord auto)
      ├── select          (MySQL2 auto)
      ├── begin           (MySQL2 auto)
      ├── insert          (MySQL2 auto)
      └── commit          (MySQL2 auto)
```

#### Error Handling and Log Correlation

Record exceptions on the current span and inject trace context into logs so you
can jump from a log line straight to the trace:

```ruby showLineNumbers title="app/controllers/application_controller.rb"
class ApplicationController < ActionController::API
  rescue_from ActiveRecord::RecordNotFound, with: :handle_not_found

  private

  def handle_not_found(exception)
    span = OpenTelemetry::Trace.current_span
    span.record_exception(exception)
    span.status = OpenTelemetry::Trace::Status.error(exception.message)

    trace_id = span.context.hex_trace_id
    span_id = span.context.hex_span_id
    Rails.logger.error(
      "[trace_id=#{trace_id} span_id=#{span_id}] " \
      "#{exception.class}: #{exception.message}"
    )

    render json: { error: "Not found", trace_id: trace_id },
           status: :not_found
  end
end
```

### Docker Setup

#### Dockerfile

Pin bundler to 2.3.27 and skip bootsnap:

```docker showLineNumbers title="Dockerfile"
ARG RUBY_VERSION=3.0
FROM docker.io/library/ruby:$RUBY_VERSION-slim

WORKDIR /rails

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
      build-essential default-libmysqlclient-dev \
      curl git libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

ENV RAILS_ENV="development" \
    BUNDLE_PATH="/usr/local/bundle"

RUN gem update --system 3.3.27 && gem install bundler -v 2.3.27

COPY Gemfile ./
RUN bundle install

COPY . .
EXPOSE 3000
CMD ["bin/rails", "server", "-b", "0.0.0.0"]
```

#### Docker Compose

The app, database, and OTel Collector run together. The key environment
variables for telemetry are `OTEL_SERVICE_NAME` and
`OTEL_EXPORTER_OTLP_ENDPOINT`:

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build: .
    environment:
      OTEL_SERVICE_NAME: ruby30-rails61-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      DATABASE_HOST: mysql
    depends_on:
      mysql:
        condition: service_healthy
      otel-collector:
        condition: service_started
    ports:
      - "3000:3000"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    ports:
      - "4317:4317"
      - "4318:4318"

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: rails_otel_dev
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-prootpassword"]
      interval: 5s
      timeout: 5s
      retries: 10
```

A complete working example is available at
[ruby30-rails61-mysql](https://github.com/base-14/examples/tree/main/ruby/ruby30-rails61-mysql).

### Ruby 3.0 Troubleshooting

#### Issue: `logger` gem conflicts on Rails 6.1

**Cause**: Newer `logger` versions remove methods that Rails 6.1's
`ActiveSupport::LoggerThreadSafeLevel` depends on.

**Solution**: Pin `logger` to `1.4.3` in your Gemfile (shown in the
configuration above).

#### Issue: Bundler fails to replace default gems

**Cause**: The system bundler in the Ruby 3.0 Docker image doesn't handle
default gem replacement correctly.

**Solution**: Upgrade bundler to 2.3.27 before `bundle install`:

```bash
gem update --system 3.3.27 && gem install bundler -v 2.3.27
```

#### Issue: Bootsnap crashes on startup

**Cause**: Bootsnap 1.23.0+ requires Ruby 3.1.

**Solution**: Remove bootsnap from your Gemfile. Rails 6.1 runs fine without it
— cold boot adds roughly 1–2 seconds.

#### Issue: No traces appearing

**Cause**: OTel gems may have been updated past the Ruby 3.0 ceiling.

**Solution**: Verify pinned versions match the table in
[Compatibility Matrix](#compatibility-matrix) and run:

```bash
bundle exec ruby -e "require 'opentelemetry/sdk'; puts OpenTelemetry::SDK::VERSION"
# Expected: 1.7.0
```

## Ruby 2.7 Support

### Known Limitations

- **Performance overhead**: 5-10ms per request (vs 1-3ms on Ruby 3.x)
- **Threading issues**: BatchSpanProcessor may cause thread leaks
- **Instrumentation gaps**: Some newer gems don't support Ruby 2.7
- **Security**: No security patches since March 2023

### Working Configuration

#### Gemfile

Lock to compatible OpenTelemetry versions:

```ruby showLineNumbers title="Gemfile"
source 'https://rubygems.org'

gem 'rails', '~> 6.1.0'  # or your Rails version

# OpenTelemetry - use older versions compatible with Ruby 2.7
gem 'opentelemetry-sdk', '~> 1.1.0'
gem 'opentelemetry-exporter-otlp', '~> 0.21.0'

# Use specific instrumentation gems instead of -all
gem 'opentelemetry-instrumentation-rails', '~> 0.28.0'
gem 'opentelemetry-instrumentation-action_pack', '~> 0.9.0'
gem 'opentelemetry-instrumentation-active_record', '~> 0.6.0'
gem 'opentelemetry-instrumentation-rack', '~> 0.23.0'

# Optional: background jobs
gem 'opentelemetry-instrumentation-sidekiq', '~> 0.25.0'

# Optional: HTTP clients
gem 'opentelemetry-instrumentation-net_http', '~> 0.22.0'
```

#### Configuration

Use SimpleSpanProcessor to avoid thread issues:

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails-app-ruby27')
  c.service_version = ENV.fetch('APP_VERSION', '1.0.0')

  # Use SimpleSpanProcessor to avoid Ruby 2.7 threading issues
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
      )
    )
  )

  # Enable only core instrumentations
  c.use 'OpenTelemetry::Instrumentation::Rails'
  c.use 'OpenTelemetry::Instrumentation::ActionPack'
  c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
  c.use 'OpenTelemetry::Instrumentation::Rack'

  # Optional: enable if you use Sidekiq
  # c.use 'OpenTelemetry::Instrumentation::Sidekiq'
end

TRACER = OpenTelemetry.tracer_provider.tracer('rails-app', '1.0.0')
```

### Ruby 2.7 Troubleshooting

#### Issue: Thread deadlocks or memory leaks

**Cause**: BatchSpanProcessor has known issues with Ruby 2.7's GVL

**Solution**: Use SimpleSpanProcessor (shown in config above)

**Trade-off**: Higher network overhead, but stable

#### Issue: Missing instrumentation for newer gems

**Cause**: Newer instrumentation gems require Ruby 3.0+

**Solution**: Manually instrument using custom spans:

```ruby showLineNumbers title="app/controllers/application_controller.rb"
class ApplicationController < ActionController::Base
  around_action :trace_request

  private

  def trace_request
    tracer = OpenTelemetry.tracer_provider.tracer('rails-app')

    tracer.in_span("#{controller_name}##{action_name}", kind: :server) do |span|
      span.set_attribute('http.method', request.method)
      span.set_attribute('http.route', "#{controller_name}##{action_name}")

      yield

      span.set_attribute('http.status_code', response.status)
    end
  end
end
```

## Rails 5.2 Support

### Known Limitations

- **ActiveRecord**: May miss queries in some edge cases
- **ActionCable**: Not instrumented
- **ActiveJob**: Unreliable instrumentation
- **Minitest**: No test instrumentation
- **Compatibility**: Requires specific gem versions

### Working Configuration

#### Gemfile

```ruby showLineNumbers title="Gemfile"
source 'https://rubygems.org'

gem 'rails', '~> 5.2.8'

# OpenTelemetry - lock to Rails 5.2 compatible versions
gem 'opentelemetry-sdk', '~> 1.2.0'
gem 'opentelemetry-exporter-otlp', '~> 0.25.0'

# Rails 5.2 requires manual instrumentation selection
gem 'opentelemetry-instrumentation-rack', '~> 0.23.0'
gem 'opentelemetry-instrumentation-active_record', '~> 0.5.0'

# Note: opentelemetry-instrumentation-rails doesn't fully support Rails 5.2
# Use Rack instrumentation instead
```

#### Configuration

Initialize before Rails application boots:

```ruby showLineNumbers title="config/application.rb"
require_relative 'boot'

require 'rails/all'

# Initialize OpenTelemetry before Rails boots
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = ENV.fetch('OTEL_SERVICE_NAME', 'rails52-app')

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318')
      )
    )
  )

  # Only enable instrumentations that work with Rails 5.2
  c.use 'OpenTelemetry::Instrumentation::Rack'
  c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
end

Bundler.require(*Rails.groups)

module YourApp
  class Application < Rails::Application
    config.load_defaults 5.2
    # ...
  end
end
```

### Rails 5.2 Troubleshooting

#### Issue: Missing request traces

**Cause**: Rails 5.2 doesn't have full Rails instrumentation support

**Solution**: Use Rack instrumentation + manual controller tracing:

```ruby showLineNumbers title="app/controllers/application_controller.rb"
class ApplicationController < ActionController::Base
  before_action :start_trace
  after_action :end_trace

  private

  def start_trace
    @tracer = OpenTelemetry.tracer_provider.tracer('rails-app')
    @current_span = @tracer.start_span(
      "#{controller_name}##{action_name}",
      kind: :server,
      attributes: {
        'http.method' => request.method,
        'http.url' => request.original_url,
        'http.route' => "#{controller_name}##{action_name}"
      }
    )
    OpenTelemetry::Trace.current_span = @current_span
  end

  def end_trace
    if @current_span
      @current_span.set_attribute('http.status_code', response.status)
      @current_span.finish
    end
  end
end
```

#### Issue: ActiveRecord queries not appearing

**Cause**: ActiveRecord instrumentation version mismatch

**Solution**: Verify gem version and test:

```bash showLineNumbers
bundle exec rails console

# Test ActiveRecord instrumentation
require 'opentelemetry/sdk'
tracer = OpenTelemetry.tracer_provider.tracer('test')

tracer.in_span('test_query') do
  User.first
end
```

If queries still missing, use manual instrumentation:

```ruby showLineNumbers title="app/models/concerns/traced_queries.rb"
module TracedQueries
  extend ActiveSupport::Concern

  included do
    around_save :trace_save
    around_destroy :trace_destroy
  end

  private

  def trace_save
    tracer = OpenTelemetry.tracer_provider.tracer('active_record')
    tracer.in_span("#{self.class.name}.save", kind: :client) do |span|
      span.set_attribute('db.operation', 'save')
      span.set_attribute('db.table', self.class.table_name)
      yield
    end
  end

  def trace_destroy
    tracer = OpenTelemetry.tracer_provider.tracer('active_record')
    tracer.in_span("#{self.class.name}.destroy", kind: :client) do |span|
      span.set_attribute('db.operation', 'destroy')
      span.set_attribute('db.table', self.class.table_name)
      yield
    end
  end
end

# Include in your models
class User < ApplicationRecord
  include TracedQueries
end
```

## Compatibility Matrix

| Ruby Version | Rails Version | OpenTelemetry SDK | Status     | Notes                                      |
| ------------ | ------------- | ----------------- | ---------- | ------------------------------------------ |
| 3.0          | 6.1           | 1.7.0 (pinned)    | ⚠️ Works   | [Pinned gems required](#ruby-30--rails-61) |
| 2.7          | 6.1           | 1.3.x             | ⚠️ Works   | Use SimpleSpanProcessor                    |
| 2.7          | 6.0           | 1.3.x             | ⚠️ Works   | Use SimpleSpanProcessor                    |
| 2.7          | 5.2           | 1.2.x             | ⚠️ Limited | Manual instrumentation needed              |
| 3.0          | 5.2           | 1.2.x             | ⚠️ Limited | Manual instrumentation needed              |

## Feature Support Comparison

| Feature              | Ruby 3.1+      | Ruby 3.0 (pinned) | Ruby 2.7           | Rails 5.2          |
| -------------------- | -------------- | ----------------- | ------------------ | ------------------ |
| HTTP request tracing | ✅ Automatic   | ✅ Automatic      | ✅ Automatic       | ⚠️ Manual          |
| ActiveRecord queries | ✅ Full        | ✅ Full           | ✅ Full            | ⚠️ Partial         |
| `use_all()`          | ✅ Latest gems | ✅ Pinned gems    | ❌ Individual gems | ❌ Individual gems |
| Background jobs      | ✅ Sidekiq, DJ | ✅ Sidekiq, DJ    | ✅ Sidekiq, DJ     | ❌ No support      |
| ActionCable          | ✅ Automatic   | ✅ Automatic      | ✅ Automatic       | ❌ No support      |
| Custom spans         | ✅ Full API    | ✅ Full API       | ✅ Full API        | ✅ Full API        |
| BatchSpanProcessor   | ✅ Recommended | ✅ Works          | ❌ Unstable        | ❌ Unstable        |
| Performance overhead | 1–3ms          | 1–3ms             | 5–10ms             | 3–8ms              |

## Migration Path

### Recommended Upgrade Order

**Priority 1: Ruby Upgrade** (Biggest impact)

```text
Ruby 2.7 → Ruby 3.0 → Ruby 3.1 → Ruby 3.2+
```

**Key milestone — Ruby 3.1**: This is where you can drop pinned OTel gem
versions and use the latest releases (including
`opentelemetry-instrumentation-all`).

**Benefits of upgrading past 3.0:**

- Latest OTel gems with new features and bug fixes
- Security patches
- Stable BatchSpanProcessor (already works on 3.0)
- All instrumentation gems supported without version pins

**Rails compatibility:**

- Rails 6.1 supports Ruby 3.0+
- Rails 7.0 requires Ruby 2.7+, supports Ruby 3.x
- Rails 7.1 requires Ruby 3.0+

**Priority 2: Rails Upgrade** (After Ruby is upgraded)

```text
Rails 5.2 → Rails 6.1 (LTS) → Rails 7.1 (Current LTS)
```

**Benefits:**

- Better ActiveRecord instrumentation
- ActionCable support
- ActiveJob tracing
- Future-proof

### Incremental Migration Strategy

#### Step 1: Upgrade Ruby to 3.0 (if on 2.7)

```bash
rbenv install 3.0.7
rbenv local 3.0.7
bundle install
bundle exec rspec
```

At this point you can switch from `SimpleSpanProcessor` to `BatchSpanProcessor`
and use `use_all()` with pinned gems (see
[Ruby 3.0 / Rails 6.1](#ruby-30--rails-61) above).

#### Step 2: Upgrade Ruby to 3.1+ (1–2 weeks)

```bash
rbenv install 3.1.4
rbenv local 3.1.4
bundle install
bundle exec rspec
# Deploy to staging, monitor for 1 week
```

#### Step 3: Update OpenTelemetry

```ruby
# After Ruby 3.1 upgrade, remove version pins and use latest
gem 'opentelemetry-sdk'
gem 'opentelemetry-exporter-otlp'
gem 'opentelemetry-instrumentation-all'
```

#### Step 4: Switch to BatchSpanProcessor

If you were on Ruby 2.7 with `SimpleSpanProcessor`, you can now safely switch to
`BatchSpanProcessor` (already the default when using `use_all()` without
explicit processor config):

```ruby
c.add_span_processor(
  OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
    OpenTelemetry::Exporter::OTLP::Exporter.new(
      endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT')
    )
  )
)
```

#### Step 5: Upgrade Rails (2–4 weeks)

```bash
# Follow Rails upgrade guides
# Test thoroughly at each minor version
Rails 5.2 → 6.0 → 6.1 → 7.0 → 7.1
```

## Production Deployment Recommendations

### For Ruby 2.7 Production Apps

**If you must run Ruby 2.7 in production:**

1. **Use SimpleSpanProcessor** (avoid BatchSpanProcessor)
2. **Monitor memory usage** closely
3. **Plan Ruby upgrade** within 3-6 months
4. **Disable non-critical instrumentations**

```ruby showLineNumbers title="config/initializers/opentelemetry.rb"
OpenTelemetry::SDK.configure do |c|
  c.service_name = 'rails-app-ruby27'

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::SimpleSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV.fetch('OTEL_EXPORTER_OTLP_ENDPOINT')
      )
    )
  )

  # Only enable critical instrumentations
  c.use 'OpenTelemetry::Instrumentation::Rails'
  c.use 'OpenTelemetry::Instrumentation::ActiveRecord'
end
```

### For Rails 5.2 Production Apps

**If you must run Rails 5.2 in production:**

1. **Test thoroughly in staging** (many edge cases)
2. **Implement manual instrumentation** for critical paths
3. **Monitor for missing traces**
4. **Plan Rails upgrade** to 6.1 LTS within 6 months
5. **Use health check endpoint** to verify instrumentation

```ruby showLineNumbers title="config/routes.rb"
Rails.application.routes.draw do
  get '/health/telemetry', to: 'health#telemetry'
end
```

```ruby showLineNumbers title="app/controllers/health_controller.rb"
class HealthController < ApplicationController
  def telemetry
    tracer = OpenTelemetry.tracer_provider.tracer('health_check')

    tracer.in_span('telemetry_health_check') do |span|
      span.set_attribute('rails.version', Rails.version)
      span.set_attribute('ruby.version', RUBY_VERSION)

      render json: {
        status: 'ok',
        rails_version: Rails.version,
        ruby_version: RUBY_VERSION,
        opentelemetry: {
          sdk_version: OpenTelemetry::SDK::VERSION,
          instrumented: instrumentation_status
        }
      }
    end
  end

  private

  def instrumentation_status
    {
      rack: defined?(OpenTelemetry::Instrumentation::Rack),
      active_record: defined?(OpenTelemetry::Instrumentation::ActiveRecord)
    }
  end
end
```

## Getting Help

### Community Resources

- **OpenTelemetry Ruby GitHub**:
  [Report issues](https://github.com/open-telemetry/opentelemetry-ruby/issues)
- **Ruby Upgrade Guides**:
  [Rails upgrade guides](https://guides.rubyonrails.org/upgrading_ruby_on_rails.html)
- **Scout Community**: Contact support for legacy version assistance

### Common Questions

**Q: Can I use `opentelemetry-instrumentation-all` with Ruby 3.0?**

A: No. The `-all` meta-gem pulls latest versions that require Ruby 3.1+. Use
individual instrumentation gems with pinned versions instead (see
[Ruby 3.0 / Rails 6.1](#ruby-30--rails-61)).

**Q: Can I use `opentelemetry-instrumentation-all` with Ruby 2.7?**

A: Not recommended. Use individual instrumentation gems to avoid compatibility
issues with gems that require Ruby 3.0+.

**Q: Will my legacy app slow down with OpenTelemetry?**

A: Yes, expect 5-10ms overhead on Ruby 2.7 vs 1-3ms on Ruby 3.x.

**Q: Is Rails 5.2 instrumentation production-ready?**

A: No. Rails 5.2 support is limited and untested. Upgrade to Rails 6.1+ for
production observability.

**Q: Can I run Ruby 2.7 with Rails 7.1?**

A: No. Rails 7.1 requires Ruby 3.0 or later.

## Related Guides

- [Rails OpenTelemetry Instrumentation](./rails.md) - Main guide for supported
  versions
- [Custom Ruby Instrumentation](../custom-instrumentation/ruby.md) - Manual
  instrumentation patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development setup
