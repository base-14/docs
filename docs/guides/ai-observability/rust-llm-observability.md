---
title:
  Rust LLM Observability with OpenTelemetry - AI Application Tracing Guide
sidebar_label: Rust LLM Observability
sidebar_position: 9
description:
  Instrument Rust AI and LLM applications with OpenTelemetry. Trace LLM calls,
  track token usage and costs, monitor multi-stage pipelines with retries and
  fallbacks in base14 Scout.
keywords:
  [
    rust llm observability,
    rust opentelemetry ai,
    rust genai semantic conventions,
    rust llm tracing,
    rust llm cost tracking,
    rust ai application monitoring,
    rust opentelemetry instrumentation,
    axum llm monitoring,
    async-openai opentelemetry,
    rust ai pipeline observability,
    rust llm metrics,
    rust multi-provider llm,
    tracing-opentelemetry rust,
    rust token tracking,
    rust ai agent tracing,
    opentelemetry rust llm spans,
    rust llm retry fallback,
    rust ai production monitoring,
  ]
---

# Rust LLM Observability

Implement unified observability for Rust AI and LLM applications using
OpenTelemetry. This guide shows you how to trace every layer of a Rust AI
application - from HTTP requests through pipeline orchestration to LLM API calls
and database queries - in a single correlated trace using the OpenTelemetry Rust
SDK and base14 Scout. You will instrument a multi-stage AI pipeline that
retrieves data from PostgreSQL, analyzes trends with a fast LLM, generates
structured narratives with a capable LLM, and assembles the final output - with
every stage, token count, and cost captured in telemetry.

Rust AI applications introduce observability challenges that generic APM tooling
was not designed for. An LLM call is not just an HTTP request - it carries
semantic meaning: which model was used, how many tokens were consumed, what it
cost, whether the response was a fallback from another provider. Unlike Python
or Node.js, Rust has no auto-instrumentation libraries for LLM SDKs like
`async-openai` or Anthropic HTTP clients. You need manual spans following
OpenTelemetry GenAI semantic conventions, custom metrics for token and cost
tracking, and careful integration with the `tracing` ecosystem that Rust
applications depend on. The payoff is complete visibility: a single trace that
shows exactly which model answered, how long it took, what it cost, and whether
retries or provider fallbacks were involved.

Whether you are building AI pipelines with Axum, integrating OpenAI or Anthropic
via `async-openai` or raw HTTP clients, or running local models through Ollama,
this guide provides production-ready patterns for unified AI observability in
Rust. You will learn how to set up three-pillar telemetry (traces, metrics,
logs), create GenAI spans with the correct semantic conventions, define six
standard LLM metrics, implement retry and fallback observability, and deploy
with Docker Compose and the OpenTelemetry Collector - all visible in a single
trace on base14 Scout.

:::tip TL;DR

Instrument Rust AI applications with OpenTelemetry by creating manual GenAI
spans with `tracing::info_span!`, defining six standard LLM metrics with
`LazyLock`, and bridging `tracing` to the OTLP exporter. This gives you unified
traces from HTTP entry through pipeline stages to individual LLM completions,
with token and cost tracking per provider and model.

:::

> **Note:** For general LLM observability patterns applicable to any language,
> see the [LLM Observability guide](../llm-observability). This guide focuses
> specifically on Rust integration patterns. For basic Axum instrumentation
> without AI, see the
> [Axum guide](../../instrument/apps/auto-instrumentation/axum.md).

## Who This Guide Is For

This documentation is designed for:

- **Rust AI developers**: building LLM-powered features with `async-openai`,
  Anthropic HTTP clients, or custom providers and needing visibility into model
  performance, cost, and pipeline throughput
- **Backend developers**: adding AI capabilities (report generation, analysis,
  chat) to existing Axum or Actix-web applications and wanting unified tracing
  across all layers
- **Platform teams**: standardizing observability across Rust AI services and
  traditional microservices using OpenTelemetry
- **Engineering teams**: migrating from proprietary AI observability tools to
  open-standard OpenTelemetry
- **DevOps engineers**: deploying Rust AI applications with production
  monitoring, cost alerting, and pipeline health tracking

## Rust LLM Observability Overview

This guide demonstrates how to:

- Set up three-pillar OpenTelemetry for a Rust AI application (traces +
  metrics + logs)
- Create custom LLM spans following OpenTelemetry GenAI semantic conventions
- Define GenAI metrics for token usage, cost, duration, errors, retries, and
  fallbacks
- Instrument multi-stage AI pipelines with parent-child spans
- Track token usage and calculate cost per LLM call
- Implement multi-provider LLM support with retry and fallback observability
- Correlate trace IDs with database records for end-to-end debugging
- Deploy with Docker Compose and the OpenTelemetry Collector
- Export traces, metrics, and logs to base14 Scout

## Prerequisites

Before starting, ensure you have:

