import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

const ROOT = path.resolve(__dirname, "../..");
const REPORT_PATH = path.join(ROOT, ".specs/seo-reports/frontmatter-audit.md");

interface Issue {
  severity: "critical" | "warning" | "info";
  file: string;
  field: string;
  current: string;
  recommendation: string;
}

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) {
      results.push(fullPath);
    }
  }
  return results;
}

function isBlogPost(filePath: string): boolean {
  return filePath.includes("/blog/");
}

function audit(filePath: string): Issue[] {
  const issues: Issue[] = [];
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, "utf-8");

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = matter(content).data;
  } catch {
    issues.push({
      severity: "critical",
      file: rel,
      field: "frontmatter",
      current: "parse error",
      recommendation: "Fix frontmatter YAML syntax",
    });
    return issues;
  }

  // Skip category JSON files or files without frontmatter
  if (Object.keys(frontmatter).length === 0) {
    return issues;
  }

  const title = frontmatter.title as string | undefined;
  const description = frontmatter.description as string | undefined;
  const keywords = frontmatter.keywords as string[] | undefined;
  const image = frontmatter.image as string | undefined;

  // Title checks
  if (!title) {
    issues.push({
      severity: "critical",
      file: rel,
      field: "title",
      current: "(missing)",
      recommendation: "Add a descriptive title targeting primary keyword",
    });
  } else if (title.length < 20) {
    issues.push({
      severity: "info",
      file: rel,
      field: "title",
      current: `"${title}" (${title.length} chars)`,
      recommendation:
        "Consider expanding title to be more descriptive (20-60 chars ideal)",
    });
  } else if (title.length > 60) {
    issues.push({
      severity: "info",
      file: rel,
      field: "title",
      current: `"${title}" (${title.length} chars)`,
      recommendation:
        "Title may be truncated in SERP. Consider shortening to <60 chars",
    });
  }

  // Description checks
  if (!description) {
    issues.push({
      severity: "critical",
      file: rel,
      field: "description",
      current: "(missing)",
      recommendation:
        "Add a keyword-rich description (120-155 chars) summarizing page content",
    });
  } else if (description.length < 50) {
    issues.push({
      severity: "warning",
      file: rel,
      field: "description",
      current: `(${description.length} chars) "${description}"`,
      recommendation:
        "Expand description to 120-155 chars with target keywords",
    });
  } else if (description.length > 160) {
    issues.push({
      severity: "warning",
      file: rel,
      field: "description",
      current: `(${description.length} chars)`,
      recommendation: "Trim description to <160 chars to avoid SERP truncation",
    });
  }

  // Keywords checks
  if (!keywords) {
    issues.push({
      severity: isBlogPost(filePath) ? "info" : "warning",
      file: rel,
      field: "keywords",
      current: "(missing)",
      recommendation: "Add keywords array with 5-10 relevant search terms",
    });
  } else if (Array.isArray(keywords) && keywords.length === 0) {
    issues.push({
      severity: "warning",
      file: rel,
      field: "keywords",
      current: "(empty array)",
      recommendation: "Add 5-10 relevant keywords",
    });
  }

  // Blog-specific: image check
  if (isBlogPost(filePath) && !image) {
    issues.push({
      severity: "warning",
      file: rel,
      field: "image",
      current: "(missing)",
      recommendation:
        "Add image field for social sharing (e.g., image: ./cover.png)",
    });
  }

  return issues;
}

function main() {
  const dirs = ["docs", "blog", "scope"].map((d) => path.join(ROOT, d));
  const allFiles = dirs.flatMap(findMarkdownFiles);

  console.log(`Scanning ${allFiles.length} markdown files...`);

  const allIssues = allFiles.flatMap(audit);

  const critical = allIssues.filter((i) => i.severity === "critical");
  const warnings = allIssues.filter((i) => i.severity === "warning");
  const info = allIssues.filter((i) => i.severity === "info");

  const lines: string[] = [];
  lines.push("# Frontmatter SEO Audit Report");
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString().split("T")[0]}`);
  lines.push(`**Files scanned:** ${allFiles.length}`);
  lines.push(
    `**Issues found:** ${allIssues.length} (${critical.length} critical, ${warnings.length} warnings, ${info.length} info)`
  );
  lines.push("");

  const writeSection = (title: string, issues: Issue[]) => {
    lines.push(`## ${title} (${issues.length})`);
    lines.push("");
    if (issues.length === 0) {
      lines.push("None found.");
      lines.push("");
      return;
    }
    lines.push("| File | Field | Current | Recommendation |");
    lines.push("|------|-------|---------|----------------|");
    for (const issue of issues) {
      const current = issue.current.replace(/\|/g, "\\|");
      const rec = issue.recommendation.replace(/\|/g, "\\|");
      lines.push(`| \`${issue.file}\` | ${issue.field} | ${current} | ${rec} |`);
    }
    lines.push("");
  };

  writeSection("Critical", critical);
  writeSection("Warnings", warnings);
  writeSection("Info", info);

  const report = lines.join("\n");
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`Report written to ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(
    `Summary: ${critical.length} critical, ${warnings.length} warnings, ${info.length} info`
  );
}

main();
