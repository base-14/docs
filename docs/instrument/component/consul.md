---
title: >
  Consul OpenTelemetry Monitoring - Raft Consensus, Service Catalog,
  and Collector Setup
sidebar_label: Consul
id: collecting-consul-telemetry
sidebar_position: 18
description: >
  Collect Consul metrics with the OpenTelemetry Collector. Monitor Raft
  consensus, Autopilot cluster health, and service catalog state using the
  Prometheus receiver and export to base14 Scout.
keywords:
  - consul opentelemetry
  - consul otel collector
  - consul metrics monitoring
  - consul performance monitoring
  - opentelemetry prometheus receiver consul
  - consul observability
  - consul service discovery monitoring
  - consul telemetry collection
---

# Consul

Consul serves Prometheus-format metrics at
`/v1/agent/metrics?format=prometheus` on the HTTP API port `8500` once
`prometheus_retention_time` is set in the agent telemetry config. The
OpenTelemetry Collector's `prometheus` receiver scrapes that endpoint
directly, collecting 230+ metrics across Raft consensus, the service
catalog, RPC, gossip and membership, the service mesh, and the Go
runtime. This guide enables the endpoint, configures the receiver, and
ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Consul                 | 1.7.2   | 1.21+       |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- The Consul HTTP API port (8500) must be reachable from the host
  running the Collector.
