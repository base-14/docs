---
title: Versioning
sidebar_position: 4
description: Prompt version lifecycle, data model, and SDK resolution logic in Scope.
keywords: [prompt versioning, version lifecycle, version data model, sdk version resolution]
---

# Versioning

This page covers how Scope's versioning system works under the hood — the data
model, lifecycle rules, and how the SDK resolves which version to serve.

## Data Model

Each prompt version is stored as an immutable record with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `version_id` | string | Unique version identifier (e.g., `v_01ABC`) |
| `prompt_id` | string | Parent prompt identifier |
| `version` | integer | Sequential version number (1, 2, 3, ...) |
| `content` | string | Prompt template with `{{variable}}` placeholders |
| `variables` | string[] | Auto-detected variable names |
| `status` | enum | `draft`, `published`, or `archived` |
| `prompt_type` | string | `text` or `chat` |
| `metadata` | object | Arbitrary key-value pairs |
| `created_at` | datetime | Creation timestamp |
| `created_by` | uuid | User who created the version |
| `promoted_at` | datetime | When the version was promoted (if published) |
| `promoted_by` | uuid | Who promoted the version (if published) |

## Lifecycle Rules

### Status Transitions

```text
              promote
  Draft ─────────────────► Published
    ▲                          │
    │ unarchive     promote    │ (auto: new version promoted)
    │              new version │
    │                          ▼
  Draft ◄──────────────── Archived
              unarchive
```

**Constraints:**

1. Only **one version per prompt** can be `published` at a time
2. Promoting a version atomically sets it to `published` and archives the
  previous `published` version
3. `Published` versions cannot be directly archived — promote a different
  version instead
4. `Archived` versions can be unarchived back to `draft`
5. Only `draft` versions can have their content edited

### Version Numbering

- Version numbers are monotonically increasing integers starting at 1
- Creating a new version always assigns the next number (never reuses)
- Deleting or archiving a version does not affect numbering

## SDK Resolution

The SDK resolves which version to serve based on the parameters passed to
`get_prompt_version()`:

### Resolution Logic

```text
get_prompt_version("name")
  → No label, no version ID
  → Fetch production version (GET /prompts/{name}/production)

get_prompt_version("name", label="production")
  → Fetch production version (GET /prompts/{name}/production)

get_prompt_version("name", label="latest")
  → Fetch latest version regardless of status (GET /prompts/{name}/latest)

get_prompt_version("name", version="v_01ABC")
  → Fetch specific version by ID (GET /prompts/{name}/versions/{versionId})
```

### Production Resolution

When the SDK requests the production version:

1. The API looks up the prompt by name (or UUID)
2. It finds the version with `status = "published"`
3. If no published version exists, it returns `404` (the SDK raises
  `NoProductionVersionError`)

### Caching Behavior

The SDK caches resolved versions using the key pattern
`prompt:{name}:{label|version}`:

- `prompt:greeting:production` — cached production version
- `prompt:greeting:latest` — cached latest version
- `prompt:greeting:v_01ABC` — cached specific version

Cache entries expire after the configured TTL (default: 300 seconds). This
means:

- After promoting a new version, SDK consumers continue serving the old version
  until their cache expires
- For immediate updates, either reduce the cache TTL or have the application
  call `clear_cache()`

## Promotion Semantics

When a version is promoted:

1. A database transaction ensures atomicity
2. The target version's status is set to `published`
3. The previous `published` version's status is set to `archived` (or `draft` if
  `archive_previous_production` is `false`)
4. A promotion history record is created with the user, timestamp, and optional
  notes
5. The API returns immediately — there is no deployment or propagation delay

### Promotion History

Every promotion event is recorded:

| Field | Description |
|-------|-------------|
| `history_id` | Unique identifier |
| `prompt_id` | The prompt |
| `version_number` | Which version was promoted |
| `promoted_by` | User who promoted |
| `promoted_at` | Timestamp |
| `previous_version` | Version that was previously in production |
| `notes` | Optional changelog |

## Best Practices

- **Don't skip testing** — always test a version before promoting it
- **Use promotion notes** — document why each promotion was made for audit
  purposes
- **Monitor cache TTL** — choose a TTL that balances freshness and API load for
  your use case
- **Keep versions focused** — each version should represent a meaningful change,
  not a typo fix that could be edited in place (while still in draft)
