---
title: OpenTelemetry Operator for Kubernetes
sidebar_label: OpenTelemetry Operator
description:
  Deploy and manage OpenTelemetry Collectors using the OpenTelemetry Operator on
  Kubernetes. Enable automatic instrumentation for Java, Python, Node.js, .NET,
  and Go applications with base14 Scout integration.
keywords:
  [
    opentelemetry operator,
    kubernetes operator,
    auto-instrumentation,
    otel operator,
    kubernetes observability,
    automatic instrumentation,
    sdk injection,
  ]
tags: [kubernetes, opentelemetry, base14 scout, auto-instrumentation]
sidebar_position: 3
---

# OpenTelemetry Operator for Kubernetes

Deploy and manage OpenTelemetry Collectors and enable automatic instrumentation
for your applications using the OpenTelemetry Operator.

:::tip Recommended
This is the recommended approach for deploying OpenTelemetry Collectors on
Kubernetes with Scout.
:::

## Overview

The OpenTelemetry Operator is a Kubernetes Operator that manages:

1. **OpenTelemetry Collector** - Lifecycle management of collector deployments
2. **Auto-instrumentation** - Automatic SDK injection for applications without
   code changes

This guide covers how to:

- Install the OpenTelemetry Operator on Kubernetes
- Deploy an OpenTelemetry Collector using Custom Resources
- Configure the collector to send telemetry to Scout backend
- Enable automatic instrumentation for your applications
- Use different deployment modes (Deployment, DaemonSet, Sidecar)

## Prerequisites

Before installing the OpenTelemetry Operator, ensure you have:

- A Kubernetes cluster (v1.24+)
- `kubectl` configured with cluster access
- Helm 3.9+ installed
- Scout account credentials:
  - Endpoint URL
  - Client ID
  - Client Secret
  - Token URL

## Installation

### Step 1: Install cert-manager

The OpenTelemetry Operator requires cert-manager for webhook certificates.

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

Wait for cert-manager to be ready:

```bash
kubectl wait --for=condition=Available deployment/cert-manager -n cert-manager --timeout=300s
kubectl wait --for=condition=Available deployment/cert-manager-webhook -n cert-manager --timeout=300s
```

### Step 2: Install the OpenTelemetry Operator

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="helm" label="Helm (Recommended)">
```

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update
```

```bash
helm install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry-operator-system \
  --create-namespace \
  --set "manager.collectorImage.repository=otel/opentelemetry-collector-contrib"
```

```mdx-code-block
</TabItem>
<TabItem value="manifest" label="Manifest">
```

```bash
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml
```

```mdx-code-block
</TabItem>
</Tabs>
```

Verify the operator is running:

```bash
kubectl get pods -n opentelemetry-operator-system
```

Expected output:

```text
NAME                                      READY   STATUS    RESTARTS   AGE
opentelemetry-operator-controller-xxx     2/2     Running   0          1m
```

## Deploying an OpenTelemetry Collector

Create `OpenTelemetryCollector` Custom Resources to deploy collectors that
send telemetry to Scout backend.

### Create the Credentials Secret

First, create the namespace and credentials secret:

```bash
kubectl create namespace observability

kubectl create secret generic scout-credentials \
  --namespace observability \
  --from-literal=endpoint="https://otel.play.b14.dev/__YOUR_TENANT__/otlp" \
  --from-literal=client-id="__YOUR_CLIENT_ID__" \
  --from-literal=client-secret="__YOUR_CLIENT_SECRET__" \
  --from-literal=token-url="https://id.b14.dev/realms/__YOUR_TENANT__/protocol/openid-connect/token"
```

### Collector Configuration

```mdx-code-block
<Tabs>
<TabItem value="fargate" label="Fargate">
```

For Fargate deployments, use a single collector in Deployment mode:

```yaml showLineNumbers title="scout-collector.yaml"
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: scout-collector
  namespace: observability
spec:
  mode: deployment
  replicas: 1
  image: otel/opentelemetry-collector-contrib:0.127.0
  serviceAccount: otel-collector-sa
  config:
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      zpages:
        endpoint: 0.0.0.0:55679
      oauth2client:
        client_id: ${env:SCOUT_CLIENT_ID}
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        endpoint_params:
          audience: b14collector
        token_url: ${env:SCOUT_TOKEN_URL}
        tls:
          insecure_skip_verify: true

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

      k8s_cluster:
        auth_type: serviceAccount
        collection_interval: 60s
        node_conditions_to_report:
          - Ready
          - MemoryPressure
          - DiskPressure
          - PIDPressure
          - NetworkUnavailable
        resource_attributes:
          k8s.container.status.last_terminated_reason:
            enabled: true
        metrics:
          k8s.pod.status_reason:
            enabled: true
          k8s.node.condition:
            enabled: true
        allocatable_types_to_report:
          - cpu
          - memory
          - ephemeral-storage
          - storage

      k8sobjects:
        objects:
          - name: events
            mode: pull
            interval: 60s
            group: events.k8s.io
          - name: deployments
            mode: pull
            interval: 60s
            group: apps
          - name: resourcequotas
            mode: pull
            interval: 60s

    processors:
      batch:
        timeout: 2s
        send_batch_size: 8192
        send_batch_max_size: 10000
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 30
      resource:
        attributes:
          - key: service.name
            value: ${env:APP_NAME}
            action: upsert
      resource/k8s:
        attributes:
          - key: service.name
            value: k8s
            action: upsert
      resource/k8s-events:
        attributes:
          - key: service.name
            value: k8s-events
            action: upsert
      resource/env:
        attributes:
          - key: environment
            value: ${env:ENVIRONMENT}
            action: upsert
          - key: k8s.cluster.name
            value: ${env:CLUSTER_NAME}
            action: upsert
      resourcedetection/eks:
        detectors: [env, eks]
        override: true
        eks:
          resource_attributes:
            k8s.cluster.name:
              enabled: true
      k8sattributes:
        auth_type: serviceAccount
        extract:
          metadata:
            - k8s.namespace.name
            - k8s.pod.name
            - k8s.pod.hostname
            - k8s.pod.ip
            - k8s.pod.start_time
            - k8s.pod.uid
            - k8s.replicaset.uid
            - k8s.replicaset.name
            - k8s.deployment.uid
            - k8s.deployment.name
            - k8s.daemonset.uid
            - k8s.daemonset.name
            - k8s.statefulset.uid
            - k8s.statefulset.name
            - k8s.cronjob.name
            - k8s.job.uid
            - k8s.job.name
            - k8s.node.name
            - k8s.cluster.uid
            - container.image.name
            - container.image.tag
            - container.id
          annotations:
            - tag_name: service.name
              key: resource.opentelemetry.io/service.name
              from: pod
            - tag_name: service.namespace
              key: resource.opentelemetry.io/service.namespace
              from: pod
            - tag_name: service.version
              key: resource.opentelemetry.io/service.version
              from: pod
            - tag_name: service.instance.id
              key: resource.opentelemetry.io/service.instance.id
              from: pod
          labels:
            - tag_name: kube_app_name
              key: app.kubernetes.io/name
              from: pod
            - tag_name: kube_app_instance
              key: app.kubernetes.io/instance
              from: pod
            - tag_name: kube_app_version
              key: app.kubernetes.io/version
              from: pod
            - tag_name: kube_app_component
              key: app.kubernetes.io/component
              from: pod
            - tag_name: kube_app_part_of
              key: app.kubernetes.io/part-of
              from: pod
            - tag_name: kube_app_managed_by
              key: app.kubernetes.io/managed-by
              from: pod
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
          - sources:
              - from: resource_attribute
                name: k8s.pod.uid
          - sources:
              - from: connection

    exporters:
      otlphttp/b14:
        endpoint: ${env:SCOUT_ENDPOINT}
        auth:
          authenticator: oauth2client
        tls:
          insecure_skip_verify: true
        retry_on_failure:
          enabled: true
          initial_interval: 2s
          max_interval: 10s
          max_elapsed_time: 60s

    service:
      extensions: [health_check, zpages, oauth2client]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch]
          exporters: [otlphttp/b14]
        logs:
          receivers: [otlp]
          processors: [batch]
          exporters: [otlphttp/b14]
        logs/k8s-events:
          receivers: [k8sobjects]
          processors:
            - memory_limiter
            - batch
            - resource/k8s-events
            - resourcedetection/eks
            - resource/env
          exporters: [otlphttp/b14]
        logs/k8s-cluster:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - batch
            - resource/k8s
            - resourcedetection/eks
            - resource/env
          exporters: [otlphttp/b14]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch, resource/env]
          exporters: [otlphttp/b14]
        metrics/k8s:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - batch
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
          exporters: [otlphttp/b14]
      telemetry:
        logs:
          level: warn
          encoding: json

  env:
    - name: SCOUT_ENDPOINT
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: endpoint
    - name: SCOUT_CLIENT_ID
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: client-id
    - name: SCOUT_CLIENT_SECRET
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: client-secret
    - name: SCOUT_TOKEN_URL
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: token-url
    - name: CLUSTER_NAME
      value: "<cluster-name>"
    - name: ENVIRONMENT
      value: "<environment>"
    - name: APP_NAME
      value: "<app-name>"
```

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

