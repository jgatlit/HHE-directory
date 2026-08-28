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
 *
 * ── SUBRESOURCE INTEGRITY: CONSIDERED AND DECLINED (tsk_ead0934c e3, 2026-08-28) ──────────────
 *
 * These tags carry no `integrity` attribute, and that is a decision rather than an oversight.
 *
 * SRI pins a hash of the exact bytes. Calendly's `widget.js` and cal.com's `embed.js` are
 * evergreen widget scripts that the vendors rewrite on THEIR release cadence, with no version in
 * the URL and no notice to us. A pinned hash therefore does not fail on the day someone tampers
 * with a script — it fails on the day the vendor ships a routine update. That failure is total
 * and silent from our side: the browser refuses the script, `loadScript` rejects, and EVERY
 * practitioner on that provider stops being bookable at once, with the first signal being a
 * practitioner telling us nobody can book. Trading a certain, recurring, revenue-stopping outage
 * for a speculative tamper-detection is the wrong side of that bet.
 *
 * It also contradicts the operator ruling of 2026-08-28 on the same task — "trust the
 * Practitioner's vendor, and ensure seamless UX flow & operation" — which is why the
 * vendor-allowlist CSP was rejected too. SRI is the same bet one layer down.
 *
 * WHAT WE RELY ON INSTEAD, stated plainly so nobody mistakes this for coverage we do not have:
 * the vendors' own integrity, and the fact that the booking token stays a PATH segment where
 * neither script reads (see book/actions.ts + tests/booking-token-path.test.ts). We are NOT
 * bounding what a compromised vendor script could exfiltrate; `connect-src` is `https:`.
 *
 * WHEN TO REVISIT: if a vendor ever publishes a VERSIONED, immutable script URL, SRI becomes free
 * of the outage risk and should be adopted for that vendor. The blocker is the evergreen URL, not
 * the mechanism.
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
          // SANDBOXED, with every keyword a real scheduler needs.
          //
          // ⚠️ THIS REPLACES A WRONG DECISION MADE EARLIER THE SAME DAY. The attribute was
          // removed outright on the reasoning that "allow-scripts + allow-same-origin together
          // restore the framed origin's normal privileges, so the containment was already
          // nominal". THAT IS A MISREADING of MDN's warning, which applies only when the framed
          // document is SAME-ORIGIN with the embedder — then it can reach the parent DOM and
          // delete this attribute. Every scheduler here is CROSS-origin, so `allow-same-origin`
          // grants the frame only its own origin. Sandbox flags are ORTHOGONAL to origin; it
          // grants back none of them.
          //
          // The trigger for the removal was Acuity's reCAPTCHA logging
          //   "requestStorageAccess: Refused ... 'allow-storage-access-by-user-activation' is
          //    not set."
          // The browser error NAMED THE MISSING KEYWORD. The correct fix was to add that token,
          // plus allow-modals (confirm dialogs) and allow-downloads (the post-booking .ics) —
          // not to drop the attribute.
          //
          // What this withholds, and removal had granted: allow-top-navigation and its
          // -by-user-activation / -to-custom-protocols variants, pointer lock, orientation lock,
          // presentation. Top navigation is the one that matters: a buyer one step from a live
          // payment form has necessarily clicked inside the frame (picking a time IS a click),
          // so sticky activation is guaranteed and `top.location = …` would have been allowed.
          // "A malicious practitioner could fake a payment form inside the frame anyway" answers
          // phishing but not the uses with no in-frame equivalent — silently redirecting every
          // buyer out of the flow, or launching a custom protocol handler. And "practitioners are
          // vetted" does not cover the whole frame: sandbox flags are INHERITED by nested browsing
          // contexts, and this frame loads Google reCAPTCHA and the provider's own analytics,
          // which the practitioner did not choose.
          //
          // ⚠️ RESIDUAL, stated so nobody re-removes this on a surprise: on a browser that does
          // not implement `allow-storage-access-by-user-activation`, having ANY sandbox attribute
          // re-breaks reCAPTCHA there, where no attribute never would. That is the one honest
          // argument for the removed state. If that regresses, ADD the keyword the error names —
          // do not delete the attribute again.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation allow-modals allow-downloads"
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
