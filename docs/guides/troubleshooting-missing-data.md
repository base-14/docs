---
title: Troubleshooting Missing Telemetry Data
sidebar_label: Troubleshooting Missing Data
sidebar_position: 6
description:
  Step-by-step guide to troubleshoot missing telemetry data using Grafana
  dashboards and OpenTelemetry Collector logs.
keywords:
  [
    missing data,
    no data,
    telemetry troubleshooting,
    grafana dashboard,
    otel collector debugging,
    scout troubleshooting,
  ]
---

This guide provides a systematic approach to debug telemetry pipeline issues
by starting with Grafana dashboards, then moving to the OpenTelemetry
Collector, and finally to your application.

## Step 1: Check OTel Collector Data Flow Dashboard

Start by checking the **OTel Collector Data Flow** dashboard in Grafana.

### If No Data in Dashboard

There's an issue in the pipeline. Check the collector logs.

**If logs show errors:** Validate your collector configuration using:

```bash
otelcol validate --config=/path/to/otel-collector-config.yaml
```

Or use [otelbin.io](https://www.otelbin.io/).

**If no errors in logs and application is not throwing errors:** Verify the
receiver is configured in the pipeline:

```yaml
service:
  pipelines:
    metrics:
      receivers: [otlp]  # Ensure your receiver is listed
      exporters: [otlp]
```

### If Data Appears in Dashboard

Proceed to Step 2.

## Step 2: Check Metrics Collected Dashboard

Go to the **Metrics Collected** dashboard and select your environment.

### If You See Your Service and Data

Your telemetry is flowing correctly. Use the correct filters and dashboard
options to view your data.

### If No Data for Your Service

Check your application logs to verify it's successfully exporting telemetry.

**Look for:**

- OpenTelemetry SDK initialization messages
- Successful telemetry export confirmations
- Any SDK errors or warnings

**If application shows no errors:** Verify the receiver is used in the
collector pipeline (see Step 1).

## Related Guides

- [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md) -
  Detailed collector configuration guide
- [Auto Instrumentation](../instrument/apps/auto-instrumentation/express.md) -
  Automatic application instrumentation
- [Custom Instrumentation](../instrument/apps/custom-instrumentation/python.md) -
  Manual application instrumentation
