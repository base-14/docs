---
title: >
  Jenkins OpenTelemetry Monitoring - Build Results, Executor Usage,
  and Queue Depth
sidebar_label: Jenkins
id: collecting-jenkins-telemetry
sidebar_position: 39
description: >
  Collect Jenkins metrics with the OpenTelemetry Collector. Monitor build
  results, executor usage, and queue depth via the Prometheus Metrics
  plugin and ship to base14 Scout.
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

Jenkins exposes Prometheus text at `/prometheus/` (trailing slash) on the
web port `:8080` when the Prometheus Metrics plugin is installed. The
Collector's `prometheus` receiver scrapes it, collecting 350+ metrics
across build results, executor usage, queue depth, node / agent status,
plugin health, HTTP request handling, and the JVM. This guide installs the
plugin, configures the receiver, and ships metrics to base14 Scout.

## Prerequisites

| Requirement               | Minimum | Recommended  |
| ------------------------- | ------- | ------------ |
| Jenkins                   | 2.479.3 | LTS (latest) |
| Prometheus Metrics plugin | Current | latest       |
| OTel Collector Contrib    | 0.90.0  | 0.153.0      |
| base14 Scout              | Any     | -            |

Before starting:

- The Jenkins web port (`8080`) must be reachable from the host running
  the Collector.
- The Prometheus Metrics plugin must be installed - Jenkins exposes no
  metrics without it. The plugin uses Jenkins date-based versioning (for
  example `852.v…`) rather than semantic versions; a current release requires
  Jenkins 2.479.3 or later.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review. Every row traces to a metric Jenkins actually emits on
this endpoint.

A few things about this surface shape what you see:

- **Two liveness signals.** `up` is the prometheus receiver's scrape
  liveness - it reads `1` when `/prometheus/` responds. `default_jenkins_up`
  is the plugin's own gauge - `1` means the Jenkins controller is up.
  `default_jenkins_uptime` is controller uptime in milliseconds; a reset
  flags a restart.
- **Collection-period gotcha.** The Prometheus plugin collects metrics on a
  timer (`COLLECTING_METRICS_PERIOD_IN_SECONDS`, default `120s`) and serves
  the last cached snapshot. Immediately after start, `/prometheus/` returns
  `200` with an empty body until the first collection completes, so early
  scrapes carry only `up` and the `scrape_*` meta. This is expected, not a
  failure.
- **Two Jenkins namespaces share the endpoint.** `default_jenkins_*` is the
  Prometheus plugin's curated export - per-job build results
  (`default_jenkins_builds_*`, labeled by `jenkins_job`) plus controller-wide
  executors, up, uptime, and version. `jenkins_*` is the underlying `metrics`
  (Dropwizard) plugin re-exposed - executor, queue, node, project, job, task,
  health-check, plugins, and run-result families, most as a `_value`
  (current) and a `_history` (server-windowed) pair.
- **`_history` series are pre-windowed.** The plugin computes rolling windows
  server-side, so `system_cpu_load_x100_window_{1m,5m,15m,1h}` and the
  `*_history` variants carry aggregates the receiver did not compute; the
  `_value` series is the instantaneous read.
- **Run-result counters are the CI-health signal.**
  `jenkins_runs_success_total`, `jenkins_runs_failure_total`,
  `jenkins_runs_unstable_total`, `jenkins_runs_aborted_total`, and
  `jenkins_runs_not_built_total` are the controller-wide build outcomes;
  `default_jenkins_builds_last_build_result_ordinal` is the per-job last
  result (`0` = success ... `4` = not built).
- **Two parallel JVM exports.** `vm_*` is the Dropwizard JVM instrumentation
  (`vm_memory_*` is the largest family on this endpoint - per-pool used /
  committed / max / init). `jvm_*` is the Prometheus client's own JVM export.
  They overlap; keep one in production.

### Core - is it up and are builds passing

