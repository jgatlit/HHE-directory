'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SortableList } from '@/components/practitioners/SortableList';
import { duplicateBookingRowKeys } from '@/lib/booking-links';

export type BookingLinkInput = { id: string; label: string; url: string };
/**
 * `dbId` is the persisted BookingLink id — empty for a row the practitioner just added, and the
 * value posted back as `bookingId`. `id` is a render-local dnd-kit identity that never leaves the
 * browser; SortableList keys on `id`, and a database id cannot serve that role because new rows
 * do not have one yet and would all collide on the empty string.
 */
type Row = { id: string; dbId: string; label: string; url: string };

type Props = { initial: BookingLinkInput[] };

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
export function BookingLinksField({ initial }: Props) {
  const nextKey = useRef(0);
  const mint = () => `bl-${nextKey.current++}`;
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length > 0 ? initial : [{ id: '', label: '', url: '' }]).map((r) => ({
      id: mint(),
      dbId: r.id,
      label: r.label,
      url: r.url,
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

  const update = (id: string, patch: Partial<Omit<Row, 'id' | 'dbId'>>) =>
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => {
    setRows((r) => r.filter((row) => row.id !== id));
    announce();
  };
  const add = () => {
    setRows((r) => [...r, { id: mint(), dbId: '', label: '', url: '' }]);
    announce();
  };

  // Advisory only — the same scheduler under DIFFERENT names is the feature, so only rows
  // identical on both URL and label are flagged. Never blocks the save.
  const dupes = duplicateBookingRowKeys(rows);

  return (
    <div className="space-y-2" ref={root}>
      <SortableList items={rows} onReorder={setRows}>
        {(row, _i, handle) => (
          <div className="flex items-start gap-2 pb-2">
            {handle}
            {/* Posted alongside the visible fields so the three getAll() arrays line up by index.
                Always rendered, even when empty, or a new row would shift every later row's id. */}
            <input type="hidden" name="bookingId" value={row.dbId} />
            <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
              <input
                type="text"
                name="bookingLabel"
                value={row.label}
                onChange={(e) => update(row.id, { label: e.target.value })}
                placeholder="Label (e.g. Free intro)"
                className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
              />
              <input
                type="url"
                name="bookingUrl"
                value={row.url}
                onChange={(e) => update(row.id, { url: e.target.value })}
                placeholder="https://cal.com/your-username/intro-consult"
                className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring/30 focus-visible:ring-2"
              />
              {dupes.has(row.id) && (
                <p className="text-[11px] text-muted-foreground sm:col-span-2">
                  Another link has this same name and address. That is fine if you meant it — give
                  them different names if you did not.
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
        )}
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
