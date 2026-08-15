'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Clock } from 'lucide-react';

type Props = {
  title: string;
  description: string | null;
  priceUsdCents: number;
  interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';
  category: string | null;
  duration: number | null;
  /** Where "Book now" goes. Null when the offering cannot currently be acted on. */
  href: string | null;
  /** Payments are live for this offering (§9) — changes the inner action's wording only. */
  canTransact: boolean;
};

const formatPrice = (cents: number) => {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
};

/**
 * Offering card — the UNDECIDED buyer's surface (§4).
 *
 * FIRST CLICK EXPANDS. It must never read as `Book`: that is a purchase action aimed at someone
 * still deciding, and this card's job is to do the selling. `Book now` appears INSIDE, after the
 * description has had a chance to work.
 */
export function OfferingCard({
  title,
  description,
  priceUsdCents,
  interval,
  category,
  duration,
  href,
  canTransact,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {priceUsdCents > 0 ? (
              <span className="font-semibold text-foreground">
                {formatPrice(priceUsdCents)}
                {interval === 'MONTHLY' && <span className="font-normal">/mo</span>}
              </span>
            ) : (
              <span className="font-semibold text-foreground">Free</span>
            )}
            {duration != null && duration > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {duration} min
              </span>
            )}
            {category && <span className="truncate">{category}</span>}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3">
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : (
            <p className="text-xs italic text-muted-foreground">No description yet.</p>
          )}

          {href ? (
            // Straight into the flow, never a chooser: the buyer has already said which offering
            // they want, and re-presenting a menu containing a free option would cannibalise a
            // decided buyer (§4).
            <Link
              href={href}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-cta text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90"
            >
              {canTransact && priceUsdCents > 0 ? 'Book now' : 'Request a time'}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              Contact this practitioner to arrange this.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
