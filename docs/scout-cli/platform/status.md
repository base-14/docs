---
title: scout status
sidebar_label: status
sidebar_position: 3
description:
  Display login status and token validity for all configured Scout accounts.
  Optionally verify tokens with a live API call.
keywords:
  - scout status
  - scout auth status
  - scout session
  - token validation
---

# scout status

Display the authentication status for all configured accounts, including user
email and token expiration. The active account is highlighted.

![scout status demo](/img/scout-cli/02-status.gif)

## Usage

```bash
scout status [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--raw` | bool | `false` | Output JSON |
| `--check` | bool | `false` | Verify the active token with a live API call to the auth server userinfo endpoint |

## Examples

Check local token status:

```bash
scout status
```

Verify the active token is still valid on the server:

```bash
scout status --check
```

Get status as JSON (useful for scripts):

```bash
scout status --raw
```

## Output

The command lists all configured accounts with:

- Account name
- User email (extracted from the JWT)
- Token expiration time
- Whether the token is expired

The active context is marked with a `*` prefix.

:::tip
Use `--check` to verify the token is still valid on the server. Without it,
`scout status` only reads local token data and checks the expiration claim — the
token could have been revoked server-side.
:::

## See Also

- [login](./login.md) — authenticate with Scout
- [logout](./logout.md) — remove credentials
- [context](./context.md) — manage account contexts
