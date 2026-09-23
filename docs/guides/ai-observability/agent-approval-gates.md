---
title:
  Agent Approval Gates with OpenTelemetry - Tracing Human-in-the-Loop Agents
sidebar_label: Agent Approval Gates
sidebar_position: 11
description:
  Trace human-in-the-loop approval gates in AI agents with OpenTelemetry. Span
  pairs, wait histograms, trace context across the pause and error status.
keywords:
  [
    agent approval gate observability,
    human in the loop agent tracing,
    opentelemetry approval span,
    agent tool approval telemetry,
    microsoft agent framework tool approval,
    ApprovalRequiredAIFunction,
    approval wait histogram,
    agent run error status,
    trace context across async boundary,
    opentelemetry span link,
    mcp tool call tracing,
    model context protocol traceparent,
    dotnet agent observability,
    genai semantic conventions,
    base14 scout,
  ]
---

# Agent Approval Gates

An approval gate stops an agent before a tool runs and asks a person whether it
should. This guide covers the telemetry a gate needs: what to record when the
gate asks, what to record when the person answers, how to keep the rest of the
run in the right trace, and which span carries the error status when something
fails.

The worked example is a C# travel rebooking agent on Microsoft Agent Framework
and .NET 10. A rebooking agent calls `rebook` and `add_hotel`, the gate prices
each call from the database, and anything over a price limit waits for a
human. The telemetry pattern does not depend on .NET and works in any language
with an OpenTelemetry SDK.

:::tip TL;DR

Record an approval as two short spans, not one long one.
`base14.approval.requested {tool}` opens and ends in the run's trace when the
gate asks. `base14.approval.decided {tool}` opens in the approver's request and
links back to it. Put the wait on a histogram keyed by tool and outcome. Carry
the run's trace context across the pause yourself, because the answer arrives
on a different request. Leave the status Unset on a rejection or an expiry and
record which it was in `base14.approval.outcome`.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

:::

## Overview

This guide shows you how to:

- Hook a gate into the agent framework's own tool approval.
- Record an approval as two linked spans, a histogram and a counter.
- Keep the work after the answer in the original run's trace.
- Decide which span carries the error status for each kind of failure.
- Query approvals and failures in base14 Scout.

## Who This Guide Is For

- Engineers adding a human approval step to an agent that spends money or
  changes customer records.
- Teams writing alerts over agent telemetry and getting false pages from
  approval decisions.
- On-call engineers who need to know which span to filter on when an agent run
  fails.

## Prerequisites

