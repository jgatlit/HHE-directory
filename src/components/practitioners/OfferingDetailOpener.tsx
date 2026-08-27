'use client';

import { useEffect } from 'react';

/**
 * PROGRESSIVE ENHANCEMENT for the left-pane Offerings rail (§4).
 *
 * The rail's entries are anchors into the right pane's `<details>` cards. Without JavaScript the
 * browser already does the useful half — it scrolls the card into view — so this component only
 * adds the second half: opening the card so the description and the booking CTA are visible
 * without a second click.
 *
 * It is deliberately NOT a selection model. Making the rail drive client state would have put the
 * offering description and its `Book Now` behind `open === false` in the server-rendered HTML, on
 * a public SEO-driven directory where that copy is the highest-intent text on the page — and it
 * would have made booking unreachable with JavaScript off. Everything here is additive; delete
 * this file and the rail still works, just less smoothly.
 */
export function OfferingDetailOpener() {
  useEffect(() => {
    function openFromHash() {
      const id = window.location.hash.slice(1);
      if (!id.startsWith('offering-')) return;

      // `getElementById` rather than `querySelector('#'+id)`: an offering id is a cuid and is safe
      // today, but it reaches this string from the URL bar, and getElementById needs no escaping.
      const target = document.getElementById(id);
      const details = target?.tagName === 'DETAILS' ? target : target?.querySelector('details');
      if (details instanceof HTMLDetailsElement) {
        details.open = true;
        // Re-scroll AFTER opening: the browser's own anchor jump happened while the card was
        // still collapsed, so on a long page it lands short of where the content now sits.
        details.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  return null;
}
