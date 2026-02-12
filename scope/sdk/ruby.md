---
title: Ruby SDK Reference
sidebar_position: 10
description: Complete Ruby SDK reference — installation, authentication, all methods, signatures, and examples.
keywords: [scope ruby sdk, ruby llm sdk, scope-client ruby, prompt management ruby]
---

# Ruby SDK Reference

This page is a comprehensive single-language reference for the Scope Ruby SDK.
It covers installation, authentication, all client methods, prompt version
properties, error handling, caching, and telemetry.

For concept-oriented guides with side-by-side Python/Ruby examples, see the
tabbed pages in the [SDK section](./index.md).

## Installation

**Requirements:** Ruby 2.7+

Add to your `Gemfile`:

```ruby
gem "scope_client",
    git: "https://github.com/base14/scope-sdk.git",
    glob: "sdks/ruby/*.gemspec"
```

Then run:

```bash
bundle install
```

Verify:

```ruby
require "scope_client"
puts ScopeClient::VERSION
```

## Authentication

### Environment Variables

Set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `SCOPE_ORG_ID` | Yes | Your organization/tenant ID |
| `SCOPE_API_KEY` | Yes | API key identifier |
| `SCOPE_API_SECRET` | Yes | API key secret |
| `SCOPE_API_URL` | Yes | Scope API base URL |
| `SCOPE_AUTH_API_URL` | Yes | Auth service URL |
| `SCOPE_ENVIRONMENT` | No | Environment name (default: `production`) |
| `SCOPE_TOKEN_REFRESH_BUFFER` | No | Seconds before expiry to refresh token (default: `60`) |

### Create Credentials

```ruby
require "scope_client"

# From environment variables
credentials = ScopeClient::Credentials::ApiKey.from_env

# Or explicitly
credentials = ScopeClient::Credentials::ApiKey.new(
  org_id: "org_01ABC",
  api_key: "key_01XYZ",
  api_secret: "secret_01DEF",
  api_url: "https://scope.example.com/api/v1",
  auth_api_url: "https://auth.example.com"
)
```

### Create a Client

```ruby
# Basic
client = ScopeClient::Client.new(credentials: credentials)

# With options
client = ScopeClient::Client.new(
  credentials: credentials,
  timeout: 30,
  cache_enabled: true,
  cache_ttl: 600,
  max_retries: 3,
  telemetry_enabled: true
)
```

#### Global Configuration

```ruby
ScopeClient.configure do |config|
  config.credentials = credentials
  config.cache_ttl = 600
  config.max_retries = 5
end

# Use the global client
client = ScopeClient.client
version = client.get_prompt_version("greeting")
```

## Client Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `credentials` | `Credentials::ApiKey` | — | Required. Authentication credentials |
| `base_url` | `String` | From env | Scope API base URL |
| `auth_api_url` | `String` | From env | Auth service URL |
| `api_version` | `String` | `"v1"` | API version |
| `timeout` | `Integer` | `30` | Request timeout in seconds |
| `open_timeout` | `Integer` | `10` | Connection timeout in seconds |
| `cache_enabled` | `Boolean` | `true` | Enable in-memory TTL cache |
| `cache_ttl` | `Integer` | `300` | Cache TTL in seconds |
| `max_retries` | `Integer` | `3` | Max retry attempts |
| `retry_base_delay` | `Float` | `0.5` | Initial retry delay in seconds |
| `retry_max_delay` | `Float` | `30.0` | Maximum retry delay in seconds |
| `telemetry_enabled` | `Boolean` | `true` | Enable telemetry hooks |
| `environment` | `String` | `"production"` | Environment name |
| `token_refresh_buffer` | `Integer` | `60` | Seconds before token expiry to refresh |

## Methods

<!-- markdownlint-disable MD013 -->
### `get_prompt_version(name, label: nil, version: nil, cache: true, cache_ttl: nil)`
<!-- markdownlint-enable MD013 -->

