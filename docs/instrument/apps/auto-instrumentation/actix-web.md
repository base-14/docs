---
title:
  Actix Web OpenTelemetry Instrumentation - Complete APM Setup Guide | base14
  Scout
sidebar_label: Actix Web
sidebar_position: 21
description:
  Complete guide to Rust Actix Web OpenTelemetry instrumentation for application
  performance monitoring. Set up tracing, metrics, and logs for distributed
  tracing and production deployments with base14 Scout in minutes.
keywords:
  [
    rust opentelemetry instrumentation,
    rust actix web monitoring,
    rust apm,
    actix web distributed tracing,
    rust application performance monitoring,
    opentelemetry rust,
    actix web observability,
    rust tracing,
    sqlx query monitoring,
    rust metrics,
    tokio tracing,
    rust production monitoring,
    actix web telemetry,
    tracing-actix-web middleware,
    tracing-opentelemetry,
    rust otlp exporter,
    actix web instrumentation guide,
    rust observability stack,
  ]
---

# Actix Web

Implement OpenTelemetry instrumentation for Rust Actix Web applications to
enable comprehensive application performance monitoring (APM), distributed
tracing, and observability. This guide shows you how to instrument your Actix
Web application to collect traces, metrics, and logs from HTTP requests,
database queries, background jobs, and custom business logic using the
OpenTelemetry Rust SDK.

Rust applications built with Actix Web benefit from the powerful `tracing`
ecosystem combined with OpenTelemetry exporters. With the
`tracing-actix-web` crate, you can automatically capture spans from every
HTTP request, monitor SQLx database queries, trace distributed transactions
across microservices, and identify performance bottlenecks with minimal
runtime overhead. Actix Web's actor-based architecture and
`tracing-actix-web` middleware provide seamless integration with
OpenTelemetry's context propagation.

