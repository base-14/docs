import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

// ---------- configuration ----------
const ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIRS = ["docs", "blog", "scope"];
const REPORT_DIR = path.join(ROOT, ".specs", "seo-reports");
const REPORT_PATH = path.join(REPORT_DIR, "internal-links-audit.md");

const BAD_ANCHOR_TEXTS = new Set([
  "here",
  "this",
  "link",
  "click here",
  "click",
  "read more",
]);

// ---------- types ----------
interface InternalLink {
  targetUrl: string;
  anchorText: string;
  line: number;
}

interface PageInfo {
  filePath: string; // relative to ROOT
  urlPath: string;
  section: string; // "docs" | "blog" | "scope"
  outboundLinks: InternalLink[];
  inboundCount: number;
}

// ---------- helpers ----------

/** Recursively find all .md and .mdx files in a directory */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/** Convert a file path (relative to ROOT) to its URL path on the site */
function filePathToUrl(relPath: string, frontmatterSlug?: string): string {
  const parts = relPath.split(path.sep);
  const section = parts[0]; // docs | blog | scope

  if (section === "blog") {
    // Blog posts: blog/YYYY-MM-DD-slug/index.md -> /blog/slug/
    const dirName = parts[1] || "";
    // Extract slug from frontmatter first, then from directory name
    if (frontmatterSlug) {
      return `/blog/${frontmatterSlug}/`;
    }
    // Directory pattern: YYYY-MM-DD-slug
    const match = dirName.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    if (match) {
      return `/blog/${match[1]}/`;
    }
    return `/blog/${dirName}/`;
  }

  if (section === "docs") {
    // docs/foo/bar.md -> /foo/bar/
    // docs/foo/index.md -> /foo/
    const subParts = parts.slice(1); // remove "docs"
    const fileName = subParts[subParts.length - 1];
    const isIndex = /^index\.mdx?$/.test(fileName);

    if (isIndex) {
      const dirParts = subParts.slice(0, -1);
      return `/${dirParts.join("/")}/`;
    }
    // Remove extension
    const base = fileName.replace(/\.mdx?$/, "");
    const dirParts = subParts.slice(0, -1);
    return `/${[...dirParts, base].join("/")}/`;
  }

  if (section === "scope") {
    // scope/foo/bar.md -> /scope/foo/bar/
    // scope/foo/index.md -> /scope/foo/
    const subParts = parts.slice(1); // remove "scope"
    const fileName = subParts[subParts.length - 1];
    const isIndex = /^index\.mdx?$/.test(fileName);

    if (isIndex) {
      const dirParts = subParts.slice(0, -1);
      return `/scope/${dirParts.join("/")}/`;
    }
    const base = fileName.replace(/\.mdx?$/, "");
    const dirParts = subParts.slice(0, -1);
    return `/scope/${[...dirParts, base].join("/")}/`;
  }

  // Fallback
  return `/${relPath.replace(/\.mdx?$/, "")}/`;
}

/** Check if a frontmatter slug field provides a usable slug string */
function extractFrontmatterSlug(data: Record<string, unknown>): string | undefined {
  if (typeof data.slug === "string" && data.slug.length > 0) {
    // Remove leading slash if present
    return data.slug.replace(/^\//, "");
  }
  return undefined;
}

/** Parse markdown content and extract internal links */
function extractInternalLinks(content: string): InternalLink[] {
  const links: InternalLink[] = [];
  const lines = content.split("\n");

  // Match markdown links: [text](url)
  // Also match [text](url "title")
  const linkRegex = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    linkRegex.lastIndex = 0;

    while ((match = linkRegex.exec(line)) !== null) {
      const anchorText = match[1];
      const url = match[2];

      // Skip external links
      if (/^https?:\/\//i.test(url)) continue;
      // Skip mailto links
      if (/^mailto:/i.test(url)) continue;
      // Skip anchor-only links
      if (url.startsWith("#")) continue;
      // Skip image references and other non-page links
      if (/\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|zip)$/i.test(url)) continue;

      // This is an internal link (starts with / or is relative)
      links.push({
        targetUrl: url,
        anchorText,
        line: i + 1,
      });
    }
  }

  return links;
}

