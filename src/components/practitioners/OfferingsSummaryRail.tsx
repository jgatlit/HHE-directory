import { Clock, ChevronRight } from 'lucide-react';
import { formatPrice, intervalSuffix } from '@/lib/money';

export type RailOffering = {
  id: string;
  title: string;
  priceUsdCents: number;
  interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';
  duration: number | null;
};

/** The DOM id an offering's full card carries in the right pane. One definition, two consumers. */
export function offeringAnchorId(offeringId: string): string {
  return `offering-${offeringId}`;
}

/**
 * Offerings, summarised UNDER the primary CTA in the left pane (§4, 08-26 call).
 *
 * Amy, repeatedly: "why would those be in two separate places?" … "no one's going to book a
 * one-on-one support session under the booking link area until they know more about it." She
 * did not notice Offerings at all, because they sat far down the narrative column. Her reaction
 * to the shape that worked — one booking link mapped to two offerings, dropping down in the LEFT
 * pane — was "See, that looks great!"
 *
 * Title, PRICE and DURATION, which is exactly what she called out: "I love how, under offerings,
 * it shows the title of the offer, the price, the time."
 *
 * ⚠️ THESE ARE ANCHORS, NOT BUTTONS, and that is deliberate. The full card in the right pane is
 * a native `<details>` specifically so the description and the booking CTA are present in the
 * server-rendered HTML — this is a public, SEO-driven directory, and a client-side selection
 * model would put the highest-intent copy behind `open === false` and make booking unreachable
 * without JavaScript. An anchor degrades honestly: with no JS it jumps to the card, and
 * OfferingDetailOpener expands it when JS is available.
 *
 * The primary CTA above stays SINGULAR. This list sits beneath it and never accordions out of
 * it — Jonathan's stated hesitation was letting the first call-to-action expand infinitely.
 */
export function OfferingsSummaryRail({
  offerings,
  headingId,
}: {
  offerings: RailOffering[];
  headingId?: string;
}) {
  if (offerings.length === 0) return null;

  return (
    <section aria-labelledby={headingId ?? 'offerings-rail-heading'} className="space-y-2">
      <h2
        id={headingId ?? 'offerings-rail-heading'}
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        Offerings
      </h2>
      <ul className="divide-y overflow-hidden rounded-lg border bg-card">
        {offerings.map((o) => {
          const suffix = intervalSuffix(o.interval);
          return (
            <li key={o.id}>
              <a
                href={`#${offeringAnchorId(o.id)}`}
                className="group flex items-center gap-3 p-3 transition-colors hover:bg-accent/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{o.title}</p>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {o.priceUsdCents > 0 ? formatPrice(o.priceUsdCents) : 'Free'}
                      {o.priceUsdCents > 0 && suffix && <span className="font-normal">{suffix}</span>}
                    </span>
                    {o.duration != null && o.duration > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden />
                        {o.duration} min
                      </span>
                    )}
                  </span>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
