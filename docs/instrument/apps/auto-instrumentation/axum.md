---
title:
  Axum OpenTelemetry Instrumentation - Complete APM Setup Guide | base14
  Scout
sidebar_label: Axum
sidebar_position: 22
description:
  Complete guide to Rust Axum OpenTelemetry instrumentation for application
  performance monitoring. Set up tracing, metrics, and logs for traces,
  distributed tracing, and production deployments with base14 Scout in minutes.
keywords:
  [
    rust opentelemetry instrumentation,
    rust axum monitoring,
    rust apm,
    axum distributed tracing,
    rust application performance monitoring,
    opentelemetry rust,
    axum observability,
    rust tracing,
    sqlx query monitoring,
    rust metrics,
    tokio tracing,
    rust production monitoring,
    axum telemetry,
    rust tower middleware,
    tracing-opentelemetry,
    rust otlp exporter,
    axum instrumentation guide,
    rust observability stack,
  ]
---

# Axum

Implement OpenTelemetry instrumentation for Rust Axum applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to instrument your Axum application to
collect traces, metrics, and logs from HTTP requests, database queries,
background jobs, and custom business logic using the OpenTelemetry Rust SDK.

Rust applications built with Axum benefit from the powerful `tracing` ecosystem
combined with OpenTelemetry exporters. With the `tracing-opentelemetry` crate,
you can automatically capture spans from your application, monitor SQLx database
queries, trace distributed transactions across microservices, and identify
performance bottlenecks with minimal runtime overhead.

Whether you're implementing observability for the first time, migrating from
other monitoring solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations and best practices for Rust
Axum OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Axum-focused overview based on the
> official OpenTelemetry documentation. For complete Rust language information,
> please consult the
> [official OpenTelemetry Rust documentation](https://opentelemetry.io/docs/languages/rust/).

## Who This Guide Is For

This documentation is designed for:

- **Rust developers:** implementing observability and distributed tracing for
  Axum web applications
- **DevOps engineers:** deploying Rust applications with production monitoring
  requirements
- **Engineering teams:** migrating from other APM solutions to OpenTelemetry
- **Developers:** debugging performance issues, slow database queries, or async
  runtime problems
- **Platform teams:** standardizing observability across multiple Rust services

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK for Axum applications
- Set up tracing with `tracing-opentelemetry` for automatic span collection
- Configure OTLP export for traces, metrics, and logs to Scout Collector
- Implement custom instrumentation for business-critical operations
- Monitor SQLx database queries and connection pools
- Deploy instrumented Axum applications to development, staging, and production
  environments
- Troubleshoot common instrumentation issues and optimize performance
- Secure sensitive data in telemetry exports

## Prerequisites

Before starting, ensure you have:

- **Rust 1.80 or later** (stable toolchain recommended)
  - For best performance and compatibility, Rust 1.92+ is recommended
  - Edition 2021 or 2024 required
- **Axum 0.7 or later** web framework
  - Axum 0.8.8+ is recommended for optimal OpenTelemetry support
- **Cargo** for dependency management
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - Production deployments should use a dedicated Scout Collector instance
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component             | Minimum Version | Recommended Version |
| --------------------- | --------------- | ------------------- |
| Rust                  | 1.80.0          | 1.92.0+             |
| Axum                  | 0.7.0           | 0.8.8+              |
| OpenTelemetry         | 0.27.0          | 0.31.0+             |
| tracing-opentelemetry | 0.28.0          | 0.32.0+             |
| SQLx                  | 0.7.0           | 0.8.6+              |

## Required Packages

Add the following dependencies to your `Cargo.toml`:

```toml showLineNumbers title="Cargo.toml"
[dependencies]
# Web Framework
axum = { version = "0.8.8", features = ["macros"] }
tower = { version = "0.5.2", features = ["full"] }
tower-http = { version = "0.6.8", features = ["trace", "cors", "timeout", "request-id"] }

# Async Runtime
tokio = { version = "1.49", features = ["full", "tracing"] }

# Database (optional)
sqlx = { version = "0.8.6", features = ["runtime-tokio", "postgres", "macros"] }

# OpenTelemetry
opentelemetry = "0.31"
opentelemetry_sdk = { version = "0.31", features = ["rt-tokio", "logs"] }
opentelemetry-otlp = { version = "0.31", features = ["grpc-tonic", "trace", "logs"] }
opentelemetry-appender-tracing = "0.31"

# Tracing
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-opentelemetry = "0.32"

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Configuration

OpenTelemetry Rust instrumentation can be configured using multiple approaches
depending on your deployment requirements and preferences. Choose the method
that best fits your application architecture.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="module" label="Telemetry Module (Recommended)" default>
```

The recommended approach is to create a dedicated telemetry module. This
provides the most flexibility and keeps configuration separate from your
application bootstrap.

```rust showLineNumbers title="src/telemetry/init.rs"
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{Resource, logs::SdkLoggerProvider, trace::SdkTracerProvider};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

pub struct TelemetryGuard {
    pub tracer_provider: SdkTracerProvider,
    pub logger_provider: SdkLoggerProvider,
}

impl TelemetryGuard {
    pub fn shutdown(&self) {
        if let Err(e) = self.tracer_provider.shutdown() {
            eprintln!("Error shutting down tracer provider: {e}");
        }
        if let Err(e) = self.logger_provider.shutdown() {
            eprintln!("Error shutting down logger provider: {e}");
        }
    }
}

pub fn init_telemetry(service_name: &str, otlp_endpoint: &str) -> anyhow::Result<TelemetryGuard> {
    let resource = Resource::builder()
        .with_service_name(service_name.to_string())
        .with_attribute(KeyValue::new("service.version", "1.0.0"))
        .with_attribute(KeyValue::new("service.namespace", "production"))
        .with_attribute(KeyValue::new("deployment.environment", "production"))
        .build();

    // Configure trace exporter
    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(trace_exporter)
        .with_resource(resource.clone())
        .build();

    global::set_tracer_provider(tracer_provider.clone());

    // Configure log exporter
    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    // Bridge tracing logs to OpenTelemetry
    let otel_log_layer = OpenTelemetryTracingBridge::new(&logger_provider);

    // Create OpenTelemetry tracing layer
    let tracer = global::tracer(service_name.to_string());
    let telemetry_layer = OpenTelemetryLayer::new(tracer);

    // Configure environment filter
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=debug"));

    // Initialize subscriber
    tracing_subscriber::registry()
        .with(env_filter)
        .with(telemetry_layer)
        .with(otel_log_layer)
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        service = %service_name,
        endpoint = %otlp_endpoint,
        "Telemetry initialized with OTLP trace and log export"
    );

    Ok(TelemetryGuard {
        tracer_provider,
        logger_provider,
    })
}
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

For containerized deployments or environments where configuration is managed
externally, you can rely on environment variables:

```rust showLineNumbers title="src/telemetry/init.rs"
use std::env;

pub fn init_telemetry_from_env() -> anyhow::Result<TelemetryGuard> {
    let service_name = env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "rust-axum-app".to_string());
    let otlp_endpoint = env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());

    init_telemetry(&service_name, &otlp_endpoint)
}
```

With this configuration, use environment variables to control behavior:

```bash showLineNumbers
export OTEL_SERVICE_NAME=rust-axum-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
export RUST_LOG=info,sqlx=warn,tower_http=debug
```

```mdx-code-block
</TabItem>
<TabItem value="config-struct" label="Configuration Struct">
```

For applications using a configuration struct pattern:

```rust showLineNumbers title="src/config.rs"
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default = "default_service_name")]
    pub otel_service_name: String,
    #[serde(default = "default_otel_endpoint")]
    pub otel_exporter_endpoint: String,
    pub database_url: String,
}

