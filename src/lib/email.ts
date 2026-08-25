import { Resend } from 'resend';

/**
 * Transactional email — the single send path for everything that is not NextAuth's magic link.
 *
 * Before this, sending was a hand-rolled `fetch('https://api.resend.com/emails')` copied into
 * each caller. That was survivable with two callers; the booking flow adds several more (resume
 * emails, lead notifications, booking-link failure notices, "payments are now live"), and every
 * one of them is fired by a cron or a webhook — i.e. from something that RETRIES.
 *
 * Retry-safety is the reason this module exists, not tidiness. See `idempotencyKey` below.
 *
 * NOT in scope: NextAuth's magic-link sender (`src/auth.ts`). It is configured through the
 * provider's `sendVerificationRequest` hook, it is working against the verified sending domain,
 * and sign-in is the one flow where a refactor has no upside.
 */

export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? 'Natural Health Pros <onboarding@resend.dev>';

/**
 * Normalize + validate an email the way the auth stack compares them.
 *
 * `adminEmails()` in src/auth.ts lowercases before matching, the onboarding gate compares
 * `session.user.email?.toLowerCase()` against `invitation.email.toLowerCase()`, and
 * `User.email` is `@unique`. Storing a mixed-case address therefore works everywhere EXCEPT
 * the uniqueness index, which is case-sensitive — so `Jane@x.com` and `jane@x.com` would be two
 * users, two practitioners, and one very confused person. Lowercase on write.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 320) return null;
  // Deliberately permissive: the authoritative test of an address is whether the magic link
  // arrives, not a regex. This rejects only what cannot possibly be an address.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Escape user-supplied text before interpolating it into an HTML email body. An email's local
 *  part only excludes whitespace and `@` (see normalizeEmail above) — `<`, `>`, and `"` all pass
 *  validation, so anything embedded verbatim into a template is a phishing/HTML-injection surface
 *  reachable by typing a crafted address into a form. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Missing configuration, distinct from a failed send. Callers usually want to treat these
 * differently: a cron should abort the whole run with a 500 when the key is absent (nothing will
 * ever succeed), but fail soft on one recipient's send so the rest of the batch still goes out.
 */
export class EmailNotConfigured extends Error {
  constructor() {
    super('RESEND_API_KEY is not configured');
    this.name = 'EmailNotConfigured';
  }
}

/** Constructed per call, not at module scope — importing this file must not throw when the key
 *  is absent (local dev, CI, and the build all import routes that reference it). */
function client(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailNotConfigured();
  return new Resend(apiKey);
}

/** Resend rejects tag names/values outside `[A-Za-z0-9_-]`. Sanitising here keeps a stray space
 *  in a slug from failing an otherwise valid send. */
const tagSafe = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256);

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always send one — a text/html multipart scores better than HTML
   *  alone, and this sender's deliverability was already hard-won (see the 2026-07-15 domain
   *  verification; the sandbox sender was spam-foldered even when it delivered). */
  text: string;
  /**
   * REQUIRED, deliberately not optional.
   *
   * Resend de-duplicates on this for 24 hours, so a cron re-run, a webhook retry, or a deploy
   * that replays a sweep cannot double-send. Format `<event-type>/<entity-id>`, e.g.
   * `booking-resume/<bookingIntentId>` or `trial-warn-T14/<practitionerId>`.
   *
   * Making it mandatory is the point: every caller has to answer "what makes this send unique?"
   * at the call site, where the answer is known. An optional key would be omitted exactly in the
   * retry-prone paths that need it most.
   */
  idempotencyKey: string;
  /** Optional Resend tags, for per-feature deliverability visibility in their dashboard — so a
   *  broken sender is attributable to its feature rather than to "email". */
  tags?: { name: string; value: string }[];
};

/**
 * Send one transactional email.
 *
 * THROWS on failure — it never reports a non-send as success. The Resend SDK resolves with
 * `{ data, error }` rather than rejecting, so the `error` branch has to be checked explicitly;
 * returning void on it would manufacture exactly the silent failure this codebase has been
 * bitten by before (`deleteFromIndex`'s bare catch, which made its own "fail LOUD" counter
 * permanently zero). Callers that want fail-soft semantics wrap the call themselves and record
 * the failure — that decision belongs to them, not here.
 *
 * ⚠️ Do NOT call this inside a `prisma.$transaction` (it holds the transaction open across
 * network I/O) or inline in the Whop webhook handler (Whop retries 3× over ~70s then drops the
 * event permanently — acknowledge fast and send out of band).
 *
 * ⚠️ Notification PREFERENCES are the caller's business. `Practitioner.notifyLeadsImmediately`
 * suppresses lead emails only; the scheduled-but-unpaid dashboard obligation must never be gated
 * by it. A helper that quietly consulted the flag would hide that distinction.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { data, error } = await client().emails.send(
    {
      from: EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.tags && {
        tags: input.tags.map((t) => ({ name: tagSafe(t.name), value: tagSafe(t.value) })),
      }),
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new Error(`Resend ${error.name ?? 'error'}: ${error.message ?? JSON.stringify(error)}`);
  }
  if (!data?.id) {
    // A success with no id means the contract changed under us. Surface it rather than
    // returning a hollow object that later logging would report as a delivered send.
    throw new Error('Resend returned no message id');
  }
  return { id: data.id };
}
