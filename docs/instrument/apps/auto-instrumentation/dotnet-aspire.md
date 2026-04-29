---
title: .NET Aspire OpenTelemetry Instrumentation - Multi-Service Tracing
sidebar_label: .NET Aspire
sidebar_position: 31.5
description:
  Instrument .NET Aspire 13 with OpenTelemetry. Wire ServiceDefaults across
  microservices and export traces, metrics, and logs to base14 Scout.
keywords:
  [
    dotnet aspire opentelemetry,
    aspire instrumentation,
    aspire scout integration,
    aspire azure monitor migration,
    aspire distributed tracing,
    aspire servicedefaults opentelemetry,
    dotnet aspire monitoring,
    aspire apphost otel,
    aspire postgresql instrumentation,
    aspire entity framework tracing,
    aspire compose mode,
    dotnet aspire telemetry,
    aspire vendor neutral observability,
    aspire otlp exporter,
    aspire dashboard otel,
    aspire production monitoring,
    aspnet core aspire opentelemetry,
    dotnet 9 aspire instrumentation,
    aspire activitysource meter,
    aspire dcp orchestration tracing,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why does .NET Aspire need a custom OTLP destination instead of the dashboard?","acceptedAnswer":{"@type":"Answer","text":"The Aspire dashboard ships with a built-in OTLP receiver intended for local development. To export to base14 Scout, override OTEL_EXPORTER_OTLP_ENDPOINT on each project resource to point at a local OTel Collector container. The Collector then forwards to Scout via otlphttp with OAuth2 authentication. The dashboard still surfaces resource state, console output, and lifecycle events; only the Traces and Metrics tabs of the dashboard go empty."}},{"@type":"Question","name":"Which .NET and Aspire versions are supported?","acceptedAnswer":{"@type":"Answer","text":".NET 8.0 minimum, .NET 9.0 recommended for the latest minimal-API and AOT support. Aspire 9.5+ uses the package-only AppHost SDK (no dotnet workload install required); 13.x is the current generation and is what this guide pins. Aspire is .NET 8+ only; .NET Framework 4.8 is not supported."}},{"@type":"Question","name":"Why does WithEndpoint produce a tcp:// URL that breaks the .NET OTLP exporter?","acceptedAnswer":{"@type":"Answer","text":"Aspire serializes EndpointReference values according to the endpoint kind. WithEndpoint(...) produces a tcp:// URL for raw TCP endpoints. The .NET OTLP exporter requires http:// or https://. Use WithHttpEndpoint(...) for any endpoint a .NET project will reach via OTLP, including OTLP/gRPC, since gRPC runs over HTTP/2."}},{"@type":"Question","name":"How do I pin a stable port for an Aspire project resource?","acceptedAnswer":{"@type":"Answer","text":"Call WithHttpEndpoint(port: 8080, env: ASPNETCORE_HTTP_PORTS) on the project resource. The port argument requests a fixed host port; the env argument tells Aspire to also inject ASPNETCORE_HTTP_PORTS so Kestrel binds to the same port inside the .NET runtime. DCP proxies the published port to the actual runtime, so even if Kestrel chooses an ephemeral port, the URL the user sees is stable."}},{"@type":"Question","name":"Does .NET Aspire register custom ActivitySources and Meters automatically?","acceptedAnswer":{"@type":"Answer","text":"No. Custom ActivitySources require .AddSource(name) on the TracerProviderBuilder and custom Meters require .AddMeter(name) on the MeterProviderBuilder. Without these calls the SDK never wires the source to the OTLP exporter and your spans and counters never leave the process. Make these calls in ServiceDefaults so every project gets them."}},{"@type":"Question","name":"How do I migrate from Application Insights to OpenTelemetry plus Scout?","acceptedAnswer":{"@type":"Answer","text":"Aspire applications already emit OTel-shaped data via OpenTelemetry.Instrumentation.AspNetCore and friends. Migration is a configuration change: remove the Azure.Monitor.OpenTelemetry.AspNetCore distro package, add OpenTelemetry.Exporter.OpenTelemetryProtocol, point OTEL_EXPORTER_OTLP_ENDPOINT at a Scout-forwarding Collector. Keep both exporters running in parallel for a dual-export period if you need to validate Scout dashboards before cutover."}},{"@type":"Question","name":"Can I run an Aspire example without Aspire AppHost?","acceptedAnswer":{"@type":"Answer","text":"Yes. The example ships a parallel compose.yml stack that runs the same .NET projects as Docker containers without Aspire AppHost. Both modes use the same application code; only env-var sources differ. Pick Aspire mode for local development with the dashboard. Pick Compose mode for CI, headless servers, and customer environments where Aspire is not appropriate."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"How to instrument .NET Aspire with OpenTelemetry","step":[{"@type":"HowToStep","name":"Add the Aspire AppHost SDK and project references","text":"Reference Aspire.Hosting.AppHost and Aspire.Hosting.PostgreSQL on AppHost.csproj with <Sdk Name=\"Aspire.AppHost.Sdk\" Version=\"13.2.4\"/> and <IsAspireHost>true</IsAspireHost>. Reference each child project as <ProjectReference Include=\"...\" IsAspireProjectResource=\"true\"/> so the source generator produces typed Projects.* names."},{"@type":"HowToStep","name":"Build a ServiceDefaults project","text":"Create a class library that exposes AddServiceDefaults(this IHostApplicationBuilder) and wires resilience, service discovery, OpenTelemetry, and health checks. Register custom ActivitySources via .AddSource(...) and custom Meters via .AddMeter(...) on the tracer and meter providers."},{"@type":"HowToStep","name":"Add a local OTel Collector container in AppHost","text":"Use builder.AddContainer(name, image, tag).WithBindMount(...).WithHttpEndpoint(port: 4317, name: grpc) so the project resources can reach it. Use WithHttpEndpoint, not WithEndpoint, because WithEndpoint produces a tcp:// URL the .NET OTLP exporter cannot parse."},{"@type":"HowToStep","name":"Override OTEL_EXPORTER_OTLP_ENDPOINT on each project","text":"Chain .WithEnvironment(OTEL_EXPORTER_OTLP_ENDPOINT, collector.GetEndpoint(grpc)) on each project so the application exports to the local collector. Pin known ports with .WithHttpEndpoint(port: 8080, env: ASPNETCORE_HTTP_PORTS)."},{"@type":"HowToStep","name":"Verify spans and metrics in base14 Scout","text":"Send traffic to your Aspire application, then confirm cross-service traces, custom counters, and structured logs appear in Scout. The collector debug exporter logs the same signals locally so you can validate the export shape even without Scout credentials."}]}
---

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

# .NET Aspire

Implement OpenTelemetry instrumentation for .NET Aspire applications to capture
distributed traces, metrics, and structured logs across an orchestrated set of
.NET microservices. This guide shows you how to wire OpenTelemetry through
Aspire's ServiceDefaults convention, point the OTLP exporter at a local OTel
Collector, and forward telemetry to base14 Scout - all without using Azure
Monitor as the destination.

.NET Aspire is Microsoft's first-party orchestration framework for .NET
microservices. It ships with OpenTelemetry support out of the box, opinionated
service-discovery and resilience defaults, and a local dashboard for resource
state and lifecycle inspection. Aspire's value to a Scout customer is that it
standardizes the observability shape across every service in your distributed
application: a single `AddServiceDefaults()` call in each project's
`Program.cs` produces consistent OTel traces, metrics, and logs without
per-service boilerplate.

Whether you are migrating an Aspire app from Application Insights, building
greenfield on Aspire 13, or evaluating Aspire as the orchestration layer
between Scout and your services, this guide covers the production-ready setup:
ServiceDefaults wiring, AppHost resource declaration, the OTLP-endpoint
override knob, and the gotchas around `WithEndpoint` URL serialization,
custom-source registration, and the dashboard's relationship with telemetry
when you target an external destination.

:::tip TL;DR

Reference `Aspire.Hosting.AppHost` 13.2.4 and `Aspire.Hosting.PostgreSQL`
13.2.4 on your AppHost project. Add a `ServiceDefaults` class library that
exposes `AddServiceDefaults(this IHostApplicationBuilder)` and registers
ASP.NET Core, HttpClient, EF Core, and Runtime instrumentation alongside any
custom `ActivitySource`s and `Meter`s. In `AppHost.cs`, declare an OTel
Collector container with `builder.AddContainer(...)` and override
`OTEL_EXPORTER_OTLP_ENDPOINT` on each project to point at the collector's
`grpc` endpoint - declared with `WithHttpEndpoint`, not `WithEndpoint`, so the
exporter receives an `http://` URL it can parse.

:::

> **Note:** This guide is Aspire-specific. For the general ASP.NET Core
> OpenTelemetry setup (including SqlClient and JWT) see the
> [ASP.NET Core guide](./dotnet.md). For the broader Aspire framework
> documentation, see the
> [official .NET Aspire docs](https://learn.microsoft.com/dotnet/aspire/).

## Who This Guide Is For

This documentation is designed for:

- **.NET microservice developers:** building or maintaining Aspire-orchestrated
  services and wanting consistent observability across them.
- **Engineering teams:** migrating from Application Insights to OTel plus Scout
  and looking for a vendor-neutral export path that works in dev, CI, and
  production.
- **DevOps engineers:** running Aspire workloads in CI or headless customer
  environments and needing a Compose-mode fallback that does not require the
  AppHost.
- **Platform teams:** standardizing on the ServiceDefaults pattern across
  multiple Aspire applications and looking for the canonical OpenTelemetry
  registration shape.

## Overview

This guide demonstrates how to:

- Configure .NET Aspire 13 AppHost with PostgreSQL, an OTel Collector
  container, and two .NET project resources.
- Build a `ServiceDefaults` class library that registers OpenTelemetry,
  resilience, service discovery, and health checks for every Aspire-managed
  project.
- Wire a custom `ActivitySource` and `Meter` into the OpenTelemetry tracer and
  meter providers so business spans and counters export to the collector.
- Override Aspire's default OTLP destination so telemetry flows to base14
  Scout via a local OTel Collector instead of the Aspire dashboard's bundled
  OTLP receiver.
- Run the same application code in two modes: Aspire AppHost for local
  development, or a parallel Compose stack for CI and headless customer
  environments.
- Avoid the common 13.x gotchas: `tcp://` URL serialization on `WithEndpoint`,
  ephemeral project ports, missing custom-source registration, and dashboard
  cert trust on macOS.

## Prerequisites

Before starting, ensure you have:

- **.NET 9.0 SDK** installed (Aspire 13 supports .NET 8+; 9 is recommended).
  - Verify with `dotnet --version`.
- **Docker Desktop** with Apple Silicon native daemon and Rosetta enabled for
  the `postgres:18.3` x86 image.
- **base14 Scout account** for OAuth2 export credentials.
  - See [Scout setup guide](https://docs.base14.io/get-started/scout-setup).
- **NuGet** for package management.
- Basic familiarity with OpenTelemetry concepts (traces, spans, metrics,
  resource attributes).

### Compatibility Matrix

| Component | Minimum | Recommended |
| --- | --- | --- |
| .NET SDK | 8.0 | 9.0.308+ |
| ASP.NET Core | 8.0 | 9.0+ |
| .NET Aspire (AppHost + Hosting.*) | 9.5 | 13.2.4+ |
| OpenTelemetry .NET (core) | 1.10 | 1.15.3 |
| OpenTelemetry.Instrumentation.AspNetCore | 1.10 | 1.15.2 |
| OpenTelemetry.Instrumentation.Http | 1.10 | 1.15.1 |
| OpenTelemetry.Instrumentation.EntityFrameworkCore | 1.0-rc | 1.15.1-beta.1 (contrib beta) |
| OpenTelemetry.Instrumentation.Runtime | 1.10 | 1.15.1 |
| Entity Framework Core | 8.0 | 9.0.15 |
| Npgsql.EntityFrameworkCore.PostgreSQL | 8.0 | 9.0.4 |
| OTel Collector contrib | 0.140 | 0.151.0 |

> Aspire requires .NET 8 minimum. .NET Framework 4.8 is **not** supported.
> The OpenTelemetry instrumentation packages do not always release lockstep
> with the core SDK; pin per-package using the recommended versions above.

## Required Packages

### AppHost project

```xml showLineNumbers title="AppHost/AppHost.csproj"
<Project Sdk="Microsoft.NET.Sdk">

  <Sdk Name="Aspire.AppHost.Sdk" Version="13.2.4" />

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <IsAspireHost>true</IsAspireHost>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Aspire.Hosting.AppHost" Version="13.2.4" />
    <PackageReference Include="Aspire.Hosting.PostgreSQL" Version="13.2.4" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\ArticlesApi\ArticlesApi.csproj" IsAspireProjectResource="true" />
    <ProjectReference Include="..\NotifySvc\NotifySvc.csproj" IsAspireProjectResource="true" />
  </ItemGroup>

</Project>
```

The `Aspire.AppHost.Sdk` MSBuild SDK is referenced as a child `<Sdk>` element;
the project root SDK stays `Microsoft.NET.Sdk`. Setting
`<IsAspireHost>true</IsAspireHost>` enables source generation of the
`Projects.*` typed resource names (`Projects.ArticlesApi`,
`Projects.NotifySvc`) used by `builder.AddProject<Projects.X>("name")`.

### ServiceDefaults project

```xml showLineNumbers title="ServiceDefaults/ServiceDefaults.csproj"
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <IsAspireSharedProject>true</IsAspireSharedProject>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" Version="9.0.0" />
    <PackageReference Include="Microsoft.Extensions.ServiceDiscovery" Version="9.0.0" />
    <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.15.3" />
    <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.15.3" />
    <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.15.2" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.15.1" />
    <PackageReference Include="OpenTelemetry.Instrumentation.EntityFrameworkCore" Version="1.15.1-beta.1" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Runtime" Version="1.15.1" />
  </ItemGroup>

</Project>
```

`<IsAspireSharedProject>true</IsAspireSharedProject>` and the
`<FrameworkReference Include="Microsoft.AspNetCore.App"/>` together let
ServiceDefaults call `WebApplication`-typed extension methods.

## Quick Start

Clone the [`csharp/aspire-postgres`](https://github.com/base-14/examples/tree/main/csharp/aspire-postgres)
example and run it in Aspire mode:

```bash
git clone https://github.com/base-14/examples.git
cd examples/csharp/aspire-postgres

cp .env.example .env
# Edit .env with your Scout credentials.

make up      # dotnet run --project AppHost/AppHost.csproj
```

The AppHost prints two log lines on startup:

```text
info: Aspire.Hosting.DistributedApplication[0]
      Now listening on: http://localhost:15888
info: Aspire.Hosting.DistributedApplication[0]
      Login to the dashboard at http://localhost:15888/login?t=<32-char-token>
```

Use the second URL (the login token regenerates each run; Aspire 13 has
dashboard auth on by default). Then in another terminal:

```bash
make test-api      # exercises all 6 endpoints + cross-service trace
make verify-scout  # confirms exports landed in Scout (requires SCOUT_*)
```

## .NET Aspire OpenTelemetry Concepts

### ServiceDefaults: the cross-cutting OTel registration

Aspire's idiomatic shape is to put OTel configuration in a shared
ServiceDefaults class library that every project references. Each project's
`Program.cs` calls `builder.AddServiceDefaults()` and `app.MapDefaultEndpoints()`
to opt into the shared OTel, resilience, and health-check setup.

```csharp showLineNumbers title="ServiceDefaults/Extensions.cs"
public static class ServiceDefaultsExtensions
{
    public const string ArticlesActivitySourceName = "AspirePostgres.Articles";
    public const string ArticlesMeterName = "AspirePostgres.Articles";

    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder
    {
        builder.ConfigureOpenTelemetry();
        builder.AddDefaultHealthChecks();

        builder.Services.AddServiceDiscovery();
        builder.Services.ConfigureHttpClientDefaults(http =>
        {
            http.AddStandardResilienceHandler();
            http.AddServiceDiscovery();
        });

        return builder;
    }

    public static TBuilder ConfigureOpenTelemetry<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder
    {
        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
            logging.ParseStateValues = true;
        });

        // Stamps TraceId/SpanId onto every log record so logs correlate with traces.
        builder.Logging.Configure(options =>
        {
            options.ActivityTrackingOptions =
                ActivityTrackingOptions.TraceId
                | ActivityTrackingOptions.SpanId
                | ActivityTrackingOptions.ParentId;
        });

        builder.Services.AddOpenTelemetry()
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddMeter(ArticlesMeterName))
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation(o => o.RecordException = true)
                .AddHttpClientInstrumentation()
                .AddEntityFrameworkCoreInstrumentation()
                .AddSource(ArticlesActivitySourceName));

        if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
        {
            builder.Services.AddOpenTelemetry().UseOtlpExporter();
        }

        return builder;
    }
}
```

Three patterns are critical here:

1. **`.AddSource("AspirePostgres.Articles")`** registers the custom
   `ActivitySource` on the tracer provider. Without this call, custom spans
   are silently dropped by the SDK.
2. **`.AddMeter("AspirePostgres.Articles")`** registers the custom `Meter` on
   the meter provider. Same rule: without it, your `articles.created` counter
   never reaches the OTLP exporter.
3. **`ActivityTrackingOptions.TraceId | SpanId | ParentId`** on
   `builder.Logging.Configure(...)` stamps every `ILogger` record with the
   active span's trace context. Without it, exported logs reach the OTLP
   destination but with empty `trace_id` / `span_id` fields, breaking
   log-trace correlation in Scout.

### AppHost orchestration

The AppHost's `Program.cs` declares resources and wires them together:

```csharp showLineNumbers title="AppHost/AppHost.cs"
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("pg").WithImageTag("18.3");
var articlesDb = postgres.AddDatabase("articles");

var collector = builder.AddContainer(
        "otel-collector",
        "otel/opentelemetry-collector-contrib",
        "0.151.0")
    .WithBindMount("../config/otel-collector.yaml", "/etc/otel-collector.yaml")
    .WithArgs("--config=/etc/otel-collector.yaml")
    .WithHttpEndpoint(port: 4317, targetPort: 4317, name: "grpc")
    .WithHttpEndpoint(port: 4318, targetPort: 4318, name: "http");

var collectorGrpc = collector.GetEndpoint("grpc");

var notify = builder.AddProject<Projects.NotifySvc>("notify-svc")
    .WithHttpEndpoint(port: 8081, env: "ASPNETCORE_HTTP_PORTS")
    .WithEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", collectorGrpc)
    .WithEnvironment("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    .WithEnvironment("OTEL_SERVICE_NAME", "notify-svc")
    .WaitFor(collector);

builder.AddProject<Projects.ArticlesApi>("articles-api")
    .WithHttpEndpoint(port: 8080, env: "ASPNETCORE_HTTP_PORTS")
    .WithReference(articlesDb)
    .WithEnvironment("Notify__BaseUrl", notify.GetEndpoint("http"))
    .WithEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", collectorGrpc)
    .WithEnvironment("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc")
    .WithEnvironment("OTEL_SERVICE_NAME", "articles-api")
    .WaitFor(postgres)
    .WaitFor(collector);

builder.Build().Run();
```

### The OTLP override knob

Aspire defaults `OTEL_EXPORTER_OTLP_ENDPOINT` on each project resource to its
bundled dashboard OTLP receiver. The AppHost override above replaces that
default with the local OTel Collector container's gRPC endpoint, which then
forwards to base14 Scout via `otlphttp` with OAuth2 authentication. This is
the single config switch that takes Aspire from "telemetry to local dashboard
only" to "telemetry to a vendor-neutral backend." No SDK code changes; just
the env var override.

ServiceDefaults' `ConfigureOpenTelemetry` only attaches the OTLP exporter
when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (see `Extensions.cs`). In Aspire
mode AppHost always sets it, in Compose mode `compose.yml` sets it. If you
unset the env var entirely (e.g., running a project standalone outside Aspire
and Compose), no OTLP exporter is registered and telemetry stays in-process.
That is intentional - it keeps the SDK from spamming connection-refused
warnings to a non-existent collector.

The Aspire dashboard's resource panel, console log panel, and lifecycle
events continue to work normally; only the dashboard's Traces and Metrics
tabs go empty in this configuration. To populate them as well, add a second
`AddOtlpExporter` call inside `ConfigureOpenTelemetry` that targets
`${DOTNET_DASHBOARD_OTLP_ENDPOINT_URL}` (Aspire injects this automatically).
The example keeps the simpler single-exporter shape so the data flow remains
unambiguous.

## Custom Instrumentation

For business-level spans and metrics that auto-instrumentation cannot produce,
add a custom `ActivitySource` and `Meter`:

```csharp showLineNumbers title="ArticlesApi/Telemetry/AppMetrics.cs"
using System.Diagnostics;
using System.Diagnostics.Metrics;

public static class AppMetrics
{
    public const string MeterName = "AspirePostgres.Articles";
    public const string ActivitySourceName = "AspirePostgres.Articles";

    public static readonly Meter Meter = new(MeterName);
    public static readonly ActivitySource ActivitySource = new(ActivitySourceName);

    public static readonly Counter<long> ArticlesCreated =
        Meter.CreateCounter<long>("articles.created", description: "Total articles created");
}
```

Use them inside your endpoint logic:

```csharp showLineNumbers
using var activity = AppMetrics.ActivitySource.StartActivity("article.create");

// ... save article to db ...

AppMetrics.ArticlesCreated.Add(1);
activity?.SetTag("article.id", article.Id);
```

The `using` declaration scopes the activity to the method; the SDK closes it
when the method returns. The `article.id` tag becomes a queryable attribute in
Scout.

For more depth on .NET custom instrumentation patterns (parent-child spans,
async propagation, error recording, baggage), see
[Custom .NET instrumentation](../custom-instrumentation/csharp.md).

## Migrating from Azure-Monitor-anchored Aspire apps

Existing Aspire applications instrumented with the Azure Monitor OpenTelemetry
distro (`Azure.Monitor.OpenTelemetry.AspNetCore`) emit OTel-shaped data
already; Microsoft itself has done the wire-format work. Migrating to
Scout is a configuration change in three steps:

1. **Remove the Azure Monitor distro package** from the project's `.csproj`:

   ```bash
   dotnet remove package Azure.Monitor.OpenTelemetry.AspNetCore
   ```

2. **Add the vendor-neutral OTLP exporter packages** that this guide pins, and
   change the `Program.cs` (or `ServiceDefaults`) registration from
   `builder.Services.AddOpenTelemetry().UseAzureMonitor(...)` to
   `builder.Services.AddOpenTelemetry().UseOtlpExporter()` plus the
   instrumentation calls listed in the ServiceDefaults section above.

3. **Override `OTEL_EXPORTER_OTLP_ENDPOINT`** at the AppHost level to point at
   a Scout-forwarding OTel Collector. No code changes in the projects.

For a dual-export period during validation, keep both exporters live; the
.NET OpenTelemetry SDK supports multiple exporters on the same TracerProvider.
Once Scout dashboards confirm parity with Application Insights, remove the
Azure Monitor package.

A complete step-by-step migration playbook with KQL-to-Scout dashboard query
mappings will land in a follow-up guide; this section is the high-level
shape.

## Production Configuration

### Resource attributes

Add `service.namespace` and `deployment.environment` so Scout dashboards can
filter across environments and service families:

```csharp showLineNumbers title="ServiceDefaults/Extensions.cs"
var environment = builder.Configuration["SCOUT_ENVIRONMENT"]
    ?? builder.Environment.EnvironmentName.ToLowerInvariant();

builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddAttributes(new[]
        {
            new KeyValuePair<string, object>("deployment.environment", environment),
            new KeyValuePair<string, object>("service.namespace", "examples"),
        }))
    .WithMetrics(metrics => metrics
        // ... instrumentation registration ...
    )
    .WithTracing(tracing => tracing
        // ... instrumentation registration ...
    );
```

`service.name` is set automatically from `OTEL_SERVICE_NAME` by the OpenTelemetry
SDK defaults, which Aspire injects per project resource.

### Batch processor tuning

The OTLP exporter batches by default. For high-throughput services, set:

```bash
OTEL_BSP_MAX_QUEUE_SIZE=2048
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=512
OTEL_BSP_SCHEDULE_DELAY=5000
OTEL_BSP_EXPORT_TIMEOUT=30000
```

For metrics, raise the export interval if Scout's metric ingest rate-limits
your traffic:

```bash
OTEL_METRIC_EXPORT_INTERVAL=10000
```

### Sampling

The defaults trace 100% of requests, which is appropriate for development.
Production deployments behind a load balancer should switch to a head-based
sampler:

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

That samples 10% of root traces; child spans inherit the parent decision via
W3C `traceparent`. For more nuanced sampling (per-route, per-error), implement
a custom `Sampler` in code.

## Security Considerations

- **Do not log secrets in spans.** EF Core's contrib instrumentation can
  optionally include SQL parameter values; the default in 1.15.1-beta.1 is to
  omit them. Confirm with `OpenTelemetry.Instrumentation.EntityFrameworkCore`
  release notes if you change the default.
- **Redact PII before logging.** Application logs flow through the OTel
  logging provider into the collector and onward to Scout. Apply redaction at
  the application layer or at the collector via a `transform` processor.
- **Protect the OAuth2 client credentials** in the collector config. The
  example reads them from `.env` via Aspire's `IConfiguration`; production
  deployments should pull them from an environment-aware secret store
  (Azure Key Vault, AWS Secrets Manager, doppler, etc.) and never commit them
  to git.
- **Aspire dashboard auth is on by default** in 13.x. Do not disable it for
  any deployment beyond local development.

## Performance Considerations

- **Aspire dashboard overhead.** The dashboard runs as a separate .NET
  process and consumes ~50-100 MB of resident memory. It is appropriate for
  local development; do not deploy to production. Use Compose mode or a
  cloud-deployed shape (`aspire publish`, Aspire 9.5+) for production.
- **Sampling defaults.** With a 100% trace sampler, every HTTP request emits
  spans. At low traffic this is fine; at high traffic the OTLP exporter and
  collector become the bottleneck. Switch to head-based sampling at 1-10%
  for production.
- **Async export.** The `BatchSpanProcessor` exports asynchronously, so
  request latency is not blocked on the collector. With the default batch
  size, end-to-end export delay is 5-10 seconds.
- **`postgres:18.3` first pull on Apple Silicon** is ~310 MB and runs under
  Rosetta. Expect 60-120 seconds for the first cold start; subsequent runs
  reuse the cached image.

## Troubleshooting

### Spans and metrics never appear in Scout

The most common cause is that Aspire serialized the collector's gRPC endpoint
as `tcp://localhost:4317` instead of `http://localhost:4317`. Use
`WithHttpEndpoint(port: 4317, targetPort: 4317, name: "grpc")` (not
`WithEndpoint`) when declaring the OTel Collector container. Confirm the
injected env var with:

```bash
ps eww $(pgrep -f ArticlesApi) | tr ' ' '\n' | grep OTEL_EXPORTER_OTLP_ENDPOINT
```

The value should start with `http://`.

### Custom spans and counters not exporting

You forgot `.AddSource("Your.Source.Name")` and `.AddMeter("Your.Meter.Name")`
in `ConfigureOpenTelemetry`. The SDK silently drops anything not registered
on the tracer or meter provider. Names must match exactly between the
registration and the `new ActivitySource(...)` / `new Meter(...)` call site.

### Aspire chooses an ephemeral port for my project

Aspire assigns ephemeral host ports to project resources by default. Pin a
known port with:

```csharp
.WithHttpEndpoint(port: 8080, env: "ASPNETCORE_HTTP_PORTS")
```

The `port:` argument requests a fixed published port; the `env:` argument
tells Aspire to also inject `ASPNETCORE_HTTP_PORTS=8080` so Kestrel binds to
the same target port inside the .NET runtime. DCP proxies between them.

### Dashboard URL prints but the page returns 401

You are missing the `?t=<token>` part of the URL. Aspire 13.x has dashboard
auth on by default; the token is regenerated each run. Use the full URL from
the `Login to the dashboard at` log line, not just `http://localhost:15888/`.

### Macros: `dotnet workload install aspire` fails or hangs

You do not need it. Aspire 9.5+ uses the package-only AppHost SDK
(`<Sdk Name="Aspire.AppHost.Sdk" Version="13.2.4"/>`). NuGet restores the SDK
on `dotnet restore`; no workload install required.

### Compose-mode build fails with `useradd: exit code 9`

The .NET 9 runtime image (`mcr.microsoft.com/dotnet/aspnet:9.0`) ships with a
non-root `app` user pre-created since the .NET 8 release. Drop the `groupadd`
/ `useradd` lines from your Dockerfile and use `USER app` directly.

### Behind a corporate proxy

Set `HTTPS_PROXY` and `NO_PROXY` on the AppHost process. The proxy applies to
NuGet restores, Docker pulls (configured separately on Docker Desktop), and
the OTel Collector's outbound connection to Scout. NoProxy should include
`localhost,127.0.0.1` so dashboard access stays direct.

## FAQ

### Why does .NET Aspire need a custom OTLP destination instead of the dashboard?

The Aspire dashboard ships with a built-in OTLP receiver intended for local
development. To export to base14 Scout, override
`OTEL_EXPORTER_OTLP_ENDPOINT` on each project resource to point at a local
OTel Collector container. The collector then forwards to Scout via `otlphttp`
with OAuth2 authentication.

### Which .NET and Aspire versions are supported?

.NET 8.0 minimum, .NET 9.0 recommended. Aspire 9.5+ uses the package-only
AppHost SDK; 13.x is the current generation. .NET Framework 4.8 is not
supported.

### Why does `WithEndpoint` produce a `tcp://` URL that breaks the .NET OTLP exporter?

Aspire serializes `EndpointReference` values according to the endpoint kind.
`WithEndpoint(...)` produces `tcp://` for raw TCP endpoints. The .NET OTLP
exporter requires `http://` or `https://`. Use `WithHttpEndpoint(...)` for
any endpoint a .NET project will reach via OTLP, including OTLP/gRPC, since
gRPC runs over HTTP/2.

### How do I pin a stable port for an Aspire project resource?

Call `WithHttpEndpoint(port: 8080, env: "ASPNETCORE_HTTP_PORTS")` on the
project resource. The `port:` argument requests a fixed host port; the `env:`
argument tells Aspire to also inject `ASPNETCORE_HTTP_PORTS` so Kestrel binds
to the same port inside the .NET runtime.

### Does .NET Aspire register custom `ActivitySource`s and `Meter`s automatically?

No. Custom `ActivitySource`s require `.AddSource(name)` on the
TracerProviderBuilder, and custom `Meter`s require `.AddMeter(name)` on the
MeterProviderBuilder. Without these calls, the SDK never wires the source to
the OTLP exporter.

### How do I migrate from Application Insights to OpenTelemetry plus Scout?

Remove the `Azure.Monitor.OpenTelemetry.AspNetCore` distro package, add
`OpenTelemetry.Exporter.OpenTelemetryProtocol`, and override
`OTEL_EXPORTER_OTLP_ENDPOINT` at the AppHost level to point at a
Scout-forwarding collector. Keep both exporters live during a dual-export
validation period.

### Can I run an Aspire example without Aspire AppHost?

Yes. The example ships a parallel `compose.yml` stack that runs the same .NET
projects as Docker containers without Aspire AppHost. Both modes use the
same application code; only env-var sources differ.

## What's Next

- Clone the
  [`csharp/aspire-postgres`](https://github.com/base-14/examples/tree/main/csharp/aspire-postgres)
  example and run it end-to-end.
- Review the
  [Custom .NET instrumentation guide](../custom-instrumentation/csharp.md)
  for parent-child spans, async propagation, and error recording patterns.
- Set up
  [Scout dashboards for .NET services](https://docs.base14.io/dashboards/dotnet)
  to visualize the metrics and traces this guide produces.
- Read the
  [Application Insights migration playbook](https://docs.base14.io/migrate/application-insights)
  (publishing soon) for KQL-to-Scout query mappings and a stepwise dual-export
  cutover plan.

## References

- [.NET Aspire documentation](https://learn.microsoft.com/dotnet/aspire/)
- [.NET Aspire OpenTelemetry overview][aspire-otel-docs]
- [OpenTelemetry .NET SDK](https://opentelemetry.io/docs/languages/net/)
- [OpenTelemetry .NET on GitHub][otel-dotnet-gh]
- [OpenTelemetry .NET Contrib on GitHub][otel-dotnet-contrib-gh]
- [Migrate Application Insights to Azure Monitor OpenTelemetry][appinsights-migration]
- [base14 Scout](https://base14.io)

[aspire-otel-docs]: https://learn.microsoft.com/dotnet/aspire/fundamentals/telemetry
[otel-dotnet-gh]: https://github.com/open-telemetry/opentelemetry-dotnet
[otel-dotnet-contrib-gh]: https://github.com/open-telemetry/opentelemetry-dotnet-contrib
[appinsights-migration]: https://learn.microsoft.com/azure/azure-monitor/app/migrate-to-opentelemetry
