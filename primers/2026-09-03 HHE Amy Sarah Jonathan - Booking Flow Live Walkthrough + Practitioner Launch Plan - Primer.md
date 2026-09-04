# Standalone primer — full resolution for vaultless sessions

Canonical meeting note lives at `~/vault/300 Entities/Meetings/2026-09-03 HHE Amy Sarah Jonathan - Booking Flow Live Walkthrough + Practitioner Launch Plan.md`. This primer exists so a session opened directly in this repo (not the vault) has full context without needing wiki-link resolution.

## Meeting facts

- **Date:** 2026-09-03, 16:00–16:59 UTC (12:00–12:59 ET)
- **Attendees:** Jonathan Gudger (host, operator), Amy Sprouse ("Amy (HHE)" — budget authority, Holistic Health Educators), Sarah Schindler (practitioner-side owner, no vault entity yet — proposal staged)
- **Source:** Zoom dashboard `zoom.chem.dev`, meeting UUID `39443b2d-2c0a-4b2a-a742-74fbeaac5ce2` (numeric id `7703126001`, room "Jonathan Gudger's Personal Meeting Room")
- **Type:** External client working session, live screen-share walkthrough of the practitioner edit page

## Source files in this workspace / vault

- Raw VTT transcript: `~/vault/400 Resources/Transcripts/archive/2026-09-03 Zoom - HHE Booking Flow Live Walkthrough.vtt` (658 cues)
- Metadata JSON (participants/action_items/discussions/summary/recordings, from Zoom-API): `~/vault/400 Resources/Transcripts/archive/2026-09-03 Zoom - HHE Booking Flow Live Walkthrough.meta.json`
- Canonical meeting note: `~/vault/300 Entities/Meetings/2026-09-03 HHE Amy Sarah Jonathan - Booking Flow Live Walkthrough + Practitioner Launch Plan.md`
- Staged (pending operator review, not yet applied):
  - `~/vault/999 Inbox/Triage/2026-09-03-NEW-person-sarah-schindler-proposal.md`
  - `~/vault/999 Inbox/Triage/2026-09-03-practicenear-patch.md`
  - `~/vault/999 Inbox/Triage/2026-09-03-amy-hhe-patch.md`

## Critical cross-reference: this call happened using THIS repo's live dev server

Zoom-API's live source lookup (`GET /api/meeting/<uuid>` on `vps:~/apps/Zoom-API`, Flask :3002) plus operator confirmation ("no other parallel changes were made") establish that the "this morning" / "20 minutes ago" live changes Jonathan narrates on the call are the **same same-day engineering session** that produced this repo's `feat/booking-offerings-redundancy-fix` branch (commit `dd566a4`) — Jonathan was screen-sharing this repo's local dev server mid-implementation. That branch is **NOT YET MERGED to `main`** or deployed to production as of this primer.

**Practical implication:** several of today's call action items are already done in that branch; others are genuinely unbuilt. Do not assume anything is live in production until the branch is merged and a deploy is verified (see project CLAUDE.md's "Verify what is actually LIVE" rule — check `dpl_` id, not status codes).

## Decisions

- Booking-link/offering redundancy is a **configuration outcome, not a bug** — controlled via Booking Link ↔ Offering mapping and "Show on profile"; the fix is UI clarity/guardrails, not removing the underlying flexibility (4 supported topologies: bare link, 1:1, 1:many, unlinked offering).
- Default guidance to practitioners: **"I'll handle tax myself"** for Whop's sales-tax-collection setting.
- Default guidance to practitioners: **3–4 Offerings, 1–2 Booking Links** to start (soft recommendation, not enforced).
- **Launch: Sarah announces to the 14 currently-listed directory practitioners on 2026-09-04** — short Loom overview + written getting-started guide (guide from Jonathan).
- Reviews stay deferred in favor of testimonials (reconfirms an existing decision); Amy re-raised urgency, no new timeline.

## Action Items

