---
title: Create Your First Alert
sidebar_label: Create Your First Alert
sidebar_position: 4
description:
  Step-by-step guide to creating your first alert in Scout. Walk through
  contact points, a ClickHouse-backed alert rule, notification routing, and
  verifying the alert fires.
keywords:
  [
    scout alerting,
    grafana alerting,
    create alert,
    alert rule,
    contact point,
    notification policy,
    clickhouse alerts,
  ]
---

# Create Your First Alert

This guide walks you through creating your first alert in Scout, end to end:
from a ClickHouse query to a notification landing in your inbox or Slack
channel. Scout uses Grafana-managed alert rules, so everything here happens in
the **Alerting** section of Scout's Grafana.

If you already have a query from [LogX](creating-alerts-with-logx.md),
[pgX](creating-alerts-with-pgx.md), or a
[dashboard panel](create-your-first-dashboard.md), you can bring it straight
into Step 2.

## Time to Complete

20-30 minutes

## What You'll Accomplish

- Create a contact point so notifications have somewhere to go.
- Create and configure a Grafana-managed alert rule over your telemetry.
- Route the alert to the right people with a notification policy.
- Verify the alert evaluates and fires.

## Prerequisites

- Access to Scout with Grafana.
- Permissions to create alert rules and contact points.
- Telemetry flowing into Scout for the service you want to alert on.
- Optionally, an alert query from LogX, pgX, or a dashboard panel.

## How Alerting Works in Scout

Scout's platform is fully compatible with the Grafana API, so alerts are
standard **Grafana-managed alert rules** evaluated against the
`DS_ScoutAltCH` ClickHouse datasource. Four concepts work together:

| Concept | What it does |
| ------- | ------------ |
| **Alert rule** | A query plus a condition, evaluated on a schedule. When the condition holds, the rule fires. |
| **Contact point** | Where a notification is delivered (email, Slack, webhook, and more). |
| **Notification policy** | Routes firing alerts to contact points by matching their labels. |
| **Evaluation** | The schedule and pending period that decide when a rule moves from Normal to Pending to Firing. |

You'll set up a contact point first, then build the rule that uses it.

## Step 1: Create a Contact Point

A contact point is the destination for a notification. Set one up before
creating the rule so you can route to it immediately.

1. Open **Alerting → Contact points**
2. Click **Add contact point**
3. Enter a **Name** (e.g., `oncall-email` or `platform-slack`)
4. Choose an **Integration** and fill in its settings:
   - **Email** - one or more addresses
   - **Slack** - a webhook URL or token, plus the target channel
   - **Webhook** - an endpoint URL for custom integrations
5. Click **Test** to send a sample notification and confirm delivery
6. Click **Save contact point**

