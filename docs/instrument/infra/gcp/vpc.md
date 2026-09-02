---
date: 2026-09-02
id: collecting-gcp-vpc-telemetry
title: Google Cloud VPC Monitoring with OpenTelemetry - Flow Logs and Cloud NAT
sidebar_label: VPC
sidebar_position: 10
description: >
  Collect VPC Flow Logs, Cloud NAT metrics and network telemetry into
  base14 Scout with the OpenTelemetry googlecloudpubsub receiver and the
  Cloud Logging encoding extension.
keywords:
  - vpc flow logs opentelemetry
  - gcp vpc monitoring scout
  - gcp flow logs otel semantic conventions
  - cloud nat port exhaustion monitoring
  - gce subnetwork logs
  - vpc network metrics otel
  - google cloud network observability
  - vpc flow logs sampling
---

VPC telemetry is mostly logs. Flow logs are the record of which
workloads talked to which, and they answer questions no metric can. They
are also high-volume and high-cardinality, so how you sample and filter
them matters more than how you collect them.

Read [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) first — this
guide builds directly on the sink and subscription it sets up.

:::note Running this in production

Storing and querying these logs at production volume is what base14
Scout does. [Check out Scout Logs](https://base14.io/scout/logs).

:::

## Overview

"VPC monitoring" covers three separate sources:

| Source | Signal | Where it comes from |
|---|---|---|
| **VPC Flow Logs** | Logs | Cloud Logging, `resource.type="gce_subnetwork"` |
| **Cloud NAT** | Metrics | Cloud Monitoring, `router.googleapis.com/nat/` |
| **Instance network** | Metrics | Cloud Monitoring, `compute.googleapis.com/instance/network/` |

Flow logs answer most of the questions. The metrics exist to catch two
network failures that are silent from inside a VM: NAT port exhaustion
and dropped packets.

:::warning Flow logs are expensive by default

At full sampling, a busy VPC produces more log volume than every other
source in these guides combined. Enable them per subnet rather than
per network, sample below 1.0, and filter in the collector. The
[Volume control](#volume-control) section is not optional reading.

:::

---

## Enabling flow logs

Flow logs are configured per subnet and are off by default:

```bash showLineNumbers
gcloud compute networks subnets update SUBNET_NAME \
  --region=REGION \
  --enable-flow-logs \
  --logging-aggregation-interval=interval-5-sec \
  --logging-flow-sampling=0.5 \
  --logging-metadata=include-all
```

Those three logging flags are the whole cost model:

| Flag | Effect | Recommendation |
|---|---|---|
| `--logging-aggregation-interval` | How long flows are aggregated before a log entry is written. Longer means fewer, coarser entries. | `interval-5-sec` for debugging, `interval-30-sec` or higher for steady state |
| `--logging-flow-sampling` | Fraction of flows logged, 0.0 to 1.0 | Start at `0.5`; drop to `0.1` on high-traffic subnets |
| `--logging-metadata` | Whether instance, geo and AS details are included | `include-all` while investigating, `exclude-all` otherwise |

Sampling applies to flows, not packets, so a sampled flow log still
reports that flow's complete byte and packet counts. Halving the sample
rate halves your log volume without halving the accuracy of any
individual flow you do see.

---

## Receiver configuration

Flow logs travel the standard Cloud Logging path. If you already run
that pipeline, add the subnet filter to your existing sink rather than
building a second one.

```bash showLineNumbers
gcloud logging sinks create scout-vpc-flow-logs \
  pubsub.googleapis.com/projects/PROJECT_ID/topics/scout-logs \
  --log-filter='resource.type="gce_subnetwork" AND logName:"compute.googleapis.com%2Fvpc_flows"'
```

```yaml showLineNumbers title="vpc-config.yaml"
extensions:
  # ...your existing extensions...
  google_cloud_logentry_encoding:
    handle_json_payload_as: "json"
    handle_proto_payload_as: "json"

receivers:
  # ...your existing receivers...
  googlecloudpubsub/vpc:
    project: ${env:GCP_PROJECT_ID}
    subscription: projects/${env:GCP_PROJECT_ID}/subscriptions/scout-vpc-flow-sub
    encoding: google_cloud_logentry_encoding

processors:
  resource/vpc:
    attributes:
      - {key: service.name, value: vpc-logs, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_vpc, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

  filter/vpc:
    error_mode: ignore
    logs:
      log_record:
        # Drop health check chatter from the GCP probe ranges
        - 'attributes["source.address"] != nil and (IsMatch(attributes["source.address"], "^35\\.191\\.") or IsMatch(attributes["source.address"], "^130\\.211\\."))'

  memory_limiter:
    limit_mib: 1024
    spike_limit_mib: 256
    check_interval: 5s

  batch:
    timeout: 10s
    send_batch_size: 2048

exporters:
  otlphttp/base14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  extensions: [google_cloud_logentry_encoding]
  pipelines:
    # ...your existing pipelines...
    logs/vpc:
      receivers: [googlecloudpubsub/vpc]
      processors: [memory_limiter, resource/vpc, filter/vpc, batch]
      exporters: [otlphttp/base14]
```

Note the larger `memory_limiter` and `send_batch_size` than the other
guides use. Flow logs arrive in bursts, and Pub/Sub will happily deliver
faster than a conservatively sized collector can export.

### Environment variables

```bash showLineNumbers title=".env"
GCP_PROJECT_ID=your-gcp-project-id
ENVIRONMENT=production
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io

# Not needed if using GKE Workload Identity
GOOGLE_APPLICATION_CREDENTIALS=/path/to/scout-telemetry-reader-key.json
```

---

## Why the encoding extension matters here

This is the strongest case anywhere in the GCP guides for
`google_cloud_logentry_encoding` over the raw log body. The extension
recognizes flow log entries as `gcp.vpcflow` format and maps them onto
network semantic conventions, so they are queryable as structured
attributes rather than as a JSON blob you have to parse at read time:

| Flow log field | OTel attribute |
|---|---|
| `connection.src_ip` | `source.address` |
| `connection.dest_ip` | `destination.address` |
| `connection.src_port` | `source.port` |
| `connection.dest_port` | `destination.port` |
| `connection.protocol` | `network.transport` |
| `bytes_sent` | `gcp.vpc.flow.bytes_sent` |
| `packets_sent` | `gcp.vpc.flow.packets_sent` |
| `rtt_msec` | `gcp.vpc.flow.network.rtt_ms` |
| `reporter` | `gcp.vpc.flow.reporter` |
| `src_instance.vm_name` | `gcp.vpc.flow.source.instance.vm.name` |
| `dest_instance.vm_name` | `gcp.vpc.flow.destination.instance.vm.name` |
| `src_vpc.subnetwork_name` | `gcp.vpc.flow.source.subnet.name` |
| `src_location.country` | `gcp.vpc.flow.source.geo.country.iso_code.alpha3` |
| `src_location.asn` | `gcp.vpc.flow.source.asn` |

`gcp.vpc.flow.reporter` says whether the source or destination VM
recorded the flow. Both ends log the same connection when both are in
instrumented subnets, so a naive byte total double-counts internal
traffic. Filter on one reporter value when summing.

The instance and geo attributes only exist if you set
`--logging-metadata=include-all`.

---

## Volume control

Three levers, in the order to reach for them:

1. **Sample at the subnet.** `--logging-flow-sampling=0.1` cuts volume
   by 90% before anything is written, which makes it the cheapest of the
   three by a wide margin.
2. **Enable only the subnets you care about.** Flow logs are per-subnet.
   A subnet running batch jobs that talk only to Cloud Storage rarely
   earns its log volume.
3. **Filter in the collector.** Health check probes from Google's ranges
   (`35.191.0.0/16` and `130.211.0.0/22`) are noise in most deployments,
   and the `filter/vpc` processor above drops them. Add your own patterns
   for anything else high-volume and uninteresting.

You can also narrow at the sink, which stops the data before it reaches
Pub/Sub and so avoids the delivery cost entirely:

```bash showLineNumbers
--log-filter='resource.type="gce_subnetwork"
  AND logName:"compute.googleapis.com%2Fvpc_flows"
  AND jsonPayload.connection.dest_port!=443'
```

:::warning Never key an aggregation on an IP address

Source and destination addresses are unbounded — every internet client
that reaches your VPC contributes a value. They are exactly what you
want to search and filter on, and exactly what you must not group by in
a rollup or dashboard. Aggregate on subnet, VM name, port or protocol
instead, and keep IPs for the drill-down.

:::

---

## Network metrics

A dropped or rejected connection produces no flow at all, so two metric
families exist to catch what the logs cannot show you.

Add these to the same collector as the flow log pipeline — the block
below shows only the new keys, to merge into the config above rather
than replace it.

```yaml showLineNumbers title="vpc-config.yaml (additions)"
receivers:
  googlecloudmonitoring/vpc:
    collection_interval: 60s
    project_id: ${env:GCP_PROJECT_ID}
    metrics_list:
      # Cloud NAT — port exhaustion is silent from inside the VM
      - metric_name: "router.googleapis.com/nat/allocated_ports"
      - metric_name: "router.googleapis.com/nat/port_usage"
      - metric_name: "router.googleapis.com/nat/dropped_sent_packets_count"
      - metric_name: "router.googleapis.com/nat/sent_bytes_count"
      - metric_name: "router.googleapis.com/nat/received_bytes_count"
      - metric_name: "router.googleapis.com/nat/open_connections"
      # Instance network
      - metric_name: "compute.googleapis.com/instance/network/sent_bytes_count"
      - metric_name: "compute.googleapis.com/instance/network/received_bytes_count"

processors:
  # Separate from resource/vpc — these are metrics, not flow logs
  resource/vpc_metrics:
    attributes:
      - {key: service.name, value: vpc-metrics, action: insert}
      - {key: cloud.provider, value: gcp, action: insert}
      - {key: cloud.platform, value: gcp_vpc, action: insert}
      - {key: cloud.account.id, value: "${env:GCP_PROJECT_ID}", action: insert}
      - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: upsert}
      - {key: environment, value: "${env:ENVIRONMENT}", action: upsert}

service:
  pipelines:
    metrics/vpc:
      receivers: [googlecloudmonitoring/vpc]
      processors: [memory_limiter, resource/vpc_metrics, batch]
      exporters: [otlphttp/base14]
```

The metrics pipeline uses `vpc-metrics` rather than the `vpc-logs` name
the flow log pipeline sets. Keeping the two apart means a query for
network metrics never scans flow log volume, which on this surface is a
large difference.

`nat/dropped_sent_packets_count` deserves particular attention. When a Cloud NAT
gateway runs out of ports, outbound connections fail from inside the VM
with a generic timeout, and nothing in the application logs explains it.
This metric is the only direct evidence.

:::note Instance network metrics scale with your fleet

`compute.googleapis.com/instance/network/*` produces one series per
instance. On a large autoscaled fleet that is a lot of series with high
churn. Collect them only if you need per-instance network attribution;
otherwise the NAT and flow log data usually suffices.

:::

---

## Alert tuning

| Signal | Source | Warning | Critical | Notes |
|---|---|---|---|---|
| NAT port exhaustion | `nat/dropped_sent_packets_count` | any | sustained | Every dropped packet is a failed outbound connection. |
| NAT port pressure | `nat/port_usage` vs `nat/allocated_ports` | > 0.7 | > 0.9 | The leading indicator for the row above. |
| Unexpected egress | `gcp.vpc.flow.bytes_sent` to external destinations | 2x baseline | 5x baseline | Cost and exfiltration both show up here. Filter to one `reporter` value. |
| New external destination | Flow logs by `destination.address` | — | — | Better as a scheduled review than a page. |
| Cross-region traffic | Flow logs by subnet pair | rising | — | Cross-region egress is billable and often accidental. |

---

## Verify

1. **The subscription is receiving.** Check the Pub/Sub subscription's
   unacked message count in the console. If it is zero and growing
   nowhere, the sink filter matches nothing.

2. **Entries were decoded, not passed through raw.** Look for
   `source.address` as an attribute. If the body is unparsed JSON, the
   encoding extension is missing from `service.extensions` or from the
   receiver's `encoding` field.

3. **Confirm logs landed:**

   ```sql showLineNumbers
   SELECT count() AS entries
   FROM otel_logs
   WHERE ServiceName = 'vpc-logs'
     AND TimestampTime >= now() - INTERVAL 1 HOUR
   SETTINGS max_execution_time = 30, max_rows_to_read = 50000000
   ```

4. **Check your volume before leaving it running.** Compare the entry
   count above against what you expected. This is the one source where a
   misconfiguration gets expensive within hours rather than weeks.

---

## Troubleshooting

**No flow logs at all, but the sink exists.**
Flow logs are enabled per subnet, not per network. Confirm with
`gcloud compute networks subnets describe SUBNET --region=REGION` and
look for `enableFlowLogs: true`.

**Log bodies are raw JSON with no network attributes.**
The `google_cloud_logentry_encoding` extension is not wired in. It must
appear in both the receiver's `encoding` field and the
`service.extensions` list.

**Instance names and geo fields are missing.**
`--logging-metadata` is set to `exclude-all` or to a metadata subset
that excludes them.

**Byte totals are roughly double what the billing console shows.**
Both ends of an internal flow log it — filter on a single
`gcp.vpc.flow.reporter` value when aggregating.

**The collector falls behind and Pub/Sub backlog grows.**
Flow logs burst. Raise `memory_limiter` and `send_batch_size`, and
reduce volume at the source with sampling before scaling the collector.

**Outbound connections fail intermittently but flow logs show nothing.**
A connection that never established produces no flow. Check
`router.googleapis.com/nat/dropped_sent_packets_count` for NAT port
exhaustion.

## FAQ

### How do I send GCP VPC Flow Logs to OpenTelemetry?

Enable flow logs on the subnet, route
`resource.type="gce_subnetwork"` through a Log Router sink into a
Pub/Sub topic, and consume it with the `googlecloudpubsub` receiver
using the `google_cloud_logentry_encoding` extension.

### Why should I use the encoding extension for flow logs?

The `google_cloud_logentry_encoding` extension recognizes the
`gcp.vpcflow` format and maps fields onto network semantic conventions —
`source.address`, `destination.port`, `network.transport` — so entries
are queryable as structured attributes
instead of a JSON blob parsed at read time.

### How do I reduce VPC Flow Log volume?

Sample at the subnet with `--logging-flow-sampling`, enable flow logs
only on subnets you care about, and filter health check probe ranges in
the collector. Sampling is by far the most effective of the three
because it acts before anything is written.

### Are VPC Flow Log byte counts double-counted?

Between two instrumented subnets, yes — both the source and the
destination VM log the same flow, so a naive sum reports roughly twice
the real volume. Filter on a single `gcp.vpc.flow.reporter` value.

### What VPC metrics should I alert on?

Alert on `router.googleapis.com/nat/dropped_sent_packets_count` above
all else. NAT port exhaustion makes outbound connections fail with
generic timeouts
that nothing in the application logs explains, and this metric is the
only direct evidence.

### Can I group dashboards by source IP address?

No — IP addresses are unbounded and will produce an enormous number of
series. Filter and search on them freely, but aggregate on subnet, VM
name, port or protocol.

## Reference

- [VPC Flow Logs](https://docs.cloud.google.com/vpc/docs/flow-logs)
- [Flow log record format](https://docs.cloud.google.com/vpc/docs/flow-logs#record_format)
- [Cloud NAT metrics](https://docs.cloud.google.com/nat/docs/monitoring)

## Related Guides

- [GCP Cloud Logging](./gcp-cloud-logging-to-scout.md) - the sink,
  topic and subscription this guide builds on.
- [GCP Monitoring overview](./overview.md) - the Cloud NAT metrics path
  in its general form, and the IAM it needs.
- [Cloud Load Balancing](./load-balancing.md) - the other high-volume
  log source, and where external traffic enters before it reaches a
  subnet.
