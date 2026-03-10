import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIRS = ["docs", "blog", "scope"];
const REPORT_DIR = path.join(ROOT, ".specs", "seo-reports");
const REPORT_PATH = path.join(REPORT_DIR, "headings-audit.md");

// Single-word headings that are acceptable
const ACCEPTABLE_SHORT_HEADINGS = new Set([
  "prerequisites",
  "setup",
  "overview",
  "introduction",
  "summary",
  "usage",
  "installation",
  "configuration",
  "examples",
  "example",
  "requirements",
  "troubleshooting",
  "architecture",
  "resources",
  "references",
  "faq",
  "notes",
  "syntax",
  "parameters",
  "options",
  "features",
  "limitations",
  "caveats",
  "background",
  "motivation",
  "context",
  "glossary",
  "appendix",
  "changelog",
  "license",
  "contributing",
  "acknowledgments",
  "credits",
  "disclaimer",
  "conclusion",
  "metrics",
  "quickstart",
  "alerts",
  "dashboards",
  "security",
  "authentication",
  "authorization",
  "deployment",
  "testing",
  "debugging",
  "monitoring",
  "logging",
  "caching",
  "performance",
  "replication",
  "maintenance",
  "connections",
  "queries",
  "locks",
  "tables",
  "indexes",
]);

