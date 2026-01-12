---
title:
  ASP.NET Core OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: ASP.NET Core
sidebar_position: 0
description:
  Complete guide to .NET ASP.NET Core OpenTelemetry instrumentation for
  application performance monitoring. Set up auto-instrumentation for traces,
  metrics, logs, and production deployments with base14 Scout in minutes.
keywords:
  [
    dotnet opentelemetry instrumentation,
    aspnet core monitoring,
    dotnet apm,
    csharp distributed tracing,
    dotnet application performance monitoring,
    opentelemetry dotnet,
    aspnet core observability,
    entity framework monitoring,
    dotnet metrics,
    dotnet production monitoring,
    aspnet core telemetry,
    dotnet otlp exporter,
    minimal api instrumentation,
    sql server monitoring,
    dotnet tracing guide,
    aspnet core instrumentation,
    dotnet observability stack,
    activity source dotnet,
  ]
---

# ASP.NET Core

Implement OpenTelemetry instrumentation for .NET ASP.NET Core applications to
enable comprehensive application performance monitoring (APM), distributed
tracing, and observability. This guide shows you how to auto-instrument your
ASP.NET Core application to collect traces, metrics, and logs from HTTP
requests, database queries, background jobs, and custom business logic using the
OpenTelemetry .NET SDK.

.NET applications benefit from first-class OpenTelemetry support with automatic
instrumentation for ASP.NET Core, Entity Framework Core, HttpClient, SQL Server,
and dozens of commonly used libraries. With OpenTelemetry, you can monitor
production performance, debug slow requests, trace distributed transactions
across microservices, and identify database bottlenecks without significant code
changes.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like Application Insights, or troubleshooting
performance issues in production, this guide provides production-ready
configurations and best practices for .NET OpenTelemetry instrumentation.

> **Note:** This guide provides a practical ASP.NET Core-focused overview based
> on the official OpenTelemetry documentation. For complete .NET language
> information, please consult the
> [official OpenTelemetry .NET documentation](https://opentelemetry.io/docs/languages/net/).

## Who This Guide Is For

This documentation is designed for:

- **.NET developers:** implementing observability and distributed tracing for
  ASP.NET Core applications
- **DevOps engineers:** deploying .NET applications with production monitoring
  requirements
- **Engineering teams:** migrating from Application Insights, DataDog, or other
  commercial APM solutions
- **Developers:** debugging performance issues, slow database queries, or N+1
  problems in .NET applications
- **Platform teams:** standardizing observability across multiple .NET services

## Overview

This comprehensive guide demonstrates how to:

- Install and configure OpenTelemetry SDK for ASP.NET Core applications
- Set up automatic instrumentation for HTTP requests, database queries, and
  popular libraries
- Configure production-ready telemetry export to Scout Collector
- Implement custom instrumentation for business-critical operations
- Collect and analyze traces, metrics, and logs
- Deploy instrumented .NET applications to development, staging, and production
  environments
- Troubleshoot common instrumentation issues and optimize performance
- Secure sensitive data in telemetry exports

## Prerequisites

Before starting, ensure you have:

- **.NET 8.0 or later** (LTS version recommended)
  - .NET 9.0 is recommended for optimal OpenTelemetry support
  - .NET 6.0+ is supported but may require additional configuration
- **ASP.NET Core 8.0 or later** installed
- **NuGet** for package management
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - Production deployments should use a dedicated Scout Collector instance
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)

### Compatibility Matrix

| Component         | Minimum Version | Recommended Version |
| ----------------- | --------------- | ------------------- |
| .NET SDK          | 6.0.0           | 9.0.0+              |
| ASP.NET Core      | 6.0.0           | 9.0.0+              |
| OpenTelemetry     | 1.7.0           | 1.11.0+             |
| Entity Framework  | 6.0.0           | 9.0.0+              |

## Required Packages

Install the following NuGet packages:

```bash showLineNumbers
dotnet add package OpenTelemetry
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
dotnet add package OpenTelemetry.Instrumentation.SqlClient
dotnet add package OpenTelemetry.Instrumentation.Runtime
```

Or add them to your `.csproj` file:

```xml showLineNumbers title="Api.csproj"
<ItemGroup>
  <PackageReference Include="OpenTelemetry" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.11.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.11.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.SqlClient" Version="1.11.0-beta.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.Runtime" Version="1.11.1" />
</ItemGroup>
```

## Configuration

