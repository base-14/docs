---
title: Approve Collector Configuration Changes
sidebar_label: Collector Change Approval
sidebar_position: 8.5
description:
  Require an admin to approve every change to your OpenTelemetry Collector
  configurations before Scout applies it, and see who changed what in the
  Collectors audit.
keywords:
  [
    collector change approval,
    maker checker,
    configuration change review,
    collector audit,
    opentelemetry collector configuration,
    scout capo,
  ]
---

# Approve collector configuration changes

By default, a change to a collector's configuration applies as soon as someone
makes it. Turn on **Require approval** and Scout holds every configuration
change until an admin approves it. Whether approval is on or off, the
**Audit** tab records who changed what and when.

Approval covers every collector in your account. It does not change what
anyone may do; it adds a second person before a change reaches a collector.

## What is held for approval

When approval is required, these wait for an admin:

- Editing a collector's configuration on the Collectors page, including
  **Apply to matching collectors**
- **Restore** of an earlier revision in a collector's configuration history
- **Stop collecting** in logX, the Metrics Catalog, and traceX, and
  **Mark as PII** in logX
- `scout capo agents set-config`, `apply`, and `rollback`, from a terminal or
  a pipeline

Restarting a collector is never held: it changes no configuration.

## Turn approval on

1. Open **Collectors** and select the **Change requests** tab.
2. Turn on **Require approval** and confirm.

Only admins can change this setting. Turning it off later asks you to confirm
too; requests already waiting stay pending and can still be approved or
rejected.

## Who can approve

| Who | Request a change | Approve or reject |
| --- | :---: | :---: |
| Users with the **Admin** role | ✅ | ✅ |
| Users with the **Editor** role | ✅ (from the Scout CLI) | ❌ |
| Users with the **Viewer** role | ❌ | ❌ |
| API key with **Collectors Write** | ✅ | ❌ |
| API key with **Collectors Admin** | ❌ | ✅ |

One approval is enough. An admin may approve a change they requested; the
audit records both steps. Admins gain the right to approve at their next sign
in.

Create a **Collectors Admin** key on the **API Keys** page when a pipeline
needs to approve changes. Such a key cannot change a configuration itself.

## Review a change

The **Change requests** tab lists pending changes, with their count on the
tab. Open one to see:

- Who asked for it, when, and the reason they gave
- What it is: the collector, or the attributes that select several
- What approving would do now: each group of collectors running the same
  configuration, with a diff of what it would become

Then choose:

- **Approve and apply**: Scout applies the change and records what happened on
  each collector.
- **Reject**: write why. A rejection needs a comment.
- **Withdraw**: available to the person or key that asked for the change.

The preview is computed when you open the change, against what the collectors
run at that moment. A change that selects collectors by attribute reaches the
collectors that match when it is approved, which can differ from when it was
requested.

:::warning

Approving a full configuration applies exactly what was requested. If the
collector was changed in the meantime, the preview shows that change being
undone. Reject and ask for a new request if that is not what you want.

:::

## The audit

The **Audit** tab lists every change made to your collectors, newest first,
however it was made:

| Column | What it shows |
| --- | --- |
| When | When the change was made or requested |
| Who | The user's email, or the API key's client ID |
| What | The change, with its reason |
| Approval | Approved, rejected, withdrawn, pending, or applied directly |
| Result | How many collectors changed |

Changes made while approval was off appear as **Applied directly**. Restarts
and changes to the **Require approval** setting are recorded too. Filter by
action to narrow the list, and open any row for the full record.

When **Stop collecting** or **Mark as PII** is used, the audit names the
person who clicked it, not the key the app uses to reach your collectors.

A collector's **Configuration history** shows who requested and who approved
each revision that went through approval, with a link to the request.

## From the Scout CLI and CI

With approval on, `set-config`, `apply`, and `rollback` do not apply the change.
They print the change ID instead:

```text
Held for approval as change 351113e7-6a91-4fe9-b1f9-d9692729b073 (1 collector(s)): assign a configuration to one collector
Review it with `scout capo changes show 351113e7-6a91-4fe9-b1f9-d9692729b073`.
```

Pass `--reason` so the approver knows why:

```bash
scout capo agents set-config 8eaba0ff --file collector.yaml \
  --reason "Sample host metrics every 15s"
```

Review and decide from the CLI:

```bash
scout capo changes list --held --status pending
scout capo changes show <id>
scout capo changes approve <id> --comment "Looks right"
scout capo changes reject <id> --comment "Keep the 30s interval"
```

A pipeline that applies configuration on merge, as in
[Collector Configuration as Code](./collector-config-as-code.md), still
succeeds when its change is held. The change waits on the **Change requests**
tab until an admin approves it.

These commands need Scout CLI 0.21.1 or later. See
[scout capo](../scout-cli/scout-access/capo.md) for every flag.

## FAQ

### Does turning on approval change what anyone can do?

No, the same people can still request changes. Approval adds a review step
before a change is applied: nothing reaches a collector until an admin
approves it.

### What happens to pending requests if approval is turned off?

They stay pending. An admin can still approve or reject them, and the person
who asked can withdraw them. New changes apply straight away.

### Do requests expire?

No, a request stays pending until it is approved, rejected, or withdrawn.

### Is a restart held for approval?

No, restarting a collector changes no configuration, so it happens straight
away. It is still recorded in the audit.

## See also

- [Collector Configuration as Code](./collector-config-as-code.md)
- [scout capo](../scout-cli/scout-access/capo.md)
- [Fleet management](../instrument/collector-setup/fleet-management.md)
- [User Management](./user-management.md)
