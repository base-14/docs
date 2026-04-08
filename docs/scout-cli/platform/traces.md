---
title: scout traces
sidebar_label: traces
sidebar_position: 8
description:
  Query distributed traces from the Scout platform. Filter by span name, status
  code, attributes, and time range. Drill into individual traces by ID.
keywords:
  - scout traces
  - distributed tracing
  - trace query
  - opentelemetry traces
  - scout cli traces
  - span search
---

# scout traces

Query traces and spans for a specific service from the Scout platform. Filter by
span name, status code, attributes, and time range.

![scout traces demo](/img/scout-cli/07-traces.gif)

## Usage

```bash
scout traces <SERVICE> [flags]
```

## Arguments

| Argument | Type | Description |
|----------|------|-------------|
| `SERVICE` | string | *(required)* Service name to query traces for |

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--span` | string | — | Filter by span name. Repeatable (OR logic) |
| `--status` | string | — | Filter by status code. Repeatable. Values: `Unset`, `Ok`, `Error` (case-insensitive) |
| `--attr` | KEY=VALUE | — | Filter by span attribute. Repeatable (AND logic) |
| `--resource` | KEY=VALUE | — | Filter by resource attribute. Repeatable (AND logic) |
| `--since` | duration | `5m` | Time window (max: 15 minutes). Conflicts with `--start` |
| `--start` | RFC 3339 | — | Start time. Conflicts with `--since` |
| `--end` | RFC 3339 | — | End time. Requires `--start` |
| `--limit` | integer | `50` | Maximum number of results (max: 100) |
| `--raw` | bool | `false` | Output JSON |
| `--discover` | bool | `false` | Show available span metadata instead of querying |
| `--id` | string | — | Drill into a specific trace by ID. Extends the time window to 60 minutes |

## Examples

Query recent traces:

```bash
scout traces payment-service
```

Filter by span name:

```bash
scout traces payment-service --span checkout --span payment
```

Filter by error status:

```bash
scout traces payment-service --status Error
```

Filter by attributes:

```bash
scout traces payment-service --attr user_id=123 --resource environment=prod
```

Drill into a specific trace:

```bash
scout traces payment-service --id abc123def456
```

Discover available span names and attributes:

```bash
scout traces payment-service --discover
```

## Filtering Logic

- **`--span`** — Multiple values use OR logic (matches any of the given span
  names)
- **`--status`** — Multiple values use OR logic. Valid values: `Unset`, `Ok`,
  `Error` (case-insensitive)
- **`--attr` and `--resource`** — Multiple values use AND logic (all conditions
  must match)

:::tip
Use `--discover` to see available span names, status codes, and attribute keys
before building a targeted query.
:::

:::note
When using `--id` to drill into a specific trace, the time window is
automatically extended to 60 minutes to ensure the full trace is captured.
:::

## Time Ranges

| Method | Max Window |
|--------|-----------|
| `--since` | 15 minutes |
| `--start` / `--end` | 30 minutes |
| `--id` | 60 minutes |

## See Also

- [logs](./logs.md) — query service logs
- [metrics](./metrics.md) — query service metrics
- [service-map](./service-map.md) — visualize service topology
