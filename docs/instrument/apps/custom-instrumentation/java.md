---
title: Java Custom OpenTelemetry Instrumentation - Manual Tracing Guide | base14 Scout
sidebar_label: Java
sidebar_position: 3
description:
  Custom instrumentation for Java applications with OpenTelemetry. Manual
  tracing, spans, metrics, and telemetry export with Java OpenTelemetry SDK.
keywords:
  [
    java instrumentation,
    java opentelemetry,
    java custom instrumentation,
    java tracing,
    java observability,
    java distributed tracing,
    java manual instrumentation,
    opentelemetry java sdk,
  ]
---

# Java

Implement OpenTelemetry custom instrumentation for Java applications to collect
traces, metrics, and logs using the Java OpenTelemetry SDK. This guide covers
manual instrumentation for any Java application, including Spring, Micronaut,
Quarkus, servlets, and custom frameworks.

> **Note:** This guide provides a practical overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry Java documentation](https://opentelemetry.io/docs/languages/java/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK for manual instrumentation
- Create and manage custom spans
- Add attributes, events, and exception tracking
- Implement metrics collection
- Propagate context across service boundaries
- Instrument common Java patterns and frameworks

## Prerequisites

Before starting, ensure you have:

- **Java 8 or later** installed (Java 11+ recommended)
- **Maven or Gradle** for dependency management
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

## Required Dependencies

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="build-tool">
<TabItem value="maven" label="Maven">
```

Add the following dependencies to your `pom.xml`:

```xml showLineNumbers title="pom.xml"
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

```mdx-code-block
</TabItem>
<TabItem value="gradle" label="Gradle">
```

Add the following dependencies to your `build.gradle`:

```gradle showLineNumbers title="build.gradle"
dependencies {
    implementation 'io.opentelemetry:opentelemetry-api:1.32.0'
    implementation 'io.opentelemetry:opentelemetry-sdk:1.32.0'
    implementation 'io.opentelemetry:opentelemetry-exporter-otlp:1.32.0'
    implementation 'io.opentelemetry.semconv:opentelemetry-semconv:1.23.1-alpha'
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Traces

Traces provide a complete picture of request flows through your application,
from initial request to final response, including all operations and services
involved.

### Initialization

Initialize the OpenTelemetry SDK with resource information and exporters:

```java showLineNumbers title="OpenTelemetryConfig.java"
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
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

import java.time.Duration;

public class OpenTelemetryConfig {

    private static final String SERVICE_NAME = "my-java-app";
    private static final String SERVICE_VERSION = "1.0.0";

    public static OpenTelemetry initializeOpenTelemetry() {
        // Create resource with service information
        Resource resource = Resource.getDefault()
                .merge(Resource.create(Attributes.of(
                        AttributeKey.stringKey("service.name"), SERVICE_NAME,
                        AttributeKey.stringKey("service.version"), SERVICE_VERSION,
                        AttributeKey.stringKey("deployment.environment"), "production"
                )));

        // Create OTLP trace exporter
        OtlpGrpcSpanExporter spanExporter = OtlpGrpcSpanExporter.builder()
                .setEndpoint("http://localhost:4317")
                .build();

        // Create tracer provider
        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
                .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
                .setResource(resource)
                .build();

        // Create OTLP metric exporter
        OtlpGrpcMetricExporter metricExporter = OtlpGrpcMetricExporter.builder()
                .setEndpoint("http://localhost:4317")
                .build();

        // Create meter provider
        SdkMeterProvider meterProvider = SdkMeterProvider.builder()
                .setResource(resource)
                .registerMetricReader(PeriodicMetricReader.builder(metricExporter)
                        .setInterval(Duration.ofSeconds(5))
                        .build())
                .build();

        // Build and register OpenTelemetry SDK globally
        OpenTelemetry openTelemetry = OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .setMeterProvider(meterProvider)
                .buildAndRegisterGlobal();

        // Add shutdown hook
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            tracerProvider.close();
            meterProvider.close();
        }));

        return openTelemetry;
    }

    public static Tracer getTracer() {
        return GlobalOpenTelemetry.getTracer(SERVICE_NAME, SERVICE_VERSION);
    }

    public static Meter getMeter() {
        return GlobalOpenTelemetry.getMeter(SERVICE_NAME, SERVICE_VERSION);
    }
}
```

> **Note**: Ensure your Scout Collector is properly configured to receive trace
> data at the endpoint specified above.

### Creating Spans

Create a span to track an operation:

```java showLineNumbers
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

