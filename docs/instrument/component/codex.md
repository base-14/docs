---
title: >
  OpenAI Codex CLI OpenTelemetry Monitoring - Traces, Metrics and Logs
sidebar_label: Codex CLI
id: collecting-codex-telemetry
sidebar_position: 76
description: >
  Collect OpenAI Codex CLI traces, metrics and logs with the OpenTelemetry
  Collector. Track turns, tokens, model requests and tool calls in base14
  Scout.
keywords:
  - codex opentelemetry
  - openai codex monitoring
  - codex cli telemetry
  - codex otel config
  - codex token usage
  - coding agent observability
  - codex traces
  - codex exec telemetry
---

# Codex CLI

Add an `[otel]` table to `~/.codex/config.toml` with an OTLP exporter for
each signal, and point them at an OpenTelemetry Collector. Export is off by
default. Once it is on, Codex exports traces of each turn, `codex.*` metrics
for turns, tokens, model requests and tool calls, and a log record per
event. This guide sets the exporters, configures the Collector, and sends all
three signals to base14 Scout.

Last verified 2026-10-04 with Codex CLI 0.160.0, run headless with
`codex exec` on a local model. Codex exports its internal tracing spans, and
span, metric and attribute names can change between releases. Pin the
version you roll out and re-check after each upgrade.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Codex CLI              | 0.160.0 | 0.160.0     |
| OTel Collector Contrib | 0.144.0 | latest      |
| base14 Scout           | Any     | -           |

Before starting:

- Every machine that runs Codex must reach the Collector's OTLP port, `4318`
  for HTTP or `4317` for gRPC.
- A model provider for Codex: an OpenAI account or API key, or a local model.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Codex pushes all three signals. There is no scrape endpoint.

| Signal  | What arrives                                                                               |
| ------- | ------------------------------------------------------------------------------------------ |
| Traces  | Several traces per turn. The main one covers the turn, each model request and each tool call. |
| Metrics | `codex.*` counters and histograms for turns, tokens, model requests, tools and start-up.    |
| Logs    | One record per event: prompts, model requests, stream events, tool decisions and results.   |

The tables below group the metrics into Core, Operational and Diagnostic.
Every metric uses delta temporality. Most carry `model`, `app.version`,
`originator` and `session_source`. None carries a user or conversation ID.

### Core - is it working and what does it use

| Metric | What it tells you |
|---|---|
| `codex.turn.e2e_duration_ms` | Duration of a whole turn, from prompt to final answer. |
| `codex.turn.token_usage` | Tokens per turn by `token_type`: `input`, `cached_input`, `cache_write_input`, `output`, `reasoning_output`, `total`. |
| `codex.api_request` | Model requests by `status` and `success`. |
| `codex.api_request.duration_ms` | Model request duration by `status` and `success`. |
| `codex.conversation.turn.count` | Turns run. |
| `codex.thread.started` | Threads started, by `is_git` and `is_worktree`. |

### Operational - what to alert on

| Concern | Metric | What it tells you |
|---|---|---|
| Responsiveness | `codex.turn.ttft.duration_ms` | Time to the first token of a turn. |
| Responsiveness | `codex.turn.ttfm.duration_ms` | Time to the first model output item of a turn. |
| Tools | `codex.tool.call` | Tool calls by `tool`, `success`, `command_category` and `sandbox_policy`. |
| Tools | `codex.tool.call.duration_ms` | Tool call duration, same attributes. |
| Tools | `codex.turn.tool.call` | Tool calls per turn. |
| Streaming | `codex.sse_event`, `codex.sse_event.duration_ms` | Stream events from the model by `kind`. |

### Diagnostic - for investigation and tuning

| Group | Metrics | When you reach for it |
|---|---|---|
| Start-up | `codex.startup.phase.duration_ms`, `codex.process.start`, `codex.shell_snapshot.duration_ms` | Codex is slow to start a thread. |
| Local state | `codex.sqlite.init.duration_ms`, `codex.db.backfill`, `codex.rollout.size_bytes` | Slow start-up tied to local databases or large session files. |
| Skills and plugins | `codex.thread.skills.enabled_total`, `codex.skills.shadow_selection`, `codex.plugins.loaded_cache.request` | How many skills load per thread and how plugin caches behave. |

The Diagnostic series describe the Codex process, not the work it does. Drop
them in production with a `filter` processor while Core and Operational
stay.

## Key Alerts to Configure

These thresholds are starting points. Set them against a week of your own
baseline.

