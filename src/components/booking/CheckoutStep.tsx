'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WhopCheckoutEmbed } from '@whop/checkout/react';
import { Check, Loader2 } from 'lucide-react';

type Props = {
  /**
   * `ch_…` — the per-booking checkout CONFIGURATION, carrying booking_intent_id.
   *
   * Passed to the embed's `sessionId` prop because that is what Whop calls a configuration there
   * (its placeholder is `ch_XXXXXXXX`, and their hosted url is `…/checkout/plan_…/?session=ch_…`).
   * It is NOT a `chs_…` object from /v1/checkout_sessions — those render a 404 in the iframe.
   */
  checkoutConfigId: string;
  /** Captured at step 1. Whop CAN lock this; Calendly cannot (§6) — so here it is authoritative. */
  email: string;
  /** Per-intent return, for the one path where the buyer genuinely leaves (external wallets). */
  returnUrl: string;
  /** Hosted checkout, used when the embed cannot mount (§8 failure table). */
  fallbackUrl: string | null;
};

/**
 * Step 3 — CHECKOUT (§9, D11). The flow never leaves our page.
 *
 * `onComplete` implies `skipRedirect`, so the buyer finishes in place. `returnUrl` is still set
 * because an external wallet DOES navigate away and must come back to this intent — that is the
 * one place §5's idempotent return is load-bearing, and the embed prop is what expresses it.
 *
 * `onComplete` IS DISPLAY ONLY — it writes nothing. Payment is recorded exclusively by the
 * `payment.succeeded` webhook, matching the session's `booking_intent_id`, because that is the
 * only party that can prove money moved.
 *
 * An earlier revision had this callback POST a public unauthenticated action that set PAID from
 * the two values printed in the URL — so anyone holding a booking link could record a sale that
 * never happened, and permanently dead-end that buyer. It also meant a tab closed mid-redirect
 * was never recorded at all. Do not reintroduce a client-side writer here.
 *
 * NO `planId` PROP. The library builds its iframe url as `sessionId || planId`, so anything
 * passed as `planId` alongside a `sessionId` is dead at runtime
 * (node_modules/@whop/checkout/dist/static/checkout/react/index.js).
 *
 * ⚠️ The value handed to `sessionId` must be a `ch_…` CONFIGURATION. A `chs_…` session from
 * /v1/checkout_sessions type-checks, mounts, and renders Whop's "Nothing to see here yet" 404 —
 * which is what shipped to production on 2026-08-15. See createBookingCheckoutConfig.
 */
export function CheckoutStep({ checkoutConfigId, email, returnUrl, fallbackUrl }: Props) {
  const [paid, setPaid] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  // Pull the server's settled view in once the webhook has had a moment to land. Without this the
  // buyer sits on a client-only "complete" screen, and a reload before the webhook arrives
  // re-renders a live payment form on a session they have already paid — the embed has no way to
  // know it is done, because `paidAt` is what decides that and it lives on the server.
  useEffect(() => {
    if (!paid) return;
    const t = setInterval(() => router.refresh(), 3000);
    const stop = setTimeout(() => clearInterval(t), 30_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [paid, router]);

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

      {failed && (
        // §8 — the hosted checkout is the documented fallback rather than a dead end. It is
        // UNATTRIBUTED (minted from the offering's configuration, so it carries practitioner_id
        // and offering_id but no booking_intent_id): a payment taken through it reconciles to no
        // intent, which the webhook now reports rather than swallowing. Offered anyway, because a
        // buyer who cannot pay at all is the worse outcome — but it is a last resort, not a peer.
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          {fallbackUrl ? (
            <>
              Couldn&apos;t complete the payment form.{' '}
              <a href={fallbackUrl} className="font-medium underline underline-offset-2">
                Open checkout in a new tab
              </a>
              .
            </>
          ) : (
            <>Couldn&apos;t complete the payment form. Please refresh and try again.</>
          )}
        </p>
      )}

      <div className="overflow-hidden rounded-md border bg-card">
        <WhopCheckoutEmbed
          sessionId={checkoutConfigId}
          returnUrl={returnUrl}
          prefill={{ email }}
          disableEmail
          theme="system"
          fallback={
            <div className="flex h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading secure checkout…
            </div>
          }
          // Optimistic display only. The webhook records the payment; this just stops the buyer
          // staring at a checkout form they have already completed while it lands.
          onComplete={() => setPaid(true)}
          // The embed DOES tell us when payment fails — surfacing the fallback only when the buyer
          // notices a small grey link was leaving declines invisible to them and to us.
          onPaymentError={(error) => {
            console.error('[booking] embedded checkout payment error', error);
            setFailed(true);
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
