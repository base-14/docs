---
title: >
  Varnish OpenTelemetry Monitoring - Cache Hit Ratio, Backend Health,
  and Collector Setup
sidebar_label: Varnish
id: collecting-varnish-telemetry
sidebar_position: 42
description: >
  Collect Varnish metrics with the OpenTelemetry Collector. Monitor
  cache hit ratio, backend health, and thread-pool saturation, and ship
  to base14 Scout.
keywords:
  - varnish opentelemetry
  - varnish otel collector
  - varnish metrics monitoring
  - varnish cache monitoring
  - opentelemetry prometheus receiver varnish
  - varnish observability
  - varnish performance monitoring
  - varnish telemetry collection
---

# Varnish

The OpenTelemetry Collector scrapes a `prometheus_varnish_exporter`
sidecar to collect 190+ Varnish metrics - cache hit/miss ratios, backend
health, thread-pool saturation, and storage usage - from Varnish 6.0+.
Varnish keeps statistics in shared memory (VSM) with
no HTTP endpoint, so the exporter is required to expose them in
Prometheus format on port 9131. This guide configures the exporter and
receiver and ships metrics to base14 Scout.

## Prerequisites

| Requirement                 | Minimum | Recommended |
| --------------------------- | ------- | ----------- |
| Varnish                     | 6.0     | 9.0         |
| prometheus_varnish_exporter | 1.6     | 1.6.1       |
| OTel Collector Contrib      | 0.90.0  | 0.153.0     |
| base14 Scout                | Any     | -           |

Before starting:

- Varnish must be running with a configured backend.
- The exporter needs read access to Varnish shared memory (VSM). In
  Docker this means sharing a volume at `/var/lib/varnish`.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

