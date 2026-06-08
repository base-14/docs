---
title: >
  ActiveMQ OpenTelemetry Monitoring - Queue Depth, Message Rates,
  and Collector Setup
sidebar_label: ActiveMQ
id: collecting-activemq-telemetry
sidebar_position: 35
description: >
  Collect ActiveMQ Classic metrics with the OpenTelemetry JMX Scraper.
  Monitor queue size, enqueue/dequeue rates, and broker memory, then ship
  to base14 Scout.
keywords:
  - activemq opentelemetry
  - activemq otel collector
  - activemq metrics monitoring
  - activemq performance monitoring
  - opentelemetry jmx scraper activemq
  - activemq observability
  - activemq queue monitoring
  - activemq telemetry collection
---

# ActiveMQ

The OpenTelemetry JMX Scraper collects 18 ActiveMQ metrics and 19 JVM
metrics from Apache ActiveMQ Classic 5.x/6.x - queue size,
enqueue/dequeue counts, message expiry, producer and consumer counts,
broker memory/store/temp utilization, and heap and thread health.
ActiveMQ Classic (not Artemis) keeps these counters in MBeans under
`org.apache.activemq` with no Prometheus or OTLP endpoint of its own, so
the scraper connects over JMX/RMI, converts the MBeans to OpenTelemetry
metrics, and pushes them over OTLP to the Collector. This guide enables
remote JMX on ActiveMQ, configures the scraper, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement      | Minimum      | Recommended  |
| ---------------- | ------------ | ------------ |
| ActiveMQ Classic | 5.15         | 6.2.0        |
| JMX Scraper      | 1.53.0-alpha | 1.57.0-alpha |
| Java (scraper)   | 11           | 17+          |
| OTel Collector   | 0.90.0       | 0.153.0      |
| base14 Scout     | Any          | -            |

Before starting:

- ActiveMQ must be reachable from the host running the JMX Scraper (JMX
  port, default 1099).
- The JMX Scraper runs as a standalone Java process and needs its own
  JRE.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

The 18-metric `activemq` rule set documented here is bundled in JMX
Scraper `1.53.0-alpha` and later; earlier releases collect the `activemq`
target through an older rule set with different metric names.
The metric names come from the scraper's `activemq` rules, not from
ActiveMQ itself, so an ActiveMQ version change cannot rename or drop a
metric - it can only leave a source MBean absent.

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

### Core - is it up and doing its job

| Metric | What it tells you |
|---|---|
| `activemq.message.enqueued` | Messages accepted by the broker - the throughput KPI. Flat under load means producers are blocked. |
| `jvm.memory.used` | JVM heap in use. JMX exposes no `up` metric, so heap-in-use doubles as the process-alive and heap-health anchor. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `activemq.message.queue.size` | Messages currently on the destination - backlog depth. |
| `activemq.message.dequeued` | Messages consumed; compare against `enqueued` for the drain rate. |
| `activemq.message.expired` | Messages that died before delivery (TTL elapsed or no live consumer). |
| `activemq.consumer.count` | Consumers attached to a destination; zero on a filling queue means a stuck destination. |
| `activemq.memory.utilization` | Broker memory as a fraction of its limit; near 1.0 triggers producer flow control. |
| `activemq.store.utilization` | Persistent message store as a fraction of its limit (disk). |
| `activemq.temp.utilization` | Temp store as a fraction of its limit (non-persistent overflow). |
| `jvm.memory.limit` | JVM memory ceiling - the saturation denominator for `jvm.memory.used`. |
| `jvm.cpu.recent_utilization` | Recent process CPU utilization. |
| `jvm.thread.count` | Live JVM threads - a steady climb signals a thread leak. |

