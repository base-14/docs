---
title: Build Dashboards and Alerts with Jsonnet
sidebar_label: Dashboards with Jsonnet
sidebar_position: 7
description:
  Generate Scout dashboards and alert rules from Jsonnet with
  scout-jsonnet-libs. A complete example repository that tests dashboards in
  a GitOps Developer Workspace and deploys dashboards and alerts from CI.
keywords:
  [
    jsonnet dashboards,
    scout-jsonnet-libs,
    dashboards as code,
    gitops developer workspace,
    clickhouse dashboards,
    alerts as code,
    gcx,
  ]
---

# Build Dashboards and Alerts with Jsonnet

[scout-jsonnet-libs](https://github.com/base-14/scout-jsonnet-libs) is a
Jsonnet library for generating Scout dashboards and alert rules. It writes
the ClickHouse
queries for you, so the mistakes that produce empty or misleading panels
without any error are handled once, in the library:

- **Counters** are turned into per-interval rates, with each series' first
  bucket dropped and counter resets clamped, instead of a smooth rising line.
- **Attributes** are read from the right place. OpenTelemetry stores some keys
  as resource attributes and others as datapoint attributes, and reading the
  wrong one returns nothing.
- **Environment scoping** comes from one scope object, so no query can forget
  its environment filter.

This guide builds a complete dashboards repository with it. You test each
dashboard in your
[GitOps Developer Workspace](./gitops-workspaces.md), then a pipeline deploys
it with gcx. The example dashboard shows CPU, memory, and network for every
Kubernetes pod, with an Environment dropdown. The example alert fires for any
pod using more than 2 GiB of memory. Both work on any Scout that collects
kubelet metrics.

## Before you start

- [go-jsonnet](https://github.com/google/go-jsonnet) 0.20.0. Use the Go
  implementation: other implementations format numbers differently, so two
  people would render different files.
- [jsonnet-bundler](https://github.com/jsonnet-bundler/jsonnet-bundler) (`jb`).
- [Scout CLI](../scout-cli/installation.md) 0.14.0 or later, and an active
  [GitOps Developer Workspace](./gitops-workspaces.md#before-you-start).
- `curl` and [jq](https://jqlang.org/), to check and deploy alert rules.

On macOS:

```bash
brew install go-jsonnet jsonnet-bundler jq
```

## The repository

```text
scout-dashboards/
├── jsonnetfile.json            # library version
├── jsonnetfile.lock.json
├── lib/
│   └── scope.libsonnet         # datasource, database, environment scope
├── dashboards/
│   ├── all.libsonnet           # the list of dashboards
│   └── pod-resources.libsonnet # one dashboard template
├── alerts/
│   ├── all.libsonnet           # the list of alert templates
│   └── pod-memory.libsonnet    # one alert template
├── workspace.jsonnet           # render dashboards for your workspace
├── deploy.jsonnet              # render dashboards for the pipeline
├── alerts.jsonnet              # render alert rule groups for the pipeline
├── Makefile
└── .github/workflows/dashboards.yml
```

Each dashboard and alert is written once, as a template. Render files turn
the templates into output for each destination:

| Render | Output | Used by |
| --- | --- | --- |
| `workspace.jsonnet` | Plain dashboard JSON, with your username in each `uid` and title | `scout gitops push` |
| `deploy.jsonnet` | Scout resource manifests for a folder and its dashboards | `gcx resources push` in CI |
| `alerts.jsonnet` | One alert rule group per template | Scout's alert rule API, from CI |

The username prefix keeps your test copy from colliding with the deployed
dashboard. Without it, both would share a `uid`, and pushing to your workspace
would be rejected with `403 Access denied to save dashboard`.

## Install the library

```bash
mkdir scout-dashboards && cd scout-dashboards
jb init
jb install github.com/base-14/scout-jsonnet-libs@v0.3.5
```

This writes `jsonnetfile.json` and `jsonnetfile.lock.json` and downloads the
library into `vendor/`. Commit the two `jsonnetfile` files and add `vendor/`
to `.gitignore`; `jb install` restores it from the lock file.

The library is pre-release, and its API can change between versions. Pin a
tag, as above, rather than `main`, and upgrade deliberately.

## Point it at your data

Your dashboards need two values from your Scout: the uid of its ClickHouse
datasource and the database your telemetry is stored in. To find them, open
any dashboard in Scout, choose **Export > Export as JSON**, and look at a
panel target:

```json
"datasource": { "type": "vertamedia-clickhouse-datasource", "uid": "ds-scout-altinity-ch" },
"database": "acme"
```

Put them in the scope file:

```jsonnet showLineNumbers title="lib/scope.libsonnet"
// Where this repository's dashboards read from. Every template gets its
// environment filter and dropdowns from this scope, never from its own SQL.
local profiles = import 'github.com/base-14/scout-jsonnet-libs/identity/profiles/init.libsonnet';
local scopes = import 'github.com/base-14/scout-jsonnet-libs/identity/scopes.libsonnet';

{
  database: 'acme',
  datasourceUid: 'ds-scout-altinity-ch',

  // One dashboard with an Environment dropdown. The dropdown lists the
  // environments that emit the probe metric.
  scope: scopes.browse(
    {
      database: $.database,
      datasourceUid: $.datasourceUid,
      envPrefixes: [],
    },
    probeMetric='k8s.pod.memory.working_set',
    profile=profiles.environmentOnly,
  ),

  // Alerts cannot use a dashboard dropdown, so each alert is pinned to one
  // environment.
  alertScope: scopes.scoped(
    {
      database: $.database,
      datasourceUid: $.datasourceUid,
      envLabel: 'production',
      environment: 'production',
      tenant: null,
    },
    profile=profiles.environmentOnly,
  ),
}
```

`scopes.browse` produces one dashboard with an Environment dropdown, built
from the `environment` resource attribute. The probe metric is the gauge
metric the dropdown lists environments from; choose one that every
environment you care about emits.

`scopes.scoped` pins queries to a single environment, which is what an alert
rule needs: it runs in the background, where there is no dropdown to choose
from. Set `envLabel` and `environment` to the value of the `environment`
attribute your production telemetry carries.

`profiles.environmentOnly` suits telemetry with a single `environment`
attribute. If your telemetry carries a separate tenant, see the library's
[identity profiles](https://github.com/base-14/scout-jsonnet-libs#identity-profiles).

## Write a dashboard

A template is an object with a `name`, a `title`, and a `build` function that
takes the scope and returns a dashboard:

```jsonnet showLineNumbers title="dashboards/pod-resources.libsonnet"
local p = import 'github.com/base-14/scout-jsonnet-libs/core/panels.libsonnet';
local ch = import 'github.com/base-14/scout-jsonnet-libs/core/sql.libsonnet';

{
  name: 'pod-resources',
  title: 'Pod Resources',

  build(scope)::
    local s = scope;
    local pod = ch.seriesKey([ch.dim('k8s.namespace.name'), ch.dim('k8s.pod.name')]);

    // A gauge: one value per interval per pod.
    local gauge(metric, alias) =
      p.target(
        s.datasourceUid,
        s.database,
        ch.tables.gauge,
        ch.timeSeriesQuery(
          s.database,
          ch.tables.gauge,
          metric,
          'max(Value)',
          alias,
          ch.metricPredicates(metric) + [s.envPredicate],
          groupBy=[pod + ' AS pod'],
        ),
      );

    p.dashboard(
      title=$.title,
      tags=['kubernetes'],
      variables=s.variables,
      panels=[
        p.timeseries(1, 'CPU usage by pod', { h: 8, w: 12, x: 0, y: 0 },
                     [gauge('k8s.pod.cpu.usage', 'cores')], unit='short'),
        p.timeseries(2, 'Memory working set by pod', { h: 8, w: 12, x: 12, y: 0 },
                     [gauge('k8s.pod.memory.working_set', 'bytes')], unit='bytes'),
        // A cumulative counter: the builder turns it into a per-second rate,
        // per pod, with counter resets clamped.
        p.timeseries(3, 'Network received by pod', { h: 8, w: 24, x: 0, y: 8 }, [
          p.target(
            s.datasourceUid,
            s.database,
            ch.tables.sum,
            ch.counterRateQuery(
              s.database,
              ch.tables.sum,
              pod,
              'bytes_per_second',
              ch.metricPredicates('k8s.pod.network.io')
              + [s.envPredicate, ch.attr('direction') + " = 'receive'"],
            ),
          ),
        ], unit='Bps'),
      ],
    ),
}
```

The parts doing the work:

- `ch.dim(name)` reads a dimension from resource or datapoint attributes,
  whichever holds it. `ch.attr(name)` always reads datapoint attributes.
- `ch.metricPredicates(metric)` filters by metric name in index order and
  skips datapoints that recorded no value.
- `s.envPredicate` is the environment filter from the scope. Add it to every
  query.
- `ch.timeSeriesQuery` charts a gauge. `ch.counterRateQuery` charts a counter
  as a per-second rate.

List every template in one file, so both renders pick up new dashboards:

```jsonnet title="dashboards/all.libsonnet"
[
  import 'pod-resources.libsonnet',
]
```

## Render for your workspace

```jsonnet showLineNumbers title="workspace.jsonnet"
// Renders every dashboard for `scout gitops push`: one plain dashboard JSON
// file each, with your username in the uid and title so a workspace copy
// never collides with the deployed dashboard.
local naming = import 'github.com/base-14/scout-jsonnet-libs/core/naming.libsonnet';
local cfg = import 'lib/scope.libsonnet';
local dashboards = import 'dashboards/all.libsonnet';

local ns = std.extVar('ns');

{
  [d.name + '.json']: d.build(cfg.scope) {
    uid: naming.prefixed(ns, d.name),
    title: '[%s] %s' % [ns, d.title],
  }
  for d in dashboards
}
```

Render with your workspace username, the `Username` that
`scout gitops status` prints, and push:

```bash
mkdir -p out/workspace
jsonnet -J vendor -m out/workspace --ext-str ns=jane-doe workspace.jsonnet
scout gitops push out/workspace/
```

```text
out/workspace/pod-resources.json
out/workspace/pod-resources.json -> jane-doe-pod-resources (success)
Pushed 1 dashboard(s) into gitops-workspaces/jane-doe-dev.
```

`jsonnet -m` writes one file per key and does not create the directory, hence
the `mkdir -p`. Open your workspace in Scout and check
**[jane-doe] Pod Resources** against live data. Edit the template, render,
and push again; the same `uid` updates the same dashboard.

## Render for deployment

```jsonnet showLineNumbers title="deploy.jsonnet"
// Renders every dashboard, and the folder they live in, as Scout resource
// manifests for the pipeline to apply with gcx.
local manifest = import 'github.com/base-14/scout-jsonnet-libs/core/manifest.libsonnet';
local naming = import 'github.com/base-14/scout-jsonnet-libs/core/naming.libsonnet';
local cfg = import 'lib/scope.libsonnet';
local dashboards = import 'dashboards/all.libsonnet';

local folderUid = naming.browseFolderUid(cfg.database);

{
  'folder.json': manifest.folder(folderUid, naming.browseFolderTitle(cfg.database)),
} + {
  ['dashboard-' + d.name + '.json']:
    local uid = naming.browseUid(cfg.database, d.name);
    manifest.dashboard(uid, d.build(cfg.scope) { uid: uid }) {
      metadata+: { annotations: { [manifest.folderAnnotation]: folderUid } },
    }
  for d in dashboards
}
```

This renders the folder **Browse / acme** and one manifest per dashboard,
with stable uids such as `browse-acme-pod-resources`. The `uid` is what lets
each deploy update the dashboard in place rather than create a copy, so do
not change it once a dashboard is deployed.

## Write an alert

An alert template has a `name` and a `rules` function that takes the alert
scope and the folder the rules belong in:

```jsonnet showLineNumbers title="alerts/pod-memory.libsonnet"
local a = import 'github.com/base-14/scout-jsonnet-libs/core/alerts.libsonnet';
local ch = import 'github.com/base-14/scout-jsonnet-libs/core/sql.libsonnet';
local naming = import 'github.com/base-14/scout-jsonnet-libs/core/naming.libsonnet';

{
  name: 'pod-memory',

  // One rule that fires a separate alert for each pod over the threshold.
  rules(scope, folderUid):: [
    a.rule(
      uid=naming.clamp('pod-memory-high-' + scope.envLabel),
      title='Pod memory working set above 2 GiB',
      folderUid=folderUid,
      datasourceUid=scope.datasourceUid,
      database=scope.database,
      table=ch.tables.gauge,
      // Five-minute buckets, one series per pod. Each string column becomes
      // an alert label.
      sql=ch.alertSeriesQuery(
        scope.database,
        ch.tables.gauge,
        'max(Value)',
        'bytes',
        ch.metricPredicates('k8s.pod.memory.working_set') + [scope.envPredicate],
        groupBy=[
          ch.dim('k8s.namespace.name') + ' AS namespace',
          ch.dim('k8s.pod.name') + ' AS pod',
        ],
      ),
      threshold=2 * 1024 * 1024 * 1024,
      opts={
        format: 'time_series',
        reducer: 'max',
        // Twice the bucket width, so a crossing is seen whichever bucket
        // boundary it falls on.
        windowSeconds: 600,
        forSeconds: 600,
        labels: std.prune(scope.labels) { severity: 'warning' },
        annotations: {
          summary: 'Pod {{ $labels.namespace }}/{{ $labels.pod }} is using more than 2 GiB of memory',
        },
      },
    ),
  ],
}
```

The rule runs one query that returns a series per pod, reduces each series to
its highest value, and fires a separate alert for every pod above the
threshold. The `namespace` and `pod` columns become alert labels, so each
notification names its pod.

- `ch.alertSeriesQuery` groups the data into fixed five-minute buckets. Use
  it rather than a dashboard query: Scout's alert engine needs time series
  of a fixed width, and a dashboard query's width changes with the time
  range.
- `reducer: 'max'` with a window of twice the bucket width means a value that
  crosses the threshold is caught whichever bucket it lands in.
- `forSeconds` is how long a pod stays above the threshold before the alert
  fires.
- `labels` carry the environment from the scope plus a `severity`. Your
  notification policies can route on them.
- A query that returns nothing puts the rule in the **No Data** state rather
  than reading as healthy, so a broken query is visible.

List every alert template in one file:

```jsonnet title="alerts/all.libsonnet"
[
  import 'pod-memory.libsonnet',
]
```

## Render alerts

```jsonnet showLineNumbers title="alerts.jsonnet"
// Renders each alert template as a rule group for Scout's ruler API: one file
// per group, holding the folder it belongs in and the group body to POST.
local a = import 'github.com/base-14/scout-jsonnet-libs/core/alerts.libsonnet';
local naming = import 'github.com/base-14/scout-jsonnet-libs/core/naming.libsonnet';
local cfg = import 'lib/scope.libsonnet';
local alerts = import 'alerts/all.libsonnet';

local folderUid = naming.browseFolderUid(cfg.database);

// The library builds the provisioning API shape; the ruler API nests each
// rule's definition under `grafana_alert`.
local rulerGroup(g) = {
  name: g.title,
  interval: a.duration(g.interval),
  rules: [
    {
      'for': r['for'],
      keep_firing_for: '0s',
      labels: r.labels,
      annotations: r.annotations,
      grafana_alert: {
        uid: r.uid,
        title: r.title,
        condition: r.condition,
        data: r.data,
        no_data_state: r.noDataState,
        exec_err_state: r.execErrState,
        is_paused: r.isPaused,
        missing_series_evals_to_resolve: 2,
      },
    }
    for r in g.rules
  ],
};

{
  [t.name + '.json']: {
    folderUid: folderUid,
    group: rulerGroup(a.group(t.name, folderUid, 60, t.rules(cfg.alertScope, folderUid))),
  }
  for t in alerts
}
```

Each template becomes one rule group, evaluated every minute, in the same
**Browse / acme** folder as the dashboards. Each file holds the folder uid and
the group to send:

```bash
mkdir -p out/alerts
jsonnet -J vendor -m out/alerts alerts.jsonnet
```

The rule's `uid`, here `pod-memory-high-production`, is what lets each deploy
update the rule in place. Do not change it once the rule is deployed.

## Check an alert before deploying

Your workspace holds dashboards only, but its token can run any rule against
live data without saving it. This script sends each rendered rule to Scout's
rule evaluation API and reports what it would do:

```bash showLineNumbers title="scripts/check-alerts.sh"
#!/usr/bin/env bash
# Evaluates every rendered alert rule against live data, without saving it.
# Needs GRAFANA_SERVER and GRAFANA_TOKEN; a workspace token is enough.
set -euo pipefail

for f in out/alerts/*.json; do
  jq -c '.group.rules[].grafana_alert' "$f" | while read -r rule; do
    title=$(jq -r .title <<<"$rule")
    jq '{data, condition}' <<<"$rule" |
      curl -fsS -X POST "$GRAFANA_SERVER/api/v1/eval" \
        -H "Authorization: Bearer $GRAFANA_TOKEN" \
        -H 'Content-Type: application/json' -d @- |
      jq -r --arg title "$title" --arg cond "$(jq -r .condition <<<"$rule")" '
        [.results[] | select(.error) | .error] as $errors
        | if ($errors | length) > 0 then "\($title): ERROR \($errors[0])"
          else (.results[$cond].frames // []) as $series
          | "\($title): \($series | length) series, "
            + "\([$series[] | select(.data.values[-1][0] == 1)] | length) firing"
          end'
  done
done
```

Make the script executable, mint a workspace token once, and run it:

```bash
chmod +x scripts/check-alerts.sh
scout gitops token > ~/.config/scout-gitops.token
GRAFANA_SERVER=https://<your-scout> \
GRAFANA_TOKEN=$(cat ~/.config/scout-gitops.token) \
  scripts/check-alerts.sh
```

```text
Pod memory working set above 2 GiB: 189 series, 0 firing
```

`189 series` means the query found 189 pods, and `0 firing` that none is over
the threshold right now. If you see `0 series`, the query matches no data:
check the metric name and the `environment` value in the alert scope. To see
the rule fire, lower the threshold, render, and check again.

## Makefile

```makefile showLineNumbers title="Makefile"
NS ?= $(shell scout gitops status 2>/dev/null | awk '/^Username:/ {print $$2}')

.PHONY: vendor workspace push resources validate deploy alerts check-alerts deploy-alerts

vendor:
 jb install

workspace: vendor
 @test -n "$(NS)" || (echo "Set NS to your workspace username" && exit 1)
 rm -rf out/workspace && mkdir -p out/workspace
 jsonnet -J vendor -m out/workspace --ext-str ns=$(NS) workspace.jsonnet

push: workspace
 scout gitops push out/workspace/

resources: vendor
 rm -rf resources && mkdir -p resources
 jsonnet -J vendor -m resources deploy.jsonnet

validate: resources
 gcx resources validate -p ./resources

deploy: resources
 gcx resources push -p ./resources

alerts: vendor
 rm -rf out/alerts && mkdir -p out/alerts
 jsonnet -J vendor -m out/alerts alerts.jsonnet

check-alerts: alerts
 scripts/check-alerts.sh

deploy-alerts: alerts
 scripts/deploy-alerts.sh
```

`make push` is the whole dashboard test loop: it finds your username from
`scout gitops status`, renders, and pushes. `make check-alerts` is the alert
equivalent. Indent recipe lines with a tab.

## Deploy from CI

The pipeline applies dashboards with gcx and alert rules with Scout's alert
rule API, authenticated with your account's GitOps CI token. An account admin
creates that token in the console; store it as the `SCOUT_GITOPS_CI_TOKEN`
repository secret, and your Scout URL as `SCOUT_GRAFANA_URL`.

gcx cannot manage alert rules on Scout, so the pipeline sends each rendered
rule group to the alert rule API itself:

```bash showLineNumbers title="scripts/deploy-alerts.sh"
#!/usr/bin/env bash
# Creates or replaces each rendered rule group in its folder. Needs
# GRAFANA_SERVER and GRAFANA_TOKEN; use the GitOps CI token.
set -euo pipefail

for f in out/alerts/*.json; do
  folder=$(jq -r .folderUid "$f")
  jq .group "$f" |
    curl -fsS -X POST "$GRAFANA_SERVER/api/ruler/grafana/api/v1/rules/$folder" \
      -H "Authorization: Bearer $GRAFANA_TOKEN" \
      -H 'Content-Type: application/json' -d @-
  echo
done
```

Make it executable too (`chmod +x scripts/deploy-alerts.sh`). Each group
replaces the group of the same name in its folder, so a rule
deleted from a template is deleted from Scout on the next deploy. Deleting a
whole template does not delete its group; remove the group in the Scout UI.

```yaml showLineNumbers title=".github/workflows/dashboards.yml"
name: Dashboards

on:
  pull_request:
  push:
    branches: [main]

jobs:
  dashboards:
    runs-on: ubuntu-latest
    env:
      GRAFANA_SERVER: ${{ secrets.SCOUT_GRAFANA_URL }}
      GRAFANA_TOKEN: ${{ secrets.SCOUT_GITOPS_CI_TOKEN }}
      GRAFANA_ORG_ID: '1'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: stable

      - name: Install jsonnet, jb and gcx
        run: |
          go install github.com/google/go-jsonnet/cmd/jsonnet@v0.20.0
          go install github.com/jsonnet-bundler/jsonnet-bundler/cmd/jb@v0.6.0
          GCX_VERSION=1.1.0
          GCX_URL=https://github.com/grafana/gcx/releases/download
          curl -sL "$GCX_URL/v$GCX_VERSION/gcx_${GCX_VERSION}_linux_amd64.tar.gz" | tar xz gcx
          sudo mv gcx /usr/local/bin/

      - name: Render and validate
        run: make validate

      - name: Check alerts
        run: make check-alerts

      - name: Deploy dashboards
        if: github.ref == 'refs/heads/main'
        run: make deploy

      - name: Deploy alerts
        if: github.ref == 'refs/heads/main'
        run: make deploy-alerts
```

Pull requests render, validate, and check every alert against live data;
merges to `main` deploy. Dashboards deploy first, because that step creates
the folder the alert rules go in. GitOps CI tokens
last 90 days. Before one expires, the admin issues a new token, updates the
secret, confirms a pipeline run succeeds, and then revokes the old token.

See [Dashboards as Code with gcx](./dashboards-as-code-gcx.md) for more on
`gcx resources validate`, `push`, and `pull`.

## Add another dashboard or alert

1. Write `dashboards/<name>.libsonnet` with a `name`, `title`, and `build`,
   or `alerts/<name>.libsonnet` with a `name` and `rules`.
2. Add it to `dashboards/all.libsonnet` or `alerts/all.libsonnet`.
3. Run `make push` and check the dashboard in your workspace, or run
   `make check-alerts`.
4. Open a pull request. The pipeline checks it, and deploys it on merge.

The library also ships ready-made dashboard bundles for AWS ELB, AWS RDS, and
RabbitMQ. See its
[mixins](https://github.com/base-14/scout-jsonnet-libs#mixins).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `RUNTIME ERROR: couldn't open import` | `vendor/` is missing, or `-J vendor` was left out | Run `jb install`, and pass `-J vendor` |
| `open out/workspace/...: no such file or directory` | `jsonnet -m` does not create its output directory | `mkdir -p` the directory first |
| `RUNTIME ERROR: Undefined external variable: ns` | `workspace.jsonnet` was rendered without a username | Pass `--ext-str ns=<username>` |
| The Environment dropdown is empty | The probe metric is not in the gauge table, or no environment emitted it in the last hour | Choose a gauge metric every environment emits |
| A panel shows no data | The metric name or an attribute filter does not match your telemetry | Check the metric in Scout's Explore, then the attribute's name and value |
| `403 Access denied to save dashboard` on `scout gitops push` | The `uid` belongs to a dashboard outside your workspace | Render with `workspace.jsonnet`, which prefixes the `uid` |
| `403 ... not enough permissions to create a folder` from gcx | The token cannot create folders | Use the GitOps CI token, not a workspace token |
| `check-alerts.sh` reports `0 series` | The alert query matches no data | Check the metric name and the `environment` value in `alertScope` |
| `field missing_series_evals_to_resolve must be greater than 0` | The rule group was built without it | Render with `alerts.jsonnet`, which sets it |
| `field keep_firing_for cannot be negative` | The rule group was built without it | Render with `alerts.jsonnet`, which sets it |
| `403 ... alert.provisioning:write` | The rules were sent to `/api/v1/provisioning`, which needs Admin permissions | Use the alert rule API in `deploy-alerts.sh` |
| `deploy-alerts.sh` fails with `403 ... alert.rules:read, folders:read` | The folder does not exist yet, or the token cannot edit it | Deploy dashboards first, which creates the folder, and use the GitOps CI token |

## Related Guides

- [GitOps Developer Workspaces](./gitops-workspaces.md) - Test dashboards
  before deploying them
- [Dashboards as Code with gcx](./dashboards-as-code-gcx.md) - Apply
  dashboards from a pipeline
- [scout gitops](../scout-cli/scout-access/gitops.md) - Command reference
- [scout-jsonnet-libs](https://github.com/base-14/scout-jsonnet-libs) - The
  library, its query builders, and mixins
- [Creating Alerts with LogX](../guides/creating-alerts-with-logx.md) - Build
  an alert rule in the Scout UI
