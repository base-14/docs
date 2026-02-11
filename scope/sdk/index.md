---
title: SDK
sidebar_position: 1
---

# Scope SDK

The Scope SDK gives your application programmatic access to
prompts managed in the Scope platform. Fetch prompt versions,
render templates with variables, and integrate prompt management
into your AI workflows — all with a few lines of code.

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| Python | `scope-client` | **Generally available** |
| Ruby | `scope-client` | **Generally available** |
| Node.js | `@scope/client` | Coming soon |
| Java/JVM | `io.scope:scope-client` | Coming soon |

## Key Capabilities

- **Prompt fetching** — retrieve prompt versions by name,
  label (`production` / `latest`), or specific version ID
- **Template rendering** — substitute `{{variable}}`
  placeholders with type-safe variable values
- **Automatic caching** — in-memory TTL cache (default 300 s) to minimize API calls
- **JWT authentication** — API-key-based auth with automatic token refresh
- **Retry with backoff** — configurable retry logic with exponential backoff
- **Telemetry hooks** — observe every request, response, and
  error for logging or metrics

## Quick Example

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ScopeClient, ApiKeyCredentials

credentials = ApiKeyCredentials.from_env()
client = ScopeClient(credentials=credentials)

version = client.get_prompt_version("greeting")
rendered = version.render(name="Alice")
print(rendered)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "scope_client"

credentials = ScopeClient::Credentials::ApiKey.from_env
client = ScopeClient::Client.new(credentials: credentials)

version = client.get_prompt_version("greeting")
rendered = version.render(name: "Alice")
puts rendered
```

</TabItem>
</Tabs>

## Next Steps

- [Installation](./installation.md) — install the SDK for your language
- [Quickstart](./quickstart.md) — end-to-end walkthrough from setup to first prompt
- [Configuration](./configuration.md) — environment variables and client options
- [Prompt Management](./prompt-management.md) — fetching, rendering, and metadata
- [Error Handling](./error-handling.md) — error hierarchy and recovery patterns
- [Caching](./caching.md) — cache behavior and per-request control
- [Telemetry](./telemetry.md) — hooks for observability and debugging
