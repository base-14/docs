---
title: Java Custom OpenTelemetry Instrumentation | base14 Scout
description: Custom instrumentation for Java applications with OpenTelemetry. Manual tracing, metrics, spans, and telemetry export with Java OTel SDK.
keywords: [java instrumentation, java monitoring, opentelemetry java, java custom instrumentation, java observability]
---

# Java

Implement OpenTelemetry custom instrumentation for `Java` applications to
collect metrics, and traces using the Java OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/java/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for `Java`
- Configure manual tracing using spans
- Create and manage custom metrics
- Add semantic attributes and events
- Export telemetry data to Scout Collector


## Prerequisites

Before starting, ensure you have:

- Java 8 or later installed
- A Java project set up with Maven or Gradle

## Required Dependencies

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="build-tool">
<TabItem value="maven" label="Maven">

Add the following dependencies to your `pom.xml`:

```xml showLineNumbers
<dependencies>
  <!-- OpenTelemetry API -->
  <dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
    <version>1.32.0</version>
  </dependency>

  <!-- OpenTelemetry SDK -->
  <dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-sdk</artifactId>
    <version>1.32.0</version>
  </dependency>

  <!-- OpenTelemetry OTLP exporter -->
  <dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
    <version>1.32.0</version>
  </dependency>

  <!-- OpenTelemetry semantic conventions -->
  <dependency>
    <groupId>io.opentelemetry.semconv</groupId>
    <artifactId>opentelemetry-semconv</artifactId>
    <version>1.23.1-alpha</version>
  </dependency>
</dependencies>
```

</TabItem>
<TabItem value="gradle" label="Gradle">

Add the following dependencies to your `build.gradle`:

```gradle showLineNumbers
dependencies {
    implementation 'io.opentelemetry:opentelemetry-api:1.32.0'
    implementation 'io.opentelemetry:opentelemetry-sdk:1.32.0'
    implementation 'io.opentelemetry:opentelemetry-exporter-otlp:1.32.0'
    implementation 'io.opentelemetry:opentelemetry-semconv:1.23.1-alpha'
}
```

</TabItem>
</Tabs>

## Initialization

To start collecting telemetry data, you need to initialize OpenTelemetry with both tracing and metrics capabilities in a single setup.

> A Resource is an immutable representation of the entity producing telemetry.
> For example, a process producing telemetry that is running in a container on
> Kubernetes has a Pod name, it is in a namespace and possibly is part of a
> Deployment which also has a name. All three of these attributes can
> be included in the Resource.

Sample Reference code for OpenTelemetry Initialization

```java showLineNumbers
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.metrics.Meter;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.exporter.otlp.metrics.OtlpGrpcMetricExporter;
import io.opentelemetry.exporter.otlp.trace.OtlpGrpcSpanExporter;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.metrics.export.PeriodicMetricReader;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import java.time.Duration;

public class OpenTelemetrySetup {

    public static OpenTelemetry setupOpenTelemetry() {
        // Create resource with service information
        Resource resource = Resource.getDefault()
                .merge(Resource.create(Attributes.of(
                        AttributeKey.stringKey("service.name"), "my.service.name",
                        AttributeKey.stringKey("service.version"), "1.0.0"
                )));

        // Create OTLP trace exporter
        OtlpGrpcSpanExporter spanExporter = OtlpGrpcSpanExporter.builder()
                .setEndpoint("http://0.0.0.0:4317")
                .build();

        // Create tracer provider
        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
                .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
                .setResource(resource)
                .build();

        // Create OTLP metric exporter
        OtlpGrpcMetricExporter metricExporter = OtlpGrpcMetricExporter.builder()
                .setEndpoint("http://0.0.0.0:4317")
                .build();

        // Create meter provider
        SdkMeterProvider meterProvider = SdkMeterProvider.builder()
                .setResource(resource)
                .registerMetricReader(PeriodicMetricReader.builder(metricExporter)
                        .setInterval(Duration.ofSeconds(5))
                        .build())
                .build();

        // Create OpenTelemetry SDK with both providers and register it globally
        OpenTelemetry openTelemetry = OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .setMeterProvider(meterProvider)
                .buildAndRegisterGlobal();

        return openTelemetry;
    }

    public static Tracer getTracer() {
        return GlobalOpenTelemetry.getTracer("my.tracer.name");
    }

    public static Meter getMeter() {
        return GlobalOpenTelemetry.getMeter("my.meter.name");
    }
}
```

> Ensure OpenTelemetrySetup.setupOpenTelemetry() is called before using 
> these helper classes, as they access the global OpenTelemetry instance during class

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single
database or a sophisticated mesh of services, traces are essential to
understanding the full "path" a request takes in your application.

#### Reference

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

### Span

A span represents a unit of work or operation. Spans are the building blocks of
Traces. In OpenTelemetry, they include some necessary information.

#### Creating a Span

```java showLineNumbers
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        // do some work that 'span' tracks
        System.out.println("doing some work...");
    } finally {
        span.end();
    }
}
```

#### Creating nested Spans

