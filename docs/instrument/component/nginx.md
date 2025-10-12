---
date: 2025-06-24
id: nginx
title: NGINX Web Server Monitoring with OpenTelemetry | base14 Scout
description: Monitor NGINX with OpenTelemetry. Collect traces, metrics, and logs from NGINX web server with OTel module and Prometheus exporter using Scout.
keywords: [nginx monitoring, nginx metrics, nginx traces, opentelemetry nginx, nginx observability]
tags: [nginx]
sidebar_position: 2
---

## Overview

This guide will walk you through collecting rich telemetry data from your nginx server
using `nginx-module-otel` module and we'll use prometheus nginx
exporter to collect metrics.

## Prerequisties

- NGINX Server installed.

## Collecting metrics

### Step 1: expose `stub_status` metrics from nginx

In your Nginx config add the following config

```conf
server {
    listen       80;
    server_name  localhost;

    location /status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}
```

### Step 2: Run the nginx prometheus exporter using docker

```shell
docker run --network=host nginx/nginx-prometheus-exporter:1.4.2 \
  --nginx.scrape-uri=http://localhost/status
```

### Step 3: Add the following receiver in your Scout collect

```yaml
 prometheus/nginx:
  config:
    scrape_configs:
    - job_name: nginx
      scrape_interval: 5s
      metrics_path: /metrics
      static_configs:
      - targets: ['0.0.0.0:9113']
```

> Note: Make sure you use in the pipelines as well.

Great work, Now the metrics are scraped from the nginx

## Collecting traces

### Step 1: Add the nginx repositoring

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="debian" label="Debian">
```

Install the prerequisites:

```bash
sudo apt install curl gnupg2 ca-certificates lsb-release debian-archive-keyring
```

Import an official nginx signing key so apt could verify the packages
authenticity. Fetch the key:

```bash
curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor \
    | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null
```

Verify that the downloaded file contains the proper key:

```bash
gpg --dry-run --quiet --no-keyring --import --import-options import-show /usr/share/keyrings/nginx-archive-keyring.gpg
```

To set up the apt repository for stable nginx packages, run the following command:

```bash
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
http://nginx.org/packages/debian `lsb_release -cs` nginx" \
    | sudo tee /etc/apt/sources.list.d/nginx.list
```

```mdx-code-block
</TabItem>
<TabItem value="ubuntu" label="Ubuntu">
```

Install the prerequisites:

```bash
sudo apt install curl gnupg2 ca-certificates lsb-release ubuntu-keyring
```

Import an official nginx signing key so apt could verify the packages
authenticity. Fetch the key:

```bash
curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor \
    | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null
```

Verify that the downloaded file contains the proper key:

```bash
gpg --dry-run --quiet --no-keyring --import --import-options import-show /usr/share/keyrings/nginx-archive-keyring.gpg
```

To set up the apt repository for stable nginx packages, run the following command:

```bash
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] \
http://nginx.org/packages/ubuntu `lsb_release -cs` nginx" \
    | sudo tee /etc/apt/sources.list.d/nginx.list
```

```mdx-code-block
</TabItem>
<TabItem value="alphine" label="Alphine">
```

Install the prerequisites:

```bash
sudo apk add openssl curl ca-certificates
```

To set up the apk repository for stable nginx packages, run the following command:

```bash
printf "%s%s%s%s\n" \
    "@nginx " \
    "http://nginx.org/packages/alpine/v" \
    `egrep -o '^[0-9]+\.[0-9]+' /etc/alpine-release` \
    "/main" \
    | sudo tee -a /etc/apk/repositories
```

```mdx-code-block
</TabItem>
<TabItem value="amazon linux" label="Amazon Linux">
```

Install the prerequisites:

```bash
sudo yum install yum-utils
```

To set up the yum repository for Amazon Linux 2, create the
file named `/etc/yum.repos.d/nginx.repo` with the following contents:

```text
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/amzn2/$releasever/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
priority=9
```

To set up the yum repository for Amazon Linux 2023, create the
file named `/etc/yum.repos.d/nginx.repo` with the following contents:

```text
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/amzn/2023/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
priority=9
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Step 2: Installing Otel module for nginx

```mdx-code-block
<Tabs>
<TabItem value="RedHat, RHEL and Derivatives" label="RedHat, RHEL and Derivatives">
```

```bash
sudo yum install nginx-module-otel
```

```mdx-code-block
</TabItem>
<TabItem value="Debian, Ubuntu and derivatives" label="Debian, Ubuntu and derivatives">
```

```bash
sudo apt install nginx-module-otel
```

```mdx-code-block
</TabItem>
</Tabs>
```
:::warning

Take a backup of your nginx config before installing the module.  
It might be overwritten by the module installation.

:::

### Step 3: Configure nginx to send traces

Add the following configs in your `nginx.conf` file:

```conf
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

```yaml
receivers:
  filelog:
    include:
      - /var/log/nginx/*.log
    start_at: beginning
```

> Note: If you have configure log collection location to custom directory,
update the `include` block with the correct path.

Great work. Now we have successfully implemented nginx with OpenTelemetry instrumentation