- **Rust 1.85 or later** installed (1.92+ recommended for edition 2024 support)
- **An LLM API key** from at least one provider (OpenAI, Anthropic, or Google)
- **Scout Collector** configured and accessible from your application
  - See
    [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
    for local development
  - See
    [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
    for production deployment
- Basic understanding of OpenTelemetry concepts (traces, spans, metrics)
- Familiarity with the Rust `tracing` crate

### Compatibility Matrix

| Component             | Minimum Version | Recommended |
| --------------------- | --------------- | ----------- |
| Rust                  | 1.85            | 1.92+       |
| opentelemetry         | 0.28            | 0.31+       |
| opentelemetry_sdk     | 0.28            | 0.31+       |
| opentelemetry-otlp    | 0.28            | 0.31+       |
| tracing-opentelemetry | 0.29            | 0.32+       |
| tracing               | 0.1             | 0.1+        |
| tracing-subscriber    | 0.3             | 0.3+        |
| async-openai          | 0.25+           | 0.33+       |
| Axum                  | 0.7+            | 0.8+        |
| SQLx                  | 0.7+            | 0.8+        |

## The Unified Trace

The core value of OpenTelemetry for Rust AI applications is the **unified
trace** - a single trace ID that connects every layer of a request, from HTTP
entry through pipeline stages to LLM completions and back.

Here is what a trace looks like for an AI pipeline request:

```text showLineNumbers title="Unified trace for POST /api/reports"
POST /api/reports                                  6.8s  [HTTP: tower-http]
├─ pipeline report                                 6.7s  [custom: orchestrator]
│  ├─ pipeline_stage retrieve                     45ms   [custom: pipeline]
│  │  └─ db.query SELECT data_points              12ms   [SQLx]
│  ├─ pipeline_stage analyze                       2.1s  [custom: pipeline]
│  │  └─ gen_ai.chat gpt-4.1-mini                 2.0s  [custom: LLM]
│  ├─ pipeline_stage generate                      4.3s  [custom: pipeline]
│  │  └─ gen_ai.chat gpt-4.1                      4.2s  [custom: LLM]
│  └─ pipeline_stage format                        5ms   [custom: pipeline]
└─ db.query INSERT reports                          8ms  [SQLx]
```

Three types of spans work together:

- **HTTP spans** (tower-http `TraceLayer`): Capture request method, path, status
  code, and latency automatically
- **Custom LLM spans**: Model name, provider, token counts, cost,
  prompt/completion events following GenAI semantic conventions
- **Custom pipeline spans**: Stage names, data point counts, business context
  like report ID and trace ID correlation

The HTTP span captures the incoming request. The pipeline span orchestrates
stages. Each `gen_ai.chat` span wraps an LLM call, adding provider, model,
token, and cost context. All are children of the same trace - giving you full
visibility from HTTP entry to LLM completion.

## Installation

Add the OpenTelemetry and tracing dependencies to your `Cargo.toml`:

```toml showLineNumbers title="Cargo.toml"
[dependencies]
# Web Framework
axum = { version = "0.8", features = ["macros"] }
tower = { version = "0.5", features = ["full"] }
tower-http = { version = "0.6", features = ["trace", "cors", "timeout", "request-id"] }

# Async Runtime
tokio = { version = "1", features = ["full", "tracing"] }

# Database
sqlx = { version = "0.8", features = [
    "runtime-tokio", "tls-rustls", "postgres",
    "macros", "uuid", "chrono", "json"
] }

# LLM Providers
async-openai = { version = "0.33", features = ["chat-completion"] }
reqwest = { version = "0.12", features = ["json"] }

# OpenTelemetry
opentelemetry = "0.31.0"
opentelemetry_sdk = { version = "0.31.0", features = [
    "rt-tokio", "logs", "metrics"
] }
opentelemetry-otlp = { version = "0.31.0", features = [
    "grpc-tonic", "trace", "logs", "metrics"
] }
opentelemetry-appender-tracing = "0.31.0"

# Tracing
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = [
    "env-filter", "json"
] }
tracing-opentelemetry = "0.32.0"

# Utilities
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
anyhow = "1"
dotenvy = "0.15"
```

> **Note:** The `opentelemetry`, `opentelemetry_sdk`, and `opentelemetry-otlp`
> crates must use the same version. The `tracing-opentelemetry` version must be
> compatible - check the
> [tracing-opentelemetry compatibility matrix](https://github.com/open-telemetry/opentelemetry-rust/tree/main/opentelemetry-tracing)
> for the correct pairing.

## Telemetry Initialization

Initialize the three OpenTelemetry pillars - traces, metrics, and logs - with
OTLP gRPC export. This runs once at application startup.

```rust showLineNumbers title="src/telemetry/init.rs"
use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    Resource,
    logs::SdkLoggerProvider,
    metrics::{PeriodicReader, SdkMeterProvider},
    trace::SdkTracerProvider,
};
use std::time::Duration;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{
    EnvFilter, Layer,
    layer::SubscriberExt,
    util::SubscriberInitExt,
};

use crate::config::Config;

pub struct TelemetryGuard {
    pub tracer_provider: SdkTracerProvider,
    pub logger_provider: SdkLoggerProvider,
    pub meter_provider: SdkMeterProvider,
}

impl TelemetryGuard {
    pub fn shutdown(&self) {
        if let Err(e) = self.tracer_provider.shutdown() {
            eprintln!("Error shutting down tracer provider: {e}");
        }
        if let Err(e) = self.logger_provider.shutdown() {
            eprintln!("Error shutting down logger provider: {e}");
        }
        if let Err(e) = self.meter_provider.shutdown() {
            eprintln!("Error shutting down meter provider: {e}");
        }
    }
}

pub fn init_telemetry(
    config: &Config,
) -> anyhow::Result<TelemetryGuard> {
    let resource = Resource::builder()
        .with_service_name(config.otel_service_name.clone())
        .with_attribute(KeyValue::new("service.version", "1.0.0"))
        .with_attribute(KeyValue::new(
            "service.namespace", "examples",
        ))
        .with_attribute(KeyValue::new(
            "deployment.environment",
            config.environment.clone(),
        ))
        .build();

    // --- Traces ---
    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otel_exporter_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(trace_exporter)
        .with_resource(resource.clone())
        .build();

    global::set_tracer_provider(tracer_provider.clone());

    // --- Metrics ---
    let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otel_exporter_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let metric_reader = PeriodicReader::builder(metric_exporter)
        .with_interval(Duration::from_secs(15))
        .build();

    let meter_provider = SdkMeterProvider::builder()
        .with_reader(metric_reader)
        .with_resource(resource.clone())
        .build();

    global::set_meter_provider(meter_provider.clone());

    // --- Logs ---
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otel_exporter_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    // Bridge tracing logs to OpenTelemetry
    let otel_log_layer =
        OpenTelemetryTracingBridge::new(&logger_provider);

    let tracer = global::tracer(config.otel_service_name.clone());
    let telemetry_layer = OpenTelemetryLayer::new(tracer);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            EnvFilter::new("info,tower_http=debug")
        });

    let fmt_layer = if config.is_production() {
        tracing_subscriber::fmt::layer().json().boxed()
    } else {
        tracing_subscriber::fmt::layer().pretty().boxed()
    };

    tracing_subscriber::registry()
        .with(env_filter)
        .with(telemetry_layer)
        .with(otel_log_layer)
        .with(fmt_layer)
        .init();

    tracing::info!(
        service = %config.otel_service_name,
        endpoint = %config.otel_exporter_endpoint,
        "Telemetry initialized with OTLP trace, metric, \
         and log export"
    );

    Ok(TelemetryGuard {
        tracer_provider,
        logger_provider,
        meter_provider,
    })
}
```

Key points:

- **`TelemetryGuard`** holds all three providers and flushes pending telemetry
  on shutdown - call `shutdown()` before process exit to avoid losing the final
  batch
- **`OpenTelemetryLayer`** converts `tracing` spans into OpenTelemetry spans
  with proper parent-child relationships
- **`OpenTelemetryTracingBridge`** routes structured log events (from
  `tracing::info!`, `tracing::warn!`, etc.) to the OTLP log exporter
- **`EnvFilter`** respects `RUST_LOG` environment variable for runtime log level
  control

### Application Startup

Wire the telemetry guard into your `main` function and ensure graceful shutdown:

```rust showLineNumbers title="src/main.rs"
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env();

    let telemetry_guard = init_telemetry(&config)?;

    tracing::info!(
        port = config.port,
        environment = %config.environment,
        "Starting ai-report-generator"
    );

    // ... build router, start server ...

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Server shutdown complete");
    telemetry_guard.shutdown();

    Ok(())
}
```

## Custom LLM Instrumentation

Rust has no auto-instrumentation libraries for LLM SDKs. You create manual spans
following the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
This gives you the same standardized telemetry that Python and Node.js
auto-instrumentors produce.

### GenAI Span Attributes

Every LLM call gets a `gen_ai.chat` span with these attributes:

| Attribute                        | Type   | Description                         |
| -------------------------------- | ------ | ----------------------------------- |
| `gen_ai.operation.name`          | string | Always `"chat"` for completions     |
| `gen_ai.provider.name`           | string | `"openai"`, `"anthropic"`, etc.     |
| `gen_ai.request.model`           | string | Model requested (e.g., `"gpt-4.1"`) |
| `gen_ai.request.temperature`     | float  | Sampling temperature                |
| `gen_ai.request.max_tokens`      | int    | Max output tokens requested         |
| `gen_ai.response.model`          | string | Model actually used                 |
| `gen_ai.usage.input_tokens`      | int    | Prompt tokens consumed              |
| `gen_ai.usage.output_tokens`     | int    | Completion tokens generated         |
| `gen_ai.response.finish_reasons` | string | `"stop"`, `"length"`, etc.          |
| `server.address`                 | string | API endpoint host                   |
| `server.port`                    | int    | API endpoint port                   |

### Creating GenAI Spans

Use `tracing::info_span!` with `tracing::field::Empty` for attributes that are
only known after the LLM call completes:

```rust showLineNumbers title="src/llm/client.rs"
use opentelemetry::KeyValue;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub async fn generate_once(
    &self,
    provider: &dyn Provider,
    provider_name: &str,
    req: &GenerateRequest,
) -> anyhow::Result<GenerateResponse> {
    let span_display_name = format!("gen_ai.chat {}", req.model);
    let start = std::time::Instant::now();

    let span = tracing::info_span!(
        "gen_ai.chat",
        otel.name = %span_display_name,
        gen_ai.operation.name = "chat",
        gen_ai.provider.name = %provider_name,
        gen_ai.request.model = %req.model,
        gen_ai.request.temperature = req.temperature,
        gen_ai.request.max_tokens = req.max_tokens as i64,
        server.address = %server_addr,
        server.port = server_port,
        // Filled after LLM response
        gen_ai.response.model = tracing::field::Empty,
        gen_ai.usage.input_tokens = tracing::field::Empty,
        gen_ai.usage.output_tokens = tracing::field::Empty,
        gen_ai.usage.cost_usd = tracing::field::Empty,
        gen_ai.response.finish_reasons = tracing::field::Empty,
        report.stage = %req.stage,
        otel.status_code = tracing::field::Empty,
        error.type = tracing::field::Empty,
    );

    // Record prompt and system instructions as span events
    {
        let mut user_event_attrs = vec![KeyValue::new(
            "gen_ai.prompt",
            truncate(&req.prompt, 1000),
        )];
        if !req.system.is_empty() {
            user_event_attrs.push(KeyValue::new(
                "gen_ai.system_instructions",
                truncate(&req.system, 500),
            ));
        }
        span.add_event(
            "gen_ai.user.message",
            user_event_attrs,
        );
    }

    // Execute LLM call within the span
    let result = provider
        .generate(req)
        .instrument(span.clone())
        .await;

    match result {
        Ok(mut resp) => {
            resp.provider = provider_name.to_string();
            resp.cost_usd = calculate_cost(
                &resp.model,
                resp.input_tokens,
                resp.output_tokens,
            );

            // Fill response attributes
            span.record(
                "gen_ai.response.model",
                resp.model.as_str(),
            );
            span.record(
                "gen_ai.usage.input_tokens",
                resp.input_tokens as i64,
            );
            span.record(
                "gen_ai.usage.output_tokens",
                resp.output_tokens as i64,
            );
            span.record(
                "gen_ai.usage.cost_usd",
                resp.cost_usd,
            );
            if !resp.finish_reason.is_empty() {
                span.record(
                    "gen_ai.response.finish_reasons",
                    resp.finish_reason.as_str(),
                );
            }

            // Record completion as a span event
            span.add_event(
                "gen_ai.assistant.message",
                vec![KeyValue::new(
                    "gen_ai.completion",
                    truncate(&resp.content, 2000),
                )],
            );

            Ok(resp)
        }
        Err(err) => {
            span.record("otel.status_code", "ERROR");
            span.record(
                "error.type",
                classify_error(&err),
            );

            GEN_AI_ERROR_COUNT.add(
                1,
                &[
                    KeyValue::new(
                        "gen_ai.provider.name",
                        provider_name.to_string(),
                    ),
                    KeyValue::new(
                        "gen_ai.request.model",
                        req.model.clone(),
                    ),
                ],
            );

            Err(err)
        }
    }
}
```

Key patterns:

- **`tracing::field::Empty`** declares span fields that are filled later with
  `span.record()` - this is how you handle attributes that depend on the LLM
  response
- **`.instrument(span.clone())`** executes the async LLM call within the span
  context, so the span duration matches the actual API call
- **`span.add_event()`** uses `opentelemetry::KeyValue` (not `tracing` fields)
  to record prompt and completion content as structured span events
- **`otel.name`** overrides the span display name in your trace viewer to show
  the model name

> **Note:** The complete `generate_once` function also records GenAI metrics
> (token usage, cost, duration) alongside the span attributes shown above. See
> [Token and Cost Tracking](#token-and-cost-tracking) for the metric recording
> code that runs in the same `Ok(resp)` branch.

### Error Classification

Classify LLM errors into standardized types for filtering and alerting:

```rust showLineNumbers title="src/llm/client.rs"
fn classify_error(err: &anyhow::Error) -> &'static str {
    let msg = err.to_string().to_lowercase();
    if msg.contains("rate limit") || msg.contains("429") {
        "rate_limit"
    } else if msg.contains("timeout")
        || msg.contains("timed out")
        || msg.contains("deadline")
    {
        "timeout"
    } else if msg.contains("401")
        || msg.contains("403")
        || msg.contains("auth")
        || msg.contains("api key")
    {
        "auth_error"
    } else if msg.contains("400")
        || msg.contains("422")
        || msg.contains("invalid")
    {
        "invalid_request"
    } else if msg.contains("500")
        || msg.contains("502")
        || msg.contains("503")
        || msg.contains("server")
    {
        "server_error"
    } else if msg.contains("connect")
        || msg.contains("dns")
        || msg.contains("network")
        || msg.contains("reset")
    {
        "network_error"
    } else {
        "unknown_error"
    }
}
```

This lets you alert on `error.type = "rate_limit"` separately from
`error.type = "timeout"` in Scout dashboards.

## Token and Cost Tracking

Define GenAI metrics following the OpenTelemetry GenAI semantic conventions.
These metrics power dashboards for token consumption, cost attribution, and
provider reliability.

### Metric Definitions

```rust showLineNumbers title="src/telemetry/metrics.rs"
use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter},
};
use std::sync::LazyLock;

pub static METER: LazyLock<Meter> =
    LazyLock::new(|| global::meter("ai-report-generator"));

// --- GenAI Contract Metrics (6 required) ---

pub static GEN_AI_TOKEN_USAGE: LazyLock<Histogram<f64>> =
    LazyLock::new(|| {
        METER
            .f64_histogram("gen_ai.client.token.usage")
            .with_description(
                "Number of tokens used per LLM call",
            )
            .with_unit("{token}")
            .build()
    });

pub static GEN_AI_OPERATION_DURATION: LazyLock<Histogram<f64>> =
    LazyLock::new(|| {
        METER
            .f64_histogram("gen_ai.client.operation.duration")
            .with_description(
                "Duration of LLM operations in seconds",
            )
            .with_unit("s")
            .build()
    });

pub static GEN_AI_COST: LazyLock<Counter<f64>> =
    LazyLock::new(|| {
        METER
            .f64_counter("gen_ai.client.cost")
            .with_description(
                "Estimated cost of LLM operations in USD",
            )
            .with_unit("usd")
            .build()
    });

pub static GEN_AI_RETRY_COUNT: LazyLock<Counter<u64>> =
    LazyLock::new(|| {
        METER
            .u64_counter("gen_ai.client.retry.count")
            .with_description("Number of LLM call retries")
            .with_unit("{retry}")
            .build()
    });

pub static GEN_AI_FALLBACK_COUNT: LazyLock<Counter<u64>> =
    LazyLock::new(|| {
        METER
            .u64_counter("gen_ai.client.fallback.count")
            .with_description(
                "Number of LLM fallback activations",
            )
            .with_unit("{fallback}")
            .build()
    });

pub static GEN_AI_ERROR_COUNT: LazyLock<Counter<u64>> =
    LazyLock::new(|| {
        METER
            .u64_counter("gen_ai.client.error.count")
            .with_description("Number of LLM call errors")
            .with_unit("{error}")
            .build()
    });
```

### Recording Token and Cost Metrics

After each successful LLM call, record token usage with provider and model
dimensions:

```rust showLineNumbers title="src/llm/client.rs"
use crate::telemetry::metrics::{
    GEN_AI_COST, GEN_AI_OPERATION_DURATION, GEN_AI_TOKEN_USAGE,
};

// Inside the Ok(resp) branch of generate_once:
let op_kv = KeyValue::new("gen_ai.operation.name", "chat");
let provider_kv = KeyValue::new(
    "gen_ai.provider.name",
    provider_name.to_string(),
);
let model_kv = KeyValue::new(
    "gen_ai.request.model",
    resp.model.clone(),
);

GEN_AI_TOKEN_USAGE.record(
    f64::from(resp.input_tokens),
    &[
        KeyValue::new("gen_ai.token.type", "input"),
        op_kv.clone(),
        provider_kv.clone(),
        model_kv.clone(),
    ],
);

GEN_AI_TOKEN_USAGE.record(
    f64::from(resp.output_tokens),
    &[
        KeyValue::new("gen_ai.token.type", "output"),
        op_kv.clone(),
        provider_kv.clone(),
        model_kv.clone(),
    ],
);

GEN_AI_OPERATION_DURATION.record(
    duration,
    &[op_kv.clone(), provider_kv.clone(), model_kv.clone()],
);

GEN_AI_COST.add(
    resp.cost_usd,
    &[op_kv, provider_kv, model_kv],
);
```

The `gen_ai.token.type` dimension (`"input"` or `"output"`) lets you build
dashboards that break down token consumption by direction, provider, and model.

### Cost Calculation

Load model pricing from a configuration file and calculate cost per call:

```rust showLineNumbers title="src/llm/pricing.rs"
pub fn calculate_cost(
    model: &str,
    input_tokens: u32,
    output_tokens: u32,
) -> f64 {
    // PRICING maps model name to PriceEntry { input, output }
    // where input/output are price per million tokens
    match PRICING.get(model) {
        Some(entry) => {
            (f64::from(input_tokens) * entry.input
                / 1_000_000.0)
                + (f64::from(output_tokens) * entry.output
                    / 1_000_000.0)
        }
        None => 0.0,
    }
}
```

This feeds the `gen_ai.client.cost` counter metric for per-model and
per-provider cost dashboards.

## Pipeline Observability

AI applications typically involve multi-stage pipelines. Each stage gets its own
span, creating a clear parent-child hierarchy in your traces.

### Pipeline Orchestrator

The orchestrator span wraps the entire pipeline and extracts the trace ID for
database correlation:

```rust showLineNumbers title="src/pipeline/orchestrator.rs"
use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[tracing::instrument(
    name = "pipeline report",
    skip(pool, llm_client),
    fields(
        report.id,
        report.indicators_count,
        report.duration_ms,
    )
)]
pub async fn generate_report(
    pool: &PgPool,
    llm_client: &LlmClient,
    model_capable: &str,
    model_fast: &str,
    request: &ReportRequest,
) -> Result<Report, AppError> {
    let start = std::time::Instant::now();

    // Extract trace ID for database correlation
    let span = tracing::Span::current();
    let context = span.context();
    let otel_span = context.span();
    let trace_id = otel_span
        .span_context()
        .trace_id()
        .to_string();

    // Stage 1: Retrieve data from PostgreSQL
    let data = retrieve::retrieve(
        pool, &request.indicators,
        request.start_date, request.end_date,
    ).await?;

    // Stage 2: Analyze trends via LLM (fast model)
    let analysis = analyze::analyze(
        llm_client, model_fast, &data.indicators,
    ).await?;

    // Stage 3: Generate narrative via LLM (capable model)
    let narrative = generate::generate(
        llm_client, model_capable,
        &data.indicators, &analysis,
    ).await?;

    // Stage 4: Format final report
    let duration = start.elapsed();
    let report = format::format_report(FormatParams {
        trace_id,
        duration,
        // ...
    })?;

    // Record domain metrics
    REPORT_GENERATION_DURATION.record(
        duration.as_secs_f64(), &[],
    );
    REPORT_DATA_POINTS.record(
        report.total_data_points as f64, &[],
    );
    REPORT_SECTIONS.record(
        report.sections.len() as f64, &[],
    );

    span.record("report.id", report.id.to_string());
    span.record(
        "report.indicators_count",
        report.indicators_used.len(),
    );
    span.record(
        "report.duration_ms",
        report.generation_duration_ms,
    );

    Ok(report)
}
```

### Pipeline Stage Spans

Each stage uses `#[tracing::instrument]` with stage-specific fields:

```rust showLineNumbers title="src/pipeline/retrieve.rs"
#[tracing::instrument(
    name = "pipeline_stage retrieve",
    skip(pool),
    fields(
        pipeline.stage = "retrieve",
        report.indicators_count,
        report.data_points,
    )
)]
pub async fn retrieve(
    pool: &PgPool,
    indicator_codes: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<RetrieveResult, AppError> {
    let indicators = query_indicator_data(
        pool, indicator_codes, start_date, end_date,
    )
    .await
    .map_err(AppError::Database)?;

    let total_data_points: usize =
        indicators.iter().map(|i| i.values.len()).sum();

    let span = tracing::Span::current();
    span.record(
        "report.indicators_count",
        indicators.len(),
    );
    span.record("report.data_points", total_data_points);

    Ok(RetrieveResult { indicators, total_data_points })
}
```

```rust showLineNumbers title="src/pipeline/analyze.rs"
#[tracing::instrument(
    name = "pipeline_stage analyze",
    skip(llm_client, data),
    fields(
        pipeline.stage = "analyze",
        analysis.trends_found,
        analysis.key_findings,
    )
)]
pub async fn analyze(
    llm_client: &LlmClient,
    model: &str,
    data: &[IndicatorData],
) -> Result<AnalysisResult, AppError> {
    // Build data summary and prompt (omitted for brevity)
    let system = include_str!("../../data/schema-context.txt")
        .to_string();

    let resp = llm_client
        .generate(&GenerateRequest {
            model: model.to_string(),
            system,
            prompt,
            temperature: 0.3,
            max_tokens: 2048,
            stage: "analyze".to_string(),
        })
        .await
        .map_err(|e| AppError::Llm(e.to_string()))?;

    // Parse JSON response and preserve provider
    let provider = resp.provider.clone();
    let mut analysis = parse_analysis_response(
        &resp.content,
        resp.input_tokens,
        resp.output_tokens,
        resp.cost_usd,
    )?;
    analysis.provider = provider;

    let span = tracing::Span::current();
    span.record(
        "analysis.trends_found",
        analysis.trends.len(),
    );
    span.record(
        "analysis.key_findings",
        analysis.key_findings.len(),
    );

    Ok(analysis)
}
```

The resulting trace shows clear parent-child relationships: `pipeline report` →
`pipeline_stage analyze` → `gen_ai.chat gpt-4.1-mini`. Each stage is
independently timed and attributed.

### Trace ID Correlation

Store the OpenTelemetry trace ID alongside business data in your database. This
lets you jump from a database record directly to its trace in Scout:

```sql showLineNumbers title="db/schema.sql"
CREATE TABLE reports (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    -- ... other fields ...
    trace_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Extract the trace ID from the current span context:

```rust showLineNumbers title="Extract trace ID"
use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

let span = tracing::Span::current();
let context = span.context();
let trace_id = context
    .span()
    .span_context()
    .trace_id()
    .to_string();
```

## Retry and Fallback Observability

LLM APIs are unreliable. Retries and provider fallbacks must be observable to
understand real-world reliability.

### Retry with Exponential Backoff

```rust showLineNumbers title="src/llm/client.rs"
pub async fn generate_with_retry(
    &self,
    provider: &dyn Provider,
    provider_name: &str,
    req: &GenerateRequest,
) -> anyhow::Result<GenerateResponse> {
    let max_retries: u32 = 3;
    let mut last_err = None;

    for attempt in 0..max_retries {
        match self.generate_once(
            provider, provider_name, req,
        ).await {
            Ok(resp) => return Ok(resp),
            Err(err) => {
                tracing::warn!(
                    attempt = attempt + 1,
                    max_retries,
                    provider = provider_name,
                    model = %req.model,
                    error = %err,
                    "LLM call failed, retrying"
                );

                if attempt > 0 {
                    GEN_AI_RETRY_COUNT.add(1, &[
                        KeyValue::new(
                            "gen_ai.provider.name",
                            provider_name.to_string(),
                        ),
                        KeyValue::new(
                            "gen_ai.request.model",
                            req.model.clone(),
                        ),
                    ]);
                }

                last_err = Some(err);

                if attempt < max_retries - 1 {
                    // Exponential backoff: 1s, 2s, 4s
                    // (capped at 10s)
                    let base = Duration::from_secs(1)
                        * 2u32.pow(attempt);
                    let base = base.min(
                        Duration::from_secs(10),
                    );
                    // 25% jitter to avoid thundering herd
                    let jitter_ms = fastrand::u64(
                        0..=base.as_millis() as u64 / 4,
                    );
                    let delay = base
                        + Duration::from_millis(jitter_ms);
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        anyhow::anyhow!("all retries exhausted")
    }))
}
```

### Provider Fallback

When the primary provider fails after all retries, fall back to a secondary
provider:

```rust showLineNumbers title="src/llm/client.rs"
pub async fn generate(
    &self,
    req: &GenerateRequest,
) -> anyhow::Result<GenerateResponse> {
    let result = self.generate_with_retry(
        self.primary.as_ref(),
        &self.primary_provider,
        req,
    ).await;

    match result {
        Ok(resp) => Ok(resp),
        Err(primary_err) => {
            if let Some(ref fallback) = self.fallback {
                tracing::warn!(
                    primary_provider = %self.primary_provider,
                    fallback_provider = %self.fallback_provider,
                    error = %primary_err,
                    "Primary provider failed, falling back"
                );

                GEN_AI_FALLBACK_COUNT.add(1, &[]);

                let fallback_req = GenerateRequest {
                    model: self.fallback_model.clone(),
                    ..req.clone()
                };

                self.generate_with_retry(
                    fallback.as_ref(),
                    &self.fallback_provider,
                    &fallback_req,
                ).await
            } else {
                Err(anyhow::anyhow!(
                    "primary provider {} failed \
                     after retries: {}",
                    self.primary_provider,
                    primary_err
                ))
            }
        }
    }
}
```

Each retry creates a new `gen_ai.chat` span, so you see every attempt in the
trace. The `gen_ai.client.retry.count` and `gen_ai.client.fallback.count`
metrics let you build reliability dashboards and alert on degradation.

## HTTP Instrumentation

Use tower-http's `TraceLayer` with custom `MakeSpan` and `OnResponse`
implementations to capture HTTP metrics and set OpenTelemetry status codes:

```rust showLineNumbers title="src/main.rs"
use tower_http::trace::{MakeSpan, OnResponse, TraceLayer};

#[derive(Clone)]
struct HttpMakeSpan;

impl<B> MakeSpan<B> for HttpMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let method = request.method().as_str();
        let path = request.uri().path();

        tracing::info_span!(
            "HTTP request",
            otel.name = %format!("{} {}", method, path),
            http.method = %method,
            http.route = %path,
            http.target = %request.uri(),
            http.scheme = "http",
            http.flavor = ?request.version(),
            http.user_agent = request.headers()
                .get("user-agent")
                .and_then(|v| v.to_str().ok())
                .unwrap_or(""),
            http.response.status_code = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        )
    }
}

#[derive(Clone)]
struct HttpOnResponse;

impl<B> OnResponse<B> for HttpOnResponse {
    fn on_response(
        self,
        response: &Response<B>,
        latency: Duration,
        span: &Span,
    ) {
        let status = response.status().as_u16();
        span.record(
            "http.response.status_code",
            status as i64,
        );

        if status >= 500 {
            span.record("otel.status_code", "ERROR");
        } else {
            span.record("otel.status_code", "OK");
        }

        let latency_ms = latency.as_secs_f64() * 1000.0;
        let status_class =
            format!("{}xx", status / 100);

        HTTP_REQUESTS_TOTAL.add(1, &[
            KeyValue::new(
                "http.status_code",
                status.to_string(),
            ),
            KeyValue::new(
                "http.status_class",
                status_class.clone(),
            ),
        ]);
        HTTP_REQUEST_DURATION.record(latency_ms, &[
            KeyValue::new(
                "http.status_code",
                status.to_string(),
            ),
            KeyValue::new(
                "http.status_class",
                status_class,
            ),
        ]);

        tracing::info!(
            http.response.status_code = status,
            latency_ms = latency_ms,
            "finished processing request"
        );
    }
}

// Apply to router
let app = Router::new()
    .route("/api/reports", post(create_report))
    .route("/api/reports", get(list_reports))
    .layer(
        TraceLayer::new_for_http()
            .make_span_with(HttpMakeSpan)
            .on_response(HttpOnResponse),
    );
```

## Multi-Provider LLM Architecture

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

The provider trait pattern lets you support multiple LLM backends (OpenAI,
Anthropic, Google, Ollama) with consistent telemetry:

```rust showLineNumbers title="src/llm/mod.rs"
#[derive(Debug, Clone)]
pub struct GenerateRequest {
    pub model: String,
    pub system: String,
    pub prompt: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub stage: String,
}

#[derive(Debug, Clone)]
pub struct GenerateResponse {
    pub content: String,
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cost_usd: f64,
    pub finish_reason: String,
    pub provider: String,
}

#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    async fn generate(
        &self,
        req: &GenerateRequest,
    ) -> anyhow::Result<GenerateResponse>;
    fn name(&self) -> &str;
}
```

The `LlmClient` wraps this trait with retry, fallback, and telemetry logic. Each
provider implementation only needs to implement the `Provider` trait - all
observability happens in the client layer.

```mdx-code-block
<Tabs groupId="llm-provider">
<TabItem value="openai" label="OpenAI / Google / Ollama" default>
```

Uses the `async-openai` crate. Google and Ollama work through OpenAI-compatible
endpoints with a different base URL:

```rust showLineNumbers title="src/llm/openai.rs"
use async_openai::{
    Client,
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessage,
        ChatCompletionRequestSystemMessageContent,
        ChatCompletionRequestUserMessage,
        ChatCompletionRequestUserMessageContent,
        CreateChatCompletionRequest,
    },
};

