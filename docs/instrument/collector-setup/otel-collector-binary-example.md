---
title: OpenTelemetry Collector Binary Installation Guide
description:
  Install and configure OpenTelemetry Collector binary. Download from releases,
  set up log collection, and export telemetry data to Scout with OAuth2
  authentication.
keywords:
  [
    opentelemetry binary,
    otel collector download,
    binary installation,
    collector setup,
    opentelemetry releases,
  ]
tags: [open-telemetry, base14 scout]
sidebar_position: 4
---

# OpenTelemetry Binary

Set up and configure the Scout Collector through binary downloaded from releases
page.

## Overview

This guide demonstrates how to set up and configure the Scout Collector binary
for collecting and exporting telemetry data to base14 Scout.

- Binary installation and configuration
- Log collection setup with file monitoring
- Secure data export with OAuth2 authentication
- Sample application integration

### Key Features

- **Easy Installation**: Direct binary download and setup
- **Flexible Configuration**: YAML-based configuration
- **Secure Authentication**: Built-in OAuth2 support
- **Data Processing**: Log filtering and batching
- **Real-time Monitoring**: Live log collection and export

## Prerequisites

- `curl` command-line tool
- `Node.js` (for running the example application)
- A base14 Scout account with valid authentication credentials

## Install the collector binary

The collector binary can be downloaded from the
[releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

An example of how to download and extract the collector binary is shown below
for macos arm64.

```bash
curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.119.0/otelcol_0.119.0_darwin_arm64.tar.gz
tar -xvf otelcol_0.119.0_darwin_arm64.tar.gz
```

## Example configuration

An example config can be seen to collect logs from a file to export to Scout

```yaml showLineNumbers
extensions:
  oauth2client:
    client_id: demo
    client_secret: 01JM94R5DPSZXBGK5QA4D329N5
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/playground/protocol/openid-connect/token

exporters:
  debug:
  otlphttp/auth:
    endpoint: https://otel.play.b14.dev/01jm94npk4h8ys63x1kzw2bjes/otlp
    auth:
      authenticator: oauth2client

processors:
  batch:
    redaction:
      blocked_values:
        # MasterCard number
        - "(5[1-5][0-9]{14})"
        summary: debug

receivers:
  # Data sources: traces, metrics, logs
  filelog:
    include: [ "app.log" ]

service:
  extensions: [ oauth2client ]
  pipelines:
    logs:
      receivers: [ filelog ]
      processors: [ batch ]
      exporters: [ otlphttp/auth, debug ]
```

## Running the collector

```bash
./otelcol --config ./config.yaml
```

## Run a Sample Node.js Application

Let's create a simple Node.js application that generates structured logs using
the `pino` logging library. The Scout Collector will collect these logs and
forward them to Scout.

### 1. Install Dependencies

First, install the `pino` logging library, which provides structured JSON
logging capabilities:

```bash
npm install pino
```

### 2. Create the Application

Create a new file called `main.js` with the following code that demonstrates
basic logging functionality:

```js title="main.js"
const logger = require("pino")();

logger.info("hello world");

const child = logger.child({ a: "property" });
child.info("hello child!");
```

### 3. Run the Application

Execute the application and redirect its output to `app.log`. The OpenTelemetry
Collector will monitor this file as configured in the previous section:

```bash
node main.js > app.log
```

## View Logs in base14 Scout

After running the application, you can view the collected logs in Scout:

1. Open your base14 Scout dashboard
2. Navigate to the `Dashboards > Library > Logs View` in the main menu
3. You should see the following log entries:
   - A "hello world" message from the root logger
   - A "hello child!" message with an additional property `{a: 'property'}`

The logs will appear with timestamps and other metadata added by the Scout
Collector.

## Related Guides

- [OTel Collector Configuration](./otel-collector-config.md) - Advanced
  configuration examples
- [Scout Exporter Configuration](./scout-exporter.md) - Detailed authentication
  setup
- [Linux Installation](./linux-setup.md) - Production deployment with systemd
