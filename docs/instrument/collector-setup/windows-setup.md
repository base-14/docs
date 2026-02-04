---
title: Windows OpenTelemetry Collector Installation
sidebar_label: Windows Installation
description:
  Install OpenTelemetry Collector on Windows. Complete guide for collecting
  Windows Event Logs, Performance Counters, and host metrics with Windows
  Service management.
keywords:
  [
    windows opentelemetry,
    otel collector windows,
    windows installation,
    windows event log,
    windows performance counters,
  ]
tags: [windows, opentelemetry, base14 scout]
sidebar_position: 4
---

# Windows

Install and configure the OpenTelemetry Collector on Windows systems to collect Windows
Event Logs, Performance Counters, and host metrics.

## Overview

This guide covers:

- Installing the OpenTelemetry Collector Contrib distribution on Windows
- Configuring Windows Event Log collection (System, Application, Security)
- Setting up Windows Performance Counters monitoring
- Collecting host metrics (CPU, memory, disk, network)
- Running the collector as a Windows Service
- Troubleshooting and logging

:::warning

The standard OpenTelemetry Collector distribution does not include Windows-specific
receivers. You must use the **OpenTelemetry Collector Contrib** distribution
(`otelcol-contrib`) to collect Windows Event Logs and Performance Counters.

:::

## System Requirements

- Windows 10, Windows Server 2016, or later
- Administrator privileges
- Minimum 512MB RAM
- 1GB free disk space
- PowerShell 5.1 or later

## Installation