pub struct OpenAIProvider {
    client: Client<OpenAIConfig>,
    provider_name: String,
}

impl OpenAIProvider {
    pub fn new(api_key: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key);
        Self {
            client: Client::with_config(config),
            provider_name: "openai".to_string(),
        }
    }

    pub fn new_google(api_key: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key(api_key)
            .with_api_base(
                "https://generativelanguage.googleapis.com\
                 /v1beta/openai",
            );
        Self {
            client: Client::with_config(config),
            provider_name: "google".to_string(),
        }
    }

    pub fn new_ollama(base_url: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_key("ollama")
            .with_api_base(format!("{base_url}/v1"));
        Self {
            client: Client::with_config(config),
            provider_name: "ollama".to_string(),
        }
    }
}

#[async_trait::async_trait]
impl Provider for OpenAIProvider {
    async fn generate(
        &self,
        req: &GenerateRequest,
    ) -> anyhow::Result<GenerateResponse> {
        let messages = vec![
            ChatCompletionRequestMessage::System(
                ChatCompletionRequestSystemMessage {
                    content:
                        ChatCompletionRequestSystemMessageContent::Text(
                            req.system.clone(),
                        ),
                    name: None,
                },
            ),
            ChatCompletionRequestMessage::User(
                ChatCompletionRequestUserMessage {
                    content:
                        ChatCompletionRequestUserMessageContent::Text(
                            req.prompt.clone(),
                        ),
                    name: None,
                },
            ),
        ];

        #[allow(deprecated)]
        let request = CreateChatCompletionRequest {
            model: req.model.clone(),
            messages,
            temperature: Some(req.temperature),
            max_completion_tokens: Some(req.max_tokens),
            ..Default::default()
        };

        let response =
            self.client.chat().create(request).await?;

        let content = response
            .choices
            .first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default();

        let finish_reason = response
            .choices
            .first()
            .and_then(|c| c.finish_reason)
            .map(|r| format!("{r:?}").to_lowercase())
            .unwrap_or_default();

        let (input_tokens, output_tokens) =
            match &response.usage {
                Some(u) => (u.prompt_tokens, u.completion_tokens),
                None => (0, 0),
            };

        Ok(GenerateResponse {
            content,
            model: response.model,
            input_tokens,
            output_tokens,
            cost_usd: 0.0,
            finish_reason,
            provider: String::new(),
        })
    }

