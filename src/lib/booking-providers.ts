import type { BookingProvider } from '@prisma/client';

/**
 * Hostname → provider, per spec §6. The practitioner supplies a URL and never embed code, so this
 * is the ONLY per-practitioner input and every downstream mechanism (embed strategy, prefill
 * params, completion listener, resize) is derived from what this returns.
 *
 * `OTHER` is the null adapter and a FIRST-CLASS member, not an error branch (D9). It is what runs
 * for a scheduler nobody anticipated, and the flow must be complete with it installed — so
 * returning OTHER is a correct outcome, never a validation failure.
 */
const HOST_MAP: ReadonlyArray<[BookingProvider, readonly string[]]> = [
  ['CALENDLY', ['calendly.com']],
  ['CAL_COM', ['cal.com', 'app.cal.com']],
  // `as.me` is Acuity's short-link domain. It was missing from the save-time allowlist, which
  // rejected exactly the links the reference practitioner uses — Sarah Schindler is on Acuity.
  ['ACUITY', ['acuityscheduling.com', 'app.acuityscheduling.com', 'as.me', 'secure.acuityscheduling.com']],
  ['SAVVYCAL', ['savvycal.com']],
];

/** Strip a leading `www.` so `www.calendly.com` and `calendly.com` are the same provider. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Match on the registrable host OR any parent of it, so per-account subdomains resolve:
 * `acme.savvycal.com` and `bookings.acuityscheduling.com` are still their providers.
 */
export function detectProvider(rawUrl: string): BookingProvider {
  let host: string;
  try {
    host = bareHost(new URL(rawUrl.trim()).hostname);
  } catch {
    return 'OTHER';
  }
  for (const [provider, hosts] of HOST_MAP) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return provider;
  }
  return 'OTHER';
}

/**
 * Accept a pasted `<iframe …>` by extracting its `src` (§6 input tolerance).
 *
 * Practitioners copy whatever their provider's "share" dialog gives them, and for several
 * providers that is embed markup rather than a link. Rejecting it teaches them the field is
 * broken; extracting the src is one regex and removes an entire class of support question.
 * Returns the input untouched when it is not iframe markup.
 */
export function extractUrlFromEmbed(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().includes('<iframe')) return trimmed;
  const match = trimmed.match(/\ssrc\s*=\s*["']([^"']+)["']/i);
  return match?.[1]?.trim() ?? trimmed;
}

/** Human label for the provider badge in admin. */
export const PROVIDER_LABEL: Record<BookingProvider, string> = {
  CALENDLY: 'Calendly',
  CAL_COM: 'Cal.com',
  ACUITY: 'Acuity',
  SAVVYCAL: 'SavvyCal',
  OTHER: 'Other',
};
