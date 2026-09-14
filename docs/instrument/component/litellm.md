---
title: >
  LiteLLM Gateway OpenTelemetry Monitoring - Deployment Health, Token Spend,
  and Collector Setup
sidebar_label: LiteLLM Gateway
id: collecting-litellm-telemetry
sidebar_position: 58
description: >
  Collect LiteLLM proxy metrics with the OpenTelemetry Collector. Monitor
  deployment health, failures, latency, token spend, and key budgets in
  base14 Scout.
keywords:
  - litellm opentelemetry
  - litellm otel collector
  - litellm metrics monitoring
  - litellm proxy monitoring
  - opentelemetry prometheus receiver litellm
  - litellm observability
  - llm gateway monitoring
  - litellm token spend monitoring
  - litellm telemetry collection
---

# LiteLLM Gateway

The LiteLLM proxy serves Prometheus text at `/metrics/` on its API port
(`4000`) once the `prometheus` callback is enabled. The endpoint sits
behind the proxy's API key, so the OpenTelemetry Collector's Prometheus
receiver scrapes it with a Bearer token, collecting 40+ metrics across
proxy request and failure rates, per-deployment health and cooldowns,
latency (end to end, backend call, queue wait), token throughput and
spend, and key and user budgets, on LiteLLM 1.85+. This guide enables the
callback, configures the authenticated scrape, and ships metrics to base14
Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| LiteLLM                | 1.85    | 1.99        |
| OTel Collector Contrib | 0.90.0  | latest      |
| base14 Scout           | Any     | -           |

LiteLLM 1.85 put `/metrics` behind the proxy API key. Proxies older than
1.85 serve `/metrics` without a key; the Bearer header in this guide is
harmless there. Before starting:

- The API port (`4000`) must be reachable from the host running the
  Collector. `/metrics/` is served there once
  `litellm_settings.callbacks` includes `prometheus`.
- A proxy API key for the Collector. Any valid key scrapes; a dedicated
  key keeps the scrape credential separate from caller keys.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or a budget review.

Counters carry a `_total` suffix that the LiteLLM documentation omits.
The docs list `litellm_spend_metric` and `litellm_input_tokens_metric`;
the exposition, and therefore Scout, names them
`litellm_spend_metric_total` and `litellm_input_tokens_metric_total`.
Query the `_total` form. Gauges and histograms keep the documented names.

Labels are wide and high-cardinality by design. Most request-path series
carry `hashed_api_key`, `api_key_alias`, `team`, `team_alias`, `user`,
`user_email`, `end_user`, `org_id`, `org_alias`, `model`, `model_id`,
`requested_model`, `api_provider` and `service_tier`. The proxy counters
add `route`, `status_code`, `client_ip` and `user_agent`; the deployment
series add `api_base` and `litellm_model_name`. Every distinct caller,
end user or client IP is a new series, so a multi-tenant proxy grows
series with its caller population.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Scrape succeeded - the proxy metrics endpoint responded and accepted the key. Also reads 0 when the key is rejected with 401. |
| `litellm_proxy_total_requests_metric_total` | Requests through the proxy by `route`, `status_code`, `requested_model` and caller labels. Throughput and error rate. |
| `litellm_proxy_failed_requests_metric_total` | Failed proxy requests by `exception_status` and `exception_class`. The user-facing error rate. |
| `litellm_deployment_state` | Per-deployment health: 0 healthy, 1 partial outage, 2 complete outage. |
| `litellm_deployment_cooled_down_total` | Deployments put in cooldown after failures, by `exception_status`. Each increment removes capacity and turns later calls into 429s. |
| `litellm_request_total_latency_metric` | End-to-end proxy latency per request. The request SLO. |
| `litellm_llm_api_latency_metric` | Backend LLM call latency per request. Separates provider slowness from proxy overhead. |

