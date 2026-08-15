/**
 * The one money formatter. It was copy-pasted into four components and had already drifted on the
 * zero case (one rendered "Free", another rendered nothing), which is how a price ends up
 * displayed two different ways on one page.
 */
export function formatPrice(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/**
 * Period suffix for a recurring price. ANNUAL was previously unhandled, so a $1,200/year
 * membership rendered as a bare "$1200" — indistinguishable from a $1,200 one-time package.
 */
export function intervalSuffix(interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL'): string | null {
  if (interval === 'MONTHLY') return '/mo';
  if (interval === 'ANNUAL') return '/yr';
  return null;
}

/**
 * Action wording. A recurring offering must never read "Book now": the buyer is starting a
 * subscription and should be told so BEFORE they are handed to checkout.
 */
export function actionLabel(input: {
  interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';
  canTransact: boolean;
  priceUsdCents: number;
}): string {
  if (!input.canTransact || input.priceUsdCents <= 0) return 'Request a time';
  return input.interval === 'ONE_TIME' ? 'Book now' : 'Subscribe';
}
