---
slug: ebpf-instrumentation-go
date: 2026-02-17
title: "Zero-Code Instrumentation for Go with eBPF and OpenTelemetry"
description: "How eBPF enables automatic distributed tracing for Go applications without code changes. Covers OpenTelemetry OBI, supported libraries, Kubernetes deployment, limitations, and alternatives."
authors: [ranjan-sakalley]
tags: [opentelemetry, ebpf, go, auto-instrumentation, observability, kubernetes]
unlisted: true
---

Auto-instrumentation is well-established for Java, Python, and Node.js. Runtime
agents hook into the interpreter or bytecode layer to inject tracing, metrics,
and logging without requiring code changes. Go compiles to a static native
binary, so JVM-style bytecode patching does not apply. But Go is not without
options. Compile-time tools like Datadog's Orchestrion and Alibaba's
opentelemetry-go-auto-instrumentation can inject tracing at build time, and
eBPF provides a runtime alternative that requires no rebuild at all.

This post focuses on the eBPF approach. It attaches kernel-level probes to
running Go binaries, extracting telemetry without modifying source code,
recompiling, or restarting the process. OpenTelemetry now has two official
projects built on this mechanism. We cover how it works, how to deploy it on
Kubernetes, and where the practical limits are.

<!--truncate-->

## Why Go Is Different

Java has the JVM, Python has the interpreter, and Node.js has the V8 runtime.
Each of these provides a hook point where an agent can inject instrumentation
at startup or runtime. The application code does not need to change because the
agent operates at the runtime layer.

Go compiles directly to machine code. There is no virtual machine, no
interpreter, and no class loader. The resulting binary is a self-contained
executable. JVM-style agent injection has nothing to attach to.

This does not mean auto-instrumentation is impossible for Go. It means the
techniques are different. Two main approaches have emerged:

- **Compile-time instrumentation** uses Go's `-toolexec` flag to rewrite source
  code during the build, producing a binary with tracing baked in. Tools like
  Datadog Orchestrion and Alibaba's `opentelemetry-go-auto-instrumentation`
  are production-ready and work on any platform.
- **eBPF-based instrumentation** attaches kernel-level probes to a running
  binary, requiring no rebuild. It works only on Linux and needs elevated
  privileges, but instruments existing deployments without touching the build
  pipeline.

The rest of this post focuses on the eBPF approach.

## How eBPF Instrumentation Works

eBPF (extended Berkeley Packet Filter) allows sandboxed programs to run inside
the Linux kernel without modifying kernel source or loading kernel modules.
Originally designed for packet filtering, eBPF has evolved into a general-purpose
instrumentation framework used for networking, security, and observability.

For Go instrumentation, eBPF uses two probe types:

- **uprobes** attach to function entry points in user-space binaries. When the
  target function is called, the eBPF program executes and captures arguments,
  timestamps, and metadata.
- **uretprobes** attach to function return points, capturing return values and
  measuring duration.

The instrumentation agent reads the Go binary's symbol table to identify
supported library functions (such as `net/http.(*Transport).RoundTrip` or
`google.golang.org/grpc.(*ClientConn).Invoke`), attaches probes to those
functions, and constructs OpenTelemetry spans from the captured data. The spans
are exported via OTLP to any compatible backend.

No code changes, no recompilation, and no process restart. The probes attach
to the running binary in place.

## OpenTelemetry Projects for eBPF Instrumentation

OpenTelemetry maintains two distinct eBPF-based instrumentation projects.
Understanding the difference matters for choosing the right deployment.

### opentelemetry-go-instrumentation

This is the Go-specific project. It uses uprobes to attach directly to Go
library functions, producing traces with full semantic conventions. It
understands Go's internal data structures and calling conventions.

Supported libraries:

| Library | Signal | Notes |
|---------|--------|-------|
| `net/http` | Traces | Client and server |
| `google.golang.org/grpc` | Traces | Client and server |
| `database/sql` | Traces | Requires `QueryContext` for context propagation |
| `github.com/segmentio/kafka-go` | Traces | Producer and consumer |

Container image: `ghcr.io/open-telemetry/opentelemetry-go-instrumentation/autoinstrumentation-go`

### OBI (OpenTelemetry eBPF Instrumentation)

