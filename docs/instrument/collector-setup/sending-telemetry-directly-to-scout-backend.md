---
title: Send OpenTelemetry Signals Directly to Scout Backend | base14 Scout
description: Configure applications to send OpenTelemetry traces, logs, and metrics directly to Scout backend without collectors. Complete guide for direct OTLP export with OIDC authentication.
keywords: [opentelemetry direct export, otlp exporter, send telemetry directly, opentelemetry without collector, direct instrumentation]
---

# Sending OpenTelemetry Signals Directly to Scout Backend

This guide explains how to configure applications to send OpenTelemetry traces,
logs, and metrics directly to the Scout backend,
without using intermediate collectors or agents.

## Data Flow

``` markdown
Application → OpenTelemetry SDK → OTLP Exporter → Scout Backend
```

The direct export flow consists of:

1. **Application generates telemetry**: The application is instrumented with an
OpenTelemetry SDK that exports telemetry signals (traces, metrics, logs)directly
into the Scout backend.
2. **OpenTelemetry SDK**: The SDK batches and processes telemetry data
3. **OTLP Exporter**: Data is exported via OTLP (OpenTelemetry Protocol) over HTTP/gRPC
4. **Authentication**: OIDC token-based authentication secures the connection
5. **Scout Backend**: The scout backend receives and processes the telemetry
 and send them for visualization in the Scout UI.
Refer [this](https://docs.base14.io/) for more details.

## Tradeoffs

**Pros:**

- Simple to use (especially in a dev/test environment)
- No additional moving parts to operate (in production environments)

**Cons:**

- Requires code changes if collection, processing, or ingestion changes
- Strong coupling between the application code and the backend
- There are limited number of exporters per language implementation

## Required Dependencies

All applications need these core components:

1. **OpenTelemetry SDK**: Core functionality for generating telemetry
2. **OTLP Exporter**: For sending data via OpenTelemetry Protocol over HTTP/gRPC
3. **Auto-instrumentation libraries**: Framework-specific instrumentation
(e.g., Rails instrumentation)
4. **HTTP client**: For fetching OIDC tokens

## Example: Rails Application

### Configuration Changes Required

When sending telemetry directly to Scout backend, your application needs the
following changes:

### 1.  Environment Variables

Set these environment variables for your application:

```bash
# Service identification
OTEL_SERVICE_NAME=rails-service-name
RAILS_ENV=production  # or staging

# Scout collector configuration
SCOUT_ENDPOINT=https://scout-collector-endpoint/v1/traces
SCOUT_CLIENT_ID=your-client-id
SCOUT_CLIENT_SECRET=your-client-secret
SCOUT_TOKEN_URL=https://id.b14.dev/realms/your-tenant/protocol/openid-connect/token
```

### 2. Opentelemetry Configuration

Create `config/initializers/opentelemetry.rb`:

```ruby
require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
require "opentelemetry/instrumentation/all"
require "net/http"
require "json"

# Function to fetch OIDC token
def fetch_oidc_token
  client_id = ENV.fetch("SCOUT_CLIENT_ID")
  client_secret = ENV.fetch("SCOUT_CLIENT_SECRET")
  token_url = ENV.fetch("SCOUT_TOKEN_URL")

  uri = URI(token_url)
#   ... (authentication logic)
  request = Net::HTTP::Post.new(uri)
  request.set_form_data(
    "grant_type" => "client_credentials",
    "client_id" => client_id,
    "client_secret" => client_secret
  )

  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|
    http.request(request)
  end

  if response.is_a?(Net::HTTPSuccess)
    JSON.parse(response.body)["access_token"]
  else
    Rails.logger.error "Failed to fetch OIDC token: #{response.body}"
    nil
  end
end

# Configure OpenTelemetry
OpenTelemetry::SDK.configure do |c|
  endpoint = ENV.fetch("SCOUT_ENDPOINT")
  resource = OpenTelemetry::SDK::Resources::Resource.create(
    {
      'service.name' => ENV.fetch("OTEL_SERVICE_NAME", "default-service"),
      'deployment.environment' => ENV.fetch("RAILS_ENV", "development")
    }   
  )
  c.resource = resource

  # Fetch authentication token
  token = fetch_oidc_token
  headers = {}
  headers["Authorization"] = "Bearer #{token}" if token

  # Configure OTLP exporter to send telemetry to Scout OTel ingestor
  otlp_exporter = OpenTelemetry::Exporter::OTLP::Exporter.new(
    endpoint: endpoint,
    headers: headers
  )

  # Add span processor
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(otlp_exporter)
  )

  # Enable all available instrumentation
  c.use_all()
end
```

### 3. Application Dependencies

Ensure your application has the required OpenTelemetry packages installed and
configured for direct export.

### Essential Configuration Requirements

1. Service Name and Environment (Critical)
Always ensure these attributes are properly set.

```ruby
# In your OpenTelemetry configuration
# Add environment as resource attribute
c.resource = OpenTelemetry::SDK::Resources::Resource.create({
  "service.name" => ENV.fetch("OTEL_SERVICE_NAME", "rails-service-name"),
  "service.version" => "1.0.0",
  "deployment.environment" => ENV.fetch("RAILS_ENV", "development")
})
```

### Authentication Options

When deploying without collector, you have several authentication options:

### OIDC Token Authentication (Recommended)

```ruby
# Token refresh logic (implement based on your needs)
def fetch_oidc_token
  # Implement token caching and refresh logic
  # Handle token expiration
  # Include proper error handling
end
```

### Production Considerations

1. **Token Management**: Implement proper token refresh and error handling
2. **Retry Logic**: Add exponential backoff for failed exports
3. **Monitoring**: Monitor export success/failure rates
4. **Performance**: Consider batch size and export intervals
5. **Security**: Secure credential management

## Troubleshooting

### Common Issues

1. **Authentication failures**: Check OIDC credentials and token URL
2. **Network connectivity**: Verify endpoint accessibility
3. **Performance impact**: Monitor application overhead

## Related Guides

- [Scout Exporter Configuration](./scout-exporter.md) - Use collector for
  centralized authentication
- [Rails Auto-Instrumentation](../apps/auto-instrumentation/rails.md) - Rails
  framework instrumentation guide
- [Docker Compose Setup](./docker-compose-example.md) - Set up collector for
  local development

## References

- [Rails instrumentation doc](https://docs.base14.io/instrument/apps/auto-instrumentation/rails)
- [Rails instrumentaion code](https://github.com/base-14/examples/tree/main/rails)
