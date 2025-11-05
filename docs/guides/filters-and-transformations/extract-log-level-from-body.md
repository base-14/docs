---
date: 2025-10-09
id: extracting-log-level-from-body
title: Extracting Log Level from Log Body
description:
  Extract log severity levels from log body using OpenTelemetry transform
  processor. Parse and categorize DEBUG, INFO, WARN, ERROR, and FATAL levels in
  Scout.
keywords:
  [
    log level extraction,
    log severity parsing,
    opentelemetry transform processor,
    log categorization,
    severity extraction,
  ]
---

This guide demonstrates how to extract log severity levels from the body of your
logs using Scout's otel native transform processors, enabling proper log level
categorization and filtering.

## Overview

When working with logs that contain severity information in their body text
(such as application logs with embedded log levels), you need to extract these
values to standard severity fields to enable proper log filtering and analysis.
This guide shows how to use Scout's otel native transform processor to parse and
extract log levels from log body content.

## Step 1: Initialize Default Severity

First, we'll set default severity values to ensure these fields always exist
with a baseline level:

```yaml
processors:
  transform/initialize-severity:
    log_statements:
      - context: log
        statements:
          # Set default severity for all logs (INFO level)
          - set(severity_text, "INFO")
          - set(severity_number, 9)
```

## Step 2: Extract Severity from Body

Next, we'll extract various log levels from the log body using pattern matching.
This example covers common log levels used by most applications:

```yaml
transform/extract-severity:
  log_statements:
    - context: log
      statements:
        # TRACE level logs
        - set(severity_text, "TRACE") where IsMatch(body, ".*TRACE.*")
        - set(severity_number, 1) where IsMatch(body, ".*TRACE.*")

        # DEBUG level logs
        - set(severity_text, "DEBUG") where IsMatch(body, ".*DEBUG.*")
        - set(severity_number, 5) where IsMatch(body, ".*DEBUG.*")

        # INFO level logs
        - set(severity_text, "INFO") where IsMatch(body, ".*INFO.*")
        - set(severity_number, 9) where IsMatch(body, ".*INFO.*")

        # WARN level logs
        - set(severity_text, "WARN") where IsMatch(body, ".*WARN.*")
        - set(severity_number, 13) where IsMatch(body, ".*WARN.*")

        # ERROR level logs
        - set(severity_text, "ERROR") where IsMatch(body, ".*ERROR.*")
        - set(severity_number, 17) where IsMatch(body, ".*ERROR.*")

        # FATAL level logs
        - set(severity_text, "FATAL") where IsMatch(body, ".*FATAL.*")
        - set(severity_number, 21) where IsMatch(body, ".*FATAL.*")
```

## Step 3: Configure Pipeline

Finally, add these processors to your logs pipeline:

```yaml
service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [transform/initialize-severity, transform/extract-severity]
      exporters: [otlphttp]
```

## Advanced Pattern Matching

For more precise matching, you can use specific regex patterns:

```yaml
transform/advanced-severity:
  log_statements:
    - context: log
      statements:
        # Match log level at beginning of line with brackets
        - set(severity_text, "ERROR") where IsMatch(body, "^\\[ERROR\\].*")
        - set(severity_number, 17) where IsMatch(body, "^\\[ERROR\\].*")

        # Match log level with timestamp prefix
        - set(severity_text, "WARN") where IsMatch(body,
          ".*\\d{4}-\\d{2}-\\d{2}.*WARN.*")
        - set(severity_number, 13) where IsMatch(body,
          ".*\\d{4}-\\d{2}-\\d{2}.*WARN.*")
```

### Notes

- Severity numbers follow OpenTelemetry log severity standards
- Pattern matching is case-sensitive; adjust patterns for your log format
- More specific patterns should be placed before general ones
- The `IsMatch` function uses regex patterns for flexible matching
- Consider using multiple transform processors for complex parsing logic

## Related Guides

- [Filter Logs with Regex and JSON](filter-logs-regex-and-json.md) -
  Advanced log filtering techniques
- [Transform Logs Guide](transform-logs.md) - General log transformation
  patterns
- [OTel Collector Configuration](../../instrument/collector-setup/otel-collector-config.md)
  \- Collector configuration basics
