---
title: Working with Versions
sidebar_position: 2
description: How to create, edit, archive, and manage prompt versions in Scope.
keywords: [prompt versions, version control, version lifecycle, scope versioning]
---

# Working with Versions

Every prompt in Scope has one or more **versions**. Versions let you iterate on
prompt content without affecting what's currently running in production. This
guide covers creating, editing, archiving, and navigating versions.

## Version Basics

When you create a prompt, Scope creates `v1` automatically. Each subsequent
version increments the number (`v2`, `v3`, ...). Versions have three possible
statuses:

| Status | Editable | Servable | Description |
|--------|----------|----------|-------------|
| **Draft** | Yes | By request | Work in progress. Can be modified and tested. |
| **Published** | No | Yes (default) | The active production version. |
| **Archived** | No | No | Preserved for history. Cannot be served. |

## Create a New Version

1. Open the prompt from the prompt list
2. Click **New Version**
3. Choose how to initialize the content:
   - **Blank** — start from scratch
   - **Copy from version** — duplicate an existing version's content as a
     starting point
4. Edit the content in the editor
5. Save the version

The new version is created in **draft** status with the next sequential version
number.

:::tip
Copying from a previous version is useful when you want to make incremental
changes. The original version remains unchanged.
:::

## Edit a Draft Version

Only draft versions can be edited. To modify a draft:

1. Open the prompt and select the draft version
2. Edit the content in the editor
3. Save your changes

Variables are re-detected automatically when you save.

:::info
Published and archived versions are immutable. To change a published prompt,
create a new version with the updated content and promote it.
:::

## Archive a Version

Archiving removes a version from active use while preserving it for history.

1. Open the prompt and select the version to archive
2. Click **Archive**
3. Confirm the action

Rules:

- **Draft** versions can be archived
- **Published** versions cannot be archived directly — promote a different
  version first, then archive the previous one
- Archived versions remain visible when you enable the **Include archived**
  filter

## Unarchive a Version

To bring an archived version back to draft status:

1. Open the prompt and enable **Include archived** in the version list
2. Select the archived version
3. Click **Unarchive**

The version returns to **draft** status and can be edited and tested again.

## Navigate Version History

The version list on a prompt shows all versions with their:

- Version number (e.g., `v3`)
- Status badge (draft, published, archived)
- Creation date and author
- Content preview

Use the version list to compare different iterations of your prompt and track
how it has evolved over time.

## Next Steps

- [Promote to Production](./promote-to-production.md)
  — move a tested version to production
- [Testing Prompts](./testing-prompts.md) — test versions before promoting
- [Versioning (Platform)](../platform/versioning.md)
  — version data model and SDK resolution
