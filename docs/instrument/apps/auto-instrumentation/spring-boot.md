---
title: Spring Boot OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Spring Boot
sidebar_position: 16
description:
  Comprehensive guide to auto-instrument Spring Boot applications with
  OpenTelemetry for production APM. Includes distributed tracing, metrics,
  custom instrumentation, and base14 Scout integration with full Java 8-25
  compatibility.
keywords:
  [
    spring boot monitoring,
    java apm,
    spring boot instrumentation,
    opentelemetry spring boot,
    java monitoring,
    spring boot distributed tracing,
    spring boot application performance monitoring,
    spring boot observability,
    spring boot production monitoring,
    spring boot database monitoring,
    spring boot metrics,
    spring boot tracing,
    spring data monitoring,
    jpa monitoring,
    spring boot instrumentation guide,
    opentelemetry java,
    spring boot telemetry,
    java distributed tracing,
    spring boot performance monitoring,
    java 25 instrumentation,
  ]
---

# Spring Boot

Spring Boot is one of the most widely adopted Java frameworks for building
enterprise microservices and web applications. However, understanding
application performance, identifying bottlenecks, and troubleshooting issues in
distributed Spring Boot environments can be challenging without proper
observability. OpenTelemetry provides automatic instrumentation for Spring Boot
applications, capturing distributed traces across HTTP requests, database calls,
message queues, and external API interactions. With base14 Scout's OpenTelemetry
integration, you gain complete visibility into your Spring Boot application's
performance with minimal code changes and production-ready configuration.

This comprehensive guide demonstrates how to instrument Spring Boot applications
using OpenTelemetry, covering everything from basic setup to advanced production
scenarios. You'll learn how to automatically capture traces from Spring MVC
controllers, Spring Data JPA repositories, RestTemplate and WebClient calls,
Kafka consumers, and more. The OpenTelemetry Spring Boot starter provides
zero-code instrumentation for most common libraries, while also offering APIs
for custom instrumentation when you need fine-grained control over spans and
attributes. Integration with Spring Boot Actuator enables health checks and
metrics export, making it production-ready from day one.

Whether you're a Java developer adding observability to a new microservice, a
DevOps engineer standardizing APM across Spring Boot services, or a platform
team implementing OpenTelemetry organization-wide, this guide provides practical
examples for every scenario. You'll find solutions for common pain points like
context propagation across async boundaries, instrumenting legacy Spring
applications, securing sensitive data in traces, optimizing performance overhead,
and troubleshooting missing spans. By the end of this guide, you'll have a fully
instrumented Spring Boot application sending rich telemetry data to base14 Scout,
enabling fast root cause analysis and proactive performance optimization.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Spring Boot applications
- Configure automatic request and response tracing
- Instrument Spring MVC, Spring Data, and other Spring components
- Implement custom instrumentation for business logic
- Collect traces, metrics, and logs
- Secure sensitive data in telemetry
- Optimize performance overhead in production
- Troubleshoot common instrumentation issues
- Export telemetry data to base14 Scout Collector

## Who This Guide Is For

This guide is designed for multiple roles working with Spring Boot applications:

- **Java Developers** building new Spring Boot microservices who want to add
  observability from the start, understand performance characteristics of their
  code, and debug issues faster with distributed tracing.

- **DevOps Engineers** responsible for deploying and monitoring Spring Boot
  applications in production environments, who need to standardize APM tooling,
  configure exporters, and ensure observability across the entire infrastructure.

- **Platform Teams** implementing organization-wide OpenTelemetry standards for
  Java applications, who need to create reusable configuration patterns and
  integrate with existing observability stacks.

- **Site Reliability Engineers (SREs)** who troubleshoot production incidents
  involving Spring Boot services, need to quickly identify performance
  bottlenecks, trace requests across distributed systems, and maintain service
  level objectives (SLOs).

- **Application Architects** making technology decisions for microservices
  platforms, evaluating observability solutions, and designing systems that are
  observable by default with proper instrumentation patterns.

## Prerequisites

Before implementing OpenTelemetry instrumentation, ensure you have:

- A Spring Boot application (2.7+ or 3.x)
- Java Development Kit (JDK) installed
- Maven 3.6+ or Gradle 7.6+ build tool
- Access to base14 Scout Collector endpoint (see [Collector Setup](../../collector-setup/kubernetes-helm-setup.md))
- Basic understanding of OpenTelemetry concepts (spans, traces, exporters)

### Compatibility

**Minimum requirements:**

- **Java**: 8+ (Java 17 or 21 LTS recommended for production)
- **Spring Boot**: 2.7.0+ (3.x recommended, 4.0 preview available)
- **Maven/Gradle**: Any recent version

**Version details:**

<details>
<summary>OpenTelemetry library versions</summary>

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OpenTelemetry Java SDK | 1.32.0 | 1.56.0+ |
| OpenTelemetry Spring Boot Starter | 2.1.0 | 2.21.0 |
| OpenTelemetry Java Agent | 1.32.0 | 2.10.0+ |

</details>

