---
title: >
  OpenClaw OpenTelemetry Monitoring - Agent Traces, Token Metrics, and
  Gateway Logs
sidebar_label: OpenClaw
id: collecting-openclaw-telemetry
sidebar_position: 74
description: >
  Collect OpenClaw gateway traces, metrics, and logs with the
  diagnostics-otel plugin and the OpenTelemetry Collector. Track agent runs,
  model calls, tool calls, and token usage in base14 Scout.
keywords:
  - openclaw opentelemetry
  - openclaw otel collector
  - openclaw metrics monitoring
  - openclaw tracing
  - openclaw diagnostics-otel
  - openclaw observability
  - ai agent gateway monitoring
  - openclaw token usage monitoring
---

# OpenClaw

Enable the bundled `diagnostics-otel` plugin in the OpenClaw gateway config
and point it at an OpenTelemetry Collector on port `4318`. The plugin is off
by default and exports over OTLP/HTTP (protobuf). Once it is on, the gateway
exports a trace per agent run, `gen_ai.*` and `openclaw.*` metrics, and logs
that carry the run's trace ID. This guide enables the plugin, configures the
Collector, and sends all three signals to base14 Scout.

Last verified 2026-09-28 with OpenClaw 2026.9.6. OpenClaw releases weekly and
the GenAI semantic conventions are in Development status, so span and
attribute names can change between releases. Pin the gateway image and
re-check the spans after each upgrade.

## Prerequisites

| Requirement            | Minimum  | Recommended |
| ---------------------- | -------- | ----------- |
| OpenClaw               | 2026.9.6 | 2026.9.6    |
| OTel Collector Contrib | 0.144.0  | latest      |
| base14 Scout           | Any      | -           |

Before starting:

- The gateway must reach the Collector's OTLP/HTTP port (`4318`). The plugin
  does not export over gRPC.
- A model provider configured in OpenClaw. The spans and metrics are the same
  on every provider; token and cache counts depend on what the provider
  reports.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

OpenClaw pushes all three signals. There is no scrape endpoint.

| Signal  | What arrives                                                                                  |
| ------- | --------------------------------------------------------------------------------------------- |
| Traces  | One trace per agent turn: the run, context assembly, each model call, and each tool call.      |
| Metrics | `gen_ai.client.*` token and latency histograms, and `openclaw.*` run, queue and process series. |
| Logs    | Gateway log records with subsystem and level attributes, and the trace ID of the run.          |

The tables below group the metrics into Core, Operational and Diagnostic.
The plugin exports cumulative values every `flushIntervalMs`, including when
the gateway is idle.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `gen_ai.client.operation.duration` | Model call latency by `gen_ai.request.model`, `gen_ai.provider.name` and `gen_ai.operation.name`. |
| `gen_ai.client.token.usage` | Tokens per model call, split by `gen_ai.token.type`. |
| `openclaw.run.duration_ms` | Agent run duration by `openclaw.outcome`, `openclaw.model`, `openclaw.provider` and `openclaw.channel`. |
| `openclaw.tokens` | Token counter by `openclaw.token` (`input`, `output`, `prompt`, `total`, `cache_read`) and model. |
| `openclaw.queue.depth` | Queue depth per lane (`main`, `session`), recorded as a histogram. |

There is no `up` metric. Every series is re-exported on each flush, so series
that stop arriving mean the gateway or its exporter has stopped.

### Operational - what to alert on

| Concern | Metric | What it tells you |
|---|---|---|
| Model calls | `openclaw.model_call.duration_ms` | Model call duration by `openclaw.api`, `openclaw.transport` and model. |
| Model calls | `openclaw.model_call.time_to_first_byte_ms` | Time until the provider starts responding. Separates provider queueing from generation. |
| Tools | `openclaw.tool.execution.duration_ms` | Tool call duration by `gen_ai.tool.name`. |
| Queueing | `openclaw.queue.wait_ms` | Time a turn waits in a lane before it runs. |
| Queueing | `openclaw.queue.lane.enqueue`, `openclaw.queue.lane.dequeue` | Turns entering and leaving each lane. A growing gap is a backlog. |
| Context | `openclaw.context.tokens` | Context size, with `openclaw.context=used` and `openclaw.context=limit` as separate series. |
| Sessions | `openclaw.session.state` | Session transitions by `openclaw.state` (`processing`, `idle`) and `openclaw.reason` (`run_started`, `run_completed`). |
| Runs | `openclaw.harness.duration_ms` | Duration of the harness that wraps each run, by `openclaw.outcome`. |

