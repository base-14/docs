---
title: Debugging OpenTelemetry Pipelines
sidebar_label: Debugging OTel Pipelines
sidebar_position: 4
description:
  Systematic guide to debugging OpenTelemetry Collector pipelines. Use built-in
  diagnostic tools, internal metrics, and common failure pattern resolution.
keywords:
  [
    otel debugging,
    collector troubleshooting,
    debug exporter,
    zpages,
    health check,
    pipeline debugging,
    opentelemetry diagnostics,
    telemetry pipeline,
  ]
---

# Debugging OpenTelemetry Pipelines

Your observability pipeline itself needs observability. When telemetry data goes
missing, latencies spike, or the collector crashes, you need a systematic way to
diagnose the problem. The OpenTelemetry Collector ships with built-in diagnostic
tools that make this possible — you just need to know how to use them.

This guide covers the diagnostic toolkit available in every collector deployment
and walks through the most common failure scenarios with concrete fixes.

## Time to Complete

15-20 minutes

## The Diagnostic Toolkit

The collector includes four built-in tools for debugging. Each serves a different
purpose, and using them together gives you full visibility into pipeline behavior.

### Debug Exporter

The debug exporter prints telemetry data directly to the collector's console
output. Add it temporarily to any pipeline to inspect exactly what data is
flowing through.

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  debug:
    verbosity: detailed
    sampling_initial: 5
    sampling_thereafter: 200

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/b14, debug]
```

- `verbosity: detailed` prints the full contents of each span, metric, or log
  record including all attributes and resource information.
- `sampling_initial` and `sampling_thereafter` control how many items are logged
  to avoid flooding the console in high-throughput pipelines.

:::caution
Remove or disable the debug exporter before deploying to production. It writes
to stdout on every batch, which degrades performance and fills disk if logs are
persisted.
:::

### Internal Telemetry Metrics

The collector exposes its own metrics at `http://localhost:8888/metrics` in
Prometheus format by default. These metrics tell you exactly how much data is
entering and leaving each pipeline component.

```yaml showLineNumbers title="otel-collector-config.yaml"
service:
  telemetry:
    metrics:
      address: 0.0.0.0:8888
      level: detailed
```

Key metrics to monitor:

| Metric | What It Tells You |
|--------|-------------------|
| `otelcol_receiver_accepted_spans` | Spans successfully received — confirms data is arriving |
| `otelcol_receiver_refused_spans` | Spans rejected by the receiver — indicates format or protocol issues |
| `otelcol_exporter_sent_spans` | Spans successfully exported to the backend |
| `otelcol_exporter_send_failed_spans` | Export failures — backend unreachable or rejecting data |
| `otelcol_exporter_queue_size` | Current queue depth — rising values signal backpressure |
| `otelcol_exporter_queue_capacity` | Maximum queue capacity — compare with `queue_size` to detect overflow risk |
| `otelcol_processor_dropped_spans` | Spans dropped by processors — check filter or memory_limiter config |
| `otelcol_process_memory_rss` | Collector memory usage — track for OOM prevention |

Compare `receiver_accepted` against `exporter_sent` to find where data is being
lost. If the receiver accepts 1000 spans but the exporter only sends 800,
something in the processor chain is dropping 200.

```bash
curl -s http://localhost:8888/metrics | grep otelcol_exporter
```

### Health Check Extension

The health check extension exposes an HTTP endpoint that reports whether the
collector's pipelines are running. Use it for container liveness probes and
load balancer health checks.

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
    path: /health

service:
  extensions: [health_check]
```

```bash
curl http://localhost:13133/health
# Response: {"status":"Server available","upSince":"...","uptime":"..."}
```

In Kubernetes, wire this into your pod spec:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 13133
  initialDelaySeconds: 5
  periodSeconds: 10
```

### zPages Extension

zPages provides a browser-accessible debug UI for inspecting live pipeline data.
It is especially useful for examining traces flowing through the collector in
real time without adding an exporter.

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  zpages:
    endpoint: 0.0.0.0:55679

service:
  extensions: [zpages]
