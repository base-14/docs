---
title: >
  Apache Camel OpenTelemetry Monitoring - Exchange Throughput, Failure
  Rate, and Collector Setup
sidebar_label: Apache Camel
id: collecting-camel-telemetry
sidebar_position: 52
description: >
  Collect Apache Camel metrics with the OpenTelemetry JMX Scraper. Monitor
  exchange throughput, failures, backlog, and thread-pool health with base14
  Scout.
keywords:
  - apache camel opentelemetry
  - camel otel collector
  - camel metrics monitoring
  - camel jmx monitoring
  - opentelemetry jmx scraper camel
  - camel observability
  - camel performance monitoring
  - camel telemetry collection
---

# Apache Camel

The OpenTelemetry JMX Scraper reads Apache Camel's `org.apache.camel:*`
JMX MBeans and emits 49 Camel metrics plus 19 metrics from the JVM the
routes run on (68 total) on Camel 4.10+ - exchange throughput, failure and
redelivery counts, in-flight backlog, processing latency, and thread-pool
saturation. Camel exposes no Prometheus or OTLP endpoint of its own; the
scraper bridges JMX to OTLP and pushes to the Collector over gRPC. This
guide configures the scraper and Collector and ships metrics to base14
Scout.

## Prerequisites

| Requirement            | Minimum       | Recommended   |
| ---------------------- | ------------- | ------------- |
| Apache Camel           | 4.10          | 4.10          |
| OTel JMX Scraper       | 1.55.0-alpha  | 1.57.0-alpha  |
| OTel Collector Contrib | 0.90.0        | 0.153.0       |
| base14 Scout           | Any           | -             |

Before starting:

- Camel must run with `camel-management` on the classpath. It registers
  the `org.apache.camel:*` MBeans the scraper reads in the platform MBean
  server automatically; no extra Camel config is needed for that.
- Remote JMX over RMI must still be enabled and reachable from the host
  running the scraper - the MBeans exist, but the remote connector is
  opened by the JVM JMX flags in [Access Setup](#access-setup) (port 1099
  below), not by `camel-management`.
- The scraper must be **1.55.0-alpha or newer**. The `camel` target
  (`jmx/rules/camel.yaml`) is new in 1.55.0-alpha; an older scraper has no
  rule file for Camel and emits no `camel.*` metrics. This guide is tested on
  1.57.0-alpha.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The `camel.*` set is the same exchange instruments at three granularities:
**context** (whole-integration, one series), **route** (per route), and
**processor** (per processor), plus thread-pool counters. The headline
tiers below use the context-level series; the per-route and per-processor
equivalents are the Diagnostic drill-down. Route and processor series only
appear once at least one route or processor exists, and thread-pool series
only once Camel has created a managed pool.

### Core - is it up and doing work

| Metric | What it tells you |
|---|---|
| `camel.context.exchange.count` | Total exchanges processed by the CamelContext - the integration throughput KPI. JMX exposes no `up` metric, so a rising count is the liveness signal that the routes are alive and working. |
| `jvm.memory.used` | JVM memory in use - the process-alive and heap-health anchor for the JVM the routes run on. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `camel.context.exchange.failed.count` | Exchanges that failed - the error-rate signal. |
| `camel.context.exchange.failed.handled` | Failures absorbed by an error handler or dead-letter route. |
| `camel.context.exchange.inflight` | Exchanges currently in flight - backpressure / stuck-route signal. |
| `camel.context.exchange.processing.duration.mean` | Mean exchange processing time. |
| `camel.context.exchange.processing.duration.max` | Longest exchange processing time - tail latency. |
| `camel.context.exchange.redelivered.count` | Exchanges redelivered - retry pressure / instability. |
| `camel.threadpool.task.queue.size` | Tasks queued on a Camel thread pool - saturation backlog. |
| `camel.threadpool.thread.count` | Threads currently in a Camel thread pool. |
| `camel.threadpool.thread.limit.upper` | Thread-pool max size - the saturation denominator. |
| `jvm.memory.limit` | JVM memory ceiling - the saturation denominator against `jvm.memory.used`. |
| `jvm.cpu.recent_utilization` | Recent process CPU utilization. |
| `jvm.thread.count` | Total live JVM threads - a leak signal. |

