---
title: "OTTL Functions Reference — Editors, Converters & Examples"
sidebar_label: OTTL Functions Reference
sidebar_position: 0
description:
  Every OTTL function in one page — editors (set, delete_key, flatten),
  converters (ParseJSON, SHA256, IsMatch), contexts, where clauses, and
  copy-paste Collector YAML examples.
keywords:
  - ottl functions
  - ottl
  - opentelemetry transformation language
  - ottl reference
  - ottl converter functions
  - ottl editor functions
  - ottl examples
  - otel collector transform
  - ottl playground
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is OTTL in OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"OTTL (OpenTelemetry Transformation Language) is a domain-specific language for transforming telemetry data inside the OpenTelemetry Collector. It works with the transform processor to modify spans, metrics, and logs using editor functions (set, delete_key, replace_pattern) and converter functions (ParseJSON, Concat, Int, IsMatch)."}},{"@type":"Question","name":"What is the difference between OTTL editors and converters?","acceptedAnswer":{"@type":"Answer","text":"Editors modify telemetry data in place — they change, delete, or rearrange fields (e.g., set, delete_key, flatten). Converters are pure functions that return a value without side effects — they parse, hash, format, or check types (e.g., ParseJSON, SHA256, IsMatch). Editors appear as standalone statements; converters are used as arguments inside other functions."}},{"@type":"Question","name":"How do I test OTTL expressions before deploying?","acceptedAnswer":{"@type":"Answer","text":"Use the OTTL Playground at ottl.run to test expressions interactively. Paste sample telemetry data, write your OTTL statements, and see transformed output immediately. For production validation, run the Collector locally with debug logging enabled and a small sample of real traffic."}},{"@type":"Question","name":"What contexts does OTTL support?","acceptedAnswer":{"@type":"Answer","text":"OTTL operates in signal-specific contexts: resource, scope, span, and spanevent for traces; resource, scope, metric, and datapoint for metrics; resource, scope, and log for logs. Each context determines which paths (fields) are accessible. For example, span context gives access to span.name, span.attributes, and span.status, while log context provides body, severity_text, and log attributes."}},{"@type":"Question","name":"How do I check conditions across multiple spans in OTTL?","acceptedAnswer":{"@type":"Answer","text":"OTTL contexts are hierarchical — a span statement can access resource and scope fields but cannot inspect other spans in the same trace. To filter individual spans, use where clauses (e.g., delete() where attributes[\"http.target\"] == \"/health\"). For cross-span decisions like sampling based on error spans in a trace, use the tail sampling processor instead of OTTL."}},{"@type":"Question","name":"How do I use ParseJSON in OTTL?","acceptedAnswer":{"@type":"Answer","text":"Use ParseJSON(body) to convert a JSON string into a map, then access fields with bracket notation: set(attributes[\"level\"], ParseJSON(body)[\"level\"]). Guard with a where IsString(body) clause since ParseJSON fails on non-string inputs. Set error_mode to ignore if log bodies contain mixed formats."}},{"@type":"Question","name":"How do I delete attributes in OTTL?","acceptedAnswer":{"@type":"Answer","text":"Use delete_key(attributes, \"key_name\") to remove a single attribute, delete_matching_keys(attributes, \"pattern.*\") to remove all attributes matching a regex, or keep_keys(attributes, [\"key1\", \"key2\"]) to remove everything except the listed keys."}},{"@type":"Question","name":"What is error_mode in the OTTL transform processor?","acceptedAnswer":{"@type":"Answer","text":"error_mode controls what happens when an OTTL statement fails. Set it to propagate (default) to halt the pipeline, ignore to skip the failed statement and continue, or silent to skip without logging. Use ignore during development and when processing mixed-format data where some records will not match your statements."}}]}
---

# OTTL Functions Reference

OTTL (OpenTelemetry Transformation Language) is the built-in language for
modifying spans, metrics, and logs inside the OpenTelemetry Collector. OTTL
functions fall into two categories: editors that change data in place and
converters that return computed values.

