---
title: Sparkplug B to OpenTelemetry Decoder
sidebar_label: Sparkplug B Decoder
sidebar_position: 4
description:
  Decode Sparkplug B MQTT payloads into OpenTelemetry. Resolve metric
  aliases from BIRTH, track edge-node and device lifecycle, and ship
  OTLP metrics and events to base14 Scout.
keywords:
  - sparkplug b opentelemetry
  - sparkplug otel
  - iiot mqtt observability
  - sparkplug decoder
  - sparkplug b metrics
  - industrial iot monitoring
  - mqtt protobuf decode
---

# Sparkplug B to OpenTelemetry Decoder

Sparkplug B is the structured payload spec that turns plain MQTT into a
self-describing IIoT protocol, and it is everywhere on the plant floor.
The OpenTelemetry Collector has no decoder for it, so getting Sparkplug
telemetry into an OTLP pipeline means writing a bridge that speaks the
protobuf wire format, tracks session state, and resolves the metric
aliases Sparkplug uses to keep DATA messages small. This guide builds
that decoder.

The companion runnable example lives at
[examples/iot/sparkplug-bridge](https://github.com/base-14/examples/tree/main/iot/sparkplug-bridge).

## Why Sparkplug needs a decoder, not just an MQTT receiver

A generic MQTT receiver would hand you opaque protobuf bytes. Sparkplug
is stateful in a way that a per-message receiver cannot handle on its
own: a metric is defined once, in a BIRTH message, with a name, a
datatype, and a numeric alias. Every later DATA message refers to that
metric by alias only. Decode a DATA message in isolation and all you
have is `alias 3 = 71.2` with no idea what metric 3 is. The decoder's
core job is to hold the alias table from BIRTH and resolve DATA against
it. That state requirement is exactly why this is a bridge with memory,
not a stateless receiver.

## Sparkplug B primer

Topics follow `spBv1.0/{group}/{message_type}/{edge_node}/{device?}`. The
message types that carry telemetry:

| Type | Meaning |
| --- | --- |
| `NBIRTH` | Edge node online; advertises node metrics with aliases. |
| `DBIRTH` | Device online under a node; advertises device metrics. |
| `NDATA` / `DDATA` | Metric updates, by alias only. |
| `DDEATH` | Device gone. |
| `NDEATH` | Edge node gone - delivered as the MQTT Last Will. |
| `NCMD` / `DCMD` | Commands (control, not telemetry - ignored here). |

Two rules are load-bearing:

- **BIRTH before DATA.** You cannot resolve a DATA alias without the
  BIRTH that defined it. A consumer that starts mid-stream must wait for
  the next BIRTH (or, as a host application, request a rebirth).
- **Sequence numbers.** Every payload from an edge node carries a `seq`
  field, 0-255, incremented on each message and wrapping at 256. NBIRTH
  resets it to 0. A value other than `(previous + 1) mod 256` means
  messages were lost between the edge node and you.

## Decoder state machine

```text
        NBIRTH                         DBIRTH
   ────────────────►  edge node  ────────────────►  device alive
   (reset seq, store   alive,      (store device      (resolve DDATA
    node aliases)      seq=0        aliases)           against aliases)
        ▲                                                   │
        │ NDEATH (Last Will)                  DDATA ────────┘  (check seq;
        │                                                       gap -> counter)
   edge node dead  ◄──────────────  device dead  ◄──── DDEATH
```

On NBIRTH the decoder resets the edge node's sequence counter, stores its
metric aliases, and clears any prior device state (a node rebirth
invalidates it). DBIRTH stores per-device aliases. DDATA resolves each
alias and records the value; an unresolved alias is counted, not
guessed. DDEATH and NDEATH mark the device or node dead and emit a
lifecycle event.

## Resolve aliases from BIRTH

The alias table is the heart of the decoder. Build it from the BIRTH
metrics, which carry name, datatype, and alias together:

```python
def defs_from_birth(payload):
    defs = {}
    for m in payload.metrics:
        if m.HasField("alias"):
            defs[m.alias] = MetricDef(name=m.name, datatype=m.datatype)
    return defs
```

Then on DDATA, look each alias up and record the resolved metric; if the
alias is unknown, count it rather than emitting a mystery series:

```python
definition = state.resolve(group, edge_node, device, metric.alias)
if definition is None:
    tel.count_unresolved(attrs)        # alias_unresolved_total
    continue
tel.record(definition.name, value, definition.datatype in INT_TYPES, attrs)
```

A steady stream of `alias_unresolved_total` is the signal that the
decoder is seeing DATA without the matching BIRTH - usually a consumer
that started after the edge node, or a missed BIRTH.

## Detect sequence gaps

The `seq` counter is per edge node and spans the node's own messages and
all its devices'. Check continuity with a wrap-aware comparison:

```python
def check_seq(self, group, edge_node, seq):
    node = self._node(group, edge_node)
    gap = node.last_seq is not None and seq != (node.last_seq + 1) % 256
    node.last_seq = seq
    return gap
```

A gap increments `sparkplug.decoder.seq_gap_total`. Because the counter
carries the asset attributes, you can see which edge node or device is
losing messages, which usually points at the network between the edge
node and the broker, not at the decoder.

## Map Sparkplug datatypes to OTel instruments

Sparkplug metric sets are runtime-defined by BIRTH, so instruments are
created on first sight rather than from static config. The kind is
inferred from the datatype and the metric name:

| Sparkplug datatype | OTel instrument | Notes |
| --- | --- | --- |
| Double, Float | gauge | Current value. |
| Boolean | gauge (0/1) | Booleans render as a 0/1 gauge. |
| Int (monotonic name) | observable counter | `*Counter`, `*Total`, `Throughput`. |
| Int (other) | gauge | Non-cumulative integers. |

Sparkplug does not flag which integers are monotonic counters, so the
decoder infers it from the metric name and exposes an override list. The
tradeoff of dynamic creation is cardinality: a BIRTH that advertises
hundreds of metrics creates hundreds of instruments. An allowlist in
config is the mitigation when a plant publishes more than you want to
store.

## Emit lifecycle as events, not spans

BIRTH and DEATH are state transitions, not operations with a duration, so
they map to OTel log records rather than spans:

```python
# device online  -> INFO, device offline / edge node offline -> WARN
bridge_log.warning("edge node offline", extra=asset_attributes)
```

NDEATH is special: it is the MQTT Last Will the edge node registered at
connect, so the broker publishes it even when the node drops ungracefully.
That makes "edge node offline" a reliable event you can alert on, without
the decoder polling for liveness.

## Resource attributes

The Sparkplug topology maps onto the
[IoT resource schema](./index.md): the group is the site, the edge node
is the parent asset, and each device is an asset under it.

| Attribute | Source | Example |
| --- | --- | --- |
| `service.name` | decoder | `sparkplug-decoder` |
| `site.id` | Sparkplug group | `FactoryA` |
| `fleet.id` | resource | `factory-floor` |
| `asset.id` | device | `Machine1` |
| `asset.type` | fixed | `sparkplug_device` |
| `asset.parent_id` | edge node | `EdgeNode1` |

Hierarchy is expressed with `asset.parent_id` chains, not ad-hoc grouping
attributes - the device points at its edge node, and a deeper topology
just adds links.

## Why this isn't a Collector receiver today

The [track's end state](./index.md) is an `mqttreceiver` paired with
protocol-specific processors; for Sparkplug that processor is the piece
holding the alias and sequence state. The decoder here is the working
stand-in and the reference for that proposal - alias resolution, sequence
tracking, and dynamic instrument creation are the parts that would move
upstream.

## Troubleshooting

- **Every alias is unresolved.** The decoder started after the edge node
  birthed and is seeing DATA only. Ensure the consumer subscribes before
  the publisher births (the example gates the simulator on decoder
  readiness), or run a host application that requests a rebirth.
- **A counter looks like a sawtooth.** A monotonic metric was mapped as a
  gauge. Add its name to the monotonic-name list so it exports as a Sum.
- **`seq_gap_total` climbing steadily.** Real message loss between the
  edge node and the broker, or two publishers sharing one edge-node id
  and interleaving their sequence numbers.
- **No NDEATH on an unplugged device.** The edge node did not register a
  Last Will at connect. NDEATH is an MQTT LWT, not something the decoder
  can synthesize.
- **Nothing reaches Scout.** Confirm the Collector picked up the four
  `SCOUT_*` values; the debug exporter prints to stdout regardless, which
  separates a decode problem from an export problem.

## Related guides

- [IoT & Edge overview](./index.md) - the resource attribute conventions
  every IoT example follows.
- [MQTT trace propagation](./mqtt-trace-propagation.md) - the broker
  pattern this example reuses, for trace context rather than Sparkplug.
- [OPC-UA bridge](./opcua.md) - the other industrial-protocol bridge in
  this track; compare when choosing between OPC-UA and Sparkplug.
- [Scout exporter wiring](../collector-setup/scout-exporter.md) - the
  `oauth2client` extension and `otlp_http/b14` exporter used here.
