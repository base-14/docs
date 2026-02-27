---
title:
  Spring AI OpenTelemetry Instrumentation - Java LLM Tracing & Metrics Guide |
  base14 Scout
sidebar_label: Java AI Observability
sidebar_position: 10
description:
  Trace LLM calls, track token costs, and monitor AI pipelines in Spring AI
  apps. Three-layer OpenTelemetry setup with Java Agent, Spring AI Micrometer,
  and GenAI semantic conventions.
keywords:
  [
    java ai observability,
    spring ai opentelemetry,
    java genai semantic conventions,
    spring boot llm tracing,
    spring ai monitoring,
    java llm cost tracking,
    java ai application monitoring,
    spring boot opentelemetry,
    java agent opentelemetry,
    spring ai tool calling observability,
    java rag observability,
    java multi-provider llm,
    micrometer opentelemetry bridge,
    java token tracking,
    java ai agent tracing,
    opentelemetry java llm spans,
    java llm retry fallback,
    java ai production monitoring,
  ]
---

import Tabs from '@theme/Tabs'; import TabItem from '@theme/TabItem';

# Java AI Observability

Implement unified observability for Java AI applications using OpenTelemetry and
Spring AI. This guide shows you how to instrument a conversational AI customer
support agent with three-layer instrumentation unique to the Java ecosystem —
the OpenTelemetry Java Agent for zero-code auto-capture of HTTP and database
spans, Spring AI's built-in Micrometer observations bridged to OpenTelemetry for
ChatModel and VectorStore spans, and manual OpenTelemetry API calls for GenAI
semantic convention spans with token, cost, and pipeline context. The result is
a single correlated trace that connects every layer of your AI application, from
HTTP entry through intent classification, RAG retrieval, tool calling, and LLM
completion.

Java AI applications have a distinct observability advantage over other
languages. An LLM call is not just an HTTP request — it carries semantic
meaning: which model was used, how many tokens were consumed, what it cost,
whether the response was a fallback from another provider. Java uniquely offers
three composable instrumentation layers: the OpenTelemetry Java Agent
(`-javaagent` flag) provides zero-code auto-instrumentation for HTTP
server/client spans, JDBC queries, and R2DBC connections. Spring AI emits
Micrometer observations for ChatModel and VectorStore operations, which the
`micrometer-tracing-bridge-otel` dependency bridges directly into OpenTelemetry.
And the manual OpenTelemetry API (`GlobalOpenTelemetry.getTracer()` /
`getMeter()`) adds GenAI semantic convention attributes and custom metrics that
neither auto layer provides. All three layers share the same trace context,
producing a unified trace with zero instrumentation gaps.

Whether you are building AI support systems with Spring AI, integrating OpenAI,
Anthropic, or Ollama as LLM providers, or running local models for development,
this guide provides production-ready patterns for unified AI observability in
Java. You will learn how to set up three-pillar telemetry (traces, metrics,
logs), create GenAI spans with the correct semantic conventions, define 11
standard metrics covering token usage, cost, duration, errors, retries, and
fallbacks, instrument a 6-stage AI support pipeline with parent-child spans,
implement Spring AI tool calling with `@Tool` methods, set up RAG with pgvector
and track retrieval quality metrics, implement multi-provider LLM support with
retry and fallback observability, track domain-specific business metrics like
conversation duration and escalation rates, and deploy with Docker Compose and
the OpenTelemetry Collector — all visible in a single trace on base14 Scout.

:::info Cross-references

For general LLM observability patterns applicable to any language, see the
[LLM Observability guide](./llm-observability). This guide focuses specifically
on Java and Spring AI integration patterns. For Rust AI applications, see the
[Rust LLM Observability guide](./rust-llm-observability). For non-AI Java web
application instrumentation, check if a Spring Boot auto-instrumentation guide
is available under
[auto-instrumentation](../../instrument/apps/auto-instrumentation/).

:::

:::tip TL;DR

Add the OpenTelemetry Java Agent (`-javaagent`), Spring AI's Micrometer bridge
(`micrometer-tracing-bridge-otel`), and manual `GlobalOpenTelemetry` calls to
get unified traces across HTTP, database, LLM, and pipeline layers. This guide
covers Spring Boot 4.0.3 + Spring AI 2.0 with OpenAI, Anthropic, and Ollama.

:::

## Who This Guide Is For

This documentation is designed for:

- **Java/Spring AI developers**: building LLM-powered features (customer
  support, chatbots, AI assistants) and needing visibility into model
  performance, cost, and pipeline throughput
- **Backend developers**: adding AI capabilities to existing Spring Boot
  applications and wanting unified tracing across HTTP, database, and LLM layers
- **Platform teams**: standardizing observability across Java AI services and
  traditional microservices using OpenTelemetry
- **Engineering teams**: migrating from DataDog, New Relic, or other commercial
  APM solutions to open-standard OpenTelemetry
- **DevOps engineers**: deploying Java AI applications with production
  monitoring, cost alerting, and pipeline health tracking

## Overview

This guide demonstrates how to:

- Set up three-layer OpenTelemetry for a Java AI application (Java Agent +
  Spring AI + manual OTel API)
- Create custom LLM spans following OpenTelemetry GenAI semantic conventions
- Define GenAI metrics for token usage, cost, duration, errors, retries, and
  fallbacks
- Instrument a 6-stage AI support pipeline with parent-child spans
- Implement Spring AI tool calling with observability (`@Tool` methods)
- Set up RAG with pgvector and track retrieval quality metrics
- Implement multi-provider LLM support (OpenAI, Anthropic, Ollama) with retry
  and fallback observability
- Track domain-specific business metrics (conversation duration, escalation
  rates, tool success)
- Deploy with Docker Compose and the OpenTelemetry Collector

## Prerequisites

Before starting, ensure you have:

- **Java 25+** installed (21+ minimum)
- **Spring Boot 4.0.3+**
- **Spring AI 2.0+** (BOM `2.0.0-M2` or later)
- **Scout Collector** configured and accessible from your application — see
  [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  for local development
- **Basic understanding of OpenTelemetry concepts** (traces, spans, attributes)

### Compatibility Matrix

| Component                | Minimum Version | Recommended Version |
| ------------------------ | --------------- | ------------------- |
| Java                     | 21              | 25+                 |
| Spring Boot              | 3.4+            | 4.0.3+              |
| Spring AI                | 1.0.0           | 2.0.0-M2+           |
| OpenTelemetry Java Agent | 2.0.0           | 2.25.0+             |
| OpenTelemetry API        | 1.40.0          | 1.52.0+             |
| PostgreSQL (pgvector)    | 15              | 18+                 |

## The Unified Trace

The core value of OpenTelemetry for Java AI applications is the **unified
trace** — a single trace ID that connects every instrumentation layer, from HTTP
entry through pipeline orchestration to LLM completions and database queries.

Here is what a trace looks like for a customer support chat request that spans
all three layers:

```text showLineNumbers title="Single trace spanning all three instrumentation layers"
POST /api/chat                              3.8s  [Layer 1: Java Agent]
├─ support_conversation                     3.7s  [Layer 3: Manual OTel]
│  ├─ classify_intent                       0.4s  [Layer 3: Manual OTel]
│  │  └─ gen_ai.chat gpt-4.1-mini          0.3s  [Layer 3: Manual OTel]
│  │     └─ ChatModel                       0.3s  [Layer 2: Spring AI]
│  │        └─ HTTP POST api.openai.com     0.3s  [Layer 1: Java Agent]
│  ├─ rag_retrieval                         0.1s  [Layer 3: Manual OTel]
│  │  └─ VectorStore                        0.1s  [Layer 2: Spring AI]
│  │     └─ db.query pgvector              15ms   [Layer 1: Java Agent]
│  ├─ generate_response                     3.1s  [Layer 3: Manual OTel]
│  │  └─ gen_ai.chat gpt-4.1               3.0s  [Layer 3: Manual OTel]
│  │     └─ ChatModel                       3.0s  [Layer 2: Spring AI]
│  │        ├─ HTTP POST api.openai.com     1.2s  [Layer 1: Java Agent]
│  │        ├─ @Tool getOrderStatus          8ms  [Layer 2: Spring AI]
│  │        │  └─ db.query orders            5ms  [Layer 1: Java Agent]
│  │        └─ HTTP POST api.openai.com     1.7s  [Layer 1: Java Agent]
│  └─ escalation_check                      1ms   [Layer 3: Manual OTel]
```

Three instrumentation layers work together in a single trace:

- **Layer 1 — Java Agent** (zero-code): Captures the outermost HTTP server span,
  outbound HTTP client spans to LLM APIs, and JDBC database query spans — all
  without any code changes
- **Layer 2 — Spring AI** (Micrometer bridge): Adds ChatModel call spans,
  VectorStore query spans, and `@Tool` method execution spans as children of the
  current trace context
- **Layer 3 — Manual OTel API**: Adds GenAI semantic convention attributes
  (model, tokens, cost), pipeline orchestration spans (`support_conversation`,
  `classify_intent`, `rag_retrieval`), and custom metrics

The Java Agent provides context propagation that ties everything together.
Spring AI observations nest inside that context. Manual spans add the
GenAI-specific metadata that neither auto layer provides. The result is a trace
where you can see that a 3.8-second customer support response spent 0.4 seconds
on intent classification with `gpt-4.1-mini`, 0.1 seconds on RAG retrieval, and
3.1 seconds on response generation with `gpt-4.1` including a tool call to look
up order status.

## Three-Layer Architecture

Java AI applications benefit from a three-layer instrumentation approach that no
other language ecosystem matches. Each layer captures telemetry at a different
level of abstraction, and all three compose into unified traces through shared
OpenTelemetry context propagation.

| Layer              | Source                                                       | What It Captures                                                        |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 1. Java Agent      | `opentelemetry-javaagent.jar` (zero-code)                    | HTTP server/client spans, JDBC/R2DBC queries, Spring WebFlux            |
| 2. Spring AI       | Micrometer observations via `micrometer-tracing-bridge-otel` | ChatModel calls, VectorStore operations, tool execution                 |
| 3. Manual OTel API | `GlobalOpenTelemetry.getTracer()` / `getMeter()`             | GenAI semantic convention spans, custom metrics, pipeline orchestration |

### Layer 1: Java Agent (Zero-Code Auto-Instrumentation)

The OpenTelemetry Java Agent attaches to the JVM via the `-javaagent` flag and
automatically instruments HTTP, database, and messaging frameworks with zero
code changes. It provides the outermost spans in every trace and handles context
propagation between all layers.

What it captures:

- **HTTP server spans** — Spring WebFlux incoming requests with method, path,
  status code, and latency
- **HTTP client spans** — outbound calls to LLM provider APIs (OpenAI,
  Anthropic) with URL, status, and duration
- **JDBC spans** — tool database queries (order lookups, product searches) with
  SQL statement and execution time
- **R2DBC spans** — reactive database access for conversation persistence

Configuration is entirely via environment variables. No code changes or
dependency additions are needed — the agent injects instrumentation at the
bytecode level.

The Dockerfile downloads the agent JAR and attaches it at startup:

```dockerfile showLineNumbers title="Dockerfile"
FROM gradle:9.2.1-jdk25 AS builder

WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY src ./src

RUN gradle build -x test --no-daemon

FROM eclipse-temurin:25-jre

WORKDIR /app

ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.25.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

COPY --from=shared pricing.json /app/pricing.json

COPY --from=builder /app/build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

The agent is configured through environment variables in the Docker Compose
service definition:

```yaml showLineNumbers title="compose.yml (agent environment variables)"
environment:
  OTEL_SERVICE_NAME: ai-customer-support
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED: "true"
```

### Layer 2: Spring AI Observations (Micrometer Bridge)

Spring AI emits Micrometer observations for ChatModel and VectorStore
operations. The `micrometer-tracing-bridge-otel` dependency bridges these
observations directly into OpenTelemetry, so they appear as child spans in the
same trace context established by the Java Agent.

What it captures:

- **ChatModel call spans** — model name, provider, and call duration for every
  `chatModel.call()` invocation
- **VectorStore query spans** — similarity search operations against pgvector
- **Tool execution spans** — `@Tool` method invocations triggered by the LLM's
  tool-calling protocol

Configuration is in `application.yml`. The `management.otlp` section configures
the OTLP export endpoints, `management.tracing` sets the sampling rate, and
`spring.ai.chat.observations` controls whether prompt/completion content is
included in spans:

```yaml showLineNumbers title="src/main/resources/application.yml"
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  otlp:
    tracing:
      endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/traces
    metrics:
      export:
        url: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/metrics
  tracing:
    sampling:
      probability: 1.0
spring:
  ai:
    chat:
      observations:
        include-input: false
        include-output: false
```

Setting `include-input` and `include-output` to `false` prevents prompt and
completion content from being recorded in Micrometer observation spans. This is
a production safety default — prompt content may contain PII. If you need
content capture for debugging, the manual OTel layer (Layer 3) provides
PII-scrubbed content recording controlled by the
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable.

### Layer 3: Manual OTel API (GenAI Semantic Conventions)

Direct use of `GlobalOpenTelemetry.getTracer()` and
`GlobalOpenTelemetry.getMeter()` provides the GenAI-specific telemetry that
neither the Java Agent nor Spring AI observations capture. This layer adds
OpenTelemetry GenAI semantic convention attributes to LLM spans, defines custom
metrics for token usage and cost tracking, and creates pipeline orchestration
spans that give business context to traces.

What it captures:

- **`gen_ai.chat {model}` spans** with full GenAI semantic convention attributes
  (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`,
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `gen_ai.usage.cost_usd`, `gen_ai.response.finish_reasons`)
- **Custom GenAI metrics** — token usage histograms, cost counters, duration
  histograms, error counters, retry counters, fallback counters
