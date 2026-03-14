---
title: >
  Jetty OpenTelemetry Monitoring - Thread Pools, Sessions,
  and Collector Setup
sidebar_label: Jetty
id: collecting-jetty-telemetry
sidebar_position: 36
description: >
  Collect Eclipse Jetty metrics with the OpenTelemetry JMX Scraper.
  Monitor thread pools, I/O selects, and session activity using
  JMX and export to base14 Scout.
keywords:
  - jetty opentelemetry
  - jetty otel collector
  - jetty metrics monitoring
  - jetty performance monitoring
  - opentelemetry jmx scraper jetty
  - jetty observability
  - jetty server monitoring
  - eclipse jetty opentelemetry
  - jetty jmx monitoring
  - jetty telemetry collection
---

# Jetty

The OpenTelemetry JMX Scraper collects 9 Jetty-specific metrics
and 18 JVM metrics from Eclipse Jetty 9.x through 12.x, including
thread pool utilization, I/O select counts, and session activity.
Jetty requires explicit JMX enablement - unlike Tomcat, JMX MBean
registration is not configured by default. The scraper connects
to Jetty via JMX, converts MBeans into OpenTelemetry metrics, and
exports them over OTLP to the Collector. This guide enables JMX
on Jetty, configures the scraper, and ships metrics to base14 Scout.

## Prerequisites

| Requirement    | Minimum | Recommended |
| -------------- | ------- | ----------- |
| Eclipse Jetty  | 9.4     | 12.0+       |
| JMX Scraper    | 1.46.0  | 1.54.0+     |
| Java (scraper) | 11      | 17+         |
| OTel Collector | 0.90.0  | latest      |
| base14 Scout   | Any     | -           |

Before starting:

- Jetty must be accessible from the host running the JMX Scraper
  (JMX port, default 1099)
- The JMX Scraper runs as a standalone Java process - it requires
  its own JRE
- Jetty's `jmx` module must be enabled for MBean registration
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Threads**: count, limit, busy count, idle count, queue size
- **I/O**: select count
- **Sessions**: active count (Jetty 12+), created count (9-11),
  duration sum (9-11)
- **JVM** (with `jvm` target): heap and non-heap memory, GC
  count and duration, thread states, CPU utilization, class
  loading, buffer pools

Session metrics only appear when web applications with active
sessions are deployed.

Full metric reference:
[OTel Jetty JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/jetty.md)

## Access Setup

Jetty JMX is disabled by default. Two steps are required: enable
the `jmx` module (registers Jetty MBeans) and configure remote
JMX access (opens a port for the scraper).

### Enable JMX on Jetty

For standalone Jetty, enable the JMX module and add remote access
flags:

```bash showLineNumbers title="Enable Jetty JMX module and remote access"
# Enable Jetty JMX MBean registration
java -jar $JETTY_HOME/start.jar --add-module=jmx

# Add remote JMX access flags to start.d
cat >> $JETTY_BASE/start.d/jmx-remote.ini << 'EOF'
--exec
-Dcom.sun.management.jmxremote.port=1099
-Dcom.sun.management.jmxremote.rmi.port=1099
-Dcom.sun.management.jmxremote.ssl=false
-Dcom.sun.management.jmxremote.authenticate=false
-Djava.rmi.server.hostname=<jetty-host>
EOF
```

Setting `rmi.port` to the same value as `port` prevents RMI
from using a random second port, which simplifies firewall and
Docker networking.

For Docker deployments, the Jetty image requires a custom
Dockerfile to enable the `jmx` module during build. JMX remote
access flags are passed via `JAVA_OPTIONS`:

```dockerfile showLineNumbers title="jetty/Dockerfile"
FROM jetty:12.0-jdk17

USER root
RUN java -jar "$JETTY_HOME/start.jar" --add-module=jmx
USER jetty
```

```yaml showLineNumbers title="docker-compose.yaml (Jetty service)"
jetty:
  build: ./jetty
  hostname: jetty
  environment:
    JAVA_OPTIONS: >-
      -Dcom.sun.management.jmxremote.port=1099
      -Dcom.sun.management.jmxremote.rmi.port=1099
      -Dcom.sun.management.jmxremote.ssl=false
      -Dcom.sun.management.jmxremote.authenticate=false
      -Djava.rmi.server.hostname=jetty
```

### With Authentication (Production)

For production environments, enable JMX authentication:

```bash showLineNumbers title="start.d/jmx-remote.ini (authenticated)"
--exec
-Dcom.sun.management.jmxremote.port=1099
-Dcom.sun.management.jmxremote.rmi.port=1099
-Dcom.sun.management.jmxremote.ssl=true
-Dcom.sun.management.jmxremote.authenticate=true
-Dcom.sun.management.jmxremote.password.file=/path/to/jmxremote.password
-Dcom.sun.management.jmxremote.access.file=/path/to/jmxremote.access
-Djava.rmi.server.hostname=<jetty-host>
```

The JMX Scraper supports authenticated connections via
`OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD` environment
variables.

## Configuration

