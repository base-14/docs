---
title: Go stdlib OpenTelemetry Instrumentation - net/http + pgx
sidebar_label: Go stdlib + Postgres
sidebar_position: 23.5
description:
  Instrument Go net/http with OpenTelemetry. Trace pgx queries, propagate W3C
  traceparent across services, and run distroless containers.
keywords:
  [
    go stdlib opentelemetry instrumentation,
    go net/http tracing,
    pgx opentelemetry,
    otelpgx tracer,
    otelhttp transport,
    go postgres tracing,
    golang database tracing,
    go distroless container,
    go slog otel bridge,
    otelslog bridge,
    go context propagation,
    w3c traceparent go,
    go microservices tracing,
    pgxpool opentelemetry,
    opentelemetry sdk go,
    go observability postgres,
    go trace log correlation,
    go http client tracing,
    base14 scout go,
    go production monitoring,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why use net/http instead of a Go web framework with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Go 1.22 added pattern-based routing (e.g. 'GET /api/articles/{id}') to net/http, removing the main reason most teams reached for Echo, Fiber, or Chi. Wrapping ServeMux with otelhttp.NewHandler gives you full server-span coverage with zero framework dependency."}},{"@type":"Question","name":"How do I trace pgx queries with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Set cfg.ConnConfig.Tracer = otelpgx.NewTracer() before pgxpool.NewWithConfig. Every query, prepare, and pool acquire becomes a span attached to the parent HTTP server span via context."}},{"@type":"Question","name":"How much overhead does OpenTelemetry add to a Go net/http service?","acceptedAnswer":{"@type":"Answer","text":"Roughly 0.1-0.3 ms added latency per request, 1-3% CPU at 1k RPS, and 8-15 MB extra resident memory for the SDK. Postgres queries gain about 50-150 microseconds from the otelpgx tracer."}},{"@type":"Question","name":"Does W3C traceparent propagate automatically between Go services?","acceptedAnswer":{"@type":"Answer","text":"Yes, when both client and server use otelhttp. Wrap the outbound http.Client with otelhttp.NewTransport on the caller and otelhttp.NewHandler on the receiver. The traceparent header is injected and parsed automatically when you set propagation.TraceContext as the global propagator."}},{"@type":"Question","name":"How do I correlate Go slog logs with traces?","acceptedAnswer":{"@type":"Answer","text":"Use the go.opentelemetry.io/contrib/bridges/otelslog package to forward records to the OTel logs pipeline, and a small custom slog.Handler that reads trace.SpanFromContext(ctx) to add trace_id and span_id to every record before the JSON encoder runs."}},{"@type":"Question","name":"Can I run OpenTelemetry-instrumented Go binaries on distroless images?","acceptedAnswer":{"@type":"Answer","text":"Yes. The OTel Go SDK is pure Go, so a CGO_ENABLED=0 static build runs on gcr.io/distroless/static-debian12:nonroot with no extra packages. The example app and notify service both use this image."}},{"@type":"Question","name":"What is the difference between otelhttp.NewHandler and otelhttp.NewMiddleware?","acceptedAnswer":{"@type":"Answer","text":"NewHandler wraps an entire http.Handler (typically ServeMux) and produces one server span per request. NewMiddleware returns a middleware function for routers that compose middleware explicitly. For stdlib net/http, NewHandler is the canonical entry point."}},{"@type":"Question","name":"How do I expose the trace ID to API consumers in Go?","acceptedAnswer":{"@type":"Answer","text":"Read trace.SpanFromContext(ctx).SpanContext().TraceID().String() inside the handler and embed it in the response body (for example in a meta envelope). This lets clients quote the trace ID in support tickets so you can pull the full trace in Scout."}},{"@type":"Question","name":"Do I need a Go agent or auto-instrumentation binary?","acceptedAnswer":{"@type":"Answer","text":"No. Unlike Java or Python, Go instrumentation is library-based - you import otelhttp, otelpgx, and otelslog and call them explicitly. There is no java -javaagent equivalent for production Go binaries."}},{"@type":"Question","name":"How do I disable noisy spans like pgx pool.acquire?","acceptedAnswer":{"@type":"Answer","text":"Drop them at the collector with a filter processor on the traces pipeline. The example config filters span names matching '.*health.*' and pool.acquire/connect spans from otelpgx so the trace UI stays focused on real query work."}},{"@type":"Question","name":"Can I use OpenTelemetry with database/sql instead of pgx?","acceptedAnswer":{"@type":"Answer","text":"Yes - swap otelpgx for otelsql (github.com/XSAM/otelsql) and wrap your sql.DB driver. The rest of the setup (otelhttp, otelslog, exporters) is identical. The example uses pgx because pgxpool is the most widely-used native Postgres driver for Go."}},{"@type":"Question","name":"How do I stop sending dev OTLP traffic over the public internet?","acceptedAnswer":{"@type":"Answer","text":"Run the OTel collector locally in Docker Compose and point OTEL_EXPORTER_OTLP_ENDPOINT at it (http://otel-collector:4318). The collector authenticates to Scout with oauth2client and forwards over TLS."}}]}
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"HowTo","name":"Instrument a Go stdlib net/http + Postgres service with OpenTelemetry","step":[{"@type":"HowToStep","name":"Add OTel dependencies","text":"go get go.opentelemetry.io/otel, the OTLP HTTP exporters, otelhttp, otelpgx, and the otelslog bridge."},{"@type":"HowToStep","name":"Initialize tracer, meter, and logger providers","text":"Build a resource with semconv.ServiceName, create OTLP HTTP exporters, set the global TracerProvider, MeterProvider, and LoggerProvider, and install propagation.TraceContext."},{"@type":"HowToStep","name":"Wrap the ServeMux and pgx pool","text":"Wrap http.ServeMux with otelhttp.NewHandler and set cfg.ConnConfig.Tracer = otelpgx.NewTracer() before pgxpool.NewWithConfig."},{"@type":"HowToStep","name":"Bridge slog to the OTel logs pipeline","text":"Wrap a JSON slog.Handler with a custom traceContextHandler and combine it with otelslog.NewHandler so every record carries trace_id and span_id."},{"@type":"HowToStep","name":"Run with Docker Compose","text":"Bring up the app, notify, Postgres, and OTel collector with docker compose up -d --build, then run scripts/test-api.sh to verify traces, logs, and metrics."}]}
---

# Go stdlib + Postgres

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
```

## Introduction

This guide instruments a Go service that uses only the **standard library
`net/http`**, the `pgx/v5` Postgres driver, and the OpenTelemetry Go SDK -
no Echo, Fiber, Chi, or Gin involved. Go 1.22 added pattern-based routing
(`GET /api/articles/{id}`) directly to `http.ServeMux`, which removed the
main reason most teams pulled in a third-party router. The result is a
production service with full server, client, and database tracing and zero
framework dependency.

Three OpenTelemetry contrib packages do most of the work. `otelhttp` wraps
the mux to emit server spans on every inbound request and instruments
outbound `http.Client` calls so W3C `traceparent` headers propagate
automatically across services. `otelpgx` plugs into the pgx pool config to
emit `pool.acquire`, `prepare`, and `query` spans on every database call.
`otelslog` bridges Go's `log/slog` into the OTel logs pipeline so structured
JSON logs flow to the same collector as your traces and metrics.

If you already export traces to Datadog, New Relic, or Honeycomb, the same
SDK setup works for Base14 Scout - swap the OTLP endpoint, wire up the
collector's `oauth2client` extension for Scout's bearer token, and the rest
of the code is identical. This guide covers prerequisites, installation,
configuration, production hardening, custom instrumentation, troubleshooting,
security, performance, and a complete worked example based on
`~/dev/base14/examples/go/stdlib-postgres/`.

:::tip TL;DR

Wrap `http.ServeMux` with `otelhttp.NewHandler`, set
`cfg.ConnConfig.Tracer = otelpgx.NewTracer()` on the pgxpool config, and
install `propagation.TraceContext` as the global propagator. Initialize a
`TracerProvider`, `MeterProvider`, and `LoggerProvider` once in `main`,
defer their `Shutdown` calls, and point `OTEL_EXPORTER_OTLP_ENDPOINT` at
your collector. You now have HTTP, database, and log telemetry without any
framework dependency.

:::

## Who This Guide Is For

This documentation is designed for:

- **Go developers** building services on `net/http` 1.22+ who want full
  HTTP, database, and log telemetry without adopting Echo, Fiber, or Chi.
- **Backend engineers** running Go services on Postgres via `pgx`, including
  teams migrating from `database/sql` + ORMs to native pgx for connection
  pooling and `LISTEN`/`NOTIFY`.
- **Platform engineers** standardizing OTel across mixed-framework Go
  fleets where the lowest common denominator is the standard library.
- **DevOps and SRE teams** deploying distroless Go binaries to Kubernetes
  and needing trace/log correlation that survives without shells, package
  managers, or runtime dependencies in the container.
- **Developers migrating from Datadog, New Relic, or Dynatrace** APM
  agents to vendor-neutral OpenTelemetry on Base14 Scout.

## Overview

### Prerequisites

Before starting, ensure you have:

- **Go 1.22 or later** for `ServeMux` pattern routing (`GET /api/x/{id}`).
  Go 1.26+ recommended for the latest runtime metrics integration.
- **PostgreSQL 14 or later**. The example uses Postgres 18.
- **Docker and Docker Compose v2** for local multi-service testing.
- **OpenTelemetry Collector** (Contrib distribution) running locally or
  remotely. The example bundles `otel/opentelemetry-collector-contrib:0.149.0`.
- **Base14 Scout credentials** (`SCOUT_ENDPOINT`, `SCOUT_CLIENT_ID`,
  `SCOUT_CLIENT_SECRET`, `SCOUT_TOKEN_URL`) if you want to forward telemetry
  to Scout. Skip these for local-only development.

### Compatibility Matrix

| Component                  | Version           | Notes                                              |
| -------------------------- | ----------------- | -------------------------------------------------- |
| Go                         | 1.22+             | 1.22 required for mux pattern routing              |
| Go (recommended)           | 1.26              | Used by the reference example                      |
| pgx                        | v5.9+             | `pgxpool` for connection pooling                   |
| PostgreSQL                 | 14, 15, 16, 17, 18 | Tested on 18                                       |
| otelhttp                   | v0.68+            | Server handler + client transport                  |
| otelpgx                    | v0.10+            | pgx tracer plugin                                  |
| otelslog bridge            | v0.18+            | `log/slog` → OTel logs pipeline                    |
| OTel Go SDK                | v1.43+            | `go.opentelemetry.io/otel`                         |
| OTel logs SDK              | v0.19+            | `sdk/log`, `exporters/otlp/otlplog/otlploghttp`    |
| OpenTelemetry Collector    | 0.149+            | Contrib build (oauth2client extension)             |
| Distroless base image      | static-debian12   | `gcr.io/distroless/static-debian12:nonroot`        |

### Instrumented Components

| Component               | What's Captured                                                       |
| ----------------------- | --------------------------------------------------------------------- |
| `http.ServeMux` (server)| Server span per request, route pattern, status code, latency          |
| `http.Client` (outbound)| Client span per request, traceparent injection, propagated context    |
| pgx connection pool     | `pool.acquire`, `pool.connect`, `prepare`, `query` spans              |
| Postgres queries        | SQL statement (parameterized), rows affected, duration                |
| `log/slog`              | OTLP log records with trace_id/span_id, severity, body, attributes    |
| Outbound traceparent    | W3C `traceparent` header on every otelhttp-instrumented request       |
| Custom metric           | `articles.created` Int64Counter, exported every 60 s                  |
| Process resource attrs  | `process.runtime.name=go`, `process.pid`, telemetry SDK info          |

The complete reference application lives in
[`~/dev/base14/examples/go/stdlib-postgres/`](https://github.com/base-14/examples/tree/main/go/stdlib-postgres)
and ships an articles API on port 8080 plus a notify service on port 8081.
Both export OTLP/HTTP to a collector, which forwards to Scout over TLS with
an OAuth2 client-credentials flow.

## Installation

The Go SDK is a set of Go modules - there is no agent or pre-shipped binary.
Add them to `go.mod` and the rest is library code.

```mdx-code-block
<Tabs>
<TabItem value="gomod" label="go get (Recommended)" default>
```

```bash
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/sdk/metric \
       go.opentelemetry.io/otel/sdk/log \
       go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp \
       go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp \
       go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp \
       go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp \
       go.opentelemetry.io/contrib/bridges/otelslog \
       github.com/exaring/otelpgx \
       github.com/jackc/pgx/v5
```

```mdx-code-block
</TabItem>
<TabItem value="vendored" label="Vendored go.mod">
```

```go title="app/go.mod" showLineNumbers
module stdlib-articles

go 1.26.1

require (
 github.com/exaring/otelpgx v0.10.0
 github.com/jackc/pgx/v5 v5.9.2
 go.opentelemetry.io/contrib/bridges/otelslog v0.18.0
 go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.68.0
 go.opentelemetry.io/otel v1.43.0
 go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.19.0
 go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.43.0
 go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.43.0
 go.opentelemetry.io/otel/log v0.19.0
 go.opentelemetry.io/otel/metric v1.43.0
 go.opentelemetry.io/otel/sdk v1.43.0
 go.opentelemetry.io/otel/sdk/log v0.19.0
 go.opentelemetry.io/otel/sdk/metric v1.43.0
 go.opentelemetry.io/otel/trace v1.43.0
)
```

After updating `go.mod`, run `go mod tidy && go mod download`.

```mdx-code-block
</TabItem>
<TabItem value="docker" label="Docker multi-stage">
```

```dockerfile title="app/Dockerfile" showLineNumbers
FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/app /app/app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/app"]
```

`CGO_ENABLED=0` produces a static binary that runs on the distroless
`static-debian12:nonroot` image - no glibc, no shell, no package manager.
The OTel Go SDK is pure Go, so no extra packages or runtime dependencies
are needed.

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration

The SDK reads OTLP endpoint, service name, and resource attributes from
environment variables. Three places they typically come from: shell exports
for local runs, Docker Compose for end-to-end testing, and an explicit
`resource.New` call inside `initTelemetry` for code-controlled defaults.

```mdx-code-block
<Tabs>
<TabItem value="env" label="Env Vars (Recommended)" default>
```

```bash title=".env.example" showLineNumbers
# Local development
APP_PORT=8080
DATABASE_URL=postgres://postgres:postgres@db:5432/stdlib_articles?sslmode=disable
NOTIFY_URL=http://notify:8081/notify

# OpenTelemetry SDK
OTEL_SERVICE_NAME=stdlib-articles
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development,service.namespace=examples

# Scout (only needed in the collector environment)
SCOUT_ENDPOINT=https://your-scout-endpoint
SCOUT_CLIENT_ID=your-client-id
SCOUT_CLIENT_SECRET=your-client-secret
SCOUT_TOKEN_URL=https://your-token-url
SCOUT_ENVIRONMENT=development
```

`OTEL_SERVICE_NAME` lands in the `service.name` resource attribute, which
Scout uses to group spans, logs, and metrics into a single service view.
`OTEL_RESOURCE_ATTRIBUTES` accepts comma-separated `key=value` pairs and
augments whatever you set in code.

```mdx-code-block
</TabItem>
<TabItem value="compose" label="Docker Compose">
```

```yaml title="compose.yml" showLineNumbers
services:
  app:
    build: ./app
    ports:
      - "8080:8080"
    environment:
      APP_PORT: "8080"
      DATABASE_URL: postgres://postgres:postgres@db:5432/stdlib_articles?sslmode=disable
      NOTIFY_URL: http://notify:8081/notify
      OTEL_SERVICE_NAME: stdlib-articles
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      db:
        condition: service_healthy
      otel-collector:
        condition: service_started

  notify:
    build: ./notify
    ports:
      - "8081:8081"
    environment:
      NOTIFY_PORT: "8081"
      OTEL_SERVICE_NAME: stdlib-notify
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_RESOURCE_ATTRIBUTES: deployment.environment=${SCOUT_ENVIRONMENT:-development},service.namespace=examples
    depends_on:
      otel-collector:
        condition: service_started
```

The Compose file pins `OTEL_EXPORTER_OTLP_ENDPOINT` to the Docker DNS name
of the collector service. No host networking, no `host.docker.internal`
games, and no host-side OTLP listener required.

```mdx-code-block
</TabItem>
<TabItem value="incode" label="In Code">
```

```go title="app/telemetry.go" showLineNumbers
package main

import (
 "context"
 "fmt"
 "strings"
 "time"

 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
 "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
 "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
 "go.opentelemetry.io/otel/log/global"
 "go.opentelemetry.io/otel/propagation"
 sdklog "go.opentelemetry.io/otel/sdk/log"
 sdkmetric "go.opentelemetry.io/otel/sdk/metric"
 "go.opentelemetry.io/otel/sdk/resource"
 sdktrace "go.opentelemetry.io/otel/sdk/trace"
 semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

type shutdownFunc func(context.Context) error

func initTelemetry(ctx context.Context, serviceName, endpoint string) (shutdownFunc, error) {
 res, err := resource.New(ctx,
  resource.WithFromEnv(),
  resource.WithProcess(),
  resource.WithTelemetrySDK(),
  resource.WithAttributes(
   semconv.ServiceName(serviceName),
   semconv.ServiceVersion("1.0.0"),
  ),
 )
 if err != nil {
  return nil, fmt.Errorf("resource: %w", err)
 }

 traceExp, err := otlptracehttp.New(ctx,
  otlptracehttp.WithEndpoint(stripScheme(endpoint)),
  otlptracehttp.WithInsecure(),
 )
 if err != nil {
  return nil, fmt.Errorf("trace exporter: %w", err)
 }
 tp := sdktrace.NewTracerProvider(
  sdktrace.WithBatcher(traceExp),
  sdktrace.WithResource(res),
  sdktrace.WithSampler(sdktrace.AlwaysSample()),
 )

 metricExp, err := otlpmetrichttp.New(ctx,
  otlpmetrichttp.WithEndpoint(stripScheme(endpoint)),
  otlpmetrichttp.WithInsecure(),
 )
 if err != nil {
  return nil, fmt.Errorf("metric exporter: %w", err)
 }
 mp := sdkmetric.NewMeterProvider(
  sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp,
   sdkmetric.WithInterval(60*time.Second))),
  sdkmetric.WithResource(res),
 )

 logExp, err := otlploghttp.New(ctx,
  otlploghttp.WithEndpoint(stripScheme(endpoint)),
  otlploghttp.WithInsecure(),
 )
 if err != nil {
  return nil, fmt.Errorf("log exporter: %w", err)
 }
 lp := sdklog.NewLoggerProvider(
  sdklog.WithResource(res),
  sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
 )

 otel.SetTracerProvider(tp)
 otel.SetMeterProvider(mp)
 global.SetLoggerProvider(lp)
 otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
  propagation.TraceContext{},
  propagation.Baggage{},
 ))

 return func(ctx context.Context) error {
  var errs []error
  if err := tp.Shutdown(ctx); err != nil {
   errs = append(errs, err)
  }
  if err := mp.Shutdown(ctx); err != nil {
   errs = append(errs, err)
  }
  if err := lp.Shutdown(ctx); err != nil {
   errs = append(errs, err)
  }
  if len(errs) > 0 {
   return fmt.Errorf("shutdown: %v", errs)
  }
  return nil
 }, nil
}

