---
date: 2025-07-17
id: transforming-spans-with-ottl
title: Guide – Transforming Spans Using OTTL Functions | base14 Scout
description: Use OTTL (OpenTelemetry Transformation Language) to modify span data in the Collector. Transform span names, manipulate attributes, redact sensitive data, and drop unwanted spans.
keywords: [ottl transformations, opentelemetry transformation language, span transformations, trace data manipulation, ottl functions]
hide_table_of_contents: true
---

## Introduction to OTTL

OTTL (OpenTelemetry Transformation Language) is a powerful domain specific language
 that allows you to transform telemetry data(Traces, Metrics, Logs) within the Collector.

## Common OTTL use cases for spans

### 1. Span Name Transformation

**Use Case**: Standardizing span names for better analysis and grouping.

**Example**:

```yaml
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          - set(name, attributes["http.route"]) where attributes["http.route"] != nil
          - replace_pattern(name, "/users/.*/posts/", "/users/{userId}/posts/") #Replace with regex pattern for generalization
```

### 2. Attribute Manipulation

**Use Case**: Adding, updating, or removing attributes from spans.

**Example**:

```yaml
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          - set(attributes["deployment.environment"], "production")
          - delete_key(attributes, "credit_card_number")
```

### 3. Redacting Sensitive Data

**Use Case**: Masking or Redacting sensitive information before it leaves your system.

**Example**:

```yaml
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          - replace_pattern(attributes["http.url"], "(password=)[^&]*", "$1***")
          - set(attributes["http.request.header.authorization"], "REDACTED") where attributes["http.request.header.authorization"] != nil
```

### 4. Dropping Unwanted Spans

**Use Case**: Reducing noise and storage costs by filtering out unnecessary spans.

**Example**:

```yaml
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          - delete() where name == "healthcheck"
          - delete() where attributes["http.target"] == "/metrics"
```

## Best Practices

1. **Test Transformations**: Always test your OTTL expressions in a local environment
with the supported OTel Collector version.
2. **Order Matters**: The order of statements affects the transformation pipeline.
3. **Performance**: Complex transformations can impact collector performance.
 Monitor resource usage.

## Next Steps

- [Transform and Filters Processor Reference](https://docs.base14.io/category/filters-and-transformations)
- [OTTL Language Documentation](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/pkg/ottl)
