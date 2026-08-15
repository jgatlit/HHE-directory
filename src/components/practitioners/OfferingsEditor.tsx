import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { OfferingOrderControls } from '@/components/practitioners/OfferingOrderControls';
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
  /** D11 — the published flag is the PLAN id, not purchaseUrl: embedded checkout is addressed by
   *  plan id and purchaseUrl is the hosted fallback only. */
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
 */
export function OfferingsEditor({
  offerings,
  payoutsEnabled,
  bookingLinks,
  practitionerSlug,
  createAction,
  updateAction,
  deleteAction,
  publishAction,
  unpublishAction,
  reorderAction,
}: {
  offerings: Offering[];
  payoutsEnabled: boolean;
  bookingLinks: BookingLinkOption[];
  practitionerSlug: string;
  createAction: Action;
  updateAction: Action;
  deleteAction: Action;
  publishAction: Action;
  unpublishAction: Action;
  reorderAction: Action;
}) {
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

      {offerings.length > 1 && (
        <OfferingOrderControls ids={offerings.map((o) => o.id)} action={reorderAction} />
      )}

      {offerings.length > 0 && (
        <ul className="space-y-3">
          {offerings.map((o) => (
            <li key={o.id} className="rounded-lg border p-3">
              <form action={updateAction} className="space-y-3">
                <input type="hidden" name="offeringId" value={o.id} />
                <OfferingFields
                  offering={o}
                  idPrefix={o.id}
                  bookingLinks={bookingLinks}
                  payoutsEnabled={payoutsEnabled}
                  practitionerSlug={practitionerSlug}
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
            </li>
          ))}
        </ul>
      )}

      <Separator />

      <form action={createAction} className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add an offering
        </p>
        <OfferingFields
          offering={null}
          idPrefix="new"
          bookingLinks={bookingLinks}
          payoutsEnabled={payoutsEnabled}
          practitionerSlug={practitionerSlug}
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

