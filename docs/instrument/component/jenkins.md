---
title: >
  Jenkins OpenTelemetry Monitoring - Build Results, Executor Usage,
  and Collector Setup
sidebar_label: Jenkins
id: collecting-jenkins-telemetry
sidebar_position: 39
description: >
  Collect Jenkins metrics with the OpenTelemetry Collector. Monitor
  build results, executor usage, and queue depth using the Prometheus
  receiver and export to base14 Scout.
keywords:
  - jenkins opentelemetry
  - jenkins otel collector
  - jenkins metrics monitoring
  - jenkins performance monitoring
  - opentelemetry prometheus receiver jenkins
  - jenkins observability
  - jenkins ci cd monitoring
  - jenkins telemetry collection
---

# Jenkins

Jenkins exposes Prometheus-format metrics at `/prometheus/` when the
Prometheus Metrics plugin is installed. The OpenTelemetry Collector
scrapes this endpoint using the Prometheus receiver, collecting 60+
metrics including build results, executor usage, queue depth, node
status, and JVM statistics. This guide installs the plugin, configures
the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended  |
| ---------------------- | ------- | ------------ |
| Jenkins                | 2.387   | LTS (latest) |
| Prometheus Metrics plugin | 2.0  | latest       |
| OTel Collector Contrib | 0.90.0  | latest       |
| base14 Scout           | Any     | -            |

Before starting:

- Jenkins web port (8080) must be accessible from the host running the
  Collector
- The Prometheus Metrics plugin must be installed - metrics are not
  available without it
- Jenkins initial setup wizard must complete before metrics appear
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Jobs**: total count, build duration, build result
  (success/failure/unstable/aborted), queue depth
- **Executors**: total count, busy count, idle count, queue length
- **Nodes**: online count, offline count
- **HTTP**: active requests, response codes (ok, not found, server
  error, forbidden)
- **JVM**: heap/non-heap memory, GC collection time, thread states,
  class loading, buffer pools
- **System**: uptime, CPU load, plugin count (active/failed/inactive)

Full metric list:
[Prometheus Metrics Plugin](https://plugins.jenkins.io/prometheus/) or
run `curl -s http://localhost:8080/prometheus/` against your Jenkins
instance.

## Access Setup

Install the Prometheus Metrics plugin via the Jenkins UI or CLI.

**Via Jenkins Plugin Manager:**

1. Navigate to **Manage Jenkins** → **Manage Plugins** → **Available**
2. Search for "Prometheus Metrics"
3. Install and restart Jenkins

**Via Docker (recommended for automation):**

Create a custom Dockerfile that installs the plugin at build time:

```dockerfile showLineNumbers title="jenkins/Dockerfile"
FROM jenkins/jenkins:lts-jdk17
RUN jenkins-plugin-cli --plugins prometheus
```

Disable the setup wizard for automated deployments:

```yaml showLineNumbers title="docker-compose.yaml (excerpt)"
jenkins:
  build: ./jenkins
  environment:
    JAVA_OPTS: -Djenkins.install.runSetupWizard=false
```

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Jenkins is running
curl -so /dev/null -w "%{http_code}" http://localhost:8080/login

# Verify Prometheus metrics endpoint (trailing slash required)
curl -s http://localhost:8080/prometheus/ | head -20
```

The `/prometheus/` endpoint does not require authentication by default.
This is configurable in the plugin settings under **Manage Jenkins** →
**Prometheus**.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: jenkins
          scrape_interval: 30s
          metrics_path: /prometheus/   # Trailing slash required
          static_configs:
            - targets:
                - ${env:JENKINS_HOST}:8080

processors:
  resource:
    attributes:
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

# Export to base14 Scout
exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
JENKINS_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Authentication

If Jenkins requires authentication for the `/prometheus/` endpoint,
add basic auth to the scrape config:

```yaml showLineNumbers title="config/otel-collector.yaml (auth)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: jenkins
          metrics_path: /prometheus/
          basic_auth:
            username: ${env:JENKINS_USER}
            password: ${env:JENKINS_TOKEN}
          static_configs:
            - targets:
                - ${env:JENKINS_HOST}:8080
```

Use a Jenkins API token rather than a password for `JENKINS_TOKEN`.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for successful scrape
docker logs otel-collector 2>&1 | grep -i "jenkins"

# Verify Jenkins is healthy
curl -so /dev/null -w "%{http_code}" http://localhost:8080/login

# Check metrics endpoint directly
curl -s http://localhost:8080/prometheus/ | grep jenkins_
```

## Troubleshooting

### /prometheus/ returns 404

**Cause**: The Prometheus Metrics plugin is not installed or Jenkins has
not finished starting.

**Fix**:

1. Verify the plugin is installed:
   **Manage Jenkins** → **Manage Plugins** → **Installed**
2. Wait for Jenkins to fully start - the setup wizard must complete
3. Confirm the URL includes the trailing slash: `/prometheus/` not
   `/prometheus`

### Connection refused on port 8080

**Cause**: Collector cannot reach Jenkins at the configured address.

**Fix**:

1. Verify Jenkins is running: `docker ps | grep jenkins`
2. Jenkins takes 30-60 seconds to start - check
   `docker logs jenkins` for startup progress
3. Check firewall rules if the Collector runs on a separate host

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

### Build metrics showing zero

**Cause**: No builds have run since Jenkins started.

**Fix**:

1. Run a build to generate build metrics
2. Build metrics are only populated after at least one job execution
3. System-level metrics (executors, nodes, JVM) appear immediately

## FAQ

**Can I use the Jenkins OpenTelemetry plugin instead?**

Yes. The Jenkins OpenTelemetry plugin sends OTLP traces and metrics
directly to the Collector, focusing on CI pipeline observability
(build traces, step durations). This guide uses the Prometheus Metrics
plugin for server health metrics (executors, queue depth, JVM).
The two approaches are complementary - you can use both.

**Does this work with Jenkins running in Kubernetes?**

Yes. Scrape the Jenkins service endpoint on port 8080. Ensure the
Prometheus Metrics plugin is installed in the Jenkins container image.
The Collector can run as a sidecar or DaemonSet.

**How do I monitor Jenkins agents?**

Jenkins agents do not expose their own metrics endpoint. Agent
availability is reflected in the controller's metrics:
`jenkins_node_online_value` and `jenkins_executor_*` metrics track
agent node status and executor usage.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [ArgoCD](../../guides/cicd-observability/argocd.md) and other CI/CD components
- **Fine-tune Collection**: Use `metric_relabel_configs` to focus on
  build, executor, and queue metrics for production alerting

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [ArgoCD Monitoring](../../guides/cicd-observability/argocd.md)
  - GitOps delivery monitoring
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) —
  Alert on Jenkins metrics
