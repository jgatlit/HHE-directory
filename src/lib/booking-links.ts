export type PostedBookingRow = { id: string | null; label: string | null; url: string };

/**
 * Upper bound on posted booking-link rows, enforced by the caller before parsing.
 *
 * The reconcile issues one to two sequential round trips per row inside an interactive
 * transaction, so row count is a direct multiplier on how long that transaction holds a pooled
 * connection. Nothing caps rows client-side, and a hand-crafted POST can carry thousands — which
 * would blow the transaction deadline and hold a connection for its full duration on the way out.
 * A practitioner with more than this many schedulers is not a real case.
 */
export const MAX_BOOKING_LINKS = 25;

/**
 * Zip the posted `bookingId` / `bookingLabel` / `bookingUrl` arrays into the rows to persist.
 *
 * Extracted from the server action so it can be tested directly: a `'use server'` module may only
 * export async server actions, so a pure helper cannot live there. The rules below are each load
 * bearing and none of them are obvious from the call site.
 *
 * Returns `null` when a URL fails normalisation rather than throwing: routing is the caller's job,
 * and `redirect()` works by throwing, so it cannot be issued from a pure helper without coupling
 * this module to Next's navigation.
 *
 * ⚠️ Duplicate handling is deliberately narrow. It guarantees only that a persisted id is never
 * displaced by an id-less row. It does NOT rescue a duplicate group containing two or more
 * persisted ids — all but the first are dropped from the returned list, and the caller deletes
 * them. That is CURRENT behaviour pending an operator decision, not a settled design; see the
 * regression test and `MAX_BOOKING_LINKS` below.
 */
export function parseBookingLinkRows(
  raw: { ids: string[]; labels: string[]; urls: string[] },
  normalize: (url: string) => string | null,
): PostedBookingRow[] | null {
  const rows: PostedBookingRow[] = [];
  // url → index in `rows`, not a bare Set: a duplicate has to be able to reach back and amend the
  // row that already claimed its URL (see the identity-adoption rule below).
  const seen = new Map<string, number>();

  for (let i = 0; i < raw.urls.length; i++) {
    const value = raw.urls[i]?.trim() ?? '';
    // An emptied row is a removed row. It contributes no id, so the reconcile deletes it —
    // clearing the URL and clicking the X are deliberately the same gesture.
    if (!value) continue;

    const url = normalize(value);
    if (!url) return null;

    const id = raw.ids[i]?.trim() || null;
    const label = raw.labels[i]?.trim() || null;

    const dupeAt = seen.get(url);
    if (dupeAt !== undefined) {
      // Duplicates still collapse to a single row, as they always have. What must NOT happen is
      // the survivor being the row WITHOUT a database id: that would delete a persisted link and
      // create a replacement, reintroducing the id churn the in-place reconcile exists to remove.
      // It is reachable in ordinary use — add a row, paste a URL you already use, drag it above
      // the original — so the keeper adopts the persisted identity instead of discarding it.
      if (!rows[dupeAt].id && id) rows[dupeAt].id = id;
      continue;
    }

    seen.set(url, rows.length);
    rows.push({ id, label, url });
  }

  return rows;
}
