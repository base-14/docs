---
title: scout metrics
sidebar_label: metrics
sidebar_position: 7
description:
  Query service metrics from the Scout platform. Filter by metric type and name.
  View metric names, types, descriptions, and activity timestamps.
keywords:
  - scout metrics
  - metric query
  - opentelemetry metrics
  - scout cli metrics
  - service metrics
---

# scout metrics

Query metrics for a specific service from the Scout platform. Lists metric
names, types, descriptions, and when they were first and last seen.

![scout metrics demo](/img/scout-cli/06-metrics.gif)

## Usage

```bash
scout metrics <SERVICE> [flags]
```

## Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `SERVICE` | string | *(required)* Service name to query metrics for |

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--since` | duration | `1h` | Time window (max: 1 hour). Conflicts with `--start` |
| `--start` | RFC 3339 | — | Start time. Conflicts with `--since` |
| `--end` | RFC 3339 | — | End time. Requires `--start` |
| `--type` | string | — | Filter by metric type (e.g., `counter`, `gauge`, `histogram`) |
| `--search` | string | — | Filter metrics by name substring (case-insensitive) |
| `--wide` | bool | `false` | Show full descriptions without truncation |
| `--raw` | bool | `false` | Output JSON |

## Examples

List all metrics for a service:

```bash
scout metrics payment-service
```

Filter by metric type:

```bash
scout metrics payment-service --type histogram
```

Search by metric name:

```bash
scout metrics payment-service --search latency
```

Combine type and search filters:

```bash
scout metrics payment-service --type counter --search request
```

Show full descriptions:

```bash
scout metrics payment-service --wide
```

Output as JSON:

```bash
scout metrics payment-service --raw
```

:::note
The maximum time range is 1 hour. Metrics are sorted alphabetically by name in
the default output.
:::

## See Also

- [logs](./logs.md) — query service logs
- [traces](./traces.md) — query distributed traces
- [alerts](./alerts.md) — query alert history