- **Domain-specific pipeline spans** — `support_conversation`,
  `classify_intent`, `rag_retrieval`, `generate_response`, `escalation_check`

Why this layer is needed: Spring AI's Micrometer observations record that a
ChatModel call happened and how long it took, but they do not include GenAI
semantic conventions like token counts, cost, error classification, or the
specific model that responded (which may differ from the requested model after
fallback). The manual OTel API adds this layer.

The tracer and meter are initialized from `GlobalOpenTelemetry`, which the Java
Agent populates at startup:

```java showLineNumbers title="Tracer and Meter initialization pattern"
private static final Tracer tracer =
    GlobalOpenTelemetry.getTracer("ai-customer-support");
private static final Meter meter =
    GlobalOpenTelemetry.getMeter("ai-customer-support");
```

### How the Layers Compose

The three layers compose through OpenTelemetry's context propagation. The Java
Agent creates the outermost HTTP server span and propagates the trace context to
all child operations. When Spring AI's Micrometer-bridged observations start,
they pick up the current trace context and create child spans. When manual
`tracer.spanBuilder()` calls start, they also inherit the current context. The
result is a single trace where Layer 1 provides the HTTP and database frame,
Layer 2 adds AI framework observations, and Layer 3 adds GenAI semantic
convention attributes and custom metrics. No explicit context passing is needed
between layers — `Span.current()` and `span.makeCurrent()` handle the
composition automatically.

## Installation

Add the following dependencies to your `build.gradle`. The project uses Spring
Boot 4.0.3 with the Spring AI BOM for version management:

```groovy showLineNumbers title="build.gradle"
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.3'
    id 'io.spring.dependency-management' version '1.1.7'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

dependencyManagement {
    imports {
        mavenBom "org.springframework.ai:spring-ai-bom:2.0.0-M2"
    }
}

dependencies {
    // Web (reactive)
    implementation 'org.springframework.boot:spring-boot-starter-webflux'

    // Observability
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-tracing-bridge-otel'
    implementation 'io.opentelemetry:opentelemetry-exporter-otlp'
    implementation 'io.opentelemetry:opentelemetry-api'

    // Spring AI - LLM providers
    implementation 'org.springframework.ai:spring-ai-starter-model-openai'
    implementation 'org.springframework.ai:spring-ai-starter-model-anthropic'
    implementation 'org.springframework.ai:spring-ai-starter-model-ollama'

    // Spring AI - pgvector RAG
    implementation 'org.springframework.ai:spring-ai-starter-vector-store-pgvector'

    // Database (reactive + JDBC for pgvector)
    implementation 'org.springframework.boot:spring-boot-starter-data-r2dbc'
    implementation 'org.springframework.boot:spring-boot-starter-jdbc'
    implementation 'org.postgresql:r2dbc-postgresql'
    implementation 'org.postgresql:postgresql'

    // JSON
    implementation 'com.fasterxml.jackson.core:jackson-databind'
}
```

Key dependency groups:

- **Observability bridge**: `micrometer-tracing-bridge-otel` connects Spring
  AI's Micrometer observations to OpenTelemetry. `opentelemetry-exporter-otlp`
  sends telemetry to the Collector. `opentelemetry-api` provides the manual
  tracer/meter API for Layer 3.
- **Spring AI providers**: Each `spring-ai-starter-model-{provider}` dependency
  brings in the ChatModel implementation for that provider. You can include
  multiple providers for fallback support.
- **Spring AI BOM**: The `spring-ai-bom:2.0.0-M2` import manages version
  alignment across all Spring AI dependencies.
- **Dual database drivers**: R2DBC for reactive conversation persistence, JDBC
  for pgvector RAG and Spring AI tool methods (which use `JdbcTemplate`).

The OpenTelemetry Java Agent is not a Gradle dependency — it is downloaded
separately and attached via the `-javaagent` JVM flag. The Dockerfile handles
this automatically by downloading the agent JAR from the
[OpenTelemetry Java Agent releases](https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases)
page. For local development without Docker, download the JAR manually and pass
it as a JVM argument:

```bash showLineNumbers title="Local development agent setup"
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.25.0/opentelemetry-javaagent.jar

java -javaagent:opentelemetry-javaagent.jar \
  -jar build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar
```

## Spring AI OpenTelemetry Configuration

This section covers every configuration surface in the application: Spring Boot
OTLP export settings, provider-specific Spring AI configuration, application
properties for LLM routing, and the provider resolution logic that maps
configuration strings to Spring AI bean names.

### Spring Boot OpenTelemetry Configuration

