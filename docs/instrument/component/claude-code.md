---
title: >
  Claude Code OpenTelemetry Monitoring - Cost, Tokens, Traces and Logs
sidebar_label: Claude Code
id: collecting-claude-code-telemetry
sidebar_position: 75
description: >
  Collect Claude Code and Claude Agent SDK traces, metrics and logs with the
  OpenTelemetry Collector. Track cost, tokens and tool calls in base14 Scout.
keywords:
  - claude code opentelemetry
  - claude code monitoring
  - claude code telemetry
  - claude agent sdk opentelemetry
  - claude code cost tracking
  - claude code token usage
  - coding agent observability
  - claude code traces
---

# Claude Code

Set `CLAUDE_CODE_ENABLE_TELEMETRY=1` and the OTLP exporter variables in the
environment Claude Code starts in, and point them at an OpenTelemetry
Collector. Telemetry is off by default. Once it is on, Claude Code exports
cost, token and session metrics, a log record per prompt, model request and
tool call, and a trace per prompt. The Claude Agent SDK starts the same CLI
as a child process, so the same variables cover SDK applications. This guide
sets the variables, configures the Collector, and sends all three signals to
base14 Scout.

Last verified 2026-10-04 with Claude Code 2.1.289 and the Claude Agent SDK
for Python 0.2.163, which bundles Claude Code 2.1.286. Traces are a beta
feature, and Claude Code names its spans and attributes `claude_code.*`, so
names can change between releases. Trace structure is verified on a local
model. On Anthropic's API it is incomplete, see [Known Gaps](#known-gaps).
Pin the version you roll out and re-check the spans after each upgrade.

## Prerequisites

| Requirement               | Minimum | Recommended |
| ------------------------- | ------- | ----------- |
| Claude Code               | 2.1.289 | 2.1.289     |
| Claude Agent SDK (Python) | 0.2.163 | 0.2.163     |
| OTel Collector Contrib    | 0.144.0 | latest      |
| base14 Scout              | Any     | -           |

Before starting:

- Every machine that runs Claude Code must reach the Collector's OTLP port,
  `4318` for HTTP or `4317` for gRPC.
- A model provider for Claude Code: a Claude account, an Anthropic API key,
  or a local model. The metrics and events are the same on each. Identity
  attributes, cost and trace completeness depend on the provider.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Claude Code pushes all three signals. There is no scrape endpoint unless you
choose the `prometheus` metrics exporter.

| Signal  | What arrives                                                                              |
| ------- | ----------------------------------------------------------------------------------------- |
| Traces  | One trace per prompt: the interaction, each model request, and each tool call.            |
| Metrics | `claude_code.*` counters for sessions, tokens, cost, active time, edits and lines of code. |
| Logs    | One record per event: prompts, model requests, tool decisions, tool results and errors.   |

The tables below group the metrics into Core, Operational and Diagnostic.
Every metric is a monotonic sum, exported with delta temporality by default.
Set `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` to change
it.

### Core - what is it costing

| Metric | What it tells you |
|---|---|
| `claude_code.cost.usage` | Estimated cost in USD by `model` and `query_source` (`main`, `subagent`, `auxiliary`). |
| `claude_code.token.usage` | Tokens by `type` (`input`, `output`, `cacheRead`, `cacheCreation`), `model` and `query_source`. |
| `claude_code.session.count` | Sessions started, by `start_type` (`fresh`, `resume`, `continue`). |

### Operational - how is it being used

| Concern | Metric | What it tells you |
|---|---|---|
| Activity | `claude_code.active_time.total` | Seconds of active time by `type`: `cli` for tool and model time, `user` for keyboard time. Headless runs record `cli` only. |
| Edits | `claude_code.code_edit_tool.decision` | Edit permission decisions by `tool_name`, `decision` (`accept`, `reject`), `source` and `language`. |

### Diagnostic - output proxies

| Group | Metrics | When you reach for it |
|---|---|---|
| Code volume | `claude_code.lines_of_code.count` | Estimating how much code Claude Code writes, by `type` and `model`. |
| Git activity | `claude_code.commit.count`, `claude_code.pull_request.count` | Counting the commits and pull requests Claude Code creates. |

Every data point carries `session.id`, `user.id` and `terminal.type`.
Sessions signed in with a Claude account also carry `organization.id`,
`user.account_uuid` and `user.email`. `session.id` makes each session its own
series. Set `OTEL_METRICS_INCLUDE_SESSION_ID=false` to drop it from metrics
while keeping it on spans and logs.

## Key Alerts to Configure

These thresholds are starting points. Set them against a week of your own
baseline.

