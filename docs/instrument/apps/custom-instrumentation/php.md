---
title: PHP Custom OpenTelemetry Instrumentation - Manual Tracing Guide | base14 Scout
sidebar_label: PHP
sidebar_position: 5
description:
  Custom instrumentation for PHP applications with OpenTelemetry. Manual
  tracing, spans, metrics, and telemetry export with PHP OpenTelemetry SDK.
keywords:
  [
    php instrumentation,
    php opentelemetry,
    php custom instrumentation,
    php tracing,
    php observability,
    php distributed tracing,
    php manual instrumentation,
    opentelemetry php sdk,
  ]
---

# PHP

Implement OpenTelemetry custom instrumentation for PHP applications to collect
traces, metrics, and logs using the PHP OpenTelemetry SDK. This guide covers
manual instrumentation for any PHP application, including custom frameworks,
legacy codebases, and popular frameworks like Symfony, WordPress, and others.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK for manual instrumentation
- Create and manage custom spans
- Add attributes, events, and exception tracking
- Implement metrics collection
- Propagate context across service boundaries
- Instrument common PHP patterns and frameworks

## Prerequisites

Before starting, ensure you have:

- **PHP 8.0 or later** installed
- **Composer** for dependency management
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

## Required Packages

Install the OpenTelemetry SDK and exporters:

```bash showLineNumbers
composer require open-telemetry/sdk
composer require open-telemetry/exporter-otlp
composer require guzzlehttp/guzzle
```

For semantic conventions support:

```bash showLineNumbers
composer require open-telemetry/sem-conv
```

## Traces

Traces provide a complete picture of request flows through your application,
from initial request to final response, including all operations and services
involved.

### Initialization

Initialize the TracerProvider and acquire a tracer:

```php showLineNumbers title="bootstrap.php"
<?php

require 'vendor/autoload.php';

use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;
use OpenTelemetry\SDK\Trace\SpanExporter\ConsoleSpanExporterFactory;
use OpenTelemetry\API\Globals;

// Create a tracer provider
$tracerProvider = new TracerProvider(
    new SimpleSpanProcessor(
        (new ConsoleSpanExporterFactory())->create()
    )
);

// Set as global tracer provider
Globals::registerInitializer(function() use ($tracerProvider) {
    return $tracerProvider;
});

// Get a tracer for your application
$tracer = Globals::tracerProvider()->getTracer(
    'my-app',
    '1.0.0'
);
```

### Production Configuration with OTLP Exporter

For production, export traces to Scout Collector:

```php showLineNumbers title="config/telemetry.php"
<?php

use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;
use OpenTelemetry\API\Globals;

// Create resource with service information
$resource = ResourceInfoFactory::defaultResource()->merge(
    \OpenTelemetry\SDK\Resource\ResourceInfo::create(
        Attributes::create([
            'service.name' => 'my-php-app',
            'service.version' => '1.0.0',
            'deployment.environment' => 'production',
        ])
    )
);

// Create OTLP exporter
$transport = (new OtlpHttpTransportFactory())->create(
    'http://localhost:4318',
    'application/x-protobuf'
);

$exporter = new SpanExporter($transport);

// Create tracer provider with batch processor
$tracerProvider = new TracerProvider(
    new BatchSpanProcessor($exporter),
    null,
    $resource
);

Globals::registerInitializer(function() use ($tracerProvider) {
    return $tracerProvider;
});
```

> **Note**: Ensure your Scout Collector is properly configured to receive trace
> data at the endpoint specified above.

### Creating Spans

A span represents a single operation within a trace:

```php showLineNumbers
$span = $tracer->spanBuilder('operation-name')->startSpan();

// Perform your operation
doSomeWork();

// Always end spans
$span->end();
```

### Using Span Context

Activate a span to make it current and automatically propagate context:

