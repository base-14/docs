---
title: >
  RKE2 OpenTelemetry Monitoring - API Server, Kubelet, Supervisor,
  Certificates, etcd, and Collector Setup
sidebar_label: RKE2
id: collecting-rke2-telemetry
sidebar_position: 77
description: >
  Collect RKE2 control plane, supervisor and etcd metrics, plus API server
  and kubelet traces, with the OpenTelemetry Collector. Monitor API errors,
  certificate expiry and node headroom in base14 Scout.
keywords:
  - rke2 opentelemetry
  - rke2 otel collector
  - rke2 metrics monitoring
  - rke2 supervisor metrics
  - rke2 certificate expiration
  - rke2 api server tracing
  - rancher kubernetes engine monitoring
  - rke2 observability
---

# RKE2

RKE2 runs the API server, controller-manager, scheduler, etcd and
kube-proxy as static pods under its own containerd, and the kubelet as a
child of the `rke2` process. Each of them serves its own Prometheus
registry on its own port, so the Collector scrapes one job per component
on every node. The supervisor adds RKE2's own families on port 9345 when
you turn them on, etcd serves its families on 2381, and the API server
and the kubelet can push traces over OTLP. This guide covers the RBAC, the
Collector running as a DaemonSet, the per-component jobs, the
RKE2-specific metrics, and shipping to base14 Scout.

If you run K3s, read [K3s Monitoring](./k3s.md) instead. The two share the
kubelet settings, the eviction defaults and the tracing hooks, but K3s
serves one shared registry on every port and RKE2 does not.

## Prerequisites

| Requirement            | Minimum | Recommended |
| ---------------------- | ------- | ----------- |
| RKE2                   | 1.36    | 1.36        |
| OTel Collector Contrib | 0.152.0 | Latest      |
| base14 Scout           | Any     | -           |

The Collector floor is the receiver name: `kubelet_stats` was
`kubeletstats` before contrib 0.152.0. Later versions still accept
`kubeletstats` and log a deprecation warning.

The metric names from Kubernetes components follow upstream Kubernetes
for the same minor version. RKE2 1.36 runs Kubernetes 1.36.

Before starting:

- `kubectl` access to the cluster with permission to create a ClusterRole.
- Access to `/etc/rancher/rke2/config.yaml` on each server and permission
  to restart RKE2, for the supervisor and etcd metrics and for tracing.
- A Scout account and OTLP endpoint.
- OTel Collector installed - see
  [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md).

## What You'll Monitor

Metrics are grouped into three tiers by how you use them. Collect Core
always, alert on Operational, and use Diagnostic during an incident or a
capacity review.

A server node serves around 585 metric families across its seven ports,
most of the series from the API server. An agent node runs the kubelet and
kube-proxy, and listens on 9345 as well when `supervisor-metrics` is set.

### Core - is the cluster serving and are nodes within limits

| Metric | Type | What it tells you |
| --- | --- | --- |
| `up` | gauge | 1 when the Collector scraped that `component` on that node. One series per job. |
| `apiserver_request_total` | counter | API requests by `code`, `verb`, `resource` and `subresource`. Server nodes only. |
| `k8s.node.memory.available` | gauge | Memory available on the node. |
| `k8s.node.filesystem.available`, `k8s.node.filesystem.capacity` | gauge | Node filesystem free space and size. |
| `rke2_certificate_expiration_seconds` | gauge | Seconds until each RKE2-managed certificate expires, by `subject` and `usages`. Supervisor port only. |
| `etcd_server_has_leader` | gauge | 1 when this etcd member has a leader. Server nodes only. |

### Operational - what to alert on