This reference covers every OTTL function with working Collector YAML
configs — editors like `set`, `delete_key`, and `flatten`; converters like
`ParseJSON`, `SHA256`, and `IsMatch`; plus ready-to-use recipes for PII
redaction, span normalization, and noise filtering. It powers the
[transform processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/transformprocessor)
and [filter processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor).

## How OTTL Functions Work

An OTTL statement has three parts:

```text
<editor>(<args>) where <condition>
```

- **Editors** modify data in place (set a field, delete a key, flatten a map)
- **Converters** are pure functions that return a value (parse JSON, compute
  a hash, check a type)
- **Conditions** use `where` clauses with converters to control when a
  statement runs

```yaml
processors:
  transform:
    trace_statements:
      - context: span
        statements:
          # Editor: set span name from an attribute
          - set(name, attributes["http.route"]) where attributes["http.route"] != nil
          # Editor + Converter: hash a user ID
          - set(attributes["user.id"], SHA256(attributes["user.id"]))
```

## Contexts

OTTL operates within signal-specific contexts. Each context determines which
fields (paths) you can read and write.

| Signal | Contexts | Key Paths |
| ------ | -------- | --------- |
| Traces | resource, scope, span, spanevent | `name`, `attributes`, `status`, `kind`, `trace_id`, `span_id`, `start_time_unix_nano`, `end_time_unix_nano`, `events`, `links` |
| Metrics | resource, scope, metric, datapoint | `metric.name`, `metric.type`, `attributes`, `value_int`, `value_double`, `start_time_unix_nano`, `time_unix_nano` |
| Logs | resource, scope, log | `body`, `severity_text`, `severity_number`, `attributes`, `trace_id`, `span_id`, `time_unix_nano` |

All contexts can also access `resource.attributes` and
`instrumentation_scope.name`.

### Context Hierarchy

Statements in a lower context can read fields from higher contexts:

```text
resource → scope → span/metric/log → spanevent/datapoint
```

A `span` statement can read `resource.attributes["service.name"]`, but a
`resource` statement cannot read individual span fields.

---

## Editor Functions

OTTL editor functions transform telemetry data in place. Each runs as a
standalone statement in the transform processor.

### set

Assigns a value to a field. The most commonly used OTTL function.

```yaml
statements:
  - set(attributes["environment"], "production")
  - set(name, attributes["http.route"]) where attributes["http.route"] != nil
  - set(severity_text, "ERROR") where severity_number >= 17
```

### delete

Drops the current telemetry record entirely. Use with a `where` clause to
filter out unwanted spans, logs, or datapoints.

```yaml
statements:
  - delete() where name == "healthcheck"
  - delete() where attributes["http.target"] == "/metrics"
  - delete() where severity_number < 9
```

### delete_key

Removes a single key from a map.

```yaml
statements:
  - delete_key(attributes, "credit_card_number")
  - delete_key(resource.attributes, "internal.debug.id")
```

### delete_matching_keys

Removes all keys matching a regex pattern.

```yaml
statements:
  # Remove all internal debugging attributes
  - delete_matching_keys(attributes, "internal\\.debug\\..*")
  # Remove all PII-prefixed fields
  - delete_matching_keys(attributes, "pii\\..*")
```

### keep_matching_keys

Retains only keys matching a pattern, removing everything else.

```yaml
statements:
  # Keep only http.* and service.* attributes
  - keep_matching_keys(attributes, "(http|service)\\..*")
```

### keep_keys

Keeps only the specified keys in a map.

```yaml
statements:
  - keep_keys(attributes, ["http.method", "http.status_code", "http.route"])
```

### replace_pattern

Replaces parts of a string matching a regex.

```yaml
statements:
  # Mask credit card numbers
  - replace_pattern(attributes["http.url"], "(card=)\\d+", "$1****")
  # Normalize user IDs in span names
  - replace_pattern(name, "/users/[0-9]+", "/users/{id}")
```

