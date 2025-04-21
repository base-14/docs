---
date: 2025-04-09
id: collecting-ecs-sidecar-infra
title: Collecting Telemetry from ECS using Sidecar Containers
description: Use Scout to monitor your ECS infrastructure with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your ECS
infrastructure using Scout by base14.io. We'll implement the elegant sidecar
pattern—a design where a companion container runs alongside your application
container to handle cross-cutting concerns like monitoring and observability.

Think of the sidecar container as a faithful companion that quietly gathers
metrics, traces, and logs from your application, forwarding them to Scout for
powerful visualization and analysis.

## Setting up Scout with ECS

Let's transform your ECS environment into an observable system with the
following straightforward steps:

- [Checking Prerequisites](#prerequisites)
- [Creating the Scout Collector Configuration](#step-1-create-scout-otelcollector-config)
- [Adding the Sidecar Container](#step-2-create-sidecar-collector-container)
- [Deploying Your Enhanced Task Definition](#step-3-deploy-the-task-definition)
- [Confirming Data Flow to Scout](#step-4-verify-data-in-scout)
- [Enhancing Your Applications with Trace Data](#send-traces-data-from-applications)

### Prerequisites

Before we begin, ensure you have:

- An active ECS cluster with at least one task definition
- Your cluster can be running on **Fargate**, **EC2**, or **External** launch
  types

## Step 1: Create Scout OtelCollector Config

First, we'll create a configuration file that tells the collector how to gather
and forward your telemetry data.

### Creating your Scout configuration in AWS Parameter Store

1. Navigate to AWS Parameter Store and create a new parameter named
   `/ecs/scout/otelcol-sidecar.yaml`

2. `otel-col-sidecar.yaml`:

   ```yaml showLineNumbers
   extensions:
     health_check:

   receivers:
     awsecscontainermetrics:
       collection_interval: 30s
     otlp:
       protocols:
         grpc:
           endpoint: 0.0.0.0:4317
         http:
           endpoint: 0.0.0.0:4318
     fluentforward:
       endpoint: 0.0.0.0:8006

   processors:
     batch:
       timeout: 10s
     filter:
       metrics:
         include:
           match_type: strict
           metric_names:
             - ecs.task.memory.reserved
             - ecs.task.memory.utilized
             - ecs.task.cpu.reserved
             - ecs.task.cpu.utilized
             - ecs.task.network.rate.rx
             - ecs.task.network.rate.tx
             - ecs.task.storage.read_bytes
             - ecs.task.storage.write_bytes
             - container.duration

   exporters:
     otlp:
       endpoint: "<SCOUT_ENDPOINT>:4317"
       tls:
         insecure: true
     debug:
       verbosity: detailed

   service:
     extensions: [ health_check ]
     pipelines:
       traces:
         receivers: [ otlp ]
         processors: [ batch ]
         exporters: [ otlp, debug ]
       metrics:
         receivers: [ otlp ]
         processors: [ batch ]
         exporters: [ otlp, debug ]
       metrics/aws:
         receivers: [ awsecscontainermetrics ]
         processors: [ filter ]
         exporters: [ otlp, debug ]
       logs:
         receivers: [ otlp, fluentforward ]
         processors: [ batch ]
         exporters: [ otlp, debug ]
   ```

3. Personalize the configuration by replacing:

    - `<SCOUT_ENDPOINT>` with your Scout Collector Endpoint

4. Copy this tailored configuration into the parameter value field you created
   in step 1

> **Pro tip:** Once your setup is stable, you can reduce noise by removing the
`logging` exporter from the configuration's pipeline sections.

## Step 2: Create Sidecar Collector Container

Now, we'll integrate the Scout collector as a sidecar to your existing
application. This collector will silently gather metrics and serve as a gateway
for all telemetry data.

## Common Setup Steps

### Enhance Your Task Definition

Add the following container definition to your ECS task definition. This creates
the Scout collector sidecar that will work in harmony with your application:

```json
{
  "name": "scout-collector",
  "image": "otel/opentelemetry-collector-contrib:0.123.0",
  "command": [
    "--config=env:SCOUT_CONFIG_CONTENT"
  ],
  "secrets": [
    {
      "name": "SCOUT_CONFIG_CONTENT",
      "valueFrom": "/ecs/scout/otelcol-sidecar.yaml"
    }
  ],
  "memory": 1024,
  "cpu": 512,
  "essential": true,
  "portMappings": [
    {
      "protocol": "tcp",
      "containerPort": 4317
    },
    {
      "protocol": "tcp",
      "containerPort": 4318
    }
  ],
  "healthCheck": {
    "command": [
      "CMD-SHELL",
      "wget -qO- http://localhost:13133/ || exit 1"
    ],
    "interval": 5,
    "timeout": 6,
    "retries": 5,
    "startPeriod": 1
  },
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/scout-otel-EC2-sidcar",
      "awslogs-region": "<aws-region>",
      "awslogs-stream-prefix": "ecs",
      "awslogs-create-group": "True"
    }
  }
}
```

This sidecar definition contains all the necessary components for the Scout
collector to function effectively: the container image, configuration sourcing,
resource allocations, network endpoints, health monitoring, and log management.

### Configure Task Execution Permissions

Your ECS Task Execution Role needs permission to access the Scout configuration.
You have two elegant options:

### Option 1: Attach AWS Managed Policies

- Add `AmazonSSMReadOnlyAccess` for Parameter Store access
- Add `CloudWatchLogsFullAccess` for log management

**Option 2: Create a Precise Inline Policy**
For those who prefer the principle of least privilege:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": [
        "arn:aws:ssm:<aws-region>:<aws-account-id>:parameter/ecs/scout/otelcol-sidecar.yaml"
      ],
      "Effect": "Allow"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:CreateLogGroup",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams",
        "logs:DescribeLogGroups"
      ],
      "Resource": "*"
    }
  ]
}
```

### Update Task Role Permissions

Similarly, your ECS Task Role (distinct from the Execution Role) needs
appropriate permissions:

1. Locate your task role in the IAM console
2. Either attach the managed policies mentioned above or create an inline policy
   using the JSON template provided

## Step 3: Deploy the Task Definition

With your enhanced task definition ready:

- For ECS services: Update your service to use the new task definition revision
- For standalone tasks: Launch a new task with the updated definition

> **Note:** Once deployed, you can monitor the Scout collector's health through
> CloudWatch Logs under the group specified in your task definition.

## Step 4: Verify Data in Scout

To confirm your setup is working:

1. Navigate to the Dashboard section in Scout
2. You should see your container metrics flowing in

> Your ECS infrastructure metrics beautifully visualized in Scout

---

## Send Traces Data from Applications

Now, let's enhance your applications with distributed tracing capabilities.

### Instrument Your Application

Add OpenTelemetry instrumentation to your application to capture valuable trace
data:

1. Follow
   the [Scout instrumentation guide](https://docs.base14.io/category/observe)
   to add the OpenTelemetry SDK to your application
2. Rebuild your application with these changes

### Configure the OTLP Endpoint

Tell your application where to send the trace data by adding environment
variables to your task definition:

**For Bridge Network Mode:**

```json
{
  "environment": [
    {
      "name": "OTEL_EXPORTER_OTLP_ENDPOINT",
      "value": "http://scout-collector:4317"
    },
    {
      "name": "OTEL_RESOURCE_ATTRIBUTES",
      "value": "service.name=<your-service-name>"
    }
  ],
  "links": [
    "scout-collector"
  ]
}
```

**For AWS VPC Network Mode:**

```json
{
  "environment": [
    {
      "name": "OTEL_EXPORTER_OTLP_ENDPOINT",
      "value": "http://localhost:4317"
    },
    {
      "name": "OTEL_RESOURCE_ATTRIBUTES",
      "value": "service.name=<your-service-name>"
    }
  ]
}
```

After deploying these changes, generate some traffic to your application and
check the Services section in Scout to see your application's traces.

---

With this setup complete, you've transformed your ECS environment into a fully
observable system. Scout now provides you with comprehensive insights into your
application's performance, behavior, and health—all without modifying your core
application logic.
