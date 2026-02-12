---
title: Integration Examples
sidebar_position: 11
description: Examples of integrating Scope with OpenAI, Anthropic, LangChain, and Express.js.
keywords: [scope openai, scope anthropic, scope langchain, llm integration, scope express]
---

# Integration Examples

This page shows how to integrate Scope with popular LLM providers and
frameworks. Each example fetches a managed prompt from Scope and sends it to an
LLM.

## OpenAI (Python)

```python
from openai import OpenAI
from scope_client import ScopeClient, ApiKeyCredentials

# Set up clients
credentials = ApiKeyCredentials.from_env()
scope = ScopeClient(credentials=credentials)
openai = OpenAI()

# Fetch and render the prompt
version = scope.get_prompt_version("code-review")
rendered = version.render(
    language="Python",
    code="def add(a, b): return a + b"
)

# Send to OpenAI
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a code reviewer."},
        {"role": "user", "content": rendered}
    ]
)

print(response.choices[0].message.content)
```

## OpenAI (Ruby)

```ruby
require "scope_client"
require "openai"

# Set up clients
credentials = ScopeClient::Credentials::ApiKey.from_env
scope = ScopeClient::Client.new(credentials: credentials)
openai = OpenAI::Client.new

# Fetch and render the prompt
version = scope.get_prompt_version("code-review")
rendered = version.render(
  language: "Ruby",
  code: "def add(a, b) = a + b"
)

# Send to OpenAI
response = openai.chat(
  parameters: {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a code reviewer." },
      { role: "user", content: rendered }
    ]
  }
)

puts response.dig("choices", 0, "message", "content")
```

## Anthropic (Python)

```python
from anthropic import Anthropic
from scope_client import ScopeClient, ApiKeyCredentials

# Set up clients
credentials = ApiKeyCredentials.from_env()
scope = ScopeClient(credentials=credentials)
anthropic = Anthropic()

# Fetch and render the prompt
version = scope.get_prompt_version("summarizer")
rendered = version.render(
    document_type="research paper",
    content="...",
    audience="engineering team"
)

# Send to Anthropic
response = anthropic.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[{"role": "user", "content": rendered}]
)

print(response.content[0].text)
```

## Anthropic (Ruby)

```ruby
require "scope_client"
require "anthropic"

# Set up clients
credentials = ScopeClient::Credentials::ApiKey.from_env
scope = ScopeClient::Client.new(credentials: credentials)
anthropic = Anthropic::Client.new

# Fetch and render the prompt
version = scope.get_prompt_version("summarizer")
rendered = version.render(
  document_type: "research paper",
  content: "...",
  audience: "engineering team"
)

# Send to Anthropic
response = anthropic.messages.create(
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 1024,
  messages: [{ role: "user", content: rendered }]
)

puts response.content.first.text
```

## LangChain (Python)

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from scope_client import ScopeClient, ApiKeyCredentials

# Set up Scope client
credentials = ApiKeyCredentials.from_env()
scope = ScopeClient(credentials=credentials)

# Fetch and render the prompt
version = scope.get_prompt_version("qa-assistant")
rendered = version.render(
    context="Scope is an LLM engineering platform for prompt management.",
    question="What is Scope used for?"
)

# Use with LangChain
llm = ChatOpenAI(model="gpt-4o")
messages = [
    SystemMessage(content="Answer questions based on the provided context."),
    HumanMessage(content=rendered)
]

response = llm.invoke(messages)
print(response.content)
```

### Dynamic Prompt Switching

Use Scope to swap prompts without redeploying:

```python
# Your application always fetches the production version
# When you promote a new version in Scope, the next fetch picks it up
version = scope.get_prompt_version("qa-assistant", label="production")

# In staging, test the latest draft
version = scope.get_prompt_version("qa-assistant", label="latest")
```

## Express.js (Conceptual)

While the Node.js SDK is coming soon, you can use the Scope REST API directly:

```javascript
const express = require("express");
const app = express();

// Fetch prompt from Scope API
async function getPrompt(name) {
  const response = await fetch(
    `${process.env.SCOPE_API_URL}/prompts/${name}/production`,
    {
      headers: {
        Authorization: `Bearer ${await getToken()}`,
      },
    }
  );
  return response.json();
}

// Simple variable rendering
function render(content, variables) {
  return content.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => variables[key] ?? `{{${key}}}`
  );
}

app.post("/chat", async (req, res) => {
  const prompt = await getPrompt("chat-assistant");
  const rendered = render(prompt.content, {
    user_message: req.body.message,
  });

  // Send to your LLM provider...
  res.json({ rendered });
});

app.listen(3000);
```

:::info
The Node.js SDK is coming soon and will provide the same ergonomic API as the
Python and Ruby SDKs, including caching, authentication, and error handling.
:::

## Best Practices

- **Cache prompts** — the SDK caches by default (300s TTL). For high-traffic
  endpoints, this avoids an API call on every request
- **Handle errors gracefully** — always catch `NotFoundError` and
  `NoProductionVersionError` to avoid crashes when a prompt hasn't been promoted
  yet
- **Use labels** — fetch `label="production"` for production workloads and
  `label="latest"` for development
- **Separate credentials** — use different Scope API keys for each environment
- **Log telemetry** — enable telemetry hooks to track prompt fetch latency
  alongside your application metrics

## Next Steps

- [Python SDK Reference](./python.md) — complete method signatures and examples
- [Ruby SDK Reference](./ruby.md) — complete method signatures and examples
- [Configuration](./configuration.md) — all client options and environment variables
- [Error Handling](./error-handling.md) — error hierarchy and recovery patterns
