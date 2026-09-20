---
title:
  Spring AI OpenTelemetry Instrumentation - Java LLM Tracing & Metrics Guide
sidebar_label: Java AI Observability
sidebar_position: 10
description:
  Spring AI OpenTelemetry instrumentation to trace LLM calls, track token cost,
  and monitor AI pipelines with the Java agent and GenAI semantic conventions.
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
languages. An LLM call is not just an HTTP request - it carries semantic
meaning: which model was used, how many tokens were consumed, what it cost,
whether the response was a fallback from another provider. Java uniquely offers
three composable instrumentation layers: the OpenTelemetry Java Agent
(`-javaagent` flag) provides zero-code auto-instrumentation for HTTP
server/client spans, JDBC queries, and R2DBC connections. Spring AI emits
Micrometer observations for ChatModel and VectorStore operations, which the
`micrometer-tracing-bridge-otel` dependency bridges directly into OpenTelemetry.
And the manual OpenTelemetry API, through an injected `Tracer`/`Meter` pair,
adds GenAI semantic convention attributes and custom metrics that neither auto
layer provides. All three layers share the same trace context,
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
the OpenTelemetry Collector - all visible in a single trace on base14 Scout.

:::info Cross-references

For general LLM observability patterns applicable to any language, see the
[LLM Observability guide](../llm-observability). This guide focuses specifically
on Java and Spring AI integration patterns. For Rust AI applications, see the
[Rust LLM Observability guide](../rust-llm-observability). For non-AI Java web
application instrumentation, check if a Spring Boot auto-instrumentation guide
is available under
[auto-instrumentation](../../../instrument/apps/auto-instrumentation/).

:::

:::tip TL;DR

Add the OpenTelemetry Java Agent (`-javaagent`), Spring AI's Micrometer bridge
(`micrometer-tracing-bridge-otel`), and an injected `Tracer`/`Meter` pair to
get unified traces across HTTP, database, LLM, and pipeline layers. This guide
covers Spring Boot 4.0.7 + Spring AI 2.0.0 with Ollama by default, and OpenAI
or Anthropic when you set a key.

:::

:::note Running this in production

