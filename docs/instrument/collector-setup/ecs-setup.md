---
date: 2025-11-19
title: AWS ECS OpenTelemetry Collector Setup
sidebar_label: AWS ECS Setup
description:
  Deploy OpenTelemetry on AWS ECS Fargate and EC2. Complete guide for ECS
  monitoring with traces, metrics, and logs using service, daemon, and sidecar
  modes.
keywords:
  [
    aws ecs monitoring,
    ecs fargate monitoring,
    ecs observability,
    opentelemetry ecs,
    aws fargate monitoring,
  ]
tags: [ecs, opentelemetry, base14 scout]
sidebar_position: 7
---

# AWS ECS

Deploy and configure the Scout Collector on ECS.

## Overview

This guide covers how to collect telemetry data (logs, metrics, and traces) from
your ECS environment and send it to base14 Scout.

- Install base14 Scout's Scout Collector using Task Definitions.
- Configure telemetry collection for ECS Nodes.
- Configure custom metrics endpoints
- Implement trace collection

## Prerequisites

- An ECS cluster
- AWS CLI setup with `ecs:*` permissions.
- Scout account credentials
  - Endpoint URL
  - API Key
  - Token URL
  - Application Name

## Quick Start Guide

Deploy Scout Collector in minutes by following these steps:

### Task Definitions

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
- Ideal for collecting metrics from RDS, ElastiCache, Amazon MQ, and application
  traces

Download the required files:

```shell
curl -o task-definition.json \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/task-definition.json

curl -o scout-service-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/scout-collector-config.yaml
```

:::warning

- This service mode collector can include receivers for AWS services (RDS,
  ElastiCache, Amazon MQ) and external databases.
- Review the configuration to add or remove pipelines based on your monitoring
  needs.
- Visit
  [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  for more details on the configuration.

:::

#### Generate Configuration

Replace the placeholders with your actual values:

```shell
SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-service-collector-config.yaml > scout-service-collector-config.yaml.tmp && \
mv scout-service-collector-config.yaml.tmp scout-service-collector-config.yaml
```

#### Store Configuration in AWS Secrets Manager

```shell
# Create secret for service collector configuration
aws secretsmanager create-secret \
  --name "/ecs/scout/otelcol-service-config" \
  --description "Scout OTEL Service Collector Configuration for Fargate" \
  --secret-string file://scout-service-collector-config.yaml
```

If the secret already exists, update it:

```shell
aws secretsmanager update-secret \
  --secret-id "/ecs/scout/otelcol-service-config" \
  --secret-string file://scout-service-collector-config.yaml
```

#### Get Secret ARN

After creating the secret, retrieve its full ARN (required for task definition):

```shell
aws secretsmanager describe-secret \
  --secret-id "/ecs/scout/otelcol-service-config" \
  --query 'ARN' \
  --output text
```

Save this ARN - you'll need it in the next step.

#### Generate Task Definition

Replace the placeholders with your actual values:

```shell
AWS_TASK_EXECUTION_ROLE='<task execution role ARN>' \
TASK_NAME='Scout_service_collector' \
SERVICE_NAME='Scout_service_collector' \
SECRET_ARN='<secret ARN from previous step>' \
envsubst < task-definition.json > scout-service-collector-task-definition.json
```

:::tip
To find your ECS task execution role ARN:

```shell
aws iam list-roles --query 'Roles[?RoleName==`ecsTaskExecutionRole`].Arn' --output text
```

:::

#### Register Task Definition

Register the task definition with ECS:

```shell
aws ecs register-task-definition \
  --cli-input-json file://scout-service-collector-task-definition.json
```

#### Get Network Configuration

Fargate requires network configuration. Get your VPC subnets and security groups:

```shell
# Get default VPC subnets
aws ec2 describe-subnets \
  --filters "Name=default-for-az,Values=true" \
  --query 'Subnets[*].SubnetId' \
  --output text

# Get the VPC ID from one of the subnets
VPC_ID=$(aws ec2 describe-subnets \
  --subnet-ids <subnet-id-from-above> \
  --query 'Subnets[0].VpcId' \
  --output text)

# Get the default security group for the VPC
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=default" \
  --query 'SecurityGroups[0].GroupId' \
  --output text
```

#### Deploy Service

Create the ECS service with network configuration:

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-service-collector \
  --task-definition Scout_service_collector:1 \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-id-1>,<subnet-id-2>,<subnet-id-3>],securityGroups=[<security-group-id>],assignPublicIp=ENABLED}"