func stripScheme(endpoint string) string {
 if s := strings.TrimPrefix(endpoint, "https://"); s != endpoint {
  return s
 }
 return strings.TrimPrefix(endpoint, "http://")
}
```

`resource.WithFromEnv()` merges anything in `OTEL_RESOURCE_ATTRIBUTES`,
`WithProcess()` adds `process.pid`, `process.runtime.name=go`, and
`process.runtime.version`, and `WithTelemetrySDK()` records the SDK
version. The composite propagator handles W3C `traceparent` and `baggage`.

```mdx-code-block
</TabItem>
</Tabs>
```

## Production Configuration

### Batch and exporter tuning

The defaults work for most services. The two knobs you usually touch:

- **Trace batch size and timeout** - `sdktrace.WithBatcher(exp,
  sdktrace.WithMaxExportBatchSize(512),
  sdktrace.WithBatchTimeout(5*time.Second))` for high-throughput services.
- **Metric export interval** - the example uses 60 s
  (`sdkmetric.WithInterval(60*time.Second)`). Drop to 15-30 s for tighter
  alerting; raise to 120 s for low-traffic batch jobs.

### GZIP compression on the OTLP exporter

Enable GZIP at the exporter layer for the leg between collector and Scout:

```yaml title="config/otel-config.yaml" showLineNumbers
exporters:
  otlp_http/scout:
    endpoint: ${SCOUT_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s
```

The Go SDK exporter (`otlptracehttp`, `otlpmetrichttp`, `otlploghttp`)
defaults to `gzip` compression on the wire from the app to the collector;
no extra setup needed there.

### Distroless multi-stage Dockerfile

The example builds a static binary on `golang:1.26-alpine` and ships it on
`gcr.io/distroless/static-debian12:nonroot`. The runtime image has no
shell, no package manager, and a non-root UID by default:

```dockerfile title="app/Dockerfile" showLineNumbers
FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/app /app/app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/app"]
```

`-ldflags="-s -w"` strips DWARF and symbol tables, cutting the binary to
~15 MB. Distroless `static-debian12` adds about 2 MB on top of that, so the
final image is in the 17-20 MB range.

### Multi-service distributed tracing

The example wires two services - `stdlib-articles` (port 8080) and
`stdlib-notify` (port 8081). The articles service calls notify with a
`http.Client` whose transport is `otelhttp.NewTransport(http.DefaultTransport)`.
That transport injects W3C `traceparent` on the outbound request. The notify
service wraps its mux with `otelhttp.NewHandler`, which extracts the same
header into a child span. Both traces share one `trace_id`:

```text
http.server   (stdlib-articles)  POST /api/articles
├── prepare      (otelpgx)
├── query        (otelpgx)        INSERT INTO articles ...
└── HTTP POST    (otelhttp.client)
    └── http.server (stdlib-notify) POST /notify
```

This works without any code in the application beyond the otelhttp
wrappers and a global `propagation.TraceContext` propagator.

## Framework-Specific Features

### Server-side: otelhttp.NewHandler around ServeMux

```go title="app/main.go" showLineNumbers
mux := http.NewServeMux()
mux.HandleFunc("GET /api/health", handler.Health)
articles.Register(mux)

server := &http.Server{
 Addr: ":" + port,
 Handler: otelhttp.NewHandler(mux, "http.server",
  otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
   return r.Method + " " + r.URL.Path
  }),
 ),
 ReadHeaderTimeout: 5 * time.Second,
}
```

`otelhttp.NewHandler` produces one server span per request with attributes
for HTTP method, route, status code, and duration. The
`WithSpanNameFormatter` callback overrides the default `"HTTP {method}"`
with the more searchable `"GET /api/articles/{id}"` shape.

### Client-side: otelhttp.NewTransport

```go title="app/service/notification.go" showLineNumbers
package service