| Metric | What it tells you |
|---|---|
| `up` | Prometheus scrape liveness - `1` = the `/prometheus/` endpoint responded. The monitoring liveness signal. |
| `default_jenkins_up` | The Jenkins controller is up (the plugin's own check). |
| `jenkins_runs_failure_total` | Builds that finished as failure - the headline CI-health signal. |
| `jenkins_runs_success_total` | Builds that finished successfully - build throughput. |
| `jenkins_queue_size_value` | Current build-queue depth - the backlog of builds waiting for an executor. |
| `default_jenkins_executors_busy` | Executors currently running builds - utilization against capacity. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `default_jenkins_uptime` | Controller uptime in milliseconds - a reset indicates a restart. |
| `default_jenkins_quietdown` | `1` = the controller is in quiet-down, refusing new builds. |
| `default_jenkins_executors_available`, `_idle`, `_online`, `_defined`, `_connecting` | Executor pool: available, idle, online, defined, and connecting counts - capacity headroom. |
| `default_jenkins_executors_queue_length` | Items queued waiting for an executor. |
| `jenkins_runs_unstable_total`, `jenkins_runs_aborted_total`, `jenkins_runs_not_built_total` | Builds that finished unstable / aborted / not-built. |
| `default_jenkins_builds_last_build_result_ordinal` | Per-job last build result (`0` = success ... `4` = not built) - which job last broke. |
| `default_jenkins_builds_health_score` | Per-job health score (0-100, the weather icon). |
| `default_jenkins_builds_last_build_duration_milliseconds` | Per-job last build duration - regressions in build time. |
| `default_jenkins_builds_duration_milliseconds_summary` | Per-job build-duration distribution. |
| `jenkins_queue_blocked_value`, `jenkins_queue_buildable_value`, `jenkins_queue_stuck_value` | Queue breakdown - blocked, buildable, and stuck items (stuck = cannot proceed). |
| `jenkins_executor_count_value`, `jenkins_executor_free_value` | Total and free executors. |
| `jenkins_node_online_value`, `jenkins_node_offline_value` | Build-node online and offline counts - agent availability. |
| `jenkins_job_building_duration`, `jenkins_job_queuing_duration` | Time jobs spend building and queuing (summaries). |
| `jenkins_health_check_score` | The controller's aggregate health-check self-assessment. |
| `jenkins_plugins_failed`, `jenkins_plugins_active` | Plugins that failed to load (non-zero breaks functionality) and active plugin count. |
| `http_requests` | HTTP request rate / latency to the controller (summary). |
| `http_responseCodes_serverError_total` | Controller 5xx responses. |
| `system_cpu_load` | System CPU load on the controller host. |
| `jvm_memory_bytes_used` | JVM heap + non-heap bytes used - controller memory pressure. |
| `vm_memory_heap_usage` | JVM heap usage ratio (Dropwizard). |
| `jvm_threads_current` | Live JVM threads. |

### Diagnostic - for investigation and tuning

Higher cardinality and drill-down detail; reach for these during an incident
or a capacity review. They are grouped here rather than enumerated - run a
`curl` against `/prometheus/` for the exhaustive list.

| Group | Representative members | When you reach for it |
|---|---|---|
| Version info | `default_jenkins_version_info` | Confirm the controller version on the wire. |
| Per-job bookkeeping | `default_jenkins_builds_last_build_logfile_size_bytes`, `default_jenkins_builds_discard_active`, the `_created` timestamp series | Log-size growth, discard policy, and Prometheus client `_created` bookkeeping. |
| Pre-windowed history | `jenkins_queue_size_history`, `jenkins_executor_count_history` and the other `_history` gauges | Server-computed rolling windows of the `_value` gauges. |
| CPU-load windows | `system_cpu_load_x100_window_1m` / `_5m` / `_15m` / `_1h` | Rolling CPU-load windows (value x100), computed server-side. |
| Non-error HTTP codes | `http_responseCodes_ok_total` and the other non-error response counters | Traffic mix on the controller's web layer. |
| Dropwizard JVM memory | `vm_memory_*` (per-pool used / committed / max / init - the largest family on this endpoint) | Heap and per-pool memory drill-down. |
| JVM detail | `vm_gc_*`, `vm_file_descriptor_*`, the `jvm_memory_pool_*` and `jvm_threads_*` series | GC, file-descriptor, and thread-state investigation across both JVM exports. |
| Scrape meta | `scrape_duration_seconds`, `scrape_samples_scraped` | Receiver-side scrape health, not from Jenkins. |

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. State
alerts read a value Jenkins reports directly; the rest are relative to your
own baseline. These are starting points - tune them to your workload.

| Alert | Condition | Why it matters |
|---|---|---|
| Jenkins unreachable | `up == 0` for > 1m, or `default_jenkins_up == 0` | The endpoint or the controller is down - check the Jenkins process and port `8080`. |
| Build failures rising | `rate(jenkins_runs_failure_total)` rising vs baseline | Builds are breaking - identify the job via `default_jenkins_builds_last_build_result_ordinal`. |
| Queue backing up | `jenkins_queue_size_value` rising vs baseline, or `jenkins_queue_stuck_value > 0` | Builds are waiting for executors (or are stuck) - add executors / agents or clear the blocker. |
| Executors saturated | `default_jenkins_executors_busy == default_jenkins_executors_available` sustained | No free executors - throughput is capped; scale agents. |
| Agents offline | `jenkins_node_offline_value > 0` | Build agents are offline - capacity is reduced; check agent connectivity. |
| Plugin load failures | `jenkins_plugins_failed > 0` | One or more plugins failed to load - functionality is broken; check the plugin and Jenkins logs. |
| Build duration regression | `default_jenkins_builds_last_build_duration_milliseconds` rising vs baseline for a job | A job got slower - inspect recent changes and agent load. |
| HTTP server errors | `rate(http_responseCodes_serverError_total) > 0` | The controller is returning 5xx - check the Jenkins log and load. |
| Controller memory pressure | `jvm_memory_bytes_used` rising toward max, or `vm_memory_heap_usage` near `1` | The JVM is running out of heap - raise `-Xmx` or reduce load; GC thrash slows everything. |
| Quiet-down stuck on | `default_jenkins_quietdown == 1` unexpectedly | The controller is refusing new builds - cancel quiet-down if it was not intended. |

## Access Setup

Install the Prometheus Metrics plugin, then point the receiver at
`/prometheus/`.

Install via the Jenkins UI under **Manage Jenkins** → **Plugins** →
**Available plugins** (search for "Prometheus Metrics"), or bake it into the
controller image with the CLI:

```dockerfile showLineNumbers title="jenkins/Dockerfile"
FROM jenkins/jenkins:lts-jdk17
RUN jenkins-plugin-cli --plugins prometheus
```

The `/prometheus/` endpoint is unauthenticated by default. The exposure
path, collection period, and access settings are configurable under
**Manage Jenkins** → the Prometheus plugin settings.

Verify the endpoint is serving (the trailing slash is required):

```bash showLineNumbers title="Verify access"
# Check Jenkins is up
curl -so /dev/null -w "%{http_code}" http://localhost:8080/login

# Verify the Prometheus metrics endpoint (trailing slash required)
curl -s http://localhost:8080/prometheus/ | head -20
```

Right after start the body may be empty until the first collection cycle
completes (see the collection-period note above) - re-run after the cycle.

## Configuration

The `prometheus` receiver scrapes `/prometheus/` on `:8080`. The
`metric_relabel_configs` keep filter scopes collection to the Jenkins
families and drops the JVM `vm_*` / `jvm_*` noise; remove it to keep the
full JVM detail.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: jenkins
          scrape_interval: 10s
          metrics_path: /prometheus/   # Trailing slash required
          static_configs:
            - targets:
                - ${env:JENKINS_HOST}:8080
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: 'jenkins_.*|default_jenkins_.*|up'
              action: keep

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

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

If you secure `/prometheus/`, add basic auth to the scrape config and use a
Jenkins API token rather than a password:

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

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers
# Check Collector logs for scraped Jenkins metrics
docker logs otel-collector 2>&1 | grep -i "jenkins"

# Check the metrics endpoint directly (trailing slash required)
curl -s http://localhost:8080/prometheus/ | grep jenkins_

# Run a build so the build-result families advance
# (or wait for a scheduled job to fire)
```

## Troubleshooting

### No Jenkins metrics on `/prometheus/`

**Cause**: The Prometheus Metrics plugin is not installed - Jenkins exposes
no metrics without it.

**Fix**:

1. Confirm the plugin under **Manage Jenkins** → **Plugins** →
   **Installed plugins**.
2. If it is missing, install it (UI or
   `jenkins-plugin-cli --plugins prometheus`) and restart Jenkins.
3. Confirm the URL includes the trailing slash: `/prometheus/`, not
   `/prometheus`.

### Endpoint returns an empty body right after start

**Cause**: The Prometheus plugin collects metrics on a timer (default
`120s`) and serves the last cached snapshot, so the first cycle has not
completed yet.

**Look at**: `up` and the `scrape_*` series - early scrapes carry only
these until the first collection populates the Jenkins families.

**Fix**:

1. Wait for the first collection cycle (up to
   `COLLECTING_METRICS_PERIOD_IN_SECONDS`, default `120s`).
2. Re-run `curl http://localhost:8080/prometheus/` - the body fills once the
   cycle completes.

### Build metrics are missing

**Cause**: The build families need at least one job that has run.

**Look at**: `jenkins_runs_*` and `default_jenkins_builds_*` - these stay
absent on a controller with no executed builds, while the executor, queue,
and node families appear immediately.

**Fix**:

1. Run a job (or wait for a scheduled trigger to fire).
2. Build-result and per-job metrics populate after the first execution.

### Connection refused on port 8080

**Cause**: The Collector cannot reach Jenkins at the configured address.

**Fix**:

1. Verify Jenkins is running: `docker ps | grep jenkins`.
2. Jenkins takes 30-60 seconds to start - check `docker logs jenkins` for
   startup progress.
3. Check firewall rules if the Collector runs on a separate host.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Jenkins running in Kubernetes?**

Yes. Set the scrape target to the Jenkins service DNS endpoint on port
`8080` (e.g., `jenkins.default.svc.cluster.local:8080`) and bake the
Prometheus Metrics plugin into the controller image. The Collector can run
as a sidecar or DaemonSet.

**What is the difference between `up` and `default_jenkins_up`?**

`up` is the prometheus receiver's scrape liveness - `1` means the
`/prometheus/` endpoint responded. `default_jenkins_up` is the plugin's own
gauge - `1` means the Jenkins controller itself reports healthy. Alert on
both: a down endpoint and a down controller are different failures.

**Why is `/prometheus/` empty right after startup?**

The Prometheus plugin collects metrics on a timer
(`COLLECTING_METRICS_PERIOD_IN_SECONDS`, default `120s`) and serves the last
cached snapshot. Until the first cycle completes, the endpoint returns `200`
with an empty body and scrapes carry only `up` and `scrape_*`. Wait one
collection period.

**Why are there no build metrics?**

The build families (`jenkins_runs_*`, `default_jenkins_builds_*`) need at
least one job that has run. A controller with no executed builds shows the
executor, queue, and node families but no build results. Run a job to
populate them.

**Should I keep both `vm_*` and `jvm_*`?**

No. `vm_*` is the Dropwizard JVM instrumentation (with the large per-pool
`vm_memory_*` family) and `jvm_*` is the Prometheus client's own JVM export -
two parallel exports of the same data. Keep one in production; the keep
filter in the config drops both, so add back the one you want.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [ArgoCD Monitoring](../../guides/cicd-observability/argocd.md) -
  GitOps delivery alongside your CI controller.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Jenkins metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [ArgoCD](../../guides/cicd-observability/argocd.md) and other CI/CD
  components.
- **Fine-tune Collection**: The `jenkins_.*|default_jenkins_.*|up` keep
  filter scopes collection to the Jenkins families; remove it to keep the
  full JVM detail (`vm_*` / `jvm_*`).
