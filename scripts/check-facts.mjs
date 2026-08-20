#!/usr/bin/env node
// Checks the comparison and cost pages against src/data/marketing-facts.json.
//
// Four checks run:
//   1. scenario totals   - the components in the facts file add up to the
//                          stated total, and every page that cites that
//                          scenario prints the same number.
//   2. consistency       - a rate that appears on many pages has one value.
//   3. forbidden phrases - claims that were true once and are not any more.
//   4. sentence case     - frontmatter titles and H1s.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

const facts = JSON.parse(readFileSync("src/data/marketing-facts.json", "utf8"));
const problems = [];
const fail = (file, message) => problems.push({ file, message });

function expandGlob(pattern) {
  const dir = dirname(pattern);
  const ext = pattern.slice(pattern.lastIndexOf("."));
  return readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .map((name) => join(dir, name))
    .sort();
}

const files = facts.scope.flatMap(expandGlob);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const read = (file) => {
  if (!sources.has(file)) sources.set(file, readFileSync(file, "utf8"));
  return sources.get(file);
};

const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

// 1. Scenario totals.
for (const scenario of facts.scenarios) {
  const computed = scenario.components.reduce((sum, c) => {
    if (c.amount !== undefined) return sum + c.amount;
    const units = c.units ?? c.millions;
    return sum + units * c.rate;
  }, 0);
  const monthly = Math.round(computed);
  if (monthly !== scenario.monthly) {
    fail(
      "src/data/marketing-facts.json",
      `scenario ${scenario.id}: components add up to ${money(computed)}, ` +
        `but monthly says ${money(scenario.monthly)}`,
    );
  }
  if (scenario.annual !== undefined && scenario.annual !== scenario.monthly * 12) {
    fail(
      "src/data/marketing-facts.json",
      `scenario ${scenario.id}: annual ${money(scenario.annual)} is not ` +
        `12 x ${money(scenario.monthly)}`,
    );
  }
  const expected = new Map();
  for (const file of scenario.files) expected.set(file, ["monthly"]);
  for (const file of scenario.annualFiles ?? scenario.files) {
    if (scenario.annual === undefined) break;
    expected.set(file, [...(expected.get(file) ?? []), "annual"]);
  }
  for (const [file, labels] of expected) {
    const text = read(file);
    for (const label of labels) {
      const value = scenario[label];
      if (value === undefined) continue;
      if (!text.includes(money(value))) {
        fail(
          file,
          `cites scenario ${scenario.id} but never prints its ${label} ` +
            `total ${money(value)}`,
        );
      }
    }
  }
}

// 2. Rates that must agree everywhere they appear.
for (const rule of facts.consistency) {
  const allowed = new Set(rule.allowed.map(Number));
  for (const file of files) {
    const pattern = new RegExp(rule.pattern, "g");
    for (const match of read(file).matchAll(pattern)) {
      const value = Number(match[1]);
      if (!allowed.has(value)) {
        fail(
          file,
          `${rule.label}: found "${match[0].trim()}", expected one of ` +
            `${rule.allowed.join(", ")}${rule.note ? `. ${rule.note}` : ""}`,
        );
      }
    }
  }
}

// 3. Phrases that are no longer true, plus the pricing footnote date.
for (const rule of facts.forbidden) {
  for (const file of files) {
    const pattern = new RegExp(rule.pattern, "gi");
    for (const match of read(file).matchAll(pattern)) {
      const line = read(file).slice(0, match.index).split("\n").length;
      fail(file, `line ${line}: "${match[0]}" - ${rule.reason}`);
    }
  }
}

for (const file of files) {
  for (const match of read(file).matchAll(/Pricing as of ([A-Z][a-z]+ \d{4})/g)) {
    if (match[1] !== facts.pricingAsOf) {
      fail(
        file,
        `pricing footnote says "${match[1]}", canonical date is ` +
          `"${facts.pricingAsOf}". Re-verify the rates, then update ` +
          `pricingAsOf in marketing-facts.json.`,
      );
    }
  }
}

// 4. Sentence case on titles and H1s.
const casing = facts.requiredCasing;
const allowCaps = new Set(casing.alwaysCapitalized);
const titlePattern = new RegExp(casing.pattern, "gm");
for (const file of files) {
  for (const match of read(file).matchAll(titlePattern)) {
    const heading = match[1].replace(/^"|"$/g, "");
    const words = heading
      .split(/[\s/]+/)
      .slice(1)
      .filter((w) => /^[A-Za-z]+$/.test(w) && w.length > 2);
    if (words.length < 3) continue;
    const capitalized = words.filter(
      (w) => /^[A-Z]/.test(w) && !allowCaps.has(w),
    );
    if (capitalized.length / words.length > casing.titleCaseThreshold) {
      fail(
        file,
        `title case detected: "${heading}". ${casing.note} ` +
          `(${capitalized.join(", ")})`,
      );
    }
  }
}

if (problems.length) {
  console.log("\nFact check failures:\n");
  let lastFile = null;
  for (const p of problems) {
    if (p.file !== lastFile) {
      console.log(`  ${p.file}`);
      lastFile = p.file;
    }
    console.log(`    ${p.message}`);
  }
}

console.log(
  `\nchecked ${facts.scenarios.length} scenarios, ${facts.consistency.length} rate rules, ` +
    `${facts.forbidden.length} forbidden phrases across ${files.length} files: ` +
    `${problems.length} failure(s)`,
);

process.exit(problems.length ? 1 : 0);