fn default_port() -> u16 { 8080 }
fn default_environment() -> String { "development".to_string() }
fn default_service_name() -> String { "rust-axum-app".to_string() }
fn default_otel_endpoint() -> String { "http://localhost:4317".to_string() }

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();
        envy::from_env().expect("Failed to load config from environment")
    }

    pub fn is_production(&self) -> bool {
        self.environment == "production"
    }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Configuring Tower HTTP Tracing Layer

Add the Tower HTTP tracing layer to your Axum router for automatic HTTP request
instrumentation:

```rust showLineNumbers title="src/main.rs"
use std::time::Duration;

use axum::http::{Request, Response};
use tower_http::trace::{MakeSpan, OnResponse, TraceLayer};
use tracing::Span;

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
            http.response.status_code = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        )
    }
}

#[derive(Clone)]
struct HttpOnResponse;

impl<B> OnResponse<B> for HttpOnResponse {
    fn on_response(self, response: &Response<B>, latency: Duration, span: &Span) {
        let status = response.status().as_u16();
        span.record("http.response.status_code", status as i64);

        if status >= 500 {
            span.record("otel.status_code", "ERROR");
        } else {
            span.record("otel.status_code", "OK");
        }

        tracing::info!(
            http.response.status_code = status,
            latency_ms = latency.as_secs_f64() * 1000.0,
            "finished processing request"
        );
    }
}
```

### Scout Collector Integration

When using Scout Collector, configure your Axum application to send telemetry
data to the Scout Collector endpoint:

```rust showLineNumbers title="src/telemetry/init.rs"
pub fn init_telemetry_with_scout(
    service_name: &str,
    scout_endpoint: &str,
    scout_api_key: Option<&str>,
) -> anyhow::Result<TelemetryGuard> {
    let mut headers = tonic::metadata::MetadataMap::new();
    if let Some(api_key) = scout_api_key {
        headers.insert("x-scout-api-key", api_key.parse()?);
    }

    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(scout_endpoint)
        .with_metadata(headers.clone())
        .with_timeout(Duration::from_secs(10))
        .build()?;

    // ... rest of configuration
}
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions across
> your Rust services.

## Production Configuration

Production deployments require additional configuration for optimal performance,
reliability, and resource utilization. This section covers production-specific
settings and best practices.

### Batch Span Processor (Default for Production)

The `BatchSpanProcessor` is used by default when calling `with_batch_exporter`:

```rust showLineNumbers title="src/telemetry/init.rs"
use opentelemetry_sdk::trace::{BatchConfigBuilder, SdkTracerProvider};

pub fn init_production_telemetry(
    service_name: &str,
    otlp_endpoint: &str,
) -> anyhow::Result<TelemetryGuard> {
    let resource = Resource::builder()
        .with_service_name(service_name.to_string())
        .with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")))
        .with_attribute(KeyValue::new("deployment.environment", "production"))
        .build();

    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint)
        .with_timeout(Duration::from_secs(30))
        .build()?;

    // Configure batch processor for production
    let batch_config = BatchConfigBuilder::default()
        .with_max_queue_size(2048)
        .with_scheduled_delay(Duration::from_secs(5))
        .with_max_export_batch_size(512)
        .build();

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(trace_exporter)
        .with_resource(resource)
        .build();

    global::set_tracer_provider(tracer_provider.clone());

    // ... rest of configuration
}
```

**Benefits of BatchSpanProcessor:**

- Reduces network requests by batching span exports
- Lower CPU overhead compared to immediate export
- Prevents network saturation during traffic spikes
- Configurable batching for optimal throughput

### Resource Attributes

Add rich context to all telemetry data with resource attributes:

```rust showLineNumbers title="src/telemetry/init.rs"
use std::net::IpAddr;

fn build_resource(service_name: &str, environment: &str) -> Resource {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    Resource::builder()
        .with_service_name(service_name.to_string())
        .with_attribute(KeyValue::new("service.version", env!("CARGO_PKG_VERSION")))
        .with_attribute(KeyValue::new("service.namespace", "production"))
        .with_attribute(KeyValue::new("deployment.environment", environment.to_string()))
        .with_attribute(KeyValue::new("host.name", hostname))
        .with_attribute(KeyValue::new(
            "process.runtime.name",
            "rustc".to_string()
        ))
        .with_attribute(KeyValue::new(
            "process.runtime.version",
            env!("CARGO_PKG_RUST_VERSION")
        ))
        .build()
}
```

### Environment-Based Configuration

Use environment variables to manage configuration across deployments:

```rust showLineNumbers title="src/telemetry/init.rs"
pub fn init_telemetry(config: &Config) -> anyhow::Result<TelemetryGuard> {
    let resource = build_resource(&config.otel_service_name, &config.environment);

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

    // Configure format layer based on environment
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=debug"));

    let fmt_layer = if config.is_production() {
        tracing_subscriber::fmt::layer().json().boxed()
    } else {
        tracing_subscriber::fmt::layer().pretty().boxed()
    };

    // ... rest of configuration
}
```

### Production Environment Variables

Create a production environment configuration:

```bash showLineNumbers title=".env.production"
# Service Configuration
OTEL_SERVICE_NAME=rust-axum-app
RUST_LOG=info,sqlx=warn,tower_http=info

# Scout Collector Endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4317
SCOUT_API_KEY=your-scout-api-key

# Application Settings
PORT=8080
ENVIRONMENT=production
DATABASE_URL=postgres://user:pass@db:5432/production
```

### Docker Production Configuration

For containerized Axum applications, configure OpenTelemetry in your Docker
setup:

```dockerfile showLineNumbers title="Dockerfile"
# Build stage
FROM rust:1.80-alpine AS builder

WORKDIR /app

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

# Copy dependency files first for caching
COPY Cargo.toml Cargo.lock ./

# Create dummy source to build dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs

# Build dependencies only
RUN cargo build --release 2>/dev/null || true

# Remove dummy source and copy actual source
RUN rm -rf src
COPY src ./src

# Build the actual application
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -g '' -u 1001 appuser

COPY --from=builder /app/target/release/api .

USER appuser

ENV OTEL_SERVICE_NAME=rust-axum-app
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317

