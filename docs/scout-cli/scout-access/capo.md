---
title: scout capo
sidebar_label: capo
sidebar_position: 12
description:
  Inspect and configure your OpenTelemetry Collector fleet from the Scout CLI.
  List collectors, read and assign configurations, roll back, restart, report
  what a change would do, and review changes held for approval.
keywords:
  - scout capo
  - collector fleet
  - opamp
  - collector configuration
  - configuration drift
  - collectors as code
  - collector change approval
---

# scout capo

Inspect and configure the collectors reporting to your account. Every
collector that connects over OpAMP registers itself, reports what it is
running, and can be sent a new configuration.

Commands that only read need the `collectors-read` role; commands that change
a configuration need `collectors-write`; approving or rejecting a held change,
and turning approval on or off, need `collectors-admin`. All three are
available on an API key, so these commands work from a pipeline as well as a
terminal. Signed in as a person, the Admin role can do all three.

Requires Scout CLI 0.14.1 or later for `drift` and `apply`, and 0.21.1 or
later for `--reason`, `changes`, and `approval`.

## Usage

```bash
scout capo agents <subcommand> [flags]
```

| Subcommand | Description |
|------------|-------------|
| `list` | List the collectors reporting to your account |
| `show <id>` | Show one collector's identity, health, and attributes |
| `config <id>` | Print a collector's configuration |
| `set-config <id>` | Assign a configuration to one collector |
| `rollback <id> --hash <hash>` | Re-assign an earlier revision |
| `restart <id>` | Ask a collector to restart |
| `history <id>` | Show a collector's configuration and status history |
| `drift` | Report the configurations running under a selector |
| `apply` | Assign a configuration to everything matching a selector |

```bash
scout capo changes <subcommand> [flags]
scout capo approval get | set --required true|false
```

| Command | Description |
|------------|-------------|
| `changes list` | The audit: every change to your collectors, newest first |
| `changes show <id>` | One change, and what approving it would do now |
| `changes approve <id>` | Approve a held change and apply it |
| `changes reject <id>` | Reject a held change |
| `changes withdraw <id>` | Withdraw a change you requested |
| `approval get` | Whether configuration changes are held for approval |
| `approval set` | Turn holding on or off for the whole account |

## Selectors

`drift` and `apply` act on every collector whose reported attributes match,
rather than on one id:

```bash
--match k8s.cluster.name=prod-eu --match collector.role=daemon
```

Repeat `--match` to narrow. Any attribute a collector reports can be matched.

A selector never names an account. Capo takes that from your token, so a
selector cannot reach past the collectors you already own.

## list

```bash
scout capo agents list [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--search` | string | — | Free-text search over names and attributes |
| `--cluster` | string | — | Filter by cluster name |
| `--environment` | string | — | Filter by environment |
| `--role` | string | — | Filter by role |
| `--healthy` | bool | — | Filter by health |
| `--stale` | bool | `false` | Include disconnected collectors, which are excluded by default |
| `--limit` | int | `200` | Maximum results |
| `--raw` | bool | `false` | Output JSON |

## show

```bash
scout capo agents show <id> [--raw]
```

## config

```bash
scout capo agents config <id> [--hash <hash>] [--source assigned|reported]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hash` | string | current | A specific revision to read |
| `--source` | enum | capo chooses | `assigned` is what capo was told to send; `reported` is what the collector says it runs |

The two sources differ for a supervised collector. What it reports is the
merged result: the configuration capo sent, plus the parts its supervisor
adds. Assigning a reported configuration back therefore sends the supervisor's
own half back to it; read `assigned` when you intend to edit and re-apply.

## set-config

```bash
scout capo agents set-config <id> [--file <file>] [--reason <text>]
```

Reads standard input when `--file` is omitted. Scout stores the configuration
and offers it to the collector; a collector that cannot accept remote
configuration stores it and keeps running what it has.

`--reason` says why, for the audit and for whoever approves the change.

When your account requires approval, nothing is assigned. The command prints
the change it created instead, and exits successfully:

```text
Held for approval as change 351113e7-6a91-4fe9-b1f9-d9692729b073 (1 collector(s)): assign a configuration to one collector
Review it with `scout capo changes show 351113e7-6a91-4fe9-b1f9-d9692729b073`.
```

The same applies to `rollback` and `apply`. See
[Approve Collector Configuration Changes](../../operate/collector-change-approval.md).

## rollback

```bash
scout capo agents rollback <id> --hash <hash> [--reason <text>]
```

Re-assigns an earlier revision. Use `history` to find its hash.

## restart

```bash
scout capo agents restart <id>
```

Asks the collector to restart. Only a supervised collector can act on this.
A restart is never held for approval.

## history

```bash
scout capo agents history <id> [--raw]
```

The `AUDIT` column shows who requested and who approved a revision that went
through approval, and who assigned any other.

## drift

