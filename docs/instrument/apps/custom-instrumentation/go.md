---
title: Go Custom OpenTelemetry Instrumentation
sidebar_label: Go
description:
  Custom instrumentation for Go applications with OpenTelemetry. Manual tracing,
  metrics, spans, and telemetry export with Go OTel SDK.
keywords:
  [
    go instrumentation,
    golang monitoring,
    opentelemetry go,
    go custom instrumentation,
    golang observability,
  ]
---

# Go

Implement OpenTelemetry custom instrumentation for `Go` applications to collect
metrics, and traces using the Go OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/go/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for `Go`
- Configure manual tracing using spans
- Create and manage custom metrics
- Add semantic attributes and events
- Export telemetry data to Scout Collector

## Prerequisites

Before starting, ensure you have:

- Go 1.23.5 or later installed
- A Go project set up with `go mod init`

## Required Packages

Install the following necessary packages

```bash
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

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single database or a
sophisticated mesh of services, traces are essential to understanding the full
"path" a request takes in your application.

### Initialization

To Start tracing, first a tracer should be acquired and a TracerProvider should
be initialized optionally we can pass a resource to TracerProvider.

> A Resource is an immutable representation of the entity producing telemetry.
> For example, a process producing telemetry that is running in a container on
> Kubernetes has a Pod name, it is in a namespace and possibly is part of a
> Deployment which also has a name. All three of these attributes can be
> included in the Resource.

Sample Reference code for Initialization

```go showLineNumbers
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
            semconv.ServiceName("my.service.name"),
            semconv.ServiceVersion("1.0.0"),
        ))
    if err != nil {
        return nil, err
    }

    // Create OTLP trace exporter
    traceExporter, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpointURL("http://0.0.0.0:4318/v1/traces"),
        otlptracehttp.WithInsecure(),
    )
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
    tracer := otel.Tracer("my.tracer.name")
    return tracer, nil
}
```

> View your traces in the base14 Scout observability platform.
>
> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the trace data.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Span

A span represents a unit of work or operation. Spans are the building blocks of
Traces. In OpenTelemetry, they include some necessary information.

#### Creating a Span

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    // do some work that 'span' tracks
    fmt.Println("doing some work...")
}
```

#### Creating nested Spans

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

#### Creating Spans with helper functions

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

> View these spans in base14 Scout observability backend.

#### Reference

[Official Span Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#spans)

### Attributes

Attributes let you attach key/value pairs to a span so it carries more
information about the current operation that it's tracking.

#### Adding Attributes to a Span

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

#### Adding Semantic Attributes to a Span

Semantic Attributes are pre-defined Attributes that are well-known naming
conventions for common kinds of data. Using Semantic Attributes lets you
normalize this kind of information across your systems.

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

> View these spans in the base14 Scout observability platform.
>
> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the span data.

#### Reference

[Official Attributes Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#attributes)

### Events

An event is a human-readable message on a span that represents "something
happening" during its lifetime.

You can think of it as a primitive log.

#### Adding an event to a span

```go showLineNumbers
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "span.name")
    defer span.End()

    span.AddEvent("Starting some work")
    fmt.Println("doing some work...")
    span.AddEvent("Finished working")
}
```

#### Adding events with attributes

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

#### Reference

[Official Event Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)

### Span Status

A Status can be set on a Span, typically used to specify that a Span has not
completed successfully - `Error`. By default, all spans are Unset, which means a
span completed without error. The `Ok` status is reserved for when you need to
explicitly mark a span as successful rather than stick with the default of
`Unset` (i.e., "without error").

We also look at how to record an exception in the Span.

#### Setting a Span Status

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

> View these spans in the base14 Scout observability platform.
>
> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the span data.

## Metrics

### Initialization

To start collecting metrics, you'll need to initialize a MeterProvider and
optionally set it as the global default.

Sample Reference code for Metrics Initialization

```go showLineNumbers
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
            semconv.ServiceName("my.service.name"),
        ))
    if err != nil {
        return nil, err
    }

    // Create OTLP metric exporter
    metricExporter, err := otlpmetrichttp.New(ctx,
        otlpmetrichttp.WithEndpointURL("http://0.0.0.0:4318/v1/metrics"),
        otlpmetrichttp.WithInsecure(),
    )
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
    meter := otel.Meter("my.meter.name")
    return meter, nil
}
```

> View these metrics in base14 Scout observability backend.
>
> **Note**: Ensure your Scout Collector is properly configured to receive and
> process the metric data.

### Counter

Counter is a synchronous Instrument that supports non-negative increments.

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

> View these metrics in base14 Scout observability backend.

#### Creating Asynchronous Counter

```go showLineNumbers
func setupAsyncCounter(meter metric.Meter) error {
    _, err := meter.Int64ObservableCounter(
        "process.page.faults",
        metric.WithDescription("process page faults"),
        metric.WithUnit("1"),
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

> View these metrics in base14 Scout observability backend.

#### Reference

[Official Counter Documentation](https://opentelemetry.io/docs/specs/otel/metrics/api/#counter)

### Histogram

Histogram is a synchronous Instrument that can be used to report arbitrary
values that are likely to be statistically meaningful. It is intended for
statistics such as histograms, summaries, and percentile.

#### Creating a Histogram

```go showLineNumbers
import (
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

> View these metrics in base14 Scout observability backend.

#### Reference

[Official Histogram Documentation](https://opentelemetry.io/docs/specs/otel/metrics/api/#histogram)

### Gauge

Gauge is an asynchronous Instrument that reports non-additive values that can
increase and decrease over time.

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

> View all telemetry data in the base14 Scout observability platform.

## Extracting Trace and Span IDs

You can extract trace and span IDs from the current context for correlation with
logs or external systems:

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

// Usage example
func doWork(ctx context.Context, tracer trace.Tracer) {
    ctx, span := tracer.Start(ctx, "work.operation")
    defer span.End()

    traceID, spanID := getTraceAndSpanIDs(ctx)

    // Use trace and span IDs for logging or correlation
    fmt.Printf("TraceID: %s, SpanID: %s\n", traceID, spanID)

    // Example: Add to structured logs
    log.Printf("Processing request - TraceID: %s, SpanID: %s", traceID, spanID)
}
```

This is particularly useful for:

- Correlating application logs with traces
- Adding trace context to error messages
- Integrating with external monitoring systems
- Creating custom dashboards with trace correlation

## References

- [Official OpenTelemetry Go Documentation](https://opentelemetry.io/docs/languages/go/instrumentation/)
- [Sample Go application with Otel instrumentation here](https://github.com/base-14/examples/tree/main/go)
- [OpenTelemetry API Documentation](https://opentelemetry.io/docs/reference/specification/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/semantic-conventions/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment
- [Custom Java Instrumentation](./java.md) - Alternative language guide
