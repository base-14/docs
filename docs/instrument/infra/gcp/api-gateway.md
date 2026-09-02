---
date: 2026-09-02
id: collecting-gcp-api-gateway-telemetry
title: GCP API Gateway and Self-Managed nginx Monitoring with OpenTelemetry
sidebar_label: API Gateway and nginx
sidebar_position: 7
description: >
  Collect telemetry from Google Cloud API Gateway and from self-managed
  nginx API gateways on GKE or Compute Engine into base14 Scout with the
  OpenTelemetry Collector.
keywords:
  - gcp api gateway monitoring opentelemetry
  - apigateway googleapis metrics
  - nginx gateway monitoring gke
  - nginx opentelemetry module gcp
  - ingress nginx metrics scout
  - api gateway logs otel
  - gcp gateway observability
  - nginx prometheus exporter opentelemetry
---

"API gateway" on GCP means one of two unrelated things, and they are
instrumented completely differently. This guide covers both: Google's
managed **API Gateway** service, and a **self-managed nginx** gateway
running on GKE or Compute Engine.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note API Gateway is not nginx

Google Cloud API Gateway is built on **Envoy** by way of ESPv2, not
nginx. If you are looking for nginx instrumentation because you run
nginx, skip to [Part B](#part-b-self-managed-nginx). If you use Google's
managed service, [Part A](#part-a-gcp-api-gateway) applies and nginx is
irrelevant to you. The two parts of this page do not overlap.

:::

:::note Running this in production

Storing and querying this telemetry at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Choosing your part

| You run | Read | Telemetry source |
|---|---|---|
| Google Cloud API Gateway (managed, ESPv2/Envoy) | [Part A](#part-a-gcp-api-gateway) | Cloud Monitoring + Cloud Logging |
| ingress-nginx on GKE | [Part B](#part-b-self-managed-nginx) | Prometheus scrape + filelog |
| nginx on Compute Engine | [Part B](#part-b-self-managed-nginx) | Prometheus scrape + filelog + OTel module |
| Envoy or Traefik directly | [Envoy](../../component/envoy.md), [Traefik](../../component/traefik.md) | Native OTel support |

---

## Part A: GCP API Gateway

API Gateway publishes a small, fixed metric set to Cloud Monitoring under
`apigateway.googleapis.com/`. The monitored resource is
`apigateway.googleapis.com/Gateway`, with labels for `gateway_id`,
`location` and `project_id`. Metrics additionally carry `api_config`,
which is the dimension to group by during a config rollout, and
`response_code_class`.

Confirm each metric name in **Monitoring → Metrics Explorer** with the
**Active** toggle enabled before relying on it — API Gateway's published
metric set has changed more than most.

### Receiver configuration

```yaml showLineNumbers title="api-gateway-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/apigateway:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      - metric_name: "apigateway.googleapis.com/request_count"
      # Distributions — collector v0.129.0 or later only
      - metric_name: "apigateway.googleapis.com/request_latencies"
      - metric_name: "apigateway.googleapis.com/request_sizes"
      - metric_name: "apigateway.googleapis.com/response_sizes"

processors:
  resource/apigateway:
    attributes:
      - {key: service.name, value: apigateway-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_api_gateway, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    metrics/apigateway:
      receivers: [googlecloudmonitoring/apigateway]
      processors: [memory_limiter, resource/apigateway, batch]
      exporters: [otlphttp/base14]
```

:::warning Three of these four are distributions

`request_latencies`, `request_sizes` and `response_sizes` are all
`DELTA` + `DISTRIBUTION`, which needs collector **v0.129.0 or later**.
On an older build they produce invalid data points that fail the entire
scrape batch, so `request_count` disappears along with them.

If you cannot upgrade, delete the three marked lines and collect
`request_count` alone. That leaves you with error rate and traffic
volume, and no latency at all — API Gateway publishes latency only as a
distribution.

:::

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

### What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `request_count` | **Delta** sum | count | Request rate, labelled by `response_code` and `response_code_class`. |
| `request_latencies` | **Delta** histogram | ms | End-to-end gateway latency, including the backend. |
| `request_sizes` | **Delta** histogram | bytes | Payload sizes; where request-size limit rejections originate. |
| `response_sizes` | **Delta** histogram | bytes | Response volume, and egress cost. |

That is the whole set. API Gateway exposes no per-route breakdown in
metrics, no backend-versus-gateway latency split, and no authentication
outcome dimension. For any of those you need the logs.

### Logs

API Gateway request logs go to Cloud Logging under
`resource.type="apigateway.googleapis.com/Gateway"`. Route them through
the sink you set up in
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md):

```bash showLineNumbers
gcloud logging sinks create scout-apigateway-logs \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="apigateway.googleapis.com/Gateway"'
```

Entries carry an `httpRequest` block, which the
`google_cloud_logentry_encoding` extension maps to `http.request.method`,
`url.full`, `http.response.status_code`, `http.request.server.duration`
and `network.peer.address`. The API config and route that matched appear
in the payload.

If your backend runs ESPv2 on Cloud Run directly rather than behind API
Gateway, it also publishes under `serviceruntime.googleapis.com/api/` —
a richer set including per-method breakdowns and quota metrics.

### Alert tuning

| Signal | Source metric | Warning | Critical |
|---|---|---|---|
| Error rate | `request_count` where `response_code_class = 500` | > 1% for 5m | > 5% for 5m |
| Client errors | `request_count` where `response_code_class = 400` | > 10% for 15m | > 25% for 15m |
| Latency | `request_latencies` p99 | > 1s for 10m | > 3s for 5m |
| Traffic stop | `request_count` | zero for 10m | zero for 30m |

A high 4xx rate on API Gateway usually means authentication or schema
validation rejections rather than genuine client bugs — the gateway
rejects before the backend sees anything. The logs distinguish them.

---

## Part B: Self-managed nginx

nginx exposes four numbers by default, through the `stub_status`
module. Getting useful gateway
telemetry means choosing among three sources, which stack.

| Source | Gives you | Cost |
|---|---|---|
| `nginx` receiver via `stub_status` | 4 connection and request counters | Trivial |
| `prometheus` receiver via `nginx-prometheus-exporter` | Per-upstream, per-status detail | One extra process |
| `filelog` receiver on the access log | Per-request detail, any field you log | Log volume |
| `nginx-module-otel` | Real distributed traces | A module build |

The receiver configuration for all four is documented once in
[nginx component](../../component/nginx.md). This section covers only
what changes when nginx is a GCP API gateway.

### ingress-nginx on GKE

ingress-nginx already exposes Prometheus metrics on port 10254 — no
exporter needed. Scrape it with the `prometheus` receiver:

```yaml showLineNumbers title="nginx-gateway-config.yaml"
receivers:
  # ...your existing receivers...
  prometheus/nginx:
    config:
      scrape_configs:
        - job_name: ingress-nginx
          scrape_interval: 30s
          kubernetes_sd_configs:
            - role: pod
              namespaces:
                names: [ingress-nginx]
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_container_port_name]
              action: keep
              regex: metrics

processors:
  resource/nginx:
    attributes:
      - {key: service.name, value: nginx-gateway-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_kubernetes_engine, action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  memory_limiter:
    limit_mib: 512
    spike_limit_mib: 128
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    # ...your existing pipelines...
    metrics/nginx:
      receivers: [prometheus/nginx]
      processors: [memory_limiter, resource/nginx, batch]
      exporters: [otlphttp/base14]
```

The `service.name` here is deliberately not `apigateway-metrics`. A
managed API Gateway and a self-managed nginx gateway publish different
metric vocabularies, and `ServiceName` is the leading sort key in the
Scout data lake — sharing one makes every query read both.

ingress-nginx metrics carry an `ingress` and `host` label, giving you
the per-route breakdown that neither the `nginx` receiver nor GCP API
Gateway provides.

:::warning ingress-nginx path labels

`nginx_ingress_controller_requests` is labelled by ingress name rather
than raw path, so it is bounded. If you enable the optional
per-path histogram metrics, they are not — the label takes the request
URI verbatim, and any URL containing an id becomes its own series.
Normalize the path in the collector before it reaches Scout, or leave
those metrics off.

:::

### Access logs

Configure nginx to log JSON so the collector does not have to parse a
custom format:

```nginx showLineNumbers title="nginx.conf"
log_format otel_json escape=json
  '{"time":"$time_iso8601",'
  '"http.request.method":"$request_method",'
  '"url.path":"$uri",'
  '"http.response.status_code":$status,'
  '"http.request.server.duration":$request_time,'
  '"network.peer.address":"$remote_addr",'
  '"user_agent.original":"$http_user_agent",'
  '"server.address":"$upstream_addr",'
  '"trace_id":"$otel_trace_id"}';

access_log /var/log/nginx/access.log otel_json;
```

Naming the JSON keys after semantic conventions means the `filelog`
receiver's `json_parser` produces correctly named attributes with no
mapping step. `$otel_trace_id` is available only when
`nginx-module-otel` is loaded, and is what links these logs to traces.

### Traces

`nginx-module-otel` gives nginx real distributed tracing — it starts or
continues a trace at the gateway, so every downstream span sits under a
root span that includes the gateway's own time. base14 publishes a
prebuilt module at
[base-14/nginx-otel-build](https://github.com/base-14/nginx-otel-build).
Configuration is in [nginx component](../../component/nginx.md).

**A self-managed nginx gateway can emit traces; GCP API Gateway
cannot.**

### Correlating with the load balancer

An nginx gateway on GCP almost always sits behind a Cloud Load Balancer.
That means two hops recording the same request, and comparing them is
diagnostic:

- Latency at the LB but not at nginx points at the network between them,
  or at a backend the LB served without forwarding.
- Requests at the LB that never appear in the nginx access log were
  rejected by the LB or Cloud Armor.
- Status codes that differ between the two hops mean something is
  rewriting responses.

See [Cloud Load Balancing](./load-balancing.md) for the LB side. Use the
same `deployment.environment.name` on both so they line up.

---

## Cardinality control

The two paths fail differently here, which is worth knowing before you
enable either.

| Attribute | Path | Cardinality | Keep? |
|---|---|---|---|
| `gateway_id`, `location` | API Gateway | One per gateway | Yes |
| `api_config` | API Gateway | One per published config revision | Only during a rollout |
| `response_code_class` | Both | 4 | Yes |
| `ingress`, `host` | ingress-nginx | One per ingress or hostname | Yes |
| Request path | ingress-nginx optional metrics | Unbounded | No |

Managed API Gateway is naturally bounded — it publishes four metrics
with a handful of labels, and `api_config` is the only one that grows,
one value per config you publish.

nginx is the opposite. Its optional per-path histograms label by raw
request URI, so `/orders/8a3f-…` and `/orders/9b2c-…` become separate
series forever. Either leave those metrics off, or normalize the path
before export:

```yaml showLineNumbers title="nginx-gateway-config.yaml"
processors:
  transform/nginx:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - replace_pattern(attributes["path"], "/[0-9a-f-]{8,}", "/{id}")
          - replace_pattern(attributes["path"], "/[0-9]+", "/{id}")
```

---

## Verify

1. **The collector starts cleanly** — check for `PermissionDenied`
   (Part A) or scrape errors (Part B) in its logs.

2. **Confirm metrics landed.** For API Gateway:

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, sum(Value) AS total
   FROM otel_metrics_sum
   WHERE ServiceName = 'apigateway-metrics'
     AND MetricName = 'apigateway.googleapis.com/request_count'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

3. **For nginx, confirm the scrape target is up.** The `prometheus`
   receiver emits an `up` series per target; a value of 0 means the
   target was discovered but did not respond.

---

## Troubleshooting

**API Gateway metrics are empty although the gateway serves traffic.**
Confirm `project_id` is the project holding the gateway, not the one
holding the backend. Managed API Gateway and its Cloud Run backend are
frequently in different projects.

**All API Gateway metrics stopped after adding latency.**
`request_latencies`, `request_sizes` and `response_sizes` are all
distributions and need collector v0.129.0 or later.

**ingress-nginx scrape returns nothing.**
The metrics port is not named `metrics` in your Helm values, so the
relabel rule drops it. Check the container port name on the controller
pod rather than assuming the default.

**nginx access logs have no trace id.**
`$otel_trace_id` is only populated when `nginx-module-otel` is loaded
and tracing is enabled for that location block. Without the module the
variable expands to an empty string.

**The series count exploded after enabling nginx path metrics.**
The per-path histograms label by raw request URI. Normalize the path
before export or leave those metrics disabled.

**Request counts differ between the load balancer and nginx.**
That is usually correct rather than a collection bug — see
[Correlating with the load balancer](#correlating-with-the-load-balancer).

## FAQ

### Is Google Cloud API Gateway based on nginx?

No — Google Cloud API Gateway runs ESPv2, which is built on Envoy. If
you are looking for nginx telemetry, you are running nginx yourself, and
Part B of this guide applies rather than Part A.

### How do I monitor GCP API Gateway with OpenTelemetry?

Use the `googlecloudmonitoring` receiver against the
`apigateway.googleapis.com/` prefix for its four metrics, and route
`resource.type="apigateway.googleapis.com/Gateway"` logs through a Log
Router sink for per-request detail.

### Can GCP API Gateway emit distributed traces?

GCP API Gateway emits metrics and request logs only, never traces. A
self-managed nginx gateway can emit traces using `nginx-module-otel`,
which is one of the stronger arguments for running your own gateway if
tracing matters to you.

### What is the best way to get metrics from ingress-nginx on GKE?

Scrape its built-in Prometheus endpoint on port 10254 with the
`prometheus` receiver. It already exposes per-ingress and per-host
metrics, so no separate exporter is needed.

### Why does the nginx receiver give me so few metrics?

It reads `stub_status`, which nginx open source limits to four values.
Use `nginx-prometheus-exporter` or, on Kubernetes, ingress-nginx's own
Prometheus endpoint for anything more detailed.

### Should I collect metrics at the load balancer or at nginx?

Collect at both. They see different things, and the difference between
them is itself diagnostic — requests the load balancer rejected never reach
nginx, and latency added between the two hops shows up nowhere else.

## Reference

- [API Gateway monitoring](https://docs.cloud.google.com/api-gateway/docs/monitoring)
- [ESPv2 on Cloud Run](https://docs.cloud.google.com/endpoints/docs/openapi/get-started-cloud-run)
- [ingress-nginx metrics](https://kubernetes.github.io/ingress-nginx/user-guide/monitoring/)
- [base-14/nginx-otel-build](https://github.com/base-14/nginx-otel-build)

## Related Guides

- [GCP Monitoring overview](./overview.md) - which collector image
  carries the receivers both halves of this page need.
- [nginx component](../../component/nginx.md) - the full receiver,
  access log and tracing configuration Part B builds on.
- [Cloud Load Balancing](./load-balancing.md) - the hop in front of the
  gateway, and how to correlate the two.
- [Envoy component](../../component/envoy.md) - if you run Envoy
  directly rather than through API Gateway.