OBI originated as Grafana Beyla and was donated to OpenTelemetry in May 2025.
It operates at the network protocol layer rather than at the Go function level,
making it language-agnostic. OBI inspects HTTP, gRPC, SQL, Redis, Kafka, and
other protocols at the kernel level.

Because it works at the protocol layer, OBI supports any language that uses
these protocols, including Go, C, C++, Rust, and others. It can also inspect
TLS/SSL traffic without requiring decryption keys.

OBI produces both traces and RED metrics (Rate, Errors, Duration) for
HTTP and gRPC traffic. The Go-specific project currently produces traces only.

Container image: `otel/ebpf-instrument`

## Deploying on Kubernetes

The most common deployment pattern is a sidecar container running alongside
the Go application. The following example uses `opentelemetry-go-instrumentation`
as the sidecar.

### Sidecar Deployment

```yaml showLineNumbers title="deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-go-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-go-service
  template:
    metadata:
      labels:
        app: my-go-service
    spec:
      shareProcessNamespace: true
      containers:
        - name: app
          image: my-go-service:latest
          command: ["/app/server"]
          ports:
            - containerPort: 8080
        - name: auto-instrumentation
          image: ghcr.io/open-telemetry/opentelemetry-go-instrumentation/autoinstrumentation-go:latest
          securityContext:
            runAsUser: 0
            privileged: true
          env:
            - name: OTEL_GO_AUTO_TARGET_EXE
              value: "/app/server"
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://otel-collector:4318"
            - name: OTEL_SERVICE_NAME
              value: "my-go-service"
            - name: OTEL_GO_AUTO_INCLUDE_DB_STATEMENT
              value: "true"
```

Key configuration points:

- `shareProcessNamespace: true` is required. The sidecar needs to access the
  Go application's process to attach eBPF probes.
- `OTEL_GO_AUTO_TARGET_EXE` must match the exact path of the Go binary inside
  the application container.
- `runAsUser: 0` and `privileged: true` are required for eBPF probe
  installation. There is no way around this for the Go-specific project.
- `OTEL_GO_AUTO_INCLUDE_DB_STATEMENT` captures SQL query text in database
  spans. Disable this if your queries contain sensitive data.

### Kubernetes Operator Alternative

The OpenTelemetry Operator can inject the sidecar automatically using a pod
annotation:

```yaml
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-go: "true"
    instrumentation.opentelemetry.io/otel-go-auto-target-exe: "/app/server"
```

This removes the need to manage the sidecar container spec manually. The
operator handles image versions, environment variables, and security context
configuration.

## Context Propagation: The Key Caveat

eBPF instrumentation creates spans for detected library calls. However, linking
those spans into a distributed trace requires context propagation, and this is
where the "zero-code" promise has a significant qualification.

The Go-specific project uses `bpf_probe_write_user` to inject W3C `traceparent`
headers into outgoing HTTP and gRPC calls. This works for linking spans across
services. But within a service, Go code must pass `context.Context` through
function calls for child spans to connect to their parents.

The most common place this breaks is database calls:

```go
// This produces a disconnected span
rows, err := db.Query("SELECT * FROM users WHERE id = ?", id)

// This produces a properly parented span
rows, err := db.QueryContext(ctx, "SELECT * FROM users WHERE id = ?", id)
```

The difference is a single argument, but without it, database spans appear as
orphaned top-level traces instead of children of the HTTP handler span. The
same pattern applies to any library that offers both context-aware and
context-unaware variants.

For teams expecting fully automatic trace correlation with no code involvement,
this is the single most important limitation to understand upfront.

## Security Considerations

eBPF-based instrumentation requires elevated privileges that conflict with
standard Kubernetes security practices.

**What is required:**

- The sidecar runs as root (`runAsUser: 0`)
- The container needs `privileged: true` to load eBPF programs
- `shareProcessNamespace: true` gives the sidecar access to all processes in
  the pod

**What this means:**

- The sidecar has full access to the host kernel's eBPF subsystem
- It can read memory of the application container
- This configuration violates the Kubernetes Pod Security Standards restricted
  profile, and also the baseline profile

**Mitigation options:**

- Run instrumented workloads in a dedicated namespace with appropriate
  network policies and RBAC restrictions
