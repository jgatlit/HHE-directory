---
origin_path: nobox-vault:artifact/art_4c702b7a1d2848ddbf33
origin_host: nobox-vault MCP (teamwork-vault, noboxAI workspace)
origin_mtime: 2026-08-25T11:57:28Z
origin_sha1: n/a (MCP artifact — fetch via mcp__nobox-vault__artifact_read({artifact_id:"art_4c702b7a1d2848ddbf33"}) to re-verify against this copy)
copied_at: 2026-08-25T13:00:00Z
title: "Natural Health Pros — Terms & Conditions draft, sourced for Sarah/Amy handoff"
status: draft
needed_for: "queue item 6 (tsk_f2cd5b3e3d3547dab90b)"
---

## What this is, and isn't

**Is:** a working draft, structured and clause-sourced from reputable, publicly-referenced
industry patterns, ready for Sarah + Amy to react to — exactly what Jonathan committed to on the
2026-08-18 call: *"I'll do a little bit of research, because it's a specific SaaS product,
platform, and so there's probably some standard language there. I'll try to find something
relevant, run it by you and Amy, and we can plug that in."*

**Is not:** legal advice, and not final. Bracketed `[items]` mark real decisions someone with
legal authority needs to make (entity name, governing state, arbitration terms). **Recommend
actual legal counsel review before this ships to real practitioners** — nothing here should be
mistaken for that review having happened.

## Why this shape

The call surfaced two needs that turned out to be one document, not two — Sarah asked about a
signed disclaimer/expectations agreement *and*, separately, raised wanting something
NDA-like for confidentiality. Jonathan resolved it on the call: *"Yeah, customarily, that'll be
in the terms and conditions... that's the very reason for that, just legal coverage."* No
separate NDA process — one T&C covering both.

## Sources used (why each is "high-trust" for this specific shape)

1. **Whop's own Seller Terms** (`whop.com/seller-terms/`, `whop.com/tos/`) — the single most
   directly authoritative source here, because Natural Health Pros's practitioners ARE Whop
   Sellers through the connected-accounts model. This isn't generic reference material — it's the
   actual legal document our own payment processor already has in place, and our T&C **must not
   contradict it**. Whop is explicit: it is merchant of record for *payment settlement only*;
   the practitioner is "the supplier of the Products for all other purposes, including... consumer
   protection, and content licensing." Our T&C has to preserve that allocation, not blur it.
2. **TermsFeed's SaaS Terms & Conditions template** and the general marketplace-ToS clause
   checklist (PandaDoc, Promise Legal, Sprintlaw) — the "industry-standard SaaS language" Jonathan
   named directly on the call. Used for structure and boilerplate clause coverage (eligibility,
   license-back for user-submitted content, liability limitation, notice-of-changes practice),
   not copied verbatim from any one vendor.
3. **TermsFeed's therapist/wellness-practitioner disclaimer guidance** — the closest reputable
   published pattern for the health-adjacent piece specific to this platform: a "not a substitute
   for professional medical advice" disclaimer, standard and near-universal across wellness-service
   sites, not proprietary language.

## Draft — Natural Health Pros Terms & Conditions

*(practitioner-facing; the click-to-acknowledge checkbox at onboarding references this document)*

### 1. Acceptance
By creating a practitioner profile on Natural Health Pros, you agree to these Terms. If you do
not agree, do not create a profile or continue using the platform.

### 2. What Natural Health Pros is — and isn't
Natural Health Pros is a **directory and listing platform** for graduates of Holistic Health
Educators (HHE) programs and other wellness practitioners. We help clients discover practitioners
and help practitioners present their services; **we are not a healthcare provider, we do not
practice medicine, and nothing on this platform is a substitute for professional medical advice,
diagnosis, or treatment.** Always consult a qualified healthcare provider with questions about a
medical condition.