`litellm_deployment_state` is an enum gauge, one series per deployment.
Failures split by `exception_status` and `exception_class`: a backend
404 appears as `exception_status="404"` with the provider's exception
class. When the router has no healthy deployment left it records
`exception_class="RouterRateLimitError"` with `exception_status="None"`,
and the proxy counter records `status_code="None"`, although the client
receives 429.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `litellm_deployment_success_responses_total` | Successful backend responses per deployment (`api_base`, `litellm_model_name`). |
| `litellm_deployment_failure_responses_total` | Failed backend responses per deployment by `exception_status`. Which provider is failing. |
| `litellm_deployment_total_requests_total` | Backend requests per deployment. Denominator for the per-deployment error rate. |
| `litellm_request_queue_time_seconds` | Time a request waits in the proxy before dispatch. Rising queue time is proxy or router capacity, not the provider. |
| `litellm_in_flight_requests` | Requests currently being processed by the proxy. Concurrency. |
| `litellm_input_tokens_metric_total` | Prompt tokens by model and caller. Cost driver. |
| `litellm_output_tokens_metric_total` | Completion tokens by model and caller. Cost driver. |
| `litellm_total_tokens_metric_total` | Input plus output tokens. |
| `litellm_spend_metric_total` | Spend in USD by model and caller. Zero until the model has a price. |
| `litellm_deployment_latency_per_output_token` | Backend latency per output token per deployment. Streaming throughput per provider. |
| `litellm_remaining_api_key_budget_metric` | Remaining budget on the calling key. `+Inf` with no budget set. |
| `litellm_remaining_api_key_requests_for_model` | Remaining RPM on the key for a model. Max int with no limit set. |
| `litellm_remaining_api_key_tokens_for_model` | Remaining TPM on the key for a model. Max int with no limit set. |
| `litellm_remaining_user_budget_metric` | Remaining budget on the calling user. `+Inf` with no budget set. |
| `process_resident_memory_bytes` | Proxy process RSS. |
| `process_cpu_seconds_total` | Proxy process CPU time. |

The latency histograms share one bucket layout from 5 ms to 600 s.
`litellm_llm_api_latency_metric` is the backend call,
`litellm_request_total_latency_metric` is the whole proxy round trip,
`litellm_request_queue_time_seconds` is the wait before dispatch, and
`litellm_deployment_latency_per_output_token` is backend latency divided
by output tokens per deployment. A gap between total and backend latency
is proxy overhead or queueing.

`litellm_spend_metric_total` reads 0 for models with no price. Models in
LiteLLM's cost map are priced automatically; self-hosted models need
`input_cost_per_token` and `output_cost_per_token` set on the deployment
before spend moves.

The budget and rate-limit gauges read `+Inf` or the max integer until a
budget or limit is configured on the key. They are present but carry
nothing until limits exist.

### Diagnostic - for investigation and tuning

Deprecated names, database-backed counts, and process internals.

| Group | Metrics | When you reach for it |
|---|---|---|
| Deprecated counters | `litellm_requests_metric_total`, `litellm_llm_api_failed_requests_metric_total` | Still emitted, marked deprecated in their HELP text. Superseded by `litellm_proxy_total_requests_metric_total` and `litellm_proxy_failed_requests_metric_total`; migrate dashboards that still query them. |
| Users and teams | `litellm_active_users`, `litellm_total_users`, `litellm_teams_count` | Users seen recently, users and teams in the database. 0 without a database. |
| Batch-cost poller | `litellm_check_batch_cost_jobs_polled`, `litellm_check_batch_cost_last_run_timestamp` | Batch-cost poller status. Only moves with the batches API. |
| Process | `process_open_fds`, `process_max_fds`, `process_virtual_memory_bytes`, `process_start_time_seconds` | File descriptors, virtual memory, start time. |
| Python | `python_gc_collections_total`, `python_gc_objects_collected_total`, `python_gc_objects_uncollectable_total`, `python_info` | Interpreter GC and version. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Prometheus receiver scrape health. |

LiteLLM registers most families lazily, so several appear only once the
feature behind them is in use: the team, org and provider budget gauges
and the `litellm_deployment_rpm_limit` and `litellm_deployment_tpm_limit`
gauges need a database, a team, an org or a configured budget; the
`litellm_cache_*` and cached-token counters need `cache` enabled;
`litellm_deployment_successful_fallbacks_total` and
`litellm_deployment_failed_fallbacks_total` need a `fallbacks` list in
the router config; `litellm_llm_api_time_to_first_token_metric` and the
reasoning, audio, image and video token counters need streaming or
non-text calls.

With more than one uvicorn worker, each worker holds its own registry
unless `PROMETHEUS_MULTIPROC_DIR` is set. Set it whenever `NUM_WORKERS`
is above 1, or the scrape sees one worker's counters at a time.

