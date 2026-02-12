---
title: Python SDK Reference
sidebar_position: 9
description: Complete Python SDK reference — installation, authentication, all methods, signatures, and examples.
keywords: [scope python sdk, python llm sdk, scope-client python, prompt management python]
---

# Python SDK Reference

This page is a comprehensive single-language reference for the Scope Python SDK.
It covers installation, authentication, all client methods, prompt version
properties, error handling, caching, and telemetry.

For concept-oriented guides with side-by-side Python/Ruby examples, see the
tabbed pages in the [SDK section](./index.md).

## Installation

**Requirements:** Python 3.9+

```bash
pip install git+https://github.com/base14/scope-sdk.git#subdirectory=sdks/python
```

Verify:

```python
import scope_client
print(scope_client.__version__)
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

```python
from scope_client import ApiKeyCredentials

# From environment variables
credentials = ApiKeyCredentials.from_env()

# Or explicitly
credentials = ApiKeyCredentials(
    org_id="org_01ABC",
    api_key="key_01XYZ",
    api_secret="secret_01DEF",
    api_url="https://scope.example.com/api/v1",
    auth_api_url="https://auth.example.com"
)
```

### Create a Client

```python
from scope_client import ScopeClient

# Basic
client = ScopeClient(credentials=credentials)

# With options
client = ScopeClient(
    credentials=credentials,
    timeout=30,
    cache_enabled=True,
    cache_ttl=600,
    max_retries=3,
    telemetry_enabled=True
)
```

#### Global Configuration

```python
from scope_client import configure, client

configure(
    credentials=credentials,
    cache_ttl=600,
    max_retries=5
)

# Use the global client
c = client()
version = c.get_prompt_version("greeting")
```

#### Context Manager

```python
with ScopeClient(credentials=credentials) as client:
    version = client.get_prompt_version("greeting")
    rendered = version.render(name="Alice")
```

## Client Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `credentials` | `ApiKeyCredentials` | — | Required. Authentication credentials |
| `base_url` | `str` | From env | Scope API base URL |
| `auth_api_url` | `str` | From env | Auth service URL |
| `api_version` | `str` | `"v1"` | API version |
| `timeout` | `int` | `30` | Request timeout in seconds |
| `open_timeout` | `int` | `10` | Connection timeout in seconds |
| `cache_enabled` | `bool` | `True` | Enable in-memory TTL cache |
| `cache_ttl` | `int` | `300` | Cache TTL in seconds |
| `max_retries` | `int` | `3` | Max retry attempts |
| `retry_base_delay` | `float` | `0.5` | Initial retry delay in seconds |
| `retry_max_delay` | `float` | `30.0` | Maximum retry delay in seconds |
| `telemetry_enabled` | `bool` | `True` | Enable telemetry hooks |
| `environment` | `str` | `"production"` | Environment name |
| `token_refresh_buffer` | `int` | `60` | Seconds before token expiry to refresh |

## Methods

### `get_prompt_version(name, *, label=None, version=None, cache=True, cache_ttl=None)`

Fetches a prompt version from the Scope API.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `str` | — | Prompt name (required) |
| `label` | `str` | `None` | `"production"` or `"latest"` |
| `version` | `str` | `None` | Specific version ID (e.g., `"v_01ABC"`) |
| `cache` | `bool` | `True` | Use cache for this request |
| `cache_ttl` | `int` | `None` | Override cache TTL for this request |

**Returns:** `PromptVersion`

**Behavior:**

- No label or version → fetches the **production** version
- `label="production"` → fetches the production version
- `label="latest"` → fetches the most recent version (any status)
- `version="v_01ABC"` → fetches a specific version by ID

```python
# Production version (default)
version = client.get_prompt_version("greeting")

# Latest version
version = client.get_prompt_version("greeting", label="latest")

# Specific version
version = client.get_prompt_version("greeting", version="v_01ABC123")

# Skip cache
version = client.get_prompt_version("greeting", cache=False)

