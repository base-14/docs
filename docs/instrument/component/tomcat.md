---
title: >
  Tomcat OpenTelemetry Monitoring - Request Rates, Thread Pools,
  and Collector Setup
sidebar_label: Tomcat
id: collecting-tomcat-telemetry
sidebar_position: 33
description: >
  Collect Apache Tomcat metrics with the OpenTelemetry JMX Scraper. Monitor
  request throughput, thread-pool saturation, and JVM heap, then ship to
  base14 Scout.
keywords:
  - tomcat opentelemetry
  - tomcat otel collector
  - tomcat metrics monitoring
  - tomcat performance monitoring
  - opentelemetry jmx scraper tomcat
  - tomcat observability
  - tomcat jmx monitoring
  - tomcat telemetry collection
---

# Tomcat

The OpenTelemetry JMX Scraper connects to Apache Tomcat 8.5+ over JMX
RMI and collects 8 Tomcat-specific metrics and 19 JVM metrics - request
throughput, error counts, request latency, connector thread-pool
saturation, network I/O, and JVM heap / CPU / thread health - then pushes
them over OTLP to the Collector. Tomcat exposes its Catalina MBeans (`GlobalRequestProcessor`,
`ThreadPool`) and JVM MBeans over JMX with no Prometheus or OpenTelemetry
endpoint of its own, so the scraper translates the MBeans into OTel
metrics. This guide enables JMX on Tomcat, configures the scraper and
Collector, and ships metrics to base14 Scout.

## Prerequisites

| Requirement    | Minimum | Recommended |
| -------------- | ------- | ----------- |
| Apache Tomcat  | 8.5     | 11.0+       |
| JMX Scraper    | 1.46.0  | 1.54.0+     |
| Java (scraper) | 11      | 17+         |
| OTel Collector | 0.90.0  | latest      |
| base14 Scout   | Any     | -           |

Before starting:

- Tomcat must be reachable over JMX from the host running the scraper
  (JMX port, default 9010).
- The JMX Scraper runs as a standalone Java process and needs its own
  JRE.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review. The `tomcat.*` connector metrics carry a
`tomcat.request.processor.name` attribute (for example `http-nio-8080`);
the `jvm.memory.*` metrics carry `jvm.memory.type` (heap / non_heap) and
the pool name.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `tomcat.request.count` | Requests handled by the connector - the throughput KPI. |
| `jvm.memory.used` | JVM memory in use. JMX exposes no `up` metric, so heap-in-use doubles as the process-alive and heap-health anchor. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `tomcat.error.count` | Request errors at the connector - the error-rate signal. |
| `tomcat.request.duration.sum` | Cumulative request-processing time; divide by request count for mean latency. |
| `tomcat.request.duration.max` | Longest request-processing time - tail latency. |
| `tomcat.thread.busy.count` | Connector threads actively handling requests. |
| `tomcat.thread.count` | Connector threads currently in the pool. |
| `tomcat.thread.limit` | Connector thread-pool ceiling - the saturation denominator. |
| `tomcat.network.io` | Connector bytes sent and received. |
| `jvm.memory.limit` | JVM memory ceiling - the saturation denominator against `jvm.memory.used`. |
| `jvm.cpu.recent_utilization` | Recent process CPU utilization. |
| `jvm.thread.count` | Total live JVM threads - a leak signal. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. In production you can drop this tier with a `filter` processor
and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| JVM memory detail | `jvm.memory.committed`, `jvm.memory.init`, `jvm.memory.used_after_last_gc` | Heap sizing and post-GC live-set; GC churn analysis. |
| Class loading | `jvm.class.count`, `jvm.class.loaded`, `jvm.class.unloaded` | Classloader leaks and redeploy churn. |
| CPU / system | `jvm.cpu.count`, `jvm.cpu.time`, `jvm.system.cpu.load_1m`, `jvm.system.cpu.utilization` | Host-level CPU pressure vs process CPU. |
| Buffers / descriptors | `jvm.buffer.count`, `jvm.buffer.memory.limit`, `jvm.buffer.memory.used`, `jvm.file_descriptor.count`, `jvm.file_descriptor.limit` | Direct-buffer growth and fd usage against the ceiling. |

