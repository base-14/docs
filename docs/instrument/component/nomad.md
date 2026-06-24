---
title: >
  Nomad OpenTelemetry Monitoring - Raft Consensus, Scheduler,
  and Collector Setup
sidebar_label: Nomad
id: collecting-nomad-telemetry
sidebar_position: 29
description: >
  Collect Nomad metrics with the OpenTelemetry Collector. Monitor
  Raft consensus, the eval broker and scheduler, blocked evals, and
  job status, and ship to base14 Scout.
keywords:
  - nomad opentelemetry
  - nomad otel collector
  - nomad metrics monitoring
  - nomad performance monitoring
  - opentelemetry prometheus receiver nomad
  - nomad observability
  - nomad scheduler monitoring
  - nomad telemetry collection
---

# Nomad

Nomad serves Prometheus-format text at
`/v1/metrics?format=prometheus` on the HTTP API port `4646` once
`prometheus_metrics = true` is set in the agent telemetry block.
The OpenTelemetry Collector's `prometheus` receiver scrapes that
endpoint, collecting 130+ server metrics across Raft consensus, the
eval broker and scheduler, blocked evaluations, job status, RPC,
gossip and membership, and the Go runtime. This guide configures the
receiver, enables the endpoint, and ships metrics to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| Nomad                  | 1.3.0   | 1.9         |
| OTel Collector Contrib | 0.90.0  | 0.153.0     |
| base14 Scout           | Any     | -           |

Before starting:

- The Nomad HTTP API port (`4646`) must be reachable from the host
  running the Collector.
