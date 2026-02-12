---
title: Prompt Management
sidebar_position: 5
---

# Prompt Management

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

The core workflow of the SDK is: **fetch a prompt version**
then **render it with variables**.

## Fetching Prompt Versions

### By name (production label)

By default, `get_prompt_version` returns the **production** version:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("greeting")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("greeting")
```

</TabItem>
</Tabs>

### By label

Fetch a specific label — `"production"` (default) or `"latest"`:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
# Latest version (may be a draft)
version = client.get_prompt_version("greeting", label="latest")

# Explicitly request production
version = client.get_prompt_version("greeting", label="production")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
# Latest version (may be a draft)
version = client.get_prompt_version("greeting", label: :latest)

# Explicitly request production
version = client.get_prompt_version("greeting", label: :production)
```

</TabItem>
</Tabs>

### By specific version ID

Pin to an exact version when you need deterministic behavior:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("greeting", version="v_01ABC123")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("greeting", version: "v_01ABC123")
```

</TabItem>
</Tabs>

## Rendering Templates

Prompt content uses `{{variable}}` placeholders. Call `render` to substitute
them:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("greeting")
# version.content => "Hello, {{name}}! Welcome to {{app}}."
# version.variables => ["name", "app"]

rendered = version.render(name="Alice", app="Scope")
# "Hello, Alice! Welcome to Scope."
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("greeting")
# version.content => "Hello, {{name}}! Welcome to {{app}}."
# version.variables => ["name", "app"]

rendered = version.render(name: "Alice", app: "Scope")
# "Hello, Alice! Welcome to Scope."
```

</TabItem>
</Tabs>

### Shorthand with `render_prompt`

Fetch and render in a single call:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
rendered = client.render_prompt(
    "greeting",
    {"name": "Alice", "app": "Scope"},
    label="production",
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
rendered = client.render_prompt(
  "greeting",
  { name: "Alice", app: "Scope" },
  label: :production,
)
```

</TabItem>
</Tabs>

## PromptVersion Properties

After fetching a prompt version, you can inspect the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique version identifier |
| `prompt_id` | string | Parent prompt identifier |
| `version_number` | integer | Sequential version number |
| `content` | string | Prompt content with `{{variable}}` placeholders |
| `variables` | list of strings | Declared variable names |
| `status` | string | `"draft"`, `"published"`, or `"archived"` |
| `is_production` | boolean | Whether this is the production version |
| `type` | string | Prompt type — `"text"` or `"chat"` |
| `metadata` | dict/hash | Arbitrary key-value metadata |
| `created_at` | string | ISO 8601 creation timestamp |
| `updated_at` | string | ISO 8601 last-update timestamp |

## Accessing Metadata

Prompt versions can carry arbitrary metadata (e.g., the model
name, temperature, or max tokens):

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("summarize")

model = version.get_metadata("model")               # "claude-sonnet-4-5-20250514"
temperature = version.get_metadata("temperature", 0.7)  # default if missing
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("summarize")

model = version.get_metadata("model")               # "claude-sonnet-4-5-20250514"
temperature = version.get_metadata("temperature", 0.7)  # default if missing
```

</TabItem>
</Tabs>

## Status Helpers

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version.is_draft       # True if status == "draft"
version.is_published   # True if status == "published"
version.is_archived    # True if status == "archived"
version.is_production  # True if this is the production version
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version.draft?       # true if status == "draft"
version.published?   # true if status == "published"
version.archived?    # true if status == "archived"
version.production?  # alias for published?
```

</TabItem>
</Tabs>
