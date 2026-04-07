---
title: scout logout
sidebar_label: logout
sidebar_position: 2
description:
  Remove stored Scout credentials for one or all accounts. Optionally revokes
  the Keycloak session.
keywords:
  - scout logout
  - remove credentials
  - scout cli logout
  - revoke session
---

# scout logout

Remove stored credentials for a specific account or all accounts. If a Keycloak
session is active, the command attempts to revoke it.

![scout logout demo](/img/scout-cli/11-logout.gif)

## Usage

```bash
scout logout [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-a, --account` | string | — | Log out a specific account |
| `--all` | bool | `false` | Log out of all accounts |
| `--raw` | bool | `false` | Output JSON |

## Examples

Log out of a specific account:

```bash
scout logout --account my-org
```

Log out of all accounts:

```bash
scout logout --all
```

Output result as JSON:

```bash
scout logout --account my-org --raw
```

:::note
If you omit both `--account` and `--all` and multiple sessions exist, the
command prompts you to select an account interactively.
:::

## Behavior

- Removes credentials from the system keychain (or `~/.scout/credentials.json`)
- Attempts Keycloak session revocation (best-effort — succeeds even if the
  server is unreachable)
- Keeps profile configuration intact so you can re-authenticate later
- Shows remaining available sessions after logout

## See Also

- [login](./login.md) — authenticate with Scout
- [status](./status.md) — check authentication status
- [context](./context.md) — manage account contexts
