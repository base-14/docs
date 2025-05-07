---
date: 2025-04-29
id: collecting-aws-cloudwatch-metrics-using-kinesis-streams
title: AWS CloudWatch Metric Streams with Amazon Data Firehose
description: Use Scout to monitor your AWS Components
hide_table_of_contents: true
---

Using Amazon CloudWatch Metric Streams and Amazon Data Firehose,
you can get CloudWatch metrics into Scout Collector with only a two to
three minute latency. This is significantly faster than polling approach

## Step 1: Creating a S3 Bucket

First, We'll create a s3 to bucket to store the metrics

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

> Format is
`s3://<your-bucket-name>`

- Enable `New Line Delimiter` and leave everything else as default settings.
- Scroll down and click on `Create Firehose Stream`.
![Firehose source config](/img/cloudwatch-kinesis-stream/configure-source-in-kinesis.png)

## Step 3: Creating a Metrics Stream pipeline

Now, we'll configure cloudwatch to use the kinesis
firehose stream to stream metrics to S3

### 1. Navigate to Cloudwatch dashboard and

### Select streams under Metrics

![cloudwatch dashboard](/img/cloudwatch-kinesis-stream/cloudwatch-dashboard.png)

### 2. Click on `Create Metrics Stream`

![cloudwatch metrics stream dashboard](/img/cloudwatch-kinesis-stream/cloudwatch-metrics-stream.png)

### 3. Configuring the Stream

- Select `Custom Setup with Firehose`.
- Change output format to `opentelemetry 1.0`
- Select the required metrics.
- Give a name to the pipeline.
` Click on `Create Metrics Stream`.

> Good Job, Now the Cloudwatch metrics are streaming to a S3 bucket.

## Step 4: Creating a lambda function

Now, let's create a lambda function to read from the s3 and
send it to otel collector

### 1. Create a layer with all the necessary packages

```shell
mkdir python 
# move into that directory
cd python

# install requests module
pip install --target . requests opentelemetry-proto protobuf
# zip the contents under the name dependencies.zip
zip -r dependencies.zip ../python
```

### 2. Navigate to AWS Lambda dashboard and click on `Layers`

![lambda dashboard](/img/cloudwatch-kinesis-stream/lambda-dashboard.png)

- Click on `Create layer` button

### 3. Fill the necessary detials and update the zip file

![create lambda page](/img/cloudwatch-kinesis-stream/create-lambda-layer-page.png)

### 4. Naviagte to functions page and Click on `Create function` button

![lambda functions page](/img/cloudwatch-kinesis-stream/lambda-functions-page.png)

- Select `Author from scratch`.
- Give a funciton name.
- Choose `python x.x` as the runtime.
- Select `x86_64` as the Architecture.

- Once the function is created, follow the below steps to configure it,

- Click on the `Configuration` tab and then click on `permissions`.
- Click on the Role name and give S3 Full access
for the above created
bucket.
- Click on `Code` and scroll to add a new layer.
- Click on `Add Layer`.
- Select `Custom Layer` and choose the layer that we created.
- Navigate back to the code and click on `Add trigger`.
- Select `S3` as the source and select the bucket from dropdown.
- Click on `Add`.
- Navigate to `Configuration` and then to `Environment variables`.
- Click on `edit` and these two environment variables with correct values.
(`OTEL_COLLECTOR_URL`, `S3_BUCKET_NAME`, `OTEL_SERVICE_NAME`).

Now the actual part, copy the below code into the `code source`
in your lambda function.

```python
import requests
import boto3
import os
from google.protobuf.message import DecodeError
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest

# CONFIGURE THESE:
OTEL_COLLECTOR_URL = os.environ.get('OTEL_COLLECTOR_URL')
SERVICE_NAME = os.environ.get('OTEL_SERVICE_NAME', "awsCloudwatchMetrics")
# Initialize the S3 client
s3_client = boto3.client('s3')

