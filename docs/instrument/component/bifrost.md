---
title: >
  Bifrost OpenTelemetry Monitoring - LLM Gateway Requests, Tokens,
  and Collector Setup
sidebar_label: Bifrost
id: collecting-bifrost-telemetry
sidebar_position: 66
description: >
  Collect Bifrost metrics and GenAI traces with the OpenTelemetry
  Collector. Monitor LLM request outcomes, provider latency, and token
  usage in base14 Scout.
keywords:
  - bifrost opentelemetry
  - bifrost otel collector
  - llm gateway monitoring
  - bifrost metrics monitoring
  - opentelemetry prometheus receiver bifrost
  - genai semantic conventions
  - llm token usage monitoring
  - bifrost observability
  - bifrost telemetry collection
---

# Bifrost

Bifrost serves Prometheus text at `/metrics` on its main port with no
switch to turn on, and the OpenTelemetry Collector's `prometheus`
receiver scrapes it for 12 gateway metric families covering request
outcomes, upstream provider latency, token usage, retries and streaming
performance, plus 3 HTTP families and the Go runtime. A second surface,
an OTLP push carrying GenAI-semantic-convention spans, ships with the
binary but has to be created through the management API before it does
anything. This guide covers both, the Collector configuration and
shipping to base14 Scout.

The one thing to know before anything else: a Bifrost gateway that has
not yet served an LLM request exposes no `bifrost_` families at all.
Every one of them registers on first use.

## Prerequisites

| Requirement            | Minimum   | Recommended |
| ---------------------- | --------- | ----------- |
| Bifrost                | 1.5       | 2.1         |
| OTel Collector Contrib | 0.90.0    | latest      |
| base14 Scout           | Any       | -           |

Bifrost's metric surface is additive across releases: nothing has been
removed or renamed from 1.4 through 2.1. A 1.4 gateway emits eight of
the twelve families below;
`bifrost_active_requests`, `bifrost_provider_key_up` and
`bifrost_request_retries` arrive in 1.5, and
`bifrost_cache_read_input_tokens_total` needs 1.5 plus a provider that
reports cached prompt tokens. `bifrost_overhead_latency_microseconds`
needs 2.0.

Before starting:

- The Collector must reach Bifrost's port over plain HTTP.
- At least one provider and one key must be configured, and at least one
  LLM request must have run. Before that the exposition is a bare Go
  process.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or a capacity review.

