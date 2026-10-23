---
title: >
  Apache APISIX OpenTelemetry Monitoring - Route Status, Upstream Health,
  and AI Token Metrics
sidebar_label: Apache APISIX
id: collecting-apisix-telemetry
sidebar_position: 79
description: >
  Collect Apache APISIX metrics with the OpenTelemetry Collector. Monitor
  per-route status and latency, upstream health, etcd and AI token usage in
  base14 Scout.
keywords:
  - apisix opentelemetry
  - apisix otel collector
  - apisix metrics monitoring
  - opentelemetry prometheus receiver apisix
  - apisix observability
  - apisix telemetry collection
  - api gateway monitoring
  - apisix ai gateway token monitoring
---

# Apache APISIX

Apache APISIX exposes metrics through its bundled `prometheus` plugin, on
port `9091` at `/apisix/prometheus/metrics`, in Prometheus text format.
The OpenTelemetry Collector's `prometheus` receiver scrapes that endpoint
and ships the metrics to base14 Scout.

APISIX reports:

- Status codes and latency per route, with latency split into request,
  upstream and gateway time.
- The rate-limit rejections it produces itself.
- Upstream health checks.
- Whether its etcd config store is reachable.
- Model tokens and model latency, on routes that use the `ai-proxy`
  plugin.

To collect them, you open the export address, turn the plugin on for your
routes, and point the Collector at each APISIX node.

## Prerequisites

| Requirement             | Minimum                   | Recommended |
| ----------------------- | ------------------------- | ----------- |
| Apache APISIX           | 3.14.0 for the AI metrics | 3.19.0      |
| etcd (traditional mode) | -                         | 3.7.2       |
| OTel Collector Contrib  | 0.90.0                    | 0.162.0     |
| base14 Scout            | Any                       | -           |

APISIX 3.14.0 added the `ai-proxy` latency and token metrics. The gateway
metrics predate 3.x.

Before starting:

- APISIX must be running. The `prometheus` plugin is enabled at the node
  level by default.
