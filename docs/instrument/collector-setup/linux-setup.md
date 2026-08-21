---
title: Install OpenTelemetry Collector on Linux - DEB & RPM Packages
sidebar_label: Linux & VM Setup
description:
  Install and configure the OpenTelemetry Collector on Linux and VMs.
  Collect host metrics, container and journald logs, scrape Prometheus
  endpoints, run it as a systemd service, and export to base14 Scout.
keywords:
  [
    linux opentelemetry,
    otel collector linux,
    otel collector vm,
    linux installation,
    debian opentelemetry,
    rhel opentelemetry,
    hostmetrics receiver,
    docker container logs,
    systemd otel collector,
  ]
tags: [linux, opentelemetry, base14 scout]
sidebar_position: 3
---

# Linux

Install and configure the Scout Collector on Linux systems.

Whether you're using Debian, Red Hat, or other Linux distributions, you'll learn
how to set up telemetry collection for your observability needs.

## Overview

The Scout Collector is a vendor-agnostic agent that collects, processes, and
exports telemetry data. This guide covers:

- Installing Scout Collector via DEB packages (Ubuntu, Debian)
- Installing Scout Collector via RPM packages (RHEL, CentOS, Fedora)
- Manual installation for other Linux distributions
- Configuring receivers for host metrics, container logs, journald logs,
  and Prometheus endpoints
- Exporting telemetry to Scout and storing credentials securely
- Running as a systemd service and verifying the pipeline
- Troubleshooting and logging

## System Requirements

- Linux operating system (amd64/arm64/i386)
- `systemd` for service management
- Root or sudo access
- Minimum 512MB RAM
- 1GB free disk space

## Package Availability

Official Scout Collector packages are available in the following formats:

- DEB packages for Debian-based systems
- RPM packages for Red Hat-based systems
- Precompiled binaries for manual installation

Default configuration path: `/etc/otelcol-contrib/config.yaml`

## DEB Installation

To install the Scout Collector on Debian-based systems, run the following
commands:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_amd64.deb
sudo dpkg -i otelcol-contrib_0.127.0_linux_amd64.deb
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_arm64.deb
sudo dpkg -i otelcol-contrib_0.127.0_linux_arm64.deb
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_386.deb
sudo dpkg -i otelcol-contrib_0.127.0_linux_386.deb
```

```mdx-code-block
</TabItem>
</Tabs>
```

## RPM Installation

To install the Scout Collector on Red Hat-based systems, run the following
commands:

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_amd64.rpm
sudo rpm -ivh otelcol-contrib_0.127.0_linux_amd64.rpm
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_arm64.rpm
sudo rpm -ivh otelcol-contrib_0.127.0_linux_arm64.rpm
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_386.rpm
sudo rpm -ivh otelcol-contrib_0.127.0_linux_386.rpm
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Manual Linux Installation

The OpenTelemetry Collector
[releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)
are available for various architectures. You can download the binary and install
it manually:

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_amd64.tar.gz
tar -xvf otelcol-contrib_0.127.0_linux_amd64.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_arm64.tar.gz
tar -xvf otelcol-contrib_0.127.0_linux_arm64.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_386.tar.gz
tar -xvf otelcol-contrib_0.127.0_linux_386.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="ppc64le" label="PPC64LE">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.127.0/otelcol-contrib_0.127.0_linux_ppc64le.tar.gz
tar -xvf otelcol-contrib_0.127.0_linux_ppc64le.tar.gz
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configure Telemetry Collection

After installation, edit `/etc/otelcol-contrib/config.yaml` to define
what telemetry the Scout Collector gathers from the machine and where it
sends it. A configuration is built from receivers (what to collect),
processors (how to enrich and batch), an exporter (where to send), and
pipelines that wire them together.

### Receivers

#### Host metrics

The `hostmetrics` receiver collects CPU, memory, disk, filesystem,
network, and load metrics from the host:

```yaml showLineNumbers
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      load:
      disk:
      filesystem:
      network:
      paging:
      processes:
```

Listing a scraper by name, as above, enables it with its **default** set
of metrics — you don't need to enumerate individual metrics to get the
usual CPU, memory, disk, and network signals. Some metrics are opt-in
and stay off until you ask for them, such as the percentage-based
`system.cpu.utilization` and `system.memory.utilization`. Enable an
opt-in metric (or disable a default one) under a `metrics:` block:

```yaml showLineNumbers
receivers:
  hostmetrics:
    scrapers:
      cpu:
        metrics:
          system.cpu.utilization:
            enabled: true
