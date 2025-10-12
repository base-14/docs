---
date: 2025-04-24
id: send-aws-vpc-flow-logs
title: AWS VPC Flow Logs to OpenTelemetry | base14 Scout
description: Send AWS VPC Flow Logs to OpenTelemetry using S3 and Lambda. Complete guide for VPC monitoring with automated log processing and OTLP export.
keywords: [aws vpc monitoring, vpc flow logs, aws network monitoring, lambda opentelemetry, aws observability]
tags: [aws, vpc, s3, lambda, otlp]
sidebar_position: 2
---

# Send AWS VPC Flow Logs

You can send AWS VPC Flow Logs through an S3 bucket to base14 endpoint using an
AWS Lambda function. This approach uses S3 Event Notifications to trigger the
Lambda function whenever a new Flow Log file arrives in the bucket.

## Prerequisites

* AWS VPC services (S3, Lambda, IAM).
* Scout authentication credentials
* Scout Collector has been configured with an OTLP receiver
  endpoint (HTTP or gRPC) ready to accept logs.

---

## Step 1: Configure VPC Flow Logs to Deliver to S3

1. **Navigate to VPC:** Go to the AWS VPC console.
1. **Select VPC:** Choose the VPC for which you want to enable Flow Logs.
1. **Flow Logs Tab:** Go to the "Flow Logs" tab.
1. **Create Flow Log:** Click "Create flow log".
1. **Configure Filter:** Choose the traffic to capture (Accepted, Rejected, or All).
1. **Maximum Aggregation Interval:** Select an interval (e.g., 1 minute, 5 minutes).
  Shorter intervals mean more files and potentially more Lambda invocations.
1. **Destination:** Select **"Send to an S3 bucket"**.
1. **S3 Bucket ARN:** Specify the ARN of the S3 bucket where logs should be
  delivered (e.g., `arn:aws:s3:::your-vpc-flow-log-bucket`). Create the bucket if
  it doesn't exist.
  *Ensure the bucket policy grants `vpc-flow-logs.amazonaws.com` permissions to `PutObject`.*
1. **Log Format:** Choose either the "AWS default format" or a "Custom format".
  **Note down the fields and their order if using Custom format**,
  as you'll need this for parsing in the Lambda. The default format is
  space-delimited:

  ```csv
  version account-id interface-id srcaddr dstaddr srcport
  dstport protocol packets bytes start end action log-status
  ```

1. **Log file format:** Select text (default). Parquet is also an option but
  requires different handling in Lambda.
1. **Partitioning:** Decide if you want logs partitioned by time (Hourly/Daily).
  This also affects the S3 object key structure and potentially how you
  configure the S3 trigger.
1. **Create Flow Log:** Confirm and create.

---

## Step 2: Create the Lambda Function (Python Example)

1. **Create Function:** Go to the AWS Lambda console and click "Create function".
2. **Author from Scratch:** Choose "Author from scratch".
3. **Function Name:** Give it a descriptive name (e.g., `vpc-flow-log-s3-to-otlp-processor`).
4. **Runtime:** Select a runtime like **Python 3.10** (or newer).
5. **Architecture:** Choose `x86_64` or `arm64`.
6. **Permissions:** Choose "Create a new role with basic Lambda permissions".
  We will modify this role later (Step 3).
7. **Create Function:** Click "Create function".
8. **Write Lambda Code:** Replace the template code with the following
  structure (this is a conceptual outline; you'll need to fill in the parsing
  and OTLP details):

