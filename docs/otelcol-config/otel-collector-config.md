# Configure OTel Collector (otelcol)

Collect, process and export telemetry data efficiently with
the OpenTelemetry Collector (`otelcol`).

## Overview

OpenTelemetry Collector serves as a vendor-agnostic implementation for
handling telemetry data. This guide covers:

- Core configuration components (receivers, processors, exporters)
- Advanced configuration options
- Best practices and examples

## Prerequisites

- Basic understanding of OpenTelemetry concepts

## Configuration

The OpenTelemetry Collector uses YAML for its configuration. The configuration
file is structured into several sections:

### receivers

OpenTelemetry receivers serve as data ingestion points for the collector,
accepting telemetry data from multiple sources. They support various protocols
and formats for collecting logs, metrics and traces.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  prometheus:
    config:
      scrape_configs:
        - job_name: 'otel-collector'
          scrape_interval: 10s
          static_configs:
            - targets: [ '0.0.0.0:8888' ]
```

Key features of receivers:

- Protocol support: OTLP, Prometheus, Jaeger, Zipkin
- Multiple transport options: gRPC, HTTP, TCP
- Configurable endpoints and TLS settings
- Custom metadata handling

#### Reference

[Official Receivers Documentation](https://opentelemetry.io/docs/collector/configuration/#receivers)

### processors

Processors are applied to the data between reception and export. They can
perform various transformations, filtering, and enrichment operations.

```yaml
processors:
  batch:
    timeout: 1s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 1s
    limit_mib: 4000
  resourcedetection:
    detectors: [ env, system ]
    timeout: 5s
  attributes:
    actions:
      - key: environment
        value: production
        action: insert
```

Common processors include:

- `batch`: Groups data before sending to exporters
- `memory_limiter`: Prevents out-of-memory errors
- `resourcedetection`: Detects resource information
- `attributes`: Modifies, adds, or removes attributes from the telemetry data

#### Reference

[Official Processors Documentation](https://opentelemetry.io/docs/collector/configuration/#processors)

### exporters

OpenTelemetry exporters transmit telemetry data to destination backends. They
handle the delivery of logs, metrics and traces to various
observability platforms and monitoring systems.

```yaml
exporters:
  otlp:
    endpoint: otelcol:4317
    tls:
      insecure: true
  prometheus:
    endpoint: 0.0.0.0:8889
  logging:
    verbosity: detailed
  zipkin:
    endpoint: http://zipkin:9411/api/v2/spans
```

Supported export destinations:

- Other OpenTelemetry Collectors e.g. OpenTelemetry protocol (OTLP) endpoints
- Backend observability platforms
- Monitoring systems e.g. Prometheus systems
- Logging platforms
- Tracing systems

#### Reference

[Official Exporters Documentation](https://opentelemetry.io/docs/collector/configuration/#exporters)

### extensions

OpenTelemetry Collector extensions enhance core functionality by providing
operational features such as:

- Health monitoring and readiness checks
- Performance profiling and debugging
- Service discovery mechanisms
- Diagnostic tools and dashboards

```yaml
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  pprof:
    endpoint: 0.0.0.0:1888
  zpages:
    endpoint: 0.0.0.0:55679
```

Common OpenTelemetry extensions include:

- `health_check`:
  HTTP endpoint for monitoring collector health and readiness status
- `pprof`:
  Performance profiling endpoints for debugging and optimization
- `zpages`:
  Zero-configuration diagnostic web pages for troubleshooting

#### Reference

[Official Extensions Documentation](https://opentelemetry.io/docs/collector/configuration/#extensions)

### service

The OpenTelemetry Collector service configuration defines pipeline architecture,
data flow, and operational settings such as:

- Pipeline definitions for logs, metrics and traces
- Component enablement and connections
- Collector telemetry settings

```yaml
service:
  extensions: [ health_check, pprof, zpages ]
  pipelines:
    traces:
      receivers: [ otlp ]
      processors: [ batch, memory_limiter ]
      exporters: [ otlp, zipkin ]
    metrics:
      receivers: [ otlp, prometheus ]
      processors: [ batch, memory_limiter ]
      exporters: [ otlp, prometheus ]
    logs:
      receivers: [ otlp ]
      processors: [ batch ]
      exporters: [ otlp, logging ]
  telemetry:
    logs:
      level: info
    metrics:
      level: detailed
```

Key components:

- `extensions`:
  Configure and enable operational extensions like health checks, profiling,
  and diagnostics
- `pipelines`:
  Define data processing workflows for different telemetry types
- `telemetry`:
  Configuration for the collector's self-monitoring capabilities

#### Reference

[Official Service Documentation](https://opentelemetry.io/docs/collector/configuration/#service)

## Advanced Configuration Elements

### connectors

Connectors function as both exporters and receivers, allowing telemetry data to
be routed between pipelines internally without leaving the collector.

- Cross-pipeline data routing
- Span-to-metrics conversion
- Internal data transformation

```yaml
connectors:
  forward:
  spanmetrics:
    dimensions:
      - name: http.method
      - name: http.status_code
    metrics_flush_interval: 15s
