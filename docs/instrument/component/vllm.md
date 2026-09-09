---
title: >
  vLLM OpenTelemetry Monitoring - KV-Cache Usage, Request Queueing,
  and Collector Setup
sidebar_label: vLLM
id: collecting-vllm-telemetry
sidebar_position: 57
description: >
  Collect vLLM metrics with the OpenTelemetry Collector. Monitor KV-cache
  usage, request queueing, time to first token, and token throughput in
  base14 Scout.
keywords:
  - vllm opentelemetry
  - vllm otel collector
  - vllm metrics monitoring
  - vllm performance monitoring
  - opentelemetry prometheus receiver vllm
  - vllm observability
  - vllm kv cache monitoring
  - llm serving monitoring
  - vllm telemetry collection
---

# vLLM

vLLM's OpenAI-compatible server serves Prometheus text at `/metrics` on
its API port (`8000`). The OpenTelemetry Collector scrapes it with the
Prometheus receiver, collecting 90+ metrics across scheduler state
(running, waiting, KV-cache usage, preemptions), request latency phases
(queue, prefill, decode, time to first token, inter-token), token
throughput, prefix-cache hit rate, the HTTP layer, and process resources,
on vLLM 0.28+. This guide configures the receiver, runs vLLM with the
shared memory it needs, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| vLLM                   | 0.8     | 0.28        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

vLLM 0.8 made the V1 engine the default; it emits the scheduler and
latency phase metrics in this guide. Before starting:

- The API port (`8000`) must be reachable from the host running the
  Collector. `/metrics` is served there, always on, with no flag to
  enable it.
- `/metrics` has no authentication. If the API port is fronted by a
  reverse proxy with an API key, scrape vLLM directly on the internal
  network or exempt the `/metrics` path.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The metric prefix is `vllm:`, with a colon. Prometheus accepts colons in
metric names, the Prometheus receiver passes them through unchanged, and
Scout stores them as-is. Query the names verbatim.

Every `vllm:` series carries `model_name` and `engine` labels.
`vllm:request_success_total` adds `finished_reason` (`stop`, `length`,
`abort`, `error`, `repetition`); `vllm:num_requests_waiting_by_reason`
adds `reason` (`capacity`, `deferred`).

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the vLLM metrics endpoint responded. |
| `vllm:num_requests_running` | Requests in model execution batches. Headline concurrency. |
| `vllm:num_requests_waiting` | Requests waiting to be scheduled. Saturation signal. |
| `vllm:kv_cache_usage_perc` | KV-cache usage as a fraction, 0 to 1 despite the name; 1 = full. The capacity signal that precedes preemption and queueing. |
| `vllm:request_success_total` | Finished requests by `finished_reason`. Throughput and the error and abort rate. |
| `vllm:e2e_request_latency_seconds` | End-to-end request latency. The request SLO. |
| `vllm:time_to_first_token_seconds` | Time to first token. The user-perceived responsiveness SLO. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `vllm:inter_token_latency_seconds` | Latency between consecutive output tokens. Streaming smoothness. |
| `vllm:request_queue_time_seconds` | Time spent waiting before scheduling. Rising queue time means capacity, not model speed. |
| `vllm:request_time_per_output_token_seconds` | Per-request mean time per output token. |
| `vllm:prompt_tokens_total` | Prefill tokens processed. Input token throughput and cost driver. |
| `vllm:generation_tokens_total` | Generation tokens processed. Output token throughput and cost driver. |
| `vllm:num_preemptions_total` | Requests preempted by the engine, normally for KV-cache pressure. Any sustained rate is a capacity problem. |
| `vllm:num_requests_waiting_by_reason` | Waiting requests split by `reason` (`capacity`, `deferred`). Sums to `num_requests_waiting`. |
| `vllm:prefix_cache_queries_total` | Tokens queried against the prefix cache. Denominator of the hit rate. |
| `vllm:prefix_cache_hits_total` | Tokens served from the prefix cache. Numerator of the hit rate; a direct compute saver for shared system prompts. |
| `vllm:engine_sleep_state` | Engine sleep level by `sleep_state`; `awake` = 1 means serving. |
| `http_requests_total` | API requests by `handler`, `method`, `status` class. The HTTP-level error rate, including 4xx before the engine. |
| `http_request_duration_seconds` | API request duration by handler. |
| `process_resident_memory_bytes` | Server process RSS. Model weights plus KV cache on the CPU backend. |
| `process_cpu_seconds_total` | Server process CPU time. |

