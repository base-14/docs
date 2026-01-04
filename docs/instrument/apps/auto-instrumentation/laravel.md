---
title: Laravel OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Laravel
sidebar_position: 8
description:
  Laravel OpenTelemetry instrumentation for traces, Eloquent database
  monitoring, and queue tracing with base14 Scout.
keywords:
  [
    laravel opentelemetry instrumentation,
    laravel monitoring,
    php apm,
    laravel application performance monitoring,
    opentelemetry laravel,
    laravel distributed tracing,
    eloquent query monitoring,
    laravel observability,
    laravel performance monitoring,
    php opentelemetry sdk,
    laravel production monitoring,
    laravel database monitoring,
    laravel metrics,
    laravel tracing,
    laravel queue monitoring,
    laravel n+1 queries,
    laravel instrumentation guide,
    opentelemetry php,
    laravel telemetry,
    laravel cache monitoring,
  ]
---

# Laravel

Implement OpenTelemetry instrumentation for Laravel applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability. This guide shows you how to auto-instrument your Laravel application
to collect traces and metrics from HTTP requests, database queries, background
jobs, cache operations, and custom business logic using the OpenTelemetry PHP SDK.

Laravel applications benefit from automatic instrumentation of popular frameworks
and libraries including Eloquent ORM, HTTP client requests (Guzzle), Redis, queue
workers, and dozens of commonly used packages. With OpenTelemetry, you can monitor
production performance, debug slow requests, trace distributed transactions across
microservices, and identify database bottlenecks without significant code changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions, or troubleshooting performance issues in production,
this guide provides production-ready configurations and best practices for
Laravel OpenTelemetry instrumentation.

