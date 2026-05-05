---
date: 2026-05-01
id: collecting-azure-aks-telemetry-with-helm
title: Azure Kubernetes Service Monitoring with OpenTelemetry Helm Releases
sidebar_label: Azure Kubernetes Service (Helm)
sidebar_position: 2
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
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor an Azure Kubernetes Service cluster with OpenTelemetry?","acceptedAnswer":{"@type":"Answer","text":"Deploy the upstream OpenTelemetry Collector Helm chart twice in your AKS cluster - once as a DaemonSet (kubeletstats + hostmetrics) for per-node metrics, once as a Deployment (k8s_cluster + prometheus scraping kube-state-metrics) for cluster-state and additional kube_* metrics. Both ship OTLP/HTTP to base14 Scout authenticated via OAuth2 client credentials. ServiceAccounts authenticate to Azure via Workload Identity Federation."}},{"@type":"Question","name":"How does the in-cluster collector authenticate to base14 Scout?","acceptedAnswer":{"@type":"Answer","text":"Via the OpenTelemetry Collector oauth2client extension. Store the Scout-issued client_id and client_secret in a Kubernetes Secret, reference them in the chart values via secretKeyRef, and the otlp_http/b14 exporter automatically fetches short-lived bearer tokens from your Scout token URL, cached until expiry."}},{"@type":"Question","name":"Why do I need two Helm releases instead of one?","acceptedAnswer":{"@type":"Answer","text":"The kubeletstats receiver runs per-node (DaemonSet mode) so each kubelet is scraped from its own pod. The k8s_cluster receiver pulls cluster-wide state from the K8s API once and would emit duplicates if scaled horizontally - it runs as a single-replica Deployment. Splitting into two releases gives each receiver the right Pod controller without compromise."}},{"@type":"Question","name":"How is this different from Microsoft's Managed Prometheus and Container Insights?","acceptedAnswer":{"@type":"Answer","text":"Managed Prometheus and Container Insights are Azure-tenant-bound, billed per-GB ingested, and visualized in Managed Grafana / Log Analytics. The OpenTelemetry Collector is vendor-neutral - the same image ships to base14 Scout or any OTLP-compatible backend without redeployment. Customers running multi-cloud or migrating off Azure-native observability prefer this."}},{"@type":"Question","name":"What is kube-state-metrics and why is it part of this guide?","acceptedAnswer":{"@type":"Answer","text":"kube-state-metrics exposes detailed Kubernetes object state (HPA replicas, Job completions, PVC capacity, node allocatable resources) in Prometheus-format. The k8s_cluster OTel receiver covers some of this, but kube-state-metrics has wider coverage. The cluster-mode collector includes a prometheus receiver that scrapes kube-state-metrics so both metric families flow to Scout in one pipeline."}},{"@type":"Question","name":"How do I add control-plane metrics like API-server uptime?","acceptedAnswer":{"@type":"Answer","text":"Follow Step 6 in this guide. It deploys a standalone OpenTelemetry Collector with the azure_monitor receiver against the AKS resource, authenticated via Service Principal. You get 18 control-plane series (9 metrics emitted at two aggregations each - apiserver, etcd, autoscaler) on a vanilla cluster, or more if Container Insights / Managed Prometheus are enabled. Most workloads don't need this - the in-cluster pattern in Steps 1-5 covers pod / container / cluster-state visibility, which is where most operational signals live."}}]}
---

:::note
Looking for the canonical operator-managed AKS guide? See
[the operator guide](aks.md). This
guide uses raw Helm releases for readers who prefer not to install the
OpenTelemetry Operator (cluster-scoped CRDs blocked by org policy, or operator
already in use for unrelated workloads).
:::

This guide runs the OpenTelemetry Collector twice in an Azure Kubernetes
Service (AKS) cluster - as a DaemonSet for per-node metrics, and as a
single-replica Deployment for cluster-wide state. Both ship OTLP/HTTP to
base14 Scout.

## Why Scout for AKS observability

