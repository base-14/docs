---
title: >
  WildFly OpenTelemetry Monitoring — Undertow Requests, Datasource Pools,
  and Collector Setup
sidebar_label: WildFly
id: collecting-wildfly-telemetry
sidebar_position: 37
description: >
  Collect WildFly metrics with the OpenTelemetry JMX Scraper. Monitor
  Undertow requests, datasource connections, and transaction counts
  using JMX and export to base14 Scout.
keywords:
  - wildfly opentelemetry
  - wildfly otel collector
  - wildfly metrics monitoring
  - wildfly performance monitoring
  - opentelemetry jmx scraper wildfly
  - wildfly observability
  - jboss eap opentelemetry
  - jboss eap monitoring
  - wildfly undertow monitoring
  - wildfly jmx monitoring
---

# WildFly

The OpenTelemetry JMX Scraper collects 15 WildFly-specific metrics
and 18 JVM metrics from WildFly 26+, including Undertow request
throughput, error counts, datasource connection pools, and
transaction activity. WildFly uses a non-standard JMX protocol
(`remote+http`) through its management interface instead of
standard JMX/RMI — the scraper connects via port 9990 using the
WildFly client libraries. This guide configures a management user,
sets up the scraper with the correct JMX URL, and ships metrics to
base14 Scout.

## Prerequisites

| Requirement    | Minimum | Recommended |
| -------------- | ------- | ----------- |
| WildFly        | 26      | 34+         |
| JMX Scraper    | 1.46.0  | 1.54.0+     |
| Java (scraper) | 11      | 17+         |
| OTel Collector | 0.90.0  | latest      |
| base14 Scout   | Any     | —           |

Before starting:

- WildFly's management interface (port 9990) must be accessible
  from the host running the JMX Scraper
- A management user is required for remote JMX access
- The JMX Scraper needs `jboss-client.jar` on its classpath
  (copied from WildFly)
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Undertow (web)**: request count, error count (5xx), request
  duration sum, network I/O bytes
- **Sessions**: active count, active limit, created, expired,
  rejected
- **Datasource**: connection count, connection wait count
- **Transactions**: in-flight count, created, committed,
  rolled back
- **JVM** (with `jvm` target): heap and non-heap memory, GC
  count and duration, thread states, CPU utilization, class
  loading, buffer pools

Session metrics require a deployed web application. Datasource
metrics require a configured datasource. The default
`standalone.xml` profile includes Undertow and transaction
subsystems.

Full metric reference:
[OTel WildFly JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/wildfly.md)

## Access Setup

WildFly does **not** use standard JMX/RMI. It exposes JMX through
its management interface on port 9990 using the `remote+http`
protocol. This requires a management user and the WildFly client
JAR.

### Create a Management User

WildFly requires a management realm user for remote JMX access:

```bash showLineNumbers title="Create management user"
$JBOSS_HOME/bin/add-user.sh -u monitor -p <secure-password>
```

### Enable Remote Management

WildFly's management interface is bound to localhost by default.
For Docker or remote access, bind to all interfaces:

```bash showLineNumbers title="Start WildFly with remote management"
$JBOSS_HOME/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0
```

For Docker deployments, create the management user at startup
and bind the management interface:

```yaml showLineNumbers title="docker-compose.yaml (WildFly service)"
wildfly:
  image: quay.io/wildfly/wildfly:34.0.1.Final-jdk17
  hostname: wildfly
  command: >
    /bin/bash -c "
      /opt/jboss/wildfly/bin/add-user.sh -u monitor -p Monitor1! --silent &&
      /opt/jboss/wildfly/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0
    "
  ports:
    - "8080:8080"
    - "9990:9990"
```

### With Authentication (Production)

WildFly always requires authentication for remote JMX. For
production, use a strong password and restrict management access:

```bash showLineNumbers title="Create a dedicated monitoring user"
$JBOSS_HOME/bin/add-user.sh -u otel-monitor -p <strong-password> -g Monitor
```

