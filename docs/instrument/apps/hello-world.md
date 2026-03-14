---
title: Hello World - Send Your First Trace
sidebar_label: Hello World
sidebar_position: 1
toc_max_heading_level: 2
description:
  Send your first trace, log, and metric to Scout with a minimal CLI app.
  Working examples in Node.js, Python, Go, Java, C#, Rust, PHP, Ruby, and
  Elixir.
keywords:
  [
    hello world opentelemetry,
    first trace,
    opentelemetry getting started,
    send traces to scout,
    opentelemetry hello world,
    otel quickstart,
    opentelemetry example,
    opentelemetry tutorial,
    otel getting started,
    send traces opentelemetry,
  ]
---

# Hello World - Send Your First Trace

## What You Will Build

A command-line app that creates three OpenTelemetry spans - a successful
greeting, a disk-space warning, and a config-parsing error - and sends traces,
logs, and metrics to your Scout collector. After running it you will see all
three signal types correlated in TraceX and LogX. This guide covers all 9
officially supported languages.

## Prerequisites

- A Scout account with a collector running
  ([5-Minute Quick Start](/guides/quick-start) if you haven't set one up yet)
- The language runtime for the tab you pick installed on your machine
- Your collector endpoint (default `http://localhost:4318`)

## Choose Your Language

import Tabs from '@theme/Tabs'; import TabItem from '@theme/TabItem';

<Tabs groupId="language">
<TabItem value="nodejs" label="Node.js" default>

### Install Dependencies

```json title="package.json" showLineNumbers
{
  "name": "hello-world-nodejs",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.213.0",
    "@opentelemetry/exporter-logs-otlp-http": "^0.213.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.213.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.213.0",
    "@opentelemetry/resources": "^2.6.0",
    "@opentelemetry/sdk-logs": "^0.213.0",
    "@opentelemetry/sdk-metrics": "^2.6.0",
    "@opentelemetry/sdk-trace-base": "^2.6.0",
    "@opentelemetry/sdk-trace-node": "^2.6.0"
  }
}
```

```bash
npm install
```

### The Code

```js title="main.js" showLineNumbers
function sayHello(tracer, otelLogger, helloCounter) {
  tracer.startActiveSpan("say-hello", (span) => {
    otelLogger.emit({
      severityText: "INFO",
      severityNumber: SeverityNumber.INFO,
      body: "Hello, World!",
    });
    helloCounter.add(1);
    span.setAttribute("greeting", "Hello, World!");
    span.end();
  });
}
```

The full example also includes `checkDiskSpace` (warning) and `parseConfig`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/nodejs/hello-world/main.js)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node main.js
```

</TabItem>
<TabItem value="python" label="Python">

### Install Dependencies

```txt title="requirements.txt" showLineNumbers
opentelemetry-api==1.40.0
opentelemetry-sdk==1.40.0
opentelemetry-exporter-otlp-proto-http==1.40.0
```

```bash
pip install -r requirements.txt
```

### The Code

```python title="main.py" showLineNumbers
def say_hello():
    with tracer.start_as_current_span("say-hello") as span:
        logger.info("Hello, World!")
        hello_counter.add(1)
        span.set_attribute("greeting", "Hello, World!")
```

The full example also includes `check_disk_space` (warning) and `parse_config`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/python/hello-world/main.py)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 python main.py
```

</TabItem>
<TabItem value="go" label="Go">

### Install Dependencies

```go title="go.mod" showLineNumbers
module hello-world-go

go 1.25.0

require (
    go.opentelemetry.io/otel v1.42.0
    go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.18.0
    go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.42.0
    go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.42.0
    go.opentelemetry.io/otel/log v0.18.0
    go.opentelemetry.io/otel/metric v1.42.0
    go.opentelemetry.io/otel/sdk v1.42.0
    go.opentelemetry.io/otel/sdk/log v0.18.0
    go.opentelemetry.io/otel/sdk/metric v1.42.0
    go.opentelemetry.io/otel/trace v1.42.0
)
```

```bash
go mod tidy
```

### The Code

