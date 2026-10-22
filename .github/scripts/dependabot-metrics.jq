# Dependabot alerts -> OTLP/HTTP JSON ExportMetricsServiceRequest (/v1/metrics).
# Run with `jq -n` and:
#   --slurpfile alerts   <file>   raw `gh api --paginate` output: one JSON array per page
#   --slurpfile declared <file>   JSON array of `.updates[].directory` from .github/dependabot.yml
#   --arg repo <owner/name>
#   --arg ts   <unix nanoseconds> one timestamp shared by every datapoint
#
# Metrics (gauge):
#   github.dependabot.alerts.open    attrs severity, ecosystem, app, package; value = open alert count,
#                                    plus an explicit 0 for every (app x severity) with no open alerts
#                                    (ecosystem="" and package="" on those rows) so "fixed" is
#                                    distinguishable from "exporter stopped". "root" is always in the
#                                    app set, so a repo with no dependabot.yml still emits a zero grid.
#   github.dependabot.export.success attrs repo; value = 1 (heartbeat, same payload)
#
# Local test: .github/scripts/dependabot-metrics-test.sh <alerts.json> [expected-total]

# Directory segments -> app name. One rule for both manifest paths and dependabot.yml
# directories so the zero grid and the real rows land on the same app values:
#   []                      -> "root"      (repo root, e.g. go.mod or dependabot directory "/")
#   [".github", ...]        -> "root"      (GitHub Actions manifests live under .github/)
#   ["apps", "x", ...]      -> "apps/x"    (sub-modules and test manifests roll up to the app)
#   ["tools", "x", ...]     -> "tools"     (anything else: first segment)
def app_of_segments:
  map(select(. != ""))
  | if length == 0 then "root"
    elif (.[0] | startswith(".")) then "root"
    elif .[0] == "apps" and length >= 2 then "apps/" + .[1]
    else .[0] end;

# "apps/x/y/go.mod" -> "apps/x"; "go.mod" -> "root"; ".github/workflows/ci.yml" -> "root"
def app_of_path: split("/") | .[:-1] | app_of_segments;

# "/apps/x" -> "apps/x"; "/" -> "root"; "/tools/x" -> "tools"
def app_of_dir: split("/") | app_of_segments;

def str_attr($k; $v): {key: $k, value: {stringValue: ($v // "")}};

def severities: ["critical", "high", "medium", "low"];

( $alerts | add // []
  | if type != "array" then error("alerts input is not a JSON array") else . end ) as $open

| ( $open
    | map({
        severity:  .security_advisory.severity,
        ecosystem: .security_vulnerability.package.ecosystem,
        package:   .security_vulnerability.package.name,
        app:       (.dependency.manifest_path | app_of_path)
      })
    | group_by(.severity, .ecosystem, .app, .package)
    | map(.[0] + {count: length}) ) as $tuples

| ( ["root"] + ($declared | add // [] | map(app_of_dir)) + ($tuples | map(.app)) | unique ) as $apps

| ( [ $apps[] as $app
      | severities[] as $sev
      | select( any($tuples[]; .app == $app and .severity == $sev) | not )
      | {severity: $sev, ecosystem: "", app: $app, package: "", count: 0} ] ) as $zeros

| {
    resourceMetrics: [{
      resource: { attributes: [
        str_attr("service.name";      "github-dependabot"),
        str_attr("service.namespace"; "base14"),
        str_attr("repo";              $repo),
        str_attr("scm.system";        "github")
      ]},
      scopeMetrics: [{
        scope: { name: "github.com/\($repo)/.github/workflows/dependabot-metrics.yml" },
        metrics: [
          {
            name: "github.dependabot.alerts.open",
            description: "Open Dependabot alerts by severity, ecosystem, app and package (explicit zeros per app x severity)",
            unit: "{alert}",
            gauge: { dataPoints: ( ($tuples + $zeros) | map({
              timeUnixNano: $ts,
              asInt: (.count | tostring),
              attributes: [
                str_attr("severity";  .severity),
                str_attr("ecosystem"; .ecosystem),
                str_attr("app";       .app),
                str_attr("package";   .package)
              ]
            }) ) }
          },
          {
            name: "github.dependabot.export.success",
            description: "1 when the dependabot-metrics workflow built and shipped a payload",
            unit: "1",
            gauge: { dataPoints: [{
              timeUnixNano: $ts,
              asInt: "1",
              attributes: [ str_attr("repo"; $repo) ]
            }] }
          }
        ]
      }]
    }]
  }
