---
title: >
  Hadoop OpenTelemetry Monitoring - HDFS Block Health, Capacity,
  and Collector Setup
sidebar_label: Hadoop
id: collecting-hadoop-telemetry
sidebar_position: 51
description: >
  Collect Hadoop HDFS metrics with the OpenTelemetry JMX Scraper. Monitor
  DataNode liveness, block health, capacity, and NameNode JVM, then ship to
  base14 Scout.
keywords:
  - hadoop opentelemetry
  - hadoop otel collector
  - hdfs metrics monitoring
  - hadoop namenode monitoring
  - opentelemetry jmx scraper hadoop
  - hadoop observability
  - monitor hadoop kubernetes
  - hadoop telemetry collection
---

# Hadoop

The OpenTelemetry JMX Scraper connects to the HDFS NameNode over JMX and
collects 10 HDFS metrics plus 19 metrics from the NameNode JVM (29 total)
on Hadoop 3.x - DataNode liveness, missing and corrupt blocks, raw
capacity, volume failures, and NameNode JVM health - then pushes them over
OTLP to the Collector. HDFS keeps its state in
`FSNamesystem` MBeans with no Prometheus endpoint, so the scraper bridges
JMX to OTLP; the `hadoop` target reads the NameNode's
`Hadoop:service=NameNode,name=FSNamesystem(State)` MBeans and the `jvm`
target reads the NameNode JVM. This guide enables remote JMX on the
NameNode, runs the scraper, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum     | Recommended    |
| ---------------------- | ----------- | -------------- |
| Hadoop (HDFS)          | 3.0         | 3.4+           |
| OTel JMX Scraper       | 1.51.0-alpha | 1.57.0-alpha  |
| OTel Collector Contrib | 0.90.0      | 0.153.0        |
| base14 Scout           | Any         | -              |

Before starting:

- The HDFS NameNode must expose remote JMX over RMI, reachable from the
  host running the scraper (see [Access Setup](#access-setup)).
- A JRE 17+ to run the scraper JAR, or Docker to run it in a container.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an incident
or capacity review.

The `hadoop` target reads NameNode `FSNamesystem` state only - one
DataNode registered reports `hadoop.datanode.live = 1`. YARN /
ResourceManager and per-DataNode MBeans are out of scope for this target.

### Core - is it up and storing data

| Metric | What it tells you |
|---|---|
| `hadoop.datanode.live` | Live DataNodes. HDFS exposes no JMX `up` metric, so this is the cluster-alive anchor - is the filesystem backed by storage. |
| `jvm.memory.used` | NameNode JVM memory in use; the process-alive and heap-health anchor. |

### Operational - what to alert on

| Metric | What it tells you |
|---|---|
| `hadoop.datanode.dead` | Dead DataNodes - lost storage and replication risk. |
| `hadoop.dfs.block.missing` | Missing blocks - blocks under-replicated to zero, i.e. data-loss risk. |
| `hadoop.dfs.block.corrupt` | Blocks with corrupt replicas. |
| `hadoop.dfs.capacity.used` | Used raw capacity across DataNodes. |
| `hadoop.dfs.capacity.limit` | Total raw capacity - the saturation denominator against used. |
| `hadoop.dfs.volume.failure.count` | DataNode volume (disk) failures cluster-wide. |
| `jvm.memory.limit` | NameNode heap ceiling - the saturation denominator against used. |
| `jvm.cpu.recent_utilization` | Recent NameNode process CPU utilization. |
| `jvm.thread.count` | Total live NameNode JVM threads - a leak signal. |

### Diagnostic - for investigation and tuning

Higher cardinality and internals you reach for during an investigation or
a capacity review, not signals you page on. In production you can drop
this tier with a `filter` processor and keep Core + Operational.

| Group | Metrics | When you reach for it |
|---|---|---|
| HDFS namespace / scale | `hadoop.dfs.block.count` (total allocated blocks), `hadoop.dfs.file.count` (files + directories, drives NameNode heap), `hadoop.dfs.connection.count` (current client connections) | Small-file growth and NameNode heap sizing. |
| JVM memory detail | `jvm.memory.committed`, `jvm.memory.init`, `jvm.memory.used_after_last_gc` | Heap behaviour around GC. |
| JVM class loading | `jvm.class.count`, `jvm.class.loaded`, `jvm.class.unloaded` | Class-loader churn. |
| JVM CPU / system | `jvm.cpu.count`, `jvm.cpu.time`, `jvm.system.cpu.load_1m`, `jvm.system.cpu.utilization` | Host-level CPU pressure on the NameNode. |
| JVM buffers / descriptors | `jvm.buffer.count`, `jvm.buffer.memory.limit`, `jvm.buffer.memory.used`, `jvm.file_descriptor.count`, `jvm.file_descriptor.limit` | Direct-buffer and file-descriptor exhaustion. |

The `hadoop` target covers NameNode `FSNamesystem` state; it does not
expose per-request latency or per-DataNode breakdowns. Those live in the
NameNode / DataNode logs or in YARN application metrics, not in this set.

Full metric reference:
[OTel JMX Scraper - Hadoop target](https://github.com/open-telemetry/opentelemetry-java-contrib/tree/main/jmx-scraper).

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series. These
are starting points; tune them to your workload.

| Metric | Warning | Critical | Why it matters |
|---|---|---|---|
| `hadoop.dfs.block.missing` | > 0 | Rising | Data loss - blocks with no live replica. Investigate dead DataNodes and run `hdfs fsck`. |
| `hadoop.dfs.block.corrupt` | > 0 | Rising | Replica corruption; check DataNode disks and trigger re-replication. |
| `hadoop.datanode.dead` | > 0 | Rising | DataNodes lost from the cluster - storage and replication capacity gone; the NameNode re-replicates affected blocks. Restore or replace the node. |
| `hadoop.dfs.capacity.used` vs `hadoop.dfs.capacity.limit` | Approaching limit | Near limit | Filesystem filling; add DataNodes or reclaim space before writes fail. |
| `hadoop.dfs.volume.failure.count` | > 0 | Rising | Failing DataNode disks; replace media and rebalance. |
| `jvm.memory.used` vs `jvm.memory.limit` | Approaching limit | Near limit | NameNode heap scales with namespace size; GC churn / OOM risk - raise heap or reduce the small-file count. |

## Access Setup

Hadoop does not expose a Prometheus endpoint. The NameNode publishes its
state through JMX MBeans, and the OpenTelemetry JMX Scraper reads them over
remote JMX (RMI), then pushes OTLP to the Collector.

### 1. Enable remote JMX on the NameNode

Add the JMX-agent flags to `HDFS_NAMENODE_OPTS` so the NameNode opens an
RMI registry on a fixed port (1026 here). Set
`java.rmi.server.hostname` to the address the scraper will dial:

```bash showLineNumbers title="NameNode JMX flags (hadoop-env.sh or env file)"
HDFS_NAMENODE_OPTS="-Dcom.sun.management.jmxremote \
  -Dcom.sun.management.jmxremote.port=1026 \
  -Dcom.sun.management.jmxremote.rmi.port=1026 \
  -Dcom.sun.management.jmxremote.local.only=false \
  -Dcom.sun.management.jmxremote.authenticate=false \
  -Dcom.sun.management.jmxremote.ssl=false \
  -Djava.rmi.server.hostname=namenode"
```

The flags above open unauthenticated JMX, which is appropriate only on a
trusted network. In production, enable JMX authentication and TLS
(`jmxremote.authenticate=true`, `jmxremote.ssl=true`) and restrict the
RMI port with firewall rules; the scraper's `OTEL_JMX_*` settings carry
the matching credentials.

### 2. Run the JMX Scraper

The scraper is a single JAR. Point `OTEL_JMX_SERVICE_URL` at the
NameNode's RMI registry, set the target systems to `jvm,hadoop`, and send
OTLP to the Collector:

```dockerfile showLineNumbers title="jmx-scraper/Dockerfile"
FROM eclipse-temurin:17-jre
ARG SCRAPER_VERSION=1.57.0-alpha
ADD https://repo1.maven.org/maven2/io/opentelemetry/contrib/opentelemetry-jmx-scraper/${SCRAPER_VERSION}/opentelemetry-jmx-scraper-${SCRAPER_VERSION}.jar /opt/scraper.jar
ENTRYPOINT ["java", "-jar", "/opt/scraper.jar"]
```

```yaml showLineNumbers title="docker-compose.yaml (scraper service)"
services:
  jmx-scraper:
    build: ./jmx-scraper
    environment:
      OTEL_JMX_SERVICE_URL: service:jmx:rmi:///jndi/rmi://namenode:1026/jmxrmi
      OTEL_JMX_TARGET_SYSTEM: jvm,hadoop          # NameNode JVM + HDFS FSNamesystem
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
      OTEL_METRIC_EXPORT_INTERVAL: 10000          # milliseconds
    depends_on:
      namenode:
        condition: service_healthy
```

The scraper logs a benign `SASL unsupported in current environment`
WARNING at connect time when JMX auth is off; it then connects over
unauthenticated JMX and scrapes normally. This is not an error.

## Configuration

The scraper pushes OTLP/gRPC to the Collector. The Collector receives it on
the `otlp` receiver and forwards it to Scout:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317   # The scraper's OTEL_EXPORTER_OTLP_ENDPOINT

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
`filter` processor while keeping the Core and Operational series:

```yaml showLineNumbers title="config/otel-collector.yaml (filter)"
processors:
  filter/diagnostic:
    metrics:
      exclude:
        match_type: regexp
        metric_names:
          - hadoop\.dfs\.(block|file|connection)\.count
          - jvm\.memory\.(committed|init|used_after_last_gc)
          - jvm\.class\..*
          - jvm\.cpu\.(count|time)
          - jvm\.system\..*
          - jvm\.buffer\..*
          - jvm\.file_descriptor\..*
```

Add `filter/diagnostic` to the `processors` list in the metrics pipeline.

### Environment Variables

```bash showLineNumbers title=".env"
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable in v1.40.0). The
> legacy `deployment.environment` is still accepted by Scout for backward
> compatibility, but new configs should emit the dotted form.

## Verify the Setup

Start the scraper and Collector, then confirm metrics flow within 60
seconds:

```bash showLineNumbers title="Verify metrics collection"
# Confirm the scraper connected and is exporting (no connection errors)
docker logs jmx-scraper 2>&1 | grep -i "otlp\|export\|hadoop"

# Check the Collector received Hadoop metrics (requires a debug exporter)
docker logs otel-collector 2>&1 | grep -i "hadoop"

# Generate namespace activity so the HDFS gauges advance
docker exec namenode hdfs dfs -mkdir -p /demo
docker exec namenode bash -c 'echo hello | hdfs dfs -put - /demo/probe.txt'
```

The Collector log check needs a `debug` exporter in the pipeline; the
production config above ships only `otlphttp/b14`, so confirm delivery in
Scout instead, or add `debug` to the metrics pipeline while testing.
`hadoop.dfs.file.count` and `hadoop.dfs.block.count` should advance after
the write; `hadoop.datanode.live` reads `1` once a DataNode registers.

## Troubleshooting

### Scraper cannot connect to the NameNode

**Cause**: Remote JMX is not enabled, the port is wrong, or
`java.rmi.server.hostname` does not resolve from the scraper.

**Fix**:

1. Confirm the JMX flags are on `HDFS_NAMENODE_OPTS` and the NameNode
   restarted: `docker exec namenode bash -c 'ps aux | grep jmxremote'`.
2. Verify `OTEL_JMX_SERVICE_URL` host and port match the
   `jmxremote.port` / `rmi.port` values.
3. Set `java.rmi.server.hostname` to a name the scraper can resolve - RMI
   hands the client a stub pointing at this hostname.

### Only `jvm.*` metrics appear, no `hadoop.*` metrics

**Cause**: `OTEL_JMX_TARGET_SYSTEM` is missing the `hadoop` target, or the
scraper is connected to a node without the `FSNamesystem` MBeans (a
DataNode rather than the NameNode).

**Fix**:

1. Set `OTEL_JMX_TARGET_SYSTEM: jvm,hadoop`.
2. Point the service URL at the NameNode - the `hadoop` target reads
   `Hadoop:service=NameNode,name=FSNamesystem(State)` MBeans, which only
   the NameNode exposes.

### Capacity or namespace gauges read zero

**Cause**: The cluster is idle, or no DataNode has registered.

**Look at**: the Diagnostic `hadoop.dfs.file.count` and
`hadoop.dfs.connection.count` series - both sit at zero on an idle
NameNode with no client connections. `hadoop.dfs.capacity.used` stays
near zero until data is written.

**Fix**:

1. Confirm a DataNode is up: `hadoop.datanode.live` should be ≥ 1.
2. Write a file to HDFS (`hdfs dfs -put`) so the namespace, block, and
   capacity gauges advance.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the `otlp` receiver and the
   `otlphttp/b14` exporter.

## FAQ

**Why use the JMX Scraper instead of the OTel JMX receiver?**

The JMX Scraper is a standalone process - it connects to the NameNode's
JMX endpoint over RMI and pushes OTLP, so the Collector needs no JRE
inside its container. The `hadoop` target ships predefined rules
(`jmx/rules/hadoop.yaml`) that map `FSNamesystem` MBeans to stable metric
names, so you do not write pattern rules by hand.

**Does this work with Hadoop running in Kubernetes?**

Yes. Enable remote JMX on the NameNode pod, then run the scraper as a
sidecar or a separate Deployment with `OTEL_JMX_SERVICE_URL` pointing at
the NameNode service DNS
(e.g., `service:jmx:rmi:///jndi/rmi://namenode.hadoop.svc.cluster.local:1026/jmxrmi`).
Inject JMX credentials via a Kubernetes secret when auth is enabled.

**Does the scraper collect YARN or ResourceManager metrics?**

No. The `hadoop` target reads NameNode `FSNamesystem` state only - HDFS
storage health and namespace scale. YARN / ResourceManager and
per-DataNode MBeans are out of scope for this target.

**Why is request latency missing from the metrics?**

The `hadoop` target exposes `FSNamesystem` gauges and counters, not
per-request timing. Operation latency lives in the NameNode / DataNode
logs or in the HDFS audit log, not in this metric surface.

## Related Guides

- [JMX Metrics Collection Guide](../collector-setup/jmx-metrics-collection-guide.md)
  - Compare the JMX Scraper and the JMX Exporter.
- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [ZooKeeper Monitoring](./zookeeper.md) - A common companion coordination
  service.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  Hadoop metrics.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [ZooKeeper](./zookeeper.md), [Kafka](./kafka.md), and other components.
- **Fine-tune Collection**: Drop the Diagnostic tier in production with a
  `filter` processor to control volume; keep it available for incident
  investigation.