- Port `9091` must be reachable from the Collector.
- Admin API access, to create a global rule or update routes.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Upgrading?
APISIX 3.18.0 added a `type` label to `apisix_llm_latency`, so queries
written before 3.18 must select `type="total"`. APISIX 3.19.0 labels
successful WebSocket upgrades `request_type="websocket"` instead of
`traditional_http`. Full notes: [Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

Know these before you read the tables:

- The receiver emits `up = 1` when port `9091` answers, plus four
  `scrape_*` series. There is no metrics enable list; the receiver keeps
  everything the endpoint serves.
- Node-level families (`apisix_etcd_*`, `apisix_node_info`,
  `apisix_nginx_*`, `apisix_shared_dict_*`, `apisix_http_requests_total`)
  exist whether or not routes carry the plugin. `apisix_http_status`,
  `apisix_http_latency`, `apisix_bandwidth` and `apisix_llm_*` appear for a
  route only when the plugin runs on it.
- `apisix_http_requests_total` is a gauge despite the `_total` name. It
  counts client requests since start, so use `rate()` on it as you would
  on a counter.
- `request_type` is `traditional_http` for proxied HTTP and `ai_chat` for
  requests through `ai-proxy`.
- `response_source` is `apisix` for a response the gateway produced, such
  as a 429 from `limit-count`, with `node` empty. It is `upstream`
  otherwise.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | The exporter answers. 0 means APISIX is down or the exporter is bound to `127.0.0.1`. |
| `apisix_http_status` | Requests by `route`, `code` and `response_source`. The 5xx and 429 rates per route. |
| `apisix_etcd_reachable` | 1 while etcd answers. 0 means route changes are not applied. |
| `apisix_upstream_status` | 1 for a healthy upstream node, 0 for one that failed its health check. |

`apisix_upstream_status` exists only for upstreams with active health
checks. It emits one series per node address form, one for the resolved IP
and one for the hostname, and both read 0 for a dead node. Group by `name`
so one dead node counts once.

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Latency | `apisix_http_latency` by `type` (`request`, `upstream`, `apisix`) | Total, upstream and gateway-internal latency per route, in ms. |
| Bandwidth | `apisix_bandwidth` by `type` (`ingress`, `egress`) | Bytes per route and direction. |
| Concurrency | `apisix_nginx_http_current_connections{state="active"}` | Active client connections. |
| Token spend | `apisix_llm_prompt_tokens`, `apisix_llm_completion_tokens` | Tokens per route and model. |
| Model latency | `apisix_llm_latency` | Model call latency in ms. |
| In-flight model calls | `apisix_llm_active_connections` | LLM requests in progress. |
| Config churn | `apisix_etcd_modify_indexes` by `key` | Config version counters for routes, services, upstreams, consumers and the rest. |
| Dictionaries | `apisix_shared_dict_free_space_bytes` for `prometheus-metrics` and `plugin-limit-count` | Free space in the dictionaries that hold metric series and rate-limit counters. A full dictionary drops metrics or counters. |

A rejected request has `request` and `apisix` latency samples but no
`upstream` sample. On a rate-limited route the `upstream` latency count is
lower than the `request` count and lower than `apisix_http_status`.
Filter on `response_source` to separate gateway rejections from upstream
responses.

The `apisix_llm_*` token and latency families label routes with
`route_id` and `service_id`. `apisix_http_*`, `apisix_bandwidth` and
`apisix_llm_active_connections` use `route` and `service`. Join on the
right label when you put HTTP and model panels side by side.

### Diagnostic - for investigation and tuning

| Group | Metrics | When you reach for it |
|---|---|---|
| Request total | `apisix_http_requests_total` | Node-wide client requests, without route labels. Typed gauge. |
| Connection states | `apisix_nginx_http_current_connections` (`accepted`, `handled`, `reading`, `waiting`, `writing`) | Connection lifecycle. `accepted` and `handled` are cumulative. |
| Metrics library | `apisix_nginx_metric_errors_total` | Errors inside the metrics library itself. |
| Inventory | `apisix_node_info` (`hostname`, `version`) | Which APISIX version each node runs. Always 1. |
| Dictionary capacity | `apisix_shared_dict_capacity_bytes`, free space for the other dictionaries | Sizing for every shared dictionary, including `upstream-healthcheck`. |
| Token distributions | `apisix_llm_prompt_tokens_dist`, `apisix_llm_completion_tokens_dist` | Per-request token histograms. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Receiver-side scrape health. |

`apisix_llm_latency{type="ttft"}` appears only for streaming requests.
The `consumer` and `service` labels stay empty until consumers and
services are defined.

Full metric and label reference: the
[APISIX prometheus plugin docs](https://apisix.apache.org/docs/apisix/plugins/prometheus/).

## Key Alerts to Configure

These rules use Core and Operational series. The relative rows compare
against a trailing baseline of the same series. Tune them to your
workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for one interval | APISIX is down or the exporter is bound to `127.0.0.1`. Check the process and `export_addr.ip`. |
| `rate(apisix_http_status{code=~"5.."}[5m]) / rate(apisix_http_status[5m])` by `route` | Above the trailing baseline | An upstream is failing. Check `response_source` and `apisix_upstream_status` for the route. |
| `rate(apisix_http_status{code="429"}[5m])` by `route` | Set from your rate-limit policy | Clients are hitting the rate limit. Confirm `response_source="apisix"` and review the limit. |
| `apisix_etcd_reachable` | `== 0` | Config changes are not applied. Check etcd health and the `deployment.etcd` hosts. |
| `apisix_upstream_status` by `name` | `== 0` | A node is unhealthy. Group by `name` so the IP and hostname series count once. |
| `histogram_quantile(0.95, rate(apisix_http_latency_bucket{type="upstream"}[5m]))` by `route` | Above the trailing baseline | An upstream is slowing. Compare with `type="apisix"` to rule out the gateway. |
| `apisix_shared_dict_free_space_bytes{name="prometheus-metrics"} / apisix_shared_dict_capacity_bytes{name="prometheus-metrics"}` | `< 0.1` | The metrics dictionary is nearly full and series will be dropped. Raise its size or cut label cardinality. |
| `rate(apisix_llm_completion_tokens[1h])` by `llm_model` | Set from your model budget | Token spend is rising. Check which route and consumer drive it. |

## Access Setup

### Open the export address

The exporter listens on `127.0.0.1:9091` by default, so a Collector in
another container, pod or host gets connection refused and `up` reads 0.
In `conf/config.yaml`, bind it to an address the Collector can reach,
then reload APISIX:

```yaml showLineNumbers title="conf/config.yaml"
plugin_attr:
  prometheus:
    export_addr:
      ip: 0.0.0.0
      port: 9091
```

On Kubernetes with the Apache APISIX Helm chart, set
`apisix.prometheus.enabled=true`. The chart binds the exporter to
`0.0.0.0` and exposes `apisix.prometheus.containerPort` (`9091`) on the
pod.

Port `9091` serves metrics without authentication. Keep it on an internal
network and restrict it to the Collector with firewall rules or a network
policy.

### Turn on the plugin for your routes

Per-route series appear only when the `prometheus` plugin runs on the
route. Use a global rule to turn it on for every route:

```bash showLineNumbers title="Enable the plugin for all routes"
curl -s -X PUT "http://${APISIX_ADMIN_HOST}:9180/apisix/admin/global_rules/prometheus" \
  -H "X-API-KEY: ${APISIX_ADMIN_KEY}" \
  -d '{"plugins": {"prometheus": {"prefer_name": true}}}'
```

`prefer_name: true` labels series with route and service names instead of
their IDs, which makes dashboards and alerts readable. Leave it `false` if
your route names are not unique.

To instrument only some routes, add the plugin to each of them instead:

```json showLineNumbers title="Route with the plugin"
{
  "uri": "/orders/*",
  "name": "orders",
  "plugins": {
    "prometheus": { "prefer_name": true }
  },
  "upstream": {
    "type": "roundrobin",
    "nodes": { "orders.internal:8080": 1 }
  }
}
```

In standalone mode, put the same plugin entries in `apisix.yaml`.

### Turn on upstream health metrics

`apisix_upstream_status` needs active health checks. Add a
`checks.active` block to each upstream you want health series for:

```json showLineNumbers title="Upstream with active health checks"
{
  "type": "roundrobin",
  "nodes": { "orders.internal:8080": 1 },
  "checks": {
    "active": {
      "type": "http",
      "http_path": "/healthz",
      "healthy": { "interval": 5, "successes": 1 },
      "unhealthy": { "interval": 5, "http_failures": 2, "tcp_failures": 2 }
    }
  }
}
```

Check the endpoint from the Collector's host:

```bash showLineNumbers title="Verify access"
curl -s "http://${APISIX_HOST}:9091/apisix/prometheus/metrics" | grep apisix_etcd_reachable
```

## Configuration

Add a `prometheus` receiver that scrapes each APISIX node:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: apisix
          scrape_interval: 15s
          # The plugin does not serve the receiver default /metrics
          metrics_path: /apisix/prometheus/metrics
          static_configs:
            - targets:
                - ${env:APISIX_HOST}:9091

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
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
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

The exporter name is `otlp_http` from OTel Collector Contrib 0.144.0 on;
earlier releases use the older spelling without the underscore.

Scrape every APISIX node directly, not a load-balanced service, so each
node's series stay separate. List each node under `targets`, or on
Kubernetes discover the pods:

```yaml showLineNumbers title="config/otel-collector.yaml (Kubernetes pods)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: apisix
          scrape_interval: 15s
          metrics_path: /apisix/prometheus/metrics
          kubernetes_sd_configs:
            - role: pod
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
              regex: apisix
              action: keep
            - source_labels: [__meta_kubernetes_pod_container_port_number]
              regex: "9091"
              action: keep
```

The Collector's service account needs `get`, `list` and `watch` on pods.
See [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

### Controlling cardinality

Series grow with routes, consumers, upstream nodes and models. When they
outgrow the `prometheus-metrics` shared dictionary, new series are
dropped. Three settings control this:

- **Disable labels you do not query** (APISIX 3.18.0 and later). Label
  values listed in the plugin metadata collapse to an empty string. The
  `node` label churns on autoscaled upstreams and is the usual first
  candidate:

  ```bash showLineNumbers title="Collapse high-churn labels"
  curl -s -X PUT "http://${APISIX_ADMIN_HOST}:9180/apisix/admin/plugin_metadata/prometheus" \
    -H "X-API-KEY: ${APISIX_ADMIN_KEY}" \
    -d '{"disabled_labels": {"http_status": ["node"], "http_latency": ["node"], "bandwidth": ["node"]}}'
  ```

  The structural labels (`code` on `http_status`, `type` on the latency and
  bandwidth families) cannot be disabled.

- **Expire idle series.** `plugin_attr.prometheus.metrics.<family>.expire`
  removes series that have not been updated for that many seconds. The
  default, `0`, keeps them forever.

- **Size the dictionary.** From APISIX 3.18.0 the `prometheus-metrics`
  dictionary defaults to 128m. Raise it under `nginx_config` when the alert
  on its free space fires:

  ```yaml showLineNumbers title="conf/config.yaml"
  nginx_config:
    http:
      lua_shared_dict:
        prometheus-metrics: 256m
  ```

### Environment Variables

```bash showLineNumbers title=".env"
APISIX_HOST=apisix.internal
APISIX_ADMIN_HOST=apisix.internal
APISIX_ADMIN_KEY=your_admin_key
ENVIRONMENT=your_environment
SERVICE_NAME=apisix
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Collecting AI metrics

The `ai-proxy` plugin forwards a route's requests to a model provider.
When the `prometheus` plugin also runs on that route, through the global
rule or on the route itself, APISIX emits model metrics. This route
forwards chat completions to an OpenAI-compatible endpoint:

```json showLineNumbers title="AI route"
{
  "uri": "/v1/chat/completions",
  "name": "chat",
  "plugins": {
    "prometheus": { "prefer_name": true },
    "ai-proxy": {
      "provider": "openai-compatible",
      "auth": { "header": { "Authorization": "Bearer <your-api-key>" } },
      "options": { "model": "your-model" },
      "override": { "endpoint": "https://models.internal/v1/chat/completions" }
    }
  }
}
```

Any OpenAI-compatible server works as the endpoint, including a local
Ollama server at `http://<ollama-host>:11434/v1/chat/completions`. Hosted
providers use their own `provider` value and API key.

The route emits:

- `apisix_llm_prompt_tokens` and `apisix_llm_completion_tokens` - token
  counters per route and model (Operational).
- `apisix_llm_latency` - model call latency. Non-streaming requests carry
  `type="total"` and `type="ai_chat"`; `type="ttft"` appears only on
  streaming requests (Operational).
- `apisix_llm_active_connections` - in-flight model calls (Operational).
- `apisix_llm_prompt_tokens_dist` and `apisix_llm_completion_tokens_dist` -
  per-request token histograms (Diagnostic).

`apisix_http_status` and `apisix_http_latency` on the same route carry
`request_type="ai_chat"`.

Token counters come from the provider's `usage` block. A provider that
omits `usage` leaves both counters and both distributions at 0.

With `options.model` set, the plugin sends every request to that model,
whatever the client asks for. `llm_model` carries the configured model,
so group model panels and the token-spend alert by `llm_model`. If you do
not need per-model breakdowns, add `request_llm_model` and `llm_model` to
`disabled_labels` for the LLM families.

## Verify the Setup

Start the Collector, send traffic through a route that runs the plugin,
and check the endpoint:

```bash showLineNumbers title="Verify metrics collection"
# Node-level series answer before any traffic
curl -s "http://${APISIX_HOST}:9091/apisix/prometheus/metrics" | grep apisix_node_info

# Per-route series appear after the first request on a route
curl -s -o /dev/null "http://${APISIX_HOST}:9080/orders/health"
curl -s "http://${APISIX_HOST}:9091/apisix/prometheus/metrics" | grep 'apisix_http_status{'

# Check the Collector for scrape or export errors
docker logs otel-collector 2>&1 | grep -iE "error|apisix"
```

In Scout, check that `up` for the `apisix` job reads 1, then query
`apisix_http_status` by `route`, `code` and `response_source`.

## Troubleshooting

### `up` reads 0 while APISIX serves traffic

**Cause**: `plugin_attr.prometheus.export_addr.ip` is at its default,
`127.0.0.1`, so the exporter answers only inside the APISIX container or
host.

**Look at**: `scrape_samples_scraped` (Diagnostic) reads 0 for the
`apisix` job, while requests on `9080` succeed.

**Fix**:

1. Set `export_addr.ip` to `0.0.0.0` or the pod address, as in
   [Open the export address](#open-the-export-address).
2. Reload APISIX.

### Scrape returns 404

**Cause**: The receiver's default `metrics_path` is `/metrics`. The plugin
serves `/apisix/prometheus/metrics`.

**Fix**: Set `metrics_path: /apisix/prometheus/metrics` on the scrape job.

### A route has no `apisix_http_status` series

**Cause**: The plugin does not run on the route. Node-level families
appear either way, which can make the scrape look complete.

**Look at**: `apisix_http_requests_total` (Diagnostic) rising while no
`apisix_http_status` series carries the route.

**Fix**: Create the global rule, or add `"prometheus": {}` to the route.
Series appear on the next request.

### Upstream latency counts are lower than request counts

**Cause**: The route rejects some requests itself, such as rate-limit
429s. A rejected request has `request` and `apisix` latency samples but no
`upstream` sample.

**Look at**: `apisix_http_status{response_source="apisix"}` for the
route. Rejected requests have `node` empty.

**Fix**: Compute upstream error rates and latency from
`response_source="upstream"` only.

### `apisix_upstream_status` is missing or shows two series per node

**Cause**: The series exists only for upstreams with active health checks,
and it emits one series for the resolved IP and one for the hostname.

**Fix**: Add a `checks.active` block to the upstream. Group by `name` in
dashboards and alerts so a node counts once.

### Route changes do not take effect

**Cause**: APISIX lost its connection to etcd and runs on the last config
it loaded.

**Look at**: `apisix_etcd_reachable` reads 0, and
`apisix_etcd_modify_indexes` stops moving after an Admin API change.

**Fix**: Check etcd health and the hosts under `deployment.etcd`. See
[etcd](./etcd.md) to monitor the store itself.

### Series disappear as traffic grows

**Cause**: The `prometheus-metrics` shared dictionary is full, so new
series are dropped.

**Look at**: `apisix_shared_dict_free_space_bytes` divided by
`apisix_shared_dict_capacity_bytes` for `prometheus-metrics`, and
`apisix_nginx_metric_errors_total`.

**Fix**: Disable high-churn labels, expire idle series or raise the
dictionary size, as in [Controlling cardinality](#controlling-cardinality).

### Token counters read 0 while model calls succeed

**Cause**: The provider's response omits the `usage` block.

**Look at**: `apisix_llm_latency` and
`apisix_http_status{request_type="ai_chat"}` moving while
`apisix_llm_prompt_tokens` stays at 0.

**Fix**: Check the provider's response for a `usage` object, or route to
an endpoint that returns it.

### Model latency panels mix latency types after an upgrade

**Cause**: From APISIX 3.18.0, `apisix_llm_latency` carries a `type`
label, and a query without it combines every type.

**Fix**: Select `type="total"`. See [Updates & Upgrades](#updates--upgrades).

## Updates & Upgrades

### APISIX version changes

- **3.18.0**: `apisix_llm_latency` gained a `type` label, and streaming
  requests emit `type="total"` and `type="ttft"`. Update queries,
  dashboards and alerts written before 3.18 to select `type="total"`
  (PR #13487). The release also added the `apisix_llm_prompt_tokens_dist`
  and `apisix_llm_completion_tokens_dist` histograms, raised the default
  `prometheus-metrics` dictionary to 128m, and added label disabling
  through plugin metadata (PR #13202).
- **3.19.0**: successful WebSocket upgrades are labelled
  `request_type="websocket"` instead of `traditional_http` in
  `apisix_http_status`, `apisix_http_latency` and `apisix_bandwidth`.
  Update selectors that filter on `request_type="traditional_http"` if
  they should include WebSocket traffic (PR #13909).

## FAQ

### Does this work in standalone mode?

Yes, without the etcd families. Standalone mode (`deployment.role:
data_plane` with the `yaml` config provider) has no Admin API and no etcd,
so `apisix_etcd_*` are absent and the Core `apisix_etcd_reachable` row does
not apply. Put the plugin on routes in `apisix.yaml`.

### Why is `apisix_http_requests_total` a gauge?

APISIX types it as a gauge despite the `_total` name. It counts client
requests since the node started, so take a rate over it as over a counter.
For per-route request rates use `apisix_http_status`.

### How do I tell gateway 429s from upstream 429s?

Filter on `response_source`. A response the gateway produced, such as a
`limit-count` rejection, carries `response_source="apisix"` and an empty
`node`. A status returned by the upstream carries
`response_source="upstream"`.

### Can I serve metrics on the main listener instead of 9091?

Yes. Set `plugin_attr.prometheus.enable_export_server: false` and create a
route with the `public-api` plugin on the metrics URI. The endpoint is
then reachable on the public listener, so protect it with an
authentication plugin. See the
[APISIX prometheus plugin docs](https://apisix.apache.org/docs/apisix/plugins/prometheus/).

### How do I monitor multiple APISIX nodes?

Scrape each node directly. Each node is identified by its `instance`
label and by `hostname` on `apisix_node_info`.

## Related Guides

- [Traefik Monitoring](./traefik.md) - Edge router with per-router
  metrics.
- [NGINX Monitoring](./nginx.md) - The web server APISIX is built on.
- [LiteLLM Gateway Monitoring](./litellm.md) - AI gateway in front of
  model providers.
- [Bifrost Monitoring](./bifrost.md) - AI gateway with provider latency
  and token metrics.
- [etcd Monitoring](./etcd.md) - The config store APISIX uses in
  traditional mode.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on APISIX metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for [etcd](./etcd.md),
  [NGINX](./nginx.md), and the model servers behind your AI routes.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic
  and collapse labels you do not query.