| Metric | Type | What it tells you |
| --- | --- | --- |
| `kubelet_started_containers_errors_total` | counter | Container start failures by `code`, such as `ErrImagePull` and `ImagePullBackOff`. |
| `apiserver_request_duration_seconds` | histogram | API latency by `verb` and `resource`. |
| `authorization_attempts_total` | counter | Authorization results. `no-opinion` is a denied request. |
| `apiserver_current_inflight_requests` | gauge | Requests in flight, `readOnly` and `mutating`. |
| `apiserver_flowcontrol_current_inqueue_requests` | gauge | Requests queued by API Priority and Fairness. |
| `etcd_request_duration_seconds` | histogram | Latency from the API server to etcd. |
| `etcd_requests_total` | counter | etcd calls from the API server by `operation` and `type`. |
| `etcd_server_leader_changes_seen_total` | counter | Leader changes seen by this member. |
| `etcd_server_proposals_failed_total` | counter | Failed write proposals. |
| `etcd_mvcc_db_total_size_in_bytes` | gauge | Size of the etcd database. |
| `etcd_server_quota_backend_bytes` | gauge | The database size quota. |
| `etcd_disk_wal_fsync_duration_seconds` | histogram | Write-ahead log fsync latency. |
| `etcd_disk_backend_commit_duration_seconds` | histogram | Backend commit latency. |
| `scheduler_pending_pods` | gauge | Pods waiting, by `queue`. |
| `scheduler_schedule_attempts_total` | counter | Scheduling attempts by `result`. |
| `workqueue_depth` | gauge | Controller queue depth by `name`. |
| `kubelet_runtime_operations_errors_total` | counter | Failed container runtime operations by `operation_type`. |
| `kubelet_pleg_relist_duration_seconds` | histogram | Time for the kubelet to relist pods from the runtime. |
| `kubelet_pod_start_sli_duration_seconds` | histogram | Pod start time, excluding image pulls and init containers. |
| `kubelet_running_pods` | gauge | Pods running on the node. |
| `kubelet_running_containers` | gauge | Containers by `container_state`. |
| `rest_client_requests_total` | counter | Calls from each component to the API server by `code`. |
| `session_server_total_add_websocket_session`, `session_server_total_remove_websocket_session` | counter | Agent tunnel sessions opened and closed on the supervisor. |
| `rke2_etcd_snapshot_reconcile_duration_seconds` | histogram | The etcd snapshot controller's reconcile loop. Moves only when a snapshot runs. |
| `process_resident_memory_bytes` | gauge | Memory of each component, by `component`. |
| `k8s.node.cpu.usage`, `k8s.node.memory.working_set` | gauge | Node CPU and working set. |
| `k8s.pod.cpu.usage`, `k8s.pod.memory.working_set` | gauge | Pod CPU and working set. |
| `container.cpu.usage`, `container.memory.working_set` | gauge | Container CPU and working set. |
| `k8s.volume.available`, `k8s.volume.capacity` | gauge | Volume free space and size. |

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
| `kubeproxy_sync_proxy_rules_duration_seconds` | Time to program the node's service rules. |
| `lasso_controller_reconcile_time_seconds` | RKE2's own controllers inside the supervisor. |
| `go_*`, other `process_*` | Runtime stats, one set per component. |

### One registry per component

Every component on an RKE2 node serves its own registry, so the ports
are not interchangeable:

| Port | Component | Binds | Scheme |
| --- | --- | --- | --- |
| 6443 | API server | all interfaces | HTTPS, token |
| 10250 | kubelet | all interfaces | HTTPS, token |
| 9345 | supervisor, with `supervisor-metrics: true` | all interfaces | HTTPS, token |
| 10259 | scheduler | `127.0.0.1` | HTTPS, token |
| 10257 | controller-manager | `127.0.0.1` | HTTPS, token |
| 10249 | kube-proxy | `127.0.0.1` | HTTP |
| 2381 | etcd, with `etcd-expose-metrics: true` | `127.0.0.1` and the node IP | HTTP |

The five Kubernetes binaries share 186 families: `go_*`, `process_*`,
`rest_client_*`, `workqueue_*` and the delegated authentication and
authorization families. Those arrive once per component, with the
`component` label telling them apart. They are different processes, not
duplicate scrapes.

The kubelet read-only port 10255 is closed. RKE2 runs the kubelet with
anonymous authentication off and webhook authorization, so every scrape
of 10250 needs a token.

