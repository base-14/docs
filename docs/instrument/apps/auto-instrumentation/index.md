---
title:
  Auto-Instrumentation Overview - Zero-Code OpenTelemetry Setup | base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  Zero-code OpenTelemetry auto-instrumentation for Python, Node.js, Java, Go,
  Rust, Ruby, PHP, .NET, and Elixir frameworks. Get traces, metrics, and logs
  with minimal setup.
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

| Use Case                          | Recommendation                                              |
| --------------------------------- | ----------------------------------------------------------- |
| Quick proof-of-concept            | ✅ Auto-instrumentation                                     |
| Standard HTTP/database operations | ✅ Auto-instrumentation                                     |
| Business-specific metrics         | ❌ Use [custom instrumentation](../custom-instrumentation/) |
| Fine-grained span control         | ❌ Use [custom instrumentation](../custom-instrumentation/) |
| Legacy framework not supported    | ❌ Use [custom instrumentation](../custom-instrumentation/) |

## Frameworks by Language

### Python

| Framework  | Guide                      | What's Instrumented                                                              |
| ---------- | -------------------------- | -------------------------------------------------------------------------------- |
| Django     | [Django](./django)         | HTTP requests, ORM queries, middleware, templates, Celery tasks                  |
| Flask      | [Flask](./flask)           | HTTP requests, Jinja2 templates, SQLAlchemy                                      |
| FastAPI    | [FastAPI](./fast-api)      | HTTP requests, async handlers, Pydantic validation                               |
| Celery     | [Celery](./celery)         | Task execution, retries, worker lifecycle                                        |
| LangGraph  | [LangGraph](./langgraph)   | Agent pipelines, LLM calls, tool nodes, conditional routing, token/cost tracking |
| LlamaIndex | [LlamaIndex](./llamaindex) | LLM calls, structured output, token/cost tracking, quality evaluation            |

### Node.js

| Framework         | Guide                | What's Instrumented                               |
| ----------------- | -------------------- | ------------------------------------------------- |
| Express           | [Express](./express) | HTTP requests, middleware, routing                |
| Fastify           | [Fastify](./fastify) | HTTP requests, hooks, plugins, PostgreSQL, BullMQ |
| Hono              | [Hono](./hono)       | HTTP requests, middleware, PostgreSQL, BullMQ     |
| NestJS            | [NestJS](./nestjs)   | Controllers, services, guards, interceptors       |
| Next.js           | [Next.js](./nextjs)  | SSR, API routes, middleware, React components     |
| Node.js (generic) | [Node.js](./nodejs)  | HTTP, filesystem, child processes                 |
| React             | [React](./react)     | Client-side rendering, user interactions          |

### Java / JVM

| Framework         | Guide                                      | What's Instrumented                    |
| ----------------- | ------------------------------------------ | -------------------------------------- |
| Spring Boot       | [Spring Boot](./spring-boot)               | REST controllers, JPA, JDBC, messaging |
| Spring Boot (alt) | [Alternatives](./spring-boot-alternatives) | Micrometer, manual agent setup         |
| Quarkus           | [Quarkus](./quarkus)                       | REST endpoints, Hibernate, Kafka       |

### Ruby

| Framework                | Guide                          | What's Instrumented                             |
| ------------------------ | ------------------------------ | ----------------------------------------------- |
| Rails 6+ (Ruby 3.1+)     | [Rails](./rails)               | Controllers, ActiveRecord, ActionCable, Sidekiq |
| Rails 5.x–6.1 (EOL Ruby) | [Rails Legacy](./rails-legacy) | Controllers, ActiveRecord (pinned SDK versions) |

### Go

| Framework     | Guide      | What's Instrumented               |
| ------------- | ---------- | --------------------------------- |
| Go (net/http) | [Go](./go) | HTTP handlers, database/sql, gRPC |

### Rust

| Framework | Guide                    | What's Instrumented                         |
| --------- | ------------------------ | ------------------------------------------- |
| Actix Web | [Actix Web](./actix-web) | HTTP requests, middleware, database queries |
| Axum      | [Axum](./axum)           | Handlers, middleware, tower layers          |

### PHP

| Framework       | Guide                | What's Instrumented                              |
| --------------- | -------------------- | ------------------------------------------------ |
| Laravel         | [Laravel](./laravel) | HTTP requests, Eloquent, queues, caching         |
| Slim 4 / Slim 3 | [Slim](./slim)       | HTTP requests, MongoDB, metrics, log correlation |

### .NET

| Framework    | Guide            | What's Instrumented                |
| ------------ | ---------------- | ---------------------------------- |
| ASP.NET Core | [.NET](./dotnet) | HTTP requests, EF Core, HttpClient |

### Elixir

| Framework | Guide                       | What's Instrumented                 |
| --------- | --------------------------- | ----------------------------------- |
| Phoenix   | [Phoenix](./elixir-phoenix) | Controllers, Ecto, LiveView, PubSub |

## How Auto-Instrumentation Works

import ThemedImage from '@theme/ThemedImage';

<ThemedImage alt="Auto-instrumentation architecture diagram" sources={{
    light: '/img/docs/auto-instrumentation-architecture.png',
    dark: '/img/docs/auto-instrumentation-architecture-dark.png',
  }} />

## Next Steps

1. **Choose your framework** from the tables above
2. **Follow the guide** to add auto-instrumentation
3. **Add [custom instrumentation](../custom-instrumentation/)** for
   business-specific telemetry
