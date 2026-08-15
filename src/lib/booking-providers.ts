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
  // Scheme-tolerant on purpose: the server normalizes `calendly.com/x` to `https://calendly.com/x`
  // before storing, so a detector that threw on the bare form would make the admin badge disagree
  // with the persisted provider — reporting "Other" for a link stored as CALENDLY.
  const withProtocol = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  let host: string;
  try {
    host = bareHost(new URL(withProtocol).hostname);
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

  // Scope to the IFRAME TAG, not the whole blob. Several providers ship a loader script before
  // the frame — `<script src="…/widget.js"></script><iframe src="…">` — and matching the first
  // ` src=` anywhere would return the JavaScript asset. That URL passes validation, saves
  // cleanly, and turns every visitor's "Book" click into a file download.
  const tag = trimmed.match(/<iframe\b[^>]*>/i)?.[0];
  if (!tag) return trimmed;

  const src = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
  if (!src) return trimmed;

  // Embed markup is HTML, so its query separators arrive entity-encoded. Storing `&amp;` verbatim
  // turns `?owner=1&amp;appointmentType=2` into params `owner=1` and `amp;appointmentType=2` —
  // the second is silently never sent, so every buyer lands on the practitioner's generic page
  // instead of the specific service the link was built for, with nothing surfacing the loss.
  return decodeHtmlEntities(src);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * Client-side mirror of the server's scheme-prepend, so the browser resolves a scheme-less entry
 * the same way the server will store it.
 *
 * Without this the admin UI disagrees with what gets persisted: `calendly.com/sarah` renders a
 * provider badge of "Other" (because `new URL()` throws) and a "Test link" href the browser
 * resolves as a RELATIVE path — opening a 404 on our own domain for a link that saves and works
 * perfectly. Both told the least technical cohort their working scheduler was broken.
 */
export function withScheme(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Human label for the provider badge in admin. */
export const PROVIDER_LABEL: Record<BookingProvider, string> = {
  CALENDLY: 'Calendly',
  CAL_COM: 'Cal.com',
  ACUITY: 'Acuity',
  SAVVYCAL: 'SavvyCal',
  OTHER: 'Other',
};