OpenTelemetry .NET instrumentation can be configured using multiple approaches
depending on your deployment requirements and preferences. Choose the method
that best fits your application architecture.

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="extension" label="Extension Method (Recommended)" default>
```

The recommended approach is to create a dedicated telemetry extension method.
This provides the most flexibility and keeps configuration separate from your
application bootstrap.

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
using OpenTelemetry.Exporter;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Api.Telemetry;

public static class TelemetrySetup
{
    public static WebApplicationBuilder AddTelemetry(this WebApplicationBuilder builder)
    {
        var serviceName = builder.Configuration["OTEL_SERVICE_NAME"] ?? "dotnet-app";

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(serviceName)
                .AddAttributes([
                    new KeyValuePair<string, object>("deployment.environment",
                        builder.Environment.EnvironmentName.ToLowerInvariant())
                ]))
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation(options =>
                {
                    options.RecordException = true;
                })
                .AddHttpClientInstrumentation()
                .AddSqlClientInstrumentation(options =>
                {
                    options.SetDbStatementForText = true;
                    options.RecordException = true;
                })
                .AddSource("MyApp.Services")
                .AddOtlpExporter())
            .WithMetrics(metrics => metrics
                .SetExemplarFilter(ExemplarFilterType.TraceBased)
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddMeter("MyApp.Metrics")
                .AddOtlpExporter());

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
            logging.AddOtlpExporter();
        });

        return builder;
    }
}
```

Use it in your `Program.cs`:

```csharp showLineNumbers title="Program.cs"
using Api.Telemetry;

var builder = WebApplication.CreateBuilder(args);

builder.AddTelemetry();

// ... rest of configuration
```

This configuration automatically instruments:

- **ASP.NET Core**: HTTP requests, middleware, controllers, Minimal APIs
- **HttpClient**: Outbound HTTP requests
- **SQL Server**: Database queries via SqlClient
- **Runtime**: GC, thread pool, and process metrics

```mdx-code-block
</TabItem>
<TabItem value="inline" label="Inline Configuration">
```

For simpler applications, configure OpenTelemetry directly in `Program.cs`:

```csharp showLineNumbers title="Program.cs"
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;
using OpenTelemetry.Logs;

var builder = WebApplication.CreateBuilder(args);

var serviceName = builder.Configuration["OTEL_SERVICE_NAME"] ?? "dotnet-app";

builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService(serviceName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter());

builder.Logging.AddOpenTelemetry(logging =>
{
    logging.IncludeFormattedMessage = true;
    logging.AddOtlpExporter();
});

var app = builder.Build();
app.Run();
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

For containerized deployments, OpenTelemetry .NET respects standard environment
variables:

```csharp showLineNumbers title="Program.cs"
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet-app"))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter())  // Uses OTEL_EXPORTER_OTLP_ENDPOINT automatically
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter());
```

Configure with environment variables:

```bash showLineNumbers
export OTEL_SERVICE_NAME=dotnet-app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
```

```mdx-code-block
</TabItem>
<TabItem value="selective" label="Selective Instrumentation">
```

If you want to enable only specific instrumentations:

```csharp showLineNumbers title="Program.cs"
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("dotnet-app"))
    .WithTracing(tracing => tracing
        // Only enable specific instrumentations
        .AddAspNetCoreInstrumentation(options =>
        {
            options.RecordException = true;
            options.Filter = context =>
            {
                // Skip health check endpoints
                return !context.Request.Path.StartsWithSegments("/health");
            };
        })
        .AddHttpClientInstrumentation(options =>
        {
            options.RecordException = true;
        })
        // Add custom ActivitySources
        .AddSource("MyApp.AuthService")
        .AddSource("MyApp.ArticleService")
        .AddOtlpExporter());
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Configuring Instrumentation Options

Fine-tune instrumentation for your needs:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation(options =>
        {
            options.RecordException = true;
            options.EnrichWithHttpRequest = (activity, request) =>
            {
                activity.SetTag("http.request_content_type",
                    request.ContentType);
            };
            options.EnrichWithHttpResponse = (activity, response) =>
            {
                activity.SetTag("http.response_content_length",
                    response.ContentLength);
            };
            options.Filter = context =>
            {
                // Skip static files and health checks
                var path = context.Request.Path.Value ?? "";
                return !path.StartsWith("/health") &&
                       !path.StartsWith("/favicon") &&
                       !path.StartsWith("/static");
            };
        })
        .AddSqlClientInstrumentation(options =>
        {
            options.SetDbStatementForText = true;
            options.SetDbStatementForStoredProcedure = true;
            options.RecordException = true;
            options.EnableConnectionLevelAttributes = true;
        }));
