---
slug: stop-deploying-broken-otel-configs
date: 2026-04-08
title: "Stop Deploying Broken OTel Configs: Validate & Test Before You Ship"
description: "OpenTelemetry Collector configs are plain YAML with no schema enforcement. Typos, missing references, and insecure patterns silently break telemetry. Here's how to validate and live-test them before deployment."
authors: [nitin]
tags:
  [
    opentelemetry,
    observability,
    otel-collector,
    configuration,
    validation,
    testing,
    scout,
    devops,
    ci-cd,
  ]
unlisted: true
head:
  - - script
    - type: application/ld+json
    - |
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Why doesn't the OpenTelemetry Collector catch config errors at startup?","acceptedAnswer":{"@type":"Answer","text":"The collector validates YAML syntax and known component types, but it won't catch semantic issues like a send_batch_max_size smaller than send_batch_size, a memory limiter with check_interval set to 0, or hardcoded secrets. These configs parse correctly but cause silent failures in production."}},{"@type":"Question","name":"What does scout config validate check that otelcol validate does not?","acceptedAnswer":{"@type":"Answer","text":"scout config validate runs a 6 stage pipeline: YAML parsing, top-level structure, component name registry checks against otelcol-contrib v0.147.0, cross-reference integrity, semantic correctness (contradictory values, disabled components), and best-practice and security checks (processor ordering, missing memory limiters, hardcoded secrets, missing TLS)."}},{"@type":"Question","name":"What does scout config test do?","acceptedAnswer":{"@type":"Answer","text":"scout config test live-tests your OTel Collector config by spawning an actual collector, patching it with debug components, and sending OTLP probes to verify each pipeline works end-to-end. It reports per-pipeline pass/fail verdicts for traces, metrics, and logs."}},{"@type":"Question","name":"How is scout config test different from scout config validate?","acceptedAnswer":{"@type":"Answer","text":"scout config validate is static analysis that runs offline without a collector binary. scout config test is dynamic — it starts a real collector, sends test data through each pipeline, and confirms data flows end-to-end. Validate catches config errors; test catches runtime failures."}},{"@type":"Question","name":"How do I integrate OTel config validation and testing into CI/CD?","acceptedAnswer":{"@type":"Answer","text":"Both commands use pipe-friendly exit codes. Run scout config validate first (fast, no binary needed) to catch config errors, then scout config test --isolated (requires collector binary) to verify pipelines. Add them as GitHub Actions steps, pre-commit hooks, or pipe generated configs through stdin."}},{"@type":"Question","name":"What are the most common OpenTelemetry Collector misconfigurations?","acceptedAnswer":{"@type":"Answer","text":"The most common issues include misspelled component names (the collector silently ignores them), pipelines referencing undefined components, missing memory_limiter processors (leading to OOM kills), hardcoded API keys, and processors in the wrong order (e.g., filter after batch, which wastes resources)."}},{"@type":"Question","name":"Does scout config validate require an account or network access?","acceptedAnswer":{"@type":"Answer","text":"No. The validation runs entirely on your machine with no telemetry sent anywhere. The otelcol-contrib component registry is bundled locally. Install with brew install base14/tap/scout-cli."}}]}
---

OpenTelemetry Collector configurations are YAML files. There's no
schema, no type system, and no IDE that will tell you that
`tail_smapling` isn't a real processor. You find out when your pipeline
goes dark and someone starts paging the on-call.

The collector ships with `otelcol validate`, which catches syntax errors
and fails on unknown component types. That covers a slice of the
problem. It won't tell you that your `send_batch_max_size` is smaller
than your `send_batch_size`, that your memory limiter is effectively
disabled, or that you've hardcoded an API key in plain text.

<!--truncate-->

Scout CLI addresses all of these with two complementary commands.
`scout config validate` runs a 6-stage static analysis pipeline
offline against the otelcol-contrib component registry. It validates
structure, component names, pipeline references, semantic correctness,
and security anti-patterns in a single command. `scout config test`
goes further — it spawns an actual collector, sends OTLP probes
through each pipeline, and confirms data flows end-to-end.
Together they catch both configuration errors and runtime failures
before deployment.

## See it in action