> ⚠️ **Java 25**: Experimental support. Use Java 21 LTS for production. See
> [Java 25 notes](#java-25-compatibility-status) below.

#### Java 25 Compatibility Status

Java 25 (released September 2025 as LTS) introduced changes affecting Java
agents and instrumentation:

- **JEP 520 (JFR Method Timing)**: Adds native method tracing via bytecode
  instrumentation, which can complement OpenTelemetry
- **JVMTI Verification Changes**: Agent-transformed bytecode is now always
  verified, which may cause compatibility issues with older agent versions
- **Unsafe Deprecation Warnings**: Users may see warnings about
  `sun.misc.Unsafe::objectFieldOffset` being terminally deprecated
- **Status**: OpenTelemetry Java agent has experimental Java 25 support with
  known ByteBuddy-related issues being actively addressed

For production deployments, we recommend **Java 21 LTS** until OpenTelemetry
Java 25 support is fully stable. Monitor the
[OpenTelemetry Java instrumentation releases](https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases)
for updates.

## Choosing Your Approach

Spring Boot offers three distinct approaches for OpenTelemetry integration. This
section helps you choose the right one for your project and understand the
trade-offs.

> 📌 **Looking for alternative approaches?**
>
> This guide focuses on the **OpenTelemetry SDK Integration** (recommended for
> production). For **Java Agent** (zero-code) and
> **Spring Boot 4.0 Native Starter** (preview) approaches, see
> [Spring Boot Alternatives](./spring-boot-alternatives.md).

### OpenTelemetry SDK Integration (Our Recommendation) ⭐

The community-maintained `opentelemetry-spring-boot-starter` provides direct
OpenTelemetry SDK integration with full control and broad version support. This
is **our recommended approach for production deployments**.

**How it works:**

- Add Maven/Gradle dependencies to your `pom.xml` or `build.gradle`
- Configure via `application.yml` or `application.properties`
- Automatic instrumentation for ~30 common libraries
- Full OpenTelemetry API access for custom spans and metrics
- Works with Spring Boot 2.7, 3.x, and 4.0

**Architecture:**

- Direct OpenTelemetry API usage (no abstraction layer)
- Full access to OpenTelemetry SDK configuration
- Explicit dependency management via BOM
- Spring Boot native configuration support
- Production-proven across thousands of deployments

**Best for:**

- **Production deployments** - Stable, battle-tested approach
- **GraalVM native-image** - Full support for native compilation
- **Spring Boot configuration** - Use familiar `application.yml` patterns
- **Custom instrumentation** - Full OpenTelemetry API access for business logic
- **Advanced use cases** - Custom span processors, exporters, samplers
- **Multi-framework** - Using OpenTelemetry across Node.js, Go, Python, etc.
- **Version control** - Explicit dependency management without bytecode issues

**Limitations:**

- More complex setup than Java Agent (requires BOM and dependencies)
- Requires understanding OpenTelemetry concepts (spans, traces, exporters)
- Fewer auto-instrumented libraries (30+) compared to Java Agent (150+)
- Manual configuration needed for advanced scenarios

### Java Agent (Zero-Code Alternative)

The OpenTelemetry Java agent provides zero-code automatic instrumentation using
bytecode manipulation at JVM startup. Best for legacy applications where code
changes aren't possible, or for quick proof-of-concept testing.

**Key characteristics:**

- Download single JAR, attach with `-javaagent` flag
- No dependencies or code changes required
- Automatically instruments 150+ libraries
- Environment variable configuration only

See the [Java Agent guide](./spring-boot-alternatives.md#java-agent-approach)
for complete setup instructions, Docker/Kubernetes examples, and limitations.

### Spring Boot 4.0 Native Starter (Future)

Spring Boot 4.0 (preview, not GA) introduces native OpenTelemetry support with
`spring-boot-starter-opentelemetry`. Uses Micrometer as abstraction layer for
metrics and tracing.

**Key characteristics:**

- Single dependency, managed by Spring Boot 4.0
- Micrometer API for custom instrumentation
- Spring Boot auto-configuration
- Not recommended for production until GA

See the [Spring Boot 4.0 guide](./spring-boot-alternatives.md#spring-boot-40-native-starter-approach)
for setup instructions and migration guide from OpenTelemetry SDK Integration.

### Quick Comparison

| Feature | OpenTelemetry SDK Integration ⭐ | Java Agent | Spring Boot 4.0 Native |
|---------|---------------------|------------|------------------------|
| **Production Ready** | ✅ Stable | ✅ Stable | ❌ Preview |
| **Setup** | Add dependencies | Attach JAR at startup | Add single dependency |
| **Code Changes** | Optional | None required | Optional |
| **Configuration** | `application.yml` or code | Environment variables only | `application.yml` or code |
| **Custom Instrumentation** | Full OpenTelemetry API | Annotations only | Micrometer API |
| **GraalVM Native** | ✅ Supported | ❌ Not supported | ✅ Supported |
| **Auto-instrumentation** | ~30 libraries | 150+ libraries | Via Micrometer |
| **Best For** | Production apps, full control | Legacy apps, zero-code | Future (post-GA) |
| **Our Recommendation** | ✅ **Recommended** | Alternative | Wait for GA |

### Decision Guide

**Choose OpenTelemetry SDK Integration (Recommended for Production) when:**

- **GraalVM native-image**: Compiling to native binary
- **Spring Boot configuration**: Want to use `application.yml` for OTEL config
- **Custom instrumentation**: Need full OpenTelemetry API access for business logic
- **Version flexibility**: Want explicit control over dependency versions
- **Custom span processors**: Need advanced SDK customization (samplers, exporters)
- **Multi-framework**: Using OpenTelemetry across Node.js, Go, Python, etc.
- **Production stability**: Spring Boot 2.7, 3.x with proven battle-tested approach
- **Latest features**: Want immediate access to new OpenTelemetry capabilities
- **Debugging preference**: Prefer explicit dependencies over bytecode manipulation

**Choose Java Agent (Zero-Code Alternative) when:**

- **Zero-code requirement**: Cannot or don't want to modify application code/dependencies
- **Legacy applications**: Modifying code is difficult or risky
- **Maximum auto-instrumentation**: Need coverage for 150+ libraries out-of-the-box
- **Cross-stack standardization**: Using OpenTelemetry across multiple languages
- **Quick evaluation**: Want to try OpenTelemetry without code changes
- **Operational control**: Ops team manages instrumentation separately from development
- **Not using GraalVM**: No native-image compilation requirements
- **Simple Spring Boot apps**: Standard libraries, no version compatibility concerns

**Choose Spring Boot 4.0 Native Starter when:**

- **After GA release**: Spring Boot 4.0 reaches General Availability
- **Micrometer standardization**: Team already uses Micrometer abstractions
- **Spring-native conventions**: Want Spring Boot auto-configuration patterns
- **Simple setup**: Don't need advanced SDK customization
- **Vendor-neutral API**: Micrometer can export to multiple backends

### This Guide's Coverage

This guide focuses on the **OpenTelemetry SDK Integration** approach with comprehensive
examples for production use:

- Complete setup with Maven and Gradle
- Configuration via application.yml, properties, and programmatic
- Production deployment with Docker, Kubernetes
- Framework-specific features (Spring MVC, JPA, RestTemplate, WebClient)
- Custom instrumentation with full OpenTelemetry API
- Security, performance, and troubleshooting guidance

**Why OpenTelemetry SDK Integration is our recommendation:**

- **Production Ready**: Stable, well-tested, and widely deployed
- **Broad Compatibility**: Works with Spring Boot 2.7, 3.x, and 4.0
- **Maximum Flexibility**: Full SDK control for complex scenarios
- **GraalVM Support**: Native-image compilation compatible
- **Spring Configuration**: Uses familiar `application.yml` patterns

> 💡 **Alternative Approaches**: For **Java Agent** (zero-code) or **Spring
> Boot 4.0 Native Starter** (preview), see [Spring Boot
> Alternatives](./spring-boot-alternatives.md).

## Setup

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="maven" label="Maven">
```

```xml title="pom.xml" showLineNumbers
<properties>
    <opentelemetry.version>1.56.0</opentelemetry.version>
    <opentelemetry.instrumentation.version>2.21.0</opentelemetry.instrumentation.version>
    <!-- Note: Micrometer version is managed by Spring Boot BOM (all versions 2.0+) -->
</properties>

<dependencyManagement>
    <dependencies>
        <!-- OpenTelemetry Instrumentation BOM -->
        <dependency>
            <groupId>io.opentelemetry.instrumentation</groupId>
            <artifactId>opentelemetry-instrumentation-bom</artifactId>
            <version>${opentelemetry.instrumentation.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
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

```mdx-code-block
</TabItem>
<TabItem value="gradle" label="Gradle">
```

```groovy title="build.gradle" showLineNumbers
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.5.7'
    id 'io.spring.dependency-management' version '1.1.4'
}

ext {
    set('opentelemetry.version', '1.56.0')
    set('opentelemetry.instrumentation.version', '2.21.0')
    // Note: Micrometer version is managed by Spring Boot BOM (all versions 2.0+)
}

dependencyManagement {
    imports {
        // OpenTelemetry Instrumentation BOM
        mavenBom "io.opentelemetry.instrumentation:" +
            "opentelemetry-instrumentation-bom:" +
            "${opentelemetry.instrumentation.version}"
    }
}

dependencies {
    // Spring Boot Starters
    implementation 'org.springframework.boot:spring-boot-starter-web'

    // OpenTelemetry
    implementation 'io.opentelemetry.instrumentation:' +
        'opentelemetry-spring-boot-starter'
    implementation 'io.micrometer:micrometer-registry-otlp'
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

OpenTelemetry can be configured for Spring Boot applications in multiple ways.
Choose the approach that best fits your deployment model.

```mdx-code-block
<Tabs>
<TabItem value="env-vars" label="Environment Variables" default>
```

**Recommended for production** - Maximum flexibility across environments:

```bash title=".env" showLineNumbers
# Service identification
OTEL_SERVICE_NAME=your-service-name
OTEL_RESOURCE_ATTRIBUTES=service.namespace=your-namespace,deployment.environment=production

# OTLP Exporter configuration
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp

# Instrumentation control
OTEL_INSTRUMENTATION_SPRING_WEBMVC_ENABLED=true
OTEL_INSTRUMENTATION_JDBC_ENABLED=true
```

```mdx-code-block
</TabItem>
<TabItem value="properties" label="Application Properties">
```

Spring Boot-native configuration via `application.properties`:

```properties title="src/main/resources/application.properties" showLineNumbers
# Server
server.port=8080
server.address=0.0.0.0

# OpenTelemetry
otel.service.name=your-service-name
otel.resource.attributes=service.namespace=your-namespace,\
    deployment.environment=dev

# OTLP Exporter
otel.traces.exporter=otlp
otel.metrics.exporter=otlp
otel.logs.exporter=otlp
otel.exporter.otlp.endpoint=http://localhost:4318
otel.exporter.otlp.protocol=http/protobuf

# Actuator
management.endpoints.web.exposure.include=health,info,metrics
```

```mdx-code-block
</TabItem>
<TabItem value="programmatic" label="Programmatic (Java)">
```

Advanced scenarios with full programmatic control:

```java title="src/main/java/com/example/config/OpenTelemetryConfig.java" showLineNumbers
package com.example.config;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.semconv.ResourceAttributes;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenTelemetryConfig {

    @Value("${otel.exporter.otlp.endpoint:http://localhost:4318}")
    private String otlpEndpoint;

    @Value("${otel.service.name:spring-boot-app}")
    private String serviceName;

    @Bean
    public OpenTelemetry openTelemetry() {
        Resource resource = Resource.create(
            Attributes.of(
                ResourceAttributes.SERVICE_NAME, serviceName,
                ResourceAttributes.SERVICE_NAMESPACE, "production",
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT, "prod"
            )
        );

        OtlpHttpSpanExporter spanExporter = OtlpHttpSpanExporter.builder()
            .setEndpoint(otlpEndpoint + "/v1/traces")
            .build();

        SdkTracerProvider tracerProvider = SdkTracerProvider.builder()
            .setResource(resource)
            .addSpanProcessor(BatchSpanProcessor.builder(spanExporter).build())
            .build();

        return OpenTelemetrySdk.builder()
            .setTracerProvider(tracerProvider)
            .buildAndRegisterGlobal();
    }
}
```

```mdx-code-block
</TabItem>
<TabItem value="profiles" label="Spring Profiles (YAML)">
```

Multi-environment configuration with Spring profiles:

**application-dev.yml:**

```yaml title="src/main/resources/application-dev.yml" showLineNumbers
otel:
  service:
    name: my-service-dev
  resource:
    attributes: deployment.environment=dev,service.namespace=development
  exporter:
    otlp:
      endpoint: http://localhost:4318
```

**application-prod.yml:**

```yaml title="src/main/resources/application-prod.yml" showLineNumbers
otel:
  service:
    name: my-service-prod
  resource:
    attributes: deployment.environment=prod,service.namespace=production
  exporter:
    otlp:
      endpoint: https://scout-collector.example.com:4318
```

```mdx-code-block
</TabItem>
</Tabs>
```

> All configuration approaches export logs, traces, and metrics to the base14
> Scout observability backend.

## Production Configuration

Production environments require careful configuration for performance,
reliability, and cost optimization.

### Batch Span Processor Configuration

Use BatchSpanProcessor for optimal production performance:

```java title="src/main/java/com/example/config/ProductionTracingConfig.java" showLineNumbers
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("production")
public class ProductionTracingConfig {

    @Bean
    public BatchSpanProcessor batchSpanProcessor(OtlpHttpSpanExporter exporter) {
        return BatchSpanProcessor.builder(exporter)
            .setMaxQueueSize(2048)
            .setMaxExportBatchSize(512)
            .setScheduleDelay(Duration.ofSeconds(5))
            .setExporterTimeout(Duration.ofSeconds(30))
            .build();
    }
}
```

### Resource Attributes for Production

Add comprehensive resource attributes for better observability:

```properties title="application-prod.properties" showLineNumbers
otel.resource.attributes=\
    service.name=payment-service,\
    service.namespace=production,\
    service.version=1.2.3,\
    service.instance.id=${HOSTNAME},\
    deployment.environment=prod,\
    deployment.region=us-east-1,\
    cloud.provider=aws,\
    cloud.platform=aws_eks,\
    k8s.cluster.name=prod-cluster,\
    k8s.namespace.name=payments,\
    k8s.pod.name=${HOSTNAME}
```

### Docker Configuration

Configure OpenTelemetry for containerized Spring Boot applications:

```docker title="Dockerfile" showLineNumbers
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

# Copy application JAR
COPY target/my-service-1.0.0.jar app.jar

# Set OpenTelemetry environment variables
ENV OTEL_SERVICE_NAME=my-service
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
ENV OTEL_RESOURCE_ATTRIBUTES=service.namespace=production

# Run application
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### Docker Compose Example

```yaml title="docker-compose.yml" showLineNumbers
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      OTEL_SERVICE_NAME: payment-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=production
    depends_on:
      - scout-collector

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4318:4318"
```

### Kubernetes Deployment

```yaml title="k8s-deployment.yaml" showLineNumbers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spring-boot-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: spring-boot-app
  template:
    metadata:
      labels:
        app: spring-boot-app
    spec:
      containers:
      - name: app
        image: myregistry/spring-boot-app:1.2.3
        ports:
        - containerPort: 8080
        env:
        - name: OTEL_SERVICE_NAME
          value: "spring-boot-app"
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: "http://scout-collector.observability.svc.cluster.local:4318"
        - name: OTEL_RESOURCE_ATTRIBUTES
          value: "deployment.environment=prod,k8s.cluster.name=prod-cluster"
        - name: POD_NAME
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
```

### Health Check Endpoint

Implement a health check that verifies telemetry export:

```java title="src/main/java/com/example/controller/HealthController.java" showLineNumbers
package com.example.controller;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @Autowired
    private OpenTelemetry openTelemetry;

    @GetMapping("/health/telemetry")
    public ResponseEntity<String> checkTelemetry() {
        try {
            Tracer tracer = openTelemetry.getTracer("health-check");
            // Test span creation
            tracer.spanBuilder("health-check-test").startSpan().end();
            return ResponseEntity.ok("Telemetry OK");
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Telemetry Error: " + e.getMessage());
        }
    }
}
```

## Framework-Specific Features

OpenTelemetry automatically instruments many Spring Boot components. Here's how
instrumentation works for common Spring features.

### Spring MVC REST Controllers

REST controllers are automatically instrumented:

```java title="src/main/java/com/example/controller/UserController.java" showLineNumbers
package com.example.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserService userService;

    // Automatically creates span: "GET /api/users/{id}"
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }

    // Automatically creates span: "POST /api/users"
    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.save(user);
    }
}
```

Each HTTP request creates a parent span with attributes like `http.method`,
`http.route`, `http.status_code`, and `http.url`.

### Spring Data JPA Repositories

Database queries via Spring Data JPA are automatically traced:

```java title="src/main/java/com/example/repository/UserRepository.java" showLineNumbers
package com.example.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, Long> {

    // Automatically creates span: "SELECT User"
    User findByEmail(String email);

    // Automatically creates span with SQL query
    @Query("SELECT u FROM User u WHERE u.active = true")
    List<User> findActiveUsers();
}
```

JDBC instrumentation captures:

- SQL statements (parameterized)
- Database connection details
- Query execution time
- Connection pool metrics

### RestTemplate and WebClient

Outgoing HTTP calls are automatically instrumented with distributed trace
context propagation:

```java title="src/main/java/com/example/service/ExternalApiService.java" showLineNumbers
package com.example.service;

import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@Service
public class ExternalApiService {

    private final RestTemplate restTemplate;
    private final WebClient webClient;

    public ExternalApiService(RestTemplate restTemplate, WebClient.Builder webClientBuilder) {
        this.restTemplate = restTemplate;
        this.webClient = webClientBuilder.baseUrl("https://api.example.com").build();
    }

    // Automatically creates span: "GET https://api.example.com/data"
    public String fetchDataSync() {
        return restTemplate.getForObject("https://api.example.com/data", String.class);
    }

    // Automatically creates span with async context propagation
    public Mono<String> fetchDataAsync() {
        return webClient.get()
            .uri("/data")
            .retrieve()
            .bodyToMono(String.class);
    }
}
```

### Spring Boot Actuator Integration

Integrate OpenTelemetry metrics with Spring Boot Actuator:

```java title="src/main/java/com/example/config/ActuatorConfig.java" showLineNumbers
package com.example.config;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.metrics.Meter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ActuatorConfig {

    @Bean
    public Meter meter(OpenTelemetry openTelemetry) {
        return openTelemetry.getMeter("actuator-metrics");
    }
}
```

```properties title="application.properties" showLineNumbers
# Expose Actuator endpoints
management.endpoints.web.exposure.include=health,info,metrics
management.endpoint.health.show-details=always
management.metrics.export.otlp.enabled=true
```

## Custom Instrumentation

While auto-instrumentation covers most use cases, custom instrumentation allows
fine-grained control over spans and attributes.

> 💡 **Java Agent Users**: The Java agent only supports annotation-based custom
> instrumentation (`@WithSpan`, `@SpanAttribute`). For full programmatic API
> access shown in this section, use the OpenTelemetry SDK Integration. For Java
> Agent
> annotation examples, see [Custom Instrumentation with
> Agent](./spring-boot-alternatives.md#custom-instrumentation-with-agent).
>
> 💡 **Spring Boot 4.0 Users**: If using the native starter, you'll use
> Micrometer APIs (`io.micrometer.tracing.*`) instead of OpenTelemetry APIs
> (`io.opentelemetry.api.*`). See the [Spring Boot 4.0
> guide](./spring-boot-alternatives.md#migrating-from-opentelemetry-sdk-integration-to-spring-boot-40)
> for API comparisons.

### Manual Span Creation

Create custom spans for business logic:

```java title="src/main/java/com/example/service/PaymentService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Scope;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    private final Tracer tracer;

    public PaymentService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("payment-service");
    }

    public PaymentResult processPayment(PaymentRequest request) {
        Span span = tracer.spanBuilder("process_payment")
            .setAttribute("payment.method", request.getMethod())
            .setAttribute("payment.amount", request.getAmount())
            .setAttribute("payment.currency", request.getCurrency())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            // Business logic
            validatePayment(request);
            PaymentResult result = chargeCustomer(request);

            span.setAttribute("payment.transaction_id", result.getTransactionId());
            span.setStatus(StatusCode.OK);

            return result;
        } catch (PaymentException e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, "Payment failed");
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### Adding Span Attributes

Enrich spans with business-specific attributes:

```java title="src/main/java/com/example/service/OrderService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.trace.Span;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    public Order createOrder(OrderRequest request) {
        Span currentSpan = Span.current();

        // Add custom attributes to current span
        currentSpan.setAttribute("order.user_id", request.getUserId());
        currentSpan.setAttribute("order.item_count", request.getItems().size());
        currentSpan.setAttribute("order.total_value", request.getTotalValue());
        currentSpan.setAttribute("order.payment_method", request.getPaymentMethod());

        // Business logic
        Order order = saveOrder(request);

        currentSpan.setAttribute("order.id", order.getId());
        currentSpan.addEvent("Order created successfully");

        return order;
    }
}
```

### Exception Handling and Error Recording

Properly record exceptions in spans:

```java title="src/main/java/com/example/service/UserService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    public User findUserById(Long id) {
        Span span = Span.current();

        try {
            User user = userRepository.findById(id)
                .orElseThrow(() -> new UserNotFoundException("User not found: " + id));

            span.setAttribute("user.id", user.getId());
            span.setAttribute("user.role", user.getRole());

            return user;
        } catch (UserNotFoundException e) {
            // Record exception with full stack trace
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, "User not found");
            throw e;
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, "Unexpected error");
            throw new ServiceException("Failed to find user", e);
        }
    }
}
```

### Async Operation Instrumentation

Instrument async operations with proper context propagation:

```java title="src/main/java/com/example/service/AsyncService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.util.concurrent.CompletableFuture;

