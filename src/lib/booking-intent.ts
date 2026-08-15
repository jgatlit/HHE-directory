export type CaptureInput = {
  name: string;
  email: string;
  phone: string;
  note: string;
};

/**
 * Error CODES, not messages. The capture page renders these through this fixed lookup, so a
 * crafted `?error=` cannot place attacker-chosen text inside a branded alert on a public page
 * carrying the practitioner's real name — that is a phishing surface reachable by link alone.
 */
export const CAPTURE_ERRORS = {
  NAME_REQUIRED: 'Please enter your name.',
  NAME_TOO_LONG: 'That name is too long.',
  EMAIL_INVALID: 'Please enter a valid email address.',
  PHONE_TOO_LONG: 'That phone number is too long.',
  NOTE_TOO_LONG: 'Please shorten your note.',
  CONTEXT_GONE: 'That option is no longer available — please pick again from the profile.',
  TOO_MANY: 'Too many attempts just now. Please try again in a few minutes.',
} as const;

export type CaptureErrorCode = keyof typeof CAPTURE_ERRORS;

export type CaptureResult =
  | { ok: true; value: { name: string; email: string; phone: string | null; note: string | null } }
  | { ok: false; code: CaptureErrorCode };

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

  if (!name) return { ok: false, code: 'NAME_REQUIRED' };
  if (name.length > CAPTURE_LIMITS.name) return { ok: false, code: 'NAME_TOO_LONG' };

  // Deliberately permissive. An over-strict pattern rejects real addresses (plus-tags, new TLDs,
  // unicode domains) and the cost of a false reject here is a lost lead — the exact thing this
  // step exists to prevent. Deliverability is proven by the practitioner replying, not by a regex.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > CAPTURE_LIMITS.email) {
    return { ok: false, code: 'EMAIL_INVALID' };
  }

  if (phone.length > CAPTURE_LIMITS.phone) return { ok: false, code: 'PHONE_TOO_LONG' };
  if (note.length > CAPTURE_LIMITS.note) return { ok: false, code: 'NOTE_TOO_LONG' };

  return { ok: true, value: { name, email, phone: phone || null, note: note || null } };
}