The `management:` block in `application.yml` configures how Spring Boot exports
telemetry to the OpenTelemetry Collector. This was introduced in the
[Three-Layer Architecture](#layer-2-spring-ai-observations-micrometer-bridge)
section — here is the full breakdown of each setting:

```yaml showLineNumbers title="src/main/resources/application.yml"
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  otlp:
    tracing:
      endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/traces
    metrics:
      export:
        url: ${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4318}/v1/metrics
  tracing:
    sampling:
      probability: 1.0
```

- **`management.endpoints.web.exposure.include`** — Exposes Actuator endpoints
  for health checks, application info, and Micrometer metrics. These are useful
  for Kubernetes liveness/readiness probes and debugging metric registration.
- **`management.otlp.tracing.endpoint`** — The OTLP HTTP endpoint for trace
  export. Defaults to `http://localhost:4318/v1/traces` for local development.
  In Docker Compose, the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
  overrides this to point at the Collector container.
- **`management.otlp.metrics.export.url`** — The OTLP HTTP endpoint for metric
  export. Uses the same base URL as traces but with the `/v1/metrics` path.
- **`management.tracing.sampling.probability`** — Controls the sampling rate.
  `1.0` means 100% of traces are sampled — appropriate for development and
  low-traffic production. For high-traffic services, reduce this to `0.1` (10%)
  or use the Collector's tail-sampling processor for more intelligent sampling.

### Provider Configuration

Spring AI auto-configures a ChatModel bean for each provider that has a starter
dependency on the classpath. Each provider requires its own configuration block
under `spring.ai`. The application supports OpenAI, Anthropic, and Ollama — you
configure the one you want to use and set `app.llm.provider` to select it at
runtime.

<div class="mdx-code-block">
<Tabs>
<TabItem value="openai" label="OpenAI" default>

```yaml showLineNumbers title="src/main/resources/application.yml"
spring:
  ai:
    openai:
      api-key: ${OPENAI_API_KEY:}
      chat:
        options:
          model: ${LLM_MODEL_CAPABLE:gpt-4.1}
          temperature: ${DEFAULT_TEMPERATURE:0.3}
      embedding:
        options:
          model: ${EMBEDDING_MODEL:text-embedding-3-small}
```

OpenAI is the default provider. The `api-key` is read from the `OPENAI_API_KEY`
environment variable. The `chat.options.model` sets the default model for
ChatModel calls — this can be overridden per-request via
`ChatOptions.builder()`. The `embedding.options.model` configures the embedding
model used by the pgvector VectorStore for RAG retrieval.

</TabItem>
<TabItem value="anthropic" label="Anthropic">

```yaml showLineNumbers title="src/main/resources/application.yml"
spring:
  ai:
    anthropic:
      api-key: ${ANTHROPIC_API_KEY:}
      chat:
        options:
          model: ${LLM_MODEL_CAPABLE:claude-sonnet-4-6}
```

Anthropic is configured as either the primary or fallback provider. Note that
Anthropic does not provide an embedding model through Spring AI, so the
application uses OpenAI embeddings for RAG even when Anthropic is the primary
chat provider.

</TabItem>
<TabItem value="ollama" label="Ollama">

```yaml showLineNumbers title="src/main/resources/application-ollama.yml"
spring:
  autoconfigure:
    exclude:
      - org.springframework.ai.model.openai.autoconfigure.OpenAiChatAutoConfiguration
      - org.springframework.ai.model.openai.autoconfigure.OpenAiEmbeddingAutoConfiguration
      - org.springframework.ai.model.openai.autoconfigure.OpenAiImageAutoConfiguration
      - org.springframework.ai.model.openai.autoconfigure.OpenAiAudioSpeechAutoConfiguration
      - org.springframework.ai.model.openai.autoconfigure.OpenAiAudioTranscriptionAutoConfiguration
      - org.springframework.ai.model.openai.autoconfigure.OpenAiModerationAutoConfiguration
      - org.springframework.ai.model.anthropic.autoconfigure.AnthropicChatAutoConfiguration
  ai:
    ollama:
      embedding:
        options:
          model: embeddinggemma
    vectorstore:
      pgvector:
        dimensions: 768

app:
  llm:
    provider: ollama
    model-capable: qwen3:latest
    model-fast: gemma3:4b
    fallback-provider: ollama
    fallback-model: gemma3:12b
```

The Ollama profile (`application-ollama.yml`) disables OpenAI and Anthropic
auto-configuration since those providers are not needed when running locally. It
also switches the embedding model to `embeddinggemma` and reduces pgvector
dimensions to 768 to match the local embedding model's output size. Activate
this profile with `SPRING_PROFILES_ACTIVE=ollama`.

</TabItem>
</Tabs>
</div>

### Application Properties

The `AppConfig` record maps the `app.llm` configuration section to a type-safe
Java record using Spring Boot's `@ConfigurationProperties`:

```java showLineNumbers title="src/main/java/com/example/support/config/AppConfig.java"
@ConfigurationProperties(prefix = "app.llm")
public record AppConfig(
    String provider,
    String modelCapable,
    String modelFast,
    String fallbackProvider,
    String fallbackModel,
    int maxTokens,
    double temperature
) {}
```

These properties control LLM routing at the application level. The corresponding
YAML configuration provides defaults that environment variables can override:

```yaml showLineNumbers title="src/main/resources/application.yml"
app:
  llm:
    provider: ${LLM_PROVIDER:openai}
    model-capable: ${LLM_MODEL_CAPABLE:gpt-4.1}
    model-fast: ${LLM_MODEL_FAST:gpt-4.1-mini}
    fallback-provider: ${FALLBACK_PROVIDER:anthropic}
    fallback-model: ${FALLBACK_MODEL:claude-haiku-4-5-20251001}
    max-tokens: ${DEFAULT_MAX_TOKENS:1024}
    temperature: ${DEFAULT_TEMPERATURE:0.3}
```

- **`provider`** — The primary LLM provider (`openai`, `anthropic`, or
  `ollama`). Determines which ChatModel bean is used for all LLM calls.
- **`model-capable`** — The high-quality model used for response generation and
  complex tasks. Maps to `config.modelCapable()` in Java.
- **`model-fast`** — The faster, cheaper model used for intent classification
  and simple tasks. Maps to `config.modelFast()` in Java.
- **`fallback-provider`** / **`fallback-model`** — The provider and model to use
  when the primary provider fails after all retries are exhausted.
- **`max-tokens`** / **`temperature`** — Default generation parameters applied
  to every LLM call via `ChatOptions`.

### Provider Resolution

The `LlmConfig` class resolves the provider string from configuration to the
correct Spring AI `ChatModel` bean. Spring AI auto-configures a ChatModel bean
for each provider on the classpath — `LlmConfig.resolveChatModel()` maps the
provider name to the Spring-managed bean name:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmConfig.java"
@Configuration
public class LlmConfig {

    public static final Map<String, String> PROVIDER_SERVERS = Map.of(
        "openai", "api.openai.com",
        "anthropic", "api.anthropic.com",
        "google", "generativelanguage.googleapis.com",
        "ollama", "localhost"
    );

    public static final Map<String, Integer> PROVIDER_PORTS = Map.of(
        "openai", 443,
        "anthropic", 443,
        "google", 443,
        "ollama", 11434
    );

    public static ChatModel resolveChatModel(
        String provider, Map<String, ChatModel> chatModels
    ) {
        String beanName = switch (provider) {
            case "openai" -> "openAiChatModel";
            case "anthropic" -> "anthropicChatModel";
            case "ollama" -> "ollamaChatModel";
            default -> throw new IllegalArgumentException(
                "Unknown LLM provider: " + provider);
        };
        var model = chatModels.get(beanName);
        if (model == null) {
            throw new IllegalStateException(
                "ChatModel bean '" + beanName + "' not found. "
                + "Available: " + chatModels.keySet());
        }
        return model;
    }
}
```

The `PROVIDER_SERVERS` and `PROVIDER_PORTS` maps provide OpenTelemetry
`server.address` and `server.port` span attributes for each provider. These are
standard OTel attributes that help correlate LLM spans with network-level
telemetry. The `resolveChatModel()` method uses a switch expression to map the
provider string (`"openai"`, `"anthropic"`, `"ollama"`) to the Spring AI bean
name (`"openAiChatModel"`, `"anthropicChatModel"`, `"ollamaChatModel"`). If the
provider string does not match any known provider, it throws an
`IllegalArgumentException`. If the bean exists but was not auto-configured (for
example, missing API key), it throws an `IllegalStateException` listing the
available beans for debugging.

### Environment Variables

The application uses environment variables for all sensitive and
deployment-specific configuration. Here is the complete set:

```bash showLineNumbers title=".env.example"
APP_PORT=8080
DB_HOST=localhost
DB_PORT=5432
DB_NAME=support
DB_USER=postgres
DB_PASSWORD=postgres

LLM_PROVIDER=openai
LLM_MODEL_CAPABLE=gpt-4.1
LLM_MODEL_FAST=gpt-4.1-mini
FALLBACK_PROVIDER=anthropic
FALLBACK_MODEL=claude-haiku-4-5-20251001
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_TEMPERATURE=0.3
DEFAULT_MAX_TOKENS=1024

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

OTEL_SERVICE_NAME=ai-customer-support
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

The `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` variables are used by
both the Java Agent (Layer 1) and Spring Boot Actuator (Layer 2). The Java Agent
reads them directly; Spring Boot references them via `${...}` placeholders in
`application.yml`. This means a single environment variable controls both
layers.

## Custom LLM Instrumentation

This section covers the core GenAI span creation in `LlmService` — the Layer 3
manual instrumentation that adds OpenTelemetry GenAI semantic convention
attributes, error classification, and content capture to every LLM call.

### The GenAI Span

The `generateOnce()` method creates a `gen_ai.chat {model}` span for each LLM
call. This span follows the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
and carries all the attributes needed to understand model usage, performance,
and cost.

Here is the full method with annotations for each section:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private LlmResponse generateOnce(
    ChatModel chatModel, String providerName, String model,
    String systemPrompt, String userPrompt, String stage,
    List<ToolCallback> toolCallbacks
) {
    String spanName = "gen_ai.chat " + model;
    long start = System.nanoTime();

    Span span = tracer.spanBuilder(spanName)
        .setAttribute("gen_ai.operation.name", "chat")
        .setAttribute("gen_ai.provider.name", providerName)
        .setAttribute("gen_ai.request.model", model)
        .setAttribute("server.address",
            LlmConfig.PROVIDER_SERVERS.getOrDefault(providerName, "unknown"))
        .setAttribute("server.port",
            (long) LlmConfig.PROVIDER_PORTS.getOrDefault(providerName, 443))
        .setAttribute("gen_ai.request.temperature", config.temperature())
        .setAttribute("gen_ai.request.max_tokens", (long) config.maxTokens())
        .startSpan();

    if (stage != null && !stage.isEmpty()) {
        span.setAttribute("support.stage", stage);
    }

    try (Scope ignored = span.makeCurrent()) {
        // ... content capture, prompt building, ChatModel call ...

        var generation = response.getResult();
        var metadata = generation.getMetadata();
        var usage = response.getMetadata().getUsage();

        String content = generation.getOutput().getText();
        int inputTokens = usage != null ? (int) usage.getPromptTokens() : 0;
        int outputTokens = usage != null
            ? (int) usage.getCompletionTokens() : 0;
        String responseModel = response.getMetadata().getModel() != null
            ? response.getMetadata().getModel() : model;
        String finishReason = metadata.getFinishReason() != null
            ? metadata.getFinishReason() : "";
        double costUsd = pricing.calculateCost(
            responseModel, inputTokens, outputTokens);
        double duration = (System.nanoTime() - start) / 1_000_000_000.0;

        span.setAttribute("gen_ai.response.model", responseModel);
        span.setAttribute("gen_ai.usage.input_tokens", (long) inputTokens);
        span.setAttribute("gen_ai.usage.output_tokens", (long) outputTokens);
        span.setAttribute("gen_ai.usage.cost_usd", costUsd);
        if (!finishReason.isEmpty()) {
            span.setAttribute("gen_ai.response.finish_reasons", finishReason);
        }

        // ... metric recording, return ...
    } catch (Exception e) {
        // ... error handling ...
    } finally {
        span.end();
    }
}
```

The span is structured in three phases:

**Request attributes** (set before `startSpan()`): These describe what the
application asked for — the operation type, provider, model, server address,
temperature, and max tokens. Setting them on the builder ensures they are
available from the start of the span, which matters for streaming scenarios
where the span may be visible before the response arrives.

**Response attributes** (set after `chatModel.call()`): These describe what the
LLM returned — the actual model that responded (which may differ from the
requested model after provider routing), token counts, cost, and finish reason.
The `gen_ai.response.model` attribute is particularly important for fallback
scenarios where the response model differs from `gen_ai.request.model`.

**Custom attributes**: The `support.stage` attribute is a domain-specific
addition that links the LLM span to the pipeline stage that triggered it
(`classify_intent`, `generate_response`, etc.). This is not part of the GenAI
semantic conventions but is valuable for filtering and grouping spans by
business context.

### Error Handling on Spans

When an LLM call fails, the span records both the OpenTelemetry error status and
a classified error type. The `catch` block in `generateOnce()` sets the span
status to `ERROR` and adds an `error.type` attribute with a categorized error
string:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
} catch (Exception e) {
    span.setStatus(StatusCode.ERROR, e.getMessage());
    span.setAttribute("error.type", classifyError(e));
    errorCounter.add(1, Attributes.of(
        AttributeKey.stringKey("gen_ai.provider.name"), providerName,
        AttributeKey.stringKey("gen_ai.request.model"), model,
        AttributeKey.stringKey("error.type"), classifyError(e)
    ));
    throw e;
} finally {
    span.end();
}
```

The `classifyError()` method maps exception messages to standardized error
categories. This avoids high-cardinality error strings in your telemetry backend
and enables meaningful alerting on error type:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
static String classifyError(Exception e) {
    if (e == null) return "unknown_error";
    String msg = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
    if (msg.contains("rate limit") || msg.contains("429"))
        return "rate_limit";
    if (msg.contains("timeout") || msg.contains("timed out")
        || msg.contains("deadline"))
        return "timeout";
    if (msg.contains("401") || msg.contains("403")
        || msg.contains("auth") || msg.contains("api key"))
        return "auth_error";
    if (msg.contains("400") || msg.contains("422")
        || msg.contains("invalid"))
        return "invalid_request";
    if (msg.contains("500") || msg.contains("502")
        || msg.contains("503") || msg.contains("server"))
        return "server_error";
    if (msg.contains("connect") || msg.contains("dns")
        || msg.contains("network") || msg.contains("reset"))
        return "network_error";
    return "unknown_error";
}
```

The classification produces one of seven values: `rate_limit`, `timeout`,
`auth_error`, `invalid_request`, `server_error`, `network_error`, or
`unknown_error`. These categories are intentionally coarse — they produce
low-cardinality metric labels that work well with alerting rules. For example,
you can alert on `error.type = rate_limit` to detect when your API key is
hitting quota limits, or on `error.type = auth_error` to detect expired or
revoked credentials.

### Span Events (Content Capture)

The `generateOnce()` method optionally records prompt and completion content as
span events. Content capture is gated behind the
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable and is
disabled by default:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
this.captureContent = "true".equalsIgnoreCase(
    System.getenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"));
```

When enabled, three span events are recorded on each LLM call:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
try (Scope ignored = span.makeCurrent()) {
    if (captureContent) {
        span.addEvent("gen_ai.user.message", Attributes.of(
            AttributeKey.stringKey("gen_ai.prompt"),
            truncate(piiFilter.scrub(userPrompt), 1000)
        ));
        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            span.addEvent("gen_ai.user.message", Attributes.of(
                AttributeKey.stringKey("gen_ai.system_instructions"),
                truncate(systemPrompt, 500)
            ));
        }
    }

    var prompt = buildPrompt(systemPrompt, userPrompt, model, toolCallbacks);
    ChatResponse response = chatModel.call(prompt);

    // ... response processing ...

    if (captureContent) {
        span.addEvent("gen_ai.assistant.message", Attributes.of(
            AttributeKey.stringKey("gen_ai.completion"),
            truncate(piiFilter.scrub(content), 2000)
        ));
    }

    // ...
}
```

Each span event captures a different part of the conversation:

| Event Name                 | Attribute                    | Content       | Max Length |
| -------------------------- | ---------------------------- | ------------- | ---------- |
| `gen_ai.user.message`      | `gen_ai.prompt`              | User input    | 1000 chars |
| `gen_ai.user.message`      | `gen_ai.system_instructions` | System prompt | 500 chars  |
| `gen_ai.assistant.message` | `gen_ai.completion`          | LLM response  | 2000 chars |

Two safety measures protect sensitive data in span events:

1. **PII filtering** — User input and LLM responses pass through
   `piiFilter.scrub()` before recording. This replaces patterns like email
   addresses, phone numbers, and credit card numbers with redaction markers. The
   system prompt is not PII-filtered because it is developer-authored content
   that should not contain user data.
2. **Truncation** — All content is truncated to prevent span events from
   becoming excessively large. User prompts are capped at 1000 characters,
   system prompts at 500, and completions at 2000. These limits balance
   debuggability with storage costs.

Content capture is off by default for good reason: prompt content may contain
PII, proprietary data, or information subject to compliance requirements (GDPR,
HIPAA, SOC 2). Enable it only in environments where content inspection is
appropriate — development, staging, or production with explicit data handling
agreements. Set the environment variable in your deployment:

```bash showLineNumbers
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

### GenAI Semantic Conventions Reference

The following table summarizes all GenAI attributes set on `gen_ai.chat` spans.
These follow the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/):

| Attribute                        | Example Value       | Source                              |
| -------------------------------- | ------------------- | ----------------------------------- |
| `gen_ai.operation.name`          | `"chat"`            | Hardcoded                           |
| `gen_ai.provider.name`           | `"openai"`          | `config.provider()`                 |
| `gen_ai.request.model`           | `"gpt-4.1"`         | Method parameter                    |
| `gen_ai.request.temperature`     | `0.3`               | `config.temperature()`              |
| `gen_ai.request.max_tokens`      | `1024`              | `config.maxTokens()`                |
| `gen_ai.response.model`          | `"gpt-4.1"`         | `response.getMetadata().getModel()` |
| `gen_ai.usage.input_tokens`      | `150`               | `usage.getPromptTokens()`           |
| `gen_ai.usage.output_tokens`     | `380`               | `usage.getCompletionTokens()`       |
| `gen_ai.usage.cost_usd`          | `0.00234`           | `pricing.calculateCost()`           |
| `gen_ai.response.finish_reasons` | `"stop"`            | `metadata.getFinishReason()`        |
| `server.address`                 | `"api.openai.com"`  | `LlmConfig.PROVIDER_SERVERS`        |
| `server.port`                    | `443`               | `LlmConfig.PROVIDER_PORTS`          |
| `support.stage`                  | `"classify_intent"` | Method parameter (custom)           |
| `error.type`                     | `"rate_limit"`      | `classifyError()` (on error only)   |

## Token and Cost Tracking

Token usage and cost are central to LLM observability. Unlike traditional API
calls where cost is roughly proportional to request count, LLM costs scale with
token consumption — a single request can cost 100x more than another depending
on prompt length and response size. This section covers how the application
defines GenAI metrics, calculates cost from a pricing table, and records both
metrics and span attributes for every LLM call.

### GenAI Metrics Definition

Six metrics are defined in the `LlmService` constructor using the OpenTelemetry
`Meter` API. These metrics follow the naming patterns from the OpenTelemetry
GenAI semantic conventions:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
this.tracer = GlobalOpenTelemetry.getTracer("ai-customer-support");
Meter meter = GlobalOpenTelemetry.getMeter("ai-customer-support");

this.tokenUsage = meter.histogramBuilder("gen_ai.client.token.usage")
    .setUnit("{token}").build();
this.operationDuration = meter.histogramBuilder("gen_ai.client.operation.duration")
    .setUnit("s").build();
this.costCounter = meter.counterBuilder("gen_ai.client.cost")
    .ofDoubles().setUnit("usd").build();
this.retryCounter = meter.counterBuilder("gen_ai.client.retry.count")
    .build();
this.fallbackCounter = meter.counterBuilder("gen_ai.client.fallback.count")
    .build();
this.errorCounter = meter.counterBuilder("gen_ai.client.error.count")
    .build();
