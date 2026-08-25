'use client';

import { useEffect, useState, useTransition } from 'react';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SortableList } from '@/components/practitioners/SortableList';
import { PendingButton } from '@/components/practitioners/PendingButton';
import { OfferingFields, type BookingLinkOption } from '@/components/practitioners/OfferingFields';
import { Separator } from '@/components/ui/separator';

type Offering = {
  id: string;
  title: string;
  description: string | null;
  priceUsdCents: number;
  interval: 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';
  category: string | null;
  duration: number | null;
  isConsult: boolean;
  acceptsPayments: boolean;
  bookingLinkId: string | null;
  listingVisibility: 'LISTED' | 'LINK_ONLY';
  /** Carried for §17.3c, which will address embedded checkout by plan id (D11). NOTE: the
   *  published flag today is still `purchaseUrl` — PublishRow keys off it — so do not read this
   *  as "the published flag" until that step actually switches over. */
  whopPlanId: string | null;
  purchaseUrl: string | null;
};

type Action = (formData: FormData) => void | Promise<void>;

/**
 * Practitioner offerings editor (Phase 2 + Layer Y publish). Offerings are stored locally
 * (WhopProduct); publishOffering()/unpublishOffering() mint or clear the live Whop checkout.
 * Each row is one <form> whose Save button posts to updateAction; Remove, Publish, and
 * Unpublish all override via formAction the same way (so there are no nested forms — a
 * <form> inside a <form> is invalid HTML and browsers hoist the inner one's fields out of
 * it, breaking the row). A separate add form appends a new offering.
 *
 * Order is drag-to-sort (operator finding 2026-08-25: the old up/down-arrows-plus-explicit-save
 * control was confusing in the actual GUI). Offerings are the one sortable list that can't ride
 * along in a shared form the way specialties/booking links do — each row is its OWN <form> behind
 * per-offering create/update/delete/publish actions — so the drag handle calls `reorderAction`
 * (`reorderOfferings`) DIRECTLY on drop, never wrapping the offering forms in a shared container.
 * Reordering is a pure array-position change keyed on `o.id`, so React reuses each row's existing
 * DOM subtree in its new slot rather than remounting it — an in-progress, unsaved edit sitting in
 * a sibling offering's own uncontrolled fields is never touched by dragging a different row.
 */
export function OfferingsEditor({
  offerings,
  payoutsEnabled,
  whopConnected,
  bookingLinks,
  createAction,
  updateAction,
  deleteAction,
  publishAction,
  unpublishAction,
  reorderAction,
}: {
  offerings: Offering[];
  payoutsEnabled: boolean;
  /** Whop account exists. Gates whether "Accept payments" is EDITABLE (§9). */
  whopConnected: boolean;
  bookingLinks: BookingLinkOption[];
  createAction: Action;
  updateAction: Action;
  deleteAction: Action;
  publishAction: Action;
  unpublishAction: Action;
  reorderAction: Action;
}) {
  const [order, setOrder] = useState(offerings);
  const [isPending, startTransition] = useTransition();

  // Server state wins after any revalidate (delete/create/publish all trigger one) — otherwise a
  // change made elsewhere on the page leaves this list holding a stale row, or missing a new one.
  useEffect(() => setOrder(offerings), [offerings]);

  function handleReorder(next: Offering[]) {
    setOrder(next);
    const formData = new FormData();
    formData.set('orderJson', JSON.stringify(next.map((o) => o.id)));
    // Fire-and-persist: there is no separate "save order" step for this list, matching how the
    // old up/down control auto-saved on click. The local `order` state above is what the practitioner
    // sees immediately; reorderAction's own revalidatePath is what makes it durable.
    startTransition(() => {
      void reorderAction(formData);
    });
  }

  return (
    <Card id="offerings" className="scroll-mt-8 space-y-5 p-6 sm:p-8">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Offerings</h2>
        <p className="text-xs text-muted-foreground">
          Consultations, sessions, packages, products, subscriptions — name them and set your own
          prices. They show on your profile now; publish any offering to turn on online checkout,
          or leave it unpublished and clients still reach you via your booking link.
        </p>
      </div>

      {order.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Drag to reorder — this is the order shown on your profile, first to last.
          {isPending && ' Saving…'}
        </p>
      )}

      {order.length > 0 && (
        <div className="space-y-3">
          <SortableList items={order} onReorder={handleReorder}>
            {(o, i, handle) => (
              <div className="rounded-lg border p-3">
                {order.length > 1 && (
                  <div className="mb-2 flex items-center gap-1">
                    {handle}
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Offering {i + 1}
                    </span>
                  </div>
                )}
                <form action={updateAction} className="space-y-3">
                  <input type="hidden" name="offeringId" value={o.id} />
                  <OfferingFields
                    offering={o}
                    idPrefix={o.id}
                    bookingLinks={bookingLinks}
                    whopConnected={whopConnected}
                    payoutsEnabled={payoutsEnabled}
                  />
                  <PublishRow
                    offering={o}
                    payoutsEnabled={payoutsEnabled}
                    publishAction={publishAction}
                    unpublishAction={unpublishAction}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      formAction={deleteAction}
                      formNoValidate
                      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Remove
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      Save
                    </button>
                  </div>
                </form>
              </div>
            )}
          </SortableList>
        </div>
      )}

      <Separator />

      <form action={createAction} className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add an offering
        </p>
        <OfferingFields
          // createOffering redirects to the SAME route, so React keeps this subtree mounted and
          // the lazy useState initialisers never re-run — the add form would still show the last
          // offering's free-consult / link / visibility choices, and one more click would create
          // a duplicate carrying settings nobody picked for it. Re-keying on the saved set forces
          // a fresh mount. Recorded in project memory as having bitten this repo twice.
          key={`new-${offerings.map((o) => o.id).join(',')}`}
          offering={null}
          idPrefix="new"
          bookingLinks={bookingLinks}
          whopConnected={whopConnected}
          payoutsEnabled={payoutsEnabled}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-4 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add offering
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Publish/unpublish control for one offering row. Plain markup, NOT its own <form> — it
 * lives inside the row's single <form action={updateAction}>, and its buttons reach
 * publishAction/unpublishAction via formAction exactly the way Remove reaches deleteAction.
 */
function PublishRow({
  offering,
  payoutsEnabled,
  publishAction,
  unpublishAction,
}: {
  offering: Offering;
  payoutsEnabled: boolean;
  publishAction: Action;
  unpublishAction: Action;
}) {
  if (offering.purchaseUrl) {
    return (
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <Badge variant="secondary" className="gap-1 text-[10px] uppercase tracking-wider">
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          Live — patients can buy this
        </Badge>
        <PendingButton
          intent="unpublish"
          formAction={unpublishAction}
          formNoValidate
          pendingLabel="Unpublishing…"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          Unpublish
        </PendingButton>
      </div>
    );
  }

  if (payoutsEnabled) {
    return (
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">Not published — only you can see this.</p>
        <PendingButton
          intent="publish"
          formAction={publishAction}
          formNoValidate
          pendingLabel="Publishing…"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          Publish
        </PendingButton>
      </div>
    );
  }

  // An offering without online checkout is a legitimate state, not an error — keep this
  // matter-of-fact rather than a dead disabled button with no explanation.
  return (
    <p className="border-t pt-3 text-xs text-muted-foreground">
      Set up payouts to sell this online — see{' '}
      <a href="#payments" className="font-medium underline underline-offset-2 hover:text-foreground">
        Patient payments
      </a>{' '}
      below. Bookings still work via your booking link either way.
    </p>
  );
}

