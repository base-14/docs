---
title: scout config init
sidebar_label: config init
sidebar_position: 2
description:
  Generate a production-ready OpenTelemetry Collector configuration file using an
  interactive wizard. Supports Prometheus endpoint discovery, signal selection,
  and multiple authentication methods.
keywords:
  - otel config generator
  - opentelemetry config wizard
  - collector config init
  - scout config init
  - otel collector setup
---

# scout config init

Generate a production-ready OpenTelemetry Collector configuration file through
an interactive wizard. The wizard walks you through service identity, signal
types, OTLP endpoints, and authentication setup.

![scout config init demo](/img/scout-cli/10-config-init.gif)

## Usage

```bash
scout config init
```

This command is fully interactive — it has no flags.

## Wizard Steps

### 1. Prometheus Discovery (Optional)

The wizard asks if you have Prometheus endpoints to scrape. If yes, you provide
comma-separated endpoint URLs. The wizard checks HTTP reachability and extracts
job labels.

### 2. Service Identity

Enter the service name for your application (e.g., `payment-service`). This is
skipped if discovered from Prometheus endpoints.

### 3. Environment

Enter the deployment environment (e.g., `dev`, `staging`, `prod`).

### 4. Signal Types

Select which telemetry signals to enable:

- **Traces** (default: enabled)
- **Metrics** (default: enabled)
- **Logs** (default: disabled)

### 5. OTLP Endpoint

Enter the OTLP exporter endpoint URL where the collector should send data
(e.g., `https://your-backend.example.com/otlp`).

### 6. Authentication Method

Choose how the collector authenticates with the backend:

| Method | Details |
|--------|---------|
| **None** | No authentication |
| **Bearer Token** | Inline value or env var `${SCOUT_OTEL_AUTH_TOKEN}` |
| **OAuth2 Client Credentials** | Inline or env vars: `${SCOUT_OTEL_CLIENT_ID}`, `${SCOUT_OTEL_CLIENT_SECRET}`, `${SCOUT_OTEL_TOKEN_URL}` |

## Output

The wizard generates an `otel-collector-config.yaml` file in the current
directory. If the file already exists, you're prompted before overwriting.

The generated config includes:

- OTLP receivers (gRPC and HTTP)
- Selected signal pipelines (traces, metrics, logs)
- Memory limiter, batch processor, and retry settings
- Resource processor with service name and environment
- OTLP exporter with gzip compression
- Health check extension

:::note
This is an interactive command. It requires a TTY and cannot be used in
non-interactive or CI environments. For CI, create the config locally and commit
it to your repository.
:::

:::tip
After generating, validate and test your config:

```bash
scout config validate --file otel-collector-config.yaml
scout config test --file otel-collector-config.yaml
```

:::

## See Also

- [config validate](./config-validate.md) — validate a configuration file
- [config test](./config-test.md) — live-test a configuration
