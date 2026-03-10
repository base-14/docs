import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const REPORTS_DIR = path.join(ROOT, ".specs/seo-reports");
const QUERIES_CSV = path.join(REPORTS_DIR, "Queries.csv");
const PAGES_CSV = path.join(REPORTS_DIR, "Pages.csv");
const REPORT_PATH = path.join(REPORTS_DIR, "gsc-analysis.md");

interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function parseCSV<T>(filePath: string, parser: (cols: string[]) => T): T[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Handle quoted fields with commas
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cols.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cols.push(current.trim());

    if (cols.length >= 5) {
      try {
        results.push(parser(cols));
      } catch {
        // skip malformed rows
      }
    }
  }
  return results;
}

function parsePct(s: string): number {
  return parseFloat(s.replace("%", "")) || 0;
}

function main() {
  if (!fs.existsSync(QUERIES_CSV)) {
    console.error(`Queries CSV not found at ${QUERIES_CSV}`);
    process.exit(1);
  }
  if (!fs.existsSync(PAGES_CSV)) {
    console.error(`Pages CSV not found at ${PAGES_CSV}`);
    process.exit(1);
  }

  const queries = parseCSV<QueryRow>(QUERIES_CSV, (cols) => ({
    query: cols[0],
    clicks: parseInt(cols[1]) || 0,
    impressions: parseInt(cols[2]) || 0,
    ctr: parsePct(cols[3]),
    position: parseFloat(cols[4]) || 0,
  }));

  const pages = parseCSV<PageRow>(PAGES_CSV, (cols) => ({
    page: cols[0],
    clicks: parseInt(cols[1]) || 0,
    impressions: parseInt(cols[2]) || 0,
    ctr: parsePct(cols[3]),
    position: parseFloat(cols[4]) || 0,
  }));

  // Filter to docs.base14.io pages only
  const docsPages = pages.filter((p) =>
    p.page.startsWith("https://docs.base14.io")
  );

  const lines: string[] = [];
  lines.push("# Google Search Console Analysis");
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString().split("T")[0]}`);
  lines.push(`**Period:** Last 3 months`);
  lines.push(`**Total queries:** ${queries.length}`);
  lines.push(`**Total pages:** ${pages.length} (${docsPages.length} on docs.base14.io)`);
  lines.push("");

  // ─── Overall stats ───
  const totalClicks = docsPages.reduce((s, p) => s + p.clicks, 0);
  const totalImpressions = docsPages.reduce((s, p) => s + p.impressions, 0);
  const avgCTR = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0";

  lines.push("## Overall Stats (docs.base14.io)");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total clicks | ${totalClicks} |`);
  lines.push(`| Total impressions | ${totalImpressions.toLocaleString()} |`);
  lines.push(`| Average CTR | ${avgCTR}% |`);
  lines.push(`| Pages with clicks | ${docsPages.filter((p) => p.clicks > 0).length} |`);
  lines.push(`| Pages with 0 clicks | ${docsPages.filter((p) => p.clicks === 0).length} |`);
  lines.push("");

  // ─── Top performing pages ───
  lines.push("## Top Performing Pages (by clicks)");
  lines.push("");
  lines.push("These pages are already driving traffic. Protect and improve them.");
  lines.push("");
  lines.push("| Page | Clicks | Impressions | CTR | Position |");
  lines.push("|------|--------|-------------|-----|----------|");
  const topByClicks = [...docsPages].sort((a, b) => b.clicks - a.clicks).slice(0, 20);
  for (const p of topByClicks) {
    const shortPage = p.page.replace("https://docs.base14.io", "");
    lines.push(
      `| \`${shortPage}\` | ${p.clicks} | ${p.impressions.toLocaleString()} | ${p.ctr}% | ${p.position.toFixed(1)} |`
    );
  }
  lines.push("");

  // ─── CTR Optimization Opportunities ───
  // Pages with high impressions but low CTR — title/description needs work
  lines.push("## CTR Optimization Opportunities");
  lines.push("");
  lines.push("Pages with **>500 impressions but <1% CTR**. Improving title and meta description can increase clicks without changing rankings.");
  lines.push("");
  lines.push("| Page | Impressions | Clicks | CTR | Position | Action |");
  lines.push("|------|-------------|--------|-----|----------|--------|");
  const ctrOpps = docsPages
    .filter((p) => p.impressions > 500 && p.ctr < 1)
    .sort((a, b) => b.impressions - a.impressions);
  for (const p of ctrOpps) {
    const shortPage = p.page.replace("https://docs.base14.io", "");
    const action =
      p.position <= 10
        ? "Rewrite title + description (already on page 1)"
        : p.position <= 20
          ? "Optimize title + improve content"
          : "Improve content + build links";
    lines.push(
      `| \`${shortPage}\` | ${p.impressions.toLocaleString()} | ${p.clicks} | ${p.ctr}% | ${p.position.toFixed(1)} | ${action} |`
    );
  }
  lines.push("");

  // ─── Striking Distance Keywords ───
  // Queries ranking 5-20 with meaningful impressions
  lines.push("## Striking Distance Keywords (Position 5-20)");
  lines.push("");
  lines.push("Queries where you're close to page 1. Small optimizations can push these up.");
  lines.push("");
  lines.push("| Query | Impressions | Clicks | CTR | Position |");
  lines.push("|-------|-------------|--------|-----|----------|");
  const strikingDistance = queries
    .filter((q) => q.position >= 5 && q.position <= 20 && q.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 40);
  for (const q of strikingDistance) {
    lines.push(
      `| ${q.query} | ${q.impressions.toLocaleString()} | ${q.clicks} | ${q.ctr}% | ${q.position.toFixed(1)} |`
    );
  }
  lines.push("");

  // ─── High Impression, Zero Click Queries ───
  lines.push("## High Impression, Zero Click Queries");
  lines.push("");
  lines.push("Queries with high impressions but 0 clicks — you're showing up but nobody clicks. Either ranking too low or title/description isn't compelling.");
  lines.push("");
  lines.push("| Query | Impressions | Position | Opportunity |");
  lines.push("|-------|-------------|----------|-------------|");
  const zeroClickHighImp = queries
    .filter((q) => q.clicks === 0 && q.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 30);
  for (const q of zeroClickHighImp) {
    const opp =
      q.position <= 10
        ? "HIGH — on page 1, fix title/description"
        : q.position <= 20
          ? "MEDIUM — near page 1, optimize content + meta"
          : "LOW — need significant ranking improvement";
    lines.push(
      `| ${q.query} | ${q.impressions.toLocaleString()} | ${q.position.toFixed(1)} | ${opp} |`
    );
  }
  lines.push("");

  // ─── Striking Distance Pages ───
  lines.push("## Striking Distance Pages (Position 5-15)");
  lines.push("");
  lines.push("Pages ranking positions 5-15 with meaningful impressions. These are closest to breaking into top positions.");
  lines.push("");
  lines.push("| Page | Impressions | Clicks | CTR | Position |");
  lines.push("|------|-------------|--------|-----|----------|");
  const strikingPages = docsPages
    .filter((p) => p.position >= 5 && p.position <= 15 && p.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);
  for (const p of strikingPages) {
    const shortPage = p.page.replace("https://docs.base14.io", "");
    lines.push(
      `| \`${shortPage}\` | ${p.impressions.toLocaleString()} | ${p.clicks} | ${p.ctr}% | ${p.position.toFixed(1)} |`
    );
  }
  lines.push("");

  // ─── Quick Win Summary ───
  lines.push("## Quick Win Summary");
  lines.push("");
  lines.push("### Priority 1: CTR Fixes (highest impact, easiest to implement)");
  lines.push("");
  lines.push("These pages already rank well but have terrible CTR. Rewriting title + description alone can 2-5x clicks:");
  lines.push("");
  const p1 = docsPages
    .filter((p) => p.impressions > 1000 && p.ctr < 0.5 && p.position <= 12)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  for (const p of p1) {
    const shortPage = p.page.replace("https://docs.base14.io", "");
    const potentialClicks = Math.round(p.impressions * 0.03); // 3% CTR target
    lines.push(
      `- \`${shortPage}\` — ${p.impressions.toLocaleString()} impressions, ${p.ctr}% CTR (position ${p.position.toFixed(1)}). **Potential: ~${potentialClicks} clicks/quarter at 3% CTR**`
    );
  }
  lines.push("");

  lines.push("### Priority 2: Striking Distance Content (position 8-20)");
  lines.push("");
  lines.push("These pages need content improvement + better keywords to break into top 5:");
  lines.push("");
  const p2 = docsPages
    .filter((p) => p.position > 8 && p.position <= 20 && p.impressions > 500)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  for (const p of p2) {
    const shortPage = p.page.replace("https://docs.base14.io", "");
    lines.push(
      `- \`${shortPage}\` — ${p.impressions.toLocaleString()} impressions at position ${p.position.toFixed(1)}`
    );
  }
  lines.push("");

  lines.push("### Priority 3: High-Impression Zero-Click Queries");
  lines.push("");
  lines.push("Create or optimize content specifically targeting these queries:");
  lines.push("");
  const p3 = queries
    .filter((q) => q.clicks === 0 && q.impressions >= 200)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  for (const q of p3) {
    lines.push(
      `- **"${q.query}"** — ${q.impressions.toLocaleString()} impressions, position ${q.position.toFixed(1)}`
    );
  }
  lines.push("");

  const report = lines.join("\n");
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`Report written to ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(
    `\nKey stats: ${totalClicks} clicks, ${totalImpressions.toLocaleString()} impressions, ${avgCTR}% avg CTR`
  );
  console.log(`CTR opportunities: ${ctrOpps.length} pages`);
  console.log(`Striking distance keywords: ${strikingDistance.length}`);
  console.log(`Zero-click high-impression queries: ${zeroClickHighImp.length}`);
}

main();
