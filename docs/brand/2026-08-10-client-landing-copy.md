# Client-provided landing copy + content principles

> **Provenance:** supplied verbatim by the client (Holistic Health Network, LLC / HHE) 2026-08-10,
> via the operator. This is **grounding/reference material** for the landing-page GTM rebuild —
> treat the wording below as client-authored copy, not as a draft to freely rewrite. Legal,
> disclaimer, and scope-of-service language in particular is **use-as-written**.
>
> Consumers: the frontier-UX landing build, and any practitioner-acquisition surface.

## Hero

**Title:** Natural Health Professional Directory

**Subhead:** Affordable, life-changing holistic health services at your fingertips

**Body:**

> Access Certified Holistic Health Coaches, Holistic Health Practitioners, Therapeutic Nutritional
> Counselors, National Board Certified Health & Wellness Coaches, Emotion Code Practitioners, FLY
> Facilitators, Gut Health Specialists, Live Blood Microscopy Specialists, and more.

**Pricing band:** Sessions from $29 – $219+

**Trust row (4 checkmarks):**
- ✅ Training and credential-verified
- ✅ Affordable pricing
- ✅ Easy scheduling
- ✅ Searchable directory

**Positioning line (voice-defining — keep the edge):**

> No need to find your alternatives to mainstream medicine through TikTok, ChatGPT, or your
> grandma's old medicine cabinet.

**Primary CTA:** Book a session with a trained professional in the health and wellness field.

**Wordmark:** Natural Health Pros

## "What the directory is, and what it is not"

**Natural Health Pros is:**
- A searchable directory that helps you find trained holistic health professionals (virtually or in your area).
- A place to book sessions directly with independent practitioners.
- A way to see a variety of practitioners' training, specialty, and pricing before you book.

**Natural Health Pros is not:**
- A doctor's office, medical clinic, or medical provider, or a replacement for your doctor or for medical care.
- The employer of the practitioners — each one works independently and is responsible for their own services.
- A guarantee of any specific health result.

## Social-proof motif

♥ Supported Professionals ♥ Happy Consumers

## Footer — corporate identity (bottom of page)

> Natural Health Pros is the professional online directory for Holistic Health Network, LLC, which
> works in tandem with Holistic Health Educators, PMA, to elevate the standard of education and care
> among holistic health professionals, and to ensure greater access to these life-changing services
> for consumers.
>
> Practitioners listed with Natural Health Pros have received formal training in their specialty.
> Each practitioner is an independent provider.

## Disclaimer — USE AS WRITTEN, do not paraphrase

> **DISCLAIMER:** This is not a replacement for medical care. The practitioners listed in this
> directory provide holistic and complementary services that are not intended to diagnose, treat,
> cure, or prevent any disease. Always consult your physician or a qualified healthcare provider
> before making changes to your health, and never disregard or delay professional medical advice
> because of something you accessed through this site. If you are experiencing a medical emergency,
> call 911.

## ⚠️ CLAIM VERIFICATION — measured against production 2026-08-10

Every factual claim in the copy above was checked against the live database. **Four of them have no
supporting data.** These are public assertions on a health directory; treat shipping them as a
client decision (Amy / Holistic Health Network), not an engineering one.

| Claim | Measured reality | Verdict |
|---|---|---|
| "Sessions from **$29 – $219+**" | `firstSessionPriceCents` set on **0 of 13** listed practitioners. **0** Offering rows exist in total. **0** have a `purchaseUrl`. | ❌ **no backing whatsoever** |
| "**Training and credential-verified**" | `hheCertified` is `true` for 13/13 — but it is `@default(true)` in `prisma/schema.prisma:120` and is never independently set by any code path. | ❌ **asserts a verification that has never occurred** |
| "Easy scheduling" / "book directly" | **1 of 13** has any booking link (`emily-teale`). | ❌ overstated ~13× |
| "find… virtually **or in your area**" | **13 of 13** are "Virtual Practice, Online". 14 `City` rows exist; only 2 have any practitioner attached. | ❌ **there is no in-area inventory** |
| Eight named credential types | Only 2 map cleanly to real specialty records (Holistic Health Coaching ×13, Gut Health ×1). "Therapeutic Nutritional Counselors" is split across an ACTIVE and a PROPOSED node and needs a merge. **5 have no record at all.** | ⚠️ hero promises filters the directory cannot deliver |

**Recommendation:** hold the pricing band and the credential-verified badge until each has data behind
it. "Affordable pricing" and "Searchable directory" stand on their own without either. The
credential badge is the structurally serious one — it *is* the product's value proposition, so an
unbacked version of it is the most expensive claim on the page to get wrong.

