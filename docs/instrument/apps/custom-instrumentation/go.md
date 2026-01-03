---
title: Go Custom OpenTelemetry Instrumentation - Manual Tracing Guide
sidebar_label: Go
description:
  Custom instrumentation for Go applications with OpenTelemetry. Manual
  tracing, spans, metrics, and telemetry export with Go OpenTelemetry SDK.
keywords:
  [
    go instrumentation,
    golang monitoring,
    opentelemetry go,
    go custom instrumentation,
    golang observability,
    go distributed tracing,
    go manual instrumentation,
    opentelemetry go sdk,
  ]
---

# Go

Implement OpenTelemetry custom instrumentation for Go applications to collect
traces, metrics, and logs using the Go OpenTelemetry SDK. This guide covers
manual instrumentation for any Go application, including Gin, Echo, Chi, gRPC,
and custom frameworks.

> **Note:** This guide provides a practical overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry Go documentation](https://opentelemetry.io/docs/languages/go/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK for manual instrumentation
- Create and manage custom spans
- Add attributes, events, and exception tracking
- Implement metrics collection
- Propagate context across service boundaries
- Instrument common Go patterns and frameworks

> 📦 **Complete Working Examples**: This guide includes code snippets for
> learning. For full implementations, see the [Complete Examples](#complete-examples)
> section featuring Gin + PostgreSQL and Chi router applications.

## Prerequisites

Before starting, ensure you have:

- **Go 1.21 or later** installed (Go 1.24+ recommended for forward compatibility)
- A Go project initialized with `go mod init`
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

> ⚠️ **Signal Stability Status** (as of 2025):
>
> - **Traces**: Stable ✅
> - **Metrics**: Stable ✅
> - **Logs**: Beta (API may change before reaching stable status)

## Required Packages

Install the OpenTelemetry SDK and necessary packages:

```bash showLineNumbers
go get go.opentelemetry.io/otel \
  go.opentelemetry.io/otel/trace \
  go.opentelemetry.io/otel/sdk \
  go.opentelemetry.io/otel/metric \
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp \
  go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp \
  go.opentelemetry.io/otel/sdk/metric \
  go.opentelemetry.io/otel/sdk/resource \
  go.opentelemetry.io/otel/sdk/trace \
  go.opentelemetry.io/otel/semconv/v1.37.0
```

## Traces

Traces provide a complete picture of request flows through your application,
from initial request to final response, including all operations and services
involved.

### Initialization

Initialize the OpenTelemetry SDK with resource information and exporters:

```go showLineNumbers title="telemetry.go"
package main

import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
    "go.opentelemetry.io/otel/trace"
)

func setupTracing(ctx context.Context) (trace.Tracer, error) {
    // Create resource with service information
    res, err := resource.Merge(resource.Default(),
        resource.NewWithAttributes(semconv.SchemaURL,
            semconv.ServiceName("my-go-app"),
            semconv.ServiceVersion("1.0.0"),
            semconv.DeploymentEnvironment("production"),
        ))
    if err != nil {
        return nil, err
    }

    // Create OTLP trace exporter
    // Uses OTEL_EXPORTER_OTLP_ENDPOINT environment variable
    traceExporter, err := otlptracehttp.New(ctx)
    if err != nil {
        return nil, err
    }

    // Create tracer provider
    tracerProvider := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(traceExporter),
        sdktrace.WithResource(res),
    )

    // Set global tracer provider
    otel.SetTracerProvider(tracerProvider)

    // Create and return tracer
    tracer := otel.Tracer("my-go-app", trace.WithInstrumentationVersion("1.0.0"))
    return tracer, nil
}
```

> **Note**: Set the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable to your
> Scout Collector endpoint (e.g., `http://localhost:4318`). Ensure your Scout
> Collector is properly configured to receive trace data.

### Creating Spans

Create a span to track an operation:

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    // do some work that 'span' tracks
    fmt.Println("doing some work...")
}
```

### Creating Nested Spans

Create parent-child span relationships:

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, parent := tracer.Start(ctx, "parent")
    defer parent.End()

    // do some work that 'parent' tracks
    fmt.Println("doing some work...")

    // Create a nested span to track nested work
    _, child := tracer.Start(ctx, "child")
    defer child.End()

    // do some work that 'child' tracks
    fmt.Println("doing some nested work...")
}
```

### Helper Methods for Cleaner Code

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span")
    defer span.End()

    fmt.Println("doing some work...")
}

// Helper function that automatically creates and manages spans
func withSpan(ctx context.Context, tracer trace.Tracer, name string, fn func(context.Context)) {
    ctx, span := tracer.Start(ctx, name)
    defer span.End()
    fn(ctx)
}