```go title="main.go" showLineNumbers
func sayHello(ctx context.Context, tracer trace.Tracer, logger log.Logger, counter metric.Int64Counter) {
    ctx, span := tracer.Start(ctx, "say-hello")
    defer span.End()

    var rec log.Record
    rec.SetSeverityText("INFO")
    rec.SetSeverity(log.SeverityInfo)
    rec.SetBody(log.StringValue("Hello, World!"))
    logger.Emit(ctx, rec)

    counter.Add(ctx, 1)
    span.SetAttributes(attribute.String("greeting", "Hello, World!"))
}
```

The full example also includes `checkDiskSpace` (warning) and `parseConfig`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/go/hello-world/main.go)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 go run .
```

</TabItem>
<TabItem value="java" label="Java">

### Install Dependencies

```xml title="pom.xml (dependencies)" showLineNumbers
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>io.opentelemetry</groupId>
            <artifactId>opentelemetry-bom</artifactId>
            <version>1.60.1</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>io.opentelemetry</groupId>
        <artifactId>opentelemetry-api</artifactId>
    </dependency>
    <dependency>
        <groupId>io.opentelemetry</groupId>
        <artifactId>opentelemetry-sdk</artifactId>
    </dependency>
    <dependency>
        <groupId>io.opentelemetry</groupId>
        <artifactId>opentelemetry-exporter-otlp</artifactId>
    </dependency>
</dependencies>
```

```bash
mvn compile
```

### The Code

```java title="Main.java" showLineNumbers
static void sayHello(Tracer tracer, Logger logger, LongCounter counter) {
    Span span = tracer.spanBuilder("say-hello").startSpan();
    try (var scope = span.makeCurrent()) {
        logger.logRecordBuilder()
                .setSeverity(Severity.INFO)
                .setSeverityText("INFO")
                .setBody("Hello, World!")
                .emit();
        counter.add(1);
        span.setAttribute("greeting", "Hello, World!");
    } finally {
        span.end();
    }
}
```

The full example also includes `checkDiskSpace` (warning) and `parseConfig`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/java/hello-world/src/main/java/Main.java)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 mvn compile exec:java
```

</TabItem>
<TabItem value="csharp" label="C#">

### Install Dependencies

```xml title="HelloWorldCsharp.csproj" showLineNumbers
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="OpenTelemetry" Version="1.15.0" />
    <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.15.0" />
    <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.15.0" />
  </ItemGroup>
</Project>
```

```bash
dotnet restore
```

### The Code

```csharp title="Program.cs" showLineNumbers
void SayHello()
{
    using var activity = activitySource.StartActivity("say-hello");
    activity?.SetTag("greeting", "Hello, World!");
    logger.LogInformation("Hello, World!");
    helloCounter.Add(1);
}
```

The full example also includes `CheckDiskSpace` (warning) and `ParseConfig`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/csharp/hello-world/Program.cs)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 dotnet run
```

</TabItem>
<TabItem value="rust" label="Rust">

### Install Dependencies

```toml title="Cargo.toml" showLineNumbers
[package]
name = "hello-world-rust"
version = "0.1.0"
edition = "2021"

