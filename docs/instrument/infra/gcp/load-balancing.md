---
date: 2026-09-02
id: collecting-gcp-load-balancing-telemetry
title: Google Cloud Load Balancing Monitoring with OpenTelemetry
sidebar_label: Cloud Load Balancing
sidebar_position: 6
description: >
  Collect Cloud Load Balancing request rates, latency distributions and
  access logs into base14 Scout using the OpenTelemetry
  googlecloudmonitoring and googlecloudpubsub receivers.
keywords:
  - cloud load balancing monitoring opentelemetry
  - gcp load balancer metrics scout
  - loadbalancing googleapis metrics
  - gcp load balancer access logs otel
  - https lb rule monitoring
  - gcp backend latency monitoring
  - cloud armor logs opentelemetry
  - google cloud lb observability
---

Cloud Load Balancing is the outermost hop in most GCP architectures, and
the only place that sees every request — including the ones that never
reach a backend. This guide collects its metrics with the
`googlecloudmonitoring` receiver and its access logs through the Cloud
Logging path, where the encoding extension maps them onto HTTP semantic
conventions.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note Running this in production

Storing and querying this telemetry at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Overview

Cloud Load Balancing metrics are organized by load balancer family, and
each family has its own metric namespace and monitored resource. Pick the
one matching what you actually run:

| Load balancer | Metric namespace | Monitored resource |
|---|---|---|
| Global external Application LB | `loadbalancing.googleapis.com/https/` | `https_lb_rule` |
| Regional external Application LB | `loadbalancing.googleapis.com/https/` | `http_external_regional_lb_rule` |
| Internal Application LB | `loadbalancing.googleapis.com/https/internal/` | `internal_http_lb_rule` |
| External proxy Network LB | `loadbalancing.googleapis.com/tcp_ssl_proxy/` | `tcp_ssl_proxy_rule` |
| Internal passthrough Network LB | `loadbalancing.googleapis.com/l3/internal/` | `internal_tcp_lb_rule`, `internal_udp_lb_rule` |
| External passthrough Network LB | `loadbalancing.googleapis.com/l3/external/` | `tcp_lb_rule`, `udp_lb_rule` |

The Application LB families carry HTTP semantics — status codes, routes,
cache results. The Network LB families are connection and byte counters
only, with no HTTP dimension at all.

## What each signal tells you

Metrics and logs answer different questions here, and production
deployments want both:

- **Metrics** give you rates and latency distributions cheaply, at a
  fixed cost regardless of traffic volume. They cannot tell you which
  URL was slow or which client was blocked.
- **Access logs** give you per-request detail — the path, the backend
  chosen, the `statusDetails` string explaining a 502 — at a cost
  proportional to request volume.

---

## Receiver configuration

```yaml showLineNumbers title="load-balancing-config.yaml"
receivers:
  # ...your existing receivers...
  googlecloudmonitoring/loadbalancing:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Request rates and volume
      - metric_name: "loadbalancing.googleapis.com/https/request_count"
      - metric_name: "loadbalancing.googleapis.com/https/request_bytes_count"
      - metric_name: "loadbalancing.googleapis.com/https/response_bytes_count"
      - metric_name: "loadbalancing.googleapis.com/https/backend_request_count"
      # Latency — all distributions, see the warning below
      - metric_name: "loadbalancing.googleapis.com/https/total_latencies"
      - metric_name: "loadbalancing.googleapis.com/https/backend_latencies"
      - metric_name: "loadbalancing.googleapis.com/https/frontend_tcp_rtt"

processors:
  resource/loadbalancing:
    attributes:
      - {key: service.name, value: loadbalancing-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_load_balancing, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  transform/loadbalancing:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - delete_key(attributes, "client_country")
          - delete_key(attributes, "proxy_continent")

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
    metrics/loadbalancing:
      receivers: [googlecloudmonitoring/loadbalancing]
      processors: [memory_limiter, resource/loadbalancing, transform/loadbalancing, batch]
      exporters: [otlphttp/base14]
```

