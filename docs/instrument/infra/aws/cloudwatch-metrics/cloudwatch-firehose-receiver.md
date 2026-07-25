---
date: 2026-07-07
id: collecting-aws-cloudwatch-metrics-firehose-receiver
title: CloudWatch Metrics to the OpenTelemetry Collector via Kinesis Firehose
sidebar_label: Firehose to Collector
sidebar_position: 2
description:
  Stream AWS CloudWatch metrics through Kinesis Firehose directly into
  the OpenTelemetry Collector's awsfirehosereceiver, then forward to base14
  Scout over OTLP. The lowest-latency push path with no Lambda code.
keywords:
  [
    awsfirehosereceiver,
    kinesis firehose receiver,
    cloudwatch metrics stream opentelemetry,
    firehose http endpoint delivery,
    cloudwatch to otel collector,
    aws metrics push,
    base14 scout aws,
  ]
---

<!-- markdownlint-disable MD013 MD011 MD033 -->

<head>
  <script type="application/ld+json">
    {JSON.stringify({"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is the awsfirehosereceiver?","acceptedAnswer":{"@type":"Answer","text":"The awsfirehosereceiver is an OpenTelemetry Collector Contrib receiver that accepts records pushed by Amazon Data Firehose over an HTTP endpoint. With record_type set to cwmetrics it decodes CloudWatch Metric Stream JSON directly into OTel metrics, so no S3 bucket or Lambda function is needed."}},{"@type":"Question","name":"Do I need a public endpoint for Firehose HTTP delivery?","acceptedAnswer":{"@type":"Answer","text":"Yes. Amazon Data Firehose HTTP endpoint delivery requires a publicly reachable HTTPS endpoint with a valid, CA-signed certificate. Terminate TLS on the Collector directly or behind a load balancer with an ACM certificate. Firehose will not deliver to a self-signed certificate."}},{"@type":"Question","name":"What output format should the CloudWatch Metric Stream use?","acceptedAnswer":{"@type":"Answer","text":"Use JSON output format with record_type: cwmetrics on the receiver. If you set the Metric Stream output format to OpenTelemetry 1.0.0 instead, set record_type: otlp_v1 so the receiver decodes the OTLP payload."}},{"@type":"Question","name":"How is this different from the Firehose to S3 to Lambda approach?","acceptedAnswer":{"@type":"Answer","text":"This approach delivers straight from Firehose to the Collector's receiver, with no S3 bucket and no Lambda code to maintain, and lower latency. The trade-off is that the Collector must expose an inbound HTTPS endpoint that Firehose can reach, whereas the S3 and Lambda path needs no inbound endpoint."}}]})}
  </script>
</head>

<!-- markdownlint-enable MD013 MD011 -->

## Overview

