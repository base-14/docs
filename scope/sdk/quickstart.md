---
title: Quickstart
sidebar_position: 3
---

# Quickstart

This guide walks you through fetching and rendering your first
prompt with the Scope SDK.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## 1. Set Environment Variables

The SDK needs three required environment variables for
authentication, plus two for the API endpoints:

```bash
export SCOPE_ORG_ID="your-org-id"
export SCOPE_API_KEY="your-api-key"
export SCOPE_API_SECRET="your-api-secret"
export SCOPE_API_URL="https://api.scope.example.com"
export SCOPE_AUTH_API_URL="https://auth.scope.example.com"
```

## 2. Create Credentials and a Client

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ScopeClient, ApiKeyCredentials

# Load credentials from environment variables
credentials = ApiKeyCredentials.from_env()

# Create a client
client = ScopeClient(credentials=credentials)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "scope_client"

# Load credentials from environment variables
credentials = ScopeClient::Credentials::ApiKey.from_env

# Create a client
client = ScopeClient::Client.new(credentials: credentials)
```

</TabItem>
</Tabs>

## 3. Fetch a Prompt Version

By default, `get_prompt_version` returns the **production** version of a prompt:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("greeting")

print(version.content)     # "Hello, {{name}}! Welcome to {{app}}."
print(version.variables)   # ["name", "app"]
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("greeting")

puts version.content     # "Hello, {{name}}! Welcome to {{app}}."
puts version.variables   # ["name", "app"]
```

</TabItem>
</Tabs>

## 4. Render the Prompt

Substitute `{{variable}}` placeholders with real values:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
rendered = version.render(name="Alice", app="Scope")
print(rendered)  # "Hello, Alice! Welcome to Scope."
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
rendered = version.render(name: "Alice", app: "Scope")
puts rendered  # "Hello, Alice! Welcome to Scope."
```

</TabItem>
</Tabs>

## 5. Use with an LLM

Pass the rendered prompt to any LLM provider:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
import anthropic

# Fetch and render prompt from Scope
version = client.get_prompt_version("summarize")
model = version.get_metadata("model")  # e.g. "claude-sonnet-4-5-20250514"
max_tokens = version.get_metadata("max_tokens")  # e.g. 1024
rendered = version.render(document=my_document)

# Send to LLM
llm = anthropic.Anthropic()
response = llm.messages.create(
    model=model,
    max_tokens=max_tokens,
    messages=[{"role": "user", "content": rendered}],
)
print(response.content[0].text)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "anthropic"

# Fetch and render prompt from Scope
version = client.get_prompt_version("summarize")
model = version.get_metadata("model")  # e.g. "claude-sonnet-4-5-20250514"
max_tokens = version.get_metadata("max_tokens")  # e.g. 1024
rendered = version.render(document: my_document)

# Send to LLM
llm = Anthropic::Client.new
response = llm.messages(
  model: model,
  max_tokens: max_tokens,
  messages: [{ role: "user", content: rendered }],
)
puts response.dig("content", 0, "text")
```

</TabItem>
</Tabs>

## Next Steps

- [Configuration](./configuration.md) — customize timeouts,
  caching, retries, and more
- [Prompt Management](./prompt-management.md) — fetch by
  label, version, and access metadata
- [Error Handling](./error-handling.md) — handle errors gracefully
