---
title: NGINX Web Server Monitoring with OpenTelemetry
sidebar_label: NGINX
sidebar_position: 7
description:
  Monitor NGINX with OpenTelemetry. Collect traces, metrics, and logs from NGINX
  web server with OTel module and Prometheus exporter using Scout.
keywords:
  [
    nginx monitoring,
    nginx metrics,
    nginx traces,
    opentelemetry nginx,
    nginx observability,
  ]
---

# NGINX

## Overview

This guide will walk you through collecting rich telemetry data from your nginx
server using `nginx-module-otel` module and we'll use prometheus nginx exporter
to collect metrics.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

## Prerequisites

- NGINX Server installed.

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

Now we have successfully implemented nginx with OpenTelemetry instrumentation.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) - Set up
  collector for local development
- [RabbitMQ Monitoring](./rabbitmq.md) - Alternative service monitoring guide
