---
title: IoT & Edge Observability with OpenTelemetry
sidebar_label: Overview
sidebar_position: 0
description:
  Instrument IoT devices and edge fleets with OpenTelemetry. Trace
  context over MQTT, edge store-and-forward, OPC-UA and Sparkplug B
  bridges, and constrained-device telemetry into base14 Scout.
keywords:
  - iot opentelemetry
  - edge observability
  - mqtt otel
  - opc-ua otel
  - sparkplug otel
  - industrial iot monitoring
  - constrained device telemetry
  - edge collector
---

# IoT & Edge Observability

IoT and edge systems break the assumptions most observability tooling is
built on. Devices are constrained, links are intermittent, fleets are
large, and the thing emitting telemetry is often not the thing being
measured. These guides cover instrumenting that world with
OpenTelemetry and shipping the signals to base14 Scout, vendor-neutral
and OTLP-native from the device up.

## Why IoT is different

A web service has a stable host, a fast network, and an SDK that speaks
OTLP natively. An IoT estate has none of those guarantees:

- **Constrained devices.** Microcontrollers have kilobytes of RAM and
  no room for a full OTLP/HTTP + protobuf stack. There is no
  OpenTelemetry C SDK and no MCU story today, so the device-to-edge hop
  needs a compact, transport-friendly encoding.
- **Intermittent connectivity.** Cellular and radio links drop. Spans
  and metrics have to be buffered at the edge and forwarded on
  reconnect, with clock-skew repair so late data lands on the right
  timeline.
- **Fleet scale and proxy identity.** Thousands of devices report
  through a handful of gateways. When a gateway speaks for a device,
  the telemetry has to carry whose signal it is, which the current
  semantic conventions do not express.
- **Industrial protocols.** OPC-UA and Sparkplug B dominate the factory
  floor, and neither has a Collector receiver in contrib. Bridging them
  to OTLP is on you until that lands upstream.

## The state of OpenTelemetry for IoT

The ecosystem is early here, and these guides are built around the gaps
rather than pretending they do not exist:

- **No protocol receivers.** Contrib ships `snmpreceiver` plus the
  generic log receivers, but no MQTT, CoAP, OPC-UA, or Sparkplug B
  receiver. The bridge examples in this track are the workaround, and
  the pattern we are proposing upstream.
- **No constrained-device SDK.** The embedded C effort is not active in
  the OpenTelemetry org, and the C++ and Rust embedded tracks are
  unresolved. Firmware emits a compact payload that an edge Collector
  translates into OTLP.
- **No fleet or device semantic-convention group.** Firmware version,
  provisioning identity, gateway hop, battery, and signal strength are
  all undefined upstream. The conventions below are Scout's working
  schema until that group exists.
- **No canonical end-to-end example.** There is no IoT equivalent of
  the OpenTelemetry demo. This track is building one phase by phase.

## Guides in this track

Each phase ships a runnable example and a guide. Every example runs
locally with Docker, no cloud account required.

| Phase | Guide | What it covers | Status |
| --- | --- | --- | --- |
| 1 | [MQTT trace context propagation](./mqtt-trace-propagation.md) | Trace context flowing across an MQTT 5 broker via user properties, visualized as one end-to-end trace in Scout. | Available |
| 2 | [Edge Collector patterns](./edge-collector-patterns.md) | Disk-buffered store-and-forward, interval downsampling, priority routing, and battery-aware filtering at the edge, surviving simulated disconnects. | Available |
| 3 | [OPC-UA to OTel bridge](./opcua.md) | A bridge that subscribes to an OPC-UA server and emits OTLP metrics with industrial asset attributes, fault logs, and session spans. | Available |
| 4 | Sparkplug B decoder | Decoding NBIRTH / DBIRTH / DDATA into OTLP metrics with device lifecycle state. | Coming soon |
| 5 | ESP32 firmware to Collector | Constrained-device firmware emitting a compact payload over MQTT, converted to OTLP by an edge Collector. | Coming soon |

## Resource attributes we use

Consistency across the phases above matters more than waiting for
upstream alignment, so the schema is locked here before any example
uses it. These are **Scout conventions pending upstream discussion**,
not ratified semantic conventions. Where an attribute reuses an
existing convention it is noted; the rest are proposed for a future
`device.*` / `fleet.*` working group, justified by the concrete usage
these examples provide.

### Compute devices (`device.*`)

Sensors, microcontrollers, gateways, and network gear.

| Attribute | Meaning |
| --- | --- |
| `device.id` | Unique device identifier. Upstream `device.id` is opt-in under recent semconv; Scout treats it as opt-in by default. |
| `device.manufacturer` | Device maker (existing mobile-origin attribute). |
| `device.model.identifier` | Model identifier (existing mobile-origin attribute). |
| `device.serial` | Hardware serial number. |
| `device.firmware.version` | Running firmware version. |
| `device.firmware.channel` | Release channel, e.g. `stable` / `beta`. |
| `device.power.source` | Power source, e.g. `mains` / `battery`. |
| `device.battery.level` | Battery level where applicable. |
| `device.provisioning.method` | How the device obtained its identity. |
| `device.kind` | Discriminator: `sensor` \| `gateway` \| `mcu` \| `network`. |

### Fleet (`fleet.*`)

| Attribute | Meaning |
| --- | --- |
| `fleet.id` | Fleet the device belongs to. |
| `fleet.tenant` | Owning tenant. |
| `fleet.priority` | `critical` \| `high` \| `normal` \| `low`. Used by edge filters. |

### Gateway (`gateway.*`)

| Attribute | Meaning |
| --- | --- |
| `gateway.id` | Gateway the device reports through. |
| `gateway.hop` | Hop count from device to backend. |

### Network (`network.*`)

| Attribute | Meaning |
| --- | --- |
| `network.signal.rssi` | Received signal strength. |

### Physical assets (`asset.*`)

Pumps, conveyors, ovens, and lines, distinct from compute devices.

| Attribute | Meaning |
| --- | --- |
| `asset.id` | Unique identifier for the physical asset. |
| `asset.type` | `pump` \| `conveyor` \| `oven` \| `line` \| ... |
| `asset.name` | Human-readable label. |
| `asset.parent_id` | Parent asset, for hierarchy chains. |

Asset hierarchy is expressed with `asset.parent_id` chains. Do not
introduce ad-hoc grouping attributes such as `asset.group`,
`asset.edge_node`, or `asset.line`; encode those relationships as
`asset.parent_id` instead.

### Site (`site.*`)

| Attribute | Meaning |
| --- | --- |
| `site.id` | Physical location identifier. |
| `site.name` | Human-readable location name. |

## Next steps

The MQTT trace-propagation guide is the entry point and a prerequisite
for the Sparkplug and ESP32 phases. It lands first; the table above
tracks what is live. For shipping the resulting telemetry, see the
[OpenTelemetry Collector Setup](../collector-setup/docker-compose-example.md)
guides and
[Scout exporter wiring](../collector-setup/scout-exporter.md).
