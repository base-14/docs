---
title: OpenTelemetry Operator for Kubernetes - Auto-Instrumentation & Collector Setup
sidebar_label: OpenTelemetry Operator
description:
  Deploy OpenTelemetry Collectors with the OpenTelemetry Operator on
  Kubernetes and auto-instrument Java, Python, Node.js, .NET, and Go apps.
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
  image: otel/opentelemetry-collector-contrib:0.130.1
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

      # Extract severity from log bodies; anything left unmatched defaults to
      # INFO. All rules are guarded by severity_text == "" so logs that already
      # carry severity pass through untouched.
      transform/severity:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              # k8s events (body is a map from the k8sobjects receiver)
              - set(severity_text, "WARN") where severity_text == "" and IsMap(body) and body["type"] == "Warning"
              - set(severity_text, "INFO") where severity_text == "" and IsMap(body) and body["type"] == "Normal"
              # structured JSON string bodies (direct OTLP logs)
              - set(cache, ParseJSON(body)) where severity_text == "" and IsString(body) and IsMatch(body, "^\\s*\\{")
              - set(severity_text, ConvertCase(cache["level"], "upper")) where severity_text == "" and IsString(cache["level"])
              - set(severity_text, ConvertCase(cache["severity"], "upper")) where severity_text == "" and IsString(cache["severity"])
              - set(severity_text, "TRACE") where severity_text == "" and cache["level"] == 10
              - set(severity_text, "DEBUG") where severity_text == "" and cache["level"] == 20
              - set(severity_text, "INFO") where severity_text == "" and cache["level"] == 30
              - set(severity_text, "WARN") where severity_text == "" and cache["level"] == 40
              - set(severity_text, "ERROR") where severity_text == "" and cache["level"] == 50
              - set(severity_text, "FATAL") where severity_text == "" and cache["level"] == 60
              # normalize synonyms
              - set(severity_text, "WARN") where severity_text == "WARNING"
              - set(severity_text, "ERROR") where severity_text == "ERR"
              - set(severity_text, "FATAL") where severity_text == "CRITICAL" or severity_text == "PANIC"
              # default: everything still unlabelled is INFO
              - set(severity_text, "INFO") where severity_text == ""
              # severity_text -> severity_number (only if not already set upstream)
              - set(severity_number, SEVERITY_NUMBER_TRACE) where severity_number == 0 and severity_text == "TRACE"
              - set(severity_number, SEVERITY_NUMBER_DEBUG) where severity_number == 0 and severity_text == "DEBUG"
              - set(severity_number, SEVERITY_NUMBER_INFO) where severity_number == 0 and severity_text == "INFO"
              - set(severity_number, SEVERITY_NUMBER_WARN) where severity_number == 0 and severity_text == "WARN"
              - set(severity_number, SEVERITY_NUMBER_ERROR) where severity_number == 0 and severity_text == "ERROR"
              - set(severity_number, SEVERITY_NUMBER_FATAL) where severity_number == 0 and severity_text == "FATAL"

      # k8s events: promote reason/object fields to attributes for faceting in
      # the logs UI, and replace the raw event JSON body with the
      # human-readable message. Must run AFTER transform/severity (severity
      # reads body["type"] before the body is replaced).
      transform/k8s-events:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              - set(attributes["event.type"], body["type"]) where IsMap(body) and body["type"] != nil
              - set(attributes["event.reason"], body["reason"]) where IsMap(body) and body["reason"] != nil
              - set(attributes["k8s.object.kind"], body["regarding"]["kind"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["k8s.object.name"], body["regarding"]["name"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["k8s.namespace.name"], body["regarding"]["namespace"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["event.count"], body["deprecatedCount"]) where IsMap(body) and body["deprecatedCount"] != nil
              - set(body, body["note"]) where IsMap(body) and body["note"] != nil

      transform/service_name_fallback:
        error_mode: ignore
        trace_statements:
          - context: span
            statements:
              - set(resource.attributes["service.name"], resource.attributes["k8s.container.name"]) where resource.attributes["k8s.container.name"] != nil
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
          processors: [memory_limiter, transform/service_name_fallback, batch]
          exporters: [otlphttp/b14]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, transform/severity, batch]
          exporters: [otlphttp/b14]
        logs/k8s-events:
          receivers: [k8sobjects]
          processors:
            - memory_limiter
            - resource/k8s-events
            - resourcedetection/eks
            - resource/env
            - transform/severity
            - transform/k8s-events
            - batch
          exporters: [otlphttp/b14]
        logs/k8s-cluster:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - transform/severity
            - batch
          exporters: [otlphttp/b14]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, resource/env, batch]
          exporters: [otlphttp/b14]
        metrics/k8s:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
            - batch
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
  image: otel/opentelemetry-collector-contrib:0.130.1
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
          # Re-join stack traces / tracebacks that arrive one line per record.
          # A line is a NEW entry unless it looks like a continuation:
          #   - starts with whitespace (Python "  File ...", Java "\tat ...")
          #   - "Caused by: ..." / "... N more" (Java)
          #   - "Traceback (most recent call last):" (Python)
          #   - "SomeError: msg" (final line of a Python traceback)
          - type: recombine
            id: multiline-stacktraces
            combine_field: body
            combine_with: "\n"
            source_identifier: attributes["log.file.path"]
            is_first_entry: 'body matches "^[^\\s]" and not (body matches "^(Caused by: |\\.\\.\\. [0-9]+ more|Traceback \\(most recent call last\\)|[A-Za-z_][A-Za-z0-9_.]*(Error|Exception): )")'
            force_flush_period: 5s
            max_log_size: 102400

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
      transform/filelog:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              - set(resource.attributes["service.name"], resource.attributes["k8s.container.name"]) where resource.attributes["k8s.container.name"] != nil

      # Extract severity from every known container log format; anything left
      # unmatched defaults to INFO. Rules are ordered and guarded by
      # severity_text == "" so the first match wins and OTLP logs that already
      # carry severity are untouched.
      transform/severity:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              # structured JSON bodies: parse once into cache
              - set(cache, ParseJSON(body)) where severity_text == "" and IsString(body) and IsMatch(body, "^\\s*\\{")
              # string level keys (zap json, slf4j, pino string, custom "severity")
              - set(severity_text, ConvertCase(cache["level"], "upper")) where severity_text == "" and IsString(cache["level"])
              - set(severity_text, ConvertCase(cache["severity"], "upper")) where severity_text == "" and IsString(cache["severity"])
              # pino numeric levels
              - set(severity_text, "TRACE") where severity_text == "" and cache["level"] == 10
              - set(severity_text, "DEBUG") where severity_text == "" and cache["level"] == 20
              - set(severity_text, "INFO") where severity_text == "" and cache["level"] == 30
              - set(severity_text, "WARN") where severity_text == "" and cache["level"] == 40
              - set(severity_text, "ERROR") where severity_text == "" and cache["level"] == 50
              - set(severity_text, "FATAL") where severity_text == "" and cache["level"] == 60
              # klog/glog "I0802 06:33:16.628281 ..." (kube components)
              - set(severity_text, "INFO") where severity_text == "" and IsString(body) and IsMatch(body, "^I[0-9]{4} ")
              - set(severity_text, "WARN") where severity_text == "" and IsString(body) and IsMatch(body, "^W[0-9]{4} ")
              - set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "^E[0-9]{4} ")
              - set(severity_text, "FATAL") where severity_text == "" and IsString(body) and IsMatch(body, "^F[0-9]{4} ")
              # logfmt level= (argocd, go-kit)
              - set(severity_text, "TRACE") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=trace")
              - set(severity_text, "DEBUG") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=debug")
              - set(severity_text, "INFO") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=info")
              - set(severity_text, "WARN") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=warn(ing)?")
              - set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=error")
              - set(severity_text, "FATAL") where severity_text == "" and IsString(body) and IsMatch(body, "(^|[ \\t])level=(fatal|panic)")
              # python/uvicorn prefix "INFO:", "WARNING:root:", "ERROR: ..."
              - 'set(severity_text, "DEBUG") where severity_text == "" and IsString(body) and IsMatch(body, "^DEBUG[: ]")'
              - 'set(severity_text, "INFO") where severity_text == "" and IsString(body) and IsMatch(body, "^INFO[: ]")'
              - 'set(severity_text, "WARN") where severity_text == "" and IsString(body) and IsMatch(body, "^WARN(ING)?[: ]")'
              - 'set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "^ERROR[: ]")'
              - 'set(severity_text, "FATAL") where severity_text == "" and IsString(body) and IsMatch(body, "^CRITICAL[: ]")'
              # zap console "2026-08-02T06:33:16.905Z\tinfo\t..."
              - set(severity_text, "DEBUG") where severity_text == "" and IsString(body) and IsMatch(body, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\\t]*\\tdebug\\t")
              - set(severity_text, "INFO") where severity_text == "" and IsString(body) and IsMatch(body, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\\t]*\\tinfo\\t")
              - set(severity_text, "WARN") where severity_text == "" and IsString(body) and IsMatch(body, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\\t]*\\twarn\\t")
              - set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\\t]*\\t(error|fatal|dpanic|panic)\\t")
              # bracketed "[INFO]" (dramatiq, spring-style)
              - set(severity_text, "DEBUG") where severity_text == "" and IsString(body) and IsMatch(body, "\\[DEBUG\\]")
              - set(severity_text, "INFO") where severity_text == "" and IsString(body) and IsMatch(body, "\\[INFO\\]")
              - set(severity_text, "WARN") where severity_text == "" and IsString(body) and IsMatch(body, "\\[WARN(ING)?\\]")
              - set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "\\[ERROR\\]")
              - set(severity_text, "FATAL") where severity_text == "" and IsString(body) and IsMatch(body, "\\[CRITICAL\\]")
              # multiline blobs that are clearly error dumps
              - 'set(severity_text, "ERROR") where severity_text == "" and IsString(body) and IsMatch(body, "(^|\\n)(Traceback \\(most recent call last\\)|[A-Za-z_][A-Za-z0-9_.]*(Error|Exception): )")'
              # normalize synonyms
              - set(severity_text, "WARN") where severity_text == "WARNING"
              - set(severity_text, "ERROR") where severity_text == "ERR"
              - set(severity_text, "FATAL") where severity_text == "CRITICAL" or severity_text == "PANIC"
              # default: everything still unlabelled is INFO
              - set(severity_text, "INFO") where severity_text == ""
              # severity_text -> severity_number (only if not already set upstream)
              - set(severity_number, SEVERITY_NUMBER_TRACE) where severity_number == 0 and severity_text == "TRACE"
              - set(severity_number, SEVERITY_NUMBER_DEBUG) where severity_number == 0 and severity_text == "DEBUG"
              - set(severity_number, SEVERITY_NUMBER_INFO) where severity_number == 0 and severity_text == "INFO"
              - set(severity_number, SEVERITY_NUMBER_WARN) where severity_number == 0 and severity_text == "WARN"
              - set(severity_number, SEVERITY_NUMBER_ERROR) where severity_number == 0 and severity_text == "ERROR"
              - set(severity_number, SEVERITY_NUMBER_FATAL) where severity_number == 0 and severity_text == "FATAL"

      # Promote high-value fields out of the body into log attributes so the
      # logs UI can facet/filter on them without parsing the body per row.
      transform/extract:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              # JSON app logs: promote the logger name for faceting
              - set(cache, ParseJSON(body)) where IsString(body) and IsMatch(body, "^\\s*\\{")
              - set(attributes["logger"], cache["logger"]) where IsString(cache["logger"])
              - set(attributes["logger"], cache["loggerName"]) where attributes["logger"] == nil and IsString(cache["loggerName"])
              - set(attributes["logger"], cache["name"]) where attributes["logger"] == nil and IsString(cache["name"])
              # HTTP access logs (nginx / gunicorn / uvicorn): method + status
              - merge_maps(attributes, ExtractPatterns(body, "\"(?P<http_request_method>GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^\"]*\" (?P<http_response_status_code>[0-9]{3})"), "upsert") where IsString(body) and IsMatch(body, "\"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^\"]*\" [0-9]{3}")
              # server errors in access logs are ERRORs even though the line has no level
              - set(severity_text, "ERROR") where IsString(attributes["http_response_status_code"]) and IsMatch(attributes["http_response_status_code"], "^5")
              - set(severity_number, SEVERITY_NUMBER_ERROR) where severity_text == "ERROR" and severity_number < SEVERITY_NUMBER_ERROR

      transform/service_name_fallback:
        error_mode: ignore
        trace_statements:
          - context: span
            statements:
              - set(resource.attributes["service.name"], resource.attributes["k8s.container.name"]) where resource.attributes["k8s.container.name"] != nil
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
          processors: [memory_limiter, resource, resource/env, transform/service_name_fallback, batch]
          exporters: [otlp/agent]
        logs:
          receivers: [otlp, filelog]
          processors:
            - memory_limiter
            - transform/filelog
            - k8sattributes
            - transform/severity
            - transform/extract
            - resource/env
            - batch
          exporters: [otlp/agent]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, resource/env, batch]
          exporters: [otlp/agent]
        metrics/k8s:
          receivers: [kubeletstats]
          processors:
            - memory_limiter
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
            - batch
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
  image: otel/opentelemetry-collector-contrib:0.130.1
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

      # Extract severity from log bodies; anything left unmatched defaults to
      # INFO. All rules are guarded by severity_text == "" so logs that already
      # carry severity (e.g. processed by scout-daemon) pass through untouched.
      transform/severity:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              # k8s events (body is a map from the k8sobjects receiver)
              - set(severity_text, "WARN") where severity_text == "" and IsMap(body) and body["type"] == "Warning"
              - set(severity_text, "INFO") where severity_text == "" and IsMap(body) and body["type"] == "Normal"
              # structured JSON string bodies (direct OTLP logs)
              - set(cache, ParseJSON(body)) where severity_text == "" and IsString(body) and IsMatch(body, "^\\s*\\{")
              - set(severity_text, ConvertCase(cache["level"], "upper")) where severity_text == "" and IsString(cache["level"])
              - set(severity_text, ConvertCase(cache["severity"], "upper")) where severity_text == "" and IsString(cache["severity"])
              - set(severity_text, "TRACE") where severity_text == "" and cache["level"] == 10
              - set(severity_text, "DEBUG") where severity_text == "" and cache["level"] == 20
              - set(severity_text, "INFO") where severity_text == "" and cache["level"] == 30
              - set(severity_text, "WARN") where severity_text == "" and cache["level"] == 40
              - set(severity_text, "ERROR") where severity_text == "" and cache["level"] == 50
              - set(severity_text, "FATAL") where severity_text == "" and cache["level"] == 60
              # normalize synonyms
              - set(severity_text, "WARN") where severity_text == "WARNING"
              - set(severity_text, "ERROR") where severity_text == "ERR"
              - set(severity_text, "FATAL") where severity_text == "CRITICAL" or severity_text == "PANIC"
              # default: everything still unlabelled is INFO
              - set(severity_text, "INFO") where severity_text == ""
              # severity_text -> severity_number (only if not already set upstream)
              - set(severity_number, SEVERITY_NUMBER_TRACE) where severity_number == 0 and severity_text == "TRACE"
              - set(severity_number, SEVERITY_NUMBER_DEBUG) where severity_number == 0 and severity_text == "DEBUG"
              - set(severity_number, SEVERITY_NUMBER_INFO) where severity_number == 0 and severity_text == "INFO"
              - set(severity_number, SEVERITY_NUMBER_WARN) where severity_number == 0 and severity_text == "WARN"
              - set(severity_number, SEVERITY_NUMBER_ERROR) where severity_number == 0 and severity_text == "ERROR"
              - set(severity_number, SEVERITY_NUMBER_FATAL) where severity_number == 0 and severity_text == "FATAL"

      # k8s events: promote reason/object fields to attributes for faceting in
      # the logs UI, and replace the raw event JSON body with the
      # human-readable message. Must run AFTER transform/severity (severity
      # reads body["type"] before the body is replaced).
      transform/k8s-events:
        error_mode: ignore
        log_statements:
          - context: log
            statements:
              - set(attributes["event.type"], body["type"]) where IsMap(body) and body["type"] != nil
              - set(attributes["event.reason"], body["reason"]) where IsMap(body) and body["reason"] != nil
              - set(attributes["k8s.object.kind"], body["regarding"]["kind"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["k8s.object.name"], body["regarding"]["name"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["k8s.namespace.name"], body["regarding"]["namespace"]) where IsMap(body) and body["regarding"] != nil
              - set(attributes["event.count"], body["deprecatedCount"]) where IsMap(body) and body["deprecatedCount"] != nil
              - set(body, body["note"]) where IsMap(body) and body["note"] != nil

      transform/service_name_fallback:
        error_mode: ignore
        trace_statements:
          - context: span
            statements:
              - set(resource.attributes["service.name"], resource.attributes["k8s.container.name"]) where resource.attributes["k8s.container.name"] != nil
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
          processors: [memory_limiter, resource, resource/env, transform/service_name_fallback, batch]
          exporters: [otlphttp/b14]
        logs:
          receivers: [otlp]
          processors: [memory_limiter, resource/env, transform/severity, batch]
          exporters: [otlphttp/b14]
        logs/k8s-events:
          receivers: [k8sobjects]
          processors:
            - memory_limiter
            - resource/k8s-events
            - resourcedetection/eks
            - resource/env
            - transform/severity
            - transform/k8s-events
            - batch
          exporters: [otlphttp/b14]
        logs/k8s-cluster:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - transform/severity
            - batch
          exporters: [otlphttp/b14]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, resource/env, batch]
          exporters: [otlphttp/b14]
        metrics/k8s:
          receivers: [k8s_cluster]
          processors:
            - memory_limiter
            - resource/k8s
            - resourcedetection/eks
            - resource/env
            - k8sattributes
            - batch
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
      - replicationcontrollers
      - replicationcontrollers/status
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
  - apiGroups: ["autoscaling"]
    resources:
      - horizontalpodautoscalers
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
| Java | `instrumentation.opentelemetry.io/inject-java: "observability/scout-instrumentation"` | OTLP HTTP (4318) |
| Python | `instrumentation.opentelemetry.io/inject-python: "observability/scout-instrumentation"` | OTLP HTTP (4318) |
| Node.js | `instrumentation.opentelemetry.io/inject-nodejs: "observability/scout-instrumentation"` | OTLP HTTP (4318) |
| .NET | `instrumentation.opentelemetry.io/inject-dotnet: "observability/scout-instrumentation"` | OTLP HTTP (4318) |
| Go | `instrumentation.opentelemetry.io/inject-go: "observability/scout-instrumentation"` | eBPF (requires elevated permissions) |

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
    endpoint: http://scout-agent-collector.observability.svc.cluster.local:4318
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
        instrumentation.opentelemetry.io/inject-java: "observability/scout-instrumentation"
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
        instrumentation.opentelemetry.io/inject-python: "observability/scout-instrumentation"
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
        instrumentation.opentelemetry.io/inject-nodejs: "observability/scout-instrumentation"
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
        instrumentation.opentelemetry.io/inject-dotnet: "observability/scout-instrumentation"
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
    instrumentation.opentelemetry.io/inject-java: "observability/scout-instrumentation"
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
    instrumentation.opentelemetry.io/inject-java: "observability/scout-instrumentation"
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