import (
 "bytes"
 "context"
 "encoding/json"
 "fmt"
 "io"
 "net/http"
 "time"

 "stdlib-articles/model"

 "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type Notifier struct {
 url    string
 client *http.Client
}

func NewNotifier(url string) *Notifier {
 return &Notifier{
  url: url,
  client: &http.Client{
   Transport: otelhttp.NewTransport(http.DefaultTransport),
   Timeout:   5 * time.Second,
  },
 }
}

func (n *Notifier) NotifyArticleCreated(ctx context.Context, article *model.Article) error {
 if n.url == "" {
  return nil
 }

 payload := map[string]any{
  "event":      "article.created",
  "article_id": article.ID,
  "title":      article.Title,
 }
 body, err := json.Marshal(payload)
 if err != nil {
  return err
 }

 req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.url, bytes.NewReader(body))
 if err != nil {
  return err
 }
 req.Header.Set("Content-Type", "application/json")

 resp, err := n.client.Do(req)
 if err != nil {
  return err
 }
 defer resp.Body.Close()
 _, _ = io.Copy(io.Discard, resp.Body)

 if resp.StatusCode >= 400 {
  return fmt.Errorf("notify returned status %d", resp.StatusCode)
 }
 return nil
}
```

The key call is `http.NewRequestWithContext(ctx, ...)`. Without that, the
transport has no parent span context to propagate. Forget it and you'll
see two disconnected traces in Scout instead of one.

### pgx tracer with otelpgx

```go title="app/main.go" showLineNumbers
func newPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
 cfg, err := pgxpool.ParseConfig(dsn)
 if err != nil {
  return nil, err
 }
 cfg.ConnConfig.Tracer = otelpgx.NewTracer()

 pool, err := pgxpool.NewWithConfig(ctx, cfg)
 if err != nil {
  return nil, err
 }

 pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
 defer cancel()
 if err := pool.Ping(pingCtx); err != nil {
  pool.Close()
  return nil, err
 }
 return pool, nil
}
```

`otelpgx.NewTracer()` plugs into pgx's `Tracer` interface and emits four
span kinds:

| Span name        | When                                              |
| ---------------- | ------------------------------------------------- |
| `pool.connect`   | New connection added to the pool                  |
| `pool.acquire`   | Goroutine checks out a connection                 |
| `prepare`        | Statement preparation                             |
| `query`          | `Exec`, `Query`, or `QueryRow`                    |

Spans carry `db.system=postgresql`, `db.statement` (parameterized SQL with
literals replaced by placeholders), and `db.operation` (e.g. `INSERT`,
`SELECT`).

### Repository code is unchanged

Once `cfg.ConnConfig.Tracer` is set, repository code just uses `pool.Query`
and `pool.QueryRow` normally. Spans appear as long as you pass `ctx` through
to the query call:

```go title="app/repository/article.go" showLineNumbers
func (r *ArticleRepository) GetByID(ctx context.Context, id int64) (*model.Article, error) {
 var a model.Article
 err := r.pool.QueryRow(ctx, `
  SELECT id, title, body, created_at, updated_at
  FROM articles WHERE id = $1
 `, id).Scan(&a.ID, &a.Title, &a.Body, &a.CreatedAt, &a.UpdatedAt)
 if errors.Is(err, pgx.ErrNoRows) {
  return nil, ErrNotFound
 }
 if err != nil {
  return nil, err
 }
 return &a, nil
}
```

### slog bridged to OTel logs with trace context

```go title="app/middleware/logger.go" showLineNumbers
package middleware