| Signal | Warning | Critical | Why it matters |
|---|---|---|---|
| `codex.api_request` with `success` `false` | 2x baseline ratio | Sustained for 15 min | Requests to the model provider are failing. Check `status`. |
| `codex.turn.e2e_duration_ms` p95 | 2x baseline | 4x baseline | Turns take more model requests or slower tools. Open a slow `turn/start` trace. |
| `codex.tool.call` with `success` `false` | 2x baseline ratio | 4x baseline ratio | Tool calls are being rejected. Group by `tool`. |
| `codex.turn.token_usage` `total` p95 | 2x baseline | Near the model's context window | Context is growing turn over turn. |

## Access Setup

The Collector needs no credentials for Codex, because Codex pushes to it.
Each signal has its own exporter key, and a signal without one is not sent
to your Collector.

```toml showLineNumbers title="~/.codex/config.toml"
[otel]
environment = "production"
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://otel-collector:4318/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "http://otel-collector:4318/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "http://otel-collector:4318/v1/metrics", protocol = "binary" } }
```

| Key | Default | Notes |
|---|---|---|
| `exporter` | `none` | The log exporter: `otlp-http` or `otlp-grpc`, with `endpoint`. |
| `trace_exporter` | unset | The trace exporter, same form. No traces without it. |
| `metrics_exporter` | `statsig` | The metrics exporter, same form. Set it, or metrics do not reach your Collector. |
| `protocol` | - | `binary` or `json`, on `otlp-http`. |
| `headers` | - | Static headers on export requests, for a Collector that needs authentication. |
| `environment` | `dev` | Sent as the `env` resource attribute. |
| `log_user_prompt` | `false` | `true` puts prompt text on `codex.user_prompt` events. |

