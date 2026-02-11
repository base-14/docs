---
title: Configuration
sidebar_position: 4
---

# Configuration

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## Environment Variables

The SDK reads the following environment variables. Set them before creating a client.

### Required

| Variable | Description |
|----------|-------------|
| `SCOPE_ORG_ID` | Your organization identifier |
| `SCOPE_API_KEY` | API key ID for authentication |
| `SCOPE_API_SECRET` | API key secret for authentication |
| `SCOPE_API_URL` | Base URL for the Scope API |
| `SCOPE_AUTH_API_URL` | Auth API URL for token exchange |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `SCOPE_ENVIRONMENT` | `production` | Environment name (e.g., `staging`) |
| `SCOPE_TOKEN_REFRESH_BUFFER` | `60` | Seconds before token expiry to trigger a refresh |

## Credentials

Create credentials explicitly or load them from environment variables:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ApiKeyCredentials

# From environment variables
credentials = ApiKeyCredentials.from_env()

# Or explicitly
credentials = ApiKeyCredentials(
    org_id="my-org",
    api_key="key_abc123",
    api_secret="secret_xyz",
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "scope_client"

# From environment variables
credentials = ScopeClient::Credentials::ApiKey.from_env

# Or explicitly
credentials = ScopeClient::Credentials::ApiKey.new(
  org_id: "my-org",
  api_key: "key_abc123",
  api_secret: "secret_xyz",
)
```

</TabItem>
</Tabs>

## Client Configuration Options

All options can be passed when creating a client:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `credentials` | Credentials | _required_ | Authentication credentials |
| `base_url` | string | from `SCOPE_API_URL` | Base URL for the API |
| `auth_api_url` | string | from `SCOPE_AUTH_API_URL` | Auth API URL |
| `api_version` | string | `"v1"` | API version string |
| `timeout` | integer | `30` | Request timeout in seconds |
| `open_timeout` | integer | `10` | Connection timeout in seconds |
| `cache_enabled` | boolean | `true` | Enable response caching |
| `cache_ttl` | integer | `300` | Cache time-to-live in seconds |
| `max_retries` | integer | `3` | Maximum retry attempts |
| `retry_base_delay` | float | `0.5` | Base delay between retries in seconds |
| `retry_max_delay` | float | `30.0` | Maximum delay between retries in seconds |
| `telemetry_enabled` | boolean | `true` | Enable telemetry hooks |
| `environment` | string | `"production"` | Environment name |
| `token_refresh_buffer` | integer | `60` | Seconds before token expiry to refresh |

## Creating a Client

### Direct instantiation

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ScopeClient, ApiKeyCredentials

credentials = ApiKeyCredentials.from_env()
client = ScopeClient(
    credentials=credentials,
    cache_ttl=600,
    timeout=60,
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
credentials = ScopeClient::Credentials::ApiKey.from_env
client = ScopeClient::Client.new(
  credentials: credentials,
  cache_ttl: 600,
  timeout: 60,
)
```

</TabItem>
</Tabs>

### Global configuration

Set defaults once and create clients from the global configuration:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
import scope_client
from scope_client import ApiKeyCredentials

# Configure globally
scope_client.configure(
    credentials=ApiKeyCredentials.from_env(),
    cache_enabled=True,
    cache_ttl=600,
)

# Create a client using the global configuration
client = scope_client.client()

# Override specific options per-client
client2 = scope_client.client(cache_enabled=False)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "scope_client"

# Configure globally
ScopeClient.configure do |config|
  config.credentials = ScopeClient::Credentials::ApiKey.from_env
  config.cache_enabled = true
  config.cache_ttl = 600
end

# Create a client using the global configuration
client = ScopeClient::Client.new
```

</TabItem>
</Tabs>

### Context manager (Python)

The Python client supports the context manager protocol for automatic cleanup:

```python
with ScopeClient(credentials=credentials) as client:
    version = client.get_prompt_version("greeting")
    print(version.render(name="Alice"))
# Connection is closed automatically
```