```python
import boto3
import os
import gzip
import logging
from urllib.parse import unquote_plus

# --- OpenTelemetry Imports (Add these to requirements.txt/Layer) ---
from opentelemetry import trace, logs
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk.logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http.log_exporter import OTLPLogExporter
# or use OTLPLogExporterGRPC
from opentelemetry.sdk.resources import Resource
from opentelemetry_semantic_conventions.resource import ResourceAttributes

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# -- OTel Configuration (Best practice: Initialize outside handler for reuse) --
# Configure resource attributes for your logs
resource = Resource(attributes={
    ResourceAttributes.SERVICE_NAME: "vpc-flow-log-processor",
    # Add other relevant attributes like cloud provider, region, etc.
    ResourceAttributes.CLOUD_PROVIDER: "aws",
    ResourceAttributes.CLOUD_REGION: os.environ.get("AWS_REGION", "unknown"),
    # ResourceAttributes.HOST_ID: ... # May not apply directly in Lambda
})

# Configure OTLP Exporter (using environment variables is recommended)
otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "<http://localhost:4318/v1/logs>")
otlp_headers = os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "") # e.g., "key1=value1,key2=value2"
headers_dict = dict(item.split("=") for item in otlp_headers.split(",")
    if "=" in item) if otlp_headers else {}

# Use OTLP/HTTP Exporter
otlp_exporter = OTLPLogExporter(
    endpoint=otlp_endpoint,
    headers=headers_dict
    # Optional: certificate_file=..., timeout=...
)

# Setup LoggerProvider with the exporter and resource
logger_provider = LoggerProvider(resource=resource)
log_processor = BatchLogRecordProcessor(otlp_exporter)
logger_provider.add_log_record_processor(log_processor)

# Create a dedicated OTel logger
otel_log_emitter = logs.get_logger(__name__, logger_provider=logger_provider)

# --- AWS SDK Client ---
s3_client = boto3.client('s3')

# --- Flow Log Parsing Configuration (Adjust based on your Flow Log Format) ---
# Example for AWS Default Format
DEFAULT_FIELDS = [
    "version", "account_id", "interface_id", "srcaddr", "dstaddr",
    "srcport", "dstport", "protocol", "packets", "bytes",
    "start", "end", "action", "log_status"
]
FIELD_TYPES = { # Optional: Specify types for potential conversion
    "srcport": int, "dstport": int, "packets": int, "bytes": int,
    "start": int, "end": int
}

def parse_flow_log_line(line, fields=DEFAULT_FIELDS, types=FIELD_TYPES):
    """Parses a single space-delimited flow log line."""
    values = line.strip().split()
    if len(values) != len(fields):
        logger.warning(f"Skipping line due to field count mismatch: {line}")
        return None

    log_data = {}
    for i, field in enumerate(fields):
        value = values[i]
        if value == "-": # Handle null values represented by "-"
            log_data[field] = None
            continue
        try:
            target_type = types.get(field)
            if target_type:
                log_data[field] = target_type(value)
            else:
                log_data[field] = value
        except ValueError:
            logger.warning(f"Skipping field '{field}' due to type conversion
                              error: {value}")
            log_data[field] = value # Keep as string if conversion fails
    return log_data

def lambda_handler(event, context):
    logger.info(f"Received event: {event}")

    for record in event.get('Records', []):
        s3_info = record.get('s3', {})
        bucket_name = s3_info.get('bucket', {}).get('name')
        object_key = s3_info.get('object', {}).get('key')

        if not bucket_name or not object_key:
            logger.warning("Missing bucket name or object key in S3 event record.")
            continue

        # S3 keys can have URL encoding (e.g., spaces become '+')
        object_key = unquote_plus(object_key)
        logger.info(f"Processing object {object_key} from bucket {bucket_name}")

        try:
            # Get the flow log file from S3
            response = s3_client.get_object(Bucket=bucket_name, Key=object_key)
            body = response['Body']

            # Decompress if it's a .gz file
            if object_key.endswith('.gz'):
                content = gzip.decompress(body.read()).decode('utf-8')
            else:
                content = body.read().decode('utf-8')

            lines = content.splitlines()
            header = lines[0] # First line is usually the header defining fields
            log_lines = lines[1:] # Actual log data

            # Simple check if header matches expected default fields
            # (customize if needed)
            if header != ' '.join(DEFAULT_FIELDS):
                logger.warning(f"Log header '{header}' does not match
                  expected default fields. Parsing might be incorrect.")
                # Potentially parse the header here to dynamically
                # determine fields if needed

            logger.info(f"Processing {len(log_lines)} log entries from {object_key}")

            # Process and send logs in batches (managed by BatchLogRecordProcessor)
            for line in log_lines:
                if not line or line.isspace():
                    continue

                parsed_log = parse_flow_log_line(line)
                if parsed_log:
                    # Emit the log using the OpenTelemetry Logger
                    # Convert timestamp if needed
                    # (Flow log 'start'/'end' are Unix seconds)
                    # OTel expects nanoseconds since epoch
                    timestamp_ns = parsed_log.get('start', 0) * 1_000_000_000

                    otel_log_emitter.emit(logs.LogRecord(
                        timestamp=timestamp_ns,
                        observed_timestamp=timestamp_ns,
                        severity_text=parsed_log.get('log_status'),
                        severity_number=logs.SeverityNumber.INFO,
                        body=f"VPC Flow Log: {parsed_log.get('srcaddr')}:{parsed_log.get('srcport')}
                        -> {parsed_log.get('dstaddr')}:{parsed_log.get('dstport')}",
                        attributes=parsed_log
                    ))

            logger.info(f"Finished processing {object_key}.
                        Logs submitted to OTLP exporter.")

        except Exception as e:
            logger.error(f"Error processing object {object_key}
                          from bucket {bucket_name}: {e}")
            # Consider adding to a Dead Letter Queue (DLQ)
            # or raising exception for Lambda retry
            # Raising an exception might re-process the entire file
            # if not handled carefully

    # Explicitly flush the batch processor at the end of the invocation
    # Note: If function times out, flush might not complete. Adjust timeout accordingly.
    logger_provider.force_flush()
    return {'statusCode': 200, 'body': 'Processing complete'}
```