// Usage
withSpan(ctx, tracer, "work.operation", func(ctx context.Context) {
    fmt.Println("doing some work...")
})
```

## Attributes

Attributes add context to spans as key-value pairs:

### Adding Custom Attributes

```go showLineNumbers
import "go.opentelemetry.io/otel/attribute"

func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    span.SetAttributes(
        attribute.Int("operation.value", 1),
        attribute.String("operation.name", "Saying hello!"),
        attribute.StringSlice("operation.other-stuff", []string{"1", "2", "3"}),
    )

    fmt.Println("doing some work...")
}
```

### Using Semantic Conventions

Use standardized attribute names for common operations:

```go showLineNumbers
import semconv "go.opentelemetry.io/otel/semconv/v1.37.0"

func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    span.SetAttributes(
        semconv.HTTPRequestMethodOriginal("GET"),
        semconv.URLFull("https://base14.io/"),
        semconv.HTTPResponseStatusCode(200),
    )

    fmt.Println("doing some work...")
}
```

## Events

Events mark significant moments during a span's lifetime:

### Adding Events to a Span

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    span.AddEvent("Starting some work")
    fmt.Println("doing some work...")
    span.AddEvent("Finished working")
}
```

### Adding Events with Attributes

```go showLineNumbers
import "go.opentelemetry.io/otel/attribute"

func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    span.AddEvent("Processing request", trace.WithAttributes(
        attribute.String("user.id", "12345"),
        attribute.String("request.type", "api"),
    ))

    fmt.Println("doing some work...")
}
```

## Exception Recording

Capture and record exceptions in spans:

```go showLineNumbers
import (
    "go.opentelemetry.io/otel/codes"
    "go.opentelemetry.io/otel/attribute"
)

func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    // Simulate work that might fail
    if err := someOperation(); err != nil {
        span.SetStatus(codes.Error, "Operation failed")
        span.RecordError(err, trace.WithAttributes(
            attribute.String("error.type", "operation_error"),
        ))
        return
    }

    // Explicitly mark as successful (optional)
    span.SetStatus(codes.Ok, "Operation completed successfully")
}

func someOperation() error {
    // simulate an operation that might fail
    return nil
}
```

## Metrics

Collect custom metrics to track application performance:

### Initialization

Initialize the MeterProvider with metric exporters:

```go showLineNumbers title="metrics.go"
import (
    "context"
    "time"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/metric"
    "go.opentelemetry.io/otel/sdk/resource"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
)

func setupMetrics(ctx context.Context) (metric.Meter, error) {
    // Create resource
    res, err := resource.Merge(resource.Default(),
        resource.NewWithAttributes(semconv.SchemaURL,
            semconv.ServiceName("my-go-app"),
            semconv.ServiceVersion("1.0.0"),
        ))
    if err != nil {
        return nil, err
    }

    // Create OTLP metric exporter
    // Uses OTEL_EXPORTER_OTLP_ENDPOINT environment variable
    metricExporter, err := otlpmetrichttp.New(ctx)
    if err != nil {
        return nil, err
    }

    // Create meter provider
    meterProvider := sdkmetric.NewMeterProvider(
        sdkmetric.WithResource(res),
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter,
            sdkmetric.WithInterval(5*time.Second),
        )),
    )

    // Set global meter provider
    otel.SetMeterProvider(meterProvider)

    // Create and return meter
    meter := otel.Meter("my-go-app", metric.WithInstrumentationVersion("1.0.0"))
    return meter, nil
}
```

> **Note**: The exporter uses the `OTEL_EXPORTER_OTLP_ENDPOINT` environment
> variable. Ensure your Scout Collector is properly configured to receive metric
> data.

### Counter

Track cumulative values that only increase:

#### Creating a Synchronous Counter

```go showLineNumbers
import "go.opentelemetry.io/otel/attribute"

func setupCounter(meter metric.Meter) (metric.Int64Counter, error) {
    workCounter, err := meter.Int64Counter(
        "work.counter",
        metric.WithDescription("Counts the amount of work done"),
        metric.WithUnit("1"),
    )
    return workCounter, err
}

func doWork(ctx context.Context, counter metric.Int64Counter, workType string) {
    counter.Add(ctx, 1, metric.WithAttributes(
        attribute.String("work.type", workType),
    ))
    fmt.Println("doing some work...")
}
```

#### Creating Asynchronous Counter