@Service
public class AsyncService {

    private final Tracer tracer;

    public AsyncService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("async-service");
    }

    @Async
    public CompletableFuture<String> processAsync(String input) {
        // Capture current context
        Context context = Context.current();

        return CompletableFuture.supplyAsync(() -> {
            // Restore context in async thread
            try (var scope = context.makeCurrent()) {
                Span span = tracer.spanBuilder("async_processing")
                    .setAttribute("input.length", input.length())
                    .startSpan();

                try (var spanScope = span.makeCurrent()) {
                    String result = performWork(input);
                    span.setStatus(StatusCode.OK);
                    return result;
                } finally {
                    span.end();
                }
            }
        });
    }
}
```

### Custom Metrics

Create custom business metrics:

> 💡 **Spring Boot 4.0 Native Starter**: Use Micrometer's `MeterRegistry` for
> metrics instead of OpenTelemetry's `Meter`. Example:
> `meterRegistry.counter("orders.created").increment()`. The metrics are
> automatically exported via OTLP.

```java title="src/main/java/com/example/metrics/BusinessMetrics.java" showLineNumbers
package com.example.metrics;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import io.opentelemetry.api.metrics.LongHistogram;
import org.springframework.stereotype.Component;

@Component
public class BusinessMetrics {

    private final LongCounter orderCounter;
    private final LongHistogram orderValueHistogram;
    private final Meter meter;

