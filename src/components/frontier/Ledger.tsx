'use client';

/*
 * Class 3 — MODERN ANIMATION (second surface) + Class 4 — MOTION.
 *
 * Counts that are true. Every figure here is computed from the fixture at build
 * time, so the strip cannot drift from the directory behind it. The count-up is
 * the whole effect — no gradient slab, no oversized hero number.
 *
 * D4: prefers-reduced-motion → the final value is rendered directly, never a
 *     zero that then animates. The server HTML already carries the real number,
 *     so it is correct before hydration too.
 * D7: N/A — no external pipeline stage.
 */

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export type LedgerEntry = { value: number; label: string; suffix?: string };

function useCountUp(target: number, run: boolean) {
  const [value, setValue] = useState(target);
  const started = useRef(false);

  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;
    setValue(0);
    const duration = 900;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, target]);

  return value;
}

function LedgerCell({ entry, run }: { entry: LedgerEntry; run: boolean }) {
  const value = useCountUp(entry.value, run);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-serif text-4xl leading-none tabular-nums text-foreground sm:text-5xl">
        {value}
        {entry.suffix}
      </span>
      <span className="text-sm leading-snug text-muted-foreground">{entry.label}</span>
    </div>
  );
}

export function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (reduced || !ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setRun(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <div ref={ref} className="grid grid-cols-2 gap-8 sm:grid-cols-4">
      {entries.map((e) => (
        <LedgerCell key={e.label} entry={e} run={run} />
      ))}
    </div>
  );
}
