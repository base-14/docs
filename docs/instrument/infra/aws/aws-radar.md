---
id: aws-radar
title: Scout AWS Radar - resource inventory and cost metrics
sidebar_label: AWS Radar
sidebar_position: 8
description:
  Deploy AWS Radar to collect AWS resource counts and cost metrics across ~85
  services and send them to base14 Scout. Helm install, the read-only IAM
  policy it needs, and Cost Explorer and CUR 2.0 setup.
keywords:
  [
    aws radar,
    aws resource inventory,
    aws cost metrics,
    aws cost and usage report,
    cur 2.0,
    aws radar iam policy,
    aws prometheus metrics,
    base14 scout aws,
  ]
---

## Overview

AWS Radar is a lightweight agent that polls the AWS APIs on an interval and
exposes **resource counts** (how many EC2 instances, RDS clusters, S3 buckets,
Lambda functions, and so on) and **cost metrics** in Prometheus format. Point
your OpenTelemetry Collector at its `/metrics` endpoint and the inventory and
spend of an AWS account land in base14 Scout alongside the rest of your
telemetry.

It reads across **~85 AWS services** and never writes - every permission it
needs is a `List`, `Describe`, or `Get`. The reader profile is **DevOps and SRE
engineers** running one or more AWS accounts who want inventory and cost on the
same dashboards as their logs, metrics, and traces.

:::tip TL;DR

- Deploy the Helm chart from `charts.base14.io` into your cluster.
- Hand it the keys of a **read-only** IAM user (managed `ReadOnlyAccess`, or the
  least-privilege policy below).
- Have the Collector scrape its `/metrics` endpoint and export to Scout.
- Optionally enable **Cost Explorer** and **CUR 2.0** for spend metrics - each
  needs a small extra grant.

:::

## What it looks like

Once AWS Radar is scraping into Scout, you can build cost and inventory
dashboards from its metrics - month-to-date and amortized spend, cost by
service and region, and the daily trend of unblended vs amortized cost:

<img
  src="/img/aws-radar/cost-dashboard.png"
  alt="Scout AWS Radar cost dashboard with spend by service, region, and day"
/>

## How it works

```text
          read-only AWS APIs
AWS Radar ─────────────────▶ EC2, RDS, S3, Lambda, ... (List/Describe/Get)
    │
    │ /metrics (Prometheus, :9090)
    ▼
OTel Collector ──(OTLP)──▶ base14 Scout
 (prometheus receiver)
```

AWS Radar runs one `Deployment` per **instance** (one AWS account), each with
its own `ConfigMap`, `Service`, and - when you let the chart manage it - a
`Secret` holding that account's credentials. The Collector's `prometheus`
receiver scrapes each instance's `Service` and forwards the metrics to Scout
through the [Scout OTLP exporter](../../collector-setup/scout-exporter.md).

## Prerequisites

- A Kubernetes cluster with the OpenTelemetry Collector already sending to Scout
  (see [Collector setup](../../collector-setup/otel-collector-config.md)).
- Permission to create an IAM user and policy in each AWS account you want to
  watch.
- `helm` 3.x.

## Install with Helm

The chart is published to the base14 public Helm repository.

```bash
helm repo add base14 https://charts.base14.io
helm repo update
```

### 1. Create the credentials Secret

AWS Radar reads each account with an IAM user's access keys. Create the Secret
in the target namespace:

```bash
kubectl create namespace aws-radar

kubectl create secret generic aws-radar-credentials \
  --namespace aws-radar \
  --from-literal=AWS_ACCESS_KEY_ID=AKIA... \
  --from-literal=AWS_SECRET_ACCESS_KEY=...
```

:::note

Using an external secrets manager? Point your `ExternalSecret` at a Secret with
the same two keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) and reference
it by name below - the chart will skip creating its own Secret.

:::

### 2. Write a values file