```

### Scout Collector Integration

When using Scout Collector, configure your .NET application to send telemetry
data to the Scout Collector endpoint:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
public static WebApplicationBuilder AddTelemetry(this WebApplicationBuilder builder)
{
    var serviceName = builder.Configuration["OTEL_SERVICE_NAME"] ?? "dotnet-app";
    var scoutEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]
        ?? "http://localhost:4317";
    var scoutApiKey = builder.Configuration["SCOUT_API_KEY"];

    builder.Services.AddOpenTelemetry()
        .ConfigureResource(resource => resource
            .AddService(serviceName)
            .AddAttributes([
                new KeyValuePair<string, object>("deployment.environment",
                    builder.Environment.EnvironmentName.ToLowerInvariant())
            ]))
        .WithTracing(tracing => tracing
            .AddAspNetCoreInstrumentation(o => o.RecordException = true)
            .AddHttpClientInstrumentation()
            .AddSqlClientInstrumentation(o => o.SetDbStatementForText = true)
            .AddOtlpExporter(options =>
            {
                options.Endpoint = new Uri(scoutEndpoint);
                if (!string.IsNullOrEmpty(scoutApiKey))
                {
                    options.Headers = $"x-scout-api-key={scoutApiKey}";
                }
            }));

    return builder;
}
```

> **Scout Dashboard Integration**: After configuration, your traces will appear
> in the Scout Dashboard. Navigate to the Traces section to view request flows,
> identify performance bottlenecks, and analyze distributed transactions across
> your .NET services.

## Production Configuration

Production deployments require additional configuration for optimal performance,
reliability, and resource utilization. This section covers production-specific
settings and best practices.

### Batch Span Processor (Default)

The OTLP exporter uses batch processing by default. Configure batch settings
for production:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(options =>
        {
            options.Endpoint = new Uri(scoutEndpoint);
            options.ExportProcessorType = ExportProcessorType.Batch;
            options.BatchExportProcessorOptions = new BatchExportProcessorOptions<Activity>
            {
                MaxQueueSize = 2048,
                ScheduledDelayMilliseconds = 5000,
                ExporterTimeoutMilliseconds = 30000,
                MaxExportBatchSize = 512
            };
        }));
```

**Benefits of Batch Processing:**

- Reduces network requests by up to 95%
- Lower CPU overhead compared to immediate export
- Prevents network saturation during traffic spikes
- Configurable batching for optimal throughput

### Resource Attributes

Add rich context to all telemetry data with resource attributes:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(
            serviceName: serviceName,
            serviceVersion: Assembly.GetExecutingAssembly()
                .GetName().Version?.ToString() ?? "1.0.0",
            serviceInstanceId: Environment.MachineName)
        .AddAttributes([
            new KeyValuePair<string, object>("deployment.environment",
                builder.Environment.EnvironmentName.ToLowerInvariant()),
            new KeyValuePair<string, object>("service.namespace", "production"),
            new KeyValuePair<string, object>("host.name", Environment.MachineName),
            new KeyValuePair<string, object>("process.runtime.name", ".NET"),
            new KeyValuePair<string, object>("process.runtime.version",
                Environment.Version.ToString()),
        ]));
```

These attributes help you:

- Filter traces by environment, region, or instance
- Correlate issues with specific deployments
- Analyze performance across different infrastructure
- Debug production incidents faster

### Environment-Based Configuration

Use `appsettings.json` for environment-specific configuration:

```json showLineNumbers title="appsettings.json"
{
  "OTEL_SERVICE_NAME": "dotnet-app",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
```

```json showLineNumbers title="appsettings.Production.json"
{
  "OTEL_SERVICE_NAME": "dotnet-app-production",
  "OTEL_EXPORTER_OTLP_ENDPOINT": "https://scout-collector.example.com:4317",
  "SCOUT_API_KEY": "",
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
```

### Production Environment Variables

Configure production settings via environment variables:

```bash showLineNumbers title=".env.production"
# Service Configuration
OTEL_SERVICE_NAME=dotnet-app-production
ASPNETCORE_ENVIRONMENT=Production

# Scout Collector Endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4317
SCOUT_API_KEY=your-scout-api-key

# Database
ConnectionStrings__DefaultConnection=Server=db;Database=Production;User Id=app;Password=secret;

# JWT
Jwt__Secret=your-production-jwt-secret-minimum-32-characters
```

### Docker Production Configuration

For containerized .NET applications, configure OpenTelemetry in your Docker
setup:

```dockerfile showLineNumbers title="Dockerfile"
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy project files
COPY *.csproj ./
RUN dotnet restore

# Copy source and build
COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production
ENV OTEL_SERVICE_NAME=dotnet-app
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317

EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

```yaml showLineNumbers title="docker-compose.yml"
services:
  api:
    build: .
    environment:
      ASPNETCORE_ENVIRONMENT: Production
      ASPNETCORE_HTTP_PORTS: "8080"
      ConnectionStrings__DefaultConnection: "Server=sqlserver;Database=App;User Id=sa;Password=YourStrong@Passw0rd;TrustServerCertificate=true"
      Jwt__Secret: "your-super-secret-jwt-key-minimum-32-characters-long"
      OTEL_SERVICE_NAME: dotnet-app
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
    depends_on:
      - sqlserver
      - otel-collector
    ports:
      - "8080:8080"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4317:4317"
      - "4318:4318"

  sqlserver:
    image: mcr.microsoft.com/azure-sql-edge:latest
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "YourStrong@Passw0rd"
```

## Metrics

In addition to traces, OpenTelemetry can collect metrics from your .NET
application to monitor resource utilization, request rates, error counts, and
custom business metrics.

### Automatic HTTP Metrics

ASP.NET Core instrumentation automatically collects HTTP-related metrics:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics => metrics
        .SetExemplarFilter(ExemplarFilterType.TraceBased)
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());
```

