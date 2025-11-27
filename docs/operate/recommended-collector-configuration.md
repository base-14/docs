---
title: Recommended Scout Collector Configuration
sidebar_label: Recommended Collector Configuration
description:
  Configure Scout Collector for optimal reliability. Learn essential settings for compression,
  batching, retries, and memory management to ensure reliable telemetry data delivery.
keywords:
  [
    scout collector,
    collector configuration,
    recommended setup,
    otel collector reliability,
    compression,
    batching,
    retry mechanism,
    memory limiter,
    telemetry delivery,
  ]
tags: [opentelemetry, base14 scout, configuration]
sidebar_position: 3
---

This guide will walk you through tuning the Scout Collector for better  reliability.
We'll focus on compression, batching, retry mechanisms and memory limiter.
These settings help in reducing network bandwidth, improving  preventing the collector
from consuming too much memory.

### Compression

Enabling `gzip` compression on the `otlphttp/b14` exporter reduces the amount of
data sent over the network, which can lower costs and improve throughput. This
is highly recommended when sending data over the internet.

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp/b14:
    endpoint: https://otel.play.b14.dev/__YOUR_TENANT__/otlp
    auth:
      authenticator: oauth2client
    tls:
      insecure_skip_verify: true
    compression: gzip
```

### Batch Processor

The batch processor groups telemetry data into batches before sending it to the
next component in the pipeline. This is more efficient than sending individual
data points and can significantly improve performance and reduce network overhead.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  batch:
    timeout: 2s
    send_batch_size: 8192
    send_batch_max_size: 10000
```

### Retry Mechanism

The `retry_on_failure` setting configures the exporter to automatically retry
sending data if the initial attempt fails. This is essential for handling
transient network issues or temporary backend unavailability, making your
data pipeline more resilient.

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp/b14:
    retry_on_failure:
      enabled: true
      initial_interval: 2s
      max_interval: 10s
      max_elapsed_time: 60s
```

### Memory Limiter Processor

The `memory_limiter` processor prevents the OpenTelemetry Collector from
consuming excessive memory, which can lead to out-of-memory errors.
It monitors the collector's memory usage and can throttle data ingestion
to prevent it from crashing.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 70
    spike_limit_percentage: 30
```

### Full Configuration Example

Here is a full example of a pipeline with all the recommended settings.
Note that `batch` and `memory_limiter` are processors and should be defined
in the `processors` section of your configuration, while `compression` and
`retry_on_failure` are part of the exporter configuration.

```yaml showLineNumbers title="otel-collector-config.yaml"
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp/b14]

exporters:
  otlphttp/b14:
    compression: gzip
    retry_on_failure:
      enabled: true
      initial_interval: 2s
      max_interval: 10s
      max_elapsed_time: 60s

processors:
  batch:
    timeout: 2s
    send_batch_size: 8192
    send_batch_max_size: 10000
  memory_limiter:
    check_interval: 1s
    limit_percentage: 70
    spike_limit_percentage: 30
```

## References

- [OpenTelemetry Collector Exporters](https://opentelemetry.io/docs/collector/configuration/#exporters)
- [OpenTelemetry Collector Processors](https://opentelemetry.io/docs/collector/configuration/#processors)
- [OTLP HTTP Exporter](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/README.md)
- [Batch Processor](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md)
- [Memory Limiter Processor](https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md)

## Related Guides

- [Quick Start](../guides/quick-start.md)
- [Otel collector configuration](../instrument/collector-setup/otel-collector-config.md)