### Diagnostic - for investigation and tuning

Higher cardinality - the route and processor families emit one series per
route and per processor. Reach for these during an investigation, not as
signals you page on. In production you can drop this tier with a `filter`
processor and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| CamelContext detail | `camel.context.exchange.completed`, `camel.context.exchange.redelivered.external`, `camel.context.exchange.processing.duration.{last,last_delta,min,sum}`, `camel.context.route.added`, `camel.context.route.started` | Context-level completion, external redelivery, and route lifecycle. |
| Per-route exchanges | `camel.route.exchange.*` (13 instruments, one series per route): `completed`, `count`, `failed.count`, `failed.handled`, `inflight`, `redelivered.count`, `redelivered.external`, `processing.duration.{last,last_delta,max,mean,min,sum}` | Pin failures, backlog, or latency to a specific route. |
| Per-processor exchanges | `camel.processor.exchange.*` (13 instruments, one series per processor): same shape as per-route | Find the hot processor inside a slow route. |
| Thread-pool detail | `camel.threadpool.task.active`, `camel.threadpool.task.completed`, `camel.threadpool.task.count`, `camel.threadpool.thread.limit.lower`, `camel.threadpool.thread.max` | Pool task accounting and configured bounds. |
| JVM memory detail | `jvm.memory.committed`, `jvm.memory.init`, `jvm.memory.used_after_last_gc` | Heap sizing and post-GC live set. |
| JVM class loading | `jvm.class.count`, `jvm.class.loaded`, `jvm.class.unloaded` | Class-loader leaks. |
| JVM CPU / system | `jvm.cpu.count`, `jvm.cpu.time`, `jvm.system.cpu.load_1m`, `jvm.system.cpu.utilization` | Host-level CPU pressure on the JVM. |
| JVM buffers / descriptors | `jvm.buffer.count`, `jvm.buffer.memory.limit`, `jvm.buffer.memory.used`, `jvm.file_descriptor.count`, `jvm.file_descriptor.limit` | NIO buffer and file-descriptor exhaustion. |

Attributes: `camel.context.*` carry `camel.context` (context name);
`camel.route.*` carry `camel.route` and `camel.destination`;
`camel.processor.*` carry `camel.processor`; `camel.threadpool.*` carry
`camel.threadpool.name`; `jvm.memory.*` carry `jvm.memory.type` (heap /
non_heap) and pool name.

