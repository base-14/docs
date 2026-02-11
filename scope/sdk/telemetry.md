---
title: Telemetry
sidebar_position: 8
---

# Telemetry

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

The SDK provides telemetry hooks that let you observe every
HTTP request, response, and error. Use them for logging,
metrics collection, or integration with observability platforms
like OpenTelemetry.

Telemetry is **enabled by default**. Hooks are opt-in — no
callbacks fire unless you register them.

## Registering Hooks

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

The Python SDK uses a global `Telemetry` class with three hook methods:

```python
from scope_client import Telemetry, RequestInfo, ResponseInfo, ErrorInfo

def on_request(info: RequestInfo):
    print(f"[{info.request_id}] {info.method} {info.url}")

def on_response(info: ResponseInfo):
    print(f"[{info.request_id}] {info.status_code} in {info.elapsed_ms:.0f}ms")

def on_error(info: ErrorInfo):
    print(f"[{info.request_id}] Error: {info.error} after {info.elapsed_ms:.0f}ms")

Telemetry.on_request(on_request)
Telemetry.on_response(on_response)
Telemetry.on_error(on_error)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

The Ruby SDK uses Faraday middleware callbacks:

```ruby
require "scope_client"

ScopeClient::Middleware::Telemetry.on_request = ->(info) {
  puts "[#{info[:request_id]}] #{info[:method]} #{info[:url]}"
}

ScopeClient::Middleware::Telemetry.on_response = ->(info) {
  puts "[#{info[:request_id]}] #{info[:status]} in #{info[:duration]}s"
}

ScopeClient::Middleware::Telemetry.on_error = ->(info) {
  puts "[#{info[:request_id]}] Error: #{info[:error]} after #{info[:duration]}s"
}
```

</TabItem>
</Tabs>

## Hook Data

### RequestInfo

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Unique ID for correlating request/response/error |
| `method` | string | HTTP method (`GET`, `POST`, etc.) |
| `url` | string | Full request URL |
| `headers` | dict/hash | Request headers (authorization is redacted) |

### ResponseInfo

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Matches the originating request |
| `status_code` / `status` | integer | HTTP status code |
| `headers` | dict/hash | Response headers |
| `elapsed_ms` / `duration` | float | Request duration (ms in Python, seconds in Ruby) |

### ErrorInfo

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Matches the originating request |
| `error` | exception | The error that occurred |
| `elapsed_ms` / `duration` | float | Time before failure (ms in Python, seconds in Ruby) |

## Integration with Logging

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
import logging
from scope_client import Telemetry, RequestInfo, ResponseInfo, ErrorInfo

logger = logging.getLogger("scope_client")

def log_request(info: RequestInfo):
    logger.info("Scope API request: %s %s", info.method, info.url)

def log_response(info: ResponseInfo):
    logger.info(
        "Scope API response: %s in %.0fms",
        info.status_code,
        info.elapsed_ms,
    )

def log_error(info: ErrorInfo):
    logger.error(
        "Scope API error: %s after %.0fms",
        info.error,
        info.elapsed_ms,
    )

Telemetry.on_request(log_request)
Telemetry.on_response(log_response)
Telemetry.on_error(log_error)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "logger"
require "scope_client"

logger = Logger.new($stdout)

ScopeClient::Middleware::Telemetry.on_request = ->(info) {
  logger.info("Scope API request: #{info[:method]} #{info[:url]}")
}

ScopeClient::Middleware::Telemetry.on_response = ->(info) {
  logger.info("Scope API response: #{info[:status]} in #{info[:duration]}s")
}

ScopeClient::Middleware::Telemetry.on_error = ->(info) {
  logger.error("Scope API error: #{info[:error]} after #{info[:duration]}s")
}
```

</TabItem>
</Tabs>

## Integration with OpenTelemetry

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from opentelemetry import trace
from scope_client import Telemetry, RequestInfo, ResponseInfo, ErrorInfo

tracer = trace.get_tracer("scope_client")

def trace_request(info: RequestInfo):
    span = tracer.start_span(f"scope.{info.method}")
    span.set_attribute("http.method", info.method)
    span.set_attribute("http.url", info.url)
    span.set_attribute("scope.request_id", info.request_id)

def trace_response(info: ResponseInfo):
    span = trace.get_current_span()
    span.set_attribute("http.status_code", info.status_code)
    span.set_attribute("scope.elapsed_ms", info.elapsed_ms)

Telemetry.on_request(trace_request)
Telemetry.on_response(trace_response)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "opentelemetry-api"
require "scope_client"

tracer = OpenTelemetry.tracer_provider.tracer("scope_client")

ScopeClient::Middleware::Telemetry.on_request = ->(info) {
  tracer.in_span("scope.#{info[:method]}") do |span|
    span.set_attribute("http.method", info[:method].to_s)
    span.set_attribute("http.url", info[:url])
    span.set_attribute("scope.request_id", info[:request_id])
  end
}
```

</TabItem>
</Tabs>

## Clearing Hooks

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
Telemetry.clear_callbacks()
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
ScopeClient::Middleware::Telemetry.on_request = nil
ScopeClient::Middleware::Telemetry.on_response = nil
ScopeClient::Middleware::Telemetry.on_error = nil
```

</TabItem>
</Tabs>

## Disabling Telemetry

To disable the telemetry middleware entirely:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
client = ScopeClient(
    credentials=credentials,
    telemetry_enabled=False,
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
client = ScopeClient::Client.new(
  credentials: credentials,
  telemetry_enabled: false,
)
```

</TabItem>
</Tabs>
