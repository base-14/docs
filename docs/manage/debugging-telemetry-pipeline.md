---
title: Debugging Telemetry Pipeline Issues
sidebar_label: Debugging Pipeline Issues
sidebar_position: 6
description:
  Step-by-step guide to debug OpenTelemetry Collector issues. Learn how to
  diagnose and fix common telemetry pipeline problems in Scout.
keywords:
  [
    otel collector debugging,
    telemetry troubleshooting,
    opentelemetry issues,
    collector logs,
    pipeline debugging,
    scout troubleshooting,
  ]
---

# Debugging Telemetry Pipeline Issues

This guide walks you through a systematic approach to diagnose and fix
telemetry pipeline issues. You'll learn how to investigate problems with your
OpenTelemetry Collector, identify root causes, and resolve common
configuration errors.

## Overview

When telemetry data isn't flowing as expected, a structured debugging approach
helps you quickly identify and resolve issues. This guide covers:

- Verifying collector health and connectivity
- Checking configuration and authentication
- Analyzing collector logs
- Testing data flow at each pipeline stage
- Common issues and solutions

## Prerequisites

- Access to your OpenTelemetry Collector deployment
- Access to collector logs (via Docker logs, kubectl logs, or system logs)
- Basic understanding of your collector configuration
- Access to Scout dashboard

## Debugging Strategy

Follow this step-by-step investigation process to identify and resolve
telemetry pipeline issues.

## Step 1: Verify Collector is Running

First, confirm that your collector is running and healthy.

### Docker

```bash
# Check if collector container is running
docker ps | grep otel-collector

# Check collector status
docker inspect otel-collector | grep Status
```

### Kubernetes

```bash
# Check collector pods
kubectl get pods -n <namespace> | grep otel-collector

# Check pod status
kubectl describe pod <otel-collector-pod-name> -n <namespace>
```

### Linux Service

```bash
# Check service status
sudo systemctl status otel-collector

# Check if process is running
ps aux | grep otel-collector
```

**What to look for:**
- Pod/container is in Running state
- No recent restarts or crashes
- Process is active and consuming resources

## Step 2: Check Collector Logs

Collector logs provide detailed information about what's happening in your
telemetry pipeline.

### Docker

```bash
# View recent logs
docker logs otel-collector --tail=100

# Follow logs in real-time
docker logs -f otel-collector
```

### Kubernetes

```bash
# View recent logs
kubectl logs <otel-collector-pod-name> -n <namespace> --tail=100

# Follow logs in real-time
kubectl logs -f <otel-collector-pod-name> -n <namespace>
```

### Linux Service

```bash
# View recent logs
sudo journalctl -u otel-collector -n 100

# Follow logs in real-time
sudo journalctl -u otel-collector -f
```

**What to look for in logs:**
- Startup messages confirming successful initialization
- Authentication success/failure messages
- Receiver, processor, and exporter status
- Error messages or warnings
- Connection errors to Scout backend

### Common Log Patterns

**Successful startup:**
```
Everything is ready. Begin running and processing data.
```

**Authentication errors:**
```
rpc error: code = Unauthenticated desc = authentication failed
```

**Connection errors:**
```
connection refused
failed to connect to endpoint
```

## Step 3: Verify Configuration Syntax

Configuration errors are a common cause of collector issues.

### Validate Configuration

**Option 1: Use the collector's built-in validator**

```bash
# Validate your configuration file
otelcol validate --config=/path/to/otel-collector-config.yaml
```

**Option 2: Use OTel Bin online validator**