    fn name(&self) -> &str {
        &self.provider_name
    }
}
```

```mdx-code-block
</TabItem>
<TabItem value="anthropic" label="Anthropic">
```

Uses raw `reqwest` HTTP client since Anthropic has a different API format:

```rust showLineNumbers title="src/llm/anthropic.rs"
use reqwest::header::{
    CONTENT_TYPE, HeaderMap, HeaderValue,
};

pub struct AnthropicProvider {
    client: reqwest::Client,
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(api_key: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key: api_key.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl Provider for AnthropicProvider {
    async fn generate(
        &self,
        req: &GenerateRequest,
    ) -> anyhow::Result<GenerateResponse> {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&self.api_key)?,
        );
        headers.insert(
            "anthropic-version",
            HeaderValue::from_static("2023-06-01"),
        );
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );

        let body = serde_json::json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": [{
                "role": "user",
                "content": req.prompt,
            }],
        });

        let response = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .headers(headers)
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_body =
                response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Anthropic API error ({}): {}",
                status,
                error_body
            ));
        }

        let resp: serde_json::Value =
            response.json().await?;

        let content = resp["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|c| c["text"].as_str())
            .unwrap_or_default()
            .to_string();

        let input_tokens = resp["usage"]["input_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        let output_tokens =
            resp["usage"]["output_tokens"]
                .as_u64()
                .unwrap_or(0) as u32;

        Ok(GenerateResponse {
            content,
            model: resp["model"]
                .as_str()
                .unwrap_or(&req.model)
                .to_string(),
            input_tokens,
            output_tokens,
            cost_usd: 0.0,
            finish_reason: resp["stop_reason"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            provider: String::new(),
        })
    }

    fn name(&self) -> &str {
        "anthropic"
    }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

Provider initialization selects the backend based on configuration:

```rust showLineNumbers title="src/main.rs - Provider initialization"
let primary: Arc<dyn Provider> = match config
    .llm_provider
    .as_str()
{
    "anthropic" => Arc::new(
        AnthropicProvider::new(api_key),
    ),
    "google" => Arc::new(
        OpenAIProvider::new_google(api_key),
    ),
    "ollama" => Arc::new(
        OpenAIProvider::new_ollama(&base_url),
    ),
    _ => Arc::new(OpenAIProvider::new(api_key)),
};

let llm_client = Arc::new(LlmClient {
    primary,
    fallback,
    primary_provider: config.llm_provider.clone(),
    fallback_provider: config.fallback_provider.clone(),
    fallback_model: config.fallback_model.clone(),
});
```

## PII and Security

LLM prompts and completions often contain sensitive data. Truncate and sanitize
content before recording in span events.

### Content Truncation

Always truncate prompt and completion content before adding to span events to
avoid oversized spans and limit sensitive data exposure:

```rust showLineNumbers title="src/llm/client.rs"
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Safe for multi-byte UTF-8
        s.char_indices()
            .take_while(|&(i, _)| i < max)
            .map(|(_, c)| c)
            .collect()
    }
}

// Usage in span events
span.add_event(
    "gen_ai.user.message",
    vec![KeyValue::new(
        "gen_ai.prompt",
        truncate(&req.prompt, 1000),
    )],
);

span.add_event(
    "gen_ai.assistant.message",
    vec![KeyValue::new(
        "gen_ai.completion",
        truncate(&resp.content, 2000),
    )],
);
```

### Security Considerations

- **Truncate prompts** to 1000 characters and completions to 2000 characters to
  limit data exposure in telemetry
- **Never record API keys** in span attributes or events - load keys from
  environment variables, not configuration files
- **Use the OpenTelemetry Collector** `filter` processor to drop sensitive spans
  before they leave your network
- **Strip HTTP headers** like `Authorization` from HTTP spans - tower-http's
  `TraceLayer` does not record headers by default, which is the safe behavior
- **Consider disabling prompt/completion events** in production if your data is
  subject to GDPR, HIPAA, or PCI-DSS compliance requirements by removing the
  `add_event` calls

## Running Your Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

Run with console output and debug logging:

```bash showLineNumbers title="Terminal"
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_SERVICE_NAME=ai-report-generator
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/report_generator

cargo run
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

Set environment-specific configuration:

```bash showLineNumbers title="Terminal"
export SCOUT_ENVIRONMENT=production
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
export OTEL_SERVICE_NAME=ai-report-generator
export RUST_LOG=info,tower_http=info

cargo run --release
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

Deploy the application, PostgreSQL, and OpenTelemetry Collector together:

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - APP_PORT=8080
      - DATABASE_URL=postgres://postgres:postgres@postgres:5432/report_generator?sslmode=disable
      - LLM_PROVIDER=${LLM_PROVIDER:-openai}
      - LLM_MODEL_CAPABLE=${LLM_MODEL_CAPABLE:-gpt-4.1}
      - LLM_MODEL_FAST=${LLM_MODEL_FAST:-gpt-4.1-mini}
      - FALLBACK_PROVIDER=${FALLBACK_PROVIDER:-anthropic}
      - FALLBACK_MODEL=${FALLBACK_MODEL:-claude-haiku-4-5-20251001}
      - OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY:-}
      - OTEL_SERVICE_NAME=ai-report-generator
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:8080/api/health",
        ]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s

  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: report_generator
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.146.1
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./config/otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
      - "55679:55679"
    environment:
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-https://collector.base14.io}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}