> **Note:** This guide provides a practical Laravel-focused overview based on the
> official OpenTelemetry documentation. For complete PHP language information,
> please consult the [official OpenTelemetry PHP documentation](https://opentelemetry.io/docs/languages/php/).

## Who This Guide Is For

This documentation is designed for:

- **Laravel developers**: implementing observability and distributed tracing
  for the first time
- **DevOps engineers**: deploying Laravel applications with production
  monitoring requirements
- **Engineering teams**: migrating from DataDog, New Relic, or other
  commercial APM solutions
- **Developers**: debugging performance issues, slow database queries, or N+1
  problems in Laravel applications
- **Platform teams**: standardizing observability across multiple Laravel
  services

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK and PHP extension for Laravel
  applications
- Set up automatic instrumentation for HTTP requests, database queries, and
  popular packages
- Configure production-ready telemetry export to Scout Collector
- Implement custom instrumentation for business-critical operations
- Collect and analyze traces, metrics, and performance data
- Deploy instrumented Laravel applications to development, staging, and
  production environments
- Troubleshoot common instrumentation issues and optimize performance
- Secure sensitive data in telemetry exports

## Prerequisites

Before starting, ensure you have:

- **PHP 8.0 or later** (PHP 8.1+ recommended for best performance and compatibility)
  - For production deployments, PHP 8.2+ is recommended
  - JIT support in PHP 8.0+ improves instrumentation performance
- **Laravel 8.0 or later** installed
  - Laravel 10.x or 11.x is recommended for optimal OpenTelemetry support
  - Laravel 8.x and 9.x are supported but may require additional configuration
- **Composer 2.0+** for dependency management
- **Scout Collector** configured and accessible
  - See [Docker Compose Setup](../../collector-setup/docker-compose-example.md)
    for local development
  - Production deployments should use a dedicated Scout Collector instance
- **Build tools** for compiling the OpenTelemetry PHP extension (gcc, make,
  autoconf)
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component | Minimum Version | Recommended Version |
|-----------|----------------|---------------------|
| PHP | 8.0.0 | 8.2.0+ |
| Laravel | 8.0.0 | 11.0.0+ |
| Composer | 2.0.0 | 2.7.0+ |
| OpenTelemetry PHP Extension | 1.0.0 | Latest stable |
| OpenTelemetry SDK | 1.0.0 | 1.6.0+ |

## Installation

### Step 1: Install OpenTelemetry PHP Extension

The OpenTelemetry PHP extension provides automatic instrumentation capabilities.

#### Install Build Dependencies

```bash showLineNumbers
# Ubuntu/Debian
sudo apt-get install gcc make autoconf

# Alpine Linux (Docker)
apk add --no-cache autoconf build-base

# macOS
xcode-select --install
```

#### Install Extension via PECL

```bash showLineNumbers
pecl install opentelemetry
```

#### Enable Extension in php.ini

Add the extension to your `php.ini` file:

```ini showLineNumbers title="php.ini"
[opentelemetry]
extension=opentelemetry.so
```

#### Verify Installation

```bash showLineNumbers
php -m | grep opentelemetry
```

Expected output:

```plaintext
opentelemetry
```

### Step 2: Install Required Packages

Install the necessary OpenTelemetry packages via Composer:

```bash showLineNumbers
composer require \
    open-telemetry/sdk \
    open-telemetry/exporter-otlp \
    open-telemetry/opentelemetry-auto-laravel
```

**Optional packages for additional functionality:**

```bash showLineNumbers
# For PSR-18 HTTP client instrumentation (Guzzle, etc.)
composer require open-telemetry/opentelemetry-auto-psr18

# For complete auto-instrumentation (includes all available instrumentations)
composer require open-telemetry/opentelemetry-auto-slim
```

## Configuration

OpenTelemetry Laravel instrumentation can be configured using multiple approaches
depending on your deployment requirements and preferences. Choose the method that
best fits your application architecture.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="env-vars" label="Environment Variables (Recommended)" default>
```

The recommended approach for Laravel is using environment variables. This
provides flexibility and keeps configuration separate from your application code.

### Configure .env File

```bash showLineNumbers title=".env"
# OpenTelemetry Configuration
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=laravel-app
OTEL_SERVICE_VERSION=1.0.0
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_PROPAGATORS=baggage,tracecontext
```

This configuration automatically instruments all supported Laravel components including:

- **Laravel Core**: HTTP routing, middleware, controllers, views
- **Eloquent ORM**: Database queries, model events
- **HTTP Clients**: Guzzle, PSR-18 clients
- **Databases**: MySQL, PostgreSQL, SQLite, SQL Server
- **Caching**: Redis, Memcached, File cache
- **Queue Workers**: Redis, Database, SQS queues
- **External APIs**: HTTP requests with distributed trace propagation

```mdx-code-block
</TabItem>
<TabItem value="service-provider" label="Service Provider Config">
```

For applications requiring programmatic configuration, create a custom service provider:

```php showLineNumbers title="app/Providers/OpenTelemetryServiceProvider.php"
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use OpenTelemetry\SDK\Sdk;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;

class OpenTelemetryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $resource = ResourceInfoFactory::defaultResource()->merge(
            ResourceInfo::create(
                Attributes::create([
                    'service.name' => config('app.name'),
                    'service.version' => config('app.version', '1.0.0'),
                    'deployment.environment' => config('app.env'),
                ])
            )
        );

        // Create transport for OTLP exporter
        $transport = (new OtlpHttpTransportFactory())->create(
            config('otel.exporter.endpoint', 'http://localhost:4318'),
            'application/x-protobuf'
        );

        $exporter = new SpanExporter($transport);

        $tracerProvider = new TracerProvider(
            new BatchSpanProcessor($exporter),
            null,
            $resource
        );

        Sdk::builder()
            ->setTracerProvider($tracerProvider)
            ->build();
    }
}
```

Register the service provider in `config/app.php`:

```php showLineNumbers title="config/app.php"
'providers' => [
    // Other Service Providers
    App\Providers\OpenTelemetryServiceProvider::class,
],
```

```mdx-code-block
</TabItem>
<TabItem value="bootstrap" label="Bootstrap Configuration">
```

For early initialization, configure OpenTelemetry in your bootstrap files:

```php showLineNumbers title="bootstrap/app.php"
<?php

require __DIR__.'/../vendor/autoload.php';

use Illuminate\Foundation\Application;

// Configure OpenTelemetry before application boots
if (env('OTEL_PHP_AUTOLOAD_ENABLED', false)) {
    putenv('OTEL_SERVICE_NAME=' . env('OTEL_SERVICE_NAME', 'laravel-app'));
    putenv('OTEL_EXPORTER_OTLP_ENDPOINT=' . env('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318'));
    putenv('OTEL_EXPORTER_OTLP_PROTOCOL=' . env('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf'));
    putenv('OTEL_TRACES_EXPORTER=' . env('OTEL_TRACES_EXPORTER', 'otlp'));
}

$app = new Application(
    $_ENV['APP_BASE_PATH'] ?? dirname(__DIR__)
);

// ... rest of bootstrap configuration
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker Environment">
```

For containerized deployments, configure environment variables in your
Dockerfile or docker-compose.yml:

```yaml showLineNumbers title="docker-compose.yml"
version: '3.8'