```yaml
# values.yaml
instances:
  - name: prod
    awsAccountName: my-prod-account      # labels every metric from this account
    secrets:
      awsCredentials:
        secretName: aws-radar-credentials
    aws:
      regions:
        - us-east-1
        - eu-west-1

common:
  # Poll interval. Longer intervals cost fewer API calls; tune per account.
  collection:
    interval: 1h
```

By default AWS Radar scans every supported service. Narrow the set per instance
with a `collectors:` list (for example `collectors: [ec2, s3, rds, lambda]`) if
you only care about a subset.

### 3. Install

```bash
helm install aws-radar base14/aws-radar \
  --namespace aws-radar \
  -f values.yaml
```

### 4. Scrape it into Scout

AWS Radar exposes metrics on port `9090` at `/metrics`. Add the `aws-radar`
`Service` as a scrape target on your Collector's `prometheus` receiver and send
the result through the Scout exporter:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: aws-radar
          scrape_interval: 60s
          static_configs:
            - targets: ['aws-radar-prod.aws-radar.svc:9090']
```

For the full pipeline, see
[OTel Collector configuration](../../collector-setup/otel-collector-config.md).

## IAM permissions

AWS Radar is **read-only**. Create one IAM user per account, attach a policy,
and put its access keys in the Secret above.

### Quick path - AWS managed policy

Attach the AWS-managed `ReadOnlyAccess` policy. It is broader than AWS Radar
needs, but it is one line and always covers newly added collectors:

```bash
aws iam attach-user-policy \
  --user-name aws-radar \
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
```

### Least-privilege path - custom policy

For a tightly scoped user, attach only the actions AWS Radar actually calls -
one `List`/`Describe`/`Get` per service, plus `tag:GetResources` and
`sts:GetCallerIdentity`:

<details>
<summary>AWS Radar read-only policy (149 actions)</summary>

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AWSRadarReadOnly",
            "Effect": "Allow",
            "Action": [
                "tag:GetResources",
                "apigateway:GET",
                "autoscaling:DescribeAutoScalingGroups",
                "autoscaling:DescribePolicies",
                "autoscaling:DescribeLifecycleHooks",
                "autoscaling:DescribeWarmPool",
                "autoscaling:DescribeInstanceRefreshes",
                "athena:ListWorkGroups",
                "apprunner:ListServices",
                "mq:ListBrokers",
                "ses:ListEmailIdentities",
                "ses:ListConfigurationSets",
                "ses:ListContactLists",
                "ses:GetEmailIdentity",
                "ses:GetConfigurationSet",
                "ses:GetConfigurationSetEventDestinations",
                "ses:ListSuppressedDestinations",
                "ses:ListDedicatedIpPools",
                "ses:GetAccount",
                "cloudformation:ListStacks",
                "rds:DescribeDBClusters",
                "rds:DescribeDBInstances",
                "rds:DescribeDBProxies",
                "rds:DescribeDBProxyTargets",
                "memorydb:DescribeClusters",
                "timestream:DescribeEndpoints",
                "timestream:ListDatabases",
                "timestream:ListTables",
                "fsx:DescribeFileSystems",
                "backup:ListBackupVaults",
                "kinesis:ListStreams",
                "firehose:ListDeliveryStreams",
                "kinesisanalytics:ListApplications",
                "kinesisvideo:ListStreams",
                "elasticmapreduce:ListClusters",
                "elasticbeanstalk:DescribeApplications",
                "kms:ListKeys",
                "cloudtrail:DescribeTrails",
                "cloudtrail:ListEventDataStores",
                "batch:DescribeJobQueues",
                "ecr:DescribeRepositories",
                "ecr:GetRepositoryPolicy",
                "ecr-public:DescribeRepositories",
                "ec2:DescribeInstances",
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeNatGateways",
                "ec2:DescribeInternetGateways",
                "ec2:DescribeVolumes",
                "ec2:DescribeVpcEndpoints",
                "ec2:DescribeTransitGateways",
                "ec2:DescribeVpnGateways",
                "elasticfilesystem:DescribeFileSystems",
                "events:ListEventBuses",
                "events:ListRules",
                "glue:GetJobs",
                "codebuild:ListProjects",
                "codepipeline:ListPipelines",
                "codedeploy:ListApplications",
                "transfer:ListServers",
                "kafka:ListClustersV2",
                "redshift:DescribeClusters",
                "s3:ListAllMyBuckets",
                "s3:GetBucketLocation",
                "s3:GetBucketPublicAccessBlock",
                "s3:ListAccessPoints",
                "s3:ListStorageLensConfigurations",
                "lambda:ListFunctions",
                "ecs:ListClusters",
                "ecs:DescribeClusters",
                "ecs:ListServices",
                "ecs:DescribeServices",
                "ecs:ListTasks",
                "ecs:DescribeTasks",
                "ecs:DescribeTaskDefinition",
                "ecs:DescribeCapacityProviders",
                "ecs:ListTaskDefinitions",
                "eks:ListClusters",
                "eks:DescribeCluster",
                "elasticloadbalancing:DescribeLoadBalancers",
                "elasticloadbalancingv2:DescribeLoadBalancers",
                "elasticloadbalancingv2:DescribeListeners",
                "elasticloadbalancingv2:DescribeTargetGroups",
                "elasticloadbalancingv2:DescribeRules",
                "dynamodb:ListTables",
                "dynamodb:DescribeTable",
                "elasticache:DescribeCacheClusters",
                "elasticache:DescribeReplicationGroups",
                "elasticache:DescribeGlobalReplicationGroups",
                "elasticache:DescribeServerlessCaches",
                "es:ListDomainNames",
                "guardduty:ListDetectors",
                "securityhub:GetEnabledStandards",
                "inspector2:ListCoverage",
                "macie2:ListClassificationJobs",
                "wafv2:ListWebACLs",
                "secretsmanager:ListSecrets",
                "ssm:DescribeParameters",
                "ssm:ListDocuments",
                "ssm:DescribeMaintenanceWindows",
                "ssm:ListAssociations",
                "ssm:DescribePatchBaselines",
                "states:ListStateMachines",
                "sqs:ListQueues",
                "sqs:GetQueueAttributes",
                "sns:ListTopics",
                "sns:GetTopicAttributes",
                "cognito-idp:ListUserPools",
                "cognito-idp:DescribeUserPool",
                "cognito-identity:ListIdentityPools",
                "network-firewall:ListFirewalls",
                "network-firewall:ListFirewallPolicies",
                "network-firewall:ListRuleGroups",
                "fms:ListPolicies",
                "acm-pca:ListCertificateAuthorities",
                "servicecatalog:ListPortfolios",
                "servicecatalog:SearchProductsAsAdmin",
                "servicecatalog:SearchProvisionedProducts",
                "license-manager:ListLicenseConfigurations",
                "cloudfront:ListDistributions",
                "route53:ListHostedZones",
                "route53resolver:ListResolverEndpoints",
                "route53resolver:ListResolverRules",
                "acm:ListCertificates",
                "acm:DescribeCertificate",
                "iam:ListUsers",
                "iam:ListRoles",
                "iam:ListAccountAliases",
                "shield:DescribeSubscription",
                "directconnect:DescribeConnections",
                "organizations:ListAccounts",
                "organizations:ListRoots",
                "organizations:ListOrganizationalUnitsForParent",
                "controltower:ListLandingZones",
                "controltower:GetLandingZone",
                "config:DescribeConfigurationRecorders",
                "aoss:ListCollections",
                "bedrock:ListCustomModels",
                "sagemaker:ListEndpoints",
                "quicksight:ListDashboards",
                "workspaces:DescribeWorkspaces",
                "appstream:DescribeFleets",
                "connect:ListInstances",
                "amplify:ListApps",
                "globalaccelerator:ListAccelerators",
                "datasync:ListTasks",
                "dms:DescribeReplicationInstances",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

</details>

Cost metrics need two **optional** extra grants - add them only when you enable
the matching feature.

| Feature | Extra permission | When |
| ------- | ---------------- | ---- |
| Cost Explorer | `ce:GetCostAndUsage` | `cost_explorer.enabled: true` |
| Cost and Usage Report | `s3:GetObject`, `s3:ListBucket` on the CUR bucket | `cost_cur.enabled: true` |

## Cost metrics

AWS Radar reports spend two ways. Pick one - CUR is cheaper and more granular,
Cost Explorer is quicker to turn on.

### Cost Explorer

The simplest cost source. Grant the user `ce:GetCostAndUsage` and enable it:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AWSRadarCostExplorer",
            "Effect": "Allow",
            "Action": ["ce:GetCostAndUsage"],
            "Resource": "*"
        }
    ]
}
```

