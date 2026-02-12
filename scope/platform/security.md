---
title: Security
sidebar_position: 6
description: Scope security — authentication, RBAC, data protection, API security, and best practices.
keywords: [scope security, authentication, rbac, data protection, api security, encryption]
---

# Security

This page covers Scope's security model — authentication mechanisms, role-based
access control, data protection, and API security best practices.

## Authentication

Scope supports two authentication methods:

### SSO Authentication

Users sign in through the base14 SSO system. Session tokens are managed
automatically and stored securely in the browser. SSO provides:

- Centralized user identity management
- Session-based token lifecycle
- Integration with your organization's identity provider

### API Key Authentication

Programmatic access uses API key pairs (key + secret) that exchange for JWT
bearer tokens:

```text
API Key + Secret → Auth API → JWT Token → Scope API
```

- **JWT tokens** are short-lived and automatically refreshed by the SDK
- **API secrets** are shown once at creation and cannot be retrieved later
- **Token refresh** happens transparently before expiry (configurable buffer)

See [Manage API Keys](../authentication/manage-api-keys.md) for key lifecycle
management.

## Role-Based Access Control (RBAC)

Scope enforces RBAC with three roles:

| Role | Scope |
|------|-------|
| **Viewer** | Read-only access to prompts, versions, and traces |
| **Editor** | Full prompt management (create, edit, test, promote) |
| **Admin** | Provider/key management, user administration, destructive operations |

Key RBAC principles:

- All authenticated users can view prompts and traces
- Only Editors and Admins can create and modify prompts
- Only Admins can manage providers, API keys, and users
- Only Admins can delete prompts and providers

See [User Management](./user-management.md) for the full permissions matrix.

## Data Protection

### Encryption at Rest

- **Provider API keys** are encrypted using AES-256 before storage
- **Database** uses encrypted storage volumes in production

### Encryption in Transit

- All API communication uses HTTPS (TLS 1.2+)
- SDK-to-API connections enforce TLS
- Provider API calls use the provider's HTTPS endpoints

### Sensitive Data Handling

| Data Type | Protection |
|-----------|------------|
| Provider API keys | AES-256 encrypted at rest, never returned in API responses |
| Scope API secrets | Shown once at creation, hashed for storage |
| JWT tokens | Short-lived, signed, refreshed automatically |
| Prompt content | Stored in database, accessible per RBAC rules |
| Execution traces | Stored in Scout's data lake, subject to Scout's retention policies |

## API Security

### Request Authentication

Every API request (except health checks) requires a valid JWT bearer token in
the `Authorization` header:

```http
Authorization: Bearer eyJhbGciOiJ...
```

Requests without a valid token receive `401 Unauthorized`.

### Request Validation

- All input is validated against defined schemas
- String lengths are enforced (e.g., prompt names: 1–255 chars)
- SQL injection is prevented through parameterized queries
- Request bodies are parsed as JSON with size limits

### Rate Limiting

- Provider execution endpoints respect upstream provider rate limits
- The API returns `429 Too Many Requests` when limits are exceeded
- The SDK implements exponential backoff for retries

### CORS

The Scope API is configured to allow requests from the Scope UI domain.
Cross-origin requests from unauthorized domains are rejected.

## Best Practices

### API Key Management

- Rotate API keys periodically (recommended: every 90 days)
- Use separate keys for each environment and service
- Store secrets in a dedicated secrets manager, not in code or config files
- Revoke unused keys promptly
- Monitor `last_used_at` to detect compromised keys

### Prompt Content

- Avoid storing sensitive data (PII, credentials) in prompt templates
- Use variables for dynamic content rather than hardcoding values
- Review prompt content before promoting to production
- Use RBAC to control who can create and modify prompts

## Compliance Considerations

- **Audit trail** — all prompt modifications, promotions, and API key operations
  are tracked with user attribution and timestamps
- **Access control** — RBAC ensures users only access resources appropriate for
  their role
- **Data residency** — Scope stores data in the database configured by your
  deployment; choose a region that meets your compliance requirements
- **Retention** — prompt versions are preserved until explicitly deleted; trace
  retention follows Scout's configured policies