### RKE2-specific metrics

All of these are served on the supervisor port only, and only with
`supervisor-metrics: true`:

- `rke2_certificate_expiration_seconds` has one series per certificate.
  Leaf certificates last 365 days and the five CAs 10 years. `subject` is
  the certificate's common name, such as `CN=kube-apiserver`,
  `CN=etcd-server` or `CN=system:node:<node>`, and `usages` names the
  certificate's key usages. RKE2 renews leaf certificates
  within 120 days of expiry when it starts; a running server does not
  renew them.
- `rke2_etcd_snapshot_reconcile_duration_seconds` and
  `rke2_etcd_snapshot_reconcile_local_duration_seconds` time the etcd
  snapshot controller. They move only when a snapshot runs.
- `session_server_total_add_websocket_session` and
  `session_server_total_remove_websocket_session` count agent tunnel
  sessions. They stay at zero on a server with no agents.
- `lasso_controller_reconcile_time_seconds`,
  `lasso_controller_total_cached_object` and
  `lasso_controller_total_handler_execution` describe RKE2's controllers.

There are no `k3s_*` and no `kine_*` families on RKE2. The datastore is
always embedded etcd.

### RBAC denials are not in `apiserver_request_total`

A request that RBAC refuses returns 403 to the caller, but no
`code="403"` series appears in `apiserver_request_total`, and
`apiserver_authorization_decisions_total` shows only `allowed`. Denials
are counted in `authorization_attempts_total{result="no-opinion"}`.

### Crash loops and OOM kills have no kubelet counter

`kubelet_restarted_pods_total` counts pods deleted and recreated with the
same UID, not container restarts, and `kubelet_started_pods_errors_total`
does not move for a crash loop or an OOM kill. Image pull failures do
count, in `kubelet_started_containers_errors_total` by `code`. Restarts
and termination reasons are pod status. Read them from
[kube-state-metrics](./kube-state-metrics.md) or the
[K8s Cluster receiver](./k8s-cluster.md).

### No storage class by default

RKE2 ships no StorageClass. A PersistentVolumeClaim with no provisioner
stays Pending, its pod never schedules, and `kubelet_volume_stats_*` has
no series. Volume metrics appear once you install a provisioner.

### Eviction thresholds on RKE2

RKE2 sets the kubelet's hard eviction thresholds to `nodefs.available` 5%
and `imagefs.available` 5%, with no `memory.available` threshold. Alert
on node filesystem headroom before the 5% line.

## Key Alerts to Configure

Thresholds are a state read, a fraction of a limit, a value from RKE2
itself, or relative to your own trailing baseline. API latency depends on
your workload, so this guide proposes no absolute latency numbers.

| Metric | Threshold | Why it matters |
| --- | --- | --- |
| `up` | `== 0`, by `component` | That component is down on that node, or the Collector lost access. |
| `apiserver_request_total`, `code=~"5.."` | rate above your trailing baseline, sustained | The API server is failing requests. Group by `resource` and `verb`. |
| `kubelet_started_containers_errors_total` | `increase(...[10m]) > 0`, by `code` | Containers are failing to start. `ErrImagePull` and `ImagePullBackOff` point at image names, registries or credentials. |
| `k8s.node.filesystem.available` / `k8s.node.filesystem.capacity` | below 10% | RKE2 starts evicting pods at 5%. |
| `k8s.node.memory.available` | below your trailing baseline floor | RKE2 sets no memory eviction threshold. |
| `rke2_certificate_expiration_seconds` | leaf below 120 days (10,368,000 s) | A leaf certificate inside 120 days renews only when RKE2 restarts. |
| `etcd_server_has_leader` | `== 0` | Embedded etcd has no leader; the API server cannot write. |
| `etcd_mvcc_db_total_size_in_bytes` / `etcd_server_quota_backend_bytes` | above 80% | The etcd database is close to its size quota. |
| `authorization_attempts_total{result="no-opinion"}` | rate above your trailing baseline | A workload or user is being refused by RBAC. |
| `apiserver_request_duration_seconds`, verbs other than `WATCH` and `CONNECT` | p99 above your trailing baseline | The API server is slowing down. Compare with `etcd_request_duration_seconds`. |
| `etcd_server_proposals_failed_total` | `increase(...) > 0`, sustained | etcd is failing writes. |
| `scheduler_pending_pods{queue="unschedulable"}` | `> 0` for 10 minutes | Pods cannot be placed on any node. |