Storing and querying these traces at production volume is what base14 Scout
does.
[Check out Scout LLM Observability](https://base14.io/scout/llm-observability).

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

- **Java 25+** installed (21+ minimum).
- **Spring Boot 4.0.7**.
- **Spring AI 2.0.0** (BOM `org.springframework.ai:spring-ai-bom:2.0.0`).
- **Ollama** running locally with `qwen3.5:9B` and `embeddinggemma` pulled.
  Ollama is the default provider and needs no API key; OpenAI and Anthropic
  are opt-in through `LLM_PROVIDER` and their own keys.
- **Scout Collector** configured and accessible from your application - see
  [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  for local development.
- **Basic understanding of OpenTelemetry concepts** (traces, spans, attributes).

### Compatibility Matrix

| Component | Minimum Version | Pinned in the example |
| --- | --- | --- |
| Java | 21 | 25 |
| Spring Boot | 3.4 | 4.0.7 |
| Spring AI | 1.0.0 | 2.0.0 |
| OpenTelemetry Java Agent | 2.0.0 | 2.31.1 |
| OpenTelemetry API | 1.40.0 | 1.65.0 |
| opentelemetry-micrometer-1.5 | 2.0.0 | 2.31.1-alpha |
| PostgreSQL (pgvector) | 15 | 18 |
| OTel Collector contrib | 0.158.0 | 0.161.0 |

## The Unified Trace

The core value of OpenTelemetry for Java AI applications is the **unified
trace** - a single trace ID that connects every instrumentation layer, from HTTP
entry through pipeline orchestration to LLM completions and database queries.

Here is what a trace looks like for a customer support chat request that spans
all three layers:

```text showLineNumbers title="Single trace spanning all three instrumentation layers"
POST /api/chat                              3.8s  [Layer 1: Java Agent]
├─ support_conversation                     3.7s  [Layer 3: Manual OTel]
│  ├─ classify_intent                       0.4s  [Layer 3: Manual OTel]
│  │  └─ chat qwen3.5:9B                    0.3s  [Layer 2+3: Spring AI + handler]
│  │     └─ HTTP POST localhost:11434       0.3s  [Layer 1: Java Agent]
│  ├─ retrieval kb_articles                 0.1s  [Layer 3: Manual OTel]
│  │  └─ embeddings embeddinggemma          0.1s  [Layer 2+3: Spring AI + handler]
│  │     └─ db.query pgvector              15ms   [Layer 1: Java Agent]
│  ├─ generate_response                     3.1s  [Layer 3: Manual OTel]
│  │  ├─ chat qwen3.5:9B                    1.2s  [Layer 2+3: Spring AI + handler]
│  │  │  └─ HTTP POST localhost:11434       1.2s  [Layer 1: Java Agent]
│  │  ├─ execute_tool getOrderStatus         8ms  [Layer 2+3: Spring AI + handler]
│  │  │  └─ db.query orders                  5ms  [Layer 1: Java Agent]
│  │  └─ chat qwen3.5:9B                    1.7s  [Layer 2+3: Spring AI + handler]
│  │     └─ HTTP POST localhost:11434       1.7s  [Layer 1: Java Agent]
│  └─ escalation_check                      1ms   [Layer 3: Manual OTel]
```

The two `chat` spans under `generate_response` are the tool-calling loop.
`LlmService` runs that loop itself, so the `execute_tool` span sits between
them as a sibling rather than inside either one. The models shown are the
Ollama defaults; setting `LLM_PROVIDER=openai` or `anthropic` changes the
model in the span name, the `gen_ai.provider.name` attribute and the HTTP
client span's host, and nothing else about the shape of the trace.

Three instrumentation layers work together in a single trace:

- **Layer 1 - Java Agent** (zero-code): Captures the outermost HTTP server span,
  outbound HTTP client spans to LLM APIs, and JDBC database query spans - all
  without any code changes
- **Layer 2 - Spring AI** (Micrometer bridge): Creates the `chat {model}` span
  for every ChatModel call and the `embeddings {model}` span for every
  VectorStore operation, as children of the current trace context. These are
  the GenAI spans themselves - the application does not create its own chat or
  embeddings span
- **Layer 3 - Manual OTel API**: Enriches the `chat {model}` span Spring AI
  already created with the GenAI attributes the framework's default convention
  does not set (cost, business context), adds pipeline orchestration spans
  (`support_conversation`, `classify_intent`, `retrieval kb_articles`), and
  records custom metrics

The Java Agent provides context propagation that ties everything together.
Spring AI creates the ChatModel and VectorStore spans inside that context, and
those spans already carry most GenAI attributes by default. Layer 3 adds the
few attributes Spring AI does not set and layers pipeline spans and metrics on
top. The result is a trace where you can see that a 3.8-second customer support
response spent 0.4 seconds on intent classification, 0.1 seconds on RAG
retrieval, and 3.1 seconds on response generation including a tool call to
look up order status.

## Three-Layer Architecture

Java AI applications benefit from a three-layer instrumentation approach that no
other language ecosystem matches. Each layer captures telemetry at a different
level of abstraction, and all three compose into unified traces through shared
OpenTelemetry context propagation.

| Layer | Source | What It Captures |
| --- | --- | --- |
| 1. Java Agent | `opentelemetry-javaagent.jar` (zero-code) | HTTP server/client spans, JDBC/R2DBC queries, Spring WebFlux |
| 2. Spring AI | Micrometer observations via `micrometer-tracing-bridge-otel` | The `chat {model}` and `embeddings {model}` spans themselves, plus tool execution |
| 3. Manual OTel API | Injected `Tracer` / `Meter` (via `Telemetry`) | Enrichment of the chat span with cost and business context, custom metrics, pipeline spans |

### Layer 1: Java Agent (Zero-Code Auto-Instrumentation)

The OpenTelemetry Java Agent attaches to the JVM via the `-javaagent` flag and
automatically instruments HTTP, database, and messaging frameworks with zero
code changes. It provides the outermost spans in every trace and handles context
propagation between all layers.

What it captures:

- **HTTP server spans** - Spring WebFlux incoming requests with method, path,
  status code, and latency
- **HTTP client spans** - outbound calls to LLM provider APIs (OpenAI,
  Anthropic) with URL, status, and duration
- **JDBC spans** - tool database queries (order lookups, product searches) with
  SQL statement and execution time
- **R2DBC spans** - reactive database access for conversation persistence

Configuration is entirely via environment variables. No code changes or
dependency additions are needed - the agent injects instrumentation at the
bytecode level.

The Dockerfile downloads the agent JAR and attaches it at startup:

```dockerfile showLineNumbers title="Dockerfile"
FROM gradle:9.2.1-jdk25 AS builder

ARG OTEL_AGENT_VERSION=2.31.1

WORKDIR /app

# Fetched here rather than with ADD so the layer caches and the download retries.
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 \
    -o /app/opentelemetry-javaagent.jar \
    "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar"

COPY build.gradle settings.gradle ./
COPY config/checkstyle ./config/checkstyle
COPY --from=shared pricing.json /app/_shared/pricing.json
COPY --from=shared test-vectors /app/_shared/test-vectors
COPY src ./src

RUN gradle bootJar --no-daemon

FROM eclipse-temurin:25-jre

# curl is here only so the container healthcheck has something to call.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home app

WORKDIR /app

COPY --from=builder --chown=app:app /app/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

COPY --from=builder --chown=app:app /app/build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar /app/app.jar

USER app
EXPOSE 8080

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

Three details matter here. The agent version is an `ARG`, so a bump is one
build argument rather than an edit to a URL buried in the file. The JAR is
fetched with `curl --retry` rather than `ADD`, so a flaky download retries
instead of failing the build, and the layer caches. And the runtime image
runs as the unprivileged `app` user, not root.

The agent is configured through environment variables in the Docker Compose
service definition:

```yaml showLineNumbers title="compose.yaml (agent environment variables)"
environment:
  OTEL_SERVICE_NAME: ai-customer-support
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED: "true"
  OTEL_SEMCONV_STABILITY_OPT_IN: gen_ai_latest_experimental
```

### Layer 2: Spring AI Observations (Micrometer Bridge)

Spring AI emits Micrometer observations for ChatModel and VectorStore
operations, and its default observation conventions already follow the
OpenTelemetry GenAI semantic conventions. Those conventions are still in
Development status as of September 2026, with no tagged release, so the
attribute names below can still change; see
[open-telemetry/semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai).
The `micrometer-tracing-bridge-otel`
dependency bridges these observations directly into OpenTelemetry, so the
resulting spans - `chat {model}` for a ChatModel call, `embeddings {model}` for
a VectorStore call - appear in the same trace context established by the Java
Agent. There is no separate, hand-written chat span: Spring AI's observation is
the chat span.

What it captures:

- **The `chat {model}` span** - `gen_ai.operation.name`, `gen_ai.provider.name`,
  `gen_ai.request.model`, `gen_ai.response.model`, token counts, and finish
  reason, set by Spring AI's default `ChatModelObservationConvention` for every
  `chatModel.call()` invocation
- **The `embeddings {model}` span** - similarity search and embedding
  generation against pgvector
- **Tool execution spans** - `@Tool` method invocations triggered by the LLM's
  tool-calling protocol

The application ships no OpenTelemetry SDK and no OTLP exporter of its own, so
there is no `management.otlp` block in `application.yml`. The Java Agent owns
the SDK and is the only exporter. What `application.yml` does configure for
this layer is whether prompt and completion content is included in the
observations:

```yaml showLineNumbers title="src/main/resources/application.yml"
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics

spring:
  ai:
    chat:
      observations:
        include-input: false
        include-output: false
```

Setting `include-input` and `include-output` to `false` prevents prompt and
completion content from being recorded in Micrometer observation spans. This is
a production safety default - prompt content may contain PII. If you need
content capture for debugging, the manual OTel layer (Layer 3) provides
PII-scrubbed content recording controlled by the
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable.

Two beans connect Spring's observability to the agent, both in
`config/OpenTelemetryConfig.java`. The first publishes
`GlobalOpenTelemetry.get()` - the instance the agent installs - as the
`OpenTelemetry` bean, so the Micrometer tracing bridge writes into the
agent's tracer. Spring Boot's own tracing auto-configuration needs an SDK on
the classpath to build a tracer, does not find one, and backs off, which is
what leaves room for this. The second bridges Micrometer meters, including
Spring AI's token usage, onto the agent through
`OpenTelemetryMeterRegistry` from the
`io.opentelemetry.instrumentation:opentelemetry-micrometer-1.5` artifact:

```java showLineNumbers title="src/main/java/com/example/support/config/OpenTelemetryConfig.java"
@Bean
OpenTelemetry openTelemetry() {
    return GlobalOpenTelemetry.get();
}

@Bean
MeterRegistry meterRegistry(OpenTelemetry openTelemetry) {
    MeterRegistry registry = OpenTelemetryMeterRegistry.builder(openTelemetry).build();
    registry.config().meterFilter(MeterFilter.deny(id ->
        id.getName().startsWith("jvm.")
            || id.getName().startsWith("process.")
            || id.getName().startsWith("system.")
            || id.getName().startsWith("disk.")));
    return registry;
}

@Bean
Tracer micrometerTracer(OpenTelemetry openTelemetry, OtelCurrentTraceContext currentTraceContext) {
    return new OtelTracer(openTelemetry.getTracer(SCOPE), currentTraceContext, event -> { });
}
```

The `MeterFilter.deny` is not cosmetic. The agent already reports JVM,
process, system and disk metrics under those names; without the filter,
Micrometer's binders report the same series again and every value doubles.

### Layer 3: Manual OTel API (GenAI Semantic Conventions)

Direct use of the injected `Tracer` and `Meter`, through the shared
`Telemetry` component, adds the telemetry that Spring AI's own observation
does not produce: cost, retry/fallback/error counters, and pipeline
orchestration spans that give business context to traces. Spring AI's
`ChatModel` observation is still the only reason the `chat {model}` span
exists - Layer 3 supplies the convention and the Micrometer `ObservationHandler`
that build and tag that span, rather than opening a competing one.

What it captures:

- **Span creation and enrichment for chat, embeddings and tool calls** -
  `GenAiChatObservationConvention` replaces `gen_ai.system` with
  `gen_ai.provider.name` in the attributes Spring AI tags onto the span;
  `GenAiTracingObservationHandler`, a Micrometer `ObservationHandler` at
  `HIGHEST_PRECEDENCE`, creates the span itself with `SpanKind.CLIENT`, adds
  the typed token, finish-reason and `base14.gen_ai.cost_usd` attributes, and
  records the gated content-capture event
- **Custom GenAI metrics** - operation duration histograms, cost counters,
  retry counters, fallback counters, and error counters, recorded
  independently of the span through the `Meter` API
- **Domain-specific pipeline spans** - `support_conversation`,
  `classify_intent`, `retrieval kb_articles`, `generate_response` and
  `escalation_check`. The three stage spans carry `base14.support.stage`;
  `retrieval kb_articles` carries `gen_ai.data_source.id` instead, and the
  chat span carries neither

Why this layer is needed: Spring AI's default convention already sets the
standard GenAI attributes (operation name, provider, model, tokens, finish
reason) on its own `chat {model}` span. It has no way to know your pricing
table or your pipeline's business context, so Layer 3 supplies a custom
observation convention for cost and adds separate spans and metrics for
everything else.

The tracer and meter come from a single shared component that every
instrumented class injects, rather than each class calling a static
accessor:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/Telemetry.java"
@Component
public class Telemetry {

    private static final String SCOPE = "ai-customer-support";

    private final Tracer tracer;
    private final Meter meter;

    public Telemetry(OpenTelemetry openTelemetry) {
        this.tracer = openTelemetry.getTracer(SCOPE);
        this.meter = openTelemetry.getMeter(SCOPE);
    }

    public Tracer tracer() {
        return tracer;
    }

    public Meter meter() {
        return meter;
    }
}
```

Spring's OpenTelemetry starter auto-configures the `OpenTelemetry` bean that
`Telemetry` wraps; the Java Agent populates the SDK it points to at startup.

### How the Layers Compose

The three layers compose through OpenTelemetry's context propagation. The Java
Agent creates the outermost HTTP server span and propagates the trace context to
all child operations. When Spring AI's Micrometer-bridged observations start,
they pick up the current trace context and create the `chat {model}` and
`embeddings {model}` spans as children. The pipeline's own
`tracer.spanBuilder()` calls, for `support_conversation` and the stage spans,
also inherit the current context. The result is a single trace where Layer 1
provides the HTTP and database frame, Layer 2 provides the chat and embeddings
spans, and Layer 3 enriches those spans with the attributes Spring AI does not
set and adds pipeline spans and custom metrics. No explicit context passing is
needed between layers - `Span.current()` and `span.makeCurrent()` handle the
composition automatically.

## Installation

Add the following dependencies to your `build.gradle`. The project uses Spring
Boot 4.0.7 with the Spring AI BOM for version management:

```groovy showLineNumbers title="build.gradle"
plugins {
    id 'java'
    id 'checkstyle'
    id 'org.springframework.boot' version '4.0.7'
    id 'io.spring.dependency-management' version '1.1.7'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

// Spring Boot 4.0.7 manages OpenTelemetry 1.55.0; 1.62.0 fixes GHSA-rcgg-9c38-7xpx
ext['opentelemetry.version'] = '1.65.0'

dependencyManagement {
    imports {
        mavenBom "org.springframework.ai:spring-ai-bom:2.0.0"
    }
}

dependencies {
    // Web (reactive)
    implementation 'org.springframework.boot:spring-boot-starter-webflux'

    // Observability. The OpenTelemetry Java agent is the only exporter: the app
    // supplies no SDK and no OTLP exporter of its own.
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-tracing-bridge-otel'
    implementation 'io.opentelemetry:opentelemetry-api'
    implementation 'io.opentelemetry.instrumentation:opentelemetry-micrometer-1.5:2.31.1-alpha'

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
  AI's Micrometer observations to OpenTelemetry. `opentelemetry-micrometer-1.5`
  supplies `OpenTelemetryMeterRegistry`, which publishes Micrometer meters
  through the agent. `opentelemetry-api` provides the manual tracer/meter API
  for Layer 3. There is no `opentelemetry-exporter-otlp` and no OpenTelemetry
  SDK: the agent owns both.
- **Spring AI providers**: Each `spring-ai-starter-model-{provider}` dependency
  brings in the ChatModel implementation for that provider. You can include
  multiple providers for fallback support.
- **Spring AI BOM**: The `spring-ai-bom:2.0.0` import manages version
  alignment across all Spring AI dependencies.
- **Dual database drivers**: R2DBC for reactive conversation persistence, JDBC
  for pgvector RAG and Spring AI tool methods (which use `JdbcTemplate`).

The OpenTelemetry Java Agent is not a Gradle dependency - it is downloaded
separately and attached via the `-javaagent` JVM flag. The Dockerfile handles
this automatically by downloading the agent JAR from the
[OpenTelemetry Java Agent releases](https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases)
page. For local development without Docker, download the JAR manually and pass
it as a JVM argument:

```bash showLineNumbers title="Local development agent setup"
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.31.1/opentelemetry-javaagent.jar

java -javaagent:opentelemetry-javaagent.jar \
  -jar build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar
```

## Spring AI OpenTelemetry Configuration

This section covers every configuration surface in the application: the
Actuator and observation settings in `application.yml`, provider-specific
Spring AI configuration, application properties for LLM routing, and the
provider resolution logic that maps configuration strings to Spring AI bean
names.

### Spring Boot OpenTelemetry Configuration

Export is configured on the agent, not in `application.yml`. Set
`OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_TRACES_SAMPLER` as environment
variables and the agent applies them to traces, metrics and logs alike. The
`management:` block only controls Actuator, and `spring.ai.chat.observations`
only controls content capture:

```yaml showLineNumbers title="src/main/resources/application.yml"
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics

spring:
  ai:
    chat:
      observations:
        include-input: false
        include-output: false
```

- **`management.endpoints.web.exposure.include`** - Exposes Actuator endpoints
  for health checks, application info, and Micrometer metrics. These are useful
  for Kubernetes liveness/readiness probes and debugging metric registration.
- **`spring.ai.chat.observations.include-input`** and **`include-output`** -
  Keep prompt and completion text out of the Micrometer observations. Leave
  both `false`; Layer 3 records scrubbed content instead, and only when
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
- **Sampling** - Use the agent's `OTEL_TRACES_SAMPLER` and
  `OTEL_TRACES_SAMPLER_ARG`, or the Collector's tail-sampling processor. The
  example leaves the agent's default parent-based always-on sampler in place.

### Provider Configuration

Spring AI auto-configures a ChatModel bean for each provider that has a starter
dependency on the classpath. Each provider gets its own configuration block
under `spring.ai` in `application.yml`. The application supports Ollama,
OpenAI and Anthropic. Ollama is the default; pick another by setting
`LLM_PROVIDER` and the matching API key.

<div class="mdx-code-block">
<Tabs>
<TabItem value="ollama" label="Ollama" default>

```yaml showLineNumbers title="src/main/resources/application.yml"
spring:
  ai:
    ollama:
      base-url: ${OLLAMA_BASE_URL:http://localhost:11434}
      chat:
        # Reasoning models otherwise spend the whole token budget on thinking and
        # return empty content.
        think: ${OLLAMA_THINK:false}
        options:
          model: ${LLM_MODEL_CAPABLE:qwen3.5:9B}
      embedding:
        options:
          model: ${EMBEDDING_MODEL:embeddinggemma}
    vectorstore:
      pgvector:
        index-type: HNSW
        distance-type: COSINE_DISTANCE
        dimensions: ${EMBEDDING_DIMENSIONS:768}
        initialize-schema: false
```

Ollama is the default provider, reached at `OLLAMA_BASE_URL`. Keep
`think: false`: with thinking on, `qwen3.5:9B` spends the whole token budget
reasoning and returns empty content, which shows up as a chat span with output
tokens and no completion. `embeddinggemma` produces 768-dimension vectors,
which is what the pgvector column is sized for.

To run without a local Ollama on the host, start the bundled one with
`docker compose --profile ollama up -d`.

</TabItem>
<TabItem value="openai" label="OpenAI">

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

Select OpenAI with `LLM_PROVIDER=openai` and set `OPENAI_API_KEY`. The
`chat.options.model` sets the default model for ChatModel calls - this can be
overridden per-request via `ChatOptions.builder()`. The
`embedding.options.model` configures the embedding model used by the pgvector
VectorStore for RAG retrieval. `text-embedding-3-small` is 1536-dimensional,
so set `EMBEDDING_DIMENSIONS=1536` and re-embed the knowledge base when you
switch to it.

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

Select Anthropic with `LLM_PROVIDER=anthropic` and set `ANTHROPIC_API_KEY`.
Anthropic does not provide an embedding model through Spring AI, so
`EMBEDDING_PROVIDER` stays on Ollama or OpenAI even when Anthropic is the
primary chat provider.

</TabItem>
<TabItem value="ollama-profile" label="Ollama profile">

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
```

The `ollama` profile does one thing: it switches off the OpenAI and Anthropic
auto-configurations so the app starts without their API keys. Models and
dimensions stay in `application.yml`, which already defaults to Ollama.
Activate the profile with `SPRING_PROFILES_ACTIVE=ollama`, which is what
`.env.example` ships.

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
    provider: ${LLM_PROVIDER:ollama}
    model-capable: ${LLM_MODEL_CAPABLE:qwen3.5:9B}
    model-fast: ${LLM_MODEL_FAST:qwen3.5:9B}
    fallback-provider: ${FALLBACK_PROVIDER:ollama}
    fallback-model: ${FALLBACK_MODEL:qwen3.5:9B}
    max-tokens: ${DEFAULT_MAX_TOKENS:1024}
    temperature: ${DEFAULT_TEMPERATURE:0.3}
```

- **`provider`** - The primary LLM provider (`ollama`, `openai`, or
  `anthropic`). Determines which ChatModel bean is used for all LLM calls.
- **`model-capable`** - The high-quality model used for response generation and
  complex tasks. Maps to `config.modelCapable()` in Java.
- **`model-fast`** - The faster, cheaper model used for intent classification
  and simple tasks. Maps to `config.modelFast()` in Java.
- **`fallback-provider`** / **`fallback-model`** - The provider and model to use
  when the primary provider fails after all retries are exhausted. The
  defaults point back at Ollama, so an all-local run still exercises the
  fallback path.
- **`max-tokens`** / **`temperature`** - Default generation parameters applied
  to every LLM call via `ChatOptions`.

### Provider Resolution

The `Providers` class resolves the provider string from configuration to the
correct Spring AI `ChatModel` bean, and separately supplies the
`server.address`/`server.port` values `GenAiTracingObservationHandler` puts on
every chat and embeddings span:

```java showLineNumbers title="src/main/java/com/example/support/llm/Providers.java"
@Component
public class Providers {

    private static final Map<String, String> SERVERS = Map.of(
        "openai", "api.openai.com",
        "anthropic", "api.anthropic.com"
    );

    private static final Map<String, Long> PORTS = Map.of(
        "openai", 443L,
        "anthropic", 443L
    );

    private final String ollamaHost;
    private final long ollamaPort;

    public Providers(@Value("${spring.ai.ollama.base-url:http://localhost:11434}") String ollamaBaseUrl) {
        URI uri = URI.create(ollamaBaseUrl);
        this.ollamaHost = uri.getHost() != null ? uri.getHost() : "localhost";
        this.ollamaPort = uri.getPort() > 0 ? uri.getPort() : 11434;
    }

    public String serverAddress(String provider) {
        if ("ollama".equals(provider)) {
            return ollamaHost;
        }
        return SERVERS.getOrDefault(provider, "unknown");
    }

    public long serverPort(String provider) {
        if ("ollama".equals(provider)) {
            return ollamaPort;
        }
        return PORTS.getOrDefault(provider, 443L);
    }

    public static ChatModel chatModel(String provider, Map<String, ChatModel> chatModels) {
        String beanName = switch (provider) {
            case "openai" -> "openAiChatModel";
            case "anthropic" -> "anthropicChatModel";
            case "ollama" -> "ollamaChatModel";
            default -> throw new IllegalArgumentException("Unknown LLM provider: " + provider);
        };
        ChatModel model = chatModels.get(beanName);
        if (model == null) {
            throw new IllegalStateException(
                "ChatModel bean '" + beanName + "' not found. Available: " + chatModels.keySet());
        }
        return model;
    }
}
```

`SERVERS` and `PORTS` only list `openai` and `anthropic` - `ollama` resolves
its host and port dynamically from `spring.ai.ollama.base-url` instead of a
static map, since a local Ollama instance is not reachable at a fixed public
address. The class Javadoc states the provider key doubles as the
`gen_ai.provider.name` value for every provider this example supports; adding
a provider not in that list (see
[the Gemini FAQ answer](#how-do-i-add-a-new-llm-provider-eg-google-gemini))
means adding it to `SERVERS`/`PORTS` and to the `chatModel()` switch. The
static `chatModel()` factory maps the provider string (`"openai"`,
`"anthropic"`, `"ollama"`) to the Spring AI bean name (`"openAiChatModel"`,
`"anthropicChatModel"`, `"ollamaChatModel"`). If the provider string does not
match any known provider, it throws an `IllegalArgumentException`. If the bean
exists but was not auto-configured (for example, missing API key), it throws
an `IllegalStateException` listing the available beans for debugging.

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

SPRING_PROFILES_ACTIVE=ollama
LLM_PROVIDER=ollama
LLM_MODEL_CAPABLE=qwen3.5:9B
LLM_MODEL_FAST=qwen3.5:9B
FALLBACK_PROVIDER=ollama
FALLBACK_MODEL=qwen3.5:9B
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_THINK=false
EMBEDDING_MODEL=embeddinggemma
EMBEDDING_DIMENSIONS=768
DEFAULT_TEMPERATURE=0.3
DEFAULT_MAX_TOKENS=1024

OPENAI_API_KEY=
ANTHROPIC_API_KEY=

OTEL_SERVICE_NAME=ai-customer-support
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false

SCOUT_CLIENT_ID=
SCOUT_CLIENT_SECRET=
SCOUT_TOKEN_URL=
SCOUT_ENDPOINT=
SCOUT_ENVIRONMENT=
```

Copy it to `.env` and fill in the Scout values from your tenant. The API key
lines stay blank unless you switch `LLM_PROVIDER` away from `ollama`.

The `OTEL_*` variables are read by the Java Agent, which is the only exporter.
`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` makes the agent's
own GenAI instrumentation emit the current attribute names rather than the
older `gen_ai.system` form, matching what Layers 2 and 3 emit.
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` gates prompt and
completion capture and is also read directly by `LlmService`. Nothing in
`application.yml` reads these; Spring Boot's own OTLP export is not in use.

## Custom LLM Instrumentation

This section covers the core GenAI span creation in `LlmService` - the Layer 3
manual instrumentation that adds OpenTelemetry GenAI semantic convention
attributes, error classification, and content capture to every LLM call.

### The GenAI Span

Spring AI 2.0.0's `ChatModel` observation is what makes the `chat {model}`
span exist for every `chatModel.call()` invocation (see
[Layer 2](#layer-2-spring-ai-observations-micrometer-bridge)). `LlmService`
does not open its own span for the LLM call. Two components, registered as
Spring beans, take over building and tagging that span: a
`ChatModelObservationConvention` that supplies the KeyValues Spring AI tags
onto the span, and a Micrometer `ObservationHandler` that creates the span
itself and adds the attributes that need real types instead of strings.

**GenAiChatObservationConvention** extends Spring AI's own
`DefaultChatModelObservationConvention`. Spring AI 2.0.0 still emits the
deprecated `gen_ai.system` attribute by default, so this convention replaces
it with `gen_ai.provider.name`, and drops the token counts and finish reasons
from its high-cardinality output because the handler below sets those as typed
span attributes instead of tags:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiChatObservationConvention.java"
@Component
public class GenAiChatObservationConvention extends DefaultChatModelObservationConvention {

    private static final Set<String> TYPED_ON_SPAN = Set.of(
        GenAi.USAGE_INPUT_TOKENS, GenAi.USAGE_OUTPUT_TOKENS, GenAi.RESPONSE_FINISH_REASONS);

    @Override
    public KeyValues getLowCardinalityKeyValues(ChatModelObservationContext context) {
        return KeyValues.of(
            KeyValue.of(GenAi.OPERATION_NAME, context.getOperationMetadata().operationType()),
            KeyValue.of(GenAi.PROVIDER_NAME, context.getOperationMetadata().provider()),
            requestModel(context),
            responseModel(context));
    }

    @Override
    public KeyValues getHighCardinalityKeyValues(ChatModelObservationContext context) {
        List<KeyValue> kept = super.getHighCardinalityKeyValues(context)
            .stream()
            .filter(keyValue -> !TYPED_ON_SPAN.contains(keyValue.getKey()))
            .toList();
        return KeyValues.of(kept.toArray(new KeyValue[0]));
    }
}
```

`requestModel()` and `responseModel()` are inherited from
`DefaultChatModelObservationConvention` - the override only replaces the
provider attribute and filters what becomes a tag.

**GenAiTracingObservationHandler** is a Micrometer `ObservationHandler`
registered at `Ordered.HIGHEST_PRECEDENCE`, so it runs ahead of Micrometer
Tracing's own `DefaultTracingObservationHandler` and takes over span creation
for chat, embedding, and tool-calling observations:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiTracingObservationHandler.java"
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class GenAiTracingObservationHandler extends DefaultTracingObservationHandler {

    @Override
    public boolean supportsContext(Observation.Context context) {
        return context instanceof ChatModelObservationContext
            || context instanceof EmbeddingModelObservationContext
            || context instanceof ToolCallingObservationContext;
    }

    @Override
    public void onStart(Observation.Context context) {
        io.micrometer.tracing.Span parent = getParentSpan(context);
        io.micrometer.tracing.Span.Builder builder = getTracer().spanBuilder().name(getSpanName(context));
        if (!(context instanceof ToolCallingObservationContext)) {
            builder = builder.kind(io.micrometer.tracing.Span.Kind.CLIENT);
        }
        if (parent != null) {
            builder = builder.setParent(parent.context());
        }
        io.micrometer.tracing.Span span = builder.start();
        getTracingContext(context).setSpan(span);
        applyStartAttributes(context, otel(span));
    }

    @Override
    public void onStop(Observation.Context context) {
        if (context instanceof ChatModelObservationContext chat) {
            applyResponseAttributes(chat, otel(getRequiredSpan(context)));
        }
        super.onStop(context);
    }

    @Override
    public void onError(Observation.Context context) {
        Throwable error = context.getError();
        if (error != null) {
            otel(getRequiredSpan(context)).setAttribute(GenAi.ERROR_TYPE, error.getClass().getSimpleName());
        }
        super.onError(context);
    }

    private static Span otel(io.micrometer.tracing.Span span) {
        return span instanceof OtelSpan ? OtelSpan.toOtel(span) : Span.getInvalid();
    }
}
```

`onStart` builds the span with `SpanKind.CLIENT` (tool-call spans are the one
exception), then calls `applyStartAttributes()` to set `gen_ai.agent.name`,
`gen_ai.conversation.id`, and `server.address`/`server.port`. `onStop` calls
`applyResponseAttributes()`, which reads the actual token usage and finish
reasons off the `ChatResponse`, sets them as typed attributes, computes cost
through `Pricing.calculateCost()`, records it as both
`base14.gen_ai.cost_usd` and a `base14.gen_ai.cost` counter, and - only when
content capture is enabled - adds the gated inference event:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiTracingObservationHandler.java"
private void applyResponseAttributes(ChatModelObservationContext context, Span span) {
    ChatResponse response = context.getResponse();
    if (response == null) {
        return;
    }

    Usage usage = response.getMetadata().getUsage();
    long inputTokens = usage != null && usage.getPromptTokens() != null ? usage.getPromptTokens() : 0;
    long outputTokens = usage != null && usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0;
    span.setAttribute(GenAi.USAGE_INPUT_TOKENS, inputTokens);
    span.setAttribute(GenAi.USAGE_OUTPUT_TOKENS, outputTokens);

    List<String> finishReasons = response.getResults().stream()
        .map(generation -> generation.getMetadata().getFinishReason())
        .filter(reason -> reason != null && !reason.isBlank())
        .toList();
    if (!finishReasons.isEmpty()) {
        span.setAttribute(AttributeKey.stringArrayKey(GenAi.RESPONSE_FINISH_REASONS), finishReasons);
    }

    String model = responseModel(context, response);
    double cost = pricing.calculateCost(model, (int) inputTokens, (int) outputTokens);
    span.setAttribute(GenAi.COST_USD, cost);
    costCounter.add(cost, Attributes.of(
        AttributeKey.stringKey(GenAi.OPERATION_NAME), context.getOperationMetadata().operationType(),
        AttributeKey.stringKey(GenAi.PROVIDER_NAME), context.getOperationMetadata().provider(),
        AttributeKey.stringKey(GenAi.REQUEST_MODEL), model));

    if (captureContent) {
        span.addEvent(GenAi.INFERENCE_DETAILS_EVENT, contentAttributes(context, response));
    }
}
```

`Pricing` (`src/main/java/com/example/support/llm/Pricing.java`) loads a
pricing table and exposes `calculateCost(String model, int inputTokens, int
outputTokens)` - it is a plain `@Component`, not a `PricingService`. Note that
`applyResponseAttributes()` never touches `base14.support.stage`: that attribute
belongs to the pipeline-stage spans (`classify_intent`, `escalation_check`,
`generate_response`), which each set it on their own span through
`IntentClassifier`, `EscalationRouter`, and `ResponseGenerator` - the chat span
never carries it.

`otel(span)` bridges from Micrometer's `Span` abstraction to the real OTel
`io.opentelemetry.api.trace.Span` (via `OtelSpan.toOtel()`), which is what lets
`applyStartAttributes()` and `applyResponseAttributes()` call
`setAttribute()`/`addEvent()` directly - the real OTel API, not a Micrometer
`Observation` method.

### Error Handling on Spans

When an LLM call fails, Spring AI's chat observation stops with an error.
`GenAiTracingObservationHandler.onError()` sets `error.type` on the span
before delegating to `DefaultTracingObservationHandler.onError()`, which
records the exception and marks the span `ERROR`. `LlmService` never touches
span status directly - it owns the metrics around the call instead.

`generateOnce()` records `gen_ai.client.operation.duration` on both success
and failure, adding `error.type` only in the failure branch:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
} catch (Exception e) {
    operationDuration.record(elapsedSeconds(start), Attributes.of(
        AttributeKey.stringKey(GenAi.OPERATION_NAME), "chat",
        AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
        AttributeKey.stringKey(GenAi.REQUEST_MODEL), model,
        AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType(e)));
    throw e;
}
```

`generateWithRetry()` calls `generateOnce()` in a loop and records
`base14.gen_ai.retry.count` before each retry, then `base14.gen_ai.error.count`
once every attempt for that provider has failed:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
} catch (Exception e) {
    lastError = e;
    if (attempt < MAX_ATTEMPTS - 1) {
        retryCounter.add(1, Attributes.builder()
            .put(GenAi.PROVIDER_NAME, provider)
            .put(GenAi.ERROR_TYPE, errorType(e))
            .put(GenAi.RETRY_ATTEMPT, attempt + 1L)
            .build());
        sleep(backoffWithJitter(attempt));
    }
}
// after the loop, once MAX_ATTEMPTS is exhausted:
errorCounter.add(1, Attributes.of(
    AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
    AttributeKey.stringKey(GenAi.REQUEST_MODEL), model,
    AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType(lastError)));
```

`errorType()` is deliberately simple - it is the exception's own class name,
the same value `GenAiTracingObservationHandler.onError()` puts on the span,
so span attributes and metric labels agree:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
static String errorType(Throwable error) {
    return error != null ? error.getClass().getSimpleName() : "unknown";
}
```

This is lower cardinality than a raw exception message, but it is not a
curated taxonomy - a `WebClientResponseException` and a
`ResourceAccessException` both show up as their Java class name.
`generate()` covers the provider-fallback case: when every retry for the
primary provider fails, it records `base14.gen_ai.fallback.count` and a
`provider_fallback` event on the parent conversation span before calling the
fallback provider.

### Span Events (Content Capture)

A single `gen_ai.client.inference.operation.details` event carries prompt and
completion content on the `chat {model}` span. Content capture is gated behind
the `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable
and is disabled by default. `GenAiTracingObservationHandler` reads it as a
constructor-injected `@Value`, and `applyResponseAttributes()` (shown above)
only calls `contentAttributes()` when it is `true`:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiTracingObservationHandler.java"
public GenAiTracingObservationHandler(
    Tracer tracer, Telemetry telemetry, Pricing pricing, Providers providers,
    ConversationScope conversations, PiiFilter piiFilter,
    @Value("${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:false}") boolean captureContent
) {
    super(tracer);
    // ... assigns pricing, providers, conversations, piiFilter, captureContent ...
}

private Attributes contentAttributes(ChatModelObservationContext context, ChatResponse response) {
    List<Message> messages = context.getRequest().getInstructions();
    String system = joinText(messages, true);
    String input = joinText(messages, false);
    String output = response.getResults().stream()
        .map(generation -> generation.getOutput().getText())
        .filter(text -> text != null && !text.isBlank())
        .collect(Collectors.joining("\n"));

    AttributesBuilder attributes = Attributes.builder()
        .put(GenAi.INPUT_MESSAGES, truncate(piiFilter.scrub(input), INPUT_MAX_CHARS))
        .put(GenAi.OUTPUT_MESSAGES, truncate(piiFilter.scrub(output), OUTPUT_MAX_CHARS));
    if (!system.isBlank()) {
        attributes.put(GenAi.SYSTEM_INSTRUCTIONS, truncate(piiFilter.scrub(system), SYSTEM_MAX_CHARS));
    }
    return attributes.build();
}
```

`joinText()` splits the request's `Instructions` into system and non-system
text by `MessageType`, and the resulting event is added with the real OTel
`span.addEvent(GenAi.INFERENCE_DETAILS_EVENT, contentAttributes(...))` - not a
Micrometer `Observation` call, because `span` here is already the OTel span
returned by `otel()`.

One event captures the whole exchange:

| Event Name | Attribute | Content | Max Length |
| --- | --- | --- | --- |
| `gen_ai.client.inference.operation.details` | `gen_ai.input.messages` | User input | 1000 chars |
| `gen_ai.client.inference.operation.details` | `gen_ai.system_instructions` | System prompt | 500 chars |
| `gen_ai.client.inference.operation.details` | `gen_ai.output.messages` | LLM response | 2000 chars |

This is the only event that can carry content. Five others carry no text and
are always on: `gen_ai.evaluation.result` from the PII scan and the escalation
check, `tool_execution_failed` when a tool returns an error,
`rag_retrieval_degraded` when retrieval fails and the turn continues,
`provider_fallback` when the primary provider is exhausted, and
`tool_loop_limit_reached` when the tool loop hits `MAX_TOOL_ROUNDS`. Each is
covered in the section that emits it.

Two safety measures protect sensitive data in the event:

1. **PII filtering** - Input, output, and system instructions all pass through
   `piiFilter.scrub()` before recording. This replaces patterns like email
   addresses, phone numbers, and credit card numbers with redaction markers.
   Nothing is exempt, including the system prompt, since it can still
   reference user-supplied context injected earlier in the pipeline.
2. **Truncation** - All content is truncated to prevent the event from
   becoming excessively large. User input is capped at 1000 characters, system
   instructions at 500, and the response at 2000. These limits balance
   debuggability with storage costs. `gen_ai.system_instructions` is omitted
   entirely when there is no system prompt.

Content capture is off by default for good reason: prompt content may contain
PII, proprietary data, or information subject to compliance requirements (GDPR,
HIPAA, SOC 2). Enable it only in environments where content inspection is
appropriate - development, staging, or production with explicit data handling
agreements. Set the environment variable in your deployment:

```bash showLineNumbers
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

### GenAI Semantic Conventions Reference

The following table summarizes all GenAI attributes set on `chat` spans.
These follow the
[OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/).
`gen_ai.provider.name` comes from the custom `GenAiChatObservationConvention`,
which replaces Spring AI's deprecated `gen_ai.system`; the typed
`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and
`gen_ai.response.finish_reasons` come from `GenAiTracingObservationHandler`,
not from Spring AI's default convention, because the custom convention
filters them out of its KeyValues so the handler can set them with the
correct types instead of strings:

| Attribute | Example Value | Source |
| --- | --- | --- |
| `gen_ai.operation.name` | `"chat"` | `GenAiChatObservationConvention` |
| `gen_ai.provider.name` | `"openai"` | `GenAiChatObservationConvention` (replaces `gen_ai.system`) |
| `gen_ai.request.model` | `"gpt-4.1"` | `GenAiChatObservationConvention` |
| `gen_ai.request.temperature` | `0.3` | Spring AI default convention (kept via `super` call) |
| `gen_ai.request.max_tokens` | `1024` | Spring AI default convention (kept via `super` call) |
| `gen_ai.response.model` | `"gpt-4.1"` | `GenAiChatObservationConvention` |
| `gen_ai.usage.input_tokens` | `150` | `GenAiTracingObservationHandler` (typed span attribute) |
| `gen_ai.usage.output_tokens` | `380` | `GenAiTracingObservationHandler` (typed span attribute) |
| `gen_ai.response.finish_reasons` | `["stop"]` | `GenAiTracingObservationHandler` (typed string array) |
| `base14.gen_ai.cost_usd` | `0.00234` | `GenAiTracingObservationHandler` |
| `server.address` | `"api.openai.com"` | `GenAiTracingObservationHandler` (via `Providers`) |
| `server.port` | `443` | `GenAiTracingObservationHandler` (via `Providers`) |
| `error.type` | `"WebClientResponseException"` | `GenAiTracingObservationHandler.onError()` (exception class name) |

`base14.support.stage` is not on this table because it never appears on the chat
span - it belongs to the pipeline-stage spans (`classify_intent`,
`escalation_check`, `generate_response`) covered under
[Pipeline Observability](#pipeline-observability). `GenAiTracingObservationHandler`
sets `SpanKind.CLIENT` on both the chat span and the `embeddings {model}` span
it creates for `EmbeddingModelObservationContext`; the one exception is the
tool-calling span, which `onStart()` leaves at the builder's default kind.
Token counts are read once per call, straight off the `ChatResponse`, and set
as the typed span attributes above; this example does not add a separate
token-usage metric alongside them.

## Token and Cost Tracking

Token usage and cost are central to LLM observability. Unlike traditional API
calls where cost is roughly proportional to request count, LLM costs scale with
token consumption - a single request can cost 100x more than another depending
on prompt length and response size. This section covers how the application
defines GenAI metrics, calculates cost from a pricing table, and records both
metrics and span attributes for every LLM call.

### GenAI Metrics Definition

Four metrics are defined in the `LlmService` constructor, through
`Telemetry.meter()`, plus a fifth - the cost counter - defined in
`GenAiTracingObservationHandler`. All of them use the `GenAi` constants class
rather than string literals for their names:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
var meter = telemetry.meter();
this.operationDuration = meter.histogramBuilder(GenAi.OPERATION_DURATION_METRIC)
    .setUnit("s")
    .setDescription("Duration of GenAI operations")
    .build();
this.retryCounter = meter.counterBuilder(GenAi.RETRY_METRIC)
    .setUnit("{retry}")
    .setDescription("Retry attempts, excluding the initial attempt")
    .build();
this.fallbackCounter = meter.counterBuilder(GenAi.FALLBACK_METRIC)
    .setUnit("{fallback}")
    .setDescription("Number of fallback triggers")
    .build();
this.errorCounter = meter.counterBuilder(GenAi.ERROR_METRIC)
    .setUnit("{error}")
    .setDescription("Number of LLM call errors by type")
    .build();
```

There is no token-usage histogram in this app - token counts are only ever
set as typed span attributes by `GenAiTracingObservationHandler`, not
recorded as a separate metric. Each of the five metrics serves a specific
observability purpose:

- **`gen_ai.client.operation.duration`** - Histogram of LLM call duration in
  seconds, recorded on both success and failure in `generateOnce()`. Captures
  end-to-end latency including network round-trip and model inference. Use
  this to track model performance degradation over time.
- **`base14.gen_ai.cost`** - Monotonic double counter of estimated cost in
  USD, recorded by `GenAiTracingObservationHandler` alongside the
  `base14.gen_ai.cost_usd` span attribute. Use this for real-time cost
  dashboards and budget alerting.
- **`base14.gen_ai.retry.count`** - Counter of retry attempts, incremented in
  `generateWithRetry()` before each retry (not after the final attempt). A
  rising retry rate signals provider instability.
- **`base14.gen_ai.fallback.count`** - Counter of fallback activations,
  incremented in `generate()` when the primary provider fails all retries and
  the application switches to the fallback provider.
- **`base14.gen_ai.error.count`** - Counter of LLM call errors, incremented
  once in `generateWithRetry()` after every attempt for a provider has
  failed. Carries `error.type` as a label - the failing exception's simple
  class name, not a curated category.

### Metrics Reference

| Metric Name | Type | Unit | Labels | Recorded In |
| --- | --- | --- | --- | --- |
| `gen_ai.client.operation.duration` | Histogram | `s` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `error.type` (on failure) | `generateOnce()` |
| `base14.gen_ai.cost` | DoubleCounter | `usd` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` | `GenAiTracingObservationHandler` |
| `base14.gen_ai.retry.count` | LongCounter | `{retry}` | `gen_ai.provider.name`, `error.type`, `base14.retry.attempt` | `generateWithRetry()` |
| `base14.gen_ai.fallback.count` | LongCounter | `{fallback}` | `gen_ai.provider.name`, `base14.gen_ai.fallback.provider` | `generate()` |
| `base14.gen_ai.error.count` | LongCounter | `{error}` | `gen_ai.provider.name`, `gen_ai.request.model`, `error.type` | `generateWithRetry()` |

### Cost Calculation

The `Pricing` class loads per-million-token rates from the classpath
`pricing.json` once, in its constructor, and calculates per-call costs from
input and output token counts. Models the file does not list cost `0.0`
rather than an assumed rate:

```java showLineNumbers title="src/main/java/com/example/support/llm/Pricing.java"
@Component
public class Pricing {

    private static final Logger log = LoggerFactory.getLogger(Pricing.class);
    private static final double PER_MILLION = 1_000_000.0;
    private static final Pattern DATE_SUFFIX = Pattern.compile("-\\d{4}-\\d{2}-\\d{2}$|-\\d{8}$");
    private static final Pattern DASH_MINOR = Pattern.compile("-(\\d+)-(\\d+)$");

    private final Map<String, ModelPricing> models;

    @JsonIgnoreProperties(ignoreUnknown = true)
    record PricingFile(String version, Map<String, ModelPricing> models) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ModelPricing(String provider, double input, double output) {}

    public Pricing() {
        this.models = load();
    }

    private static Map<String, ModelPricing> load() {
        try (InputStream stream = Pricing.class.getClassLoader().getResourceAsStream("pricing.json")) {
            if (stream == null) {
                log.warn("pricing.json not on the classpath, every model costs 0.0");
                return Map.of();
            }
            PricingFile file = new ObjectMapper().readValue(stream, PricingFile.class);
            log.info("Loaded pricing {} with {} models", file.version(), file.models().size());
            return file.models();
        } catch (IOException e) {
            log.warn("Failed to read pricing.json: {}", e.getMessage());
            return Map.of();
        }
    }

    static String normalizeModel(String model) {
        String stripped = DATE_SUFFIX.matcher(model).replaceAll("");
        return DASH_MINOR.matcher(stripped).replaceAll("-$1.$2");
    }

    public double calculateCost(String model, int inputTokens, int outputTokens) {
        ModelPricing pricing = models.get(model);
        if (pricing == null) {
            pricing = models.get(normalizeModel(model));
        }
        if (pricing == null) {
            return 0.0;
        }
        return (inputTokens * pricing.input() + outputTokens * pricing.output()) / PER_MILLION;
    }

    public boolean hasModel(String model) {
        return models.containsKey(model) || models.containsKey(normalizeModel(model));
    }
}
```

Key design decisions in the pricing implementation:

- **Constructor loading** - Pricing data is loaded once, when the bean is
  constructed, not on every LLM call. This avoids file I/O in the hot path.
- **`normalizeModel()`** - Provider APIs return dated or dash-minor model IDs
  such as `claude-sonnet-4-20250514` or `claude-haiku-4-5`; this strips the
  date suffix and turns a dash-minor version into a dotted one so it matches
  the plain keys in `pricing.json`.
- **No fallback rate** - If a model is not in the pricing table, even after
  normalizing, `calculateCost()` returns `0.0` rather than guessing a rate.
  `base14.gen_ai.cost_usd` reading exactly `0` on a trace is a visible signal
  that a model is missing from `pricing.json`, rather than a plausible-looking
  but wrong number.
- **Per-million pricing** - Rates are stored as dollars per million tokens (the
  standard unit used by LLM providers), and `calculateCost()` divides by
  1,000,000 to produce the actual cost per call.

### How Metrics Are Recorded

Metrics are recorded at three points in the call chain, each capturing a
different aspect of LLM operations.

**Successful and failed calls in `generateOnce()`** - operation duration is
recorded either way; cost is computed once and handed back through
`LlmResponse` rather than recorded as a metric here:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
operationDuration.record(elapsedSeconds(start), Attributes.of(
    AttributeKey.stringKey(GenAi.OPERATION_NAME), "chat",
    AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
    AttributeKey.stringKey(GenAi.REQUEST_MODEL), model));

return new LlmResponse(
    generation.getOutput().getText(), responseModel, provider,
    inputTokens, outputTokens,
    pricing.calculateCost(responseModel, inputTokens, outputTokens), finishReason);
```

This app does not record a separate token-usage histogram in `LlmService` -
token counts come off `usage.getPromptTokens()`/`getCompletionTokens()` here,
and are set again, as typed span attributes, by
`GenAiTracingObservationHandler`.

**Retries in `generateWithRetry()`** - the retry counter fires before each
retry, not after the attempt that finally succeeds or the last attempt that
fails:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
} catch (Exception e) {
    lastError = e;
    if (attempt < MAX_ATTEMPTS - 1) {
        retryCounter.add(1, Attributes.builder()
            .put(GenAi.PROVIDER_NAME, provider)
            .put(GenAi.ERROR_TYPE, errorType(e))
            .put(GenAi.RETRY_ATTEMPT, attempt + 1L)
            .build());
        sleep(backoffWithJitter(attempt));
    }
}
```

**Fallbacks in `generate()`** - the fallback counter and a `provider_fallback`
event on the parent conversation span both fire once the primary provider's
retries are exhausted:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
fallbackCounter.add(1, Attributes.of(
    AttributeKey.stringKey(GenAi.PROVIDER_NAME), config.provider(),
    AttributeKey.stringKey(GenAi.FALLBACK_PROVIDER), config.fallbackProvider()));
conversations.recordOnConversation(GenAi.FALLBACK_EVENT, Attributes.builder()
    .put(GenAi.FALLBACK_TRIGGERED, true)
    .put(GenAi.PROVIDER_NAME, config.provider())
    .put(GenAi.FALLBACK_PROVIDER, config.fallbackProvider())
    .build());
```

`gen_ai.provider.name` on both the counter and the event is the provider that
failed; `base14.gen_ai.fallback.provider` is the one that took over.

**Errors in `generateWithRetry()`** - once every attempt for a provider has
failed, the error counter fires once, using the same `errorType()` helper the
retry counter uses:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
errorCounter.add(1, Attributes.of(
    AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
    AttributeKey.stringKey(GenAi.REQUEST_MODEL), model,
    AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType(lastError)));
```

Cost is recorded in two places - as a span attribute (`base14.gen_ai.cost_usd`)
for per-request visibility in traces, and as a metric counter
(`base14.gen_ai.cost`) for aggregated dashboards and alerting - both set by
`GenAiTracingObservationHandler`, not `LlmService`. The span attribute lets
you see the cost of a single request when investigating a trace. The metric
counter lets you build a real-time cost dashboard that sums cost across all
requests, grouped by provider and model.

## Pipeline Observability

The support pipeline orchestrates six stages - classify intent, retrieve RAG
context, generate response, scrub PII, check escalation, and persist results.
Each stage runs as a child span under a single parent `support_conversation`
span, producing a trace that shows the full request lifecycle with timing and
attributes at every step.

The `SupportPipeline` class is the orchestrator. Its `process()` method handles
the reactive layer (load or create conversation, add user message, fetch
history), then delegates to `runPipeline()` on a bounded elastic scheduler for
the blocking pipeline work. Here is `runPipeline()` - the parent span and the
six-stage flow:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/SupportPipeline.java"
private PipelineResult runPipeline(
    String userMessage, UUID conversationId, List<Message> history
) {
    long startNanos = System.nanoTime();
    Span span = telemetry.tracer().spanBuilder("support_conversation")
        .setAttribute(GenAi.CONVERSATION_ID, conversationId.toString())
        .setAttribute(GenAi.AGENT_NAME, ConversationScope.AGENT_NAME)
        .startSpan();
    conversations.begin(conversationId.toString(), span);

    try (Scope ignored = span.makeCurrent()) {
        // 1. Classify intent (fast model)
        IntentResult intent = intentClassifier.classify(userMessage);
        span.setAttribute("base14.support.intent", intent.intent().name());
        span.setAttribute("base14.support.confidence", intent.confidence());

        // 2. Retrieve RAG context
        var ragDocs = contextRetriever.retrieve(userMessage);
        span.setAttribute("base14.support.rag_matches", ragDocs.size());

        // 3. Generate response (capable model)
        String conversationHistory =
            conversationService.formatHistory(history);
        LlmResponse response = responseGenerator.generate(
            userMessage, intent, ragDocs, conversationHistory);

        // 4. PII scrub, which also emits the pii_scan evaluation event
        String content = piiFilter.evaluate(response.content());

        // 5. Check escalation
        int turns = history.size() / 2 + 1;
        EscalationDecision escalation =
            escalationRouter.evaluate(intent, turns, 0);
        span.setAttribute(
            "base14.support.should_escalate", escalation.shouldEscalate());

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
        span.setAttribute("base14.support.total_turns", (long) turns);
        span.setAttribute("base14.support.total_tokens", (long) totalTokens);
        span.setAttribute("base14.support.total_cost_usd", response.costUsd());

        return new PipelineResult(
            content, intent, escalation,
            response.model(), response.provider(),
            response.inputTokens(), response.outputTokens(),
            response.costUsd(), conversationId);

    } catch (Exception e) {
        span.recordException(e);
        span.setAttribute(GenAi.ERROR_TYPE, e.getClass().getSimpleName());
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw new IllegalStateException("Pipeline failed: " + e.getMessage(), e);

    } finally {
        conversations.end();
        span.end();
    }
}
```

The span lifecycle follows the standard OpenTelemetry pattern: create with
`spanBuilder()`, set initial attributes, make it current with `makeCurrent()`
inside a try-with-resources so child spans automatically parent to it, set
additional attributes as the pipeline progresses, call `setStatus(ERROR)` in the
catch block, and call `end()` in the finally block. The `makeCurrent()` call is
the key - it puts this span on the thread-local context so that every child span
created by `intentClassifier.classify()`, `contextRetriever.retrieve()`, and the
other stages automatically becomes a child of `support_conversation`.

The parent span accumulates summary attributes as each stage completes:
`base14.support.intent` and `base14.support.confidence` after classification,
`base14.support.rag_matches` after retrieval,
`base14.support.should_escalate` after the escalation check, and
`base14.support.total_turns`, `base14.support.total_tokens` and
`base14.support.total_cost_usd` at the end. This means you can filter traces
by intent, escalation status, or token count without expanding the span
tree.

Each pipeline stage creates its own child span with a `base14.support.stage` attribute.
Here are the four stage spans.

**IntentClassifier** - The `classify_intent` span wraps a fast-model LLM call
that returns structured JSON with the detected intent, confidence score,
sub-category, and extracted entities:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/IntentClassifier.java"
public IntentResult classify(String userMessage) {
    Span span = telemetry.tracer().spanBuilder("classify_intent")
        .setAttribute("base14.support.stage", "classify")
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        LlmResponse response = llmService.generateFast(SYSTEM_PROMPT, userMessage);
        IntentResult result = parseResponse(response);

        span.setAttribute("base14.support.intent", result.intent().name());
        span.setAttribute("base14.support.confidence", result.confidence());
        span.setAttribute("base14.support.sub_category", result.subCategory());
        if (!result.entities().isEmpty()) {
            span.setAttribute("base14.support.entities", String.join(",", result.entities()));
        }

        return result;

    } catch (Exception e) {
        span.recordException(e);
        span.setAttribute(GenAi.ERROR_TYPE, e.getClass().getSimpleName());
        span.setStatus(StatusCode.ERROR, e.getMessage());
        return IntentResult.fallback();

    } finally {
        span.end();
    }
}
```

The catch block does three things, in this order: `recordException` attaches
the stack trace as an exception event, `error.type` gives you a low-cardinality
value to group by, and `setStatus(ERROR)` marks the span failed. Classification
then degrades to `IntentResult.fallback()` rather than failing the request, so
the trace shows an errored `classify_intent` span under a successful
`support_conversation`.

The `parseResponse()` method parses the LLM's JSON output, strips any markdown
code fences, and extracts the intent, confidence, sub-category, and entities
fields. If JSON parsing fails (malformed response, unexpected format), it falls
back to `Intent.QUERY` with a confidence of 0.3 and a sub-category of
`"parse_error"` - the pipeline continues with a degraded classification rather
than failing entirely.

**ContextRetriever** - The `retrieval kb_articles` span wraps the vector
similarity search:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ContextRetriever.java"
private static final String DATA_SOURCE_ID = "kb_articles";

public List<Document> retrieve(String userMessage) {
    Span span = telemetry.tracer().spanBuilder("retrieval " + DATA_SOURCE_ID)
        .setSpanKind(SpanKind.CLIENT)
        .setAttribute(GenAi.OPERATION_NAME, "retrieval")
        .setAttribute(GenAi.DATA_SOURCE_ID, DATA_SOURCE_ID)
        .setAttribute(GenAi.AGENT_NAME, ConversationScope.AGENT_NAME)
        .setAttribute(GenAi.CONVERSATION_ID, conversations.conversationId())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        List<Document> results = vectorStore.similaritySearch(
            SearchRequest.builder().query(userMessage).topK(TOP_K).build());

        span.setAttribute("app.retrieval.matches", results.size());
        if (!results.isEmpty()) {
            Double topScore = results.getFirst().getScore();
            if (topScore != null) {
                span.setAttribute("app.retrieval.top_similarity", topScore);
            }
        }
        return results;

    } catch (Exception e) {
        span.recordException(e);
        span.setAttribute(GenAi.ERROR_TYPE, e.getClass().getSimpleName());
        span.setStatus(StatusCode.ERROR, e.getMessage());
        conversations.recordOnConversation(GenAi.RETRIEVAL_DEGRADED_EVENT, Attributes.of(
            AttributeKey.stringKey(GenAi.DATA_SOURCE_ID), DATA_SOURCE_ID,
            AttributeKey.stringKey(GenAi.ERROR_TYPE), e.getClass().getSimpleName()));
        log.error("Knowledge base retrieval failed, continuing without context: {}", e.getMessage());
        return List.of();

    } finally {
        span.end();
    }
}
```

