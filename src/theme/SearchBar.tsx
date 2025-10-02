import React, { useEffect } from 'react';
import SearchBar from '@theme-original/SearchBar';

export default function SearchBarWrapper(props: Record<string, unknown>) {
  useEffect(() => {
    // Track Algolia DocSearch events
    const trackSearch = (query: string) => {
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'search', {
          search_term: query,
          event_category: 'engagement',
          event_label: 'documentation_search',
        });
      }
    };

    // Listen for DocSearch input events
    const handleDocSearchInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      if (target && target.value && target.value.length > 2) {
        // Debounce to avoid too many events
        clearTimeout((window as any).searchDebounce);
        (window as any).searchDebounce = setTimeout(() => {
          trackSearch(target.value);
        }, 1000);
      }
    };

    // Attach listener to DocSearch input
    const docSearchInput = document.querySelector('.DocSearch-Input');
    if (docSearchInput) {
      docSearchInput.addEventListener('input', handleDocSearchInput);
    }

    return () => {
      if (docSearchInput) {
        docSearchInput.removeEventListener('input', handleDocSearchInput);
      }
    };
  }, []);

  return <SearchBar {...props} />;
}
