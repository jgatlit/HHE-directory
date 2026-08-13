import { Calendar, Globe, ChevronRight } from 'lucide-react';

/** `id` is required as the React key: the same scheduler URL may legitimately appear on several
 *  links under different names, so the URL is no longer a unique identity. */
type BookingLink = { id: string; label?: string | null; url: string };
type Props = {
  bookingLinks?: BookingLink[];
  websiteUrl?: string | null;
  /** First-session price in cents — rendered inside the primary booking CTA when present. */
  firstSessionPriceCents?: number | null;
};

function hostHint(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Open link';
  }
}

/** cents → "$X" (whole) or "$X.XX" (fractional). */
function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Rich-landing-page action block. Booking is live (Wedge 2B — practitioner-owned URLs).
 * Website is the classified col-D external link.
 *
 * These booking links are the PRIMARY CTAs: booking link = a buyer who has DECIDED to act,
 * offering cards (rendered below, expand-in-place) = a buyer still deciding. The two surfaces
 * carry the same offerings on purpose and are treated differently on purpose.
 * See docs/2026-08-12-booking-checkout-flow.md.
 */
export function PractitionerCTAs({ bookingLinks = [], websiteUrl, firstSessionPriceCents }: Props) {
  const primaryBooking = bookingLinks[0];
  const moreBookings = bookingLinks.slice(1);
  const hasFirstSessionPrice = firstSessionPriceCents != null && firstSessionPriceCents > 0;

  return (
    <section aria-label="Book & connect" className="space-y-3">
      {primaryBooking ? (
        <a
          href={primaryBooking.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg bg-cta p-4 text-cta-foreground transition-opacity hover:opacity-90"
        >
          <Calendar className="h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {primaryBooking.label?.trim() || 'Book a session'}
            </p>
            <p className="truncate text-xs opacity-80">
              {hasFirstSessionPrice
                ? `First session: ${formatPrice(firstSessionPriceCents!)}`
                : hostHint(primaryBooking.url)}
            </p>
          </div>
          <ChevronRight
            className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </a>
      ) : (
        <div
          className="flex items-center gap-3 rounded-lg border border-dashed bg-card p-4 opacity-70"
          aria-disabled
        >
          <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Booking coming soon</p>
            <p className="text-xs text-muted-foreground">Reach out via their website below</p>
          </div>
        </div>
      )}

      {moreBookings.map((b) => (
        <a
          key={b.id}
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
        >
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{b.label?.trim() || 'Book a session'}</p>
            <p className="truncate text-xs text-muted-foreground">{hostHint(b.url)}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      ))}

      {websiteUrl && (
        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Visit website</p>
            <p className="truncate text-xs text-muted-foreground">{hostHint(websiteUrl)}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      )}

      {/* "Browse offerings" + "Request invoice" tiles removed 2026-08-12. They rendered
          disabled with a Coming-soon badge directly above the real offerings section, and a
          practitioner reviewing her own public page read them in client voice: "as a client
          looking for a practitioner, this is confusing… there's already offerings here."
          "Browse offerings" duplicated a live section; HSA reimbursement is available only to
          NBHWC-credentialed practitioners, so it can never be a blanket row — it needs a
          credential field before it comes back. See docs/2026-08-11-sarah-onboarding-review.md §A4/§A5. */}
    </section>
  );
}