Watch `openclaw.context.tokens` on providers with a fixed context window. A
turn whose `used` value reaches `limit` fails before the
model answers.

### Diagnostic - for investigation and tuning

| Group | Metrics | When you reach for it |
|---|---|---|
| Payload size | `openclaw.model_call.request_bytes`, `openclaw.model_call.response_bytes` | Growing prompts or unexpectedly large responses. |
| Event loop | `openclaw.gateway.event_loop.delay_max_ms`, `openclaw.gateway.event_loop.observed_ms` | A gateway that is slow to accept turns while model calls look normal. |
| Memory | `openclaw.memory.rss_bytes`, `openclaw.memory.heap_used_bytes`, `openclaw.memory.heap_total_bytes`, `openclaw.memory.external_bytes`, `openclaw.memory.array_buffers_bytes` | Memory growth in the gateway process. |
| GC | `openclaw.gc.duration_ms` | Pauses that line up with event loop delay. |
| Exporter | `openclaw.telemetry.exporter.events` | Exporter start-up and state by `openclaw.signal` and `openclaw.status`. |

The Diagnostic series describe the gateway process rather than agent runs.
Drop them in production with a `filter` processor while Core and Operational
stay.

`metricNamePrefix` replaces `openclaw.` on the OpenClaw metrics. The
`gen_ai.client.*` metrics keep their names. This guide uses the default
prefix.

## Key Alerts to Configure

These thresholds are starting points. Set them against a week of your own
baseline.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `gen_ai.client.operation.duration` p95 | 2x baseline | 4x baseline | The provider is slow or overloaded. Check the provider's status, or route the agent to another model. |
| `openclaw.queue.wait_ms` p95 | 2x baseline for 5 min | Rising for 15 min | Turns are waiting for a lane. Look for a stuck run in the traces, or run more gateways. |
| `openclaw.context.tokens` used / limit | 0.8 | 0.95 | Turns are about to fail with a context overflow. Raise the model's context window or trim tools and history. |
| `openclaw.run.duration_ms` p95 | 2x baseline | 4x baseline | Runs are taking more model calls or slower tools. Open a slow trace to see which. |
| Series freshness | No samples for 2 flush intervals | No samples for 5 flush intervals | The gateway or its exporter stopped. |

## Access Setup

The Collector needs no credentials for OpenClaw, because the gateway pushes
to it. Enable the plugin and make sure the gateway can reach the Collector.

The exporter attaches only when three things are on: the plugin in
`plugins.allow` and `plugins.entries`, `diagnostics.enabled`, and
`diagnostics.otel.enabled`. `protocol` must be `http/protobuf`; any other
value leaves plugin export off.

```json showLineNumbers title="openclaw.json"
{
  "plugins": {
    "allow": ["diagnostics-otel"],
    "entries": {
      "diagnostics-otel": { "enabled": true }
    }
  },
  "diagnostics": {
    "enabled": true,
    "otel": {
      "enabled": true,
      "endpoint": "http://otel-collector:4318",
      "protocol": "http/protobuf",
      "serviceName": "openclaw-gateway",
      "traces": true,
      "metrics": true,
      "logs": true,
      "sampleRate": 1.0,
      "flushIntervalMs": 10000
    }
  }
}
```