```

Each metric serves a specific observability purpose:

- **`gen_ai.client.token.usage`** — Histogram of token counts per LLM call.
  Recorded twice per successful call: once with `gen_ai.token.type = "input"`
  and once with `gen_ai.token.type = "output"`. Histograms capture the
  distribution, so you can compute p50, p95, and p99 token usage for capacity
  planning and anomaly detection.
- **`gen_ai.client.operation.duration`** — Histogram of LLM call duration in
  seconds. Captures end-to-end latency including network round-trip, model
  inference, and any tool-calling loops. Use this to track model performance
  degradation over time.
- **`gen_ai.client.cost`** — Monotonic counter of estimated cost in USD.
  Incremented on every successful call. Use this for real-time cost dashboards
  and budget alerting.
- **`gen_ai.client.retry.count`** — Counter of retry attempts. Incremented when
  an LLM call fails and is retried (not on the first attempt). A rising retry
  rate signals provider instability.
- **`gen_ai.client.fallback.count`** — Counter of fallback activations.
  Incremented when the primary provider fails all retries and the application
  switches to the fallback provider.
- **`gen_ai.client.error.count`** — Counter of LLM call errors. Carries
  `error.type` as a label for classification (`rate_limit`, `timeout`,
  `auth_error`, etc.).

All metrics carry a common set of labels (attributes) for grouping and
filtering:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private static Attributes providerModelAttrs(String provider, String model) {
    return Attributes.of(
        AttributeKey.stringKey("gen_ai.operation.name"), "chat",
        AttributeKey.stringKey("gen_ai.provider.name"), provider,
        AttributeKey.stringKey("gen_ai.request.model"), model
    );
}

private static Attributes withTokenType(Attributes base, String tokenType) {
    return base.toBuilder()
        .put(AttributeKey.stringKey("gen_ai.token.type"), tokenType)
        .build();
}
```

### Metrics Reference

| Metric Name                        | Type          | Unit      | Labels                                                                                       | Recorded In           |
| ---------------------------------- | ------------- | --------- | -------------------------------------------------------------------------------------------- | --------------------- |
| `gen_ai.client.token.usage`        | Histogram     | `{token}` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.token.type` | `generateOnce()`      |
| `gen_ai.client.operation.duration` | Histogram     | `s`       | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`                      | `generateOnce()`      |
| `gen_ai.client.cost`               | DoubleCounter | `usd`     | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`                      | `generateOnce()`      |
| `gen_ai.client.retry.count`        | LongCounter   | —         | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`                      | `generateWithRetry()` |
| `gen_ai.client.fallback.count`     | LongCounter   | —         | —                                                                                            | `generate()`          |
| `gen_ai.client.error.count`        | LongCounter   | —         | `gen_ai.provider.name`, `gen_ai.request.model`, `error.type`                                 | `generateOnce()`      |

### Cost Calculation

The `Pricing` class loads model pricing data at application startup and
calculates per-call costs based on input and output token counts. This decouples
cost calculation from the LLM call path — pricing data can be updated without
redeploying the application.

```java showLineNumbers title="src/main/java/com/example/support/llm/Pricing.java"
@Component
public class Pricing {

    private static final Logger log = LoggerFactory.getLogger(Pricing.class);
    private static final double FALLBACK_INPUT = 3.0;
    private static final double FALLBACK_OUTPUT = 15.0;
    private static final double PER_MILLION = 1_000_000.0;

    private Map<String, ModelPricing> models = Map.of();

    @JsonIgnoreProperties(ignoreUnknown = true)
    record PricingFile(String version, Map<String, ModelPricing> models) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ModelPricing(
        String provider, double input, double output
    ) {}

    @PostConstruct
    void loadPricing() {
        var objectMapper = new ObjectMapper();
        String pricingFile = System.getenv("PRICING_FILE");
        try {
            InputStream stream;
            if (pricingFile != null
                && Files.exists(Path.of(pricingFile))) {
                stream = Files.newInputStream(Path.of(pricingFile));
                log.info("Loaded pricing from {}", pricingFile);
            } else {
                stream = getClass().getClassLoader()
                    .getResourceAsStream("pricing.json");
                if (stream == null) {
                    log.warn("No pricing.json found, "
                        + "using fallback pricing");
                    return;
                }
                log.info("Loaded pricing from classpath");
            }
            var file = objectMapper.readValue(stream, PricingFile.class);
            this.models = file.models();
            log.info("Loaded pricing v{} with {} models",
                file.version(), models.size());
        } catch (IOException e) {
            log.warn("Failed to load pricing.json: {}",
                e.getMessage());
        }
    }

    public double calculateCost(
        String model, int inputTokens, int outputTokens
    ) {
        var pricing = models.get(model);
        double inputRate =
            pricing != null ? pricing.input() : FALLBACK_INPUT;
        double outputRate =
            pricing != null ? pricing.output() : FALLBACK_OUTPUT;
        return (inputTokens * inputRate
            + outputTokens * outputRate) / PER_MILLION;
    }

    public boolean hasModel(String model) {
        return models.containsKey(model);
    }
}
```

Key design decisions in the pricing implementation:

- **`@PostConstruct` loading** — Pricing data is loaded once at startup, not on
  every LLM call. This avoids file I/O in the hot path.
- **External file override** — The `PRICING_FILE` environment variable allows
  deploying updated pricing without rebuilding the application. If not set, the
  classpath `pricing.json` is used.
- **Fallback rates** — If a model is not found in the pricing table, fallback
  rates of $3.00/M input and $15.00/M output are used. These are intentionally
  high to make unknown models visible in cost dashboards.
- **Per-million pricing** — Rates are stored as dollars per million tokens (the
  standard unit used by LLM providers), and the `calculateCost()` method divides
  by 1,000,000 to produce the actual cost per call.

### How Metrics Are Recorded

Metrics are recorded at three points in the call chain, each capturing a
different aspect of LLM operations.

**Successful calls in `generateOnce()`** — Token usage, duration, and cost are
recorded after a successful ChatModel call:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
var attrs = providerModelAttrs(providerName, responseModel);
tokenUsage.record(inputTokens, withTokenType(attrs, "input"));
tokenUsage.record(outputTokens, withTokenType(attrs, "output"));
operationDuration.record(duration, attrs);
costCounter.add(costUsd, attrs);

return new LlmResponse(content, responseModel, providerName,
    inputTokens, outputTokens, costUsd, finishReason);
```

The token histogram is recorded twice — once for input tokens and once for
output tokens — with the `gen_ai.token.type` label distinguishing them. This
allows separate analysis of prompt size versus completion size.

**Retries in `generateWithRetry()`** — The retry counter is incremented on each
retry attempt (not on the first attempt):

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
        return generateOnce(chatModel, providerName, model,
            systemPrompt, userPrompt, stage, toolCallbacks);
    } catch (Exception e) {
        // ...
        if (attempt > 0) {
            retryCounter.add(1,
                providerModelAttrs(providerName, model));
        }
        // ...
    }
}
```

**Fallbacks in `generate()`** — The fallback counter is incremented when the
primary provider exhausts all retries and the application switches to the
fallback:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
log.warn("Primary provider {} failed, falling back to {}",
    config.provider(), config.fallbackProvider());
fallbackCounter.add(1);
```

**Errors in `generateOnce()`** — The error counter is incremented in the catch
block with the classified error type as a label:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
} catch (Exception e) {
    span.setStatus(StatusCode.ERROR, e.getMessage());
    span.setAttribute("error.type", classifyError(e));
    errorCounter.add(1, Attributes.of(
        AttributeKey.stringKey("gen_ai.provider.name"), providerName,
        AttributeKey.stringKey("gen_ai.request.model"), model,
        AttributeKey.stringKey("error.type"), classifyError(e)
    ));
    throw e;
}
```

Cost is recorded in two places — as a span attribute (`gen_ai.usage.cost_usd`)
for per-request visibility in traces, and as a metric counter
(`gen_ai.client.cost`) for aggregated dashboards and alerting. The span
attribute lets you see the cost of a single request when investigating a trace.
The metric counter lets you build a real-time cost dashboard that sums cost
across all requests, grouped by provider and model.

## Pipeline Observability

The support pipeline orchestrates six stages — classify intent, retrieve RAG
context, generate response, scrub PII, check escalation, and persist results.
Each stage runs as a child span under a single parent `support_conversation`
span, producing a trace that shows the full request lifecycle with timing and
attributes at every step.

The `SupportPipeline` class is the orchestrator. Its `process()` method handles
the reactive layer (load or create conversation, add user message, fetch
history), then delegates to `runPipeline()` on a bounded elastic scheduler for
the blocking pipeline work. Here is `runPipeline()` — the parent span and the
six-stage flow:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/SupportPipeline.java"
private PipelineResult runPipeline(
    String userMessage, UUID conversationId, List<Message> history
) {
    long startNanos = System.nanoTime();
    Span span = tracer.spanBuilder("support_conversation")
        .setAttribute("support.conversation_id", conversationId.toString())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        // 1. Classify intent (fast model)
        IntentResult intent = intentClassifier.classify(userMessage);
        span.setAttribute("support.intent", intent.intent().name());
        span.setAttribute("support.confidence", intent.confidence());

        // 2. Retrieve RAG context
        var ragDocs = contextRetriever.retrieve(userMessage);
        span.setAttribute("support.rag_matches", ragDocs.size());

        // 3. Generate response (capable model)
        String conversationHistory =
            conversationService.formatHistory(history);
        LlmResponse response = responseGenerator.generate(
            userMessage, intent, ragDocs, conversationHistory);

        // 4. PII scrub
        String content = piiFilter.scrub(response.content());

        // 5. Check escalation
        int turns = history.size() / 2 + 1;
        EscalationDecision escalation =
            escalationRouter.evaluate(intent, turns, 0);
        span.setAttribute(
            "support.should_escalate", escalation.shouldEscalate());

        // 6. Record domain metrics
        if (!ragDocs.isEmpty()) {
            Double topScore = ragDocs.getFirst().getScore();
            if (topScore != null) {
                metrics.recordRagSimilarity(
                    topScore, intent.intent().name());
            }
        }
        metrics.recordConversationTurns(
            turns, intent.intent().name(), false);
        if (escalation.shouldEscalate()) {
            metrics.recordEscalation(
                escalation.reason(), escalation.priority().name());
        }
        double durationSec =
            (System.nanoTime() - startNanos) / 1_000_000_000.0;
        metrics.recordConversationDuration(
            durationSec, intent.intent().name(),
            escalation.shouldEscalate());

        // Record totals
        int totalTokens = intent.inputTokens() + intent.outputTokens()
            + response.inputTokens() + response.outputTokens();
        span.setAttribute("support.total_turns", (long) turns);
        span.setAttribute("support.total_tokens", (long) totalTokens);
        span.setAttribute("support.total_cost_usd", response.costUsd());

        return new PipelineResult(
            content, intent, escalation,
            response.model(), response.provider(),
            response.inputTokens(), response.outputTokens(),
            response.costUsd(), conversationId);

    } catch (Exception e) {
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw new RuntimeException(
            "Pipeline failed: " + e.getMessage(), e);

    } finally {
        span.end();
    }
}
```

The span lifecycle follows the standard OpenTelemetry pattern: create with
`spanBuilder()`, set initial attributes, make it current with `makeCurrent()`
inside a try-with-resources so child spans automatically parent to it, set
additional attributes as the pipeline progresses, call `setStatus(ERROR)` in the
catch block, and call `end()` in the finally block. The `makeCurrent()` call is
the key — it puts this span on the thread-local context so that every child span
created by `intentClassifier.classify()`, `contextRetriever.retrieve()`, and the
other stages automatically becomes a child of `support_conversation`.

The parent span accumulates summary attributes as each stage completes:
`support.intent` and `support.confidence` after classification,
`support.rag_matches` after retrieval, `support.should_escalate` after the
escalation check, and `support.total_turns`, `support.total_tokens`, and
`support.total_cost_usd` at the end. This means you can filter traces by intent,
escalation status, or token count without expanding the span tree.

Each pipeline stage creates its own child span with a `support.stage` attribute.
Here are the four stage spans.

**IntentClassifier** — The `classify_intent` span wraps a fast-model LLM call
that returns structured JSON with the detected intent, confidence score,
sub-category, and extracted entities:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/IntentClassifier.java"
public IntentResult classify(String userMessage) {
    Span span = tracer.spanBuilder("classify_intent")
        .setAttribute("support.stage", "classify")
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        LlmResponse response = llmService.generateFast(
            SYSTEM_PROMPT, userMessage, "classify");
        IntentResult result = parseResponse(response);

        span.setAttribute("support.intent", result.intent().name());
        span.setAttribute("support.confidence", result.confidence());
        span.setAttribute(
            "support.sub_category", result.subCategory());
        if (!result.entities().isEmpty()) {
            span.setAttribute(
                "support.entities",
                String.join(",", result.entities()));
        }

        return result;

    } catch (Exception e) {
        span.setStatus(StatusCode.ERROR, e.getMessage());
        return IntentResult.fallback();

    } finally {
        span.end();
    }
}
```

The `parseResponse()` method parses the LLM's JSON output, strips any markdown
code fences, and extracts the intent, confidence, sub-category, and entities
fields. If JSON parsing fails (malformed response, unexpected format), it falls
back to `Intent.QUERY` with a confidence of 0.3 and a sub-category of
`"parse_error"` — the pipeline continues with a degraded classification rather
than failing entirely.