```php showLineNumbers
$span = $tracer->spanBuilder('parent-operation')->startSpan();
$scope = $span->activate();

try {
    // Any spans created here will be children of this span
    performOperation();
} finally {
    $scope->detach();
    $span->end();
}
```

### Creating Nested Spans

Create parent-child span relationships:

```php showLineNumbers
function processRequest($tracer) {
    $parentSpan = $tracer->spanBuilder('process_request')->startSpan();
    $parentScope = $parentSpan->activate();

    try {
        // Child span 1
        $childSpan1 = $tracer->spanBuilder('validate_input')->startSpan();
        validateInput();
        $childSpan1->end();

        // Child span 2
        $childSpan2 = $tracer->spanBuilder('fetch_data')->startSpan();
        fetchDataFromDatabase();
        $childSpan2->end();

        // Child span 3
        $childSpan3 = $tracer->spanBuilder('process_data')->startSpan();
        processData();
        $childSpan3->end();

    } finally {
        $parentScope->detach();
        $parentSpan->end();
    }
}
```

## Attributes

Attributes add context to spans as key-value pairs:

### Adding Custom Attributes

```php showLineNumbers
$span = $tracer->spanBuilder('database-query')->startSpan();

$span->setAttribute('db.system', 'postgresql');
$span->setAttribute('db.name', 'production');
$span->setAttribute('db.operation', 'SELECT');
$span->setAttribute('query.rows_returned', 42);

// Perform database operation
$results = $db->query('SELECT * FROM users');

$span->end();
```

### Using Semantic Conventions

Use standardized attribute names for common operations:

```php showLineNumbers
use OpenTelemetry\SemConv\TraceAttributes;

$span = $tracer->spanBuilder('http-request')->startSpan();

$span->setAttribute(TraceAttributes::HTTP_METHOD, 'POST');
$span->setAttribute(TraceAttributes::HTTP_URL, 'https://api.example.com/users');
$span->setAttribute(TraceAttributes::HTTP_STATUS_CODE, 201);
$span->setAttribute(TraceAttributes::HTTP_REQUEST_CONTENT_LENGTH, strlen($body));

$span->end();
```

## Events

Events mark significant moments during a span's lifetime:

```php showLineNumbers
$span = $tracer->spanBuilder('order-processing')->startSpan();

$span->addEvent('order_received', [
    'order.id' => '12345',
    'order.amount' => 99.99,
]);

// Process the order
processOrder($orderId);

$span->addEvent('payment_processed', [
    'payment.method' => 'credit_card',
    'payment.status' => 'success',
]);

$span->addEvent('order_completed');

$span->end();
```

## Exception Recording

Capture and record exceptions in spans:

```php showLineNumbers
use OpenTelemetry\API\Trace\StatusCode;

$span = $tracer->spanBuilder('risky-operation')->startSpan();

try {
    performRiskyOperation();
    $span->setStatus(StatusCode::STATUS_OK);

} catch (\Exception $e) {
    $span->recordException($e, [
        'exception.escaped' => true,
    ]);

    $span->setStatus(
        StatusCode::STATUS_ERROR,
        $e->getMessage()
    );

    throw $e;

} finally {
    $span->end();
}
```

## Metrics

Collect custom metrics to track application performance and business KPIs:

### Counter

Track cumulative values that only increase:

```php showLineNumbers
use OpenTelemetry\API\Globals;

$meter = Globals::meterProvider()->getMeter('my-app');

$requestCounter = $meter->createCounter(
    'http.requests',
    'requests',
    'Total number of HTTP requests'
);

// Increment counter
$requestCounter->add(1, [
    'http.method' => 'GET',
    'http.route' => '/api/users',
]);
```

### Histogram

Record distributions of values:

```php showLineNumbers
$requestDuration = $meter->createHistogram(
    'http.request.duration',
    'milliseconds',
    'HTTP request duration'
);

$startTime = hrtime(true);

// Process request
handleRequest();

$duration = (hrtime(true) - $startTime) / 1e6; // Convert to milliseconds

$requestDuration->record($duration, [
    'http.method' => 'POST',
    'http.status_code' => 200,
]);
```

