---
title: Spring Boot OpenTelemetry Alternative Approaches - Java Agent & Native Starter
sidebar_label: Spring Boot Alternatives
sidebar_position: 10
description:
  Alternative approaches for Spring Boot OpenTelemetry instrumentation using
  Java Agent (zero-code) and Spring Boot 4.0 Native Starter (Micrometer-based).
keywords:
  [
    opentelemetry java agent,
    spring boot java agent,
    zero code instrumentation,
    spring boot 4.0 opentelemetry,
    micrometer opentelemetry,
    spring boot native starter,
    java agent instrumentation,
    bytecode instrumentation,
  ]
---

# Spring Boot OpenTelemetry Alternative Approaches

This guide covers alternative approaches to Spring Boot OpenTelemetry
instrumentation beyond the recommended OpenTelemetry SDK Integration approach.

> 📌 **Looking for the recommended approach?**
>
> See [Spring Boot OpenTelemetry Instrumentation](./spring-boot.md) for the
> **OpenTelemetry SDK Integration** approach, which provides the best balance of
> features, stability, and flexibility for most production use cases.

## Overview

While the [OpenTelemetry SDK Integration](./spring-boot.md) is our recommended
approach for most Spring Boot applications, there are scenarios where
alternative approaches may be more suitable:

- **Java Agent**: Zero-code instrumentation when you can't modify application
  code
- **Spring Boot 4.0 Native Starter**: Future Spring-native approach (currently
  preview)

### When to Use These Alternatives

**Use Java Agent when:**

- You need zero-code instrumentation (no dependency changes allowed)
- Working with legacy applications where code changes are difficult
- You want maximum auto-instrumentation coverage (150+ libraries)
- Operations team manages instrumentation separately from dev team
- Quick proof-of-concept without modifying application

**Use Spring Boot 4.0 Native Starter when:**

- Spring Boot 4.0 reaches General Availability (currently preview)
- You want simpler Spring Boot dependency management
- Your team is standardizing on Micrometer abstractions
- You don't need advanced OpenTelemetry SDK features

**Stick with OpenTelemetry SDK Integration for:**

- Production deployments requiring stability and full feature support
- GraalVM native-image compilation
- Full OpenTelemetry API access for custom instrumentation
- Advanced use cases (custom exporters, processors, samplers)
- Multi-framework observability (using OpenTelemetry across Java, Node.js, etc.)

## Prerequisites

### For Java Agent

- **Java**: JDK 8 or later (Java 25 has experimental support)
- **Spring Boot**: Any version (2.x, 3.x, or 4.x)
- **No dependencies required**: Java Agent works with any Spring Boot application
- **base14 Scout**: Running collector endpoint (see [Collector Setup](../../collector-setup/docker-compose-example.md))

### For Spring Boot 4.0 Native Starter

- **Java**: JDK 21 or later (Spring Boot 4.0 requirement)
- **Spring Boot**: 4.0.0 or later (currently preview, not GA)
- **base14 Scout**: Running collector endpoint

> ⚠️ **Spring Boot 4.0 Status**: Currently in preview. Not recommended for
> production use until GA release.