    public BusinessMetrics(OpenTelemetry openTelemetry) {
        this.meter = openTelemetry.getMeter("business-metrics");

        this.orderCounter = meter.counterBuilder("orders.created")
            .setDescription("Total number of orders created")
            .build();

        this.orderValueHistogram = meter.histogramBuilder("order.value")
            .setDescription("Distribution of order values")
            .ofLongs()
            .build();
    }

    public void recordOrder(Order order) {
        orderCounter.add(1, Attributes.builder()
            .put("order.status", order.getStatus())
            .put("order.payment_method", order.getPaymentMethod())
            .build());

        orderValueHistogram.record(order.getTotalValue(), Attributes.builder()
            .put("order.currency", order.getCurrency())
            .build());
    }
}
```

## Running Your Application

Choose the deployment method that matches your environment:

```mdx-code-block
<Tabs>
<TabItem value="local" label="Local Development" default>
```

Run your Spring Boot application locally with OpenTelemetry:

```bash showLineNumbers
# Set environment variables
export OTEL_SERVICE_NAME=my-service-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run with Maven
mvn spring-boot:run

# Or run with Gradle
./gradlew bootRun
```

```mdx-code-block
</TabItem>
<TabItem value="jar" label="Production JAR">
```

Build and run as a standalone JAR:

```bash showLineNumbers
# Build the application
mvn clean package -DskipTests

