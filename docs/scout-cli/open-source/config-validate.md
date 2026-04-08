---
title: scout config validate
sidebar_label: config validate
sidebar_position: 1
description:
  Validate an OpenTelemetry Collector YAML configuration file offline. Checks
  YAML syntax, component registry, pipeline references, and best practices.
keywords:
  - otel config validate
  - opentelemetry collector config
  - yaml validation
  - otel collector validate
  - scout config validate
---

# scout config validate

Validate an OpenTelemetry Collector YAML configuration file without needing a
running collector or Scout backend. Checks structure, component names, pipeline
references, and best practices.

![scout config validate demo](/img/scout-cli/09-config-validate.gif)

## Usage

```bash
scout config validate [flags]
```

You can also pipe a config via stdin:

```bash
cat otel-collector.yaml | scout config validate
```

## Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--file` | path | — | Path to the YAML config file. Reads from stdin if omitted |
| `--raw` | bool | `false` | Output structured JSON instead of human-readable text |

## Examples

Validate a config file:

```bash
scout config validate --file otel-collector-config.yaml
```

Validate from stdin:

```bash
cat otel-collector-config.yaml | scout config validate
```

Output structured JSON for CI integration:

```bash
scout config validate --file otel-collector-config.yaml --raw
```

## Validation Stages

The validator checks your configuration in five stages:

1. **YAML parsing** — syntax correctness
2. **Top-level structure** — required sections (`service`, `pipelines`,
   components)
3. **Component names** — checked against the otelcol-contrib registry
   (v0.111.0)
4. **Cross-reference integrity** — pipeline references match defined components
5. **Best practices** — unused components, missing health check extensions

Errors fail validation. Warnings are reported but don't affect the exit code.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Valid configuration (warnings allowed) |
| `1` | Validation errors found |
| `2` | I/O or usage error (file not found, no input) |

:::tip
Use exit codes in CI pipelines to gate deployments on valid configurations:

```bash
scout config validate --file otel-collector-config.yaml || exit 1
```

:::

## See Also

- [config init](./config-init.md) — generate a configuration file
- [config test](./config-test.md) — live-test a configuration
