---
title: >
  Tyk Gateway OpenTelemetry Monitoring - Request Outcomes, Latency, and
  Traces
sidebar_label: Tyk Gateway
id: collecting-tyk-telemetry
sidebar_position: 80
description: >
  Collect Tyk Gateway metrics and traces over OTLP with the OpenTelemetry
  Collector. Monitor per-API outcomes, response flags and latency in
  base14 Scout.
keywords:
  - tyk opentelemetry
  - tyk otel collector
  - tyk metrics monitoring
  - opentelemetry otlp receiver tyk
  - tyk observability
  - tyk telemetry collection
  - api gateway monitoring
  - tyk gateway tracing
---

# Tyk Gateway

Tyk Gateway sends metrics and traces over OTLP to the OpenTelemetry
Collector's `otlp` receiver. There is no Prometheus endpoint
to scrape. The Collector forwards both signals to base14 Scout.

The gateway reports:

- Request outcomes per API, with a response flag that says why each
  request ended.
- Latency split into end-to-end, gateway and upstream time.
- Loaded APIs and policies, and config reloads.
- Go runtime metrics.
- A server span per request, and a client span for the upstream call
  when the request reaches the upstream.

To collect them, you turn on metrics and traces in the gateway config,
point them at the Collector, and add an `otlp` receiver to the Collector.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Tyk Gateway (metrics)  | 5.13.0  | 5.15.1      |
| Tyk Gateway (traces)   | 5.2.0   | 5.15.1      |
| Redis                  | -       | 8.2.2       |
| OTel Collector Contrib | 0.90.0  | 0.163.2     |
| base14 Scout           | Any     | -           |

OTLP metrics arrived in Tyk Gateway 5.13.0 and OTLP traces in 5.2.0.

Before starting:

- Tyk Gateway must be running with Redis.
- The gateway must reach the Collector on port 4317 (OTLP gRPC) or 4318
  (OTLP HTTP).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review. Durations are histograms in seconds.

The gateway pushes, so there is no `up` series. To check liveness, alert
when `tyk.api.requests.total` or `tyk.gateway.apis.loaded` stops arriving.
`tyk.gateway.apis.loaded` also shows how many APIs the gateway has
loaded.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `tyk.api.requests.total` | Requests per API (`tyk.api.id`), method and status. The source for the 5xx, 429, 401 and 403 rates. |
| `tyk.gateway.apis.loaded` | The gateway is exporting and has its APIs. A drop means definitions failed to load. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Latency | `http.server.request.duration` | End-to-end latency per API and `tyk.response_flag`. |
| Latency | `tyk.upstream.request.duration` | Upstream latency. Filter to `tyk.response_flag="200"` or other success codes. |
| Latency | `tyk.gateway.request.duration` | Time spent in the gateway. Exclude `URT`. |
| Config state | `tyk.gateway.policies.loaded` | Policies in effect. |
| Config state | `tyk.gateway.config.reload`, `tyk.gateway.config.reload.duration` | Reload count and duration. |
| Process pressure | `go.memory.used`, `go.goroutine.count` | Gateway process pressure. `go.memory.used` splits by `go.memory.type` (`stack`, `other`). |

### Diagnostic - for investigation and tuning

| Group | Metrics | When you reach for it |
|---|---|---|
| Node total | `tyk.http.requests` | All requests the gateway processed, with no attributes. It equals the sum of `tyk.api.requests.total` across APIs. |
| Go runtime | `go.memory.allocated`, `go.memory.allocations`, `go.memory.gc.goal`, `go.processor.limit`, `go.config.gogc` | Allocation churn, GC target and runtime limits. |

The gateway sets these resource attributes on every export:
`service.name`, `service.version`, `service.instance.id`, `tyk.gw.id`,
`tyk.gw.dataplane`, `host.name` and the `process.*` set.

### Response flags