services:
  laravel-app:
    build: .
    environment:
      # Application Settings
      APP_NAME: laravel-app
      APP_ENV: production

      # OpenTelemetry Configuration
      OTEL_PHP_AUTOLOAD_ENABLED: "true"
      OTEL_SERVICE_NAME: laravel-app
      OTEL_SERVICE_VERSION: "1.0.0"
      OTEL_TRACES_EXPORTER: otlp
      OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4318
      OTEL_PROPAGATORS: baggage,tracecontext
    depends_on:
      - scout-collector
    ports:
      - "8000:8000"

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4318:4318"
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Scout Collector Integration

When using Scout Collector, configure your Laravel application to send telemetry
data to the Scout Collector endpoint with OAuth2 authentication:

```bash showLineNumbers title=".env"
# Scout Collector Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token

# Service Configuration
OTEL_SERVICE_NAME=laravel-app
OTEL_SERVICE_VERSION=1.0.0
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions across
> your Laravel services.

## Production Configuration

Production deployments require additional configuration for optimal performance,
reliability, and resource utilization. This section covers production-specific
settings and best practices.

### Production Environment Variables

Create a production-optimized environment configuration:

```bash showLineNumbers title=".env.production"
# Application Settings
APP_NAME=laravel-app-production
APP_ENV=production
APP_DEBUG=false

# OpenTelemetry Service Configuration
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=laravel-app
OTEL_SERVICE_VERSION=2.1.3
OTEL_SERVICE_NAMESPACE=production

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

# Propagators
OTEL_PROPAGATORS=baggage,tracecontext,b3

# Batch Span Processor Settings (Production Optimized)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY_MILLIS=5000
OTEL_BSP_EXPORT_TIMEOUT_MILLIS=30000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512

# Resource Attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,host.name=${HOSTNAME},cloud.provider=aws,cloud.region=us-east-1
```

**Benefits of production configuration:**

- GZIP compression reduces network bandwidth by 70-80%
- Batch processing minimizes network requests by 95%
- Resource attributes enable filtering by environment and infrastructure
- Configurable timeouts prevent hanging exports

### Docker Production Configuration

For containerized Laravel applications, configure OpenTelemetry in your Docker setup:

```dockerfile showLineNumbers title="Dockerfile"
FROM php:8.2-fpm-alpine

# Install system dependencies
RUN apk add --no-cache \
    autoconf \
    build-base \
    postgresql-dev \
    libzip-dev \
    zip \
    unzip

# Install PHP extensions
RUN docker-php-ext-install pdo pdo_pgsql zip opcache

# Install OpenTelemetry extension
RUN pecl install opentelemetry && \
    docker-php-ext-enable opentelemetry

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Copy application files
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader --no-scripts

COPY . .

# Generate optimized autoloader
RUN composer dump-autoload --optimize

# Set production environment
ENV APP_ENV=production
ENV OTEL_PHP_AUTOLOAD_ENABLED=true
ENV OTEL_SERVICE_NAME=laravel-app
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318

# Optimize Laravel for production
RUN php artisan config:cache && \
    php artisan route:cache && \
    php artisan view:cache

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
```

```yaml showLineNumbers title="docker-compose.prod.yml"
version: '3.8'

services:
  laravel-app:
    build: .
    environment:
      APP_NAME: laravel-app
      APP_ENV: production
      APP_DEBUG: "false"

      # OpenTelemetry Configuration
      OTEL_PHP_AUTOLOAD_ENABLED: "true"
      OTEL_SERVICE_NAME: laravel-app
      OTEL_SERVICE_VERSION: "${APP_VERSION:-1.0.0}"
      OTEL_EXPORTER_OTLP_ENDPOINT: http://scout-collector:4318
      OTEL_EXPORTER_OTLP_COMPRESSION: gzip

      # Database
      DB_CONNECTION: pgsql
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: laravel_production
      DB_USERNAME: laravel
      DB_PASSWORD: "${DB_PASSWORD}"

      # Resource Attributes
      OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=production,service.instance.id=${HOSTNAME}"
    depends_on:
      - postgres
      - scout-collector
    ports:
      - "8000:8000"
    networks:
      - app-network

  scout-collector:
    image: base14/scout-collector:latest
    ports:
      - "4318:4318"
    networks:
      - app-network

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: laravel_production
      POSTGRES_USER: laravel
      POSTGRES_PASSWORD: "${DB_PASSWORD}"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  postgres-data:
```

### Resource Attributes Configuration

Add rich context to all telemetry data with resource attributes:

```bash showLineNumbers title=".env"
OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.namespace=ecommerce,service.instance.id=${HOSTNAME},host.name=${HOSTNAME},host.type=container,cloud.provider=aws,cloud.region=us-east-1,k8s.pod.name=${K8S_POD_NAME},k8s.namespace.name=${K8S_NAMESPACE}"
```

These attributes help you:

- Filter traces by environment, region, or instance
- Correlate issues with specific deployments
- Analyze performance across different infrastructure
- Debug production incidents faster

### Health Check Implementation

Create health check endpoints to verify telemetry export:

```php showLineNumbers title="routes/api.php"
<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\HealthController;

