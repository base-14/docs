---
title:
  Ktor OpenTelemetry Instrumentation - Java Agent, Exposed ORM & Netty
  Tracing
sidebar_label: Ktor
sidebar_position: 22
description:
  Instrument Kotlin Ktor applications with the OpenTelemetry Java Agent for
  zero-code tracing of HTTP requests, Exposed ORM queries, and Netty server
  operations. Export traces, metrics, and correlated logs to base14 Scout.
keywords:
  [
    ktor opentelemetry,
    ktor opentelemetry instrumentation,
    ktor monitoring,
    kotlin apm,
    ktor distributed tracing,
    ktor observability,
    ktor performance monitoring,
    opentelemetry java agent,
    ktor database monitoring,
    ktor metrics,
    ktor tracing,
    ktor exposed tracing,
    opentelemetry kotlin,
    ktor telemetry,
    ktor netty tracing,
    ktor log correlation,
    ktor instrumentation guide,
    kotlin opentelemetry,
    ktor auto instrumentation,
    kotlin ktor apm,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does the OpenTelemetry Java Agent impact Ktor performance?","acceptedAnswer":{"@type":"Answer","text":"The OpenTelemetry Java Agent adds approximately 3-5ms of latency per request in typical Ktor applications. With batch processing and GZIP compression, the overhead is minimal for production workloads."}},{"@type":"Question","name":"Which Ktor versions are supported?","acceptedAnswer":{"@type":"Answer","text":"The OpenTelemetry Java Agent supports Ktor 2.x and 3.x running on Netty. Ktor 3.x with Kotlin 2.x is recommended for optimal compatibility."}},{"@type":"Question","name":"Are Exposed ORM queries traced automatically?","acceptedAnswer":{"@type":"Answer","text":"Yes, the OpenTelemetry Java Agent instruments JDBC calls automatically, which includes all Exposed ORM queries. Spans include the SQL statement, database name, and operation type with no code changes."}},{"@type":"Question","name":"Does the Java Agent work with Kotlin coroutines?","acceptedAnswer":{"@type":"Answer","text":"Yes, the agent propagates trace context across coroutine boundaries automatically. Suspend functions, withContext switches, and Dispatchers.IO all maintain proper trace context."}},{"@type":"Question","name":"How do I correlate logs with traces in Ktor?","acceptedAnswer":{"@type":"Answer","text":"The Java Agent automatically injects trace_id and span_id into the SLF4J MDC. Use Logback with logstash-encoder to output JSON logs that include these fields for trace-log correlation."}},{"@type":"Question","name":"Can I use the Java Agent with GraalVM native images?","acceptedAnswer":{"@type":"Answer","text":"No, the Java Agent relies on JVM bytecode manipulation which is not available in GraalVM native images. For native images, use the OpenTelemetry SDK with manual instrumentation."}},{"@type":"Question","name":"Can I use the Java Agent alongside other APM tools?","acceptedAnswer":{"@type":"Answer","text":"Yes, the agent can coexist with tools like New Relic or Datadog during migration periods. However, running multiple agents simultaneously increases overhead."}},{"@type":"Question","name":"What is the difference between the Java Agent and Ktor's built-in tracing?","acceptedAnswer":{"@type":"Answer","text":"The Java Agent provides comprehensive zero-code instrumentation for HTTP, JDBC, Netty, and 100+ libraries. Ktor's built-in CallLogging plugin only covers HTTP request logging. The agent is recommended for full observability."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument Ktor with OpenTelemetry","step":[{"@type":"HowToStep","name":"Download the OpenTelemetry Java Agent","text":"Download the opentelemetry-javaagent.jar from the official GitHub releases page."},{"@type":"HowToStep","name":"Attach the agent to the JVM","text":"Set JAVA_TOOL_OPTIONS=-javaagent:/path/to/opentelemetry-javaagent.jar to attach the agent automatically on JVM startup."},{"@type":"HowToStep","name":"Configure OpenTelemetry environment","text":"Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, and other environment variables to configure trace export."},{"@type":"HowToStep","name":"Run and verify instrumentation","text":"Start the Ktor application, make test requests, and verify traces for HTTP requests, database queries, and service calls appear in base14 Scout."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

Implement OpenTelemetry instrumentation for Kotlin Ktor applications using
the OpenTelemetry Java Agent for zero-code distributed tracing, Exposed ORM
query monitoring, and structured log correlation. The Java Agent attaches to
the JVM at startup and automatically instruments HTTP requests, JDBC queries,
Netty server operations, and outgoing HTTP client calls without any code
changes.

Ktor applications benefit from the Java Agent's comprehensive coverage of
the JVM ecosystem including JDBC (via Exposed ORM), HikariCP connection
pools, Java HTTP clients, and Netty. With OpenTelemetry, you can monitor
production performance, debug slow requests, trace distributed transactions
across microservices, and correlate logs with traces using a single
`-javaagent` flag.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations for Ktor OpenTelemetry
instrumentation.

> **Note:** This guide provides a practical Ktor-focused overview based on
> the official OpenTelemetry documentation. For complete Java agent
> information, please consult the
> [official OpenTelemetry Java documentation](https://opentelemetry.io/docs/languages/java/).

:::tip TL;DR

Download the OpenTelemetry Java Agent JAR, set
`JAVA_TOOL_OPTIONS="-javaagent:/path/to/opentelemetry-javaagent.jar"`, and
configure `OTEL_SERVICE_NAME` + `OTEL_EXPORTER_OTLP_ENDPOINT`. HTTP
requests, Exposed/JDBC queries, Netty I/O, and HTTP client calls are traced
automatically with zero code changes. The agent injects `trace_id` and
`span_id` into SLF4J MDC for log correlation. Works seamlessly with Kotlin
coroutines.

:::

## Who This Guide Is For

This documentation is designed for:

- **Kotlin developers**: building Ktor APIs and implementing observability
  for the first time
- **Cloud-native teams**: running Ktor microservices in Kubernetes or Docker
- **DevOps engineers**: deploying Kotlin/JVM applications with production
  monitoring
- **Engineering teams**: migrating from Datadog, New Relic, or other
  commercial APM solutions
- **Platform teams**: standardizing observability across JVM services
  (Ktor, Micronaut, Spring Boot)

## Overview

This guide demonstrates how to:

- Attach the OpenTelemetry Java Agent to Ktor applications for zero-code
  instrumentation
- Configure trace export to Scout Collector via environment variables
- Set up structured JSON logging with automatic trace context correlation
- Wire custom metrics and spans using the OpenTelemetry API with Kotlin
  idioms
- Deploy instrumented applications with Docker Compose (app + notify +
  PostgreSQL + collector)
- Trace requests across multiple Ktor services (distributed tracing)
- Troubleshoot common instrumentation issues

## Prerequisites

Before starting, ensure you have:

- **Java 17 or later** (Java 21+ recommended for best performance)
  - Eclipse Temurin or any OpenJDK distribution
- **Kotlin 2.0 or later** (Kotlin 2.2+ recommended)
- **Ktor 2.x or 3.x** installed
  - Ktor 3.x is recommended for optimal compatibility
- **Gradle 8.x** for build management
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component                  | Minimum Version | Recommended Version |
| -------------------------- | --------------- | ------------------- |
| Java                       | 17              | 21+                 |
| Kotlin                     | 1.9.0           | 2.2.0+              |
| Ktor                       | 2.0.0           | 3.2.0+              |
| Gradle                     | 8.0             | 8.10+               |
| OpenTelemetry Java Agent   | 1.0.0           | 2.26.0+             |
| Exposed ORM                | 0.40.0          | 0.61.0+             |
| PostgreSQL Driver          | 42.5.0          | Latest stable        |

### Instrumented Components (Automatic)

The Java Agent instruments these components with zero code changes:

| Component             | Coverage                                          |
| --------------------- | ------------------------------------------------- |
| Ktor HTTP Server      | Routes, handlers, request/response attributes     |
| Netty                 | Server I/O, connection handling                   |
| Exposed / JDBC        | All SQL queries, transactions, connection pools    |
| Java HTTP Client      | Outgoing HTTP calls, W3C trace propagation        |
| HikariCP              | Connection pool metrics                           |
| Logback               | MDC injection of trace_id and span_id             |
| Flyway                | Database migration spans                          |
| Kotlin Coroutines     | Trace context propagation across suspensions       |

### Example Application

This guide references the
[ktor-postgres](https://github.com/base-14/examples/tree/main/kotlin/ktor-postgres)
example: a Ktor 3.2 REST API with Exposed ORM, a notification microservice,
and full OpenTelemetry instrumentation.

## Installation

### Step 1: Download the OpenTelemetry Java Agent

Download the latest agent JAR from the official releases:

```bash
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.26.1/opentelemetry-javaagent.jar
```

### Step 2: Attach the Agent to the JVM

The agent attaches via the `-javaagent` JVM flag. The simplest approach is
the `JAVA_TOOL_OPTIONS` environment variable:

```bash
export JAVA_TOOL_OPTIONS="-javaagent:/path/to/opentelemetry-javaagent.jar"
```

This works regardless of how you start your application (Gradle, java -jar,
etc.).

### Step 3: Add the OpenTelemetry API Dependency (Optional)

For custom metrics and manual spans, add the OpenTelemetry API to your
build. This is optional if you only need automatic instrumentation:

```kotlin title="build.gradle.kts" showLineNumbers
plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    id("io.ktor.plugin") version "3.2.0"
    id("com.gradleup.shadow") version "8.3.6"
}

dependencies {
    // Ktor core
    implementation("io.ktor:ktor-server-core:3.2.0")
    implementation("io.ktor:ktor-server-netty:3.2.0")
    implementation("io.ktor:ktor-server-content-negotiation:3.2.0")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.2.0")
    implementation("io.ktor:ktor-server-status-pages:3.2.0")

    // Database (Exposed ORM + PostgreSQL)
    implementation("org.jetbrains.exposed:exposed-core:0.61.0")
    implementation("org.jetbrains.exposed:exposed-dao:0.61.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:0.61.0")
    implementation("org.jetbrains.exposed:exposed-kotlin-datetime:0.61.0")
    implementation("com.zaxxer:HikariCP:6.2.1")
    implementation("org.postgresql:postgresql:42.7.7")

    // Flyway migrations
    implementation("org.flywaydb:flyway-core:12.2.0")
    runtimeOnly("org.flywaydb:flyway-database-postgresql:12.2.0")

    // Optional: OTel API for custom metrics and spans
    implementation("io.opentelemetry:opentelemetry-api:1.48.0")

    // Logging
    implementation("ch.qos.logback:logback-classic:1.5.18")
    implementation("net.logstash.logback:logstash-logback-encoder:8.1")
}
```

The `opentelemetry-api` dependency is a compile-time-only API. The Java Agent
provides the implementation at runtime.

## Configuration

```mdx-code-block
<Tabs>
<TabItem value="env" label="Environment Variables (Recommended)" default>
```

Configure the agent entirely through environment variables:

```bash title=".env"
# OpenTelemetry Java Agent
OTEL_SERVICE_NAME=ktor-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_METRIC_EXPORT_INTERVAL=10000
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development
```

The agent reads these variables at startup. No application code or config
files need to change.

```mdx-code-block
</TabItem>
<TabItem value="app" label="Ktor Application Setup">
```

Ktor uses programmatic configuration. Here's the application entry point
with database and service wiring:

```kotlin title="src/main/kotlin/com/example/Application.kt" showLineNumbers
package com.example

import com.example.plugins.configureRouting
import com.example.plugins.configureSerialization
import com.example.repository.ArticleRepository
import com.example.service.NotificationClient
import com.example.service.TelemetryService
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.sql.Database

fun main() {
    embeddedServer(Netty, serverConfig {
        module(Application::module)
    }) {
        connector { port = 8080 }
    }.start(wait = true)
}

fun Application.module() {
    val dataSource = HikariDataSource(HikariConfig().apply {
        jdbcUrl = "jdbc:postgresql://${env("DB_HOST", "localhost")}:${env("DB_PORT", "5432")}/${env("DB_NAME", "ktor_articles")}"
        username = env("DB_USER", "postgres")
        password = env("DB_PASSWORD", "postgres")
        maximumPoolSize = 10
    })

    Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:db/migration")
        .load()
        .migrate()

    Database.connect(dataSource)

    val articleRepository = ArticleRepository()
    val notificationClient = NotificationClient(env("NOTIFY_URL", "http://localhost:8081"))
    val telemetryService = TelemetryService()

    configureSerialization()
    configureRouting(articleRepository, notificationClient, telemetryService, dataSource)
}

private fun env(name: String, default: String): String =
    System.getenv(name) ?: default
```

The Java Agent instruments HikariCP, JDBC, and Netty automatically
regardless of how you configure the application.

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Compose">
```

Run the full observability stack locally:

```yaml title="compose.yml" showLineNumbers
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.148.0
    command: ["--config=/etc/otel/config.yaml"]
    volumes:
      - ./config/otel-config.yaml:/etc/otel/config.yaml:ro
    ports:
      - "4317:4317"
      - "4318:4318"
    environment:
      SCOUT_ENDPOINT: ${SCOUT_ENDPOINT:-http://localhost:4318}
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID:-}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET:-}
      SCOUT_TOKEN_URL: ${SCOUT_TOKEN_URL:-http://localhost/token}
    restart: unless-stopped

  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: ktor_articles
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
    build: ./app
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
      DB_PORT: "5432"
      DB_NAME: ktor_articles
      DB_USER: postgres
      DB_PASSWORD: postgres
      NOTIFY_URL: http://notify:8081
      OTEL_SERVICE_NAME: ktor-articles
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_METRIC_EXPORT_INTERVAL: "10000"
      OTEL_LOGS_EXPORTER: otlp
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/api/health"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 10
    restart: unless-stopped

volumes:
  pgdata:
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Configure Structured Logging

Set up Logback with JSON output. The Java Agent automatically injects
`trace_id` and `span_id` into the SLF4J MDC:

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

    <logger name="com.example" level="DEBUG" />
    <logger name="io.ktor" level="INFO" />
    <logger name="io.netty" level="WARN" />
    <logger name="com.zaxxer.hikari" level="WARN" />
    <logger name="org.flywaydb" level="INFO" />
</configuration>
```

Every log line includes `trace_id` and `span_id` automatically.

### Scout Collector Integration

Configure trace export to Scout with OAuth2 authentication:

```bash title=".env"
SCOUT_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token

OTEL_SERVICE_NAME=ktor-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

> **Scout Dashboard Integration**: After configuration, your traces will
> appear in the Scout Dashboard. Navigate to the Traces section to view
> request flows, identify bottlenecks, and analyze distributed transactions.

## Production Configuration

### Production Environment Variables

```bash title=".env.production"
OTEL_SERVICE_NAME=ktor-app
OTEL_SERVICE_VERSION=2.1.3
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com/v1/traces
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_EXPORTER_OTLP_TIMEOUT=10000

# Batch Span Processor (Production Optimized)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

OTEL_METRIC_EXPORT_INTERVAL=30000
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,host.name=${HOSTNAME}
```

### Docker Production Configuration

Multi-stage Dockerfile that builds a shadow JAR and bakes in the
OpenTelemetry Java Agent:

```dockerfile title="Dockerfile" showLineNumbers
FROM eclipse-temurin:24-jdk AS builder
WORKDIR /app

COPY gradle/ gradle/
COPY gradlew settings.gradle.kts build.gradle.kts ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon

COPY src/ src/
RUN ./gradlew shadowJar --no-daemon

FROM eclipse-temurin:24-jre
WORKDIR /app

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

ARG OTEL_AGENT_VERSION=2.26.1
ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

RUN addgroup --gid 1001 appgroup && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" appuser && \
    chown appuser:appgroup /app/opentelemetry-javaagent.jar

COPY --from=builder --chown=appuser:appgroup /app/build/libs/app.jar /app/app.jar

USER appuser
EXPOSE 8080

ENV JAVA_TOOL_OPTIONS="-javaagent:/app/opentelemetry-javaagent.jar"

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Key details:

- **Multi-stage build** separates Gradle build from runtime image
- **Shadow JAR** bundles all Kotlin/Ktor dependencies into `app.jar`
- **OTel Java Agent** downloaded and baked into the image
- **`JAVA_TOOL_OPTIONS`** attaches the agent on every JVM start
- **Non-root user** (`appuser:1001`) for security

### Multi-Service Distributed Tracing

For architectures with multiple services, each gets its own
`OTEL_SERVICE_NAME`. The Java Agent automatically propagates W3C
`traceparent` headers on outgoing HTTP requests.

Here's the notification client from the example app:

```kotlin title="src/main/kotlin/com/example/service/NotificationClient.kt" showLineNumbers
package com.example.service

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

class NotificationClient(private val notifyUrl: String) {

    private val logger = LoggerFactory.getLogger(NotificationClient::class.java)
    private val httpClient = HttpClient.newHttpClient()

    suspend fun notify(payload: Map<String, String>) {
        withContext(Dispatchers.IO) {
            val json = Json.encodeToString(payload)
            val request = HttpRequest.newBuilder()
                .uri(URI.create("$notifyUrl/notify"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build()
            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
            logger.info("Notification sent: status={}", response.statusCode())
        }
    }
}
```

The Java Agent instruments `java.net.http.HttpClient` automatically, injecting
the `traceparent` header. Trace context is maintained across the
`withContext(Dispatchers.IO)` coroutine switch.

Add the notification service to Docker Compose:

```yaml title="compose.yml (excerpt)"
services:
  app:
    environment:
      OTEL_SERVICE_NAME: ktor-articles
      NOTIFY_URL: http://notify:8081

  notify:
    build: ./notify
    environment:
      OTEL_SERVICE_NAME: ktor-notify
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_LOGS_EXPORTER: otlp
    ports:
      - "8081:8081"
```

In Scout Dashboard, you'll see the full distributed trace:

```plaintext
ktor-articles: POST /api/articles
  +-- INSERT INTO articles ...
  +-- POST http://notify:8081/notify
       +-- ktor-notify: POST /notify (linked trace)
```

## Ktor-Specific Features

### Automatic HTTP Request Tracing

The Java Agent instruments Ktor's Netty-based HTTP server automatically.
Every request creates a root span with:

- `http.method` - Request method (GET, POST, etc.)
- `http.route` - Matched route pattern (e.g., `/api/articles/{id}`)
- `http.status_code` - Response status code
- `url.path` - Request URI path

Ktor DSL routing maps directly to span names:

```kotlin
routing {
    route("/api/articles") {
        get {
            // Auto-instrumented: creates span "GET /api/articles"
        }

        get("/{id}") {
            // Auto-instrumented: creates span "GET /api/articles/{id}"
            // Uses route pattern, not the actual ID (low cardinality)
        }

        post {
            // Auto-instrumented: creates span "POST /api/articles"
        }
    }
}
```

### Exposed ORM Query Tracing

All Exposed queries are traced automatically via JDBC instrumentation.
Each query creates a span with:

- `db.system` - Database type (`postgresql`)
- `db.name` - Database name
- `db.statement` - SQL query (parameters obfuscated)
- `db.operation` - Operation type (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)

```kotlin
// These are all automatically traced:

// Exposed DSL query
suspend fun findAll(page: Int, perPage: Int) = dbQuery {
    val total = Articles.selectAll().count()
    val articles = Articles.selectAll()
        .orderBy(Articles.createdAt, SortOrder.DESC)
        .limit(perPage)
        .offset((page.toLong() - 1) * perPage.toLong())
        .map { it.toDto() }
    articles to total
}

// Exposed insert
suspend fun create(title: String, body: String) = dbQuery {
    Articles.insert {
        it[Articles.title] = title
        it[Articles.body] = body
        it[createdAt] = OffsetDateTime.now()
        it[updatedAt] = OffsetDateTime.now()
    }
}
```

In Scout Dashboard, you'll see spans like:

```plaintext
SELECT ... FROM articles ORDER BY ...  (db.system=postgresql, db.operation=SELECT)
INSERT INTO articles ...               (db.system=postgresql, db.operation=INSERT)
```

### Kotlin Coroutines Support

The Java Agent propagates trace context across coroutine boundaries
automatically. Suspend functions, `withContext` dispatcher switches, and
`newSuspendedTransaction` all maintain proper trace context:

```kotlin
// Trace context is preserved across the coroutine switch
suspend fun <T> dbQuery(block: suspend () -> T): T =
    newSuspendedTransaction(Dispatchers.IO) { block() }

// This suspend function inherits the parent span's context
suspend fun notify(payload: Map<String, String>) {
    withContext(Dispatchers.IO) {
        // HTTP call here is still linked to the parent trace
        httpClient.send(request, HttpResponse.BodyHandlers.ofString())
    }
}
```

### Flyway Migration Tracing

Database migrations executed by Flyway during application startup are
automatically traced. Each migration file creates a span, giving you
visibility into startup time.

### Logback Trace-Log Correlation

The Java Agent automatically injects `trace_id` and `span_id` into the
SLF4J MDC. Combined with `logstash-logback-encoder`, every JSON log line
includes trace context:

```json
{
  "message": "Article created: id=42, title=Hello",
  "logger_name": "com.example.routes.ArticleRoutes",
  "level": "INFO",
  "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "span_id": "1a2b3c4d5e6f7a8b"
}
```

This is fully automatic — no custom MDC manipulation needed.

## Custom Instrumentation

### Custom Business Metrics

Create a telemetry service to register and increment custom counters:

```kotlin title="src/main/kotlin/com/example/service/TelemetryService.kt" showLineNumbers
package com.example.service

import io.opentelemetry.api.GlobalOpenTelemetry
import io.opentelemetry.api.metrics.LongCounter

class TelemetryService {

    private val articlesCreated: LongCounter = GlobalOpenTelemetry.getMeter("ktor-articles")
        .counterBuilder("articles.created")
        .setDescription("Total number of articles created")
        .build()

    fun incrementArticlesCreated() {
        articlesCreated.add(1)
    }
}
```

Use it in your route handler:

```kotlin title="src/main/kotlin/com/example/routes/ArticleRoutes.kt (excerpt)"
post {
    val request = call.receive<CreateArticleRequest>()
    val article = repository.create(request.title!!, request.body!!)

    telemetryService.incrementArticlesCreated()
    logger.info("Article created: id={}, title={}", article.id, article.title)

    try {
        notificationClient.notify(mapOf(
            "event" to "article.created",
            "article_id" to article.id.toString(),
            "title" to article.title
        ))
    } catch (e: Exception) {
        logger.warn("Failed to send notification: {}", e.message)
    }

    call.respond(HttpStatusCode.Created, ArticleResponse(
        data = article,
        meta = TraceMeta(traceId = currentTraceId())
    ))
}
```

### Including Trace ID in API Responses

Include the trace ID in API responses so clients can correlate their
requests with backend traces:

```kotlin
private fun currentTraceId(): String {
    val span = Span.current()
    val ctx = span.spanContext
    return if (ctx.isValid) ctx.traceId else ""
}
```

### Manual Span Creation

Create custom spans for business-critical operations:

```kotlin title="src/main/kotlin/com/example/service/ReportService.kt" showLineNumbers
package com.example.service

import io.opentelemetry.api.GlobalOpenTelemetry
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode

class ReportService {

    private val tracer = GlobalOpenTelemetry.getTracer("report-service", "1.0.0")

    suspend fun generateReport(userId: Long, reportType: String): ByteArray {
        val span = tracer.spanBuilder("generate_report")
            .setSpanKind(SpanKind.INTERNAL)
            .setAttribute("report.type", reportType)
            .setAttribute("user.id", userId)
            .startSpan()

        return span.makeCurrent().use { scope ->
            try {
                val report = buildReport(userId, reportType)
                span.setAttribute("report.size_bytes", report.size.toLong())
                span.setStatus(StatusCode.OK)
                report
            } catch (e: Exception) {
                span.recordException(e)
                span.setStatus(StatusCode.ERROR, e.message ?: "Unknown error")
                throw e
            } finally {
                span.end()
            }
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
export OTEL_SERVICE_NAME=ktor-app-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Run with Gradle
./gradlew run
```

### Docker Deployment

Run the full stack with Docker Compose:

```bash
# Start all services
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
  -d '{"title": "Hello OpenTelemetry", "body": "Tracing with Ktor"}'

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
       +-- ktor-notify: POST /notify  (SERVER   - java-agent)
```

For a list request:

```plaintext
GET /api/articles                     (SERVER   - java-agent)
  +-- HikariCP getConnection          (INTERNAL - java-agent)
  +-- SELECT ... FROM articles ...    (CLIENT   - java-agent/jdbc)
  +-- SELECT COUNT(*) FROM articles   (CLIENT   - java-agent/jdbc)
```

Check for:

- **Spans** with correct `service.name` and proper nesting
- **Logs** with `trace_id` and `span_id` in the JSON output
- **Metrics** with `articles.created` counter incrementing

## Troubleshooting

### Verifying Agent Attachment

```bash
# Check that the agent is loaded
docker compose logs app | grep -i "opentelemetry"

# Verify JAVA_TOOL_OPTIONS is set
docker compose exec app env | grep JAVA_TOOL_OPTIONS
```

You should see:

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

2. Check the collector endpoint is reachable:

   ```bash
   curl -v http://otel-collector:4318/v1/traces
   ```

3. Enable debug logging on the agent:

   ```bash
   export OTEL_JAVAAGENT_DEBUG=true
   ```

4. Check collector logs for errors:

   ```bash
   docker compose logs otel-collector
   ```

#### Issue: No JDBC/Exposed query spans

**Solutions:**

1. Verify the agent is attached (see above). JDBC instrumentation is
   included by default.

2. Check that the database connection is working:

   ```bash
   curl http://localhost:8080/api/health
   ```

3. Ensure HikariCP is connecting successfully — check app logs for pool
   initialization messages.

#### Issue: No trace context propagation between services

**Solutions:**

1. Verify both services have the Java Agent attached:

   ```bash
   docker compose logs app | head -20
   docker compose logs notify | head -20
   ```

2. Ensure the HTTP client being used is supported. The standard
   `java.net.http.HttpClient` used in the example is instrumented
   automatically.

#### Issue: Log correlation not working (missing trace_id)

**Solutions:**

1. Verify `logstash-logback-encoder` is in dependencies:

   ```bash
   ./gradlew dependencies | grep logstash
   ```

2. Check that `logback.xml` uses `LogstashEncoder` with MDC key names:

   ```xml
   <encoder class="net.logstash.logback.encoder.LogstashEncoder">
       <includeMdcKeyName>trace_id</includeMdcKeyName>
       <includeMdcKeyName>span_id</includeMdcKeyName>
   </encoder>
   ```

#### Issue: High memory usage

**Solutions:**

1. Reduce the batch queue size:

   ```bash
   export OTEL_BSP_MAX_QUEUE_SIZE=1024
   ```

2. Set JVM heap limits:

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

### Protecting Sensitive Data

Never add sensitive information to span attributes:

```kotlin
// Bad - exposes sensitive data
span.setAttribute("user.password", user.password)       // Never!
span.setAttribute("user.email", user.email)             // PII risk

// Good - uses safe identifiers
span.setAttribute("user.id", user.id)
span.setAttribute("user.role", user.role)
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- SQL obfuscation is enabled by default
- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard

## Performance Considerations

### Expected Performance Impact

The OpenTelemetry Java Agent adds minimal overhead to Ktor applications:

- **Average latency increase**: 3-5ms per request
- **CPU overhead**: Less than 5% with batch processing
- **Memory overhead**: ~50-80MB for the agent itself
- **Startup time**: ~1-3 seconds additional for agent initialization

### Optimization Best Practices

#### 1. Use Batch Span Processing

```bash
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

#### 2. Enable GZIP Compression

```bash
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
```

Reduces network bandwidth by 70-80%.

#### 3. Filter Health Check Endpoints

```yaml title="config/otel-config.yaml (excerpt)"
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*health.*")'
```

#### 4. Disable Unused Instrumentation

```bash
OTEL_INSTRUMENTATION_KAFKA_ENABLED=false
OTEL_INSTRUMENTATION_GRPC_ENABLED=false
```

## Frequently Asked Questions

### Does the OpenTelemetry Java Agent impact Ktor performance?

The agent adds approximately 3-5ms of latency per request. With batch
processing and GZIP compression, the overhead is minimal. The agent uses
bytecode manipulation at class load time, so there's a small startup cost
(~1-3 seconds) but negligible runtime impact.

### Which Ktor versions are supported?

The OpenTelemetry Java Agent supports Ktor 2.x and 3.x running on Netty.
Ktor 3.x with Kotlin 2.x is recommended for optimal compatibility.

### Are Exposed ORM queries traced automatically?

Yes. The agent intercepts all JDBC calls, which includes every query
Exposed executes through its JDBC layer. Spans include the SQL statement
(parameters obfuscated), database name, and operation type.

### Does the Java Agent work with Kotlin coroutines?

Yes. The agent propagates trace context across coroutine boundaries
automatically. Suspend functions, `withContext` dispatcher switches, and
`newSuspendedTransaction` all maintain proper trace context.

### Can I use the Java Agent with GraalVM native images?

No. The Java Agent relies on JVM bytecode manipulation, which is not
available in GraalVM native images. For native images, use the
OpenTelemetry SDK with manual instrumentation.

### What is the difference between the Java Agent and Ktor's built-in tracing?

The **Java Agent** provides comprehensive zero-code instrumentation for
HTTP, JDBC, Netty, and 100+ libraries. Ktor's built-in `CallLogging` plugin
only covers HTTP request logging. The agent is recommended for full
observability.

### Can I use the Java Agent alongside other APM tools?

Yes, the agent can coexist with tools like New Relic or Datadog during
migration periods. Running multiple JVM agents simultaneously increases
startup time and memory usage.

### How do I instrument Ktor WebSockets?

The Java Agent instruments WebSocket frames automatically when using Ktor's
WebSocket plugin on Netty. Each WebSocket connection creates a span.

### How do I add tenant context in multi-tenant applications?

Use a Ktor interceptor to add tenant attributes:

```kotlin
intercept(ApplicationCallPipeline.Monitoring) {
    val tenantId = call.request.headers["X-Tenant-ID"]
    if (tenantId != null) {
        Span.current().setAttribute("tenant.id", tenantId)
    }
}
```

### Does `kotlinx.serialization` affect tracing?

No. Serialization happens within the already-instrumented HTTP handler span.
There's no separate serialization instrumentation needed.

## What's Next?

Now that your Ktor application is instrumented with OpenTelemetry, explore
these resources:

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

### Related Frameworks

- [Micronaut Instrumentation](./micronaut.md) - Java Micronaut
- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot
- [Quarkus Instrumentation](./quarkus.md) - Java Quarkus
- [Express.js Instrumentation](./express.md) - Node.js Express

## Complete Example

### Project Structure

```plaintext
ktor-postgres/
+-- app/
|   +-- src/main/
|   |   +-- kotlin/com/example/
|   |   |   +-- Application.kt
|   |   |   +-- model/
|   |   |   |   +-- Article.kt
|   |   |   +-- plugins/
|   |   |   |   +-- Routing.kt
|   |   |   |   +-- Serialization.kt
|   |   |   +-- repository/
|   |   |   |   +-- ArticleRepository.kt
|   |   |   +-- routes/
|   |   |   |   +-- ArticleRoutes.kt
|   |   |   |   +-- HealthRoutes.kt
|   |   |   +-- service/
|   |   |       +-- NotificationClient.kt
|   |   |       +-- TelemetryService.kt
|   |   +-- resources/
|   |       +-- logback.xml
|   |       +-- db/migration/
|   |           +-- V1__create_articles.sql
|   +-- build.gradle.kts
|   +-- Dockerfile
+-- notify/
|   +-- src/main/kotlin/com/example/notify/
|   |   +-- Application.kt
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
cd examples/kotlin/ktor-postgres

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
  -d '{"title": "OpenTelemetry with Ktor", "body": "Full observability"}' | jq .

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

```plaintext
POST /api/articles                           (3ms)
  +-- HikariCP getConnection                 (1ms)
  +-- INSERT INTO articles ...               (4ms)
  +-- POST http://notify:8081/notify         (15ms)
       +-- [ktor-notify] POST /notify        (8ms)
```

Once telemetry is flowing, you can monitor Ktor request performance in
Scout — track Exposed query times, HTTP client latency, and error rates
from a unified dashboard.

## References

- [Official OpenTelemetry Java Documentation](https://opentelemetry.io/docs/languages/java/)
- [OpenTelemetry Java Agent](https://github.com/open-telemetry/opentelemetry-java-instrumentation)
- [Supported Libraries (Java Agent)](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/docs/supported-libraries.md)
- [Ktor Documentation](https://ktor.io/docs/welcome.html)
- [Exposed ORM Documentation](https://jetbrains.github.io/Exposed/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Set up collector for local development
- [Micronaut Instrumentation](./micronaut.md) - Java Micronaut
- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot
- [Quarkus Instrumentation](./quarkus.md) - Java Quarkus
- [Laravel Instrumentation](./laravel.md) - PHP Laravel framework
