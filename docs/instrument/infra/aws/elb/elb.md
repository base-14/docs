---
date: 2025-04-26
id: collecting-aws-rds-postgres-telemetry
title: Telemetry Collection from ELB via CloudWatch, Prometheus and lambda
description: Use Scout to monitor your AWS ELB with ease
hide_table_of_contents: true
---

## Overview

This guide will walk you through collecting rich telemetry data from your ELB
 using cloudwatch. We'll implement the prometheus cloudwatch exporter
to collect telemetry data from cloudwatch.

## Prerequisites

Before we begin, ensure you have:

### 1. AWS Credentials and Permissions

Required IAM permissions:

- `cloudwatch:ListMetrics`
- `cloudwatch:GetMetricStatistics`
- `cloudwatch:GetMetricData`
- `logs:DescribeLogGroups`
- `logs:FilterLogEvents`

## Collecting ELB Metrics

### Step 1. Configure the Prometheus exporter

Save the following config for collecting AWS ELB
metrics in a file named `aws-elb-metrics.yaml`
and update the region key with relevant value.

```yaml
---
region: us-east-1
metrics:
  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "ActiveConnectionCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "AnomalousHostCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "ConsumedLCUs"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "DesyncMitigationMode_NonCompliant_Request_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "ForwardedInvalidHeaderRequestCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_ELB_4XX_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_ELB_502_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_ELB_503_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_ELB_504_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_ELB_5XX_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_Target_2XX_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_Target_3XX_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTPCode_Target_4XX_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HTTP_Fixed_Response_Count"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HealthyHostCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HealthyStateDNS"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "HealthyStateRouting"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "MitigatedHostCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "NewConnectionCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "PeakLCUs"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "ProcessedBytes"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "RequestCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "RequestCountPerTarget"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "RuleEvaluations"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "TargetConnectionErrorCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "TargetResponseTime"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "UnHealthyHostCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "UnhealthyRoutingRequestCount"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "UnhealthyStateDNS"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]

  - aws_namespace: AWS/ApplicationELB
    aws_metric_name: "UnhealthyStateRouting"
    aws_dimensions: [TargetGroup, AvailabilityZone, LoadBalancer]
    aws_statistics: [Average, Maximum]
```

### 2. Run the below command to Start the Exporter

```bash
 docker run -p 9106:9106 \
  -v $(pwd)/aws-elb-metrics.yaml:/config/config.yml \
  -e AWS_ACCESS_KEY_ID=<your-aws-access-key-id> \
  -e AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key> \
  quay.io/prometheus/cloudwatch-exporter
```

### 3. Verify the CloudWatch metrics

