---
title: scout context
sidebar_label: context
sidebar_position: 4
description:
  Manage multiple Scout account contexts. Switch between organizations, view
  context details, and switch regions.
keywords:
  - scout context
  - account management
  - scout cli accounts
  - multi-account
  - switch organization
  - scout cli regions
---

# scout context

Manage authentication contexts when working with multiple Scout organizations.
Each context stores an account name, authentication endpoint, Scout API URL and
regions.

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
| `regions` | List the account's regions and their API URLs |
| `set-region [NAME]` | Set the active region |

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
slug, API URL and region.

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

## scout context regions

List the regions of the current account. The active region is marked with `*`.

```bash
scout context regions
```

## scout context set-region

Switch to a different region of the current account. Prompts for one when no
name is given.

```bash
scout context set-region [NAME]
```

**Arguments:**

| Argument | Type | Description |
|----------|------|-------------|
| `NAME` | string | Region name to activate |

**Example:**

```bash
scout context set-region eu
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