### UpDownCounter

Track values that can increase or decrease:

```php showLineNumbers
$activeConnections = $meter->createUpDownCounter(
    'db.connections.active',
    'connections',
    'Currently active database connections'
);

// Connection opened
$activeConnections->add(1);

// Connection closed
$activeConnections->add(-1);
```

## Context Propagation

Propagate trace context across HTTP requests:

### Outgoing HTTP Requests

```php showLineNumbers
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;

$span = $tracer->spanBuilder('external-api-call')->startSpan();
$scope = $span->activate();

try {
    // Get current context
    $context = \OpenTelemetry\Context\Context::getCurrent();

    // Inject trace context into HTTP headers
    $carrier = [];
    TraceContextPropagator::getInstance()->inject($carrier, null, $context);

    // Make HTTP request with trace headers
    $client = new \GuzzleHttp\Client();
    $response = $client->request('GET', 'https://api.example.com/data', [
        'headers' => $carrier
    ]);

} finally {
    $scope->detach();
    $span->end();
}
```

### Incoming HTTP Requests

```php showLineNumbers
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;

// Extract context from incoming request headers
$headers = getallheaders();

$context = TraceContextPropagator::getInstance()->extract($headers);

// Start span with extracted context
$span = $tracer->spanBuilder('handle-request')
    ->setParent($context)
    ->startSpan();

$scope = $span->activate();

try {
    handleRequest();
} finally {
    $scope->detach();
    $span->end();
}
```

## Framework-Specific Examples

### Symfony Controller

```php showLineNumbers
namespace App\Controller;

use OpenTelemetry\API\Globals;
use Symfony\Component\HttpFoundation\Response;

class UserController
{
    private $tracer;

    public function __construct()
    {
        $this->tracer = Globals::tracerProvider()->getTracer('symfony-app');
    }

    public function index(): Response
    {
        $span = $this->tracer->spanBuilder('UserController::index')->startSpan();
        $scope = $span->activate();

        try {
            $users = $this->fetchUsers();

            $span->setAttribute('user.count', count($users));

            return new Response(json_encode($users));

        } finally {
            $scope->detach();
            $span->end();
        }
    }
}
```

### WordPress Plugin

```php showLineNumbers
use OpenTelemetry\API\Globals;

add_action('init', function() {
    $tracer = Globals::tracerProvider()->getTracer('wordpress-plugin');

    add_filter('the_content', function($content) use ($tracer) {
        $span = $tracer->spanBuilder('process_content')->startSpan();

        try {
            // Process content
            $processed = processContent($content);

            $span->setAttribute('content.length', strlen($processed));

            return $processed;

        } finally {
            $span->end();
        }
    });
});
```

### Plain PHP Application

```php showLineNumbers
<?php

require 'vendor/autoload.php';
require 'config/telemetry.php';

use OpenTelemetry\API\Globals;

$tracer = Globals::tracerProvider()->getTracer('my-app');

// Start request span
$requestSpan = $tracer->spanBuilder('http.request')->startSpan();
$requestScope = $requestSpan->activate();

try {
    $requestSpan->setAttribute('http.method', $_SERVER['REQUEST_METHOD']);
    $requestSpan->setAttribute('http.url', $_SERVER['REQUEST_URI']);

    // Route request
    $route = $_GET['route'] ?? 'home';

    $routeSpan = $tracer->spanBuilder("route.{$route}")->startSpan();
    try {
        handleRoute($route);
    } finally {
        $routeSpan->end();
    }

    http_response_code(200);
    $requestSpan->setAttribute('http.status_code', 200);

} catch (\Exception $e) {
    $requestSpan->recordException($e);
    $requestSpan->setAttribute('http.status_code', 500);
    http_response_code(500);

} finally {
    $requestScope->detach();
    $requestSpan->end();
}
```

## Best Practices

