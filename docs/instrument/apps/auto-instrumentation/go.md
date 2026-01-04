---
title: Go OpenTelemetry Instrumentation - Complete APM Setup Guide | base14 Scout
sidebar_label: Go
sidebar_position: 7
description:
  Go OpenTelemetry instrumentation for Echo, Fiber, Chi frameworks with GORM,
  sqlx, Redis, and background job tracing using base14 Scout.
keywords:
  [
    go opentelemetry instrumentation,
    golang monitoring,
    go apm,
    go distributed tracing,
    golang observability,
    go performance monitoring,
    opentelemetry go,
    golang telemetry,
    echo framework monitoring,
    fiber framework tracing,
    chi router instrumentation,
    gorm instrumentation,
    sqlx tracing,
    go postgres monitoring,
    go redis instrumentation,
    asynq monitoring,
    river queue tracing,
    go http tracing,
    golang middleware instrumentation,
    go context propagation,
    go microservices tracing,
    goroutine tracing,
    go grpc instrumentation,
    golang production monitoring,
    go debugging performance,
    opentelemetry sdk go,
    go database monitoring,
    go background jobs tracing,
    golang async tracing,
    go web server monitoring,
  ]
---

# Go

## Introduction

Implement OpenTelemetry instrumentation for Go applications to enable
comprehensive application performance monitoring (APM), distributed tracing, and
observability across your high-performance web services. This guide shows you
how to instrument popular Go web frameworks including Echo, Fiber, and Chi,
along with database clients (GORM, sqlx), Redis, background job queues (Asynq,
River), and gRPC services using the OpenTelemetry Go SDK.

Go applications benefit from automatic instrumentation of HTTP servers, database
queries, Redis operations, gRPC calls, and message queues. With OpenTelemetry,
you can trace requests through goroutines, monitor context propagation, identify
slow database queries, debug concurrent operations, and track distributed
transactions across microservices with minimal performance overhead.

Whether you're implementing observability for the first time, migrating from
commercial APM solutions like New Relic or Datadog, troubleshooting performance
issues in production, or building high-throughput microservices, this guide
provides production-ready configurations and best practices for Go OpenTelemetry
instrumentation with Base14 Scout.

## Who This Guide Is For

This documentation is designed for:

- **Go developers**: implementing observability and distributed tracing for web
  services and microservices
- **Backend engineers**: deploying Go applications with production monitoring
  requirements and SLO tracking
- **DevOps teams**: standardizing observability across multiple Go services in
  containerized environments
- **Performance engineers**: debugging goroutine bottlenecks, database query
  performance, and concurrent operations
- **Microservices architects**: building observable distributed systems with
  gRPC, message queues, and service meshes

## Prerequisites

Before starting, ensure you have:

- **Go 1.21 or later** (1.22+ recommended for production)
- **Web framework** (Echo, Fiber, Chi, Gin, or standard `net/http`)
- **Scout Collector** configured and accessible
  - See
    [Docker Compose Setup](../../collector-setup/docker-compose-example.md) for
    local development
  - See [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md)
    for production
- Basic understanding of OpenTelemetry concepts (traces, spans, attributes)
- Familiarity with Go context propagation and middleware patterns

### Compatibility Matrix

| Component                        | Minimum Version | Recommended Version |
| -------------------------------- | --------------- | ------------------- |
| Go                               | 1.20            | 1.22+               |
| go.opentelemetry.io/otel         | 1.20.0          | 1.32.0+             |
| go.opentelemetry.io/contrib      | 1.20.0          | 1.32.0+             |
| Echo (labstack/echo)             | 4.10.0          | 4.13.0+             |
| Fiber (gofiber/fiber)            | 2.50.0          | 2.52.0+             |
| Chi (go-chi/chi)                 | 5.0.0           | 5.1.0+              |
| GORM                             | 1.25.0          | 1.25.12+            |
| sqlx (jmoiron/sqlx)              | 1.3.0           | 1.4.0+              |
| Redis (go-redis/redis)           | 9.0.0           | 9.7.0+              |
| Asynq (hibiken/asynq)            | 0.24.0          | 0.24.1+             |
| River (riverqueue/river)         | 0.11.0          | 0.14.0+             |

## Installation

Install the OpenTelemetry SDK and instrumentation packages:

```bash showLineNumbers title="Install OpenTelemetry for Go"
go get go.opentelemetry.io/otel \
  go.opentelemetry.io/otel/sdk \
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp \
  go.opentelemetry.io/otel/sdk/resource \
  go.opentelemetry.io/otel/semconv/v1.26.0
```

Install framework-specific instrumentation:

```bash showLineNumbers title="Install framework instrumentation"
# Echo framework
go get go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho

# Fiber framework
go get go.opentelemetry.io/contrib/instrumentation/github.com/gofiber/fiber/v2/otelfiber

# Chi router (manual middleware)
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp

# GORM
go get go.opentelemetry.io/contrib/instrumentation/gorm.io/gorm/otelgorm

# Database drivers
go get go.opentelemetry.io/contrib/instrumentation/database/sql/otelsql

# Redis
go get go.opentelemetry.io/contrib/instrumentation/github.com/go-redis/redis/v9/otelredis

# gRPC
go get go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc
```

## Configuration

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="centralized" label="Centralized Package (Recommended)" default>
```

Create a dedicated package for OpenTelemetry initialization:

```go showLineNumbers title="internal/tracing/tracing.go"
package tracing

import (
 "context"
 "log"
 "os"
 "time"

 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
 "go.opentelemetry.io/otel/propagation"
 "go.opentelemetry.io/otel/sdk/resource"
 sdktrace "go.opentelemetry.io/otel/sdk/trace"
 semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func InitTracer(serviceName, serviceVersion string) (func(context.Context) error, error) {
 ctx := context.Background()

 // Create OTLP HTTP exporter
 exporter, err := otlptracehttp.New(ctx,
  otlptracehttp.WithEndpoint(getEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4318")),
  otlptracehttp.WithInsecure(), // Use WithTLSClientConfig for production
 )
 if err != nil {
  return nil, err
 }

 // Create resource with service information
 res, err := resource.New(ctx,
  resource.WithAttributes(
   semconv.ServiceName(serviceName),
   semconv.ServiceVersion(serviceVersion),
   semconv.DeploymentEnvironment(getEnv("DEPLOYMENT_ENV", "development")),
  ),
  resource.WithHost(),
  resource.WithOS(),
  resource.WithProcess(),
  resource.WithContainer(),
 )
 if err != nil {
  return nil, err
 }

 // Create tracer provider with batch span processor
 tp := sdktrace.NewTracerProvider(
  sdktrace.WithBatcher(exporter,
   sdktrace.WithMaxQueueSize(2048),
   sdktrace.WithMaxExportBatchSize(512),
   sdktrace.WithBatchTimeout(5*time.Second),
  ),
  sdktrace.WithResource(res),
 )

 // Set global tracer provider
 otel.SetTracerProvider(tp)

 // Set global propagator for context propagation
 otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
  propagation.TraceContext{},
  propagation.Baggage{},
 ))

 log.Println("OpenTelemetry initialized successfully")

 // Return shutdown function
 return tp.Shutdown, nil
}

func getEnv(key, defaultValue string) string {
 if value := os.Getenv(key); value != "" {
  return value
 }
 return defaultValue
}
```

Use in your main application:

```go showLineNumbers title="cmd/server/main.go"
package main

import (
 "context"
 "log"
 "os"
 "os/signal"
 "syscall"
 "time"

 "github.com/labstack/echo/v4"
 "go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"

 "your-module/internal/tracing"
)

func main() {
 // Initialize OpenTelemetry
 shutdown, err := tracing.InitTracer("echo-api", "1.0.0")
 if err != nil {
  log.Fatalf("Failed to initialize tracer: %v", err)
 }
 defer func() {
  ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
  defer cancel()
  if err := shutdown(ctx); err != nil {
   log.Printf("Error shutting down tracer: %v", err)
  }
 }()

 // Create Echo server with tracing middleware
 e := echo.New()
 e.Use(otelecho.Middleware("echo-api"))

 // Define routes
 e.GET("/", handleRoot)
 e.GET("/users/:id", handleGetUser)

 // Start server with graceful shutdown
 go func() {
  if err := e.Start(":8080"); err != nil {
   log.Printf("Server error: %v", err)
  }
 }()

 // Wait for interrupt signal
 quit := make(chan os.Signal, 1)
 signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
 <-quit

 ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
 defer cancel()
 if err := e.Shutdown(ctx); err != nil {
  log.Fatal(err)
 }
}

func handleRoot(c echo.Context) error {
 return c.String(200, "Hello, World!")
}