```

The `processes` scraper above reports lightweight, system-wide process
counts and needs no special privileges. A separate `process` scraper
(not shown) reports per-process metrics and needs elevated privileges to
read other users' entries under `/proc` — see
[Running with elevated privileges](#running-with-elevated-privileges).

#### Container logs (Docker)

When applications run as Docker containers, their stdout and stderr are
written to JSON log files under `/var/lib/docker/containers`. The
`filelog` receiver tails these files, and the `container` operator
unwraps Docker's JSON envelope into the log body:

```yaml showLineNumbers
receivers:
  filelog:
    include: [/var/lib/docker/containers/*/*-json.log]
    start_at: end
    include_file_path: true
    operators:
      - type: container
        format: docker
        add_metadata_from_filepath: false
```

Leave `add_metadata_from_filepath` set to `false`. That option exists to
extract pod, namespace, and container names from Kubernetes pod log
paths (`/var/log/pods/...`); a Docker log path has no such structure, so
setting it `true` makes every record fail with `failed to detect a valid
log path`.

`/var/lib/docker/containers` is readable only by root, so the collector
must run as root to tail these files — see
[Running with elevated privileges](#running-with-elevated-privileges).

If your application logs in JSON, add a `json_parser` to lift its fields
into attributes and a `severity_parser` to set the log severity:

```yaml showLineNumbers
      - type: json_parser
        parse_from: body
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        on_error: send
```

`on_error: send` keeps any non-JSON lines flowing instead of dropping
them, so startup banners and stack traces are preserved.

#### System and journald logs

For services managed by systemd, the `journald` receiver reads the
journal directly. For plain text log files, use a `filelog` receiver:

```yaml showLineNumbers
receivers:
  journald:
    units: [my-service]
  filelog/syslog:
    include: [/var/log/syslog, /var/log/messages]
    start_at: end
```

#### Scrape a Prometheus endpoint

Many applications expose metrics on a Prometheus `/metrics` endpoint.
The `prometheus` receiver scrapes them on an interval:

```yaml showLineNumbers
receivers:
  prometheus/app:
    config:
      scrape_configs:
        - job_name: my-app
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets: [localhost:8080]
```

The target must be reachable from the host where the collector runs. If
the application runs in a Docker container, its container-network name
(for example `my-app:8080`) does not resolve from the host. Publish the
metrics port and scrape `localhost:<port>`, or use the container's
bridge IP:

```sh
docker port <container>
```

### Export to Scout

Send the collected telemetry to Scout with the `oauth2client` extension
and an `otlphttp` exporter. Replace the tenant placeholder with your
Scout tenant, and supply credentials via environment variables (see
[Store credentials securely](#store-credentials-securely)):

```yaml showLineNumbers
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
```

For the full list of tenant, endpoint, and authentication options, see
[Scout Exporter Configuration](./scout-exporter.md).

### Store credentials securely

Keep secrets out of `config.yaml` by referencing environment variables
with `${env:VAR}` and defining them in the systemd environment file at
`/etc/otelcol-contrib/otelcol-contrib.conf`:

```sh
SCOUT_CLIENT_ID=__YOUR_CLIENT_ID__
SCOUT_CLIENT_SECRET=__YOUR_CLIENT_SECRET__
```

Keep the existing `OTELCOL_OPTIONS` line in that file. Then restrict the
file's permissions so the secret is not world-readable:

```sh
sudo chmod 600 /etc/otelcol-contrib/otelcol-contrib.conf
```

systemd loads this file when the service starts, so restart the
collector after changing it.

### Complete configuration

The following config combines host metrics and Docker container logs
with a Scout exporter, wired into `metrics` and `logs` pipelines. Save
it to `/etc/otelcol-contrib/config.yaml`:

```yaml showLineNumbers
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      load:
      disk:
      filesystem:
      network:
  filelog:
    include: [/var/lib/docker/containers/*/*-json.log]
    start_at: end
    include_file_path: true
    operators:
      - type: container
        format: docker
        add_metadata_from_filepath: false
      - type: json_parser
        parse_from: body
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        on_error: send

processors:
  memory_limiter:
    check_interval: 5s
    limit_percentage: 80
    spike_limit_percentage: 30
  resourcedetection:
    detectors: [system]
    timeout: 5s
  resource:
    attributes:
      - key: environment
        value: production
        action: upsert
  batch:
    timeout: 2s
    send_batch_size: 8192
    send_batch_max_size: 10000

exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

service:
  extensions: [health_check, oauth2client]
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlphttp/b14]
    logs:
      receivers: [filelog]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlphttp/b14]
