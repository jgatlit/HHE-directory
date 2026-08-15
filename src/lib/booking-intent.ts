export type CaptureInput = {
  name: string;
  email: string;
  phone: string;
  note: string;
};

export type CaptureResult =
  | { ok: true; value: { name: string; email: string; phone: string | null; note: string | null } }
  | { ok: false; error: string };

/** Field caps. A public unauthenticated write must bound what it will store, independently of
 *  any rate limiter — see the note on enforcement in the capture action. */
export const CAPTURE_LIMITS = { name: 120, email: 254, phone: 40, note: 2000 } as const;

/**
 * Validate and normalise step 1 (§5).
 *
 * This is LEAD CAPTURE, NOT INTAKE — four fields, deliberately minimal. The practitioner's own
 * scheduler already asks its intake questions, and §6 explicitly forbids duplicating them: Acuity
 * addresses custom fields by per-account numeric id, so generic prefill is impossible and the
 * configuration burden would land on the least technical cohort.
 *
 * Only name and email are required. Phone and note are optional because every extra required
 * field costs conversion at the one step that is unconditional for every buyer.
 */
export function parseCapture(input: CaptureInput): CaptureResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const note = input.note.trim();

  if (!name) return { ok: false, error: 'USER:Please enter your name.' };
  if (name.length > CAPTURE_LIMITS.name) return { ok: false, error: 'USER:That name is too long.' };

  // Deliberately permissive. An over-strict pattern rejects real addresses (plus-tags, new TLDs,
  // unicode domains) and the cost of a false reject here is a lost lead — the exact thing this
  // step exists to prevent. Deliverability is proven by the practitioner replying, not by a regex.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > CAPTURE_LIMITS.email) {
    return { ok: false, error: 'USER:Please enter a valid email address.' };
  }

  if (phone.length > CAPTURE_LIMITS.phone) return { ok: false, error: 'USER:That phone number is too long.' };
  if (note.length > CAPTURE_LIMITS.note) return { ok: false, error: 'USER:Please shorten your note.' };

  return { ok: true, value: { name, email, phone: phone || null, note: note || null } };
}

/**
 * Window within which a repeat submission REUSES the existing intent instead of creating a row.
 *
 * Two jobs. It makes the capture step idempotent, so a double-submit or a browser retry does not
 * hand the practitioner the same lead twice. And it bounds row creation per (practitioner, email)
 * without depending on the rate limiter — which currently no-ops in production because no KV
 * store is provisioned, so it is the only bound that actually holds today.
 */
export const CAPTURE_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/** True when an existing PENDING intent is recent enough to resume rather than duplicate. */
export function isResumable(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < CAPTURE_DEDUPE_WINDOW_MS;
}
