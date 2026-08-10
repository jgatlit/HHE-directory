# Visual branding / design style guide — canonical source

> **Answer in one line:** the official style guide is the CMS project **`hhe-directory`** at
> `vps:~/apps/CMS/projects/hhe-directory/tokens.json` (117 DTCG tokens), rendered live at
> **https://cms.chem.dev/hhe-directory**. Everything in this repo is a *downstream consumer* of it.
>
> Verified 2026-08-10.

## Source ranking (use in this order)

| # | Source | What it is | Status |
|---|---|---|---|
| 1 | `vps:~/apps/CMS/projects/hhe-directory/tokens.json` | **Upstream source of truth.** 117 DTCG tokens across 9 groups: `color`, `gradient`, `typography`, `spacing`, `borderRadius`, `shadow`, `transition`, `breakpoint` | ✅ authoritative |
| 2 | https://cms.chem.dev/hhe-directory | Live rendered brand guide (showcase route) | ✅ HTTP 200 |
| 3 | `src/app/globals.css` `:root` (≈L68–100) | **As-deployed truth in this repo** — the flattened OKLCH subset actually shipping to naturalhealthpros.com | ⚠️ lossy subset, see below |
| 4 | `docs/P2-design-system-prep.md` | The bridge/mapping doc: token-contract table + swap procedure | ⚠️ framing stale, mechanics valid |

**Not the style guide** (point-in-time visual baselines only): `docs/mockups/`, `docs/landing-built/`.

### Caveats on sources 3 and 4

- **Source 3 is a lossy subset.** The CMS registry lists `tokenOverrides` including
  `gradient.heroWash`, `gradient.roseCta`, `gradient.primaryToSecondary`, `shadow.glowRose`,
  `shadow.cardHover`. **None of these exist in `globals.css`** — only the flat colors were
  carried across on 2026-05-29. There is materially richer brand material upstream than what
  has ever shipped. Any frontier-UX build should pull from source 1, not source 3.
- **Source 4 self-describes as pre-shipping** ("branding is currently deferred… `globals.css`
  still ships default shadcn zinc"). Per `CLAUDE.md` that framing is **stale** — Theme D shipped
  2026-05-29 via `8cf4f17`/`5a23aff`. Its token-contract table and swap procedure remain correct;
  ignore its status claims.

## The brand, as currently deployed

**Theme D "Midnight Navy"** — navy structure, rose-magenta CTA, botanical sage secondary, white ground.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | page ground |
| `--foreground` | `oklch(0.302 0.056 255.3)` | `#1A2F4A` | deep navy body text |
| `--primary` | `oklch(0.403 0.071 253.9)` | `#2C4A6E` | midnight navy — structure, nav, default buttons |
| `--cta` | `oklch(0.564 0.18 1.7)` | `#C4396E` | **rose magenta — booking/CTA only** |
| `--secondary` | `oklch(0.965 0.012 153.7)` | `#EEF6F0` | soft sage surface |
| `--secondary-foreground` | `oklch(0.42 0.07 154)` | — | deep sage |
| `--muted-foreground` | `oklch(0.551 0.023 264.4)` | `#6B7280` | meta/helper text |
| `--accent` | `oklch(0.957 0.007 260.7)` | `#EEF1F6` | navy-tint hover surface |
| `--border` / `--input` | `oklch(0.9 0.006 260)` | — | light navy-gray |
| `--ring` | `oklch(0.403 0.071 253.9)` | — | navy focus ring |
| `--radius` | `0.625rem` | — | base radius |

**Type:** Inter (`--font-sans`, body) · Playfair Display (`--font-serif`, display/headings) ·
Geist Mono (`--font-mono`). Wired in `src/app/layout.tsx` via `next/font`.

**Convention worth preserving:** `--cta` (rose) is a *separate slot* from shadcn's `--accent`
(subtle hover). Rose is reserved for the booking action; navy carries structure. Don't collapse them.

### Known gap: dark mode is not branded

The `.dark` block in `globals.css` is still **default shadcn zinc/neutral**, not Theme D. It is
currently inert (nothing sets the `.dark` class, and there is no theme toggle), so this is latent
rather than live. Any build that introduces a theme toggle must brand `.dark` first.

## Pipeline state (frontier-UX)

Per `SOP — frontier-UX Pipeline` (nobox-vault `art_f9b86d2b77af48fda852`):

- Registry entry claims `completenessScore: 9`, `completenessGaps: []` (last validated 2026-05-29).
- **The live validator disagrees.** `python3 ops/pipeline/onboard-project.py --validate-completeness hhe-directory`
  returns **4/9**, gaps **C4, C5, C6, C7, C9** — Stitch Design System ID missing, 0 Stitch screens,
  0 Penpot pages, 0 Penpot components, no Penpot notification. **Treat the stored score as stale.**
- This is precisely the SOP's "branding-only" state; its `branding-only → full frontier build`
  procedure (re-enter at F1.5) applies directly.
- Registry names this repo explicitly: `downstreamConsumers: ["xt12:~/projects/HHE/HHE-directory"]`.
- Six frontier sections are already named upstream: `SectionHero`, `SectionDirectory`,
  `SectionPrograms`, `SectionProcess`, `SectionCredentials`, `SectionCTA`.

**Tooling note:** Stitch MCP is *not* configured on XT12. The `cms-onboard-project` skill documents
the required workaround — dispatch Stitch phases via `claude -p` from `~/apps/CMS` on the VPS:

```bash
cd ~/apps/CMS && ~/.local/bin/claude -p "<stitch instructions>" --allowedTools "mcp__stitch__*"
```

Penpot MCP **is** configured locally, so F1.6/F7 run in-session. F1.5 is mandatory, not skippable.