`tyk.response_flag` says why a request ended. It is on the three latency
histograms, not on the default `tyk.api.requests.total`. When the gateway
classifies an error, the flag holds that classification. Otherwise it
holds the status code, so a proxied success reads `200`.

The flags you will see most often, grouped by what to do about them:

| Cause | Flag | Status | What to do |
| --- | --- | --- | --- |
| Upstream cannot be reached | `UCF` | 500 | Check the upstream and the API's `target_url`. Tyk returns 500 here, not 502. |
| Upstream too slow | `URT` | 504 | Check upstream latency and the API's timeout. |
| Client over its rate limit | `RLT` | 429 | Review the limit or the client. |
| Client out of quota | `QEX` | 403 | Review the policy quota and the consumer's usage. |
| Invalid key | `AKI` | 403 | Find the consumer presenting the key. |
| Missing key | `AMF` | 401 | Check the client sends the auth header. |

An invalid key and an exhausted quota both return 403, so split 403 by
`tyk.response_flag`. Tyk also classifies TLS, DNS, connection reset,
circuit breaker and request validation failures. The full list is in
the Tyk source,
[`internal/errors/classification.go`](https://github.com/TykTechnologies/tyk/blob/master/internal/errors/classification.go).

### Reading the latency histograms

Two things to know before you build latency panels:

- Requests that never reach the upstream (`RLT`, `AMF`, `AKI`, `QEX`,
  `UCF`) record a 0 sample in `tyk.upstream.request.duration`. Unfiltered
  upstream percentiles are pulled toward 0 on rate-limited, rejected or
  failing APIs. Filter upstream percentiles to `tyk.response_flag="200"`.
- A timeout (`URT`) is counted as gateway time.
  `tyk.gateway.request.duration` and `http.server.request.duration` carry
  the full timeout, while `tyk.upstream.request.duration` records 0. Keep
  `URT` out of gateway latency and alert on the `URT` flag instead.

## Key Alerts to Configure

Thresholds are relative to a trailing baseline per API. They are starting
points; tune them to your traffic. There is no `up` series, so the first
row is an absent-data alert.

| Metric | Condition | Why it matters |
|---|---|---|
| No `tyk.api.requests.total` or `tyk.gateway.apis.loaded` data from a gateway | Absent for two export intervals | The gateway is down or cannot reach the Collector. Check the gateway process and its OTLP endpoint. |
| `tyk.gateway.apis.loaded` | Below its previous value | API definitions failed to load after a reload. Check the gateway logs for the failing definition. |
| `rate(tyk.api.requests.total{http.response.status_code=~"5.."}[5m]) / rate(tyk.api.requests.total[5m])` by `tyk.api.id` | Above the trailing baseline | An upstream is failing. Split by `tyk.response_flag` on the latency histograms to find the cause. |
| `rate(tyk.api.requests.total{http.response.status_code="429"}[5m])` by `tyk.api.id` | Set from your rate-limit policy | Clients are hitting the rate limit. Raise the limit or contact the consumer. |
| Rate of `http.server.request.duration` samples with `tyk.response_flag="UCF"` or `"URT"`, by `tyk.api.id` | Above 0 for 5m | The gateway cannot connect to an upstream, or it times out. Check the upstream and its timeout. |
| Rate of `http.server.request.duration` samples with `tyk.response_flag="QEX"` or `"AKI"`, by `tyk.api.id` | Set from your quota policy | Consumers are out of quota or presenting bad keys. Check the policy quota and the key in use. |
| p95 of `tyk.upstream.request.duration` with `tyk.response_flag="200"`, by `tyk.api.id` | Above the trailing baseline | An upstream is slowing. Investigate the upstream service. |
| p95 of `tyk.gateway.request.duration` excluding `URT` | Above the trailing baseline | The gateway itself is slowing. Check `go.memory.used` and `go.goroutine.count`. |

## Access Setup

Traces and metrics each have their own `enabled` setting. Turning on
tracing does not turn on metrics. The metrics exporter, endpoint, headers,
TLS and resource name follow the trace settings unless you set them under
`metrics`, so one Collector address covers both.

### Turn on traces and metrics in `tyk.conf`

```json showLineNumbers title="tyk.conf (excerpt)"
{
  "opentelemetry": {
    "traces": {
      "enabled": true,
      "exporter": "grpc",
      "endpoint": "otel-collector:4317",
      "sampling": {
        "type": "TraceIDRatioBased",
        "rate": 0.1,
        "parent_based": true
      }
    },
    "metrics": {
      "enabled": true,
      "export_interval": 15
    }
  }
}
```

- `exporter` is `grpc` (port 4317) or `http` (port 4318).
- `export_interval` is in seconds. The default is 60.
- `sampling.type` defaults to `AlwaysOn`, which traces every request. On
  busy gateways use `TraceIDRatioBased` with a `rate` between 0 and 1.
- `parent_based: true` makes the gateway follow the caller's sampling
  decision when a `traceparent` header arrives.
- To send metrics to a different Collector, set `exporter` and `endpoint`
  under `metrics`.
- `metrics.runtime_metrics: false` turns off the Go runtime metrics.

Tyk 5.13.0 introduced the `traces` block. On earlier releases, put the
trace settings directly under `opentelemetry` (`enabled`, `exporter`,
`endpoint`, `sampling`). Current releases still accept that form.

The same settings as environment variables:

```bash showLineNumbers title="Gateway environment"
TYK_GW_OPENTELEMETRY_TRACES_ENABLED=true
TYK_GW_OPENTELEMETRY_TRACES_EXPORTER=grpc
TYK_GW_OPENTELEMETRY_TRACES_ENDPOINT=otel-collector:4317
TYK_GW_OPENTELEMETRY_TRACES_SAMPLING_TYPE=TraceIDRatioBased
TYK_GW_OPENTELEMETRY_TRACES_SAMPLING_RATE=0.1
TYK_GW_OPENTELEMETRY_TRACES_SAMPLING_PARENTBASED=true
TYK_GW_OPENTELEMETRY_METRICS_ENABLED=true
TYK_GW_OPENTELEMETRY_METRICS_EXPORTINTERVAL=15
```

Restart the gateway after changing them.

### Send over TLS

If the Collector's OTLP receiver uses TLS, add a `tls` block to the trace
settings. Metrics use it too unless they set their own:

```json showLineNumbers title="tyk.conf (TLS excerpt)"
{
  "opentelemetry": {
    "traces": {
      "tls": {
        "enable": true,
        "ca_file": "/etc/tyk/certs/collector-ca.pem"
      }
    }
  }
}
```

`cert_file` and `key_file` add a client certificate for mutual TLS.
`headers` adds request headers to every export, for a Collector that
requires an auth header.

### On Kubernetes with the Tyk Helm chart

The chart's `gateway.opentelemetry` block configures tracing only. Turn
on metrics through `gateway.extraEnvs`; they follow the tracing endpoint:

```yaml showLineNumbers title="values.yaml (excerpt)"
gateway:
  opentelemetry:
    enabled: true
    exporter: grpc
    endpoint: otel-collector.observability.svc:4317
    sampling:
      type: TraceIDRatioBased
      rate: 0.1
      parentBased: true
  extraEnvs:
    - name: TYK_GW_OPENTELEMETRY_METRICS_ENABLED
      value: "true"
    - name: TYK_GW_OPENTELEMETRY_METRICS_EXPORTINTERVAL
      value: "15"
```

## Configuration

The `otlp` receiver takes both signals. Enable the protocol the gateway
uses: `grpc` on 4317 or `http` on 4318.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

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
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

Run the Collector on `otel/opentelemetry-collector-contrib:latest`. The
exporter name is `otlp_http` from OTel Collector Contrib 0.144.0 on.

The gateway names itself in `service.name`. The `resource` processor
above overwrites it with `SERVICE_NAME`, so set that to the name you want
in Scout. To change the name at the source instead, set `resource_name` in
the gateway's `opentelemetry` settings.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=tyk-gateway
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Adding identity dimensions

The default `tyk.api.requests.total` carries `tyk.api.id`,
`http.request.method` and `http.response.status_code`. It has no consumer
attribute. To count requests per consumer, add
your own metric definitions through `api_metrics`
(`opentelemetry.metrics.api_metrics` in `tyk.conf`, or
`TYK_GW_OPENTELEMETRY_METRICS_APIMETRICS` as one line of JSON).

Setting `api_metrics` replaces the defaults. Restate the four default
definitions alongside any custom one, or the default metrics stop. This
list restates the defaults and adds `tyk.api.requests.by_consumer`, a
counter by API, key alias (as `tyk.consumer.alias`, default `anonymous`)
and response flag:

```json showLineNumbers title="api_metrics"
[
  {
    "name": "http.server.request.duration",
    "type": "histogram",
    "description": "End-to-end request latency",
    "histogram_source": "total",
    "dimensions": [
      {"source": "metadata", "key": "method", "label": "http.request.method"},
      {"source": "metadata", "key": "response_code", "label": "http.response.status_code"},
      {"source": "metadata", "key": "api_id", "label": "tyk.api.id"},
      {"source": "metadata", "key": "response_flag", "label": "tyk.response_flag"}
    ]
  },
  {
    "name": "tyk.gateway.request.duration",
    "type": "histogram",
    "description": "Gateway processing time",
    "histogram_source": "gateway",
    "dimensions": [
      {"source": "metadata", "key": "method", "label": "http.request.method"},
      {"source": "metadata", "key": "api_id", "label": "tyk.api.id"},
      {"source": "metadata", "key": "response_flag", "label": "tyk.response_flag"}
    ]
  },
  {
    "name": "tyk.upstream.request.duration",
    "type": "histogram",
    "description": "Upstream response time",
    "histogram_source": "upstream",
    "dimensions": [
      {"source": "metadata", "key": "method", "label": "http.request.method"},
      {"source": "metadata", "key": "api_id", "label": "tyk.api.id"},
      {"source": "metadata", "key": "response_flag", "label": "tyk.response_flag"}
    ]
  },
  {
    "name": "tyk.api.requests.total",
    "type": "counter",
    "description": "Request count with identity dimensions",
    "dimensions": [
      {"source": "metadata", "key": "method", "label": "http.request.method"},
      {"source": "metadata", "key": "response_code", "label": "http.response.status_code"},
      {"source": "metadata", "key": "api_id", "label": "tyk.api.id"}
    ]
  },
  {
    "name": "tyk.api.requests.by_consumer",
    "type": "counter",
    "description": "Requests per API and key alias",
    "dimensions": [
      {"source": "metadata", "key": "api_id", "label": "tyk.api.id"},
      {"source": "session", "key": "alias", "label": "tyk.consumer.alias", "default": "anonymous"},
      {"source": "metadata", "key": "response_flag", "label": "tyk.response_flag"}
    ]
  }
]
```

Requests with a valid key carry the key's alias for every outcome,
including `QEX`. Requests with no key or an invalid key read `anonymous`.

Dimension sources:

- `metadata`, with keys including `method`, `response_code`, `api_id`,
  `api_name`, `org_id`, `listen_path`, `endpoint`, `response_flag`,
  `ip_address`, `api_version`, `host` and `scheme`.
- `session`, with keys `api_key`, `oauth_id`, `alias`, `portal_app` and
  `portal_org`.
- `header`, `context`, `response_header` and `config_data`, which read
  the named key from the request header, context variables, response
  header or API config data.

Prefer `alias` or `portal_app` to identify consumers. Session `api_key`
creates one series per key. Each instrument is capped at 2000 attribute
combinations by default (`cardinality_limit`), so a high-cardinality
dimension hits the cap and loses series beyond it.

## Collecting traces

The `traces` pipeline in the Collector config above receives the
gateway's spans. The metrics and traces pipelines are independent.

### What the traces show

Each request produces a Server span named by method and listen path, such
as `GET /orders/`, so span names grow with the number of APIs, not with
request paths. When the gateway proxies the request, an `HTTP GET` Client
span for the upstream call is its child. The client span is absent when
the gateway rejects the request itself (rate limit, auth, quota).

| Span | Kind | Status |
| --- | --- | --- |
| `<METHOD> <listen_path>` | Server | Unset on 2xx, Error on 4xx and 5xx. |
| `HTTP GET` | Client | Unset on success, Error on a failed upstream call. |

Client spans in Error carry `error.type`: `*net.OpError` on connection
refused, `context.deadlineExceededError` on a timeout. A connection
failure has no status code on the client span.

Server span attribute keys: `tyk.api.id`, `tyk.api.name`, `tyk.api.orgid`,
`tyk.api.path`, `tyk.api.tags`, `tyk.api.version`, `tyk.original_path`,
`http.request.method`, `http.response.status_code`,
`http.response.body.size`, `url.path`, `url.scheme`, `server.address`,
`server.port`, `client.address`, `network.peer.address`,
`network.peer.port`, `network.protocol.version`, `user_agent.original`.

Client span attribute keys: `http.request.method`,
`http.response.status_code`, `url.full`, `server.address`, `server.port`,
`network.protocol.version`, `error.type`.

`http.response.status_code` is a string on metrics and an integer on
spans. Cast one side when joining the two signals.

### Detailed tracing per API

Set `"detailed_tracing": true` in an API definition to add a span for each
gateway middleware the request passes through, such as `AuthKey`,
`RateCheckMW`, `RateLimitAndQuotaCheck`, `AccessRightsCheck` and
`VersionCheck`. Use it on APIs where you need to see which check rejected
a request or where gateway time goes.

With detailed tracing on, a rejected request shows its error on the
middleware span, and the Server span stays Unset:

- A missing or invalid key sets Error on `AuthKey`.
- An exhausted quota sets Error on `RateLimitAndQuotaCheck`, with the
  message "Quota exceeded".

Search for errors on the middleware spans for these APIs. Middleware
spans also carry `tyk.api.apikey`, a hash of the key rather than the key
itself, and `tyk.api.apikey.alias`.

## Verify the Setup

Start the Collector and the gateway, then send traffic through one of
your APIs:

```bash showLineNumbers title="Verify telemetry"
# Check the gateway is healthy
curl -s "http://${TYK_HOST}:8080/hello"

# Send a few requests through an API
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code}\n" "http://${TYK_HOST}:8080/orders/"; done

# Check the Collector for receiver or exporter errors
docker logs otel-collector 2>&1 | grep -iE "error|otlp"
```

Within one export interval, `tyk.gateway.apis.loaded` and
`tyk.api.requests.total` appear in Scout, and a server span for the API
appears in traces.

## Troubleshooting

### Traces arrive but no metrics do

**Cause**: Only tracing is on. The trace `enabled` setting does not turn
on metrics, and on the Helm chart `gateway.opentelemetry` configures
tracing only.

**Fix**:

1. Set `opentelemetry.metrics.enabled` (or
   `TYK_GW_OPENTELEMETRY_METRICS_ENABLED`) to `true`. Metrics follow the
   trace exporter and endpoint unless you set their own.
2. Restart the gateway.

### Metrics arrive once a minute

**Cause**: `export_interval` defaults to 60 seconds.

**Fix**: Set `opentelemetry.metrics.export_interval` to the interval you
want, in seconds.

### The gateway is down and no alert fires

**Cause**: There is no `up` series for a pushing gateway, so an
`up == 0` rule never matches.

**Fix**: Alert on absent `tyk.api.requests.total` or
`tyk.gateway.apis.loaded` data for two export intervals.

### Upstream p95 reads near zero on a busy API

**Cause**: Requests that never reached the upstream record a 0 sample in
`tyk.upstream.request.duration`.

**Look at**: `tyk.upstream.request.duration` grouped by
`tyk.response_flag`.

**Fix**: Filter upstream percentiles to `tyk.response_flag="200"`.

### Gateway latency jumps when an upstream is slow

**Cause**: A timeout (`URT`) is counted as gateway time.

**Look at**: `tyk.gateway.request.duration` grouped by
`tyk.response_flag`.

**Fix**: Exclude `URT` from gateway latency panels and alerts, and alert
on the `URT` flag separately.

### 403 rate rising and you cannot tell why

**Cause**: 403 covers both an invalid key (`AKI`) and an exhausted quota
(`QEX`).

**Look at**: the latency histograms grouped by `tyk.response_flag`, or
`tyk.api.requests.by_consumer` if you added it.

**Fix**: For `AKI`, find the consumer presenting the bad key. For `QEX`,
check the policy quota and the consumer's usage.

### Default metrics stopped after adding a custom metric

**Cause**: Setting `api_metrics` replaces the default definitions.

**Fix**: Restate the four default definitions alongside the custom one,
as in [Adding identity dimensions](#adding-identity-dimensions).

### Auth failures do not show as errors on server spans

**Cause**: The API has `detailed_tracing` on, so the error is recorded on
the middleware span (`AuthKey` or `RateLimitAndQuotaCheck`).

**Fix**: Search for Error status on the middleware spans for that API.

### Nothing arrives at the Collector

**Cause**: The gateway cannot reach the endpoint, or the protocol does
not match the receiver.

**Fix**:

1. Check the gateway log for exporter errors.
2. Match `exporter` to the receiver: `grpc` to port 4317, `http` to 4318.
3. If the receiver uses TLS, set the `tls` block in the trace settings.

## FAQ

### Does Tyk Gateway expose a Prometheus endpoint?

No. The gateway pushes metrics and traces over OTLP, so there is nothing
to scrape.

### Do I need Tyk Pump?

No. Tyk Pump is the older analytics path. The gateway's OpenTelemetry
export sends metrics and traces directly to the Collector.

### Can I send metrics without traces?

Yes. Turn on metrics only, and set `exporter` and `endpoint` under
`metrics`, since there are no trace settings for them to follow.

### Why does `tyk.response_flag` read 200?

The flag holds the error classification when there is one and the status
code otherwise. A proxied success has no classification, so it reads
`200`.

### Why does a rejected request have no client span?

The client span is the upstream call. A request rejected by rate limit,
auth or quota never reaches the upstream, so only the server span exists.

### Should I use cumulative or delta temporality?

Keep the default, `cumulative`. Set
`opentelemetry.metrics.temporality` to `delta` only if your backend
requires it.

### How do I monitor multiple gateways?

Point every gateway at the same Collector. Each gateway sets
`service.instance.id` and `tyk.gw.id` as resource attributes, so group by
them to separate instances.

## Related Guides

- [Apache APISIX Monitoring](./apisix.md) - API gateway monitored through
  its Prometheus plugin.
- [Envoy Monitoring](./envoy.md) - Proxy that uses the same style of
  response flags.
- [Traefik Monitoring](./traefik.md) - Edge router.
- [Redis Monitoring](./redis.md) - The store Tyk Gateway requires.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Tyk metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for [Redis](./redis.md) and
  the upstream services behind your APIs.
- **Fine-tune Collection**: Set the trace sampling rate and the metrics
  export interval to your traffic, and keep identity dimensions to
  low-cardinality keys.
