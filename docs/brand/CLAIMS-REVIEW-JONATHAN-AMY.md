# ⚠️ ESCALATION — four public claims need a Jonathan + Amy decision

**Raised:** 2026-08-10 · **Owners:** Jonathan Gatlin (build) + Amy Sprouse (HHE) · **Status:** OPEN
**Surface:** `naturalhealthpros.com` homepage — live now, in the client's original wording.

---

## What this is

Four claims on the live landing page have **no supporting data in the production database**. They
were briefly held, then **restored as written** on the operator's decision: this is the client's own
copy, and the claim belongs to the client, not to the build.

They are shipped **flagged, not fixed**. This document is the decision record. Nothing here is an
engineering blocker — every item is a business call about what Natural Health Pros is willing to
assert publicly.

**Why it matters:** this is a health-adjacent directory whose entire value proposition is
verification and trust. A claim that cannot be substantiated is a bigger liability here than it
would be on an ordinary marketing site, and the credential claim is the one the whole product rests on.

---

## The four claims

Every figure below was measured directly against the production database on 2026-08-10.

### 1. "Sessions from $29 – $219+"

| | |
|---|---|
| **Where** | Hero, directly under the search bar |
| **Data** | `firstSessionPriceCents` set on **0 of 13** listed practitioners. **0** `Offering` rows exist in the entire database. **0** have a `purchaseUrl`. |
| **Risk** | A specific dollar range with nothing behind it. Nothing on the site is currently priced or purchasable, so a visitor cannot verify or act on it. |
| **Makes it true** | A representative set of practitioners publish priced offerings. |
| **Best fix** | Render the band from real data (`min`–`max` across published prices) instead of hardcoding it. It then becomes true by construction and can never drift. |

### 2. "Training and credential-verified"  ← *the serious one*

| | |
|---|---|
| **Where** | Hero trust row, first item |
| **Data** | `hheCertified` is `true` for 13 of 13 — but it is `@default(true)` in `prisma/schema.prisma` and **no code path ever sets it**. Nothing has verified anything. |
| **Risk** | This is the product's core value proposition. It asserts a verification step that has never been performed for any practitioner. Of the four, this is the most expensive to be wrong about — it is the reason a consumer would trust the directory over a search engine. |
| **Makes it true** | A real verification step writes `hheCertified` — even a manual admin action with an audit trail. **Needs a product change, not just data.** |
| **Defensible today** | "Practitioners listed with Natural Health Pros have received formal training in their specialty" — the client's own footer sentence. True by construction, since the directory is invite-only from HHE programs. |

### 3. "Easy scheduling"

| | |
|---|---|
| **Where** | Hero trust row, third item |
| **Data** | **1 of 13** listed practitioners has a booking link (`emily-teale`). |
| **Risk** | The trust row reads as a guarantee. 12 of 13 profiles cannot currently be booked. |
| **Makes it true** | A majority of listed practitioners add a booking link. The field and UI already exist — this is an onboarding push, not a build. |

### 4. "(virtually or in your area)"

| | |
|---|---|
| **Where** | "What the directory is" — first bullet |
| **Data** | **13 of 13** are "Virtual Practice, Online". 14 `City` rows exist; only 2 have any practitioner attached. |
| **Risk** | "In your area" implies local inventory that does not exist. |
| **Makes it true** | At least one listed practitioner has a real, non-virtual city. |
| **Mitigation live now** | The hero renders *"Every practitioner listed today works virtually, so location is not a limit yet"* while the only city is Virtual Practice, and swaps to generic guidance once real cities exist. Data-driven, so it self-corrects. |

---

## Decision needed, per claim

For each of the four, choose one:

- **KEEP AS IS** — accept the claim as an aspirational brand statement. *(current state)*
- **KEEP + FIX THE DATA** — commit to an owner and a date for the acceptance test above.
- **REWORD** — adopt the defensible alternative (each is drawn from the client's own document).
- **REMOVE** — drop until the data supports it.

**Recommendation from the build side:** claims 1, 3 and 4 are reasonable to keep short-term — each
becomes true through ordinary onboarding progress, and 4 already self-corrects. **Claim 2 is
different in kind.** "Verified" describes a process, not an aspiration, and no process exists. The
lowest-cost honest path is the client's own footer wording — *"formal training in their specialty"* —
which says something true and nearly as strong, until a real verification step ships.

---

## Related

- Client's original copy + full claim-verification table: `docs/brand/2026-08-10-client-landing-copy.md`
- Inline `UNSUBSTANTIATED` markers and re-enable conditions: `src/content/copy.ts`
- Brand/design source of truth: `docs/brand/STYLE-GUIDE-SOURCE.md`
