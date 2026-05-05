---
date: 2026-05-05
id: collecting-azure-aks-telemetry
title: Azure Kubernetes Service Monitoring with OpenTelemetry Operator
sidebar_label: Azure Kubernetes Service
sidebar_position: 1
description:
  Deploy operator-managed OpenTelemetry collectors on AKS - DaemonSet
  (kubeletstats + hostmetrics), cluster Deployment (k8s_cluster + prometheus
  scraping kube-state-metrics), control-plane Deployment (azure_monitor) -
  plus zero-code application auto-instrumentation for Java, Python, Node.js,
  and Go (eBPF). Vendor-neutral alternative to Container Insights, Managed
  Prometheus, and Managed Grafana.
keywords:
  [
    azure kubernetes service monitoring,
    aks observability,
    opentelemetry operator,
    auto-instrumentation,
    workload identity federation,
    base14 scout aks,
  ]
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How do I monitor an AKS cluster with the OpenTelemetry Operator?","acceptedAnswer":{"@type":"Answer","text":"Install cert-manager, then deploy the opentelemetry-operator Helm chart. Create OpenTelemetryCollector CRs for a DaemonSet (kubeletstats + hostmetrics), a cluster Deployment (k8s_cluster + prometheus scraping kube-state-metrics), and optionally a control-plane Deployment (azure_monitor). Apply an Instrumentation CR and annotate your pods to enable zero-code auto-instrumentation for Python, Node.js, Java, and Go."}},{"@type":"Question","name":"How does the operator-managed collector authenticate to base14 Scout?","acceptedAnswer":{"@type":"Answer","text":"Via the oauth2client extension. Store the Scout-issued client_id and client_secret in a Kubernetes Secret named scout-oauth2 in the otel namespace, reference them in the OpenTelemetryCollector CR's envFrom, and the otlp_http/b14 exporter fetches short-lived bearer tokens automatically."}},{"@type":"Question","name":"Why three OpenTelemetryCollector CRs instead of one?","acceptedAnswer":{"@type":"Answer","text":"Each CR maps to a specific Pod controller and receiver family. kubeletstats needs a DaemonSet (one pod per node). k8s_cluster needs a single-replica Deployment (duplicates if scaled). azure_monitor is a lightweight control-plane scraper that runs as a separate Deployment so you can scope its Service Principal credentials independently. Merging them would force compromises on controller type or RBAC scope."}},{"@type":"Question","name":"How does this differ from Microsoft's Managed Prometheus and Container Insights?","acceptedAnswer":{"@type":"Answer","text":"Managed Prometheus and Container Insights are Azure-tenant-bound, billed per-GB ingested, and visualized in Managed Grafana or Log Analytics. The OpenTelemetry Collector is vendor-neutral - the same image and CRs ship to base14 Scout or any OTLP-compatible backend without redeployment. Multi-cloud and hybrid teams prefer this pattern because backend switches are config changes, not agent re-deployments."}},{"@type":"Question","name":"What languages support auto-instrumentation here, and which are not yet validated?","acceptedAnswer":{"@type":"Answer","text":"Validated in this guide: Python (FastAPI), Node.js (Express), Java (Spring Boot 3 on LTS 21), and Go (eBPF, net/http). .NET is supported by the operator's Instrumentation CR pattern but the ConfigMap-mounted dotnet-run-on-startup shape conflicts with the CLR profiler; use pre-baked images (dotnet publish) for production .NET workloads."}},{"@type":"Question","name":"How do I add control-plane metrics like API server uptime?","acceptedAnswer":{"@type":"Answer","text":"Apply the otel-control-plane OpenTelemetryCollector CR from Step 7. It runs the azure_monitor receiver against the AKS resource, authenticated via Service Principal env-var auth. You get 18 control-plane series (9 metrics at two aggregations each - apiserver, etcd, autoscaler) on a vanilla cluster. If cluster autoscaling is not enabled, the four azure_cluster_autoscaler_* metrics return 401 (no backing data source) - remove them from the whitelist. If autoscaling is enabled but the pool is pinned (minCount = maxCount), the metrics emit with zero/idle values; that is expected. Most workloads only need Steps 1-6 for pod, container, and cluster-state visibility."}}]}
---

This guide deploys the OpenTelemetry Operator on AKS, then uses
`OpenTelemetryCollector` CRs to manage three collectors in-cluster plus an
`Instrumentation` CR for zero-code app auto-instrumentation.

:::tip Architecture overview
This guide is the **execution playbook** for AKS. For the cross-surface
architecture (auth, push vs pull, latency, the trace gap), read [Azure
Monitoring with OpenTelemetry - Architecture for base14
Scout](./overview.md) first.

