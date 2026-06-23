---
title: >
  NGINX OpenTelemetry Monitoring - Request Rate, Connection Saturation,
  and Collector Setup
sidebar_label: NGINX
id: collecting-nginx-telemetry
sidebar_position: 7
description: >
  Collect NGINX metrics, traces, and logs with the OpenTelemetry Collector.
  Monitor request rate, connection saturation, and dropped connections from
  stub_status and ship to base14 Scout.
keywords:
  - nginx opentelemetry
  - nginx otel collector
  - nginx metrics monitoring
  - nginx performance monitoring
  - opentelemetry nginx receiver
  - nginx traces opentelemetry
  - nginx observability
  - monitor nginx kubernetes
  - nginx telemetry collection
---

# NGINX

Open-source (OSS) NGINX exposes a small set of connection and request counters
through its `stub_status` module - and nothing else over HTTP. The
`nginx-prometheus-exporter` scrapes `stub_status` and publishes 9 NGINX series
plus `up` in Prometheus format on port 9113; the Collector's native
`prometheus` receiver scrapes the exporter. This covers throughput,
connections, and saturation on NGINX 1.19+. Because `stub_status` has no error
or latency data, this guide also wires `nginx-module-otel` for distributed
traces and the `filelog` receiver for access and error logs - the three signals
together give you RED-complete coverage in base14 Scout.

## Prerequisites

| Requirement               | Minimum | Recommended      |
| ------------------------- | ------- | ---------------- |
| NGINX                     | 1.19    | 1.24+ (1.27.5)   |
| nginx-prometheus-exporter | 1.5.1   | 1.5.1            |
| OTel Collector Contrib    | 0.90.0  | 0.153.0          |
| base14 Scout              | Any     | -                |

Before starting:

- NGINX 1.19+ running and reachable from the host running the exporter.
- The `stub_status` module enabled on a status `server` block (see Access
  Setup). It ships in the standard NGINX build.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core always,
alert on Operational, and reach for Diagnostic during an incident or capacity
review. Exactly 9 `nginx_*` series plus `up` describe NGINX itself; the exporter
also emits its own runtime self-telemetry, grouped into Diagnostic.

`stub_status` is a connection-and-request-count endpoint only. It exposes **no
HTTP status codes, no error rate, and no request latency**. RED's "Errors" and
"Duration" are therefore not available from OSS NGINX metrics - they come from
the access logs (the `filelog` path below) or traces (`nginx-module-otel`). The
tiers here cover throughput, connections, and saturation; for error and latency
monitoring, use the logs and traces sections.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `up` | Prometheus target health - the Collector reached the exporter on `:9113`. |
| `nginx_up` | The exporter reached NGINX's `stub_status` (`1` = NGINX reachable). A distinct liveness layer from `up`. |
| `nginx_http_requests_total` | Total HTTP requests served; the rate is the throughput KPI. |
| `nginx_connections_active` | Active client connections - current load and concurrency. |

Core carries **two liveness layers**, and they are different signals. `up`
tells you the Collector reached the exporter (the Prometheus scrape succeeded).
`nginx_up` tells you the exporter then reached NGINX's `stub_status`. `up == 1`
with `nginx_up == 0` means monitoring is healthy but NGINX (or the status
endpoint) is not - watch both.

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `nginx_connections_accepted` | Accepted client connections (cumulative). |
| `nginx_connections_handled` | Handled client connections. A rising `accepted - handled` gap means NGINX is dropping connections - the worker limit is hit. |
| `nginx_connections_waiting` | Idle keep-alive connections waiting for a request. |

The headline NGINX saturation signal lives here: when
`rate(nginx_connections_accepted)` outpaces `rate(nginx_connections_handled)`,
connections are being dropped because `worker_connections` /
`worker_rlimit_nofile` is exhausted.

### Diagnostic - for investigation and tuning

Higher cardinality or exporter-internal context; reach for these during an
incident rather than paging on them.

