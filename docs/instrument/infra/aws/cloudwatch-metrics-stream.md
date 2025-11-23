---
date: 2025-11-19
id: collecting-aws-cloudwatch-metrics-using-kinesis-streams
title: AWS CloudWatch Metrics Stream Setup Guide
sidebar_label: CloudWatch Metrics Stream
description:
  Set up CloudWatch Metrics Stream with Kinesis Firehose and Lambda to stream
  AWS metrics to Scout. Complete guide for fast metrics delivery with
  OpenTelemetry.
keywords:
  [
    cloudwatch metrics stream,
    aws metrics streaming,
    kinesis firehose,
    aws monitoring setup,
    cloudwatch observability,
  ]
---

Using Amazon CloudWatch Metric Streams and Amazon Data Firehose, you can get
CloudWatch metrics into Scout Backend with only a two to three minute latency.
This is significantly faster than polling approach

## Step 1: Creating a S3 Bucket

First, we'll create an S3 bucket to store the metrics

### 1. Go to [S3 Dashboard](https://ap-south-1.console.aws.amazon.com/s3)

![S3 Search in Console](/img/cloudwatch-kinesis-stream/search-s3-aws-console.png)

### 2. Click on `Create bucket` button

![S3 Dashboard ScreenShot](/img/cloudwatch-kinesis-stream/s3-dashboard.png)

### 3. Enter the bucket name as `cloudwatch-metrics-stream-bucket`

> leave all the other settings to default options.

![S3 config page screenshot](/img/cloudwatch-kinesis-stream/create-s3-page.png)

### 4. Scroll down and click on `Create bucket`

## Step 2: Creating a Kinesis Firehose stream

Now, we'll create a kinesis stream which cloudwatch can use to stream metrics

### 1. Go to [Kinsis Firehose Dashboard](https://ap-northeast-3.console.aws.amazon.com/firehose/home)

![Amazon Kinesis Firehose Search in Console](/img/cloudwatch-kinesis-stream/search-kinesis-firehose.png)

### 2. Click on `Create Firehose Stream` button

![AWS Kinesis Firehose Dashboard](/img/cloudwatch-kinesis-stream/kinesis-firehose-dashboard.png)

### 3. Set up the Sources

- Select `Direct PUT` as the input source and `S3` as the output.
- Select the S3 bucket name we created.

> Format is `s3://<your-bucket-name>`

- Enable `New Line Delimiter` and leave everything else as default settings.
- Scroll down and click on `Create Firehose Stream`.
  ![Firehose source config](/img/cloudwatch-kinesis-stream/configure-source-in-kinesis.png)

## Step 3: Creating a Metrics Stream pipeline

Now, we'll configure cloudwatch to use the kinesis firehose stream to stream
metrics to S3

### 1. Navigate to Cloudwatch dashboard and

### Select streams under Metrics

![cloudwatch dashboard](/img/cloudwatch-kinesis-stream/cloudwatch-dashboard.png)

### 2. Click on `Create Metrics Stream`

![cloudwatch metrics stream dashboard](/img/cloudwatch-kinesis-stream/cloudwatch-metrics-stream.png)

### 3. Configuring the Stream

- Select `Custom Setup with Firehose`.
- Change output format to `JSON`
- Select the required metrics.
- Give a name to the pipeline. `Click on`Create Metrics Stream`.

> Good Job, Now the Cloudwatch metrics are streaming to a S3 bucket.

## Step 4: Creating a lambda function

Now, let's create a lambda function to read from the s3 and send it to Scout
Collector

### 1. Create a layer with all the necessary packages

```shell
mkdir python
# move into that directory
cd python

# install requests module
pip install --target . requests
# zip the contents under the name dependencies.zip
zip -r dependencies.zip ../python
```

### 2. Navigate to AWS Lambda dashboard and click on `Layers`

![lambda dashboard](/img/cloudwatch-kinesis-stream/lambda-dashboard.png)

- Click on `Create layer` button

### 3. Fill the necessary details and upload the zip file

![create lambda page](/img/cloudwatch-kinesis-stream/create-lambda-layer-page.png)

### 4. Naviagte to functions page and Click on `Create function` button

![lambda functions page](/img/cloudwatch-kinesis-stream/lambda-functions-page.png)

- Select `Author from scratch`.
- Give a function name.
- Choose `python x.x` as the runtime.
- Select `x86_64` as the Architecture.

- Once the function is created, follow the below steps to configure it,

- Click on the `Configuration` tab and then click on `permissions`.
- Click on the Role name and give S3 Full access for the above created bucket.
- Click on `Code` and scroll to add a new layer.
- Click on `Add Layer`.
- Select `Custom Layer` and choose the layer that we created.
- Navigate back to the code and click on `Add trigger`.
- Select `S3` as the source and select the bucket from dropdown.
- Click on `Add`.
- Navigate to `Configuration` and then to `Environment variables`.
- Click on `edit` and these two environment variables with correct values.
  (`OTEL_COLLECTOR_URL`, `S3_BUCKET_NAME`, `OTEL_SERVICE_NAME`).

Now the actual part, copy the below code into the `code source` in your lambda
function.

```python
import boto3
import requests
import os
import json
from collections import defaultdict

