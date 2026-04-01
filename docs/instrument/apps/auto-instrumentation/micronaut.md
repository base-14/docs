---
title:
  Micronaut OpenTelemetry Instrumentation - Java Agent, Hibernate & Netty
  Tracing
sidebar_label: Micronaut
sidebar_position: 19
description:
  Instrument Micronaut applications with the OpenTelemetry Java Agent for
  zero-code tracing of HTTP requests, Hibernate JPA queries, and Netty server
  operations. Export traces, metrics, and correlated logs to base14 Scout.
keywords:
  [
    micronaut opentelemetry,
    micronaut opentelemetry instrumentation,
    micronaut monitoring,
    java apm,
    micronaut distributed tracing,
    micronaut observability,
    micronaut performance monitoring,
    opentelemetry java agent,
    micronaut database monitoring,
    micronaut metrics,
    micronaut tracing,
    micronaut hibernate tracing,
    opentelemetry java,
    micronaut telemetry,
    micronaut netty tracing,
    micronaut log correlation,
    micronaut instrumentation guide,
    micronaut jpa monitoring,
    micronaut auto instrumentation,
    java micronaut apm,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does the OpenTelemetry Java Agent impact Micronaut performance?","acceptedAnswer":{"@type":"Answer","text":"The OpenTelemetry Java Agent adds approximately 3-5ms of latency per request in typical Micronaut applications. With batch processing and GZIP compression, the overhead is minimal for production workloads."}},{"@type":"Question","name":"Which Micronaut versions are supported?","acceptedAnswer":{"@type":"Answer","text":"The OpenTelemetry Java Agent supports Micronaut 3.x and 4.x with Java 17+. Micronaut 4.x with Java 21+ is recommended for optimal compatibility."}},{"@type":"Question","name":"Are Hibernate JPA queries traced automatically?","acceptedAnswer":{"@type":"Answer","text":"Yes, the OpenTelemetry Java Agent automatically instruments JDBC calls including all Hibernate JPA queries. Spans include the SQL statement, database name, and operation type with no code changes."}},{"@type":"Question","name":"Does the Java Agent propagate trace context across services?","acceptedAnswer":{"@type":"Answer","text":"Yes, the agent automatically injects W3C traceparent headers into outgoing HTTP requests and extracts them from incoming requests, enabling distributed tracing across services."}},{"@type":"Question","name":"How do I correlate logs with traces in Micronaut?","acceptedAnswer":{"@type":"Answer","text":"The Java Agent automatically injects trace_id and span_id into the SLF4J MDC. Use Logback with logstash-encoder to output JSON logs that include these fields for trace-log correlation."}},{"@type":"Question","name":"Can I use the Java Agent with GraalVM native images?","acceptedAnswer":{"@type":"Answer","text":"No, the Java Agent relies on bytecode manipulation which is not available in GraalVM native images. For native images, use the OpenTelemetry SDK with manual instrumentation instead."}},{"@type":"Question","name":"Can I use the Java Agent alongside other APM tools?","acceptedAnswer":{"@type":"Answer","text":"Yes, the OpenTelemetry Java Agent can coexist with tools like New Relic or Datadog during migration periods. However, running multiple agents simultaneously increases overhead."}},{"@type":"Question","name":"What is the difference between the Java Agent and the OpenTelemetry SDK?","acceptedAnswer":{"@type":"Answer","text":"The Java Agent provides zero-code instrumentation by attaching to the JVM at startup. The SDK requires adding instrumentation code manually. The agent is recommended for most applications as it covers HTTP, JDBC, Netty, and more automatically."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument Micronaut with OpenTelemetry","step":[{"@type":"HowToStep","name":"Download the OpenTelemetry Java Agent","text":"Download the opentelemetry-javaagent.jar from the official GitHub releases page."},{"@type":"HowToStep","name":"Attach the agent to the JVM","text":"Set JAVA_TOOL_OPTIONS=-javaagent:/path/to/opentelemetry-javaagent.jar to attach the agent automatically on JVM startup."},{"@type":"HowToStep","name":"Configure OpenTelemetry environment","text":"Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, and other environment variables to configure trace export."},{"@type":"HowToStep","name":"Run and verify instrumentation","text":"Start the Micronaut application, make test requests, and verify traces for HTTP requests, database queries, and service calls appear in base14 Scout."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

Implement OpenTelemetry instrumentation for Micronaut applications using the
OpenTelemetry Java Agent for zero-code distributed tracing, Hibernate JPA
query monitoring, and structured log correlation. The Java Agent attaches to
the JVM at startup and automatically instruments HTTP requests, JDBC queries,
Netty server operations, and outgoing HTTP client calls without any code
changes.

Micronaut applications benefit from the Java Agent's comprehensive coverage
of the JVM ecosystem including Hibernate, HikariCP connection pools, Java
HTTP clients, and Netty. With OpenTelemetry, you can monitor production
performance, debug slow requests, trace distributed transactions across
microservices, and correlate logs with traces using a single `-javaagent`
flag.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations for Micronaut
OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Micronaut-focused overview based
> on the official OpenTelemetry documentation. For complete Java agent
> information, please consult the
> [official OpenTelemetry Java documentation](https://opentelemetry.io/docs/languages/java/).

:::tip TL;DR

Download the OpenTelemetry Java Agent JAR, set
`JAVA_TOOL_OPTIONS="-javaagent:/path/to/opentelemetry-javaagent.jar"`, and
configure `OTEL_SERVICE_NAME` + `OTEL_EXPORTER_OTLP_ENDPOINT`. HTTP
requests, Hibernate queries, Netty I/O, and HTTP client calls are traced
automatically with zero code changes. The agent injects `trace_id` and
`span_id` into SLF4J MDC for log correlation.

:::

## Who This Guide Is For

This documentation is designed for:

- **Micronaut developers**: implementing observability and distributed
  tracing for the first time
- **Cloud-native teams**: running Micronaut microservices in Kubernetes or
  Docker
- **DevOps engineers**: deploying JVM applications with production monitoring
  requirements
- **Engineering teams**: migrating from Datadog, New Relic, or other
  commercial APM solutions
- **Platform teams**: standardizing observability across JVM services
  (Micronaut, Spring Boot, Quarkus)

## Overview

This guide demonstrates how to:

- Attach the OpenTelemetry Java Agent to Micronaut applications for zero-code
  instrumentation
- Configure trace export to Scout Collector via environment variables
- Set up structured JSON logging with automatic trace context correlation
- Wire custom metrics and spans using the OpenTelemetry API
- Deploy instrumented applications with Docker Compose (app + notify +
  PostgreSQL + collector)
- Trace requests across multiple Micronaut services (distributed tracing)
- Troubleshoot common instrumentation issues

## Prerequisites

Before starting, ensure you have:

- **Java 17 or later** (Java 21+ recommended for best performance)
  - Eclipse Temurin or any OpenJDK distribution
- **Micronaut 3.x or 4.x** installed
  - Micronaut 4.x is recommended for optimal compatibility
- **Gradle 8.x or Maven 3.9+** for build management
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component              | Minimum Version | Recommended Version |
| ---------------------- | --------------- | ------------------- |
| Java                   | 17              | 21+                 |
| Micronaut              | 3.0.0           | 4.8.0+              |
| Gradle                 | 8.0             | 8.10+               |
| OpenTelemetry Java Agent | 1.0.0         | 2.26.0+             |
| Hibernate ORM          | 5.6.0           | 6.6.0+              |
| PostgreSQL Driver      | 42.5.0          | Latest stable       |

### Instrumented Components (Automatic)

The Java Agent instruments these components with zero code changes:

| Component             | Coverage                                          |
| --------------------- | ------------------------------------------------- |
| Micronaut HTTP Server | Routes, controllers, request/response attributes  |
| Netty                 | Server I/O, connection handling                   |
| Hibernate / JDBC      | All SQL queries, transactions, connection pools    |
| Java HTTP Client      | Outgoing HTTP calls, W3C trace propagation        |
| HikariCP              | Connection pool metrics                           |
| Logback               | MDC injection of trace_id and span_id             |
| Flyway                | Database migration spans                          |

### Example Application

This guide references the
[micronaut-postgres](https://github.com/base-14/examples/tree/main/java/micronaut-postgres)
example: a Micronaut 4.8 REST API with Hibernate JPA, a notification
microservice, and full OpenTelemetry instrumentation.

## Installation

### Step 1: Download the OpenTelemetry Java Agent

Download the latest agent JAR from the official releases:

```bash
# Download the agent (v2.26.1)
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.26.1/opentelemetry-javaagent.jar
```

### Step 2: Attach the Agent to the JVM

The agent attaches via the `-javaagent` JVM flag. The simplest approach is
the `JAVA_TOOL_OPTIONS` environment variable:

```bash
export JAVA_TOOL_OPTIONS="-javaagent:/path/to/opentelemetry-javaagent.jar"
```

This works regardless of how you start your application (Gradle, Maven, java
-jar, etc.).

### Step 3: Add the OpenTelemetry API Dependency (Optional)

For custom metrics and manual spans, add the OpenTelemetry API to your
build. This is optional if you only need automatic instrumentation:

```kotlin title="build.gradle.kts" showLineNumbers
dependencies {
    // Required: Micronaut core
    implementation("io.micronaut:micronaut-http-client")
    implementation("io.micronaut.serde:micronaut-serde-jackson")
    implementation("io.micronaut.data:micronaut-data-hibernate-jpa")
    implementation("io.micronaut.sql:micronaut-jdbc-hikari")
    implementation("io.micronaut.flyway:micronaut-flyway")

    // Optional: OTel API for custom metrics and spans
    implementation("io.opentelemetry:opentelemetry-api:1.48.0")

    // Runtime
    runtimeOnly("org.postgresql:postgresql")
    runtimeOnly("ch.qos.logback:logback-classic")
    runtimeOnly("net.logstash.logback:logstash-logback-encoder:8.0")
}
```

The `opentelemetry-api` dependency is a compile-time-only API. The Java Agent
provides the implementation at runtime, so there is no version conflict.

## Configuration

```mdx-code-block
<Tabs>
<TabItem value="env" label="Environment Variables (Recommended)" default>
```

Configure the agent entirely through environment variables:

```bash title=".env"
# OpenTelemetry Java Agent
OTEL_SERVICE_NAME=micronaut-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development
```

The agent reads these variables at startup and configures itself. No
application code or config files need to change.

```mdx-code-block
</TabItem>
<TabItem value="yml" label="application.yml">
```

Micronaut-specific configuration for the application itself (database,
HTTP client, Flyway):

```yaml title="src/main/resources/application.yml" showLineNumbers
micronaut:
  application:
    name: micronaut-articles
  server:
    port: 8080

datasources:
  default:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:micronaut}
    username: ${DB_USER:postgres}
    password: ${DB_PASSWORD:postgres}
    driver-class-name: org.postgresql.Driver

jpa:
  default:
    entity-scan:
      packages:
        - com.example.model
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        hbm2ddl:
          auto: validate

flyway:
  datasources:
    default:
      enabled: true
      locations: classpath:db/migration

notify:
  url: ${NOTIFY_URL:`http://localhost:8081`}
```

The Java Agent instruments Hibernate and JDBC automatically regardless of
how you configure the datasource.

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

Run the full observability stack locally with Docker Compose:

```yaml title="compose.yml" showLineNumbers
x-otel-env: &otel-env
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_METRIC_EXPORT_INTERVAL: "10000"
  OTEL_RESOURCE_ATTRIBUTES: deployment.environment=development

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.148.0
    container_name: micronaut-otel-collector
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    ports:
      - "4317:4317"
      - "4318:4318"
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-contrib/config.yaml
    environment:
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT:-http://localhost:4318}
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID:-}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET:-}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL:-}
    restart: unless-stopped

  db:
    image: postgres:18-alpine
    container_name: micronaut-postgres
    environment:
      POSTGRES_DB: micronaut
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  app:
    build:
      context: ./app
      dockerfile: Dockerfile
    container_name: micronaut-app
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: micronaut-articles
      DB_HOST: db
      DB_PORT: "5432"
      DB_NAME: micronaut
      DB_USER: postgres
      DB_PASSWORD: postgres
      NOTIFY_URL: http://notify:8081
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/health"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

The YAML anchor `&otel-env` shares OpenTelemetry environment variables
across services.

```mdx-code-block
</TabItem>
</Tabs>
```

### Configure Structured Logging

Set up Logback with JSON output. The Java Agent automatically injects
`trace_id` and `span_id` into the SLF4J MDC, so all you need is a JSON
encoder that includes MDC fields:

```xml title="src/main/resources/logback.xml" showLineNumbers
<configuration>
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <includeMdcKeyName>trace_id</includeMdcKeyName>
            <includeMdcKeyName>span_id</includeMdcKeyName>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="STDOUT" />
    </root>

    <logger name="io.micronaut" level="INFO" />
    <logger name="org.hibernate" level="WARN" />
    <logger name="org.flywaydb" level="INFO" />
    <logger name="com.zaxxer.hikari" level="WARN" />
</configuration>
```

Every log line now includes `trace_id` and `span_id` in the JSON output,
enabling you to jump from a log entry in Scout directly to the
corresponding trace.

### Scout Collector Integration

Configure trace export to Scout with OAuth2 authentication:

```bash title=".env"
# Scout Collector Configuration
SCOUT_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token

# Service Configuration
OTEL_SERVICE_NAME=micronaut-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

> **Scout Dashboard Integration**: After configuration, your traces will
> appear in the Scout Dashboard. Navigate to the Traces section to view
> request flows, identify bottlenecks, and analyze distributed transactions.

## Production Configuration

Production deployments require tuning for performance, reliability, and
resource utilization.

### Production Environment Variables

```bash title=".env.production"
# OpenTelemetry Java Agent
OTEL_SERVICE_NAME=micronaut-app
OTEL_SERVICE_VERSION=2.1.3

# Scout Collector Endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com/v1/traces
SCOUT_CLIENT_ID=prod_client_id
SCOUT_CLIENT_SECRET=prod_secret_key
SCOUT_TOKEN_URL=https://scout-collector.example.com/oauth/token

# Exporter Settings
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_EXPORTER_OTLP_TIMEOUT=10000

# Batch Span Processor (Production Optimized)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Metric Export Interval
OTEL_METRIC_EXPORT_INTERVAL=30000

# Resource Attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,host.name=${HOSTNAME}
```

### Docker Production Configuration

Multi-stage Dockerfile that builds a shadow JAR and bakes in the
OpenTelemetry Java Agent:

```dockerfile title="Dockerfile" showLineNumbers
FROM eclipse-temurin:25-jdk AS builder
WORKDIR /app

COPY gradle/ gradle/
COPY gradlew settings.gradle.kts build.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

COPY src/ src/
RUN ./gradlew shadowJar --no-daemon

FROM eclipse-temurin:25-jre
WORKDIR /app

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

ARG OTEL_AGENT_VERSION=2.26.1
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

RUN addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" appuser && \
    chown appuser:appgroup /app/opentelemetry-javaagent.jar

COPY --from=builder --chown=appuser:appgroup /app/build/libs/*-all.jar /app/app.jar

USER appuser
EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Key details:

- **Multi-stage build** separates Gradle build from runtime image
- **OTel Java Agent** downloaded and baked into the image via `ADD`
- **`JAVA_TOOL_OPTIONS`** attaches the agent automatically on every JVM start
- **Non-root user** (`appuser:1001`) for security
- **Shadow JAR** bundles all dependencies into a single executable JAR

### Multi-Service Distributed Tracing

For architectures with multiple services, each gets its own
`OTEL_SERVICE_NAME`. The Java Agent automatically propagates W3C
`traceparent` headers on outgoing HTTP requests.

Here's the notification client from the example app:

```java title="src/main/java/com/example/service/NotificationClient.java" showLineNumbers
package com.example.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micronaut.context.annotation.Value;
import jakarta.inject.Singleton;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;

@Singleton
public class NotificationClient {

    private static final Logger LOG = LoggerFactory.getLogger(NotificationClient.class);

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String notifyUrl;

    public NotificationClient(
            @Value("${notify.url:`http://localhost:8081`}") String notifyUrl) {
        this.notifyUrl = notifyUrl;
    }

    public void notify(Map<String, Object> payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(notifyUrl + "/notify"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = httpClient.send(
                    request, HttpResponse.BodyHandlers.ofString());
            LOG.debug("Notify response: {}", response.statusCode());
        } catch (Exception e) {
            LOG.warn("Failed to notify: {}", e.getMessage());
        }
    }
}
```

The Java Agent instruments `java.net.http.HttpClient` automatically, injecting
the `traceparent` header into the outgoing request. No code changes needed.

Add the notification service to Docker Compose:

```yaml title="compose.yml (excerpt)"
services:
  app:
    environment:
      OTEL_SERVICE_NAME: micronaut-articles
      NOTIFY_URL: http://notify:8081

  notify:
    build:
      context: ./notify
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: micronaut-notify
    ports:
      - "8081:8081"
```

In Scout Dashboard, you'll see the full distributed trace:

```plaintext
micronaut-articles: POST /api/articles
  +-- INSERT INTO articles ...
  +-- POST http://notify:8081/notify
       +-- micronaut-notify: POST /notify (linked trace)
```

## Micronaut-Specific Features

### Automatic HTTP Request Tracing

The Java Agent instruments Micronaut's Netty-based HTTP server automatically.
Every request creates a root span with:

- `http.method` - Request method (GET, POST, etc.)
- `http.route` - Matched route pattern (e.g., `/api/articles/{id}`)
- `http.status_code` - Response status code
- `url.path` - Request URI path

Micronaut controller annotations map directly to span names:

```java
@Controller("/api/articles")
@ExecuteOn(TaskExecutors.BLOCKING)
public class ArticleController {

    @Get
    public HttpResponse<?> list() {
        // Auto-instrumented: creates span "GET /api/articles"
    }

    @Get("/{id}")
    public HttpResponse<?> get(@PathVariable Long id) {
        // Auto-instrumented: creates span "GET /api/articles/{id}"
        // Uses route pattern, not the actual ID (low cardinality)
    }

    @Post
    public HttpResponse<?> create(@Body CreateArticleRequest request) {
        // Auto-instrumented: creates span "POST /api/articles"
    }
}
```

### Hibernate JPA Query Tracing

All Hibernate queries are traced automatically via JDBC instrumentation.
Each query creates a span with:

- `db.system` - Database type (`postgresql`)
- `db.name` - Database name
- `db.statement` - SQL query (parameters obfuscated)
- `db.operation` - Operation type (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)

```java
// These are all automatically traced:

// Micronaut Data repository query
Page<Article> result = articleRepository.findAll(Pageable.from(0, 10));

// Direct entity operations
Article article = articleRepository.save(newArticle);
articleRepository.deleteById(id);
```

In Scout Dashboard, you'll see spans like:

```plaintext
SELECT a1_0.id, ... FROM articles a1_0  (db.system=postgresql, db.operation=SELECT)
INSERT INTO articles ...                 (db.system=postgresql, db.operation=INSERT)
```

### Flyway Migration Tracing

Database migrations executed by Flyway during application startup are
automatically traced. Each migration file creates a span, giving you
visibility into startup time.

### Logback Trace-Log Correlation

The Java Agent automatically injects `trace_id` and `span_id` into the
SLF4J MDC (Mapped Diagnostic Context). Combined with the
`logstash-logback-encoder`, every JSON log line includes trace context:

```json
{
  "message": "Article created: id=42, title=Hello",
  "logger_name": "com.example.controller.ArticleController",
  "level": "INFO",
  "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "span_id": "1a2b3c4d5e6f7a8b"
}
```

This is fully automatic - no custom processors or MDC manipulation needed.
The agent handles MDC injection, and `logstash-logback-encoder` handles
JSON formatting.

### Micronaut Dependency Injection

Micronaut's compile-time dependency injection works seamlessly with the
OpenTelemetry API. Use `@Singleton` and `@Value` for service wiring:

```java
@Singleton
public class NotificationClient {

    public NotificationClient(
            @Value("${notify.url}") String notifyUrl) {
        // Micronaut injects the value at compile time
        // The Java Agent instruments HTTP calls at runtime
    }
}
```

No special OpenTelemetry configuration in `services.yaml` or
`application.yml` is needed. The agent provides everything at the JVM level.

## Custom Instrumentation

While the Java Agent covers HTTP, JDBC, and Netty automatically, you can
add custom metrics and spans for business logic.

### Custom Business Metrics

Create a telemetry service to register and increment custom counters:

```java title="src/main/java/com/example/service/TelemetryService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import jakarta.annotation.PostConstruct;
import jakarta.inject.Singleton;

@Singleton
public class TelemetryService {

    private LongCounter articlesCreated;

    @PostConstruct
    void init() {
        Meter meter = GlobalOpenTelemetry.getMeter("micronaut-articles");
        articlesCreated = meter.counterBuilder("articles.created")
                .setDescription("Total number of articles created")
                .build();
    }

    public void incrementArticlesCreated() {
        articlesCreated.add(1);
    }
}
```

Use it in your controller:

```java title="src/main/java/com/example/controller/ArticleController.java (excerpt)"
@Post
public HttpResponse<?> create(@Body CreateArticleRequest request) {
    Article article = new Article();
    article.setTitle(request.title());
    article.setBody(request.body());
    article = articleRepository.save(article);

    LOG.info("Article created: id={}, title={}", article.getId(), article.getTitle());
    telemetryService.incrementArticlesCreated();

    try {
        notificationClient.notify(Map.of(
                "id", article.getId(),
                "title", article.getTitle(),
                "event", "article.created"
        ));
    } catch (Exception e) {
        LOG.warn("Failed to notify: {}", e.getMessage());
    }

    return HttpResponse.status(HttpStatus.CREATED).body(Map.of(
            "data", article,
            "meta", Map.of("trace_id", currentTraceId())
    ));
}
```

### Including Trace ID in API Responses

Include the trace ID in API responses so clients can correlate their
requests with backend traces:

```java
private String currentTraceId() {
    return Span.current().getSpanContext().getTraceId();
}
```

Every response includes `"trace_id"` in the `meta` field, making it easy
to look up the corresponding trace in Scout Dashboard.

### Manual Span Creation

Create custom spans for business-critical operations not covered by
automatic instrumentation:

```java title="src/main/java/com/example/service/ReportService.java" showLineNumbers
package com.example.service;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import jakarta.inject.Singleton;

@Singleton
public class ReportService {

    private final Tracer tracer = GlobalOpenTelemetry.getTracer(
            "report-service", "1.0.0");

    public byte[] generateReport(Long userId, String reportType) {
        Span span = tracer.spanBuilder("generate_report")
                .setSpanKind(SpanKind.INTERNAL)
                .setAttribute("report.type", reportType)
                .setAttribute("user.id", userId)
                .startSpan();

        try (Scope scope = span.makeCurrent()) {
            byte[] report = buildReport(userId, reportType);
            span.setAttribute("report.size_bytes", report.length);
            span.setStatus(StatusCode.OK);
            return report;
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

## Running Your Instrumented Application

### Development Mode

Run locally with Gradle and the Java Agent:

```bash
# Download the agent (one-time)
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.26.1/opentelemetry-javaagent.jar

# Set environment variables
export JAVA_TOOL_OPTIONS="-javaagent:./opentelemetry-javaagent.jar"
export OTEL_SERVICE_NAME=micronaut-app-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run with Gradle
./gradlew run
```

### Docker Deployment

Run the full stack with Docker Compose:

```bash
# Start all services (app, database, collector)
docker compose up --build

# Wait for services to be healthy (~30 seconds)
docker compose ps

# Verify the app is running
curl http://localhost:8080/api/health
```

Expected health check response:

```json
{ "status": "healthy", "database": "connected" }
```

### Verifying Instrumentation

Make test requests and check that traces appear:

```bash
# Create an article
curl -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello OpenTelemetry", "body": "Tracing with Micronaut"}'

# List articles
curl http://localhost:8080/api/articles

# Get a specific article
curl http://localhost:8080/api/articles/1
```

The expected span hierarchy for a create request:

```plaintext
POST /api/articles                    (SERVER   - java-agent)
  +-- HikariCP getConnection          (INTERNAL - java-agent)
  +-- INSERT INTO articles ...        (CLIENT   - java-agent/jdbc)
  +-- POST http://notify:8081/notify  (CLIENT   - java-agent/http)
       +-- micronaut-notify: POST /notify (SERVER - java-agent)
```

For a list request:

```plaintext
GET /api/articles                     (SERVER   - java-agent)
  +-- HikariCP getConnection          (INTERNAL - java-agent)
  +-- SELECT a1_0.id, ... FROM articles (CLIENT - java-agent/jdbc)
  +-- SELECT COUNT(*) FROM articles   (CLIENT   - java-agent/jdbc)
```

Check for:

- **Spans** with correct `service.name` and proper nesting
- **Logs** with `trace_id` and `span_id` in the JSON output
- **Metrics** with `articles.created` counter incrementing

## Troubleshooting

### Verifying Agent Attachment

```bash
# Check that the agent is loaded (look for OpenTelemetry in startup logs)
docker compose logs app | grep -i "opentelemetry"

# Verify JAVA_TOOL_OPTIONS is set
docker compose exec app env | grep JAVA_TOOL_OPTIONS
```

You should see a line like:

```plaintext
[otel.javaagent] opentelemetry-javaagent - version: 2.26.1
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify the agent JAR is present and attached:

   ```bash
   ls -la /app/opentelemetry-javaagent.jar
   echo $JAVA_TOOL_OPTIONS
   ```

2. Check that the collector endpoint is reachable:

   ```bash
   curl -v http://otel-collector:4318/v1/traces
   ```

3. Enable debug logging on the agent:

   ```bash
   export OTEL_JAVAAGENT_DEBUG=true
   ```

4. Check collector logs for authentication errors:

   ```bash
   docker compose logs otel-collector
   ```

#### Issue: No JDBC/Hibernate query spans

**Solutions:**

1. Verify the agent is attached (see above). JDBC instrumentation is
   included in the agent by default.

2. Check that the database connection is working:

   ```bash
   curl http://localhost:8080/api/health
   # Should return {"status":"healthy","database":"connected"}
   ```

3. Ensure you're not using a database driver that the agent doesn't
   support. PostgreSQL, MySQL, and H2 are all supported.

#### Issue: No trace context propagation between services

**Solutions:**

1. Verify both services have the Java Agent attached. Check startup logs
   for both containers:

   ```bash
   docker compose logs app | head -20
   docker compose logs notify | head -20
   ```

2. Confirm `OTEL_PROPAGATORS` includes `tracecontext` (this is the default):

   ```bash
   echo $OTEL_PROPAGATORS
   # Should be empty (defaults) or include "tracecontext"
   ```

3. Ensure the HTTP client being used is instrumented. The standard
   `java.net.http.HttpClient` is supported. If using a different client,
   check the
   [agent supported libraries](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md).

#### Issue: Log correlation not working (missing trace_id in logs)

**Solutions:**

1. Verify `logstash-logback-encoder` is in your dependencies:

   ```bash
   ./gradlew dependencies | grep logstash
   ```

2. Check that `logback.xml` uses `LogstashEncoder`:

   ```xml
   <encoder class="net.logstash.logback.encoder.LogstashEncoder">
       <includeMdcKeyName>trace_id</includeMdcKeyName>
       <includeMdcKeyName>span_id</includeMdcKeyName>
   </encoder>
   ```

3. If using a custom Logback pattern instead of JSON, include MDC fields:

   ```xml
   <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} [trace=%X{trace_id}] - %msg%n</pattern>
   ```

#### Issue: High memory usage

**Solutions:**

1. Reduce the batch queue size:

   ```bash
   export OTEL_BSP_MAX_QUEUE_SIZE=1024
   ```

2. Increase export frequency to flush spans sooner:

   ```bash
   export OTEL_BSP_SCHEDULE_DELAY=2000
   ```

3. Set JVM heap limits appropriate for your workload:

   ```bash
   export JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar -Xmx512m"
   ```

## Security Considerations

### SQL Parameter Obfuscation

The Java Agent automatically obfuscates SQL parameter values in database
spans:

```sql
-- What gets executed (never sent to collector)
SELECT * FROM users WHERE email = 'user@example.com' AND api_key = 'sk-abc123'

-- What appears in the span (obfuscated)
SELECT * FROM users WHERE email = ? AND api_key = ?
```

This is enabled by default and requires no configuration.

### Protecting Sensitive Data

Never add sensitive information to span attributes:

```java
// Bad - exposes sensitive data
span.setAttribute("user.password", user.getPassword());       // Never!
span.setAttribute("user.email", user.getEmail());             // PII risk
span.setAttribute("payment.card", request.getCreditCard());   // Never!

// Good - uses safe identifiers
span.setAttribute("user.id", user.getId());
span.setAttribute("user.role", user.getRole());
span.setAttribute("payment.status", "completed");
```

### Filtering Sensitive HTTP Headers

Configure which HTTP headers the agent captures:

```bash title=".env"
# Only capture safe request headers
OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_REQUEST=content-type,accept,user-agent
# Block sensitive headers (excluded by default, but explicit is safer)
OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_SERVER_RESPONSE=content-type
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- SQL obfuscation is enabled by default
- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard
- Audit span attributes regularly for sensitive data leaks

## Performance Considerations

### Expected Performance Impact

The OpenTelemetry Java Agent adds minimal overhead to Micronaut applications:

- **Average latency increase**: 3-5ms per request
- **CPU overhead**: Less than 5% with batch processing
- **Memory overhead**: ~50-80MB for the agent itself
- **Startup time**: ~1-3 seconds additional for agent initialization

### Optimization Best Practices

#### 1. Use Batch Span Processing

```bash
# Production settings (low overhead)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

#### 2. Enable GZIP Compression

```bash
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
```

Reduces network bandwidth by 70-80%.

#### 3. Tune Metric Export Interval

```bash
# Default is 60s; 30s provides better granularity
OTEL_METRIC_EXPORT_INTERVAL=30000
```

#### 4. Filter Health Check Endpoints

Configure the OTel Collector to drop noisy health check spans:

```yaml title="config/otel-config.yaml (excerpt)"
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*health.*")'
```

#### 5. Disable Unused Instrumentation

If you don't need specific instrumentations, disable them:

```bash
# Disable specific instrumentations
OTEL_INSTRUMENTATION_KAFKA_ENABLED=false
OTEL_INSTRUMENTATION_GRPC_ENABLED=false
```

## Frequently Asked Questions

### Does the OpenTelemetry Java Agent impact Micronaut performance?

The agent adds approximately 3-5ms of latency per request. With batch
processing and GZIP compression, the overhead is minimal for production
workloads. The agent uses bytecode manipulation at class load time, so
there's a small startup cost (~1-3 seconds) but negligible runtime impact.

### Which Micronaut versions are supported?

The OpenTelemetry Java Agent supports Micronaut 3.x and 4.x with Java 17+.
Micronaut 4.x with Java 21+ is recommended. The agent instruments at the
Netty and JDBC level, which is stable across Micronaut versions.

### Are Hibernate JPA queries traced automatically?

Yes. The agent intercepts all JDBC calls, which includes every query
Hibernate executes. Spans include the SQL statement (parameters obfuscated),
database name, and operation type. No per-query code changes needed.

### Does the Java Agent propagate trace context across services?

Yes. The agent automatically injects W3C `traceparent` headers into outgoing
HTTP requests (via `java.net.http.HttpClient`, Apache HttpClient, OkHttp,
etc.) and extracts them from incoming requests. This enables distributed
tracing across services with zero code changes.

### Can I use the Java Agent with GraalVM native images?

No. The Java Agent relies on JVM bytecode manipulation, which is not
available in GraalVM native images. For native images, use the
[OpenTelemetry SDK](https://opentelemetry.io/docs/languages/java/libraries/)
with manual instrumentation instead of the agent.

### What is the difference between the Java Agent and the OpenTelemetry SDK?

The **Java Agent** provides zero-code instrumentation by attaching to the
JVM at startup. It instruments HTTP, JDBC, Netty, and 100+ libraries
automatically. The **SDK** requires you to add instrumentation code
manually. Use the agent for most applications; use the SDK when you need
fine-grained control or are building GraalVM native images.

### Can I use the Java Agent alongside other APM tools?

Yes, the agent can coexist with tools like New Relic or Datadog during
migration periods. However, running multiple JVM agents simultaneously
increases startup time and memory usage. Plan your migration to remove the
legacy agent once OpenTelemetry is validated.

### How do I instrument Micronaut Messaging consumers?

The Java Agent instruments Kafka and RabbitMQ consumers automatically. For
custom messaging, create manual spans:

```java
Span span = tracer.spanBuilder("process_message")
        .setSpanKind(SpanKind.CONSUMER)
        .setAttribute("messaging.system", "custom")
        .setAttribute("messaging.destination", queueName)
        .startSpan();
try (Scope scope = span.makeCurrent()) {
    processMessage(message);
    span.setStatus(StatusCode.OK);
} finally {
    span.end();
}
```

### How do I add tenant context in multi-tenant applications?

Use a Micronaut HTTP filter to add tenant attributes to every span:

```java
@Filter("/**")
public class TenantFilter implements HttpServerFilter {
    @Override
    public Publisher<MutableHttpResponse<?>> doFilter(
            HttpRequest<?> request, ServerFilterChain chain) {
        String tenantId = request.getHeaders().get("X-Tenant-ID");
        if (tenantId != null) {
            Span.current().setAttribute("tenant.id", tenantId);
        }
        return chain.proceed(request);
    }
}
```

### Can I use Micronaut's built-in metrics with OpenTelemetry?

Micronaut has its own Micrometer-based metrics system. The Java Agent
provides JVM and HTTP metrics independently. Both can coexist, but for
consistency we recommend using the OpenTelemetry Meter API
(`GlobalOpenTelemetry.getMeter()`) for custom metrics when using the agent.

## What's Next?

Now that your Micronaut application is instrumented with OpenTelemetry,
explore these resources:

### Advanced Topics

- **Custom Java Instrumentation** - Manual tracing, custom spans, and
  advanced instrumentation patterns
- **PostgreSQL Monitoring Best Practices** - Database observability with
  connection pooling metrics and query performance analysis

### Scout Platform Features

- **Creating Alerts** - Set up alerts for error rates, latency thresholds,
  and custom metrics
- **Dashboard Creation** - Build custom dashboards combining traces,
  metrics, and business KPIs

### Deployment and Operations

- **Docker Compose Setup** - Set up Scout Collector for local development
  and testing

### Related Frameworks

- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot
- [Quarkus Instrumentation](./quarkus.md) - Java Quarkus
- [Django Instrumentation](./django.md) - Python Django
- [Rails Instrumentation](./rails.md) - Ruby on Rails
- [Express.js Instrumentation](./express.md) - Node.js Express

## Complete Example

### Project Structure

```plaintext
micronaut-postgres/
+-- app/
|   +-- src/main/
|   |   +-- java/com/example/
|   |   |   +-- Application.java
|   |   |   +-- controller/
|   |   |   |   +-- ArticleController.java
|   |   |   |   +-- HealthController.java
|   |   |   +-- model/
|   |   |   |   +-- Article.java
|   |   |   +-- repository/
|   |   |   |   +-- ArticleRepository.java
|   |   |   +-- service/
|   |   |       +-- NotificationClient.java
|   |   |       +-- TelemetryService.java
|   |   +-- resources/
|   |       +-- application.yml
|   |       +-- logback.xml
|   |       +-- db/migration/
|   |           +-- V1__create_articles.sql
|   +-- build.gradle.kts
|   +-- Dockerfile
+-- notify/
|   +-- src/main/java/com/example/notify/
|   |   +-- Application.java
|   |   +-- controller/
|   |       +-- NotifyController.java
|   +-- build.gradle.kts
|   +-- Dockerfile
+-- config/
|   +-- otel-config.yaml
+-- compose.yml
+-- .env.example
+-- scripts/
    +-- test-api.sh
    +-- verify-scout.sh
```

### Running the Example

```bash
# Clone the examples repository
git clone https://github.com/base-14/examples.git
cd examples/java/micronaut-postgres

# Copy environment file
cp .env.example .env

# Start the stack
docker compose up --build

# Wait for services to be healthy (~30 seconds)
curl http://localhost:8080/api/health

# Run the full test suite
./scripts/test-api.sh
```

### Testing the API

```bash
# Create an article
curl -s -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "OpenTelemetry with Micronaut", "body": "Full observability"}' | jq .

# List articles
curl -s http://localhost:8080/api/articles | jq .

# Update an article
curl -s -X PUT http://localhost:8080/api/articles/1 \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Title"}' | jq .

# Delete an article
curl -s -X DELETE http://localhost:8080/api/articles/1
```

### Expected Trace Output

After making requests, you'll see traces in Scout Dashboard with:

- **HTTP spans** for each controller action (GET, POST, PUT, DELETE)
- **JDBC spans** for every Hibernate query (SELECT, INSERT, UPDATE, DELETE)
- **HTTP client spans** for the notification service call
- **Correlated logs** with `trace_id` and `span_id` in every JSON log line

```plaintext
POST /api/articles                           (3ms)
  +-- HikariCP getConnection                 (1ms)
  +-- INSERT INTO articles ...               (4ms)
  +-- POST http://notify:8081/notify         (15ms)
       +-- [micronaut-notify] POST /notify   (8ms)
```

Once telemetry is flowing, you can monitor Micronaut request performance in
Scout - track Hibernate query times, HTTP client latency, and error rates
from a unified dashboard.

## References

- [Official OpenTelemetry Java Documentation](https://opentelemetry.io/docs/languages/java/)
- [OpenTelemetry Java Agent](https://github.com/open-telemetry/opentelemetry-java-instrumentation)
- [Supported Libraries (Java Agent)](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md)
- [Micronaut Documentation](https://docs.micronaut.io/latest/guide/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Set up collector for local development
- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot
- [Quarkus Instrumentation](./quarkus.md) - Java Quarkus
- [Laravel Instrumentation](./laravel.md) - PHP Laravel framework
- [Express.js Instrumentation](./express.md) - Node.js Express framework
