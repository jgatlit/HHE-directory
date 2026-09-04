'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, X, ExternalLink } from 'lucide-react';
import { SortableList } from '@/components/practitioners/SortableList';
import { duplicateBookingRowKeys } from '@/lib/booking-links';
import { unattachedNameMatch } from '@/lib/profile-ctas';
import { detectProvider, extractUrlFromEmbed, withScheme, PROVIDER_LABEL } from '@/lib/booking-providers';
import { formatPrice } from '@/lib/money';

export type BookingLinkInput = { id: string; label: string; url: string; ctaLabel: string };
/**
 * `dbId` is the persisted BookingLink id — empty for a row the practitioner just added, and the
 * value posted back as `bookingId`. `id` is a render-local dnd-kit identity that never leaves the
 * browser; SortableList keys on `id`, and a database id cannot serve that role because new rows
 * do not have one yet and would all collide on the empty string.
 */
type Row = { id: string; dbId: string; label: string; url: string; ctaLabel: string };

type Props = {
  initial: BookingLinkInput[];
  /** Id of the `<form>` this field's inputs submit with. Required when this component renders
   *  outside that form's own DOM subtree (see edit/page.tsx — booking links are laid out next to
   *  Offerings, physically apart from the "Save profile" form they still need to submit with).
   *  The HTML `form` attribute is what makes that work: every submitted input below needs it, or
   *  that one field silently drops out of the submission with no error — the same "missing form="
   *  shape this codebase is already careful about elsewhere. */
  formId: string;
  /** §22: which Offering(s) each persisted Booking Link (keyed on `dbId`) actually carries — the
   *  same relationship the public chooser/hero render from, surfaced here so a practitioner can
   *  see a mismatch WHILE editing instead of only on their own live profile. */
  offeringsByLinkId: Record<string, { title: string; priceUsdCents: number }[]>;
  /** Every Offering title on the account, for the "this link's name matches an Offering that
   *  isn't attached to it" nudge below. */
  offeringTitles: string[];
};

/**
 * Repeatable booking-link field (Wedge 2B). Each row emits a `bookingId` + `bookingLabel` +
 * `bookingUrl` triple into the form; the server action zips them by index. The whole edit page
 * is a server component, so this island manages add/remove/reorder state client-side.
 *
 * ORDER IS SUBMISSION ORDER. The server writes `sortOrder: idx` from the order these inputs
 * arrive in, so dragging a row here is the entire reorder mechanism — no separate action,
 * nothing to keep in sync. It also means a reorder is only persisted when the profile is saved,
 * which is consistent with every other field on this form.
 *
 * Booking links are the PRIMARY CTAs on a profile (booking link = a buyer who has decided to
 * act), so their order is the order a visitor meets them in.
 *
 * `bookingId` is LOAD-BEARING, not bookkeeping. It carries each row's database identity through
 * the round trip so the server can update rows in place. Without it the server cannot tell an
 * edited row from a new one, and its only option is to delete every link and recreate them —
 * which mints new ids on every save and breaks anything pointing at BookingLink.id.
 */
