---
title: Quickstart
sidebar_label: Quickstart
description:
  Go from a Scout API key to your first query in four steps — create a key,
  get an access token, discover your base URL, and query a service.
keywords:
  - scout api quickstart
  - scout api key
  - client credentials
  - bearer token
  - scout api base url
---

# Quickstart

This page takes you from nothing to a working query. It uses `acme` as the
organization slug throughout — substitute your own. The Scout CLI calls the
same value the *account slug*; they are interchangeable.

You need admin access to your Scout organization to create an API key. If
you do not have it, ask your organization admin.

## 1. Create an API key

Open the API keys page for your organization:

```text
https://console.base14.io/acme/api-keys
```

You will be redirected to sign in if you do not have a session.

Select **Create API Key**, give it a name and a prefix that will make it
recognisable later, and choose the **Scout Read** role. Scout Read grants
read access to all the endpoints documented here.

Copy the generated **client ID** and **client secret** somewhere safe. The
secret is shown once and cannot be retrieved again.

:::tip
Create a separate key per integration rather than sharing one. Keys can be
revoked individually, so a per-integration key means revoking one does not
break everything else.
:::

## 2. Get an access token

Exchange the client ID and secret for an access token using the OAuth 2.0
client credentials grant. The realm in the URL is your organization slug:

```bash
export CLIENT_ID="<your-client-id>"
export CLIENT_SECRET="<your-client-secret>"
export ORG="acme"

ACCESS_TOKEN=$(curl -s -X POST \
  "https://id.base14.io/realms/$ORG/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  | jq -r .access_token)
```

Tokens are short-lived. Request a new one when it expires rather than
caching it indefinitely — see [Authentication](./authentication.md).

## 3. Find your base URL

Your Scout API base URL depends on the region your organization is
provisioned in. Rather than hardcoding it, ask the discovery endpoint:

```bash
SCOUT_API_URL=$(curl -s \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://api.base14.io/v1/discovery/services/$ORG" \
  | jq -r .scoutApiUrl)

echo "$SCOUT_API_URL"
```

The result looks like `https://api.use1-scout.base14.io/acme`. Append
`/api/v1` to get the **API base URL** every path in the reference is
relative to.

:::note
Discover the URL rather than hardcoding it. Regions and hostnames can
change, and an integration that reads this value at startup keeps working
when they do.
:::

## 4. Run your first query

List the services active in the last five minutes. The list comes from the
dependency graph, so it covers services that call something else; leaf-only
infrastructure such as a database host is not included:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$SCOUT_API_URL/api/v1/services" | jq
```

Take a service name from that response and query its logs. Note that
`start_time` and `end_time` are required, and the window for logs cannot
exceed 15 minutes:

```bash
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START=$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)   # GNU date: -d '5 minutes ago'

curl -s -G -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$SCOUT_API_URL/api/v1/telemetry/logs" \
  --data-urlencode "service_name=checkout" \
  --data-urlencode "start_time=$START" \
  --data-urlencode "end_time=$END" \
  --data-urlencode "severity=ERROR" \
  --data-urlencode "limit=20" | jq '.logs[] | {timestamp, severity, body}'
```

Everything else is a different endpoint with different parameters.

## Where to go next

- [Conventions](./conventions.md) — time windows, the attribute filter
  syntax, and pagination.
- [Errors](./errors.md) — what the status codes mean.
- [Endpoint reference](./reference/scout-api.info.mdx) — every endpoint and
  its parameters.

## FAQ

### Why does my request return 401?

The token is missing, malformed, or expired. Tokens are short-lived, so a
long-running process that fetches a token once at startup will start
failing. Request a new token and retry.

### Why does my request return 403 when the token is valid?

The API key does not carry the role the endpoint needs. Read endpoints
require the **Scout Read** role, granted when the key is created. Create a
new key with the correct role — an existing key's roles cannot be changed.

### Can I call the Scout API from browser JavaScript?

No. The API does not return CORS headers, so a browser will block the
request at preflight. Call it from a server-side process instead.

### How do I find my organization slug?

It is the path segment in your Scout console URL. If you sign in at
`https://console.base14.io/acme/`, your slug is `acme`. It is also the
realm name in the token URL, and what the Scout CLI calls the account
slug.
