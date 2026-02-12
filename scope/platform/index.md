---
title: Platform
sidebar_position: 1
description: Scope platform settings overview — user management, environments, providers, and security.
keywords: [scope platform, scope settings, scope administration, platform overview]
---

# Platform

The Platform section covers Scope's operational and administrative features —
from user management and environment configuration to security and integrations.

## Settings Overview

Access platform settings from **Settings** in the Scope navigation. Settings are
organized into the following areas:

### Providers

Configure and manage LLM provider connections. Each provider requires an API key
and can have multiple model configurations.

- Add, update, and remove providers
- Test connections before saving
- Enable/disable individual models
- Set custom display names and base URLs

See [Configure Providers](./configure-providers.md) for a step-by-step
guide.

### API Keys

Manage API keys used for SDK and programmatic access to the Scope API.

- Create keys with descriptive names
- View key usage (last used timestamp)
- Revoke keys that are no longer needed

See [Manage API Keys](../authentication/manage-api-keys.md) for details.

### Users & Permissions

Manage team access and role-based permissions.

- Invite team members
- Assign roles (Admin, Editor, Viewer)
- Review and update permissions

See [User Management](./user-management.md) for the full permissions matrix.

## Platform Topics

- [User Management](./user-management.md) — roles, permissions, and team access
- [Versioning](./versioning.md) — version lifecycle, data model, and SDK resolution
- [Security](./security.md) — authentication, RBAC, and data protection
- [Configure Providers](./configure-providers.md) — add and manage LLM providers