**ContextRetriever** — The `rag_retrieval` span wraps the vector similarity
search:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ContextRetriever.java"
public List<Document> retrieve(String userMessage) {
    Span span = tracer.spanBuilder("rag_retrieval")
        .setAttribute("support.stage", "retrieve")
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        List<Document> results = vectorStore.similaritySearch(
            SearchRequest.builder()
                .query(userMessage)
                .topK(TOP_K)
                .build()
        );

        span.setAttribute("support.matches_found", results.size());
        if (!results.isEmpty()) {
            Double topScore = results.getFirst().getScore();
            if (topScore != null) {
                span.setAttribute(
                    "support.top_similarity", topScore);
            }
        }

        return results;

    } catch (Exception e) {
        span.setStatus(
            io.opentelemetry.api.trace.StatusCode.ERROR,
            e.getMessage());
        return List.of();

    } finally {
        span.end();
    }
}
```

Like the classifier, the retriever returns an empty list on failure rather than
propagating the exception — the pipeline generates a response without RAG
context rather than failing the entire request.

**ResponseGenerator** — The `generate_response` span wraps the capable-model LLM
call that produces the final customer-facing response:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ResponseGenerator.java"
public LlmResponse generate(
    String userMessage, IntentResult intent,
    List<Document> ragContext, String conversationHistory
) {
    Span span = tracer.spanBuilder("generate_response")
        .setAttribute("support.stage", "generate")
        .setAttribute("support.rag_matches_used", ragContext.size())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        String ragSection =
            contextRetriever.formatContext(ragContext);
        String historySection =
            conversationHistory != null
                && !conversationHistory.isEmpty()
                ? "Previous conversation:\n"
                    + conversationHistory + "\n"
                : "";

        String systemPrompt = SYSTEM_PROMPT_TEMPLATE.formatted(
            intent.intent().name(),
            intent.confidence() * 100,
            ragSection,
            historySection
        );

        LlmResponse response = llmService.generateCapable(
            systemPrompt, userMessage, "generate",
            toolCallbacks);

        span.setAttribute("gen_ai.usage.input_tokens",
            (long) response.inputTokens());
        span.setAttribute("gen_ai.usage.output_tokens",
            (long) response.outputTokens());
        span.setAttribute("gen_ai.usage.cost_usd",
            response.costUsd());

        return response;

    } catch (Exception e) {
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw e;

    } finally {
        span.end();
    }
}
```

The response generator does not catch-and-continue like the classifier and
retriever — a failed response generation is a hard failure that propagates up to
the parent span. The `rag_matches_used` attribute is set at span creation time
so it appears even if the LLM call fails, which helps diagnose whether failures
correlate with RAG context size.

**EscalationRouter** — The `escalation_check` span wraps the rule-based
escalation evaluation:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/EscalationRouter.java"
public EscalationDecision evaluate(
    IntentResult intent, int conversationTurns, int toolErrors
) {
    Span span = tracer.spanBuilder("escalation_check")
        .setAttribute("support.stage", "route")
        .setAttribute("support.conversation_turns",
            (long) conversationTurns)
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        EscalationDecision decision =
            checkTriggers(intent, conversationTurns, toolErrors);

        span.setAttribute("support.should_escalate",
            decision.shouldEscalate());
        if (decision.shouldEscalate()) {
            span.setAttribute("support.escalation_reason",
                decision.reason());
            span.setAttribute("support.escalation_priority",
                decision.priority().name());
        }

        return decision;

    } finally {
        span.end();
    }
}
```

The `checkTriggers()` method evaluates five rules in priority order:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/EscalationRouter.java"
EscalationDecision checkTriggers(
    IntentResult intent, int conversationTurns, int toolErrors
) {
    // Explicit ESCALATE intent — immediate
    if (intent.intent() == Intent.ESCALATE) {
        return EscalationDecision.escalate(
            "explicit_request", EscalationPriority.HIGH,
            "Customer explicitly requested human agent");
    }

    // Complaint + low confidence (< 0.6) — auto-escalate
    if (intent.intent() == Intent.COMPLAINT
        && intent.confidence() < 0.6) {
        return EscalationDecision.escalate(
            "low_confidence_complaint", EscalationPriority.HIGH,
            "Complaint with low classification confidence");
    }

    // 2+ tool errors — escalate with context
    if (toolErrors >= 2) {
        return EscalationDecision.escalate(
            "tool_errors", EscalationPriority.MEDIUM,
            "Multiple tool call failures (" + toolErrors + ")");
    }

    // Low intent confidence (< 0.5) — offer human agent
    if (intent.confidence() < 0.5) {
        return EscalationDecision.escalate(
            "low_confidence", EscalationPriority.LOW,
            "Low intent classification confidence");
    }

    // > 5 turns without resolution — suggest escalation
    if (conversationTurns > 5) {
        return EscalationDecision.escalate(
            "long_conversation", EscalationPriority.LOW,
            "Conversation exceeds 5 turns without resolution");
    }

    return EscalationDecision.noEscalation();
}
```

The rules are ordered by urgency. An explicit escalation request or a
low-confidence complaint triggers HIGH priority — these go to the front of the
human agent queue. Tool errors indicate the AI cannot fulfil the request and get
MEDIUM priority. Low confidence and long conversations get LOW priority as soft
suggestions. The span records `support.escalation_reason` and
`support.escalation_priority` only when escalation triggers, keeping clean
traces for normal conversations.

### Tool Calling

Spring AI provides the `@Tool` and `@ToolParam` annotations for declarative tool
definitions. The LLM decides when to call a tool based on the tool's
description, and Spring AI handles the function-calling protocol with the
provider. Each tool method receives typed parameters, executes business logic
(typically a database query), and returns a result that Spring AI serializes
back to the LLM.

Here is an example tool method from `OrderTools` — the `getOrderStatus` tool
that looks up an order by ID:

```java showLineNumbers title="src/main/java/com/example/support/tools/OrderTools.java"
@Tool(description = "Look up order status and tracking info "
    + "by order ID (e.g. ORD-12345)")
public Map<String, Object> getOrderStatus(
    @ToolParam(description = "Order ID, e.g. ORD-12345")
    String orderId
) {
    log.info("Tool call: getOrderStatus({})", orderId);
    metrics.recordToolCall("getOrderStatus", true);
    var rows = jdbc.queryForList(
        """
        SELECT o.order_id, o.status, o.tracking_number,
               o.estimated_delivery, o.total_amount,
               o.created_at, c.name as customer_name
        FROM orders o
            JOIN customers c ON o.customer_id = c.id
        WHERE o.order_id = ?
        """, orderId);

    if (rows.isEmpty()) {
        return Map.of("error", "Order not found: " + orderId);
    }
    return rows.getFirst();
}
```

Every `@Tool` method calls `metrics.recordToolCall()` with the tool name and
success status, feeding the `support.tool_calls` counter metric. The JDBC query
runs under the OpenTelemetry Java Agent's auto-instrumentation, so the database
call appears as a child span of the `gen_ai.chat` span without any manual
instrumentation.

Tool callbacks are assembled in the `ResponseGenerator` constructor using Spring
AI's `MethodToolCallbackProvider`:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ResponseGenerator.java"
this.toolCallbacks = List.of(
    MethodToolCallbackProvider.builder()
        .toolObjects(orderTools, productTools)
        .build()
        .getToolCallbacks()
);
```

This scans the `orderTools` and `productTools` beans for `@Tool`-annotated
methods and builds `ToolCallback` instances for each one. The callbacks are then
passed to `LlmService.generateCapable()`, which constructs
`ToolCallingChatOptions` when tools are present:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
if (toolCallbacks != null && !toolCallbacks.isEmpty()) {
    var options = ToolCallingChatOptions.builder()
        .model(model)
        .temperature(config.temperature())
        .maxTokens(config.maxTokens())
        .toolCallbacks(toolCallbacks)
        .build();
    return new Prompt(messages, options);
}
```

The `ToolCallingChatOptions` extends the standard `ChatOptions` with tool
callback support. Spring AI handles the multi-turn tool-calling loop internally
— the LLM requests a tool call, Spring AI executes the matching `@Tool` method,
sends the result back to the LLM, and the LLM produces its final response. All
of this happens within the single `chatModel.call(prompt)` invocation.

The application exposes six tools across two classes:

| Tool              | Class        | Description                                   |
| ----------------- | ------------ | --------------------------------------------- |
| `getOrderStatus`  | OrderTools   | Look up order status and tracking by order ID |
| `getOrderHistory` | OrderTools   | Get recent orders by customer email           |
| `initiateReturn`  | OrderTools   | Initiate a return for a delivered order       |
| `getReturnStatus` | OrderTools   | Check return status by return ID              |
| `searchProducts`  | ProductTools | Search product catalog by name or category    |
| `getProductInfo`  | ProductTools | Get product details by SKU                    |

### RAG Retrieval

The RAG pipeline uses pgvector for vector storage with Spring AI's
`PgVectorStore` abstraction. The vector store is configured in
`VectorStoreConfig` with an HNSW index for fast approximate nearest-neighbor
search:

```java showLineNumbers title="src/main/java/com/example/support/config/VectorStoreConfig.java"
@Bean
PgVectorStore vectorStore(
    EmbeddingModel embeddingModel, DataSource dataSource,
    @Value("${spring.ai.vectorstore.pgvector.dimensions:1536}")
    int dimensions
) {
    return PgVectorStore.builder(
            new JdbcTemplate(dataSource), embeddingModel)
        .dimensions(dimensions)
        .distanceType(PgDistanceType.COSINE_DISTANCE)
        .indexType(PgIndexType.HNSW)
        .initializeSchema(true)
        .build();
}
```

The `dimensions` parameter defaults to 1536 (OpenAI's `text-embedding-ada-002`
output size) but is configurable for other embedding models. The `HNSW` index
type provides fast approximate search at the cost of more memory than IVFFlat.
`COSINE_DISTANCE` is the standard similarity metric for text embeddings.
`initializeSchema(true)` creates the `vector_store` table and index on startup
if they do not exist.

The `DataSource` uses HikariCP connection pooling:

```java showLineNumbers title="src/main/java/com/example/support/config/VectorStoreConfig.java"
@Bean
DataSource dataSource(
    @Value("${spring.datasource.url}") String url,
    @Value("${spring.datasource.username}") String username,
    @Value("${spring.datasource.password}") String password
) {
    var ds = new HikariDataSource();
    ds.setJdbcUrl(url);
    ds.setUsername(username);
    ds.setPassword(password);
    return ds;
}
```

On startup, `KnowledgeBaseService` loads knowledge base articles into the vector
store. It implements `ApplicationRunner` so it runs after the Spring context is
fully initialized:

```java showLineNumbers title="src/main/java/com/example/support/service/KnowledgeBaseService.java"
@Override
public void run(ApplicationArguments args) {
    int existing = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM vector_store", Integer.class);
    if (existing > 0) {
        log.info("Vector store already populated with {} "
            + "documents, skipping KB load", existing);
        return;
    }

    log.info("Loading KB articles into vector store...");
    List<Map<String, Object>> articles = jdbcTemplate.queryForList(
        "SELECT id, intent, question, answer, category "
        + "FROM kb_articles");

    List<Document> docs = articles.stream()
        .map(row -> {
            String content = row.get("question")
                + "\n\n" + row.get("answer");
            Map<String, Object> metadata = Map.of(
                "intent", row.get("intent"),
                "category", row.get("category") != null
                    ? row.get("category") : "",
                "source", "kb_article",
                "article_id", row.get("id").toString()
            );
            return new Document(content, metadata);
        })
        .toList();

    vectorStore.add(docs);
    log.info("Loaded {} KB articles into vector store",
        docs.size());
}
```

The startup check (`SELECT COUNT(*) FROM vector_store`) prevents duplicate
embeddings on restart. Each document combines the question and answer text, with
metadata for intent, category, source type, and article ID. The
`vectorStore.add()` call handles embedding generation (via the configured
`EmbeddingModel`) and insertion in a single operation.

At query time, `ContextRetriever.retrieve()` runs a similarity search with
`topK(5)`:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ContextRetriever.java"
List<Document> results = vectorStore.similaritySearch(
    SearchRequest.builder()
        .query(userMessage)
        .topK(TOP_K)
        .build()
);
```

The returned documents are formatted for the system prompt by `formatContext()`:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ContextRetriever.java"
public String formatContext(List<Document> documents) {
    if (documents.isEmpty()) {
        return "";
    }

    var sb = new StringBuilder(
        "Relevant knowledge base articles:\n\n");
    for (int i = 0; i < documents.size(); i++) {
        var doc = documents.get(i);
        sb.append("--- Article ").append(i + 1)
            .append(" ---\n");
        sb.append(doc.getText()).append("\n\n");
    }
    return sb.toString();
}
```

This produces a numbered list of articles injected into the system prompt, so
the LLM can reference specific knowledge base content in its response. The top
similarity score is recorded as both a span attribute (`support.top_similarity`
on the `rag_retrieval` span) and a metric (`support.rag.similarity` histogram)
for tracking retrieval quality over time.

## Retry and Fallback Observability

The `LlmService` implements a two-tier resilience strategy: retry with
exponential backoff within a single provider, and fallback to an alternate
provider when all retries are exhausted. Both tiers are instrumented with
metrics.

