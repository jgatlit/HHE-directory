/*
 * Footer — carries the two things the production site has nowhere to put: the
 * client's corporate-identity paragraph (which names Holistic Health Network,
 * LLC and Holistic Health Educators, PMA — two entities the codebase has never
 * named) and the disclaimer.
 *
 * The disclaimer is use-as-written. It is set at body size, not in 10px grey,
 * because a medical disclaimer that has been visually minimised is a disclaimer
 * that was not really made.
 */

import { Wordmark, FilamentRule } from '@/components/frontier/Wordmark';
import { disclaimer, footerIdentity, socialProofMotif } from '@/content/copy';
import { SITE_URL, searchUrl } from '@/lib/search-url';

const COLUMNS = [
  {
    heading: 'Find care',
    links: [
      { label: 'Search the directory', href: searchUrl() },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'What this is, and is not', href: '#scope' },
    ],
  },
  {
    heading: 'For practitioners',
    links: [
      { label: 'Get listed', href: '#get-listed' },
      { label: 'Sign in', href: `${SITE_URL}/auth/signin` },
      { label: 'Holistic Health Educators', href: 'https://www.holistichealtheducators.com/' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-[var(--accent)]/50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-12 md:grid-cols-[1.4fr_repeat(2,minmax(0,1fr))]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {footerIdentity[0]}
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {footerIdentity[1]}
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="eyebrow text-muted-foreground">{col.heading}</h2>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="rounded text-sm text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-12 text-center text-sm tracking-wide text-[var(--sage-deep)]">
          {socialProofMotif}
        </p>

        <FilamentRule className="my-8" />

        <section
          aria-label="Medical disclaimer"
          className="rounded-xl border border-border bg-white p-5 sm:p-6"
        >
          <p className="text-[0.9375rem] leading-relaxed text-foreground/85">
            <strong className="font-semibold">DISCLAIMER:</strong>{' '}
            {disclaimer.replace(/^DISCLAIMER:\s*/, '')}
          </p>
        </section>

        <p className="mt-8 text-xs text-muted-foreground">
          © {new Date().getFullYear()} Holistic Health Network, LLC. Natural Health Pros is a
          directory of independent practitioners.
        </p>
      </div>
    </footer>
  );
}
