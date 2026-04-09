---
title: scout context
sidebar_label: context
sidebar_position: 4
description:
  Manage multiple Scout account contexts. Switch between organizations, view
  context details, and configure API endpoints.
keywords:
  - scout context
  - account management
  - scout cli accounts
  - multi-account
  - switch organization
---

# scout context

Manage authentication contexts when working with multiple Scout organizations.
Each context stores an account name, authentication endpoint, and Scout API URL.

![scout context demo](/img/scout-cli/03-context.gif)

## Usage

```bash
scout context <SUBCOMMAND>
```

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `list` | List all configured contexts |
| `set <NAME>` | Set the active context |
| `show` | Display details of the current context |
| `delete <NAME>` | Delete a context and its credentials |
| `set-api-url <URL>` | Set the Scout API URL for a context |

## scout context list

List all configured contexts. The active context is marked with `*`.

```bash
scout context list
```

## scout context set

Switch to a different account context.

```bash
scout context set <NAME>
```

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `NAME` | string | Context name to activate |

**Example:**

```bash
scout context set staging-org
```

## scout context show

Display details of the current active context, including name, endpoint, account
slug, and API URL.

```bash
scout context show
```

## scout context delete

Delete a context and remove its stored credentials.

```bash
scout context delete <NAME>
```

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `NAME` | string | Context name to delete |

**Example:**

```bash
scout context delete old-org
```

## scout context set-api-url

Override the Scout API URL for a context. Useful when connecting to a
self-hosted Scout instance.

```bash
scout context set-api-url <URL>
```

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `URL` | string | Scout API endpoint URL |

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-a, --account` | string | active context | Target a specific context instead of the active one |

**Example:**

```bash
scout context set-api-url https://scout-api.internal.example.com
```

## Example Workflow

Set up multiple organizations and switch between them:

```bash
# Authenticate with two organizations
scout login --account prod-org
scout login --account staging-org

# List contexts
scout context list

# Switch to staging
scout context set staging-org

# Verify
scout context show
```

## See Also

- [login](./login.md) — authenticate with Scout
- [status](./status.md) — check authentication status
- [Global Flags](../reference/global-flags.md) — use `-a` to override context
  per-command
