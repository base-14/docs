---
title: API Reference
sidebar_position: 1
description: Scout REST API reference — authentication, traces, logs, and services endpoints.
keywords: [scout api, rest api, api reference, traces api, logs api, services api, opentelemetry api]
---

# API Reference

The Scout API provides read-only access to OpenTelemetry traces, logs, and
service topology data. All data is queried from ClickHouse (traces and logs) and
Memgraph (service graph).

## Base URL

```text
https://your-scout-url/api/v1
```

All endpoints are prefixed with `/api/v1`.

## Authentication

The Scout API uses JWT bearer tokens for authentication. Tokens are issued by
Keycloak.

Include the token in the `Authorization` header of all requests:

```bash
curl https://your-scout-url/api/v1/services \
  -H "Authorization: Bearer $TOKEN"
```

## Content Type

All responses use JSON:

```http
Content-Type: application/json
```

## Error Responses

All errors follow a consistent format:

```json
{
  "code": "bad_request",
  "message": "start_time is required"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `400` | Bad Request — invalid or missing parameters |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found — resource doesn't exist |
| `500` | Internal Server Error |
| `503` | Service Unavailable — dependency health check failed |

## Attribute Filtering

Several endpoints support filtering by span, log, and resource attributes using
prefix-based query parameters.

### Prefix Convention

| Prefix | Applies to | Example |
|--------|------------|---------|
| `span_attr_<key>` | Span attributes | `span_attr_http.method=GET` |
| `resource_attr_<key>` | Resource attributes | `resource_attr_service.version=1.0.0` |
| `log_attr_<key>` | Log attributes | `log_attr_user_id=123` |

### Operators

- **Equality** (default): `span_attr_key=value` — matches where `key == value`
- **Not empty** (`[ne]` suffix): `span_attr_key[ne]=` — matches where `key` has
  any non-empty value

### Combining Filters

- **Same key, multiple values → OR**: `span_attr_http.method=GET&span_attr_http.method=POST`
  matches traces where method is GET **or** POST.
- **Different keys → AND**: `span_attr_http.method=GET&span_attr_http.status_code=200`
  matches traces where method is GET **and** status_code is 200.

---

## Traces

### List Traces

```http
GET /api/v1/telemetry/traces
```

Returns a paginated list of traces filtered by time range and service.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_time` | datetime | Yes | — | Start time (ISO 8601) |
| `end_time` | datetime | Yes | — | End time (ISO 8601) |
| `service_name` | string | Yes | — | Service name filter |
| `span_name` | string[] | No | — | Filter by span name(s). Multiple values use OR matching. |
| `status_code` | string[] | No | — | Filter by status code(s): `Unset`, `Ok`, `Error`. OR matching. |
| `operation` | string | No | — | Filter by `gen_ai.operation.name`: `chat`, `embeddings`, `text_completion` |
| `provider` | string | No | — | Filter by `gen_ai.provider.name` (e.g., `openai`, `anthropic`) |
| `prompt_id` | string | No | — | Filter by `gen_ai.conversation.id` |
| `limit` | integer | No | 20 | Number of items to return (1–100) |
| `cursor` | string | No | — | Pagination cursor from previous response |

Supports [attribute filtering](#attribute-filtering) with `span_attr_` and
`resource_attr_` prefixes.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "trace_id": "abc123def456",
      "span_id": "span789",
      "timestamp": "2025-01-15T10:30:00Z",
      "service_name": "my-llm-app",
      "span_name": "chat",
      "duration_ns": 1500000000,
      "status_code": "Ok",
      "llm_attributes": {
        "request_model": "gpt-4",
        "provider_name": "openai",
        "input_tokens": 150,
        "output_tokens": 80,
        "total_cost": "0.0069",
        "operation_name": "chat",
        "sdk_name": "openllmetry",
        "system_prompt": "You are a helpful assistant.",
        "user_prompt": "Explain observability."
      }
    }
  ],
  "meta": {
    "next_cursor": "eyJ0cyI6...",
    "has_more": true
  }
}
```

**Errors:** `400`, `500`

---

### Get Trace Details

```http
GET /api/v1/telemetry/traces/{traceId}
```

Returns the full trace with all spans, events, and links.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `traceId` | string | The trace ID |

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service_name` | string | Yes | Service name (for query optimization) |
| `start_time` | datetime | Yes | Start time (ISO 8601) |
| `end_time` | datetime | Yes | End time (ISO 8601) |

**Response:** `200 OK`