```java showLineNumbers
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span parent = tracer.spanBuilder("parent").startSpan();
    try (Scope parentScope = parent.makeCurrent()) {
        // do some work that 'parent' tracks
        System.out.println("doing some work...");

        // Create a nested span to track nested work
        Span child = tracer.spanBuilder("child").startSpan();
        try (Scope childScope = child.makeCurrent()) {
            // do some work that 'child' tracks
            System.out.println("doing some nested work...");
        } finally {
            child.end();
        }
    } finally {
        parent.end();
    }
}
```

#### Creating Spans with helper methods

```java showLineNumbers
import java.util.function.Supplier;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;

public class SpanHelper {
    private static final Tracer tracer = OpenTelemetrySetup.getTracer();

    public static <T> T withSpan(String spanName, Supplier<T> operation) {
        Span span = tracer.spanBuilder(spanName).startSpan();
        try (Scope scope = span.makeCurrent()) {
            return operation.get();
        } finally {
            span.end();
        }
    }

    public static void withSpan(String spanName, Runnable operation) {
        Span span = tracer.spanBuilder(spanName).startSpan();
        try (Scope scope = span.makeCurrent()) {
            operation.run();
        } finally {
            span.end();
        }
    }
}

// Usage
SpanHelper.withSpan("work.operation", () -> {
    System.out.println("doing some work...");
});
```

> View these spans in base14 Scout observability backend.

#### Reference

