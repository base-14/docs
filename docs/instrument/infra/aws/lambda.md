---
title: AWS Lambda OpenTelemetry Instrumentation
sidebar_label: AWS Lambda
description:
  Instrument AWS Lambda functions with OpenTelemetry to collect traces,
  metrics, and logs. Complete guide for auto-instrumentation using Lambda
  layers with Scout Collector integration.
keywords:
  [
    aws lambda monitoring,
    lambda instrumentation,
    lambda observability,
    opentelemetry lambda,
    serverless monitoring,
    lambda traces,
  ]
tags: [lambda, opentelemetry, base14 scout, aws]
sidebar_position: 6
---

Brief guide to instrument AWS Lambda functions with OpenTelemetry using
Lambda layers for automatic tracing with direct export to Scout Collector.

## Overview

This guide covers auto-instrumentation of AWS Lambda functions using
OpenTelemetry Lambda layers. The language-specific layer automatically
instruments your code and exports traces to the Scout collector.

**Key benefits:**

- Zero-code instrumentation
- Automatic trace generation
- Minimal performance overhead

## Prerequisites

- AWS Lambda function (Python 3.8+, Node.js 18+, Java 17+, or Ruby 3.2+)
- Lambda execution role with CloudWatch Logs permissions
- Scout Collector OTLP endpoint URL

## Layer ARNs by Region

OpenTelemetry Lambda layers are available in all AWS regions. Use the following
ARN format:

```text
arn:aws:lambda:<region>:184161586896:layer:opentelemetry-<runtime>-<version>:1
```

**Example for `ap-south-1` (Mumbai):**

- Python:
  `arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-python-0_17_0:1`
- Node.js:
  `arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-nodejs-0_17_0:1`
- Java Agent:
  `arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-javaagent-0_16_0:1`
- Ruby:
  `arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-ruby-0_10_0:1`

Replace `<region>` with your AWS region and check
[OpenTelemetry Lambda releases](https://github.com/open-telemetry/opentelemetry-lambda/releases)
for the latest versions.

## Step 1: Add Lambda Layers

Add both the language-specific layer and collector layer to your function:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="runtime">
<TabItem value="python" label="Python" default>
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --layers \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-python-0_17_0:1" \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-collector-amd64-0_18_0:1"
```

```mdx-code-block
</TabItem>
<TabItem value="nodejs" label="Node.js">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --layers \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-nodejs-0_17_0:1" \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-collector-amd64-0_18_0:1"
```

```mdx-code-block
</TabItem>
<TabItem value="java" label="Java">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --layers \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-javaagent-0_16_0:1" \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-collector-amd64-0_18_0:1"
```

```mdx-code-block
</TabItem>
<TabItem value="ruby" label="Ruby">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --layers \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-ruby-0_10_0:1" \
    "arn:aws:lambda:ap-south-1:184161586896:layer:opentelemetry-collector-amd64-0_18_0:1"
```

```mdx-code-block
</TabItem>
</Tabs>
```

**Note**: For ARM64 architecture, replace `amd64` with `arm64` in the collector
layer ARN.

## Step 2: Understanding the Collector Layer and TelemetryAPI

The OpenTelemetry Collector layer serves as a sidecar process that collects and
exports telemetry data from your Lambda function. It subscribes to the
**AWS Lambda Telemetry API** to automatically capture platform-level telemetry.

### What the Collector Layer Collects

The collector layer collects three types of telemetry:

**1. Traces (from instrumentation layer)** - Application spans, HTTP/HTTPS
requests, database queries, external service calls, and custom spans

**2. Logs (via TelemetryAPI)** - Function logs (stdout/stderr), platform logs
(START, END, REPORT), runtime errors, and structured logs

### Resource Requirements

- **Memory overhead**: 64-128 MB for collector process
- **Timeout**: Add 5-10 seconds to allow telemetry export
- **Cold start impact**: +50-100ms

## Step 3: Configure Environment Variables

Set required environment variables to enable auto-instrumentation:

```mdx-code-block
<Tabs groupId="runtime">
<TabItem value="python" label="Python" default>
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --environment "Variables={
    AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument,
    OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
    OTEL_LOG_LEVEL=error
    OTEL_SERVICE_NAME=<function-name>,
    OTEL_TRACES_EXPORTER=otlp,
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318,
    OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
  }"
