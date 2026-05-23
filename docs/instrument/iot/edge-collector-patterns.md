---
title: Edge Collector Patterns for IoT with OpenTelemetry
sidebar_label: Edge Collector Patterns
sidebar_position: 2
description:
  Store-and-forward, downsampling, priority routing, and battery-aware
  filtering at the edge with the OpenTelemetry Collector, so intermittent
  IoT sites lose no telemetry and waste no backhaul bandwidth.
keywords:
  - edge collector opentelemetry
  - iot store and forward
  - otel filestorage
  - otel downsampling
  - battery aware telemetry
  - opentelemetry interval processor
  - opentelemetry routing connector
---

# Edge Collector Patterns for IoT

An edge Collector runs next to the devices, on the gateway or the site
server, between your fleet and the backhaul that carries telemetry to the
cloud. That position is where the hard IoT constraints live: the uplink is
intermittent, bandwidth is metered or thin, and some devices run on a
battery you do not want to drain on routine reporting. This guide covers
four Collector patterns that handle those constraints, each one a small
piece of configuration you can adopt independently.

The companion runnable example lives at
[examples/iot/edge-collector-store-forward](https://github.com/base-14/examples/tree/main/iot/edge-collector-store-forward).

## The topology

The edge Collector receives OTLP from local devices and forwards to an
upstream Collector across the backhaul. Only the upstream hop
authenticates to Scout; the edge stays simple and local.

```text
devices ──> edge collector ──backhaul──> upstream collector ──> Scout
            buffer · downsample · route · drop
```

Splitting edge from upstream is what makes the buffering testable: sever
the backhaul and the devices keep talking to the edge, which holds their
data until the link returns. It also matches real deployments, where the
edge box is yours and the upstream is a regional aggregation point.

## Pattern 1: Disk-buffered store-and-forward

A dropped backhaul should cost you nothing. The `file_storage` extension
gives the exporter a persistent send queue: batches that have not been
acked by the upstream are written to disk, so they survive both a network
outage and a restart of the Collector process itself.

```yaml
extensions:
  file_storage:
    directory: /var/lib/otelcol/storage
    timeout: 10s

exporters:
  otlp_http/upstream:
    endpoint: ${env:UPSTREAM_ENDPOINT}
    sending_queue:
      enabled: true
      storage: file_storage   # queue lives on disk, not just in memory
      queue_size: 1000
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s

service:
  extensions: [file_storage]
```

When the upstream is unreachable, the exporter retries and the unacked
batches accumulate in the on-disk queue. When the link returns, the queue
drains. Because OTLP carries the original event timestamp, the late data
lands in the correct place in the series rather than bunched at the
recovery moment.

Size `queue_size` (measured in batches) for your worst-case outage at your
batch rate. The queue is bounded by that count, not by a byte budget, so on
a constrained gateway choose a value whose on-disk footprint fits the
partition, and watch `otelcol_exporter_queue_size`. When the queue is full,
new batches are dropped while the already-queued data is kept.

## Pattern 2: Downsampling high-frequency gauges

A sensor sampling every two seconds produces far more datapoints than most
dashboards or alerts need. The `interval` processor aggregates a time
window into a single datapoint, cutting the volume crossing the backhaul.

```yaml
processors:
  interval:
    interval: 30s   # one datapoint per gauge per 30s window
```

For gauges the processor emits the last value seen in each window. That
loses sub-window detail, which is the deliberate trade: you accept coarser
resolution on routine metrics in exchange for a fraction of the bandwidth.
Keep this for metrics only. Traces are not downsampled here - sampling
trace data is a separate decision, made on its own terms.

## Pattern 3: Routing high-priority fleets at full resolution

Downsampling everything is rarely right. A critical line of equipment may
need every datapoint while a shelf of environmental sensors does not. The
`routing` connector splits the stream on a resource attribute -
`fleet.priority` here - so high-priority fleets bypass the downsampler.

```yaml
connectors:
  routing:
    default_pipelines: [metrics/downsample]
    table:
      - context: resource
        condition: 'attributes["fleet.priority"] == "high"'
        pipelines: [metrics/full-rate]

service:
  pipelines:
    metrics/ingest:
      receivers: [otlp]
      processors: [memory_limiter]
      exporters: [routing]
    metrics/full-rate:
      receivers: [routing]
      processors: [batch]
      exporters: [otlp_http/upstream]
    metrics/downsample:
      receivers: [routing]
      processors: [interval, batch]
      exporters: [otlp_http/upstream]
```

Routing on the `resource` context keeps each device's stream intact:
every metric from a high-priority device follows the full-rate path, and
everything else is downsampled. Extend the table to carve out more
priorities; the default route is the downsampler.

## Pattern 4: Battery-aware dropping

For battery-powered devices, the uplink itself costs energy. When a device
reports a low battery, dropping its non-essential telemetry at the edge
extends its working life. The `filter` processor expresses that policy
with OTTL.

```yaml
processors:
  filter/low-battery:
    error_mode: ignore
    metrics:
      datapoint:
        - >-
          resource.attributes["device.battery.level"] != nil and
          resource.attributes["device.battery.level"] < 20 and
          resource.attributes["fleet.priority"] != "critical"
```

Place this before routing so it applies to every device. The
`device.battery.level` and `fleet.priority` attributes come from the
device's resource (see the
[IoT resource-attribute schema](./index.md)). The threshold and the
critical-fleet exemption are a policy choice: tune them per device class.
This drops metrics only; traces are unaffected.

## Clock skew and late arrival

Replayed data keeps its original OTLP timestamp, so a backhaul recovery
restores the true shape of the series rather than a spike at reconnect.
This depends on the device clocks being roughly correct. Keep them on NTP
or a periodic sync; a device whose clock is hours off will deposit its late
data in the wrong window, which no amount of edge buffering can correct.

## Sending to Scout

The edge Collector forwards plain OTLP to the upstream Collector, which is
the hop that authenticates to Scout with the OAuth2 client-credentials
extension and the `otlp_http/b14` exporter. That wiring is the same as any
Scout Collector deployment - see
[Scout exporter wiring](../collector-setup/scout-exporter.md). Keeping
authentication on the upstream means the edge configuration carries no
credentials.

## Troubleshooting

- **Queue grows and never drains.** The upstream is unreachable or
  rejecting data. Check connectivity across the backhaul and the upstream
  Collector's own logs; the edge is doing its job by holding the data.
- **Queue resets to zero after a restart.** The `sending_queue` is not
  backed by storage. Confirm `storage: file_storage` on the exporter and
  that the `file_storage` directory is writable and on a persistent volume.
- **Downsampling has no effect.** The metrics may be arriving already
  aggregated, or the SDK export interval is longer than the `interval`
  window. Confirm the source exports faster than the window you set.
- **High-priority data is being downsampled.** Check the `routing`
  connector condition and that the device's resource actually carries
  `fleet.priority`; resources without the attribute take the default
  (downsample) route.
- **Retry storms on reconnect.** A large backlog flushing at once can
  overwhelm the upstream. Tune `retry_on_failure` intervals and the
  upstream's `batch` settings to smooth the recovery.

## Related guides

- [MQTT Trace Propagation](./mqtt-trace-propagation.md) - the producer and
  consumer this example reuses as traffic generators.
- [IoT & Edge overview](./index.md) - the resource-attribute conventions,
  including `device.battery.level` and `fleet.priority`.
- [Scout exporter wiring](../collector-setup/scout-exporter.md) - the
  OAuth2 extension and exporter the upstream Collector uses.
