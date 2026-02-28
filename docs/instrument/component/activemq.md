---
title: >
  ActiveMQ OpenTelemetry Monitoring — Queue Depth, Message Rates,
  and Collector Setup
sidebar_label: ActiveMQ
id: collecting-activemq-telemetry
sidebar_position: 35
description: >
  Collect ActiveMQ Classic metrics with the OpenTelemetry JMX Scraper.
  Monitor queue depth, enqueue/dequeue rates, and broker memory using
  JMX and export to base14 Scout.
keywords:
  - activemq opentelemetry
  - activemq otel collector
  - activemq metrics monitoring
  - activemq performance monitoring
  - opentelemetry jmx scraper activemq
  - activemq observability
  - activemq classic monitoring
  - activemq queue monitoring
  - activemq jmx monitoring
  - activemq telemetry collection
---

# ActiveMQ

The OpenTelemetry JMX Scraper collects 18 ActiveMQ-specific metrics
and 18 JVM metrics from Apache ActiveMQ Classic 5.x/6.x, including
queue size, enqueue/dequeue counts, producer and consumer counts,
broker memory utilization, and storage limits. ActiveMQ Classic (not
Artemis) exposes MBeans under `org.apache.activemq`. The scraper
connects via JMX, converts MBeans into OpenTelemetry metrics, and
exports them over OTLP to the Collector. This guide enables remote
JMX on ActiveMQ, configures the scraper, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement     | Minimum | Recommended |
| --------------- | ------- | ----------- |
| ActiveMQ Classic | 5.15   | 6.0+        |
| JMX Scraper     | 1.46.0  | 1.54.0+     |
| Java (scraper)  | 11      | 17+         |
| OTel Collector  | 0.90.0  | latest      |
| base14 Scout    | Any     | —           |

Before starting:

- ActiveMQ must be accessible from the host running the JMX Scraper
  (JMX port, default 1099)
- The JMX Scraper runs as a standalone Java process — it requires
  its own JRE
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Messages**: queue size, enqueued count, dequeued count, expired
  count, enqueue average duration
- **Producers/Consumers**: producer count, consumer count (per
  destination)
- **Memory**: destination memory usage/limit, broker memory
  utilization/limit
- **Storage**: store utilization/limit, temp utilization/limit
- **Connections**: active connection count
- **JVM** (with `jvm` target): heap and non-heap memory, GC
  count and duration, thread states, CPU utilization, class
  loading, buffer pools

Full metric reference:
[OTel ActiveMQ JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/activemq.md)

## Access Setup

ActiveMQ Classic enables local JMX by default
(`-Dcom.sun.management.jmxremote` is set in `bin/setenv`), but
remote access requires configuring a port. Add the following JMX
flags to `bin/setenv`:

### Enable Remote JMX on ActiveMQ

```bash showLineNumbers title="bin/setenv"
ACTIVEMQ_SUNJMX_START="$ACTIVEMQ_SUNJMX_START \
  -Dcom.sun.management.jmxremote.port=1099 \
  -Dcom.sun.management.jmxremote.rmi.port=1099 \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Djava.rmi.server.hostname=<activemq-host>"   # Your ActiveMQ host IP or hostname
```

Setting `rmi.port` to the same value as `port` prevents RMI
from using a random second port, which simplifies firewall and
Docker networking.

For Docker deployments, pass `ACTIVEMQ_SUNJMX_START` as an
environment variable and set `hostname` on the container:

```yaml showLineNumbers title="docker-compose.yaml (ActiveMQ service)"
activemq:
  image: apache/activemq-classic:6.1.6
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

### With Authentication (Production)

For production environments, enable JMX authentication. ActiveMQ
includes template access and password files in `conf/`:

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

The JMX Scraper supports authenticated connections via
`OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD` environment
variables.

## Configuration

ActiveMQ monitoring uses two components: the JMX Scraper (connects
to ActiveMQ, exports OTLP) and the OTel Collector (receives OTLP,
ships to Scout).

```text
ActiveMQ (JMX:1099) ← JMX/RMI → JMX Scraper → OTLP → OTel Collector → Scout
```

### JMX Scraper

Download the scraper JAR from
[Maven Central](https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/)
and run it:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi \
OTEL_JMX_TARGET_SYSTEM=jvm,activemq \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -jar opentelemetry-jmx-scraper-1.54.0-alpha.jar
```

Move the JAR to a permanent location:

