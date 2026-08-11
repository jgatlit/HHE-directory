# Follow-ups queued 2026-08-10 — landing-page session

> Written at the close of the session that shipped PRs #41–#43. Everything here was **found and
> designed but not implemented**. Ordered by value. None is a blocker; item 1 is the only one that
> affects live availability.
>
> Provenance: found by two adversarial review agents against PR #41, plus direct verification
> against production. Each carries the evidence that justifies it, so nobody has to re-derive it.

---

## 1. Directory snapshot refactor — closes TWO live bugs at once ⭐

**Approved design, not yet implemented.**

`src/app/page.tsx` renders unguarded query results, which produces two distinct failures:

- **Query throws → 500 on the front door.** `/` is `force-dynamic` with no root `error.tsx` and no
  catch, so a Neon blip (autosuspend cold start, lost env var, deleted branch) escapes the server
  component and Next falls through to its built-in error page. **Before PR #41 this outage was
  invisible** — `/` was static HTML on the CDN. The fix made freshness correct and availability worse.
- **Query succeeds returning 0 → a confident lie.** `{totalCount}` has no floor and `featured.map`
  has no empty branch, so a healthy query against a *wrong* Neon branch renders
  "0 HHE-trained practitioners" over an empty rail, at HTTP 200, with nothing logged.

Both are "render whatever came back". Guard once:

```ts
// src/lib/directory.ts
type DirectorySnapshot =
  | { ok: true;  featured: DirectoryPractitioner[]; totalCount: number }
  | { ok: false };

export async function getDirectorySnapshot(): Promise<DirectorySnapshot> {
  try {
    const [featured, totalCount] = await Promise.all([...]);
    if (totalCount === 0 || featured.length === 0) return { ok: false };
    return { ok: true, featured, totalCount };
  } catch (err) {
    console.error('[home] directory snapshot failed — degrading', err);
    return { ok: false };
  }
}
```

The page renders hero + CTA unconditionally; count line and rail only when `ok`.

**Why this shape rather than a bare try/catch:**
- The **discriminated union makes the invalid state unrepresentable** — the compiler stops you
  rendering `totalCount` when there isn't one. That is what keeps the bug from returning.
- **Treating empty as `!ok` is deliberate.** A directory reporting zero practitioners is either
  misconfigured or in a state where advertising "0" actively hurts.
- **Degrading beats an error page.** `/search` has **no Prisma import** — it is entirely
  Typesense-backed. During a Postgres outage the directory still works; only the homepage's
  decorative bits fail. A 500 on `/` would make a working product look dead.

**Keep `force-dynamic`.** `revalidate = 60` still 500s on the first request after a deploy with a
cold cache, and gives up exact per-request `listedWhere()` evaluation — which is the entire reason
`force-dynamic` exists (trial expiry is time-based; nothing purges the cache for it), and which
`api/cron/trial-sweep/route.ts` already asserts in its own comment.

⚠️ **Trap:** do **not** add a root `loading.tsx` without also adding `error.tsx`. With no Suspense
boundary in the bare layout, React currently cannot flush a shell early — that is what guarantees
today's clean 500 rather than a half-rendered page with a header and no body.

Add `src/app/error.tsx` as a backstop regardless.

---

## 2. `deleteFromIndex` swallows every error — a hole in the paywall

`src/lib/practitioner-indexer.ts`:

```ts
catch { /* Doc may not exist; safe to swallow. */ }
```

The comment describes **one** error; the bare catch eats all of them — 401 from a rotated admin key
(the cluster rebuild rotates keys), ECONNREFUSED, timeout, 5xx, quota. Since `indexPractitioner()`'s
delist path is `await deleteFromIndex(id); return;`, **delisting is structurally incapable of throwing.**

Consequence: `api/cron/trial-sweep/route.ts` wraps the delist in a try/catch commented *"Fail soft,
but LOUD: a practitioner stuck in search past their trial is a billing hole, and a silent catch here
would hide it indefinitely."* **That counter can never increment on a Typesense error.** The daily
sweep returns `{ok:true, delisted:{failed:0}}` HTTP 200 while every delete was rejected, and expired
practitioners stay in `/search` forever.

**Fix:** narrow the catch to 404 / ObjectNotFound, rethrow the rest.

**Verified safe:** all 11 callers of `indexPractitioner()` already wrap it in
`.catch(err => console.error(...))` — the three edit actions, onboarding, admin invites, both Whop
webhooks, and the retire script. The only caller with a real failure counter is `trial-sweep`, which
is the one that *should* report. Nothing regresses.

Not currently firing — Typesense holds 13 docs with the operator specialties absent, verified.

---

## 3. `scripts/retire-operator-test-listing.ts` hardening

Already applied to production 2026-08-10; these are future-run hazards.

- **`deleteMany` is scoped by specialty slug, not by the practitioner set just enumerated.** A re-run
  months from now would delete a real pilot's link if they ever picked one of those slugs — and never
  reindex them, because the loop iterates `touchedPractitionerIds` snapshotted from an *earlier* read.
  Postgres says unlisted, Typesense says live. One-line fix: add
  `practitionerId: { in: Array.from(touchedPractitionerIds) }` to the `where`, making apply exactly
  equal the printed report.
- **Not re-runnable after partial failure.** A second `--apply` finds 0 links, reindexes nobody, and
  still prints "reindexed every affected practitioner." Real recovery is `npm run typesense:reindex`
  — document it in the header.
- **No revert for the step that actually ran.** The printed REVERT covers the trial backdate, which
  was skipped. `rawLabel` is echoed to stdout and persisted nowhere.
- Header still reads **"STAGED — needs operator sign-off"** on a script already applied.

---

## 4. Nits worth one PR

- **`loading="lazy"`** missing on the home rail images; `PractitionerHit.tsx` sets it.
- **Pre-existing `/admin` bug** (not from this session): `src/app/admin/page.tsx` passes
  `className="flex items-center gap-4 p-4"` to `Card`, whose base is `flex flex-col`. `twMerge` keeps
  `flex-col` (different merge group from `flex`), so those tool cards render as a centred **column**,
  not the intended row. **Same failure class as the Separator bug** — a Tailwind class silently not
  doing what it reads like.

---

## 5. Corrections to PR #41's commit message (record only, no code change)

Two claims in it are false, and the accurate versions are stronger:

- *"the count and rail could not change without a redeploy"* — `revalidatePath('/')` **does** fire
  from `edit/actions.ts` (saveProfile, onboarding completion). The real gap: nothing purges `/` for
  **time-based** changes (`listedWhere()` evaluates `new Date()` against the trial clock) or for
  out-of-band DB writes like the retire script.
- *"Every other DB-reading route already sets force-dynamic; `/` was the only one that did not"* —
  `practitioners/[slug]/page.tsx` reads the DB and sets no `dynamic` export; it is dynamic only via
  `searchParams`.

---

## Related

- Live claims escalation (Jonathan + Amy): `docs/brand/CLAIMS-REVIEW-JONATHAN-AMY.md` · vault task `tsk_7c208dca0b7644978ef8`
- Client copy + claim-verification table: `docs/brand/2026-08-10-client-landing-copy.md`
- Brand source of truth: `docs/brand/STYLE-GUIDE-SOURCE.md`
- Prior prime: `docs/NEXT-SESSION-PRIME.md` (2026-07-16 — its "landing page not started" item is now DONE)