volumes:
  pgdata:
```

### OpenTelemetry Collector Configuration

```yaml showLineNumbers title="config/otel-collector-config.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'

  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048

  attributes:
    actions:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s
  debug:
    verbosity: detailed
    sampling_initial: 100
    sampling_thereafter: 100

extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  zpages:
    endpoint: 0.0.0.0:55679
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s

service:
  extensions: [health_check, zpages, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, attributes, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
```

### Dockerfile

Multi-stage build for minimal production images:

```dockerfile showLineNumbers title="Dockerfile"
FROM rust:1.92-alpine AS builder

WORKDIR /build
RUN apk add --no-cache musl-dev openssl-dev \
    openssl-libs-static pkgconfig protobuf-dev

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
COPY data ./data
RUN touch src/main.rs && cargo build --release --bin server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates tzdata wget \
    && adduser -D -g '' -u 1001 appuser

WORKDIR /app
COPY --from=builder /build/target/release/server .
COPY --from=builder /build/_shared/pricing.json /app/_shared/pricing.json

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s \
    --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/health \
    || exit 1

CMD ["./server"]
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verify Telemetry Is Working

Check that spans are being exported by looking for the telemetry initialization
log:

```bash showLineNumbers title="Terminal"
docker compose logs app 2>&1 | grep "Telemetry initialized"
```

### Enable Debug Logging

```bash showLineNumbers title="Terminal"
export RUST_LOG=debug,h2=info,hyper=info
```

This enables debug output for your application while suppressing noisy HTTP/2
and Hyper transport logs.

### Check Collector Health

```bash showLineNumbers title="Terminal"
curl http://localhost:13133/health
# {"status":"Server available","..."}
```

#### Issue: No spans appearing in Scout

**Solutions:**

1. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` points to the collector (e.g.,
   `http://otel-collector:4317` in Docker, `http://localhost:4317` locally)
2. Check that `telemetry_guard.shutdown()` is called before process exit - the
   batch exporter flushes on shutdown
3. Add a `debug` exporter to the collector config to see incoming spans in
   collector logs

#### Issue: Spans missing parent-child relationships

**Solutions:**

1. Ensure async operations use `.instrument(span.clone())` to propagate the span
   context across `await` points
2. Use `#[tracing::instrument]` on async functions - it automatically creates
   child spans
3. Enable `tracing` feature on `tokio` in Cargo.toml:
   `tokio = { features = ["tracing"] }`

#### Issue: Metrics not appearing

**Solutions:**

1. Verify `PeriodicReader` interval - metrics are batched and exported every 15
   seconds by default
2. Check that `global::set_meter_provider()` is called before any metric
   instruments are created
3. Ensure the collector `metrics` pipeline is configured with the OTLP receiver

#### Issue: LLM span attributes are empty

**Solutions:**

1. Check that `span.record()` is called with the correct field name matching the
   `tracing::info_span!` declaration
2. Verify `tracing::field::Empty` fields are declared in the span macro - you
   cannot record fields that were not declared
3. Ensure `.instrument(span.clone())` is used, not
   `.instrument(tracing::Span::current())`

## Performance Considerations

### Expected Impact

| Metric        | Without OTel | With OTel | Delta      |
| ------------- | ------------ | --------- | ---------- |
| Latency (p99) | baseline     | +0.5-1ms  | &lt; 1ms   |
| Memory        | baseline     | +5-10 MB  | minimal    |
| CPU           | baseline     | +1-2%     | negligible |

Rust's zero-cost abstractions mean OpenTelemetry overhead is minimal compared to
Python or Node.js. The batch exporter handles I/O asynchronously, so span
creation is nearly free.

### Optimization Tips

#### 1. Use Batch Export

The default `with_batch_exporter()` is already optimal. Avoid
`SimpleSpanProcessor` in production - it blocks on every span.

#### 2. Tune Metric Export Interval

```rust showLineNumbers title="Adjust interval for high-throughput"
let metric_reader = PeriodicReader::builder(metric_exporter)
    .with_interval(Duration::from_secs(30)) // 30s for lower overhead
    .build();
```

#### 3. Filter Noisy Spans at the Collector

Drop health check and readiness probe spans in the collector rather than in
application code:

```yaml showLineNumbers title="config/otel-collector-config.yaml"
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'
```

#### 4. Limit Attribute Sizes

Truncate prompt and completion content to avoid oversized spans:

```rust showLineNumbers title="Truncation limits"
// Prompts: 1000 chars max
truncate(&req.prompt, 1000)
// Completions: 2000 chars max
truncate(&resp.content, 2000)
// System instructions: 500 chars max
truncate(&req.system, 500)
```

#### 5. Conditional Span Recording

Skip detailed span events in high-throughput scenarios:

```rust showLineNumbers title="Conditional recording"
if config.record_prompt_events {
    span.add_event(
        "gen_ai.user.message",
        vec![KeyValue::new(
            "gen_ai.prompt",
            truncate(&req.prompt, 1000),
        )],
    );
}
```

## FAQ

### How much overhead does OpenTelemetry add to Rust applications?

Less than 1ms per request in most cases. Rust's zero-cost abstractions and the
batch exporter design mean span creation is a few microseconds. The OTLP gRPC
export happens asynchronously and does not block request processing.

### What Rust crates do I need for OpenTelemetry LLM tracing?

Yes. The `tracing` crate is the idiomatic Rust instrumentation API. The
`tracing-opentelemetry` crate bridges `tracing` spans to OpenTelemetry spans.
The `opentelemetry` crate provides the export pipeline (OTLP, metrics, logs).
You write code using `tracing` macros and the OpenTelemetry SDK handles export.

### Should I use the tracing crate or OpenTelemetry API directly in Rust?

You can, but it is not recommended for Rust applications. The `tracing`
ecosystem integrates with Tokio, tower, SQLx, and most Rust libraries. Using the
OpenTelemetry API directly would miss automatic span propagation across async
boundaries and structured log integration.

### Does Rust have auto-instrumentation for LLM APIs like Python does?

No. Rust does not have LLM auto-instrumentation libraries like Python's
`opentelemetry-instrumentation-anthropic` or Node.js instrumentors. You create
GenAI spans manually, which gives you full control over which attributes to
record and how to handle provider-specific response formats.

### How do I track costs across multiple LLM providers?

Use the `gen_ai.client.cost` counter metric with `gen_ai.provider.name` and
`gen_ai.request.model` dimensions. Load pricing from a configuration file and
calculate cost per call based on input/output token counts. The metric
dimensions let you build per-provider and per-model cost dashboards.

### Can I use Ollama (local models) with the same instrumentation?

Yes. The provider trait pattern abstracts away the backend. Ollama exposes an
OpenAI-compatible API, so you can use the same `async-openai` client pointed at
`http://localhost:11434/v1`. All GenAI spans and metrics work identically - only
`gen_ai.provider.name` and `server.address` change.

### How do I reduce trace volume from LLM applications?

Use the collector's `filter` processor to drop noisy spans (health checks,
readiness probes). For high-volume applications, use the collector's
`probabilistic_sampler` processor. You can also disable prompt/completion span
events to reduce span size while keeping the core GenAI attributes.