Route::get('/health', [HealthController::class, 'check']);
Route::get('/health/telemetry', [HealthController::class, 'telemetry']);
```

```php showLineNumbers title="app/Http/Controllers/HealthController.php"
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function check(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'timestamp' => now()->toIso8601String(),
            'environment' => config('app.env'),
        ]);
    }

    public function telemetry(): JsonResponse
    {
        $otelEnabled = extension_loaded('opentelemetry');

        return response()->json([
            'status' => 'ok',
            'telemetry' => [
                'extension_loaded' => $otelEnabled,
                'service_name' => env('OTEL_SERVICE_NAME'),
                'service_version' => env('OTEL_SERVICE_VERSION'),
                'exporter_endpoint' => env('OTEL_EXPORTER_OTLP_ENDPOINT'),
                'php_version' => PHP_VERSION,
                'laravel_version' => app()->version(),
            ],
        ]);
    }
}
```

## Eloquent Database Monitoring

OpenTelemetry automatically instruments Eloquent ORM to provide comprehensive
database query monitoring and performance insights.

### Automatic Query Tracing

Once configured, all Eloquent queries are automatically traced with detailed information:

```php
// This query is automatically instrumented
$users = User::where('active', true)
    ->with('posts')
    ->limit(10)
    ->get();

// The trace will show:
// - SQL query statement
// - Database name and operation
// - Query duration
// - Bindings (obfuscated for security)
```

### Query Builder and Raw SQL

All database interactions are automatically traced:

```php showLineNumbers
// Query Builder (automatically traced)
$articles = DB::table('articles')
    ->join('users', 'articles.user_id', '=', 'users.id')
    ->where('articles.published', true)
    ->orderBy('articles.created_at', 'desc')
    ->get();

// Raw SQL queries (automatically traced)
$results = DB::select('SELECT * FROM users WHERE active = ?', [true]);

// Transactions (automatically traced with span hierarchy)
DB::transaction(function () {
    $order = Order::create([...]);
    $order->items()->createMany([...]);
});
```

**Span attributes include:**

- `db.system` - Database type (mysql, pgsql, sqlite)
- `db.name` - Database name
- `db.statement` - SQL query (obfuscated)
- `db.operation` - Operation type (SELECT, INSERT, UPDATE, DELETE)
- `db.sql.table` - Table name

### Detecting N+1 Queries

Use OpenTelemetry traces to identify and fix N+1 query problems:

```php
// Bad: N+1 query pattern (visible in traces as multiple DB spans)
$posts = Post::limit(10)->get();
foreach ($posts as $post) {
    echo $post->author->name;  // Triggers 10 additional queries
}

// Good: Optimized with eager loading (single query in trace)
$posts = Post::with('author')->limit(10)->get();
foreach ($posts as $post) {
    echo $post->author->name;  // No additional queries
}
```

In Scout Dashboard, N+1 queries will appear as:

- Multiple identical database spans within a single request trace
- High span count for simple operations
- Repeated query patterns with different parameters

## Custom Manual Instrumentation

While automatic instrumentation covers most Laravel components, you can add
custom instrumentation for business logic, external API calls, or
performance-critical code paths.

### Creating Custom Spans

Create custom spans for important business operations:

```php showLineNumbers title="app/Http/Controllers/OrderController.php"
<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class OrderController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $tracer = Globals::tracerProvider()->getTracer('orders-controller', '1.0.0');

        return $tracer->spanBuilder('create_order')
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->setAttribute('user.id', $request->user()->id)
            ->setAttribute('order.items_count', count($request->items))
            ->startSpan()
            ->activate(function ($span) use ($request) {
                try {
                    $span->addEvent('Validating order data');

                    $order = Order::create([
                        'user_id' => $request->user()->id,
                        'items' => $request->items,
                        'total_amount' => $request->total_amount,
                    ]);

                    $span->addEvent('Order saved successfully', [
                        'order.id' => $order->id,
                        'order.total' => $order->total_amount,
                    ]);

                    // Process payment in nested span
                    $this->processPayment($order);

                    // Send confirmation email in nested span
                    $this->sendConfirmation($order);

                    $span->setStatus(StatusCode::STATUS_OK);

                    return response()->json($order, 201);
                } catch (\Exception $e) {
                    $span->recordException($e);
                    $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());

                    return response()->json(['error' => $e->getMessage()], 422);
                }
            });
    }

    private function processPayment(Order $order): void
    {
        $tracer = Globals::tracerProvider()->getTracer('orders-controller', '1.0.0');

        $tracer->spanBuilder('process_payment')
            ->setSpanKind(SpanKind::KIND_INTERNAL)
            ->startSpan()
            ->activate(function ($span) use ($order) {
                // Payment processing logic
                $span->setAttribute('payment.amount', $order->total_amount);
                $span->setAttribute('payment.status', 'completed');
            });
    }

    private function sendConfirmation(Order $order): void
    {
        $tracer = Globals::tracerProvider()->getTracer('orders-controller', '1.0.0');

        $tracer->spanBuilder('send_confirmation_email')
            ->setSpanKind(SpanKind::KIND_INTERNAL)
            ->startSpan()
            ->activate(function ($span) use ($order) {
                // Email sending logic
                $span->addEvent('Email queued', [
                    'email.to' => $order->user->email,
                ]);
            });
    }
}
```

### Adding Middleware for Request Context

Enrich all requests with user context:

```php showLineNumbers title="app/Http/Middleware/AddTraceContext.php"
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use OpenTelemetry\API\Trace\Span;

