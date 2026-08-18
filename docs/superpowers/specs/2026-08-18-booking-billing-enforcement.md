# Booking-flow billing enforcement — spec & scope (DEFERRED, not built)

**Status: DEFERRED by operator decision, 2026-08-18. Continue unenforced.**
This document exists so that when enforcement is wanted, the decision is a config change and a
small diff rather than a fresh investigation. Nothing here is implemented.

## The gap, stated precisely

`bookableWhere()` (`src/lib/practitioner-indexer.ts`) gates who may be booked on exactly two
things: the row is not retired (the epoch `trialEndsAt` sentinel), and — since 2026-08-18 — not
archived. **It does not test billing standing at all.** A practitioner whose 90-day trial lapsed,
who has never subscribed, keeps a fully working checkout: capture → schedule → Whop payment.

This is deliberate and currently correct. It follows the operator rule that unlisted profiles stay
bookable (PR #70): losing directory *placement* is the paywall, losing the ability to serve a
client who already has your link is not.

## Why it is inert today, and what makes it live

Every live `trialEndsAt` is `null` — pre-trial — so no practitioner is in the lapsed state at all.
Verified 2026-08-18: 16 practitioners, 14 listed, 15 bookable, 0 lapsed.

`null` is not an accident. `/onboarding` only sets `trialEndsAt` when `PILOT_TRIAL_CLOCK_ENABLED === 'true'`,
and **that variable is not set in any Vercel scope**. The clocks are off. The gap becomes real the
moment either of these happens:

1. `PILOT_TRIAL_CLOCK_ENABLED=true` is set — new practitioners start a 90-day clock at onboarding.
2. `scripts/backfill-trial-dates.ts` is run — existing `trialEndsAt: null` practitioners get one.

90 days after either, the first practitioner lapses and the question below stops being theoretical.

## The question that must be answered first

> **May a practitioner who stopped paying for their listing still take payments through their own
> direct booking link?**

This is a **commercial** decision, not a technical one, and it should be Amy's and Jonathan's. The
two coherent answers produce different products:

| Answer | Meaning | What we are selling |
|---|---|---|
| **Yes — discovery only** | The subscription buys directory *placement*. A lapsed practitioner keeps her link, keeps booking, just is not findable. | A lead-generation channel. |
| **No — booking too** | The subscription buys the *transaction rail*. Lapsed means the Book button stops. | Practice infrastructure. |

There is a third, softer answer worth naming because it is probably the right one commercially:
**yes, but we take a higher cut.** Lapsed practitioners keep booking at a larger platform fee. It
converts churn into revenue instead of into silence, and it needs no new gate — only a fee lookup
at checkout-configuration time.

Do not pick one in code. Pick one in a meeting, then implement the row.

## Scope IF "No — booking too" is chosen

Smallest correct change. Roughly a half-day including tests.

**1. Extend `bookableWhere()`** — one clause, mirroring how `listedWhere()` already expresses
billing standing:

```ts
// in bookableWhere(), ANDed with the existing retirement/archive vetoes
AND: [{
  OR: [
    { subscriptionStatus: 'ACTIVE' },
    { subscriptionStatus: 'PAST_DUE' },   // Whop dunning grace — same window discovery grants
    { trialEndsAt: null },                 // pre-trial
    { trialEndsAt: { gt: new Date() } },   // trial running
    { user: { role: 'ADMIN' } },           // staff, not customers
  ],
}]
```

⚠️ `new Date()` must be evaluated **inside the function**, never at module scope — Fluid Compute
reuses instances, so a module-level constant freezes the cutoff at boot. `listedWhere()` carries
this warning already; it applies identically here.

**2. Decide the runtime shape of the block.** `bookableWhere()` is consumed in three places
(`book/actions.ts`, `book/[token]/actions.ts`, `api/cron/booking-sweep`). A `where` clause that
matches nothing produces a **404 with an HTTP 200 body** — `notFound()` renders the 404 page at
status 200 in this app — which is the wrong experience for a client who followed a link the
practitioner gave them personally. Requires a real "this practitioner is not currently accepting
bookings" page, not an empty match.

**3. In-flight intents.** A `PENDING` or `SCHEDULED` intent created *before* lapse must still be
completable — the client has already given their time, and in the `SCHEDULED` case the
practitioner has a calendar hold. Gate only intent *creation*, not advancement. `booking-sweep`
already filters on `practitioner: bookableWhere()`; adding billing there would silently strand
recovery emails for those exact clients. **This is the subtle half of the change** and the reason
it is not a one-line diff.

**4. Practitioner warning.** `trial-sweep`'s emails currently promise "your profile stays live at
its direct link". If booking stops, that copy becomes false and must change in the same release —
the same class of defect PR #70 removed.

**5. Tests.** Extend `tests/listing-gate.test.ts`'s `bookableWhere` block: lapsed-and-unsubscribed
is not bookable; ACTIVE, PAST_DUE, pre-trial, trial-running and ADMIN all are; and an in-flight
SCHEDULED intent still advances. Mutation-test the in-flight case specifically — it is the one a
naive implementation breaks.

## Scope IF "Yes, but higher cut" is chosen

No gate at all. At checkout-configuration mint time (`whop-checkout-config`), select the platform
fee from billing standing instead of a constant. Cheaper than the above and touches no gate — but
needs a fee schedule decided first, and the practitioner must be told, which is a copy change in
`SubscriptionSection` and in the trial-sweep emails.

## What NOT to do

- **Do not fold billing into `listedWhere()` and reuse it for booking.** They are separate
  predicates on purpose; PR #70 exists because they were conflated once. `listedWhere()` also
  tests profile COMPLETENESS, which would block a practitioner mid-onboarding from taking a lead
  through her own link.
- **Do not enforce via Typesense absence.** Booking must work for unlisted practitioners; the
  index is a discovery artifact and is not authoritative for anything transactional.
- **Do not ship this in the same release that starts the trial clocks.** Start the clocks, watch
  a cohort actually lapse, then decide. Enforcement written against zero real lapsed rows is
  written against an imagined product.

## Related

- `src/lib/practitioner-indexer.ts` — `bookableWhere()`, `listedWhere()`, `isListed()`
- `docs/superpowers/specs/2026-07-16-pilot-trial-design.md` — the trial clock (note its price is
  superseded; $49/mo is canonical)
- `scripts/backfill-trial-dates.ts` — the go-live lever
- PR #70 — why unlisted ≠ unbookable
