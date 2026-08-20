#!/usr/bin/env node
// Checks that every FAQPage JSON-LD question and answer also appears in the
// visible text of the page. Drift between the two is invisible in the browser
// and ships wrong answers to search engines and AI crawlers.
//
// Pages under src/pages are enforced. Everything else is reported as a warning
// unless --strict is passed.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative } from "node:path";

const STRICT_ALL = process.argv.includes("--strict");
const ENFORCED = /^src\/pages\//;

function listCandidates() {
  const out = execFileSync(
    "grep",
    ["-rl", "FAQPage", "--include=*.md", "--include=*.mdx", "src", "docs", "blog"],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/superpowers/"))
    .sort();
}

function normalize(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\\([-_*[\]])/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizeQuestion = (text) =>
  normalize(text).replace(/^\d+[.)]\s*/, "").replace(/[?:]\s*$/, "");

// Pull every {JSON.stringify({...})} object literal out of the file and
// evaluate it. The content is repo-authored, so evaluating is safe here.
function extractJsonLd(source) {
  const blocks = [];
  const marker = "JSON.stringify(";
  let cursor = 0;
  for (;;) {
    const hit = source.indexOf(marker, cursor);
    if (hit === -1) break;
    const start = source.indexOf("{", hit + marker.length);
    if (start === -1) break;
    let depth = 0;
    let end = -1;
    let inString = null;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (char === "\\") i += 1;
        else if (char === inString) inString = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") inString = char;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const literal = source.slice(start, end + 1);
    cursor = end + 1;
    try {
      // eslint-disable-next-line no-new-func
      blocks.push(new Function(`return (${literal})`)());
    } catch {
      blocks.push({ __parseError: literal.slice(0, 80) });
    }
  }
  return blocks;
}

// Visible headings and the prose that follows each one, keyed by the
// normalized heading text.
function extractSections(body) {
  const lines = body.split("\n");
  const sections = new Map();
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) {
      if (current) current.lines.push(line);
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.*\S)\s*$/);
    if (heading) {
      const key = normalizeQuestion(heading[2]);
      current = { lines: [] };
      if (key) sections.set(key, current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  const answers = new Map();
  for (const [key, section] of sections) {
    const prose = [];
    for (const raw of section.lines) {
      const line = raw.trim();
      if (!line) {
        // Stop at the first blank line after a directive block ends; keep
        // collecting otherwise so multi-paragraph answers still match.
        continue;
      }
      if (
        line.startsWith(":::") ||
        line.startsWith("|") ||
        line.startsWith("```") ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(line)
      ) {
        break;
      }
      prose.push(line.replace(/^([-*+]|\d+[.)])\s+/, ""));
    }
    answers.set(key, normalize(prose.join(" ")));
  }
  return answers;
}

const problems = [];
const files = listCandidates();
let questionCount = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const enforced = STRICT_ALL || ENFORCED.test(file);
  // Strip fenced code blocks first: sample code often contains
  // JSON.stringify( calls that are not schema markup.
  const blocks = extractJsonLd(source.replace(/^```[\s\S]*?^```/gm, ""));
  const faqBlocks = blocks.filter((b) => b && b["@type"] === "FAQPage");
  const parseErrors = blocks.filter((b) => b && b.__parseError);
  for (const bad of parseErrors) {
    problems.push({ file, enforced, kind: "unparseable JSON-LD", detail: bad.__parseError });
  }
  if (!faqBlocks.length) continue;

  const sections = extractSections(source);
  const hasVisibleFaq = /^#{2,3}\s+(FAQ|Frequently asked)/im.test(source);

  for (const block of faqBlocks) {
    const entries = Array.isArray(block.mainEntity) ? block.mainEntity : [];
    for (const entry of entries) {
      questionCount += 1;
      const question = entry?.name ?? "";
      const answer = entry?.acceptedAnswer?.text ?? "";
      const key = normalizeQuestion(question);
      if (!sections.has(key)) {
        problems.push({
          file,
          enforced: enforced && hasVisibleFaq,
          kind: hasVisibleFaq ? "question not on page" : "schema FAQ has no visible FAQ section",
          detail: question,
        });
        continue;
      }
      const visible = sections.get(key);
      const schema = normalize(answer);
      if (visible !== schema) {
        problems.push({
          file,
          enforced,
          kind: "answer differs from schema",
          detail: question,
          schema,
          visible,
        });
      }
    }
  }
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const from = Math.max(0, i - 40);
  return {
    schema: `...${b.slice(from, i + 60)}`,
    visible: `...${a.slice(from, i + 60)}`,
  };
}

const errors = problems.filter((p) => p.enforced);
const warnings = problems.filter((p) => !p.enforced);

const report = (list, label) => {
  if (!list.length) return;
  console.log(`\n${label}:`);
  let lastFile = null;
  for (const p of list) {
    if (p.file !== lastFile) {
      console.log(`\n  ${relative(process.cwd(), p.file)}`);
      lastFile = p.file;
    }
    console.log(`    ${p.kind}: ${p.detail}`);
    if (p.schema !== undefined && p.visible !== undefined) {
      const diff = firstDifference(p.visible, p.schema);
      console.log(`      schema:  ${diff.schema}`);
      console.log(`      visible: ${diff.visible}`);
    }
  }
};

report(errors, "FAQ schema errors");
report(warnings, "FAQ schema warnings (not enforced)");

console.log(
  `\nchecked ${questionCount} FAQ entries across ${files.length} files: ` +
    `${errors.length} error(s), ${warnings.length} warning(s)`,
);

process.exit(errors.length ? 1 : 0);