| Key | Default | Notes |
|---|---|---|
| `endpoint` | unset | Base URL. The plugin appends `/v1/traces`, `/v1/metrics` and `/v1/logs`. |
| `tracesEndpoint`, `metricsEndpoint`, `logsEndpoint` | unset | Exact per-signal URLs, used as given. |
| `serviceName` | `openclaw` | Becomes `service.name`. |
| `traces`, `metrics` | `true` | Turn a signal off. |
| `logs` | `false` | Log export is off until set. |
| `logsExporter` | `otlp` | `otlp`, `stdout` (JSON lines), or `both`. |
| `sampleRate` | unset | Ratio sampler on root spans, `0.0` to `1.0`. Unset keeps every trace. |
| `flushIntervalMs` | unset | Metric export interval, minimum `1000`. |
| `headers` | `{}` | Extra HTTP headers on every export request. |
| `captureContent` | `false` | Leave off unless message content may leave the gateway. |

The standard `OTEL_*` variables work as fallbacks when a key is unset:
`OTEL_EXPORTER_OTLP_ENDPOINT` and its per-signal forms,
`OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, and
`OTEL_TRACES_SAMPLER` with `OTEL_TRACES_SAMPLER_ARG`. Config keys win over
environment variables.

Set this on the gateway process to get the current GenAI span shape, with
`chat {model}` client spans and `gen_ai.provider.name`:

```bash showLineNumbers title=".env (gateway)"
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

Confirm the gateway is up and serving turns before looking at telemetry:

```bash showLineNumbers
# Gateway health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18789/healthz

# A turn through the OpenAI-compatible endpoint
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "openclaw/default", "user": "conv:probe",
       "messages": [{"role": "user", "content": "Say hello."}]}'
```

The endpoint is off by default; enable it with
`gateway.http.endpoints.chatCompletions.enabled`.

## Configuration

The `otlp` receiver takes the pushed signals over HTTP. `service.name` comes
from the plugin's `serviceName`, so the `resource` processor sets only the
environment keys.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    logs:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Using a local model on Ollama

OpenClaw's agent prompt, with its system prompt and tool definitions, is
larger than Ollama's default context of 4096 tokens, and every turn fails
with a context overflow at that size. Set the context on the model entry.
Use the native Ollama API, with no `/v1` on the base URL.

```json showLineNumbers title="openclaw.json (Ollama provider)"
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://host.docker.internal:11434",
        "api": "ollama",
        "models": [
          {
            "id": "qwen3.5:9B",
            "contextWindow": 32768,
            "params": { "num_ctx": 32768 }
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": { "model": { "primary": "ollama/qwen3.5:9B" } }
  }
}
```

Hosted providers need no context setting. Configure them as usual in
`models.providers`; the spans and metrics are the same.

## Collecting traces

Each turn produces one trace:

```text showLineNumbers
openclaw.harness.run                  INTERNAL
└─ openclaw.run                       INTERNAL
   ├─ openclaw.context.assembled      INTERNAL
   ├─ chat {model}                    CLIENT    one per model call
   └─ openclaw.tool.execution         INTERNAL  one per tool call
```

- `openclaw.run` carries `openclaw.outcome`, `openclaw.channel` and
  `openclaw.trigger`.
- `chat {model}` carries `gen_ai.operation.name`, `gen_ai.provider.name`,
  `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens` and
  `gen_ai.usage.cache_creation.input_tokens`, plus `openclaw.model_call.*`
  prompt sizes, request and response bytes, and time to first byte.
- `openclaw.tool.execution` carries `gen_ai.operation.name=execute_tool`,
  `gen_ai.tool.name`, `gen_ai.tool.call.id` and `openclaw.tool.source`.

Two span types arrive as separate traces, not under the run.
`openclaw.model.usage` is emitted once per run. `openclaw.diagnostic.phase`
covers gateway start-up phases, with `openclaw.phase` naming the phase.

Message content is not on the spans while `captureContent` is off.

## Collecting logs

Set `logs: true` in `diagnostics.otel`; it is off by default. Gateway log
lines then arrive as OTLP log records. The record body is the constant
string `log`, and the content is in attributes:

- `openclaw.subsystem` - the part of the gateway that wrote the line, such as
  `gateway` or `agent/embedded`.
- `openclaw.log.level` - `INFO`, `WARN` and so on.
- `openclaw.error` - the error, on records that report one.
- `code.function` and `code.lineno` - where the line was written.

Records written during a run carry that run's trace ID and span ID, so a log
line opens its trace in Scout. Records written outside a run, such as
start-up lines, carry none. Filter and search on the attributes, not the
body.