Whether you're implementing observability for the first time, migrating from
other monitoring solutions, or troubleshooting performance issues in
production, this guide provides production-ready configurations and best
practices for Rust Actix Web OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Actix Web-focused overview based
> on the official OpenTelemetry documentation. For complete Rust language
> information, please consult the
> [official OpenTelemetry Rust documentation](https://opentelemetry.io/docs/languages/rust/).

## Who This Guide Is For

This documentation is designed for:

- **Rust developers:** implementing observability and distributed tracing for
  Actix Web applications
- **DevOps engineers:** deploying Rust applications with production monitoring
  requirements
- **Engineering teams:** migrating from other APM solutions to OpenTelemetry
- **Developers:** debugging performance issues, slow database queries, or async
  runtime problems
- **Platform teams:** standardizing observability across multiple Rust services

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK for Actix Web applications
- Set up tracing with `tracing-actix-web` for automatic HTTP span collection
- Configure OTLP export for traces, metrics, and logs to Scout Collector
- Implement custom instrumentation for business-critical operations
- Monitor SQLx database queries and connection pools
- Instrument a PostgreSQL-backed job queue with W3C trace propagation
- Deploy instrumented Actix Web applications to production
- Troubleshoot common instrumentation issues and optimize performance
- Include trace IDs in API error responses

## Prerequisites

Before starting, ensure you have:

- **Rust 1.92 or later** (stable toolchain recommended)
  - Edition 2024 required
- **Actix Web 4.12 or later** web framework
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
| Actix Web             | 4.0.0           | 4.12+               |
| tracing-actix-web     | 0.7.0           | 0.7+                |
| OpenTelemetry         | 0.27.0          | 0.31.0+             |
| tracing-opentelemetry | 0.28.0          | 0.32.0+             |
| SQLx                  | 0.7.0           | 0.8.6+              |

## Required Packages

Add the following dependencies to your `Cargo.toml`:

```toml showLineNumbers title="Cargo.toml"
[package]
name = "actix-postgres"
version = "1.0.0"
edition = "2024"
rust-version = "1.92"

[[bin]]
name = "api"
path = "src/main.rs"

[[bin]]
name = "worker"
path = "src/bin/worker.rs"

[dependencies]
# Web Framework
actix-web = "4.12"
actix-rt = "2"
tracing-actix-web = "0.7"

# Async Runtime
tokio = { version = "1.49.0", features = ["full", "tracing"] }

# Database
sqlx = { version = "0.8.6", features = [
    "runtime-tokio", "tls-rustls", "postgres",
    "macros", "migrate", "uuid", "time", "json",
] }

# OpenTelemetry
opentelemetry = "0.31.0"
opentelemetry_sdk = { version = "0.31.0", features = ["rt-tokio", "logs"] }
opentelemetry-otlp = { version = "0.31.0", features = ["grpc-tonic", "trace", "logs"] }
opentelemetry-appender-tracing = "0.31.0"

# Tracing
tracing = "0.1.44"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-opentelemetry = "0.32.0"

# Authentication
jsonwebtoken = { version = "10.3.0", features = ["rust_crypto"] }
argon2 = "0.5.3"

# Serialization
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0"

# Utilities
uuid = { version = "1.19.0", features = ["v4", "serde"] }
time = { version = "0.3.47", features = ["serde", "formatting", "macros"] }
thiserror = "2.0.17"
anyhow = "1.0.100"
dotenvy = "0.15"
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
use opentelemetry::KeyValue;
use opentelemetry::global;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{Resource, logs::SdkLoggerProvider, trace::SdkTracerProvider};
use std::time::Duration;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;

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

pub fn init_telemetry(config: &Config) -> anyhow::Result<TelemetryGuard> {
    let resource = Resource::builder()
        .with_service_name(config.otel_service_name.clone())
        .with_attribute(KeyValue::new("service.version", "1.0.0"))
        .with_attribute(KeyValue::new("service.namespace", "examples"))
        .with_attribute(KeyValue::new(
            "deployment.environment",
            config.environment.clone(),
        ))
        .build();

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

    let log_exporter = opentelemetry_otlp::LogExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otel_exporter_endpoint)
        .with_timeout(Duration::from_secs(10))
        .build()?;

    let logger_provider = SdkLoggerProvider::builder()
        .with_batch_exporter(log_exporter)
        .with_resource(resource)
        .build();

    let otel_log_layer = OpenTelemetryTracingBridge::new(&logger_provider);
    let tracer = global::tracer(config.otel_service_name.clone());
    let telemetry_layer = OpenTelemetryLayer::new(tracer);

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));

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
    let config = Config::from_env();
    init_telemetry(&config)
}
```

With this configuration, use environment variables to control behavior:

```bash showLineNumbers
export OTEL_SERVICE_NAME=actix-postgres
export OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
export RUST_LOG=info,sqlx=warn
```

```mdx-code-block
</TabItem>
<TabItem value="config-struct" label="Configuration Struct">
```

For applications using a configuration struct pattern:

```rust showLineNumbers title="src/config.rs"
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub environment: String,
    pub database_url: String,
    pub jwt_secret: String,
    pub jwt_expires_in_hours: i64,
    pub otel_service_name: String,
    pub otel_exporter_endpoint: String,
}

impl Config {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        Self {
            port: env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .expect("PORT must be a number"),
            environment: env::var("ENVIRONMENT")
                .unwrap_or_else(|_| "development".to_string()),
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            jwt_secret: env::var("JWT_SECRET")
                .expect("JWT_SECRET must be set"),
            jwt_expires_in_hours: env::var("JWT_EXPIRES_IN_HOURS")
                .unwrap_or_else(|_| "168".to_string())
                .parse()
                .expect("JWT_EXPIRES_IN_HOURS must be a number"),
            otel_service_name: env::var("OTEL_SERVICE_NAME")
                .unwrap_or_else(|_| "actix-postgres".to_string()),
            otel_exporter_endpoint: env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
                .unwrap_or_else(|_| "http://localhost:4317".to_string()),
        }
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

### Configuring TracingLogger Middleware

Actix Web uses the `tracing-actix-web` crate for automatic HTTP request
instrumentation. Unlike Axum's Tower-based `TraceLayer`, Actix Web uses
`TracingLogger` as native middleware:

```rust showLineNumbers title="src/main.rs"
use actix_web::{App, HttpServer, web};
use tracing_actix_web::TracingLogger;

use config::Config;
use database::create_pool;
use jobs::JobQueue;
use repository::{ArticleRepository, FavoriteRepository, UserRepository};
use services::{ArticleService, AuthService};
use telemetry::init_telemetry;

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env();
    let telemetry_guard = init_telemetry(&config)?;

    tracing::info!(
        port = config.port,
        environment = %config.environment,
        "Starting server"
    );

    let pool = create_pool(&config).await?;

    let user_repo = UserRepository::new(pool.clone());
    let article_repo = ArticleRepository::new(pool.clone());
    let favorite_repo = FavoriteRepository::new(pool.clone());
    let job_queue = JobQueue::new(pool.clone());

    let auth_service = AuthService::new(user_repo, &config);
    let article_service = ArticleService::new(article_repo, favorite_repo, job_queue);

    let pool_data = web::Data::new(pool);
    let auth_data = web::Data::new(auth_service);
    let article_data = web::Data::new(article_service);

    let bind_addr = format!("0.0.0.0:{}", config.port);
    tracing::info!(addr = %bind_addr, "Server listening");

    HttpServer::new(move || {
        App::new()
            .wrap(TracingLogger::default())
            .wrap(actix_web::middleware::Compress::default())
            .app_data(pool_data.clone())
            .app_data(auth_data.clone())
            .app_data(article_data.clone())
            .configure(routes::configure)
    })
    .bind(&bind_addr)?
    .run()
    .await?;

    tracing::info!("Server shutdown complete");
    telemetry_guard.shutdown();

    Ok(())
}
```

`TracingLogger::default()` creates a span for every HTTP request with
method, path, status code, and duration — no custom `MakeSpan` or
`OnResponse` implementations needed.

### Shared State with `web::Data<T>`

Actix Web uses `web::Data<T>` (backed by `Arc`) for shared application state,
unlike Axum's `State` extractor:

```rust showLineNumbers title="src/main.rs"
let pool_data = web::Data::new(pool);
let auth_data = web::Data::new(auth_service);
let article_data = web::Data::new(article_service);