Three latency phases are exposed per request: queue time
(`vllm:request_queue_time_seconds`), prefill
(`vllm:request_prefill_time_seconds`) and decode
(`vllm:request_decode_time_seconds`).
`vllm:request_inference_time_seconds` covers prefill plus decode, and
`vllm:e2e_request_latency_seconds` covers all three. Time to first token
and inter-token latency are the user-facing pair; the phase histograms
are how you localize which one moved.

### Diagnostic - for investigation and tuning

Higher cardinality or per-request distributions.

| Group | Metrics | When you reach for it |
|---|---|---|
| Latency phases | `vllm:request_prefill_time_seconds`, `vllm:request_decode_time_seconds`, `vllm:request_inference_time_seconds` | Splitting an end-to-end latency regression into prefill, decode, or prefill plus decode. |
| Request size | `vllm:request_prompt_tokens`, `vllm:request_generation_tokens`, `vllm:request_max_num_generation_tokens`, `vllm:request_prefill_kv_computed_tokens` | Input and output size distribution; new KV tokens computed per prefill, excluding cached tokens. |
| Request parameters | `vllm:request_params_max_tokens`, `vllm:request_params_n` | The `max_tokens` and `n` parameters clients send. |
| Batch efficiency | `vllm:iteration_tokens_total` | Tokens per engine step. |
| Cache detail | `vllm:prompt_tokens_by_source_total`, `vllm:prompt_tokens_cached_total`, `vllm:external_prefix_cache_queries_total`, `vllm:external_prefix_cache_hits_total`, `vllm:mm_cache_queries_total`, `vllm:mm_cache_hits_total` | Prompt tokens by `source`; prefix cache across a KV connector (cross-instance sharing); multi-modal cache. |
| MFU estimates | `vllm:estimated_flops_per_gpu_total`, `vllm:estimated_read_bytes_per_gpu_total`, `vllm:estimated_write_bytes_per_gpu_total` | Model FLOPs Utilization inputs. Read 0 on the CPU backend. |
| Cache config | `vllm:cache_config_info` | Info gauge (value 1) whose labels carry `block_size`, `num_gpu_blocks`, `kv_cache_size_tokens`, `kv_cache_memory_bytes`, `enable_prefix_caching`, `gpu_memory_utilization`, `kv_cache_max_concurrency`. |
| HTTP sizes | `http_request_size_bytes`, `http_response_size_bytes`, `http_request_duration_highr_seconds` | Body sizes; high-resolution duration with no `handler` label. |
| Process | `process_open_fds`, `process_max_fds`, `process_virtual_memory_bytes`, `process_start_time_seconds` | File descriptors, virtual memory, start time. |
| Python | `python_gc_collections_total`, `python_gc_objects_collected_total`, `python_gc_objects_uncollectable_total`, `python_info` | Interpreter GC and version. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Prometheus receiver scrape health. |
| `*_created` | 26 `vllm:` and 5 `http_` gauges | Series creation timestamps. No operational meaning; optional to drop. |

Several families read zero until the workload exercises them:
`vllm:external_prefix_cache_*` need a KV connector, `vllm:mm_cache_*` need
a multi-modal model, `vllm:prompt_tokens_cached_total` follows prefix
hits, and the `vllm:estimated_*_per_gpu_total` estimates stay 0 on the
CPU backend.

