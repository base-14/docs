---
sidebar_position: 6
title: Dashboards, usage, and cost
sidebar_label: Dashboards, usage, and cost
description:
  Track LLM token usage, cost, latency, and quality in Base14 Evals with
  built-in and custom dashboards, model prices, and the metrics API.
keywords:
  [llm cost tracking, llm token usage, llm dashboards, model pricing, metrics api]
---

# Dashboards, usage, and cost

Evals records token usage and cost for every model call, so you can see what
each model, feature, user, and evaluator costs without reading provider bills.

## How usage and cost are recorded

Each generation stores:

- **Usage**: input, output, and total tokens, plus provider-specific counts
  such as cached or reasoning tokens. The SDK integrations read these from
  the model's response.
- **Cost**: taken from the SDK if your code sends it. Otherwise Evals
  calculates it at ingestion by multiplying usage by the model's price.

Some frameworks only report usage when asked. With the OpenAI Agents SDK,
set `ModelSettings(include_usage=True)`.

## Model prices

Evals ships prices for common OpenAI, Anthropic, and Google models and
matches them on the generation's model name. For any other model, such as a
Bedrock model ID, a Fireworks model, or a fine-tune, add a definition under
**Settings → Model Definitions**:

- **Match pattern**: a regular expression on the model name, for example
  `(?i)^accounts/fireworks/models/llama-v3p1-70b-instruct$`.
- **Prices**: a price per token for each usage type, such as `input` and
  `output`.

Without a matching definition, the model's cost shows as zero while its
token counts are still recorded. Prices apply to generations ingested after
you add them.

## Dashboards

**Home** shows an overview of traces, cost, scores, and latency for the
project. **Dashboards** has more built-in views:

| Dashboard | Shows |
| --- | --- |
| Cost Dashboard | LLM cost over time and by model |
| Latency Dashboard | Latency across traces and generations |
| Usage Management | Usage across traces, observations, and scores |
| Agent Dashboard | Tool calls, most-called tools, tool errors and latency, observation types |

Built-in dashboards are read-only. Clone one, or create a new dashboard, to
build your own from widgets. A widget picks a view (traces, observations, or
scores), measures such as count, latency, tokens, or cost, a breakdown such
as model or user, filters, and a chart type.

Evaluator calls are traced in your project with the environment
`langfuse-llm-as-a-judge`. Filter on it to see what evaluation costs, or
exclude it to see only your application.

## Metrics API

Query the same data from scripts or other tools with
`GET /api/public/v2/metrics`. The `query` parameter is a JSON object:

```json
{
  "view": "observations",
  "metrics": [
    { "measure": "totalTokens", "aggregation": "sum" },
    { "measure": "totalCost", "aggregation": "sum" }
  ],
  "dimensions": [{ "field": "providedModelName" }],
  "filters": [],
  "timeDimension": { "granularity": "day" },
  "fromTimestamp": "2026-09-01T00:00:00Z",
  "toTimestamp": "2026-10-01T00:00:00Z"
}
```

```bash
curl -u "pk-lf-...:sk-lf-..." -G \
  "https://<your-evals-host>/api/public/v2/metrics" \
  --data-urlencode "query=$(cat query.json)"
```

Other useful dimensions include `environment`, `userId`, `traceName`, and
`name`. See [API](./api.md) for authentication.