`retrieval kb_articles` is not a pipeline-stage span, so it never carries
`base14.support.stage`; `DATA_SOURCE_ID` supplies `gen_ai.data_source.id`
instead, and the match count and top similarity score are app-specific
attributes under the `app.retrieval.*` namespace. Like the classifier, the
retriever returns an empty list on failure rather than propagating the
exception - the pipeline generates a response without RAG context rather than
failing the entire request. On failure it also records a
`rag_retrieval_degraded` event on the parent `support_conversation` span
(`conversations.recordOnConversation(...)`), not on the retrieval span itself,
because the retrieval span is about to end.

**ResponseGenerator** - The `generate_response` span wraps the capable-model LLM
call that produces the final customer-facing response:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/ResponseGenerator.java"
public LlmResponse generate(String userMessage, IntentResult intent,
                            List<Document> ragContext, String conversationHistory) {
    Span span = telemetry.tracer().spanBuilder("generate_response")
        .setAttribute("base14.support.stage", "generate")
        .setAttribute("base14.support.rag_matches_used", ragContext.size())
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        String historySection = conversationHistory != null && !conversationHistory.isEmpty()
            ? "Previous conversation:\n" + conversationHistory + "\n"
            : "";

        String systemPrompt = SYSTEM_PROMPT_TEMPLATE.formatted(
            intent.intent().name(),
            intent.confidence() * 100,
            contextRetriever.formatContext(ragContext),
            historySection
        );

        return llmService.generateCapable(systemPrompt, userMessage, toolCallbacks);

    } catch (Exception e) {
        span.recordException(e);
        span.setAttribute(GenAi.ERROR_TYPE, e.getClass().getSimpleName());
        span.setStatus(StatusCode.ERROR, e.getMessage());
        throw e;

    } finally {
        span.end();
    }
}
```

Note what this span does not set. Token counts and cost belong to the `chat`
span that Spring AI's observation creates inside `generateCapable()`, and
repeating them here would double-count them in any query that sums over
spans. `generate_response` carries only the stage marker and the RAG context
size, which is set at span creation time so it survives a failed LLM call.

The response generator does not catch-and-continue like the classifier and
retriever - a failed response generation is a hard failure that propagates up
to the parent span after being recorded.

**EscalationRouter** - The `escalation_check` span wraps the rule-based
escalation evaluation:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/EscalationRouter.java"
private static final String EVALUATION_NAME = "escalation_check";

public EscalationDecision evaluate(IntentResult intent, int conversationTurns, int toolErrors) {
    Span span = telemetry.tracer().spanBuilder("escalation_check")
        .setAttribute("base14.support.stage", "route")
        .setAttribute("base14.support.conversation_turns", (long) conversationTurns)
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        EscalationDecision decision = checkTriggers(intent, conversationTurns, toolErrors);

        span.setAttribute("base14.support.should_escalate", decision.shouldEscalate());
        if (decision.shouldEscalate()) {
            span.setAttribute("base14.support.escalation_reason", decision.reason());
            span.setAttribute("base14.support.escalation_priority", decision.priority().name());
        }
        span.addEvent(GenAi.EVALUATION_RESULT_EVENT, evaluationAttributes(intent, decision));

        return decision;

    } finally {
        span.end();
    }
}

private static Attributes evaluationAttributes(IntentResult intent, EscalationDecision decision) {
    AttributesBuilder attributes = Attributes.builder()
        .put(GenAi.EVALUATION_NAME, EVALUATION_NAME)
        .put(GenAi.EVALUATION_SCORE_VALUE, intent.confidence())
        .put(GenAi.EVALUATION_SCORE_LABEL, decision.shouldEscalate() ? "escalate" : "handled");
    if (decision.shouldEscalate()) {
        attributes.put(GenAi.EVALUATION_EXPLANATION, decision.summary());
    }
    return attributes.build();
}
```

