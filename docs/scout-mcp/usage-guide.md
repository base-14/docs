---
title: Usage Guide
sidebar_position: 2
unlisted: false
description:
  Query traces, logs, metrics, service topology, and alerts through your AI
  assistant using Scout MCP.
keywords:
  [
    scout mcp,
    observability ai,
    traces,
    logs,
    metrics,
    service topology,
    alerts,
  ]
---

# Scout MCP Usage Guide

Once you have connected your coding agent to Scout
(see [MCP Client Setup](./setup.md)), you can query your observability data in
plain English.

Scout MCP exposes 13 read-only tools that cover service topology, traces, logs,
metrics, and alerts. You do not need to know the tool names. Ask your question
and your coding agent will figure out which tools to use.

## What You Can Ask

### Service topology and dependencies

- *What services are running in my environment?*
- *Show me the service dependency map for payment-service*
- *What services does order-service call? And what calls it?*
- *Show me the full service topology for the last 6 hours*

### Service profile

- *What's the performance profile for payment-service?*
- *Show me error rates and latency stats for all spans in order-service*
- *Which peer services does checkout-service interact with, and how are they performing?*

### Traces

- *Show me the slowest traces for payment-service in the last hour*
- *Are there any failed requests in checkout-service today?*
- *Show me traces where the provider is "stripe" in the last 30 minutes*
- *Get the full trace details for trace ID abc123def456*

**Tip:** You can ask your coding agent to discover available span names and attributes
before running a targeted query:

> What span names and attributes are available for payment-service?

### Logs

- *Show me error logs from order-service in the last hour*
- *Find logs containing "timeout" in payment-service today*
- *Show me all FATAL and ERROR logs from the last 30 minutes*
- *Get the logs associated with trace ID abc123def456*

**Tip:** To see what log attributes or severity levels a service uses:

> What log attributes and severity levels does payment-service have?

### Metrics

- *What metrics does payment-service emit?*
- *Show me CPU usage for order-service in the last hour*
- *What's the request rate for checkout-service grouped by endpoint?*
- *Show me the raw memory usage data points for the last 15 minutes*
- *Compare error counts across services using the http.status_code attribute*

**Tip:** Use discover first to understand what metrics exist and what attributes
you can filter or group by:

> Discover what metrics payment-service has, then query the one
> related to request duration

### Alerts

- *Show me the last 10 alerts*
- *Were there any alerts in the last 2 hours?*
- *Show me alerts tagged with "critical" from today*

## Example Investigations

### Debugging a slow endpoint

**You:** *The checkout page is slow, can you investigate?*

Your coding agent will:

1. List services to find the checkout service
2. Query recent traces filtered by high duration
3. Pick the slowest trace and fetch full span details
4. Identify the bottleneck span and report back

### Investigating errors after a deployment

**You:** *We deployed order-service 30 minutes ago. Are there any new errors?*

Your coding agent will:

1. Query traces with status `Error` for the last 30 minutes
2. Query error logs for the same time window
3. Check if there were any alerts fired
4. Summarize what it found

### Understanding an unfamiliar service

**You:** *I am new to this project. Tell me about payment-service, what it
depends on, what calls it, and what it emits.*

Your coding agent will:

1. Fetch service dependencies (incoming and outgoing)
2. Discover available span names and attributes
3. Discover log attributes and severity levels
4. Discover metrics the service emits, their types, and available dimensions
5. Give you a complete overview

## Tips for Better Results

| Do this | Instead of this |
| --- | --- |
| "Show me errors in payment-service in the last hour" | "Show me errors" |
| "Last 5 slowest traces for checkout-service today" | "Show me traces" |
| "Compare error rates before and after 2pm" | "Is something wrong?" |
| "Discover what attributes payment-service has, then search for traces where provider is stripe" | "Find stripe traces" |
| "Discover metrics for order-service, then query request_duration grouped by endpoint" | "Show me metrics" |

### Guide your coding agent's approach

You can tell your coding agent how to investigate step by step:

- *"First discover the available span names for this service, then query traces
  for the ones related to payments"*
- *"Check error logs first, then find the corresponding traces"*
- *"Show me the service topology, then drill into the service with the most
  dependencies"*

### Set default instructions

If you find yourself repeating the same instructions, set up a system prompt or
project instructions:

```text
When querying Scout:
- Always discover available attributes before searching
- Limit results to 10 unless I ask for more
- Include trace IDs in all trace responses
- Default to the last 1 hour of data
- When investigating errors, check both traces and logs
```

## Limitations

- All tools are **read-only**. Your coding agent cannot create, modify, or
  delete anything in your environment.

## Tool Reference

All 13 tools exposed by Scout MCP. Every tool is read-only and idempotent.

### `list_services`

Returns all services running within a time window.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 24 hours ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** Array of service names with `first_seen` and `last_noticed`.

### `get_service_topology`

Returns all service-to-service dependencies within a time window. Shows which
service calls which service.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 24 hours ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** Array of dependencies, each with `source`, `target`, `span_name`,
`relationship_type`, `method`, `first_seen`, `last_noticed`.

### `get_service_dependencies`

Returns all dependencies for a specific service, both outgoing (services it
calls) and incoming (services that call it), along with infrastructure
information.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to look up |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 24 hours ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** Service info, dependencies array (with direction, span names,
methods), infrastructure map.

### `get_service_metrics`

Returns all metrics emitted by a specific service within a time range.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to look up |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 24 hours ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** Array of metrics, each with `name`, `type`, `description`,
`first_seen`, `last_noticed`.

### `get_service_profile`

Returns cumulative performance stats for a service as a flat list of spans. Each
span includes its peer service, error rate, and latency stats.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to get the profile for |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 5 minutes ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now. Max range: 1 hour |