**Automatic metrics include:**

- `http.server.request.duration` - HTTP request duration histogram
- `http.server.active_requests` - Currently active requests
- `http.client.request.duration` - Outbound HTTP request duration
- `process.runtime.dotnet.gc.collections.count` - GC collections
- `process.runtime.dotnet.threadpool.threads.count` - Thread pool size

### Custom Business Metrics

Create custom metrics to track business-specific events and KPIs:

```csharp showLineNumbers title="Telemetry/Metrics.cs"
using System.Diagnostics.Metrics;

namespace Api.Telemetry;

public static class AppMetrics
{
    private static readonly Meter Meter = new("MyApp.Metrics");

    public static readonly Counter<long> UsersRegistered =
        Meter.CreateCounter<long>("users.registered",
            description: "Total users registered");

    public static readonly Counter<long> LoginAttempts =
        Meter.CreateCounter<long>("auth.login.attempts",
            description: "Total login attempts");

    public static readonly Counter<long> LoginFailures =
        Meter.CreateCounter<long>("auth.login.failures",
            description: "Total failed login attempts");

    public static readonly Counter<long> ArticlesCreated =
        Meter.CreateCounter<long>("articles.created",
            description: "Total articles created");

    public static readonly Counter<long> ArticlesUpdated =
        Meter.CreateCounter<long>("articles.updated",
            description: "Total articles updated");

    public static readonly Counter<long> ArticlesDeleted =
        Meter.CreateCounter<long>("articles.deleted",
            description: "Total articles deleted");

    public static readonly Histogram<double> OrderValue =
        Meter.CreateHistogram<double>("orders.value",
            unit: "USD",
            description: "Distribution of order values");
}
```

Use metrics in your services:

```csharp showLineNumbers title="Services/ArticleService.cs"
public async Task<ArticleResponse> CreateAsync(int userId, CreateArticleRequest request)
{
    // ... create article logic

    // Record business metric
    AppMetrics.ArticlesCreated.Add(1);

    logger.LogInformation("Article created: {ArticleId} by user {UserId}",
        article.Id, userId);

    return response;
}
```

### Viewing Metrics in Scout Dashboard

After configuring metrics export, navigate to the Scout Dashboard to:

- View HTTP request rate and latency percentiles (p50, p95, p99)
- Monitor error rates and status code distributions
- Track custom business metrics in real-time
- Create alerts based on metric thresholds
- Build custom dashboards combining metrics and traces

## Entity Framework Core Database Monitoring

OpenTelemetry automatically instruments Entity Framework Core to provide
comprehensive database query monitoring.

### Automatic Query Tracing

EF Core emits diagnostic events that are captured by OpenTelemetry:

```csharp showLineNumbers title="Program.cs"
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString)
           .EnableSensitiveDataLogging(builder.Environment.IsDevelopment())
           .EnableDetailedErrors(builder.Environment.IsDevelopment()));
```

### Configuring SQL Client Instrumentation

Fine-tune SQL Client instrumentation for security and performance:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddSqlClientInstrumentation(options =>
        {
            // Capture SQL statements (disable in production for sensitive data)
            options.SetDbStatementForText = true;
            options.SetDbStatementForStoredProcedure = true;

            // Record exceptions as span events
            options.RecordException = true;

            // Add connection-level attributes
            options.EnableConnectionLevelAttributes = true;

            // Custom enrichment
            options.Enrich = (activity, eventName, rawObject) =>
            {
                if (rawObject is SqlCommand command)
                {
                    activity.SetTag("db.command_type", command.CommandType.ToString());
                }
            };
        }));
```

**SQL span attributes include:**

- `db.system` - Database type (mssql)
- `db.name` - Database name
- `db.statement` - SQL query
- `db.operation.name` - Operation type
- `server.address` - Database server

### Detecting N+1 Queries

Use OpenTelemetry traces to identify N+1 query problems:

```csharp showLineNumbers
// Bad: N+1 query pattern (visible in traces as multiple DB spans)
var articles = await context.Articles.ToListAsync();
foreach (var article in articles)
{
    var author = await context.Users.FindAsync(article.AuthorId); // N+1!
}

// Good: Optimized with eager loading (single query in trace)
var articles = await context.Articles
    .Include(a => a.Author)
    .ToListAsync();
