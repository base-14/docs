---
title: MQTT Trace Context Propagation with OpenTelemetry
sidebar_label: MQTT Trace Propagation
sidebar_position: 1
description:
  Propagate W3C trace context across an MQTT 5 broker using user
  properties so a producer, consumer, and downstream service appear as
  one distributed trace in base14 Scout.
keywords:
  - mqtt distributed tracing
  - mqtt 5 user properties
  - mqtt opentelemetry
  - iot trace propagation
  - w3c trace context mqtt
  - opentelemetry messaging
---

# MQTT Trace Context Propagation

Message brokers break the call stack. An HTTP request carries its trace
context in headers, but when a service publishes to MQTT and another
service consumes from it later, the link is lost unless you carry the
context across the broker yourself. This guide shows how to do that with
MQTT 5 user properties, so a producer, a consumer, and a downstream HTTP
service show up as one connected trace in Scout.

The companion runnable example lives at
[examples/iot/mqtt-trace-propagation](https://github.com/base-14/examples/tree/main/iot/mqtt-trace-propagation).

## Why the broker can stay "dark"

Mosquitto, like most MQTT brokers, has no OpenTelemetry integration, so
it produces no spans. That sounds like a gap in the trace, but it is
not one that matters. Distributed tracing does not require every hop to
be instrumented; it requires the endpoints to agree on a trace context.
As long as the producer injects the context and the consumer extracts
it, the two spans share one `trace_id` and the broker being invisible is
just an unlabeled edge between them. Trying to instrument the broker
would add operational weight for a span that tells you little the
producer and consumer spans do not already.

## Architecture

```text
producer (Python)              consumer (Python)            echo (FastAPI)
  publish span         MQTT 5     process span      HTTP       server span
  inject traceparent  --------->  extract context  ------->   (auto-instr.)
  into user props      Mosquitto  continue trace
        \                  (dark)        |                        /
         \________________ all export OTLP -> Collector -> Scout /
```

The producer opens a span per reading, serializes the trace context into
the PUBLISH user properties, and publishes. The consumer reads those
user properties back, restores the context, and opens a child span that
also wraps an instrumented HTTP call to the echo service. That last hop
proves the context flows past MQTT into an ordinary request span.

## Producer: inject context into user properties

The W3C TraceContext propagator writes into a plain dictionary. MQTT 5
user properties are a list of string key-value pairs. The bridge is just
turning one into the other:

```python
from opentelemetry.propagate import inject
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.properties import Properties

def context_to_user_properties(context=None):
    carrier = {}
    inject(carrier, context=context)
    return list(carrier.items())

# per publish, inside the producer span:
props = Properties(PacketTypes.PUBLISH)
props.UserProperty = context_to_user_properties(ctx)
client.publish(topic, payload, qos=1, properties=props)
```

The span is opened before the publish and closed on the QoS 1 `PUBACK`,
so its duration reflects the real broker round-trip. A message-id to
span map correlates the asynchronous ack callback back to the right
span.

## Consumer: extract context and continue the trace

On the receiving side, hand the user properties back to the propagator
as a carrier and start the consumer span as a child of the result:

```python
from opentelemetry import trace
from opentelemetry.propagate import extract
from opentelemetry.trace import SpanKind

def user_properties_to_context(user_property):
    carrier = dict(user_property or [])
    return extract(carrier)

# in on_message:
parent = user_properties_to_context(message.properties.UserProperty)
span = tracer.start_span(
    f"process {message.topic}", context=parent, kind=SpanKind.CONSUMER
)
```

Starting the span with the extracted context as its parent gives you a
single unbroken trace. Use a span **link** instead of a parent when one
consumer fans a batch of messages into separate units of work, where a
single parent would misrepresent the structure; for the one-message-per
-reading case here, a child span is the right choice.

## Messaging semantic-convention attributes

Both spans follow the OpenTelemetry messaging conventions so they render
consistently and are queryable by destination and operation:

| Attribute | Producer | Consumer |
| --- | --- | --- |
| `messaging.system` | `mqtt` | `mqtt` |
| `messaging.destination.name` | the publish topic | the received topic |
| `messaging.operation.type` | `publish` | `process` |
| `messaging.message.id` | per-message UUID | echoed from payload |

Span names follow the convention `{operation} {destination}`, giving
`publish sensors/sensor-001/reading` on the producer and
`process sensors/sensor-001/reading` on the consumer.

## Handling missing context

A message can arrive without trace context, for example from a client
that does not speak MQTT 5. The consumer must not drop it. Detect the
absence and start a new root span tagged so these orphans are easy to
find:

```python
if not has_trace_context(user_props):
    span = tracer.start_span(
        f"process {topic}", kind=SpanKind.CONSUMER,
        attributes={"mqtt.missing_context": True},
    )
```

Querying for `mqtt.missing_context=true` in Scout surfaces every message
that crossed the broker without a usable context, which is how you catch
a misconfigured or legacy publisher.

## Troubleshooting

- **Producer and consumer trace IDs do not match.** Confirm both clients
  connect with `protocol=MQTTv5`. On MQTT 3.1.1 there are no user
  properties, so the context never leaves the producer.
- **Consumer spans are all roots with `mqtt.missing_context=true`.** The
  publisher is not injecting context, or is publishing on 3.1.1. Check
  the producer is setting `UserProperty` on a `PacketTypes.PUBLISH`
  properties object.
- **Producer spans look instantaneous.** With QoS 0 there is no `PUBACK`
  to end the span on, so it closes as soon as the packet is handed to the
  client. Use QoS 1 if you want the span to measure the publish
  round-trip.
- **Nothing reaches Scout.** Verify the Collector picked up the four
  `SCOUT_*` values and that the OAuth2 token endpoint is reachable; the
  Collector's debug exporter prints spans to stdout regardless, which
  isolates a propagation problem from an export problem.

## MQTT 3.1.1 note

MQTT 3.1.1 has no user properties. Carrying trace context on 3.1.1 means
encoding it into the message payload itself, which couples the transport
to your schema and is out of scope here. MQTT 5 is required for the
clean, header-style propagation this guide uses.

## Related guides

- [IoT & Edge overview](./index.md) - the resource attribute conventions
  every IoT example follows.
- [Collector Setup](../collector-setup/docker-compose-example.md) - the runtime
  that hosts the Collector in this example.
- [Scout exporter wiring](../collector-setup/scout-exporter.md) - the
  `oauth2client` extension and `otlp_http/b14` exporter used here.