Each `otlp-http` endpoint here is the full URL for its signal, including
`/v1/logs`, `/v1/traces` or `/v1/metrics`. OpenAI's
[configuration reference](https://developers.openai.com/codex/config-reference)
lists every `otel` key, including TLS settings.

Codex reads `config.toml` from the directory in `CODEX_HOME`, `~/.codex` by
default.

With `log_user_prompt` off, `prompt` is `[REDACTED]`. `codex.tool_result`
records still hold content: `arguments` is the full command line or patch
body, and `output` is the command's output, including any file contents it
printed. Drop both attributes in the Collector if they must not leave the
machine.

Confirm Codex runs before looking at telemetry:

```bash showLineNumbers
codex --version
codex exec "Say hello."
```

## Configuration

The `otlp` receiver takes the pushed signals. Codex sets `service.name` to
`codex_exec` for headless runs, so the `resource` processor sets only the
environment keys. The `filter` processor drops the per-chunk stream events.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  filter/codex_stream_events:
    error_mode: ignore
    logs:
      log_record:
        - attributes["event.name"] == "codex.sse_event" and attributes["event.kind"] != "response.completed"

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
      processors: [filter/codex_stream_events, resource, batch]
      exporters: [otlp_http/b14]
```

Codex writes one `codex.sse_event` log record for every chunk the model
streams, so a single answer produces many records. The filter keeps the
`response.completed` records. Codex writes two per model request, and one
carries the token counts.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Using a local model on Ollama

Codex has a built-in `ollama` provider. Select it and the model at the top
of the config, above the `[otel]` table. Keys placed below a table header
belong to that table.

```toml showLineNumbers title="~/.codex/config.toml"
model = "qwen3.5-32k"
model_provider = "ollama"
```

Two things matter on a local model:

- **Context.** Codex's prompt and tool definitions are larger than Ollama's
  default context. Create a model tag with a larger `num_ctx`.
- **Do not pass `--oss`.** With `--oss`, Codex ignores `model` and starts
  downloading `gpt-oss:20b` into Ollama.

```text showLineNumbers title="Modelfile"
FROM qwen3.5:9B
PARAMETER num_ctx 32768
```

```bash showLineNumbers title="Terminal"
ollama create qwen3.5-32k -f Modelfile
```

## Collecting traces

Set `trace_exporter`. Codex exports its internal tracing spans, so span
names are function and RPC method names. A turn's main trace has this spine:

```text showLineNumbers
turn/start                            SERVER    the turn
└─ session_task.turn                  INTERNAL  model and token totals
   └─ run_sampling_request            INTERNAL  one per model request
      ├─ model_client.stream_responses_api      the request to the provider
      └─ handle_responses             INTERNAL  one per stream event
         └─ exec_command              INTERNAL  one per shell command
```

Other spans sit between and around these.

- `session_task.turn` carries `turn.id`, `model` and
  `codex.turn.token_usage.input_tokens`, `.cached_input_tokens`,
  `.output_tokens`, `.reasoning_output_tokens` and `.total_tokens`.
- `handle_responses` is one span per stream event. The last one of each
  model request carries `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens` and
  `codex.usage.total_tokens`.
- `model_client.stream_responses_api` carries `model`, `wire_api` and
  `api.path`.
- `exec_command` carries `tool_name` and `call_id`. A patch is an
  `apply_patch` span in the same place.
- Every span carries the `code.file.path` it was created at. `thread.id` on
  a span is the operating system thread, not the Codex thread. To go from a
  conversation to its traces, start from an event, which carries both
  `conversation.id` and the trace ID.

Each turn also produces separate traces rooted at `thread/start`,
`codex.exec` and `initialize`, and single-span traces named `auth` and
`fs.read_file` for the calls made outside a turn.

To put a headless run under your own span, set `TRACEPARENT` in its
environment. The turn's root spans become children of that span.

```bash showLineNumbers
TRACEPARENT=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01 \
  codex exec "Summarise notes.txt in one sentence."
```

## Collecting logs

Set `exporter`. Each event arrives as one OTLP log record with severity
`INFO` and an empty body. The event is in the `event.name` attribute. Codex
also writes a few `DEBUG` records with a body and no `event.name`, such as
`flushing OTEL metrics`.

| Event | Key attributes |
|---|---|
| `codex.conversation_starts` | `provider_name`, `approval_policy`, `sandbox_policy`. |
| `codex.user_prompt` | `prompt_length`; `prompt` is `[REDACTED]` by default. |
| `codex.api_request` | `duration_ms`, `http.response.status_code`, `attempt`, `endpoint`. |
| `codex.sse_event` | `event.kind`; on `response.completed`, `input_token_count`, `output_token_count`, `cached_token_count`, `reasoning_token_count`. |
| `codex.tool_decision` | `tool_name`, `decision`, `source`, `call_id`. |
| `codex.tool_result` | `tool_name`, `success`, `duration_ms`, `arguments`, `output`, `call_id`. |
| `codex.sandbox_outcome` | `tool_name`, `outcome`, `call_id`. |
| `codex.turn_ttft` | `duration_ms`. |

Every event record carries `conversation.id`, `model`, `app.version` and
`originator`. `conversation.id` is the thread ID, and a resumed thread keeps
it. Records other than `codex.sse_event` carry the trace ID and span ID of
the active span, so an event opens its trace in Scout.

Filter and search on the attributes, not the body. Some numeric fields,
such as `duration_ms`, `input_token_count` and `output_token_count`, arrive
as strings.

## Known Gaps

As of Codex CLI 0.160.0, verified 2026-10-04:

- **Spans do not follow the GenAI conventions.** Spans are named after
  internal functions, with no `gen_ai.operation.name`,
  `gen_ai.request.model`, `gen_ai.provider.name` or `gen_ai.conversation.id`.
  The only `gen_ai.*` attributes are the `gen_ai.usage.*` token counts on
  `handle_responses`. Dashboards built on `chat {model}` and `execute_tool`
  spans do not pick these spans up.
- **No GenAI metrics.** `gen_ai.client.token.usage` and
  `gen_ai.client.operation.duration` are absent. Tokens are in
  `codex.turn.token_usage`.
- **No cost.** No metric, span or event carries a cost.
- **A turn is several traces.** The turn, the thread start and the
  `codex.exec` wrapper are separate traces, and `auth` and `fs.read_file`
  calls made outside a turn are traces of one span.
- **`success` on `codex.tool_result` is not the command's exit status.** It
  is `true` for a shell command that exits non-zero and for one the sandbox
  denies. A sandbox denial is in `codex.sandbox_outcome`.
- **No span status.** Every span is `Unset`, including failed commands.
- **No conversation ID on most spans, and none on metrics.** Events carry
  `conversation.id`. Among spans, only `unified_exec.exec_command` does.
  Metrics carry no user, conversation or thread ID, so per-thread views come
  from the events.
- **`provider_name` is `gpt-oss` on the built-in Ollama provider.**

## Verify the Setup

Run one prompt that calls a tool, then look for the spans in the Collector's
output. Add a `debug` exporter with `verbosity: detailed` to each pipeline
while you check.

```bash showLineNumbers
# Generate a turn with a model request and a shell command
codex exec "Run ls and count the files."

# Spans for the turn, the model request and the command
docker logs otel-collector 2>&1 \
  | grep -E 'Name +: (turn/start|run_sampling_request|exec_command)$'

# Metrics
docker logs otel-collector 2>&1 | grep -E -- '-> Name: codex\.turn\.'

# Events
docker logs otel-collector 2>&1 | grep -E -- '-> event.name: Str\(codex\.'
```

In Scout, the signals arrive under the service `codex_exec`.

A complete runnable setup, with a driver script and a check script, is in
[components/codex-telemetry](https://github.com/base-14/examples/tree/main/components/codex-telemetry).

## What to Look For in Scout

### Find where a slow turn spent its time

Sort `turn/start` spans by duration and open the slowest. Compare the
`run_sampling_request` spans with the `exec_command` spans under them. Many
model requests mean a long tool loop. One long `exec_command` means a slow
command.

### Read tokens by model

Read `codex.turn.token_usage` grouped by `model` and `token_type`. For one
turn, read the `codex.turn.token_usage.*` attributes on its
`session_task.turn` span.

### Follow one conversation

Filter events on `conversation.id`. `codex.user_prompt`, `codex.api_request`,
`codex.tool_decision` and `codex.tool_result` give the turn in order, and
each opens its trace.

### Find sandbox denials

Filter events on `codex.sandbox_outcome` with `outcome` `denied`, and join
`codex.tool_result` on `call_id` for the command line.

## Troubleshooting

### No telemetry arrives at the Collector

**Cause**: `exporter` defaults to `none`, or Codex is reading a different
config file.

**Fix**:

1. Check the `[otel]` table against [Access Setup](#access-setup).
2. Check `CODEX_HOME`. Codex reads `config.toml` from that directory.
3. Use the full signal path on each `otlp-http` endpoint, such as
   `/v1/logs`.

### Logs arrive but metrics or traces do not

**Cause**: Each signal has its own exporter key.

**Fix**:

1. Set `metrics_exporter` and `trace_exporter` as well as `exporter`.
2. Confirm the Collector has `metrics` and `traces` pipelines with the
   `otlp` receiver.

### Log volume is high

**Cause**: One `codex.sse_event` record per stream chunk.

**Fix**:

1. Add the `filter/codex_stream_events` processor from
   [Configuration](#configuration) to the logs pipeline.

### Codex starts downloading a model

**Cause**: `--oss` selects Codex's default local model.

**Fix**:

1. Drop `--oss` and set `model_provider` and `model` in the config, as in
   [Using a local model on Ollama](#using-a-local-model-on-ollama).

### No data appearing in Scout

**Cause**: The Collector receives the signals but the Scout exporter fails.

**Look at**: The Collector log for `otlp_http/b14` errors.

**Fix**:

1. Check `OTEL_EXPORTER_OTLP_ENDPOINT` and the exporter's credentials.
2. Confirm the Collector can reach the Scout endpoint.

## FAQ

### Does Codex CLI support OpenTelemetry?

Yes. Codex exports logs, traces and metrics over OTLP, with HTTP or gRPC.
Export is off by default and is turned on in `config.toml`, with no code
changes.

### Does Codex emit traces?

Yes, when `trace_exporter` is set. The spans are Codex's internal tracing
spans, not GenAI convention spans.

### Does `codex exec` export telemetry?

Yes. Headless `codex exec` runs export all three signals, under the service
name `codex_exec`.

### Does the telemetry include my prompts?

No, not by default. `prompt` is redacted unless `log_user_prompt` is `true`.
Shell command lines and command output are exported on `codex.tool_result`,
in `arguments` and `output`.

### How do I track Codex token usage?

Read `codex.turn.token_usage` by `model` and `token_type`. For a single
conversation, sum `input_token_count` and `output_token_count` on its
`response.completed` events.

### Does Codex report cost?

No. Codex exports token counts and no cost. Compute cost from the token
counts and your provider's prices.

### Does Codex follow the GenAI semantic conventions?

No. It uses `codex.*` metric and event names and internal span names, with
`gen_ai.usage.*` token attributes on one span. See
[Known Gaps](#known-gaps).

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [AI Agent Observability](../../guides/ai-observability/agent-observability.md)
  \- Agent spans, tool calls and conversation IDs across frameworks.
- [Claude Code](./claude-code.md) - Monitor Claude Code and the Claude Agent
  SDK.
- [OpenClaw](./openclaw.md) - Monitor an OpenClaw agent gateway.

## What's Next?

- **Create Dashboards**: Chart turn duration, tokens per model and tool
  calls. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
  and [LLM observability in Scout](https://base14.io/scout/llm-observability).
- **Query Scout from Codex**: The
  [Scout MCP server](../../scout-mcp/setup.md) gives Codex read access to the
  traces, metrics and logs in Scout.
- **Fine-tune Collection**: Keep the stream event filter, and drop the
  Diagnostic metrics with a `filter` processor.