```

In Scout Dashboard, N+1 queries appear as:

- Multiple identical database spans within a single request trace
- High span count for simple operations
- Repeated query patterns with different parameters

## Custom Manual Instrumentation

While automatic instrumentation covers most ASP.NET Core components, you can add
custom instrumentation for business logic, external API calls, or
performance-critical code paths.

### Creating Custom Spans with ActivitySource

Use `ActivitySource` for custom span creation:

```csharp showLineNumbers title="Services/ArticleService.cs"
using System.Diagnostics;
using Api.Telemetry;
using OpenTelemetry.Trace;

namespace Api.Services;

public class ArticleService
{
    private static readonly ActivitySource ActivitySource =
        new("MyApp.ArticleService");

    private readonly AppDbContext _context;
    private readonly ILogger<ArticleService> _logger;

    public ArticleService(AppDbContext context, ILogger<ArticleService> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<ArticleResponse> CreateAsync(int userId, CreateArticleRequest request)
    {
        using var activity = ActivitySource.StartActivity("article.create");
        activity?.SetTag("user.id", userId);

        var slug = GenerateSlug(request.Title);
        activity?.SetTag("article.slug", slug);

        var article = new Article
        {
            Slug = slug,
            Title = request.Title,
            Description = request.Description,
            Body = request.Body,
            AuthorId = userId
        };

        _context.Articles.Add(article);
        await _context.SaveChangesAsync();

        activity?.SetTag("article.id", article.Id);
        AppMetrics.ArticlesCreated.Add(1);

        _logger.LogInformation("Article created: {ArticleId} by user {UserId}",
            article.Id, userId);

        return ToArticleResponse(article);
    }
}
```

Don't forget to register your ActivitySource:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddSource("MyApp.ArticleService")
        .AddSource("MyApp.AuthService")
        .AddOtlpExporter());
```

### Adding Attributes to Current Spans

Enrich existing spans with additional context:

```csharp showLineNumbers title="Middleware/UserContextMiddleware.cs"
using System.Diagnostics;

public class UserContextMiddleware
{
    private readonly RequestDelegate _next;

    public UserContextMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var activity = Activity.Current;

        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirst("sub")?.Value;
            var userRole = context.User.FindFirst("role")?.Value;

            activity?.SetTag("user.id", userId);
            activity?.SetTag("user.role", userRole);
            activity?.SetTag("user.authenticated", true);
        }

        await _next(context);
    }
}
```

### Exception Handling and Error Tracking

Capture exceptions in custom spans:

```csharp showLineNumbers title="Services/ArticleService.cs"
public async Task<ArticleResponse?> UpdateAsync(string slug, int userId, UpdateArticleRequest request)
{
    using var activity = ActivitySource.StartActivity("article.update");
    activity?.SetTag("article.slug", slug);
    activity?.SetTag("user.id", userId);

    try
    {
        var article = await _context.Articles
            .FirstOrDefaultAsync(a => a.Slug == slug);

        if (article is null) return null;

        if (article.AuthorId != userId)
        {
            var ex = new UnauthorizedAccessException("Not authorized to update this article");
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            activity?.AddException(ex);
            throw ex;
        }

        // ... update logic

        activity?.SetTag("article.id", article.Id);
        AppMetrics.ArticlesUpdated.Add(1);

        return ToArticleResponse(article);
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Failed to update article {Slug}", slug);
        activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
        activity?.AddException(ex);
        throw;
    }
}
```

### Error Handling with Trace ID

Include trace IDs in error responses for easier debugging:

```csharp showLineNumbers title="Middleware/ExceptionMiddleware.cs"
using System.Diagnostics;

public static class ExceptionMiddlewareExtensions
{
    public static IApplicationBuilder UseExceptionHandling(this IApplicationBuilder app)
    {
        return app.UseExceptionHandler(errorApp =>
        {
            errorApp.Run(async context =>
            {
                var traceId = Activity.Current?.TraceId.ToString();

                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json";

                await context.Response.WriteAsJsonAsync(new
                {
                    error = "Internal server error",
                    trace_id = traceId
                });
            });
        });
    }
}
```

### Using Semantic Conventions

Follow OpenTelemetry semantic conventions for consistent attribute naming:

```csharp showLineNumbers
// HTTP semantic conventions
activity?.SetTag("http.method", "POST");
activity?.SetTag("http.url", "https://api.example.com/users");
activity?.SetTag("http.status_code", 201);
activity?.SetTag("http.request.header.content_type", "application/json");

// Database semantic conventions
activity?.SetTag("db.system", "mssql");
activity?.SetTag("db.name", "production");
activity?.SetTag("db.statement", "SELECT * FROM Users WHERE Id = @Id");
activity?.SetTag("db.operation", "SELECT");

// Messaging semantic conventions
activity?.SetTag("messaging.system", "rabbitmq");
activity?.SetTag("messaging.destination", "orders_queue");
activity?.SetTag("messaging.operation", "process");
```

## Running Your Instrumented Application

```mdx-code-block
<Tabs>
<TabItem value="development" label="Development" default>
```

For local development, console output is enabled by default:

```csharp showLineNumbers title="Program.cs"
var builder = WebApplication.CreateBuilder(args);

builder.AddTelemetry();

if (builder.Environment.IsDevelopment())
{
    builder.Logging.AddConsole();
}

var app = builder.Build();
app.Run();
```

Start your application:

```bash
dotnet run
```

You'll see trace output in the console for each request.

```mdx-code-block
</TabItem>
<TabItem value="production" label="Production">
```

For production deployments, ensure the Scout Collector endpoint is properly
configured:

```bash showLineNumbers
# Set environment variables
export OTEL_SERVICE_NAME=dotnet-app-production
export OTEL_EXPORTER_OTLP_ENDPOINT=https://scout-collector.example.com:4317
export ASPNETCORE_ENVIRONMENT=Production

# Run the application
dotnet run --configuration Release
```

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker">
```

Run your instrumented .NET application in Docker:

```bash showLineNumbers
# Build the image
docker build -t dotnet-app:latest .

# Run with Scout Collector
docker run -d \
  --name dotnet-app \
  -e OTEL_SERVICE_NAME=dotnet-app \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317 \
  -e ConnectionStrings__DefaultConnection="Server=db;Database=App;..." \
  -p 8080:8080 \
  dotnet-app:latest
```

Or use Docker Compose (see [Production Configuration](#production-configuration)
section for complete example).

```mdx-code-block
</TabItem>
</Tabs>
```

## Troubleshooting

### Verifying OpenTelemetry Installation

Create a health check endpoint to verify telemetry:

```csharp showLineNumbers title="Endpoints/HealthEndpoints.cs"
using System.Diagnostics;
using System.Reflection;

public static class HealthEndpoints
{
    private static readonly ActivitySource ActivitySource =
        new("MyApp.Health");

