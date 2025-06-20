---
date: 2025-06-19
id: filtering-logs-based-on-regex-and-attributes
title: Guide – Filtering Logs Using Regex and Attribute-Based Conditions
description: How to filter logs using regex matches and JSON attribute-based conditions in OpenTelemetry pipelines
hide_table_of_contents: true
---

This guide demonstrates how to filter logs using either regex patterns or specific
JSON attribute conditions within OpenTelemetry pipelines, enabling more precise
log processing, debugging, and routing.

---

### Overview

In scenarios where your log stream includes structured JSON logs or plain-text
messages, you might want to drop, allow, or route logs based on:

- Text pattern matches (e.g., contains `"spans"`)
- The presence or value of specific JSON keys (e.g., `path != nil`)

This guide provides a solution using the `filter` processor in the OpenTelemetry
Collector configuration.

---

### Example Scenario

#### Input Logs

**Plaintext log line:**

```text
Evaluating spans in status code filter

User loged in 
```

**Structured JSON log:**
```json
{
  "method": "GET",
  "path": "/up",
  "format": "html",
  "controller": "Rails::HealthController",
  "action": "show",
  "status": 200,
  "allocations": 155,
  "duration": 0.63,
  "view": 0.36,
  "db": 0.0,
  "time": "2025-06-19T06:57:48.937Z",
  "env": "staging",
  "params": {
    "controller": "rails/health",
    "action": "show"
  },
  "trace_id": "1ed18ae14f619de9d07aa811b658bbe3",
  "span_id": "b34a698c7dd6ef52",
  "sampled": true
}
```

---

### Goal

You want to filter logs where either:

- The body contains the keyword `"spans"` (text match)
- The JSON body has a field named `"path"`

---

### Step 1: Add the Filter Processor to drop the logs based on the conditions

```yaml
processors:
  filter/drop_logs:
    error_mode: ignore
    logs:
      log_record:
        - 'IsMatch(body, ".*\bspans\b.*")'
        - 'ParseJSON(body)["path"] != nil'
```

### Step 2: Add to Your Logs Pipeline

```yaml
service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [filter/drop_logs]
      exporters: [oltp]
```
