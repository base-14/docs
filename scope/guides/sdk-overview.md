---
title: SDK Overview
sidebar_position: 3
---

# SDK Overview

The Scope SDK lets you integrate prompt management directly
into your application code. Instead of hardcoding prompts, you
fetch them from the Scope platform at runtime — keeping your
prompts versioned, testable, and decoupled from deployments.

## What the SDK Does

1. **Authenticates** with the Scope API using your
   organization's API key and secret
2. **Fetches prompt versions** by name, label
   (`production` or `latest`), or specific version ID
3. **Renders templates** by substituting `{{variable}}` placeholders with your values
4. **Caches responses** in memory to minimize API calls (default TTL: 300 seconds)

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
| Python | `scope-client` | Generally available |
| Ruby | `scope-client` | Generally available |
| Node.js | `@scope/client` | Coming soon |
| Java/JVM | `io.scope:scope-client` | Coming soon |

## SDK Reference Pages

For detailed documentation on each topic, see the SDK reference section:

- **[SDK Landing Page](../sdk/index.md)** — overview,
  capabilities, and quick example
- **[Installation](../sdk/installation.md)** — install
  the SDK for Python or Ruby
- **[Quickstart](../sdk/quickstart.md)** — end-to-end
  guide from setup to first prompt
- **[Configuration](../sdk/configuration.md)** — environment
  variables, credentials, and client options
- **[Prompt Management](../sdk/prompt-management.md)** —
  fetching, rendering, metadata, and PromptVersion properties
- **[Error Handling](../sdk/error-handling.md)** — error
  hierarchy and recovery patterns
- **[Caching](../sdk/caching.md)** — default behavior,
  per-request control, and disabling
- **[Telemetry](../sdk/telemetry.md)** — hooks for
  logging and observability
