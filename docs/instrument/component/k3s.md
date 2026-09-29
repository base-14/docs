---
title: >
  K3s OpenTelemetry Monitoring - API Server, Kubelet, Certificates,
  Datastore, and Collector Setup
sidebar_label: K3s
id: collecting-k3s-telemetry
sidebar_position: 73
description: >
  Collect K3s control plane and node metrics, plus API server and kubelet
  traces, with the OpenTelemetry Collector. Monitor API errors, certificate
  expiry and node headroom in base14 Scout.
keywords:
  - k3s opentelemetry
  - k3s otel collector
  - k3s metrics monitoring
  - k3s kubelet metrics
  - k3s certificate expiration
  - k3s api server tracing
  - lightweight kubernetes monitoring
  - k3s observability
---

# K3s

K3s runs the API server, controller-manager, scheduler, kubelet and
kube-proxy in a single `k3s` process, and they share one Prometheus
registry. Every metrics port on a node serves the whole registry, so the
Collector scrapes one port per node: the kubelet's `https://<node>:10250/metrics`.
The `kubelet_stats` receiver adds node, pod, container and volume
resources from the same port, and the API server and kubelet can push
traces over OTLP. This guide covers the RBAC, the Collector running as a
DaemonSet, the K3s-specific metrics, and shipping to base14 Scout.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| K3s                    | 1.36    | 1.36        |
| OTel Collector Contrib | 0.152.0 | Latest      |
| base14 Scout           | Any     | -           |

The Collector floor is the receiver name: `kubelet_stats` was
`kubeletstats` before contrib 0.152.0. Later versions still accept
`kubeletstats` and log a deprecation warning.

The metric names from Kubernetes components follow upstream Kubernetes
for the same minor version.

Before starting:

- `kubectl` access to the cluster with permission to create a ClusterRole.
- Access to `/etc/rancher/k3s/config.yaml` on each node and permission to
  restart K3s, for tracing and embedded etcd metrics.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

A server node serves around 525 metric families and tens of thousands of
series. An agent node serves around 330 families and a few thousand
series. Server nodes carry the API server, controller-manager, scheduler
and datastore families; agents carry the kubelet, kube-proxy and K3s agent
families.

### Core - is the cluster serving and are nodes within limits

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 when the Collector scraped the node. |
| `apiserver_request_total` | counter | API requests by `code`, `verb`, `resource` and `subresource`. Server nodes only. |
| `kubelet_started_containers_errors_total` | counter | Container start failures by `code`, such as `ErrImagePull` and `ImagePullBackOff`. |
| `k8s.node.memory.available` | gauge | Memory available on the node. |
| `k8s.node.filesystem.available`, `k8s.node.filesystem.capacity` | gauge | Node filesystem free space and size. |
| `k3s_certificate_expiration_seconds` | gauge | Seconds until each K3s-managed certificate expires, by `subject` and `usages`. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `apiserver_request_duration_seconds` | histogram | API latency by `verb` and `resource`. |
| `authorization_attempts_total` | counter | Authorization results. `no-opinion` is a denied request. |
| `apiserver_current_inflight_requests` | gauge | Requests in flight, `readOnly` and `mutating`. |
| `apiserver_flowcontrol_current_inqueue_requests` | gauge | Requests queued by API Priority and Fairness. |
| `etcd_request_duration_seconds` | histogram | Latency from the API server to the datastore. |
| `etcd_request_errors_total` | counter | Failed datastore calls. |
| `kine_sql_total` | counter | SQL statements run by kine, by `name` and `error_code`. SQLite datastore only. |
| `kine_sql_time_seconds` | histogram | SQL statement latency. |
| `scheduler_pending_pods` | gauge | Pods waiting, by `queue`: `active`, `backoff`, `gated`, `unschedulable`. |
| `scheduler_schedule_attempts_total` | counter | Scheduling attempts by `result`. |
| `workqueue_depth` | gauge | Controller queue depth by `name`. |
| `kubelet_runtime_operations_errors_total` | counter | Failed container runtime operations by `operation_type`. |
| `kubelet_pleg_relist_duration_seconds` | histogram | Time for the kubelet to relist pods from the runtime. |
| `kubelet_pod_start_sli_duration_seconds` | histogram | Pod start time, excluding image pulls and init containers. |
| `kubelet_running_pods` | gauge | Pods running on the node. |
| `kubelet_running_containers` | gauge | Containers by `container_state`. |
| `rest_client_requests_total` | counter | Calls from K3s components to the API server by `code`. |
| `k3s_loadbalancer_server_health` | gauge | Health of each server as seen by an agent's load balancer. Agents only. |
| `k3s_loadbalancer_server_connections` | gauge | Open connections from an agent to each server. |
| `process_resident_memory_bytes` | gauge | Memory of the whole `k3s` process. |
| `k8s.node.cpu.usage`, `k8s.node.memory.working_set` | gauge | Node CPU and working set. |
| `k8s.pod.cpu.usage`, `k8s.pod.memory.working_set` | gauge | Pod CPU and working set. |
| `container.cpu.usage`, `container.memory.working_set` | gauge | Container CPU and working set. |
| `k8s.volume.available`, `k8s.volume.capacity` | gauge | Volume free space and size. |