This guide streams AWS CloudWatch metrics directly into the OpenTelemetry
Collector using the [`awsfirehosereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/awsfirehosereceiver).
A CloudWatch Metric Stream pushes metrics through Amazon Data Firehose
(formerly Kinesis Data Firehose), which delivers them over HTTP to the
Collector. The Collector decodes the CloudWatch payload and forwards it to
**base14 Scout** over OTLP.

Compared to the [Firehose to S3 to Lambda](./cloudwatch-metrics-stream.md)
approach, this path has no S3 bucket, no Lambda code to maintain, and lower
latency. The trade-off is that the Collector must expose an inbound HTTPS
endpoint that Firehose can reach. For a comparison of all approaches, see the
[AWS CloudWatch overview](./overview.md).

:::caution Configuration pending validation

The Collector configuration below is authored from the OpenTelemetry
Collector Contrib documentation and has not yet been validated end-to-end
against a live AWS account and Scout tenant. Test it in a non-production
environment and confirm metrics arrive in Scout before relying on it.

:::

## How it works

```text
CloudWatch ─▶ Metric Stream ─▶ Amazon Data Firehose ─▶ OTel Collector ─▶ Scout
              (JSON format)     (HTTP endpoint)         awsfirehosereceiver   (OTLP)
```

The `awsfirehosereceiver` listens on an HTTP port. Firehose posts batches of
records to it, authenticating each request with a shared access key sent in
the `X-Amz-Firehose-Access-Key` header. With `record_type: cwmetrics`, the
receiver decodes CloudWatch Metric Stream JSON into OTel metrics.

## Prerequisites

| Requirement | Minimum | Recommended |
| ----------- | ------- | ----------- |
| OTel Collector Contrib | 0.90.0 | latest |
| Public HTTPS endpoint | valid CA-signed cert | ACM cert on a load balancer |
| base14 Scout | Any | - |
| AWS permissions | CloudWatch, Amazon Data Firehose, S3 (backup) | - |

Before starting:

- The Collector must be reachable from AWS over HTTPS with a valid
  certificate. Firehose does not deliver to self-signed certificates.
- Have your Scout OAuth client ID, client secret, token URL, and OTLP
  endpoint ready (see
  [Scout Exporter Configuration](../../../collector-setup/scout-exporter.md)).
- Choose a strong shared secret for the Firehose access key.

## Step 1: Deploy the Collector with the Firehose receiver

Create `otel-collector-config.yaml`. This reuses the Scout `oauth2client`
extension and `otlphttp/b14` exporter, and adds the `awsfirehose` receiver:

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
  awsfirehose:
    endpoint: 0.0.0.0:4433
    record_type: cwmetrics
    access_key: ${env:FIREHOSE_ACCESS_KEY}
    # Firehose requires HTTPS with a valid certificate. Terminate TLS here,
    # or omit this block and terminate at a load balancer (see below).
    tls:
      cert_file: /etc/otel/certs/server.crt
      key_file: /etc/otel/certs/server.key

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
      receivers: [awsfirehose]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment variables

```bash showLineNumbers title=".env"
SCOUT_CLIENT_ID=__YOUR_CLIENT_ID__
SCOUT_CLIENT_SECRET=__YOUR_CLIENT_SECRET__
SCOUT_TOKEN_URL=https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.play.b14.dev/__YOUR_TENANT__/otlp
FIREHOSE_ACCESS_KEY=<a-strong-shared-secret>
ENVIRONMENT=production
```

> **TLS termination:** the cleanest production pattern is to terminate TLS at
> a load balancer with an AWS Certificate Manager (ACM) certificate and let
> the Collector listen on plain HTTP behind it. In that case, omit the `tls`
> block on the receiver and point Firehose at the load balancer's HTTPS URL.
> The `X-Amz-Firehose-Access-Key` header still passes through, so the
> `access_key` check continues to work.

## Step 2: Create the Firehose stream (HTTP endpoint delivery)

1. Open the [Amazon Data Firehose console](https://console.aws.amazon.com/firehose/home)
   and click **Create Firehose stream**.
2. Set **Source** to `Direct PUT` and **Destination** to `HTTP Endpoint`.
3. Under **HTTP endpoint details**, set:
   - **HTTP endpoint URL** to your Collector's public HTTPS URL, for example
     `https://collector.example.com:4433` (or the load balancer URL on 443).
   - **Access key** to the same value as `FIREHOSE_ACCESS_KEY`.
   - **Content encoding** to `GZIP`.
4. Under **Buffer hints**, a buffer of `1 MiB` or `60 seconds` is a reasonable
   start.
5. Under **Backup settings**, select **Failed data only** and choose an S3
   bucket. Firehose requires a backup bucket for records it cannot deliver.
6. Click **Create Firehose stream**.

## Step 3: Create the CloudWatch Metric Stream

1. Open the [CloudWatch console](https://console.aws.amazon.com/cloudwatch/home),
   go to **Metrics > Streams**, and click **Create metric stream**.
2. Choose **Custom setup with Firehose** and select the Firehose stream from
   Step 2.
3. Set **Output format** to `JSON` to match `record_type: cwmetrics`.
4. Under **Metrics to be streamed**, select the specific namespaces you want
   (for example `AWS/EC2`, `AWS/RDS`) instead of all namespaces to reduce
   volume and cost.
5. Give the stream a name and click **Create metric stream**.

Metrics now flow CloudWatch → Firehose → Collector → Scout.

:::note IAM roles are created for you

As you complete Steps 2 and 3 in the console, AWS creates two service roles
automatically: a Firehose role that can write to the S3 backup bucket
(`s3:PutObject`, `s3:AbortMultipartUpload`, `s3:GetBucketLocation`,
`s3:ListBucket`) and log delivery errors, and a CloudWatch Metric Stream role
that trusts `streams.metrics.cloudwatch.amazonaws.com` and can call
`firehose:PutRecord` and `firehose:PutRecordBatch` on the stream. If you
provision with Terraform or CloudFormation instead, create both roles
explicitly with those permissions.

:::

## Verify the setup

1. In the Firehose console, open your stream's **Monitoring** tab and confirm
   `DeliveryToHTTPEndpoint.Success` is non-zero and the failed-delivery count
   is flat.
2. Check the Collector logs for accepted requests from the receiver:

   ```bash showLineNumbers
   docker logs otel-collector | grep -i firehose
   ```

3. In Scout, confirm the CloudWatch metrics appear (metric names are prefixed
   `amazonaws.com/<namespace>/<MetricName>`). Allow 5-10 minutes for the first
   metrics to arrive.

## Troubleshooting

### Firehose delivery is failing (records land in the S3 backup)

**Cause**: the Collector endpoint is not reachable or its certificate is not
valid.

**Fix**:

1. Confirm the endpoint is publicly reachable over HTTPS and the certificate
   is CA-signed, not self-signed.
2. Verify the port and path in the Firehose HTTP endpoint URL match the
   receiver's `endpoint`.
3. Check the Firehose stream's error logs for the HTTP status returned by the
   Collector.

### Firehose reports 401 or 403 from the Collector

**Cause**: the access key does not match.

**Fix**: confirm the Firehose **Access key** equals `FIREHOSE_ACCESS_KEY` on
the receiver. The receiver validates the `X-Amz-Firehose-Access-Key` header.

### Requests arrive but no metrics reach Scout

**Cause**: a record-type or output-format mismatch, or an export failure.

**Fix**:

1. If the Metric Stream output format is `OpenTelemetry 1.0.0`, set
   `record_type: otlp_v1` on the receiver. Use `cwmetrics` only with `JSON`
   output.
2. Check the Collector logs for OTLP export errors and confirm the
   `oauth2client` values and `OTEL_EXPORTER_OTLP_ENDPOINT` are correct.

## FAQ

**What is the `awsfirehosereceiver`?**

The `awsfirehosereceiver` is an OpenTelemetry Collector Contrib receiver that
accepts records pushed by Amazon Data Firehose over an HTTP endpoint. With
`record_type` set to `cwmetrics` it decodes CloudWatch Metric Stream JSON
directly into OTel metrics, so no S3 bucket or Lambda function is needed.

**Do I need a public endpoint for Firehose HTTP delivery?**

Yes. Amazon Data Firehose HTTP endpoint delivery requires a publicly reachable
HTTPS endpoint with a valid, CA-signed certificate. Terminate TLS on the
Collector directly or behind a load balancer with an ACM certificate. Firehose
will not deliver to a self-signed certificate.

**What output format should the CloudWatch Metric Stream use?**

Use `JSON` output format with `record_type: cwmetrics` on the receiver. If you
set the Metric Stream output format to `OpenTelemetry 1.0.0` instead, set
`record_type: otlp_v1` so the receiver decodes the OTLP payload.

**How is this different from the Firehose to S3 to Lambda approach?**

This approach delivers straight from Firehose to the Collector's receiver, with
no S3 bucket and no Lambda code to maintain, and lower latency. The trade-off
is that the Collector must expose an inbound HTTPS endpoint that Firehose can
reach, whereas the [S3 and Lambda path](./cloudwatch-metrics-stream.md) needs
no inbound endpoint.

## Related Guides

- [AWS CloudWatch Overview](./overview.md) - compare all four approaches.
- [CloudWatch Metrics Stream (S3 + Lambda)](./cloudwatch-metrics-stream.md) -
  the push approach without an inbound endpoint.
- [Prometheus CloudWatch exporter](./cloudwatch-prometheus-exporter.md) - the
  pull alternative with no inbound endpoint.
- [Scout Exporter Configuration](../../../collector-setup/scout-exporter.md) -
  OAuth2 authentication and the OTLP endpoint.
- [AWS ECS/Fargate Setup](../../../collector-setup/ecs-setup.md) - deploy the
  Collector on AWS.