The `gen_ai.evaluation.result` event is the part that matters for
observability. The GenAI conventions model any automated judgement about a
model's output as an evaluation event, with `gen_ai.evaluation.name` naming
the check, `gen_ai.evaluation.score.value` as a number and
`gen_ai.evaluation.score.label` as the verdict. Here the name is
`escalation_check`, the score is the classifier's confidence, and the label is
`escalate` or `handled`. Every turn emits one, escalated or not, so the
escalation rate is a count over labels rather than a count of missing events.
`gen_ai.evaluation.explanation` carries the decision summary and is only set
when the turn escalates.

The `checkTriggers()` method evaluates five rules in priority order:

```java showLineNumbers title="src/main/java/com/example/support/pipeline/EscalationRouter.java"
EscalationDecision checkTriggers(
    IntentResult intent, int conversationTurns, int toolErrors
) {
    // Explicit ESCALATE intent - immediate
    if (intent.intent() == Intent.ESCALATE) {
        return EscalationDecision.escalate(
            "explicit_request", EscalationPriority.HIGH,
            "Customer explicitly requested human agent");
    }

    // Complaint + low confidence (< 0.6) - auto-escalate
    if (intent.intent() == Intent.COMPLAINT
        && intent.confidence() < 0.6) {
        return EscalationDecision.escalate(
            "low_confidence_complaint", EscalationPriority.HIGH,
            "Complaint with low classification confidence");
    }

    // 2+ tool errors - escalate with context
    if (toolErrors >= 2) {
        return EscalationDecision.escalate(
            "tool_errors", EscalationPriority.MEDIUM,
            "Multiple tool call failures (" + toolErrors + ")");
    }

    // Low intent confidence (< 0.5) - offer human agent
    if (intent.confidence() < 0.5) {
        return EscalationDecision.escalate(
            "low_confidence", EscalationPriority.LOW,
            "Low intent classification confidence");
    }

    // > 5 turns without resolution - suggest escalation
    if (conversationTurns > 5) {
        return EscalationDecision.escalate(
            "long_conversation", EscalationPriority.LOW,
            "Conversation exceeds 5 turns without resolution");
    }

    return EscalationDecision.noEscalation();
}
```