```yaml
common:
  costExplorer:
    enabled: true
    frequency: daily     # hourly | daily | weekly | monthly
```

:::note

Every Cost Explorer `GetCostAndUsage` call is billable (about $0.01). Keep
`frequency` coarse unless you need fresher numbers.

:::

### Cost and Usage Report (CUR 2.0)

CUR 2.0 (AWS **Data Exports**) delivers a detailed, per-resource cost dataset to
an S3 bucket as parquet, with no per-query charge. AWS Radar reads the export
directly. This is the recommended path for cost attribution.

CUR / Data Exports is **global and lives only in `us-east-1`**, regardless of
where your resources run - create the bucket and export there.

**1. Create the bucket and export.** In the AWS console go to **Billing and Cost
Management → Data Exports → Create export**, choose **Standard data export**
(CUR 2.0), and point it at an S3 bucket in `us-east-1`. Use **parquet**, enable
**include resource IDs**, and set hourly granularity so cost can be attributed
per resource. Note the bucket, prefix, and export name.

**2. Grant AWS Radar read access** via the bucket policy (the delivery statement
is added for you when the export is created; add the read statement for the
`aws-radar` user):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowRadarRead",
            "Effect": "Allow",
            "Principal": { "AWS": "arn:aws:iam::<ACCOUNT_ID>:user/aws-radar" },
            "Action": ["s3:GetObject", "s3:ListBucket"],
            "Resource": [
                "arn:aws:s3:::<CUR_BUCKET>",
                "arn:aws:s3:::<CUR_BUCKET>/*"
            ]
        }
    ]
}
```

**3. Enable `cost_cur` in your values**, pointing at the same bucket, prefix,
and export name:

```yaml
instances:
  - name: prod
    # ...credentials and regions as above...
    costCUR:
      enabled: true
      reportType: cur2             # cur2 for CUR 2.0 / Data Exports
      bucket: your-cur-bucket
      prefix: cur
      reportName: your-export-name
      format: parquet
      region: us-east-1            # CUR lives in us-east-1
      resourceTags: true           # enrich top resources with their tags