def send_metrics_to_otel(request_obj):
    headers = {
        "Content-Type": "application/x-protobuf",
    }
    for resource_metric in request_obj.resource_metrics:
        if resource_metric.resource:
            resource_metric.resource.attributes.add(
                key="service.name",
                value={"string_value": SERVICE_NAME}
            )
    payload = request_obj.SerializeToString()
    response = requests.post(OTEL_COLLECTOR_URL, headers=headers, data=payload)
    if response.status_code == 200:
        print("Metrics successfully forwarded.")
    else:
        print(
            f"Failed to send metrics. Status: {response.status_code}, "
            f"Response: {response.text}"
        )

def load_and_parse_file(bucket, key):
    # Fetch the file from S3
    response = s3_client.get_object(  
        Bucket=bucket, Key=key  
    )
    data = response['Body'].read()  # Read the entire file as bytes
    return data

def parse_metrics(data):
    offset = 0
    total_len = len(data)
    messages = []

    while offset < total_len:
        # Read the varint (length prefix)
        msg_len, new_pos = _DecodeVarint32(data, offset)
        if msg_len <= 0:
            print("Invalid message length.")
            break
        
        # Extract the actual protobuf message based on the length
        msg_buf = data[new_pos:new_pos + msg_len]

        try:
            # Parse the protobuf message
            request = ExportMetricsServiceRequest()
            request.ParseFromString(msg_buf)
            messages.append(request)
            print(f"Parsed ExportMetricsServiceRequest at offset {offset}.")
        except DecodeError as e:
            print(f"Decode error at offset {offset}: {e}")
            break

        # Move the offset by the length of the message
        offset = new_pos + msg_len

    return messages

def _DecodeVarint32(buf, position):
    # Decodes a varint32 (unsigned 32-bit integer) from the buffer
    # It returns the decoded varint value and the new position in the buffer
    shift = 0
    result = 0
    while True:
        byte = buf[position]
        position += 1
        result |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            break
        shift += 7
    return result, position

def process_s3_directory(bucket, prefix=''):
    # List all files in the specified S3 directory (including subdirectories)
    response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter='/')

    # Process files directly in the current directory
    for obj in response.get('Contents', []):
        file_key = obj['Key']
        print(f"Processing file: {file_key}")
        try:
            data = load_and_parse_file(bucket, file_key)
            metrics = parse_metrics(data)
            for metric in metrics:
                send_metrics_to_otel(metric)
        except Exception as e:
            print(f"Error processing file {file_key}: {e}")
    
    # Recursively process subdirectories (if any)
    for prefix_dir in response.get('CommonPrefixes', []):
        subdir_prefix = prefix_dir['Prefix']
        print(f"Descending into subdirectory: {subdir_prefix}")
        process_s3_directory(bucket, subdir_prefix)

def lambda_handler(event, context):
    # Check if this is being triggered by an S3 event
    if 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
        print("Lambda triggered by S3 event.")
        
        # Get the bucket name and object key from the S3 event
        bucket_name = event['Records'][0]['s3']['bucket']['name']
        file_key = event['Records'][0]['s3']['object']['key']
        
        # Process the directory where the file is located
        process_s3_directory(bucket_name)
    else:
        print("Lambda triggered manually.")
        
        bucket_name = os.environ.get('S3_BUCKET_NAME', event.get('bucket_name', S3_BUCKET_NAME))
        prefix = os.environ.get('S3_PREFIX', event.get('prefix', ''))
        
        if not bucket_name:
            return {
                'statusCode': 400,
                'body': 'Missing S3_BUCKET_NAME in environment variables'
            }
        
        print(f"Processing bucket: {bucket_name} with prefix: {prefix}")
        process_s3_directory(bucket_name, prefix)

    return {
        'statusCode': 200,
        'body': 'Metrics successfully processed and forwarded to OTEL Collector'
    }
```

- Click on the `Deploy`

## That's it, you're done

Head back to the Scout dashboards to view all your AWS Services metrics.