HttpServer::new(move || {
    App::new()
        .app_data(pool_data.clone())
        .app_data(auth_data.clone())
        .app_data(article_data.clone())
        .configure(routes::configure)
})
```

### Scout Collector Integration

When using Scout Collector, configure your Actix Web application to send
telemetry data to the Scout Collector endpoint:

```rust showLineNumbers title="src/telemetry/init.rs"
let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
    .with_tonic()
    .with_endpoint(&config.otel_exporter_endpoint)
    .with_timeout(Duration::from_secs(10))
    .build()?;
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions across
> your Rust services.

## Production Configuration

### Docker Production Configuration

For containerized Actix Web applications:

```dockerfile showLineNumbers title="Dockerfile"
# Build stage
FROM rust:1.92-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev openssl-dev pkgconfig

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs && \
    mkdir -p src/bin && \
    echo "fn main() {}" > src/bin/worker.rs && \
    echo "" > src/lib.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs src/lib.rs && \
    cargo build --release --bin api

# Runtime stage
FROM alpine:3.21
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata wget && \
    adduser -D -g '' -u 1001 appuser

COPY --from=builder /app/target/release/api .
COPY --from=builder /app/migrations ./migrations

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/api/health || exit 1

CMD ["./api"]
```

Actix Web applications with background workers require a separate Dockerfile
for the worker binary:

```dockerfile showLineNumbers title="Dockerfile.worker"
FROM rust:1.92-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev openssl-dev pkgconfig

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    mkdir -p src/bin && echo "fn main() {}" > src/bin/worker.rs && \
    echo "" > src/lib.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs src/lib.rs src/bin/worker.rs && \
    cargo build --release --bin worker

FROM alpine:3.21
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -g '' -u 1001 appuser

COPY --from=builder /app/target/release/worker .
COPY --from=builder /app/migrations ./migrations

USER appuser
CMD ["./worker"]
```

### Docker Compose Configuration

```yaml showLineNumbers title="compose.yml"
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      ENVIRONMENT: development
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/actix_postgres_app?sslmode=disable
      JWT_SECRET: your-super-secret-jwt-key-change-in-production
      OTEL_SERVICE_NAME: actix-postgres-api
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      RUST_LOG: info,sqlx=warn
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      ENVIRONMENT: development
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/actix_postgres_app?sslmode=disable
      JWT_SECRET: your-super-secret-jwt-key-change-in-production
      OTEL_SERVICE_NAME: actix-postgres-worker
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      RUST_LOG: info,sqlx=warn
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started

  postgres:
    image: postgres:18.2-alpine3.23
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: actix_postgres_app
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    command: ["--config=/etc/otel-config.yaml"]
    volumes:
      - ./config/otel-config.yaml:/etc/otel-config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    env_file:
      - path: .env
        required: false
    environment:
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-http://localhost:4318}
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-}
      - SCOUT_ENVIRONMENT=${SCOUT_ENVIRONMENT:-development}

volumes:
  postgres_data:
```

### OpenTelemetry Collector Configuration

```yaml showLineNumbers title="config/otel-config.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    limit_mib: 256
    check_interval: 1s
  batch:
    timeout: 10s
    send_batch_size: 1024
  filter/noisy:
    traces:
      span:
        - 'IsMatch(name, ".*/api/health")'

exporters:
  otlp_http/b14:
    endpoint: ${env:SCOUT_ENDPOINT}
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
    verbosity: basic

service:
  extensions: [oauth2client, health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/b14, debug]
```

### Production Environment Variables

```bash showLineNumbers title=".env.production"
OTEL_SERVICE_NAME=actix-postgres-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
RUST_LOG=info,sqlx=warn
ENVIRONMENT=production
DATABASE_URL=postgres://user:pass@db:5432/production
```

## Metrics