For general prerequisites and compatibility, see the [OpenTelemetry SDK
Integration guide](./spring-boot.md#prerequisites).

## Java Agent Approach

The Java Agent provides zero-code automatic instrumentation by attaching to your
JVM at startup. This is the fastest way to add OpenTelemetry to Spring Boot
applications without any code or dependency changes.

### Download the Agent

Download the latest OpenTelemetry Java agent JAR:

```bash showLineNumbers
# Using wget
wget https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar

# Or using curl
curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

For specific versions:

```bash showLineNumbers
# Download specific version (e.g., v2.10.0)
wget https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.10.0/opentelemetry-javaagent.jar
```

### Basic Configuration

Configure the agent using environment variables:

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

# Optional: Logging configuration
OTEL_LOG_LEVEL=info
```

### Running Your Application

Attach the agent when starting your Spring Boot application:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="jar" label="JAR Execution" default>
```

```bash showLineNumbers
# Basic usage
java -javaagent:opentelemetry-javaagent.jar \
  -jar your-spring-app.jar

# With environment variables
export OTEL_SERVICE_NAME=my-service
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

java -javaagent:opentelemetry-javaagent.jar \
  -jar target/my-service-1.0.0.jar

# With JVM system properties
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.service.name=my-service \
  -Dotel.exporter.otlp.endpoint=http://localhost:4318 \
  -jar your-spring-app.jar
```

```mdx-code-block
</TabItem>
<TabItem value="maven" label="Maven (Spring Boot Plugin)">
```

```bash showLineNumbers
# Set environment variables
export OTEL_SERVICE_NAME=my-service
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run with Maven
mvn spring-boot:run -Dspring-boot.run.jvmArguments="-javaagent:opentelemetry-javaagent.jar"
```

```mdx-code-block
</TabItem>
<TabItem value="gradle" label="Gradle">
```

```bash showLineNumbers
# Set environment variables
export OTEL_SERVICE_NAME=my-service
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run with Gradle
./gradlew bootRun --args='--javaagent:opentelemetry-javaagent.jar'
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Docker Configuration

Add the agent to your Docker image:

```docker title="Dockerfile" showLineNumbers
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

# Download OpenTelemetry Java agent
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

# Copy application JAR
COPY target/my-service-1.0.0.jar /app/app.jar

# Set environment variables (can be overridden at runtime)
ENV OTEL_SERVICE_NAME=my-service
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
ENV OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production

# Run application with agent
ENTRYPOINT ["java", "-javaagent:/app/opentelemetry-javaagent.jar", "-jar", "/app/app.jar"]
```

### Docker Compose

Configure the agent with Docker Compose:

```yaml title="docker-compose.yml" showLineNumbers
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      OTEL_SERVICE_NAME: my-service
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=dev,service.version=1.0.0
      OTEL_TRACES_EXPORTER: otlp
      OTEL_METRICS_EXPORTER: otlp
      OTEL_LOGS_EXPORTER: otlp
    depends_on:
      - scout-collector

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4318:4318"
```

### Kubernetes Deployment

Deploy with the agent in Kubernetes using an init container:

```yaml title="k8s-deployment.yaml" showLineNumbers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spring-boot-app
spec:
  template:
    spec:
      initContainers:
      - name: agent-downloader
        image: busybox:latest
        command: [sh, -c]
        args:
        - wget -O /otel-agent/opentelemetry-javaagent.jar https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
        volumeMounts:
        - {name: otel-agent, mountPath: /otel-agent}
      containers:
      - name: app
        image: myregistry/spring-boot-app:1.2.3
        env:
        - name: JAVA_TOOL_OPTIONS
          value: "-javaagent:/otel-agent/opentelemetry-javaagent.jar"
        - name: OTEL_SERVICE_NAME
          value: "spring-boot-app"
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: "http://scout-collector.observability.svc:4318"
        - name: OTEL_RESOURCE_ATTRIBUTES
          value: "deployment.environment=prod"
        volumeMounts:
        - {name: otel-agent, mountPath: /otel-agent}
      volumes:
      - name: otel-agent
        emptyDir: {}
```

### Advanced Configuration

Fine-tune agent behavior with additional environment variables:

```bash title="advanced-config.env" showLineNumbers
# Disable specific instrumentations
OTEL_INSTRUMENTATION_SPRING_WEBMVC_ENABLED=true
OTEL_INSTRUMENTATION_JDBC_ENABLED=true
OTEL_INSTRUMENTATION_LOGBACK_ENABLED=false

# Sampling (1% of traces)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.01

# Batch processor tuning
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

See [OpenTelemetry Java Agent
Configuration](https://opentelemetry.io/docs/zero-code/java/agent/configuration/)
for all options.

### Supported Libraries

The Java agent automatically instruments **150+ libraries** including Spring MVC/WebFlux,
Spring Data JPA, JDBC drivers, Hibernate, MongoDB, Redis, Kafka, RestTemplate,
WebClient, Apache HttpClient, and more.

See the [complete list of supported libraries](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md).

### Custom Instrumentation with Agent

While the agent provides automatic instrumentation, you can add custom spans
using annotations:

```java title="src/main/java/com/example/service/PaymentService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.instrumentation.annotations.WithSpan;
import io.opentelemetry.instrumentation.annotations.SpanAttribute;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    // Automatically creates a span named "processPayment"
    @WithSpan
    public PaymentResult processPayment(
        @SpanAttribute("payment.amount") double amount,
        @SpanAttribute("payment.method") String method
    ) {
        // Business logic
        validatePayment(amount, method);
        return chargeCustomer(amount, method);
    }

    // Custom span name
    @WithSpan(value = "validate-payment")
    private void validatePayment(double amount, String method) {
        // Validation logic
    }
}
```

> ℹ️ **Note**: The Java agent only supports annotation-based custom
> instrumentation. For programmatic span creation and full OpenTelemetry API
> access, use the [OpenTelemetry SDK Integration](./spring-boot.md#custom-instrumentation)
> approach.

### Agent Limitations

Be aware of these limitations when using the Java agent:

1. **Version Compatibility**: Agent must match library versions (bytecode
   mismatch can cause issues)
2. **GraalVM Native Image**: Poor support for native compilation
3. **Agent Conflicts**: May conflict with other agents (APM tools, profilers)
4. **No Spring Configuration**: Can't use `application.yml` (environment
   variables only)
5. **Limited Custom Instrumentation**: Annotations only, no full API access
6. **Debugging**: Bytecode manipulation issues harder to troubleshoot

### Verifying Agent is Running

Check agent startup in logs:

```bash showLineNumbers
java -javaagent:opentelemetry-javaagent.jar -jar app.jar
# Look for: [otel.javaagent] OpenTelemetry Javaagent 2.10.0
```

Test with any HTTP endpoint and verify traces appear in Scout UI.

## Spring Boot 4.0 Native Starter Approach

Spring Boot 4.0 (currently in preview, not yet GA) introduces native
OpenTelemetry support with `spring-boot-starter-opentelemetry`, available
directly from start.spring.io.

> ⚠️ **Production Warning**: Spring Boot 4.0 is currently in preview and not
> recommended for production use. Wait for GA release before migrating
> production systems.

### Setup

If you're using Spring Boot 4.0 (preview) and want to try the native
OpenTelemetry starter:

```mdx-code-block
<Tabs>
<TabItem value="maven-native" label="Maven (Spring Boot 4.0)">
```

```xml title="pom.xml" showLineNumbers
<properties>
    <!-- Spring Boot 4.0 manages OpenTelemetry versions -->
    <!-- No need to specify versions manually -->