EXPOSE 8080

CMD ["./api"]
```

```yaml showLineNumbers title="docker-compose.yml"
services:
  rust-app:
    build: .
    environment:
      OTEL_SERVICE_NAME: rust-axum-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4317
      DATABASE_URL: postgres://user:pass@postgres:5432/production
      RUST_LOG: info,sqlx=warn
    depends_on:
      - postgres
      - scout-collector
    ports:
      - "8080:8080"

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4317:4317"
      - "4318:4318"

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: password
```

## Metrics

In addition to traces, OpenTelemetry can collect metrics from your Axum
application to monitor resource utilization, request rates, error counts, and
custom business metrics.

### Defining Custom Metrics

Create a metrics module with static metric definitions:

```rust showLineNumbers title="src/telemetry/metrics.rs"
use std::sync::LazyLock;

use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter},
};

pub static METER: LazyLock<Meter> = LazyLock::new(|| global::meter("rust-axum-app"));

pub static HTTP_REQUESTS_TOTAL: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("http.requests.total")
        .with_description("Total number of HTTP requests")
        .with_unit("{request}")
        .build()
});

pub static HTTP_REQUEST_DURATION: LazyLock<Histogram<f64>> = LazyLock::new(|| {
    METER
        .f64_histogram("http.request.duration")
        .with_description("HTTP request duration in milliseconds")
        .with_unit("ms")
        .with_boundaries(vec![
            1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0,
        ])
        .build()
});

pub static ARTICLES_CREATED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("articles.created")
        .with_description("Total articles created")
        .build()
});

pub static USERS_REGISTERED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("users.registered")
        .with_description("Total users registered")
        .build()
});
```

### Recording HTTP Metrics

Record metrics in your Tower HTTP response handler:

```rust showLineNumbers title="src/main.rs"
use crate::telemetry::{HTTP_REQUESTS_TOTAL, HTTP_REQUEST_DURATION};
use opentelemetry::KeyValue;

impl<B> OnResponse<B> for HttpOnResponse {
    fn on_response(self, response: &Response<B>, latency: Duration, span: &Span) {
        let status = response.status().as_u16();
        let latency_ms = latency.as_secs_f64() * 1000.0;
        let status_class = format!("{}xx", status / 100);

        // Record metrics
        HTTP_REQUESTS_TOTAL.add(
            1,
            &[
                KeyValue::new("http.status_code", status.to_string()),
                KeyValue::new("http.status_class", status_class.clone()),
            ],
        );

        HTTP_REQUEST_DURATION.record(
            latency_ms,
            &[
                KeyValue::new("http.status_code", status.to_string()),
                KeyValue::new("http.status_class", status_class),
            ],
        );

        span.record("http.response.status_code", status as i64);
        if status >= 500 {
            span.record("otel.status_code", "ERROR");
        } else {
            span.record("otel.status_code", "OK");
        }
    }
}
```

### Custom Business Metrics

Track business-specific events and KPIs:

```rust showLineNumbers title="src/services/article.rs"
use crate::telemetry::{ARTICLES_CREATED, ARTICLES_DELETED};

impl ArticleService {
    pub async fn create(&self, author_id: i32, input: CreateArticleInput) -> AppResult<Article> {
        // ... create article logic

        // Record business metric
        ARTICLES_CREATED.add(1, &[]);

        tracing::info!(article_id = article.id, "Article created");

        Ok(article)
    }

    pub async fn delete(&self, slug: &str, user_id: i32) -> AppResult<()> {
        // ... delete article logic

        ARTICLES_DELETED.add(1, &[]);

        Ok(())
    }
}
```

## SQLx Database Monitoring

OpenTelemetry integrates with SQLx through the tracing ecosystem to provide
comprehensive database query monitoring.

### Automatic Query Tracing

SQLx automatically emits tracing spans when queries are executed. Ensure your
environment filter includes SQLx:

```rust showLineNumbers
let env_filter = EnvFilter::try_from_default_env()
    .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=debug"));
```

### Configuring SQLx Connection Pool

Configure your database pool with proper settings:

```rust showLineNumbers title="src/database/pool.rs"
use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(5)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(database_url)
        .await?;

    tracing::info!("Database connection pool created");

    Ok(pool)
}
```

### Instrumenting Repository Methods

Use the `#[instrument]` macro for automatic span creation:

```rust showLineNumbers title="src/repository/article.rs"
use tracing::instrument;

#[derive(Clone)]
pub struct ArticleRepository {
    pool: PgPool,
}

impl ArticleRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[instrument(name = "db.article.create", skip(self))]
    pub async fn create(
        &self,
        slug: &str,
        title: &str,
        description: &str,
        body: &str,
        author_id: i32,
    ) -> Result<Article, sqlx::Error> {
        sqlx::query_as!(
            Article,
            r#"
            INSERT INTO articles (slug, title, description, body, author_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, slug, title, description, body, author_id,
                      favorites_count, created_at, updated_at
            "#,
            slug,
            title,
            description,
            body,
            author_id
        )
        .fetch_one(&self.pool)
        .await
    }

    #[instrument(name = "db.article.find_by_slug", skip(self))]
    pub async fn find_by_slug(&self, slug: &str) -> Result<Option<Article>, sqlx::Error> {
        sqlx::query_as!(
            Article,
            "SELECT * FROM articles WHERE slug = $1",
            slug
        )
        .fetch_optional(&self.pool)
        .await
    }
}
```

**SQLx span attributes include:**

- `db.system` - Database type (postgresql)
- `db.name` - Database name
- `db.statement` - SQL query
- `db.operation` - Operation type (SELECT, INSERT, UPDATE, DELETE)

## Custom Manual Instrumentation

While automatic instrumentation covers most Axum components, you can add custom
instrumentation for business logic, external API calls, or performance-critical
code paths.

### Creating Custom Spans with the Instrument Macro

Use the `#[instrument]` macro from the `tracing` crate:

```rust showLineNumbers title="src/services/article.rs"
use tracing::instrument;

#[derive(Clone)]
pub struct ArticleService {
    article_repo: ArticleRepository,
    favorite_repo: FavoriteRepository,
    job_queue: JobQueue,
}

impl ArticleService {
    #[instrument(name = "article.create", skip(self, input), fields(author_id))]
    pub async fn create(
        &self,
        author_id: i32,
        input: CreateArticleInput,
    ) -> AppResult<ArticleResponse> {
        let slug = self.generate_slug(&input.title);

        let article = self
            .article_repo
            .create(&slug, &input.title, &input.description, &input.body, author_id)
            .await?;

        // Enqueue background job
        if let Err(e) = self.job_queue.enqueue_notification(article.id, &article.title).await {
            tracing::warn!(article_id = article.id, error = %e, "Failed to enqueue notification");
        }

        ARTICLES_CREATED.add(1, &[]);

        tracing::info!(article_id = article.id, slug = %slug, "Article created");

        Ok(ArticleResponse::from(article))
    }

    #[instrument(name = "article.delete", skip(self))]
    pub async fn delete(&self, slug: &str, user_id: i32) -> AppResult<()> {
        let article = self
            .article_repo
            .find_by_slug(slug)
            .await?
            .ok_or(AppError::NotFound("Article not found".to_string()))?;

        if article.author_id != user_id {
            return Err(AppError::Forbidden);
        }

        self.article_repo.delete(article.id).await?;

        ARTICLES_DELETED.add(1, &[]);

        tracing::info!(article_id = article.id, "Article deleted");

        Ok(())
    }
}
```

### Adding Attributes to Current Spans

Enrich existing spans with additional context:

```rust showLineNumbers title="src/middleware/auth.rs"
use tracing::Span;

pub async fn auth_middleware<B>(
    State(state): State<AppState>,
    mut request: Request<B>,
    next: Next<B>,
) -> Result<Response, StatusCode> {
    let token = extract_token(&request)?;

    let claims = state.auth_service.validate_token(&token)?;

    // Add user context to current span
    Span::current().record("user.id", claims.user_id);
    Span::current().record("user.role", &claims.role);

    request.extensions_mut().insert(claims);

    Ok(next.run(request).await)
}
```

### Exception Handling and Error Tracking

Capture errors in custom spans:

```rust showLineNumbers title="src/services/external_api.rs"
use tracing::{instrument, Span};

pub struct ExternalApiClient {
    client: reqwest::Client,
    base_url: String,
}

impl ExternalApiClient {
    #[instrument(name = "external_api.fetch", skip(self))]
    pub async fn fetch_data(&self, endpoint: &str) -> Result<serde_json::Value, AppError> {
        let url = format!("{}/{}", self.base_url, endpoint);

        let response = self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| {
                Span::current().record("otel.status_code", "ERROR");
                tracing::error!(error = %e, "External API request failed");
                AppError::ExternalService(e.to_string())
            })?;

        let status = response.status();
        Span::current().record("http.response.status_code", status.as_u16() as i64);

        if !status.is_success() {
            Span::current().record("otel.status_code", "ERROR");
            return Err(AppError::ExternalService(format!("HTTP {}", status)));
        }

        response.json().await.map_err(|e| {
            tracing::error!(error = %e, "Failed to parse response");
            AppError::ExternalService(e.to_string())
        })
    }
}
```

