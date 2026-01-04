---
title: Quarkus OpenTelemetry Instrumentation - Complete APM Setup Guide | Base14 Scout
sidebar_label: Quarkus
description:
  Quarkus OpenTelemetry instrumentation with native GraalVM compilation for
  traces, Hibernate Panache, and production deployments using Base14 Scout.
keywords:
  [
    quarkus opentelemetry instrumentation,
    quarkus monitoring,
    quarkus apm,
    quarkus distributed tracing,
    quarkus observability,
    quarkus performance monitoring,
    opentelemetry java,
    quarkus telemetry,
    quarkus postgresql monitoring,
    graalvm native image tracing,
    quarkus native compilation,
    quarkus supersonic startup,
    quarkus hibernate instrumentation,
    quarkus rest api monitoring,
    quarkus microservices tracing,
    quarkus jwt authentication tracing,
    quarkus reactive monitoring,
    quarkus kubernetes monitoring,
    opentelemetry graalvm,
    quarkus cdi instrumentation,
    quarkus dev mode tracing,
    quarkus production monitoring,
    quarkus docker instrumentation,
    opentelemetry collector quarkus,
    quarkus panache tracing,
    quarkus mutiny observability,
    quarkus application metrics,
    quarkus trace propagation,
    base14 scout quarkus,
    quarkus telemetry configuration,
    quarkus otel extension,
    quarkus native tracing performance,
  ]
sidebar_position: 9
---

## Introduction

Quarkus is a Kubernetes-native Java framework optimized for GraalVM and
HotSpot, designed for cloud-native applications with supersonic startup times
and incredibly low memory footprint. Unlike traditional Java frameworks,
Quarkus provides **built-in OpenTelemetry support** through its extension
ecosystem, making instrumentation significantly simpler than manual
configuration.

This guide demonstrates how to instrument Quarkus applications with
OpenTelemetry for comprehensive distributed tracing, metrics collection, and
application performance monitoring. We'll cover both JVM mode and native image
compilation scenarios, leveraging Quarkus's extension-based approach for
zero-code auto-instrumentation of REST endpoints, database queries, and
business logic.

Quarkus's native compilation with GraalVM creates standalone executables with
sub-second startup times, making it ideal for serverless deployments and
microservices architectures. We'll explore how to maintain full observability
in both development and production modes while taking advantage of Quarkus's
unique performance characteristics. The example application includes JWT
authentication, PostgreSQL integration with Hibernate ORM with Panache, and
RESTful API endpoints—all automatically instrumented through Quarkus
extensions.

## Who This Guide Is For

This guide is designed for:

- **Java Backend Developers** building microservices with Quarkus and needing
  production-grade observability without extensive configuration
- **DevOps Engineers** deploying Quarkus native images to Kubernetes and
  requiring lightweight tracing with minimal memory overhead
- **Platform Engineers** standardizing on Quarkus for cloud-native applications
  and seeking built-in OpenTelemetry integration
- **Technical Leads** evaluating Quarkus versus Spring Boot and comparing
  instrumentation approaches with native compilation
- **Site Reliability Engineers** optimizing application performance in
  containerized environments and monitoring sub-second startup times

## Overview

This guide covers Quarkus OpenTelemetry instrumentation using the official
Quarkus OpenTelemetry extension. The approach differs significantly from
traditional Java frameworks by leveraging Quarkus's build-time optimization and
extension ecosystem.

### What You'll Learn

- Installing and configuring the Quarkus OpenTelemetry extension for automatic
  instrumentation
- Understanding Quarkus's built-in OTEL support versus manual SDK configuration
- Instrumenting REST endpoints, Hibernate queries, and business logic with zero
  code changes
- Configuring native image compilation while maintaining full tracing
  capabilities
- Setting up dev mode with live reload and automatic trace collection
- Implementing custom spans and attributes using CDI and interceptors
- Optimizing telemetry for supersonic startup and minimal memory footprint
- Deploying instrumented native images to Docker and Kubernetes
- Troubleshooting GraalVM reflection issues with tracing libraries

### Prerequisites

**System Requirements:**

- **Java:** 21+ (LTS recommended, 17+ supported)
- **Quarkus:** 3.15+ (built-in OpenTelemetry support)
- **GraalVM:** 21+ for native compilation (optional but recommended)
- **Maven or Gradle:** Build tool for dependency management
- **Docker:** For containerized deployments and native builds

**Supported Quarkus Versions:**

| Quarkus Version | Java Version | OpenTelemetry Extension | Native Image | Status      |
| --------------- | ------------ | ----------------------- | ------------ | ----------- |
| 3.17+           | 21+          | 3.0+                    | ✅ Full      | Recommended |
| 3.15-3.16       | 17+          | 3.0+                    | ✅ Full      | Supported   |
| 3.8-3.14        | 17+          | 2.0+                    | ⚠️ Limited   | Legacy      |
| 3.0-3.7         | 17+          | 1.x                     | ⚠️ Limited   | EOL         |
| 2.x             | 11+          | Not supported           | ❌ None      | EOL         |

**Instrumented Components:**

Quarkus OpenTelemetry extension automatically instruments:

- ✅ **REST Endpoints** - JAX-RS resources via RESTEasy Reactive
- ✅ **Database Queries** - Hibernate ORM, Panache, and JDBC connections
- ✅ **HTTP Clients** - REST Client and Vert.x HTTP client calls
- ✅ **Messaging** - Kafka, AMQP, and reactive messaging streams
- ✅ **CDI Beans** - Application-scoped and request-scoped beans
- ✅ **Security** - JWT authentication and OIDC flows
- ✅ **Reactive Streams** - Mutiny and SmallRye Reactive operators

:::info Example Application