- `prometheus_retention_time` must be set in the agent telemetry config
  (it is disabled by default - see [Access Setup](#access-setup)).
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review.

A few things about this surface before the tables:

- **`up` is the liveness signal here.** Unlike native-receiver
  components, Consul is scraped as a Prometheus target, so the receiver
  emits a real `up` series - `up` = 1 when the scrape of `:8500`
  succeeds. `consul_autopilot_healthy` (1 = enough voters alive and
  reachable) is the headline cluster-health flag that sits next to it.
- **`prometheus_retention_time` must be `> 0s`** in the agent telemetry
  config or the endpoint returns nothing - the default `0s` disables it.
  Set it to at least 2x the scrape interval.
- **Some metrics are leader-only.** `consul_raft_leader_lastContact` and
  `consul_raft_leader_dispatchLog` are emitted only by the current
  leader; followers emit `consul_raft_state_follower` instead. Seeing
  these on one server and not the others is expected, not a gap.
- **A double-prefix quirk affects the cache, FSM, and peering
  families.** They appear under both `consul_<x>` and `consul_consul_<x>`
  (for example `consul_cache_fetch_success` and
  `consul_consul_cache_fetch_success`). This is a Consul telemetry
  artifact, not a duplicate scrape; treat the pair as one family.

### Core - is the cluster up, quorate, and committing writes

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - 1 = the Consul agent metrics endpoint responded. The liveness signal on this surface. |
| `consul_autopilot_healthy` | Cluster health per Autopilot - 1 = enough voters alive and reachable, 0 = degraded. The headline cluster-health flag. |
| `consul_raft_peers` | Number of Raft peers (voting servers) the agent sees - the quorum picture. |
| `consul_raft_commitTime` | Time to commit a Raft log entry (ms) - the write-path latency of the whole cluster. |
| `consul_raft_leader_lastContact` | Time since the leader last contacted its followers (ms) - leader stability (leader-only). |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Leadership churn | `consul_raft_state_leader`, `consul_raft_state_candidate`, `consul_raft_state_follower` | Raft state transitions; `_candidate` incrementing means elections are happening. |
| Write throughput | `consul_raft_apply`, `consul_raft_commitNumLogs`, `consul_raft_last_index` | Log apply rate, logs per commit, and last index - throughput and replication progress. |
| Leader replication | `consul_raft_leader_dispatchLog`, `_dispatchNumLogs`, `_oldestLogAge` | Log-dispatch latency and oldest in-flight log - replication lag on the leader. |
| FSM apply | `consul_raft_fsm_apply`, `_enqueue`, `consul_raft_thread_fsm_saturation` | How fast committed entries become state, and thread saturation. |
| Membership | `consul_members_servers`, `consul_members_clients` | Server and client member counts - a drop means a node left the cluster. |
| Gossip | `consul_serf_member_join`, `consul_serf_events`, `consul_serf_queue_Event` / `_Intent` / `_Query`, `consul_memberlist_gossip`, `_queue_broadcasts` | Serf and memberlist activity and outbound queue depth - rising queues mean gossip back-pressure. |
| KV / transactions | `consul_kvs_apply`, `consul_txn_apply`, `consul_txn_read` | KV write and transaction apply/read latency through Raft. |
| Catalog | `consul_catalog_register`, `_deregister`, `consul_catalog_service_query`, `_connect_query`, `_service_not_found` | Service-catalog write and query rates plus miss counts - discovery load. |
| Server RPC | `consul_rpc_request`, `_request_error`, `consul_rpc_query`, `_queries_blocking`, `_cross_dc`, `_rate_limit_exceeded`, `_consistentRead` | RPC volume, errors, blocking queries, cross-DC calls, and rate-limit trips. |
| Client RPC | `consul_client_rpc`, `_exceeded`, `_failed` | Agent→server RPC calls, rate-limited, and failed - client-side RPC health. |
| gRPC transport | `consul_grpc_server_request_count`, `_connections`, `_streams`, `consul_grpc_client_*` | gRPC server/client connections, streams, and request counts (xDS + internal transport). |
| Replication health | `consul_leader_replication_acl_tokens_status`, `_acl_policies_status`, `_config_entries_status`, `_namespaces_status`, `_federation_state_status` | ACL/config replication health (1 = replicating) - non-1 means a secondary DC is falling behind. |
| Mesh CA expiry | `consul_mesh_active_root_ca_expiry`, `_signing_ca_expiry` | Time (s) until the Connect mesh CA root / signing cert expires - dropping toward 0 breaks mTLS issuance. |
| Peering | `consul_peering_healthy`, `consul_consul_peering_healthy`, `consul_state_peerings` | Cluster-peering connection health and peering count. |
| Failure tolerance | `consul_autopilot_failure_tolerance` | How many servers can fail before quorum is lost - 0 means no redundancy left. |
| Go runtime | `consul_runtime_alloc_bytes`, `_sys_bytes`, `_heap_objects`, `consul_runtime_num_goroutines`, `_gc_pause_ns`, `_total_gc_runs` | Consul process memory, goroutines, and GC pressure. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. The large families below are grouped - back-ticked names are
representative members, not the full list.

| Group | Metrics | When you reach for it |
|---|---|---|
| Per-endpoint API/RPC | `consul_client_api_*`, `consul_client_api_success_*`, `consul_client_rpc_error_*` (catalog_nodes, catalog_services, node_services, datacenters, ...) | Per-endpoint HTTP-API call, success, and RPC-error breakdown. |
| Agent cache | `consul_cache_*` / `consul_consul_cache_*` (`fetch_success`, `fetch_error`, `entries_count`, `evict_expired`, `connect_ca_root_hit` / `_miss_new`) | Cache hit/miss/fetch/evict internals, including Connect CA-root caching. |
| ACL subsystem | `consul_acl_*` (`ResolveToken`, `token_upsert` / `_cache_hit`, `policy_*`, `role_*`, `login` / `logout`, `blocked_*_registration`) | ACL resolution, CRUD, token cache, and blocked (unauthorized) registrations. Idle without ACLs enabled. |
| Per-type FSM timing | `consul_fsm_*` / `consul_consul_fsm_*` (`register`, `kvs`, `ca`, `intention`, `session`, `txn`, `prepared_query`, `peering`, `federation_state_dc1`) | Per-operation-type FSM apply timing - which kind of write is slow. |
| Raft WAL internals | `consul_raft_wal_*` (`log_appends`, `log_entries_written` / `_read`, `stable_gets` / `_sets`, `segment_rotations`, `head_truncations`, `last_segment_age_seconds`) | WAL storage-backend append/read volume, truncations, and segment rotation. |
| Leader housekeeping | `consul_leader_barrier`, `_reapTombstones`, `_reconcile`, `consul_leader_replication_*_index` | Leader loop timing and per-resource replication index positions. |
| xDS streams | `consul_xds_server_streams`, `_streamStart`, `_streamDrained`, `_idealStreamsMax` | Service-mesh xDS stream lifecycle internals. |
| Federation / sessions | `consul_federation_state_*`, `consul_prepared_query_*`, `consul_session_*`, `consul_session_ttl_active`, `consul_peering_exported_services` | Multi-DC federation, prepared queries, session TTLs, and exported-service counts. |
| Build info | `consul_version` | Build/version carried in labels - context, not a signal. |
| Runtime / scrape meta | `go_*`, `process_*`, `scrape_duration_seconds`, `scrape_samples_scraped`, `scrape_series_added` | Go-runtime, process, and Prometheus scrape meta the endpoint also exposes. |

Full metric list: run
`curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus'`
against your Consul agent.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
These are starting points; tune them to your cluster size and workload.
`up` and `consul_autopilot_healthy` read a state, not a tunable number;
the rest are relative to your baseline or to the expected server count.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The agent metrics endpoint stopped responding. Check the agent and the HTTP API port. |
| `consul_autopilot_healthy` | `== 0` | Autopilot sees the cluster as degraded - not enough voters alive/reachable. Check server health and Raft peers. |
| `consul_raft_peers` | Below the expected server count | A server left the quorum; restore the missing server(s) before another loss costs quorum. |
| `consul_autopilot_failure_tolerance` | `== 0` | The cluster can lose no further server without losing quorum - restore redundancy. |
| `rate(consul_raft_state_candidate)` | `> 0` | Elections are happening - an unstable leader. Check network, disk latency, and server load. |
| `consul_raft_leader_lastContact` | Rising vs baseline | The leader is slow to reach followers - network or follower load; precedes elections. |
| `consul_raft_commitTime` | Rising vs baseline | Write commits are slowing - check disk I/O on the servers and Raft log size. |
| `consul_mesh_active_signing_ca_expiry` / `_root_ca_expiry` | Dropping toward 0 | The mesh CA cert is approaching expiry - rotate before mTLS issuance fails. |
| `rate(consul_rpc_request_error)` / `consul_client_rpc_failed` | Rising vs baseline | Server/client RPCs are failing - check server reachability and rate limits. |
| `consul_runtime_alloc_bytes` / `consul_runtime_num_goroutines` | Rising vs baseline | The agent is leaking or under sustained pressure - correlate with request volume. |

## Access Setup

Enable the Prometheus metrics endpoint by adding a `telemetry` block to
the Consul agent config:

```json showLineNumbers title="consul-config.json"
{
  "telemetry": {
    "prometheus_retention_time": "60s",
    "disable_hostname": true
  }
}
```

- `prometheus_retention_time` must be greater than `0s` to enable the
  Prometheus endpoint (the default `0s` returns no Consul series). Set it
  to at least 2x the scrape interval so a missed scrape does not lose a
  window.
- `disable_hostname` removes hostname prefixes from gauge metrics for
  cleaner Prometheus labels.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Consul is running and has a leader
curl -s http://localhost:8500/v1/status/leader

# Verify the Prometheus metrics endpoint
curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus' \
  | head -20
```

No authentication is required by default. ACL-enabled clusters need a
token with `agent:read` permission on the scrape request - see the ACL
variant under [Configuration](#configuration).

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          scrape_interval: 30s
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:CONSUL_HOST}:8500
          metric_relabel_configs:
            # Scope to the Consul namespace; drops the endpoint's own
            # go_* / process_* runtime series.
            - source_labels: [__name__]
              regex: "consul_.*"
              action: keep

processors:
  resource:
    attributes:
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlphttp/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}
    tls:
      insecure_skip_verify: true

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [resource, batch]
      exporters: [otlphttp/b14]
```

The `metric_relabel_configs` keep filter scopes the scrape to the
`consul_` namespace - the endpoint also exposes the Go runtime
(`go_*`) and process (`process_*`) series, and this drops them at the
receiver. Drop the filter if you want those too. (The `prometheus`
receiver keeps whatever the endpoint exposes; there is no `metrics:`
enable list to curate.)

### Environment Variables

```bash showLineNumbers title=".env"
CONSUL_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### ACL-enabled clusters

For clusters with ACLs enabled, the scrape request needs a token with
`agent:read` permission. Add an `authorization` block to the scrape job:

```yaml showLineNumbers title="config/otel-collector.yaml (ACL)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          scrape_interval: 30s
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:CONSUL_TOKEN}
          static_configs:
            - targets:
                - ${env:CONSUL_HOST}:8500
```

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0).
> Scout's UI filters on the lowercase `environment` key, so emit it
> alongside the OTel-native `deployment.environment.name`. The legacy
> `deployment.environment` is still accepted for backward compatibility.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for a successful Consul scrape
docker logs otel-collector 2>&1 | grep -i "consul"

# Verify Consul is healthy
curl -s http://localhost:8500/v1/status/leader

# Check the metrics endpoint directly for a Core series
curl -s 'http://localhost:8500/v1/agent/metrics?format=prometheus' \
  | grep consul_raft_peers
```

## Troubleshooting

### Metrics endpoint returns empty or 404

**Cause**: `prometheus_retention_time` is not configured or set to `0s`,
so Consul emits no Prometheus series.

**Fix**:

1. Add `"prometheus_retention_time": "60s"` to the `telemetry` block in
   the agent config.
2. Restart the Consul agent.
3. Verify:
   `curl 'http://localhost:8500/v1/agent/metrics?format=prometheus'`.

### Connection refused on port 8500

**Cause**: The Collector cannot reach Consul at the configured address.

**Fix**:

1. Verify Consul is running: `docker ps | grep consul` or
   `consul members`.
2. Confirm the HTTP API address: `consul info | grep client_addr`.
3. Check firewall rules if the Collector runs on a separate host.

### Leader-side Raft metrics missing on a server

**Cause**: `consul_raft_leader_lastContact` and
`consul_raft_leader_dispatchLog` are emitted only by the current leader.

**Look at**: the Diagnostic `consul_raft_state_*` series - followers
report `consul_raft_state_follower` while the leader reports
`consul_raft_state_leader`. Their absence on a follower is expected.

**Fix**: Scrape every server independently (each is identified by its
`instance` label) so the leader's metrics are always captured wherever
leadership currently sits.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

### ACL permission denied

**Cause**: The token lacks `agent:read` permission.

**Fix**:

1. Create a policy with `agent_prefix "" { policy = "read" }`.
2. Attach the policy to a token and set it in `CONSUL_TOKEN`.
3. Test:
   `curl -H "Authorization: Bearer $CONSUL_TOKEN" 'http://localhost:8500/v1/agent/metrics?format=prometheus'`.

## FAQ

**Does this work with Consul running in Kubernetes?**

Yes. Set `targets` to the Consul service DNS
(e.g., `consul-server.consul.svc.cluster.local:8500`) and make sure
`prometheus_retention_time` is set in the server config. The Collector
can run as a sidecar or DaemonSet.

**How do I monitor a multi-node Consul cluster?**

Each Consul agent exposes its own metrics endpoint. Add every server to
the scrape config:

```yaml showLineNumbers
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: consul
          metrics_path: /v1/agent/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - consul-1:8500
                - consul-2:8500
                - consul-3:8500
```

Each agent is scraped independently and identified by its `instance`
label.

**Why are Raft leadership metrics only appearing on one node?**

`consul_raft_leader_lastContact` and `consul_raft_leader_dispatchLog`
are emitted only by the current leader. Other servers emit follower-side
metrics like `consul_raft_state_follower`. This is expected behavior, not
a collection gap.

**What does `consul_autopilot_healthy` mean?**

A value of `1` means Autopilot considers the cluster healthy - enough
voters are alive and reachable. A value of `0` indicates the cluster is
degraded. Monitor it alongside `consul_raft_peers` and
`consul_autopilot_failure_tolerance` for the full quorum picture.

**Why do some metrics appear twice with a `consul_consul_` prefix?**

The cache, FSM, and peering families are emitted under both `consul_<x>`
and `consul_consul_<x>` (for example `consul_cache_fetch_success` and
`consul_consul_cache_fetch_success`). This is a Consul telemetry naming
artifact, not a duplicate scrape - treat the pair as one family.

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Consul metrics.
- [Vault Monitoring](./vault.md) - Secrets and PKI control plane alongside Consul.
- [Nomad Monitoring](./nomad.md) - Workload scheduler on the same HashiCorp stack.
- [etcd Monitoring](./etcd.md) - Distributed consensus and key-value store.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Vault](./vault.md), [Nomad](./nomad.md), [etcd](./etcd.md), and other
  components.
- **Scope the Scrape**: Use the `consul_.*` keep filter in
  `metric_relabel_configs` to confine the scrape to the `consul_`
  namespace and leave the endpoint's `go_*` / `process_*` runtime series
  out of Scout.
