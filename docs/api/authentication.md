---
title: Authentication
sidebar_label: Authentication
description:
  How Scout API authentication works — API keys, the OAuth 2.0 client
  credentials grant, token lifetime, and diagnosing 401 and 403 responses.
keywords:
  - scout api authentication
  - client credentials grant
  - oauth2 api key
  - bearer token
  - scout read role
---

# Authentication

The Scout API authenticates with bearer tokens. You exchange a long-lived
API key for a short-lived access token, then send that token on every
request.

```text
API key (client ID + secret) -> identity service -> access token -> Scout API
```

## API keys

Create keys in the Scout console at
`https://console.base14.io/<your-org>/api-keys`. You need admin access to
your organization.

A key has three parts:

| Part | Notes |
| --- | --- |
| Client ID | Identifies the key. Safe to log. |
| Client secret | Shown once, at creation. Cannot be retrieved later. |
| Role | Chosen at creation. Use **Scout Read** for the endpoints documented here. |

A key's role is fixed when it is created. To change the role, create a new
key and revoke the old one.

:::warning
Treat the client secret like a password. Store it in a secret manager, not
in source control or a CI variable that is visible to everyone.

Revoking a key stops it issuing **new** tokens, but does not invalidate
tokens it has already issued. Those stay valid until they expire, because
the API verifies a token's signature and expiry rather than calling back to
the identity service. Your exposure window after a leak is therefore the
remaining lifetime of any token already minted from that key.
:::

## Getting an access token

Scout uses the OAuth 2.0 client credentials grant. The realm in the token
URL is your organization slug:

```bash
curl -s -X POST \
  "https://id.base14.io/realms/<your-org>/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>"
```

The response is a standard token response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "expires_in": 300,
  "token_type": "Bearer",
  "scope": "profile email"
}
```

Send the token on every request:

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$SCOUT_API_URL/api/v1/services"
```

## Token lifetime

Access tokens are short-lived. Read `expires_in` from the token response
rather than assuming a value, and refresh before expiry.

For a long-running process, the reliable pattern is to fetch a token on
demand and cache it until shortly before it expires:

```python
import time
import requests

class ScoutToken:
    def __init__(self, org, client_id, client_secret, skew=30):
        self._url = (
            f"https://id.base14.io/realms/{org}"
            "/protocol/openid-connect/token"
        )
        self._auth = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        self._skew = skew
        self._token = None
        self._expires_at = 0

    def invalidate(self):
        """Force the next get() to fetch a fresh token."""
        self._token = None
        self._expires_at = 0

    def get(self):
        if self._token and time.monotonic() < self._expires_at:
            return self._token
        r = requests.post(self._url, data=self._auth, timeout=10)
        r.raise_for_status()
        body = r.json()
        self._token = body["access_token"]
        # Refresh early so a request never races the expiry.
        self._expires_at = time.monotonic() + body["expires_in"] - self._skew
        return self._token
```

Fetching a token once at startup and holding it forever is a common cause
of a job that works on day one and returns `401` later.

## Tenancy

Requests are scoped to one organization, and that scope comes from the
token itself — specifically from the realm that issued it. There is no
tenant header, query parameter or body field to set, and a token issued for
one organization cannot read another's data.

## Troubleshooting

### 401 Unauthorized

The token is missing, malformed, expired, or was issued by an unexpected
issuer.

```json
{"error": "unauthorized", "code": "unauthorized", "message": "unauthorized"}
```

Check, in order:

1. The `Authorization` header is present and formatted as
   `Bearer <token>`, with the scheme, a single space, then the token.
2. The token has not expired.
3. The realm in the token URL matches your organization slug. A typo here
   produces a token that is valid but issued by the wrong realm.

### 403 Forbidden

The token is valid, but the key does not have the role the endpoint needs.

```json
{"error": "forbidden", "code": "forbidden", "message": "forbidden"}
```

Read endpoints require the **Scout Read** role. If the key was created with
a different role, create a new key — roles cannot be edited after creation.

## FAQ

### How long do Scout API access tokens last?

Read `expires_in` from the token response rather than hardcoding a
lifetime. Tokens are short-lived, typically minutes, and the value can
change. Refresh shortly before expiry.

### Can I use the same API key across environments?

You can, but do not. Use one key per environment and per integration, so
revoking a compromised staging key does not take production down with it.

### What happens when I revoke a key?

New token requests with that key fail immediately. Access tokens already
issued keep working until they expire — the API checks a token's signature
and expiry, not whether the key behind it still exists. Treat the token
lifetime as your revocation window, and if you need access cut off sooner
than that, contact the base14 team.

### Do I need a separate key for the Scout CLI or MCP?

No. The [Scout CLI](../scout-cli/scout-access/login.md) signs you in
interactively and handles tokens itself, and
[Scout MCP](../scout-mcp/setup.md) uses OAuth browser consent. API keys are
for unattended, server-side access.
