# Booking + checkout: one flow

**Status**: design ruling — schedule-first, pay-second · CTA hierarchy set by operator 2026-08-12
**Origin**: Sarah Schindler onboarding session 2026-08-11 (`docs/2026-08-11-sarah-onboarding-review.md` §B)
**Operator direction (2026-08-12)**:
- *"user clicks Offering → booking link → enter basic information first (low friction user investment) → checkout/payment as second step"*
- *"Booking links: new field = linked Offering: drop-down list or create-new"*
- *"Offerings = secondary CTAs … Booking Links = primary CTAs"*

## The requirement

Sarah, unprompted and emphatically: **"They need to be able to schedule as soon as they pay. That would be very important."**

Today `BookingLink` and `WhopProduct` (offerings) are independent fields on the profile. A buyer can
pay for a 60-minute session and land nowhere. That is a broken purchase, and it will break on the
first real money that moves through the platform.

## Why schedule-first is the correct sequence

Worth making explicit so it survives future re-litigation:

**1. Lead capture survives abandonment.** The decisive argument. Sarah's cautionary tale was a
directory she paid for and got *zero* clients from. In a payment-first flow, an abandoned checkout
yields **nothing** — no name, no email, no lead. In a schedule-first flow, the practitioner has a
real contact before the payment wall. An abandoned checkout that still delivers a qualified lead is
a *success* for a directory that sells exposure. That property outweighs the unpaid-hold risk.

**2. Commitment ladder.** Payment-first is a wall at step one. Picking a time is a low-cost,
high-salience commitment — the buyer has a concrete appointment in mind and is far likelier to
complete.

**3. It matches the practitioner's funnel.** Sarah: *"nobody books that without having a
consultation."* The scheduler is the front door; payment follows the conversation.

### The risk this accepts, and how it is contained

- The practitioner has the lead **and** the booked time after the scheduling step — a no-pay is a
  follow-up, not a loss.
- Abandoned-payment email at ~1h with a resume link (Resend already wired).
- Gateway offerings should be free-consult or low-ticket anyway (§A13, §D6).
- Escape hatch, not in v1: a per-offering pay-first flip for high-ticket items.

## The hard constraint that shapes everything

**We do not own the scheduler.** It is the practitioner's Calendly / Acuity / Cal.com / SavvyCal.

**Custom redirect-after-booking is a paid-plan feature on Calendly**, and Sarah — the person
recruiting practitioners — specifically recommends **free** Calendly to beginners. So the naive chain
*scheduler → redirect → checkout* breaks for exactly the cohort this product exists to serve. That
rules out the obvious implementation and forces the embed approach below.

---

## CTA hierarchy — the governing principle

**Booking Link = DECIDED buyer. Offering card = UNDECIDED buyer.**

Operator ruling 2026-08-12, and the organizing idea for this whole surface. The same offering appears
in both places on purpose, because the two routes serve buyers in different states, and every design
question below resolves by asking *which buyer is this for*.

| | **Booking link** | **Offering card** |
|---|---|---|
| Buyer state | **Decided** | **Undecided** |
| Role | Primary CTA, top of the profile | Secondary, below |
| Job | Get out of the way | Do the selling |
| Interaction | Click → straight into the flow | Card expands in place → full description → `Book Now` |
| Treatment | Filled primary button (`bg-cta`) | Card, chevron, quiet |

**Precisely: decided to *act*, not decided to *buy*.** That distinction makes the free consultation
fall out correctly rather than looking like an exception — a free consult sits in the decided rail
because the decision it captures is *"I want to talk to this person."* Whether they buy is settled
later, in the conversation, off-platform.

### What the principle dictates

**1. Different content density, same interaction.** Both surfaces expand in place — one pattern, not
two — but they expand to different things:

- **Decided (2+ linked offerings)**: titles and prices only. A **picker**, not a browser. They
  already know; they need to recognize, not read.
- **Undecided**: the full description, what's included. They need convincing.

**2. The first click must match the state.** On an offering card, the first click *expands* — so it
must not be labeled `Book`, which reads as a purchase action to someone still deciding. The card
itself (or a chevron) opens it; `Book Now` appears **inside**, after the description has done its
work. The first click costs nothing and commits to nothing. On a booking link, the first click
*is* the commitment, and the label should say so.