### 3. Practitioners are independent
Every practitioner listed is an **independent professional**, not an employee, agent, or
contractor of Natural Health Pros. You are solely responsible for the services you offer, their
description, pricing, delivery, scheduling, and any refund or cancellation decisions related to
them. Natural Health Pros does not supervise, endorse, or guarantee the outcome of any service
booked through the platform. *(Mirrors Whop Seller Terms' supplier allocation — do not weaken
this without checking against Whop's terms first.)*

### 4. Payments
Payments for paid services are processed through **Whop**, our third-party payment processor.
Whop acts as merchant of record for payment settlement only; practitioners are the supplier of
record for all other purposes, including applicable taxes and consumer-protection obligations.
Natural Health Pros facilitates the connection between practitioner and client — refund and
dispute decisions for a specific service are the practitioner's, per Whop's Seller Terms and
Buyer Terms. [Confirm: does Natural Health Pros absorb any chargeback fees, or do they pass
through to the practitioner? Whop's own terms put chargeback liability on the seller by default.]

### 5. Your profile and content
You retain ownership of the content you submit (bio, photos, offering descriptions). By
submitting it, you grant Natural Health Pros a non-exclusive license to display, store, and
moderate it on the platform and in platform promotion, for as long as your profile is active.
[Confirm scope with Amy — this is the standard marketplace license-back clause, needed so
displaying a practitioner's own profile to a visiting client isn't a copyright question.]

### 6. Confidentiality and platform expectations
Practitioners agree not to use information, materials, or relationships gained through Natural
Health Pros in a manner that misrepresents the platform, HHE, or other practitioners, and to
represent their qualifications accurately. [This is the clause covering what Sarah's NDA
instinct was reaching for — Jonathan's call to fold it in here rather than a separate document.
Amy + Sarah should read this section specifically and flag if it needs to say more.]

### 7. Fees and subscription
Directory listing is billed at **$49/month** following a **90-day trial**, during which no
payment is required. [Confirm: does the live product copy on SubscriptionSection.tsx match this
exactly? It should — check before shipping.] Subscriptions may be canceled at any time; your
profile is never deleted, only unlisted or archived.

### 8. No warranty; limitation of liability
The platform is provided "as is" and "as available." Natural Health Pros makes no warranty that
the platform will be uninterrupted or error-free. To the maximum extent permitted by law, Natural
Health Pros is not liable for indirect, incidental, or consequential damages arising from your
use of the platform or any service booked through it. [Governing law / liability cap figure —
needs Amy + counsel, not a default to guess at.]

### 9. Termination
Natural Health Pros may suspend or remove a profile that violates these Terms, misrepresents
qualifications, or (per Whop's own policy, which flows through here) generates excessive payment
disputes. Practitioners may request removal of their own profile at any time.

### 10. Changes to these Terms
We will provide at least 30 days' notice (by email or in-app) before a material change to these
Terms takes effect. Continued use after that date constitutes acceptance. [30-day notice is
called out in the research as the safer legal practice — one-sided immediate-effect changes have
been struck down in US courts; don't shorten this without a reason.]

### 11. Governing law and disputes
[BLANK — needs Amy/Jonathan/counsel: state of incorporation, and whether to mirror Whop's binding
arbitration clause or handle disputes differently. Do not leave this blank when it ships.]

## What Amy + Sarah specifically need to react to

1. Section 6 (confidentiality) — is this what Sarah meant, or does she want something stronger?
2. Section 8/11 (liability + governing law) — needs an actual decision, not a placeholder, before
   this goes live.
3. Whether HSA-reimbursement or credential-specific claims (raised in the 08-11 call, A5) need
   their own disclaimer subsection here rather than being handled purely as a profile-field gate.
4. Sign-off that Section 4 (payments) accurately reflects the current Whop relationship — worth a
   second read against `docs/PHASE-2C-WHOP-CONNECTED-ACCOUNTS.md`.

## Handoff

Linked to vault task `tsk_f2cd5b3e3d3547dab90b` (T&C click-to-acknowledge — queue item 6).
**Approved 2026-08-25:** build with this REAL draft copy, not lorem-ipsum — get it into a
reviewable, in-context state (the actual onboarding checkbox step rendering this actual draft
text) rather than making Sarah/Amy review this file blind. Still not final — the bracketed gaps
above (Section 4 chargeback question, Section 5 license scope, Section 8/11 liability + governing
law) are real, and no real practitioner should be asked to accept this for keeps until Sarah/Amy
react to it.