OpenTelemetry can collect custom metrics from your Actix Web application for
resource utilization, request rates, error counts, and business metrics.

### Defining Custom Metrics

Create a metrics module with static metric definitions using `LazyLock`:

```rust showLineNumbers title="src/telemetry/metrics.rs"
use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter},
};
use std::sync::LazyLock;

pub static METER: LazyLock<Meter> = LazyLock::new(|| global::meter("actix-postgres"));

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
            1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0,
            1000.0, 2500.0, 5000.0, 10000.0,
        ])
        .build()
});

pub static ARTICLES_CREATED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("articles.created")
        .with_description("Total articles created").build()
});

pub static ARTICLES_UPDATED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("articles.updated")
        .with_description("Total articles updated").build()
});

pub static ARTICLES_DELETED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("articles.deleted")
        .with_description("Total articles deleted").build()
});

pub static FAVORITES_ADDED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("favorites.added")
        .with_description("Total favorites added").build()
});

pub static FAVORITES_REMOVED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("favorites.removed")
        .with_description("Total favorites removed").build()
});

pub static USERS_REGISTERED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("users.registered")
        .with_description("Total users registered").build()
});

pub static JOBS_ENQUEUED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("jobs.enqueued")
        .with_description("Total jobs enqueued").build()
});

pub static JOBS_COMPLETED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("jobs.completed")
        .with_description("Total jobs completed successfully").build()
});

pub static JOBS_FAILED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER.u64_counter("jobs.failed")
        .with_description("Total jobs failed").build()
});
```

### Recording Business Metrics

Track business-specific events in service methods:

```rust showLineNumbers title="src/services/article.rs"
use crate::telemetry::{ARTICLES_CREATED, ARTICLES_DELETED, FAVORITES_ADDED};

ARTICLES_CREATED.add(1, &[]);
tracing::info!(article_id = article.id, slug = %article.slug, "Article created");
```

## SQLx Database Monitoring

OpenTelemetry integrates with SQLx through the tracing ecosystem to provide
comprehensive database query monitoring.

### Configuring SQLx Connection Pool

```rust showLineNumbers title="src/database/pool.rs"
use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn create_pool(config: &Config) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(5)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect(&config.database_url)
        .await?;

    tracing::info!("Database connection pool created");
    Ok(pool)
}
```

### Instrumenting Repository Methods

Use the `#[instrument]` macro for automatic span creation on repository
methods:

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
            slug, title, description, body, author_id
        )
        .fetch_one(&self.pool)
        .await
    }

    #[instrument(name = "db.article.find_by_slug", skip(self))]
    pub async fn find_by_slug(&self, slug: &str) -> Result<Option<Article>, sqlx::Error> {
        sqlx::query_as!(Article, "SELECT * FROM articles WHERE slug = $1", slug)
            .fetch_optional(&self.pool)
            .await
    }
}
```

## Custom Manual Instrumentation

### Creating Custom Spans with the Instrument Macro

Use the `#[instrument]` macro from the `tracing` crate on service methods:

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
        let final_slug = if self.article_repo.exists_by_slug(&slug).await? {
            format!("{}-{}", slug, time::OffsetDateTime::now_utc().unix_timestamp())
        } else {
            slug
        };

        let article = self.article_repo
            .create(&final_slug, &input.title,
                    input.description.as_deref().unwrap_or(""),
                    &input.body, author_id)
            .await?;

        if let Err(e) = self.job_queue
            .enqueue_notification(article.id, &article.title).await
        {
            tracing::warn!(article_id = article.id, error = %e,
                          "Failed to enqueue notification");
        }

        ARTICLES_CREATED.add(1, &[]);
        tracing::info!(article_id = article.id, slug = %article.slug,
                       "Article created");

        Ok(ArticleResponse { article: ArticleDto::from(article) })
    }

    #[instrument(name = "article.delete", skip(self))]
    pub async fn delete(&self, slug: &str, user_id: i32) -> AppResult<()> {
        let article = self.article_repo.find_by_slug(slug).await?
            .ok_or(AppError::NotFound("Article not found".to_string()))?;

        if article.author_id != user_id {
            return Err(AppError::Forbidden);
        }

        self.article_repo.delete(article.id).await?;
        ARTICLES_DELETED.add(1, &[]);
        tracing::info!(article_id = article.id, "Article deleted");

        Ok(())
    }

    #[instrument(name = "article.favorite", skip(self))]
    pub async fn favorite(&self, slug: &str, user_id: i32) -> AppResult<ArticleResponse> {
        let article = self.article_repo.find_by_slug(slug).await?
            .ok_or(AppError::NotFound("Article not found".to_string()))?;

        let already_favorited = self.favorite_repo.exists(user_id, article.id).await?;
        if !already_favorited {
            self.favorite_repo.create(user_id, article.id).await?;
            self.article_repo.increment_favorites(article.id).await?;
            FAVORITES_ADDED.add(1, &[]);
            tracing::info!(article_id = article.id, user_id, "Article favorited");
        }

        let updated = self.article_repo.find_by_id(article.id).await?
            .ok_or(AppError::Internal("Failed to fetch article".to_string()))?;

        Ok(ArticleResponse { article: ArticleDto::from(updated) })
    }
}
```

### Error Handling with Trace IDs

Actix Web uses the `ResponseError` trait for error handling. Include trace IDs
in error responses so users can reference them in support requests:

```rust showLineNumbers title="src/error.rs"
use actix_web::{HttpResponse, http::StatusCode};
use opentelemetry::trace::TraceContextExt;
use serde_json::json;
use thiserror::Error;
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Authentication required")]
    Unauthorized,
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Forbidden")]
    Forbidden,
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("JWT error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("Internal error: {0}")]
    Internal(String),
}

