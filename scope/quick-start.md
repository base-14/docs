---
title: Quick Start
sidebar_position: 2
description: Get your first prompt running in Scope in under 5 minutes.
keywords: [scope quick start, llm prompt setup, scope getting started]
---

# Quick Start

Get your first prompt running in Scope in under 5 minutes. This guide walks you
through signing in, configuring a provider, creating a prompt, testing it, and
promoting it to production.

## Prerequisites

- A base14 account with access to Scope
- An API key from at least one LLM provider (e.g., OpenAI, Anthropic)

## Step 1: Sign in to Scope

Navigate to your base14 dashboard and open Scope. Scope is available to all
base14 accounts — no additional setup is required.

## Step 2: Configure a Provider

Before you can test prompts, Scope needs credentials for at least one LLM
provider.

1. Go to **Settings > Providers**
2. Click **Add Provider**
3. Select your provider (e.g., OpenAI)
4. Enter your API key
5. Click **Test Connection** to verify the key is valid
6. Save the provider configuration

Once connected, enable the models you want to use (e.g., `gpt-4o`,
`claude-3-opus`).

:::tip
You can configure multiple providers and switch between them when testing
prompts. See [Configure Providers](./platform/configure-providers.md) for details.
:::

## Step 3: Create a Prompt

1. Click **New Prompt** from the prompt list
2. Enter a name (e.g., `greeting`)
3. Add your prompt content:

```text
You are a friendly assistant. Greet the user by name and suggest
a fun activity for them to try today.

User name: {{name}}
Activity preference: {{preference}}
```

Scope automatically detects `{{name}}` and `{{preference}}` as variables.

1. Click **Create** — this creates version `v1` in **draft** status

## Step 4: Test the Prompt

1. Open the prompt you just created
2. Click **Test** to open the test panel
3. Select a provider and model (e.g., OpenAI / `gpt-4o`)
4. Fill in the variable values:
   - `name`: `Alice`
   - `preference`: `outdoor`
5. Click **Run**

The test panel shows the LLM response along with token usage, latency, and
estimated cost. Adjust your prompt and re-run until you're satisfied.

## Step 5: Promote to Production

When the prompt is ready:

1. Click **Promote** on the version you want to deploy
2. Add optional promotion notes (e.g., "Initial release")
3. Confirm the promotion

The version status changes from **draft** to **published**. Any application
using the SDK or API will now receive this version when requesting the
`greeting` prompt.

## Step 6: Fetch from Your Application

Install the Scope SDK and fetch the prompt at runtime:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client import ScopeClient, ApiKeyCredentials

credentials = ApiKeyCredentials.from_env()
client = ScopeClient(credentials=credentials)

version = client.get_prompt_version("greeting")
rendered = version.render(name="Alice", preference="outdoor")
print(rendered)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
require "scope_client"

credentials = ScopeClient::Credentials::ApiKey.from_env
client = ScopeClient::Client.new(credentials: credentials)

version = client.get_prompt_version("greeting")
rendered = version.render(name: "Alice", preference: "outdoor")
puts rendered
```

</TabItem>
</Tabs>

Pass the rendered string to your LLM provider of choice. See the [SDK
Quickstart](./sdk/quickstart.md) for a full end-to-end example.

## Next Steps

- [Core Concepts](./core-concepts.md) — understand
  prompts, versions, variables, and promotion
- [Configure Providers](./platform/configure-providers.md) — add and manage
  LLM providers
- [SDK Installation](./sdk/installation.md) — install the SDK for Python or Ruby
- [API Reference](./api-reference/index.md) — use the REST API directly
