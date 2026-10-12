---
title: GitOps Developer Workspaces
sidebar_label: GitOps Developer Workspaces
sidebar_position: 6
description:
  Develop, test, and deploy new Scout dashboards as code. Push dashboard JSON
  to your GitOps Developer Workspace with the Scout CLI, check it against real
  data, then deploy it through your team's pipeline.
keywords:
  [
    gitops developer workspace,
    dashboards as code,
    test dashboards,
    deploy dashboards,
    scout cli gitops,
    dashboard ci,
  ]
---

# GitOps Developer Workspaces

A GitOps Developer Workspace is a developer tool for building new dashboards.
It gives you a test folder in your account's Scout, wired to the same data as
your production dashboards. You write dashboard JSON in Git, push it to the
workspace with the Scout CLI, check it against live data, and iterate. When
it is ready, you deploy it through your team's pipeline.

The workflow has three steps:

1. **Develop**: write or export dashboard JSON in your repository.
2. **Test**: push it to your workspace and check it in Scout.
3. **Deploy**: open a pull request to your team's dashboards repository; its
   pipeline applies the dashboard.

Workspace dashboards change only through pushes. You can view them in Scout
but not edit them there, so the JSON in your repository stays the source of
truth for what you deploy.

## How it works

| Piece | What it is |
| --- | --- |
| Workspace folder | `gitops-workspaces/<username>-dev` in your account's Scout |
| Username | The part of your email before `@`, lowercased, with other characters turned into `-`. `jane.doe@acme.com` becomes `jane-doe` |
| Identity | `gitops-<username>`. Pushes show up under this name in Scout |
| Workspace token | A credential that can write to your workspace folder and nowhere else. It lasts 180 days |

Your account admin enables the workspace for you. Everything after that is
self-service from the Scout CLI.

## Before you start

- Your account admin has enabled a GitOps Developer Workspace for you.
- [Scout CLI](../scout-cli/installation.md) 0.14.0 or later is installed.
- You are logged in to your account:

  ```bash
  scout login --account <your-account>
  ```

Check your workspace:

```bash
scout gitops status
```

```text
Username:  jane-doe
Folder:    gitops-workspaces/jane-doe-dev
URL:       https://<your-scout>/dashboards/f/sf-1a2b3c4d
Identity:  gitops-jane-doe
Client:    acme-gitops-jane-doe
Status:    active
Token:     none cached (push or pull mints one)
```

`Status` must be `active`. If the command prints `No GitOps Workspace`, ask
your account admin to enable a developer workspace for you.

If `URL` shows `(no Grafana URL; set SCOUT_GRAFANA_URL to push)`, set
`SCOUT_GRAFANA_URL` to the address you open Scout dashboards at before running
`push` or `pull`:

```bash
export SCOUT_GRAFANA_URL=https://<your-scout>
```

## Develop a dashboard

A dashboard file is Grafana dashboard JSON. Either the bare dashboard model or
Grafana's export format (`{"dashboard": {...}, "meta": {...}}`) works, so you
can start from **Export > Export as JSON** on any existing dashboard.

Every dashboard needs two fields:

- `uid`: a stable identifier you choose. It is what makes the next push update
  the dashboard instead of creating a second copy.
- `title`: the name shown in Scout.

```json showLineNumbers title="dashboards/checkout-latency.json"
{
  "uid": "checkout-latency",
  "title": "Checkout latency",
  "schemaVersion": 39,
  "panels": []
}
```

Any `id` field is dropped on push, so dashboards exported from another Scout
or Grafana instance push cleanly. The folder is always set to your workspace,
whatever the file says.

