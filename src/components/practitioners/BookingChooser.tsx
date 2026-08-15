'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, ChevronDown, ChevronRight } from 'lucide-react';

export type ChooserOption = {
  id: string;
  title: string;
  priceUsdCents: number;
  href: string;
};

type Props = {
  ctaLabel: string;
  subLabel: string;
  options: ChooserOption[];
};

const formatPrice = (cents: number) => {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
};

/**
 * The Booking Link chooser (§4, §14.1) — rendered only when more than one Offering points at the
 * link.
 *
 * It expands ON THE PROFILE rather than as a step inside the flow. That is what preserves the
 * decided-buyer property: someone who clicked the primary CTA has decided to ACT, and pushing
 * them through an extra page before they have even given their name adds friction to precisely
 * the buyer who needed least of it.
 *
 * The option list is passed in already containing every Offering attached to the link — including
 * LINK_ONLY ones, which is the single place an unlisted free consult is reachable — and in the
 * practitioner's own sort order, so a free consult is not hoisted to the top.
 */
export function BookingChooser({ ctaLabel, subLabel, options }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg bg-cta text-cta-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-opacity hover:opacity-90"
      >
        <Calendar className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{ctaLabel}</p>
          <p className="truncate text-xs opacity-80">{subLabel}</p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <ul className="space-y-1 border-t border-cta-foreground/15 bg-card p-2">
          {options.map((o) => (
            <li key={o.id}>
              <Link
                href={o.href}
                className="group flex items-center gap-3 rounded-md p-2.5 text-foreground transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{o.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.priceUsdCents > 0 ? formatPrice(o.priceUsdCents) : 'Free'}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
