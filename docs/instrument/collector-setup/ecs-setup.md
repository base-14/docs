---
keywords: [ecs, opentelemetry, otel-collector, scout]
tags: [ecs, opentelemetry, base14 scout]
sidebar_position: 7
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

In Fargate, we'll have a single task definition which we willl use to deploy the
scout collector using the REPLICA Strategy which will collect all the application
telemetry data and from other services like rds, elasticache, amazonmq.

Download the `task-definition.json`

```shell
curl -o task-defintion.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/task-definition.json
```

Download the `scout-agent-collector-config.yaml`

```shell
curl -o scout-agent-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/scout-agent-collector-config.yaml
```

:::warning

- Replace the clientId, clientSecret, Endpoint,
  TokenUrl placeholders with the actual value. \
- Go through the config once before continuing
  further to remove or add new pipelines \
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  to more about the config

:::

Run the below commands to generate the task defintion for scout collector

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_collector' \
SERVICE_NAME='Scout_collector' \
SCOUT_CONFIG_CONTENT=$(cat scout-collector-config.yaml | awk 'BEGIN {ORS="\\n"} {print}' | sed 's/"/\\"/g') \
envsubst < task-definition.json > scout-collector-task-definiton.json

```

You will now have a task defintions, Copy the contents of it
and create a task deinition in aws console and run the below
commands to create a service and deploy it to an ecs cluster

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-collector \
  --task-definition scout-collector-task-definiton \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type FARGATE
```

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

In the case of managed nodes, we'll use two Task Definitions. One deploys
OpenTelemetry collectors using the DAEMON strategy, and the other uses the
REPLICA strategy. The replica collector acts as an agent collector, while the
daemon collector retrieves node metrics.

Download the `task-definition.json`

```shell
curl -o task-defintion.json https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json
```

Download the `scout-daemon-collector-config.yaml`

```shell
curl -o scout-daemon-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-daemon-collector-config.yaml
```

Download the `scout-agent-collector-config.yaml`

```shell
curl -o scout-agent-collector-config.yaml https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-agent-collector-config.yaml
```

:::warning

- Use PostgreSQL, Redis, RabbitMQ, AWS Firehose, etc., receivers in the agent
  collector to avoid data duplication.
- Replace the `clientId`, `clientSecret`, `Endpoint`, and `TokenUrl`
  placeholders with their actual values.
- Review the configuration to remove or add new pipelines before proceeding.
<!-- markdownlint-disable-next-line MD013 -->
- Visit [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config) for more details on the configuration.

:::

Run the commands below to generate task definitions for both daemon and agent
OpenTelemetry collectors.

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_daemon_collector' \
SERVICE_NAME='Scout_daemon_collector' \
SCOUT_CONFIG_CONTENT=$(cat scout-daemon-collector-config.yaml | awk 'BEGIN {ORS="\\n"} {print}' | sed 's/"/\\"/g') \
envsubst < task-definition.json > scout-daemon-collector-task-definiton.json

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_agent_collector' \
SERVICE_NAME='Scout_agent_collector' \
SCOUT_CONFIG_CONTENT=$(cat scout-agent-collector-config.yaml | awk 'BEGIN {ORS="\\n"} {print}' | sed 's/"/\\"/g') \
envsubst < task-definition.json > scout-agent-collector-task-definiton.json
```

You will now have two task defintions, Copy the contents of
it and create a task deinition in aws console and run the
below commands to create a service and deploy it to an ecs cluster

```shell
aws ecs create-service \
  --cluster <cluster name> \
  --service-name scout-daemon-collector \
  --task-definition scout-daemon-collector-task-definiton \
  --scheduling-strategy DAEMON \
  --launch-type EC2

aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-agent-collector \
  --task-definition scout-agent-collector-task-definiton \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type EC2
```

```mdx-code-block
</TabItem>
</Tabs>
```

That's it you are done, Go to the Scout Grafana Dashboards to see the data flowing
