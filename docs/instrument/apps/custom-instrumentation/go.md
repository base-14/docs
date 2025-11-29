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

## Prerequisites

Before starting, ensure you have:

- **Go 1.21 or later** installed (Go 1.23+ recommended)
- A Go project initialized with `go mod init`
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

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

## References

- [Official OpenTelemetry Go Documentation](https://opentelemetry.io/docs/languages/go/)
- [OpenTelemetry Go GitHub](https://github.com/open-telemetry/opentelemetry-go)
- [Sample Go Application with OpenTelemetry](https://github.com/base-14/examples/tree/main/go)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up Scout Collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
- [Custom Java Instrumentation](./java.md) - Alternative language guide
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for your telemetry data
