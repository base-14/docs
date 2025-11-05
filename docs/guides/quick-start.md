---
title: 5-Minute Quick Start
sidebar_label: Quick Start
sidebar_position: 2
description:
  Get started with Scout in 5 minutes. Deploy an OpenTelemetry collector,
  configure the Scout exporter, and start collecting telemetry data.
keywords:
  [
    quick start,
    getting started,
    opentelemetry collector,
    scout setup,
    5 minute setup,
    observability quick start,
  ]
---

# 5-Minute Quick Start

Get Scout up and running in less than 5 minutes. This guide will help you
deploy an OpenTelemetry collector, configure it to send data to Scout, and
start collecting telemetry from your applications and infrastructure.

## What You'll Accomplish

- Deploy an OpenTelemetry collector in your environment
- Configure the Scout exporter to send data to the Scout backend
- Start collecting telemetry data from your applications and components
- Verify data is flowing to Scout

## Prerequisites

- Access to your Scout account and API credentials
- Docker, Kubernetes, or Linux environment for collector deployment
- Basic familiarity with YAML configuration files

## Step 1: Deploy the OpenTelemetry Collector

Deploy the OpenTelemetry collector in your environment based on your
infrastructure. Choose from Docker, Kubernetes, Linux, or AWS ECS options.

### Docker Compose

Perfect for local development and testing environments. Download the
configuration and deploy using Docker Compose.

See the [Docker Compose Setup Guide](../instrument/collector-setup/docker-compose-example.md)
for detailed instructions.

### Kubernetes

Ideal for production deployments on EKS, GKE, or AKS. Install using Helm charts
for simplified deployment and management.

See the [Kubernetes Helm Setup Guide](../instrument/collector-setup/kubernetes-helm-setup.md)
for detailed instructions.

### Linux

For direct installation on Linux servers or virtual machines. Download and
install the collector binary with automated setup scripts.

See the [Linux Setup Guide](../instrument/collector-setup/linux-setup.md) for
detailed instructions.

### AWS ECS

For containerized applications running on Amazon ECS. Deploy as a sidecar or
daemon on Fargate and EC2 launch types.

See the [ECS Setup Guide](../instrument/collector-setup/ecs-setup.md) for
detailed instructions on Fargate and EC2 deployments.

## Step 2: Configure the OpenTelemetry Collector

Once your collector is deployed, configure it to receive telemetry and send
data to Scout. Here's a complete configuration example:

```yaml showLineNumbers
# Extensions provide additional capabilities to the collector
extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: __YOUR_CLIENT_SECRET__
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
    tls:
      insecure_skip_verify: true

# Receivers define how telemetry data enters the collector
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

# Processors modify or enrich telemetry data
processors:
  resource:
    attributes:
      - key: deployment.environment
        value: production
        action: upsert
      - key: service.namespace
        value: my-namespace
        action: upsert

# Exporters define where telemetry data is sent
exporters:
  otlp/scout:
    endpoint: https://api.scout.base14.io:4317
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

# Service section ties everything together
service:
  extensions: [oauth2client]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource]
      exporters: [otlp/scout]
    metrics:
      receivers: [otlp]
      processors: [resource]
      exporters: [otlp/scout]
    logs:
      receivers: [otlp]
      processors: [resource]
      exporters: [otlp/scout]
```

### Configuration Breakdown

- **OAuth Extension**: Handles authentication with Scout using OAuth2
  client credentials flow
- **OTLP Receiver**: Accepts telemetry data on ports 4317 (gRPC) and 4318
  (HTTP)
- **Resource Processor**: Adds environment metadata to all telemetry signals
- **Scout Exporter**: Sends data to Scout backend using authenticated OTLP

### Quick Setup Steps

1. Get your OAuth credentials (client ID and secret) from the Scout dashboard
2. Update the configuration with your credentials
3. Save the configuration to `otel-collector-config.yaml`
4. Restart the collector to apply changes

See the [Scout Exporter Configuration Guide](../instrument/collector-setup/scout-exporter.md)
for complete details and authentication options.

## Step 3: Start Collecting Data

Now that your collector is running, start sending telemetry data:

### From Applications

Instrument your applications to send traces, metrics, and logs:

- **Auto-instrumentation**: Get started quickly with zero-code instrumentation
  for popular frameworks. See [Auto-instrumentation Guides](/category/auto-instrumentation)
- **Custom instrumentation**: Add application-specific telemetry. See
  [Custom Instrumentation Guides](/category/custom-instrumentation)

### From Components

Collect metrics and logs from your infrastructure components:

- **Databases**: [PostgreSQL](../instrument/component/postgres.md),
  [MongoDB](../instrument/component/mongodb.md),
  [Redis](../instrument/component/redis.md)
- **Message Queues**: [RabbitMQ](../instrument/component/rabbitmq.md)
- **Web Servers**: [nginx](../instrument/component/nginx.md)

### From AWS Infrastructure

Monitor your AWS resources automatically:

- [Application Load Balancer](../instrument/infra/aws/elb.md)
- [RDS Databases](../instrument/infra/aws/rds.md)
- [ElastiCache](../instrument/infra/aws/elasticache.md)
- [VPC Flow Logs](../instrument/infra/aws/aws-vpc.md)

## Step 4: Verify Data Flow

1. Log in to your Scout dashboard
2. Navigate to the **Traces**, **Metrics**, or **Logs** section
3. Verify that data is appearing from your collector
4. Explore the service map to see your application topology

## What's Next?

Now that you have Scout running, explore these topics:

- **Fine-tune your collector**: Review the
  [OTel Collector Configuration Guide](../instrument/collector-setup/otel-collector-config.md)
  to optimize your collector setup
- **Create dashboards**: Build custom visualizations for your metrics
- **Set up alerts**: Configure alerts to get notified about issues. See
  [Creating Alerts with LogX](creating-alerts-with-logx.md)
- **Transform data**: Apply filters and transformations to your telemetry. See
  [Filters and Transformations](/category/filters-and-transformations)

## Troubleshooting

If you're not seeing data in Scout:

1. **Check collector logs**: Verify the collector is running without errors
2. **Verify connectivity**: Ensure your collector can reach the Scout backend
3. **Check credentials**: Confirm your API token is valid and properly
   configured
4. **Review configuration**: Validate your YAML configuration syntax

## Related Guides

- [Introduction](../introduction.md) - Complete overview of Scout's capabilities
- [Docker Compose Setup](../instrument/collector-setup/docker-compose-example.md) -
  Detailed Docker setup
- [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md) -
  Advanced collector configuration
- [Scout Exporter](../instrument/collector-setup/scout-exporter.md) - Exporter
  configuration details
- [Dashboards and Alerts](../operate/dashboards-and-alerts.md) - Create visualizations
  and alerts