s3 = boto3.client('s3')
client_id = os.environ.get('CLIENT_ID')
client_secret = os.environ.get('CLIENT_SECRET')
token_url = os.environ.get('TOKEN_URL')
endpoint_url = os.environ.get('ENDPOINT_URL')

def parse_cloudwatch_json_file(buffer):
    """
    Parse CloudWatch Metrics Stream JSON file (newline-delimited JSON).
    Returns a list of metric dictionaries.
    """
    metrics = []
    content = buffer.decode('utf-8')

    for line in content.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        try:
            metric = json.loads(line)
            metrics.append(metric)
        except json.JSONDecodeError as e:
            print(f"Failed to parse JSON line: {e}")
            continue

    return metrics

def convert_to_otlp_json(metrics):
    """
    Convert CloudWatch metrics to OTLP JSON format.
    Groups metrics by account/region for efficient batching.
    Preserves attribute format: Namespace, MetricName, Dimensions (as JSON string)
    """
    grouped = defaultdict(list)
    for metric in metrics:
        key = (metric.get('account_id', ''), metric.get('region', ''))
        grouped[key].append(metric)

    resource_metrics = []

    for (account_id, region), account_metrics in grouped.items():
        # Resource attributes
        resource_attributes = [
            {"key": "cloud.provider", "value": {"stringValue": "aws"}},
            {"key": "cloud.account.id", "value": {"stringValue": account_id}},
            {"key": "cloud.region", "value": {"stringValue": region}},
            {"key": "service.name", "value": {"stringValue": "aws-cloudwatch-stream"}},
            {"key": "environment", "value": {"stringValue": "production"}},
        ]

        otlp_metrics = []
        for cw_metric in account_metrics:
            metric_name = cw_metric.get('metric_name', 'unknown')
            namespace = cw_metric.get('namespace', '')
            timestamp_ms = cw_metric.get('timestamp', 0)
            timestamp_ns = timestamp_ms * 1_000_000
            value = cw_metric.get('value', {})
            unit = cw_metric.get('unit', '')
            dimensions = cw_metric.get('dimensions', {})

            datapoint_attributes = [
                {"key": "Namespace", "value": {"stringValue": namespace}},
                {"key": "MetricName", "value": {"stringValue": metric_name}},
                {"key": "Dimensions", "value": {"stringValue": json.dumps(dimensions)}},
            ]

            otlp_metrics.append({
                "name": f"amazonaws.com/{namespace}/{metric_name}",
                "unit": unit if unit != "None" else "",
                "summary": {
                    "dataPoints": [{
                        "timeUnixNano": str(timestamp_ns),
                        "count": str(int(value.get('count', 0))),
                        "sum": value.get('sum', 0.0),
                        "quantileValues": [
                            {"quantile": 0.0, "value": value.get('min', 0.0)},
                            {"quantile": 1.0, "value": value.get('max', 0.0)}
                        ],
                        "attributes": datapoint_attributes
                    }]
                }
            })

        resource_metrics.append({
            "resource": {"attributes": resource_attributes},
            "scopeMetrics": [{
                "scope": {"name": "aws.cloudwatch", "version": "1.0.0"},
                "metrics": otlp_metrics
            }]
        })

    return {"resourceMetrics": resource_metrics}


def lambda_handler(event, context):
    for record in event['Records']:
        bucket_name = record['s3']['bucket']['name']
        file_key = record['s3']['object']['key']
        print(f"Processing file: {file_key}")

        file_obj = s3.get_object(Bucket=bucket_name, Key=file_key)
        buffer = file_obj['Body'].read()

        try:
            metrics = parse_cloudwatch_json_file(buffer)
            print(f"Parsed {len(metrics)} metrics from file")
        except Exception as e:
            print(f"Error parsing file: {e}")
            raise

        if not metrics:
            print("No metrics found in file")
            continue

        try:
            otlp_payload = convert_to_otlp_json(metrics)
            print(f"Converted to OTLP format with {len(otlp_payload['resourceMetrics'])} resource groups")
        except Exception as e:
            print(f"Error converting to OTLP: {e}")
            raise

        try:
            token_response = requests.post(
                token_url,
                data={
                    "grant_type": "client_credentials",
                    "audience": "b14collector",
                },
                auth=(client_id, client_secret),
                verify=False,
            )
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]
        except Exception as e:
            print(f"Failed to get auth token: {e}")
            raise

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}"
        }

        try:
            response = requests.post(
                endpoint_url,
                json=otlp_payload,
                headers=headers,
                verify=False,
            )

            if response.status_code == 200:
                print(f"Successfully forwarded {len(metrics)} metrics to OTLP endpoint")
            else:
                print(f"Failed to send metrics. Status: {response.status_code}, Response: {response.text}")

        except Exception as e:
            print(f"Error sending to endpoint: {e}")
            raise

    return {
        'statusCode': 200,
        'body': f'Processed {len(event["Records"])} files'
    }

```

- Click on the `Deploy`

## That's it, you're done

Head back to the Scout dashboards to view all your AWS Services metrics.

## Related Guides

- [Application Load Balancer Monitoring](./elb.md) - Monitor AWS ALB with
  CloudWatch Metrics Stream
- [RDS Monitoring](./rds.md) - Monitor AWS RDS databases
- [Scout Exporter Configuration](../../collector-setup/scout-exporter.md) -
  Configure authentication and endpoints
