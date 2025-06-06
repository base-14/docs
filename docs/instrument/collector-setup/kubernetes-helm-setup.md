---
keywords: [kubernetes, helm, opentelemetry, otel-collector, scout]
tags: [kubernetes, opentelemetry, base14 scout]
sidebar_position: 2
---

# Kubernetes using Helm

Deploy and configure the OpenTelemetry Collector on Kubernetes using Helm.

## Overview

This guide covers how to collect telemetry data (logs, metrics, and traces)
from your Kubernetes environment and send it to base14 Scout.

- Install base14 Scout's OpenTelemetry Collector using Helm
- Configure telemetry collection for Kubernetes pods
- Set up multi-namespace monitoring
- Configure custom metrics endpoints
- Implement trace collection

## Prerequisites

- A Kubernetes cluster (EKS, GKE, AKS, or other distributions)
- Helm 3.x installed
- `kubectl` configured with cluster access
- Scout account credentials
  - Endpoint URL
  - API Key
  - Token URL
  - Application Name

## Quick Start Guide

Deploy base14 Scout OpenTelemetry Collector in minutes by following these steps:

```mdx-code-block
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="fargate" label="Fargate">
```

```bash
helm repo add base14 https://charts.base14.io/
```

```bash
helm install scout base14/scout-collector --version 0.1.27 \
--namespace scout --create-namespace -f values.yaml
```

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

```bash
helm repo add base14 https://charts.base14.io/
```

```bash
helm install scout base14/scout-collector --version 0.5.0 \
--namespace scout --create-namespace -f values.yaml
```

```mdx-code-block
</TabItem>
</Tabs>
```

## Configuration Guide

## Using Otelcol style configuration

Following is an example of a values.yaml file that can be used to configure
scout collector using otelcol style
configuration. Here the configuration follows the same semantics as the
OpenTelemetry Collector otelcol config. This
gives a greater flexibility in terms of what you can configure to be scraped,
collected etc. Reference the [otel-collector-config](./otel-collector-config.md)
for more details.

```mdx-code-block
<Tabs>
<TabItem value="fargate" label="Fargate">
```

```yaml showLineNumbers title="values.yaml"
scout:
  endpoint: __YOUR_ENDPOINT__
  tokenUrl: __YOUR_TOKEN_URL__
  appName: __YOUR_APP_NAME__
  apiKey: __YOUR_API_KEY__
  clientId: __YOUR_CLIENT_ID__
  distribution: microk8s

  otelcolConfig:
    enabled: enabled
    config: |
      receivers:
        otlp:
          protocols:
            grpc:
              endpoint: 0.0.0.0:4317
            http:
              endpoint: 0.0.0.0:4318
         
        k8s_cluster:
           auth_type: serviceaccount
           collection_interval: 60s
           node_conditions_to_report: [
             ready, 
             memorypressure, 
             diskpressure, 
             pidpressure, 
             networkunavailable]
           resource_attributes:
             k8s.container.status.last_terminated_reason:
               enabled: true
           metrics:
             k8s.pod.status_reason:
               enabled: true
             k8s.node.condition:
               enabled: true
           allocatable_types_to_report: [ 
             cpu, 
             memory, 
             ephemeral-storage, 
             storage ]
        k8sobjects:
          objects:
            - name: events
              mode: pull
              interval: 60s
              group: events.k8s.io
            - name: deployments
              mode: pull
              interval: 60s
              group: deployments.k8s.io
            - name: resourcequotas
              mode: pull
              interval: 60s
              group: resourcequotas.k8s.io

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
              value: {{ scout.appName }}
              action: upsert
        resource/k8s:
          attributes:
            - key: service.name
              value: k8s
              action: upsert
        resource/env:
          attributes:
            - key: environment
              value: playground
              action: upsert
            - key: k8s.cluster.name
              value: <cluster-name>
              action: upsert
        resourcedetection/eks:
          detectors: [env, eks]
          override: true
          eks:
            resource_attributes:
              k8s.cluster.name:
                enabled: true
        k8sattributes:
          auth_type: "serviceAccount"
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
        otlphttp/base14:
          endpoint: {{scout.endpoint}}
          auth:
            authenticator: oauth2client
          tls:
            insecure_skip_verify: true

      extensions:
        health_check:
        pprof:
        zpages:
        oauth2client:
          client_id: {{scout.clientId}}
          client_secret: {{scout.clientSecret}}
          endpoint_params:
            audience: b14collector
          token_url: {{scout.tokenUrl}}
          tls:
            insecure_skip_verify: true

      service:
        extensions: [health_check, pprof, zpages, oauth2client]
        pipelines:
          traces:
            receivers: [otlp]
            processors: [batch]
            exporters: [otlphttp/base14]
          logs:
            receivers: [otlp]
            processors: [batch]
            exporters: [otlphttp/base14]
          logs/k8s-events:
            receivers: [ k8sobjects]
            processors: [ 
              memory_limiter, 
              batch, 
              resource/k8s-events, 
              resourcedetection/eks, 
              resource/env ]
            exporters: [ otlphttp/b14 ]
          logs/k8s-cluster:
            receivers: [ k8s_cluster ]
            processors: [ 
              memory_limiter, 
              batch, 
              resource/k8s, 
              resourcedetection/eks, 
              resource/env ]
            exporters: [ otlphttp/b14 ]
          metrics:
            receivers: [ otlp ]
            processors: [ memory_limiter, batch, resource/env ]
            exporters: [ otlphttp/b14 ]
          metrics/k8s:
            receivers: [ k8s_cluster ]
            processors: [ 
              memory_limiter, 
              batch, 
              resource/k8s, 
              resourcedetection/eks, 
              resource/env, 
              k8sattributes ]
            exporters: [ otlphttp/b14 ]
        telemetry:
          metrics:
            readers:
              - periodic:
                 exporter:
                   otlp:
                     protocol: http/protobuf
                     endpoint: http://0.0.0.0:4318
          logs:
            level: debug
            encoding: json
            processors:
              - batch:
                 exporter:
                   otlp:
                     protocol: http/protobuf
                     endpoint: http://0.0.0.0:4318
          traces:
            processors:
              - batch:
                 exporter:
                   otlp:
                     protocol: http/protobuf
                     endpoint: http://0.0.0.0:4318

```

