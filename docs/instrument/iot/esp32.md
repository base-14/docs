---
title: ESP32 Firmware to OpenTelemetry
sidebar_label: ESP32 Firmware
sidebar_position: 5
description:
  Instrument an ESP32 with OpenTelemetry when there is no C SDK. Emit a
  compact SME-v1 JSON envelope over MQTT, bridge it to OTLP, and ship
  device metrics, events, and traces to base14 Scout.
keywords:
  - esp32 opentelemetry
  - mcu observability
  - embedded otel
  - iot firmware tracing
  - esp-idf otel
  - constrained device telemetry
  - microcontroller monitoring
---

# ESP32 Firmware to OpenTelemetry

OpenTelemetry has no C SDK and no microcontroller story today. The C++
SDK is POSIX-only and far too heavy for an ESP32, and a full OTLP/HTTP +
protobuf + TLS stack does not fit the default firmware build. So getting
telemetry off a constrained device and into an OTLP pipeline means
choosing where the conversion happens. This guide puts it at the edge:
the firmware emits a small, versioned JSON envelope over MQTT, and a
bridge service turns it into ordinary OpenTelemetry.

The companion runnable example lives at
[examples/iot/esp32-firmware](https://github.com/base-14/examples/tree/main/iot/esp32-firmware).

## Why a bridge, not OTLP from the device

You could, in principle, generate C structs for the OTLP protobuf
definitions and emit real OTLP over MQTT from the device. It is a valid
path, and the appendix sketches it. But for a reference example it trades
away the two things that make this useful: a payload you can read on one
screen, and a firmware image that is mostly Wi-Fi and TLS rather than
serialization code.

So the device speaks a compact format - the Scout MCU Envelope, SME-v1 -
and the bridge is what makes it OpenTelemetry. The envelope is the
replaceable piece. A team that needs strict wire-level OTLP can swap it
for the protobuf path and keep the bridge, the Collector, and Scout
exactly as they are.

## The SME-v1 envelope

One JSON object per reading, published to
`{prefix}/{device_id}/telemetry`:

```json
{
  "v": 1,
  "device": {
    "id": "esp32-dev-01",
    "model": "esp32-s3-devkitc",
    "firmware": { "version": "0.1.0", "channel": "dev" },
    "fleet": { "id": "fleet-demo", "tenant": "acme" }
  },
  "ts_ms": 1712347200000,
  "ts_source": "sntp",
  "trace": { "traceparent": "00-4bf9...4736-00f0...02b7-01" },
  "metrics": [
    { "name": "mcu.cpu.temp_c", "kind": "gauge",   "value": 42.1, "unit": "Cel" },
    { "name": "mcu.uptime",     "kind": "counter", "value": 12345, "unit": "s" }
  ],
  "events": [
    { "name": "wifi.reconnect", "severity": "warn", "attrs": { "rssi": -78 } }
  ]
}
```

The `device` block is the device's resource. `metrics` are levels
(`gauge`) or running totals (`counter`). `events` are point-in-time log
records. `trace.traceparent` is optional and present when the device
wants a specific publish correlated. The version field `v` is the
contract: a bridge accepts only the versions it implements and rejects
the rest rather than guessing.

## Generate trace context on the device

The device mints W3C trace context itself, so a publish can be tied into
a trace before it ever reaches a backend. The format is a fixed string -
version, 16-byte trace ID, 8-byte span ID, sampled flag:

```c
void traceparent_generate(char *out, size_t len) {
    uint8_t trace_id[16], span_id[8];
    esp_fill_random(trace_id, sizeof(trace_id));
    esp_fill_random(span_id, sizeof(span_id));
    char tid[33], sid[17];
    to_hex(tid, trace_id, 16); tid[32] = '\0';
    to_hex(sid, span_id, 8);   sid[16] = '\0';
    snprintf(out, len, "00-%s-%s-01", tid, sid);
}
```

One caveat worth stating plainly: `esp_random()` is a true CSPRNG only
once the RF subsystem (Wi-Fi or Bluetooth) is running. During cold boot
it falls back to a weaker source. The firmware holds its first publish
until Wi-Fi connects, so trace IDs are strong - but do not market this as
cryptographic randomness without that ordering guarantee.

## The publish loop

The loop is deliberately small: read sensors, stamp a timestamp, build
the envelope, publish at QoS 1, sleep. The clock source is recorded so a
consumer knows whether to trust the timestamp:

```c
if (time_synced) {                       // SNTP succeeded after Wi-Fi up
    gettimeofday(&tv, NULL);
    ts_ms = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
    ts_source = "sntp";
} else {                                 // no network time yet
    ts_ms = esp_timer_get_time() / 1000;
    ts_source = "uptime";
}
```

`ts_source` rides along on every datapoint as an attribute, so a chart
built on these metrics can distinguish wall-clock readings from
uptime-relative ones after a clock jump.

The device also registers an MQTT Last Will on
`{prefix}/{device_id}/offline` at connect, so the broker announces an
ungraceful drop without the bridge polling for liveness - the same
pattern the [Sparkplug decoder](./sparkplug.md) relies on for NDEATH.

## What the bridge does

The bridge subscribes to the telemetry and offline topics and turns each
envelope into OpenTelemetry signals.

**Per-device resource.** The `device` block becomes an OTel `Resource`,
so device identity is a resource attribute, not a datapoint attribute:

```python
def resource_attrs(device):
    attrs = {"device.id": device["id"], "device.kind": "mcu"}
    attrs["device.model.identifier"] = device.get("model")
    fw = device.get("firmware", {})
    attrs["device.firmware.version"] = fw.get("version")
    attrs["device.firmware.channel"] = fw.get("channel")
    fleet = device.get("fleet", {})
    attrs["fleet.id"] = fleet.get("id")
    attrs["fleet.tenant"] = fleet.get("tenant")
    return attrs
```

**Counters arrive as totals.** The device sends `mcu.uptime` as a
running total, so the bridge models it as an observable monotonic Sum
reading the latest cached value - it stays rate-able in Scout even though
the device never sends a delta:

```python
def callback(_options, _series=series):
    return [Observation(value, attrs) for value, attrs in _series.values()]
meter.create_observable_counter(name, unit=unit, callbacks=[callback])
```

**Events become logs, traces continue.** Each event is a log record at
its severity. When an envelope carries a `traceparent`, the bridge starts
an `mcu.publish` span in that extracted context, so the device's publish
joins a trace:

```python
parent = TraceContextTextMapPropagator().extract({"traceparent": tp})
tracer.start_span("mcu.publish", context=parent, attributes=attrs).end()
```

**Bad input is counted, not fatal.** Malformed JSON increments
`sme_bridge.parse_errors_total`; an unknown `v` increments
`sme_bridge.version_rejected_total`. `sme_bridge.messages_total` breaks
down by result. A single bad frame never takes the bridge down.

## Resource attributes

Device identity maps onto the [IoT resource schema](./index.md). A
microcontroller is a compute device, so it uses `device.*` with
`device.kind=mcu`, not the `asset.*` namespace that physical equipment
uses.

| Attribute | Source | Example |
| --- | --- | --- |
| `service.name` | bridge | `sme-bridge` |
| `device.id` | envelope | `esp32-dev-01` |
| `device.kind` | fixed | `mcu` |
| `device.model.identifier` | envelope | `esp32-s3-devkitc` |
| `device.firmware.version` | envelope | `0.1.0` |
| `device.firmware.channel` | envelope | `dev` |
| `fleet.id` | envelope | `fleet-demo` |
| `fleet.tenant` | envelope | `acme` |

## Firmware footprint

Footprint is the number that decides whether an approach fits a device,
so measure it on your own build rather than trusting a quoted figure - it
moves with the ESP-IDF version, the target chip, and the config:

```bash
idf.py size              # total flash + RAM
idf.py size-components   # per-component: Wi-Fi, mbedTLS, esp-mqtt, app
```

A clean build of this firmware (ESP-IDF v5.5.2, target `esp32s3`, the
checked-in `sdkconfig.defaults`) gives a baseline to reason against. The
app image is about 897 KB (`0xe0320`, 918,304 bytes), which leaves 12%
free in a 1 MB app partition:

| Memory     | Used      | Detail                                |
|------------|-----------|---------------------------------------|
| Flash Code | 674,638 B | `.text` (executable code)             |
| Flash Data | 132,284 B | `.rodata` 132,028 B + app descriptor  |
| DIRAM      | 112,331 B | 32.87% of 341,760 B internal RAM      |
| IRAM       | 16,384 B  | cache-locked instruction region, full |

The per-component breakdown is the useful part. The Wi-Fi and TLS stacks
dominate: `libnet80211.a` (Wi-Fi MAC) is ~146 KB, `liblwip.a` (TCP/IP)
~105 KB, `libmbedcrypto.a` (TLS) ~79 KB, and the
`libwpa_supplicant.a`/`libpp.a` Wi-Fi pair another ~129 KB combined.
The telemetry path is small against that: esp-mqtt (`libmqtt.a`) ~26 KB,
cJSON (`libjson.a`) ~3 KB, and the application itself - the SME-v1
serializer plus the publish loop - ~3.2 KB.

That distribution is the real argument for the bridge pattern. The
expensive parts of the firmware are the network and crypto you need for
any backend at all; the telemetry encoding rides along for a few
kilobytes. Once a device is on the network, adding structured telemetry
is close to free in flash terms.

## Security hardening

The example is plaintext and anonymous so it runs with no setup. Before
production:

- **Transport.** Switch to `mqtts://` with TLS. The ESP32 has the
  mbedTLS stack already linked; the cost is in the footprint table above.
- **Authentication.** Replace anonymous broker access with per-device
  credentials, ideally client certificates over mutual TLS.
- **Identity provisioning.** Devices need a provisioning flow that issues
  per-device keys or certs, not a shared secret baked into the image.
- **Topic ACLs.** Scope each device to its own topic subtree so a
  compromised device cannot publish as another.
- **Public brokers.** `test.mosquitto.org` is fine for the Wokwi demo and
  nowhere near production. Never send real telemetry through a public
  broker.

## Appendix: real OTLP over the wire

If you need strict wire-level OTLP rather than a custom envelope, the
path is [nanopb](https://github.com/nanopb/nanopb): generate C structs
from the OTLP `metrics.proto` and `trace.proto`, encode them on-device,
and publish the protobuf bytes over MQTT to a Collector with an MQTT
receiver (or a thin bridge that forwards bytes). This is **not
implemented in the example.** It costs more flash and a harder-to-read
payload, and it buys wire compatibility - worth it when a downstream
consumer expects OTLP protobuf directly and you cannot run a translating
bridge.

## Why this isn't a Collector receiver today

Beyond the [missing `mqttreceiver`](./index.md) the rest of the track
works around, the constrained-device path also has no embedded OTel SDK to
emit OTLP from the device itself. The clean future is an SDK or codec the
device links directly, paired with that upstream receiver; until then,
keep the envelope versioned and the bridge thin so swapping either side
later is a contained change.

## Troubleshooting

- **Nothing reaches the bridge.** Check the device and bridge agree on
  the broker and topic prefix. On the shared `test.mosquitto.org`, a
  collision with another user's prefix looks like silence; use a unique
  prefix on both sides.
- **`version_rejected_total` climbing.** A device is sending a `v` the
  bridge does not implement. Bump the bridge, do not loosen the check.
- **Timestamps look wrong after boot.** The device published before SNTP
  synced; those datapoints carry `mcu.ts_source=uptime`. Filter or
  annotate on that attribute.
- **Counter renders as a sawtooth.** A running-total metric was sent as a
  `gauge`. Send it as `kind: counter` so the bridge exports a Sum.
- **Nothing reaches Scout.** Confirm the Collector picked up the four
  `SCOUT_*` values; the debug exporter prints to stdout regardless, which
  separates a bridge problem from an export problem.

## Related guides

- [IoT & Edge overview](./index.md) - the resource attribute conventions
  every IoT example follows.
- [MQTT trace propagation](./mqtt-trace-propagation.md) - the broker and
  trace-context pattern this firmware extends to the device.
- [Edge Collector patterns](./edge-collector-patterns.md) - the
  store-and-forward Collector this example reuses for the backhaul.
- [Sparkplug B decoder](./sparkplug.md) - the other MQTT-to-OTLP bridge
  in this track; compare the envelope-versus-protobuf tradeoff.
- [Scout exporter wiring](../collector-setup/scout-exporter.md) - the
  `oauth2client` extension and `otlp_http/b14` exporter used here.