### replace_match

Replaces the entire string if it matches a glob pattern.

```yaml
statements:
  - replace_match(name, "GET /health*", "healthcheck")
```

### replace_all_patterns

Replaces regex matches across all values in a map.

```yaml
statements:
  # Redact email addresses in all attributes
  - replace_all_patterns(attributes, "value", "[a-zA-Z0-9.]+@[a-zA-Z0-9.]+", "REDACTED")
```

### replace_all_matches

Replaces glob-pattern matches across all values in a map.

```yaml
statements:
  - replace_all_matches(attributes, "password=*", "password=***")
```

### flatten

Flattens a nested map into dot-separated keys at the root level.

```yaml
statements:
  # {"http": {"method": "GET"}} → {"http.method": "GET"}
  - flatten(attributes)
  # With prefix
  - flatten(attributes, "app")
```

### merge_maps

Merges one map into another using a conflict resolution strategy.

```yaml
statements:
  # Strategies: insert (skip existing), update (overwrite existing), upsert (always write)
  - merge_maps(attributes, resource.attributes, "insert")
```

### limit

Reduces a map to a maximum number of keys, keeping priority keys.

```yaml
statements:
  - limit(attributes, 20, ["http.method", "http.status_code", "service.name"])
```

### truncate_all

Limits string length for all values in a map.

```yaml
statements:
  # Truncate all attribute values to 256 bytes
  - truncate_all(attributes, 256)
```

### append

Adds values to a field, converting scalars to arrays if needed.

```yaml
statements:
  - append(attributes["tags"], "processed")
```

### delete_index

Removes elements from a slice by index.

```yaml
statements:
  - delete_index(attributes["items"], 0)
```

---

## Converter Functions

OTTL converter functions are pure functions — they return a value and do
not modify data directly. Use them as arguments inside editors or `where`
conditions. Both the transform processor and filter processor support all
converter functions listed below.

### String Parsing and Formatting

| Function | Description | Example |
| -------- | ----------- | ------- |
| `Concat(values[], delimiter)` | Joins values into a string | `Concat([attributes["first"], attributes["last"]], " ")` |
| `Split(value, delimiter)` | Splits a string into a slice | `Split(attributes["tags"], ",")` |
| `Substring(value, start, length)` | Extracts a substring | `Substring(attributes["trace_id"], 0, 8)` |
| `Format(fmt, values[])` | Printf-style formatting | `Format("%s-%d", [attributes["svc"], attributes["ver"]])` |
| `Trim(value, cutset)` | Trims characters from both ends | `Trim(attributes["path"], "/")` |
| `TrimPrefix(value, prefix)` | Removes a prefix | `TrimPrefix(name, "GET ")` |
| `TrimSuffix(value, suffix)` | Removes a suffix | `TrimSuffix(name, ".internal")` |
| `HasPrefix(value, prefix)` | Checks if string starts with prefix | Used in `where` clauses |
| `HasSuffix(value, suffix)` | Checks if string ends with suffix | Used in `where` clauses |

### Case Conversion

| Function | Description |
| -------- | ----------- |
| `ToLowerCase(value)` | Converts to lowercase |
| `ToUpperCase(value)` | Converts to UPPERCASE |
| `ToCamelCase(value)` | Converts to camelCase |
| `ToSnakeCase(value)` | Converts to snake_case |
| `ConvertCase(value, format)` | General case conversion |

### Data Parsing