For Managed Nodes, use two collectors: a DaemonSet for node-level collection
and a Deployment for cluster-level collection.

#### Daemon Collector (DaemonSet)

```yaml showLineNumbers title="scout-daemon-collector.yaml"
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: scout-daemon
  namespace: observability
spec:
  mode: daemonset
  image: otel/opentelemetry-collector-contrib:0.127.0
  serviceAccount: otel-collector-sa
  config:
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      zpages:
        endpoint: 0.0.0.0:55679

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

      kubeletstats:
        collection_interval: 60s
        endpoint: https://${env:K8S_NODE_NAME}:10250
        insecure_skip_verify: true
        auth_type: serviceAccount
        metric_groups:
          - node
          - pod
          - volume
          - container
        extra_metadata_labels:
          - container.id

      filelog:
        include:
          - /var/log/pods/*/*/*.log
        start_at: end
        include_file_path: true
        include_file_name: false
        operators:
          - type: container
            id: container-parser

    processors:
      batch:
        timeout: 2s
        send_batch_size: 8192
        send_batch_max_size: 10000
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 30
      resource:
        attributes:
          - key: service.name
            value: ${env:APP_NAME}
            action: upsert
      resource/k8s:
        attributes:
          - key: service.name
            value: k8s
            action: upsert
      resource/env:
        attributes:
          - key: environment
            value: ${env:ENVIRONMENT}
            action: upsert
          - key: k8s.cluster.name
            value: ${env:CLUSTER_NAME}
            action: upsert
      resourcedetection/eks:
        detectors: [env, eks]
        override: true
        eks:
          resource_attributes:
            k8s.cluster.name:
              enabled: true
      k8sattributes:
        auth_type: serviceAccount
        extract:
          metadata:
            - k8s.namespace.name
            - k8s.pod.name
            - k8s.pod.hostname
            - k8s.pod.ip
            - k8s.pod.start_time
            - k8s.pod.uid
            - k8s.replicaset.uid
            - k8s.replicaset.name
            - k8s.deployment.uid
            - k8s.deployment.name
            - k8s.daemonset.uid
            - k8s.daemonset.name
            - k8s.statefulset.uid
            - k8s.statefulset.name
            - k8s.cronjob.name
            - k8s.job.uid
            - k8s.job.name
            - k8s.node.name
            - k8s.cluster.uid
            - container.image.name
            - container.image.tag
            - container.id
          annotations:
            - tag_name: service.name
              key: resource.opentelemetry.io/service.name
              from: pod
            - tag_name: service.namespace
              key: resource.opentelemetry.io/service.namespace
              from: pod
            - tag_name: service.version
              key: resource.opentelemetry.io/service.version
              from: pod
            - tag_name: service.instance.id
              key: resource.opentelemetry.io/service.instance.id
              from: pod
          labels:
            - tag_name: kube_app_name
              key: app.kubernetes.io/name
              from: pod
            - tag_name: kube_app_instance
              key: app.kubernetes.io/instance
              from: pod
            - tag_name: kube_app_version
              key: app.kubernetes.io/version
              from: pod
            - tag_name: kube_app_component
              key: app.kubernetes.io/component
              from: pod
            - tag_name: kube_app_part_of
              key: app.kubernetes.io/part-of
              from: pod
            - tag_name: kube_app_managed_by
              key: app.kubernetes.io/managed-by
              from: pod
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
          - sources:
              - from: resource_attribute
                name: k8s.pod.uid
          - sources:
              - from: connection

    exporters:
      otlp/agent:
        endpoint: scout-agent-collector.observability.svc.cluster.local:4317
        tls:
          insecure: true

    service:
      extensions: [zpages, health_check]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch, resource, resource/env]
          exporters: [otlp/agent]
        logs:
          receivers: [otlp, filelog]
          processors: [batch, resource/env]
          exporters: [otlp/agent]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch, resource/env]
          exporters: [otlp/agent]
        metrics/k8s:
          receivers: [kubeletstats]
          processors:
            - memory_limiter
            - batch
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
          exporters: [otlp/agent]
      telemetry:
        logs:
          level: warn
          encoding: json

  env:
    - name: K8S_NODE_NAME
      valueFrom:
        fieldRef:
          fieldPath: spec.nodeName
    - name: CLUSTER_NAME
      value: "<cluster-name>"
    - name: ENVIRONMENT
      value: "<environment>"
    - name: APP_NAME
      value: "<app-name>"

  volumeMounts:
    - name: varlogpods
      mountPath: /var/log/pods
      readOnly: true

  volumes:
    - name: varlogpods
      hostPath:
        path: /var/log/pods
```