Fetches a prompt version from the Scope API.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `String` | — | Prompt name (required) |
| `label` | `String` | `nil` | `"production"` or `"latest"` |
| `version` | `String` | `nil` | Specific version ID (e.g., `"v_01ABC"`) |
| `cache` | `Boolean` | `true` | Use cache for this request |
| `cache_ttl` | `Integer` | `nil` | Override cache TTL for this request |

**Returns:** `PromptVersion`

**Behavior:**

- No label or version → fetches the **production** version
- `label: "production"` → fetches the production version
- `label: "latest"` → fetches the most recent version (any status)
- `version: "v_01ABC"` → fetches a specific version by ID

```ruby
# Production version (default)
version = client.get_prompt_version("greeting")

# Latest version
version = client.get_prompt_version("greeting", label: "latest")

# Specific version
version = client.get_prompt_version("greeting", version: "v_01ABC123")

# Skip cache
version = client.get_prompt_version("greeting", cache: false)

# Custom cache TTL
version = client.get_prompt_version("greeting", cache_ttl: 60)
```

<!-- markdownlint-disable MD013 -->
### `render_prompt(name, variables, label: nil, version: nil, cache: true, cache_ttl: nil)`
<!-- markdownlint-enable MD013 -->

Fetches a prompt version and renders it with variables in a single call.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `String` | — | Prompt name (required) |
| `variables` | `Hash` | — | Variable values as key-value pairs (required) |
| `label` | `String` | `nil` | `"production"` or `"latest"` |
| `version` | `String` | `nil` | Specific version ID |
| `cache` | `Boolean` | `true` | Use cache for this request |
| `cache_ttl` | `Integer` | `nil` | Override cache TTL |

**Returns:** `String` (rendered prompt content)

```ruby
rendered = client.render_prompt(
  "greeting",
  { name: "Alice", app: "Scope" },
  label: "production"
)
```

### `clear_cache`

Clears all cached prompt versions.

```ruby
client.clear_cache
```

## PromptVersion Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `String` | Version ID (e.g., `"v_01ABC"`) |
| `prompt_id` | `String` | Parent prompt ID |
| `version_number` | `Integer` | Sequential version number |
| `content` | `String` | Raw template content with `{{variable}}` placeholders |
| `variables` | `Array<String>` | Detected variable names |
| `status` | `String` | `"draft"`, `"published"`, or `"archived"` |
| `production?` | `Boolean` | Whether this is the production version |
| `type` | `String` | Prompt type (`"text"` or `"chat"`) |
| `metadata` | `Hash` | Arbitrary key-value metadata |
| `created_at` | `Time` | Creation timestamp |
| `updated_at` | `Time` | Last update timestamp |

### Status Helpers

```ruby
version.draft?       # true if status == "draft"
version.published?   # true if status == "published"
version.archived?    # true if status == "archived"
version.production?  # true if this is the active production version
```

### Metadata Access

```ruby
model = version.get_metadata("model")                     # Returns nil if missing
model = version.get_metadata("model", default: "gpt-4o")  # Returns default if missing
```

## PromptVersion Methods

### `render(**variables)`

Renders the template by substituting `{{variable}}` placeholders.

```ruby
version = client.get_prompt_version("greeting")
rendered = version.render(name: "Alice", app: "Scope")
```

Raises `MissingVariableError` if any required variables are not provided.

## Error Handling

### Error Hierarchy

```text
ScopeClient::Error
├── ConfigurationError
│   └── MissingApiKeyError
├── ApiError
│   ├── AuthenticationError
│   ├── AuthorizationError
│   ├── NotFoundError
│   ├── ConflictError
│   ├── RateLimitError
│   └── ServerError
├── ConnectionError
│   └── TimeoutError
└── ResourceError
    ├── ValidationError
    ├── RenderError
    │   └── MissingVariableError
    └── NoProductionVersionError
```

### Common Patterns