| Signal | Warning | Critical | Why it matters |
|---|---|---|---|
| `claude_code.cost.usage` per `user.id` per day | 2x baseline | 4x baseline | One developer or one automation is spending far more than usual. Open their sessions by cost. |
| `claude_code.api_error` events | Rising for 15 min | Any `claude_code.api_retries_exhausted` | Requests to the provider are failing. Check `status_code` on the event. |
| `claude_code.tool_result` with `success` `false` | 2x baseline ratio | 4x baseline ratio | Tools are failing, often a broken environment or an MCP server that is down. Group by `tool_name`. |
| `claude_code.token.usage` `cacheRead` share of input | Falling for a day | - | Prompts stopped hitting the cache, so cost per request rises. |

## Access Setup

The Collector needs no credentials for Claude Code, because Claude Code
pushes to it. Set the variables where Claude Code starts.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="cli" label="Claude Code CLI" default>

Export the variables in the shell profile, or put them in the `env` block of
a settings file.

```bash showLineNumbers title="~/.zshrc"
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export OTEL_RESOURCE_ATTRIBUTES=team.id=platform
```

To set them for a whole organization, put the same keys in the `env` block
of the managed settings file. Developers cannot override an endpoint set
there.

```json showLineNumbers title="managed-settings.json"
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-collector:4318"
  }
}
```

</TabItem>
<TabItem value="sdk" label="Claude Agent SDK">

The SDK starts the Claude Code CLI as a child process, and the CLI reads the
telemetry variables from the environment it inherits. Set the same variables
on your application's process. To put the CLI's spans under your own span,
pass the active trace context in `TRACEPARENT`.

```python showLineNumbers title="agent.py"
from claude_agent_sdk import ClaudeAgentOptions, query
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.propagate import inject
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider(resource=Resource.create({"service.name": "my-app"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("my-app")


async def summarise(prompt: str) -> None:
    with tracer.start_as_current_span("summarise_notes"):
        carrier: dict[str, str] = {}
        inject(carrier)
        options = ClaudeAgentOptions(
            env={"TRACEPARENT": carrier["traceparent"]},
        )
        async for message in query(prompt=prompt, options=options):
            print(message)
```

`inject` writes `traceparent` only when a tracer provider is configured, as
above. The CLI's `claude_code.interaction` span becomes a child of
`summarise_notes`, with `parent.source=env`. Headless `claude -p` runs read
`TRACEPARENT` the same way. Interactive sessions ignore it.

</TabItem>
</Tabs>

| Variable | Default | Notes |
|---|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | unset | `1` turns telemetry on. Nothing is exported without it. |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_TRACES_EXPORTER` | unset | `otlp` per signal. A signal with no exporter is not sent. |
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` | unset | `1` is required for traces, together with `OTEL_TRACES_EXPORTER`. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | unset | `http/protobuf`, `http/json` or `grpc`. Required with `otlp`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Base URL of the Collector. Per-signal forms override it. |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | Headers for a Collector that needs authentication. |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | Milliseconds between metric exports. |
| `OTEL_LOGS_EXPORT_INTERVAL`, `OTEL_TRACES_EXPORT_INTERVAL` | `5000` | Milliseconds between log and span batches. |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Comma-separated `key=value` pairs, such as a team or cost center. |
| `OTEL_METRICS_INCLUDE_VERSION` | `false` | Adds `app.version` to metrics. |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT` | `false` | Adds `app.entrypoint`: `cli`, `sdk-cli`, `sdk-py`, `sdk-ts` and others. |

Prompt and response text, tool arguments and tool output are not exported
unless you turn them on:

| Variable | Adds |
|---|---|
| `OTEL_LOG_USER_PROMPTS` | Prompt text on `user_prompt` events and the interaction span. |
| `OTEL_LOG_ASSISTANT_RESPONSES` | Response text on `assistant_response` events. |
| `OTEL_LOG_TOOL_DETAILS` | Shell commands, file paths, MCP server and tool names, and tool input. |
| `OTEL_LOG_TOOL_CONTENT` | Tool output on a `tool.output` span event. |

Claude Code ignores `OTEL_*` exporter variables in a repository's
`.claude/settings.json`, so a project cannot redirect telemetry.

Confirm Claude Code runs before looking at telemetry:

```bash showLineNumbers
claude --version
claude -p "Say hello."
```

## Configuration

The `otlp` receiver takes the pushed signals. Claude Code sets
`service.name` to `claude-code`, so the `resource` processor sets only the
environment keys.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
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

Claude Code reads a variable of the same name for its own Collector address.
If you start the Collector from a shell that exports it for Claude Code, the
shell value replaces the one in `.env`. Start the Collector from a shell
without it.

### Using a local model on Ollama

Claude Code talks to any server that implements the Anthropic Messages API.
Ollama does, so point `ANTHROPIC_BASE_URL` at it. In `--bare` mode Claude
Code reads only `ANTHROPIC_API_KEY`, and Ollama accepts any value.

```bash showLineNumbers title="Terminal"
export ANTHROPIC_BASE_URL=http://localhost:11434
export ANTHROPIC_API_KEY=ollama
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=1024
claude -p "Say hello." --bare --model qwen3.5-32k
```

Two settings matter on a local model:

- **Context.** Claude Code's prompt and tool definitions are larger than
  Ollama's default context. Create a model tag with a larger `num_ctx`.
- **Output cap.** Agent SDK sessions send a second request that asks the
  model for a session title. It asks for up to 32000 output tokens, and
  Ollama serves one request at a time, so the query waits behind it.
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS` caps both requests.