```

Navigate to these endpoints in your browser:

| Endpoint | Purpose |
|----------|---------|
| `/debug/servicez` | Overview of all active pipelines |
| `/debug/pipelinez` | Details on each pipeline's receivers, processors, exporters |
| `/debug/extensionz` | Status of enabled extensions |
| `/debug/tracez` | Live span samples grouped by latency buckets |

:::tip
zPages is safe for production but should be restricted to internal networks.
Do not expose port 55679 publicly.
:::

## Validating Configuration

Before debugging runtime issues, rule out configuration errors.

### Validate with the CLI

```bash
otelcol validate --config=/path/to/otel-collector-config.yaml
```

This checks for YAML syntax errors, unknown component names, and invalid field
values. A clean validation does not guarantee runtime success (e.g., the backend
may still reject connections), but it catches the most common mistakes.

### List Available Components

```bash
otelcol components
```

This lists every receiver, processor, exporter, and extension compiled into your
collector binary. If a component is missing, you need a different collector
distribution (e.g., `otelcol-contrib` for community components).

### Visual Validation

Use [otelbin.io](https://www.otelbin.io/) to paste your configuration and
visualize the pipeline graph. It highlights components that are defined but not
referenced in any pipeline — a common source of "silent" configuration errors.

## Common Failure Scenarios

### Data Disappearing Silently

**Symptom:** The receiver shows accepted spans, but they never reach the backend.

**Root cause:** The exporter's sending queue overflows under load. When the queue
is full, new data is dropped without error logs (by default).

**How to detect:**

```bash
curl -s http://localhost:8888/metrics | grep queue_size
```

If `otelcol_exporter_queue_size` equals `otelcol_exporter_queue_capacity`, data
is being dropped.

**Fix:** Increase queue size and add the memory_limiter as a safety net:

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp/b14:
    sending_queue:
      enabled: true
      queue_size: 5000
    retry_on_failure:
      enabled: true

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 70
    spike_limit_percentage: 30

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]
```

### Collector OOM Crashes

**Symptom:** The collector process is killed by the OS or container runtime with
an out-of-memory error.

**Root cause:** No memory_limiter processor, or it is not placed first in the
processor chain. High-cardinality metrics (metrics with many unique label
combinations) can also cause unbounded memory growth.

**How to detect:**

```bash
# Check container exit code (137 = OOM killed)
docker inspect --format='{{.State.ExitCode}}' otel-collector

# Check memory usage via internal metrics
curl -s http://localhost:8888/metrics | grep process_memory_rss
```

**Fix:** Add `memory_limiter` as the **first** processor in every pipeline. See
[Recommended Collector Configuration](recommended-collector-configuration.md)
for sizing guidance.

### Incomplete or Broken Traces

**Symptom:** Traces appear in the backend but are missing spans, or spans from
the same request show up as separate traces.

**Root cause:** Context propagation is broken. This typically happens when:

- An intermediate service does not propagate the `traceparent` header.
- Multiple collector instances are processing spans for the same trace, and
  they export to different backends or use different resource attributes.
- A load balancer strips or modifies trace context headers.

**How to detect:** Add the debug exporter to the pipeline and inspect the
`trace_id` and `parent_span_id` fields. Spans belonging to the same request
should share the same `trace_id`.

**Fix:**

- Verify all services propagate W3C Trace Context headers (`traceparent`,
  `tracestate`).
- If using multiple collectors, ensure they all export to the same backend
  with consistent resource attributes.
- Check reverse proxies and API gateways for header stripping.

### Export Failures

**Symptom:** The collector logs show repeated export errors, or
`otelcol_exporter_send_failed_spans` is rising.

**Root cause:** Common causes include:

| Error | Cause |
|-------|-------|
| `connection refused` | Backend is down or unreachable |
| `rpc error: code = Unauthenticated` | Missing or invalid credentials |
| `413 Request Entity Too Large` | Batch size exceeds backend limit |
| `context deadline exceeded` | Network timeout — backend too slow to respond |
| `unsupported protocol scheme` | gRPC exporter pointed at an HTTP endpoint (or vice versa) |

**Fix:**

