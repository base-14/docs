---
title: >
  NGINX OpenTelemetry Monitoring — Request Rate, Connections,
  and Collector Setup
sidebar_label: NGINX
id: collecting-nginx-telemetry
sidebar_position: 7
description: >
  Collect NGINX metrics with OpenTelemetry. Monitor active connections,
  request rates, and worker states using the Prometheus exporter, traces
  via nginx-module-otel, and logs via filelog. Export to base14 Scout.
keywords:
  - nginx opentelemetry
  - nginx otel collector
  - nginx metrics monitoring
  - nginx performance monitoring
  - nginx traces opentelemetry
  - nginx observability
  - nginx web server monitoring
  - nginx telemetry collection
---

# NGINX

This guide collects metrics, traces, and logs from NGINX using three
approaches: the nginx-prometheus-exporter for `stub_status` metrics,
`nginx-module-otel` for distributed traces, and the filelog receiver
for access and error logs. All telemetry is shipped to base14 Scout
through the OTel Collector.

## Prerequisites

| Requirement                | Minimum | Recommended |
| -------------------------- | ------- | ----------- |
| NGINX                      | 1.19    | 1.24+       |
| nginx-prometheus-exporter  | 1.5.1   | latest      |
| OTel Collector Contrib     | 0.90.0  | latest      |
| base14 Scout               | Any     | —           |

Before starting:

- NGINX must be installed and running
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Metrics**: active connections, accepted/handled connections, request
  rate, reading/writing/waiting states
- **Traces**: distributed request traces with upstream propagation
- **Logs**: access logs and error logs

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

## Collecting metrics

### Step 1: Expose `stub_status` metrics from nginx

Add the following `server` block **inside** the `http` block of your `nginx.conf`:

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

The `server` block **must** be placed inside the `http` block.
Placing it outside will result in:
`"server" directive is not allowed here`

:::

Test and reload nginx:

```bash showLineNumbers
sudo nginx -t && sudo systemctl reload nginx
```

Verify the status endpoint is working:

```bash showLineNumbers
curl http://127.0.0.1:8080/status
```

### Step 2: Install and run the nginx prometheus exporter

Download the exporter from the [nginx-prometheus-exporter releases page](https://github.com/nginx/nginx-prometheus-exporter/releases).

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="Linux amd64">
```

```bash showLineNumbers
curl -LO https://github.com/nginx/nginx-prometheus-exporter/releases/download/v1.5.1/nginx-prometheus-exporter_1.5.1_linux_amd64.tar.gz
tar xzf nginx-prometheus-exporter_1.5.1_linux_amd64.tar.gz
sudo mv nginx-prometheus-exporter /usr/local/bin/
```

Create a systemd service to run the exporter:

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
```

Start the exporter:

```bash showLineNumbers
sudo systemctl daemon-reload
sudo systemctl enable --now nginx-prometheus-exporter
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="Linux arm64">
```

```bash showLineNumbers
curl -LO https://github.com/nginx/nginx-prometheus-exporter/releases/download/v1.5.1/nginx-prometheus-exporter_1.5.1_linux_arm64.tar.gz
tar xzf nginx-prometheus-exporter_1.5.1_linux_arm64.tar.gz
sudo mv nginx-prometheus-exporter /usr/local/bin/
```

Create a systemd service to run the exporter:

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
```

Start the exporter:

```bash showLineNumbers
sudo systemctl daemon-reload
sudo systemctl enable --now nginx-prometheus-exporter
```

```mdx-code-block
</TabItem>
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
</Tabs>
```

Verify metrics are being exported:

```bash showLineNumbers
curl http://127.0.0.1:9113/metrics
```

### Step 3: Add the following receiver in your Scout collector

```yaml showLineNumbers title="config/otel-collector.yaml"
prometheus/nginx:
  config:
    scrape_configs:
      - job_name: nginx
        scrape_interval: 5s
        metrics_path: /metrics
        static_configs:
          - targets: ["0.0.0.0:9113"]
```

> Note: Make sure you add `prometheus/nginx` to the receivers
> in your metrics pipeline as well.

Now the metrics are scraped from nginx.

## Collecting traces

### Step 1: Install the nginx OTel module

Download and install the pre-built `.deb` package from the [nginx-otel-build releases](https://github.com/base-14/nginx-otel-build/releases/tag/v0.1.1).

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

Take a backup of your nginx config before installing the module.
It might be overwritten by the module installation.

:::

### Step 2: Configure nginx to send traces

Add the following configs in your `nginx.conf` file:

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

> Note: replace `otel_service_name` and `otel_resource_attr` with actual values.

Now the traces will be sent to the Scout Collector.

## Collecting logs

### Step 1: Add the filelog receiver to collect the logs

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  filelog/nginx:
    include:
      - /var/log/nginx/*.log
    start_at: beginning
```

> Note: If you have configured log collection location to a custom directory,
> update the `include` block with the correct path.

## Verify the Setup

After configuring all three collection methods, verify each is working:

```bash showLineNumbers
# Check metrics are being scraped from the exporter
curl -s http://127.0.0.1:9113/metrics | head -10

# Check Collector logs for nginx metrics
docker logs otel-collector 2>&1 | grep -i "nginx"

# Verify stub_status is responding
curl http://127.0.0.1:8080/status
```

## Troubleshooting

### stub_status returns 403 Forbidden

**Cause**: The `allow` directive in the status location block restricts
access.

**Fix**:

1. Add the Collector's IP to the `allow` list in the `location /status`
   block
2. For Docker setups, add the container network CIDR
   (e.g., `allow 172.16.0.0/12;`)
3. Reload NGINX: `sudo nginx -t && sudo systemctl reload nginx`

### No metrics on port 9113

**Cause**: The nginx-prometheus-exporter is not running or cannot reach
the stub_status endpoint.

**Fix**:

1. Check exporter status: `systemctl status nginx-prometheus-exporter`
   or `docker ps | grep exporter`
2. Verify stub_status is accessible:
   `curl http://127.0.0.1:8080/status`
3. Check exporter logs for connection errors

### Traces not appearing in Scout

**Cause**: The OTel module is not loaded or the exporter endpoint is
wrong.

**Fix**:

1. Verify the module is loaded: `nginx -V 2>&1 | grep otel`
2. Confirm `otel_exporter endpoint` points to the Collector's gRPC port
   (4317)
3. Check Collector logs for incoming trace data:
   `docker logs otel-collector 2>&1 | grep traces`

## FAQ

**Does this work with NGINX running in Kubernetes?**

Yes. Deploy the nginx-prometheus-exporter as a sidecar container and
point the Collector's Prometheus scrape config at the sidecar. For
traces, include the OTel module in your NGINX container image.

**Can I use NGINX Plus instead of open-source NGINX?**

NGINX Plus provides a richer metrics API at `/api/`. Use the
`nginxplusreceiver` in OTel Collector Contrib instead of the Prometheus
exporter approach described here.

**Why are there three separate collection methods?**

NGINX does not expose all telemetry through a single interface. Metrics
come from `stub_status` via the exporter, traces require the OTel
module, and logs are read from files. Each requires its own receiver
in the Collector pipeline.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Apache HTTP Server](./apache-httpd.md), [HAProxy](./haproxy.md),
  and other components
- **Fine-tune Collection**: Adjust scrape intervals and log paths based
  on your deployment

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Apache HTTP Server Monitoring](./apache-httpd.md) — Alternative web
  server monitoring
- [HAProxy Monitoring](./haproxy.md) — Load balancer monitoring
