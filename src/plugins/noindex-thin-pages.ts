import type { Plugin } from '@docusaurus/types';
import * as fs from 'fs';
import * as path from 'path';

const NOINDEX_PATTERNS = [
  /^\/blog\/tags(\/|$)/,
  /^\/blog\/page\//,
  /^\/blog\/archive(\/|$)/,
  /^\/blog\/authors(\/|$)/,
  /^\/category\//,
  /^\/tags(\/|$)/,
];

function shouldNoIndex(urlPath: string): boolean {
  return NOINDEX_PATTERNS.some((pattern) => pattern.test(urlPath));
}

function findHtmlFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(fullPath, baseDir));
    } else if (entry.name === 'index.html') {
      results.push(fullPath);
    }
  }
  return results;
}

export default function noindexThinPagesPlugin(): Plugin {
  return {
    name: 'noindex-thin-pages',

    async postBuild({ outDir }) {
      const htmlFiles = findHtmlFiles(outDir, outDir);
      let count = 0;

      for (const filePath of htmlFiles) {
        const relativePath = '/' + path.relative(outDir, path.dirname(filePath));
        const urlPath = relativePath === '/.' ? '/' : relativePath;

        if (!shouldNoIndex(urlPath)) continue;

        let html = fs.readFileSync(filePath, 'utf-8');

        if (html.includes('name="robots"')) {
          html = html.replace(
            /(<meta\s+name="robots"\s+content=")([^"]*)(">)/,
            '$1noindex, follow$3',
          );
        } else {
          html = html.replace(
            '</head>',
            '<meta name="robots" content="noindex, follow">\n</head>',
          );
        }

        fs.writeFileSync(filePath, html);
        count++;
      }

      console.log(`[noindex-thin-pages] Injected noindex into ${count} pages`);
    },
  };
}