![Create a contact point in Scout's Alerting section](/img/alerting/creating-your-first-alert/contact-point.png)

## Step 2: Create an Alert Rule

The rule defines *what* to watch and *when* to fire.

### Name the Rule

1. Open **Alerting → Alert rules**
2. Click **New alert rule**
3. Enter a clear **Name** (e.g., `Production API error spike`)

### Define the Query

The query is what the rule evaluates. It runs against the `DS_ScoutAltCH`
ClickHouse datasource and must return a **single numeric value**.

1. In the query section, select **DS_ScoutAltCH** as the datasource
2. Open **Query Options** (gear icon) and configure the settings for the table
   you're querying. **Database** is your organization name, for example
   `acme-corp`:

   | Telemetry | Database | Table | Timestamp Type | Timestamp Column |
   | --------- | -------- | ----- | -------------- | ---------------- |
   | Metrics | `<org name>` | `otel_metrics_gauge` (or `_sum`, `_histogram`, `_summary`) | `DateTime64` | `TimeUnix` |
   | Logs | `<org name>` | `otel_logs` | `DateTime64` | `TimestampTime` |
   | Traces | `<org name>` | `otel_traces` | `DateTime64` | `Timestamp` |

3. Switch to **SQL Editor** mode and enter your query. If you exported one from
   LogX or pgX, paste it here.

A log-based example that counts errors for one service:

```sql
SELECT count(*) AS value
FROM $table
WHERE $timeFilter
  AND ServiceName = 'api-service'
  AND ResourceAttributes['environment'] = 'production'
  AND SeverityText = 'ERROR'
```

`$timeFilter` and `$table` are macros the ClickHouse datasource expands at
evaluation time, so the same query re-evaluates against every time window the
alert engine checks.

![Alert rule query using the DS_ScoutAltCH ClickHouse datasource](/img/alerting/creating-your-first-alert/alert-query.png)

### Set the Condition

The condition decides whether the query result fires the rule, using Grafana's
expression pipeline.

1. Add a **Reduce** expression to collapse the series to one number - set
   **Function** to `Last` and **Input** to your query
2. Add a **Threshold** expression - set it to `IS ABOVE` your chosen value
   (e.g., `IS ABOVE 10` for more than 10 errors)
3. Make the threshold expression the **alert condition**

![Reduce and threshold expressions defining the alert condition](/img/alerting/creating-your-first-alert/alert-condition.png)

### Set the Evaluation Behavior

Evaluation controls how often the rule runs and how long the condition must
hold before firing.

1. Select a **Folder** for the rule (create one like `Alerts` if needed)
2. Select or create an **Evaluation group** and set the **Evaluation
   interval** - use at least `5m`; narrower windows can return zero data
   points against ClickHouse
3. Set the **Pending period** - how long the condition must stay true before
   the rule moves from Pending to Firing (e.g., `5m` to avoid flapping)

### Add Labels and Annotations

Labels route the alert; annotations describe it.

1. Add a **Label** such as `severity = critical` - notification policies match
   on labels
2. Add annotations to give responders context:
   - **Summary** - a one-line description (e.g., `High error rate on
     api-service`)
   - **Description** - what happened and where to look

### Configure Notifications and Save

1. Under **Notifications**, either:
   - Let the alert route through **notification policies** (default,
     recommended - see Step 3), or
   - Link it **directly to the contact point** you created in Step 1
2. Click **Save rule** (or **Save rule and exit**)

## Step 3: Route Notifications

Notification policies decide which contact point receives a firing alert, based
on the alert's labels. If you linked the rule directly to a contact point in
Step 2, you can skip this - but policies scale better as you add more rules.

1. Open **Alerting → Notification policies**
2. The **Default policy** catches everything not matched by a nested policy -
   point it at a sensible fallback contact point
3. Add a **nested policy** with a label matcher (e.g., `severity = critical`)
   and set its contact point to the one from Step 1
4. Save

Now any rule labeled `severity = critical` routes to that contact point, no
per-rule wiring needed.

## Step 4: Verify the Alert

Confirm the rule evaluates and fires before relying on it.

1. **Preview** the rule while editing to confirm the query returns data and the
   condition evaluates without errors
2. Watch the state transition on **Alerting → Alert rules**: a healthy rule
   sits at **Normal**, moves to **Pending** when the condition first holds, and
   reaches **Firing** after the pending period
3. Check **state history** to see past transitions
4. Trigger a known condition to test end to end - for a log error alert,
   generate some errors and confirm the notification arrives
5. Query recent alert activity from the terminal with the Scout CLI:

   ```bash
   scout alerts --since 1h
   ```

   See the [scout alerts](../scout-cli/scout-access/alerts.md) reference for
   filtering by tag, dashboard, and time range.

To temporarily suppress a firing alert (during maintenance, for example), add a
**Silence** under **Alerting → Silences** with matchers for the alert's labels.

## Best Practices

- **Return a single value.** The query feeding the condition must reduce to one
  number. Use `count(*)`, `avg(Value)`, or a `Reduce` expression.
- **Always include `$timeFilter`.** It scopes the scan to the evaluation window
  and keeps queries fast.
- **Use an evaluation interval of at least 5 minutes.** Narrower windows can
  yield zero data points and unreliable evaluation.
- **Scope tightly.** Filter by `ServiceName` and
  `ResourceAttributes['environment']` so the alert tracks one concrete thing
  rather than a noisy all-services aggregate.
- **Label consistently.** A shared label scheme (like `severity`) lets one
  notification policy route many rules.

## Troubleshooting

### The rule never fires

1. Confirm the query returns a non-zero value over the chosen time range
2. Verify the reduce and threshold expressions reference the right query and
   the threshold direction is correct
3. Check the evaluation interval is at least `5m`

### "No data" or query errors

1. Verify the table and timestamp column match the datasource settings
   (`TimeUnix` for metrics, `TimestampTime` for logs, `Timestamp` for traces)
2. Ensure `$timeFilter` is present in the `WHERE` clause
3. Confirm `ServiceName` matches exactly - it is case-sensitive

### The alert fires but no notification arrives

1. Test the contact point again (**Alerting → Contact points → Test**)
2. Confirm a notification policy matches the alert's labels, or that the rule
   links directly to a contact point
3. Check for an active silence covering the alert's labels

## Next Steps

- [Creating Alerts with LogX](creating-alerts-with-logx.md) - Generate an
  alert-ready query from your logs.
- [Creating Alerts with pgX](creating-alerts-with-pgx.md) - Generate an
  alert-ready query from a pgX panel.
- [Dashboards and Alerts as Code](../operate/dashboards-and-alerts.md) - Manage
  the same alert rules declaratively with Grizzly.
- [scout alerts](../scout-cli/scout-access/alerts.md) - Query alert history from
  the terminal.

## References

- [Grafana Alerting Documentation](https://grafana.com/docs/grafana/latest/alerting/)
  \- The full reference for Grafana-managed alerting.
- [Create a Grafana-managed alert rule](https://grafana.com/docs/grafana/latest/alerting/alerting-rules/create-grafana-managed-rule/)
  \- Deep dive on every alert-rule field.