public void doWork() {
    Tracer tracer = OpenTelemetryConfig.getTracer();

    Span span = tracer.spanBuilder("operation-name").startSpan();
    try (Scope scope = span.makeCurrent()) {
        // Perform your operation
        performWork();
    } finally {
        span.end();
    }
}
```

### Creating Nested Spans

Create parent-child span relationships:

```java showLineNumbers
public void processRequest() {
    Tracer tracer = OpenTelemetryConfig.getTracer();

    Span parentSpan = tracer.spanBuilder("process_request").startSpan();
    try (Scope parentScope = parentSpan.makeCurrent()) {

        // Validate input
        Span validateSpan = tracer.spanBuilder("validate_input").startSpan();
        try (Scope validateScope = validateSpan.makeCurrent()) {
            validateInput();
        } finally {
            validateSpan.end();
        }

        // Fetch data
        Span fetchSpan = tracer.spanBuilder("fetch_data").startSpan();
        try (Scope fetchScope = fetchSpan.makeCurrent()) {
            fetchFromDatabase();
        } finally {
            fetchSpan.end();
        }

        // Process results
        Span processSpan = tracer.spanBuilder("process_data").startSpan();
        try (Scope processScope = processSpan.makeCurrent()) {
            processResults();
        } finally {
            processSpan.end();
        }

    } finally {
        parentSpan.end();
    }
}
```

### Helper Methods for Cleaner Code

```java showLineNumbers
import java.util.function.Supplier;

public class SpanHelper {
    private static final Tracer tracer = OpenTelemetryConfig.getTracer();

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
String result = SpanHelper.withSpan("database_query", () -> {
    return database.query("SELECT * FROM users");
});
```

## Attributes

Attributes add context to spans as key-value pairs:

### Adding Custom Attributes

```java showLineNumbers
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;

public void processOrder(String orderId) {
    Span span = tracer.spanBuilder("process_order").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAttribute("order.id", orderId);
        span.setAttribute("order.status", "processing");
        span.setAttribute("order.items_count", 5);

        // Process the order
        Order order = processOrder(orderId);

        span.setAttribute("order.total", order.getTotal());
        span.setAttribute("order.status", "completed");

    } finally {
        span.end();
    }
}
```

### Using Semantic Conventions

Use standardized attribute names for common operations:

```java showLineNumbers
import io.opentelemetry.semconv.trace.attributes.SemanticAttributes;

public void makeHttpRequest(String url, String method) {
    Span span = tracer.spanBuilder("http_request").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAttribute(SemanticAttributes.HTTP_REQUEST_METHOD, method);
        span.setAttribute(SemanticAttributes.URL_FULL, url);

        // Make HTTP request
        HttpResponse response = httpClient.send(url, method);

        span.setAttribute(SemanticAttributes.HTTP_RESPONSE_STATUS_CODE,
                         response.getStatusCode());

    } finally {
        span.end();
    }
}
```

## Events

Events mark significant moments during a span's lifetime:

```java showLineNumbers
public void processPayment(PaymentInfo payment) {
    Span span = tracer.spanBuilder("process_payment").startSpan();
    try (Scope scope = span.makeCurrent()) {

        span.addEvent("payment_received", Attributes.of(
            AttributeKey.stringKey("payment.method"), payment.getMethod(),
            AttributeKey.doubleKey("payment.amount"), payment.getAmount()
        ));

        // Process payment
        PaymentResult result = chargeCard(payment);

        span.addEvent("payment_processed", Attributes.of(
            AttributeKey.stringKey("transaction.id"), result.getTransactionId(),
            AttributeKey.stringKey("payment.status"), result.getStatus()
        ));

        if (result.isSuccess()) {
            span.addEvent("payment_confirmed");
        }

    } finally {
        span.end();
    }
}
```

## Exception Recording

Capture and record exceptions in spans:

```java showLineNumbers
import io.opentelemetry.api.trace.StatusCode;

public void riskyOperation() {
    Span span = tracer.spanBuilder("risky_operation").startSpan();
    try (Scope scope = span.makeCurrent()) {

        performRiskyWork();
        span.setStatus(StatusCode.OK);

    } catch (Exception e) {
        span.recordException(e, Attributes.of(
            AttributeKey.stringKey("exception.escaped"), "true"
        ));
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw new RuntimeException("Operation failed", e);

    } finally {
        span.end();
    }
}
```

## Metrics

Collect custom metrics to track application performance:

### Counter

Track cumulative values that only increase:

```java showLineNumbers
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;