- [ ] Jonathan — Provide the practitioner-preferences survey outline to Amy and Sarah by 2026-09-04 at the latest.
- [ ] Jonathan — Produce a written "getting started" guide/link for Sarah's 2026-09-04 announcement.
- [ ] Jonathan — Clarify Publish / Accept Payments / Show on Profile labeling — Sarah herself had the wrong mental model of what "Publish" does.
- [ ] Jonathan — Restore the Offering description on `/book` (regressed live during the call, caught by Amy). **Already fixed** in `feat/booking-offerings-redundancy-fix` (task 3 of that branch's 6-item scope) — needs merge/deploy, not fresh implementation.
- [ ] Jonathan — Add a "manage your Whop account" button in the edit-page payments section (no in-portal link exists today). **Not yet built.**
- [ ] Jonathan — **UNRESOLVED, not diagnosed live:** why does Amy's profile show two bold/pink-styled booking-link buttons simultaneously? Raised at the very end of the call, distinct from the content/title redundancy already explained and already partially fixed on the branch. **Needs fresh investigation — do not assume the branch resolves this.**
- [ ] Jonathan — Verify whether Whop supports a custom bank-statement descriptor (practitioner/business name instead of generic "WAP.com Entertainment"). Explicitly unverified as of the call.
- [ ] Jonathan — Compile key messaging items + screenshots (Publish/Accept Payments, Whop account management, revenue-share model, tax setting) into a reference doc for Sarah.
- [ ] Sarah — Announce to the 14 currently-listed directory practitioners on 2026-09-04.
- [ ] Sarah — Guide new practitioners to 3–4 Offerings / 1–2 Booking Links, and "handle tax myself" in Whop settings.
- [ ] Amy — Split her own "1 Month of Support" Booking Link into two separate Calendly links (1-month intake vs. 3-month) to stop exhibiting the redundancy pattern on her own profile. (Deliberately left as-is by the same-day engineering session, per operator direction, so Amy can self-remediate.)

## Key Quotes

> "Oh, Jonathan, my only question was, why do I have two pink buttons?" — Amy (closing the call; unresolved)

> "So, just wanted to make that fully clear... the redundancy is mostly — well, and before today, some of the — at least one of those would have shown up redundantly anyway. After today's changes, it just depends on your configuration there." — Jonathan

> "Is there any way to populate the description on this page?" / "That's — that's here now." / "That's not there now." — Amy and Jonathan, live-catching the description regression

> "I would like this to be able to... get larger, so that you could paste a whole... HTML description with images and all of that in your offering description." — Jonathan, forward direction for offering descriptions (unbuilt)

> "It's kind of really cool, Sarah, actually, that you've never logged into WAP, but you have a WAP account, and Amy has paid you... we are bridging the gap between people who have never accepted credit cards to just getting their ID out and just automatically accepting credit cards." — Jonathan

> "I'm gonna have to go study up on all this." — Sarah, on Whop's payment-plan/financing options

## Entities surfaced

### Amy Sprouse — "Amy (HHE)"
- Role: Operations stakeholder / budget authority at Holistic Health Educators
- Vault path: `300 Entities/People/Amy (HHE).md`
- **Engagement Strategy synopsis (verbatim from entity, as of 2026-05-13):** "Amy is budget authority at HHE and the strategic voice on what product is *for*. Her course-corrections supersede Blake's build directives. Pattern across her last two pivots (voice-agent declined 2026-04-23, directory scope reframe 2026-05-13): she keeps asking for human-trust-shaped products against AI-coverage-shaped defaults — 'our people are wanting to know who can they trust, who do we know.' Lead future PracticeNear and Ask Zuzu framing with trust signals, community provenance, and HHE-vetted curation — not with scale, coverage, or AI capability metrics."
- **Working style:** Responds to direct asks with time anchors; drifts on open-ended timing. Conflict-avoidant under load (warm-but-cryptic when overwhelmed). Warmth-first communicator — match, don't escalate.
- Full bio / canonical: `~/vault/300 Entities/People/Amy (HHE).md`

### Sarah Schindler — no entity file yet (proposal staged)
- Practitioner-side owner of naturalhealthpros.com; original 12-person pilot roster (#11); owns tomorrow's 14-practitioner announcement.
- Proposal: `~/vault/999 Inbox/Triage/2026-09-03-NEW-person-sarah-schindler-proposal.md` — pending operator `mv` to `300 Entities/People/Sarah Schindler.md`.
- Flag: her email of record (`livingaligned.love`) may be dead per an existing 2026-08-18 memory note; `sarah@wild-rooted.com` was supplied as a replacement on 08-11 but is unconfirmed.

### Jonathan Gudger (operator)
- Vault path: `300 Entities/People/Jonathan Gudger.md` (+ `Jonathan Gudger - Operator DNA.md`) — not inlined here, self-referential.

### PracticeNear (project — naturalhealthpros.com)
- Vault path: `300 Entities/Projects/PracticeNear.md`
- `working_folders:` frontmatter already correctly points at `~/projects/HHE/HHE-directory`.
- Status frontmatter reads `complete`/`superseded_by: naturalhealthpros.com` — this is a **known-stale label**, not a real project closure; the vault entity for `naturalhealthpros.com` was staged for creation 2026-08-13 but never actually created, so `PracticeNear.md` remains the de facto canonical, actively-updated project entity. Patch staged today adds a 2026-09-03 Progress Log entry.
- Pilot roster as of 2026-05-29 was 12 practitioners; today's call references **14** currently listed — headcount has grown, not reconciled in the entity yet.

## Open questions / verifications carried over

1. Is the "two pink buttons" issue the same root cause as the already-fixed offering/link redundancy, or a genuinely separate styling bug (multiple Booking Links independently getting hero/bold treatment)? **Unverified — investigate fresh, do not assume.**
2. Does Whop support a custom bank-statement descriptor per connected account? **Unverified per Jonathan on the call.**
3. Is `feat/booking-offerings-redundancy-fix` (commit `dd566a4`) merged to `main` and deployed yet? **Check before assuming any of today's promised fixes are live** — verify by `dpl_` id per the project's own "Verify what is actually LIVE" rule (project CLAUDE.md), not by status code.

## Next-step suggestion

This call produced 12 action items across 3 owners and 5 decisions — external meeting, stakeholder input. Per the process-transcript skill's handoff trigger, this would normally suggest `/project-spec-authoring` for a phased priority spec. Given the immediate 2026-09-04 launch deadline, the higher-leverage next step is almost certainly: (1) confirm `feat/booking-offerings-redundancy-fix` merge/deploy status, (2) scope+build the smaller unbuilt items (Publish/Accept-Payments clarity, Whop account button) if time allows before the announcement, (3) investigate the "two pink buttons" report fresh. A phased spec is more useful for the larger, non-blocking items (rich HTML descriptions, courses-in-booking-flow, testimonials).
