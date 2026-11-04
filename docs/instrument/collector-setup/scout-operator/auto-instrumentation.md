---
title: Auto-instrumentation with ScoutInstrumentation
sidebar_label: Auto-instrumentation
description:
  Add OpenTelemetry auto-instrumentation to Kubernetes pods with Scout
  Operator. Annotate a pod or namespace and the operator injects the Java,
  Node.js, Python, .NET, Go, PHP, Ruby, Apache HTTPD, or nginx agent.
keywords:
  [
    scout operator,
    scoutinstrumentation,
    kubernetes auto instrumentation,
    zero code instrumentation,
    opentelemetry operator alternative,
    instrumentation annotation,
    java agent injection,
  ]
tags: [kubernetes, opentelemetry, base14 scout]
sidebar_position: 5
---

# Auto-instrumentation

Scout Operator adds OpenTelemetry auto-instrumentation to pods you annotate,
without changing their images. It works the same way as the OpenTelemetry
Operator:

- A `ScoutInstrumentation` resource says where telemetry goes and how it is
  sampled.
- An annotation on a pod or namespace says which language agent to add.

When an annotated pod is created, the operator adds an init container that
copies the agent into the pod, and sets the environment variables that load
it. Your application's image and code stay as they are.

Auto-instrumentation is on by default from Scout Operator 0.1.14 (chart
0.1.11).

## Before you start

- Scout Operator 0.1.14 or later. See [Overview and install](./index.md).
- A collector to send to, such as the Gateway from
  [ScoutCollector resource](./scoutcollector.md).
- The Kubernetes API server must reach the operator's webhook on port 9443.
  Most clusters allow this already. Private GKE clusters need a firewall
  rule from the control plane to the nodes on that port.
- Your nodes must be able to pull the agent images from `ghcr.io`, or from a
  mirror you set with `instrumentation.images.<language>`.

## Step 1: Create a ScoutInstrumentation

Create one in the namespace where your application runs:

```yaml showLineNumbers title="scout-instrumentation.yaml"
apiVersion: telemetry.scout.base14.io/v1alpha1
kind: ScoutInstrumentation
metadata:
  name: default
  namespace: payments
spec:
  exporter:
    endpoint: http://gateway.observability.svc.cluster.local:4318
  env:
    - name: OTEL_EXPORTER_OTLP_PROTOCOL
      value: http/protobuf
  propagators:
    - tracecontext
    - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "1"
```

```bash
kubectl apply -f scout-instrumentation.yaml
kubectl get scoutinstrumentations -n payments
```

- `exporter.endpoint` is the collector the agents send to. Java, Node.js,
  Python, .NET, Go, and Ruby send OTLP over HTTP to port 4318, as here.
- Apache HTTPD, nginx, and PHP send OTLP over gRPC. Give them their own
  `ScoutInstrumentation` with the endpoint on port 4317 and without the
  `OTEL_EXPORTER_OTLP_PROTOCOL` variable, and name it in their annotation.
- `sampler` decides how many traces to keep. `argument: "1"` keeps all of
  them; `"0.25"` keeps a quarter.
- `env` adds environment variables to every instrumented container.

The spec has the same fields as the OpenTelemetry Operator's `Instrumentation`
resource, including per-language sections such as `java.env` or
`python.resources`. The operator rejects an invalid resource when you apply it,
for example a sampler argument outside 0 to 1.

## Step 2: Annotate your workload

Add the annotation for your language to the pod template:

```yaml showLineNumbers title="deployment.yaml (excerpt)"
spec:
  template:
    metadata:
      annotations:
        instrumentation.scout.base14.io/inject-java: "true"
```

The operator only acts when a pod is created. Restart the pods that are
already running:

```bash
kubectl rollout restart deployment/checkout -n payments
```

To instrument every pod in a namespace, annotate the namespace instead. An
annotation on the pod takes precedence:

```bash
kubectl annotate namespace payments \
  instrumentation.scout.base14.io/inject-java="true"
```

The annotation value picks the `ScoutInstrumentation`:

| Value | Effect |
| --- | --- |
| `"true"` | Uses the only `ScoutInstrumentation` in the pod's namespace |
| `"my-instrumentation"` | Uses that `ScoutInstrumentation` in the pod's namespace |
| `"observability/my-instrumentation"` | Uses a `ScoutInstrumentation` from another namespace |
| `"false"` | Never instruments the pod, even when the namespace opts in |

