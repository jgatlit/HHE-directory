import Link from 'next/link';
import { Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { formatPrice } from '@/lib/money';

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

/**
 * The Booking Link chooser (§4, §14.1) — rendered only when more than one Offering points at the
 * link.
 *
 * It expands ON THE PROFILE rather than as a step inside the flow. That is what preserves the
 * decided-buyer property: someone who clicked the primary CTA has decided to ACT, and pushing
 * them through an extra page before they have even given their name adds friction to precisely
 * the buyer who needed least of it.
 *
 * Native `<details>` for the same reason as OfferingCard — behind client state, every option and
 * its link would be missing from the server-rendered HTML, so the chooser (the ONLY route to an
 * unlisted free consult) would not exist for a crawler or a no-JS client.
 *
 * Options arrive already containing every Offering attached to the link — LINK_ONLY included —
 * in the practitioner's own sort order, so a free consult is not hoisted to the top.
 */
export function BookingChooser({ ctaLabel, subLabel, options }: Props) {
  return (
    <details className="group overflow-hidden rounded-lg bg-cta text-cta-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 transition-opacity hover:opacity-90 [&::-webkit-details-marker]:hidden">
        <Calendar className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{ctaLabel}</p>
          <p className="truncate text-xs opacity-80">{subLabel}</p>
        </div>
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <ul className="space-y-1 border-t border-cta-foreground/15 bg-card p-2">
        {options.map((o) => (
          <li key={o.id}>
            <Link
              href={o.href}
              className="group/opt flex items-center gap-3 rounded-md p-2.5 text-foreground transition-colors hover:bg-accent/40"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{o.title}</p>
                <p className="text-xs text-muted-foreground">
                  {o.priceUsdCents > 0 ? formatPrice(o.priceUsdCents) : 'Free'}
                </p>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover/opt:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
