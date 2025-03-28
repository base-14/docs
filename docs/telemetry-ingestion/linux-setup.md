# Linux OpenTelemetry Collector Setup

This guide explains how to install the OpenTelemetry Collector on Linux systems. Our solution leverages the official OpenTelemetry Collector releases to provide a standards-compliant telemetry collection solution.

Every OpenTelemetry Collector release includes APK, DEB, and RPM packaging for Linux amd64/arm64/i386 systems. After installation, you can find the default configuration in `/etc/otelcol/config.yaml`.

> Note: `systemd` is required for automatic service configuration.

## DEB Installation

To install the OpenTelemetry Collector on Debian-based systems, run the following commands:

{{< tabpane text=true >}} {{% tab AMD64 %}}

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_amd64.deb
sudo dpkg -i otelcol_{{% param vers %}}_linux_amd64.deb
```

{{% /tab %}} {{% tab ARM64 %}}

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_arm64.deb
sudo dpkg -i otelcol_{{% param vers %}}_linux_arm64.deb
```

{{% /tab %}} {{% tab i386 %}}

```sh
sudo apt-get update
sudo apt-get -y install wget
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_386.deb
sudo dpkg -i otelcol_{{% param vers %}}_linux_386.deb
```

{{% /tab %}} {{< /tabpane >}}

## RPM Installation

To install the OpenTelemetry Collector on Red Hat-based systems, run the following commands:

{{< tabpane text=true >}} {{% tab AMD64 %}}

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_amd64.rpm
sudo rpm -ivh otelcol_{{% param vers %}}_linux_amd64.rpm
```

{{% /tab %}} {{% tab ARM64 %}}

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_arm64.rpm
sudo rpm -ivh otelcol_{{% param vers %}}_linux_arm64.rpm
```

{{% /tab %}} {{% tab i386 %}}

```sh
sudo yum update
sudo yum -y install wget systemctl
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_386.rpm
sudo rpm -ivh otelcol_{{% param vers %}}_linux_386.rpm
```

{{% /tab %}} {{< /tabpane >}}

## Manual Linux Installation

The OpenTelemetry Collector [releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) are available for various architectures. You can download the binary and install it manually:

{{< tabpane text=true >}} {{% tab AMD64 %}}

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_amd64.tar.gz
tar -xvf otelcol_{{% param vers %}}_linux_amd64.tar.gz
```

{{% /tab %}} {{% tab ARM64 %}}

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_arm64.tar.gz
tar -xvf otelcol_{{% param vers %}}_linux_arm64.tar.gz
```

{{% /tab %}} {{% tab i386 %}}

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_386.tar.gz
tar -xvf otelcol_{{% param vers %}}_linux_386.tar.gz
```

{{% /tab %}} {{% tab ppc64le %}}

```sh
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v{{% param vers %}}/otelcol_{{% param vers %}}_linux_ppc64le.tar.gz
tar -xvf otelcol_{{% param vers %}}_linux_ppc64le.tar.gz
```

{{% /tab %}} {{< /tabpane >}}

## Configuring the OpenTelemetry Collector Service

By default, the `otelcol` systemd service starts with the `--config=/etc/otelcol/config.yaml` option after installation. This configuration follows the [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/) standards.

To customize the collector settings, modify the `OTELCOL_OPTIONS` variable in the `/etc/otelcol/otelcol.conf` systemd environment file with appropriate command-line options. Run `/usr/bin/otelcol --help` to see all available options. Additional environment variables can be passed to the `otelcol` service by adding them to this file.

After modifying the Collector configuration file or `/etc/otelcol/otelcol.conf`, restart the `otelcol` service to apply the changes:

```sh
sudo systemctl restart otelcol
```

To check the logs from the `otelcol` service, run:

```sh
sudo journalctl -u otelcol
```

For more information on configuring and using the OpenTelemetry Collector, refer to the [official OpenTelemetry documentation](https://opentelemetry.io/docs/collector/).
