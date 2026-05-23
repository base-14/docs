---
title: OPC-UA to OpenTelemetry Bridge
sidebar_label: OPC-UA Bridge
sidebar_position: 3
description:
  Bridge an OPC-UA server to OpenTelemetry. Subscribe to nodes, map
  them to OTLP metrics with industrial asset attributes, emit fault
  logs and session spans, and ship to base14 Scout.
keywords:
  - opc-ua opentelemetry
  - opc-ua otlp bridge
  - industrial iot monitoring
  - opc-ua metrics
  - factory floor observability
  - asyncua opentelemetry
---

# OPC-UA to OpenTelemetry Bridge

OPC-UA is the lingua franca of the factory floor, and the OpenTelemetry
Collector has no receiver for it. Until one lands in contrib, getting
machine telemetry into an OTLP pipeline means writing a bridge: a service
that speaks OPC-UA on one side and OTLP on the other. This guide builds
that bridge, maps factory nodes to metrics with a declarative file, and
turns equipment faults into logs and session lifecycle into spans.

The companion runnable example lives at
[examples/iot/opcua-bridge](https://github.com/base-14/examples/tree/main/iot/opcua-bridge).

## Why a bridge, not a receiver

A Collector receiver would be the clean answer, but nothing in contrib
speaks OPC-UA today. A bridge is the pragmatic stand-in, and it is not
throwaway work: the shape of a
good bridge - subscribe to nodes, cache their values, expose them as
observable instruments read at collection time, drive the mapping from
config rather than code - is exactly the shape a receiver would take, so
the work transfers cleanly when one lands (the [receiver direction this
track follows](./index.md)).

The other reason a bridge earns its keep is that OPC-UA values are not
OTLP metrics one-to-one. A node carrying a pump's status string is not a
gauge; it is a state worth logging when it changes. A monotonic counter
node is a `Sum`, not a `Gauge`. The bridge is where you encode those
decisions, and a declarative map keeps them out of the code path.

## Architecture

```text
opcua-server (asyncua)        bridge (Python)            otel-collector
  6 simulated nodes   OPC-UA    subscribe + cache   OTLP   oauth2 -> b14
  flow, vibration,   ------->   observable metrics ----->  exporter      ---> Scout
  status, speed,      :4840     fault logs
  temp, throughput              session span
```

The bridge holds one OPC-UA subscription. Each data change updates an
in-memory cache keyed by node ID. OTel observable instruments read that
cache at collection time, so the export cadence is decoupled from the
OPC-UA update rate - the server can push at 500ms while the Collector
scrapes every few seconds.

## Map nodes to metrics declaratively

The mapping lives in `node_map.yaml`, not in code. Each entry binds one
OPC-UA node to an OTLP metric, its unit, its kind, and the `asset.*`
attributes that identify the physical equipment:

```yaml
nodes:
  - node_id: "ns=2;s=Pump1/Flow"
    metric:
      name: factory.pump.flow_rate
      unit: "L/min"
      kind: gauge          # gauge | counter | status
      description: Pump discharge flow rate
    attributes:
      asset.id: pump-1
      asset.type: pump
      asset.name: Transfer Pump 1
      asset.parent_id: line-1

  - node_id: "ns=2;s=Line1/ThroughputCounter"
    metric:
      name: factory.line.throughput
      unit: "{item}"
      kind: counter        # monotonic Sum, not a Gauge
      description: Items produced on the line
    attributes:
      asset.id: line-1
      asset.type: line
      asset.name: Assembly Line 1
```

`kind` is the important field. A `gauge` becomes an observable gauge, a
`counter` an observable counter (a monotonic `Sum`), and a `status` is
not a metric at all - it becomes a fault-log source, covered below.
Adding or remapping a node is a config edit; the bridge code never
changes.

## Read the cache from observable callbacks

Each gauge or counter is an observable instrument. Its callback reads the
node's latest value out of the shared cache; if no value has arrived yet
it returns nothing rather than a zero, so the series starts when real
data does:

```python
def _callback(node_id, attributes, cache):
    def cb(_options):
        value = cache.get(node_id)
        if value is None:
            return []
        return [Observation(float(value), attributes)]
    return cb

meter.create_observable_gauge(
    name, callbacks=[cb], unit=unit, description=description
)
```

The subscription handler is the only writer to the cache:

```python
def datachange_notification(self, node, val, _data):
    cache[node.nodeid.to_string()] = val
```

This split - subscription writes, callbacks read - is what decouples the
OPC-UA update rate from the OTLP export interval, and it is the same
contract a Collector receiver would implement internally.

## Turn status changes into fault logs

A pump's status is a string that matters at the moment it changes, not as
a continuous series. Map it as `kind: status` and the bridge logs each
transition instead of emitting a metric. Because the logger is wired to
an OTel `LoggingHandler`, the `extra={}` dict becomes log-record
attributes:

```python
if val == "fault":
    bridge_log.warning("asset entered fault state", extra=attributes)
elif previous is not None:
    bridge_log.info("asset recovered", extra=attributes)
```

In Scout these arrive as log records carrying `asset.id`, `asset.type`,
`asset.parent_id`, and `asset.status`, so you can pivot from a metric
anomaly straight to the fault event on the same asset. Logging the
transition rather than sampling the status as a metric keeps cardinality
down and makes the event queryable as an event.

## Wrap the session in a span

The OPC-UA session lifecycle is modeled as one `opcua.session` span. It
opens when the bridge connects and closes when the connection drops, so
its duration is the uptime of one session and a reconnect is a new span:

```python
async with Client(ENDPOINT) as client:
    with tracer.start_as_current_span("opcua.session", kind=SpanKind.CLIENT) as span:
        span.set_attribute("opcua.endpoint", ENDPOINT)
        span.set_attribute("opcua.security_policy", "None")
        # ... subscribe and serve until the connection drops
```

When a server restart or network blip ends the session, the span closes
with an error status carrying the exception, and the bridge reconnects
with exponential backoff (1s, doubling, capped at 30s). Each error span
is therefore one connection-loss event - a clean signal to alert on, and
a sequence that tells the reconnection story without extra plumbing.

## Detect a half-open connection

A dropped TCP connection does not always raise on the subscription. The
bridge issues a periodic lightweight read so a silently dead session is
caught and triggers a reconnect rather than going quiet:

```python
while running:
    await asyncio.sleep(3)
    await client.get_node(subscribe_ids[0]).read_value()
```

Without this probe a half-open socket can leave the bridge "connected"
but receiving nothing, and metrics simply stop with no error to explain
why. The read turns that silent failure into the same reconnect path as
an explicit drop.

## Resource attributes

The bridge sets site and fleet identity on the resource; the per-asset
attributes come from the node map. This follows the
[IoT resource schema](./index.md):

| Attribute | Source | Example |
| --- | --- | --- |
| `service.name` | bridge | `opcua-bridge` |
| `site.id` / `site.name` | resource | `site-hq` / `HQ Plant` |
| `fleet.id` | resource | `factory-floor` |
| `asset.id` / `asset.type` | node map | `pump-1` / `pump` |
| `asset.parent_id` | node map | `line-1` |

Asset hierarchy is expressed with `asset.parent_id` chains, not ad-hoc
grouping attributes - the pump points at the line it sits on, and a
deeper tree just adds links.

## Security

The example server runs `NoSecurity` and the bridge connects
anonymously, which keeps the demo to one `docker compose up`. Production
OPC-UA should not. Pick a security policy (for example
`Basic256Sha256`) and an authentication mode (certificate or username),
and set both on the client:

```python
await client.set_security_string(
    "Basic256Sha256,SignAndEncrypt,client_cert.pem,client_key.pem"
)
```

Record the chosen policy on the session span's `opcua.security_policy`
attribute so the security posture is visible in traces, not just in
config.

## Troubleshooting

- **Bridge cannot connect.** Confirm the endpoint path matches the server
  exactly (`opc.tcp://host:4840/factory/`); OPC-UA endpoint URLs are
  path-sensitive. Check the server is reachable on 4840 from the bridge's
  network.
- **Metrics never appear but no errors log.** A half-open connection. The
  periodic `read_value()` probe exists to catch this; confirm it is
  running and that the reconnect path fires.
- **Counter resets to zero in Scout.** A monotonic node mapped as
  `kind: gauge` will look like a sawtooth. Map cumulative nodes as
  `kind: counter` so they export as a `Sum`.
- **Fault log has no asset attributes.** The attributes come from the
  `status` node's `attributes:` block in `node_map.yaml`; an entry with no
  attributes logs a bare message.
- **asyncua floods the logs.** The library logs every publish callback at
  INFO. Quiet it with
  `logging.getLogger("asyncua").setLevel(logging.WARNING)` so the bridge's
  own records are the signal.
- **Nothing reaches Scout.** Confirm the Collector picked up the four
  `SCOUT_*` values; the debug exporter prints to stdout regardless, which
  separates a bridge problem from an export problem.

## Related guides

- [IoT & Edge overview](./index.md) - the resource attribute conventions
  every IoT example follows.
- [Edge Collector patterns](./edge-collector-patterns.md) - buffer,
  downsample, and route this telemetry once it is on the wire.
- [Scout exporter wiring](../collector-setup/scout-exporter.md) - the
  `oauth2client` extension and `otlp_http/b14` exporter used here.