Full metric list: see the
[LiteLLM Prometheus reference](https://docs.litellm.ai/docs/proxy/prometheus),
or run
`curl -s -H "Authorization: Bearer $LITELLM_API_KEY" http://localhost:4000/metrics/`
against your proxy.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
Absolute latency numbers depend on the providers behind the proxy, the
models, and prompt shape, so the latency rows are relative to your own
baseline. Tune to your workload; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `up` | - | `== 0` for > 1m | The metrics endpoint stopped responding, or the scrape key was revoked (401 also reads as `up` 0); check the container and the key. |
| `rate(litellm_proxy_failed_requests_metric_total) / rate(litellm_proxy_total_requests_metric_total)` | Above baseline | Sustained rise | Split by `exception_class`: provider errors versus `RouterRateLimitError` (no healthy deployment left). |
| `litellm_deployment_state` | - | `== 2` for > 1m | A deployment is fully failing; check `api_base` and the provider's status. |
| `increase(litellm_deployment_cooled_down_total[5m])` | - | `> 0` | The router pulled a deployment; capacity dropped and callers may see 429. Correlate with `litellm_deployment_failure_responses_total` by `exception_status`. |
| `rate(litellm_deployment_failure_responses_total) / rate(litellm_deployment_total_requests_total)` by `api_base` | Above baseline | Sustained rise | One provider degrading before the cooldown trips; fail over or pull it from the router. |
| `litellm_request_total_latency_metric` (p99) | Rising vs baseline | Sustained rise | Compare with `litellm_llm_api_latency_metric`; a gap is proxy overhead or queueing. |
| `litellm_llm_api_latency_metric` (p99) | Rising vs baseline | Sustained rise | The provider is slow; check `litellm_deployment_latency_per_output_token` by `api_base`. |
| `litellm_request_queue_time_seconds` (p99) | Rising vs baseline | `litellm_in_flight_requests` at a plateau | Proxy capacity; add workers or replicas. |
| `litellm_remaining_api_key_budget_metric` | `< 10%` of the configured budget | - | Requests reject at zero; raise the budget or rotate keys. Needs a budget configured. |
| `litellm_remaining_api_key_requests_for_model`, `litellm_remaining_api_key_tokens_for_model` | Near 0 | - | Callers are about to get 429 from the proxy's own limiter. Needs a limit configured. |
| `rate(litellm_spend_metric_total)` by `model` or `team` | Above baseline | Sustained rise | Runaway usage. Needs model prices configured, otherwise the series is always 0. |

The latency rows are Prometheus histograms - there is no ready-made `p99`
series to threshold. Compute the percentile from the buckets in your alert
rule, for example
`histogram_quantile(0.99, rate(litellm_request_total_latency_metric_bucket[5m]))`.

## Access Setup

The proxy exposes `/metrics/` on the API port once the `prometheus`
callback is in the proxy config, and it answers with the same key check
as the API. Access setup is the proxy config, the master key, and a key
for the Collector.

The proxy config declares the deployments it routes to and turns the
callback on. The example points at an OpenAI-compatible backend such as
a [vLLM](./vllm.md) server:

```yaml showLineNumbers title="config/litellm.yaml"
model_list:
  - model_name: your-model              # the name callers request
    litellm_params:
      model: openai/your-org/your-model # openai/<model> for an OpenAI-compatible backend
      api_base: http://vllm:8000/v1     # the backend's base URL
      api_key: none
      # Self-hosted models have no entry in LiteLLM's cost map; set prices
      # or litellm_spend_metric_total stays 0
      input_cost_per_token: 0.0000001
      output_cost_per_token: 0.0000002

litellm_settings:
  callbacks: ["prometheus"]
```

`LITELLM_MASTER_KEY` sets the proxy's master key. Any valid proxy key
scrapes `/metrics/`; the master key works, and a dedicated key issued
for the Collector keeps the scrape credential separate from caller keys.

**Docker setup** - the image `ghcr.io/berriai/litellm:main-stable`. The
image ships no `curl`, so a container healthcheck uses `python3` with
`urllib` against `/health/liveliness`, which needs no key:

```yaml showLineNumbers title="compose.yaml (excerpt)"
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    environment:
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
    volumes:
      - ./config/litellm.yaml:/app/config.yaml:ro
    ports:
      - "4000:4000"
    healthcheck:
      test: ["CMD-SHELL", "python3 -c \"import urllib.request; urllib.request.urlopen('http://localhost:4000/health/liveliness')\" || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 30s
```

The key check on `/metrics/` can be switched off in the proxy config
with `litellm_settings.require_auth_for_metrics_endpoint: false`. The
endpoint then serves caller labels, hashed keys and client IPs to anyone
who can reach port `4000`; keep the key check on and scrape with a key
unless the port is confined to a private network.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# The proxy lists the configured models once it is up
curl -s -H "Authorization: Bearer $LITELLM_API_KEY" http://localhost:4000/v1/models

# Verify the metrics endpoint accepts the key
curl -s -H "Authorization: Bearer $LITELLM_API_KEY" http://localhost:4000/metrics/ | grep litellm_proxy_total_requests_metric_total
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: litellm
          scrape_interval: 10s
          # The proxy answers 307 on /metrics; scrape the final path
          metrics_path: /metrics/
          # /metrics needs a proxy API key on LiteLLM 1.85+
          authorization:
            type: Bearer
            credentials: ${env:LITELLM_API_KEY}
          static_configs:
            - targets:
                # host:port the proxy's API is reachable on
                - ${env:LITELLM_HOST}:${env:LITELLM_PORT}

processors:
  resource:
    attributes:
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

The Prometheus receiver keeps everything `/metrics/` exposes. There is no
per-metric enable list; families that LiteLLM registers lazily appear
with no Collector change once the feature behind them is in use. Scout
authentication for the `otlphttp/b14` exporter is covered in
[Scout Exporter](../collector-setup/scout-exporter.md).

### Environment Variables

```bash showLineNumbers title=".env"
LITELLM_HOST=localhost
LITELLM_PORT=4000
LITELLM_API_KEY=sk-your-collector-key
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Scoping labels

The proxy counters carry `client_ip` and `user_agent`, and each distinct
value is its own series. If dashboards and alerts group by model, team
and key rather than by client, a `labeldrop` on the scrape job scopes the
series to the labels in use:

```yaml showLineNumbers title="config/otel-collector.yaml (label scoping)"
          metric_relabel_configs:
            - regex: "client_ip|user_agent"
              action: labeldrop
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped LiteLLM metrics
docker logs otel-collector 2>&1 | grep "litellm_"

# Check deployment health directly on the metrics endpoint
curl -s -H "Authorization: Bearer $LITELLM_API_KEY" http://localhost:4000/metrics/ | grep '^litellm_deployment_state'

# Generate traffic so the request counters and histograms advance
curl -s http://localhost:4000/v1/completions \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model": "your-model", "prompt": "Hello", "max_tokens": 32}'

# Confirm the request was counted
curl -s -H "Authorization: Bearer $LITELLM_API_KEY" http://localhost:4000/metrics/ | grep '^litellm_proxy_total_requests_metric_total'
```

In Scout, query `litellm_proxy_total_requests_metric_total` by
`requested_model` and `status_code` to confirm the series arrived with
the `_total` suffix intact, and `litellm_deployment_state` by `api_base`
to see each deployment.

## Troubleshooting

### Scrape returns 401

**Cause**: The key is missing from the scrape config or the proxy
rejected it. On LiteLLM 1.85+ `/metrics/` runs the same key check as the
API.

**Look at**: `up` reads 0 for the `litellm` job while the container is
running, and the Collector log reports a 401 on the scrape.
`scrape_samples_scraped` (Diagnostic) reads 0.

**Fix**:

1. Set `authorization.type: Bearer` and `credentials` on the scrape job.
2. Confirm the key is valid; this returns 200:

   ```bash
   curl -s -o /dev/null -w '%{http_code}' \
     -H "Authorization: Bearer $LITELLM_API_KEY" \
     http://localhost:4000/metrics/
   ```

3. If the key was rotated or a key with a budget hit zero, issue a
   dedicated key for the Collector.

### Scrape follows a redirect or returns 307

**Cause**: The scrape targets `/metrics`, and the proxy answers 307 to
`/metrics/`. The receiver's default `metrics_path` is `/metrics`, and it
follows redirects unless `follow_redirects: false` is set on the job.

**Look at**: the Collector log for a 307 or a redirect error on the
`litellm` job; with redirects disabled, `up` reads 0.

**Fix**:

1. Set `metrics_path: /metrics/` on the scrape job, with the trailing
   slash, so each scrape is one request.

### Dashboard queries find no `litellm_spend_metric`

**Cause**: The query uses the name from the LiteLLM documentation. The
exposition, and Scout, carry the counter as
`litellm_spend_metric_total`.

**Fix**:

1. Query the `_total` form for every counter:
   `litellm_spend_metric_total`, `litellm_input_tokens_metric_total`,
   `litellm_proxy_total_requests_metric_total`.
2. Gauges and histograms keep the documented names:
   `litellm_deployment_state`, `litellm_request_total_latency_metric`.

### Spend stays 0 while tokens advance

**Cause**: The model has no price. LiteLLM computes spend from its cost
map, and self-hosted or custom models are not in it.

**Look at**: `litellm_input_tokens_metric_total` and
`litellm_output_tokens_metric_total` advancing while
`litellm_spend_metric_total` stays at 0 for the same `model`.

**Fix**:

1. Set `input_cost_per_token` and `output_cost_per_token` in the
   deployment's `litellm_params`.
2. Restart the proxy; spend accrues from the next request.

### Callers get 429 while backends look healthy

**Cause**: The router put a deployment in cooldown after failures and
has no healthy deployment left for the requested model. The 429 comes
from the router, not the provider.

**Look at**: `litellm_deployment_cooled_down_total` incrementing and
`litellm_deployment_state` reading 2 for the deployment.
`litellm_proxy_failed_requests_metric_total` splits the picture by
`exception_status`: the provider's original failures carry their HTTP
status, and the router's rejections carry
`exception_class="RouterRateLimitError"` with `exception_status="None"`.

**Fix**:

1. Read `litellm_deployment_failure_responses_total` by `api_base` and
   `exception_status` to find the failure that tripped the cooldown.
2. Fix the backend or its `api_base`, or add a second deployment for the
   model so the router has capacity during a cooldown.

### Counters reset or look partial with several workers

**Cause**: `NUM_WORKERS` is above 1 and each uvicorn worker holds its own
registry. Each scrape lands on one worker and reports only its counters.

**Look at**: `litellm_proxy_total_requests_metric_total` can move
backwards between scrapes, and `litellm_in_flight_requests` can flap
between values that do not add up to the observed concurrency.

**Fix**:

1. Set `PROMETHEUS_MULTIPROC_DIR` to a writable directory in the proxy's
   environment so the workers share one registry.
2. Or run one worker per replica and scale replicas.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.
4. Query the counter with its `_total` suffix.

## FAQ

### Why do the counters end in `_total` when the LiteLLM docs do not show it?

The proxy exposes counters under the Prometheus convention, which appends
`_total` to counter names. The LiteLLM documentation lists the registered
name without the suffix. The Prometheus receiver passes the exposition
name through, so Scout stores `litellm_spend_metric_total`. Gauges and
histograms are not suffixed and match the docs.

### Does the proxy need a database for these metrics?

No. The request, deployment, latency, token and spend metrics work
without one. The team, org and user budget families and the user and
team counts (`litellm_total_users`, `litellm_teams_count`,
`litellm_active_users`) need the database; without it they read 0 or
stay absent.

### Does this cover LiteLLM's own OpenTelemetry callback?

No. `callbacks: ["otel"]` exports traces from the proxy over OTLP. It is a
separate configuration from the `prometheus` callback. This guide covers
the metrics surface only.

### Does this work with LiteLLM running in Kubernetes?

Yes. Set `targets` to the proxy service DNS (for example
`litellm.default.svc.cluster.local:4000`), and put the Collector's key in
a Secret exposed to the Collector as `LITELLM_API_KEY`. The Collector runs
as a sidecar in the proxy pod or as a Deployment scraping the service;
see [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on LiteLLM metrics.
- [vLLM Monitoring](./vllm.md) - Self-hosted model server LiteLLM routes
  to; pair both for the gateway-to-backend view.
- [LLM Observability](../../guides/ai-observability/llm-observability.md) -
  Application-side tracing of LLM calls, token usage and cost.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [vLLM](./vllm.md), [Redis](./redis.md), and other components.
- **Fine-tune Collection**: Use the `model`, `team` and `api_base` labels
  to split dashboards per model, per team and per provider, and set
  prices on self-hosted deployments so spend reads alongside tokens.
