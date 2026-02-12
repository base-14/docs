---
title: SDK
sidebar_position: 1
description: Scope SDK overview — programmatic access to prompts, template rendering, and caching.
keywords: [scope sdk, prompt sdk, llm sdk, scope client]
---

# Scope SDK

The Scope SDK gives your application programmatic access to
prompts managed in the Scope platform. Fetch prompt versions,
render templates with variables, and integrate prompt management
into your AI workflows — all with a few lines of code.

## What the SDK Does

1. **Authenticates** with the Scope API using your
   organization's API key and secret
2. **Fetches prompt versions** by name, label
   (`production` or `latest`), or specific version ID
3. **Renders templates** by substituting `{{variable}}` placeholders with your
  values
4. **Caches responses** in memory to minimize API calls (default TTL: 300
  seconds)

## Typical Workflow

```text
Set env vars → Create credentials → Create client
→ Fetch prompt → Render → Send to LLM
```

1. Set `SCOPE_ORG_ID`, `SCOPE_API_KEY`,
   `SCOPE_API_SECRET`, `SCOPE_API_URL`, and
   `SCOPE_AUTH_API_URL` as environment variables
2. Create credentials from those environment variables
3. Create a `ScopeClient` with the credentials
4. Call `get_prompt_version("prompt-name")` to fetch the production version
5. Call `version.render(variable="value")` to fill in placeholders
6. Pass the rendered string to your LLM provider

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| Python | `scope-client` | **Generally available** |
| Ruby | `scope-client` | **Generally available** |
| Node.js | `@scope/client` | Coming soon |
| Java/JVM | `io.scope:scope-client` | Coming soon |

For comprehensive single-language references, see the dedicated
[Python](./python.md) and [Ruby](./ruby.md) pages.

## Key Capabilities

- **Prompt fetching** — retrieve prompt versions by name,
  label (`production` / `latest`), or specific version ID
- **Template rendering** — substitute `{{variable}}`
  placeholders with type-safe variable values
- **Automatic caching** — in-memory TTL cache (default 300 s) to minimize API
  calls
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
- [Python Reference](./python.md) — complete Python SDK reference
- [Ruby Reference](./ruby.md) — complete Ruby SDK reference
- [Integration Examples](./integration-examples.md) —
  OpenAI, Anthropic, LangChain, and Express.js
