---
title: scout config test
sidebar_label: config test
sidebar_position: 3
description:
  Live-test an OpenTelemetry Collector configuration by spawning a collector,
  injecting debug components, and sending OTLP probes to verify each pipeline.
keywords:
  - otel config test
  - opentelemetry collector test
  - config validation
  - scout config test
  - otel pipeline test
---

# scout config test

Live-test an OpenTelemetry Collector configuration by patching it with debug
components, spawning a local collector, and sending OTLP probes to verify each
pipeline works end-to-end.

![scout config test demo](/img/scout-cli/11-config-test.gif)

## Usage

```bash
scout config test [flags]
```

You can also pipe a config via stdin:

```bash
cat otel-collector.yaml | scout config test
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--file` | path | — | Path to the OTel config file. Reads from stdin if omitted |
| `--dry-run` | bool | `false` | Show patched config without running the collector |
| `--raw` | bool | `false` | Output JSON (patched config in dry-run, lifecycle result in live mode) |
| `--isolated` | bool | `false` | Remove non-debug exporters from pipelines |
| `--collector-bin` | path | — | Path to the OTel Collector binary. Auto-detects if not set |
| `--startup-timeout` | seconds | `15` | Max seconds to wait for collector health check |
| `--timeout` | seconds | `30` | Max seconds for the full test session |
| `--interactive` | bool | `false` | Keep collector running after probes; show zpages/pprof URLs |

## Examples

Test a config file:

```bash
scout config test --file otel-collector-config.yaml
```

Preview the patched config without running the collector:

```bash
scout config test --file otel-collector-config.yaml --dry-run
```

Run in isolated mode (removes production exporters):

```bash
scout config test --file otel-collector-config.yaml --isolated
```

Use a specific collector binary:

```bash
scout config test --file otel-collector-config.yaml --collector-bin /usr/local/bin/otelcol-contrib
```

Keep the collector running for manual inspection:

```bash
scout config test --file otel-collector-config.yaml --interactive
```

Increase timeouts for slow environments:

```bash
scout config test --file otel-collector-config.yaml --startup-timeout 30 --timeout 60
```

## How It Works

1. **Validates** the configuration (exits with code 2 if invalid)
2. **Patches** the config with a debug exporter and extensions (zpages, pprof)
3. **Starts** the OTel Collector binary (exits with code 3 on failure)
4. **Waits** for the health check endpoint (polls every 500ms)
5. **Sends** OTLP probes for each configured pipeline (traces, metrics, logs)
6. **Monitors** the debug exporter output for probe data
7. **Reports** per-pipeline pass/fail verdicts
8. **Exits** with the appropriate code

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All pipelines passed |
| `1` | One or more pipelines failed or partially passed |
| `2` | Configuration validation errors |
| `3` | Collector failed to start |
| `4` | No OTel Collector binary found |

## Collector Binary Detection

If `--collector-bin` is not specified, the command searches for a collector
binary in this order:

1. `otelcol-contrib` in `$PATH`
2. `otelcol` in `$PATH`
3. `~/.scout/bin/` directory

:::warning
The `--isolated` flag removes all non-debug exporters from pipelines. This
prevents the test from sending data to production backends, but the patched
config won't match your actual deployment.
:::

:::tip
Use `--interactive` to keep the collector running after probes complete. This
gives you access to zpages and pprof endpoints for debugging.
:::

## See Also

- [config validate](./config-validate.md) — validate a configuration file
- [config init](./config-init.md) — generate a configuration file