## Access Setup

Turn on the two endpoints RKE2 keeps off by default. On every server:

```yaml showLineNumbers title="/etc/rancher/rke2/config.yaml (servers)"
supervisor-metrics: true
etcd-expose-metrics: true
```

`supervisor-metrics` serves the `rke2_*` families on port 9345 and makes
agents listen on 9345 as well. `etcd-expose-metrics` binds etcd's metrics
port 2381 to the node IP in addition to `127.0.0.1`. Restart
`rke2-server` after the change.

The Collector authenticates to every HTTPS port with its service account
token. The kubelet needs `nodes/metrics` for `/metrics` and `nodes/stats`
for `kubelet_stats`; the API server, scheduler, controller-manager and
supervisor serve `/metrics` as a non-resource URL:

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
  - nonResourceURLs: [/metrics]
    verbs: [get]
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

Run the Collector as a DaemonSet on the host network, so each node's pod
reaches the loopback-only ports as well as the node IP. Pass the node's
name and IP in from the pod spec:

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

Unlike the K3s guide, `hostNetwork` is not optional here: the scheduler,
controller-manager and kube-proxy bind `127.0.0.1` only.

## Configuration

One job per component, with the `component` label on every series:

```yaml showLineNumbers title="config/otel-collector.yaml"
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: kubelet
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
                component: kubelet
        - job_name: apiserver
          scrape_interval: 30s
          scheme: https
          authorization:
            credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
          tls_config:
            insecure_skip_verify: true
          static_configs:
            - targets: ["${env:K8S_NODE_IP}:6443"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: apiserver
        - job_name: supervisor
          scrape_interval: 30s
          scheme: https
          authorization:
            credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
          tls_config:
            insecure_skip_verify: true
          static_configs:
            - targets: ["${env:K8S_NODE_IP}:9345"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: supervisor
        - job_name: scheduler
          scrape_interval: 30s
          scheme: https
          authorization:
            credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
          tls_config:
            insecure_skip_verify: true
          static_configs:
            - targets: ["127.0.0.1:10259"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: scheduler
        - job_name: controller-manager
          scrape_interval: 30s
          scheme: https
          authorization:
            credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
          tls_config:
            insecure_skip_verify: true
          static_configs:
            - targets: ["127.0.0.1:10257"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: controller-manager
        - job_name: kube-proxy
          scrape_interval: 30s
          static_configs:
            - targets: ["127.0.0.1:10249"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: kube-proxy
        - job_name: etcd
          scrape_interval: 30s
          static_configs:
            - targets: ["${env:K8S_NODE_IP}:2381"]
              labels:
                node: ${env:K8S_NODE_NAME}
                component: etcd

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
      - key: deployment.environment.name
        value: ${env:ENVIRONMENT}
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

The components serve certificates from RKE2's own CA, hence
`insecure_skip_verify`. The exporter name is `otlp_http` from contrib
0.144.0 on; the older `otlphttp` spelling still works.

On agent nodes the API server, scheduler, controller-manager and etcd
jobs have nothing to scrape, so their `up` reads 0 and the Collector logs
`Failed to scrape Prometheus endpoint` for each every 30 seconds. Run
those four jobs from a second DaemonSet limited to server nodes with a
`nodeSelector` on `node-role.kubernetes.io/control-plane`, and keep the
kubelet and kube-proxy jobs in the one that runs everywhere. Keep the
supervisor job there too if your agents serve `/metrics` on 9345; move it
otherwise.

From contrib 0.161.0, `container.cpu.usage`, `k8s.pod.cpu.usage` and
`k8s.node.cpu.usage` are computed from CPU time between two scrapes, so
they appear from the second collection onward.

### Environment Variables

```bash showLineNumbers title=".env"
SERVICE_NAME=rke2
ENVIRONMENT=your_environment
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-tenant>.base14.io
```

### Where the series volume comes from

The API server is about seven in ten of a server node's series. The largest
families are the histograms `etcd_request_duration_seconds`,
`apiserver_request_duration_seconds`,
`apiserver_request_sli_duration_seconds`,
`apiserver_watch_list_duration_seconds`,
`apiserver_watch_cache_read_wait_seconds` and
`apiserver_request_body_size_bytes`, each with more than a thousand series
on a server. To cut volume, add a `metric_relabel_configs` rule on the
`apiserver` job.

## Collecting traces

The API server and the kubelet export traces over OTLP gRPC when given a
tracing configuration. Write both files on each server, and the kubelet
file on each agent:

```yaml showLineNumbers title="/etc/rancher/rke2/tracing/apiserver-tracing.yaml (servers)"
apiVersion: apiserver.config.k8s.io/v1
kind: TracingConfiguration
endpoint: 127.0.0.1:4317
samplingRatePerMillion: 1000000
```

```yaml showLineNumbers title="/etc/rancher/rke2/tracing/kubelet-tracing.yaml"
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
tracing:
  endpoint: 127.0.0.1:4317
  samplingRatePerMillion: 1000000
