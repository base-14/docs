---
title: Scout integration patterns for Datadog .NET environments
sidebar_label: Datadog + Scout (.NET)
sidebar_position: 7
draft: true
description:
  Add base14 Scout to a Datadog-instrumented .NET environment without
  disrupting your Datadog installation. Compare four integration paths,
  pick the one that fits your constraints, and avoid the profiling
  traffic gotcha.
keywords:
  [
    datadog scout coexistence,
    datadog scout integration,
    datadog opentelemetry dotnet,
    scout dotnet integration,
    datadog otel coexistence,
    otel collector datadogreceiver,
    dotnet observability dual vendor,
    scout datadog side by side,
    datadog continuous profiler scout,
    dotnet apm scout,
    datadog dotnet tracer migration,
    coreclr profiler conflict,
    kubernetes apm coexistence,
  ]
---

# Scout integration patterns for Datadog .NET environments

If you run .NET 6.0+ services on Kubernetes, ship telemetry to Datadog
through the DD agent DaemonSet, and want to start using Scout without
disrupting your Datadog installation, this guide is your decision tree.

There is no single right way to do this. The right path depends on four
constraints: code change tolerance, DD profiler ownership, depth
required in Scout, and how much DD-side configuration you are willing
to touch. This guide walks all four viable patterns, the trade-offs of
each, and the operational gotchas that tend to surface only after
rollout.

## Who this is for

- SRE, platform, and DevOps engineers running .NET 6.0+ services in
  Kubernetes.
- Active Datadog APM deployment via DD agent DaemonSet plus DD .NET
  tracer (CLR profiler).
- Evaluating Scout, piloting it on selected services, or planning a
  longer-term coexistence window.

If you have no Datadog in the picture, the
[ASP.NET Core SDK guide](../instrument/apps/auto-instrumentation/dotnet.md)
is the simpler starting point.

### Assumed Scout Collector topology

All four paths assume a Scout Collector reachable from your application
pods. Two deployment shapes appear in the examples below:

- **Node-local DaemonSet** exposing OTLP on port 4317 via `hostPort`.
  Apps reach it through the downward-API `$(NODE_IP)` env var. Used in
  Path A's example for low-latency, lossy-tolerant collection.
- **In-cluster Service** named `scout-collector.observability:4317`
  fronting a Deployment or DaemonSet of collectors. Used in Paths C
  and D where a single ingress endpoint is operationally simpler.

Pick whichever shape matches your existing collector deployment; the
endpoint string is the only thing that changes between the two.

## The four paths at a glance

| Path | App code change | DD profiler | Depth in Scout | DD config change | Maturity |
|---|---|---|---|---|---|
| A. OTel SDK in-code | ~30 LOC + NuGet | Untouched | DD-equivalent | None | Stable |
| B. OTel auto-instrumentation | None | Replaced per pod | DD-equivalent | Profiler env vars | Stable |
| C. Beyla (eBPF) | None | Untouched | HTTP-level only | None | Beta |
| D. Trace tap (datadogreceiver) | None | Untouched | DD-equivalent (alpha receiver) | One env var + profiling fix | Alpha receiver |

## Pick your path in 60 seconds

```text
Can you change application code?
├── Yes  → Path A (OTel SDK in-code)
└── No
    ├── Can you replace the DD profiler on selected pods?
    │   ├── Yes → Path B (OTel auto-instrumentation)
    │   └── No
    │       ├── Is HTTP-level depth sufficient (no EF, no custom spans)?
    │       │   ├── Yes → Path C (Beyla / eBPF)
    │       │   └── No  → Path D (Trace tap, with profiling fix)
```

The constraints behind this tree:

1. **Code change tolerance.** Some teams own the .NET code and can
   ship a small bootstrap PR. Others integrate against third-party or
   change-controlled services where any code change is a multi-week
   process.
2. **DD profiler ownership.** CoreCLR allows exactly one CLR profiler
   per process. DD's tracer claims that slot. OTel auto-instrumentation
   wants the same slot. They cannot coexist inside one process, only
   inside one cluster.
3. **Depth required in Scout.** "DD-equivalent" means controller method
   names, EF Core query spans with SQL text, custom `ActivitySource`
   spans, .NET runtime metrics. "HTTP-level" means routes, status,
   latency, service graph - no in-process detail.
4. **DD-side config change tolerance.** Some teams treat DD agent and
   tracer config as immutable contract surface. Others accept additive
   env vars on Deployments.

---

## Path A: OTel SDK in-code