Per-request enqueue timing is in the Diagnostic tier
(`activemq.message.enqueue.average_duration`), not here - it is a JMX
gauge, not a percentile distribution.

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity
review. In production you can drop this tier to control metric volume
and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| Connections / producers | `activemq.connection.count`, `activemq.producer.count` | Correlate client load with backlog or flow control. |
| Enqueue latency | `activemq.message.enqueue.average_duration` | Slow accepts under load; broker-side write contention. |
| Saturation ceilings | `activemq.memory.limit`, `activemq.store.limit`, `activemq.temp.limit` | The raw limits behind the utilization fractions; capacity planning. |
| Per-destination | `activemq.destination.memory.usage`, `activemq.destination.memory.limit`, `activemq.destination.temp.utilization`, `activemq.destination.temp.limit` | One destination saturating while the broker looks healthy overall. |
| JVM memory detail | `jvm.memory.committed`, `jvm.memory.init`, `jvm.memory.used_after_last_gc` | GC behaviour and post-collection live-set size. |
| JVM class loading | `jvm.class.count`, `jvm.class.loaded`, `jvm.class.unloaded` | Classloader leaks; runaway dynamic loading. |
| JVM CPU / system | `jvm.cpu.count`, `jvm.cpu.time`, `jvm.system.cpu.load_1m`, `jvm.system.cpu.utilization` | Host-level CPU pressure vs process CPU. |
| JVM buffers / descriptors | `jvm.buffer.count`, `jvm.buffer.memory.limit`, `jvm.buffer.memory.used`, `jvm.file_descriptor.count`, `jvm.file_descriptor.limit` | Direct-buffer growth and fd exhaustion. |

Full metric reference:
[OTel ActiveMQ JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/activemq.md).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
Tune to your workload; these are starting points.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `activemq.message.queue.size` | Climbing vs baseline | `rate(message.enqueued)` > `rate(message.dequeued)` sustained | Consumers can't keep up; scale consumers or investigate slow processing. |
| `activemq.consumer.count` | == 0 while `queue.size` > 0 | Sustained | No consumers draining a non-empty queue; restart or attach consumers. |
| `activemq.memory.utilization` | Approaching 1.0 | At 1.0 | Producers get throttled by flow control; raise broker `memoryUsage` or drain faster. |
| `activemq.store.utilization` | Approaching 1.0 | At 1.0 | Persistent producers block; raise `storeUsage` or add disk. |
| `activemq.temp.utilization` | Approaching 1.0 | At 1.0 | Non-persistent overflow exhausted; raise `tempUsage` or reduce load. |
| `rate(activemq.message.expired)` | > 0 | Rising across scrapes | Messages dying before delivery (TTL or no live consumer); check consumers and TTLs. |
| `jvm.memory.used` / `jvm.memory.limit` | Approaching the limit | Approaching 1.0 | GC churn and OOM risk; raise heap or reduce allocation. |
| `jvm.cpu.recent_utilization` | Sustained high | Pegged | Process is CPU-bound; scale out or profile hot paths. |

## Access Setup

ActiveMQ Classic exposes its MBeans over JMX once the
`-Dcom.sun.management.jmxremote` flags are set; remote access additionally
requires a fixed port. Add the JMX flags to `bin/setenv`:

```bash showLineNumbers title="bin/setenv"
ACTIVEMQ_SUNJMX_START="$ACTIVEMQ_SUNJMX_START \
  -Dcom.sun.management.jmxremote.port=1099 \
  -Dcom.sun.management.jmxremote.rmi.port=1099 \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Djava.rmi.server.hostname=<activemq-host>"   # Your ActiveMQ host IP or hostname
```

Setting `rmi.port` to the same value as `port` stops RMI from opening a
random second port, which keeps firewall and Docker networking simple.

For Docker deployments, pass `ACTIVEMQ_SUNJMX_START` as an environment
variable and set `hostname` on the container so RMI advertises a
resolvable address:

```yaml showLineNumbers title="docker-compose.yaml (ActiveMQ service)"
activemq:
  image: apache/activemq-classic:6.2.0
  hostname: activemq
  environment:
    ACTIVEMQ_SUNJMX_START: >-
      -Dcom.sun.management.jmxremote
      -Dcom.sun.management.jmxremote.port=1099
      -Dcom.sun.management.jmxremote.rmi.port=1099
      -Dcom.sun.management.jmxremote.ssl=false
      -Dcom.sun.management.jmxremote.authenticate=false
      -Djava.rmi.server.hostname=activemq
```

### With Authentication

In production, enable JMX authentication. ActiveMQ ships template access
and password files in `conf/`:

```bash showLineNumbers title="bin/setenv (authenticated)"
ACTIVEMQ_SUNJMX_START="$ACTIVEMQ_SUNJMX_START \
  -Dcom.sun.management.jmxremote.port=1099 \
  -Dcom.sun.management.jmxremote.rmi.port=1099 \
  -Dcom.sun.management.jmxremote.ssl=true \
  -Dcom.sun.management.jmxremote.authenticate=true \
  -Dcom.sun.management.jmxremote.password.file=${ACTIVEMQ_CONF}/jmx.password \
  -Dcom.sun.management.jmxremote.access.file=${ACTIVEMQ_CONF}/jmx.access \
  -Djava.rmi.server.hostname=<activemq-host>"
```