fn get_trace_id() -> Option<String> {
    let span = Span::current();
    let context = span.context();
    let span_ref = context.span();
    let span_context = span_ref.span_context();

    if span_context.is_valid() {
        Some(span_context.trace_id().to_string())
    } else {
        None
    }
}

impl actix_web::ResponseError for AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            AppError::Unauthorized | AppError::InvalidCredentials
            | AppError::Jwt(_) => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::Database(_) | AppError::Internal(_) =>
                StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let status = self.status_code();
        let error_message = match self {
            AppError::Database(e) => {
                tracing::error!(error = %e, "Database error");
                "Internal server error".to_string()
            }
            AppError::Internal(msg) => {
                tracing::error!(error = %msg, "Internal error");
                "Internal server error".to_string()
            }
            _ => self.to_string(),
        };

        let body = if let Some(trace_id) = get_trace_id() {
            json!({
                "error": error_message,
                "status": status.as_u16(),
                "trace_id": trace_id,
            })
        } else {
            json!({
                "error": error_message,
                "status": status.as_u16(),
            })
        };

        HttpResponse::build(status).json(body)
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

### Authentication Middleware with FromRequest

Actix Web uses the `FromRequest` trait for extractors. This pattern differs
from Axum's middleware layers:

```rust showLineNumbers title="src/middleware/auth.rs"
use actix_web::{FromRequest, HttpRequest, dev::Payload, web};
use std::future::{Ready, ready};

use crate::{error::AppError, services::AuthService};

pub struct AuthUser(pub i32);

impl FromRequest for AuthUser {
    type Error = AppError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        let result = extract_and_validate(req, false);
        ready(result.map(|id| AuthUser(id.expect("token required"))))
    }
}

pub struct OptionalAuthUser(pub Option<i32>);

impl FromRequest for OptionalAuthUser {
    type Error = AppError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        let result = extract_and_validate(req, true);
        ready(result.map(OptionalAuthUser))
    }
}

fn extract_and_validate(req: &HttpRequest, optional: bool) -> Result<Option<i32>, AppError> {
    let auth_service = req
        .app_data::<web::Data<AuthService>>()
        .ok_or(AppError::Internal("AuthService not configured".to_string()))?;

    let token = req.headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    match token {
        Some(token) => match auth_service.validate_token(token) {
            Ok(user_id) => Ok(Some(user_id)),
            Err(_) if optional => Ok(None),
            Err(e) => Err(e),
        },
        None if optional => Ok(None),
        None => Err(AppError::Unauthorized),
    }
}
```

### Route Definitions

```rust showLineNumbers title="src/routes.rs"
use actix_web::web;
use crate::handlers;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/api/health", web::get().to(handlers::health_check))
        .route("/api/register", web::post().to(handlers::register))
        .route("/api/login", web::post().to(handlers::login))
        .route("/api/user", web::get().to(handlers::get_user))
        .route("/api/articles", web::get().to(handlers::list_articles))
        .route("/api/articles", web::post().to(handlers::create_article))
        .route("/api/articles/{slug}", web::get().to(handlers::get_article))
        .route("/api/articles/{slug}", web::put().to(handlers::update_article))
        .route("/api/articles/{slug}", web::delete().to(handlers::delete_article))
        .route("/api/articles/{slug}/favorite",
               web::post().to(handlers::favorite_article))
        .route("/api/articles/{slug}/favorite",
               web::delete().to(handlers::unfavorite_article));
}
```

## Job Queue with Trace Propagation

This application uses a PostgreSQL-native job queue with `FOR UPDATE SKIP
LOCKED` for concurrent-safe job processing, and W3C Trace Context propagation
to link producer and consumer spans.

### Enqueuing Jobs (Producer)

