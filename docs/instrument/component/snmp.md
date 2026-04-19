---
title: >
  SNMP OpenTelemetry Monitoring - Network Devices, UPSes, and
  Infrastructure Metrics
sidebar_label: SNMP
id: collecting-snmp-telemetry
sidebar_position: 43
description: >
  Collect SNMP metrics from routers, switches, UPSes, and any
  net-snmp host with the OpenTelemetry Collector's snmpreceiver.
  Map OIDs to OTel metrics and ship to base14 Scout.
keywords:
  - snmp opentelemetry
  - snmp otel collector
  - snmp metrics monitoring
  - network device monitoring
  - router switch monitoring opentelemetry
  - ups monitoring snmp
  - opentelemetry snmp receiver
  - if-mib opentelemetry
  - host-resources-mib opentelemetry
  - powernet-mib opentelemetry
  - iot monitoring snmp
---

# SNMP

The OpenTelemetry Collector's `snmpreceiver` polls SNMP-speaking
devices over UDP, converts enterprise and standard MIB OIDs to named
metrics, and exports OTLP to base14 Scout. Use it for network gear
(routers, switches, firewalls), power infrastructure (UPSes, PDUs),
printers, and any host running `net-snmp`. This guide configures
three representative device profiles — a Linux host, a Cisco-style
router, and an APC-style UPS — and ships the metrics upstream.

The same pattern generalises to any SNMPv1/v2c/v3-capable device.
Because `snmpreceiver` is poll-only, it is particularly well suited
to monitoring infrastructure that cannot run agents itself — which
makes SNMP a natural bridge into broader IoT and OT telemetry work.

## Prerequisites

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| SNMP version | v1 | v2c or v3 |
| OTel Collector Contrib | 0.90.0 | 0.149.0+ |
| Target devices | SNMP-enabled | SNMPv2c/v3 with community or user configured |
| base14 Scout | Any | - |

Before starting:

- Devices must be reachable over UDP/161 from the Collector host
- A read-only community string (v1/v2c) or SNMPv3 user with
  appropriate auth/priv keys
- OTel Collector installed — see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md)

## What You'll Monitor

- **Linux / net-snmp hosts**: memory (total, available, cached,
  buffered), per-CPU utilization, 1/5/15-minute load averages,
  process and user session counts
- **Network devices** (IF-MIB): per-interface bytes in/out
  (64-bit ifHCOctets), error counters, nominal speed,
  administrative and operational status, interface count
- **UPSes** (PowerNet-MIB and standard UPS-MIB): battery status,
  capacity, temperature, runtime remaining, input voltage and
  frequency, output voltage, load percentage, current, online/on-battery
  state
- **Any scalar or table OID** the device exposes — `snmpreceiver`
  treats OIDs as first-class; you map each to a metric with a unit
  and description

Full receiver reference:
[OTel SNMP Receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/snmpreceiver).

