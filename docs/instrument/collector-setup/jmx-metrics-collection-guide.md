---
title: >
  JMX Monitoring with OpenTelemetry — JMX Scraper vs Prometheus JMX
  Exporter Comparison
sidebar_label: JMX Metrics Collection
id: jmx-metrics-collection-guide
sidebar_position: 9
description: >
  Compare the OpenTelemetry JMX Scraper and Prometheus JMX Exporter for
  collecting Java application metrics. Architecture, configuration, and
  deployment trade-offs for choosing the right approach.
keywords:
  - jmx monitoring opentelemetry
  - jmx scraper vs jmx exporter
  - opentelemetry jmx scraper
  - prometheus jmx exporter
  - java jmx monitoring
  - jmx mbean metrics opentelemetry
  - jmx opentelemetry collector
  - opentelemetry java metrics collection
tags: [jmx, opentelemetry, java, base14 scout]
---

# JMX Monitoring with OpenTelemetry

There are two ways to collect JMX metrics from Java applications with
OpenTelemetry: the
**[OTel JMX Scraper](https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/instrumentation/jmx-metrics)**
(a standalone process that connects remotely via RMI) and the
**[Prometheus JMX Exporter](https://github.com/prometheus/jmx_exporter)**
(a Java agent that runs inside the target JVM). Both convert JMX MBeans
into time-series metrics for the OpenTelemetry Collector. This guide
compares their architecture, configuration, and trade-offs so you can
choose the right approach for your environment.

**Short version**: Use the JMX Scraper if a
[built-in target](#which-components-have-built-in-jmx-scraper-targets)
exists for your application and you want an OTel-native pipeline with
no JVM modifications. Use the Prometheus JMX Exporter if you need
custom MBean rules, remote JMX is blocked, or you have existing
Prometheus tooling.

## How JMX Monitoring Works

JMX (Java Management Extensions) is a standard API built into every
JVM. Applications register managed objects called MBeans — structured
data points like `Catalina:type=ThreadPool,name="http-nio-8080"` — that
expose operational state: thread counts, request rates, memory usage,
cache hit ratios, and connection pool sizes. MBeans are available
through the JVM's built-in MBean server, either locally (same process)
or remotely (via RMI on a configured port).

Neither the JMX Scraper nor the JMX Exporter changes how MBeans work.
They simply read them and convert them into time-series metrics. The
Scraper connects remotely via RMI and exports OTLP directly. The
Exporter runs as a Java agent inside the target JVM and exposes a
Prometheus `/metrics` endpoint.

## Architecture Comparison

### OTel JMX Scraper

```text
┌─────────────┐    JMX/RMI     ┌──────────────┐    OTLP     ┌───────────┐          ┌───────┐
│  Java App   │◄───────────────│  JMX Scraper │────────────►│ Collector │─────────►│ Scout │
│  (JMX:9010) │                │  (standalone)│             │           │          │       │
└─────────────┘                └──────────────┘             └───────────┘          └───────┘
```

The JMX Scraper is a standalone Java process. It connects to the
application's JMX port over RMI, reads MBeans, and pushes metrics to
the Collector via OTLP.

### Prometheus JMX Exporter

```text
┌──────────────────────────┐  Prometheus    ┌───────────┐          ┌───────┐
│  Java App + JMX Agent    │  scrape        │ Collector │─────────►│ Scout │
│  (javaagent on :9404)    │◄───────────────│           │          │       │
│  exposes /metrics        │                └───────────┘          └───────┘
└──────────────────────────┘
```

The JMX Exporter runs as a `-javaagent` inside the target JVM. It reads
MBeans locally, converts them to Prometheus format, and serves them on
an HTTP endpoint. The Collector scrapes this endpoint with its
Prometheus receiver.

## Side-by-Side Comparison

| Aspect                  | OTel JMX Scraper                         | Prometheus JMX Exporter                        |
| ----------------------- | ---------------------------------------- | ---------------------------------------------- |
| **Deployment**          | Standalone Java process (sidecar or host) | Java agent inside the target JVM               |
| **Protocol**            | JMX/RMI to app, OTLP to Collector        | In-process MBean read, Prometheus HTTP to Collector |
| **Metric format**       | OTLP (native OpenTelemetry)              | Prometheus exposition format                   |
| **Config complexity**   | Low — env vars only, no config files     | Medium — requires YAML rules for MBean mapping |
| **Runtime overhead**    | Separate JVM for the scraper             | Runs in-process, no extra JVM                  |
| **Built-in targets**    | 8 targets: Tomcat, Kafka, ActiveMQ, Jetty, WildFly, Hadoop, Camel, JVM | 19 [example configs](https://github.com/prometheus/jmx_exporter/tree/main/examples): Cassandra, Kafka, Tomcat, Spark, Flink, ZooKeeper, and more |
| **Custom MBean rules**  | Supported via YAML config (`OTEL_JMX_CUSTOM_CONFIG`) | Full regex-based pattern matching     |
| **Networking**          | Requires JMX port accessible over network | Only needs HTTP port for Prometheus scrape     |
| **JVM modification**    | None — connects remotely                 | Requires `-javaagent` flag on target JVM       |
| **Authentication**      | Remote JMX auth via `OTEL_JMX_USERNAME`/`OTEL_JMX_PASSWORD`, supports SSL | Not needed — agent reads MBeans in-process, no remote connection |

## When to Use Which

Some applications — Tomcat, Kafka, ActiveMQ, WildFly — have both a
built-in Scraper target and an Exporter example config. When both are
available, prefer the **JMX Scraper**: it produces OTel-native metrics
out of the box, requires no config files, and doesn't touch the
application's JVM. Choose the Exporter instead only if you need to
expose MBeans the Scraper's built-in target doesn't cover, remote JMX
is blocked in your network, or your monitoring stack already consumes
Prometheus-format metrics.

### Use the OTel JMX Scraper When

The JMX Scraper is the better fit for most OTel-native deployments
where a built-in target covers your application.

- **A built-in target exists** for your application (Tomcat, Kafka,
  ActiveMQ, Jetty, WildFly, Hadoop, Camel). The scraper ships pre-defined metric
  definitions — no MBean pattern rules needed.
- **You want an OTel-native pipeline** — the scraper exports OTLP
  directly, avoiding a Prometheus-to-OTLP conversion step.
- **You cannot modify the target JVM** — the scraper connects remotely
  via RMI, so you only need JMX enabled on the application (no agent
  JAR to inject).
- **You prefer env-var-driven configuration** — no YAML config files
  needed for built-in targets.

### Use the Prometheus JMX Exporter When

The JMX Exporter is the better fit when you need full control over
MBean mapping or cannot expose a JMX port on the network.

- **Remote JMX access is blocked** — the exporter runs inside the JVM,
  bypassing network-level JMX restrictions. Only an HTTP port needs to
  be reachable.
- **You need custom MBean mapping** — the exporter's regex-based rules
  give full control over which MBeans are exported and how they're
  named and labeled.
- **You have existing Prometheus tooling** — if Grafana, alerting
  rules, or dashboards already consume Prometheus metrics, the exporter
  integrates without format conversion.
- **No built-in scraper target exists** for your application (e.g.,
  Cassandra, Solr, custom Java services).

## Minimal Configuration Examples

These snippets show the pattern for each approach. For complete
end-to-end setups, see the linked component guides.

### JMX Scraper (Tomcat Example)

```bash showLineNumbers title="Run the JMX Scraper"
OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://tomcat:9010/jmxrmi \
OTEL_JMX_TARGET_SYSTEM=jvm,tomcat \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317 \
OTEL_METRIC_EXPORT_INTERVAL=10000 \
java -jar opentelemetry-jmx-scraper-1.54.0-alpha.jar
```

```yaml showLineNumbers title="otel-collector.yaml (OTLP receiver)"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [otlphttp/b14]
```

Full setup: [Tomcat Monitoring](../component/tomcat.md)

### Prometheus JMX Exporter (Cassandra Example)

```bash showLineNumbers title="Add the agent to the target JVM"
JVM_EXTRA_OPTS="-javaagent:/opt/jmx_prometheus_javaagent.jar=9404:/opt/jmx-config.yaml"
```

```yaml showLineNumbers title="otel-collector.yaml (Prometheus receiver)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: cassandra
          scrape_interval: 30s
          static_configs:
            - targets:
                - cassandra:9404

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      exporters: [otlphttp/b14]
```

Full setup: [Cassandra Monitoring](../component/cassandra.md)

## What About the OTel Collector JMX Receiver?

The `jmxreceiver` component was deprecated in January 2026 and should
not be used for new deployments. It required a JRE installed inside the
Collector container and spawned a Java subprocess to connect to remote
JMX endpoints. The standalone
[JMX Scraper](https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/instrumentation/jmx-metrics)
replaces it with the same metric definitions and a cleaner operational
model — the scraper runs as its own process and exports metrics over
OTLP. If you are migrating from the `jmxreceiver`, the JMX Scraper
uses the same `target_system` values and metric names — switch by
running the scraper JAR with equivalent `OTEL_JMX_*` environment
variables and pointing it at your Collector's OTLP receiver.

## FAQ

### Can I use both approaches in the same environment?

Yes. Each approach feeds metrics into the Collector through a different
receiver (OTLP for the scraper, Prometheus for the exporter). You can
monitor Tomcat with the JMX Scraper and Cassandra with the JMX Exporter
in the same Collector pipeline. Define both receivers in the Collector
config and include them in the metrics pipeline.

### Which approach works better in Kubernetes?

Both work well in Kubernetes. The JMX Scraper runs as a sidecar
container in the same pod, connecting to `localhost:<jmx-port>`. The
JMX Exporter requires no sidecar — the agent runs inside the
application container, and the Collector scrapes the metrics endpoint
via the pod IP or service DNS. The exporter approach has a smaller
footprint since it avoids a second JVM, but the scraper approach avoids
modifying the application's JVM flags.

### Does the JMX Scraper support custom MBean rules?

Yes. Beyond built-in targets, the scraper accepts a YAML configuration
file with custom MBean rules via the `OTEL_JMX_CUSTOM_CONFIG`
environment variable. The rule format differs from the Prometheus JMX
Exporter — see the
[JMX Scraper documentation](https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/instrumentation/jmx-metrics)
for syntax details.

### Which components have built-in JMX Scraper targets?

As of version 1.54.0, the JMX Scraper includes built-in targets for
these eight systems:

| Target     | `OTEL_JMX_TARGET_SYSTEM` value | Metrics                                             |
| ---------- | ------------------------------ | --------------------------------------------------- |
| JVM        | `jvm`                          | Heap, GC, threads, CPU, class loading, buffer pools |
| Tomcat     | `tomcat`                       | Requests, errors, threads, sessions, network I/O    |
| Kafka      | `kafka-broker`                 | Broker topics, partitions, consumer lag, log flush   |
| ActiveMQ   | `activemq`                     | Queues, topics, connections, producers, consumers   |
| Jetty      | `jetty`                        | Requests, responses, threads, sessions              |
| WildFly    | `wildfly`                      | Undertow requests, datasource pools, transactions   |
| Hadoop     | `hadoop`                       | HDFS namenode, datanode, resource manager            |
| Camel      | `camel`                        | Routes, exchanges, processors, error handling       |

Each target defines a curated set of metrics without requiring custom
MBean rules. For applications not in this list, use the Prometheus JMX
Exporter or write custom scraper rules via `OTEL_JMX_CUSTOM_CONFIG`.

### What is the performance impact of each approach?

The JMX Scraper runs as a separate JVM, typically consuming 100-200 MB
of heap depending on the number of targets and MBeans collected. It
connects to the application's JMX port on each scrape interval, which
adds minimal network overhead but requires an open RMI connection.

The Prometheus JMX Exporter runs inside the application's JVM and adds
negligible memory overhead (the agent JAR itself is ~2 MB). It reads
MBeans directly from the in-process MBean server on each HTTP scrape
request — no network hop, no serialization. For most applications at
30-second scrape intervals, the CPU impact is not measurable. Large
deployments with thousands of MBeans (e.g., Cassandra with hundreds of
tables) should use exporter `blacklist` rules to limit cardinality.

## Related Guides

- [Tomcat Monitoring](../component/tomcat.md)
  — Full JMX Scraper setup for Apache Tomcat
- [ActiveMQ Monitoring](../component/activemq.md)
  — Full JMX Scraper setup for Apache ActiveMQ Classic
- [Jetty Monitoring](../component/jetty.md)
  — Full JMX Scraper setup for Eclipse Jetty
- [WildFly Monitoring](../component/wildfly.md)
  — Full JMX Scraper setup for WildFly / JBoss EAP
- [Cassandra Monitoring](../component/cassandra.md)
  — Full JMX Exporter setup for Apache Cassandra
- [OTel Collector Configuration](./otel-collector-config.md)
  — Advanced collector configuration
- [Docker Compose Setup](./docker-compose-example.md)
  — Run the Collector locally
