---
slug: /
sidebar_position: 1
title: OpenTelemetry-Native Observability Platform
description:
  Cloud-native observability with OpenTelemetry. Collect traces, metrics, and
  logs with automated instrumentation. Get started in 5 minutes with Scout.
keywords:
  [
    opentelemetry platform,
    observability platform,
    distributed tracing,
    opentelemetry collector,
    cloud native monitoring,
  ]
---

# Introduction

Scout provides comprehensive observability capabilities through a fully
cloud-native and OpenTelemetry-native platform.

## Key Features

- **Unified Data Collection**: Collect all telemetry signals (logs, metrics,
  traces) through a single OpenTelemetry pipeline
- **Real-time Monitoring**: Monitor your applications and infrastructure with
  near real-time visibility
- **Distributed Tracing**: Track requests across service boundaries with
  detailed trace visualization
- **Metrics Analysis**: Analyze system and application metrics with powerful
  querying and visualization
- **Automated Instrumentation**: Leverage OpenTelemetry auto-instrumentation for
  popular frameworks and libraries
- **Custom Instrumentation**: Flexibility to add custom instrumentation for
  business-specific telemetry

## Architecture Benefits

![Scout OTel Native Architecture](/img/otel-scout-base14.svg)

- Native OpenTelemetry support ensures future-proof observability
- Scalable collection and processing of telemetry data
- Efficient storage optimized for different signal types
- Correlation between logs, metrics, and traces
- Built-in support for service maps and dependency analysis

## Getting Started

Let's setup **Scout in less than 5 minutes**. We will follow the steps below:

1. **Install the Scout Collector**: The Scout Collector is a vendor-agnostic
   implementation of the OpenTelemetry specification. It can receive, process,
   and export telemetry data. You can install it using Docker, Kubernetes, or
   directly on your machine. The installation method will depend on your
   environment and preferences.
   - [Docker Compose](./instrument/collector-setup/docker-compose-example)
   - [Kubernetes (EKS, GKE, AKS)](./instrument/collector-setup/kubernetes-helm-setup.md)
   - [Linux](./instrument/collector-setup/linux-setup)
   - [Using Otel Binary](./instrument/collector-setup/otel-collector-binary-example.md)
2. **Configure the Scout Collector**: Step 1 should help you get started with a
   collector that can receive, process, and export telemetry data. For advanced
   configurations, you can refer to
   [detailed Scout Collector configuration guide](./instrument/collector-setup/otel-collector-config.md)
3. **Configure the Scout Exporter**: Next, configure your Scout Collector to
   send data to Scout. You can find the configuration details in the
   [Scout Exporter](./instrument/collector-setup/scout-exporter.md)
   documentation. This will typically involve setting up the endpoint,
   authentication, and any other required parameters. Scout exporter is
   available for all signals (logs, metrics, traces) and can be configured to
   send data to Scout.
4. **Instrument your application**: Use OpenTelemetry SDKs to instrument your
   application code and send telemetry data to the collector. Depending on your
   setup, please follow [Auto-instrumentation](/category/auto-instrumentation)
   or [Manual-instrumentation](/category/custom-instrumentation) guides to
   instrument your application.
5. **Instrument your infrastructure**: Use OpenTelemetry to collect telemetry
   data from your infrastructure components. This can include servers,
   databases, and other services. For example, for AWS ECS Fargate, please read
   [AWS ECS Instrumentation](./instrument/collector-setup/ecs-setup.md) to
   collect telemetry data from your Fargate services.
6. **Observe your telemetry data**: Access the Scout UI to view and analyze your
   telemetry data. You can explore logs, metrics, and traces to gain insights
   into your applications and infrastructure. The UI provides powerful querying
   and visualization capabilities to help you understand your data better. Scout
   comes with a variety of dashboards and visualizations to help you get started
   quickly. You can also create custom dashboards to suit your needs.
7. **Feedback and Support**: If you encounter any issues or have questions,
   reach out to the Scout support team for assistance.

## Related Guides

- [Docker Compose Setup](./instrument/collector-setup/docker-compose-example.md)
  \- Quick start in under 5 minutes
- [Kubernetes Helm Setup](./instrument/collector-setup/kubernetes-helm-setup.md)
  \- Production deployment guide
- [Scout Exporter Configuration](./instrument/collector-setup/scout-exporter.md)
  \- Configure authentication and endpoints

## Learn More

- [Observability Theatre](/blog/observability-theatre) - Avoid common
  observability anti-patterns