1. **Create Deployment Package/Layer:**
   * Create a requirements.txt file in your project directory:

    ```plaintext
    boto3 # Usually included in Lambda runtime, but good practice
    opentelemetry-api
    opentelemetry-sdk
    opentelemetry-exporter-otlp-proto-http # Or -grpc if using gRPC
    opentelemetry-semantic-conventions
    ```

   * Install dependencies into a package directory:
    `pip install -r requirements.txt -t ./package`

   * Create a zip file containing the contents of the package directory and your
    lambda_function.py file.

    ```bash
    cd package && zip -r ../deployment_package.zip . && cd ..
    zip -g deployment_package.zip lambda_function.py
    ```

    * Alternatively, create a Lambda Layer containing the dependencies and
    upload it separately. Then add the layer to your function.

1. **Upload Code:** Upload the deployment_package.zip file to your Lambda
  function via the console or AWS CLI.
1. **Configure Environment Variables:**
    * BASE14_OTLP_ENDPOINT: Your OTLP endpoint URL (e.g. [https://otel.play.b14.dev/01jm94npk4h8ys63x1kzw2bjes/otlp](https://otel.play.b14.dev/01jm94npk4h8ys63x1kzw2bjes/otlp)).
    * AWS_REGION: Set this to the region your function is running in (e.g., us-east-1).
1. **Adjust Timeout and Memory:** VPC flow log files can be large. Increase the
  function's **Timeout** (e.g., to 1-5 minutes) and
  **Memory** (e.g., 512MB or more) under "General configuration" as needed.

---

## Step 3: Configure IAM Role Permissions**

1. **Find Role:** Go to the IAM console -> Roles. Find the role automatically
  created for your Lambda function (e.g., `vpc-flow-log-s3-to-otlp-processor-role-xxxxxx`).
2. **Attach Policies:**
   * **S3 Read Access:** Click "Add permissions" -> "Attach policies".
    Search for and attach `AmazonS3ReadOnlyAccess` OR create a more specific
    inline policy granting `s3:GetObject` permissions only for your specific
    VPC Flow Log bucket (`arn:aws:s3:::your-vpc-flow-log-bucket/*`).

    ```JSON
     // Example Inline Policy for S3 Read
     {
         "Version": "2012-10-17",
         "Statement": [
             {
                 "Effect": "Allow",
                 "Action": "s3:GetObject",
                 "Resource": "arn:aws:s3:::your-vpc-flow-log-bucket/*"
             }
         ]
     }
    ```

   * **Basic Execution Role:** Ensure the AWSLambdaBasicExecutionRole policy
    (or equivalent for CloudWatch Logs `logs:CreateLogGroup`, `logs:CreateLogStream`,
    `logs:PutLogEvents`) is attached (usually added by default).

---

## Step 4: Configure S3 Event Notification Trigger**

1. **Navigate to S3 Bucket:** Go to the S3 console and select your VPC Flow Log bucket.
2. **Properties Tab:** Go to the "Properties" tab.
3. **Event Notifications:** Scroll down to "Event notifications" and click
  "Create event notification".
4. **Event Name:** Give it a name (e.g., trigger-flow-log-lambda).
5. **Prefix (Optional but Recommended):** Specify the S3 prefix where your
  flow logs are stored (e.g., `AWSLogs/`). This prevents triggering on other
  files. Check your S3 bucket to see the exact path structure created by Flow Logs.
6. **Suffix (Optional but Recommended):** Specify `.gz` (or `.log` if uncompressed)
  to only trigger on log files.
7. **Event Types:** Select `s3:ObjectCreated:Put` or
  `s3:ObjectCreated:CompleteMultipartUpload` (or just All object create events).
  `Put` is usually sufficient for Flow Logs.
8. **Destination:** Choose "Lambda function".
9. **Lambda Function:** Select the Lambda function you created (`vpc-flow-log-s3-to-otlp-processor`).
10. **Save Changes:** Click "Save changes". S3 will automatically attempt to add
  the necessary permissions to the Lambda function to allow S3 to invoke it.

---

## Step 5: Test and Monitor**

1. **Wait for Logs:**
  Allow some time for VPC Flow Logs to generate new files in the S3 bucket.
2. **Check Lambda Invocations:**
  Monitor the Lambda function in the Base14 Dashboards under "Library" > "Logs View"
3. **Check Lambda Logs:**
  Examine the Log Group associated with your Lambda function for detailed
  execution logs, including any print statements or error messages.
  Look for lines like "Processing object..." and "Finished processing...".

---

This detailed setup provides a robust way to process VPC Flow Logs from S3
using Lambda and forward them via OTLP. We can further adjust parsing logic,
OTel configuration, and IAM permissions based on your specific Flow Log format
and environment.

## Related Guides

- [Application Load Balancer Monitoring](./elb.md) - Monitor AWS ALB with logs
  and metrics
- [Docker Compose Setup](../../collector-setup/docker-compose-example.md) - Set
  up collector for local development
- [OTel Collector Configuration](../../collector-setup/otel-collector-config.md) -
  Advanced collector configuration