```mdx-code-block
</TabItem>
<TabItem value="managed-nodes" label="Managed Nodes">
```

```yaml showLineNumbers title="values.yaml"
scout:
  endpoint: __YOUR_ENDPOINT__
  tokenUrl: __YOUR_TOKEN_URL__
  appName: __YOUR_APP_NAME__
  apiKey: __YOUR_API_KEY__
  clientId: __YOUR_CLIENT_ID__
  distribution: eks

  daemonOtelcolConfig:
    enabled: enabled
    config: |
        extensions:
          health_check:
            endpoint: 0.0.0.0:13133
          zpages:
            endpoint: 0.0.0.0:55679
        exporters:
          otlp/agent:
            endpoint: scout-agent-collector.scout.svc.cluster.local:4317
            tls:
              insecure: true

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
                value: {{ scout.appName }}
                action: upsert
          resource/k8s:
            attributes:
              - key: service.name
                value: k8s
                action: upsert
          resource/env:
            attributes:
              - key: environment
                value: playground
                action: upsert
              - key: k8s.cluster.name
                value: <cluster-name>
                action: upsert
          resourcedetection/eks:
            detectors: [env, eks]
            override: true
            eks:
              resource_attributes:
                k8s.cluster.name:
                  enabled: true
          k8sattributes:
            auth_type: "serviceAccount"
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
            auth_type: "serviceAccount"
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
                [
                  memory_limiter,
                  batch,
                  resource/k8s,
                  resourcedetection/eks,
                  resource/env,
                  k8sattributes,
                ]
              exporters: [otlp/agent]
          telemetry:
            metrics:
              readers:
                - periodic:
                    exporter:
                      otlp:
                        protocol: http/protobuf
                        endpoint: http://0.0.0.0:4318
            logs:
              level: debug
              encoding: json
              processors:
                - batch:
                    exporter:
                      otlp:
                        protocol: http/protobuf
                        endpoint: http://0.0.0.0:4318
            traces:
              processors:
                - batch:
                    exporter:
                      otlp:
                        protocol: http/protobuf
                        endpoint: http://0.0.0.0:4318



  agentOtelcolConfig:
    enabled: enabled
    config: |
        extensions:
          health_check:
            endpoint: 0.0.0.0:13133
          zpages:
            endpoint: 0.0.0.0:55679
          oauth2client:
            client_id: {{ scout.clientId }}
            client_secret: {{ scout.apiKey }}
            endpoint_params:
              audience: b14collector
            token_url: {{ scout.tokenUrl }}
            tls:
              insecure_skip_verify: true
        exporters:
          debug:
            verbosity: detailed
          otlphttp/b14:
            endpoint: {{ scout.endpoint }}
            auth:
              authenticator: oauth2client
            tls:
              insecure_skip_verify: true
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
              value: {{ scout.appName }}
              action: upsert
          resource/k8s:
            attributes:
            - key: service.name
              value: k8s
              action: upsert
          resource/env:
            attributes:
            - key: environment
              value: playground
              action: upsert
            - key: k8s.cluster.name
              value: <cluster-name>
              action: upsert
          resourcedetection/eks:
            detectors: [env,  eks]
            override: true
            eks:
              resource_attributes:
                k8s.cluster.name:
                  enabled: true
          k8sattributes:
            auth_type: 'serviceAccount'
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
          resource/k8s-events:
            attributes:
              - key: service.name
                value: "k8s-events"
                action: upsert
        receivers:
          otlp:
            protocols:
              http:
                endpoint: 0.0.0.0:4318
              grpc:
                endpoint: 0.0.0.0:4317
          k8s_cluster:
            auth_type: serviceaccount
            collection_interval: 60s
            node_conditions_to_report: [
              ready, 
              memorypressure, 
              diskpressure, 
              pidpressure, 
              networkunavailable ]
            resource_attributes:
              k8s.container.status.last_terminated_reason:
                enabled: true
            metrics:
              k8s.pod.status_reason:
                enabled: true
              k8s.node.condition:
                enabled: true
            allocatable_types_to_report: [ 
              cpu, 
              memory, 
              ephemeral-storage, 
              storage ]
          k8sobjects:
            objects:
              - name: events
                mode: pull
                interval: 60s
                group: events.k8s.io
              - name: deployments
                mode: pull
                interval: 60s
                group: deployments.k8s.io
              - name: resourcequotas
                mode: pull
                interval: 60s
                group: resourcequotas.k8s.io
        service:
          extensions: [ oauth2client, zpages, health_check ]
          pipelines:
            traces:
              receivers: [ otlp]
              processors: [ batch, resource, resource/env ]
              exporters: [ otlphttp/b14 ]
            logs:
              receivers: [ otlp ]
              processors: [ batch, resource/env ]
              exporters: [ otlphttp/b14, debug ]
            logs/k8s-events:
              receivers: [ k8sobjects]
              processors: [ 
                memory_limiter, 
                batch, 
                resource/k8s-events, 
                resourcedetection/eks, 
                resource/env ]
              exporters: [ otlphttp/b14 ]
            logs/k8s-cluster:
              receivers: [ k8s_cluster ]
              processors: [ 
                memory_limiter, 
                batch, 
                resource/k8s, 
                resourcedetection/eks, 
                resource/env ]
              exporters: [ otlphttp/b14 ]
            metrics:
              receivers: [ otlp ]
              processors: [ memory_limiter, batch, resource/env ]
              exporters: [ otlphttp/b14 ]
            metrics/k8s:
              receivers: [ k8s_cluster ]
              processors: [ 
                memory_limiter, 
                batch, 
                resource/k8s, 
                resourcedetection/eks, 
                resource/env, 
                k8sattributes ]
              exporters: [ otlphttp/b14 ]
          telemetry:
            metrics:
              readers:
                - periodic:
                   exporter:
                     otlp:
                       protocol: http/protobuf
                       endpoint: http://0.0.0.0:4318
            logs:
              level: debug
              encoding: json
              processors:
                - batch:
                   exporter:
                     otlp:
                       protocol: http/protobuf
                       endpoint: http://0.0.0.0:4318
            traces:
              processors:
                - batch:
                   exporter:
                     otlp:
                       protocol: http/protobuf
                       endpoint: http://0.0.0.0:4318

```

```mdx-code-block
</TabItem>
</Tabs>
```

## Scout helm chart uses the above configuration to configure the OpenTelemetry Collector

1. Collects logs for the current cluster(for Managed nodes only).
2. Sends k8s events data.
3. Sends node and pods metrics data.
4. Sends apps metrics data for the configured app endpoints.
5. Sets up a local otlp endpoint for apps to send traces which are then
   forwarded to Scout.