[dependencies]
opentelemetry = "0.31.0"
opentelemetry_sdk = { version = "0.31.0", features = ["rt-tokio", "logs", "metrics"] }
opentelemetry-otlp = { version = "0.31.0", features = ["http-proto", "trace", "logs", "metrics"] }
opentelemetry-appender-tracing = "0.31.0"
tokio = { version = "1", features = ["full"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

```bash
cargo build
```

### The Code

```rust title="src/main.rs" showLineNumbers
fn say_hello(counter: &opentelemetry::metrics::Counter<u64>) {
    let tracer = global::tracer("hello-world-rust");
    tracer.in_span("say-hello", |cx| {
        let span = cx.span();
        span.set_attribute(KeyValue::new("greeting", "Hello, World!"));
        tracing::info!("Hello, World!");
        counter.add(1, &[]);
    });
}
```

The full example also includes `check_disk_space` (warning) and `parse_config`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/rust/hello-world/src/main.rs)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 cargo run
```

</TabItem>
<TabItem value="php" label="PHP">

### Install Dependencies

```json title="composer.json" showLineNumbers
{
  "require": {
    "php": ">=8.1",
    "open-telemetry/api": "^1.8",
    "open-telemetry/sdk": "^1.13",
    "open-telemetry/exporter-otlp": "^1.4",
    "php-http/guzzle7-adapter": "^1.1"
  }
}
```

```bash
composer install
```

### The Code

```php title="main.php" showLineNumbers
function sayHello(TracerInterface $tracer, $logger, $counter): void {
    $span = $tracer->spanBuilder('say-hello')->startSpan();
    $scope = $span->activate();
    try {
        $logger->emit(
            (new \OpenTelemetry\API\Logs\LogRecord())
                ->setSeverityNumber(Severity::INFO)
                ->setSeverityText('INFO')
                ->setBody('Hello, World!')
        );
        $counter->add(1);
        $span->setAttribute('greeting', 'Hello, World!');
    } finally {
        $scope->detach();
        $span->end();
    }
}
```

The full example also includes `checkDiskSpace` (warning) and `parseConfig`
(error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/php/hello-world/main.php)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 php main.php
```

</TabItem>
<TabItem value="ruby" label="Ruby">

:::note Traces only

The Ruby OpenTelemetry logs SDK is not yet stable. This example sends traces
only and uses span events as log equivalents.

:::

### Install Dependencies

```ruby title="Gemfile" showLineNumbers
source "https://rubygems.org"

gem "opentelemetry-api", "~> 1.8.0"
gem "opentelemetry-sdk", "~> 1.10.0"
gem "opentelemetry-exporter-otlp", "~> 0.32.0"
```

```bash
bundle install
```

### The Code

```ruby title="main.rb" showLineNumbers
def say_hello(tracer)
  tracer.in_span("say-hello") do |span|
    span.set_attribute("greeting", "Hello, World!")
    span.add_event("greeting.sent", attributes: { "message" => "Hello, World!" })
  end
end
```

The full example also includes `check_disk_space` (warning event) and
`parse_config` (error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/ruby/hello-world/main.rb)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 ruby main.rb
```

</TabItem>
<TabItem value="elixir" label="Elixir">

:::note Traces only

The Elixir OpenTelemetry logs SDK is not yet stable. This example sends traces
only and uses span events as log equivalents.

:::

### Install Dependencies

```elixir title="mix.exs (deps)" showLineNumbers
defp deps do
  [
    {:opentelemetry_api, "~> 1.5"},
    {:opentelemetry, "~> 1.7"},
    {:opentelemetry_exporter, "~> 1.10"}
  ]
end
```

```bash
mix deps.get
```

### The Code

```elixir title="lib/hello_world.ex" showLineNumbers
def say_hello do
  Tracer.with_span "say-hello" do
    Tracer.set_attribute(:greeting, "Hello, World!")
    Tracer.add_event("greeting.sent", %{message: "Hello, World!"})
  end
end
```

The full example also includes `check_disk_space` (warning event) and
`parse_config` (error with exception).
[View full source on GitHub →](https://github.com/base-14/examples/blob/main/elixir/hello-world/lib/hello_world.ex)

### Run It

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 mix run run.exs
```

</TabItem>
</Tabs>

## Verify in Scout

1. Open **TraceX** and search for the service name (e.g. `hello-world-nodejs`).
2. Click the trace to see three spans: `say-hello`, `check-disk-space`, and
   `parse-config`.
3. Open **LogX** - logs from `say-hello` and the other spans carry the same
   trace ID, so you can jump between the trace and its logs.
4. Check **Metrics** for the `hello.count` counter.

## What Each Span Demonstrates

| Span               | Signals                | What it shows                                        |
| ------------------ | ---------------------- | ---------------------------------------------------- |
| `say-hello`        | trace + log + metric   | Normal operation with an INFO log and counter        |
| `check-disk-space` | trace + log (or event) | Degraded state with a WARN log                       |
| `parse-config`     | trace + log (or event) | Error path with exception recording and ERROR status |

## What's Next

- [Auto-instrumentation guides](/instrument/apps/auto-instrumentation) - add
  tracing to your real app with zero code changes
- [Custom instrumentation](/instrument/apps/custom-instrumentation) - add manual
  spans, metrics, and logs where auto-instrumentation doesn't reach
- [Create Your First Dashboard](/guides/create-your-first-dashboard) - visualize
  the metrics you're collecting
- [5-Minute Quick Start](/guides/quick-start) - set up the collector if you
  haven't already