export function BookingLinksField({
  initial,
  formId,
  offeringsByLinkId,
  offeringTitles,
}: Props) {
  const nextKey = useRef(0);
  const mint = () => `bl-${nextKey.current++}`;
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length > 0 ? initial : [{ id: '', label: '', url: '', ctaLabel: '' }]).map((r) => ({
      id: mint(),
      dbId: r.id,
      label: r.label,
      url: r.url,
      ctaLabel: r.ctaLabel,
    })),
  );

  const root = useRef<HTMLDivElement>(null);
  /**
   * Adding or removing a row changes React state and emits no DOM event, so the profile form's
   * unsaved-changes guard cannot see it — the same blind spot SortableList already announces
   * around for drag-reorder. Removing a link was the live case: click X, click Cancel, and the
   * guard stayed silent while a booking link went missing.
   */
  const announce = () =>
    root.current?.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

  /**
   * Relay every input/change bubbling inside this field — typing, the "Main" radio, and the
   * `announce()` above (itself covering add/remove and SortableList's own reorder-announce,
   * since SortableList is nested inside this root) — on to the ACTUAL form.
   *
   * `form={formId}` on the inputs above only restores SUBMISSION: the HTML `form` attribute
   * governs which FormData a control's value joins, not where its DOM events bubble. This field
   * now renders as a sibling of `<form id={formId}>` (see edit/page.tsx — booking links sit next
   * to Offerings, physically outside the profile form), so every one of those events bubbles
   * through this component's own ancestry and dead-ends before ever reaching the form —
   * UnsavedChangesBar listens on the form element itself and never sees any of them. Re-dispatch
   * directly on the form, which is what its existing, unmodified listener already expects.
   */
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const relay = () => {
      document.getElementById(formId)?.dispatchEvent(new Event('input', { bubbles: true }));
    };
    node.addEventListener('input', relay);
    node.addEventListener('change', relay);
    return () => {
      node.removeEventListener('input', relay);
      node.removeEventListener('change', relay);
    };
  }, [formId]);

  const update = (id: string, patch: Partial<Omit<Row, 'id' | 'dbId'>>) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => {
    setRows((r) => r.filter((row) => row.id !== id));
    announce();
  };
  const add = () => {
    setRows((r) => [...r, { id: mint(), dbId: '', label: '', url: '', ctaLabel: '' }]);
    announce();
  };

  // Advisory only — the same scheduler under DIFFERENT names is the feature, so only rows
  // identical on both URL and label are flagged. Never blocks the save.
  const dupes = duplicateBookingRowKeys(rows);

  return (
    <div className="space-y-2" ref={root}>
      <SortableList items={rows} onReorder={setRows}>
        {(row, i, handle) => {
          // §22: attached-offerings visibility + the mismatch nudge. Both are read-only signals
          // for a row that has actually been saved — a brand-new, not-yet-persisted row has no
          // BookingLink.id to look up and showing "No offerings attached" for it would be a false
          // signal about a link that does not exist yet.
          const attached = row.dbId ? (offeringsByLinkId[row.dbId] ?? []) : [];
          const unattachedMatch =
            row.dbId !== ''
              ? unattachedNameMatch(
                  row.label,
                  attached.map((a) => a.title),
                  offeringTitles,
                )
              : null;

          return (
          <div className="flex items-start gap-2 pb-2">
            {handle}
            {/* Posted alongside the visible fields so the three getAll() arrays line up by index.
                Always rendered, even when empty, or a new row would shift every later row's id. */}
            <input type="hidden" name="bookingId" value={row.dbId} form={formId} />
            {/* §14.3 — which link owns the hero slot. Keyed on ROW INDEX, not id, so a link the
                practitioner just added can be made primary before it has one; the server maps
                the index back to the real id after reconciling. Without a writer the hero
                resolver read a column nothing ever set, and anyone with two links lost their
                primary CTA to a placeholder. */}
            <label className="mt-2.5 flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="radio"
                name="primaryBookingIndex"
                value={i}
                defaultChecked={i === 0}
                aria-label={`Make booking link ${i + 1} the main button`}
                form={formId}
              />
              Main
            </label>
            <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
              <input
                type="text"
                name="bookingLabel"
                value={row.label}
                onChange={(e) => update(row.id, { label: e.target.value })}
                placeholder="Label (e.g. Free intro)"
                className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
                form={formId}
              />
              <input
                // `type="text"`, not `type="url"`: §6 accepts pasted <iframe> markup and extracts
                // its src, and a url input would refuse to submit that before we ever see it.
                type="text"
                name="bookingUrl"
                value={row.url}
                onChange={(e) => update(row.id, { url: e.target.value })}
                onBlur={(e) => {
                  const cleaned = extractUrlFromEmbed(e.target.value);
                  if (cleaned !== e.target.value) update(row.id, { url: cleaned });
                }}
                placeholder="https://cal.com/your-username/intro-consult"
                className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
                form={formId}
              />
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                {/* Provider is DERIVED, never asked for (§6). Showing it back is how the
                    practitioner learns we recognised their scheduler — and "Other" is a valid,
                    working outcome (the null adapter), not an error, so it is stated plainly. */}
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {row.url.trim() ? PROVIDER_LABEL[detectProvider(row.url)] : 'No link yet'}
                  {/* detectProvider is scheme-tolerant, so `calendly.com/x` reports CALENDLY —
                      matching what the server persists rather than "Other". */}
                </span>
                <input
                  type="text"
                  name="bookingCtaLabel"
                  value={row.ctaLabel}
                  onChange={(e) => update(row.id, { ctaLabel: e.target.value })}
                  placeholder="Button text (optional)"
                  aria-label="Button text"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs outline-none ring-ring/30 focus-visible:ring-2"
                  form={formId}
                />
                {/* §15 mechanism 2. We deliberately build NO server-side link crawler: a 200
                    does not mean the event type still exists or is bookable, and the
                    practitioner is the only party who can confirm the calendar is theirs
                    and live. */}
                <a
                  // withScheme mirrors the server's normalisation. Using the raw value made
                  // `as.me/sarah` resolve as a RELATIVE path — opening a 404 on our own domain
                  // and telling the practitioner their working scheduler was broken.
                  href={withScheme(row.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!withScheme(row.url)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                    withScheme(row.url)
                      ? 'hover:bg-accent/40'
                      : 'pointer-events-none opacity-40'
                  }`}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Test link
                </a>
              </div>
              {dupes.has(row.id) && (
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  Another link has this same name and address. That is fine if you meant it — give
                  them different names if you did not.
                </p>
              )}
              {/* §22: which Offering(s) this link actually carries — Amy Sprouse's own account had
                  an Offering named "3 Month Health Transformation" attached to a DIFFERENT link
                  than the one also named "3 Month Health Transformation", invisible until the
                  live profile was checked. Only for a persisted link — see the comment above. */}
              {row.dbId !== '' && (
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  {attached.length > 0 ? (
                    <>
                      Offerings attached:{' '}
                      {attached
                        .map((o) => `${o.title} (${formatPrice(o.priceUsdCents)})`)
                        .join(', ')}
                    </>
                  ) : (
                    'No offerings attached — this link opens straight into scheduling.'
                  )}
                </p>
              )}
              {unattachedMatch && (
                <p className="text-[11px] text-amber-700 sm:col-span-2 dark:text-amber-400">
                  You have an Offering titled &ldquo;{unattachedMatch}&rdquo; that isn&apos;t
                  attached to this link — attach it below if that was the intent.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(row.id)}
              aria-label="Remove booking link"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          );
        }}
      </SortableList>

      {rows.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Drag to reorder — the first link is the main button on your profile.
        </p>
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add another booking link
      </button>
    </div>
  );
}