#### Agent Collector (Deployment)

```yaml showLineNumbers title="scout-agent-collector.yaml"
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: scout-agent
  namespace: observability
spec:
  mode: deployment
  replicas: 1
  image: otel/opentelemetry-collector-contrib:0.127.0
  serviceAccount: otel-collector-sa
  config:
    extensions:
      health_check:
        endpoint: 0.0.0.0:13133
      zpages:
        endpoint: 0.0.0.0:55679
      oauth2client:
        client_id: ${env:SCOUT_CLIENT_ID}
        client_secret: ${env:SCOUT_CLIENT_SECRET}
        endpoint_params:
          audience: b14collector
        token_url: ${env:SCOUT_TOKEN_URL}
        tls:
          insecure_skip_verify: true

    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

      k8s_cluster:
        auth_type: serviceAccount
        collection_interval: 60s
        node_conditions_to_report:
          - Ready
          - MemoryPressure
          - DiskPressure
          - PIDPressure
          - NetworkUnavailable
        resource_attributes:
          k8s.container.status.last_terminated_reason:
            enabled: true
        metrics:
          k8s.pod.status_reason:
            enabled: true
          k8s.node.condition:
            enabled: true
        allocatable_types_to_report:
          - cpu
          - memory
          - ephemeral-storage
          - storage

      k8sobjects:
        objects:
          - name: events
            mode: pull
            interval: 60s
            group: events.k8s.io
          - name: deployments
            mode: pull
            interval: 60s
            group: apps
          - name: resourcequotas
            mode: pull
            interval: 60s

    processors:
      batch:
        timeout: 2s
        send_batch_size: 8192
        send_batch_max_size: 10000
      memory_limiter:
        check_interval: 5s
        limit_percentage: 80
        spike_limit_percentage: 30
      resource:
        attributes:
          - key: service.name
            value: ${env:APP_NAME}
            action: upsert
      resource/k8s:
        attributes:
          - key: service.name
            value: k8s
            action: upsert
      resource/k8s-events:
        attributes:
          - key: service.name
            value: k8s-events
            action: upsert
      resource/env:
        attributes:
          - key: environment
            value: ${env:ENVIRONMENT}
            action: upsert
          - key: k8s.cluster.name
            value: ${env:CLUSTER_NAME}
            action: upsert
      resourcedetection/eks:
        detectors: [env, eks]
        override: true
        eks:
          resource_attributes:
            k8s.cluster.name:
              enabled: true
      k8sattributes:
        auth_type: serviceAccount
        extract:
          metadata:
            - k8s.namespace.name
            - k8s.pod.name
            - k8s.pod.hostname
            - k8s.pod.ip
            - k8s.pod.start_time
            - k8s.pod.uid
            - k8s.replicaset.uid
            - k8s.replicaset.name
            - k8s.deployment.uid
            - k8s.deployment.name
            - k8s.daemonset.uid
            - k8s.daemonset.name
            - k8s.statefulset.uid
            - k8s.statefulset.name
            - k8s.cronjob.name
            - k8s.job.uid
            - k8s.job.name
            - k8s.node.name
            - k8s.cluster.uid
            - container.image.name
            - container.image.tag
            - container.id
          annotations:
            - tag_name: service.name
              key: resource.opentelemetry.io/service.name
              from: pod
            - tag_name: service.namespace
              key: resource.opentelemetry.io/service.namespace
              from: pod
            - tag_name: service.version
              key: resource.opentelemetry.io/service.version
              from: pod
            - tag_name: service.instance.id
              key: resource.opentelemetry.io/service.instance.id
              from: pod
          labels:
            - tag_name: kube_app_name
              key: app.kubernetes.io/name
              from: pod
            - tag_name: kube_app_instance
              key: app.kubernetes.io/instance
              from: pod
            - tag_name: kube_app_version
              key: app.kubernetes.io/version
              from: pod
            - tag_name: kube_app_component
              key: app.kubernetes.io/component
              from: pod
            - tag_name: kube_app_part_of
              key: app.kubernetes.io/part-of
              from: pod
            - tag_name: kube_app_managed_by
              key: app.kubernetes.io/managed-by
              from: pod
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
          - sources:
              - from: resource_attribute
                name: k8s.pod.uid
          - sources:
              - from: connection

    exporters:
      otlphttp/b14:
        endpoint: ${env:SCOUT_ENDPOINT}
        auth:
          authenticator: oauth2client
        tls:
          insecure_skip_verify: true
        retry_on_failure:
          enabled: true
          initial_interval: 2s
          max_interval: 10s
          max_elapsed_time: 60s

    service:
      extensions: [oauth2client, zpages, health_check]
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch, resource, resource/env]
          exporters: [otlphttp/b14]
        logs:
          receivers: [otlp]
          processors: [batch, resource/env]
          exporters: [otlphttp/b14]
        logs/k8s-events:
          receivers: [k8sobjects]
          processors:
            - memory_limiter
            - batch
            - resource/k8s-events
            - resourcedetection/eks
            - resource/env
          exporters: [otlphttp/b14]
        logs/k8s-cluster:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - batch
            - resource/k8s
            - resourcedetection/eks
            - resource/env
          exporters: [otlphttp/b14]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch, resource/env]
          exporters: [otlphttp/b14]
        metrics/k8s:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - batch
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
          exporters: [otlphttp/b14]
      telemetry:
        logs:
          level: warn
          encoding: json

  env:
    - name: SCOUT_ENDPOINT
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: endpoint
    - name: SCOUT_CLIENT_ID
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: client-id
    - name: SCOUT_CLIENT_SECRET
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: client-secret
    - name: SCOUT_TOKEN_URL
      valueFrom:
        secretKeyRef:
          name: scout-credentials
          key: token-url
    - name: CLUSTER_NAME
      value: "<cluster-name>"
    - name: ENVIRONMENT
      value: "<environment>"
    - name: APP_NAME
      value: "<app-name>"
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Required RBAC

Create the ServiceAccount and RBAC permissions:

```yaml showLineNumbers title="rbac.yaml"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: otel-collector-sa
  namespace: observability
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: otel-collector-role
rules:
  - apiGroups: [""]
    resources:
      - pods
      - namespaces
      - nodes
      - nodes/stats
      - nodes/proxy
      - services
      - endpoints
      - resourcequotas
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources:
      - replicasets
      - deployments
      - daemonsets
      - statefulsets
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources:
      - jobs
      - cronjobs
    verbs: ["get", "list", "watch"]
  - apiGroups: ["events.k8s.io"]
    resources:
      - events
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: otel-collector-binding
subjects:
  - kind: ServiceAccount
    name: otel-collector-sa
    namespace: observability
