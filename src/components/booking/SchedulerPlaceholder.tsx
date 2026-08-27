import { CalendarClock, Loader2 } from 'lucide-react';

type Props = {
  practitionerName: string;
  /** True once the buyer has submitted and the real embed is coming up. */
  loading?: boolean;
};

/**
 * The not-yet-loaded scheduler frame that sits BELOW the capture form in the single view (§5).
 *
 * ⚠️ IT MUST RENDER NO FABRICATED AVAILABILITY. No invented dates, no invented times, nothing
 * shaped like a real slot. This is a CORRECTNESS requirement, not a style note: a realistic-looking
 * calendar shows a client times that may not exist, and a booking page is screenshotted and
 * forwarded. The frosted grid below is deliberately abstract — evenly-sized blank tiles that read
 * as "a calendar goes here" and cannot be mistaken for an offer of a specific time.
 *
 * WHY IT EXISTS AT ALL: Amy's objection on the 2026-08-26 call was BLINDNESS — a form standing
 * between the visitor and a calendar they cannot see — not being asked for details. A visible frame
 * on the same view removes the blindness while keeping the capture. Deleting this placeholder, or
 * moving it off-screen, turns the design back into the capture-first one she rejected.
 *
 * Height is `min(70dvh, 640px)`: a fixed, honest default (measured steady states cluster
 * 530–800px). `dvh` rather than `vh` because mobile browser chrome makes `vh` wrong exactly when
 * it matters most. It is NOT an attempt to predict the loaded frame's height — that is neither
 * knowable before mount nor stable after (§7).
 */
export function SchedulerPlaceholder({ practitionerName, loading = false }: Props) {
  return (
    <div
      className="relative overflow-hidden rounded-md border bg-muted/20"
      style={{ height: 'min(70dvh, 640px)' }}
      aria-hidden={!loading}
      // Announce only the transition, never the decorative grid.
      aria-live={loading ? 'polite' : undefined}
    >
      {/* Abstract tiles. Intentionally unlabelled — no weekday headers, no numbers, nothing a
          reader could resolve into a date. */}
      <div
        className="grid h-full w-full grid-cols-4 gap-2 p-4 opacity-40 blur-[2px] sm:grid-cols-5"
        aria-hidden
      >
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="rounded bg-muted-foreground/15" />
        ))}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 px-6 text-center backdrop-blur-[1px]">
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
            <p className="text-sm font-medium">
              Loading {practitionerName}&rsquo;s calendar&hellip;
            </p>
          </>
        ) : (
          <>
            <CalendarClock className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Your available times appear here</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Enter your name and email above and {practitionerName}&rsquo;s live calendar opens
              right here — you won&rsquo;t leave this page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
