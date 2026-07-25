---
date: 2026-07-07
id: collecting-aws-cloudwatch-metrics-prometheus-exporter
title: AWS CloudWatch Metrics via the Prometheus CloudWatch Exporter
sidebar_label: Prometheus Exporter
sidebar_position: 4
description:
  Pull AWS CloudWatch metrics with the Prometheus CloudWatch exporter, scrape
  it with the OpenTelemetry Collector, and forward to base14 Scout over OTLP.
  A pull approach with fine-grained metric selection and no inbound endpoint.
keywords:
  [
    prometheus cloudwatch exporter,
    cloudwatch exporter opentelemetry,
    pull cloudwatch metrics,
    prometheus receiver cloudwatch,
    aws metrics scrape,
    yace exporter,
    base14 scout aws,
  ]
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How does the Prometheus CloudWatch exporter work?","acceptedAnswer":{"@type":"Answer","text":"The Prometheus CloudWatch exporter polls the CloudWatch GetMetricData API for the namespaces and metrics you list in its config and exposes them at /metrics on port 9106. The OpenTelemetry Collector's Prometheus receiver scrapes that endpoint and forwards the metrics to base14 Scout over OTLP."}},{"@type":"Question","name":"Do I need a public endpoint to pull CloudWatch metrics?","acceptedAnswer":{"@type":"Answer","text":"No. The exporter and the Collector reach out to the CloudWatch API; nothing inbound is required. This is the main operational advantage of the pull approach over Firehose HTTP endpoint delivery."}},{"@type":"Question","name":"What IAM permissions does the CloudWatch exporter need?","acceptedAnswer":{"@type":"Answer","text":"cloudwatch:GetMetricData, cloudwatch:GetMetricStatistics, cloudwatch:ListMetrics, and tag:GetResources. These are read-only and can be granted through an IAM user, an instance role, or EKS Pod Identity or IRSA."}},{"@type":"Question","name":"How fresh are metrics pulled through the exporter?","acceptedAnswer":{"@type":"Answer","text":"Freshness is the scrape interval plus CloudWatch's own metric-availability delay, which is typically a couple of minutes. This is slower than the push approaches, so choose pull when scrape-model fit and metric selection matter more than latency. To control cost, select only the metrics you need and raise period_seconds, or use YACE for tag-based discovery with batched GetMetricData."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide pulls AWS CloudWatch metrics using the
[Prometheus CloudWatch exporter](https://github.com/prometheus/cloudwatch_exporter).
The exporter polls the CloudWatch API on an interval and exposes the results at
`/metrics`. The OpenTelemetry Collector's Prometheus receiver scrapes that
endpoint and forwards the metrics to **base14 Scout** over OTLP.

This is a **pull** approach. Nothing inbound is required - both the exporter
and the Collector reach out to AWS. It fits teams that already run a
Prometheus scrape model and want precise control over which metrics are
collected. The trade-off is latency (scrape interval plus CloudWatch delay)
and per-request CloudWatch API cost. For a comparison of all approaches, see
the [AWS CloudWatch overview](./overview.md).

:::caution Configuration pending validation

The exporter and Collector configuration below is authored from the upstream
project documentation and has not yet been validated end-to-end against a live
AWS account and Scout tenant. Test it in a non-production environment and
confirm metrics arrive in Scout before relying on it.

:::

## How it works

```text
                       poll GetMetricData
OTel Collector ◀─ scrape /metrics ─ CloudWatch exporter ──────────────▶ CloudWatch
   │                                                                       API
   └─ OTLP ─▶ Scout
```

## Prerequisites

| Requirement | Minimum | Recommended |
| ----------- | ------- | ----------- |
| CloudWatch exporter | 0.15.0 | latest |
| OTel Collector Contrib | 0.90.0 | latest |
| base14 Scout | Any | - |
| AWS permissions | `GetMetricData`, `GetMetricStatistics`, `ListMetrics`, `tag:GetResources` | - |

Before starting:

- AWS credentials for the exporter, via an IAM user, an EC2 instance role, or
  EKS Pod Identity or IRSA.
- Have your Scout OAuth client ID, client secret, token URL, and OTLP
  endpoint ready (see
  [Scout Exporter Configuration](../../../collector-setup/scout-exporter.md)).

## Step 1: Grant CloudWatch read permissions

Attach this read-only policy to the identity the exporter runs as:

```json showLineNumbers title="cloudwatch-read-policy.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:GetMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
        "tag:GetResources"
      ],
      "Resource": "*"
    }
  ]
}
```

## Step 2: Deploy the Prometheus CloudWatch exporter

Create `config.yml` listing the namespaces, metrics, dimensions, and
statistics to collect. Select only what you need - each metric adds a
`GetMetricData` call and CloudWatch bills per request:

```yaml showLineNumbers title="config.yml"
region: us-east-1
period_seconds: 60
delay_seconds: 120
set_timestamp: false
metrics:
  - aws_namespace: AWS/EC2
    aws_metric_name: CPUUtilization
    aws_dimensions: [InstanceId]
    aws_statistics: [Average]
  - aws_namespace: AWS/RDS
    aws_metric_name: CPUUtilization
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]
  - aws_namespace: AWS/RDS
    aws_metric_name: FreeableMemory
    aws_dimensions: [DBInstanceIdentifier]
    aws_statistics: [Average]
  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: RequestCount
    aws_dimensions: [LoadBalancer]
    aws_statistics: [Sum]
```

Run the exporter with Docker. It reads `/config/config.yml` and serves metrics
on port 9106:

```bash showLineNumbers title="Run the exporter"
docker run -d --name cloudwatch-exporter -p 9106:9106 \
  -e AWS_ACCESS_KEY_ID=__YOUR_KEY__ \
  -e AWS_SECRET_ACCESS_KEY=__YOUR_SECRET__ \
  -v "$(pwd)/config.yml:/config/config.yml" \
  prom/cloudwatch-exporter:latest
```

On Kubernetes, run it as a Deployment with the config in a ConfigMap and AWS
access granted to its ServiceAccount. Apply the manifests below, then grant the
ServiceAccount access (next section):

```yaml showLineNumbers title="cloudwatch-exporter.yaml"
apiVersion: v1
kind: ConfigMap
metadata:
  name: cloudwatch-exporter-config
data:
  config.yml: |
    region: us-east-1
    period_seconds: 60
    delay_seconds: 120
    set_timestamp: false
    metrics:
      - aws_namespace: AWS/EC2
        aws_metric_name: CPUUtilization
        aws_dimensions: [InstanceId]
        aws_statistics: [Average]
      - aws_namespace: AWS/RDS
        aws_metric_name: CPUUtilization
        aws_dimensions: [DBInstanceIdentifier]
        aws_statistics: [Average]
      - aws_namespace: AWS/RDS
        aws_metric_name: FreeableMemory
        aws_dimensions: [DBInstanceIdentifier]
        aws_statistics: [Average]
      - aws_namespace: AWS/ApplicationELB
        aws_metric_name: RequestCount
        aws_dimensions: [LoadBalancer]
        aws_statistics: [Sum]
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cloudwatch-exporter
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudwatch-exporter
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloudwatch-exporter
  template:
    metadata:
      labels:
        app: cloudwatch-exporter
    spec:
      serviceAccountName: cloudwatch-exporter
      containers:
        - name: cloudwatch-exporter
          image: prom/cloudwatch-exporter:latest
          ports:
            - containerPort: 9106
          volumeMounts:
            - name: config
              mountPath: /config
      volumes:
        - name: config
          configMap:
            name: cloudwatch-exporter-config
---
apiVersion: v1
kind: Service
metadata:
  name: cloudwatch-exporter
spec:
  selector:
    app: cloudwatch-exporter
  ports:
    - port: 9106
      targetPort: 9106
```

### Grant the ServiceAccount AWS access

The `cloudwatch-exporter` ServiceAccount needs the read-only policy from
Step 1. On EKS, prefer **Pod Identity** - it needs no OIDC provider or
per-cluster trust policy. IRSA still works for Fargate or existing OIDC
clusters.

**EKS Pod Identity (recommended).** Create an IAM role that trusts the
`pods.eks.amazonaws.com` principal (allowing `sts:AssumeRole` and
`sts:TagSession`), attach the Step 1 policy, install the
`eks-pod-identity-agent` add-on, then associate the role:

```bash showLineNumbers title="Pod Identity association"
aws eks create-pod-identity-association \
  --cluster-name <cluster> \
  --namespace <namespace> \
  --service-account cloudwatch-exporter \
  --role-arn arn:aws:iam::<account-id>:role/cloudwatch-exporter
```

**IRSA (alternative).** Create the role with an OIDC trust policy for the
cluster, then annotate the ServiceAccount so the pod assumes it:

```yaml showLineNumbers title="ServiceAccount IRSA annotation"
metadata:
  name: cloudwatch-exporter
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/cloudwatch-exporter
```

## Step 3: Scrape the exporter with the Collector

Point the Collector's Prometheus receiver at the exporter and forward to
Scout. This reuses the Scout `oauth2client` extension and `otlphttp/b14`
exporter:

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    endpoint_params:
      audience: b14collector
    token_url: ${env:SCOUT_TOKEN_URL}
    tls:
      insecure_skip_verify: true

receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cloudwatch-exporter
          scrape_interval: 60s
          metrics_path: /metrics
          static_configs:
            - targets: ["cloudwatch-exporter:9106"]

processors:
  resource:
    attributes:
      - key: cloud.provider
        value: aws
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true

service:
  extensions: [oauth2client]
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment variables

```bash showLineNumbers title=".env"
SCOUT_CLIENT_ID=__YOUR_CLIENT_ID__
SCOUT_CLIENT_SECRET=__YOUR_CLIENT_SECRET__
SCOUT_TOKEN_URL=https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.play.b14.dev/__YOUR_TENANT__/otlp
ENVIRONMENT=production
```

## Verify the setup

1. Confirm the exporter is serving metrics:

   ```bash showLineNumbers
   curl -s http://localhost:9106/metrics | grep aws_ec2_cpuutilization
   ```

2. Check the Collector logs for a successful scrape of the
   `cloudwatch-exporter` job.
3. In Scout, confirm the metrics appear (the exporter names them
   `aws_<namespace>_<metric>_<statistic>`). Allow a few minutes for the first
   scrape plus CloudWatch's availability delay.

## Alternatives

- **YACE (Yet Another CloudWatch Exporter)** -
  [nerdswords/yet-another-cloudwatch-exporter](https://github.com/nerdswords/yet-another-cloudwatch-exporter)
  discovers resources by tag and batches `GetMetricData` calls, which is more
  efficient and lower-maintenance at scale. Scrape it with the same Prometheus
  receiver.
- **Native `awscloudwatchmetricsreceiver`** - the OpenTelemetry Collector
  Contrib
  [`awscloudwatchmetricsreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/awscloudwatchmetricsreceiver)
  pulls CloudWatch metrics directly into the Collector, removing the separate
  exporter. It is earlier in its stability lifecycle, so validate it against
  your Collector version before adopting it.

## Troubleshooting

### The exporter's `/metrics` endpoint is empty or missing series

**Cause**: IAM permissions, region, or metric names do not match.

**Fix**:

1. Confirm the identity has `GetMetricData`, `GetMetricStatistics`,
   `ListMetrics`, and `tag:GetResources`.
2. Check the `region` in `config.yml` matches where the resources live.
3. Verify the `aws_namespace`, `aws_metric_name`, and `aws_dimensions` exactly
   match CloudWatch (case-sensitive).

### The exporter logs `AccessDenied`

**Cause**: the IAM policy is missing a required action.

**Fix**: attach the policy from Step 1 and confirm the credentials or role are
the ones the container is using.

### CloudWatch bill higher than expected

**Cause**: too many metrics or too short a period.

**Fix**: trim the metric list, raise `period_seconds`, and prefer YACE's
batched `GetMetricData` for large estates. CloudWatch bills per metric
requested.

### The Collector is not scraping the exporter

**Cause**: the scrape target is unreachable.

**Fix**: confirm the `targets` host and port resolve from the Collector, and
that the exporter is listening on 9106.

## FAQ

**How does the Prometheus CloudWatch exporter work?**

The Prometheus CloudWatch exporter polls the CloudWatch `GetMetricData` API
for the namespaces and metrics you list in its config and exposes them at
`/metrics` on port 9106. The OpenTelemetry Collector's Prometheus receiver
scrapes that endpoint and forwards the metrics to base14 Scout over OTLP.

**Do I need a public endpoint to pull CloudWatch metrics?**

No. The exporter and the Collector reach out to the CloudWatch API; nothing
inbound is required. This is the main operational advantage of the pull
approach over Firehose HTTP endpoint delivery.

**What IAM permissions does the CloudWatch exporter need?**

`cloudwatch:GetMetricData`, `cloudwatch:GetMetricStatistics`,
`cloudwatch:ListMetrics`, and `tag:GetResources`. These are read-only and can
be granted through an IAM user, an instance role, or EKS Pod Identity or IRSA.

**How fresh are metrics pulled through the exporter?**

Freshness is the scrape interval plus CloudWatch's own metric-availability
delay, which is typically a couple of minutes. This is slower than the push
approaches, so choose pull when scrape-model fit and metric selection matter
more than latency. To control cost, select only the metrics you need and raise
`period_seconds`, or use YACE for tag-based discovery with batched
`GetMetricData`.

## Related Guides

- [AWS CloudWatch Overview](./overview.md) - compare all four approaches.
- [Firehose to the OTel Collector](./cloudwatch-firehose-receiver.md) - the
  low-latency push alternative.
- [kube-state-metrics](../../../component/kube-state-metrics.md) - another
  Prometheus receiver scrape pattern.
- [Scout Exporter Configuration](../../../collector-setup/scout-exporter.md) -
  OAuth2 authentication and the OTLP endpoint.
