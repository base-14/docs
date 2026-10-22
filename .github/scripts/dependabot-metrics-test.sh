#!/usr/bin/env bash
# Local test for dependabot-metrics.jq. Runs the program against a fixture of
# `gh api --paginate` output (one JSON array per page) and asserts the shape.
#
#   .github/scripts/dependabot-metrics-test.sh <alerts-pages.json> [expected-total] [expected-apps]
#
#   expected-apps: space-separated, sorted list of the distinct `app` values expected in the
#   payload (zero rows included), e.g. "apps/x root tools". Set DECLARED_DIRS_JSON to override
#   the directories read from .github/dependabot.yml, e.g. DECLARED_DIRS_JSON='["/","/apps/x"]'.
#   Set REPO to the owner/name slug the payload is built for (default base-14/base14).
#
# Fixture: gh api --paginate -H "Accept: application/vnd.github+json" \
#            "/repos/$REPO/dependabot/alerts?state=open&per_page=100" > alerts.json
set -euo pipefail

ALERTS=${1:?alerts fixture path}
EXPECTED_TOTAL=${2:-}
EXPECTED_APPS=${3:-}
REPO=${REPO:-base-14/base14}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

# macOS `date` has no %N; a plain seconds timestamp padded to ns is fine for tests.
TS="$(date +%s)000000000"

if [[ -n "${DECLARED_DIRS_JSON:-}" ]]; then
  DECLARED_JSON=$DECLARED_DIRS_JSON
elif [[ -f "$REPO_ROOT/.github/dependabot.yml" ]]; then
  DECLARED_JSON=$(yq -o=json -I=0 '[.updates[].directory]' "$REPO_ROOT/.github/dependabot.yml")
else
  DECLARED_JSON='[]'
fi

jq -n \
  --slurpfile alerts "$ALERTS" \
  --slurpfile declared <(echo "$DECLARED_JSON") \
  --arg repo "$REPO" \
  --arg ts "$TS" \
  -f "$HERE/dependabot-metrics.jq" > "$OUT"

# Declared directories collapse to app names (e.g. "/" -> root), so count distinct apps, not entries.
DECLARED=$(echo "$DECLARED_JSON" | jq 'map(split("/") | map(select(. != "")) | if length == 0 then "root" elif (.[0] | startswith(".")) then "root" elif .[0] == "apps" and length >= 2 then "apps/" + .[1] else .[0] end) | unique | length')
INPUT_TOTAL=$(jq -s 'add // [] | length' "$ALERTS")

jq -e --arg ts "$TS" --arg repo "$REPO" --argjson declared "$DECLARED" --argjson input_total "$INPUT_TOTAL" '
  .resourceMetrics[0] as $rm
  | ($rm.scopeMetrics[0].metrics) as $m
  | ($m[0].gauge.dataPoints) as $dp
  | ($m[1].gauge.dataPoints) as $hb
  | def attr($k): .attributes[] | select(.key == $k) | .value.stringValue;
    def sevs: ["critical","high","medium","low"];
    {
      metric_names_ok:  (($m | map(.name)) == ["github.dependabot.alerts.open","github.dependabot.export.success"]),
      resource_ok:      (($rm.resource.attributes | map({(.key): .value.stringValue}) | add)
                         | (.["service.name"] == "github-dependabot" and .repo == $repo
                            and .["service.namespace"] == "base14" and .["scm.system"] == "github")),
      total_ok:         (($dp | map(.asInt | tonumber) | add) == $input_total),
      every_ts_shared:  ([$dp[].timeUnixNano, $hb[].timeUnixNano] | all(. == $ts)),
      no_null_attrs:    ([$dp[].attributes[].value.stringValue] | all(type == "string")),
      attr_keys_ok:     ($dp | all((.attributes | map(.key)) == ["severity","ecosystem","app","package"])),
      zeros_blank:      ($dp | map(select(.asInt == "0")) | all((attr("ecosystem")) == "" and (attr("package")) == "")),
      nonzero_filled:   ($dp | map(select(.asInt != "0")) | all((attr("ecosystem")) != "" and (attr("package")) != "")),
      # every (app x severity) cell is present at least once (zero or real)
      grid_complete:    (($dp | map(attr("app")) | unique) as $apps
                         | [ $apps[] as $a | sevs[] as $s
                             | ($dp | any((attr("app")) == $a and (attr("severity")) == $s)) ]
                         | all),
      # every app declared in dependabot.yml appears, plus any seen in alerts
      apps_cover_declared: (($dp | map(attr("app")) | unique | length) >= $declared),
      apps_are_shallow: ($dp | map(attr("app")) | unique | all(test("^(root|apps/[^/]+|[^/]+)$"))),
      heartbeat_ok:     (($hb | length) == 1 and $hb[0].asInt == "1" and ($hb[0] | attr("repo")) == $repo),
      scope_ok:         ($rm.scopeMetrics[0].scope.name == "github.com/\($repo)/.github/workflows/dependabot-metrics.yml"),
      root_present:     ($dp | any(attr("app") == "root")),
      no_flags:         ($dp + $hb | all(has("flags") | not))
    }
  | . as $r
  | ($r | to_entries | map(select(.value != true)) | map(.key)) as $failed
  | if ($failed | length) > 0 then error("assertions failed: \($failed)") else $r end
' "$OUT"

if [[ -n "$EXPECTED_TOTAL" ]]; then
  ACTUAL=$(jq '.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints | map(.asInt|tonumber) | add' "$OUT")
  [[ "$ACTUAL" == "$EXPECTED_TOTAL" ]] || { echo "total $ACTUAL != expected $EXPECTED_TOTAL" >&2; exit 1; }
fi

if [[ -n "$EXPECTED_APPS" ]]; then
  ACTUAL_APPS=$(jq -r '.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints
                       | map(.attributes[] | select(.key == "app") | .value.stringValue) | unique | join(" ")' "$OUT")
  [[ "$ACTUAL_APPS" == "$EXPECTED_APPS" ]] || { echo "apps [$ACTUAL_APPS] != expected [$EXPECTED_APPS]" >&2; exit 1; }
fi

echo "summary:"
jq -r '.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints
       | "  datapoints=\(length) zeros=\(map(select(.asInt=="0"))|length) apps=\(map(.attributes[]|select(.key=="app")|.value.stringValue)|unique|length) "
         + (map({s:(.attributes[]|select(.key=="severity")|.value.stringValue), n:(.asInt|tonumber)})
            | group_by(.s) | map("\(.[0].s)=\(map(.n)|add)") | join(" "))' "$OUT"
echo "PASS"
