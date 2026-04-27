---
title: Creating Alerts with pgX
description:
  Create alerts from pgX panel queries. Export ClickHouse queries to Grafana
  dashboards and configure alert rules with thresholds and notifications.
unlisted: true
keywords:
  [
    pgx alerts,
    grafana alerting,
    postgres alerts,
    clickhouse queries,
    scout alerting,
  ]
---

pgX provides a streamlined workflow for creating alerts based on the panels
in the app. This guide walks you through exporting an alert query from a pgX
panel and setting it up in Grafana's alerting system.

## Time to Complete

15-20 minutes

## What You'll Accomplish

- Generate an alert-ready pgX query from any time-series or stat panel
- Add the query to a Grafana panel
- Create and configure a Grafana alert rule

## Prerequisites

- Access to pgX and Grafana in Scout
- pgX configured and showing data for the database you want to alert on
- Permissions to create dashboards and alert rules

## Overview

The alert creation process involves three main steps:

1. **Show Alert Query from pgX**: Use the panel's **Show alert query** menu
   item to generate a ClickHouse query based on the panel's current filters
   and metric.
2. **Add Query to Dashboard**: Create or add the query to a Grafana dashboard
   with the correct datasource configuration.
3. **Create Alert Rule**: Configure the alert rule from the dashboard panel
   with thresholds and notification settings.

## Step 1: Show Alert Query from pgX

### Generate the Query

1. Open the **pgX** application in Scout
2. Configure your panel filters at the top of the page:
   - Select the **Environment** and **Cluster** you want to monitor
   - On the Queries tab, optionally narrow by Database, User, or Query Type
3. Pick the panel you want to alert on. The **Show alert query** option is
   available on time-series and stat panels (the three-dot menu in the
   top-right corner of each panel)
4. Click the panel's three-dot menu, then click **Show alert query**

### Understanding the Generated Query

The exported query is a ClickHouse SQL statement that:

- Reads the same metric the panel reads
- Carries over the panel's environment, cluster, database, user, and query-type
  filters as literal values
- Uses Vertamedia macros for the time range, table, and bucket alignment so
  the alert engine can re-evaluate it against any time window

Example query structure:

```sql
SELECT
    $timeSeries as t,
    anyLast(Value)
FROM $table
WHERE $timeFilter
  AND MetricName = 'pg_up'
  AND ServiceName in ('pgdashex')
  AND Attributes['cluster'] = 'prod-db'
GROUP BY t
ORDER BY t
```

The macros are expanded by the ClickHouse datasource at evaluation time:

| Macro | Expands to |
|-------|------------|
| `$timeFilter` | `TimeUnix >= toDateTime64(...) AND TimeUnix <= toDateTime64(...)` |
| `$table` | The configured database and table (e.g. `acme-corp.otel_metrics_gauge`) |
| `$timeSeries` | A bucketed millisecond timestamp aligned to the evaluation interval |

### Copy the Query

1. In the **Alert Query** dialog, review the generated SQL query
2. Click the **"Copy Query"** button to copy it to your clipboard
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
   - **Table**: Enter `otel_metrics_gauge`
   - **Timestamp Type**: Select `DateTime64`
   - **Timestamp Column**: Enter `TimeUnix`

### Add Your Query

1. Switch to **SQL Editor** mode (toggle button or "Edit SQL" option)
2. Paste the alert query you copied from pgX

### Configure the Visualization

1. Set panel title (e.g., "PostgreSQL Up")
2. Configure value options, thresholds, and colors as needed
3. Click **"Apply"** to save the panel

### Save the Dashboard

1. Click **"Save dashboard"** (disk icon)
2. Give your dashboard a meaningful name
3. Optionally add it to a folder
4. Click **"Save"**

## Step 3: Create Alert Rule

Now that you have a dashboard panel with your pgX query, you're ready to
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

## Verification

1. Use **Preview alerts** to confirm the rule evaluates successfully
2. Set a short evaluation interval temporarily to validate behavior
3. Trigger a known database condition and verify the alert transitions to
   Firing (e.g., stop the monitored database to test a `pg_up` alert)

## Best Practices

### Query Scoping

1. **Pick a specific cluster**: Always set the cluster filter in pgX before
   exporting — alerts on the implicit "all clusters" set are usually noisy
2. **Pick a specific database/user/query** when alerting on per-query metrics
   (Queries tab drawer) so the alert tracks one concrete thing

## Troubleshooting

If the alert doesn't fire as expected:

1. Confirm the panel query returns a non-zero value in the chosen time range
2. Verify the table is `otel_metrics_gauge` and the timestamp column is
   `TimeUnix` with type `DateTime64`
3. Ensure the rule uses the same datasource and query as the panel
4. Use an evaluation interval of at least 5 minutes — narrower windows can
   give zero data points

## Next Steps

- [Dashboards and Alerts](../operate/dashboards-and-alerts.md) - General
  dashboard and alerting overview
- [Grafana Alerting Documentation](https://grafana.com/docs/grafana/latest/alerting/)
  \- Official Grafana alerting guide