```bash showLineNumbers title="Install the scraper"
sudo mkdir -p /opt/otel
sudo mv opentelemetry-jmx-scraper-1.54.0-alpha.jar /opt/otel/
```

Create a systemd service to run the scraper as a managed service:

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
ExecStart=/usr/bin/java -jar /opt/otel/opentelemetry-jmx-scraper-1.54.0-alpha.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Start the scraper:

```bash showLineNumbers title="Enable and start the scraper"
sudo systemctl daemon-reload
sudo systemctl enable --now otel-jmx-scraper
```

For Docker, build a simple image with the scraper JAR:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM eclipse-temurin:17-jre

ARG SCRAPER_VERSION=1.54.0-alpha   # Update to match your target version

ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar

ENTRYPOINT ["java", "-jar", "/opt/scraper.jar"]
```

### OTel Collector

The Collector receives metrics from the JMX Scraper over OTLP:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

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
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

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

Full working example with all three components:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  activemq:
    image: apache/activemq-classic:6.1.6
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
    image: otel/opentelemetry-collector-contrib:0.120.0
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - activemq
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check JMX Scraper logs for successful connection
docker logs activemq-telemetry-jmx-scraper-1 2>&1 | head -10

# Verify ActiveMQ is running with JMX enabled
docker logs activemq 2>&1 \
  | grep "jmxremote"

# Check Collector logs for ActiveMQ metrics
docker logs otel-collector 2>&1 \
  | grep "activemq"
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach ActiveMQ's JMX port.

**Fix**:

1. Verify ActiveMQ is running:
   `docker ps | grep activemq`
2. Confirm remote JMX is enabled — check that
   `ACTIVEMQ_SUNJMX_START` includes `-Dcom.sun.management.jmxremote.port=1099`
3. Verify the JMX port matches between ActiveMQ config and
   scraper's `OTEL_JMX_SERVICE_URL`
4. In Docker, ensure `hostname` is set on the ActiveMQ container
   and matches `-Djava.rmi.server.hostname`

### Only JVM metrics, no ActiveMQ metrics

**Cause**: The `OTEL_JMX_TARGET_SYSTEM` does not include
`activemq`.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,activemq` (both targets
   comma-separated)
2. Verify ActiveMQ has started fully — MBeans are only available
   after the broker initializes
3. Confirm you are running ActiveMQ Classic, not Artemis — the
   `activemq` target does not support Artemis MBeans

### No destination metrics

**Cause**: Destination-level metrics (`activemq.message.queue.size`,
`activemq.consumer.count`) only appear when at least one queue or
topic exists.

**Fix**:

1. Create a test queue via the web console at `http://localhost:8161`
   (default credentials: admin/admin)
2. Destination MBeans are created when a queue or topic receives
   its first message or a consumer subscribes

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**Does this work with ActiveMQ Artemis?**

No. ActiveMQ Artemis uses different MBeans under
`org.apache.activemq.artemis`. The JMX Scraper's `activemq` target
is for ActiveMQ Classic only. Artemis requires custom scraper rules
via `OTEL_JMX_CUSTOM_CONFIG`.

**Can I monitor both queues and topics?**

Yes. Both queues and topics are JMX MBeans under
`org.apache.activemq:type=Broker`. The scraper collects metrics
from all destinations by default — no additional configuration
needed.

**Does this work with ActiveMQ running in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar container in the same pod.
Set `OTEL_JMX_SERVICE_URL` to `service:jmx:rmi:///jndi/rmi://
localhost:1099/jmxrmi` since both containers share the pod
network. No firewall rules needed for intra-pod communication.

**How do I monitor multiple ActiveMQ brokers?**

Run one JMX Scraper per broker, each configured with a different
`OTEL_JMX_SERVICE_URL`. All scrapers export to the same Collector:

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

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Kafka](./kafka.md),
  [RabbitMQ](./rabbitmq.md),
  and other message brokers
- **Fine-tune Collection**: Adjust `OTEL_METRIC_EXPORT_INTERVAL`
  to control scrape frequency

## Related Guides

- [JMX Metrics Collection Guide](../collector-setup/jmx-metrics-collection-guide.md)
  — Compare JMX Scraper vs JMX Exporter
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  — Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  — Production deployment
- [Kafka Monitoring](./kafka.md)
  — Another message broker setup
- [RabbitMQ Monitoring](./rabbitmq.md)
  — Another message broker setup
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on ActiveMQ metrics
