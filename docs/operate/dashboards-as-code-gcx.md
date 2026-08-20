---
title: Scout Dashboards as Code with gcx
sidebar_label: Dashboards as Code
sidebar_position: 5
description:
  Manage Scout dashboards and folders as code using gcx. Push, pull, and
  validate dashboard definitions and automate deployment from CI/CD.
keywords:
  [
    grafana dashboards,
    dashboards as code,
    gcx,
    grafanactl,
    gitops grafana,
    observability automation,
  ]
---

# Scout Dashboards as Code with gcx

[`gcx`](https://github.com/grafana/gcx) is Grafana's command-line tool for
managing Grafana resources. Scout exposes a standard Grafana API, so you can
define dashboards and folders in files, keep them in Git, and apply them from a
pipeline.

This guide covers dashboards and folders. Alert rules are not covered: the
alerting resource API that `gcx resources` needs is not served by the Grafana
build Scout runs, so alert rules cannot be managed as code against Scout today.
Manage them in the Scout UI instead.

## Requirements

- Grafana 12.0.0 or later. `gcx` refuses to run against earlier versions. Scout
  meets this requirement.
- A Grafana service account token with the Editor or Admin role. Create one in
  Scout under **Administration > Service accounts**.
- Your Scout URL, provided during service setup.

## Installing gcx

On macOS:

```bash
brew install --formula gcx
```

On Linux, download a release binary. Pin the version rather than tracking
latest, so pipelines stay reproducible:

```bash
GCX_VERSION=1.1.0
curl -sL https://github.com/grafana/gcx/releases/download/v${GCX_VERSION}/\
gcx_${GCX_VERSION}_linux_amd64.tar.gz | tar xz gcx
sudo mv gcx /usr/local/bin/
```

Confirm the install:

```bash
gcx --version
```

## Connecting gcx to Scout

`gcx` uses a configuration model similar to `kubectl`. A **stack** holds the
server address and credentials. A **context** points at a stack and is the
thing commands run against. Configuration is stored in
`~/.config/gcx/config.yaml`.

Create a stack and a context for your Scout instance:

```bash
gcx config set stacks.scout.grafana.server <your_base14_grafana_url>
gcx config set stacks.scout.grafana.token <your_base14_grafana_api_token>
gcx config set stacks.scout.grafana.org-id 1
gcx config set contexts.scout.stack scout
gcx config use-context scout
```

`org-id` is required for self-hosted Grafana and identifies the organization
the API calls apply to. The default organization is `1`. To find another, open
**Administration > Organizations** in Scout and read the numeric ID from the
URL.

Verify the connection:

```bash
gcx config check
```

A working context reports valid configuration, online connectivity, and the
Grafana version:

```text
Context: scout
==============
✔ Configuration: valid
🛈 Auth method: token (inferred)
🛈 Context type: On-prem
✔ Connectivity: online
✔ Grafana version: 12.4.1
```

## Defining folders and dashboards

`gcx` reads resource definitions from a directory, `./resources` by default.
Each file uses the Grafana resource API format: an `apiVersion`, a `kind`,
`metadata`, and a `spec`.

Folders organize dashboards:

```yaml showLineNumbers title="resources/folder.yaml"
apiVersion: folder.grafana.app/v1beta1
kind: Folder
metadata:
  name: sample
spec:
  title: Special Sample Folder
```

`metadata.name` is the folder UID. `spec.title` is the display name.

Dashboards reference their folder through an annotation:

```yaml showLineNumbers title="resources/dashboard.yaml"
apiVersion: dashboard.grafana.app/v1beta1
kind: Dashboard
metadata:
  name: prod-overview
  annotations:
    grafana.app/folder: sample
spec:
  title: Production Overview
  tags:
    - templated
  timezone: browser
  schemaVersion: 41
```

`metadata.name` is the dashboard UID. Everything under `spec` is the dashboard
JSON model, so panels, templating, and annotations go there.

To see the resource types your Scout instance serves:

```bash
gcx resources list-types
```

## Pushing, validating, and pulling

### Validate before applying

`validate` checks local files against the schemas your instance serves, without
writing anything:

```bash
gcx resources validate -p ./resources
```

```text
✔ No errors found.
```

`--dry-run` simulates the write itself:

```bash
gcx resources push -p ./resources --dry-run
```

A dashboard whose folder does not exist yet fails dry-run, because the folder
is not created during a simulated push. This is expected on a first run.

### Apply

Push everything in the directory:

```bash
gcx resources push -p ./resources
```

```text
✔ 2 resources pushed, 0 errors
```

Push a single kind, or named resources within a kind:

```bash
gcx resources push dashboards -p ./resources
gcx resources push dashboards/prod-overview -p ./resources
```

### Export existing resources

`pull` writes what is in Scout to disk, which is how you bring dashboards built
in the UI under version control.

Always name the resource kinds you want:

```bash
gcx resources pull dashboards folders -p ./resources
```

```text
✔ 2 resources pulled, 0 errors
```

:::warning[Always scope a pull]

A bare `gcx resources pull` attempts every resource type `gcx` knows about,
including Grafana Cloud services that Scout does not run. It reports dozens of
errors that are not problems with your setup. Naming the kinds avoids this.

:::

Pulled files are written into one directory per kind, for example
`resources/dashboards.v1beta1.dashboard.grafana.app/prod-overview.yaml`.

### Inspect

List what is currently in Scout:

```bash
gcx resources get dashboards
```

```text
KIND        GROUP                   NAME
Dashboard   dashboard.grafana.app   prod-overview
```

## Automating with CI/CD

In a pipeline, skip the config file and pass connection details as environment
variables. They apply at runtime and need no `gcx config` commands:

| Variable | Description |
| --- | --- |
| `GRAFANA_SERVER` | Scout URL. |
| `GRAFANA_TOKEN` | Service account token. |
| `GRAFANA_ORG_ID` | Organization ID, `1` by default. |

### Sample Makefile

```makefile
export GRAFANA_SERVER := <your_base14_grafana_url>
export GRAFANA_TOKEN := <your_grafana_api_token>
export GRAFANA_ORG_ID := 1

.PHONY: validate
validate:
 gcx resources validate -p ./resources

.PHONY: apply
apply:
 gcx resources push -p ./resources

.PHONY: pull
pull:
 gcx resources pull dashboards folders -p ./resources
```

### Sample GitHub Actions workflow

```yaml showLineNumbers
name: Apply Grafana Configuration

on:
  push:
    branches: [main]
    paths:
      - 'resources/**.yaml'

jobs:
  apply:
    runs-on: ubuntu-latest
    env:
      GRAFANA_SERVER: ${{ secrets.GRAFANA_SERVER }}
      GRAFANA_TOKEN: ${{ secrets.GRAFANA_TOKEN }}
      GRAFANA_ORG_ID: '1'
    steps:
      - uses: actions/checkout@v4

      - name: Install gcx
        run: |
          GCX_VERSION=1.1.0
          curl -sL https://github.com/grafana/gcx/releases/download/\
v${GCX_VERSION}/gcx_${GCX_VERSION}_linux_amd64.tar.gz | tar xz gcx
          sudo mv gcx /usr/local/bin/

      - name: Validate resources
        run: gcx resources validate -p ./resources

      - name: Push resources
        run: gcx resources push -p ./resources
```

Store `GRAFANA_SERVER` and `GRAFANA_TOKEN` as repository secrets. Run the same
`validate` step on pull requests to catch broken definitions before merge.

## A note on Jsonnet

The Jsonnet workflow used with Grizzly does not carry over. `gcx` has no Jsonnet
integration. Its programmatic path is Go, using the
[Grafana Foundation SDK](https://grafana.github.io/grafana-foundation-sdk/)
through `gcx dev scaffold` and `gcx dev import`, which generate and compile
builder code rather than templating YAML.

If you generate dashboard JSON with Jsonnet today, you can keep doing so and
wrap the output in the `spec` of a `Dashboard` resource before pushing it.

## Related Guides

- [GitOps for Dashboards and Alerts](./dashboards-and-alerts.md) - The earlier
  Grizzly-based guide, kept for reference
- [User Management](./user-management.md) - Roles and service accounts
- [Create Dashboards](../guides/create-your-first-dashboard.md) - Build
  dashboards in the Scout UI
