---
title: Laravel OpenTelemetry Instrumentation
sidebar_label: Laravel
description:
  Auto-instrument Laravel with OpenTelemetry for traces. Complete PHP APM setup
  with distributed tracing and HTTP monitoring.
keywords:
  [
    laravel monitoring,
    php apm,
    laravel instrumentation,
    opentelemetry laravel,
    php monitoring,
  ]
---

# Laravel

Implement OpenTelemetry instrumentation for `Laravel` applications to collect
traces using the php OpenTelemetry SDK.

> Note: This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> official
> [OpenTelemetry documentation](https://opentelemetry.io/docs/zero-code/php/).

## Overview

This guide demonstrates how to:

- Install opentelemetry extension for php.
- Set up OpenTelemetry instrumentation for Laravel.
- Configure OpenTelemetry instrumentation using environment variables.
- Export telemetry data to Scout Collector

## Prerequisites

Before starting, ensure you have:

- Laravel version 8.1
- Working Laravel application.

## Step 1: Install opentelemetry extension for php

Setup development environment. Installing from source requires proper
development environment and some dependencies:

```bash
sudo apt-get install gcc make autoconf
```

Build/install the extension. With your environment set up you can install the
extension:

```bash
pecl install opentelemetry
```

Add the extension to your `php.ini` file:

```text
[opentelemetry]
extension=opentelemetry.so
```

Verify that the extension is installed and enabled:

```bash
php -m | grep opentelemetry
```

The output should look similar to this:

```bash
opentelemetry
```

Good work, now we have installed the opentelemetry extension

## Step 2: Import the packages

Navigate to the project folder and run the following to install necessary
packages

```bash
composer require \
    open-telemetry/sdk \
    open-telemetry/exporter-otlp \
    open-telemetry/opentelemetry-auto-slim \
    open-telemetry/opentelemetry-auto-psr18 \
    open-telemetry/opentelemetry-auto-laravel
```

> Note: If you are using any additional packages refer
> [packagist](https://packagist.org/search/?query=open-telemetry) and add them
> to the above command.

## Step 3: Configuration

Now let's setup the necessary Configuration When used in conjunction with the
OpenTelemetry SDK, you can use environment variables to configure
auto-instrumentation.

Environment configuration

```text
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_SERVICE_NAME=<larvel-application-name>
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_PROPAGATORS=baggage,tracecontext
```

That's it, run you application and head over to Scout dashboard to visulize the
data flowing

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Express.js Instrumentation](./express.md) - Node.js framework alternative
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