The `transform/loadbalancing` processor is not optional in most
deployments — see [Cardinality control](#cardinality-control) for why.

:::warning The latency metrics are distributions

`total_latencies`, `backend_latencies` and `frontend_tcp_rtt` are all
`DELTA` + `DISTRIBUTION`, which is supported from collector v0.129.0 and
lands in `otel_metrics_histogram` with delta temporality. On an older
collector they will fail, and a distribution failure drops the **entire
scrape batch** — every metric from this receiver, not just the latency
one. If your request-rate metrics vanish after you add latency, this is
why.

:::

### Internal and Network load balancers

For internal Application LBs, swap the `https/` prefix for
`https/internal/`. For passthrough Network LBs there is no HTTP family
at all — use the byte and packet counters:

```yaml showLineNumbers title="load-balancing-config.yaml"
    metrics_list:
      - metric_name: "loadbalancing.googleapis.com/l3/internal/ingress_bytes_count"
      - metric_name: "loadbalancing.googleapis.com/l3/internal/egress_bytes_count"
      - metric_name: "loadbalancing.googleapis.com/l3/internal/ingress_packets_count"
      - metric_name: "loadbalancing.googleapis.com/l3/internal/rtt_latencies"
```

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

---

## Authentication and IAM

`roles/monitoring.viewer` for metrics, plus `roles/pubsub.subscriber` on
the subscription if you also collect access logs. See
[GCP Monitoring overview](./overview.md#authentication).

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `https/request_count` | **Delta** sum | count | Request rate, split by `response_code_class`. The error-rate numerator and denominator both come from here. |
| `https/backend_request_count` | **Delta** sum | count | Requests the LB actually forwarded. The gap against `request_count` is what the LB served or rejected itself — cache hits, redirects, Cloud Armor blocks. |
| `https/total_latencies` | **Delta** histogram | ms | End-to-end, proxy receive to client ACK. This is what your users experience. |
| `https/backend_latencies` | **Delta** histogram | ms | Proxy to backend round trip. Subtract from total to isolate network and client-side time. |
| `https/frontend_tcp_rtt` | **Delta** histogram | ms | Client-to-proxy RTT. Rises for geographically distant clients, independent of your backends. |
| `https/request_bytes_count` | **Delta** sum | bytes | Ingress volume; upload-heavy workloads spot problems here first. |
| `https/response_bytes_count` | **Delta** sum | bytes | Egress volume, which is directly billable. |

Every one of these is `DELTA`, so sum the points over your window rather
than treating them as monotonic counters.

The labels worth grouping by:

| Label | Values | Why it matters |
|---|---|---|
| `response_code` | Exact status | Distinguishing 502 from 503 changes the diagnosis |
| `response_code_class` | `200`, `300`, `400`, `500` | The cheap error-rate dimension |
| `cache_result` | `HIT`, `MISS`, `DISABLED`, and others | Cloud CDN effectiveness |
| `protocol` | `HTTP/1.1`, `HTTP/2`, `HTTP/3` | Protocol-specific regressions |
| `client_country` | ~250 ISO codes | Useful, and expensive in proportion |
| `proxy_continent` | 6 or so | Which GFE region served the request |

---

## Cardinality control

Cloud Load Balancing is the highest-cardinality metric surface in this
set, because its labels multiply.

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `forwarding_rule_name`, `url_map_name` | Resource label | One per LB | Yes |
| `backend_target_name` | Resource label | One per backend service | Yes |
| `response_code_class` | Metric label | 4 | Yes |
| `response_code` | Metric label | Tens | Usually |
| `cache_result` | Metric label | ~6 | If you use Cloud CDN |
| `proxy_continent` | Metric label | ~6 | Rarely |
| `client_country` | Metric label | ~250 | No, by default |

`client_country` × `response_code` × `protocol` × `cache_result` on a
single forwarding rule produces tens of thousands of series before you
have added a second load balancer. The `transform` processor in the
config above drops the two worst offenders.

If you do want geographic breakdown, take it from the **access logs**
rather than the metrics. Logs carry the client IP and geo fields per
request without multiplying a permanent time series.

---

## Alert tuning

| Signal | Source metric | Warning | Critical | Notes |
|---|---|---|---|---|
| Error rate | `https/request_count` where `response_code_class = 500` | > 1% for 5m | > 5% for 5m | Compute against the total, not against a fixed count. |
| Backend latency | `https/backend_latencies` p99 | > 1s for 10m | > 3s for 5m | Use backend rather than total, so client network conditions do not page you. |
| Frontend-backend divergence | `total_latencies` p99 minus `backend_latencies` p99 | growing | — | A widening gap points at the client network or the proxy, not your service. |
| Backend unreachable | `https/backend_request_count` vs `request_count` | ratio drops | ratio near zero | Sudden divergence means the LB is failing requests before they reach a backend. |
| Cache hit rate | `https/request_count` where `cache_result = HIT` | falling | — | Only meaningful with Cloud CDN enabled. |
| Egress spike | `https/response_bytes_count` | 2x baseline | 5x baseline | Cost control as much as an incident signal. |

---

## Logs

Access logs are where per-request detail lives. The
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) guide uses load
balancer logs as its worked example, including the `resource.type`
table for each LB family — follow it for the sink, topic and
subscription, then return here for what the entries contain.

Enable logging on the backend service first; it is off by default:

```bash showLineNumbers
gcloud compute backend-services update BACKEND_SERVICE \
  --global \
  --enable-logging \
  --logging-sample-rate=1.0
```

Lower `--logging-sample-rate` on high-volume load balancers. A sample
rate of `0.1` still gives usable error analysis at a tenth of the volume,
and errors are what these logs are mostly for.

### What the encoding extension produces

With `google_cloud_logentry_encoding`, load balancer entries are
recognized as `gcp.load-balancer` format and mapped onto semantic
conventions rather than left as an opaque JSON body:

| Log field | OTel attribute |
|---|---|
| `httpRequest.requestMethod` | `http.request.method` |
| `httpRequest.requestUrl` | `url.full`, plus parsed `url.path`, `url.query`, `url.domain` |
| `httpRequest.status` | `http.response.status_code` |
| `httpRequest.latency` | `http.request.server.duration` |
| `httpRequest.remoteIp` | `network.peer.address` |
| `httpRequest.userAgent` | `user_agent.original` |
| `statusDetails` | `gcp.load_balancing.status_details` |
| `proxyStatus` | `gcp.load_balancing.proxy_status` |
| `cacheDecision` | `gcp.load_balancing.cache.decision` |
| `tls.protocol` | `tls.protocol.name` |

`statusDetails` is the single most useful field for debugging a 5xx —
it distinguishes `backend_connection_closed_before_data_sent_to_client`
from `failed_to_pick_backend` from `client_disconnected_before_any_response`,
which are three entirely different problems behind the same status code.

### Cloud Armor

If Cloud Armor fronts the load balancer, its decisions appear in the
same log stream and the extension maps them to `gcp.armor.*` — the rule
that matched, its priority, the configured action, and the outcome, plus
`tls.client.ja3` and `tls.client.ja4` fingerprints. Blocked requests
appear in the LB metrics as 403s but only the logs say which rule did it.

---

## Verify

1. **The collector starts cleanly** — check for `PermissionDenied` in
   its logs.

2. **The latency metrics did not break the batch.** If `request_count`
   stopped arriving when you added them, see the warning above.

3. **Confirm the metrics landed:**

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, sum(Value) AS total
   FROM otel_metrics_sum
   WHERE ServiceName = 'loadbalancing-metrics'
     AND MetricName = 'loadbalancing.googleapis.com/https/request_count'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

   Latency metrics are in `otel_metrics_histogram`.

4. **Confirm the logs landed and were decoded.** Look for
   `http.response.status_code` as an attribute rather than raw JSON in
   the body — if the body is unparsed JSON, the encoding extension is
   not wired into the pipeline.

---

## Troubleshooting

**Metrics arrive but the load balancer is not the one you meant.**
Several LB families share the `https/` prefix but use different
monitored resources. Group by `forwarding_rule_name` to see which rules
are actually reporting.

**Access logs are empty despite the sink existing.**
Logging is off by default on backend services. Run the
`gcloud compute backend-services update --enable-logging` command above,
and confirm with `--logging-sample-rate` set above zero.

**Log bodies are raw JSON with no HTTP attributes.**
The `google_cloud_logentry_encoding` extension is missing from the
receiver's `encoding` field or from the `service.extensions` list. See
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md).

