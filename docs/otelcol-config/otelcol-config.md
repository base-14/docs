# OpenTelemetry Collector Configuration Guide

The OpenTelemetry Collector (otelcol) is a vendor-agnostic implementation that receives, processes, and exports telemetry data. Its configuration is defined in YAML and consists of several major sections that control different aspects of telemetry data handling.

## Core Configuration Sections

### receivers

Receivers are the entry points for data into the collector. They define how the collector ingests telemetry data from various sources.

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
            - targets: ['0.0.0.0:8888']
```

Each receiver has its own configuration settings. For example, the OTLP receiver supports both gRPC and HTTP protocols with specific endpoint configurations.

[Official Receivers Documentation](https://opentelemetry.io/docs/collector/configuration/#receivers)

### processors

Processors are applied to the data between reception and export. They can perform various transformations, filtering, and enrichment operations.

```yaml
processors:
  batch:
    timeout: 1s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 1s
    limit_mib: 4000
  resourcedetection:
    detectors: [env, system]
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

[Official Processors Documentation](https://opentelemetry.io/docs/collector/configuration/#processors)

### exporters

Exporters define where and how the collected telemetry data is sent after processing.

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

Exporters can send data to:
- Other OpenTelemetry Collectors
- Backend observability platforms
- Monitoring systems
- Logging solutions
- Tracing systems

[Official Exporters Documentation](https://opentelemetry.io/docs/collector/configuration/#exporters)

### extensions

Extensions provide capabilities that are not directly related to data processing, such as health monitoring, service discovery, and performance metrics.

```yaml
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
  pprof:
    endpoint: 0.0.0.0:1888
  zpages:
    endpoint: 0.0.0.0:55679
```

Common extensions include:
- `health_check`: Exposes health information
- `pprof`: Enables pprof endpoint for go profiling
- `zpages`: Provides in-process diagnostics

[Official Extensions Documentation](https://opentelemetry.io/docs/collector/configuration/#extensions)

### service

The service section defines the collector's operational aspects, including which components are enabled and how they're connected.

```yaml
service:
  extensions: [health_check, pprof, zpages]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, memory_limiter]
      exporters: [otlp, zipkin]
    metrics:
      receivers: [otlp, prometheus]
      processors: [batch, memory_limiter]
      exporters: [otlp, prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp, logging]
  telemetry:
    logs:
      level: info
    metrics:
      level: detailed
```

Key components:
- `extensions`: Lists enabled extensions
- `pipelines`: Defines data flow paths for different telemetry types (traces, metrics, logs)
- `telemetry`: Configuration for the collector's own telemetry

[Official Service Documentation](https://opentelemetry.io/docs/collector/configuration/#service)

## Advanced Configuration Elements

### connectors

Connectors function as both exporters and receivers, allowing telemetry data to be routed between pipelines internally without leaving the collector.

```yaml
connectors:
  forward:
  spanmetrics:
    dimensions:
      - name: http.method
      - name: http.status_code
    metrics_flush_interval: 15s
```

Common connectors include:
- `forward`: Forwards telemetry data between pipelines
- `spanmetrics`: Generates metrics from spans

[Official Connectors Documentation](https://opentelemetry.io/docs/collector/configuration/#connectors)

### telemetry

The telemetry section configures how the collector reports its own operational metrics, logs, and traces.

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

This controls:
- Log verbosity and format
- Internal metrics reporting
- Self-monitoring capabilities

[Official Telemetry Documentation](https://opentelemetry.io/docs/collector/configuration/#service)

## Configuration Best Practices

1. **Start Simple**: Begin with minimal configuration and add components as needed
2. **Use Environment Variables**: Leverage environment variable substitution for dynamic configuration
   ```yaml
   exporters:
     otlp:
       endpoint: ${OTLP_ENDPOINT}
   ```
3. **Implement Memory Protection**: Always include memory_limiter processor to prevent OOM issues
4. **Consider Resources**: Set appropriate resource limits based on expected load
5. **Enable Health Checks**: Include health_check extension for monitoring
6. **Use Batching**: Implement batching for efficient data transmission

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
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
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
            - targets: ['app:8080']

processors:
  batch:
    timeout: 5s
  attributes:
    actions:
      - key: environment
        value: production
        action: insert
  resourcedetection:
    detectors: [env, system]

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
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes, resourcedetection]
      exporters: [otlp/traces]
    metrics:
      receivers: [otlp, prometheus]
      processors: [batch, resourcedetection]
      exporters: [otlp/metrics, prometheus]
```

## Resources

- [OpenTelemetry Collector Configuration Documentation](https://opentelemetry.io/docs/collector/configuration/)
- [OpenTelemetry Collector GitHub Repository](https://github.com/open-telemetry/opentelemetry-collector)
- [OpenTelemetry Collector Contrib Repository](https://github.com/open-telemetry/opentelemetry-collector-contrib)