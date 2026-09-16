---
title: Errors
sidebar_label: Errors
description:
  The Scout API error response format, the HTTP status codes it returns,
  and how to handle each one.
keywords:
  - scout api errors
  - api error codes
  - http status codes
  - error handling
---

# Errors

The Scout API signals failure with HTTP status codes and returns a JSON
body describing what went wrong.

## Error format

```json
{
  "code": "Bad Request",
  "message": "end_time must be after start_time"
}
```

| Field | Description |
| --- | --- |
| `code` | A short classifier for the failure |
| `message` | A human-readable explanation. Intended for logs and operators, not for end users |

Errors raised by the authentication layer carry an additional `error`
field, which repeats `message`:

```json
{
  "error": "forbidden",
  "code": "forbidden",
  "message": "forbidden"
}
```

:::note
`code` is not drawn from a single vocabulary. Telemetry, RUM and APM
endpoints return the HTTP reason phrase — `"Bad Request"`,
`"Internal Server Error"` — while the authentication layer returns
lowercase identifiers such as `"unauthorized"` and `"forbidden"`.

Branch on the HTTP status code, and use `code` only to distinguish cases
within a status. Never match on `message`; the wording changes.
:::

## Status codes

| Status | Meaning | What to do |
| --- | --- | --- |
| `200` | Success | — |
| `400` | Invalid request — a malformed timestamp, a missing required parameter, or a time window wider than the endpoint allows | Fix the request. Retrying unchanged will not help |
| `401` | Missing, malformed or expired token | Get a new token and retry once. See [Authentication](./authentication.md#401-unauthorized) |
| `403` | Valid token, insufficient role | Check the key has the **Scout Read** role. Do not retry |
| `404` | The resource does not exist, or has no data in the requested window | Widen the window or check the identifier |
| `500` | Server error | Retry with backoff. If it persists, contact support |
| `503` | A dependency is unavailable | Retry with backoff |

## Handling errors

A workable policy for an unattended client:

- **`400`, `403`, `404`** — do not retry. The request is wrong, and
  repeating it just adds load. Log the `message` and surface it.
- **`401`** — refresh the token and retry once. If the retry also returns
  `401`, the credentials are wrong, not stale.
- **`500`, `503`** — retry with exponential backoff and a cap. These are
  usually transient.
- **`429`** — nothing returns this today, but handle it as a backoff case
  so a future rate limit does not break your integration.

```python
import time
import requests

RETRYABLE = {500, 503, 429}

def scout_get(session, url, token_provider, params=None, attempts=4):
    for attempt in range(attempts):
        r = session.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {token_provider.get()}"},
            timeout=30,
        )
        if r.status_code == 200:
            return r.json()
        if r.status_code == 401 and attempt == 0:
            token_provider.invalidate()   # force a fresh token, retry once
            continue
        if r.status_code not in RETRYABLE:
            body = r.json()
            raise RuntimeError(
                f"{r.status_code} {body.get('code')}: {body.get('message')}"
            )
        time.sleep(2**attempt)
    raise RuntimeError(f"giving up after {attempts} attempts: {url}")
```

Note the `401` branch retries only once. A token that is rejected twice in
a row is not an expiry problem.

## FAQ

### Should I match on the error code or the message?

Neither alone. Branch on the HTTP status code first, then use `code` to
tell apart cases that share a status. `message` is free text and its
wording is not stable.

### Why did a query that worked yesterday start returning 400?

The most common cause is a time window computed relative to now that has
grown past the endpoint's maximum — for example a job that widens its
lookback after a failure. Check the window against the
[maximum windows table](./conventions.md#maximum-windows).

### What does a 404 mean on a query endpoint?

Usually that the identifier does not exist within the window you asked
for, rather than that it never existed. A trace ID outside the requested
time range returns `404`. Widen the range before concluding the data is
missing.