The `generateWithRetry()` method handles the retry loop for a single provider:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private LlmResponse generateWithRetry(
    ChatModel chatModel, String providerName, String model,
    String systemPrompt, String userPrompt, String stage,
    List<ToolCallback> toolCallbacks
) {
    Exception lastError = null;
    for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return generateOnce(
                chatModel, providerName, model,
                systemPrompt, userPrompt, stage,
                toolCallbacks);
        } catch (Exception e) {
            lastError = e;
            log.warn("LLM call failed (attempt {}/{}): "
                + "provider={} model={} error={}",
                attempt + 1, MAX_RETRIES,
                providerName, model, e.getMessage());
            if (attempt > 0) {
                retryCounter.add(1,
                    providerModelAttrs(providerName, model));
            }
            if (attempt < MAX_RETRIES - 1) {
                sleep(backoffWithJitter(attempt));
            }
        }
    }
    log.error("All {} retries exhausted for provider={}",
        MAX_RETRIES, providerName, lastError);
    return null;
}
```

The retry loop makes up to `MAX_RETRIES` (3) attempts. On failure, it records
the retry attempt to the `gen_ai.client.retry.count` counter (skipping the first
attempt since that is not a retry). The backoff uses exponential delay with
jitter:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private long backoffWithJitter(int attempt) {
    long base = Math.min(
        MIN_BACKOFF_MS * (1L << attempt), MAX_BACKOFF_MS);
    long jitter = ThreadLocalRandom.current()
        .nextLong(0, base / 4 + 1);
    return base + jitter;
}
```

This produces delays of approximately 1s, 2s, and 4s for attempts 0, 1, and 2,
capped at 10s, with up to 25% random jitter added to prevent thundering-herd
retries across concurrent requests. The method returns `null` after exhausting
all retries rather than throwing — this signals the caller to try the fallback
provider.

The `generate()` method orchestrates the primary-to-fallback flow:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
public LlmResponse generate(
    String systemPrompt, String userPrompt,
    String model, String stage,
    List<ToolCallback> toolCallbacks
) {
    var resp = generateWithRetry(
        primaryModel, config.provider(), model,
        systemPrompt, userPrompt, stage, toolCallbacks);
    if (resp != null) {
        return resp;
    }

    log.warn("Primary provider {} failed, falling back to {}",
        config.provider(), config.fallbackProvider());
    fallbackCounter.add(1);

    resp = generateWithRetry(
        fallbackModel, config.fallbackProvider(),
        config.fallbackModel(),
        systemPrompt, userPrompt, stage, toolCallbacks);
    if (resp != null) {
        return resp;
    }

    throw new RuntimeException(
        "All LLM providers failed after retries");
}
```

The flow is: try the primary provider with up to 3 retries. If all fail (
`generateWithRetry` returns `null`), increment `gen_ai.client.fallback.count`
and try the fallback provider with another 3 retries. If both providers fail,
throw a `RuntimeException` that propagates up to the pipeline's catch block and
sets the parent span status to ERROR.

In telemetry, retries and fallbacks surface through three metrics defined in the
LLM metrics section:

- `gen_ai.client.retry.count` — incremented on each retry attempt (not the
  initial attempt), labeled with `gen_ai.provider.name` and
  `gen_ai.request.model`. A steady increase indicates provider instability.
- `gen_ai.client.fallback.count` — incremented once per fallback activation. Any
  non-zero value means the primary provider failed completely for at least one
  request.
- `gen_ai.client.error.count` — incremented on every failed `generateOnce()`
  call, labeled with `error.type` (rate_limit, timeout, auth_error,
  invalid_request, server_error, network_error, unknown_error). This gives
  visibility into why retries are happening.

## Domain Metrics

The GenAI metrics from the previous sections cover LLM operational concerns —
token usage, cost, latency, errors. Domain metrics capture the business-level
signals that tell you whether the AI application is actually working for your
users: how long conversations last, how many turns they take, when they escalate
to humans, which tools the LLM calls, and how relevant the RAG results are.

`SupportMetrics` defines five domain-specific metrics using the OpenTelemetry
Meter API:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/SupportMetrics.java"
@Component
public class SupportMetrics {

    private final DoubleHistogram conversationDuration;
    private final DoubleHistogram conversationTurns;
    private final LongCounter escalationCount;
    private final LongCounter toolCallCount;
    private final DoubleHistogram ragSimilarity;

    public SupportMetrics() {
        Meter meter = GlobalOpenTelemetry.getMeter(
            "ai-customer-support");

        this.conversationDuration = meter
            .histogramBuilder("support.conversation.duration")
            .setUnit("s")
            .setDescription("Duration of customer support "
                + "conversations")
            .build();

        this.conversationTurns = meter
            .histogramBuilder("support.conversation.turns")
            .setUnit("{turn}")
            .setDescription("Number of turns in customer "
                + "support conversations")
            .build();

        this.escalationCount = meter
            .counterBuilder("support.escalation.count")
            .setDescription(
                "Number of escalated conversations")
            .build();

        this.toolCallCount = meter
            .counterBuilder("support.tool_calls")
            .setDescription("Number of tool calls made")
            .build();

        this.ragSimilarity = meter
            .histogramBuilder("support.rag.similarity")
            .setDescription("Top similarity score from "
                + "RAG retrieval")
            .build();
    }

    public void recordConversationDuration(
        double seconds, String intent, boolean escalated
    ) {
        conversationDuration.record(seconds, Attributes.of(
            AttributeKey.stringKey("support.intent"), intent,
            AttributeKey.booleanKey("support.escalated"),
                escalated
        ));
    }

    public void recordConversationTurns(
        int turns, String intent, boolean resolved
    ) {
        conversationTurns.record(turns, Attributes.of(
            AttributeKey.stringKey("support.intent"), intent,
            AttributeKey.booleanKey("support.resolved"), resolved
        ));
    }

    public void recordEscalation(String reason, String priority) {
        escalationCount.add(1, Attributes.of(
            AttributeKey.stringKey("support.escalation_reason"),
                reason,
            AttributeKey.stringKey("support.escalation_priority"),
                priority
        ));
    }

    public void recordToolCall(String toolName, boolean success) {
        toolCallCount.add(1, Attributes.of(
            AttributeKey.stringKey("support.tool_name"), toolName,
            AttributeKey.booleanKey("support.tool_success"), success
        ));
    }

    public void recordRagSimilarity(
        double similarity, String intent
    ) {
        ragSimilarity.record(similarity, Attributes.of(
            AttributeKey.stringKey("support.intent"), intent
        ));
    }
}
```

Each metric is recorded at a specific point in the pipeline:

- `support.conversation.duration` and `support.conversation.turns` — recorded at
  the end of `SupportPipeline.runPipeline()`, after all stages complete.
  Duration is measured from the start of `runPipeline()` in seconds. Turns are
  calculated as `history.size() / 2 + 1` (each turn is a user-assistant pair).
- `support.escalation.count` — recorded in `SupportPipeline.runPipeline()`
  immediately after the escalation check, only when
  `escalation.shouldEscalate()` returns true.
- `support.tool_calls` — recorded inside each `@Tool` method in `OrderTools` and
  `ProductTools`. Every tool call increments the counter with the tool name and
  success status.
- `support.rag.similarity` — recorded in `SupportPipeline.runPipeline()` after
  RAG retrieval, using the top document's similarity score.

| Metric                          | Type      | Unit     | Labels                                                     | Business Purpose                                                    |
| ------------------------------- | --------- | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `support.conversation.duration` | Histogram | `s`      | `support.intent`, `support.escalated`                      | Track resolution time by intent type and escalation status          |
| `support.conversation.turns`    | Histogram | `{turn}` | `support.intent`, `support.resolved`                       | Detect long conversations that may need UX improvements             |
| `support.escalation.count`      | Counter   | -        | `support.escalation_reason`, `support.escalation_priority` | Monitor escalation rate and reasons for human handoff               |
| `support.tool_calls`            | Counter   | -        | `support.tool_name`, `support.tool_success`                | Track which tools the LLM uses and their success rate               |
| `support.rag.similarity`        | Histogram | -        | `support.intent`                                           | Monitor retrieval quality — low scores indicate knowledge base gaps |

## PII and Security

AI applications handle user input that may contain personally identifiable
information — email addresses, social security numbers, credit card numbers,
phone numbers. The `PiiFilter` scrubs PII from both response content (returned
to the client) and telemetry data (exported to the collector) so sensitive data
does not leak into traces or logs.

The filter uses regex patterns for four PII categories:

```java showLineNumbers title="src/main/java/com/example/support/filter/PiiFilter.java"
@Component
public class PiiFilter {

    private static final String REDACTED = "[REDACTED]";

    private record PiiPattern(String name, Pattern pattern) {}

    private static final List<PiiPattern> PATTERNS = List.of(
        new PiiPattern("email",
            Pattern.compile(
                "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+"
                + "\\.[A-Za-z]{2,}\\b")),
        new PiiPattern("ssn",
            Pattern.compile("\\b\\d{3}-\\d{2}-\\d{4}\\b")),
        new PiiPattern("credit_card",
            Pattern.compile(
                "\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?"
                + "\\d{4}\\b")),
        new PiiPattern("phone",
            Pattern.compile(
                "(?:\\+?1[-.]?)?\\(?\\d{3}\\)?[-.]?"
                + "\\d{3}[-.]?\\d{4}"))
    );

    public String scrub(String text) {
        if (text == null || text.isEmpty()) return text;

        String result = text;
        boolean piiFound = false;

        for (var pii : PATTERNS) {
            var matcher = pii.pattern().matcher(result);
            if (matcher.find()) {
                piiFound = true;
                log.warn("PII detected (type={}), redacting",
                    pii.name());
                result = matcher.replaceAll(REDACTED);
            }
        }

        if (piiFound) {
            Span current = Span.current();
            current.addEvent("support.pii_detected",
                Attributes.of(
                    AttributeKey.booleanKey(
                        "support.pii_redacted"), true
                ));
        }

        return result;
    }
}
```

When PII is detected and redacted, the filter adds a `support.pii_detected` span
event to the current active span with `support.pii_redacted = true`. This
provides an audit trail in traces — you can see that PII was present and
scrubbed without the trace containing the actual PII data.

The filter is applied at two points in the pipeline:

1. **Response content** — `PiiFilter.scrub()` is called on the LLM response in
   `SupportPipeline.runPipeline()` before returning content to the client:

   ```java showLineNumbers title="src/main/java/com/example/support/pipeline/SupportPipeline.java"
   // 4. PII scrub
   String content = piiFilter.scrub(response.content());
   ```

2. **Span events** — In `LlmService.generateOnce()`, the PII filter scrubs
   prompt and completion content before writing it to span events:

   ```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
   if (captureContent) {
       span.addEvent("gen_ai.user.message", Attributes.of(
           AttributeKey.stringKey("gen_ai.prompt"),
               truncate(piiFilter.scrub(userPrompt), 1000)
       ));
       // ...
   }
   ```

   ```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
   if (captureContent) {
       span.addEvent("gen_ai.assistant.message", Attributes.of(
           AttributeKey.stringKey("gen_ai.completion"),
               truncate(piiFilter.scrub(content), 2000)
       ));
   }
   ```

