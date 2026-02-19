---
title:
  Slim Framework OpenTelemetry Instrumentation - Complete APM Setup Guide |
  base14 Scout
sidebar_label: Slim
sidebar_position: 24
description:
  Slim Framework OpenTelemetry instrumentation for traces, MongoDB monitoring,
  metrics, and log correlation with base14 Scout. Covers both Slim 4
  (auto-instrumented) and Slim 3 (manual middleware).
keywords:
  [
    slim opentelemetry,
    slim 4 opentelemetry,
    slim 3 opentelemetry,
    php slim apm,
    slim framework monitoring,
    slim distributed tracing,
    slim mongodb instrumentation,
    php micro-framework observability,
    slim application performance monitoring,
    opentelemetry slim,
    slim php tracing,
    slim metrics,
    slim log correlation,
    php opentelemetry sdk,
    slim telemetry,
    slim 4 auto instrumentation,
    slim 3 manual instrumentation,
    php fpm opentelemetry,
  ]
---

# Slim Framework

Implement OpenTelemetry instrumentation for Slim Framework applications to
enable distributed tracing, metrics, and log correlation. This guide covers both
Slim 4 (with fully automatic HTTP span instrumentation via
`opentelemetry-auto-slim`) and Slim 3 (with a manual `TelemetryMiddleware`). The
~70% of setup that is identical between versions — environment variables,
shutdown handlers, metrics, MongoDB auto-instrumentation, Docker deployment — is
shared throughout.

Slim applications benefit from the OpenTelemetry PHP ecosystem: automatic
MongoDB query tracing, Monolog log-trace correlation, and business metric
counters — all with minimal application code. Whether you are building a new API
on Slim 4 or maintaining a legacy Slim 3 service, this guide provides
production-ready configurations for PHP-FPM deployments with base14 Scout.