The job queue captures the current trace context and stores it as JSON in the
`trace_context` column:

```rust showLineNumbers title="src/jobs/queue.rs"
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use tracing::{Span, instrument};

use crate::telemetry::{JOBS_COMPLETED, JOBS_ENQUEUED, JOBS_FAILED};

#[derive(Clone)]
pub struct JobQueue {
    pool: PgPool,
}

impl JobQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[instrument(name = "job.enqueue", skip(self, payload))]
    pub async fn enqueue<T: Serialize>(
        &self, kind: &str, payload: T,
    ) -> Result<i64, sqlx::Error> {
        let trace_context = self.capture_trace_context();
        let payload_json = serde_json::to_value(&payload)
            .unwrap_or(serde_json::Value::Null);

        let row = sqlx::query(
            r#"
            INSERT INTO jobs (kind, payload, trace_context)
            VALUES ($1, $2, $3)
            RETURNING id
            "#,
        )
        .bind(kind)
        .bind(&payload_json)
        .bind(&trace_context)
        .fetch_one(&self.pool)
        .await?;

        let job_id: i64 = row.get("id");
        JOBS_ENQUEUED.add(1, &[]);
        tracing::info!(job_id, kind, "Job enqueued");
        Ok(job_id)
    }

    pub async fn dequeue(&self) -> Result<Option<Job>, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE jobs
            SET status = 'processing',
                started_at = NOW(),
                attempts = attempts + 1
            WHERE id = (
                SELECT id FROM jobs
                WHERE status = 'pending'
                  AND scheduled_at <= NOW()
                  AND attempts < max_attempts
                ORDER BY priority DESC, scheduled_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, kind, payload, status, attempts, trace_context
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.map(|row| Job {
            id: row.get("id"),
            kind: row.get("kind"),
            payload: row.get("payload"),
            status: row.get("status"),
            attempts: row.get("attempts"),
            trace_context: row.get("trace_context"),
        }))
    }

    fn capture_trace_context(&self) -> Option<serde_json::Value> {
        use opentelemetry::trace::TraceContextExt;
        use tracing_opentelemetry::OpenTelemetrySpanExt;

        let span = Span::current();
        let context = span.context();
        let otel_span = context.span();
        let span_context = otel_span.span_context();

        if span_context.is_valid() {
            let mut carrier = HashMap::new();
            carrier.insert(
                "traceparent".to_string(),
                format!(
                    "00-{}-{}-{:02x}",
                    span_context.trace_id(),
                    span_context.span_id(),
                    span_context.trace_flags().to_u8()
                ),
            );
            Some(serde_json::to_value(&carrier).unwrap_or(serde_json::Value::Null))
        } else {
            None
        }
    }
}
```

### Processing Jobs (Consumer)

The worker binary extracts the trace context from job data and restores the
parent span, linking the consumer trace to the original HTTP request:

```rust showLineNumbers title="src/bin/worker.rs"
use std::collections::HashMap;
use opentelemetry::propagation::TextMapPropagator;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

async fn process_job(job_queue: &JobQueue) -> anyhow::Result<()> {
    let Some(job) = job_queue.dequeue().await? else {
        return Ok(());
    };

    let parent_context = extract_trace_context(&job.trace_context);

    let span = tracing::info_span!(
        "job.process",
        job_id = job.id,
        job_kind = %job.kind,
    );
    let _ = span.set_parent(parent_context);

    async {
        tracing::info!(job_id = job.id, kind = %job.kind, "Processing job");

        let result = match job.kind.as_str() {
            "notification" => NotificationHandler::handle(&job).await,
            _ => {
                tracing::warn!(job_id = job.id, kind = %job.kind, "Unknown job kind");
                Err(anyhow::anyhow!("Unknown job kind: {}", job.kind))
            }
        };

        match result {
            Ok(()) => {
                job_queue.complete(job.id).await?;
                tracing::info!(job_id = job.id, "Job completed");
            }
            Err(e) => {
                job_queue.fail(job.id, &e.to_string()).await?;
                tracing::error!(job_id = job.id, error = %e, "Job failed");
            }
        }
        Ok(())
    }
    .instrument(span)
    .await
}

fn extract_trace_context(
    trace_context: &Option<serde_json::Value>,
) -> opentelemetry::Context {
    let Some(ctx_value) = trace_context else {
        return opentelemetry::Context::new();
    };

    let carrier: HashMap<String, String> = match serde_json::from_value(ctx_value.clone()) {
        Ok(c) => c,
        Err(_) => return opentelemetry::Context::new(),
    };

    let propagator = TraceContextPropagator::new();
    propagator.extract(&carrier)
}
```

## Running Your Instrumented Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