| Function | Description | Example |
| -------- | ----------- | ------- |
| `ParseJSON(value)` | Parses a JSON string | `ParseJSON(body)["level"]` |
| `ParseCSV(value)` | Parses CSV to a slice | `ParseCSV(body)` |
| `ParseKeyValue(value, delim, assign)` | Parses `key=value` strings | `ParseKeyValue(body, " ", "=")` |
| `ParseXML(value)` | Parses XML to a map | `ParseXML(body)` |
| `ParseSimplifiedXML(value)` | Parses XML with flat structure | `ParseSimplifiedXML(body)` |
| `ParseInt(value, base, bits)` | Parses a string to integer | `ParseInt("FF", 16, 64)` |
| `ParseSeverity(value)` | Converts severity text to number | `ParseSeverity("ERROR")` |
| `ExtractPatterns(value, regex)` | Extracts named regex groups | `ExtractPatterns(body, "status=(?P<status>\\d+)")` |
| `ExtractGrokPatterns(value, pattern)` | Extracts using Grok syntax | `ExtractGrokPatterns(body, "%{COMMONAPACHELOG}")` |
| `UserAgent(value)` | Parses User-Agent headers | `UserAgent(attributes["http.user_agent"])` |
| `URL(value)` | Parses a URL into components | `URL(attributes["http.url"])` |

### Type Conversion and Checking

| Function | Description |
| -------- | ----------- |
| `Int(value)` | Converts to integer |
| `Double(value)` | Converts to float |
| `String(value)` | Converts to string |
| `Bool(value)` | Converts to boolean |
| `IsInt(value)` | Returns true if integer |
| `IsDouble(value)` | Returns true if float |
| `IsString(value)` | Returns true if string |
| `IsBool(value)` | Returns true if boolean |
| `IsMap(value)` | Returns true if map |
| `IsList(value)` | Returns true if list/slice |

### Pattern Matching

| Function | Description | Example |
| -------- | ----------- | ------- |
| `IsMatch(value, pattern)` | Glob pattern match | `IsMatch(name, "GET /api/*")` |
| `IsRootSpan()` | True if span has no parent | Used in `where` clauses |

### Hashing

| Function | Output |
| -------- | ------ |
| `SHA256(value)` | SHA-256 hex string |
| `SHA512(value)` | SHA-512 hex string |
| `SHA1(value)` | SHA-1 hex string |
| `MD5(value)` | MD5 hex string |
| `FNV(value)` | FNV-1a hash |
| `Murmur3Hash(value)` | Murmur3 32-bit hash |
| `XXH3(value)` | XXHash3 hash |

### Time Functions

| Function | Description | Example |
| -------- | ----------- | ------- |
| `Now()` | Current time (Unix nanoseconds) | `set(attributes["processed_at"], Now())` |
| `Time(value, format)` | Parses a time string | `Time("2024-01-15", "2006-01-02")` |
| `FormatTime(value, format)` | Formats time to string | `FormatTime(start_time, "2006-01-02")` |
| `TruncateTime(value, duration)` | Rounds time down | `TruncateTime(start_time, Duration("1h"))` |
| `Duration(value)` | Parses duration string | `Duration("5m30s")` |
| `Unix(value)` | Time to Unix seconds | — |
| `UnixMilli(value)` | Time to Unix milliseconds | — |
| `UnixMicro(value)` | Time to Unix microseconds | — |
| `UnixNano(value)` | Time to Unix nanoseconds | — |

Time component extractors: `Year`, `Month`, `Day`, `Hour`, `Minute`,
`Second`, `Nanosecond`, `Weekday`.

Duration converters: `Hours`, `Minutes`, `Seconds`, `Milliseconds`,
`Microseconds`, `Nanoseconds`.

### Map and Slice Operations

| Function | Description | Example |
| -------- | ----------- | ------- |
| `Keys(map)` | Returns all keys | `Keys(attributes)` |
| `Values(map)` | Returns all values | `Values(attributes)` |
| `Len(value)` | Length of string, map, or slice | `Len(attributes) > 50` |
| `Index(slice, value)` | Find position in slice | — |
| `Sort(slice)` | Returns sorted copy | `Sort(attributes["tags"])` |
| `SliceToMap(slice)` | Converts key-value pairs to map | — |
| `ContainsValue(map, value)` | Checks if map contains value | Used in `where` clauses |
| `ToKeyValueString(map, delim, assign)` | Map to `key=value` string | `ToKeyValueString(attributes, " ", "=")` |

