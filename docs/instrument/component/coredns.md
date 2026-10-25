---
title: >
  CoreDNS OpenTelemetry Monitoring - Query Rates, SERVFAIL, Upstream
  Health, and Cache
sidebar_label: CoreDNS
id: collecting-coredns-telemetry
sidebar_position: 81
description: >
  Collect CoreDNS metrics with the OpenTelemetry Collector. Monitor query
  rates, SERVFAIL responses, upstream health, cache hit ratio and latency
  in base14 Scout.
keywords:
  - coredns opentelemetry
  - coredns otel collector
  - coredns metrics monitoring
  - opentelemetry prometheus receiver coredns
  - kubernetes dns monitoring
  - coredns servfail alert
  - coredns observability
  - kube-dns monitoring
---

# CoreDNS

CoreDNS exposes metrics through its `prometheus` plugin, on port `9153` at
`/metrics`, in Prometheus text format. The OpenTelemetry Collector's
`prometheus` receiver scrapes that endpoint and ships the metrics to
base14 Scout. The setup is the same for Kubernetes cluster DNS and for
standalone CoreDNS.

CoreDNS reports:

- Queries by zone, type and transport, and responses by response code.
- Query latency.
- Upstream latency, response codes and health for the `forward` plugin.
- Cache hits and entries.
- Reload and self-check failures.
- On Kubernetes, how long Service changes take to reach DNS, and its
  requests to the API server.

To collect them, bind the `prometheus` plugin to an address the
Collector can reach, then point the Collector at each CoreDNS instance.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| CoreDNS                | 1.11.0  | 1.15.0      |
| OTel Collector Contrib | 0.90.0  | 0.163.2     |
| base14 Scout           | Any     | -           |

