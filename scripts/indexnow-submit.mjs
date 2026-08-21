#!/usr/bin/env node
// Submit changed URLs to IndexNow, which feeds Bing and ChatGPT search.
// Prints the URL list and exits. Pass --submit to actually POST it.
// Usage:
//   node scripts/indexnow-submit.mjs /docs/instrument/apps/go/ /blog/some-post/
//   node scripts/indexnow-submit.mjs --since HEAD~1 --submit
// Google does not participate in IndexNow. It picks up changes from the
// sitemap's lastmod dates, or from Search Console's URL Inspection tool.

import { execSync } from "node:child_process";

const HOST = "docs.base14.io";
const KEY = "a376aa45793a5381580c1c809adf430f";
const ENDPOINT = "https://api.indexnow.org/IndexNow";

function urlsFromGit(ref) {
  const out = execSync(`git diff --name-only ${ref} HEAD`, {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((f) => /^(docs|blog|src\/pages)\/.+\.mdx?$/.test(f))
    .map(toUrlPath)
    .filter(Boolean);
}

function toUrlPath(file) {
  if (file.startsWith("src/pages/")) {
    return `/${file.slice("src/pages/".length).replace(/\.mdx?$/, "")}/`;
  }
  if (file.startsWith("blog/")) {
    const dir = file.split("/")[1];
    const slug = dir.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    return `/blog/${slug}/`;
  }
  const path = file.replace(/\.mdx?$/, "").replace(/\/index$/, "");
  return `/${path}/`;
}

const args = process.argv.slice(2).filter((a) => a !== "--submit");
const submit = process.argv.includes("--submit");
let paths;
if (args[0] === "--since") {
  if (!args[1]) {
    console.error("--since needs a git ref, for example --since HEAD~1");
    process.exit(1);
  }
  paths = urlsFromGit(args[1]);
} else {
  paths = args;
}

if (paths.length === 0) {
  console.error("No URLs to submit.");
  process.exit(1);
}

const urlList = paths.map((p) => `https://${HOST}${p.startsWith("/") ? p : `/${p}`}`);

console.log(
  `${submit ? "Submitting" : "Would submit"} ${urlList.length} URL(s) to IndexNow:`,
);
for (const u of urlList) console.log(`  ${u}`);

if (!submit) {
  console.log("\nDry run. Re-run with --submit to send this list.");
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList,
  }),
});

console.log(`${res.status} ${res.statusText}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