class AddTraceContext
{
    public function handle(Request $request, Closure $next)
    {
        $span = Span::getCurrent();

        if ($span->isRecording()) {
            // Add request attributes
            $span->setAttribute('http.route', $request->route()?->getName());
            $span->setAttribute('http.request_id', $request->header('X-Request-ID'));

            // Add user context if authenticated
            if ($request->user()) {
                $span->setAttribute('user.id', $request->user()->id);
                $span->setAttribute('user.email', $request->user()->email);
                $span->setAttribute('user.authenticated', true);
            }
        }

        return $next($request);
    }
}
```

Register the middleware in `app/Http/Kernel.php`:

```php showLineNumbers title="app/Http/Kernel.php"
protected $middleware = [
    // ... other middleware
    \App\Http\Middleware\AddTraceContext::class,
];
```

### Instrumenting External API Calls

Add custom instrumentation for external API calls:

```php showLineNumbers title="app/Services/ExternalApiClient.php"
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;

class ExternalApiClient
{
    public function fetchData(string $endpoint): array
    {
        $tracer = Globals::tracerProvider()->getTracer('external-api-client', '1.0.0');

        return $tracer->spanBuilder('external_api_call')
            ->setSpanKind(SpanKind::KIND_CLIENT)
            ->setAttribute('http.url', $endpoint)
            ->setAttribute('http.method', 'GET')
            ->startSpan()
            ->activate(function ($span) use ($endpoint) {
                try {
                    $response = Http::get($endpoint);

                    $span->setAttribute('http.status_code', $response->status());
                    $span->setAttribute('http.response_size', strlen($response->body()));

                    if ($response->successful()) {
                        $span->setStatus(StatusCode::STATUS_OK);
                        return $response->json();
                    }

                    $span->setStatus(StatusCode::STATUS_ERROR, "HTTP {$response->status()}");
                    throw new \Exception("API request failed with status {$response->status()}");

                } catch (\Exception $e) {
                    $span->recordException($e);
                    $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
                    throw $e;
                }
            });
    }
}
```

### Using Semantic Conventions

Follow OpenTelemetry semantic conventions for consistent attribute naming:

```php showLineNumbers
// HTTP semantic conventions
$span->setAttribute('http.method', 'POST');
$span->setAttribute('http.url', 'https://api.example.com/users');
$span->setAttribute('http.status_code', 201);
$span->setAttribute('http.request.header.content_type', 'application/json');

// Database semantic conventions
$span->setAttribute('db.system', 'postgresql');
$span->setAttribute('db.name', 'production');
$span->setAttribute('db.statement', 'SELECT * FROM users WHERE active = ?');
$span->setAttribute('db.operation', 'SELECT');

// Messaging/Queue semantic conventions
$span->setAttribute('messaging.system', 'redis');
$span->setAttribute('messaging.destination', 'emails');
$span->setAttribute('messaging.operation', 'process');
```

## Running Your Instrumented Application

### Development Mode

For local development, verify instrumentation is working:

```bash showLineNumbers
# Set environment variables
export OTEL_PHP_AUTOLOAD_ENABLED=true
export OTEL_SERVICE_NAME=laravel-app-dev
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_LOG_LEVEL=debug

# Start Laravel development server
php artisan serve
```

Visit `http://localhost:8000/api/health/telemetry` to verify configuration.

### Production Mode

For production deployments, ensure the Scout Collector endpoint is properly configured:

```bash showLineNumbers
# Set production environment variables
export APP_ENV=production
export OTEL_SERVICE_NAME=laravel-app-production
export OTEL_SERVICE_VERSION=2.1.0
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com/v1/traces
export SCOUT_CLIENT_ID=your_client_id
export SCOUT_CLIENT_SECRET=your_client_secret

# Optimize Laravel for production
php artisan config:cache
php artisan route:cache
php artisan view:cache

# Start production server (use PHP-FPM + Nginx in production)
php artisan serve --host=0.0.0.0 --port=8000
```

### Docker Deployment

Run your instrumented Laravel application in Docker:

```bash showLineNumbers
# Build the image
docker build -t laravel-app:latest .

# Run with Scout Collector
docker run -d \
  --name laravel-app \
  -e OTEL_PHP_AUTOLOAD_ENABLED=true \
  -e OTEL_SERVICE_NAME=laravel-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318 \
  -e DB_CONNECTION=pgsql \
  -e DB_HOST=postgres \
  -p 8000:8000 \
  laravel-app:latest
```

Or use Docker Compose (see [Production Configuration](#production-configuration)
section for complete example).

## Troubleshooting

### Verifying OpenTelemetry Installation

Check if the OpenTelemetry extension is loaded:

```bash showLineNumbers
# Verify extension is loaded
php -m | grep opentelemetry

# Check extension version
php -r "echo phpversion('opentelemetry');"

# Verify configuration
php -i | grep -i otel
```

Expected output:

```plaintext
opentelemetry
1.0.0
OTEL_PHP_AUTOLOAD_ENABLED => true
OTEL_SERVICE_NAME => laravel-app
```

### Testing Instrumentation in Tinker

Test your OpenTelemetry configuration using Laravel Tinker:

```php
php artisan tinker

// Check if extension is loaded
>>> extension_loaded('opentelemetry');
=> true

// Verify environment variables
>>> env('OTEL_SERVICE_NAME');
=> "laravel-app"

>>> env('OTEL_EXPORTER_OTLP_ENDPOINT');
=> "http://localhost:4318"
```

### Debug Mode

Enable debug logging to troubleshoot instrumentation issues:

```bash showLineNumbers
export OTEL_LOG_LEVEL=debug
export OTEL_PHP_INTERNAL_METRICS_ENABLED=true
php artisan serve
```

Check Laravel logs for OpenTelemetry debug information:

```bash
tail -f storage/logs/laravel.log
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash
   curl -v http://scout-collector:4318/v1/traces
   ```

2. Check environment variables are set:

   ```bash
   php artisan tinker
   >>> env('OTEL_EXPORTER_OTLP_ENDPOINT');
   >>> env('OTEL_SERVICE_NAME');
   ```

3. Enable debug logging and check for export errors:

   ```bash
   export OTEL_LOG_LEVEL=debug
   php artisan serve
   ```

4. Verify network connectivity between Laravel app and Scout Collector

#### Issue: OpenTelemetry extension not loaded

**Solutions:**

1. Verify extension installation:

   ```bash
   pecl list | grep opentelemetry
   ```

2. Check php.ini includes extension directive:

   ```bash
   php --ini | head -1
   cat /path/to/php.ini | grep opentelemetry
   ```

3. Ensure extension file exists:

   ```bash
   find /usr -name "opentelemetry.so" 2>/dev/null
   ```

4. Restart PHP-FPM if using FastCGI:

   ```bash
   sudo systemctl restart php8.2-fpm
   ```

#### Issue: Missing database query spans

**Solutions:**

1. Ensure auto-instrumentation is enabled:

   ```bash
   echo $OTEL_PHP_AUTOLOAD_ENABLED  # Should be "true"
   ```

2. Verify database connection is active:

   ```bash
   php artisan tinker
   >>> DB::connection()->getPdo();
   ```

3. Check that Laravel instrumentation package is installed:

   ```bash
   composer show | grep opentelemetry-auto-laravel
   ```

#### Issue: High memory usage

**Solutions:**

1. Reduce batch queue size:

   ```bash
   export OTEL_BSP_MAX_QUEUE_SIZE=1024
   ```

2. Increase export frequency:

   ```bash
   export OTEL_BSP_SCHEDULE_DELAY_MILLIS=2000
   ```

3. Monitor PHP memory limit:

   ```bash
   php -i | grep memory_limit
   ```

#### Issue: Performance degradation

**Solutions:**

1. Verify batch span processor is being used (not simple processor)
2. Skip health check endpoints by configuring routes:

   ```php
   // Don't trace health check endpoints
   Route::get('/health', function () {
       return response()->json(['status' => 'ok']);
   })->withoutMiddleware([\App\Http\Middleware\AddTraceContext::class]);
   ```

3. Use selective instrumentation if full auto-instrumentation is too heavy

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```php
// Bad - exposes sensitive data
$span->setAttribute('user.password', $user->password);              // Never!
$span->setAttribute('credit_card.number', $request->cc_number);     // Never!
$span->setAttribute('user.ssn', $user->social_security_number);     // Never!

// Good - uses safe identifiers
$span->setAttribute('user.id', $user->id);
$span->setAttribute('user.role', $user->role);
$span->setAttribute('payment.provider', 'stripe');
$span->setAttribute('payment.status', 'completed');
```

### SQL Query Obfuscation

OpenTelemetry PHP automatically obfuscates SQL parameter values in database spans:

Before obfuscation (never sent):

```sql
SELECT * FROM users WHERE email = 'user@example.com' AND password = 'secret123'
```

After obfuscation (what gets sent):

```sql
SELECT * FROM users WHERE email = ? AND password = ?
```

### Filtering Sensitive HTTP Headers

Configure which HTTP headers are captured in spans:

```bash showLineNumbers title=".env"
# Only capture safe headers
OTEL_HTTP_HEADERS_ALLOWED=content-type,accept,user-agent
OTEL_HTTP_HEADERS_BLOCKED=authorization,cookie,x-api-key
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard
- SQL obfuscation is enabled by default for database queries
- Audit span attributes regularly for sensitive data leaks
- Configure allowed/blocked HTTP headers appropriately

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead to Laravel applications:

- **Average latency increase**: 2-4ms per request
- **CPU overhead**: Less than 3% in production with batch processing
- **Memory overhead**: ~80-120MB depending on queue size and traffic

**Impact varies based on:**

- Number of enabled instrumentations
- Application request volume
- Complexity of database queries
- Number of external API calls

### Optimization Best Practices

#### 1. Use Batch Span Processing

```bash
# Production settings (low overhead)
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_SCHEDULE_DELAY_MILLIS=5000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
```

#### 2. Enable OPcache

```ini showLineNumbers title="php.ini"
[opcache]
opcache.enable=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=0  ; Disable in production
```

#### 3. Skip Non-Critical Endpoints

Configure routes that don't need tracing:

```php showLineNumbers title="routes/web.php"
// Health checks don't need full tracing
Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
})->withoutMiddleware();

