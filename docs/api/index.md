---
title: Scout API
sidebar_label: Overview
description:
  Query your Scout observability data over HTTP — traces, logs, metrics,
  service topology, APM rollups and RUM.
keywords:
  - scout api
  - observability api
  - rest api
  - opentelemetry api
  - query traces api
  - query logs api
---

# Scout API

The Scout API gives you the same data the Scout UI runs on: distributed
traces, logs, metrics, service topology, APM rollups and real user
monitoring. Use it to pull telemetry into your own tools, build reports,
or wire observability data into automation.

Every endpoint is read-only and returns JSON.

## Before you start

Four things go into every request:

| What you need | Where it comes from |
| --- | --- |
| An API base URL | Returned by the discovery endpoint; specific to your organization. See [Quickstart](./quickstart.md) |
| An access token | Obtained by exchanging an API key at the base14 identity service |
| A service name | Almost every query is scoped to one service |
| A time range | `start_time` and `end_time`, RFC3339, with a maximum window per endpoint |

If you only want to run a query, the [quickstart](./quickstart.md) gets you
from an API key to a result in four commands.

## How the docs are organised

- **[Quickstart](./quickstart.md)** — create a key, get a token, find your
  base URL, run your first query.
- **[Authentication](./authentication.md)** — the client credentials grant,
  token lifetime, and what a 401 or 403 actually means.
- **[Conventions](./conventions.md)** — time ranges, the attribute filter
  syntax, pagination, and result limits. Read this before writing anything
  non-trivial.
- **[Errors](./errors.md)** — the error envelope and the status codes.
- **[Endpoint reference](./reference/scout-api.info.mdx)** — every endpoint,
  its parameters and its response schema, generated from the API
  specification.

## Other ways in

The API is not always the shortest path.

- **[Scout CLI](../scout-cli/index.md)** wraps these endpoints with
  authentication, base URL discovery and output formatting already handled.
  For ad-hoc querying it is usually faster than curl.
- **[Scout MCP](../scout-mcp/setup.md)** exposes the same data to LLM tools
  such as Claude Code, using OAuth rather than API keys.

Reach for the HTTP API when you are building something that runs
unattended, or when you need a response shape the CLI does not produce.

## Limits worth knowing up front

- **Query windows are capped per endpoint**, from 15 minutes on logs up to
  30 days on APM, and `start_time` cannot be more than 30 days ago.
  Exceeding either returns `400` rather than silently truncating.
- **There is no rate limiting today**, so per-request `limit` caps are the
  real constraint.
- **The API sends no CORS headers**, so it cannot be called from browser
  JavaScript.

[Conventions](./conventions.md) covers all three in full.