| Metric | When you reach for it |
|---|---|
| `nginx_connections_reading` | Connections reading the request header - useful when diagnosing slow-client or header-parsing stalls. |
| `nginx_connections_writing` | Connections writing the response - rises when downstream or clients are slow to drain responses. |
| `nginx_exporter_build_info` | Exporter build/version labels (info metric, always `1`); confirm which exporter version is running. |
| `go_*`, `process_*`, `promhttp_*`, `scrape_*` | Exporter self-telemetry (Go runtime, exporter process, scrape meta). These describe the exporter, not NGINX - pull them when debugging the exporter itself. |

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These are
starting points; tune them to your workload. All are relative to your own
baseline rather than fixed absolutes.

| Alert | Threshold | Why it matters |
|---|---|---|
| NGINX unreachable | `nginx_up == 0` for > 1m | The exporter cannot read `stub_status` - NGINX is down, the status endpoint moved, or an `allow` / `deny` is blocking it. Check NGINX and the scrape URI. |
| Exporter / scrape down | `up == 0` for > 1m | The Collector cannot reach the exporter on `:9113` - exporter down or a network issue. Check the exporter process. |
| Dropped connections | `rate(nginx_connections_accepted) - rate(nginx_connections_handled) > 0` | NGINX is dropping accepted connections - `worker_connections` / `worker_rlimit_nofile` exhausted. Raise the limits or add capacity. This is the headline saturation alert. |
| Request-rate anomaly | `rate(nginx_http_requests_total)` deviating sharply from baseline | A drop signals an upstream or routing failure; a spike signals a load event. Correlate with connections and access logs. |
| Connection saturation | `nginx_connections_active` rising toward `worker_connections × worker_processes` | Approaching the connection ceiling; new connections will be dropped. Add workers or capacity. |

## Access Setup

OSS NGINX does not expose Prometheus metrics natively. Enable `stub_status` on a
status `server` block, then run the `nginx-prometheus-exporter`, which scrapes
that endpoint and publishes Prometheus metrics on `:9113`.

### Step 1: Enable `stub_status`

Add the following `server` block **inside** the `http` block of your
`nginx.conf`:

```conf showLineNumbers title="nginx.conf"
http {
    # ... your existing config ...

    server {
        listen       8080;
        server_name  localhost;

        location /status {
            stub_status;
            allow 127.0.0.1;
            deny all;
        }
    }
}
```

:::warning

The `server` block **must** be placed inside the `http` block. Placing it
outside results in: `"server" directive is not allowed here`.

:::

Test and reload NGINX, then confirm the endpoint responds:

```bash showLineNumbers
sudo nginx -t && sudo systemctl reload nginx
curl http://127.0.0.1:8080/status
```

### Step 2: Run the nginx-prometheus-exporter

Point the exporter at the `stub_status` URI with `--nginx.scrape-uri`. It serves
Prometheus metrics on `:9113/metrics`.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker run -d --name nginx-prometheus-exporter \
  --network=host \
  nginx/nginx-prometheus-exporter:1.5.1 \
  --nginx.scrape-uri=http://127.0.0.1:8080/status
```

```mdx-code-block
</TabItem>
<TabItem value="binary" label="Binary / systemd">
```

Download the exporter from the
[nginx-prometheus-exporter releases page](https://github.com/nginx/nginx-prometheus-exporter/releases)
(swap `amd64` for `arm64` on ARM hosts):

```bash showLineNumbers
curl -LO https://github.com/nginx/nginx-prometheus-exporter/releases/download/v1.5.1/nginx-prometheus-exporter_1.5.1_linux_amd64.tar.gz
tar xzf nginx-prometheus-exporter_1.5.1_linux_amd64.tar.gz
sudo mv nginx-prometheus-exporter /usr/local/bin/
```

Create and start a systemd service:

```bash showLineNumbers title="/etc/systemd/system/nginx-prometheus-exporter.service"
sudo tee /etc/systemd/system/nginx-prometheus-exporter.service > /dev/null <<'EOF'
[Unit]
Description=Nginx Prometheus Exporter
After=network.target nginx.service

