# Node labels for the specialty constellation — feasibility, validated paths

> **Status: DEFERRED — assessed 2026-08-11, not started.** No code written. This records the
> validated technical paths and the traps found while assessing them, so a future session doesn't
> re-derive any of it.
>
> **The ask:** show a label for each node in the canvas data-engine, where the label follows the
> node's **position**, **size/scale**, and **colour/hover** state.

---

## What exists today

`src/components/frontier/SpecialtyConstellation.tsx` — Class 2 (3D Interactive), R3F + three.

| Property | Where | Behaviour |
|---|---|---|
| Nodes | `<sphereGeometry>` meshes inside one rotating `<group>` | one per live specialty (19 at time of writing) |
| **Position** | `spherePositions()` — Fibonacci sphere, radius 2.55 | parent group rotates continuously (idle drift + drag inertia) |
| **Scale** | `0.1 + (count / maxCount) * 0.16`, ×1.7 when active | driven by practitioner count |
| **Colour** | `#C4396E` active · `#7BA3CC` child · `#A8D5B5` root | hardcoded hex — see the palette prerequisite below |
| **Hover** | `activeIndex` React state | **one-way**: set only by the index list's `onMouseEnter`/`onFocus`. There is **no raycasting on the canvas.** |
| Accessibility | `<Canvas aria-hidden="true" tabIndex={-1}>` | deliberate — the specialty index beside the canvas is authoritative. Labels would be **decorative only**. |

The same considerations apply to `PracticeField.tsx` (Class 1, one node per listed practitioner).

---

## ✅ Validated path: `CSS2DObject` — native to three, already installed

`three@0.169` ships `CSS2DRenderer.js` at `node_modules/three/examples/jsm/renderers/`. **No new
dependency.** Verified by reading the source, not by assumption:

| Line | What it gives you |
|---|---|
| `L8` | `class CSS2DObject extends Object3D` — it is a **scene-graph child**. Nest one inside each `<group position={p}>` and it inherits the world transform, *including the rotating parent*. Position tracking is free. |
| `L141-142` | `setFromMatrixPosition(matrixWorld)` → `applyMatrix4(_viewProjectionMatrix)` |
| `L144-147` | culls on `_vector.z` outside `[-1,1]` → sets `display:none`. Off-screen and behind-camera handled natively. |
| `L23` | `.center` (Vector2, default `0.5,0.5`) for anchor control |
| — | Real DOM text: existing Tailwind classes, brand tokens, crisp at any DPI |
| — | ~235 lines importing only `Object3D`/`Vector2`/`Vector3`/`Matrix4`, all **already in the bundle** |

### What it does NOT give you

1. **No scale term.** `L153` emits exactly `translate(-50%,-50%) translate(Xpx,Ypx)` — position only.
   Labels are constant screen size. Drive `fontSize` from the same
   `0.1 + (count/maxCount)*0.16` expression the mesh uses. This is *preferable* to perspective
   scaling, which renders far-node text unreadable.
2. **`pointer-events` is NOT set.** The source only sets `position:absolute` on elements and
   `overflow:hidden` on the container. Left alone, **labels will swallow the drag gestures** on the
   same surface. Set `pointer-events: none` explicitly.
3. **No occlusion.** Far-side labels paint over near nodes. The renderer computes `z` but does not
   expose it, so a depth fade means recomputing it in `useFrame`.
4. **R3F does not drive it.** Mount `renderer.domElement` into the canvas wrapper (**inside** the
   `aria-hidden` region, so the index stays authoritative), call `render(scene, camera)` from
   `useFrame`, attach objects via `<primitive object={...} />`, handle resize. ~15 lines.

---

## Alternatives considered and rejected

| Approach | Verdict |
|---|---|
| **drei `<Html>` / `<Text>` / `<Billboard>`** | ❌ **`@react-three/drei` is NOT installed** — not directly, not transitively (`npm ls` → empty). ⚠️ The sandbox port README at `~/projects/HHE/nhp-frontier-sandbox/README.md` lists it among the required deps; **it never landed and is not needed.** Don't trust that line. Adding drei (+troika for `<Text>`) costs ~60 kb on a page deliberately split to 189 kB First Load. |
| **`CSS3DObject`** | ❌ applies the full matrix, so labels rotate with the sphere and render **mirrored/upside-down on the far side**. Wrong for text. |
| **Sprite + canvas texture** | ❌ raster text (blurry when scaled), needs texture regeneration on every colour/hover change. |
| **`TextGeometry`** (also native, present in `examples/jsm/geometries/`) | ❌ requires a loaded font JSON, produces real geometry — heavy for labels, and still needs billboarding. |

---

## Open risks — these decide whether it's a good idea

1. **19 labels on a continuously rotating sphere will collide.** This is the dominant risk and it is
   a **design** problem; no rendering choice fixes it. Half the nodes are always on the far side and
   the group never stops moving. Recommended shape: **active node always labelled, plus the top 3–5
   by count.** Rendering all 19 will look broken however well it is implemented.
2. **True per-node hover is net-new interaction, not a label feature.** Nodes are not independently
   hoverable today. Adding raycasting collides with the drag handler on the same surface, where
   `pointerdown` currently means *drag*. Needs a movement threshold (<5px travel = select, else
   drag). This is the delicate part and roughly doubles the scope.
3. **Zero accessibility gain, by design.** Labels live inside the `aria-hidden` region; the index
   list is authoritative. Do not let this be mistaken for an a11y improvement. They must still
   render statically under `prefers-reduced-motion` (D4), where rotation stops.

---

## ⚠️ Prerequisite: extract the node palette first

Three node colours are **not in the CMS token set** — `#9DC2E6`, `#BCE3C6` and `#8FC5A0`, all in
`PracticeField.tsx` (L95, L96, L210). They read as eyeballed lighter variants. The other seven hexes
across the frontier components *do* resolve to real tokens.

This matters specifically because *"label colour follows node colour"* means duplicating the palette
into a second renderer. Do it now and the drift is wrong in two places.

**Extract one `node-palette.ts`, reconcile those three against
`vps:~/apps/CMS/projects/hhe-directory/tokens.json`, then build labels against it.** ~20 minutes.

Root cause worth remembering: **three.js materials cannot read CSS custom properties**, so hex has
to be duplicated in JS. That is exactly where a design system silently loses — the same trap now
recorded in the frontier-UX SOP (`art_f9b86d2b77af48fda852`, "Source tokens from the CMS project").

---

## Effort

| Scope | Estimate |
|---|---|
| Palette extraction (prerequisite) | ~20 min |
| Label layer — `CSS2DObject`, active + top-N, fontSize from count, colour from state | ~2 hours |
| \+ canvas raycasting for true per-node hover (drag-vs-click disambiguation) | roughly doubles it |

## Related

- `docs/FOLLOW-UPS-2026-08-10.md` — other queued work from the landing-page session
- `docs/brand/STYLE-GUIDE-SOURCE.md` — token source of truth, and the two-CMS-project situation
- Sandbox + port table: `~/projects/HHE/nhp-frontier-sandbox/README.md` (note the drei caveat above)
