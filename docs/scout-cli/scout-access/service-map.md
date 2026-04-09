---
title: scout service-map
sidebar_label: service-map
sidebar_position: 9
description:
  Visualize service topology and dependencies from the Scout platform. View
  service-to-service communication patterns in the terminal or as JSON.
keywords:
  - service map
  - service topology
  - service dependencies
  - scout cli service map
  - microservices topology
---

# scout service-map

Visualize service dependencies and topology. Shows which services communicate
with each other, the span names involved, and when the connections were last
observed.

![scout service-map demo](/img/scout-cli/08-service-map.gif)

## Usage

```bash
scout service-map [flags]
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--service` | string | — | Filter to specific services. Repeatable |
| `--since` | duration | `1h` | Time window (max: 1 hour). Conflicts with `--start` |
| `--start` | RFC 3339 | — | Start time. Conflicts with `--since` |
| `--end` | RFC 3339 | — | End time. Requires `--start` |
| `--raw` | bool | `false` | Output JSON |
| `--interactive` | bool | `false` | Launch interactive TUI view |

## Examples

Show the full service topology:

```bash
scout service-map
```

Filter to specific services:

```bash
scout service-map --service payment --service notification
```

Show topology for the last 30 minutes:

```bash
scout service-map --since 30m
```

Launch the interactive terminal view:

```bash
scout service-map --interactive
```

Export as JSON for further analysis:

```bash
scout service-map --raw
```

:::tip
Use `--interactive` to explore the service topology in a terminal-based UI that
lets you navigate between services and their connections.
:::

:::note
The maximum time range is 1 hour. Dependencies are grouped by source and target
service pairs with deduplicated span names.
:::

## See Also

- [traces](./traces.md) — query distributed traces
- [logs](./logs.md) — query service logs
- [metrics](./metrics.md) — query service metrics