```go showLineNumbers
func setupAsyncCounter(meter metric.Meter) error {
    counter, err := meter.Int64ObservableCounter(
        "process.page.faults",
        metric.WithDescription("Process page faults"),
        metric.WithUnit("faults"),
    )
    if err != nil {
        return err
    }

    // Register callback
    _, err = meter.RegisterCallback(
        func(ctx context.Context, o metric.Observer) error {
            // Simulate getting process stats
            o.ObserveInt64(counter, 8, metric.WithAttributes(
                attribute.Int("pid", 0),
                attribute.Int("bitness", 64),
            ))
            o.ObserveInt64(counter, 37741921, metric.WithAttributes(
                attribute.Int("pid", 4),
                attribute.Int("bitness", 64),
            ))
            o.ObserveInt64(counter, 10465, metric.WithAttributes(
                attribute.Int("pid", 880),
                attribute.Int("bitness", 32),
            ))
            return nil
        },
        counter,
    )
    return err
}
```

### Histogram

Record distributions of values:

#### Creating a Histogram

```go showLineNumbers
import (
    "time"
    "go.opentelemetry.io/otel/attribute"
    semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
)

func setupHistogram(meter metric.Meter) (metric.Int64Histogram, error) {
    httpServerDuration, err := meter.Int64Histogram(
        "http.server.duration",
        metric.WithDescription("measures the duration of the inbound HTTP request"),
        metric.WithUnit("ms"),
    )
    return httpServerDuration, err
}

func recordDuration(ctx context.Context, histogram metric.Int64Histogram, duration int64, method, scheme string) {
    histogram.Record(ctx, duration, metric.WithAttributes(
        semconv.HTTPRequestMethodOriginal(method),
        semconv.URLScheme(scheme),
    ))
}

// Usage example
func handleRequest(ctx context.Context, histogram metric.Int64Histogram) {
    start := time.Now()

    // Handle request logic here...

    duration := time.Since(start).Milliseconds()
    recordDuration(ctx, histogram, duration, "POST", "https")
}
```

### Gauge

Track values that can increase or decrease:

#### Creating an Observable Gauge

```go showLineNumbers
func setupGauge(meter metric.Meter) error {
    gauge, err := meter.Int64ObservableGauge(
        "system.cpu.usage",
        metric.WithDescription("Current CPU usage percentage"),
        metric.WithUnit("%"),
    )
    if err != nil {
        return err
    }

    // Register callback to observe current CPU usage
    _, err = meter.RegisterCallback(
        func(ctx context.Context, o metric.Observer) error {
            // Get current CPU usage (simulated)
            cpuUsage := getCurrentCPUUsage()
            o.ObserveInt64(gauge, cpuUsage, metric.WithAttributes(
                attribute.String("cpu.core", "0"),
            ))
            return nil
        },
        gauge,
    )
    return err
}

func getCurrentCPUUsage() int64 {
    // Simulate getting CPU usage
    return 75 // 75% CPU usage
}
```

## Context Propagation

Propagate trace context across HTTP requests to maintain distributed traces:

### Outgoing HTTP Requests

```go showLineNumbers
import (
    "net/http"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/propagation"
)

func makeExternalRequest(ctx context.Context, tracer trace.Tracer, url string) error {
    ctx, span := tracer.Start(ctx, "external-api-call")
    defer span.End()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return err
    }

    // Inject trace context into HTTP headers
    otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        span.RecordError(err)
        return err
    }
    defer resp.Body.Close()

    span.SetAttributes(attribute.Int("http.status_code", resp.StatusCode))
    return nil
}
```

### Incoming HTTP Requests

```go showLineNumbers
func handleRequest(w http.ResponseWriter, r *http.Request, tracer trace.Tracer) {
    // Extract context from incoming request headers
    ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))

    // Start span with extracted context
    ctx, span := tracer.Start(ctx, "handle-request")
    defer span.End()

    span.SetAttributes(
        attribute.String("http.method", r.Method),
        attribute.String("http.url", r.URL.Path),
    )

    // Process request with propagated context
    processRequest(ctx)

    span.SetAttributes(attribute.Int("http.status_code", 200))
    w.WriteHeader(http.StatusOK)
}
```

## Framework-Specific Examples

### Gin Web Framework