```ruby
begin
  version = client.get_prompt_version("greeting")
  rendered = version.render(name: "Alice")
rescue ScopeClient::AuthenticationError
  # Invalid or expired credentials
rescue ScopeClient::NotFoundError
  # Prompt not found
rescue ScopeClient::NoProductionVersionError
  # No version promoted to production
rescue ScopeClient::RateLimitError => e
  # Rate limited — check e.retry_after
rescue ScopeClient::MissingVariableError => e
  # Missing template variables
  puts "Missing: #{e.missing_variables}"
rescue ScopeClient::Error
  # Catch-all for any SDK error
end
```

### ApiError Properties

```ruby
begin
  version = client.get_prompt_version("greeting")
rescue ScopeClient::ApiError => e
  puts e.message       # Error description
  puts e.http_status   # HTTP status code (e.g., 404)
  puts e.error_code    # API error code
  puts e.request_id    # Request ID for support
end
```

## Caching

The SDK caches prompt versions in memory using a TTL cache.

```ruby
# Default: cache enabled, 300s TTL
client = ScopeClient::Client.new(credentials: credentials)

# Custom TTL
client = ScopeClient::Client.new(credentials: credentials, cache_ttl: 600)

# Disable caching entirely
client = ScopeClient::Client.new(credentials: credentials, cache_enabled: false)

# Per-request cache control
version = client.get_prompt_version("greeting", cache: false)      # Skip cache
version = client.get_prompt_version("greeting", cache_ttl: 60)     # Short TTL

# Clear cache
client.clear_cache
```

Cache keys follow the pattern: `prompt:{name}:{label|version}`.

## Telemetry

Register hooks to observe SDK HTTP activity via Faraday middleware.

```ruby
# Request hook
ScopeClient::Middleware::Telemetry.on_request = ->(info) {
  puts "→ #{info.method} #{info.url}"
}

# Response hook
ScopeClient::Middleware::Telemetry.on_response = ->(info) {
  puts "← #{info.status} in #{info.duration}ms"
}

# Error hook
ScopeClient::Middleware::Telemetry.on_error = ->(info) {
  puts "✗ #{info.error}"
}

# Clear hooks
ScopeClient::Middleware::Telemetry.on_request = nil
ScopeClient::Middleware::Telemetry.on_response = nil
ScopeClient::Middleware::Telemetry.on_error = nil
```

### Hook Data

| Hook | Fields |
|------|--------|
| `RequestInfo` | `request_id`, `method`, `url`, `headers` |
| `ResponseInfo` | `request_id`, `status`, `headers`, `duration` |
| `ErrorInfo` | `request_id`, `error`, `duration` |

### OpenTelemetry Integration

```ruby
require "opentelemetry-sdk"

tracer = OpenTelemetry.tracer_provider.tracer("scope-client")

ScopeClient::Middleware::Telemetry.on_request = ->(info) {
  span = tracer.start_span("scope.request")
  span.set_attribute("http.method", info.method)
  span.set_attribute("http.url", info.url)
}

ScopeClient::Middleware::Telemetry.on_response = ->(info) {
  span = OpenTelemetry::Trace.current_span
  span.set_attribute("http.status_code", info.status)
  span.finish
}
```

## End-to-End Example

```ruby
require "scope_client"
require "anthropic"

# 1. Set up Scope client
credentials = ScopeClient::Credentials::ApiKey.from_env
client = ScopeClient::Client.new(credentials: credentials)

# 2. Fetch the production prompt
begin
  version = client.get_prompt_version("customer-support")
rescue ScopeClient::NotFoundError
  puts "Prompt not found"
  exit 1
end

# 3. Render with variables
begin
  rendered = version.render(
    customer_name: "Alice",
    issue: "billing discrepancy",
    account_id: "ACC-12345"
  )
rescue ScopeClient::MissingVariableError => e
  puts "Missing variables: #{e.missing_variables}"
  exit 1
end

# 4. Send to Anthropic
anthropic = Anthropic::Client.new
response = anthropic.messages.create(
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 1024,
  messages: [{ role: "user", content: rendered }]
)

puts response.content.first.text
```
