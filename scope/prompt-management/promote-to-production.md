---
title: Promote to Production
sidebar_position: 3
description: How to promote a prompt version to production, view promotion history, and roll back.
keywords: [prompt promotion, production deployment, prompt rollback, promotion history]
---

# Promote to Production

Promotion is how you deploy a tested prompt version to production. Once
promoted, all SDK and API consumers automatically receive the new version. This
guide covers the promotion flow, history tracking, and rollback.

## How Promotion Works

Promotion is an **atomic** operation:

1. The selected draft version becomes **published** (production)
2. The previously published version is **archived** automatically
3. The change takes effect immediately for all API and SDK consumers

There is no window where two versions are simultaneously in production. The
switch is instant.

## Promote a Version

1. Open the prompt from the prompt list
2. Select the draft version you want to promote
3. Click **Promote**
4. Optionally add **promotion notes** (e.g., "Improved tone for enterprise
  customers")
5. Confirm the promotion

The version status changes from **draft** to **published**, and the previous
production version (if any) is archived.

:::tip
Always test a version before promoting it. Use the [test
panel](./testing-prompts.md) to verify the output with real variable values and
different models.
:::

## Promotion History

Every promotion is recorded with:

| Field | Description |
|-------|-------------|
| **Version** | Which version was promoted |
| **Promoted by** | The user who performed the promotion |
| **Promoted at** | Timestamp of the promotion |
| **Previous version** | Which version was in production before |
| **Notes** | Optional changelog or reason for the promotion |

To view promotion history:

1. Open the prompt
2. Navigate to the **Promotion History** tab or section

History is sorted newest-first by default and can be filtered by user or date
range.

## Rolling Back

To roll back to a previous version:

1. Open the prompt's promotion history
2. Find the version you want to restore
3. If the version is archived, **unarchive** it first to return it to draft
  status
4. **Promote** the restored version

:::info
There is no dedicated "rollback" button. Rolling back is simply promoting a
previous version again. This keeps the promotion history linear and auditable.
:::

## Next Steps

- [Working with Versions](./working-with-versions.md) — version lifecycle and archiving
- [Testing Prompts](./testing-prompts.md) — verify prompts before promoting
- [Versioning (Platform)](../platform/versioning.md)
  — version data model and resolution logic