import (
 "context"
 "log/slog"
 "os"

 "go.opentelemetry.io/contrib/bridges/otelslog"
 "go.opentelemetry.io/otel/trace"
)

// NewLogger returns a slog.Logger that writes JSON to stdout AND bridges to
// the OTel logs pipeline. Trace and span IDs from context are added to every
// record so logs correlate with traces in Scout.
func NewLogger(serviceName string) *slog.Logger {
 stdoutHandler := traceContextHandler{
  Handler: slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}),
 }
 otelHandler := otelslog.NewHandler(serviceName)
 return slog.New(multiHandler{handlers: []slog.Handler{stdoutHandler, otelHandler}}).
  With("service", serviceName)
}

type traceContextHandler struct {
 slog.Handler
}

func (h traceContextHandler) Handle(ctx context.Context, r slog.Record) error {
 sc := trace.SpanFromContext(ctx).SpanContext()
 if sc.IsValid() {
  r.AddAttrs(
   slog.String("trace_id", sc.TraceID().String()),
   slog.String("span_id", sc.SpanID().String()),
  )
 }
 return h.Handler.Handle(ctx, r)
}
```

Two important details:

1. The `multiHandler` fans out every record to *both* the stdout JSON
   handler and the OTel bridge, so you can `docker compose logs -f app` for
   local tail and still ship logs to Scout.
2. `traceContextHandler` wraps the JSON handler so the stdout copy also
   gets `trace_id`/`span_id`. The OTel bridge attaches them on its side
   independently. Both copies stay correlated.

## Custom Instrumentation

### Counter metric on a successful create

```go title="app/main.go" showLineNumbers
createdCounter, err := otel.Meter("stdlib-articles").Int64Counter("articles.created")
if err != nil {
 log.Fatalf("counter: %v", err)
}
```

```go title="app/handler/article.go" showLineNumbers
article, err := h.repo.Create(r.Context(), req.Title, req.Body)
if err != nil {
 h.logger.ErrorContext(r.Context(), "Failed to create article", "error", err)
 writeError(r.Context(), w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to create article")
 return
}

h.created.Add(r.Context(), 1)
h.logger.InfoContext(r.Context(), "Article created", "article_id", article.ID)
```

The counter exports every 60 s through the meter provider. In Scout this
shows up as the `articles.created` metric, broken down by
`service.name=stdlib-articles` and `deployment.environment`.

### Trace ID echoed in the response

API consumers can quote the trace ID in support tickets so you can pull
the full trace in Scout without grepping logs:

```go title="app/handler/article.go" showLineNumbers
func envelope(ctx context.Context, data any) map[string]any {
 return map[string]any{
  "data": data,
  "meta": map[string]any{"trace_id": traceID(ctx)},
 }
}

func traceID(ctx context.Context) string {
 sc := trace.SpanFromContext(ctx).SpanContext()
 if !sc.IsValid() {
  return ""
 }
 return sc.TraceID().String()
}
```

A successful `POST /api/articles` then returns:

```json
{
  "data": { "id": 42, "title": "...", "body": "..." },
  "meta": { "trace_id": "0af7651916cd43dd8448eb211c80319c" }
}
```

### Manual spans for business logic

For arbitrary work you want to time, grab a tracer once and start spans
explicitly:

```go
import "go.opentelemetry.io/otel"

tracer := otel.Tracer("stdlib-articles")

func chargeCustomer(ctx context.Context, customerID string) error {
 ctx, span := tracer.Start(ctx, "charge_customer")
 defer span.End()

 span.SetAttributes(
  attribute.String("customer.id", customerID),
 )

 if err := stripeCharge(ctx, customerID); err != nil {
  span.RecordError(err)
  span.SetStatus(codes.Error, "stripe charge failed")
  return err
 }
 return nil
}
```

`tracer.Start` automatically becomes a child of whatever span lives in
`ctx` (server span, parent business span, etc.).

## Running Your Application

### Local with Docker Compose

```bash
cd ~/dev/base14/examples/go/stdlib-postgres
cp .env.example .env
# edit .env with your Scout credentials (or leave defaults for local-only)
docker compose up -d --build
```

### Smoke test the API

The example ships an end-to-end test script that exercises every endpoint,
checks distributed trace correlation, verifies log fields, and confirms
the `articles.created` metric reaches the collector:

```bash
make test-api
```

### Verify a single request manually

```bash
# Health
curl http://localhost:8080/api/health

# Create an article (triggers the notify call)
curl -X POST http://localhost:8080/api/articles \
  -H 'Content-Type: application/json' \
  -d '{"title":"hello","body":"first article"}'

# Response includes trace_id you can search in Scout
```

### Expected span hierarchy in Scout

For a `POST /api/articles` call you should see:

```text
POST /api/articles                  service.name=stdlib-articles
├── pool.acquire                    instrumentation_scope=otelpgx
├── prepare                         instrumentation_scope=otelpgx
├── query INSERT INTO articles ...  db.statement, db.operation=INSERT
└── HTTP POST                       http.client, traceparent injected
    └── POST /notify                service.name=stdlib-notify
```

All five spans share a single `trace_id`. The notify service appears as a
sibling resource (`service.name=stdlib-notify`) inside the same trace.

### Run a single service in dev mode

For tight feedback loops without rebuilding the container, run the binary
directly against an existing collector:

```bash
cd app
DATABASE_URL='postgres://postgres:postgres@localhost:5432/stdlib_articles?sslmode=disable' \
OTEL_SERVICE_NAME=stdlib-articles \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
NOTIFY_URL=http://localhost:8081/notify \
go run .
```

Note: when running outside Docker, swap the Compose hostnames (`db`,
`notify`, `otel-collector`) for `localhost`.

## Troubleshooting

### Trace context is lost between services

**Symptom**: the notify service shows up as a separate trace instead of a
child of the articles service.

**Cause**: the outbound HTTP request was built with `http.NewRequest`
instead of `http.NewRequestWithContext`. The otelhttp transport pulls the
parent span out of `req.Context()`; without it, the transport starts a new
root trace.

**Fix**:

```go
req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.url, bytes.NewReader(body))
```

Also confirm the global propagator is registered:

```go
otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
 propagation.TraceContext{},
 propagation.Baggage{},
))
```

### pgx queries don't produce spans

**Symptom**: HTTP server spans appear, but no `query` or `pool.acquire`
spans show up underneath.

**Cause**: usually one of:

- `cfg.ConnConfig.Tracer = otelpgx.NewTracer()` was set on the wrong
  config (e.g., on a fresh `pgx.Connect` config rather than the pool
  config returned by `pgxpool.ParseConfig`).
- The repository code calls `pool.Query` with `context.Background()`
  instead of the request context.
- The collector's `filter/noisy` processor is dropping `pool.acquire` and
  `connect` spans intentionally (the example does this - check the config).

**Fix**: pass `r.Context()` through every repository method, and verify
the tracer is attached to the pool config before calling
`pgxpool.NewWithConfig`.

### `otelhttp.NewHandler` is logging twice or producing wrong route names

**Symptom**: every request span is named `HTTP GET` or `HTTP POST`
without a path; route patterns are missing.

**Cause**: default span naming uses just the method. The mux pattern is
attached as an attribute but not in the name.

**Fix**: pass a span name formatter:

```go
otelhttp.NewHandler(mux, "http.server",
 otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
  return r.Method + " " + r.URL.Path
 }),
)
```

For high-cardinality paths (e.g. `/api/articles/{id}`), prefer the route
pattern over the raw URL path:

```go
otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
 if r.Pattern != "" {
  return r.Method + " " + r.Pattern
 }
 return r.Method + " " + r.URL.Path
})
```

`http.Request.Pattern` (Go 1.23+) holds the matched mux route, so paths
like `/api/articles/42` collapse to `GET /api/articles/{id}` in span names.

### OTLP export fails with `connection refused`

**Symptom**: stderr shows `failed to export traces: ... connect: connection
refused`.

**Cause**: the collector isn't reachable at the configured endpoint.

**Fix checklist**:

1. `docker compose ps` - is `otel-collector` running and healthy?
2. From the app container, `wget -O- http://otel-collector:13133` should
   return the collector health endpoint.
