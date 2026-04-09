---
title: Global Flags
sidebar_label: Global Flags
sidebar_position: 2
description:
  Global flags available on every Scout CLI command. Enable verbose logging or
  override the active account context.
keywords:
  - scout cli flags
  - scout verbose
  - scout account flag
  - scout global options
---

# Global Flags

These flags are available on every Scout CLI command.

## Flags

| Flag | Type | Description |
|------|------|-------------|
| `-v, --verbose` | bool | Enable verbose debug logging to stderr. Useful for troubleshooting authentication, API requests, and config parsing |
| `-a, --account <NAME>` | string | Override the active account context for this command. Equivalent to running `scout context set <NAME>` temporarily |

## Examples

Enable verbose logging to debug a failing query:

```bash
scout -v logs payment-service --since 5m
```

Run a command against a different account without switching context:

```bash
scout -a staging-org alerts --since 1h
```

Combine both flags:

```bash
scout -v -a prod-org traces payment-service --status Error
```

:::tip
Verbose output is written to stderr, so you can still pipe or redirect the
command's normal output:

```bash
scout -v logs payment-service --raw 2>debug.log | jq .
```

:::

## See Also

- [Environment Variables](./environment-variables.md) — configure Scout CLI
  via environment
- [context](../scout-access/context.md) — manage account contexts persistently