### What happens if the collector is unavailable?

The batch exporter buffers spans in memory and retries export. If the collector
remains unavailable, buffered spans are eventually dropped. Your application
continues to run normally - telemetry export is non-blocking. Configure the
collector with health checks and ensure it starts before your application in
Docker Compose.

### How do I correlate traces with database records?

Extract the trace ID from the current span context using
`span.context().span().span_context().trace_id()` and store it in a `trace_id`
column in your database table. This lets you query Scout for the exact trace
that produced a specific database record.

### How do I export OpenTelemetry data over HTTP instead of gRPC in Rust?

Yes. Replace `with_tonic()` with `with_http()` in the exporter builders and
point to port 4318 instead of 4317. gRPC is recommended for production because
it supports streaming and has lower overhead for high-volume telemetry.

## What's Next?

### Advanced Topics

- [LLM Observability (Python)](../llm-observability) - Python equivalent with
  auto-instrumentation patterns
- [Axum Instrumentation](../../instrument/apps/auto-instrumentation/axum.md) —
  General Axum APM without AI-specific patterns
- [Rust Custom Instrumentation](../../instrument/apps/custom-instrumentation/rust.md)
  - Manual OpenTelemetry SDK usage for Rust

### Scout Platform Features

- [Creating Alerts](../creating-alerts-with-logx.md) - Set up alerts for LLM
  error rates and cost thresholds