Route::get('/metrics', function () {
    return response()->json([/* metrics */]);
})->withoutMiddleware();
```

#### 4. Use Redis for Queue Monitoring

For high-throughput queue processing, ensure efficient monitoring:

```bash showLineNumbers title=".env"
QUEUE_CONNECTION=redis
REDIS_CLIENT=phpredis  # Faster than predis
```

#### 5. Enable GZIP Compression

```bash
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
```

Reduces network bandwidth by 70-80%.

## Frequently Asked Questions

### Does OpenTelemetry impact Laravel performance?

OpenTelemetry adds approximately 2-4ms of latency per request in typical Laravel
applications. With proper configuration (batch processing, GZIP compression), the
performance impact is minimal and acceptable for most production workloads.

### Which Laravel versions are supported?

OpenTelemetry supports Laravel 8.0+ with PHP 8.0+. Laravel 10.x or 11.x with
PHP 8.2+ is recommended for optimal compatibility and performance. See the
[Prerequisites](#prerequisites) section for detailed version compatibility.

### Can I use OpenTelemetry with Laravel queues and job workers?

Yes! The `opentelemetry-auto-laravel` package includes automatic instrumentation
for Laravel queue workers. Background jobs are traced automatically, and you can
see the complete trace from HTTP request through asynchronous job processing in
Scout Dashboard.

### Is OpenTelemetry compatible with Laravel middleware?

Yes, OpenTelemetry instruments at the HTTP request level, making it compatible with
all Laravel middleware. Custom middleware will appear in traces automatically.

### Can I use OpenTelemetry alongside other APM tools?

Yes, OpenTelemetry can run alongside tools like New Relic or DataDog during
migration periods. However, running multiple APM agents simultaneously will
multiply the performance overhead, so plan your migration carefully.

### How do I handle multi-tenant Laravel applications?

Add tenant context to spans using middleware:

```php
$span = Span::getCurrent();
$span->setAttribute('tenant.id', $request->tenant->id);
$span->setAttribute('tenant.name', $request->tenant->name);
```

Then filter traces by tenant in Scout Dashboard.

### What's the difference between traces and metrics?

**Traces** show the complete request flow through your application with timing
details for each operation. Use traces to debug slow requests and understand
distributed transactions.

**Metrics** provide aggregated statistics over time (request rate, error rate,
latency percentiles). Use metrics for monitoring overall application health
and setting alerts.

### How do I monitor Eloquent N+1 queries?

OpenTelemetry traces automatically expose N+1 queries as multiple database
spans within a single request trace. In Scout Dashboard, look for repeated
query patterns or high span counts for simple operations.

### Can I use OpenTelemetry with Laravel Octane?

Yes! OpenTelemetry is compatible with Laravel Octane (Swoole/RoadRunner). Ensure
the extension is loaded in your Octane worker process by checking `php -m` in
the Octane container.

### How do I instrument Laravel scheduled tasks (cron jobs)?

Scheduled tasks are automatically instrumented when using auto-instrumentation.
Each scheduled command execution creates a trace you can view in Scout Dashboard.

### Does OpenTelemetry work with Laravel Livewire?

Yes, Laravel Livewire HTTP requests are automatically traced. Component lifecycle
events (mount, render, etc.) appear as spans in your traces.

### Can I customize which database queries are traced?

Yes, you can create custom middleware or database event listeners to selectively
skip tracing certain queries. However, we recommend tracing all queries for
complete observability.

## What's Next?

Now that your Laravel application is instrumented with OpenTelemetry, explore
these resources to maximize your observability:

### Advanced Topics

- **[Custom PHP Instrumentation](../custom-instrumentation/php.md)** - Deep dive
  into manual tracing, custom spans, and advanced instrumentation patterns
- **[PostgreSQL Monitoring Best Practices](../../component/postgres.md)** - Optimize
  database observability with connection pooling metrics and query performance analysis
- **[Redis Instrumentation](../../component/redis.md)** - Monitor caching
  performance and identify slow Redis operations

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  intelligent alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** - Build
  custom dashboards combining traces, metrics, and business KPIs

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Set up Scout Collector for local development and testing

## Complete Example

Here's a complete working example of a Laravel application with OpenTelemetry instrumentation.

### Example Project 1: Laravel 11 + PHP 8.2 + PostgreSQL

Based on our [GitHub example repository](https://github.com/base-14/examples/tree/main/php/php85-laravel12-postgres).

#### composer.json

```json title="composer.json"
{
    "name": "laravel/laravel",
    "type": "project",
    "require": {
        "php": "^8.2",
        "laravel/framework": "^11.0",
        "open-telemetry/sdk": "^1.6",
        "open-telemetry/exporter-otlp": "^1.3",
        "open-telemetry/opentelemetry-auto-laravel": "^1.2"
    },
    "autoload": {
        "psr-4": {
            "App\\": "app/",
            "Database\\Factories\\": "database/factories/",
            "Database\\Seeders\\": "database/seeders/"
        }
    }
}
```

#### Environment Configuration

```bash title=".env"
APP_NAME=laravel-otel-example
APP_ENV=production
APP_DEBUG=false

