export type PostedBookingRow = { id: string | null; label: string | null; url: string };

/**
 * Upper bound on posted booking-link rows, enforced by the caller before parsing.
 *
 * The reconcile issues one to two sequential round trips per row inside an interactive
 * transaction, so row count is a direct multiplier on how long that transaction holds a pooled
 * connection. Nothing caps rows client-side, and a hand-crafted POST can carry thousands — which
 * would blow the transaction deadline and hold a connection for its full duration on the way out.
 */
export const MAX_BOOKING_LINKS = 25;

/**
 * Zip the posted `bookingId` / `bookingLabel` / `bookingUrl` arrays into the rows to persist.
 *
 * Extracted from the server action so it can be tested directly: a `'use server'` module may only
 * export async server actions, so a pure helper cannot live there.
 *
 * **A Booking Link is a unique INSTANCE, not a unique URL** (operator decision 2026-08-13).
 * The same scheduler may be added any number of times under different names, each linked to a
 * different Offering — so a practitioner running one Acuity calendar can still present
 * *Book your free consult* · *Book Root Cause Release* · *Book Human Design Session* as three
 * distinct buttons. That decouples the purpose-built topology from owning several calendars.
 *
 * This is why there is no dedupe here. An earlier version collapsed rows sharing a normalised URL
 * and kept the first, which under in-place reconciliation **deleted the loser by id** — silently
 * unlinking every Offering that pointed at it once the FK lands. Identity is the row, not the
 * address, and the database agrees: there is no unique constraint on `BookingLink.url`.
 *
 * Accidental double-paste is caught in the editor with a non-blocking warning instead, where the
 * practitioner can see and fix it — rather than here, by throwing one of their rows away.
 *
 * Returns `null` when a URL fails normalisation rather than throwing: routing is the caller's job,
 * and `redirect()` works by throwing, so it cannot be issued from a pure helper without coupling
 * this module to Next's navigation.
 */
export function parseBookingLinkRows(
  raw: { ids: string[]; labels: string[]; urls: string[] },
  normalize: (url: string) => string | null,
): PostedBookingRow[] | null {
  const rows: PostedBookingRow[] = [];

  for (let i = 0; i < raw.urls.length; i++) {
    const value = raw.urls[i]?.trim() ?? '';
    // An emptied row is a removed row. It contributes no id, so the reconcile deletes it —
    // clearing the URL and clicking the X are deliberately the same gesture.
    if (!value) continue;

    const url = normalize(value);
    if (!url) return null;

    rows.push({
      id: raw.ids[i]?.trim() || null,
      label: raw.labels[i]?.trim() || null,
      url,
    });
  }

  return rows;
}

/**
 * Rows that look like an accidental duplicate — same URL *and* same label.
 *
 * Deliberately narrow. Two rows on one scheduler with DIFFERENT labels are the feature, so
 * flagging those would train practitioners to ignore the warning. Identical on both is the
 * signature of a double-click or a double-paste, which is the only case worth mentioning.
 *
 * Advisory only: it never blocks a save. A practitioner may have a reason we have not thought of,
 * and refusing the write would trade a silent data loss for a silent capability loss.
 */
export function duplicateBookingRowKeys(
  rows: { id: string; label: string; url: string }[],
): Set<string> {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();

  for (const row of rows) {
    const url = row.url.trim().toLowerCase();
    if (!url) continue;
    // Separator matters: without one, ("…/x", "y") and ("…/", "xy") would collide into the same
    // key and warn about two rows that share nothing. A newline cannot occur in either field.
    const key = `${url}\n${row.label.trim().toLowerCase()}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, row.id);
    } else {
      dupes.add(first);
      dupes.add(row.id);
    }
  }

  return dupes;
}