Download the OpenTelemetry Collector Contrib distribution from the
[official releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="amd64" label="AMD64 (64-bit)">
```

Download the Windows AMD64 binary:

```powershell
# Create installation directory
New-Item -ItemType Directory -Force -Path "C:\Program Files\otelcol-contrib"

# Download the collector (update version as needed)
$version = "0.127.0"
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$version/otelcol-contrib_${version}_windows_amd64.tar.gz" -OutFile "$env:TEMP\otelcol-contrib.tar.gz"

# Extract the archive
tar -xzf "$env:TEMP\otelcol-contrib.tar.gz" -C "C:\Program Files\otelcol-contrib"
```

```mdx-code-block
</TabItem>
<TabItem value="386" label="x86 (32-bit)">
```

Download the Windows 386 binary:

```powershell
# Create installation directory
New-Item -ItemType Directory -Force -Path "C:\Program Files\otelcol-contrib"

# Download the collector (update version as needed)
$version = "0.127.0"
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$version/otelcol-contrib_${version}_windows_386.tar.gz" -OutFile "$env:TEMP\otelcol-contrib.tar.gz"

# Extract the archive
tar -xzf "$env:TEMP\otelcol-contrib.tar.gz" -C "C:\Program Files\otelcol-contrib"
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

Create the configuration file at `C:\Program Files\otelcol-contrib\config.yaml`.

### Receivers

The configuration uses Windows-specific receivers to collect telemetry data:

#### Windows Event Log Receiver

Collects logs from Windows Event Log channels:

```yaml showLineNumbers title="Windows Event Log receivers"
receivers:
  windowseventlog/system:
    poll_interval: 5s
    channel: System

  windowseventlog/application:
    poll_interval: 5s
    channel: Application

  windowseventlog/security:
    poll_interval: 5s
    channel: Security
```

#### Windows Performance Counters Receiver

Collects Windows Performance Counter metrics:

```yaml showLineNumbers title="Windows Performance Counters receiver"
receivers:
  windowsperfcounters:
    collection_interval: 5s

    metrics:
      cpu.utilization.percent:
        unit: "%"
        gauge:

      memory.available.bytes:
        unit: By
        gauge:

      disk.read.bytes_per_sec:
        unit: By/s
        gauge:
      disk.write.bytes_per_sec:
        unit: By/s
        gauge:

      network.bytes.received_per_sec:
        unit: By/s
        gauge:
      network.bytes.sent_per_sec:
        unit: By/s
        gauge:

    perfcounters:
      - object: Processor
        instances: ["_Total"]
        counters:
          - name: "% Processor Time"
            metric: cpu.utilization.percent

      - object: Memory
        counters:
          - name: "Available Bytes"
            metric: memory.available.bytes

      - object: LogicalDisk
        instances: ["_Total"]
        counters:
          - name: "Disk Read Bytes/sec"
            metric: disk.read.bytes_per_sec
          - name: "Disk Write Bytes/sec"
            metric: disk.write.bytes_per_sec

      - object: Network Interface
        instances: ["*"]
        counters:
          - name: "Bytes Received/sec"
            metric: network.bytes.received_per_sec
          - name: "Bytes Sent/sec"
            metric: network.bytes.sent_per_sec
```

#### Host Metrics Receiver

Collects system-level metrics:

```yaml showLineNumbers title="Host Metrics receiver"
receivers:
  hostmetrics:
    collection_interval: 10s
    scrapers:
      cpu:
        metrics:
          system.cpu.time: { enabled: true }
          system.cpu.utilization: { enabled: true }
          system.cpu.physical.count: { enabled: true }
          system.cpu.logical.count: { enabled: true }

      memory:
        metrics:
          system.memory.usage: { enabled: true }
          system.memory.utilization: { enabled: true }

      filesystem:
        metrics:
          system.filesystem.usage: { enabled: true }
          system.filesystem.utilization: { enabled: true }

      disk:
        metrics:
          system.disk.io: { enabled: true }
          system.disk.operations: { enabled: true }

      network:
        metrics:
          system.network.io: { enabled: true }
          system.network.errors: { enabled: true }

      processes:
        metrics:
          system.processes.count: { enabled: true }
          system.processes.created: { enabled: true }

      system:
        metrics:
          system.uptime: { enabled: true }
```

#### OTLP Receiver

Receives telemetry from instrumented applications:

```yaml showLineNumbers title="OTLP receiver"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
```

### Complete Configuration

Below is the complete configuration file combining all components:

```yaml showLineNumbers title="C:\Program Files\otelcol-contrib\config.yaml"
receivers:
  windowseventlog/system:
    poll_interval: 5s
    channel: System

  windowseventlog/application:
    poll_interval: 5s
    channel: Application

  windowseventlog/security:
    poll_interval: 5s
    channel: Security

  windowsperfcounters:
    collection_interval: 5s

    metrics:
      cpu.utilization.percent:
        unit: "%"
        gauge:

      memory.available.bytes:
        unit: By
        gauge:

      disk.read.bytes_per_sec:
        unit: By/s
        gauge:
      disk.write.bytes_per_sec:
        unit: By/s
        gauge:

      network.bytes.received_per_sec:
        unit: By/s
        gauge:
      network.bytes.sent_per_sec:
        unit: By/s
        gauge:

    perfcounters:
      - object: Processor
        instances: ["_Total"]
        counters:
          - name: "% Processor Time"
            metric: cpu.utilization.percent

      - object: Memory
        counters:
          - name: "Available Bytes"
            metric: memory.available.bytes

      - object: LogicalDisk
        instances: ["_Total"]
        counters:
          - name: "Disk Read Bytes/sec"
            metric: disk.read.bytes_per_sec
          - name: "Disk Write Bytes/sec"
            metric: disk.write.bytes_per_sec

      - object: Network Interface
        instances: ["*"]
        counters:
          - name: "Bytes Received/sec"
            metric: network.bytes.received_per_sec
          - name: "Bytes Sent/sec"
            metric: network.bytes.sent_per_sec

  hostmetrics:
    collection_interval: 10s
    scrapers:
      cpu:
        metrics:
          system.cpu.time: { enabled: true }
          system.cpu.utilization: { enabled: true }
          system.cpu.physical.count: { enabled: true }
          system.cpu.logical.count: { enabled: true }

      memory:
        metrics:
          system.memory.usage: { enabled: true }
          system.memory.utilization: { enabled: true }

      filesystem:
        metrics:
          system.filesystem.usage: { enabled: true }
          system.filesystem.utilization: { enabled: true }

      disk:
        metrics:
          system.disk.io: { enabled: true }
          system.disk.operations: { enabled: true }

      network:
        metrics:
          system.network.io: { enabled: true }
          system.network.errors: { enabled: true }

      processes:
        metrics:
          system.processes.count: { enabled: true }
          system.processes.created: { enabled: true }

      system:
        metrics:
          system.uptime: { enabled: true }

  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  resourcedetection/system:
    detectors: ["system"]
    system:
      hostname_sources: ["lookup"]
      resource_attributes:
        host.id:
          enabled: true

  batch:
    send_batch_size: 5
    send_batch_max_size: 10
    timeout: 1s

  resource:
    attributes:
      - key: environment
        value: windows
        action: upsert

  resource/hostmetrics:
    attributes:
      - key: service.name
        value: hostmetrics
        action: upsert

  resource/windowsperfcounters:
    attributes:
      - key: service.name
        value: windowsperfcounters
        action: upsert

exporters:
  debug:
    verbosity: detailed

  otlphttp/b14:
    endpoint: <otlp_endpoint>
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip

extensions:
  oauth2client:
    client_id: <client_id>
    client_secret: <client_secret>
    endpoint_params:
      audience: b14collector
    token_url: <token_url>
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  telemetry:
    metrics:
      readers:
        - periodic:
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: http://127.0.0.1:4318
    logs:
      level: error
      encoding: json
      processors:
        - batch:
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: http://127.0.0.1:4318
    traces:
      processors:
        - batch:
            exporter:
              otlp:
                protocol: http/protobuf
                endpoint: http://127.0.0.1:4318
  pipelines:
    metrics/hostmetrics:
      receivers: [hostmetrics, windowsperfcounters]
      processors: [resource, resource/hostmetrics, resourcedetection/system]
      exporters: [otlphttp/b14]
    metrics/windowsperfcounters:
      receivers: [windowsperfcounters]
      processors: [resource, resource/windowsperfcounters, resourcedetection/system]
      exporters: [otlphttp/b14]
    metrics:
      receivers: [otlp]
      processors: [resource, resourcedetection/system]
      exporters: [otlphttp/b14]
    logs:
      receivers:
        [
          otlp,
          windowseventlog/system,
          windowseventlog/application,
          windowseventlog/security,
        ]
      processors: [resource, resourcedetection/system]
      exporters: [otlphttp/b14]
    traces:
      receivers: [otlp]
      processors: [resource, resourcedetection/system]
      exporters: [otlphttp/b14]
```

Replace the placeholder values:

- `<otlp_endpoint>` - Your Scout OTLP endpoint (e.g., `https://otel.play.b14.dev/__YOUR_TENANT__/otlp`)
- `<client_id>` - Your OAuth2 client ID
- `<client_secret>` - Your OAuth2 client secret
- `<token_url>` - Your OAuth2 token URL (e.g., `https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token`)

### Save the Configuration

After updating the placeholder values, save the configuration to a file:

```powershell
# Open notepad to create the config file
notepad "C:\Program Files\otelcol-contrib\config.yaml"
```

Paste your configuration, save the file, then validate it:

```powershell
& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" validate --config="C:\Program Files\otelcol-contrib\config.yaml"
```

## Running as a Windows Service

### Install the Service

Use the built-in Windows Service capabilities to run the collector:

```powershell
# Create the Windows Service
$binPath = '"C:\Program Files\otelcol-contrib\otelcol-contrib.exe" --config="C:\Program Files\otelcol-contrib\config.yaml"'
New-Service -Name "otelcol-contrib" -BinaryPathName $binPath -DisplayName "OpenTelemetry Collector Contrib" -StartupType Automatic -Description "OpenTelemetry Collector for Windows telemetry collection"
```

### Start the Service

```powershell
# Start the service
Start-Service -Name "otelcol-contrib"

# Verify service status
Get-Service -Name "otelcol-contrib"
```

### Service Management Commands

```powershell
# Stop the service
Stop-Service -Name "otelcol-contrib"

# Restart the service
Restart-Service -Name "otelcol-contrib"

# Remove the service (if needed)
sc.exe delete "otelcol-contrib"
```

## Running Manually

To run the collector manually for testing or debugging:

```powershell
# Run with config file
& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" --config="C:\Program Files\otelcol-contrib\config.yaml"

# Validate configuration
& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" validate --config="C:\Program Files\otelcol-contrib\config.yaml"
```

## Windows Firewall Configuration

If you're receiving telemetry from other applications, open the required ports:

```powershell
# Open OTLP gRPC port
New-NetFirewallRule -DisplayName "OpenTelemetry Collector gRPC" -Direction Inbound -Protocol TCP -LocalPort 4317 -Action Allow

# Open OTLP HTTP port
New-NetFirewallRule -DisplayName "OpenTelemetry Collector HTTP" -Direction Inbound -Protocol TCP -LocalPort 4318 -Action Allow
```

## Troubleshooting

### View Service Logs

The collector logs to the Windows Event Log. View logs using:

```powershell
# View recent collector events
Get-EventLog -LogName Application -Source "otelcol-contrib" -Newest 50
```

Alternatively, run the collector manually to see output directly in the terminal.

### Enable Debug Logging

Add the debug exporter to your pipelines to see telemetry data:

```yaml
exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    logs:
      exporters: [debug, otlphttp/b14]
```

### Common Issues

**Permission denied for Security Event Log**

The collector needs Administrator privileges to read the Security event log channel.
Ensure the service runs with appropriate permissions.

**Performance counters not found**

If a performance counter specified in the config doesn't exist on your system, the collector
will fail to start with an "Incorrect function" error. Counter names vary by Windows version
and locale.

Verify the counter names match your system. Use `typeperf -q` to list available counters:

```powershell
# List all Processor counters
typeperf -q "Processor"

# List all Memory counters
typeperf -q "Memory"

# List all LogicalDisk counters
typeperf -q "LogicalDisk"

# List all Network Interface counters
typeperf -q "Network Interface"
```

To isolate the issue, temporarily remove the `windowsperfcounters` receiver from your config
and test with only `hostmetrics` and `windowseventlog` receivers.

**Service fails to start**

Run the collector manually to see detailed error messages:

```powershell
Stop-Service -Name "otelcol-contrib"
& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" --config="C:\Program Files\otelcol-contrib\config.yaml"
```

Validate the configuration file:

```powershell
& "C:\Program Files\otelcol-contrib\otelcol-contrib.exe" validate --config="C:\Program Files\otelcol-contrib\config.yaml"
```

## Related Guides

- [Scout Exporter Configuration](./scout-exporter.md) - Set up authentication and
  endpoints
- [OTel Collector Configuration](./otel-collector-config.md) - Full collector
  configuration reference
- [Linux Installation](./linux-setup.md) - Linux deployment guide
