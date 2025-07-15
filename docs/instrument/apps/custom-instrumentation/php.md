# PHP

Implement OpenTelemetry custom instrumentation for `PHP` applications to
collect logs, metrics, and traces using the PHP OpenTelemetry SDK.

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry custom instrumentation for `PHP`
- Configure manual tracing using spans
- Create and manage custom metrics
- Add semantic attributes and events
- Export telemetry data to Base14 Scout backend collector.

## Prerequisites

Before starting, ensure you have:

- PHP 8.0 or later installed
- Composer installed for dependency management
- A PHP project set up
- Required PHP extensions: `ext-json`, `ext-mbstring`, `ext-curl`

## Required Packages

Install the following necessary packages using Composer:

```bash
# Core OpenTelemetry PHP API and SDK
composer require open-telemetry/opentelemetry-php \
    # OTLP (OpenTelemetry Protocol) exporter for sending telemetry data
    open-telemetry/opentelemetry-php-exporter-otlp \
    # PHP SDK implementation of OpenTelemetry
    open-telemetry/opentelemetry-php-sdk

# Optional but recommended packages
composer require \
    # Semantic conventions for standardized attribute naming
    open-telemetry/opentelemetry-php-sem-conv 
```

## Traces

To start tracing, you need to initialize a TracerProvider and create a Tracer:

```php
use OpenTelemetry\API\Common\Instrumentation\Configurator;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\SDK\Trace\TracerProviderFactory;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Common\Attribute\Attributes;

// Initialize TracerProvider
$resource = ResourceInfo::create(Attributes::create([
    'service.name' => 'your-service-name',
    'service.version' => '1.0.0',
]));

$tracerProvider = (new TracerProviderFactory('your-service-name'))
    ->setResource($resource)
    ->create();

// Get a tracer
$tracer = $tracerProvider->getTracer('your-instrumentation-name', '1.0.0');
```

### Creating Spans

Create spans to represent operations in your application:

```php
try {
    // Start a new span
    $span = $tracer->spanBuilder('operation-name')
        ->setSpanKind(SpanKind::KIND_SERVER)
        ->startSpan();
    
    // Set attributes
    $span->setAttribute('http.method', 'GET');
    $span->setAttribute('http.route', '/api/endpoint');
    
    // Your application code here
    // ...
    
    // Add event
    $span->addEvent('Processing completed', [
        'result' => 'success',
        'items_processed' => 42,
    ]);
    
    // End the span
    $span->end();
} catch (\Throwable $e) {
    // Record exception
    $span->recordException($e);
    $span->setStatus(\OpenTelemetry\API\Trace\StatusCode::STATUS_ERROR);
    throw $e;
} finally {
    // Ensure the span is ended
    if (isset($span)) {
        $span->end();
    }
}
```

## Metrics

```php
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Metrics\MetricReader\ExportingReader;
use OpenTelemetry\SDK\Metrics\Export\ConsoleMetricsExporter;

// Create a metric reader (console exporter for demonstration)
$exporter = new ConsoleMetricsExporter();
$reader = new ExportingReader($exporter);

// Create meter provider
$meterProvider = new MeterProvider([], null, null, [$reader]);

// Get a meter
$meter = $meterProvider->getMeter('your-meter-name');
```

### Creating Metrics

#### Counter

```php
// Create a counter
$counter = $meter->createCounter('http.requests', 'requests', 'Number of HTTP requests');

// Increment counter
$counter->add(1, ['http.method' => 'GET', 'http.route' => '/api/endpoint']);
```

#### Histogram

```php
// Create a histogram
$histogram = $meter->createHistogram(
    'http.request.duration',
    'ms',
    'Duration of HTTP requests in milliseconds'
);

// Record a duration
$start = microtime(true);
// ... your code ...
$duration = (microtime(true) - $start) * 1000; // Convert to milliseconds
$histogram->record($duration, ['http.method' => 'GET', 'http.status_code' => 200]);
```

## Logs

```php
use OpenTelemetry\SDK\Logs\LoggerProvider;
use OpenTelemetry\SDK\Logs\Processor\SimpleLogRecordProcessor;
use OpenTelemetry\SDK\Logs\Exporter\ConsoleExporter;

// Create a log record exporter
$exporter = new ConsoleExporter();

// Create a log record processor
$processor = new SimpleLogRecordProcessor($exporter);

// Create a logger provider
$loggerProvider = new LoggerProvider($processor);

// Get a logger
$logger = $loggerProvider->getLogger('your-logger-name');
```

### Logging

```php
use OpenTelemetry\API\Logs\LogRecord;
use OpenTelemetry\API\Common\LogRecord as LogRecordInterface;

// Create a log record
$logRecord = (new LogRecord())
    ->setSeverityNumber(LogRecordInterface::SEVERITY_NUMBER_INFO)
    ->setBody('User logged in')
    ->setAttributes([
        'user.id' => 12345,
        'user.email' => 'user@example.com',
        'http.method' => 'POST',
        'http.route' => '/auth/login',
    ]);

// Emit the log record
$logger->emit($logRecord);
```

## Exporting Telemetry Data

### OTLP Exporter

To export telemetry data to an OpenTelemetry Collector:

```php
use OpenTelemetry\SDK\Trace\SpanExporter\OtlpHttpExporter;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;

// Create OTLP exporter
$otlpExporter = new OtlpHttpExporter(
    'http://0.0.0.0:4318/v1/traces', // OTLP HTTP endpoint
    'application/json',
    [], // Headers
    10, // Timeout in seconds
    1,  // Max retries
    true // Compress with gzip
);

// Create span processor
$spanProcessor = new SimpleSpanProcessor($otlpExporter);

// Add processor to tracer provider
$tracerProvider->addSpanProcessor($spanProcessor);
```

### Console Exporter (Development)

For development and testing, you can use the console exporter:

```php
use OpenTelemetry\SDK\Trace\SpanExporter\ConsoleSpanExporter;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;

$exporter = new ConsoleSpanExporter();
$processor = new SimpleSpanProcessor($exporter);
$tracerProvider->addSpanProcessor($processor);
```

## Best Practices

1. **Error Handling**:
   - Always end spans in a `finally` block
   - Record exceptions using `$span->recordException($e)`
   - Set appropriate span status for errors

2. **Performance**:
   - Batch process spans and metrics when possible
   - Use asynchronous exporters in production
   - Be mindful of cardinality in attributes

3. **Resource Attributes**:
   - Include relevant resource attributes (service name, version, environment, etc.)
   - Add deployment-specific attributes (hostname, instance ID, etc.)

## Troubleshooting

1. **No Data Appearing**:
   - Verify the OTLP endpoint is correct and accessible
   - Check for PHP errors in your logs
   - Ensure spans are being properly ended with `$span->end()`

2. **Performance Issues**:
   - Consider using batch processors in production
   - Review your sampling configuration
   - Check for memory leaks in long-running processes

3. **Common Errors**:
   - `Class not found`: Ensure all required extensions are installed
   - `Export failed`: Check network connectivity to the collector
   - `Invalid argument`: Verify attribute types match expected values

> View the telemetry data in the Base14 Scout observability backend.

## Next Steps

- [OpenTelemetry PHP Documentation](https://opentelemetry.io/docs/languages/php/)
- [PHP OpenTelemetry SDK on GitHub](https://github.com/open-telemetry/opentelemetry-php)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/trace/semantic_conventions/)