```

Point RKE2 at them and restart it:

```yaml showLineNumbers title="/etc/rancher/rke2/config.yaml"
kube-apiserver-arg:
  - tracing-config-file=/etc/rancher/rke2/tracing/apiserver-tracing.yaml
kubelet-arg:
  - config=/etc/rancher/rke2/tracing/kubelet-tracing.yaml
```

Leave out `kube-apiserver-arg` on agents. RKE2 mounts the path from
`tracing-config-file` into the `kube-apiserver` static pod as a hostPath,
which otherwise cannot see the node's filesystem. RKE2 copies the kubelet
file into its kubelet drop-in
directory and merges it with the settings it generates, so the eviction
and authentication settings stay in place.

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
  such as `GET /apis/rbac.authorization.k8s.io/v1/clusterroles/{:name}`.
  It carries `http.request.method`, `url.path`,
  `http.response.status_code`, `user_agent.original`, `client.address`
  and `audit-id`.
- Filter-chain spans under it: `authentication`, `authorization`, `audit`,
  `priorityandfairness` and `constrainedimpersonation`.
- Storage spans such as `GuaranteedUpdate etcd3` and `cacher.Get`, and
  client spans to etcd, `etcdserverpb.KV/Range` and `etcdserverpb.KV/Txn`.

Kubelet spans:

- Client spans to RKE2's containerd for every CRI call,
  `runtime.v1.RuntimeService/<Method>`. `ContainerStatus`,
  `ListContainers` and `ListPodSandbox` make up most of them.
- `syncPod` for each pod sync.

A request refused by RBAC carries `http.response.status_code` 403 on its
server span. Search on the status code.

## Verify the Setup

```bash showLineNumbers
# The Collector runs on every node
kubectl -n otel get pods -o wide