### 1. Always End Spans

```php
// Good
$span = $tracer->spanBuilder('operation')->startSpan();
try {
    doWork();
} finally {
    $span->end(); // Always called
}

// Bad - span may not end if exception thrown
$span = $tracer->spanBuilder('operation')->startSpan();
doWork();
$span->end();
```

### 2. Use Descriptive Span Names

```php
// Good
$span = $tracer->spanBuilder('UserRepository::findById')->startSpan();
$span = $tracer->spanBuilder('PaymentService::processPayment')->startSpan();

// Bad
$span = $tracer->spanBuilder('operation')->startSpan();
$span = $tracer->spanBuilder('query')->startSpan();
```

### 3. Add Relevant Attributes

```php
// Good
$span->setAttribute('user.id', $userId);
$span->setAttribute('order.amount', $amount);
$span->setAttribute('cache.hit', true);

// Bad - too verbose or sensitive data
$span->setAttribute('user.password', $password); // Never!
$span->setAttribute('full.sql.query', $query); // May contain sensitive data
```

### 4. Detach Scopes Properly

```php
// Good
$scope = $span->activate();
try {
    doWork();
} finally {
    $scope->detach(); // Always detach
    $span->end();
}

// Bad - scope not detached, causes context pollution
$span->activate();
doWork();
$span->end();
```

### 5. Use Batch Processing in Production

```php
// Production - use BatchSpanProcessor
$tracerProvider = new TracerProvider(
    new BatchSpanProcessor($exporter)
);

// Development - use SimpleSpanProcessor for immediate export
$tracerProvider = new TracerProvider(
    new SimpleSpanProcessor($exporter)
);
```

## Complete Example

Here's a complete example of a PHP application with custom instrumentation:

```php showLineNumbers title="app.php"
<?php

require 'vendor/autoload.php';

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;

// Initialize telemetry
$transport = (new OtlpHttpTransportFactory())->create(
    'http://localhost:4318',
    'application/x-protobuf'
);

$tracerProvider = new TracerProvider(
    new BatchSpanProcessor(new SpanExporter($transport))
);

Globals::registerInitializer(function() use ($tracerProvider) {
    return $tracerProvider;
});

$tracer = Globals::tracerProvider()->getTracer('my-app', '1.0.0');
$meter = Globals::meterProvider()->getMeter('my-app');

// Create metrics
$requestCounter = $meter->createCounter('requests.total', 'requests');
$requestDuration = $meter->createHistogram('requests.duration', 'ms');

// Handle request
$requestSpan = $tracer->spanBuilder('http.request')->startSpan();
$requestScope = $requestSpan->activate();
$startTime = hrtime(true);

try {
    $requestSpan->setAttribute('http.method', $_SERVER['REQUEST_METHOD']);
    $requestSpan->setAttribute('http.url', $_SERVER['REQUEST_URI']);

    // Business logic
    $result = processRequest();

    $requestSpan->setStatus(StatusCode::STATUS_OK);
    $statusCode = 200;

} catch (\Exception $e) {
    $requestSpan->recordException($e);
    $requestSpan->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
    $statusCode = 500;

} finally {
    $duration = (hrtime(true) - $startTime) / 1e6;

    $requestSpan->setAttribute('http.status_code', $statusCode);
    $requestCounter->add(1, ['status' => $statusCode]);
    $requestDuration->record($duration, ['status' => $statusCode]);

    $requestScope->detach();
    $requestSpan->end();

    // Ensure spans are flushed
    $tracerProvider->shutdown();
}
```

## References

- [Official OpenTelemetry PHP Documentation](https://opentelemetry.io/docs/languages/php/)
- [OpenTelemetry PHP GitHub](https://github.com/open-telemetry/opentelemetry-php)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Laravel Auto-Instrumentation](../auto-instrumentation/laravel.md) - Automatic
  tracing for Laravel applications
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up Scout Collector for local development
- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for your telemetry data