CoreDNS 1.11.0 added the `coredns_proxy_*` metrics this guide uses for
the `forward` plugin. If your dashboards use
`coredns_forward_requests_total` or
`coredns_forward_request_duration_seconds`, see
[Forward metrics moved](#forward-metrics-moved).

Before starting:

- CoreDNS must be running with the `prometheus` plugin in each server
  block you want metrics for.
- Port `9153` must be reachable from the Collector.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

Know these before you read the tables:

- The receiver emits `up = 1` when port `9153` answers, plus four
  `scrape_*` series. There is no metrics enable list; the receiver keeps
  everything the endpoint serves.
- Plugin metrics appear only for plugins in the Corefile. The `forward`
  and `cache` families need those plugins, and the `kubernetes` families
  appear only on cluster DNS.
- Some series appear only after the first event. For example,
  `coredns_proxy_healthcheck_failures_total` exists only after an upstream
  fails a health check.
- NXDOMAIN is normal traffic. Missing names return it, and in Kubernetes
  search-path expansion returns it for most short names. Watch SERVFAIL
  instead.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | The exporter answers. 0 means CoreDNS is down or the plugin is bound to `localhost`. |
| `coredns_dns_requests_total` | Queries by `zone`, `type`, `proto` and `family`. |
| `coredns_dns_responses_total` | Responses by `zone` and `rcode`. The SERVFAIL rate per zone. |
| `coredns_panics_total` | Any increase is an incident. |

The `plugin` label on `coredns_dns_responses_total` names the plugin that
wrote the response. When the `errors` plugin is in the block, it reads
`errors` for most answers, whichever plugin resolved them. It is empty
when CoreDNS itself wrote the response, such as a SERVFAIL after every
upstream failed.

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Query latency | `coredns_dns_request_duration_seconds` | Time to answer a query, per `server` and `zone`. |
| Upstream latency | `coredns_proxy_request_duration_seconds` | Latency and `rcode` per upstream (`to`), with `proxy_name="forward"`. Its `_count` is the upstream request count. |
| Upstream health | `coredns_proxy_healthcheck_failures_total`, `coredns_forward_healthcheck_broken_total` | Failed health checks per upstream, and times every upstream of a `forward` block was down. |
| Load shedding | `coredns_forward_max_concurrent_rejects_total` | Queries rejected by the `forward` plugin's `max_concurrent` limit. |
| Cache | `coredns_cache_hits_total`, `coredns_cache_requests_total`, `coredns_cache_entries` | Hit ratio and cache size, by `type` (`success`, `denial`). |
| Reload | `coredns_reload_failed_total` | A Corefile change failed to load. |
| Self check | `coredns_health_request_failures_total` | The `health` plugin's self check failed. |
| Kubernetes | `coredns_kubernetes_dns_programming_duration_seconds` | Time from a Service or endpoint change to DNS answering with it. |
| Kubernetes | `coredns_kubernetes_rest_client_requests_total` | Requests to the API server by `code`. |

A dead upstream does not appear in upstream latency.
`coredns_proxy_request_duration_seconds` records only answered queries, so
an upstream that never answers adds no samples. A dead upstream shows up
instead as:

- SERVFAIL in `coredns_dns_responses_total` for the zone.
- Rising `coredns_proxy_healthcheck_failures_total` for that `to`.
- `coredns_forward_healthcheck_broken_total` once every upstream of the
  block is down.

Alert on those, not on latency alone.

### Diagnostic - for investigation and tuning

| Group | Metrics | When you reach for it |
|---|---|---|
| Sizes | `coredns_dns_request_size_bytes`, `coredns_dns_response_size_bytes` | Message sizes per transport. |
| Connection reuse | `coredns_proxy_conn_cache_hits_total`, `coredns_proxy_conn_cache_misses_total` | Upstream connection reuse per upstream and protocol. |
| Cache misses | `coredns_cache_misses_total` | Deprecated upstream. Derive misses from requests minus hits. |
| Self check timing | `coredns_health_request_duration_seconds` | How long the `health` plugin's self check takes. |
| Inventory | `coredns_build_info`, `coredns_plugin_enabled` | Version per instance and plugins enabled per block. |
| Hosts | `coredns_hosts_entries`, `coredns_hosts_reload_timestamp_seconds` | Entries and last reload of the `hosts` plugin. |
| Runtime | `go_*`, `process_*` | Go and process metrics for the CoreDNS binary. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_samples_post_metric_relabeling`, `scrape_series_added` | Receiver-side scrape health. |

Full metric reference: the
[CoreDNS prometheus plugin docs](https://coredns.io/plugins/metrics/) and
each plugin's page.

## Key Alerts to Configure

These rules use Core and Operational series. The relative rows compare
against a trailing baseline of the same series. Tune them to your
workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for one interval | CoreDNS is down or the plugin is bound to `localhost`. Check the process and the `prometheus` address. |
| `rate(coredns_dns_responses_total{rcode="SERVFAIL"}[5m]) / rate(coredns_dns_responses_total[5m])` by `zone` | Above the trailing baseline | Resolution is failing for the zone. Check upstream health. |
| `increase(coredns_panics_total[5m])` | `> 0` | CoreDNS panicked. Check the logs for the stack trace. |
| `increase(coredns_forward_healthcheck_broken_total[5m])` | `> 0` | Every upstream of a `forward` block was down. Queries for that zone fail. |
| `rate(coredns_proxy_healthcheck_failures_total[5m])` by `to` | `> 0` for 10m | An upstream is failing health checks. |
| p99 of `coredns_dns_request_duration_seconds` by `server` | Above the trailing baseline | Queries are slowing. Compare with upstream latency to find where. |
| p99 of `coredns_proxy_request_duration_seconds` by `to` | Above the trailing baseline | An upstream is slowing. |
| `increase(coredns_reload_failed_total[10m])` | `> 0` | A Corefile change did not load. CoreDNS keeps serving the old config. |
| `rate(coredns_cache_hits_total[5m]) / rate(coredns_cache_requests_total[5m])` | Below the trailing baseline | More queries go upstream. Set the baseline from your workload. |
| `increase(coredns_forward_max_concurrent_rejects_total[5m])` | `> 0` | Queries are being shed by `max_concurrent`. |

## Access Setup

### Bind the plugin to a reachable address

`prometheus` with no address listens on `localhost:9153`. A Collector in
another container, pod or host then gets an immediate connection failure,
and `up` reads 0. Give the plugin an address in each server block:

```text showLineNumbers title="Corefile"
. {
    errors
    health :8080
    ready :8181
    prometheus 0.0.0.0:9153
    forward . 10.0.0.2 10.0.0.3 {
        health_check 5s
    }
    cache 30
    reload
    loop
}
```

On Kubernetes the cluster DNS Corefile already uses `prometheus :9153`,
which binds all addresses, so no change is needed. The CoreDNS Helm chart
sets `prometheus 0.0.0.0:9153` in its default server block.

Port `9153` serves metrics without authentication. Keep it on an internal
network and restrict it to the Collector with firewall rules or a network
policy.

### Turn on the signals you want to alert on

Some alerts depend on plugin settings:

- `health_check` on `forward` produces the upstream health metrics.
  Without it, a dead upstream shows only as SERVFAIL.
- `max_concurrent` on `forward` produces the rejects counter.
- `health` and `ready` serve `:8080/health` and `:8181/ready` for
  liveness and readiness probes.

Check the endpoint from the Collector's host:

```bash showLineNumbers title="Verify access"
curl -s "http://${COREDNS_HOST}:9153/metrics" | grep coredns_build_info
```

## Configuration

Add a `prometheus` receiver that scrapes each CoreDNS instance:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: coredns
          scrape_interval: 15s
          static_configs:
            - targets:
                - ${env:COREDNS_HOST}:9153

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

### Scraping cluster DNS on Kubernetes

Scrape each CoreDNS pod directly, not the `kube-dns` Service, so each
pod's series stay separate. Discover the pods by their `k8s-app=kube-dns`
label:

```yaml showLineNumbers title="config/otel-collector.yaml (Kubernetes pods)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: coredns
          scrape_interval: 15s
          kubernetes_sd_configs:
            - role: pod
              namespaces:
                names: [kube-system]
          relabel_configs:
            - source_labels: [__meta_kubernetes_pod_label_k8s_app]
              regex: kube-dns
              action: keep
            - source_labels: [__meta_kubernetes_pod_container_port_number]
              regex: "9153"
              action: keep
            - source_labels: [__meta_kubernetes_pod_name]
              target_label: k8s.pod.name
```

The Collector's service account needs `get`, `list` and `watch` on pods:

```yaml showLineNumbers title="rbac.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector-pods
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector-pods
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-collector-pods
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: observability
```

If you run CoreDNS from its Helm chart and use the Prometheus operator,
`prometheus.service.enabled` adds a metrics Service and
`prometheus.monitor.enabled` adds a ServiceMonitor. See
[Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) for
deploying the Collector.

### Runtime metrics

`prometheus` accepts a `runtime_metrics` option that adds the Go
`runtime/metrics` set, roughly 100 scalars and 8 histograms, including
CPU attribution and scheduler latency. It applies to the whole process
once any server block enables it, and stays on until restart. Leave it off
unless you are investigating CPU or scheduling.

### Environment Variables

```bash showLineNumbers title=".env"
COREDNS_HOST=coredns.internal
ENVIRONMENT=your_environment
SERVICE_NAME=coredns
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector, send a few queries, and check the endpoint:

```bash showLineNumbers title="Verify metrics collection"
# Send queries through CoreDNS
dig +short @"${COREDNS_HOST}" example.com
dig +short @"${COREDNS_HOST}" example.com

# Check the request and cache counters moved
curl -s "http://${COREDNS_HOST}:9153/metrics" | grep -E '^coredns_(dns_requests|cache_hits)_total'

# Check the Collector for scrape or export errors
docker logs otel-collector 2>&1 | grep -iE "error|coredns"
```

In Scout, check that `up` for the `coredns` job reads 1, then query
`coredns_dns_responses_total` by `zone` and `rcode`.

## Troubleshooting

### `up` reads 0 while CoreDNS answers queries

**Cause**: The `prometheus` plugin has no address, so it listens on
`localhost:9153` only.

**Look at**: `scrape_samples_scraped` (Diagnostic) reads 0 for the
`coredns` job, while `dig` against CoreDNS succeeds.

**Fix**: Set `prometheus 0.0.0.0:9153` in each server block and reload
CoreDNS.

### Metrics for one zone are missing

**Cause**: That server block has no `prometheus` line. The plugin is
configured per server block.

**Fix**: Add `prometheus 0.0.0.0:9153` to the block. Blocks can share the
same address.

### Upstream failures show as SERVFAIL but upstream latency looks normal

**Cause**: Upstream latency records only answered queries. A dead upstream
adds no samples.

**Look at**: `coredns_proxy_healthcheck_failures_total` by `to` and
`coredns_forward_healthcheck_broken_total`.

**Fix**: Enable `health_check` on `forward` if it is off, and alert on the
health metrics and the SERVFAIL ratio.

### Forward metrics moved

**Cause**: Current releases record `forward` requests, response codes and
latency in `coredns_proxy_request_duration_seconds{proxy_name="forward"}`.
`coredns_forward_requests_total`, `coredns_forward_responses_total` and
`coredns_forward_request_duration_seconds` are no longer emitted.

**Fix**: Update queries:

- Requests per upstream:
  `sum by (to) (rate(coredns_proxy_request_duration_seconds_count{proxy_name="forward"}[5m]))`.
- Responses by code: group the same `_count` by `to` and `rcode`.
- Latency: use the histogram buckets of
  `coredns_proxy_request_duration_seconds`.

### NXDOMAIN rate is high on Kubernetes

**Cause**: Pods resolve short names through the search path, so each
lookup tries several suffixes before the right one. Most of those return
NXDOMAIN.

**Fix**: Leave NXDOMAIN out of alerts. To reduce the traffic, use fully
qualified names with a trailing dot in workloads, or lower `ndots` in the
pod's `dnsConfig`.

### Metrics stop after a Corefile change

**Cause**: A reload failed. CoreDNS keeps serving DNS with the previous
config, but the metrics handler stays down until a reload succeeds or
CoreDNS restarts.

**Look at**: `up` for the instance, and `coredns_reload_failed_total`
once metrics return.

**Fix**: Check the CoreDNS log for the reload error, fix the Corefile, and
reload or restart.

## FAQ

### Does this work for CoreDNS as cluster DNS?

Yes. The metrics are the same, plus the `kubernetes` plugin families.
Scrape the pods with the `k8s-app=kube-dns` label, as in
[Scraping cluster DNS on Kubernetes](#scraping-cluster-dns-on-kubernetes).

### Why does the `plugin` label read `errors`?

The label names the plugin that wrote the response to the client. The
`errors` plugin wraps the response writer, so when it is in the block it
is reported for most answers. Do not use the label to tell which plugin
resolved a query.

### Should I alert on NXDOMAIN?

No. NXDOMAIN is the normal answer for missing names, and Kubernetes search
paths produce a lot of it. Alert on the SERVFAIL ratio.

### Can several server blocks share port 9153?

Yes. Each block needs its own `prometheus` line, and they can all use
`0.0.0.0:9153`.

### How do I monitor several CoreDNS instances?

Scrape each instance directly. Each is identified by its `instance` label
and by `version` on `coredns_build_info`.

## Related Guides

- [etcd Monitoring](./etcd.md) - Key-value store that also backs
  CoreDNS's `etcd` plugin.
- [Consul Monitoring](./consul.md) - Service discovery with its own DNS
  interface.
- [K8s Cluster Monitoring](./k8s-cluster.md) - Cluster-level Kubernetes
  metrics.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on CoreDNS metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [K8s Cluster](./k8s-cluster.md) and the upstream resolvers CoreDNS
  forwards to.
- **Fine-tune Collection**: Adjust the `scrape_interval` to your traffic,
  and enable `health_check` on every `forward` block.
