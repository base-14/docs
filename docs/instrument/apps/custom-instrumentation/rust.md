---
title: Rust Custom OpenTelemetry Instrumentation - Manual Tracing Guide | base14 Scout
sidebar_label: Rust
sidebar_position: 8
description:
  Custom instrumentation for Rust applications with OpenTelemetry. Manual
  tracing, spans, metrics, and telemetry export with tracing-opentelemetry.
keywords:
  [
    rust instrumentation,
    rust monitoring,
    opentelemetry rust,
    rust custom instrumentation,
    rust observability,
    rust distributed tracing,
    rust manual instrumentation,
    tracing-opentelemetry,
    rust spans,
    rust metrics,
  ]
---

# Rust

Implement OpenTelemetry custom instrumentation for Rust applications to collect
traces, metrics, and logs using the tracing ecosystem and OpenTelemetry SDK.
This guide covers manual instrumentation for any Rust application, including
Axum, Actix-web, Rocket, and custom frameworks.

> **Note:** This guide provides a practical overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry Rust documentation](https://opentelemetry.io/docs/languages/rust/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK with the tracing ecosystem
- Create and manage custom spans using `#[instrument]` and manual spans
- Add attributes, events, and exception tracking
- Implement metrics collection with counters, gauges, and histograms
- Propagate context across service boundaries
- Instrument common Rust patterns and async code

> **Complete Working Examples**: This guide includes code snippets for learning.
> For full implementations, see the
> [Complete Examples](#complete-examples) section.

## Prerequisites

Before starting, ensure you have:

- **Rust 1.75 or later** installed (Rust 1.80+ recommended)
- **Cargo** package manager
- **base14 Scout account** with collector endpoint and API key
- Basic familiarity with async Rust and the tracing crate

## Required Packages

Add these dependencies to your `Cargo.toml`:

```toml title="Cargo.toml"
[dependencies]
# Tracing ecosystem
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# OpenTelemetry core
opentelemetry = "0.29"
opentelemetry_sdk = { version = "0.29", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.29", features = ["tonic"] }

# Tracing-OpenTelemetry bridge
tracing-opentelemetry = "0.30"

# Async runtime
tokio = { version = "1", features = ["full"] }
```

## Telemetry Initialization

Set up the OpenTelemetry SDK with OTLP export:

```rust title="src/telemetry/init.rs"
use opentelemetry::trace::TracerProvider;
use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{
    Resource,
    propagation::TraceContextPropagator,
    trace::{SdkTracerProvider, TracerProviderBuilder},
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct TelemetryGuard {
    tracer_provider: SdkTracerProvider,
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Err(e) = self.tracer_provider.shutdown() {
            eprintln!("Failed to shutdown tracer provider: {e}");
        }
    }
}

pub fn init_telemetry(service_name: &str, otlp_endpoint: &str) -> TelemetryGuard {
    global::set_text_map_propagator(TraceContextPropagator::new());

    let resource = Resource::builder()
        .with_service_name(service_name)
        .with_attribute(KeyValue::new("deployment.environment", "production"))
        .build();

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint)
        .build()
        .expect("Failed to create OTLP exporter");

    let tracer_provider = TracerProviderBuilder::default()
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build();

    let tracer = tracer_provider.tracer(service_name);

    let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(telemetry_layer)
        .with(tracing_subscriber::fmt::layer())
        .init();

    TelemetryGuard { tracer_provider }
}
```

## Traces

### Using the `#[instrument]` Attribute

The simplest way to create spans is using the `#[instrument]` attribute:

```rust
use tracing::instrument;

#[instrument(name = "user.create")]
pub async fn create_user(email: &str, name: &str) -> Result<User, Error> {
    // Function body becomes a span
    let user = db.insert_user(email, name).await?;
    Ok(user)
}
```

### Customizing Instrumented Spans

Control what gets captured in spans:

```rust
use tracing::instrument;

#[instrument(
    name = "order.process",
    skip(self, payment_details),  // Don't log sensitive data
    fields(order_id, customer_id = %customer.id)
)]
pub async fn process_order(
    &self,
    customer: &Customer,
    payment_details: PaymentDetails,
) -> Result<Order, Error> {
    // Record the order_id field dynamically
    let order = self.create_order(customer).await?;
    tracing::Span::current().record("order_id", order.id);

    self.charge_payment(&order, payment_details).await?;

    Ok(order)
}
```

### Manual Span Creation

For more control, create spans manually:

```rust
use tracing::{span, Level, Instrument};

pub async fn batch_process(items: Vec<Item>) -> Result<(), Error> {
    let span = span!(Level::INFO, "batch.process", item_count = items.len());
    let _guard = span.enter();

    for item in items {
        process_item(item).await?;
    }

    Ok(())
}

// Or use .instrument() for async code
pub async fn fetch_data(url: &str) -> Result<Data, Error> {
    let span = span!(Level::INFO, "http.fetch", url = %url);

    async {
        let response = client.get(url).send().await?;
        let data = response.json().await?;
        Ok(data)
    }
    .instrument(span)
    .await
}
```

### Nested Spans

Spans automatically nest based on the call hierarchy:

```rust
#[instrument(name = "api.handler")]
pub async fn handle_request(req: Request) -> Response {
    let user = authenticate(&req).await?;  // Creates child span
    let data = fetch_user_data(&user).await?;  // Creates child span
    process_response(data)  // Creates child span
}

#[instrument(name = "auth.verify")]
async fn authenticate(req: &Request) -> Result<User, Error> {
    // This span is a child of "api.handler"
    validate_token(req.token()).await
}

#[instrument(name = "data.fetch")]
async fn fetch_user_data(user: &User) -> Result<Data, Error> {
    // This span is a child of "api.handler"
    db.get_user_data(user.id).await
}
```

## Attributes

### Adding Span Attributes

Add attributes to provide context:

```rust
use tracing::instrument;

#[instrument(
    name = "article.create",
    fields(
        author_id = %author.id,
        title = %input.title,
        article_id = tracing::field::Empty  // Filled later
    )
)]
pub async fn create_article(author: &User, input: CreateArticle) -> Result<Article, Error> {
    let article = db.insert_article(&input).await?;

    // Record the article_id after creation
    tracing::Span::current().record("article_id", article.id);

    Ok(article)
}
```

### Using Span Extensions

Add attributes dynamically within a span:

```rust
use tracing::Span;

pub async fn process_payment(order_id: i64, amount: f64) -> Result<(), Error> {
    let span = Span::current();

    span.record("order.id", order_id);
    span.record("payment.amount", amount);

    let result = payment_gateway.charge(amount).await?;

    span.record("payment.transaction_id", &result.transaction_id);
    span.record("payment.status", &result.status);

    Ok(())
}
```

### Semantic Conventions

Follow OpenTelemetry semantic conventions for common attributes:

```rust
#[instrument(
    name = "http.request",
    fields(
        http.method = %method,
        http.url = %url,
        http.status_code = tracing::field::Empty,
        http.request.body.size = body_size,
    )
)]
pub async fn make_request(
    method: &str,
    url: &str,
    body_size: usize,
) -> Result<Response, Error> {
    let response = client.request(method, url).send().await?;

    tracing::Span::current().record("http.status_code", response.status().as_u16());

    Ok(response)
}
```

## Events

### Logging Events Within Spans

Use tracing macros to add events:

```rust
use tracing::{info, warn, error, debug, instrument};

#[instrument(name = "order.fulfill")]
pub async fn fulfill_order(order_id: i64) -> Result<(), Error> {
    info!(order_id, "Starting order fulfillment");

    let inventory = check_inventory(order_id).await?;

    if inventory.low_stock {
        warn!(
            order_id,
            available = inventory.available,
            required = inventory.required,
            "Low inventory warning"
        );
    }

    debug!(order_id, step = "payment", "Processing payment");
    process_payment(order_id).await?;

    debug!(order_id, step = "shipping", "Arranging shipping");
    arrange_shipping(order_id).await?;

    info!(order_id, "Order fulfilled successfully");

    Ok(())
}
```

### Structured Event Data

Add structured data to events:

```rust
use tracing::{info, instrument};
use serde::Serialize;

#[derive(Serialize)]
struct OrderMetrics {
    item_count: usize,
    total_amount: f64,
    discount_applied: bool,
}

#[instrument(name = "order.complete")]
pub async fn complete_order(order: &Order) -> Result<(), Error> {
    let metrics = OrderMetrics {
        item_count: order.items.len(),
        total_amount: order.total,
        discount_applied: order.discount.is_some(),
    };

    info!(
        order_id = order.id,
        item_count = metrics.item_count,
        total_amount = metrics.total_amount,
        discount_applied = metrics.discount_applied,
        "Order completed"
    );

    Ok(())
}
```

## Exception Recording

### Recording Errors

Record exceptions with full context:

```rust
use tracing::{error, instrument, Span};

#[instrument(name = "user.login")]
pub async fn login(credentials: Credentials) -> Result<Session, AuthError> {
    match authenticate(&credentials).await {
        Ok(user) => {
            let session = create_session(&user).await?;
            Ok(session)
        }
        Err(e) => {
            error!(
                error = %e,
                error.type = std::any::type_name_of_val(&e),
                username = %credentials.username,
                "Authentication failed"
            );
            Err(e)
        }
    }
}
```

### Custom Error Recording

Create a helper for consistent error recording:

```rust
use tracing::{error, Span};
use std::fmt::Display;

pub trait SpanErrorExt {
    fn record_error<E: Display>(&self, error: &E);
}

impl SpanErrorExt for Span {
    fn record_error<E: Display>(&self, error: &E) {
        error!(
            parent: self,
            error = %error,
            "Operation failed"
        );
    }
}

// Usage
#[instrument(name = "data.fetch")]
pub async fn fetch_data(id: i64) -> Result<Data, Error> {
    db.get(id).await.map_err(|e| {
        Span::current().record_error(&e);
        e
    })
}
```

### Error Boundaries

Handle errors at service boundaries:

```rust
use tracing::{error, instrument};

#[instrument(name = "api.request", skip(body))]
pub async fn handle_api_request(
    method: &str,
    path: &str,
    body: Bytes,
) -> Result<Response, ApiError> {
    let result = route_request(method, path, body).await;

    match &result {
        Ok(response) => {
            tracing::info!(
                status = response.status().as_u16(),
                "Request completed"
            );
        }
        Err(e) => {
            error!(
                error = %e,
                error.code = e.code(),
                "Request failed"
            );
        }
    }

    result
}
```

## Metrics

### Setting Up Metrics

Initialize the metrics provider:

```rust title="src/telemetry/metrics.rs"
use opentelemetry::{
    global,
    metrics::{Counter, Histogram, Meter},
};
use std::sync::LazyLock;

pub static METER: LazyLock<Meter> = LazyLock::new(|| {
    global::meter("my-service")
});

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
            1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0,
        ])
        .build()
});
```

### Counter Metrics

Track counts of events:

```rust
use opentelemetry::KeyValue;
use crate::telemetry::{HTTP_REQUESTS_TOTAL, USERS_REGISTERED};

pub async fn handle_request(method: &str, path: &str) -> Response {
    HTTP_REQUESTS_TOTAL.add(
        1,
        &[
            KeyValue::new("http.method", method.to_string()),
            KeyValue::new("http.route", path.to_string()),
        ],
    );

    // Handle request...
}

pub async fn register_user(input: RegisterUser) -> Result<User, Error> {
    let user = db.create_user(&input).await?;

    USERS_REGISTERED.add(1, &[]);

    Ok(user)
}
```

### Histogram Metrics

Record distributions of values:

```rust
use std::time::Instant;
use opentelemetry::KeyValue;
use crate::telemetry::HTTP_REQUEST_DURATION;

pub async fn timed_request<F, T>(handler: F) -> T
where
    F: Future<Output = T>,
{
    let start = Instant::now();

    let result = handler.await;

    let duration = start.elapsed().as_millis() as f64;
    HTTP_REQUEST_DURATION.record(
        duration,
        &[KeyValue::new("http.route", "/api/users")],
    );

    result
}
```

### Gauge Metrics

Track current values:

```rust
use opentelemetry::KeyValue;
use std::sync::LazyLock;

pub static ACTIVE_CONNECTIONS: LazyLock<opentelemetry::metrics::Gauge<i64>> =
    LazyLock::new(|| {
        METER
            .i64_gauge("connections.active")
            .with_description("Number of active connections")
            .build()
    });

pub fn update_connection_count(count: i64) {
    ACTIVE_CONNECTIONS.record(count, &[]);
}
```

### Business Metrics

Track domain-specific metrics:

```rust
use opentelemetry::KeyValue;
use std::sync::LazyLock;

pub static ARTICLES_CREATED: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("articles.created")
        .with_description("Total articles created")
        .build()
});

pub static ORDERS_TOTAL: LazyLock<Counter<u64>> = LazyLock::new(|| {
    METER
        .u64_counter("orders.total")
        .with_description("Total orders placed")
        .build()
});

pub static ORDER_VALUE: LazyLock<Histogram<f64>> = LazyLock::new(|| {
    METER
        .f64_histogram("order.value")
        .with_description("Order value in dollars")
        .with_unit("USD")
        .build()
});

// Usage
pub async fn create_order(order: &Order) -> Result<(), Error> {
    // Process order...

    ORDERS_TOTAL.add(
        1,
        &[KeyValue::new("order.type", order.order_type.to_string())],
    );

    ORDER_VALUE.record(order.total, &[]);

    Ok(())
}
```

## Context Propagation

### HTTP Context Propagation

Propagate trace context across HTTP boundaries:

```rust
use opentelemetry::global;
use opentelemetry::propagation::Injector;
use reqwest::header::HeaderMap;

struct HeaderInjector<'a>(&'a mut HeaderMap);

impl<'a> Injector for HeaderInjector<'a> {
    fn set(&mut self, key: &str, value: String) {
        if let Ok(header_name) = key.parse() {
            if let Ok(header_value) = value.parse() {
                self.0.insert(header_name, header_value);
            }
        }
    }
}

pub async fn call_service(url: &str) -> Result<Response, Error> {
    let mut headers = HeaderMap::new();

    // Inject current trace context into headers
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut HeaderInjector(&mut headers),
        );
    });

    let response = reqwest::Client::new()
        .get(url)
        .headers(headers)
        .send()
        .await?;

    Ok(response)
}
```

### Extracting Context from Incoming Requests

Extract trace context from incoming HTTP requests:

```rust
use opentelemetry::propagation::Extractor;
use axum::http::HeaderMap;

struct HeaderExtractor<'a>(&'a HeaderMap);

impl<'a> Extractor for HeaderExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

pub fn extract_context(headers: &HeaderMap) -> opentelemetry::Context {
    global::get_text_map_propagator(|propagator| {
        propagator.extract(&HeaderExtractor(headers))
    })
}
```

### Async Task Context

Propagate context to spawned tasks:

```rust
use tracing::Instrument;

pub async fn process_in_background(data: Data) {
    let span = tracing::span!(tracing::Level::INFO, "background.task");

    tokio::spawn(
        async move {
            // This task carries the trace context
            process_data(data).await;
        }
        .instrument(span),
    );
}
```

## Framework-Specific Examples

### Axum Middleware

Create tracing middleware for Axum:

```rust
use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use tracing::{instrument, Span};
use std::time::Instant;

pub async fn tracing_middleware(request: Request, next: Next) -> Response {
    let method = request.method().to_string();
    let uri = request.uri().path().to_string();

    let span = tracing::span!(
        tracing::Level::INFO,
        "http.request",
        http.method = %method,
        http.uri = %uri,
        http.status_code = tracing::field::Empty,
    );

    let start = Instant::now();

    let response = next.run(request).instrument(span.clone()).await;

    let duration = start.elapsed();
    span.record("http.status_code", response.status().as_u16());

    tracing::info!(
        parent: &span,
        duration_ms = duration.as_millis(),
        "Request completed"
    );

    response
}
```

### Tower Service Instrumentation

Instrument Tower services:

```rust
use tower_http::trace::{TraceLayer, DefaultMakeSpan, DefaultOnResponse};
use tracing::Level;

let app = Router::new()
    .route("/api/users", get(list_users))
    .layer(
        TraceLayer::new_for_http()
            .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
            .on_response(DefaultOnResponse::new().level(Level::INFO)),
    );
```

## Best Practices

### 1. Use Structured Fields

Always use structured fields instead of string interpolation:

```rust
// Good
tracing::info!(user_id = 123, action = "login", "User logged in");

// Avoid
tracing::info!("User 123 logged in");
```

### 2. Skip Sensitive Data

Never log sensitive information:

```rust
#[instrument(skip(password, credit_card))]
pub async fn process_payment(
    user_id: i64,
    password: &str,
    credit_card: &CreditCard,
) -> Result<(), Error> {
    // ...
}
```

### 3. Use Appropriate Span Names

Follow a consistent naming convention:

```rust
// Good: domain.action format
#[instrument(name = "user.create")]
#[instrument(name = "order.process")]
#[instrument(name = "payment.charge")]

// Avoid: inconsistent naming
#[instrument(name = "createUser")]
#[instrument(name = "process_order")]
```

### 4. Handle Errors Consistently

Always record errors before returning:

```rust
#[instrument(name = "data.fetch")]
pub async fn fetch_data(id: i64) -> Result<Data, Error> {
    match db.get(id).await {
        Ok(data) => Ok(data),
        Err(e) => {
            tracing::error!(error = %e, id, "Failed to fetch data");
            Err(e)
        }
    }
}
```

### 5. Use Field Placeholders for Dynamic Values

Record values that aren't known at span creation:

```rust
#[instrument(
    name = "request.process",
    fields(response_size = tracing::field::Empty)
)]
pub async fn process() -> Response {
    let response = generate_response().await;
    Span::current().record("response_size", response.body().len());
    response
}
```

## Complete Examples

### Full Service Setup

```rust title="src/main.rs"
use std::net::SocketAddr;
use axum::{Router, routing::get};
use tracing::info;

mod telemetry;
mod handlers;

#[tokio::main]
async fn main() {
    let _guard = telemetry::init_telemetry(
        "my-rust-service",
        "https://scout-collector.base14.io:4317",
    );

    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/api/users", get(handlers::list_users));

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Starting server on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

### Instrumented Handler

```rust title="src/handlers.rs"
use axum::Json;
use tracing::instrument;
use crate::telemetry::USERS_FETCHED;

#[instrument(name = "handler.list_users")]
pub async fn list_users() -> Json<Vec<User>> {
    let users = fetch_users_from_db().await;

    USERS_FETCHED.add(users.len() as u64, &[]);

    Json(users)
}

#[instrument(name = "db.fetch_users")]
async fn fetch_users_from_db() -> Vec<User> {
    // Database query with automatic span
    sqlx::query_as!(User, "SELECT * FROM users")
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
}
```

## Extracting Trace and Span IDs

Extract trace context for logging or correlation:

```rust
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub fn get_trace_ids() -> (String, String) {
    let span = Span::current();
    let context = span.context();
    let span_ref = context.span();
    let span_context = span_ref.span_context();

    let trace_id = span_context.trace_id().to_string();
    let span_id = span_context.span_id().to_string();

    (trace_id, span_id)
}

// Include in error responses
pub async fn handle_error(error: Error) -> Response {
    let (trace_id, span_id) = get_trace_ids();

    Json(json!({
        "error": error.to_string(),
        "trace_id": trace_id,
        "span_id": span_id,
    }))
    .into_response()
}
```

## Proper Shutdown and Resource Cleanup

Ensure telemetry is properly flushed on shutdown:

```rust
use tokio::signal;

#[tokio::main]
async fn main() {
    // The guard ensures cleanup on drop
    let _telemetry_guard = telemetry::init_telemetry(
        "my-service",
        "https://scout-collector.base14.io:4317",
    );

    let app = create_app();

    // Graceful shutdown
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    // Guard drops here, flushing all telemetry
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c().await.expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, flushing telemetry...");
}
```

## Database Instrumentation Patterns

### SQLx Query Instrumentation

SQLx provides automatic tracing when the `tracing` feature is enabled:

```toml title="Cargo.toml"
[dependencies]
sqlx = { version = "0.8", features = ["runtime-tokio", "postgres", "tracing"] }
```

```rust
#[instrument(name = "db.get_user", skip(pool))]
pub async fn get_user(pool: &PgPool, id: i64) -> Result<User, Error> {
    sqlx::query_as!(User, "SELECT * FROM users WHERE id = $1", id)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

#[instrument(name = "db.create_user", skip(pool))]
pub async fn create_user(pool: &PgPool, input: &CreateUser) -> Result<User, Error> {
    sqlx::query_as!(
        User,
        r#"
        INSERT INTO users (email, name)
        VALUES ($1, $2)
        RETURNING *
        "#,
        input.email,
        input.name
    )
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}
```

### Transaction Instrumentation

Instrument database transactions:

```rust
#[instrument(name = "db.transfer_funds", skip(pool))]
pub async fn transfer_funds(
    pool: &PgPool,
    from_id: i64,
    to_id: i64,
    amount: f64,
) -> Result<(), Error> {
    let mut tx = pool.begin().await?;

    tracing::info!(from_id, to_id, amount, "Starting fund transfer");

    sqlx::query!(
        "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
        amount,
        from_id
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
        amount,
        to_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(from_id, to_id, amount, "Fund transfer completed");

    Ok(())
}
```

## References

- [OpenTelemetry Rust Documentation](https://opentelemetry.io/docs/languages/rust/)
- [tracing crate documentation](https://docs.rs/tracing/latest/tracing/)
- [tracing-opentelemetry documentation](https://docs.rs/tracing-opentelemetry/latest/tracing_opentelemetry/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Axum Auto-Instrumentation Guide](../auto-instrumentation/axum.md)
- [Creating Alerts with LogX](../../../guides/creating-alerts-with-logx.md)
- [Create Your First Dashboard](../../../guides/create-your-first-dashboard.md)