```json
{
  "trace_id": "abc123def456",
  "spans": [
    {
      "trace_id": "abc123def456",
      "span_id": "span789",
      "parent_span_id": "",
      "timestamp": "2025-01-15T10:30:00Z",
      "service_name": "my-llm-app",
      "span_name": "chat",
      "span_kind": "CLIENT",
      "duration_ns": 1500000000,
      "status_code": "Ok",
      "status_message": "",
      "resource_attributes": {
        "service.name": "my-llm-app",
        "service.version": "1.0.0"
      },
      "span_attributes": {
        "gen_ai.request.model": "gpt-4",
        "gen_ai.system": "openai"
      },
      "llm_attributes": {
        "request_model": "gpt-4",
        "provider_name": "openai",
        "input_tokens": 150,
        "output_tokens": 80,
        "total_cost": "0.0069",
        "operation_name": "chat",
        "system_prompt": "You are a helpful assistant.",
        "user_prompt": "Explain observability.",
        "output_message": "Observability is the ability to...",
        "total_duration_ms": 1500,
        "time_to_first_token_ms": 200,
        "time_per_output_token_ms": 16,
        "inference_duration_ms": 1280
      },
      "events": [
        {
          "timestamp": "2025-01-15T10:30:00.5Z",
          "name": "gen_ai.content.prompt",
          "attributes": {
            "gen_ai.prompt": "Explain observability."
          }
        }
      ],
      "links": []
    }
  ]
}
```

**Errors:** `404`, `500`

---

### Discover Spans

```http
GET /api/v1/telemetry/traces/discover
```

Discover available span names, status codes, and attribute keys for a service.
Use this before querying traces to understand the trace schema.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service_name` | string | Yes | — | Service name to discover spans for |
| `start_time` | datetime | No | 5 minutes ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601). Max window: 15 minutes. |

**Response:** `200 OK`

```json
{
  "service_name": "my-llm-app",
  "time_range": {
    "start": "2025-01-15T10:25:00Z",
    "end": "2025-01-15T10:30:00Z"
  },
  "total_count": 1250,
  "span_names": ["chat", "embeddings", "retrieval"],
  "status_codes": [
    { "status_code": "Ok", "count": 1100 },
    { "status_code": "Error", "count": 150 }
  ],
  "span_attribute_keys": [
    "gen_ai.request.model",
    "gen_ai.system",
    "http.method"
  ],
  "resource_attribute_keys": [
    "service.name",
    "service.version",
    "k8s.pod.name"
  ]
}
```

**Errors:** `400`, `500`

---

## Logs

### Query Logs

```http
GET /api/v1/telemetry/logs
```

Query logs from a service with optional filters.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service_name` | string | Yes | — | Service name to query logs for |
| `start_time` | datetime | Yes | — | Start time (ISO 8601) |
| `end_time` | datetime | Yes | — | End time (ISO 8601). Max window: 15 minutes. |
| `severity` | string[] | No | — | Filter by severity levels (e.g., `ERROR`, `WARN`, `INFO`). OR matching. |
| `body_contains` | string | No | — | Search for text within log body |
| `trace_id` | string | No | — | Filter by trace ID |
| `limit` | integer | No | 100 | Number of logs to return (1–1000) |

Supports [attribute filtering](#attribute-filtering) with `log_attr_` and
`resource_attr_` prefixes.

**Response:** `200 OK`

```json
{
  "logs": [
    {
      "timestamp": "2025-01-15T10:30:00Z",
      "severity": "ERROR",
      "severity_number": 17,
      "body": "Failed to connect to upstream service",
      "trace_id": "abc123def456",
      "span_id": "span789",
      "log_attributes": {
        "error.type": "ConnectionError",
        "retry.count": "3"
      },
      "resource_attributes": {
        "service.name": "my-llm-app",
        "k8s.pod.name": "my-llm-app-7b9f4"
      },
      "scope_name": "my-llm-app.http_client"
    }
  ],
  "count": 1
}
```

**Errors:** `400`, `500`

---

### Discover Logs

```http
GET /api/v1/telemetry/logs/discover
```

Discover available log attributes, severity levels, and resource attributes for
a service. Use this before querying logs to understand the log schema.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service_name` | string | Yes | — | Service name to discover logs for |
| `start_time` | datetime | No | 5 minutes ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601). Max window: 15 minutes. |

**Response:** `200 OK`

```json
{
  "service_name": "my-llm-app",
  "time_range": {
    "start": "2025-01-15T10:25:00Z",
    "end": "2025-01-15T10:30:00Z"
  },
  "total_count": 5430,
  "severity_levels": [
    { "level": "INFO", "count": 4000 },
    { "level": "WARN", "count": 1200 },
    { "level": "ERROR", "count": 230 }
  ],
  "log_attribute_keys": [
    "error.type",
    "retry.count",
    "user_id"
  ],
  "resource_attribute_keys": [
    "service.name",
    "service.version",
    "k8s.pod.name"
  ],
  "scope_names": [
    "my-llm-app.http_client",
    "my-llm-app.llm"
  ]
}
```

**Errors:** `400`, `500`

---

## Services

### List Services

```http
GET /api/v1/services
```

Returns a list of distinct service names from traces.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_time` | datetime | No | 24 hours ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601) |

