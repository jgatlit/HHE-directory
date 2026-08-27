'use client';

import { useEffect, useRef, useState } from 'react';
import { schedulerEmbed, type EmbedStrategy, type SchedulerLead } from '@/lib/scheduler-adapters';

type Props = {
  schedulerUrl: string;
  practitionerName: string;
  /** Null for the pre-capture render and for the null adapter, where prefill is impossible. */
  lead: SchedulerLead | null;
};

const SCRIPTS = {
  calendly: 'https://assets.calendly.com/assets/external/widget.js',
  cal_com: 'https://app.cal.com/embed/embed.js',
  acuity: 'https://embed.acuityscheduling.com/js/embed.js',
} as const;

/**
 * Load a third-party script once per document and resolve when it is usable.
 *
 * Keyed on src so a remount (React strict mode, a re-render, a second booking in one session)
 * reuses the tag instead of appending duplicates — which for Acuity is not merely wasteful:
 * `embed.js` BREAKS when more than one of its widgets is initialised on a page.
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`failed: ${src}`)), { once: true });
      return;
    }
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.addEventListener('load', () => {
      tag.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    tag.addEventListener('error', () => reject(new Error(`failed: ${src}`)), { once: true });
    document.head.appendChild(tag);
  });
}

/**
 * The mounted scheduler (§6 embed, §7 vertical adaptivity).
 *
 * §7's rule is ANCHOR THE TOP, FREE THE BOTTOM. Nothing sits below this frame in the single-view
 * design, so height changes propagate downward into empty space and cost nothing:
 *
 *   - `minHeight` holds the honest default; height itself is AUTO, so growth is UNBOUNDED. Sarah's
 *     Acuity intake form measures 3638px and that is fine.
 *   - There is deliberately NO `overflow-y: auto` and no max-height on a resizing provider. Capping
 *     and scrolling internally creates the two scroll contexts §7 exists to prevent.
 *   - Shrink is absorbed at the bottom (Calendly moves 1100 → 687 → 660 → 648 → 798 within one
 *     session), so nothing above this frame is ever displaced.
 *
 * We add NO `postMessage` listener of our own. Each provider's script owns its resize protocol,
 * and a hand-rolled listener is where §7's origin-validation hazard lives — an unvalidated one
 * lets any framed page resize or spoof our UI. Not writing it is the safer way to satisfy it.
 *
 * The null adapter cannot report height at all (reading `contentWindow.document` across origins
 * throws), so it adapts to the VIEWPORT instead of the content: `min(85dvh, 900px)`.
 */
export function SchedulerFrame({ schedulerUrl, practitionerName, lead }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const strategy: EmbedStrategy = schedulerEmbed(schedulerUrl, lead);

  useEffect(() => {
    if (strategy.kind === 'iframe') return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      try {
        if (strategy.kind === 'calendly') {
          await loadScript(SCRIPTS.calendly);
          if (cancelled) return;
          const Calendly = (window as unknown as { Calendly?: {
            initInlineWidget: (o: Record<string, unknown>) => void;
          } }).Calendly;
          if (!Calendly) throw new Error('Calendly global missing');
          host.innerHTML = '';
          Calendly.initInlineWidget({
            url: strategy.url,
            parentElement: host,
            // Prefill is a WIDGET-API property delivered over postMessage — appending it to the
            // URL does nothing. Verified live, including on a free plan.
            prefill: strategy.prefill ?? {},
            resize: true,
          });
        } else {
          await loadScript(SCRIPTS.cal_com);
          if (cancelled) return;
          const Cal = (window as unknown as { Cal?: (...args: unknown[]) => void }).Cal;
          if (!Cal) throw new Error('Cal global missing');
          Cal('init', { origin: strategy.origin });
          host.innerHTML = '';
          Cal('inline', {
            elementOrSelector: host,
            calLink: strategy.calLink,
            // The CONFIG OBJECT, never a hand-built query string: the script serialises `name`
            // first, which is what defeats cal.com's known prefill-ordering bug.
            config: strategy.config ?? {},
          });
        }
      } catch (err) {
        if (cancelled) return;
        // Visible, and degraded to a working link rather than a blank box. §8: a failed embed is
        // never terminal — the lead is already captured, because capture precedes the mount.
        console.error('[booking] scheduler embed failed', {
          kind: strategy.kind,
          error: err instanceof Error ? err.message : String(err),
        });
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `strategy` is recomputed each render from these two, so depend on the inputs rather than
    // the object identity — otherwise every render tears down and re-initialises the widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulerUrl, lead?.name, lead?.email, strategy.kind]);

  if (failed) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/20 p-4">
        <p className="text-sm font-medium">
          We couldn&rsquo;t open {practitionerName}&rsquo;s calendar here.
        </p>
        <p className="text-xs text-muted-foreground">
          Your details are already saved — {practitionerName} has them either way.
        </p>
        <a
          href={schedulerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open the calendar in a new tab
        </a>
      </div>
    );
  }

  if (strategy.kind === 'iframe') {
    return (
      <div
        className="overflow-hidden rounded-md border bg-card"
        style={
          strategy.resizes
            // Acuity / SavvyCal report height through their own script: hold the honest floor and
            // let it grow without bound.
            ? { minHeight: 'min(70dvh, 640px)' }
            // Null adapter — unmeasurable, so size to the viewport (§7).
            : { height: 'min(85dvh, 900px)' }
        }
      >
        <iframe
          src={strategy.src}
          title={`Booking calendar for ${practitionerName}`}
          className="w-full border-0"
          style={{ height: strategy.resizes ? 'min(70dvh, 640px)' : '100%', minHeight: '100%' }}
          // NO referrerPolicy override. The browser default is strict-origin-when-cross-origin; an
          // explicit no-referrer-when-downgrade would send the FULL url — which carries the intent
          // token, the credential for this flow — to the scheduler and its analytics.
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
    );
  }

  // Script-driven providers manage the height of the element they populate. `minHeight` only sets
  // the floor — no max-height, no internal scrolling.
  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-md border bg-card"
      style={{ minHeight: 'min(70dvh, 640px)' }}
      data-testid="scheduler-embed"
    />
  );
}
