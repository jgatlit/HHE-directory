'use client';

/*
 * Class 6 — ILLUSTRATIVE (second surface).
 *
 * The "is / is not" copy is a scope boundary, so it is drawn as one: the three
 * things inside the service sit inside a closed filament; the three things
 * outside it sit past an open, broken edge. The structure carries the meaning
 * the legal copy is making, which is the point of an illustrative treatment
 * rather than two bulleted columns with a green tick and a red cross.
 *
 * The copy itself is client-authored and use-as-written. Nothing here reflows,
 * abbreviates, or softens it.
 *
 * D4: prefers-reduced-motion → both paths render complete, no draw-on.
 * D7: N/A — inline SVG.
 */

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { revealWhenVisible } from '@/lib/reveal';
import { scopeOfService } from '@/content/copy';

export function ScopeBoundary() {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (reduced) return;

    const paths = Array.from(wrap.querySelectorAll<SVGPathElement>('.boundary-draw'));
    paths.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    });

    return revealWhenVisible(
      wrap,
      () => {
        paths.forEach((p, i) => {
          p.style.transition = `stroke-dashoffset 1200ms cubic-bezier(0.33,1,0.68,1) ${i * 220}ms`;
          p.style.strokeDashoffset = '0';
          // The dashed "outside" edge restores its intended dash pattern once
          // the draw completes; the draw itself needs a solid dash to animate.
          const dash = p.dataset.dash;
          if (dash) window.setTimeout(() => (p.style.strokeDasharray = dash), 1200 + i * 220);
        });
      },
      { threshold: 0.2 },
    );
  }, [reduced]);

  return (
    <div ref={wrapRef} className="grid gap-10 lg:grid-cols-2 lg:gap-14">
      {/* Inside the boundary */}
      <div className="relative">
        <svg
          viewBox="0 0 400 300"
          className="pointer-events-none absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)]"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/*
            vector-effect keeps the stroke at its authored width under the
            non-uniform scale that preserveAspectRatio="none" applies. Without
            it the enclosure collapses to an invisible hairline on wide cards.
          */}
          <path
            className="boundary-draw"
            d="M14 26 C 14 14, 26 8, 60 8 L 340 8 C 380 8, 386 16, 386 34 L 386 266 C 386 286, 376 292, 344 292 L 56 292 C 22 292, 14 284, 14 264 Z"
            stroke="var(--sage-deep)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            opacity="0.6"
          />
        </svg>
        <div className="relative rounded-xl bg-[var(--secondary)]/60 p-6 sm:p-8">
          <h3 className="font-serif text-2xl leading-snug text-foreground">
            {scopeOfService.isHeading}
          </h3>
          <ul className="mt-5 space-y-4">
            {scopeOfService.is.map((line) => (
              <li key={line} className="flex gap-3 text-[0.9375rem] leading-relaxed text-foreground/85">
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sage-deep)]"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Outside the boundary — the edge is deliberately open, not closed. */}
      <div className="relative">
        <svg
          viewBox="0 0 400 300"
          className="pointer-events-none absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)]"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="boundary-draw"
            data-dash="6 9"
            d="M14 8 L 14 292"
            stroke="var(--muted-foreground)"
            strokeWidth="1.6"
            strokeDasharray="6 9"
            vectorEffect="non-scaling-stroke"
            opacity="0.6"
          />
        </svg>
        <div className="relative p-6 sm:p-8">
          <h3 className="font-serif text-2xl leading-snug text-foreground">
            {scopeOfService.isNotHeading}
          </h3>
          <ul className="mt-5 space-y-4">
            {scopeOfService.isNot.map((line) => (
              <li key={line} className="flex gap-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground/60"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
