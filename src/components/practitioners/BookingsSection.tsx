import { CalendarClock, CircleAlert, Mail, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPrice } from '@/lib/money';

export type BookingRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  status: 'PENDING' | 'SCHEDULED' | 'PAID' | 'ABANDONED';
  scheduleSignal: 'EVENT' | 'SELF_REPORT' | 'ASSUMED' | null;
  scheduledAt: Date | null;
  createdAt: Date;
  offeringTitle: string | null;
  offeringPriceUsdCents: number | null;
  /** §9's three-way AND, resolved by the caller — whether a checkout step existed for this intent. */
  paymentsLive: boolean;
};

/**
 * §10 / §11 — the practitioner's view of people who started booking.
 *
 * THE SCHEDULED-BUT-UNPAID LIST IS ALWAYS PRESENT AND IS NEVER GATED BY A NOTIFICATION
 * PREFERENCE. §11 is explicit: `notifyLeadsImmediately` suppresses EMAILS only. Someone holding a
 * slot on the practitioner's calendar who has not paid is a service obligation with a client
 * waiting — not a marketing notification — and must not be switchable off by a lead-email toggle.
 *
 * Before this existed the state was recorded correctly and surfaced nowhere: a `grep` for
 * `bookingIntent` across the whole dashboard returned nothing. The first real booking the flow
 * took sat unpaid and invisible while the practitioner's only email still said the buyer "may
 * still be choosing a time".
 */
export function BookingsSection({ rows }: { rows: BookingRow[] }) {
  const awaitingPayment = rows.filter(
    (r) => r.status === 'SCHEDULED' && r.paymentsLive && (r.offeringPriceUsdCents ?? 0) > 0,
  );
  // Everything scheduled that had no checkout to begin with — free consults and off-platform
  // sales. Booked and DONE, not owing anything, so it must not sit under "awaiting payment".
  const booked = rows.filter((r) => r.status === 'SCHEDULED' && !awaitingPayment.includes(r));
  const leads = rows.filter((r) => r.status === 'PENDING' || r.status === 'ABANDONED');

  if (rows.length === 0) {
    return (
      <Card className="space-y-1 p-6">
        <h2 className="text-sm font-semibold">Bookings</h2>
        <p className="text-xs text-muted-foreground">
          Nobody has started booking with you yet. When they do, their details appear here — even
          if they don&apos;t finish.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Bookings</h2>
        <p className="text-xs text-muted-foreground">
          Everyone who started booking with you, whether or not they finished.
        </p>
      </div>

      {awaitingPayment.length > 0 && (
        <Group
          title="Booked — payment outstanding"
          tone="warn"
          hint="They picked a time but haven't paid. You have their details; a nudge usually does it."
          rows={awaitingPayment}
        />
      )}
      {booked.length > 0 && <Group title="Booked" rows={booked} />}
      {leads.length > 0 && (
        <Group
          title="Enquiries — no time picked"
          hint="They left their details but didn't get as far as your calendar."
          rows={leads}
        />
      )}
    </Card>
  );
}

function Group({
  title,
  rows,
  hint,
  tone,
}: {
  title: string;
  rows: BookingRow[];
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          {tone === 'warn' && <CircleAlert className="h-3.5 w-3.5 text-primary" aria-hidden />}
          {title}
          <span className="font-normal text-muted-foreground">({rows.length})</span>
        </h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`rounded-md border p-3 text-xs ${tone === 'warn' ? 'border-primary/30 bg-primary/5' : 'bg-muted/20'}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{r.name}</span>
              <span className="text-muted-foreground">
                {r.offeringTitle ?? 'No offering selected'}
                {r.offeringPriceUsdCents != null && r.offeringPriceUsdCents > 0 && (
                  <> · {formatPrice(r.offeringPriceUsdCents)}</>
                )}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-foreground">
                <Mail className="h-3 w-3" aria-hidden />
                {r.email}
              </a>
              {r.phone && (
                <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone className="h-3 w-3" aria-hidden />
                  {r.phone}
                </a>
              )}
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" aria-hidden />
                {formatWhen(r.scheduledAt ?? r.createdAt)}
              </span>
              <SignalBadge signal={r.scheduleSignal} />
            </div>

            {r.note && <p className="mt-1.5 text-muted-foreground">“{r.note}”</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * §8 — "an unverified booking is visibly unverified".
 *
 * ASSUMED means the buyer advanced past the calendar with neither a provider event nor a
 * self-report click, so we genuinely do not know whether a time was picked. Rendering it the same
 * as a confirmed booking would make the dashboard assert something about the practitioner's own
 * calendar that we have no standing to assert.
 */
function SignalBadge({ signal }: { signal: BookingRow['scheduleSignal'] }) {
  if (!signal) return null;
  if (signal === 'EVENT') return <Badge variant="secondary">Confirmed by calendar</Badge>;
  if (signal === 'SELF_REPORT') return <Badge variant="secondary">They said they booked</Badge>;
  return <Badge variant="outline">Unconfirmed — check your calendar</Badge>;
}

function formatWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
