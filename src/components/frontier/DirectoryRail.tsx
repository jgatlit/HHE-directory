'use client';

/*
 * Class 3 — MODERN ANIMATION.
 *
 * Real practitioners, real headshots, real specialties, pulled from the live
 * directory. The rail scrubs gently against scroll and the cards stagger in;
 * it deliberately does NOT pin the page and hijack the scroll. On a page that
 * carries a medical disclaimer, taking the scrollbar away from someone reading
 * about their own health is the wrong kind of impressive.
 *
 * The rail is a native horizontal scroller underneath the animation, so it is
 * draggable, wheel-scrollable, and keyboard-reachable with no JS at all.
 *
 * D4: prefers-reduced-motion → no GSAP context is created. Cards render at
 *     full opacity in final position and the rail still scrolls natively.
 * D7: N/A — DOM and CSS only, no external pipeline stage to fail. Missing
 *     headshots are data, not failure: the initials plate is the designed
 *     state for a practitioner who has not uploaded a photo.
 */

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { revealWhenVisible } from '@/lib/reveal';
import type { DirectoryPractitioner } from '@/lib/directory';
import { profileUrl } from '@/lib/search-url';
import { framingStyle, normalizeFraming } from '@/lib/photo-framing';

function initials(name: string) {
  return name
    .replace(/^Dr\.\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Framing for one card — normalised, so a bad row renders centred rather than blank. */
const framingOf = (p: { photoFocalX: number; photoFocalY: number; photoZoom: number }) =>
  normalizeFraming(p);

export function DirectoryRail({ practitioners }: { practitioners: DirectoryPractitioner[] }) {
  const reduced = useReducedMotion();
  const railRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const rail = railRef.current;
    if (reduced || !section || !rail) return;

    gsap.registerPlugin(ScrollTrigger);
    const cards = Array.from(section.querySelectorAll<HTMLElement>('[data-rail-card]'));

    // Opt into the hidden state from JS, never from the markup, so a card is
    // only ever hidden while something is guaranteed to bring it back.
    gsap.set(cards, { y: 28, opacity: 0 });

    const ctx = gsap.context(() => {
      // Counter-drift as the section crosses the viewport. Transform only —
      // if this scrub never runs, nothing is hidden by it.
      gsap.to(rail, {
        x: -60,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom top', scrub: 0.8 },
      });
    }, sectionRef);

    const cancel = revealWhenVisible(
      section,
      () => {
        gsap.to(cards, { y: 0, opacity: 1, duration: 0.7, stagger: 0.07, ease: 'power2.out' });
      },
      { threshold: 0.15 },
    );

    return () => {
      cancel();
      ctx.revert();
      gsap.set(cards, { clearProps: 'opacity,transform' });
    };
  }, [reduced]);

  return (
    <div ref={sectionRef}>
      <ul
        ref={railRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 [scrollbar-width:thin]"
      >
        {practitioners.map((p) => {
          const primary = p.specialties[0];
          const extra = p.specialties.length - 1;
          return (
            <li key={p.slug} className="w-[16.5rem] shrink-0 snap-start" data-rail-card>
              <a
                href={profileUrl(p.slug)}
                className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow duration-300 hover:[box-shadow:var(--shadow-card-hover)]"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-[var(--accent)]">
                  {p.photoUrl ? (
                    <Image
                      src={p.photoUrl}
                      alt={`${p.displayName}, ${primary?.name ?? 'holistic health practitioner'}`}
                      fill
                      sizes="264px"
                      /* ⚠️ ZOOM GOES THROUGH A CSS VARIABLE, NOT AN INLINE `transform`.
                         This element already owns a hover transform, and an inline style BEATS a
                         class — so `style={{ transform: scale(z) }}` would silently kill
                         `group-hover:scale-[1.03]`. Composing through the variable keeps both:
                         the practitioner's zoom is the resting scale, and hover multiplies it.

                         ⚠️ Verifying this: Tailwind 4 emits the MODERN `scale` property, not a
                         `transform`. So `getComputedStyle(el).transform` reads `none` here even
                         when the zoom is applied — check `.scale` instead. Measured live: rest
                         `scale: 2`, hover `scale: 2.06`, and `transition-property` resolves to
                         `transform, translate, scale, rotate`, so it still animates. */
                      style={
                        {
                          objectPosition: framingStyle(framingOf(p)).objectPosition,
                          '--photo-zoom': String(framingOf(p).photoZoom),
                        } as React.CSSProperties
                      }
                      className="scale-[var(--photo-zoom)] object-cover transition-transform duration-500 group-hover:scale-[calc(var(--photo-zoom)*1.03)]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-serif text-4xl text-primary/40">
                        {initials(p.displayName)}
                      </span>
                    </div>
                  )}
                  {p.telehealth && (
                    <span className="absolute left-3 top-3 rounded-full bg-white/92 px-2.5 py-1 text-[10px] font-medium tracking-wide text-primary">
                      Virtual
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <p className="font-serif text-lg leading-tight text-foreground">{p.displayName}</p>
                  {p.headline && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{p.headline}</p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                    {primary && (
                      <span className="rounded-full bg-[var(--secondary)] px-2.5 py-1 text-[11px] text-[var(--sage-deep)]">
                        {primary.name}
                      </span>
                    )}
                    {extra > 0 && (
                      <span className="text-[11px] text-muted-foreground">+{extra} more</span>
                    )}
                  </div>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