<img
  src="/img/scout-cli/14-config-validate-test.gif"
  alt="scout config validate and scout config test demo"
  style={{minWidth: '900px', maxWidth: '100%'}}
/>

## The 6 stage validation pipeline

<img
  src={require('./scout-config-validate.png').default}
  alt="Scout Config Validation Stages"
  
/>

The validation runs as a 6 stage pipeline. Each stage builds on the
results of the previous one, and here's what each stage catches. Later
stages are skipped if earlier ones produce errors, which avoids
cascading false positives.

### Stage 1: Parse

YAML syntax validation. Catches malformed YAML, duplicate keys, empty
input, and multi-document files. Errors include line and column numbers.

A duplicate key is easy to introduce when copying blocks between
configs:

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  batch:
    send_batch_size: 512
  # error-line
  batch:              # duplicate key, silently overwrites the first
    send_batch_size: 1024
```

```text
[ERROR] line 4, col 3: duplicated key: "batch"
```

YAML parsers in most languages silently take the last value. Your
carefully tuned batch size disappears without a trace.

### Stage 2: Structure

Validates the shape of the config. Checks for required top-level keys
(`service`, `service.pipelines`) and ensures each pipeline declares
both `receivers` and `exporters`.

```yaml showLineNumbers title="otel-collector-config.yaml"
service:
  pipelines:
    # error-line
    traces:
      processors: [batch]
      exporters: [otlp]
      # forgot receivers
```

```text
[ERROR] service.pipelines.traces: pipeline "traces" is missing required key: "receivers"
```

### Stage 3: Components

Every component definition is checked against the otelcol-contrib
registry, which includes 180+ receivers, 50+ processors,
and 70+ exporters. The match is underscore-insensitive, so
`memory_limiter` and `memorylimiter` both resolve correctly.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  # warning-line
  tail_smapling:        # typo
    decision_wait: 10s
    num_traces: 100
```

```text
[WARN] processors: "tail_smapling" is not a known otelcol-contrib component
```

This is one of the most common config mistakes. The collector loads the
config without complaint, the processor does nothing, and your pipeline
runs without tail-based sampling.

### Stage 4: Cross-references

Verifies that every component referenced in a pipeline is actually
defined, and flags components that are defined but never used.

```yaml showLineNumbers title="otel-collector-config.yaml"
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

exporters:
  otlphttp:
    endpoint: https://otel.example.com

service:
  pipelines:
    traces:
      receivers: [otlp]
      # error-line
      processors: [batch]        # not defined above
      exporters: [otlphttp]
```

```text
[ERROR] service.pipelines.traces: references undefined processor "batch"
```

A missing definition is an instant collector startup failure. Catching
it before deployment saves you a rollback.

### Stage 5: Semantic

This is where the validator goes beyond what syntax and structure can
catch. It validates that configuration values are internally consistent.

```yaml showLineNumbers title="otel-collector-config.yaml"
processors:
  batch:
    send_batch_size: 1000
    # error-line
    send_batch_max_size: 500    # max < size
  memory_limiter:
    # error-line
    check_interval: 0s          # effectively disabled
    limit_mib: 512
```

```text
[ERROR] processors.batch: send_batch_max_size (500) < send_batch_size (1000)
[ERROR] processors.memory_limiter: check_interval is 0 or unset; memory limiter is effectively disabled
```

Other semantic checks include:

- `spike_limit_mib` >= `limit_mib` (soft limit becomes zero or
  negative)
- OTLP gRPC exporters with `http://` scheme (should be bare
  `host:port` or `https://`)
- Circular pipeline dependencies via connectors (detected with DFS
  cycle tracking)

These are the bugs that pass syntax validation, survive code review,
and cause incidents in production.

### Stage 6: Best practices and security

This stage only produces warnings, and only runs when the config has
zero errors. It covers two categories.

**Best-practice warnings** check pipeline topology:

```yaml showLineNumbers title="otel-collector-config.yaml"
service:
  pipelines:
    traces:
      receivers: [otlp]
      # warning-line
      processors: [batch, filter]    # filter after batch
      exporters: [otlphttp]
```

```text
[WARN] service.pipelines.traces: filter after batch wastes resources; filter before batching
```

The validator knows that filtering after batching means you've already
spent CPU and memory grouping data you're about to throw away. It also
checks for:

- Missing `memory_limiter` in a pipeline (OOM risk)
- `memory_limiter` not first in the processor chain
- Missing `batch` processor (performance)
- Missing `health_check` extension (no liveness probe for
  orchestrators)
- `debug` exporter still present (not for production)
- Deprecated fields like `ballast_size_mib`
- Exporters without `sending_queue` or `retry_on_failure`
- `tail_sampling` after `batch` (splits traces across batches)

**Security warnings** scan for configuration anti-patterns:

```yaml showLineNumbers title="otel-collector-config.yaml"
exporters:
  otlphttp:
    endpoint: https://otel.example.com
    headers:
      # warning-line
      authorization: "Bearer sk-live-abc123def456"
```

```text
[WARN] exporters.otlphttp: "authorization" appears to contain a hardcoded secret; use ${env:VAR_NAME} instead
```

The detector scans for field names containing `api_key`, `token`,
`secret`, `password`, `credential`, `private_key`, and several others.
It accepts `${env:VAR_NAME}` patterns as safe.

Other security checks:

- TLS `min_version` below 1.2
- `insecure_skip_verify` enabled on exporters
- Receivers binding to `0.0.0.0` without TLS
- Non-localhost receiver endpoints without TLS configured

### What the output looks like

For valid configs, the validator renders a swimlane diagram of your
pipeline topology:

```text
Scout CLI v0.7.1 — validating against otelcol-contrib v0.147.0

traces
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ RECEIVERS    │──▶   │ PROCESSORS   │──▶   │ EXPORTERS    │
├──────────────┤      ├──────────────┤      ├──────────────┤
│  otlp        │      │  batch       │      │  otlphttp    │
└──────────────┘      └──────────────┘      └──────────────┘
✔ No findings for this pipeline

─────────────────────────────────────
0 errors · 0 warnings · Config is valid
```

When there are findings, they appear inline under the relevant pipeline
with context.

For CI and scripting, `--raw` outputs structured JSON:

```json title="validation.json"
{
  "meta": {
    "scout_version": "0.7.1",
    "otelcol_contrib_version": "0.147.0"
  },
  "summary": {
    "valid": false,
    "error_count": 1,
    "warn_count": 2
  },
  "findings": [
    {
      "severity": "ERROR",
      "rule": "batch-max-less-than-size",
      "path": "processors.batch",
      "message": "send_batch_max_size (500) < send_batch_size (1000)"
    }
  ]
}
```

## Live pipeline testing with scout config test

Static validation catches a wide range of config errors, but it cannot
confirm that data actually flows through your pipelines. A config can
pass all six validation stages and still fail at runtime — the
collector binary might not support a component, a network path might
be unreachable, or a processor chain might silently drop data.

`scout config test` fills this gap. It spawns an actual OTel Collector
with your config, sends test data through each pipeline, and verifies
the data comes out the other end.

### How it works

1. **Validates** the configuration (exits early if invalid)
2. **Patches** the config with a debug exporter and extensions
   (zpages, pprof)
3. **Starts** the OTel Collector binary with the patched config
4. **Waits** for the health check endpoint
5. **Sends** OTLP probes for each configured pipeline (traces,
   metrics, logs)
6. **Monitors** the debug exporter output for probe data
7. **Reports** per-pipeline pass/fail verdicts
8. **Exits** with the appropriate code

The patching step is key. The command injects a debug exporter into
every pipeline so it can observe what comes out without interfering
with your existing pipeline structure. Use `--dry-run` to preview the
patched config without starting the collector:

```bash
scout config test --file otel-collector-config.yaml --dry-run
```

### Safe testing with --isolated

The `--isolated` flag removes all non-debug exporters from your
pipelines. This prevents the test from sending probe data to
production backends — useful when testing against a config that
exports to a live endpoint:

```bash
scout config test --file otel-collector-config.yaml --isolated
```

### Interactive debugging

The `--interactive` flag keeps the collector running after probes
complete. This gives you access to zpages and pprof endpoints for
manual inspection:

```bash
scout config test --file otel-collector-config.yaml --interactive
```

### What the output looks like

When all pipelines pass, the output shows per-pipeline verdicts:

```text
Scout CLI v0.7.1 — testing against otelcol-contrib v0.147.0

Starting collector... ✔ healthy (1.2s)

traces
  ✔ sent probe → debug exporter received probe data

metrics
  ✔ sent probe → debug exporter received probe data

logs
  ✔ sent probe → debug exporter received probe data

─────────────────────────────────────
3/3 pipelines passed · All pipelines working
```

When a pipeline fails, the output identifies which one and why:

```text
Scout CLI v0.7.1 — testing against otelcol-contrib v0.147.0

Starting collector... ✔ healthy (1.4s)

traces
  ✔ sent probe → debug exporter received probe data

metrics
  ✗ sent probe → no data received within timeout

logs
  ✔ sent probe → debug exporter received probe data

─────────────────────────────────────
2/3 pipelines passed · 1 pipeline failed
```

For CI and scripting, `--raw` outputs structured JSON with the full
lifecycle result, including per-pipeline verdicts and timing.

The test command requires an OTel Collector binary. It searches for
`otelcol-contrib` or `otelcol` in your `$PATH`, or in
`~/.scout/bin/`. You can also specify a binary explicitly with
`--collector-bin`.

## CI integration

Both commands read from `--file` or stdin, so they fit into any
pipeline. Run validation first (fast, no binary needed), then
testing (requires a collector binary).

**GitHub Actions:**

```yaml title=".github/workflows/validate-otel.yml"
- name: Validate OTel Collector config
  run: |
    scout config validate --file otel-collector-config.yaml

- name: Test OTel Collector pipelines
  run: |
    scout config test --file otel-collector-config.yaml --isolated --timeout 60
```

For machine-readable output in a larger workflow:

```yaml title=".github/workflows/validate-otel.yml"
- name: Validate OTel config (JSON)
  run: |
    scout config validate --file otel-collector-config.yaml --raw > validation.json
    if [ $? -ne 0 ]; then
      echo "::error::OTel config validation failed"
      cat validation.json | jq '.findings[] | "\(.severity): \(.message)"'
      exit 1
    fi
```

**Pre-commit hook:**

```bash title=".git/hooks/pre-commit"
#!/bin/sh
for f in $(git diff --cached --name-only -- '*.yaml' '*.yml'); do
  if head -5 "$f" | grep -q 'receivers\|exporters\|service'; then
    scout config validate --file "$f" || exit 1
  fi
done
```

**Pipe from stdin:**

```bash
cat otel-collector-config.yaml | scout config validate
```

This works with config generation tools that write to stdout. Generate
your config, pipe it through validation, and only write the file if it
passes.

## Exit codes

Both commands use exit codes designed for scripting.

**scout config validate:**

| Code | Meaning |
|------|---------|
| 0 | Valid (warnings are fine) |
| 1 | Validation errors found |
| 2 | I/O or usage error (file not found, no input) |

**scout config test:**

| Code | Meaning |
|------|---------|
| 0 | All pipelines passed |
| 1 | One or more pipelines failed or partially passed |
| 2 | Configuration validation errors |
| 3 | Collector failed to start |
| 4 | No OTel Collector binary found |

The collector is the narrowest point in your telemetry pipeline.
Everything flows through it. A broken config doesn't just lose data,
it blinds you to the problems that data was supposed to reveal.
Validating and testing configs before they reach production is the
cheapest fix for a class of incidents that are expensive to diagnose
after the fact. Validate catches the structural and semantic errors.
Test confirms the pipelines actually work.

---

**Try it.** Install Scout CLI with the
[installation guide](https://docs.base14.io/scout-cli/installation/),
then run `scout config validate --file your-config.yaml` to check for
errors and `scout config test --file your-config.yaml` to verify your
pipelines work end-to-end.

---

## Related reading

- [Production-Ready OpenTelemetry: Configure, Harden, and Debug Your
  Collector][prod-ready] covers the runtime hardening that complements
  pre-deploy validation
- [scout config validate reference][config-validate-docs] is the full
  command reference for static validation
- [scout config test reference][config-test-docs] is the full command
  reference for live pipeline testing

[prod-ready]: /blog/production-ready-otel-collector
[config-validate-docs]: /scout-cli/otel-config/config-validate
[config-test-docs]: /scout-cli/otel-config/config-test