Gate the scrape on both prefixes, `bifrost_` and `http_`. The HTTP
families are not runtime noise here: `http_requests_total` is the only
complete count of what reached the gateway, and two whole classes of
failure appear nowhere else - see
[What the gateway counters miss](#what-the-gateway-counters-miss).

### Core - are requests arriving, reaching a provider and succeeding

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the gateway is reachable. |
| `http_requests_total` | Every request the gateway handled, by `method`, `path` and `status`. `path` is the route template, so `/api/providers/{provider}/keys` rather than an expanded path. |
| `bifrost_success_requests_total` | Requests forwarded to a provider that returned a result, by `method`, `model`, `provider`, `selected_key_id` and `fallback_index`. |
| `bifrost_error_requests_total` | Requests that reached provider dispatch and failed. Same labels plus `status_code`. |
| `bifrost_upstream_requests_total` | Attempts against a provider, successes and failures together. The denominator for an error ratio. |
| `bifrost_upstream_latency_seconds` | Provider latency, over 22 buckets from 5ms to 900s. The only family carrying an `is_success` label. |
| `bifrost_active_requests` | In-flight requests by `method`. Three labels only; the cheapest saturation signal on the surface. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `bifrost_input_tokens_total` | Prompt tokens as reported by the provider. The cost signal on the input side. |
| `bifrost_output_tokens_total` | Completion tokens. |
| `bifrost_cache_read_input_tokens_total` | Prompt tokens the provider reported as served from its cache. This is the provider's number, not Bifrost's own caching. |
| `bifrost_request_retries` | Retries per request. Buckets start at `le="0"`, so the `le="0"` count is the number of requests that needed none. |
| `bifrost_stream_first_token_latency_seconds` | Time to first token on streaming requests. What a streaming client actually feels. |
| `bifrost_stream_inter_token_latency_seconds` | Gap between tokens on a stream. |
| `bifrost_provider_key_up` | Outcome of the most recent attempt on a key. Read [What `bifrost_provider_key_up` means](#what-bifrost_provider_key_up-means) before alerting on it. |
| `http_request_duration_seconds` | Server-side duration by route, including gateway overhead. |
| `http_request_size_bytes` | Request body size by route. |
| `go_goroutines` | Goroutine count in the gateway. Growth runs ahead of a memory problem. |
| `process_resident_memory_bytes` | Gateway resident memory. |
| `process_open_fds` | Open file descriptors, read against `process_max_fds`. A gateway holding many upstream connections runs out here first. |

### Diagnostic - for investigation and tuning

The rest of the runtime set: 28 `go_` families
(`go_gc_duration_seconds`, the `go_memstats_*` set,
`go_sched_gomaxprocs_threads`, `go_threads`, `go_info`) and 7
`process_` families (`process_cpu_seconds_total`,
`process_virtual_memory_bytes`, `process_virtual_memory_max_bytes`,
`process_max_fds`, `process_start_time_seconds`,
`process_network_receive_bytes_total`,
`process_network_transmit_bytes_total`). Standard Go client library
output with no Bifrost-specific runtime instrumentation.

### Metrics register on first use

A gateway that has served no traffic exposes 40 families, two of them
`http_requests_total` and `http_request_duration_seconds` and the rest
Go runtime. The others appear as code paths run:

| Point | Families | What arrives |
|---|---|---|
| Nothing configured, no traffic | 40 | - |
| After provider and key registration | 41 | `http_request_size_bytes` |
| After the first successful completion | 49 | `bifrost_active_requests`, `bifrost_input_tokens_total`, `bifrost_output_tokens_total`, `bifrost_provider_key_up`, `bifrost_request_retries`, `bifrost_success_requests_total`, `bifrost_upstream_latency_seconds`, `bifrost_upstream_requests_total` |
| Once errors, streaming and cached prompts have occurred | 53 | `bifrost_cache_read_input_tokens_total`, `bifrost_error_requests_total`, `bifrost_stream_first_token_latency_seconds`, `bifrost_stream_inter_token_latency_seconds` |

A dashboard built against a freshly started gateway finds nothing, and a
`bifrost_error_requests_total` alert on a gateway that has never had an
error has no series to evaluate. Write alerts so an absent series reads
as zero.

### What the gateway counters miss

Three request failures all return HTTP 400 to the caller, and only one
of them touches a `bifrost_` family:

| Failure | Reaches a `bifrost_` counter? |
|---|---|
| Provider was never registered | No |
| Body has no `messages` | No |
| Model the provider does not have | Yes - `bifrost_error_requests_total` and `bifrost_upstream_requests_total` |

Validation failures and provider-resolution failures are rejected before
dispatch, so they exist only as
`http_requests_total{status="400"}`. An error-rate alert built solely on
`bifrost_error_requests_total` will not fire on a misconfigured client
or a typo in a provider name. Alert on both families.

`status_code` on `bifrost_error_requests_total` is not always an HTTP
status. A request for a model the provider does not have records
`status_code="unknown"` while the caller receives a 400, and an
unsupported operation records the upstream's own code such as
`status_code="501"`. Treat the label as an error class, not an HTTP
code.

### `model` is client-supplied and unbounded

The `model` label is taken from the request body and recorded before
anything validates it against the registered model list. A single
request for a model that does not exist creates a permanent series on
`bifrost_error_requests_total` and `bifrost_upstream_requests_total`. A
client in a retry loop with a typo is a cardinality incident.

If clients are untrusted, cap the label at the Collector:

```yaml showLineNumbers title="config/otel-collector.yaml (cardinality guard)"
          metric_relabel_configs:
            - source_labels: [model]
              regex: '(gpt-4o|claude-sonnet-4-5|llama-3\.3-70b)'
              action: keep
```

### Most labels are empty, and the two surfaces disagree

The LLM families carry 22 to 24 labels. Seventeen of them are governance
fields - `customer_id`, `customer_name`, `team_id`, `team_name`,
`project_id`, `project_name`, `business_unit_id`, `business_unit_name`,
`virtual_key_id`, `virtual_key_name`, `selected_key_name`, `alias`,
`routing_engine_used`, `routing_rule_id`, `routing_rule_name`,
`complexity_tier` and `complexity_mechanism` - and they stay empty until
governance entities are configured. `selected_key_id` is an eighteenth
empty on any series where no key was selected, which is what a failed
model resolution produces.

The two surfaces handle those empties differently. The Prometheus
receiver drops empty labels, so a scraped counter arrives with about
five attributes. The OTLP push keeps them as empty strings, so the same
counter arrives with eleven. A query that aggregates across both paths
will not match. Run one path or the other, or separate them by resource
attributes.

### What `bifrost_provider_key_up` means

It reports the outcome of the most recent attempt against that key, not
the health of the provider. Any failed attempt drives it to 0, including
failures the provider had nothing to do with: an unsupported operation
returning 501, or a request naming a model the provider does not have. A
single successful request drives it back to 1.

It also holds its last value indefinitely while no request is attempted,
so a 0 on an idle gateway says nothing about now. Pair any alert on it
with a request-rate condition.

### Reading latency and success ratio

`bifrost_upstream_latency_seconds` is the only family with an `is_success`
label, so the success ratio comes from the histogram rather than from
the counters:

```text
rate(bifrost_upstream_latency_seconds_count{is_success="false"}[5m])
  / rate(bifrost_upstream_latency_seconds_count[5m])
```

Its 22 buckets run from 5ms to 900s, which is wide enough for a slow
model but coarse at the fast end. Use
`rate(_sum) / rate(_count)` for a mean and split by `model` - a mean
across mixed models means nothing.

For an error ratio from the counters, use
`bifrost_upstream_requests_total` as the denominator rather than the sum
of success and error. Both are recorded per attempt and the sum is the
same number, but the single family is one query instead of two and stays
correct if a third outcome is added.

### What the traces show

The OTLP surface emits GenAI semantic convention spans. A successful
chat completion produces 26 spans:

| Span | Kind | Count | Note |
|---|---|---|---|
| `/v1/chat/completions` | Server | 1 | Root, named for the route. Carries `http.*`, `bifrost.request.id`, `bifrost.upstream.duration_ms` and `bifrost.overhead.duration_ms`. |
| `chat <model>` | Internal | 1 | The provider call. Carries the GenAI attributes. |
| `plugin.<name>.prerequesthook`, `.prehook`, `.posthook` | Internal | 24 | Three per loaded plugin, eight plugins loaded by default. Each is a few microseconds long. |

The provider span carries `gen_ai.provider.name`,
`gen_ai.operation.name`, `gen_ai.request.model`,
`gen_ai.request.max_tokens`, `gen_ai.response.model`,
`gen_ai.response.finish_reason`, the `gen_ai.usage.*` set and
`gen_ai.input.messages` / `gen_ai.output.messages`. `gen_ai.usage.cost`
is in that set but reads `0` for any model Bifrost has no pricing for,
which includes every self-hosted backend. Streaming adds
`gen_ai.response.time_to_first_chunk`,
`gen_ai.response.total_chunks` and the `bifrost.stream.*` breakdown of
parse, client-write, backpressure and transport time.

Two consequences worth planning for:

- **Volume.** The 24 plugin hook spans per request are 92% of the span
  count and carry only timing attributes. Sample, or accept the
  multiplier.
- **Content.** `gen_ai.input.messages` and `gen_ai.output.messages`
  carry the full prompt and completion text by default. Set
  `disable_content_logging` on the plugin config to remove both while
  keeping the token-usage attributes - see
  [Turn on trace export](#turn-on-trace-export).

Bifrost sets `service.name`, `service.version`, `service.instance.id`,
`telemetry.sdk.language=go`, `telemetry.sdk.version` and
`telemetry.sdk.name=bifrost` on its own OTLP resource. That last value
is the product name rather than an SDK name, so a filter expecting
`telemetry.sdk.name=opentelemetry` will not match these spans.

## Key Alerts to Configure

Request rate, token volume and provider latency are workload-specific,
so the rows below are written as ratios or as comparisons against your
own history rather than as absolute numbers.

| Metric | Threshold | Why it matters |
|---|---|---|
| `up` | `== 0` for 2 scrapes | The gateway is gone or unreachable. |
| `http_requests_total` | `status=~"5.."` rate above the 24h p95 for 10m | Gateway-side failures, including paths no `bifrost_` counter sees. |
| `http_requests_total` | `status="400"` rate above the 24h p95 for 10m | Clients are sending requests that never reach a provider. |
| `bifrost_error_requests_total` | rate against `bifrost_upstream_requests_total` above the 7-day ratio by `> 2x` over 15m | Provider-side failure rate. |
| `bifrost_upstream_latency_seconds` | `rate(_sum) / rate(_count)` for `is_success="true"` above the 7-day mean by `> 2x` over 15m | Provider latency regression. Split by `model`. |
| `bifrost_upstream_latency_seconds` | `rate(_count{is_success="false"}) / rate(_count)` above the 7-day error ratio by `> 2x` over 10m | Success ratio by model and key. |
| `bifrost_active_requests` | above the 24h p95 by `> 2x` for 5m | Requests are piling up in the gateway. |
| `bifrost_stream_first_token_latency_seconds` | `rate(_sum) / rate(_count)` above the 7-day mean by `> 2x` over 15m | Time to first token is the streaming user's latency. |
| `bifrost_request_retries` | `rate(_count) - rate(_bucket{le="0"})` rising over 10m | Requests are needing retries, ahead of visible errors. |
| `bifrost_provider_key_up` | `== 0` for 5m **and** `rate(bifrost_upstream_requests_total[5m]) > 0` | A key is failing. The rate condition is required. |
| `bifrost_input_tokens_total` | rate above the 7-day p95 by `> 2x` for 15m | Cost runaway on the prompt side. |
| `bifrost_output_tokens_total` | rate below the 7-day p05 for 15m while request rate holds | Completions are being truncated or the provider is degrading. |
| `go_goroutines` | above the 24h p95 by `> 2x` for 10m | Goroutine leak. |
| `process_resident_memory_bytes` | above the 24h p95 by `> 1.5x` for 15m | Memory growth ahead of an OOM. |
| `process_open_fds` | above `0.8 * process_max_fds` for 5m | Connection exhaustion against providers. |

## Access Setup

### Reach the metrics endpoint

`/metrics` is on by default and needs no flag. It is served on the main
port alongside the OpenAI-compatible API, the management API and the web
UI, with no authentication of its own:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  bifrost:
    image: maximhq/bifrost:v2.1.0
    environment:
      BIFROST_HOST: 0.0.0.0
    ports:
      - "8080:8080"   # API, management API, web UI and /metrics
    volumes:
      - bifrost-data:/app/data
```

Because there is no separate listener, anything that can read the
metrics can also call `POST /api/providers`. Keep the port on an
internal network and put your own authentication in front of it.

Confirm the exposition before touching the Collector:

```bash showLineNumbers title="Verify access"
curl -s http://localhost:8080/metrics | grep -c '^# TYPE'
curl -s http://localhost:8080/metrics | grep '^bifrost_success_requests_total'
```

If the second command returns nothing, the gateway has not served an LLM
request yet. Send one and try again.

### Add label dimensions

`client_config.prometheus_labels` adds extra label dimensions to the
`bifrost_` families:

```bash showLineNumbers title="Add tenant and app labels"
curl -s -X PUT http://localhost:8080/api/config \
  -H 'content-type: application/json' \
  -d '{"client_config": {"prometheus_labels": ["tenant", "app"], "log_retention_days": 7}}'
```

The API answers with `restart_required: true`, and the labels do not
appear until the gateway restarts. The `PUT` replaces the whole
`client_config` object, so read the current one first and modify it
rather than sending only the field you want to change.

Adding a dimension is not the same as populating it. The label appears
on every LLM series with an empty value, and request headers do not fill
it - not as a bare header name, nor with an `x-`, `x-bf-` or
`x-bf-prom-` prefix. If you need the dimension populated, set it at the
Collector with an `attributes` processor rather than expecting Bifrost
to supply it.

### Turn on trace export

The `otel` plugin is compiled into the binary but is not loaded until
you create it. Setting `OTEL_TRACING`, `OTEL_COLLECTOR_URL` or
`OTEL_METRICS_ENDPOINT` as environment variables does not turn it on;
those names are only referenced by config values of type `env`.

```bash showLineNumbers title="Create the otel plugin"
curl -s -X POST http://localhost:8080/api/plugins \
  -H 'content-type: application/json' \
  -d '{
    "name": "otel",
    "enabled": true,
    "config": {
      "enabled": true,
      "traces_enabled": true,
      "service_name": "bifrost",
      "collector_url": {
        "type": "plain_text",
        "value": "http://otel-collector:4318/v1/traces"
      },
      "trace_type": "genai_extension",
      "protocol": "http",
      "insecure": true,
      "disable_content_logging": true,
      "metrics_enabled": false,
      "export_timeout": 5
    }
  }'
```

Export starts within seconds; no restart is needed. Notes on the fields:

- `collector_url` must carry the full path for HTTP
  (`http(s)://host:port/v1/traces`) and a bare `host:port` for gRPC.
- `disable_content_logging: true` removes `gen_ai.input.messages` and
  `gen_ai.output.messages` while keeping every `gen_ai.usage.*`
  attribute. Turn it on unless you have a reason to ship prompt text.
- `metrics_enabled` is left off above on purpose. Turning it on pushes
  13 families over OTLP under the same names as the scrape, 12 of which
  the Collector is already receiving from the Prometheus receiver, so
  the two arrive as duplicates. Pick one path.
- `trace_type` accepts `genai_extension` and `vercel`.

If you would rather push metrics than scrape them, set
`metrics_enabled: true` with a `metrics_endpoint`, drop the
`prometheus` receiver, and accept the trade: the push carries
`bifrost_overhead_latency_microseconds`, which the scrape does not, but
loses `bifrost_active_requests`, `bifrost_provider_key_up` and
`bifrost_stream_inter_token_latency_seconds`, which the push does not
carry.

## Configuration

The `prometheus` receiver handles metrics and the `otlp` receiver
handles the pushed traces. The scrape is unfiltered, so no metric enable
list is needed; the Prometheus receiver synthesises `up` and four
scrape-status series.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: bifrost
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:BIFROST_HOST}:8080

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
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest` or a
pinned tag of it. Drop the traces pipeline if you are only collecting
metrics.

The `resource` processor deliberately does not set `service.name`. On
the metrics path the `job_name` supplies it, and on the trace path
Bifrost sets its own from the plugin's `service_name`. An upsert here
would overwrite that.

### Environment Variables

```bash showLineNumbers title=".env"
BIFROST_HOST=localhost
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check within 60 seconds:

```bash showLineNumbers
# The gateway families exist - zero means no LLM request has run yet
curl -s http://localhost:8080/metrics | grep -c '^# TYPE bifrost_'

# The Collector is scraping Bifrost
docker logs otel-collector 2>&1 | grep -i "bifrost_success_requests_total"

# Traces are arriving, if the otel plugin is created
docker logs otel-collector 2>&1 | grep -i "gen_ai.request.model"
```

In Scout, `up{job="bifrost"}` should read 1 and
`bifrost_success_requests_total` should climb as requests are served.
Expect 53 families on a gateway that has handled successes, errors and
at least one stream, and fewer until each path has run once.

## Troubleshooting

### The scrape works but no `bifrost_` series arrive

**Cause**: the gateway has not served an LLM request. Every `bifrost_`
family registers on first use.

**Look at**: `curl -s .../metrics | grep -c '^# TYPE bifrost_'`. On a
cold gateway it returns 0 while the endpoint itself returns 200.

**Fix**: register a provider and a key, send one completion, and
re-scrape.

### Provider registration is rejected

**Cause**: one of three things.

**Look at**: the response body from the management API.

**Fix**:

1. `private IP addresses are not allowed` - set
   `network_config.allow_private_network` to `true` when the provider's
   `base_url` points at a host on a private network.
2. `no keys found for provider` - keys are a separate resource. They are
   ignored on `POST /api/providers` and must be sent to
   `POST /api/providers/{provider}/keys`.
3. `could not auto resolve a provider` - the `model` in the request has
   to carry the provider prefix, as in `openai/gpt-4o`.

### An error-rate alert never fires despite failing requests

**Cause**: the failures are validation or provider-resolution failures,
which are rejected before dispatch and touch no `bifrost_` family.

**Look at**: `http_requests_total{status="400"}`. If it is climbing
while `bifrost_error_requests_total` is flat, the requests never reached
a provider.

**Fix**: alert on both families.

### Series count is growing without traffic growth

**Cause**: the `model` label is client-supplied and unvalidated, so
every distinct value a client sends becomes a permanent series.

**Look at**: the distinct values of `model` on
`bifrost_error_requests_total`.

**Fix**: keep only known models with a `metric_relabel_configs` rule at
the receiver, as shown in
[`model` is client-supplied and unbounded](#model-is-client-supplied-and-unbounded).

### Gateway latency rises while provider latency stays flat

**Cause**: the overhead is inside the gateway process, not upstream.
`bifrost_upstream_latency_seconds` measures only the provider call, so
time spent in Go garbage collection or plugin work never shows there.

**Look at**: the Diagnostic-tier Go runtime families -
`go_gc_duration_seconds` for pause time, the `go_memstats_*` set for
heap pressure, and `go_threads` against `go_sched_gomaxprocs_threads`
for scheduler saturation. Compare with `go_goroutines`, which is in the
Operational tier and rises before the others do. Bifrost measures its
own overhead directly as `bifrost_overhead_latency_microseconds`, but
only on the OTLP push path - the scrape does not carry it.

**Fix**: raise the container's CPU limit or `GOMAXPROCS`. If the heap is
the constraint, cut plugin count or request concurrency; the eight
default plugins run three hooks each per request.

### The gateway stops accepting connections under load

**Cause**: file-descriptor exhaustion. Each provider connection and each
inbound request holds a descriptor, and the limit is the container's,
not Bifrost's.

**Look at**: `process_open_fds` against the Diagnostic-tier
`process_max_fds`. A ratio approaching 1 is the ceiling being reached.
`process_network_receive_bytes_total` and
`process_network_transmit_bytes_total` confirm whether traffic is still
flowing while new connections are refused.

**Fix**: raise the container's `nofile` limit, and cap client
concurrency so the gateway sheds load rather than exhausting
descriptors.

### Counters appear twice with different attribute sets

**Cause**: both the Prometheus scrape and the plugin's OTLP metrics push
are running. They emit the same names, and the Prometheus receiver drops
empty labels while the push keeps them, so the two sets do not merge.

**Fix**: set `metrics_enabled: false` on the plugin config and keep the
scrape, or drop the `prometheus` receiver and keep the push.

### Traces do not arrive

**Cause**: the `otel` plugin has not been created, or `collector_url`
is missing its path.

**Look at**: `GET /api/plugins`. A fresh gateway returns `count: 0` even
though `GET /api/plugins/builtins` lists `otel`.

**Fix**:

1. Create the plugin with `POST /api/plugins` as shown above.
2. For `protocol: http`, give `collector_url` the full
   `http://host:4318/v1/traces` path.

## FAQ

### Do I need to turn the metrics endpoint on?

No. It is served at `/metrics` on the main port by default. But it
carries no `bifrost_` families until the gateway has served an LLM
request.

### Which prefix should I gate the scrape on?

Both `bifrost_` and `http_`. `http_requests_total` is the only complete
request count, and requests rejected before provider dispatch appear
nowhere else.

### Why is `bifrost_provider_key_up` zero when the provider is fine?

Because it reports the most recent attempt against that key, whatever
caused it to fail. A request for an unknown model or an unsupported
operation drives it to 0 even though the provider was never at fault,
and it holds that value until the next attempt.

### Can I add tenant or team labels to the metrics?

You can add the dimensions with `client_config.prometheus_labels`, and
the gateway needs a restart for them to appear. The values stay empty -
request headers do not fill them - so add the dimension at the Collector
with an `attributes` processor if you need it populated.

### Should I use the Prometheus scrape or the OTLP metrics push?

The scrape, unless you specifically want
`bifrost_overhead_latency_microseconds`. The push covers 13 families to
the scrape's 15 `bifrost_` and `http_` ones, and running both duplicates
12 of them under the same names with different attribute sets.

### Do the traces contain my prompts?

By default, yes. `gen_ai.input.messages` and `gen_ai.output.messages`
carry the full text. Set `disable_content_logging: true` on the `otel`
plugin config to strip both while keeping token usage and latency.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Bifrost metrics.
- [LiteLLM Gateway Monitoring](./litellm.md) - LLM gateway covering the same
  position; compare the two before standardising on one.
- [vLLM Monitoring](./vllm.md) - Self-hosted model server that commonly sits
  behind a gateway as the upstream provider.

## What's Next?

- **Create Dashboards**: Start with `http_requests_total` split by
  `status`, `bifrost_upstream_latency_seconds` as
  `rate(_sum) / rate(_count)` by `model`, and the two token counters as
  a cost panel. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add [vLLM](./vllm.md) or
  [llama.cpp](./llama-cpp.md) for the serving runtime behind the
  gateway, so provider latency has a counterpart on the model side.
- **Fine-tune Collection**: Decide whether you run traces, and if you do
  whether you sample. The plugin hook spans are 24 of the 26 spans per
  request.
