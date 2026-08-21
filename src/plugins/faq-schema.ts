import type { Plugin } from '@docusaurus/types';
import * as fs from 'fs';
import * as path from 'path';

const FAQ_HEADING = /^(faq|frequently asked questions)$/i;
const MIN_ENTRIES = 2;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isNaN(value) ? match : String.fromCodePoint(value);
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|table|tr|td|th|blockquote|section)\b[^>]*>/gi;

function toText(html: string): string {
  // Block tags become spaces so paragraphs stay separated; inline tags such as
  // <code> are dropped outright so "<code>x</code>?" does not become "x ?".
  return decodeEntities(
    html
      .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
      // A titled code block renders its filename in a sibling div, which would
      // otherwise land mid-sentence as "in the headers: application.properties".
      .replace(/<div[^>]*codeBlockTitle[\s\S]*?<\/div>/gi, ' ')
      .replace(BLOCK_TAGS, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/​/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type Entry = { question: string; answer: string };

function extractFaq(html: string): Entry[] {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const faqIndex = headings.findIndex((h) => FAQ_HEADING.test(toText(h[1])));
  if (faqIndex === -1) return [];

  const start = headings[faqIndex].index + headings[faqIndex][0].length;
  const next = headings[faqIndex + 1];
  const section = html.slice(start, next ? next.index : html.length);

  // Questions are written either as h3 headings or, on older pages, as a
  // paragraph holding nothing but bold text.
  const questions = [
    ...section.matchAll(
      /<h3\b[^>]*>([\s\S]*?)<\/h3>|<p><strong>([\s\S]*?)<\/strong><\/p>/gi,
    ),
  ];
  const entries: Entry[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const heading = questions[i][1];
    const question = toText(heading ?? questions[i][2]);
    const from = questions[i].index + questions[i][0].length;
    const to = questions[i + 1] ? questions[i + 1].index : section.length;
    const answer = toText(section.slice(from, to));
    // Bold text only counts as a question when it reads as one; headings are
    // trusted as written.
    if (!question || !answer) continue;
    if (!heading && !question.endsWith('?')) continue;
    entries.push({ question, answer });
  }

  return entries;
}

function buildSchema(entries: Entry[]): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(
    /</g,
    '\\u003C',
  )}</script>`;
}

function findHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(fullPath));
    } else if (entry.name === 'index.html') {
      results.push(fullPath);
    }
  }
  return results;
}

export default function faqSchemaPlugin(): Plugin {
  return {
    name: 'faq-schema',

    async postBuild({ outDir }) {
      let pages = 0;
      let questions = 0;

      for (const filePath of findHtmlFiles(outDir)) {
        const html = fs.readFileSync(filePath, 'utf-8');
        const entries = extractFaq(html);
        if (entries.length < MIN_ENTRIES) continue;

        fs.writeFileSync(
          filePath,
          html.replace('</head>', `${buildSchema(entries)}</head>`),
        );
        pages += 1;
        questions += entries.length;
      }

      console.log(
        `[faq-schema] Generated FAQPage schema on ${pages} pages (${questions} questions)`,
      );
    },
  };
}