```bash showLineNumbers
RUST_LOG=debug cargo run --bin api

# In a separate terminal, start the worker
RUST_LOG=debug cargo run --bin worker
```

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

```bash showLineNumbers
export OTEL_SERVICE_NAME=actix-postgres-api
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4317
export RUST_LOG=info,sqlx=warn
export ENVIRONMENT=production

./target/release/api
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

```bash showLineNumbers
docker compose up --build

docker compose logs -f api worker

docker compose down
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Health Check Endpoint

```rust showLineNumbers title="src/handlers/health.rs"
use actix_web::{HttpResponse, web};
use serde_json::json;
use sqlx::{PgPool, Row};

pub async fn health_check(pool: web::Data<PgPool>) -> HttpResponse {
    let db_status = sqlx::query("SELECT 1 as one")
        .fetch_one(pool.get_ref())
        .await
        .map(|row: sqlx::postgres::PgRow| {
            let _: i32 = row.get("one");
            "healthy"
        })
        .unwrap_or("unhealthy");

    if db_status == "healthy" {
        HttpResponse::Ok().json(json!({
            "status": "ok",
            "database": db_status,
            "service": "actix-postgres",
        }))
    } else {
        HttpResponse::ServiceUnavailable().json(json!({
            "status": "error",
            "database": db_status,
        }))
    }
}
```

### Debug Mode

Enable debug logging to troubleshoot instrumentation issues:

```bash showLineNumbers
export RUST_LOG=debug,opentelemetry=debug,tracing_opentelemetry=debug
cargo run --bin api
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash showLineNumbers
   curl -v http://scout-collector:4317/v1/traces
   ```

2. Check environment variables:

   ```bash showLineNumbers
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_SERVICE_NAME
   ```

3. Enable debug logging and check for export errors
4. Verify network connectivity between your app and Scout Collector

#### Issue: Missing database query spans

**Solutions:**

1. Ensure SQLx logging level is set to at least `warn`:

   ```rust showLineNumbers
   EnvFilter::new("info,sqlx=warn")
   ```

2. Verify you're using async SQLx methods that emit tracing spans
3. Check that `tracing-opentelemetry` layer is properly configured

#### Issue: Worker jobs not linked to original request trace

**Solutions:**

1. Verify `capture_trace_context()` is called during `enqueue()`
2. Check that the `trace_context` column exists in the jobs table
3. Ensure the worker calls `span.set_parent(parent_context)` before
   processing

#### Issue: High memory usage

**Solutions:**

1. Reduce `max_queue_size` in batch processor configuration
2. Ensure spans are being exported successfully
3. Check for span attribute size limits

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```rust showLineNumbers
// Bad - exposes sensitive data
tracing::info!(user.password = %password, "Login attempt");

// Good - uses safe identifiers
tracing::info!(user.id = user_id, user.role = %role, "Login attempt");
```

### Sanitizing SQL Statements

SQLx parameterized queries prevent values from appearing in tracing spans:

```rust showLineNumbers
let user = sqlx::query_as!(
    User,
    "SELECT * FROM users WHERE email = $1 AND password_hash = $2",
    email, password_hash
)
.fetch_optional(&pool)
.await?;
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

OpenTelemetry instrumentation adds minimal overhead to Rust Actix Web
applications:

- **Average latency increase**: < 1ms per request
- **CPU overhead**: Less than 1% in production with batch processor
- **Memory overhead**: ~20-50MB depending on queue size and traffic

### Optimization Best Practices

#### 1. Use Batch Processor in Production

The `BatchSpanProcessor` is used by default with `with_batch_exporter`:

```rust showLineNumbers
let tracer_provider = SdkTracerProvider::builder()
    .with_batch_exporter(trace_exporter)
    .build();
```

#### 2. Use Appropriate Log Levels

```rust showLineNumbers
// Production: minimal logging
let env_filter = EnvFilter::new("info,sqlx=warn");

// Development: verbose logging
let env_filter = EnvFilter::new("debug,sqlx=debug");
```

#### 3. Skip Health Check Endpoints

The OTel Collector filter processor removes health check spans:

```yaml showLineNumbers
processors:
  filter/noisy:
    traces:
      span:
        - 'IsMatch(name, ".*/api/health")'