</properties>

<!-- No dependencyManagement needed - Spring Boot 4.0 manages this -->

<dependencies>
    <!-- Spring Boot Starters -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <!-- Spring Boot 4.0 Native OpenTelemetry Starter -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-opentelemetry</artifactId>
    </dependency>
</dependencies>
```

```mdx-code-block
</TabItem>
<TabItem value="gradle-native" label="Gradle (Spring Boot 4.0)">
```

```groovy title="build.gradle" showLineNumbers
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.0'
    id 'io.spring.dependency-management' version '1.1.4'
}

// No need to specify OpenTelemetry versions
// Spring Boot 4.0 manages all OpenTelemetry dependencies

dependencies {
    // Spring Boot Starters
    implementation 'org.springframework.boot:spring-boot-starter-web'

    // Spring Boot 4.0 Native OpenTelemetry Starter
    implementation 'org.springframework.boot:spring-boot-starter-opentelemetry'
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

> ℹ️ **Note**: The native starter uses Micrometer APIs instead of direct
> OpenTelemetry APIs for custom instrumentation. See the [Migration
> Guide](#migrating-from-opentelemetry-sdk-integration-to-spring-boot-40) for API
> differences.

### Configuration

Configuration is similar to OpenTelemetry SDK Integration but managed by Spring
Boot 4.0:

```properties title="src/main/resources/application.properties" showLineNumbers
# Service identification
otel.service.name=my-service
otel.resource.attributes=service.namespace=my-namespace,deployment.environment=production

# OTLP Exporter
otel.exporter.otlp.endpoint=http://scout-collector:4318
otel.exporter.otlp.protocol=http/protobuf
otel.traces.exporter=otlp
otel.metrics.exporter=otlp
```

See the [SDK Integration configuration
guide](./spring-boot.md#configuration) for more configuration options.

## Migrating from OpenTelemetry SDK Integration to Spring Boot 4.0

If you're currently using the OpenTelemetry SDK integration and want to migrate
to Spring Boot 4.0's native starter once it reaches GA, follow this migration
guide.

> ⚠️ **Timing**: Spring Boot 4.0 is currently in preview. Wait for GA release
> before migrating production systems.

### Why Migrate?

**Consider migrating when:**

- Spring Boot 4.0 reaches General Availability
- You want simpler dependency management
- Your team is standardizing on Micrometer abstractions
- You don't need advanced OpenTelemetry SDK features

**Stay with OpenTelemetry SDK integration if:**

- You need fine-grained SDK control
- You use OpenTelemetry across multiple frameworks
- You require custom span processors or exporters
- You want the latest OpenTelemetry features immediately

### Migration Steps

#### Step 1: Update Spring Boot Version

```xml title="pom.xml" showLineNumbers
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <!-- <version>3.5.7</version> -->
    <version>4.0.0</version>
    <relativePath/>
</parent>
```

#### Step 2: Replace Dependencies

**Remove OpenTelemetry SDK integration:**

```xml
<!-- Remove these -->
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-spring-boot-starter</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-otlp</artifactId>
</dependency>
```

**Add native starter:**

```xml
<!-- Add this -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-opentelemetry</artifactId>
</dependency>
```

#### Step 3: Remove BOM (Optional)

Spring Boot 4.0 manages OpenTelemetry versions:

```xml
<!-- Can remove this from dependencyManagement -->
<!--
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-instrumentation-bom</artifactId>
    <version>2.21.0</version>
    <type>pom</type>
    <scope>import</scope>
</dependency>
-->
```

#### Step 4: Update Configuration Properties

Configuration properties are largely compatible. Update prefixes if needed:

```properties
# OpenTelemetry SDK Integration (old)
otel.service.name=my-service
otel.exporter.otlp.endpoint=http://localhost:4318

# Spring Boot 4.0 Native (same - no changes needed)
otel.service.name=my-service
otel.exporter.otlp.endpoint=http://localhost:4318
```

#### Step 5: Migrate Custom Instrumentation Code

Replace OpenTelemetry API with Micrometer API:

**OpenTelemetry SDK Integration (OpenTelemetry API):**

```java
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Scope;

@Service
public class PaymentService {
    private final Tracer tracer;

    public PaymentService(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer("payment-service");
    }

    public void processPayment(PaymentRequest request) {
        Span span = tracer.spanBuilder("process_payment")
            .setAttribute("payment.amount", request.getAmount())
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            // Business logic
            chargeCustomer(request);
            span.setStatus(StatusCode.OK);
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, "Payment failed");
            throw e;
        } finally {
            span.end();
        }
    }
}
```

**Spring Boot 4.0 Native (Micrometer API):**

```java
import io.micrometer.tracing.Tracer;
import io.micrometer.tracing.Span;

@Service
public class PaymentService {
    private final Tracer tracer;

    public PaymentService(Tracer tracer) {
        this.tracer = tracer;
    }

    public void processPayment(PaymentRequest request) {
        Span span = tracer.nextSpan().name("process_payment").start();

        try (Tracer.SpanInScope ws = tracer.withSpan(span)) {
            // Business logic
            span.tag("payment.amount", String.valueOf(request.getAmount()));
            chargeCustomer(request);
        } catch (Exception e) {
            span.error(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

#### Step 6: Update Custom Metrics

**OpenTelemetry SDK Integration (OpenTelemetry Metrics):**

```java
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;

@Component
public class BusinessMetrics {
    private final LongCounter orderCounter;

    public BusinessMetrics(OpenTelemetry openTelemetry) {
        Meter meter = openTelemetry.getMeter("business-metrics");
        this.orderCounter = meter.counterBuilder("orders.created")
            .setDescription("Total orders created")
            .build();
    }

    public void recordOrder() {
        orderCounter.add(1);
    }
}
```

**Spring Boot 4.0 Native (Micrometer Metrics):**

```java
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Counter;

@Component
public class BusinessMetrics {
    private final Counter orderCounter;

    public BusinessMetrics(MeterRegistry meterRegistry) {
        this.orderCounter = meterRegistry.counter("orders.created",
            "description", "Total orders created");
    }

    public void recordOrder() {
        orderCounter.increment();
    }
}
```

### API Comparison Cheat Sheet

| Task | OpenTelemetry SDK Integration (OTEL API) | Spring Boot 4.0 (Micrometer) |
|------|------------------------------|------------------------------|
| **Create span** | `tracer.spanBuilder("name").startSpan()` | `tracer.nextSpan().name("name").start()` |
| **Set attribute** | `span.setAttribute("key", "value")` | `span.tag("key", "value")` |
| **Record exception** | `span.recordException(e)` | `span.error(e)` |
| **Create scope** | `try (Scope scope = span.makeCurrent())` | `try (Tracer.SpanInScope ws = tracer.withSpan(span))` |
| **Set status** | `span.setStatus(StatusCode.OK)` | Auto-managed by Micrometer |
| **Create counter** | `meter.counterBuilder("name").build()` | `meterRegistry.counter("name")` |
| **Increment counter** | `counter.add(1)` | `counter.increment()` |

### Testing the Migration

1. **Build the application**: Ensure no compilation errors
2. **Run locally**: Test with local collector
3. **Verify traces**: Check that spans appear in Scout
4. **Check metrics**: Ensure metrics are exported
5. **Test custom instrumentation**: Verify custom spans and attributes
6. **Performance test**: Compare overhead with OpenTelemetry SDK integration

### Rollback Plan

If you encounter issues:

1. Revert to Spring Boot 3.x in `pom.xml`
2. Restore OpenTelemetry SDK integration dependencies
3. Restore OpenTelemetry API imports
4. Rebuild and redeploy

### When to Migrate

**Recommended timeline:**

- **Now**: Experiment in development environments
- **After GA**: Evaluate in staging environments
- **6 months post-GA**: Consider production migration after community adoption

**Key indicators for migration:**

- Spring Boot 4.0 GA released
- Positive community feedback
- Your use case doesn't require advanced SDK features
- Team comfortable with Micrometer APIs

## Troubleshooting

### Java Agent Issues

#### Agent Not Loading

**Symptom**: No traces appearing in Scout, no agent startup message in logs.

**Solution**:

```bash
# Verify agent path is correct
ls -lh opentelemetry-javaagent.jar

# Check JVM is actually loading the agent
java -javaagent:opentelemetry-javaagent.jar -jar app.jar
# Should see: [otel.javaagent] OpenTelemetry Javaagent 2.10.0
```

#### Version Compatibility Issues

**Symptom**: ClassNotFoundException, NoClassDefFoundError, or bytecode errors.

**Solution**:

- Update to latest Java agent version
- Check [supported libraries list](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md)
- Disable specific instrumentations if conflicts occur:

```bash
OTEL_INSTRUMENTATION_[LIBRARY]_ENABLED=false
```

#### Java 25 Unsafe Deprecation Warnings

**Symptom**: Warnings about `sun.misc.Unsafe` when using Java 25.

**Solution**:

Java 25 has experimental support. Add JVM flag to suppress warnings:

```bash
java -javaagent:opentelemetry-javaagent.jar \
  --add-opens=java.base/sun.nio.ch=ALL-UNNAMED \
  -jar app.jar
```

Or use Java 21 LTS for production.

#### Agent Conflicts with Other Tools

**Symptom**: Application fails to start or behaves incorrectly when agent is attached.

**Solution**:

- Check for other JVM agents (APM tools, profilers)
- Load OpenTelemetry agent last in `-javaagent` list
- Consider using OpenTelemetry SDK Integration instead for better compatibility

### Spring Boot 4.0 Issues

#### Micrometer API Confusion

**Symptom**: Compilation errors when trying to use OpenTelemetry API directly.

**Solution**:

Spring Boot 4.0 Native Starter uses Micrometer, not OpenTelemetry API directly:

```java
// Don't use OpenTelemetry API
// import io.opentelemetry.api.trace.Tracer;

// Use Micrometer API instead
import io.micrometer.tracing.Tracer;
```

See [API Comparison](#api-comparison-cheat-sheet) for migration guide.

#### Dependency Management Issues

**Symptom**: Version conflicts or missing dependencies.

**Solution**:

Remove custom OpenTelemetry BOMs - Spring Boot 4.0 manages versions:

```xml
<!-- Remove from dependencyManagement -->
<!--
<dependency>
    <groupId>io.opentelemetry.instrumentation</groupId>
    <artifactId>opentelemetry-instrumentation-bom</artifactId>
    ...
</dependency>
-->
```

### For Other Issues

See the [SDK Integration troubleshooting
guide](./spring-boot.md#troubleshooting) for:

- Framework-specific issues (Spring MVC, JPA, etc.)
- Security considerations
- Performance optimization
- General OpenTelemetry problems

## Frequently Asked Questions

### When should I use Java Agent vs OpenTelemetry SDK Integration?

**Use Java Agent for:**

- Zero-code requirement (no dependency changes)
- Legacy apps where code changes are difficult
- Quick POC or evaluation
- Ops-managed instrumentation

**Use OpenTelemetry SDK Integration for:**

- Production deployments
- GraalVM native-image
- Custom instrumentation needs
- Spring Boot configuration patterns

See the [approach comparison guide](./spring-boot.md#choosing-your-approach)
for a detailed decision guide.

### Is Spring Boot 4.0 Native Starter ready for production?

No. Spring Boot 4.0 is currently in preview. Wait for:

- GA release announcement
- Community adoption and feedback
- Stability verification in your environment

Continue using OpenTelemetry SDK Integration for production systems.

### Can I use Java Agent with Spring Boot 4.0?

Yes! Java Agent works with any Spring Boot version (2.x, 3.x, or 4.x). It's
version-agnostic since it uses bytecode instrumentation rather than
dependencies.

### Will Java Agent work with GraalVM native-image?

No. Java Agent relies on bytecode manipulation which doesn't work well with
native compilation. Use [OpenTelemetry SDK Integration](./spring-boot.md) for GraalVM
support.

### Can I use application.yml with Java Agent?

No. Java Agent only supports environment variables for configuration. You cannot
use `application.yml` or `application.properties` for OpenTelemetry
configuration when using the agent.

For Spring Boot configuration support, use [OpenTelemetry SDK
Integration](./spring-boot.md#configuration).

## Related Resources

### Recommended Approach

- [Spring Boot OpenTelemetry Instrumentation](./spring-boot.md) - Our
  recommended **OpenTelemetry SDK Integration** approach with complete setup,
  configuration, and production guidance

### Additional Resources

The following topics are covered in the SDK Integration guide:

- [Framework-Specific Features](./spring-boot.md#framework-specific-features) -
  Spring MVC, JPA, RestTemplate, WebClient
- [Security Considerations](./spring-boot.md#security-considerations) -
  Sensitive data masking, compliance
- [Performance Considerations](./spring-boot.md#performance-considerations) -
  Optimization and overhead analysis
- [Running Your Application](./spring-boot.md#running-your-application) - Local
  development and production deployment

### Reference

- [OpenTelemetry Java Agent Documentation](https://opentelemetry.io/docs/zero-code/java/agent/)
- [Spring Boot 4.0 Release Notes](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Release-Notes)
- [Micrometer Tracing Documentation](https://micrometer.io/docs/tracing)
- [base14 Scout Documentation](/)

### Related Guides

- [Custom Ruby Instrumentation](../custom-instrumentation/ruby.md) - Manual
  instrumentation patterns
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development collector setup
- [Kubernetes Deployment](../../collector-setup/kubernetes-helm-setup.md) -
  Production collector deployment