Content capture itself is gated by the
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable. The
application checks this at startup:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
this.captureContent = "true".equalsIgnoreCase(
    System.getenv(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"));
```

When this variable is unset or set to anything other than `"true"`, no prompt or
completion content is written to span events at all — a defense-in-depth
approach where PII filtering is the second layer after the content capture gate.

Additional security practices in the application:

- **API keys via environment variables** — Provider API keys (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`) are injected via environment variables,
  never hardcoded in source or configuration files.
- **Content truncation limits** — Prompts are truncated to 1000 characters,
  system instructions to 500 characters, and completions to 2000 characters
  before writing to span events. This prevents large payloads from inflating
  trace storage costs.
- **PII scrubbing before telemetry export** — The PII filter runs before content
  reaches OpenTelemetry span events, so sensitive data never leaves the
  application process.
- **Spring AI observation content capture** — Spring AI's built-in Micrometer
  observations (Layer 2) have their own content capture setting
  (`spring.ai.chat.observations.include-input` /
  `spring.ai.chat.observations.include-output`) which defaults to false. This
  means Spring AI's auto-generated spans also do not capture content by default.

## Running Your Application

<div class="mdx-code-block">
<Tabs>
<TabItem value="development" label="Development" default>

In development, run directly with Gradle without the Java Agent. Spring AI's
Micrometer observations and your manual OpenTelemetry spans still work — the
Java Agent just adds the automatic HTTP/JDBC layer on top.

Set your environment variables and start the application:

```bash showLineNumbers
# Set environment variables
export OPENAI_API_KEY=sk-...
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=ai-customer-support

# Run with Spring Boot
./gradlew bootRun
```

For local development with Ollama (no API key needed):

```bash showLineNumbers
SPRING_PROFILES_ACTIVE=ollama ./gradlew bootRun
```

Console output shows Spring AI observations and your manual spans. If you add a
`debug` exporter to a local collector, you will see full span details in the
collector logs.

Without the Java Agent, you get Layer 2 (Spring AI Micrometer observations) and
Layer 3 (manual OpenTelemetry API spans) but not Layer 1 (auto HTTP/JDBC spans).
This is fine for development — the two manual layers provide full GenAI context.

</TabItem>
<TabItem value="production" label="Production">

In production, attach the OpenTelemetry Java Agent for the full three-layer
instrumentation stack:

```bash showLineNumbers
java -javaagent:/path/to/opentelemetry-javaagent.jar \
  -Dotel.service.name=ai-customer-support \
  -Dotel.exporter.otlp.endpoint=http://collector:4318 \
  -Dotel.exporter.otlp.protocol=http/protobuf \
  -Dotel.traces.exporter=otlp \
  -Dotel.metrics.exporter=otlp \
  -Dotel.logs.exporter=otlp \
  -jar app.jar
```

Configure sampling to control trace volume in high-traffic environments:

```yaml showLineNumbers title="application-production.yml"
management:
  tracing:
    sampling:
      probability: 0.1 # 10% sampling for high-traffic
```

Set resource attributes to identify the deployment in your observability
backend:

```bash showLineNumbers
export OTEL_RESOURCE_ATTRIBUTES="service.name=ai-customer-support,deployment.environment=production,service.version=1.2.0"
```

For production, always route telemetry through an OpenTelemetry Collector rather
than exporting directly from the application. The collector provides buffering,
retry logic, and filtering that protects both your application and your backend.

</TabItem>
<TabItem value="docker" label="Docker Compose">

The Docker Compose setup runs the application with the Java Agent, a PostgreSQL
database with pgvector, and the OpenTelemetry Collector — the full production
stack locally.

The `Dockerfile` uses a multi-stage build that compiles the application, then
downloads the Java Agent into the runtime image:

```dockerfile showLineNumbers title="Dockerfile"
FROM gradle:9.2.1-jdk25 AS builder

WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle ./gradle
COPY src ./src

RUN gradle build -x test --no-daemon

FROM eclipse-temurin:25-jre

WORKDIR /app

ADD https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.25.0/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

COPY --from=shared pricing.json /app/pricing.json

COPY --from=builder /app/build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

The `compose.yml` wires together the application, database, and collector:

```yaml showLineNumbers title="compose.yml"
services:
  app:
    build:
      context: .
      additional_contexts:
        shared: ../../_shared
    ports:
      - "8080:8080"
    environment:
      SPRING_R2DBC_URL: r2dbc:postgresql://postgres:5432/support
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/support
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_NAME: support
      DB_USER: postgres
      DB_PASSWORD: postgres
      LLM_PROVIDER: ${LLM_PROVIDER:-openai}
      LLM_MODEL_CAPABLE: ${LLM_MODEL_CAPABLE:-gpt-4.1}
      LLM_MODEL_FAST: ${LLM_MODEL_FAST:-gpt-4.1-mini}
      FALLBACK_PROVIDER: ${FALLBACK_PROVIDER:-anthropic}
      FALLBACK_MODEL: ${FALLBACK_MODEL:-claude-haiku-4-5-20251001}
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      GOOGLE_API_KEY: ${GOOGLE_API_KEY:-}
      DEFAULT_TEMPERATURE: ${DEFAULT_TEMPERATURE:-0.3}
      DEFAULT_MAX_TOKENS: ${DEFAULT_MAX_TOKENS:-1024}
      EMBEDDING_MODEL: ${EMBEDDING_MODEL:-text-embedding-3-small}
      EMBEDDING_DIMENSIONS: ${EMBEDDING_DIMENSIONS:-1536}
      EMBEDDING_PROVIDER: ${EMBEDDING_PROVIDER:-openai}
      PRICING_FILE: /app/pricing.json
      SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-}
      OTEL_SERVICE_NAME: ai-customer-support
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_TRACES_EXPORTER: otlp
      OTEL_METRICS_EXPORTER: otlp
      OTEL_LOGS_EXPORTER: otlp
      OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED: "true"
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: ${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:8080/api/health",
        ]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  postgres:
    image: pgvector/pgvector:pg18
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: support
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.146.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    volumes:
      - ./config/otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    environment:
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID:-}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET:-}
      SCOUT_TOKEN_URL: ${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      SCOUT_ENDPOINT: ${SCOUT_ENDPOINT:-https://collector.base14.io}
      SCOUT_ENVIRONMENT: ${SCOUT_ENVIRONMENT:-development}
    healthcheck:
      test: ["NONE"]

volumes:
  pgdata:
```

Start the stack and verify:

```bash showLineNumbers
# Start all services
docker compose up -d

# Check health
docker compose ps
curl http://localhost:8080/api/health

# View logs
docker compose logs -f app
```

The OpenTelemetry Collector configuration handles telemetry routing, filtering,
and export. This configuration includes the health check and zpages extensions
for collector diagnostics, a noise filter for health check and HikariCP
housekeeping spans, retry logic for the exporter, and a debug exporter for local
development:

```yaml showLineNumbers title="config/otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133

  zpages:
    endpoint: 0.0.0.0:55679

  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 128

  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*/health.*")'
        - 'IsMatch(name, ".*/actuator.*")'
        # HikariCP connection pool runs keepalive queries every ~30s on a
        # housekeeper thread. The JDBC auto-instrumentation creates orphan
        # single-span traces for these (no parent HTTP/pipeline context).
        # Drop them to avoid polluting the trace store.
        - 'attributes["thread.name"] != nil and
          IsMatch(attributes["thread.name"], "HikariPool.*housekeeper")'

  batch:
    timeout: 10s
    send_batch_size: 1024
    send_batch_max_size: 2048

  attributes:
    actions:
      - key: deployment.environment
        value: ${SCOUT_ENVIRONMENT}
        action: upsert

exporters:
  otlp_http/b14:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s

  debug:
    verbosity: detailed
    sampling_initial: 100
    sampling_thereafter: 100

service:
  extensions: [health_check, zpages, oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noisy, attributes, batch]
      exporters: [otlp_http/b14, debug]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlp_http/b14, debug]
```

Key collector configuration details:

- **`health_check`** on port 13133 — used by Docker health checks and load
  balancers to verify the collector is running
- **`zpages`** on port 55679 — provides live debugging pages at `/debug/tracez`
  and `/debug/pipelinez` for inspecting the collector's internal state
- **`oauth2client`** — authenticates with base14 Scout using OAuth2 client
  credentials
- **`memory_limiter`** — caps the collector at 512 MiB with a 128 MiB spike
  buffer, preventing OOM in constrained environments
- **`filter/noisy`** — drops health check, actuator, and HikariCP housekeeper
  spans that add volume without diagnostic value
- **`retry_on_failure`** — retries failed exports with exponential backoff from
  1s to 30s, for up to 5 minutes total
- **`debug` exporter** — logs detailed span information locally, invaluable
  during development and initial deployment validation

</TabItem>
</Tabs>
</div>

## Troubleshooting

Verify your deployment is working by sending a health check and a test message:

```bash showLineNumbers
# Health check
curl http://localhost:8080/api/health

# Send a test message
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the status of order ORD-10001?"}'
```

The response should include the AI-generated answer along with metadata like
model name, token counts, and cost. The corresponding trace should appear in
your observability backend within a few seconds.

Enable debug logging to diagnose instrumentation issues:

```bash showLineNumbers
# Enable Java Agent debug logging
OTEL_LOG_LEVEL=debug docker compose up

# Enable Spring AI observation logging
# Add to application.yml or pass as -D flag:
# logging.level.org.springframework.ai=DEBUG
```

### No traces appearing

Check that the collector endpoint URL matches between the application and the
collector. The application sends to `http://otel-collector:4318` (the Docker
service name), not `localhost`:

```bash showLineNumbers
# Check collector logs for incoming data
docker compose logs otel-collector

# Verify the Java Agent loaded
docker compose logs app | grep "opentelemetry-javaagent"
```

Confirm the Java Agent JAR path in the Dockerfile matches the download URL. If
the path is wrong, the JVM starts without the agent silently — no error, just no
Layer 1 spans.

### Spring AI spans missing

Verify that `micrometer-tracing-bridge-otel` is in your `build.gradle`
dependencies. This bridge is what connects Spring AI's Micrometer observations
to OpenTelemetry. Without it, Spring AI creates observations but they never
become OpenTelemetry spans.

Check that sampling is not set to zero:

```yaml showLineNumbers title="application.yml"
management:
  tracing:
    sampling:
      probability: 1.0 # Must be > 0; 1.0 for development
```

### Duplicate spans from Java Agent and Spring AI

The Java Agent auto-instruments HTTP clients (Netty, Apache HttpClient, etc.),
and Spring AI creates its own ChatModel observation spans. This means a single
LLM call produces both an HTTP span (from the agent) and a ChatModel span (from
Spring AI). This is expected behavior, not a bug — the HTTP span shows network
timing while the ChatModel span shows model-level metadata.

If the volume is excessive, the `filter/noisy` processor in the collector
configuration can drop specific span patterns. But in most cases, both spans
provide useful and non-overlapping information.

### pgvector connection errors

The application uses two separate database connections: R2DBC for reactive
repository operations and JDBC for pgvector vector store and tool-calling
queries. Both must be configured:

```yaml showLineNumbers title="application.yml"
spring:
  r2dbc:
    url: r2dbc:postgresql://postgres:5432/support
  datasource:
    url: jdbc:postgresql://postgres:5432/support
```

Verify the pgvector extension is enabled in the database:

```sql showLineNumbers
CREATE EXTENSION IF NOT EXISTS vector;
```

The seed SQL scripts (`db/schema.sql`) handle this automatically, but if you are
connecting to an existing database, you need the extension installed manually.

### Tool calls not showing in traces

Verify tools are registered via `MethodToolCallbackProvider` and that you are
using `ToolCallingChatOptions` (not plain `ChatOptions`) when building prompts
for tool-enabled calls:

```java showLineNumbers
// Correct: ToolCallingChatOptions enables tool discovery
var options = ToolCallingChatOptions.builder()
    .model(model)
    .toolCallbacks(toolCallbacks)
    .build();

// Wrong: plain ChatOptions ignores tool callbacks
var options = ChatOptions.builder()
    .model(model)
    .build();
```

Each `@Tool` method should call `SupportMetrics.recordToolCall()` to record the
tool invocation in your custom metrics. Without this call, the tool executes but
no `support.tool.calls` metric is emitted.

## Performance Considerations

Three-layer instrumentation adds measurable but minimal overhead to each
request:

| Layer                | Latency Overhead        | Memory      | CPU        |
| -------------------- | ----------------------- | ----------- | ---------- |
| Java Agent           | 1-3ms per span          | ~50MB heap  | &lt;1%     |
| Spring AI Micrometer | &lt;1ms per observation | Negligible  | Negligible |
| Manual OTel API      | &lt;0.5ms per span      | Negligible  | Negligible |
| Combined             | 2-5ms per request       | ~60MB total | 1-2%       |

For an AI application where LLM calls take 500ms-5s each, the 2-5ms
instrumentation overhead is negligible — well under 1% of total request latency.

Five practices to optimize instrumentation performance in production:

1. **Use sampling for high-traffic services.** Set
   `management.tracing.sampling.probability` to 0.1-0.5 in production. A 10%
   sample rate captures enough data for trend analysis while reducing trace
   volume by 90%. For AI applications with relatively low request volume
   (compared to CRUD APIs), you may keep 1.0 sampling.

2. **The memory_limiter processor prevents collector OOM.** The collector
   configuration sets a 512 MiB limit with a 128 MiB spike buffer. When the
   collector approaches the limit, it drops new telemetry rather than crashing.
   This protects the collector process in memory-constrained container
   environments.

3. **BatchSpanProcessor batches exports to reduce network calls.** The Java
   Agent uses `BatchSpanProcessor` by default, which buffers spans and exports
   them in batches (default: every 5 seconds or 512 spans, whichever comes
   first). This means individual span creation never blocks on network I/O.