Both are built behind a `data-unsubstantiated-claim` flag in the frontier sandbox, so removal is a
single toggle rather than a copy rewrite.

## ✅ APPROVED COPY RESOLUTIONS — operator decision 2026-08-10

**Decision:** hold all four unbacked claims. **Messaging that speaks to future state is approved.**
The hero credential list ships as written (all 8), because it reads as HHE's program range rather
than as a filter guarantee.

Each replacement is drawn from the **client's own document** wherever one exists, so the page keeps
the client's voice and intent and drops only the assertions production cannot currently support.

| Held claim | Ships instead | Where the replacement comes from |
|---|---|---|
| Hero: "Sessions from **$29 – $219+**" | *removed — no numeric substitute* | The trust row already carries the client's "Affordable pricing", which is positioning rather than a numeric assertion, so it stays and the intent survives. |
| Trust row: "Training and credential-**verified**" | **"Formal training in their specialty"** | Verbatim from the client's own footer paragraph. Defensible today — the directory is invite-only from HHE programs — whereas "verified" asserts a verification step that has never run. |
| Trust row: "Easy scheduling" | **"Virtual sessions"** | True for 13/13, and uses the client's own "virtually" framing. |
| "(virtually **or in your area**)" | **"— virtually today, with in-person practitioners joining as the directory grows"** | Future-state, per the approval above. Preserves the client's evident intent: 14 `City` rows already exist awaiting in-person practitioners. |

**Use-as-written, unchanged:** the disclaimer, both "is / is not" blocks, the footer corporate-identity
paragraph, the hero credential list, and the positioning line.

### Re-enable conditions

Each held claim ships the moment its data exists — these are the acceptance tests, not opinions:

- **Pricing band** → a representative set of listed practitioners have published, priced offerings
  (today: 0 of 13; 0 `Offering` rows exist at all).
- **"credential-verified"** → `hheCertified` is set by a real verification step instead of
  `@default(true)`. This one needs a product change, not just data.
- **"Easy scheduling"** → a majority of listed practitioners have a booking link (today: 1 of 13).
- **"in your area"** → at least one listed practitioner has a non-virtual city (today: 0 of 13).

## Implementation notes (derived, not client-authored)

These were the pre-verification inferences. Items 2–4 are now **confirmed** by the table above:

1. **Two new legal entities appear here** that the codebase has never named: *Holistic Health
   Network, LLC* (owns the directory) and *Holistic Health Educators, **PMA*** (the school).
   Existing copy says only "Holistic Health Educators". The footer must carry both.
2. **The pricing band ($29–$219+) is a public claim** and should be reconciled against real
   offering prices before it ships — it becomes a factual assertion on the homepage.
3. **The credential list is a taxonomy contract.** Eight named credential types appear in the hero.
   These should map to real specialty records, or the hero promises filters the directory can't
   deliver. Cross-check against the live specialty taxonomy.
4. **"Easy scheduling" and "book directly"** imply the booking-link surface is populated for
   listed practitioners; verify coverage before leading with it.
5. The positioning line is deliberately irreverent and is the strongest voice signal in the set —
   preserve its tone in any supporting copy written to match.

## Appendix — the hero credential list against the live taxonomy

The hero names eight credential types. Each is a promise that the directory can surface that kind
of practitioner. This table reconciles the promise against the live specialty taxonomy; it lived as
a typed `credentialMap` in the frontier sandbox's `copy.ts` but had no consumer, so it was moved
here rather than shipped as dead code.

`specialty slug: —` means the copy names a credential the taxonomy cannot express. Those are
deliberately NOT rendered as filter chips — a chip that returns nothing is worse than no chip. They
remain in the client's prose, which ends in "and more" and therefore promises breadth, not a filter.

| Credential in the hero | Specialty slug | Status | Note |
|---|---|---|---|
| Certified Holistic Health Coaches | `holistic-health-coaching` | mapped | |
| Holistic Health Practitioners | — | unmapped | No specialty record. Reads as the umbrella term, not a filterable credential. |
| Therapeutic Nutritional Counselors | `therapeutic-nutrition` | partial | Taxonomy splits this: "Therapeutic Nutrition" is ACTIVE, "Therapeutic Nutritional Counseling" exists but is PROPOSED. Needs a merge. |
| National Board Certified Health & Wellness Coaches | — | unmapped | NBHWC is a credential, not a specialty. Needs a credential field, not a taxonomy row. |
| Emotion Code Practitioners | — | unmapped | No record. Closest live node is Energy Medicine. |
| FLY Facilitators | — | unmapped | No record and no obvious parent. |
| Gut Health Specialists | `gut-health` | mapped | |
| Live Blood Microscopy Specialists | — | unmapped | No record. Closest live node is Functional Medicine. |