The rules are ordered by urgency. An explicit escalation request or a
low-confidence complaint triggers HIGH priority - these go to the front of the
human agent queue. Tool errors indicate the AI cannot fulfil the request and get
MEDIUM priority. Low confidence and long conversations get LOW priority as soft
suggestions. The span records `base14.support.escalation_reason` and
`base14.support.escalation_priority` only when escalation triggers, keeping clean
traces for normal conversations.

### Tool Calling

Spring AI provides the `@Tool` and `@ToolParam` annotations for declarative tool
definitions. The LLM decides when to call a tool based on the tool's
description, and Spring AI handles the function-calling protocol with the
provider. Each tool method receives typed parameters, executes business logic
(typically a database query), and returns a result that Spring AI serializes
back to the LLM.

Here is an example tool method from `OrderTools` - the `getOrderStatus` tool
that looks up an order by ID:

```java showLineNumbers title="src/main/java/com/example/support/tools/OrderTools.java"
@Tool(description = "Look up order status and tracking info by order ID (e.g. ORD-12345)")
public Map<String, Object> getOrderStatus(
    @ToolParam(description = "Order ID, e.g. ORD-12345") String orderId
) {
    log.info("Tool call: getOrderStatus({})", orderId);
    var rows = jdbc.queryForList(
        """
        SELECT o.order_id, o.status, o.tracking_number, o.estimated_delivery,
               o.total_amount, o.created_at, c.name as customer_name
        FROM orders o JOIN customers c ON o.customer_id = c.id
        WHERE o.order_id = ?
        """, orderId);

    if (rows.isEmpty()) {
        return toolTelemetry.failure("getOrderStatus", "order_not_found", "Order not found: " + orderId);
    }
    toolTelemetry.success("getOrderStatus");
    return rows.getFirst();
}
```