Full metric reference: the scraper's
[`jmx/rules/camel.yaml`](https://github.com/open-telemetry/opentelemetry-java-contrib/blob/main/jmx-scraper/src/main/resources/jmx/rules/camel.yaml)
defines the `camel.*` metric names.

## Key Alerts to Configure

Threshold guidance for the most useful Operational series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `rate(camel.context.exchange.failed.count)` vs `rate(camel.context.exchange.count)` | Failure rate climbing | Sustained climb | Route or endpoint errors; drill into `camel.route.exchange.failed.count` to find the failing route. |
| `camel.context.exchange.inflight` | Rising | Rising and not draining | A route is stuck or a downstream endpoint is slow; check the slowest route's processing duration. |
| `camel.context.exchange.processing.duration.mean` / `.max` | Rising vs baseline | Sustained rise | Slow processing; inspect per-processor `processing.duration.max` for the hot processor. |
| `rate(camel.context.exchange.redelivered.count)` | Climbing | Sustained climb | Transient endpoint failures forcing retries; check the failing endpoint and back-off config. |
| `camel.threadpool.task.queue.size` | Growing | `thread.count` at `thread.limit.upper` | Pool can't keep up; raise pool size or shed load. |
| `jvm.memory.used` vs `jvm.memory.limit` | Approaching limit | Near limit with GC churn | GC churn / OOM risk; raise heap or reduce in-flight batch sizes. |

## Access Setup

Camel does not expose Prometheus or OTLP metrics natively. Enable remote
JMX on the Camel application and point the OpenTelemetry JMX Scraper at it.

**Enable Camel JMX management** - add `camel-management` to the
application's dependencies. It registers the `org.apache.camel:*` MBeans
and enables JMX by default. With Maven:

```xml showLineNumbers title="pom.xml (excerpt)"
<dependency>
  <groupId>org.apache.camel</groupId>
  <artifactId>camel-management</artifactId>
</dependency>
```

**Expose remote JMX over RMI** - start the JVM with the standard JMX
remote properties so the scraper can connect. The example below opens port
1099 with no auth and no TLS; production should front JMX with
authentication and TLS, or tunnel it over a private network:

```bash showLineNumbers title="JVM JMX remote flags"
java \
  -Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.port=1099 \
  -Dcom.sun.management.jmxremote.rmi.port=1099 \
  -Dcom.sun.management.jmxremote.local.only=false \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Djava.rmi.server.hostname=camel-app \
  -jar your-camel-app.jar
```

**Run the JMX Scraper** - the scraper connects over JMX RMI and pushes
OTLP/gRPC to the Collector. It must be `1.55.0-alpha` or newer for the
`camel` target (this guide pins `1.57.0-alpha`). In Docker, build a small
image around the scraper jar:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM eclipse-temurin:17-jre

ARG SCRAPER_VERSION=1.57.0-alpha
ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar

ENTRYPOINT ["java", "-jar", "/opt/scraper.jar"]
```

Wire the scraper to Camel and the Collector through environment variables:

```yaml showLineNumbers title="docker-compose.yaml (scraper service)"
services:
  jmx-scraper:
    build: ./jmx-scraper
    environment:
      OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://camel-app:1099/jmxrmi
      OTEL_JMX_TARGET_SYSTEM: jvm,camel        # both JVM and Camel MBeans
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: 10000       # milliseconds
    depends_on:
      camel-app:
        condition: service_healthy
```

`OTEL_JMX_TARGET_SYSTEM: jvm,camel` is what selects both the JVM rules and
the Camel rule set; drop `camel` and you get JVM metrics only. No special
JMX role is needed for read - the scraper only reads management MBeans.

## Configuration

The scraper sends OTLP to the Collector, which forwards to Scout. A
minimal Collector pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317   # The scraper pushes OTLP/gRPC here

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
      insecure_skip_verify: true        # Set to false with TLS in production

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic-tier per-route
and per-processor series with a `filter` processor while keeping Core and
Operational. The per-route and per-processor families are the high-
cardinality cost - one series each:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
processors:
  filter/diagnostic:
    metrics:
      exclude:
        match_type: regexp
        metric_names:
          - camel\.route\..*
          - camel\.processor\..*
```

Add `filter/diagnostic` to the `processors` list in the metrics pipeline.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

## Verify the Setup

Start the Collector and scraper, then confirm metrics flow within 60
seconds:

```bash showLineNumbers
# Check Collector logs for scraped Camel metrics (requires a debug exporter)
docker logs otel-collector 2>&1 | grep -i "camel"

# Confirm the scraper connected to JMX (no rule-file or connection errors)
docker logs jmx-scraper 2>&1 | tail -20
```

The Collector log check needs a `debug` exporter in the pipeline; the
production config above ships only `otlphttp/b14`, so confirm delivery in
Scout instead, or add `debug` to the metrics pipeline while testing.

`camel.context.exchange.count` and `jvm.memory.used` emit as soon as the
scraper connects and the CamelContext is up. The `camel.route.*` and
`camel.processor.*` series appear once at least one route and processor
exist, and `camel.threadpool.*` once Camel has created a managed pool.

## Troubleshooting

### No `camel.*` metrics, only `jvm.*`

**Cause**: The scraper is older than `1.55.0-alpha`, or `camel` is not in
the target system. The `camel` rule file (`jmx/rules/camel.yaml`) is new
in 1.55.0-alpha, so an older scraper has nothing to map Camel MBeans to.

**Fix**:

1. Pin the scraper to `1.55.0-alpha` or newer.
2. Set `OTEL_JMX_TARGET_SYSTEM` to `jvm,camel` - omitting `camel` yields
   JVM metrics only.
3. Confirm `camel-management` is on the application classpath so the
   `org.apache.camel:*` MBeans exist for the scraper to read.

### Scraper cannot connect to JMX

**Cause**: Remote JMX is not exposed, or the RMI hostname does not resolve
from the scraper.

**Fix**:

1. Verify the JVM was started with the JMX remote flags and is listening
   on port 1099.
2. Set `-Djava.rmi.server.hostname` to a name the scraper can resolve (the
   Camel container's hostname in Docker).
3. Confirm `OTEL_JMX_SERVICE_URL` points at the same host and port.

### Route, processor, or thread-pool metrics missing

**Cause**: The underlying MBean does not exist yet. Route and processor
series only appear once a route or processor exists; thread-pool series
only once Camel has created a managed pool.

**Look at**: `camel.context.route.added` and `camel.context.route.started`.
If routes have not started, the per-route and per-processor families
cannot emit. The `seda`-style consumer pools populate
`camel.threadpool.*`; a context with no managed pool reports none.

**Fix**:

1. Confirm the routes are started (check `camel.context.route.started`).
2. Drive traffic through the routes so the processor and thread-pool
   MBeans register.

### In-flight backlog or latency climbing

**Cause**: A route is stuck, a downstream endpoint is slow, or the thread
pool is saturated.

**Look at**: the Diagnostic per-route series -
`camel.route.exchange.inflight` to find the stuck route, and the per-
processor `camel.processor.exchange.processing.duration.max` to find the
hot processor inside it. Check `camel.threadpool.task.queue.size` against
`camel.threadpool.thread.limit.upper` for pool saturation.

**Fix**:

1. Raise the thread-pool size or shed load if the queue is sustained.
2. Investigate the slow endpoint and tune redelivery / back-off if
   `camel.route.exchange.redelivered.count` is climbing on that route.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `otlp` receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Why do I need the JMX Scraper instead of a Camel receiver?**

There is no native Camel receiver and Camel exposes no Prometheus or OTLP
endpoint. Camel publishes its statistics as `org.apache.camel:*` JMX
MBeans (via `camel-management`). The OpenTelemetry JMX Scraper reads those
MBeans and translates them to OTLP, which it pushes to the Collector.

**Does this work with Apache Camel in Kubernetes?**

Yes. Run the scraper as a sidecar in the same pod as the Camel
application, with `OTEL_JMX_SERVICE_URL` pointing at `localhost:1099` (or
the pod's JMX RMI port), and send OTLP to your Collector service. Front
JMX with authentication on a shared network.

**Why are there context, route, and processor versions of the same
metric?**

They are the same exchange instruments at three granularities. The
`camel.context.*` series is the whole-integration roll-up (one series),
`camel.route.*` is per route, and `camel.processor.*` is per processor.
Alert on the context series and drill into route then processor to
localize a failure or latency regression.

**Why is per-request latency not a single number?**

Camel reports processing duration as aggregates - mean, max, min, sum, and
last - on the exchange MBeans, not a histogram. Use
`camel.context.exchange.processing.duration.mean` and `.max` for the
integration, and the per-route / per-processor equivalents to find where
the time goes. Span-level timing for individual exchanges lives in your
trace path, not in these metrics.

**Which scraper version do I need?**

`1.55.0-alpha` or newer. That release introduced the `camel` target
(`jmx/rules/camel.yaml`); earlier scrapers have no Camel rule set and emit
no `camel.*` metrics even when connected to the same MBeans. This guide is
tested on `1.57.0-alpha`.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Camel metrics.
- [Kafka Monitoring](./kafka.md) - A common companion message broker for
  Camel integration routes.
- [RabbitMQ Monitoring](./rabbitmq.md) - Another broker frequently fronted
  by Camel routes.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md), [RabbitMQ](./rabbitmq.md), and other components
  Camel routes talk to.
- **Fine-tune Collection**: Drop the Diagnostic per-route and per-processor
  tier in production with a `filter` processor to control volume; keep it
  available for incident investigation.