- An OpenTelemetry SDK for your language, plus an OTLP exporter.
- An OpenTelemetry Collector, or a direct OTLP endpoint.
- An agent framework that emits GenAI spans, or manual spans that follow the
  [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
- A base14 Scout account for the Scout section.

### Compatibility Matrix

| Component | Version | Notes |
| --- | --- | --- |
| .NET SDK | 10.0.400 | Pinned in `global.json`. |
| `Microsoft.Agents.AI.Workflows` | 1.21.0 | Handoff workflow, `RequestInfoEvent`. |
| `Microsoft.Extensions.AI` | 10.10.0 | `ApprovalRequiredAIFunction`. |
| `ModelContextProtocol` | 2.2.0 | Tools come from an in-process MCP server. |
| `OpenTelemetry.*` | 1.18.0 | SDK, OTLP exporter, ASP.NET Core, HttpClient, Runtime. |
| OTel Collector contrib | 0.161.0 | `oauth2client` extension for Scout. |
| Ollama model | `qwen3.5:9b` | On the host, not in a container. |

Full source:
[`csharp/agent-rebooking`](https://github.com/base-14/examples/tree/main/csharp/agent-rebooking).

## How the Gate Hooks into the Framework

The gate does not replace the framework's tool approval. It answers it.

1. The tools that need approval are wrapped in `ApprovalRequiredAIFunction`
   when the agent is built. With no predicate, every call to them pauses.
2. When the model calls one, the workflow stops before running it and emits a
   `RequestInfoEvent` carrying a `ToolApprovalRequestContent`. The tool call
   inside it has the name and the arguments the model wrote.
3. The application passes the call to the gate. The gate reads the price from
   the database and compares it with the limit.
4. Under the limit, the application answers the request itself and the
   workflow carries on in the same pass.
5. Over the limit, or when the gate cannot price the call, the request is
   parked. The run's state becomes `pending_approval` and the pass ends.
6. A person answers on `POST /approvals/{approvalId}`, or the request expires.
   The application sends the answer into the workflow and starts a new pass.

Wrapping the gated tools:

```csharp showLineNumbers title="Agents/AgentSetup.cs"
Tools = [.. tools.Select(WrapIfApprovalRequired)],
AllowMultipleToolCalls = false,

private static AITool WrapIfApprovalRequired(AITool tool) =>
    tool is AIFunction function && ApprovalRequiredTools.Contains(tool.Name)
        ? new ApprovalRequiredAIFunction(function)
        : tool;
```

`AllowMultipleToolCalls = false` keeps one tool call per turn, so a run has at
most one approval outstanding.

The gate prices the call from the database, not from the arguments. The model
writes an amount into the tool call, and the gate never reads it. Anything it
cannot price, such as an unknown offer or a call missing a booking reference,
goes to a person.

## The Approval Shape

An approval wait runs to minutes, and an unanswered request sits until it
expires. A span held open for that long does not export until it ends, and
anything that assembles a trace when its root ends sees it late or not at all.

Record it as two short spans, a histogram and a counter instead.

### The requested span

Opened in the run's trace when the gate parks a call, and ended at once. Its
context is kept with the pending request so the decision can link to it later:

```csharp showLineNumbers title="Telemetry/ApprovalTelemetry.cs"
public ActivityContext Requested(ApprovalEntry entry)
{
    using var activity = Sources.Activity.StartActivity($"{RequestedSpanName} {entry.Tool}");
    Describe(activity, entry);
    return activity?.Context ?? default;
}
```

A span event on the run span would record the same moment, but an event has no
span id, so nothing can link to it. The requested span exists to be the target
of that link.

### The decided span

Opened where the decision happens: inside the approver's HTTP request, or in
the background sweep for an expiry. It links to the requested span rather than
parenting to it, because the two are in different traces:

```csharp showLineNumbers title="Telemetry/ApprovalTelemetry.cs"
public void Decided(ApprovalEntry entry, ActivityContext requested, string outcome, TimeSpan waited)
{
    var links = requested == default ? null : new[] { new ActivityLink(requested) };

    using (var activity = Sources.Activity.StartActivity(
        $"{DecidedSpanName} {entry.Tool}", ActivityKind.Internal, parentContext: default, links: links))
    {
        Describe(activity, entry);
        activity?.SetTag(OutcomeAttribute, outcome);
        activity?.SetTag(WaitSecondsAttribute, waited.TotalSeconds);
    }

    _waitDuration.Record(waited.TotalSeconds, Tags(entry.Tool, outcome));
    _count.Add(1, Tags(entry.Tool, outcome));
}
```

On an answer, the decided span is a child of the approver's request span. On an
expiry there is no request, so it is the root of a trace of its own.

### Attributes

| Attribute | On | Value |
| --- | --- | --- |
| `gen_ai.tool.name` | both | The tool the approval is for. |
| `base14.run.id` | both | The agent run id. |
| `base14.approval.amount` | both | The price the gate read. Absent when it could not price the call. |
| `base14.approval.limit` | both | The limit it was compared against. |
| `base14.approval.outcome` | decided | `approved`, `rejected` or `expired`. |
| `base14.approval.wait_seconds` | decided | Seconds the request waited. |

The run id is on both spans because a link carries only a trace id and a span
id. Without it, nothing on the decided span says which run it belongs to.

Custom names take an application prefix, `base14.` here and your own in your
service. `gen_ai.tool.name` is the one semantic convention attribute, used with
its convention meaning. Do not put application names under `gen_ai.`.

A decided span:

```text
Span   base14.approval.decided rebook
  gen_ai.tool.name: rebook
  base14.run.id: run-e8e49764fd79
  base14.approval.limit: 300
  base14.approval.amount: 620
  base14.approval.outcome: approved
  base14.approval.wait_seconds: 0.7895599
Links:
  base14.approval.requested rebook, in the traveller's trace
```

### The wait histogram and the counter

`base14.agent.approval.wait.duration` records the wait in seconds, keyed by
`gen_ai.tool.name` and `base14.approval.outcome`. The SDK's default bucket
boundaries suit request latency, not people, so set your own:

```csharp showLineNumbers title="Telemetry/TelemetryRegistration.cs"
.AddView(ApprovalTelemetry.WaitDurationInstrument, new ExplicitBucketHistogramConfiguration
{
    Boundaries = ApprovalTelemetry.WaitDurationBucketBoundaries,
})
```

The example uses 1, 5, 15, 30, 60, 120, 300, 600 and 900 seconds. The default
expiry is 600 seconds, so the 900 bucket separates a slow answer from an
expiry.

`base14.agent.approval.count` counts every decision by tool and outcome,
including calls the gate answered itself. Those get outcome `auto` and no
spans, because nobody waited and a pair of empty spans per call would bury the
ones a person handled.

## Trace Context Across the Pause

The answer arrives on a different HTTP request from the one that started the
run. Without intervention, the work after the answer joins the approver's
trace, and the traveller's trace stops at the pause.

Capture the run's context when the run starts. Before each pass, clear the
ambient activity and start the pass span with the captured context as its
explicit parent:

```csharp showLineNumbers title="Runs/RunStore.cs"
private Activity? StartRunActivity(RunRecord record, string name)
{
    Activity.Current = null;
    var activity = Sources.Activity.StartActivity(name, ActivityKind.Internal, record.RootContext);
    activity?.SetTag(ApprovalTelemetry.RunIdAttribute, record.Id);

    lock (_sync)
    {
        record.PassActivity = activity;
    }

    return activity;
}
```

This produces `base14.agent.run` for the first pass and `base14.agent.resume`
for the pass after the answer. Both are children of the traveller's request
span. They are siblings, not nested, because the resume starts after the first
pass has ended.

### Framework spans stay under the first pass

The workflow's executors keep the execution context from when the run
started. Every framework span produced after the answer, including the second
`invoke_agent` and the gated tool call, is a child of `base14.agent.run`, not
of `base14.agent.resume`. The trace is still whole, and the resume span still
carries the resume's duration and any spans the application opens itself.

Check this in your framework before relying on the resume span's children. If
you need the resume's spans grouped, filter on time after the decided span's
timestamp, or add `base14.run.id` to the spans your application opens.

### A parked run lives in memory

In the example, the workflow run, the pending request and the captured context
are held in memory. A restart loses all three, and the parked run is gone.

To survive a restart, the workflow has to be checkpointed, and the pending
approval has to be stored with it. Store the run's `traceparent` and the
requested span's context alongside the approval. On restore, rebuild the
`ActivityContext` from the stored `traceparent`, use it as the parent of the
resume span, and use the stored requested context for the decided span's link.
Nothing else in the pattern changes.

### The whole trace

A run that waited on an approval and was approved:

```text showLineNumbers title="One traveller message, one trace"
POST /runs
  base14.agent.run
    invoke_agent triage(triage)
      chat qwen3.5:9b
        POST                                (HttpClient to Ollama)
    invoke_agent rebooking(rebooking)
      chat qwen3.5:9b
        POST
      execute_tool lookup_booking
        tools/call lookup_booking           (MCP server span)
          CONNECT agentrebooking
          postgresql
      chat qwen3.5:9b
        POST
      execute_tool search_alternatives
        tools/call search_alternatives
          postgresql
          postgresql
      chat qwen3.5:9b
        POST
    postgresql                              (the gate's price lookup)
    base14.approval.requested rebook
    invoke_agent rebooking(rebooking)       (the pass after the answer)
      execute_tool rebook
        tools/call rebook
          postgresql
      chat qwen3.5:9b
        POST
  base14.agent.resume

POST /approvals/{approvalId}                (a separate trace)
  base14.approval.decided rebook            (links to base14.approval.requested)
```

## Where the Error Status Goes

Each failure puts the error status on a different span:

| Scenario | What carries the failure | Run state |
| --- | --- | --- |
| Run timeout | `base14.agent.run` Error, plus an ERROR log record. | `failed` |
| Model unreachable | `chat`, `invoke_agent` and `base14.agent.run` all Error. | `failed` |
| Unknown record, tool returns an error | `tools/call` and `execute_tool` Error. Run span Unset. | `completed` |
| Database unreachable | Database and tool spans Error. Run span Unset. | `completed` |
| Approval rejected | Nothing. `base14.approval.outcome: rejected`. | `completed` |
| Approval expired | Nothing. `base14.approval.outcome: expired`. | `completed` |

### Approval outcomes are not errors

Leave the status Unset on both approval spans and on every span of the run,
for a rejection and an expiry alike. A decline is a result the gate is built to
produce. Marking it as an error puts it in the same queries as timeouts and
provider outages.

On a rejected run there is no `execute_tool rebook` span and no
`tools/call rebook` span, because the tool never ran. The workflow cannot tell
an expiry from a rejection. The application sends both as a rejection, and
only `base14.approval.outcome` tells them apart.

### A failed tool call leaves the run Unset

When a tool returns an error the agent can read and answer around, the error is
on the tool spans and the run completes:

```text
tools/call lookup_booking      Error   [{"type":"text","text":"An error occurred invoking 'lookup_booking': No booking found for reference 'BK-9999'."}]
execute_tool lookup_booking    Error   [{"type":"text","text":"An error occurred invoking 'lookup_booking': No booking found for reference 'BK-9999'."}]
base14.agent.run               Unset
```

The application sets neither status. The MCP SDK sets Error on the server span
when the tool result has `IsError` set, and the agent framework copies it to
`execute_tool`. The status message is the tool result serialized as JSON, and
apostrophes arrive escaped as `'`. Search for `invoking`, not for
`invoking 'lookup_booking'`.

### Mark the pass span, not the current activity

A run can fail from the background sweep, from the approver's request or from
its own pass. Publish the current pass's activity on the run record and mark
that one. Never mark `Activity.Current`:

- On the sweep's thread, `Activity.Current` is null.
- On the approver's request, `Activity.Current` is the approver's server span.
  Marking it reports the approver's request as failed and leaves the failed run
  Unset.

A failure while a run is parked marks no span. The first pass has ended and the
resume has not started. Record those on the run record and in an ERROR log
record.

## What to Look For in base14 Scout

### Find the runs a person waited on

Filter spans on `base14.approval.outcome` and group by value. Calls the gate
answered itself produce no spans, so every span this returns is one a person
answered or let expire.

### Find how long people take

Chart `base14.agent.approval.wait.duration` split by `base14.approval.outcome`.
Expired requests all sit at the timeout, so split them out before reading a
median.

### Follow one approval both ways

Open the traveller's trace and find `base14.approval.requested {tool}`. The
decision is in another trace. Search for the decided span by `base14.run.id`,
or follow the span link from the decided side.

### Find failures the run span does not show

Filtering on `status = Error` finds run timeouts and model outages. It does not
find a failed tool call inside a run that completed, or a database outage the
agent answered around. For those, filter on `execute_tool` or `tools/call`
status.

A run can reach `completed` with no reply when every tool call failed, so check
the reply as well as the state.

## Framework and MCP Notes

These are specific to Microsoft Agent Framework 1.21.0 and the MCP C# SDK
2.2.0. They affect what the rest of the trace looks like.

### Register every source

The tracer provider has to list the application's source,
`Experimental.Microsoft.Agents.AI`, `Experimental.ModelContextProtocol` and
`Npgsql`:

```csharp showLineNumbers title="Telemetry/Sources.cs"
public static readonly string[] TraceSourceNames =
    [AgentRebooking, AgentFramework, ModelContextProtocol, Npgsql];
```

`UseOpenTelemetry()` on each agent produces `invoke_agent {Name}({Id})`,
`chat {model}` and `execute_tool {tool}` spans on the framework source. A
custom `Meter` has to be registered by name with `AddMeter`, or its
measurements are dropped without a warning.

### One span per MCP tool call

The MCP SDK finds the framework's `execute_tool` span and adds its `mcp.*`
attributes to it instead of opening its own client span. The server span
`tools/call {tool}` is a child of it. Requests with no outer tool span, such as
`tools/list`, get their own client span.

The SDK checks for a listener on `Experimental.ModelContextProtocol` before it
does any of this. Without one, the `mcp.*` attributes are missing and the
client stops writing `traceparent` into `params._meta`, so each server span
starts a new trace. Register the source before the MCP session opens. In
ASP.NET Core, register the hosted service that opens the session after
`AddOpenTelemetry()`.

### Handoffs have no span

A handoff is a tool the framework injects into the source agent. It has no
body and is never run, so there is no `execute_tool` span. Read a handoff from
the pair of `invoke_agent` spans and from `gen_ai.tool.definitions` on the
source agent's span. At 1.21.0 the injected tool is named `handoff_to_1`, not
`handoff_to_<agent_id>` as the framework documentation says.

### Content capture

`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` puts
`gen_ai.input.messages` and `gen_ai.output.messages` on both the `chat` span
and the `invoke_agent` span above it, so each model call stores its messages
twice. Tool spans carry none of it. The content is written as span attributes,
so attribute limits apply. Leave capture off when messages carry customer
data.

## Configuration

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

```mdx-code-block
<Tabs>
<TabItem value="compose" label="Docker Compose" default>
```

```yaml showLineNumbers title="compose.yaml"
services:
  app:
    environment:
      APPROVAL_LIMIT: ${APPROVAL_LIMIT:-300}
      APPROVAL_TIMEOUT_SECONDS: ${APPROVAL_TIMEOUT_SECONDS:-600}
      RUN_TIMEOUT_SECONDS: ${RUN_TIMEOUT_SECONDS:-300}
      OTEL_SERVICE_NAME: ${OTEL_SERVICE_NAME:-agent-rebooking}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: ${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: ${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
      OTEL_RESOURCE_ATTRIBUTES: service.namespace=examples,deployment.environment=${SCOUT_ENVIRONMENT:-development},environment=${SCOUT_ENVIRONMENT:-development}
```

```mdx-code-block
</TabItem>
<TabItem value="collector" label="Collector">
```

```yaml showLineNumbers title="config/otel-collector.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector

exporters:
  otlp_http/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip

service:
  extensions: [oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [otlp_http/b14]
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### The work after an approval is in the approver's trace

The resume pass ran with the approver's request as its ambient context. Set
`Activity.Current` to null on the resume path and pass the captured run
context as the explicit parent.

### The decided span has no link

The requested span's context was not kept with the pending request, or the
requested span was never sampled. Keep the context on the pending request, and
check that the sampler records the requested span when it records the run.

### Approval spans show up in error alerts

Rejected and expired outcomes are Unset, so the alert is matching something
else, usually the run state rather than span status. Alert on
`base14.approval.outcome` if you want to watch decline rates.

### `execute_tool` spans have no `mcp.*` attributes

The MCP source is not registered, or it was registered after the MCP session
opened. See [One span per MCP tool call](#one-span-per-mcp-tool-call).

### Custom metrics never arrive

Check these in order:

- The `Meter` name does not match the name passed to `AddMeter`.
- The instrument is on a code path the framework does not call. Agent
  frameworks usually stream, so a chat-client wrapper that only overrides the
  non-streaming method records nothing. `gen_ai.request.stream: true` on the
  chat spans shows which path is in use.
- The run ended before the metric export interval. Wait one interval before
  deciding a metric is missing.

## Performance Considerations

- Two spans per approval a person handles, each ending at once. The cost does
  not depend on how long the person takes.
- One histogram point and one counter increment per decision.
- No spans for calls the gate answers itself.
- The approval spans are a small part of a run. The trace above has 29 spans,
  three of them the application's. The rest come from the framework, MCP, HTTP
  and the database client.

## FAQ

### How do I trace an agent that waits for human approval?

Record the wait as two short spans and a histogram, not one span held open
until the person answers. Open a requested span in the run's trace and end it
at once. Open a decided span in the approver's request with a link to the
requested span. Record the wait on a histogram keyed by tool and outcome.

### Should a rejected approval be recorded as an error?

No. Leave the span status Unset and record the outcome in an attribute such as
`base14.approval.outcome`. A decline is an expected result of the gate.
Recording it as an error puts it in the same queries as timeouts and provider
outages.

### Why use a span for the approval request instead of a span event?

The decided span links to the request, and a link needs a span id. An event
has none.

### Why do spans after an approval land in the wrong trace?

The answer arrives on a different request, so the ambient context at resume
time is the approver's. Capture the run's context when it starts, clear the
ambient activity on the resume path, and pass the captured context as the
explicit parent.

### How do I keep the trace when a parked run survives a restart?

Store the run's `traceparent` and the requested span's context with the
pending approval, next to the workflow checkpoint. On restore, rebuild the
context from the stored `traceparent` and use it as the resume span's parent.

### Does Microsoft Agent Framework have built-in tool approval?

Yes. Wrap a tool in `ApprovalRequiredAIFunction` and the workflow pauses
before each call and emits a `RequestInfoEvent` with a
`ToolApprovalRequestContent`. The application answers it with an approval or a
rejection. The gate in this guide decides that answer.

### Why is there only one span for an MCP tool call?

The MCP SDK finds the framework's `execute_tool` span and adds its `mcp.*`
attributes there instead of opening a second client span. The server span is a
child of it. Requests with no outer tool span, such as `tools/list`, get their
own client span.

### How does trace context reach an MCP server?

The MCP client writes `traceparent` into `params._meta` on every request, and
the server uses it as the parent of its server span. This is part of the
protocol (SEP-414) and works over in-process transports as well as HTTP.

### How do I alert on agent failures without paging on approvals?

Alert on run span status for timeouts and provider outages, on `execute_tool`
status for tool failures the agent answered around, and on the approval
outcome attribute for decisions. The three return separate sets.

### How should I set the approval wait histogram buckets?

Use boundaries in seconds that match how long people take, with one bucket
past the expiry. The example uses 1, 5, 15, 30, 60, 120, 300, 600 and 900
seconds against a 600-second expiry.

## Complete Example

The full application is in the base14 examples repository:

```text
csharp/agent-rebooking/
+-- AgentRebooking/
|   +-- Agents/              Handoff workflow, gated tools, MCP session
|   +-- Llm/                 Chat client factory, metrics gateway
|   +-- Mcp/                 In-process MCP server and tools
|   +-- Runs/                Run store, approval gate
|   +-- Telemetry/           Sources, provider registration, approval telemetry
|   +-- Program.cs
+-- config/otel-collector.yaml
+-- scripts/test-api.sh      API cases, happy path and six failures
+-- scripts/verify-scout.sh  Telemetry assertions against the collector log
+-- compose.yaml
```

Run it with Docker Compose and a local Ollama:

```bash
git clone https://github.com/base-14/examples.git
cd examples/csharp/agent-rebooking
cp .env.example .env     # fill in SCOUT_CLIENT_ID, SCOUT_CLIENT_SECRET, SCOUT_TOKEN_URL, SCOUT_ENDPOINT
ollama pull qwen3.5:9b
make up
make test-api
```

Fill in the four `SCOUT_*` variables before `make up`. They ship empty, and the
collector exits at startup until they are set:

```text
Error: invalid configuration: extensions::oauth2client: no ClientID provided in the OAuth2 exporter configuration
```

`POSTGRES_CONNECTION_STRING` and `OTEL_EXPORTER_OTLP_ENDPOINT` are commented
out in `.env.example`. Their values point at `localhost` and are for running
the app outside Compose. Leave them commented when using Compose.

## What's Next

### Related Guides

- [AI Agent Observability](./agent-observability.md) covers the agent timeline,
  operation types and conversation-id propagation.
- [LLM Observability](./llm-observability.md) covers token and cost metrics and
  evaluation tracking in Python.
- [Java AI Observability](./spring-ai-llm-observability.md) covers the same
  ground for Spring AI.

## References

- [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [Microsoft Agent Framework tool
  approval](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval)
- [Microsoft Agent Framework handoff
  orchestration](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff)
- [Model Context Protocol C# SDK](https://github.com/modelcontextprotocol/csharp-sdk)
- [MCP SEP-414, trace context in `params._meta`](https://modelcontextprotocol.io/community/seps/414-request-meta)
- [OpenTelemetry attribute naming
  guidance](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/general/naming.md)
