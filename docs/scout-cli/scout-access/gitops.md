---
title: scout gitops
sidebar_label: gitops
sidebar_position: 11
description:
  Manage your GitOps Developer Workspace from the Scout CLI. Check its status, push and
  pull dashboard JSON, and mint, list, and revoke workspace tokens.
keywords:
  - scout gitops
  - gitops developer workspace
  - dashboards as code
  - scout cli dashboards
  - workspace token
---

# scout gitops

Develop and test new dashboards in your GitOps Developer Workspace, a test
folder in your account's Scout that changes only through pushes. Every
subcommand acts on the logged-in user's workspace. Your account admin enables
the workspace; see [GitOps Developer Workspaces](../../operate/gitops-workspaces.md)
for the develop, test, and deploy workflow.

Requires Scout CLI 0.14.0 or later.

## Usage

```bash
scout gitops <subcommand> [flags]
```

| Subcommand | Description |
|------------|-------------|
| `status` | Show your workspace folder, link, identity, status, and cached token |
| `push <paths>...` | Push dashboard JSON files, or directories of them, into your workspace |
| `pull` | Write your workspace's dashboards to JSON files |
| `token` | Mint a workspace token and print it once |
| `tokens` | List the tokens minted for your workspace |
| `revoke <issuance-id>` | Mark one of your workspace tokens revoked |

## status

```bash
scout gitops status [--raw]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--raw` | bool | `false` | Output JSON. Prints `{"workspace": null}` when you have no workspace |

## push

```bash
scout gitops push <paths>...
```

Each path is a dashboard JSON file or a directory, read one level deep for
`*.json` files. Files may hold a bare dashboard or Grafana's export format.
Every dashboard needs a `uid` and a `title`, and no two files may share a
`uid`. All files are checked before anything is pushed. Symlinks are refused.

## pull

```bash
scout gitops pull [--dir <dir>]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir` | path | `dashboards` | Directory to write dashboards into. Files of the same name are overwritten |

Files are named after the dashboard title, with the `uid` added when two
titles collide. The server-managed `id` and `version` fields are left out.

## token

```bash
scout gitops token
```

Mints a 180-day workspace token. The token alone goes to standard output and
everything else to standard error, so it can be redirected into a file. Each
call mints a new token; `push` and `pull` reuse the cached one.

## tokens

```bash
scout gitops tokens [--raw]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--raw` | bool | `false` | Output JSON |

Lists each token's issuance id, status (`ACTIVE`, `REVOKED`, or `EXPIRED`),
and issue and expiry times. The cached token is marked `(cached)`.

## revoke

```bash
scout gitops revoke <issuance-id>
```

Revokes one of your own workspace's tokens. Revoking records the token as
revoked, but Scout accepts it until it expires. To cut off every workspace
token at once, ask your account admin to disable the workspace.

## Token resolution

`push` and `pull` choose a token in this order:

1. `SCOUT_GITOPS_TOKEN`, if set.
2. The cached token, if it belongs to this workspace and has more than a day
   left.
3. A newly minted token, which is then cached.

With both `SCOUT_GITOPS_TOKEN` and `SCOUT_GRAFANA_URL` set, `push` and `pull`
need no `scout login`; they write to the folder the token can edit.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SCOUT_GITOPS_TOKEN` | Workspace token for `push` and `pull` |
| `SCOUT_GRAFANA_URL` | Scout dashboard address, when `status` shows no URL or for login-free use. Must be `https` |

## Examples

Check your workspace:

```bash
scout gitops status
```

Push a directory of dashboards:

```bash
scout gitops push dashboards/
```

Pull into a specific directory:

```bash
scout gitops pull --dir dashboards
```

Mint a token for a script, then push without logging in:

```bash
scout gitops token > ~/.config/scout-gitops.token
SCOUT_GITOPS_TOKEN=$(cat ~/.config/scout-gitops.token) \
SCOUT_GRAFANA_URL=https://<your-scout> \
  scout gitops push dashboards/
```

List tokens as JSON:

```bash
scout gitops tokens --raw
```
