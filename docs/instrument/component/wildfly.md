---
title: >
  WildFly OpenTelemetry Monitoring - Undertow Requests, Datasource Pools,
  and Collector Setup
sidebar_label: WildFly
id: collecting-wildfly-telemetry
sidebar_position: 37
description: >
  Collect WildFly metrics with the OpenTelemetry JMX Scraper. Monitor
  Undertow request throughput, datasource connection pools, and
  transaction activity, and ship to base14 Scout.
keywords:
  - wildfly opentelemetry
  - wildfly otel collector
  - wildfly metrics monitoring
  - wildfly performance monitoring
  - opentelemetry jmx scraper wildfly
  - wildfly observability
  - jboss eap opentelemetry
  - wildfly undertow monitoring
  - wildfly jmx monitoring
  - wildfly telemetry collection
---

# WildFly

The OpenTelemetry JMX Scraper collects 14 WildFly-specific metrics and 19
JVM metrics from WildFly 26+ - Undertow request throughput, 5xx error
counts, request duration, datasource connection pools, transaction
activity, and HTTP session load. WildFly does not expose standard JMX/RMI;
it serves JMX through its management interface on port 9990 over the
`remote+http` protocol, so the scraper connects with the WildFly client
JAR on its classpath and pushes OTLP to the Collector. This guide
configures a management user, sets up the scraper with the correct JMX
URL, and ships metrics to base14 Scout.

## Prerequisites

| Requirement    | Minimum | Recommended    |
| -------------- | ------- | -------------- |
| WildFly        | 26      | 40.0.0.Final   |
| JMX Scraper    | 1.46.0  | 1.57.0-alpha   |
| Java (scraper) | 11      | 17             |
| OTel Collector | 0.90.0  | latest         |
| base14 Scout   | Any     | -              |

Before starting:

- WildFly's management interface (port 9990) must be reachable from the
  host running the JMX Scraper.
- A management-realm user is required for remote JMX access -
  unauthenticated access is not supported.
- The JMX Scraper needs `jboss-client.jar` on its classpath, copied from
  the matching WildFly version.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The metric names are defined by the JMX Scraper's `jvm,wildfly` target
rules, not by WildFly. Session metrics live on the Undertow deployment
MBean and only appear once a session-bearing application is deployed;
datasource metrics require a configured datasource.

### Core - is it up and serving

| Metric | What it tells you |
|---|---|
| `wildfly.request.count` | Requests served by the Undertow listener - the throughput KPI. |
| `jvm.memory.used` | JVM memory in use. JMX exposes no `up` metric, so heap-in-use doubles as the process-alive and heap-health anchor. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Errors | `wildfly.error.count` | Undertow requests that returned a 5xx response - the error-rate signal. |
| Latency | `wildfly.request.duration.sum` | Cumulative request-processing time; divide by request count for mean latency. |
| Throughput | `wildfly.network.io` | Bytes transmitted and received by the listener (`network.io.direction`). |
| Datasource pool | `wildfly.db.client.connection.count`, `wildfly.db.client.connection.wait.count` | Open connections (used/idle) and requests that had to wait for the pool. |
| Transactions | `wildfly.transaction.count`, `wildfly.transaction.created`, `wildfly.transaction.committed`, `wildfly.transaction.rollback` | In-flight, created, committed, and rolled-back transactions (rollbacks carry `wildfly.rollback.cause`). |
| Sessions | `wildfly.session.active.count`, `wildfly.session.rejected` | Currently active HTTP sessions and sessions dropped at the session limit. |
| JVM health | `jvm.memory.limit`, `jvm.cpu.recent_utilization`, `jvm.thread.count` | Heap ceiling (saturation denominator), recent process CPU, and live thread count (leak signal). |

`wildfly.session.active.limit` is whitelisted by the scraper but does not
emit: it maps to Undertow's `maxActiveSessions`, which defaults to `-1`
(unlimited), and the scraper rule drops negative values. It surfaces only
when a deployment configures a finite session limit.

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or capacity review,
not as paging signals.

