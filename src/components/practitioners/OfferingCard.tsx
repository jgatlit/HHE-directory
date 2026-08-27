import Link from 'next/link';
import { ChevronDown, Clock } from 'lucide-react';
import { formatPrice, intervalSuffix, actionLabel } from '@/lib/money';

type Props = {
  title: string;
  description: string | null;
  priceUsdCents: number;
  interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';
  category: string | null;
  duration: number | null;
  /** Where the inner action goes. Null when there is genuinely nothing to act on. */
  href: string | null;
  /** §9 payments_live — changes the action wording only, never whether the card expands. */
  canTransact: boolean;
  /** DOM id the left-pane rail anchors to. Omitted where the card is not rail-addressable. */
  anchorId?: string;
};

/**
 * Offering card — the UNDECIDED buyer's surface (§4).
 *
 * FIRST CLICK EXPANDS. It must never read as `Book`: that is a purchase action aimed at someone
 * still deciding, and this card's job is to do the selling. The action appears INSIDE, after the
 * description has had a chance to work.
 *
 * Native `<details>`, deliberately, rather than `useState`. A client component would have put the
 * description and the CTA behind `open === false` on the server render — so the highest-intent
 * copy on a public, SEO-driven directory would be absent from the HTML crawlers and no-JS clients
 * receive, and the booking flow would be unreachable without JavaScript. `<details>` expands in
 * place with the whole content present in the markup.
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
  anchorId,
}: Props) {
  const suffix = intervalSuffix(interval);

  return (
    // `scroll-mt` so the sticky rail above does not cover the card the anchor just jumped to.
    <li id={anchorId} className="scroll-mt-8 rounded-lg border bg-card">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3 transition-colors hover:bg-accent/30 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {priceUsdCents > 0 ? formatPrice(priceUsdCents) : 'Free'}
                {priceUsdCents > 0 && suffix && <span className="font-normal">{suffix}</span>}
              </span>
              {duration != null && duration > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden />
                  {duration} min
                </span>
              )}
              {category && <span className="truncate">{category}</span>}
            </span>
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="space-y-3 border-t px-3 pb-3 pt-3">
          {/* FORMATTED, not a raw text block (Amy, 08-26). Practitioners paste multi-paragraph
              descriptions and the single <p> ran them together into a wall — on the one surface
              whose entire job is to do the selling. Split on blank lines, exactly as the bio
              does, so the two read consistently. */}
          {description ? (
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {description
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
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
              {actionLabel({ interval, canTransact, priceUsdCents })}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              Contact this practitioner to arrange this.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