- Use OBI or Beyla instead, which can operate with fine-grained Linux
  capabilities (`CAP_BPF`, `CAP_PERFMON`, `CAP_SYS_PTRACE`,
  `CAP_NET_RAW`, `CAP_DAC_READ_SEARCH`, `CAP_CHECKPOINT_RESTORE`)
  rather than full privileged mode
- Limit the blast radius by applying the instrumentation only to specific
  deployments rather than cluster-wide

Production teams should evaluate whether the observability benefits justify
the security posture change for their specific environment.

## Alternatives

The eBPF instrumentation landscape extends beyond the core OpenTelemetry
projects.

### Grafana Beyla

Beyla is the upstream project that OBI was forked from. Grafana continues to
maintain Beyla as a distribution that tracks the OBI codebase. Its primary
advantage is a more security-conscious deployment model, supporting
fine-grained Linux capabilities instead of requiring full privileged mode.
Beyla also has Go-specific features like goroutine lineage tracking for
context propagation in async request patterns.

### Odigos

Odigos provides an open-source control plane for eBPF-based instrumentation.
It manages the lifecycle of instrumentation agents across a Kubernetes cluster
and supports multiple languages. Full Go support requires an enterprise license.

### Compile-Time Instrumentation

A production-ready approach that sidesteps eBPF entirely. These tools use Go's
`-toolexec` flag to rewrite source code during compilation, injecting
instrumentation without manual code changes.

- **Datadog Orchestrion** (v1.8.0, February 2026): adds an `orchestrion.tool.go`
  file to your project, then instruments supported libraries automatically
  during `go build`. Works on any platform, no eBPF or Linux required.
- **Alibaba opentelemetry-go-auto-instrumentation** (v1.7.0): replaces
  `go build` with `otel go build`, performing AST manipulation to inject
  tracing. Supports 60+ libraries including Gin, Echo, gRPC, GORM, go-redis,
  and MongoDB.

Both projects have joined an official OpenTelemetry SIG for Go compile-time
instrumentation, with the goal of unifying their approaches under the
OpenTelemetry umbrella. Compile-time instrumentation eliminates the runtime
overhead and kernel dependencies of eBPF, but requires rebuilding the binary.

### Tetragon

Cilium's eBPF-based runtime security tool. Tetragon is not an instrumentation
tool, but it provides process, file, and network security signals at the kernel
level. For teams already using eBPF for observability, Tetragon adds a security
dimension that complements tracing data, such as detecting unexpected process
execution or network connections alongside the spans those processes generate.

## When to Use eBPF Instrumentation

**Good fit:**

- Existing Go services where modifying source code or the build pipeline is
  not feasible
- Quick visibility into HTTP and gRPC traffic patterns for brownfield
  deployments where rebuilding binaries is not an option
- Initial observability rollout where getting baseline traces fast matters
  more than custom span attributes

**Not ideal:**

- Applications that need custom spans, attributes, or business-specific
  telemetry, which still require manual instrumentation
- Environments with strict Pod Security Standards that prohibit privileged
  containers (consider Beyla or compile-time instrumentation instead)
- Non-Linux platforms, since eBPF is a Linux kernel feature
- Teams that control the build pipeline, where compile-time instrumentation
  (Orchestrion, Alibaba's tool) provides broader library coverage without
  kernel dependencies

**The practical approach:** eBPF instrumentation provides runtime visibility
without touching code or builds. Compile-time tools provide deeper coverage
if you can rebuild. Manual instrumentation adds the application-specific
context and business logic spans on top. These approaches complement each
other.

## Conclusion

Go's auto-instrumentation story has matured significantly. Compile-time tools
like Orchestrion and Alibaba's instrumentation provide broad library coverage
at build time, while eBPF provides runtime instrumentation without touching
code or builds. `opentelemetry-go-instrumentation` handles the most common
libraries, OBI extends coverage to the protocol layer, and Beyla offers a
more security-conscious deployment model.

For teams running Go services on Kubernetes where rebuilding is not an option,
eBPF instrumentation delivers immediate distributed tracing with a single
sidecar container. The trade-offs are real, privileged access, limited custom
attributes, context propagation requirements, but they are well-defined and
well-documented. Between eBPF, compile-time tools, and manual instrumentation,
Go teams now have a complete spectrum of options for adding observability at
whatever depth their services require.