roleRef:
  kind: ClusterRole
  name: otel-collector-role
  apiGroup: rbac.authorization.k8s.io
```

### Deploy the Collectors

```bash
# Apply RBAC
kubectl apply -f rbac.yaml

# For Fargate
kubectl apply -f scout-collector.yaml

# For Managed Nodes
kubectl apply -f scout-daemon-collector.yaml
kubectl apply -f scout-agent-collector.yaml
```

Verify the collectors are running:

```bash
kubectl get pods -n observability -l app.kubernetes.io/component=opentelemetry-collector
```

## Automatic Instrumentation

The OpenTelemetry Operator can automatically inject instrumentation into your
applications without code changes.

### Supported Languages

| Language | Annotation | Protocol |
|----------|------------|----------|
| Java | `instrumentation.opentelemetry.io/inject-java: "true"` | OTLP HTTP (4318) |
| Python | `instrumentation.opentelemetry.io/inject-python: "true"` | OTLP HTTP (4318) |
| Node.js | `instrumentation.opentelemetry.io/inject-nodejs: "true"` | OTLP gRPC (4317) |
| .NET | `instrumentation.opentelemetry.io/inject-dotnet: "true"` | OTLP HTTP (4318) |
| Go | `instrumentation.opentelemetry.io/inject-go: "true"` | eBPF (requires elevated permissions) |

### Step 1: Create an Instrumentation Resource

Create a file named `instrumentation.yaml`:

```yaml showLineNumbers title="instrumentation.yaml"
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: scout-instrumentation
  namespace: observability
