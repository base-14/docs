---
slug: production-ready-otel-collector
date: 2026-02-13
title: "Production-Ready OpenTelemetry: Configure, Harden, and Debug Your Collector"
description: "A practical guide to taking the OpenTelemetry Collector from default settings to production-grade. Covers hardening, self-monitoring, failure diagnosis, and validation."
authors: [ranjan-sakalley]
tags:
  [opentelemetry, observability, collector, debugging, production, best-practices]
---

The OpenTelemetry Collector works out of the box with minimal configuration.
You point a receiver at port 4317, wire up an exporter, and telemetry
flows. In development, this is sufficient. In production, it is not.

Default settings ship without memory limits, without retry logic, without
queue sizing, and without any self-monitoring. The collector will accept
data until it runs out of memory, drop data silently when the queue fills
up, and give you no signal that anything went wrong. These failures surface
as gaps in your dashboards hours or days later, when the context to
diagnose them is gone.

This post covers the practical steps to close that gap: hardening the
collector's configuration, enabling its built-in diagnostic tools, and
diagnosing the failure patterns that show up most often in production.

<!--truncate-->

## Hardening the Collector

Four configuration areas address the most common production failures:
compression, batching, retries, and memory limiting.

### Compression

Enabling `gzip` on exporters reduces the data volume sent over the network.
This is especially relevant when the collector sends data over the public
internet, where bandwidth costs accumulate and high-latency links benefit
from smaller payloads.

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp:
    endpoint: https://your-backend.example.com/otlp
    compression: gzip
```

### Batch Processor

The batch processor groups telemetry into batches before forwarding to
exporters. Sending individual spans or metrics one at a time creates
excessive network overhead and puts unnecessary load on the backend.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  batch:
    timeout: 2s
    send_batch_size: 8192
    send_batch_max_size: 10000
```

`timeout` controls how long the processor waits before sending a
partially-filled batch. `send_batch_size` is the target batch size, and
`send_batch_max_size` is the upper bound that triggers an immediate send.

### Retry Mechanism

The `retry_on_failure` setting configures the exporter to automatically
retry failed sends. Without this, a transient network issue or a brief
backend restart causes permanent data loss for any in-flight batches.

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp:
    retry_on_failure:
      enabled: true
      initial_interval: 2s
      max_interval: 10s
      max_elapsed_time: 60s
```

The retry uses exponential backoff starting at `initial_interval`, capping
at `max_interval`, and giving up after `max_elapsed_time`.

### Memory Limiter

The `memory_limiter` processor monitors the collector's memory usage and
applies backpressure when it approaches a configured threshold. Without it,
a traffic spike or a slow backend can cause the collector to consume all
available memory and get killed by the OS or container runtime.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 70
    spike_limit_percentage: 30
```

The memory limiter must be the **first** processor in every pipeline. If
it comes after the batch processor, data has already been buffered before
the limiter can act.

### Full Hardened Configuration

Putting it all together:

```yaml showLineNumbers title="otel-collector-config.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 70
    spike_limit_percentage: 30
  batch:
    timeout: 2s
    send_batch_size: 8192
    send_batch_max_size: 10000

exporters:
  otlphttp:
    endpoint: https://your-backend.example.com/otlp
    compression: gzip
    retry_on_failure:
      enabled: true
      initial_interval: 2s
      max_interval: 10s
      max_elapsed_time: 60s
    sending_queue:
      enabled: true
      queue_size: 5000

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
```

Note the processor ordering: `memory_limiter` first, `batch` last.

## Making the Collector Observable

The collector includes built-in diagnostic tools that expose what is
happening inside the pipeline. Enabling them before you need them is the
difference between a 5-minute diagnosis and a multi-hour investigation.

### Debug Exporter

The debug exporter prints telemetry data to the collector's stdout. Add it
to any pipeline temporarily to see exactly what data is flowing through.

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
      processors: [memory_limiter, batch]
      exporters: [otlphttp, debug]