If you can ship a roughly 30-line bootstrap PR, this is the cleanest
path and the recommended default.

Add the OTel SDK NuGet packages and wire them up in `Program.cs`. The
SDK uses `System.Diagnostics.ActivitySource` and `DiagnosticSource`,
which do not register as a CLR profiler. DD's profiler stays loaded and
keeps producing DD spans. The OTel SDK independently observes the same
events and exports them to Scout via OTLP.

Result: both backends see the same operations with matching trace IDs,
and neither side is degraded.

### Bootstrap

NuGet packages (`.csproj`):

```xml
<ItemGroup>
  <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.11.2" />
  <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.11.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.Http" Version="1.11.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.SqlClient" Version="1.11.0-beta.1" />
  <PackageReference Include="OpenTelemetry.Instrumentation.Runtime" Version="1.11.1" />
</ItemGroup>
```

`Program.cs`:

```csharp
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r
        .AddService(
            serviceName: Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet-app")
        .AddAttributes(new Dictionary<string, object>
        {
            ["deployment.environment"] = builder.Environment.EnvironmentName.ToLowerInvariant()
        }))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation(o => o.RecordException = true)
        .AddHttpClientInstrumentation()
        .AddSqlClientInstrumentation(o => o.SetDbStatementForText = true)
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());

builder.Logging.AddOpenTelemetry(l =>
{
    l.IncludeFormattedMessage = true;
    l.IncludeScopes = true;
    l.AddOtlpExporter();
});
```

Deployment env vars (no DD changes required):

```yaml
env:
  - name: OTEL_SERVICE_NAME
    value: payments-api
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://$(NODE_IP):4317
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: grpc
  - name: DD_TRACE_PROPAGATION_STYLE
    value: "tracecontext,datadog"
```

