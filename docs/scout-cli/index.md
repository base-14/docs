---
title: Scout CLI
sidebar_label: Overview
sidebar_position: 1
description:
  Scout CLI is a command-line tool for querying observability data from the Scout
  platform and managing OpenTelemetry Collector configurations offline.
keywords:
  - scout cli
  - observability cli
  - opentelemetry cli
  - otel collector config
  - scout command line
  - base14 scout cli
---

# Scout CLI

Scout CLI brings observability workflows to your terminal. Authenticate with the
Scout platform to query logs, metrics, traces, alerts, and service topology — or
use the open-source config commands to validate, generate, and test
OpenTelemetry Collector configurations without a backend.

## Scout Access

These commands require authentication with a
[Scout](https://base14.io) backend.

| Command | Description |
|---------|-------------|
| [login](./scout-access/login.md) | Authenticate with the Scout platform |
| [logout](./scout-access/logout.md) | Remove stored credentials |
| [status](./scout-access/status.md) | Check authentication status |
| [context](./scout-access/context.md) | Manage multiple account contexts |
| [alerts](./scout-access/alerts.md) | Query alert history |
| [logs](./scout-access/logs.md) | Query service logs |
| [metrics](./scout-access/metrics.md) | Query service metrics |
| [traces](./scout-access/traces.md) | Query distributed traces |
| [service-map](./scout-access/service-map.md) | Visualize service topology |

## OTel Config

These commands work entirely offline with no Scout account required.

| Command | Description |
|---------|-------------|
| [config validate](./otel-config/config-validate.md) | Validate an OTel Collector YAML config |
| [config init](./otel-config/config-init.md) | Generate a production-ready OTel Collector config |
| [config test](./otel-config/config-test.md) | Live-test an OTel Collector config |

:::tip No account needed
The `scout config` commands are fully open source. You can validate, generate,
and test OpenTelemetry Collector configurations without signing up for Scout.
:::

## Quick Start

**Platform users** — authenticate and start querying:

```bash
scout login --account my-org
scout logs payment-service --since 10m
scout traces payment-service --status Error
```

**Open-source users** — generate and validate a collector config:

```bash
scout config init
scout config validate --file otel-collector-config.yaml
scout config test --file otel-collector-config.yaml
```

## Global Flags

Every command accepts these flags:

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Enable verbose debug logging to stderr |
| `-a, --account <NAME>` | Override the active account context |

See [Global Flags](./reference/global-flags.md) for details.

## See Also

- [Installation](./installation.md) — install Scout CLI
- [Global Flags](./reference/global-flags.md) — flags available on every command
- [Environment Variables](./reference/environment-variables.md)
  — configure Scout via env vars