- **Protocol mismatch:** Use `otlphttp` for HTTP/protobuf endpoints and `otlp`
  for gRPC endpoints. Check whether your backend expects `/v1/traces` (HTTP) or
  a gRPC service.
- **Auth errors:** Verify your credentials and ensure the `oauth2client` or
  `headers` configuration is correct.
- **413 errors:** Reduce `send_batch_max_size` in the batch processor:

```yaml
processors:
  batch:
    send_batch_max_size: 2000
```

### Silent Configuration Errors

**Symptom:** A component is defined in the config but has no effect.

**Root cause:** The component is declared in the top-level section (e.g.,
`processors:`) but not referenced in any pipeline under `service.pipelines`.

**How to detect:** The collector logs a warning at startup:

```text
service/service.go:xxx    "Processor \"attributes\" is not used in any pipeline"
```

Check logs carefully at startup, or use
[otelbin.io](https://www.otelbin.io/) to visualize which components are wired
into pipelines.

**Fix:** Add the component to the appropriate pipeline:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes, batch]
      exporters: [otlphttp/b14]
```

:::note
Processor ordering matters. Processors execute in the order they are listed.
Place `memory_limiter` first and `batch` last.
:::

## Connectivity Testing

Before investigating complex pipeline issues, confirm basic connectivity
between your application and the collector, and between the collector and the
backend.

### HTTP (OTLP/HTTP)

```bash
# Send an empty request to the OTLP HTTP receiver
curl -v http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{}'

# A 200 or 400 response confirms the collector is listening.
# "connection refused" means the collector is not running or the port is wrong.
```

### gRPC (OTLP/gRPC)

```bash
# List available gRPC services
grpcurl -plaintext localhost:4317 list

# Expected output includes:
# opentelemetry.proto.collector.trace.v1.TraceService
# opentelemetry.proto.collector.metrics.v1.MetricsService
# opentelemetry.proto.collector.logs.v1.LogsService
```

### Basic Port Check

```bash
# Verify the port is open
nc -zv localhost 4317
# or
telnet localhost 4317
```

## Load Testing with telemetrygen

Use `telemetrygen` to generate synthetic telemetry and validate your pipeline
end-to-end without deploying a real application. This is useful for verifying
new configurations, testing backpressure behavior, and benchmarking throughput.

```bash
# Generate 1000 test traces
docker run --rm --network host \
  ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  traces \
  --otlp-insecure \
  --traces 1000 \
  --otlp-endpoint localhost:4317
```

```bash
# Generate test metrics
docker run --rm --network host \
  ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:latest \
  metrics \
  --otlp-insecure \
  --metrics 500 \
  --otlp-endpoint localhost:4317
```

After running, check the internal metrics to confirm data flowed through:

```bash
curl -s http://localhost:8888/metrics | grep otelcol_receiver_accepted
```

## Production Debugging Checklist

Use this checklist to verify your collector is configured for reliable
production operation:

- [ ] `memory_limiter` is the **first** processor in every pipeline
- [ ] `batch` processor is configured with reasonable `send_batch_size` and
      `send_batch_max_size`
- [ ] `retry_on_failure` is enabled on all exporters
- [ ] `sending_queue` is enabled with a `queue_size` appropriate for your
      throughput
- [ ] `health_check` extension is enabled and wired to container health probes
- [ ] Internal telemetry metrics (`0.0.0.0:8888`) are being scraped by your
      monitoring system
- [ ] Collector resource limits are set (baseline: 2 CPU, 2 GB RAM) with
      25-30% headroom above observed usage
- [ ] Compression (`gzip`) is enabled on exporters sending data over the
      network
- [ ] Debug exporter is **not** active in production pipelines

## Related Guides

- [Recommended Collector Configuration](recommended-collector-configuration.md)
  — production settings for compression, batching, retries, and memory
  management
- [Troubleshooting Missing Data](../guides/troubleshooting-missing-data.md)
  — symptom-based flowchart for when telemetry data is not appearing
- [Scout Exporter](../instrument/collector-setup/scout-exporter.md)
  — configuring the Scout exporter for the collector
- [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md)
  — full collector configuration reference
