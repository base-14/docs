---
date: 2026-09-02
id: collecting-gcp-cloud-run-telemetry
title: Google Cloud Run Monitoring with OpenTelemetry - Traces, Metrics & Logs
sidebar_label: Cloud Run
sidebar_position: 9
description: >
  Send Cloud Run application traces, metrics and logs to base14 Scout
  with an OpenTelemetry Collector sidecar, and collect the platform
  metrics only Cloud Monitoring exposes.
keywords:
  - cloud run monitoring opentelemetry
  - cloud run otel sidecar
  - cloud run tracing scout
  - run googleapis metrics
  - cloud run cold start monitoring
  - cloud run instance count metrics
  - gcp serverless observability
  - cloud run otlp collector
---

Cloud Run is the one GCP surface in these guides where your own code
runs, so it is the one that can emit real distributed traces. This guide
leads with a collector sidecar for application telemetry, then adds the
platform metrics — instance count, cold starts, billable time — that
your application cannot see about itself.

Read [GCP Monitoring overview](./overview.md) first — it covers the
collector image, IAM, and resource attributes this guide assumes.

:::note Running this in production

Storing and querying this telemetry at production volume is what base14
Scout does. [Check out Scout Metrics](https://base14.io/scout/metrics).

:::

## Overview

The two pipelines answer different questions:

| Source | Signals | Answers |
|---|---|---|
| **Collector sidecar** | Traces, application metrics, logs | What is my code doing, and why is this request slow? |
| **Cloud Monitoring** | Platform metrics | How many instances am I running, how often am I cold-starting, what does this cost? |

Run both. The sidecar cannot see instance counts or billable time; Cloud
Monitoring cannot see a span.

```text
┌───────────────── Cloud Run service ─────────────────┐
│                                                     │
│  ┌─────────────┐  OTLP    ┌──────────────────────┐  │
│  │ Your app    │─────────▶│ Collector sidecar    │──┼──▶ Scout
│  │ (OTel SDK)  │ :4317    │ (contrib image)      │  │
│  └─────────────┘          └──────────────────────┘  │
│         │ stdout                                    │
└─────────┼───────────────────────────────────────────┘
          ▼
    Cloud Logging ─── sink ──▶ Pub/Sub ──▶ collector ──▶ Scout
          ▲
    Cloud Monitoring ◀── polled by googlecloudmonitoring ──▶ Scout
```

---

## The collector sidecar

Cloud Run supports multiple containers per service. Run the collector
alongside your application, listening on localhost, and point your OTel
SDK at it.

### Collector configuration

```yaml showLineNumbers title="cloud-run-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  resourcedetection/gcp:
    detectors: [env, gcp]
    timeout: 5s
    override: false

  resource/cloudrun:
    attributes:
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_cloud_run, action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  memory_limiter:
    limit_mib: 128
    spike_limit_mib: 32
    check_interval: 1s

  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    retry_on_failure:
      enabled: true
      initial_interval: 2s
      max_interval: 10s
      max_elapsed_time: 30s

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, resourcedetection/gcp, resource/cloudrun, batch]
      exporters: [otlphttp/base14]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, resourcedetection/gcp, resource/cloudrun, batch]
      exporters: [otlphttp/base14]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resourcedetection/gcp, resource/cloudrun, batch]
      exporters: [otlphttp/base14]
```

`resourcedetection` with the `gcp` detector fills in `cloud.region`,
`cloud.account.id`, `faas.name` (your service name), `faas.version` (the
revision) and `faas.instance` automatically. Leave `service.name` to your
application's SDK — unlike the pull-based GCP guides, Cloud Run
telemetry has a real service behind it.

:::warning faas.id was renamed

Contrib collector v0.147 removed the `removeGCPFaasID` feature gate,
making `faas.instance` the only name for the Cloud Run instance
identifier. Dashboards or queries written against `faas.id` on an older
collector will stop matching after you upgrade.

:::

### Service definition

```yaml showLineNumbers title="service.yaml"
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: my-service
  annotations:
    run.googleapis.com/launch-stage: BETA
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/container-dependencies: '{"app":["collector"]}'
        run.googleapis.com/cpu-throttling: "false"
    spec:
      containers:
        - name: app
          image: gcr.io/PROJECT_ID/my-app
          ports:
            - containerPort: 8080
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://localhost:4317
            - name: OTEL_SERVICE_NAME
              value: my-service
        - name: collector
          image: otel/opentelemetry-collector-contrib
          startupProbe:
            tcpSocket:
              port: 4317
            failureThreshold: 10
            periodSeconds: 2
```

Two annotations do most of the work here.

`container-dependencies` makes the application container wait for the
collector, so early spans are not dropped into a closed socket during
startup.

:::warning CPU throttling drops telemetry

Cloud Run throttles a container's CPU to near zero between requests
unless CPU is always allocated. A sidecar collector batches on a timer,
so with throttling on, its export runs only when a request happens to be
in flight — and telemetry buffered when the instance scales to zero is
lost outright.

Set `run.googleapis.com/cpu-throttling: "false"` as above, which bills
for the instance's whole lifetime rather than only during requests. If
that cost is unacceptable, lower the batch `timeout` to a second or two
and accept that some telemetry from the last request before scale-down
will not arrive.

:::

Keep the collector's `memory_limiter` low. It shares the service's
memory allocation with your application, and a sidecar that grows will
push the application into an out-of-memory restart.

---

## Platform metrics

The sidecar sees requests your code handled. It cannot see how many
instances exist, how often Cloud Run cold-started one, or what any of it
costs. Those come from Cloud Monitoring.

```yaml showLineNumbers title="cloud-run-platform-config.yaml"
receivers:
  # ...on your central collector, not the sidecar...
  googlecloudmonitoring/cloudrun:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      - metric_name: "run.googleapis.com/request_count"
      - metric_name: "run.googleapis.com/container/instance_count"
      - metric_name: "run.googleapis.com/container/billable_instance_time"
      - metric_name: "run.googleapis.com/container/cpu/utilizations"
      - metric_name: "run.googleapis.com/container/memory/utilizations"
      - metric_name: "run.googleapis.com/container/network/received_bytes_count"
      - metric_name: "run.googleapis.com/container/network/sent_bytes_count"

processors:
  resource/cloudrun_platform:
    attributes:
      - {key: service.name, value: cloudrun-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_cloud_run, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

service:
  pipelines:
    metrics/cloudrun:
      receivers: [googlecloudmonitoring/cloudrun]
      processors: [memory_limiter, resource/cloudrun_platform, batch]
      exporters: [otlphttp/base14]
```

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

Run the platform-metrics receiver on your central collector rather than
the sidecar. A sidecar
polls once per instance, so an autoscaled service would poll the
Monitoring API dozens of times over and produce duplicate series.

:::warning This config needs collector v0.129.0 or later

`container/cpu/utilizations` and `container/memory/utilizations` are
`DELTA` + `DISTRIBUTION`, as are `request_latencies`,
`container/startup_latencies` and `container/max_request_concurrencies`.
Distributions need collector v0.129.0 or later; on an older build they
fail the entire scrape batch and take `request_count` and
`instance_count` down with them.

The two `utilizations` metrics are in the list above because saturation
is worth the version dependency. Add `request_latencies` and
`container/startup_latencies` alongside them — both are listed in
[What you'll monitor](#what-youll-monitor) and both are hard to operate
Cloud Run without. If you are stuck on an older collector, remove every
distribution and you are left with `request_count`,
`container/instance_count`, `container/billable_instance_time` and the
network counters.

:::

### Jobs

Cloud Run jobs use the `cloud_run_job` resource and a different metric
family:

```yaml showLineNumbers title="cloud-run-platform-config.yaml"
    metrics_list:
      - metric_name: "run.googleapis.com/job/completed_execution_count"
      - metric_name: "run.googleapis.com/job/completed_task_attempt_count"
      - metric_name: "run.googleapis.com/job/running_executions"
```

---

## What you'll monitor

| Metric | Kind | Unit | Use case |
|---|---|---|---|
| `request_count` | **Delta** sum | count | Request rate by `response_code_class`. Includes requests your app never saw — 429s from concurrency limits, 503s during scale-up. |
| `request_latencies` | **Delta** histogram | ms | Includes queue time before your handler ran, which your own spans do not. |
| `container/instance_count` | Gauge | count | Labelled by `state` (`active`, `idle`). The scaling picture. |
| `container/billable_instance_time` | **Delta** sum | seconds | What you actually pay for. Rises sharply when CPU throttling is disabled. |
| `container/startup_latencies` | **Delta** histogram | ms | Cold start duration. The metric to watch when p99 latency has a long tail nothing in your code explains. |
| `container/cpu/utilizations` | **Delta** histogram | ratio | CPU against the allocation, distributed across instances. |
| `container/memory/utilizations` | **Delta** histogram | ratio | Memory against the allocation. Approaching 1.0 means restarts are coming. |
| `container/max_request_concurrencies` | **Delta** histogram | count | Concurrency against the configured limit; where 429s come from. |
| `container/network/sent_bytes_count` | **Delta** sum | bytes | Egress volume and cost. |

:::tip Two latency numbers that should disagree

`request_latencies` measures from when Cloud Run received the request;
your application spans measure from when the handler started. The gap is
queue time and cold start. If platform latency looks bad while your
traces look fine, you have a scaling problem, not a code problem — and
`startup_latencies` alongside `instance_count` will confirm it.

:::

---

## Cardinality control

| Attribute | Source | Cardinality | Keep? |
|---|---|---|---|
| `service_name` | Resource label | One per service | Yes |
| `revision_name` | Resource label | **One per deployment** | Usually not |
| `location` | Resource label | Small | Yes |
| `state` | Metric label on `instance_count` | 2 | Yes |
| `response_code` | Metric label | Tens | Yes |

`revision_name` is the one to watch. Cloud Run creates a new revision on every
deploy, so a service deployed twenty times a week accumulates a thousand
revision values a year — each one a distinct series that keeps its
history forever while never receiving another point.

Drop it unless you actively compare revisions:

```yaml showLineNumbers title="cloud-run-platform-config.yaml"
processors:
  transform/cloudrun:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - delete_key(attributes, "revision_name")
```

For the sidecar pipeline, `faas.version` carries the same risk. It is
more defensible there — knowing which revision a trace came from is
genuinely useful during a rollout — but it is a resource attribute on
every span, so weigh it against your trace volume.

---

## Alert tuning

| Signal | Source metric | Warning | Critical | Notes |
|---|---|---|---|---|
| Error rate | `request_count` where `response_code_class = 500` | > 1% for 5m | > 5% for 5m | Includes platform 503s during scale-up, not only your errors. |
| Concurrency rejection | `request_count` where `response_code = 429` | any sustained | > 1% | Raise concurrency or maximum instances. |
| Cold start latency | `container/startup_latencies` p95 | > 5s | > 15s | Consider minimum instances if this is user-facing. |
| Memory pressure | `container/memory/utilizations` p95 | > 0.8 | > 0.95 | Cloud Run kills the instance at the limit with no graceful shutdown. |
| Scaling ceiling | `container/instance_count` where `state = active` | approaching maximum | at maximum | Traffic is being queued or rejected above this. |
| Cost anomaly | `container/billable_instance_time` | 2x baseline | 5x baseline | Disabling CPU throttling moves this permanently; alert on the new baseline. |

---

## Logs

Anything your container writes to stdout or stderr goes to Cloud Logging
under `resource.type="cloud_run_revision"`. You have two ways to get it
into Scout, and they are mutually exclusive in practice:

**Through the sidecar.** Emit logs via the OTel SDK to the collector's
OTLP endpoint. They arrive already correlated with trace and span ids,
and never touch Cloud Logging. This is the better path when your
application controls its own logging.

**Through Cloud Logging.** Route
`resource.type="cloud_run_revision"` through a Log Router sink into
Pub/Sub, as in
[GCP Cloud Logging](./gcp-cloud-logging-to-scout.md):

```bash showLineNumbers
gcloud logging sinks create scout-cloudrun-logs \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="cloud_run_revision"'
```

This path also captures Cloud Run's own request logs and platform
messages, which the sidecar never sees, and works for containers you did
not write. The encoding extension maps the `httpRequest` block to HTTP
semantic conventions and preserves trace ids Cloud Run injected.

---

## Verify

1. **The sidecar started before the app.** Check the Cloud Run revision
   logs for the collector container reporting
   `Everything is ready. Begin running and processing data.`

2. **Traces reach Scout.** Send a request and confirm a trace appears
   with `cloud.platform = gcp_cloud_run` and a populated `faas.name`.

3. **Platform metrics landed:**

   ```sql showLineNumbers
   SELECT MetricName, count() AS points, max(Value) AS latest
   FROM otel_metrics_gauge
   WHERE ServiceName = 'cloudrun-metrics'
     AND MetricName = 'run.googleapis.com/container/instance_count'
     AND TimeUnix >= now() - INTERVAL 1 HOUR
   GROUP BY MetricName
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

4. **Scale to zero and back.** Leave the service idle past its scale-down
   window, send a request, and confirm the spans from that request
   arrive. This is the test that catches CPU-throttling telemetry loss.

---

## Troubleshooting

**Traces from the first requests after a deploy are missing.**
The application started before the collector. Add the
`run.googleapis.com/container-dependencies` annotation.

**Telemetry stops arriving when traffic is low.**
CPU throttling. With `cpu-throttling: "true"` the sidecar gets almost no
CPU between requests, so its batch timer never fires. Set it to `"false"`
or shorten the batch timeout.

**The service restarts under load with no application error.**
The sidecar's memory is counted against the service's allocation. Lower
the collector's `memory_limiter`, or raise the service memory.

**`faas.id` disappeared from spans after upgrading the collector.**
It was renamed to `faas.instance` when contrib v0.147 removed the
`removeGCPFaasID` feature gate.

**Platform metrics are duplicated.**
The `googlecloudmonitoring` receiver is running in the sidecar, so every
instance polls independently. Move it to a central collector.

**Platform request counts exceed what your traces show.**
Correct, and useful. Cloud Run counts requests it rejected — 429s at the
concurrency limit, 503s during scale-up — that never reached your
handler.

## FAQ

### How do I send Cloud Run traces to base14 Scout?

Run an OpenTelemetry Collector as a sidecar container listening on
`localhost:4317`, point your application's SDK at it, and export to
Scout over OTLP. Use the `container-dependencies` annotation so the app
waits for the collector at startup.

### Why does my Cloud Run telemetry stop when traffic is idle?

Cloud Run throttles container CPU between requests, so the sidecar's
batch timer does not fire. Set
`run.googleapis.com/cpu-throttling: "false"`, or shorten the collector's
batch timeout and accept losing the last batch before scale-down.

### Do I need both the sidecar and Cloud Monitoring?

You need both for a complete picture. The sidecar gives you traces and
application metrics; Cloud Monitoring gives you instance counts, cold
start latency and billable time, none of which your application can
observe about itself.

### Why is Cloud Run latency higher than my application spans show?

`request_latencies` starts when Cloud Run receives the request, so it
includes queue time and cold start. Your spans start when the handler
runs. The gap is the platform, and `container/startup_latencies`
confirms whether cold starts explain it.

### How do I avoid a cardinality explosion from Cloud Run revisions?

Drop the `revision_name` attribute with a `transform` processor. Every
deploy creates a new revision, so the label grows without bound and each
value keeps its history after it stops receiving points.

### Should Cloud Run logs go through the sidecar or Cloud Logging?

Send them through the sidecar if your application controls its logging,
because they arrive already correlated with trace ids. Use Cloud Logging if you
also want Cloud Run's own request logs and platform messages, or if you
did not write the container.

## Reference

- [Cloud Run monitoring](https://docs.cloud.google.com/run/docs/monitoring)
- [Cloud Run sidecar containers](https://docs.cloud.google.com/run/docs/deploying#sidecars)
- [OTel Collector sidecar on Cloud Run](https://docs.cloud.google.com/stackdriver/docs/instrumentation/opentelemetry-collector-cloud-run)
- [Cloud Run CPU allocation](https://docs.cloud.google.com/run/docs/configuring/cpu-allocation)

## Related Guides

- [GCP Monitoring overview](./overview.md) - the platform-metrics half
  of this page in its general form, across every GCP surface.
- [Pub/Sub](./pub-sub.md) - where push subscriptions terminate, and the
  trace-context caveat that affects them.
- [Cloud Load Balancing](./load-balancing.md) - the hop in front of a
  Cloud Run service exposed to the internet.
- [Cloud SQL](./cloud-sql.md) - the database most Cloud Run services
  talk to.