    public static void MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/health", () =>
        {
            using var activity = ActivitySource.StartActivity("health.check");

            activity?.SetTag("service.name",
                Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME"));
            activity?.SetTag("runtime.version",
                Environment.Version.ToString());

            return Results.Ok(new
            {
                status = "ok",
                timestamp = DateTime.UtcNow,
                version = Assembly.GetExecutingAssembly()
                    .GetName().Version?.ToString()
            });
        });

        app.MapGet("/health/telemetry", () =>
        {
            using var activity = ActivitySource.StartActivity("telemetry.check");

            return Results.Ok(new
            {
                status = "ok",
                telemetry = new
                {
                    trace_id = Activity.Current?.TraceId.ToString(),
                    span_id = Activity.Current?.SpanId.ToString(),
                    service_name = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME"),
                    endpoint = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT")
                }
            });
        });
    }
}
```

Test the endpoints:

```bash
curl http://localhost:8080/health/telemetry
```

### Debug Mode

Enable debug logging to troubleshoot instrumentation issues:

```json showLineNumbers title="appsettings.Development.json"
{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "OpenTelemetry": "Debug",
      "Microsoft.AspNetCore": "Information"
    }
  }
}
```

### Common Issues

#### Issue: No traces appearing in Scout Dashboard

**Solutions:**

1. Verify Scout Collector endpoint is reachable:

   ```bash
   curl -v http://scout-collector:4317
   ```

2. Check environment variables:

   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_SERVICE_NAME
   ```

3. Enable debug logging and check for export errors

4. Verify network connectivity between your app and Scout Collector

#### Issue: Missing database query spans

**Solutions:**

1. Ensure `OpenTelemetry.Instrumentation.SqlClient` package is installed
2. Verify SQL Client instrumentation is configured:

   ```csharp
   .AddSqlClientInstrumentation(options =>
   {
       options.SetDbStatementForText = true;
   })
   ```

3. Check that you're using `SqlClient` (not third-party providers)

#### Issue: High memory usage

**Solutions:**

1. Configure batch processor settings to reduce queue size
2. Ensure spans are being exported successfully
3. Limit span attribute sizes

#### Issue: Performance degradation

**Solutions:**

1. Use batch processor (default) instead of simple processor
2. Filter out high-frequency endpoints like health checks
3. Reduce logging verbosity in production

## Security Considerations

### Protecting Sensitive Data

Avoid adding sensitive information to span attributes:

```csharp showLineNumbers
// Bad - exposes sensitive data
activity?.SetTag("user.password", password);          // Never include passwords!
activity?.SetTag("credit_card.number", cardNumber);   // Never include payment data!
activity?.SetTag("user.ssn", socialSecurity);         // Never include PII!

// Good - uses safe identifiers
activity?.SetTag("user.id", userId);
activity?.SetTag("user.role", role);
activity?.SetTag("payment.provider", "stripe");
activity?.SetTag("payment.status", "completed");
```

