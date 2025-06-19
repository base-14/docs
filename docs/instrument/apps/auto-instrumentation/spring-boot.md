# Spring Boot

Implement OpenTelemetry instrumentation for `Spring Boot` applications to collect traces and metrics, and monitor HTTP requests using the Java OTel SDK.

> **Note:** This guide provides a concise overview. For complete information, consult the [official OpenTelemetry documentation](https://opentelemetry.io/docs/zero-code/java/spring-boot-starter/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Spring Boot
- Configure automatic request and response tracing
- Implement custom instrumentation
- Collect HTTP metrics
- Export telemetry data to OpenTelemetry Collector

## Prerequisites

- Java 17 or later
- Spring Boot 3.2.0 or later
- Maven 3.6+ or Gradle 7.6+

## Required Dependencies

### Maven (`pom.xml`)

```xml
<properties>
    <opentelemetry.version>1.32.0</opentelemetry.version>
    <opentelemetry.instrumentation.version>2.1.0</opentelemetry.instrumentation.version>
    <micrometer.version>1.12.0</micrometer.version>
</properties>

<dependencyManagement>
    <dependencies>
        <!-- OpenTelemetry Instrumentation BOM -->
        <dependency>
            <groupId>io.opentelemetry.instrumentation</groupId>
            <artifactId>opentelemetry-instrumentation-bom</artifactId>
            <version>${opentelemetry.instrumentation.version}-alpha</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
</dependencyManagement>

<dependencies>
    <!-- Spring Boot Starters -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <!-- OpenTelemetry -->
    <dependency>
        <groupId>io.opentelemetry.instrumentation</groupId>
        <artifactId>opentelemetry-spring-boot-starter</artifactId>
    </dependency>
    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-otlp</artifactId>
    </dependency>
</dependencies>
```

### gradle (`build.gradle`)
```groovy
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

ext {
    set('opentelemetry.version', '1.32.0')
    set('opentelemetry.instrumentation.version', '2.1.0')
    set('micrometer.version', '1.12.0')
}

dependencyManagement {
    imports {
        // OpenTelemetry Instrumentation BOM
        mavenBom "io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:${opentelemetry.instrumentation.version}-alpha"
}
}

dependencies {
    // Spring Boot Starters
    implementation 'org.springframework.boot:spring-boot-starter-web'
    
    // OpenTelemetry
    implementation 'io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter'
    implementation 'io.micrometer:micrometer-registry-otlp'
}

```

### Configuration Application Properties
Add to 
(application.properties)
:

```ini properties
# properties

server.port=8080
server.address=0.0.0.0

# OpenTelemetry
otel.service.name=your-service-name
otel.resource.attributes=service.namespace=your-namespace,deployment.environment=dev

# OTLP Exporter
otel.traces.exporter=otlp
otel.metrics.exporter=otlp
otel.logs.exporter=otlp
otel.exporter.otlp.endpoint=http://localhost:4318
otel.exporter.otlp.protocol=http/protobuf

# Actuator
management.endpoints.web.exposure.include=health,info,metrics,prometheus
management.tracing.sampling.probability=1.0
```

### Traces 
### Auto Instrumentation
Spring Boot's auto-configuration automatically instruments:
- HTTP requests/responses
- JDBC operations
- WebClient/RestTemplate calls
- Kafka/Redis/MongoDB operations

### Custom Instrumentation

```java
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import org.springframework.stereotype.Service;

@Service
public class MyService {
    private final Tracer tracer;
    
    public MyService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer(MyService.class.getName());
    }
    
    public void doWork() {
        Span span = tracer.spanBuilder("my-operation").startSpan();
        try (Scope scope = span.makeCurrent()) {
            // Add attributes to the span
            span.setAttribute("custom.attribute", "value");
            
            // Your business logic here
            
        } finally {
            span.end();
        }
    }
}
```
### Metrics
### Auto Instrumentation
Spring Boot Actuator with Micrometer automatically provides:

- JVM metrics (memory, threads, GC)
- HTTP server metrics
- Database connection pool metrics
- System metrics

Custom Metrics
```java
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

@Component
public class MyMetrics {
    private final Counter myCounter;
    
    public MyMetrics(MeterRegistry registry) {
        this.myCounter = Counter.builder("my.custom.counter")
            .description("Counts custom operations")
            .tag("environment", "dev")
            .register(registry);
    }
    
    public void incrementCounter() {
        myCounter.increment();
    }
}
```
Running with Docker Compose
```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.128.0
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    command: ["--config=/etc/otel-collector-config.yaml"]

  your-spring-app:
    build: .
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
    ports:
      - "8080:8080"
    depends_on:
      - otel-collector
```

Viewing Telemetry
> Note: Logs will be exported to the OpenTelemetry Collector and Grafana can be used to view the telemetry data at http://localhost:3000 

A sample application with OpenTelemetry instrumentation can be found at this [GitHub repository]( https://github.com/base-14/examples/tree/main/spring-boot).