The plugin exports log records at or above the gateway's `logging.level`.

## Known Gaps

As of OpenClaw 2026.9.6, verified 2026-09-28:

- **No session or conversation ID.** The gateway derives a session key from
  the request's `user` field, but no span, metric or log carries it, and
  `gen_ai.conversation.id` is absent. Turns in the same conversation are
  separate traces with nothing joining them.
- **No `invoke_agent` span.** The agent run is `openclaw.run`, with
  `openclaw.*` attributes only, and no span carries `gen_ai.agent.name`.
- **`openclaw.agent=unknown` on turns from the OpenAI-compatible endpoint.**
  Model and token metrics for those turns cannot be split by agent.
- **`openclaw agent exec` exports nothing.** Runs started from the CLI start
  no exporter
  ([openclaw/openclaw#128806](https://github.com/openclaw/openclaw/issues/128806),
  open).
- **The HTTP endpoint ignores `traceparent`.** A turn sent to
  `/v1/chat/completions` with a `traceparent` header starts a new trace, so
  the caller's trace and the gateway's trace are not linked. OpenClaw
  documents per-request `traceparent` on the gateway WebSocket protocol only.
- **No `gen_ai.response.*` attributes** on `chat {model}` spans.

## Verify the Setup

Send a turn that calls a tool, then look for the spans in the Collector's
output. Add a `debug` exporter to each pipeline while you check.

```bash showLineNumbers
# Generate a run with a model call and a tool call
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "openclaw/default", "user": "conv:verify",
       "messages": [{"role": "user",
         "content": "Use a tool to list the files in your workspace."}]}'

# Spans for the run, the model call and the tool call
docker logs otel-collector 2>&1 \
  | grep -E 'Name +: (openclaw\.run|chat |openclaw\.tool\.execution)'

# GenAI metrics, after one flush interval
docker logs otel-collector 2>&1 | grep -E -- '-> Name: gen_ai\.client\.'

# Log records carrying a trace ID
docker logs otel-collector 2>&1 | grep -cE '^Trace ID: [0-9a-f]{32}$'
```

In Scout, the traces arrive under the `serviceName` you set, with one
`openclaw.harness.run` root per turn.

A complete runnable setup, with a driver script and a check script, is in
[components/openclaw-telemetry](https://github.com/base-14/examples/tree/main/components/openclaw-telemetry).

## What to Look For in Scout

### Find where a slow turn spent its time

Sort `openclaw.run` spans by duration and open the slowest. The children
split the run into context assembly, each `chat {model}` call and each
`openclaw.tool.execution`. If the run has many model calls, the agent is
probably looping. If one tool span takes most of the time, the tool is slow.

### Read tokens by model

Sum `gen_ai.client.token.usage` grouped by `gen_ai.request.model` and
`gen_ai.token.type`. For a single run, sum `gen_ai.usage.input_tokens` and
`gen_ai.usage.output_tokens` on its `chat {model}` spans.

### Go from a warning to the run that caused it

Filter logs on `openclaw.log.level` `WARN` or `ERROR` and group by
`openclaw.subsystem`. Records written during a run open their trace.

## Troubleshooting

### No telemetry arrives at the Collector

**Cause**: The plugin exporter did not attach. It needs the plugin allowed
and enabled, `diagnostics.enabled`, `diagnostics.otel.enabled`, and
`protocol: "http/protobuf"`.

**Fix**:

1. Check all four settings in `openclaw.json` against
   [Access Setup](#access-setup).
2. Confirm `endpoint` points at the Collector's HTTP port (`4318`), not the
   gRPC port (`4317`).
3. Make sure `OTEL_SDK_DISABLED` is not set to `true` on the gateway.
4. Restart the gateway after changing its config.

### Every turn returns HTTP 500

**Cause**: The prompt is larger than the model's context. The gateway log
shows `Context overflow`. This is common on Ollama, whose default context is
4096 tokens.

**Look at**: `openclaw.context.tokens`, comparing the `used` series with
`limit`.

**Fix**:

1. Set `num_ctx` and `contextWindow` on the model entry, as in
   [Using a local model on Ollama](#using-a-local-model-on-ollama).
2. Restart the gateway.

### A turn returns HTTP 400 and no trace appears

**Cause**: The request's `model` field names an agent that does not exist.
The gateway rejects it before a run starts, so nothing is exported.

**Fix**:

1. Use `openclaw/default` or `openclaw/<agent-id>` for an agent that is
   configured.

### Traces arrive but logs do not

**Cause**: `logs` defaults to `false`, or `logsExporter` is `stdout`.

**Fix**:

1. Set `logs: true` and `logsExporter: "otlp"` (or `both`).
2. Confirm the Collector has a `logs` pipeline with the `otlp` receiver.

### Spans show the old GenAI shape without `gen_ai.provider.name`

**Cause**: `OTEL_SEMCONV_STABILITY_OPT_IN` is not set on the gateway
process.

**Fix**:

1. Set `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` in the
   gateway's environment and restart it.

### Runs from `openclaw agent exec` are missing

**Cause**: Known gap. CLI runs start no exporter
([#128806](https://github.com/openclaw/openclaw/issues/128806)).

**Fix**:

1. Send the turn through the gateway instead, over its HTTP or WebSocket
   interface.

### No data appearing in Scout

**Cause**: The Collector receives the signals but the Scout exporter fails.

**Look at**: The Collector log for `otlp_http/b14` errors.

**Fix**:

1. Check `OTEL_EXPORTER_OTLP_ENDPOINT` and the exporter's credentials.
2. Confirm the Collector can reach the Scout endpoint.

## FAQ

### Does OpenClaw support OpenTelemetry?

Yes. OpenClaw bundles the `diagnostics-otel` plugin, which exports traces,
metrics, and logs over OTLP/HTTP (protobuf). It is off by default and is
turned on in the gateway config, with no code changes.

### Is OpenClaw instrumentation automatic?

Yes, once the plugin is enabled. The gateway creates the run, model call and
tool call spans and records the metrics itself. You configure where they go.

### Does OpenClaw export over gRPC?

No. The plugin exports OTLP/HTTP with protobuf only. Point it at the
Collector's port `4318`.

### Does OpenClaw record token usage?

Yes. Each `chat {model}` span carries input, output, cache-read and
cache-creation token counts, and the `gen_ai.client.token.usage` and
`openclaw.tokens` metrics record them per model. Whether cache counts are
non-zero depends on the provider.

### How do I group OpenClaw turns by conversation?

No. OpenClaw 2026.9.6 exports no session or conversation ID, so
each turn is its own trace. See [Known Gaps](#known-gaps).

### Can I capture prompts and responses?

Yes, by setting `captureContent: true` in `diagnostics.otel`. It is off by
default. Turn it on only when conversation content may leave the gateway.

### Does this work with OpenClaw running in Kubernetes?

Yes. Set `diagnostics.otel.endpoint` to the Collector service DNS, for
example `http://otel-collector.observability.svc.cluster.local:4318`, and
set `serviceName` per gateway deployment. See
[Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

### How do I monitor several OpenClaw gateways?

Give each gateway its own `serviceName`, or keep one name and rely on the
`host.name` resource attribute the plugin adds. All gateways can export to
the same Collector.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [AI Agent Observability](../../guides/ai-observability/agent-observability.md)
  \- Agent spans, tool calls and conversation IDs across frameworks.
- [LiteLLM Gateway](./litellm.md) - Monitor a LiteLLM proxy placed between
  OpenClaw and its providers.
- [vLLM](./vllm.md) - Monitor a self-hosted model server that OpenClaw calls.

## What's Next?

- **Create Dashboards**: Chart run duration, model latency and tokens per
  model. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
  and [LLM observability in Scout](https://base14.io/scout/llm-observability).
- **Query Scout from an agent**: The
  [Scout MCP server](../../scout-mcp/setup.md) gives an MCP client read
  access to the traces, metrics and logs in Scout.
- **Fine-tune Collection**: Lower `sampleRate` on busy gateways, and drop
  the Diagnostic metrics with a `filter` processor.