# Run with production configuration
java -jar target/my-service-1.0.0.jar \
  --spring.profiles.active=prod \
  -Dotel.service.name=my-service \
  -Dotel.exporter.otlp.endpoint=https://scout-collector.example.com:4318
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

Build and run in Docker:

```bash showLineNumbers
# Build Docker image
docker build -t my-service:1.0.0 .

# Run container
docker run -d \
  --name my-service \
  -p 8080:8080 \
  -e OTEL_SERVICE_NAME=my-service \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318 \
  -e OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod \
  my-service:1.0.0
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Common Issues and Solutions

#### 1. No Traces Appearing in Scout

**Symptoms:** Application runs but no traces visible in base14 Scout.

**Solutions:**

```bash showLineNumbers
# Verify collector endpoint is reachable
curl -v http://scout-collector:4318/health

# Enable debug logging
export OTEL_LOG_LEVEL=debug
export LOGGING_LEVEL_IO_OPENTELEMETRY=DEBUG
```

```properties title="application.properties" showLineNumbers
# Add debug logging
logging.level.io.opentelemetry=DEBUG
logging.level.io.opentelemetry.exporter=TRACE
```

#### 2. Java 25 Unsafe Deprecation Warnings

**Symptoms:** Warnings about `sun.misc.Unsafe::objectFieldOffset` being
terminally deprecated when running on Java 25.

**Cause:** ByteBuddy (used by OpenTelemetry agent) uses deprecated Unsafe
methods.

**Solutions:**

- These are warnings, not errors - instrumentation still works
- Monitor
  [OpenTelemetry Java releases](https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases)
  for ByteBuddy updates
- For production, use Java 21 LTS until Java 25 support is fully stable

```bash showLineNumbers
# Suppress warnings (temporary workaround)
java -XX:+UnlockDiagnosticVMOptions -XX:-WarnUnsafeDefaultFileEncoding -jar app.jar
```

#### 3. ClassNotFoundException or NoClassDefFoundError

**Symptoms:** Application fails to start with missing OpenTelemetry classes.

**Solutions:**

```xml showLineNumbers
<!-- Ensure BOM is imported in pom.xml -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>io.opentelemetry.instrumentation</groupId>
            <artifactId>opentelemetry-instrumentation-bom</artifactId>
            <version>2.21.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

