---
title: Auto-Instrumentation Overview - Zero-Code OpenTelemetry Setup | base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  Zero-code OpenTelemetry auto-instrumentation for Python, Node.js, Java, Go, Ruby, PHP, .NET, and Elixir frameworks. Get traces, metrics, and logs with minimal setup.
keywords:
  [
    opentelemetry auto instrumentation,
    zero code instrumentation,
    automatic tracing,
    apm setup,
    distributed tracing,
    opentelemetry python,
    opentelemetry nodejs,
    opentelemetry java,
    base14 scout,
  ]
---

# Auto-Instrumentation

Auto-instrumentation provides **zero-code observability** by automatically
capturing traces, metrics, and logs from your application and its dependencies.
This is the fastest way to get started with OpenTelemetry.

## When to Use Auto-Instrumentation

| Use Case | Recommendation |
|----------|----------------|
| Quick proof-of-concept | ✅ Auto-instrumentation |
| Standard HTTP/database operations | ✅ Auto-instrumentation |
| Business-specific metrics | ❌ Use [custom instrumentation](../custom-instrumentation/) |
| Fine-grained span control | ❌ Use [custom instrumentation](../custom-instrumentation/) |
| Legacy framework not supported | ❌ Use [custom instrumentation](../custom-instrumentation/) |

## Frameworks by Language

### Python

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Django | [Django](./django) | HTTP requests, ORM queries, middleware, templates, Celery tasks |
| Flask | [Flask](./flask) | HTTP requests, Jinja2 templates, SQLAlchemy |
| FastAPI | [FastAPI](./fast-api) | HTTP requests, async handlers, Pydantic validation |
| Celery | [Celery](./celery) | Task execution, retries, worker lifecycle |

### Node.js

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Express | [Express](./express) | HTTP requests, middleware, routing |
| NestJS | [NestJS](./nestjs) | Controllers, services, guards, interceptors |
| Next.js | [Next.js](./nextjs) | SSR, API routes, middleware, React components |
| Node.js (generic) | [Node.js](./nodejs) | HTTP, filesystem, child processes |
| React | [React](./react) | Client-side rendering, user interactions |

### Java / JVM

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Spring Boot | [Spring Boot](./spring-boot) | REST controllers, JPA, JDBC, messaging |
| Spring Boot (alt) | [Alternatives](./spring-boot-alternatives) | Micrometer, manual agent setup |
| Quarkus | [Quarkus](./quarkus) | REST endpoints, Hibernate, Kafka |

### Ruby

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Rails 6+ | [Rails](./rails) | Controllers, ActiveRecord, ActionCable, Sidekiq |
| Rails 5.x | [Rails Legacy](./rails-legacy) | Controllers, ActiveRecord (older SDK) |

### Go

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Go (net/http) | [Go](./go) | HTTP handlers, database/sql, gRPC |
| Axum | [Axum](./axum) | Handlers, middleware, tower layers |

### PHP

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Laravel | [Laravel](./laravel) | HTTP requests, Eloquent, queues, caching |

### .NET

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| ASP.NET Core | [.NET](./dotnet) | HTTP requests, EF Core, HttpClient |

### Elixir

| Framework | Guide | What's Instrumented |
|-----------|-------|---------------------|
| Phoenix | [Phoenix](./elixir-phoenix) | Controllers, Ecto, LiveView, PubSub |

## How Auto-Instrumentation Works

import ThemedImage from '@theme/ThemedImage';

<ThemedImage
  alt="Auto-instrumentation architecture diagram"
  sources={{
    light: '/img/docs/auto-instrumentation-architecture.png',
    dark: '/img/docs/auto-instrumentation-architecture-dark.png',
  }}
/>

## Next Steps

1. **Choose your framework** from the tables above
2. **Follow the guide** to add auto-instrumentation
3. **Add [custom instrumentation](../custom-instrumentation/)** for
   business-specific telemetry
