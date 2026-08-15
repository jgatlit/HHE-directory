'use client';

import { useState } from 'react';
import { WhopCheckoutEmbed } from '@whop/checkout/react';
import { Check, Loader2 } from 'lucide-react';

type Props = {
  planId: string;
  /** `chs_…` from createBookingCheckoutSession — carries booking_intent_id. */
  sessionId: string;
  /** Captured at step 1. Whop CAN lock this; Calendly cannot (§6) — so here it is authoritative. */
  email: string;
  /** Per-intent return, for the one path where the buyer genuinely leaves (external wallets). */
  returnUrl: string;
  /** Hosted checkout, used when the embed cannot mount (§8 failure table). */
  fallbackUrl: string | null;
  onPaid: () => Promise<{ ok: boolean }>;
};

/**
 * Step 3 — CHECKOUT (§9, D11). The flow never leaves our page.
 *
 * `onComplete` implies `skipRedirect`, so the buyer finishes in place. `returnUrl` is still set
 * because an external wallet DOES navigate away and must come back to this intent — that is the
 * one place §5's idempotent return is load-bearing, and the embed prop is what expresses it.
 *
 * The client callback is an ACCELERATOR, not the record. Payment is reconciled server-side from
 * `payment.succeeded` against the session's `booking_intent_id`, so a buyer who closes the tab
 * mid-redirect is still attributed. Marking PAID here only makes the UI honest immediately.
 */
export function CheckoutStep({
  planId,
  sessionId,
  email,
  returnUrl,
  fallbackUrl,
  onPaid,
}: Props) {
  const [paid, setPaid] = useState(false);
  const [failed, setFailed] = useState(false);

  if (paid) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/20 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Check className="h-4 w-4 text-primary" aria-hidden />
          Payment complete — you&apos;re all set.
        </p>
        <p className="text-xs text-muted-foreground">
          A receipt is on its way to {email}.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Payment</h2>

      {failed && fallbackUrl && (
        // §8 — the embed can fail to mount for reasons we cannot detect cross-origin. The hosted
        // checkout is the documented fallback rather than a dead end.
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          Couldn&apos;t load the payment form.{' '}
          <a href={fallbackUrl} className="font-medium underline underline-offset-2">
            Open checkout in a new tab
          </a>
          .
        </p>
      )}

      <div className="overflow-hidden rounded-md border bg-card">
        <WhopCheckoutEmbed
          planId={planId}
          sessionId={sessionId}
          returnUrl={returnUrl}
          prefill={{ email }}
          theme="system"
          fallback={
            <div className="flex h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading secure checkout…
            </div>
          }
          onComplete={() => {
            // Reveal immediately; record in the background. The server-side webhook is the
            // authority, so a failed write here must not tell a buyer their payment did not land.
            setPaid(true);
            onPaid().catch((err) => {
              console.error('[booking] mark-paid failed', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }}
        />
      </div>

      {fallbackUrl && !failed && (
        <button
          type="button"
          onClick={() => setFailed(true)}
          className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Having trouble paying?
        </button>
      )}
    </section>
  );
}