The JMX Scraper connects using `OTEL_JMX_USERNAME` and
`OTEL_JMX_PASSWORD` environment variables. These are
**required** for WildFly — unauthenticated access is not
supported.

## Configuration

WildFly monitoring uses two components: the JMX Scraper (connects
to WildFly's management interface, exports OTLP) and the OTel
Collector (receives OTLP, ships to Scout).

```text
WildFly (mgmt:9990) ← remote+http → JMX Scraper → OTLP → OTel Collector → Scout
```

### JMX Scraper

The WildFly JMX URL uses `remote+http`, **not** standard RMI:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:remote+http://localhost:9990 \
OTEL_JMX_TARGET_SYSTEM=jvm,wildfly \
OTEL_JMX_USERNAME=monitor \
OTEL_JMX_PASSWORD=<password> \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -cp opentelemetry-jmx-scraper-1.54.0-alpha.jar:jboss-client.jar \
  io.opentelemetry.contrib.jmxscraper.JmxScraper
```

The `remote+http` protocol requires `jboss-client.jar` on the
classpath. Copy it from your WildFly installation:

```bash showLineNumbers title="Copy the WildFly client JAR"
sudo mkdir -p /opt/otel
sudo cp $JBOSS_HOME/bin/client/jboss-client.jar /opt/otel/
sudo mv opentelemetry-jmx-scraper-1.54.0-alpha.jar /opt/otel/
```

Create a systemd service to run the scraper as a managed service:

```bash showLineNumbers title="/etc/systemd/system/otel-jmx-scraper.service"
sudo tee /etc/systemd/system/otel-jmx-scraper.service > /dev/null <<'EOF'
[Unit]
Description=OpenTelemetry JMX Scraper for WildFly
After=network.target wildfly.service

[Service]
Type=simple
Environment=OTEL_JMX_SERVICE_URL=service:jmx:remote+http://localhost:9990
Environment=OTEL_JMX_TARGET_SYSTEM=jvm,wildfly
Environment=OTEL_JMX_USERNAME=monitor
Environment=OTEL_JMX_PASSWORD=<password>
Environment=OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
Environment=OTEL_METRIC_EXPORT_INTERVAL=10000
ExecStart=/usr/bin/java -cp /opt/otel/opentelemetry-jmx-scraper-1.54.0-alpha.jar:/opt/otel/jboss-client.jar io.opentelemetry.contrib.jmxscraper.JmxScraper
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

For Docker, build an image that includes both the scraper JAR
and `jboss-client.jar`. A multi-stage build copies the client
JAR from the WildFly image:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM quay.io/wildfly/wildfly:34.0.1.Final-jdk17 AS wildfly

FROM eclipse-temurin:17-jre

ARG SCRAPER_VERSION=1.54.0-alpha

ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar

COPY --from=wildfly /opt/jboss/wildfly/bin/client/jboss-client.jar /opt/jboss-client.jar

ENTRYPOINT ["java", "-cp", "/opt/scraper.jar:/opt/jboss-client.jar", "io.opentelemetry.contrib.jmxscraper.JmxScraper"]
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
OTEL_JMX_SERVICE_URL=service:jmx:remote+http://wildfly:9990
OTEL_JMX_TARGET_SYSTEM=jvm,wildfly
OTEL_JMX_USERNAME=monitor
OTEL_JMX_PASSWORD=your_password
OTEL_METRIC_EXPORT_INTERVAL=10000

# OTel Collector
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Docker Compose

Full working example with all three components:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  wildfly:
    image: quay.io/wildfly/wildfly:34.0.1.Final-jdk17
    hostname: wildfly
    command: >
      /bin/bash -c "
        /opt/jboss/wildfly/bin/add-user.sh -u monitor -p Monitor1! --silent &&
        /opt/jboss/wildfly/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0
      "
    ports:
      - "8080:8080"
      - "9990:9990"
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
      OTEL_JMX_USERNAME: ${OTEL_JMX_USERNAME}
      OTEL_JMX_PASSWORD: ${OTEL_JMX_PASSWORD}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: ${OTEL_METRIC_EXPORT_INTERVAL}
    depends_on:
      wildfly:
        condition: service_healthy

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.120.0
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - wildfly
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check JMX Scraper logs for successful connection
docker logs wildfly-telemetry-jmx-scraper-1 2>&1 | head -10

# Verify WildFly management interface is accessible
docker logs wildfly 2>&1 \
  | grep "management"

# Check Collector logs for WildFly metrics
docker logs otel-collector 2>&1 \
  | grep "wildfly"
```

## Troubleshooting

### JMX connection refused

**Cause**: The JMX Scraper cannot reach WildFly's management
interface.

**Fix**:

1. Verify WildFly is running:
   `docker ps | grep wildfly`
2. Confirm the JMX URL uses `remote+http`, **not** `rmi`:
   `service:jmx:remote+http://wildfly:9990`
3. Verify the management user exists — run `add-user.sh`
   if needed
4. Confirm the management interface is bound to `0.0.0.0`
   (`-bmanagement 0.0.0.0`)
5. Verify `jboss-client.jar` is on the scraper's classpath

### Only JVM metrics, no WildFly metrics

**Cause**: The `OTEL_JMX_TARGET_SYSTEM` does not include
`wildfly`, or the scraper is missing `jboss-client.jar`.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,wildfly` (both targets
   comma-separated)
2. Verify `jboss-client.jar` is on the classpath — without it,
   the scraper may connect via fallback but only see JVM MBeans
3. Verify WildFly has started fully — MBeans are only available
   after subsystems initialize

### No datasource metrics

**Cause**: Datasource metrics require a configured datasource in
WildFly. The default `standalone.xml` includes `ExampleDS`
(H2 in-memory).

**Fix**:

1. Verify a datasource is configured:
   `$JBOSS_HOME/bin/jboss-cli.sh --connect --command="/subsystem=datasources:read-resource"`
2. Use `standalone-full.xml` for additional subsystems:
   `standalone.sh --server-config=standalone-full.xml`

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors:
   `docker logs otel-collector`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Confirm the pipeline includes both the receiver and exporter

## FAQ

**Does this work with JBoss EAP?**

Yes. JBoss EAP is based on WildFly and uses the same management
interface and JMX URL scheme. Use
`service:jmx:remote+http://<eap-host>:9990` with a management
user created via `add-user.sh`.

**Can I use standard JMX RMI instead of remote+http?**

No. WildFly removed standard JMX RMI access. All remote JMX goes
through the management interface using the `remote+http` protocol.
This requires `jboss-client.jar` on the connecting client's
classpath.

**Does this work with WildFly in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar container in the same pod.
Set `OTEL_JMX_SERVICE_URL` to
`service:jmx:remote+http://localhost:9990`. The sidecar needs
`jboss-client.jar` on its classpath — use the multi-stage
Dockerfile shown above.

**How do I get session metrics?**

Deploy a web application (`.war`) to WildFly. Session metrics
(`wildfly.session.active.count`, `wildfly.session.created`,
`wildfly.session.expired`) only appear for deployed applications
with active session handling. The default WildFly installation
without applications produces Undertow, datasource, and
transaction metrics but not session metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build
  your own. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Monitor More Components**: Add monitoring for
  [Tomcat](./tomcat.md),
  [Jetty](./jetty.md),
  and other Java application servers
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
- [Tomcat Monitoring](./tomcat.md)
  — Another Java application server setup
- [Jetty Monitoring](./jetty.md)
  — Another Java application server setup
- [Creating Alerts](../../guides/creating-alerts-with-logx.md)
  — Alert on WildFly metrics