With embedded etcd, these families from etcd's own endpoint are also
Operational; see [Embedded etcd](#embedded-etcd):

| Metric | Type | What it tells you |
| --- | --- | --- |
| `etcd_server_has_leader` | gauge | 1 when this etcd member has a leader. |
| `etcd_server_leader_changes_seen_total` | counter | Leader changes seen by this member. |
| `etcd_server_proposals_failed_total` | counter | Failed write proposals. |
| `etcd_mvcc_db_total_size_in_bytes` | gauge | Size of the etcd database. |
| `etcd_server_quota_backend_bytes` | gauge | The database size quota. |
| `etcd_disk_wal_fsync_duration_seconds` | histogram | Write-ahead log fsync latency. |
| `etcd_disk_backend_commit_duration_seconds` | histogram | Backend commit latency. |

### Diagnostic - for investigation and tuning

| Metric | What it tells you |
| --- | --- |
| `apiserver_request_sli_duration_seconds`, `apiserver_response_sizes`, `apiserver_request_body_size_bytes` | Request latency for SLOs, and payload sizes. |
| `apiserver_watch_list_duration_seconds`, `apiserver_watch_events_sizes`, `apiserver_longrunning_requests` | Watch behaviour. |
| `apiserver_storage_objects`, `apiserver_storage_size_bytes` | Objects per resource and datastore size. |
| `apiserver_admission_controller_admission_duration_seconds` | Admission controller latency. |
| `workqueue_queue_duration_seconds`, `workqueue_work_duration_seconds` | Controller queue wait and work time. |
| `scheduler_plugin_execution_duration_seconds` | Time per scheduler plugin. |
| `kubelet_image_pull_duration_seconds` | Image pull time by `image_size_in_bytes`. |
| `kubelet_volume_stats_used_bytes`, `kubelet_volume_stats_capacity_bytes` | Volume usage per PVC. |
| `kube_router_*` | The embedded network policy controller. |
| `lasso_controller_reconcile_time_seconds` | K3s's own controllers. |
| `k3s_loadbalancer_dial_duration_seconds` | Agent dial time to servers. |
| `go_*`, other `process_*` | Runtime stats for the `k3s` process. |

### One registry on every port

Each metrics port on a K3s node serves the same shared registry, give or
take a few families specific to that port:

| Port | Component | Binds |
| --- | --- | --- |
| 6443 | API server on servers; supervisor on agents when `--supervisor-metrics` is set | all interfaces |
| 10250 | kubelet | all interfaces |
| 10257 | controller-manager | `127.0.0.1` |
| 10259 | scheduler | `127.0.0.1` |
| 10249 | kube-proxy, plain HTTP | `127.0.0.1` |

Scraping two of them on the same node collects every series twice. Scrape
10250 only. It exists on servers and agents, and `nodes/metrics` RBAC
covers it.

### K3s-specific metrics

- `k3s_certificate_expiration_seconds` has one series per certificate.
  Leaf certificates last 365 days and CAs 10 years. K3s renews leaf
  certificates within 120 days of expiry when it starts. A running K3s
  does not renew them. From 120 days out it records a
  `CertificateExpirationWarning` event on the Node, and from 365 days out a
  `CACertificateExpirationWarning` for CAs.
- `k3s_loadbalancer_server_health` is an enum: 0 INVALID, 1 FAILED, 2
  STANDBY, 3 UNCHECKED, 4 RECOVERING, 5 HEALTHY, 6 PREFERRED, 7 ACTIVE.
  An agent can list the address it joined with as a STANDBY default entry
  next to the server addresses it learned, and connections opened before
  it learned them can stay on that entry. Alert on FAILED, not on
  STANDBY.
- `kine_sql_*` exist on the default SQLite datastore, where kine stores
  state. With embedded etcd they are absent.
- `etcd_request_*` are the API server's datastore client. On SQLite they
  measure calls into kine, which speaks the etcd API.

### RBAC denials are not in `apiserver_request_total`

A request that RBAC refuses returns 403 to the caller, but no
`code="403"` series appears in `apiserver_request_total`, and
`apiserver_authorization_decisions_total` shows only `allowed`. Denials
are counted in `authorization_attempts_total{result="no-opinion"}`: RBAC
has no opinion on a request it does not allow, and no opinion from every
authorizer is a denial.

### Crash loops and OOM kills have no kubelet counter

`kubelet_restarted_pods_total` counts pods deleted and recreated with the
same UID, not container restarts, and `kubelet_started_pods_errors_total`
does not move for a crash loop or an OOM kill. Restarts and termination
reasons are pod status. Read them from
[kube-state-metrics](./kube-state-metrics.md) or the
[K8s Cluster receiver](./k8s-cluster.md).

### `local-path` volumes report the node filesystem

For a PVC on K3s's bundled `local-path` storage class,
`k8s.volume.capacity`, `kubelet_volume_stats_capacity_bytes` and
`kubelet_volume_stats_used_bytes` report the node's filesystem, not the
size in the claim. A 1 GiB claim reads the node disk's capacity.

### Eviction thresholds on K3s

K3s sets the kubelet's hard eviction thresholds to `nodefs.available` 5%
and `imagefs.available` 5%, with no `memory.available` threshold. Alert
on node filesystem headroom before the 5% line.

### Values to ignore

- `apiserver_request_total` has `code="429"` series for `WATCH` on K3s,
  Traefik, Helm and Gateway API CRDs while the watch caches start, and
  `code="500"` for `/readyz` checks while the API server starts. They come
  from start-up, not from clients.
- `kubelet_node_startup_duration_seconds` does not describe the node's
  start time. Leave it out of dashboards.

## Key Alerts to Configure

Thresholds are a state read, a fraction of a limit, a value from K3s
itself, or relative to your own trailing baseline. API latency depends on
your workload, so this guide proposes no absolute latency numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0` | The node or the kubelet is down, or the Collector lost access. |
| `apiserver_request_total`, `code=~"5.."` | rate above your trailing baseline, sustained | The API server is failing requests. Group by `resource` and `verb`. |
| `kubelet_started_containers_errors_total` | `increase(...[10m]) > 0`, by `code` | Containers are failing to start. `ErrImagePull` and `ImagePullBackOff` point at image names, registries or credentials. |
| `k8s.node.filesystem.available` / `k8s.node.filesystem.capacity` | below 10% | K3s starts evicting pods at 5%. |
| `k8s.node.memory.available` | below your trailing baseline floor | K3s sets no memory eviction threshold. |
| `k3s_certificate_expiration_seconds` | leaf below 120 days (10,368,000 s), CA below 365 days | A leaf certificate inside 120 days renews only when K3s restarts. |
| `authorization_attempts_total{result="no-opinion"}` | rate above your trailing baseline | A workload or user is being refused by RBAC. |
| `apiserver_request_duration_seconds`, verbs other than `WATCH` and `CONNECT` | p99 above your trailing baseline | The API server is slowing down. Compare with `etcd_request_duration_seconds`. |
| `kine_sql_total{error_code!=""}` or `etcd_request_errors_total` | `increase(...) > 0`, sustained | The datastore is failing calls. |
| `scheduler_pending_pods{queue="unschedulable"}` | `> 0` for 10 minutes | Pods cannot be placed on any node. |
| `k3s_loadbalancer_server_health` | `== 1` | An agent has marked a server FAILED. |
| `etcd_server_has_leader` | `== 0` | Embedded etcd has no leader. |
| `etcd_mvcc_db_total_size_in_bytes` / `etcd_server_quota_backend_bytes` | above 80% | The etcd database is close to its size quota. |

## Access Setup

The Collector authenticates to the kubelet with its service account token.
K3s turns off anonymous kubelet access and the read-only port, so the
service account needs `nodes/metrics` for `/metrics` and `nodes/stats` for
`kubelet_stats`:

```yaml showLineNumbers title="rbac.yaml"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector
  namespace: otel
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector
rules:
  - apiGroups: [""]
    resources: [nodes/stats, nodes/metrics]
    verbs: [get]
  - apiGroups: [""]
    resources: [nodes]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: otel-collector
subjects:
  - kind: ServiceAccount
    name: otel-collector
    namespace: otel
```

Run the Collector as a DaemonSet so each node's pod scrapes its own node.
Pass the node's name and IP in from the pod spec:

```yaml showLineNumbers title="daemonset.yaml (pod spec excerpt)"
spec:
  serviceAccountName: otel-collector
  hostNetwork: true
  dnsPolicy: ClusterFirstWithHostNet
  tolerations:
    - operator: Exists
  containers:
    - name: otel-collector
      image: otel/opentelemetry-collector-contrib:latest
      env:
        - name: K8S_NODE_NAME
          valueFrom:
            fieldRef:
              fieldPath: spec.nodeName
        - name: K8S_NODE_IP
          valueFrom:
            fieldRef:
              fieldPath: status.hostIP
```

`hostNetwork` is needed only for [traces](#collecting-traces), where the
API server and kubelet send to `127.0.0.1`. The toleration keeps the
Collector on every node, including any you have tainted.

## Configuration

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: k3s
          scrape_interval: 30s
          scheme: https
          authorization:
            credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
          tls_config:
            insecure_skip_verify: true
          static_configs:
            - targets: ["${env:K8S_NODE_IP}:10250"]
              labels:
                node: ${env:K8S_NODE_NAME}

  kubelet_stats:
    collection_interval: 30s
    auth_type: serviceAccount
    endpoint: https://${env:K8S_NODE_IP}:10250
    insecure_skip_verify: true
    metric_groups: [node, pod, container, volume]

processors:
  resource:
    attributes:
      - key: service.name
        value: ${env:SERVICE_NAME}
        action: upsert
      - key: environment
        value: ${env:ENVIRONMENT}
        action: upsert

  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  otlp_http/b14:
    endpoint: ${env:OTEL_EXPORTER_OTLP_ENDPOINT}

service:
  pipelines:
    metrics:
      receivers: [prometheus, kubelet_stats]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

The kubelet serves a certificate from K3s's own CA, hence
`insecure_skip_verify`.

From contrib 0.161.0, `container.cpu.usage`, `k8s.pod.cpu.usage` and
`k8s.node.cpu.usage` are computed from CPU time between two scrapes, so
they appear from the second collection onward.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=k3s
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Where the series volume comes from

Server nodes carry most of the volume. The largest families are the
histograms `etcd_request_duration_seconds`,
`apiserver_request_duration_seconds`,
`apiserver_request_sli_duration_seconds`,
`apiserver_request_body_size_bytes`,
`apiserver_watch_list_duration_seconds`,
`apiserver_watch_cache_read_wait_seconds`,
`workqueue_work_duration_seconds` and `workqueue_queue_duration_seconds`,
each with more than a thousand series on a server. `go_*` has many families but
few series.

### Embedded etcd

A K3s cluster started with `--cluster-init` stores state in embedded etcd
instead of SQLite. etcd's own metrics are not in the shared registry. They
are served on port 2381 over plain HTTP, bound to `127.0.0.1` unless you
expose them:

```yaml showLineNumbers title="/etc/rancher/k3s/config.yaml (servers)"
etcd-expose-metrics: true
```

Restart K3s, then add a scrape job that runs on server nodes:

```yaml showLineNumbers title="config/otel-collector.yaml (embedded etcd)"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: k3s-etcd
          scrape_interval: 30s
          static_configs:
            - targets: ["${env:K8S_NODE_IP}:2381"]
              labels:
                node: ${env:K8S_NODE_NAME}
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: etcd_.*
              action: keep
```

Port 2381 also serves families from libraries linked into the `k3s`
binary, including `containerd_*` names that do not describe the node's
containerd. The `keep` rule leaves `etcd_*` only.

On agent nodes nothing listens on 2381, so this job reports `up` 0 and the
Collector logs `Failed to scrape Prometheus endpoint` every 30 seconds. To
avoid that, run the `k3s-etcd` job from a second DaemonSet limited to
server nodes.

For the etcd families, see [etcd Monitoring](./etcd.md).

## Collecting traces

The API server and the kubelet export traces over OTLP gRPC when given a
tracing configuration. Write both files on each node:

```yaml showLineNumbers title="/etc/rancher/k3s/apiserver-tracing.yaml (servers)"
apiVersion: apiserver.config.k8s.io/v1
kind: TracingConfiguration
endpoint: 127.0.0.1:4317
samplingRatePerMillion: 1000000
```

```yaml showLineNumbers title="/etc/rancher/k3s/kubelet-tracing.yaml"
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
tracing:
  endpoint: 127.0.0.1:4317
  samplingRatePerMillion: 1000000
```

Point K3s at them and restart it:

```yaml showLineNumbers title="/etc/rancher/k3s/config.yaml"
kube-apiserver-arg:
  - tracing-config-file=/etc/rancher/k3s/apiserver-tracing.yaml
kubelet-arg:
  - config=/etc/rancher/k3s/kubelet-tracing.yaml
```

Leave out `kube-apiserver-arg` on agents. K3s copies the kubelet file into
its own kubelet drop-in directory and merges it with the settings it
generates, so the eviction and authentication settings stay in place.

`samplingRatePerMillion: 1000000` records every request. Lower it for
busy clusters.

Add an `otlp` receiver bound to the node and a traces pipeline:

```yaml showLineNumbers title="config/otel-collector.yaml (traces)"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:4317

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlp_http/b14]
```

### What the traces show

API server spans:

- A server span per request, named after the method and route template,
  such as `GET /api/v1/namespaces/{:namespace}/pods/{:name}`. It carries
  `http.request.method`, `http.route`, `url.path`,
  `http.response.status_code`, `user_agent.original`, `client.address`
  and `audit-id`.
- Filter-chain spans under it: `authentication`, `authorization`, `audit`
  and `priorityandfairness`.
- Storage spans such as `GuaranteedUpdate etcd3` and `cacher.Get`, and
  client spans to the datastore, `etcdserverpb.KV/Range` and
  `etcdserverpb.KV/Txn`. On SQLite their `server.address` is `kine.sock`.

Kubelet spans:

- Client spans to containerd for every CRI call,
  `runtime.v1.RuntimeService/<Method>` and
  `runtime.v1.ImageService/<Method>`, with `server.address`
  `/run/k3s/containerd/containerd.sock`. `ListContainers`,
  `ListPodSandbox` and `ContainerStatus` make up most of them.
- `syncPod` for each pod sync, with `k8s.pod.name`, `k8s.namespace.name`
  and `k8s.pod.uid`.
- Server spans for requests to the kubelet, such as `/stats/summary`.

Three things to know:

- **A 403 is not an error span.** A request refused by RBAC has
  `http.response.status_code` 403 and span status `Unset`. Search on the
  status code.
- **Pod failures are.** A `syncPod` span for a pod that cannot pull its
  image has status `Error` and an `exception` event.
- **Some kubelet spans have no name.** The bundled metrics-server reads
  `/metrics/resource` about every 15 seconds, and those requests produce
  server spans with an empty name. Their `user_agent.original` starts with
  `metrics-server`.

## Verify the Setup

```bash showLineNumbers
# The Collector runs on every node
kubectl -n otel get pods -o wide