# Database
DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=laravel
DB_USERNAME=laravel
DB_PASSWORD=secret

# OpenTelemetry Configuration
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=laravel-app
OTEL_SERVICE_VERSION=1.0.0
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4318
OTEL_PROPAGATORS=baggage,tracecontext

# Scout Collector (for production)
SCOUT_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token
```

#### Dockerfile

```dockerfile title="Dockerfile"
FROM php:8.2-fpm-alpine

# Install dependencies
RUN apk add --no-cache \
    autoconf \
    build-base \
    postgresql-dev \
    libzip-dev

# Install PHP extensions
RUN docker-php-ext-install pdo pdo_pgsql zip opcache

# Install OpenTelemetry extension
RUN pecl install opentelemetry && \
    docker-php-ext-enable opentelemetry

WORKDIR /var/www/html

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader

COPY . .

ENV OTEL_PHP_AUTOLOAD_ENABLED=true
ENV OTEL_SERVICE_NAME=laravel-app

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0"]
```

### Example Project 2: Laravel 8 + SQLite (Legacy)

For legacy applications still using Laravel 8 (see [GitHub example](https://github.com/base-14/examples/tree/main/php/php8-laravel8-sqlite)):

> ⚠️ **Security Warning**: Laravel 8 reached end-of-life in July 2023. This example
> is provided for reference only and should not be used in production.

```bash title=".env"
APP_NAME=laravel-8-legacy
DB_CONNECTION=sqlite

OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=laravel-8-legacy
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Complete working examples are available in our [GitHub examples repository](https://github.com/base-14/examples/tree/main/php).

## References

- [Official OpenTelemetry PHP Documentation](https://opentelemetry.io/docs/languages/php/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Laravel Documentation](https://laravel.com/docs)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
- [Rails Instrumentation](./rails.md) - Ruby framework alternative
- [Express.js Instrumentation](./express.md) - Node.js framework alternative