> **Note:** This guide provides a practical Slim-focused overview based on the
> official OpenTelemetry documentation. For complete PHP language information,
> please consult the
> [official OpenTelemetry PHP documentation](https://opentelemetry.io/docs/languages/php/).

:::warning Slim 3 End-of-Life

Slim 3 is **EOL** and produces deprecation warnings on PHP 8.4. The
`opentelemetry-auto-slim` package only supports Slim 4+, so HTTP spans must be
created manually. If you are starting a new project, use Slim 4.

:::

## Prerequisites

### Compatibility Matrix

| Component                 | Slim 4                 | Slim 3                                    |
| ------------------------- | ---------------------- | ----------------------------------------- |
| PHP                       | 8.1+ (8.4 recommended) | 8.0–8.4 (deprecation warnings suppressed) |
| Slim                      | ^4.15                  | ~3.12                                     |
| `opentelemetry-auto-slim` | ^1.3                   | Not supported                             |
| HTTP span creation        | Automatic              | Manual (`TelemetryMiddleware`)            |
| MongoDB auto-spans        | ^0.2                   | ^0.2                                      |
| OTel SDK                  | ^1.13                  | ^1.13                                     |
| Composer                  | 2.0+                   | 2.0+                                      |

You also need:

- **Scout Collector** configured and accessible — see
  [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
  local development
- **Build tools** for compiling the OpenTelemetry PHP extension (gcc, make,
  autoconf)

## Installation

### Step 1: Install PHP Extensions

#### Ubuntu 24.04 LTS

Install PHP 8.4, the build toolchain, and PECL in one shot:

```bash showLineNumbers
sudo apt-get update
sudo apt-get install -y php8.4-cli php8.4-dev php8.4-fpm php8.4-mbstring \
  php8.4-zip php8.4-curl gcc make autoconf pkg-config libssl-dev
```

If your system ships an older PHP, add the
[Ondrej PPA](https://launchpad.net/~ondrej/+archive/ubuntu/php) first:

```bash showLineNumbers
sudo add-apt-repository ppa:ondrej/php
sudo apt-get update
```

Then install the extensions:

```bash showLineNumbers
sudo pecl install opentelemetry mongodb
```

#### Other Platforms

```bash showLineNumbers
# macOS (Homebrew)
brew install php@8.4 autoconf pkg-config
pecl install opentelemetry mongodb

# Alpine Linux (Docker) — see Dockerfile section below
apk add --no-cache autoconf build-base
pecl install opentelemetry mongodb
```

#### All Platforms

Install Composer 2 if you haven't already:

```bash showLineNumbers
php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');"
php composer-setup.php --install-dir=/usr/local/bin --filename=composer
```

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

Enable them in your `php.ini`:

```ini showLineNumbers title="php.ini"
extension=opentelemetry
extension=mongodb
```

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

Enable them in your `php.ini` and suppress Slim 3 deprecation warnings:

```ini showLineNumbers title="php.ini"
extension=opentelemetry
extension=mongodb

; Slim 3 triggers deprecation warnings on PHP 8.4
error_reporting = E_ALL & ~E_DEPRECATED & ~E_NOTICE
```

```mdx-code-block
</TabItem>
</Tabs>
```

Verify the extensions are loaded:

```bash showLineNumbers
php -m | grep -E "opentelemetry|mongodb"
```

### Step 2: Install Composer Packages

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

```bash showLineNumbers
composer require \
  slim/slim:^4.15 \
  slim/psr7:^1.8 \
  php-di/php-di:^7.1 \
  open-telemetry/sdk:^1.13 \
  open-telemetry/exporter-otlp:^1.4 \
  open-telemetry/opentelemetry-auto-slim:^1.3 \
  open-telemetry/opentelemetry-auto-mongodb:^0.2 \
  open-telemetry/opentelemetry-logger-monolog:^1.1 \
  php-http/guzzle7-adapter:^1.1 \
  guzzlehttp/psr7:^2.8
```

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

```bash showLineNumbers
composer require \
  slim/slim:~3.12 \
  mongodb/mongodb:^2.0 \
  monolog/monolog:^3.7 \
  open-telemetry/sdk:^1.13 \
  open-telemetry/exporter-otlp:^1.4 \
  open-telemetry/opentelemetry-auto-mongodb:^0.2 \
  open-telemetry/opentelemetry-logger-monolog:^1.1 \
  php-http/guzzle7-adapter:^1.0 \
  guzzlehttp/psr7:^2.7
```

Note: `opentelemetry-auto-slim` is **not included** because it only supports
Slim 4+. HTTP spans are created manually via `TelemetryMiddleware` (see
[HTTP Request Tracing](#http-request-tracing)).

```mdx-code-block
</TabItem>
</Tabs>
```

**What each package does:**

| Package                        | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `open-telemetry/sdk`           | Core OTel PHP SDK (creates spans, manages context)             |
| `open-telemetry/exporter-otlp` | Sends telemetry over OTLP protocol                             |
| `opentelemetry-auto-slim`      | Auto-instruments every Slim 4 route (Slim 4 only)              |
| `opentelemetry-auto-mongodb`   | Auto-creates spans for all MongoDB driver operations           |
| `opentelemetry-logger-monolog` | Bridges Monolog to OTel logs with automatic `traceId`/`spanId` |
| `guzzle7-adapter` + `psr7`     | HTTP transport for the OTLP exporter                           |
| `slim/psr7` + `php-di/php-di`  | PSR-7 implementation and DI container (Slim 4 only)            |

## Environment Variables

OTel auto-configures via environment. Set these before your app starts (in your
shell, `.env`, or process manager):

```bash showLineNumbers title=".env"
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=my-slim-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=development
```

`OTEL_PHP_AUTOLOAD_ENABLED=true` is the key switch. It tells the SDK to
automatically discover and activate the auto-instrumentation packages (like
`opentelemetry-auto-slim` and `opentelemetry-auto-mongodb`). Without it, the
packages sit idle.

Use `deployment.environment.name` (not the deprecated `deployment.environment`).

### Scout Collector Integration

When using Scout Collector, configure your application to send telemetry data
with OAuth2 authentication:

```bash showLineNumbers title=".env"
# Scout Collector Configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-tenant.base14.io/v1/traces
SCOUT_CLIENT_ID=your_client_id
SCOUT_CLIENT_SECRET=your_client_secret
SCOUT_TOKEN_URL=https://your-tenant.base14.io/oauth/token
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions.

## Bootstrap

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

Slim 4 requires a PSR-11 container (PHP-DI) and explicit PSR-7 implementation
(`slim/psr7`):

```php showLineNumbers title="public/index.php"
<?php

use DI\ContainerBuilder;
use OpenTelemetry\API\Trace\Span;
use OpenTelemetry\API\Trace\StatusCode;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LoggerInterface;
use Slim\Factory\AppFactory;

require __DIR__ . '/../vendor/autoload.php';

Dotenv\Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

require __DIR__ . '/../src/telemetry.php';

$builder = new ContainerBuilder();
$builder->addDefinitions(__DIR__ . '/../src/dependencies.php');
$container = $builder->build();

AppFactory::setContainer($container);
$app = AppFactory::create();

$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

require __DIR__ . '/../src/routes.php';

$displayErrors = ($_ENV['APP_DEBUG'] ?? 'false') === 'true';
$errorMiddleware = $app->addErrorMiddleware($displayErrors, true, true);
$errorMiddleware->setDefaultErrorHandler(function (
    ServerRequestInterface $request,
    \Throwable $exception,
    bool $displayErrorDetails,
    bool $logErrors,
    bool $logErrorDetails,
) use ($app) {
    // Record exception on the auto-instrumented span
    $span = Span::getCurrent();
    $span->recordException($exception);
    $span->setStatus(StatusCode::STATUS_ERROR, $exception->getMessage());

    $logger = $app->getContainer()->get(LoggerInterface::class);
    $logger->error('Unhandled exception', [
        'exception' => $exception,
        'uri' => (string) $request->getUri(),
        'method' => $request->getMethod(),
    ]);

    $statusCode = 500;
    if ($exception instanceof \Slim\Exception\HttpException) {
        $statusCode = $exception->getCode();
    }

    $response = $app->getResponseFactory()->createResponse($statusCode);
    $response->getBody()->write(json_encode([
        'error' => $displayErrorDetails
            ? $exception->getMessage()
            : 'Internal server error',
    ]));

    return $response->withHeader('Content-Type', 'application/json');
});

$app->run();
```

The three lines that record exceptions on spans (`Span::getCurrent()`,
`recordException`, `setStatus`) are the only OTel API calls in the entire entry
point.

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

The `determineRouteBeforeAppMiddleware` setting is required so the
`TelemetryMiddleware` can read the matched route pattern for span names:

```php showLineNumbers title="public/index.php"
<?php

use OpenTelemetry\API\Trace\Span;
use OpenTelemetry\API\Trace\StatusCode;

require __DIR__ . '/../vendor/autoload.php';

Dotenv\Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();

require __DIR__ . '/../src/telemetry.php';

$app = new \Slim\App([
    'settings' => [
        'displayErrorDetails' => ($_ENV['APP_DEBUG'] ?? 'false') === 'true',
        'addContentLengthHeader' => false,
        'determineRouteBeforeAppMiddleware' => true,
    ],
]);

require __DIR__ . '/../src/dependencies.php';
require __DIR__ . '/../src/middleware.php';
require __DIR__ . '/../src/routes.php';

$container = $app->getContainer();
$container['errorHandler'] = function ($c) {
    return function ($request, $response, $exception) use ($c) {
        $span = Span::getCurrent();
        $span->recordException($exception);
        $span->setStatus(StatusCode::STATUS_ERROR, $exception->getMessage());

        $c['logger']->error('Unhandled exception', [
            'exception' => $exception,
            'uri' => (string) $request->getUri(),
            'method' => $request->getMethod(),
        ]);

        $statusCode = 500;
        if (method_exists($exception, 'getCode')
            && $exception->getCode() >= 400
            && $exception->getCode() < 600) {
            $statusCode = $exception->getCode();
        }

        return $response->withJson([
            'error' => ($c['settings']['displayErrorDetails'] ?? false)
                ? $exception->getMessage()
                : 'Internal server error',
        ], $statusCode);
    };
};

$app->run();
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Shutdown Handler

PHP-FPM workers can exit before the SDK flushes its buffer. Register a shutdown
handler to force-flush all providers on process exit.

Create `src/Telemetry/Shutdown.php`:

```php showLineNumbers title="src/Telemetry/Shutdown.php"
<?php

namespace App\Telemetry;

use OpenTelemetry\API\Globals;

class Shutdown
{
    public static function register(): void
    {
        register_shutdown_function([self::class, 'flush']);

        if (!extension_loaded('pcntl')) {
            return;
        }

        pcntl_async_signals(true);
        $handler = function () {
            self::flush();
            exit(0);
        };

        pcntl_signal(SIGTERM, $handler);
        pcntl_signal(SIGINT, $handler);
    }

    public static function flush(): void
    {
        try {
            $tp = Globals::tracerProvider();
            if (method_exists($tp, 'forceFlush')) {
                $tp->forceFlush();
            }

            $mp = Globals::meterProvider();
            if (method_exists($mp, 'forceFlush')) {
                $mp->forceFlush();
            }

            $lp = Globals::loggerProvider();
            if (method_exists($lp, 'forceFlush')) {
                $lp->forceFlush();
            }
        } catch (\Throwable $e) {
            // swallow — nothing useful to do during shutdown
        }
    }
}
```

Bootstrap it early in `src/telemetry.php`:

```php showLineNumbers title="src/telemetry.php"
<?php
use App\Telemetry\Shutdown;
Shutdown::register();
```

This file is `require`d from `public/index.php` before the Slim app is created.

## HTTP Request Tracing

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

With `opentelemetry-auto-slim` installed and `OTEL_PHP_AUTOLOAD_ENABLED=true`,
every Slim 4 request automatically gets:

- Root **SERVER** span named `{METHOD} {route_pattern}` (e.g.
  `GET /api/articles/{id}`)
- Controller-level **INTERNAL** span (e.g. `ArticleController::create`)
- Semantic convention attributes (`http.request.method`, `http.route`,
  `http.response.status_code`)
- HTTP server metrics (request duration, count)

No manual `TelemetryMiddleware` is needed. Do not create duplicate HTTP metrics
or span attributes in your application code.

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

Since `opentelemetry-auto-slim` doesn't support Slim 3, create a
`TelemetryMiddleware` that produces the root SERVER span:

```php showLineNumbers title="src/Middleware/TelemetryMiddleware.php"
<?php

namespace App\Middleware;

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

class TelemetryMiddleware
{
    public function __invoke(
        ServerRequestInterface $request,
        ResponseInterface $response,
        callable $next
    ): ResponseInterface {
        $tracer = Globals::tracerProvider()->getTracer('slim-app');
        $method = $request->getMethod();
        $path = (string) $request->getUri()->getPath();

        $span = $tracer->spanBuilder("$method $path")
            ->setSpanKind(SpanKind::KIND_SERVER)
            ->startSpan();

        $scope = $span->activate();

        $span->setAttribute('http.method', $method);
        $span->setAttribute('http.url', (string) $request->getUri());
        $span->setAttribute('http.target', $path);
        $span->setAttribute('http.scheme',
            $request->getUri()->getScheme() ?: 'http');

        try {
            $response = $next($request, $response);

            // After route matching, update span name to low-cardinality pattern
            $route = $request->getAttribute('route');
            if ($route instanceof \Slim\Route) {
                $pattern = $route->getPattern();
                $span->updateName("$method $pattern");
                $span->setAttribute('http.route', $pattern);
            }

            $span->setAttribute('http.status_code',
                $response->getStatusCode());

            return $response;
        } catch (\Exception $e) {
            $span->recordException($e);
            $span->setStatus(
                StatusCode::STATUS_ERROR, $e->getMessage());
            throw $e;
        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

Key details:

- **Scope activation** (`$span->activate()`) makes this span current so MongoDB
  auto-spans and logs inherit the trace context
- Span name updates from `/api/articles/abc123` to `/api/articles/{id}` after
  route matching (low cardinality)
- `determineRouteBeforeAppMiddleware: true` in your Slim 3 settings is
  **required** for the route pattern to be available inside middleware
- Do **not** set `STATUS_OK` on success — leave as UNSET per OTel conventions
- Do **not** set `STATUS_ERROR` for 4xx responses — only for exceptions

Register it in `src/middleware.php`:

```php showLineNumbers title="src/middleware.php"
$app->add(new \App\Middleware\TelemetryMiddleware());
```

Because Slim 3 uses LIFO middleware ordering, `TelemetryMiddleware` should be
added **last** so it executes **first** (outermost wrapper).

```mdx-code-block
</TabItem>
</Tabs>
```

## Structured Logging

Wire Monolog with both a stderr handler and the OTel log handler. The OTel
handler automatically attaches `traceId` and `spanId` to every log record — no
manual trace context injection needed.

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

Register in your PHP-DI definitions file:

```php showLineNumbers title="src/dependencies.php"
use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Contrib\Logs\Monolog\Handler as OtelLogHandler;
use Psr\Log\LoggerInterface;

return [
    LoggerInterface::class => function () {
        $logger = new Logger('slim-app');
        $logger->pushHandler(new StreamHandler('php://stderr', Logger::DEBUG));

        try {
            $loggerProvider = Globals::loggerProvider();
            $logger->pushHandler(new OtelLogHandler($loggerProvider, Logger::DEBUG));
        } catch (\Throwable $e) {
            // OTel logger not available, continue with stderr only
        }

        return $logger;
    },
];
```

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

Register on the Pimple container:

```php showLineNumbers title="src/dependencies.php"
use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use OpenTelemetry\API\Globals;
use OpenTelemetry\Contrib\Logs\Monolog\Handler as OtelLogHandler;

$container['logger'] = function () {
    $logger = new Logger('slim-app');
    $logger->pushHandler(new StreamHandler('php://stderr', Logger::DEBUG));

    try {
        $loggerProvider = Globals::loggerProvider();
        $logger->pushHandler(new OtelLogHandler($loggerProvider, Logger::DEBUG));
    } catch (\Throwable $e) {
        // OTel logger not available, continue with stderr only
    }

    return $logger;
};
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Business Metrics

Create counters with an `app.` namespace prefix. Do not add a `.total` suffix to
counter names — the metric type already implies it. Use attributes for
differentiation instead of separate counters:

```php showLineNumbers title="src/Telemetry/Metrics.php"
<?php

namespace App\Telemetry;

use OpenTelemetry\API\Globals;

class Metrics
{
    private static function getCounter(string $name, string $desc)
    {
        return Globals::meterProvider()
            ->getMeter('slim-app')
            ->createCounter($name, '', $desc);
    }

    public static function authLoginSuccess(): void
    {
        self::getCounter('app.user.logins', 'User login attempts')
            ->add(1, ['result' => 'success']);
    }

    public static function authLoginFailed(): void
    {
        self::getCounter('app.user.logins', 'User login attempts')
            ->add(1, ['result' => 'failure']);
    }

    public static function articleCreated(): void
    {
        self::getCounter('app.article.creates', 'Articles created')
            ->add(1);
    }
}
```

Call these from your controllers as one-liners:

```php
Metrics::authLoginSuccess();
Metrics::articleCreated();
```

No span wrapping or trace context management needed. The counters flow through
the `OTEL_METRICS_EXPORTER=otlp` pipeline independently.

## Controllers

With auto-instrumentation (Slim 4) or `TelemetryMiddleware` (Slim 3) handling
traces, your controllers stay focused on business logic. The only OTel
touchpoint is the `Metrics::*` one-liner calls.

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

```php showLineNumbers title="src/Controllers/ArticleController.php"
use App\Repositories\ArticleRepository;
use App\Telemetry\Metrics;
use Psr\Log\LoggerInterface;

class ArticleController
{
    private ArticleRepository $articleRepository;
    private LoggerInterface $logger;

    public function __construct(
        ArticleRepository $articleRepository,
        LoggerInterface $logger
    ) {
        $this->articleRepository = $articleRepository;
        $this->logger = $logger;
    }

    public function create($request, $response)
    {
        $data = $request->getParsedBody();
        $user = $request->getAttribute('user');

        if (empty($data['title']) || empty($data['body'])) {
            $this->logger->warning('Article validation failed',
                ['reason' => 'missing fields']);
            return $this->json($response,
                ['error' => 'Title and body are required'], 422);
        }

        $data['author_id'] = $user['sub'];
        $article = $this->articleRepository->create($data);
        Metrics::articleCreated();

        $this->logger->info('Article created',
            ['article.id' => $article['id'],
             'user.id' => $user['sub']]);

        $response->getBody()->write(json_encode([
            'article' => $article,
        ]));
        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withStatus(201);
    }
}
```

Slim 4 uses constructor injection via PHP-DI. The
`$response->getBody()->write()` pattern is standard PSR-7.

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

```php showLineNumbers title="src/Controllers/ArticleController.php"
use App\Telemetry\Metrics;

class ArticleController
{
    public function create($request, $response)
    {
        $data = $request->getParsedBody();
        $user = $request->getAttribute('user');

        if (empty($data['title']) || empty($data['body'])) {
            $this->logger->warning('Article validation failed',
                ['reason' => 'missing fields']);
            return $response->withJson(
                ['error' => 'Title and body are required'], 422);
        }

        $data['author_id'] = $user['sub'];
        $article = $this->container['articleRepository']->create($data);
        Metrics::articleCreated();

        $this->logger->info('Article created',
            ['article.id' => $article['id'],
             'user.id' => $user['sub']]);

        return $response->withJson(['article' => $article], 201);
    }
}
```

Slim 3 accesses dependencies via `$this->container['...']` (Pimple) and uses the
convenience method `$response->withJson()`.

```mdx-code-block
</TabItem>
</Tabs>
```

## Docker Deployment

### Dockerfile

Use a 2-stage build to keep the runtime image small. The builder stage installs
Composer dependencies; the runtime stage installs the `mongodb` and
`opentelemetry` PECL extensions:

```dockerfile showLineNumbers title="Dockerfile"
# syntax=docker/dockerfile:1

ARG PHP_VERSION=8.4

# Stage 1: Build dependencies
FROM php:${PHP_VERSION}-cli AS builder

WORKDIR /app

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    git unzip libzip-dev libssl-dev pkg-config && \
    pecl install mongodb && \
    docker-php-ext-enable mongodb && \
    docker-php-ext-install zip && \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

COPY composer.json ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist \
    --ignore-platform-req=ext-opentelemetry

COPY . .
RUN composer dump-autoload --optimize --no-scripts

# Stage 2: Runtime
FROM php:${PHP_VERSION}-fpm

WORKDIR /var/www/html

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    curl libzip-dev libssl-dev libonig-dev libfcgi-bin pkg-config && \
    pecl install mongodb opentelemetry && \
    docker-php-ext-enable mongodb opentelemetry && \
    docker-php-ext-install zip mbstring && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY config/php.ini /usr/local/etc/php/conf.d/99-app.ini
COPY config/php-fpm.conf /usr/local/etc/php-fpm.d/zz-app.conf

RUN groupadd --gid 1000 slim && \
    useradd --uid 1000 --gid slim --shell /bin/bash --create-home slim

COPY --from=builder --chown=slim:slim /app /var/www/html

USER slim

EXPOSE 9000

CMD ["php-fpm"]
```

For Slim 3, the `php.ini` should include the `error_reporting` suppression line
from the [Installation](#step-1-install-php-extensions) section.

### Docker Compose

Use YAML anchors to share OTel environment variables across services:

```yaml showLineNumbers title="compose.yml"
x-otel-env: &otel-env
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_PHP_AUTOLOAD_ENABLED: "true"
  OTEL_RESOURCE_ATTRIBUTES: deployment.environment.name=development

x-mongo-env: &mongo-env
  MONGO_URI: mongodb://mongo:27017
  MONGO_DATABASE: slim_app

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.144.0
    ports:
      - "4317:4317"
      - "4318:4318"
      - "13133:13133"
    volumes:
      - ./config/otel-config.yaml:/etc/otelcol-contrib/config.yaml
    environment:
      - SCOUT_ENDPOINT=${SCOUT_ENDPOINT}
      - SCOUT_CLIENT_ID=${SCOUT_CLIENT_ID}
      - SCOUT_CLIENT_SECRET=${SCOUT_CLIENT_SECRET}
      - SCOUT_TOKEN_URL=${SCOUT_TOKEN_URL}
    restart: unless-stopped

  mongo:
    image: mongo:8
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      <<: [*otel-env, *mongo-env]
      OTEL_SERVICE_NAME: my-slim-app
      JWT_SECRET: ${JWT_SECRET:-change-this-secret}
      APP_DEBUG: "true"
    depends_on:
      mongo:
        condition: service_healthy
      otel-collector:
        condition: service_started
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
      - ./public:/var/www/html/public:ro
    depends_on:
      app:
        condition: service_started
    restart: unless-stopped

volumes:
  mongo-data:
```

Start everything with:

```bash
docker compose up --build
```

## Verification

Start the collector and hit an endpoint:

```bash showLineNumbers
curl -X POST http://localhost:8080/api/articles \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","body":"World"}'
```

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4" default>
```

Slim 4 produces a 3-level span hierarchy, all from auto-instrumentation:

```text
POST /api/articles              (SERVER   - auto-slim)
  +-- ArticleController::create (INTERNAL - auto-slim)
       +-- MongoDB articles.insert (CLIENT - auto-mongodb)
```

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3">
```

Slim 3 produces a 2-level span hierarchy (no INTERNAL controller span):

```text
POST /api/articles              (SERVER - TelemetryMiddleware)
  +-- MongoDB articles.insert   (CLIENT - auto-mongodb)
```

```mdx-code-block
</TabItem>
</Tabs>
```

Check the collector output for:

- Spans with your service name and proper parent-child nesting
- Logs with `traceId`/`spanId` correlation
- Metrics with `app.` prefix (e.g. `app.user.logins`, `app.article.creates`)

## Troubleshooting

### No traces appearing

1. Check collector logs: `docker compose logs otel-collector`
2. Verify Scout credentials are set correctly
3. Ensure `OTEL_PHP_AUTOLOAD_ENABLED=true` is set
4. Check extension: `docker exec <container> php -m | grep opentelemetry`

### OpenTelemetry extension not loaded

1. Verify extension installation: `pecl list | grep opentelemetry`
2. Check `php.ini` includes the extension directive:
   `php --ini && php -m | grep opentelemetry`
3. Restart PHP-FPM if using FastCGI: `kill -USR2 1` (inside the container)

### No MongoDB spans

1. Verify `opentelemetry-auto-mongodb` is installed:
   `composer show | grep auto-mongodb`
2. Confirm `OTEL_PHP_AUTOLOAD_ENABLED=true`
3. Check that the `mongodb` PHP extension is loaded: `php -m | grep mongodb`

### Slim 3: span names show raw paths instead of route patterns

Ensure `determineRouteBeforeAppMiddleware` is set to `true` in your Slim 3
settings. Without it, the `TelemetryMiddleware` cannot read the matched route
pattern and span names will contain high-cardinality paths like
`GET /api/articles/abc123` instead of `GET /api/articles/{id}`.

### Telemetry lost on process exit

PHP-FPM workers can exit before the SDK flushes its buffer. Ensure the
[Shutdown handler](#shutdown-handler) is registered and loaded early via
`src/telemetry.php`. Without it, spans from the final request before worker
recycling may be lost.

## What's Next

- **[Custom PHP Instrumentation](../custom-instrumentation/php.md)** — add
  manual spans for business-critical operations
- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** —
  configure Scout Collector for local development
- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** — set up
  alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** —
  build custom dashboards combining traces, metrics, and business KPIs

## Complete Example

Working examples with full source code, Docker Compose setup, and test scripts:

- **Slim 4**:
  [php84-slim4-mongodb](https://github.com/base-14/examples/tree/main/php/php84-slim4-mongodb)
- **Slim 3**:
  [php84-slim3-mongodb](https://github.com/base-14/examples/tree/main/php/php84-slim3-mongodb)

```mdx-code-block
<Tabs>
<TabItem value="slim4" label="Slim 4 composer.json" default>
```

```json title="composer.json"
{
  "name": "base14/slim4-mongodb-otel",
  "type": "project",
  "require": {
    "php": "^8.4",
    "slim/slim": "^4.15",
    "slim/psr7": "^1.8",
    "php-di/php-di": "^7.1",
    "mongodb/mongodb": "^2.2",
    "open-telemetry/sdk": "^1.13",
    "open-telemetry/exporter-otlp": "^1.4",
    "open-telemetry/opentelemetry-auto-slim": "^1.3",
    "open-telemetry/opentelemetry-auto-mongodb": "^0.2",
    "open-telemetry/opentelemetry-logger-monolog": "^1.1",
    "php-http/guzzle7-adapter": "^1.1",
    "guzzlehttp/psr7": "^2.8"
  }
}
```

```mdx-code-block
</TabItem>
<TabItem value="slim3" label="Slim 3 composer.json">
```

```json title="composer.json"
{
  "name": "base14/slim3-mongodb-otel",
  "type": "project",
  "require": {
    "php": "^8.4",
    "slim/slim": "~3.12",
    "mongodb/mongodb": "^2.0",
    "open-telemetry/sdk": "^1.13",
    "open-telemetry/exporter-otlp": "^1.4",
    "open-telemetry/opentelemetry-auto-mongodb": "^0.2",
    "open-telemetry/opentelemetry-logger-monolog": "^1.1",
    "php-http/guzzle7-adapter": "^1.0",
    "guzzlehttp/psr7": "^2.7"
  }
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## References

- [Official OpenTelemetry PHP Documentation](https://opentelemetry.io/docs/languages/php/)
- [Slim 4 Documentation](https://www.slimframework.com/docs/v4/)
- [Slim 3 Documentation](https://www.slimframework.com/docs/v3/)
- [MongoDB PHP Library](https://www.mongodb.com/docs/php-library/)