```

## Frequently Asked Questions

### Does OpenTelemetry impact Rust application performance?

OpenTelemetry adds approximately < 1ms of latency per request in typical
Actix Web applications. Rust's zero-cost abstractions and the efficient
`tracing` crate minimize overhead. With batch processing, the performance
impact is negligible for most production workloads.

### What is the difference between Actix Web and Axum instrumentation?

Actix Web uses `tracing-actix-web` with `TracingLogger` middleware, while
Axum uses `tower-http` with `TraceLayer`. Actix Web shares state via
`web::Data<T>`, while Axum uses `State` extractors. Error handling in
Actix Web uses the `ResponseError` trait, and authentication uses
`FromRequest` extractors instead of middleware layers.

### Which Rust versions are supported?

OpenTelemetry Rust supports Rust 1.80+ with edition 2021 or 2024. Rust
1.92+ is recommended for optimal compatibility and performance.

### Can I use OpenTelemetry with async Rust and Tokio?

Yes. The `tracing` crate handles async context propagation automatically,
and `tracing-opentelemetry` bridges tracing spans to OpenTelemetry. Use
`opentelemetry_sdk` with the `rt-tokio` feature for Tokio runtime support.

### How do I trace async tasks spawned with tokio::spawn?

Use `tracing::Instrument` to propagate context to spawned tasks:

```rust showLineNumbers
use tracing::Instrument;

let span = tracing::info_span!("background_task");
tokio::spawn(async move {
    // Work here is traced under the span
}.instrument(span));
```

### How do I propagate traces to background job workers?

Store the W3C `traceparent` header in your job payload when enqueuing, then
extract it with `TraceContextPropagator` in the worker and set it as the
parent context using `span.set_parent()`. See the
[Job Queue](#job-queue-with-trace-propagation) section.

### How do I handle multi-tenant applications?

Add tenant context to spans using tracing fields:

```rust showLineNumbers
tracing::info_span!(
    "request",
    tenant.id = %tenant_id,
    tenant.name = %tenant_name
);
```

### How do I monitor SQLx connection pool health?

SQLx emits tracing spans for pool operations. Monitor these for connection
acquisition times and pool exhaustion. Configure the pool with appropriate
`acquire_timeout` and `max_connections` settings.

### Can I include trace IDs in error responses?

Yes. Use the `get_trace_id()` helper function in your `ResponseError`
implementation to extract the current trace ID and include it in JSON error
responses. See the [Error Handling](#error-handling-with-trace-ids) section.

## What's Next?

### Advanced Topics

- **[PostgreSQL Monitoring Best Practices](../../component/postgres.md)** -
  Optimize database observability with connection pooling metrics

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** -
  Build custom dashboards combining traces, metrics, and business KPIs

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Set up Scout Collector for local development
- **[Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)** -
  Production deployment

## Complete Example

### Project Structure

```text
actix-postgres/
├── src/
│   ├── main.rs              # API bootstrap with TracingLogger
│   ├── lib.rs               # Library exports
│   ├── config.rs            # Configuration
│   ├── error.rs             # Error handling with trace IDs
│   ├── routes.rs            # Route definitions
│   ├── bin/
│   │   └── worker.rs        # Background job worker
│   ├── telemetry/
│   │   ├── init.rs          # OTLP trace/log initialization
│   │   ├── metrics.rs       # 12 custom metrics
│   │   └── mod.rs
│   ├── handlers/
│   │   ├── health.rs
│   │   ├── auth.rs
│   │   └── articles.rs
│   ├── services/
│   │   ├── auth.rs          # #[instrument] on all methods
│   │   └── article.rs       # #[instrument] on all methods
│   ├── repository/
│   │   ├── user.rs          # SQLx with #[instrument]
│   │   ├── article.rs
│   │   └── favorite.rs
│   ├── middleware/
│   │   └── auth.rs          # FromRequest extractors
│   ├── database/
│   │   └── pool.rs
│   ├── models/
│   │   ├── user.rs
│   │   └── article.rs
│   └── jobs/
│       ├── queue.rs          # SKIP LOCKED + W3C trace propagation
│       └── notification.rs
├── config/
│   └── otel-config.yaml     # Collector configuration
├── migrations/
│   └── 20260214000001_initial.sql
├── compose.yml
├── Dockerfile
├── Dockerfile.worker
├── Cargo.toml
└── Cargo.lock
```

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=actix-postgres-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
RUST_LOG=info,sqlx=warn
DATABASE_URL=postgres://postgres:postgres@localhost:5432/actix_postgres_app
JWT_SECRET=your-secret-key
```

This complete example is available in our
[GitHub examples repository](https://github.com/base-14/examples/tree/main/rust/actix-postgres).

## References

- [Official OpenTelemetry Rust Documentation](https://opentelemetry.io/docs/languages/rust/)
- [tracing-actix-web Crate](https://docs.rs/tracing-actix-web)
- [tracing-opentelemetry Crate](https://docs.rs/tracing-opentelemetry)
- [Actix Web Documentation](https://actix.rs/docs/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Axum Instrumentation](./axum.md) - Alternative Rust web framework
- [Go Instrumentation](./go.md) - Another systems programming language
  alternative
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