```

Add the `journald`, `filelog/syslog`, or `prometheus/app` receivers from
above to the relevant pipeline as needed.

## Configuring the Scout Collector Service

By default, the `otelcol-contrib` systemd service starts with the
`--config=/etc/otelcol-contrib/config.yaml` option after installation. This
configuration follows the
[Scout Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
standards.

To customize the collector settings, modify the `OTELCOL_OPTIONS` variable in
the `/etc/otelcol-contrib/otelcol-contrib.conf` systemd environment file with appropriate
command-line options. Run `/usr/bin/otelcol-contrib --help` to see all available
options. Additional environment variables can be passed to the
`otelcol-contrib` service by adding them to this file.

After modifying the Collector configuration file or `/etc/otelcol-contrib/otelcol-contrib.conf`,
restart the `otelcol-contrib` service to apply the changes:

```sh
sudo systemctl restart otelcol-contrib
```

To check the logs from the `otelcol-contrib` service, run:

```sh
sudo journalctl -u otelcol-contrib
```

For more information on configuring and using the Scout Collector, refer to the
[official OpenTelemetry documentation](https://opentelemetry.io/docs/collector/).

## Running with elevated privileges

Reading Docker container logs under `/var/lib/docker/containers`
requires root. Override the service user with a systemd drop-in rather
than editing the packaged unit file, which an upgrade would overwrite.

Create the drop-in directory and file:

```sh
sudo mkdir -p /etc/systemd/system/otelcol-contrib.service.d
sudo tee /etc/systemd/system/otelcol-contrib.service.d/10-root.conf >/dev/null <<'EOF'
[Service]
User=root
EOF
```

The drop-in must live under `/etc/systemd/system/...`; a file placed
elsewhere under `/etc/systemd/` is silently ignored. Reload systemd and
restart so the change takes effect:

```sh
sudo systemctl daemon-reload
sudo systemctl restart otelcol-contrib
```

Confirm the effective user:

```sh
systemctl show otelcol-contrib -p User
```

If you prefer not to run the collector as root, configure the container
with the `journald` log driver and read it with the `journald` receiver
instead of `filelog`.

## Validate and verify

Validate the configuration before restarting. Because credentials come
from the environment file, load it first — otherwise `${env:...}`
resolves to empty and validation reports a missing endpoint and client
ID even though the config is correct:

```sh
sudo bash -c 'set -a; . /etc/otelcol-contrib/otelcol-contrib.conf; set +a; \
  otelcol-contrib validate --config=/etc/otelcol-contrib/config.yaml'
```

Restart the service and watch the logs for export or authentication
errors:

```sh
sudo systemctl restart otelcol-contrib
sudo journalctl -u otelcol-contrib -f
```

Check the health endpoint to confirm the collector is up:

```sh
curl -s localhost:13133
```

Then confirm the telemetry arrives in Scout under the service or host
you configured.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `validate` reports `no ClientID provided` or `at least one endpoint must be specified` | `${env:...}` variables are not set in your shell; systemd injects them only at service start | Load the environment file before validating (see [Validate and verify](#validate-and-verify)), or rely on `systemctl restart` and read the journal. |
| `finding files ... permission denied` on `/var/lib/docker/containers` | The collector is not running as root | Apply the `User=root` drop-in; confirm with `systemctl show otelcol-contrib -p User`. |
| `User` still shows the default after adding a drop-in | The drop-in is in the wrong directory, lacks the `.conf` suffix, or systemd was not reloaded | Place it under `/etc/systemd/system/otelcol-contrib.service.d/` with a `.conf` name, then run `daemon-reload` and `restart`. |
| `failed to detect a valid log path` from the `container` operator | `add_metadata_from_filepath: true` expects Kubernetes pod log paths | Set `add_metadata_from_filepath: false`. |
| Config edits have no effect | The collector reads its config only at startup | Run `sudo systemctl restart otelcol-contrib`. |
| No data arrives, but there are no errors | `filelog` uses `start_at: end`, so only new lines are sent | Generate new activity; historical lines are not backfilled. Use `start_at: beginning` only for testing. |

## FAQ

### How do I install the OpenTelemetry Collector on Ubuntu or Debian?

Download the `otelcol-contrib` `.deb` package for your architecture
(amd64, arm64, or i386) from the official releases and install it with
`sudo dpkg -i`. The package registers a systemd service on install.

### How do I install the OpenTelemetry Collector on RHEL or CentOS?

Download the `otelcol-contrib` `.rpm` package for your architecture and
install it with `sudo rpm -ivh`. The collector starts as a systemd service
using the default config at `/etc/otelcol-contrib/config.yaml`.

### Where is the default OpenTelemetry Collector config file on Linux?

At `/etc/otelcol-contrib/config.yaml`. Command-line options go in the
`OTELCOL_OPTIONS` variable in
`/etc/otelcol-contrib/otelcol-contrib.conf`.

### How do I restart the OpenTelemetry Collector service on Linux?

Run `sudo systemctl restart otelcol-contrib` after editing the config,
then check `sudo journalctl -u otelcol-contrib` to confirm it came back up
rather than crash-looping on a config error.

### What are the system requirements for the OTel Collector on Linux?

A systemd-based Linux system, root or sudo access, at least 512MB of RAM,
and 1GB of free disk. Packages ship for amd64, arm64, and i386.

### How do I collect Docker container logs with the Collector on Linux?

Use the filelog receiver to tail
`/var/lib/docker/containers/*/*-json.log` with the container operator, set
`add_metadata_from_filepath` to `false`, and run the collector as root so
it can read the Docker log directory.

### Why does otelcol-contrib validate report a missing endpoint or client ID?

Environment variables referenced with `${env:...}` are set by systemd when
it starts the service, not by your shell. Load the environment file first
so the values are substituted before the config is parsed.

## Related Guides

- [OTel Collector Configuration](./otel-collector-config.md) - Full
  receiver, processor, and exporter reference
- [Scout Exporter Configuration](./scout-exporter.md) - Set up authentication
  and endpoints
- [Docker Compose Setup](./docker-compose-example.md) - Alternative deployment
  method
- [Kubernetes (Helm) Setup](./kubernetes-helm-setup.md) - Deploy the
  collector on Kubernetes instead