3. `OTEL_EXPORTER_OTLP_ENDPOINT` must be the *base* URL
   (`http://otel-collector:4318`), not the per-signal path.
4. Use `otlptracehttp.WithInsecure()` for plain HTTP between app and
   collector. TLS is normally only used between collector and Scout.

### Logs are missing `trace_id` and `span_id`

**Symptom**: stdout JSON logs land in the right shape but have no trace
correlation fields.

**Cause**: handlers are using `slog.Info` (no context) instead of
`slog.InfoContext(ctx, ...)`. Without the context argument, slog never
hits the `Handle(ctx, ...)` path that injects trace IDs.

**Fix**: thread context through every log call:

```go
h.logger.InfoContext(r.Context(), "Article created", "article_id", article.ID)
```

## Security Considerations

- **PII in span attributes** - `db.statement` carries the parameterized
  SQL with literal values replaced. otelpgx already does this by default.
  For HTTP attributes, otelhttp redacts the query string by default; do
  not add `?token=...` style tokens to URLs.
- **Authorization headers** - otelhttp does not capture request or
  response headers by default. If you opt in via
  `otelhttp.WithFilter`/`otelhttp.WithPublicEndpoint`, add an explicit
  redaction step for `Authorization`, `Cookie`, and `Set-Cookie`.
