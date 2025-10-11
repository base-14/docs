---
title: AWS ECS OpenTelemetry Collector Setup | base14 Scout
description: Deploy OpenTelemetry on AWS ECS Fargate and EC2. Complete guide for ECS monitoring with logs, metrics, and traces using service, daemon, and sidecar modes.
keywords: [aws ecs monitoring, ecs fargate monitoring, ecs observability, opentelemetry ecs, aws fargate monitoring]
tags: [ecs, opentelemetry, base14 scout]
sidebar_position: 7
hide_table_of_contents: true
---

# AWS ECS

Deploy and configure the OpenTelemetry Collector on ECS.

## Overview

This guide covers how to collect telemetry data (logs, metrics, and traces)
from your ECS environment and send it to base14 Scout.

- Install base14 Scout's OpenTelemetry Collector using Task Defintions.
- Configure telemetry collection for ECS Nodes.
- Configure custom metrics endpoints
- Implement trace collection

## Prerequisites

- A ECS cluster
- Aws cli setup with permissions `ecs:*` permissions.
- Scout account credentials
  - Endpoint URL
  - API Key
  - Token URL
  - Application Name

## Quick Start Guide

Deploy base14 Scout OpenTelemetry Collectorin minutes by following these
steps:

## Task Defintions

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="fargate" label="Fargate">
```

For Fargate, you can deploy the Scout collector in different modes:

<Tabs groupId="fargate-deployment-mode">
<TabItem value="service" label="Service Mode" default>

**Best for**: Centralized telemetry collection and processing
- Runs as a standalone REPLICA service
- Collects telemetry from multiple applications and AWS services
- Ideal for collecting metrics from RDS, ElastiCache, Amazon MQ, and application traces

Download the required files:

```shell
curl -o task-definition.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/task-definition.json
curl -o scout-agent-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/scout-collector-config.yaml
```

:::warning

- This service mode collector can include receivers for AWS services (RDS, ElastiCache, Amazon MQ) and external databases.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl` placeholders with actual values.
- Review the configuration to add or remove pipelines based on your monitoring needs.
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

### Store Configuration in AWS Secrets Manager

```shell
# Create secret for service collector configuration
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-service-config" \
  --description "Scout OTEL Service Collector Configuration for Fargate" \
  --secret-string file://scout-agent-collector-config.yaml
```

If the secret already exists, update it:

```shell
aws secretsmanager update-secret \
  --secret-id "/ecs/scout/otelcol-service-config" \
  --secret-string file://scout-agent-collector-config.yaml
```

### Generate Task Definition

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_service_collector' \
SERVICE_NAME='Scout_service_collector' \
SECRET_NAME='/ecs/scout/otelcol-service-config' \
envsubst < task-definition.json > scout-service-collector-task-definition.json
```

### Deploy Service

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-service-collector \
  --task-definition scout-service-collector-task-definition \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type FARGATE
```

</TabItem>
<TabItem value="sidecar" label="Sidecar Mode">

**Best for**: Application-specific telemetry collection
- Runs alongside your application containers in the same task
- Dedicated collector per application task
- Ideal for collecting application traces, logs, and custom metrics

Download the required files:

```shell
curl -o task-definition.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/task-definition.json
curl -o scout-sidecar-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/scout-collector-config.yaml
```

:::warning

- The sidecar collector should focus on application-specific telemetry only.
- Avoid including AWS service receivers (RDS, ElastiCache) in sidecar mode to prevent duplication.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl` placeholders with actual values.
- Configure this collector to receive OTLP data from your application containers.
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

### Store Configuration in AWS Secrets Manager

```shell
# Create secret for sidecar collector configuration
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-sidecar-config" \
  --description "Scout OTEL Sidecar Collector Configuration for Fargate" \
  --secret-string file://scout-sidecar-collector-config.yaml
```

If the secret already exists, update it:

```shell
aws secretsmanager update-secret \
  --secret-id "/ecs/scout/otelcol-sidecar-config" \
  --secret-string file://scout-sidecar-collector-config.yaml
```

### Generate Task Definition

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_sidecar_collector' \
SERVICE_NAME='Scout_sidecar_collector' \
SECRET_NAME='/ecs/scout/otelcol-sidecar-config' \
envsubst < task-definition.json > scout-sidecar-collector-task-definition.json
```

### Add to Your Application Task Definition

Instead of creating a separate service, add the Scout collector container to your existing application task definition as a sidecar:

```json
{
  "name": "scout-sidecar-collector",
  "image": "otel/opentelemetry-collector-contrib:0.130.0",
  "essential": false,
  "secrets": [
    {
      "name": "SCOUT_CONFIG_CONTENT",
      "valueFrom": "/ecs/scout/otelcol-sidecar-config"
    }
  ],
  "command": ["--config=env:SCOUT_CONFIG_CONTENT"],
  "portMappings": [
    {
      "containerPort": 4317,
      "protocol": "tcp"
    },
    {
      "containerPort": 4318,
      "protocol": "tcp"
    }
  ]
}
```

</TabItem>
</Tabs>

### Update IAM Permissions

