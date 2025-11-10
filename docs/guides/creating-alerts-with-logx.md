---
title: Creating Alerts with LogX
description:
  Create alerts from LogX log queries. Export ClickHouse queries to Grafana
  dashboards and configure alert rules with thresholds and notifications.
keywords:
  [
    logx alerts,
    grafana alerting,
    log-based alerts,
    clickhouse queries,
    scout alerting,
  ]
---

LogX provides a streamlined workflow for creating alerts based on your log
queries. This guide walks you through the process of exporting an alert query
from LogX and setting it up in Grafana's alerting system.

## Overview

The alert creation process involves three main steps:

1. **Explore Alert Query from LogX**: Use the "Explore Alert Query" button to
   generate a ClickHouse query based on your current filters and search
   criteria.
2. **Add Query to Dashboard**: Create or add the query to a Grafana dashboard
   with the correct datasource configuration.
3. **Create Alert Rule**: Configure the alert rule from the dashboard panel
   with thresholds and notification settings.

## Step 1: Explore Alert Query from LogX

### Generate the Query

1. Open the **LogX** application in Scout
2. Configure your log filters:
   - Select the service you want to monitor
   - Add resource attribute filters (e.g., `host.name`,
     `deployment.environment`)
   - Add log attribute filters as needed
   - Apply body search terms or regex patterns
3. Verify your filters are showing the logs you want to alert on
4. Click the **"Explore Alert Query"** button in the header controls

### Understanding the Generated Query

The exported query is a ClickHouse SQL statement that:

- Counts log entries matching your filters
- Includes all active filters (resource attributes, log attributes, body
  search)
- Returns a single numeric value (count of matching logs)

Example query structure:

```sql
SELECT count(*) as value
FROM $table
WHERE $timeFilter
  AND ServiceName = 'api-service'
  AND ResourceAttributes['environment'] = 'production'
  AND ResourceAttributes['host.name'] IN ('server-1', 'server-2')
```

### Copy the Query

1. In the **Alert Query Dialog**, review the generated SQL query
2. Click the **"Copy Explore Query"** button to copy it to your clipboard
3. Close the dialog

## Step 2: Add Query to a Dashboard

### Create or Open a Dashboard

1. Navigate to **Dashboards**
2. Either:
   - Create a new dashboard by clicking **"New Dashboard"**
   - Open an existing dashboard where you want to add the alert

### Add a New Panel

1. Click **"Add"** → **"Visualization"** to add a new panel
2. Configure the panel settings:

### Configure the Datasource

In the query editor:

1. **Datasource**: Select `DS_ScoutAltCH` (Scout Altinity ClickHouse
   datasource)
2. Click on the **Query Options** or **Settings** (gear icon)
3. Configure the following settings:
   - **Database**: Enter your organization name (e.g., `acme-corp`)
   - **Table**: Enter `otel_logs`
   - **Timestamp Type**: Select `DateTime64`
   - **Timestamp Column**: Enter `Timestamp`

### Add Your Query

1. Switch to **SQL Editor** mode (toggle button or "Edit SQL" option)
2. Paste the alert query you copied from LogX

### Configure the Visualization

1. Set panel title (e.g., "Production API Errors")
2. Configure value options, thresholds, and colors as needed
3. Click **"Apply"** to save the panel

### Save the Dashboard

1. Click **"Save dashboard"** (disk icon)
2. Give your dashboard a meaningful name
3. Optionally add it to a folder
4. Click **"Save"**

## Step 3: Create Alert Rule

Now that you have a dashboard panel with your log query, you're ready to
create the alert rule.

1. On your dashboard, locate the panel you just created
2. Click the **panel title** or **three dots (⋮)** menu
3. Select **"More..."** → **"New alert rule"**

That's it! Now you can follow the comprehensive
[Creating Alerts in Grafana](https://grafana.com/docs/grafana/latest/alerting/alerting-rules/create-grafana-managed-rule/)
guide to configure your alert rule, set thresholds, configure notifications, and
test your alert.

The general alerting guide covers:

- Setting alert rule names and descriptions
- Defining query conditions and thresholds
- Configuring evaluation behavior and timing
- Adding alert details and templates
- Setting up notifications and contact points
- Testing and troubleshooting alerts
- Best practices for alerting

## Best Practices

### Query Optimization

1. **Use Specific Filters**: Narrow down logs to reduce query load
   - Filter by service name
   - Use environment filters
   - Apply relevant attribute filters

2. **Avoid Wildcards**: Be specific in your search patterns
   - Good: `ServiceName = 'api-service'`
   - Avoid: `ServiceName LIKE '%api%'`

## Related Guides

- [Dashboards and Alerts](../operate/dashboards-and-alerts.md)
  General dashboard and
  alerting overview
- [Grafana Alerting Documentation](https://grafana.com/docs/grafana/latest/alerting/)
  \- Official Grafana alerting guide