The JMX Scraper authenticates with the `OTEL_JMX_USERNAME` and
`OTEL_JMX_PASSWORD` environment variables. A read-only JMX role in
`jmx.access` is enough - the scraper never writes to MBeans.

## Configuration

ActiveMQ monitoring uses two components: the JMX Scraper (connects to
ActiveMQ over JMX, exports OTLP) and the OTel Collector (receives OTLP,
ships to Scout).

```text
ActiveMQ (JMX:1099) ← JMX/RMI → JMX Scraper → OTLP → OTel Collector → Scout
```

### JMX Scraper

Download the scraper JAR from
[Maven Central](https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/)
and run it with the `jvm,activemq` target systems:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi \
OTEL_JMX_TARGET_SYSTEM=jvm,activemq \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -jar opentelemetry-jmx-scraper-1.57.0-alpha.jar
```

To run it as a managed service, install the JAR and add a systemd unit:

```bash showLineNumbers title="Install the scraper"
sudo mkdir -p /opt/otel
sudo mv opentelemetry-jmx-scraper-1.57.0-alpha.jar /opt/otel/
```

```bash showLineNumbers title="/etc/systemd/system/otel-jmx-scraper.service"
sudo tee /etc/systemd/system/otel-jmx-scraper.service > /dev/null <<'EOF'
[Unit]
Description=OpenTelemetry JMX Scraper for ActiveMQ
After=network.target activemq.service

[Service]
Type=simple
Environment=OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi
Environment=OTEL_JMX_TARGET_SYSTEM=jvm,activemq
Environment=OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
Environment=OTEL_METRIC_EXPORT_INTERVAL=10000
ExecStart=/usr/bin/java -jar /opt/otel/opentelemetry-jmx-scraper-1.57.0-alpha.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

```bash showLineNumbers title="Enable and start the scraper"
sudo systemctl daemon-reload
sudo systemctl enable --now otel-jmx-scraper
```

For Docker, build a small image that fetches the scraper JAR:

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

To control metric volume in production, drop the Diagnostic-tier
`activemq.destination.*` and JVM internals with a `filter` processor
while keeping the Core and Operational series.

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
# JMX Scraper
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://activemq:1099/jmxrmi
OTEL_JMX_TARGET_SYSTEM=jvm,activemq
OTEL_METRIC_EXPORT_INTERVAL=10000
# OTEL_JMX_USERNAME=monitor          # Uncomment for authenticated JMX
# OTEL_JMX_PASSWORD=your_password    # Uncomment for authenticated JMX

# OTel Collector
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Docker Compose

