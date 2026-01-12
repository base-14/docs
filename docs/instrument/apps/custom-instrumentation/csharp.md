---
title: C# Custom OpenTelemetry Instrumentation - Manual Tracing Guide | base14 Scout
sidebar_label: C#
sidebar_position: 1
description:
  Custom instrumentation for C# and .NET applications with OpenTelemetry. Manual
  tracing with ActivitySource, metrics with System.Diagnostics.Metrics, and OTLP export.
keywords:
  [
    csharp instrumentation,
    dotnet monitoring,
    opentelemetry csharp,
    csharp custom instrumentation,
    dotnet observability,
    csharp distributed tracing,
    csharp manual instrumentation,
    activitysource dotnet,
    system diagnostics metrics,
    dotnet spans,
  ]
---

# CSharp

Implement OpenTelemetry custom instrumentation for C# and .NET applications to
collect traces, metrics, and logs using the .NET OpenTelemetry SDK. This guide
covers manual instrumentation for any .NET application, including ASP.NET Core,
console apps, worker services, and custom frameworks.

> **Note:** This guide provides a practical overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry .NET documentation](https://opentelemetry.io/docs/languages/net/).

## Overview

This guide demonstrates how to:

- Set up OpenTelemetry SDK for manual instrumentation
- Create and manage custom spans using `ActivitySource`
- Add attributes, events, and exception tracking
- Implement metrics collection with `System.Diagnostics.Metrics`
- Propagate context across service boundaries
- Instrument common .NET patterns and async code

> **Complete Working Examples**: This guide includes code snippets for learning.
> For full implementations, see the
> [Complete Examples](#complete-examples) section.

## Prerequisites

Before starting, ensure you have:

- **.NET 8.0 or later** installed (.NET 9.0 recommended)
- **Visual Studio 2022**, **VS Code**, or **Rider**
- **base14 Scout account** with collector endpoint and API key
- Basic familiarity with async C# and dependency injection

## Required Packages

Add these NuGet packages to your project:

```xml title="YourProject.csproj"
<ItemGroup>
  <!-- OpenTelemetry core -->
  <PackageReference Include="OpenTelemetry" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.11.2" />

  <!-- OTLP exporter -->
  <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.11.2" />

  <!-- Instrumentation libraries (optional) -->
  <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.11.0" />
  <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.11.0" />
</ItemGroup>
```

Or via CLI:

```bash
dotnet add package OpenTelemetry
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
```

## Telemetry Initialization

### ASP.NET Core Setup

Configure OpenTelemetry in your `Program.cs`:

```csharp title="Program.cs"
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;

var builder = WebApplication.CreateBuilder(args);

// Configure OpenTelemetry
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(
            serviceName: "my-dotnet-service",
            serviceVersion: "1.0.0")
        .AddAttributes(new[]
        {
            new KeyValuePair<string, object>("deployment.environment", "production")
        }))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSource("MyApp.Services")  // Register custom ActivitySources
        .AddOtlpExporter(options =>
        {
            options.Endpoint = new Uri("https://scout-collector.base14.io:4317");
        }))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddMeter("MyApp.Metrics")  // Register custom Meters
        .AddOtlpExporter(options =>
        {
            options.Endpoint = new Uri("https://scout-collector.base14.io:4317");
        }));

var app = builder.Build();
app.Run();
```

### Extension Method Pattern

Organize telemetry setup in a separate file:

```csharp title="Telemetry/TelemetrySetup.cs"
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;

namespace MyApp.Telemetry;

public static class TelemetrySetup
{
    public static WebApplicationBuilder AddTelemetry(this WebApplicationBuilder builder)
    {
        var serviceName = builder.Configuration["Telemetry:ServiceName"] ?? "my-service";
        var otlpEndpoint = builder.Configuration["Telemetry:OtlpEndpoint"]
            ?? "https://scout-collector.base14.io:4317";

        builder.Services.AddOpenTelemetry()
            .ConfigureResource(resource => resource
                .AddService(serviceName)
                .AddAttributes(new[]
                {
                    new KeyValuePair<string, object>(
                        "deployment.environment",
                        builder.Environment.EnvironmentName)
                }))
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation(options =>
                {
                    options.RecordException = true;
                })
                .AddHttpClientInstrumentation()
                .AddSource("MyApp.*")
                .AddOtlpExporter(options =>
                {
                    options.Endpoint = new Uri(otlpEndpoint);
                }))
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddMeter("MyApp.*")
                .AddOtlpExporter(options =>
                {
                    options.Endpoint = new Uri(otlpEndpoint);
                }));

        return builder;
    }
}
```

Usage:

```csharp title="Program.cs"
var builder = WebApplication.CreateBuilder(args);
builder.AddTelemetry();
```

## Traces

### Creating an ActivitySource

Define an `ActivitySource` for your service or component:

```csharp
using System.Diagnostics;

public class UserService
{
    private static readonly ActivitySource ActivitySource = new("MyApp.UserService");

    // Service methods...
}
```

### Creating Spans

Create spans to trace operations:

```csharp
using System.Diagnostics;

public class UserService
{
    private static readonly ActivitySource ActivitySource = new("MyApp.UserService");

    public async Task<User> CreateUserAsync(CreateUserRequest request)
    {
        using var activity = ActivitySource.StartActivity("user.create");

        activity?.SetTag("user.email", request.Email);

        var user = new User
        {
            Email = request.Email,
            Name = request.Name
        };

        await _context.Users.AddAsync(user);
        await _context.SaveChangesAsync();

        activity?.SetTag("user.id", user.Id);

        return user;
    }
}
```

### Span with Specific Kind

Specify the span kind for proper visualization:

```csharp
public async Task<Response> CallExternalServiceAsync(string endpoint)
{
    using var activity = ActivitySource.StartActivity(
        "external.call",
        ActivityKind.Client);

    activity?.SetTag("http.url", endpoint);
    activity?.SetTag("http.method", "GET");

    var response = await _httpClient.GetAsync(endpoint);

    activity?.SetTag("http.status_code", (int)response.StatusCode);

    return response;
}
```

Available `ActivityKind` values:

- `Internal` (default) - Internal operation
- `Server` - Server-side handling of a request
- `Client` - Client-side of an outgoing request
- `Producer` - Initiator of an async operation
- `Consumer` - Handler of an async operation

### Nested Spans

Spans automatically nest based on the call hierarchy:

```csharp
public async Task<OrderResponse> ProcessOrderAsync(CreateOrderRequest request)
{
    using var activity = ActivitySource.StartActivity("order.process");

    var user = await ValidateUserAsync(request.UserId);  // Creates child span
    var items = await ReserveInventoryAsync(request.Items);  // Creates child span
    var payment = await ProcessPaymentAsync(request.Payment);  // Creates child span

    activity?.SetTag("order.total", payment.Amount);

    return new OrderResponse { OrderId = Guid.NewGuid() };
}

private async Task<User> ValidateUserAsync(int userId)
{
    using var activity = ActivitySource.StartActivity("user.validate");
    // This span is a child of "order.process"

    return await _userService.GetByIdAsync(userId);
}
```

## Attributes

### Adding Span Attributes

Add attributes to provide context:

```csharp
public async Task<Article> CreateArticleAsync(int userId, CreateArticleRequest request)
{
    using var activity = ActivitySource.StartActivity("article.create");

    activity?.SetTag("user.id", userId);
    activity?.SetTag("article.title", request.Title);

    var article = new Article
    {
        Title = request.Title,
        Body = request.Body,
        AuthorId = userId
    };

    await _context.Articles.AddAsync(article);
    await _context.SaveChangesAsync();

    // Add more attributes after values are known
    activity?.SetTag("article.id", article.Id);
    activity?.SetTag("article.slug", article.Slug);

    return article;
}
```

### Semantic Conventions

Follow OpenTelemetry semantic conventions:

```csharp
public async Task<HttpResponseMessage> MakeHttpRequestAsync(string url)
{
    using var activity = ActivitySource.StartActivity("http.request", ActivityKind.Client);

    // HTTP semantic conventions
    activity?.SetTag("http.method", "GET");
    activity?.SetTag("http.url", url);
    activity?.SetTag("http.scheme", new Uri(url).Scheme);
    activity?.SetTag("net.peer.name", new Uri(url).Host);
    activity?.SetTag("net.peer.port", new Uri(url).Port);

    var response = await _httpClient.GetAsync(url);

    activity?.SetTag("http.status_code", (int)response.StatusCode);
    activity?.SetTag("http.response.body.size", response.Content.Headers.ContentLength);

    return response;
}
```

### Multiple Attributes at Once

Use `SetTag` for individual attributes or `AddTag` for batch operations:

```csharp
public async Task ProcessBatchAsync(IEnumerable<Item> items)
{
    using var activity = ActivitySource.StartActivity("batch.process");

    var itemList = items.ToList();

    activity?.SetTag("batch.size", itemList.Count);
    activity?.SetTag("batch.type", "items");

    // Process items...

    activity?.SetTag("batch.processed", processedCount);
    activity?.SetTag("batch.failed", failedCount);
}
```

## Events

### Adding Events to Spans

Record significant events during span execution:

```csharp
public async Task<Order> FulfillOrderAsync(int orderId)
{
    using var activity = ActivitySource.StartActivity("order.fulfill");

    activity?.AddEvent(new ActivityEvent("order.fulfillment.started"));

    var order = await _orderRepository.GetByIdAsync(orderId);

    activity?.AddEvent(new ActivityEvent(
        "inventory.checked",
        tags: new ActivityTagsCollection
        {
            { "inventory.available", true },
            { "items.count", order.Items.Count }
        }));

    await ProcessPaymentAsync(order);

    activity?.AddEvent(new ActivityEvent(
        "payment.processed",
        tags: new ActivityTagsCollection
        {
            { "payment.amount", order.Total },
            { "payment.method", order.PaymentMethod }
        }));

    await ShipOrderAsync(order);

    activity?.AddEvent(new ActivityEvent("order.shipped"));

    return order;
}
```

### Timestamped Events

Add events with specific timestamps:

```csharp
public async Task ProcessWithTimestampsAsync()
{
    using var activity = ActivitySource.StartActivity("process.timed");

    var startTime = DateTimeOffset.UtcNow;

    activity?.AddEvent(new ActivityEvent(
        "processing.started",
        startTime));

    await DoWorkAsync();

    var endTime = DateTimeOffset.UtcNow;

    activity?.AddEvent(new ActivityEvent(
        "processing.completed",
        endTime,
        new ActivityTagsCollection
        {
            { "duration.ms", (endTime - startTime).TotalMilliseconds }
        }));
}
```

## Exception Recording

### Recording Exceptions

Record exceptions with full context:

```csharp
public async Task<Article?> UpdateArticleAsync(string slug, int userId, UpdateArticleRequest request)
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

        // Update article...
        await _context.SaveChangesAsync();

        return article;
    }
    catch (Exception ex)
    {
        activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
        activity?.AddException(ex);
        throw;
    }
}
```

### Exception Extension Method

Create a helper for consistent exception recording:

```csharp
public static class ActivityExtensions
{
    public static void RecordException(this Activity? activity, Exception ex, bool setError = true)
    {
        if (activity is null) return;

        if (setError)
        {
            activity.SetStatus(ActivityStatusCode.Error, ex.Message);
        }

        activity.AddException(ex);
    }
}

// Usage
public async Task<Data> FetchDataAsync(int id)
{
    using var activity = ActivitySource.StartActivity("data.fetch");

    try
    {
        return await _repository.GetByIdAsync(id);
    }
    catch (Exception ex)
    {
        activity.RecordException(ex);
        throw;
    }
}
```

### Recording Without Throwing

Record exceptions for logging without rethrowing:

```csharp
public async Task ProcessWithFallbackAsync()
{
    using var activity = ActivitySource.StartActivity("process.fallback");

    try
    {
        await TryPrimaryMethodAsync();
    }
    catch (Exception ex)
    {
        // Record but don't mark as error since we have a fallback
        activity?.AddEvent(new ActivityEvent(
            "primary.failed",
            tags: new ActivityTagsCollection
            {
                { "exception.type", ex.GetType().Name },
                { "exception.message", ex.Message }
            }));

        _logger.LogWarning(ex, "Primary method failed, using fallback");

        await UseFallbackMethodAsync();
    }
}
```

## Metrics

### Setting Up Metrics

Define metrics using `System.Diagnostics.Metrics`:

```csharp title="Telemetry/AppMetrics.cs"
using System.Diagnostics.Metrics;

namespace MyApp.Telemetry;

public static class AppMetrics
{
    private static readonly Meter Meter = new("MyApp.Metrics");

    public static readonly Counter<long> UsersRegistered =
        Meter.CreateCounter<long>(
            "users.registered",
            description: "Total users registered");

    public static readonly Counter<long> ArticlesCreated =
        Meter.CreateCounter<long>(
            "articles.created",
            description: "Total articles created");

    public static readonly Counter<long> OrdersProcessed =
        Meter.CreateCounter<long>(
            "orders.processed",
            description: "Total orders processed");

    public static readonly Histogram<double> RequestDuration =
        Meter.CreateHistogram<double>(
            "http.request.duration",
            unit: "ms",
            description: "HTTP request duration in milliseconds");
}
```

### Counter Metrics

Track counts of events:

```csharp
public async Task<User> RegisterUserAsync(RegisterRequest request)
{
    var user = new User { Email = request.Email, Name = request.Name };

    await _context.Users.AddAsync(user);
    await _context.SaveChangesAsync();

    // Increment counter
    AppMetrics.UsersRegistered.Add(1);

    return user;
}
```

### Counter with Tags

Add dimensions to metrics:

```csharp
public async Task<Order> CreateOrderAsync(CreateOrderRequest request)
{
    var order = await ProcessOrderAsync(request);

    // Counter with tags for dimensions
    AppMetrics.OrdersProcessed.Add(1,
        new KeyValuePair<string, object?>("order.type", request.Type),
        new KeyValuePair<string, object?>("payment.method", request.PaymentMethod));

    return order;
}
```

### Histogram Metrics

Record distributions of values:

```csharp
public async Task<Response> HandleRequestAsync(Request request)
{
    var stopwatch = Stopwatch.StartNew();

    var response = await ProcessRequestAsync(request);

    stopwatch.Stop();

    // Record duration
    AppMetrics.RequestDuration.Record(
        stopwatch.Elapsed.TotalMilliseconds,
        new KeyValuePair<string, object?>("http.route", request.Path),
        new KeyValuePair<string, object?>("http.method", request.Method));

    return response;
}
```

### Observable Gauges

Track current values that are observed periodically:

```csharp
public static class AppMetrics
{
    private static readonly Meter Meter = new("MyApp.Metrics");

    private static int _activeConnections;

    public static readonly ObservableGauge<int> ActiveConnections =
        Meter.CreateObservableGauge(
            "connections.active",
            () => _activeConnections,
            description: "Number of active connections");

    public static void IncrementConnections() => Interlocked.Increment(ref _activeConnections);
    public static void DecrementConnections() => Interlocked.Decrement(ref _activeConnections);
}
```

### Business Metrics

Track domain-specific metrics:

```csharp
public static class BusinessMetrics
{
    private static readonly Meter Meter = new("MyApp.Business");

    public static readonly Counter<long> Revenue =
        Meter.CreateCounter<long>(
            "revenue.total",
            unit: "USD",
            description: "Total revenue in cents");

    public static readonly Histogram<double> OrderValue =
        Meter.CreateHistogram<double>(
            "order.value",
            unit: "USD",
            description: "Order value distribution");

    public static readonly Counter<long> SubscriptionsCreated =
        Meter.CreateCounter<long>(
            "subscriptions.created",
            description: "Total subscriptions created");
}

// Usage
public async Task<Order> CompleteOrderAsync(Order order)
{
    await FinalizeOrderAsync(order);

    BusinessMetrics.Revenue.Add((long)(order.Total * 100));  // Convert to cents
    BusinessMetrics.OrderValue.Record(order.Total);

    return order;
}
```

## Context Propagation

### Propagating Context with HttpClient

Context is automatically propagated when using `HttpClient` with instrumentation:

```csharp
// In Program.cs
builder.Services.AddHttpClient()
    .AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddHttpClientInstrumentation());  // Enables automatic propagation
```

### Manual Context Propagation

For custom propagation scenarios:

```csharp
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
using System.Diagnostics;

public class ContextPropagator
{
    private static readonly TextMapPropagator Propagator = Propagators.DefaultTextMapPropagator;

    public void InjectContext(IDictionary<string, string> carrier)
    {
        Propagator.Inject(
            new PropagationContext(Activity.Current?.Context ?? default, Baggage.Current),
            carrier,
            (c, key, value) => c[key] = value);
    }

    public PropagationContext ExtractContext(IDictionary<string, string> carrier)
    {
        return Propagator.Extract(
            default,
            carrier,
            (c, key) => c.TryGetValue(key, out var value) ? new[] { value } : Array.Empty<string>());
    }
}
```

### Using Baggage

Propagate key-value pairs across service boundaries:

```csharp
using OpenTelemetry;

public async Task<Order> CreateOrderAsync(int userId, CreateOrderRequest request)
{
    using var activity = ActivitySource.StartActivity("order.create");

    // Set baggage for downstream services
    Baggage.SetBaggage("user.id", userId.ToString());
    Baggage.SetBaggage("order.type", request.Type);

    var order = await ProcessOrderAsync(request);

    // Enqueue job - baggage will propagate
    await _jobQueue.EnqueueAsync("notification", new
    {
        OrderId = order.Id,
        Type = "order_created"
    });

    return order;
}

// In downstream service
public async Task HandleJobAsync(Job job)
{
    // Read baggage from upstream
    var userId = Baggage.GetBaggage("user.id");
    var orderType = Baggage.GetBaggage("order.type");

    _logger.LogInformation("Processing job for user {UserId}, order type {OrderType}",
        userId, orderType);
}
```

### Message Queue Propagation

Propagate context through message queues:

```csharp
public class MessagePublisher
{
    private static readonly ActivitySource ActivitySource = new("MyApp.Messaging");
    private static readonly TextMapPropagator Propagator = Propagators.DefaultTextMapPropagator;

    public async Task PublishAsync<T>(string topic, T message)
    {
        using var activity = ActivitySource.StartActivity(
            $"publish {topic}",
            ActivityKind.Producer);

        var headers = new Dictionary<string, string>();

        // Inject trace context into headers
        Propagator.Inject(
            new PropagationContext(activity?.Context ?? default, Baggage.Current),
            headers,
            (c, key, value) => c[key] = value);

        var envelope = new MessageEnvelope<T>
        {
            Body = message,
            Headers = headers
        };

        await _queue.SendAsync(topic, envelope);
    }
}

public class MessageConsumer
{
    private static readonly ActivitySource ActivitySource = new("MyApp.Messaging");
    private static readonly TextMapPropagator Propagator = Propagators.DefaultTextMapPropagator;

    public async Task ConsumeAsync<T>(MessageEnvelope<T> envelope)
    {
        // Extract trace context from headers
        var context = Propagator.Extract(
            default,
            envelope.Headers,
            (c, key) => c.TryGetValue(key, out var value) ? new[] { value } : Array.Empty<string>());

        using var activity = ActivitySource.StartActivity(
            "process message",
            ActivityKind.Consumer,
            context.ActivityContext);

        await ProcessMessageAsync(envelope.Body);
    }
}
```

## Best Practices

### 1. Use Descriptive Activity Names

Follow a consistent naming convention:

```csharp
// Good: domain.action format
ActivitySource.StartActivity("user.create");
ActivitySource.StartActivity("order.process");
ActivitySource.StartActivity("payment.charge");

// Avoid: inconsistent naming
ActivitySource.StartActivity("CreateUser");
ActivitySource.StartActivity("process_order");
```

### 2. Always Check for Null Activities

Activities may be null if not sampled:

```csharp
public async Task<User> GetUserAsync(int id)
{
    using var activity = ActivitySource.StartActivity("user.get");

    activity?.SetTag("user.id", id);  // Safe with null-conditional

    var user = await _repository.GetByIdAsync(id);

    activity?.SetTag("user.found", user is not null);

    return user;
}
```

### 3. Don't Log Sensitive Data

Never include PII or secrets in spans:

```csharp
public async Task<User> AuthenticateAsync(string email, string password)
{
    using var activity = ActivitySource.StartActivity("auth.login");

    // Good: log email (consider if this is PII for your use case)
    activity?.SetTag("user.email", email);

    // Bad: never log passwords or tokens
    // activity?.SetTag("password", password);  // DON'T DO THIS

    var user = await ValidateCredentialsAsync(email, password);

    activity?.SetTag("auth.success", user is not null);

    return user;
}
```

### 4. Use Appropriate Span Kinds

Set the correct span kind for proper visualization:

```csharp
// Server: handling incoming request
ActivitySource.StartActivity("http.request", ActivityKind.Server);

// Client: making outgoing request
ActivitySource.StartActivity("http.call", ActivityKind.Client);

// Producer: publishing to queue
ActivitySource.StartActivity("queue.publish", ActivityKind.Producer);

// Consumer: processing from queue
ActivitySource.StartActivity("queue.process", ActivityKind.Consumer);
```

### 5. Scope ActivitySource Appropriately

Create ActivitySources per logical component:

```csharp
// Good: separate ActivitySources for different concerns
public class UserService
{
    private static readonly ActivitySource Source = new("MyApp.UserService");
}

public class OrderService
{
    private static readonly ActivitySource Source = new("MyApp.OrderService");
}

public class PaymentService
{
    private static readonly ActivitySource Source = new("MyApp.PaymentService");
}
```

## Complete Examples

### Full Service with Custom Instrumentation

```csharp title="Services/ArticleService.cs"
using System.Diagnostics;
using MyApp.Telemetry;

public class ArticleService
{
    private static readonly ActivitySource ActivitySource = new("MyApp.ArticleService");

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

        try
        {
            var article = new Article
            {
                Title = request.Title,
                Body = request.Body,
                AuthorId = userId,
                Slug = GenerateSlug(request.Title)
            };

            _context.Articles.Add(article);
            await _context.SaveChangesAsync();

            activity?.SetTag("article.id", article.Id);
            activity?.SetTag("article.slug", article.Slug);

            AppMetrics.ArticlesCreated.Add(1);

            _logger.LogInformation("Article created: {ArticleId} by user {UserId}",
                article.Id, userId);

            return ToResponse(article);
        }
        catch (Exception ex)
        {
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            activity?.AddException(ex);
            throw;
        }
    }

    public async Task<ArticleResponse?> GetBySlugAsync(string slug)
    {
        using var activity = ActivitySource.StartActivity("article.get");
        activity?.SetTag("article.slug", slug);

        var article = await _context.Articles
            .Include(a => a.Author)
            .FirstOrDefaultAsync(a => a.Slug == slug);

        activity?.SetTag("article.found", article is not null);

        return article is not null ? ToResponse(article) : null;
    }
}
```

### Metrics Setup

```csharp title="Telemetry/AppMetrics.cs"
using System.Diagnostics.Metrics;

namespace MyApp.Telemetry;

public static class AppMetrics
{
    private static readonly Meter Meter = new("MyApp.Metrics");

    public static readonly Counter<long> UsersRegistered =
        Meter.CreateCounter<long>("users.registered",
            description: "Total users registered");

    public static readonly Counter<long> ArticlesCreated =
        Meter.CreateCounter<long>("articles.created",
            description: "Total articles created");

    public static readonly Counter<long> ArticlesUpdated =
        Meter.CreateCounter<long>("articles.updated",
            description: "Total articles updated");

    public static readonly Counter<long> ArticlesDeleted =
        Meter.CreateCounter<long>("articles.deleted",
            description: "Total articles deleted");

    public static readonly Counter<long> JobsEnqueued =
        Meter.CreateCounter<long>("jobs.enqueued",
            description: "Total jobs enqueued");

    public static readonly Counter<long> JobsCompleted =
        Meter.CreateCounter<long>("jobs.completed",
            description: "Total jobs completed");

    public static readonly Counter<long> JobsFailed =
        Meter.CreateCounter<long>("jobs.failed",
            description: "Total jobs failed");

    public static readonly Histogram<double> RequestDuration =
        Meter.CreateHistogram<double>("http.request.duration",
            unit: "ms",
            description: "HTTP request duration");
}
```

## Extracting Trace and Span IDs

Extract trace context for correlation or error responses:

```csharp
public static class TraceContextHelper
{
    public static (string? TraceId, string? SpanId) GetCurrentTraceIds()
    {
        var activity = Activity.Current;

        return (
            activity?.TraceId.ToString(),
            activity?.SpanId.ToString()
        );
    }
}

// Usage in error handling
public class ExceptionMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            var (traceId, spanId) = TraceContextHelper.GetCurrentTraceIds();

            var errorResponse = new
            {
                Error = ex.Message,
                TraceId = traceId,
                SpanId = spanId
            };

            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(errorResponse);
        }
    }
}
```

## Proper Shutdown and Resource Cleanup

Ensure telemetry is properly flushed on shutdown:

```csharp title="Program.cs"
var builder = WebApplication.CreateBuilder(args);

builder.AddTelemetry();

var app = builder.Build();

// Register shutdown handler
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();

lifetime.ApplicationStopping.Register(() =>
{
    // Give time for telemetry to flush
    Thread.Sleep(TimeSpan.FromSeconds(5));
});

app.Run();
```

For more control, use the TracerProvider directly:

```csharp
public class TelemetryService : IHostedService
{
    private readonly TracerProvider _tracerProvider;

    public TelemetryService(TracerProvider tracerProvider)
    {
        _tracerProvider = tracerProvider;
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken)
    {
        // Flush and shutdown
        _tracerProvider.ForceFlush();
        _tracerProvider.Shutdown();
        return Task.CompletedTask;
    }
}
```

## Database Instrumentation Patterns

### Entity Framework Core

EF Core is automatically instrumented. Add custom spans for business operations:

```csharp
public async Task<User> CreateUserWithProfileAsync(CreateUserRequest request)
{
    using var activity = ActivitySource.StartActivity("user.create_with_profile");

    await using var transaction = await _context.Database.BeginTransactionAsync();

    try
    {
        activity?.AddEvent(new ActivityEvent("creating_user"));

        var user = new User { Email = request.Email, Name = request.Name };
        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        activity?.AddEvent(new ActivityEvent("creating_profile"));

        var profile = new UserProfile { UserId = user.Id, Bio = request.Bio };
        _context.UserProfiles.Add(profile);
        await _context.SaveChangesAsync();

        await transaction.CommitAsync();

        activity?.SetTag("user.id", user.Id);

        return user;
    }
    catch (Exception ex)
    {
        await transaction.RollbackAsync();
        activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
        activity?.AddException(ex);
        throw;
    }
}
```

### Raw SQL with SqlClient

For raw SQL operations:

```csharp
public async Task<int> ExecuteCustomQueryAsync(string query, params SqlParameter[] parameters)
{
    using var activity = ActivitySource.StartActivity("db.execute", ActivityKind.Client);

    activity?.SetTag("db.system", "mssql");
    activity?.SetTag("db.statement", query);

    await using var connection = new SqlConnection(_connectionString);
    await connection.OpenAsync();

    await using var command = new SqlCommand(query, connection);
    command.Parameters.AddRange(parameters);

    var result = await command.ExecuteNonQueryAsync();

    activity?.SetTag("db.rows_affected", result);

    return result;
}
```

## References

- [OpenTelemetry .NET Documentation](https://opentelemetry.io/docs/languages/net/)
- [System.Diagnostics.Activity Documentation](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.activity)
- [System.Diagnostics.Metrics Documentation](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.metrics)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [ASP.NET Core Auto-Instrumentation Guide](../auto-instrumentation/dotnet.md)
- [Creating Alerts with LogX](../../../guides/creating-alerts-with-logx.md)
- [Create Your First Dashboard](../../../guides/create-your-first-dashboard.md)