The tool method itself records nothing. Both outcomes go through the injected
`ToolTelemetry` bean, which is where the observability lives:

```java showLineNumbers title="src/main/java/com/example/support/tools/ToolTelemetry.java"
public void success(String toolName) {
    metrics.recordToolCall(toolName, true);
}

public Map<String, Object> failure(String toolName, String errorType, String message) {
    ToolFailedException error = new ToolFailedException(message);
    Span span = Span.current();
    span.recordException(error);
    span.setAttribute(GenAi.ERROR_TYPE, errorType);
    span.setStatus(StatusCode.ERROR, message);

    conversations.recordOnConversation(GenAi.TOOL_FAILED_EVENT, Attributes.of(
        AttributeKey.stringKey(GenAi.TOOL_NAME), toolName,
        AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType));
    metrics.recordToolCall(toolName, false);

    return Map.of("error", message);
}
```

`Span.current()` inside a tool method is the `execute_tool {tool_name}` span
that Spring AI's tool observation opened, so `failure()` marks that span
errored without creating one of its own. A tool that returns an error map to
the model is not an exception anywhere in the call stack, and without this the
span would be reported as successful. `failure()` also adds a
`tool_execution_failed` event to the parent `support_conversation` span, so a
turn where the model recovered from a bad tool result still carries the
evidence, and increments the `base14.support.tool_calls` counter with
`base14.support.tool_success=false`. The JDBC query runs under the Java Agent's
auto-instrumentation, so the database call appears as a child of the
`execute_tool` span with no manual work.

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
passed to `LlmService.generateCapable()`, which attaches them to the options
it builds from the model's own defaults:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
ChatOptions defaults = chatModel.getDefaultOptions();
ChatOptions.Builder builder = defaults != null ? defaults.mutate() : ToolCallingChatOptions.builder();
builder.model(model)
    .temperature(config.temperature())
    .maxTokens(config.maxTokens());

if (toolCallbacks != null && !toolCallbacks.isEmpty()) {
    if (builder instanceof ToolCallingChatOptions.Builder toolBuilder) {
        toolBuilder.toolCallbacks(toolCallbacks);
    } else {
        log.warn("Dropping {} tool callbacks: {} does not build tool calling options",
            toolCallbacks.size(), builder.getClass().getName());
    }
}
```

The options start from `chatModel.getDefaultOptions().mutate()` because each
provider's ChatModel expects its own `ChatOptions` subtype; a generic builder
would drop the provider-specific settings from `application.yml`, including
Ollama's `think: false`.

Spring AI 2.0 no longer runs the tool loop inside `chatModel.call()`. The
caller gets a response with tool calls on it and is expected to execute them.
`LlmService.generateOnce()` runs that loop itself, through
`ToolCallingManager`, which is the part that keeps the framework's
`execute_tool` observation:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
int toolRounds = 0;
while (response.hasToolCalls()) {
    if (toolRounds >= MAX_TOOL_ROUNDS) {
        log.warn("Tool call loop hit the limit of {} rounds, asking for a plain answer",
            MAX_TOOL_ROUNDS);
        conversations.recordOnConversation(GenAi.TOOL_LOOP_LIMIT_EVENT, Attributes.of(
            AttributeKey.longKey(GenAi.TOOL_LOOP_ROUNDS), (long) toolRounds));
        // Breaking here would leave the caller with a tool-call-only message and no
        // text, so ask the model once more with the tools taken away.
        response = chatModel.call(
            toolFreePrompt(chatModel, prompt.getInstructions(), model));
        break;
    }
    ToolExecutionResult toolResult = toolCallingManager.executeToolCalls(prompt, response);
    if (toolResult.returnDirect()) {
        break;
    }
    prompt = new Prompt(toolResult.conversationHistory(), prompt.getOptions());
    response = chatModel.call(prompt);
    toolRounds++;
}
```

Three things follow from this for the trace shape.

- Each round is a separate `chatModel.call()`, so a turn that used tools has
  several `chat {model}` spans, not one. They are siblings under
  `generate_response`, and so are the `execute_tool` spans that
  `executeToolCalls()` produces between them.
- `MAX_TOOL_ROUNDS` is 8. A model that keeps asking for tools hits the limit
  and the conversation span gets a `tool_loop_limit_reached` event carrying
  `base14.tool.rounds`. Alert on that event: it means a turn cost eight round
  trips and still had no answer.
- The limit is not a `break`. Breaking would hand the caller a message that
  contains tool calls and no text, so the code makes one more call with
  `toolFreePrompt()`, which is the same options with the callbacks emptied.
  That final call shows up as one more `chat` span with no `execute_tool`
  siblings after it, which is how you recognise a truncated tool loop in a
  trace.

The application exposes six tools across two classes:

| Tool | Class | Description |
| --- | --- | --- |
| `getOrderStatus` | OrderTools | Look up order status and tracking by order ID |
| `getOrderHistory` | OrderTools | Get recent orders by customer email |
| `initiateReturn` | OrderTools | Initiate a return for a delivered order |
| `getReturnStatus` | OrderTools | Check return status by return ID |
| `searchProducts` | ProductTools | Search product catalog by name or category |
| `getProductInfo` | ProductTools | Get product details by SKU |

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
similarity score is recorded as both a span attribute
(`app.retrieval.top_similarity` on the `retrieval kb_articles` span) and a
metric (`base14.support.rag.similarity` histogram) for tracking retrieval quality
over time.

## Retry and Fallback Observability

The `LlmService` implements a two-tier resilience strategy: retry with
exponential backoff within a single provider, and fallback to an alternate
provider when all retries are exhausted. Both tiers are instrumented with
metrics.

The `generateWithRetry()` method handles the retry loop for a single provider:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private LlmResponse generateWithRetry(
    ChatModel chatModel, String provider, String model,
    String systemPrompt, String userPrompt, List<ToolCallback> toolCallbacks
) {
    Exception lastError = null;
    for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            return generateOnce(chatModel, provider, model, systemPrompt, userPrompt, toolCallbacks);
        } catch (Exception e) {
            lastError = e;
            log.warn("LLM call failed (attempt {}/{}): provider={} model={} error={}",
                attempt + 1, MAX_ATTEMPTS, provider, model, e.getMessage());
            if (attempt < MAX_ATTEMPTS - 1) {
                // The attribute name comes from _shared/test-vectors/chat-with-retry.json.
                retryCounter.add(1, Attributes.builder()
                    .put(GenAi.PROVIDER_NAME, provider)
                    .put(GenAi.ERROR_TYPE, errorType(e))
                    .put(GenAi.RETRY_ATTEMPT, attempt + 1L)
                    .build());
                sleep(backoffWithJitter(attempt));
            }
        }
    }

    errorCounter.add(1, Attributes.of(
        AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
        AttributeKey.stringKey(GenAi.REQUEST_MODEL), model,
        AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType(lastError)));
    log.error("All {} attempts failed for provider={}", MAX_ATTEMPTS, provider, lastError);
    return null;
}
```

The loop makes up to `MAX_ATTEMPTS` (3) attempts. The counter fires only when
another attempt will follow, so three failures produce two increments and the
counter means retries rather than failures. Each increment carries
`error.type` and `base14.retry.attempt`, which is what lets you tell a
provider that is rate-limiting from one that is timing out, and lets you see
whether retries usually succeed on the second try or burn all three.
`base14.gen_ai.error.count` is incremented once when the provider is
exhausted, not once per attempt.

The backoff uses exponential delay with jitter:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private static long backoffWithJitter(int attempt) {
    long base = Math.min(MIN_BACKOFF_MS * (1L << attempt), MAX_BACKOFF_MS);
    return base + ThreadLocalRandom.current().nextLong(0, base / 4 + 1);
}
```

This produces delays of approximately 1s and 2s before attempts 2 and 3,
capped at 10s, with up to 25% random jitter added to prevent thundering-herd
retries across concurrent requests. The method returns `null` after exhausting
all attempts rather than throwing - this signals the caller to try the
fallback provider.

The `generate()` method orchestrates the primary-to-fallback flow:

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
public LlmResponse generate(String systemPrompt, String userPrompt, String model,
                            List<ToolCallback> toolCallbacks) {
    LlmResponse response = generateWithRetry(
        primaryModel, config.provider(), model, systemPrompt, userPrompt, toolCallbacks);
    if (response != null) {
        return response;
    }

    log.warn("Primary provider {} failed, falling back to {}", config.provider(), config.fallbackProvider());
    fallbackCounter.add(1, Attributes.of(
        AttributeKey.stringKey(GenAi.PROVIDER_NAME), config.provider(),
        AttributeKey.stringKey(GenAi.FALLBACK_PROVIDER), config.fallbackProvider()));
    conversations.recordOnConversation(GenAi.FALLBACK_EVENT, Attributes.builder()
        .put(GenAi.FALLBACK_TRIGGERED, true)
        .put(GenAi.PROVIDER_NAME, config.provider())
        .put(GenAi.FALLBACK_PROVIDER, config.fallbackProvider())
        .build());

    response = generateWithRetry(fallbackModel, config.fallbackProvider(), config.fallbackModel(),
        systemPrompt, userPrompt, toolCallbacks);
    if (response != null) {
        return response;
    }

    throw new IllegalStateException("All LLM providers failed after retries");
}
```

The flow is: try the primary provider for up to three attempts. If all fail
(`generateWithRetry` returns `null`), record the fallback and try the fallback
provider for another three. If both providers fail, throw an
`IllegalStateException` that propagates up to the pipeline's catch block and
sets the parent span status to ERROR.

The fallback is recorded twice on purpose. `base14.gen_ai.fallback.count`
carries both `gen_ai.provider.name` and `base14.gen_ai.fallback.provider`, so
the metric answers "how often did we leave provider X, and for whom". The
`provider_fallback` event goes on the `support_conversation` span, with
`gen_ai.fallback.triggered=true` alongside the same pair, so a single trace
shows which turn switched providers. The metric is for the dashboard, the
event is for the trace you open when the dashboard moves.

In telemetry, retries and fallbacks surface through three metrics defined in the
LLM metrics section:

- `base14.gen_ai.retry.count` - incremented on each retry attempt (not the
  initial attempt), labeled with `gen_ai.provider.name` and
  `gen_ai.request.model`. A steady increase indicates provider instability.
- `base14.gen_ai.fallback.count` - incremented once per fallback activation. Any
  non-zero value means the primary provider failed completely for at least one
  request.
- `base14.gen_ai.error.count` - incremented on every failed `generateOnce()`
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

    public SupportMetrics(Telemetry telemetry) {
        Meter meter = telemetry.meter();

        this.conversationDuration = meter
            .histogramBuilder("base14.support.conversation.duration")
            .setUnit("s")
            .setDescription("Duration of customer support "
                + "conversations")
            .build();

        this.conversationTurns = meter
            .histogramBuilder("base14.support.conversation.turns")
            .setUnit("{turn}")
            .setDescription("Number of turns in customer "
                + "support conversations")
            .build();

        this.escalationCount = meter
            .counterBuilder("base14.support.escalation.count")
            .setDescription(
                "Number of escalated conversations")
            .build();

        this.toolCallCount = meter
            .counterBuilder("base14.support.tool_calls")
            .setDescription("Number of tool calls made")
            .build();

        this.ragSimilarity = meter
            .histogramBuilder("base14.support.rag.similarity")
            .setDescription("Top similarity score from "
                + "RAG retrieval")
            .build();
    }

    public void recordConversationDuration(
        double seconds, String intent, boolean escalated
    ) {
        conversationDuration.record(seconds, Attributes.of(
            AttributeKey.stringKey("base14.support.intent"), intent,
            AttributeKey.booleanKey("base14.support.escalated"),
                escalated
        ));
    }

    public void recordConversationTurns(
        int turns, String intent, boolean resolved
    ) {
        conversationTurns.record(turns, Attributes.of(
            AttributeKey.stringKey("base14.support.intent"), intent,
            AttributeKey.booleanKey("base14.support.resolved"), resolved
        ));
    }

    public void recordEscalation(String reason, String priority) {
        escalationCount.add(1, Attributes.of(
            AttributeKey.stringKey("base14.support.escalation_reason"),
                reason,
            AttributeKey.stringKey("base14.support.escalation_priority"),
                priority
        ));
    }

    public void recordToolCall(String toolName, boolean success) {
        toolCallCount.add(1, Attributes.of(
            AttributeKey.stringKey("base14.support.tool_name"), toolName,
            AttributeKey.booleanKey("base14.support.tool_success"), success
        ));
    }

    public void recordRagSimilarity(
        double similarity, String intent
    ) {
        ragSimilarity.record(similarity, Attributes.of(
            AttributeKey.stringKey("base14.support.intent"), intent
        ));
    }
}
```

Each metric is recorded at a specific point in the pipeline:

- `base14.support.conversation.duration` and
  `base14.support.conversation.turns` - recorded at the end of
  `SupportPipeline.runPipeline()`, after all stages complete.
  Duration is measured from the start of `runPipeline()` in seconds. Turns are
  calculated as `history.size() / 2 + 1` (each turn is a user-assistant pair).
- `base14.support.escalation.count` - recorded in `SupportPipeline.runPipeline()`
  immediately after the escalation check, only when
  `escalation.shouldEscalate()` returns true.
- `base14.support.tool_calls` - recorded through `ToolTelemetry` from each
  `@Tool` method in `OrderTools` and `ProductTools`. Every tool call
  increments the counter with the tool name and success status.
- `base14.support.rag.similarity` - recorded in
  `SupportPipeline.runPipeline()` after RAG retrieval, using the top
  document's similarity score.