Visit [https://www.otelbin.io/](https://www.otelbin.io/) to validate and test
your collector configuration in the browser. This tool provides syntax
validation and helpful error messages.

### Check Configuration File Location

Ensure the collector is loading the correct configuration file:

**Docker:**
```bash
# Check mounted config file
docker inspect otel-collector | grep -A 10 Mounts
```

**Kubernetes:**
```bash
# Check ConfigMap
kubectl get configmap otel-collector-config -n <namespace> -o yaml
```

**Common configuration issues:**
- Incorrect indentation in YAML
- Missing required fields
- Typos in component names
- Incorrect file path in volume mounts

## Step 4: Test Authentication

Authentication issues prevent data from reaching Scout.

### Verify OAuth Credentials

Check that your OAuth credentials are correctly configured:

```yaml
extensions:
  oauth2client:
    client_id: __YOUR_CLIENT_ID__
    client_secret: __YOUR_CLIENT_SECRET__
    endpoint_params:
      audience: b14collector
    token_url: https://id.b14.dev/realms/<org name>/protocol/openid-connect/token
```

**Common authentication issues:**
- Incorrect client_id or client_secret
- Wrong organization name in token_url
- Missing or incorrect audience parameter
- Expired credentials

## Step 5: Verify Network Connectivity

Ensure the collector can reach the Scout backend.

### Test Scout Backend Connectivity

```bash
# Test OTLP endpoint connectivity
curl -v <scout-backend-endpoint-url>
```

**Common connectivity issues:**
- Firewall blocking outbound connections
- Network policy restrictions (Kubernetes)

## Step 6: Check Data in Scout Dashboard

Verify data is appearing in Scout after confirming the collector is sending
it.

### Check for Recent Data

1. Log in to Scout dashboard
2. Navigate to **Traces**, **Metrics**, or **Logs** section
3. Verify time range includes recent data
4. Check service filters match your application names

### Verify Service Names

Ensure service names in your application match what you expect:

```yaml
processors:
  resource:
    attributes:
      - key: service.name
        value: my-application
        action: upsert
```

## Common Issues and Solutions

### Issue: No Data in Scout Dashboard

**Symptoms:**
- Collector logs show successful data export
- No data appears in Scout dashboard

**Solutions:**
1. Verify time range in Scout dashboard includes recent timestamps
2. Check service name filters match exactly (case-sensitive)
3. Confirm environment filters match your configuration
4. Wait 1-2 minutes for data to process and appear

### Issue: Collector Keeps Restarting

**Symptoms:**
- Container/pod continuously restarts
- "CrashLoopBackOff" in Kubernetes

**Solutions:**
1. Check logs for configuration errors
2. Verify YAML syntax is correct
3. Ensure required environment variables are set
4. Check memory limits aren't too restrictive

### Issue: Authentication Failures

**Symptoms:**
- Logs show "Unauthenticated" or "401" errors
- Data doesn't reach Scout backend

**Solutions:**
1. Verify client_id and client_secret are correct
2. Check organization name in token_url is accurate
3. Ensure credentials haven't expired
4. Test OAuth token generation manually

### Issue: Memory or Performance Problems

**Symptoms:**
- Collector using excessive memory
- High CPU usage
- Slow data processing

**Solutions:**
1. Enable memory_limiter processor:
```yaml
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 512
```

2. Adjust batch processor settings:
```yaml
processors:
  batch:
    timeout: 10s
    send_batch_size: 1024
```

3. Review pipeline configuration for inefficient processors

### Issue: Partial Data Loss

**Symptoms:**
- Some telemetry data arrives, but not all
- Intermittent data flow

**Solutions:**
1. Check for timeout errors in logs
2. Verify network stability
3. Increase batch processor timeout
4. Check receiver buffer settings

### Issue: No Data Despite Correct Configuration

**Symptoms:**
- No error logs in collector
- All filters in dashboard are correct
- Collector shows successful exports
- Still no data appears in Scout

**Solutions:**
1. Check pipeline configuration - data might not be routed correctly through
   receivers, processors, and exporters
2. Verify the correct signals (traces, metrics, logs) are configured in service
   pipelines
3. Review
   [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md)
   for additional pipeline configuration options
4. Enable debug logging temporarily to trace data flow through the pipeline

### Issue: Only Application Data Missing

**Symptoms:**
- Infrastructure metrics and logs are flowing
- Application traces/metrics/logs are not appearing
- Other collector data sources work fine

**Solutions:**
1. Check connectivity between your application and the collector:
   ```bash
   # Test if application can reach collector
   curl http://<collector-host>:4318/v1/traces
   ```
2. Verify application instrumentation configuration points to correct collector
   endpoint
3. Check application logs for OpenTelemetry SDK errors or warnings
4. Confirm application is successfully sending telemetry (check SDK logs)
5. Verify the OTLP receiver is enabled in collector configuration:
   ```yaml
   receivers:
     otlp:
       protocols:
         http:
           endpoint: 0.0.0.0:4318
         grpc:
           endpoint: 0.0.0.0:4317
   ```

## Related Guides

- [Quick Start](./quick-start.md) - Initial Scout setup and verification
- [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md) -
  Detailed collector configuration guide
- [Docker Compose Setup](../instrument/collector-setup/docker-compose-example.md) -
  Docker-specific setup and troubleshooting
- [Kubernetes Helm Setup](../instrument/collector-setup/kubernetes-helm-setup.md) -
  Kubernetes deployment and debugging

## References

- [OpenTelemetry Collector Troubleshooting](https://opentelemetry.io/docs/collector/troubleshooting/) -
  Official troubleshooting guide
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/) -
  Configuration reference