**The series count is far higher than expected.**
`client_country` alone contributes around 250 values, multiplied by
every other label. Add the `transform` processor from the config above.

**`backend_latencies` is missing but `total_latencies` is present.**
Requests are being served without reaching a backend — cache hits,
redirects, or Cloud Armor denials. That divergence is itself the useful
signal.

## FAQ

### How do I monitor a Google Cloud load balancer with OpenTelemetry?

Use the `googlecloudmonitoring` receiver against the
`loadbalancing.googleapis.com/` prefix for metrics, and route access
logs through a Log Router sink into Pub/Sub for the
`googlecloudpubsub` receiver. Metrics give you rates and latency
distributions; logs give you per-request detail.

### Which Cloud Load Balancing metrics matter most?

Error rate comes from `https/request_count` split by
`response_code_class`, and latency from `https/backend_latencies`.
Backend latency is the better alerting signal than total latency,
because total includes client
network conditions you cannot fix.

### Why did all my load balancer metrics stop after adding latency?

The latency metrics are distributions, which need collector v0.129.0 or
later. On older builds an invalid distribution data point fails the
entire scrape batch, dropping every metric from that receiver instance.

### How do I control load balancer metric cardinality?

Drop `client_country` and `proxy_continent` with a `transform`
processor. `client_country` alone has around 250 values and multiplies
against every other label. Take geographic analysis from the access logs
instead, where it costs nothing permanent.

### What is the difference between total_latencies and backend_latencies?

`total_latencies` measures from when the proxy received the request to
when the client acknowledged the response, so it includes client network
time. `backend_latencies` measures only the proxy-to-backend round trip.
A widening gap between them points at the network, not your service.

### Do I need Cloud Armor logs separately?

Cloud Armor decisions appear in the same load balancer log stream, so no
second sink is needed. The encoding extension maps them to
`gcp.armor.*` attributes automatically.

## Reference

- [Cloud Load Balancing metrics](https://docs.cloud.google.com/load-balancing/docs/metrics)
- [Application Load Balancer logging](https://docs.cloud.google.com/load-balancing/docs/https/https-logging-monitoring)
- [statusDetails reference](https://docs.cloud.google.com/load-balancing/docs/https/https-logging-monitoring#what_is_logged)

## Related Guides

- [GCP Monitoring overview](./overview.md) - why the distribution
  metrics on this page need a recent collector build.
- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - the sink and
  encoding setup the Logs section depends on.
- [API Gateway and nginx](./api-gateway.md) - the gateway layer that
  usually sits behind this load balancer.
- [Cloud Run](./cloud-run.md) - a common backend, and where the traces
  that correlate with these requests originate.
