---
sidebar_position: 7
title: Base14 Evals API and MCP server
sidebar_label: API and MCP
description:
  Authenticate to the Base14 Evals public API, find the endpoints for traces,
  scores, datasets, prompts, and metrics, and connect AI agents over MCP.
keywords:
  [llm observability api, evals rest api, mcp server, openapi, base14 evals api]
---

# API and MCP server

Everything in the UI is also available through the public REST API. The SDKs
use the same API.

## Authentication

Use the project's API keys with HTTP Basic auth: the public key is the
username and the secret key is the password.

```bash
curl -u "pk-lf-...:sk-lf-..." "https://<your-evals-host>/api/public/projects"
```

The response names the project the keys belong to, which makes it a quick
check that a key pair works. Create keys under **Settings → API Keys**. Keys
are scoped to one project.

## Endpoints

All endpoints live under `https://<your-evals-host>/api/public/`. The main
groups:

| Area | Endpoints | Use it to |
| --- | --- | --- |
| Ingestion | `otel/v1/traces`, `ingestion` | Send traces (the SDKs do this for you) |
| Observations | `v2/observations` | Read observations with filters and field selection |
| Traces and sessions | `traces`, `sessions` | Read or delete traces, list sessions |
| Scores | `scores`, `v2/scores`, `score-configs` | Create and read scores |
| Datasets | `datasets`, `dataset-items`, `dataset-run-items` | Manage datasets and runs |
| Prompts | `v2/prompts` | Create, fetch, and label prompts |
| Metrics | `v2/metrics` | Aggregate usage, cost, latency, and scores |
| Models | `models` | Manage model prices |
| Annotation | `annotation-queues`, `comments` | Manage review queues and comments |
| LLM connections | `llm-connections` | Manage evaluator and playground connections |
| Health | `health`, `ready` | Uptime checks (no auth needed) |

The full OpenAPI specification is served by your instance at
`https://<your-evals-host>/generated/api/openapi.yml`. Load it into Postman
or an API client generator for request and response details.

For aggregated numbers, the metrics endpoint is faster than reading
observations one by one. See [Dashboards, usage, and cost](./dashboards-and-cost.md#metrics-api).

## MCP server

Evals includes a Model Context Protocol server, so coding agents and AI
assistants can read prompts and traces from your project. It is at
`https://<your-evals-host>/api/public/mcp` and uses the same Basic auth.

```bash
TOKEN=$(printf '%s' "pk-lf-...:sk-lf-..." | base64)
claude mcp add --transport http base14-evals \
  https://<your-evals-host>/api/public/mcp \
  --header "Authorization: Basic ${TOKEN}"
```

**Settings → MCP & CLI** in your project shows the same setup with your
host filled in.

## Exports

To get data out in bulk, filter any table (traces, observations, scores) and
select **Export**. Exports run in the background; download the CSV or JSON
file from **Settings → Exports** when it is ready.
