---
title: API Reference
sidebar_position: 1
description: Scope REST API overview — authentication, base URL, and error handling for SDK endpoints.
keywords: [scope api, rest api, api authentication, bearer token, scope api reference, sdk token]
---

# API Reference

The Scope API provides programmatic access to prompts and versions. This page
covers authentication, conventions, and error handling for the SDK-facing
endpoints.

## Base URL

```text
https://your-scope-url/api/v1
```

All endpoints are prefixed with `/api/v1`. Replace `your-scope-url` with your
Scope instance hostname.

## Authentication

The Scope API uses JWT bearer tokens for authentication. The SDK authenticates
using API keys through a dedicated token endpoint.

### API Key Authentication

For programmatic access (SDK, CI/CD, scripts), authenticate using API keys:

1. **Obtain a JWT token** by sending your API key credentials to the SDK token
  endpoint:

```bash
# Exchange API key for a JWT token
curl -s -X POST https://your-scope-url/v1/auth/sdk-token \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "'"$SCOPE_ACCOUNT_ID"'",
    "key_id": "'"$SCOPE_KEY_ID"'",
    "key_secret": "'"$SCOPE_KEY_SECRET"'"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `account_id` | string | Yes | Your Scope account identifier |
| `key_id` | string | Yes | API key identifier |
| `key_secret` | string | Yes | API key secret |

**Response:**

```json
{
  "access_token": "eyJhbGciOiJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

1. **Include the token** in the `Authorization` header of all subsequent
  requests:

```bash
curl https://your-scope-url/api/v1/prompts/greeting/production \
  -H "Authorization: Bearer $TOKEN"
```

:::info
The SDK handles token exchange and refresh automatically. You only need to
manage tokens directly when calling the REST API without the SDK.
:::

### Token Lifecycle

- Tokens have a limited lifetime (typically minutes to hours)
- Refresh tokens before they expire using the `token_refresh_buffer` setting
- The SDK refreshes tokens automatically (default: 60 seconds before expiry)

## Content Type

All request and response bodies use JSON:

```http
Content-Type: application/json
```

## Error Responses

All errors follow a consistent format:

```json
{
  "code": "not_found",
  "message": "Prompt 'greeting' not found"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `400` | Bad Request — invalid input or validation error |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found — resource doesn't exist |
| `500` | Internal Server Error |

## API Sections

- [Prompts](./prompts.md) — fetch prompt versions (production, latest, specific)

## Next Steps

- [Manage API Keys](../authentication/manage-api-keys.md) — create and manage
  API keys
- [SDK Configuration](../sdk/configuration.md) — use
  the SDK instead of calling the API directly