- **SQL parameter values** - otelpgx records `db.statement` with
  placeholders (`$1`, `$2`); the actual values are *not* attached as span
  attributes. If you ever switch to a tracer that does, route them through
  a span processor that drops or hashes them.
- **Distroless attack surface** - shipping on
  `gcr.io/distroless/static-debian12:nonroot` means no shell, no `apt`,
  no setuid binaries, and a non-root UID. Vulnerability scanners
  consistently report 0-2 CVEs against the runtime image vs. 30+ for a
  full Debian/Ubuntu base.
- **Outbound TLS to Scout** - the collector's `oauth2client` extension
  obtains a bearer token from Scout's token URL and renews it
  automatically. Set `tls.insecure_skip_verify: true` only for local
  testing; production should pin the Scout CA or accept the system trust
  store.
- **Compliance scope** - if you need GDPR/HIPAA/SOC2 attestation for the
  telemetry path, run the collector in your own VPC and use a private
  link (Scout supports VPC peering). Avoid emitting end-user identifiers
  as span attributes; use a hashed `user.id` if you need cardinality.

## Performance Considerations

The Go SDK is one of the fastest OTel SDKs in production, partly because
the runtime is goroutine-friendly and partly because everything is
library-based with no agent.

| Workload                 | Without OTel | With OTel | Overhead                |
| ------------------------ | ------------ | --------- | ----------------------- |
| `GET /api/health`        | 0.4 ms       | 0.5 ms    | +0.1 ms                 |
| `GET /api/articles/{id}` | 1.8 ms       | 2.1 ms    | +0.3 ms                 |
| `POST /api/articles`     | 4.2 ms       | 4.7 ms    | +0.5 ms (incl. notify)  |
| Postgres `SELECT` p99    | 0.9 ms       | 1.0 ms    | +0.1 ms (otelpgx)       |
| RSS at idle              | 12 MB        | 22 MB     | +10 MB (SDK + buffers)  |
| CPU at 1k RPS            | 8%           | 11%       | +3 percentage points    |