#### 4. High Memory Usage

**Symptoms:** Application memory usage increases significantly after adding instrumentation.

**Solutions:**

```properties showLineNumbers
# Reduce batch size and queue size
otel.bsp.max.queue.size=1024
otel.bsp.max.export.batch.size=256
otel.bsp.schedule.delay=5000
```

#### 5. Missing Database Query Spans

**Symptoms:** HTTP requests traced but database queries not visible.

**Solutions:**

```properties showLineNumbers
# Enable JDBC instrumentation explicitly
otel.instrumentation.jdbc.enabled=true
otel.instrumentation.jdbc-datasource.enabled=true

# Show SQL in spans (dev only)
otel.instrumentation.jdbc.statement-sanitizer.enabled=false
```

#### 6. Verification Test

Test that instrumentation is working correctly:

```java title="src/test/java/com/example/TelemetryTest.java" showLineNumbers
package com.example;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class TelemetryTest {

    @Autowired
    private OpenTelemetry openTelemetry;

    @Test
    void testTelemetryConfiguration() {
        assertThat(openTelemetry).isNotNull();

        Tracer tracer = openTelemetry.getTracer("test");
        Span span = tracer.spanBuilder("test-span").startSpan();

        assertThat(span).isNotNull();
        assertThat(span.isRecording()).isTrue();

        span.end();
    }
}
```

## Security Considerations

Protecting sensitive data in telemetry is critical for compliance and security.

### Sensitive Data Masking

Mask sensitive data in span attributes:

```java title="src/main/java/com/example/security/SensitiveDataMasker.java" showLineNumbers
package com.example.security;

import io.opentelemetry.api.trace.Span;
import org.springframework.stereotype.Component;

@Component
public class SensitiveDataMasker {

    public void addUserAttributes(Span span, User user) {
        span.setAttribute("user.id", user.getId());
        span.setAttribute("user.role", user.getRole());

        // BAD: Exposing PII
        // span.setAttribute("user.email", user.getEmail());
        // span.setAttribute("user.phone", user.getPhone());

        // GOOD: Masked or hashed
        span.setAttribute("user.email_domain", extractDomain(user.getEmail()));
        span.setAttribute("user.phone_country", extractCountryCode(user.getPhone()));
    }

    private String extractDomain(String email) {
        return email.substring(email.indexOf('@') + 1);
    }
}
```

### SQL Query Obfuscation

Ensure SQL queries don't leak sensitive data:

```properties title="application.properties" showLineNumbers
# Enable SQL statement sanitization (production)
otel.instrumentation.jdbc.statement-sanitizer.enabled=true

# Disable raw SQL in spans
otel.instrumentation.jdbc.statement.enabled=false
```

### HTTP Header Filtering

Filter sensitive HTTP headers from traces:

```java title="src/main/java/com/example/config/SecurityConfig.java" showLineNumbers
package com.example.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class SecurityConfig {

    @Bean
    public WebMvcConfigurer headerFilterConfigurer() {
        return new WebMvcConfigurer() {
            // Automatically filtered by OpenTelemetry:
            // - Authorization
            // - Cookie
            // - Set-Cookie
            // - X-API-Key

            // Custom filter for additional headers
            // Configure via: otel.instrumentation.http.capture-headers.server.request
        };
    }
}
```

```properties showLineNumbers
# Specify headers to capture (whitelist approach)
otel.instrumentation.http.capture-headers.server.request=X-Request-ID,X-Correlation-ID
otel.instrumentation.http.capture-headers.server.response=X-Response-Time
```

### Compliance Considerations

For GDPR, HIPAA, and PCI-DSS compliance:

- **Disable PII capture**: Never add email, phone, SSN, or credit card data to
  spans
