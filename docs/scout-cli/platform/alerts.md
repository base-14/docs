---
title: scout alerts
sidebar_label: alerts
sidebar_position: 5
description:
  Query alert history from the Scout platform. Filter by time range, tags,
  and dashboard.
keywords:
  - scout alerts
  - alert history
  - observability alerts
  - scout cli alerts
  - alert query
---

# scout alerts

Query alert history from the Scout platform. Results include alert name, state,
previous state, timestamp, dashboard UID, and tags.

![scout alerts demo](/img/scout-cli/04-alerts.gif)

## Usage

```bash
scout alerts [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--limit` | integer | `20` | Maximum number of results (1–100) |
| `--since` | duration | — | Time window (e.g., `2h`, `1d`). Max: 7 days. Conflicts with `--start` |
| `--start` | RFC 3339 | — | Start time. Conflicts with `--since` |
| `--end` | RFC 3339 | — | End time. Requires `--start` |
| `--tag` | string | — | Filter by tag. Repeatable for multiple tags |
| `--dashboard` | string | — | Filter by dashboard UID |
| `--raw` | bool | `false` | Output JSON |

## Examples

Query the 20 most recent alerts:

```bash
scout alerts
```

Query alerts from the last 2 hours:

```bash
scout alerts --since 2h
```

Query alerts in a specific time range:

```bash
scout alerts --start 2026-03-26T14:00:00Z --end 2026-03-26T16:00:00Z
```

Filter by tag:

```bash
scout alerts --tag critical --tag payment
```

Filter by dashboard and output JSON:

```bash
scout alerts --dashboard abc123 --raw
```

Get more results:

```bash
scout alerts --since 1d --limit 100
```

## Time Ranges

Use `--since` for relative time windows or `--start`/`--end` for absolute
ranges. These two approaches are mutually exclusive.

| Flag | Format | Example |
|------|--------|---------|
| `--since` | Duration string | `30m`, `2h`, `1d` |
| `--start` | RFC 3339 | `2026-03-26T14:00:00Z` |
| `--end` | RFC 3339 | `2026-03-26T16:00:00Z` |

:::warning
The maximum time range is 7 days. Queries exceeding this limit will return an
error.
:::

## See Also

- [logs](./logs.md) — query service logs
- [traces](./traces.md) — query distributed traces
- [metrics](./metrics.md) — query service metrics