```

```mdx-code-block
</TabItem>
<TabItem value="nodejs" label="Node.js">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --environment "Variables={
    AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler,
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
    OTEL_LOG_LEVEL=error
    OTEL_SERVICE_NAME=<function-name>,
    OTEL_NODE_ENABLED_INSTRUMENTATIONS=aws-lambda,http
    OTEL_TRACES_EXPORTER=otlp,
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318,
    OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
  }"
```

```mdx-code-block
</TabItem>
<TabItem value="java" label="Java">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --environment "Variables={
    AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler,
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
    OTEL_LOG_LEVEL=error
    OTEL_SERVICE_NAME=<function-name>,
    OTEL_TRACES_EXPORTER=otlp,
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318,
    OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
  }"
```

```mdx-code-block
</TabItem>
<TabItem value="ruby" label="Ruby">
```

```bash
aws lambda update-function-configuration \
  --function-name <function-name> \
  --region ap-south-1 \
  --environment "Variables={
    AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler,
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
    OTEL_LOG_LEVEL=error
    OTEL_SERVICE_NAME=<function-name>,
    OTEL_TRACES_EXPORTER=otlp,
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318,
    OPENTELEMETRY_COLLECTOR_CONFIG_URI=/var/task/collector.yaml
  }"
```

```mdx-code-block
</TabItem>
</Tabs>
```

**Note**: The `OTEL_EXPORTER_OTLP_ENDPOINT` is set to `http://localhost:4318`,
which points to the OTel Collector layer running alongside your Lambda function.

## Step 4: Create Collector Configuration

Create a `collector.yaml` file in your Lambda function package to configure how
the collector exports telemetry to Scout:

```yaml title="collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: localhost:4318
  telemetryapi:

exporters:
  otlphttp:
    endpoint: <scout-backend-endpoint>

service:
  pipelines:
    traces:
      receivers: [otlp, telemetryapi]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp, telemetryapi]
      exporters: [otlphttp]
```

Replace `<scout-backend-endpoint>` with your Scout collector OTLP endpoint

**Deploy the collector config with your function:**

```bash
# Add collector.yaml to your deployment package
zip function.zip lambda_function.* collector.yaml

# Update function code
aws lambda update-function-code \
  --function-name <function-name> \
  --zip-file fileb://function.zip \
  --region ap-south-1
```

## Step 5: Test Your Instrumentation

Invoke your Lambda function to generate traces. You can use the AWS CLI,
AWS Console, or any trigger configured for your function.

View traces in Scout Grafana dashboard

### Resource Attributes

Add custom resource attributes to all spans:

```bash
OTEL_RESOURCE_ATTRIBUTES=environment=production,team=backend
```

## Related Guides

- [OTel Collector Configuration](../../collector-setup/otel-collector-config.md)
  \- Detailed collector setup
- [AWS ECS OTel Setup](../../collector-setup/ecs-setup.md) - Container-based
  deployments
- [Python Custom Instrumentation](../../apps/custom-instrumentation/python.md)
  \- Manual Python tracing
- [Node.js Custom Instrumentation](../../apps/custom-instrumentation/javascript-node.md)
  \- Manual Node.js tracing
- [Java Custom Instrumentation](../../apps/custom-instrumentation/java.md)
  \- Manual Java tracing

## References

- [OpenTelemetry Lambda GitHub](https://github.com/open-telemetry/opentelemetry-lambda)
- [OpenTelemetry Lambda Releases](https://github.com/open-telemetry/opentelemetry-lambda/releases)
