'use client';

/*
 * Class 8 — SVG GENERATION.
 *
 * The mark is the directory's own data structure: three practitioner nodes on
 * an arc, tied by filaments to a shared training node. It is not a leaf, a
 * lotus, or a pair of cupped hands — the three defaults of this category.
 *
 * D4: prefers-reduced-motion renders every path at full stroke immediately.
 * D7: N/A — inline SVG with no external dependency, cannot fail independently.
 */

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

export function Wordmark({
  className,
  tone = 'ink',
  animate = false,
}: {
  className?: string;
  tone?: 'ink' | 'inverse';
  animate?: boolean;
}) {
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const noMotion = reduced || !animate;

  useEffect(() => {
    if (noMotion || !svgRef.current) return;
    const paths = svgRef.current.querySelectorAll<SVGPathElement>('.mark-draw');
    const cleanups: (() => void)[] = [];

    paths.forEach((path, i) => {
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      // Two frames of settle before transitioning, so the dash offset is
      // committed before the animation begins — otherwise Safari skips it.
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          path.style.transition = `stroke-dashoffset 900ms cubic-bezier(0.4, 0, 0.2, 1) ${i * 110}ms`;
          path.style.strokeDashoffset = '0';
        }),
      );
      cleanups.push(() => cancelAnimationFrame(raf));
    });

    return () => cleanups.forEach((c) => c());
  }, [noMotion]);

  const stroke = tone === 'inverse' ? 'rgba(255,255,255,0.92)' : 'var(--field)';
  const node = tone === 'inverse' ? '#F2D0DE' : 'var(--cta)';

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        ref={svgRef}
        viewBox="0 0 40 40"
        className="h-7 w-7 shrink-0"
        fill="none"
        role="img"
        aria-label="Natural Health Pros"
      >
        {/* filaments: each practitioner node tied back to shared training */}
        <path className="mark-draw" d="M20 31 L9 14" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        <path className="mark-draw" d="M20 31 L20 8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        <path className="mark-draw" d="M20 31 L31 14" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        {/* the arc the three practitioners sit on */}
        <path
          className="mark-draw"
          d="M6 17 Q20 3 34 17"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.5"
        />
        <circle cx="9" cy="14" r="2.4" fill={node} />
        <circle cx="20" cy="8" r="2.4" fill={node} />
        <circle cx="31" cy="14" r="2.4" fill={node} />
        <circle cx="20" cy="31" r="3.2" fill="none" stroke={stroke} strokeWidth="1.4" />
      </svg>
      <span
        className={cn(
          'whitespace-nowrap font-serif text-[0.9375rem] font-semibold leading-none tracking-[-0.01em] sm:text-[1.0625rem]',
          tone === 'inverse' ? 'text-white' : 'text-foreground',
        )}
      >
        Natural Health Pros
      </span>
    </span>
  );
}

/**
 * Custom trust check. A generic lucide <Check> would read as chrome; this is
 * drawn to the brand's stroke weight and sits inside a token-coloured well.
 */
export function TrustCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn('h-5 w-5 shrink-0', className)} fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--secondary)" />
      <path
        d="M6 10.4 L8.8 13.2 L14 7.4"
        stroke="var(--sage-deep)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Section rule. Not a 1px border: a hand-weighted filament that thins toward
 * both ends, echoing the mark's connective lines.
 */
export function FilamentRule({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 8"
      className={cn('h-2 w-full', className)}
      fill="none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="filament-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="var(--border)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--field)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--border)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 4 H600" stroke="url(#filament-fade)" strokeWidth="1.25" />
    </svg>
  );
}
