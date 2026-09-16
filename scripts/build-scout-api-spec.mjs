#!/usr/bin/env node
// Builds the public Scout API spec that the reference docs generate from.
//
// The source spec lives in the private base14 monorepo and describes the
// service as deployed, including endpoints a customer cannot call and a
// dev-only host. This script turns it into something publishable.
//
// Five steps run:
//   1. convert          - Swagger 2.0 from the service repo to OpenAPI 3.0.
//   2. prune            - drop internal-only paths, then drop the schemas
//                         that nothing references any more.
//   3. rewrite servers  - replace the dev host with the public URL shape.
//   4. inject security  - the source spec has no security scheme; without
//                         one the reference renders every endpoint as
//                         unauthenticated.
//   5. denylist         - refuse to write anything containing a customer
//                         name or an internal hostname. This is a hard
//                         failure, not a warning.
//
// Usage:
//   SCOUT_API_SPEC=~/work/base14/apps/scout-api/api/swagger.yaml \
//     node scripts/build-scout-api-spec.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import converter from "swagger2openapi";

const SOURCE = process.env.SCOUT_API_SPEC;
const OUTPUT = "api-spec/scout-api.openapi.json";

if (!SOURCE) {
  console.error(
    "SCOUT_API_SPEC is not set.\n" +
      "Point it at api/swagger.yaml in a local base14 checkout:\n" +
      "  SCOUT_API_SPEC=~/work/base14/apps/scout-api/api/swagger.yaml \\\n" +
      "    node scripts/build-scout-api-spec.mjs",
  );
  process.exit(1);
}

// Paths kept out of the public reference.
//
// Most are unreachable for a customer holding a Scout Read key, so
// documenting them would only generate support load:
//
//   health probes          unauthenticated, for Kubernetes
//   system/health-summary  platform-wide internal view
//   incidents              internal alerting pipeline; tenant_id in body
//   artifacts              CI OIDC auth, not client credentials
//   symbolicate            tenant API key from the datasource proxy
//   ci-upload-trusts       super-admin realm only
//
// alerts and status are callable, but are held back from the first
// release of these docs.
const EXCLUDED_PATHS = [
  "/health/live",
  "/health/ready",
  "/system/health-summary",
  "/incidents",
  "/incidents/{id}",
  "/artifacts",
  "/artifacts/{id}",
  "/artifacts/{id}/finalize",
  "/symbolicate",
  "/accounts/{account}/ci-upload-trusts",
  "/alerts",
  "/status",
];

const EXCLUDED_TAGS = new Set([
  "health",
  "incidents",
  "artifacts",
  "ci-upload-trusts",
  "alerts",
  "system",
]);

const PUBLIC_INFO_DESCRIPTION = `
Query the observability data base14 Scout collects for your organization:
distributed traces, logs, metrics, service topology, APM rollups and real
user monitoring.

Every request needs a bearer token from the base14 identity service and a
base URL specific to your organization. Both are covered in the
[quickstart](/api/quickstart/).

Requests are scoped to a single organization, derived from the access token
— there is no tenant header or path parameter to set. All timestamps are
RFC3339.
`.trim();

const SERVER = {
  url: "https://api.{region}-scout.base14.io/{org}/api/v1",
  description:
    "Your organization's Scout API. Both values are returned by the " +
    "discovery endpoint described in the quickstart; do not guess them.",
  variables: {
    region: {
      default: "use1",
      description: "The region your organization is provisioned in.",
    },
    org: {
      default: "acme",
      description: "Your organization slug.",
    },
  },
};

const SECURITY_SCHEME = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "An access token from the base14 identity service, obtained with the " +
      "OAuth 2.0 client credentials grant. Send it as " +
      "`Authorization: Bearer <token>`. Tokens are short-lived; re-request " +
      "rather than caching indefinitely.",
  },
};

/**
 * Decide whether a built spec is safe to publish.
 *
 * This is the last line of defence before a file lands in a public GitHub
 * repo, so it is deliberately blunt: any hit anywhere in the serialised
 * spec aborts the build.
 *
 * Returns an array of human-readable violations; empty means safe.
 *
 * @param {string} serialised - the full spec, already stringified
 * @returns {string[]}
 */