Microsoft recommends **Managed Prometheus + Container Insights + Managed
Grafana** as the AKS observability stack
([learn.microsoft.com/azure/aks/monitor-aks](https://learn.microsoft.com/azure/aks/monitor-aks),
updated 2026-01-20). It works, but it ties your telemetry to Azure: metrics
land in a Log Analytics workspace, alerts route through Azure Monitor, and
dashboards live in Managed Grafana. Multi-cloud, hybrid, or migrating
customers prefer this guide because the same OpenTelemetry Collector ships
to Scout, to a self-hosted Prometheus, or to any OTLP-compatible backend -
switching backends is a values-file change, not a redeployment of agents.

## Choosing the right pattern

Three viable patterns for wiring AKS metrics to Scout. They differ in
coverage, identity model, and operator effort.

| Pattern | Metric coverage | Auth model | Setup |
|---|---|---|---|
| **A. In-cluster + kube-state-metrics** (default) | ~286 metrics; rich pod / container / cluster-state | Workload Identity Federation | Helm install x 2 + KSM (Steps 1-5) |
| **B. A + `azure_monitor` for control plane** | A + 18 control-plane metrics (apiserver, etcd, autoscaler) | WIF in-cluster + Service Principal standalone | Pattern A + Step 6 |
| **C. `azure_monitor` only** | 18 metrics on a vanilla cluster; more if Container Insights / Managed Prometheus add-ons are enabled | Service Principal | Step 6 standalone |

- **Pick A** if pod / container / cluster-state visibility is what you need.
  Steps 1-5 get you there; skip Step 6.
- **Pick B** if API server SLO tracking, etcd usage trending, or
  cluster-autoscaler decisions matter operationally. Do Steps 1-5, then
  add Step 6.
- **Pick C** only if you already have Container Insights or Managed
  Prometheus enabled (otherwise it's 18 metrics for the cost of a Service
  Principal). Skip Steps 1-5 and do Step 6 standalone.

The rest of this guide walks Pattern A in Steps 1-5 and adds the Step 6
overlay for Patterns B and C.

## What you'll monitor

Pattern A's two collectors emit ~286 distinct metric names against a
working cluster; Step 6 adds 18 control-plane series on top. They share
the same `cloud.region` / `k8s.cluster.name` / `cloud.account.id` resource
attributes so you can group across them in Scout.

| Receiver | Mode | What it covers | Example metrics |
|---|---|---|---|
| `kubeletstats` | DaemonSet (Pattern A) | Pod / container / node / volume usage from the kubelet | `k8s.pod.cpu.usage`, `k8s.node.memory.working_set`, `container.memory.rss`, `k8s.volume.available`, `k8s.pod.cpu_limit_utilization` |
| `hostmetrics` | DaemonSet (Pattern A) | Node OS-level telemetry | `system.cpu.time`, `system.disk.io`, `system.network.errors`, `system.processes.count`, `system.uptime` |
| `k8s_cluster` | Deployment, 1 replica (Pattern A) | K8s API objects | `k8s.deployment.available`, `k8s.daemonset.ready_nodes`, `k8s.pod.phase`, `k8s.cronjob.active_jobs`, `k8s.hpa.current_replicas`, `k8s.statefulset.ready_pods`, `k8s.persistentvolumeclaim.status.phase` |
| `prometheus` (scrapes kube-state-metrics) | Deployment, 1 replica (Pattern A) | Detailed K8s state in Prometheus form | `kube_node_status_allocatable`, `kube_pod_container_resource_limits`, `kube_horizontalpodautoscaler_status_current_replicas`, `kube_job_status_succeeded` |
| `azure_monitor` | Standalone (Patterns B and C, optional) | AKS resource control plane via Azure Monitor | `azure_apiserver_cpu_usage_percentage_average`, `azure_etcd_database_usage_percentage_maximum`, `azure_cluster_autoscaler_unschedulable_pods_count_total` |

## Prerequisites

- An AKS cluster with **OIDC issuer** and **Workload Identity** enabled
  (`oidcIssuerProfile.enabled: true`,
  `securityProfile.workloadIdentity.enabled: true`). These are off by default;
  enable via Bicep / ARM / `az aks update`.
- `kubectl` >= 1.30, `helm` >= 3.14.
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
  pullPolicy: IfNotPresent

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

# Metrics-emitting collector - disable inbound ports.
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
        # Azure Linux mounts /boot/efi root-only - exclude to silence the
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
      # K8S_NODE_NAME is auto-injected by the chart's kubeletMetrics preset
      # via the downward API. Do NOT add it to extraEnvs (duplicate keys
      # break the DaemonSet apply).
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
    health_check: {}  # chart-injected default; override with explicit endpoint if needed
    oauth2client:
      client_id: ${env:SCOUT_CLIENT_ID}
      client_secret: ${env:SCOUT_CLIENT_SECRET}
      token_url: ${env:SCOUT_TOKEN_URL}
      endpoint_params:
        audience: b14collector
      timeout: 10s

  processors:
    batch: {}  # chart-injected default; override e.g. with timeout: 5s, send_batch_size: 1024
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
      timeout: 30s
      retry_on_failure:
        enabled: true
        initial_interval: 1s
        max_interval: 30s
        max_elapsed_time: 300s

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
  pullPolicy: IfNotPresent

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
    health_check: {}  # chart-injected default; override with explicit endpoint if needed
    oauth2client:
      client_id: ${env:SCOUT_CLIENT_ID}
      client_secret: ${env:SCOUT_CLIENT_SECRET}
      token_url: ${env:SCOUT_TOKEN_URL}
      endpoint_params:
        audience: b14collector
      timeout: 10s

  processors:
    # ---- IDENTICAL to values-agent.yaml - except service.name = otel-cluster ----
    batch: {}  # chart-injected default; override e.g. with timeout: 5s, send_batch_size: 1024
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
      timeout: 30s
      retry_on_failure:
        enabled: true
        initial_interval: 1s
        max_interval: 30s
        max_elapsed_time: 300s

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

## Step 6 (optional): Add control-plane metrics with `azure_monitor`

This is Pattern B from "Choosing the right pattern" (or Pattern C if you
skipped Steps 1-5). Skip if control-plane visibility - API server uptime,
etcd usage, autoscaler decisions - isn't a priority for your workload.

### What you'll get

Nine ARM-level metrics published by Azure Monitor for the AKS resource,
each emitted at two aggregations (18 distinct series total):

| Metric | What it tells you |
|---|---|
| `apiserver_cpu_usage_percentage` (avg / max) | API server load - spikes correlate with kubectl traffic / controller storms. |
| `apiserver_memory_usage_percentage` (avg / max) | API server memory pressure. |
| `etcd_cpu_usage_percentage` (avg / max) | etcd CPU - affects write latency. |
| `etcd_database_usage_percentage` (avg / max) | etcd storage usage - nearing 100% means writes will start failing. |
| `etcd_memory_usage_percentage` (avg / max) | etcd memory pressure. |
| `cluster_autoscaler_cluster_safe_to_autoscale` (total / avg) | Whether the autoscaler is allowed to act. |
| `cluster_autoscaler_scale_down_in_cooldown` (total / avg) | Why scale-down isn't happening. |
| `cluster_autoscaler_unneeded_nodes_count` (total / avg) | Nodes the autoscaler wants to remove. |
| `cluster_autoscaler_unschedulable_pods_count` (total / avg) | Pods waiting because the autoscaler can't fit them. |

### What requires Container Insights or Managed Prometheus

Azure Monitor registers more metric definitions for the AKS resource type
(`kube_*`, `node_disk_usage_*`, `node_network_*`) but they only have data
when the **Container Insights** or **Managed Prometheus** add-ons are
enabled on the cluster. Without those, the `metrics:getBatch` call returns
401 (not "no data") for those names - Azure's API surfaces "RBAC not
enabled for this metric source" as an authorization failure.

Enabling Container Insights or Managed Prometheus is a customer choice
that gives you more control-plane data but reintroduces the Azure-Monitor
ingestion costs and lock-in this guide is positioned against. The
canonical recommendation is Pattern A (in-cluster collectors + KSM) for
the rich data and Step 6 for control plane only when explicitly needed.

### Cluster autoscaling required for autoscaler metrics

The four `cluster_autoscaler_*` metrics have two distinct behaviors depending
on your node pool configuration:

- If cluster autoscaling is not enabled on any node pool, the four metrics
  return 401 (no backing data source). Remove them from the receiver's metric
  whitelist in that case.
- If cluster autoscaling is enabled but the pool is pinned (e.g.
  `minCount = maxCount = 1`), the metrics emit with zero/idle values; that is
  expected and indicates the autoscaler is healthy but inactive.

Enable autoscaling with `enableAutoScaling: true, minCount: N, maxCount: M`
in Bicep, or `--enable-cluster-autoscaler` via CLI.

### Service Principal + Monitoring Reader

The standalone collector authenticates to Azure via a Service Principal.
Workload Identity Federation requires running in-Azure with an attached
Managed Identity; a standalone collector on a Mac, in a Container Apps
job, or in a Container Instance uses SP credentials.

```bash
# (Pattern C readers who skipped Steps 1-5 should set $RG to their cluster's
# resource group now; Pattern B readers already have it from Step 1.)

SP_NAME=otel-aks-control-plane
SP_JSON="$(az ad sp create-for-rbac --name "$SP_NAME" --skip-assignment)"
APP_ID="$(echo "$SP_JSON" | jq -r .appId)"
PASSWORD="$(echo "$SP_JSON" | jq -r .password)"
TENANT="$(echo "$SP_JSON" | jq -r .tenant)"
# Store as AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
# respectively (see the env-file block below).

SP_OBJECT_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv)"
SUB="$(az account show --query id -o tsv)"

az role assignment create \
  --assignee-object-id "$SP_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Monitoring Reader" \
  --scope "/subscriptions/$SUB/resourceGroups/$RG"
```

`Monitoring Reader` propagates immediately on the legacy ARM `/metrics`
endpoint. The newer `metrics:getBatch` data-plane endpoint can lag 5-30
minutes; pin `use_batch_api: false` until the data plane has settled (see
Troubleshooting).

### Standalone collector config

```yaml title="config/otel-collector-control-plane.yaml"
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}
  oauth2client:
    client_id: ${env:SCOUT_CLIENT_ID}
    client_secret: ${env:SCOUT_CLIENT_SECRET}
    token_url: ${env:SCOUT_TOKEN_URL}
    endpoint_params: {audience: b14collector}
    timeout: 10s

  # Liveness probe - useful when running this collector as a Container Apps
  # job, in Container Instances, or behind a load balancer.
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  azure_monitor:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    resource_groups: ["${env:AZURE_RESOURCE_GROUP}"]
    services: ["Microsoft.ContainerService/managedClusters"]
    auth: {authenticator: azure_auth}
    collection_interval: 60s
    # Legacy ARM /metrics endpoint - RBAC propagates immediately.
    # Switch to true once Monitoring Reader has propagated to the
    # metrics:getBatch data plane (5-30 min after grant).
    use_batch_api: false
    cache_resources: 60
    dimensions: {enabled: true}
    # Whitelist explicit metrics. Discovery-mode iterates EVERY metric
    # definition the resource type registers and 401s on those whose
    # data sources aren't enabled (kube_*, node_disk_usage_*).
    metrics:
      "Microsoft.ContainerService/managedClusters":
        apiserver_cpu_usage_percentage: []
        apiserver_memory_usage_percentage: []
        etcd_cpu_usage_percentage: []
        etcd_database_usage_percentage: []
        etcd_memory_usage_percentage: []
        # Remove these four if cluster autoscaling is not enabled on any node pool.
        # If autoscaling IS enabled but the pool is pinned (minCount = maxCount),
        # the metrics emit with zero/idle values - that is expected behavior.
        cluster_autoscaler_cluster_safe_to_autoscale: []
        cluster_autoscaler_scale_down_in_cooldown: []
        cluster_autoscaler_unneeded_nodes_count: []
        cluster_autoscaler_unschedulable_pods_count: []

processors:
  resource:
    attributes:
     - {key: cloud.provider, value: azure, action: insert}
     - {key: cloud.platform, value: azure_aks, action: insert}
     - {key: cloud.account.id, value: "${env:AZURE_SUBSCRIPTION_ID}", action: insert}
     - {key: cloud.region, value: "${env:AZURE_REGION}", action: insert}
     - {key: cloud.resource_id, value: "${env:AKS_RESOURCE_ID}", action: insert}
     - {key: k8s.cluster.name, value: "${env:AKS_CLUSTER_NAME}", action: insert}
     - {key: deployment.environment.name, value: "${env:ENVIRONMENT}", action: insert}
     - {key: deployment.environment, value: "${env:ENVIRONMENT}", action: insert}
     - {key: environment, value: "${env:ENVIRONMENT}", action: insert}
     - {key: service.name, value: aks-control-plane, action: insert}
  batch: {timeout: 5s, send_batch_size: 1024}
  memory_limiter: {check_interval: 5s, limit_percentage: 80, spike_limit_percentage: 25}

exporters:
  debug: {verbosity: basic}
  otlp_http/b14:
    endpoint: ${env:SCOUT_OTLP_ENDPOINT}
    auth: {authenticator: oauth2client}
    compression: gzip
    timeout: 30s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s
      max_elapsed_time: 300s

service:
  extensions: [health_check, azure_auth, oauth2client]
  pipelines:
    metrics:
      receivers: [azure_monitor]
      processors: [memory_limiter, resource, batch]
      exporters: [debug, otlp_http/b14]
  # Self-telemetry - exposes /metrics on :8888 inside the container so the
  # Verify section's curl-for-otelcol_exporter_sent_metric_points_total
  # check works for this standalone collector too.
  telemetry:
    logs: {level: info}
    metrics:
      readers:
       - pull:
            exporter:
              prometheus:
                host: 0.0.0.0
                port: 8888
```

Run it as a docker container (locally for validation, in Azure Container
Instances or as a Container Apps job for production). Three env files
keep the values out of the docker run command line:

```bash
# Service Principal credentials (from `az ad sp create-for-rbac` above)
cat > azure-sp.env <<EOF
AZURE_TENANT_ID=$TENANT
AZURE_CLIENT_ID=$APP_ID
AZURE_CLIENT_SECRET=$PASSWORD
EOF

# Cluster context. AKS_RESOURCE_ID is the full ARM resource ID:
#   /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.ContainerService/managedClusters/<cluster>
AKS_RESOURCE_ID="$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)"
cat > aks-context.env <<EOF
AZURE_SUBSCRIPTION_ID=$SUB
AZURE_RESOURCE_GROUP=$RG
AZURE_REGION=$(az aks show -g "$RG" -n "$CLUSTER" --query location -o tsv)
AKS_RESOURCE_ID=$AKS_RESOURCE_ID
AKS_CLUSTER_NAME=$CLUSTER
ENVIRONMENT=production
EOF

# Scout OAuth2 credentials (your operator-local file)
# scout.env should already contain SCOUT_CLIENT_ID, SCOUT_CLIENT_SECRET,
# SCOUT_TOKEN_URL, SCOUT_OTLP_ENDPOINT.
```

Then run:

```bash
docker run -d --name otel-aks-control-plane \
  --env-file ./scout.env \
  --env-file ./azure-sp.env \
  --env-file ./aks-context.env \
  -p 13133:13133 \
  -p 8888:8888 \
  -v "$PWD/config/otel-collector-control-plane.yaml:/etc/otel/config.yaml:ro" \
  otel/opentelemetry-collector-contrib:0.151.0 \
  --config=/etc/otel/config.yaml
# Note: remap -p 8888 if your host already runs Prometheus or another otelcol.
```

Health check at `http://localhost:13133/`. Self-metrics at
`http://localhost:8888/metrics` (use this to verify Scout export - see
"Verify the setup" below).

## Verify the setup

```bash
kubectl get pods -n otel
# NAME                                                    READY   STATUS
# otel-agent-opentelemetry-collector-agent-xxxxx          1/1     Running
# otel-cluster-opentelemetry-collector-xxxxxxxxxx-xxxxx   1/1     Running

kubectl logs -n otel daemonset/otel-agent-opentelemetry-collector-agent --tail=10
# look for: info Metrics ... resource metrics: N, metrics: N, data points: N

# Confirm Scout export from the in-cluster collectors (port-forward to :8888)
kubectl port-forward -n otel daemonset/otel-agent-opentelemetry-collector-agent 8888 &
sleep 1   # let the port-forward bind before curl
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_metric_points_total
# otelcol_exporter_sent_metric_points_total{exporter="otlp_http/b14",...}  N
# otelcol_exporter_sent_metric_points_total{exporter="debug",...}  N
# (the two values should match - debug count == otlphttp count → 0 dropped)
```

If you ran Step 6, verify the standalone collector the same way against its
mapped 8888 port:

```bash
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_metric_points_total
```

## Key alerts to configure

| Alert | Source | Warning | Critical | Why |
|---|---|---|---|---|
| Pod restart spike | `k8s.container.restarts` (k8s_cluster) | rate > 1/min for 5 min | rate > 5/min for 5 min | Container is crashlooping or being OOM-killed. |
| Node memory utilization | `k8s.node.memory.working_set / k8s.node.memory.usage` (kubeletstats) | > 80% for 10 min | > 90% for 5 min | Node pressure, eviction risk. |
| Pod CPU throttled | `k8s.pod.cpu_limit_utilization` (kubeletstats) | > 0.8 for 10 min | > 0.95 for 5 min | Workload exceeding its CPU limit; latency suffers. |
| HPA stuck at max | `k8s.hpa.current_replicas / k8s.hpa.max_replicas` (k8s_cluster) | >= 1.0 for 15 min | (alert at warning) | Workload demand exceeds the autoscaler ceiling. |
| Volume usage | `k8s.volume.available / k8s.volume.capacity` (kubeletstats) | > 80% | > 90% | PVC nearing capacity; risk of write failures. |
| PVC pending | `k8s.persistentvolumeclaim.status.phase == Pending` for 10 min | true | (alert at warning) | Storage class / provisioner issue. |
| Daemonset misscheduled | `k8s.daemonset.misscheduled_nodes` (k8s_cluster) | > 0 | > 0 for 30 min | Node-selector / taint mismatch. |
| Job failures | `kube_job_status_failed` (kube-state-metrics) | > 0 in 1 hour | > 5 in 1 hour | Scheduled work failing repeatedly. |
| Container restart by reason | `k8s.container.status.reason` (k8s_cluster) | OOMKilled count > 0 in 10 min | OOMKilled count > 3 in 5 min | OOM kills indicate undersized memory limits. |
| API server CPU (Step 6) | `azure_apiserver_cpu_usage_percentage_average` | > 60% for 10 min | > 80% for 5 min | Control plane stressed; possibly oversized cluster. |
| etcd database usage (Step 6) | `azure_etcd_database_usage_percentage_average` | > 60% | > 80% | etcd nearing storage limit; affects writes. |
| Autoscaler unschedulable pods (Step 6) | `azure_cluster_autoscaler_unschedulable_pods_count_total` | > 0 for 10 min | > 5 for 5 min | Autoscaler can't schedule due to taints, quotas, or VM SKU availability. |

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

### Step 6 returns 401 `AuthorizationFailed` on `metrics:getBatch`

Azure Monitor's newer data-plane API at `*.metrics.monitor.azure.com`
requires separate RBAC propagation (5-30 min after the `Monitoring
Reader` grant) on top of the legacy ARM `/metrics` endpoint. Default
`use_batch_api: false` in the receiver until the data plane has settled.
Switch to `true` once the RBAC has propagated; the batch API is more
rate-limit-friendly at fleet scale.

### Step 6 returns 401 for `kube_*` / `node_disk_usage_*` metrics

Those metric definitions exist in Azure Monitor for the AKS resource type
but have no backing data source unless the **Container Insights** or
**Managed Prometheus** add-on is enabled on the cluster. Without those,
AzMon returns 401 (not "no data" - the API doesn't distinguish). The
metric whitelist in the receiver config filters to ARM-only metrics that
work everywhere. Extend the whitelist with names from your Azure Portal →
Metrics blade if you've enabled the add-ons.

## Frequently Asked Questions

### How do I monitor an Azure Kubernetes Service cluster with OpenTelemetry?

Deploy the upstream OpenTelemetry Collector Helm chart twice in your AKS
cluster - once as a DaemonSet (kubeletstats + hostmetrics) for per-node
metrics, once as a Deployment (k8s_cluster + prometheus scraping
kube-state-metrics) for cluster-state and additional `kube_*` metrics. Both
ship OTLP/HTTP to base14 Scout authenticated via OAuth2 client credentials.
ServiceAccounts authenticate to Azure via Workload Identity Federation.

### How does the in-cluster collector authenticate to base14 Scout?

Via the OpenTelemetry Collector `oauth2client` extension. Store the
Scout-issued `client_id` and `client_secret` in a Kubernetes Secret,
reference them in the chart values via `secretKeyRef`, and the
`otlp_http/b14` exporter automatically fetches short-lived bearer tokens
from your Scout token URL, cached until expiry.

### Why do I need two Helm releases instead of one?

The `kubeletstats` receiver runs per-node (DaemonSet mode) so each kubelet
is scraped from its own pod. The `k8s_cluster` receiver pulls cluster-wide
state from the K8s API once and would emit duplicates if scaled
horizontally - it runs as a single-replica Deployment. Splitting into two
releases gives each receiver the right Pod controller without compromise.

### How is this different from Microsoft's Managed Prometheus and Container Insights?

Managed Prometheus and Container Insights are Azure-tenant-bound, billed
per-GB ingested, and visualized in Managed Grafana / Log Analytics. The
OpenTelemetry Collector is vendor-neutral - the same image ships to base14
Scout or any OTLP-compatible backend without redeployment. Customers
running multi-cloud or migrating off Azure-native observability prefer
this.

### What is kube-state-metrics and why is it part of this guide?

kube-state-metrics exposes detailed Kubernetes object state (HPA replicas,
Job completions, PVC capacity, node allocatable resources) in
Prometheus-format. The `k8s_cluster` OTel receiver covers some of this,
but kube-state-metrics has wider coverage. The cluster-mode collector
includes a `prometheus` receiver that scrapes kube-state-metrics so both
metric families flow to Scout in one pipeline.

### How do I add control-plane metrics like API-server uptime?

Follow Step 6 above. It deploys a standalone OpenTelemetry Collector with
the `azure_monitor` receiver against the AKS resource, authenticated via
Service Principal. You get 18 control-plane series (9 metrics emitted at
two aggregations each - apiserver, etcd, autoscaler) on a vanilla cluster,
or more if Container Insights / Managed Prometheus are enabled. Most
workloads don't need this - the in-cluster pattern in Steps 1-5 covers
pod / container / cluster-state visibility, which is where most
operational signals live.

## Related Guides

- [Azure Kubernetes Service (Operator)](aks.md) - the canonical pattern
  using the OpenTelemetry Operator and CRDs.
- [Kubernetes (Scout Helm chart)][scout-helm] - alternative deployment
  pattern using Scout's own Helm chart instead of the upstream
  OpenTelemetry chart this guide uses. Useful for non-AKS Kubernetes
  platforms or operators who prefer a single Scout-curated chart over the
  upstream + values-file approach.
- [CloudWatch Metrics Stream](../aws/cloudwatch-metrics-stream.md) - the
  AWS infrastructure-metrics guide. Different pattern from this one
  (CloudWatch → Kinesis Firehose → Scout, push-stream forwarder; this
  guide is pull-based collectors).
- [OpenTelemetry Collector Helm chart][otel-helm] - upstream chart
  documentation.
- [kube-state-metrics Helm chart][ksm-helm] - exporter source and
  configuration.

[scout-helm]: ../../collector-setup/kubernetes-helm-setup.md
[otel-helm]: https://github.com/open-telemetry/opentelemetry-helm-charts/tree/main/charts/opentelemetry-collector
[ksm-helm]: https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-state-metrics
