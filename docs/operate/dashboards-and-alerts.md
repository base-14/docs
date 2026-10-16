---
date: 2025-11-19
title: Scout Dashboards and Alerts as Code with Grizzly (Archived)
description:
  Grizzly is archived and no longer maintained. Use gcx to manage Scout
  dashboards and folders as code. This page is kept for teams still running
  Grizzly.
keywords:
  [
    grafana dashboards,
    grafana alerts,
    dashboards as code,
    grizzly grafana,
    grizzly archived,
    observability automation,
  ]
---

# Grizzly with base14 Scout

:::warning[Grizzly is archived. Use gcx.]

Use [Dashboards as Code with gcx](./dashboards-as-code-gcx.md) instead.

Grizzly is frozen at v0.7.1 (January 2025). The repo is archived at
[grafana-cold-storage/grizzly](https://github.com/grafana-cold-storage/grizzly).

:::

Grizzly (`grr`) applies Grafana resources from YAML over the Grafana API, which
Scout serves. This page documents the setup for teams still running it.

## Getting Started with Grizzly

To begin using Grizzly with the Scout Observability Platform, you need to
configure it to connect to your Grafana instance hosted by Scout. This involves
setting the Grafana URL and API token.

### 1. Setting the Grafana URL

The Grafana URL for your Scout Observability Platform instance will be provided
to you during the service setup. Use the following Grizzly command to configure
it:

```bash
grr config set grafana.url <your_base14_grafana_url>
grr config set grafana.token <your_base14_grafana_api_token>
```

Replace `<your_base14_grafana_url>` with the actual URL of your Grafana
instance.

## Defining Grafana Resources with YAML

Grizzly allows you to define various Grafana resources using YAML. Here's how
you can define folders, dashboards, alerts, and contact points:

1. **Folders** - Folders help organize your dashboards. Here's an example of a YAML
   definition for a folder:

```yaml showLineNumbers
apiVersion: grizzly.grafana.com/v1alpha1
kind: DashboardFolder
metadata:
  name: sample
spec:
  title: Special Sample Folder
```

You can create multiple folder definition files (e.g., folders/production.yaml,
folders/staging.yaml, etc.). You can also use hierarchical folder structure by
using the `folder` field in the dashboard definition.

1. **Dashboards**

```yaml showLineNumbers
apiVersion: grizzly.grafana.com/v1alpha1
kind: Dashboard
metadata:
  folder: sample
  name: prod-overview
spec:
  schemaVersion: 17
  tags:
    - templated
  timezone: browser
  title: Production Overview
  uid: prod-overview
```

You can create multiple dashboard definition files in a `dashboards` directory
(e.g., dashboards/kong.yaml, dashboards/postgres.yaml, etc.)

Grizzly supports the following resources:

- DashboardFolder
- Dashboard
- LibraryElement
- AlertRuleGroup
- AlertContactPoint
- AlertNotificationPolicy
- AlertNotificationTemplate

For more details, see the
[archived Grizzly documentation](https://github.com/grafana-cold-storage/grizzly/tree/main/docs).

## Applying Your Configurations with Grizzly

Once you have defined your resources in YAML files, you can use Grizzly to apply
them to your Scout instance.

### Applying All Resources in a Directory

To apply all YAML files in a specific directory (e.g., dashboards), use the
apply command:

```bash
grr apply -f dashboards/
```

You can also apply all resources in all subdirectories:

```bash
grr apply -f .
```

### Applying a Specific Resource File

To apply a specific YAML file:

```bash
grr apply -f dashboards/application-metrics.yaml
```

### Diffing Resources

Before applying changes, it's often useful to see the differences between your
local definitions and the resources in Grafana:

```bash
grr diff -f dashboards/application-metrics.yaml
```

This will show you a detailed comparison of the local file and the corresponding
resource in your Scout instance.

## Working with Jsonnet (Brief Overview)

Jsonnet is a data templating language that can be used to generate Grafana JSON,
which Grizzly can then manage. Jsonnet offers more advanced features like
variables, functions, and imports for complex and reusable dashboard
definitions.

While YAML is generally easier to read and write for simple configurations,
Jsonnet can be beneficial for:

- Dynamic Dashboards: Generating dashboards based on variables or external data.
- Reusability: Defining dashboard components as functions and reusing them
  across multiple dashboards.
- Complex Logic: Implementing conditional logic within your dashboard
  definitions.

To use Jsonnet with Grizzly, you would typically:

- Write your dashboard definitions in .jsonnet files.
- Use the jsonnet command-line tool to compile these files into .json files.
- Use Grizzly to apply the generated .json files.

For detailed information and examples of using Jsonnet with Grafana, please
refer to the official [Jsonnet documentation](https://jsonnet.org/) and
Grafana's documentation on using Jsonnet for dashboards.

## Automation Examples

Here are examples of how you can integrate Grizzly into your automation
workflows:

### Sample Makefile

```makefile
GRAFANA_URL := <your_base14_grafana_url>
GRAFANA_TOKEN := <your_grafana_api_token>

.PHONY: apply-all
apply-all:
  grr config set grafana.url $(GRAFANA_URL)
  grr config set grafana.token $(GRAFANA_TOKEN)
  grr apply -f .

.PHONY: apply-dashboards
apply-dashboards:
  grr config set grafana.url $(GRAFANA_URL)
  grr config set grafana.token $(GRAFANA_TOKEN)
  grr apply -f dashboards/

.PHONY: diff-dashboards
diff-dashboards:
  grr config set grafana.url $(GRAFANA_URL)
  grr config set grafana.token $(GRAFANA_TOKEN)
  grr diff -f dashboards/
```

### Sample GitHub Actions Workflow

```yaml showLineNumbers
name: Apply Grafana Configuration

on:
  push:
    branches: [ main ]
    paths:
      - 'dashboards/**.yaml'
      - 'alerts/**.yaml'
      - 'folders/**.yaml'
      - 'contactpoints/**.yaml'

jobs:
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Grizzly
        run: |
          curl -L https://github.com/grafana-cold-storage/grizzly/releases/\
download/v0.7.1/grr-linux-amd64 -o grr
          chmod +x grr
          sudo mv grr /usr/local/bin/

      - name: Configure Grizzly
        run: |
          grr config set grafana.url ${{ secrets.GRAFANA_URL }}
          grr config set grafana.token ${{ secrets.GRAFANA_TOKEN }}

      - name: Apply Grafana Resources
        run: grr apply -f .
```

**In this workflow:**

- We trigger the workflow on pushes to the main branch if any YAML files in the
  specified directories are changed.
- We check out the code.
- We download and install Grizzly.
- We configure Grizzly using GitHub secrets (GRAFANA_URL and GRAFANA_TOKEN) for
  security. You'll need to define these secrets in your repository settings.
- Finally, we apply all the Grafana resources defined in the repository.

## Migrating off Grizzly

Grizzly still works, but it stops here. No new features, no fixes. Move to
[Dashboards as Code with gcx](./dashboards-as-code-gcx.md).

The manifests differ, so it is not a rename. If you are migrating a large
Grizzly repository, [contact the base14 team](mailto:support@base14.io).

## Related Guides

- [Create Your First Alert](../guides/creating-your-first-alert.md) - Build the
  same alert rules through the Scout UI
- [Getting Started Guide](../introduction.md) - Overview of Scout observability
  platform
- [Docker Compose Setup](../instrument/collector-setup/docker-compose-example.md)
  \- Local development with Grafana
- [OTel Collector Configuration](../instrument/collector-setup/otel-collector-config.md)
  \- Configure data pipelines