[Official Span Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#spans)

### Attributes

Attributes let you attach key/value pairs to a span so it carries more
information about the current operation that it's tracking.

#### Adding Attributes to a Span

```java showLineNumbers
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import java.util.Arrays;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAllAttributes(Attributes.of(
            AttributeKey.longKey("operation.value"), 1L,
            AttributeKey.stringKey("operation.name"), "Saying hello!",
            AttributeKey.stringArrayKey("operation.other-stuff"), Arrays.asList("1", "2", "3")
        ));

        System.out.println("doing some work...");
    } finally {
        span.end();
    }
}
```

#### Adding Semantic Attributes to a Span

Semantic Attributes are pre-defined Attributes that are well-known naming
conventions for common kinds of data.
Using Semantic Attributes lets you normalize this kind of information across
your systems.

```java showLineNumbers
import io.opentelemetry.semconv.trace.attributes.SemanticAttributes;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAllAttributes(Attributes.of(
            SemanticAttributes.HTTP_REQUEST_METHOD, "GET",
            SemanticAttributes.URL_FULL, "https://base14.io/",
            SemanticAttributes.HTTP_RESPONSE_STATUS_CODE, 200L
        ));

        System.out.println("doing some work...");
    } finally {
        span.end();
    }
}
```

> View these spans in the base14 Scout observability platform.
>
> **Note**: Ensure your Scout Collector is properly configured to
> receive and process the span data.

#### Reference

[Official Attributes Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#attributes)

### Events

An event is a human-readable message on a span that represents "something
happening" during its lifetime.

You can think of it as a primitive log.

#### Adding an event to a span

```java showLineNumbers
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.addEvent("Starting some work");
        System.out.println("doing some work...");
        span.addEvent("Finished working");
    } finally {
        span.end();
    }
}
```

#### Adding events with attributes

```java showLineNumbers
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Tracer;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.addEvent("Processing request", Attributes.of(
            AttributeKey.stringKey("user.id"), "12345",
            AttributeKey.stringKey("request.type"), "api"
        ));

        System.out.println("doing some work...");
    } finally {
        span.end();
    }
}
```

#### Reference

[Official Event Documentation](https://opentelemetry.io/docs/concepts/signals/traces/#span-events)

### Span Status

A Status can be set on a Span, typically used to specify that a Span has not
completed successfully - `Error`.
By default, all spans are Unset, which means a span completed without error. The
`Ok` status is reserved for when you need to explicitly mark a span as successful
rather than stick with the default of `Unset` (i.e., "without error").

We also look at how to record an exception in the Span.

#### Setting a Span Status

```java showLineNumbers
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Tracer;

public void doWork() {
    Tracer tracer = OpenTelemetrySetup.getTracer();

    Span span = tracer.spanBuilder("span.name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        try {
            // Simulate work that might fail
            someOperation();

            // Explicitly mark as successful (optional)
            span.setStatus(StatusCode.OK, "Operation completed successfully");
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, "Operation failed");
            span.recordException(e, Attributes.of(
                AttributeKey.stringKey("error.type"), "operation_error"
            ));
        }
    } finally {
        span.end();
    }
}

private void someOperation() throws Exception {
    // simulate an operation that might fail
}
```

> View these spans in the base14 Scout observability platform.
>
> **Note**: Ensure your Scout Collector is properly configured to
> receive and process the span data.

## Metrics

Metrics are essential for monitoring the performance and health of your application over time.

### Counter

Counter is a synchronous Instrument that supports non-negative increments.

#### Creating a Synchronous Counter

```java showLineNumbers
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;

public class CounterExample {
    private static final Meter meter = OpenTelemetrySetup.getMeter();
    private static final LongCounter workCounter = meter
            .counterBuilder("work.counter")
            .setDescription("Counts the amount of work done")
            .setUnit("1")
            .build();

    public static void doWork(String workType) {
        workCounter.add(1, Attributes.of(
            AttributeKey.stringKey("work.type"), workType
        ));
        System.out.println("doing some work...");
    }
}
```

> View these metrics in base14 Scout observability backend.

#### Creating Asynchronous Counter

```java showLineNumbers
import io.opentelemetry.api.metrics.ObservableLongCounter;
import java.util.Random;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;

public class AsyncCounterExample {
    private static final Meter meter = OpenTelemetrySetup.getMeter();
    private static final Random random = new Random();

    public static void setupAsyncCounter() {
        ObservableLongCounter counter = meter
                .counterBuilder("process.page.faults")
                .setDescription("process page faults")
                .setUnit("1")
                .buildWithCallback(measurement -> {
                    // Simulate getting process stats
                    measurement.record(8, Attributes.of(
                        AttributeKey.longKey("pid"), 0L,
                        AttributeKey.longKey("bitness"), 64L
                    ));
                    measurement.record(37741921, Attributes.of(
                        AttributeKey.longKey("pid"), 4L,
                        AttributeKey.longKey("bitness"), 64L
                    ));
                    measurement.record(10465, Attributes.of(
                        AttributeKey.longKey("pid"), 880L,
                        AttributeKey.longKey("bitness"), 32L
                    ));
                });
    }
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

```java showLineNumbers
import io.opentelemetry.api.metrics.LongHistogram;

public class HistogramExample {
    private static final Meter meter = OpenTelemetrySetup.getMeter();
    private static final LongHistogram httpServerDuration = meter
            .histogramBuilder("http.server.duration")
            .setDescription("measures the duration of the inbound HTTP request")
            .setUnit("ms")
            .ofLongs()
            .build();

    public static void recordDuration(long duration, String method, String scheme) {
        httpServerDuration.record(duration);
    }

    // Usage example
    public static void handleRequest() {
        long start = System.currentTimeMillis();

        // Handle request logic here...

        long duration = System.currentTimeMillis() - start;
        recordDuration(duration, "POST", "https");
    }
}
```

> View these metrics in base14 Scout observability backend.

#### Reference

[Official Histogram Documentation](https://opentelemetry.io/docs/specs/otel/metrics/api/#histogram)

### Gauge

Gauge is an asynchronous Instrument that reports non-additive values
that can increase and decrease over time.

#### Creating an Observable Gauge

```java showLineNumbers
import io.opentelemetry.api.metrics.ObservableLongGauge;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;

public class GaugeExample {
    private static final Meter meter = OpenTelemetrySetup.getMeter();

    public static void setupGauge() {
        ObservableLongGauge gauge = meter
                .gaugeBuilder("system.cpu.usage")
                .setDescription("Current CPU usage percentage")
                .setUnit("%")
                .ofLongs()
                .buildWithCallback(measurement -> {
                    // Get current CPU usage (simulated)
                    long cpuUsage = getCurrentCPUUsage();
                    measurement.record(cpuUsage, Attributes.of(
                        AttributeKey.stringKey("cpu.core"), "0"
                    ));
                });
    }

    private static long getCurrentCPUUsage() {
        // Simulate getting CPU usage
        return 75; // 75% CPU usage
    }
}
```

> View all telemetry data in the base14 Scout observability platform.

## Extracting Trace and Span IDs

You can extract trace and span IDs from the current context for correlation with logs or external systems:

```java showLineNumbers
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.context.Scope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import io.opentelemetry.api.trace.Tracer;

public class TraceContextExtractor {

    public static String[] getTraceAndSpanIDs() {
        Span currentSpan = Span.current();
        SpanContext spanContext = currentSpan.getSpanContext();

        if (spanContext.isValid()) {
            String traceId = spanContext.getTraceId();
            String spanId = spanContext.getSpanId();
            return new String[]{traceId, spanId};
        }
        return new String[]{"", ""};
    }

    // Usage example
    public static void doWork() {
        Tracer tracer = OpenTelemetrySetup.getTracer();

        Span span = tracer.spanBuilder("work.operation").startSpan();
        try (Scope scope = span.makeCurrent()) {
            String[] ids = getTraceAndSpanIDs();
            String traceId = ids[0];
            String spanId = ids[1];

            // Use trace and span IDs for logging or correlation
            System.out.printf("TraceID: %s, SpanID: %s%n", traceId, spanId);

            // Example: Add to structured logs
            Logger logger = LoggerFactory.getLogger(TraceContextExtractor.class);
            logger.info("Processing request - TraceID: {}, SpanID: {}", traceId, spanId);
        } finally {
            span.end();
        }
    }
}
```

This is particularly useful for:
- Correlating application logs with traces
- Adding trace context to error messages
- Integrating with external monitoring systems
- Creating custom dashboards with trace correlation

## References

- [Official OpenTelemetry Java Documentation](https://opentelemetry.io/docs/languages/java/instrumentation/)
- [OpenTelemetry API Documentation](https://opentelemetry.io/docs/reference/specification/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/semantic-conventions/)