public class MetricsExample {
    private static final Meter meter = OpenTelemetryConfig.getMeter();

    private static final LongCounter requestCounter = meter
            .counterBuilder("http.requests")
            .setDescription("Total number of HTTP requests")
            .setUnit("requests")
            .build();

    public void handleRequest(String method, String route) {
        requestCounter.add(1, Attributes.of(
            AttributeKey.stringKey("http.method"), method,
            AttributeKey.stringKey("http.route"), route
        ));

        // Handle request...
    }
}
```

### Histogram

Record distributions of values:

```java showLineNumbers
import io.opentelemetry.api.metrics.LongHistogram;

public class RequestDurationTracker {
    private static final LongHistogram requestDuration = meter
            .histogramBuilder("http.request.duration")
            .setDescription("HTTP request duration")
            .setUnit("ms")
            .ofLongs()
            .build();

    public void trackRequest(String method, int statusCode) {
        long startTime = System.currentTimeMillis();

        try {
            // Process request
            processRequest();
        } finally {
            long duration = System.currentTimeMillis() - startTime;

            requestDuration.record(duration, Attributes.of(
                AttributeKey.stringKey("http.method"), method,
                AttributeKey.longKey("http.status_code"), statusCode
            ));
        }
    }
}
```

### Gauge

Track values that can increase or decrease:

```java showLineNumbers
import io.opentelemetry.api.metrics.ObservableLongGauge;

public class GaugeExample {
    private static volatile long activeConnections = 0;

    public static void setupGauge() {
        ObservableLongGauge gauge = meter
                .gaugeBuilder("db.connections.active")
                .setDescription("Currently active database connections")
                .setUnit("connections")
                .ofLongs()
                .buildWithCallback(measurement -> {
                    measurement.record(activeConnections, Attributes.of(
                        AttributeKey.stringKey("db.type"), "postgresql"
                    ));
                });
    }

    public static void incrementConnections() {
        activeConnections++;
    }

    public static void decrementConnections() {
        activeConnections--;
    }
}
```

## Context Propagation

Propagate trace context across HTTP requests:

### Outgoing HTTP Requests

```java showLineNumbers
import io.opentelemetry.context.propagation.TextMapSetter;
import java.net.http.HttpRequest;
import java.net.http.HttpClient;

public class HttpClientExample {
    private static final Tracer tracer = OpenTelemetryConfig.getTracer();

    // Setter for injecting context into HTTP headers
    private static final TextMapSetter<HttpRequest.Builder> setter =
        (carrier, key, value) -> carrier.header(key, value);

    public String makeExternalRequest(String url) {
        Span span = tracer.spanBuilder("external_api_call").startSpan();
        try (Scope scope = span.makeCurrent()) {

            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .GET();

            // Inject trace context into headers
            GlobalOpenTelemetry.getPropagators()
                    .getTextMapPropagator()
                    .inject(Context.current(), requestBuilder, setter);

            HttpRequest request = requestBuilder.build();
            HttpClient client = HttpClient.newHttpClient();

            HttpResponse<String> response = client.send(request,
                    HttpResponse.BodyHandlers.ofString());

            span.setAttribute("http.status_code", response.statusCode());

            return response.body();

        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getMessage());
            throw new RuntimeException(e);
        } finally {
            span.end();
        }
    }
}
```

### Incoming HTTP Requests (Servlet)

```java showLineNumbers
import io.opentelemetry.context.propagation.TextMapGetter;
import javax.servlet.http.HttpServletRequest;

public class ServletExample {

    // Getter for extracting context from HTTP headers
    private static final TextMapGetter<HttpServletRequest> getter =
        new TextMapGetter<>() {
            @Override
            public Iterable<String> keys(HttpServletRequest carrier) {
                return Collections.list(carrier.getHeaderNames());
            }

            @Override
            public String get(HttpServletRequest carrier, String key) {
                return carrier.getHeader(key);
            }
        };