**Returns:** Service info and a `spans` array. Each span includes `peer_service`,
`span_name`, `method`, `error_rate`, `avg_latency_ms`, `min_latency_ms`,
`max_latency_ms`, `first_seen`, `last_noticed`.

### `get_last_n_alerts`

Retrieves the last N alerts from Scout. Returns alert state transitions
including alert name, state changes, timestamps, and dashboard information.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | integer | No | Number of alerts to retrieve (1-100). Defaults to 20 |
| `start_time` | string (RFC 3339) | No | Filter alerts from this time |
| `end_time` | string (RFC 3339) | No | Filter alerts until this time |
| `tags` | array of strings | No | Filter by tags (AND logic) |
| `dashboard_uid` | string | No | Filter by dashboard UID |

**Returns:** Array of alerts, each with `alert_name`, `state`, `prev_state`,
`timestamp`, `dashboard_title`, `dashboard_uid`, `text`, `tags`.

### `discover_logs`

Discover available log attributes, severity levels, and resource attributes for
a service. Use this before `query_logs` to understand the log schema.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to discover logs for |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 7 days ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** `total_count`, `severity_levels` array, `log_attribute_keys`,
`resource_attribute_keys`, `scope_names`.

### `query_logs`

Query logs from a service with optional filters. Supports filtering by severity,
body content, log attributes, resource attributes, and trace ID.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to query |
| `start_time` | string (RFC 3339) | Yes | Start time |
| `end_time` | string (RFC 3339) | Yes | End time |
| `severity` | array of strings | No | Filter by severity (DEBUG, INFO, WARN, ERROR, FATAL) |
| `body_contains` | string | No | Substring search in log body |
| `log_attributes` | object | No | Filter by log attribute key-value pairs |
| `resource_attributes` | object | No | Filter by resource attribute key-value pairs |
| `trace_id` | string | No | Filter logs by trace ID |
| `limit` | integer | No | Max logs to return. Default 100, max 1000 |

**Returns:** Array of log entries, each with `timestamp`, `severity`, `body`,
`trace_id`, `span_id`, `attributes`.

### `discover_spans`

Discover available span names, status codes, and span attributes for a service.
Use this before `query_traces` to understand the trace schema.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to discover spans for |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 24 hours ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** `total_count`, `span_names` array, `status_codes` array,
`span_attribute_keys`, `resource_attribute_keys`.

### `query_traces`

Query traces from a service with optional filters. Supports filtering by span
name, status code, span attributes, resource attributes, and convenience
filters.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to query |
| `start_time` | string (RFC 3339) | Yes | Start time |
| `end_time` | string (RFC 3339) | Yes | End time |
| `span_name` | string or array | No | Filter by span name(s) |
| `status_code` | string or array | No | Filter by status code (Unset, Ok, Error) |
| `prompt_id` | string | No | Filter by conversation/prompt ID *(for Scope users)* |
| `operation` | string | No | Filter by operation name *(for Scope users)* |
| `provider` | string | No | Filter by provider name *(for Scope users)* |
| `span_attributes` | object | No | Filter by span attribute key-value pairs |
| `resource_attributes` | object | No | Filter by resource attribute key-value pairs |
| `limit` | integer | No | Max traces to return. Default 50, max 1000 |

**Returns:** Array of trace entries, each with `trace_id`, `span_id`,
`timestamp`, `service_name`, `span_name`, `duration_ns`, `status_code`,
`span_attributes`, `llm_attributes`, `count`, `has_more`.

### `query_trace_by_id`

Fetch full trace details by trace ID. Returns all spans in the trace with their
attributes, events, and links.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `trace_id` | string | Yes | The trace ID to fetch |
| `service_name` | string | Yes | The service name |
| `start_time` | string (RFC 3339) | Yes | Start time |
| `end_time` | string (RFC 3339) | Yes | End time |

**Returns:** `trace_id`, `found` boolean, array of span details with full span
information including `events`, `links`, `attributes`, `duration_ns`,
`status_code`, and `span_count`.

### `discover_metrics`

Discover what metrics a service emits, their types, units, and available filter
dimensions. Use this before `query_metrics` to understand the metric schema.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to discover metrics for |
| `start_time` | string (RFC 3339) | No | Start of time window. Defaults to 7 days ago |
| `end_time` | string (RFC 3339) | No | End of time window. Defaults to now |

**Returns:** `service_name`, `time_range`, `total_count`, and `metrics` array.
Each metric includes `name`, `type` (gauge, sum, histogram, summary), `description`,
`unit`, `attribute_keys`, and `resource_attribute_keys`.

### `query_metrics`

Query metric values with filtering, grouping, and aggregation. Supports gauge,
sum, histogram, and summary metric types.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `service_name` | string | Yes | The service to query |
| `metric_name` | string | Yes | Metric name to query. Use `discover_metrics` first to find available metrics |
| `start_time` | string (RFC 3339) | Yes | Start time |
| `end_time` | string (RFC 3339) | Yes | End time |
| `attributes` | object | No | Filter by metric attributes. Values can be a string or array for OR matching |
| `resource_attributes` | object | No | Filter by resource attributes. Values can be a string or array for OR matching |
| `group_by` | string or array | No | Attribute key(s) to group results by |
| `aggregate_interval` | string | No | Aggregation bucket interval (e.g., `1m`, `5m`, `1h`). Auto-selected if not specified |
| `raw` | boolean | No | Return raw data points instead of aggregated. Max time range: 30m |
| `limit` | integer | No | Max data points to return. Default 1000, max 10000 |

**Returns:** Metric data points with timestamps and values. Structure depends on
metric type and whether `raw` mode is enabled. Aggregated results include
bucket timestamps with min, max, avg, sum, and count.
