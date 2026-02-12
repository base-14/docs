---
title: User Management
sidebar_position: 2
description: User roles, permissions, and team access management in Scope.
keywords: [scope users, rbac, role based access, scope permissions, user management]
---

# User Management

Scope uses role-based access control (RBAC) to manage what users can do within
the platform. This page covers the available roles, their permissions, and how
to manage team access.

## Roles

Scope defines three roles with increasing levels of access:

| Role | Description |
|------|-------------|
| **Viewer** | Read-only access to prompts, versions, and traces |
| **Editor** | Full prompt management — create, edit, test, and promote prompts |
| **Admin** | Everything Editors can do, plus provider/key management and user administration |

## Permissions Matrix

| Action | Viewer | Editor | Admin |
|--------|--------|--------|-------|
| View prompts and versions | Yes | Yes | Yes |
| View traces | Yes | Yes | Yes |
| View providers (list) | Yes | Yes | Yes |
| Create prompts | — | Yes | Yes |
| Edit prompt metadata | — | Yes | Yes |
| Create/edit versions | — | Yes | Yes |
| Test prompts (execute) | — | Yes | Yes |
| Promote to production | — | Yes | Yes |
| Archive/unarchive versions | — | Yes | Yes |
| Manage golden sets | — | Yes | Yes |
| Configure providers | — | — | Yes |
| Manage API keys | — | — | Yes |
| Manage users and roles | — | — | Yes |
| Delete prompts | — | — | Yes |
| Delete providers | — | — | Yes |

## Managing Users

### Invite a User

1. Go to **Settings > Users**
2. Click **Invite User**
3. Enter the user's email address
4. Select a role (Viewer, Editor, or Admin)
5. Send the invitation

The invited user receives an email with instructions to access Scope.

### Change a User's Role

1. Go to **Settings > Users**
2. Find the user in the list
3. Click their current role to open the role selector
4. Select the new role
5. Save the change

Role changes take effect immediately.

### Remove a User

1. Go to **Settings > Users**
2. Find the user in the list
3. Click **Remove**
4. Confirm the action

:::warning
Removing a user revokes their access immediately. Resources they created
(prompts, versions) are preserved.
:::

## Best Practices

- **Principle of least privilege** — assign the minimum role needed. Most team
  members should be Editors; reserve Admin for those who need to manage
  providers and keys
- **Separate admin accounts** — avoid using admin accounts for day-to-day prompt
  work
- **Regular access reviews** — periodically review the user list and remove
  access for team members who no longer need it
- **Audit trail** — promotion history and version metadata track which user
  performed each action