function findLeaks(serialised) {
  const violations = [];

  // Structural patterns. These catch things nobody thought to enumerate,
  // which is the whole point — a tenant onboarded next month is covered by
  // the hostname patterns without anyone updating this file.
  const patterns = [
    [/[a-z0-9-]+\.ts\.net/gi, "Tailscale tailnet hostname"],
    [/[a-z0-9-]+\.svc\.cluster\.local/gi, "in-cluster service DNS"],
    [/\b\d{12}\b/g, "possible AWS account ID"],
    [/\barn:aws:[a-z0-9-]+:/gi, "AWS ARN"],
    [/\bdkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/gi, "ECR image repository"],
    [/\bid\.b14\.dev\b/gi, "playground identity host"],
    [/\bplay-nbg1\b/gi, "playground cluster host"],
    [/\bscout-[a-z0-9]+-(apps|systems)-(eks|gke|aks|talos)\b/gi, "cluster name"],
    [/\bb14-\d{3}-[a-z0-9-]+\b/gi, "cluster name"],
    [/\bminimap\b/gi, "super-admin realm"],
    [/\bclickhouse-[a-z-]+\b/gi, "ClickHouse endpoint"],
    [/\botel_(traces|logs|metrics)[a-z_]*\b/gi, "internal table name"],
    [/\brum_(sessions|users|kpis|screens|http|crashes)\b/gi, "internal table name"],
  ];

  for (const [pattern, label] of patterns) {
    const hits = serialised.match(pattern);
    if (hits) {
      violations.push(`${label}: ${[...new Set(hits)].slice(0, 5).join(", ")}`);
    }
  }

  // Named customers. The pattern rules above cannot infer these, so they are
  // listed. Keep in sync with the tenant files under ops/scout-api/ in
  // base14-infra when a customer is onboarded.
  //
  // Matched case-insensitively on a word boundary. Short or dictionary-word
  // slugs are omitted deliberately — they false-positive on ordinary prose
  // and the structural rules above already cover the hostnames they appear
  // in.
  const customers = [
    "sessionm",
    "snabbit",
    "glomopay",
    "jswone",
    "wizcommerce",
    "numocity",
    "credresolve",
    "probe42",
    "quantacus",
    "ascguard",
    "infraspec",
    "buildnext",
    "iquasar",
    "boardroom",
    "oteldemo1",
    "oteldemo2",
  ];

  for (const name of customers) {
    if (new RegExp(`\\b${name}\\b`, "i").test(serialised)) {
      violations.push(`customer name: ${name}`);
    }
  }

  return violations;
}

/** Drop schemas nothing references, repeatedly, until the set is stable. */
function pruneUnreachableSchemas(spec) {
  const schemas = spec.components?.schemas ?? {};
  let removed;
  let total = 0;

  do {
    removed = 0;
    // Serialise everything except the schema bodies we might delete, so a
    // schema referenced only by another dead schema is collected too.
    for (const name of Object.keys(schemas)) {
      const others = { ...spec, components: { ...spec.components, schemas: {} } };
      const reachable = JSON.stringify({
        rest: others,
        peers: Object.fromEntries(
          Object.entries(schemas).filter(([key]) => key !== name),
        ),
      });
      if (!reachable.includes(`"#/components/schemas/${name}"`)) {
        delete schemas[name];
        removed += 1;
        total += 1;
      }
    }
  } while (removed > 0);

  return total;
}

const sourcePath = resolve(SOURCE.replace(/^~/, process.env.HOME ?? "~"));
console.log(`source  ${sourcePath}`);

// 1. Convert.
const source = JSON.parse(
  JSON.stringify(
    await new Promise((ok, err) => {
      converter.convertFile(sourcePath, { patch: true, warnOnly: true }, (e, out) =>
        e ? err(e) : ok(out.openapi),
      );
    }),
  ),
);

const spec = source;
const pathsBefore = Object.keys(spec.paths).length;

// 2. Prune.
for (const path of EXCLUDED_PATHS) delete spec.paths[path];

const leftover = Object.keys(spec.paths).filter((p) =>
  Object.values(spec.paths[p]).some(
    (op) => op?.tags?.some((t) => EXCLUDED_TAGS.has(t)),
  ),
);
if (leftover.length) {
  console.error(
    `\nPaths carry an excluded tag but are not in EXCLUDED_PATHS:\n  ${leftover.join("\n  ")}\n` +
      "Add them to EXCLUDED_PATHS or retag them upstream.",
  );
  process.exit(1);
}

spec.tags = (spec.tags ?? []).filter((t) => !EXCLUDED_TAGS.has(t.name));
const schemasRemoved = pruneUnreachableSchemas(spec);

// 3 & 4. Public metadata.
spec.info.description = PUBLIC_INFO_DESCRIPTION;
spec.servers = [SERVER];
spec.components = spec.components ?? {};
spec.components.securitySchemes = SECURITY_SCHEME;
spec.security = [{ bearerAuth: [] }];

const serialised = `${JSON.stringify(spec, null, 2)}\n`;

// 5. Refuse to publish anything that leaks.
const leaks = findLeaks(serialised);
if (leaks.length) {
  console.error("\nRefusing to write the spec. Denylist violations:\n");
  for (const leak of leaks) console.error(`  ${leak}`);
  console.error("\nNothing was written.");
  process.exit(1);
}

writeFileSync(OUTPUT, serialised);

const pathsAfter = Object.keys(spec.paths).length;
const operations = Object.values(spec.paths).reduce(
  (n, ops) =>
    n + Object.keys(ops).filter((k) => k !== "parameters").length,
  0,
);

console.log(
  `\nwrote ${OUTPUT}\n` +
    `  ${pathsAfter} paths (${pathsBefore - pathsAfter} internal removed), ` +
    `${operations} operations\n` +
    `  ${Object.keys(spec.components.schemas ?? {}).length} schemas ` +
    `(${schemasRemoved} unreachable removed)\n` +
    `  ${spec.tags.length} tags, denylist clean`,
);