```go showLineNumbers title="gin_example.go"
import (
    "github.com/gin-gonic/gin"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/propagation"
)

func main() {
    tracer := otel.Tracer("gin-app")
    router := gin.Default()

    // Middleware to extract and propagate context
    router.Use(func(c *gin.Context) {
        ctx := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))
        ctx, span := tracer.Start(ctx, c.Request.Method+" "+c.FullPath())
        defer span.End()

        span.SetAttributes(
            attribute.String("http.method", c.Request.Method),
            attribute.String("http.route", c.FullPath()),
        )

        c.Request = c.Request.WithContext(ctx)
        c.Next()

        span.SetAttributes(attribute.Int("http.status_code", c.Writer.Status()))
    })

    router.GET("/users/:id", func(c *gin.Context) {
        ctx := c.Request.Context()
        _, span := tracer.Start(ctx, "get-user")
        defer span.End()

        userID := c.Param("id")
        span.SetAttributes(attribute.String("user.id", userID))

        // Fetch user logic here
        c.JSON(200, gin.H{"id": userID, "name": "John Doe"})
    })

    router.Run(":8080")
}
```

> 💡 **Complete Gin Example**: For a production-ready Gin application with
> database instrumentation, structured logging, and Docker deployment, see the
> [go119-gin191-postgres example](https://github.com/base-14/examples/tree/main/go/go119-gin191-postgres).

### Echo Web Framework

```go showLineNumbers title="echo_example.go"
import (
    "github.com/labstack/echo/v4"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/propagation"
)

func main() {
    tracer := otel.Tracer("echo-app")
    e := echo.New()

    // Middleware
    e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c echo.Context) error {
            ctx := otel.GetTextMapPropagator().Extract(c.Request().Context(), propagation.HeaderCarrier(c.Request().Header))
            ctx, span := tracer.Start(ctx, c.Request().Method+" "+c.Path())
            defer span.End()

            span.SetAttributes(
                attribute.String("http.method", c.Request().Method),
                attribute.String("http.route", c.Path()),
            )

            c.SetRequest(c.Request().WithContext(ctx))
            err := next(c)

            span.SetAttributes(attribute.Int("http.status_code", c.Response().Status))
            return err
        }
    })

    e.GET("/users/:id", func(c echo.Context) error {
        ctx := c.Request().Context()
        _, span := tracer.Start(ctx, "get-user")
        defer span.End()

        userID := c.Param("id")
        span.SetAttributes(attribute.String("user.id", userID))

        return c.JSON(200, map[string]string{"id": userID, "name": "Jane Doe"})
    })

    e.Start(":8080")
}
```

### gRPC Server

```go showLineNumbers title="grpc_server.go"
import (
    "context"
    "google.golang.org/grpc"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
)

func UnaryServerInterceptor(tracer trace.Tracer) grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
        ctx, span := tracer.Start(ctx, info.FullMethod)
        defer span.End()

        span.SetAttributes(
            attribute.String("rpc.system", "grpc"),
            attribute.String("rpc.method", info.FullMethod),
        )

        resp, err := handler(ctx, req)
        if err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
        }

        return resp, err
    }
}
```

### Plain HTTP Server

```go showLineNumbers title="http_server.go"
import (
    "net/http"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/propagation"
)

func main() {
    tracer := otel.Tracer("http-server")

    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
        ctx, span := tracer.Start(ctx, r.Method+" "+r.URL.Path)
        defer span.End()

        span.SetAttributes(
            attribute.String("http.method", r.Method),
            attribute.String("http.url", r.URL.Path),
        )

        // Business logic
        w.WriteHeader(http.StatusOK)
        w.Write([]byte("Hello, World!"))

        span.SetAttributes(attribute.Int("http.status_code", http.StatusOK))
    })

    http.ListenAndServe(":8080", nil)
}
```

## Best Practices

### 1. Always End Spans

```go
// Good - using defer
ctx, span := tracer.Start(ctx, "operation")
defer span.End()
doWork(ctx)

// Bad - span may not end if panic occurs
ctx, span := tracer.Start(ctx, "operation")
doWork(ctx)
span.End()
```

### 2. Use Descriptive Span Names

```go
// Good
ctx, span := tracer.Start(ctx, "UserRepository.FindByID")
ctx, span := tracer.Start(ctx, "PaymentService.ProcessPayment")

// Bad
ctx, span := tracer.Start(ctx, "operation")
ctx, span := tracer.Start(ctx, "query")
```

### 3. Add Relevant Attributes

```go
// Good
span.SetAttributes(
    attribute.String("user.id", userID),
    attribute.Float64("order.amount", amount),
    attribute.Bool("cache.hit", true),
)

// Bad - sensitive data
span.SetAttributes(
    attribute.String("user.password", password), // Never!
    attribute.String("credit.card.number", ccNumber), // Never!
)
```

### 4. Use Semantic Conventions

```go
// Good - using semantic conventions
import semconv "go.opentelemetry.io/otel/semconv/v1.37.0"

span.SetAttributes(
    semconv.HTTPRequestMethodOriginal("POST"),
    semconv.DBSystemPostgreSQL,
    semconv.DBNamespace("production"),
)
```

### 5. Handle Errors Properly

```go
// Good
ctx, span := tracer.Start(ctx, "risky-operation")
defer span.End()

if err := riskyOperation(); err != nil {
    span.RecordError(err)
    span.SetStatus(codes.Error, err.Error())
    return err
}

span.SetStatus(codes.Ok, "")

// Bad - swallowing errors
if err := riskyOperation(); err != nil {
    // Error lost
}
```

## Complete Example

Here's a complete example of a Go application with custom instrumentation:

```go showLineNumbers title="main.go"
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/codes"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/metric"
    "go.opentelemetry.io/otel/sdk/resource"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
    "go.opentelemetry.io/otel/trace"
)

var (
    tracer          trace.Tracer
    meter           metric.Meter
    requestCounter  metric.Int64Counter
    requestDuration metric.Int64Histogram
)

func initTelemetry(ctx context.Context) error {
    // Create resource
    res, err := resource.Merge(resource.Default(),
        resource.NewWithAttributes(semconv.SchemaURL,
            semconv.ServiceName("my-go-app"),
            semconv.ServiceVersion("1.0.0"),
        ))
    if err != nil {
        return err
    }

    // Setup traces
    // Uses OTEL_EXPORTER_OTLP_ENDPOINT environment variable
    traceExporter, err := otlptracehttp.New(ctx)
    if err != nil {
        return err
    }

    tracerProvider := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(traceExporter),
        sdktrace.WithResource(res),
    )
    otel.SetTracerProvider(tracerProvider)

    // Setup metrics
    // Uses OTEL_EXPORTER_OTLP_ENDPOINT environment variable
    metricExporter, err := otlpmetrichttp.New(ctx)
    if err != nil {
        return err
    }

    meterProvider := sdkmetric.NewMeterProvider(
        sdkmetric.WithResource(res),
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter,
            sdkmetric.WithInterval(5*time.Second),
        )),
    )
    otel.SetMeterProvider(meterProvider)

    // Create tracer and meter
    tracer = otel.Tracer("my-go-app")
    meter = otel.Meter("my-go-app")

    // Create metrics
    requestCounter, err = meter.Int64Counter(
        "requests.total",
        metric.WithDescription("Total requests"),
        metric.WithUnit("requests"),
    )
    if err != nil {
        return err
    }

    requestDuration, err = meter.Int64Histogram(
        "requests.duration",
        metric.WithDescription("Request duration"),
        metric.WithUnit("ms"),
    )
    if err != nil {
        return err
    }

    return nil
}

func processRequest(ctx context.Context) {
    start := time.Now()

    ctx, span := tracer.Start(ctx, "http.request")
    defer span.End()

    span.SetAttributes(
        attribute.String("http.method", "POST"),
        attribute.String("http.url", "/api/orders"),
    )

    // Business logic
    if err := createOrder(ctx); err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        recordMetrics(500, start)
        return
    }

    span.SetAttributes(attribute.Int("http.status_code", 201))
    span.SetStatus(codes.Ok, "")
    recordMetrics(201, start)
}

func createOrder(ctx context.Context) error {
    ctx, span := tracer.Start(ctx, "create_order")
    defer span.End()

    // Simulate order creation
    orderID := 12345
    span.SetAttributes(
        attribute.Int("order.id", orderID),
        attribute.Float64("order.total", 99.99),
    )

    fmt.Printf("Order created: %d\n", orderID)
    return nil
}

func recordMetrics(statusCode int, startTime time.Time) {
    duration := time.Since(startTime).Milliseconds()

    attrs := metric.WithAttributes(
        attribute.Int("status", statusCode),
    )

    requestCounter.Add(context.Background(), 1, attrs)
    requestDuration.Record(context.Background(), duration, attrs)
}

func main() {
    ctx := context.Background()

    if err := initTelemetry(ctx); err != nil {
        log.Fatalf("Failed to initialize telemetry: %v", err)
    }

    // Process request
    processRequest(ctx)

    // Allow time for export
    time.Sleep(2 * time.Second)
}
```

## Extracting Trace and Span IDs

Extract trace ID and span ID for log correlation:

```go showLineNumbers
import "go.opentelemetry.io/otel/trace"

func getTraceAndSpanIDs(ctx context.Context) (string, string) {
    span := trace.SpanFromContext(ctx)
    if span.SpanContext().IsValid() {
        traceID := span.SpanContext().TraceID().String()
        spanID := span.SpanContext().SpanID().String()
        return traceID, spanID
    }
    return "", ""
}

// Usage with logging
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "work.operation")
    defer span.End()

    traceID, spanID := getTraceAndSpanIDs(ctx)

    // Use for structured logging
    log.Printf("Processing request - TraceID: %s, SpanID: %s", traceID, spanID)

    performWork(ctx)
}
```

## Proper Shutdown and Resource Cleanup

Always ensure proper cleanup of telemetry resources to flush all pending spans
and metrics before application exit. This is critical for preventing data loss.

### Shutdown Pattern

```go showLineNumbers title="main.go"
package main

import (
    "context"
    "errors"
    "log"
    "os"
    "os/signal"
)

func main() {
    ctx := context.Background()

    // Setup OpenTelemetry
    shutdown, err := setupOTelSDK(ctx)
    if err != nil {
        log.Fatal(err)
    }

    // Ensure all spans and metrics are flushed before exit
    defer func() {
        if err := shutdown(ctx); err != nil {
            log.Printf("Error during shutdown: %v", err)
        }
    }()

    // Handle graceful shutdown on interrupt
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, os.Interrupt)

    go func() {
        <-sigCh
        log.Println("Received interrupt signal, shutting down...")
        if err := shutdown(ctx); err != nil {
            log.Printf("Error during graceful shutdown: %v", err)
        }
        os.Exit(0)
    }()

    // Your application code...
    log.Println("Application running...")
}

func setupOTelSDK(ctx context.Context) (func(context.Context) error, error) {
    var shutdownFuncs []func(context.Context) error

    // Setup trace provider
    tracerProvider, err := setupTracing(ctx)
    if err != nil {
        return nil, err
    }
    shutdownFuncs = append(shutdownFuncs, tracerProvider.Shutdown)

    // Setup meter provider
    meterProvider, err := setupMetrics(ctx)
    if err != nil {
        return nil, err
    }
    shutdownFuncs = append(shutdownFuncs, meterProvider.Shutdown)

    // Return combined shutdown function
    shutdown := func(ctx context.Context) error {
        var err error
        for _, fn := range shutdownFuncs {
            err = errors.Join(err, fn(ctx))
        }
        return err
    }

    return shutdown, nil
}
```

### Why Shutdown Matters

Without proper shutdown:

- **Span Loss**: Batched spans may not be exported
- **Metric Loss**: Periodic metric readings may be missed
- **Resource Leaks**: Exporters and connections remain open
- **Incomplete Traces**: Distributed traces may appear broken

### Shutdown with Timeout

For production applications, add a timeout to prevent hanging:

```go showLineNumbers
func gracefulShutdown(shutdown func(context.Context) error) {
    ctx, cancel := context.WithTimeout(
        context.Background(),
        5*time.Second,
    )
    defer cancel()

    if err := shutdown(ctx); err != nil {
        log.Printf("Failed to shutdown cleanly: %v", err)
    }
}
```

## Complete Examples

For production-ready reference implementations, explore our complete example applications:

### Go 1.19 + Gin + PostgreSQL Example

A complete REST API demonstrating OpenTelemetry instrumentation with older Go
versions:

**[go119-gin191-postgres](https://github.com/base-14/examples/tree/main/go/go119-gin191-postgres)**

**Stack:**

- Go 1.19.13 with OpenTelemetry v1.17.0
- Gin Framework v1.9.1 for HTTP routing
- PostgreSQL 14 with GORM ORM
- Custom GORM tracing implementation
- Logrus with trace correlation
- Docker Compose setup

**What's Instrumented:**

- ✅ HTTP requests and responses (Gin middleware)
- ✅ Database queries with custom GORM callbacks
- ✅ SQL operations (INSERT, SELECT, UPDATE, DELETE)
- ✅ Structured JSON logs with trace correlation
- ✅ Graceful shutdown handling
- ✅ Distributed trace propagation

**Key Features:**

- **Custom GORM Tracing**: Demonstrates how to instrument GORM without
  external plugins, compatible with older OpenTelemetry versions
- **Log Correlation**: Shows how to extract trace IDs and span IDs for
  structured logging with Logrus
- **Production Configuration**: Includes resource attributes, batch span
  processor, and OTLP exporter setup
- **Docker Deployment**: Complete docker-compose.yml with app, database, and
  OTel collector

**Implementation Highlights:**

```go
// Custom GORM callback tracing (internal/database/tracing.go)
func (g *gormTracer) before(operation string) func(*gorm.DB) {
    return func(db *gorm.DB) {
        ctx, span := tracer.Start(
            db.Statement.Context,
            operation,
            trace.WithSpanKind(trace.SpanKindClient),
            trace.WithAttributes(
                attribute.String("db.system", "postgresql"),
                attribute.String("db.name", db.Statement.Table),
            ),
        )
        db.Statement.Context = ctx
        db.InstanceSet("otel:span", span)
    }
}

// Log correlation (internal/logging/logger.go)
func WithContext(ctx context.Context) *logrus.Entry {
    spanCtx := trace.SpanContextFromContext(ctx)
    fields := logrus.Fields{
        "service.name": os.Getenv("OTEL_SERVICE_NAME"),
    }
    if spanCtx.IsValid() {
        fields["trace_id"] = spanCtx.TraceID().String()
        fields["span_id"] = spanCtx.SpanID().String()
    }
    return log.WithFields(fields)
}
```

**Quick Start:**

```bash
cd examples/go/go119-gin191-postgres
docker compose up --build
curl http://localhost:8080/api/users
```

### Go 1.25 + Chi + In-Memory Example

**[chi-inmemory](https://github.com/base-14/examples/tree/main/go/chi-inmemory)**

A modern Go application showcasing the latest OpenTelemetry features:

**Stack:**

- Go 1.25 (latest) with OpenTelemetry v1.38.0
- Chi router for lightweight HTTP routing
- In-memory storage (no external database)
- Native OpenTelemetry instrumentation
- Docker Compose setup

**What's Instrumented:**

- ✅ HTTP request tracing with Chi middleware
- ✅ Custom business logic spans
- ✅ Context propagation across handlers
- ✅ Metrics collection (request duration, counts)
- ✅ Error recording and status codes

**Key Features:**

- **Modern Go Patterns**: Demonstrates latest Go 1.25 features and
  OpenTelemetry v1.38.0
- **Lightweight Setup**: No database dependencies, focuses on HTTP
  instrumentation
- **Custom Middleware**: Shows how to build Chi middleware with
  OpenTelemetry
- **Metrics Export**: Includes both traces and metrics with OTLP

**Implementation Highlights:**

```go
// Chi middleware with OpenTelemetry
func TracingMiddleware(
    tracer trace.Tracer,
) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(
            func(w http.ResponseWriter, r *http.Request) {
                ctx, span := tracer.Start(
                    r.Context(),
                    r.Method+" "+r.URL.Path,
                    trace.WithSpanKind(trace.SpanKindServer),
                )
                defer span.End()

                span.SetAttributes(
                    attribute.String("http.method", r.Method),
                    attribute.String("http.route", r.URL.Path),
                )

                next.ServeHTTP(w, r.WithContext(ctx))

                span.SetAttributes(
                    attribute.Int("http.status_code", w.StatusCode),
                )
            })
    }
}
```

**Quick Start:**

```bash
cd examples/go/chi-inmemory
docker compose up --build
curl http://localhost:8080/api/health
```

### Example Comparison

| Feature | go119-gin191-postgres | chi-inmemory |
|---------|----------------------|-----------------|
| **Go Version** | 1.19.13 (EOL) | 1.25 (Latest) |
| **Framework** | Gin 1.9.1 | Chi (latest) |
| **Database** | PostgreSQL + GORM | In-memory |
| **OTel Version** | v1.17.0 | v1.38.0 |
| **Custom Tracing** | GORM callbacks | Chi middleware |
| **Log Correlation** | ✅ Logrus | Basic logging |
| **Use Case** | Legacy migrations | Modern greenfield |

### Using These Examples

**For Learning:**

1. Clone the examples repository
2. Start with `chi-inmemory` for modern patterns
3. Study `go119-gin191-postgres` for database instrumentation

**For Production:**

1. Use `go119-gin191-postgres` as reference for:
   - Custom ORM tracing patterns
   - Log correlation implementation
   - Graceful shutdown handling
2. Use `chi-inmemory` as reference for:
   - Modern Go instrumentation
   - Lightweight HTTP services
   - Metrics collection

**For Migrations:**

- If upgrading from Go 1.19: Compare both examples to see API changes
- If adding observability to existing apps: Start with framework-specific
  patterns from these examples

## Database Instrumentation Patterns

### GORM Custom Tracing

For applications using GORM, implement custom callbacks for comprehensive
database tracing:

```go showLineNumbers title="database/tracing.go"
package database

import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/codes"
    "go.opentelemetry.io/otel/trace"
    "gorm.io/gorm"
)

var tracer = otel.Tracer("gorm")

// RegisterCallbacks registers GORM callbacks for all CRUD operations
func RegisterCallbacks(db *gorm.DB) error {
    callbacks := &gormTracer{}

    // Register before/after callbacks for each operation
    operations := []string{"create", "query", "update", "delete"}
    for _, op := range operations {
        if err := db.Callback().Create().Before("gorm:"+op).
            Register("otel:before", callbacks.before("gorm:"+op)); err != nil {
            return err
        }
        if err := db.Callback().Create().After("gorm:"+op).
            Register("otel:after", callbacks.after()); err != nil {
            return err
        }
    }

    return nil
}

type gormTracer struct{}

func (g *gormTracer) before(operation string) func(*gorm.DB) {
    return func(db *gorm.DB) {
        ctx := db.Statement.Context
        if ctx == nil {
            return
        }

        ctx, span := tracer.Start(ctx, operation,
            trace.WithSpanKind(trace.SpanKindClient),
            trace.WithAttributes(
                attribute.String("db.system", "postgresql"),
                attribute.String("db.name", db.Statement.Table),
            ),
        )

        db.Statement.Context = ctx
        db.InstanceSet("otel:span", span)
    }
}

func (g *gormTracer) after() func(*gorm.DB) {
    return func(db *gorm.DB) {
        spanInterface, ok := db.InstanceGet("otel:span")
        if !ok {
            return
        }

        span := spanInterface.(trace.Span)
        defer span.End()

        // Add SQL query details
        if db.Statement.SQL.String() != "" {
            span.SetAttributes(
                attribute.String("db.statement", db.Statement.SQL.String()),
            )
        }

        span.SetAttributes(
            attribute.Int64("db.rows_affected", db.Statement.RowsAffected),
            attribute.String("db.sql.table", db.Statement.Table),
        )

        // Record errors
        if db.Error != nil && db.Error != gorm.ErrRecordNotFound {
            span.RecordError(db.Error)
            span.SetStatus(codes.Error, db.Error.Error())
        } else {
            span.SetStatus(codes.Ok, "")
        }
    }
}
```

**See the complete implementation:**
[go119-gin191-postgres/internal/database/tracing.go](https://github.com/base-14/examples/blob/main/go/go119-gin191-postgres/internal/database/tracing.go)

### Structured Logging with Trace Correlation

Integrate OpenTelemetry trace context with structured logging:

```go showLineNumbers title="logging/logger.go"
package logging

import (
    "context"
    "os"

    "github.com/sirupsen/logrus"
    "go.opentelemetry.io/otel/trace"
)

var log = logrus.New()

func init() {
    log.SetFormatter(&logrus.JSONFormatter{})
    log.SetOutput(os.Stdout)
    log.SetLevel(logrus.InfoLevel)
}

// WithContext creates a log entry with trace correlation
func WithContext(ctx context.Context) *logrus.Entry {
    spanCtx := trace.SpanContextFromContext(ctx)

    fields := logrus.Fields{
        "service.name": os.Getenv("OTEL_SERVICE_NAME"),
    }

    if spanCtx.IsValid() {
        fields["trace_id"] = spanCtx.TraceID().String()
        fields["span_id"] = spanCtx.SpanID().String()
        fields["trace_flags"] = spanCtx.TraceFlags().String()
    }

    return log.WithFields(fields)
}

// WithFields creates a log entry with custom fields and trace correlation
func WithFields(ctx context.Context, fields map[string]interface{}) *logrus.Entry {
    entry := WithContext(ctx)
    return entry.WithFields(fields)
}

// Usage in handlers
func CreateUser(ctx context.Context, user User) error {
    logging.WithContext(ctx).Info("Creating user in database")

    if err := db.Create(&user).Error; err != nil {
        logging.WithFields(ctx, map[string]interface{}{
            "error": err.Error(),
        }).Error("Failed to create user")
        return err
    }

    logging.WithFields(ctx, map[string]interface{}{
        "user.id": user.ID,
    }).Info("User created successfully")

    return nil
}
```

**See the complete implementation:**
[go119-gin191-postgres/internal/logging/logger.go](https://github.com/base-14/examples/blob/main/go/go119-gin191-postgres/internal/logging/logger.go)

## References

- [Official OpenTelemetry Go Documentation](https://opentelemetry.io/docs/languages/go/)
- [OpenTelemetry Go GitHub](https://github.com/open-telemetry/opentelemetry-go)
- [Go Examples Repository](https://github.com/base-14/examples/tree/main/go)
  - [go119-gin191-postgres](https://github.com/base-14/examples/tree/main/go/go119-gin191-postgres)
  - [chi-inmemory](https://github.com/base-14/examples/tree/main/go/chi-inmemory)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up Scout Collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
- [Custom Java Instrumentation](./java.md) - Alternative language guide
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for your telemetry data