### Sanitizing SQL Statements

Disable SQL statement capture in production if queries contain sensitive data:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddSqlClientInstrumentation(options =>
        {
            // Only enable in development
            options.SetDbStatementForText = builder.Environment.IsDevelopment();
            options.SetDbStatementForStoredProcedure = builder.Environment.IsDevelopment();
        }));
```

### Filtering Sensitive HTTP Headers

Skip sensitive headers in your tracing configuration:

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation(options =>
        {
            options.EnrichWithHttpRequest = (activity, request) =>
            {
                // Only capture safe headers
                activity.SetTag("http.request.header.content_type",
                    request.ContentType);
                // Don't capture Authorization header
            };
        }));
```

### Compliance Considerations

For applications handling regulated data (GDPR, HIPAA, PCI-DSS):

- Never include personally identifiable information (PII) in spans
- Use hashed or anonymized user identifiers
- Implement data retention policies in Scout Dashboard
- Disable SQL statement capture for sensitive queries
- Audit span attributes regularly for sensitive data leaks

## Performance Considerations

### Expected Performance Impact

OpenTelemetry instrumentation adds minimal overhead to .NET applications:

- **Average latency increase**: 1-2ms per request
- **CPU overhead**: Less than 2% in production with batch processor
- **Memory overhead**: ~30-50MB depending on queue size and traffic

**Impact varies based on:**

- Number of enabled instrumentations
- Span processor type (Batch vs Simple)
- Application request volume
- Complexity of database queries

### Optimization Best Practices

#### 1. Use Batch Processor (Default)

```csharp showLineNumbers
// Good - batches exports, low overhead (default)
.AddOtlpExporter(options =>
{
    options.ExportProcessorType = ExportProcessorType.Batch;
})

// Avoid - exports every span immediately
.AddOtlpExporter(options =>
{
    options.ExportProcessorType = ExportProcessorType.Simple;
})
```

#### 2. Filter Non-Critical Endpoints

```csharp showLineNumbers
.AddAspNetCoreInstrumentation(options =>
{
    options.Filter = context =>
    {
        var path = context.Request.Path.Value ?? "";
        return !path.StartsWith("/health") &&
               !path.StartsWith("/metrics") &&
               !path.StartsWith("/favicon");
    };
})
```

#### 3. Conditional Span Recording

```csharp showLineNumbers
var activity = Activity.Current;

// Only add expensive attributes if activity is being recorded
if (activity?.IsAllDataRequested == true)
{
    activity.SetTag("expensive.attribute", ComputeExpensiveValue());
}
```

#### 4. Limit Attribute Values

```csharp showLineNumbers
// Truncate long values
var truncatedBody = requestBody.Length > 1000
    ? requestBody[..1000] + "..."
    : requestBody;

activity?.SetTag("http.request.body", truncatedBody);
```

## Frequently Asked Questions

### Does OpenTelemetry impact .NET application performance?

OpenTelemetry adds approximately 1-2ms of latency per request in typical ASP.NET
Core applications. With proper configuration (batch processor), the performance
impact is minimal and acceptable for most production workloads.

### Which .NET versions are supported?

