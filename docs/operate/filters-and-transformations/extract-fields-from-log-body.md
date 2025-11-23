---
title: Extracting Fields from a Log Body
sidebar_label: Extract Fields from Log Body
description:
  Learn how to extract structured data from a log body and set it as log
  attributes using OTTL's ExtractPatterns function in the Scout Collector.
keywords:
  [
    ottl transformations,
    opentelemetry logs,
    log parsing,
    extract log attributes,
    ottl ExtractPatterns,
  ]
sidebar_position: 4
---

## Overview

Often, logs contain valuable, structured information within a semi-structured
or unstructured string body. For example, a log message might contain key-value
pairs like `method=GET path=/api/users status=200`. To make this data useful for
querying, filtering, and creating visualizations, you can extract these values
and set them as distinct log attributes.

This guide demonstrates how to use the OpenTelemetry Transformation Language
(OTTL) and the `ExtractPatterns` function to parse fields from a log body and
promote them to top-level log attributes.

## Collector Configuration

The following configuration for the `transform` processor shows how to extract
multiple fields from a log's body. This example assumes the log body is a
string containing key-value pairs.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  transform/extract_log_fields:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - set(attributes["method"], ExtractPatterns(body, "method=(?P<method>[A-Z]+)")["method"])
          - set(attributes["path"], ExtractPatterns(body, "path=(?P<path>[^ ]+)")["path"])
          - set(attributes["duration"], ExtractPatterns(body, "duration=(?P<duration>[0-9.]+)")["duration"])

```

## How It Works

Let's break down one of the statements to understand the logic:

```yaml
- set(attributes["method"], ExtractPatterns(body, "method=(?P<method>[A-Z]+)")["method"])
```

1.  **`set(target, value)`**: This is the core OTTL function that assigns a
    `value` to a `target`. Here, the target is `attributes["method"]`, meaning
    we are creating or overwriting a log attribute named `method`.

2.  **`ExtractPatterns(body, pattern)`**: This function is used to pull out
    substrings from a source string (`body` in this case) that match a regular
    expression (`pattern`).

3.  **The Regex Pattern**: The second argument, `"method=(?P<method>[A-Z]+)"`,
    is a regular expression with a special component:
    - `method=`: This is a literal match for the string "method=".
    - `(?P<method>[A-Z]+)`: This is a **named capture group**.
      - `(?P<name>...)`: This syntax defines a capture group named `method`.
      - `[A-Z]+`: This is the pattern inside the group, which matches one or
        more uppercase letters (e.g., "GET", "POST").

4.  **Accessing the Captured Value**: The `ExtractPatterns` function returns a
    map where the keys are the names of the capture groups you defined. By
    appending `["method"]` to the function call, we access the value captured
    by the `method` group.

In summary, this statement finds `method=GET` in the log body, the `ExtractPatterns`
function captures `GET` into a group named `method`, and the `set` function
assigns this captured value to the `attributes["method"]` field.

This same logic applies to all other statements in the configuration, each
using a different regex pattern to extract a specific piece of information.

## OTTL Playground

To experiment with the `ExtractPatterns` function and other OTTL transformations
in a live environment, you can use the official [OTTL Playground](https://ottl.run/)

## Related Guides

- [Transforming Spans Using OTTL Functions](./ottl-span-transformations.md)
- [Transform Logs Guide](./transform-logs.md)
- [Filter Logs with Regex and JSON](./filter-logs-regex-and-json.md)
- [OTel Collector Configuration](../../instrument/collector-setup/otel-collector-config.md)