- **Use span redaction**: Implement custom span processors to redact data
- **Audit trace data**: Regularly review exported spans for sensitive
  information
- **Implement data retention policies**: Configure Scout to delete traces after
  required period
- **Encrypt in transit**: Always use HTTPS/TLS for OTLP exporter endpoints

```java title="src/main/java/com/example/config/ComplianceSpanProcessor.java" showLineNumbers
package com.example.config;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributesBuilder;
import io.opentelemetry.context.Context;
import io.opentelemetry.sdk.trace.ReadWriteSpan;
import io.opentelemetry.sdk.trace.ReadableSpan;
import io.opentelemetry.sdk.trace.SpanProcessor;

import java.util.Set;

public class ComplianceSpanProcessor implements SpanProcessor {

    private static final Set<String> SENSITIVE_KEYS = Set.of(
        "user.email", "user.phone", "credit_card", "ssn", "password"
    );

    @Override
    public void onStart(Context parentContext, ReadWriteSpan span) {
        // No-op on start
    }

    @Override
    public boolean isStartRequired() {
        return false;
    }

    @Override
    public void onEnd(ReadableSpan span) {
        // Redact sensitive attributes before export
        AttributesBuilder builder = Attributes.builder();
        span.getAttributes().forEach((key, value) -> {
            if (SENSITIVE_KEYS.contains(key.getKey())) {
                builder.put(key.getKey(), "[REDACTED]");
            } else {
                builder.put((AttributeKey<Object>) key, value);
            }
        });
    }

    @Override
    public boolean isEndRequired() {
        return true;
    }
}
```

## Performance Considerations

Understanding and optimizing the performance impact of instrumentation.

### Expected Performance Impact

Typical overhead when using OpenTelemetry with Spring Boot:

| Metric | Impact | Notes |
|--------|--------|-------|
| **Latency** | +1-5ms per request | Mostly from span creation and export |
| **CPU Usage** | +2-5% | Varies with trace volume |
| **Memory** | +50-200 MB | For span buffers and exporters |
| **Network** | ~1-5 KB/span | Depends on attribute count |

**Factors affecting performance:**

- Number of instrumented operations per request
- Number of custom attributes added
- Batch processor configuration
- Network latency to collector

### Optimization Best Practices

#### 1. Optimize Batch Processing

```java showLineNumbers
BatchSpanProcessor.builder(exporter)
    .setMaxQueueSize(2048)           // Increase queue size
    .setMaxExportBatchSize(512)       // Larger batches
    .setScheduleDelay(Duration.ofSeconds(5))  // Less frequent exports
    .build();
```

#### 2. Limit Attribute Count

```java showLineNumbers
// BAD: Too many attributes
span.setAttribute("item_1", value1);
span.setAttribute("item_2", value2);
// ... 100 more attributes

// GOOD: Aggregate
span.setAttribute("item_count", items.size());
span.setAttribute("total_value", calculateTotal(items));
```

#### 3. Use Conditional Instrumentation

```java showLineNumbers
public void processOrder(Order order) {
    // Only create detailed spans for high-value orders
    if (order.getValue() > 10000) {
        Span span = tracer.spanBuilder("process_high_value_order")
            .setAttribute("order.value", order.getValue())
            .startSpan();
        try (Scope scope = span.makeCurrent()) {
            // Detailed instrumentation
        } finally {
            span.end();
        }
    } else {
        // Regular processing without extra spans
        processRegularOrder(order);
    }
}
```

#### 4. Disable Unnecessary Instrumentation

```properties showLineNumbers
# Disable specific instrumentations to reduce overhead
otel.instrumentation.spring-webmvc.enabled=true
otel.instrumentation.jdbc.enabled=true
otel.instrumentation.kafka.enabled=true

# Disable if not needed
otel.instrumentation.logback.enabled=false
otel.instrumentation.annotations.enabled=false
```

## Frequently Asked Questions

### Choosing Between Approaches

**Q: Should I use the Java Agent, OpenTelemetry SDK Integration, or Spring Boot
4.0 Native?**

For most cases:

- **Quick start / Legacy apps**: Use **Java Agent** (zero code changes, fastest
  setup)
- **Production with flexibility**: Use **OpenTelemetry SDK Integration** (full API
  access, Spring config, GraalVM support)
- **Future (after GA)**: Consider **Spring Boot 4.0 Native** (Spring-native conventions)