| Group | Metrics | When you reach for it |
|---|---|---|
| Session lifecycle | `wildfly.session.created`, `wildfly.session.expired` | Session churn vs active count; expiry behaviour. |
| JVM memory detail | `jvm.memory.committed`, `jvm.memory.init`, `jvm.memory.used_after_last_gc` | GC effectiveness and committed-vs-used gap. |
| JVM class loading | `jvm.class.count`, `jvm.class.loaded`, `jvm.class.unloaded` | Classloader leaks after repeated redeploys. |
| JVM CPU / system | `jvm.cpu.count`, `jvm.cpu.time`, `jvm.system.cpu.load_1m`, `jvm.system.cpu.utilization` | Host vs process CPU attribution. |
| JVM buffers / descriptors | `jvm.buffer.count`, `jvm.buffer.memory.limit`, `jvm.buffer.memory.used`, `jvm.file_descriptor.count`, `jvm.file_descriptor.limit` | Direct-buffer pressure and fd usage against the ceiling. |

Full metric reference:
[OTel WildFly JMX Metrics](https://github.com/open-telemetry/opentelemetry-java-instrumentation/blob/main/instrumentation/jmx-metrics/library/wildfly.md).

## Key Alerts to Configure

Threshold guidance for the most useful Operational-tier series. These are
starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `rate(wildfly.error.count)` vs `rate(wildfly.request.count)` | Rising vs normal | Sustained climb | Application or upstream errors; inspect logs and failing endpoints. |
| `wildfly.request.duration.sum` / request count (mean) | Rising vs normal | Sustained climb | Slow request handling; check downstream calls and GC. |
| `wildfly.db.client.connection.wait.count` | > 0 sustained | Climbing | Pool too small or connections held too long; raise pool size or fix leaks. |
| `rate(wildfly.transaction.rollback)` vs `wildfly.transaction.committed` | Rising | Sustained climb | Failing transactions; inspect rollback cause (application/resource/system) and downstream resources. |
| `wildfly.session.rejected` | > 0 | Sustained > 0 | Session limit reached and sessions dropped; raise the limit or investigate session leaks. |
| `jvm.memory.used` / `jvm.memory.limit` | > 80% | Approaching limit | GC churn / OOM risk; raise heap or reduce allocation. |
| `jvm.cpu.recent_utilization` | High | Sustained high | Process CPU-bound; scale out or profile hot paths. |

## Access Setup

WildFly does **not** use standard JMX/RMI. It exposes JMX through its
management interface on port 9990 using the `remote+http` protocol, which
requires a management-realm user and the WildFly client JAR.

### Create a Management User

WildFly requires a management-realm user for remote JMX access:

```bash showLineNumbers title="Create a monitoring user"
$JBOSS_HOME/bin/add-user.sh -u otel-monitor -p <strong-password>
```

Authentication is mandatory - the scraper connects with
`OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`, and unauthenticated remote
JMX is not supported.

### Bind the Management Interface

WildFly binds the management interface to localhost by default. For Docker
or remote access, bind it to all interfaces:

```bash showLineNumbers title="Start WildFly with remote management"
$JBOSS_HOME/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0
```

For Docker, create the management user and bind the interface at startup:

```yaml showLineNumbers title="docker-compose.yaml (WildFly service)"
wildfly:
  image: quay.io/wildfly/wildfly:40.0.0.Final-jdk17
  hostname: wildfly
  container_name: wildfly
  command: >
    /bin/bash -c "
      /opt/jboss/wildfly/bin/add-user.sh -u monitor -p ${WILDFLY_MGMT_PASSWORD} --silent &&
      /opt/jboss/wildfly/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0
    "
  ports:
    - "8080:8080"
    - "9990:9990"
```

### Provide the WildFly Client JAR

The `remote+http` protocol requires `jboss-client.jar` on the scraper's
classpath. Copy it from a WildFly installation that matches the running
server's major version - a version-skewed client risks a fragile
`remote+http` JMX handshake:

```bash showLineNumbers title="Install the scraper JAR and WildFly client JAR"
sudo mkdir -p /opt/otel

# Download the JMX Scraper from Maven Central
curl -sL -o /opt/otel/opentelemetry-jmx-scraper-1.57.0-alpha.jar \
  https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/1.57.0-alpha/opentelemetry-jmx-scraper-1.57.0-alpha.jar

# Copy jboss-client.jar from a WildFly install matching the server's version
sudo cp $JBOSS_HOME/bin/client/jboss-client.jar /opt/otel/
```

## Configuration

WildFly monitoring uses two components: the JMX Scraper (connects to the
management interface, exports OTLP) and the OTel Collector (receives OTLP,
ships to Scout).

```text
WildFly (mgmt:9990) ← remote+http → JMX Scraper → OTLP → OTel Collector → Scout
```

### JMX Scraper

The WildFly JMX URL uses `remote+http`, **not** standard RMI. Set both the
`jvm` and `wildfly` target systems so the scraper emits the full surface:

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:remote+http://localhost:9990 \
OTEL_JMX_TARGET_SYSTEM=jvm,wildfly \
OTEL_JMX_USERNAME=${OTEL_JMX_USERNAME} \
OTEL_JMX_PASSWORD=${OTEL_JMX_PASSWORD} \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -cp /opt/otel/opentelemetry-jmx-scraper-1.57.0-alpha.jar:/opt/otel/jboss-client.jar \
  io.opentelemetry.contrib.jmxscraper.JmxScraper
```

Run it as a managed service with systemd:

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
ExecStart=/usr/bin/java -cp /opt/otel/opentelemetry-jmx-scraper-1.57.0-alpha.jar:/opt/otel/jboss-client.jar io.opentelemetry.contrib.jmxscraper.JmxScraper
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now otel-jmx-scraper
```

For Docker, build an image that bundles both the scraper JAR and a
`jboss-client.jar` copied from the matching WildFly image:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM quay.io/wildfly/wildfly:40.0.0.Final-jdk17 AS wildfly

FROM eclipse-temurin:17-jre

ARG SCRAPER_VERSION=1.57.0-alpha

ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar

COPY --from=wildfly /opt/jboss/wildfly/bin/client/jboss-client.jar /opt/jboss-client.jar

ENTRYPOINT ["java", "-cp", "/opt/scraper.jar:/opt/jboss-client.jar", "io.opentelemetry.contrib.jmxscraper.JmxScraper"]
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

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

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

A full working example with all three components:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  wildfly:
    image: quay.io/wildfly/wildfly:40.0.0.Final-jdk17
    hostname: wildfly
    container_name: wildfly
    command: >
      /bin/bash -c "
        /opt/jboss/wildfly/bin/add-user.sh -u monitor -p ${WILDFLY_MGMT_PASSWORD} --silent &&
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
    container_name: jmx-scraper
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
    image: otel/opentelemetry-collector-contrib:latest
    container_name: otel-collector
    volumes:
      - ./config/otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      - wildfly
```

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check the JMX Scraper connected over remote+http
docker logs jmx-scraper 2>&1 | head -10

# Confirm WildFly's management interface is up
docker logs wildfly 2>&1 | grep "management"

# Check Collector logs for WildFly metrics
docker logs otel-collector 2>&1 | grep "wildfly"
```

A steady-state scrape with traffic produces 28 component metrics (18
`jvm.*` plus 10 `wildfly.*`). Deploying a session-bearing application adds
the four `wildfly.session.*` metrics, for 32.

## Troubleshooting

### JMX connection refused

**Cause**: The scraper cannot reach WildFly's management interface.

**Fix**:

1. Verify WildFly is running: `docker ps | grep wildfly`.
2. Confirm the JMX URL uses `remote+http`, **not** `rmi`:
   `service:jmx:remote+http://wildfly:9990`.
3. Verify the management user exists - run `add-user.sh` if needed.
4. Confirm the management interface is bound to `0.0.0.0`
   (`-bmanagement 0.0.0.0`).
5. Verify `jboss-client.jar` is on the scraper's classpath.

### Only JVM metrics, no WildFly metrics

**Cause**: `OTEL_JMX_TARGET_SYSTEM` does not include `wildfly`, or the
scraper is missing `jboss-client.jar`.

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM=jvm,wildfly` (both targets, comma-separated).
2. Verify `jboss-client.jar` is on the classpath - without it the scraper
   may connect via fallback and see only JVM MBeans.
3. Confirm WildFly has started fully - MBeans appear only after the
   subsystems initialise.

### No session metrics

**Cause**: The five `wildfly.session.*` metrics live on the
`jboss.as:deployment=*,subsystem=undertow` MBean, which exists only once a
session-bearing application is deployed.

**Look at**: `wildfly.session.active.count` and the lifecycle metrics
`wildfly.session.created` / `wildfly.session.expired` - all zero or absent
until a `.war` with active session handling is deployed.

**Fix**:

1. Deploy a web application that calls `getSession()`.
2. Restart the scraper after the deploy so it re-discovers the new
   `deployment=*` MBean.

### No datasource metrics

**Cause**: `wildfly.db.client.connection.*` require a configured
datasource. The default `standalone.xml` includes `ExampleDS` (H2
in-memory).

**Fix**:

1. Verify a datasource is configured:
   `$JBOSS_HOME/bin/jboss-cli.sh --connect --command="/subsystem=datasources:read-resource"`.
2. Use `standalone-full.xml` for additional subsystems:
   `standalone.sh --server-config=standalone-full.xml`.

### Requests slow or transactions failing

**Cause**: Pool starvation, GC pressure, or failing downstream resources.

**Look at**: `wildfly.db.client.connection.wait.count` (requests queued on
the pool), `jvm.memory.used_after_last_gc` (heap retained after GC), and
`wildfly.transaction.rollback` by `wildfly.rollback.cause`
(application/resource/system) to attribute failures.

**Fix**:

1. Raise the datasource pool size or fix connection leaks if waits climb.
2. Raise heap or reduce allocation if post-GC heap stays high.
3. Inspect the rollback cause and the corresponding downstream resource.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and exporter.

## FAQ

**Does this work with JBoss EAP?**

Yes. JBoss EAP is based on WildFly and uses the same management interface
and JMX URL scheme. Use `service:jmx:remote+http://<eap-host>:9990` with a
management user created via `add-user.sh`.

**Can I use standard JMX RMI instead of `remote+http`?**

No. WildFly removed standard JMX/RMI access. All remote JMX goes through
the management interface using the `remote+http` protocol, which requires
`jboss-client.jar` on the connecting client's classpath.

**Does this work with WildFly in Kubernetes?**

Yes. Run the JMX Scraper as a sidecar container in the same pod and set
`OTEL_JMX_SERVICE_URL` to `service:jmx:remote+http://localhost:9990`. The
sidecar needs `jboss-client.jar` on its classpath - use the multi-stage
Dockerfile shown above.

**How do I get session metrics?**

Deploy a web application (`.war`) that creates HTTP sessions. The
`wildfly.session.*` metrics live on the Undertow deployment MBean, which
exists only once a session-bearing application is deployed. A default
WildFly install without applications produces Undertow, datasource, and
transaction metrics but no session metrics. Restart the scraper after
deploying so it picks up the new MBean.

**Why is `wildfly.session.active.limit` missing?**

It maps to Undertow's `maxActiveSessions`, which defaults to `-1`
(unlimited). The scraper drops negative values, so the metric only emits
once a deployment configures a finite session limit.

## Related Guides

- [JMX Metrics Guide](../collector-setup/jmx-metrics-collection-guide.md) -
  Compare the JMX Scraper and the JMX Exporter.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Tomcat Monitoring](./tomcat.md) - Another Java application server.
- [Jetty Monitoring](./jetty.md) - Another Java application server.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on WildFly metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Tomcat](./tomcat.md), [Jetty](./jetty.md), and other Java application
  servers.
- **Fine-tune Collection**: Adjust `OTEL_METRIC_EXPORT_INTERVAL` to control
  scrape frequency, and drop the Diagnostic tier in production to control
  volume while keeping it available for incident investigation.
