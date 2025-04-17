# Leveraging Grizzly with Base14 Observability Platform

Welcome to the Base14 Observability Platform! This article guides developers on how
to effectively manage their Grafana resources using Grizzly, a powerful command-line
tool that leverages the Grafana API. Since our platform is fully compatible with
the Grafana API, Grizzly integrates seamlessly, allowing you to define and deploy
your observability configurations as code.

## Why Grizzly?

Grizzly provides a declarative approach to managing Grafana resources. Instead of
manually configuring dashboards, alerts, and other elements through the Grafana UI,
you define them in human-readable YAML files. This offers several advantages:

* **Version Control:** Store your entire observability setup in Git, enabling
  collaboration, tracking changes, and easy rollbacks.
* **Automation:** Integrate Grizzly into your CI/CD pipelines for automated
  deployment of your Grafana configurations.
* **Reproducibility:** Ensure consistent environments across different stages
  (development, staging, production).
* **Efficiency:** Define and deploy multiple resources quickly and consistently.

## Getting Started with Grizzly

To begin using Grizzly with the Base14 Observability Platform, you need to configure
it to connect to your Grafana instance hosted by Base14. This involves setting the
Grafana URL and API token.

### 1. Setting the Grafana URL

The Grafana URL for your Base14 Observability Platform instance will be provided
to you during the service setup. Use the following Grizzly command to configure it:

```shell
grr config set grafana.url <your_base14_grafana_url>
grr config set grafana.token <your_base14_grafana_api_token>
```

Replace `<your_base14_grafana_url>` with the actual URL of your Grafana instance.

## Defining Grafana Resources with YAML

Grizzly allows you to define various Grafana resources using YAML. Here's how you
can define folders, dashboards, alerts, and contact points:

1. Folders
Folders help organize your dashboards. Here's an example of a YAML definition for
a folder:

```yaml
apiVersion: grizzly.grafana.com/v1alpha1
kind: DashboardFolder
metadata:
  name: sample
spec:
  title: Special Sample Folder
```

You can create multiple folder definition files (e.g., folders/production.yaml,
folders/staging.yaml, etc.). You can also use hierarchical folder structure by using
the `folder` field in the dashboard definition.

1. Dashboards

```yaml
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

Grizzly configurations allow you the following resources:

* DashboardFolder
* Dashboard
* LibraryElement
* AlertRuleGroup
* AlertContactPoint
* AlertNotificationPolicy
* AlertNotificationTemplate

For more details, see the [Grizzly documentation](https://grafana.github.io/grizzly/grafana/).

## Applying Your Configurations with Grizzly

Once you have defined your resources in YAML files, you can use Grizzly to apply
them to your Base14 Grafana instance.

### Applying All Resources in a Directory

To apply all YAML files in a specific directory (e.g., dashboards), use the apply
command:

```shell
grr apply -f dashboards/
```

You can also apply all resources in all subdirectories:

```shell
grr apply -f .
```

### Applying a Specific Resource File

To apply a specific YAML file:

```shell
grr apply -f dashboards/application-metrics.yaml
```

### Diffing Resources

Before applying changes, it's often useful to see the differences between your local
definitions and the resources in Grafana:

```shell
grr diff -f dashboards/application-metrics.yaml
```

This will show you a detailed comparison of the local file and the corresponding
resource in your Base14 Grafana instance.

## Working with Jsonnet (Brief Overview)

Jsonnet is a data templating language that can be used to generate Grafana JSON,
which Grizzly can then manage. Jsonnet offers more advanced features like variables,
functions, and imports, making it powerful for creating complex and reusable
dashboard definitions.

While YAML is generally easier to read and write for simple configurations, Jsonnet
can be beneficial for:

* Dynamic Dashboards: Generating dashboards based on variables or external data.
* Reusability: Defining dashboard components as functions and reusing them across
  multiple dashboards.
* Complex Logic: Implementing conditional logic within your dashboard definitions.

To use Jsonnet with Grizzly, you would typically:

* Write your dashboard definitions in .jsonnet files.
* Use the jsonnet command-line tool to compile these files into .json files.
* Use Grizzly to apply the generated .json files.

For detailed information and examples of using Jsonnet with Grafana, please refer
to the official [Jsonnet documentation](https://jsonnet.org/): and Grafana's
documentation on using Jsonnet for dashboards.

## Automation Examples

Here are examples of how you can integrate Grizzly into your automation workflows:

### Sample Makefile

```makefile
Makefile

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

```yaml
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
          curl -L https://github.com/grafana/grizzly/releases/latest/download/\
grizzly_linux_amd64 -o grizzly
          chmod +x grizzly
          sudo mv grizzly /usr/local/bin/

      - name: Configure Grizzly
        run: |
          grr config set grafana.url ${{ secrets.GRAFANA_URL }}
          grr config set grafana.token ${{ secrets.GRAFANA_TOKEN }}

      - name: Apply Grafana Resources
        run: grr apply -f .
```

### In this workflow

* We trigger the workflow on pushes to the main branch if any YAML files in the
  specified directories are changed.
* We check out the code.
* We download and install Grizzly.
* We configure Grizzly using GitHub secrets (GRAFANA_URL and GRAFANA_TOKEN) for
  security. You'll need to define these secrets in your repository settings.

Finally, we apply all the Grafana resources defined in the repository.

## Conclusion

Grizzly provides a powerful and efficient way to manage your Grafana resources on
the Base14 Observability Platform. By defining your configurations as code in YAML
(or using Jsonnet for more advanced scenarios), you can streamline your observability
workflows, improve consistency, and integrate seamlessly with your existing
development practices. Start leveraging Grizzly today to take full control of your
Grafana environment on Base14!