```text showLineNumbers title="Modelfile"
FROM qwen3.5:9B
PARAMETER num_ctx 32768
```

```bash showLineNumbers title="Terminal"
ollama create qwen3.5-32k -f Modelfile
```

The metrics and events have the same shape as on Anthropic's API. Cost and
provider attributes do not describe the local model; see
[Known Gaps](#known-gaps).

## Collecting traces

Set `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and `OTEL_TRACES_EXPORTER=otlp`.
Each prompt produces one trace. This is the shape on a local model; see
[Known Gaps](#known-gaps) for Anthropic's API.

```text showLineNumbers
claude_code.interaction                 INTERNAL  one per prompt
├─ claude_code.llm_request              INTERNAL  one per model request
└─ claude_code.tool                     INTERNAL  one per tool call
   ├─ claude_code.tool.blocked_on_user  INTERNAL  the permission decision
   └─ claude_code.tool.execution        INTERNAL  the tool body
```

- `claude_code.interaction` carries `user_prompt_length`,
  `interaction.duration_ms` and `parent.source` (`none`, or `env` when
  `TRACEPARENT` was read). `user_prompt` is `<REDACTED>` unless prompt
  logging is on.
- `claude_code.llm_request` carries `model`, `gen_ai.request.model`,
  `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_creation_tokens`, `duration_ms`, `ttft_ms`, `attempt`, `success`,
  `stop_reason` and `query_source_safe`. On Anthropic's API it also carries
  `request_id` and `gen_ai.response.id`.
- `claude_code.tool` carries `tool_name`, `tool_use_id`,
  `gen_ai.tool.call.id` and `duration_ms`. With `OTEL_LOG_TOOL_DETAILS=1` it
  adds `full_command` for Bash and `file_path` for file tools.
- `claude_code.tool.blocked_on_user` carries `decision` and `source`. A
  denied call has this span and no `claude_code.tool.execution`.
- `claude_code.tool.execution` carries `success`, and `error` on failure. A
  failed tool call sets span status `Error` on this span only.

Every span also carries `session.id`, `user.id` and `span.type`.

Shell commands that Claude Code runs inherit `TRACEPARENT` from the tool
span, so an instrumented command can join the trace. Claude Code sends the
`traceparent` header on model requests only when it talks to Anthropic's API
directly. Set `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1` to send it, and the
subprocess variable, when `ANTHROPIC_BASE_URL` points somewhere else.

## Collecting logs

Set `OTEL_LOGS_EXPORTER=otlp`. Each event arrives as one OTLP log record. The
body is the event name, and the content is in attributes. Severity is unset.

| Event | Key attributes |
|---|---|
| `claude_code.user_prompt` | `prompt_length`; `prompt` is `<REDACTED>` by default. |
| `claude_code.api_request` | `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `duration_ms`, `ttft_ms`, `query_source`. |
| `claude_code.api_error` | `model`, `error`, `status_code`, `attempt`, `duration_ms`. |
| `claude_code.assistant_response` | `response_length`, `model`; `response` is `<REDACTED>` by default. |
| `claude_code.tool_decision` | `tool_name`, `decision` (`accept`, `reject`), `source`, `tool_use_id`. |
| `claude_code.tool_result` | `tool_name`, `success`, `duration_ms`, `tool_use_id`; `error_type` on failure. |

Every record carries `session.id`, `user.id`, `event.name` and
`event.sequence`. Records written for a prompt also carry `prompt.id`, which
joins all the events of one prompt. When traces are on and the prompt has a
complete trace, its records carry the trace ID and span ID of the active
span, so an event opens its trace in Scout.

Filter and search on the attributes, not the body. `success` on
`tool_result` is the string `"true"` or `"false"`, and `duration_ms` and
`prompt_length` on some events arrive as strings.

Claude Code emits more events than this table lists, including
`claude_code.plugin_loaded`, `claude_code.mcp_server_connection` and
`claude_code.permission_mode_changed`. Anthropic's
[monitoring reference](https://code.claude.com/docs/en/monitoring-usage)
has the full list. Names and values that a headless run does not produce,
such as the `api_error` row, `api_retries_exhausted`, the commit and pull
request metrics, Claude account identity attributes and the variable
defaults, are from that reference.

## Known Gaps

As of Claude Code 2.1.289, verified 2026-10-04:

- **Spans do not follow the GenAI conventions.** Spans are named
  `claude_code.*`, with no `gen_ai.operation.name`, no `gen_ai.usage.*` and
  no `gen_ai.tool.name`. Token counts are `input_tokens` and
  `output_tokens`. Dashboards built on `chat {model}` and `execute_tool`
  spans do not pick these spans up.
- **`gen_ai.system`, not `gen_ai.provider.name`.** Model requests carry the
  older `gen_ai.system` attribute. Its value is `anthropic` on every
  request, including requests served by a local model.
- **No GenAI metrics.** `gen_ai.client.token.usage` and
  `gen_ai.client.operation.duration` are absent, and there is no latency
  histogram. Request duration is on the `api_request` event and the
  `claude_code.llm_request` span.
- **No `gen_ai.conversation.id`.** Group a conversation by `session.id`,
  which is on every span, metric and event.
- **Cost on a model Claude Code does not recognise.** `cost_usd` and
  `claude_code.cost.usage` are non-zero for a local model. The value is not
  the cost of that model.
- **Identity with an API key.** Sessions authenticated with
  `ANTHROPIC_API_KEY` carry only the anonymous `user.id`. `user.email`,
  `user.account_uuid` and `organization.id` need a Claude account login.
- **Incomplete traces on Anthropic's API.** In headless and Agent SDK runs
  against Anthropic's API with an API key, most prompts export no
  `claude_code.interaction` span and no span for their first model request,
  and the remaining spans arrive as roots of separate traces. Log records on
  those prompts carry no trace ID, except `tool_decision`. Metrics and events
  are complete. The same prompts on a local model produce complete traces,
  including the Agent SDK join. The cause is not established.
- **`blocked_on_user` on Agent SDK sessions.** `decision` and `source` read
  `unknown` on the span, on the SDK's bundled Claude Code 2.1.286. The
  `tool_decision` event for the same call has the real values.

## Verify the Setup

Run one prompt that calls a tool, then look for the spans in the Collector's
output. Add a `debug` exporter with `verbosity: detailed` to each pipeline
while you check.

```bash showLineNumbers
# Generate a prompt with a model request and a tool call
claude -p "Run ls with the Bash tool and count the files." \
  --allowedTools "Bash(ls:*)"

# Spans for the prompt, the model request and the tool call
docker logs otel-collector 2>&1 \
  | grep -E 'Name +: claude_code\.(interaction|llm_request|tool)$'

# Metrics, after one export interval
docker logs otel-collector 2>&1 | grep -E -- '-> Name: claude_code\.'

# Events
docker logs otel-collector 2>&1 | grep -E '^Body: Str\(claude_code\.'
```

In Scout, all three signals arrive under the service `claude-code`. A
complete trace has one `claude_code.interaction` root per prompt.

A complete runnable setup, with a driver script, an Agent SDK script and a
check script, is in
[components/claude-code-telemetry](https://github.com/base-14/examples/tree/main/components/claude-code-telemetry).

## What to Look For in Scout

### Read cost per developer per day

Sum `claude_code.cost.usage` grouped by `user.email`, or by `user.id` for
API key sessions, over a day. Split by `model` to see which model the spend
goes to, and by `query_source` to separate subagents from the main loop.

### Find the expensive sessions

Sum `cost_usd` on `claude_code.api_request` events grouped by `session.id`.
Within a session, count the same events by `prompt.id`. A prompt with many
model requests is a long tool loop.

### Read the tool failure rate

Count `claude_code.tool_result` events by `tool_name` and `success`. For a
failing tool, open the `claude_code.tool.execution` spans with status
`Error` and read `error`.

### Check that prompts hit the cache

Compare the `cacheRead` and `input` series of `claude_code.token.usage`. On
long sessions most input tokens are cache reads. A drop means prompts are
being rebuilt.

## Troubleshooting

### No telemetry arrives at the Collector

**Cause**: Telemetry is off, or a signal has no exporter.

**Fix**:

1. Check that `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set in the environment
   Claude Code starts in, not only in the current shell.
2. Set `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` and
   `OTEL_TRACES_EXPORTER` to `otlp`. Each signal needs its own.
3. Set `OTEL_EXPORTER_OTLP_PROTOCOL`, and match the port: `4318` for
   `http/protobuf`, `4317` for `grpc`.
4. Run `claude --debug-file /tmp/claude-debug.log` and look for
   `[3P telemetry]` lines.

### Metrics and logs arrive but traces do not

**Cause**: Traces need their own flag.

**Fix**:

1. Set `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` along with
   `OTEL_TRACES_EXPORTER=otlp`.
2. Confirm the Collector has a `traces` pipeline with the `otlp` receiver.

### An Agent SDK query never finishes on Ollama

**Cause**: The session title request holds Ollama's one request slot while
it generates up to 32000 tokens.

**Fix**:

1. Set `CLAUDE_CODE_MAX_OUTPUT_TOKENS` to a small value, as in
   [Using a local model on Ollama](#using-a-local-model-on-ollama).

### Spans arrive as separate traces with no interaction span

**Cause**: Known gap on Anthropic's API. See [Known Gaps](#known-gaps).

**Fix**:

1. Group by `session.id` and `prompt.id` on the events, which are complete.

### Agent SDK spans are not under my span

**Cause**: The CLI did not receive `TRACEPARENT`, or the session is
interactive.

**Fix**:

1. Pass `TRACEPARENT` in `ClaudeAgentOptions(env=...)` from inside the
   active span, as in [Access Setup](#access-setup).
2. Look for `parent.source` on `claude_code.interaction`. `env` means the
   variable was read.

### No data appearing in Scout

**Cause**: The Collector receives the signals but the Scout exporter fails.

**Look at**: The Collector log for `otlp_http/b14` errors.

**Fix**:

1. Check `OTEL_EXPORTER_OTLP_ENDPOINT` and the exporter's credentials.
2. Confirm the Collector can reach the Scout endpoint.

## FAQ

### Does Claude Code support OpenTelemetry?

Yes. Claude Code exports metrics, logs and traces over OTLP, with HTTP or
gRPC. It is off by default and is turned on with environment variables, with
no code changes.

### Does Claude Code emit traces?

Yes, as a beta feature. Set `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and
`OTEL_TRACES_EXPORTER=otlp`. Each prompt becomes one trace with a span per
model request and per tool call. On Anthropic's API with an API key, the
traces are incomplete as of Claude Code 2.1.289; see
[Known Gaps](#known-gaps).

### Does the Claude Agent SDK emit telemetry?

Yes. The SDK runs the Claude Code CLI as a child process, and the CLI
exports telemetry when the variables are set on the application's process.
Sessions report `app.entrypoint` as `sdk-py` or `sdk-ts`.

### Does the telemetry include my prompts and code?

No, not by default. Prompt and response text are redacted, and tool
arguments are left out. Each is turned on by its own variable. See
[Access Setup](#access-setup).

### How do I track Claude Code cost per developer?

Sum `claude_code.cost.usage` by `user.email` for Claude account logins, or
by `user.id` for API key sessions. Add a team with
`OTEL_RESOURCE_ATTRIBUTES`.

### Does Claude Code follow the GenAI semantic conventions?

No. It uses its own `claude_code.*` span, metric and event names, with a few
`gen_ai.*` attributes. See [Known Gaps](#known-gaps).

### How do I roll this out to a whole team?

Put the variables in the `env` block of the managed settings file. Use
`OTEL_RESOURCE_ATTRIBUTES` for the team name, and
`OTEL_EXPORTER_OTLP_HEADERS` if the shared Collector needs authentication.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [AI Agent Observability](../../guides/ai-observability/agent-observability.md)
  \- Agent spans, tool calls and conversation IDs across frameworks.
- [OpenClaw](./openclaw.md) - Monitor an OpenClaw agent gateway.
- [LiteLLM Gateway](./litellm.md) - Monitor a LiteLLM proxy placed between
  Claude Code and its providers.

## What's Next?

- **Create Dashboards**: Chart cost, tokens and sessions per developer and
  per model. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
  and [LLM observability in Scout](https://base14.io/scout/llm-observability).
- **Query Scout from Claude Code**: The
  [Scout MCP server](../../scout-mcp/setup.md) gives Claude Code read access
  to the traces, metrics and logs in Scout.
- **Fine-tune Collection**: Drop `session.id` from metrics with
  `OTEL_METRICS_INCLUDE_SESSION_ID=false` on large teams, and keep content
  logging off unless you need it.