Jetty monitoring uses two components: the JMX Scraper (connects
to Jetty, exports OTLP) and the OTel Collector (receives OTLP,
ships to Scout).

```text
Jetty (JMX:1099) ← JMX/RMI → JMX Scraper → OTLP → OTel Collector → Scout
```

### JMX Scraper

Download the scraper JAR from
[Maven Central](https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/)
and run it:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi \
OTEL_JMX_TARGET_SYSTEM=jvm,jetty \
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
Description=OpenTelemetry JMX Scraper for Jetty
After=network.target jetty.service

[Service]
Type=simple
Environment=OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://localhost:1099/jmxrmi
Environment=OTEL_JMX_TARGET_SYSTEM=jvm,jetty
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
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://jetty:1099/jmxrmi
OTEL_JMX_TARGET_SYSTEM=jvm,jetty
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
  jetty:
    build: ./jetty
    hostname: jetty
    ports:
      - "8080:8080"
      - "1099:1099"
    environment:
      JAVA_OPTIONS: >-
        -Dcom.sun.management.jmxremote.port=1099
        -Dcom.sun.management.jmxremote.rmi.port=1099
        -Dcom.sun.management.jmxremote.ssl=false
        -Dcom.sun.management.jmxremote.authenticate=false
        -Djava.rmi.server.hostname=jetty
    healthcheck:
      test: ["CMD-SHELL", "curl -so /dev/null http://localhost:8080/ || exit 1"]
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
      jetty:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.120.0
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - jetty
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check JMX Scraper logs for successful connection
docker logs jetty-telemetry-jmx-scraper-1 2>&1 | head -10

# Verify Jetty started with JMX enabled
docker logs jetty 2>&1 \
  | grep "jmx"

# Check Collector logs for Jetty metrics
docker logs otel-collector 2>&1 \
  | grep "jetty"
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach Jetty's JMX port.

**Fix**:

1. Verify Jetty is running:
   `docker ps | grep jetty`
2. Confirm JMX remote access is enabled - check that
   `-Dcom.sun.management.jmxremote.port=1099` is in `JAVA_OPTIONS`
   or `start.d/jmx-remote.ini`
3. Verify the JMX port matches between Jetty config and
   scraper's `OTEL_JMX_SERVICE_URL`
4. In Docker, ensure `hostname` is set on the Jetty container
   and matches `-Djava.rmi.server.hostname`

### Only JVM metrics, no Jetty metrics

**Cause**: Jetty's `jmx` module is not enabled, so Jetty
components are not registered as MBeans.

**Fix**:

1. Enable the JMX module: `java -jar start.jar --add-module=jmx`
2. In Docker, use the custom Dockerfile that runs
   `--add-module=jmx` during build
3. Verify `OTEL_JMX_TARGET_SYSTEM` includes `jetty`

### Session metrics missing

**Cause**: Session metrics (`jetty.session.active.count`,
`jetty.session.created.count`, `jetty.session.duration.sum`)
only appear when web applications with active sessions are deployed.

**Fix**:

1. Deploy a WAR file with session usage to Jetty
2. Session MBeans are created per web application context

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**Does this work with embedded Jetty (Spring Boot/Dropwizard)?**

Yes. Spring Boot and Dropwizard embed Jetty and register MBeans
automatically when `spring.jmx.enabled=true` (Spring Boot) or
JMX is enabled in the Dropwizard config. Enable remote JMX access
with the same `-Dcom.sun.management.jmxremote.*` JVM flags on
the application.

**Which Jetty version should I use?**

Jetty 12 is recommended. Session metrics improved in Jetty 12+
(`jetty.session.active.count` replaces `jetty.session.count`).
Thread and I/O metrics are consistent across all supported
versions (9.4+).

**How do I monitor multiple Jetty instances?**

Run one JMX Scraper per instance, each configured with a different
`OTEL_JMX_SERVICE_URL`. All scrapers export to the same Collector:

```yaml showLineNumbers title="docker-compose.yaml (multiple instances)"
jmx-scraper-primary:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://jetty-1:1099/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,jetty
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317

jmx-scraper-replica:
  environment:
    OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://jetty-2:1099/jmxrmi
    OTEL_JMX_TARGET_SYSTEM: jvm,jetty
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
```

**Does this work with Jetty in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar container in the same pod.
Set `OTEL_JMX_SERVICE_URL` to `service:jmx:rmi:///jndi/rmi://
localhost:1099/jmxrmi` since both containers share the pod
network. No firewall rules needed for intra-pod communication.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Tomcat](./tomcat.md),
  [Nginx](./nginx.md),
  and other web servers
- **Fine-tune Collection**: Adjust `OTEL_METRIC_EXPORT_INTERVAL`
  to control scrape frequency

## Related Guides

- [JMX Metrics Collection Guide](../collector-setup/jmx-metrics-collection-guide.md)
  - Compare JMX Scraper vs JMX Exporter
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md)
  - Advanced collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md)
  - Run the Collector locally
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md)
  - Production deployment
- [Tomcat Monitoring](./tomcat.md)
  - Another Java application server setup
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  - Alert on Jetty metrics
