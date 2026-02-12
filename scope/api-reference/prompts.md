---
title: Prompts API
sidebar_position: 2
description: API reference for fetching prompt versions — production, latest, and specific version endpoints.
keywords: [scope api prompts, prompt api, prompt version api, get prompt, fetch prompt]
---

# Prompts API

Endpoints for fetching prompt versions. The SDK uses these endpoints to retrieve
prompt content by name.

All endpoints require a valid JWT bearer token obtained from the
[authentication endpoint](./index.md#api-key-authentication).

## Request Headers

The SDK sends the following headers with every request:

```http
Accept: application/json
Authorization: Bearer {access_token}
User-Agent: scope-client-python/0.1.0
X-Request-ID: {uuid}
```

| Header | Description |
|--------|-------------|
| `Accept` | Always `application/json` |
| `Authorization` | JWT bearer token from `/v1/auth/sdk-token` |
| `User-Agent` | SDK identifier and version (e.g., `scope-client-python/0.1.0` or `scope-client-ruby/0.1.0`) |
| `X-Request-ID` | Unique UUID for request tracing |

---

## Get Production Version

```http
GET /api/v1/prompts/{name}/production
```

Returns the currently published (production) version of a prompt.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Prompt name |

**Response:** `200 OK`

```json
{
  "prompt_id": "pmt_01ABC",
  "version_id": "v_01DEF",
  "name": "greeting",
  "version": 3,
  "content": "Hello, {{name}}!",
  "variables": ["name"],
  "status": "published",
  "is_production": true,
  "prompt_type": "text",
  "metadata": {},
  "tags": ["demo"],
  "created_at": "2024-01-20T14:00:00Z",
  "updated_at": "2024-01-20T15:00:00Z",
  "promoted_at": "2024-01-20T15:00:00Z",
  "promoted_by": "usr_01XYZ"
}
```

**Errors:** `401`, `403`, `404` (prompt not found or no production version),
`500`

---

## Get Latest Version

```http
GET /api/v1/prompts/{name}/latest
```

Returns the most recent version of a prompt regardless of status.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Prompt name |

**Response:** `200 OK`

```json
{
  "prompt_id": "pmt_01ABC",
  "version_id": "v_01GHI",
  "name": "greeting",
  "version": 4,
  "content": "Hello, {{name}}! Welcome to {{app}}.",
  "variables": ["name", "app"],
  "status": "draft",
  "is_production": false,
  "prompt_type": "text",
  "metadata": {},
  "tags": ["demo"],
  "created_at": "2024-01-22T10:00:00Z",
  "updated_at": "2024-01-22T10:00:00Z",
  "promoted_at": null,
  "promoted_by": null
}
```

**Errors:** `401`, `403`, `404`, `500`

---

## Get Specific Version

```http
GET /api/v1/prompts/{name}/versions/{versionId}
```

Returns a specific version by ID.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Prompt name |
| `versionId` | string | Version identifier |

**Response:** `200 OK`

```json
{
  "prompt_id": "pmt_01ABC",
  "version_id": "v_01DEF",
  "name": "greeting",
  "version": 3,
  "content": "Hello, {{name}}!",
  "variables": ["name"],
  "status": "published",
  "is_production": true,
  "prompt_type": "text",
  "metadata": {},
  "tags": ["demo"],
  "created_at": "2024-01-20T14:00:00Z",
  "updated_at": "2024-01-20T15:00:00Z",
  "promoted_at": "2024-01-20T15:00:00Z",
  "promoted_by": "usr_01XYZ"
}
```

**Errors:** `401`, `403`, `404`, `500`

---

## Response Schema

All three endpoints return a `PromptVersion` object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `prompt_id` | string | Prompt identifier |
| `version_id` | string | Version identifier |
| `name` | string | Prompt name |
| `version` | integer | Version number |
| `content` | string | Prompt content with `{{variable}}` placeholders |
| `variables` | string[] | Extracted variable names from content |
| `status` | string | `draft`, `published`, or `archived` |
| `is_production` | boolean | Whether this version is the current production version |
| `prompt_type` | string | `text` or `chat` |
| `metadata` | object | Arbitrary key-value metadata |
| `tags` | string[] | Tags for organization |
| `created_at` | datetime | When the version was created |
| `updated_at` | datetime | When the version was last updated |
| `promoted_at` | datetime \| null | When the version was promoted to production |
| `promoted_by` | string \| null | User who promoted the version |