With `"true"`, the namespace needs exactly one `ScoutInstrumentation`. If it
has none or several, the pod starts uninstrumented. Name the one you want to
avoid that.

## Step 3: Check the result

The instrumented pod has an extra init container named after the language:

```bash
kubectl get pod -n payments -l app=checkout \
  -o jsonpath='{.items[0].spec.initContainers[*].name}'
```

```text
opentelemetry-auto-instrumentation-java
```

The operator also sets `OTEL_SERVICE_NAME` to the workload's name, here
`checkout`. Send a few requests to the application, and its traces appear in
Scout under that service name.

## Languages

| Language | Annotation | On by default | Default agent |
| --- | --- | --- | --- |
| Java | `inject-java` | Yes | 2.32.0 |
| Node.js | `inject-nodejs` | Yes | 0.82.0-1 |
| Python | `inject-python` | Yes | 0.66b1 |
| .NET | `inject-dotnet` | Yes | 1.17.0 |
| Apache HTTPD | `inject-apache-httpd` | Yes | 1.0.4 |
| Go | `inject-go` | No | v0.24.0 |
| nginx | `inject-nginx` | No | 1.0.4 |
| PHP | `inject-php` | No | 1.4.1 |
| Ruby | `inject-ruby` | No | 0.1.0 |
| SDK only | `inject-sdk` | Always | none |

Every annotation starts with `instrumentation.scout.base14.io/`. The defaults
match the OpenTelemetry Operator release Scout Operator follows. Turn a
language on or off with the chart:

```bash
helm upgrade scout-operator base14/scout-operator \
  --namespace scout-operator-system \
  --reuse-values \
  --set instrumentation.languages.go=true
```

A few languages need more than the inject annotation:

- **Go** runs the agent as an eBPF sidecar. Set
  `instrumentation.scout.base14.io/otel-go-auto-target-exe` to the path of the
  binary in your image. The sidecar runs privileged, and the pod must not set
  `shareProcessNamespace: false`.
- **Python** on Alpine or another musl image needs
  `instrumentation.scout.base14.io/otel-python-platform: "musl"`.
- **.NET** on Alpine needs
  `instrumentation.scout.base14.io/otel-dotnet-auto-runtime: "linux-musl-x64"`.
- **SDK only** adds the exporter and resource environment variables without an
  agent, for applications that already include the OpenTelemetry SDK.

:::note
The .NET, Apache HTTPD, nginx, and PHP agents are published for amd64 nodes
only. On arm64 nodes, pods for those languages fail in the agent's init
container.
:::

## Choosing containers

Without further annotations, the operator instruments the first container in
the pod. To pick containers, list them:

```yaml
annotations:
  instrumentation.scout.base14.io/inject-java: "true"
  instrumentation.scout.base14.io/container-names: "api"
```

To instrument containers in one pod with different languages, give each
language its own list:

```yaml
annotations:
  instrumentation.scout.base14.io/inject-java: "true"
  instrumentation.scout.base14.io/java-container-names: "api"
  instrumentation.scout.base14.io/inject-python: "true"
  instrumentation.scout.base14.io/python-container-names: "worker"
```

The per-language keys follow the pattern `<language>-container-names`, for
example `nodejs-container-names` or `dotnet-container-names`. nginx is the
exception: its key is `inject-nginx-container-names`.

## Chart values