# Custom cache TTL
version = client.get_prompt_version("greeting", cache_ttl=60)
```

### `render_prompt(name, variables, *, label=None, version=None, cache=True, cache_ttl=None)`

Fetches a prompt version and renders it with variables in a single call.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `str` | — | Prompt name (required) |
| `variables` | `dict` | — | Variable values as key-value pairs (required) |
| `label` | `str` | `None` | `"production"` or `"latest"` |
| `version` | `str` | `None` | Specific version ID |
| `cache` | `bool` | `True` | Use cache for this request |
| `cache_ttl` | `int` | `None` | Override cache TTL |

**Returns:** `str` (rendered prompt content)

```python
rendered = client.render_prompt(
    "greeting",
    {"name": "Alice", "app": "Scope"},
    label="production"
)
```

### `clear_cache()`

Clears all cached prompt versions.

```python
client.clear_cache()
```

## PromptVersion Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `str` | Version ID (e.g., `"v_01ABC"`) |
| `prompt_id` | `str` | Parent prompt ID |
| `version_number` | `int` | Sequential version number |
| `content` | `str` | Raw template content with `{{variable}}` placeholders |
| `variables` | `list[str]` | Detected variable names |
| `status` | `str` | `"draft"`, `"published"`, or `"archived"` |
| `is_production` | `bool` | Whether this is the production version |
| `type` | `str` | Prompt type (`"text"` or `"chat"`) |
| `metadata` | `dict` | Arbitrary key-value metadata |
| `created_at` | `datetime` | Creation timestamp |
| `updated_at` | `datetime` | Last update timestamp |

### Status Helpers

```python
version.is_draft       # True if status == "draft"
version.is_published   # True if status == "published"
version.is_archived    # True if status == "archived"
version.is_production  # True if this is the active production version
```

### Metadata Access

```python
model = version.get_metadata("model")                    # Returns None if missing
model = version.get_metadata("model", default="gpt-4o")  # Returns default if missing
```

## PromptVersion Methods

### `render(**variables)`

Renders the template by substituting `{{variable}}` placeholders.

```python
version = client.get_prompt_version("greeting")
rendered = version.render(name="Alice", app="Scope")
```

Raises `MissingVariableError` if any required variables are not provided.

## Error Handling

### Error Hierarchy

```text
ScopeError
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

```python
from scope_client.errors import (
    ScopeError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    MissingVariableError,
    NoProductionVersionError,
)

try:
    version = client.get_prompt_version("greeting")
    rendered = version.render(name="Alice")
except AuthenticationError:
    # Invalid or expired credentials
    pass
except NotFoundError:
    # Prompt not found
    pass
except NoProductionVersionError:
    # No version promoted to production
    pass
except RateLimitError as e:
    # Rate limited — check e.retry_after
    pass
except MissingVariableError as e:
    # Missing template variables
    print(f"Missing: {e.missing_variables}")
except ScopeError:
    # Catch-all for any SDK error
    pass
```

### ApiError Properties

```python
try:
    version = client.get_prompt_version("greeting")
except ApiError as e:
    print(e.message)       # Error description
    print(e.http_status)   # HTTP status code (e.g., 404)
    print(e.error_code)    # API error code
    print(e.request_id)    # Request ID for support
```

## Caching

The SDK caches prompt versions in memory using a TTL cache.

```python
# Default: cache enabled, 300s TTL
client = ScopeClient(credentials=credentials)

# Custom TTL
client = ScopeClient(credentials=credentials, cache_ttl=600)

# Disable caching entirely
client = ScopeClient(credentials=credentials, cache_enabled=False)

# Per-request cache control
version = client.get_prompt_version("greeting", cache=False)      # Skip cache
version = client.get_prompt_version("greeting", cache_ttl=60)     # Short TTL

# Clear cache
client.clear_cache()
```

Cache keys follow the pattern: `prompt:{name}:{label|version}`.

## Telemetry

Register hooks to observe SDK HTTP activity.

```python
from scope_client import Telemetry

# Request hook
Telemetry.on_request(lambda info: print(f"→ {info.method} {info.url}"))

# Response hook
Telemetry.on_response(lambda info: print(f"← {info.status_code} in {info.elapsed_ms}ms"))

# Error hook
Telemetry.on_error(lambda info: print(f"✗ {info.error}"))

# Clear all hooks
Telemetry.clear_callbacks()
```

### Hook Data

| Hook | Fields |
|------|--------|
| `RequestInfo` | `request_id`, `method`, `url`, `headers` |
| `ResponseInfo` | `request_id`, `status_code`, `headers`, `elapsed_ms` |
| `ErrorInfo` | `request_id`, `error`, `elapsed_ms` |

### OpenTelemetry Integration

```python
from opentelemetry import trace

tracer = trace.get_tracer("scope-client")

def on_request(info):
    span = tracer.start_span("scope.request")
    span.set_attribute("http.method", info.method)
    span.set_attribute("http.url", info.url)

def on_response(info):
    span = trace.get_current_span()
    span.set_attribute("http.status_code", info.status_code)
    span.end()

Telemetry.on_request(on_request)
Telemetry.on_response(on_response)
```

## End-to-End Example

```python
import os
from anthropic import Anthropic
from scope_client import ScopeClient, ApiKeyCredentials
from scope_client.errors import MissingVariableError, NotFoundError

# 1. Set up Scope client
credentials = ApiKeyCredentials.from_env()
client = ScopeClient(credentials=credentials)

# 2. Fetch the production prompt
try:
    version = client.get_prompt_version("customer-support")
except NotFoundError:
    print("Prompt not found")
    exit(1)

# 3. Render with variables
try:
    rendered = version.render(
        customer_name="Alice",
        issue="billing discrepancy",
        account_id="ACC-12345"
    )
except MissingVariableError as e:
    print(f"Missing variables: {e.missing_variables}")
    exit(1)

# 4. Send to Anthropic
anthropic = Anthropic()
response = anthropic.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[{"role": "user", "content": rendered}]
)

print(response.content[0].text)
```