OpenTelemetry supports .NET 6.0+ with full support. .NET 8.0+ is recommended for
optimal compatibility and performance. See the [Prerequisites](#prerequisites)
section for detailed version compatibility.

### Can I use OpenTelemetry with background services?

Yes! You can instrument `IHostedService` and `BackgroundService` implementations
using `ActivitySource`:

```csharp
public class MyBackgroundService : BackgroundService
{
    private static readonly ActivitySource ActivitySource =
        new("MyApp.BackgroundService");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var activity = ActivitySource.StartActivity("process_job");
            // ... process job
        }
    }
}
```

### Can I use OpenTelemetry alongside Application Insights?

Yes, you can run OpenTelemetry alongside Application Insights during migration
periods. However, running multiple telemetry systems simultaneously will
multiply the overhead, so plan your migration carefully. Consider using the
Azure Monitor OpenTelemetry exporter as a replacement.

### How do I handle multi-tenant applications?

Add tenant context to spans using tags:

```csharp
Activity.Current?.SetTag("tenant.id", tenantId);
Activity.Current?.SetTag("tenant.name", tenantName);
```

Then filter traces by tenant in Scout Dashboard.

### What's the difference between traces and metrics?

**Traces** show the complete request flow through your application with timing
details for each operation. Use traces to debug slow requests and understand
distributed transactions.

**Metrics** provide aggregated statistics over time (request rate, error rate,
latency percentiles). Use metrics for monitoring overall application health and
setting alerts.

### How do I propagate trace context to message queues?

Use W3C Trace Context propagation:

```csharp
// When publishing
var activity = Activity.Current;
message.Headers["traceparent"] = activity?.Id;

// When consuming
var traceparent = message.Headers["traceparent"];
using var activity = ActivitySource.StartActivity(
    "process_message",
    ActivityKind.Consumer,
    traceparent);
```

### Can I customize which endpoints are instrumented?

Yes! Use the `Filter` option in ASP.NET Core instrumentation:

```csharp
options.Filter = context =>
{
    return !context.Request.Path.StartsWithSegments("/internal");
};
```

## What's Next?

Now that your .NET application is instrumented with OpenTelemetry, explore these
resources to maximize your observability:

### Advanced Topics

- **[PostgreSQL Monitoring Best Practices](../../component/postgres.md)** -
  Optimize database observability with query performance analysis

### Scout Platform Features

- **[Creating Alerts](../../../guides/creating-alerts-with-logx.md)** - Set up
  intelligent alerts for error rates, latency thresholds, and custom metrics
- **[Dashboard Creation](../../../guides/create-your-first-dashboard.md)** -
  Build custom dashboards combining traces, metrics, and business KPIs

### Deployment and Operations

- **[Docker Compose Setup](../../collector-setup/docker-compose-example.md)** -
  Set up Scout Collector for local development and testing

## Complete Example

Here's a complete working example of an ASP.NET Core application with
OpenTelemetry instrumentation:

### Project File

```xml showLineNumbers title="Api.csproj"
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="9.0.0" />
    <PackageReference Include="OpenTelemetry" Version="1.11.2" />
    <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.11.2" />
    <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.11.2" />
    <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.11.1" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.11.1" />
    <PackageReference Include="OpenTelemetry.Instrumentation.SqlClient" Version="1.11.0-beta.1" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Runtime" Version="1.11.1" />
  </ItemGroup>

</Project>
```

### Telemetry Setup

```csharp showLineNumbers title="Telemetry/TelemetrySetup.cs"
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Api.Telemetry;

public static class TelemetrySetup
{
    public static WebApplicationBuilder AddTelemetry(this WebApplicationBuilder builder)
    {
        var serviceName = builder.Configuration["OTEL_SERVICE_NAME"] ?? "dotnet-app";

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(serviceName)
                .AddAttributes([
                    new KeyValuePair<string, object>("deployment.environment",
                        builder.Environment.EnvironmentName.ToLowerInvariant())
                ]))
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation(o => o.RecordException = true)
                .AddHttpClientInstrumentation()
                .AddSqlClientInstrumentation(o => o.SetDbStatementForText = true)
                .AddSource("MyApp.Services")
                .AddOtlpExporter())
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation()
                .AddMeter("MyApp.Metrics")
                .AddOtlpExporter());

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.AddOtlpExporter();
        });

        return builder;
    }
}
```

### Metrics Definition

```csharp showLineNumbers title="Telemetry/Metrics.cs"
using System.Diagnostics.Metrics;

namespace Api.Telemetry;

public static class AppMetrics
{
    private static readonly Meter Meter = new("MyApp.Metrics");

    public static readonly Counter<long> ArticlesCreated =
        Meter.CreateCounter<long>("articles.created",
            description: "Total articles created");
}
```

### Instrumented Service

```csharp showLineNumbers title="Services/ArticleService.cs"
using System.Diagnostics;
using Api.Telemetry;

namespace Api.Services;

public class ArticleService
{
    private static readonly ActivitySource ActivitySource =
        new("MyApp.Services");

    public async Task<Article> CreateAsync(CreateArticleRequest request)
    {
        using var activity = ActivitySource.StartActivity("article.create");

        var article = new Article
        {
            Title = request.Title,
            Body = request.Body
        };

        // Save to database...

        activity?.SetTag("article.id", article.Id);
        AppMetrics.ArticlesCreated.Add(1);

        return article;
    }
}
```

### Program Entry Point

```csharp showLineNumbers title="Program.cs"
using Api.Telemetry;

var builder = WebApplication.CreateBuilder(args);

builder.AddTelemetry();

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
```

### Environment Variables

```bash showLineNumbers title=".env"
OTEL_SERVICE_NAME=dotnet-app
OTEL_EXPORTER_OTLP_ENDPOINT=http://scout-collector:4317
ASPNETCORE_ENVIRONMENT=Development
```

This complete example is available in our
[GitHub examples repository](https://github.com/base-14/examples/tree/main/csharp).

## References

- [Official OpenTelemetry .NET Documentation](https://opentelemetry.io/docs/languages/net/)
- [ASP.NET Core Documentation](https://learn.microsoft.com/aspnet/core)
- [OpenTelemetry .NET GitHub](https://github.com/open-telemetry/opentelemetry-dotnet)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Spring Boot Instrumentation](./spring-boot.md) - Java framework alternative
- [Node.js Instrumentation](./nodejs.md) - JavaScript runtime alternative