### Using Semantic Conventions

Follow OpenTelemetry semantic conventions for consistent attribute naming:

```rust showLineNumbers
// HTTP semantic conventions
tracing::info_span!(
    "http.request",
    http.method = %method,
    http.url = %url,
    http.status_code = tracing::field::Empty,
    http.request.header.content_type = "application/json"
);

// Database semantic conventions
tracing::info_span!(
    "db.query",
    db.system = "postgresql",
    db.name = "production",
    db.operation = "SELECT",
    db.statement = "SELECT * FROM users WHERE id = $1"
);

// Messaging semantic conventions
tracing::info_span!(
    "messaging.process",
    messaging.system = "redis",
    messaging.destination = "jobs_queue",
    messaging.operation = "process"
);
```

## Running Your Instrumented Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

For local development, use console output to verify instrumentation:

```rust showLineNumbers title="src/telemetry/init.rs"
pub fn init_development_telemetry() -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("debug,sqlx=info,tower_http=debug"));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer().pretty())
        .init();

    Ok(())
}
```

Start your Axum server:

```bash
RUST_LOG=debug cargo run
```

You'll see span output in the console for each request:

```text
  2024-01-15T10:30:45.123Z DEBUG HTTP request{otel.name="GET /api/articles" http.method="GET"}
    at src/main.rs:52
  2024-01-15T10:30:45.125Z DEBUG db.article.list
    at src/repository/article.rs:45
  2024-01-15T10:30:45.130Z  INFO finished processing request http.response.status_code=200 latency_ms=7.2
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

For production deployments, ensure the Scout Collector endpoint is properly
configured:

```bash showLineNumbers
# Set environment variables
export OTEL_SERVICE_NAME=rust-axum-app-production
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4317
export RUST_LOG=info,sqlx=warn
export ENVIRONMENT=production

# Run the application
./target/release/api
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

Run your instrumented Axum application in Docker:

```bash showLineNumbers
# Build the image
docker build -t rust-axum-app:latest .

# Run with Scout Collector
docker run -d \
  --name rust-axum-app \
  -e OTEL_SERVICE_NAME=rust-axum-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317 \
  -e DATABASE_URL=postgres://user:pass@db:5432/production \
  -p 8080:8080 \
  rust-axum-app:latest
```

Or use Docker Compose (see [Production Configuration](#production-configuration)
section for complete example).

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verifying OpenTelemetry Installation

Test your OpenTelemetry configuration by creating a test span:

```rust showLineNumbers title="src/main.rs"
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env();
    let telemetry_guard = init_telemetry(&config)?;

    // Test span
    tracing::info_span!("startup_check").in_scope(|| {
        tracing::info!("OpenTelemetry is working!");
    });

    // ... rest of application startup

    // Ensure clean shutdown
    telemetry_guard.shutdown();

    Ok(())
}
```

### Health Check Endpoint

Create a health check endpoint to verify telemetry export:

```rust showLineNumbers title="src/handlers/health.rs"
use axum::{Json, extract::State};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    service: String,
    version: String,
}

#[tracing::instrument(name = "health.check", skip(state))]
pub async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    // Verify database connectivity
    let db_status = sqlx::query("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .is_ok();

    tracing::info!(db_healthy = db_status, "Health check performed");

    Json(HealthResponse {
        status: if db_status { "ok" } else { "degraded" }.to_string(),
        service: std::env::var("OTEL_SERVICE_NAME").unwrap_or_default(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
```

### Debug Mode

Enable debug logging to troubleshoot instrumentation issues:

```bash
export RUST_LOG=debug,opentelemetry=debug,tracing_opentelemetry=debug
cargo run
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash
   curl -v http://scout-collector:4317/v1/traces
   ```

2. Check environment variables:

   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_SERVICE_NAME
   ```

3. Enable debug logging and check for export errors

4. Verify network connectivity between your app and Scout Collector

#### Issue: Missing database query spans

**Solutions:**

1. Ensure SQLx logging level is set to at least `warn`:

   ```rust
   EnvFilter::new("info,sqlx=warn")
   ```

2. Verify you're using async SQLx methods that emit tracing spans

3. Check that `tracing-opentelemetry` layer is properly configured

#### Issue: High memory usage

**Solutions:**

1. Reduce `max_queue_size` in batch processor configuration
2. Ensure spans are being exported successfully
3. Check for span attribute size limits

#### Issue: Performance degradation

**Solutions:**

1. Use batch processor instead of simple processor
2. Reduce logging verbosity in production
3. Skip health check endpoints from tracing

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```rust showLineNumbers
// Bad - exposes sensitive data
tracing::info!(
    user.password = %password,          // Never include passwords!
    credit_card = %card_number,         // Never include payment data!
    user.ssn = %social_security         // Never include PII!
);

// Good - uses safe identifiers
tracing::info!(
    user.id = user_id,
    user.role = %role,
    payment.provider = "stripe",
    payment.status = "completed"
);
```

### Sanitizing SQL Statements

Configure SQLx to avoid logging sensitive query parameters:

```rust showLineNumbers
// Use parameterized queries - values are not logged
let user = sqlx::query_as!(
    User,
    "SELECT * FROM users WHERE email = $1 AND password_hash = $2",
    email,
    password_hash
)
.fetch_optional(&pool)
.await?;
```

### Filtering Sensitive HTTP Headers

Skip sensitive headers in your tracing configuration:

```rust showLineNumbers
impl<B> MakeSpan<B> for HttpMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        // Don't include Authorization header in spans
        tracing::info_span!(
            "HTTP request",
            http.method = %request.method(),
            http.route = %request.uri().path(),
            // Omit: http.request.header.authorization
        )
    }
}
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard
- Use parameterized queries to avoid logging sensitive values
- Audit span attributes regularly for sensitive data leaks

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead to Rust Axum applications:

- **Average latency increase**: < 1ms per request
- **CPU overhead**: Less than 1% in production with batch processor
- **Memory overhead**: ~20-50MB depending on queue size and traffic

**Impact varies based on:**

- Number of spans generated per request
- Span processor type (Batch vs Simple)
- Application request volume
- Complexity of traced operations

### Optimization Best Practices

#### 1. Use Batch Processor in Production

```rust showLineNumbers
// Good - batches exports, low overhead
let tracer_provider = SdkTracerProvider::builder()
    .with_batch_exporter(trace_exporter)
    .build();

// Avoid in production - exports every span immediately
let tracer_provider = SdkTracerProvider::builder()
    .with_simple_exporter(trace_exporter)
    .build();
```

#### 2. Skip Non-Critical Endpoints

```rust showLineNumbers
impl<B> MakeSpan<B> for HttpMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let path = request.uri().path();

        // Skip tracing for health checks
        if path == "/health" || path == "/metrics" {
            return tracing::Span::none();
        }

        // ... normal span creation
    }
}
```

#### 3. Use Appropriate Log Levels

```rust showLineNumbers
// Production: minimal logging
let env_filter = EnvFilter::new("info,sqlx=warn,tower_http=info");

// Development: verbose logging
let env_filter = EnvFilter::new("debug,sqlx=debug,tower_http=debug");
```

#### 4. Limit Attribute Values

```rust showLineNumbers
// Truncate long values
let truncated_body = if body.len() > 1000 {
    format!("{}...", &body[..1000])
} else {
    body.to_string()
};

tracing::info!(request.body = %truncated_body);
```

## Frequently Asked Questions

### Does OpenTelemetry impact Rust application performance?

OpenTelemetry adds approximately < 1ms of latency per request in typical Axum
applications. Rust's zero-cost abstractions and the efficient `tracing` crate
minimize overhead. With proper configuration (batch processor), the performance
impact is negligible for most production workloads.

### Which Rust versions are supported?