func handleGetUser(c echo.Context) error {
 return c.JSON(200, map[string]string{"id": c.Param("id")})
}
```

```mdx-code-block
</TabItem>
<TabItem value="env-vars" label="Environment Variables">
```

For containerized deployments:

```bash showLineNumbers title=".env"
# Service identification
OTEL_SERVICE_NAME=go-api
OTEL_SERVICE_VERSION=1.0.0
DEPLOYMENT_ENV=production

# Exporter configuration
OTEL_EXPORTER_OTLP_ENDPOINT=scout-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf

# Resource attributes
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.namespace=backend

# Sampling (optional)
OTEL_TRACES_SAMPLER=parentbased_always_on
```

```mdx-code-block
</TabItem>
<TabItem value="production-tls" label="Production with TLS">
```

```go showLineNumbers title="internal/tracing/production.go"
package tracing

import (
 "context"
 "crypto/tls"

 "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
 sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func InitProductionTracer(serviceName string) (func(context.Context) error, error) {
 ctx := context.Background()

 // Create OTLP exporter with TLS
 exporter, err := otlptracehttp.New(ctx,
  otlptracehttp.WithEndpoint(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")),
  otlptracehttp.WithTLSClientConfig(&tls.Config{
   MinVersion: tls.VersionTLS12,
  }),
  otlptracehttp.WithHeaders(map[string]string{
   "Authorization": "Bearer " + os.Getenv("SCOUT_API_KEY"),
  }),
 )
 if err != nil {
  return nil, err
 }

 // Resource with Kubernetes/container metadata
 res, err := resource.New(ctx,
  resource.WithAttributes(
   semconv.ServiceName(serviceName),
   semconv.ServiceVersion(os.Getenv("SERVICE_VERSION")),
   semconv.DeploymentEnvironment(os.Getenv("DEPLOYMENT_ENV")),
   semconv.ServiceInstanceID(os.Getenv("HOSTNAME")),
   semconv.K8SPodName(os.Getenv("K8S_POD_NAME")),
   semconv.K8SNamespaceName(os.Getenv("K8S_NAMESPACE")),
   semconv.ContainerID(os.Getenv("CONTAINER_ID")),
  ),
  resource.WithHost(),
  resource.WithProcess(),
 )
 if err != nil {
  return nil, err
 }

 tp := sdktrace.NewTracerProvider(
  sdktrace.WithBatcher(exporter,
   sdktrace.WithMaxQueueSize(2048),
   sdktrace.WithMaxExportBatchSize(512),
  ),
  sdktrace.WithResource(res),
  sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
 )

 otel.SetTracerProvider(tp)
 otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
  propagation.TraceContext{},
  propagation.Baggage{},
 ))

 return tp.Shutdown, nil
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Framework-Specific Instrumentation

```mdx-code-block
<Tabs>
<TabItem value="echo" label="Echo" default>
```

### Echo Framework

```go showLineNumbers title="Echo with GORM and Asynq"
package main

import (
 "github.com/labstack/echo/v4"
 "go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho"
 "go.opentelemetry.io/contrib/instrumentation/gorm.io/gorm/otelgorm"
 "gorm.io/driver/postgres"
 "gorm.io/gorm"
)

func main() {
 // Initialize tracing
 shutdown, _ := tracing.InitTracer("echo-api", "1.0.0")
 defer shutdown(context.Background())

 // Setup GORM with OpenTelemetry
 db, err := gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")), &gorm.Config{})
 if err != nil {
  log.Fatal(err)
 }

 // Add GORM OpenTelemetry plugin
 if err := db.Use(otelgorm.NewPlugin()); err != nil {
  log.Fatal(err)
 }

 // Create Echo server
 e := echo.New()

 // Add OpenTelemetry middleware (should be first)
 e.Use(otelecho.Middleware("echo-api"))

 // Routes
 e.GET("/users", func(c echo.Context) error {
  var users []User
  // This query is automatically traced
  if err := db.WithContext(c.Request().Context()).Find(&users).Error; err != nil {
   return err
  }
  return c.JSON(200, users)
 })

 e.GET("/users/:id", func(c echo.Context) error {
  var user User
  // Context propagation maintains trace hierarchy
  if err := db.WithContext(c.Request().Context()).
   First(&user, c.Param("id")).Error; err != nil {
   return err
  }
  return c.JSON(200, user)
 })

 e.Start(":8080")
}

type User struct {
 ID    uint   `gorm:"primaryKey"`
 Name  string
 Email string
}
```

```mdx-code-block
</TabItem>
<TabItem value="fiber" label="Fiber">
```

### Fiber Framework

```go showLineNumbers title="Fiber with sqlx and River"
package main

import (
 "github.com/gofiber/fiber/v2"
 "go.opentelemetry.io/contrib/instrumentation/github.com/gofiber/fiber/v2/otelfiber"
 "go.opentelemetry.io/contrib/instrumentation/database/sql/otelsql"
 "github.com/jmoiron/sqlx"
 _ "github.com/lib/pq"
)

func main() {
 // Initialize tracing
 shutdown, _ := tracing.InitTracer("fiber-api", "1.0.0")
 defer shutdown(context.Background())

 // Setup sqlx with OpenTelemetry
 db, err := otelsql.Open("postgres", os.Getenv("DATABASE_URL"),
  otelsql.WithAttributes(
   semconv.DBSystemPostgreSQL,
  ),
 )
 if err != nil {
  log.Fatal(err)
 }
 defer db.Close()

 // Register stats for monitoring
 if err := otelsql.RegisterDBStatsMetrics(db, otelsql.WithAttributes(
  semconv.DBSystemPostgreSQL,
 )); err != nil {
  log.Fatal(err)
 }

 sqlxDB := sqlx.NewDb(db, "postgres")

 // Create Fiber app
 app := fiber.New()

 // Add OpenTelemetry middleware
 app.Use(otelfiber.Middleware())

 // Routes
 app.Get("/users", func(c *fiber.Ctx) error {
  ctx := c.UserContext()

  var users []User
  // Query is automatically traced
  if err := sqlxDB.SelectContext(ctx, &users, "SELECT * FROM users"); err != nil {
   return err
  }
  return c.JSON(users)
 })

 app.Get("/users/:id", func(c *fiber.Ctx) error {
  ctx := c.UserContext()
  id := c.Params("id")

  var user User
  // Context propagation maintains trace
  if err := sqlxDB.GetContext(ctx, &user,
   "SELECT * FROM users WHERE id = $1", id); err != nil {
   return err
  }
  return c.JSON(user)
 })

 app.Listen(":8080")
}
```

```mdx-code-block
</TabItem>
<TabItem value="chi" label="Chi">
```

### Chi Router

```go showLineNumbers title="Chi with custom middleware"
package main

import (
 "net/http"

 "github.com/go-chi/chi/v5"
 "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
 // Initialize tracing
 shutdown, _ := tracing.InitTracer("chi-api", "1.0.0")
 defer shutdown(context.Background())

 r := chi.NewRouter()

 // Add OpenTelemetry middleware
 r.Use(func(next http.Handler) http.Handler {
  return otelhttp.NewHandler(next, "chi-api")
 })

 r.Get("/", func(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte("Hello, World!"))
 })

 r.Get("/users/{id}", func(w http.ResponseWriter, r *http.Request) {
  userID := chi.URLParam(r, "id")

  // Custom span for business logic
  ctx := r.Context()
  tracer := otel.Tracer("chi-api")
  ctx, span := tracer.Start(ctx, "getUserByID")
  defer span.End()

  span.SetAttributes(attribute.String("user.id", userID))

  // Your business logic here
  w.Write([]byte("User: " + userID))
 })

 http.ListenAndServe(":8080", r)
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Database Instrumentation

```mdx-code-block
<Tabs>
<TabItem value="gorm" label="GORM" default>
```

### GORM (Echo/Gin)

```go showLineNumbers title="GORM with OpenTelemetry plugin"
package database

import (
 "gorm.io/driver/postgres"
 "gorm.io/gorm"
 "go.opentelemetry.io/contrib/instrumentation/gorm.io/gorm/otelgorm"
)

func NewDB(dsn string) (*gorm.DB, error) {
 db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
 if err != nil {
  return nil, err
 }

 // Add OpenTelemetry plugin
 if err := db.Use(otelgorm.NewPlugin(
  otelgorm.WithDBName("myapp"),
  otelgorm.WithAttributes(
   semconv.DBSystemPostgreSQL,
  ),
 )); err != nil {
  return nil, err
 }

 return db, nil
}

// Usage in handler
func GetUsers(c echo.Context) error {
 ctx := c.Request().Context()

 var users []User
 // Automatically traced query
 if err := db.WithContext(ctx).
  Preload("Orders").
  Where("active = ?", true).
  Find(&users).Error; err != nil {
  return err
 }

 return c.JSON(200, users)
}
```

```mdx-code-block
</TabItem>
<TabItem value="sqlx" label="sqlx">
```

### sqlx (Fiber)

```go showLineNumbers title="sqlx with otelsql"
package database

import (
 "database/sql"

 "github.com/jmoiron/sqlx"
 "go.opentelemetry.io/contrib/instrumentation/database/sql/otelsql"
 semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func NewSqlxDB(dsn string) (*sqlx.DB, error) {
 // Register driver with OpenTelemetry
 db, err := otelsql.Open("postgres", dsn,
  otelsql.WithAttributes(semconv.DBSystemPostgreSQL),
  otelsql.WithSpanOptions(otelsql.SpanOptions{
   Ping:                 true,
   RowsNext:             true,
   DisableErrSkip:       true,
   DisableQuery:         false,
   QueryFormatter:       nil,
  }),
 )
 if err != nil {
  return nil, err
 }

 // Register DB stats metrics
 if err := otelsql.RegisterDBStatsMetrics(db,
  otelsql.WithAttributes(semconv.DBSystemPostgreSQL)); err != nil {
  return nil, err
 }

 return sqlx.NewDb(db, "postgres"), nil
}

// Repository pattern with context
type UserRepository struct {
 db *sqlx.DB
}

func (r *UserRepository) GetByID(ctx context.Context, id int) (*User, error) {
 var user User
 // Query is automatically traced
 err := r.db.GetContext(ctx, &user,
  `SELECT id, name, email FROM users WHERE id = $1`, id)
 return &user, err
}

func (r *UserRepository) List(ctx context.Context) ([]User, error) {
 var users []User
 // Automatically traced
 err := r.db.SelectContext(ctx, &users,
  `SELECT id, name, email FROM users ORDER BY created_at DESC`)
 return users, err
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Redis Instrumentation

```go showLineNumbers title="Redis with OpenTelemetry"
package cache

import (
 "context"

 "github.com/redis/go-redis/v9"
 "go.opentelemetry.io/contrib/instrumentation/github.com/redis/go-redis/v9/redisotel"
)

func NewRedisClient(addr string) *redis.Client {
 rdb := redis.NewClient(&redis.Options{
  Addr: addr,
 })

 // Add OpenTelemetry hooks
 if err := redisotel.InstrumentTracing(rdb); err != nil {
  panic(err)
 }

 // Optional: Add metrics
 if err := redisotel.InstrumentMetrics(rdb); err != nil {
  panic(err)
 }

 return rdb
}

// Usage in service
type CacheService struct {
 redis *redis.Client
}

func (s *CacheService) Get(ctx context.Context, key string) (string, error) {
 // Automatically traced
 return s.redis.Get(ctx, key).Result()
}

func (s *CacheService) Set(ctx context.Context, key, value string, ttl time.Duration) error {
 // Automatically traced
 return s.redis.Set(ctx, key, value, ttl).Err()
}
```

## Background Jobs

### Asynq (Task Queue)

```go showLineNumbers title="Asynq with tracing"
package jobs

import (
 "context"
 "encoding/json"

 "github.com/hibiken/asynq"
 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/attribute"
 "go.opentelemetry.io/otel/trace"
)

const TypeEmailDelivery = "email:delivery"

type EmailPayload struct {
 UserID int
 Email  string
}

// Task creation with trace context
func NewEmailDeliveryTask(ctx context.Context, userID int, email string) (*asynq.Task, error) {
 tracer := otel.Tracer("asynq-tasks")
 _, span := tracer.Start(ctx, "CreateEmailTask")
 defer span.End()

 payload, err := json.Marshal(EmailPayload{
  UserID: userID,
  Email:  email,
 })
 if err != nil {
  span.RecordError(err)
  return nil, err
 }

 span.SetAttributes(
  attribute.Int("user.id", userID),
  attribute.String("task.type", TypeEmailDelivery),
 )

 return asynq.NewTask(TypeEmailDelivery, payload), nil
}

// Handler with tracing
func HandleEmailDeliveryTask(ctx context.Context, t *asynq.Task) error {
 tracer := otel.Tracer("asynq-handler")
 ctx, span := tracer.Start(ctx, "HandleEmailDelivery")
 defer span.End()

 var p EmailPayload
 if err := json.Unmarshal(t.Payload(), &p); err != nil {
  span.RecordError(err)
  return err
 }

 span.SetAttributes(
  attribute.Int("user.id", p.UserID),
  attribute.String("email", p.Email),
 )

 // Send email
 if err := sendEmail(ctx, p.Email); err != nil {
  span.RecordError(err)
  return err
 }

 return nil
}

func sendEmail(ctx context.Context, email string) error {
 tracer := otel.Tracer("email-sender")
 _, span := tracer.Start(ctx, "sendEmail")
 defer span.End()

 // Email sending logic
 span.SetAttributes(attribute.String("email.to", email))

 return nil
}
```

### River (PostgreSQL-native queue)

```go showLineNumbers title="River with tracing"
package jobs

import (
 "context"

 "github.com/riverqueue/river"
 "go.opentelemetry.io/otel"
)

type EmailArgs struct {
 UserID int
 Email  string
}

func (EmailArgs) Kind() string { return "email" }

type EmailWorker struct {
 river.WorkerDefaults[EmailArgs]
}

func (w *EmailWorker) Work(ctx context.Context, job *river.Job[EmailArgs]) error {
 tracer := otel.Tracer("river-worker")
 ctx, span := tracer.Start(ctx, "EmailWorker.Work")
 defer span.End()

 span.SetAttributes(
  attribute.Int("user.id", job.Args.UserID),
  attribute.String("job.kind", job.Kind),
  attribute.Int("job.attempt", job.Attempt),
 )

 // Process email
 if err := processEmail(ctx, job.Args); err != nil {
  span.RecordError(err)
  return err
 }

 return nil
}
```

## Custom Instrumentation

For business logic and application-specific operations:

```go showLineNumbers title="services/order_service.go"
package services

import (
 "context"

 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/attribute"
 "go.opentelemetry.io/otel/codes"
 "go.opentelemetry.io/otel/trace"
)

type OrderService struct {
 db    *gorm.DB
 cache *redis.Client
}

func (s *OrderService) CreateOrder(ctx context.Context, userID int, items []OrderItem) (*Order, error) {
 tracer := otel.Tracer("order-service")
 ctx, span := tracer.Start(ctx, "OrderService.CreateOrder")
 defer span.End()

 span.SetAttributes(
  attribute.Int("user.id", userID),
  attribute.Int("items.count", len(items)),
 )

 // Validate inventory
 ctx, validateSpan := tracer.Start(ctx, "validateInventory")
 available, err := s.checkInventory(ctx, items)
 if err != nil {
  validateSpan.RecordError(err)
  validateSpan.SetStatus(codes.Error, "inventory check failed")
  validateSpan.End()
  return nil, err
 }
 validateSpan.SetAttributes(attribute.Bool("inventory.available", available))
 validateSpan.End()

 if !available {
  span.SetStatus(codes.Error, "insufficient inventory")
  return nil, ErrInsufficientInventory
 }

 // Create order
 ctx, createSpan := tracer.Start(ctx, "createOrderRecord")
 order := &Order{
  UserID: userID,
  Items:  items,
  Total:  calculateTotal(items),
 }

 if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
  createSpan.RecordError(err)
  createSpan.SetStatus(codes.Error, "database error")
  createSpan.End()
  return nil, err
 }
 createSpan.SetAttributes(attribute.Int("order.id", int(order.ID)))
 createSpan.End()

 // Process payment
 ctx, paymentSpan := tracer.Start(ctx, "processPayment")
 if err := s.processPayment(ctx, order.ID, order.Total); err != nil {
  paymentSpan.RecordError(err)
  paymentSpan.SetStatus(codes.Error, "payment failed")
  paymentSpan.End()
  return nil, err
 }
 paymentSpan.End()

 span.SetStatus(codes.Ok, "order created successfully")
 return order, nil
}

func (s *OrderService) checkInventory(ctx context.Context, items []OrderItem) (bool, error) {
 // Business logic
 return true, nil
}

func (s *OrderService) processPayment(ctx context.Context, orderID uint, amount float64) error {
 tracer := otel.Tracer("payment-service")
 _, span := tracer.Start(ctx, "processPayment")
 defer span.End()

 span.SetAttributes(
  attribute.Int("order.id", int(orderID)),
  attribute.Float64("payment.amount", amount),
 )

 // Payment processing logic
 return nil
}

func calculateTotal(items []OrderItem) float64 {
 var total float64
 for _, item := range items {
  total += item.Price * float64(item.Quantity)
 }
 return total
}
```

## Running Your Application

### Development Mode

```bash showLineNumbers
# With environment variables
export OTEL_EXPORTER_OTLP_ENDPOINT=localhost:4318
export DEPLOYMENT_ENV=development

go run cmd/server/main.go
```

### Production Mode

```bash showLineNumbers
# Build optimized binary
go build -ldflags="-s -w" -o server cmd/server/main.go

# Run with production config
export OTEL_SERVICE_NAME=go-api
export OTEL_EXPORTER_OTLP_ENDPOINT=scout-collector:4318
export DEPLOYMENT_ENV=production

./server
```

### Docker Deployment

```dockerfile showLineNumbers title="Dockerfile"
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server cmd/server/main.go

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/server .

ENV OTEL_SERVICE_NAME=go-api
ENV DEPLOYMENT_ENV=production

EXPOSE 8080

CMD ["./server"]
```

```yaml showLineNumbers title="docker-compose.yml"
version: '3.8'

services:
  go-api:
    build: .
    ports:
      - '8080:8080'
    environment:
      - OTEL_SERVICE_NAME=go-api
      - OTEL_SERVICE_VERSION=1.0.0
      - OTEL_EXPORTER_OTLP_ENDPOINT=scout-collector:4318
      - DATABASE_URL=postgres://user:pass@postgres:5432/godb
      - REDIS_URL=redis:6379
    depends_on:
      - postgres
      - redis
      - scout-collector

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: godb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass

  redis:
    image: redis:7-alpine

  scout-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector-config.yaml']
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - '4318:4318'
```

## Troubleshooting

### Issue: No Traces Appearing in Scout

**Solutions:**

1. Verify collector connectivity:

```go
// Test exporter connection
exporter, err := otlptracehttp.New(context.Background(),
 otlptracehttp.WithEndpoint("localhost:4318"),
 otlptracehttp.WithInsecure(),
)
if err != nil {
 log.Fatal("Failed to create exporter:", err)
}
```

1. Enable debug logging:

```go
import "go.opentelemetry.io/otel/exporters/stdout/stdouttrace"

// Use console exporter for debugging
exporter, _ := stdouttrace.New(stdouttrace.WithPrettyPrint())
```

1. Verify tracer provider is set:

```go
if otel.GetTracerProvider() == nil {
 log.Fatal("Tracer provider not initialized")
}
```

### Issue: Missing Context in Goroutines

**Solutions:**

Always pass context to goroutines:

```go
// WRONG - loses trace context
go func() {
 span := trace.SpanFromContext(context.Background()) // nil!
}()

// CORRECT - preserve context
go func(ctx context.Context) {
 span := trace.SpanFromContext(ctx) // Works!
}(ctx)
```

### Issue: Database Queries Not Traced

**Solutions:**

1. Ensure you're using `WithContext`:

```go
// WRONG - no context
db.Find(&users)

// CORRECT - with context
db.WithContext(ctx).Find(&users)
```

1. For sqlx, use `Context` methods:

```go
// WRONG
db.Select(&users, query)

// CORRECT
db.SelectContext(ctx, &users, query)
```

### Issue: High Memory Usage

**Solutions:**

Reduce batch sizes and queue limits:

```go
sdktrace.WithBatcher(exporter,
 sdktrace.WithMaxQueueSize(1024), // Reduced
 sdktrace.WithMaxExportBatchSize(256), // Reduced
)
```

## Performance Considerations

OpenTelemetry adds minimal overhead to Go applications:

**Expected Impact:**

- **Latency**: +0.1-0.5ms per request
- **CPU**: +1-3% in production
- **Memory**: +5-15MB for trace buffers
- **Goroutines**: +2-3 additional goroutines for exporter

### Optimization Best Practices

#### 1. Use Batch Span Processor

```go showLineNumbers
tp := sdktrace.NewTracerProvider(
 sdktrace.WithBatcher(exporter,
  sdktrace.WithMaxQueueSize(2048),
  sdktrace.WithBatchTimeout(5*time.Second),
 ),
)
```

#### 2. Skip Health Check Endpoints

```go showLineNumbers
app.Use(func(next http.Handler) http.Handler {
 return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  // Skip tracing for health checks
  if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
   next.ServeHTTP(w, r)
   return
  }
  otelhttp.NewHandler(next, "api").ServeHTTP(w, r)
 })
})
```

#### 3. Disable Query Parameter Logging

```go showLineNumbers
otelsql.Open("postgres", dsn,
 otelsql.WithSpanOptions(otelsql.SpanOptions{
  DisableQuery: true, // Don't log full queries
 }),
)
```

#### 5. Reuse HTTP Clients

```go showLineNumbers
// Create once, reuse
var httpClient = &http.Client{
 Transport: otelhttp.NewTransport(http.DefaultTransport),
}
```

## Security Considerations

### Sensitive Data Protection

```go showLineNumbers
// BAD - Exposes sensitive data
span.SetAttributes(
 attribute.String("user.password", password),
 attribute.String("credit_card", ccNumber),
)

// GOOD - Use safe identifiers
span.SetAttributes(
 attribute.Int("user.id", userID),
 attribute.String("payment.method", "credit_card"),
)
```

### SQL Query Sanitization

```go showLineNumbers
// Parameters are automatically sanitized by otelsql
db.SelectContext(ctx, &users,
 "SELECT * FROM users WHERE email = $1", email) // Safe
```

## FAQ

### Does OpenTelemetry work with all Go web frameworks?

Yes, OpenTelemetry supports Echo, Fiber, Chi, Gin, and standard `net/http`
through various instrumentation packages.

### What's the performance impact on Go applications?

Minimal: +0.1-0.5ms latency, +1-3% CPU, +5-15MB memory. Go's efficient
goroutines make OpenTelemetry very lightweight.

### Can I trace GORM, sqlx, and standard database/sql?

Yes, use `otelgorm` for GORM, `otelsql` for sqlx and database/sql. All SQL
queries are automatically traced.

### How do I trace goroutines?

Pass context to goroutines: `go func(ctx context.Context) { ... }(ctx)` to
maintain trace hierarchy.

### Does it work with gRPC?

Yes, use `go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc`
for automatic gRPC tracing.

### Can I trace Asynq and River background jobs?

Yes, add custom spans in task handlers using `otel.Tracer()` as shown in the
Background Jobs section.

### How do I handle context propagation across services?

OpenTelemetry automatically propagates context via HTTP headers using W3C Trace
Context and Baggage.

### What's the difference between traces and metrics?

Traces show request flow through your app. Metrics aggregate performance data.
Both are supported by OpenTelemetry.

## What's Next?

### Framework-Specific Examples

- [Echo Example](https://github.com/base-14/examples/tree/main/go/echo-postgres)
  \- Echo + GORM + Asynq
- [Fiber Example](https://github.com/base-14/examples/tree/main/go/fiber-postgres)
  \- Fiber + sqlx + River
- [Chi Example](https://github.com/base-14/examples/tree/main/go/chi-inmemory)
  \- Chi + in-memory

### Advanced Topics

- [Custom Go Instrumentation](../custom-instrumentation/go.md) - Advanced
  patterns and custom exporters

### Scout Platform Features

- [Creating Alerts](../../../guides/creating-alerts-with-logx.md) - Set up
  alerts for latency and errors
- [Dashboard Creation](../../../guides/create-your-first-dashboard.md) - Build
  custom dashboards

### Deployment and Operations

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development environment
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Production deployment

## Complete Example

```bash showLineNumbers title="go.mod"
module github.com/example/go-api

go 1.22

require (
 github.com/labstack/echo/v4 v4.13.0
 go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho v0.54.0
 go.opentelemetry.io/contrib/instrumentation/gorm.io/gorm/otelgorm v0.54.0
 go.opentelemetry.io/otel v1.32.0
 go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.32.0
 go.opentelemetry.io/otel/sdk v1.32.0
 gorm.io/driver/postgres v1.5.12
 gorm.io/gorm v1.25.12
)
```

Complete working examples:
[GitHub: base-14/examples/go](https://github.com/base-14/examples/tree/main/go)

## References

- [Official OpenTelemetry Go Documentation](https://opentelemetry.io/docs/languages/go/)
- [OpenTelemetry Go SDK](https://pkg.go.dev/go.opentelemetry.io/otel)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)

## Related Guides

- [Custom Go Instrumentation](../custom-instrumentation/go.md) - Advanced manual
  instrumentation
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) -
  Local development
- [Kubernetes Deployment](../../collector-setup/kubernetes-helm-setup.md) -
  Production setup