```

Common OpenTelemetry connector types include:

- `forward`:
  Internal pipeline connector for routing telemetry data between processing chains
- `spanmetrics`:
  Generates performance metrics from trace spans for latency analysis
- `count`:
  Creates count metrics from spans or logs
- `servicegraph`:
  Builds service dependency graphs from trace data

#### Reference

[Official Connectors Documentation](https://opentelemetry.io/docs/collector/configuration/#connectors)

### telemetry

The OpenTelemetry Collector telemetry configuration manages the collector's
self-monitoring capabilities, including:

- Internal metrics collection and reporting
- Diagnostic log management
- Trace sampling configuration
- Performance monitoring endpoints
- Health status reporting

```yaml
service:
  telemetry:
    logs:
      level: info
      development: false
      encoding: console
    metrics:
      level: detailed
      address: 0.0.0.0:8888
```

Telemetry configuration options include:

- Log verbosity and format
- Internal metrics reporting
- Self-monitoring capabilities

[Official Telemetry Documentation](https://opentelemetry.io/docs/collector/configuration/#telemetry)

## Configuration Best Practices

1. **Start Simple**: Begin with minimal configuration and add components as
   needed
2. **Use Environment Variables**: Leverage environment variable substitution for
   dynamic configuration

   ```yaml
   exporters:
     otlp:
       endpoint: ${OTLP_ENDPOINT}
   ```

3. **Implement Memory Protection**: Always include memory_limiter processor to
   prevent OOM issues
4. **Consider Resources**: Set appropriate resource limits based on expected
   load
5. **Enable Health Checks**: Include health_check extension for monitoring
6. **Use Batching**: Implement batching for efficient data transmission

## OpenTelemetry Collector Configuration Best Practices

Essential configuration guidelines for optimal OpenTelemetry Collector deployment:

1. **Start Simple**:

- Begin with basic OpenTelemetry configuration
- Add components incrementally
- Test each configuration change
- Validate telemetry flow

1. **Use Environment Variables**:

- Implement dynamic configuration
- Secure sensitive information
- Enable deployment flexibility

  ```yaml
  exporters:
    otlp:
      endpoint: ${OTLP_ENDPOINT}
  ```

1. **Implement Memory Protection**:

- Configure `memory_limiter` processor
- Prevent out-of-memory (OOM) crashes
- Set appropriate memory thresholds
- Monitor memory usage

1. **Resource Management**:

- Configure CPU limits
- Set memory boundaries
- Adjust based on telemetry volume
- Monitor resource utilization

1. **Health Monitoring**:

- Enable `health_check` extension
- Configure monitoring endpoints
- Set up alerting
- Monitor collector status

1. **Performance Optimization**:

- Enable batch processing
- Configure optimal batch sizes
- Set appropriate timeouts
- Monitor throughput metrics

## Configuration Examples

### Basic Collection and Export

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  otlp:
    endpoint: backend.example.com:4317
    tls:
      ca_file: /certs/ca.pem

service:
  pipelines:
    traces:
      receivers: [ otlp ]
      processors: [ batch ]
      exporters: [ otlp ]
    metrics:
      receivers: [ otlp ]
      processors: [ batch ]
      exporters: [ otlp ]
    logs:
      receivers: [ otlp ]
      processors: [ batch ]
      exporters: [ otlp ]
```

### Advanced Configuration with Multiple Pipelines

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
  prometheus:
    config:
      scrape_configs:
        - job_name: 'app-metrics'
          scrape_interval: 10s
          static_configs:
            - targets: [ 'app:8080' ]

processors:
  batch:
    timeout: 5s
  attributes:
    actions:
      - key: environment
        value: production
        action: insert
  resourcedetection:
    detectors: [ env, system ]

exporters:
  otlp/traces:
    endpoint: traces.backend.com:4317
  otlp/metrics:
    endpoint: metrics.backend.com:4317
  prometheus:
    endpoint: 0.0.0.0:8889

extensions:
  health_check:
    endpoint: 0.0.0.0:13133

service:
  extensions: [ health_check ]
  pipelines:
    traces:
      receivers: [ otlp ]
      processors: [ batch, attributes, resourcedetection ]
      exporters: [ otlp/traces ]
    metrics:
      receivers: [ otlp, prometheus ]
      processors: [ batch, resourcedetection ]
      exporters: [ otlp/metrics, prometheus ]
```

## Resources

- [OpenTelemetry Collector Configuration Documentation](https://opentelemetry.io/docs/collector/configuration/)
- [OpenTelemetry Collector GitHub Repository](https://github.com/open-telemetry/opentelemetry-collector)
- [OpenTelemetry Collector Contrib Repository](https://github.com/open-telemetry/opentelemetry-collector-contrib)
