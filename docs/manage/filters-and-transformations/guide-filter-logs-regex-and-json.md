---
date: 2025-06-19
id: filtering-logs-based-on-regex-and-attributes
title: Guide – Filtering Logs Using Regex and Attribute-Based Conditions
description: Filter logs using regex patterns and JSON attribute conditions in
  OpenTelemetry pipelines
hide_table_of_contents: true
---

## Problem Statement

When working with OpenTelemetry log pipelines, you often need to filter logs
based
on specific criteria. Common scenarios include:

1. **Pattern Matching**: Identifying logs containing specific text patterns
   (e.g., error messages, keywords)
2. **JSON Attribute Filtering**: Selecting logs based on specific JSON field
   values or existence

## Solution

The Scout Collector's `filter` processor provides a powerful way to
implement these filtering requirements. This guide shows how to:

1. Filter logs using regular expressions
2. Filter based on JSON attributes

## Implementation

### Prerequisites

- An Scout Collector configuration file

### Example Scenario

#### Input Logs

**Plaintext log:**

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

### Step 1: Configure the Filter Processor

Add this configuration to filter logs where:

- The log body contains the word "spans" OR
- The log contains a JSON object with a "path" field

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

> **Note:** The above filter is used to drop the logs that match the above
> conditions.

## How It Works

- `IsMatch(body, ".*\bspans\b.*")` matches any log containing the word
  "spans"
- `ParseJSON(body)["path"] != nil` checks for the existence of a "path" field
  in JSON logs
- `error_mode: ignore` ensures the pipeline continues processing even if some
  logs don't match the expected format

## Best Practices

1. Test your regex patterns thoroughly
2. Use `error_mode: ignore` to prevent pipeline failures from malformed logs
3. Consider performance impact when processing large log volumes