Ensure your ECS Task Execution Role has permission to access the secrets (adjust resources based on your selected deployment mode):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-service-config*",
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-sidecar-config*"
      ]
    }
  ]
}
```

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

For managed nodes (EC2), you can deploy the Scout collector in different modes:

<Tabs groupId="deployment-mode">
<TabItem value="service" label="Service Mode" default>

**Best for**: Application-specific telemetry collection and custom instrumentation
- Runs as a REPLICA service alongside your applications
- Ideal for collecting traces, application logs, and database metrics

Download the required files:

```shell
curl -o task-definition.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json
curl -o scout-agent-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-agent-collector-config.yaml
```

:::warning

- Use PostgreSQL, Redis, RabbitMQ, AWS Firehose, etc., receivers in the agent
  collector to avoid data duplication.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl`
  placeholders with their actual values.
- Review the configuration to remove or add new pipelines before proceeding.
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

### Store Configuration in AWS Secrets Manager

```shell
# Create secret for agent collector configuration
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-agent-config" \
  --description "Scout OTEL Agent Collector Configuration for EC2" \
  --secret-string file://scout-agent-collector-config.yaml
```

If the secret already exists, update it:

```shell
aws secretsmanager update-secret \
  --secret-id "/ecs/scout/otelcol-agent-config" \
  --secret-string file://scout-agent-collector-config.yaml
```

### Generate Task Definition

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_agent_collector' \
SERVICE_NAME='Scout_agent_collector' \
SECRET_NAME='/ecs/scout/otelcol-agent-config' \
envsubst < task-definition.json > scout-agent-collector-task-definition.json
```

### Deploy Service

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-agent-collector \
  --task-definition scout-agent-collector-task-definition \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type EC2
```

</TabItem>
<TabItem value="daemon" label="Daemon Mode">

**Best for**: Infrastructure monitoring and system-level metrics
- Runs one collector per EC2 instance using DAEMON strategy
- Ideal for collecting ECS container metrics, host metrics, and system logs

Download the required files:

```shell
curl -o task-definition.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json
curl -o scout-daemon-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-daemon-collector-config.yaml
```

:::warning

- The daemon collector focuses on infrastructure metrics and should not include application-specific receivers.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl`
  placeholders with their actual values.
- Review the configuration to remove or add new pipelines before proceeding.
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

### Store Configuration in AWS Secrets Manager

```shell
# Create secret for daemon collector configuration
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-daemon-config" \
  --description "Scout OTEL Daemon Collector Configuration for EC2" \
  --secret-string file://scout-daemon-collector-config.yaml
```

If the secret already exists, update it:

```shell
aws secretsmanager update-secret \
  --secret-id "/ecs/scout/otelcol-daemon-config" \
  --secret-string file://scout-daemon-collector-config.yaml
```

### Generate Task Definition

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_daemon_collector' \
SERVICE_NAME='Scout_daemon_collector' \
SECRET_NAME='/ecs/scout/otelcol-daemon-config' \
envsubst < task-definition.json > scout-daemon-collector-task-definition.json
```

### Deploy Daemon Service

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-daemon-collector \
  --task-definition scout-daemon-collector-task-definition \
  --scheduling-strategy DAEMON \
  --launch-type EC2
```

</TabItem>
<TabItem value="hybrid" label="Hybrid Mode">

**Best for**: Complete observability with both infrastructure and application telemetry
- Combines both daemon and service deployments
- Daemon collector handles infrastructure metrics
- Service collector handles application telemetry

This approach deploys both daemon and service collectors for comprehensive monitoring.

Download all required files:

```shell
curl -o task-definition.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json
curl -o scout-daemon-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-daemon-collector-config.yaml
curl -o scout-agent-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-agent-collector-config.yaml
```

:::warning

- Use PostgreSQL, Redis, RabbitMQ, AWS Firehose, etc., receivers in the agent
  collector to avoid data duplication between daemon and agent collectors.
- The daemon collector should focus on infrastructure metrics only.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl`
  placeholders with their actual values in both configurations.
- Review both configurations to remove or add new pipelines before proceeding.
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

### Store Configurations in AWS Secrets Manager

```shell
# Create secrets for both daemon and agent collector configurations
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-daemon-config" \
  --description "Scout OTEL Daemon Collector Configuration for EC2" \
  --secret-string file://scout-daemon-collector-config.yaml

aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-agent-config" \
  --description "Scout OTEL Agent Collector Configuration for EC2" \
  --secret-string file://scout-agent-collector-config.yaml
```

### Generate Both Task Definitions

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

# Generate daemon collector task definition
AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_daemon_collector' \
SERVICE_NAME='Scout_daemon_collector' \
SECRET_NAME='/ecs/scout/otelcol-daemon-config' \
envsubst < task-definition.json > scout-daemon-collector-task-definition.json

# Generate agent collector task definition
AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_agent_collector' \
SERVICE_NAME='Scout_agent_collector' \
SECRET_NAME='/ecs/scout/otelcol-agent-config' \
envsubst < task-definition.json > scout-agent-collector-task-definition.json
```

### Deploy Both Services

```shell
# Deploy daemon service (one per EC2 instance)
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-daemon-collector \
  --task-definition scout-daemon-collector-task-definition \
  --scheduling-strategy DAEMON \
  --launch-type EC2

# Deploy agent service (replica for applications)
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-agent-collector \
  --task-definition scout-agent-collector-task-definition \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type EC2
```

</TabItem>
</Tabs>

### Update IAM Permissions

Ensure your ECS Task Execution Role has permission to access the secrets (adjust resources based on your selected deployment mode):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-daemon-config*",
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-agent-config*"
      ]
    }
  ]
}
```

```mdx-code-block
</TabItem>
</Tabs>
```

That's it you are done, Go to the Scout Grafana Dashboards to see the data flowing