spec:
  exporter:
    endpoint: http://scout-collector-collector.observability.svc.cluster.local:4317
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "1.0"

  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
    env:
      - name: OTEL_INSTRUMENTATION_JDBC_ENABLED
        value: "true"
      - name: OTEL_INSTRUMENTATION_SPRING_WEBMVC_ENABLED
        value: "true"

  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
    env:
      - name: OTEL_PYTHON_LOG_CORRELATION
        value: "true"

  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest

  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:latest

  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:latest
```

Deploy the Instrumentation resource:

```bash
kubectl apply -f instrumentation.yaml
```

:::warning Important
The Instrumentation resource must be deployed **before** your application pods.
If your application is already running, restart it after creating the
Instrumentation resource.
:::

### Step 2: Annotate Your Application

Add the appropriate annotation to your Deployment, StatefulSet, or Pod:

```mdx-code-block
<Tabs>
<TabItem value="java" label="Java">
```

```yaml showLineNumbers title="java-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-java-app
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-java-app
  template:
    metadata:
      labels:
        app: my-java-app
      annotations:
        instrumentation.opentelemetry.io/inject-java: "true"
    spec:
      containers:
        - name: app
          image: my-java-app:latest
          ports:
            - containerPort: 8080
```

```mdx-code-block
</TabItem>
<TabItem value="python" label="Python">
```

```yaml showLineNumbers title="python-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-python-app
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-python-app
  template:
    metadata:
      labels:
        app: my-python-app
      annotations:
        instrumentation.opentelemetry.io/inject-python: "true"
    spec:
      containers:
        - name: app
          image: my-python-app:latest
          ports:
            - containerPort: 8000