```

:::warning

- Replace `<cluster-name>` with your ECS cluster name
- Replace subnet IDs with the values from the previous step
- Replace security group ID with the value from the previous step
- Ensure all subnets belong to the same VPC as the security group

:::

#### Verify Deployment

Check the service status:

```shell
aws ecs describe-services \
  --cluster <cluster-name> \
  --services scout-service-collector \
  --query 'services[0].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

Wait for the task to reach RUNNING status (may take 1-2 minutes):

```shell
# List running tasks
aws ecs list-tasks \
  --cluster <cluster-name> \
  --service-name scout-service-collector \
  --desired-status RUNNING

# Check task details
aws ecs describe-tasks \
  --cluster <cluster-name> \
  --tasks <task-arn-from-above> \
  --query 'tasks[0].{Status:lastStatus,Health:healthStatus,Container:containers[0].name}' \
  --output table
```

If the task stops or fails, check the stopped reason:

```shell
aws ecs describe-tasks \
  --cluster <cluster-name> \
  --tasks <task-arn> \
  --query 'tasks[0].stoppedReason'
```

</TabItem>
<TabItem value="sidecar" label="Sidecar Mode">

**Best for**: Application-specific telemetry collection

- Runs alongside your application containers in the same task
- Dedicated collector per application task
- Ideal for collecting application traces, logs, and custom metrics

Download the required files:

```shell
curl -o task-definition.json \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/task-definition.json

curl -o scout-sidecar-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/fargate/scout-sidecar-collector-config.yaml
```

:::warning

- The sidecar collector should focus on application-specific telemetry only.
- Avoid including AWS service receivers (RDS, ElastiCache) in sidecar mode to
  prevent duplication.
- Configure this collector to receive OTLP data from your application
  containers.