```

AWS Radar reads the export from
`s3://<bucket>/<prefix>/<reportName>/...`. With `resourceTags: true` it also
calls `tag:GetResources` (already in the base policy) to attach each resource's
tags to its cost.

## Helm values reference

Common knobs - set under `common` for all instances, or on an `instances[]`
entry to override one account.

| Key | Default | What it does |
| --- | ------- | ------------ |
| `image.repository` | `docker.io/base14/aws-radar` | Container image. |
| `instances[].name` | - | Instance name; becomes part of the resource names. |
| `instances[].awsAccountName` | `""` | Label applied to every metric from this account. |
| `instances[].secrets.awsCredentials.secretName` | `""` | Secret holding `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. |
| `instances[].aws.regions` | `[us-east-1]` | Regions to scan. |
| `common.collection.interval` | `60s` | How often to poll the AWS APIs. |
| `common.collectors` | all services | Narrow the scanned services with a list. |
| `common.costExplorer.enabled` | `false` | Turn on Cost Explorer spend metrics. |
| `common.costCUR.enabled` | `false` | Turn on CUR-based cost metrics. |
| `common.resources` | 128Mi / 256Mi | Pod requests and limits. |

## Container configuration

The container reads a `config.yaml`. When you deploy with the Helm chart it
renders this file into a ConfigMap from the values above - so on Kubernetes you
configure through Helm, not this file directly. Running the image standalone
(Docker, ECS), you write `config.yaml` yourself and mount it, or point
`AWS_RADAR_CONFIG` at it.

### config.yaml

```yaml
server:
  port: 9090
  metrics_path: /metrics
  health_path: /health