# The scrape and kubelet_stats work
kubectl -n otel logs <collector-pod> | grep -iE "error|failed"
```

The second command prints nothing when both receivers work. On agent
nodes, the `k3s-etcd` job from [Embedded etcd](#embedded-etcd) logs a
connection refused on port 2381, which is expected.

In Scout, filter on the service name you set. `up` should be 1 for every
node, `apiserver_request_total` should appear once per server node, and
`k8s.node.memory.available` should have one series per node.

## Troubleshooting

### The scrape returns 401 or 403

**Cause**: The Collector's service account has no token mounted, or its
ClusterRole lacks `nodes/metrics` (for `/metrics`) or `nodes/stats` (for
`kubelet_stats`).

**Fix**: Apply the RBAC above and restart the Collector pods.

### Every metric appears twice

**Cause**: More than one port on the same node is scraped, for example the
API server and the kubelet.

**Fix**: Scrape `:10250/metrics` only, once per node.

### A PVC's usage matches the node disk

**Cause**: The PVC uses the `local-path` storage class, which is a
directory on the node's filesystem.

**Fix**: Nothing to fix. Use node filesystem metrics for these volumes.

### Denied requests do not show in `apiserver_request_total`

**Cause**: RBAC denials are not recorded there.

**Fix**: Use `authorization_attempts_total{result="no-opinion"}`, or the
403 status code on API server spans.

### No `etcd_server_*` metrics

**Cause**: The cluster uses SQLite, or embedded etcd without
`etcd-expose-metrics`, or the `k3s-etcd` job is not configured.

**Fix**: Check for `kine_sql_total`; if it is there, the cluster is on
SQLite and has no etcd server. Otherwise follow
[Embedded etcd](#embedded-etcd).

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the metrics pipeline includes both receivers and the exporter.

## FAQ

### Do I need separate jobs for the API server, scheduler and controller-manager?

No. On K3s they share one registry with the kubelet, and `:10250/metrics`
serves all of it.

### Where do I get pod restarts and OOM kills?

From [kube-state-metrics](./kube-state-metrics.md) or the
[K8s Cluster receiver](./k8s-cluster.md). The kubelet has no counter for
them.

### What about Traefik and CoreDNS?

K3s deploys both with Prometheus metrics on: Traefik on port 9100 and
CoreDNS on port 9153. See [Traefik Monitoring](./traefik.md).

### Does this work on k3d?

Yes. k3d runs K3s nodes as containers, and the same ports, RBAC and
configuration apply. Node CPU, memory and filesystem numbers then describe
the Docker host or VM.

## Related Guides

- [Kubelet Stats Monitoring](./kubelet-stats.md) - The `kubelet_stats`
  receiver in detail.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - Pod restarts,
  termination reasons and object state.
- [K8s Cluster Monitoring](./k8s-cluster.md) - Cluster-level object
  metrics from the Collector.
- [etcd Monitoring](./etcd.md) - The etcd families for embedded etcd.
- [containerd Monitoring](./containerd.md) - The container runtime K3s
  bundles.
- [Traefik Monitoring](./traefik.md) - The bundled ingress controller.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector as a DaemonSet.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  K3s metrics.

## What's Next?

- **Create Dashboards**: Start with API server 5xx and latency by
  resource, container start errors, node headroom and certificate expiry.
  See [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of API latency and denial
  rates, then fill in the relative alerts above.
- **Add pod state**: Pair this guide with kube-state-metrics for restarts
  and OOM kills.