[Service]
Type=simple
ExecStart=/usr/local/bin/nginx-prometheus-exporter --nginx.scrape-uri=http://127.0.0.1:8080/status
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now nginx-prometheus-exporter
```

```mdx-code-block
</TabItem>
</Tabs>
```

Verify the exporter is serving metrics:

```bash showLineNumbers
curl http://127.0.0.1:9113/metrics
```

## Configuration

The Collector scrapes the exporter with the native `prometheus` receiver. The
receiver supplies `up` (target health) for free.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nginx
          scrape_interval: 5s
          metrics_path: /metrics
          static_configs:
            - targets: ["${env:NGINX_EXPORTER_HOST}:9113"]   # exporter address

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

> **Semconv version note**: `deployment.environment.name` is the current OTel
> attribute (semantic conventions v1.27+, stable in v1.41.0). The legacy
> `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
NGINX_EXPORTER_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Collecting traces

`stub_status` has no latency data, so distributed traces are how you get
per-request timing and upstream propagation. `nginx-module-otel` emits spans
straight from NGINX.

### Step 1: Install the NGINX OTel module

Download and install the pre-built `.deb` package from the
[nginx-otel-build releases](https://github.com/base-14/nginx-otel-build/releases/tag/v0.1.1)
(swap `amd64` for `arm64` on ARM hosts):

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="Ubuntu 24.04 amd64">
```

```bash showLineNumbers
curl -LO https://github.com/base-14/nginx-otel-build/releases/download/v0.1.1/ubuntu24.04-nginx1.24.0-amd64.deb
sudo apt install ./ubuntu24.04-nginx1.24.0-amd64.deb
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="Ubuntu 24.04 arm64">
```

```bash showLineNumbers
curl -LO https://github.com/base-14/nginx-otel-build/releases/download/v0.1.1/ubuntu24.04-nginx1.24.0-arm64.deb
sudo apt install ./ubuntu24.04-nginx1.24.0-arm64.deb
```

```mdx-code-block
</TabItem>
</Tabs>
```

:::warning

Take a backup of your NGINX config before installing the module. It may be
overwritten by the module installation.

:::

### Step 2: Configure NGINX to send traces

Add the following to your `nginx.conf`:

```conf showLineNumbers title="nginx.conf"
load_module modules/ngx_otel_module.so;

http {
    otel_exporter {
        endpoint 0.0.0.0:4317;
    }
    otel_service_name nginx;
    otel_resource_attr environment <deployment-environment>;
    otel_trace on;
    otel_trace_context inject;
}
```

> Note: replace `otel_service_name` and `otel_resource_attr` with your actual
> values. The endpoint points at the Collector's gRPC port (4317).

Reload NGINX and traces will flow to the Scout Collector.

## Collecting logs

The access log is where the error rate and per-request detail that `stub_status`
omits actually live. Read NGINX's log files with the `filelog` receiver.

### Step 1: Add the filelog receiver

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  filelog/nginx:
    include:
      - /var/log/nginx/*.log
    start_at: beginning
```

> Note: if you write logs to a custom directory, update the `include` block with
> the correct path. Add `filelog/nginx` to the `logs` pipeline as well.

:::note

The OTel Collector process needs read access to the NGINX log files. If you see
permission errors, add the `otelcol-contrib` user to the group that owns the log
files:

```bash
sudo usermod -aG <log-file-group> otelcol-contrib
```

Replace `<log-file-group>` with the group that owns your NGINX log directory
(commonly `adm` or `www-data`). Restart the Collector after this change.

:::

## Verify the Setup

Start the Collector and confirm each signal within 60 seconds:

```bash showLineNumbers
# Exporter is serving NGINX metrics
curl -s http://127.0.0.1:9113/metrics | grep nginx_

# stub_status is responding
curl http://127.0.0.1:8080/status

# Collector picked up nginx metrics
docker logs otel-collector 2>&1 | grep -i "nginx"

# Generate traffic so the request and connection counters advance
curl -s http://127.0.0.1:80/ > /dev/null
```

## Troubleshooting

### stub_status returns 403 Forbidden

**Cause**: The `allow` directive in the status `location` block restricts
access.

**Fix**:

1. Add the exporter's IP to the `allow` list in the `location /status` block.
2. For Docker setups, add the container network CIDR
   (e.g., `allow 172.16.0.0/12;`).
3. Reload NGINX: `sudo nginx -t && sudo systemctl reload nginx`.

### `nginx_up` is 0 (no metrics on port 9113)

**Cause**: The exporter is running but cannot reach the `stub_status` endpoint,
or the exporter is not running at all.

**Look at**: `nginx_up` (the exporter-to-NGINX liveness layer) versus `up` (the
Collector-to-exporter layer). `up == 1, nginx_up == 0` isolates the problem to
the exporter-to-NGINX hop.

**Fix**:

1. Check the exporter is up: `systemctl status nginx-prometheus-exporter` or
   `docker ps | grep exporter`.
2. Verify `stub_status` is accessible:
   `curl http://127.0.0.1:8080/status`.
3. Confirm the exporter's `--nginx.scrape-uri` matches the status endpoint and
   check the exporter logs for connection errors.

### Connections are being dropped under load

**Cause**: NGINX is accepting more connections than its workers can handle - the
`worker_connections` / `worker_rlimit_nofile` ceiling is hit.

**Look at**: the `accepted - handled` gap from `nginx_connections_accepted` and
`nginx_connections_handled`; `nginx_connections_active` rising toward
`worker_connections × worker_processes`; and the Diagnostic
`nginx_connections_reading` / `nginx_connections_writing` split to see whether
slow request reads or slow response writes dominate.

**Fix**:

1. Raise `worker_connections` and `worker_rlimit_nofile`, or add
   `worker_processes` / capacity, if the accepted-handled gap is sustained.
2. If `nginx_connections_writing` dominates, investigate slow clients and
   downstream latency.

### No error rate or latency in the metrics

**Cause**: This is expected. `stub_status` exposes only connection and request
counts - it has no status codes, error rate, or latency.

**Fix**:

1. Use the access logs (the `filelog` path) for status codes and error rate.
2. Use traces (`nginx-module-otel`) for per-request latency and upstream
   propagation.

### Traces not appearing in Scout

**Cause**: The OTel module is not loaded, or the exporter endpoint is wrong.

**Fix**:

1. Verify the module is loaded: `nginx -V 2>&1 | grep otel`.
2. Confirm `otel_exporter endpoint` points at the Collector's gRPC port (4317).
3. Check Collector logs for incoming trace data:
   `docker logs otel-collector 2>&1 | grep traces`.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Why are there three separate collection methods?**

OSS NGINX does not expose all telemetry through a single interface. Metrics come
from `stub_status` via the exporter, traces require `nginx-module-otel`, and
logs are read from files. Each needs its own receiver in the Collector pipeline.
Together they give you the throughput and saturation that metrics cover, plus
the error rate and latency that only logs and traces can.

**Why is there no error-rate or latency metric?**

`stub_status` is a connection-and-request-count endpoint - it has no HTTP status
codes, no error rate, and no request latency. That is a limitation of the OSS
status surface, not the exporter. Use the access logs (`filelog`) for error rate
and traces (`nginx-module-otel`) for latency.

**Can I use NGINX Plus instead of open-source NGINX?**

Yes. NGINX Plus provides a richer metrics API at `/api/` that includes
per-upstream, per-zone, and response-code data - including the error rate and
latency that `stub_status` lacks. The same `nginx-prometheus-exporter` has an
NGINX Plus mode: point it at the Plus `/api/` endpoint and it exposes those
richer metrics (prefixed `nginxplus_*`), which you scrape with the same
`prometheus` receiver shown above.

**Does this work with NGINX running in Kubernetes?**

Yes. Deploy the `nginx-prometheus-exporter` as a sidecar container in the NGINX
pod and point the Collector's Prometheus scrape config at the sidecar. For
traces, include `nginx-module-otel` in your NGINX container image.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on NGINX metrics.
- [Apache HTTP Server Monitoring](./apache-httpd.md) - Another worker-pool web
  server to watch the same way.
- [Caddy Monitoring](./caddy.md) - A web server you may run alongside or behind
  NGINX.
- [HAProxy Monitoring](./haproxy.md) - The load balancer in front of an NGINX
  pool.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Apache HTTP Server](./apache-httpd.md), [HAProxy](./haproxy.md), and other
  components.
- **Fine-tune Collection**: Adjust the scrape interval to balance metric
  freshness against load.