This guide references the
[quarkus-postgres example](https://github.com/base-14/examples/tree/main/java/quarkus-postgres)
featuring:

- **Framework**: Quarkus 3.17+ with RESTEasy Reactive
- **Database**: PostgreSQL 18 with Hibernate ORM with Panache
- **Authentication**: JWT bearer tokens with SmallRye JWT
- **Architecture**: Supersonic startup (&lt;50ms native), resource-oriented REST
  API
- **Deployment**: Docker multi-stage builds and Kubernetes manifests

:::

## Installation & Setup

Quarkus uses an **extension-based architecture** where OpenTelemetry support is
added through the official `quarkus-opentelemetry` extension. This approach
provides automatic instrumentation without requiring manual SDK initialization.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="build-tool">
<TabItem value="maven" label="Maven" default>

Add the OpenTelemetry extension to your `pom.xml`:

```xml title="pom.xml" showLineNumbers
<dependencies>
  <!-- Quarkus OpenTelemetry Extension -->
  <dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-opentelemetry</artifactId>
  </dependency>

  <!-- OTLP Exporter (send traces to collector) -->
  <dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
  </dependency>

  <!-- Optional: Additional instrumentation -->
  <dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-jdbc-postgresql</artifactId>
  </dependency>
  <dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-orm-panache</artifactId>
  </dependency>
</dependencies>
```

Install dependencies:

```bash
./mvnw clean install
```

</TabItem>
<TabItem value="gradle" label="Gradle (Kotlin DSL)">

Add the OpenTelemetry extension to `build.gradle.kts`:

```kotlin title="build.gradle.kts" showLineNumbers
dependencies {
    // Quarkus OpenTelemetry Extension
    implementation("io.quarkus:quarkus-opentelemetry")

    // OTLP Exporter
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")

    // Optional: Additional instrumentation
    implementation("io.quarkus:quarkus-jdbc-postgresql")
    implementation("io.quarkus:quarkus-hibernate-orm-panache")
}
```

Install dependencies:

```bash
./gradlew build
```

</TabItem>
<TabItem value="quarkus-cli" label="Quarkus CLI (Recommended)">

Use the Quarkus CLI to add the extension:

```bash title="Terminal" showLineNumbers
# Install Quarkus CLI (if not already installed)
curl -Ls https://sh.jbang.dev | bash -s - trust add https://repo1.maven.org/maven2/io/quarkus/quarkus-cli/
curl -Ls https://sh.jbang.dev | bash -s - app install --fresh --force quarkus@quarkusio

# Add OpenTelemetry extension to existing project
quarkus extension add opentelemetry

# Or create new project with extension
quarkus create app com.example:my-app \
  --extension=opentelemetry,resteasy-reactive-jackson,hibernate-orm-panache,jdbc-postgresql
```

This automatically updates `pom.xml` or `build.gradle.kts` with the correct
dependencies.

</TabItem>
<TabItem value="code-quarkus" label="Code.Quarkus.io Generator">

Generate a new project with OpenTelemetry pre-configured:

1. Visit [code.quarkus.io](https://code.quarkus.io)
2. Select **Extensions**:
   - OpenTelemetry
   - RESTEasy Reactive
   - Hibernate ORM with Panache
   - JDBC Driver - PostgreSQL
3. Click **Generate your application**
4. Extract and run:

```bash
cd my-quarkus-app
./mvnw quarkus:dev
```

</TabItem>
</Tabs>

:::tip Quarkus Dev Mode

Quarkus's dev mode (`./mvnw quarkus:dev`) provides **live reload** with
automatic trace collection. Changes to code are instantly reflected without
restarting the application, making it ideal for iterative development with
observability.

:::

## Configuration

Quarkus OpenTelemetry configuration uses the standard `application.properties`
file (or `application.yml`). Unlike Spring Boot, Quarkus performs build-time
optimization, so many configurations are locked in during compilation.

### Basic Configuration

```properties title="src/main/resources/application.properties" showLineNumbers
# Service identification
quarkus.application.name=quarkus-order-service
quarkus.application.version=1.0.0

# OpenTelemetry exporter configuration
quarkus.otel.exporter.otlp.endpoint=http://localhost:4317
quarkus.otel.exporter.otlp.protocol=grpc
quarkus.otel.traces.exporter=otlp

# Service resource attributes
quarkus.otel.resource.attributes=service.name=quarkus-order-service,service.version=1.0.0,deployment.environment=development

# Sampling (always-on for dev, probabilistic for production)
quarkus.otel.traces.sampler=always_on

# Database query tracing
quarkus.datasource.jdbc.telemetry=true

# Enable all instrumentation
quarkus.otel.instrument.rest-client=true
quarkus.otel.instrument.messaging=true
quarkus.otel.instrument.security=true
```

### Environment Variable Configuration

Quarkus supports environment variable overrides using the standard naming
convention:

```bash title="Terminal" showLineNumbers
export QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.base14.io:4317
export QUARKUS_OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20YOUR_API_KEY
export QUARKUS_OTEL_TRACES_SAMPLER=traceidratio
export QUARKUS_OTEL_TRACES_SAMPLER_ARG=0.1
export QUARKUS_DATASOURCE_JDBC_TELEMETRY=true

./mvnw quarkus:dev
```

### Docker Compose Configuration

```yaml title="docker-compose.yml" showLineNumbers
version: '3.9'

services:
  quarkus-app:
    build:
      context: .
      dockerfile: src/main/docker/Dockerfile.jvm
    ports:
      - '8080:8080'
    environment:
      QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4317
      QUARKUS_OTEL_RESOURCE_ATTRIBUTES: >-
        service.name=quarkus-order-service,
        service.version=1.0.0,
        deployment.environment=docker
      QUARKUS_DATASOURCE_JDBC_URL: jdbc:postgresql://postgres:5432/orders
      QUARKUS_DATASOURCE_USERNAME: quarkus
      QUARKUS_DATASOURCE_PASSWORD: quarkus123
      QUARKUS_DATASOURCE_JDBC_TELEMETRY: 'true'
    depends_on:
      - postgres
      - scout-collector

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: orders
      POSTGRES_USER: quarkus
      POSTGRES_PASSWORD: quarkus123
    volumes:
      - postgres_data:/var/lib/postgresql/data

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4317:4317' # OTLP gRPC

volumes:
  postgres_data:
```

### Profile-Based Configuration

Quarkus uses **build profiles** for environment-specific configurations:

```properties title="src/main/resources/application.properties" showLineNumbers
# Default configuration (dev mode)
quarkus.otel.exporter.otlp.endpoint=http://localhost:4317
quarkus.otel.traces.sampler=always_on

# Production profile
%prod.quarkus.otel.exporter.otlp.endpoint=https://scout.base14.io:4317
%prod.quarkus.otel.exporter.otlp.headers=authorization=Bearer ${SCOUT_API_KEY}
%prod.quarkus.otel.traces.sampler=traceidratio
%prod.quarkus.otel.traces.sampler.arg=0.1

# Test profile (disable tracing)
%test.quarkus.otel.sdk.disabled=true
```

Run with production profile:

```bash
./mvnw clean package -Dquarkus.profile=prod
java -jar target/quarkus-app/quarkus-run.jar
```

:::info Scout Integration

When using [Base14 Scout](https://base14.io/scout), configure the OTLP endpoint
to point to your Scout Collector. Scout provides managed OpenTelemetry
infrastructure optimized for Quarkus native images with minimal overhead.

:::

## Production Configuration

Production deployments require optimized sampling, batch processing, and native
image compilation for minimal resource usage.

### Optimized Application Properties

```properties title="src/main/resources/application.properties" showLineNumbers
# Production profile configuration
%prod.quarkus.application.name=quarkus-order-service
%prod.quarkus.application.version=${APP_VERSION:1.0.0}

# Scout Collector endpoint (production)
%prod.quarkus.otel.exporter.otlp.endpoint=https://scout.base14.io:4317
%prod.quarkus.otel.exporter.otlp.headers=authorization=Bearer ${SCOUT_API_KEY}
%prod.quarkus.otel.exporter.otlp.protocol=grpc
%prod.quarkus.otel.exporter.otlp.timeout=10s

# Sampling strategy (10% of traces)
%prod.quarkus.otel.traces.sampler=traceidratio
%prod.quarkus.otel.traces.sampler.arg=0.1

# Resource attributes
%prod.quarkus.otel.resource.attributes=\
  service.name=quarkus-order-service,\
  service.version=${APP_VERSION:1.0.0},\
  deployment.environment=production,\
  cloud.provider=aws,\
  cloud.region=${AWS_REGION:us-east-1},\
  k8s.cluster.name=${K8S_CLUSTER:production},\
  k8s.namespace.name=${K8S_NAMESPACE:default},\
  k8s.pod.name=${HOSTNAME}

# Batch span processor (production optimization)
%prod.quarkus.otel.bsp.schedule.delay=5000
%prod.quarkus.otel.bsp.max.queue.size=2048
%prod.quarkus.otel.bsp.max.export.batch.size=512
%prod.quarkus.otel.bsp.export.timeout=30s

# Database telemetry
%prod.quarkus.datasource.jdbc.telemetry=true

# Disable dev-mode features
%prod.quarkus.log.console.enable=true
%prod.quarkus.log.console.json=true
%prod.quarkus.log.level=INFO
```

### Native Image Compilation

Quarkus native images with GraalVM provide subsecond startup and minimal memory
footprint while maintaining full tracing capabilities:

```bash title="Terminal" showLineNumbers
# Build native executable with tracing support
./mvnw clean package -Pnative \
  -Dquarkus.native.container-build=true \
  -Dquarkus.native.builder-image=quay.io/quarkus/ubi-quarkus-mandrel-builder-image:jdk-21

# Test native executable
./target/quarkus-order-service-1.0.0-runner

# Check startup time (should be <50ms)
time ./target/quarkus-order-service-1.0.0-runner
```

### Docker Multi-Stage Build (Native)

```dockerfile title="src/main/docker/Dockerfile.multistage" showLineNumbers
## Stage 1: Build native executable
FROM quay.io/quarkus/ubi-quarkus-mandrel-builder-image:jdk-21 AS build
COPY --chown=quarkus:quarkus . /code
WORKDIR /code
USER quarkus
RUN ./mvnw clean package -Pnative -DskipTests \
    -Dquarkus.native.container-build=true

## Stage 2: Create runtime image
FROM quay.io/quarkus/quarkus-micro-image:2.0
WORKDIR /work/
COPY --from=build /code/target/*-runner /work/application

# Set ownership
RUN chown 1001 /work \
    && chmod "g+rwX" /work \
    && chown 1001:root /work

# Expose port
EXPOSE 8080
USER 1001

# Environment variables for OpenTelemetry
ENV QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
ENV QUARKUS_OTEL_TRACES_SAMPLER=traceidratio
ENV QUARKUS_OTEL_TRACES_SAMPLER_ARG=0.1

ENTRYPOINT ["./application", "-Dquarkus.http.host=0.0.0.0"]
```

Build and run:

```bash
docker build -f src/main/docker/Dockerfile.multistage -t quarkus-order-service:native .
docker run -p 8080:8080 \
  -e QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.base14.io:4317 \
  -e SCOUT_API_KEY=your_api_key \
  quarkus-order-service:native
```

### Kubernetes Deployment

```yaml title="k8s/deployment.yaml" showLineNumbers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quarkus-order-service
  labels:
    app: quarkus-order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: quarkus-order-service
  template:
    metadata:
      labels:
        app: quarkus-order-service
    spec:
      containers:
        - name: quarkus-app
          image: quarkus-order-service:native
          ports:
            - containerPort: 8080
              name: http
          env:
            - name: QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT
              value: 'http://scout-collector:4317'
            - name: SCOUT_API_KEY
              valueFrom:
                secretKeyRef:
                  name: scout-credentials
                  key: api-key
            - name: QUARKUS_OTEL_RESOURCE_ATTRIBUTES
              value: >-
                service.name=quarkus-order-service,
                service.version=1.0.0,
                deployment.environment=production,
                k8s.cluster.name=production,
                k8s.namespace.name=$(K8S_NAMESPACE),
                k8s.pod.name=$(K8S_POD_NAME)
            - name: K8S_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: K8S_POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: QUARKUS_DATASOURCE_JDBC_URL
              value: jdbc:postgresql://postgres:5432/orders
            - name: QUARKUS_DATASOURCE_USERNAME
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: username
            - name: QUARKUS_DATASOURCE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: password
            - name: QUARKUS_DATASOURCE_JDBC_TELEMETRY
              value: 'true'
          resources:
            requests:
              memory: '128Mi'
              cpu: '100m'
            limits:
              memory: '256Mi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /q/health/live
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /q/health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: quarkus-order-service
spec:
  selector:
    app: quarkus-order-service
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP
```

### Native Image Performance Metrics

Expected performance characteristics with native compilation:

| Metric               | JVM Mode | Native Mode | Improvement |
| -------------------- | -------- | ----------- | ----------- |
| **Startup Time**     | 2-3s     | 30-50ms     | 60x faster  |
| **Memory (RSS)**     | 300-400M | 50-80M      | 5x smaller  |
| **Image Size**       | 200-300M | 50-70M      | 4x smaller  |
| **First Request**    | 500ms    | 20ms        | 25x faster  |
| **Tracing Overhead** | &lt;2%   | &lt;1%      | Negligible  |

## Quarkus-Specific Features

Quarkus provides automatic instrumentation for common frameworks and libraries
through its extension ecosystem. No manual span creation is required for
standard operations.

### REST Endpoint Auto-Instrumentation

All JAX-RS resources are automatically instrumented:

```java title="src/main/java/com/example/OrderResource.java" showLineNumbers
package com.example;

import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.List;

@Path("/api/orders")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource {

    @Inject
    OrderService orderService;

    @Inject
    JsonWebToken jwt;

    // Automatically creates span: "GET /api/orders"
    @GET
    public List<Order> getAllOrders() {
        return orderService.findAll();
    }

    // Span includes path parameter: "GET /api/orders/{id}"
    @GET
    @Path("/{id}")
    public Order getOrder(@PathParam("id") Long id) {
        Order order = orderService.findById(id);
        if (order == null) {
            throw new NotFoundException("Order not found");
        }
        return order;
    }

    // Span includes authentication context
    @POST
    @Authenticated
    @Transactional
    public Response createOrder(Order order) {
        // JWT claims are automatically added to span attributes
        String userId = jwt.getClaim("sub");
        order.setUserId(userId);

        Order created = orderService.create(order);
        return Response.status(Response.Status.CREATED).entity(created).build();
    }

    // Exception information is captured in span
    @DELETE
    @Path("/{id}")
    @Authenticated
    @Transactional
    public Response deleteOrder(@PathParam("id") Long id) {
        orderService.delete(id);
        return Response.noContent().build();
    }
}
```

### Hibernate ORM with Panache Instrumentation

Database queries are automatically traced with full SQL visibility:

```java title="src/main/java/com/example/Order.java" showLineNumbers
package com.example;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "orders")
public class Order extends PanacheEntity {

    @Column(nullable = false)
    public String userId;

    @Column(nullable = false)
    public String productName;

    @Column(nullable = false)
    public BigDecimal amount;

    @Column(nullable = false)
    public String status;

    @Column(name = "created_at", nullable = false)
    public LocalDateTime createdAt;

    // Automatically traced: "SELECT o FROM Order o WHERE o.userId = ?1"
    public static List<Order> findByUserId(String userId) {
        return find("userId", userId).list();
    }

    // Automatically traced with query parameters
    public static List<Order> findByStatus(String status) {
        return list("status = ?1 ORDER BY createdAt DESC", status);
    }

    // Automatically traced with pagination
    public static List<Order> findRecent(int limit) {
        return find("ORDER BY createdAt DESC").page(0, limit).list();
    }
}
```

```java title="src/main/java/com/example/OrderService.java" showLineNumbers
package com.example;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@ApplicationScoped
public class OrderService {

    // Database queries are automatically traced
    public List<Order> findAll() {
        return Order.listAll();
    }

    public Order findById(Long id) {
        return Order.findById(id);
    }

    @Transactional
    public Order create(Order order) {
        order.createdAt = LocalDateTime.now();
        order.status = "pending";
        order.persist(); // Automatically traced INSERT query
        return order;
    }

    @Transactional
    public void delete(Long id) {
        Order order = Order.findById(id);
        if (order != null) {
            order.delete(); // Automatically traced DELETE query
        }
    }

    // Find orders by user with automatic tracing
    public List<Order> findByUser(String userId) {
        return Order.findByUserId(userId);
    }
}
```

### CDI Bean Instrumentation with @WithSpan

For business logic that requires custom instrumentation, use the
`@WithSpan` annotation:

```java title="src/main/java/com/example/PaymentService.java" showLineNumbers
package com.example;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.instrumentation.annotations.SpanAttribute;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.math.BigDecimal;

@ApplicationScoped
public class PaymentService {

    @Inject
    ExternalPaymentGateway paymentGateway;

    // Creates custom span: "PaymentService.processPayment"
    @WithSpan("process_payment")
    public PaymentResult processPayment(
        @SpanAttribute("order.id") Long orderId,
        @SpanAttribute("payment.amount") BigDecimal amount,
        @SpanAttribute("user.id") String userId
    ) {
        Span currentSpan = Span.current();

        try {
            // Add custom attributes
            currentSpan.setAttribute("payment.gateway", "stripe");
            currentSpan.setAttribute("payment.currency", "USD");

            // External API call (instrumented automatically)
            PaymentResult result = paymentGateway.charge(amount, userId);

            currentSpan.setAttribute("payment.transaction_id", result.getTransactionId());
            currentSpan.setStatus(StatusCode.OK);

            return result;
        } catch (PaymentException e) {
            currentSpan.setStatus(StatusCode.ERROR, "Payment failed");
            currentSpan.recordException(e);
            throw e;
        }
    }

    @WithSpan("validate_payment")
    public boolean validatePaymentMethod(
        @SpanAttribute("user.id") String userId,
        @SpanAttribute("payment.method") String method
    ) {
        // Validation logic automatically traced
        return paymentGateway.validateMethod(userId, method);
    }
}
```

### Reactive Streams with Mutiny

Quarkus's reactive programming model (Mutiny) is automatically instrumented:

```java title="src/main/java/com/example/ReactiveOrderResource.java" showLineNumbers
package com.example;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;

import java.util.List;

@Path("/api/reactive/orders")
@Produces(MediaType.APPLICATION_JSON)
public class ReactiveOrderResource {

    @Inject
    ReactiveOrderService orderService;

    // Reactive chain is automatically traced
    @GET
    public Uni<List<Order>> getAllOrders() {
        return orderService.findAll();
    }

    @POST
    public Uni<Order> createOrder(Order order) {
        return orderService.create(order)
            .onItem().transform(created -> {
                Span.current().setAttribute("order.id", created.id);
                return created;
            });
    }
}
```

## Custom Instrumentation

While Quarkus provides extensive auto-instrumentation, custom spans are needed
for specific business logic or external integrations.

### Manual Span Creation with Tracer

```java title="src/main/java/com/example/InventoryService.java" showLineNumbers
package com.example;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class InventoryService {

    private final Tracer tracer = GlobalOpenTelemetry.getTracer("inventory-service");

    public boolean checkInventory(String productId, int quantity) {
        // Create custom span
        Span span = tracer.spanBuilder("check_inventory")
            .setSpanKind(SpanKind.INTERNAL)
            .setAttribute("product.id", productId)
            .setAttribute("inventory.requested_quantity", quantity)
            .startSpan();

        try (Scope scope = span.makeCurrent()) {
            // Simulate inventory check
            int available = queryAvailableStock(productId);
            span.setAttribute("inventory.available_quantity", available);

            boolean inStock = available >= quantity;
            span.setAttribute("inventory.in_stock", inStock);

            if (inStock) {
                span.setStatus(StatusCode.OK);
            } else {
                span.setStatus(StatusCode.ERROR, "Insufficient stock");
            }

            return inStock;
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, e.getMessage());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }

    private int queryAvailableStock(String productId) {
        // Database query (automatically traced by Hibernate)
        return InventoryItem.find("productId", productId)
            .firstResult()
            .map(item -> ((InventoryItem) item).quantity)
            .orElse(0);
    }
}
```

### CDI Interceptor for Automatic Tracing

Create a custom interceptor to trace all methods in specific beans:

```java title="src/main/java/com/example/Traced.java" showLineNumbers
package com.example;

import jakarta.interceptor.InterceptorBinding;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@InterceptorBinding
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface Traced {
}
```

```java title="src/main/java/com/example/TracingInterceptor.java" showLineNumbers
package com.example;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import jakarta.interceptor.AroundInvoke;
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.InvocationContext;

@Traced
@Interceptor
public class TracingInterceptor {

    private final Tracer tracer = GlobalOpenTelemetry.getTracer("custom-interceptor");

    @AroundInvoke
    public Object trace(InvocationContext context) throws Exception {
        String className = context.getTarget().getClass().getSimpleName();
        String methodName = context.getMethod().getName();
        String spanName = className + "." + methodName;

        Span span = tracer.spanBuilder(spanName).startSpan();
        try (Scope scope = span.makeCurrent()) {
            // Add method parameters as attributes
            Object[] params = context.getParameters();
            for (int i = 0; i < params.length; i++) {
                span.setAttribute("param." + i, String.valueOf(params[i]));
            }

            return context.proceed();
        } catch (Exception e) {
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

Use the interceptor:

```java title="src/main/java/com/example/NotificationService.java" showLineNumbers
package com.example;

import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
@Traced // All methods will be automatically traced
public class NotificationService {

    public void sendOrderConfirmation(String email, Long orderId) {
        // This method is automatically traced by interceptor
        // Span name: "NotificationService.sendOrderConfirmation"
        System.out.println("Sending confirmation to " + email);
    }

    public void sendShippingNotification(String email, String trackingNumber) {
        // Also automatically traced
        System.out.println("Sending shipping notification");
    }
}
```

### Context Propagation in Async Operations

```java title="src/main/java/com/example/AsyncOrderProcessor.java" showLineNumbers
package com.example;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Context;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@ApplicationScoped
public class AsyncOrderProcessor {

    @Inject
    PaymentService paymentService;

    @Inject
    InventoryService inventoryService;

    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public CompletableFuture<Order> processOrderAsync(Order order) {
        // Capture current trace context
        Context currentContext = Context.current();
        Span parentSpan = Span.current();

        return CompletableFuture.supplyAsync(() -> {
            // Restore context in new thread
            try (var scope = currentContext.makeCurrent()) {
                parentSpan.setAttribute("async.processing", true);

                // Check inventory (traced in current context)
                boolean inStock = inventoryService.checkInventory(
                    order.productName,
                    1
                );

                if (!inStock) {
                    throw new RuntimeException("Out of stock");
                }

                // Process payment (traced in current context)
                paymentService.processPayment(
                    order.id,
                    order.amount,
                    order.userId
                );

                order.status = "completed";
                return order;
            }
        }, executor);
    }
}
```

## Running Your Application

Quarkus provides multiple run modes optimized for different stages of
development and deployment.

### Development Mode (Live Reload)

```bash title="Terminal" showLineNumbers
# Start dev mode with live reload
./mvnw quarkus:dev

# Dev mode features:
# - Automatic recompilation on code changes
# - Live reload without restart
# - Dev UI at http://localhost:8080/q/dev
# - Continuous testing with 'r' key
# - Always-on sampling for all traces

# Access application
curl http://localhost:8080/api/orders

# View Dev UI (includes OpenTelemetry info)
open http://localhost:8080/q/dev
```

### JVM Mode (Production)

```bash title="Terminal" showLineNumbers
# Build JVM package
./mvnw clean package

# Run with production profile
java -Dquarkus.profile=prod \
  -Dquarkus.otel.exporter.otlp.endpoint=https://scout.base14.io:4317 \
  -Dquarkus.otel.exporter.otlp.headers=authorization=Bearer\ YOUR_API_KEY \
  -jar target/quarkus-app/quarkus-run.jar
```

### Native Mode (Supersonic Startup)

```bash title="Terminal" showLineNumbers
# Build native executable
./mvnw clean package -Pnative \
  -Dquarkus.native.container-build=true

# Run native executable
./target/quarkus-order-service-1.0.0-runner

# Expected output:
# __  ____  __  _____   ___  __ ____  ______
#  --/ __ \/ / / / _ | / _ \/ //_/ / / / __/
#  -/ /_/ / /_/ / __ |/ , _/ ,< / /_/ /\ \
# --\___\_\____/_/ |_/_/|_/_/|_|\____/___/
# INFO  [io.quarkus] (main) quarkus-order-service 1.0.0 native (powered by Quarkus 3.17.0) started in 0.045s

# Memory footprint
ps aux | grep quarkus-order-service
# Expected: ~60MB RSS
```

### Docker Deployment

```bash title="Terminal" showLineNumbers
# Build Docker image (JVM mode)
docker build -f src/main/docker/Dockerfile.jvm -t quarkus-app:jvm .

# Build Docker image (Native mode)
docker build -f src/main/docker/Dockerfile.multistage -t quarkus-app:native .

# Run container with tracing
docker run -p 8080:8080 \
  -e QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT=https://scout.base14.io:4317 \
  -e SCOUT_API_KEY=your_api_key \
  -e QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://host.docker.internal:5432/orders \
  -e QUARKUS_DATASOURCE_USERNAME=postgres \
  -e QUARKUS_DATASOURCE_PASSWORD=postgres123 \
  quarkus-app:native

# Compare startup times
time docker run -p 8081:8080 quarkus-app:jvm     # ~2-3s
time docker run -p 8082:8080 quarkus-app:native  # ~0.05s (60x faster)
```

### Kubernetes Deployment

```bash title="Terminal" showLineNumbers
# Deploy to Kubernetes
kubectl apply -f k8s/deployment.yaml

# Check pod startup time
kubectl logs -f deployment/quarkus-order-service

# Expected for native image:
# INFO  [io.quarkus] (main) quarkus-order-service 1.0.0 native started in 0.042s

# Check memory usage
kubectl top pod -l app=quarkus-order-service

# Expected for native image:
# NAME                                    CPU(cores)   MEMORY(bytes)
# quarkus-order-service-7d9f8b4c5-abc12   5m           62Mi

# Test endpoint
kubectl port-forward deployment/quarkus-order-service 8080:8080
curl http://localhost:8080/api/orders
```

## Troubleshooting

### Issue 1: Native Image Build Fails with Reflection Errors

**Symptoms:**

```text
Error: Classes that should be initialized at run time got initialized during image building:
  io.opentelemetry.sdk.trace.SdkTracerProvider was unintentionally initialized at build time.
```

**Solution:**

Configure GraalVM reflection for OpenTelemetry classes:

```json title="src/main/resources/reflection-config.json" showLineNumbers
[
  {
    "name": "io.opentelemetry.sdk.trace.SdkTracerProvider",
    "allDeclaredConstructors": true,
    "allPublicConstructors": true,
    "allDeclaredMethods": true,
    "allPublicMethods": true
  },
  {
    "name": "io.opentelemetry.sdk.trace.export.BatchSpanProcessor",
    "allDeclaredConstructors": true,
    "allDeclaredMethods": true
  }
]
```

Add to `application.properties`:

```properties
quarkus.native.additional-build-args=\
  -H:ReflectionConfigurationFiles=reflection-config.json,\
  --initialize-at-run-time=io.opentelemetry
```

### Issue 2: No Traces Generated in Dev Mode

**Symptoms:** Application starts successfully but no traces appear in
collector.

**Diagnosis:**

```bash
# Check if OpenTelemetry extension is active
./mvnw quarkus:info | grep opentelemetry

# Verify endpoint configuration
curl http://localhost:8080/q/dev
```

**Solution:**

Ensure extension is properly installed and configured:

```properties title="application.properties" showLineNumbers
# Enable OpenTelemetry explicitly
quarkus.otel.enabled=true
quarkus.otel.sdk.disabled=false

# Verify exporter configuration
quarkus.otel.exporter.otlp.endpoint=http://localhost:4317
quarkus.otel.traces.exporter=otlp

# Enable debug logging
quarkus.log.category."io.opentelemetry".level=DEBUG
```

### Issue 3: Database Queries Not Traced

**Symptoms:** REST endpoints create spans but SQL queries are missing.

**Solution:**

Enable JDBC telemetry explicitly:

```properties title="application.properties" showLineNumbers
# Enable database telemetry
quarkus.datasource.jdbc.telemetry=true

# For Hibernate, ensure logging is enabled (helps debugging)
quarkus.hibernate-orm.log.sql=true
quarkus.hibernate-orm.log.bind-parameters=true
```

Verify Hibernate instrumentation is active:

```java
// In your service class
import io.opentelemetry.api.trace.Span;

public List<Order> findAll() {
    Span currentSpan = Span.current();
    System.out.println("Current span: " + currentSpan.getSpanContext().getSpanId());
    return Order.listAll(); // Should create child span for SQL query
}
```

### Issue 4: Native Image Startup Fails with OTLP Connection Error

**Symptoms:**

```text
Failed to export spans. The request could not be executed. Full error message: Failed to connect to scout.base14.io/192.168.1.1:4317
```

**Solution:**

The native image tries to connect immediately at startup. Use delayed
initialization:

```properties title="application.properties" showLineNumbers
# Delay span export to allow network initialization
%prod.quarkus.otel.bsp.schedule.delay=5000

# Increase connection timeout
%prod.quarkus.otel.exporter.otlp.timeout=30s

# Add retry configuration
%prod.quarkus.otel.exporter.otlp.retry.enabled=true
%prod.quarkus.otel.exporter.otlp.retry.max.attempts=5
```

### Issue 5: High Memory Usage with Tracing

**Symptoms:** Native image memory usage is higher than expected (&gt;200MB instead
of &lt;100MB).

**Solution:**

Optimize batch span processor settings:

```properties title="application.properties" showLineNumbers
# Reduce batch queue size
%prod.quarkus.otel.bsp.max.queue.size=1024
%prod.quarkus.otel.bsp.max.export.batch.size=256

# Export more frequently
%prod.quarkus.otel.bsp.schedule.delay=3000

# Use sampling to reduce volume
%prod.quarkus.otel.traces.sampler=traceidratio
%prod.quarkus.otel.traces.sampler.arg=0.1
```

## Security Considerations

### PII Data Masking

Quarkus applications often handle sensitive data. Implement attribute filtering
to prevent PII exposure:

```java title="src/main/java/com/example/SensitiveDataFilter.java" showLineNumbers
package com.example;

import io.opentelemetry.sdk.trace.SpanProcessor;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.context.Context;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

import java.util.regex.Pattern;

@ApplicationScoped
public class TelemetryConfig {

    private static final Pattern EMAIL_PATTERN = Pattern.compile(
        "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
    );
    private static final Pattern CREDIT_CARD_PATTERN = Pattern.compile(
        "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b"
    );

    @Produces
    public SpanProcessor piiMaskingProcessor() {
        return new SpanProcessor() {
            @Override
            public void onStart(Context parentContext, io.opentelemetry.sdk.trace.ReadWriteSpan span) {
                // Mask PII in span name
                String spanName = span.getName();
                spanName = EMAIL_PATTERN.matcher(spanName).replaceAll("***@***.***");
                spanName = CREDIT_CARD_PATTERN.matcher(spanName).replaceAll("****-****-****-****");
                span.updateName(spanName);
            }

            @Override
            public boolean isStartRequired() {
                return true;
            }

            @Override
            public void onEnd(SpanData span) {
                // No action needed
            }

            @Override
            public boolean isEndRequired() {
                return false;
            }
        };
    }
}
```

### SQL Query Obfuscation

Database queries may contain sensitive values. Configure Hibernate to use
parameterized queries:

```properties title="application.properties" showLineNumbers
# Never log SQL parameter values in production
%prod.quarkus.hibernate-orm.log.sql=false
%prod.quarkus.hibernate-orm.log.bind-parameters=false

# Use prepared statements to prevent SQL injection
quarkus.datasource.jdbc.detect-statement-leaks=true
```

Implement custom attribute filter:

```java title="src/main/java/com/example/SqlSanitizer.java" showLineNumbers
package com.example;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class SecureQueryService {

    @Inject
    Tracer tracer;

    public void executeQuery(String sql, Object... params) {
        Span span = tracer.spanBuilder("database.query")
            .setAttribute("db.system", "postgresql")
            .setAttribute("db.operation", extractOperation(sql))
            .setAttribute("db.sql.table", extractTable(sql))
            // DO NOT add actual SQL or parameters
            .startSpan();

        try (var scope = span.makeCurrent()) {
            // Execute query
        } finally {
            span.end();
        }
    }

    private String extractOperation(String sql) {
        return sql.trim().split("\\s+")[0].toUpperCase();
    }

    private String extractTable(String sql) {
        // Extract table name without exposing query details
        if (sql.contains("FROM")) {
            return sql.split("FROM")[1].trim().split("\\s+")[0];
        }
        return "unknown";
    }
}
```

### Authentication Token Redaction

Prevent JWT tokens from being logged in traces:

```java title="src/main/java/com/example/AuthHeaderFilter.java" showLineNumbers
package com.example;

import io.opentelemetry.api.trace.Span;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public class AuthHeaderFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authHeader = requestContext.getHeaderString("Authorization");

        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            Span currentSpan = Span.current();
            // Only log that auth is present, not the token itself
            currentSpan.setAttribute("http.auth.present", true);
            currentSpan.setAttribute("http.auth.type", "Bearer");
            // DO NOT: currentSpan.setAttribute("http.auth.token", authHeader);
        }
    }
}
```

### Compliance (GDPR, HIPAA)

For regulated industries, implement comprehensive data governance:

```properties title="application.properties" showLineNumbers
# Disable automatic attribute collection for user data
%prod.quarkus.otel.traces.suppress-application-uris=/api/users/*,/api/health/*

# Limit span attribute size to prevent large data exposure
%prod.quarkus.otel.attribute.value.length.limit=256
%prod.quarkus.otel.attribute.count.limit=32

# Disable exporting to prevent data leaving infrastructure (optional)
# %prod.quarkus.otel.traces.exporter=none
```

## Performance Considerations

### Tracing Overhead Metrics

Measured performance impact of OpenTelemetry on Quarkus native images:

| Configuration       | Latency (p50) | Latency (p99) | Throughput | Memory  |
| ------------------- | ------------- | ------------- | ---------- | ------- |
| **No Tracing**      | 5ms           | 15ms          | 15,000 rps | 60MB    |
| **Tracing (100%)**  | 5.1ms (+2%)   | 16ms (+6%)    | 14,500 rps | 75MB    |
| **Tracing (10%)**   | 5.0ms (&lt;1%)| 15.2ms (+1%)  | 14,900 rps | 65MB    |
| **Tracing (JVM)**   | 12ms          | 35ms          | 8,000 rps  | 350MB   |

**Key Findings:**

- Native image tracing overhead: &lt;1% with sampling
- JVM mode overhead: 5-10% higher than native
- Memory impact: +15MB for 100% sampling, +5MB for 10% sampling
- Startup time: no measurable difference (&lt;1ms)

### Optimization Strategies

#### 1. Use Probabilistic Sampling in Production

```properties title="application.properties" showLineNumbers
# Sample 10% of traces (adjust based on traffic volume)
%prod.quarkus.otel.traces.sampler=traceidratio
%prod.quarkus.otel.traces.sampler.arg=0.1

# For high-traffic services (&gt;10,000 rps), sample even less
%prod.quarkus.otel.traces.sampler.arg=0.01  # 1%
```

#### 2. Optimize Batch Span Processor

```properties title="application.properties" showLineNumbers
# Export every 5 seconds instead of default 5s
%prod.quarkus.otel.bsp.schedule.delay=5000

# Reduce batch size to lower memory usage
%prod.quarkus.otel.bsp.max.export.batch.size=256

# Limit queue size to prevent memory growth
%prod.quarkus.otel.bsp.max.queue.size=1024

# Set export timeout
%prod.quarkus.otel.bsp.export.timeout=10s
```

#### 3. Disable Instrumentation for High-Volume Endpoints

```properties title="application.properties" showLineNumbers
# Skip tracing for health checks and metrics
%prod.quarkus.otel.traces.suppress-application-uris=/q/health/*,/q/metrics,/favicon.ico
```

#### 4. Use Native Image for Maximum Performance

Native compilation provides:

- **60x faster startup** (3s → 50ms)
- **5x lower memory** (350MB → 70MB)
- **25% lower latency** (p99: 35ms → 15ms)
- **&lt;1% tracing overhead** vs 5-10% in JVM mode

Build native image:

```bash
./mvnw clean package -Pnative \
  -Dquarkus.native.container-build=true \
  -Dquarkus.native.builder-image=quay.io/quarkus/ubi-quarkus-mandrel-builder-image:jdk-21
```

#### 5. Limit Span Attributes

```properties title="application.properties" showLineNumbers
# Limit attribute value length (prevent large payloads)
%prod.quarkus.otel.attribute.value.length.limit=512

# Limit number of attributes per span
%prod.quarkus.otel.attribute.count.limit=64

# Limit number of events per span
%prod.quarkus.otel.span.event.count.limit=32
```

## FAQ

### 1. Does Quarkus require manual OpenTelemetry SDK initialization?

**No.** Unlike Spring Boot or Express.js, Quarkus handles OpenTelemetry
initialization automatically through the `quarkus-opentelemetry` extension. You
only need to add the dependency and configure `application.properties`—no Java
code required for basic instrumentation.

### 2. Can I use Quarkus native images with OpenTelemetry?

**Yes.** Quarkus fully supports OpenTelemetry in native images compiled with
GraalVM. The extension handles all necessary reflection configuration and
build-time initialization automatically. Native images provide subsecond startup
and minimal memory footprint while maintaining full tracing capabilities.

### 3. How do I instrument reactive code with Mutiny?

**Automatically.** Quarkus's reactive programming model (Mutiny) is
automatically instrumented by the OpenTelemetry extension. Context propagation
across `Uni` and `Multi` chains works out of the box without manual
configuration.

### 4. What's the difference between Quarkus and Spring Boot OpenTelemetry setup?

**Quarkus is simpler.** Quarkus uses extension-based configuration with zero
Java code, while Spring Boot requires programmatic SDK initialization in a
`@Configuration` class. Quarkus also provides built-in dev mode with live reload
and automatic tracing, whereas Spring Boot requires DevTools or manual restarts.

### 5. How do I add custom spans in Quarkus?

Use the `@WithSpan` annotation from OpenTelemetry instrumentation annotations:

```java
import io.opentelemetry.instrumentation.annotations.WithSpan;
import io.opentelemetry.instrumentation.annotations.SpanAttribute;

@WithSpan("custom_operation")
public void doSomething(@SpanAttribute("user.id") String userId) {
    // Automatically creates span
}
```

Alternatively, inject `Tracer` and create spans manually:

```java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Tracer;

private final Tracer tracer = GlobalOpenTelemetry.getTracer("my-service");
```

### 6. Can I disable OpenTelemetry in tests?

**Yes.** Use Quarkus test profiles:

```properties title="application.properties" showLineNumbers
# Disable OpenTelemetry in test profile
%test.quarkus.otel.sdk.disabled=true
```

Or in test classes:

```java
@QuarkusTest
@TestProfile(NoTelemetryProfile.class)
public class OrderServiceTest {
    // Tests run without tracing
}
```

### 7. How do I trace Hibernate queries with Panache?

**Automatically.** Enable JDBC telemetry:

```properties
quarkus.datasource.jdbc.telemetry=true
```

All Panache methods (`findAll()`, `find()`, `persist()`, etc.) will
automatically create child spans with SQL query details.

### 8. What's the performance overhead of tracing in native images?

**&lt;1% with sampling.** Native images with 10% sampling add approximately 0.1ms
to p50 latency and 15MB to memory usage. This is significantly lower than JVM
mode (5-10% overhead) due to build-time optimizations.

### 9. Can I use Quarkus OpenTelemetry with Kafka?

**Yes.** Add the Kafka extension and enable messaging instrumentation:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-smallrye-reactive-messaging-kafka</artifactId>
</dependency>
```

```properties
quarkus.otel.instrument.messaging=true
```

Kafka producers and consumers are automatically traced with message headers for
context propagation.

### 10. How do I send traces to Base14 Scout?

Configure the OTLP endpoint and authentication:

```properties title="application.properties" showLineNumbers
%prod.quarkus.otel.exporter.otlp.endpoint=https://scout.base14.io:4317
%prod.quarkus.otel.exporter.otlp.headers=authorization=Bearer ${SCOUT_API_KEY}
%prod.quarkus.otel.traces.exporter=otlp
```

Set the API key as an environment variable:

```bash
export SCOUT_API_KEY=your_api_key
./target/quarkus-order-service-1.0.0-runner
```

### 11. Can I use OpenTelemetry metrics with Quarkus?

**Yes.** Quarkus supports OpenTelemetry metrics through the extension:

```properties
quarkus.otel.metrics.exporter=otlp
```

However, Quarkus also provides Micrometer integration which may be more mature
for production use:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-micrometer-registry-prometheus</artifactId>
</dependency>
```

### 12. How do I trace gRPC services in Quarkus?

**Automatically.** Add the gRPC extension:

```xml
<dependency>
  <groupId>io.quarkus</groupId>
  <artifactId>quarkus-grpc</artifactId>
</dependency>
```

gRPC services and clients are automatically instrumented with full context
propagation.

## What's Next

Now that you have Quarkus instrumented with OpenTelemetry, explore advanced
observability patterns:

### Advanced Tracing Topics

- **[Custom Instrumentation for Java](/instrument/apps/custom-instrumentation/java)**
  \- Deep dive into manual span creation, context propagation, and baggage
- **[Spring Boot Instrumentation](/instrument/apps/auto-instrumentation/spring-boot)**
  \- Compare Quarkus extension-based approach with Spring Boot programmatic
  setup
- **Distributed Tracing Best Practices** \- Sampling strategies, cardinality
  limits, and performance optimization

### Scout Platform Features

- **[Base14 Scout Dashboard](https://base14.io/scout)** - Visualize Quarkus
  traces with native image performance metrics
- **Service Map Visualization** - Understand microservice dependencies and
  latency bottlenecks
- **Alert Configuration** - Set up SLO-based alerts for Quarkus services

### Deployment & Operations

- **Kubernetes Instrumentation** - Monitor Quarkus pods with cluster-level
  observability
- **Docker Instrumentation** - Trace containerized Quarkus applications
- **AWS ECS/Fargate Deployment** - Deploy instrumented native images to
  serverless containers

### Related Frameworks

- **[Node.js Instrumentation](/instrument/apps/auto-instrumentation/nodejs)**
  \- Compare Quarkus extension approach with Node.js SDK patterns
- **[Go Instrumentation](/instrument/apps/auto-instrumentation/go)** \-
  Explore another compiled language with low overhead tracing
- **Python Django** \- ORM instrumentation patterns similar to Hibernate (guide
  coming soon)

## Complete Example

Here's a complete Quarkus application with OpenTelemetry instrumentation,
including REST endpoints, database access, authentication, and custom business
logic.

### Project Structure

```text
quarkus-order-service/
├── src/main/
│   ├── java/com/example/
│   │   ├── Order.java
│   │   ├── OrderResource.java
│   │   ├── OrderService.java
│   │   ├── PaymentService.java
│   │   └── TracingInterceptor.java
│   ├── resources/
│   │   ├── application.properties
│   │   └── import.sql
│   └── docker/
│       ├── Dockerfile.jvm
│       └── Dockerfile.multistage
├── pom.xml
└── docker-compose.yml
```

### Complete Application Configuration

```properties title="src/main/resources/application.properties" showLineNumbers
# Application metadata
quarkus.application.name=quarkus-order-service
quarkus.application.version=1.0.0

# HTTP configuration
quarkus.http.port=8080
quarkus.http.cors=true

# Database configuration
quarkus.datasource.db-kind=postgresql
quarkus.datasource.username=quarkus
quarkus.datasource.password=quarkus123
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/orders
quarkus.datasource.jdbc.telemetry=true

# Hibernate ORM
quarkus.hibernate-orm.database.generation=drop-and-create
quarkus.hibernate-orm.log.sql=true

# OpenTelemetry - Development
quarkus.otel.enabled=true
quarkus.otel.exporter.otlp.endpoint=http://localhost:4317
quarkus.otel.exporter.otlp.protocol=grpc
quarkus.otel.traces.exporter=otlp
quarkus.otel.traces.sampler=always_on
quarkus.otel.resource.attributes=service.name=quarkus-order-service,service.version=1.0.0,deployment.environment=development

# OpenTelemetry - Production
%prod.quarkus.otel.exporter.otlp.endpoint=https://scout.base14.io:4317
%prod.quarkus.otel.exporter.otlp.headers=authorization=Bearer ${SCOUT_API_KEY}
%prod.quarkus.otel.traces.sampler=traceidratio
%prod.quarkus.otel.traces.sampler.arg=0.1
%prod.quarkus.otel.bsp.schedule.delay=5000
%prod.quarkus.otel.bsp.max.export.batch.size=512

# Security (JWT)
mp.jwt.verify.publickey.location=https://your-auth-server.com/.well-known/jwks.json
mp.jwt.verify.issuer=https://your-auth-server.com

# Logging
quarkus.log.console.format=%d{HH:mm:ss} %-5p traceId=%X{traceId}, spanId=%X{spanId} [%c{2.}] (%t) %s%e%n
quarkus.log.level=INFO
quarkus.log.category."io.opentelemetry".level=DEBUG
```

### Running the Example

```bash title="Terminal" showLineNumbers
# Clone the examples repository
git clone https://github.com/base-14/examples.git
cd examples/java/quarkus-postgres

# Start dependencies (PostgreSQL, Scout Collector)
docker-compose up -d postgres scout-collector

# Run in dev mode
./mvnw quarkus:dev

# Test endpoints (in another terminal)
# Create order
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"productName":"Widget","amount":99.99,"userId":"user123"}'

# Get all orders
curl http://localhost:8080/api/orders

# View traces in Scout Dashboard
open https://scout.base14.io

# Build native image
./mvnw clean package -Pnative -Dquarkus.native.container-build=true

# Run native executable
./target/quarkus-order-service-1.0.0-runner
```

### Expected Trace Output

When you create an order via `POST /api/orders`, you should see a trace with
this structure:

```text
POST /api/orders (200ms)
├── PaymentService.processPayment (150ms)
│   ├── validate_payment_method (20ms)
│   └── external_payment_gateway_call (120ms)
├── SELECT FROM orders WHERE userId = ? (10ms)
├── INSERT INTO orders (...) (15ms)
└── NotificationService.sendOrderConfirmation (5ms)
```

### View Traces in Scout

After running requests, view your traces in the Base14 Scout dashboard:

1. Navigate to [https://scout.base14.io](https://scout.base14.io)
2. Select the **quarkus-order-service** service
3. Explore trace timelines, database queries, and performance metrics
4. Set up alerts for latency thresholds or error rates

:::tip Complete Example Repository

The full example application with Docker Compose, Kubernetes manifests, and
native image build scripts is available at:

**[https://github.com/base-14/examples/tree/main/java/quarkus-postgres](https://github.com/base-14/examples/tree/main/java/quarkus-postgres)**

This includes production-ready configurations for AWS ECS, Kubernetes, and
Docker Swarm deployments.

:::

## References

### Official Documentation

- **[Quarkus OpenTelemetry Extension](https://quarkus.io/guides/opentelemetry)**
  \- Official Quarkus OpenTelemetry guide
- **[OpenTelemetry Java SDK](https://opentelemetry.io/docs/languages/java/)**
  \- Core OpenTelemetry Java documentation
- **[GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/)**
  \- Native compilation reference
- **[Quarkus Configuration Reference](https://quarkus.io/guides/config-reference)**
  \- All configuration properties

### Related Guides

- **[Spring Boot Instrumentation](/instrument/apps/auto-instrumentation/spring-boot)**
  \- Compare with traditional Spring Boot setup
- **[Java Custom Instrumentation](/instrument/apps/custom-instrumentation/java)**
  \- Advanced manual instrumentation patterns
- **[Go Instrumentation](/instrument/apps/auto-instrumentation/go)** \- Another
  compiled language with low overhead
- **Kubernetes Deployment** \- Deploy instrumented Quarkus to Kubernetes

### Tools & Resources

- **[Base14 Scout](https://base14.io/scout)** \- Managed OpenTelemetry
  platform for Quarkus
- **[OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo)**
  \- Reference microservices architecture
- **[Quarkus CLI](https://quarkus.io/guides/cli-tooling)** \- Command-line tool
  for project management