OpenTelemetry Rust supports Rust 1.80+ with edition 2021 or 2024. Rust 1.92+ is
recommended for optimal compatibility and performance. See the
[Prerequisites](#prerequisites) section for detailed version compatibility.

### Can I use OpenTelemetry with async Rust and Tokio?

Yes! OpenTelemetry Rust is designed for async applications. The `tracing` crate
handles async context propagation automatically, and `tracing-opentelemetry`
bridges tracing spans to OpenTelemetry. Use `opentelemetry_sdk` with the
`rt-tokio` feature for Tokio runtime support.

### How do I trace async tasks spawned with tokio::spawn?

Use `tracing::Instrument` to propagate context to spawned tasks:

```rust
use tracing::Instrument;

let span = tracing::info_span!("background_task");
tokio::spawn(async move {
    // Work here is traced under the span
}.instrument(span));
```

### Can I use OpenTelemetry alongside other observability tools?

Yes, OpenTelemetry can run alongside tools like Prometheus or Jaeger during
migration periods. The `tracing` ecosystem allows multiple subscribers.
However, running multiple exporters simultaneously will increase overhead.

### How do I handle multi-tenant applications?

Add tenant context to spans using tracing fields:

```rust
tracing::info_span!(
    "request",
    tenant.id = %tenant_id,
    tenant.name = %tenant_name
).in_scope(|| {
    // Request handling
});
```

### What's the difference between tracing and OpenTelemetry?

`tracing` is Rust's native instrumentation library for structured logging and
spans. `tracing-opentelemetry` bridges tracing spans to OpenTelemetry format
for export to APM backends. Use `tracing` for instrumentation and OpenTelemetry
for export.

### How do I monitor SQLx connection pool health?

SQLx emits tracing spans for connection pool operations. Monitor these spans
for connection acquisition times and pool exhaustion:

```rust
// This query automatically emits tracing spans
let result = sqlx::query("SELECT 1").fetch_one(&pool).await?;
```

### Can I customize which operations are instrumented?

Yes! Use the `#[instrument]` macro selectively and configure the `EnvFilter`
to control which modules emit spans. You can also use `Span::none()` to skip
tracing entirely for specific operations.

## What's Next?

Now that your Axum application is instrumented with OpenTelemetry, explore these
resources to maximize your observability:

### Advanced Topics

- **[PostgreSQL Monitoring Best Practices](../../component/postgres.md)** -
  Optimize database observability with connection pooling metrics and query
  performance analysis

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  intelligent alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** -
  Build custom dashboards combining traces, metrics, and business KPIs

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Set up Scout Collector for local development and testing

## Complete Example

Here's a complete working example of an Axum application with OpenTelemetry
instrumentation:

### Cargo.toml

```toml showLineNumbers title="Cargo.toml"
[package]
name = "rust-axum-otel"
version = "1.0.0"
edition = "2024"
rust-version = "1.92"

[dependencies]
axum = { version = "0.8.8", features = ["macros"] }
tower = { version = "0.5.2", features = ["full"] }
tower-http = { version = "0.6.8", features = ["trace", "cors", "timeout"] }
tokio = { version = "1.49", features = ["full", "tracing"] }
sqlx = { version = "0.8.6", features = ["runtime-tokio", "postgres"] }

opentelemetry = "0.31"
opentelemetry_sdk = { version = "0.31", features = ["rt-tokio", "logs"] }
opentelemetry-otlp = { version = "0.31", features = ["grpc-tonic", "trace", "logs"] }
opentelemetry-appender-tracing = "0.31"

tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-opentelemetry = "0.32"

serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
anyhow = "1.0"
```

### Telemetry Module

```rust showLineNumbers title="src/telemetry.rs"
use std::time::Duration;

use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{Resource, logs::SdkLoggerProvider, trace::SdkTracerProvider};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

pub struct TelemetryGuard {
    tracer_provider: SdkTracerProvider,
    logger_provider: SdkLoggerProvider,
}

impl TelemetryGuard {
    pub fn shutdown(&self) {
        let _ = self.tracer_provider.shutdown();
        let _ = self.logger_provider.shutdown();
    }
}

pub fn init(service_name: &str, endpoint: &str) -> anyhow::Result<TelemetryGuard> {
    let resource = Resource::builder()
        .with_service_name(service_name.to_string())
        .with_attribute(KeyValue::new("service.version", "1.0.0"))
        .build();

    let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(trace_exporter)
        .with_resource(resource.clone())
        .build();

    global::set_tracer_provider(tracer_provider.clone());

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    let tracer = global::tracer(service_name.to_string());

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(OpenTelemetryLayer::new(tracer))
        .with(OpenTelemetryTracingBridge::new(&logger_provider))
        .with(tracing_subscriber::fmt::layer())
        .init();

    Ok(TelemetryGuard { tracer_provider, logger_provider })
}
```

### Main Application

```rust showLineNumbers title="src/main.rs"
use std::net::SocketAddr;

use axum::{Router, routing::get, Json};
use serde::Serialize;
use tokio::net::TcpListener;

mod telemetry;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
}

#[tracing::instrument(name = "health.check")]
async fn health_check() -> Json<HealthResponse> {
    tracing::info!("Health check requested");
    Json(HealthResponse { status: "ok".to_string() })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let service_name = std::env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "rust-axum-app".to_string());
    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());

    let guard = telemetry::init(&service_name, &endpoint)?;

    tracing::info!(service = %service_name, "Starting server");

    let app = Router::new().route("/health", get(health_check));

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(%addr, "Server listening");

    axum::serve(listener, app).await?;

    guard.shutdown();
    Ok(())
}
```

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=rust-axum-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
RUST_LOG=info,sqlx=warn
```

This complete example is available in our
[GitHub examples repository](https://github.com/base-14/examples/tree/main/rust).

## References

- [Official OpenTelemetry Rust Documentation](https://opentelemetry.io/docs/languages/rust/)
- [tracing-opentelemetry Crate](https://docs.rs/tracing-opentelemetry)
- [Axum Documentation](https://docs.rs/axum)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Go Instrumentation](./go.md) - Another systems programming language
  alternative
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
