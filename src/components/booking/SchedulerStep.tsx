'use client';

import { useState, useTransition } from 'react';
import { CalendarClock, Check, ExternalLink, Loader2 } from 'lucide-react';

type Props = {
  schedulerUrl: string;
  practitionerName: string;
  /** Records SELF_REPORT / ASSUMED. Never blocks — see D8. */
  onAdvance: (signal: 'SELF_REPORT' | 'ASSUMED') => Promise<{ ok: boolean }>;
  /** Step 3 exists for this intent (§9 payments_live). */
  hasCheckout: boolean;
  checkoutUrl: string | null;
};

/**
 * Step 2 — SCHEDULE, on the NULL ADAPTER (§6, §7, §8; decisions D8, D9).
 *
 * This is the generic path: a plain iframe, no prefill, no completion event. It is built FIRST
 * and treated as THE REAL PATH, not a fallback — progressive enhancement rather than graceful
 * degradation. If the rich path were built first the fallbacks become afterthoughts nobody
 * exercises, and the reference practitioner lives on the fallback: Sarah Schindler is on Acuity,
 * which emits no completion event, and only 3 booking links exist across all 16 practitioners.
 * The self-report path IS the production path on day one.
 *
 * ADVANCE BY REVEALING, NOT NAVIGATING (§8). Collapsing the scheduler and showing what is next
 * keeps one page and one history entry, so the browser back button still means "leave the flow"
 * rather than "undo a step".
 */
export function SchedulerStep({
  schedulerUrl,
  practitionerName,
  onAdvance,
  hasCheckout,
  checkoutUrl,
}: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [pending, startTransition] = useTransition();

  function advance(signal: 'SELF_REPORT' | 'ASSUMED') {
    // Reveal IMMEDIATELY and record in the background. D8 is explicit that our bookkeeping must
    // never gate the buyer, so a slow or failed write must not hold up their journey.
    setAdvanced(true);
    startTransition(() => {
      void onAdvance(signal);
    });
  }

  if (advanced) {
    return (
      <div className="space-y-3 rounded-md border bg-muted/20 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Check className="h-4 w-4 text-primary" aria-hidden />
          Thanks — {practitionerName} has your details.
          {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />}
        </p>

        {hasCheckout && checkoutUrl ? (
          <>
            <p className="text-xs text-muted-foreground">Last step — payment.</p>
            <a
              href={checkoutUrl}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Continue to payment
            </a>
          </>
        ) : (
          // A buyer can reach the done screen without having picked a time — that is allowed by
          // D8 and handled in COPY, not machinery (§8).
          <p className="text-xs text-muted-foreground">
            If you haven&apos;t picked a time yet,{' '}
            <a
              href={schedulerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-foreground"
            >
              book it here
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-medium">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
        Pick a time with {practitionerName}
      </h2>

      {/*
        §7 vertical adaptivity. The parent CANNOT measure a cross-origin frame — reading
        contentWindow.document throws — and no fallback protocol can be assumed, so we adapt to
        the VIEWPORT instead of the content.

        `dvh`, NOT `vh`: mobile browser chrome makes `vh` wrong exactly when it matters most, and
        mobile is the risk case here rather than the edge case.

        `min-height` is reserved BEFORE load so initialisation does not reflow the page the first
        time the buyer sees this step. One scroll context, not two — a scheduler scrolling inside
        a fixed box is the same attention loss as a new tab, only slower and more irritating.

        `sandbox` is deliberately NOT set. An over-restrictive value breaks provider embeds in a
        way that looks exactly like a provider outage (§7).
      */}
      <div
        className="overflow-hidden rounded-md border bg-card"
        style={{ height: 'min(85dvh, 900px)', minHeight: 'min(85dvh, 900px)' }}
      >
        <iframe
          src={schedulerUrl}
          title={`Booking calendar for ${practitionerName}`}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* T2 self-report. Soft and buyer-controlled — it is honest about the fact that we cannot
            observe an Acuity booking, rather than pretending to. */}
        <button
          type="button"
          onClick={() => advance('SELF_REPORT')}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          I&apos;ve booked my time
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="flex items-center gap-3">
          <a
            href={schedulerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            Open in a new tab
          </a>
          {/* NEVER HARD-GATE (D8). This stays reachable with no provider event and no
              self-report click; taking it records `ASSUMED` rather than blocking. */}
          <button
            type="button"
            onClick={() => advance('ASSUMED')}
            className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {hasCheckout ? 'Skip to payment' : 'Continue'}
          </button>
        </div>
      </div>
    </section>
  );
}