**3. `WhopProduct.description` finally has a job.** It is currently rendered always-open, which is
what makes the offerings block feel heavy — and it is dead weight there, because an always-visible
description sells to nobody in particular. Behind an expand, it is the undecided buyer's entire case.

**4. It tells practitioners what to write.** This is the part Sarah can teach:

> Your **booking link** is for people who already know they want you — referrals, your own audience,
> repeat clients. Your **offerings** are for people browsing the directory who have never heard of
> you. That's why the description matters: it's doing the work you'd do on a call.

### Both routes stay

An earlier draft of this doc proposed deduplicating the offering out of the secondary list. That was
wrong on both counts. Standard commerce runs a hero CTA and a detail block for the same product, and
the transcript evidence cited for it was misread: Sarah's *"this is confusing… there's already
offerings here"* was pointed at the dead **"Browse offerings" / "Request invoice"** placeholder tiles
adjacent to the real list — Jonathan identifies them as placeholders in the very next turn. That is
§A4 (delete the tiles), not a dedup rule.

Her one genuine anti-duplication note was narrower: don't list a **free consultation** as both the
hero CTA and an offering row — *"this would not need to be here at all."* The architecture satisfies
that by construction: a free consultation has no linked offering, so there is nothing to duplicate.

**The real risk of two routes is ambiguity, not clutter** — a buyer wondering whether the link and the
card are the same product or two. Mitigation: when exactly one offering is linked, default the booking
link's `label` from the offering title (editable), so the two read as one thing.

### `entryPoint` measures buyer intent, not just clicks

Because the routes are defined by buyer state, `BookingIntent.entryPoint` is a **proxy for intent at
entry** — which makes it diagnostic rather than decorative:

| Reading | Means | Action |
|---|---|---|
| DECIDED converts far higher | expected and healthy | nothing |
| UNDECIDED converts comparably | descriptions are doing real selling | invest there — and the case-study generator matters more than assumed |
| UNDECIDED high volume, low conversion | descriptions aren't landing | a content problem, coachable — Sarah's job |
| DECIDED low volume | practitioners aren't setting up booking links | an onboarding problem |

Cheap to record now, and it converts any future version of this debate into data instead of opinion.

## The link: many-to-many

**Operator ruling 2026-08-12**: a booking link carries **multiple** linked offerings — *"practitioner
can use same booking link across multiple Offerings."*

This is the right call for the practical reason: most practitioners have **one** scheduler serving
their whole practice. Sarah has a single Acuity link and several offerings. A single-FK model would
force her to create three duplicate `BookingLink` rows with identical URLs, and then keep them in
sync by hand. Many-to-many removes that entirely.

```prisma
model BookingLinkOffering {
  bookingLinkId String
  offeringId    String
  sortOrder     Int         @default(0)  // offering order within this link
  bookingLink   BookingLink @relation(fields: [bookingLinkId], references: [id], onDelete: Cascade)
  offering      WhopProduct @relation(fields: [offeringId], references: [id], onDelete: Cascade)

  @@id([bookingLinkId, offeringId])
}
```

Composite-PK join table, mirroring `PractitionerSpecialty` — same shape the codebase already uses.

(Supersedes both earlier drafts: my `WhopProduct.bookingLinkId`, then the single
`BookingLink.offeringId`. The direction argument that killed the first — one source of truth, no
possibility of disagreement — is preserved here; the join table is still the only place the
relationship is recorded.)

### Resolution rules

- **Offering → scheduler** (secondary path): the offering's linked booking links, lowest
  `BookingLink.sortOrder` wins; none → the practitioner's first booking link; still none → skip the
  scheduling step. Always unambiguous.
- **Booking link → offering** (primary path): depends on how many are linked, and this is the one
  place many-to-many adds a decision. See below.

### What the primary CTA does, by link count

| Linked offerings | Behavior |
|---|---|
| **0** | Free consultation. Click → capture → schedule. No checkout. |
| **1** | Click → straight into the flow. The fast path, unchanged. |
| **2+** | Card **expands in place** to list its offerings as choices → pick → into the flow. |

The 2+ case reuses the offering card's expand-in-place interaction rather than inventing a second
pattern, and it keeps the selection on the profile instead of adding a step inside the flow — so the
"decided buyer, minimum friction" property of the primary route survives. Order within the expansion
is the practitioner's, via `BookingLinkOffering.sortOrder`.

