---
title: scout login
sidebar_label: login
sidebar_position: 1
description:
  Authenticate with the Scout platform using OAuth2. Opens a browser for
  PKCE authentication and stores credentials locally.
keywords:
  - scout login
  - scout authentication
  - oauth2 pkce
  - scout cli auth
---

# scout login

Authenticate with the Scout platform using an OAuth2 authorization code flow
with PKCE. The command opens your browser to complete authentication, then stores
tokens locally for subsequent commands.

![scout login demo](/img/scout-cli/01-login.gif)

## Usage

```bash
scout login --account <SLUG> [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-a, --account` | string | *(required)* | Account slug. Env: `SCOUT_ACCOUNT_SLUG` |
| `--auth-url` | string | `https://id.base14.io` | Authentication server URL. Env: `SCOUT_AUTH_URL` |
| `--force` | bool | `false` | Re-authenticate even if a valid session exists |

## Examples

Authenticate with your organization:

```bash
scout login --account my-org
```

Force re-authentication to refresh tokens:

```bash
scout login --account my-org --force
```

Use a custom authentication server:

```bash
scout login --account my-org --auth-url https://auth.example.com
```

Use environment variables instead of flags:

```bash
export SCOUT_ACCOUNT_SLUG=my-org
scout login
```

## How It Works

1. Validates the account exists on the authentication server
2. Starts a local HTTP listener for the OAuth2 callback
3. Opens your browser to the authorization URL
4. Exchanges the authorization code for access and refresh tokens
5. Discovers the Scout API URL via the accounts API
6. Stores tokens in your system keychain (falls back to
   `~/.scout/credentials.json` with mode `0600`)

:::note
The login flow has a 5-minute timeout. If you don't complete browser
authentication within that window, the command will exit.
:::

:::tip
If the browser doesn't open automatically, the command prints a URL you can copy
and paste manually.
:::

## See Also

- [logout](./logout.md) — remove stored credentials
- [status](./status.md) — check authentication status
- [context](./context.md) — manage multiple account contexts