To generate dashboards instead of writing JSON by hand, use
[scout-jsonnet-libs](https://github.com/base-14/scout-jsonnet-libs).
[Build Dashboards and Alerts with Jsonnet](./dashboards-as-code-jsonnet.md)
walks through a complete repository that renders into your workspace and
deploys from CI.

## Test: push to your workspace

Push one file, several files, or a directory of `*.json` files:

```bash
scout gitops push dashboards/
```

```text
Minted a workspace token (expires 2027-04-10 01:29 UTC); later runs reuse it.
dashboards/checkout-latency.json -> checkout-latency (success)
Pushed 1 dashboard(s) into gitops-workspaces/jane-doe-dev.
```

Open the URL from `scout gitops status` and check the dashboard against live
data: queries, variables, panel layout. Change the JSON and push again; the
same `uid` updates the same dashboard.

Every file is checked before anything is sent. The push stops without changing
anything if:

- A file has no `uid` or no `title`.
- Two files use the same `uid`.
- A file is a symlink. Pass the file itself instead.

Directories are read one level deep.

## Pull back to files

Pull writes your workspace's dashboards to files, by default into
`./dashboards`:

```bash
scout gitops pull
scout gitops pull --dir path/to/dashboards
```

```text
dashboards/checkout-latency.json <- checkout-latency
Pulled 1 dashboard(s) from gitops-workspaces/jane-doe-dev.
```

Files are named after the dashboard title. If two titles produce the same
name, the `uid` is added to tell them apart. Pull leaves out the
server-managed `id` and `version` fields, so pulling twice gives the same
files and a push followed by a pull shows no changes in Git.

Pull overwrites files of the same name in the target directory. Commit or
stash local edits before pulling.

## Tokens

### You rarely need to handle them

The first `push` or `pull` mints a workspace token and caches it in your
operating system's keychain. Later runs reuse it until a day before it
expires, then mint a fresh one. On machines without a keychain, such as CI
runners and some SSH sessions, the cache is
`~/.scout/gitops-tokens.json`, readable only by you.

### Mint one for another tool

To call the Scout dashboard API from a script or another tool, mint a token
explicitly:

```bash
scout gitops token > ~/.config/scout-gitops.token
```

The token is printed once on standard output, and everything else goes to
standard error, so redirecting it captures only the token. It is sent as
`Authorization: Bearer <token>` and has the same rights as a push: read
access to your account's Scout, write access to your workspace folder.

Each `scout gitops token` mints a new token, so mint once and keep it rather
than minting on every run.

### Use a token without logging in

With both variables set, `push` and `pull` skip `scout login` entirely and
write to the folder the token can edit:

```bash
export SCOUT_GITOPS_TOKEN=$(cat ~/.config/scout-gitops.token)
export SCOUT_GRAFANA_URL=https://<your-scout>
scout gitops push dashboards/
```

### List and revoke

```bash
scout gitops tokens
```

```text
ISSUANCE                               STATUS   ISSUED                 EXPIRES
dde6efd1-8cb1-4f0f-adf7-bbde89528651   ACTIVE   2026-10-12T01:29:53Z   2027-04-10T01:29:53Z   (cached)
ff41d617-0fa6-414a-81ea-10648a4bdbbb   REVOKED  2026-10-11T15:13:47Z   2027-04-09T15:13:47Z
```

Revoke one by its issuance id:

```bash
scout gitops revoke dde6efd1-8cb1-4f0f-adf7-bbde89528651
```

:::warning[Revoking does not stop a token immediately]

Revoking marks the token as revoked, but Scout keeps accepting it until it
expires. If a token may have leaked, ask your account admin to disable your
workspace. That removes write access for every one of your workspace tokens
at once. Your folder and its dashboards are kept, and the admin can enable
the workspace again afterwards.

:::

Keep tokens in a password manager or secret store, never in Git, chat, or
tickets.

## Deploy a tested dashboard

The workspace is where dashboards are tested, not where they live. Deployed
dashboards belong in your account's dashboards repository, applied by its
pipeline.

A workspace token is the wrong credential for that pipeline. It belongs to
you, can only write to your own workspace, and stops working if you leave or
your workspace is disabled.

To deploy a dashboard you have tested:

1. Copy its JSON file into your team's dashboards repository. Keep the `uid`
   if the dashboard is new; reuse the existing `uid` if it replaces one.
2. Open a pull request. The pipeline deploys it after review.

The pipeline authenticates with your account's GitOps CI token, which your
account admin creates in the console and stores as a CI secret. It applies
dashboards with a tool such as gcx; see
[Dashboards as Code with gcx](./dashboards-as-code-gcx.md) for pipeline
examples. CI tokens last 90 days, so the admin rotates them: mint a new one,
update the pipeline secret, then revoke the old one.

## What a workspace does not cover

- Alert rules, contact points, and notification policies. The workspace holds
  dashboards only.
- Subfolders. Dashboards go directly into your workspace folder.
- Sharing write access. Each workspace has one owner.

## When you leave or lose access

When your account admin disables your user, or your identity provider
removes you, your workspace is disabled automatically: its write access is
removed and its tokens are marked revoked. The folder and dashboards stay in
Scout, so nothing your team may have looked at disappears.

## Troubleshooting

| Message | Cause | Fix |
| --- | --- | --- |
| `No GitOps Workspace. Ask an account admin to enable one for you in console.` | No workspace exists for you | Ask your account admin |
| `Workspace is disabled — ask an account admin to re-enable it.` | Your admin disabled the workspace | Ask your account admin to enable it again |
| `No Grafana URL for this workspace.` | Your account has no Scout URL on record | Set `SCOUT_GRAFANA_URL` |
| `Grafana URL must use https` | `SCOUT_GRAFANA_URL` starts with `http://` | Use the `https://` address |
| `... has no "uid"` | A dashboard file lacks a `uid` | Add a stable `uid` |
| `... both use uid "x"` | Two files share a `uid` | Give each dashboard its own `uid` |
| `The cached workspace token was rejected and has been cleared.` | The cached token expired or was cut off | Run the command again to mint a new one |
| `SCOUT_GITOPS_TOKEN was rejected` | The token in the variable expired, or belongs to another Scout | Mint a new one with `scout gitops token` |
| `Not authenticated. Run scout login --account <account>.` | Your CLI session expired | Log in again |
| `dashboard push failed (403 Forbidden): Access denied to save dashboard` | The `uid` belongs to a dashboard in another folder, or your workspace was disabled | Use a `uid` unique to your workspace; if that is not it, ask your account admin |
| macOS asks whether `scout` may use the keychain | First run of a new Scout CLI version | Choose **Always Allow** |

## FAQ

### Who can see the dashboards in my workspace?

You and your account's Scout admins. Other members of your account do not see
the folder. Only pushes made with your workspace tokens change it; Scout
admins can also edit it, like any folder.

### Can I edit a workspace dashboard in the Scout UI?

You can open and explore it, but you cannot save changes in the browser. To
start from what you see, use **Export > Export as JSON**, edit the file, and
push it.

### Does pushing overwrite dashboards outside my workspace?

No. A push always targets your workspace folder, and a workspace token cannot
write anywhere else. A file whose `uid` matches a dashboard in another folder
is rejected with `403 Access denied to save dashboard`, and that dashboard is
left untouched. Choose `uid` values that are unique to your workspace.

### Why does my push create a new dashboard every time?

The file has no `uid`, or the `uid` changes between pushes. Scout matches
dashboards by `uid`, so give each dashboard a fixed one. The CLI refuses files
without a `uid` for this reason.

### How long do workspace tokens last?

A workspace token lasts 180 days. The CLI renews its cached token
automatically a day before expiry; tokens you minted yourself with
`scout gitops token` need to be replaced by hand.

## Related Guides

- [Build Dashboards and Alerts with Jsonnet](./dashboards-as-code-jsonnet.md) -
  Generate dashboards, test them here, and deploy them from CI
- [Dashboards as Code with gcx](./dashboards-as-code-gcx.md) - Apply shared
  dashboards from a pipeline
- [scout gitops](../scout-cli/scout-access/gitops.md) - Command reference
- [Create Dashboards](../guides/create-your-first-dashboard.md) - Build
  dashboards in the Scout UI
