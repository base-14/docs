---
title: Using Prompt Variables
sidebar_position: 4
description: How to use template variables in Scope prompts — syntax, auto-detection, and SDK rendering.
keywords: [prompt variables, template variables, prompt rendering, variable substitution]
---

# Using Prompt Variables

Variables make your prompts dynamic. Instead of hardcoding values, you use
placeholders that get replaced at runtime with actual data. This guide covers
the variable syntax, how Scope detects variables, and how to render them with
the SDK.

## Variable Syntax

Scope uses **double-brace** syntax for variables:

```text
Hello, {{name}}! Welcome to {{app_name}}.
```

Variable naming rules:

- Alphanumeric characters and underscores only
- Case-sensitive (`{{Name}}` and `{{name}}` are different variables)
- No spaces inside the braces

## Auto-Detection

When you save a prompt version, Scope automatically scans the content and
extracts all `{{variable}}` placeholders. The detected variables appear in the
version's metadata and are used to:

- Pre-populate the test panel with input fields
- Validate that all required variables are provided at render time
- Display variable names in the version detail view

You don't need to declare variables separately — just use them in your content.

## Rendering with the SDK

The SDK's `render()` method substitutes variables with the values you provide:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
version = client.get_prompt_version("greeting")
# version.content: "Hello, {{name}}! Welcome to {{app_name}}."
# version.variables: ["name", "app_name"]

rendered = version.render(name="Alice", app_name="Scope")
# "Hello, Alice! Welcome to Scope."
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
version = client.get_prompt_version("greeting")
# version.content: "Hello, {{name}}! Welcome to {{app_name}}."
# version.variables: ["name", "app_name"]

rendered = version.render(name: "Alice", app_name: "Scope")
# "Hello, Alice! Welcome to Scope."
```

</TabItem>
</Tabs>

### Shorthand Method

You can fetch and render in a single call using `render_prompt`:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
rendered = client.render_prompt(
    "greeting",
    {"name": "Alice", "app_name": "Scope"},
    label="production"
)
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
rendered = client.render_prompt(
  "greeting",
  { name: "Alice", app_name: "Scope" },
  label: "production"
)
```

</TabItem>
</Tabs>

## Missing Variables

If you call `render()` without providing all required variables, the SDK raises
a `MissingVariableError`:

<Tabs groupId="sdk-language">
<TabItem value="python" label="Python" default>

```python
from scope_client.errors import MissingVariableError

try:
    rendered = version.render(name="Alice")
    # Missing: app_name
except MissingVariableError as e:
    print(f"Missing variables: {e.missing_variables}")
```

</TabItem>
<TabItem value="ruby" label="Ruby">

```ruby
begin
  rendered = version.render(name: "Alice")
  # Missing: app_name
rescue ScopeClient::MissingVariableError => e
  puts "Missing variables: #{e.missing_variables}"
end
```

</TabItem>
</Tabs>

## Variables in the Test Panel

When testing a prompt in the UI:

1. Open a prompt version and click **Test**
2. Scope displays an input field for each detected variable
3. Fill in values for all variables
4. Click **Run** to execute the prompt with those values

The test panel also shows the **resolved content** (the prompt after variable
substitution) alongside the LLM response.

## Best Practices

- **Use descriptive names** — `{{customer_email}}` is clearer than `{{e}}`
- **Keep variable count manageable** — prompts with many variables are harder to
  test and maintain
- **Document expected formats** — if a variable expects a specific format (e.g.,
  JSON, date), note it in the prompt description
- **Use consistent naming conventions** — stick to `snake_case` across all
  prompts

## Next Steps

- [Testing Prompts](./testing-prompts.md) — test prompts with variable values
- [SDK Prompt Management](../sdk/prompt-management.md)
  — rendering, metadata, and properties
- [SDK Error Handling](../sdk/error-handling.md) — handling missing variable errors
