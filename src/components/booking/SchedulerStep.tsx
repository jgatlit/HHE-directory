'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Check, ExternalLink, Loader2 } from 'lucide-react';

type Props = {
  schedulerUrl: string;
  practitionerName: string;
  /** Records SELF_REPORT / ASSUMED. Never blocks — see D8. */
  onAdvance: (signal: 'SELF_REPORT' | 'ASSUMED') => Promise<{ ok: boolean }>;
  /**
   * Step 3's destination, or null when there is none. ONE prop, not a boolean plus a URL: the
   * two could disagree, and did — the pre-advance button promised "Skip to payment" on the
   * boolean while the done state required the URL, so a buyer could ask to pay and land on a
   * screen offering them a calendar link.
   */
  checkoutUrl: string | null;
  /** True when the server will render an EMBEDDED checkout once this step is passed. */
  checkoutComing?: boolean;
};

/**
 * Step 2 — SCHEDULE, on the null adapter (§6, §7, §8; D8, D9).
 *
 * Advancing REVEALS rather than navigates, so the flow keeps one history entry and the back
 * button still means "leave" rather than "undo a step". Rationale for building this path first:
 * docs/booking-flow §17.3b.
 */
export function SchedulerStep({
  schedulerUrl,
  practitionerName,
  onAdvance,
  checkoutUrl,
  checkoutComing = false,
}: Props) {
  const [advanced, setAdvanced] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function advance(signal: 'SELF_REPORT' | 'ASSUMED') {
    // Reveal IMMEDIATELY and record in the background. D8 is explicit that our bookkeeping must
    // never gate the buyer, so a slow or failed write must not hold up their journey.
    setAdvanced(true);
    setStalled(false);
    startTransition(() => {
      onAdvance(signal)
        .then((r) => {
          // Not fatal to the buyer, but it must not be silent: every intent staying PENDING
          // means §10 later emails people who DID schedule, with nothing anywhere saying why.
          if (!r.ok) console.error('[booking] schedule signal refused', { signal });
          return r.ok;
        })
        .catch((err) => {
          console.error('[booking] schedule signal failed', {
            signal,
            error: err instanceof Error ? err.message : String(err),
          });
          return false;
        })
        .then((ok) => {
          // Pull the server's next step in. Without this the buyer sits on a client-rendered done
          // state while the embedded checkout the server would now render never appears.
          //
          // ONLY on success, and this is the whole point: the refresh reveals checkout because the
          // server sees status SCHEDULED. If the signal did not land the status is still PENDING,
          // so the server re-renders THIS step, React keeps `advanced` at the same position, and
          // the buyer is left on "Bringing up payment…" forever with no payment path — the
          // hosted link is deliberately withheld on the embed path. Say so and offer a retry
          // instead of spinning.
          if (!checkoutComing) return;
          if (ok) router.refresh();
          else setStalled(true);
        });
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

        {checkoutComing && stalled ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              We couldn&apos;t bring up payment just then.
            </p>
            <button
              type="button"
              onClick={() => advance('ASSUMED')}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        ) : checkoutComing ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Bringing up payment…
          </p>
        ) : checkoutUrl ? (
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

      */}
      <div
        className="overflow-hidden rounded-md border bg-card"
        style={{ height: 'min(85dvh, 900px)' }}
      >
        <iframe
          src={schedulerUrl}
          title={`Booking calendar for ${practitionerName}`}
          className="h-full w-full border-0"
          loading="lazy"
          // NO referrerPolicy override. The browser default is strict-origin-when-cross-origin;
          // an explicit no-referrer-when-downgrade would send the FULL url — including the intent
          // id, which is the credential for this flow — to the scheduler and its analytics.
          //
          // NO `sandbox` ATTRIBUTE, DELIBERATELY (§7: "do not over-restrict sandbox").
          //
          // It was removed 2026-08-27 after browser verification caught Acuity's own reCAPTCHA
          // failing inside it:
          //   "requestStorageAccess: Refused to execute request. The document is sandboxed, and
          //    the 'allow-storage-access-by-user-activation' keyword is not set."
          // That is the Storage Access API being denied in a third-party context. reCAPTCHA is on
          // the submit path, so the visible symptom would have been bookings failing at the last
          // step, on the provider holding most of our links — and looking exactly like a provider
          // outage, which is the failure mode §7 names.
          //
          // Storage access was not the only casualty. The old list also withheld `allow-modals`
          // (schedulers use confirm dialogs) and `allow-downloads` (the "add to calendar" .ics a
          // buyer gets after booking). Enumerating keywords means guessing what every current AND
          // FUTURE provider needs, and being wrong silently — the same unwinnable game §6 refuses
          // to play for per-provider intake fields.
          //
          // What we gave up: `allow-top-navigation` was previously withheld, so the frame could
          // not replace our page. Accepted, because the containment was already largely nominal —
          // `allow-scripts` + `allow-same-origin` together restore the framed origin's normal
          // privileges — and because the frame is 100% practitioner-supplied content either way:
          // anyone able to abuse top-navigation could equally render a fake payment form INSIDE
          // the frame. Practitioners are invite-only and vetted (§18).
          //
          // What still protects the token: NO `referrerPolicy` override. The browser default is
          // strict-origin-when-cross-origin, so the scheduler receives only our ORIGIN — never the
          // full URL, which carries the booking token (the bearer credential for this flow). That
          // guarantee is independent of sandbox and must not be weakened.
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Calendar not loading?{' '}
        <a
          href={schedulerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2 hover:text-foreground"
        >
          Open it in a new tab
        </a>
        {' '}— some calendars block embedding, and we cannot detect that from here.
      </p>

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
            {/* Keyed on EITHER route to payment. Reading only `checkoutUrl` labelled the embed
                path — the one flow where payment is guaranteed next — as a bland "Continue",
                because that path deliberately passes a null url. */}
            {checkoutUrl || checkoutComing ? 'Skip to payment' : 'Continue'}
          </button>
        </div>
      </div>
    </section>
  );
}
