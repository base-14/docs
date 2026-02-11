---
title: Error Handling
sidebar_position: 6
---

# Error Handling

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

All SDK errors inherit from a single base class, so you can
catch broad categories or specific errors as needed.

## Error Hierarchy

```text
ScopeError (Python) / ScopeClient::Error (Ruby)
├── ConfigurationError
│   └── MissingApiKeyError
├── ApiError
│   ├── AuthenticationError
│   │   ├── TokenRefreshError
│   │   └── InvalidCredentialsError
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

## Basic Error Handling

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import (
    ScopeClient,
    ScopeError,
    NotFoundError,
    NoProductionVersionError,
    AuthenticationError,
)

try:
    version = client.get_prompt_version("my-prompt")
    rendered = version.render(name="Alice")
except NoProductionVersionError as e:
    print(f"No production version: {e}")
except NotFoundError as e:
    print(f"Prompt not found: {e}")
except AuthenticationError as e:
    print(f"Auth failed: {e}")
except ScopeError as e:
    print(f"SDK error: {e}")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
begin
  version = client.get_prompt_version("my-prompt")
  rendered = version.render(name: "Alice")
rescue ScopeClient::NoProductionVersionError => e
  puts "No production version: #{e.message}"
rescue ScopeClient::NotFoundError => e
  puts "Prompt not found: #{e.message}"
rescue ScopeClient::AuthenticationError => e
  puts "Auth failed: #{e.message}"
rescue ScopeClient::Error => e
  puts "SDK error: #{e.message}"
end
```

</TabItem>
</Tabs>

## Handling Render Errors

Template rendering can raise errors when variables are missing or unknown:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import MissingVariableError, ValidationError

try:
    # Missing a required variable
    rendered = version.render(name="Alice")
except MissingVariableError as e:
    print(f"Missing variables: {e.missing_variables}")
    # e.g. ["app"]
except ValidationError as e:
    print(f"Validation error: {e}")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
begin
  rendered = version.render(name: "Alice")
rescue ScopeClient::MissingVariableError => e
  puts "Missing variables: #{e.message}"
rescue ScopeClient::ValidationError => e
  puts "Validation error: #{e.message}"
end
```

</TabItem>
</Tabs>

## API Error Details

API errors include additional context for debugging:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ApiError

try:
    version = client.get_prompt_version("my-prompt")
except ApiError as e:
    print(e.message)       # Human-readable message
    print(e.http_status)   # HTTP status code (e.g., 404)
    print(e.error_code)    # Machine-readable code from API
    print(e.request_id)    # Request ID for support
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
begin
  version = client.get_prompt_version("my-prompt")
rescue ScopeClient::ApiError => e
  puts e.message       # Human-readable message
  puts e.http_status   # HTTP status code (e.g., 404)
  puts e.error_code    # Machine-readable code from API
  puts e.request_id    # Request ID for support
end
```

</TabItem>
</Tabs>

## Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `ConfigurationError` | Missing credentials or API URL | Set `SCOPE_ORG_ID`, `SCOPE_API_KEY`, `SCOPE_API_SECRET`, `SCOPE_API_URL`, and `SCOPE_AUTH_API_URL` |
| `AuthenticationError` | Invalid or expired credentials | Verify your API key and secret are correct |
| `NotFoundError` | Prompt name doesn't exist | Check the prompt name in the Scope dashboard |
| `NoProductionVersionError` | Prompt has no production version | Publish a version in the Scope dashboard, or use `label="latest"` |
| `MissingVariableError` | Template has `{{vars}}` not provided | Pass all required variables to `render()` |
| `RateLimitError` | Too many API requests | The SDK retries automatically; increase `retry_max_delay` if needed |
| `TimeoutError` | Request exceeded timeout | Increase `timeout` or `open_timeout` in client config |