collection:
  interval: 60s          # how often to poll the AWS APIs
  timeout: 30s           # per-cycle timeout

aws:
  regions:
    - us-east-1
    - eu-west-1

# Omit `collectors` to scan every supported service.
collectors:
  - ec2
  - s3
  - lambda

cost_explorer:
  enabled: false
  frequency: daily       # hourly | daily | weekly | monthly

cost_cur:
  enabled: false
  report_type: cur2      # cur (legacy CUR) | cur2 (CUR 2.0 / Data Exports)
  bucket: ""
  prefix: cur
  report_name: ""
  format: parquet        # parquet | csv ("" auto-detects from the manifest)
  frequency: daily       # hourly | daily
  region: us-east-1      # CUR lives in us-east-1
  max_resources: 100     # top-N resources to attribute cost to
  resource_tags: false   # enrich those resources with their tags

logging:
  level: info            # debug | info | warn | error
  format: json           # json | text
```

The Helm values map onto these fields - for example `common.collection.interval`
sets `collection.interval`, and `instances[].costCUR.reportType` sets
`cost_cur.report_type`.

### Environment variables

| Variable | Description |
| -------- | ----------- |
| `AWS_ACCESS_KEY_ID` | AWS access key. Required. |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key. Required. |
| `AWS_REGION` | Default region, used when none is set in `config.yaml`. Optional. |
| `AWS_RADAR_CONFIG` | Path to the config file, overriding the default `./config.yaml` and `/app/config.yaml` lookup. |
| `AWS_RADAR_ACCOUNT_NAME` | Account name used to label metrics. Optional; otherwise resolved via Organizations or the IAM account alias. |

## Metrics

Every metric is prefixed with `aws_`; inventory counts end in `_total`.

```text
aws_ec2_instances_total{region="us-east-1",instance_type="t3.micro",state="running"} 5
aws_lambda_functions_total{region="us-east-1",runtime="python3.9"} 10
aws_s3_buckets_total{region="us-east-1"} 25
aws_cost_total_unblended_usd{account_name="prod",period_start="2026-03-03"} 142.17
```

Cost metrics are `aws_cost_service_unblended_usd` (per service) and
`aws_cost_total_unblended_usd` (per account).

## Related guides

- [Scout OTLP exporter](../../collector-setup/scout-exporter.md) - the Collector
  export block every pipeline reuses.
- [OTel Collector configuration](../../collector-setup/otel-collector-config.md)
  adds the `prometheus` receiver that scrapes AWS Radar.
- [AWS monitoring overview](./index.md) - the rest of the AWS instrumentation
  guides.

## FAQ

### Does AWS Radar need write access to my AWS account?

No. Every permission it uses is a `List`, `Describe`, or `Get`, plus
`tag:GetResources` and `sts:GetCallerIdentity`. It never creates, modifies, or
deletes anything.

### How do I monitor more than one AWS account?

Add another entry to `instances[]` with that account's own credentials Secret
and regions. Each instance runs as its own Deployment and labels its metrics
with `awsAccountName`.

### Which is better for cost, Cost Explorer or CUR?

CUR 2.0 is cheaper and more detailed - it is delivered to S3 with no per-query
charge and carries per-resource cost. Cost Explorer is faster to enable but
bills roughly $0.01 per `GetCostAndUsage` call, so keep its `frequency` coarse.

### Why does CUR have to be in us-east-1?

The AWS CUR / Data Exports APIs are global and only exist in `us-east-1`. The
bucket and export live there even though the resources they bill for can run in
any region.
