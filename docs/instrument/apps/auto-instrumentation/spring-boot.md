# Spring Boot

Implement OpenTelemetry instrumentation for `Spring Boot` applications to
collect traces and metrics, and monitor HTTP requests using the Java OTel SDK.

> **Note:** This guide provides a concise overview. For complete information,
> consult the [official OpenTelemetry documentation][otel-docs].

[otel-docs]: https://opentelemetry.io/docs/zero-code/java/spring-boot-starter/

---

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry instrumentation for Spring Boot
- Configure automatic request and response tracing
- Implement custom instrumentation
- Collect HTTP metrics
- Export telemetry data to Scout Collector

---

## Prerequisites

- Java 17 or later
- Spring Boot 3.2.0 or later
- Maven 3.6+ or Gradle 7.6+

---

## Required Dependencies

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="maven" label="Maven">
```
pom.xml

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
            <version>
                ${opentelemetry.instrumentation.version}-alpha
            </version>
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

build.gradle`
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
        mavenBom "io.opentelemetry.instrumentation:" +
            "opentelemetry-instrumentation-bom:" +
            "${opentelemetry.instrumentation.version}-alpha"
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

### Configuration (`application.properties`)

```properties
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
management.endpoints.web.exposure.include=health,info,metrics,prometheus
management.tracing.sampling.probability=1.0
```

> Logs, traces and metrics are exported to the base14 Scout observability backend.

### References

- [OpenTelemetry Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)
- Sample application: [Spring Boot Otel Instrumentation](https://github.com/base-14/examples/tree/main/spring-boot)