| Value | Default | Description |
| --- | --- | --- |
| `instrumentation.enabled` | `true` | Turns auto-instrumentation on or off. See the warning below. |
| `instrumentation.languages.<language>` | see [Languages](#languages) | Turns one language on or off. Keys: `java`, `nodejs`, `python`, `dotnet`, `apacheHttpd`, `go`, `nginx`, `php`, `ruby`, `multi`. |
| `instrumentation.images.<language>` | none | Replaces a default agent image, for example with a copy in your own registry. Same keys as above, without `multi`. |
| `instrumentation.tls.mode` | `selfManaged` | Where the webhook certificate comes from. See [Webhook certificates](#webhook-certificates). |
| `instrumentation.webhook.port` | `9443` | Port the operator's webhook listens on. |
| `instrumentation.webhook.timeoutSeconds` | `10` | How long the API server waits for the webhook. |

`instrumentation.languages.multi` lets one pod hold containers instrumented
with different languages.

:::warning
Setting `instrumentation.enabled=false` on a running release removes the
`ScoutInstrumentation` CRD, and Kubernetes then deletes every
`ScoutInstrumentation` in the cluster. Pods that are already instrumented keep
their agent until they restart. New pods start without one.
:::

## Webhook certificates

The API server calls the operator's webhook over HTTPS, so the webhook needs a
certificate. `instrumentation.tls.mode` decides who provides it:

- **`selfManaged`** (default): the operator creates the certificate, stores it
  in a Secret in its own namespace, and renews it before it expires. You do
  not need cert-manager. If cert-manager is installed, the operator leaves it
  alone.
- **`certManager`**: your existing cert-manager issues the certificate. The
  chart creates one self-signed `Issuer` and one `Certificate` in the
  operator's namespace and asks cert-manager to add the CA to the operator's
  own webhooks. It does not install, upgrade, or reconfigure cert-manager, and
  it does not use your ClusterIssuers.

## Installs limited to namespaces

With `manager.scope=namespaced`, the webhooks only see pods in
`manager.watchNamespaces`. Pods in other namespaces are never instrumented,
even with the annotation.

Auto-instrumentation needs one small ClusterRole in this mode: it reads
Namespaces, which hold the namespace annotations, and updates the operator's
two webhook configurations. The chart creates it.

## Running next to the OpenTelemetry Operator

Both operators can run in one cluster. Scout Operator only acts on the
`instrumentation.scout.base14.io/` annotations and ignores
`instrumentation.opentelemetry.io/`. A pod already instrumented by the
OpenTelemetry Operator is never instrumented a second time.

To move an application over:

1. Create a `ScoutInstrumentation` with the same spec as your `Instrumentation`.
2. Change the annotation prefix on the workload from
   `instrumentation.opentelemetry.io/` to `instrumentation.scout.base14.io/`.
3. Restart the workload.

## Upgrades

When a new operator release changes a default agent version, it updates every
`ScoutInstrumentation` that is still on the previous default. Resources that
set an image themselves keep it. Running pods keep the agent they started with
until they restart.

## Troubleshooting

### A pod starts without instrumentation

Check these in order:

- **The pod predates the annotation.** Restart the workload.
- **The language is turned off.** The pod has a warning event with reason
  `InstrumentationRequestRejected`. Turn the language on with
  `instrumentation.languages.<language>`.
- **`"true"` found no `ScoutInstrumentation`, or several.** Name one in the
  annotation, or keep exactly one in the namespace.
- **The webhook was unreachable.** The webhook never blocks pod creation, so
  pods start uninstrumented while it is down. Check that the operator pod is
  ready, and that the API server can reach port 9443.
- **The namespace is not watched.** In a namespaced install, add it to
  `manager.watchNamespaces`.

```bash
kubectl get events -n payments --field-selector reason=InstrumentationRequestRejected
kubectl get pods -n scout-operator-system
```

### The pod is stuck in `Init`

The agent's init container could not start. `kubectl describe pod` shows why:

- **`ImagePullBackOff`**: nodes cannot reach `ghcr.io`. Copy the agent image
  to your registry and set `instrumentation.images.<language>`.
- **`CrashLoopBackOff` on an arm64 node**: the agent is amd64-only. Run the
  workload on amd64 nodes.

### Traces do not reach Scout

The agent is running but sends nowhere useful. Check that
`exporter.endpoint` resolves from the application's namespace, and that the
collector's logs show the requests arriving.

## FAQ

### Does auto-instrumentation change my container images?

No. The agent is copied into a shared volume by an init container when the pod
starts, and loaded through environment variables. Your image is not rebuilt or
modified.

### Can a webhook outage stop my pods from starting?

No. The pod webhook is set to ignore failures, so if the operator is down,
pods start normally without instrumentation. Restart them once the operator
is back to instrument them.

### Do I need cert-manager?

No. By default the operator manages its own webhook certificate. Use
`instrumentation.tls.mode=certManager` only if you want cert-manager to issue
it.

## Related guides

- [Overview and install](./index.md): install and upgrade the operator.
- [ScoutCollector resource](./scoutcollector.md): run the Gateway the agents
  send to.
- [Auto-instrumentation overview](../../apps/auto-instrumentation/index.md):
  framework guides for instrumenting applications in code.
