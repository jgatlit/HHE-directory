# Terms & Conditions click-to-acknowledge — sourcing, confidence, and the launch decision

**Date:** 2026-08-25 · **Shipped:** PR #89 (`feat/terms-acknowledgment-onboarding`), merged to `main` at `67b8841`, verified live on `naturalhealthpros.com`.
**Status:** Live in production, **pending Amy's review**. Not legally reviewed. This is the durable record of what shipped and why; the underlying draft rationale lives alongside it in `_handoff-context/tc-draft.md`.

## What shipped

`TermsAcknowledgment.tsx` renders the actual T&C draft text in full, inline, at `/onboarding` — not a link to a document reviewed blind. A practitioner must check a required checkbox before submitting onboarding; `User.termsAcceptedAt` is stamped once, server-side, gated on `target.isOwner` (not merely "authorized") so a signed-in admin editing someone else's profile can never trip or satisfy someone else's consent. A practitioner who already has `termsAcceptedAt` sees a plain confirmation line instead of the checkbox on any later visit to `/onboarding`.

The 12 pre-2026-08-25 pilots keep `termsAcceptedAt` **null permanently** — there is no backfill, and none is planned. This was a deliberate choice: retroactively marking existing practitioners as having agreed to text they never saw would be worse than leaving the field honestly null.

## Sourcing — this is a working draft, not boilerplate and not legal advice

The draft (vault artifact `art_4c702b7a1d2848ddbf33`) was built from three source classes, in order of authority:

1. **Whop's own Seller Terms and Buyer Terms** (`whop.com/seller-terms/`, `whop.com/tos/`) — the highest-trust source, because Natural Health Pros's practitioners are Whop Sellers through the connected-accounts model. Whop is explicit that it is merchant of record for *payment settlement only*; the practitioner is "the supplier... for all other purposes, including consumer protection and content licensing." Section 3 (practitioners are independent) and Section 4 (payments) mirror this allocation deliberately — weakening either without checking Whop's terms first would create a direct contradiction between the two documents a practitioner is bound by.
2. **Generic SaaS/marketplace ToS structure** (TermsFeed's SaaS template; the PandaDoc/Promise Legal/Sprintlaw marketplace-clause checklist) — used for boilerplate shape (eligibility, content license-back, liability limitation, change-notice practice), not copied verbatim from any single vendor.
3. **TermsFeed's wellness-practitioner disclaimer guidance** — the closest published pattern for Section 2's "not a substitute for professional medical advice" language, which is near-universal across wellness-service sites and not proprietary to any one platform.

This satisfies what Jonathan committed to on the 2026-08-18 call ("I'll do a little bit of research... find something relevant, run it by you and Amy") — a real, sourced starting point for Amy and Sarah to react to, not lorem-ipsum and not a blank page.

## What is explicitly NOT resolved — four open brackets, left in the shipped text on purpose

The rendered draft keeps its `[bracketed]` gaps **visible to the practitioner**, with a line under the checkbox saying so plainly. Resolving these silently would misrepresent what someone is actually agreeing to:

1. **§4 Payments — chargeback liability.** Whop's own default is that the seller (practitioner) absorbs chargeback fees. Does Natural Health Pros absorb any of that instead? Not decided.
2. **§5 Your profile and content — license-back scope.** Standard marketplace license-back clause (non-exclusive, display + moderate + promote) is drafted, but Amy hasn't confirmed the scope is what she wants.
3. **§8 No warranty; limitation of liability — liability cap figure and governing law.** No figure or state has been chosen. This is the one section where a wrong default (rather than a visible gap) would be actively worse than blank.
4. **§11 Governing law and disputes — entirely blank.** State of incorporation, and whether to mirror Whop's binding arbitration clause. Needs Amy, Jonathan, and likely actual counsel — this is the one gap the source doc explicitly flags as *not* something to default-guess on.

Also open: whether Section 6 (confidentiality) is what Sarah meant when she raised wanting something NDA-like on the 2026-08-11 call — Jonathan resolved on the 2026-08-18 call that one T&C document covers both needs rather than a separate NDA process, but Sarah hasn't specifically confirmed this section satisfies her original ask.

## Confidence assessment

**High confidence** that:
- The document does not contradict Whop's own seller/buyer terms, which is the one internal-consistency requirement that would otherwise create a real legal exposure (practitioner bound by two documents that disagree about who owns chargeback/consumer-protection liability).
- The medical-disclaimer language (§2) is standard, near-universal, and low-risk boilerplate for a wellness-adjacent directory.
- The mechanism (required checkbox, one-time stamp, owner-gated, no retroactive backfill) is sound regardless of what the final text says — the engineering here is separable from the legal content and doesn't need to be revisited when the text changes.

**Low confidence / explicitly not claimed:**
- That the current text is what a lawyer would ship. It is not. Nothing in this draft should be read as legal advice or as having received legal review — the source doc says so directly, and that framing is preserved verbatim in this record.
- That §8 and §11 in particular are safe to leave as-is for real practitioners signing up after this note. A liability cap and governing-law clause left blank or generic is the highest-consequence gap here, specifically because it's the section most likely to matter if something ever goes wrong with a real client.

**Recommendation given at the time, and the decision made:** ship the mechanism and the sourced draft now (rather than blocking the whole item on legal sign-off), because leaving zero terms in place for new practitioners is worse than shipping a visibly-incomplete, clearly-labeled draft — and because the visible brackets make the incompleteness legible to anyone who reads the page, including Amy. The operator's explicit instruction was **"Merge #89 now, pending Amy's review"** — the decision to publish ahead of legal sign-off, accepting the residual risk on §8/§11 until that review happens, was the operator's, made with the gaps stated plainly above.

## Outstanding follow-up

- Amy's review of the four open brackets (§4, §5, §8, §11), and Sarah's confirmation on §6, are still needed. Nothing currently tracks this as a ticket — worth opening one if it doesn't happen soon, since an unreviewed liability clause is the kind of thing that's easy to forget once the feature has shipped and looks "done."
- **`_handoff-context/tc-draft.md`** — the file `TermsAcknowledgment.tsx`'s own doc comment points to for full sourcing rationale — was untracked when this record was first written, which would have left that in-code reference dangling for any fresh clone. It is committed alongside this document, so the reference now resolves. This document is still written to stand on its own.