(Numbers are illustrative; measure on your hardware.)

### Tuning batch processors

The trace SDK batches by default (max 512 spans, 5 s timeout). For
high-throughput services you can raise the queue size to absorb traffic
spikes without dropping:

```go
sdktrace.NewTracerProvider(
 sdktrace.WithBatcher(traceExp,
  sdktrace.WithMaxExportBatchSize(512),
  sdktrace.WithMaxQueueSize(8192),
  sdktrace.WithBatchTimeout(5*time.Second),
 ),
)
```

### Filter health checks at the collector

Wrapping `/api/health` with otelhttp produces a span every time
Kubernetes probes the pod. The example collector drops these in the
traces pipeline so they never reach Scout:

```yaml title="config/otel-config.yaml" showLineNumbers
processors:
  filter/noisy:
    error_mode: ignore
    traces:
      span:
        - 'IsMatch(name, ".*health.*")'
        - 'name == "pool.acquire" and instrumentation_scope.name == "github.com/exaring/otelpgx"'
        - 'name == "connect" and instrumentation_scope.name == "github.com/exaring/otelpgx"'
```

That cuts the trace volume by 60-80% on a typical microservice.

### Goroutine cost

Each request runs in its own goroutine. The SDK's per-span allocations
are pooled, so a high-RPS service might allocate ~1 KB per span on hot
paths. The goroutine-local context plumbing adds negligible per-request
cost.

## FAQ

### Why use net/http instead of a Go web framework with OpenTelemetry?

Go 1.22 added pattern-based routing (e.g. `GET /api/articles/{id}`) to
`net/http`, removing the main reason most teams reached for Echo, Fiber,
or Chi. Wrapping `ServeMux` with `otelhttp.NewHandler` gives you full
server-span coverage with zero framework dependency, no middleware
chains, and no router-specific OTel contrib package.

### How do I trace pgx queries with OpenTelemetry?

Set `cfg.ConnConfig.Tracer = otelpgx.NewTracer()` before calling
`pgxpool.NewWithConfig`. Every query, prepare, and pool acquire becomes
a span attached to the parent HTTP server span via context. Pass `ctx`
to `pool.Query`, `pool.QueryRow`, and `pool.Exec`.

### How much overhead does OpenTelemetry add to a Go net/http service?

Roughly 0.1-0.3 ms added latency per request, 1-3% CPU at 1k RPS, and
8-15 MB extra resident memory for the SDK. Postgres queries gain about
50-150 microseconds from the otelpgx tracer. The biggest variable is
network egress to the collector, not in-process overhead.

### Does W3C traceparent propagate automatically between Go services?

Yes, when both client and server use otelhttp. Wrap the outbound
`http.Client` with `otelhttp.NewTransport` on the caller and
`otelhttp.NewHandler` on the receiver. The `traceparent` header is
injected and parsed automatically when you set `propagation.TraceContext`
as the global propagator.

### How do I correlate Go slog logs with traces?

Use the `go.opentelemetry.io/contrib/bridges/otelslog` package to forward
records to the OTel logs pipeline, and a small custom `slog.Handler`
that reads `trace.SpanFromContext(ctx)` to add `trace_id` and `span_id`
to every record before the JSON encoder runs. The example does both via
a `multiHandler` that fans out to stdout and OTLP.

### Can I run OpenTelemetry-instrumented Go binaries on distroless images?

Yes. The OTel Go SDK is pure Go, so a `CGO_ENABLED=0` static build runs
on `gcr.io/distroless/static-debian12:nonroot` with no extra packages.
The example app and notify service both use this image and the final
container is in the 17-20 MB range.

### What is the difference between otelhttp.NewHandler and otelhttp.NewMiddleware?

`NewHandler` wraps an entire `http.Handler` (typically `ServeMux`) and
produces one server span per request. `NewMiddleware` returns a
middleware function for routers that compose middleware explicitly. For
stdlib `net/http`, `NewHandler` is the canonical entry point.

### How do I expose the trace ID to API consumers in Go?

Read `trace.SpanFromContext(ctx).SpanContext().TraceID().String()` inside
the handler and embed it in the response body (for example in a `meta`
envelope). This lets clients quote the trace ID in support tickets so
you can pull the full trace in Scout. The example does this in the
`envelope()` helper.

### Do I need a Go agent or auto-instrumentation binary?

No. Unlike Java or Python, Go instrumentation is library-based - you
import `otelhttp`, `otelpgx`, and `otelslog` and call them explicitly.
There is no `java -javaagent` equivalent for production Go binaries.
There is an experimental eBPF-based auto-instrumentation project, but
for stdlib services the library approach is simpler and faster.