# Every job scraped
kubectl -n otel logs <collector-pod> | grep "Failed to scrape"
```

The second command prints nothing on a server node when all seven jobs
work. On an agent node it prints the server-only jobs unless you split the
DaemonSets as above.

In Scout, filter on the service name you set. `up` should be 1 for seven
`component` values on each server, `rke2_certificate_expiration_seconds`
should have one series per certificate, and `etcd_server_has_leader`
should read 1 on every server.

## Troubleshooting

### The scrape returns 401 or 403

**Cause**: The Collector's service account has no token mounted, or its
ClusterRole lacks `nodes/metrics`, `nodes/stats` or the `/metrics`
non-resource rule. The supervisor answers 403 rather than 401 to a
request with no token.

**Fix**: Apply the RBAC above and restart the Collector pods.

### No `rke2_certificate_expiration_seconds`

**Cause**: `supervisor-metrics` is off, or the `supervisor` job is
missing.

**Fix**: Set `supervisor-metrics: true` on every server, restart
`rke2-server`, and keep the 9345 job.

### The etcd job is refused

**Cause**: `etcd-expose-metrics` is off, so 2381 listens on `127.0.0.1`
only, or the job runs on an agent.

**Fix**: Set `etcd-expose-metrics: true` on every server and restart.
With a host-network Collector, `127.0.0.1:2381` works on servers without
the setting.

### The scheduler or controller-manager job is refused

**Cause**: The Collector is not on the host network. Both bind
`127.0.0.1` only.

**Fix**: Set `hostNetwork: true` on the DaemonSet.

### Denied requests do not show in `apiserver_request_total`

**Cause**: RBAC denials are not recorded there.

**Fix**: Use `authorization_attempts_total{result="no-opinion"}`, or the
403 status code on API server spans.

### A PVC stays Pending and has no volume metrics

**Cause**: RKE2 ships no StorageClass.

**Fix**: Install a provisioner. `kubelet_volume_stats_*` appears once the
claim is bound.

### No metrics appearing in Scout

**Cause**: Metrics are collected but not exported.

**Fix**:

1. Check the Collector logs for export errors.
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly.
3. Confirm the metrics pipeline includes both receivers and the exporter.

## FAQ

### Do I need separate jobs for the API server, scheduler and controller-manager?

Yes. On RKE2 each is a static pod with its own registry and its own
port. One job per component, as in [Configuration](#configuration).

### Where do I get pod restarts and OOM kills?

From [kube-state-metrics](./kube-state-metrics.md) or the
[K8s Cluster receiver](./k8s-cluster.md). The kubelet has no counter for
them.

### What about the bundled add-ons?

RKE2 deploys Canal, CoreDNS, metrics-server, the snapshot controller and,
from 1.36, Traefik as the default ingress in place of ingress-nginx. Canal's
`calico-node` serves felix metrics on port 9091, CoreDNS on port 9153, and
Traefik through its chart's metrics setting. See
[Traefik Monitoring](./traefik.md). RKE2's bundled containerd exposes no
metrics listener unless you add one; see
[containerd Monitoring](./containerd.md).

### How is this different from K3s?

K3s runs every component in one process with one shared registry, so one
scrape per node covers everything. RKE2 runs them as static pods with a
registry each, always on embedded etcd, with the RKE2 families on a
separate supervisor port. The kubelet settings, eviction defaults and
tracing hooks are the same.

## Related Guides

- [K3s Monitoring](./k3s.md) - The lighter Rancher distribution with one
  shared registry.
- [Kubelet Stats Monitoring](./kubelet-stats.md) - The `kubelet_stats`
  receiver in detail.
- [kube-state-metrics Monitoring](./kube-state-metrics.md) - Pod restarts,
  termination reasons and object state.
- [K8s Cluster Monitoring](./k8s-cluster.md) - Cluster-level object
  metrics from the Collector.
- [etcd Monitoring](./etcd.md) - The etcd families in full.
- [containerd Monitoring](./containerd.md) - The container runtime RKE2
  bundles.
- [Traefik Monitoring](./traefik.md) - The bundled ingress controller.
- [Kubernetes Helm Setup](../collector-setup/kubernetes-helm-setup.md) -
  Run the Collector as a DaemonSet.
- [Creating Alerts](../../guides/creating-alerts-with-logx.md) - Alert on
  RKE2 metrics.

## What's Next?

- **Create Dashboards**: Start with API server 5xx and latency by
  resource, container start errors, node headroom, etcd leader and
  database size, and certificate expiry. See
  [Create Your First Dashboard](../../guides/create-your-first-dashboard.md).
- **Set your own thresholds**: Take a week of API latency and denial
  rates, then fill in the relative alerts above.
- **Add pod state**: Pair this guide with kube-state-metrics for restarts
  and OOM kills.
