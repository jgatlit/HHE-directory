/**
 * How a practitioner's photo is framed inside whatever box is displaying it.
 *
 * ONE helper, used by every surface — hero, search hit, directory rail, the /edit preview — so a
 * practitioner's framing cannot mean one thing on their profile and another in search results.
 * That divergence is the whole failure this feature exists to prevent: the reason framing needs
 * fixing at all is that `object-cover` centre-crops, and a centre that is wrong on one surface is
 * wrong on all of them.
 *
 * WHY CSS AND NOT A REWRITTEN FILE. The framing is stored as data and applied at render time:
 *   - repeatable forever, so "reframe an already-uploaded photo" needs no re-upload;
 *   - the original blob is never mutated, so nothing can be corrupted or lost;
 *   - no image pipeline, no new dependency, no new failure mode on upload;
 *   - the defaults reproduce today's rendering exactly, so every existing row was already correct
 *     the moment the column appeared.
 */

export type PhotoFraming = {
  photoFocalX: number;
  photoFocalY: number;
  photoZoom: number;
};

/** Framing that reproduces plain `object-cover` — the pre-2026-08-28 behaviour. */
export const DEFAULT_FRAMING: PhotoFraming = { photoFocalX: 0.5, photoFocalY: 0.5, photoZoom: 1 };

/** Zoom bounds. 3× is where a 512px source starts visibly softening in a 352px-wide frame. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

/**
 * Normalise whatever came out of the database or a form.
 *
 * ⚠️ Defensive on purpose. These are three loose Floats with no DB-level CHECK, so a bad write
 * from any future caller would otherwise reach the browser as `object-position: NaN%`, which
 * browsers drop — silently restoring the centre crop and looking exactly like "the feature
 * doesn't work" rather than like a bad value. Clamping here makes that class of bug impossible
 * to express on any surface.
 */
export function normalizeFraming(input: Partial<PhotoFraming> | null | undefined): PhotoFraming {
  if (!input) return DEFAULT_FRAMING;
  const zoom = Number(input.photoZoom);
  return {
    photoFocalX: clamp01(Number(input.photoFocalX)),
    photoFocalY: clamp01(Number(input.photoFocalY)),
    photoZoom: Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1,
  };
}

/**
 * Inline style for an `object-cover` <img> filling its container.
 *
 * `objectPosition` moves the visible window; `scale` magnifies about that same point, which is
 * why `transformOrigin` must track the focal point rather than sit at centre — zooming about the
 * centre would drag the subject back out of frame at exactly the moment the practitioner is
 * trying to bring it in.
 *
 * At zoom 1 this emits `50% 50%` and `scale(1)` — identical to what the frames rendered before
 * this feature existed.
 */
export function framingStyle(framing: PhotoFraming): React.CSSProperties {
  const { photoFocalX: x, photoFocalY: y, photoZoom: z } = normalizeFraming(framing);
  const px = `${(x * 100).toFixed(2)}%`;
  const py = `${(y * 100).toFixed(2)}%`;
  return {
    objectPosition: `${px} ${py}`,
    ...(z !== 1 ? { transform: `scale(${z})`, transformOrigin: `${px} ${py}` } : {}),
  };
}