/** Normalize a URL for comparison: strip trailing slash, anchor, and query */
function normalizeUrl(url: string): string {
  let normalized = url.split("#")[0].split("?")[0];
  // Remove trailing slash for comparison (but keep "/" as is)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

// ---------- main ----------

function main() {
  const pages = new Map<string, PageInfo>();
  // Also build a set of known URL paths for validation
  const knownUrls = new Set<string>();

  // 1. Discover all pages and compute their URLs
  for (const dir of CONTENT_DIRS) {
    const absDir = path.join(ROOT, dir);
    const files = findMarkdownFiles(absDir);

    for (const file of files) {
      const relPath = path.relative(ROOT, file);
      const rawContent = fs.readFileSync(file, "utf-8");
      const { data } = matter(rawContent);

      const fmSlug = dir === "blog" ? extractFrontmatterSlug(data) : extractFrontmatterSlug(data);
      const urlPath = filePathToUrl(relPath, fmSlug);

      pages.set(relPath, {
        filePath: relPath,
        urlPath,
        section: dir,
        outboundLinks: [],
        inboundCount: 0,
      });

      knownUrls.add(normalizeUrl(urlPath));
    }
  }

  // 2. Parse links from each page
  for (const [relPath, page] of pages) {
    const absPath = path.join(ROOT, relPath);
    const rawContent = fs.readFileSync(absPath, "utf-8");
    const { content } = matter(rawContent);
    page.outboundLinks = extractInternalLinks(content);
  }

  // 3. Count inbound links
  // Build a reverse lookup: normalized URL -> relPath
  const urlToRelPath = new Map<string, string>();
  for (const [relPath, page] of pages) {
    urlToRelPath.set(normalizeUrl(page.urlPath), relPath);
  }

  for (const [, page] of pages) {
    for (const link of page.outboundLinks) {
      let targetNorm: string;

      if (link.targetUrl.startsWith("/")) {
        targetNorm = normalizeUrl(link.targetUrl);
      } else {
        // Relative link — resolve from the page's URL directory
        const pageDir = page.urlPath.endsWith("/")
          ? page.urlPath
          : path.posix.dirname(page.urlPath) + "/";
        const resolved = path.posix.resolve(pageDir, link.targetUrl);
        targetNorm = normalizeUrl(resolved);
      }

      const targetRelPath = urlToRelPath.get(targetNorm);
      if (targetRelPath) {
        const targetPage = pages.get(targetRelPath);
        if (targetPage) {
          targetPage.inboundCount++;
        }
      }
    }
  }

  // 4. Analysis
  const allPages = Array.from(pages.values());
  const totalPages = allPages.length;
  const totalLinks = allPages.reduce((sum, p) => sum + p.outboundLinks.length, 0);
  const avgLinks = totalPages > 0 ? (totalLinks / totalPages).toFixed(1) : "0";

  // Orphan pages (0 inbound)
  const orphanPages = allPages
    .filter((p) => p.inboundCount === 0)
    .sort((a, b) => a.section.localeCompare(b.section) || a.filePath.localeCompare(b.filePath));

  // Low-linked pages (1-2 inbound)
  const lowLinkedPages = allPages
    .filter((p) => p.inboundCount >= 1 && p.inboundCount <= 2)
    .sort((a, b) => a.section.localeCompare(b.section) || a.filePath.localeCompare(b.filePath));

  // Cross-section analysis
  let blogToDocs = 0;
  let docsToBlogs = 0;
  let blogToScope = 0;
  let scopeToBlog = 0;
  let docsToScope = 0;
  let scopeToDocs = 0;

  for (const [, page] of pages) {
    for (const link of page.outboundLinks) {
      let targetUrl = link.targetUrl;
      // Resolve relative links
      if (!targetUrl.startsWith("/")) {
        const pageDir = page.urlPath.endsWith("/")
          ? page.urlPath
          : path.posix.dirname(page.urlPath) + "/";
        targetUrl = path.posix.resolve(pageDir, targetUrl);
      }

      const targetSection = getUrlSection(targetUrl);
      if (!targetSection) continue;

      if (page.section === "blog" && targetSection === "docs") blogToDocs++;
      if (page.section === "docs" && targetSection === "blog") docsToBlogs++;
      if (page.section === "blog" && targetSection === "scope") blogToScope++;
      if (page.section === "scope" && targetSection === "blog") scopeToBlog++;
      if (page.section === "docs" && targetSection === "scope") docsToScope++;
      if (page.section === "scope" && targetSection === "docs") scopeToDocs++;
    }
  }

  // Anchor text issues
  interface AnchorIssue {
    filePath: string;
    line: number;
    anchorText: string;
    targetUrl: string;
  }
  const anchorIssues: AnchorIssue[] = [];

  for (const [, page] of pages) {
    for (const link of page.outboundLinks) {
      if (BAD_ANCHOR_TEXTS.has(link.anchorText.toLowerCase().trim())) {
        anchorIssues.push({
          filePath: page.filePath,
          line: link.line,
          anchorText: link.anchorText,
          targetUrl: link.targetUrl,
        });
      }
    }
  }

  // 5. Generate report
  const sectionCounts = {
    docs: allPages.filter((p) => p.section === "docs").length,
    blog: allPages.filter((p) => p.section === "blog").length,
    scope: allPages.filter((p) => p.section === "scope").length,
  };

  const now = new Date().toISOString().split("T")[0];

  let report = `# Internal Links Audit Report

Generated: ${now}

## Summary

| Metric | Value |
|--------|-------|
| Total pages | ${totalPages} |
| — docs | ${sectionCounts.docs} |
| — blog | ${sectionCounts.blog} |
| — scope | ${sectionCounts.scope} |
| Total internal links | ${totalLinks} |
| Avg links per page | ${avgLinks} |
| Orphan pages (0 inbound) | ${orphanPages.length} |
| Low-linked pages (1–2 inbound) | ${lowLinkedPages.length} |
| Anchor text issues | ${anchorIssues.length} |

## Orphan Pages (0 inbound links)

These pages have no internal links pointing to them. This is critical for both
SEO (search engines may not discover them) and user navigation.

| Section | File | URL |
|---------|------|-----|
`;

  for (const p of orphanPages) {
    report += `| ${p.section} | \`${p.filePath}\` | \`${p.urlPath}\` |\n`;
  }

  report += `
## Low-Linked Pages (1–2 inbound links)

These pages have minimal internal linking. Consider adding more contextual links
from related content.

| Section | File | URL | Inbound |
|---------|------|-----|---------|
`;

  for (const p of lowLinkedPages) {
    report += `| ${p.section} | \`${p.filePath}\` | \`${p.urlPath}\` | ${p.inboundCount} |\n`;
  }

  report += `
## Cross-Section Linking

| Direction | Count |
|-----------|-------|
| Blog → Docs | ${blogToDocs} |
| Docs → Blog | ${docsToBlogs} |
| Blog → Scope | ${blogToScope} |
| Scope → Blog | ${scopeToBlog} |
| Docs → Scope | ${docsToScope} |
| Scope → Docs | ${scopeToDocs} |

`;

  if (anchorIssues.length > 0) {
    report += `## Anchor Text Issues

Generic anchor text like "here" or "click here" provides no SEO value and hurts
accessibility. Use descriptive text that tells the reader what the link leads to.

| File | Line | Anchor Text | Target |
|------|------|-------------|--------|
`;
    for (const issue of anchorIssues) {
      report += `| \`${issue.filePath}\` | ${issue.line} | "${issue.anchorText}" | \`${issue.targetUrl}\` |\n`;
    }
  } else {
    report += `## Anchor Text Issues\n\nNo anchor text issues found.\n`;
  }

  report += `
---

*Report generated by \`scripts/seo/audit-internal-links.ts\`*
`;

  // 6. Write report
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, report, "utf-8");

  // 7. Console summary
  console.log(`Internal Links Audit Complete`);
  console.log(`  Total pages: ${totalPages}`);
  console.log(`  Total internal links: ${totalLinks}`);
  console.log(`  Avg links/page: ${avgLinks}`);
  console.log(`  Orphan pages: ${orphanPages.length}`);
  console.log(`  Low-linked pages: ${lowLinkedPages.length}`);
  console.log(`  Anchor text issues: ${anchorIssues.length}`);
  console.log(`  Report written to: ${REPORT_PATH}`);
}

function getUrlSection(url: string): string | null {
  // Docs URLs don't have a /docs/ prefix - they're at root like /getting-started/
  // Blog URLs start with /blog/
  // Scope URLs start with /scope/
  if (url.startsWith("/blog/") || url === "/blog") return "blog";
  if (url.startsWith("/scope/") || url === "/scope") return "scope";
  // Everything else under / that isn't blog or scope is docs
  if (url.startsWith("/")) return "docs";
  return null;
}

main();
