---
sidebar_position: 3
---

# Installing OpenTelemetry Collector on Linux

This comprehensive guide walks you through installing and configuring the
OpenTelemetry Collector on Linux systems.

Whether you're using Debian, Red Hat, or other Linux distributions,
you'll learn how to set up telemetry collection for your observability needs.

## Overview

The OpenTelemetry Collector is a vendor-agnostic agent that collects, processes,
and exports telemetry data. This guide covers:

- Installing OpenTelemetry Collector via DEB packages (Ubuntu, Debian)
- Installing OpenTelemetry Collector via RPM packages (RHEL, CentOS, Fedora)
- Manual installation for other Linux distributions
- Post-installation configuration and service management
- Troubleshooting and logging

## System Requirements

- Linux operating system (amd64/arm64/i386)
- `systemd` for service management
- Root or sudo access
- Minimum 512MB RAM
- 1GB free disk space

## Package Availability

Official OpenTelemetry Collector packages are available in the following formats:

- DEB packages for Debian-based systems
- RPM packages for Red Hat-based systems
- Precompiled binaries for manual installation

Default configuration path: `/etc/otelcol/config.yaml`

## DEB Installation

To install the OpenTelemetry Collector on Debian-based systems, run the
following commands:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_amd64.deb
sudo dpkg -i otelcol_0.47.0_linux_amd64.deb
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_arm64.deb
sudo dpkg -i otelcol_0.47.0_linux_arm64.deb
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_386.deb
sudo dpkg -i otelcol_0.47.0_linux_386.deb
```

```mdx-code-block
</TabItem>
</Tabs>
```

## RPM Installation

To install the OpenTelemetry Collector on Red Hat-based systems, run the
following commands:

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_amd64.rpm
sudo rpm -ivh otelcol_0.47.0_linux_amd64.rpm
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_arm64.rpm
sudo rpm -ivh otelcol_0.47.0_linux_arm64.rpm
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_386.rpm
sudo rpm -ivh otelcol_0.47.0_linux_386.rpm
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Manual Linux Installation

The OpenTelemetry
Collector [releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases)
are available for various architectures. You can download the binary and install
it manually:

```mdx-code-block
<Tabs>
<TabItem value="amd64" label="AMD64">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_amd64.tar.gz
tar -xvf otelcol_0.47.0_linux_amd64.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="arm64" label="ARM64">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_arm64.tar.gz
tar -xvf otelcol_0.47.0_linux_arm64.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="i386" label="i386">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_386.tar.gz
tar -xvf otelcol_0.47.0_linux_386.tar.gz
```

```mdx-code-block
</TabItem>
<TabItem value="ppc64le" label="PPC64LE">
```

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.47.0/otelcol_0.47.0_linux_ppc64le.tar.gz
tar -xvf otelcol_0.47.0_linux_ppc64le.tar.gz
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuring the OpenTelemetry Collector Service

By default, the `otelcol` systemd service starts with the
`--config=/etc/otelcol/config.yaml` option after installation. This
configuration follows the [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
standards.

To customize the collector settings, modify the `OTELCOL_OPTIONS` variable in
the `/etc/otelcol/otelcol.conf` systemd environment file with appropriate
command-line options. Run `/usr/bin/otelcol --help` to see all available
options. Additional environment variables can be passed to the `otelcol` service
by adding them to this file.

After modifying the Collector configuration file or `/etc/otelcol/otelcol.conf`,
restart the `otelcol` service to apply the changes:

```sh
sudo systemctl restart otelcol
```

To check the logs from the `otelcol` service, run:

```sh
sudo journalctl -u otelcol
```

For more information on configuring and using the OpenTelemetry Collector, refer
to
the [official OpenTelemetry documentation](https://opentelemetry.io/docs/collector/).