interface Issue {
  file: string;
  line: number;
  type: "warning" | "info";
  category: string;
  heading: string;
}

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function getHeadingLevel(line: string): number | null {
  const match = line.match(/^(#{1,6})\s+/);
  if (!match) return null;
  return match[1].length;
}

function getHeadingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

function wordCount(text: string): number {
  // Strip markdown formatting for word counting
  const clean = text.replace(/[`*_\[\]()]/g, "").trim();
  return clean.split(/\s+/).filter(Boolean).length;
}

function auditFile(filePath: string): Issue[] {
  const issues: Issue[] = [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const relativePath = path.relative(ROOT, filePath);

  // Parse frontmatter to get content after it
  let content: string;
  try {
    const parsed = matter(raw);
    content = parsed.content;
  } catch {
    // If frontmatter parsing fails, use raw content
    content = raw;
  }

  const lines = content.split("\n");

  // We need to figure out the actual line number in the original file.
  // gray-matter strips frontmatter, so we need to calculate the offset.
  const rawLines = raw.split("\n");
  let frontmatterLineCount = 0;
  if (raw.startsWith("---")) {
    // Find the closing ---
    const secondDash = raw.indexOf("---", 3);
    if (secondDash !== -1) {
      frontmatterLineCount = raw.substring(0, secondDash + 3).split("\n").length;
    }
  }

  let lastLevel = 0;
  let inCodeBlock = false;
  const headingSeen = new Map<string, number>(); // heading text -> first line number

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const level = getHeadingLevel(line);
    if (level === null) continue;

    const text = getHeadingText(line);
    const originalLineNumber = frontmatterLineCount + i + 1;

    // Check: H1 in body
    if (level === 1) {
      issues.push({
        file: relativePath,
        line: originalLineNumber,
        type: "warning",
        category: "H1 in body",
        heading: text,
      });
    }

    // Check: heading level skip (only if we've seen a heading before)
    if (lastLevel > 0 && level > lastLevel + 1) {
      issues.push({
        file: relativePath,
        line: originalLineNumber,
        type: "warning",
        category: "Heading level skip",
        heading: `${text} (H${lastLevel} -> H${level})`,
      });
    }

    // Check: very short heading
    const words = wordCount(text);
    if (words < 3) {
      const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      if (!ACCEPTABLE_SHORT_HEADINGS.has(normalized)) {
        issues.push({
          file: relativePath,
          line: originalLineNumber,
          type: "info",
          category: "Short heading",
          heading: text,
        });
      }
    }

    // Check: duplicate heading within page
    const headingKey = text.toLowerCase().trim();
    if (headingSeen.has(headingKey)) {
      issues.push({
        file: relativePath,
        line: originalLineNumber,
        type: "info",
        category: "Duplicate heading",
        heading: `${text} (first seen at line ${headingSeen.get(headingKey)})`,
      });
    } else {
      headingSeen.set(headingKey, originalLineNumber);
    }

    lastLevel = level;
  }

  return issues;
}

function generateReport(issues: Issue[]): string {
  const warnings = issues.filter((i) => i.type === "warning");
  const infos = issues.filter((i) => i.type === "info");

  const h1Issues = issues.filter((i) => i.category === "H1 in body");
  const skipIssues = issues.filter((i) => i.category === "Heading level skip");
  const shortIssues = issues.filter((i) => i.category === "Short heading");
  const dupeIssues = issues.filter((i) => i.category === "Duplicate heading");

  const uniqueFiles = new Set(issues.map((i) => i.file));

  let report = `# Heading Structure Audit Report

Generated: ${new Date().toISOString().split("T")[0]}

## Summary

| Metric | Count |
|--------|-------|
| Files scanned | (see below) |
| Files with issues | ${uniqueFiles.size} |
| Total issues | ${issues.length} |
| Warnings | ${warnings.length} |
| Info | ${infos.length} |

### Issue Breakdown

| Category | Count | Severity |
|----------|-------|----------|
| H1 in body | ${h1Issues.length} | warning |
| Heading level skip | ${skipIssues.length} | warning |
| Short heading | ${shortIssues.length} | info |
| Duplicate heading | ${dupeIssues.length} | info |

---

`;

  if (h1Issues.length > 0) {
    report += `## H1 in Body (Warning)\n\nDocusaurus renders the frontmatter \`title\` as H1. Additional H1 headings in content cause SEO issues.\n\n| File | Line | Heading |\n|------|------|---------|\n`;
    for (const issue of h1Issues) {
      report += `| \`${issue.file}\` | ${issue.line} | ${issue.heading} |\n`;
    }
    report += "\n---\n\n";
  }

  if (skipIssues.length > 0) {
    report += `## Heading Level Skips (Warning)\n\nHeading levels should not skip (e.g., H2 directly to H4 without H3).\n\n| File | Line | Heading |\n|------|------|---------|\n`;
    for (const issue of skipIssues) {
      report += `| \`${issue.file}\` | ${issue.line} | ${issue.heading} |\n`;
    }
    report += "\n---\n\n";
  }

  if (shortIssues.length > 0) {
    report += `## Short Headings (Info)\n\nHeadings with fewer than 3 words that are not common section names.\n\n| File | Line | Heading |\n|------|------|---------|\n`;
    for (const issue of shortIssues) {
      report += `| \`${issue.file}\` | ${issue.line} | ${issue.heading} |\n`;
    }
    report += "\n---\n\n";
  }

  if (dupeIssues.length > 0) {
    report += `## Duplicate Headings (Info)\n\nSame heading text appears more than once within a page.\n\n| File | Line | Heading |\n|------|------|---------|\n`;
    for (const issue of dupeIssues) {
      report += `| \`${issue.file}\` | ${issue.line} | ${issue.heading} |\n`;
    }
    report += "\n---\n\n";
  }

  if (issues.length === 0) {
    report += "No issues found. All headings look good!\n";
  }

  return report;
}

// Main
function main() {
  console.log("Heading Structure Audit");
  console.log("=======================\n");

  let allFiles: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const dirPath = path.join(ROOT, dir);
    const files = findMarkdownFiles(dirPath);
    console.log(`Found ${files.length} .md files in ${dir}/`);
    allFiles.push(...files);
  }

  console.log(`\nTotal files to audit: ${allFiles.length}\n`);

  let allIssues: Issue[] = [];
  for (const file of allFiles) {
    const issues = auditFile(file);
    allIssues.push(...issues);
  }

  // Generate report
  const report = generateReport(allIssues);

  // Update the "Files scanned" row
  const finalReport = report.replace(
    "| Files scanned | (see below) |",
    `| Files scanned | ${allFiles.length} |`
  );

  // Ensure output directory exists
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, finalReport, "utf-8");

  console.log(`Warnings: ${allIssues.filter((i) => i.type === "warning").length}`);
  console.log(`Info: ${allIssues.filter((i) => i.type === "info").length}`);
  console.log(`Total issues: ${allIssues.length}`);
  console.log(`\nReport written to: ${path.relative(ROOT, REPORT_PATH)}`);
}

main();
