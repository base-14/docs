---
date: 2026-05-01
id: collecting-azure-aks-telemetry
title: Azure Kubernetes Service Monitoring with OpenTelemetry - Cluster Metrics
sidebar_label: Azure Kubernetes Service
sidebar_position: 1
description:
  Collect AKS pod, container, node, and cluster-state metrics with the
  OpenTelemetry Collector and ship them to base14 Scout. Vendor-neutral
  alternative to Container Insights, Managed Prometheus, and Managed Grafana.
keywords:
  [
    azure kubernetes service monitoring,
    aks observability,
    opentelemetry aks,
    kubeletstats receiver,
    k8s_cluster receiver,
    workload identity federation,
    base14 scout aks,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor an Azure Kubernetes Service cluster with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Deploy the upstream OpenTelemetry Collector Helm chart twice in your AKS cluster - once as a DaemonSet (kubeletstats + hostmetrics) for per-node metrics, once as a Deployment (k8s_cluster + prometheus scraping kube-state-metrics) for cluster-state and additional kube_* metrics. Both ship OTLP/HTTP to base14 Scout authenticated via OAuth2 client credentials. ServiceAccounts authenticate to Azure via Workload Identity Federation."}},{"@type":"Question","name":"How does the in-cluster collector authenticate to base14 Scout?","acceptedAnswer":{"@type":"Answer","text":"Via the OpenTelemetry Collector oauth2client extension. Store the Scout-issued client_id and client_secret in a Kubernetes Secret, reference them in the chart values via secretKeyRef, and the otlp_http/b14 exporter automatically fetches short-lived bearer tokens from your Keycloak token URL on each scrape interval (cached until expiry)."}},{"@type":"Question","name":"Why do I need two Helm releases instead of one?","acceptedAnswer":{"@type":"Answer","text":"The kubeletstats receiver runs per-node (DaemonSet mode) so each kubelet is scraped from its own pod. The k8s_cluster receiver pulls cluster-wide state from the K8s API once and would emit duplicates if scaled horizontally - it runs as a single-replica Deployment. Splitting into two releases gives each receiver the right Pod controller without compromise."}},{"@type":"Question","name":"How is this different from Microsoft's Managed Prometheus and Container Insights?","acceptedAnswer":{"@type":"Answer","text":"Managed Prometheus and Container Insights are Azure-tenant-bound, billed per-GB ingested, and visualized in Managed Grafana / Log Analytics. The OpenTelemetry Collector pattern is vendor-neutral - the same collectors can ship to base14 Scout, Datadog, Splunk, or any OTLP-compatible backend without redeployment. Customers running multi-cloud or migrating off Azure-native observability prefer this."}},{"@type":"Question","name":"What is kube-state-metrics and why is it part of this guide?","acceptedAnswer":{"@type":"Answer","text":"kube-state-metrics exposes detailed Kubernetes object state (HPA replicas, Job completions, PVC capacity, node allocatable resources) in Prometheus-format. The k8s_cluster OTel receiver covers some of this, but kube-state-metrics has wider coverage. The cluster-mode collector includes a prometheus receiver that scrapes kube-state-metrics so both metric families flow to Scout in one pipeline."}},{"@type":"Question","name":"How do I add control-plane metrics like API-server uptime?","acceptedAnswer":{"@type":"Answer","text":"Control-plane metrics - API server uptime, etcd usage, cluster-autoscaler decisions - are published by Azure Monitor for the AKS resource and require a separate collector with the azure_monitor receiver authenticated via Service Principal or Managed Identity. Most workloads don't need this; the in-cluster pattern in this guide covers most operational signals. A dedicated Azure Monitor receiver guide is planned."}}]}
---

This guide deploys two OpenTelemetry Collectors on an Azure Kubernetes
Service (AKS) cluster — a DaemonSet for per-node metrics and a single-replica
Deployment for cluster-wide state — both shipping OTLP/HTTP to base14 Scout.

## Why Scout for AKS observability

Microsoft recommends **Managed Prometheus + Container Insights + Managed
Grafana** as the AKS observability stack
([learn.microsoft.com/azure/aks/monitor-aks](https://learn.microsoft.com/azure/aks/monitor-aks),
updated 2026-01-20). It works, but it ties your telemetry to Azure: metrics
land in a Log Analytics workspace, alerts route through Azure Monitor, and
dashboards live in Managed Grafana. Multi-cloud, hybrid, or migrating
customers prefer the OpenTelemetry Collector pattern in this guide because
the same collectors can ship to Scout, to a self-hosted Prometheus, or to
any OTLP-compatible backend — switching backends is a values-file change,
not a redeployment of agents.

## What you'll monitor

The two collectors together emit ~286 distinct metric names against a
working cluster. They share the same `cloud.region` / `k8s.cluster.name` /
`cloud.account.id` resource attributes so you can group across them in
Scout.

| Receiver | Mode | What it covers | Example metrics |
|---|---|---|---|
| `kubeletstats` | DaemonSet | Pod / container / node / volume usage from the kubelet | `k8s.pod.cpu.usage`, `k8s.node.memory.working_set`, `container.memory.rss`, `k8s.volume.available`, `k8s.pod.cpu_limit_utilization` |
| `hostmetrics` | DaemonSet | Node OS-level telemetry | `system.cpu.time`, `system.disk.io`, `system.network.errors`, `system.processes.count`, `system.uptime` |
| `k8s_cluster` | Deployment (1 replica) | K8s API objects | `k8s.deployment.available`, `k8s.daemonset.ready_nodes`, `k8s.pod.phase`, `k8s.cronjob.active_jobs`, `k8s.hpa.current_replicas`, `k8s.statefulset.ready_pods`, `k8s.persistentvolumeclaim.status.phase` |
| `prometheus` (scrapes kube-state-metrics) | Deployment (1 replica) | Detailed K8s state in Prometheus form | `kube_node_status_allocatable`, `kube_pod_container_resource_limits`, `kube_horizontalpodautoscaler_status_current_replicas`, `kube_job_status_succeeded` |

## Prerequisites

- An AKS cluster with **OIDC issuer** and **Workload Identity** enabled
  (`oidcIssuerProfile.enabled: true`,
  `securityProfile.workloadIdentity.enabled: true`). These are off by default;
  enable via Bicep / ARM / `az aks update`.
- `kubectl` ≥ 1.30, `helm` ≥ 3.14.
- A User-assigned Managed Identity (UAMI). The chart auto-creates one
  ServiceAccount per Helm release, so you'll federate two subjects:
  `system:serviceaccount:otel:otel-agent` and
  `system:serviceaccount:otel:otel-cluster`.
- Scout OAuth2 client credentials (`SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`,
  `SCOUT_TOKEN_URL`, `SCOUT_OTLP_ENDPOINT`).

## Step 1: Federate the UAMI to both ServiceAccounts

```bash
RG=<your-rg>
CLUSTER=<your-cluster-name>
UAMI=<your-uami-name>
ISSUER="$(az aks show -g "$RG" -n "$CLUSTER" --query oidcIssuerProfile.issuerURL -o tsv)"

for SA in otel-agent otel-cluster; do
  az identity federated-credential create \
    --name "fc-$SA" \
    --identity-name "$UAMI" \
    --resource-group "$RG" \
    --issuer "$ISSUER" \
    --subject "system:serviceaccount:otel:$SA" \
    --audiences "api://AzureADTokenExchange"
done
```

These shell variables (`$RG`, `$CLUSTER`, `$UAMI`) carry through the rest
of this guide; keep your shell session open or re-export them in Step 4.

## Step 2: Create the namespace, Secret, and ConfigMap

The collectors read Scout credentials from a Secret and cluster-context
from a ConfigMap so the values files stay portable across clusters.

```bash
kubectl create namespace otel
kubectl create secret generic scout-oauth2 -n otel \
  --from-literal=client_id="<scout-client-id>" \
  --from-literal=client_secret="<scout-client-secret>"

SUB="$(az account show --query id -o tsv)"
kubectl create configmap otel-azure-context -n otel \
  --from-literal=subscription_id="$SUB" \
  --from-literal=region="<region>" \
  --from-literal=cluster_name="<cluster-name>"
```

## Step 3: Helm-deploy the agent (DaemonSet)

```yaml title="helm/values-agent.yaml"
mode: daemonset

image:
  repository: otel/opentelemetry-collector-contrib
  tag: "0.151.0"

serviceAccount:
  create: true
  name: otel-agent

# Required pod label for the workload-identity webhook to inject the projected token.
podLabels:
  azure.workload.identity/use: "true"

presets:
  kubeletMetrics:
    enabled: true
  hostMetrics:
    enabled: true

# *.node.utilization metrics need API-server-proxy access to /pods.
clusterRole:
  rules:
    - apiGroups: [""]
      resources: ["nodes/proxy"]
      verbs: ["get"]

# Metrics-emitting collector — disable inbound ports.
ports:
  otlp: {enabled: false}
  otlp-http: {enabled: false}
  jaeger-compact: {enabled: false}
  jaeger-thrift: {enabled: false}
  jaeger-grpc: {enabled: false}
  zipkin: {enabled: false}
  metrics: {enabled: false}

extraEnvs:
  - name: AZURE_SUBSCRIPTION_ID
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: subscription_id}}
  - name: AZURE_REGION
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: region}}
  - name: AKS_CLUSTER_NAME
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: cluster_name}}
  - name: ENVIRONMENT
    value: production
  - name: SCOUT_CLIENT_ID
    valueFrom: {secretKeyRef: {name: scout-oauth2, key: client_id}}
  - name: SCOUT_CLIENT_SECRET
    valueFrom: {secretKeyRef: {name: scout-oauth2, key: client_secret}}
  - name: SCOUT_TOKEN_URL
    value: https://id.b14.dev/realms/<realm>/protocol/openid-connect/token
  - name: SCOUT_OTLP_ENDPOINT
    value: https://otel.<env>.base14.io/<tenant>/otlp

config:
  receivers:
    otlp: null

    hostmetrics:
      collection_interval: 30s
      scrapers:
        # Azure Linux mounts /boot/efi root-only — exclude to silence the
        # otherwise per-scrape "permission denied" noise.
        filesystem:
          exclude_mount_points:
            match_type: regexp
            mount_points:
              - /dev/*
              - /proc/*
              - /sys/*
              - /run/k3s/containerd/*
              - /var/lib/docker/*
              - /var/lib/kubelet/*
              - /boot/efi
              - /boot
        processes: {}
        system: {}

    kubeletstats:
      collection_interval: 30s
      node: ${env:K8S_NODE_NAME}
      # `volume` must be added explicitly to emit k8s.volume.* for PVCs.
      metric_groups: [container, pod, node, volume]
      metrics:
        # Enable every default-disabled kubeletstats metric.
        container.uptime: {enabled: true}
        k8s.container.cpu_limit_utilization: {enabled: true}
        k8s.container.cpu_request_utilization: {enabled: true}
        k8s.container.memory_limit_utilization: {enabled: true}
        k8s.container.memory_request_utilization: {enabled: true}
        k8s.node.uptime: {enabled: true}
        k8s.pod.cpu_limit_utilization: {enabled: true}
        k8s.pod.cpu_request_utilization: {enabled: true}
        k8s.pod.memory_limit_utilization: {enabled: true}
        k8s.pod.memory_request_utilization: {enabled: true}
        k8s.pod.uptime: {enabled: true}
        k8s.pod.volume.usage: {enabled: true}
        k8s.container.cpu.node.utilization: {enabled: true}
        k8s.container.memory.node.utilization: {enabled: true}
        k8s.pod.cpu.node.utilization: {enabled: true}
        k8s.pod.memory.node.utilization: {enabled: true}

  extensions:
    oauth2client:
      client_id: ${env:SCOUT_CLIENT_ID}
      client_secret: ${env:SCOUT_CLIENT_SECRET}
      token_url: ${env:SCOUT_TOKEN_URL}
      endpoint_params:
        audience: b14collector

  processors:
    resource:
      attributes:
        - {key: cloud.provider, value: azure, action: insert}
        - {key: cloud.platform, value: azure_aks, action: insert}
        - {key: cloud.account.id, value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
        - {key: cloud.region, value: "${env:AZURE_REGION}", action: insert}
        - {key: k8s.cluster.name, value: "${env:AKS_CLUSTER_NAME}", action: insert}
        - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: insert}
        - {key: deployment.environment, value: "${env:ENVIRONMENT}", action: insert}
        - {key: environment, value: "${env:ENVIRONMENT}", action: insert}
        - {key: service.name, value: otel-agent, action: insert}

  exporters:
    debug: {verbosity: basic}
    otlp_http/b14:
      endpoint: ${env:SCOUT_OTLP_ENDPOINT}
      auth: {authenticator: oauth2client}
      compression: gzip

  service:
    extensions: [health_check, oauth2client]
    pipelines:
      metrics:
        receivers: [kubeletstats, hostmetrics]
        processors: [resource, batch]
        exporters: [debug, otlp_http/b14]
      traces: null
      logs: null

resources:
  requests: {cpu: 100m, memory: 128Mi}
  limits: {memory: 512Mi}
```

Install:

```bash
UAMI_CLIENT_ID="$(az identity show -g "$RG" -n "$UAMI" --query clientId -o tsv)"
WI_ANNOT='serviceAccount.annotations.azure\.workload\.identity/client-id'

helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

helm upgrade --install otel-agent open-telemetry/opentelemetry-collector \
  --version 0.153.0 -n otel -f helm/values-agent.yaml \
  --set "$WI_ANNOT=$UAMI_CLIENT_ID" --wait
```

## Step 4: Helm-deploy the cluster collector (Deployment)

The cluster collector scrapes the K8s API plus kube-state-metrics. The
chart's deployment-mode auto-creates a `Service`; with all inbound ports
disabled, K8s rejects the empty-ports Service. Disable it explicitly with
`service: {enabled: false}`.

The values file shares most blocks with `values-agent.yaml` from Step 3
(`extraEnvs`, `extensions.oauth2client`, `processors.resource`,
`exporters.{debug,otlp_http/b14}`). Copy them across; only the receiver,
pipeline, and a couple of structural differences are unique to this
release:

```yaml title="helm/values-cluster.yaml"
mode: deployment
replicaCount: 1

image:
  repository: otel/opentelemetry-collector-contrib
  tag: "0.151.0"

serviceAccount:
  create: true
  name: otel-cluster

podLabels:
  azure.workload.identity/use: "true"

presets:
  clusterMetrics:
    enabled: true

# Required by the prometheus receiver scraping kube-state-metrics + the
# additional k8s_cluster metrics enabled below.
clusterRole:
  rules:
    - apiGroups: [""]
      resources: ["persistentvolumes", "persistentvolumeclaims"]
      verbs: ["get", "list", "watch"]
    - apiGroups: ["discovery.k8s.io"]
      resources: ["endpointslices"]
      verbs: ["get", "list", "watch"]

ports:
  otlp: {enabled: false}
  otlp-http: {enabled: false}
  jaeger-compact: {enabled: false}
  jaeger-thrift: {enabled: false}
  jaeger-grpc: {enabled: false}
  zipkin: {enabled: false}
  metrics: {enabled: false}

# In deployment mode the chart creates a Service even with all ports
# disabled, which K8s rejects (empty spec.ports). Disable it.
service:
  enabled: false

extraEnvs:
  # ---- IDENTICAL to values-agent.yaml ----
  - name: AZURE_SUBSCRIPTION_ID
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: subscription_id}}
  - name: AZURE_REGION
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: region}}
  - name: AKS_CLUSTER_NAME
    valueFrom: {configMapKeyRef: {name: otel-azure-context, key: cluster_name}}
  - name: ENVIRONMENT
    value: production
  - name: SCOUT_CLIENT_ID
    valueFrom: {secretKeyRef: {name: scout-oauth2, key: client_id}}
  - name: SCOUT_CLIENT_SECRET
    valueFrom: {secretKeyRef: {name: scout-oauth2, key: client_secret}}
  - name: SCOUT_TOKEN_URL
    value: https://id.b14.dev/realms/<realm>/protocol/openid-connect/token
  - name: SCOUT_OTLP_ENDPOINT
    value: https://otel.<env>.base14.io/<tenant>/otlp

config:
  receivers:
    otlp: null

    prometheus:
      config:
        scrape_configs:
          - job_name: kube-state-metrics
            scrape_interval: 30s
            static_configs:
              - targets:
                  - kube-state-metrics.kube-state-metrics.svc.cluster.local:8080

    k8s_cluster:
      collection_interval: 30s
      metrics:
        # Enable every default-disabled k8s_cluster metric.
        k8s.container.status.reason: {enabled: true}
        k8s.container.status.state: {enabled: true}
        k8s.node.condition: {enabled: true}
        k8s.persistentvolume.status.phase: {enabled: true}
        k8s.persistentvolume.storage.capacity: {enabled: true}
        k8s.persistentvolumeclaim.status.phase: {enabled: true}
        k8s.persistentvolumeclaim.storage.capacity: {enabled: true}
        k8s.persistentvolumeclaim.storage.request: {enabled: true}
        k8s.pod.status_reason: {enabled: true}
        k8s.service.endpoint.count: {enabled: true}
        k8s.service.load_balancer.ingress.count: {enabled: true}

  extensions:
    # ---- IDENTICAL to values-agent.yaml ----
    oauth2client:
      client_id: ${env:SCOUT_CLIENT_ID}
      client_secret: ${env:SCOUT_CLIENT_SECRET}
      token_url: ${env:SCOUT_TOKEN_URL}
      endpoint_params:
        audience: b14collector

  processors:
    # ---- IDENTICAL to values-agent.yaml — except service.name = otel-cluster ----
    resource:
      attributes:
        - {key: cloud.provider, value: azure, action: insert}
        - {key: cloud.platform, value: azure_aks, action: insert}
        - {key: cloud.account.id, value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
        - {key: cloud.region, value: "${env:AZURE_REGION}", action: insert}
        - {key: k8s.cluster.name, value: "${env:AKS_CLUSTER_NAME}", action: insert}
        - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: insert}
        - {key: deployment.environment, value: "${env:ENVIRONMENT}", action: insert}
        - {key: environment, value: "${env:ENVIRONMENT}", action: insert}
        - {key: service.name, value: otel-cluster, action: insert}

  exporters:
    # ---- IDENTICAL to values-agent.yaml ----
    debug: {verbosity: basic}
    otlp_http/b14:
      endpoint: ${env:SCOUT_OTLP_ENDPOINT}
      auth: {authenticator: oauth2client}
      compression: gzip

  service:
    extensions: [health_check, oauth2client]
    pipelines:
      metrics:
        receivers: [k8s_cluster, prometheus]
        processors: [resource, batch]
        exporters: [debug, otlp_http/b14]
      traces: null
      logs: null

resources:
  requests: {cpu: 50m, memory: 128Mi}
  limits: {memory: 512Mi}
```

Install:

```bash
helm upgrade --install otel-cluster open-telemetry/opentelemetry-collector \
  --version 0.153.0 -n otel -f helm/values-cluster.yaml \
  --set "$WI_ANNOT=$UAMI_CLIENT_ID" --wait
```

## Step 5: Install kube-state-metrics

The cluster collector's `prometheus` receiver above scrapes
kube-state-metrics for `kube_*` metrics that `k8s_cluster` doesn't cover.
Install it once:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-state-metrics --create-namespace --wait
```

## Verify the setup

```bash
kubectl get pods -n otel
# NAME                                                    READY   STATUS
# otel-agent-opentelemetry-collector-agent-xxxxx          1/1     Running
# otel-cluster-opentelemetry-collector-xxxxxxxxxx-xxxxx   1/1     Running

kubectl logs -n otel daemonset/otel-agent-opentelemetry-collector-agent --tail=10
# look for: info Metrics ... resource metrics: N, metrics: N, data points: N

# Confirm Scout export (port-forward to the in-cluster collector's :8888)
kubectl port-forward -n otel daemonset/otel-agent-opentelemetry-collector-agent 8888 &
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_metric_points_total
# otelcol_exporter_sent_metric_points_total{exporter="otlp_http/b14",...}  N
# otelcol_exporter_sent_metric_points_total{exporter="debug",...}  N
# (the two values should match — debug count == otlphttp count → 0 dropped)
```

## Key alerts to configure

| Alert | Source | Warning | Critical | Why |
|---|---|---|---|---|
| Pod restart spike | `k8s.container.restarts` (k8s_cluster) | rate > 1/min for 5 min | rate > 5/min for 5 min | Container is crashlooping or being OOM-killed |
| Node memory utilization | `k8s.node.memory.working_set / k8s.node.memory.usage` (kubeletstats) | > 80% for 10 min | > 90% for 5 min | Node pressure → eviction risk |
| Pod CPU throttled | `k8s.pod.cpu_limit_utilization` (kubeletstats) | > 0.8 for 10 min | > 0.95 for 5 min | Workload exceeding its CPU limit; latency suffers |
| HPA stuck at max | `k8s.hpa.current_replicas / k8s.hpa.max_replicas` (k8s_cluster) | >= 1.0 for 15 min | (alert at warning) | Workload demand exceeds the autoscaler ceiling |
| Volume usage | `k8s.volume.available / k8s.volume.capacity` (kubeletstats) | > 80% | > 90% | PVC nearing capacity; risk of write failures |
| PVC pending | `k8s.persistentvolumeclaim.status.phase == Pending` for 10 min | true | (alert at warning) | Storage class / provisioner issue |
| Daemonset misscheduled | `k8s.daemonset.misscheduled_nodes` (k8s_cluster) | > 0 | > 0 for 30 min | Node-selector / taint mismatch |
| Job failures | `kube_job_status_failed` (kube-state-metrics) | > 0 in 1 hour | > 5 in 1 hour | Scheduled work failing repeatedly |
| Container restart by reason | `k8s.container.status.reason` (k8s_cluster) | OOMKilled count > 0 in 10 min | OOMKilled count > 3 in 5 min | OOM kills indicate undersized memory limits |

## Troubleshooting

### `service.telemetry.resource` legacy format warning at startup

Upstream chart `0.153.0` emits the chart's auto-generated
`service.telemetry.resource` in the legacy inline-map format. The collector
logs a one-shot deprecation warning at startup; functionality is unaffected.
Overriding `service.telemetry.resource.attributes` from your values causes
the collector to error out (chart-injected keys still merge in). Carry the
warning until the chart upgrades.

### `failed to read usage at /hostfs/boot/efi: permission denied`

Per-scrape (every 30s) error. Azure Linux mounts the EFI System Partition
at `/boot/efi` root-only, the unprivileged hostmetrics collector can't
`df` it. Add `/boot/efi` and `/boot` to
`hostmetrics.scrapers.filesystem.exclude_mount_points.mount_points`. The
override replaces the chart preset's defaults, so include the chart's
defaults too.

### `Service ... is invalid: spec.ports: Required value` on `helm install`

Hits the cluster-mode (Deployment) release. With all inbound ports
disabled the chart still tries to create a `Service` with zero ports,
which K8s rejects. Set `service: {enabled: false}` in the cluster values.

### `k8s.volume.*` not emitting despite a pod with PVC

`kubeletstats` defaults `metric_groups` to `[container, pod, node]`. The
`volume` group must be added explicitly (`metric_groups: [container, pod,
node, volume]`).

### Pods stuck in `CreateContainerConfigError`

Almost always: the `scout-oauth2` Secret is missing or has wrong keys.
The chart values reference `secretKeyRef: {name: scout-oauth2, key:
client_id|client_secret}` and won't start the container until both
exist. Recreate it (Step 2) and the pods will progress to `Running`.

## Frequently Asked Questions

### How do I monitor an Azure Kubernetes Service cluster with OpenTelemetry?

Deploy the upstream OpenTelemetry Collector Helm chart twice in your AKS
cluster — once as a DaemonSet (kubeletstats + hostmetrics) for per-node
metrics, once as a Deployment (k8s_cluster + prometheus scraping
kube-state-metrics) for cluster-state and additional `kube_*` metrics. Both
ship OTLP/HTTP to base14 Scout authenticated via OAuth2 client credentials.
ServiceAccounts authenticate to Azure via Workload Identity Federation.

### How does the in-cluster collector authenticate to base14 Scout?

Via the OpenTelemetry Collector `oauth2client` extension. Store the
Scout-issued `client_id` and `client_secret` in a Kubernetes Secret,
reference them in the chart values via `secretKeyRef`, and the
`otlp_http/b14` exporter automatically fetches short-lived bearer tokens
from your Keycloak token URL on each scrape interval (cached until expiry).

### Why do I need two Helm releases instead of one?

The `kubeletstats` receiver runs per-node (DaemonSet mode) so each kubelet
is scraped from its own pod. The `k8s_cluster` receiver pulls cluster-wide
state from the K8s API once and would emit duplicates if scaled
horizontally — it runs as a single-replica Deployment. Splitting into two
releases gives each receiver the right Pod controller without compromise.

### How is this different from Microsoft's Managed Prometheus and Container Insights?

Managed Prometheus and Container Insights are Azure-tenant-bound, billed
per-GB ingested, and visualized in Managed Grafana / Log Analytics. The
OpenTelemetry Collector pattern is vendor-neutral — the same collectors
can ship to base14 Scout, Datadog, Splunk, or any OTLP-compatible backend
without redeployment. Customers running multi-cloud or migrating off
Azure-native observability prefer this.

### What is kube-state-metrics and why is it part of this guide?

kube-state-metrics exposes detailed Kubernetes object state (HPA replicas,
Job completions, PVC capacity, node allocatable resources) in
Prometheus-format. The `k8s_cluster` OTel receiver covers some of this,
but kube-state-metrics has wider coverage. The cluster-mode collector
includes a `prometheus` receiver that scrapes kube-state-metrics so both
metric families flow to Scout in one pipeline.

### How do I add control-plane metrics like API-server uptime?

Control-plane metrics - API server uptime, etcd usage, cluster-autoscaler
decisions - are published by Azure Monitor for the AKS resource and
require a separate collector with the `azure_monitor` receiver
authenticated via Service Principal or Managed Identity. Most workloads
don't need this; the in-cluster pattern in this guide covers most
operational signals. A dedicated Azure Monitor receiver guide is planned.

## Related Guides

- [CloudWatch Metrics Stream](../aws/cloudwatch-metrics-stream.md) — the
  AWS counterpart for cloud-native infrastructure metrics.
- [OpenTelemetry Collector Helm chart](https://github.com/open-telemetry/opentelemetry-helm-charts/tree/main/charts/opentelemetry-collector) —
  upstream chart documentation.
- [kube-state-metrics Helm chart](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-state-metrics) —
  exporter source and configuration.
- Working example with Bicep, Helm values, and demo workloads:
  [`base-14/examples/components/azure-aks-telemetry`](https://github.com/base-14/examples/tree/main/components/azure-aks-telemetry).
