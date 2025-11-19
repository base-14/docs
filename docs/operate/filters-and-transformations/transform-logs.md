---
date: 2025-11-19
id: extracting-trace-id-and-span-id-from-log-body
title: Extracting TraceId and SpanId from JSON Log Body
description:
  Extract trace and span IDs from JSON log body using OpenTelemetry transform
  processor. Enable distributed tracing correlation in Scout with log-to-trace
  linking.
keywords:
  [
    trace id extraction,
    span id extraction,
    log trace correlation,
    distributed tracing logs,
    json log parsing,
  ]
---

This guide demonstrates how to extract trace and span identifiers from the body
of your logs using Scout's otel native transform processors, enabling better
distributed tracing correlation and observability.

## Overview

When working with logs that contain trace and span identifiers in their body
(often in JSON format), you need to extract these values to standard fields to
enable proper trace correlation. This guide shows how to use Scout's transform
processor to parse and extract these values.

## Step 1: Initialize Default Values

First, we'll initialize default trace and span IDs to ensure these fields always
exist:

```yaml
processors:
  transform/initialize:
    log_statements:
      - context: log
        statements:
          - set(trace_id.string, "00000000000000000000000000000000")
          - set(span_id.string, "0000000000000000")
```

## Step 2: Extract TraceId

Next, we'll extract the `traceId` from the JSON body:

```yaml
transform/extract_trace:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - set(trace_id.string, ParseJSON(log.body)["traceId"])
```

> Note: Replace `traceId` if you are using other key name.

## Step 3: Extract SpanId

Similarly, we'll extract the `spanId` from the JSON body:

```yaml
transform/extract_span:
  error_mode: ignore
  log_statements:
    - context: log
      statements:
        - set(span_id.string, ParseJSON(log.body)["spanId"])
```

> Note: Replace `spanId` if you are using other key name.

## Step 4: Configure Pipeline

Finally, add these processors to your logs pipeline:

```yaml
logs/otlp:
  receivers: [otlp]
  processors:
    [transform/initialize, transform/extract_trace, transform/extract_span]
  exporters: [debug]
```

## Notes

- The `error_mode: ignore` directive prevents pipeline failures when a log entry
  doesn't contain the expected fields
- This configuration assumes the trace and span IDs are directly available at
  the top level of the JSON structure
- The example uses the debug exporter, but you should replace it with your
  actual exporters and recievers.

## Related Guides

- [Extract Log Level from Body](extract-log-level-from-body.md) - Parse
  log severity levels
- [OTTL Span Transformations](ottl-span-transformations.md) - Transform
  trace spans
- [OTel Collector Configuration](../../instrument/collector-setup/otel-collector-config.md)
  \- Collector configuration basics
