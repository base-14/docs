---
title: Create Your First Dashboard
sidebar_label: Create Your First Dashboard
sidebar_position: 3
description:
  Simple step-by-step guide to creating your first dashboard in Scout using
  Grafana. Learn to visualize metrics, traces, and logs correctly.
keywords:
  [
    grafana dashboard,
    create dashboard,
    scout dashboard,
    metrics visualization,
    dashboard guide,
    grafana queries,
  ]
---

# Create Your First Dashboard

This guide walks you through creating your first dashboard in Scout. You'll
learn how to explore available metrics, build queries correctly, and visualize
your telemetry data in Grafana.

## Prerequisites

- Access to Scout dashboard with Grafana
- Telemetry data flowing from your instrumented applications
- Basic understanding of your services and environments

## Step 1: Start from the Metrics Collected Dashboard

Before creating a dashboard, explore the pre-built **Metrics Collected**
dashboard to understand what data is available.

1. Open the **Metrics Collected** dashboard
2. Select:
   - **Environment** - Choose the desired environment (e.g., production,
     staging)
   - **Service Name** - Pick the service you want to monitor
3. Find the **metric you want to visualize** (from the list or search)
4. Use this dashboard to inspect:
   - **Last 5 values** of the metric
   - **Resource Attributes** and **Attributes** - Note these for filtering
     later

> **Note**: Record the metric name and relevant attributes. You'll use these
> when writing queries later.

## Step 2: Create a New Dashboard and Add a Panel

1. Go to **Dashboards → New → New Dashboard**
2. Add a **New Panel**

## Step 3: Configure Data Source and Query Settings

### Always Select DS_ScoutAltCH for Data Source

Always choose **DS_ScoutAltCH** as your data source.

### Query Settings by Table

Configure the query settings based on which table you're using. The key
difference is the **Timestamp Column** setting.

| Table                    | Database       | Column Type | Timestamp Column | Date Column |
| ------------------------ | -------------- | ----------- | ---------------- | ----------- |
| `otel_metrics_sum`       | `<org name>` | `DateTime64` | `TimeUnix`       | Leave default |
| `otel_metrics_gauge`     | `<org name>` | `DateTime64` | `TimeUnix`       | Leave default |
| `otel_metrics_histogram` | `<org name>` | `DateTime64` | `TimeUnix`       | Leave default |
| `otel_metrics_summary`   | `<org name>` | `DateTime64` | `TimeUnix`       | Leave default |
| `otel_logs`              | `<org name>` | `DateTime64` | `TimestampTime`  | Leave default |
| `otel_traces`            | `<org name>` | `DateTime64` | `Timestamp`      | Leave default |

> **Important**: For metrics tables, use `TimeUnix`. For logs, use
> `TimestampTime`. For traces, use `Timestamp`.

## Step 4: Write Your Query

Use this template for your query:

```sql
SELECT ...
FROM $table
WHERE $timeFilter
  AND ServiceName = '<service_name>'
  AND <MetricName|SpanName> = '<metric_name>'
  AND ResourceAttributes['environment'] = '<environment>'
```

### Required WHERE Conditions

Each query **must include** the following WHERE conditions:

1. **`$timeFilter`** - Grafana's time range filter (always required)
2. **`ServiceName = 'value'`** - The service you're monitoring
3. **`<MetricName|SpanName> = 'value'`** - Use `MetricName` for metrics/logs,
   `SpanName` for traces
4. **`ResourceAttributes['environment'] = 'value'`** - The environment (e.g.,
   production, staging)

### Time Series Configuration

For time series queries, make sure the **Step** field below the query is set
to **`1m`** (1 minute).

### Adding More Filters

You can add more filters based on `Attributes` or `ResourceAttributes` for
deeper insights:

```sql
AND Attributes['http.method'] = 'GET'
AND ResourceAttributes['host.name'] = 'server-01'
```

## Step 5: Example Panel Query

Here's a complete example for a CPU usage metric (gauge):

```sql
SELECT
  $timeSeries AS t,
  avg(Value) AS cpu_usage
FROM otel_metrics_gauge
WHERE $timeFilter
  AND ServiceName = 'backend-service'
  AND MetricName = 'system.cpu.usage'
  AND ResourceAttributes['environment'] = 'production'
GROUP BY t
ORDER BY t
```

## Step 6: Save and Organize

Once your panel displays data correctly:

1. Click **Apply** to save the panel
2. Click **Save dashboard** (disk icon in top right)
3. Give your dashboard a descriptive name
4. Save it in the **Drafts** folder initially
5. Review the dashboard with your team or QA
6. Move it to the appropriate folder once approved

### Recommended Folder Organization

- **Drafts** - Work-in-progress dashboards
- **Production** - Approved production monitoring dashboards
- **Development** - Development environment dashboards
- **Team-specific folders** - Organized by team or service

## Dashboard Creation Checklist

Before finalizing your dashboard, verify:

- [ ] Data Source = `DS_ScoutAltCH`
- [ ] Correct table and timestamp settings
- [ ] `$timeFilter` included in query
- [ ] Step = `1m` for time series
- [ ] Required filters: ServiceName, MetricName/SpanName, environment
- [ ] Dashboard saved under correct folder

## Best Practices

### Query Performance

- Always include `$timeFilter` to limit data scanning
- Add ServiceName filter to reduce query scope
- Use specific metric names rather than wildcards

### Dashboard Organization

- Group related panels together
- Use descriptive panel titles and descriptions
- Keep dashboards focused on specific services or use cases

## Troubleshooting

### No Data Displayed

1. Verify the time range includes data
2. Check that ServiceName matches exactly (case-sensitive)
3. Confirm MetricName is spelled correctly
4. Verify environment filter matches your data

### Query Errors

1. Ensure `$timeFilter` is included in WHERE clause
2. Verify table name matches query settings
3. Check timestamp column is correctly configured
4. Validate SQL syntax (commas, quotes, brackets)

## Related Guides

- [Creating Alerts with LogX](creating-alerts-with-logx.md) - Set up alerts
  based on your dashboard queries
- [Quick Start](quick-start.md) - Get Scout set up and sending data

## References

- [Grafana Dashboard Documentation](https://grafana.com/docs/grafana/latest/dashboards/)
  Learn about dashboard basics and panel types
- [Time Series Panel](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/time-series/)
  Understanding time series visualizations in Grafana