This guide covers the **in-cluster pattern** (OTel agent DaemonSet +
cluster collector + kube-state-metrics, plus pod-log collection via
`filelog`) - the recommended default for AKS because it captures pod,
node, and container signals natively without round-tripping through
Azure Monitor. Scout accepts telemetry from any path you choose; if you
also want AKS control-plane signals via the Diagnostic Settings → Event
Hubs route described in the [overview](./overview.md), wire it
alongside this in-cluster setup.
:::

## Why Scout for AKS observability

Microsoft recommends Managed Prometheus, Container Insights, and Managed
Grafana as the AKS observability stack
([learn.microsoft.com/azure/aks/monitor-aks](https://learn.microsoft.com/azure/aks/monitor-aks),
updated 2026-01-20). That stack works, but it ties your telemetry to Azure:
metrics land in a Log Analytics workspace, alerts route through Azure Monitor,
and dashboards live in Managed Grafana. Teams running multi-cloud environments
or planning to migrate off Azure-native observability prefer the
OpenTelemetry Collector because the same image and configuration ships to
Scout, to a self-hosted Prometheus, or to any OTLP-compatible backend without
redeploying agents. Switching backends is a config change, not an agent swap.

## Why the OpenTelemetry Operator

Three reasons to use the operator over raw Helm releases.

**Declarative lifecycle.** The operator introduces `OpenTelemetryCollector`
and `Instrumentation` CRDs. Applying a CR is all it takes to deploy,
update, or remove a collector. The operator handles ServiceAccount creation,
RBAC scoping per receiver, Service creation, and rolling updates. No
per-release Helm value files to maintain.

**Zero-code application auto-instrumentation across four languages.** The
`Instrumentation` CR pre-configures SDK init containers for Python, Node.js,
Java, and Go (eBPF). Your application pods opt in with one annotation. No
SDK imports, no source changes.

**Single upgrade surface.** One Helm chart version pins the operator release.
The operator then reconciles all CRs to the collector image version you
specify in `spec.image`. Upgrading the contrib image version across three
collectors is one field change per CR.

Prefer raw Helm releases? See the
[Azure Kubernetes Service (Helm)](aks-with-helm.md) guide.

## What you'll monitor

| Receiver | Mode | What it covers | Example metrics |
|---|---|---|---|
| `kubeletstats` | DaemonSet | Pod, container, node, and volume usage from the kubelet | `k8s.pod.cpu.usage`, `k8s.node.memory.working_set`, `container.memory.rss`, `k8s.volume.available`, `k8s.pod.cpu_limit_utilization` |
| `hostmetrics` | DaemonSet | Node OS-level telemetry | `system.cpu.time`, `system.disk.io`, `system.network.errors`, `system.processes.count`, `system.uptime` |
| `k8s_cluster` | Deployment, 1 replica | K8s API object state | `k8s.deployment.available`, `k8s.daemonset.ready_nodes`, `k8s.pod.phase`, `k8s.hpa.current_replicas`, `k8s.persistentvolumeclaim.status.phase` |
| `prometheus` scraping kube-state-metrics | Deployment, 1 replica | Detailed K8s state in Prometheus format | `kube_node_status_allocatable`, `kube_pod_container_resource_limits`, `kube_horizontalpodautoscaler_status_current_replicas`, `kube_job_status_succeeded` |
| `azure_monitor` | Deployment, 1 replica | AKS control-plane via Azure Monitor | `azure_apiserver_cpu_usage_percentage_average`, `azure_etcd_database_usage_percentage_maximum`, `azure_cluster_autoscaler_unschedulable_pods_count_total` |
| `Instrumentation` CR | Init container (per pod) | Application traces, metrics, and logs from Python, Node.js, Java, and Go pods | HTTP request spans, duration histograms, error counts |

## Prerequisites

- An AKS cluster with **OIDC issuer** and **Workload Identity** enabled
  (`oidcIssuerProfile.enabled: true`,
  `securityProfile.workloadIdentity.enabled: true`). These are off by default;
  enable via Bicep or `az aks update`.
- `kubectl` >= 1.30, `helm` >= 3.14.
- **cert-manager** installed in the cluster (the operator's webhook requires
  TLS certificates issued by cert-manager). Step 1 covers this.
- Scout OAuth2 client credentials: `SCOUT_CLIENT_ID`, `SCOUT_CLIENT_SECRET`,
  `SCOUT_TOKEN_URL`, `SCOUT_OTLP_ENDPOINT`.
- A Service Principal with `Monitoring Reader` on the resource group
  (required only for the optional control-plane Step 7 - the
  operator-managed `azure_monitor` collector). Create one with:

  ```bash
  SP_JSON="$(az ad sp create-for-rbac --name otel-aks-control-plane --skip-assignment)"
  APP_ID="$(echo "$SP_JSON" | jq -r .appId)"
  PASSWORD="$(echo "$SP_JSON" | jq -r .password)"
  TENANT="$(echo "$SP_JSON" | jq -r .tenant)"
  SP_OBJECT_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv)"
  RG=<your-resource-group>
  SUB="$(az account show --query id -o tsv)"
  az role assignment create --assignee-object-id "$SP_OBJECT_ID" \
    --assignee-principal-type ServicePrincipal --role "Monitoring Reader" \
    --scope "/subscriptions/$SUB/resourceGroups/$RG"
  ```

  Capture `APP_ID`, `PASSWORD`, `TENANT` for Step 3's `azure-sp` Secret.
  The operator's v1beta1 CRD removed `spec.podLabels`, which means the
  Workload Identity webhook cannot inject the projected token into
  operator-managed pods. Service Principal env-var auth via a Kubernetes
  Secret is the workaround for any collector that needs Azure API access.

## Step 1: Install cert-manager

The operator's admission webhook requires TLS certificates. cert-manager
issues and rotates them automatically.

```bash
CERT_MANAGER_VERSION="v1.20.2"

kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/$CERT_MANAGER_VERSION/cert-manager.yaml"

kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=300s
kubectl wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=300s
kubectl wait --for=condition=Available deployment/cert-manager-cainjector -n cert-manager --timeout=300s
```

## Step 2: Install the OpenTelemetry Operator

Chart `0.111.0` ships operator `v0.149.0`. The `manager.collectorImage` flags
pin the default contrib image so every CR you create without an explicit
`spec.image` starts at `0.151.0`.

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update open-telemetry

helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --version 0.111.0 \
  --namespace opentelemetry-operator-system \
  --create-namespace \
  --set "manager.collectorImage.repository=otel/opentelemetry-collector-contrib" \
  --set "manager.collectorImage.tag=0.151.0" \
  --wait --timeout 5m

kubectl wait --for=condition=Available \
  deployment/opentelemetry-operator \
  -n opentelemetry-operator-system --timeout=300s
```

## Step 3: Create namespace, Secrets, and ConfigMap

The `otel` namespace needs `pod-security.kubernetes.io/enforce: privileged`
because the Go eBPF sample app runs a privileged sidecar. All collectors and
sample apps land in this namespace.

```bash
kubectl create namespace otel
kubectl label namespace otel \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/warn=privileged \
  pod-security.kubernetes.io/audit=privileged

# Scout OAuth2 client credentials.
kubectl create secret generic scout-oauth2 -n otel \
  --from-literal=SCOUT_CLIENT_ID="<scout-client-id>" \
  --from-literal=SCOUT_CLIENT_SECRET="<scout-client-secret>" \
  --from-literal=SCOUT_TOKEN_URL="https://id.b14.dev/realms/<realm>/protocol/openid-connect/token" \
  --from-literal=SCOUT_OTLP_ENDPOINT="https://otel.<env>.base14.io/<tenant>/otlp"

# Cluster context injected into all three collectors.
SUB="$(az account show --query id -o tsv)"
RG=<your-resource-group>
CLUSTER=<your-cluster-name>
REGION="$(az aks show -g "$RG" -n "$CLUSTER" --query location -o tsv)"
AKS_ID="$(az aks show -g "$RG" -n "$CLUSTER" --query id -o tsv)"

kubectl create configmap otel-azure-context -n otel \
  --from-literal=AZURE_SUBSCRIPTION_ID="$SUB" \
  --from-literal=AZURE_RESOURCE_GROUP="$RG" \
  --from-literal=AZURE_REGION="$REGION" \
  --from-literal=AKS_CLUSTER_NAME="$CLUSTER" \
  --from-literal=AKS_RESOURCE_ID="$AKS_ID"

# Service Principal credentials for Step 7 (control-plane azure_monitor).
# Use the APP_ID, PASSWORD, and TENANT captured from the SP creation in Prerequisites.
kubectl create secret generic azure-sp -n otel \
  --from-literal=AZURE_TENANT_ID="<tenant-id>" \
  --from-literal=AZURE_CLIENT_ID="<sp-client-id>" \
  --from-literal=AZURE_CLIENT_SECRET="<sp-client-secret>"
```

## Step 4: Apply the agent OpenTelemetryCollector CR (DaemonSet)

The agent collector runs one pod per node. It scrapes `kubeletstats` and
`hostmetrics` from the local node, and also accepts OTLP inbound from
auto-instrumented sample apps on the same node. Traces, metrics, and logs
from those apps all route through this collector to Scout.

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: otel-agent
  namespace: otel
spec:
  mode: daemonset
  image: otel/opentelemetry-collector-contrib:0.151.0
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      memory: 512Mi
  envFrom:
    - secretRef:
        name: scout-oauth2
    - configMapRef:
        name: otel-azure-context
  env:
    - name: K8S_NODE_NAME
      valueFrom:
        fieldRef:
          fieldPath: spec.nodeName
    - name: ENVIRONMENT
      value: demo
  config:
    receivers:
      hostmetrics:
        collection_interval: 10s  # 10s suits per-node DaemonSet scale; bump to 30s on large clusters to reduce volume.
        scrapers:
          cpu: {}
          load: {}
          memory: {}
          disk: {}
          network: {}
          paging: {}
          processes: {}
          system: {}
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
      kubeletstats:
        collection_interval: 10s  # 10s suits per-node DaemonSet scale; bump to 30s on large clusters to reduce volume.
        node: ${env:K8S_NODE_NAME}
        auth_type: serviceAccount
        endpoint: https://${env:K8S_NODE_NAME}:10250
        insecure_skip_verify: true
        metric_groups: [container, pod, node, volume]
        metrics:
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
      otlp:
        protocols:
          http:
            endpoint: 0.0.0.0:4318
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      oauth2client:
        client_id: ${env:SCOUT_CLIENT_ID}
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        token_url: ${env:SCOUT_TOKEN_URL}
        endpoint_params:
          audience: b14collector
        timeout: 10s
    processors:
      batch:
        timeout: 5s
        send_batch_size: 1024
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 25
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
      debug:
        verbosity: basic
      otlp_http/b14:
        endpoint: ${env:SCOUT_OTLP_ENDPOINT}
        auth:
          authenticator: oauth2client
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
        traces:
          receivers: [otlp]
          processors: [memory_limiter, resource, batch]
          exporters: [debug, otlp_http/b14]
        metrics:
          receivers: [otlp, kubeletstats, hostmetrics]
          processors: [memory_limiter, resource, batch]
          exporters: [debug, otlp_http/b14]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, resource, batch]
          exporters: [debug, otlp_http/b14]
```

Apply it:

```bash
kubectl apply -f manifests/03-collector-agent.yaml
```

The operator auto-creates the ServiceAccount `otel-agent-collector` and its
ClusterRole, but on AKS the operator's ClusterRole does NOT include
`nodes/stats` or `nodes/proxy` access, which AKS's kubelet authn webhook
requires. Apply this supplemental RBAC before the first scrape:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-kubeletstats
rules:
  - apiGroups: [""]
    resources: ["nodes/stats", "nodes/proxy"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-agent-kubeletstats
subjects:
  - kind: ServiceAccount
    name: otel-agent-collector
    namespace: otel
roleRef:
  kind: ClusterRole
  name: otel-kubeletstats
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f manifests/rbac-kubeletstats.yaml
```

## Step 5: Install kube-state-metrics

The cluster collector's `prometheus` receiver (Step 6) scrapes
kube-state-metrics for `kube_*` metrics that `k8s_cluster` doesn't cover.
Install it once per cluster before applying the cluster CR.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community

helm upgrade --install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-state-metrics --create-namespace --wait --timeout 5m
```

## Step 6: Apply the cluster OpenTelemetryCollector CR (Deployment)

The cluster collector runs as a single-replica Deployment. It pulls
cluster-wide state via `k8s_cluster` and scrapes kube-state-metrics via a
`prometheus` receiver. kube-state-metrics must be installed first (Step 5).

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: otel-cluster
  namespace: otel
spec:
  mode: deployment
  replicas: 1
  image: otel/opentelemetry-collector-contrib:0.151.0
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 512Mi
  envFrom:
    - secretRef:
        name: scout-oauth2
    - configMapRef:
        name: otel-azure-context
  env:
    - name: ENVIRONMENT
      value: demo
  config:
    receivers:
      k8s_cluster:
        auth_type: serviceAccount
        collection_interval: 10s
        node_conditions_to_report:
          - Ready
          - MemoryPressure
          - DiskPressure
          - PIDPressure
          - NetworkUnavailable
        metrics:
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
      prometheus:
        config:
          scrape_configs:
            - job_name: kube-state-metrics
              scrape_interval: 30s
              static_configs:
                - targets:
                    - kube-state-metrics.kube-state-metrics.svc.cluster.local:8080
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      oauth2client:
        client_id: ${env:SCOUT_CLIENT_ID}
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        token_url: ${env:SCOUT_TOKEN_URL}
        endpoint_params:
          audience: b14collector
        timeout: 10s
    processors:
      batch:
        timeout: 5s
        send_batch_size: 1024
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 25
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
      debug:
        verbosity: basic
      otlp_http/b14:
        endpoint: ${env:SCOUT_OTLP_ENDPOINT}
        auth:
          authenticator: oauth2client
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
          processors: [memory_limiter, resource, batch]
          exporters: [debug, otlp_http/b14]
```

```bash
kubectl apply -f manifests/04-collector-cluster.yaml
```

## Step 7: Apply the control-plane OpenTelemetryCollector CR (Deployment)

This collector runs the `azure_monitor` receiver against the AKS resource
and emits 18 control-plane series (9 metrics at two aggregations each:
apiserver, etcd, autoscaler). It is optional. Skip it if control-plane
visibility is not a priority.

**Why Service Principal auth instead of Workload Identity Federation:** the
operator's v1beta1 CRD removed `spec.podLabels`. The Workload Identity webhook
injects the projected token only when the pod carries the label
`azure.workload.identity/use: "true"`. Without a CRD field to set it, the
webhook never fires and WIF cannot be used. The control-plane collector falls
back to Service Principal env-var auth via the `azure-sp` Secret created in
Step 3.

**Why `use_batch_api: false`:** the legacy ARM `/metrics` endpoint propagates
Monitoring Reader RBAC immediately after the role assignment. The newer
`metrics:getBatch` data-plane endpoint can lag 5-30 minutes after the grant.
Leave `use_batch_api: false` until the data plane settles, then switch to
`true` for better rate-limit headroom at fleet scale.

```yaml
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: otel-control-plane
  namespace: otel
spec:
  mode: deployment
  replicas: 1
  image: otel/opentelemetry-collector-contrib:0.151.0
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 256Mi
  envFrom:
    - secretRef:
        name: scout-oauth2
    - secretRef:
        name: azure-sp
    - configMapRef:
        name: otel-azure-context
  env:
    - name: ENVIRONMENT
      value: demo
  config:
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      azure_auth:
        service_principal:
          tenant_id: ${env:AZURE_TENANT_ID}
          client_id: ${env:AZURE_CLIENT_ID}
          client_secret: ${env:AZURE_CLIENT_SECRET}
      oauth2client:
        client_id: ${env:SCOUT_CLIENT_ID}
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        token_url: ${env:SCOUT_TOKEN_URL}
        endpoint_params:
          audience: b14collector
        timeout: 10s
    receivers:
      azure_monitor:
        subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
        resource_groups: ["${env:AZURE_RESOURCE_GROUP}"]
        services: ["Microsoft.ContainerService/managedClusters"]
        auth: {authenticator: azure_auth}
        collection_interval: 60s
        use_batch_api: false
        cache_resources: 60
        dimensions:
          enabled: true
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
      batch:
        timeout: 5s
        send_batch_size: 1024
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 25
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
    exporters:
      debug:
        verbosity: basic
      otlp_http/b14:
        endpoint: ${env:SCOUT_OTLP_ENDPOINT}
        auth:
          authenticator: oauth2client
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
```

```bash
kubectl apply -f manifests/05-collector-control-plane.yaml
```

## Step 8: Auto-instrument your applications

Apply the Instrumentation CR. It configures the init container images and
exporter endpoint for all four languages. Sample-app pods reference it via
annotation.

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: scout-instrumentation
  namespace: otel
spec:
  exporter:
    endpoint: http://$(NODE_IP):4318
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "1.0"
  resource:
    addK8sUIDAttributes: true
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:1.33.6
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:0.61b0
    env:
      - name: OTEL_PYTHON_LOG_CORRELATION
        value: "true"
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:0.73.0
  go:
    image: ghcr.io/open-telemetry/opentelemetry-go-instrumentation/autoinstrumentation-go:v0.23.0
```

```bash
kubectl apply -f manifests/06-instrumentation.yaml
```

Annotate your Deployment pods to opt in. The annotation value is
`<namespace>/<instrumentation-name>`:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="python" label="Python">

Add one annotation to your pod template. The Python SDK auto-emits metrics
and logs alongside traces; the agent collector's `metrics` and `logs`
pipelines (Step 4) handle those.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: python-fastapi
  namespace: otel
spec:
  replicas: 1
  selector:
    matchLabels: {app: python-fastapi}
  template:
    metadata:
      labels: {app: python-fastapi}
      annotations:
        instrumentation.opentelemetry.io/inject-python: "otel/scout-instrumentation"
    spec:
      containers:
        - name: app
          image: python:3.14-slim
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-agent-collector.otel.svc.cluster.local:4318"
            - name: OTEL_SERVICE_NAME
              value: python-fastapi
```

</TabItem>
<TabItem value="nodejs" label="Node.js">

Node.js auto-instrumentation requires Node.js >= 18 for the init container's
instrumentation module to load correctly.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nodejs-express
  namespace: otel
spec:
  replicas: 1
  selector: {matchLabels: {app: nodejs-express}}
  template:
    metadata:
      labels: {app: nodejs-express}
      annotations:
        instrumentation.opentelemetry.io/inject-nodejs: "otel/scout-instrumentation"
    spec:
      containers:
        - name: app
          image: node:25-alpine
          workingDir: /app
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-agent-collector.otel.svc.cluster.local:4318"
            - name: OTEL_SERVICE_NAME
              value: nodejs-express
          volumeMounts:
            - name: source
              mountPath: /src
            - name: workspace
              mountPath: /app
      volumes:
        - name: source
          configMap:
            name: nodejs-app-source
        - name: workspace
          emptyDir: {}
```

The ConfigMap source is mounted at `/src` (read-only); a writable `emptyDir`
at `/app` is where `npm install` runs. Mounting the ConfigMap directly at
`/app` is read-only and causes `npm install` to fail silently.

</TabItem>
<TabItem value="java" label="Java">

Pin your Java base image to LTS 21. The bundled javaagent `v1.33.6` throws
`InaccessibleObjectException` on Java 25's stricter module access. First
request after pod start adds approximately 30-45 seconds for JIT warm-up;
that is expected behavior, not an error.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: java-spring
  namespace: otel
spec:
  replicas: 1
  selector: {matchLabels: {app: java-spring}}
  template:
    metadata:
      labels: {app: java-spring}
      annotations:
        instrumentation.opentelemetry.io/inject-java: "otel/scout-instrumentation"
    spec:
      containers:
        - name: app
          image: maven:3.9-eclipse-temurin-21
          workingDir: /app
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-agent-collector.otel.svc.cluster.local:4318"
            - name: OTEL_SERVICE_NAME
              value: java-spring
          volumeMounts:
            - name: source
              mountPath: /src
      volumes:
        - name: source
          configMap:
            name: java-app-source
```

</TabItem>
<TabItem value="go" label="Go (eBPF)">

Go auto-instrumentation uses an eBPF sidecar injected by the operator. The
pod requires `securityContext.privileged: true` (for the sidecar to load eBPF
programs) and `hostPID: true` (for `/proc` lookups). Do NOT also set
`shareProcessNamespace: true`; K8s rejects the combination.

The binary must retain debug symbols. Do not build with
`-ldflags="-s -w"` (strips symbols) or the eBPF agent cannot find HTTP
handlers at runtime.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: go-ebpf
  namespace: otel
spec:
  replicas: 1
  selector: {matchLabels: {app: go-ebpf}}
  template:
    metadata:
      labels: {app: go-ebpf}
      annotations:
        instrumentation.opentelemetry.io/inject-go: "otel/scout-instrumentation"
        instrumentation.opentelemetry.io/otel-go-auto-target-exe: "/app/hello"
    spec:
      hostPID: true
      containers:
        - name: app
          image: golang:1.24-alpine
          workingDir: /app
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-agent-collector.otel.svc.cluster.local:4318"
            - name: OTEL_SERVICE_NAME
              value: go-ebpf
          securityContext:
            privileged: true
          volumeMounts:
            - name: source
              mountPath: /src
            - name: build
              mountPath: /app
      volumes:
        - name: source
          configMap:
            name: go-app-source
        - name: build
          emptyDir: {}
```

The namespace must carry `pod-security.kubernetes.io/enforce: privileged`
(applied in Step 3). Without it, the admission controller rejects the pod.

</TabItem>
</Tabs>

:::note .NET
The Instrumentation CR supports .NET via the CLR profiler pattern (same
annotation style as Java/Python/Node). However, compile-on-startup setups
(running `dotnet run` from a ConfigMap-mounted source directory) conflict
with the profiler at Kestrel startup. Production .NET workloads should use
pre-baked images (`dotnet publish` baked into a Dockerfile). The annotation
pattern is the same; only the application container image differs.
:::

## Verify the setup

```bash
# Check all collector pods are Running.
kubectl get pods -n otel

# Confirm the agent is scraping and exporting metrics.
kubectl port-forward -n otel daemonset/otel-agent-collector 8888 &
sleep 2
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_metric_points_total
# Expect: otelcol_exporter_sent_metric_points_total{exporter="otlp_http/b14",...} N (> 0)

# Confirm span export (from auto-instrumented apps).
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_spans_total
# Expect: otelcol_exporter_sent_spans_total{exporter="otlp_http/b14",...} N (> 0)

# Confirm log export.
curl -s localhost:8888/metrics | grep otelcol_exporter_sent_log_records_total
# Expect: otelcol_exporter_sent_log_records_total{exporter="otlp_http/b14",...} N (> 0)
```

In the validation pass, the agent emitted 67,214 metric points (kubeletstats
58,910 + hostmetrics 5,798 + app OTLP 2,506), 99 spans, and 5 log records
across all three signals with 0 drops.

## Key alerts to configure

| Alert | Source | Warning | Critical | Why |
|---|---|---|---|---|
| Pod restart spike | `k8s.container.restarts` (k8s_cluster) | rate > 1/min for 5 min | rate > 5/min for 5 min | Container crashlooping or OOM-killed. |
| Node memory utilization | `k8s.node.memory.working_set / k8s.node.memory.usage` (kubeletstats) | > 80% for 10 min | > 90% for 5 min | Node pressure, eviction risk. |
| Pod CPU throttled | `k8s.pod.cpu_limit_utilization` (kubeletstats) | > 0.8 for 10 min | > 0.95 for 5 min | Workload exceeding CPU limit, latency increases. |
| HPA stuck at max | `k8s.hpa.current_replicas / k8s.hpa.max_replicas` (k8s_cluster) | >= 1.0 for 15 min | (alert at warning) | Demand exceeds the autoscaler ceiling. |
| Volume usage | `k8s.volume.available / k8s.volume.capacity` (kubeletstats) | > 80% | > 90% | PVC nearing capacity, write failures risk. |
| PVC pending | `k8s.persistentvolumeclaim.status.phase == Pending` for 10 min | true | (alert at warning) | Storage class or provisioner issue. |
| Daemonset misscheduled | `k8s.daemonset.misscheduled_nodes` (k8s_cluster) | > 0 | > 0 for 30 min | Node-selector or taint mismatch. |
| Job failures | `kube_job_status_failed` (kube-state-metrics) | > 0 in 1 hour | > 5 in 1 hour | Scheduled work failing repeatedly. |
| Container restart by reason | `k8s.container.status.reason` (k8s_cluster) | OOMKilled count > 0 in 10 min | OOMKilled count > 3 in 5 min | OOM kills indicate undersized memory limits. |
| API server CPU (Step 7) | `azure_apiserver_cpu_usage_percentage_average` | > 60% for 10 min | > 80% for 5 min | Control plane stressed. |
| etcd database usage (Step 7) | `azure_etcd_database_usage_percentage_average` | > 60% | > 80% | etcd nearing storage limit, affects writes. |
| Autoscaler unschedulable pods (Step 7) | `azure_cluster_autoscaler_unschedulable_pods_count_total` | > 0 for 10 min | > 5 for 5 min | Autoscaler cannot schedule due to taints, quotas, or VM SKU availability. |
| HTTP 5xx rate (app spans) | spans with `http.status_code >= 500` | > 1% of requests | > 5% of requests | Application error rate rising. |
| p95 request latency (app spans) | span duration p95 | > 1s | > 3s | Latency degradation visible to users. |
| Auto-instrumentation init failures | `kubectl get events -n otel \| grep BackOff` | 3 occurrences in 10 min | (alert at warning) | Init container not pulling or crashing; pods stuck in Init. |

## Troubleshooting

### Operator pods not starting

cert-manager is not installed or its webhook is not ready. The operator's
admission webhook requires TLS certs from cert-manager. Run
`kubectl get pods -n cert-manager` and confirm all three deployments are
`Running`. If they are, wait another 30 seconds for the webhook to register
before retrying the operator install.

### Sample-app pods stuck in Init

The `Instrumentation` CR is either not applied or is in a different
namespace from the pod. The CR must be in the same namespace as the pod
(`otel` in this guide). Check with:

```bash
kubectl get instrumentation -n otel
```

### Sample-app traces not visible in Scout but pods are Ready

Check that `OTEL_EXPORTER_OTLP_ENDPOINT` points at the agent collector's
Service DNS:
`http://otel-agent-collector.otel.svc.cluster.local:4318`. The Instrumentation
CR's `spec.exporter.endpoint` uses `$(NODE_IP)` which resolves correctly only
if the pod's `NODE_IP` env var is set via the downward API. Sample app
deployments should set it explicitly and override with the Service DNS instead.

### kubeletstats receiver: 403 Forbidden on `/stats/summary`

The operator's auto-created ClusterRole does not include `nodes/stats` or
`nodes/proxy`. Apply the supplemental ClusterRole and ClusterRoleBinding from
Step 4. Once applied, the scrape recovers within one collection interval.

### Agent collector returns 404 on `/v1/metrics` or `/v1/logs`

The agent CR's OTLP receiver is not wired into the `metrics` or `logs`
pipelines. Auto-instrumented apps that emit metrics (Python, especially) or
logs alongside traces will get 404 on those endpoints. Add `otlp` to the
`receivers` list in each pipeline (Step 4's YAML already includes this).

### Go eBPF pod fails admission

K8s rejects when both `hostPID: true` and `shareProcessNamespace: true` are
set: `"ShareProcessNamespace and HostPID cannot both be enabled"`. Use
`hostPID: true` only. Also confirm the `otel` namespace carries
`pod-security.kubernetes.io/enforce: privileged` from Step 3.

### Java JIT slowness on first request

Spring Boot plus javaagent adds approximately 30-45 seconds of JIT warm-up
latency on the first request after pod start. This is not an error. Allow
the pod time to warm up before running load tests.

### Java 25 InaccessibleObjectException

The bundled javaagent `v1.33.6` has not yet caught up to Java 25's stricter
module access policy. Pin the Java container image to LTS 21 (`eclipse-temurin-21`
or `maven:3.9-eclipse-temurin-21`).

### Step 7 control-plane returns 401 on `metrics:getBatch`

The data-plane RBAC for `metrics:getBatch` at
`*.metrics.monitor.azure.com` propagates 5-30 minutes after the Monitoring
Reader grant, independently of the legacy ARM `/metrics` endpoint. Keep
`use_batch_api: false` until the RBAC has fully propagated, then switch to
`true`.

### `spec.podLabels` workaround

The operator's v1beta1 CRD removed `spec.podLabels`. Workload Identity
Federation requires the pod label `azure.workload.identity/use: "true"`, which
the WI webhook injects only when that label is present. Without `spec.podLabels`,
the webhook never fires. For any collector that needs Azure API access (the
control-plane collector in Step 7), use Service Principal env-var auth via
the `azure-sp` Secret. The agent and cluster collectors do not talk to Azure
and are unaffected.

## Frequently Asked Questions

### How do I monitor an AKS cluster with the OpenTelemetry Operator?

Install cert-manager, then deploy the `opentelemetry-operator` Helm chart.
Create `OpenTelemetryCollector` CRs for a DaemonSet (kubeletstats +
hostmetrics), a cluster Deployment (k8s_cluster + prometheus scraping
kube-state-metrics), and optionally a control-plane Deployment
(azure_monitor). Apply an `Instrumentation` CR and annotate your pods to
enable zero-code auto-instrumentation for Python, Node.js, Java, and Go.

### How does the operator-managed collector authenticate to base14 Scout?

Via the `oauth2client` extension. Store the Scout-issued `client_id` and
`client_secret` in a Kubernetes Secret named `scout-oauth2` in the `otel`
namespace, reference them in the `OpenTelemetryCollector` CR's `envFrom`,
and the `otlp_http/b14` exporter fetches short-lived bearer tokens
automatically (cached until expiry).

### Why three OpenTelemetryCollector CRs instead of one?

Each CR maps to a specific Pod controller and receiver family. `kubeletstats`
needs a DaemonSet (one pod per node). `k8s_cluster` needs a single-replica
Deployment (it would emit duplicates if scaled horizontally). `azure_monitor`
is a lightweight control-plane scraper that runs as a separate Deployment so
you can scope its Service Principal credentials independently. Merging them
would force compromises on controller type or RBAC scope.

### How does this differ from Microsoft's Managed Prometheus and Container Insights?

Managed Prometheus and Container Insights are Azure-tenant-bound, billed
per-GB ingested, and visualized in Managed Grafana or Log Analytics. The
OpenTelemetry Collector is vendor-neutral. The same CRs and image ship to
base14 Scout or any OTLP-compatible backend without redeployment. Multi-cloud
and hybrid teams prefer this pattern because backend switches are config
changes, not agent re-deployments.

### What languages support auto-instrumentation here, and which are not yet validated?

Validated in this guide: Python (FastAPI), Node.js (Express), Java (Spring
Boot 3 on LTS 21), and Go (eBPF, net/http). .NET is supported by the
operator's Instrumentation CR pattern but the ConfigMap-mounted
`dotnet run` on-startup shape conflicts with the CLR profiler. Use
pre-baked images (`dotnet publish`) for production .NET workloads.

### How do I add control-plane metrics like API server uptime?

Apply the `otel-control-plane` CR from Step 7. It runs the `azure_monitor`
receiver against the AKS resource, authenticated via Service Principal
env-var auth. You get 18 control-plane series (9 metrics at two aggregations
each - apiserver, etcd, autoscaler) on a vanilla cluster. If cluster
autoscaling is not enabled on any node pool, the four
`azure_cluster_autoscaler_*` metrics return 401 (no backing data source) -
remove them from the receiver's metric whitelist. If autoscaling is enabled
but the pool is pinned (e.g. `minCount = maxCount = 1`), the metrics emit
with zero/idle values; that is expected and indicates the autoscaler is
healthy but inactive. Most workloads need only Steps 1-6 for pod, container,
and cluster-state visibility.

## Related Guides

- [Azure Kubernetes Service (Helm)](aks-with-helm.md) - alternative pattern
  using raw Helm releases, no operator required.
- [OpenTelemetry Operator setup][otel-operator-setup] - generic operator
  install and concepts.
- [OpenTelemetry Operator GitHub][otel-operator-repo] - CRD reference and
  release notes.
- [cert-manager](https://cert-manager.io/) - required dependency for the
  operator's admission webhook.

[otel-operator-setup]: ../../collector-setup/opentelemetry-operator-setup.md
[otel-operator-repo]: https://github.com/open-telemetry/opentelemetry-operator