```

`verbosity: detailed` prints the full span/metric/log record including all
attributes and resource information. The `sampling_initial` and
`sampling_thereafter` fields control output volume so it does not flood
the console in high-throughput environments.

Remove the debug exporter before deploying to production. It writes to
stdout on every batch, which degrades throughput and fills disk if logs
are persisted.

### Internal Telemetry Metrics

The collector exposes its own metrics in Prometheus format at
`http://localhost:8888/metrics` by default. These metrics are the primary
tool for understanding pipeline health in production.

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
| `otelcol_receiver_accepted_spans` | Spans successfully received, confirms data is arriving |
| `otelcol_receiver_refused_spans` | Spans rejected by the receiver, indicates format or protocol issues |
| `otelcol_exporter_sent_spans` | Spans successfully exported to the backend |
| `otelcol_exporter_send_failed_spans` | Export failures, backend unreachable or rejecting data |
| `otelcol_exporter_queue_size` | Current queue depth, rising values signal backpressure |
| `otelcol_exporter_queue_capacity` | Maximum queue capacity, compare with `queue_size` to detect overflow risk |
| `otelcol_processor_dropped_spans` | Spans dropped by processors, check filter or memory_limiter config |
| `otelcol_process_memory_rss` | Collector memory usage, track for OOM prevention |

Comparing `receiver_accepted` against `exporter_sent` reveals where data is
being lost. If the receiver accepts 1000 spans but the exporter only sends
800, something in the processor chain is dropping 200.

```bash
curl -s http://localhost:8888/metrics | grep otelcol_exporter
```

### Health Check Extension

The health check extension provides an HTTP endpoint that reports whether
the collector's pipelines are running. Use it for container liveness probes
and load balancer health checks.

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
    path: /health

service:
  extensions: [health_check]
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

zPages provides a browser-accessible UI for inspecting live pipeline data.
It is useful for examining traces flowing through the collector in real
time without adding an exporter.

```yaml showLineNumbers title="otel-collector-config.yaml"
extensions:
  zpages:
    endpoint: 0.0.0.0:55679

service:
  extensions: [zpages]
```

Available endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/debug/servicez` | Overview of all active pipelines |
| `/debug/pipelinez` | Details on each pipeline's receivers, processors, exporters |
| `/debug/extensionz` | Status of enabled extensions |
| `/debug/tracez` | Live span samples grouped by latency buckets |

zPages is safe for production but should be restricted to internal
networks. Do not expose port 55679 publicly.

## Validating Configuration

Before debugging runtime behavior, rule out configuration errors.

**CLI validation:**

```bash
otelcol validate --config=/path/to/otel-collector-config.yaml
```

This checks for YAML syntax errors, unknown component names, and invalid
field values. A clean validation does not guarantee runtime success (the
backend may still reject connections), but it catches the most common
mistakes.

**List available components:**

```bash
otelcol components
```

This lists every receiver, processor, exporter, and extension compiled into
your collector binary. If a component is missing, you need a different
distribution (e.g., `otelcol-contrib` for community components).

**Visual validation:**

[otelbin.io](https://www.otelbin.io/) lets you paste your configuration and
see the pipeline graph. It highlights components that are defined but not
referenced in any pipeline, a common source of silent configuration errors.

## Common Failure Scenarios

### Data Disappearing Silently

**Symptom:** The receiver shows accepted spans, but they never reach the
backend.

**Cause:** The exporter's sending queue overflows under load. When the
queue is full, new data is dropped without error logs by default.

**Detection:**

```bash
curl -s http://localhost:8888/metrics | grep queue_size
```

If `otelcol_exporter_queue_size` equals `otelcol_exporter_queue_capacity`,
data is being dropped.

**Fix:** Increase `queue_size` on the exporter's `sending_queue` and ensure
`memory_limiter` is configured as the first processor. See the hardened
configuration example above.

### Collector OOM Crashes

**Symptom:** The collector process is killed with an out-of-memory error.
In Docker, the container exits with code 137.

**Cause:** No `memory_limiter` processor, or it is not placed first in the
processor chain. High-cardinality metrics (metrics with many unique label
combinations) can also cause unbounded memory growth.

**Detection:**

```bash
# Check container exit code (137 = OOM killed)
docker inspect --format='{{.State.ExitCode}}' otel-collector

