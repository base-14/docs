---
title: >
  llama.cpp OpenTelemetry Monitoring - Slot Occupancy, Token Throughput,
  and Collector Setup
sidebar_label: llama.cpp
id: collecting-llama-cpp-telemetry
sidebar_position: 59
description: >
  Collect llama.cpp llama-server metrics with the OpenTelemetry Collector.
  Monitor slot occupancy, request queueing, token throughput, and ship to
  base14 Scout.
keywords:
  - llama.cpp opentelemetry
  - llama.cpp otel collector
  - llama-server metrics monitoring
  - llama.cpp performance monitoring
  - opentelemetry prometheus receiver llama.cpp
  - llama.cpp observability
  - llm serving monitoring
  - llama.cpp telemetry collection
---

# llama.cpp

llama.cpp's `llama-server` serves Prometheus text at `/metrics` on its
API port (`8080`) when started with `--metrics`. The OpenTelemetry
Collector scrapes it with the Prometheus receiver, collecting 15
`llamacpp:` series covering slot occupancy and queueing, prompt and
generation token throughput, prompt-cache reuse, batching efficiency, and
speculative decoding. The endpoint is **off by default** - without
`--metrics` it answers HTTP 501. This guide turns the
endpoint on, configures the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended     |
| ---------------------- | ------- | --------------- |
| llama.cpp              | b7191   | b10795 or later |
| OTel Collector Contrib | 0.90.0  | latest          |
| base14 Scout           | Any     | -               |

Before starting:

- `llama-server` must be started with `--metrics` (or the environment
  variable `LLAMA_ARG_ENDPOINT_METRICS=1`). Without it, `/metrics`
  answers HTTP 501 with a `not_supported_error` body telling you to
  restart the server with `--metrics`.
- The API port (`8080`) must be reachable from the host running the
  Collector. `/metrics` is served on the same port as the inference API.
- `/metrics` has no authentication. Scrape it on the internal network, or
  exempt the path at a fronting proxy.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Upgrading from a pre-b7191 build?
