---
title: scout logs
sidebar_label: logs
sidebar_position: 6
description:
  Query service logs from the Scout platform. Filter by severity, body text,
  attributes, trace ID, and time range.
keywords:
  - scout logs
  - log query
  - opentelemetry logs
  - scout cli logs
  - service logs
  - log search
---

# scout logs

Query logs for a specific service from the Scout platform. Filter by severity,
body content, attributes, and more.

![scout logs demo](/img/scout-cli/05-logs.gif)

## Usage

```bash
scout logs <SERVICE> [flags]
```

## Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `SERVICE` | string | *(required)* Service name to query logs for |

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--severity` | string | — | Severity levels, comma-delimited. Repeatable. Values: `INFO`, `WARN`, `ERROR`, `DEBUG`, `FATAL` |
| `--contains` | string | — | Filter by body substring (case-insensitive) |
| `--attr` | KEY=VALUE | — | Filter by log attribute. Repeatable (AND logic) |
| `--resource` | KEY=VALUE | — | Filter by resource attribute. Repeatable (AND logic) |
| `--trace-id` | string | — | Filter by trace ID |
| `--since` | duration | `5m` | Time window (max: 15 minutes). Conflicts with `--start` |
| `--start` | RFC 3339 | — | Start time. Conflicts with `--since` |
| `--end` | RFC 3339 | — | End time. Requires `--start` |
| `--limit` | integer | `100` | Maximum number of results (max: 1000) |
| `--raw` | bool | `false` | Output JSON |
| `--body-only` | bool | `false` | Output only log bodies, one per line. Conflicts with `--raw` |
| `--discover` | bool | `false` | Show available log metadata instead of querying |
| `--wide` | bool | `false` | Show full log bodies without truncation |

## Examples

Query recent logs for a service:

```bash
scout logs payment-service
```

Filter by severity:

```bash
scout logs payment-service --severity ERROR,WARN
```

Search log bodies:

```bash
scout logs payment-service --contains "timeout" --since 10m
```

Filter by attributes:

```bash
scout logs payment-service --attr user_id=123 --resource environment=prod
```

Correlate with a trace:

```bash
scout logs payment-service --trace-id abc123def456
```

Output only log bodies:

```bash
scout logs payment-service --body-only
```

Discover available metadata:

```bash
scout logs payment-service --discover
```

## Attribute Filtering

Use `--attr` and `--resource` to filter by key-value pairs. Multiple filters of
the same type use AND logic.

```bash
# Both conditions must match
scout logs payment-service --attr user_id=123 --attr action=checkout
```

:::tip
Use `--discover` to see available attribute keys and severity values before
building a targeted query.
:::

:::warning
The maximum time range is 15 minutes. For longer queries, use `--start` and
`--end` with explicit timestamps.
:::

## See Also

- [traces](./traces.md) — query distributed traces
- [metrics](./metrics.md) — query service metrics
- [alerts](./alerts.md) — query alert history