Full metric list: see the
[vLLM metrics reference](https://docs.vllm.ai/en/latest/design/metrics.html),
or run `curl -s http://localhost:8000/metrics` against your vLLM instance.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
Absolute latency numbers depend on the model, hardware, and prompt
shape, so the latency rows are relative to your own baseline. Tune to
your workload; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `up` | - | `== 0` for > 1m | The metrics endpoint stopped responding; check the container and port 8000. |
| `vllm:kv_cache_usage_perc` | `> 0.9` sustained | `> 0.9` with preemptions | Preemption and queueing follow; add replicas, lower `max_model_len`, or raise the cache budget. |
| `vllm:num_requests_waiting` | `> 0` sustained | Growing | Capacity, not model speed; scale out or shed load. Check `num_requests_waiting_by_reason` for `capacity` vs `deferred`. |
| `vllm:request_queue_time_seconds` (p99) | Rising vs baseline | Sustained rise | Requests wait before scheduling; same capacity remedy. |
| `rate(vllm:num_preemptions_total)` | `> 0` | Sustained | The engine is evicting requests for cache space; correlate with KV-cache usage. |
| `rate(vllm:request_success_total{finished_reason=~"error\|abort"})` | `> 0` vs baseline | Rising | Requests are failing or clients are disconnecting; inspect the API logs and client timeouts. |
| `vllm:time_to_first_token_seconds` (p99) | Rising vs baseline | Sustained rise | Prefill or queueing is slow; check queue time first, then prompt length distribution. |
| `vllm:e2e_request_latency_seconds` (p99) | Rising vs baseline | Sustained rise | Split via the phase histograms: queue, prefill, decode. |
| `vllm:inter_token_latency_seconds` (p99) | Rising vs baseline | Sustained rise | Decode is slow; batch too large for the hardware or memory-bandwidth bound. |
| `rate(vllm:prefix_cache_hits_total) / rate(vllm:prefix_cache_queries_total)` | Below baseline | - | Shared system prompts are not being reused; check `enable_prefix_caching` and block alignment. |
| `rate(http_requests_total{status="5xx"})` | `> 0` | Sustained | The API layer is failing before or after the engine; check server logs. |
| `vllm:engine_sleep_state{sleep_state="awake"}` | - | `== 0` | The engine was put to sleep and is not serving; wake it or check the orchestrator. |

The latency rows are Prometheus histograms - there is no ready-made `p99`
series to threshold. Compute the percentile from the buckets in your alert
rule, for example
`histogram_quantile(0.99, rate(vllm:time_to_first_token_seconds_bucket[5m]))`.

## Access Setup

vLLM exposes `/metrics` on the API port with no flag to enable it and no
credentials. Access setup is about running the server so the engine
starts, and confirming the endpoint answers.

The engine core creates a multiprocess message queue in `/dev/shm` at
startup. Docker's default 64 MB `/dev/shm` is too small and the engine
core fails before serving. Set `shm_size: "2g"` and `ipc: host` on the
service.

**Docker setup** - the GPU image `vllm/vllm-openai`, with the model as a
positional argument to `vllm serve` (the `--model` flag is deprecated):

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  vllm:
    image: vllm/vllm-openai:latest
    command:
      - your-org/your-model          # positional model; --model is deprecated
      - --max-model-len
      - "4096"
    gpus: all
    shm_size: "2g"
    ipc: host
    volumes:
      - ~/.cache/huggingface:/root/.cache/huggingface
    ports:
      - "8000:8000"
```

For hosts without a GPU, use the CPU image `vllm/vllm-openai-cpu`. The
same `shm_size` and `ipc` settings apply, and `VLLM_CPU_KVCACHE_SPACE`
sets the KV-cache size in GiB:

```yaml showLineNumbers title="compose.yaml (CPU excerpt)"
services:
  vllm:
    image: vllm/vllm-openai-cpu:latest
    command:
      - your-org/your-model
      - --max-model-len
      - "512"
    environment:
      VLLM_CPU_KVCACHE_SPACE: "2"     # KV cache in GiB
    shm_size: "2g"
    ipc: host
    ports:
      - "8000:8000"
```

**Bare-metal setup** - install vLLM into a virtualenv and start the
server on the host. `/dev/shm` on a bare host is normally large enough;
the shared-memory constraint is a container default.

```bash showLineNumbers title="Start vLLM"
pip install vllm
vllm serve your-org/your-model --max-model-len 4096
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# The server lists the loaded model once the engine is up
curl -s http://localhost:8000/v1/models

# Verify the metrics endpoint
curl -s http://localhost:8000/metrics | grep '^vllm:' | head -20
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: vllm
          scrape_interval: 10s
          static_configs:
            - targets:
                # host:port vLLM's API is reachable on
                - ${env:VLLM_HOST}:${env:VLLM_PORT}

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
per-metric enable list; new series appear after a vLLM upgrade with no
Collector change. Scout authentication for the `otlphttp/b14` exporter is
covered in [Scout Exporter](../collector-setup/scout-exporter.md).

### Environment Variables

```bash showLineNumbers title=".env"
VLLM_HOST=localhost
VLLM_PORT=8000
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Controlling metric volume

Every counter and histogram vLLM exposes has a `_created` companion gauge
carrying the series start time. The receiver emits them as separate
gauges - 26 `vllm:` and 5 `http_` - with no operational meaning. A drop
rule on the scrape job removes them:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: ".*_created"
              action: drop
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped vLLM metrics
docker logs otel-collector 2>&1 | grep "vllm:"

# Check the scheduler gauges directly on the metrics endpoint
curl -s http://localhost:8000/metrics | grep -E '^vllm:num_requests_(running|waiting) '

# Generate traffic so the request counters and histograms advance
curl -s http://localhost:8000/v1/completions \
  -H 'Content-Type: application/json' \
  -d '{"model": "your-org/your-model", "prompt": "Hello", "max_tokens": 32}'

# Confirm a finished request was counted
curl -s http://localhost:8000/metrics | grep '^vllm:request_success_total'
```

In Scout, query `vllm:num_requests_running` by `model_name` to confirm
the series arrived with the colon-prefixed name intact.

## Troubleshooting

### Engine core fails at startup

**Cause**: The engine core could not create its multiprocess message
queue in `/dev/shm`. Docker's default 64 MB `/dev/shm` is too small.

**Look at**: the container log at startup. The API port never opens, so
`up` reads 0 and no `vllm:` series appear.

**Fix**:

1. Set `shm_size: "2g"` and `ipc: host` on the vLLM service (see
   [Access Setup](#access-setup)).
2. On Kubernetes, mount an `emptyDir` with `medium: Memory` at
   `/dev/shm`.

### `/v1/chat/completions` returns 4xx

**Cause**: The model has no chat template, so the chat endpoint rejects
the request before it reaches the engine. Base models such as
`facebook/opt-125m` ship without one.

**Look at**: `http_requests_total{status="4xx"}` advancing by `handler`
while `vllm:request_success_total` and the `vllm:` latency histograms do
not move - the request failed in the API layer, not in the engine.

**Fix**:

1. Use `/v1/completions` for base models.
2. For chat, serve an instruction-tuned model that ships a chat
   template, or pass one with `--chat-template`.

### `vllm:prefix_cache_hits_total` stays 0

**Cause**: Prefix-cache hits need prompts that share at least one full
block; `block_size` is 128 tokens by default. Prompts shorter than one
block, or that diverge before the first block boundary, never hit.

**Look at**: `vllm:prefix_cache_queries_total` advancing while hits
stay at 0. The Diagnostic `vllm:cache_config_info` labels show
`block_size` and whether `enable_prefix_caching` is on.

**Fix**:

1. Confirm `enable_prefix_caching` reads true in `cache_config_info`.
2. Front prompts with a shared system prompt of at least one full block.
3. Hits appear once prompts share a complete block; short one-off prompts
   do not.

### End-to-end latency is rising

**Cause**: One of the three request phases has slowed, and the
end-to-end histogram does not say which.

**Look at**: `vllm:request_queue_time_seconds` first (Operational). If
queue time is flat, the Diagnostic `vllm:request_prefill_time_seconds`
and `vllm:request_decode_time_seconds` split the remainder.
`vllm:request_prompt_tokens` and `vllm:request_generation_tokens` show
whether request sizes changed at the same time.

**Fix**:

1. Queue time up: capacity. Scale out, or check
   `vllm:kv_cache_usage_perc` and `vllm:num_preemptions_total`.
2. Prefill up: longer prompts, or prefix-cache reuse dropped.
3. Decode up: batch too large for the hardware, or memory-bandwidth
   bound; `vllm:iteration_tokens_total` shows tokens per step.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.
4. Query the name with the colon, `vllm:num_requests_running`, not
   `vllm_num_requests_running`.

## FAQ

### Does `/metrics` need a GPU?

No. The endpoint is served by the API process on both the GPU image and
the CPU image (`vllm/vllm-openai-cpu`). The metric surface is the same;
the `vllm:estimated_*_per_gpu_total` estimates read 0 on the CPU
backend.

### Why do the metric names contain colons?

vLLM uses `vllm:` as its Prometheus namespace. Colons are valid in
Prometheus metric names, the Prometheus receiver passes them through,
and Scout stores them unchanged. Query `vllm:kv_cache_usage_perc`, not
`vllm_kv_cache_usage_perc`.

### What is the `engine` label?

The data-parallel engine index. A single-engine deployment has one
value; with data parallelism each engine reports its own scheduler
gauges, so sum or group by `engine` for the instance-wide picture.

### Is `vllm:kv_cache_usage_perc` a percentage?

No. It is a fraction from 0 to 1 despite the name. Alert on `> 0.9`,
not `> 90`.

### Does this work with vLLM running in Kubernetes?

Yes. Set `targets` to the vLLM service DNS (for example
`vllm.default.svc.cluster.local:8000`), or use `kubernetes_sd_configs`
to discover pods. Mount a memory-backed `emptyDir` at `/dev/shm` so the
engine core starts.

### Can vLLM emit traces as well?

Yes. vLLM can send OTLP traces for each request with
`--otlp-traces-endpoint`. This guide covers the metrics surface only.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on vLLM metrics.
- [LiteLLM Gateway Monitoring](./litellm.md) - LLM gateway that commonly
  fronts vLLM; pair both for the gateway-to-backend view.
- [LLM Observability](../../guides/ai-observability/llm-observability.md) -
  Application-side tracing of LLM calls, token usage and cost.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Redis](./redis.md), [NGINX](./nginx.md), and other components.
- **Fine-tune Collection**: Drop the `_created` gauges with
  `metric_relabel_configs`, and use the `model_name` and `engine` labels
  to split dashboards per served model.