Visit [http://localhost:9106/metrics](http://localhost:9106/metrics)
and confirm the `aws_applicationelb_*` metrics are avialable.

### 4. Create a OTEL Collector config file

create `elb-metrics-collection-config.yaml`

```yaml
receivers:
 prometheus:
    config:
      scrape_configs:
        - job_name: "aws-cloudwatch-metrics"
          scrape_timeout: 120s
          scrape_interval: 300s
          static_configs:
            - targets: ["0.0.0.0:9106"]
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: aws_applicationelb_.*
              target_label: service
              replacement: elb

exporters:
  otlp:
    endpoint: "<SCOUT_ENDPOIINT>:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics/elb:
      receivers: [prometheus]
      exporters: [otlp]
```

## Collecting Application ELB Logs

### Step 1: Creating a lambda function

1. Go to your AWS console and search for AWS Lambda,
go to Functions and click on Create Function.
2. Choose the `Author from scratch` checkbox and proceed
to fill in the function name.
3. Choose `Python 3.x` as the Runtime version, `x86_64` as
Architecture (preferably), and keep other settings as default.
Select `Create a new role with basic Lambda permissions` for now,
we’ll requiring more permissions down the lane. So for now, select this option.
4. Once you are done configuring the lambda function, you Lambda function is created.

### Step 2: Configuring Policies for Lambda function

> As said in previous step, we need extra permissions in order to
access the S3 Bucket for execution of our Lambda code, follow along to set it up.

1. Scroll down from your Lambda page, you’ll see a few tabs there.
Go to `Configurations` and select `Permissions` from the left sidebar.
2. Click on the `Execution Role name` link just under Role name, it will
take us to AWS IAM page. Here we will add policies to get full S3 access.
Once here, click on the `Add permissions` button and select `Attach policies`
from the drop down list.
3. Search “S3” and you’ll a policy named `AmazonS3FullAccess` select that and proceed.

:::warning

It's advisable to proceed with caution when granting full S3 access,
particularly in a production environment.
:::

### Step 3: Adding Triggers

1. Navigate to the lambda function that we created just now.
2. Click on the `+ Add trigger` button from the Lambda console.
3. Select S3 from the first drop down of AWS services list.
Pick your S3 bucket for the second field.
4. For the Event types field, you can select any number of options you wish.
The trigger will occur depending upon what option(s) you choose here.
By default, the `All object create events` will be selected.
5. Verify the settings and click on `Add` button at bottom right to add this trigger.

### Step 4: Adding Request Layer

We will be using python's request module which is not included by default in Lambda.

```bash
# make a new directory
mkdir python
# move into that directory
cd python

# install requests module
pip install --target . requests
# zip the contents under the name dependencies.zip
zip -r dependencies.zip ../python 

```

1. Run the above commands to create a zip of the request module and add it as a layer
to make it work on AWS lambda.
2. To upload your zip file, go to AWS Lambda > Layers and click on `Create Layer`.
[Not inside your specific Lambda function, just the landing page of AWS Lambda].
3. you’ll be redirected to Layer configurations page, here, give a name to your layer,
an optional description, select `Upload a .zip file` , click on `Upload` and locate
the requirements.zip file.
4. Select your desired architecture and pick `Python 3.x` as your runtime. Hit `Create`.
Your layer has now been created.
5. Go to your Lambda function, scroll down to Layers section and on the right
of it, you’ll find a button that says `Add a layer` to click on.
6. Pick `Custom layers` from the checkbox and select your custom layer from the
given drop down below and then click on the button `Add`.

### Step 5: The Lambda Function

Now, we come to the pivotal section of this document: the code implementation.

The Python script's primary function revolves around retrieving gzipped log
files stored within an Amazon S3 bucket. Subsequently, it decompresses these
files, transforms individual log entries into JSON objects, and transmits
the resultant JSON data to a predetermined HTTP endpoint.

```python
import json
import gzip
import boto3
import requests
import shlex
import os
from datetime import datetime

# Create an S3 client
s3 = boto3.client('s3')


# Function to convert a log line into a JSON object
def convert_log_line_to_json(line):
 # Define the headers to be used for the JSON keys (ALB log format)
 headers = ["type", "time", "elb", "client:port", "target:port", "request_processing_time",
            "target_processing_time", "response_processing_time", "elb_status_code",
            "target_status_code", "received_bytes", "sent_bytes", "request", "user_agent",
            "ssl_cipher", "ssl_protocol", "target_group_arn", "trace_id", "domain_name",
            "chosen_cert_arn", "matched_rule_priority", "request_creation_time",
            "actions_executed", "redirect_url", "error_reason", "target:port_list",
            "target_status_code_list", "classification", "classification_reason"]

 # Split the log line using shell-like syntax (keeping quotes, etc.)
 parts = shlex.split(line, posix=False)

 # Create a dictionary with as many pairs as possible
 result = {}
 for i in range(min(len(headers), len(parts))):
  result[headers[i]] = parts[i]

 return result


# Convert logs to OTLP format
def convert_to_otlp_format(logs):
 current_time_ns = int(datetime.now().timestamp() * 1_000_000_000)  # nanoseconds

 # Create OTLP log records
 resource_logs = {
  "resourceLogs": [{
   "resource": {
    "attributes": [
     {"key": "service.name", "value": {"stringValue": "alb"}},
     {"key": "cloud.provider", "value": {"stringValue": "aws"}}
    ]
   },
   "scopeLogs": [{
    "scope": {},
    "logRecords": []
   }]
  }]
 }

 # Add each log entry as a log record
 for log in logs:
  # Create attributes from log fields
  attributes = []
  for key, value in log.items():
   attributes.append({
    "key": key,
    "value": {"stringValue": value}
   })

  # Get timestamp if available, or use current time
  timestamp = current_time_ns
  if "time" in log:
   try:
    # Try to parse the ALB log timestamp format
    dt = datetime.strptime(log["time"], "%Y-%m-%dT%H:%M:%S.%fZ")
    timestamp = int(dt.timestamp() * 1_000_000_000)
   except (ValueError, TypeError):
    pass

  # Create a log record
  log_record = {
   "timeUnixNano": timestamp,
   "severityText": "INFO",
   "body": {"stringValue": json.dumps(log)},
   "attributes": attributes
  }

  resource_logs["resourceLogs"][0]["scopeLogs"][0]["logRecords"].append(log_record)

 return resource_logs


# Lambda function handler
def lambda_handler(event, context):
 try:
  # Check if this is being triggered by an S3 event
  if 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
   # Get the S3 bucket and key from the event
   s3_event = event['Records'][0]['s3']
   bucket_name = s3_event['bucket']['name']
   file_key = s3_event['object']['key']

   # Only process log files
   if not file_key.endswith('.log.gz'):
    print(f"Skipping non-log file: {file_key}")
    return {
     'statusCode': 200,
     'body': 'Skipped non-log file'
    }

   log_files = [file_key]
  else:
   # For manual invocation, use environment variables or parameters
   bucket_name = os.environ.get('S3_BUCKET_NAME', '')
   prefix = os.environ.get('S3_PREFIX', '')

   if not bucket_name:
    return {
     'statusCode': 400,
     'body': 'Missing S3_BUCKET_NAME environment variable'
    }

   # List objects with the given prefix
   response = s3.list_objects_v2(Bucket=bucket_name, Prefix=prefix, MaxKeys=10)

   if 'Contents' not in response or not response['Contents']:
    print(f"No files found in {bucket_name}/{prefix}")
    return {
     'statusCode': 404,
     'body': f'No log files found in {bucket_name}/{prefix}'
    }

   # Filter for log files
   log_files = [obj['Key'] for obj in response['Contents'] if obj['Key'].endswith('.log.gz')]

   if not log_files:
    print(f"No .log.gz files found in {bucket_name}/{prefix}")
    return {
     'statusCode': 404,
     'body': f'No .log.gz files found in {bucket_name}/{prefix}'
    }

  processed_files = 0
  total_logs = 0

  # Process each log file
  for file_key in log_files:
   print(f"Processing file: {bucket_name}/{file_key}")

   # Download the gzipped file content
   file_obj = s3.get_object(Bucket=bucket_name, Key=file_key)
   file_content = file_obj['Body'].read()

   # Decompress the gzipped content
   decompressed_content = gzip.decompress(file_content)

   # Convert bytes to string
   log_text = str(decompressed_content, encoding='utf-8')

   # Split the string into lines and filter out empty lines
   lines = [line for line in log_text.strip().split('\n') if line.strip()]

   log_count = len(lines)
   print(f"File contains {log_count} log entries")

   # Process logs in batches to prevent timeouts
   batch_size = int(os.environ.get('BATCH_SIZE', '100'))
   for i in range(0, log_count, batch_size):
    batch_lines = lines[i:min(i + batch_size, log_count)]

    # Convert each log line string into a JSON object
    json_logs = [convert_log_line_to_json(line) for line in batch_lines]

    # Convert to OTLP format
    otlp_data = convert_to_otlp_format(json_logs)

    # Set headers for OTEL collector
    req_headers = {
     'Content-Type': 'application/json'
    }

    # Add any custom headers from environment variables
    custom_headers = os.environ.get('OTEL_HEADERS', '')
    if custom_headers:
     try:
      additional_headers = json.loads(custom_headers)
      req_headers.update(additional_headers)
     except json.JSONDecodeError:
      print(f"Warning: Could not parse OTEL_HEADERS: {custom_headers}")

    # Get OTEL collector endpoint from environment variable
    otel_endpoint = os.environ.get('OTEL_ENDPOINT', 'http://localhost:4318')
    http_url = f"{otel_endpoint}/v1/logs"

    # Send the JSON data to the OTEL collector
    try:
     response = requests.post(http_url, json=otlp_data, headers=req_headers,
                              timeout=float(os.environ.get('REQUEST_TIMEOUT', '5')))
     response.raise_for_status()
     print(f"Sent batch of {len(batch_lines)} logs to {http_url}. Response: {response.status_code}")
    except requests.exceptions.RequestException as e:
     print(f"Error sending logs to OTEL collector: {str(e)}")
     if hasattr(e, 'response') and e.response:
      print(f"Response status: {e.response.status_code}")
      print(f"Response body: {e.response.text[:200]}...")

   total_logs += log_count
   processed_files += 1

   # Option to delete processed files
   if os.environ.get('DELETE_PROCESSED_FILES', 'false').lower() == 'true':
    s3.delete_object(Bucket=bucket_name, Key=file_key)
    print(f"Deleted processed file: {file_key}")

  return {
   'statusCode': 200,
   'body': f'Successfully processed {processed_files}:{total_logs} log entries'
  }

 except Exception as e:
  print(f"Error processing logs: {str(e)}")
  import traceback
  traceback.print_exc()
  return {
   'statusCode': 500,
   'body': f'Error: {str(e)}'
  }
```

> Set `OTEL_ENDPOINT` and `S3_BUCKET_NAME` with the correct values.

After deploying these changes, generate some traffic to your ALB and
check in Scout to see your ELB's metrics and logs.

---

With this setup, your ALB becomes fully observable through Scout.
