---
title: traceX
sidebar_label: traceX
sidebar_position: 1
description:
  Explore and analyze OpenTelemetry traces with traceX in Base14 Scout.
  Visualize distributed traces, service flows, and latency patterns.
keywords:
  [
    tracex,
    trace explorer,
    opentelemetry traces,
    distributed tracing,
    grafana traces,
    otel traces,
    trace analysis,
    span visualization,
    scout
  ]
---

traceX is a trace explorer Grafana app built into Base14 Scout. It provides
deep visibility into your OpenTelemetry traces with waterfall visualizations,
service flow diagrams, and advanced filtering.

traceX queries traces stored in the Scout Telemetry Data Lake and integrates
with other Base14 Scout apps like logX for complete observability.

![traceX Overview](/img/tracex/overview.png)

---

## Interface Overview

The traceX interface consists of:

| Section | Description |
| ------- | ----------- |
| **Filters** | Service name, environment, span name dropdowns, time picker |
| **Filter Sidebar** | Collapsible panel for attribute-based filtering |
| **Active Filters** | Badges showing currently applied filters |
| **Heatmap** | Duration distribution visualization over time |
| **Table** | List of spans with expandable details |

---

## Getting Started

### Select Service and Environment

1. Use the **Service Name** dropdown to select one or more services
2. Use the **Environment** dropdown to filter by environment
3. Optionally select a **Span Name** to focus on specific operations
4. Set the **Time Range** using the time picker

### Time Range Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| **Max Time Range** | `1h` | Maximum time range for queries |
| **Max Unfiltered Range** | `15m` | Maximum time range when no service/environment is selected |

- For time ranges **up to 15 minutes**: Select any time range and browse
  traces directly
- For time ranges **longer than 15 minutes**: Select a **Service Name** and
  **Environment** first

### Browse Traces

Traces appear in the Traces Panel showing:

- Timestamp
- Trace ID
- Service name
- Span count
- Duration
- Status

Click any trace to open the detailed view.

---

## Trace Details View

When you click a trace, you'll see comprehensive trace analysis:

![Trace Details](/img/tracex/trace-details-view.png)

### Waterfall Visualization

- Hierarchical view of all spans in the trace
- Horizontal timeline showing duration and timing
- Color-coded by service
- Click any span to see its details on the right sidebar

### Service Flowchart

- Interactive diagram showing service-to-service calls
- Nodes represent services involved in the trace
- Edges show call relationships
- Error badges on services with failures
- Click a service to see its spans

![Service Flow](/img/tracex/service-flowchart.png)

### Span Details

When you select a span, you'll see:

- **Attributes tab** — Span attributes (key-value pairs)
- **Resource Attributes tab** — Resource context information
- **Events tab** — Span events with timestamps
- **Links tab** — Links to related traces

---

## Heatmap

The heatmap shows span duration distribution over time:

![Heatmap](/img/tracex/heatmap.png)

- **X-axis**: Time
- **Y-axis**: Duration buckets
- **Color intensity**: Frequency of spans in that bucket

Use the heatmap to:

- Identify latency patterns
- Spot performance degradation
- Find outlier requests

---

## Filtering Traces

### Using the Filter Sidebar

1. Click the expand(`>`) icon to open the sidebar
2. Choose a category: **Resource Attributes**, **Span Attributes**, or **Trace Fields**
3. Click an attribute to see available values
4. Select values to add filters (use `+` to include, `-` to exclude)

### Using Active Filters

- Active filters appear as badges above the heatmap
- Click **-** on a badge to remove that filter
- Click **Clear all** to remove all filters

### Duration Filtering

Filter traces by duration to find slow requests or quick operations.

---

## logX Integration

traceX integrates with logX for log-trace correlation:

1. View a trace in traceX
2. See correlated logs in logX using the same Trace ID
3. Navigate between logs and traces seamlessly

---

## Configuration

Access configuration at **Administration** → **Plugins** → **traceX** → **Configuration**.

| Setting | Description | Default |
| ------- | ----------- | ------- |
| **Database Name** | ClickHouse database | `default` |
| **Environments** | Comma-separated list | `staging,production` |
| **Environment Attribute Key** | Resource attribute for env | `environment` |
| **Max Time Range** | Maximum query range | `1h` |
| **Max Unfiltered Range** | Max range without filters | `15m` |
| **Max Variable Options** | Dropdown option limit | `100` |
| **Show Search Bar** | Toggle search panel | `false` |
| **Enable RBAC Filtering** | Team-based service filtering | `false` |

---

## RBAC (Role-Based Access Control)

When enabled, service visibility is restricted based on Grafana team membership:

- Teams must follow naming pattern: `{ServiceName}-{Role}` (e.g., `api-gateway-Viewer`)
- Users only see services from teams they belong to
- All queries are automatically filtered to permitted services

---

## URL Parameters

traceX state is persisted in the URL for bookmarking and sharing:

| Parameter | Description |
| --------- | ----------- |
| `from` / `to` | Time range |
| `var-service_name` | Selected services |
| `var-environment` | Selected environment |
| `var-span_name` | Selected span name |
| `traceId` | Open specific trace details |

Share the URL to give others the exact same view.

---

## Related Guides

- [logX](../logx/index.md) — Log explorer with trace correlation
