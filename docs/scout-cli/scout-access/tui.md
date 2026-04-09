---
title: TUI Mode
sidebar_label: TUI Mode
sidebar_position: 10
description:
  Launch the Scout interactive terminal dashboard. View service health, alerts,
  dependencies, and logs in a real-time terminal UI.
keywords:
  - scout tui
  - terminal ui
  - interactive dashboard
  - scout cli dashboard
  - service health dashboard
---

# TUI Mode

Running `scout` without a subcommand launches an interactive terminal dashboard.
The TUI provides a real-time view of service health, alerts, dependencies, and
logs — all from your terminal.

![scout TUI demo](/img/scout-cli/12-tui.gif)

## Usage

```bash
scout
```

:::note
TUI mode requires an active authentication session. Run
[`scout login`](./login.md) first.
:::

## Views

The TUI has three main views, accessible via keyboard navigation.

### Home

The default landing view shows a health summary dashboard with three sections
(cycle with `Tab`):

| Section | Description |
|---------|-------------|
| **Heatmap** | Service health visualization. Switch modes with `1`–`4`: error rate, latency, alerts, dependencies |
| **Alerts** | Active and firing alerts with rule names, severity, and timestamps |
| **Services** | Table of all services with error rates, latency, last-seen timestamps, and dependency counts |

In the Services section, sort by different columns:

| Key | Sort By |
|-----|---------|
| `e` | Error rate |
| `l` | Latency |
| `n` | Name |
| `d` | Dependencies |
| `t` | Status |
| `o` | Last seen |

### Services

A searchable list of all discovered services. Filter by name with `/`, then
press `Enter` to confirm or `Esc` to clear. Select a service and press `L` to
view its logs.

### Logs

A live log stream for the selected service. Shows timestamp, severity, and
message body. Press `Enter` to expand a log entry and view trace ID, span ID,
attributes, and resource metadata.

| Feature | Key |
|---------|-----|
| Toggle autoscroll | `s` (fetches new logs every 2 seconds) |
| Toggle line wrap | `w` |
| Filter logs | `/` |
| Expand/collapse entry | `Enter` |
| Horizontal scroll (wrap off) | `Left` / `Right` |

## Keyboard Shortcuts

### Global

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Force quit |
| `?` | Toggle help overlay |
| `r` | Refresh data |
| `j` / `Down` | Move down |
| `k` / `Up` | Move up |
| `g` | Jump to top |
| `G` | Jump to bottom |

### Home View

| Key | Action |
|-----|--------|
| `Tab` | Cycle sections (Heatmap, Alerts, Services) |
| `1`–`4` | Switch heatmap mode (error rate, latency, alerts, dependencies) |
| `Left` / `Right` | Page through heatmap |
| `Enter` | Open alert URL or view selected service |
| `s` | Switch to Services view |

### Services View

| Key | Action |
|-----|--------|
| `/` | Enter filter mode |
| `L` | View logs for selected service |
| `Esc` | Back to Home |

### Logs View

| Key | Action |
|-----|--------|
| `s` | Toggle autoscroll |
| `w` | Toggle line wrap |
| `/` | Filter logs |
| `Enter` | Expand/collapse log detail |
| `Left` / `Right` | Horizontal scroll (wrap off) |
| `Home` / `End` | Jump to start/end of line |
| `Esc` | Close detail or go back to Services |

## Auto-Refresh

The TUI refreshes data automatically in the background:

| Data | Interval |
|------|----------|
| Services and topology | Every 30 seconds |
| Health summary | Every 30 seconds |
| Logs (autoscroll on) | Every 2 seconds |

Press `r` at any time to trigger an immediate refresh.

## See Also

- [login](./login.md) — authenticate before launching the TUI
- [logs](./logs.md) — query logs from the command line
- [service-map](./service-map.md) — view service topology from the command line