### Editor

A **multi-select of existing offerings, plus create-new inline**. The inline creator must reuse the
`OfferingsEditor` create action rather than duplicating validation, and must surface the unpublished
state — a new offering has no `purchaseUrl` until published to Whop, so its checkout step isn't live.

Label defaulting (from "Both routes stay") now applies **only when exactly one offering is linked** —
with several there is no single title to borrow, so the practitioner names the link themselves
("Book a session").

---

## The flow

One CTA, one continuous flow, on a route we own. "One step" means one *flow*, not one *request* —
we cannot make it one request without owning the calendar.

→ `/practitioners/[slug]/book/[bookingLinkId|offeringId]`

| Step | Screen | Condition | What happens |
|---|---|---|---|
| **1** | **Your details** | **always** | Name, email, optional phone, optional "what brings you here". ~15 seconds. Creates `BookingIntent` (`PENDING`) and **emails the practitioner the lead immediately**. This step is ours — the only point where lead capture is guaranteed. |
| **2** | **Choose your time** | a booking link resolves | The practitioner's scheduler, **inline-embedded and prefilled from step 1** — the buyer retypes nothing. Marks intent `SCHEDULED`. |
| **3** | **Payment** | an offering resolves **and** `paymentMode = WHOP_CHECKOUT` | Whop checkout via `purchaseUrl`, intent id in metadata. |
| **✓** | **Done** | always | Confirmation: time + receipt. |

**Both middle steps are conditional; only capture is unconditional.** That single rule covers every
shape without branching the UI:

