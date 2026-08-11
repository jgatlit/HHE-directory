'use client';

/*
 * Global chrome — the production layout.tsx renders bare {children}, so there
 * is currently no header, no wordmark outside <title>, and no way for a listed
 * practitioner to reach their own edit page. This supplies all three.
 *
 * The header starts transparent over the hero field and settles into an opaque
 * navy bar once the field is behind it, so the wordmark never sits on a moving
 * background it cannot hold contrast against.
 *
 * D4: prefers-reduced-motion → the scrolled state still applies (it is a
 *     contrast requirement, not decoration) but without the transition.
 */

import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/frontier/Wordmark';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { SITE_URL, searchUrl } from '@/lib/search-url';
import { cn } from '@/lib/utils';

const NAV = [
  { label: 'Find a practitioner', href: searchUrl() },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'For practitioners', href: '#get-listed' },
];

export function SiteHeader() {
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      data-surface="field"
      className={cn(
        'fixed inset-x-0 top-0 z-50',
        reduced ? '' : 'transition-[background-color,box-shadow,backdrop-filter] duration-300',
        scrolled ? 'bg-[var(--ink)]/95 shadow-[0_1px_0_rgba(255,255,255,0.08)] backdrop-blur' : 'bg-transparent',
      )}
    >
      <a
        href="#main"
        className="sr-only rounded-md bg-white px-4 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10"
      >
        Skip to content
      </a>

      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="rounded-md" aria-label="Natural Health Pros — home">
          <Wordmark tone="inverse" animate />
        </a>

        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-md text-sm text-white/75 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/*
          Both actions stay in the bar at every width. Sign-in is the only door
          a listed practitioner has to their own profile, and Get listed is the
          entire paid funnel — hiding either behind a mobile menu would put the
          two things this header exists for one tap further away.
        */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <a
            href={`${SITE_URL}/auth/signin`}
            className="rounded-lg px-2 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
          >
            Sign in
          </a>
          <a
            href="#get-listed"
            className="whitespace-nowrap rounded-lg border border-white/25 px-2.5 py-2 text-sm text-white transition-colors hover:border-white/50 sm:px-3.5"
          >
            Get listed
          </a>
        </div>
      </div>
    </header>
  );
}
