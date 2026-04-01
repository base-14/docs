---
title: Symfony OpenTelemetry Instrumentation - Doctrine, HTTP & Log Correlation
sidebar_label: Symfony
sidebar_position: 29
description:
  Symfony OpenTelemetry instrumentation guide - automatic tracing for HTTP
  requests, Doctrine ORM queries, and HTTP client calls. Export to base14 Scout.
keywords:
  [
    symfony opentelemetry,
    symfony opentelemetry instrumentation,
    symfony monitoring,
    php apm,
    doctrine tracing,
    symfony observability,
    symfony distributed tracing,
    symfony performance monitoring,
    php opentelemetry sdk,
    symfony production monitoring,
    symfony database monitoring,
    symfony metrics,
    symfony tracing,
    opentelemetry php,
    symfony telemetry,
    symfony http client tracing,
    symfony log correlation,
    symfony instrumentation guide,
    symfony doctrine monitoring,
    symfony auto instrumentation,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does OpenTelemetry impact Symfony performance?","acceptedAnswer":{"@type":"Answer","text":"OpenTelemetry adds approximately 2-4ms of latency per request in typical Symfony applications. With batch processing and GZIP compression enabled, the performance impact is minimal for production workloads."}},{"@type":"Question","name":"Which Symfony versions are supported?","acceptedAnswer":{"@type":"Answer","text":"OpenTelemetry supports Symfony 5.4+ with PHP 8.1+. Symfony 7.x or 8.x with PHP 8.3+ is recommended for optimal compatibility and performance."}},{"@type":"Question","name":"Are Doctrine ORM queries traced automatically?","acceptedAnswer":{"@type":"Answer","text":"Yes, installing opentelemetry-auto-pdo automatically captures all Doctrine queries as spans with database name, SQL statement, and operation type. No per-query code changes needed."}},{"@type":"Question","name":"Does the Symfony HTTP client propagate trace context?","acceptedAnswer":{"@type":"Answer","text":"Yes, the opentelemetry-auto-psr18 package automatically injects W3C traceparent headers into outgoing HTTP client requests, enabling distributed tracing across services."}},{"@type":"Question","name":"How do I correlate logs with traces?","acceptedAnswer":{"@type":"Answer","text":"Register a custom Monolog processor that reads the current span context and injects trace_id and span_id into every log record. Combined with JSON log formatting, this enables trace-log correlation in Scout Dashboard."}},{"@type":"Question","name":"Can I use OpenTelemetry with Symfony Messenger?","acceptedAnswer":{"@type":"Answer","text":"Yes, Symfony Messenger consumers can be instrumented with OpenTelemetry. The auto-symfony package traces HTTP-triggered dispatches, and you can add manual spans for async consumers."}},{"@type":"Question","name":"Can I use OpenTelemetry alongside other APM tools?","acceptedAnswer":{"@type":"Answer","text":"Yes, OpenTelemetry can run alongside tools like New Relic or Datadog during migration periods. However, running multiple APM agents simultaneously will multiply the performance overhead."}},{"@type":"Question","name":"How do I instrument multi-service Symfony architectures?","acceptedAnswer":{"@type":"Answer","text":"Each service gets its own OTEL_SERVICE_NAME. The Symfony HTTP client with opentelemetry-auto-psr18 automatically propagates W3C traceparent headers between services, creating linked traces visible in Scout Dashboard."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument Symfony with OpenTelemetry","step":[{"@type":"HowToStep","name":"Install the OpenTelemetry PHP extension","text":"Install build dependencies (gcc, make, autoconf), then install the OpenTelemetry PHP extension via PECL and enable it in php.ini."},{"@type":"HowToStep","name":"Install required Composer packages","text":"Install open-telemetry/sdk, open-telemetry/exporter-otlp, open-telemetry/opentelemetry-auto-symfony, and open-telemetry/opentelemetry-auto-pdo via Composer."},{"@type":"HowToStep","name":"Configure OpenTelemetry environment","text":"Set OTEL_PHP_AUTOLOAD_ENABLED=true, OTEL_SERVICE_NAME, and OTEL_EXPORTER_OTLP_ENDPOINT in your Symfony .env file. Register OTel factories in services.yaml."},{"@type":"HowToStep","name":"Run and verify instrumentation","text":"Start the Symfony application, make test requests, and verify traces for HTTP requests, Doctrine queries, and HTTP client calls appear in base14 Scout."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

Implement OpenTelemetry instrumentation for Symfony applications to enable
automatic distributed tracing, Doctrine ORM query monitoring, HTTP client
tracing, and structured log correlation. This guide shows you how to
auto-instrument your Symfony application to collect traces, metrics, and logs
from HTTP requests, database queries, service-to-service calls, and custom
business logic using the OpenTelemetry PHP SDK.

Symfony applications benefit from automatic instrumentation of the framework's
core components including the HTTP kernel, Doctrine ORM (via PDO), the HTTP
client (PSR-18), and Monolog logging. With OpenTelemetry, you can monitor
production performance, debug slow requests, trace distributed transactions
across microservices, and correlate logs with traces without significant code
changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations and best practices for
Symfony OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Symfony-focused overview based on the
> official OpenTelemetry documentation. For complete PHP language information,
> please consult the
> [official OpenTelemetry PHP documentation](https://opentelemetry.io/docs/languages/php/).

:::tip TL;DR

Install the OpenTelemetry PHP extension, add the SDK and auto-instrumentation
packages via Composer, and set `OTEL_PHP_AUTOLOAD_ENABLED=true` in your `.env`.
HTTP requests, Doctrine queries, and HTTP client calls are traced automatically.
Register an `OtelTraceProcessor` in `services.yaml` for log correlation. Export
everything to base14 Scout via OTLP.

:::

## Who This Guide Is For

This documentation is designed for:

- **Symfony developers**: implementing observability and distributed tracing
  for the first time
- **Enterprise teams**: running Symfony in production with monitoring
  requirements
- **DevOps engineers**: deploying Symfony applications with telemetry
  pipelines
- **Engineering teams**: migrating from Datadog, New Relic, or other
  commercial APM solutions
- **Platform teams**: standardizing observability across multiple Symfony
  services

## Overview

This guide demonstrates how to:

- Install and configure the OpenTelemetry PHP extension and SDK for Symfony
- Set up automatic instrumentation for HTTP requests, Doctrine ORM, and the
  HTTP client
- Configure Monolog log correlation with trace context (trace_id, span_id)
- Wire OpenTelemetry interfaces into Symfony's service container
- Deploy instrumented Symfony applications with Docker Compose
- Implement custom spans and business metrics
- Trace requests across multiple Symfony services (distributed tracing)
- Troubleshoot common instrumentation issues

## Prerequisites

Before starting, ensure you have:

- **PHP 8.1 or later** (PHP 8.3+ recommended for best performance)
  - The `opentelemetry` PECL extension requires build tools (gcc, make,
    autoconf)
- **Symfony 5.4 or later** installed
  - Symfony 7.x or 8.x is recommended for optimal OpenTelemetry support
  - Symfony 5.4 and 6.x are supported but may require additional
    configuration
- **Composer 2.0+** for dependency management
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component                    | Minimum Version | Recommended Version |
| ---------------------------- | --------------- | ------------------- |
| PHP                          | 8.1.0           | 8.4.0+              |
| Symfony                      | 5.4.0           | 7.2.0+ / 8.0.0+    |
| Composer                     | 2.0.0           | 2.7.0+              |
| OpenTelemetry PHP Extension  | 1.0.0           | Latest stable       |
| OpenTelemetry SDK            | 1.0.0           | 1.14.0+             |
| Doctrine ORM                 | 2.14.0          | 3.6.0+              |

### Instrumented Components

| Component             | Package                              | Coverage                               |
| --------------------- | ------------------------------------ | -------------------------------------- |
| Symfony HTTP Kernel   | `opentelemetry-auto-symfony`         | Routes, controllers, middleware        |
| Doctrine ORM / PDO    | `opentelemetry-auto-pdo`             | All SQL queries, transactions          |
| HTTP Client (PSR-18)  | `opentelemetry-auto-psr18`           | Outgoing HTTP calls, W3C propagation   |
| Monolog (PSR-3)       | `opentelemetry-auto-psr3`            | Log export to collector                |
| Custom Business Logic | `open-telemetry/sdk` (manual spans)  | Any code you instrument manually       |

### Example Application

This guide references the
[symfony-mysql](https://github.com/base-14/examples/tree/main/php/symfony-mysql)
example: a Symfony 8 REST API with Doctrine ORM, a notification microservice,
and full OpenTelemetry instrumentation.

## Installation

### Step 1: Install OpenTelemetry PHP Extension

The OpenTelemetry PHP extension provides the hooks for automatic
instrumentation.

#### Install Build Dependencies

```mdx-code-block
<Tabs>
<TabItem value="ubuntu" label="Ubuntu/Debian" default>
```

```bash
sudo apt-get install gcc make autoconf
```

```mdx-code-block
</TabItem>
<TabItem value="alpine" label="Alpine">
```

```bash
apk add --no-cache autoconf build-base
```

```mdx-code-block
</TabItem>
<TabItem value="macos" label="macOS">
```

```bash
xcode-select --install
```

```mdx-code-block
</TabItem>
</Tabs>
```

#### Install Extension via PECL

```bash
pecl install opentelemetry
```

#### Enable Extension in php.ini

```ini title="php.ini"
[opentelemetry]
extension=opentelemetry.so
```

#### Verify Installation

```bash
php -m | grep opentelemetry
```

Expected output:

```plaintext
opentelemetry
```

### Step 2: Install Required Packages

Install the OpenTelemetry SDK and auto-instrumentation packages via Composer:

```bash
composer require \
    open-telemetry/sdk \
    open-telemetry/exporter-otlp \
    open-telemetry/opentelemetry-auto-symfony \
    open-telemetry/opentelemetry-auto-pdo \
    open-telemetry/opentelemetry-auto-psr18 \
    open-telemetry/opentelemetry-auto-psr3
```

This installs:

- **SDK + OTLP exporter** - Core telemetry pipeline
- **auto-symfony** - HTTP kernel, routing, and controller spans
- **auto-pdo** - Doctrine ORM / PDO query spans
- **auto-psr18** - Outgoing HTTP client spans with W3C trace propagation
- **auto-psr3** - Log export to the collector via Monolog

**Optional: PSR-7 implementation** (required if not already present):

```bash
composer require nyholm/psr7
```

## Configuration

OpenTelemetry Symfony instrumentation supports multiple configuration
approaches. Environment variables are the recommended method for most
deployments.

```mdx-code-block
<Tabs>
<TabItem value="env-vars" label="Environment Variables" default>
```

Add these to your Symfony `.env` file:

```bash title=".env"
# OpenTelemetry Configuration
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=symfony-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PHP_PSR3_MODE=export
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development
```

Setting `OTEL_PHP_AUTOLOAD_ENABLED=true` is all it takes to start collecting
traces from Symfony HTTP requests, Doctrine queries, and HTTP client calls.

```mdx-code-block
</TabItem>
<TabItem value="service-container" label="Service Container">
```

Wire the OpenTelemetry global factories into Symfony's dependency injection
container. This lets you inject `MeterProviderInterface` and
`TracerProviderInterface` into any service.

```yaml title="config/services.yaml" showLineNumbers
services:
    _defaults:
        autowire: true
        autoconfigure: true

    App\:
        resource: '../src/'
        exclude:
            - '../src/Entity/'
            - '../src/Kernel.php'

    # Wire OTel meter provider for custom metrics
    OpenTelemetry\API\Metrics\MeterProviderInterface:
        factory: ['OpenTelemetry\API\Globals', 'meterProvider']

    # Wire OTel tracer provider for custom spans
    OpenTelemetry\API\Trace\TracerProviderInterface:
        factory: ['OpenTelemetry\API\Globals', 'tracerProvider']
```

This uses Symfony's factory pattern to expose the OTel SDK globals as
injectable services. Any controller or service can now type-hint
`MeterProviderInterface` or `TracerProviderInterface` in its constructor.

```mdx-code-block
</TabItem>
<TabItem value="docker-compose" label="Docker Compose">
```

For local development with a full observability stack, use Docker Compose to
run your Symfony app alongside MySQL and the OpenTelemetry Collector:

```yaml title="compose.yml" showLineNumbers
x-otel-env: &otel-env
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_PHP_AUTOLOAD_ENABLED: "true"
  OTEL_PHP_PSR3_MODE: export
  OTEL_RESOURCE_ATTRIBUTES: deployment.environment=development

x-db-env: &db-env
  DATABASE_URL: mysql://symfony:secret@db:3306/symfony?serverVersion=8.4

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.148.0
    container_name: symfony-otel-collector
    ports:
      - "4317:4317"
      - "4318:4318"
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-contrib/config.yaml
    environment:
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT}
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL}
    restart: unless-stopped

  db:
    image: mysql:8.4
    container_name: symfony-mysql
    environment:
      MYSQL_DATABASE: symfony
      MYSQL_USER: symfony
      MYSQL_PASSWORD: secret
      MYSQL_ROOT_PASSWORD: rootsecret
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test:
        [
          "CMD",
          "mysqladmin",
          "ping",
          "-h",
          "localhost",
          "-u",
          "root",
          "-prootsecret",
        ]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  app:
    build:
      context: ./app
      dockerfile: Dockerfile
    container_name: symfony-app
    command: >
      bash -c "php bin/console doctrine:migrations:migrate
      --no-interaction;
      php -S 0.0.0.0:8080 -t public"
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      <<: [*otel-env, *db-env]
      APP_ENV: dev
      APP_DEBUG: "true"
      APP_SECRET: symfony-example-secret
      OTEL_SERVICE_NAME: symfony-articles
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started
    restart: unless-stopped

volumes:
  mysql-data:
```

The YAML anchor `&otel-env` lets you share OpenTelemetry environment variables
across multiple services without duplication.

```mdx-code-block
</TabItem>
</Tabs>
```

### Configure Doctrine ORM

Standard Doctrine configuration works out of the box. The `opentelemetry-auto-pdo`
package intercepts all PDO calls, including those from Doctrine DBAL:

```yaml title="config/packages/doctrine.yaml" showLineNumbers
doctrine:
    dbal:
        url: '%env(resolve:DATABASE_URL)%'
        driver: pdo_mysql
        server_version: '8.4'
        charset: utf8mb4
    orm:
        naming_strategy: doctrine.orm.naming_strategy.underscore_number_aware
        auto_mapping: true
        mappings:
            App:
                type: attribute
                is_bundle: false
                dir: '%kernel.project_dir%/src/Entity'
                prefix: 'App\Entity'
                alias: App
```

### Configure Monolog for Log Correlation

Set up structured JSON logging with trace context injection. Create a custom
Monolog processor that reads the current span and injects `trace_id` and
`span_id` into every log record:

```php title="src/Service/OtelTraceProcessor.php" showLineNumbers
<?php

namespace App\Service;

use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;
use OpenTelemetry\API\Trace\Span;

class OtelTraceProcessor implements ProcessorInterface
{
    public function __invoke(LogRecord $record): LogRecord
    {
        $span = Span::getCurrent();
        $context = $span->getContext();

        return $record->with(extra: array_merge($record->extra, [
            'trace_id' => $context->getTraceId(),
            'span_id' => $context->getSpanId(),
            'service.name' => $_ENV['OTEL_SERVICE_NAME'] ?? 'symfony-app',
        ]));
    }
}
```

Register the processor in `services.yaml`:

```yaml title="config/services.yaml"
services:
    App\Service\OtelTraceProcessor:
        tags:
            - { name: monolog.processor }
```

Configure Monolog to output JSON to stdout (container-friendly):

```yaml title="config/packages/monolog.yaml" showLineNumbers
monolog:
    handlers:
        main:
            type: stream
            path: php://stdout
            level: info
            formatter: monolog.formatter.json
            channels: ['!event', '!doctrine']
        doctrine:
            type: stream
            path: php://stdout
            level: warning
            formatter: monolog.formatter.json
            channels: ['doctrine']
    channels: ['app']
```

Every log line now includes `trace_id` and `span_id`, enabling you to jump
from a log entry in Scout directly to the corresponding trace.

### Scout Collector Integration

When using Scout Collector, configure your Symfony application to export
telemetry with OAuth2 authentication:

```bash title=".env"
# Scout Collector Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token

# Service Configuration
OTEL_SERVICE_NAME=symfony-app
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions across
> your Symfony services.

## Production Configuration

Production deployments require tuning for performance, reliability, and
resource utilization.

### Production Environment Variables

```bash title=".env.production"
# Application Settings
APP_ENV=production
APP_DEBUG=false

# OpenTelemetry Service Configuration
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=symfony-app
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
OTEL_EXPORTER_OTLP_TIMEOUT=10

# Batch Span Processor (Production Optimized)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY_MILLIS=5000
OTEL_BSP_EXPORT_TIMEOUT_MILLIS=30000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Propagators
OTEL_PROPAGATORS=baggage,tracecontext

# Resource Attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,host.name=${HOSTNAME}
```

Benefits of this configuration:

- GZIP compression reduces network bandwidth by 70-80%
- Batch processing minimizes network requests
- Resource attributes enable filtering by environment in Scout Dashboard

### Docker Production Configuration

Multi-stage Dockerfile that installs the OpenTelemetry extension and
optimizes for production:

```dockerfile title="Dockerfile" showLineNumbers
# syntax=docker/dockerfile:1

ARG PHP_VERSION=8.5

# Stage 1: Build dependencies
FROM php:${PHP_VERSION}-cli AS builder

WORKDIR /app

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    git unzip libzip-dev && \
    docker-php-ext-install pdo pdo_mysql zip && \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist \
    --ignore-platform-reqs

COPY . .
RUN composer dump-autoload --optimize --no-scripts

# Stage 2: Runtime
FROM php:${PHP_VERSION}-cli

WORKDIR /var/www/html

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    curl libzip-dev default-mysql-client && \
    docker-php-ext-install pdo pdo_mysql zip && \
    pecl install opentelemetry && \
    docker-php-ext-enable opentelemetry && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN groupadd --gid 1000 symfony && \
    useradd --uid 1000 --gid symfony --shell /bin/bash --create-home symfony

COPY --from=builder --chown=symfony:symfony /app /var/www/html

RUN mkdir -p var/cache var/log && \
    chown -R symfony:symfony var

USER symfony

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
```

Key details:

- **Multi-stage build** separates Composer install from runtime
- **PECL opentelemetry** extension installed in the runtime stage
- **Non-root user** (`symfony:1000`) for security
- **Health check** ensures the app is responsive

### Multi-Service Distributed Tracing

For architectures with multiple Symfony services, each service gets its own
`OTEL_SERVICE_NAME`. The Symfony HTTP client with `opentelemetry-auto-psr18`
automatically propagates W3C `traceparent` headers between services.

Here's a notification microservice pattern from the example app:

```php title="src/Service/NotificationClient.php" showLineNumbers
<?php

namespace App\Service;

use Psr\Log\LoggerInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class NotificationClient
{
    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly LoggerInterface $logger,
        private readonly string $notifyUrl,
    ) {}

    public function notifyArticleCreated(array $articleData): void
    {
        try {
            $response = $this->httpClient->request('POST', $this->notifyUrl . '/notify', [
                'json' => $articleData,
            ]);
            $response->getStatusCode();
        } catch (\Throwable $e) {
            $this->logger->warning('Notification failed', [
                'article_id' => $articleData['id'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
```

Wire it in `services.yaml` with the notify service URL:

```yaml title="config/services.yaml"
services:
    App\Service\NotificationClient:
        arguments:
            $notifyUrl: '%env(NOTIFY_URL)%'
```

Add the notification service to your Docker Compose:

```yaml title="compose.yml (excerpt)"
services:
  app:
    environment:
      OTEL_SERVICE_NAME: symfony-articles
      NOTIFY_URL: http://notify:8081

  notify:
    build:
      context: ./notify
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: symfony-notify
    ports:
      - "8081:8081"
```

When `app` calls `notify`, the trace spans from both services are linked
automatically. In Scout Dashboard, you'll see the full request flow:

```plaintext
symfony-articles: POST /api/articles
  +-- NotificationClient: POST http://notify:8081/notify
       +-- symfony-notify: POST /notify (linked trace)
```

## Symfony-Specific Features

### Automatic HTTP Request Tracing

The `opentelemetry-auto-symfony` package instruments the Symfony HTTP kernel
automatically. Every request creates a root span with:

- `http.method` - Request method (GET, POST, etc.)
- `http.route` - Matched route pattern (e.g., `/api/articles/{id}`)
- `http.status_code` - Response status code
- `http.target` - Request URI path

PHP attribute-based routing maps directly to span names:

```php
#[Route('/api/articles', name: 'article_list', methods: ['GET'])]
public function list(): JsonResponse
{
    // Auto-instrumented: creates span "GET /api/articles"
}

#[Route('/api/articles/{id}', name: 'article_show', methods: ['GET'])]
public function show(int $id): JsonResponse
{
    // Auto-instrumented: creates span "GET /api/articles/{id}"
    // Uses route pattern, not the actual ID (low cardinality)
}
```

### Doctrine ORM Query Tracing

All Doctrine queries are automatically traced via `opentelemetry-auto-pdo`.
Each query creates a span with these attributes:

- `db.system` - Database type (`mysql`, `pgsql`, `sqlite`)
- `db.name` - Database name
- `db.statement` - SQL query (parameters obfuscated)
- `db.operation` - Operation type (`SELECT`, `INSERT`, `UPDATE`, `DELETE`)

```php
// These Doctrine operations are all automatically traced:

// Repository query
$articles = $this->articleRepository->findPaginated($page, $perPage);

// Entity persist
$this->entityManager->persist($article);
$this->entityManager->flush();

// DQL query
$query = $this->entityManager->createQuery(
    'SELECT a FROM App\Entity\Article a WHERE a.title LIKE :term'
);
$results = $query->setParameter('term', '%symfony%')->getResult();
```

In Scout Dashboard, you'll see spans like:

```plaintext
SELECT articles ... WHERE ...  (db.system=mysql, db.operation=SELECT)
INSERT INTO articles ...       (db.system=mysql, db.operation=INSERT)
```

### Monolog Trace-Log Correlation

The `OtelTraceProcessor` registered earlier injects trace context into every
log entry. Combined with JSON formatting, each log line contains:

```json
{
  "message": "Article created",
  "context": { "article_id": 42 },
  "extra": {
    "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
    "span_id": "1a2b3c4d5e6f7a8b",
    "service.name": "symfony-articles"
  }
}
```

This enables you to:

- Search logs by `trace_id` to find all logs from a single request
- Jump from a trace in Scout to the corresponding log entries
- Correlate errors across services using shared trace context

### Service Container Integration

Symfony's dependency injection container makes it straightforward to inject
OpenTelemetry interfaces wherever you need custom instrumentation:

```yaml title="config/services.yaml"
services:
    # OTel factories - available for injection in any service
    OpenTelemetry\API\Metrics\MeterProviderInterface:
        factory: ['OpenTelemetry\API\Globals', 'meterProvider']

    OpenTelemetry\API\Trace\TracerProviderInterface:
        factory: ['OpenTelemetry\API\Globals', 'tracerProvider']
```

Then inject in any controller or service:

```php
use OpenTelemetry\API\Metrics\MeterProviderInterface;
use OpenTelemetry\API\Trace\TracerProviderInterface;

class ArticleController extends AbstractController
{
    public function __construct(
        private readonly ArticleRepository $articleRepository,
        MeterProviderInterface $meterProvider,
        TracerProviderInterface $tracerProvider,
    ) {
        // Use for custom metrics and spans
    }
}
```

## Custom Instrumentation

While automatic instrumentation covers HTTP requests, database queries, and
HTTP client calls, you can add custom spans and metrics for business logic.

### Custom Business Metrics

Inject `MeterProviderInterface` to create counters, histograms, and gauges
for business events:

```php title="src/Controller/ArticleController.php" showLineNumbers
<?php

namespace App\Controller;

use App\Entity\Article;
use App\Repository\ArticleRepository;
use App\Service\NotificationClient;
use OpenTelemetry\API\Metrics\MeterProviderInterface;
use OpenTelemetry\API\Metrics\CounterInterface;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/articles')]
class ArticleController extends AbstractController
{
    private readonly CounterInterface $articlesCreatedCounter;

    public function __construct(
        private readonly ArticleRepository $articleRepository,
        private readonly NotificationClient $notificationClient,
        private readonly LoggerInterface $logger,
        MeterProviderInterface $meterProvider,
    ) {
        $meter = $meterProvider->getMeter('symfony-articles');
        $this->articlesCreatedCounter = $meter->createCounter(
            'articles.created',
            'articles',
            'Number of articles created',
        );
    }

    #[Route('', name: 'article_create', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true);

        $article = new Article();
        $article->setTitle($payload['title']);
        $article->setBody($payload['body']);

        $this->articleRepository->save($article);
        $this->articlesCreatedCounter->add(1);
        $this->logger->info('Article created', ['article_id' => $article->getId()]);

        $this->notificationClient->notifyArticleCreated($article->toArray());

        return new JsonResponse([
            'data' => $article->toArray(),
            'meta' => ['trace_id' => $this->getTraceId()],
        ], Response::HTTP_CREATED);
    }

    private function getTraceId(): string
    {
        $span = \OpenTelemetry\API\Trace\Span::getCurrent();
        return $span->getContext()->getTraceId();
    }
}
```

The `articles.created` counter increments on every article creation. Use
`getTraceId()` to include the trace ID in API responses, helping clients
correlate their requests with backend traces.

### Manual Span Creation

Create custom spans for business-critical operations that aren't covered by
auto-instrumentation:

```php title="src/Service/ReportGenerator.php" showLineNumbers
<?php

namespace App\Service;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class ReportGenerator
{
    public function generate(int $userId, string $reportType): array
    {
        $tracer = Globals::tracerProvider()->getTracer('report-generator', '1.0.0');

        $span = $tracer->spanBuilder('generate_report')
            ->setSpanKind(SpanKind::KIND_INTERNAL)
            ->setAttribute('report.type', $reportType)
            ->setAttribute('user.id', $userId)
            ->startSpan();

        $scope = $span->activate();

        try {
            // Your report generation logic here
            $data = $this->queryReportData($userId, $reportType);
            $formatted = $this->formatReport($data);

            $span->setAttribute('report.row_count', count($data));
            $span->setStatus(StatusCode::STATUS_OK);

            return $formatted;
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### Adding Context to Existing Spans

Enrich auto-instrumented spans with business context using event listeners:

```php title="src/EventListener/TraceContextListener.php" showLineNumbers
<?php

namespace App\EventListener;

use OpenTelemetry\API\Trace\Span;
use Symfony\Component\HttpKernel\Event\RequestEvent;

class TraceContextListener
{
    public function onKernelRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $span = Span::getCurrent();
        $request = $event->getRequest();

        $span->setAttribute('http.request_id', $request->headers->get('X-Request-ID', ''));

        // Add tenant context for multi-tenant applications
        if ($tenantId = $request->headers->get('X-Tenant-ID')) {
            $span->setAttribute('tenant.id', $tenantId);
        }
    }
}
```

Register it in `services.yaml`:

```yaml title="config/services.yaml"
services:
    App\EventListener\TraceContextListener:
        tags:
            - { name: kernel.event_listener, event: kernel.request }
```

## Running Your Instrumented Application

### Development Mode

Start the Symfony development server with OpenTelemetry enabled:

```bash
# Set environment variables
export OTEL_PHP_AUTOLOAD_ENABLED=true
export OTEL_SERVICE_NAME=symfony-app-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf

# Start Symfony development server
php -S 0.0.0.0:8080 -t public
```

### Docker Deployment

Run the full stack with Docker Compose:

```bash
# Start all services (app, database, collector)
docker compose up --build

# Wait for services to be healthy
docker compose ps

# Verify the app is running
curl http://localhost:8080/api/health
```

Expected health check response:

```json
{ "data": { "status": "ok" } }
```

### Verifying Instrumentation

Make test requests and check that traces appear:

```bash
# Create an article
curl -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello OpenTelemetry", "body": "Tracing with Symfony"}'

# List articles
curl http://localhost:8080/api/articles

# Get a specific article
curl http://localhost:8080/api/articles/1
```

Each request generates a trace. The expected span hierarchy for a create
request:

```plaintext
POST /api/articles                    (SERVER   - auto-symfony)
  +-- ArticleController::create       (INTERNAL - auto-symfony)
       +-- INSERT INTO articles ...   (CLIENT   - auto-pdo)
       +-- POST http://notify:8081/notify (CLIENT - auto-psr18)
```

For a list request:

```plaintext
GET /api/articles                     (SERVER   - auto-symfony)
  +-- ArticleController::list         (INTERNAL - auto-symfony)
       +-- SELECT * FROM articles ... (CLIENT   - auto-pdo)
       +-- SELECT COUNT(*) ...        (CLIENT   - auto-pdo)
```

Check for:

- **Spans** with correct `service.name` and proper nesting
- **Logs** with `trace_id` and `span_id` in the JSON output
- **Metrics** with `articles.created` counter incrementing

## Troubleshooting

### Verifying OpenTelemetry Installation

```bash
# Verify extension is loaded
php -m | grep opentelemetry

# Check extension version
php -r "echo phpversion('opentelemetry');"

# Verify environment variables
php -r "echo getenv('OTEL_PHP_AUTOLOAD_ENABLED');"
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify the collector endpoint is reachable:

   ```bash
   curl -v http://localhost:4318/v1/traces
   ```

2. Check that autoload is enabled:

   ```bash
   php -r "echo getenv('OTEL_PHP_AUTOLOAD_ENABLED');"
   # Should output: true
   ```

3. Enable debug logging to see export errors:

   ```bash
   export OTEL_LOG_LEVEL=debug
   php -S 0.0.0.0:8080 -t public
   ```

4. Check collector logs for authentication errors:

   ```bash
   docker compose logs otel-collector
   ```

#### Issue: Doctrine/PDO queries not traced

**Solutions:**

1. Verify the `opentelemetry-auto-pdo` package is installed:

   ```bash
   composer show | grep opentelemetry-auto-pdo
   ```

2. Confirm the OpenTelemetry extension is loaded (required for all
   auto-instrumentation):

   ```bash
   php -m | grep opentelemetry
   ```

3. Ensure `OTEL_PHP_AUTOLOAD_ENABLED=true` is set. Without this, no
   auto-instrumentation packages activate.

#### Issue: Log correlation not working (missing trace_id)

**Solutions:**

1. Verify `OtelTraceProcessor` is registered in `services.yaml`:

   ```yaml
   App\Service\OtelTraceProcessor:
       tags:
           - { name: monolog.processor }
   ```

2. Ensure Monolog uses the JSON formatter:

   ```yaml
   monolog:
       handlers:
           main:
               formatter: monolog.formatter.json
   ```

3. Check that the processor class implements `ProcessorInterface`:

   ```bash
   grep "ProcessorInterface" src/Service/OtelTraceProcessor.php
   ```

#### Issue: OpenTelemetry extension not loaded

**Solutions:**

1. Verify PECL installation:

   ```bash
   pecl list | grep opentelemetry
   ```

2. Check that `php.ini` includes the extension:

   ```bash
   php --ini | head -1
   php -i | grep opentelemetry
   ```

3. Locate the extension file:

   ```bash
   find /usr -name "opentelemetry.so" 2>/dev/null
   ```

4. If using PHP-FPM, restart it after installing:

   ```bash
   sudo systemctl restart php8.4-fpm
   ```

#### Issue: High memory usage

**Solutions:**

1. Reduce the batch queue size:

   ```bash
   export OTEL_BSP_MAX_QUEUE_SIZE=1024
   ```

2. Increase export frequency to flush spans sooner:

   ```bash
   export OTEL_BSP_SCHEDULE_DELAY_MILLIS=2000
   ```

3. Check PHP memory limit:

   ```bash
   php -i | grep memory_limit
   ```

## Security Considerations

### Protecting Sensitive Data

Never add sensitive information to span attributes:

```php
// Bad - exposes sensitive data
$span->setAttribute('user.password', $user->getPassword());       // Never!
$span->setAttribute('user.email', $user->getEmail());             // PII risk
$span->setAttribute('payment.card_number', $request->get('cc'));  // Never!

// Good - uses safe identifiers
$span->setAttribute('user.id', $user->getId());
$span->setAttribute('user.role', $user->getRoleLabel());
$span->setAttribute('payment.provider', 'stripe');
$span->setAttribute('payment.status', 'completed');
```

### SQL Parameter Obfuscation

The `opentelemetry-auto-pdo` package automatically obfuscates SQL parameter
values in database spans:

```sql
-- What gets executed (never sent to collector)
SELECT * FROM users WHERE email = 'user@example.com' AND api_key = 'sk-abc123'

-- What appears in the span (obfuscated)
SELECT * FROM users WHERE email = ? AND api_key = ?
```

### Filtering HTTP Headers

Avoid capturing sensitive headers in spans. Configure which headers are
allowed:

```bash title=".env"
OTEL_HTTP_HEADERS_ALLOWED=content-type,accept,user-agent
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- SQL obfuscation is enabled by default for database queries
- Implement data retention policies in Scout Dashboard
- Audit span attributes regularly for sensitive data leaks

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead to Symfony applications:

- **Average latency increase**: 2-4ms per request
- **CPU overhead**: Less than 3% with batch processing
- **Memory overhead**: ~80-120MB depending on queue size and traffic

### Optimization Best Practices

#### 1. Use Batch Span Processing

```bash
# Production settings (low overhead)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY_MILLIS=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

#### 2. Enable GZIP Compression

```bash
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
```

Reduces network bandwidth by 70-80%.

#### 3. Enable OPcache

```ini title="php.ini"
[opcache]
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0
```

#### 4. Filter Health Check Endpoints

Configure the OTel Collector to drop noisy health check spans:

```yaml title="config/otel-config.yaml (excerpt)"
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'attributes["http.target"] == "/api/health"'
```

This keeps your trace data focused on meaningful application traffic.

## Frequently Asked Questions

### Does OpenTelemetry impact Symfony performance?

OpenTelemetry adds approximately 2-4ms of latency per request in typical
Symfony applications. With batch processing and GZIP compression enabled, the
performance impact is minimal. The `opentelemetry` PECL extension handles
instrumentation hooks at the C level, keeping PHP-side overhead low.

### Which Symfony versions are supported?

OpenTelemetry supports Symfony 5.4+ with PHP 8.1+. Symfony 7.x or 8.x with
PHP 8.3+ is recommended. The `opentelemetry-auto-symfony` package hooks into
Symfony's HTTP kernel, which has been stable across major versions.

### Are Doctrine ORM queries traced automatically?

Yes. The `opentelemetry-auto-pdo` package intercepts all PDO calls, which
includes every query Doctrine executes through DBAL. You get spans for
`SELECT`, `INSERT`, `UPDATE`, and `DELETE` operations with the SQL statement
(parameters obfuscated) and database metadata.

### Does the Symfony HTTP client propagate trace context?

Yes. The `opentelemetry-auto-psr18` package automatically injects W3C
`traceparent` headers into outgoing HTTP requests made via Symfony's
`HttpClientInterface`. This enables distributed tracing across services with
no code changes.

### How do I instrument Symfony Messenger consumers?

The `opentelemetry-auto-symfony` package traces HTTP-triggered message
dispatches. For async consumers (workers), add manual spans around message
handling:

```php
#[AsMessageHandler]
class OrderHandler
{
    public function __invoke(OrderCreated $message): void
    {
        $tracer = Globals::tracerProvider()->getTracer('messenger');
        $span = $tracer->spanBuilder('handle_order_created')
            ->setSpanKind(SpanKind::KIND_CONSUMER)
            ->setAttribute('messaging.system', 'symfony_messenger')
            ->setAttribute('order.id', $message->orderId)
            ->startSpan();

        $scope = $span->activate();
        try {
            // Handle the message
            $span->setStatus(StatusCode::STATUS_OK);
        } catch (\Throwable $e) {
            $span->recordException($e);
            $span->setStatus(StatusCode::STATUS_ERROR);
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### Can I use OpenTelemetry with Symfony Flex recipes?

There is no official Symfony Flex recipe for OpenTelemetry yet. Configuration
is done via environment variables and `services.yaml` as shown in this guide.
The setup is straightforward and doesn't require a recipe.

### How do I monitor multi-service Symfony architectures?

Each service gets its own `OTEL_SERVICE_NAME`. The Symfony HTTP client with
`opentelemetry-auto-psr18` automatically propagates W3C `traceparent` headers
between services. In Scout Dashboard, you'll see linked traces spanning all
services in a single request flow.

### Can I use OpenTelemetry alongside other APM tools?

Yes, OpenTelemetry can run alongside tools like New Relic or Datadog during
migration periods. However, running multiple APM agents simultaneously
multiplies the performance overhead. Plan your migration to run both tools
temporarily, then remove the legacy agent.

### How do I add tenant context in multi-tenant Symfony applications?

Use a kernel event listener to add tenant attributes to every span:

```php
class TenantContextListener
{
    public function onKernelRequest(RequestEvent $event): void
    {
        $span = Span::getCurrent();
        $tenantId = $event->getRequest()->headers->get('X-Tenant-ID');
        if ($tenantId) {
            $span->setAttribute('tenant.id', $tenantId);
        }
    }
}
```

Then filter traces by `tenant.id` in Scout Dashboard.

### Does OpenTelemetry work with Symfony CLI?

Yes. The Symfony CLI development server (`symfony server:start`) works with
OpenTelemetry. Set the environment variables in your `.env.local` file and
the CLI will pass them through to the PHP process.

## What's Next?

Now that your Symfony application is instrumented with OpenTelemetry, explore
these resources to deepen your observability:

### Advanced Topics

- **Custom PHP Instrumentation** - Manual tracing, custom spans, and
  advanced instrumentation patterns
- **MySQL Monitoring Best Practices** - Database observability with
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

- [Laravel Instrumentation](./laravel.md) - PHP Laravel framework
- [Slim Instrumentation](./slim.md) - PHP Slim micro-framework
- [Rails Instrumentation](./rails.md) - Ruby on Rails
- [Django Instrumentation](./django.md) - Python Django
- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot

## Complete Example

### Project Structure

```plaintext
symfony-mysql/
+-- app/
|   +-- config/
|   |   +-- packages/
|   |   |   +-- doctrine.yaml
|   |   |   +-- framework.yaml
|   |   |   +-- monolog.yaml
|   |   +-- services.yaml
|   +-- src/
|   |   +-- Controller/
|   |   |   +-- ArticleController.php
|   |   |   +-- HealthController.php
|   |   +-- Entity/
|   |   |   +-- Article.php
|   |   +-- Repository/
|   |   |   +-- ArticleRepository.php
|   |   +-- Service/
|   |       +-- NotificationClient.php
|   |       +-- OtelTraceProcessor.php
|   +-- composer.json
|   +-- Dockerfile
+-- notify/
|   +-- Dockerfile
|   +-- server.php
+-- config/
|   +-- otel-config.yaml
+-- compose.yml
+-- .env.example
```

### Running the Example

```bash
# Clone the examples repository
git clone https://github.com/base-14/examples.git
cd examples/php/symfony-mysql

# Copy environment file
cp .env.example .env

# Start the stack
docker compose up --build

# Wait for services to be healthy (~30 seconds)
curl http://localhost:8080/api/health
```

### Testing the API

```bash
# Create an article
curl -s -X POST http://localhost:8080/api/articles \
  -H "Content-Type: application/json" \
  -d '{"title": "OpenTelemetry with Symfony", "body": "Full observability"}' | jq .

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
- **Database spans** for every Doctrine query (SELECT, INSERT, UPDATE,
  DELETE)
- **HTTP client spans** for the notification service call (POST to notify)
- **Correlated logs** with `trace_id` and `span_id` in every log entry

```plaintext
POST /api/articles                           (2ms)
  +-- ArticleController::create              (1ms)
       +-- INSERT INTO articles ...          (3ms)
       +-- POST http://notify:8081/notify    (12ms)
            +-- [symfony-notify] POST /notify (8ms)
```

Once telemetry is flowing, you can monitor Symfony request performance in
Scout - track Doctrine query times, HTTP client latency, and error rates
from a unified dashboard.

## References

- [Official OpenTelemetry PHP Documentation](https://opentelemetry.io/docs/languages/php/)
- [OpenTelemetry PHP Auto-Instrumentation](https://opentelemetry.io/docs/languages/php/instrumentation/)
- [Symfony Documentation](https://symfony.com/doc/current/index.html)
- [Doctrine ORM Documentation](https://www.doctrine-project.org/projects/orm.html)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Set up collector for local development
- [Laravel Instrumentation](./laravel.md) - PHP Laravel framework
- [Slim Instrumentation](./slim.md) - PHP Slim micro-framework
- [Spring Boot Instrumentation](./spring-boot.md) - Java Spring Boot
- [Express.js Instrumentation](./express.md) - Node.js Express framework
