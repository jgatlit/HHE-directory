# Handoff — booking/checkout: spec reconciled, task set authored, first code shipped

**Written**: 2026-08-13, closing the session that reviewed the canonical spec and shipped `fix/booking-link-stable-identity`.
**Supersedes**: `docs/NEXT-SESSION-PRIME-BOOKING-CHECKOUT.md` (that session's job — review + reconcile — is **done**).
**Canonical design**: vault `art_c688ea69482744d19c89` — *Practitioner Directory — Booking & Checkout: Canonical Design Spec (v2)*. **Single source of truth.**
**Approved delta**: vault `art_0a86dcbf2efd4ea7a3c8` — six changes against `docs/2026-08-12-booking-checkout-flow.md`.
**Tasks**: nobox-vault project `prj_63362baf8f58464c904e` (~24 open, most authored this session).

---

## ⛔ Read this before writing any schema

**Two operator decisions gate `§17.2b` (the schema migration).** Both are cheap to settle now and destructive to settle later, because `Offering.bookingLinkId` with `onDelete: Cascade` is what converts two currently-cosmetic deletions into **silent unlinking of live offerings**.

| Task | Decision |
|---|---|
| `tsk_269ddd1e903f4b63a59d` | May a practitioner keep two Booking Links pointing at one scheduler? Operator has proposed **yes — a Booking Link is a unique instance, not a unique URL**; assessed and recommended, not yet ratified. |
| `tsk_b7e1b792428d468ba755` | Profile form is last-write-wins; a concurrent save discards the other editor's rows. Mechanism verified, **no evidence it has occurred**, and no audit trail by which it could be checked. |

Neither blocks *writing* the migration. Both should be resolved before it is *applied*.

---

## Settled this session — do not re-litigate

- **Schedule-before-checkout (D4) stands.** The pay-first corrective was withdrawn; it was Claude's own recommendation misfiled as a ruling.
- **`§17` item 3 ordering is deliberate**: build the **null-adapter / T2 path first and treat it as the real path**. Dependency analysis will argue for T1 auto-advance first. Do not reorder. Corroborated by production: 1 of 16 practitioners has payouts enabled, only 3 Booking Links exist, and Sarah — the reference practitioner — is on Acuity, which has no completion event.
- **No `whop_status` column.** `payments_live` gates on the existing `whopPayoutsEnabled`. Whop's `payout_status` has **nine** states and its own docs call `payouts_enabled` the single source of truth; a 3-state enum would be the third generation of the mistake `whopKycStatus` already made.
- **No `status` column on Offering.** `active` + `archived` already exist; a third representation invites gating on the enum instead of on whether a plan id exists.
- **A Booking Link with ZERO linked Offerings still renders its CTA and is schedulable.** Consistently in scope. `BookingIntent.offering_id` is nullable with `entry_point: BOOKING_LINK` for exactly this. D2 forbids the system *inferring* "free consultation" from zero Offerings — it does not forbid the capability.
- **Whop checkout carries a per-booking session** (option (a)), so `payment.succeeded` reconciles to a `BookingIntent` server-side rather than trusting a client callback.
- **Typesense work is deferred** (`tsk_b35219ac034f42a68051`).

---

## Shipped — branch `fix/booking-link-stable-identity`, pushed, **PR NOT OPENED**

5 commits, 5 ahead / 0 behind `main`. `tsc` + `lint` + **69 tests** + `next build` all clean.

| Commit | What |
|---|---|
| `35957ac` | Booking links reconciled **in place** — `BookingLink.id` is now durable. No migration needed; the id was always a stable cuid PK, the save path just threw it away. |
| `c567ede` | `src/lib/email.ts` — shared Resend sender with a **mandatory** `idempotencyKey`; trial-sweep migrated onto it. |
| `0df53ee` | Review round 1 — three defects. |
| `7e8427c` | Remount-key trade-off documented. |
| `80f5daf` | Review round 2 — a false test of ours, a ratifying test, row cap, Sentry routing. |

**Opening the PR is the first action for whoever picks this up**, unless the operator has already done it.

---

## Two traps this session found the hard way

Both passed `tsc`, `lint`, the full suite, a green build, **and** a live-database harness. Both were caught by code review.

1. **A same-route `redirect()` keeps the subtree MOUNTED**, so a lazy `useState` initializer silently discards server-recomputed props. A row created in the current page session never received its database id, and churned on every later save. This repo has now been bitten **twice** — `UnsavedChangesBar` documents the same fact from a previously shipped bug. Fix here: `key={practitioner.bookingLinks.map(b => b.id).join(',')}`.
   *Generalised lesson*: a harness that exercises **one** server-action call structurally cannot see a bug that lives in browser state **across two**.
2. **A test stub more capable than production manufactures confidence.** Our `normalize` stub canonicalised host and trailing slash; production `normalizeBookingUrl` canonicalises **nothing** (it lowercases/strips `www.` only on a throwaway local used for the allowlist check, then returns `url.toString()`). A test asserted a dedupe that **ships nowhere**. Mutation testing cannot catch this — mutation and assertion share the false stub.

---

## Live traps in existing code — check before building on them

- ⚠️ **`WhopProduct.active` and `archived` are DEAD** — read in queries, **never written** anywhere in `src/` or `scripts/`, not exposed in any UI. `active` looks like the hidden/visible toggle and **is not**: it filters inside the profile query, so setting it false removes the Offering from the Booking Link **chooser** as well as the grid. `§4` requires the chooser to list Offerings *regardless* of `listingVisibility`. Use two layers — `listingVisibility` gates the grid, `bookingLinkId` gates the chooser. Anyone who sets `active` in a script silently deletes Offerings from every public surface with no UI explaining why.
- ⚠️ **`prisma migrate dev` is broken here**; author via `migrate diff` → hand-edit → `migrate deploy`, and **strip the spurious `DROP INDEX "Practitioner_searchText_trgm_idx"`** that `diff` emits on every run — applying it kills typo-tolerant search.
- ⚠️ **Never run `npm run build` locally** — it runs `migrate deploy` against **PROD**. Use `npx next build`.
- ⚠️ `as.me` is **not** in `BOOKING_HOSTS`, so Acuity short links are rejected on save today (`§17.5a`).

---

## Build order

1. Settle the two gating decisions ↑
2. `§17.2b` schema → `§17.2c` admin editors
3. `§17.3a` capture route → **`§17.3b` null-adapter + T2 (do not reorder)**
4. `§17.4a/b` profile CTAs + expand-in-place chooser
5. `§17.5a/b` provider adapters + vertical adaptivity
6. Four `§16` validations → `§17.6` T1 auto-advance
7. `§17.7` abandonment · `§17.8` notification settings

Whop items (`§17.3c`, `§9` deferred publish, `§16` Whop) are marked **future session, relay only** and sequenced behind the Booking/Offering work.

---

## Process notes for the next session

- **`§17.3a` must not merge unreviewed** — it adds a public unauthenticated route taking user-supplied ids in a write. That is squarely the diff shape that previously returned 12 real defects post-merge.
- **Prefer `/code-review` over spawned subagents for anything gating a merge.** This session ran two: one delivered excellent work across three rounds, the other went idle three times and never returned findings.
- The email helper is ready for its callers: `booking-resume/<bookingIntentId>` (`§17.7`) and `payments-live/<practitionerId>` (`§9`).

---

## Unrelated, still open, still blocking onboarding

🚨 **12 pilot invitations expired 2026-06-28 — every pilot is locked out.** Fix is `resendInvitation`, but **re-validate the addresses first**: a corrected email creates a duplicate practitioner row, which already happened to Sarah. Sends real email to real practitioners — needs explicit operator go. Vault `tsk_7bff0304bb2a452fa9dd`.