The runnable example with a built-in SNMP simulator lives at
[base14/examples — components/snmp-telemetry](https://github.com/base-14/examples/tree/main/components/snmp-telemetry).
It ships three simulated devices (communities `linux-host`,
`cisco-router`, `apc-ups`) on `udp://snmpsim:1161`, so the config
below works unchanged against the simulator if you swap the real
endpoints for that address.

## Access Setup

No code runs on the device. All you need is SNMP read access.

**SNMPv2c** — enable `snmpd` and set a read-only community:

```text showLineNumbers title="/etc/snmp/snmpd.conf (Linux)"
rocommunity readonly_community_here  default
sysLocation  "rack-A1, row-3"
sysContact   "ops@example.com"
```

Then restart `snmpd` and test from the host that will run the
Collector:

```bash showLineNumbers
snmpwalk -v2c -c readonly_community_here -t 2 target-host:161 \
  1.3.6.1.2.1.1.1
```

**SNMPv3** — prefer `authPriv` with SHA/AES:

```text showLineNumbers title="/etc/snmp/snmpd.conf"
createUser monitor SHA "auth-key-here" AES "priv-key-here"
rouser  monitor priv
```

For network gear, the vendor CLI equivalents apply (Cisco
`snmp-server community`, Junos `snmp { community }`, etc.). Always
scope communities and SNMPv3 users to the Collector host's source
address when the device supports it.

## Configuration

The `snmpreceiver` takes one endpoint per receiver instance, so use
one instance per device (or per device class sharing credentials).
Metrics are defined by OID with an explicit `unit` and either
`scalar_oids` (values ending in `.0`) or `column_oids` (indexed
tables). Table rows fan out to separate resources via
`resource_attributes`.

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  snmp/linux:
    collection_interval: 30s
    endpoint: udp://linux-host.internal:161
    version: v2c
    community: ${env:SNMP_COMMUNITY_LINUX}

    resource_attributes:
      device.id:
        scalar_oid: "1.3.6.1.2.1.1.5.0"   # sysName
      cpu.index:
        indexed_value_prefix: "cpu_"

    metrics:
      system.processes.count:
        description: Number of processes running (hrSystemProcesses)
        unit: "{processes}"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.2.1.25.1.6.0"

      system.users.count:
        description: Active user sessions (hrSystemNumUsers)
        unit: "{users}"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.2.1.25.1.5.0"

      system.memory.total:
        description: Total real memory (UCD memTotalReal)
        unit: KiBy
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.4.5.0"

      system.memory.available:
        description: Available real memory (UCD memAvailReal)
        unit: KiBy
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.4.6.0"

      system.memory.cached:
        description: Cached memory (UCD memCached)
        unit: KiBy
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.4.11.0"

      system.memory.buffered:
        description: Buffered memory (UCD memBuffer)
        unit: KiBy
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.4.14.0"

      system.cpu.load_average.1m:
        description: "1-minute load average x 100 (UCD laLoadInt.1)"
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.10.1.5.1"

      system.cpu.load_average.5m:
        description: "5-minute load average x 100 (UCD laLoadInt.2)"
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.10.1.5.2"

      system.cpu.load_average.15m:
        description: "15-minute load average x 100 (UCD laLoadInt.3)"
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.2021.10.1.5.3"

      system.cpu.utilization:
        description: Per-CPU utilization (hrProcessorLoad)
        unit: "%"
        gauge: { value_type: int }
        column_oids:
          - oid: "1.3.6.1.2.1.25.3.3.1.2"
            resource_attributes: [cpu.index]

  snmp/router:
    collection_interval: 30s
    endpoint: udp://edge-router.internal:161
    version: v2c
    community: ${env:SNMP_COMMUNITY_ROUTER}

    resource_attributes:
      device.id:
        scalar_oid: "1.3.6.1.2.1.1.5.0"
      network.interface.name:
        oid: "1.3.6.1.2.1.31.1.1.1.1"     # ifName

    attributes:
      direction:
        enum: [receive, transmit]

    metrics:
      system.network.interfaces.count:
        description: Number of network interfaces (IF-MIB ifNumber)
        unit: "{interfaces}"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.2.1.2.1.0"

      network.io:
        description: Interface I/O bytes (ifHCInOctets / ifHCOutOctets)
        unit: By
        sum:
          value_type: int
          monotonic: true
          aggregation: cumulative
        column_oids:
          - oid: "1.3.6.1.2.1.31.1.1.1.6"
            resource_attributes: [network.interface.name]
            attributes:
              - { name: direction, value: receive }
          - oid: "1.3.6.1.2.1.31.1.1.1.10"
            resource_attributes: [network.interface.name]
            attributes:
              - { name: direction, value: transmit }

      network.errors:
        description: Interface errors (ifInErrors / ifOutErrors)
        unit: "{errors}"
        sum:
          value_type: int
          monotonic: true
          aggregation: cumulative
        column_oids:
          - oid: "1.3.6.1.2.1.2.2.1.14"
            resource_attributes: [network.interface.name]
            attributes:
              - { name: direction, value: receive }
          - oid: "1.3.6.1.2.1.2.2.1.20"
            resource_attributes: [network.interface.name]
            attributes:
              - { name: direction, value: transmit }

      network.interface.speed:
        description: Interface nominal speed (ifHighSpeed)
        unit: "Mbit/s"
        gauge: { value_type: int }
        column_oids:
          - oid: "1.3.6.1.2.1.31.1.1.1.15"
            resource_attributes: [network.interface.name]

      network.interface.admin_status:
        description: "ifAdminStatus - 1=up, 2=down, 3=testing"
        unit: "1"
        gauge: { value_type: int }
        column_oids:
          - oid: "1.3.6.1.2.1.2.2.1.7"
            resource_attributes: [network.interface.name]

      network.interface.oper_status:
        description: "ifOperStatus - 1=up, 2=down, 3=testing, 4=unknown, 5=dormant"
        unit: "1"
        gauge: { value_type: int }
        column_oids:
          - oid: "1.3.6.1.2.1.2.2.1.8"
            resource_attributes: [network.interface.name]

  snmp/ups:
    collection_interval: 30s
    endpoint: udp://ups-dc01.internal:161
    version: v2c
    community: ${env:SNMP_COMMUNITY_UPS}

    resource_attributes:
      device.id:
        scalar_oid: "1.3.6.1.2.1.1.5.0"

    metrics:
      ups.battery.status:
        description: "Battery status - 1=unknown, 2=normal, 3=low, 4=replace"
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.2.1.1.0"

      ups.battery.capacity:
        description: Remaining battery capacity (upsAdvBatteryCapacity)
        unit: "%"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.2.2.1.0"

      ups.battery.temperature:
        description: Battery temperature (upsAdvBatteryTemperature)
        unit: "Cel"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.2.2.2.0"

      ups.battery.runtime_remaining:
        description: Estimated runtime remaining, centiseconds (TimeTicks)
        unit: "cs"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.2.2.3.0"

      ups.battery.replace_indicator:
        description: "1=no replacement needed, 2=battery needs replacement"
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.2.2.4.0"

      ups.input.voltage:
        description: Input line voltage (upsAdvInputLineVoltage)
        unit: "V"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.3.2.1.0"

      ups.input.frequency:
        description: Input line frequency (upsAdvInputFrequency)
        unit: "Hz"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.3.2.4.0"

      ups.output.status:
        description: "Output status - 2=onLine, 3=onBattery, 4=onSmartBoost, ..."
        unit: "1"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.4.1.1.0"

      ups.output.voltage:
        description: Output voltage (upsAdvOutputVoltage)
        unit: "V"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.4.2.1.0"

      ups.output.load:
        description: Output load as percent of rated capacity
        unit: "%"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.4.2.3.0"

      ups.output.current:
        description: Output current (upsAdvOutputCurrent)
        unit: "A"
        gauge: { value_type: int }
        scalar_oids:
          - oid: "1.3.6.1.4.1.318.1.1.1.4.2.4.0"

processors:
  memory_limiter:
    check_interval: 5s
    limit_percentage: 80
    spike_limit_percentage: 25

  batch:
    timeout: 10s
    send_batch_size: 1024

  # Static metadata per pipeline. snmpreceiver only attaches values
  # it can retrieve via SNMP; constants like service.name and
  # device.kind are added here. Each device gets a distinct
  # service.name so it appears as its own service in Scout.
  resource/linux:
    attributes:
      - { key: service.name,            value: "linux-host-01",            action: insert }
      - { key: service.namespace,       value: ${env:SERVICE_NAMESPACE},   action: insert }
      - { key: environment,             value: ${env:ENVIRONMENT},         action: insert }
      - { key: device.kind,             value: compute,                    action: insert }
      - { key: device.manufacturer,     value: "generic-linux",            action: insert }
      - { key: device.model.identifier, value: "net-snmp",                 action: insert }
      - { key: site.id,                 value: ${env:SITE_ID},             action: insert }

  resource/router:
    attributes:
      - { key: service.name,            value: "cisco-router-01",          action: insert }
      - { key: service.namespace,       value: ${env:SERVICE_NAMESPACE},   action: insert }
      - { key: environment,             value: ${env:ENVIRONMENT},         action: insert }
      - { key: device.kind,             value: network,                    action: insert }
      - { key: device.manufacturer,     value: "cisco",                    action: insert }
      - { key: device.model.identifier, value: "ISR-C2900",                action: insert }
      - { key: site.id,                 value: ${env:SITE_ID},             action: insert }

  resource/ups:
    attributes:
      - { key: service.name,            value: "apc-ups-01",               action: insert }
      - { key: service.namespace,       value: ${env:SERVICE_NAMESPACE},   action: insert }
      - { key: environment,             value: ${env:ENVIRONMENT},         action: insert }
      - { key: device.kind,             value: power,                      action: insert }
      - { key: device.manufacturer,     value: "apc",                      action: insert }
      - { key: device.model.identifier, value: "Smart-UPS-SRT",            action: insert }
      - { key: site.id,                 value: ${env:SITE_ID},             action: insert }

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics/linux:
      receivers: [snmp/linux]
      processors: [memory_limiter, resource/linux, batch]
      exporters: [otlphttp/b14]
    metrics/router:
      receivers: [snmp/router]
      processors: [memory_limiter, resource/router, batch]
      exporters: [otlphttp/b14]
    metrics/ups:
      receivers: [snmp/ups]
      processors: [memory_limiter, resource/ups, batch]
      exporters: [otlphttp/b14]
```

### Environment Variables

```bash showLineNumbers title=".env"
SNMP_COMMUNITY_LINUX=readonly_community_here
SNMP_COMMUNITY_ROUTER=readonly_community_here
SNMP_COMMUNITY_UPS=readonly_community_here

# Service identity — each device pipeline stamps its own service.name
# (linux-host-01 / cisco-router-01 / apc-ups-01). These env vars
# apply to all three.
SERVICE_NAMESPACE=network-infra
ENVIRONMENT=demo
SITE_ID=your-site-id

OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.<your-tenant>.base14.io
```

Every metric carries a service.name/service.namespace/environment
set and the IoT device schema: `device.id`, `device.kind`
(`compute` / `network` / `power`), `device.manufacturer`,
`device.model.identifier`, `site.id`. Network gear is a compute
device with `device.kind=network` — there is no separate
`network.device.*` namespace. Each simulated (or real) device
appears as its own service in Scout because each receiver pipeline
stamps a distinct `service.name`.

### Shipping via a Local Scout Collector

The `otlphttp/b14` exporter above ships directly to Scout. If you
already run a tenant-local Scout Collector — recommended when you
have multiple apps on the same host, need local buffering, or want
a single point of auth — forward metrics to it instead:

```yaml showLineNumbers title="config/otel-collector.yaml (alternative)"
exporters:
  otlphttp/upstream:
    endpoint: http://otel-collector-base14:4318
```

Then join the Scout Collector's Docker network so DNS resolves the
container name:

```yaml showLineNumbers title="docker-compose.yaml"
services:
  otel-collector:
    # ...
    networks:
      - default
      - otel-collector-network

networks:
  otel-collector-network:
    external: true
```

For setting up that upstream Scout Collector, see
[Docker Compose Setup](../collector-setup/docker-compose-example.md).

## Verify the Setup

Start the Collector and check for successful scrapes within 60
seconds. From the host running the Collector:

```bash showLineNumbers
# Probe each device reachability and credentials
snmpwalk -v2c -c "$SNMP_COMMUNITY_LINUX"  -t 2 linux-host.internal:161  1.3.6.1.2.1.1.1
snmpwalk -v2c -c "$SNMP_COMMUNITY_ROUTER" -t 2 edge-router.internal:161 1.3.6.1.2.1.31.1.1.1.6
snmpwalk -v2c -c "$SNMP_COMMUNITY_UPS"    -t 2 ups-dc01.internal:161    1.3.6.1.4.1.318.1.1.1.2.2

# Confirm the Collector emitted metrics
docker logs otel-collector 2>&1 | grep -E 'Name: (network\.io|ups\.|system\.)'
```

## Troubleshooting

### `no such host` or DNS lookup failures

**Cause**: The Collector cannot resolve the device hostname, or a
Docker network isolates it from the device.

**Fix**:

1. Use an IP literal in `endpoint` if DNS is not available inside
   the Collector container
2. On Docker Desktop, use `host.docker.internal` to reach services
   on the host
3. Run the Collector with `network_mode: host` if the target is on
   the host's network segment

### `Request timeout` on scrape

**Cause**: Device is slow to respond, or UDP packets are being
dropped.

**Fix**:

1. Raise `timeout: 10s` on the receiver block
2. Lower `collection_interval` pressure if the device is resource-
   constrained (default 30s is usually fine)
3. Verify UDP/161 is not blocked by an ACL or firewall between
   Collector and device

### `No Such Instance` for Counter64 OIDs

**Cause**: The device does not support the `ifXTable` (IF-MIB
high-capacity counters), common on older hardware.

**Fix**:

Fall back to 32-bit counters:

```yaml
column_oids:
  - oid: "1.3.6.1.2.1.2.2.1.10"   # ifInOctets (Counter32)
    resource_attributes: [network.interface.name]
    attributes:
      - { name: direction, value: receive }
```

Expect wraparound on high-throughput interfaces; ifInOctets wraps
at ~34 GiB.

### Metric values look wrong by a factor of 10 or 100

**Cause**: Several MIBs store fixed-point values as scaled integers
(for example, UCD `laLoadInt` uses ×100; PowerNet `upsAdvOutputFrequency`
uses units of 0.1 Hz). `upsAdvBatteryRunTimeRemaining` is a
`TimeTicks` value — centiseconds, not seconds — so a 30-minute
runtime reads as `180000`.

**Fix**:

1. Check the MIB definition for the OID's `UNITS` clause
2. Document the scale in the metric `description`, or
3. Apply a `transform` processor to rescale before export

### Scrape errors flood the log during a device outage

**Cause**: The receiver logs each failed scrape at error level.

**Fix**:

The Collector pipeline keeps running — the error entries are
expected and recoverable. To quiet them, increase
`collection_interval` for the flaky receiver, or route the
Collector's own logs through a `filter/logs` processor that drops
`snmp` scrape errors.

## FAQ

**Does this work with SNMPv3?**

Yes. Set `version: v3` and provide `user`, `security_level`,
`auth_type`, `auth_password`, `privacy_type`, and `privacy_password`
as appropriate. Prefer `authPriv` with SHA-256 and AES-256 on
production gear.

**How do I monitor many similar devices without repeating YAML?**

`snmpreceiver` does not have a native templating feature, but the
Collector config can be rendered from a template (Jinja, envsubst,
Helm). Generate one `snmp/<device>` block per target and share the
metric definitions via YAML anchors, or manage the config as code
and let the generator emit identical metric blocks.

**Can I receive SNMP traps with this receiver?**

No. `snmpreceiver` is poll-only. Trap ingestion is handled by a
separate (still-in-development) receiver. If you need traps now,
forward them into the Collector as logs via `snmptrapd` + a file or
syslog receiver.

**What's the difference between using `scalar_oid` vs `oid` under
`resource_attributes`?**

`scalar_oid` fetches a single value (must end in `.0`) and stamps
every metric from this receiver with it — use it for device-wide
attributes like `device.id` from `sysName`. `oid` points to a
column and produces per-index resources — use it for things that
vary per row like interface names.

**Why is `device.kind` set by a processor and not the receiver?**

`snmpreceiver` can only attach values it fetches over SNMP. Static
labels like `device.kind=network` don't exist on the device, so we
add them with a `resource` processor scoped to each device
pipeline. This keeps each pipeline self-contained.

**Can I map string values (DisplayString) to numeric metrics?**

No. `snmpreceiver` expects numeric types (Integer, Counter*,
Gauge32, TimeTicks). If a MIB returns a DisplayString like UCD
`laLoad` (`"0.21"`), switch to the integer-scaled sibling OID
(`laLoadInt`, ×100) and document the scaling in the metric
description.

**Does polling add significant load on devices?**

A 30-second `collection_interval` against a dozen scalar OIDs and
a single interface table is negligible for modern network gear.
For very large `ifTable` walks on older devices, raise the
interval or reduce the column list.

## What's Next?

- **Create Dashboards**: Start with interface throughput, CPU load,
  and UPS battery capacity panels. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md)
- **Add more devices**: Drop in a switch MIB, a PDU MIB, or a
  printer MIB — the `snmpreceiver` pattern is the same. The
  runnable example at
  [components/snmp-telemetry](https://github.com/base-14/examples/tree/main/components/snmp-telemetry)
  shows how to add a fourth device.
- **Broaden IoT coverage**: SNMP is the first hop into IoT
  monitoring. See the
  [IoT OTel landscape](https://github.com/base-14/examples) notes
  for MQTT, Sparkplug B, and OPC-UA paths when you need protocols
  SNMP cannot reach.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) —
  Advanced Collector configuration
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) —
  Run the Collector locally
- [Docker Monitoring](./docker.md) — Host-level container metrics
  alongside network gear
- [HAProxy Monitoring](./haproxy.md) — Monitor the load balancer in
  front of those network devices
