---
title: >
  Tomcat OpenTelemetry Monitoring — Request Rates, Thread Pools,
  and Collector Setup
sidebar_label: Tomcat
id: collecting-tomcat-telemetry
sidebar_position: 33
description: >
  Collect Apache Tomcat metrics with the OpenTelemetry JMX Scraper.
  Monitor request throughput, thread pool utilization, and session
  counts using JMX and export to base14 Scout.
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

The OpenTelemetry JMX Scraper collects 8 Tomcat-specific metrics
and 18 JVM metrics from Apache Tomcat 8.5+, including request
throughput, error counts, thread pool utilization, network I/O,
and session activity. The scraper connects to Tomcat via JMX,
converts MBeans into OpenTelemetry metrics, and exports them over
OTLP to the Collector. This guide enables JMX on Tomcat,
configures the scraper, and ships metrics to base14 Scout.

## Prerequisites

| Requirement    | Minimum | Recommended |
| -------------- | ------- | ----------- |
| Apache Tomcat  | 8.5     | 10.1+       |
| JMX Scraper    | 1.46.0  | 1.54.0+     |
| Java (scraper) | 11      | 17+         |
| OTel Collector | 0.90.0  | latest      |
| base14 Scout   | Any     | —           |

Before starting:

- Tomcat must be accessible from the host running the JMX Scraper
  (JMX port, default 9010)
- The JMX Scraper runs as a standalone Java process — it requires
  its own JRE
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Requests**: total count, error count, max processing time,
  cumulative processing time
- **Network**: bytes received and transmitted per connector
- **Threads**: current count, busy count, max pool size per
  connector
- **Sessions**: active count, max allowed (per deployed context)
- **JVM** (with `jvm` target): heap and non-heap memory, GC
  count and duration, thread states, CPU utilization, class
  loading, buffer pools

Full metric reference:
[OTel Tomcat JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/tomcat.md)

## Access Setup

Tomcat exposes metrics via JMX (Java Management Extensions).
Enable remote JMX access by adding the following to `setenv.sh`
(or `CATALINA_OPTS` in your deployment):

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

Setting `rmi.port` to the same value as `port` prevents RMI
from using a random second port, which simplifies firewall and
Docker networking.

For Docker deployments, pass `CATALINA_OPTS` as an environment
variable and set `hostname` on the container:

```yaml showLineNumbers title="docker-compose.yaml (Tomcat service)"
tomcat:
  image: tomcat:10.1.42-jdk17-temurin
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

### With Authentication (Production)

For production environments, enable JMX authentication:

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

The JMX Scraper supports authenticated connections via
`OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD` environment
variables.

## Configuration

Tomcat monitoring uses two components: the JMX Scraper (connects
to Tomcat, exports OTLP) and the OTel Collector (receives OTLP,
ships to Scout).

```text
Tomcat (JMX:9010) ← JMX/RMI → JMX Scraper → OTLP → OTel Collector → Scout
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
java -jar opentelemetry-jmx-scraper-1.54.0-alpha.jar
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
    image: tomcat:10.1.42-jdk17-temurin
    hostname: tomcat
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
    environment:
      OTEL_JMX_SERVICE_URL: ${OTEL_JMX_SERVICE_URL}
      OTEL_JMX_TARGET_SYSTEM: ${OTEL_JMX_TARGET_SYSTEM}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: ${OTEL_METRIC_EXPORT_INTERVAL}
    depends_on:
      tomcat:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.120.0
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - tomcat
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check JMX Scraper logs for successful connection
docker logs tomcat-telemetry-jmx-scraper-1 2>&1 | head -10

# Verify Tomcat is running with JMX enabled
docker logs tomcat-telemetry-tomcat-1 2>&1 \
  | grep "jmxremote"

# Check Collector logs for Tomcat metrics
docker logs otel-collector 2>&1 \
  | grep "tomcat"
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach Tomcat's JMX port.

**Fix**:

1. Verify Tomcat is running:
   `docker ps | grep tomcat`
2. Confirm JMX is enabled — check for
   `-Dcom.sun.management.jmxremote` in Tomcat's startup args:
   `ps aux | grep jmxremote`
3. Verify the JMX port matches between Tomcat config and
   scraper's `OTEL_JMX_SERVICE_URL`
4. In Docker, ensure `hostname` is set on the Tomcat container
   and matches `-Djava.rmi.server.hostname`

### Only JVM metrics, no Tomcat metrics

**Cause**: The `OTEL_JMX_TARGET_SYSTEM` does not include
`tomcat`.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,tomcat` (both targets
   comma-separated)
2. Verify Tomcat has started fully — MBeans are only available
   after Catalina initializes

### Session metrics missing

**Cause**: Session metrics (`tomcat.session.active.count`,
`tomcat.session.active.limit`) only appear when at least one
web application is deployed.

**Fix**:

1. Deploy a web application to Tomcat — empty Tomcat instances
   with no contexts do not emit session metrics
2. Session MBeans are per-context
   (`Catalina:type=Manager,host=localhost,context=/myapp`)

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**Does this work with Tomcat running in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar container in the same pod.
Set `OTEL_JMX_SERVICE_URL` to `service:jmx:rmi:///jndi/rmi://
localhost:9010/jmxrmi` since both containers share the pod
network. No firewall rules needed for intra-pod communication.

**Can I use this with embedded Tomcat (Spring Boot)?**

Yes. Spring Boot's embedded Tomcat registers MBeans under the
`Tomcat:` domain instead of `Catalina:`. The JMX Scraper's
`tomcat` target system handles both domains automatically. Enable
JMX remote access on the Spring Boot app using the same
`-Dcom.sun.management.jmxremote.*` JVM flags.

**What happened to the OTel Collector JMX receiver?**

The `jmxreceiver` in the Collector was deprecated in January
2026. It required a JRE inside the Collector container and ran
a Java subprocess internally. The standalone JMX Scraper replaces
it — same metric definitions, cleaner operational model.

**How do I monitor multiple Tomcat instances?**

Run one JMX Scraper per Tomcat instance, each configured with
a different `OTEL_JMX_SERVICE_URL`. All scrapers export to the
same Collector:

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

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Nginx](./nginx.md),
  [PostgreSQL](./postgres.md),
  and other components
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
- [Cassandra Monitoring](./cassandra.md)
  — Another JMX-based monitoring setup
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on Tomcat metrics