Supports [attribute filtering](#attribute-filtering) with `span_attr_` and
`resource_attr_` prefixes.

**Response:** `200 OK`

```json
{
  "services": [
    "my-llm-app",
    "api-gateway",
    "vector-store"
  ]
}
```

**Errors:** `400`, `500`

---

### Get Service Topology

```http
GET /api/v1/services/topology
```

Returns all service-to-service dependencies within the specified time window.

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_time` | datetime | No | 5 minutes ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601). Max duration: 1 hour. |

**Response:** `200 OK`

```json
{
  "dependencies": [
    {
      "source": "api-gateway",
      "target": "my-llm-app",
      "span_name": "POST /chat",
      "relationship_type": "DEPENDS_ON",
      "method": "POST",
      "first_seen": "2025-01-10T08:00:00Z",
      "last_noticed": "2025-01-15T10:30:00Z"
    },
    {
      "source": "my-llm-app",
      "target": "vector-store",
      "span_name": "search",
      "relationship_type": "DEPENDS_ON",
      "method": "",
      "first_seen": "2025-01-10T08:00:00Z",
      "last_noticed": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**Errors:** `400`, `500`

---

### Get Service Dependencies

```http
GET /api/v1/services/{serviceName}/dependencies
```

Returns all dependencies for a specific service, including incoming and outgoing.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `serviceName` | string | The service name |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_time` | datetime | No | 5 minutes ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601). Max duration: 1 hour. |

**Response:** `200 OK`

```json
{
  "service": {
    "name": "my-llm-app",
    "first_seen": "2025-01-10T08:00:00Z",
    "last_noticed": "2025-01-15T10:30:00Z"
  },
  "dependencies": [
    {
      "source": "api-gateway",
      "target": "my-llm-app",
      "span_name": "POST /chat",
      "relationship_type": "DEPENDS_ON",
      "method": "POST",
      "first_seen": "2025-01-10T08:00:00Z",
      "last_noticed": "2025-01-15T10:30:00Z"
    }
  ],
  "infrastructure": {
    "database": ["postgresql-main"],
    "cache": ["redis-sessions"],
    "cloud.provider": ["aws"]
  }
}
```

**Errors:** `400`, `404`, `500`

---

### Get Service Metrics

```http
GET /api/v1/services/{serviceName}/metrics
```

Returns all metrics emitted by a specific service.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `serviceName` | string | The service name |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `start_time` | datetime | No | 5 minutes ago | Start of time window (ISO 8601) |
| `end_time` | datetime | No | now | End of time window (ISO 8601). Max duration: 1 hour. |

**Response:** `200 OK`

```json
{
  "service_name": "my-llm-app",
  "metrics": [
    {
      "name": "http.server.request.duration",
      "type": "histogram",
      "description": "Duration of HTTP server requests",
      "first_seen": "2025-01-10T08:00:00Z",
      "last_noticed": "2025-01-15T10:30:00Z"
    },
    {
      "name": "gen_ai.client.token.usage",
      "type": "counter",
      "description": "Number of tokens used by GenAI client",
      "first_seen": "2025-01-12T14:00:00Z",
      "last_noticed": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**Errors:** `400`, `500`

---

## Response Schemas

### LLM Attributes (Summary)

Returned in trace list items. Excludes large fields like `output_message`.

| Field | Type | Description |
|-------|------|-------------|
| `request_model` | string | The model requested (e.g., `gpt-4`, `claude-3-opus`) |
| `provider_name` | string | LLM provider (e.g., `openai`, `anthropic`) |
| `input_tokens` | integer | Number of input/prompt tokens |
| `output_tokens` | integer | Number of output/completion tokens |
| `total_cost` | string | Total cost in dollars (e.g., `"0.0069"`) |
| `operation_name` | string | Operation type: `chat`, `embeddings`, `text_completion` |
| `output_type` | string | Type of output (e.g., `text`) |
| `sdk_name` | string | SDK that generated the trace (`openllmetry`, `openlit`) |
| `sdk_version` | string | SDK version |
| `system_prompt` | string | System prompt/instructions |
| `user_prompt` | string | User prompt/message |

### LLM Attributes (Full)

Returned in trace detail. Includes all summary fields plus:

| Field | Type | Description |
|-------|------|-------------|
| `output_message` | string | LLM output/completion message |
| `total_duration_ms` | integer | Total request duration in milliseconds |
| `time_to_first_token_ms` | integer | Time to generate first token in milliseconds |
| `time_per_output_token_ms` | integer | Average time per output token in milliseconds |
| `inference_duration_ms` | integer | Total inference time in milliseconds |

### Pagination

Trace list responses use cursor-based pagination:

| Field | Type | Description |
|-------|------|-------------|
| `next_cursor` | string | Cursor for the next page |
| `has_more` | boolean | Whether there are more items |

Pass `next_cursor` as the `cursor` query parameter to fetch the next page.
