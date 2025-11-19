---
date: 2025-11-19
title: Elixir Phoenix OpenTelemetry Instrumentation Guide
sidebar_label: Elixir Phoenix
description:
  Auto-instrument Phoenix with OpenTelemetry for traces. Complete
  Elixir monitoring setup with distributed tracing and database.
keywords:
  [
    phoenix observability,
    elixir monitoring,
    opentelemetry elixir,
    phoenix instrumentation,
    elixir apm,
    liveview monitoring,
  ]
---

# Elixir Phoenix

Implement OpenTelemetry instrumentation for `Phoenix` applications to collect
traces; monitor HTTP requests and database queries using the Elixir OTel SDK.

> **Note:** This guide provides a concise overview based on the official
> OpenTelemetry documentation. For complete information, please consult the
> [official OpenTelemetry documentation](https://opentelemetry.io/docs/languages/erlang/).

## Overview

This guide walks through setting up automatic OpenTelemetry instrumentation for
Phoenix applications, including HTTP request tracing, database query monitoring
with Ecto, and log correlation. The instrumentation automatically exports
telemetry data to Scout Collector for visualization.

## Prerequisites

Before starting, ensure you have:

- Elixir 1.13 or later installed
- Phoenix application set up
- Access to package installation (Mix)
- Scout collector endpoint

## Required Packages

Install the following necessary packages by adding them to `mix.exs` and
running `mix deps.get`.

```elixir title="mix.exs" showLineNumbers
defp deps do
  [
    # OpenTelemetry core packages
    {:opentelemetry, "~> 1.3"},
    {:opentelemetry_exporter, "~> 1.6"},

    # Automatic instrumentation for Phoenix and Ecto
    {:opentelemetry_phoenix, "~> 1.1"},
    {:opentelemetry_ecto, "~> 1.1"}
  ]
end
```

After adding the dependencies, install them:

```bash
mix deps.get
```

## Traces

Traces give us the big picture of what happens when a request is made to an
application. Whether your application is a monolith with a single database or a
sophisticated mesh of services, traces are essential to understanding the full
"path" a request takes in your application.

### Auto Instrumentation of Traces

#### Step 1: Initialize OpenTelemetry Instrumentation

Add the following setup calls in your application module's `start/2` function:

```elixir title="lib/phoenix_app/application.ex" showLineNumbers
def start(_type, _args) do
  # Initialize Phoenix instrumentation
  OpentelemetryPhoenix.setup()

  # Initialize Ecto instrumentation
  OpentelemetryEcto.setup([:phoenix_app, :repo])

  # ... rest of your application setup
end
```

#### Step 2: Configure OpenTelemetry Exporter

Add OpenTelemetry configuration to your runtime configuration:

```elixir title="config/runtime.exs" showLineNumbers
import Config

# OpenTelemetry resource configuration
config :opentelemetry,
  resource: [
    service: [
      name: "phoenix-app",
      version: "1.0.0"
    ]
  ]

# OpenTelemetry exporter configuration
config :opentelemetry_exporter,
  otlp_protocol: :http_protobuf,
  otlp_endpoint: "http://localhost:4318"
```

> Replace `localhost:4318` with your Scout collector endpoint.

[Official Traces Documentation](https://opentelemetry.io/docs/concepts/signals/traces/)

#### Step 3: Configure Logger with Trace Context

Add trace context to your logs for correlation:

```elixir title="config/config.exs" showLineNumbers
config :logger, :default_formatter,
  format: "$time [$level] $message trace_id=$otel_trace_id span_id=$otel_span_id\n",
  metadata: [:otel_trace_id, :otel_span_id]
```

> View these traces in base14 Scout observability backend.

That's it! Head over to Scout Grafana to visualize the traces.

## References

- [OpenTelemetry Erlang Documentation](https://opentelemetry.io/docs/languages/erlang/)
- [Phoenix Framework Documentation](https://hexdocs.pm/phoenix/telemetry.html)
- [Sample Phoenix application with OpenTelemetry instrumentation](https://github.com/base-14/examples/tree/main/elixir-phoenix-otel)

## Related Guides

- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [Kubernetes Helm Setup](../../collector-setup/kubernetes-helm-setup.md) -
  Deploy collector on Kubernetes