- `prometheus_metrics` must be enabled in the agent telemetry block -
  it is not on by default, and without it the endpoint returns nothing.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Docker Compose Setup](../collector-setup/docker-compose-example.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Scrape Core
always, alert on Operational, and reach for Diagnostic during an
incident or capacity review. The `prometheus` receiver keeps everything
the endpoint exposes; a keep filter (see [Configuration](#configuration))
scopes the scrape to the Nomad namespace.

A few surface facts shape what you see:

- **`up` is the liveness signal here.** The `prometheus` receiver emits
  `up = 1` when the API metrics endpoint responds, so you alert on the
  scrape itself - not on a synthetic heartbeat. `nomad_nomad_autopilot_healthy`
  (`1` = enough voters alive and reachable) is the headline cluster-health
  flag, and `nomad_nomad_blocked_evals_total_blocked` (rising = work cannot
  be placed) is the headline scheduling signal.
- **`prometheus_metrics = true` is the on-switch.** It defaults to
  `false`; until it is set, `/v1/metrics?format=prometheus` returns an
  error and the receiver sees only `up` and the Go runtime series.
- **Server vs client metrics.** A Nomad *server* emits the Raft, broker,
  scheduler, and job families documented here. The client and allocation
  families (`nomad_client_host_*`, `nomad_client_allocated_*`,
  `nomad_client_allocs_*`) are emitted only by Nomad *client* agents with
  `publish_node_metrics` / `publish_allocation_metrics` enabled - scrape
  the client agents (also on `:4646`) to collect them.
- **Double-prefix quirk.** Server-subsystem metrics are double-prefixed
  `nomad_nomad_*` (for example `nomad_nomad_blocked_evals_total_blocked`)
  because both the telemetry prefix and the server subsystem are named
  `nomad`. Infrastructure families use a single prefix
  (`nomad_raft_*`, `nomad_serf_*`, `nomad_runtime_*`). Reproduce the
  names exactly as you see them on the endpoint.
- **Leader-only metrics.** The eval broker, blocked evals, and
  `nomad_raft_leader_*` are emitted by the current leader; followers
  report `nomad_raft_state_follower`.

### Core - is it up, has quorum, and placing work

| Metric | What it tells you |
|---|---|
| `up` | Scrape liveness - `1` means the Nomad API metrics endpoint responded. The liveness signal on this surface. |
| `nomad_nomad_autopilot_healthy` | Cluster health per Autopilot - `1` = enough voters alive and reachable, `0` = degraded. The headline cluster-health flag. |
| `nomad_raft_peers` | Number of Raft peers (voting servers) - the quorum picture. |
| `nomad_raft_commitTime` | Time to commit a Raft log entry - the cluster's write-path latency. |
| `nomad_nomad_blocked_evals_total_blocked` | Evaluations that cannot be placed (no capacity / failed constraints) - the headline "are jobs getting scheduled" signal. |

### Operational - what to alert on

| Group | Metrics | What it tells you |
|---|---|---|
| Quorum margin | `nomad_nomad_autopilot_failure_tolerance` | How many servers can fail before quorum is lost - `0` means no redundancy left. |
| Raft state | `nomad_raft_state_leader` / `_candidate` / `_follower`, `nomad_raft_transition_heartbeat_timeout` | Raft state transitions; `_candidate` or heartbeat-timeout incrementing means elections and leadership churn. |
| Raft apply | `nomad_raft_apply`, `_commitNumLogs`, `_appliedIndex`, `_lastIndex`, `_barrier` | Apply rate, logs per commit, and replication-index progress. |
| Leader path | `nomad_raft_leader_dispatchLog` / `_oldestLogAge`, `nomad_raft_fsm_apply`, `nomad_nomad_leader_establish_leadership` / `_reconcile` | Leader log-dispatch and FSM apply latency; leadership establishment and reconciliation timing. |
| Eval broker | `nomad_nomad_broker_total_ready` / `_unacked` / `_pending` / `_waiting` / `_cancelable`, `nomad_nomad_broker_process_time` | Eval-broker queue depth and processing latency - a rising backlog means schedulers are falling behind. |
| Scheduler pipeline | `nomad_nomad_plan_queue_depth` / `_apply`, `nomad_nomad_eval_create` / `_ack` / `_dequeue`, `nomad_nomad_worker_invoke_scheduler_service` / `_submit_plan` | Plan queue depth, plan-application latency, and scheduler-worker step timing - placement throughput. |
| Blocked-eval breakdown | `nomad_nomad_blocked_evals_total_escaped` / `_total_quota_limit` / `_job_cpu` / `_job_memory` | Why evals are blocked - node-class escapes, quota limits, and CPU/memory pressure. |
| Job status | `nomad_nomad_job_status_running` / `_pending` / `_dead`, `nomad_nomad_job_summary_running` / `_failed` / `_lost` / `_queued` / `_complete` | Job counts by status and per-job allocation summary - `_failed` / `_lost` rising means workloads are unhealthy. |
| Heartbeats | `nomad_nomad_heartbeat_active` | Active client heartbeats the leader is tracking - drops mean clients disconnecting. |
| RPC | `nomad_nomad_rpc_request` / `_query` / `_accept_conn` | Server RPC volume and accepted connections. |
| Gossip | `nomad_serf_member_join`, `nomad_serf_queue_Event` / `_Intent`, `nomad_memberlist_gossip` / `_queue_broadcasts` | Server gossip activity and outbound queue depth - rising queues mean gossip back-pressure. |
| Runtime | `nomad_runtime_alloc_bytes` / `_sys_bytes` / `_heap_objects` / `_num_goroutines` / `_gc_pause_ns` | Nomad process Go-runtime memory, goroutines, and GC pressure. |

### Diagnostic - for investigation and tuning

Higher cardinality; reach for these during an incident or a capacity
review. The families below are grouped - representative members are
shown, not the full list.

| Group | Metrics | When you reach for it |
|---|---|---|
| Raft storage internals | `nomad_raft_boltdb_*` (e.g. `writeDuration`, `freelistBytes`, `numFreePages`, `logSize`, `openReadTxn`) | Storage-backend write capacity/latency and freelist/page accounting. |
| Per-type FSM timing | `nomad_nomad_fsm_apply_plan_results` / `_register_job` / `_update_eval` / `_apply_scheduler_config` | Which kind of write is slow. |
| Per-endpoint RPC latency | `nomad_nomad_rpc_eval_list` / `_eval_write` / `_job_write` / `_plan_write` / `_status_read` | Drill down RPC latency by API. |
| Deployment / ACL / locks | `nomad_nomad_deployment_get_deployment`, `nomad_nomad_acl_*`, `nomad_variables_locks_delay_timer_num` / `_ttl_timer_num` | Deployment reads, ACL resolution, and variable-lock timers. |
| Snapshot internals | `nomad_state_snapshotIndex`, `nomad_serf_snapshot_appendLine` | Raft and serf snapshot accounting. |
| Endpoint meta | `go_*`, `process_*`, `scrape_duration_seconds` / `scrape_samples_scraped` | Go-runtime, process, and Prometheus scrape-side metrics the endpoint also exposes. |

The eval-broker, blocked-eval, and `nomad_raft_leader_*` families are
emitted by the current leader; on a server-only deployment with no
client node, the `nomad_client_*` host and allocation families stay
absent until a client agent is scraped.

## Key Alerts to Configure

Threshold guidance for the most useful Core and Operational series.
The state-based alerts fire on a value; the rest are relative to your
own baseline. These are starting points - tune them to your workload.

| Metric | Condition | Why it matters |
|---|---|---|
| `up` | `== 0` for > 1m | The API metrics endpoint stopped responding. Check the Nomad process and the API port. |
| `nomad_nomad_autopilot_healthy` | `== 0` | Autopilot sees the cluster as degraded - not enough voters alive or reachable. Check server health. |
| `nomad_nomad_autopilot_failure_tolerance` | `== 0` | The cluster can lose no further server without losing quorum. Restore the missing server(s). |
| `nomad_nomad_blocked_evals_total_blocked` | Rising vs baseline | Evaluations are blocked - insufficient capacity or unmet constraints. Add client capacity or fix constraints. |
| `nomad_nomad_broker_total_ready` / `nomad_nomad_plan_queue_depth` | Rising vs baseline | Schedulers are falling behind. Correlate with eval rate and server load. |
| `nomad_nomad_job_summary_failed` / `nomad_nomad_job_summary_lost` | Rising vs baseline | Workloads are crashing or being lost. Inspect the failing job and its clients. |

## Access Setup

Enable the Prometheus metrics endpoint by adding the `telemetry` block
to the Nomad agent configuration:

```hcl showLineNumbers title="nomad-config.hcl"
telemetry {
  prometheus_metrics         = true
  publish_allocation_metrics = true
  publish_node_metrics       = true
}
```

- `prometheus_metrics` must be `true` to expose the Prometheus endpoint
  (the default is `false`).
- `publish_allocation_metrics` and `publish_node_metrics` drive the
  client and allocation families - they apply on Nomad *client* agents;
  a server-only agent emits the Raft, broker, and scheduler families
  regardless.

Verify the endpoint is working:

```bash showLineNumbers title="Verify access"
# Check Nomad is running
nomad server members

# Verify the Prometheus metrics endpoint
curl -s 'http://localhost:4646/v1/metrics?format=prometheus' | head -20
```

No authentication is required by default. ACL-enabled clusters need a
token with at least `node:read` and `agent:read` - see
[Configuration](#configuration) below.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          scrape_interval: 30s
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646   # Change to your Nomad API address

processors:
  resource:
    attributes:
      - key: deployment.environment.name
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

> **Semconv version note**: `deployment.environment.name` is the current
> OTel attribute (semantic conventions v1.27+, stable as of v1.41.0). The
> legacy `deployment.environment` is still accepted by Scout for
> backward compatibility, but new configs should emit the dotted form.

### Environment Variables

```bash showLineNumbers title=".env"
NOMAD_HOST=localhost
ENVIRONMENT=your_environment
SERVICE_NAME=your_service_name
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### ACL-enabled clusters

For Nomad clusters with ACLs enabled, the scrape request needs a token
with at least `node:read` and `agent:read` capability:

```yaml showLineNumbers title="config/otel-collector.yaml (ACL)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          authorization:
            type: Bearer
            credentials: ${env:NOMAD_TOKEN}
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646
```

### Scope the scrape to the Nomad namespace

The endpoint also exposes Go-runtime and process series alongside the
`nomad_*` families. To keep only the Nomad namespace, add a
`metric_relabel_configs` keep filter:

```yaml showLineNumbers title="config/otel-collector.yaml (keep filter)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          scrape_interval: 30s
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - ${env:NOMAD_HOST}:4646
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "nomad_.*"
              action: keep
```

This scopes the scrape to `nomad_*`; the Diagnostic-tier `go_*` /
`process_*` / `scrape_*` meta is dropped while every Core and
Operational series is kept.

## Verify the Setup

Start the Collector and check for metrics within 60 seconds:

```bash showLineNumbers title="Verify metrics collection"
# Check Collector logs for scraped Nomad metrics
docker logs otel-collector 2>&1 | grep -i "nomad"

# Verify Nomad is healthy
nomad server members

# Check the metrics endpoint directly
curl -s 'http://localhost:4646/v1/metrics?format=prometheus' \
  | grep nomad_raft_peers
```

## Troubleshooting

### Metrics endpoint returns empty or 404

**Cause**: `prometheus_metrics` is not enabled in the telemetry block.

**Fix**:

1. Add `prometheus_metrics = true` to the `telemetry` block in the
   agent config.
2. Restart the Nomad agent.
3. Verify:
   `curl 'http://localhost:4646/v1/metrics?format=prometheus'`.

### Connection refused on port 4646

**Cause**: The Collector cannot reach Nomad at the configured address.

**Fix**:

1. Verify Nomad is running: `docker ps | grep nomad` or
   `nomad server members`.
2. Confirm the HTTP API address: `nomad agent-info | grep Address`.
3. Check firewall rules if the Collector runs on a separate host.

### Client and allocation metrics missing

**Cause**: The Collector is scraping a Nomad server, which emits only
server metrics.

**Look at**: the absence of `nomad_client_host_*`,
`nomad_client_allocated_*`, and `nomad_client_allocs_*` - these are the
client and allocation families.

**Fix**:

1. Nomad servers expose only the Raft, broker, and scheduler families.
   Allocation resource usage and node-level metrics come from Nomad
   client agents.
2. Add client agent endpoints (also on port `4646`) to the scrape
   targets alongside the server endpoints.
3. Ensure `publish_allocation_metrics = true` and
   `publish_node_metrics = true` are set on the client agents.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check Collector logs for export errors: `docker logs otel-collector`.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the pipeline includes both the receiver and the exporter.

## FAQ

**Does this work with Nomad running in Kubernetes?**

Yes. Set `targets` to the Nomad service DNS
(e.g., `nomad-server.nomad.svc.cluster.local:4646`) and ensure
`prometheus_metrics = true` is set in the Nomad Helm chart values under
`server.extraConfig`. The Collector can run as a sidecar or DaemonSet.

**How do I monitor a multi-node Nomad cluster?**

Each Nomad server exposes its own metrics endpoint. Add all server
endpoints to the scrape config:

```yaml showLineNumbers title="Multi-node scrape config"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nomad
          metrics_path: /v1/metrics
          params:
            format: [prometheus]
          static_configs:
            - targets:
                - nomad-1:4646
                - nomad-2:4646
                - nomad-3:4646
```

Each server is scraped independently and identified by its `instance`
label.

**Why are client metrics missing?**

A Nomad server does not emit client or allocation metrics. Allocation
resource usage, task-driver stats, and node-level metrics come only from
Nomad client agents. Add client agent endpoints (also on port `4646`) to
your scrape targets alongside the servers, and enable
`publish_allocation_metrics` and `publish_node_metrics` on those agents.

**How does this relate to Consul and Vault monitoring?**

Nomad, Consul, and Vault form the HashiCorp stack and are often deployed
together. Each exposes Prometheus metrics via the same `/v1/metrics`
pattern, so you monitor all three by adding separate scrape jobs in the
same Collector config. See [Consul Monitoring](./consul.md) and
[Vault Monitoring](./vault.md).

## Related Guides

- [OTel Collector Configuration](../collector-setup/otel-collector-config.md) -
  Advanced collector configuration.
- [Docker Compose Setup](../collector-setup/docker-compose-example.md) -
  Run the Collector locally.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Production deployment.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) -
  Alert on Nomad metrics.
- [Consul Monitoring](./consul.md) - Service discovery and health for
  the same cluster.
- [Vault Monitoring](./vault.md) - Secrets and token issuance for the
  same workloads.

## What's Next?

- **Create Dashboards**: Explore pre-built dashboards or build your own.
  See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Monitor More Components**: Add monitoring for
  [Consul](./consul.md), [Vault](./vault.md), and other components.
- **Focus the Collection**: Use the `nomad_.*` keep filter to scope the
  scrape to the Nomad namespace, dropping the Go-runtime and process
  meta the endpoint also exposes.