```bash
scout capo agents drift --match KEY=VALUE [--match KEY=VALUE]... [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--match` | `key=value` | — | Attribute to match. Repeat to narrow. Required |
| `--json` | bool | `false` | Output JSON |
| `--markdown` | bool | `false` | Output markdown, for a pull request comment |

Reports how many collectors match, how many can act on a configuration, and
groups them by the configuration each is running. Collectors running the same
configuration appear as one group.

Two numbers are reported because they differ. Applying a configuration means
restarting the collector, which only a supervised one can do; a collector
without a supervisor stores the assignment and keeps running what it has.
Counting those as changed would overstate what a change does.

## apply

```bash
scout capo agents apply --match KEY=VALUE [--match KEY=VALUE]... [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--match` | `key=value` | — | Attribute to match. Repeat to narrow. Required |
| `--file` | path | stdin | Configuration to assign |
| `--dry-run` | bool | `false` | Report what would happen and change nothing |
| `--diff` | bool | `false` | With `--dry-run`, show what each configuration would become |
| `--acknowledge-drift` | bool | `false` | Apply even though the matched collectors run different configurations |
| `--expected-match` | int | — | Refuse unless exactly this many collectors match |
| `--reason` | string | — | Why, for the audit and the approver |

Assigns one configuration to everything matching the selector.

The command refuses when nothing matches, and when the matched collectors run
more than one configuration today. Drift is not an error: it means the change
replaces several different configurations rather than one, which is worth
knowing before doing it. `--dry-run --diff` shows what each would become;
`--acknowledge-drift` says you have seen it.

`--expected-match` guards against the fleet changing between looking and
deciding. Collectors come and go, so the number you saw in `drift` may not be
the number you would apply to a minute later.

### Reading the diff

Configurations are compared by structure, not as text. A collector reports
YAML written by its supervisor, while a file in your repository is written by
hand, so the two differ in indentation and key order throughout; compared
line by line almost every line would read as changed.

The extensions a supervisor owns are left out of the comparison for the same
reason. A supervised collector reports them because it is running them, but no
assignment removes them.

## changes list

```bash
scout capo changes list [flags]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--held` | bool | `false` | Only change requests: what went through approval |
| `--status` | enum | — | `pending`, `approved`, `rejected`, `withdrawn`, or `applied` |
| `--limit` | int | `100` | Maximum results |
| `--before` | time | — | Only changes made before this RFC 3339 time |
| `--json` | bool | `false` | Output JSON |

Without `--held` the list is the audit: changes made while approval was off
(`applied`), restarts, and changes to the approval setting appear alongside
the requests. A person is shown by email, an API key by its client ID.

## changes show

```bash
scout capo changes show <id> [--json]
```

Shows who requested the change and why, who decided it, and what approving it
would do now: how many collectors match, grouped by the configuration each
runs, and whether each group would change.

## changes approve, reject, withdraw

```bash
scout capo changes approve <id> [--comment <text>]
scout capo changes reject <id> --comment <text>
scout capo changes withdraw <id>
```

Approving applies the change to the collectors that match at that moment and
reports how many changed. A rejection needs `--comment`. Only the user or key
that requested a change can withdraw it.

## approval

```bash
scout capo approval get
scout capo approval set --required true
```

Turns holding on or off for every collector in your account. Requests already
pending stay pending when it is turned off.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SCOUT_CAPO_URL` | Capo address, when it is not the default for your account |
| `SCOUT_ACCOUNT_SLUG` | Default account slug |
| `SCOUT_CLIENT_ID` | Client id, for `scout login --client-credentials` |
| `SCOUT_CLIENT_SECRET` | Client secret, for `scout login --client-credentials` |

## Examples

List the collectors in one cluster:

```bash
scout capo agents list --cluster prod-eu
```

Read what a collector was told to run, rather than what it reports:

```bash
scout capo agents config 8eaba0ff --source assigned
```

See what every daemon in a cluster is running:

```bash
scout capo agents drift \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon
```

Check what a change would do before making it:

```bash
scout capo agents apply \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon \
  --file collector.yaml \
  --dry-run --diff
```

Apply it, refusing if the fleet changed since you looked:

```bash
scout capo agents apply \
  --match k8s.cluster.name=prod-eu \
  --match collector.role=daemon \
  --file collector.yaml \
  --expected-match 12
```

Roll one collector back to an earlier revision:

```bash
scout capo agents history 8eaba0ff
scout capo agents rollback 8eaba0ff --hash 83c518d4ab98 \
  --reason "Revert the exporter change"
```

Review what is waiting for approval and approve one:

```bash
scout capo changes list --held --status pending
scout capo changes show 351113e7-6a91-4fe9-b1f9-d9692729b073
scout capo changes approve 351113e7-6a91-4fe9-b1f9-d9692729b073 \
  --comment "Checked the diff"
```

## See also

- [Collector Configuration as Code](../../operate/collector-config-as-code.md),
  for keeping these configurations in Git
- [Approve Collector Configuration Changes](../../operate/collector-change-approval.md)