A full working example with all three components:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  activemq:
    image: apache/activemq-classic:6.2.0
    hostname: activemq
    ports:
      - "8161:8161"
      - "61616:61616"
      - "1099:1099"
    environment:
      ACTIVEMQ_SUNJMX_START: >-
        -Dcom.sun.management.jmxremote
        -Dcom.sun.management.jmxremote.port=1099
        -Dcom.sun.management.jmxremote.rmi.port=1099
        -Dcom.sun.management.jmxremote.ssl=false
        -Dcom.sun.management.jmxremote.authenticate=false
        -Djava.rmi.server.hostname=activemq
    healthcheck:
      test: ["CMD-SHELL", "curl -so /dev/null http://localhost:8161/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  jmx-scraper:
    build: ./jmx-scraper
    environment:
      OTEL_JMX_SERVICE_URL: ${OTEL_JMX_SERVICE_URL}
      OTEL_JMX_TARGET_SYSTEM: ${OTEL_JMX_TARGET_SYSTEM}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: ${OTEL_METRIC_EXPORT_INTERVAL}
    depends_on:
      activemq:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.153.0
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - activemq
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check the JMX Scraper connected to ActiveMQ
docker logs activemq-telemetry-jmx-scraper-1 2>&1 | head -10

# Confirm ActiveMQ started with remote JMX enabled
docker logs activemq 2>&1 | grep "jmxremote"

# Check Collector logs for ActiveMQ metrics
docker logs otel-collector 2>&1 | grep "activemq"
```

The `activemq.*` metrics only carry non-zero values once a destination
has seen traffic. Enqueue some messages and drain part of them so the
enqueue, dequeue, and queue-size counters move:

```bash showLineNumbers title="Generate broker traffic"
docker exec activemq bin/activemq producer --destination queue://demoQ --messageCount 500
docker exec activemq bin/activemq consumer --destination queue://demoQ --messageCount 300
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach ActiveMQ's JMX port.

**Fix**:

1. Verify ActiveMQ is running: `docker ps | grep activemq`.
2. Confirm remote JMX is enabled - `ACTIVEMQ_SUNJMX_START` must include
   `-Dcom.sun.management.jmxremote.port=1099`.
3. Confirm the JMX port matches between the ActiveMQ config and the
   scraper's `OTEL_JMX_SERVICE_URL`.
4. In Docker, ensure `hostname` is set on the ActiveMQ container and
   matches `-Djava.rmi.server.hostname`, so the RMI handshake advertises
   a resolvable address.

### Only JVM metrics, no ActiveMQ metrics

**Cause**: The `OTEL_JMX_TARGET_SYSTEM` is missing `activemq`, or the
broker had not finished starting when the scraper connected.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,activemq` (both targets,
   comma-separated).
2. Confirm ActiveMQ has fully started - the `org.apache.activemq` MBeans
   only register after the broker initializes.
3. Confirm you are running ActiveMQ Classic, not Artemis - the
   `activemq` target does not read Artemis MBeans.

### No per-destination metrics

**Cause**: Destination-level series only exist once a queue or topic
exists.

**Look at**: `activemq.consumer.count`, `activemq.message.queue.size`,
and the Diagnostic `activemq.destination.memory.usage` /
`activemq.destination.temp.utilization` - all per-destination, all
absent until a destination is created.

**Fix**:

1. Send a message to a destination, or attach a consumer - the
   destination MBean is created on first use.
2. The web console at `http://localhost:8161` (default `admin/admin`)
   can create a test queue.

### Queue backlog or expiring messages

**Cause**: Consumers are slower than producers, or no consumer is
attached.

**Look at**: `activemq.message.queue.size` (backlog depth) against
`activemq.consumer.count` (zero on a filling queue means a stuck
destination), and `activemq.message.expired` for messages dying before
delivery. On the broker side, `activemq.memory.utilization` near 1.0
means producers are being throttled by flow control.

**Fix**:

1. Scale or restart consumers if `consumer.count` is zero or below the
   producer rate.
2. Raise broker `memoryUsage` / `storeUsage` / `tempUsage`, or drain
   faster, if the matching utilization fraction approaches 1.0.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `otlp` receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Does this work with ActiveMQ Artemis?**

No. Artemis uses different MBeans under `org.apache.activemq.artemis`.
The JMX Scraper's `activemq` target is for ActiveMQ Classic only.
Artemis needs custom scraper rules via `OTEL_JMX_CUSTOM_CONFIG`.

**Can I monitor both queues and topics?**

Yes. Queues and topics are both MBeans under
`org.apache.activemq:type=Broker`. The scraper collects from all
destinations by default - no extra configuration needed.

**Does this work with ActiveMQ running in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar in the same pod and set
`OTEL_JMX_SERVICE_URL` to
`service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi`, since both
containers share the pod network. No firewall rules are needed for
intra-pod traffic.

**How do I monitor multiple ActiveMQ brokers?**

Run one JMX Scraper per broker, each with a different
`OTEL_JMX_SERVICE_URL`, all exporting to the same Collector:

```yaml showLineNumbers title="docker-compose.yaml (multiple brokers)"
jmx-scraper-primary:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://activemq-1:1099/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,activemq
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317

jmx-scraper-replica:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://activemq-2:1099/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,activemq
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
```

**Why is there no `up` metric for the broker?**

JMX exposes no synthetic `up` series. Use `jvm.memory.used` as the
process-alive anchor - if it stops reporting, the broker JVM or the
scraper connection is down.

## Related Guides

- [JMX Metrics Guide](../collector-setup/jmx-metrics-collection-guide.md) -
  Compare the JMX Scraper and the JMX Exporter.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Kafka Monitoring](./kafka.md) - Another message broker on the JMX path.
- [RabbitMQ Monitoring](./rabbitmq.md) - Another message broker setup.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on ActiveMQ metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md), [RabbitMQ](./rabbitmq.md), and other message
  brokers.
- **Fine-tune Collection**: Adjust `OTEL_METRIC_EXPORT_INTERVAL` to
  control scrape frequency, and drop the Diagnostic tier in production
  to control volume while keeping it available for investigation.