| Metric | Type | Unit | Labels | Business Purpose |
| --- | --- | --- | --- | --- |
| `base14.support.conversation.duration` | Histogram | `s` | `base14.support.intent`, `base14.support.escalated` | Track resolution time by intent type and escalation status |
| `base14.support.conversation.turns` | Histogram | `{turn}` | `base14.support.intent`, `base14.support.resolved` | Detect long conversations that may need UX improvements |
| `base14.support.escalation.count` | Counter | - | `base14.support.escalation_reason`, `base14.support.escalation_priority` | Monitor escalation rate and reasons for human handoff |
| `base14.support.tool_calls` | Counter | - | `base14.support.tool_name`, `base14.support.tool_success` | Track which tools the LLM uses and their success rate |
| `base14.support.rag.similarity` | Histogram | - | `base14.support.intent` | Monitor retrieval quality - low scores indicate knowledge base gaps |

## PII and Security

AI applications handle user input that may contain personally identifiable
information - email addresses, social security numbers, credit card numbers,
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
        if (text == null || text.isEmpty()) {
            return text;
        }
        String result = text;
        for (PiiPattern pii : PATTERNS) {
            var matcher = pii.pattern().matcher(result);
            if (matcher.find()) {
                result = matcher.replaceAll(REDACTED);
            }
        }
        return result;
    }
}
```

`scrub()` only rewrites text. The telemetry is in `evaluate()`, which scans
first and reports the scan as a GenAI evaluation event on the current span:

```java showLineNumbers title="src/main/java/com/example/support/filter/PiiFilter.java"
private static final String EVALUATION_NAME = "pii_scan";

/** Scrubs the text and records the result as a GenAI evaluation on the current span. */
public String evaluate(String text) {
    List<String> detected = detect(text);
    if (!detected.isEmpty()) {
        log.warn("PII detected (types={}), redacting", detected);
    }

    AttributesBuilder attributes = Attributes.builder()
        .put(GenAi.EVALUATION_NAME, EVALUATION_NAME)
        .put(GenAi.EVALUATION_SCORE_VALUE, detected.isEmpty() ? 1.0 : 0.0)
        .put(GenAi.EVALUATION_SCORE_LABEL, detected.isEmpty() ? "pass" : "fail");
    if (!detected.isEmpty()) {
        attributes.put(GenAi.EVALUATION_EXPLANATION, "Redacted " + String.join(", ", detected));
    }
    Span.current().addEvent(GenAi.EVALUATION_RESULT_EVENT, attributes.build());

    return detected.isEmpty() ? text : scrub(text);
}
```

This is the same `gen_ai.evaluation.result` event the escalation check emits,
with `gen_ai.evaluation.name` set to `pii_scan`. Score `1.0` and label `pass`
mean the text was clean; `0.0` and `fail` mean something was redacted, and
`gen_ai.evaluation.explanation` names the categories that matched, such as
`Redacted email, phone`. One event per turn either way, so the PII rate is a
ratio over labels rather than a count of a rare event. The event never
contains the matched text.

The filter is applied at two points in the pipeline:

1. **Response content** - `PiiFilter.evaluate()` is called on the LLM response
   in `SupportPipeline.runPipeline()` before returning content to the client.
   This is the call that puts the `pii_scan` event on the
   `support_conversation` span:

   ```java showLineNumbers title="src/main/java/com/example/support/pipeline/SupportPipeline.java"
   // 4. PII scrub
   String content = piiFilter.evaluate(response.content());
   ```

2. **Span events** - In `GenAiTracingObservationHandler.contentAttributes()`,
   the PII filter scrubs input, output, and system content before it is
   written to the single `gen_ai.client.inference.operation.details` event:

   ```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiTracingObservationHandler.java"
   .put(GenAi.INPUT_MESSAGES, truncate(piiFilter.scrub(input), INPUT_MAX_CHARS))
   .put(GenAi.OUTPUT_MESSAGES, truncate(piiFilter.scrub(output), OUTPUT_MAX_CHARS));
   // ...
   span.addEvent(GenAi.INFERENCE_DETAILS_EVENT, contentAttributes(context, response));
   ```

Content capture itself is gated by the
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` environment variable. The
handler receives it as a constructor-injected `@Value`, resolved once by
Spring at startup:

```java showLineNumbers title="src/main/java/com/example/support/telemetry/GenAiTracingObservationHandler.java"
public GenAiTracingObservationHandler(
    /* ... */
    @Value("${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:false}") boolean captureContent
) {
    // ...
    this.captureContent = captureContent;
}
```

When this variable is unset or set to anything other than `"true"`, no prompt or
completion content is written to span events at all - a defense-in-depth
approach where PII filtering is the second layer after the content capture gate.

Additional security practices in the application:

