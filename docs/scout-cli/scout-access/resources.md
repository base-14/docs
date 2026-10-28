---
title: scout resources
sidebar_label: resources
sidebar_position: 11
description:
  Pull Scout dashboards and alert rules into a local tree and push them back.
  Keep them in Git, review changes as code, and manage the tokens that write
  them.
keywords:
  - scout resources
  - dashboards as code
  - alert rules as code
  - scout cli dashboards
  - gitops workspace
  - workspace token
---

# scout resources

Pull the dashboards and alert rules you can read into a local directory tree,
edit them in Git, and push them back. The tree mirrors Scout's folder
structure, so a file's location decides which folder it belongs to.

What you can read and write is whatever your token allows. With a personal
workspace token that is your own workspace folder; with a broader token it can
be the whole account.

Requires Scout CLI 0.14.0 or later. `scout gitops` still works as an alias.

## Usage

```bash
scout resources <subcommand> [flags]
```

| Subcommand | Description |
|------------|-------------|
| `pull [path]` | Write folders, dashboards, and alert rules into a local tree |
| `push [paths]...` | Push files back to the folders they came from |
| `status` | Show your workspace folder, link, identity, status, and cached token |
| `token` | Mint a workspace token and print it once |
| `tokens` | List the tokens minted for your workspace |
| `revoke <issuance-id>` | Mark one of your workspace tokens revoked |

## The tree

`pull` mirrors Scout's folder tree. Every directory gets a `_folder.json`
naming the folder it stands for, which is how `push` knows where to send each
file back to. A folder's alert rules go in its `alerts/` directory:

```text
resources/
  _folder.json              # General, when it holds dashboards
  home.json
  team-a/
    _folder.json            # {"uid": "...", "title": "Team A"}
    payments/
      _folder.json
      checkout.json
      alerts/
        high-latency.json
```

A dashboard with no `_folder.json` beside it goes to your workspace folder.

## pull

```bash
scout resources pull [path] [flags]
```

| Argument | Description |
|----------|-------------|
| `path` | Pull only this folder and its subfolders, as a path in the tree, such as `team-a/payments` |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--uid` | string | — | Pull only the dashboard or alert rule with this uid |
| `--dir` | path | `resources` | Directory to write the tree into |
| `--only` | enum | all | Limit to `dashboards` or `alerts` |

The server-managed `id` and `version` fields are dropped, so pulled files
diff cleanly against what you push back.

When your token has no alerting access, alert rules are skipped with a
warning — unless you asked for `--only alerts`, which then fails rather than
silently returning nothing.

## push

```bash
scout resources push [paths]... [flags]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `paths` | `resources` | JSON files, or directories of them, walked recursively |

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--only` | enum | all | Limit to `dashboards` or `alerts` |

Every dashboard and alert rule needs a `uid` and a `title`. The `uid` is what
makes a second push update a resource rather than create another one. Alert
rules also need a `ruleGroup`.

Push overwrites whatever holds that uid, so pull before you edit. Pushed
alert rules stay editable in the Scout UI.

Dashboard files may hold a bare dashboard or Grafana's export format, so you
can start from **Export > Export as JSON** on any existing dashboard.

## status

```bash
scout resources status [--raw]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--raw` | bool | `false` | Output JSON. Prints `{"workspace": null}` when you have no workspace |

## token

```bash
scout resources token
```

Mints a 180-day workspace token. The token alone goes to standard output and
everything else to standard error, so it can be redirected into a file. Each
call mints a new token; `push` and `pull` reuse the cached one.

## tokens

```bash
scout resources tokens [--raw]
```

Lists each token's issuance id, status (`ACTIVE`, `REVOKED`, or `EXPIRED`),
and issue and expiry times. The cached token is marked `(cached)`.

## revoke

```bash
scout resources revoke <issuance-id>
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

Cached tokens are kept in your keychain, or in `~/.scout/gitops-tokens.json`
with mode `0600`.

With both `SCOUT_GITOPS_TOKEN` and `SCOUT_GRAFANA_URL` set, `push` and `pull`
need no `scout login`; they act on whatever the token can reach.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SCOUT_GITOPS_TOKEN` | Token for `push` and `pull`. A broader token than your workspace's widens what they reach |
| `SCOUT_GRAFANA_URL` | Scout dashboard address, when `status` shows no URL or for login-free use. Must be `https` |

## Examples

Pull everything you can read:

```bash
scout resources pull
```

Pull one folder, or one resource:

```bash
scout resources pull team-a/payments
scout resources pull --uid cdx7f2k9
```

Push the whole tree back, or part of it:

```bash
scout resources push
scout resources push resources/team-a
scout resources push resources/team-a/payments/checkout.json
```

Work on alert rules alone:

```bash
scout resources pull --only alerts
scout resources push --only alerts
```

Mint a token for another tool that sends `Authorization: Bearer`, such as
[gcx](https://github.com/grafana/gcx):

```bash
scout resources token > ~/.config/scout-gitops.token
```

## See also

- [GitOps Developer Workspaces](../../operate/gitops-workspaces.md), for the
  develop, test, and deploy workflow
