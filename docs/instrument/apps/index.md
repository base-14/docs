---
title: Application Instrumentation - OpenTelemetry Setup Guide | base14 Scout
sidebar_label: Overview
sidebar_position: 1
description:
  Complete guide to instrumenting applications with OpenTelemetry. Choose between auto-instrumentation for quick setup or custom instrumentation for fine-grained control.
keywords:
  [
    application instrumentation,
    opentelemetry setup,
    distributed tracing,
    apm,
    observability,
    auto instrumentation,
    custom instrumentation,
    base14 scout,
  ]
---

# Application Instrumentation

Add observability to your applications with OpenTelemetry. This guide helps you
choose the right approach and find documentation for your stack.

## Choose Your Approach

| Approach | Best For | Setup Time | Flexibility |
|----------|----------|------------|-------------|
| **[Auto-Instrumentation](./auto-instrumentation/)** | Quick start, standard frameworks | Minutes | Pre-defined spans |
| **[Custom Instrumentation](./custom-instrumentation/)** | Business metrics, fine control | Hours | Full control |
| **Both** | Production applications | Hours | Best of both |

## Quick Reference Matrix

Find your language and see what's available:

| Language | Auto-Instrumentation | Custom Instrumentation |
|----------|---------------------|------------------------|
| **Python** | [Django](./auto-instrumentation/django), [Flask](./auto-instrumentation/flask), [FastAPI](./auto-instrumentation/fast-api), [Celery](./auto-instrumentation/celery) | [Python SDK](./custom-instrumentation/python) |
| **Node.js** | [Express](./auto-instrumentation/express), [NestJS](./auto-instrumentation/nestjs), [Next.js](./auto-instrumentation/nextjs), [Node.js](./auto-instrumentation/nodejs) | [Node SDK](./custom-instrumentation/javascript-node) |
| **Java** | [Spring Boot](./auto-instrumentation/spring-boot), [Quarkus](./auto-instrumentation/quarkus) | [Java SDK](./custom-instrumentation/java) |
| **Go** | [Go](./auto-instrumentation/go), [Axum](./auto-instrumentation/axum) | [Go SDK](./custom-instrumentation/go) |
| **Ruby** | [Rails](./auto-instrumentation/rails), [Rails Legacy](./auto-instrumentation/rails-legacy) | [Ruby SDK](./custom-instrumentation/ruby) |
| **PHP** | [Laravel](./auto-instrumentation/laravel) | [PHP SDK](./custom-instrumentation/php) |
| **.NET** | [ASP.NET Core](./auto-instrumentation/dotnet) | [C# SDK](./custom-instrumentation/csharp) |
| **Elixir** | [Phoenix](./auto-instrumentation/elixir-phoenix) | — |
| **Rust** | — | [Rust SDK](./custom-instrumentation/rust) |
| **Browser** | [React](./auto-instrumentation/react) | [Browser SDK](./custom-instrumentation/javascript-browser) |

## Decision Guide

import ThemedImage from '@theme/ThemedImage';

<ThemedImage
  alt="Instrumentation decision flowchart"
  sources={{
    light: '/img/docs/instrumentation-decision-flowchart.png',
    dark: '/img/docs/instrumentation-decision-flowchart-dark.png',
  }}
/>

## What Gets Instrumented

### Auto-Instrumentation Captures

- **HTTP requests** - Incoming and outgoing, with method, status, URL
- **Database queries** - SQL statements, connection info, duration
- **External API calls** - gRPC, REST, message queues
- **Framework internals** - Middleware, routing, templating

### Custom Instrumentation Adds

- **Business transactions** - Order processing, payment flows
- **User context** - User ID, tenant ID, session info
- **Custom metrics** - Conversion rates, queue depths, cache hit ratios
- **Domain-specific spans** - Algorithm execution, batch processing

## Next Steps

1. **New to OpenTelemetry?** Start with [auto-instrumentation](./auto-instrumentation/)
2. **Need business metrics?** Add [custom instrumentation](./custom-instrumentation/)
3. **Need to collect data?** Set up the [OpenTelemetry Collector](../collector-setup/docker-compose-example.md)
