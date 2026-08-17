---
title: WordPress OpenTelemetry Instrumentation - Self-Hosted
sidebar_label: WordPress
sidebar_position: 30.5
description:
  Instrument self-hosted WordPress with OpenTelemetry. Request, template, and
  MySQL query spans on Apache or PHP-FPM, with no theme or plugin changes.
keywords:
  [
    wordpress opentelemetry instrumentation,
    wordpress monitoring,
    wordpress apm,
    wordpress distributed tracing,
    wordpress observability,
    wordpress php tracing,
    self hosted wordpress monitoring,
    wordpress mysqli spans,
    wordpress apache mod_php tracing,
    wordpress php-fpm opentelemetry,
    opentelemetry php extension,
    auto_prepend_file opentelemetry,
    wordpress performance monitoring,
    wordpress slow query tracing,
    wordpress mariadb observability,
    wordpress otlp exporter,
    wordpress opentelemetry collector,
    wordpress sre monitoring,
    base14 scout,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Does this work on WordPress.com or managed hosting?","acceptedAnswer":{"@type":"Answer","text":"Only if the host lets you install a PECL extension and add a file to PHP's conf.d directory. The PECL opentelemetry extension provides the hook mechanism the instrumentation packages attach to, and auto_prepend_file loads them before WordPress boots. Managed hosting with a fixed PHP extension set allows neither. A VM, a container image you build, or a bare metal LAMP server all work."}},{"@type":"Question","name":"Do I need to modify my theme or install a plugin?","acceptedAnswer":{"@type":"Answer","text":"No. Nothing is installed into WordPress and no application code changes. The Composer packages live in a directory outside the docroot, and a php.ini drop-in points auto_prepend_file at their autoloader so the SDK is running before WordPress starts. Themes, plugins, and core files are untouched."}},{"@type":"Question","name":"Why do I get no database spans?","acceptedAnswer":{"@type":"Answer","text":"The open-telemetry/opentelemetry-auto-mysqli package is missing, or mysqli is listed in OTEL_PHP_DISABLED_INSTRUMENTATIONS. WordPress core reaches the database through mysqli, and that package produces the mysqli_query and mysqli_real_connect spans. A PDO instrumentation package does not cover it. Seeing wpdb.* spans without mysqli_* spans points to one of those two causes."}},{"@type":"Question","name":"Does it work with PHP-FPM?","acceptedAnswer":{"@type":"Answer","text":"Yes. Apache with mod_php and PHP-FPM behind nginx produce the same spans. The one thing to check on FPM is that the pool does not clear the worker environment, because the SDK is configured entirely through OTEL_* environment variables. The official wordpress:*-fpm image already ships clear_env = no, so on that image there is normally nothing to change."}},{"@type":"Question","name":"How many spans does one page load produce?","acceptedAnswer":{"@type":"Answer","text":"On a default site with three posts and no plugins, between 22 and 86 spans per request depending on the path: 22 for the login form, 86 for a single post. Span count tracks query count, because each query produces a wpdb.query span and a mysqli_query child. The first front-end request against a brand new site costs about 34 spans more than the steady state, because the theme writes options and posts the database does not have yet; that is paid once per site. These numbers come from a site with no plugins, so yours will be higher."}},{"@type":"Question","name":"What happens on a WordPress core update?","acceptedAnswer":{"@type":"Answer","text":"Nothing, if the Composer packages are outside the docroot. A core update rewrites /var/www/html, and so does the official image's entrypoint, so anything installed there gets overwritten. Install to /opt/otel and point auto_prepend_file there instead; no WordPress update touches it. The php.ini drop-in is safe either way."}},{"@type":"Question","name":"Can I tell which plugin is slow?","acceptedAnswer":{"@type":"Answer","text":"Not from auto-instrumentation alone. No span name or instrumentation scope identifies a plugin, so plugin work is not separated from core work. Every query a request issued is still recorded with its SQL text on the wpdb.query and mysqli_query spans, which is often enough to recognise the source. To attribute time directly, wrap the plugin's hooks in manual spans."}},{"@type":"Question","name":"How much overhead does OpenTelemetry add to WordPress?","acceptedAnswer":{"@type":"Answer","text":"On a small default site, instrumentation roughly doubles the median request, in the range 1.7x to 2.3x, and adds roughly 8 to 12 MiB to the WordPress container at six prefork workers. The ratio is more useful than a millisecond figure, since the base is small on a bare site and the absolute cost moves with host load. That is a bare site with no plugins, so your numbers will be higher."}},{"@type":"Question","name":"Which WordPress versions are supported?","acceptedAnswer":{"@type":"Answer","text":"WordPress 6.0 and later, on PHP 8.2 or later. The floor is set by PHP: the mysqli package requires PHP 8.2, and 6.0 is the earliest WordPress release compatible with it. Nothing checks the WordPress version at install time, so an upgrade that breaks the instrumentation shows up as missing spans rather than a failed install. Check that spans still arrive after a major upgrade."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"Instrument self-hosted WordPress with OpenTelemetry","step":[{"@type":"HowToStep","name":"Install the PECL opentelemetry extension","text":"Install the opentelemetry extension with pecl on the host or in the container image that runs PHP, and enable it. It provides the hook mechanism the auto-instrumentation packages attach to. Without it loaded, the packages install and run but produce no spans."},{"@type":"HowToStep","name":"Install the Composer packages outside the WordPress docroot","text":"Install open-telemetry/sdk, open-telemetry/exporter-otlp, open-telemetry/opentelemetry-auto-wordpress, open-telemetry/opentelemetry-auto-mysqli, and a PSR-18 HTTP client into a directory outside /var/www/html, such as /opt/otel. Allow the tbachert/spi and php-http/discovery Composer plugins. Where Composer runs without the extension present, pass --ignore-platform-req=ext-opentelemetry."},{"@type":"HowToStep","name":"Point auto_prepend_file at the vendor autoloader","text":"Add a php.ini drop-in to the conf.d directory of the SAPI that serves traffic, containing extension=opentelemetry.so and auto_prepend_file=/opt/otel/vendor/autoload.php. WordPress has no bootstrap file that survives a core update, so the prepend directive attaches the instrumentation instead."},{"@type":"HowToStep","name":"Configure the SDK with OTEL_* environment variables","text":"Set OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL, the exporter variables, and OTEL_PHP_AUTOLOAD_ENABLED=true. Set both deployment.environment and lowercase environment in OTEL_RESOURCE_ATTRIBUTES. On PHP-FPM, confirm the pool does not clear the worker environment."},{"@type":"HowToStep","name":"Verify the extension and the prepend for the serving SAPI","text":"Run php -m | grep opentelemetry to confirm the extension is loaded, and php -i | grep auto_prepend_file to confirm the autoloader is prepended. The CLI reads a different ini set than the SAPI that serves traffic, so check the serving SAPI too: php-fpm8.4 -i on PHP-FPM, or a temporary phpinfo() page under Apache with mod_php. Then request a page and confirm spans reach the collector."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# WordPress

## Introduction

Instrument a self-hosted WordPress site with OpenTelemetry without installing a
plugin, editing a theme, or patching core. The PECL `opentelemetry` extension
loads a Composer autoloader through PHP's `auto_prepend_file` directive, before
WordPress boots. From there, two auto-instrumentation packages hook WordPress
core and the `mysqli` driver it uses to reach MySQL or MariaDB. Every request
produces a trace: a root span named after the entry script PHP executed, spans
for the stages of the WordPress request lifecycle, and two database spans per
query, `wpdb.query` and its `mysqli_query` child, both carrying the SQL
statement.

`open-telemetry/opentelemetry-auto-wordpress` emits the `WP.*`, `wpdb.*`, and
`get_single_template` spans, and `open-telemetry/opentelemetry-auto-mysqli`
emits `mysqli_real_connect` and `mysqli_query`. Both packages attach through
the PECL extension, and install without producing spans if it is not loaded.
The PHP SDK and the OTLP exporter, both Composer packages, batch and ship what
the two produce.

The setup needs a host where you can install a PECL extension and add a
`php.ini` drop-in, such as a VM, a container image you build, or a bare metal
LAMP server. Managed WordPress hosting with a fixed PHP extension set cannot
run it, since the hooks have nothing to attach to without the extension.

:::tip TL;DR

Install the PECL `opentelemetry` extension, install
`open-telemetry/opentelemetry-auto-wordpress` and
`open-telemetry/opentelemetry-auto-mysqli` with Composer into a directory
outside the WordPress docroot, and point `auto_prepend_file` at that vendor
autoloader from a `conf.d` ini drop-in. WordPress core and the `mysqli` driver
are then traced with no plugin installed and no theme edit. Each request
produces a root span named after the entry script PHP ran (`GET /index.php` for
anything routed through the front controller, `GET /wp-login.php` for a direct
script hit), `WP.*` spans for the request lifecycle, and a `mysqli_query` span
carrying `db.query.text` under every `wpdb.query`. Configure the SDK with the
standard `OTEL_*` environment variables and export OTLP to a collector.

:::

## Who This Guide Is For

- **SRE and platform teams** running WordPress on their own VMs, containers, or
  bare metal, who need request and query visibility they can query alongside
  their other services.
- **WordPress and agency engineers** who want tracing without shipping a
  monitoring plugin to every site they maintain.
- **Teams replacing a plugin-based or agent-based APM** with vendor-neutral
  OTLP that exports to a collector they control.
- **Engineers debugging slow pages**, who need to see which queries a given
  request issued and how many of them there were.
- **Platform teams standardising on OpenTelemetry**, who need WordPress to
  report under the same conventions as the rest of the estate.

## Prerequisites

Before starting, ensure you have:

- **A host where you can install a PECL extension** and add a file to PHP's
  `conf.d` directory. Managed hosting with a fixed extension set will not work.
- **PHP 8.2 or later.** The floor comes from
  `open-telemetry/opentelemetry-auto-mysqli`, which declares `php: ^8.2`.
- **Composer**, to install the SDK, the OTLP exporter, and the two
  auto-instrumentation packages.
- **WordPress using the `mysqli` driver** against MySQL or MariaDB. This is the
  stock configuration.
- **A collector reachable over OTLP**, with a traces pipeline. See
  [Docker Compose collector setup](../../collector-setup/docker-compose-example.md).
- **Docker and Docker Compose** if you want to run the example stack locally.

## Compatibility Matrix

| Component | Minimum Version | Recommended Version |
| --- | --- | --- |
| WordPress | 6.0 | 7.x |
| PHP | 8.2 | 8.4 |
| MariaDB | 10.11 | 11.4 |
| PECL `opentelemetry` | No constraint declared | 1.2.1 |

`opentelemetry-auto-mysqli` declares `php: ^8.2`, and 6.0 is the earliest
WordPress release compatible with PHP 8.2. The MariaDB floor is WordPress's own
recommendation. Nothing checks the WordPress version at install time, so an
upgrade that breaks the instrumentation shows up as missing spans rather than a
failed install.

## What Gets Instrumented

Spans arrive under two instrumentation scopes,
`io.opentelemetry.contrib.php.wordpress` and
`io.opentelemetry.contrib.php.mysqli`. The **Instrumentation** column below
holds the short name each package registers, which is what
`OTEL_PHP_DISABLED_INSTRUMENTATIONS` takes.

| Span name | Kind | Instrumentation | Attribute keys |
| --- | --- | --- | --- |
| `GET /index.php` | SERVER | `wordpress` | `client.address`, `client.port`, `http.request.body.size`, `http.request.method`, `http.response.status_code`, `network.protocol.version`, `url.full`, `url.path`, `url.scheme`, `user_agent.original`, `wp.is_admin` |
| `GET /wp-login.php` | SERVER | `wordpress` | `client.address`, `client.port`, `http.request.body.size`, `http.request.method`, `network.protocol.version`, `url.full`, `url.path`, `url.scheme`, `user_agent.original`, `wp.is_admin` |
| `WP.main` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.init` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.parse_request` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.query_posts` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.register_globals` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.send_headers` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `WP.handle_404` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `get_single_template` | SERVER | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `wpdb.__construct` | INTERNAL | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number`, `db.namespace`, `db.system.name` |
| `wpdb.db_connect` | CLIENT | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number` |
| `wpdb.query` | CLIENT | `wordpress` | `code.file.path`, `code.function.name`, `code.line.number`, `db.query.text` |
| `mysqli_real_connect` | CLIENT | `mysqli` | `code.function.name`, `db.system.name`, `server.address`, `server.port` |
| `mysqli_query` | CLIENT | `mysqli` | `code.function.name`, `db.namespace`, `db.operation.name`, `db.query.text`, `db.system.name`, `server.address`, `server.port` |

Each list holds the keys a span can carry rather than the keys it always
carries. `http.response.status_code` is the main one to be careful with. In our
captures the 404 response carried it and every 200 response did not, and we
have not tested enough non-200 statuses to say where the boundary actually
falls. Either way it is not on every root span, so an alert or dashboard that
expects it on every request will silently drop most of your traffic. Filter on
whether the key is present rather than on its value.

The instrumentation does not cover:

- **Plugin attribution.** No span or scope names a plugin, so plugin work is
  not separable from core work. You can add your own spans for the plugin code
  you care about; see [Custom Instrumentation](#custom-instrumentation).
- **Route or permalink names.** The root span is named after the entry script
  rather than the matched route, the permalink, or the REST route, and nothing
  carries a `rest_route` value.
- **WP-Cron.** There is no cron-specific instrumentation. A `wp-cron.php`
  request gets the same entry-script root span as any other direct script hit,
  so match on `url.path` if you want to separate it out.

:::note

Because the root span carries the entry script name, nearly all traffic on a
site with pretty permalinks reports as `GET /index.php`. Use `url.path` or
`url.full` to tell requests apart. `url.path` alone is not always enough, since
a home page request and a search request both resolve to `url.path=/` and
differ only in `url.full`.

:::

A runnable stack that puts all of this together is at
[base-14/examples/php/wordpress-mariadb](https://github.com/base-14/examples/tree/main/php/wordpress-mariadb).

## Installation

All three paths install the same Composer packages into a directory outside the
WordPress docroot, then point `auto_prepend_file` at that directory's
autoloader.

```json title="composer.json" showLineNumbers
{
    "$schema": "https://getcomposer.org/schema.json",
    "name": "base14/wordpress-mariadb-otel",
    "type": "project",
    "description": "WordPress + MariaDB + OpenTelemetry auto-instrumentation example for Base14 Scout",
    "license": "MIT",
    "require": {
        "php": "^8.4",
        "open-telemetry/sdk": "^1.15",
        "open-telemetry/exporter-otlp": "^1.4",
        "open-telemetry/opentelemetry-auto-wordpress": "^0.2",
        "open-telemetry/opentelemetry-auto-mysqli": "^0.4",
        "php-http/guzzle7-adapter": "^1.1",
        "guzzlehttp/psr7": "^2.8"
    },
    "config": {
        "optimize-autoloader": true,
        "preferred-install": "dist",
        "sort-packages": true,
        "allow-plugins": {
            "php-http/discovery": true,
            "tbachert/spi": true
        }
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
```

`php-http/guzzle7-adapter` and `guzzlehttp/psr7` pin a concrete PSR-18 HTTP
client for the OTLP exporter. Without one, the exporter's client auto-discovery
can fail and spans are dropped silently.

Both entries under `allow-plugins` are required. `tbachert/spi` registers the
auto-instrumentation hooks and `php-http/discovery` wires the HTTP client, and
Composer will not run either plugin unless it is allowed.

The `"php": "^8.4"` constraint matches the images this builds on. Lower it to
`^8.2` if you are installing on an 8.2 or 8.3 host, or Composer will refuse the
install.

```mdx-code-block
<Tabs>
<TabItem value="docker" label="Docker (Recommended)" default>
```

Build the extension into an image derived from the official WordPress image.
Composer runs in a separate stage where the extension is not present, so its
platform requirement is skipped there and satisfied at runtime.

```dockerfile title="Dockerfile" showLineNumbers
# syntax=docker/dockerfile:1

ARG WP_VERSION=7.0.4

FROM composer:2 AS vendor

WORKDIR /opt/otel

COPY composer.json composer.lock* ./

# The extension is not present in this stage, so its platform requirement is skipped.
RUN composer install \
      --no-dev \
      --prefer-dist \
      --optimize-autoloader \
      --ignore-platform-req=ext-opentelemetry \
      --ignore-platform-req=ext-mysqli

FROM wordpress:${WP_VERSION}-php8.4-apache

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y $PHPIZE_DEPS && \
    pecl install opentelemetry-1.2.1 && \
    apt-get purge -y --auto-remove $PHPIZE_DEPS && \
    rm -rf /var/lib/apt/lists/*

# Outside the docroot: the entrypoint and core updates both rewrite /var/www/html.
COPY --from=vendor /opt/otel/vendor /opt/otel/vendor

COPY config/otel.ini /usr/local/etc/php/conf.d/99-otel.ini
COPY config/apache-wordpress.conf /etc/apache2/conf-enabled/wordpress.conf
```

Install the vendor directory at `/opt/otel/vendor`, not under `/var/www/html`.
The official image's entrypoint and any WordPress core update both rewrite the
docroot, so anything you put there will eventually be replaced.

Apache also needs `AllowOverride`. Debian's default config ignores the
`.htaccess` file WordPress writes its rewrite rules into, so without it every
pretty permalink returns a 404.

```apache title="config/apache-wordpress.conf" showLineNumbers
# Permalink rewrites live in .htaccess, which Debian's default config ignores.
<Directory /var/www/html>
    AllowOverride All
</Directory>
```

The PHP-FPM image differs in three lines: the base tag becomes
`wordpress:${WP_VERSION}-php8.4-fpm`, the last `COPY` writes the pool file to
`/usr/local/etc/php-fpm.d/zz-wordpress.conf` instead of the Apache conf, and
`libfcgi-bin` joins the `apt-get install` line so the container healthcheck can
call `cgi-fcgi`. See [Deployment Shapes](#deployment-shapes) for the pool file.

```mdx-code-block
</TabItem>
<TabItem value="ubuntu" label="Ubuntu/Debian">
```

`pecl` compiles the extension, so install PEAR and the PHP development headers
for your version first, then install the extension and enable it:

```bash
sudo apt-get install -y php-pear php8.4-dev
sudo pecl install opentelemetry-1.2.1
sudo phpenmod opentelemetry
```

Confirm it loaded:

```bash
php -m | grep opentelemetry
```

If `phpenmod` does not pick it up, write the module file yourself and enable it
again:

```bash
echo "extension=opentelemetry.so" | sudo tee /etc/php/8.4/mods-available/opentelemetry.ini
sudo phpenmod opentelemetry
```

PHP-FPM can use a different ini path than the CLI. Check the FPM binary
separately:

```bash
php-fpm8.4 -m | grep opentelemetry
```

Install the Composer packages into a directory outside the docroot:

```bash
sudo mkdir -p /opt/otel
cd /opt/otel
sudo env COMPOSER_ALLOW_SUPERUSER=1 composer config --no-plugins allow-plugins.php-http/discovery true
sudo env COMPOSER_ALLOW_SUPERUSER=1 composer config --no-plugins allow-plugins.tbachert/spi true
sudo env COMPOSER_ALLOW_SUPERUSER=1 composer require \
  open-telemetry/sdk:^1.15 \
  open-telemetry/exporter-otlp:^1.4 \
  open-telemetry/opentelemetry-auto-wordpress:^0.2 \
  open-telemetry/opentelemetry-auto-mysqli:^0.4 \
  php-http/guzzle7-adapter:^1.1 \
  guzzlehttp/psr7:^2.8
```

Point `auto_prepend_file` at the autoloader. WordPress has no bootstrap file of
its own that survives a core update, so the prepend directive attaches the
instrumentation instead. Write the drop-in for the SAPI you run:

```bash
# PHP-FPM
echo "auto_prepend_file=/opt/otel/vendor/autoload.php" \
  | sudo tee /etc/php/8.4/fpm/conf.d/99-otel.ini
sudo systemctl restart php8.4-fpm

# Apache with mod_php
echo "auto_prepend_file=/opt/otel/vendor/autoload.php" \
  | sudo tee /etc/php/8.4/apache2/conf.d/99-otel.ini
sudo systemctl restart apache2
```

```mdx-code-block
</TabItem>
<TabItem value="alpine" label="Alpine">
```

Alpine has no prebuilt package for the extension, so compile it with `pecl`.
Install the build toolchain, compile, then remove the toolchain again so it does
not stay in the image:

```bash
apk add --no-cache --virtual .build-deps $PHPIZE_DEPS
pecl install opentelemetry-1.2.1
apk del --no-network .build-deps
```

`$PHPIZE_DEPS` is set by the official `php` Docker images, which the
`wordpress:*-alpine` images build on. It holds the compiler toolchain that
`phpize` and `pecl` need. On a plain Alpine host that is not derived from those
images the variable does not exist, so install the toolchain and the PHP
development headers for your PHP version by name instead.

Write the ini drop-in and install the Composer packages:

```bash
mkdir -p /opt/otel
cd /opt/otel
composer config --no-plugins allow-plugins.php-http/discovery true
composer config --no-plugins allow-plugins.tbachert/spi true
composer require \
  open-telemetry/sdk:^1.15 \
  open-telemetry/exporter-otlp:^1.4 \
  open-telemetry/opentelemetry-auto-wordpress:^0.2 \
  open-telemetry/opentelemetry-auto-mysqli:^0.4 \
  php-http/guzzle7-adapter:^1.1 \
  guzzlehttp/psr7:^2.8

cat > /usr/local/etc/php/conf.d/99-otel.ini <<'EOF'
extension=opentelemetry.so
auto_prepend_file=/opt/otel/vendor/autoload.php
EOF
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Verify the install

Two things have to be true: the extension is loaded, and the autoloader is
prepended. On the CLI:

```bash
php -m | grep opentelemetry
php -i | grep auto_prepend_file
```

Expected output:

```plaintext
opentelemetry
auto_prepend_file => /opt/otel/vendor/autoload.php => /opt/otel/vendor/autoload.php
```

The CLI reads a different ini set than the SAPI that serves traffic, so a CLI
pass does not prove the web path works. Check the serving SAPI as well. On
PHP-FPM, `php-fpm8.4 -i` reads the FPM ini set:

```bash
php-fpm8.4 -m | grep opentelemetry
php-fpm8.4 -i | grep auto_prepend_file
```

Under Apache with `mod_php`, drop a one-line `phpinfo()` script into the
docroot, request it over HTTP, then delete it.

## Configuration

The SDK reads its configuration from the standard `OTEL_*` environment
variables. Two settings cannot come from the environment, because they have to
take effect before any PHP code runs: loading the extension and setting the
prepend file. Those live in a `php.ini` drop-in.

Set `environment` alongside `deployment.environment` in
`OTEL_RESOURCE_ATTRIBUTES`. Scout's UI filters on the lowercase `environment`
key, and carrying both keeps the resource valid under semantic conventions
while staying queryable in the UI.

```mdx-code-block
<Tabs>
<TabItem value="env" label="Environment Variables" default>
```

```bash
OTEL_SERVICE_NAME=wordpress-mariadb-otel
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_PHP_AUTOLOAD_ENABLED=true
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development,environment=development
```

`OTEL_PHP_AUTOLOAD_ENABLED=true` tells the SDK to configure itself from these
variables when the prepended autoloader runs. Without it, the packages load but
the SDK never starts.

`http/protobuf` uses port 4318. If you switch `OTEL_EXPORTER_OTLP_PROTOCOL` to
`grpc`, change the endpoint port to 4317.

`otel-collector` is a Docker Compose service name. On a bare host, point the
endpoint at wherever your collector listens, `http://127.0.0.1:4318` for a
collector on the same machine.

These have to reach the worker process, not your login shell. Under `systemd`,
put them in a drop-in for the FPM unit
(`systemctl edit php8.4-fpm`) as `Environment=` lines, or set them per pool with
`env[OTEL_SERVICE_NAME] = wordpress` in the pool config. Under Apache with
`mod_php`, use `SetEnv` in the virtual host. Either way, restart the service and
check the values landed with `php-fpm8.4 -i | grep OTEL_` or a `phpinfo()` page.

```mdx-code-block
</TabItem>
<TabItem value="ini" label="PHP ini">
```

```ini title="config/otel.ini" showLineNumbers
; Provides the hook mechanism the instrumentation packages attach to.
extension=opentelemetry.so

; WordPress has no bootstrap file that survives core updates.
auto_prepend_file=/opt/otel/vendor/autoload.php
```

Copy this to the `conf.d` directory for the SAPI that serves traffic. On the
official images that is `/usr/local/etc/php/conf.d/99-otel.ini`. The numeric
prefix controls load order, and 99 puts it last.

On Debian and Ubuntu the path is `/etc/php/8.4/fpm/conf.d/` or
`/etc/php/8.4/apache2/conf.d/`, and the drop-in there should carry the
`auto_prepend_file` line only. `phpenmod opentelemetry` already enables the
extension from `mods-available`, so keeping `extension=opentelemetry.so` here
too loads it twice and PHP logs a "module already loaded" warning at startup.

`auto_prepend_file` holds a single path, and the last drop-in to set it wins.
Some WordPress security plugins use it as well, Wordfence Extended Protection
among them, so check the current value before writing the drop-in:

```bash
php -i | grep auto_prepend_file
```

If a path is already set, chain it rather than replacing it: point
`auto_prepend_file` at a file of your own that `require`s the existing path and
then `/opt/otel/vendor/autoload.php`.

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose">
```

A YAML anchor keeps one copy of the OTel variables and applies it to every
service that needs it.

```yaml title="compose.yaml" showLineNumbers
x-otel-env: &otel-env
  OTEL_SERVICE_NAME: wordpress-mariadb-otel
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_TRACES_EXPORTER: otlp
  OTEL_METRICS_EXPORTER: otlp
  OTEL_LOGS_EXPORTER: otlp
  OTEL_PHP_AUTOLOAD_ENABLED: "true"
  OTEL_RESOURCE_ATTRIBUTES: deployment.environment=development,environment=development

x-db-creds: &db-creds
  WORDPRESS_DB_HOST: mariadb:3306
  WORDPRESS_DB_USER: wordpress
  WORDPRESS_DB_PASSWORD: wordpress

x-wp-env: &wp-env
  <<: *db-creds
  WORDPRESS_DB_NAME: wordpress
  WORDPRESS_CONFIG_EXTRA: |
    define('DISABLE_WP_CRON', true);

services:
  wordpress:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        WP_VERSION: ${WP_VERSION:-7.0.4}
    container_name: wordpress-app
    ports:
      - "${WP_APACHE_PORT:-8080}:80"
    volumes:
      - wordpress-data:/var/www/html
    environment:
      <<: [*wp-env, *otel-env]
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=development,environment=development,service.instance.role=apache
    healthcheck:
      test: ["CMD", "curl", "-fsS", "-o", "/dev/null", "http://localhost/"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
    depends_on:
      mariadb:
        condition: service_healthy
      otel-collector:
        condition: service_started
    restart: unless-stopped
    networks:
      - wordpress-network
```

The service-level `OTEL_RESOURCE_ATTRIBUTES` overrides the anchor's value
rather than merging with it, so it repeats the two environment keys and adds
`service.instance.role`. That attribute distinguishes an Apache instance from
an FPM instance when both report under one service name.

```mdx-code-block
</TabItem>
</Tabs>
```

## Deployment Shapes

All three take the same `conf.d` ini drop-in. The two containerised shapes were
captured side by side and produce the same spans; the bare-host shape runs the
same FPM SAPI and the same packages, so expect the same. What differs between
them is how environment variables reach PHP.

| | Apache + mod_php | FPM + nginx | FPM on a bare host |
| --- | --- | --- | --- |
| Env var propagation | Inherited from the Apache process | Official image sets `clear_env = no` in `docker.conf`; stripped without it | Stripped unless `clear_env = no`, or set per pool with `env[...]` |
| Process model | One process handles the full request | Web server and PHP are separate processes | Same, plus systemd unit boundaries |
| Pick it when | Running the official image or a standard LAMP install | Already terminating TLS at nginx, or scaling PHP workers separately | Instrumenting an existing host without containerising it |

The official `wordpress:*-fpm` image ships
`/usr/local/etc/php-fpm.d/docker.conf` with an active `clear_env = no`, loaded
ahead of any pool file you add, so on that image there is nothing to change.
Check your own image the same way, substituting your FPM service name:

```bash
docker compose exec wordpress-fpm cat /usr/local/etc/php-fpm.d/docker.conf
```

The pool file below re-asserts `clear_env = no` for a hand-rolled pool that does
not inherit that `docker.conf`. It also defines the `ping.path` endpoint used as
a readiness check, since FPM speaks FastCGI and cannot be probed with `curl`.
[Troubleshooting](#fpm-workers-cannot-see-otel-variables) covers what breaks
when the worker environment is cleared.

```ini title="config/php-fpm.conf" showLineNumbers
[www]
listen = 0.0.0.0:9000

pm = dynamic
pm.max_children = 10
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 4

ping.path = /ping
ping.response = pong

; Keep OTEL_* visible to FPM workers. The official image sets this in docker.conf; a hand-rolled pool may not.
clear_env = no
```

nginx passes PHP requests to the FPM pool over FastCGI and rewrites everything
else to the front controller.

```nginx title="config/nginx.conf" showLineNumbers
server {
    listen 80;
    server_name _;
    root /var/www/html;
    index index.php;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_pass wordpress-fpm:9000;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}
```

## Production Configuration

### Collector configuration

A production collector config for this workload, with a `filter` processor for
probe traffic, `memory_limiter` ahead of `batch` in every pipeline, and `gzip`
on the exporter. It is a hardened version of the example's
`config/otel-config.yaml`, not a copy of it:

```yaml showLineNumbers
extensions:
  oauth2client:
    client_id: ${SCOUT_CLIENT_ID}
    client_secret: ${SCOUT_CLIENT_SECRET}
    token_url: ${SCOUT_TOKEN_URL}
    endpoint_params:
      audience: b14collector
    timeout: 10s
  health_check:
    endpoint: 0.0.0.0:13133
  zpages:
    endpoint: 0.0.0.0:55679

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    limit_mib: 256
    check_interval: 1s
  # Conditions are examples. Rewrite them against your own probe's
  # url.path and user_agent.original before relying on this.
  filter/noise:
    error_mode: ignore
    traces:
      span:
        - 'attributes["url.path"] == "/health"'
        - 'IsMatch(attributes["user_agent.original"], "^(kube-probe|ELB-HealthChecker|Blackbox).*")'
        - 'IsMatch(attributes["url.path"], ".*\\.(css|js|png|jpe?g|gif|svg|woff2?|ico)$")'
  batch:
    send_batch_size: 1024
    timeout: 5s

exporters:
  otlp_http/scout:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s

service:
  extensions: [oauth2client, health_check, zpages]
  telemetry:
    metrics:
      level: normal
      readers:
        - pull:
            exporter:
              prometheus:
                host: 0.0.0.0
                port: 8888
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, filter/noise, batch]
      exporters: [otlp_http/scout]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/scout]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/scout]
```

Leave `compression: gzip` enabled, since `db.query.text` carries the full SQL
statement on every `wpdb.query` and `mysqli_query` span and those two span
names dominate the payload.

Write the `filter/noise` conditions against your own probe rather than copying
them. The three above match a Kubernetes probe, a load balancer health check,
and static assets; a probe that requests `/` with curl's user agent matches
none of them.

`filter` also evaluates one span at a time. `url.path`, `url.full`, and
`user_agent.original` are on the root span only, so a condition written against
those keys removes the root and leaves that request's `WP.*`, `wpdb.*`, and
`mysqli_*` spans behind as orphans. Use the collector filter for probe traffic
you can match precisely, and the controls below for everything else.

### Controlling span volume

One request produces two spans per query plus the lifecycle spans, so span
count tracks query count closely. A default site with three posts, one page,
and no plugins produces:

| Request | `wpdb.query` | `mysqli_query` | Total spans |
| --- | --- | --- | --- |
| Home page | 24 | 27 | 63 |
| Single post | 35 | 38 | 86 |
| Search results | 29 | 32 | 73 |
| Category archive | 25 | 28 | 65 |
| Page | 20 | 23 | 55 |
| 404 | 19 | 22 | 53 |
| REST posts collection | 17 | 20 | 45 |
| Login form | 7 | 10 | 22 |

That is a bare site with no plugins, so your numbers will be higher. Four ways
to bring the count down:

**1. Turn off one of the two instrumentations.** Every `wpdb.query` span has
exactly one `mysqli_query` child and both carry `db.query.text`, so the pair
largely duplicates. Disabling `mysqli` roughly halves the database spans:

```bash
OTEL_PHP_DISABLED_INSTRUMENTATIONS=mysqli
```

The value is the instrumentation name, not the scope name it emits under.
Comma-separate to disable both.

You lose the `mysqli_real_connect` span and the `db.namespace`,
`db.operation.name`, `server.address`, and `server.port` attributes, which
`wpdb.query` does not carry. You keep the SQL text and the position of each
query in the request.

**2. Add a persistent object cache.** This is a WordPress change rather than a
telemetry setting. Options, transients, and meta lookups served from cache are
queries WordPress never issues, so they produce no spans.

**3. Filter probe traffic at the collector.** A health check produces whatever
the URL it requests produces. A probe against a URL WordPress renders produces
a full page trace, 63 spans for a home page, which at a 10 second interval is 6
extra traces a minute per instance. Point the probe at a URL that returns a
redirect or a static file, and drop what remains in `filter/noise`.

**4. Tune batching at the collector.** PHP ends the SDK at the end of each
request and the shutdown hook flushes whatever is queued, so the SDK never
carries spans from one request into the next. Batching across requests happens
in the collector. Raise `send_batch_size` to cut the number of outbound
requests, and watch `otelcol_exporter_send_failed_spans` when you do.

## Framework-Specific Features

### Lifecycle spans

The `wordpress` instrumentation names stages of the request lifecycle. Which
ones appear depends on how the request was routed:

| Span name | When it appears |
| --- | --- |
| `WP.main` | Requests routed through the front controller. Absent on direct script hits like `/wp-login.php`. |
| `WP.init` | Every request. Twice on front-controller requests: once under the root span, once under `WP.main`. |
| `WP.parse_request` | Front-controller requests. |
| `WP.query_posts` | Requests that run the main query. |
| `WP.register_globals` | Requests that run the main query. |
| `WP.send_headers` | Requests that run the main query. |
| `WP.handle_404` | Requests that run the main query, whatever status they return. |
| `get_single_template` | Requests that resolve a single-post template. |

Two routes are missing the four main-query spans. REST dispatch short-circuits
before reaching them, and `/wp-login.php` never runs `WP.main` at all, because
the web server invokes that script directly rather than routing it through the
front controller.

`WP.handle_404` does not indicate a 404. It runs on any request that goes
through the main query, including ones that return 200, so use
`http.response.status_code` on the root span to find real 404s.

### Database access

Every request opens its own connection and produces one `wpdb.__construct`, one
`wpdb.db_connect`, and one `mysqli_real_connect`. Each `wpdb.db_connect` has
one `mysqli_real_connect` child plus three `mysqli_query` children, which are
the queries the driver issues while setting the connection up rather than
anything the page asked for.

Every `wpdb.query` span has exactly one `mysqli_query` child. Both carry
`db.query.text`, so each query is described twice.

`wpdb.query` appears under four different parents, so its parent tells you
where in the request a query was issued:

- Directly under the root span, for queries WordPress issues before routing
  completes.
- Under `WP.query_posts`, for the main query.
- Under `WP.parse_request`, for routing lookups.
- Under `get_single_template`, for queries the template resolution triggers.

## Custom Instrumentation

Auto-instrumentation covers WordPress core and the `mysqli` driver, so work
done by your own theme or plugin needs spans of its own. The prepended
autoloader configures the SDK before WordPress boots, so `Globals` returns the
configured providers by the time theme or plugin code runs and no further
setup is needed.

Wrap a function in a span:

```php
$tracer = \OpenTelemetry\API\Globals::tracerProvider()->getTracer('wordpress-custom');
$span = $tracer->spanBuilder('render_featured_posts')->startSpan();
$scope = $span->activate();
try {
    // theme work
} finally {
    $scope->detach();
    $span->end();
}
```

Activating the span makes it the parent of anything the auto-instrumentation
creates inside the `try` block, so queries issued there nest under it and their
time is attributed to your code. Detach and end in a `finally` block so an
exception cannot leave the span open.

A counter follows the same shape through the meter provider:

```php
$meter = \OpenTelemetry\API\Globals::meterProvider()->getMeter('wordpress-custom');
$counter = $meter->createCounter(
    'featured_posts.rendered',
    'posts',
    'Featured posts rendered'
);
$counter->add(count($featured), ['theme' => 'my-theme']);
```

Use dotted OpenTelemetry-style instrument names rather than Prometheus-style
underscored ones, so the metric reads the same way as the rest of the
telemetry.

## Running Your Application

### Development with Docker Compose

Clone the example, copy the environment file, and bring the stack up. The
`SCOUT_*` placeholders in `.env.example` let the collector start without real
credentials.

```bash
git clone https://github.com/base-14/examples.git
cd examples/php/wordpress-mariadb
cp .env.example .env
set -a && source .env && set +a
docker compose up -d --build
```

A seed container creates three posts in an `observability` category, an
`about` page, and one approved comment, then exits. Wait for it:

```bash
docker compose logs -f wp-init
```

Once it prints `Seed complete`, the site is on port 8080, or whatever
`WP_APACHE_PORT` is set to.

### The PHP-FPM profile

The FPM containers sit behind a Compose profile and use their own database and
volume, so both shapes can run at once without mixing content.

```bash
docker compose --profile fpm up -d --build
docker compose logs -f wp-init-fpm
SITE_URL=http://localhost:${WP_FPM_PORT:-8081} ./scripts/test-api.sh
```

Set `SITE_URL` explicitly for the FPM profile. It defaults to the Apache stack,
so leaving it out re-tests Apache instead.

### Generating traffic

`scripts/test-api.sh` requests eight fixed paths and checks each status code:

```bash
./scripts/test-api.sh
```

Expected output:

```plaintext
=== WordPress OpenTelemetry path set ===
Target: http://localhost:8080

[PASS] home (200)
[PASS] single post (200)
[PASS] page (200)
[PASS] archive (200)
[PASS] search (200)
[PASS] rest posts (200)
[PASS] login page (200)
[PASS] not found (404)

Passed: 8  Failed: 0
```

### Confirming spans arrive

Watch the collector while you drive a request from another shell. With the
`debug` exporter enabled you get a `Span #` block per span:

```bash
docker compose logs -f otel-collector | grep 'Span #'
```

Outside Docker, read the collector's own log the same way, for instance
`journalctl -fu otelcol-contrib | grep 'Span #'`. If your collector runs the
`prometheus` extension, `curl -s localhost:8888/metrics | grep
otelcol_receiver_accepted_spans` gives you a counter that should rise as you
request pages, which works whether or not the `debug` exporter is on.

If nothing appears, work through
[Troubleshooting](#troubleshooting) below, starting with the extension and
prepend check for the serving SAPI.

In Scout, filter on `service.name=wordpress-mariadb-otel` and
`environment=development`, then open a trace for a single post. You should see
`wpdb.query` and `mysqli_query` children under `GET /index.php`.

### Expected span hierarchy

A request to a single post produces this tree. Each line appears once per
distinct parent-child relationship, not once per span:

```text
GET /index.php                     SERVER
├── wpdb.__construct               INTERNAL
│   └── wpdb.db_connect            CLIENT
│       ├── mysqli_real_connect    CLIENT
│       └── mysqli_query           CLIENT
├── wpdb.query                     CLIENT
│   └── mysqli_query               CLIENT
├── WP.init                        SERVER
├── WP.main                        SERVER
│   ├── WP.init                    SERVER
│   ├── WP.parse_request           SERVER
│   │   └── wpdb.query             CLIENT
│   ├── WP.query_posts             SERVER
│   │   └── wpdb.query             CLIENT
│   ├── WP.handle_404              SERVER
│   ├── WP.register_globals        SERVER
│   └── WP.send_headers            SERVER
└── get_single_template            SERVER
    └── wpdb.query                 CLIENT
```

Each `wpdb.query` in that tree has one `mysqli_query` child, shown once above.
On a default site the whole trace runs to 86 spans.

## Troubleshooting

### FPM workers cannot see the OTEL\_\* variables {#fpm-workers-cannot-see-otel-variables}

**Symptom.** WordPress returns HTTP 500 with "Error establishing a database
connection", and no spans arrive.

**Why.** `clear_env` clears the whole worker environment, not just the `OTEL_*`
variables. On the official `wordpress:*-fpm` image the database credentials
come from `WORDPRESS_DB_*`, so they are stripped too and the database error
surfaces before the missing telemetry does.

**Check before you change anything.** The official image already ships an
active `clear_env = no`, so on that image there is usually nothing to fix:

```bash
docker compose exec wordpress-fpm cat /usr/local/etc/php-fpm.d/docker.conf
```

**Check through a worker, not the CLI.** `docker compose exec ... php -r` runs
the CLI SAPI, which `clear_env` does not govern, so that check passes while the
workers are broken. Request a script over HTTP instead, then remove it:

```bash
docker compose exec wordpress-fpm sh -c \
  'echo "<?php echo getenv(\"OTEL_PHP_AUTOLOAD_ENABLED\") ?: \"EMPTY\";" > /var/www/html/otel-env-check.php'
curl -s http://localhost:8081/otel-env-check.php
docker compose exec wordpress-fpm rm /var/www/html/otel-env-check.php
```

`true` means the workers see the variable. `EMPTY` means they do not.

**Fix.** Set `clear_env = no` in the pool config, as
[Deployment Shapes](#deployment-shapes) shows. A distro package or a
hand-rolled pool has no `docker.conf` to inherit the setting from, so the pool
file has to carry it.

### The extension is loaded but no spans appear

**Symptom.** `php -m` lists `opentelemetry` and the collector receives nothing.

**Check.** Read the prepend directive and the autoload flag for the SAPI that
serves traffic, not only for the CLI:

```bash
php -i | grep auto_prepend_file
php -i | grep OTEL_PHP_AUTOLOAD_ENABLED
```

**Fix.** An empty `auto_prepend_file` means the ini drop-in landed in the wrong
`conf.d` directory. Debian and Ubuntu keep one per SAPI, so a file written to
`/etc/php/8.4/cli/conf.d/` never reaches Apache or FPM. Write it to the FPM or
Apache directory and restart that service. If the prepend is set but
`OTEL_PHP_AUTOLOAD_ENABLED` is not `true`, the packages load and the SDK never
registers.

### Instrumentation disappears after a WordPress core update

**Symptom.** Spans stop arriving after a core update, with no configuration
change of your own.

**Check.** Look at where the prepend points:

```bash
php -i | grep auto_prepend_file
ls -l /opt/otel/vendor/autoload.php
```

**Fix.** The vendor directory was inside the docroot. A core update and the
official image's entrypoint both rewrite `/var/www/html`, which takes the
autoloader with it. Install the Composer packages into a directory outside the
docroot, `/opt/otel` in this guide, and point the ini drop-in there.

### composer install fails on the ext-opentelemetry platform requirement

**Symptom.** `composer install` stops with
`requires ext-opentelemetry * -> it is missing from your system`.

**Check.** `php -m | grep opentelemetry` on the machine or build stage running
Composer, which is often not the machine that will run PHP.

**Fix.** Skip the platform requirement where Composer runs and satisfy it at
runtime. That is what the build stage does:

```dockerfile title="Dockerfile" showLineNumbers
RUN composer install \
      --no-dev \
      --prefer-dist \
      --optimize-autoloader \
      --ignore-platform-req=ext-opentelemetry \
      --ignore-platform-req=ext-mysqli
```

### No database spans

**Symptom.** `WP.*` spans arrive, but no `mysqli_query` or
`mysqli_real_connect`.

**Check.** Confirm the package is installed and not disabled:

```bash
composer show | grep opentelemetry
php -i | grep OTEL_PHP_DISABLED_INSTRUMENTATIONS
```

**Fix.** Install `open-telemetry/opentelemetry-auto-mysqli`. WordPress core
reaches the database through `mysqli`, so a PDO instrumentation package is not
a substitute. If the package is present, check that
`OTEL_PHP_DISABLED_INSTRUMENTATIONS` does not list `mysqli`.

### Backing it out

Set `OTEL_PHP_AUTOLOAD_ENABLED=false` and restart the SAPI. The packages still
load but the SDK does not start, and nothing is exported. To remove it
completely, delete the `99-otel.ini` drop-in, restart, and delete `/opt/otel`.
Neither step touches WordPress, since nothing was installed into the docroot.

## Security Considerations

### SQL statements travel with the span

`db.query.text` carries the statement on both `wpdb.query` and its
`mysqli_query` child, so every query is described twice. Statements carry
literal values inline, as in `t.slug IN ('observability')` and
`WHERE ID IN (4,5,6)`, so whatever a query matches on is in the span text.

Drop or hash the attribute at the collector if that text should not leave your
network:

```yaml
processors:
  attributes/scrub-sql:
    actions:
      - key: db.query.text
        action: delete
```

`db.query.text` is the bulk of the payload, so dropping it also removes most of
what `compression: gzip` was compressing.

### What the request spans carry

Root spans carry no request headers other than `user_agent.original`, no
cookies, and no logged-in user identifier. The attribute list in
[What Gets Instrumented](#what-gets-instrumented) is everything they carry.

`url.full` carries the requested URL with its query string, so search terms end
up in the span. If your URLs carry tokens, email addresses, or anything else
you would not put in a log line, strip or rewrite the attribute at the
collector before export.

### Admin traffic

`wp.is_admin` on the root span marks requests inside `wp-admin/`. Admin URLs
carry more sensitive parameters than front-end ones, so decide whether you want
them exported at all, and filter on that attribute if not.

### Transport

Do not carry `tls.insecure_skip_verify` from a local config into production.
It disables certificate verification on the export path.

## Performance Considerations

Cost scales with the number of spans, which scales with the number of queries a
request makes. On a small default site:

- **Latency**: roughly doubles the median request, in the range 1.7x to 2.3x.
- **Memory**: roughly 8 to 12 MiB added to the WordPress container at six
  prefork workers.
- **Spans**: 22 to 86 per request, depending on the path.

The absolute cost is small here because the base is small on a bare site. A
plugin-heavy site has a different base and a different span count, so measure
your own before sizing anything.

Measure memory on the container total. The extension's text pages and the
OPcache segment holding the compiled SDK classes are shared across workers, and
per-worker RSS counts them once per process, so it overstates the real cost
several times over.

### Reducing the cost

The four controls in [Controlling span volume](#controlling-span-volume) apply
here in the same order: disable one of the two instrumentations, add a
persistent object cache, keep probes off rendered URLs, and tune collector
batching. None of them reduce visibility of real traffic.

Two more things:

- **The first front-end request of a site's life costs about 34 extra spans.**
  The theme creates a navigation post, inserts options and a transient, and
  misses on lookups that hit on every later request. It is paid once per site,
  not once per container start.
- **Export runs at request shutdown.** PHP has no background worker to defer
  to, so the SDK's export to the local collector is inside the request. Keep
  the collector local to the host or the pod; the collector's onward ship to
  Scout is asynchronous and is not in the request path.

## Frequently Asked Questions

### Does this work on WordPress.com or managed hosting?

Only if the host lets you install a PECL extension and add a file to PHP's
`conf.d` directory. The PECL `opentelemetry` extension provides the hook
mechanism the instrumentation packages attach to, and `auto_prepend_file` loads
them before WordPress boots. Managed hosting with a fixed PHP extension set
allows neither. A VM, a container image you build, or a bare metal LAMP server
all work.

### Do I need to modify my theme or install a plugin?

No. Nothing is installed into WordPress and no application code changes. The
Composer packages live in a directory outside the docroot, and a `php.ini`
drop-in points `auto_prepend_file` at their autoloader so the SDK is running
before WordPress starts. Themes, plugins, and core files are untouched.

### Why do I get no database spans?

The `open-telemetry/opentelemetry-auto-mysqli` package is missing, or `mysqli`
is listed in `OTEL_PHP_DISABLED_INSTRUMENTATIONS`. WordPress core reaches the
database through `mysqli`, and that package produces the `mysqli_query` and
`mysqli_real_connect` spans. A PDO instrumentation package does not cover it.
Seeing `wpdb.*` spans without `mysqli_*` spans points to one of those two
causes.

### Does it work with PHP-FPM?

Yes. Apache with mod_php and PHP-FPM behind nginx produce the same spans. The
one thing to check on FPM is that the pool does not clear the worker
environment, because the SDK is configured entirely through `OTEL_*` variables.
The official `wordpress:*-fpm` image already ships `clear_env = no`, so on that
image there is normally nothing to change.

### How many spans does one page load produce?

On a default site with three posts and no plugins, between 22 and 86 spans per
request depending on the path: 22 for the login form, 86 for a single post.
Span count tracks query count, because each query produces a `wpdb.query` span
and a `mysqli_query` child. The first front-end request against a brand new
site costs about 34 spans more than the steady state, because the theme writes
options and posts the database does not have yet; that is paid once per site.
These numbers come from a site with no plugins, so yours will be higher.

### What happens on a WordPress core update?

Nothing, if the Composer packages are outside the docroot. A core update
rewrites `/var/www/html`, and so does the official image's entrypoint, so
anything installed there gets overwritten. Install to `/opt/otel` and point
`auto_prepend_file` there instead; no WordPress update touches it. The
`php.ini` drop-in is safe either way.

### Can I tell which plugin is slow?

Not from auto-instrumentation alone. No span name or instrumentation scope
identifies a plugin, so plugin work is not separated from core work. Every
query a request issued is still recorded with its SQL text on the `wpdb.query`
and `mysqli_query` spans, which is often enough to recognise the source. To
attribute time directly, wrap the plugin's hooks in manual spans as
[Custom Instrumentation](#custom-instrumentation) shows.

### How much overhead does OpenTelemetry add to WordPress?

On a small default site, instrumentation roughly doubles the median request, in
the range 1.7x to 2.3x, and adds roughly 8 to 12 MiB to the WordPress container
at six prefork workers. The ratio is more useful than a millisecond figure,
since the base is small on a bare site and the absolute cost moves with host
load. That is a bare site with no plugins, so your numbers will be higher.

### Which WordPress versions are supported?

WordPress 6.0 and later, on PHP 8.2 or later. The floor is set by PHP: the
mysqli package requires PHP 8.2, and 6.0 is the earliest WordPress release
compatible with it. Nothing checks the WordPress version at install time, so an
upgrade that breaks the instrumentation shows up as missing spans rather than a
failed install. Check that spans still arrive after a major upgrade.

## What's Next

- [Custom PHP Instrumentation](../custom-instrumentation/php.md) for manual
  spans, metrics, and context propagation beyond the two examples above.
- [MariaDB monitoring](../../component/mariadb.md) to pair the query spans with
  database-side metrics.
- [Docker Compose collector setup](../../collector-setup/docker-compose-example.md)
  for a collector to export to while you are testing.
- [Creating alerts](../../../guides/creating-alerts-with-logx.md) once traces
  are arriving, for error rates and latency thresholds.

## Complete Example

The runnable stack is at
[base-14/examples/php/wordpress-mariadb](https://github.com/base-14/examples/tree/main/php/wordpress-mariadb).
It brings up WordPress, MariaDB, and a collector, seeds the site, and drives a
fixed path set you can generate traces from.

```text
php/wordpress-mariadb/
├── .env.example                    # Scout credentials and the port overrides
├── README.md                       # setup and both deployment profiles
├── compose.yaml                    # Apache by default, FPM behind a profile
├── composer.json                   # SDK, OTLP exporter, both instrumentations
├── composer.lock
├── Dockerfile                      # Apache + mod_php, with the PECL extension
├── Dockerfile.fpm                  # PHP-FPM, same extension and vendor dir
├── config/
│   ├── otel.ini                    # extension= and auto_prepend_file=
│   ├── otel-config.yaml            # collector pipelines
│   ├── apache-wordpress.conf       # AllowOverride for permalink rewrites
│   ├── php-fpm.conf                # pool config, clear_env and ping.path
│   ├── nginx.conf                  # FastCGI pass to the FPM pool
│   └── init-db.sql                 # second database for the FPM profile
└── scripts/
    ├── init-wordpress.sh           # seeds posts, a page, a category, a comment
    ├── test-api.sh                 # the eight-path set
    └── verify-scout.sh             # checks spans are reaching Scout
```

[Running Your Application](#running-your-application) above has the commands for
both profiles.

Once spans are arriving, you can
[trace WordPress requests end to end in Scout](https://base14.io/scout/apm)
alongside the rest of your services.

## References

- [OpenTelemetry PHP documentation](https://opentelemetry.io/docs/languages/php/).
- [opentelemetry-auto-wordpress on Packagist](https://packagist.org/packages/open-telemetry/opentelemetry-auto-wordpress).
- [opentelemetry-auto-mysqli on Packagist](https://packagist.org/packages/open-telemetry/opentelemetry-auto-mysqli).
- [PECL opentelemetry extension](https://pecl.php.net/package/opentelemetry).
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/).
- [OpenTelemetry environment variable specification](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/).
- [PHP-FPM configuration directives](https://www.php.net/manual/en/install.fpm.configuration.php).
- [WordPress database class reference](https://developer.wordpress.org/reference/classes/wpdb/).

## Related Guides

- [PHP custom instrumentation](../custom-instrumentation/php.md) - manual
  spans, metrics, and propagation in PHP.
- [Laravel](./laravel.md) - if you also run Laravel applications and want them
  reporting under the same conventions.
- [Symfony](./symfony.md) - the same for Symfony.
- [Slim](./slim.md) - for smaller PHP services alongside the WordPress site.