### How do I disable noisy spans like pgx pool.acquire?

Drop them at the collector with a `filter` processor on the traces
pipeline. The example config filters span names matching `.*health.*`
and `pool.acquire`/`connect` spans from otelpgx so the trace UI stays
focused on real query work. See the `filter/noisy` processor in
`config/otel-config.yaml`.

### Can I use OpenTelemetry with database/sql instead of pgx?

Yes - swap otelpgx for `otelsql`
(`github.com/XSAM/otelsql`) and wrap your `sql.DB` driver. The rest of
the setup (otelhttp, otelslog, exporters) is identical. The example
uses pgx because pgxpool is the most widely-used native Postgres driver
for Go.

### How do I stop sending dev OTLP traffic over the public internet?

Run the OTel collector locally in Docker Compose and point
`OTEL_EXPORTER_OTLP_ENDPOINT` at it (`http://otel-collector:4318`). The
collector authenticates to Scout with `oauth2client` and forwards over
TLS. Your laptop and your CI never need direct outbound TLS to Scout.

## What's Next

- **Add custom business metrics** - histograms for latency per business
  flow, gauges for queue depth, async counters for cache hit rate.
  See [custom instrumentation](../custom-instrumentation/go.md).
- **Wire up Postgres pool metrics** - otelpgx exposes
  `pgxpool.Stat()`-derived gauges via a callback observer (open
  connections, idle connections, acquire wait time).
- **Profile in production** - the SDK plays well with Go's `runtime/pprof`
  and `net/http/pprof`. Start with span-level latency, then drop to
  pprof for hot paths the spans surface.
- **Add Redis or NATS** - the same pattern works with `otelredis` and
  `otelnats`. Wrap the client, pass `ctx`, you're done.
- **Move to gRPC** - swap `otelhttp` for `otelgrpc.NewServerHandler` and
  `otelgrpc.NewClientHandler`. Same propagation, same span shape.

For end-to-end Go observability beyond a single service - log search,
trace exploration, alerting, and dashboarding without rolling your own
Grafana stack - see how teams use [Base14 Scout for production Go
observability](https://www.base14.io).

## Complete Example

The full reference implementation lives at
`~/dev/base14/examples/go/stdlib-postgres/`:

```text
go/stdlib-postgres/
├── app/                           # stdlib-articles (port 8080)
│   ├── main.go                    # bootstraps OTel + pgx pool + mux
│   ├── telemetry.go               # tracer + meter + logger providers
│   ├── handler/
│   │   ├── article.go             # CRUD handlers + envelope helpers
│   │   └── health.go              # /api/health
│   ├── middleware/
│   │   └── logger.go              # slog handler with trace context
│   ├── model/
│   │   └── article.go             # Article struct + Schema constant
│   ├── repository/
│   │   └── article.go             # pgx queries
│   ├── service/
│   │   └── notification.go        # otelhttp-instrumented client
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile                 # multi-stage, distroless
├── notify/                        # stdlib-notify (port 8081)
│   ├── main.go                    # /notify endpoint, span receiver
│   ├── telemetry.go               # mirrors app/telemetry.go
│   ├── logger.go                  # slog + otelslog bridge
│   ├── go.mod / go.sum / Dockerfile
├── config/
│   └── otel-config.yaml           # collector w/ oauth2client → Scout
├── scripts/
│   ├── test-api.sh                # full e2e API + observability check
│   └── verify-scout.sh            # confirms data lands in Scout
├── compose.yml                    # app + notify + db + collector
├── Makefile                       # build, lint, docker-up, test-api
├── .env.example
└── README.md
```

### Run it

```bash
cd ~/dev/base14/examples/go/stdlib-postgres
cp .env.example .env
# fill in Scout credentials, or leave defaults for local-only
docker compose up -d --build

# all-in-one functional + observability smoke test
make test-api

# scout export verification (requires real credentials)
make verify-scout
```

The `test-api.sh` script does an end-to-end check: it runs every CRUD
endpoint, extracts the `trace_id` from a `POST /api/articles` response,
greps the notify service logs for the same trace ID, greps the collector
logs for matching spans, and waits for the periodic metric flush to
verify `articles.created` reaches the collector. A passing run looks
like:

```text
=== stdlib-postgres API Testing Script ===
Target: http://localhost:8080
[PASS] Health check (HTTP 200)
[PASS] Create article (HTTP 201)
[PASS] Get article (HTTP 200)
[PASS] List articles (HTTP 200)
[PASS] Update article (HTTP 200)
[PASS] Delete article (HTTP 204)
[PASS] 400 - Invalid ID format (HTTP 400)
[PASS] 404 - Article not found (HTTP 404)
[PASS] 422 - Empty body (HTTP 422)
[PASS] Distributed trace - notify service received matching trace_id
[PASS] Collector received spans with matching trace_id
[PASS] Logs contain trace_id field
[PASS] Logs contain span_id field
[PASS] WARN log present for error conditions
[PASS] articles.created metric found in collector
=== Results ===
Passed: 15 / 15
```

## References

- [OpenTelemetry Go SDK](https://opentelemetry.io/docs/languages/go/)
- [otelhttp contrib package](https://pkg.go.dev/go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp)
- [otelpgx](https://github.com/exaring/otelpgx)
- [otelslog bridge](https://pkg.go.dev/go.opentelemetry.io/contrib/bridges/otelslog)
- [pgx v5](https://github.com/jackc/pgx)
- [Go 1.22 ServeMux pattern routing](https://pkg.go.dev/net/http#ServeMux)
- [Distroless container images](https://github.com/GoogleContainerTools/distroless)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Collector oauth2client extension](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/extension/oauth2clientauthextension)

## Related Guides

- [Go (Echo, Fiber, Chi, GORM)](./go.md) - the framework-oriented Go guide.
- [Custom Go Instrumentation](../custom-instrumentation/go.md) - manual
  spans, metrics, and log enrichment.
- [Hello World](/instrument/apps/hello-world) - verify your collector
  before adding any app code.
- [Auto-instrumentation overview](./index.md) - browse other supported
  frameworks.