Session metrics (`tomcat.session.*`) only appear when a session-bearing
web application is deployed; an empty Tomcat with no contexts emits no
session metrics. See [Troubleshooting](#session-metrics-missing).

Full metric reference:
[OTel JMX Tomcat metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/tomcat.md).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
These are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `rate(tomcat.error.count)` vs `rate(tomcat.request.count)` | Error fraction climbing | Sustained rise | Application or upstream errors; inspect logs and the failing endpoints. |
| `tomcat.thread.busy.count` / `tomcat.thread.limit` | > 0.80 | Approaching 1.0 | Connector running out of worker threads; raise `maxThreads` or shed load. |
| `tomcat.request.duration.sum` / request count (mean), or `tomcat.request.duration.max` | Rising vs baseline | Sustained spike | Slow request handling; check downstream calls and GC. |
| `jvm.memory.used` / `jvm.memory.limit` | > 0.80 | > 0.90 | GC churn and OOM risk; raise heap or reduce allocation. |
| `jvm.cpu.recent_utilization` | Sustained high | Pinned near 1.0 | Process is CPU-bound; scale out or profile the hot paths. |

## Access Setup

Tomcat exposes metrics over JMX (Java Management Extensions). Enable
remote JMX access by adding the flags below to `setenv.sh` (or
`CATALINA_OPTS` in your deployment).

### Enable JMX on Tomcat

```bash showLineNumbers title="bin/setenv.sh"
export CATALINA_OPTS="$CATALINA_OPTS \
  -Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.port=9010 \
  -Dcom.sun.management.jmxremote.rmi.port=9010 \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Djava.rmi.server.hostname=<tomcat-host>"   # Your Tomcat host IP or hostname
```

Setting `rmi.port` equal to `port` keeps RMI from opening a random
second port, which simplifies firewall and Docker networking.

For Docker, pass `CATALINA_OPTS` as an environment variable and set the
container `hostname` so RMI hands back a reachable address:

```yaml showLineNumbers title="docker-compose.yaml (Tomcat service)"
tomcat:
  image: tomcat:11.0.22-jdk17-temurin
  hostname: tomcat
  environment:
    CATALINA_OPTS: >-
      -Dcom.sun.management.jmxremote
      -Dcom.sun.management.jmxremote.port=9010
      -Dcom.sun.management.jmxremote.rmi.port=9010
      -Dcom.sun.management.jmxremote.ssl=false
      -Dcom.sun.management.jmxremote.authenticate=false
      -Djava.rmi.server.hostname=tomcat
```

The flags above run JMX with no auth and no TLS, which is fine inside a
trusted network or pod. Production exposed over an untrusted network
should enable both.

### With Authentication (Production)

```bash showLineNumbers title="bin/setenv.sh (authenticated)"
export CATALINA_OPTS="$CATALINA_OPTS \
  -Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.port=9010 \
  -Dcom.sun.management.jmxremote.rmi.port=9010 \
  -Dcom.sun.management.jmxremote.ssl=true \
  -Dcom.sun.management.jmxremote.authenticate=true \
  -Dcom.sun.management.jmxremote.password.file=/path/to/jmxremote.password \
  -Dcom.sun.management.jmxremote.access.file=/path/to/jmxremote.access \
  -Djava.rmi.server.hostname=<tomcat-host>"
```

The JMX Scraper connects with credentials via the `OTEL_JMX_USERNAME`
and `OTEL_JMX_PASSWORD` environment variables.

## Configuration

Tomcat monitoring uses two components: the JMX Scraper (connects to
Tomcat over JMX RMI, targets the `jvm,tomcat` systems, exports OTLP) and
the OTel Collector (receives OTLP, ships to Scout).

```text
Tomcat (JMX:9010) ← JMX/RMI → JMX Scraper → OTLP/gRPC → OTel Collector → Scout
```

### JMX Scraper

Download the scraper JAR from
[Maven Central](https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/)
and run it:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:9010/jmxrmi \
OTEL_JMX_TARGET_SYSTEM=jvm,tomcat \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -jar opentelemetry-jmx-scraper-1.57.0-alpha.jar
```

Move the JAR to a permanent location:

```bash showLineNumbers title="Install the scraper JAR"
sudo mkdir -p /opt/otel
sudo mv opentelemetry-jmx-scraper-1.57.0-alpha.jar /opt/otel/
```

Run the scraper as a managed systemd service:

```bash showLineNumbers title="/etc/systemd/system/otel-jmx-scraper.service"
sudo tee /etc/systemd/system/otel-jmx-scraper.service > /dev/null <<'EOF'
[Unit]
Description=OpenTelemetry JMX Scraper for Tomcat
After=network.target tomcat.service

[Service]
Type=simple
Environment=OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:9010/jmxrmi
Environment=OTEL_JMX_TARGET_SYSTEM=jvm,tomcat
Environment=OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
Environment=OTEL_METRIC_EXPORT_INTERVAL=10000
ExecStart=/usr/bin/java -jar /opt/otel/opentelemetry-jmx-scraper-1.57.0-alpha.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash showLineNumbers title="Enable the scraper service"
sudo systemctl daemon-reload
sudo systemctl enable --now otel-jmx-scraper
```

For Docker, build a small image with the scraper JAR:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM eclipse-temurin:17-jre

ARG SCRAPER_VERSION=1.57.0-alpha   # Update to match your target version

ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar

ENTRYPOINT ["java", "-jar", "/opt/scraper.jar"]
```

### OTel Collector

The Collector receives metrics from the scraper over OTLP/gRPC:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

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
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

To control metric volume in production, drop the Diagnostic tier with a
`filter` processor on the metrics pipeline while keeping the Core and
Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
# JMX Scraper
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://tomcat:9010/jmxrmi
OTEL_JMX_TARGET_SYSTEM=jvm,tomcat
OTEL_METRIC_EXPORT_INTERVAL=10000
# OTEL_JMX_USERNAME=monitor          # Uncomment for authenticated JMX
# OTEL_JMX_PASSWORD=your_password    # Uncomment for authenticated JMX

# OTel Collector
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Docker Compose

Full working example with all three components:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  tomcat:
    image: tomcat:11.0.22-jdk17-temurin
    hostname: tomcat
    container_name: tomcat
    ports:
      - "8080:8080"
      - "9010:9010"
    environment:
      CATALINA_OPTS: >-
        -Dcom.sun.management.jmxremote
        -Dcom.sun.management.jmxremote.port=9010
        -Dcom.sun.management.jmxremote.rmi.port=9010
        -Dcom.sun.management.jmxremote.ssl=false
        -Dcom.sun.management.jmxremote.authenticate=false
        -Djava.rmi.server.hostname=tomcat
    healthcheck:
      test: ["CMD-SHELL", "curl -so /dev/null http://localhost:8080/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  jmx-scraper:
    build: ./jmx-scraper
    container_name: jmx-scraper
    environment:
      OTEL_JMX_SERVICE_URL: ${OTEL_JMX_SERVICE_URL}
      OTEL_JMX_TARGET_SYSTEM: ${OTEL_JMX_TARGET_SYSTEM}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: ${OTEL_METRIC_EXPORT_INTERVAL}
    depends_on:
      tomcat:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - tomcat
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check the JMX Scraper logs for a successful JMX connection
docker logs jmx-scraper 2>&1 | head -10

# Confirm Tomcat started with JMX enabled
docker logs tomcat 2>&1 | grep "jmxremote"

# Check Collector logs for Tomcat metrics
docker logs otel-collector 2>&1 | grep -i "tomcat"

# Drive traffic so the request / error / duration counters advance
curl -s http://localhost:8080/ > /dev/null
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach Tomcat's JMX port.

**Fix**:

1. Verify Tomcat is running: `docker ps | grep tomcat`.
2. Confirm JMX is enabled - look for `-Dcom.sun.management.jmxremote` in
   Tomcat's startup args: `ps aux | grep jmxremote`.
3. Verify the JMX port matches between Tomcat's config and the scraper's
   `OTEL_JMX_SERVICE_URL`.
4. In Docker, ensure `hostname` is set on the Tomcat container and
   matches `-Djava.rmi.server.hostname`.

### Only JVM metrics, no Tomcat metrics

**Cause**: `OTEL_JMX_TARGET_SYSTEM` does not include `tomcat`.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,tomcat` (both targets,
   comma-separated).
2. Verify Tomcat has fully started - the Catalina MBeans
   (`GlobalRequestProcessor`, `ThreadPool`) are only registered after
   Catalina initializes.

### Session metrics missing

**Cause**: Session metrics only appear when at least one session-bearing
web application is deployed. The session MBeans are per-context
(`Catalina:type=Manager,host=localhost,context=/myapp`), so an empty
Tomcat with no contexts emits none.

**Fix**:

1. Deploy a web application to Tomcat - empty instances with no contexts
   do not emit session metrics.
2. Confirm requests are actually creating sessions in your app.

### Requests are slow or threads are piling up

**Cause**: The connector thread pool is saturated, or the JVM is under
memory or CPU pressure.

**Look at**: `tomcat.thread.busy.count` against `tomcat.thread.limit`
(pool saturation) and `tomcat.request.duration.max` (tail latency). On
the JVM side, the Diagnostic `jvm.memory.used_after_last_gc` (live set
after GC) and `jvm.system.cpu.utilization` / `jvm.system.cpu.load_1m`
(host CPU pressure) show whether GC churn or a CPU-bound host is the
cause.

**Fix**:

1. Raise `maxThreads` on the connector or shed load if the busy count is
   pinned at the limit.
2. Raise heap or reduce allocation if `used_after_last_gc` keeps climbing
   between collections.

### Suspected memory or descriptor leak

**Cause**: Long-running growth in live threads, loaded classes, direct
buffers, or open file descriptors.

**Look at**: `jvm.thread.count` (Operational), and the Diagnostic
`jvm.class.loaded` / `jvm.class.unloaded` (classloader leaks on
redeploy), `jvm.buffer.memory.used` (direct-buffer growth), and
`jvm.file_descriptor.count` (fd exhaustion).

**Fix**:

1. Correlate the rising series with deploy events or traffic shape.
2. Capture a heap or thread dump for the offending component.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Tomcat running in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar in the same pod and set
`OTEL_JMX_SERVICE_URL` to
`service:jmx:rmi:///jndi/rmi://localhost:9010/jmxrmi`, since both
containers share the pod network. No firewall rules are needed for
intra-pod communication. The Collector receives OTLP from the scraper.

**Can I use this with embedded Tomcat (Spring Boot)?**

Yes. Spring Boot's embedded Tomcat registers MBeans under the `Tomcat:`
domain instead of `Catalina:`. The scraper's `tomcat` target system
handles both. Enable JMX remote access on the app with the same
`-Dcom.sun.management.jmxremote.*` flags.

**What happened to the OTel Collector JMX receiver?**

The Collector's `jmxreceiver` was deprecated in January 2026. It needed
a JRE inside the Collector container and ran a Java subprocess
internally. The standalone JMX Scraper replaces it - the same metric
definitions, a cleaner operational model.

**How do I monitor multiple Tomcat instances?**

Run one JMX Scraper per Tomcat instance, each with a different
`OTEL_JMX_SERVICE_URL`. All scrapers export to the same Collector:

```yaml showLineNumbers title="docker-compose.yaml (multiple instances)"
jmx-scraper-primary:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://tomcat-1:9010/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,tomcat
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317

jmx-scraper-replica:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://tomcat-2:9010/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,tomcat
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
```

**Why is there no `up` metric?**

JMX exposes no liveness gauge. Use `jvm.memory.used` as the
process-alive anchor - if it stops reporting, the scraper has lost its
JMX connection to Tomcat.

## Related Guides

- [JMX Metrics Guide](../collector-setup/jmx-metrics-collection-guide.md) -
  Compare the JMX Scraper and the JMX Exporter.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Cassandra Monitoring](./cassandra.md) - Another JMX-based monitoring setup.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Tomcat metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Nginx](./nginx.md), [PostgreSQL](./postgres.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