### Identity

| Function | Description |
| -------- | ----------- |
| `TraceID(value)` | Converts hex string to TraceID |
| `SpanID(value)` | Converts hex string to SpanID |
| `UUID()` | Generates UUID v4 |

### Encoding

| Function | Description |
| -------- | ----------- |
| `Base64Encode(value)` | Encodes to base64 |
| `Hex(value)` | Converts bytes to hex |
| `Decode(value, encoding)` | Decodes text from encoding |

### Network

| Function | Description |
| -------- | ----------- |
| `IsInCIDR(ip, cidr)` | Checks IP against CIDR range |
| `CommunityID(...)` | Generates network flow community ID |
| `IsValidLuhn(value)` | Validates Luhn checksum (credit cards) |

### Debugging

| Function | Description |
| -------- | ----------- |
| `Log(message)` | Outputs a debug message to Collector logs |

---

## OTTL Function Examples

### Redact PII from Spans

Remove sensitive attributes and mask patterns in URLs:

```yaml
processors:
  transform/redact:
    trace_statements:
      - context: span
        statements:
          - delete_key(attributes, "user.email")
          - delete_key(attributes, "user.phone")
          - delete_matching_keys(attributes, "credit_card.*")
          - replace_pattern(attributes["http.url"], "(token=)[^&]*", "$1***")
          - set(attributes["http.request.header.authorization"], "REDACTED")
            where attributes["http.request.header.authorization"] != nil
```

### Normalize Span Names

Replace dynamic path segments with placeholders for better grouping. See
[Transforming Spans Using OTTL](ottl-span-transformations.md) for more span
examples.

```yaml
processors:
  transform/normalize:
    trace_statements:
      - context: span
        statements:
          - replace_pattern(name, "/users/[0-9a-f-]+", "/users/{id}")
          - replace_pattern(name, "/orders/[0-9]+", "/orders/{id}")
          - set(name, Concat([attributes["http.method"], " ", attributes["http.route"]], ""))
            where attributes["http.route"] != nil
```

### Parse JSON Log Bodies

Extract structured fields from JSON-formatted log bodies. For a deeper
walkthrough of `ExtractPatterns`, see
[Extract Fields from Log Body](extract-fields-from-log-body.md).

```yaml
processors:
  transform/parse_json:
    log_statements:
      - context: log
        statements:
          - set(severity_text, ParseJSON(body)["level"])
            where IsString(body)
          - set(attributes["request.method"], ParseJSON(body)["method"])
            where IsString(body)
          - set(attributes["request.path"], ParseJSON(body)["path"])
            where IsString(body)
          - set(attributes["request.duration_ms"], ParseJSON(body)["duration"])
            where IsString(body)
```

### Drop Noisy Telemetry

Filter out health checks, internal traffic, and low-value spans. For
regex-based log filtering, see
[Filter Logs with Regex and JSON](filter-logs-regex-and-json.md).

```yaml
processors:
  transform/drop_noise:
    trace_statements:
      - context: span
        statements:
          - delete() where name == "healthcheck"
          - delete() where attributes["http.target"] == "/ready"
          - delete() where attributes["http.target"] == "/metrics"
          - delete() where IsMatch(name, "internal.*")
    log_statements:
      - context: log
        statements:
          - delete() where IsMatch(body, ".*healthcheck.*")
          - delete() where severity_number < 9
```

### Enrich Metrics with Resource Attributes

Copy resource-level metadata into datapoint attributes for querying:

```yaml
processors:
  transform/enrich_metrics:
    metric_statements:
      - context: datapoint
        statements:
          - set(attributes["service.name"], resource.attributes["service.name"])
          - set(attributes["k8s.namespace"], resource.attributes["k8s.namespace.name"])
          - set(attributes["deployment"], resource.attributes["k8s.deployment.name"])
```