- Visit
  [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  for more details on the configuration.

:::

#### Generate Configuration

Replace the placeholders with your actual values:

```shell
SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-sidecar-collector-config.yaml > scout-sidecar-collector-config.yaml.tmp && \
mv scout-sidecar-collector-config.yaml.tmp scout-sidecar-collector-config.yaml
```

#### Store Configuration in AWS Secrets Manager

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

#### Generate Task Definition

```shell
export AWS_TASK_EXECUTION_ROLE=<ARN of the task execution Role>

AWS_TASK_EXECUTION_ROLE=${AWS_TASK_EXECUTION_ROLE} \
TASK_NAME='Scout_sidecar_collector' \
SERVICE_NAME='Scout_sidecar_collector' \
SECRET_NAME='/ecs/scout/otelcol-sidecar-config' \
envsubst < task-definition.json > scout-sidecar-collector-task-definition.json
```

#### Add to Your Application Task Definition

Instead of creating a separate service, add the Scout collector container to
your existing application task definition as a sidecar:

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

#### Update IAM Permissions

Your ECS Task Execution Role needs permission to access Secrets Manager.

First, create the IAM policy document:

```shell
cat > /tmp/secrets-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-service-config*",
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-sidecar-config*"
      ]
    }
  ]
}
EOF
```

Replace `<aws-region>` and `<aws-account-id>` with your values:

- Region: The AWS region where you created the secret (e.g., `us-east-1`)
- Account ID: Your 12-digit AWS account ID

Then attach the policy to your task execution role:

```shell
aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name ScoutSecretsAccess \
  --policy-document file:///tmp/secrets-policy.json
```

:::warning Common Error
If you skip this step, your tasks will fail with:
`ResourceInitializationError: unable to retrieve secrets from ssm`

This happens because the task execution role cannot access
the secret stored in Secrets Manager.
:::

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

For managed nodes (EC2), you can deploy the Scout collector in different modes:

<Tabs groupId="deployment-mode">
<TabItem value="service" label="Service Mode" default>

**Best for**: Application-specific telemetry collection and custom
instrumentation

- Runs as a REPLICA service alongside your applications
- Ideal for collecting traces, application logs, and database metrics

Download the required files:

```shell
curl -o task-definition.json \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json

curl -o scout-agent-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-agent-collector-config.yaml
```

:::warning

- Use PostgreSQL, Redis, RabbitMQ, AWS Firehose, etc., receivers in the agent
  collector to avoid data duplication.
- Review the configuration to remove or add new pipelines before proceeding.
- Visit
  [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  for more details on the configuration.

:::

#### Generate Configuration

```shell
SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-agent-collector-config.yaml > scout-agent-collector-config.yaml.tmp && \
mv scout-agent-collector-config.yaml.tmp scout-agent-collector-config.yaml
```

#### Store Configuration in AWS Secrets Manager

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

#### Get Secret ARN

After creating the secret, retrieve its full ARN (required for task definition):

```shell
aws secretsmanager describe-secret \
  --secret-id "/ecs/scout/otelcol-agent-config" \
  --query 'ARN' \
  --output text
```

Save this ARN - you'll need it in the next step.

#### Generate Task Definition

Replace the placeholders with your actual values:

```shell
AWS_TASK_EXECUTION_ROLE='<task execution role ARN>' \
TASK_NAME='Scout_agent_collector' \
SERVICE_NAME='Scout_agent_collector' \
SECRET_ARN='<secret ARN from previous step>' \
envsubst < task-definition.json > scout-agent-collector-task-definition.json
```

:::tip
To find your ECS task execution role ARN:

```shell
aws iam list-roles --query 'Roles[?RoleName==`ecsTaskExecutionRole`].Arn' --output text
```

:::

#### Register Task Definition

Register the task definition with ECS:

```shell
aws ecs register-task-definition \
  --cli-input-json file://scout-agent-collector-task-definition.json
```

#### Deploy Service

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-agent-collector \
  --task-definition Scout_agent_collector:1 \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type EC2
```

#### Verify Deployment

Check the service status:

```shell
aws ecs describe-services \
  --cluster <cluster-name> \
  --services scout-agent-collector \
  --query 'services[0].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

</TabItem>
<TabItem value="daemon" label="Daemon Mode">

**Best for**: Infrastructure monitoring and system-level metrics

- Runs one collector per EC2 instance using DAEMON strategy
- Ideal for collecting ECS container metrics, host metrics, and system logs

Download the required files:

```shell
curl -o task-definition.json \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json

curl -o scout-daemon-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-daemon-collector-config.yaml
```

:::warning

- The daemon collector focuses on infrastructure metrics and should not include
  application-specific receivers.
- Review the configuration to remove or add new pipelines before proceeding.
- Visit
  [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  for more details on the configuration.

:::

#### Generate Configuration

```shell
SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-daemon-collector-config.yaml > scout-daemon-collector-config.yaml.tmp && \
mv scout-daemon-collector-config.yaml.tmp scout-daemon-collector-config.yaml
```

#### Store Configuration in AWS Secrets Manager

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

#### Get Secret ARN

After creating the secret, retrieve its full ARN (required for task definition):

```shell
aws secretsmanager describe-secret \
  --secret-id "/ecs/scout/otelcol-daemon-config" \
  --query 'ARN' \
  --output text
```

Save this ARN - you'll need it in the next step.

#### Generate Task Definition

Replace the placeholders with your actual values:

```shell
AWS_TASK_EXECUTION_ROLE='<task execution role ARN>' \
TASK_NAME='Scout_daemon_collector' \
SERVICE_NAME='Scout_daemon_collector' \
SECRET_ARN='<secret ARN from previous step>' \
envsubst < task-definition.json > scout-daemon-collector-task-definition.json
```

:::tip
To find your ECS task execution role ARN:

```shell
aws iam list-roles --query 'Roles[?RoleName==`ecsTaskExecutionRole`].Arn' --output text
```

:::

#### Register Task Definition

Register the task definition with ECS:

```shell
aws ecs register-task-definition \
  --cli-input-json file://scout-daemon-collector-task-definition.json
```

#### Deploy Daemon Service

```shell
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-daemon-collector \
  --task-definition Scout_daemon_collector:1 \
  --scheduling-strategy DAEMON \
  --launch-type EC2
```

#### Verify Deployment

Check the service status:

```shell
aws ecs describe-services \
  --cluster <cluster-name> \
  --services scout-daemon-collector \
  --query 'services[0].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

</TabItem>
<TabItem value="hybrid" label="Hybrid Mode">

**Best for**: Complete observability with both infrastructure and application
telemetry

- Combines both daemon and service deployments
- Daemon collector handles infrastructure metrics
- Service collector handles application telemetry

This approach deploys both daemon and service collectors for comprehensive
monitoring.

Download all required files:

```shell
curl -o task-definition.json \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/task-definition.json

curl -o scout-daemon-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-daemon-collector-config.yaml

curl -o scout-agent-collector-config.yaml \
  https://raw.githubusercontent.com/base-14/docs/main/configs/ecs/ec2/scout-agent-collector-config.yaml
```

:::warning

- Use PostgreSQL, Redis, RabbitMQ, AWS Firehose, etc., receivers in the agent
  collector to avoid data duplication between daemon and agent collectors.
- The daemon collector should focus on infrastructure metrics only.
- Review both configurations to remove or add new pipelines before proceeding.
- Visit
  [docs.base14.io](https://docs.base14.io/instrument/collector-setup/otel-collector-config)
  for more details on the configuration.

:::

#### Generate Configuration

```shell
SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-agent-collector-config.yaml > scout-agent-collector-config.yaml.tmp && \
mv scout-agent-collector-config.yaml.tmp scout-agent-collector-config.yaml

SERVICE_NAME='<service name>' \
ENVIRONMENT='<environment>' \
SCOUT_ENDPOINT='<scout backend endpoint>' \
SCOUT_CLIENT_ID='<client id>' \
SCOUT_CLIENT_SECRET='<client secret>' \
SCOUT_TOKEN_URL='<token url>' \
envsubst < scout-daemon-collector-config.yaml > scout-daemon-collector-config.yaml.tmp && \
mv scout-daemon-collector-config.yaml.tmp scout-daemon-collector-config.yaml
```

#### Store Configurations in AWS Secrets Manager

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

#### Get Secret ARNs

Retrieve the ARNs for both secrets (required for task definitions):

```shell
# Get daemon config secret ARN
aws secretsmanager describe-secret \
  --secret-id "/ecs/scout/otelcol-daemon-config" \
  --query 'ARN' \
  --output text

# Get agent config secret ARN
aws secretsmanager describe-secret \
  --secret-id "/ecs/scout/otelcol-agent-config" \
  --query 'ARN' \
  --output text
```

Save both ARNs - you'll need them in the next step.

#### Generate Both Task Definitions

Replace the placeholders with your actual values:

```shell
# Generate daemon collector task definition
AWS_TASK_EXECUTION_ROLE='<task execution role ARN>' \
TASK_NAME='Scout_daemon_collector' \
SERVICE_NAME='Scout_daemon_collector' \
SECRET_ARN='<daemon secret ARN from previous step>' \
envsubst < task-definition.json > scout-daemon-collector-task-definition.json

# Generate agent collector task definition
AWS_TASK_EXECUTION_ROLE='<task execution role ARN>' \
TASK_NAME='Scout_agent_collector' \
SERVICE_NAME='Scout_agent_collector' \
SECRET_ARN='<agent secret ARN from previous step>' \
envsubst < task-definition.json > scout-agent-collector-task-definition.json
```

:::tip
To find your ECS task execution role ARN:

```shell
aws iam list-roles --query 'Roles[?RoleName==`ecsTaskExecutionRole`].Arn' --output text
```

:::

#### Register Both Task Definitions

Register both task definitions with ECS:

```shell
# Register daemon task definition
aws ecs register-task-definition \
  --cli-input-json file://scout-daemon-collector-task-definition.json

# Register agent task definition
aws ecs register-task-definition \
  --cli-input-json file://scout-agent-collector-task-definition.json
```

#### Deploy Both Services

```shell
# Deploy daemon service (one per EC2 instance)
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-daemon-collector \
  --task-definition Scout_daemon_collector:1 \
  --scheduling-strategy DAEMON \
  --launch-type EC2

# Deploy agent service (replica for applications)
aws ecs create-service \
  --cluster <cluster-name> \
  --service-name scout-agent-collector \
  --task-definition Scout_agent_collector:1 \
  --scheduling-strategy REPLICA \
  --desired-count 1 \
  --launch-type EC2
```

#### Verify Deployments

Check both services status:

```shell
# Check daemon service
aws ecs describe-services \
  --cluster <cluster-name> \
  --services scout-daemon-collector \
  --query 'services[0].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table

# Check agent service
aws ecs describe-services \
  --cluster <cluster-name> \
  --services scout-agent-collector \
  --query 'services[0].{Name:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

</TabItem>
</Tabs>

#### Update IAM Permissions

Your ECS Task Execution Role needs permission to access Secrets Manager.

First, create the IAM policy document (adjust resources based on your
selected deployment mode):

```shell
cat > /tmp/secrets-policy-ec2.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-daemon-config*",
        "arn:aws:secretsmanager:<aws-region>:<aws-account-id>:secret:/ecs/scout/otelcol-agent-config*"
      ]
    }
  ]
}
EOF
```

Then attach the policy to your task execution role:

```shell
aws iam put-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-name ScoutSecretsAccessEC2 \
  --policy-document file:///tmp/secrets-policy-ec2.json
```

:::warning Common Error
If you skip this step, your tasks will fail with:
`ResourceInitializationError: unable to retrieve secrets from ssm`
:::

```mdx-code-block
</TabItem>
</Tabs>
```

That's it, you're done! Go to the Scout Dashboards to see the data flowing.

## Related Guides

- [Scout Exporter Configuration](./scout-exporter.md) - Configure authentication
  to send data to Scout
- [AWS RDS Monitoring](../infra/aws/rds.md) - Monitor your RDS databases
- [Kubernetes Helm Setup](./kubernetes-helm-setup.md) - Alternative container
  orchestration platform