| Case | Steps |
|---|---|
| Free consultation (booking link, no offering) | 1 → 2 |
| Paid session with a scheduler | 1 → 2 → 3 |
| Monthly subscription / no scheduling (Sarah's "circle group") | 1 → 3 |
| Sarah — Acuity already collects payment | 1 → 2 |

Adding our own step 1 is a deliberate change to the sketched flow. It costs one screen and buys two
things: the lead is captured before any third party can lose it, and the scheduler arrives prefilled,
so net typing is roughly unchanged.

### Detecting that the scheduling step completed

Redirect is unavailable on free plans, so use embed events with a universal fallback:

- **Calendly** — inline embed emits `calendly.event_scheduled` via postMessage **on all plans,
  including free.** This is the unlock.
- **Cal.com** — embed emits `bookingSuccessful`. **SavvyCal** — embed emits a scheduled event.
- **Acuity / anything else** — no reliable public event. Fallback: `Open scheduler` (new tab) plus
  an `I've booked my time →` button. Weaker, but universal and honest.

Treat the event as an advance signal only. `BookingIntent` is our record; we are not trying to be a
source of truth for the practitioner's calendar.

---

## Ordering — Sarah's second report

> *"I noticed it automatically lists them in a random order… Same with the specialties."*

**Two different root causes, and only one of them is randomness.**

**Offerings are not random — they are inconsistent.** The dashboard orders newest-first and the
public profile orders oldest-first:

- `edit/page.tsx:55` — `whopProducts: { orderBy: { createdAt: 'desc' } }`
- `practitioners/[slug]/page.tsx:21-24` — `whopProducts: { orderBy: { createdAt: 'asc' } }`

So Sarah arranged offerings in the dashboard and saw them **inverted** on her public page. That reads
as random and is arguably worse than random, because it is stable and wrong. Fix the inversion in the
same pass regardless of the sort feature.

**Specialties genuinely are random.** `PractitionerSpecialty` has no ordering column and **neither
query orders them at all** — Postgres returns join rows in unspecified order, which can differ
between requests. Sarah is describing real non-determinism.

### Ruling — drag-and-sort on all three

Per operator: **specialties, offerings, and booking links** all get practitioner-controlled ordering.

| Model | State | Work |
|---|---|---|
| `BookingLink` | `sortOrder` exists, both queries order by it | drag UI only |
| `WhopProduct` | no field; queries disagree | add `sortOrder`, fix the inversion, drag UI |
| `PractitionerSpecialty` | no field, no ordering anywhere | add `sortOrder`, order everywhere, drag UI |

`PractitionerSpecialty` has a composite PK `@@id([practitionerId, specialtyId])` — adding
`sortOrder Int @default(0)` needs no PK change.

**Default ordering satisfies both of Sarah's asks with one clause:**

```
orderBy: [{ sortOrder: 'asc' }, { priceUsdCents: 'asc' }, { createdAt: 'asc' }]
```

A practitioner who never drags anything gets **price low→high** — exactly the fallback she asked for
— and dragging overrides it. No setting, no toggle.

**Implementation**: `@dnd-kit/core` + `@dnd-kit/sortable` (keyboard-accessible, React 19 compatible).
Persist via a bulk server action writing `sortOrder` in one transaction. The offerings editor should
mark which offerings are also linked to a booking link, so the practitioner can see that reordering
the secondary list doesn't move the primary CTA — the two lists sort independently.

---

## Schema changes

All additive — safe under the expand/contract rule (migrations apply during build while the previous
deploy still serves).

```prisma
model BookingLink {
  offerings BookingLinkOffering[]
  // sortOrder already present
}

model WhopProduct {
  sortOrder    Int         @default(0)
  paymentMode  PaymentMode @default(WHOP_CHECKOUT)
  bookingLinks BookingLinkOffering[]
}

// join table — see "The link: many-to-many"
model BookingLinkOffering {
  bookingLinkId String
  offeringId    String
  sortOrder     Int         @default(0)
  bookingLink   BookingLink @relation(fields: [bookingLinkId], references: [id], onDelete: Cascade)
  offering      WhopProduct @relation(fields: [offeringId], references: [id], onDelete: Cascade)

  @@id([bookingLinkId, offeringId])
}

model PractitionerSpecialty {
  sortOrder Int @default(0)
}

enum PaymentMode {
  WHOP_CHECKOUT       // our Whop connected-account checkout
  EXTERNAL_SCHEDULER  // practitioner's scheduler already takes payment
  FREE                // no charge
}

model BookingIntent {
  id             String       @id @default(cuid())
  practitionerId String
  bookingLinkId  String?
  offeringId     String?
  entryPoint     EntryPoint   // which route the buyer took — see "Both routes stay"
  name           String
  email          String
  phone          String?
  note           String?
  status         IntentStatus @default(PENDING)
  scheduledAt    DateTime?
  createdAt      DateTime     @default(now())

  @@index([practitionerId, createdAt])
}

enum IntentStatus { PENDING SCHEDULED PAID ABANDONED }
enum EntryPoint   { BOOKING_LINK OFFERING_CARD }
```

## Code changes

- **`src/lib/whop.ts:293`** — `createOfferingCheckout` already sets
  `redirect_url: ${baseUrl()}/practitioners/${slug}?purchase=success`. Repoint to the flow's done
  screen with the intent id. **The hook exists; one-line change.**
- **New route** `/practitioners/[slug]/book/…` — the flow, with conditional steps.
- **`practitioners/[slug]/page.tsx:146-198`** — booking links promoted to primary; offerings become
  expand-in-place secondary cards routing into the flow. Same pass as deleting the *Coming soon*
  tiles (§A4).
- **Ordering** — add `sortOrder` to both `orderBy` clauses; fix the asc/desc inversion.
- **Editors** — drag-sort on all three lists; linked-offering multi-select + inline create on booking
  links, with drag-sort inside the selection (`BookingLinkOffering.sortOrder`).
- **Whop webhook** — on payment success, mark the intent `PAID`.
- **Abandoned-intent sweep** — `SCHEDULED` and unpaid after ~1h → resume email. ⚠️ Do not copy
  `deleteFromIndex`'s bare-catch pattern; sweep failures must surface.

## Sequencing

1. **Ordering fixes + drag-sort** — independent of everything else, directly answers Sarah's open
   message, ships alone
2. Schema: `BookingIntent`, `BookingLink.offeringId`, `paymentMode` (additive, deployable alone)
3. The flow route with the fallback path only (no embeds) — functional end to end
4. Profile restructure: primary/secondary CTAs, expand-in-place, dedup
5. Calendly + Cal.com embed detection — removes the manual "I've booked" click for most practitioners
6. Abandoned-payment resume email

Step 3 closes Sarah's scheduling requirement. Step 1 is the fastest visible win and needs nothing else.