### Hash Identifiers for Privacy

Replace user-identifiable values with hashes:

```yaml
processors:
  transform/hash_pii:
    trace_statements:
      - context: span
        statements:
          - set(attributes["user.id"], SHA256(attributes["user.id"]))
            where attributes["user.id"] != nil
          - set(attributes["session.id"], SHA256(attributes["session.id"]))
            where attributes["session.id"] != nil
```

### Extract Log Fields with Regex

Pull structured data from unstructured log lines:

```yaml
processors:
  transform/extract:
    log_statements:
      - context: log
        statements:
          - set(attributes["status"], ExtractPatterns(body, "status=(?P<status>\\d+)")["status"])
          - set(attributes["method"], ExtractPatterns(body, "method=(?P<method>[A-Z]+)")["method"])
          - set(attributes["duration"], ExtractPatterns(body, "duration=(?P<duration>[0-9.]+)")["duration"])
```

---

## OTTL Where Clauses and Conditions

Every OTTL statement supports an optional `where` clause. The condition
must evaluate to a boolean.

```yaml
statements:
  # String comparison
  - set(name, "auth-check") where attributes["http.route"] == "/auth"

  # Numeric comparison
  - delete() where severity_number < 9

  # Nil check
  - set(attributes["http.method"], "UNKNOWN") where attributes["http.method"] == nil

  # Pattern match
  - delete() where IsMatch(name, "internal.*")

  # Type check
  - set(attributes["parsed"], ParseJSON(body)) where IsString(body)

  # Combined conditions (AND)
  - delete() where attributes["http.target"] == "/health" and kind.string == "Server"

  # Combined conditions (OR)
  - set(attributes["tier"], "critical")
    where attributes["service.name"] == "payments" or attributes["service.name"] == "auth"
```

## OTTL Error Handling

Set `error_mode` to control what happens when a statement fails:

| Mode | Behavior |
| ---- | -------- |
| `propagate` | Fail the entire pipeline (default) |
| `ignore` | Skip the failed statement, continue processing |
| `silent` | Like ignore, but suppresses error logs |

```yaml
processors:
  transform/safe:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          # Won't crash if body isn't valid JSON
          - set(attributes["level"], ParseJSON(body)["level"])
```

Use `ignore` when processing mixed-format data where some records won't
match your statements.

## OTTL Playground

The [OTTL Playground](https://ottl.run/) lets you test OTTL functions
interactively before deploying to production. Paste sample telemetry data
(spans, logs, or metrics in JSON format), write your OTTL statements, and
see the transformed output immediately. The playground supports all editor
and converter functions listed on this page. Use it to validate regex
patterns in `replace_pattern`, test `ParseJSON` against real log bodies,
or experiment with `where` clause conditions before editing your Collector
config.

## OTTL Best Practices

- **Test OTTL functions locally first.** Use `error_mode: ignore` during
  development, then switch to `propagate` once statements are validated.
- **Order matters.** Statements execute sequentially. A `delete_key` before
  a `set` referencing that key will cause the `set` to fail.
- **Watch cardinality.** Functions like `flatten` can explode attribute
  counts. Use `limit` or `keep_keys` to control map sizes.
- **Use specific contexts.** A `resource` statement runs once per batch; a
  `span` statement runs once per span. Put shared logic at the highest
  context level for better performance.
- **Monitor Collector resources.** Complex OTTL pipelines (regex, JSON
  parsing) add CPU and memory overhead. Profile with `pprof` under
  production load.

## Related Guides

- [Transform Logs](transform-logs.md) — Extract trace and span IDs from logs
- [OTel Collector Configuration](../../instrument/collector-setup/otel-collector-config.md)
  — Collector setup basics
- [Debugging OTel Pipelines](../debugging-otel-pipelines.md) — Diagnose
  data loss and processor issues
- [Recommended Collector Configuration](../recommended-collector-configuration.md)
  — Production settings for batching, retries, and memory