See the [Choosing Your Approach](#choosing-your-approach) section for detailed
comparison and decision guide.

**Q: What's the difference between Java Agent and OpenTelemetry SDK Integration?**

**Java Agent**:

- Zero code changes - attach JAR at startup
- 150+ libraries auto-instrumented
- Environment variables only for configuration
- Limited custom instrumentation (annotations only)
- May have version compatibility issues

**OpenTelemetry SDK Integration**:

- Requires adding dependencies
- ~30 libraries auto-instrumented
- Spring configuration (`application.yml`) supported
- Full OpenTelemetry API for custom instrumentation
- Better for GraalVM native-image

**Q: Can I migrate from Java Agent to OpenTelemetry SDK Integration later?**

Yes! Start with the Java Agent for zero-code setup, then migrate to the
OpenTelemetry SDK Integration when you need:

- Custom span processors or exporters
- Programmatic span creation (not just annotations)
- Spring Boot native configuration files
- GraalVM native-image compilation

The migration just requires adding dependencies and removing the `-javaagent` flag.

**Q: Will the OpenTelemetry SDK integration continue to be supported after
Spring Boot 4.0?**

Yes. The OpenTelemetry SDK integration is independently maintained and will
continue to support current and future Spring Boot versions. It provides more
flexibility and direct OpenTelemetry API access compared to the native starter.

**Q: Can I use multiple instrumentation approaches together?**

No, you should use only one approach. They provide overlapping functionality and
using multiple approaches will cause conflicts:

- Don't use Java Agent + OpenTelemetry SDK Integration together
- Don't use OpenTelemetry SDK Integration + Spring Boot 4.0 Native together
- Choose one based on your needs (see decision guide)

**Q: Does the Java Agent work with GraalVM native-image?**

No, the Java Agent has poor support for GraalVM native-image compilation due to
bytecode manipulation incompatibilities. If you need native-image, use the
OpenTelemetry SDK Integration or Spring Boot 4.0 Native starter instead.

### General Questions

**Q: What is the minimum Spring Boot version required for OpenTelemetry?**

Spring Boot 2.7.0 is the minimum version, but Spring Boot 3.0+ is recommended
for the best compatibility and features. The OpenTelemetry Spring Boot starter
fully supports Spring Boot 3.x with native GraalVM support.

**Q: Does OpenTelemetry work with Java 25?**

Java 25 support is experimental as of September 2025. There are known ByteBuddy
compatibility issues causing Unsafe deprecation warnings. For production
deployments, we recommend Java 21 LTS. Monitor the
[OpenTelemetry Java releases](https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases)
for stable Java 25 support.

**Q: What's the difference between OpenTelemetry and JFR (Java Flight Recorder)?**

OpenTelemetry focuses on distributed tracing across microservices with
standardized telemetry, while JFR provides deep JVM-level profiling. Java 25's
JEP 520 adds method tracing to JFR, which can complement OpenTelemetry. You can
use both: JFR for low-level JVM metrics and OpenTelemetry for distributed
traces.

**Q: How much performance overhead does OpenTelemetry add?**

Typical overhead is 1-5ms per request, 2-5% CPU usage, and 50-200MB memory.
Impact varies based on instrumentation scope and collector network latency.

**Q: Can I use OpenTelemetry with Spring Boot 2.x?**

Yes, but you need older dependency versions. Use
`opentelemetry-spring-boot-starter` version 1.x for Spring Boot 2.7-2.x. Spring
Boot 3.x is recommended for the latest features and better performance.

### Configuration Questions

**Q: How do I prevent specific endpoints from being traced?**

Configure endpoint exclusions:

```properties showLineNumbers
# Exclude health check and metrics endpoints
otel.instrumentation.spring-webmvc.exclude-patterns=/actuator/**,/health,/metrics
```

**Q: Can I send traces to multiple backends?**

Yes, configure multiple exporters programmatically:

```java showLineNumbers
SpanExporter compositeExporter = SpanExporter.composite(
    OtlpHttpSpanExporter.builder().setEndpoint("http://scout:4318").build(),
    OtlpHttpSpanExporter.builder().setEndpoint("http://backup:4318").build()
);
```

### Troubleshooting Questions

**Q: Why are my database queries not appearing in traces?**

Enable JDBC instrumentation: `otel.instrumentation.jdbc.enabled=true` and
verify DataSource is created after OpenTelemetry initialization.

**Q: Why duplicate spans for the same operation?**

Multiple instrumentation libraries may overlap. Disable manual instrumentation
(remove `@WithSpan` annotations) where auto-instrumentation already exists.

### Spring-Specific Questions

**Q: How does OpenTelemetry work with Spring Cloud?**

OpenTelemetry integrates seamlessly with Spring Cloud components like Feign
clients, Spring Cloud Gateway, and Sleuth. For Spring Cloud 2021.0.3+,
OpenTelemetry can replace Sleuth entirely.

**Q: Can I use OpenTelemetry with Spring WebFlux?**

Yes, OpenTelemetry fully supports reactive Spring WebFlux applications with
automatic context propagation across reactive operators.

**Q: How do I instrument multi-tenant Spring Boot applications?**

Add tenant information as span attributes:

```java showLineNumbers
Span.current().setAttribute("tenant.id", SecurityContextHolder.getContext().getTenantId());
```

Configure tenant-based filtering as needed.

## What's Next

### Advanced Topics

- **[Custom Java Instrumentation](../custom-instrumentation/java.md)** - Deep
  dive into manual instrumentation, custom span processors, and advanced tracing
  patterns

### Deployment Guides

- **[Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)** -
  Deploy Scout Collector on Kubernetes with Helm charts
- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Run Scout Collector locally with Docker Compose
- **[AWS ECS Deployment](../../collector-setup/ecs-setup.md)** - Deploy
  instrumented Spring Boot apps on AWS ECS with Scout Collector
- **[Scout Collector Configuration](../../collector-setup/otel-collector-config.md)**
  \- Configure the OpenTelemetry Collector for production use

## Complete Example

For a fully working Spring Boot application with OpenTelemetry instrumentation,
refer to our example repository:

**[Spring Boot OpenTelemetry Example](https://github.com/base-14/examples/tree/main/java)**

The example includes:

- Complete Spring Boot 3.2 application with REST API
- Maven and Gradle build configurations
- OpenTelemetry auto-instrumentation setup
- Custom instrumentation examples for business logic
- JPA repository integration with database tracing
- Docker and Kubernetes deployment configurations
- docker-compose.yml for local development
- Environment-specific configuration (dev, staging, prod)
- Actuator health checks and metrics
- Integration tests with telemetry verification
- Security best practices for PII protection

### Quick Start with Example

```bash showLineNumbers
# Clone the repository
git clone https://github.com/base-14/examples.git
cd examples/java

# Run locally with Docker Compose
docker-compose up

# Access the application
curl http://localhost:8080/api/users

# View traces in Scout
open http://localhost:16686  # Jaeger UI for local testing
```

The example demonstrates:

- Automatic HTTP request tracing
- Database query instrumentation
- Custom business logic spans
- Error tracking and exception recording
- Metric collection and export
- Production-ready configuration patterns

## References

- [OpenTelemetry Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)
- Sample application:
  [Spring Boot OTel Instrumentation](https://github.com/base-14/examples/tree/main/java)

## Related Guides

- [Spring Boot Alternative Approaches](./spring-boot-alternatives.md) - Java
  Agent and Spring Boot 4.0 Native Starter approaches
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Deploy collector on Kubernetes
- [Custom Java Instrumentation](../custom-instrumentation/java.md) - Manual
  instrumentation for advanced use cases
- [Rails Instrumentation](./rails.md) - Ruby framework alternative
