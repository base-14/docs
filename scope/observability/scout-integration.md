---
title: Scout Integration
sidebar_position: 1
description: How Scope integrates with Scout for LLM observability — data flow, prerequisites, and configuration.
keywords: [scope scout integration, llm observability, opentelemetry, trace integration, scout api]
---

# Scout Integration

Scope integrates with Scout, base14's observability platform, to provide
end-to-end visibility into LLM prompt executions. This page covers how the
integration works, prerequisites, and configuration.

## Overview

Scout is an OpenTelemetry-native observability platform that collects traces,
metrics, and logs from your applications. Scope extends this by recording prompt
execution data as OpenTelemetry spans, which flow into Scout's data lake.

This integration enables:

- **Trace correlation** — link prompt executions to application requests and
  downstream operations
- **Performance dashboards** — visualize prompt latency, token usage, and cost
  trends in Scout
- **Alerting** — set up alerts on prompt error rates, latency spikes, or cost
  anomalies
- **Historical analysis** — query and analyze prompt execution data alongside
  application telemetry

## Data Flow

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Application │     │   Scope API  │     │    Scout     │
│              │     │              │     │              │
│  SDK call    ├────►│  Execute     ├────►│  OTel Spans  │
│  or API call │     │  prompt      │     │  + Metrics   │
│              │     │              │     │              │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                    │
                            │                    ▼
                            │              ┌──────────────┐
                            └─────────────►│  Scope UI    │
                                           │  (Traces)    │
                                           └──────────────┘
```

1. Your application calls the Scope API (via SDK or REST) to execute a prompt
2. Scope executes the prompt against the configured LLM provider
3. Scope records the execution as an OpenTelemetry span and sends it to Scout
4. The trace appears in both Scout (for full-stack observability) and Scope (for
  prompt-specific analysis)

## What Gets Recorded

Each prompt execution span includes:

| Attribute | Description |
|-----------|-------------|
| `scope.prompt.id` | Prompt identifier |
| `scope.prompt.name` | Prompt name |
| `scope.prompt.version` | Version number |
| `scope.prompt.version_id` | Version identifier |
| `scope.provider.id` | Provider identifier |
| `scope.provider.name` | Provider name (e.g., `openai`) |
| `scope.model.id` | Model identifier |
| `scope.model.external_id` | Provider's model name (e.g., `gpt-4o`) |
| `llm.prompt_tokens` | Input token count |
| `llm.completion_tokens` | Output token count |
| `llm.total_tokens` | Total token count |
| `llm.latency_ms` | Execution latency |
| `llm.cost` | Estimated cost |

## Prerequisites

To enable the Scout integration:

1. **Scout account** — your base14 account must have Scout enabled
2. **Scout API access** — obtain the Scout API URL and API key
3. **Network connectivity** — Scope must be able to reach the Scout API
  endpoints

## Configuration

### Environment Variables

Set the following on your Scope deployment:

```bash
# Scout API endpoints (comma-separated for multiple regions)
export SCOUT_API_URLS="https://scout-api.example.com"

# Scout API key for authentication
export SCOUT_API_KEY="scout_key_01ABC..."

# OpenTelemetry collector endpoint (optional, for direct OTel export)
export OTEL_EXPORTER_OTLP_ENDPOINT="https://otel-collector.example.com:4317"
```

### Multiple Scout Instances

If you run Scout in multiple regions, provide all API URLs as a comma-separated
list:

```bash
export SCOUT_API_URLS="https://scout-us.example.com,https://scout-eu.example.com"
```

Scope sends traces to all configured endpoints.

## Viewing Traces in Scope

Once configured, traces appear in the Scope UI under **Traces**. See [Viewing
Traces](./viewing-traces.md) for details on browsing, filtering, and
analyzing trace data.

## Viewing Traces in Scout

In Scout, prompt execution spans appear as part of your application's
distributed traces. You can:

- **Search** for spans with `scope.prompt.name` attributes
- **Build dashboards** with prompt-specific metrics (latency, tokens, cost)
- **Set alerts** on prompt error rates or latency thresholds
- **Correlate** prompt executions with upstream HTTP requests, database queries,
  and downstream service calls

## Troubleshooting

| Issue | Possible Cause | Resolution |
|-------|---------------|------------|
| No traces in Scope | `SCOUT_API_URLS` not set | Set the Scout API URL in environment variables |
| No traces in Scout | Network connectivity | Verify Scope can reach the Scout API endpoints |
| Missing attributes | Older Scope version | Update Scope to the latest version |
| High latency on trace export | Collector overloaded | Scale the OTel collector or increase batch size |

## Next Steps

- [Viewing Traces](./viewing-traces.md) — browse and filter traces in Scope
- [Architecture](../architecture/index.md) — how Scope and Scout fit together
