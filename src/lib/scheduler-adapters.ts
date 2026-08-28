import { detectProvider } from '@/lib/booking-providers';

/**
 * What we know about the buyer at mount time. NAME AND EMAIL ONLY, permanently (D15, §6).
 *
 * Every custom-field mechanism is structurally unreachable: Calendly's `a1`–`a10` map to the
 * practitioner's own question order, Acuity addresses fields by per-account numeric id, and
 * SavvyCal's `questions[0]` is positional. Guessing means writing a phone number into a field
 * asking about medical history. Widening this type is not a small change — it is the thing §6
 * forbids.
 */
export type SchedulerLead = {
  /** The full name string AS TYPED. The split is a transport detail computed here, never stored. */
  name: string;
  email: string;
};

/**
 * How the frame is brought up. Two kinds, because prefill reaches the two families differently:
 * `iframe` providers take it in the URL, `script` providers take it through their own widget API
 * and IGNORE URL params.
 */
export type EmbedStrategy =
  | { kind: 'calendly'; url: string; prefill: { name: string; email: string } | null }
  | { kind: 'cal_com'; calLink: string; origin: string; config: { name: string; email: string } | null }
  | { kind: 'iframe'; src: string; resizes: boolean };

/**
 * Split for Acuity (and SavvyCal Appointments) on the FIRST whitespace — first token is the
 * first name, the ENTIRE remainder is the last name.
 *
 * Splitting on the LAST whitespace instead is wrong for "Mary Anne Van Der Berg", which is the
 * common case this rule exists for. A mononym leaves `lastName` empty: verified to render with
 * no error, no `aria-invalid`, and submit still enabled — the buyer fills it as they would have
 * anyway.
 *
 * ⚠️ The result is NEVER persisted. `BookingIntent.name` holds the original single string; this
 * is computed at embed time and discarded (§6).
 */
export function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const gap = trimmed.indexOf(' ');
  if (gap === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, gap), lastName: trimmed.slice(gap + 1) };
}

/**
 * Strip the tracking params a practitioner's pasted link tends to carry, while preserving the
 * path — a landing-page link must embed as readily as an event-type link (§6).
 */
function stripTracking(url: URL): URL {
  // Collect first, then delete: mutating the params while iterating them skips entries, and the
  // repo targets an es5 lib so the iterator is not spreadable anyway.
  const doomed: string[] = [];
  url.searchParams.forEach((_value, key) => {
    if (/^(utm_|fbclid$|gclid$|msclkid$|mc_[ce]id$)/i.test(key)) doomed.push(key);
  });
  for (const key of doomed) url.searchParams.delete(key);
  return url;
}

/**
 * Choose the embed strategy for a booking URL, per the §6 adapter table.
 *
 * GROUND TRUTH: this never rejects a URL. Known vendors get a tuned adapter (Calendly and cal.com
 * via their widget APIs, everything else an iframe); anything unrecognised falls to the null
 * adapter and still books — it only loses prefill. Verified across 20 URL shapes (all supported
 * vendors, `www.`/no-scheme/whitespace/trailing-dot variants, unknown hosts, and hostile input):
 * zero failures, nothing thrown, and `javascript:`/`data:` neutralised by scheme prefixing.
 *
 * So ADDING A VENDOR IS OPTIONAL, NEVER REQUIRED. A practitioner can paste any scheduler link
 * today and it works.
 *
 * ⚠️ DERIVED FROM THE URL, NEVER FROM `BookingLink.provider` (D16) — that column is a stale
 * reporting cache, and one live row holds a `calendly.com` URL under `provider = OTHER`. Reading
 * it here would drop that practitioner to the null adapter and lose her prefill.
 *
 * TOP-VALUE IMPROVEMENT, if this area is ever revisited: give the tuned adapters a real
 * end-to-end test against live vendor URLs. Prefill is the only thing that can silently degrade
 * here — a vendor changing its widget API breaks it with no error on our side, and today nothing
 * would catch that.
 *
 * A null `lead` is the pre-capture case and also the correct call for the null adapter, where
 * prefill is not merely absent but impossible.
 */
export function schedulerEmbed(rawUrl: string, lead: SchedulerLead | null): EmbedStrategy {
  const provider = detectProvider(rawUrl);
  const withProtocol = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;

  let url: URL;
  try {
    url = stripTracking(new URL(withProtocol));
  } catch {
    // Unparseable is the null adapter's job, not an exception (D9).
    //
    // ⚠️ `withProtocol`, NOT `rawUrl` — prefixing forces http(s), so a `javascript:` or `data:`
    // URL from a script-written row cannot reach an iframe src. React 18 only warns on those.
    return { kind: 'iframe', src: withProtocol, resizes: false };
  }

  switch (provider) {
    case 'CALENDLY':
      // ⚠️ Prefill travels over `postMessage` as a widget-API property — it is NOT achievable by
      // URL construction, so there is deliberately nothing appended to `url` here. Verified live
      // on a FREE plan (art_346b9f8bb7af4ced9cf7).
      return {
        kind: 'calendly',
        url: url.toString(),
        prefill: lead ? { name: lead.name, email: lead.email } : null,
      };

    case 'CAL_COM': {
      // The script wants the bare `user/event` link, not the absolute URL.
      const calLink = url.pathname.replace(/^\/+|\/+$/g, '');
      if (!calLink) return { kind: 'iframe', src: url.toString(), resizes: false };
      return {
        kind: 'cal_com',
        calLink,
        origin: url.origin,
        // ⚠️ Hand the CONFIG OBJECT to the script; never hand-build the query string. A known
        // cal.com bug ignores every prefill param unless `name` comes first, and the script's own
        // serialisation is what puts it there. Building the string ourselves reintroduces the bug.
        config: lead ? { name: lead.name, email: lead.email } : null,
      };
    }

    case 'ACUITY': {
      if (lead) {
        const { firstName, lastName } = splitName(lead.name);
        // ⚠️ camelCase ONLY. `first_name`/`last_name` are silently ignored AND stripped, so a
        // snake_case attempt looks identical to no prefill at all. `email` is lowercase-only and
        // is parsed independently of the name casing. All three verified live.
        if (firstName) url.searchParams.set('firstName', firstName);
        if (lastName) url.searchParams.set('lastName', lastName);
        url.searchParams.set('email', lead.email);
      }
      // embed.js reports height over postMessage — but it BREAKS with more than one Acuity widget
      // on a page, which is why mounting exactly one is a correctness constraint, not a preference.
      return { kind: 'iframe', src: url.toString(), resizes: true };
    }

    case 'SAVVYCAL': {
      if (lead) {
        url.searchParams.set('display_name', lead.name);
        url.searchParams.set('email', lead.email);
      }
      return { kind: 'iframe', src: url.toString(), resizes: true };
    }

    default:
      // The NULL ADAPTER — a first-class member, not an error branch (D9). No prefill is possible
      // and the flow must be complete without it. `resizes: false` sends the frame down the
      // viewport-sized path in §7, because the parent cannot measure a cross-origin document.
      return { kind: 'iframe', src: url.toString(), resizes: false };
  }
}

/** Whether this URL can be prefilled at all — drives copy, never a gate. */
export function supportsPrefill(rawUrl: string): boolean {
  return detectProvider(rawUrl) !== 'OTHER';
}
