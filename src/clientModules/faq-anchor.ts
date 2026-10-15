import type { ClientModule } from '@docusaurus/types';

// FAQ answers are collapsed (see rehype-faq-details.ts). When a link or the
// table of contents points at a question, open it so the reader lands on the
// answer and not just the heading.
//
// Docusaurus's Details component keeps its own open state, so setting the
// `open` attribute directly would desync it; clicking the summary goes
// through its handler instead.
function openFaqForHash(hash: string): void {
  if (!hash) return;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  const details = target?.closest('details.faq-item');
  if (!details || details.getAttribute('data-collapsed') !== 'true') return;
  details.querySelector('summary')?.click();
}

const module: ClientModule = {
  onRouteDidUpdate({ location }) {
    // Wait a frame so the page's DOM is in place after navigation.
    requestAnimationFrame(() => openFaqForHash(location.hash));
  },
};

export default module;