:::warning Upgrading?
Bumping the Varnish image also requires rebuilding the exporter from a
matching `varnish:<version>` base. The exporter's bundled `varnishstat`
must match the server's major version, or the `varnish_version` metric
mislabels the server and a cross-major VSM read is unsupported. Full
notes: [Updates & Upgrades](#updates--upgrades).
:::

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `varnish_up` | Scrape succeeded - monitoring itself is alive. |
| `varnish_main_uptime`, `varnish_mgt_uptime` | Child and manager uptime; a reset flags a child restart or panic. |
| `varnish_main_client_req` | Request throughput. |
| `varnish_main_cache_hit`, `varnish_main_cache_miss` | The hit ratio `hit / (hit + miss)` - the primary efficiency KPI. |
| `varnish_backend_up`, `varnish_backend_happy` | Origin reachability and health-probe state. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Client errors | `varnish_main_client_req_400`, `_client_req_417`, `_client_resp_500`, `_req_dropped`, `_req_reset`, `varnish_main_sc_*` | Error and abuse rate; dropped or reset requests. |
| Origin health | `varnish_backend_fail` (+ `_econnrefused` / `_etimedout` / ...), `varnish_backend_busy`, `varnish_main_backend_retry` / `_reuse` / `_wait_fail` | Origin failures by cause; connection-pool strain. |
| Connections | `varnish_main_sessions`, `varnish_main_sessions_total` | Accepted-connection load; a fall or stall signals accept-queue or fd saturation. |
| Thread saturation | `varnish_main_threads`, `_threads_failed`, `_threads_limited`, `varnish_main_thread_queue_len`, `varnish_main_ws_*_overflow` | Worker-pool backlog; a queue above zero means requests are waiting. |
| Cache pressure | `varnish_sma_g_bytes`, `varnish_sma_g_space`, `varnish_sma_c_fail`, `varnish_main_n_lru_nuked`, `_n_lru_limited`, `varnish_main_cache_hitpass` | Storage fill and evictions; cacheability problems. |
| Bandwidth | `varnish_main_s_resp_bodybytes`, `_s_req_bodybytes`, `varnish_backend_beresp_bodybytes` | Traffic volume served and fetched. |

Request latency is not in this set - `varnishstat` exposes counters and
gauges only. Per-request timing lives in the Varnish log (VSL) / access
logs or your trace path, not in these metrics.

### Diagnostic - for investigation and tuning

Higher cardinality; enable on demand. In production you can drop this
tier with `metric_relabel_configs` and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Memory pools | `varnish_mempool_*` (incl. native-TLS `ssl_buf*` pools) | Pool sizing and allocation churn. |
| Lock contention | `varnish_lck_*`, `varnish_lock_*` | Contention at high concurrency. |
| SHM log pressure | `varnish_main_shm_*` | High `shm_cycles` / `shm_cont` means log overrun starving `varnishlog`. |
| Object accounting | `varnish_main_n_object`, `_n_objecthead`, `_n_objectcore`, `_n_superseded` | Cache composition. |
| Invalidation | `varnish_main_bans_*` | Ban-lurker contention and persisted ban bytes. |
| Workload internals | `varnish_main_esi_*`, `_n_gzip` / `_n_gunzip`, `varnish_backend_pipe_*`, `varnish_main_hcb_*` | ESI, compression, pipe, and hash internals. |
| New since 7.6 (added 8.0) | `varnish_main_transit_buffered` / `_stored`, `varnish_main_http1_absolute_form`, `varnish_main_vcp_ref_hit` / `_miss` | Transit-buffer usage, HTTP/1 absolute-form requests, backend connection-pool reuse. |

Full metric list:
[prometheus_varnish_exporter](https://github.com/jonnenauha/prometheus_varnish_exporter),
or run `curl -s http://localhost:9131/metrics` against the exporter.

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. These
are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `cache_hit / (cache_hit + cache_miss)` | < 0.80 | < 0.50 | A falling hit ratio shifts load to origin; check TTLs, `Vary`, and `cache_hitpass`. |
| `varnish_backend_up` (per backend) | Any backend down | All backends down | Origin unreachable; inspect the `backend_fail` cause breakdown and origin health. |
| `rate(varnish_backend_fail)` | > 0 sustained | Rising across scrapes | Backend connection failures; check `_econnrefused` / `_etimedout` and origin capacity. |
| `varnish_main_thread_queue_len` | > 0 sustained | Growing | Requests waiting on workers; raise `thread_pool_max` or shed load. |
| `varnish_main_threads_limited` | > 0 | Sustained > 0 | The worker pool hit its ceiling; raise thread-pool limits. |
| `varnish_sma_g_space` (free) | < 20% of total | < 5% of total | Storage is filling; evictions (`n_lru_nuked`) follow. Add storage or tune TTLs. |

## Access Setup

Varnish does not expose Prometheus metrics natively. Run the
`prometheus_varnish_exporter` as a sidecar that reads Varnish shared
memory (VSM).

**Docker setup** - build a custom exporter image (the project does not
publish one) on a `varnish` base that matches your server, and share a
volume at `/var/lib/varnish`:

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
services:
  varnish:
    image: varnish:9.0
    volumes:
      - varnish-data:/var/lib/varnish

  varnish-exporter:
    build: ./exporter
    volumes:
      - varnish-data:/var/lib/varnish:ro
    ports:
      - "9131:9131"
    depends_on:
      varnish:
        condition: service_healthy

volumes:
  varnish-data:
```

The exporter Dockerfile builds the binary, then runs it on a
`varnish:9.0` base so the bundled `varnishstat` matches the server:

```dockerfile showLineNumbers title="exporter/Dockerfile"
FROM golang:1.22-bookworm AS builder
ARG EXPORTER_VERSION=1.6.1
RUN git clone --depth 1 --branch ${EXPORTER_VERSION} \
    https://github.com/jonnenauha/prometheus_varnish_exporter.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -o /prometheus_varnish_exporter .

FROM varnish:9.0
COPY --from=builder /prometheus_varnish_exporter /usr/local/bin/prometheus_varnish_exporter
EXPOSE 9131
ENTRYPOINT ["prometheus_varnish_exporter"]
```

**Bare-metal setup** - install the exporter binary and run it on the
same host as Varnish:

```bash showLineNumbers title="Install exporter"
curl -LO https://github.com/jonnenauha/prometheus_varnish_exporter/releases/latest/download/prometheus_varnish_exporter-linux-amd64.tar.gz
tar xzf prometheus_varnish_exporter-linux-amd64.tar.gz
./prometheus_varnish_exporter
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Varnish is running
varnishadm status

# Verify exporter metrics endpoint
curl -s http://localhost:9131/metrics | head -20
```

### VCL Configuration

Varnish needs a backend to serve traffic. A minimal `vcl 4.1` config
(valid since Varnish 6.0, unchanged on 9.0):

```text showLineNumbers title="config/default.vcl"
vcl 4.1;

backend default {
    .host = "backend";   # Your backend hostname or IP
    .port = "80";
}
```

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: varnish
          scrape_interval: 30s
          static_configs:
            - targets:
                - ${env:VARNISH_EXPORTER_HOST}:9131

processors:
  resource:
    attributes:
      - key: deployment.environment.name
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

To control metric volume in production, drop the Diagnostic tier with a
`metric_relabel_configs` block on the scrape config while keeping the
Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
VARNISH_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped Varnish metrics
docker logs otel-collector 2>&1 | grep -i "varnish"

# Verify the exporter is serving metrics
curl -s http://localhost:9131/metrics | grep varnish_main

# Generate cache traffic (first request misses, the rest hit)
curl -s http://localhost:6081/ > /dev/null
```

## Troubleshooting

### Exporter returns no Varnish metrics

**Cause**: The exporter cannot read Varnish shared memory (VSM).

**Fix**:

1. In Docker, verify both containers share the `/var/lib/varnish`
   volume. The Varnish container needs `:rw`, the exporter can use `:ro`.
2. On bare metal, verify the exporter process has read access to
   `/var/lib/varnish`.
3. Check the exporter logs for VSM access errors.

### `varnish_version` reports the wrong version after an upgrade

**Cause**: The exporter image was built on an older `varnish` base than
the running server, so its bundled `varnishstat` mislabels the server.

**Look at**: `varnish_version` - the reported version is the exporter's
binary, not the server.

**Fix**: Rebuild the exporter from a `varnish:<version>` base that
matches the server's major version (see [Updates &
Upgrades](#updates--upgrades)), then redeploy.

### Requests are slow or piling up

**Cause**: The worker pool is saturated, or the origin is slow.

**Look at**: `varnish_main_thread_queue_len` (requests waiting) and
`varnish_main_threads_limited` (pool hit its ceiling); on the origin
side, `varnish_backend_busy` and the `varnish_backend_fail` breakdown.

**Fix**:

1. Raise `thread_pool_max` or add Varnish capacity if the queue is
   sustained.
2. Investigate origin latency and capacity if backend metrics climb.

### `varnishlog` drops records or CPU spikes at high concurrency

**Cause**: Shared-memory log overrun or lock contention under load.

**Look at**: the Diagnostic `varnish_main_shm_*` series - rising
`shm_cycles` / `shm_cont` means the SHM log is cycling faster than
`varnishlog` can drain it. `varnish_lck_*` / `varnish_lock_*` surface
lock contention that shows up as CPU at high concurrency.

**Fix**:

1. Reduce VSL consumers or raise the VSL buffer if `shm_*` climbs.
2. Profile the lock classes in `varnish_lck_*` if contention persists.

### Cache hit metrics showing zero

**Cause**: No traffic has passed through Varnish.

**Fix**:

1. Send requests through Varnish: `curl http://localhost:6081/`.
2. Cache hit metrics only populate after Varnish processes requests.
3. The first request is always a miss - repeat to see hits.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## Updates & Upgrades

### Varnish version changes

- **7.6 → 9.0**: +37 counters, none removed or renamed - the upgrade is
  purely additive for coverage, and the whitelist-free exporter surfaces
  the new counters automatically. New named counters (added in Varnish
  8.0): `transit_stored` / `transit_buffered` (uncacheable-body bytes
  and transit-buffer usage), `VCP.ref_hit` / `ref_miss` (backend
  connection-pool reuse), and `http1_absolute_form` (HTTP/1
  absolute-form request targets). Native-TLS memory pools (`ssl_buf*`)
  and new lock classes surface as new label values on existing
  `varnish_mempool_*` and `varnish_lck_*` series. **You must rebuild the
  exporter from a matching `varnish:<version>` base** - its bundled
  `varnishstat` must match the server's major version, or
  `varnish_version` mislabels the server. _(additive; exporter rebuild
  required)_

### Collector / receiver changes

- This guide uses the **prometheus receiver**, which has no
  receiver-key rename across the supported Collector range, so the
  Collector config is stable on an image bump. Pin both the exporter and
  Collector image tags; an exporter built on a stale `varnish` base
  mislabels `varnish_version` even when counters still read.
  _(no breaking change on the Prometheus path)_

## FAQ

**Why do I need a separate exporter?**

Varnish stores statistics in shared memory (VSM), not over HTTP. The
`prometheus_varnish_exporter` reads VSM counters and translates them to
Prometheus format. Varnish has no built-in Prometheus or OpenTelemetry
endpoint.

**Does this work in Kubernetes?**

Yes. Run the exporter as a sidecar container in the same pod as Varnish,
sharing an `emptyDir` volume at `/var/lib/varnish`. The Collector
scrapes the exporter sidecar.

**How do I monitor multiple Varnish instances?**

Deploy an exporter sidecar per Varnish instance, each on a different
port, and add all of them to the scrape targets:

```yaml showLineNumbers title="config/otel-collector.yaml (multi-instance)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: varnish
          static_configs:
            - targets:
                - varnish-exporter-1:9131
                - varnish-exporter-2:9131
```

Each instance is identified by its `instance` label.

**What does `varnish_main_cache_hit` vs `varnish_main_cache_hitpass` mean?**

`cache_hit` is a normal cache hit - the response was served from cache.
`cache_hitpass` means Varnish remembered that a previous request for this
object was uncacheable, so it passed directly to the backend without a
cache lookup. Monitor `cache_hit / (cache_hit + cache_miss)` for overall
efficiency.

**Why is request latency missing from the metrics?**

`varnishstat` exposes counters and gauges only, so per-request timing is
not in this metric surface. It lives in the Varnish log (VSL) / access
logs or your trace path.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Varnish metrics.
- [NGINX Monitoring](./nginx.md) - A common companion web server.
- [Caddy Monitoring](./caddy.md) - A common companion web server.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [NGINX](./nginx.md), [Caddy](./caddy.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with
  `metric_relabel_configs` to control volume; keep it available for
  incident investigation.