# Check memory usage via internal metrics
curl -s http://localhost:8888/metrics | grep process_memory_rss
```

**Fix:** Add `memory_limiter` as the first processor in every pipeline. For
high-cardinality issues, review which attributes are being used as metric
labels and reduce the set to what is actually needed.

### Broken Traces

**Symptom:** Traces appear in the backend but are missing spans, or spans
from the same request show up as separate traces.

**Cause:** Context propagation is broken. Common reasons:

- An intermediate service does not propagate the `traceparent` header
- Multiple collector instances export to different backends or use
  different resource attributes
- A load balancer or API gateway strips trace context headers

**Detection:** Add the debug exporter and inspect the `trace_id` and
`parent_span_id` fields. Spans belonging to the same request should share
the same `trace_id`.

**Fix:** Verify all services propagate W3C Trace Context headers
(`traceparent`, `tracestate`). If using multiple collectors, ensure they
all export to the same backend with consistent resource attributes. Check
reverse proxies for header stripping.

### Export Failures

**Symptom:** The collector logs show repeated export errors, or
`otelcol_exporter_send_failed_spans` is rising.

**Cause:** Common error messages and what they indicate:

| Error | Cause |
|-------|-------|
| `connection refused` | Backend is down or unreachable |
| `rpc error: code = Unauthenticated` | Missing or invalid credentials |
| `413 Request Entity Too Large` | Batch size exceeds backend limit |
| `context deadline exceeded` | Network timeout, backend too slow |
| `unsupported protocol scheme` | gRPC exporter pointed at an HTTP endpoint, or the reverse |

**Fix:** For protocol mismatches, use `otlphttp` for HTTP/protobuf
endpoints and `otlp` for gRPC endpoints. For 413 errors, reduce
`send_batch_max_size` in the batch processor. For auth errors, verify
credentials and the `headers` or authentication extension configuration.

### Silent Configuration Errors

**Symptom:** A component is defined in the config but has no effect.

**Cause:** The component is declared in its top-level section (e.g.,
`processors:`) but not referenced in any pipeline under
`service.pipelines`.

**Detection:** The collector logs a warning at startup:

```text
"Processor \"attributes\" is not used in any pipeline"
```

Check startup logs carefully, or use
[otelbin.io](https://www.otelbin.io/) to visualize which components are
wired into pipelines.

**Fix:** Add the component to the relevant pipeline. Remember that
processor ordering matters: `memory_limiter` first, `batch` last.

## Testing the Pipeline

### Connectivity Checks

Before investigating complex pipeline issues, confirm basic connectivity.

**HTTP (OTLP/HTTP):**

```bash
curl -v http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{}'
# A 200 or 400 response confirms the collector is listening.
# "connection refused" means the collector is not running or the port
# is wrong.
```

**gRPC (OTLP/gRPC):**

```bash
grpcurl -plaintext localhost:4317 list
# Expected output includes:
# opentelemetry.proto.collector.trace.v1.TraceService
# opentelemetry.proto.collector.metrics.v1.MetricsService
# opentelemetry.proto.collector.logs.v1.LogsService
```

**Port check:**

```bash
nc -zv localhost 4317
```

### Load Testing with telemetrygen

`telemetrygen` generates synthetic telemetry to validate the pipeline
end-to-end without deploying a real application. It is useful for verifying
new configurations, testing backpressure behavior, and benchmarking
throughput.

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

After running, verify data flowed through:

```bash
curl -s http://localhost:8888/metrics | grep otelcol_receiver_accepted
```

## Production Checklist

A quick reference for verifying collector readiness:

- `memory_limiter` is the first processor in every pipeline
- `batch` processor is configured with appropriate `send_batch_size` and
  `send_batch_max_size`
- `retry_on_failure` is enabled on all exporters
- `sending_queue` is enabled with a `queue_size` appropriate for your
  throughput
- `health_check` extension is enabled and wired to container health probes
- Internal telemetry metrics (`0.0.0.0:8888`) are being scraped by your
  monitoring system
- Collector resource limits are set (baseline: 2 CPU, 2 GB RAM) with
  25-30% headroom above observed usage
- Compression (`gzip`) is enabled on exporters sending data over the
  network
- Debug exporter is not active in production pipelines

## Conclusion

The OpenTelemetry Collector is a reliable piece of infrastructure once
configured for the conditions it will actually face. The defaults prioritize
ease of getting started, which is the right tradeoff for a first deployment.
Production requires explicit decisions about memory limits, queue sizes,
retry behavior, and self-monitoring.

The diagnostic toolkit covered here, internal metrics, health checks,
zPages, and the debug exporter, is built into every collector distribution.
Enabling these tools before an incident means the data you need is already
there when something goes wrong.

For detailed reference on each topic covered here, see the
[OpenTelemetry Collector documentation](https://opentelemetry.io/docs/collector/).