```

```mdx-code-block
</TabItem>
<TabItem value="nodejs" label="Node.js">
```

```yaml showLineNumbers title="nodejs-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-nodejs-app
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-nodejs-app
  template:
    metadata:
      labels:
        app: my-nodejs-app
      annotations:
        instrumentation.opentelemetry.io/inject-nodejs: "true"
    spec:
      containers:
        - name: app
          image: my-nodejs-app:latest
          ports:
            - containerPort: 3000
```

```mdx-code-block
</TabItem>
<TabItem value="dotnet" label=".NET">
```

```yaml showLineNumbers title="dotnet-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-dotnet-app
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-dotnet-app
  template:
    metadata:
      labels:
        app: my-dotnet-app
      annotations:
        instrumentation.opentelemetry.io/inject-dotnet: "true"
    spec:
      containers:
        - name: app
          image: my-dotnet-app:latest
          ports:
            - containerPort: 5000
```

```mdx-code-block
</TabItem>
</Tabs>
```

### Step 3: Verify Instrumentation

After deploying your application, verify the instrumentation is working:

```bash
# Check that init container was injected
kubectl get pod -n observability -l app=my-java-app -o jsonpath='{.items[0].spec.initContainers[*].name}'
```

Expected output includes `opentelemetry-auto-instrumentation`.

Check the environment variables:

```bash
kubectl exec -n observability deployment/my-java-app -- env | grep OTEL
```

## Advanced Configuration

### Multi-Container Pod Instrumentation

To instrument specific containers in a multi-container pod:

```yaml showLineNumbers
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-java: "true"
    instrumentation.opentelemetry.io/container-names: "app-container"
```

### Namespace-Scoped Instrumentation

Apply instrumentation to all pods in a namespace:

```yaml showLineNumbers
apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
  annotations:
    instrumentation.opentelemetry.io/inject-java: "scout-instrumentation"
```

## Troubleshooting

### Common Issues

#### Operator Not Starting

Check operator logs:

```bash
kubectl logs -n opentelemetry-operator-system deployment/opentelemetry-operator-controller-manager
```

Common causes:

- cert-manager not installed or not ready
- Insufficient RBAC permissions

#### Collector Not Receiving Data

1. Verify the collector is running:

   ```bash
   kubectl get pods -n observability -l app.kubernetes.io/component=opentelemetry-collector
   ```

2. Check collector logs:

   ```bash
   kubectl logs -n observability -l app.kubernetes.io/name=scout-collector-collector
   ```

3. Verify the service is accessible:

   ```bash
   kubectl get svc -n observability
   ```

#### Auto-Instrumentation Not Working

1. Ensure the Instrumentation resource exists in the same namespace:

   ```bash
   kubectl get instrumentation -n observability
   ```

2. Check that the pod was restarted after annotation:

   ```bash
   kubectl rollout restart deployment/my-app -n observability
   ```

3. Verify init container injection:

   ```bash
   kubectl describe pod -n observability -l app=my-app | grep -A5 "Init Containers"
   ```

#### Authentication Errors

Check that the Scout credentials secret exists and has correct values:

```bash
kubectl get secret scout-credentials -n observability -o yaml
```

Verify the OAuth2 token URL is correct and accessible from the cluster.

## Related Guides

- [Scout Exporter Configuration](./scout-exporter.md) - Configure authentication
  to send data to Scout
- [Kubernetes Helm Setup](./kubernetes-helm-setup.md) - Alternative Helm-based
  deployment
- [Advanced Collector Configuration](./otel-collector-config.md) - Full
  collector configuration reference
- [Spring Boot Instrumentation](../apps/auto-instrumentation/spring-boot.md) -
  Java application instrumentation
- [FastAPI Instrumentation](../apps/auto-instrumentation/fast-api.md) - Python
  application instrumentation

## Learn More

- [OpenTelemetry Operator Documentation](https://opentelemetry.io/docs/platforms/kubernetes/operator/)
- [OpenTelemetry Operator GitHub](https://github.com/open-telemetry/opentelemetry-operator)
- [Auto-Instrumentation Guide](https://opentelemetry.io/docs/platforms/kubernetes/operator/automatic/)