Builds before **b7191** (published 2025-11-28) serve `/metrics` as
JSON-escaped text wrapped in double quotes, which the Prometheus receiver
cannot parse. Upstream PR #17386 fixed the exposition format; b7191 is
the first build that carries it. Full notes:
[Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The metric prefix is `llamacpp:`, with a colon. Prometheus accepts colons
in metric names, the Prometheus receiver passes them through unchanged,
and Scout stores them as-is. Query the names verbatim.

**None of the emitted series carries a label.** There is no model, slot,
or endpoint dimension - every `llamacpp:` name arrives as a single
unlabelled data point. A multi-model or router deployment therefore needs
one scrape target per server. Router mode documents a
`/metrics?model=<id>` form for selecting a served model; confirm it
against your build before relying on it.

The exposed names do not follow one pattern. The generation counters use
`tokens_predicted_`, while the generation gauge uses `predicted_tokens_`.
Copy the names below character for character.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the llama.cpp metrics endpoint responded. |
| `llamacpp:requests_processing` | Requests currently occupying a slot. Caps at the slot count; equal to the slot count means full. |
| `llamacpp:requests_deferred` | Requests queued because every slot is busy. The saturation signal. |
| `llamacpp:predicted_tokens_seconds` | Generation throughput of the last completed request, tokens/s. Reads 0 when idle, so chart and alert on the counter-derived rate `rate(llamacpp:tokens_predicted_total[10m]) / rate(llamacpp:tokens_predicted_seconds_total[10m])` instead. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `llamacpp:tokens_predicted_total` | Generated tokens since start. Output throughput and cost driver. |
| `llamacpp:tokens_predicted_seconds_total` | Seconds spent generating. Denominator for a smoothed tokens/s. |
| `llamacpp:prompt_tokens_total` | Prompt tokens processed (prefill), excluding cache hits. Input throughput. |
| `llamacpp:prompt_seconds_total` | Seconds spent in prefill. Denominator for prompt tokens/s. |
| `llamacpp:prompt_tokens_seconds` | Prefill throughput of the last completed request, tokens/s. Reads 0 when idle. |
| `llamacpp:prompt_tokens_cached_total` | Prompt tokens served from the prompt cache. Numerator of the cache hit ratio. |
| `llamacpp:n_tokens_max` | High-water mark of tokens in a slot. Sits at the per-slot context minus one once any request fills a slot. |

Four things about this tier decide whether your dashboards and alerts
are correct:

- **The two throughput gauges are per-request, not lifetime averages.**
  `llamacpp:prompt_tokens_seconds` and
  `llamacpp:predicted_tokens_seconds` carry the rate of the most recently
  completed request and read `0` whenever the server is idle. Alerting on
  them directly pages during quiet periods. Derive throughput from the
  counters instead:
  `rate(llamacpp:tokens_predicted_total[10m]) /
  rate(llamacpp:tokens_predicted_seconds_total[10m])`.
- **Cached and processed prompt tokens are disjoint.**
  `llamacpp:prompt_tokens_cached_total` counts tokens served from the
  prompt cache; `llamacpp:prompt_tokens_total` counts tokens actually
  prefilled. The cache hit ratio is `cached / (cached + total)`, not
  `cached / total`.
- **`llamacpp:n_tokens_max` is exported as a Sum but behaves as a
  high-water mark.** It sits at the per-slot context minus one once any
  request fills a slot. Do not apply `rate()` to it.
- **The slot count controls concurrency.** `--parallel` sets the number
  of server slots (default `-1`, auto) and `--ctx-size` is divided across
  them. `llamacpp:requests_processing` caps at the slot count, and every
  surplus request lands in `llamacpp:requests_deferred`.

There is no error counter and no latency histogram on this surface.
Request failures, end-to-end latency, and time to first token have to
come from the client or from a proxy in front of the server. Over-long
generations are truncated rather than rejected: a request asking for more
tokens than the slot context is silently truncated, and the only signal
is the `truncated` field in the response body.

### Diagnostic - for investigation and tuning

Reach for these during an incident or a capacity review.

| Metric | When you reach for it |
|---|---|
| `llamacpp:n_decode_total` | Decode steps executed. Divided by `llamacpp:tokens_predicted_total` it gives tokens per step. |
| `llamacpp:n_busy_slots_per_decode` | Mean busy slots per decode step. Batching efficiency; 1.0 means no batching. |
| `llamacpp:spec_decode_num_drafts_total` | Speculative decoding drafts. 0 without a draft model. |
| `llamacpp:spec_decode_num_draft_tokens_total` | Speculative decoding draft tokens. 0 without a draft model. |
| `llamacpp:spec_decode_num_accepted_tokens_total` | Speculative decoding accepted tokens. Divided by draft tokens it gives the acceptance rate. |
| `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Prometheus receiver scrape health. |

The three `spec_decode_*` counters are real series that sit at `0` until
a draft model is loaded with `-md`. They are present, not absent.

`/slots` is enabled by default (`--slots` / `--no-slots`, env
`LLAMA_ARG_ENDPOINT_SLOTS`) and returns per-slot state that `/metrics`
does not: `n_ctx`, `is_processing`, `n_prompt_tokens`,
`n_prompt_tokens_cache`, and the sampling parameters. Use it when a
single slot appears stuck. `POST /props` is off by default (`--props`).

Full metric list: run `curl -s http://localhost:8080/metrics` against
your server.

## Key Alerts to Configure

Absolute token rates depend on the model, the hardware, and the prompt
shape, so every threshold below is relative to your own trailing
baseline. `up == 0` is the one state read. Tune to your workload; these
are starting points.

| Alert | Expression | Why it matters |
|---|---|---|
| Server down | `up == 0` for 2m | The metrics endpoint stopped answering. Also fires when someone restarts the server without `--metrics`. |
| Requests queueing | `llamacpp:requests_deferred > 0` for 5m | Every slot is busy and requests are waiting. Raise `--parallel` or add a server. |
| Slots pinned full | `llamacpp:requests_processing` at the configured slot count for 10m | Sustained full occupancy; queueing is imminent. The slot count is a deployment constant, not a metric, so write it into the rule. |
| Generation throughput collapse | `rate(llamacpp:tokens_predicted_total[10m]) / rate(llamacpp:tokens_predicted_seconds_total[10m])` below a fraction of its 24h baseline | Derived from the counters so idle periods do not skew it. Do not use `llamacpp:predicted_tokens_seconds` here - that gauge reads 0 when idle. |
| Prompt cache hit ratio drop | `rate(llamacpp:prompt_tokens_cached_total[15m]) / (rate(llamacpp:prompt_tokens_cached_total[15m]) + rate(llamacpp:prompt_tokens_total[15m]))` below baseline | Losing prefix reuse raises prefill cost directly. |
| Prefill stall | `rate(llamacpp:prompt_seconds_total[10m])` rising while `rate(llamacpp:prompt_tokens_total[10m])` is flat | Time is going into prefill without tokens coming out. |

## Access Setup

The metrics endpoint is off by default. Turn it on with the `--metrics`
flag or the `LLAMA_ARG_ENDPOINT_METRICS` environment variable - the two
forms are equivalent, and the environment variable is the easier one to
set through a container spec you do not own.

```bash showLineNumbers title="Start llama-server with metrics on"
# Flag form
llama-server -hf your-org/your-model-GGUF \
  --host 0.0.0.0 --port 8080 \
  --ctx-size 4096 \
  --parallel 4 \
  --metrics

# Environment-variable form
LLAMA_ARG_ENDPOINT_METRICS=1 llama-server -hf your-org/your-model-GGUF
```

**Docker setup** - the same two forms, on the official server image:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  llama-cpp:
    image: ghcr.io/ggml-org/llama.cpp:server
    command:
      - -hf
      - your-org/your-model-GGUF     # model repo or a mounted .gguf path
      - --host
      - 0.0.0.0
      - --ctx-size
      - "4096"
      - --parallel
      - "4"                          # slot count; caps concurrency
      - --metrics                    # required; endpoint is off by default
    ports:
      - "8080:8080"
    volumes:
      - llama-models:/root/.cache/llama.cpp

volumes:
  llama-models:
```

`/metrics` carries no authentication and sits on the same port as the
inference API, so it must not be exposed publicly. Scrape it over the
internal network, or exempt the `/metrics` path at whatever proxy fronts
the API.

### Choosing `--parallel` and `--ctx-size` together

`--parallel` sets the number of slots and `--ctx-size` is the total
context divided across them: `--ctx-size 4096 --parallel 4` gives each
slot 1024 tokens. Raising the slot count raises the concurrency ceiling
and lowers the per-request context in the same step, so size the two
against your longest expected prompt plus generation. `--parallel`
defaults to `-1`, which picks a slot count automatically; set it
explicitly when you want the alert on
`llamacpp:requests_processing` to compare against a known constant.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# The server lists the loaded model once it is up
curl -s http://localhost:8080/v1/models

# Verify the metrics endpoint; 501 means --metrics is missing
curl -s http://localhost:8080/metrics | grep '^llamacpp:' | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: llama-cpp
          scrape_interval: 15s
          static_configs:
            - targets:
                # host:port llama-server's API is reachable on
                - ${env:LLAMA_CPP_HOST}:8080

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
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
```

The Prometheus receiver keeps everything `/metrics` exposes. There is no
per-metric enable list, so new series appear after a llama.cpp upgrade
with no Collector change. The receiver also synthesizes `up` and the four
`scrape_*` series. Scout authentication for the `otlphttp/b14` exporter
is covered in
[Scout Exporter](../collector-setup/scout-exporter.md).

Run the Collector from
`otel/opentelemetry-collector-contrib:latest` (or a pinned tag of the
same image) alongside the server.

### Environment Variables

```bash showLineNumbers title=".env"
LLAMA_CPP_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the endpoint is serving the concurrency gauge
curl -s http://localhost:8080/metrics | grep 'llamacpp:requests_processing'

# Check Collector logs for scraped llama.cpp metrics
docker logs otel-collector 2>&1 | grep "llamacpp:"

# Generate traffic so the token counters advance
curl -s http://localhost:8080/v1/completions \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Hello", "n_predict": 32}'

# Confirm generated tokens were counted
curl -s http://localhost:8080/metrics | grep 'llamacpp:tokens_predicted_total'
```

In Scout, query `llamacpp:requests_processing` to confirm the series
arrived with the colon-prefixed name intact.

## Troubleshooting

### `/metrics` returns HTTP 501 `not_supported_error`

**Cause**: The server was started without `--metrics`. The endpoint is
off by default and the 501 body says so.

**Fix**:

1. Restart `llama-server` with `--metrics`, or set
   `LLAMA_ARG_ENDPOINT_METRICS=1` in its environment.
2. In a container spec you do not control, the environment variable is
   usually easier to inject than an extra argument.

### The receiver reports a parse error and `/metrics` output is quoted

**Cause**: The build predates b7191 and serves the exposition as
JSON-escaped text wrapped in double quotes, which the Prometheus receiver
cannot parse.

**Look at**: the raw response -
`curl -s http://localhost:8080/metrics | head -3`. A leading `"` on the
first line confirms it.

**Fix**: Upgrade to b7191 or later (see
[Updates & Upgrades](#updates--upgrades)).

### The throughput gauges read 0 on the dashboard

**Cause**: `llamacpp:predicted_tokens_seconds` and
`llamacpp:prompt_tokens_seconds` carry the rate of the most recently
completed request, not a lifetime average. They read 0 whenever the
server was idle at scrape time.

**Look at**: `llamacpp:tokens_predicted_total` - if it is still
advancing, the server is serving and only the gauge is idle-zeroed.

**Fix**: Chart and alert on the counter-derived rate,
`rate(llamacpp:tokens_predicted_total[10m]) /
rate(llamacpp:tokens_predicted_seconds_total[10m])`, and keep the gauges
for spot checks only.

### `llamacpp:requests_deferred` is always high

**Cause**: The slot count is too low for the offered load. Every request
beyond the slot count queues.

**Look at**: `llamacpp:requests_processing` sitting at the configured
slot count, with `llamacpp:requests_deferred` above 0 alongside it. The
Diagnostic `llamacpp:n_busy_slots_per_decode` shows whether the slots
you do have are being batched.

**Fix**:

1. Raise `--parallel`. Each slot then gets a smaller share of
   `--ctx-size`, so raise `--ctx-size` in step if prompts are long.
2. Add another server and a scrape target for it if the host is already
   compute-bound.

### Speculative decoding is loaded but throughput did not improve

**Cause**: the draft model is being rejected more often than it is
accepted, so every drafted token costs compute and returns nothing.

**Look at**: the Diagnostic tier's `spec_decode_*` counters. The
acceptance rate is
`llamacpp:spec_decode_num_accepted_tokens_total` divided by
`llamacpp:spec_decode_num_draft_tokens_total`; a low ratio means the
draft model disagrees with the target model too often to pay for itself.
`llamacpp:spec_decode_num_drafts_total` confirms drafting is happening at
all - all three sit at `0` without a draft model loaded via `-md`.

**Fix**: use a draft model from the same family and tokenizer as the
target, or drop speculative decoding. Compare
`llamacpp:tokens_predicted_seconds_total` against
`llamacpp:tokens_predicted_total` before and after to confirm the change
paid off.

### Responses are cut off mid-sentence

**Cause**: The request asked for more tokens than the per-slot context
allows. llama.cpp truncates rather than rejecting, and no metric records
it.

**Look at**: the `truncated` field in the response body, and the per-slot
`n_ctx` from `GET /slots`. `llamacpp:n_tokens_max` sitting at the
per-slot context minus one confirms a slot was filled.

**Fix**:

1. Lower `n_predict` / `max_tokens` on the client, or
2. Raise `--ctx-size`, or lower `--parallel` so each slot gets more of
   it.

### No `llamacpp:` series in Scout but `up == 1`

**Cause**: The query is dropping the colon. The receiver passes
`llamacpp:` through unchanged and Scout stores it as-is.

**Fix**:

1. Query `llamacpp:requests_processing`, not
   `llamacpp_requests_processing`.
2. If the names are right and still nothing arrives, check the Collector
   logs for export errors (`docker logs otel-collector`), confirm
   `OTEL_EXPORTER_OTLP_ENDPOINT`, and confirm the pipeline lists both the
   receiver and the exporter.

## Updates & Upgrades

### llama.cpp version changes

- **Before b7191 → b7191+**: `/metrics` changed from JSON-escaped text
  wrapped in double quotes to plain Prometheus exposition (upstream PR
  #17386). The Prometheus receiver cannot parse the older form, so a
  scrape job against a pre-b7191 server fails outright. b7191 is the
  minimum build for this guide. _(breaking on the older build; the fix is
  the upgrade)_
- **Speculative decoding counters**: `llamacpp:spec_decode_*` were added
  upstream on 2026-08-05 (PR #26389), building on the acceptance-rate
  work in PR #24536. Builds between b7191 and those merges expose the
  rest of the surface without the `spec_decode_*` family, so panels that
  reference them read empty rather than zero. _(additive)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no receiver-key
  rename across the supported Collector range, so the Collector config is
  stable on an image bump. New `llamacpp:` series appear automatically
  because there is no per-metric enable list. _(no breaking change on the
  Prometheus path)_

## FAQ

### How do I monitor several llama-server instances?

Add one scrape target per server. No emitted series carries a model,
slot, or instance dimension, so the servers cannot be told apart within a
single target. The Prometheus receiver sets `service.instance.id` from
the target's `host:port`, which is what distinguishes them in Scout.

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: llama-cpp
          scrape_interval: 15s
          static_configs:
            - targets:
                - llama-cpp-1:8080
                - llama-cpp-2:8080
```

### Why is there no request-latency or error metric?

The surface exposes counters and gauges only - no histogram and no
failure counter. End-to-end latency, time to first token, and request
failures have to come from the client or from a proxy in front of the
server. If you already run a gateway such as LiteLLM ahead of
`llama-server`, take those signals from there.

### What does `llamacpp:n_busy_slots_per_decode` mean?

The mean number of busy slots per decode step. `1.0` means no batching -
each decode step served a single request. It rises with concurrency as
the server batches requests into the same step, which is where the
throughput gain from multiple slots comes from. A value stuck near 1.0
while `llamacpp:requests_deferred` is above 0 points at slots that are
not being filled.

### Is it a problem that the `spec_decode_*` series read 0?

No. Speculative decoding needs a draft model, loaded with `-md`. Without
one, the three counters are real series sitting at zero rather than
missing series. They start advancing as soon as a draft model is
configured, and draft tokens over accepted tokens gives the acceptance
rate.

### Does this work with llama.cpp running in Kubernetes?

Yes. Set `targets` to the service DNS (for example
`llama-cpp.default.svc.cluster.local:8080`), and run the Collector as a
sidecar in the same pod or as a DaemonSet. Pass `--metrics` through the
container `args`, or set `LLAMA_ARG_ENDPOINT_METRICS=1` in `env` when the
argument list is managed by a chart.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on llama.cpp metrics.
- [vLLM Monitoring](./vllm.md) - Self-hosted model server for GPU
  throughput serving, where llama.cpp serves CPU and single-node GGUF.
- [LiteLLM Gateway Monitoring](./litellm.md) - LLM gateway that commonly
  fronts a llama-server, and where request latency and error rates live.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [vLLM](./vllm.md), [LiteLLM Gateway](./litellm.md), and other
  components.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic,
  and add a scrape target for every additional `llama-server` you run.
