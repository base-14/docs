import type { Element, ElementContent, Root, RootContent } from 'hast';

// Turns each question in a page's `## FAQ` section into a collapsible
// <details>, so long FAQs stop dominating the page. The markdown stays as
// plain `###` headings; the wrapping happens here at build time.
//
// The <h3> is kept inside <summary> on purpose: faq-schema.ts finds questions
// by their <h3>, heading ids keep working for anchors and the TOC, and
// onBrokenLinks still sees every id. MDX maps the emitted <details> to
// Docusaurus's Details component, which renders the answer into the HTML
// (lazy={false}), so crawlers and answer engines still read it.

const FAQ_HEADING = /^(faq|frequently asked questions)$/i;

function textOf(node: RootContent | ElementContent): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) {
    return (node.children as (RootContent | ElementContent)[])
      .map(textOf)
      .join('');
  }
  return '';
}

function isHeading(node: RootContent, tagName: string): node is Element {
  return node.type === 'element' && node.tagName === tagName;
}

function isFaqHeading(node: RootContent): node is Element {
  return isHeading(node, 'h2') && FAQ_HEADING.test(textOf(node).trim());
}

function wrap(question: Element, answer: RootContent[]): Element {
  return {
    type: 'element',
    tagName: 'details',
    properties: { className: ['faq-item'] },
    children: [
      {
        type: 'element',
        tagName: 'summary',
        properties: {},
        children: [question],
      },
      ...(answer as ElementContent[]),
    ],
  };
}

export default function rehypeFaqDetails() {
  return (tree: Root) => {
    const nodes = tree.children;
    const start = nodes.findIndex(isFaqHeading);
    if (start === -1) return;

    let end = nodes.findIndex((n, i) => i > start && isHeading(n, 'h2'));
    if (end === -1) end = nodes.length;

    const section = nodes.slice(start + 1, end);
    const output: RootContent[] = [];
    let i = 0;

    // Anything before the first question (an intro line) stays as it is.
    while (i < section.length && !isHeading(section[i], 'h3')) {
      output.push(section[i]);
      i += 1;
    }

    while (i < section.length) {
      const question = section[i] as Element;
      const answer: RootContent[] = [];
      i += 1;
      while (i < section.length && !isHeading(section[i], 'h3')) {
        answer.push(section[i]);
        i += 1;
      }
      output.push(wrap(question, answer));
    }

    nodes.splice(start + 1, end - start - 1, ...output);
  };
}