- **API keys via environment variables** - Provider API keys (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`) are injected via environment variables, never hardcoded
  in source or configuration files. `.env.example` ships them blank, and the
  default Ollama configuration needs neither.
- **Content truncation limits** - Prompts are truncated to 1000 characters,
  system instructions to 500 characters, and completions to 2000 characters
  before writing to span events. This prevents large payloads from inflating
  trace storage costs.
- **PII scrubbing before telemetry export** - The PII filter runs before content
  reaches OpenTelemetry span events, so sensitive data never leaves the
  application process.
- **Spring AI observation content capture** - Spring AI's built-in Micrometer
  observations (Layer 2) have their own content capture setting
  (`spring.ai.chat.observations.include-input` /
  `spring.ai.chat.observations.include-output`) which defaults to false. This
  means Spring AI's auto-generated spans also do not capture content by default.

## Running Your Application

<div class="mdx-code-block">
<Tabs>
<TabItem value="development" label="Development" default>

The defaults need no API key: copy `.env.example` to `.env`, pull the two
models, and run.

```bash showLineNumbers
ollama pull qwen3.5:9B
ollama pull embeddinggemma
cp .env.example .env

./gradlew bootRun
```

`.env.example` sets `SPRING_PROFILES_ACTIVE=ollama`, `LLM_PROVIDER=ollama` and
`FALLBACK_PROVIDER=ollama`, pointing at `http://localhost:11434`. To use a
hosted provider instead, set `LLM_PROVIDER` and the matching key in `.env`:

```bash showLineNumbers
LLM_PROVIDER=openai
LLM_MODEL_CAPABLE=gpt-4.1
LLM_MODEL_FAST=gpt-4.1-mini
OPENAI_API_KEY=sk-...
```

The example's own `make` targets run Gradle inside the `gradle:9.2.1-jdk25`
image, because Gradle 9.2 does not run on every host JDK:

```bash showLineNumbers
make lint    # checkstyleMain checkstyleTest
make build   # bootJar
make test
make check   # all three
```

Running `bootRun` without the Java Agent is not a reduced version of the
instrumentation - it is no instrumentation. `OpenTelemetryConfig` publishes
`GlobalOpenTelemetry.get()`, which without the agent is the no-op
implementation, so Layer 2 and Layer 3 both write into a tracer and meter that
discard everything. To see telemetry from a host run, attach the agent:

```bash showLineNumbers
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.31.1/opentelemetry-javaagent.jar

java -javaagent:opentelemetry-javaagent.jar \
  -jar build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar
```

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
  -Dotel.semconv-stability.opt-in=gen_ai_latest_experimental \
  -jar app.jar
```

Configure sampling to control trace volume in high-traffic environments. The
agent owns sampling, so this is an environment variable rather than a Spring
property:

```bash showLineNumbers
export OTEL_TRACES_SAMPLER=parentbased_traceidratio
export OTEL_TRACES_SAMPLER_ARG=0.1  # 10% sampling for high-traffic
```

Set resource attributes to identify the deployment in your observability
backend:

```bash showLineNumbers
export OTEL_RESOURCE_ATTRIBUTES="service.name=ai-customer-support,environment=demo,service.version=1.2.0"
```

For production, always route telemetry through an OpenTelemetry Collector rather
than exporting directly from the application. The collector provides buffering,
retry logic, and filtering that protects both your application and your backend.

</TabItem>
<TabItem value="docker" label="Docker Compose">

The Docker Compose setup runs the application with the Java Agent, a PostgreSQL
database with pgvector, and the OpenTelemetry Collector - the full production
stack locally.

The `Dockerfile` uses a multi-stage build that compiles the application, then
downloads the Java Agent into the runtime image:

```dockerfile showLineNumbers title="Dockerfile"
FROM gradle:9.2.1-jdk25 AS builder

ARG OTEL_AGENT_VERSION=2.31.1

WORKDIR /app

# Fetched here rather than with ADD so the layer caches and the download retries.
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 \
    -o /app/opentelemetry-javaagent.jar \
    "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar"

COPY build.gradle settings.gradle ./
COPY config/checkstyle ./config/checkstyle
COPY --from=shared pricing.json /app/_shared/pricing.json
COPY --from=shared test-vectors /app/_shared/test-vectors
COPY src ./src

RUN gradle bootJar --no-daemon

FROM eclipse-temurin:25-jre

# curl is here only so the container healthcheck has something to call.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home app

WORKDIR /app

COPY --from=builder --chown=app:app /app/opentelemetry-javaagent.jar /app/opentelemetry-javaagent.jar

COPY --from=builder --chown=app:app /app/build/libs/ai-customer-support-0.0.1-SNAPSHOT.jar /app/app.jar

USER app
EXPOSE 8080

ENTRYPOINT ["java", \
  "-javaagent:/app/opentelemetry-javaagent.jar", \
  "-jar", "/app/app.jar"]
```

The agent version is an `ARG`, so a rebuild pins it rather than picking up
whatever the URL serves today. `curl --retry 5 --retry-all-errors` in a `RUN`
gives a cached, retried download, which `ADD` does not. The runtime image adds
a uid 10001 `app` user and switches to it before the entrypoint, so the JVM
does not run as root.

The `compose.yaml` wires together the application, database, and collector:

```yaml showLineNumbers title="compose.yaml"
services:
  app:
    build:
      context: .
      additional_contexts:
        shared: ../../_shared
    ports:
      - "8080:8080"
    environment:
      SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-ollama}
      SPRING_R2DBC_URL: r2dbc:postgresql://postgres:5432/support
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/support
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_NAME: support
      DB_USER: postgres
      DB_PASSWORD: postgres
      LLM_PROVIDER: ${LLM_PROVIDER:-ollama}
      LLM_MODEL_CAPABLE: ${LLM_MODEL_CAPABLE:-qwen3.5:9B}
      LLM_MODEL_FAST: ${LLM_MODEL_FAST:-qwen3.5:9B}
      FALLBACK_PROVIDER: ${FALLBACK_PROVIDER:-ollama}
      FALLBACK_MODEL: ${FALLBACK_MODEL:-qwen3.5:9B}
      OLLAMA_BASE_URL: ${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      OLLAMA_THINK: ${OLLAMA_THINK:-false}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      DEFAULT_TEMPERATURE: ${DEFAULT_TEMPERATURE:-0.3}
      DEFAULT_MAX_TOKENS: ${DEFAULT_MAX_TOKENS:-1024}
      EMBEDDING_MODEL: ${EMBEDDING_MODEL:-embeddinggemma}
      EMBEDDING_DIMENSIONS: ${EMBEDDING_DIMENSIONS:-768}
      OTEL_SERVICE_NAME: ai-customer-support
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_TRACES_EXPORTER: otlp
      OTEL_METRICS_EXPORTER: otlp
      OTEL_LOGS_EXPORTER: otlp
      OTEL_SEMCONV_STABILITY_OPT_IN: gen_ai_latest_experimental
      OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED: "true"
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: ${OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT:-false}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      otel-collector:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/api/health"]
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
    image: otel/opentelemetry-collector-contrib:0.161.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    volumes:
      - ./config/otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    environment:
      SCOUT_CLIENT_ID: ${SCOUT_CLIENT_ID:-unset}
      SCOUT_CLIENT_SECRET: ${SCOUT_CLIENT_SECRET:-unset}
      SCOUT_TOKEN_URL: ${SCOUT_TOKEN_URL:-https://auth.base14.io/oauth/token}
      SCOUT_ENDPOINT: ${SCOUT_ENDPOINT:-https://collector.base14.io}
      SCOUT_ENVIRONMENT: ${SCOUT_ENVIRONMENT:-development}
    healthcheck:
      test: ["NONE"]

  ollama:
    image: ollama/ollama:latest
    profiles: [ollama]
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

volumes:
  pgdata:
  ollama_data:
```

Two things in here are worth calling out. `extra_hosts` plus
`OLLAMA_BASE_URL: http://host.docker.internal:11434` is how the container
reaches an Ollama running on the host, which is the default path; the
`ollama` service under `profiles: [ollama]` only starts when you ask for it
with `docker compose --profile ollama up -d`, for hosts with no local Ollama.
The collector's `SCOUT_CLIENT_ID` and `SCOUT_CLIENT_SECRET` default to
`unset` rather than empty, because the collector refuses to start on an empty
client id; put the real values in `.env`.

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
      - key: environment
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

- **`health_check`** on port 13133 - used by Docker health checks and load
  balancers to verify the collector is running
- **`zpages`** on port 55679 - provides live debugging pages at `/debug/tracez`
  and `/debug/pipelinez` for inspecting the collector's internal state
- **`oauth2client`** - authenticates with base14 Scout using OAuth2 client
  credentials
- **`memory_limiter`** - caps the collector at 512 MiB with a 128 MiB spike
  buffer, preventing OOM in constrained environments
- **`filter/noisy`** - drops health check, actuator, and HikariCP housekeeper
  spans that add volume without diagnostic value
- **`retry_on_failure`** - retries failed exports with exponential backoff from
  1s to 30s, for up to 5 minutes total
- **`debug` exporter** - logs detailed span information locally, invaluable
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
the path is wrong, the JVM starts without the agent silently - no error, just no
Layer 1 spans.

### Spring AI spans missing

Verify that `micrometer-tracing-bridge-otel` is in your `build.gradle`
dependencies. This bridge is what connects Spring AI's Micrometer observations
to OpenTelemetry. Without it, Spring AI creates observations but they never
become OpenTelemetry spans.

Also confirm the app is running under the agent. Without it,
`GlobalOpenTelemetry.get()` returns a no-op and the bridge writes into a
tracer that discards spans:

```bash showLineNumbers
docker compose logs app | grep "opentelemetry-javaagent"
```

Check that sampling is not set to zero. Sampling is the agent's, so look at
`OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG`, not `application.yml`.

### Duplicate spans from Java Agent and Spring AI

The Java Agent auto-instruments HTTP clients (Netty, Apache HttpClient, etc.),
and Spring AI creates its own ChatModel observation spans. This means a single
LLM call produces both an HTTP span (from the agent) and a ChatModel span (from
Spring AI). This is expected behavior, not a bug - the HTTP span shows network
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

Each `@Tool` method should report its outcome through `ToolTelemetry`,
`success()` on the good path and `failure()` when it returns an error map.
Without these the tool executes but no `base14.support.tool_calls` metric is emitted,
and a tool that returned an error to the model leaves an `execute_tool` span
marked OK.

### Verifying the full pipeline

`scripts/verify-scout.sh` drives the API and then checks the collector and the
application logs for the spans, metrics and events this guide describes:

```bash showLineNumbers
./scripts/verify-scout.sh
# or: make verify-scout
```

It reports PASS or FAIL per check, so it is the quickest way to tell whether a
change broke the telemetry rather than the application.

## Performance Considerations

Three-layer instrumentation adds measurable but minimal overhead to each
request:

| Layer | Latency Overhead | Memory | CPU |
| --- | --- | --- | --- |
| Java Agent | 1-3ms per span | ~50MB heap | &lt;1% |
| Spring AI Micrometer | &lt;1ms per observation | Negligible | Negligible |
| Manual OTel API | &lt;0.5ms per span | Negligible | Negligible |
| Combined | 2-5ms per request | ~60MB total | 1-2% |

For an AI application where LLM calls take 500ms-5s each, the 2-5ms
instrumentation overhead is negligible - well under 1% of total request latency.

Five practices to optimize instrumentation performance in production:

1. **Use sampling for high-traffic services.** Set the agent's
   `OTEL_TRACES_SAMPLER_ARG` to 0.1-0.5 in production. A 10%
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
   prompt and completion - significant for large payloads. Only enable content
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
- **Layer 3 only (Manual OTel API)**: Inject a `Tracer`/`Meter` pair (through
  `Telemetry`). You get full GenAI semantic conventions, custom metrics, and
  pipeline context.
- **Layer 1 + 2**: Auto HTTP/JDBC spans plus Spring AI observations. Good
  coverage without any manual instrumentation code.
- **Layer 2 + 3**: Spring AI observations plus manual GenAI spans. Full AI
  context without the Java Agent JAR.

The full three-layer stack provides the most complete traces, but any
combination works. One constraint applies to all of them in this example:
something has to supply the SDK. The app ships none, so Layers 2 and 3 only
produce telemetry when the agent is attached. Drop the agent and you need an
`opentelemetry-sdk` plus exporter on the classpath instead.

### What Spring AI versions are compatible?

This guide uses Spring AI 2.0.0 with Spring Boot 4.0.7 and the OpenTelemetry
Java agent 2.31.1. The key requirement is that Spring AI must emit Micrometer
observations (available since Spring AI 1.0.0-M1). Two details are specific to
2.0: the default convention still emits the deprecated `gen_ai.system`, which
is why `GenAiChatObservationConvention` exists, and tool execution moved out
of `chatModel.call()` to the caller, which is why `LlmService` drives the
`ToolCallingManager` loop itself. The `micrometer-tracing-bridge-otel`
dependency must match your Spring Boot version's Micrometer version - the
dependency management BOM handles this automatically.

### How do I reduce trace volume in production?

Four approaches, from least to most aggressive:

1. **Sampling**: Set the agent's `OTEL_TRACES_SAMPLER_ARG` to 0.1-0.5.
2. **Collector filtering**: The `filter/noisy` processor drops health checks,
   actuator endpoints, and HikariCP housekeeping spans.
3. **Head-based sampling at the collector**: Add a `probabilistic_sampler`
   processor to the collector pipeline for additional server-side sampling.
4. **Disable Layer 1**: Remove the Java Agent to eliminate HTTP/JDBC auto-spans
   while keeping the AI-specific spans from Layers 2 and 3.

### Can I use the OpenTelemetry Java Agent with Spring AI at the same time?

Yes, and this example does. The Java Agent instruments at the bytecode level
(HTTP clients, JDBC drivers) while Spring AI observations operate at the
application framework level (ChatModel, VectorStore). They share the same
OpenTelemetry context because `OpenTelemetryConfig` hands the agent's
`GlobalOpenTelemetry.get()` to the Micrometer bridge, so their spans appear as
parent and child in one trace. The only overlap is HTTP client spans - the
agent creates an HTTP span for the outbound LLM API call, and Spring AI
creates a ChatModel observation span. Both carry useful but different
information (network timing against model metadata). The one thing to watch is
metrics: `OpenTelemetryMeterRegistry` would republish the JVM, process, system
and disk meters the agent already reports, which is why the bean installs a
`MeterFilter.deny` for those prefixes.

### How do I add a new LLM provider (e.g., Google Gemini)?

Add the Spring AI starter for the provider to `build.gradle`:

```groovy showLineNumbers
implementation 'org.springframework.ai:spring-ai-starter-model-vertex-ai-gemini'
```

Then register the ChatModel bean and add a case for it in
`Providers.chatModel()`, which is the static factory this app uses to turn a
provider key into a `ChatModel` bean - it currently only switches on
`"openai"`, `"anthropic"`, and `"ollama"`, and throws
`IllegalArgumentException` for anything else, so a new provider needs a case
added there too, along with a `SERVERS`/`PORTS` entry if it is not
`ollama`-style dynamically configured. The three-layer instrumentation then
works automatically - the Java Agent captures the HTTP call to Google's API,
Spring AI's `ChatModel` observation produces the `chat {model}` span, and
`GenAiChatObservationConvention` plus `GenAiTracingObservationHandler` tag and
enrich it exactly as they do for the existing providers. Set
`gen_ai.provider.name` to `gcp.gemini` for this provider, not `google` - your
own config key (for example `LLM_PROVIDER=google`) can stay whatever you like,
but it is never the value that should reach telemetry.

### How do I track costs across multiple providers?

The `LlmService` loads pricing data from `pricing.json`, which maps model names
to per-token input and output costs. Each `generateOnce()` call calculates cost
using `pricing.calculateCost(responseModel, inputTokens, outputTokens)` and
records it to both the span attribute (`base14.gen_ai.cost_usd`) and the
`base14.gen_ai.cost` metric counter. To add a new model, add its pricing to
`pricing.json`. To aggregate costs, query the `base14.gen_ai.cost` metric
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

1. **Verify the injected `OpenTelemetry` bean (`Telemetry.tracer()`) returns a
   real tracer.** If the SDK is not initialized, it returns a no-op tracer
   that creates spans that are silently discarded.
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
  - manual spans and metrics for non-AI Java applications
- [Spring Boot Auto-Instrumentation](../../instrument/apps/auto-instrumentation/spring-boot.md)
  - zero-code instrumentation for Spring Boot web applications
- [LLM Observability](../llm-observability) - Python patterns for LLM
  observability
- [Rust LLM Observability](../rust-llm-observability) - Rust patterns with manual
  GenAI instrumentation

### Scout Platform Features

- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - set up cost,
  latency, and error rate alerts
- [Create Your First Dashboard](../../guides/create-your-first-dashboard.md) —
  visualize AI metrics

### Deployment and Operations

- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
  - collector deployment reference

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
    id 'checkstyle'
    id 'org.springframework.boot' version '4.0.7'
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

// Spring Boot 4.0.7 manages OpenTelemetry 1.55.0; 1.62.0 fixes GHSA-rcgg-9c38-7xpx
ext['opentelemetry.version'] = '1.65.0'

dependencyManagement {
    imports {
        mavenBom "org.springframework.ai:spring-ai-bom:2.0.0"
    }
}

dependencies {
    // Web (reactive)
    implementation 'org.springframework.boot:spring-boot-starter-webflux'

    // Observability. The OpenTelemetry Java agent is the only exporter: the app
    // supplies no SDK and no OTLP exporter of its own.
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'io.micrometer:micrometer-tracing-bridge-otel'
    implementation 'io.opentelemetry:opentelemetry-api'
    implementation 'io.opentelemetry.instrumentation:opentelemetry-micrometer-1.5:2.31.1-alpha'

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
    testImplementation 'io.opentelemetry:opentelemetry-sdk'
    testImplementation 'io.opentelemetry:opentelemetry-sdk-testing'
}

// pricing.json and the shared test vectors live at the repo root. The Docker
// builder stage copies them to <project>/_shared; a host build reads them from
// ../../_shared.
def sharedDir = [file("$projectDir/_shared"), file("$projectDir/../../_shared")].find { it.isDirectory() }

tasks.named('processResources') {
    from(new File(sharedDir, 'pricing.json'))
}

bootJar {
    mainClass = 'com.example.support.Application'
}

tasks.named('test') {
    useJUnitPlatform()
}
```

### LlmService.java (abbreviated)

The core LLM call method. It does not create its own span - Spring AI's
`ChatModel` observation produces the `chat {model}` span, and
`GenAiChatObservationConvention` plus `GenAiTracingObservationHandler` tag,
create, and enrich it, including the gated content-capture event. This method
only records the operation-duration metric that sits outside a single model
call, and drives the tool-calling loop, which Spring AI 2.0 leaves to the
caller. See the [Custom LLM Instrumentation](#custom-llm-instrumentation)
section for the full walkthrough.

```java showLineNumbers title="src/main/java/com/example/support/llm/LlmService.java"
private LlmResponse generateOnce(
    ChatModel chatModel, String provider, String model,
    String systemPrompt, String userPrompt, List<ToolCallback> toolCallbacks
) {
    long start = System.nanoTime();
    try {
        Prompt prompt = buildPrompt(chatModel, systemPrompt, userPrompt, model, toolCallbacks);
        ChatResponse response = chatModel.call(prompt);

        // Spring AI 2.0 leaves tool execution to the caller. Running it through the
        // ToolCallingManager keeps the framework's execute_tool observation.
        int toolRounds = 0;
        while (response.hasToolCalls()) {
            if (toolRounds >= MAX_TOOL_ROUNDS) {
                conversations.recordOnConversation(GenAi.TOOL_LOOP_LIMIT_EVENT, Attributes.of(
                    AttributeKey.longKey(GenAi.TOOL_LOOP_ROUNDS), (long) toolRounds));
                response = chatModel.call(
                    toolFreePrompt(chatModel, prompt.getInstructions(), model));
                break;
            }
            ToolExecutionResult toolResult = toolCallingManager.executeToolCalls(prompt, response);
            if (toolResult.returnDirect()) {
                break;
            }
            prompt = new Prompt(toolResult.conversationHistory(), prompt.getOptions());
            response = chatModel.call(prompt);
            toolRounds++;
        }

        var generation = response.getResult();
        var usage = response.getMetadata().getUsage();
        int inputTokens = usage != null && usage.getPromptTokens() != null ? usage.getPromptTokens() : 0;
        int outputTokens = usage != null && usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0;
        String responseModel = /* response.getMetadata().getModel(), falling back to model */ model;
        String finishReason = generation.getMetadata().getFinishReason();

        operationDuration.record(elapsedSeconds(start), Attributes.of(
            AttributeKey.stringKey(GenAi.OPERATION_NAME), "chat",
            AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
            AttributeKey.stringKey(GenAi.REQUEST_MODEL), model));

        return new LlmResponse(
            generation.getOutput().getText(), responseModel, provider,
            inputTokens, outputTokens,
            pricing.calculateCost(responseModel, inputTokens, outputTokens), finishReason);

    } catch (Exception e) {
        operationDuration.record(elapsedSeconds(start), Attributes.of(
            AttributeKey.stringKey(GenAi.OPERATION_NAME), "chat",
            AttributeKey.stringKey(GenAi.PROVIDER_NAME), provider,
            AttributeKey.stringKey(GenAi.REQUEST_MODEL), model,
            AttributeKey.stringKey(GenAi.ERROR_TYPE), errorType(e)));
        throw e;
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
    Span span = telemetry.tracer().spanBuilder("support_conversation")
        .setAttribute(GenAi.CONVERSATION_ID, conversationId.toString())
        .setAttribute(GenAi.AGENT_NAME, ConversationScope.AGENT_NAME)
        .startSpan();

    try (Scope ignored = span.makeCurrent()) {
        // 1. Classify intent (fast model)
        IntentResult intent = intentClassifier.classify(userMessage);
        span.setAttribute("base14.support.intent", intent.intent().name());

        // 2. Retrieve RAG context
        var ragDocs = contextRetriever.retrieve(userMessage);
        span.setAttribute("base14.support.rag_matches", ragDocs.size());

        // 3. Generate response (capable model)
        LlmResponse response = responseGenerator.generate(
            userMessage, intent, ragDocs, conversationHistory);

        // 4. PII scrub, which also emits the pii_scan evaluation event
        String content = piiFilter.evaluate(response.content());

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
        throw new IllegalStateException("Pipeline failed: " + e.getMessage(), e);
    } finally {
        span.end();
    }
}
```

### compose.yaml

See the [Docker Compose tab](#running-your-application) above for the full
`compose.yaml` and `Dockerfile`.

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

- [LLM Observability](../llm-observability) - Python patterns for AI application
  tracing
- [Rust LLM Observability](../rust-llm-observability) - Rust patterns with manual
  GenAI instrumentation
- [Spring Boot Auto-Instrumentation](../../instrument/apps/auto-instrumentation/spring-boot.md)
  - zero-code OpenTelemetry for Spring Boot web applications
- [Docker Compose Setup](../../instrument/collector-setup/docker-compose-example.md)