    public void handleRequest(HttpServletRequest request) {
        // Extract context from incoming request
        Context extractedContext = GlobalOpenTelemetry.getPropagators()
                .getTextMapPropagator()
                .extract(Context.current(), request, getter);

        Span span = tracer.spanBuilder("handle_request")
                .setParent(extractedContext)
                .startSpan();

        try (Scope scope = span.makeCurrent()) {
            span.setAttribute("http.method", request.getMethod());
            span.setAttribute("http.url", request.getRequestURI());

            // Process request
            processRequest(request);

        } finally {
            span.end();
        }
    }
}
```

## Framework-Specific Examples

### Spring MVC Controller

```java showLineNumbers
import org.springframework.web.bind.annotation.*;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;

@RestController
@RequestMapping("/api")
public class UserController {

    private final Tracer tracer = OpenTelemetryConfig.getTracer();
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable String id) {
        Span span = tracer.spanBuilder("UserController.getUser").startSpan();
        try (Scope scope = span.makeCurrent()) {

            span.setAttribute("user.id", id);
            span.setAttribute("http.method", "GET");
            span.setAttribute("http.route", "/api/users/{id}");

            User user = userService.findById(id);

            span.setAttribute("user.found", user != null);

            return user;

        } finally {
            span.end();
        }
    }

    @PostMapping("/orders")
    public Order createOrder(@RequestBody OrderRequest request) {
        Span span = tracer.spanBuilder("UserController.createOrder").startSpan();
        try (Scope scope = span.makeCurrent()) {

            span.setAttribute("order.items_count", request.getItems().size());
            span.setAttribute("http.method", "POST");

            Order order = userService.createOrder(request);

            span.setAttribute("order.id", order.getId());
            span.setAttribute("order.total", order.getTotal());
            span.setStatus(StatusCode.OK);

            return order;

        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### Servlet Filter

```java showLineNumbers
import javax.servlet.*;
import javax.servlet.http.*;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Scope;

public class TelemetryFilter implements Filter {

    private final Tracer tracer = OpenTelemetryConfig.getTracer();

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {

        if (request instanceof HttpServletRequest) {
            HttpServletRequest httpRequest = (HttpServletRequest) request;
            HttpServletResponse httpResponse = (HttpServletResponse) response;

            String spanName = httpRequest.getMethod() + " " + httpRequest.getRequestURI();
            Span span = tracer.spanBuilder(spanName).startSpan();

            try (Scope scope = span.makeCurrent()) {
                span.setAttribute("http.method", httpRequest.getMethod());
                span.setAttribute("http.url", httpRequest.getRequestURI());

                chain.doFilter(request, response);

                span.setAttribute("http.status_code", httpResponse.getStatus());

            } finally {
                span.end();
            }
        } else {
            chain.doFilter(request, response);
        }
    }
}
```

### Plain Java Application

```java showLineNumbers
public class BackgroundWorker {

    private final Tracer tracer = OpenTelemetryConfig.getTracer();

    public void processJobs() {
        while (true) {
            Job job = fetchNextJob();

            Span span = tracer.spanBuilder("process_job").startSpan();
            try (Scope scope = span.makeCurrent()) {

                span.setAttribute("job.id", job.getId());
                span.setAttribute("job.type", job.getType());

                try {
                    processJob(job);

                    span.setAttribute("job.status", "completed");
                    span.setStatus(StatusCode.OK);

                } catch (Exception e) {
                    span.recordException(e);
                    span.setAttribute("job.status", "failed");
                    span.setStatus(StatusCode.ERROR, e.getMessage());

                    handleJobFailure(job, e);
                }

            } finally {
                span.end();
            }

            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }
}
```

## Best Practices

### 1. Always Close Spans

```java
// Good - using try-with-resources
Span span = tracer.spanBuilder("operation").startSpan();
try (Scope scope = span.makeCurrent()) {
    doWork();
} finally {
    span.end(); // Always called
}

// Bad - span may not end if exception thrown
Span span = tracer.spanBuilder("operation").startSpan();
Scope scope = span.makeCurrent();
doWork();
scope.close();
span.end();
```

### 2. Use Descriptive Span Names

```java
// Good
Span span = tracer.spanBuilder("UserRepository.findById").startSpan();
Span span = tracer.spanBuilder("PaymentService.processPayment").startSpan();

// Bad
Span span = tracer.spanBuilder("operation").startSpan();
Span span = tracer.spanBuilder("query").startSpan();
```

### 3. Add Relevant Attributes

```java
// Good
span.setAttribute("user.id", userId);
span.setAttribute("order.amount", amount);
span.setAttribute("cache.hit", true);

// Bad - sensitive data
span.setAttribute("user.password", password); // Never!
span.setAttribute("credit.card.number", ccNumber); // Never!
```

### 4. Use Semantic Conventions

```java
// Good - using semantic conventions
import io.opentelemetry.semconv.trace.attributes.SemanticAttributes;

span.setAttribute(SemanticAttributes.HTTP_REQUEST_METHOD, "POST");
span.setAttribute(SemanticAttributes.DB_SYSTEM, "postgresql");
span.setAttribute(SemanticAttributes.DB_NAME, "production");
```

### 5. Handle Exceptions Properly

```java
// Good
try {
    riskyOperation();
    span.setStatus(StatusCode.OK);
} catch (Exception e) {
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, e.getMessage());
    throw e;
}

// Bad - swallowing exceptions
try {
    riskyOperation();
} catch (Exception e) {
    // Exception lost
}
```

## Complete Example

Here's a complete example of a Java application with custom instrumentation:

```java showLineNumbers title="Application.java"
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.*;
import io.opentelemetry.api.trace.*;

public class Application {

    private static Tracer tracer;
    private static Meter meter;
    private static LongCounter requestCounter;
    private static LongHistogram requestDuration;

    public static void main(String[] args) {
        // Initialize OpenTelemetry
        OpenTelemetry openTelemetry = OpenTelemetryConfig.initializeOpenTelemetry();

        tracer = OpenTelemetryConfig.getTracer();
        meter = OpenTelemetryConfig.getMeter();

        // Create metrics
        requestCounter = meter.counterBuilder("requests.total")
                .setDescription("Total requests")
                .setUnit("requests")
                .build();

        requestDuration = meter.histogramBuilder("requests.duration")
                .setDescription("Request duration")
                .setUnit("ms")
                .ofLongs()
                .build();

        // Process request
        processRequest();
    }

    private static void processRequest() {
        long startTime = System.currentTimeMillis();

        Span span = tracer.spanBuilder("http.request").startSpan();
        try (Scope scope = span.makeCurrent()) {

            span.setAttribute("http.method", "POST");
            span.setAttribute("http.url", "/api/orders");

            try {
                // Business logic
                createOrder();

                span.setAttribute("http.status_code", 201);
                span.setStatus(StatusCode.OK);

                recordMetrics(201, startTime);

            } catch (Exception e) {
                span.recordException(e);
                span.setAttribute("http.status_code", 500);
                span.setStatus(StatusCode.ERROR, e.getMessage());

                recordMetrics(500, startTime);
            }

        } finally {
            span.end();
        }
    }

    private static void createOrder() {
        Span span = tracer.spanBuilder("create_order").startSpan();
        try (Scope scope = span.makeCurrent()) {

            // Simulate order creation
            int orderId = (int) (Math.random() * 10000);

            span.setAttribute("order.id", orderId);
            span.setAttribute("order.total", 99.99);

            System.out.println("Order created: " + orderId);

        } finally {
            span.end();
        }
    }

    private static void recordMetrics(int statusCode, long startTime) {
        long duration = System.currentTimeMillis() - startTime;

        Attributes attrs = Attributes.of(
            AttributeKey.longKey("status"), (long) statusCode
        );

        requestCounter.add(1, attrs);
        requestDuration.record(duration, attrs);
    }
}
```

## Extracting Trace and Span IDs

Extract trace ID and span ID for log correlation:

```java showLineNumbers
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;

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

    // Usage with logging
    public static void doWork() {
        Span span = tracer.spanBuilder("work.operation").startSpan();
        try (Scope scope = span.makeCurrent()) {

            String[] ids = getTraceAndSpanIDs();
            String traceId = ids[0];
            String spanId = ids[1];

            // Use for structured logging
            logger.info("Processing request - TraceID: {}, SpanID: {}",
                       traceId, spanId);

            performWork();

        } finally {
            span.end();
        }
    }
}
```

## References

- [Official OpenTelemetry Java Documentation](https://opentelemetry.io/docs/languages/java/)
- [OpenTelemetry Java GitHub](https://github.com/open-telemetry/opentelemetry-java)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Spring Boot Auto-Instrumentation](../auto-instrumentation/spring-boot.md) -
  Automatic tracing for Java Spring Boot applications
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up Scout Collector for local development
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for your telemetry data