- [Dashboards and Alerts](../../operate/dashboards-and-alerts.md) - Build
  dashboards for LLM metrics in Scout

### Deployment and Operations

- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  - Collector deployment guide
- [Kubernetes Helm Setup](../../instrument/collector-setup/kubernetes-helm-setup.md)
  - Production Kubernetes deployment

## Complete Example

The full working implementation is available in the examples repository:

**[rust/ai-report-generator](https://github.com/base-14/examples/tree/main/rust/ai-report-generator)**

This example implements:

- Axum REST API with 5 endpoints
- PostgreSQL with SQLx for data storage
- Multi-provider LLM support (OpenAI, Anthropic, Google, Ollama) with automatic
  fallback
- 4-stage pipeline (retrieve → analyze → generate → format)
- Full GenAI semantic convention spans and metrics
- Three-pillar telemetry (traces, metrics, logs) via OTLP
- Docker Compose deployment with collector
- Trace ID correlation in database records
- Token usage tracking and cost calculation

### Quick Start

```bash showLineNumbers title="Terminal"
cd rust/ai-report-generator

# Set your API key
export OPENAI_API_KEY=sk-...

# Start all services
docker compose up -d

# Generate a report
curl -X POST http://localhost:8080/api/reports \
  -H "Content-Type: application/json" \
  -d '{
    "indicators": ["GDP", "UNRATE", "CPIAUCSL"],
    "start_date": "2020-01-01",
    "end_date": "2023-12-01"
  }'
```

### Project Structure

```text showLineNumbers title="Project layout"
src/
├── main.rs                  # Server, router, HTTP spans
├── config.rs                # Environment configuration
├── telemetry/
│   ├── init.rs              # OTEL SDK initialization
│   └── metrics.rs           # GenAI + HTTP + domain metrics
├── llm/
│   ├── mod.rs               # Provider trait, request/response
│   ├── client.rs            # Retry, fallback, GenAI spans
│   ├── openai.rs            # OpenAI/Google/Ollama provider
│   ├── anthropic.rs         # Anthropic provider
│   └── pricing.rs           # Cost calculation
├── pipeline/
│   ├── orchestrator.rs      # Pipeline coordinator
│   ├── retrieve.rs          # Stage 1: DB queries
│   ├── analyze.rs           # Stage 2: LLM analysis
│   ├── generate.rs          # Stage 3: LLM narrative
│   └── format.rs            # Stage 4: Report assembly
├── db/                      # Database queries
├── routes/                  # HTTP handlers
└── error.rs                 # Error types
```

## References

- [OpenTelemetry Rust SDK](https://opentelemetry.io/docs/languages/rust/)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [tracing-opentelemetry crate](https://docs.rs/tracing-opentelemetry/)
- [async-openai crate](https://docs.rs/async-openai/)

## Related Guides

- [LLM Observability (Python)](../llm-observability) - Python equivalent of this
  guide with auto-instrumentation patterns
- [Axum Instrumentation](../../instrument/apps/auto-instrumentation/axum.md) —
  General Axum APM setup
- [Rust Custom Instrumentation](../../instrument/apps/custom-instrumentation/rust.md)
  - Manual OpenTelemetry SDK for Rust
- [Vercel AI SDK](../../instrument/apps/auto-instrumentation/vercel-ai-sdk.md) —
  TypeScript AI pipeline monitoring
- [LangGraph](../../instrument/apps/auto-instrumentation/langgraph.md) - Python
  agent orchestration monitoring
- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  - Collector deployment