The `DD_TRACE_PROPAGATION_STYLE` line ensures DD's outbound
`traceparent` headers are W3C-primary, so trace IDs align across the
boundary. DD .NET tracer v2.48.0+ already defaults to
`datadog,tracecontext` (see the
[Datadog Trace Context Propagation docs](https://docs.datadoghq.com/tracing/trace_collection/trace_context_propagation/));
older versions need this set explicitly.

### What you get

- Full DD-equivalent depth in Scout: controllers, EF Core queries,
  custom `ActivitySource` spans, runtime metrics.
- Trace IDs match between DD and Scout - pivot by trace ID across
  both UIs while you migrate.
- DD continues unchanged.

### What to watch for

- `AddRuntimeInstrumentation` duplicates GC and threadpool metrics
  with DD's runtime metrics. Drop it if you want DD as the single
  source.
- DD .NET tracer below v2.48.0 needs `DD_TRACE_PROPAGATION_STYLE` set
  explicitly to get W3C propagation as the primary format.
- `AddOtlpExporter()` is called once per signal type. Calling it twice
  silently double-exports on older SDK versions.

For full SDK options, see the
[ASP.NET Core SDK guide](../instrument/apps/auto-instrumentation/dotnet.md).

---

## Path B: OTel auto-instrumentation (replace DD profiler per pod)

Use this when application code is off-limits but the CLR profiler slot
is yours to reassign on selected pods.

The OpenTelemetry Operator injects an init container that drops the
.NET auto-instrumentation profiler at `/otel-auto-instrumentation` and
sets the CoreCLR profiler env vars. CoreCLR allows exactly one profiler
per process, so you must turn off the DD profiler on those pods first.

In practice this fits teams that have permission to modify DD APM
behavior per workload. If you have an active DD APM contract covering
all .NET services, Paths A, C, or D are usually the right call instead
(pick by depth needed in Scout).

### Disable DD profiler on selected pods

If DD Cluster Agent admission controller injects the tracer:

```yaml
metadata:
  labels:
    admission.datadoghq.com/enabled: "false"
```

If the DD tracer is baked into the image:

```yaml
env:
  - name: CORECLR_ENABLE_PROFILER
    value: "0"
  - name: DD_TRACE_ENABLED
    value: "false"
  - name: DD_PROFILING_ENABLED
    value: "false"
  - name: DD_RUNTIME_METRICS_ENABLED
    value: "false"
```

`CORECLR_ENABLE_PROFILER=0` is the load-bearing line. It stops the CLR
from loading DD's profiler DLL, freeing the slot for OTel.

### Inject OTel auto-instrumentation

Operator install (one-time):

```bash
kubectl apply -f https://github.com/open-telemetry/opentelemetry-operator/releases/latest/download/opentelemetry-operator.yaml
```

`Instrumentation` CR:

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: scout-dotnet
  namespace: payments
spec:
  exporter:
    endpoint: http://$(NODE_IP):4317
  propagators: [tracecontext, baggage, b3]
  sampler:
    type: parentbased_traceidratio
    argument: "1.0"
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:1.9.0
    env:
      - name: OTEL_DOTNET_AUTO_RUNTIME
        value: linux-x64
```

Use `linux-musl-x64` for Alpine-based images. Pin the image version
explicitly and verify .NET 9.0 support against the
[auto-instrumentation release notes](https://github.com/open-telemetry/opentelemetry-dotnet-instrumentation/releases)
for the tag you choose. Do not use `latest`.

Pod annotation on the selected Deployment:

```yaml
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-dotnet: "scout-dotnet"
  labels:
    admission.datadoghq.com/enabled: "false"
```

### What stays on DD's side

The DD agent DaemonSet continues collecting:

- Container and pod metrics.
- stdout / stderr logs.
- Kubelet and node metrics.
- DogStatsD if any code path uses it.

### What you give up on those pods

- DD APM traces (the profiler is gone).
- DD continuous profiler.
- DD runtime metrics (OTel runtime instrumentation replaces them).

---

## Path C: Beyla / eBPF (no app or profiler change)

When neither the code nor the profiler can move, this is the floor:
kernel-level observation with zero in-process footprint, in exchange
for HTTP-level depth only.

Grafana Beyla observes HTTP, HTTPS (via OpenSSL uprobes), and gRPC
traffic at the kernel level via eBPF. It runs as a privileged DaemonSet,
discovers .NET processes by Kubernetes metadata, and exports OTLP. It
never touches the .NET process - DD profiler is undisturbed.

### What you get

- HTTP server and client spans with route templates and status codes.
- gRPC spans.
- RED metrics per route (rate, errors, latency p50 / p95 / p99).
- Service graph derived from observed traffic.
- Trace ID propagation via `traceparent` on the wire (recent Beyla
  versions; verify against the
  [Beyla release notes](https://github.com/grafana/beyla/releases) for
  your target version).

### What you do not get

- No EF Core or SqlClient query spans with SQL text.
- No controller method names (you get the route template, not
  `OrdersController.GetById`).
- No custom `ActivitySource` spans.
- No .NET runtime metrics in Scout (DD continues to provide them).

If any of these are non-negotiable for the Scout evaluation, Beyla will
under-deliver - move to Path A or D.

### Deployment

DaemonSet (privileged, hostPID, eBPF capabilities):

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: beyla
  namespace: observability
spec:
  selector: { matchLabels: { app: beyla } }
  template:
    metadata: { labels: { app: beyla } }
    spec:
      hostPID: true
      serviceAccountName: beyla
      containers:
        - name: beyla
          image: grafana/beyla:1.9
          securityContext:
            privileged: true
          env:
            - name: BEYLA_CONFIG_PATH
              value: /config/beyla.yml
          volumeMounts:
            - { name: config, mountPath: /config }
      volumes:
        - { name: config, configMap: { name: beyla-config } }
```

Beyla discovery config (limit to selected services):

```yaml
discovery:
  services:
    - k8s_namespace: payments
      k8s_deployment_name: ^(payments-api|payments-worker)$
    - k8s_namespace: catalog
      k8s_deployment_name: catalog-api
attributes:
  kubernetes:
    enable: true
routes:
  unmatched: heuristic
otel_traces_export:
  endpoint: http://scout-collector.observability:4317
otel_metrics_export:
  endpoint: http://scout-collector.observability:4317
```

### What to watch for

- Privileged DaemonSet needs `CAP_SYS_ADMIN`, `CAP_BPF`, `CAP_PERFMON`.
  If your cluster uses Pod Security Admission `restricted`, you need a
  privileged namespace label or a Kyverno exception.
- HTTPS to external endpoints: hostname and status only, no path.
- HTTPS to internal services: works via OpenSSL uprobes on the standard
  `mcr.microsoft.com/dotnet/aspnet:*` images. Custom or static-linked
  TLS needs validation.
- Kernel 5.8+ for full feature set. Most managed Kubernetes node images
  are fine; verify on bare metal or older nodes.

---

## Path D: Trace tap via OTel Collector `datadogreceiver`

The right pick when DD-equivalent depth in Scout is non-negotiable but
neither the application code nor the DD profiler can be touched.
Operationally the heaviest of the four.

This is the most operationally involved path and the only one that
delivers DD-equivalent depth without modifying the .NET process. It
puts an OTel Collector in front of where the DD .NET tracer sends
traces. The collector accepts DD's wire format, converts to OTLP
internally, and fans out: one copy continues to Datadog, another goes
to Scout.

### Architecture

The diagram below shows the full deployable topology, including the
path-routing proxy required to keep DD's continuous profiler working.
The proxy and the reasoning for it are explained in the "profiling
gotcha" section below; do not deploy without reading it.

```text
[.NET app + DD tracer]   DD_TRACE_AGENT_URL → node-proxy:8126
       │
       │  DD wire format on port 8126 (two URL paths)
       ▼
[Path-routing proxy (per-node DaemonSet)]
   │
   ├── /v0.x/traces, /api/v0.2/traces  ──►  [OTel Collector tap (:18126)]
   │                                            ├──► datadogexporter ──► Datadog intake
   │                                            └──► otlpexporter   ──► Scout Collector
   │
   └── /profiling/v1/input, /info, /v0.6/stats ──►  [Real DD Agent (:28126)]

[DD Agent DaemonSet (other ports)]   unchanged for everything not on 8126:
                                     logs, infra metrics, kubelet, container
                                     metrics, DogStatsD (8125), AppSec
```

If you adopt the agentless-profiling alternative (Option 2 in the
profiling gotcha section), the path-routing proxy collapses out and
the .NET tracer points directly at the OTel Collector tap on port
8126.

### Collector config

```yaml
receivers:
  datadog:
    endpoint: 0.0.0.0:8126
    read_timeout: 60s

processors:
  batch:
    send_batch_size: 1024
    timeout: 5s

exporters:
  datadog/forward:
    api:
      site: datadoghq.com
      key: ${env:DD_API_KEY}
    traces:
      compute_stats_by_span_kind: true
      peer_tags_aggregation: true
  otlp/scout:
    endpoint: scout-collector.observability:4317
    headers:
      x-scout-api-key: ${env:SCOUT_API_KEY}

service:
  pipelines:
    traces/to-dd:
      receivers: [datadog]
      processors: [batch]
      exporters: [datadog/forward]
    traces/to-scout:
      receivers: [datadog]
      processors: [batch]
      exporters: [otlp/scout]
```

### Per-Deployment env change

```yaml
env:
  - name: DD_TRACE_AGENT_URL
    value: http://$(NODE_IP):8126
```

This is the only change on the .NET app side. From the tracer's
perspective it is still talking to a DD agent.

### The profiling gotcha

The DD .NET profiler shares `DD_TRACE_AGENT_URL` with the tracer.
There is no separate profiler URL env var. Both traces and profiles
travel over **port 8126** to the configured agent URL, but on
different paths:

- `/v0.x/traces`, `/api/v0.2/traces` for APM traces.
- `/profiling/v1/input` for continuous profiler uploads.

The OTel Collector `datadogreceiver` only implements the trace
endpoints. If you redirect `DD_TRACE_AGENT_URL` to the tap without
addressing this, profile uploads return 404 and DD silently loses
continuous profiler data for the selected services.

Two ways to handle it.

#### Option 1: path-routing proxy in front of port 8126

Run a small nginx or Envoy DaemonSet on port 8126 that routes by URL
path:

- `/v0.x/traces`, `/api/v0.2/traces` → OTel tap
  (relocated to `:18126`).
- `/profiling/v1/input`, `/info`, `/v0.6/stats`, everything else →
  real DD agent (relocated to `:28126`, or run as a separate workload).

`DD_TRACE_AGENT_URL` then points at the proxy. From the .NET tracer's
perspective nothing changed.

This preserves all DD signals end-to-end but adds a real production
component you now own. Treat it like the DD agent: same priorityClass,
same resource budget, liveness probes on `:8126`.

#### Option 2: profiling in agentless mode

Add to the selected Deployments:

```yaml
env:
  - name: DD_PROFILING_AGENTLESS
    value: "true"
  - name: DD_API_KEY
    valueFrom:
      secretKeyRef: { name: dd-api-key, key: key }
  - name: DD_SITE
    value: "datadoghq.com"
```

Profiles upload directly to DD intake, bypassing the local agent.
`DD_TRACE_AGENT_URL` then carries traces only and the tap architecture
works as drawn. Cost: two extra env vars per Deployment, plus an
egress / network policy review for `intake.profile.datadoghq.com`.

### Other DD signals (unaffected by `DD_TRACE_AGENT_URL`)

These travel separate transports and need no change:

- DogStatsD metrics (port 8125, controlled by `DD_DOGSTATSD_*`).
- Logs (DD agent file-tails container stdout).
- DD agent infra, kubelet, and container metrics.

### What to watch for

- `datadogreceiver` is **alpha** stability for traces. The README
  confirms preservation of `dd.span.Resource` and `_dd.span_links`.
  Fidelity for other DD-specific tags (AppSec, DBM, sampling priority)
  is not enumerated and needs empirical validation.
- Tap availability becomes load-bearing. If the tap dies, both DD and
  Scout stop receiving APM from those pods.
- Sampling is coupled. Scout sees exactly what DD's tracer ships -
  changing Scout's sample rate requires changing DD's.
- DD API key now lives in two places (DD agent and OTel tap). Manage
  via the same Kubernetes Secret to avoid drift.

Validate fidelity with a 2-3 day spike before standardizing. Instrument
one selected service, compare span attributes between DD and Scout,
document the deltas.

---

## Cross-cutting concerns

### Trace ID alignment

DD .NET tracer v2.48.0+ defaults propagation order to
`datadog,tracecontext`. Set `DD_TRACE_PROPAGATION_STYLE` explicitly to
`tracecontext,datadog` if you want W3C as the primary format - useful
when Scout-side spans need to join traces that originate in DD-only
upstream services.

### Log correlation

DD enriches log lines with `dd.trace_id` and `dd.span_id`. OTel SDK
emits `trace_id` and `span_id` (W3C). With Path A both enrichments
coexist on the log line. With B / C / D only DD's enrichment runs;
Scout-side log correlation needs either a log enrichment switch
(possible only with code change) or trace-to-log linking by
`traceparent` propagation alone.

### Sampling coupling

| Path | Sampling control |
|---|---|
| A | DD and Scout sample independently. |
| B | OTel sampling only. DD profiler is off on these pods. |
| C | Beyla sampling only. DD APM unchanged for these services. |
| D | Coupled. Scout sees what DD's tracer samples in. |

### Signals that always stay on DD's path

Regardless of which path you pick for traces, these DaemonSet-level
signals continue to flow to DD without change:

- Logs (DD agent file tail of container stdout).
- Infra metrics (kubelet, container, node).
- DogStatsD metrics (port 8125).
- DD agent internal telemetry.

---

## Verification checklist

### Path A

- Spans for the same request appear in both DD and Scout.
- Trace IDs match between DD and Scout (pivot by trace ID across UIs).
- No "duplicate exporter" warnings in app logs.

### Path B

- `kubectl exec <pod> -- env | grep CORECLR_PROFILER` shows the OTel
  CLSID, not DD's.
- Scout receives spans for those pods. DD receives no new APM spans
  for those pods.
- DD agent still receives logs and infra metrics for those pods.

### Path C

- Beyla DaemonSet pod logs show discovered .NET processes by name.
- Scout has HTTP server spans with route templates per selected
  service.
- DD APM unchanged.

### Path D

- DD APM dashboards show no regression after the redirect.
- Scout has spans with the same trace IDs as DD.
- OTel tap pod logs show non-zero accepted spans on both pipelines.
- Continuous profiler data still arriving in DD (check DD's profiling
  UI for the affected services).

---

## What this guide does not cover

- DD AppSec, IAST, DBM, RUM, or CIWS preservation through the trace
  tap (Path D). These ride trace payloads and may not survive the
  alpha receiver conversion intact. Validate before relying on them.
- Migration off Datadog. This guide is about coexistence, not exit.
- Windows containers. All paths are verified on Linux only.
- Multi-cluster federation. All paths assume a single Kubernetes
  cluster per Scout Collector instance.

## Verified against

- [Datadog .NET Tracer Configuration](https://docs.datadoghq.com/tracing/trace_collection/library_config/dotnet-core/)
- [Datadog Trace Context Propagation](https://docs.datadoghq.com/tracing/trace_collection/trace_context_propagation/)
- [Enabling the .NET Profiler - Datadog Docs](https://docs.datadoghq.com/profiler/enabling/dotnet/)
- [OpenTelemetry Collector Contrib - datadogreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/datadogreceiver)
- [OpenTelemetry Collector Contrib - datadogexporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/datadogexporter)
- [OpenTelemetry .NET Auto-Instrumentation](https://github.com/open-telemetry/opentelemetry-dotnet-instrumentation)
- [Grafana Beyla documentation](https://grafana.com/docs/beyla/latest/)