4. **Content capture is disabled by default.** The
   `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable
   defaults to false. Enabling it adds JSON serialization overhead for every
   prompt and completion — significant for large payloads. Only enable content
   capture during debugging or for specific trace sampling.

5. **Filter noisy spans in the collector.** The `filter/noisy` processor drops
   health check, actuator, and HikariCP housekeeper spans. In a Spring Boot
   application, actuator endpoints alone can generate dozens of spans per
   minute. Filtering these at the collector level (rather than the application)
   means the application still exports them for debugging if you temporarily
   remove the filter.

## FAQ

### How much overhead does OpenTelemetry add to a Spring AI application?

Combined overhead is 2-5ms per request with approximately 60MB additional heap
usage. For AI applications where LLM calls dominate latency (500ms-5s per call),
this is less than 1% overhead. The Java Agent's `BatchSpanProcessor` ensures
span creation never blocks on network I/O, and the Micrometer observation layer
adds sub-millisecond overhead per observation.

### Do I need all three OpenTelemetry layers or can I use fewer?

Yes. Each layer is independent:

- **Layer 1 only (Java Agent)**: Add `-javaagent` flag. You get HTTP, JDBC, and
  R2DBC spans with zero code changes, but no GenAI attributes.
- **Layer 2 only (Spring AI Micrometer)**: Add `micrometer-tracing-bridge-otel`
  to dependencies. You get ChatModel and VectorStore spans with model names and
  token counts.
- **Layer 3 only (Manual OTel API)**: Use `GlobalOpenTelemetry.getTracer()`. You
  get full GenAI semantic conventions, custom metrics, and pipeline context.
- **Layer 1 + 2**: Auto HTTP/JDBC spans plus Spring AI observations. Good
  coverage without any manual instrumentation code.
- **Layer 2 + 3**: Spring AI observations plus manual GenAI spans. Full AI
  context without the Java Agent JAR.

The full three-layer stack provides the most complete traces, but any
combination works.

### What Spring AI versions are compatible?

This guide uses Spring AI 2.0.0-M2 with Spring Boot 4.0.3. The key requirement
is that Spring AI must emit Micrometer observations (available since Spring AI
1.0.0-M1). The `micrometer-tracing-bridge-otel` dependency must match your
Spring Boot version's Micrometer version — Spring Boot's dependency management
BOM handles this automatically.

### How do I reduce trace volume in production?

Four approaches, from least to most aggressive:

1. **Sampling**: Set `management.tracing.sampling.probability` to 0.1-0.5.
2. **Collector filtering**: The `filter/noisy` processor drops health checks,
   actuator endpoints, and HikariCP housekeeping spans.
3. **Head-based sampling at the collector**: Add a `probabilistic_sampler`
   processor to the collector pipeline for additional server-side sampling.
4. **Disable Layer 1**: Remove the Java Agent to eliminate HTTP/JDBC auto-spans
   while keeping the AI-specific spans from Layers 2 and 3.

### Can I use the OpenTelemetry Java Agent with Spring AI at the same time?

No. The Java Agent instruments at the bytecode level (HTTP clients, JDBC
drivers) while Spring AI observations operate at the application framework level
(ChatModel, VectorStore). They share the same OpenTelemetry context, so their
spans appear as parent-child in the same trace. The only overlap is HTTP client
spans — the Java Agent creates an HTTP span for the outbound LLM API call, and
Spring AI creates a ChatModel observation span. Both carry useful but different
information (network timing vs. model metadata).

### How do I add a new LLM provider (e.g., Google Gemini)?

Add the Spring AI starter for the provider to `build.gradle`:

```groovy showLineNumbers
implementation 'org.springframework.ai:spring-ai-starter-model-vertex-ai-gemini'
```

Then register the ChatModel bean and add a case in
`LlmConfig.resolveChatModel()` to map the provider name to the bean. The
three-layer instrumentation works automatically — the Java Agent captures the
HTTP call to Google's API, Spring AI emits a ChatModel observation, and
`LlmService.generateOnce()` creates the GenAI span with the correct
`gen_ai.provider.name` attribute.

### How do I track costs across multiple providers?

The `LlmService` loads pricing data from `pricing.json`, which maps model names
to per-token input and output costs. Each `generateOnce()` call calculates cost
using `pricing.calculateCost(responseModel, inputTokens, outputTokens)` and
records it to both the span attribute (`gen_ai.usage.cost_usd`) and the
`gen_ai.client.cost` metric counter. To add a new model, add its pricing to
`pricing.json`. To aggregate costs, query the `gen_ai.client.cost` metric
grouped by `gen_ai.provider.name` and `gen_ai.request.model`.

### How should I handle PII in production telemetry?

The application applies two layers of PII protection:

1. **Content capture gate**: The
   `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable
   (default: false) controls whether prompts and completions are written to span
   events at all. In production, leave this disabled.
2. **PII filter**: When content capture is enabled, the `PiiFilter` scrubs email
   addresses, phone numbers, SSNs, and credit card numbers before writing to
   span events. This is a defense-in-depth measure.

Span attributes like model name, token counts, and cost never contain PII and
are always safe to export.

### Can I deploy to Kubernetes instead of Docker Compose?

Yes. The Docker Compose setup translates directly to Kubernetes:

- The `app` service becomes a Deployment with the same environment variables
- The `postgres` service becomes a StatefulSet or a managed database service
- The `otel-collector` becomes a DaemonSet or a sidecar container
- Environment variables from `.env` move to Kubernetes Secrets and ConfigMaps
- The collector config becomes a ConfigMap mounted as a volume

The application code and Dockerfile do not change. Only the orchestration layer
differs.

### How do I debug missing GenAI attributes on spans?

If spans appear but lack `gen_ai.*` attributes, the issue is in Layer 3 (manual
instrumentation). Check these in order:

1. **Verify `GlobalOpenTelemetry.getTracer()` returns a real tracer.** If the
   Java Agent is not loaded or the SDK is not initialized, it returns a no-op
   tracer that creates spans silently discarded.
2. **Check that `span.setAttribute()` calls use the correct attribute names.**
   The GenAI semantic conventions use underscores (`gen_ai.request.model`), not
   dots or hyphens.
3. **Confirm the span is ended.** Attributes set on a span after `span.end()`
   are ignored. The `try/finally` pattern in `generateOnce()` ensures the span
   is always ended.
4. **Look at the debug exporter output.** The collector's `debug` exporter logs
   every span with all attributes. If the attributes are present in the debug
   output but missing in your backend, the issue is in the backend's indexing,
   not the instrumentation.

## What's Next

### Advanced Topics

- [Custom Java Instrumentation](../../instrument/apps/custom-instrumentation/java.md)
  — manual spans and metrics for non-AI Java applications
- [Spring Boot Auto-Instrumentation](../../instrument/apps/auto-instrumentation/spring-boot.md)
  — zero-code instrumentation for Spring Boot web applications
- [LLM Observability](./llm-observability) — Python patterns for LLM
  observability
- [Rust LLM Observability](./rust-llm-observability) — Rust patterns with manual
  GenAI instrumentation

### Scout Platform Features

- [Creating Alerts](../../guides/creating-alerts-with-logx.md) — set up cost,
  latency, and error rate alerts
- [Create Your First Dashboard](../../guides/create-your-first-dashboard.md) —
  visualize AI metrics

### Deployment and Operations

- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  — collector deployment reference

## Complete Example

The following files form a working deployment of the AI customer support
application with full three-layer observability. The complete source code is
available at
[github.com/base-14/examples/tree/main/java/ai-customer-support](https://github.com/base-14/examples/tree/main/java/ai-customer-support).

### build.gradle

The dependencies include Spring AI with three LLM providers, the Micrometer
OpenTelemetry bridge, the OpenTelemetry API, pgvector for RAG, and both R2DBC
and JDBC database drivers:

```groovy showLineNumbers title="build.gradle"
plugins {
    id 'java'
    id 'org.springframework.boot' version '4.0.3'
    id 'io.spring.dependency-management' version '1.1.7'
}

group = 'com.example'
version = '0.0.1-SNAPSHOT'

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    mavenCentral()
}

dependencyManagement {
    imports {
        mavenBom "org.springframework.ai:spring-ai-bom:2.0.0-M2"
    }
}

dependencies {
    // Web (reactive)
    implementation 'org.springframework.boot:spring-boot-starter-webflux'

    // Observability
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-tracing-bridge-otel'
    implementation 'io.opentelemetry:opentelemetry-exporter-otlp'
    implementation 'io.opentelemetry:opentelemetry-api'

    // Spring AI - LLM providers
    implementation 'org.springframework.ai:spring-ai-starter-model-openai'
    implementation 'org.springframework.ai:spring-ai-starter-model-anthropic'
    implementation 'org.springframework.ai:spring-ai-starter-model-ollama'

    // Spring AI - pgvector RAG
    implementation 'org.springframework.ai:spring-ai-starter-vector-store-pgvector'

    // Database (reactive + JDBC for pgvector)
    implementation 'org.springframework.boot:spring-boot-starter-data-r2dbc'
    implementation 'org.springframework.boot:spring-boot-starter-jdbc'
    implementation 'org.postgresql:r2dbc-postgresql'
    implementation 'org.postgresql:postgresql'

    // JSON
    implementation 'com.fasterxml.jackson.core:jackson-databind'

    // Test
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'io.projectreactor:reactor-test'
}

bootJar {
    mainClass = 'com.example.support.Application'
}

tasks.named('test') {
    useJUnitPlatform()
}
```

### LlmService.java (abbreviated)

The core LLM call method that creates GenAI spans with semantic convention
attributes, records token usage and cost metrics, and handles content capture
with PII filtering. See the
[Custom LLM Instrumentation](#custom-llm-instrumentation) section for the full
walkthrough.

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private LlmResponse generateOnce(
    ChatModel chatModel, String providerName, String model,
    String systemPrompt, String userPrompt, String stage,
    List<ToolCallback> toolCallbacks
) {
    String spanName = "gen_ai.chat " + model;
    long start = System.nanoTime();

    Span span = tracer.spanBuilder(spanName)
        .setAttribute("gen_ai.operation.name", "chat")
        .setAttribute("gen_ai.provider.name", providerName)
        .setAttribute("gen_ai.request.model", model)
        .setAttribute("gen_ai.request.temperature", config.temperature())
        .setAttribute("gen_ai.request.max_tokens", (long) config.maxTokens())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        // ... prompt building and content capture (see Custom LLM Instrumentation section)

        ChatResponse response = chatModel.call(prompt);

        // Extract token usage, cost, finish reason
        // ... see Custom LLM Instrumentation section

        span.setAttribute("gen_ai.response.model", responseModel);
        span.setAttribute("gen_ai.usage.input_tokens", (long) inputTokens);
        span.setAttribute("gen_ai.usage.output_tokens", (long) outputTokens);
        span.setAttribute("gen_ai.usage.cost_usd", costUsd);

        // Record metrics
        tokenUsage.record(inputTokens, withTokenType(attrs, "input"));
        tokenUsage.record(outputTokens, withTokenType(attrs, "output"));
        operationDuration.record(duration, attrs);
        costCounter.add(costUsd, attrs);

        return new LlmResponse(content, responseModel, providerName,
            inputTokens, outputTokens, costUsd, finishReason);
    } catch (Exception e) {
        span.setStatus(StatusCode.ERROR, e.getMessage());
        errorCounter.add(1, /* ... */);
        throw e;
    } finally {
        span.end();
    }
}
```

### SupportPipeline.java (abbreviated)

The 6-stage pipeline that orchestrates intent classification, RAG retrieval,
response generation, PII scrubbing, escalation routing, and metrics recording
under a single parent span. See the
[Pipeline Observability](#pipeline-observability) section for the full
walkthrough.

```java showLineNumbers title="src/main/java/com/example/support/pipeline/SupportPipeline.java"
private PipelineResult runPipeline(
    String userMessage, UUID conversationId, List<Message> history
) {
    long startNanos = System.nanoTime();
    Span span = tracer.spanBuilder("support_conversation")
        .setAttribute("support.conversation_id", conversationId.toString())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        // 1. Classify intent (fast model)
        IntentResult intent = intentClassifier.classify(userMessage);
        span.setAttribute("support.intent", intent.intent().name());

        // 2. Retrieve RAG context
        var ragDocs = contextRetriever.retrieve(userMessage);
        span.setAttribute("support.rag_matches", ragDocs.size());

        // 3. Generate response (capable model)
        LlmResponse response = responseGenerator.generate(
            userMessage, intent, ragDocs, conversationHistory);

        // 4. PII scrub
        String content = piiFilter.scrub(response.content());

        // 5. Check escalation
        EscalationDecision escalation = escalationRouter.evaluate(intent, turns, 0);

        // 6. Record domain metrics
        // ... see Pipeline Orchestration section

        return new PipelineResult(content, intent, escalation,
            response.model(), response.provider(),
            response.inputTokens(), response.outputTokens(),
            response.costUsd(), conversationId);
    } catch (Exception e) {
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw new RuntimeException("Pipeline failed: " + e.getMessage(), e);
    } finally {
        span.end();
    }
}
```

### compose.yml

See the [Docker Compose tab](#running-your-application) above for the full
`compose.yml` and `Dockerfile`.

### otel-collector-config.yaml

See the [Docker Compose tab](#running-your-application) above for the full
collector configuration with all production essentials: `retry_on_failure`,
`debug` exporter, `health_check`/`zpages` extensions, `filter/noisy` processor,
and `memory_limiter`.

## References

- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [Spring AI Documentation](https://docs.spring.io/spring-ai/reference/)
- [OpenTelemetry Java Agent](https://opentelemetry.io/docs/zero-code/java/agent/)
- [OpenTelemetry Java SDK](https://opentelemetry.io/docs/languages/java/)
- [Micrometer Tracing](https://micrometer.io/docs/tracing)

## Related Guides

- [LLM Observability](./llm-observability) — Python patterns for AI application
  tracing
- [Rust LLM Observability](./rust-llm-observability) — Rust patterns with manual
  GenAI instrumentation
- [Spring Boot Auto-Instrumentation](../../instrument/apps/auto-instrumentation/spring-boot.md)
  — zero-code OpenTelemetry for Spring Boot web applications
- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  — Collector deployment and configuration
